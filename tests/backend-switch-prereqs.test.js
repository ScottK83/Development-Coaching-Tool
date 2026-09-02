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

suite('backup: the export file covers stores that no longer live in localStorage', async (t) => {
    const { storage, store } = load(t, {
        [PREFIX + 'weeklyData']: JSON.stringify({ w1: {} }),
        [PREFIX + 'coachingHistory']: JSON.stringify({ 'Alyssa Dimes': [{ note: 'kept' }] }),
        [PREFIX + 'employeeSupervisors']: JSON.stringify({ 'Dana Roe': 'Scott' })
    });
    await storage.hydrate();

    // The state the reclaim produces, and the state this file is the last copy
    // of. A localStorage-only sweep sees nothing here.
    await storage.reclaimLocalStorageCopies();
    t.check('the localStorage copies really are gone',
        store[PREFIX + 'coachingHistory'] === undefined);

    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('function collectAllStoresVerbatim');
    const body = src.slice(start, src.indexOf('\n}\n', start));

    t.check('the collector falls back to the storage module for bulk stores',
        body.indexOf('readStore') > -1);
    t.check('and drives that from BULK_STORAGE_KEYS rather than a hand list',
        body.indexOf('BULK_STORAGE_KEYS') > -1);

    // Run the real thing against this exact post-reclaim state.
    const collect = new Function('localStorage', 'window', `
        const STORAGE_PREFIX = ${JSON.stringify(PREFIX)};
        ${src.slice(start, src.indexOf('\n}\n', start) + 3)}
        return collectAllStoresVerbatim();
    `);
    const captured = collect(global.localStorage, global.window);

    t.check('coachingHistory is in the backup despite having no localStorage copy',
        typeof captured[PREFIX + 'coachingHistory'] === 'string');
    t.equal('and it is the real data, not an empty shell',
        JSON.parse(captured[PREFIX + 'coachingHistory'])['Alyssa Dimes'][0].note, 'kept');
    t.check('a non-bulk store is still swept from localStorage',
        typeof captured[PREFIX + 'employeeSupervisors'] === 'string');
});

suite('dirty: an unchanged store is not rewritten', async (t) => {
    const { storage } = load(t, {
        [PREFIX + 'weeklyData']: JSON.stringify({ w1: {} }),
        [PREFIX + 'ytdData']: JSON.stringify({ '2026': {} })
    });
    await storage.hydrate();

    t.check('nothing is dirty after a plain load', !storage.isStoreDirty('weeklyData'));
    t.check('nor is ytdData', !storage.isStoreDirty('ytdData'));

    storage.saveWeeklyData({ w1: {}, w2: {} });

    t.check('the store that was written is dirty', storage.isStoreDirty('weeklyData'));
    t.check('the one that was not is still clean', !storage.isStoreDirty('ytdData'));

    storage.clearDirtyStores();
    t.check('and the set can be reset', !storage.isStoreDirty('weeklyData'));
});

suite('dirty: the leave-page handler only saves what changed', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('function saveEverythingBeforeLeaving');
    const body = src.slice(start, src.indexOf('\n    }\n', start));

    // Wired to visibilitychange as well as beforeunload, so this runs on every
    // alt-tab. Unconditional saves here are how one machine overwrites another.
    t.check('it consults the dirty set', body.indexOf('isStoreDirty') > -1);

    // Skip past the declaration, which otherwise matches the save-call pattern.
    const calls = body.slice(body.indexOf('\n'));
    const saves = (calls.match(/save[A-Z]\w+\(\)/g) || []);
    const guarded = (calls.match(/if \(changed\('[a-zA-Z]+'\)\) save/g) || []);
    t.equal('every save call is guarded', guarded.length, saves.length);
    t.equal('and all seven are still there', saves.length, 7);

    // Losing a save is worse than an extra one, so no dirty tracking must mean
    // save everything, not save nothing.
    t.check('it falls back to saving when dirty tracking is unavailable',
        /typeof dirty === 'function' \? dirty\(key\) : true/.test(body));
});

suite('worker: the payload keeps what the client actually sends', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'cloudflare-sync-worker/index.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('const fullBackupPayload = {');
    const literal = src.slice(start, src.indexOf('};', start));

    // The client sends these on every push. The worker rebuilt the payload
    // field by field and dropped them, so they had no remote copy at all.
    ['verbatimStores', 'executiveSummaryNotes', 'userCustomTips', 'yoyBaseline2025'].forEach((field) => {
        t.check(`${field} survives to storage`, literal.indexOf(field) > -1);
    });

    // The catch-all is what covers a store nobody remembered to add here, so it
    // matters most that it is the one that cannot go missing again.
    t.check('verbatimStores reads from the request body',
        /verbatimStores: .*body\?\.verbatimStores/.test(literal));
});

