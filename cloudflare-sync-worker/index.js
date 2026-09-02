export default {
  async fetch(request, env) {
    const allowedOrigin = String(env.ALLOWED_ORIGIN || '').trim();

    if (request.method === 'OPTIONS') {
      const requestOrigin = String(request.headers.get('origin') || '').trim();
      const originAllowed = isAllowedOrigin(requestOrigin, allowedOrigin);
      return new Response(null, {
        status: originAllowed ? 204 : 403,
        headers: corsHeaders(requestOrigin, allowedOrigin)
      });
    }

    // GET /files/<name> serves uploaded files from R2 uploads/.
    // Top-level navigations (window.open) don't send Origin, so we accept
    // either Origin or Referer matching ALLOWED_ORIGIN.
    if (request.method === 'GET') {
      const url = new URL(request.url);
      const filesMatch = url.pathname.match(/^\/files\/(.+)$/);
      if (!filesMatch) {
        return new Response('Not Found', { status: 404 });
      }
      const refererOrigin = safeOrigin(request.headers.get('referer'));
      const requestOrigin = String(request.headers.get('origin') || '').trim();
      const sourceOrigin = requestOrigin || refererOrigin;
      if (!isAllowedOrigin(sourceOrigin, allowedOrigin)) {
        return new Response('Forbidden', { status: 403 });
      }
      if (!env.COACHING_BUCKET) {
        return new Response('Bucket not configured', { status: 500 });
      }
      const fileName = decodeURIComponent(filesMatch[1]).split(/[\\/]/).pop();
      const obj = await env.COACHING_BUCKET.get(`uploads/${fileName}`);
      if (!obj) {
        return new Response('File not found', { status: 404 });
      }
      const headers = new Headers();
      headers.set('Content-Type', obj.httpMetadata?.contentType || guessContentType(fileName));
      headers.set('Cache-Control', 'no-store');
      return new Response(obj.body, { status: 200, headers });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: corsHeaders(request.headers.get('origin'), allowedOrigin)
      });
    }

    const requestOrigin = String(request.headers.get('origin') || '').trim();
    if (!isAllowedOrigin(requestOrigin, allowedOrigin)) {
      return json({ error: 'Forbidden origin.' }, 403, corsHeaders(requestOrigin, allowedOrigin));
    }

    const expectedSyncSecret = String(env.SYNC_SHARED_SECRET || '').trim();
    if (expectedSyncSecret) {
      const providedSyncSecret = String(request.headers.get('x-sync-secret') || '').trim();
      if (!providedSyncSecret || !timingSafeEqual(providedSyncSecret, expectedSyncSecret)) {
        return json({ error: 'Unauthorized sync request (invalid or missing shared secret).' }, 401, corsHeaders(requestOrigin, allowedOrigin));
      }
    }

    if (!env.COACHING_BUCKET) {
      return json({ error: 'Missing R2 bucket binding: COACHING_BUCKET' }, 500, corsHeaders(requestOrigin, allowedOrigin));
    }

    try {
      const body = await request.json();
      const mode = String(body?.mode || '').trim();
      const cors = corsHeaders(requestOrigin, allowedOrigin);

      // ============================================
      // RETRIEVE: Read latest backup from R2
      // ============================================
      if (mode === 'retrieve') {
        const obj = await env.COACHING_BUCKET.get('state/latest.json');
        if (!obj) {
          return json({ ok: false, error: 'No backup found in storage.' }, 404, cors);
        }
        const stored = await obj.json();
        return json({ ok: true, mode: 'retrieve', payload: stored, generatedAt: stored?.generatedAt || null }, 200, cors);
      }

      // ============================================
      // V2: MANIFEST / BLOBS / COMMIT
      // ============================================
      // Store values are immutable blobs named by the sha256 of their bytes.
      // The manifest is the only mutable object, and it is written under an
      // If-Match compare-and-swap. So in steady state a write only ADDS bytes:
      // the sole thing that can be overwritten is a small manifest, and only by
      // a writer holding the current etag.
      //
      // That is what makes two machines safe. A client sends a DELTA of the
      // shards it changed; the worker applies it onto the CURRENT manifest, so
      // a shard the client did not name is carried forward from live state and
      // never from the client's stale snapshot. Two machines editing different
      // stores both survive with no prompt.

      if (mode === 'v2.manifest') {
        const head = await env.COACHING_BUCKET.head(V2_MANIFEST_KEY);
        if (!head) {
          // Deliberately NOT an invitation to seed. A transient miss must never
          // license a client to write its whole local view over production, so
          // creating the first manifest is a separate, explicit operation.
          return json({ ok: true, mode: 'v2.manifest', exists: false, manifest: null, etag: null }, 200, cors);
        }
        const obj = await env.COACHING_BUCKET.get(V2_MANIFEST_KEY);
        if (!obj) {
          return json({ ok: false, code: 'MANIFEST_VANISHED', error: 'The manifest existed a moment ago and does not now. Retry.' }, 409, cors);
        }
        // etag travels in the body: corsHeaders sets no Expose-Headers, so a
        // response header would be unreadable from the page.
        return json({ ok: true, mode: 'v2.manifest', exists: true, manifest: await obj.json(), etag: obj.etag }, 200, cors);
      }

      if (mode === 'v2.putBlob') {
        const hash = String(body?.hash || '').trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(hash)) {
          return json({ ok: false, error: 'A blob hash must be 64 lowercase hex characters.' }, 400, cors);
        }
        if (typeof body?.bytes !== 'string') {
          return json({ ok: false, error: 'A blob needs its bytes as a JSON string.' }, 400, cors);
        }
        // Content-addressed: verify the name matches the content. Without this
        // a client bug could store bytes under a hash nothing resolves to, and
        // the manifest would point at the wrong content forever.
        const actual = await sha256Hex(body.bytes);
        if (actual !== hash) {
          return json({ ok: false, code: 'HASH_MISMATCH', error: `Bytes hash to ${actual}, not ${hash}.` }, 400, cors);
        }
        // Immutable: an existing blob with this hash already holds these exact
        // bytes, so re-writing is pure cost.
        const existing = await env.COACHING_BUCKET.head(`${V2_OBJECTS_PREFIX}${hash}.json`);
        if (!existing) {
          await env.COACHING_BUCKET.put(`${V2_OBJECTS_PREFIX}${hash}.json`, body.bytes, {
            httpMetadata: { contentType: 'application/json' }
          });
        }
        return json({ ok: true, mode: 'v2.putBlob', hash, alreadyPresent: !!existing }, 200, cors);
      }

      // One blob, streamed. The batch route below cannot serve a large shard,
      // and a store must never be unreadable because of how it is packaged.
      if (mode === 'v2.getBlob') {
        const hash = String(body?.hash || '').trim().toLowerCase();
        if (!/^[0-9a-f]{64}$/.test(hash)) {
          return json({ ok: false, error: 'A blob hash must be 64 lowercase hex characters.' }, 400, cors);
        }
        const obj = await env.COACHING_BUCKET.get(`${V2_OBJECTS_PREFIX}${hash}.json`);
        if (!obj) {
          return json({ ok: false, code: 'BLOB_MISSING', error: `No blob stored for ${hash}.` }, 404, cors);
        }
        return new Response(obj.body, {
          status: 200,
          headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=31536000, immutable' }
        });
      }

      if (mode === 'v2.commit') {
        const changed = body?.changed;
        if (!changed || typeof changed !== 'object' || Array.isArray(changed)) {
          return json({ ok: false, error: 'A commit needs a changed map of shard name to hash.' }, 400, cors);
        }

        const head = await env.COACHING_BUCKET.head(V2_MANIFEST_KEY);

        if (!head) {
          // Create-if-absent, and only when the client explicitly says so. A
          // client that treats a missing manifest as permission to seed turns
          // any transient 404 into an unguarded whole-state overwrite, via the
          // least-tested path in the system.
          if (body?.intent !== 'create') {
            return json({
              ok: false,
              code: 'NO_MANIFEST',
              error: 'No manifest exists. Creating the first one is a separate, explicit operation.'
            }, 409, cors);
          }
          const created = buildManifest({ version: 1, shards: changed, device: body?.device, prev: null });
          // etagMatches on a non-existent key never matches, so guard the
          // create with a re-check instead of a conditional put.
          const raced = await env.COACHING_BUCKET.head(V2_MANIFEST_KEY);
          if (raced) {
            return json({ ok: false, code: 'CAS_CONFLICT', error: 'Another machine created the manifest first. Re-read and commit again.' }, 409, cors);
          }
          await env.COACHING_BUCKET.put(V2_MANIFEST_KEY, JSON.stringify(created), { httpMetadata: { contentType: 'application/json' } });
          const after = await env.COACHING_BUCKET.head(V2_MANIFEST_KEY);
          await writeJournal(env, created, body);
          return json({ ok: true, mode: 'v2.commit', created: true, manifest: created, etag: after?.etag || null }, 200, cors);
        }

        const baseEtag = String(body?.baseEtag || '').trim();
        if (!baseEtag) {
          return json({ ok: false, code: 'NO_BASE_ETAG', error: 'A commit against an existing manifest must carry the etag it was based on.' }, 400, cors);
        }

        const currentObj = await env.COACHING_BUCKET.get(V2_MANIFEST_KEY);
        const current = await currentObj.json();

        // The delta is applied onto CURRENT, not onto whatever the client last
        // saw. A shard the client did not name keeps the live value.
        const nextShards = { ...(current.shards || {}) };
        for (const [shardName, hash] of Object.entries(changed)) {
          if (hash === null) delete nextShards[shardName];
          else if (/^[0-9a-f]{64}$/.test(String(hash))) nextShards[shardName] = String(hash);
          else return json({ ok: false, error: `Shard ${shardName} has an invalid hash.` }, 400, cors);
        }

        const next = buildManifest({
          version: (Number(current.version) || 0) + 1,
          shards: nextShards,
          device: body?.device,
          prev: current
        });

        const put = await env.COACHING_BUCKET.put(V2_MANIFEST_KEY, JSON.stringify(next), {
          httpMetadata: { contentType: 'application/json' },
          onlyIf: { etagMatches: baseEtag }
        });

        // R2 resolves to null rather than throwing when the precondition fails.
        if (put === null) {
          const freshObj = await env.COACHING_BUCKET.get(V2_MANIFEST_KEY);
          return json({
            ok: false,
            code: 'CAS_CONFLICT',
            error: 'The manifest moved since you read it. Rebase your changes onto this one and commit again.',
            manifest: await freshObj.json(),
            etag: freshObj.etag
          }, 409, cors);
        }

        const after = await env.COACHING_BUCKET.head(V2_MANIFEST_KEY);
        await writeJournal(env, next, body);
        return json({ ok: true, mode: 'v2.commit', created: false, manifest: next, etag: after?.etag || null }, 200, cors);
      }

      // ============================================
      // CONTEST: read and write straight to R2
      // ============================================
      // No browser copy at all. The contest panel reads this when it opens and
      // writes it when a day is saved, so the numbers live in one place and the
      // machine you typed them on stops mattering.

      if (mode === 'contestGet') {
        const month = String(body?.month || '').trim();
        if (!/^\d{4}-\d{2}$/.test(month)) {
          return json({ ok: false, error: 'A contest month must look like YYYY-MM.' }, 400, cors);
        }
        const obj = await env.COACHING_BUCKET.get(`state/contest/${month}.json`);
        if (!obj) {
          return json({ ok: true, mode: 'contestGet', month, data: { days: {} }, exists: false }, 200, cors);
        }
        return json({ ok: true, mode: 'contestGet', month, data: await obj.json(), exists: true }, 200, cors);
      }

      if (mode === 'contestSave') {
        const month = String(body?.month || '').trim();
        if (!/^\d{4}-\d{2}$/.test(month)) {
          return json({ ok: false, error: 'A contest month must look like YYYY-MM.' }, 400, cors);
        }
        const data = body?.data;
        if (!data || typeof data !== 'object' || typeof data.days !== 'object') {
          return json({ ok: false, error: 'A contest save needs a data object with days.' }, 400, cors);
        }
        const serialized = JSON.stringify({ days: data.days, updatedAt: new Date().toISOString() });
        await env.COACHING_BUCKET.put(`state/contest/${month}.json`, serialized, {
          httpMetadata: { contentType: 'application/json' }
        });
        // Read back rather than trusting the put, so "saved" means stored.
        const check = await env.COACHING_BUCKET.get(`state/contest/${month}.json`);
        const stored = check ? await check.json() : null;
        return json({
          ok: true, mode: 'contestSave', month,
          days: Object.keys(stored?.days || {}).length
        }, 200, cors);
      }

      // ============================================
      // LIST SNAPSHOTS: What point-in-time copies exist
      // ============================================
      // Every sync already writes state/snapshots/YYYY-MM-DD.json and deleteAll
      // deliberately leaves them, so this history has existed all along with no
      // way to see it. Without this, recovery means "restore the latest", which
      // is no help at all when the latest is the thing that went wrong.
      if (mode === 'listSnapshots') {
        const listed = await env.COACHING_BUCKET.list({ prefix: 'state/snapshots/', limit: 1000 });
        const snapshots = (listed.objects || [])
          .map((obj) => ({
            date: obj.key.replace('state/snapshots/', '').replace(/\.json$/, ''),
            key: obj.key,
            size: obj.size,
            uploadedAt: obj.uploaded ? new Date(obj.uploaded).toISOString() : null
          }))
          .sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
        return json({ ok: true, mode: 'listSnapshots', snapshots, truncated: !!listed.truncated }, 200, cors);
      }

      // ============================================
      // RETRIEVE SNAPSHOT: Read one specific day's copy
      // ============================================
      if (mode === 'retrieveSnapshot') {
        const date = String(body?.date || '').trim();
        // Pinned to the exact key shape rather than interpolated, so a crafted
        // date cannot reach anything else in the bucket.
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return json({ ok: false, error: 'A snapshot date must look like YYYY-MM-DD.' }, 400, cors);
        }
        const obj = await env.COACHING_BUCKET.get(`state/snapshots/${date}.json`);
        if (!obj) {
          return json({ ok: false, error: `No snapshot stored for ${date}.` }, 404, cors);
        }
        const stored = await obj.json();
        return json({
          ok: true,
          mode: 'retrieveSnapshot',
          date,
          payload: stored,
          generatedAt: stored?.generatedAt || null
        }, 200, cors);
      }

      // ============================================
      // DELETE ALL: Wipe latest backup (snapshots stay as safety net)
      // ============================================
      if (mode === 'deleteAll') {
        await env.COACHING_BUCKET.delete('state/latest.json');
        await env.COACHING_BUCKET.delete('state/coachingHistory.csv');

        // Without this, delete-all silently stops working once v2 is live: it
        // would leave the manifest intact and the next boot on any machine
        // would resurrect everything the user just deleted.
        //
        // The manifest is replaced with an empty one rather than removed, so
        // the other machine sees a real version bump and empties itself, rather
        // than seeing no manifest and deciding it should seed one from its own
        // stale local copy. Blobs are deliberately left: they are unreachable
        // once unreferenced, and they are what a snapshot restore needs.
        let v2Cleared = false;
        const head = await env.COACHING_BUCKET.head(V2_MANIFEST_KEY);
        if (head) {
          const currentObj = await env.COACHING_BUCKET.get(V2_MANIFEST_KEY);
          const current = await currentObj.json();
          const tombstone = buildManifest({
            version: (Number(current.version) || 0) + 1,
            shards: {},
            device: body?.device || 'deleteAll',
            prev: current
          });
          tombstone.deletedAll = true;
          await env.COACHING_BUCKET.put(V2_MANIFEST_KEY, JSON.stringify(tombstone), {
            httpMetadata: { contentType: 'application/json' }
          });
          v2Cleared = true;
        }

        return json({ ok: true, mode: 'deleteAll', deletedAt: new Date().toISOString(), v2Cleared }, 200, cors);
      }

      // ============================================
      // UPLOAD FILE: Store binary file in R2 uploads/
      // ============================================
      if (mode === 'uploadFile') {
        const uploadResult = await handleUploadFileToR2({ env, body });
        return json({
          ok: true,
          mode: 'uploadFile',
          path: uploadResult.path,
          fileName: uploadResult.fileName,
          generatedAt: new Date().toISOString()
        }, 200, cors);
      }

      // ============================================
      // SYNC: Write backup to R2 (latest + dated snapshot)
      // ============================================
      const reason = String(body?.reason || 'updated').trim() || 'updated';
      const generatedAt = new Date().toISOString();

      const fullBackupPayload = {
        generatedAt,
        reason,
        sourceAppVersion: body?.appVersion || null,
        weeklyData: sanitizeForRepo(coerce(body?.weeklyData)),
        ytdData: sanitizeForRepo(coerce(body?.ytdData)),
        coachingHistory: sanitizeForRepo(coerce(body?.coachingHistory)),
        callListeningLogs: sanitizeForRepo(coerce(body?.callListeningLogs)),
        sentimentPhraseDatabase: sanitizeForRepo(body?.sentimentPhraseDatabase && typeof body.sentimentPhraseDatabase === 'object' ? body.sentimentPhraseDatabase : null),
        associateSentimentSnapshots: sanitizeForRepo(coerce(body?.associateSentimentSnapshots)),
        myTeamMembers: sanitizeForRepo(coerce(body?.myTeamMembers)),
        callCenterAverages: sanitizeForRepo(coerce(body?.callCenterAverages)),
        ptoTracker: sanitizeForRepo(coerce(body?.ptoTracker, { entries: [] })),
        reliabilityTracker: sanitizeForRepo(coerce(body?.reliabilityTracker || body?.attendanceTracker)),
        attendanceTracker: sanitizeForRepo(coerce(body?.attendanceTracker)),
        followUpHistory: sanitizeForRepo(coerce(body?.followUpHistory, { entries: [] })),
        hotTipHistory: sanitizeForRepo(coerce(body?.hotTipHistory, { entries: [] })),
        yearEndAnnualGoalsStore: sanitizeForRepo(coerce(body?.yearEndAnnualGoalsStore)),
        yearEndDraftStore: sanitizeForRepo(coerce(body?.yearEndDraftStore)),
        employeePreferredNames: sanitizeForRepo(coerce(body?.employeePreferredNames)),
        // The client has been sending these on every push and this literal has
        // been dropping them, so they had no remote copy at all. verbatimStores
        // is the map of every store without a named field above: dailyData,
        // tipUsageHistory, oneOnOneMeetings, midYearMeta, celebrationsHistory,
        // weeklyFocalPoints, employeeSupervisors and the rest. It is the client's
        // catch-all, and reconstructing this payload field by field is exactly
        // what a catch-all exists to survive.
        //
        // Its values are already-serialized JSON strings, so sanitizeForRepo is
        // applied to the map and rewrites the strings in place.
        verbatimStores: sanitizeForRepo(coerce(body?.verbatimStores)),
        executiveSummaryNotes: sanitizeForRepo(coerce(body?.executiveSummaryNotes)),
        userCustomTips: sanitizeForRepo(coerce(body?.userCustomTips)),
        yoyBaseline2025: sanitizeForRepo(body?.yoyBaseline2025 && typeof body.yoyBaseline2025 === 'object' ? body.yoyBaseline2025 : null),
        appStorageSnapshot: sanitizeForRepo(coerce(body?.appStorageSnapshot))
      };

      const incomingHasData = hasMeaningfulData(fullBackupPayload);

      // Regression guard: read existing latest backup
      const existingObj = await env.COACHING_BUCKET.get('state/latest.json');
      const existingBackup = existingObj ? await existingObj.json() : null;
      const existingHasData = hasMeaningfulData(existingBackup);
      const incomingSummary = summarizeFreshness(fullBackupPayload);
      const existingSummary = summarizeFreshness(existingBackup);

      if (!incomingHasData && existingHasData) {
        return json({
          ok: false,
          code: 'EMPTY_PAYLOAD_GUARD',
          error: 'Refusing to overwrite non-empty backup with an empty payload.'
        }, 409, cors);
      }

      const allowDataRegression = body?.allowDataRegression === true;
      if (!allowDataRegression && isRegression({ incomingHasData, existingHasData, incomingSummary, existingSummary })) {
        return json({
          ok: false,
          code: 'DATA_REGRESSION_GUARD',
          error: 'Incoming backup appears older or less complete. Restore latest backup on this device first.',
          incomingSummary,
          existingSummary
        }, 409, cors);
      }

      const serialized = JSON.stringify(fullBackupPayload);
      const jsonHeaders = { httpMetadata: { contentType: 'application/json' } };

      // Write latest + dated snapshot (snapshots overwrite within same day)
      const snapshotKey = `state/snapshots/${generatedAt.slice(0, 10)}.json`;
      await Promise.all([
        env.COACHING_BUCKET.put('state/latest.json', serialized, jsonHeaders),
        env.COACHING_BUCKET.put(snapshotKey, serialized, jsonHeaders)
      ]);

      // Human-readable coaching history CSV for Excel review
      const coachingCsv = typeof body?.coachingHistoryCsv === 'string' ? body.coachingHistoryCsv : '';
      if (coachingCsv.trim()) {
        await env.COACHING_BUCKET.put('state/coachingHistory.csv', sanitizeText(coachingCsv), {
          httpMetadata: { contentType: 'text/csv; charset=utf-8' }
        });
      }

      return json({
        ok: true,
        generatedAt,
        snapshotKey,
        incomingSummary,
        existingSummary
      }, 200, cors);

    } catch (error) {
      return json({ error: error.message || 'Unexpected worker error' }, 500, corsHeaders(request.headers.get('origin'), allowedOrigin));
    }
  }
};

