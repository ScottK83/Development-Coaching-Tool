'use strict';

/**
 * hydrate() always settles.
 *
 * open() carries the only timeout in the IndexedDB backend. getAll() and put()
 * carry none, and hydrate awaits getAll four times, so a single stalled
 * transaction hung it forever.
 *
 * That is worse than a slow boot. index.html does not create the script.js tag
 * until hydrate resolves, and the loader's .catch fires on a rejection -- a
 * hang is not one. So the app never booted, never failed, and showed a blank
 * page indefinitely with nothing in the UI to say why.
 *
 * A deadline is not a new failure mode. Every error hydrate already knows about
 * ends on localStorage, and a stall now ends the same way.
 */

const { suite } = require('./harness');

function loadWith(t, backend, timeoutMs) {
    t.installFakeBrowser();
    ['modules/store-registry.module.js', 'modules/constants.module.js',
     'modules/metrics-registry.module.js', 'modules/data-parsing.module.js'].forEach((m) => t.loadModule(m));
    // Shorten the deadline so the suite does not wait the real eight seconds.
    global.window.DevCoachConstants.HYDRATE_TIMEOUT_MS = timeoutMs;
    t.loadModule('modules/storage.module.js');
    global.window.DevCoachModules.idbBackend = backend;
    return global.window.DevCoachModules.storage;
}

const NEVER = () => new Promise(() => {});

suite('storage: a stalled backend read cannot wedge boot', async (t) => {
    const storage = loadWith(t, {
        open: () => Promise.resolve(true),
        getAll: NEVER,              // the transaction that never comes back
        put: () => Promise.resolve(true)
    }, 50);

    const mode = await storage.hydrate();

    t.equal('hydrate gives up and reports localStorage', mode, 'localStorage');
    // The whole point: it returned at all.
    t.check('and the app is free to boot', mode === 'localStorage');
});

suite('storage: a late backend must not retarget a booted app', async (t) => {
    let release;
    const gate = new Promise((resolve) => { release = resolve; });

    const storage = loadWith(t, {
        open: () => Promise.resolve(true),
        getAll: () => gate.then(() => ({ weeklyData: { late: true } })),
        put: () => Promise.resolve(true)
    }, 50);

    const mode = await storage.hydrate();
    t.equal('the deadline wins', mode, 'localStorage');

    // Now let the backend finally answer, after boot has already read through
    // localStorage. The two copies may have diverged by now, so the late
    // arrival must not become the source of truth.
    release();
    await new Promise((r) => setTimeout(r, 20));

    t.check('the store did not silently switch backends',
        !storage.isBackedByIdb || storage.isBackedByIdb('weeklyData') === false);
});

suite('storage: a backend that answers in time is still used', async (t) => {
    // The deadline must not cost a healthy backend its job.
    const storage = loadWith(t, {
        open: () => Promise.resolve(true),
        getAll: () => Promise.resolve({ weeklyData: { '2026-08-03|2026-08-09': { employees: [] } } }),
        put: () => Promise.resolve(true)
    }, 2000);

    const mode = await storage.hydrate();
    t.equal('a responsive backend still wins', mode, 'idb');
});

suite('storage: an absent backend still reports localStorage', async (t) => {
    t.installFakeBrowser();
    ['modules/store-registry.module.js', 'modules/constants.module.js',
     'modules/metrics-registry.module.js', 'modules/data-parsing.module.js',
     'modules/storage.module.js'].forEach((m) => t.loadModule(m));
    delete global.window.DevCoachModules.idbBackend;

    const mode = await global.window.DevCoachModules.storage.hydrate();
    t.equal('no backend module is not a hang either', mode, 'localStorage');
});
