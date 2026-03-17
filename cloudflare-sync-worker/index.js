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
      if (!providedSyncSecret || providedSyncSecret !== expectedSyncSecret) {
        return json({ error: 'Unauthorized sync request (invalid or missing shared secret).' }, 401, corsHeaders(requestOrigin, allowedOrigin));
      }
    }

    if (!env.GH_TOKEN || !env.GH_OWNER || !env.GH_REPO) {
      return json({ error: 'Missing worker secrets/config: GH_TOKEN, GH_OWNER, GH_REPO' }, 500, corsHeaders(requestOrigin, allowedOrigin));
    }

    try {
      const body = await request.json();
      const mode = String(body?.mode || '').trim();
      const allowDataRegression = body?.allowDataRegression === true;
      const callListeningLogs = body?.callListeningLogs && typeof body.callListeningLogs === 'object'
        ? body.callListeningLogs
        : {};
      const csvFromClient = typeof body?.callListeningCsv === 'string' ? body.callListeningCsv : '';
      const reason = String(body?.reason || 'updated').trim() || 'updated';
      const generatedAt = new Date().toISOString();
      const branch = env.GH_BRANCH || 'main';
      const dataDir = env.GH_DATA_DIR || 'data';

      if (mode === 'retrieve') {
        const backupPath = `${dataDir}/coaching-tool-sync-backup.json`;
        const fileRes = await fetch(`https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${backupPath}?ref=${branch}`, {
          headers: {
            Authorization: `token ${env.GH_TOKEN}`,
            Accept: 'application/vnd.github.v3.raw',
            'User-Agent': 'CloudflareWorker'
          }
        });
        if (!fileRes.ok) {
          return json({ ok: false, error: `Failed to fetch backup from repo: HTTP ${fileRes.status}` }, fileRes.status, corsHeaders(requestOrigin, allowedOrigin));
        }
        const backupData = await fileRes.json();
        return json({ ok: true, mode: 'retrieve', payload: backupData, generatedAt: backupData?.generatedAt || null }, 200, corsHeaders(requestOrigin, allowedOrigin));
      }

      if (mode === 'uploadFile') {
        const uploadResult = await handleUploadFileToRepo({
          env,
          body,
          branch,
          dataDir
        });

        return json({
          ok: true,
          mode: 'uploadFile',
          branch,
          path: uploadResult.path,
          fileName: uploadResult.fileName,
          commit: uploadResult.commitSha,
          generatedAt
        }, 200, corsHeaders(requestOrigin, allowedOrigin));
      }

      const jsonPath = `${dataDir}/call-listening-logs.json`;
      const csvPath = `${dataDir}/call-listening-logs.csv`;
      const fullBackupPath = `${dataDir}/coaching-tool-sync-backup.json`;
      const sanitizedCallListeningLogs = sanitizeForRepo(callListeningLogs);

      const normalizedPayload = {
        generatedAt,
        reason,
        sourceAppVersion: body?.appVersion || null,
        callListeningLogs: sanitizedCallListeningLogs
      };

      const fullBackupPayload = {
        generatedAt,
        reason,
        sourceAppVersion: body?.appVersion || null,
        weeklyData: sanitizeForRepo(body?.weeklyData && typeof body.weeklyData === 'object' ? body.weeklyData : {}),
        ytdData: sanitizeForRepo(body?.ytdData && typeof body.ytdData === 'object' ? body.ytdData : {}),
        coachingHistory: sanitizeForRepo(body?.coachingHistory && typeof body.coachingHistory === 'object' ? body.coachingHistory : {}),
        callListeningLogs: sanitizedCallListeningLogs,
        sentimentPhraseDatabase: sanitizeForRepo(body?.sentimentPhraseDatabase && typeof body.sentimentPhraseDatabase === 'object' ? body.sentimentPhraseDatabase : null),
        associateSentimentSnapshots: sanitizeForRepo(body?.associateSentimentSnapshots && typeof body.associateSentimentSnapshots === 'object' ? body.associateSentimentSnapshots : {}),
        myTeamMembers: sanitizeForRepo(body?.myTeamMembers && typeof body.myTeamMembers === 'object' ? body.myTeamMembers : {}),
        callCenterAverages: sanitizeForRepo(body?.callCenterAverages && typeof body.callCenterAverages === 'object' ? body.callCenterAverages : {}),
        ptoTracker: sanitizeForRepo(body?.ptoTracker && typeof body.ptoTracker === 'object' ? body.ptoTracker : { entries: [] }),
        followUpHistory: sanitizeForRepo(body?.followUpHistory && typeof body.followUpHistory === 'object' ? body.followUpHistory : { entries: [] }),
        hotTipHistory: sanitizeForRepo(body?.hotTipHistory && typeof body.hotTipHistory === 'object' ? body.hotTipHistory : { entries: [] }),
        yearEndAnnualGoalsStore: sanitizeForRepo(body?.yearEndAnnualGoalsStore && typeof body.yearEndAnnualGoalsStore === 'object' ? body.yearEndAnnualGoalsStore : {}),
        yearEndDraftStore: sanitizeForRepo(body?.yearEndDraftStore && typeof body.yearEndDraftStore === 'object' ? body.yearEndDraftStore : {}),
        appStorageSnapshot: sanitizeForRepo(body?.appStorageSnapshot && typeof body.appStorageSnapshot === 'object' ? body.appStorageSnapshot : {})
      };

      const incomingHasData = hasMeaningfulBackupData(fullBackupPayload);
      const existingBackup = await getRepoJsonFile(env, branch, fullBackupPath);
      const existingHasData = hasMeaningfulBackupData(existingBackup);
      const incomingSummary = summarizeBackupFreshness(fullBackupPayload);
      const existingSummary = summarizeBackupFreshness(existingBackup);

      if (!incomingHasData && existingHasData) {
        return json({
          ok: false,
          code: 'EMPTY_PAYLOAD_GUARD',
          error: 'Refusing to overwrite non-empty repo backup with an empty payload. Use a browser profile with synced data.'
        }, 409, corsHeaders(requestOrigin, allowedOrigin));
      }

      const isRegression = isIncomingBackupRegression({
        incomingHasData,
        existingHasData,
        incomingSummary,
        existingSummary
      });

      if (!allowDataRegression && isRegression) {
        return json({
          ok: false,
          code: 'DATA_REGRESSION_GUARD',
          error: 'Incoming backup appears older or less complete than repo backup. Restore latest repo backup on this device before syncing.',
          incomingSummary,
          existingSummary
        }, 409, corsHeaders(requestOrigin, allowedOrigin));
      }

      const csvContent = sanitizeCsvText(csvFromClient || buildCsvFromLogs(sanitizedCallListeningLogs));

      const jsonResult = await upsertRepoFile({
        env,
        branch,
        path: jsonPath,
        message: `chore(data): sync call listening logs (${reason})`,
        content: JSON.stringify(normalizedPayload, null, 2)
      });

      const csvResult = await upsertRepoFile({
        env,
        branch,
        path: csvPath,
        message: `chore(data): sync call listening csv (${reason})`,
        content: csvContent
      });

      const fullBackupResult = await upsertRepoFile({
        env,
        branch,
        path: fullBackupPath,
        message: `chore(data): sync full coaching backup (${reason})`,
        content: JSON.stringify(fullBackupPayload, null, 2)
      });

      return json({
        ok: true,
        branch,
        jsonPath,
        csvPath,
        fullBackupPath,
        jsonCommit: jsonResult.commitSha,
        csvCommit: csvResult.commitSha,
        fullBackupCommit: fullBackupResult.commitSha,
        generatedAt,
        incomingSummary,
        existingSummary
      }, 200, corsHeaders(requestOrigin, allowedOrigin));
    } catch (error) {
      return json({ error: error.message || 'Unexpected worker error' }, 500, corsHeaders(request.headers.get('origin'), allowedOrigin));
    }
  }
};

