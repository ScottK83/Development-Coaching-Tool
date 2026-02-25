export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (!env.GH_TOKEN || !env.GH_OWNER || !env.GH_REPO) {
      return json({ error: 'Missing worker secrets/config: GH_TOKEN, GH_OWNER, GH_REPO' }, 500);
    }

    try {
      const body = await request.json();
      const callListeningLogs = body?.callListeningLogs && typeof body.callListeningLogs === 'object'
        ? body.callListeningLogs
        : {};
      const csvFromClient = typeof body?.callListeningCsv === 'string' ? body.callListeningCsv : '';
      const reason = String(body?.reason || 'updated').trim() || 'updated';
      const generatedAt = new Date().toISOString();
      const branch = env.GH_BRANCH || 'main';
      const dataDir = env.GH_DATA_DIR || 'data';

      const jsonPath = `${dataDir}/call-listening-logs.json`;
      const csvPath = `${dataDir}/call-listening-logs.csv`;
      const fullBackupPath = `${dataDir}/coaching-tool-sync-backup.json`;

      const normalizedPayload = {
        generatedAt,
        reason,
        sourceAppVersion: body?.appVersion || null,
        callListeningLogs
      };

      const fullBackupPayload = {
        generatedAt,
        reason,
        sourceAppVersion: body?.appVersion || null,
        weeklyData: body?.weeklyData && typeof body.weeklyData === 'object' ? body.weeklyData : {},
        ytdData: body?.ytdData && typeof body.ytdData === 'object' ? body.ytdData : {},
        coachingHistory: body?.coachingHistory && typeof body.coachingHistory === 'object' ? body.coachingHistory : {},
        callListeningLogs,
        sentimentPhraseDatabase: body?.sentimentPhraseDatabase && typeof body.sentimentPhraseDatabase === 'object' ? body.sentimentPhraseDatabase : null,
        associateSentimentSnapshots: body?.associateSentimentSnapshots && typeof body.associateSentimentSnapshots === 'object' ? body.associateSentimentSnapshots : {},
        myTeamMembers: body?.myTeamMembers && typeof body.myTeamMembers === 'object' ? body.myTeamMembers : {},
        callCenterAverages: body?.callCenterAverages && typeof body.callCenterAverages === 'object' ? body.callCenterAverages : {},
        yearEndAnnualGoalsStore: body?.yearEndAnnualGoalsStore && typeof body.yearEndAnnualGoalsStore === 'object' ? body.yearEndAnnualGoalsStore : {},
        yearEndDraftStore: body?.yearEndDraftStore && typeof body.yearEndDraftStore === 'object' ? body.yearEndDraftStore : {},
        appStorageSnapshot: body?.appStorageSnapshot && typeof body.appStorageSnapshot === 'object' ? body.appStorageSnapshot : {}
      };

      const csvContent = csvFromClient || buildCsvFromLogs(callListeningLogs);

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
        generatedAt
      });
    } catch (error) {
      return json({ error: error.message || 'Unexpected worker error' }, 500);
    }
  }
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function buildCsvCell(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
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

async function upsertRepoFile({ env, branch, path, message, content }) {
  const sha = await getExistingFileSha(env, branch, path);
  const encodedContent = btoa(unescape(encodeURIComponent(content)));

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
}
