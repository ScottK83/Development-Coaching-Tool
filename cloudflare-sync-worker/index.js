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
      // Use constant-time comparison to prevent timing attacks
      if (!providedSyncSecret || !timingSafeEqual(providedSyncSecret, expectedSyncSecret)) {
        return json({ error: 'Unauthorized sync request (invalid or missing shared secret).' }, 401, corsHeaders(requestOrigin, allowedOrigin));
      }
    }

    // KV binding required for sync/retrieve
    if (!env.COACHING_DATA) {
      return json({ error: 'Missing KV namespace binding: COACHING_DATA' }, 500, corsHeaders(requestOrigin, allowedOrigin));
    }

    try {
      const body = await request.json();
      const mode = String(body?.mode || '').trim();
      const cors = corsHeaders(requestOrigin, allowedOrigin);

      // ============================================
      // RETRIEVE: Read backup from KV
      // ============================================
      if (mode === 'retrieve') {
        const stored = await env.COACHING_DATA.get('backup', { type: 'json' });
        if (!stored) {
          return json({ ok: false, error: 'No backup found in storage.' }, 404, cors);
        }
        return json({ ok: true, mode: 'retrieve', payload: stored, generatedAt: stored?.generatedAt || null }, 200, cors);
      }

      // ============================================
      // UPLOAD FILE: Still uses GitHub for file storage
      // ============================================
      if (mode === 'uploadFile') {
        if (!env.GH_TOKEN || !env.GH_OWNER || !env.GH_REPO) {
          return json({ error: 'Missing GitHub config for file uploads.' }, 500, cors);
        }
        const branch = env.GH_BRANCH || 'main';
        const dataDir = env.GH_DATA_DIR || 'data';
        const uploadResult = await handleUploadFileToRepo({ env, body, branch, dataDir });
        return json({
          ok: true,
          mode: 'uploadFile',
          branch,
          path: uploadResult.path,
          fileName: uploadResult.fileName,
          commit: uploadResult.commitSha,
          generatedAt: new Date().toISOString()
        }, 200, cors);
      }

      // ============================================
      // SYNC: Write backup to KV (+ optional GitHub)
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
        reliabilityTracker: sanitizeForRepo(coerce(body?.reliabilityTracker)),
        followUpHistory: sanitizeForRepo(coerce(body?.followUpHistory, { entries: [] })),
        hotTipHistory: sanitizeForRepo(coerce(body?.hotTipHistory, { entries: [] })),
        yearEndAnnualGoalsStore: sanitizeForRepo(coerce(body?.yearEndAnnualGoalsStore)),
        yearEndDraftStore: sanitizeForRepo(coerce(body?.yearEndDraftStore)),
        employeePreferredNames: sanitizeForRepo(coerce(body?.employeePreferredNames)),
        appStorageSnapshot: sanitizeForRepo(coerce(body?.appStorageSnapshot))
      };

      const incomingHasData = hasMeaningfulData(fullBackupPayload);

      // Check existing backup for regression guard
      const existingBackup = await env.COACHING_DATA.get('backup', { type: 'json' });
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

      // Write to KV
      await env.COACHING_DATA.put('backup', JSON.stringify(fullBackupPayload));

      // Optional: also write to GitHub if configured (non-blocking)
      if (env.GH_TOKEN && env.GH_OWNER && env.GH_REPO) {
        const branch = env.GH_BRANCH || 'main';
        const dataDir = env.GH_DATA_DIR || 'data';
        try {
          await upsertRepoFile({
            env, branch,
            path: `${dataDir}/coaching-tool-sync-backup.json`,
            message: `chore(data): sync full coaching backup (${reason})`,
            content: JSON.stringify(fullBackupPayload, null, 2)
          });
        } catch (ghErr) {
          console.error('GitHub sync failed (non-blocking):', ghErr.message);
        }
      }

      return json({
        ok: true,
        generatedAt,
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
  // Use the request origin in the CORS header if it passes the allowlist check
  // This is necessary for Cloudflare Pages subdomain deployments
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

function isAllowedOrigin(requestOrigin, allowedOrigin) {
  const safeAllowed = String(allowedOrigin || '').trim();
  // Default-deny: if ALLOWED_ORIGIN is not configured, reject all origins
  if (!safeAllowed) return false;
  const safeRequest = String(requestOrigin || '').trim();
  // Exact match
  if (safeRequest === safeAllowed) return true;
  // Allow Cloudflare Pages deployment subdomains (e.g. abc123.development-coaching-tool.pages.dev)
  try {
    const allowedHost = new URL(safeAllowed).hostname;
    const requestHost = new URL(safeRequest).hostname;
    if (requestHost.endsWith('.' + allowedHost)) return true;
  } catch (e) { /* invalid URL, fall through */ }
  return false;
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function timingSafeEqual(a, b) {
  const strA = String(a);
  const strB = String(b);
  if (strA.length !== strB.length) {
    // Still do a comparison to avoid length-based timing leak
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
    payload.myTeamMembers, payload.callCenterAverages].some(hasEntries);
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
  return ck(p?.weeklyData) * 100 + ck(p?.ytdData) * 100 + cn(p?.coachingHistory) + cn(p?.callListeningLogs) + cn(p?.associateSentimentSnapshots) + ck(p?.myTeamMembers);
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
// GITHUB FILE UPLOAD (for Excel/file uploads only)
// ============================================

async function githubRequest(env, path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dev-coaching-tool-sync-worker',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GitHub API ${response.status}: ${errorText}`);
  }
  return response.json();
}

async function getExistingFileSha(env, branch, path) {
  try {
    const file = await githubRequest(env, `/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(branch)}`);
    return file?.sha || null;
  } catch (e) {
    if (String(e.message || '').includes('404')) return null;
    throw e;
  }
}

async function upsertRepoFile({ env, branch, path, message, content }) {
  const encodedContent = btoa(unescape(encodeURIComponent(content)));
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const sha = await getExistingFileSha(env, branch, path);
      const payload = { message, content: encodedContent, branch };
      if (sha) payload.sha = sha;
      const result = await githubRequest(env, `/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return { commitSha: result?.commit?.sha || null };
    } catch (e) {
      if (attempt < 3 && String(e.message || '').toLowerCase().includes('409')) {
        await new Promise(r => setTimeout(r, attempt * 250));
        continue;
      }
      throw e;
    }
  }
}

/**
 * Upload a file using pre-encoded base64 content (binary-safe, no double-encoding)
 */
async function upsertRepoFileBase64({ env, branch, path, message, contentBase64 }) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const sha = await getExistingFileSha(env, branch, path);
      const payload = { message, content: contentBase64, branch };
      if (sha) payload.sha = sha;
      const result = await githubRequest(env, `/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/')}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      return { commitSha: result?.commit?.sha || null };
    } catch (e) {
      if (attempt < 3 && String(e.message || '').toLowerCase().includes('409')) {
        await new Promise(r => setTimeout(r, attempt * 250));
        continue;
      }
      throw e;
    }
  }
}

async function handleUploadFileToRepo({ env, body, branch, dataDir }) {
  const rawFileName = String(body?.fileName || '').trim();
  const fileName = rawFileName.split(/[\\/]/).pop().trim()
    .replace(/\s+/g, '-').replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').replace(/^-+/g, '').replace(/-+$/g, '');
  if (!fileName) throw new Error('Missing or invalid fileName.');
  const contentBase64 = String(body?.fileContentBase64 || '').replace(/\s+/g, '');
  if (!contentBase64) throw new Error('Missing fileContentBase64.');
  const uploadsDir = String(env.GH_UPLOADS_DIR || `${dataDir}/uploads`).trim();
  const path = `${uploadsDir}/${fileName}`;
  // Pass base64 content directly to avoid double-encode corruption with binary files
  const result = await upsertRepoFileBase64({ env, branch, path, message: `chore(data): upload file ${fileName}`, contentBase64 });
  return { fileName, path, commitSha: result.commitSha };
}
