'use strict';

/**
 * Who the sync worker answers.
 *
 * Stored files (the call-listening log, uploaded payroll and Verint workbooks)
 * used to be served to any GET whose Origin or Referer named the app. Those are
 * plain request headers, so a curl with a forged Referer got the coaching notes.
 * And when the shared secret was unset, every POST mode fell back to the same
 * Origin check. Now the secret is required on every request, a worker with no
 * secret refuses everything, and only the exact app origin is accepted.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');
const { createFakeR2, loadWorker, post, TEST_SECRET } = require('./fake-r2');

const APP = 'https://development-coaching-tool.pages.dev';
const worker = loadWorker(ROOT, path, fs);

function env(bucket, secret = TEST_SECRET) {
    return { COACHING_BUCKET: bucket, ALLOWED_ORIGIN: APP, SYNC_SHARED_SECRET: secret };
}

function getFile(name, headers) {
    const lower = {};
    Object.keys(headers).forEach((k) => { lower[k.toLowerCase()] = headers[k]; });
    return {
        method: 'GET',
        url: `https://sync.example.workers.dev/files/${name}`,
        headers: { get: (key) => lower[String(key).toLowerCase()] || null }
    };
}

async function seededBucket() {
    const bucket = createFakeR2();
    await bucket.put('uploads/call-listening-logs.xlsx', 'coaching notes', {});
    return bucket;
}

suite('worker auth: a stored file needs the secret', async (t) => {
    const bucket = await seededBucket();

    const forged = await worker.fetch(getFile('call-listening-logs.xlsx', { Referer: APP + '/' }), env(bucket));
    t.check('a forged Referer alone gets nothing', forged.status !== 200);

    const noSecret = await worker.fetch(getFile('call-listening-logs.xlsx', { Origin: APP }), env(bucket));
    t.equal('the right Origin without the secret is refused', noSecret.status, 401);

    const wrong = await worker.fetch(getFile('call-listening-logs.xlsx', { Origin: APP, 'X-Sync-Secret': 'guess' }), env(bucket));
    t.equal('a wrong secret is refused', wrong.status, 401);

    const ok = await worker.fetch(getFile('call-listening-logs.xlsx', { Origin: APP, 'X-Sync-Secret': TEST_SECRET }), env(bucket));
    t.equal('the app with the secret gets the file', ok.status, 200);
});

suite('worker auth: no configured secret means no access at all', async (t) => {
    const bucket = await seededBucket();

    const read = await worker.fetch(post({ mode: 'retrieve' }), env(bucket, ''));
    t.equal('a sync request is refused', read.status, 503);

    const wipe = await worker.fetch(post({ mode: 'deleteAll' }), env(bucket, ''));
    t.equal('so is a delete', wipe.status, 503);

    const file = await worker.fetch(getFile('call-listening-logs.xlsx', { Origin: APP, 'X-Sync-Secret': 'anything' }), env(bucket, ''));
    t.equal('and so is a file', file.status, 503);
});

suite('worker auth: only the exact app origin is accepted', async (t) => {
    const bucket = await seededBucket();

    const preview = await worker.fetch(post({ mode: 'v2.manifest' }, 'https://abc123.development-coaching-tool.pages.dev'), env(bucket));
    t.equal('a preview deploy is refused', preview.status, 403);

    const app = await worker.fetch(post({ mode: 'v2.manifest' }, APP), env(bucket));
    t.equal('the app itself is served', app.status, 200);
});
