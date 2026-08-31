'use strict';

/**
 * Client and worker together, two simulated machines against one bucket.
 *
 * This is the scenario the whole project exists for, and the one today's
 * whole-blob sync gets wrong: the work PC and the home PC both edit, neither
 * pulls first, and both push. Today one of them silently loses a day's work.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');
const { createFakeR2, loadWorker, post } = require('./fake-r2');

const PREFIX = 'devCoachingTool_';
const worker = loadWorker(ROOT, path, fs);

/**
 * A machine: its own localStorage, its own module instances, wired to a shared
 * bucket through a fetch that runs the real worker.
 */
function machine(t, bucket, deviceSeed) {
    const browser = t.installFakeBrowser();

    global.window.DevCoachConstants = Object.assign({}, global.window.DevCoachConstants, {
        STORAGE_PREFIX: PREFIX
    });
    // global.crypto is already the WebCrypto object in this Node, and is
    // read-only, so it is used as-is rather than installed.

    global.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        const response = await worker.fetch(post(body), {
            COACHING_BUCKET: bucket,
            ALLOWED_ORIGIN: 'https://development-coaching-tool.pages.dev'
        });
        const text = await response.text();
        return { ok: response.status === 200, status: response.status, json: async () => JSON.parse(text) };
    };

    t.loadModule('modules/store-registry.module.js');

    // A minimal storage module stand-in: this suite is about the sync protocol,
    // not about which backend a store lands in.
    const values = {};
    global.window.DevCoachModules.storage = {
        readStore: (name) => values[name],
        saveWithSizeCheck: (name, value) => { values[name] = value; return true; }
    };
    global.window.DevCoachModules.repoSync = {
        loadCallListeningSyncConfig: () => ({ endpoint: 'https://sync.example.workers.dev', sharedSecret: 's' })
    };

    browser.store[PREFIX + 'v2DeviceId'] = deviceSeed;

    const raw = t.loadModule('modules/manifest-sync.module.js').manifestSync;

    // Each machine must have its OWN globals. installFakeBrowser replaces
    // global.window and global.localStorage, so without this the second machine
    // silently takes over the first machine's storage and every cross-machine
    // assertion becomes meaningless: both "machines" would share one etag and
    // never conflict.
    const owned = { window: global.window, localStorage: global.localStorage, fetch: global.fetch };
    const activate = () => Object.assign(global, owned);

    const sync = {};
    Object.keys(raw).forEach((name) => {
        sync[name] = (...args) => { activate(); return raw[name](...args); };
    });

    return { sync, values, store: browser.store, activate };
}

suite('two machines: different stores, neither pulls, both survive', async (t) => {
    const bucket = createFakeR2();

    const work = machine(t, bucket, 'workpc');
    work.values.weeklyData = { w1: { employees: [] } };
    work.values.ptoTracker = { associates: {} };
    const created = await work.sync.createFirstManifest(['weeklyData', 'ptoTracker']);
    t.equal('the work PC seeds the first manifest', created.ok, true);

    // Home PC starts from that state.
    const home = machine(t, bucket, 'homepc');
    const pulled = await home.sync.pull();
    t.equal('the home PC pulls it', pulled.ok, true);
    t.equal('and has the weeks', Object.keys(home.values.weeklyData).length, 1);

    // Both edit different stores. Neither pulls first.
    work.values.weeklyData = { w1: {}, w2: { employees: [] } };
    home.values.ptoTracker = { associates: { 'Chris Vale': { hours: 8 } } };

    const workPush = await work.sync.push(['weeklyData'], 'work pc upload');
    t.equal('the work PC pushes', workPush.ok, true);

    const homePush = await home.sync.push(['ptoTracker'], 'home pc pto');
    t.equal('the home PC pushes, rebasing under the hood', homePush.ok, true);
    t.check('and it took more than one attempt', homePush.attempts > 1);

    // The whole point.
    const check = machine(t, bucket, 'third');
    await check.sync.pull();
    t.equal('the work PC weeks survived', Object.keys(check.values.weeklyData).length, 2);
    t.equal('and the home PC PTO survived',
        Object.keys(check.values.ptoTracker.associates).length, 1);
});

suite('two machines: a pull only fetches what actually changed', async (t) => {
    const bucket = createFakeR2();

    const a = machine(t, bucket, 'a');
    a.values.weeklyData = { w1: {} };
    a.values.ptoTracker = { associates: {} };
    await a.sync.createFirstManifest(['weeklyData', 'ptoTracker']);

    const b = machine(t, bucket, 'b');
    await b.sync.pull();

    // Only one store moves.
    a.values.weeklyData = { w1: {}, w2: {} };
    await a.sync.push(['weeklyData']);

    const second = await b.sync.pull();
    t.equal('exactly one shard is fetched', second.updated.length, 1);
    t.equal('and it is the one that moved', second.updated[0], 'weeklyData');

    const third = await b.sync.pull();
    t.equal('a pull with nothing new fetches nothing', third.updated.length, 0);
});