// ============================================
// V2 HELPERS
// ============================================

const V2_MANIFEST_KEY = 'state/v2/manifest.json';
const V2_OBJECTS_PREFIX = 'state/v2/objects/';
const V2_JOURNAL_PREFIX = 'state/v2/journal/';

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function buildManifest({ version, shards, device, prev }) {
  return {
    schema: 2,
    version,
    // The worker's clock, not the client's. Two machines with skewed clocks
    // would otherwise produce a version history that does not order.
    updatedAt: new Date().toISOString(),
    updatedBy: String(device || 'unknown').slice(0, 64),
    prevVersion: prev ? (Number(prev.version) || 0) : null,
    shards: shards || {}
  };
}

/**
 * A small record of who changed what. Nothing reads it yet; it exists so that
 * "which machine wrote this, and when" is answerable at all, which it is not
 * today. Failure here must never fail the commit that already landed.
 */
async function writeJournal(env, manifest, body) {
  try {
    const key = `${V2_JOURNAL_PREFIX}${manifest.updatedAt}-${manifest.updatedBy}.json`;
    await env.COACHING_BUCKET.put(key, JSON.stringify({
      version: manifest.version,
      prevVersion: manifest.prevVersion,
      device: manifest.updatedBy,
      at: manifest.updatedAt,
      reason: String(body?.reason || '').slice(0, 200),
      appVersion: body?.appVersion || null,
      changed: body?.changed || {}
    }), { httpMetadata: { contentType: 'application/json' } });
  } catch (error) {
    console.warn('[v2] journal write failed, commit stands:', error && error.message);
  }
}

