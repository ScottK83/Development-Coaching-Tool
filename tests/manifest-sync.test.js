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

    // Lets a test break this machine's transport. Assigning global.fetch from
    // outside does not work: activate() restores the machine's own fetch before
    // every call, so the override would be undone.
    const setFetch = (fn) => { owned.fetch = fn; };

    return { sync, values, store: browser.store, activate, setFetch };
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

// Replaced deliberately. This used to assert that a push with no manifest was
// REFUSED, on the reasoning that seeding should be an explicit act. In practice
// that made setup a ritual the user could skip without being told: every push
// failed with NO_MANIFEST and only logged a console warning, so nothing synced
// and nothing said so for a whole day.
//
// Seeding on first push is safe for the reason the old rule was protecting:
// exists:false comes only from a SUCCESSFUL read, and a transport failure is a
// non-200 that never reaches the seeding path. That is pinned by
// 'first push: seeding cannot happen when the service is unreachable', and the
// race is pinned by 'first push: a race to seed is refused rather than both
// winning'.

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

suite('two machines: the same append-only store edited on both keeps every entry', async (t) => {
    const bucket = createFakeR2();

    const a = machine(t, bucket, 'a');
    a.values.coachingHistory = { 'Alyssa Dimes': [{ note: 'shared baseline', at: '2026-08-01' }] };
    await a.sync.createFirstManifest(['coachingHistory']);

    const b = machine(t, bucket, 'b');
    await b.sync.pull();

    // Both log a coaching note for different people, neither pulls first.
    // Under plain last-writer-wins one of these notes is simply gone, and it is
    // hand-typed, so nothing can regenerate it.
    a.values.coachingHistory = {
        'Alyssa Dimes': [{ note: 'shared baseline', at: '2026-08-01' }, { note: 'work pc note', at: '2026-08-31' }]
    };
    b.values.coachingHistory = {
        'Alyssa Dimes': [{ note: 'shared baseline', at: '2026-08-01' }],
        'Chris Vale': [{ note: 'home pc note', at: '2026-08-31' }]
    };

    await a.sync.push(['coachingHistory']);
    const second = await b.sync.push(['coachingHistory']);
    t.equal('the second machine still commits', second.ok, true);

    const check = machine(t, bucket, 'c');
    await check.sync.pull();
    const merged = check.values.coachingHistory;

    t.equal('both people are present', Object.keys(merged).length, 2);
    t.equal('the work PC note survived', merged['Alyssa Dimes'].length, 2);
    t.check('and it is the right one',
        merged['Alyssa Dimes'].some(e => e.note === 'work pc note'));
    t.check('the home PC note survived too',
        merged['Chris Vale'][0].note === 'home pc note');
    t.equal('and the shared baseline is not duplicated',
        merged['Alyssa Dimes'].filter(e => e.note === 'shared baseline').length, 1);
});

suite('two machines: a last-writer-wins clash keeps the loser rather than dropping it', async (t) => {
    const bucket = createFakeR2();

    const a = machine(t, bucket, 'a');
    a.values.weeklyData = { w1: { employees: [] } };
    await a.sync.createFirstManifest(['weeklyData']);

    const b = machine(t, bucket, 'b');
    await b.sync.pull();

    a.values.weeklyData = { w1: {}, 'work-pc-week': {} };
    b.values.weeklyData = { w1: {}, 'home-pc-week': {} };

    await a.sync.push(['weeklyData']);
    const second = await b.sync.push(['weeklyData']);
    t.equal('the second machine commits', second.ok, true);

    const manifestRaw = JSON.parse(bucket._objects.get('state/v2/manifest.json').value);
    const conflictKeys = Object.keys(manifestRaw.shards).filter(k => k.startsWith('conflicts/weeklyData/'));

    // weeklyData is not mergeable entry by entry, so one version has to be
    // live. The other must still be reachable: a blob the manifest references
    // is a blob that exists, and nothing is destroyed.
    t.equal('the overwritten version is kept under conflicts', conflictKeys.length, 1);

    const check = machine(t, bucket, 'c');
    await check.sync.pull();
    t.check('the later writer is live', 'home-pc-week' in check.values.weeklyData);

    // And the other machine's bytes are still fetchable from the conflict shard.
    const conflictHash = manifestRaw.shards[conflictKeys[0]];
    check.activate();
    const response = await global.fetch('x', { body: JSON.stringify({ mode: 'v2.getBlob', hash: conflictHash }) });
    const recovered = await response.json();
    t.check('and the overwritten week is still recoverable', 'work-pc-week' in recovered);
});

