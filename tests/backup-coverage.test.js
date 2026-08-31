'use strict';

/**
 * The "Backup Data (JSON)" button used to export five stores out of nineteen.
 * Ten stores were in neither that file nor the repo sync, so they existed in
 * exactly one place: this browser. Two of them are hand-typed and cannot be
 * regenerated, the 1:1 notes and the mid-year review notes for every associate.
 *
 * These tests pin the round trip: what goes out covers everything, what comes
 * back restores everything, and anything that fails to restore is reported
 * rather than counted as a success.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const PREFIX = 'devCoachingTool_';

// script.js is not a module and loading all of it would duplicate the harness,
// so lift just the two functions under test out of the source.
function loadBackupFunctions() {
    // Checked out with CRLF on Windows; the anchors below are written with \n.
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');

    const collectStart = src.indexOf('function collectAllStoresVerbatim');
    const collectEnd = src.indexOf('\n}\n', collectStart) + 3;
    const applyStart = src.indexOf('const NON_RESTORABLE_STORE_SUFFIXES');
    const applyEnd = src.indexOf('/**\n * Exports all app data', applyStart);

    if (collectStart < 0 || applyStart < 0 || applyEnd < 0) {
        throw new Error('backup functions not found in script.js');
    }

    const body = [
        `const STORAGE_PREFIX = ${JSON.stringify(PREFIX)};`,
        src.slice(collectStart, collectEnd),
        src.slice(applyStart, applyEnd),
        'return { collectAllStoresVerbatim, applyAllStoresVerbatim };'
    ].join('\n');

    // window is now referenced too: the collector falls back to the storage
    // module for stores that no longer live in localStorage. Callers pass a
    // window to control whether that fallback is active.
    return (localStorage, win) => new Function('localStorage', 'window', body)(localStorage, win || { DevCoachModules: {}, DevCoachConstants: {} });
}

// The harness stub has no length or key(i), which is exactly what an
// enumerate-everything backup depends on.
function fakeStorage(seed) {
    const store = Object.assign({}, seed);
    return {
        get length() { return Object.keys(store).length; },
        key(i) { return Object.keys(store)[i] ?? null; },
        getItem(k) { return k in store ? store[k] : null; },
        setItem(k, v) { store[k] = String(v); },
        removeItem(k) { delete store[k]; },
        _store: store
    };
}

const SEED = {
    [PREFIX + 'weeklyData']: '{"2026-08-17|2026-08-23":{"employees":[]}}',
    [PREFIX + 'oneOnOneMeetings']: '{"Alyssa Dimes":[{"notes":"typed by hand"}]}',
    [PREFIX + 'midYearMeta']: '{"Chris Vale":{"status":"on track"}}',
    [PREFIX + 'celebrationsHistory']: '[{"periodKey":"2026-08-17|2026-08-23"}]',
    [PREFIX + 'weeklyFocalPoints']: '{"2026-08-17|2026-08-23":{}}',
    [PREFIX + 'tipUsageHistory']: '{"e1":{"aht":[]}}',
    [PREFIX + 'uiNavState']: '{"tab":"trends"}',
    [PREFIX + 'errorLog']: '[{"msg":"old machine"}]',
    'unrelated-other-app-key': 'not ours'
};

suite('backup: the export covers every store, not a hand-picked five', (t) => {
    // No storage module here: this suite covers the localStorage sweep alone.
    const { collectAllStoresVerbatim } = loadBackupFunctions()(fakeStorage(SEED));
    const out = collectAllStoresVerbatim();

    t.equal('every prefixed store is captured', Object.keys(out).length, 8);
    t.check('another app\'s key is left alone', !('unrelated-other-app-key' in out));

    // The four that had no copy anywhere before this.
    ['oneOnOneMeetings', 'midYearMeta', 'celebrationsHistory', 'weeklyFocalPoints'].forEach((name) => {
        t.check(`${name} is in the backup`, typeof out[PREFIX + name] === 'string');
    });

    t.check('values are the raw stored strings, not reparsed',
        out[PREFIX + 'oneOnOneMeetings'] === SEED[PREFIX + 'oneOnOneMeetings']);
});

suite('backup: a restore brings back everything the export took', (t) => {
    const fns = loadBackupFunctions();
    const source = fakeStorage(SEED);
    const captured = fns(source).collectAllStoresVerbatim();

    const empty = fakeStorage({});
    const report = fns(empty).applyAllStoresVerbatim(captured);

    t.equal('nothing failed to write', report.failed.length, 0);
    t.equal('the restored count matches what was attempted', report.restored, report.total);

    t.check('the hand-typed 1:1 notes come back byte for byte',
        empty._store[PREFIX + 'oneOnOneMeetings'] === SEED[PREFIX + 'oneOnOneMeetings']);
    t.check('so do the mid-year review notes',
        empty._store[PREFIX + 'midYearMeta'] === SEED[PREFIX + 'midYearMeta']);

    // Backed up for completeness, deliberately not restored: they describe the
    // machine and moment they were written on, not the data.
    t.check('another machine\'s view state is not dragged over',
        !(PREFIX + 'uiNavState' in empty._store));
    t.check('nor is its error log', !(PREFIX + 'errorLog' in empty._store));
    t.check('but both were still captured in the file',
        (PREFIX + 'uiNavState' in captured) && (PREFIX + 'errorLog' in captured));
});

suite('backup: a restore that cannot write says so', (t) => {
    const fns = loadBackupFunctions();
    const captured = fns(fakeStorage(SEED)).collectAllStoresVerbatim();

    // Full disk: everything fails except the small stores.
    const target = fakeStorage({});
    const realSet = target.setItem.bind(target);
    target.setItem = (k, v) => {
        if (k === PREFIX + 'oneOnOneMeetings') {
            const err = new Error('quota'); err.name = 'QuotaExceededError'; throw err;
        }
        realSet(k, v);
    };

    const report = fns(target).applyAllStoresVerbatim(captured);

    t.equal('the failure is counted, not swallowed', report.failed.length, 1);
    t.check('and it names the store that is missing',
        report.failed[0].indexOf('oneOnOneMeetings') > -1);
    t.check('and says why', report.failed[0].indexOf('QuotaExceededError') > -1);
    t.check('the successful ones still landed',
        target._store[PREFIX + 'midYearMeta'] === SEED[PREFIX + 'midYearMeta']);
    t.check('restored is less than total, so the caller cannot report success',
        report.restored < report.total);
});
