'use strict';

/**
 * Four things break silently the moment the bulk stores stop living in
 * localStorage. Each one fails in a way nobody would notice for weeks, which
 * is why they are pinned here before the switch is thrown rather than after.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');
const { createFakeIndexedDB } = require('./fake-indexeddb');

const PREFIX = 'devCoachingTool_';
const BULK = [
    'weeklyData', 'ytdData', 'dailyData', 'coachingHistory', 'callListeningLogs',
    'associateSentimentSnapshots', 'sentimentPhraseDatabase', 'reliabilityTracker',
    'ptoTracker', 'tipUsageHistory', 'followUpHistory', 'hotTipHistory'
];

function load(t, seed) {
    const browser = t.installFakeBrowser();
    Object.assign(browser.store, seed || {});
    global.window.indexedDB = createFakeIndexedDB();
    global.window.DevCoachConstants = Object.assign({}, global.window.DevCoachConstants, {
        STORAGE_PREFIX: PREFIX,
        SENTIMENT_PHRASE_DB_STORAGE_KEY: 'sentimentPhraseDatabase',
        ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY: 'associateSentimentSnapshots',
        LOCALSTORAGE_MAX_SIZE_MB: 4,
        IDB_DB_NAME: 'devCoachingTool',
        IDB_VERSION: 1,
        IDB_BULK_STORE: 'bulk',
        IDB_ARCHIVE_STORE: 'archive',
        IDB_OPEN_TIMEOUT_MS: 120,
        BULK_STORAGE_KEYS: BULK
    });
    t.loadModule('modules/idb-backend.module.js');
    const modules = t.loadModule('modules/storage.module.js');
    return { storage: modules.storage, store: browser.store };
}

suite('switch-on: a bulk write still triggers the backup', async (t) => {
    const { storage } = load(t, {});
    await storage.hydrate();

    // The app's only auto-sync trigger is a patch on Storage.prototype.setItem.
    // A write that goes to IndexedDB never touches it, so without an explicit
    // notification the GitHub backup silently stops updating for exactly the
    // data worth backing up.
    const notified = [];
    global.window.DevCoachModules.repoSync = {
        notifyBulkStoreWrite: (key) => notified.push(key)
    };

    storage.saveWeeklyData({ 'a-week': { employees: [] } });
    t.equal('saving a bulk store notifies the sync', notified.length, 1);
    t.equal('and names the store', notified[0], 'weeklyData');

    storage.saveTeamMembers({ 'Alyssa Dimes': true });
    t.equal('a non-bulk store does not, since setItem still covers it',
        notified.length, 1);
});

suite('switch-on: the backup payload reads the backend, not a stale copy', async (t) => {
    const { storage, store } = load(t, {
        [PREFIX + 'dailyData']: JSON.stringify({ 'stale-day': {} })
    });
    await storage.hydrate();

    // Write through the module, leaving the localStorage copy behind.
    storage.saveDailyData({ 'current-day': {} });

    const modules = t.loadModule('modules/repo-sync.module.js');
    const carried = modules.repoSync.collectVerbatimStores();

    t.check('dailyData is still carried once it lives in the backend',
        typeof carried.dailyData === 'string');
    t.check('and it carries the current value, not the stale localStorage one',
        JSON.parse(carried.dailyData)['current-day'] !== undefined);
    t.check('the stale copy really was still sitting there',
        store[PREFIX + 'dailyData'].indexOf('stale-day') > -1);

    // tipUsageHistory is the other bulk store with no explicit payload field.
    storage.saveTipUsageHistory({ e1: { aht: [] } });
    t.check('tipUsageHistory is carried too',
        typeof modules.repoSync.collectVerbatimStores().tipUsageHistory === 'string');
});

suite('switch-on: a restore puts bulk stores where they are actually read', async (t) => {
    const { storage, store } = load(t, {});
    await storage.hydrate();

    const modules = t.loadModule('modules/repo-sync.module.js');
    const failures = modules.repoSync.applyVerbatimStores({
        dailyData: JSON.stringify({ 'restored-day': {} })
    });

    t.equal('nothing failed', failures.length, 0);
    t.check('the store reads back through the module',
        storage.loadDailyData()['restored-day'] !== undefined);
    t.check('and it did not land in localStorage where nothing would read it',
        store[PREFIX + 'dailyData'] === undefined);
});

suite('switch-on: delete-all clears the backend before the localStorage sweep', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('async function handleDeleteAllDataClick');
    t.check('the handler is there', start > -1);

    const body = src.slice(start, start + 4000);
    const clearsIdb = body.indexOf('idb.clear()');
    const sweepsLocalStorage = body.indexOf('keysToRemove.forEach');

    t.check('it clears IndexedDB', clearsIdb > -1);
    t.check('it sweeps localStorage', sweepsLocalStorage > -1);
    // Order is the whole point. The other way round leaves "half deleted", and
    // the next boot re-hydrates what the user just deleted.
    t.check('and the backend goes first, so a failure means nothing was deleted',
        clearsIdb < sweepsLocalStorage);
    t.check('a failed clear aborts rather than continuing',
        body.slice(clearsIdb, sweepsLocalStorage).indexOf('return;') > -1);
});

suite('switch-on: the loader hydrates between the modules and the app', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');

    const idbPos = html.indexOf("'modules/idb-backend.module.js'");
    const storagePos = html.indexOf("'modules/storage.module.js'");
    t.check('the backend module is in the manifest', idbPos > -1);
    t.check('and loads before the storage module that hydrates from it',
        idbPos < storagePos);

    // script.js reads bulk stores at parse time, so hydrate has to finish
    // before it loads. Loading everything and hydrating afterwards would leave
    // those top-level reads seeing an unhydrated cache.
    const splitPos = html.indexOf('var mainIndex = scripts.indexOf');
    const hydratePos = html.indexOf('storage.hydrate()');
    const appLoadPos = html.indexOf('loadInOrder(appScripts)');
    t.check('the manifest is split at script.js', splitPos > -1);
    t.check('hydrate runs after the modules load', hydratePos > splitPos);
    t.check('and before script.js is loaded', hydratePos < appLoadPos);

    // A backend failure must not cost the user their app.
    const tail = html.slice(hydratePos, hydratePos + 900);
    t.check('a hydrate failure is caught rather than breaking boot',
        tail.indexOf('.catch(') > -1);
    t.check('and says it is continuing on localStorage',
        /continuing on localStorage/.test(tail));
});

suite('reclaim: only a verified copy is deleted', async (t) => {
    const { storage, store } = load(t, {
        [PREFIX + 'weeklyData']: JSON.stringify({ w1: {}, w2: {} }),
        [PREFIX + 'ptoTracker']: JSON.stringify({ associates: {} })
    });
    await storage.hydrate();

    const before = store[PREFIX + 'weeklyData'];
    t.check('the localStorage copy exists before reclaiming', typeof before === 'string');

    const report = await storage.reclaimLocalStorageCopies();

    t.check('the spare copy is gone', store[PREFIX + 'weeklyData'] === undefined);
    t.check('and the space is reported', report.freedBytes > 0);
    t.check('weeklyData is named as reclaimed', report.reclaimed.indexOf('weeklyData') > -1);

    // The data itself must be untouched. Deleting the copy is the whole point;
    // deleting the data is the failure this guards.
    t.equal('the data still reads back in full', Object.keys(storage.loadWeeklyData()).length, 2);
});

suite('reclaim: a copy the backend cannot confirm is kept', async (t) => {
    const { storage, store } = load(t, {
        [PREFIX + 'weeklyData']: JSON.stringify({ w1: {} })
    });
    await storage.hydrate();

    // Someone wrote more weeks to localStorage than the backend ever saw. The
    // counts disagree, so this copy is the one that might hold something the
    // backend does not, and deleting it is exactly the wrong move.
    store[PREFIX + 'weeklyData'] = JSON.stringify({ w1: {}, w2: {}, w3: {} });

    const report = await storage.reclaimLocalStorageCopies();

    t.check('the unverifiable copy is still there', typeof store[PREFIX + 'weeklyData'] === 'string');
    t.check('it is not counted as reclaimed', report.reclaimed.indexOf('weeklyData') === -1);
    t.check('and the mismatch is reported rather than swallowed',
        report.skipped.some(s => s.indexOf('weeklyData') > -1));
});

suite('reclaim: it refuses to run while still on localStorage', async (t) => {
    const { storage, store } = load(t, {
        [PREFIX + 'weeklyData']: JSON.stringify({ w1: {} })
    });
    // No hydrate: there is no second copy, so deleting would destroy the only one.
    const report = await storage.reclaimLocalStorageCopies();

    t.equal('nothing is freed', report.freedBytes, 0);
    t.equal('nothing is deleted', report.reclaimed.length, 0);
    t.check('the only copy is untouched', typeof store[PREFIX + 'weeklyData'] === 'string');
});

suite('restore: a repo restore lands where the app actually reads', async (t) => {
    const { storage, store } = load(t, {});
    await storage.hydrate();

    // applyRepoBackupPayload alerts on write failures. Stubbed so a regression
    // here fails on the assertion below rather than crashing on a missing alert.
    const alerts = [];
    global.alert = (m) => alerts.push(String(m));

    const modules = t.loadModule('modules/repo-sync.module.js');

    // The exact shape of a repo restore: full payload, written through
    // safeSaveToStorage. Before this was routed, it went to localStorage with a
    // raw setItem while the app read IndexedDB, so a restore reported success
    // and the app still showed nothing.
    modules.repoSync.applyRepoBackupPayload({
        weeklyData: { w1: { employees: [] }, w2: { employees: [] } },
        ytdData: { '2026': { employees: [] } },
        coachingHistory: { 'Alyssa Dimes': [] }
    });

    t.equal('the restored weeks read back through the module',
        Object.keys(storage.loadWeeklyData()).length, 2);
    t.equal('and so does YTD', Object.keys(storage.loadYtdData()).length, 1);
    t.check('the bulk store did not land in localStorage where nothing reads it',
        store[PREFIX + 'weeklyData'] === undefined);
    t.equal('and the restore reported no write failures', alerts.length, 0);

    // A non-bulk store still belongs in localStorage.
    modules.repoSync.applyRepoBackupPayload({ myTeamMembers: { 'Chris Vale': true } });
    t.check('a non-bulk store still goes to localStorage',
        store[PREFIX + 'myTeamMembers'] !== undefined);
});