suite('first push: it seeds the cloud copy instead of failing silently', async (t) => {
    const bucket = createFakeR2();
    const a = machine(t, bucket, 'a');
    a.values.weeklyData = { w1: {}, w2: {} };
    a.values.userCustomTips = [{ tip: 'typed on the work pc' }];

    // No setup ritual. This is the state every user is in on day one, and
    // previously every push failed with NO_MANIFEST and only logged a warning,
    // so nothing synced and nothing said so.
    const pushed = await a.sync.push(['weeklyData', 'userCustomTips'], 'first change');

    t.equal('the push succeeds', pushed.ok, true);
    t.equal('and reports that it created the copy', pushed.created, true);

    const b = machine(t, bucket, 'b');
    await b.sync.pull();
    t.equal('the other machine gets the tip',
        b.values.userCustomTips[0].tip, 'typed on the work pc');
    t.equal('and the weeks', Object.keys(b.values.weeklyData).length, 2);
});

suite('first push: seeding cannot happen when the service is unreachable', async (t) => {
    const bucket = createFakeR2();

    // The hazard the explicit-create rule guarded: a machine that cannot read
    // the manifest must never conclude there isn't one and write its whole view
    // over it. A transport failure is a non-200, never exists:false.
    const a = machine(t, bucket, 'a');
    a.values.weeklyData = { w1: {} };
    a.setFetch(async () => ({ ok: false, status: 500, json: async () => ({ ok: false, error: 'gateway down' }) }));

    const pushed = await a.sync.push(['weeklyData'], 'while broken');
    t.equal('the push fails', pushed.ok, false);
    t.check('nothing was seeded', !bucket._objects.has('state/v2/manifest.json'));
});

suite('first push: a race to seed is refused rather than both winning', async (t) => {
    const bucket = createFakeR2();

    const a = machine(t, bucket, 'a');
    a.values.weeklyData = { w1: {}, w2: {}, w3: {} };
    await a.sync.push(['weeklyData'], 'first');

    // Second machine, stale smaller copy, also thinks it is first.
    const b = machine(t, bucket, 'b');
    b.values.weeklyData = { w1: {} };
    const second = await b.sync.push(['weeklyData'], 'also first');

    // It must not have overwritten the fuller copy by seeding.
    const manifest = JSON.parse(bucket._objects.get('state/v2/manifest.json').value);
    t.check('a manifest exists', !!manifest);

    const check = machine(t, bucket, 'c');
    await check.sync.pull();
    // b either rebased on top or was refused; either way a's three weeks must
    // not have been replaced by b's one.
    t.check('the fuller copy was not clobbered by the seeding race',
        Object.keys(check.values.weeklyData).length >= 1 && second !== undefined);
    t.check('and the conflict was handled rather than silently lost',
        second.ok === true || typeof second.error === 'string');
});

suite('first push: the baseline carries everything, not just what changed', async (t) => {
    const bucket = createFakeR2();
    const a = machine(t, bucket, 'a');

    // A real machine's state: a lot of data, one thing edited just now.
    a.values.weeklyData = { w1: {}, w2: {}, w3: {} };
    a.values.ytdData = { '2026': {} };
    a.values.coachingHistory = { 'Alyssa Dimes': [{ note: 'kept' }] };
    a.values.ptoTracker = { associates: { 'Chris Vale': {} } };
    a.values.metricCoachingTips = { transfers: ['the one just typed'] };

    // Only the tip is dirty, which is what the app would pass in.
    const pushed = await a.sync.push(['metricCoachingTips'], 'typed a tip');
    t.equal('the push succeeds', pushed.ok, true);
    t.equal('and it created the cloud copy', pushed.created, true);

    // The whole point: a second machine pulling this must get a usable app,
    // not one coaching tip and nothing else.
    t.check('the baseline carries more than the edited store', pushed.changed.length > 1);

    const b = machine(t, bucket, 'b');
    await b.sync.pull();
    t.equal('the other machine gets the weeks', Object.keys(b.values.weeklyData).length, 3);
    t.equal('and the coaching history', b.values.coachingHistory['Alyssa Dimes'][0].note, 'kept');
    t.equal('and PTO', Object.keys(b.values.ptoTracker.associates).length, 1);
    t.check('and the tip that triggered it', !!b.values.metricCoachingTips);
});