// ============================================
// HELPERS
// ============================================

function coerce(value, fallback = {}) {
  return value && typeof value === 'object' ? value : fallback;
}

function json(data, status = 200, headers = corsHeaders()) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' }
  });
}

function corsHeaders(requestOrigin = '', allowedOrigin = '') {
  const safeRequest = String(requestOrigin || '').trim();
  const origin = isAllowedOrigin(safeRequest, allowedOrigin) ? safeRequest : String(allowedOrigin || '').trim();
  if (!origin) {
    return {
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Secret',
      'Vary': 'Origin'
    };
  }
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Secret',
    'Vary': 'Origin'
  };
}

function safeOrigin(referer) {
  try {
    if (!referer) return '';
    return new URL(referer).origin;
  } catch (e) {
    return '';
  }
}

function isAllowedOrigin(requestOrigin, allowedOrigin) {
  const safeAllowed = String(allowedOrigin || '').trim();
  if (!safeAllowed) return false;
  const safeRequest = String(requestOrigin || '').trim();
  if (safeRequest === safeAllowed) return true;
  try {
    const allowedHost = new URL(safeAllowed).hostname;
    const requestHost = new URL(safeRequest).hostname;
    if (requestHost.endsWith('.' + allowedHost)) return true;
  } catch (e) { /* invalid URL, fall through */ }
  return false;
}

