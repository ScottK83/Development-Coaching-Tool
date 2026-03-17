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
    const STORAGE_PREFIX = 'devCoachingTool_';
    const DEBUG_MAX_ENTRIES = 50;

    // ============================================
    // INTERNAL STATE
    // ============================================
    const debugState = { entries: [] };

    // ============================================
    // DEBUG ENTRY LOGGING
    // ============================================

    function addDebugEntry(type, message, details = {}) {
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

        return {
            url: window.location.href,
            userAgent: navigator.userAgent,
            language: navigator.language,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            timestamp: new Date().toISOString(),
            weeklyDataCount: Object.keys(weeklyData || {}).length,
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
        return {
            snapshot: buildDebugSnapshot(),
            errors: debugState.entries
        };
    }

    // ============================================
    // RENDERING
    // ============================================

    function renderDebugPanel() {
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
        navigator.clipboard.writeText(text).then(() => {
            showToast('\u2705 Debug info copied to clipboard', 3000);
        }).catch(err => {
            console.error('Failed to copy debug info:', err);
            showToast('\u26a0\ufe0f Unable to copy debug info', 3000);
        });
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
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.debug = {
        addDebugEntry,
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
        DEBUG_MAX_ENTRIES
    };
})();