suite('two machines: device-only stores never leave the machine', async (t) => {
    const bucket = createFakeR2();

    const a = machine(t, bucket, 'a');
    a.values.weeklyData = { w1: {} };
    // The sync config holds the shared secret. Pushing it would put the
    // credential inside the backup it authenticates against.
    a.values.callListeningSyncConfig = { sharedSecret: 'super-secret' };
    a.values.uiNavState = { tab: 'trends' };

    await a.sync.createFirstManifest(['weeklyData', 'callListeningSyncConfig', 'uiNavState']);

    const manifest = JSON.parse(bucket._objects.get('state/v2/manifest.json').value);
    t.check('the data store is there', 'weeklyData' in manifest.shards);
    t.check('the secret is not', !('callListeningSyncConfig' in manifest.shards));
    t.check('nor is view state', !('uiNavState' in manifest.shards));

    // And push refuses them too, not just the initial create.
    const pushed = await a.sync.push(['callListeningSyncConfig', 'uiNavState']);
    t.equal('pushing device-only stores is a no-op', pushed.skipped, true);
});

suite('two machines: a wipe on one empties the other rather than resurrecting', async (t) => {
    const bucket = createFakeR2();

    const a = machine(t, bucket, 'a');
    a.values.weeklyData = { w1: {} };
    await a.sync.createFirstManifest(['weeklyData']);

    const b = machine(t, bucket, 'b');
    await b.sync.pull();
    t.equal('b has the data first', Object.keys(b.values.weeklyData).length, 1);

    // The user deletes everything on machine a.
    a.activate();
    await global.fetch('x', { body: JSON.stringify({ mode: 'deleteAll' }) });

    const after = await b.sync.pull();
    t.check('b is told the shard is gone', after.removed.indexOf('weeklyData') > -1);
    t.equal('and that it was a deliberate wipe', after.deletedAll, true);

    // b must not now push its stale local copy back and undo the delete.
    const state = b.sync.loadSyncState();
    t.check('b no longer considers weeklyData applied', !('weeklyData' in state.applied));
});

suite('two machines: creating a manifest is refused once one exists', async (t) => {
    const bucket = createFakeR2();

    const a = machine(t, bucket, 'a');
    a.values.weeklyData = { w1: {}, w2: {}, w3: {} };
    await a.sync.createFirstManifest(['weeklyData']);

    // The dangerous case: a second machine with a stale, smaller copy runs the
    // one-time setup. If it were allowed to seed, it would overwrite everything.
    const b = machine(t, bucket, 'b');
    b.values.weeklyData = { w1: {} };
    const attempt = await b.sync.createFirstManifest(['weeklyData']);

    t.equal('it is refused', attempt.ok, false);
    t.equal('with a clear reason', attempt.code, 'ALREADY_EXISTS');

    const manifest = JSON.parse(bucket._objects.get('state/v2/manifest.json').value);
    t.equal('and the manifest still has the fuller version', manifest.version, 1);

    const check = machine(t, bucket, 'c');
    await check.sync.pull();
    t.equal('with all three weeks intact', Object.keys(check.values.weeklyData).length, 3);
});

suite('two machines: a push with no manifest does not invent one', async (t) => {
    const bucket = createFakeR2();
    const a = machine(t, bucket, 'a');
    a.values.weeklyData = { w1: {} };

    // A transient miss must not become licence to write a whole local view.
    const pushed = await a.sync.push(['weeklyData']);
    t.equal('the push is refused', pushed.ok, false);
    t.equal('and says setup has not run', pushed.code, 'NO_MANIFEST');
    t.check('nothing was committed', !bucket._objects.has('state/v2/manifest.json'));
});

suite('cloud sync: the app wires pull at boot and a trailing push', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('function startCloudSyncBackground');
    const body = src.slice(start, src.indexOf('\nfunction setCloudSyncResult', start));

    t.check('the background sync exists', start > -1);
    t.check('it is started from the app', src.indexOf('startCloudSyncBackground();') > -1);

    // Boot-time writes (a normalization write-back, a seeding migration) are not
    // the user's edits. Pushing them would send this machine's view of stores
    // nobody touched, which is how a machine overwrites another for free.
    const clearPos = body.indexOf('clearDirtyStores');
    const pullPos = body.indexOf('sync.pull()');
    t.check('boot-time dirt is cleared before anything is pushed', clearPos > -1 && clearPos < pullPos);

    // Trailing, not leading: a Verint upload writes the reliability store once
    // per file, one file per associate. A leading edge fires 127 times.
    t.check('the push debounce clears the previous timer', body.indexOf('clearTimeout(_cloudPushTimer)') > -1);
    t.check('and only pushes stores that are dirty', /filter\(\(n\) => storage\?\.isStoreDirty/.test(body));

    // A failed push must leave the work marked dirty, or it is silently dropped.
    t.check('a failed push keeps the stores dirty for a retry',
        /retry on the next change/.test(body));
    t.check('and only clears dirt after a confirmed success',
        body.indexOf('result?.ok && !result.skipped') > -1);

    // Offline is not an error state; it is what the local backend is for.
    t.check('a failed pull is swallowed rather than shown as a failure',
        /catch\(\(\) => \{ \/\* offline is not an error \*\/ \}\)/.test(body));
});

suite('cloud sync: setup refuses to overwrite an existing cloud copy', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('async function handleCloudSyncSetupClick');
    const body = src.slice(start, src.indexOf('\n// ====', start));

    // The dangerous case is the second machine running setup with a stale copy.
    t.check('it handles the already-exists case explicitly',
        body.indexOf('ALREADY_EXISTS') > -1);
    t.check('and tells the user to pull instead of overwriting',
        /Pull changes instead/.test(body));
    t.check('the prompt says it uses THIS machine as the starting point',
        /THIS machine/.test(body));
});
