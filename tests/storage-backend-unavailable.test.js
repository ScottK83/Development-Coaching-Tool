'use strict';

/**
 * Once the bulk stores have moved to IndexedDB, a database that will not open
 * must stop the app from saving, not quietly fall back.
 *
 * The localStorage copies are frozen at the day of the move. Falling back to
 * them put a new upload on top of months-old weeklyData, and the next push sent
 * that over the cloud with nothing to stop it.
 */

const { suite } = require('./harness');
const { createFakeIndexedDB, createFailingIndexedDB } = require('./fake-indexeddb');

const PREFIX = 'devCoachingTool_';
const BULK = ['weeklyData', 'ytdData', 'dailyData', 'coachingHistory'];

function load(t, seed, idb) {
    const browser = t.installFakeBrowser();
    Object.assign(browser.store, seed || {});
    global.window.indexedDB = idb;
    global.window.DevCoachConstants = Object.assign({}, global.window.DevCoachConstants, {
        STORAGE_PREFIX: PREFIX,
        LOCALSTORAGE_MAX_SIZE_MB: 4,
        IDB_DB_NAME: 'devCoachingTool',
        IDB_VERSION: 1,
        IDB_BULK_STORE: 'bulk',
        IDB_ARCHIVE_STORE: 'archive',
        IDB_OPEN_TIMEOUT_MS: 120,
        BULK_STORAGE_KEYS: BULK
    });
    t.loadModule('modules/idb-backend.module.js');
    return t.loadModule('modules/storage.module.js').storage;
}

const OLD_WEEKS = JSON.stringify({ '2026-01-05|2026-01-11': { employees: [], metadata: {} } });

suite('backend: a database that will not open after the move pauses bulk saves', async (t) => {
    const storage = load(t, {
        [PREFIX + 'idbMigrated_v1']: '1',
        [PREFIX + 'weeklyData']: OLD_WEEKS
    }, createFailingIndexedDB());

    const problems = [];
    storage.onBackendProblem((kind, key) => problems.push(kind + ':' + key));

    t.equal('hydrate ends on localStorage', await storage.hydrate(), 'localStorage');
    t.equal('and says the backend is unavailable', storage.isBackendUnavailable(), true);

    t.equal('a save onto the frozen weeklyData is refused',
        storage.saveWithSizeCheck('weeklyData', { newWeek: {} }), false);
    t.check('and reported', problems.indexOf('unavailable:weeklyData') > -1);
    t.equal('a pull cannot write one either', storage.applyRemoteStore('weeklyData', {}), false);
    t.equal('the frozen copy is untouched', global.localStorage.getItem(PREFIX + 'weeklyData'), OLD_WEEKS);

    t.equal('a small setting still saves', storage.saveWithSizeCheck('someSetting', { a: 1 }), true);
});

suite('backend: a browser that never moved is not affected', async (t) => {
    const storage = load(t, { [PREFIX + 'weeklyData']: OLD_WEEKS }, createFailingIndexedDB());
    await storage.hydrate();
    t.equal('it is not marked unavailable', storage.isBackendUnavailable(), false);
    t.equal('and saves as it always did', storage.saveWithSizeCheck('weeklyData', { w: {} }), true);
});

suite('backend: a working database is not affected', async (t) => {
    const storage = load(t, { [PREFIX + 'weeklyData']: OLD_WEEKS }, createFakeIndexedDB());
    t.equal('it moves to the backend', await storage.hydrate(), 'idb');
    t.equal('and is not marked unavailable', storage.isBackendUnavailable(), false);
});

suite('backend: sync stops while the local copy is untrustworthy', async (t) => {
    t.installFakeBrowser();
    global.window.DevCoachConstants = Object.assign({}, global.window.DevCoachConstants, { STORAGE_PREFIX: PREFIX });
    t.loadModule('modules/store-registry.module.js');
    let called = false;
    global.fetch = async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; };
    global.window.DevCoachModules.storage = { isBackendUnavailable: () => true, readStore: () => ({}) };
    global.window.DevCoachModules.repoSync = {
        loadCallListeningSyncConfig: () => ({ endpoint: 'https://sync.example.workers.dev', sharedSecret: 's' })
    };
    const sync = t.loadModule('modules/manifest-sync.module.js').manifestSync;

    const pushed = await sync.push(['weeklyData']);
    t.equal('a push is refused', pushed.code, 'LOCAL_STORE_UNAVAILABLE');
    const pulled = await sync.pull();
    t.equal('so is a pull', pulled.code, 'LOCAL_STORE_UNAVAILABLE');
    t.equal('and nothing reached the network', called, false);

    // A store whose local write failed is fetched again on the next pull.
    global.localStorage.setItem(PREFIX + 'v2SyncState', JSON.stringify({ version: 3, etag: 'e', applied: { weeklyData: 'h1', ytdData: 'h2' } }));
    sync.forgetApplied('weeklyData');
    const state = JSON.parse(global.localStorage.getItem(PREFIX + 'v2SyncState'));
    t.check('forgetApplied drops only that store', !('weeklyData' in state.applied) && state.applied.ytdData === 'h2');
});

suite('backend: a damaged store is kept aside, not saved over', async (t) => {
    const storage = load(t, { [PREFIX + 'someNotes']: '{"broken": ' }, null);

    let threw = false;
    try { storage.readStore('someNotes'); } catch (_) { threw = true; }
    t.check('reading it still fails for the caller', threw);
    t.equal('its text is kept aside', global.localStorage.getItem(PREFIX + 'quarantine_someNotes'), '{"broken": ');
    t.check('and it is listed as unreadable', storage.unreadableStoreNames().indexOf('someNotes') > -1);

    t.equal('a save of the empty store the page rebuilt is refused', storage.saveWithSizeCheck('someNotes', {}), false);
    t.equal('the damaged text is still in place', global.localStorage.getItem(PREFIX + 'someNotes'), '{"broken": ');

    t.check('a copy from the cloud repairs it', storage.applyRemoteStore('someNotes', { fixed: true }));
    t.equal('after which it is no longer unreadable', storage.unreadableStoreNames().length, 0);
});
