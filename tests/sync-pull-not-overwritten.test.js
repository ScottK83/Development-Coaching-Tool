'use strict';

/**
 * A pull must not be undone by the page that received it.
 *
 * The work PC uploaded a month of dailies. The home PC pulled them at boot and
 * wrote them to storage, but through saveWithSizeCheck, which marked them dirty
 * like a local edit. script.js still held the dailies it loaded before the
 * pull. The toast said reload; the reload ran the save-before-leaving pass,
 * which saves every dirty store from memory, and wrote the old dailies straight
 * over the new ones. The home PC then recorded itself as current and never
 * fetched them again, and its next save of dailyData would have sent the old
 * copy up over the work PC's uploads.
 *
 * Pinned here: a pulled store is not dirty, is refused a save from the stale
 * copy until reload, and a full re-download fetches a store this machine
 * wrongly believes it already has.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');
const { createFakeR2, loadWorker, post, TEST_SECRET } = require('./fake-r2');

const PREFIX = 'devCoachingTool_';

function loadStorage(t) {
    t.installFakeBrowser();
    ['modules/store-registry.module.js', 'modules/constants.module.js',
     'modules/metrics-registry.module.js', 'modules/data-parsing.module.js',
     'modules/storage.module.js'].forEach((m) => t.loadModule(m));
    return global.window.DevCoachModules.storage;
}

suite('sync: a pulled store is not overwritten by the page on its way out', (t) => {
    const storage = loadStorage(t);

    // Boot: the page loads its dailies into memory.
    const inMemory = { '2026-09-08|2026-09-08': { employees: [{ name: 'Old' }] } };
    storage.saveWithSizeCheck('dailyData', inMemory);
    storage.clearDirtyStores();

    // The pull brings the other computer's dailies.
    const fresh = { '2026-09-09|2026-09-09': { employees: [{ name: 'Fresh' }] } };
    t.check('the pull is applied', storage.applyRemoteStore('dailyData', fresh) === true);
    t.equal('and is not counted as a local edit', storage.isStoreDirty('dailyData'), false);
    t.equal('it is marked stale in memory', storage.isStoreStale('dailyData'), true);

    // The save-before-leaving pass only saves dirty stores, so it skips it.
    // And a save from the old copy, from anywhere, is refused.
    let refused = null;
    storage.onStaleWriteRefused((key) => { refused = key; });
    t.equal('a save from the old copy is refused', storage.saveWithSizeCheck('dailyData', inMemory), false);
    t.equal('and says which store', refused, 'dailyData');
    t.equal('the pulled copy is still what is stored',
        Object.keys(JSON.parse(global.localStorage.getItem(PREFIX + 'dailyData')))[0], '2026-09-09|2026-09-09');
    t.equal('and the refused save did not mark it dirty', storage.isStoreDirty('dailyData'), false);

    // Other stores are untouched by any of this.
    t.equal('an unrelated store still saves', storage.saveWithSizeCheck('weeklyData', {}), true);
});

suite('sync: pulls go through applyRemoteStore, and a full pull refetches everything', async (t) => {
    const bucket = createFakeR2();
    const worker = loadWorker(ROOT, path, fs);

    const machine = (seed) => {
        const browser = t.installFakeBrowser();
        global.window.DevCoachConstants = Object.assign({}, global.window.DevCoachConstants, { STORAGE_PREFIX: PREFIX });
        global.fetch = async (url, opts) => {
            const response = await worker.fetch(post(JSON.parse(opts.body)), {
                COACHING_BUCKET: bucket, ALLOWED_ORIGIN: 'https://development-coaching-tool.pages.dev', SYNC_SHARED_SECRET: TEST_SECRET
            });
            const text = await response.text();
            return { ok: response.status === 200, status: response.status, json: async () => JSON.parse(text) };
        };
        t.loadModule('modules/store-registry.module.js');
        const values = {};
        const log = { saved: [], applied: [] };
        global.window.DevCoachModules.storage = {
            readStore: (name) => values[name],
            saveWithSizeCheck: (name, value) => { log.saved.push(name); values[name] = value; return true; },
            applyRemoteStore: (name, value) => { log.applied.push(name); values[name] = value; return true; }
        };
        global.window.DevCoachModules.repoSync = {
            loadCallListeningSyncConfig: () => ({ endpoint: 'https://sync.example.workers.dev', sharedSecret: 's' })
        };
        browser.store[PREFIX + 'v2DeviceId'] = seed;
        const raw = t.loadModule('modules/manifest-sync.module.js').manifestSync;
        const owned = { window: global.window, localStorage: global.localStorage, fetch: global.fetch };
        const sync = {};
        Object.keys(raw).forEach((name) => {
            sync[name] = (...args) => { Object.assign(global, owned); return raw[name](...args); };
        });
        return { sync, values, log };
    };

    const work = machine('dev-work');
    const home = machine('dev-home');

    work.values.dailyData = { '2026-09-09|2026-09-09': { employees: [{ name: 'Fresh' }] } };
    t.check('the work PC sends its dailies', (await work.sync.push(['dailyData'])).ok);

    const pulled = await home.sync.pull();
    t.check('the home PC receives them', pulled.updated.includes('dailyData'));
    t.check('through applyRemoteStore', home.log.applied.includes('dailyData'));
    t.check('never through a local save', !home.log.saved.includes('dailyData'));

    // The failure: the home PC's copy was overwritten after the pull, so it
    // holds old data while believing it is current.
    home.values.dailyData = { '2026-09-08|2026-09-08': { employees: [{ name: 'Old' }] } };
    const ordinary = await home.sync.pull();
    t.equal('an ordinary pull cannot see that', ordinary.updated.length, 0);

    const full = await home.sync.pull({ full: true });
    t.check('a full re-download fetches it anyway', full.updated.includes('dailyData'));
    t.check('and the fresh copy is back',
        !!home.values.dailyData['2026-09-09|2026-09-09'] && !home.values.dailyData['2026-09-08|2026-09-08']);
});

suite('sync: the app reloads after a pull and offers a full re-download', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    t.check('the startup pull is handled, not just toasted', /sync\.pull\(\)\.then\(\(result\) => \{\s*renderCloudSyncStatus\(\);\s*afterCloudPull\(result, 'boot'\)/.test(script));
    t.check('it pulls again when the tab comes back', /visibilitychange[\s\S]{0,200}pullFromOtherMachine\('focus'\)/.test(script));
    t.check('and on a timer', /setInterval\(\(\) => pullFromOtherMachine\('timer'\)/.test(script));
    t.check('the re-download button is on the page', html.indexOf('id="cloudSyncFullPullBtn"') > -1);
    t.check('and wired', script.indexOf("getElementById('cloudSyncFullPullBtn')?.addEventListener('click', handleCloudSyncFullPullClick)") > -1);
});
