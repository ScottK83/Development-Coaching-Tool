'use strict';

/**
 * The read chokepoint, applied to the storage module itself.
 *
 * read-chokepoint.test.js states the rule and the reason: a store whose write
 * is routed but whose read is not goes permanently stale the moment its backend
 * changes. The write lands in IndexedDB, the read keeps looking at a
 * localStorage copy that stopped being updated, nothing errors, and the value
 * is simply wrong.
 *
 * That test then exempts `modules/storage.module.js` wholesale, because the
 * module legitimately contains two kinds of raw read: readStore's own
 * localStorage fallback, and the migration read that decides what to copy
 * across. The exemption is the right shape and too wide. It also covers the
 * module's ordinary public loaders, and two of them were reading raw for bulk
 * stores whose writes went to the backend.
 *
 * So this file asserts the behaviour instead of the syntax: for every bulk
 * store the module exposes a load/save pair for, a value written through the
 * module has to come back from the module on the IndexedDB backend. That holds
 * whatever the read is implemented with, and it cannot be satisfied by a raw
 * read of a copy the writes no longer reach.
 */

const { suite } = require('./harness');
const { createFakeIndexedDB } = require('./fake-indexeddb');

const PREFIX = 'devCoachingTool_';

// Every bulk store this module exposes as a load*/save* pair, with a value
// shaped the way the real store is shaped.
const ROUND_TRIPS = [
    {
        name: 'myTeamMembers',
        load: 'loadTeamMembers',
        save: 'saveTeamMembers',
        value: { '2026-08-17|2026-08-23': ['Alyssa Dimes', 'Chris Vale'] },
        read: (v) => (v['2026-08-17|2026-08-23'] || []).join(',')
    },
    {
        name: 'coachingTips',
        load: 'loadUserTips',
        save: 'saveUserTips',
        value: [{ id: 't1', metric: 'aht', text: 'a tip the operator typed' }],
        read: (v) => (Array.isArray(v) && v[0] ? v[0].text : '')
    },
    {
        name: 'callCenterAverages',
        load: 'loadCallCenterAverages',
        save: 'saveCallCenterAverages',
        value: { '2026-08-17|2026-08-23': { aht: 412 } },
        read: (v) => String((v['2026-08-17|2026-08-23'] || {}).aht)
    },
    {
        name: 'callListeningLogs',
        load: 'loadCallListeningLogs',
        save: 'saveCallListeningLogs',
        value: { 'Alyssa Dimes': [{ id: 'c1', transcript: 'kept verbatim' }] },
        read: (v) => ((v['Alyssa Dimes'] || [])[0] || {}).transcript || ''
    },
    {
        name: 'coachingHistory',
        load: 'loadCoachingHistory',
        save: 'saveCoachingHistory',
        value: { 'Alyssa Dimes': [{ generatedAt: '2026-08-18T00:00:00.000Z' }] },
        read: (v) => ((v['Alyssa Dimes'] || [])[0] || {}).generatedAt || ''
    },
    {
        name: 'ptoTracker',
        load: 'loadPtoTracker',
        save: 'savePtoTracker',
        value: { associates: { 'Chris Vale': { hours: 8 } } },
        read: (v) => String(((v.associates || {})['Chris Vale'] || {}).hours)
    },
    {
        name: 'tipUsageHistory',
        load: 'loadTipUsageHistory',
        save: 'saveTipUsageHistory',
        value: { 'Alyssa Dimes': [{ tip: 'used once', usedAt: '2026-08-18' }] },
        read: (v) => ((v['Alyssa Dimes'] || [])[0] || {}).tip || ''
    }
];

const BULK = ROUND_TRIPS.map((r) => r.name).concat([
    'weeklyData', 'ytdData', 'dailyData', 'associateSentimentSnapshots',
    'sentimentPhraseDatabase', 'reliabilityTracker', 'followUpHistory', 'hotTipHistory'
]);

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

suite('chokepoint: a bulk store written through the module reads back from it', async (t) => {
    for (const spec of ROUND_TRIPS) {
        const { storage } = load(t, {});
        t.equal(`${spec.name}: the backend is in use`, await storage.hydrate(), 'idb');

        const saver = storage[spec.save];
        const loader = storage[spec.load];
        if (typeof saver !== 'function' || typeof loader !== 'function') {
            t.check(`${spec.name}: has a load/save pair`, false);
            continue;
        }

        saver(spec.value);
        t.equal(`${spec.name} survives the round trip`,
            spec.read(loader()), spec.read(spec.value));
    }
});

suite('chokepoint: reclaiming the localStorage copy does not take the store with it', async (t) => {
    // The second half, and the one that actually loses data. Once a store has
    // been copied across, reclaimLocalStorageCopies is entitled to delete the
    // localStorage copy to free the quota it was moved to escape. Any loader
    // still reading that copy returns empty from then on, and the operator's
    // team selection or typed tips are simply gone on the next reload.
    for (const spec of ROUND_TRIPS) {
        const { storage, store } = load(t, {
            [PREFIX + spec.name]: JSON.stringify(spec.value)
        });
        await storage.hydrate();

        const report = await storage.reclaimLocalStorageCopies();
        const wasReclaimed = (report.reclaimed || []).indexOf(spec.name) > -1;
        t.check(`${spec.name}: the localStorage copy is reclaimed`, wasReclaimed);
        t.check(`${spec.name}: and localStorage really is empty of it`,
            store[PREFIX + spec.name] === undefined);

        t.equal(`${spec.name}: the value is still readable afterwards`,
            spec.read(storage[spec.load]()), spec.read(spec.value));
    }
});
