/* ========================================
   DEBUG MODULE
   Debug panel rendering, error capture,
   and diagnostic snapshot utilities
   ======================================== */

(function() {
    'use strict';

    // ============================================
    // CONSTANTS
    // ============================================
    const STORAGE_PREFIX = window.DevCoachConstants?.STORAGE_PREFIX || 'devCoachingTool_';
    const DEBUG_MAX_ENTRIES = 50;
    const DEBUG_LOG_STORAGE_KEY = STORAGE_PREFIX + 'debugLog';

    // ============================================
    // INTERNAL STATE
    // ============================================
    const debugState = { entries: [] };

    function getDebugDayKey(date = new Date()) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function persistDebugState() {
        try {
            localStorage.setItem(DEBUG_LOG_STORAGE_KEY, JSON.stringify({
                dayKey: getDebugDayKey(),
                entries: debugState.entries.slice(-DEBUG_MAX_ENTRIES)
            }));
        } catch (error) {
            console.error('Failed to persist debug log:', error);
        }
    }

    function clearDebugEntries(options = {}) {
        debugState.entries = [];
        if (options.removeStorage) {
            try {
                localStorage.removeItem(DEBUG_LOG_STORAGE_KEY);
            } catch (error) {
                console.error('Failed to remove persisted debug log:', error);
            }
            return;
        }
        persistDebugState();
    }

    function loadPersistedDebugState() {
        try {
            const raw = localStorage.getItem(DEBUG_LOG_STORAGE_KEY);
            if (!raw) return;

            const parsed = JSON.parse(raw);
            const currentDayKey = getDebugDayKey();
            const storedDayKey = parsed?.dayKey || null;
            const storedEntries = Array.isArray(parsed?.entries) ? parsed.entries : [];

            if (storedDayKey !== currentDayKey) {
                clearDebugEntries({ removeStorage: true });
                return;
            }

            debugState.entries = storedEntries.slice(-DEBUG_MAX_ENTRIES);
        } catch (error) {
            console.error('Failed to load persisted debug log:', error);
            clearDebugEntries({ removeStorage: true });
        }
    }

    function ensureFreshDebugLog() {
        const currentDayKey = getDebugDayKey();
        let storedDayKey = null;

        try {
            const raw = localStorage.getItem(DEBUG_LOG_STORAGE_KEY);
            if (raw) {
                const parsed = JSON.parse(raw);
                storedDayKey = parsed?.dayKey || null;
            }
        } catch (error) {
            console.error('Failed to inspect persisted debug log:', error);
            clearDebugEntries({ removeStorage: true });
            return;
        }

        if (storedDayKey && storedDayKey !== currentDayKey) {
            clearDebugEntries();
        }
    }

    // ============================================
    // DEBUG ENTRY LOGGING
    // ============================================

    function addDebugEntry(type, message, details = {}) {
        ensureFreshDebugLog();
        const entry = {
            timestamp: new Date().toISOString(),
            type,
            message: message || 'Unknown error',
            details
        };
        debugState.entries.push(entry);
        if (debugState.entries.length > DEBUG_MAX_ENTRIES) {
            debugState.entries = debugState.entries.slice(-DEBUG_MAX_ENTRIES);
        }
        persistDebugState();
    }

    function installDebugListeners() {
        window.addEventListener('error', (event) => {
            addDebugEntry('error', event.message, {
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: event.error?.stack || null
            });
        });

        window.addEventListener('unhandledrejection', (event) => {
            const reason = event.reason;
            addDebugEntry('promise', reason?.message || String(reason), {
                stack: reason?.stack || null
            });
        });
    }

    // ============================================
    // DATA HELPERS
    // ============================================

    function getPeriodTypeCounts(sourceData) {
        const counts = {};
        Object.values(sourceData || {}).forEach(period => {
            const type = period?.metadata?.periodType || 'week';
            counts[type] = (counts[type] || 0) + 1;
        });
        return counts;
    }

    function getLatestPeriodKeyByType(sourceData, periodType) {
        const keys = Object.keys(sourceData || {})
            .filter(key => (sourceData[key]?.metadata?.periodType || 'week') === periodType);

        if (keys.length === 0) return null;

        const sorted = keys.sort((a, b) => {
            const aEnd = (a.split('|')[1] || '').trim();
            const bEnd = (b.split('|')[1] || '').trim();
            const aDate = new Date(aEnd);
            const bDate = new Date(bEnd);
            if (isNaN(aDate) && isNaN(bDate)) return 0;
            if (isNaN(aDate)) return -1;
            if (isNaN(bDate)) return 1;
            return aDate - bDate;
        });

        return sorted[sorted.length - 1];
    }

    function getLocalStorageSummary() {
        const keys = [
            'weeklyData',
            'ytdData',
            'callCenterAverages',
            'coachingHistory',
            'myTeamMembers',
            'metricCoachingTips',
            'employeePreferredNames'
        ];

        const summary = {};
        keys.forEach(key => {
            const value = localStorage.getItem(STORAGE_PREFIX + key);
            summary[key] = value ? `${value.length} chars` : 'empty';
        });
        return summary;
    }

    // ============================================
    // SNAPSHOT & PAYLOAD
    // ============================================

    function buildDebugSnapshot() {
        const storage = window.DevCoachModules?.storage;
        const weeklyData = storage?.loadWeeklyData?.() || {};
        const ytdData = storage?.loadYtdData?.() || {};
        const currentPeriodType = window.currentPeriodType || 'unknown';
        const currentPeriod = window.currentPeriod || null;

        const weeklyKeys = Object.keys(weeklyData || {}).sort().map(k => ({
            key: k,
            periodType: weeklyData[k]?.metadata?.periodType || '(undefined)',
            employees: weeklyData[k]?.employees?.length || 0
        }));

        let rawWeeklyLocalStorageCount = 0;
        try {
            const raw = localStorage.getItem(STORAGE_PREFIX + 'weeklyData');
            if (raw) rawWeeklyLocalStorageCount = Object.keys(JSON.parse(raw)).length;
        } catch (_) { /* ignore */ }

        return {
            url: window.location.href,
            userAgent: navigator.userAgent,
            language: navigator.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            timestamp: new Date().toISOString(),
            weeklyDataCount: Object.keys(weeklyData || {}).length,
            rawWeeklyLocalStorageCount,
            weeklyKeys,
            ytdDataCount: Object.keys(ytdData || {}).length,
            weeklyPeriodTypes: getPeriodTypeCounts(weeklyData),
            ytdPeriodTypes: getPeriodTypeCounts(ytdData),
            latestWeeklyByType: {
                week: getLatestPeriodKeyByType(weeklyData, 'week'),
                month: getLatestPeriodKeyByType(weeklyData, 'month'),
                quarter: getLatestPeriodKeyByType(weeklyData, 'quarter')
            },
            latestYtd: getLatestPeriodKeyByType(ytdData, 'ytd'),
            currentSelection: {
                currentPeriodType,
                currentPeriod
            },
            localStorage: getLocalStorageSummary()
        };
    }

    function buildDebugPayload() {
        ensureFreshDebugLog();
        return {
            snapshot: buildDebugSnapshot(),
            errors: debugState.entries
        };
    }

    // ============================================
    // RENDERING
    // ============================================

    function renderDebugPanel() {
        ensureFreshDebugLog();
        const envEl = document.getElementById('debugEnvironment');
        const dataEl = document.getElementById('debugDataSnapshot');
        const errEl = document.getElementById('debugErrors');

        if (!envEl || !dataEl || !errEl) return;

        const snapshot = buildDebugSnapshot();
        envEl.textContent = JSON.stringify({
            url: snapshot.url,
            userAgent: snapshot.userAgent,
            language: snapshot.language,
            timezone: snapshot.timezone,
            timestamp: snapshot.timestamp
        }, null, 2);

        dataEl.textContent = JSON.stringify({
            weeklyDataCount: snapshot.weeklyDataCount,
            rawWeeklyLocalStorageCount: snapshot.rawWeeklyLocalStorageCount,
            weeklyKeys: snapshot.weeklyKeys,
            ytdDataCount: snapshot.ytdDataCount,
            weeklyPeriodTypes: snapshot.weeklyPeriodTypes,
            ytdPeriodTypes: snapshot.ytdPeriodTypes,
            latestWeeklyByType: snapshot.latestWeeklyByType,
            latestYtd: snapshot.latestYtd,
            currentSelection: snapshot.currentSelection,
            localStorage: snapshot.localStorage
        }, null, 2);

        if (!debugState.entries.length) {
            errEl.textContent = 'No errors captured yet.';
        } else {
            errEl.textContent = JSON.stringify(debugState.entries.slice().reverse(), null, 2);
        }
    }

    // ============================================
    // CLIPBOARD
    // ============================================

    function copyDebugInfo() {
        const payload = JSON.stringify(buildDebugPayload(), null, 2);
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(payload)
                .then(() => showToast('\u2705 Debug info copied to clipboard', 3000))
                .catch(() => fallbackCopyDebug(payload));
        } else {
            fallbackCopyDebug(payload);
        }
    }

    function fallbackCopyDebug(text) {
        try {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
            document.body.appendChild(textarea);
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
            showToast('\u2705 Debug info copied to clipboard', 3000);
        } catch (err) {
            console.error('Failed to copy debug info:', err);
            showToast('\u26a0\ufe0f Unable to copy debug info', 3000);
        }
    }

    // Helper: resolve showToast from global scope
    function showToast(message, duration) {
        if (typeof window.showToast === 'function') {
            window.showToast(message, duration);
        } else if (typeof window.DevCoachModules?.uiUtils?.showToast === 'function') {
            window.DevCoachModules.uiUtils.showToast(message, duration);
        } else {
            console.log(message);
        }
    }

    // ============================================
    // MODULE EXPORT
    // ============================================
    loadPersistedDebugState();

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.debug = {
        addDebugEntry,
        clearDebugEntries,
        installDebugListeners,
        getPeriodTypeCounts,
        getLatestPeriodKeyByType,
        getLocalStorageSummary,
        buildDebugSnapshot,
        buildDebugPayload,
        renderDebugPanel,
        copyDebugInfo,
        fallbackCopyDebug,
        debugState,
        // Constants
        STORAGE_PREFIX,
        DEBUG_MAX_ENTRIES,
        DEBUG_LOG_STORAGE_KEY
    };
})();