suite('restore: a field the backup does not carry leaves local data alone', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'modules/repo-sync.module.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('const keys = {');
    const block = src.slice(start, src.indexOf('};', start));

    // coerceObject turns an absent field into {} and the write loop then puts
    // that empty object over live data. Nullable makes the loop skip it.
    ['executiveSummaryNotes', 'userCustomTips', 'yoyBaseline2025'].forEach((field) => {
        const line = block.split('\n').find(l => l.trim().startsWith(field + ':')) || '';
        t.check(`${field} is skipped when absent rather than emptied`,
            line.indexOf('coerceNullableObject') > -1);
    });
});

suite('dirty: the change listener fires for the module\'s OWN writes too', async (t) => {
    const { storage } = load(t, {});
    await storage.hydrate();

    const seen = [];
    storage.onStoreChanged((key) => seen.push(key));

    // An external caller, the shape tips and team members use.
    storage.saveWithSizeCheck('userCustomTips', [{ tip: 'x' }]);
    t.check('an external write notifies', seen.indexOf('userCustomTips') > -1);

    // An internal caller. saveWeeklyData calls the module's LOCAL closure, so a
    // wrapper around the export would never see this one, and half the writes
    // would silently never push.
    storage.saveWeeklyData({ w1: {} });
    t.check('a write from inside the module notifies as well',
        seen.indexOf('weeklyData') > -1);

    storage.saveCoachingHistory({ 'Alyssa Dimes': [] });
    t.check('and so does another internal saver',
        seen.indexOf('coachingHistory') > -1);

    // A listener that throws must not take the save down with it.
    storage.onStoreChanged(() => { throw new Error('listener blew up'); });
    t.equal('a throwing listener does not break the write',
        storage.saveWeeklyData({ w2: {} }), true);
});

suite('dirty: the cloud push subscribes rather than wrapping the export', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('function startCloudSyncBackground');
    const body = src.slice(start, src.indexOf('\nfunction setCloudSyncResult', start));

    t.check('it subscribes through onStoreChanged', body.indexOf('onStoreChanged') > -1);
    // Wrapping the export misses every write the module makes internally.
    t.check('it does not reassign saveWithSizeCheck',
        body.indexOf('storage.saveWithSizeCheck =') === -1);
    t.check('and it says so when the hook is unavailable',
        /will not auto-push/.test(body));
});

suite('reclaim: a backend that has moved on still lets the stale copy go', async (t) => {
    const { storage, store } = load(t, {
        [PREFIX + 'weeklyData']: JSON.stringify({ w1: {}, w2: {} })
    });
    await storage.hydrate();

    // The real state after a migration: the localStorage copy froze at the
    // moment it was made, and every write since went to the backend alone. The
    // counts diverge immediately and never converge, so requiring them to be
    // equal blocks the reclaim permanently, which is how the space stayed
    // occupied for a full day.
    storage.saveWeeklyData({ w1: {}, w2: {}, w3: {}, w4: {} });

    const report = await storage.reclaimLocalStorageCopies();

    t.check('the stale copy is reclaimed', report.reclaimed.indexOf('weeklyData') > -1);
    t.check('and the space is freed', report.freedBytes > 0);
    t.check('the localStorage copy is gone', store[PREFIX + 'weeklyData'] === undefined);
    t.equal('while the backend keeps every period', Object.keys(storage.loadWeeklyData()).length, 4);
});

suite('reclaim: a backend holding LESS than the copy still refuses', async (t) => {
    const { storage, store } = load(t, {
        [PREFIX + 'weeklyData']: JSON.stringify({ w1: {} })
    });
    await storage.hydrate();

    // Fewer entries in the backend means the read came back partial or empty.
    // Deleting against that is precisely the loss this guard exists to stop, so
    // relaxing equality to "at least" must not relax this direction.
    store[PREFIX + 'weeklyData'] = JSON.stringify({ w1: {}, w2: {}, w3: {} });

    const report = await storage.reclaimLocalStorageCopies();

    t.check('nothing is reclaimed', report.reclaimed.indexOf('weeklyData') === -1);
    t.check('the copy is still there', typeof store[PREFIX + 'weeklyData'] === 'string');
    t.check('and the mismatch is reported',
        report.skipped.some((s) => s.indexOf('weeklyData') > -1));
});
