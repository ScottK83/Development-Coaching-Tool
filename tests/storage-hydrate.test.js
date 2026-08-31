'use strict';

/**
 * The storage module in front of the IndexedDB backend.
 *
 * The property everything else rests on: reads stay synchronous. Roughly sixty
 * call sites across twenty-one modules read these stores from render paths and
 * event handlers that cannot await, so hydrate() has to leave the whole bulk
 * set readable without a promise in sight, and every failure mode has to land
 * back on localStorage rather than on an empty store.
 */

const { suite } = require('./harness');
const { createFakeIndexedDB, createFailingIndexedDB } = require('./fake-indexeddb');

const PREFIX = 'devCoachingTool_';

const BULK = [
    'weeklyData', 'ytdData', 'dailyData', 'coachingHistory', 'callListeningLogs',
    'associateSentimentSnapshots', 'sentimentPhraseDatabase', 'reliabilityTracker',
    'ptoTracker', 'tipUsageHistory', 'followUpHistory', 'hotTipHistory'
];

function load(t, seed, idb) {
    const browser = t.installFakeBrowser();
    Object.assign(browser.store, seed || {});
    global.window.indexedDB = idb;
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
    if (idb !== null) t.loadModule('modules/idb-backend.module.js');
    const modules = t.loadModule('modules/storage.module.js');
    return { storage: modules.storage, store: browser.store };
}

const WEEK = { '2026-08-17|2026-08-23': { employees: [{ name: 'Alyssa Dimes', aht: 400 }], metadata: {} } };

function seeded() {
    return {
        [PREFIX + 'weeklyData']: JSON.stringify(WEEK),
        [PREFIX + 'ytdData']: JSON.stringify({ '2026': { employees: [] } }),
        [PREFIX + 'ptoTracker']: JSON.stringify({ associates: { 'Chris Vale': {} } })
    };
}

suite('hydrate: existing localStorage data moves across and reads back', async (t) => {
    const { storage } = load(t, seeded(), createFakeIndexedDB());

    t.equal('it starts on localStorage', storage.getBackendMode(), 'localStorage');
    t.equal('and hydrate puts it on the backend', await storage.hydrate(), 'idb');

    // The whole point: no await here, and there never can be one.
    const weekly = storage.loadWeeklyData();
    t.equal('the week reads back synchronously', Object.keys(weekly).length, 1);
    t.equal('with its rows', weekly['2026-08-17|2026-08-23'].employees[0].name, 'Alyssa Dimes');
    t.equal('and so does another store', Object.keys(storage.loadPtoTracker().associates).length, 1);
});

suite('hydrate: nothing is deleted, so a rollback costs nothing', async (t) => {
    const seed = seeded();
    const { storage, store } = load(t, seed, createFakeIndexedDB());
    await storage.hydrate();

    t.check('the localStorage copy is still there',
        store[PREFIX + 'weeklyData'] === seed[PREFIX + 'weeklyData']);
    t.check('and a marker records that the copy was verified',
        store[PREFIX + 'idbMigrated_v1'] === '1');
});

suite('hydrate: writes land in the backend and are visible immediately', async (t) => {
    const { storage, store } = load(t, seeded(), createFakeIndexedDB());
    await storage.hydrate();

    const next = { '2026-08-24|2026-08-30': { employees: [{ name: 'Dana Roe' }], metadata: {} } };
    t.equal('the save reports success', storage.saveWeeklyData(next), true);

    // Synchronous read-after-write is what every caller assumes.
    t.equal('the new week is readable at once, with no await',
        Object.keys(storage.loadWeeklyData())[0], '2026-08-24|2026-08-30');

    t.check('and the write did not go to localStorage',
        JSON.parse(store[PREFIX + 'weeklyData'])['2026-08-24|2026-08-30'] === undefined);
});

