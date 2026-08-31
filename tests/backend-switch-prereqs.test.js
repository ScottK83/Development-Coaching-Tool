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
