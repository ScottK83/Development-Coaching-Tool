'use strict';

/**
 * The backing store for the bulk data. The properties that matter are less
 * about storing and fetching, which is the easy part, and more about what
 * happens when IndexedDB is not there: boot must not hang, must not throw, and
 * must be able to fall back to localStorage without the caller guessing why.
 */

const { suite } = require('./harness');
const { createFakeIndexedDB, createHangingIndexedDB, createFailingIndexedDB } = require('./fake-indexeddb');

function load(t, idb) {
    t.installFakeBrowser();
    global.window.indexedDB = idb;
    global.window.DevCoachConstants = Object.assign({}, global.window.DevCoachConstants, {
        IDB_DB_NAME: 'devCoachingTool',
        IDB_VERSION: 1,
        IDB_BULK_STORE: 'bulk',
        IDB_ARCHIVE_STORE: 'archive',
        IDB_OPEN_TIMEOUT_MS: 120
    });
    const modules = t.loadModule('modules/idb-backend.module.js');
    return modules.idbBackend;
}

suite('idb: it stores and reads back the bulk data', async (t) => {
    const idb = load(t, createFakeIndexedDB());
    t.equal('it opens', await idb.open(), true);
    t.equal('and reports itself available', idb.isAvailable(), true);

    const period = { employees: [{ name: 'Alyssa Dimes', aht: 400 }] };
    await idb.put('weeklyData', { '2026-08-17|2026-08-23': period });

    const back = await idb.get('weeklyData');
    t.equal('the period comes back', Object.keys(back).length, 1);
    t.equal('with its rows', back['2026-08-17|2026-08-23'].employees[0].name, 'Alyssa Dimes');

    // Structured clones, not JSON strings: a number stays a number and the
    // 5MB text ceiling stops applying.
    t.equal('values keep their types rather than becoming strings',
        typeof back['2026-08-17|2026-08-23'].employees[0].aht, 'number');
});

suite('idb: hydrate reads every store in one pass', async (t) => {
    const idb = load(t, createFakeIndexedDB());
    await idb.open();

    await idb.put('weeklyData', { a: 1 });
    await idb.put('ytdData', { b: 2 });
    await idb.put('coachingHistory', { c: 3 });

    const all = await idb.getAll();
    t.equal('every store is returned', Object.keys(all).length, 3);
    t.equal('keyed by store name', all.ytdData.b, 2);

    await idb.remove('ytdData');
    const afterRemove = await idb.getAll();
    t.equal('a removed store is gone', Object.keys(afterRemove).length, 2);

    await idb.clear();
    t.equal('and clear empties it', Object.keys(await idb.getAll()).length, 0);
});

suite('idb: the archive is keyed by store and year', async (t) => {
    const idb = load(t, createFakeIndexedDB());
    await idb.open();

    await idb.archivePut('weeklyData', 2026, { weeks: 68 });
    await idb.archivePut('weeklyData', 2025, { weeks: 52 });

    t.equal('the right year comes back', (await idb.archiveGet('weeklyData', 2026)).weeks, 68);
    t.equal('and the other one is untouched', (await idb.archiveGet('weeklyData', 2025)).weeks, 52);

    const keys = await idb.archiveKeys();
    t.check('keys name both the store and the year', keys.indexOf('weeklyData::2026') > -1);
    t.equal('closing out a year does not overwrite the last one', keys.length, 2);
});

suite('idb: an unavailable backend is a false, never a hang and never a throw', async (t) => {
    // No IndexedDB at all, as in some locked-down or private contexts.
    const none = load(t, undefined);
    t.equal('a missing IndexedDB resolves false', await none.open(), false);
    t.equal('and reports itself unavailable', none.isAvailable(), false);

    // open() that rejects, as when storage is disabled.
    const failing = load(t, createFailingIndexedDB());
    t.equal('a failing open resolves false rather than rejecting', await failing.open(), false);

    // open() that never settles, as when another tab holds a versionchange.
    // This is the one that would otherwise leave the app on a blank page.
    const hanging = load(t, createHangingIndexedDB());
    const started = Date.now();
    t.equal('a hanging open times out to false', await hanging.open(), false);
    t.check('and it gives up rather than waiting forever', Date.now() - started < 2000);
});

suite('idb: writes are awaitable so unload can try to flush them', async (t) => {
    const idb = load(t, createFakeIndexedDB());
    await idb.open();

    const writes = [idb.put('weeklyData', { a: 1 }), idb.put('ytdData', { b: 2 })];
    t.check('writes in flight are counted', idb.pendingWriteCount() > 0);

    await idb.flush();
    t.equal('flush waits for them all', idb.pendingWriteCount(), 0);
    await Promise.all(writes);
    t.equal('and they landed', (await idb.get('ytdData')).b, 2);

    // flush() must settle even when a write failed, or unload would hang on the
    // one thing it is there to survive. Closing the connection mid-flight is
    // the realistic version: another tab requested a version change.
    const broken = load(t, createFakeIndexedDB());
    await broken.open();
    const good = broken.put('weeklyData', { a: 1 });
    good.catch(() => {});
    broken._reset();
    const rejected = broken.put('ytdData', { b: 2 });
    let didReject = false;
    rejected.catch(() => { didReject = true; });

    const settled = await broken.flush();
    t.check('flush settles rather than rejecting', Array.isArray(settled));
    await Promise.allSettled([good, rejected]);
    t.check('a write against a closed connection rejects rather than hanging', didReject);
});
