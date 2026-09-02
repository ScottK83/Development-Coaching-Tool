'use strict';

/**
 * The v2 protocol, which is what makes two machines safe.
 *
 * Store values are immutable blobs named by the sha256 of their bytes. The
 * manifest is the only mutable object and it moves only under an If-Match
 * compare-and-swap. So a write can only ADD bytes; the sole thing that can be
 * overwritten is a small manifest, and only by a writer holding its etag.
 *
 * The scenario these exist for: work PC edits one store, home PC edits another
 * without pulling first, both push. Today's whole-blob sync destroys one of
 * them silently.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');
const { createFakeR2, loadWorker, post } = require('./fake-r2');

const worker = loadWorker(ROOT, path, fs);

function env(bucket) {
    return { COACHING_BUCKET: bucket, ALLOWED_ORIGIN: 'https://development-coaching-tool.pages.dev' };
}

async function call(bucket, body) {
    const response = await worker.fetch(post(body), env(bucket));
    let parsed = null;
    try { parsed = JSON.parse(await response.text()); } catch (_) { /* streamed body */ }
    return { status: response.status, body: parsed, response };
}

async function sha256Hex(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function putStore(bucket, value) {
    const bytes = JSON.stringify(value);
    const hash = await sha256Hex(bytes);
    await call(bucket, { mode: 'v2.putBlob', hash, bytes });
    return hash;
}

suite('v2: a first manifest is created only when explicitly asked for', async (t) => {
    const bucket = createFakeR2();

    const empty = await call(bucket, { mode: 'v2.manifest' });
    t.equal('reading a missing manifest is not an error', empty.status, 200);
    t.equal('it reports that none exists', empty.body.exists, false);

    const hash = await putStore(bucket, { w1: {} });

    // A client that treats "no manifest" as licence to seed turns any transient
    // miss into an unguarded whole-state overwrite, through the least tested
    // path there is. Creating has to be a deliberate act.
    const uninvited = await call(bucket, { mode: 'v2.commit', changed: { weeklyData: hash } });
    t.equal('an ordinary commit against no manifest is refused', uninvited.status, 409);
    t.equal('and says why', uninvited.body.code, 'NO_MANIFEST');

    const created = await call(bucket, { mode: 'v2.commit', intent: 'create', changed: { weeklyData: hash }, device: 'workpc' });
    t.equal('an explicit create succeeds', created.status, 200);
    t.equal('at version 1', created.body.manifest.version, 1);
    t.equal('naming the shard', created.body.manifest.shards.weeklyData, hash);
});

suite('v2: two machines editing different stores both survive', async (t) => {
    const bucket = createFakeR2();

    const first = await putStore(bucket, { w1: {} });
    await call(bucket, { mode: 'v2.commit', intent: 'create', changed: { weeklyData: first }, device: 'workpc' });

    // Both machines read the same manifest.
    const read = await call(bucket, { mode: 'v2.manifest' });
    const sharedEtag = read.body.etag;

    // Work PC edits weeklyData.
    const weeklyB = await putStore(bucket, { w1: {}, w2: {} });
    const a = await call(bucket, { mode: 'v2.commit', baseEtag: sharedEtag, changed: { weeklyData: weeklyB }, device: 'workpc' });
    t.equal('the first machine commits', a.status, 200);

    // Home PC edits ptoTracker against the SAME now-stale etag.
    const pto = await putStore(bucket, { associates: { 'Chris Vale': {} } });
    const b = await call(bucket, { mode: 'v2.commit', baseEtag: sharedEtag, changed: { ptoTracker: pto }, device: 'homepc' });

    t.equal('the second is told to rebase rather than silently winning', b.status, 409);
    t.equal('with the reason', b.body.code, 'CAS_CONFLICT');
    t.check('and the current manifest to rebase onto', !!b.body.manifest);

    // Rebase: re-apply only its own change onto the manifest it was handed.
    const rebased = await call(bucket, { mode: 'v2.commit', baseEtag: b.body.etag, changed: { ptoTracker: pto }, device: 'homepc' });
    t.equal('the rebase commits', rebased.status, 200);

    // The point of the whole design.
    t.equal('the work PC edit survived', rebased.body.manifest.shards.weeklyData, weeklyB);
    t.equal('and so did the home PC edit', rebased.body.manifest.shards.ptoTracker, pto);
});

suite('v2: an unnamed shard is carried forward from live state, not from a stale view', async (t) => {
    const bucket = createFakeR2();

    const weekly = await putStore(bucket, { w1: {} });
    const pto = await putStore(bucket, { associates: {} });
    await call(bucket, { mode: 'v2.commit', intent: 'create', changed: { weeklyData: weekly, ptoTracker: pto }, device: 'workpc' });

    const read = await call(bucket, { mode: 'v2.manifest' });

    // Another machine moves ptoTracker forward.
    const ptoNew = await putStore(bucket, { associates: { 'Dana Roe': {} } });
    await call(bucket, { mode: 'v2.commit', baseEtag: read.body.etag, changed: { ptoTracker: ptoNew }, device: 'homepc' });

    // This machine commits only weeklyData, holding a view where ptoTracker is
    // still the old hash. It must not drag that old value back.
    const fresh = await call(bucket, { mode: 'v2.manifest' });
    const weeklyNew = await putStore(bucket, { w1: {}, w2: {} });
    const commit = await call(bucket, { mode: 'v2.commit', baseEtag: fresh.body.etag, changed: { weeklyData: weeklyNew }, device: 'workpc' });

    t.equal('the commit succeeds', commit.status, 200);
    t.equal('its own change landed', commit.body.manifest.shards.weeklyData, weeklyNew);
    t.equal('and the shard it did not name kept the OTHER machine\'s newer value',
        commit.body.manifest.shards.ptoTracker, ptoNew);
});

suite('v2: blobs are content-addressed and never rewritten', async (t) => {
    const bucket = createFakeR2();
    const bytes = JSON.stringify({ w1: {} });
    const hash = await sha256Hex(bytes);

    const first = await call(bucket, { mode: 'v2.putBlob', hash, bytes });
    t.equal('the blob stores', first.status, 200);
    t.equal('and was not already there', first.body.alreadyPresent, false);

    const again = await call(bucket, { mode: 'v2.putBlob', hash, bytes });
    t.equal('storing the same bytes again is a no-op', again.body.alreadyPresent, true);

    // A name that does not match its content would leave the manifest pointing
    // at bytes nothing resolves to, permanently.
    const lying = await call(bucket, { mode: 'v2.putBlob', hash, bytes: JSON.stringify({ different: true }) });
    t.equal('bytes that do not match the hash are refused', lying.status, 400);
    t.equal('with a clear code', lying.body.code, 'HASH_MISMATCH');

    const bad = await call(bucket, { mode: 'v2.putBlob', hash: 'not-a-hash', bytes });
    t.equal('a malformed hash is refused', bad.status, 400);
});

suite('v2: a blob reads back whole, however large', async (t) => {
    const bucket = createFakeR2();
    const value = { employees: Array.from({ length: 400 }, (_, i) => ({ name: 'Associate ' + i, aht: 400 })) };
    const hash = await putStore(bucket, value);

    const got = await call(bucket, { mode: 'v2.getBlob', hash });
    t.equal('it comes back', got.status, 200);
    t.equal('with every row', got.body.employees.length, 400);

    const missing = await call(bucket, { mode: 'v2.getBlob', hash: 'a'.repeat(64) });
    t.equal('a missing blob is a 404', missing.status, 404);
    t.equal('with a code the client can branch on', missing.body.code, 'BLOB_MISSING');
});

suite('v2: a stale etag can never win', async (t) => {
    const bucket = createFakeR2();
    const h1 = await putStore(bucket, { v: 1 });
    await call(bucket, { mode: 'v2.commit', intent: 'create', changed: { weeklyData: h1 }, device: 'a' });

    const read = await call(bucket, { mode: 'v2.manifest' });
    const stale = read.body.etag;

    const h2 = await putStore(bucket, { v: 2 });
    await call(bucket, { mode: 'v2.commit', baseEtag: stale, changed: { weeklyData: h2 }, device: 'a' });

    // Same stale etag, used again. Must be refused every time, not just once.
    const h3 = await putStore(bucket, { v: 3 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const retry = await call(bucket, { mode: 'v2.commit', baseEtag: stale, changed: { weeklyData: h3 }, device: 'b' });
        t.equal(`attempt ${attempt + 1} is refused`, retry.status, 409);
    }

    const final = await call(bucket, { mode: 'v2.manifest' });
    t.equal('the value from the stale writer never landed', final.body.manifest.shards.weeklyData, h2);

    const noEtag = await call(bucket, { mode: 'v2.commit', changed: { weeklyData: h3 }, device: 'b' });
    t.equal('and a commit with no etag at all is refused', noEtag.status, 400);
    t.equal('rather than treated as a create', noEtag.body.code, 'NO_BASE_ETAG');
});

suite('v2: delete-all empties the manifest instead of leaving it behind', async (t) => {
    const bucket = createFakeR2();
    const hash = await putStore(bucket, { w1: {} });
    await call(bucket, { mode: 'v2.commit', intent: 'create', changed: { weeklyData: hash }, device: 'workpc' });

    const deleted = await call(bucket, { mode: 'deleteAll' });
    t.equal('it reports clearing v2', deleted.body.v2Cleared, true);

    const after = await call(bucket, { mode: 'v2.manifest' });
    // A removed manifest would read as "none exists", and the other machine
    // would then decide to seed one from its own stale local copy, resurrecting
    // exactly what was deleted. An empty manifest at a higher version is an
    // instruction the other machine can follow.
    t.equal('the manifest still exists', after.body.exists, true);
    t.equal('but names no shards', Object.keys(after.body.manifest.shards).length, 0);
    t.check('at a higher version, so other machines see a real change',
        after.body.manifest.version > 1);
    t.equal('and is marked as a deliberate wipe', after.body.manifest.deletedAll, true);
});

suite('v2: a shard can be removed by naming it null', async (t) => {
    const bucket = createFakeR2();
    const a = await putStore(bucket, { x: 1 });
    const b = await putStore(bucket, { y: 2 });
    await call(bucket, { mode: 'v2.commit', intent: 'create', changed: { weeklyData: a, ptoTracker: b }, device: 'a' });

    const read = await call(bucket, { mode: 'v2.manifest' });
    const dropped = await call(bucket, { mode: 'v2.commit', baseEtag: read.body.etag, changed: { ptoTracker: null }, device: 'a' });

    t.equal('the commit succeeds', dropped.status, 200);
    t.check('the named shard is gone', !('ptoTracker' in dropped.body.manifest.shards));
    t.equal('the other is untouched', dropped.body.manifest.shards.weeklyData, a);
});

suite('contest: the month is stored in R2, read back and verified', async (t) => {
    const bucket = createFakeR2();

    const empty = await call(bucket, { mode: 'contestGet', month: '2026-09' });
    t.equal('a month with nothing in it reads cleanly', empty.status, 200);
    t.equal('and reports that it does not exist yet', empty.body.exists, false);
    t.equal('with an empty days map to render from', Object.keys(empty.body.data.days).length, 0);

    const saved = await call(bucket, {
        mode: 'contestSave', month: '2026-09',
        data: { days: { '2026-09-01': { 'Alyssa Dimes': { adherence: 96, perfectSurveys: 2 } } } }
    });
    t.equal('saving works', saved.status, 200);
    // The worker reads back after writing, so "saved" means stored rather than
    // meaning a request returned 200.
    t.equal('and reports what actually landed', saved.body.days, 1);

    const back = await call(bucket, { mode: 'contestGet', month: '2026-09' });
    t.equal('it exists now', back.body.exists, true);
    t.equal('the day is there', back.body.data.days['2026-09-01']['Alyssa Dimes'].adherence, 96);
    t.check('and it is stamped', typeof back.body.data.updatedAt === 'string');

    // Months are separate objects, so September cannot overwrite October.
    await call(bucket, { mode: 'contestSave', month: '2026-10', data: { days: { '2026-10-01': {} } } });
    const sept = await call(bucket, { mode: 'contestGet', month: '2026-09' });
    t.equal('September is untouched by an October save',
        Object.keys(sept.body.data.days)[0], '2026-09-01');
});

suite('contest: a bad month or payload is refused, not stored', async (t) => {
    const bucket = createFakeR2();

    // The month goes into an R2 key, so it is pinned to the exact shape.
    const bad = await call(bucket, { mode: 'contestGet', month: '../../state/latest' });
    t.equal('a crafted month is refused', bad.status, 400);

    const badSave = await call(bucket, { mode: 'contestSave', month: '2026-13-XX', data: { days: {} } });
    t.equal('so is a malformed month on save', badSave.status, 400);

    const noDays = await call(bucket, { mode: 'contestSave', month: '2026-09', data: { nope: true } });
    t.equal('a payload with no days is refused', noDays.status, 400);
    t.check('and nothing was written', !bucket._objects.has('state/contest/2026-09.json'));
});