function timingSafeEqual(a, b) {
  const strA = String(a);
  const strB = String(b);
  if (strA.length !== strB.length) {
    let result = strA.length ^ strB.length;
    for (let i = 0; i < strA.length; i++) {
      result |= strA.charCodeAt(i) ^ (strB.charCodeAt(i % strB.length) || 0);
    }
    return result === 0;
  }
  let result = 0;
  for (let i = 0; i < strA.length; i++) {
    result |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
  }
  return result === 0;
}

// ============================================
// DATA VALIDATION
// ============================================

function hasMeaningfulData(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const hasEntries = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    if (Array.isArray(value)) return value.some(hasEntries);
    if (typeof value !== 'object') return false;
    const keys = Object.keys(value);
    return keys.length > 0 && keys.some(k => hasEntries(value[k]));
  };
  return [payload.weeklyData, payload.ytdData, payload.coachingHistory, payload.callListeningLogs,
    payload.associateSentimentSnapshots, payload.myTeamMembers, payload.callCenterAverages,
    payload.ptoTracker, payload.reliabilityTracker, payload.attendanceTracker, payload.followUpHistory, payload.hotTipHistory,
    payload.yearEndAnnualGoalsStore, payload.yearEndDraftStore, payload.employeePreferredNames,
    payload.appStorageSnapshot].some(hasEntries);
}