function json(data, status = 200, headers = corsHeaders()) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    }
  });
}

function corsHeaders(requestOrigin = '', allowedOrigin = '') {
  const safeAllowedOrigin = String(allowedOrigin || '').trim();
  const safeRequestOrigin = String(requestOrigin || '').trim();
  const allowOrigin = safeAllowedOrigin || (safeRequestOrigin || '*');

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Sync-Secret',
    'Vary': 'Origin'
  };
}

function isAllowedOrigin(requestOrigin, allowedOrigin) {
  const safeAllowed = String(allowedOrigin || '').trim();
  if (!safeAllowed) return true;
  return String(requestOrigin || '').trim() === safeAllowed;
}

function summarizeBackupFreshness(payload) {
  const weeklyKeys = getObjectKeys(payload?.weeklyData);
  const ytdKeys = getObjectKeys(payload?.ytdData);
  const latestWeeklyEndMs = getLatestPeriodEndMs(payload?.weeklyData);

  return {
    generatedAt: payload?.generatedAt || null,
    weeklyPeriods: weeklyKeys.length,
    ytdPeriods: ytdKeys.length,
    latestWeeklyEndDate: latestWeeklyEndMs ? new Date(latestWeeklyEndMs).toISOString().slice(0, 10) : null,
    latestWeeklyEndMs,
    footprintScore: getBackupFootprintScore(payload)
  };
}