suite('hydrate: the 4MB per-key cap stops applying to a store on the backend', async (t) => {
    const { storage } = load(t, {}, createFakeIndexedDB());

    // Past the 4MB localStorage per-key cap, using the real 22-field row shape
    // so the size is representative rather than arbitrary.
    const row = (n) => ({
        name: 'Associate Number ' + n, firstName: 'Associate', scheduleAdherence: 96.5,
        cxRepOverall: 91.2, fcr: 88.4, overallExperience: 90.1, overallExperienceTop3: 91.5,
        transfers: 3.25, transfersCount: 12, aht: 400, talkTime: 310, acw: 45, holdTime: 60,
        reliability: 0, overallSentiment: 72.5, positiveWord: 61.3, negativeWord: 12.7,
        managingEmotions: 68.9, surveyTotal: 40, repSurveyTotal: 38, fcrSurveyTotal: 37,
        totalCalls: 512
    });
    const big = {};
    for (let i = 0; i < 110; i += 1) {
        big['2026-week-' + i] = { employees: Array.from({ length: 127 }, (_, n) => row(n)), metadata: {} };
    }

    t.equal('localStorage refuses it', storage.saveWeeklyData(big), false);

    await storage.hydrate();
    t.equal('the backend takes it', storage.saveWeeklyData(big), true);
    t.equal('and reads it back whole', Object.keys(storage.loadWeeklyData()).length, 110);
});

suite('hydrate: every way the backend can be missing lands back on localStorage', async (t) => {
    // No backend module at all.
    const noModule = load(t, seeded(), null);
    t.equal('an absent module stays on localStorage', await noModule.storage.hydrate(), 'localStorage');
    t.equal('and the data still reads', Object.keys(noModule.storage.loadWeeklyData()).length, 1);

    // IndexedDB present but refusing to open.
    const failing = load(t, seeded(), createFailingIndexedDB());
    t.equal('a failed open stays on localStorage', await failing.storage.hydrate(), 'localStorage');
    t.equal('and the data still reads', Object.keys(failing.storage.loadWeeklyData()).length, 1);

    // No IndexedDB in this browser.
    const none = load(t, seeded(), undefined);
    t.equal('a missing IndexedDB stays on localStorage', await none.storage.hydrate(), 'localStorage');
    t.equal('and the data still reads', Object.keys(none.storage.loadWeeklyData()).length, 1);
});

suite('hydrate: an unverifiable copy refuses to switch backends', async (t) => {
    const { storage, store } = load(t, seeded(), createFakeIndexedDB());

    // A store that will not parse must stop the migration rather than move a
    // partial set across. A half-populated backend is what would let
    // hasMeaningfulLocalData see an empty store and restore over live data.
    store[PREFIX + 'coachingHistory'] = '{ this is not json';

    t.equal('it stays on localStorage', await storage.hydrate(), 'localStorage');
    t.check('and no marker is written', store[PREFIX + 'idbMigrated_v1'] === undefined);
    t.equal('the readable stores are untouched', Object.keys(storage.loadWeeklyData()).length, 1);
});

suite('hydrate: a lost marker does not clobber newer backend data', async (t) => {
    const idb = createFakeIndexedDB();
    const seed = seeded();

    const first = load(t, seed, idb);
    await first.storage.hydrate();
    first.storage.saveWeeklyData({ 'written-after-migration': { employees: [] } });
    await new Promise((r) => setTimeout(r, 20));

    // Second boot against the same database, with the stale localStorage copy
    // still present and NO marker: the browser cleared it selectively, or the
    // write failed on a full origin. Trusting the marker alone here would
    // recopy the old localStorage over the newer backend and lose the week
    // written since the move.
    const second = load(t, seed, idb);
    t.check('the marker really is absent', seed[PREFIX + 'idbMigrated_v1'] === undefined);
    t.equal('it still uses the backend', await second.storage.hydrate(), 'idb');
    t.equal('and keeps what the backend holds rather than the stale copy',
        Object.keys(second.storage.loadWeeklyData())[0], 'written-after-migration');
});

suite('hydrate: a fresh profile with data only in localStorage still migrates', async (t) => {
    // The complement of the test above: an empty backend must not be mistaken
    // for "already migrated", or a real first run would never copy anything.
    const { storage, store } = load(t, seeded(), createFakeIndexedDB());
    t.equal('it migrates', await storage.hydrate(), 'idb');
    t.equal('and the seeded week came across', Object.keys(storage.loadWeeklyData()).length, 1);
    t.check('with the marker written', store[PREFIX + 'idbMigrated_v1'] === '1');
});
