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
      // DELETE ALL: Wipe latest backup (snapshots stay as safety net)
      // ============================================
      if (mode === 'deleteAll') {
        await env.COACHING_BUCKET.delete('state/latest.json');
        await env.COACHING_BUCKET.delete('state/coachingHistory.csv');
        return json({ ok: true, mode: 'deleteAll', deletedAt: new Date().toISOString() }, 200, cors);
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