function summarizeFreshness(payload) {
  if (!payload) return { weeklyPeriods: 0, ytdPeriods: 0, footprintScore: 0 };
  const wKeys = objKeys(payload.weeklyData);
  const yKeys = objKeys(payload.ytdData);
  const latestMs = getLatestPeriodEndMs(payload.weeklyData);
  return {
    generatedAt: payload.generatedAt || null,
    weeklyPeriods: wKeys.length,
    ytdPeriods: yKeys.length,
    latestWeeklyEndDate: latestMs ? new Date(latestMs).toISOString().slice(0, 10) : null,
    latestWeeklyEndMs: latestMs,
    footprintScore: getFootprintScore(payload)
  };
}

function isRegression({ incomingHasData, existingHasData, incomingSummary, existingSummary }) {
  if (!incomingHasData || !existingHasData) return false;
  const il = Number(incomingSummary?.latestWeeklyEndMs || 0);
  const el = Number(existingSummary?.latestWeeklyEndMs || 0);
  if (il && el && il < el) return true;
  if (!il && el) return Number(incomingSummary?.footprintScore || 0) < Number(existingSummary?.footprintScore || 0);
  if (il === el && il > 0) {
    const ifs = Number(incomingSummary?.footprintScore || 0);
    const efs = Number(existingSummary?.footprintScore || 0);
    if (ifs > 0 && efs > 0 && ifs < efs) return true;
  }
  return false;
}