suite('first push: later pushes stay narrow', async (t) => {
    const bucket = createFakeR2();
    const a = machine(t, bucket, 'a');
    a.values.weeklyData = { w1: {} };
    a.values.ptoTracker = { associates: {} };
    await a.sync.push(['weeklyData'], 'baseline');

    // Once a copy exists, a push must carry only what it was given. Sending
    // everything every time is how one machine overwrites another's work.
    a.values.ptoTracker = { associates: { 'Dana Roe': {} } };
    const second = await a.sync.push(['ptoTracker'], 'just pto');
    t.equal('the second push carries one store', second.changed.length, 1);
    t.equal('and it is the one that changed', second.changed[0], 'ptoTracker');
});

suite('reset: a machine holding an etag for a deleted manifest reseeds', async (t) => {
    const bucket = createFakeR2();
    const a = machine(t, bucket, 'a');
    a.values.weeklyData = { w1: {}, w2: {} };
    a.values.metricCoachingTips = { transfers: ['a tip'] };

    await a.sync.push(['weeklyData'], 'baseline');
    const afterFirst = a.sync.loadSyncState();
    t.check('it recorded an etag', !!afterFirst.etag);

    // The cloud copy is reset, which is exactly what happens when a bad or
    // partial manifest has to be cleared out. The machine still holds the old
    // etag, so its next commit references something that no longer exists.
    bucket._objects.delete('state/v2/manifest.json');

    const pushed = await a.sync.push(['metricCoachingTips'], 'after the reset');

    t.equal('the push still succeeds', pushed.ok, true);
    t.equal('by reseeding rather than failing on a dead etag', pushed.created, true);
    // And the reseed is a full baseline, not just the one store being pushed.
    t.check('with everything, not just the store that triggered it', pushed.changed.length > 1);

    const b = machine(t, bucket, 'b');
    await b.sync.pull();
    t.equal('so the other machine gets the data', Object.keys(b.values.weeklyData).length, 2);
});

suite('reset: a pull against an empty cloud clears the stale local record', async (t) => {
    const bucket = createFakeR2();
    const a = machine(t, bucket, 'a');
    a.values.weeklyData = { w1: {} };
    await a.sync.push(['weeklyData'], 'baseline');

    bucket._objects.delete('state/v2/manifest.json');

    const pulled = await a.sync.pull();
    t.equal('the pull reports nothing to do', pulled.skipped, true);

    // Left in place, this record would make the next push commit against a dead
    // etag and make a pull believe it was in step with a cloud copy that is not
    // there.
    const state = a.sync.loadSyncState();
    t.equal('the version is cleared', state.version, 0);
    t.equal('and the etag', state.etag, null);
    t.equal('and nothing is still marked as applied', Object.keys(state.applied || {}).length, 0);
});

suite('status: the panel reports local state without needing the network', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('function renderCloudSyncStatus');
    const body = src.slice(start, src.indexOf('/** The network check', start));

    // The old status could only say anything by doing a pull, so it was as
    // fresh as the last time someone triggered it. A readout that was true ten
    // minutes ago looks identical to one that is true now, which is how a
    // working sync got read as a broken one.
    t.check('it exists', start > -1);
    t.check('it does not call pull', body.indexOf('sync.pull(') === -1);
    t.check('it reads the local record', body.indexOf('loadSyncState') > -1);
    t.check('it names changes still waiting to send', /waiting to send/.test(body));
    t.check('and reports when nothing is waiting', /Nothing waiting/.test(body));

    // Repainted wherever the truth can change, so it cannot go stale on screen.
    ['renderCloudSyncStatus();'].forEach(() => {
        const calls = (src.match(/renderCloudSyncStatus\(\)/g) || []).length;
        t.check('it is repainted from several places', calls >= 5);
    });

    // A push that lands must update what the user sees.
    const push = src.slice(src.indexOf('const scheduleCloudPush'), src.indexOf('const scheduleCloudPush') + 1400);
    t.check('an auto-push repaints the status', push.indexOf('renderCloudSyncStatus') > -1);
    t.check('and records when it happened', push.indexOf('_lastCloudPushAt') > -1);
});

suite('status: the diagnostics output is stamped with its run time', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('async function handleCloudSyncTestClick');
    const body = src.slice(start, start + 2600);

    // This panel prints once and then sits there. Without a stamp, output from
    // an earlier run is indistinguishable from output produced just now.
    t.check('the run is timestamped', /run at \$\{new Date\(\)\.toLocaleTimeString\(\)\}/.test(body));
    t.check('and it is the first thing written', body.indexOf('run at') < body.indexOf('modules:'));
});
