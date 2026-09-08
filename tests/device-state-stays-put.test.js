'use strict';

/**
 * Device state never leaves the machine it was written on.
 *
 * The store registry already answers this: tier 'data' is "belongs on the
 * server", anything else is "never leaves this machine", and DEVICE_KEY_PREFIXES
 * covers the keyed variants. Two other places answered it again by hand --
 * repo-sync's NON_SYNCED_STORES and script.js's NON_RESTORABLE_STORE_SUFFIXES --
 * and both had drifted to twelve names against the registry's twenty-five.
 *
 * collectVerbatimStores sweeps every prefixed localStorage key that is in
 * neither the explicitly-synced list nor the exclusion list, so the thirteen
 * missing names were going into every payload and every dated snapshot, and
 * applyVerbatimStores was writing them back on the receiving machine. What that
 * cost, in descending order:
 *
 *   callListeningSyncConfig  holds endpoint, sharedSecret and isWorkPc. The
 *                            worker's sanitizeForRepo matches on the KEY name
 *                            against /(token|secret|password|...)/i and this key
 *                            does not match, so the secret sat in R2 in clear.
 *                            On restore the receiving machine took the sender's
 *                            endpoint, secret and work-PC flag, so the wrong
 *                            machine started pushing.
 *   v2SyncState              the applied-hash map travelled, so pull() skipped
 *                            every shard the map claimed and the machine did not
 *                            hold. Those stores were never recovered.
 *   v2DeviceId               the receiving machine took the sender's identity.
 *   idbMigrated_v1           a machine that had not migrated was told it had.
 *   lastUploadUndo           another machine's undo snapshot, offered as this one's.
 *
 * So this asserts the rule against the registry rather than against a list, and
 * the two hand-lists are checked for drift instead of being trusted.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function registryNames() {
    const src = fs.readFileSync(path.join(ROOT, 'modules/store-registry.module.js'), 'utf8');
    const device = [];
    const data = [];
    const re = /\{\s*name:\s*'([a-zA-Z0-9_]+)'\s*,\s*tier:\s*'([a-z]+)'/g;
    let m;
    while ((m = re.exec(src)) !== null) (m[2] === 'data' ? data : device).push(m[1]);
    return { device, data };
}

// The literal fallback each file keeps for a missing registry.
function fallbackList(file, constName) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');
    const at = src.indexOf(constName);
    if (at === -1) return null;
    const open = src.indexOf('[', at);
    const close = src.indexOf(']', open);
    if (open === -1 || close === -1) return null;
    return (src.slice(open, close).match(/'([a-zA-Z0-9_]+)'/g) || []).map((q) => q.slice(1, -1));
}

suite('device state: the registry is the only list of what stays put', (t) => {
    const { device, data } = registryNames();
    t.check('the registry declares device-tier stores', device.length > 20);
    t.check('and data-tier stores', data.length > 20);

    // The three that actually hurt, named so a future edit to the registry that
    // demotes one of them fails here rather than in R2.
    ['callListeningSyncConfig', 'v2SyncState', 'v2DeviceId', 'idbMigrated_v1', 'lastUploadUndo']
        .forEach((name) => {
            t.check(`${name} is device-tier and must never sync`, device.indexOf(name) > -1);
        });

    // And the converse: the stores that carry the operator's work must stay
    // data-tier, or this fix would quietly stop backing them up.
    ['weeklyData', 'ytdData', 'coachingHistory', 'callListeningLogs', 'callTranscripts',
     'yearEndDraftEntries', 'yearEndAnnualGoals', 'myTeamMembers', 'employeePreferredNames']
        .forEach((name) => {
            t.check(`${name} is data-tier and must keep syncing`, data.indexOf(name) > -1);
        });
});

suite('device state: both hand-written fallbacks agree with the registry', (t) => {
    const { device } = registryNames();

    const cases = [
        { file: 'modules/repo-sync.module.js', name: 'NON_SYNCED_STORES', label: 'the sync sweep' },
        { file: 'script.js', name: 'NON_RESTORABLE_STORE_SUFFIXES', label: 'the file restore' }
    ];

    cases.forEach((c) => {
        const list = fallbackList(c.file, c.name);
        t.check(`${c.label} has a fallback list`, Array.isArray(list) && list.length > 0);
        if (!list) return;

        const missing = device.filter((n) => list.indexOf(n) === -1);
        t.equal(`${c.label}: every device store is in the fallback`, missing.join(', ') || '(none)', '(none)');

        const extra = list.filter((n) => device.indexOf(n) === -1);
        t.equal(`${c.label}: and the fallback invents none`, extra.join(', ') || '(none)', '(none)');
    });
});

suite('device state: the keyed prefixes are honoured too', (t) => {
    // smartDefault_*, supervisorSeeded_* and supervisorRenamed_* are device
    // state that is keyed rather than named, so a name-only check misses them
    // and another machine's "already done" markers travel across.
    const registrySrc = fs.readFileSync(path.join(ROOT, 'modules/store-registry.module.js'), 'utf8');
    const prefixes = (registrySrc.slice(registrySrc.indexOf('DEVICE_KEY_PREFIXES'))
        .match(/'([a-zA-Z0-9_]+_)'/g) || []).map((q) => q.slice(1, -1));
    t.check('the registry declares keyed device prefixes', prefixes.length >= 3);

    const repo = fs.readFileSync(path.join(ROOT, 'modules/repo-sync.module.js'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    t.check('the sync sweep tests the prefixes, not just the names',
        /isDeviceOnlyStore/.test(repo) && /NON_SYNCED_PREFIXES/.test(repo));
    t.check('and so does the file restore',
        /isNonRestorableStoreName/.test(script) && /NON_RESTORABLE_STORE_PREFIXES/.test(script));

    // Both sweeps must go through the helper rather than the raw Set, or the
    // prefixes are declared and never consulted.
    t.check('the sync collect path uses the helper',
        repo.indexOf('EXPLICITLY_SYNCED_STORES.has(name) || isDeviceOnlyStore(name)') > -1);
    t.check('the restore path uses the helper',
        script.indexOf('isNonRestorableStoreName(key.slice(STORAGE_PREFIX.length))') > -1);
});