function objKeys(v) { return (v && typeof v === 'object' && !Array.isArray(v)) ? Object.keys(v) : []; }

function getLatestPeriodEndMs(periodMap) {
  if (!periodMap || typeof periodMap !== 'object') return 0;
  let latest = 0;
  for (const [key, val] of Object.entries(periodMap)) {
    const candidates = [];
    if (key.includes('|')) candidates.push(key.split('|')[1]);
    const meta = val?.metadata || {};
    candidates.push(meta.endDate, meta.weekEndingDate, meta.weekEndDate, meta.periodEndDate);
    for (const c of candidates) {
      const ms = Date.parse(String(c || '').trim());
      if (!isNaN(ms)) latest = Math.max(latest, ms);
    }
  }
  return latest;
}

function getFootprintScore(p) {
  const ck = (v) => (v && typeof v === 'object' && !Array.isArray(v)) ? Object.keys(v).length : 0;
  const cn = (v) => {
    if (!v || typeof v !== 'object') return 0;
    return Object.values(v).reduce((s, i) => s + (Array.isArray(i) ? i.length : (i && typeof i === 'object') ? Object.keys(i).length : 0), 0);
  };
  return ck(p?.weeklyData) * 100 + ck(p?.ytdData) * 100 + cn(p?.coachingHistory) + cn(p?.callListeningLogs) + cn(p?.associateSentimentSnapshots) + ck(p?.myTeamMembers) + cn(p?.ptoTracker) + cn(p?.reliabilityTracker) + cn(p?.attendanceTracker) + cn(p?.followUpHistory) + cn(p?.hotTipHistory) + ck(p?.yearEndAnnualGoalsStore) + ck(p?.yearEndDraftStore) + ck(p?.employeePreferredNames) + ck(p?.appStorageSnapshot);
}