function isIncomingBackupRegression({ incomingHasData, existingHasData, incomingSummary, existingSummary }) {
  if (!incomingHasData || !existingHasData) return false;

  const incomingLatest = Number(incomingSummary?.latestWeeklyEndMs || 0);
  const existingLatest = Number(existingSummary?.latestWeeklyEndMs || 0);

  if (incomingLatest && existingLatest && incomingLatest < existingLatest) {
    return true;
  }

  if (!incomingLatest && existingLatest) {
    const incomingFootprint = Number(incomingSummary?.footprintScore || 0);
    const existingFootprint = Number(existingSummary?.footprintScore || 0);
    return incomingFootprint < existingFootprint;
  }

  if (incomingLatest && existingLatest && incomingLatest === existingLatest) {
    const incomingFootprint = Number(incomingSummary?.footprintScore || 0);
    const existingFootprint = Number(existingSummary?.footprintScore || 0);
    if (incomingFootprint > 0 && existingFootprint > 0 && incomingFootprint < existingFootprint) {
      return true;
    }
  }

  return false;
}

function getObjectKeys(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.keys(value);
}

function getLatestPeriodEndMs(periodMap) {
  if (!periodMap || typeof periodMap !== 'object') return 0;

  let latest = 0;
  Object.entries(periodMap).forEach(([periodKey, periodValue]) => {
    const candidates = [];
    const keyText = String(periodKey || '');
    if (keyText.includes('|')) {
      candidates.push(keyText.split('|')[1]);
    }

    const metadata = periodValue?.metadata || {};
    candidates.push(metadata.endDate, metadata.weekEndingDate, metadata.weekEndDate, metadata.periodEndDate);

    candidates.forEach(candidate => {
      const parsed = Date.parse(String(candidate || '').trim());
      if (!Number.isNaN(parsed)) {
        latest = Math.max(latest, parsed);
      }
    });
  });

  return latest;
}

function getBackupFootprintScore(payload) {
  const countObjectKeys = (value) => (value && typeof value === 'object' && !Array.isArray(value))
    ? Object.keys(value).length
    : 0;

  const countNestedEntries = (value) => {
    if (!value || typeof value !== 'object') return 0;
    return Object.values(value).reduce((sum, item) => {
      if (Array.isArray(item)) return sum + item.length;
      if (item && typeof item === 'object') return sum + Object.keys(item).length;
      return sum;
    }, 0);
  };

  return (
    countObjectKeys(payload?.weeklyData) * 100
    + countObjectKeys(payload?.ytdData) * 100
    + countNestedEntries(payload?.coachingHistory)
    + countNestedEntries(payload?.callListeningLogs)
    + countNestedEntries(payload?.associateSentimentSnapshots)
    + countObjectKeys(payload?.myTeamMembers)
  );
}

