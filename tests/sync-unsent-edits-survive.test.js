'use strict';

/**
 * Unsent edits on this machine survive a pull, a push, and the other machine.
 *
 * Three ways they used to be lost:
 *  - A pull wrote the other machine's copy of a store over edits made here that
 *    had not been pushed yet (offline, or inside the 5 second push debounce).
 *    Pulls run on every tab focus, so this was one alt-tab away.
 *  - A successful push cleared every dirty flag, including a store edited
 *    while the push was on the wire. That edit was never sent.
 *  - Conflict copies (whole stores) were pulled into localStorage on every
 *    other machine until the quota filled.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');
const { createFakeR2, loadWorker, post, TEST_SECRET } = require('./fake-r2');

const PREFIX = 'devCoachingTool_';

function network(bucket) {
    const worker = loadWorker(ROOT, path, fs);
    return async (url, opts) => {
        const response = await worker.fetch(post(JSON.parse(opts.body)), {
            COACHING_BUCKET: bucket,
            ALLOWED_ORIGIN: 'https://development-coaching-tool.pages.dev',
            SYNC_SHARED_SECRET: TEST_SECRET
        });
        const text = await response.text();
        return { ok: response.status === 200, status: response.status, json: async () => JSON.parse(text) };
    };
}

function machine(t, bucket, seed) {
    const browser = t.installFakeBrowser();
    global.window.DevCoachConstants = Object.assign({}, global.window.DevCoachConstants, { STORAGE_PREFIX: PREFIX });
    global.fetch = network(bucket);
    t.loadModule('modules/store-registry.module.js');

    const values = {};
    const dirty = new Set();
    const counts = {};
    const storage = {
        readStore: (name) => values[name],
        // A local edit, as the real saveWithSizeCheck records it.
        edit: (name, value) => { values[name] = value; dirty.add(name); counts[name] = (counts[name] || 0) + 1; },
        saveWithSizeCheck: (name, value) => { storage.edit(name, value); return true; },
        applyRemoteStore: (name, value) => { values[name] = value; dirty.delete(name); return true; },
        isStoreDirty: (name) => dirty.has(name),
        storeWriteCount: (name) => counts[name] || 0,
        clearDirtyStores: function (names, countsAtRead) {
            if (arguments.length === 0) { dirty.clear(); return; }
            if (!Array.isArray(names)) return;
            names.forEach((n) => {
                if (countsAtRead && n in countsAtRead && countsAtRead[n] !== (counts[n] || 0)) return;
                dirty.delete(n);
            });
        }
    };
    global.window.DevCoachModules.storage = storage;
    global.window.DevCoachModules.repoSync = {
        loadCallListeningSyncConfig: () => ({ endpoint: 'https://sync.example.workers.dev', sharedSecret: TEST_SECRET })
    };
    browser.store[PREFIX + 'v2DeviceId'] = seed;
    const raw = t.loadModule('modules/manifest-sync.module.js').manifestSync;
    const owned = { window: global.window, localStorage: global.localStorage, fetch: global.fetch };
    const sync = {};
    Object.keys(raw).forEach((name) => {
        sync[name] = (...args) => { Object.assign(global, owned); return raw[name](...args); };
    });
    return { sync, values, storage, browser, owned };
}

suite('sync: a pull does not overwrite edits this machine has not sent', async (t) => {
    const bucket = createFakeR2();
    const work = machine(t, bucket, 'dev-work');
    const home = machine(t, bucket, 'dev-home');

    // Both start from the same coaching history.
    work.storage.edit('coachingHistory', { a: [{ note: 'shared' }] });
    t.check('the work PC seeds it', (await work.sync.pushDirty('seed')).ok);
    await home.sync.pull();

    // Home writes a note and has not pushed it. Work writes a different one and does.
    home.storage.edit('coachingHistory', { a: [{ note: 'shared' }, { note: 'home note' }] });
    work.storage.edit('coachingHistory', { a: [{ note: 'shared' }, { note: 'work note' }] });
    t.check('the work PC pushes its note', (await work.sync.pushDirty('auto')).ok);

    // Home's tab regains focus and pulls.
    const pulled = await home.sync.pull();
    const notes = (home.values.coachingHistory.a || []).map((n) => n.note);
    t.check('the home note is still here', notes.indexOf('home note') > -1);
    t.check('the work note arrived beside it', notes.indexOf('work note') > -1);
    t.check('because the unsent edit went up first', pulled.prePush && pulled.prePush.ok);

    // And the cloud now holds both, so the work PC gets the home note too.
    await work.sync.pull();
    const workNotes = (work.values.coachingHistory.a || []).map((n) => n.note);
    t.check('the work PC receives the home note', workNotes.indexOf('home note') > -1);
});

suite('sync: a store that could not be sent is left alone by the pull', async (t) => {
    const bucket = createFakeR2();
    const work = machine(t, bucket, 'dev-work');
    const home = machine(t, bucket, 'dev-home');

    work.storage.edit('weeklyData', { w1: { employees: [] } });
    await work.sync.pushDirty('seed');
    await home.sync.pull();

    work.storage.edit('weeklyData', { w1: { employees: [] }, w2: { employees: [] } });
    await work.sync.pushDirty('auto');

    // Home edits, then its push fails (the network is down for writes).
    home.storage.edit('weeklyData', { w1: { employees: [] }, w3: { employees: [] } });
    const realFetch = home.owned.fetch;
    home.owned.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        if (body.mode === 'v2.putBlob') return { ok: false, status: 503, json: async () => ({ error: 'offline' }) };
        return realFetch(url, opts);
    };
    const pulled = await home.sync.pull();
    t.check('the push before the pull failed', pulled.prePush && !pulled.prePush.ok);
    t.check('the store is reported as deferred', pulled.deferred.indexOf('weeklyData') > -1);
    t.check('and the local edit is untouched', !!home.values.weeklyData.w3);
    t.check('it is still waiting to be sent', home.storage.isStoreDirty('weeklyData'));

    // Back online: the next push reconciles instead of overwriting the work PC.
    home.owned.fetch = realFetch;
    const pushed = await home.sync.pushDirty('auto');
    t.check('the retry succeeds', pushed.ok);
    t.check('and it had to reconcile with the other machine', pushed.attempts > 1);
});

suite('sync: a push marks only what it sent, as it was when read', async (t) => {
    const bucket = createFakeR2();
    const home = machine(t, bucket, 'dev-home');

    home.storage.edit('weeklyData', { w1: {} });
    home.storage.edit('coachingHistory', { a: [] });

    // An edit lands while the push is on the wire.
    const realFetch = home.owned.fetch;
    let edited = false;
    home.owned.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        if (body.mode === 'v2.commit' && !edited) {
            edited = true;
            home.storage.edit('coachingHistory', { a: [{ note: 'typed mid-push' }] });
        }
        return realFetch(url, opts);
    };

    t.check('the push succeeds', (await home.sync.pushDirty('auto')).ok);
    t.equal('the store that was sent as read is clean', home.storage.isStoreDirty('weeklyData'), false);
    t.equal('the one edited mid-push is still waiting to be sent', home.storage.isStoreDirty('coachingHistory'), true);
});

suite('sync: conflict copies are never pulled into this machine', async (t) => {
    const bucket = createFakeR2();
    const work = machine(t, bucket, 'dev-work');
    const home = machine(t, bucket, 'dev-home');

    work.storage.edit('weeklyData', { w1: {} });
    await work.sync.pushDirty('seed');
    await home.sync.pull();

    // Both change the same last-writer-wins store; the second push keeps the
    // first as a conflicts/ copy in the cloud.
    work.storage.edit('weeklyData', { w1: {}, w2: {} });
    await work.sync.pushDirty('auto');
    home.browser.store[PREFIX + 'conflicts/old/leftover'] = '{"big":true}';
    home.storage.edit('weeklyData', { w1: {}, w3: {} });
    await home.sync.pushDirty('auto');

    const pulled = await work.sync.pull();
    t.check('the work PC pulls nothing named conflicts/',
        (pulled.updated || []).every((n) => !n.startsWith('conflicts/')));
    t.check('and holds no conflict copy',
        Object.keys(work.values).every((n) => !n.startsWith('conflicts/')));

    // A leftover from before the fix is dropped on the next pull.
    const state = JSON.parse(home.browser.store[PREFIX + 'v2SyncState'] || '{}');
    state.applied = Object.assign({}, state.applied, { 'conflicts/old/leftover': 'x' });
    home.browser.store[PREFIX + 'v2SyncState'] = JSON.stringify(state);
    await home.sync.pull();
    t.check('an old conflict copy on this machine is removed',
        !(PREFIX + 'conflicts/old/leftover' in home.browser.store));
});

suite('sync: an empty browser and a delete elsewhere are handled from the per-store copy', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const restore = src.slice(src.indexOf('async function restoreEmptyBrowserFromCloud'), src.indexOf('async function tryAutoRestoreFromRepoBackupOnEmptyState'));
    t.check('an empty browser is filled from the per-store copy', restore.indexOf('sync.pull({ full: true })') > -1);
    t.check('with boot dirt cleared first, so empty stores are never pushed over it',
        restore.indexOf('clearDirtyStores') > -1 && restore.indexOf('clearDirtyStores') < restore.indexOf('sync.pull('));
    t.check('and only once per tab session', restore.indexOf('emptyBootCloudRestore') > -1);
    const boot = src.slice(src.indexOf('if (!hadLocalDataAtBoot) {'));
    t.check('the whole-state backup is only the fallback',
        boot.indexOf('restoreEmptyBrowserFromCloud()') > -1
        && boot.indexOf('restoreEmptyBrowserFromCloud()') < boot.indexOf('tryAutoRestoreFromRepoBackupOnEmptyState()'));

    const after = src.slice(src.indexOf('function afterCloudPull'), src.indexOf('function showDeletedElsewhereBanner'));
    t.check('a delete on the other computer is offered here', /result\?\.deletedAll[\s\S]{0,80}showDeletedElsewhereBanner\(\)/.test(after));

    const worker = fs.readFileSync(path.join(ROOT, 'cloudflare-sync-worker/index.js'), 'utf8');
    const del = worker.slice(worker.indexOf("mode === 'deleteAll'"), worker.indexOf("mode === 'uploadFile'"));
    t.check('the delete tombstone is written under compare-and-swap', del.indexOf('etagMatches') > -1);
});