// ============================================
// SANITIZATION
// ============================================

function sanitizeText(text) {
  return String(text || '')
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED]')
    .replace(/ghp_[A-Za-z0-9]{30,}/g, '[REDACTED]')
    .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED]');
}

function sanitizeForRepo(value, keyHint = '') {
  if (value === null || value === undefined) return value;
  if (/(token|secret|password|api[_-]?key|authorization|cookie)/i.test(String(keyHint))) return '[REDACTED]';
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(item => sanitizeForRepo(item, keyHint));
  if (typeof value === 'object') {
    const result = {};
    for (const [k, v] of Object.entries(value)) result[k] = sanitizeForRepo(v, k);
    return result;
  }
  return value;
}

// ============================================
// FILE UPLOADS (Excel etc. -> R2 uploads/)
// ============================================

async function handleUploadFileToR2({ env, body }) {
  const rawFileName = String(body?.fileName || '').trim();
  const fileName = rawFileName.split(/[\\/]/).pop().trim()
    .replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-+/g, '').replace(/-+$/g, '');
  if (!fileName) throw new Error('Missing or invalid fileName.');
  const contentBase64 = String(body?.fileContentBase64 || '').replace(/\s+/g, '');
  if (!contentBase64) throw new Error('Missing fileContentBase64.');

  // Decode base64 to bytes for R2
  const binaryString = atob(contentBase64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) bytes[i] = binaryString.charCodeAt(i);

  const path = `uploads/${fileName}`;
  const contentType = guessContentType(fileName);
  await env.COACHING_BUCKET.put(path, bytes, {
    httpMetadata: { contentType }
  });
  return { fileName, path };
}

function guessContentType(fileName) {
  const lower = String(fileName).toLowerCase();
  if (lower.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (lower.endsWith('.xls')) return 'application/vnd.ms-excel';
  if (lower.endsWith('.csv')) return 'text/csv; charset=utf-8';
  if (lower.endsWith('.json')) return 'application/json';
  if (lower.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}
