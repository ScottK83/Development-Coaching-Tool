'use strict';

/**
 * Point-in-time restore.
 *
 * Cloud storage has written a dated copy on every sync since the worker was
 * built, and deleteAll deliberately leaves them. Nothing could read them, so
 * recovery meant "restore the latest", which is exactly no help when the latest
 * copy is the one that went wrong. That is what happened when reclaiming
 * localStorage looked like a wipe.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function loadSync(t, fetchImpl) {
    t.installFakeBrowser();
    global.fetch = fetchImpl;
    global.window.DevCoachConstants = Object.assign({}, global.window.DevCoachConstants, {
        STORAGE_PREFIX: 'devCoachingTool_'
    });
    // The endpoint the module reads its config from.
    global.localStorage.setItem('devCoachingTool_callListeningSyncConfig',
        JSON.stringify({ endpoint: 'https://sync.example.workers.dev', sharedSecret: 's3cret' }));
    return t.loadModule('modules/repo-sync.module.js').repoSync;
}

function respond(body, ok = true, status = 200) {
    return Promise.resolve({ ok, status, json: () => Promise.resolve(body) });
}

suite('snapshots: the saved days can be listed, newest first', async (t) => {
    let seenBody = null;
    let seenHeaders = null;
    const sync = loadSync(t, (url, opts) => {
        seenBody = JSON.parse(opts.body);
        seenHeaders = opts.headers;
        return respond({
            ok: true,
            snapshots: [
                { date: '2026-08-31', key: 'state/snapshots/2026-08-31.json', size: 5000000 },
                { date: '2026-08-30', key: 'state/snapshots/2026-08-30.json', size: 4900000 }
            ]
        });
    });

    const list = await sync.listRepoSnapshots();
    t.equal('both days come back', list.length, 2);
    t.equal('newest first', list[0].date, '2026-08-31');
    t.equal('it asks for the snapshot list', seenBody.mode, 'listSnapshots');
    t.equal('and carries the shared secret', seenHeaders['x-sync-secret'], 's3cret');
});

suite('snapshots: a chosen day comes back whole', async (t) => {
    const sync = loadSync(t, (url, opts) => {
        const body = JSON.parse(opts.body);
        t.equal('it asks for the right date', body.date, '2026-08-30');
        return respond({
            ok: true,
            date: '2026-08-30',
            payload: { weeklyData: { w1: {}, w2: {} }, ytdData: { '2026': {} } }
        });
    });

    const payload = await sync.fetchRepoSnapshotPayload('2026-08-30');
    t.equal('the weeks are there', Object.keys(payload.weeklyData).length, 2);
});

suite('snapshots: an empty one is refused rather than applied', async (t) => {
    const sync = loadSync(t, () => respond({ ok: true, date: '2026-08-29', payload: { weeklyData: {}, ytdData: {} } }));

    // Restoring an empty snapshot over live data would be the exact failure
    // this feature exists to recover from.
    let message = '';
    try {
        await sync.fetchRepoSnapshotPayload('2026-08-29');
    } catch (error) {
        message = String(error.message);
    }
    t.check('it refuses', message.length > 0);
    t.check('and says the snapshot has no data', /no data/.test(message));
});

suite('snapshots: failures surface instead of returning nothing', async (t) => {
    const missing = loadSync(t, () => respond({ ok: false, error: 'No snapshot stored for 2026-01-01.' }, false, 404));
    let msg = '';
    try { await missing.fetchRepoSnapshotPayload('2026-01-01'); } catch (e) { msg = String(e.message); }
    t.check('a missing day says so', /No snapshot stored/.test(msg));

    // The config carries a default endpoint, so "not configured" cannot happen
    // in practice. The realistic failures are the network and the service.
    const offline = loadSync(t, () => Promise.reject(new Error('Failed to fetch')));
    let netMsg = '';
    try { await offline.listRepoSnapshots(); } catch (e) { netMsg = String(e.message); }
    t.check('being offline surfaces rather than returning an empty list',
        /Failed to fetch/.test(netMsg));

    const broken = loadSync(t, () => respond({ ok: false, error: 'Unauthorized sync request.' }, false, 401));
    let authMsg = '';
    try { await broken.listRepoSnapshots(); } catch (e) { authMsg = String(e.message); }
    t.check('a rejected request surfaces the reason', /Unauthorized/.test(authMsg));
});

suite('snapshots: the worker only serves a real date', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'cloudflare-sync-worker/index.js'), 'utf8').replace(/\r\n/g, '\n');

    t.check('the worker handles listSnapshots', src.indexOf("mode === 'listSnapshots'") > -1);
    t.check('and retrieveSnapshot', src.indexOf("mode === 'retrieveSnapshot'") > -1);

    // The date goes into an R2 key, so it is pinned to the exact shape rather
    // than interpolated straight from the request.
    t.check('the date is validated against a strict pattern',
        /\\d\{4\}-\\d\{2\}-\\d\{2\}/.test(src));

    const block = src.slice(src.indexOf("mode === 'retrieveSnapshot'"));
    const validate = block.indexOf('.test(date)');
    const useKey = block.indexOf('state/snapshots/${date}.json');
    t.check('and validated before it is used to build a key', validate > -1 && validate < useKey);

    // These are reads. They must not be able to remove anything.
    const listBlock = src.slice(src.indexOf("mode === 'listSnapshots'"), src.indexOf("mode === 'deleteAll'"));
    t.check('neither new mode deletes anything', listBlock.indexOf('.delete(') === -1);
    t.check('nor writes anything', listBlock.indexOf('.put(') === -1);
});
