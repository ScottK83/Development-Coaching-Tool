'use strict';

/**
 * The registry exists because four hand-maintained lists disagreed, and the
 * gaps between them were not theoretical: the worker discarded ~18 stores from
 * every push for months because it rebuilt the payload field by field and
 * nobody noticed a name was missing.
 *
 * These tests fail when a list drifts from the registry, which is the only way
 * that class of bug comes back.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function loadRegistry(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/store-registry.module.js').storeRegistry;
}

suite('registry: every key is declared exactly once', (t) => {
    const registry = loadRegistry(t);
    const names = registry.STORES.map((s) => s.name);
    const duplicates = names.filter((n, i) => names.indexOf(n) !== i);

    t.equal('no key appears twice', duplicates.join(', ') || '(none)', '(none)');
    t.check('and there are enough of them to be the real list', names.length > 45);

    registry.STORES.forEach((store) => {
        t.check(`${store.name} declares a tier`, ['data', 'device', 'derived'].indexOf(store.tier) > -1);
        t.check(`${store.name} declares a backend`, ['idb', 'local'].indexOf(store.backend) > -1);
    });
});

suite('registry: BULK_STORAGE_KEYS is derived, not a second opinion', (t) => {
    const registry = loadRegistry(t);
    const constants = t.loadModule('modules/constants.module.js');
    const derived = global.window.DevCoachConstants.BULK_STORAGE_KEYS;
    void constants;

    t.equal('the derived list matches the registry',
        derived.slice().sort().join(','), registry.bulkNames().slice().sort().join(','));

    // The fallback exists only for a missing registry, and a fallback that
    // disagrees is worse than none: it would route a different set of stores.
    const src = fs.readFileSync(path.join(ROOT, 'modules/constants.module.js'), 'utf8').replace(/\r\n/g, '\n');
    const fallback = (src.slice(src.indexOf('BULK_STORAGE_KEYS')).match(/'([a-zA-Z0-9_]+)'/g) || [])
        .map((s) => s.replace(/'/g, ''));
    const registryBulk = registry.bulkNames();
    registryBulk.forEach((name) => {
        t.check(`${name} is in the fallback too`, fallback.indexOf(name) > -1);
    });
    t.equal('and the fallback names no extras', fallback.length, registryBulk.length);
});

suite('registry: secrets and view state are never marked for sync', (t) => {
    const registry = loadRegistry(t);

    // This one holds the shared secret. Syncing it would put the credential
    // inside the backup it authenticates against.
    t.equal('the sync config stays on the device',
        registry.tierOf('callListeningSyncConfig'), 'device');
    t.check('and is not in the synced set',
        registry.syncedNames().indexOf('callListeningSyncConfig') === -1);

    ['uiNavState', 'selectedAssociate', 'theme', 'errorLog', 'repoSyncLastSuccess'].forEach((name) => {
        t.check(`${name} is device-only`, registry.tierOf(name) === 'device');
    });

    // Suffixed keys cannot be enumerated, so they are matched by prefix.
    t.equal('a smart default is device-only', registry.tierOf('smartDefault_lastPeriodType'), 'device');
    t.equal('so is a seeding marker', registry.tierOf('supervisorSeeded_v5_migration'), 'device');
});

suite('registry: an unknown key is treated as data', (t) => {
    const registry = loadRegistry(t);

    // Backing up something that did not need it costs a little storage.
    // Skipping something that did costs the data. The default has to be safe.
    t.equal('an unrecognised key is synced', registry.tierOf('somethingAddedLater'), 'data');
    t.equal('and has a merge strategy', registry.mergeStrategyOf('somethingAddedLater'), 'lastWriterWins');
});

suite('registry: the stores that had no remote copy are all marked as data', (t) => {
    const registry = loadRegistry(t);

    // The ten the worker was dropping, including the two that are hand-typed
    // and cannot be regenerated from anything.
    ['oneOnOneMeetings', 'midYearMeta', 'celebrationsHistory', 'weeklyFocalPoints',
        'tipUsageHistory', 'employeeNicknames', 'employeeSupervisors', 'dailyData',
        'complianceLog', 'metricCoachingTips'].forEach((name) => {
        t.equal(`${name} is synced`, registry.tierOf(name), 'data');
    });
});

suite('registry: append-only stores are not marked last-writer-wins', (t) => {
    const registry = loadRegistry(t);

    // These accumulate entries over time. Resolving them by replacement would
    // drop whichever machine's entries lost, which is the loss the merge
    // strategy exists to prevent.
    ['coachingHistory', 'callListeningLogs', 'oneOnOneMeetings', 'celebrationsHistory',
        'followUpHistory', 'hotTipHistory'].forEach((name) => {
        t.equal(`${name} merges by union`, registry.mergeStrategyOf(name), 'unionByEntryHash');
    });
});