function hasMeaningfulBackupData(payload) {
  if (!payload || typeof payload !== 'object') return false;

  const hasEntries = (value) => {
    if (value === null || value === undefined) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (typeof value === 'number') return Number.isFinite(value);
    if (typeof value === 'boolean') return value;
    if (Array.isArray(value)) {
      return value.some(item => hasEntries(item));
    }
    if (typeof value !== 'object') return false;

    const keys = Object.keys(value);
    if (!keys.length) return false;
    return keys.some(key => hasEntries(value[key]));
  };

  return [
    payload.weeklyData,
    payload.ytdData,
    payload.coachingHistory,
    payload.callListeningLogs,
    payload.associateSentimentSnapshots,
    payload.myTeamMembers,
    payload.callCenterAverages,
    payload.ptoTracker,
    payload.yearEndAnnualGoalsStore,
    payload.yearEndDraftStore,
    payload.appStorageSnapshot
  ].some(hasEntries);
}

function buildCsvCell(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function sanitizeCsvText(text) {
  return sanitizeText(String(text || ''));
}

function sanitizeText(text) {
  return String(text || '')
    .replace(/github_pat_[A-Za-z0-9_]{20,}/g, '[REDACTED_GH_PAT]')
    .replace(/ghp_[A-Za-z0-9]{30,}/g, '[REDACTED_GH_TOKEN]')
    .replace(/glpat-[A-Za-z0-9_\-]{20,}/g, '[REDACTED_GITLAB_PAT]')
    .replace(/AIza[0-9A-Za-z\-_]{20,}/g, '[REDACTED_API_KEY]')
    .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED_SECRET]');
}

function sanitizeForRepo(value, keyHint = '') {
  if (value === null || value === undefined) return value;

  const keyName = String(keyHint || '');
  if (/(token|secret|password|api[_-]?key|authorization|cookie)/i.test(keyName)) {
    return '[REDACTED]';
  }

  if (typeof value === 'string') {
    return sanitizeText(value);
  }

  if (Array.isArray(value)) {
    return value.map(item => sanitizeForRepo(item, keyHint));
  }

  if (typeof value === 'object') {
    const result = {};
    for (const [key, nested] of Object.entries(value)) {
      result[key] = sanitizeForRepo(nested, key);
    }
    return result;
  }

  return value;
}

function buildCsvFromLogs(callListeningLogs) {
  const headers = [
    'Associate',
    'Call Date',
    'Call Reference',
    'What Went Well',
    'Improvement Areas',
    'Oscar URL',
    'Relevant Info',
    'Manager Notes',
    'Created At'
  ];
  const lines = [headers.join(',')];

  Object.entries(callListeningLogs || {}).forEach(([employeeName, entries]) => {
    (entries || []).forEach(entry => {
      lines.push([
        buildCsvCell(employeeName),
        buildCsvCell(entry.listenedOn || ''),
        buildCsvCell(entry.callReference || ''),
        buildCsvCell(entry.whatWentWell || ''),
        buildCsvCell(entry.improvementAreas || ''),
        buildCsvCell(entry.oscarUrl || ''),
        buildCsvCell(entry.relevantInfo || ''),
        buildCsvCell(entry.managerNotes || ''),
        buildCsvCell(entry.createdAt || '')
      ].join(','));
    });
  });

  return lines.join('\n');
}

