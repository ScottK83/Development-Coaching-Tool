'use strict';

/**
 * Ten stores appeared nowhere in the repo sync payload, so the GitHub/R2 mirror
 * was never a full copy. appStorageSnapshot looked like coverage but records
 * only {valueType, itemCount, byteLength}. verbatimStores is the actual carrier.
 *
 * The rule these tests pin: anything under the prefix is either carried by an
 * explicit payload field or by verbatimStores. Nothing falls between the two.
 */

const { suite } = require('./harness');

const PREFIX = 'devCoachingTool_';

// The harness stub has no length or key(i), and repo-sync bails out of its
// hooks without window.Storage. Build both.
function installStorageBrowser(seed) {
    const store = Object.assign({}, seed);
    global.localStorage = {
        get length() { return Object.keys(store).length; },
        key(i) { return Object.keys(store)[i] ?? null; },
        getItem(k) { return k in store ? store[k] : null; },
        setItem(k, v) { store[k] = String(v); },
        removeItem(k) { delete store[k]; },
        _store: store
    };
    return store;
}

function load(t, seed) {
    t.installFakeBrowser();
    const store = installStorageBrowser(seed);
    global.window.localStorage = global.localStorage;
    global.Storage = class { };
    global.Storage.prototype.setItem = function () { };
    const modules = t.loadModule('modules/repo-sync.module.js');
    return { sync: modules.repoSync, store };
}

const SEED = {
    // Carried by explicit payload fields already.
    [PREFIX + 'weeklyData']: '{"2026-08-17|2026-08-23":{}}',
    [PREFIX + 'ptoTracker']: '{"associates":{}}',
    // The ones that had no remote copy at all.
    [PREFIX + 'oneOnOneMeetings']: '{"Alyssa Dimes":[{"notes":"hand typed"}]}',
    [PREFIX + 'midYearMeta']: '{"Chris Vale":{"status":"on track"}}',
    [PREFIX + 'celebrationsHistory']: '[{"periodKey":"k"}]',
    [PREFIX + 'weeklyFocalPoints']: '{"k":{}}',
    [PREFIX + 'tipUsageHistory']: '{"e1":{}}',
    [PREFIX + 'employeeSupervisors']: '{"Dana Roe":"Scott"}',
    [PREFIX + 'dailyData']: '{"2026-08-30":{}}',
    // Machine-and-moment bookkeeping.
    [PREFIX + 'uiNavState']: '{"tab":"trends"}',
    [PREFIX + 'repoSyncLastSuccess']: '{"syncedAt":"2026-08-30T00:00:00Z"}',
    'someone-elses-key': 'not ours'
};

suite('sync: the stores with no remote copy are carried now', (t) => {
    const { sync } = load(t, SEED);
    const carried = sync.collectVerbatimStores();

    ['oneOnOneMeetings', 'midYearMeta', 'celebrationsHistory', 'weeklyFocalPoints',
        'tipUsageHistory', 'employeeSupervisors'].forEach((name) => {
        t.check(`${name} is carried`, typeof carried[name] === 'string');
    });

    t.check('the raw string is carried, not a summary',
        carried.oneOnOneMeetings === SEED[PREFIX + 'oneOnOneMeetings']);

    // Ephemeral and deliberately not a sync trigger, but it still gets a copy.
    t.check('dailyData rides along even though it never triggers a push',
        typeof carried.dailyData === 'string');
});

suite('sync: what is already carried explicitly is not carried twice', (t) => {
    const { sync } = load(t, SEED);
    const carried = sync.collectVerbatimStores();

    t.check('weeklyData is left to its own payload field', !('weeklyData' in carried));
    t.check('so is ptoTracker', !('ptoTracker' in carried));
    t.check('another app\'s key is ignored', !('someone-elses-key' in carried));
});

suite('sync: one machine\'s bookkeeping does not travel to another', (t) => {
    const { sync } = load(t, SEED);
    const carried = sync.collectVerbatimStores();

    t.check('view state is not synced', !('uiNavState' in carried));
    t.check('nor is the last-sync timestamp', !('repoSyncLastSuccess' in carried));
});

suite('sync: restoring writes them back, and reports what would not write', (t) => {
    const { sync } = load(t, SEED);
    const carried = sync.collectVerbatimStores();

    const target = load(t, {});
    const failures = target.sync.applyVerbatimStores(carried);

    t.equal('nothing failed on an empty store', failures.length, 0);
    t.check('the hand-typed 1:1 notes are back',
        target.store[PREFIX + 'oneOnOneMeetings'] === SEED[PREFIX + 'oneOnOneMeetings']);
    t.check('and the mid-year review notes',
        target.store[PREFIX + 'midYearMeta'] === SEED[PREFIX + 'midYearMeta']);

    // A full disk must be named, not counted as restored.
    const full = load(t, {});
    global.localStorage.setItem = () => {
        const err = new Error('quota'); err.name = 'QuotaExceededError'; throw err;
    };
    const fullFailures = full.sync.applyVerbatimStores({ oneOnOneMeetings: '{"a":1}' });
    t.equal('a failed write is reported', fullFailures.length, 1);
    t.check('and names the store', fullFailures[0].indexOf('oneOnOneMeetings') > -1);
});
