/* ========================================
   REPO SYNC MODULE
   Repository synchronization, backup/restore,
   storage hooks, and diagnostics
   ======================================== */

(function() {
    'use strict';

    // ============================================
    // CONSTANTS
    // ============================================
    const STORAGE_PREFIX = 'devCoachingTool_';
    const CALL_LISTENING_SYNC_CONFIG_STORAGE_KEY = STORAGE_PREFIX + 'callListeningSyncConfig';
    const REPO_SYNC_LAST_SUCCESS_STORAGE_KEY = STORAGE_PREFIX + 'repoSyncLastSuccess';
    const REPO_BACKUP_APPLIED_AT_STORAGE_KEY = STORAGE_PREFIX + 'repoBackupAppliedAt';

    const RETRY_MAX_ATTEMPTS = 3;
    const RETRY_BASE_DELAY_MS = 1000;
    const SYNC_DEBOUNCE_MS = 5000;
    const SYNC_ERROR_COOLDOWN_MS = 60000;

    function safeLoadJson(key) {
        try {
            const raw = localStorage.getItem(STORAGE_PREFIX + key);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }

    // ============================================
    // INTERNAL STATE
    // ============================================
    let repoSyncStorageHookInstalled = false;
    let repoSyncSuppressCounter = 0;
    let repoSyncHydrationInProgress = false;
    let repoSyncConflictPromptMutedUntil = 0;
    let repoSyncAutoPausedReason = '';
    let repoSyncAutoPausedExistingSummary = null;
    let callListeningSyncTimer = null;
    let repoSyncErrorCooldownUntil = 0;

    // ============================================
    // CONFIG HELPERS
    // ============================================

    function getDefaultCallListeningSyncConfig() {
        return {
            endpoint: 'https://dev-coaching-sync.scottk.workers.dev',
            autoSyncEnabled: true,
            sharedSecret: '',
            isWorkPc: false
        };
    }

    function loadCallListeningSyncConfig() {
        try {
            const raw = localStorage.getItem(CALL_LISTENING_SYNC_CONFIG_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : {};
            const defaults = getDefaultCallListeningSyncConfig();
            return {
                endpoint: typeof parsed?.endpoint === 'string' ? parsed.endpoint : defaults.endpoint,
                autoSyncEnabled: typeof parsed?.autoSyncEnabled === 'boolean' ? parsed.autoSyncEnabled : defaults.autoSyncEnabled,
                sharedSecret: typeof parsed?.sharedSecret === 'string' ? parsed.sharedSecret : defaults.sharedSecret,
                isWorkPc: typeof parsed?.isWorkPc === 'boolean' ? parsed.isWorkPc : defaults.isWorkPc
            };
        } catch (error) {
            console.error('Error loading call listening sync config:', error);
            return getDefaultCallListeningSyncConfig();
        }
    }

    function saveCallListeningSyncConfig(config) {
        const safeConfig = {
            endpoint: String(config?.endpoint || '').trim(),
            autoSyncEnabled: Boolean(config?.autoSyncEnabled),
            sharedSecret: String(config?.sharedSecret || '').trim(),
            isWorkPc: Boolean(config?.isWorkPc)
        };
        try {
            withRepoSyncSuppressed(() => {
                localStorage.setItem(CALL_LISTENING_SYNC_CONFIG_STORAGE_KEY, JSON.stringify(safeConfig));
            });
        } catch (error) {
            console.error('Error saving call listening sync config:', error);
        }
        return safeConfig;
    }

    function enforceRepoAutoSyncEnabled() {
        const defaults = getDefaultCallListeningSyncConfig();
        const current = loadCallListeningSyncConfig();

        const endpoint = String(current?.endpoint || '').trim() || defaults.endpoint;
        const normalized = {
            endpoint,
            autoSyncEnabled: current?.autoSyncEnabled === false ? false : true,
            sharedSecret: String(current?.sharedSecret || '').trim(),
            isWorkPc: Boolean(current?.isWorkPc)
        };

        const endpointChanged = String(current?.endpoint || '').trim() !== endpoint;
        const autoSyncChanged = current?.autoSyncEnabled !== normalized.autoSyncEnabled;

        if (endpointChanged || autoSyncChanged) {
            saveCallListeningSyncConfig(normalized);
        }

        return normalized;
    }

    // ============================================
    // STATUS DISPLAY
    // ============================================

    function setCallListeningSyncStatus(message, type = 'info') {
        const statusEl = document.getElementById('callListeningSyncStatus');
        const color = type === 'success' ? '#2e7d32' : type === 'error' ? '#b71c1c' : '#546e7a';
        if (statusEl) {
            statusEl.style.color = color;
            statusEl.textContent = message;
        }

        const footerSyncStatus = document.getElementById('syncStatusFooter');
        if (footerSyncStatus) {
            footerSyncStatus.textContent = `Sync: ${message || 'unknown'}`;
            footerSyncStatus.style.color = color;
        }
    }

    function setAutoSyncEnabledStatus(config) {
        if (config?.autoSyncEnabled && String(config?.endpoint || '').trim()) {
            setCallListeningSyncStatus('Auto-sync enabled. Changes will sync after save/update/delete.', 'info');
        } else {
            setCallListeningSyncStatus('Auto-sync disabled. Add Worker URL and enable auto-sync to push to repo.', 'info');
        }
    }

    function setRepoSyncQueuedStatus() {
        setCallListeningSyncStatus('Sync queued (all app data)...', 'info');
    }

    function setRepoExcelUploadStatus(message, type = 'info') {
        const statusEl = document.getElementById('repoExcelUploadStatus');
        if (!statusEl) return;

        statusEl.textContent = message;
        if (type === 'success') {
            statusEl.style.color = '#2e7d32';
        } else if (type === 'error') {
            statusEl.style.color = '#c62828';
        } else {
            statusEl.style.color = '#546e7a';
        }
    }

    // ============================================
    // SUPPRESSION / STORAGE HOOKS
    // ============================================

    function withRepoSyncSuppressed(action) {
        repoSyncSuppressCounter += 1;
        try {
            return action();
        } finally {
            repoSyncSuppressCounter = Math.max(0, repoSyncSuppressCounter - 1);
        }
    }

    // Only these keys represent meaningful data changes worth syncing to GitHub
    const SYNCABLE_STORAGE_KEYS = new Set([
        STORAGE_PREFIX + 'weeklyData',
        STORAGE_PREFIX + 'ytdData',
        STORAGE_PREFIX + 'coachingHistory',
        STORAGE_PREFIX + 'myTeamMembers',
        STORAGE_PREFIX + 'callCenterAverages',
        STORAGE_PREFIX + 'callListeningLogs',
        STORAGE_PREFIX + 'yearEndDraftEntries',
        STORAGE_PREFIX + 'yearEndAnnualGoals',
        STORAGE_PREFIX + 'employeePreferredNames',
        STORAGE_PREFIX + 'userCustomTips',
        STORAGE_PREFIX + 'sentimentPhraseDatabase',
        STORAGE_PREFIX + 'associateSentimentSnapshots',
        STORAGE_PREFIX + 'executiveSummaryNotes',
        STORAGE_PREFIX + 'ptoTracker'
    ]);

    function shouldSyncForStorageKey(key) {
        return SYNCABLE_STORAGE_KEYS.has(String(key || ''));
    }

    function installRepoSyncStorageHooks() {
        if (repoSyncStorageHookInstalled || !window?.Storage?.prototype) return;

        const storageProto = window.Storage.prototype;
        const originalSetItem = storageProto.setItem;
        const originalRemoveItem = storageProto.removeItem;
        const originalClear = storageProto.clear;

        storageProto.setItem = function patchedSetItem(key, value) {
            const result = originalSetItem.call(this, key, value);
            if (repoSyncSuppressCounter === 0 && shouldSyncForStorageKey(key)) {
                queueRepoSync(`storage set: ${key}`);
            }
            return result;
        };

        storageProto.removeItem = function patchedRemoveItem(key) {
            const result = originalRemoveItem.call(this, key);
            if (repoSyncSuppressCounter === 0 && shouldSyncForStorageKey(key)) {
                queueRepoSync(`storage remove: ${key}`);
            }
            return result;
        };

        storageProto.clear = function patchedClear() {
            const result = originalClear.call(this);
            if (repoSyncSuppressCounter === 0) {
                queueRepoSync('localStorage cleared');
            }
            return result;
        };

        repoSyncStorageHookInstalled = true;
    }

    // ============================================
    // LAST-SUCCESS PERSISTENCE
    // ============================================

    function loadRepoSyncLastSuccess() {
        try {
            const raw = localStorage.getItem(REPO_SYNC_LAST_SUCCESS_STORAGE_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch (error) {
            console.error('Error loading last repo sync metadata:', error);
            return null;
        }
    }

    function saveRepoSyncLastSuccess(meta) {
        try {
            withRepoSyncSuppressed(() => {
                localStorage.setItem(REPO_SYNC_LAST_SUCCESS_STORAGE_KEY, JSON.stringify(meta || {}));
            });
        } catch (error) {
            console.error('Error saving last repo sync metadata:', error);
        }
    }

    function renderCallListeningLastSync(meta = null) {
        const el = document.getElementById('callListeningLastSync');
        const data = meta || loadRepoSyncLastSuccess();
        const lastSyncFooterEl = document.getElementById('lastSyncFooter');

        if (!data?.syncedAt) {
            if (el) {
                el.textContent = 'Last successful sync: none yet';
            }
            if (lastSyncFooterEl) {
                lastSyncFooterEl.textContent = 'Last Sync: none yet';
            }
            return;
        }

        const when = new Date(data.syncedAt).toLocaleString();
        const dirLabel = data.direction === 'retrieve' ? '⬇️ Retrieved' : data.direction === 'upload' ? '⬆️ Uploaded' : '🔄 Synced';
        if (el) {
            el.textContent = `Last sync: ${dirLabel} ${when}`;
        }
        if (lastSyncFooterEl) {
            lastSyncFooterEl.textContent = `${dirLabel} ${when}`;
        }
    }

    // ============================================
    // DIAGNOSTICS
    // ============================================

    function buildDiagnosticsSummary() {
        const syncMeta = loadRepoSyncLastSuccess();
        const getTeamSelectionContext = window.getTeamSelectionContext || (() => ({}));
        const teamContext = getTeamSelectionContext();
        const shortCommit = String(syncMeta?.commit || '').trim().slice(0, 7) || 'n/a';
        const syncedAt = syncMeta?.syncedAt ? new Date(syncMeta.syncedAt).toLocaleString() : 'none';

        return [
            `Version: ${window.APP_VERSION || 'unknown'}`,
            `Deploy: ${shortCommit}`,
            `Last Sync: ${syncedAt}`,
            `Team Filter Week: ${teamContext.weekKey || 'none'}`,
            `Team Filter Mode: ${teamContext.isFiltering ? `${teamContext.selectedMembers.length} selected` : 'all associates'}`,
            `Current Period Type: ${safeLoadJson('currentPeriodType') || window.currentPeriodType || 'unknown'}`,
            `Current Period: ${window.currentPeriod || 'none'}`,
            `Weekly Periods Loaded: ${Object.keys(window.DevCoachModules?.storage?.loadWeeklyData?.() || {}).length}`,
            `YTD Periods Loaded: ${Object.keys(window.DevCoachModules?.storage?.loadYtdData?.() || {}).length}`
        ].join('\n');
    }

    function bindDiagnosticsCopyAction() {
        const button = document.getElementById('copyDiagnosticsBtn');
        if (!button || button.dataset.bound === 'true') return;

        button.addEventListener('click', async () => {
            const diagnostics = buildDiagnosticsSummary();
            try {
                await navigator.clipboard.writeText(diagnostics);
                showToast('Diagnostics copied.', 2500);
            } catch (_error) {
                alert(`Copy failed. Diagnostics:\n\n${diagnostics}`);
            }
        });

        button.dataset.bound = 'true';
    }

    // ============================================
    // UI CONFIG FROM DOM
    // ============================================

    function getCallListeningSyncConfigFromUI() {
        const endpoint = document.getElementById('callListeningSyncEndpoint')?.value || '';
        const autoSyncEnabled = document.getElementById('callListeningAutoSyncEnabled')?.checked ?? true;
        const isWorkPc = document.getElementById('callListeningIsWorkPc')?.checked ?? false;
        const existing = loadCallListeningSyncConfig();
        return saveCallListeningSyncConfig({ endpoint, autoSyncEnabled, sharedSecret: existing.sharedSecret, isWorkPc });
    }

    function getTotalCallListeningLogCount() {
        const callListeningLogs = safeLoadJson('callListeningLogs') || {};
        return Object.values(callListeningLogs).reduce((count, entries) => {
            return count + (Array.isArray(entries) ? entries.length : 0);
        }, 0);
    }

    async function runWithButtonBusyState(button, busyText, action) {
        if (!button) return;
        const buttonOriginalText = button.textContent;
        button.disabled = true;
        button.textContent = busyText;
        try {
            await action();
        } finally {
            button.disabled = false;
            button.textContent = buttonOriginalText;
        }
    }

    // ============================================
    // REPO SYNC CONTROLS INITIALIZATION
    // ============================================

    function initializeRepoSyncControls() {
        const syncEndpointInput = document.getElementById('callListeningSyncEndpoint');
        const isWorkPcCheckbox = document.getElementById('callListeningIsWorkPc');
        const autoSyncCheckbox = document.getElementById('callListeningAutoSyncEnabled');
        const syncNowBtn = document.getElementById('syncNowBtn');
        const forceRestoreBtn = document.getElementById('forceRestoreRepoBtn');
        const exportLedgerBtn = document.getElementById('exportIntelligenceLedgerXlsxBtn');
        const openFullExcelBtn = document.getElementById('openFullBackupExcelBtn');
        const openPtoExcelBtn = document.getElementById('openPtoExcelBtn');
        const uploadExcelBtn = document.getElementById('uploadExcelToRepoBtn');
        const openRepoUploadsFolderBtn = document.getElementById('openRepoUploadsFolderBtn');

        if (!syncEndpointInput || !autoSyncCheckbox || !syncNowBtn || !openFullExcelBtn) {
            return;
        }

        const syncConfig = loadCallListeningSyncConfig();
        syncEndpointInput.value = syncConfig.endpoint || '';
        if (isWorkPcCheckbox) isWorkPcCheckbox.checked = syncConfig.isWorkPc || false;
        autoSyncCheckbox.checked = syncConfig.autoSyncEnabled;
        setAutoSyncEnabledStatus(syncConfig);
        renderCallListeningLastSync();

        if (!syncNowBtn.dataset.bound) {
            syncNowBtn.addEventListener('click', async () => {
                const currentConfig = loadCallListeningSyncConfig();
                if (!currentConfig.isWorkPc) {
                    showToast('Sync is disabled — this is not marked as your Work PC.', 3500);
                    return;
                }
                await runWithButtonBusyState(syncNowBtn, 'Syncing...', async () => {
                    getCallListeningSyncConfigFromUI();
                    await syncRepoData('manual sync now', { force: true, allowDataRegression: true });
                });
            });
            syncNowBtn.dataset.bound = 'true';
        }
        if (forceRestoreBtn && !forceRestoreBtn.dataset.bound) {
            forceRestoreBtn.addEventListener('click', async () => {
                const confirmed = confirm('Restore from repo backup and overwrite ALL local data in this browser profile? This cannot be undone.');
                if (!confirmed) return;

                await runWithButtonBusyState(forceRestoreBtn, 'Restoring...', async () => {
                    setCallListeningSyncStatus('Restoring from repo backup (overwrite local)...', 'info');

                    try {
                        setCallListeningSyncStatus('Fetching backup from repo...', 'info');
                        const payload = await fetchRepoBackupPayload();
                        if (!hasMeaningfulBackupData(payload)) {
                            throw new Error('No repo backup data found to restore. The backup file may be empty or missing.');
                        }
                        setCallListeningSyncStatus('Applying backup data...', 'info');

                        await withRepoSyncHydrationLock(async () => {
                            applyRepoBackupPayload(payload);
                        });

                        saveRepoBackupAppliedAt(payload?.generatedAt || new Date().toISOString());
                        clearRepoSyncAutoPause();
                        repoSyncConflictPromptMutedUntil = 0;
                        saveRepoSyncLastSuccess({ syncedAt: new Date().toISOString(), reason: 'retrieve from git', direction: 'retrieve' });

                        setCallListeningSyncStatus('Restore complete. Reloading with restored profile...', 'success');
                        showToast('Local profile overwritten from repo backup.', 3500);
                        setTimeout(() => window.location.reload(), 500);
                    } catch (error) {
                        console.error('Force restore failed:', error);
                        setCallListeningSyncStatus(`Restore failed: ${error.message}`, 'error');
                        showToast(`Restore failed: ${error.message}`, 4000);
                    }
                });
            });
            forceRestoreBtn.dataset.bound = 'true';
        }
        const forcePushBtn = document.getElementById('forcePushToRepoBtn');
        if (forcePushBtn && !forcePushBtn.dataset.bound) {
            forcePushBtn.addEventListener('click', async () => {
                await runWithButtonBusyState(forcePushBtn, 'Uploading...', async () => {
                    getCallListeningSyncConfigFromUI();
                    setCallListeningSyncStatus('Uploading local data to GIT...', 'info');
                    await syncRepoData('upload to git', { force: true, allowDataRegression: true });
                });
            });
            forcePushBtn.dataset.bound = 'true';
        }
        if (!openFullExcelBtn.dataset.bound) {
            openFullExcelBtn.addEventListener('click', () => openRepoExcelFile('Development-Coaching-Tool.xlsx'));
            openFullExcelBtn.dataset.bound = 'true';
        }
        if (openPtoExcelBtn && !openPtoExcelBtn.dataset.bound) {
            openPtoExcelBtn.addEventListener('click', () => openRepoExcelFile('PTO-Tracking.xlsx'));
            openPtoExcelBtn.dataset.bound = 'true';
        }
        if (exportLedgerBtn && !exportLedgerBtn.dataset.bound) {
            exportLedgerBtn.addEventListener('click', async () => {
                await runWithButtonBusyState(exportLedgerBtn, 'Exporting...', async () => {
                    await exportIntelligenceLedgerWorkbook();
                });
            });
            exportLedgerBtn.dataset.bound = 'true';
        }
        if (uploadExcelBtn && !uploadExcelBtn.dataset.bound) {
            uploadExcelBtn.addEventListener('click', async () => {
                const currentConfig = loadCallListeningSyncConfig();
                if (!currentConfig.isWorkPc) {
                    showToast('Upload is disabled — this is not marked as your Work PC.', 3500);
                    return;
                }
                await runWithButtonBusyState(uploadExcelBtn, 'Uploading...', async () => {
                    await uploadExcelFileToRepo();
                });
            });
            uploadExcelBtn.dataset.bound = 'true';
        }
        if (openRepoUploadsFolderBtn && !openRepoUploadsFolderBtn.dataset.bound) {
            openRepoUploadsFolderBtn.addEventListener('click', () => {
                openRepoUploadsFolder();
            });
            openRepoUploadsFolderBtn.dataset.bound = 'true';
        }
        if (!syncEndpointInput.dataset.bound) {
            const persistEndpointConfig = () => {
                const nextConfig = getCallListeningSyncConfigFromUI();
                setAutoSyncEnabledStatus(nextConfig);
            };
            syncEndpointInput.addEventListener('change', persistEndpointConfig);
            syncEndpointInput.addEventListener('input', persistEndpointConfig);
            syncEndpointInput.dataset.bound = 'true';
        }
        if (isWorkPcCheckbox && !isWorkPcCheckbox.dataset.bound) {
            isWorkPcCheckbox.addEventListener('change', () => {
                getCallListeningSyncConfigFromUI();
            });
            isWorkPcCheckbox.dataset.bound = 'true';
        }
        if (!autoSyncCheckbox.dataset.bound) {
            autoSyncCheckbox.addEventListener('change', () => {
                const nextConfig = getCallListeningSyncConfigFromUI();
                setAutoSyncEnabledStatus(nextConfig);
            });
            autoSyncCheckbox.dataset.bound = 'true';
        }
    }

    // ============================================
    // FILE UPLOAD / EXCEL HELPERS
    // ============================================

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunkSize = 0x8000;

        for (let index = 0; index < bytes.length; index += chunkSize) {
            const chunk = bytes.subarray(index, index + chunkSize);
            binary += String.fromCharCode.apply(null, chunk);
        }

        return btoa(binary);
    }

    async function uploadExcelFileToRepo() {
        const fileInput = document.getElementById('repoExcelUploadInput');
        const files = fileInput?.files ? Array.from(fileInput.files) : [];

        if (files.length === 0) {
            setRepoExcelUploadStatus('Select one or more files first.', 'error');
            return;
        }

        const syncConfig = getCallListeningSyncConfigFromUI();
        const endpoint = String(syncConfig?.endpoint || '').trim();
        if (!endpoint) {
            setRepoExcelUploadStatus('Add Worker URL first in Auto-Sync Worker URL.', 'error');
            return;
        }

        const results = [];
        const errors = [];

        for (const file of files) {
            setRepoExcelUploadStatus(`Uploading ${file.name}${files.length > 1 ? ` (${results.length + errors.length + 1}/${files.length})` : ''}...`, 'info');
            try {
                const fileBuffer = await file.arrayBuffer();
                const fileContentBase64 = arrayBufferToBase64(fileBuffer);

                const response = await postRepoSyncPayload(endpoint, syncConfig, {
                    mode: 'uploadFile',
                    reason: `manual upload: ${file.name}`,
                    fileName: file.name,
                    fileContentBase64,
                    fileMimeType: file.type || ''
                });

                await throwIfRepoSyncErrorResponse(response);
                const responseData = await parseRepoSyncSuccessResponse(response);
                results.push(String(responseData?.path || file.name));
            } catch (error) {
                console.error(`Upload failed for ${file.name}:`, error);
                errors.push(`${file.name}: ${error.message}`);
            }
        }

        if (fileInput) fileInput.value = '';

        if (errors.length === 0) {
            setRepoExcelUploadStatus(
                files.length === 1
                    ? `Uploaded to repo: ${results[0]}`
                    : `Uploaded ${results.length} file(s) to repo successfully.`,
                'success'
            );
            showToast(`${files.length === 1 ? 'File' : `${results.length} files`} uploaded to repo`, 3000);
        } else if (results.length > 0) {
            setRepoExcelUploadStatus(`${results.length} uploaded, ${errors.length} failed: ${errors.join('; ')}`, 'error');
            showToast('Some uploads failed', 4500);
        } else {
            setRepoExcelUploadStatus(`Upload failed: ${errors.join('; ')}`, 'error');
            showToast(`Upload failed: ${errors[0]}`, 4500);
        }
    }

    function openRepoExcelFile(fileName) {
        const githubUrl = `https://github.com/ScottK83/Development-Coaching-Tool/raw/main/data/${encodeURIComponent(fileName)}?t=${Date.now()}`;
        const baseUrl = window?.location?.origin;
        const localUrl = baseUrl && baseUrl !== 'null' ? `${baseUrl}/data/${fileName}` : '';
        const fileUrl = githubUrl || localUrl;

        if (!fileUrl) {
            showToast('Could not build Excel file URL.', 3500);
            return;
        }

        if (fileName === 'call-listening-logs.xlsx') {
            const totalCallLogs = getTotalCallListeningLogCount();
            if (totalCallLogs === 0) {
                showToast('Call Logs Excel will be blank until at least one call listening entry is saved.', 4500);
            }
        }

        window.open(fileUrl, '_blank');
    }

    function openRepoUploadsFolder() {
        const uploadsFolderUrl = 'https://github.com/ScottK83/Development-Coaching-Tool/tree/main/data/uploads';
        window.open(uploadsFolderUrl, '_blank');
    }

    async function fetchReferenceCsvFromWorkspaceOrRepo(fileName) {
        const origin = window?.location?.origin;
        const cacheBust = `cb=${Date.now()}`;
        const candidates = [];

        if (origin && origin !== 'null') {
            candidates.push(`${origin}/data/${fileName}?${cacheBust}`);
        }

        candidates.push(`https://raw.githubusercontent.com/ScottK83/Development-Coaching-Tool/main/data/${encodeURIComponent(fileName)}?${cacheBust}`);

        for (const url of candidates) {
            try {
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) continue;
                const text = await response.text();
                if (String(text || '').trim()) return text;
            } catch (error) {
                // Try next candidate
            }
        }

        throw new Error(`Unable to load ${fileName}`);
    }

    function appendCsvAsSheet(workbook, csvText, sheetName) {
        const parsedWorkbook = XLSX.read(csvText, { type: 'string' });
        const firstSheetName = parsedWorkbook.SheetNames?.[0];
        if (!firstSheetName) {
            throw new Error(`CSV could not be parsed for sheet: ${sheetName}`);
        }

        const sheet = parsedWorkbook.Sheets[firstSheetName];
        XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
    }

    async function exportIntelligenceLedgerWorkbook() {
        if (typeof XLSX === 'undefined') {
            showToast('XLSX library not loaded. Refresh and try again.', 3500);
            return;
        }

        try {
            const changeLogCsv = await fetchReferenceCsvFromWorkspaceOrRepo('performance-intelligence-change-log.csv');
            const metrics2026Csv = await fetchReferenceCsvFromWorkspaceOrRepo('performance-intelligence-metrics-2026.csv');

            const workbook = XLSX.utils.book_new();
            appendCsvAsSheet(workbook, changeLogCsv, 'Change Log');
            appendCsvAsSheet(workbook, metrics2026Csv, 'Metrics 2026');

            const dateStamp = new Date().toISOString().split('T')[0];
            const fileName = `Performance-Intelligence-Ledger-${dateStamp}.xlsx`;
            XLSX.writeFile(workbook, fileName);
            showToast('Intelligence ledger exported to .xlsx', 3000);
        } catch (error) {
            console.error('Error exporting intelligence ledger workbook:', error);
            showToast(`Could not export ledger: ${error.message}`, 4500);
        }
    }

    // ============================================
    // STORAGE SNAPSHOT & DATA HELPERS
    // ============================================

    function summarizeStorageValue(rawValue) {
        let valueType = 'string';
        let itemCount = '';

        if (typeof rawValue === 'string') {
            const trimmed = rawValue.trim();
            if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                try {
                    const parsed = JSON.parse(rawValue);
                    if (Array.isArray(parsed)) {
                        valueType = 'array';
                        itemCount = parsed.length;
                    } else if (parsed && typeof parsed === 'object') {
                        valueType = 'object';
                        itemCount = Object.keys(parsed).length;
                    }
                } catch (error) {
                    valueType = 'string';
                }
            }
        }

        return {
            valueType,
            itemCount,
            byteLength: typeof rawValue === 'string' ? rawValue.length : 0
        };
    }

    function getAllAppStorageSnapshot() {
        const snapshot = {};
        for (let index = 0; index < localStorage.length; index += 1) {
            const key = localStorage.key(index);
            if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
            const rawValue = localStorage.getItem(key);
            snapshot[key] = summarizeStorageValue(rawValue);
        }
        return snapshot;
    }

    function hasNonEmptyEntries(value) {
        if (!value || typeof value !== 'object') return false;
        if (Array.isArray(value)) return value.length > 0;
        return Object.keys(value).length > 0;
    }

    function getMeaningfulLocalDataSources() {
        const storage = window.DevCoachModules?.storage;
        return [
            storage?.loadWeeklyData?.() || null,
            storage?.loadYtdData?.() || null,
            storage?.loadCoachingHistory?.() || null,
            safeLoadJson('callListeningLogs'),
            storage?.loadAssociateSentimentSnapshots?.() || null,
            storage?.loadTeamMembers?.() || null,
            storage?.loadPtoTracker?.() || null,
            storage?.loadCallCenterAverages?.() || null,
            window.loadYearEndAnnualGoalsStore?.() || null,
            window.loadYearEndDraftStore?.() || null
        ];
    }

    function getMeaningfulBackupDataSources(payload) {
        return [
            payload.weeklyData,
            payload.ytdData,
            payload.coachingHistory,
            payload.callListeningLogs,
            payload.associateSentimentSnapshots,
            payload.myTeamMembers,
            payload.ptoTracker,
            payload.callCenterAverages,
            payload.yearEndAnnualGoalsStore,
            payload.yearEndDraftStore,
            payload.appStorageSnapshot
        ];
    }

    function hasMeaningfulLocalData() {
        return getMeaningfulLocalDataSources().some(hasNonEmptyEntries);
    }

    function hasMeaningfulBackupData(payload) {
        if (!payload || typeof payload !== 'object') return false;
        return getMeaningfulBackupDataSources(payload).some(hasNonEmptyEntries);
    }

    // ============================================
    // SYNC HEADERS / NETWORK HELPERS
    // ============================================

    function buildRepoSyncHeaders(sharedSecret) {
        const normalizedSecret = String(sharedSecret || '').trim();
        return {
            'Content-Type': 'application/json',
            ...(normalizedSecret ? { 'X-Sync-Secret': normalizedSecret } : {})
        };
    }

    async function parseRepoSyncErrorResponse(response) {
        let details = '';
        let errorCode = '';
        let parsedBody = null;

        try {
            const errorText = await response.text();
            details = errorText;
            try {
                const parsedError = JSON.parse(errorText);
                parsedBody = parsedError;
                errorCode = String(parsedError?.code || '');
                if (parsedError?.error) {
                    details = String(parsedError.error);
                }
            } catch (parseError) {
                // Keep raw response text as details when not JSON.
            }
        } catch (error) {
            details = '';
        }

        return { details, errorCode, parsedBody };
    }

    async function parseRepoSyncSuccessResponse(response) {
        try {
            return await response.json();
        } catch (error) {
            return null;
        }
    }

    async function postRepoSyncPayload(endpoint, config, payload) {
        return fetch(endpoint, {
            method: 'POST',
            headers: buildRepoSyncHeaders(config.sharedSecret),
            body: JSON.stringify(payload)
        });
    }

    async function throwIfRepoSyncErrorResponse(response) {
        if (response.ok) return;

        const { details, errorCode, parsedBody } = await parseRepoSyncErrorResponse(response);

        if (response.status === 409 && errorCode === 'EMPTY_PAYLOAD_GUARD') {
            const error = new Error('Blank profile sync blocked to protect existing repo data. Open your primary browser profile with saved data.');
            error.code = errorCode;
            error.responseStatus = response.status;
            error.details = details;
            error.payload = parsedBody;
            throw error;
        }

        if (response.status === 409 && errorCode === 'DATA_REGRESSION_GUARD') {
            const incomingSummary = parsedBody?.incomingSummary || null;
            const existingSummary = parsedBody?.existingSummary || null;
            const incomingDate = incomingSummary?.latestWeeklyEndDate || 'unknown';
            const existingDate = existingSummary?.latestWeeklyEndDate || 'unknown';
            const error = new Error(`Sync blocked: this device appears older (${incomingDate}) than repo (${existingDate}). Use Force Restore, then sync again.`);
            error.code = errorCode;
            error.responseStatus = response.status;
            error.details = details;
            error.payload = parsedBody;
            throw error;
        }

        const normalizedDetails = String(details || '').toLowerCase();
        if (normalizedDetails.includes('repository rule violation') || normalizedDetails.includes('secret scanning')) {
            const error = new Error('Sync blocked by GitHub secret scanning. Remove token-like content from notes/data and try Sync Now again.');
            error.code = errorCode;
            error.responseStatus = response.status;
            error.details = details;
            error.payload = parsedBody;
            throw error;
        }

        const error = new Error(`HTTP ${response.status}${details ? ` - ${details}` : ''}`);
        error.code = errorCode;
        error.responseStatus = response.status;
        error.details = details;
        error.payload = parsedBody;
        throw error;
    }

    // ============================================
    // PAYLOAD BUILDING
    // ============================================

    function buildRepoSyncPayload(reason = 'updated') {
        const storage = window.DevCoachModules?.storage;
        const ptoTracker = storage?.loadPtoTracker?.() || {};
        const localDataSummary = summarizeLocalBackupFreshness();
        const followUpHistory = storage?.loadFollowUpHistory?.() || { entries: [] };

        return {
            appVersion: window.APP_VERSION || '',
            reason,
            generatedAt: new Date().toISOString(),
            localDataSummary,
            weeklyData: storage?.loadWeeklyData?.() || {},
            ytdData: storage?.loadYtdData?.() || {},
            coachingHistory: storage?.loadCoachingHistory?.() || {},
            callListeningLogs: safeLoadJson('callListeningLogs') || {},
            sentimentPhraseDatabase: storage?.loadSentimentPhraseDatabase?.() || null,
            associateSentimentSnapshots: storage?.loadAssociateSentimentSnapshots?.() || {},
            myTeamMembers: storage?.loadTeamMembers?.() || {},
            callCenterAverages: storage?.loadCallCenterAverages?.() || {},
            ptoTracker: ptoTracker && typeof ptoTracker === 'object' ? ptoTracker : {},
            followUpHistory: followUpHistory,
            hotTipHistory: storage?.loadHotTipHistory?.() || { entries: [] },
            yearEndAnnualGoalsStore: window.loadYearEndAnnualGoalsStore?.() || {},
            yearEndDraftStore: window.loadYearEndDraftStore?.() || {},
            appStorageSnapshot: getAllAppStorageSnapshot(),
            callListeningCsv: window.exportCallListeningLogsToCSV?.() || ''
        };
    }

    function summarizeLocalBackupFreshness() {
        const storage = window.DevCoachModules?.storage;
        const weeklyDataRef = storage?.loadWeeklyData?.() || {};
        const ytdDataRef = storage?.loadYtdData?.() || {};
        const weeklyKeys = Object.keys(weeklyDataRef);
        const ytdKeys = Object.keys(ytdDataRef);
        const latestWeeklyEndMs = getLatestPeriodEndMsFromMap(weeklyDataRef);

        return {
            generatedAt: new Date().toISOString(),
            weeklyPeriods: weeklyKeys.length,
            ytdPeriods: ytdKeys.length,
            latestWeeklyEndDate: latestWeeklyEndMs ? new Date(latestWeeklyEndMs).toISOString().slice(0, 10) : null,
            latestWeeklyEndMs,
            footprintScore: getBackupFootprintScore({
                weeklyData: weeklyDataRef,
                ytdData: ytdDataRef,
                coachingHistory: storage?.loadCoachingHistory?.() || {},
                callListeningLogs: safeLoadJson('callListeningLogs') || {},
                associateSentimentSnapshots: storage?.loadAssociateSentimentSnapshots?.() || {},
                myTeamMembers: storage?.loadTeamMembers?.() || {}
            })
        };
    }

    function getLatestPeriodEndMsFromMap(periodMap) {
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

    // ============================================
    // QUEUE / SCHEDULE / PAUSE
    // ============================================

    function queueRepoSync(reason = 'updated') {
        if (!canQueueRepoSync()) return;
        scheduleRepoSync(reason);
    }

    function queueCallListeningRepoSync(reason = 'updated') {
        queueRepoSync(reason);
    }

    function isLocalSummaryCaughtUp(localSummary, baselineSummary) {
        if (!localSummary || !baselineSummary) return false;

        const localLatest = Number(localSummary.latestWeeklyEndMs || 0);
        const baselineLatest = Number(baselineSummary.latestWeeklyEndMs || 0);
        const localWeekly = Number(localSummary.weeklyPeriods || 0);
        const baselineWeekly = Number(baselineSummary.weeklyPeriods || 0);
        const localFootprint = Number(localSummary.footprintScore || 0);
        const baselineFootprint = Number(baselineSummary.footprintScore || 0);

        const latestCaughtUp = !baselineLatest || localLatest >= baselineLatest;
        const weeklyCaughtUp = localWeekly >= baselineWeekly;
        const footprintCaughtUp = localFootprint >= baselineFootprint;

        return latestCaughtUp && (weeklyCaughtUp || footprintCaughtUp);
    }

    function clearRepoSyncAutoPause() {
        repoSyncAutoPausedReason = '';
        repoSyncAutoPausedExistingSummary = null;
    }

    function pauseRepoSyncForRegression(existingSummary = null) {
        repoSyncAutoPausedReason = 'DATA_REGRESSION_GUARD';
        repoSyncAutoPausedExistingSummary = existingSummary && typeof existingSummary === 'object'
            ? existingSummary
            : null;
    }

    function canQueueRepoSync() {
        if (repoSyncHydrationInProgress) return false;
        if (Date.now() < repoSyncErrorCooldownUntil) return false;
        const config = loadCallListeningSyncConfig();
        if (!config.isWorkPc) return false;
        const enabled = !!(config.autoSyncEnabled && String(config.endpoint || '').trim());
        if (!enabled) return false;

        if (repoSyncAutoPausedReason === 'DATA_REGRESSION_GUARD') {
            const localSummary = summarizeLocalBackupFreshness();
            if (isLocalSummaryCaughtUp(localSummary, repoSyncAutoPausedExistingSummary)) {
                clearRepoSyncAutoPause();
                setCallListeningSyncStatus('Auto-sync resumed after local data caught up.', 'info');
                return true;
            }
            return false;
        }

        return true;
    }

    function scheduleRepoSync(reason) {
        if (callListeningSyncTimer) {
            clearTimeout(callListeningSyncTimer);
        }

        setRepoSyncQueuedStatus();
        callListeningSyncTimer = setTimeout(() => {
            syncRepoData(reason);
        }, SYNC_DEBOUNCE_MS);
    }

    // ============================================
    // HYDRATION LOCK
    // ============================================

    async function withRepoSyncHydrationLock(action) {
        repoSyncHydrationInProgress = true;
        try {
            return await action();
        } finally {
            repoSyncHydrationInProgress = false;
        }
    }

    // ============================================
    // BACKUP FETCH / APPLY / RESTORE
    // ============================================

    async function fetchRepoBackupPayload() {
        const origin = window?.location?.origin;
        const timestamp = Date.now();
        const payloadCandidates = [];

        // Try Worker endpoint first (bypasses firewall restrictions on raw.githubusercontent.com)
        try {
            const config = loadCallListeningSyncConfig();
            const endpoint = config?.endpoint;
            if (endpoint) {
                const headers = { 'Content-Type': 'application/json' };
                const secret = config?.syncSecret;
                if (secret) headers['x-sync-secret'] = secret;
                const workerResponse = await fetch(endpoint, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ mode: 'retrieve' })
                });
                if (workerResponse.ok) {
                    const workerData = await workerResponse.json();
                    if (workerData?.ok && workerData?.payload && typeof workerData.payload === 'object') {
                        payloadCandidates.push(workerData.payload);
                    }
                }
            }
        } catch (error) {
            console.warn('Worker retrieve failed, falling back to direct URLs:', error.message);
        }

        // Fallback: try direct URLs
        const urls = [];
        if (origin && origin !== 'null') {
            urls.push(`${origin}/data/coaching-tool-sync-backup.json?cb=${timestamp}`);
        }
        urls.push(`https://raw.githubusercontent.com/ScottK83/Development-Coaching-Tool/main/data/coaching-tool-sync-backup.json?cb=${timestamp}`);

        for (const url of urls) {
            try {
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) continue;

                const payload = await response.json();
                if (payload && typeof payload === 'object') {
                    payloadCandidates.push(payload);
                }
            } catch (error) {
                // Try next candidate URL
            }
        }

        if (!payloadCandidates.length) return null;

        const getFootprintScore = (payload) => {
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
        };

        payloadCandidates.sort((a, b) => {
            const timeDiff = parseTimeMs(b?.generatedAt) - parseTimeMs(a?.generatedAt);
            if (timeDiff !== 0) return timeDiff;
            return getFootprintScore(b) - getFootprintScore(a);
        });

        return payloadCandidates[0];
    }

    function coerceObject(value, fallback = {}) {
        return value && typeof value === 'object' ? value : fallback;
    }

    function coerceNullableObject(value) {
        return value && typeof value === 'object' ? value : null;
    }

    function safeSaveToStorage(key, data) {
        try {
            const json = JSON.stringify(data);
            if (json.length > 4 * 1024 * 1024) {
                console.warn(`Skipping save for ${key}: payload exceeds 4MB (${(json.length / 1024 / 1024).toFixed(1)}MB)`);
                return false;
            }
            localStorage.setItem(STORAGE_PREFIX + key, json);
            return true;
        } catch (e) {
            console.error(`Failed to save ${key} to localStorage:`, e.message);
            return false;
        }
    }

    function applyRepoBackupPayload(payload) {
        // Write directly to localStorage to avoid let/window mismatch
        // (script.js uses `let` vars which aren't on window, so window.saveX() would save empty data)
        const storage = window.DevCoachModules?.storage;

        if (storage?.saveWeeklyData) storage.saveWeeklyData(coerceObject(payload?.weeklyData));
        else safeSaveToStorage('weeklyData', coerceObject(payload?.weeklyData));

        if (storage?.saveYtdData) storage.saveYtdData(coerceObject(payload?.ytdData));
        else safeSaveToStorage('ytdData', coerceObject(payload?.ytdData));

        if (storage?.saveCoachingHistory) storage.saveCoachingHistory(coerceObject(payload?.coachingHistory));
        else safeSaveToStorage('coachingHistory', coerceObject(payload?.coachingHistory));

        safeSaveToStorage('callListeningLogs', coerceObject(payload?.callListeningLogs));

        if (storage?.saveSentimentPhraseDatabase) storage.saveSentimentPhraseDatabase(coerceNullableObject(payload?.sentimentPhraseDatabase));
        else safeSaveToStorage('sentimentPhraseDatabase', coerceNullableObject(payload?.sentimentPhraseDatabase));

        if (storage?.saveAssociateSentimentSnapshots) storage.saveAssociateSentimentSnapshots(coerceObject(payload?.associateSentimentSnapshots));
        else safeSaveToStorage('associateSentimentSnapshots', coerceObject(payload?.associateSentimentSnapshots));

        if (storage?.saveTeamMembers) storage.saveTeamMembers(coerceObject(payload?.myTeamMembers));
        else safeSaveToStorage('myTeamMembers', coerceObject(payload?.myTeamMembers));

        if (storage?.saveCallCenterAverages) storage.saveCallCenterAverages(coerceObject(payload?.callCenterAverages));
        else safeSaveToStorage('callCenterAverages', coerceObject(payload?.callCenterAverages));

        if (storage?.savePtoTracker) {
            storage.savePtoTracker(coerceObject(payload?.ptoTracker));
        }
        window.saveYearEndAnnualGoalsStore?.(coerceObject(payload?.yearEndAnnualGoalsStore));
        window.saveYearEndDraftStore?.(coerceObject(payload?.yearEndDraftStore));
        if (window.DevCoachModules?.storage?.saveFollowUpHistory) {
            const restoredFollowUpHistory = payload?.followUpHistory && typeof payload.followUpHistory === 'object'
                ? payload.followUpHistory
                : { entries: [] };
            window.DevCoachModules.storage.saveFollowUpHistory(restoredFollowUpHistory);
        }
        if (window.DevCoachModules?.storage?.saveHotTipHistory) {
            const restoredHotTipHistory = payload?.hotTipHistory && typeof payload.hotTipHistory === 'object'
                ? payload.hotTipHistory
                : { entries: [] };
            window.DevCoachModules.storage.saveHotTipHistory(restoredHotTipHistory);
        }
    }

    function loadRepoBackupAppliedAt() {
        try {
            return String(localStorage.getItem(REPO_BACKUP_APPLIED_AT_STORAGE_KEY) || '').trim();
        } catch (error) {
            return '';
        }
    }

    function saveRepoBackupAppliedAt(isoText) {
        try {
            withRepoSyncSuppressed(() => {
                localStorage.setItem(REPO_BACKUP_APPLIED_AT_STORAGE_KEY, String(isoText || '').trim());
            });
        } catch (error) {
            console.error('Error saving repo backup applied marker:', error);
        }
    }

    function parseTimeMs(value) {
        const dateText = String(value || '').trim();
        if (!dateText) return 0;
        const parsed = Date.parse(dateText);
        return Number.isNaN(parsed) ? 0 : parsed;
    }

    function getLatestLocalRepoDataTimestampMs() {
        const lastSync = loadRepoSyncLastSuccess();
        const syncMs = parseTimeMs(lastSync?.syncedAt);
        const appliedMs = parseTimeMs(loadRepoBackupAppliedAt());
        return Math.max(syncMs, appliedMs, 0);
    }

    async function tryAutoRestoreFromRepoBackupOnEmptyState() {
        const payload = await fetchRepoBackupPayload();
        if (!hasMeaningfulBackupData(payload)) {
            return false;
        }

        const localHasData = hasMeaningfulLocalData();
        const remoteGeneratedAtMs = parseTimeMs(payload?.generatedAt);
        const latestLocalMs = getLatestLocalRepoDataTimestampMs();

        if (localHasData) {
            if (!remoteGeneratedAtMs || (latestLocalMs > 0 && remoteGeneratedAtMs <= latestLocalMs)) {
                return false;
            }

            const remoteWhen = new Date(remoteGeneratedAtMs).toLocaleString();
            const shouldRestore = confirm(`Newer synced backup found from ${remoteWhen}.\n\nRestore this backup on this PC now?\n\nChoose Cancel to keep current local data.`);
            if (!shouldRestore) {
                return false;
            }
        }

        await withRepoSyncHydrationLock(async () => {
            applyRepoBackupPayload(payload);
        });

        saveRepoBackupAppliedAt(payload?.generatedAt || new Date().toISOString());

        return true;
    }

    // ============================================
    // SYNC EXECUTION (with retry logic)
    // ============================================

    function buildRepoSyncMeta(reason, responseData, direction) {
        return {
            syncedAt: new Date().toISOString(),
            reason,
            direction: direction || 'upload',
            commit: responseData?.fullBackupCommit || responseData?.jsonCommit || responseData?.csvCommit || '',
            backupSummary: responseData?.incomingSummary || null
        };
    }

    function getRepoSyncEndpointIfAllowed(config, forceSync) {
        const endpoint = String(config?.endpoint || '').trim();
        if ((!config?.autoSyncEnabled && !forceSync) || !endpoint) {
            if (forceSync && !endpoint) {
                setCallListeningSyncStatus('Sync failed: add Worker URL first.', 'error');
            }
            return null;
        }
        return endpoint;
    }

    function finalizeRepoSyncSuccess(reason, responseData, direction) {
        repoSyncConflictPromptMutedUntil = 0;
        clearRepoSyncAutoPause();
        const syncMeta = buildRepoSyncMeta(reason, responseData, direction || 'upload');
        saveRepoSyncLastSuccess(syncMeta);
        renderCallListeningLastSync(syncMeta);
        const weeklyCount = Number(responseData?.incomingSummary?.weeklyPeriods || 0);
        const ytdCount = Number(responseData?.incomingSummary?.ytdPeriods || 0);
        const latestDate = String(responseData?.incomingSummary?.latestWeeklyEndDate || '').trim();
        const suffix = latestDate
            ? ` (${weeklyCount} weekly / ${ytdCount} YTD, latest ${latestDate})`
            : ` (${weeklyCount} weekly / ${ytdCount} YTD)`;
        setCallListeningSyncStatus(`Last full-data sync: ${new Date().toLocaleString()}${suffix}`, 'success');
    }

    function handleRepoSyncFailure(error) {
        console.error('Repo sync failed:', error);
        repoSyncErrorCooldownUntil = Date.now() + SYNC_ERROR_COOLDOWN_MS;
        const cooldownSec = Math.round(SYNC_ERROR_COOLDOWN_MS / 1000);
        setCallListeningSyncStatus(`Sync failed: ${error.message} — pausing auto-sync for ${cooldownSec}s`, 'error');
    }

    function formatSummaryLabel(summary) {
        if (!summary || typeof summary !== 'object') return 'n/a';
        const weekly = Number(summary.weeklyPeriods || 0);
        const ytd = Number(summary.ytdPeriods || 0);
        const latest = String(summary.latestWeeklyEndDate || '').trim() || 'unknown date';
        return `${weekly} weekly / ${ytd} YTD (latest ${latest})`;
    }

    async function maybeHandleRepoSyncConflict(error) {
        if (String(error?.code || '') !== 'DATA_REGRESSION_GUARD') {
            return false;
        }

        const interactive = error?.interactive === true;
        const now = Date.now();
        const existingSummary = error?.payload?.existingSummary || null;

        if (!interactive) {
            pauseRepoSyncForRegression(existingSummary);

            if (now < repoSyncConflictPromptMutedUntil) {
                return true;
            }

            repoSyncConflictPromptMutedUntil = now + (5 * 60 * 1000);
            setCallListeningSyncStatus('Auto-sync paused while local profile rebuild is older than repo. It will resume when data catches up.', 'info');
            return true;
        }

        const incomingSummary = error?.payload?.incomingSummary || null;
        const message = [
            'Sync protected your newer repo backup.',
            `This device: ${formatSummaryLabel(incomingSummary)}`,
            `Repo backup: ${formatSummaryLabel(existingSummary)}`,
            '',
            'Restore repo backup to this device now?'
        ].join('\n');

        const shouldRestore = confirm(message);
        if (!shouldRestore) {
            pauseRepoSyncForRegression(existingSummary);
            repoSyncConflictPromptMutedUntil = now + (5 * 60 * 1000);
            setCallListeningSyncStatus('Sync blocked (older local profile). Use Force Restore to match latest repo data.', 'error');
            return true;
        }

        try {
            setCallListeningSyncStatus('Sync conflict detected. Restoring latest repo backup...', 'info');
            const restored = await tryAutoRestoreFromRepoBackupOnEmptyState();
            if (restored) {
                repoSyncConflictPromptMutedUntil = 0;
                clearRepoSyncAutoPause();
                showToast('Restored latest repo backup. Sync is now aligned.', 4000);
                setCallListeningSyncStatus('Restore complete. This browser now matches repo data.', 'success');
                setTimeout(() => window.location.reload(), 500);
                return true;
            }
        } catch (restoreError) {
            console.error('Auto-restore after sync conflict failed:', restoreError);
            setCallListeningSyncStatus(`Restore failed after sync conflict: ${restoreError.message}`, 'error');
            return true;
        }

        return true;
    }

    async function requestValidatedRepoSyncResponse(endpoint, config, payload) {
        const response = await postRepoSyncPayload(endpoint, config, payload);
        await throwIfRepoSyncErrorResponse(response);
        return response;
    }

    /**
     * Determines whether a sync error is transient and eligible for retry.
     * Transient errors include network failures (TypeError from fetch) and
     * HTTP 5xx server errors.
     */
    function isTransientSyncError(error) {
        // Network errors thrown by fetch are TypeErrors (e.g. DNS failure, offline)
        if (error instanceof TypeError) return true;

        // HTTP 5xx server errors
        const status = Number(error?.responseStatus || 0);
        if (status >= 500 && status < 600) return true;

        return false;
    }

    /**
     * Sleep helper for retry backoff.
     */
    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function syncRepoData(reason = 'updated', options = {}) {
        const config = loadCallListeningSyncConfig();
        const forceSync = options?.force === true;
        if (forceSync) repoSyncErrorCooldownUntil = 0;
        const endpoint = getRepoSyncEndpointIfAllowed(config, forceSync);
        if (!endpoint) return;
        setCallListeningSyncStatus('Syncing all app data to repo...', 'info');

        let lastError = null;

        for (let attempt = 0; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
            try {
                const payload = buildRepoSyncPayload(reason);
                if (options?.allowDataRegression === true) {
                    payload.allowDataRegression = true;
                }

                const response = await requestValidatedRepoSyncResponse(endpoint, config, payload);

                const responseData = await parseRepoSyncSuccessResponse(response);
                finalizeRepoSyncSuccess(reason, responseData);
                return;
            } catch (error) {
                lastError = error;

                // Only retry on transient errors and if we have attempts remaining
                if (attempt < RETRY_MAX_ATTEMPTS && isTransientSyncError(error)) {
                    const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
                    console.warn(`Repo sync attempt ${attempt + 1} failed (transient). Retrying in ${delayMs}ms...`, error.message);
                    setCallListeningSyncStatus(`Sync retry ${attempt + 1}/${RETRY_MAX_ATTEMPTS} in ${delayMs / 1000}s...`, 'info');
                    await sleep(delayMs);
                    continue;
                }

                // Non-transient error or final attempt — fall through to error handling
                break;
            }
        }

        // Handle the final error
        if (lastError) {
            lastError.interactive = forceSync;
            const handledConflict = await maybeHandleRepoSyncConflict(lastError);
            if (handledConflict) return;
            handleRepoSyncFailure(lastError);
        }
    }

    // ============================================
    // GLOBAL HELPER (showToast bridge)
    // ============================================

    function showToast(message, duration) {
        if (typeof window.showToast === 'function') {
            window.showToast(message, duration);
        }
    }

    // ============================================
    // PUBLIC API
    // ============================================

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.repoSync = {
        // Config
        getDefaultCallListeningSyncConfig,
        loadCallListeningSyncConfig,
        saveCallListeningSyncConfig,
        enforceRepoAutoSyncEnabled,
        getCallListeningSyncConfigFromUI,

        // Status display
        setCallListeningSyncStatus,
        setAutoSyncEnabledStatus,
        setRepoSyncQueuedStatus,
        setRepoExcelUploadStatus,

        // Suppression / hooks
        withRepoSyncSuppressed,
        shouldSyncForStorageKey,
        installRepoSyncStorageHooks,

        // Last-success persistence
        loadRepoSyncLastSuccess,
        saveRepoSyncLastSuccess,
        renderCallListeningLastSync,

        // Diagnostics
        buildDiagnosticsSummary,
        bindDiagnosticsCopyAction,

        // Controls initialization
        initializeRepoSyncControls,

        // File upload / Excel helpers
        arrayBufferToBase64,
        uploadExcelFileToRepo,
        openRepoExcelFile,
        openRepoUploadsFolder,
        fetchReferenceCsvFromWorkspaceOrRepo,
        appendCsvAsSheet,
        exportIntelligenceLedgerWorkbook,

        // Storage snapshot / data helpers
        summarizeStorageValue,
        getAllAppStorageSnapshot,
        hasNonEmptyEntries,
        getMeaningfulLocalDataSources,
        getMeaningfulBackupDataSources,
        hasMeaningfulLocalData,
        hasMeaningfulBackupData,

        // Sync headers / network
        buildRepoSyncHeaders,
        parseRepoSyncErrorResponse,
        parseRepoSyncSuccessResponse,
        postRepoSyncPayload,
        throwIfRepoSyncErrorResponse,

        // Payload building
        buildRepoSyncPayload,
        summarizeLocalBackupFreshness,
        getLatestPeriodEndMsFromMap,
        getBackupFootprintScore,

        // Queue / schedule / pause
        queueRepoSync,
        queueCallListeningRepoSync,
        isLocalSummaryCaughtUp,
        clearRepoSyncAutoPause,
        pauseRepoSyncForRegression,
        canQueueRepoSync,
        scheduleRepoSync,

        // Hydration lock
        withRepoSyncHydrationLock,

        // Backup fetch / apply / restore
        fetchRepoBackupPayload,
        coerceObject,
        coerceNullableObject,
        applyRepoBackupPayload,
        loadRepoBackupAppliedAt,
        saveRepoBackupAppliedAt,
        parseTimeMs,
        getLatestLocalRepoDataTimestampMs,
        tryAutoRestoreFromRepoBackupOnEmptyState,

        // Sync execution
        buildRepoSyncMeta,
        getRepoSyncEndpointIfAllowed,
        finalizeRepoSyncSuccess,
        handleRepoSyncFailure,
        formatSummaryLabel,
        maybeHandleRepoSyncConflict,
        requestValidatedRepoSyncResponse,
        isTransientSyncError,
        syncRepoData,

        // Utility
        runWithButtonBusyState,
        getTotalCallListeningLogCount
    };

})();