async function handleUploadFileToRepo({ env, body, branch, dataDir }) {
  const rawFileName = String(body?.fileName || '').trim();
  const fileName = sanitizeUploadFileName(rawFileName);
  if (!fileName) {
    throw new Error('Missing or invalid fileName for uploadFile mode.');
  }


  const base64Input = String(body?.fileContentBase64 || '').trim();
  const contentBase64 = normalizeBase64Content(base64Input);
  if (!contentBase64) {
    throw new Error('Missing fileContentBase64 for uploadFile mode.');
  }

  const uploadsDir = String(env.GH_UPLOADS_DIR || `${dataDir}/uploads`).trim() || `${dataDir}/uploads`;
  const path = `${uploadsDir}/${fileName}`;
  const message = `chore(data): upload file ${fileName}`;

  const result = await upsertRepoFileBase64({
    env,
    branch,
    path,
    message,
    contentBase64
  });

  return {
    fileName,
    path,
    commitSha: result.commitSha
  };
}

function sanitizeUploadFileName(fileName) {
  const baseName = String(fileName || '')
    .split(/[\\/]/)
    .pop()
    .trim();

  if (!baseName) return '';

  const sanitized = baseName
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '-');

  return sanitized.replace(/-+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
}


function normalizeBase64Content(value) {
  const cleaned = String(value || '').replace(/\s+/g, '');
  if (!cleaned) return '';

  if (!/^[A-Za-z0-9+/=]+$/.test(cleaned)) {
    throw new Error('fileContentBase64 contains invalid characters.');
  }

  if (cleaned.length > 30 * 1024 * 1024) {
    throw new Error('Uploaded file is too large for worker upload limit.');
  }

  return cleaned;
}

async function githubRequest(env, path, options = {}) {
  const apiUrl = `https://api.github.com${path}`;
  const response = await fetch(apiUrl, {
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
    const file = await githubRequest(env, `/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/') }?ref=${encodeURIComponent(branch)}`);
    return file?.sha || null;
  } catch (error) {
    if (String(error.message || '').includes('404')) {
      return null;
    }
    throw error;
  }
}

async function getRepoJsonFile(env, branch, path) {
  try {
    const file = await githubRequest(env, `/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/') }?ref=${encodeURIComponent(branch)}`);
    const encoded = file?.content;
    if (!encoded) return null;

    const normalized = String(encoded).replace(/\n/g, '');
    const decoded = decodeURIComponent(escape(atob(normalized)));
    return JSON.parse(decoded);
  } catch (error) {
    if (String(error.message || '').includes('404')) {
      return null;
    }
    throw error;
  }
}

async function upsertRepoFile({ env, branch, path, message, content }) {
  const encodedContent = btoa(unescape(encodeURIComponent(content)));
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const sha = await getExistingFileSha(env, branch, path);

      const payload = {
        message,
        content: encodedContent,
        branch
      };

      if (sha) payload.sha = sha;

      const result = await githubRequest(env, `/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/') }`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      return {
        commitSha: result?.commit?.sha || null,
        contentSha: result?.content?.sha || null
      };
    } catch (error) {
      if (attempt < maxAttempts && isGithubContentConflictError(error)) {
        await waitForRetry(attempt);
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Failed to upsert ${path} after ${maxAttempts} attempts.`);
}

async function upsertRepoFileBase64({ env, branch, path, message, contentBase64 }) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const sha = await getExistingFileSha(env, branch, path);

      const payload = {
        message,
        content: contentBase64,
        branch
      };

      if (sha) payload.sha = sha;

      const result = await githubRequest(env, `/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${encodeURIComponent(path).replace(/%2F/g, '/') }`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      return {
        commitSha: result?.commit?.sha || null,
        contentSha: result?.content?.sha || null
      };
    } catch (error) {
      if (attempt < maxAttempts && isGithubContentConflictError(error)) {
        await waitForRetry(attempt);
        continue;
      }

      throw error;
    }
  }

  throw new Error(`Failed to upload ${path} after ${maxAttempts} attempts.`);
}

function isGithubContentConflictError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('github api 409')
    || msg.includes('does not match')
    || msg.includes('sha') && msg.includes('match');
}

async function waitForRetry(attemptNumber) {
  const delayMs = Math.min(900, attemptNumber * 250);
  await new Promise(resolve => setTimeout(resolve, delayMs));
}
