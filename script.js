/* ========================================
   DEVELOPMENT COACHING TOOL
   ======================================== */

/* ========================================
   DESIGN INTENT & DEVELOPMENT GUIDELINES
   ========================================

   This application prioritizes deterministic behavior over heuristics.
   - Avoid "smart guessing" unless explicitly requested
   - Prefer explicit mappings and clear failure modes
   - Maintain predictable, testable code paths

   RULES FOR MODIFICATIONS:

   - Do not add new metric definitions, targets, labels, or tips unless
     modifying the centralized metric configuration (metrics-registry +
     metric-profiles).
   - Do not duplicate logic that already exists. Always search for an
     existing helper before creating a new one.
   - Do not add new parsing logic. Use existing helpers: parsePercentage,
     parseSurveyPercentage, parseSeconds, parseHours.
   - Do not modify header mapping behavior without explicit instruction.
   - If code can be reused, refactor instead of copy/paste.
   - Keep data transformations explicit and traceable.
   - Document any deviation from these guidelines with reasoning.

   ======================================== */

// ============================================
// GLOBAL STATE
// ============================================
const APP_VERSION = '2026.09.04.31'; // Version: YYYY.MM.DD.NN
const DEBUG = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || new URLSearchParams(window.location.search).has('debug'); // Auto-enable on localhost or ?debug param
// Sourced from modules/constants.module.js (loaded first).
const STORAGE_PREFIX = window.DevCoachConstants?.STORAGE_PREFIX || 'devCoachingTool_';

// ============================================
// ERROR HANDLING
// ============================================
// Console wrapping, window.error, and window.unhandledrejection are owned
// by modules/error-monitor.module.js. bootstrap.js handles source-map noise
// at the capture phase before error-monitor loads. Do not re-wrap here.

function logAppError(message, error, context = {}) {
    const errObj = error instanceof Error
        ? error
        : new Error(error?.message || String(error || message));

    try {
        window.DevCoachModules?.errorMonitor?.logError?.(errObj, {
            source: 'script',
            message,
            ...context
        });
    } catch (_e) { /* prevent infinite loop if error monitor fails */ }

    try {
        window.DevCoachModules?.debug?.addDebugEntry?.('error', message + ': ' + errObj.message, {
            ...context,
            stack: errObj.stack || null
        });
    } catch (_e) { /* prevent infinite loop if debug module fails */ }
}

window.getRecentAppErrors = function(limit = 20) {
    return (window.DevCoachModules?.errorMonitor?.getLogs?.({ type: 'error' }) || []).slice(0, limit);
};

// In production, silence verbose console output. console.error is handled
// by error-monitor (captures + silences DevTools in prod).
if (!DEBUG) {
    console.log = () => {};
    console.warn = () => {};
}

// Unsaved changes tracking
window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
    }
});

let weeklyData = {};
let ytdData = {};
// Ephemeral daily rows (purged when a weekly/larger upload covers the same date).
// Kept in its own localStorage key so it has a separate 4MB budget.
let dailyData = {};

// Smart defaults and state tracking
let hasUnsavedChanges = false;
let lastSelectedEmployee = null;
let lastError = null;
let myTeamMembers = {}; // Stores selected team members by weekKey: { "2026-01-24|2026-01-20": ["Alyssa", "John", ...] }
let coachingLatestWeekKey = null;
let coachingHistory = {};
let callListeningLogs = {};
// Repo sync state is managed by repo-sync.module.js (IIFE-scoped)
let teamFilterChangeHandlersBound = false;
let debugState = { entries: [] };
let sentimentPhraseDatabase = null;
let associateSentimentSnapshots = {};
let sentimentListenersAttached = false;

// ============================================
// STORAGE HELPERS (defined early for guaranteed availability)
// ============================================

// Storage functions are now in modules/storage.module.js
// Use window.DevCoachModules.storage.* to access them

// Wrapper functions for backward compatibility
function loadWeeklyData() {
    return window.DevCoachModules?.storage?.loadWeeklyData?.() || {};
}
function saveWeeklyData() {
    // Repo sync is triggered automatically by the localStorage.setItem hook
    // installed in repo-sync.module.js — no explicit queueRepoSync call needed.
    var ok = window.DevCoachModules?.storage?.saveWeeklyData?.(weeklyData);
    if (ok === false) notifyStorageSaveFailed('weekly performance data');
    return ok;
}
function loadYtdData() {
    return window.DevCoachModules?.storage?.loadYtdData?.() || {};
}
function saveYtdData() {
    var ok = window.DevCoachModules?.storage?.saveYtdData?.(ytdData);
    if (ok === false) notifyStorageSaveFailed('YTD data');
    return ok;
}
function loadDailyData() {
    return window.DevCoachModules?.storage?.loadDailyData?.() || {};
}
// Note: daily data is intentionally NOT pushed to the repo-sync queue.
// Dailies are ephemeral (purged when a weekly upload lands), so syncing them
// to the GitHub backup would create churn without value.
function saveDailyData() {
    // Not repo-synced (see above), which makes a silent failure here worse than
    // elsewhere, not better: there is no backup copy to fall back on. Surface it.
    var ok = window.DevCoachModules?.storage?.saveDailyData?.(dailyData);
    if (ok === false) notifyStorageSaveFailed('daily check-in data');
    return ok;
}
function loadCoachingHistory() {
    return window.DevCoachModules?.storage?.loadCoachingHistory?.() || {};
}
function saveCoachingHistory() {
    var ok = window.DevCoachModules?.storage?.saveCoachingHistory?.(coachingHistory);
    if (ok === false) notifyStorageSaveFailed('coaching history');
    return ok;
}
function loadSentimentPhraseDatabase() {
    return window.DevCoachModules?.storage?.loadSentimentPhraseDatabase?.();
}
function saveSentimentPhraseDatabase() {
    var ok = window.DevCoachModules?.storage?.saveSentimentPhraseDatabase?.(sentimentPhraseDatabase);
    if (ok === false) notifyStorageSaveFailed('sentiment phrase data');
    return ok;
}
function loadAssociateSentimentSnapshots() {
    return window.DevCoachModules?.storage?.loadAssociateSentimentSnapshots?.() || {};
}
function saveAssociateSentimentSnapshots() {
    var ok = window.DevCoachModules?.storage?.saveAssociateSentimentSnapshots?.(associateSentimentSnapshots);
    if (ok === false) notifyStorageSaveFailed('sentiment snapshots');
    return ok;
}

// Surfaces a storage-full save failure that would otherwise be silent: the
// in-memory data updates and the UI re-renders, but nothing persists and the
// GitHub backup never captures it. Toasts immediately; throttles the blocking
// alert so a bulk operation can't spam it.
var _lastStorageFailAlert = 0;
function notifyStorageSaveFailed(label) {
    try {
        var toast = window.DevCoachModules?.uiUtils?.showToast;
        if (toast) toast('⚠️ Could not save ' + label + '. Browser storage is full. Back up before making more changes.', 6000);
    } catch (_e) { /* toast unavailable */ }
    var now = Date.now();
    if (now - _lastStorageFailAlert > 30000) {
        _lastStorageFailAlert = now;
        try {
            // Deliberately does NOT point at archiveOldWeeks. That flow deletes the
            // archived weeks, downloads a file no importer can read back, and pushes
            // the shrunken store to the repo, degrading the remote copy too. Telling
            // someone at quota to run it is telling them to destroy the last copy.
            alert('⚠️ Storage is full.\n\nCould not save ' + label + '. Your most recent changes are NOT saved and will be lost on reload.\n\nBack up your data first (Settings → Sync & Backup). Do not archive or delete anything until you have confirmed that backup.');
        } catch (_e) { /* alert unavailable */ }
    }
}

// ============================================
// STORAGE HELPER - Critical for Size Checking
// ============================================
function saveWithSizeCheck(key, data) {
    return window.DevCoachModules?.storage?.saveWithSizeCheck?.(key, data) ?? false;
}

// ============================================
// CONSTANTS
// ============================================
const TOP_PHRASES_COUNT = 5;
const MIN_PHRASE_VALUE = 0;
const LOCALSTORAGE_MAX_SIZE_MB = window.DevCoachConstants?.LOCALSTORAGE_MAX_SIZE_MB || 4;
const REGEX_TIMEOUT_MS = 100;
const FILE_PARSE_CHUNK_SIZE = 100;
const DEBUG_MAX_ENTRIES = 50;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
const QUARTER_END_MONTHS = new Set([2, 5, 8, 11]); // March, June, September, December (0-indexed)
const SENTIMENT_IMPROVEMENT_THRESHOLD = 3;
const MONTH_RANGE_DAYS = { min: 26, max: 33 };
const QUARTER_RANGE_DAYS = { min: 88, max: 95 };
const YTD_MIN_DAYS = 180;
const YEAR_END_ANNUAL_GOALS_STORAGE_KEY = STORAGE_PREFIX + 'yearEndAnnualGoals';
const YEAR_END_DRAFT_STORAGE_KEY = STORAGE_PREFIX + 'yearEndDraftEntries';
// No CALL_LISTENING_LOGS_STORAGE_KEY here on purpose: the call listening store
// is reached through the storage module now, so script.js has no business
// knowing its localStorage key. Reintroducing the constant is how a direct read
// creeps back in and quietly bypasses the backend.
const CALL_LISTENING_SYNC_CONFIG_STORAGE_KEY = STORAGE_PREFIX + 'callListeningSyncConfig';
const REPO_SYNC_LAST_SUCCESS_STORAGE_KEY = STORAGE_PREFIX + 'repoSyncLastSuccess';
const REPO_BACKUP_APPLIED_AT_STORAGE_KEY = STORAGE_PREFIX + 'repoBackupAppliedAt';
const UI_NAV_STATE_STORAGE_KEY = STORAGE_PREFIX + 'uiNavState';
const GITHUB_REPO_API_URL = 'https://api.github.com/repos/ScottK83/Development-Coaching-Tool';

// Single source of truth: modules/metric-profiles.module.js
// These aliases keep existing references working without duplication
const YEAR_END_TARGETS_BY_YEAR = window.DevCoachModules?.metricProfiles?.TARGETS_BY_YEAR || {};
const METRIC_RATING_BANDS_BY_YEAR = window.DevCoachModules?.metricProfiles?.RATING_BANDS_BY_YEAR || {};

function getMetricProfilesModule() {
    return window?.DevCoachModules?.metricProfiles || null;
}

function getMetricRatingScore(metricKey, value, year) {
    const profileModule = getMetricProfilesModule();
    if (profileModule?.getRatingScore) {
        return profileModule.getRatingScore(metricKey, value, year);
    }
    return null;
}

function getRatingBandRowColor(metricKey, value, year) {
    const score = getMetricRatingScore(metricKey, value, year);
    if (score === 3) return '#d4edda';
    if (score === 2) return '#fff3cd';
    if (score === 1) return '#f8d7da';
    return null;
}

const YEAR_END_ANNUAL_GOALS = [
    { key: 'safetyGoalAps', label: 'Safety Goal at APS', expectation: 'Meeting' },
    { key: 'emergencySafetyHazardCalls', label: 'Emergency Safety Hazard Calls', expectation: '100% accuracy (No infractions)' },
    { key: 'accSubstantiatedComplaints', label: 'ACC Substantiated Complaints', expectation: '0 complaints' },
    { key: 'phishingClicks', label: 'Clicks on Phishing Emails', expectation: '0 clicks' },
    { key: 'redFlagViolations', label: 'Red Flag Violations', expectation: '0 violations' },
    { key: 'depositWaiverAccuracy', label: 'Deposit Waiver Accuracy', expectation: '100% accuracy' },
    { key: 'trainingCompletion', label: 'Completion of all training', expectation: 'Timely completion' },
    { key: 'timeEntryCompliance', label: 'Time entries completed each payday', expectation: 'On time each payday' }
];

// Sentiment Analysis Constants
const SENTIMENT_TOP_WINS_COUNT = 5;
const SENTIMENT_BOTTOM_COUNT = 5;
const SENTIMENT_UNUSED_SUGGESTIONS = 3;
const SENTIMENT_MIN_PHRASES_FOR_BOTTOM = 5;
const SENTIMENT_CUSTOMER_CONTEXT_COUNT = 3;
const SENTIMENT_EMOTION_LOW_THRESHOLD = 5;
const SENTIMENT_PHRASE_DB_STORAGE_KEY = window.DevCoachConstants?.SENTIMENT_PHRASE_DB_STORAGE_KEY || 'sentimentPhraseDatabase';
const ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY = window.DevCoachConstants?.ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY || 'associateSentimentSnapshots';

// ============================================
// TARGET METRICS
// ============================================

// ============================================
// METRICS REGISTRY - SINGLE SOURCE OF TRUTH
// ============================================

// METRICS_REGISTRY is loaded from modules/metrics-registry.module.js

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Smart Defaults - Save and restore user preferences
 */
function saveSmartDefault(key, value) {
    try {
        localStorage.setItem(STORAGE_PREFIX + 'smartDefault_' + key, JSON.stringify(value));
    } catch (e) {
        console.error('Failed to save smart default:', e);
    }
}

function getSmartDefault(key, fallback = null) {
    try {
        const stored = localStorage.getItem(STORAGE_PREFIX + 'smartDefault_' + key);
        return stored ? JSON.parse(stored) : fallback;
    } catch (e) {
        return fallback;
    }
}

/**
 * Data Validation - Validate PowerBI paste before processing
 */
/**
 * Mark changes as unsaved
 */
function markUnsavedChanges() {
    hasUnsavedChanges = true;
    document.title = document.title.includes('*') ? document.title : '* ' + document.title;
}

function clearUnsavedChanges() {
    hasUnsavedChanges = false;
    document.title = document.title.replace(/^\* /, '');
}

/**
 * Restore smart defaults on page load
 */
function restoreSmartDefaults() {
    // Restore period type preference
    const lastPeriodType = getSmartDefault('lastPeriodType');
    if (lastPeriodType) {
        const button = document.querySelector(`button[data-period-type="${lastPeriodType}"]`);
        if (button) {
            // Simulate click on the period type button
            const allPeriodButtons = document.querySelectorAll('[data-period-type]');
            allPeriodButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');
        }
    }
    
    // Auto-select most recent week in dropdowns
    const weekKeys = getWeeklyKeysSorted();
    if (weekKeys.length > 0) {
        const mostRecentWeek = weekKeys[weekKeys.length - 1];
        
        // Set in main period dropdown
        const periodSelect = document.getElementById('weekSelect');
        if (periodSelect) {
            periodSelect.value = mostRecentWeek;
        }
        
        // Set in metric trends dropdown
        const trendSelect = document.getElementById('trendWeekSelect');
        if (trendSelect) {
            trendSelect.value = mostRecentWeek;
        }
    }
    
    // Restore last selected employee
    const lastEmployee = getSmartDefault('lastEmployee');
    if (lastEmployee) {
        const employeeSelect = document.getElementById('employeeSelect');
        if (employeeSelect) {
            // Check if this employee still exists in the data
            const optionExists = Array.from(employeeSelect.options).some(opt => opt.value === lastEmployee);
            if (optionExists) {
                employeeSelect.value = lastEmployee;
            }
        }
    }
}

/**
 * Hide all sections except the specified one
 */
// Navigation functions delegated to modules/navigation.module.js
function showOnlySection(sectionId) {
    window.DevCoachModules?.navigation?.showOnlySection?.(sectionId);
}
function showSubSection(subSectionId, activeButtonId = null) {
    window.DevCoachModules?.navigation?.showSubSection?.(subSectionId, activeButtonId);
}
function showManageDataSubSection(subSectionId) {
    window.DevCoachModules?.navigation?.showManageDataSubSection?.(subSectionId);
}
function showMyTeamSubSection(subSectionId, activeButtonId = null) {
    window.DevCoachModules?.navigation?.showMyTeamSubSection?.(subSectionId, activeButtonId);
}
function showTrendsSubSection(subSectionId, activeButtonId = null) {
    window.DevCoachModules?.navigation?.showTrendsSubSection?.(subSectionId, activeButtonId);
}
function showReviewPrepSubSection(subSectionId, activeButtonId = null) {
    window.DevCoachModules?.navigation?.showReviewPrepSubSection?.(subSectionId, activeButtonId);
}
function getDefaultUiNavState() {
    return window.DevCoachModules?.navigation?.getDefaultUiNavState?.() || { sectionId: 'dashboardSection', myTeamSubSectionId: 'subSectionMorningPulse', trendsSubSectionId: 'subSectionTaTrendIntelligence', reviewPrepSubSectionId: 'subSectionOnOffTracker', settingsSubSectionId: 'subSectionTeamMembers' };
}

// Navigation state functions delegated to modules/navigation.module.js
function loadUiNavState() {
    return window.DevCoachModules?.navigation?.loadUiNavState?.() || getDefaultUiNavState();
}
function saveUiNavState(partialState = {}) {
    window.DevCoachModules?.navigation?.saveUiNavState?.(partialState);
}
function restoreLastViewedSection() {
    window.DevCoachModules?.navigation?.restoreLastViewedSection?.();
}

/**
 * Initialize the content of a section when it's shown
 */
function initializeSection(sectionId) {
    switch(sectionId) {
        case 'tipsManagementSection':
            renderTipsManagement();
            break;
        case 'metricTrendsSection':
            initializeMetricTrends();
            break;
        case 'manageDataSection':
            console.log('🔧 Initializing Manage Data section');
            populateDeleteWeekDropdown();
            populateDeleteSentimentDropdown();
            renderEmployeesList();
            window.DevCoachModules?.sharedUtils?.bindCoachingCcEmailSetting?.(document);
            window.DevCoachModules?.sharedUtils?.bindAssociateEmailPatternSetting?.(document);
            break;
        case 'executiveSummarySection':
            renderExecutiveSummary();
            break;
        case 'debugSection':
            renderDebugPanel();
            break;
    }
}

function escapeHtml(text) {
    return window.DevCoachModules?.sharedUtils?.escapeHtml?.(text) ?? String(text ?? '');
}

// Uses inline style.cssText for the toast. styles-v2.css has utility
// classes but no .toast yet; candidate for future CSS migration.
function showToast(message, duration = 5000) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');
    toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #28a745;
        color: white;
        padding: 12px 20px;
        border-radius: 4px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        font-size: 14px;
        z-index: 50000;
        animation: slideIn 0.3s ease-out;
    `;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

/**
 * Displays detailed error messages with specific troubleshooting guidance.
 * Maps error codes to user-friendly explanations with next steps.
 * 
 * @param {string} code - Error type (e.g., 'NO_DATA', 'MISSING_METRICS', 'NO_TIPS')
 * @param {Object} context - Additional context for error message formatting
 * @param {string} [source] - Function/source where error occurred (for logging)
 */
function showDetailedError(code, context = {}, source = '') {
    const errorMessages = {
        'NO_DATA': {
            title: '📊 No Data Found',
            message: `No data available for the selected ${context.period || 'period'}. Try uploading metrics or selecting a different employee.`,
            action: 'Check your data upload and try again'
        },
        'MISSING_METRICS': {
            title: '⚠️ Missing Metrics',
            message: `Some metrics are incomplete. ${context.count || '?'} metrics have missing values.`,
            action: 'Review and fill in missing metric values in the data upload'
        },
        'NO_TIPS': {
            title: '📚 No Tips Available',
            message: `No coaching tips are available for this metric. Consider adding tips in the Manage Tips section.`,
            action: 'Go to Manage Tips → Coaching Tips to add content'
        },
        'NO_COACHING_LOG': {
            title: '📝 No Coaching History',
            message: `You haven't recorded any coaching sessions yet. Start by generating a coaching email.`,
            action: 'Use the Coaching Email section to create your first entry'
        },
        'STORAGE_FULL': {
            title: '💾 Storage Nearly Full',
            message: `Browser storage is almost full (${context.usage || '?'}/4MB). Export and clear old data.`,
            action: 'Use the Data Management section to export and clear history'
        },
        'MISSING_EMPLOYEE': {
            title: '👤 Employee Not Found',
            message: `Unable to identify the employee. Make sure an employee is selected.`,
            action: 'Select an employee from the dropdown and try again'
        },
        'MISSING_PERIOD': {
            title: '📅 Period Not Selected',
            message: `Please select a time period (week, month, or year-to-date).`,
            action: 'Choose a period from the period selector'
        }
    };
    
    const error = errorMessages[code] || {
        title: '⚠️ Error Occurred',
        message: `An unexpected error occurred: ${code}`,
        action: 'Check the Debug panel for more information'
    };
    
    const toastMsg = `${error.title}\n${error.message}`;
    showToast(toastMsg, 5000);
    
    if (source) {
        console.warn(`[${source}] ${code}:`, error.message, context);
    }
}

function showLoadingSpinner(message = 'Processing...') {
    hideLoadingSpinner(); // Remove any existing spinner
    const spinner = document.createElement('div');
    spinner.id = 'globalLoadingSpinner';
    spinner.setAttribute('role', 'status');
    spinner.setAttribute('aria-live', 'polite');
    spinner.setAttribute('aria-busy', 'true');
    spinner.innerHTML = `
        <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 99999; display: flex; align-items: center; justify-content: center;">
            <div style="background: var(--bg-surface); padding: 30px 40px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); text-align: center;">
                <div style="width: 50px; height: 50px; border: 5px solid #f3f3f3; border-top: 5px solid #2196F3; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 15px;"></div>
                <div style="font-size: 16px; color: var(--text-primary); font-weight: 600;">${escapeHtml(message)}</div>
            </div>
        </div>
    `;
    document.body.appendChild(spinner);
    // Add CSS animation
    if (!document.getElementById('spinnerStyle')) {
        const style = document.createElement('style');
        style.id = 'spinnerStyle';
        style.textContent = '@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }';
        document.head.appendChild(style);
    }
}

function hideLoadingSpinner() {
    const spinner = document.getElementById('globalLoadingSpinner');
    if (spinner) spinner.remove();
}

// ============================================
// DEBUG PANEL
// ============================================

// Debug functions delegated to modules/debug.module.js
function addDebugEntry(type, message, details = {}) {
    window.DevCoachModules?.debug?.addDebugEntry?.(type, message, details);
}
function installDebugListeners() {
    window.DevCoachModules?.debug?.installDebugListeners?.();
}
function getPeriodTypeCounts(sourceData) {
    return window.DevCoachModules?.debug?.getPeriodTypeCounts?.(sourceData) || {};
}
function getLatestPeriodKeyByType(sourceData, periodType) {
    return window.DevCoachModules?.debug?.getLatestPeriodKeyByType?.(sourceData, periodType) || null;
}
function getLocalStorageSummary() {
    return window.DevCoachModules?.debug?.getLocalStorageSummary?.() || {};
}
function buildDebugSnapshot() {
    return window.DevCoachModules?.debug?.buildDebugSnapshot?.() || {};
}
function buildDebugPayload() {
    return window.DevCoachModules?.debug?.buildDebugPayload?.() || {};
}
function renderDebugPanel() {
    window.DevCoachModules?.debug?.renderDebugPanel?.();
}
function copyDebugInfo() {
    window.DevCoachModules?.debug?.copyDebugInfo?.();
}
// ============================================
// NICKNAME MEMORY
// ============================================

function saveNickname(employeeFullName, nickname) {
    try {
        const nicknames = (window.DevCoachModules?.storage?.readStore?.('employeeNicknames') ?? {});
        nicknames[employeeFullName] = nickname;
        window.DevCoachModules?.storage?.saveWithSizeCheck?.('employeeNicknames', nicknames);
    } catch (error) {
        console.error('Error saving nickname:', error);
    }
}

function getSavedNickname(employeeFullName) {
    try {
        const nicknames = (window.DevCoachModules?.storage?.readStore?.('employeeNicknames') ?? {});
        return nicknames[employeeFullName] || '';
    } catch (error) {
        console.error('Error getting nickname:', error);
        return '';
    }
}

// ============================================
// DATA PARSING FUNCTIONS (FIXED)
// ============================================

// Data parsing functions are now in modules/data-parsing.module.js
// Use window.DevCoachModules.dataParsing.* to access them

// Wrapper functions for backward compatibility
function parsePowerBIRow(row) {
    return window.DevCoachModules?.dataParsing?.parsePowerBIRow?.(row);
}
function parsePercentage(value) {
    return window.DevCoachModules?.dataParsing?.parsePercentage?.(value) ?? 0;
}
function parseSurveyPercentage(value) {
    return window.DevCoachModules?.dataParsing?.parseSurveyPercentage?.(value) ?? '';
}
function parseSeconds(value) {
    return window.DevCoachModules?.dataParsing?.parseSeconds?.(value) ?? '';
}
function parseHours(value) {
    return window.DevCoachModules?.dataParsing?.parseHours?.(value) ?? 0;
}
function validatePastedData(dataText) {
    return window.DevCoachModules?.dataParsing?.validatePastedData?.(dataText) ?? { valid: false, issues: [] };
}
function parsePastedData(pastedText, startDate, endDate) {
    return window.DevCoachModules?.dataParsing?.parsePastedData?.(pastedText, startDate, endDate) ?? [];
}

// These constants are now in modules/data-parsing.module.js
// Access them via: window.DevCoachModules.dataParsing.POWERBI_COLUMNS, etc.
const POWERBI_COLUMNS = window.DevCoachModules?.dataParsing?.POWERBI_COLUMNS ?? [];
const CANONICAL_SCHEMA = window.DevCoachModules?.dataParsing?.CANONICAL_SCHEMA ?? {};
const COLUMN_MAPPING = window.DevCoachModules?.dataParsing?.COLUMN_MAPPING ?? {};

// parsePastedData is now in modules/data-parsing.module.js
// Use: window.DevCoachModules.dataParsing.parsePastedData(text, startDate, endDate)

// ============================================
// DATA LOADING - EXCEL FILES
// ============================================



// (Tips management code removed - migrated to tips.module.js)

// ============================================
// COACHING LOG HELPERS
// ============================================

/**
 * Records a coaching event, replacing today's for the same metrics.
 *
 * It used to append unconditionally, so regenerating a message logged another
 * event every time. Seven passes at the wording produced seven identical "AHT
 * coached Sep 4" rows, and worse, coaching-outcomes counted the tips in them as
 * seven separate uses, which is exactly the number the effectiveness rates are
 * built from.
 *
 * Same person, same metrics, same day is the same coaching. Whichever
 * generation was last is the one that went out, so it replaces the earlier
 * attempts rather than sitting alongside them.
 */
function appendCoachingLogEntry(entry) {
    if (!entry || !entry.employeeId) return;
    if (!coachingHistory[entry.employeeId]) {
        coachingHistory[entry.employeeId] = [];
    }

    const day = String(entry.generatedAt || '').slice(0, 10);
    const metrics = [...(entry.metricsCoached || [])].sort().join(',');
    const entries = coachingHistory[entry.employeeId];
    const existing = day && metrics
        ? entries.findIndex(item => String(item?.generatedAt || '').slice(0, 10) === day
            && [...(item?.metricsCoached || [])].sort().join(',') === metrics)
        : -1;

    if (existing >= 0) entries[existing] = entry;
    else entries.push(entry);

    saveCoachingHistory();
}

function getCoachingHistoryForEmployee(employeeId) {
    if (!employeeId) return [];
    const history = coachingHistory[employeeId] || [];
    return history
        .slice()
        .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
}

/**
 * Exports the entire coaching history to CSV format
 * @returns {string} CSV string with headers and all coaching entries
 */
function exportCoachingHistoryToCSV() {
    // Proper CSV quoting: wrap every field in quotes and double any internal
    // quotes. Safe for commas, quotes, and newlines in employee names,
    // timestamps, and metric lists.
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = ['Employee,Week Ending,Metrics Coached,AI Assisted,Generated At'];
    Object.entries(coachingHistory).forEach(([employeeId, entries]) => {
        (entries || []).forEach(entry => {
            const metricsStr = (entry.metricsCoached || []).join(';');
            const aiStr = entry.aiAssisted ? 'Yes' : 'No';
            const timestamp = entry.generatedAt ? new Date(entry.generatedAt).toLocaleString() : '';
            rows.push([q(employeeId), q(entry.weekEnding || ''), q(metricsStr), q(aiStr), q(timestamp)].join(','));
        });
    });
    return rows.join('\n') + '\n';
}

/**
 * Downloads the coaching history as a CSV file to the user's computer
 * @function
 */
function downloadCoachingHistoryCSV() {
    const csv = exportCoachingHistoryToCSV();
    
    if (csv.split('\n').length <= 1) {
        showDetailedError('NO_COACHING_LOG', { count: 0 });
        return;
    }
    
    const filename = `coaching_history_${new Date().toISOString().split('T')[0]}.csv`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    showToast(`✅ Downloaded ${filename}`, 3000);
}

/**
 * Every devCoachingTool_ key as its raw stored string. Enumerating the store
 * rather than listing keys by hand is the point: this file is the only copy of
 * ten stores that the repo sync has never carried, including the 1:1 notes and
 * the mid-year review notes, and a hand-maintained list is exactly how they
 * came to be missing in the first place. A new store is covered the day it is
 * written, without anyone remembering to add it here.
 */
function collectAllStoresVerbatim() {
    const stores = {};
    for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key || !key.startsWith(STORAGE_PREFIX)) continue;
        const raw = localStorage.getItem(key);
        if (raw !== null) stores[key] = raw;
    }

    // A bulk store lives in IndexedDB and is invisible to the sweep above. The
    // localStorage copy is stale while it still exists and gone once reclaimed,
    // so without this the backup silently loses coachingHistory,
    // reliabilityTracker, ptoTracker, followUpHistory and the rest, while still
    // reporting a store count that looks right.
    //
    // This is the file every recovery path falls back on. It must be read the
    // same way the app reads, through the storage module, not from the layer the
    // data used to live in.
    const storage = window.DevCoachModules?.storage;
    const bulkKeys = window.DevCoachConstants?.BULK_STORAGE_KEYS || [];
    if (typeof storage?.readStore === 'function') {
        bulkKeys.forEach((name) => {
            const value = storage.readStore(name);
            if (value === null || value === undefined) return;
            try {
                stores[STORAGE_PREFIX + name] = JSON.stringify(value);
            } catch (error) {
                console.error(`[backup] Could not serialize ${name}:`, error);
            }
        });
    }

    return stores;
}

// Bookkeeping and view state that belong to the machine and moment they were
// written, not to the data. Backed up for completeness, skipped on restore so a
// backup cannot drag another machine's sync timestamps or a stale "delete just
// ran" flag onto this one.
const NON_RESTORABLE_STORE_SUFFIXES = new Set([
    'deleteAllJustRan', 'debugLog', 'errorLog', 'lastError',
    'repoSyncLastSuccess', 'repoBackupAppliedAt',
    'uiNavState', 'selectedAssociate', 'teamMemberSelectorExpanded',
    'trendQueueLegendExpanded', 'celebrationsInnerTab', 'celebrationsSelection'
]);

/**
 * Writes every backed-up store back verbatim. Reports what failed rather than
 * returning a bare boolean, because a restore that silently drops a store is
 * how someone ends up working on top of data they think they recovered.
 */
function applyAllStoresVerbatim(stores) {
    const report = { total: 0, restored: 0, failed: [] };
    if (!stores || typeof stores !== 'object') return report;

    Object.keys(stores).forEach((key) => {
        if (!key.startsWith(STORAGE_PREFIX)) return;
        if (NON_RESTORABLE_STORE_SUFFIXES.has(key.slice(STORAGE_PREFIX.length))) return;

        const raw = stores[key];
        if (typeof raw !== 'string') return;

        report.total += 1;
        const name = key.slice(STORAGE_PREFIX.length);
        try {
            // Restore a bulk store to whichever backend serves it. Writing it to
            // localStorage puts it where nothing reads, so the restore reports
            // success and the app still shows nothing. Same mistake the repo
            // restore path made.
            const storage = window.DevCoachModules?.storage;
            const bulkKeys = window.DevCoachConstants?.BULK_STORAGE_KEYS || [];
            if (typeof storage?.saveWithSizeCheck === 'function' && bulkKeys.indexOf(name) > -1) {
                if (storage.saveWithSizeCheck(name, JSON.parse(raw))) report.restored += 1;
                else report.failed.push(`${name}: the store refused the write`);
                return;
            }
            localStorage.setItem(key, raw);
            report.restored += 1;
        } catch (error) {
            const mb = ((key.length + raw.length) * 2 / (1024 * 1024)).toFixed(2);
            report.failed.push(`${name} (${mb} MB): ${error?.name || 'write failed'}`);
        }
    });

    return report;
}

/**
 * Exports all app data (including sentiment snapshots) to JSON file
 */
function exportToExcel() {
    const allStores = collectAllStoresVerbatim();
    const exportData = {
        // Kept so a file written here still restores in older builds. The
        // authoritative copy is allStores; these five are a subset of it.
        weeklyData: weeklyData || {},
        ytdData: ytdData || {},
        callListeningLogs: callListeningLogs || {},
        sentimentPhraseDatabase: sentimentPhraseDatabase || null,
        associateSentimentSnapshots: associateSentimentSnapshots || {},
        allStores,
        allStoresVersion: 1,
        exportDate: new Date().toISOString(),
        appVersion: APP_VERSION
    };

    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    
    const exportFileDefaultName = `coaching_tool_backup_${new Date().toISOString().split('T')[0]}.json`;
    
    const downloadLink = document.createElement('a');
    downloadLink.setAttribute('href', URL.createObjectURL(dataBlob));
    downloadLink.setAttribute('download', exportFileDefaultName);
    downloadLink.style.visibility = 'hidden';
    
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
    URL.revokeObjectURL(downloadLink.getAttribute('href'));
    
    const weekCount = Object.keys(weeklyData || {}).length;
    const sentimentCount = Object.keys(associateSentimentSnapshots || {}).reduce((sum, emp) => sum + (associateSentimentSnapshots[emp]?.length || 0), 0);
    const callListeningCount = Object.values(callListeningLogs || {}).reduce((sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0), 0);

    const storeCount = Object.keys(exportData.allStores || {}).length;
    showToast(`✅ Exported ${weekCount} weeks + ${sentimentCount} sentiment snapshots + ${callListeningCount} call logs, and all ${storeCount} stores, to ${exportFileDefaultName}`, 5000);
}

// ============================================
// TEAM MEMBER MANAGEMENT
// ============================================

// Team filter functions delegated to modules/team-filter.module.js
function loadTeamMembers() {
    myTeamMembers = window.DevCoachModules?.storage?.loadTeamMembers?.() || {};
}
function saveTeamMembers() {
    window.DevCoachModules?.storage?.saveTeamMembers?.(myTeamMembers);
}
function setTeamMembersForWeek(weekKey, memberNames) {
    myTeamMembers[weekKey] = memberNames;
    saveTeamMembers();
    notifyTeamFilterChanged();
}
// Default team roster — used when no per-week selection exists
var DEFAULT_TEAM_MEMBERS = [
    'Robert Berrelleza', 'Kamella Dash', 'Alyssa Dimes', 'Desiree Clark',
    'Sabrina Gage', 'Angelina Fierro', 'Esperanza Palomera', 'Matrece Muldrow',
    'Destiny Cervantez', 'Esther Ramos', 'Jadyn Flowers', 'Kristin Villela',
    'Erica Kallestewa', 'Betty Yanez', 'Oceane Ingram', 'James Garcia',
    'Johnathan Padilla', 'Christi Martinez-Sharp'
];

function getTeamMembersForWeek(weekKey) {
    // Try exact key match first
    if (myTeamMembers[weekKey] && myTeamMembers[weekKey].length > 0) {
        return myTeamMembers[weekKey];
    }
    // Fall back to the most recent key that has selections
    var bestKey = null;
    var bestDate = 0;
    Object.keys(myTeamMembers).forEach(function(k) {
        if (!myTeamMembers[k] || myTeamMembers[k].length === 0) return;
        var endStr = k.includes('|') ? k.split('|')[1] : k;
        var d = new Date(endStr);
        if (!isNaN(d) && d.getTime() > bestDate) {
            bestDate = d.getTime();
            bestKey = k;
        }
    });
    if (bestKey) return myTeamMembers[bestKey];
    // Fall back to default team roster
    return DEFAULT_TEAM_MEMBERS;
}
window.getDefaultTeamMembers = function() { return DEFAULT_TEAM_MEMBERS; };
function isTeamMember(weekKey, employeeName) {
    const members = getTeamMembersForWeek(weekKey);
    return members.length === 0 || members.includes(employeeName);
}
function getLatestTeamSelectionWeekKey() {
    return window.DevCoachModules?.teamFilter?.getLatestTeamSelectionWeekKey?.() || '';
}
function getTeamSelectionWeekKey() {
    return window.DevCoachModules?.teamFilter?.getTeamSelectionWeekKey?.() || getLatestTeamSelectionWeekKey();
}
function getTeamSelectionContext() {
    return window.DevCoachModules?.teamFilter?.getTeamSelectionContext?.() || { weekKey: '', selectedMembers: [], selectedSet: null, totalEmployeesInWeek: 0, isFiltering: false };
}
function isAssociateIncludedByTeamFilter(employeeName, context = null) {
    return window.DevCoachModules?.teamFilter?.isAssociateIncludedByTeamFilter?.(employeeName, context) ?? true;
}
function filterAssociateNamesByTeamSelection(names) {
    return window.DevCoachModules?.teamFilter?.filterAssociateNamesByTeamSelection?.(names) || [];
}
function updateTeamFilterStatusChip() {
    window.DevCoachModules?.teamFilter?.updateTeamFilterStatusChip?.();
}
function notifyTeamFilterChanged() {
    updateTeamFilterStatusChip();
    window.dispatchEvent(new CustomEvent('devcoach:teamFilterChanged', { detail: getTeamSelectionContext() }));
}

function bindTeamFilterChangeHandlers() {
    if (teamFilterChangeHandlersBound) return;

    window.addEventListener('devcoach:teamFilterChanged', () => {
        initializeTrendIntelligence();
        renderTrendIntelligence();
        renderTrendVisualizations();
        populateTrendPeriodDropdown();
        const selectedTrendPeriod = String(document.getElementById('trendPeriodSelect')?.value || '').trim();
        if (selectedTrendPeriod) {
            populateEmployeeDropdownForPeriod(selectedTrendPeriod);
        }

        populateExecutiveSummaryAssociate();
        populateOneOnOneAssociateSelect();
        initializeCoachingEmail();
        initializeYearEndComments();
        initializeCallListeningSection();
        if (typeof initializePtoTracker === 'function') {
            initializePtoTracker();
        }
    });

    teamFilterChangeHandlersBound = true;
}

window.getTeamSelectionContext = getTeamSelectionContext;
window.isAssociateIncludedByTeamFilter = isAssociateIncludedByTeamFilter;

// ============================================
// CALL CENTER AVERAGES - FOR METRIC TRENDS
// ============================================

function loadCallCenterAverages() {
    try {
        const storage = window.DevCoachModules?.storage;
        if (storage?.loadCallCenterAverages) return storage.loadCallCenterAverages() || {};
        const saved = localStorage.getItem(STORAGE_PREFIX + 'callCenterAverages');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading call center averages:', error);
        return {};
    }
}

function saveCallCenterAverages(averages) {
    try {
        window.DevCoachModules?.storage?.saveWithSizeCheck?.('callCenterAverages', averages);
    } catch (error) {
        console.error('Error saving call center averages:', error);
    }
}

function getCallCenterAverageForPeriod(periodKey) {
    const averages = loadCallCenterAverages();
    return averages[periodKey] || null;
}

function setCallCenterAverageForPeriod(periodKey, avgData) {
    const averages = loadCallCenterAverages();
    averages[periodKey] = {
        ...avgData,
        lastUpdated: new Date().toISOString()
    };
    saveCallCenterAverages(averages);
}

// OPTIMIZE: Iterates employees multiple times (once per metric group).
// Could compute all averages in a single pass for better performance.
function calculateCenterAveragesFromEmployees(employees) {
    if (!employees || employees.length === 0) return null;

    const surveyWeighted = { cxRepOverall: 'repSatisfaction', fcr: 'fcr', overallExperience: 'overallExperience' };
    const rateMetrics = {
        scheduleAdherence: 'adherence',
        transfers: 'transfers',
        overallSentiment: 'sentiment',
        positiveWord: 'positiveWord',
        negativeWord: 'negativeWord',
        managingEmotions: 'managingEmotions',
        aht: 'aht',
        acw: 'acw',
        holdTime: 'holdTime'
    };

    const wSums = {};
    const wCounts = {};
    const avgKeys = Object.assign({}, rateMetrics, surveyWeighted);
    Object.values(avgKeys).forEach(k => { wSums[k] = 0; wCounts[k] = 0; });

    let reliabilitySum = 0;
    let reliabilityCount = 0;

    employees.forEach(emp => {
        const tc = parseInt(emp.totalCalls, 10);
        const st = parseInt(emp.surveyTotal, 10);

        // Rate metrics
        Object.entries(rateMetrics).forEach(([empKey, avgKey]) => {
            const v = parseFloat(emp[empKey]);
            if (!Number.isFinite(v)) return;
            const w = Number.isInteger(tc) && tc > 0 ? tc : 1;
            wSums[avgKey] += v * w;
            wCounts[avgKey] += w;
        });

        // Survey-weighted metrics
        Object.entries(surveyWeighted).forEach(([empKey, avgKey]) => {
            const v = parseFloat(emp[empKey]);
            if (!Number.isFinite(v)) return;
            const w = Number.isInteger(st) && st > 0 ? st : 0;
            if (w > 0) { wSums[avgKey] += v * w; wCounts[avgKey] += w; }
        });

        // Reliability: average per employee (not sum)
        const rel = parseFloat(emp.reliability);
        if (Number.isFinite(rel)) { reliabilitySum += rel; reliabilityCount++; }
    });

    const result = {};
    Object.values(avgKeys).forEach(k => {
        if (wCounts[k] > 0) result[k] = Math.round((wSums[k] / wCounts[k]) * 100) / 100;
    });
    if (reliabilityCount > 0) {
        result.reliability = Math.round((reliabilitySum / reliabilityCount) * 100) / 100;
    }

    return Object.keys(result).length > 0 ? result : null;
}


function migrateReliabilityCenterAverages() {
    try {
        const averages = loadCallCenterAverages();
        let changed = false;
        for (const [key, avg] of Object.entries(averages)) {
            if (avg?.reliability > 20) {
                // This was saved as raw total or *100 — divide by 144
                avg.reliability = Math.round((avg.reliability / 144) * 100) / 100;
                changed = true;
            }
        }
        if (changed) {
            saveCallCenterAverages(averages);
            console.log('[Migration] Fixed reliability center averages (divided by headcount)');
        }
    } catch (e) {
        console.warn('[Migration] Failed to fix reliability:', e.message);
    }
}

/**
 * Startup cleanup: remove auto-generated YTDs when a real YTD anchor exists.
 * Real YTD uploads are the source of truth — auto-generated ones are redundant.
 */
function cleanupStaleAutoYtds() {
    try {
        const findAnchor = window.DevCoachModules?.metricTrends?.findRealYtdAnchor;
        if (!findAnchor) return;

        const years = new Set();
        Object.keys(ytdData || {}).forEach(key => {
            const endText = key.includes('|') ? key.split('|')[1] : '';
            const d = endText ? new Date(endText) : null;
            if (d && !isNaN(d)) years.add(d.getFullYear());
        });

        let cleaned = 0;
        years.forEach(year => {
            const anchor = findAnchor(year);
            if (!anchor) return;
            // Remove all auto-generated YTDs for this year — the real YTD is truth
            Object.keys(ytdData).forEach(key => {
                const meta = ytdData[key]?.metadata;
                if (!meta?.autoGeneratedYtd) return;
                const endText = meta.endDate || (key.includes('|') ? key.split('|')[1] : '');
                const d = endText ? new Date(endText) : null;
                if (d && !isNaN(d) && d.getFullYear() === year) {
                    delete ytdData[key];
                    cleaned++;
                }
            });
        });

        if (cleaned > 0) {
            saveYtdData();
            console.log('[Startup] Cleaned ' + cleaned + ' stale auto-YTD entries');
        }
    } catch (e) {
        console.warn('[Startup] Auto-YTD cleanup failed:', e.message);
    }
}

/**
 * Keep only the newest real YTD per year, and only the newest week-in-progress
 * per Monday start date. Older entries are superseded by the newer upload —
 * this prevents the rankings dropdown from filling up with stale snapshots.
 */
function cleanupStaleDuplicatePeriods() {
    try {
        let cleaned = 0;

        // ── Real YTDs: keep the single newest per year ──
        const bestYtdByYear = {};
        Object.keys(ytdData || {}).forEach(key => {
            const meta = ytdData[key]?.metadata || {};
            if (meta.autoGeneratedYtd) return;
            const endText = meta.endDate || (key.includes('|') ? key.split('|')[1] : '');
            if (!endText) return;
            const year = parseInt(endText.split('-')[0], 10);
            if (!year) return;
            const uploadedAt = meta.uploadedAt ? new Date(meta.uploadedAt).getTime() : 0;
            const curr = bestYtdByYear[year];
            if (!curr ||
                endText > curr.endText ||
                (endText === curr.endText && uploadedAt > curr.uploadedAt)) {
                bestYtdByYear[year] = { key, endText, uploadedAt };
            }
        });
        Object.keys(ytdData || {}).forEach(key => {
            const meta = ytdData[key]?.metadata || {};
            if (meta.autoGeneratedYtd) return;
            const endText = meta.endDate || (key.includes('|') ? key.split('|')[1] : '');
            if (!endText) return;
            const year = parseInt(endText.split('-')[0], 10);
            if (!year || !bestYtdByYear[year]) return;
            if (bestYtdByYear[year].key !== key) {
                delete ytdData[key];
                if (myTeamMembers && myTeamMembers[key]) delete myTeamMembers[key];
                cleaned++;
            }
        });

        // ── Week-in-progress: keep the single newest per Monday start date ──
        const bestWipByStart = {};
        Object.keys(weeklyData || {}).forEach(key => {
            const meta = weeklyData[key]?.metadata || {};
            if (meta.periodType !== 'week-in-progress') return;
            const startText = meta.startDate || (key.includes('|') ? key.split('|')[0] : '');
            const endText = meta.endDate || (key.includes('|') ? key.split('|')[1] : '');
            if (!startText) return;
            const uploadedAt = meta.uploadedAt ? new Date(meta.uploadedAt).getTime() : 0;
            const curr = bestWipByStart[startText];
            if (!curr ||
                endText > curr.endText ||
                (endText === curr.endText && uploadedAt > curr.uploadedAt)) {
                bestWipByStart[startText] = { key, endText, uploadedAt };
            }
        });
        Object.keys(weeklyData || {}).forEach(key => {
            const meta = weeklyData[key]?.metadata || {};
            if (meta.periodType !== 'week-in-progress') return;
            const startText = meta.startDate || (key.includes('|') ? key.split('|')[0] : '');
            if (!startText || !bestWipByStart[startText]) return;
            if (bestWipByStart[startText].key !== key) {
                delete weeklyData[key];
                if (myTeamMembers && myTeamMembers[key]) delete myTeamMembers[key];
                cleaned++;
            }
        });

        if (cleaned > 0) {
            saveYtdData();
            saveWeeklyData();
            if (typeof saveTeamMembers === 'function') saveTeamMembers();
            console.log('[Startup] Cleaned ' + cleaned + ' stale duplicate YTD/week-in-progress entries');
        }
    } catch (e) {
        console.warn('[Startup] Duplicate YTD/WIP cleanup failed:', e.message);
    }
}

// Names people actually go by, where the first name off the roster is not it.
// Seeded rather than typed into Settings so it survives a wipe, and only ever
// fills a blank — anything set by hand wins.
const PREFERRED_NAME_SEED = {
    'Angelina Fierro': 'Ang'
};

(function seedPreferredNames() {
    try {
        const key = STORAGE_PREFIX + 'employeePreferredNames';
        const stored = JSON.parse(localStorage.getItem(key) || '{}');
        let added = false;
        Object.keys(PREFERRED_NAME_SEED).forEach(function(fullName) {
            if (stored[fullName]) return;
            stored[fullName] = PREFERRED_NAME_SEED[fullName];
            added = true;
        });
        if (added) localStorage.setItem(key, JSON.stringify(stored));
    } catch (_e) { console.warn('[preferredNames] seed skipped:', _e.message); }
})();

function getEmployeeNickname(fullName) {
    if (!fullName) return '';

    // Check if a custom preferred name has been set
    let preferredNames = {};
    try { preferredNames = (window.DevCoachModules?.storage?.readStore?.('employeePreferredNames') ?? {}); } catch (_e) { /* corrupt data */ }
    if (preferredNames[fullName]) {
        return preferredNames[fullName];
    }
    
    // Default: return first name
    return fullName.split(' ')[0];
}

function setEmployeePreferredName(fullName, preferredName) {
    if (!fullName) return;
    
    let preferredNames = {};
    try { preferredNames = (window.DevCoachModules?.storage?.readStore?.('employeePreferredNames') ?? {}); } catch (_e) { /* corrupt data */ }

    if (preferredName && preferredName.trim()) {
        preferredNames[fullName] = preferredName.trim();
    } else {
        // If empty, remove the custom preference (fall back to first name)
        delete preferredNames[fullName];
    }
    
    window.DevCoachModules?.storage?.saveWithSizeCheck?.('employeePreferredNames', preferredNames);
}

window.saveEmployeePreferredName = function(fullName) {
    const input = document.getElementById(`prefName_${fullName}`);
    if (!input) return;
    
    const preferredName = input.value.trim();
    setEmployeePreferredName(fullName, preferredName);
    
    showToast('✅ Preferred name updated!');
    renderEmployeesList();
};

// Hardcoded supervisor rosters (v4 — read off by Scott 2026-08-05).
// REFACTOR: These hardcoded employee names should be moved to a config file
// or loaded from KV/localStorage seed endpoint to avoid PII in source control
// and to simplify team roster updates.
//
// The roster is authoritative: it re-applies on every load, so a rep whose data
// is uploaded later still lands on the right team, and a rep who moves teams here
// moves everywhere. Anyone NOT on the roster keeps whatever the Settings screen
// assigned them. Names are matched on FULL name — there are duplicate first names
// across teams (two Carrolls, two Fierros, two Erikas, two Johnsons on Cruz), so
// first-name-only matching would put people on the wrong team.
//
// Spellings below are transcribed from APS Workforce Management (Supervisor/Advisor
// report, 8/3-8/4/2026) — the same system the uploads come from. Earlier versions of
// this roster were dictated by voice and had most names subtly wrong (Aaron Gray for
// Erin Garay, Patricia Herb for Trisha Erb, Kasey Gadri for Keshay Guidry), which
// silently dropped those reps to unassigned. Do not "correct" these from memory.
//
// Supervisor labels are deliberately informal (Kathy, Angie, Scott). The uploads carry
// the formal names — Cruz, Kathryn / Delgado, Angela / Knight, Scott — so anything that
// starts parsing a supervisor column out of a PowerBI paste will need to map them.
const SUPERVISOR_ROSTER = [
    { supervisor: 'Angela Allison', agents: ['Jacob Head', 'Kayte Heese', 'Jewels Jefferson', 'Savannah Johannesen', 'Tiffany Kailipalauli', 'Keyahveh McTier', 'Taylor Meyn', 'Aisha Oakes', 'Haley Pennington', 'Janessa Ramirez', 'Robert Sullivan', 'Sabrina Trent', 'Alanna Ussery', 'Jeffrey Young'] },
    { supervisor: 'Miranda Chase', agents: ['Jose Atayde', 'Edgar Calvillo', 'Taylor Colter', 'JoAnn Courtney', 'Erika Forte', 'Brianna Hill', 'Derrick Ingram', 'Victoria Johnson', 'Milani Ortega-Phung', 'Alicia Snyder', 'India Torain', 'Tina Williams'] },
    { supervisor: 'Kathy Cruz', agents: ['Michelle Castro', 'Diane Cordova', 'Trisha Erb', 'Jennifer Frank', 'Erin Garay', 'April Gonzalez', 'Jammie Harvey', 'Elbia Johnson', 'Precious Johnson', 'Natasha Jordan', 'Sonya Martin', 'Charles McCormick', 'Sandra Paz-Rodriguez', 'Paul Schoenthaler', 'Sebastian Vera', 'Dillon Yeager'] },
    { supervisor: 'Angie Delgado', agents: ['Melinda Cano', 'Ronda Colis', 'Miah Dixon', 'Anahi Griego', 'Retta Hays', 'Jarusha Holmes', 'Sarah Jordan', 'Dawn Martinez', 'Rachel Melendrez', 'Ariell Millican', 'Brandi Olson', 'Cindy Pipkins', 'Alexandra Rangel', 'Christi-Ann Thompson', 'Alejandra Valdez', 'Lonia Varela', 'Crystal Villalpando'] },
    { supervisor: 'Sarah Gregory', agents: ['Magarsa Ali', 'Solomon Arrona', 'Ekiecha Brabham', 'Brittney Carroll', 'Darryn Coley', 'Armida Flores', 'Erika Garrett', 'Kim Gugora', 'Keshay Guidry', 'Marietta Henderson', 'Aldo Hernandez', 'Sophie Holland', 'Holly Lomatska', 'John Montoya', 'Pamela Muhammad', 'Eilene Parrish', 'Briana Zambrano'] },
    { supervisor: 'Schnelle Howard', agents: ['Sarah Camacho', 'Stephanie Carbajal-Saiz', 'Alexis Carroll', 'Caylie Chirumbolo', 'Caitlyn Fidler', 'Jenifer Henson', 'Kimmy Hong', 'Monica Madden', 'Crystal Nez', 'Scoticia Osborne', 'Seth Pinyerd', 'Tracy Rucker', 'Michelle Weibrecht', 'Rachael Wilson'] },
    { supervisor: 'Nicole Pazienza', agents: ['Amy Armenta', 'Jessica Barbosa', 'Richard Biehl', 'Imelda Bustos', 'Jacob Chernov', 'Bruce Cram', 'Nikayla Cruz', 'Wisdom Curry', 'Cecily Daniels', 'Tanya Davis', 'Geralene Dixon', 'Dawanda Kizee-Daniel', 'Shawn Leigh', 'Ashley Robinson', 'Cindy Robledo', 'Ebany Soto', 'Monica Stringer', 'Brayden Thielbar', 'Jereca Whiteman'] },
    { supervisor: 'Scott', agents: ['Robert Berrelleza', 'Destiny Cervantez', 'Desiree Clark', 'Kamella Dash', 'Alyssa Dimes', 'Angelina Fierro', 'Jadyn Flowers', 'Sabrina Gage', 'James Garcia', 'Oceane Ingram', 'Erica Kallestewa', 'Christi Martinez-Sharp', 'Matrece Muldrow', 'Johnathan Padilla', 'Esperanza Palomera', 'Esther Ramos', 'Kristin Villela', 'Betty Yanez'] }
];

// Known non-associates, kept as a named record so nobody re-adds them to the roster
// without knowing why they were pulled. The operative mechanism is the roster itself
// (see isRosteredAssociate) — anyone not on it is dropped — so this list is a
// second line of defence plus documentation, not the primary filter.
//
//   Team leads      — one per team (two on Allison). They are filtered out of the
//                     source report by Job Title, so they normally never appear in a
//                     paste at all. Spellings are the old dictated ones and were never
//                     confirmed against the source system, so treat them as approximate.
//   Spanish-ranked  — on Gregory's team but ranked against a separate Spanish pool,
//                     so mixing them into center numbers compares unlike work.
//                     Spellings ARE verified from the source report.
//   Not residential — Christine Ellis's team was in the roster by mistake. It is a
//                     different org and never belonged in these numbers.
const EXCLUDED_ASSOCIATES = [
    // Team leads
    'Lashray Concho', 'Austin Hadlock', 'Wendy Cervantes', 'Lynette Gomez',
    'Sherry Hanson', 'Adrian Morales', 'Daniel Gradias', 'Brandywine Lockhart',
    'Cynthia Pacheco',
    // Spanish-ranked (Gregory)
    'Julia Fierro', 'Jessica Hilario', 'Rocio Mendez', 'Erika Trejo',
    // Christine Ellis's team — not residential
    'Christine Ellis', 'Daniel Adams', 'Veronica Barrios', 'Javier De Leon',
    'Margarita Gastello', 'Debbie Hernandez', 'Dolores Hernandez', 'Lily Hanahi',
    'Carla Canuri', 'Maria Lopez', 'Nancy McCarthy', 'Stephanie McNair', 'Lisa Oust',
    'Raquel Perez', 'John Ruiz', 'Sherry Rycraft', 'Christina Sanchez',
    'Michael Vaughan', 'Alexia Zeniga'
];

// "Last, First" -> "first last", lowercased, punctuation stripped, spaces collapsed.
function normalizeRosterName(name) {
    let n = String(name || '').trim();
    if (n.indexOf(',') > -1) {
        const halves = n.split(',');
        n = halves.slice(1).join(' ').trim() + ' ' + halves[0].trim();
    }
    return n.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

// Surnames are every token after the first. Uploads and the roster disagree on
// compound surnames (Robledo vs Robledo Avanizodo, Martinez Sharp vs
// Martinez-Sharp), so tokens count as a hit when one contains the other.
function rosterSurnamesOverlap(aTokens, bTokens) {
    const a = aTokens.slice(1), b = bTokens.slice(1);
    if (!a.length || !b.length) return false;
    return a.some(function(x) {
        return b.some(function(y) {
            if (x === y) return true;
            return x.length >= 4 && y.length >= 4 && (x.indexOf(y) > -1 || y.indexOf(x) > -1);
        });
    });
}

// Flattened roster, normalized once, for membership tests.
const ROSTER_NAME_INDEX = SUPERVISOR_ROSTER.reduce(function(acc, team) {
    team.agents.forEach(function(agent) {
        const norm = normalizeRosterName(agent);
        acc.push({ norm: norm, tokens: norm.split(' ').filter(Boolean) });
    });
    return acc;
}, []);

const EXCLUDED_NAME_INDEX = EXCLUDED_ASSOCIATES.map(normalizeRosterName);

// The roster is an ALLOWLIST, not a denylist. Uploads carry everyone the report was
// run for — departed reps, other orgs, team leads, and the Spanish-ranked pool — and
// historically all of them accumulated in weeklyData forever, which is how 127 real
// associates became 257 rows feeding the rankings and center averages.
//
// Consequence worth knowing: a genuine new hire is invisible to every metric until
// somebody adds them to SUPERVISOR_ROSTER above. That is the deliberate trade — a
// missing new hire is noticed, a silently-inflated average is not.
//
// Matching mirrors the tiers in seedSupervisorTeams so upload spelling drift still
// lands: exact, then first-name + overlapping surname, then nickname prefix + surname.
function isRosteredAssociate(name) {
    const norm = normalizeRosterName(name);
    if (!norm) return false;
    if (EXCLUDED_NAME_INDEX.indexOf(norm) > -1) return false;

    const tokens = norm.split(' ').filter(Boolean);
    const first = tokens[0] || '';

    return ROSTER_NAME_INDEX.some(function(r) {
        if (r.norm === norm) return true;
        if (!rosterSurnamesOverlap(r.tokens, tokens)) return false;
        const rf = r.tokens[0] || '';
        if (rf === first) return true;
        return first.length >= 3 && rf.length >= 3 &&
            (first.indexOf(rf.slice(0, 3)) === 0 || rf.indexOf(first.slice(0, 3)) === 0);
    });
}
window.isRosteredAssociate = isRosteredAssociate;
// Exposed for the contest panel, which needs the names to build its day grid.
// Read at click time, so the load order between modules and script.js does not
// matter.
window.SUPERVISOR_ROSTER = SUPERVISOR_ROSTER;

// Strips everyone off the roster out of stored period data. Historical rows are
// rewritten, so past center averages shift — that is the point, those numbers were
// always counting people who should not have been in them.
function purgeNonRosteredEmployees() {
    const removed = {};

    ['weeklyData', 'ytdData'].forEach(function(storeKey) {
        let store;
        try { store = JSON.parse(localStorage.getItem(STORAGE_PREFIX + storeKey) || '{}'); }
        catch (_e) { console.warn('[purgeNonRostered] Could not read ' + storeKey + ':', _e.message); return; }

        let touched = false;
        Object.keys(store).forEach(function(periodKey) {
            const period = store[periodKey];
            if (!period || !Array.isArray(period.employees)) return;
            const kept = period.employees.filter(function(emp) {
                const empName = emp && emp.name;
                if (!empName) return false;
                if (isRosteredAssociate(empName)) return true;
                removed[empName] = true;
                return false;
            });
            if (kept.length !== period.employees.length) {
                period.employees = kept;
                touched = true;
            }
        });

        if (touched) {
            try { localStorage.setItem(STORAGE_PREFIX + storeKey, JSON.stringify(store)); }
            catch (_e) { console.warn('[purgeNonRostered] Could not save ' + storeKey + ':', _e.message); }
        }
    });

    // Same treatment for the side tables keyed by name, or deleted reps keep their
    // supervisor colour and stay checked in the team filter.
    ['employeeSupervisors', 'employeePreferredNames'].forEach(function(mapKey) {
        try {
            const map = JSON.parse(localStorage.getItem(STORAGE_PREFIX + mapKey) || '{}');
            let touched = false;
            Object.keys(map).forEach(function(empName) {
                if (!isRosteredAssociate(empName)) { delete map[empName]; touched = true; }
            });
            if (touched) localStorage.setItem(STORAGE_PREFIX + mapKey, JSON.stringify(map));
        } catch (_e) { console.warn('[purgeNonRostered] Could not clean ' + mapKey + ':', _e.message); }
    });

    // myTeamMembers is { weekKey: [names] }, not a flat array. This read it as
    // an array and gated on Array.isArray, which is never true for the real
    // value, so this branch has never cleaned anything. Worse, had it ever
    // matched it would have written a flat array back over the object store.
    try {
        const raw = (function(){var v=window.DevCoachModules?.storage?.readStore?.('myTeamMembers');return v===undefined||v===null?null:JSON.stringify(v);})();
        const byWeek = raw ? JSON.parse(raw) : {};
        if (byWeek && typeof byWeek === 'object' && !Array.isArray(byWeek)) {
            let touched = false;
            Object.keys(byWeek).forEach(function(weekKey) {
                const names = byWeek[weekKey];
                if (!Array.isArray(names)) return;
                const kept = names.filter(isRosteredAssociate);
                if (kept.length !== names.length) { byWeek[weekKey] = kept; touched = true; }
            });
            if (touched) window.DevCoachModules?.storage?.saveWithSizeCheck?.('myTeamMembers', byWeek);
        }
    } catch (_e) { console.warn('[purgeNonRostered] Could not clean myTeamMembers:', _e.message); }

    return Object.keys(removed).sort();
}
window.purgeNonRosteredEmployees = purgeNonRosteredEmployees;

// Periods stored before the blank-means-zero fix recorded '' for anyone the report
// left empty, so reps with nothing against them were dropped from the metric instead
// of counted as clean.
//
// Decided per period, never globally: stored data cannot tell "column was absent"
// apart from "cell was blank" — both are ''. But if ANY rep in a period has a real
// number, the column was there, so every blank beside it means zero. A period where
// nobody has a number is left alone rather than handed a file-wide perfect score.
function backfillBlankReliability() {
    let filled = 0;

    ['weeklyData', 'ytdData'].forEach(function(storeKey) {
        let store;
        try { store = JSON.parse(localStorage.getItem(STORAGE_PREFIX + storeKey) || '{}'); }
        catch (_e) { console.warn('[backfillReliability] Could not read ' + storeKey + ':', _e.message); return; }

        let touched = false;
        Object.keys(store).forEach(function(periodKey) {
            const period = store[periodKey];
            if (!period || !Array.isArray(period.employees)) return;

            const columnWasPresent = period.employees.some(function(emp) {
                return emp && Number.isFinite(parseFloat(emp.reliability));
            });
            if (!columnWasPresent) return;

            period.employees.forEach(function(emp) {
                if (emp && (emp.reliability === '' || emp.reliability === null || emp.reliability === undefined)) {
                    emp.reliability = 0;
                    filled++;
                    touched = true;
                }
            });
        });

        if (touched) {
            try { localStorage.setItem(STORAGE_PREFIX + storeKey, JSON.stringify(store)); }
            catch (_e) { console.warn('[backfillReliability] Could not save ' + storeKey + ':', _e.message); }
        }
    });

    return filled;
}
window.backfillBlankReliability = backfillBlankReliability;

(function migrateBlankReliability() {
    if (localStorage.getItem(STORAGE_PREFIX + 'reliabilityBlankIsZero_v1')) return;
    const filled = backfillBlankReliability();
    if (filled) console.info('[backfillReliability] Set ' + filled + ' blank reliability value(s) to 0.');
    localStorage.setItem(STORAGE_PREFIX + 'reliabilityBlankIsZero_v1', '1');
})();

(function seedSupervisorTeams() {
    let existing = {};

    // Rename, not a re-seed: the roster below overwrites anyone it still
    // matches, but a rep who has left it would otherwise keep the misspelling
    // forever and lose their row colour.
    if (!localStorage.getItem(STORAGE_PREFIX + 'supervisorRenamed_schnelle')) {
        try {
            const stored = (window.DevCoachModules?.storage?.readStore?.('employeeSupervisors') ?? {});
            let touched = false;
            Object.keys(stored).forEach(function(name) {
                if (stored[name] === 'Chenal Howard') { stored[name] = 'Schnelle Howard'; touched = true; }
            });
            if (touched) window.DevCoachModules?.storage?.saveWithSizeCheck?.('employeeSupervisors', stored);
        } catch (_e) { console.warn('[seedSupervisorTeams] rename skipped:', _e.message); }
        localStorage.setItem(STORAGE_PREFIX + 'supervisorRenamed_schnelle', '1');
    }
    // v5 migration: the v4 roster was voice-dictated and most names were subtly wrong,
    // so reps matched loosely or not at all, and every departed rep, team lead, and
    // out-of-org name ever uploaded was still sitting in weeklyData — 257 rows for 127
    // people. Wipe the assignments and purge the stores down to the roster, once.
    if (!localStorage.getItem(STORAGE_PREFIX + 'supervisorSeeded_v5_migration')) {
        localStorage.removeItem(STORAGE_PREFIX + 'employeeSupervisors');
        const purged = purgeNonRosteredEmployees();
        if (purged.length) console.info('[seedSupervisorTeams] v5 purge removed ' + purged.length + ' non-rostered name(s):', purged);
        localStorage.setItem(STORAGE_PREFIX + 'supervisorSeeded_v5_migration', '1');
        localStorage.setItem(STORAGE_PREFIX + 'supervisorSeeded_v4_migration', '1');
    } else {
        try { existing = (window.DevCoachModules?.storage?.readStore?.('employeeSupervisors') ?? {}); } catch (_e) { console.warn('[seedSupervisorTeams] Failed to parse existing supervisors:', _e.message); }
    }

    const allEmps = {};
    try {
        const wd = loadWeeklyData() || {};
        const yd = loadYtdData() || {};
        [wd, yd].forEach(function(ds) {
            Object.values(ds || {}).forEach(function(period) {
                (period?.employees || []).forEach(function(emp) {
                    if (emp?.name) allEmps[emp.name] = true;
                });
            });
        });
    } catch (_e) { console.warn('[seedSupervisorTeams] Failed to parse employee data:', _e.message); }

    const candidates = Object.keys(allEmps).map(function(raw) {
        const norm = normalizeRosterName(raw);
        return { raw: raw, norm: norm, tokens: norm.split(' ').filter(Boolean) };
    });
    if (!candidates.length) return;

    // Only accept a tier when exactly one employee qualifies — an ambiguous name
    // is left unassigned rather than guessed onto the wrong team.
    function uniqueMatch(pool, predicate) {
        const hits = pool.filter(predicate);
        return hits.length === 1 ? hits[0] : null;
    }

    const unmatched = [];
    SUPERVISOR_ROSTER.forEach(function(team) {
        team.agents.forEach(function(agent) {
            const norm = normalizeRosterName(agent);
            const tokens = norm.split(' ').filter(Boolean);
            const first = tokens[0] || '';

            let hit = uniqueMatch(candidates, function(c) { return c.norm === norm; });
            if (!hit) hit = uniqueMatch(candidates, function(c) { return c.tokens[0] === first && rosterSurnamesOverlap(tokens, c.tokens); });
            // Nicknames and spelling drift on the first name (Christi/Christy,
            // Erica/Erika, Jadyn/Jaden) — surname still has to line up.
            if (!hit) hit = uniqueMatch(candidates, function(c) {
                const cf = c.tokens[0] || '';
                const sharesPrefix = first.length >= 3 && cf.length >= 3 && (first.indexOf(cf.slice(0, 3)) === 0 || cf.indexOf(first.slice(0, 3)) === 0);
                return sharesPrefix && rosterSurnamesOverlap(tokens, c.tokens);
            });
            // Uploads that carry a first name only.
            if (!hit) hit = uniqueMatch(candidates, function(c) { return c.tokens.length === 1 && c.tokens[0] === first; });

            if (hit) {
                existing[hit.raw] = team.supervisor;
            } else {
                unmatched.push(team.supervisor + ': ' + agent);
            }
        });
    });

    window.DevCoachModules?.storage?.saveWithSizeCheck?.('employeeSupervisors', existing);
    if (unmatched.length) console.info('[seedSupervisorTeams] No employee data matched ' + unmatched.length + ' rostered name(s):', unmatched);
})();

function getEmployeeSupervisors() {
    try {
        return (window.DevCoachModules?.storage?.readStore?.('employeeSupervisors') ?? {});
    } catch (_e) { return {}; }
}

function setEmployeeSupervisor(name, supervisor) {
    if (!name) return;
    const sups = getEmployeeSupervisors();
    if (supervisor && supervisor.trim()) {
        sups[name] = supervisor.trim();
    } else {
        delete sups[name];
    }
    window.DevCoachModules?.storage?.saveWithSizeCheck?.('employeeSupervisors', sups);
}

function formatDateMMDDYYYY(dateString) {
    if (!dateString) return '';
    const [year, month, day] = dateString.split('-');
    if (!year || !month || !day) return '';
    return `${month}/${day}/${year}`;
}

function formatWeekLabel(weekKey) {
    if (!weekKey) return '';
    const parts = weekKey.split('|');
    if (parts.length >= 2) {
        const endDate = parts[1];
        return formatDateMMDDYYYY(endDate);
    }
    return weekKey;
}

function evaluateMetricsForCoaching(employeeData) {
    if (!employeeData) {
        return { celebrate: [], needsCoaching: [], coachedMetricKeys: [] };
    }
    const promptUnit = {
        scheduleAdherence: '%',
        cxRepOverall: '%',
        fcr: '%',
        overallExperience: '%',
        transfers: '%',
        overallSentiment: '%',
        positiveWord: '%',
        negativeWord: '%',
        managingEmotions: '%',
        aht: ' seconds',
        acw: ' seconds',
        holdTime: ' seconds',
        reliability: ' hours missed'
    };
    const celebrate = [];
    const needsCoaching = [];
    const coachedMetricKeys = [];

    Object.keys(promptUnit).forEach(key => {
        const metricDef = METRICS_REGISTRY[key];
        if (!metricDef) return;
        const rawValue = employeeData[key];
        if (rawValue === '' || rawValue === null || rawValue === undefined) return;
        const val = parseFloat(rawValue);
        if (isNaN(val)) return;

        const meetsTarget = metricDef.target.type === 'min' ? val >= metricDef.target.value : val <= metricDef.target.value;
        const unit = promptUnit[key] || '';
        
        // For negativeWord metric: show both using % and avoiding %
        let displayValue = `${val}${unit}`;
        let targetDisplay = `${metricDef.target.value}${unit}`;
        let fullLabel = metricDef.label;
        
        if (key === 'negativeWord') {
            const usingNegative = 100 - val;
            const avoidingTarget = metricDef.target.value;
            const usingNegativeTarget = 100 - avoidingTarget;
            displayValue = `${val}% avoiding (${usingNegative}% using negative words)`;
            targetDisplay = `${avoidingTarget}% avoiding (${usingNegativeTarget}% using)`;
            fullLabel = 'Avoid Negative Words';
        }

        if (meetsTarget) {
            celebrate.push(`- ${fullLabel}: ${displayValue} (Target: ${targetDisplay})`);
        } else {
            const gap = metricDef.target.type === 'min'
                ? `${(metricDef.target.value - val).toFixed(1)}${unit} below target`
                : `${(val - metricDef.target.value).toFixed(1)}${unit} above target`;
            needsCoaching.push(`- ${fullLabel}: ${displayValue} (Target: ${targetDisplay}, ${gap})`);
            coachedMetricKeys.push(key);
        }
    });

    return { celebrate, needsCoaching, coachedMetricKeys };
}

/**
 * Records a coaching session in the coaching history log.
 * Used to track coaching interactions for compliance and follow-up purposes.
 * 
 * @param {Object} params - Coaching event details
 * @param {string} params.employeeId - Employee identifier (display name)
 * @param {string} params.weekEnding - Week/period label for the coaching (e.g., "Week of 2/19")
 * @param {string[]} params.metricsCoached - Array of metric keys addressed in coaching (e.g., ['aht', 'fcr'])
 * @param {boolean} [params.aiAssisted=false] - Whether Copilot/AI was used to generate content
 * @param {Array<{id:string,metricKey:string,text:string}>} [params.suggestions] - The specific
 *   advice given, so coaching-outcomes can measure whether a tip lands, not just a topic
 * @returns {void} Entry is saved to localStorage via saveCoachingHistory()
 * 
 * @example
 * recordCoachingEvent({
 *   employeeId: 'John Doe',
 *   weekEnding: 'Week of 2/19/2026',
 *   metricsCoached: ['aht'],
 *   aiAssisted: true
 * });
 */
function recordCoachingEvent({ employeeId, weekEnding, metricsCoached, aiAssisted, suggestions }) {
    if (!employeeId) {
        console.warn('recordCoachingEvent: Missing employeeId');
        return;
    }
    appendCoachingLogEntry({
        employeeId,
        weekEnding,
        metricsCoached: metricsCoached || [],
        // The specific advice given, so coaching-outcomes can tell whether a
        // tip works rather than only whether a topic does.
        suggestions: Array.isArray(suggestions) ? suggestions : [],
        aiAssisted: !!aiAssisted,
        generatedAt: new Date().toISOString()
    });
}

// ============================================
// EMAIL GENERATION
// ============================================

// ============================================
// PERIOD MANAGEMENT
// ============================================

// ============================================
// UI HELPER FUNCTIONS
// ============================================

// ============================================
// EVENT HANDLERS
// ============================================

function initializeEventHandlers() {
    bindUploadAndPasteHandlers();
    bindNavigationHandlers();
    bindManageDataNavigationHandlers();
    bindQuickActionHandlers();
    bindCoachingFormHandlers();
    bindDataAdminHandlers();
}

// REFACTOR: ~140 lines — split into bindVerintHandlers(), bindPayrollHandlers(),
// bindSentimentHandlers(), bindPasteHandlers().
function bindUploadAndPasteHandlers() {
    // Period type is driven entirely by the upload wizard dropdown.
    // It writes to the #uploadPeriodType hidden input; the save path reads it.

    document.getElementById('showUploadMetricsBtn')?.addEventListener('click', () => {
        const container = document.getElementById('pasteDataContainer');
        if (container) {
            container.style.display = 'block';
        }
    });


    document.getElementById('showUploadSentimentBtn')?.addEventListener('click', openUploadSentimentModal);

    // Verint upload from Upload page
    document.getElementById('showUploadVerintBtn')?.addEventListener('click', () => {
        document.getElementById('uploadVerintFileInput')?.click();
    });
    document.getElementById('uploadVerintFileInput')?.addEventListener('change', async function() {
        const files = Array.from(this.files || []);
        if (!files.length) return;
        let loaded = 0;
        const failedFiles = [];
        for (let i = 0; i < files.length; i++) {
            try {
                await window.DevCoachModules?.reliability?.handleVerintUpload?.(files[i]);
                loaded++;
            } catch (err) {
                console.error('Verint upload error for file ' + files[i].name + ':', err);
                logAppError('Verint upload failed', err, {
                    source: 'upload.verint',
                    fileName: files[i].name
                });
                failedFiles.push({ name: files[i].name, reason: err?.message || 'unknown error' });
            }
        }
        if (typeof showToast === 'function') {
            if (failedFiles.length) {
                const lines = failedFiles.map(f => `• ${f.name}. ${f.reason}`).join('\n');
                showToast(`${loaded} loaded, ${failedFiles.length} failed:\n${lines}`, 8000);
            } else {
                showToast(loaded + ' Verint file' + (loaded !== 1 ? 's' : '') + ' loaded. View in My Team > Attendance.', 4000);
            }
        }
        this.value = '';
    });

    // Payroll upload from Upload page
    document.getElementById('showUploadPayrollBtn')?.addEventListener('click', () => {
        document.getElementById('uploadPayrollFileInput')?.click();
    });
    document.getElementById('uploadPayrollFileInput')?.addEventListener('change', async function() {
            const files = Array.from(this.files || []);
            if (!files.length) return;
            if (!window.DevCoachModules?.reliability?.handlePayrollUpload) {
                if (typeof showToast === 'function') showToast('Reliability module not loaded.', 5000);
                this.value = '';
                return;
            }
            let loaded = 0;
            const failedFiles = [];
            for (let i = 0; i < files.length; i++) {
                try {
                    await window.DevCoachModules.reliability.handlePayrollUpload(files[i]);
                    loaded++;
                } catch (err) {
                    console.error('Payroll upload error for file ' + files[i].name + ':', err);
                    logAppError('Payroll upload failed', err, {
                        source: 'upload.payroll',
                        fileName: files[i].name
                    });
                    failedFiles.push({ name: files[i].name, reason: err?.message || 'unknown error' });
                }
            }
            if (typeof showToast === 'function') {
                if (failedFiles.length) {
                    const lines = failedFiles.map(f => `• ${f.name}. ${f.reason}`).join('\n');
                    showToast(`${loaded} loaded, ${failedFiles.length} failed:\n${lines}`, 8000);
                } else {
                    showToast(loaded + ' payroll file' + (loaded !== 1 ? 's' : '') + ' loaded. View in My Team > Attendance.', 4000);
                }
            }
        this.value = '';
    });
    document.getElementById('sentimentUploadCancelBtn')?.addEventListener('click', closeUploadSentimentModal);
    document.getElementById('sentimentUploadSubmitBtn')?.addEventListener('click', handleSentimentUploadSubmit);
    document.getElementById('pasteDataTextarea')?.addEventListener('input', handlePasteDataTextareaInput);
    document.getElementById('loadPastedDataBtn')?.addEventListener('click', handleLoadPastedDataClick);
    document.getElementById('testPastedDataBtn')?.addEventListener('click', handleTestPastedDataClick);

    // Dropdown-driven upload wizard — owns period type and date selection.
    window.DevCoachModules?.uploadWizard?.bind?.();

    // Two year-end year inputs live on different pages but should agree:
    //   #uploadYearEndProfile (Upload page select: auto/2025/2026)
    //   #yearEndReviewYear    (Review Prep > Year-End: number input)
    bindYearEndProfileSync();
}

const YEAR_END_PROFILE_STORAGE_KEY = STORAGE_PREFIX + 'selectedYearEndYear';

function bindYearEndProfileSync() {
    const profileSelect = document.getElementById('uploadYearEndProfile');
    const reviewYearInput = document.getElementById('yearEndReviewYear');
    if (!profileSelect && !reviewYearInput) return;

    // Restore last-set year on load. 'auto' means "infer from end date" and
    // is not a value we persist for the year input.
    let stored = '';
    try { stored = localStorage.getItem(YEAR_END_PROFILE_STORAGE_KEY) || ''; } catch (_e) {}
    if (stored && /^\d{4}$/.test(stored)) {
        if (profileSelect && Array.from(profileSelect.options).some(o => o.value === stored)) {
            profileSelect.value = stored;
        }
        if (reviewYearInput && !reviewYearInput.value) {
            reviewYearInput.value = stored;
        }
    }

    if (profileSelect) {
        profileSelect.addEventListener('change', () => {
            const val = (profileSelect.value || '').trim();
            if (val === 'auto') return; // don't overwrite a user-typed review year
            if (reviewYearInput) reviewYearInput.value = val;
            try { localStorage.setItem(YEAR_END_PROFILE_STORAGE_KEY, val); } catch (_e) {}
        });
    }
    if (reviewYearInput) {
        reviewYearInput.addEventListener('change', () => {
            const val = (reviewYearInput.value || '').trim();
            if (!/^\d{4}$/.test(val)) return;
            if (profileSelect && Array.from(profileSelect.options).some(o => o.value === val)) {
                profileSelect.value = val;
            }
            try { localStorage.setItem(YEAR_END_PROFILE_STORAGE_KEY, val); } catch (_e) {}
        });
    }
}

function initializeDashboard() {
    window.DevCoachModules?.dashboard?.initializeDashboard?.();
}

function embedTeamSnapshot() {
    const target = document.getElementById('embeddedTeamSnapshot');
    const source = document.getElementById('teamSnapshotSection');
    if (target && source && !target.hasChildNodes()) {
        // Move the inner content from standalone section into the embedded container
        target.append(...source.childNodes);
    }
    if (typeof initializeTeamSnapshot === 'function') initializeTeamSnapshot();
}

function embedPtoTracker() {
    const target = document.getElementById('embeddedPto') || document.getElementById('embeddedPtoInMyTeam');
    const source = document.getElementById('ptoSection');
    if (target && source && !target.hasChildNodes()) {
        target.append(...source.childNodes);
    }
    if (typeof initializePtoTracker === 'function') initializePtoTracker();
}

function bindNavigationHandlers() {
    // --- Top-level nav ---
    document.getElementById('dashboardBtn')?.addEventListener('click', () => {
        showOnlySection('dashboardSection');
        initializeDashboard();
    });
    document.getElementById('homeBtn')?.addEventListener('click', () => showOnlySection('uploadSection'));

    // --- My Team ---
    document.getElementById('coachingEmailBtn')?.addEventListener('click', () => {
        showOnlySection('coachingEmailSection');
        showMyTeamSubSection('subSectionMyTeamDay', 'subNavHighlights');
        window.DevCoachModules?.myTeam?.initializeMyTeam?.();
    });
    document.getElementById('subNavHighlights')?.addEventListener('click', () => {
        showMyTeamSubSection('subSectionHighlights', 'subNavHighlights');
        window.DevCoachModules?.teamHub?.initializeHighlights?.();
    });
    document.getElementById('subNavMorningPulse')?.addEventListener('click', () => {
        showMyTeamSubSection('subSectionMorningPulse', 'subNavMorningPulse');
        // initializeCelebrations also binds the inner-tab click handlers, so
        // running it on every subnav click (not just the My Team entry) keeps
        // the section usable after a refresh lands directly here.
        if (window.DevCoachModules?.celebrations?.initializeCelebrations) {
            window.DevCoachModules.celebrations.initializeCelebrations();
        }
    });
    document.getElementById('subNavMondayPost')?.addEventListener('click', () => {
        showMyTeamSubSection('subSectionMondayPost', 'subNavMondayPost');
        // Which view this shows depends on the Who dropdown: the whole team
        // gets a team post, one person gets their five day posts.
        window.DevCoachModules?.dayPosts?.renderPostsTab?.();
    });
    document.getElementById('subNavCoachingEmail')?.addEventListener('click', () => {
        showMyTeamSubSection('subSectionCoachingEmail', 'subNavCoachingEmail');
        initializeCoachingEmail();
    });
    document.getElementById('subNavCallListening')?.addEventListener('click', () => {
        showMyTeamSubSection('subSectionCallListening', 'subNavCallListening');
        initializeCallListeningSection();
    });
    document.getElementById('subNavReliability')?.addEventListener('click', () => {
        showMyTeamSubSection('subSectionReliability', 'subNavReliability');
        if (window.DevCoachModules?.reliability?.initialize) {
            window.DevCoachModules.reliability.initialize();
        }
    });

    // --- Trends & Analysis ---
    document.getElementById('trendsAnalysisBtn')?.addEventListener('click', () => {
        showOnlySection('trendsAnalysisSection');
        showTrendsSubSection('subSectionTaTrendIntelligence', 'subNavTaIntelligence');
        ensureTrendIntelligenceMountedInTrends();
        renderExecutiveSummary();
    });
    document.getElementById('subNavTaIntelligence')?.addEventListener('click', () => {
        showTrendsSubSection('subSectionTaTrendIntelligence', 'subNavTaIntelligence');
        ensureTrendIntelligenceMountedInTrends();
        renderExecutiveSummary();
    });
    document.getElementById('subNavTaMetricCharts')?.addEventListener('click', () => {
        showTrendsSubSection('subSectionTaMetricTrends', 'subNavTaMetricCharts');
        ensureMetricTrendsMountedInTrends();
        initializeMetricTrends();
    });
    document.getElementById('subNavTaRankings')?.addEventListener('click', () => {
        showTrendsSubSection('subSectionTaCenterRanking', 'subNavTaRankings');
        ensureTrendsMounted('subSectionCenterRanking', 'subSectionTaCenterRanking');
        if (typeof window.renderCenterRanking === 'function') window.renderCenterRanking();
    });
    document.getElementById('subNavTaFutures')?.addEventListener('click', () => {
        showTrendsSubSection('subSectionTaFutures', 'subNavTaFutures');
        ensureTrendsMounted('subSectionFutures', 'subSectionTaFutures');
        if (typeof window.renderFutures === 'function') window.renderFutures();
    });
    document.getElementById('subNavTaSentiment')?.addEventListener('click', () => {
        showTrendsSubSection('subSectionTaSentiment', 'subNavTaSentiment');
        ensureSentimentMountedInTrends();
    });
    document.getElementById('subNavTaMatchup')?.addEventListener('click', () => {
        showTrendsSubSection('subSectionTaMatchup', 'subNavTaMatchup');
        var matchupMod = window.DevCoachModules?.matchup;
        if (matchupMod?.renderMatchup) matchupMod.renderMatchup();
    });
    document.getElementById('subNavTaYoY')?.addEventListener('click', () => {
        showTrendsSubSection('subSectionTaYoY', 'subNavTaYoY');
        if (window.DevCoachModules?.yoyComparison?.renderYoYComparison) {
            window.DevCoachModules.yoyComparison.renderYoYComparison();
        }
    });
    document.getElementById('subNavTaPatterns')?.addEventListener('click', () => {
        showTrendsSubSection('subSectionTaPatterns', 'subNavTaPatterns');
        var stab = window.DevCoachModules?.metricStability;
        var container = document.getElementById('subSectionTaPatterns');
        if (stab?.render && container) stab.render(container);
    });

    // --- Review Prep ---
    document.getElementById('reviewPrepBtn')?.addEventListener('click', () => {
        showOnlySection('reviewPrepSection');
        ensureReviewPrepMounted('subSectionOnOffTracker');
        showReviewPrepSubSection('subSectionOnOffTracker', 'subNavRpScoreCard');
        initializeOnOffTracker();
    });
    document.getElementById('subNavRpMeetings')?.addEventListener('click', () => {
        ensureReviewPrepMounted('subSectionMeetings');
        showReviewPrepSubSection('subSectionMeetings', 'subNavRpMeetings');
        window.DevCoachModules?.oneOnOneUi?.initializeOneOnOne?.();
    });
    document.getElementById('subNavRpScoreCard')?.addEventListener('click', () => {
        ensureReviewPrepMounted('subSectionOnOffTracker');
        showReviewPrepSubSection('subSectionOnOffTracker', 'subNavRpScoreCard');
        initializeOnOffTracker();
    });
    document.getElementById('subNavRpQuarterly')?.addEventListener('click', () => {
        ensureReviewPrepMounted('subSectionQ1Review');
        showReviewPrepSubSection('subSectionQ1Review', 'subNavRpQuarterly');
        if (typeof window.renderQ1Review === 'function') window.renderQ1Review();
    });
    document.getElementById('subNavRpMidYear')?.addEventListener('click', () => {
        ensureReviewPrepMounted('subSectionMidYear');
        showReviewPrepSubSection('subSectionMidYear', 'subNavRpMidYear');
        initializeMidYearTab();
    });
    document.getElementById('subNavRpYearEnd')?.addEventListener('click', () => {
        ensureReviewPrepMounted('subSectionYearEnd');
        showReviewPrepSubSection('subSectionYearEnd', 'subNavRpYearEnd');
        initializeYearEndComments();
    });
}

// --- DOM mount helper for Review Prep ---
// Moves sub-sections from coachingEmailSection into reviewPrepContent on first use

function ensureReviewPrepMounted(subSectionId) {
    var container = document.getElementById('reviewPrepContent');
    var subSection = document.getElementById(subSectionId);
    if (!container || !subSection) return;
    if (subSection.parentElement !== container) container.appendChild(subSection);
    // Always restore display: My Team's nav can hide these sub-sections by ID
    // after they've been moved here, so re-show on every mount.
    subSection.style.display = 'block';
}

// --- Generic DOM mount helper for Trends & Analysis ---
// Moves an old sub-section div (with its real content) into a new container div

function ensureTrendsMounted(sourceId, targetId) {
    var target = document.getElementById(targetId);
    var source = document.getElementById(sourceId);
    if (!target || !source) return;
    if (source.parentElement !== target) target.appendChild(source);
    // Always restore display: My Team's nav can hide these sub-sections by ID
    // after they've been moved here, so re-show on every mount.
    source.style.display = 'block';
}

// --- DOM mount helpers for Trends & Analysis ---
// These move content from standalone hidden sections into the new Trends sub-sections

function ensureTrendIntelligenceMountedInTrends() {
    var target = document.getElementById('subSectionTaTrendIntelligence');
    if (!target || target.querySelector('#executiveSummaryContainer')) return;
    var source = document.getElementById('executiveSummarySection');
    if (!source) return;
    target.append(...source.childNodes);
}

function ensureMetricTrendsMountedInTrends() {
    var target = document.getElementById('subSectionTaMetricTrends');
    if (!target || target.hasChildNodes()) return;
    var source = document.getElementById('metricTrendsSection');
    if (!source) return;
    target.append(...source.childNodes);
}

function ensureSentimentMountedInTrends() {
    handleSubNavSentimentClick(true);
}

function bindManageDataNavigationHandlers() {
    document.getElementById('manageDataBtn')?.addEventListener('click', () => {
        showOnlySection('manageDataSection');
        showManageDataSubSection('subSectionTeamMembers');
        renderEmployeesList();
    });
    document.getElementById('subNavTeamMembers')?.addEventListener('click', () => {
        showManageDataSubSection('subSectionTeamMembers');
        renderEmployeesList();
    });
    document.getElementById('subNavCoachingTips')?.addEventListener('click', () => {
        showManageDataSubSection('subSectionCoachingTips');
        const tipsManagementSection = document.getElementById('tipsManagementSection');
        const subSectionCoachingTips = document.getElementById('subSectionCoachingTips');
        // Guarded on the real content, not on hasChildNodes(). The panel ships
        // with a placeholder paragraph, so hasChildNodes() was true on the very
        // first click and the move never happened: renderTipsManagement wrote
        // into #tipsContainer, which stayed inside the hidden source section,
        // and the panel showed its placeholder forever.
        const alreadyMoved = subSectionCoachingTips?.querySelector('#tipsContainer');
        if (tipsManagementSection && subSectionCoachingTips && !alreadyMoved) {
            subSectionCoachingTips.textContent = '';
            subSectionCoachingTips.append(...tipsManagementSection.childNodes);
        }
        renderTipsManagement();
    });
    document.getElementById('subNavSentimentKeywords')?.addEventListener('click', () => {
        showManageDataSubSection('subSectionSentimentKeywords');
        // Repainted on open rather than trusted from page load, so an edit
        // saved on another machine and pulled in by sync is what you see.
        renderSentimentDatabasePanel();
    });
    document.getElementById('subNavSyncBackup')?.addEventListener('click', () => {
        showManageDataSubSection('subSectionSyncBackup');
        initializeRepoSyncControls();
        // Painted from local state the moment the panel opens, so it is never
        // showing a readout from a previous visit.
        renderCloudSyncStatus();
    });
    document.getElementById('subNavDeleteData')?.addEventListener('click', () => {
        showManageDataSubSection('subSectionDeleteData');
        populateDeleteWeekDropdown();
        populateDeleteSentimentDropdown();
        if (typeof populateDeleteEmployeeYearOptions === 'function') populateDeleteEmployeeYearOptions();
    });
    document.getElementById('openDebugFromManageBtn')?.addEventListener('click', () => {
        showOnlySection('debugSection');
        renderDebugPanel();
    });
}

function bindQuickActionHandlers() {
    document.getElementById('generateOneOnOneBtn')?.addEventListener('click', generateOneOnOnePrep);
    document.getElementById('copyOneOnOneBtn')?.addEventListener('click', copyOneOnOnePrep);
    document.getElementById('redFlagBtn')?.addEventListener('click', () => showOnlySection('redFlagSection'));
    document.getElementById('contestBtn')?.addEventListener('click', () => {
        showOnlySection('contestSection');
        window.DevCoachModules?.contestUi?.show?.();
    });
    document.getElementById('subNavTeamSnapshot')?.addEventListener('click', () => {
        showMyTeamSubSection('subSectionTeamSnapshot', 'subNavTeamSnapshot');
        embedTeamSnapshot();
    });

    document.getElementById('refreshDebugBtn')?.addEventListener('click', renderDebugPanel);
    document.getElementById('copyDebugBtn')?.addEventListener('click', copyDebugInfo);
    document.getElementById('clearDebugBtn')?.addEventListener('click', () => {
        window.DevCoachModules?.debug?.clearDebugEntries?.({ removeStorage: true });
        renderDebugPanel();
        showToast('✅ Debug errors cleared', 3000);
    });
}

function bindCoachingFormHandlers() {
    // Passed a real context. Bound directly, the first argument was the click
    // Event, so every injected dependency below was undefined and the function
    // could not read history, toast, or even warn.
    document.getElementById('generateVerintSummaryBtn')?.addEventListener('click', () => generateVerintSummary({
        showToast,
        getCoachingHistoryForEmployee,
        getEmployeeNickname
    }));
    document.getElementById('exportDataBtn')?.addEventListener('click', exportToExcel);
    document.getElementById('exportCoachingHistoryBtn')?.addEventListener('click', downloadCoachingHistoryCSV);
    document.getElementById('uploadMoreDataBtn')?.addEventListener('click', handleUploadMoreDataClick);
    document.getElementById('uploadUndoBtn')?.addEventListener('click', () => {
        const snap = loadUploadUndoSnapshot();
        if (!snap) return;
        if (!confirm(`Undo upload for ${snap.label}? This will restore the previous data for that period.`)) return;
        undoLastUpload();
    });
    document.getElementById('uploadUndoDismissBtn')?.addEventListener('click', () => {
        clearUploadUndoSnapshot();
    });
    document.getElementById('dataIntegrityScanBtn')?.addEventListener('click', () => {
        const fn = window.DevCoachModules?.dataIntegrity?.showDataIntegrityModal;
        if (typeof fn === 'function') fn();
    });
    // Replaces the old "Archive 6+ month old weeks" button. That one deleted
    // weeks after downloading a file no importer in this codebase can read, and
    // pushed the shrunken store to the repo, degrading the remote copy too. It
    // was the remedy the storage-full message used to recommend.
    document.getElementById('loadSnapshotListBtn')?.addEventListener('click', handleLoadSnapshotListClick);
    document.getElementById('restoreSnapshotBtn')?.addEventListener('click', handleRestoreSnapshotClick);
    document.getElementById('cloudSyncPullBtn')?.addEventListener('click', handleCloudSyncPullClick);
    document.getElementById('cloudSyncPushBtn')?.addEventListener('click', handleCloudSyncPushClick);
    document.getElementById('cloudSyncSetupBtn')?.addEventListener('click', handleCloudSyncSetupClick);
    document.getElementById('cloudSyncTestBtn')?.addEventListener('click', handleCloudSyncTestClick);
    refreshUploadUndoBanner();
    refreshStorageQuotaWidget();
    document.getElementById('importDataBtn')?.addEventListener('click', () => {
        document.getElementById('dataFileInput').click();
    });
    document.getElementById('dataFileInput')?.addEventListener('change', handleDataFileInputChange);
}

function bindDataAdminHandlers() {
    document.getElementById('deleteSelectedWeekBtn')?.addEventListener('click', handleDeleteSelectedWeekClick);
    document.getElementById('deleteWeekSelect')?.addEventListener('change', handleDeleteWeekSelectChange);
    document.getElementById('toggleTeamMemberSelectorBtn')?.addEventListener('click', handleToggleTeamMembersEmployeesPanelClick);
    applyTeamMembersEmployeesPanelState(loadTeamMembersEmployeesPanelExpandedPreference());

    populateDeleteSentimentDropdown();
    populateDeleteEmployeeYearOptions();

    document.getElementById('deleteEmployeeYearBtn')?.addEventListener('click', handleDeleteEmployeeYearClick);
    document.getElementById('deleteSelectedSentimentBtn')?.addEventListener('click', handleDeleteSelectedSentimentClick);
    document.getElementById('deleteAllDataBtn')?.addEventListener('click', handleDeleteAllDataClick);
    document.getElementById('backupMetricDataBtn')?.addEventListener('click', handleBackupMetricDataClick);
    document.getElementById('resetMetricDataBtn')?.addEventListener('click', handleResetMetricDataClick);
    document.getElementById('clearDriftBaselineBtn')?.addEventListener('click', clearUploadDriftBaseline);
    populateDeleteWeekDropdown();
    initializeRedFlag();
}

function handlePasteDataTextareaInput(event) {
    const dataText = event.target.value;
    const preview = document.getElementById('dataValidationPreview');

    if (!dataText.trim()) {
        preview.style.display = 'none';
        return;
    }

    const validation = validatePastedData(dataText);
    preview.style.display = 'block';

    if (validation.valid) {
        preview.className = 'validation-success';
        preview.innerHTML = `
            ✅ <strong>Data looks good!</strong><br>
            📊 ${escapeHtml(String(validation.employeeCount))} employees detected<br>
            👤 Preview: ${validation.preview.map(n => escapeHtml(n)).join(', ')}${validation.employeeCount > 3 ? '...' : ''}
        `;
    } else {
        preview.className = 'validation-error';
        preview.innerHTML = `
            ⚠️ <strong>Data validation issues:</strong><br>
            ${validation.issues.map(i => `• ${escapeHtml(i)}`).join('<br>')}
        `;
    }
}

// Legacy stubs for any code that still references old inner tab functions
function handleSubNavMetricTrendsClick() {
    ensureMetricTrendsMountedInTrends();
    initializeMetricTrends();
}

function handleSubNavTrendIntelligenceClick() {
    ensureTrendIntelligenceMountedInTrends();
    renderExecutiveSummary();
}

function handleUploadMoreDataClick() {
    document.getElementById('uploadSuccessMessage').style.display = 'none';
    hideUploadColumnInspector();
    document.getElementById('pasteDataTextarea').value = '';
    document.getElementById('pasteWeekEndingDate').value = '';
    showOnlySection('uploadSection');
}

function handleDeleteEmployeeYearClick() {
    const employeeSelect = document.getElementById('deleteEmployeeYearSelect');
    const reviewYearInput = document.getElementById('deleteEmployeeYearInput');
    const employeeName = String(employeeSelect?.value || '').trim();
    const reviewYear = parseInt(String(reviewYearInput?.value || ''), 10);

    if (!employeeName) {
        alert('⚠️ Please select an associate.');
        return;
    }

    if (!Number.isInteger(reviewYear)) {
        alert('⚠️ Please enter a valid review year (example: 2026).');
        return;
    }

    const confirmed = confirm(`Delete ${employeeName}'s ${reviewYear} data from weekly uploads, YTD uploads, year-end entries, and matching dated logs?\n\nThis action cannot be undone.`);
    if (!confirmed) return;

    deleteEmployeeDataByYear(employeeName, reviewYear);
}

function handleSubNavSentimentClick(skipShowSubSection) {
    const sentimentSection = document.getElementById('sentimentSection');
    const subSectionSentiment = document.getElementById('subSectionTaSentiment');
    if (sentimentSection && subSectionSentiment && sentimentSection.children.length > 0) {
        subSectionSentiment.append(...sentimentSection.childNodes);
    }

    if (!sentimentListenersAttached) {
        document.getElementById('generateSentimentSummaryBtn')?.addEventListener('click', generateSentimentSummary);
        document.getElementById('copySentimentSummaryBtn')?.addEventListener('click', copySentimentSummary);
        document.getElementById('generateCoPilotPromptBtn')?.addEventListener('click', generateSentimentCoPilotPrompt);
        document.getElementById('savePhraseDatabaseBtn')?.addEventListener('click', saveSentimentPhraseDatabaseFromForm);
        sentimentListenersAttached = true;
    }

    renderSentimentDatabasePanel();
}

function detectUploadPeriodTypeByRange(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const daysDiff = Math.round((end - start) / (1000 * 60 * 60 * 24));

    // Check if it starts on Jan 1 — likely YTD
    const startMonth = start.getMonth();
    const startDay = start.getDate();
    if (startMonth === 0 && startDay === 1 && daysDiff >= 14) return 'ytd';

    if (daysDiff <= 1) return 'daily';
    if (daysDiff >= MONTH_RANGE_DAYS.min && daysDiff <= MONTH_RANGE_DAYS.max) return 'month';
    if (daysDiff >= QUARTER_RANGE_DAYS.min && daysDiff <= QUARTER_RANGE_DAYS.max) return 'quarter';
    if (daysDiff >= YTD_MIN_DAYS) return 'ytd';
    return 'week';
}

function resolveSelectedUploadPeriodType(detectedPeriodType) {
    // Period type is owned by the upload wizard, written to the hidden
    // #uploadPeriodType input. If nothing is selected (shouldn't happen
    // via the UI but defensive anyway), fall back to range-based detection.
    const selected = document.getElementById('uploadPeriodType')?.value;
    return selected || detectedPeriodType;
}

function buildPastedUploadContext(startDate, endDate, periodType, selectedYearEndProfile) {
    const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
    const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
    const normalizedEndDate = new Date(endYear, endMonth - 1, endDay);
    const startDateObj = new Date(startYear, startMonth - 1, startDay);
    const autoReviewYear = String(normalizedEndDate.getFullYear());
    const yearEndReviewYear = selectedYearEndProfile === 'auto' ? autoReviewYear : selectedYearEndProfile;

    let label;
    if (periodType === 'daily') {
        label = `Daily: ${normalizedEndDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else if (periodType === 'week') {
        label = `Week ending ${normalizedEndDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else if (periodType === 'week-in-progress') {
        label = `Week in progress: ${startDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}. ${normalizedEndDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else if (periodType === 'month') {
        label = `${startDateObj.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;
    } else if (periodType === 'month-to-date') {
        label = `${startDateObj.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })} to date (through ${normalizedEndDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`;
    } else if (periodType === 'quarter') {
        const quarter = Math.floor(startDateObj.getMonth() / 3) + 1;
        label = `Q${quarter} ${startDateObj.getFullYear()}`;
    } else if (periodType === 'ytd') {
        label = `YTD through ${normalizedEndDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else if (periodType === 'custom') {
        label = `${startDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} - ${normalizedEndDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    }

    return {
        label,
        normalizedEndDate,
        metadata: {
            startDate,
            endDate,
            label,
            periodType,
            yearEndTargetProfile: selectedYearEndProfile,
            yearEndReviewYear,
            uploadedAt: new Date().toISOString()
        }
    };
}

// ============================================
// STORAGE QUOTA MONITOR
// ============================================
const STORAGE_QUOTA_BYTES = LOCALSTORAGE_MAX_SIZE_MB * 1024 * 1024; // per-key cap (size guard)
// Total localStorage budget for the origin (~5MB in all major browsers). The
// meter tracks TOTAL usage against this, because many keys can each stay under
// the per-key cap yet together hit the origin wall. We do NOT use
// navigator.storage.estimate(): it reports disk-based quota (often GBs) and does
// not reflect the fixed ~5MB localStorage ceiling, so it would under-report.
const STORAGE_TOTAL_BUDGET_BYTES = 5 * 1024 * 1024;
const STORAGE_TOTAL_BUDGET_MB = 5;

function measureLocalStorageUsage() {
    let total = 0;
    const perKey = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            const value = localStorage.getItem(key) || '';
            const bytes = (key.length + value.length) * 2;
            total += bytes;
            perKey.push({ key, bytes });
        }
    } catch (e) { /* ignore */ }
    perKey.sort((a, b) => b.bytes - a.bytes);
    return { totalBytes: total, perKey };
}

function refreshStorageQuotaWidget() {
    const widget = document.getElementById('storageQuotaWidget');
    if (!widget) return;

    // Deliberately still measures localStorage, even on the IndexedDB backend.
    // Moving the bulk stores does not empty localStorage: the original copies
    // stay until they are explicitly reclaimed, and the thirty-odd config keys
    // live there permanently. So the origin ceiling is still real and a
    // non-bulk write can still fail against it. Hiding this meter the moment
    // the backend switched would turn off the warning while the pressure was
    // still there. It falls below the 70% gate on its own once the reclaim
    // happens, which is the right way for it to go quiet.
    const { totalBytes } = measureLocalStorageUsage();
    const pct = Math.min(100, (totalBytes / STORAGE_TOTAL_BUDGET_BYTES) * 100);
    if (pct < 70) {
        widget.style.display = 'none';
        return;
    }
    const mbUsed = (totalBytes / (1024 * 1024)).toFixed(2);
    const bar = document.getElementById('storageQuotaBar');
    const label = document.getElementById('storageQuotaLabel');
    let color = '#66bb6a';
    if (pct >= 90) color = '#ef5350';
    else if (pct >= 80) color = '#ffa726';
    else color = '#ffee58';
    if (bar) {
        bar.style.width = pct.toFixed(1) + '%';
        bar.style.background = color;
    }
    if (label) {
        label.textContent = `${mbUsed} MB / ${STORAGE_TOTAL_BUDGET_MB} MB (${pct.toFixed(0)}%)`;
        // Both of the old values (#c62828, #546e7a) are dark, and the dark-theme
        // rules at styles-v2.css:184-190 turn this widget's light inline
        // background into a dark surface without touching child text colours.
        // Dark text on the new dark background is why this line was unreadable.
        // #ef5350 carries on both grounds; the rest defers to the theme.
        label.style.color = pct >= 80 ? '#ef5350' : 'var(--text-secondary)';
    }
    widget.style.display = 'flex';
}

/**
 * Confirms the cloud copy is current, and says so.
 *
 * This is what stands in for downloading a JSON file before a destructive step.
 * The work computer must never have a file written to it, so a safety net that
 * depends on one cannot be used on the machine that holds the data.
 *
 * Cloudflare is the better guarantee regardless: a file in Downloads is one
 * more copy on the same disk, while the cloud copy is already off the machine,
 * versioned, and provably readable.
 */
async function ensureCloudCopyIsCurrent() {
    const sync = window.DevCoachModules?.manifestSync;
    const storage = window.DevCoachModules?.storage;
    const registry = window.DevCoachModules?.storeRegistry;
    if (!sync || !registry) return { ok: false, reason: 'cloud sync is unavailable in this build' };

    const pending = registry.syncedNames().filter((n) => storage?.isStoreDirty?.(n));
    if (pending.length) {
        const pushed = await sync.push(pending, 'before a destructive step');
        if (!pushed.ok) return { ok: false, reason: pushed.error || pushed.code || 'the push failed' };
        storage?.clearDirtyStores?.();
    }

    // Checked against what actually landed, not against a request returning
    // 200. The question is whether a copy EXISTS, not whether one was sent.
    const state = sync.loadSyncState();
    const applied = Object.keys(state.applied || {}).length;
    if (!state.version || !applied) {
        return { ok: false, reason: 'no cloud copy of this computer exists yet' };
    }
    return { ok: true, version: state.version, stores: applied };
}

/**
 * Reclaims the localStorage duplicates of stores IndexedDB already holds.
 *
 * Runs on its own rather than behind a button. There is no judgement here for
 * anyone to make: it deletes only a copy the backend verifiably holds with a
 * matching entry count, after confirming a current cloud copy exists, and it
 * leaves anything it cannot verify exactly where it is. A button would be
 * asking the user to approve arithmetic.
 *
 * Silent when there is nothing to do, which is every boot after the first.
 */
async function reclaimLocalStorageSpaceAutomatically() {
    const storage = window.DevCoachModules?.storage;
    if (storage?.getBackendMode?.() !== 'idb') return;

    const { totalBytes } = measureLocalStorageUsage();
    // Below this there is nothing worth touching anything for.
    if (totalBytes < 256 * 1024) return;

    // The data has to exist somewhere else before a duplicate is removed. If
    // the cloud copy cannot be confirmed, nothing is deleted.
    const cloud = await ensureCloudCopyIsCurrent();
    if (!cloud.ok) {
        console.warn(`[reclaim] Skipped: the cloud copy could not be confirmed (${cloud.reason}).`);
        return;
    }

    let report;
    try {
        report = await storage.reclaimLocalStorageCopies();
    } catch (error) {
        console.error('[reclaim] Failed; nothing was deleted:', error);
        return;
    }

    if (!report.reclaimed.length) {
        if (report.skipped.length) console.log('[reclaim] Nothing reclaimed:', report.skipped.join('; '));
        return;
    }

    const freed = (report.freedBytes / (1024 * 1024)).toFixed(2);
    const after = (measureLocalStorageUsage().totalBytes / (1024 * 1024)).toFixed(2);
    console.log(`[reclaim] Freed ${freed} MB of duplicates (now ${after} MB): ${report.reclaimed.join(', ')}`);
    if (report.skipped.length) {
        // Anything unverifiable keeps its copy. Named, so a partial reclaim is
        // a known state rather than a silent one.
        console.warn('[reclaim] Left in place, could not verify:', report.skipped.join('; '));
    }
    refreshStorageQuotaWidget();
}

// ============================================
// CLOUD SYNC (manifest CAS)
// ============================================
// The server is the shared copy; this machine keeps its own. Each store is sent
// on its own, so two machines editing different things never overwrite each
// other, which whole-state sync cannot avoid.

var _cloudPushTimer = null;
var _cloudSyncBackgroundStarted = false;
var _lastCloudFailToast = 0;
var _lastCloudPushAt = null;

// Throttled: a repeated failure is one problem, not twenty. Offline is handled
// by the caller and never reaches here.
function notifyCloudPushFailed(reason) {
    const now = Date.now();
    if (now - _lastCloudFailToast < 60000) return;
    _lastCloudFailToast = now;
    try {
        showToast('⚠️ Changes are saved on this computer but did not reach the cloud: ' + reason, 7000);
    } catch (_e) { /* toast unavailable */ }
}

/**
 * Pulls once at startup, then pushes whatever changed, on a trailing debounce.
 *
 * Trailing rather than leading on purpose: a Verint upload writes the whole
 * reliability store once per file, one file per associate, so a leading-edge
 * push would fire 127 times for one action. Waiting for the burst to finish
 * sends the end state once.
 *
 * Silent by design. A machine that cannot reach the network is not in an error
 * state, it is working from its own copy, which is exactly what the local
 * backend is for. Only a genuine conflict is worth interrupting anyone about,
 * and the protocol resolves those without asking.
 */
function startCloudSyncBackground() {
    if (_cloudSyncBackgroundStarted) return;
    _cloudSyncBackgroundStarted = true;

    const sync = window.DevCoachModules?.manifestSync;
    const storage = window.DevCoachModules?.storage;
    const registry = window.DevCoachModules?.storeRegistry;
    if (!sync || !registry) return;

    // Anything already marked dirty came from boot itself (a normalization
    // write-back, a seeding migration), not from the user. Pushing it would
    // send this machine's view of stores nobody touched.
    storage?.clearDirtyStores?.();

    renderCloudSyncStatus();

    sync.pull().then((result) => {
        renderCloudSyncStatus();
        if (result?.updated?.length) {
            console.log(`[cloud] Pulled ${result.updated.length} change(s) from another machine:`, result.updated.join(', '));
            showToast(`☁️ Picked up ${result.updated.length} change(s) from your other machine. Reload to see them.`, 6000);
        }
    }).catch(() => { /* offline is not an error */ });

    const scheduleCloudPush = () => {
        clearTimeout(_cloudPushTimer);
        _cloudPushTimer = setTimeout(() => {
            const dirty = registry.syncedNames().filter((n) => storage?.isStoreDirty?.(n));
            if (!dirty.length) return;
            sync.push(dirty, 'auto').then((result) => {
                if (result?.ok && !result.skipped) {
                    storage?.clearDirtyStores?.();
                    _lastCloudPushAt = new Date().toLocaleTimeString();
                    renderCloudSyncStatus();
                    console.log(`[cloud] Pushed ${result.changed.join(', ')} as version ${result.version}.`);
                } else if (result && !result.ok) {
                    // Left dirty on purpose, so the next change retries rather
                    // than the work being quietly dropped. Surfaced too: three
                    // separate silent push failures survived a full day of
                    // testing because this was a console.warn and nothing else.
                    console.warn('[cloud] Push failed, will retry on the next change:', result.error || result.code);
                    notifyCloudPushFailed(result.error || result.code);
                }
            }).catch((error) => {
                console.warn('[cloud] Push failed, will retry on the next change:', error?.message || error);
                notifyCloudPushFailed(error?.message || error);
            });
        }, 5000);
    };

    // A listener inside the storage module, not a wrapper around its export.
    // The module's own save* functions call the local closure directly, so a
    // wrapper on the export never sees them: writes from tips or team members
    // would schedule a push and writes from saveWeeklyData would not.
    if (typeof storage?.onStoreChanged === 'function') {
        storage.onStoreChanged((key) => {
            if (registry.isSynced(key)) scheduleCloudPush();
        });
    } else {
        console.warn('[cloud] storage.onStoreChanged is unavailable; changes will not auto-push.');
    }
}

function setCloudSyncResult(text, isError) {
    const el = document.getElementById('cloudSyncResult');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#ef5350' : 'var(--text-secondary)';
}

/**
 * Renders what this machine knows, from local state only. No network, so it is
 * always current and can be called after every push without cost.
 *
 * Separate from the network probe on purpose. The old status did a pull to find
 * out anything at all, which meant the panel was only ever as fresh as the last
 * time someone triggered it. A readout that was true ten minutes ago and looks
 * identical to one that is true now is worse than no readout.
 */
function renderCloudSyncStatus() {
    const el = document.getElementById('cloudSyncStatus');
    if (!el) return;

    const sync = window.DevCoachModules?.manifestSync;
    const storage = window.DevCoachModules?.storage;
    const registry = window.DevCoachModules?.storeRegistry;
    if (!sync) { el.textContent = 'Cloud sync is unavailable in this build.'; return; }

    const state = sync.loadSyncState();
    const tracked = Object.keys(state.applied || {}).length;
    const pending = registry && storage?.isStoreDirty
        ? registry.syncedNames().filter((n) => storage.isStoreDirty(n))
        : [];

    const parts = [];
    if (!state.version) {
        parts.push('Nothing backed up from this computer yet. Your next change will send it.');
    } else {
        parts.push(`Backed up: version ${state.version}, ${tracked} stores.`);
        if (_lastCloudPushAt) parts.push(`Last sent ${_lastCloudPushAt}.`);
    }
    if (pending.length) {
        parts.push(`${pending.length} change(s) waiting to send: ${pending.join(', ')}.`);
    } else if (state.version) {
        parts.push('Nothing waiting.');
    }
    parts.push(`This computer is "${sync.getDeviceId()}".`);

    el.textContent = parts.join(' ');
    el.style.color = pending.length ? '#ef6c00' : 'var(--text-secondary)';

    const setupBtn = document.getElementById('cloudSyncSetupBtn');
    // The first push seeds the copy, so the button is a manual escape hatch
    // rather than a required step. Hidden once a copy exists.
    if (setupBtn) setupBtn.style.display = state.version ? 'none' : '';
}

/** The network check, for when the user explicitly asks. */
async function refreshCloudSyncStatus() {
    renderCloudSyncStatus();
    const sync = window.DevCoachModules?.manifestSync;
    if (!sync) return;
    try {
        const probe = await sync.pull();
        if (!probe.skipped && probe.updated?.length) {
            setCloudSyncResult(`Pulled ${probe.updated.length} change(s): ${probe.updated.join(', ')}`);
        }
    } catch (error) {
        const el = document.getElementById('cloudSyncStatus');
        if (el) el.textContent += ' (cloud unreachable right now)';
    }
    renderCloudSyncStatus();
}

async function handleCloudSyncPullClick() {
    setCloudSyncResult('Pulling...');
    const sync = window.DevCoachModules?.manifestSync;
    try {
        const result = await sync.pull();
        if (result.skipped) { setCloudSyncResult('There is no cloud copy yet.'); return; }
        if (!result.ok) { setCloudSyncResult('Some stores could not be applied: ' + result.failed.join('; '), true); return; }
        if (!result.updated.length && !result.removed.length) {
            setCloudSyncResult(`Already up to date at version ${result.version}.`);
            return;
        }
        setCloudSyncResult(`Pulled version ${result.version}: ${result.updated.join(', ') || 'nothing new'}. Reloading...`);
        setTimeout(() => location.reload(), 900);
    } catch (error) {
        setCloudSyncResult('Could not pull: ' + (error?.message || error), true);
    }
}

async function handleCloudSyncPushClick() {
    const sync = window.DevCoachModules?.manifestSync;
    const registry = window.DevCoachModules?.storeRegistry;
    const storage = window.DevCoachModules?.storage;

    // Only what changed on this machine. Pushing everything is how one machine
    // overwrites another's work without either user doing anything wrong.
    const candidates = (registry?.syncedNames?.() || [])
        .filter((name) => (storage?.isStoreDirty ? storage.isStoreDirty(name) : true));

    if (!candidates.length) { setCloudSyncResult('Nothing has changed on this machine since it loaded.'); return; }

    setCloudSyncResult(`Pushing ${candidates.length} store(s)...`);
    try {
        const result = await sync.push(candidates, 'manual push');
        if (!result.ok) {
            setCloudSyncResult('Could not push: ' + (result.error || result.code), true);
            return;
        }
        if (result.skipped) { setCloudSyncResult('Nothing to push.'); return; }
        storage?.clearDirtyStores?.();
        _lastCloudPushAt = new Date().toLocaleTimeString();
        setCloudSyncResult(`Pushed ${result.changed.length} store(s) as version ${result.version}.`);
        renderCloudSyncStatus();
    } catch (error) {
        setCloudSyncResult('Could not push: ' + (error?.message || error), true);
    }
}

/**
 * Runs the whole sync chain and prints what happened, on screen.
 *
 * Exists because the work PC cannot have code pasted into its console: the
 * clipboard route is blocked, so a diagnostic that needs pasting is a
 * diagnostic that cannot be run on the machine that has the problem.
 */
async function handleCloudSyncTestClick() {
    const out = document.getElementById('cloudSyncDiagnostics');
    if (!out) return;
    const lines = [];
    const say = (text) => { lines.push(text); out.textContent = lines.join('\n'); };
    out.style.display = 'block';
    lines.length = 0;
    // Stamped because this panel prints once and then sits there. Output that
    // was true ten minutes ago looks identical to output that is true now,
    // which is exactly how a working sync gets read as a broken one.
    say(`--- run at ${new Date().toLocaleTimeString()} ---`);

    const storage = window.DevCoachModules?.storage;
    const sync = window.DevCoachModules?.manifestSync;
    const registry = window.DevCoachModules?.storeRegistry;

    say(`modules: storage=${!!storage} sync=${!!sync} registry=${!!registry}`);
    if (!storage || !sync || !registry) { say('FAILED: a module did not load.'); return; }

    say(`backend: ${storage.getBackendMode()}`);
    say(`this machine: ${sync.getDeviceId()}`);

    const state = sync.loadSyncState();
    say(`local version: ${state.version || 0}, tracking ${Object.keys(state.applied || {}).length} stores`);

    try {
        const pulled = await sync.pull();
        say(pulled.skipped ? 'cloud: no copy yet (the first push will create one)' : `cloud: version ${pulled.version}`);
    } catch (error) {
        say(`cloud: UNREACHABLE (${error?.message || error})`);
    }

    // Write through the real path, so this proves the chain the app uses.
    const existing = storage.readStore('userCustomTips') || [];
    const marker = 'SYNC TEST ' + new Date().toISOString().slice(0, 19);
    storage.saveWithSizeCheck('userCustomTips', existing.concat([{ tip: marker, metric: 'transfers' }]));
    say(`wrote a test tip: ${marker}`);
    say(`marked as changed: ${storage.isStoreDirty('userCustomTips')}`);

    const dirty = registry.syncedNames().filter((n) => storage.isStoreDirty(n));
    say(`changed stores: ${dirty.join(', ') || '(none)'}`);

    try {
        const result = await sync.push(dirty, 'test button');
        if (result.ok) {
            storage.clearDirtyStores();
            say(`PUSH OK${result.created ? ' (created the cloud copy)' : ''}, version ${result.version}`);
            say('');
            say('Now open the other computer and press Pull changes.');
        } else {
            say(`PUSH FAILED: ${result.error || result.code}`);
        }
    } catch (error) {
        say(`PUSH FAILED: ${error?.message || error}`);
    }
}

async function handleCloudSyncSetupClick() {
    const sync = window.DevCoachModules?.manifestSync;

    const proceed = confirm(
        'Set up cloud sync\n\n' +
        'This sends the data on THIS machine up as the starting point.\n\n' +
        'Run it on the machine with the most complete data. If your other machine ' +
        'has work this one does not, push from that machine instead, then pull here.\n\n' +
        'Continue?'
    );
    if (!proceed) return;

    setCloudSyncResult('Sending your data up...');
    try {
        const result = await sync.createFirstManifest(null, 'initial setup');
        if (!result.ok) {
            if (result.code === 'ALREADY_EXISTS') {
                setCloudSyncResult('A cloud copy already exists. Use Pull changes instead, so this machine does not overwrite it.', true);
            } else {
                setCloudSyncResult('Setup failed: ' + result.error, true);
            }
            return;
        }
        setCloudSyncResult(`Cloud sync is set up. ${result.shards} stores sent.`);
        refreshCloudSyncStatus();
    } catch (error) {
        setCloudSyncResult('Setup failed: ' + (error?.message || error), true);
    }
}

// ============================================
// POINT-IN-TIME RESTORE
// ============================================
// Cloud storage has kept a dated copy on every sync all along, and nothing
// deletes them. Until now the only recovery was "restore the latest", which is
// no use when the latest is the bad one.

function setSnapshotStatus(text, isError) {
    const el = document.getElementById('snapshotStatus');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#ef5350' : 'var(--text-secondary)';
}

async function handleLoadSnapshotListClick() {
    const select = document.getElementById('snapshotDateSelect');
    const restoreBtn = document.getElementById('restoreSnapshotBtn');
    setSnapshotStatus('Looking for saved days...');

    let snapshots;
    try {
        snapshots = await window.DevCoachModules?.repoSync?.listRepoSnapshots?.();
    } catch (error) {
        setSnapshotStatus('Could not reach cloud storage: ' + (error?.message || error), true);
        return;
    }

    if (!snapshots || !snapshots.length) {
        setSnapshotStatus('No saved days found yet. One is written every time your data syncs.', true);
        return;
    }

    select.innerHTML = '';
    snapshots.forEach((snap) => {
        const option = document.createElement('option');
        const mb = snap.size ? ` (${(snap.size / (1024 * 1024)).toFixed(1)} MB)` : '';
        option.value = snap.date;
        option.textContent = snap.date + mb;
        select.appendChild(option);
    });

    select.style.display = '';
    restoreBtn.style.display = '';
    setSnapshotStatus(`${snapshots.length} saved day${snapshots.length === 1 ? '' : 's'} available. Newest first.`);
}

async function handleRestoreSnapshotClick() {
    const date = document.getElementById('snapshotDateSelect')?.value;
    if (!date) return;

    const proceed = confirm(
        `Restore the copy saved on ${date}?\n\n` +
        `This replaces what is currently in the app with that day's data. ` +
        `Anything added since then that has not been synced will be lost.\n\n` +
        `Your current state is sent to the cloud first, so it stays recoverable. No file is saved to this computer.`
    );
    if (!proceed) return;

    // The state being replaced may be the good one and the snapshot the
    // mistake, so it has to survive this. Sent to the cloud, never written to a
    // file: nothing is ever downloaded to this computer.
    const cloud = await ensureCloudCopyIsCurrent();
    if (!cloud.ok) {
        alert('⚠️ Nothing was restored.\n\nYour current data could not be saved to the cloud first: ' + cloud.reason +
              '\n\nRestoring would leave it unrecoverable, so it was stopped.');
        return;
    }

    setSnapshotStatus(`Fetching the copy from ${date}...`);
    let payload;
    try {
        payload = await window.DevCoachModules?.repoSync?.fetchRepoSnapshotPayload?.(date);
    } catch (error) {
        setSnapshotStatus('Could not restore: ' + (error?.message || error), true);
        alert('⚠️ Could not restore that day.\n\n' + (error?.message || error) + '\n\nNothing was changed.');
        return;
    }

    try {
        window.DevCoachModules?.repoSync?.applyRepoBackupPayload?.(payload);
    } catch (error) {
        setSnapshotStatus('The restore failed partway: ' + (error?.message || error), true);
        alert('⚠️ The restore failed partway through.\n\n' + (error?.message || error) + '\n\nKeep the backup that just downloaded.');
        return;
    }

    setSnapshotStatus(`Restored the copy from ${date}. Reloading...`);
    alert(`✅ Restored the copy saved on ${date}.\n\nThe page will reload.`);
    location.reload();
}

function getArchivableWeekKeys(cutoffDate) {
    if (!weeklyData) return [];
    return Object.keys(weeklyData).filter(key => {
        const period = weeklyData[key];
        const pt = period?.metadata?.periodType || 'week';
        if (!['week', 'custom'].includes(pt)) return false;
        const endDateStr = period?.metadata?.endDate || (key.includes('|') ? key.split('|')[1] : key);
        if (!endDateStr) return false;
        const endDate = new Date(endDateStr + 'T00:00:00');
        return endDate < cutoffDate;
    }).sort();
}

function archiveOldWeeks(monthsToKeep = 6) {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - monthsToKeep);
    const keysToArchive = getArchivableWeekKeys(cutoff);
    if (!keysToArchive.length) {
        showToast(`No weekly uploads older than ${monthsToKeep} months to archive.`, 4000);
        return;
    }

    if (!confirm(`Archive ${keysToArchive.length} weekly upload(s) older than ${monthsToKeep} months?\n\nA JSON file will be downloaded first. After the download, those weeks will be removed from local storage to free up space. You can re-import the JSON later if needed.`)) {
        return;
    }

    const archive = {};
    keysToArchive.forEach(key => { archive[key] = weeklyData[key]; });

    try {
        const blob = new Blob([JSON.stringify({ version: 1, archivedAt: new Date().toISOString(), monthsKept: monthsToKeep, weeks: archive }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `devcoach-archive-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    } catch (e) {
        alert('Could not generate the archive download. Aborting. No data was removed.');
        return;
    }

    keysToArchive.forEach(key => { delete weeklyData[key]; });
    saveWeeklyData();
    populateDeleteWeekDropdown();
    populateUploadedDataDropdown();
    refreshStorageQuotaWidget();
    showToast(`Archived ${keysToArchive.length} upload(s). Older data downloaded as JSON.`, 5000);
}

// ============================================
// UPLOAD UNDO SNAPSHOT
// ============================================
const UPLOAD_UNDO_STORAGE_KEY = STORAGE_PREFIX + 'lastUploadUndo';
const UPLOAD_HEADER_FINGERPRINT_KEY = STORAGE_PREFIX + 'lastUploadHeaderFingerprint';
const UPLOAD_METRIC_COVERAGE_KEY = STORAGE_PREFIX + 'lastUploadMetricCoverage';

// Metric keys and coverage maths live in the upload-drift module, which is
// where the rules that read them live too. The fallbacks keep an unloaded
// module from taking the upload page down with it.
const _uploadDrift = () => window.DevCoachModules?.uploadDrift;
const DRIFT_METRIC_KEYS = _uploadDrift()?.DRIFT_METRIC_KEYS
    || ['scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience', 'transfers', 'aht', 'overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions', 'reliability'];
const DRIFT_METRIC_LABELS = _uploadDrift()?.DRIFT_METRIC_LABELS || {};

function computeMetricCoverage(employees) {
    return _uploadDrift()?.computeMetricCoverage?.(employees) || {};
}

// Renders a post-upload summary panel that tells the user exactly what the
// parser saw — which metrics have data, which rows have the raw counts
// needed for true week-to-date math, and which are display-only. Key for
// daily uploads: without totalCalls, AHT/adherence etc. can only be
// simple-averaged, which drifts from the real weekly number.
function renderUploadColumnInspector(employees, periodType) {
    const panel = document.getElementById('uploadColumnInspector');
    const meta = document.getElementById('uploadColumnInspectorMeta');
    const list = document.getElementById('uploadColumnInspectorList');
    const footer = document.getElementById('uploadColumnInspectorFooter');
    if (!panel || !meta || !list) return;

    const rows = Array.isArray(employees) ? employees : [];
    if (!rows.length) {
        panel.style.display = 'none';
        return;
    }

    const populated = (key) => rows.filter(e => {
        const v = e?.[key];
        return v !== '' && v !== null && v !== undefined && Number.isFinite(parseFloat(v));
    }).length;

    // Metrics grouped by how they're scoped for daily check-ins.
    // `wtdWeight` = 'totalCalls' | 'surveyTotal' | null (cumulative/no-weight)
    const DAILY_KEY_METRICS = [
        { key: 'totalCalls',         label: 'Volume (total calls)',          wtdWeight: null },
        { key: 'aht',                label: 'AHT',                           wtdWeight: 'totalCalls' },
        { key: 'scheduleAdherence',  label: 'Adherence',                     wtdWeight: 'totalCalls' },
        { key: 'positiveWord',       label: 'Positive words',                wtdWeight: 'totalCalls' },
        { key: 'negativeWord',       label: 'Avoid negative words',          wtdWeight: 'totalCalls' },
        { key: 'managingEmotions',   label: 'Manage emotions',               wtdWeight: 'totalCalls' }
    ];
    const OTHER_METRICS = [
        { key: 'overallSentiment',   label: 'Overall sentiment',             wtdWeight: 'totalCalls' },
        { key: 'transfers',          label: 'Transfers',                     wtdWeight: 'totalCalls' },
        { key: 'cxRepOverall',       label: 'RepSat',                        wtdWeight: 'surveyTotal' },
        { key: 'fcr',                label: 'FCR',                           wtdWeight: 'surveyTotal' },
        { key: 'overallExperience',  label: 'Overall experience',            wtdWeight: 'surveyTotal' },
        { key: 'reliability',        label: 'Reliability',                   wtdWeight: null }
    ];

    const isDaily = periodType === 'daily';
    const metricsToShow = isDaily ? DAILY_KEY_METRICS : DAILY_KEY_METRICS.concat(OTHER_METRICS);

    const totalCallsCoverage = populated('totalCalls');
    const surveyTotalCoverage = populated('surveyTotal');

    meta.textContent = `${rows.length} employees • period: ${periodType} • totalCalls present on ${totalCallsCoverage}/${rows.length} rows`
        + (surveyTotalCoverage > 0 ? ` • surveyTotal present on ${surveyTotalCoverage}/${rows.length}` : '');

    list.innerHTML = '';
    let missingWeightCount = 0;
    metricsToShow.forEach(({ key, label, wtdWeight }) => {
        const count = populated(key);
        const hasData = count > 0;
        let statusIcon, statusText, statusColor;
        if (!hasData) {
            statusIcon = '-';
            statusText = 'no data in this upload';
            statusColor = '#9e9e9e';
        } else if (!wtdWeight) {
            statusIcon = '✓';
            statusText = `${count}/${rows.length} rows. Cumulative, no weighting needed`;
            statusColor = '#2e7d32';
        } else {
            const weightCount = wtdWeight === 'surveyTotal' ? surveyTotalCoverage : totalCallsCoverage;
            if (weightCount > 0) {
                statusIcon = '✓';
                statusText = `${count}/${rows.length} rows. Weighted by ${wtdWeight} (WTD math will be accurate)`;
                statusColor = '#2e7d32';
            } else {
                statusIcon = '⚠';
                statusText = `${count}/${rows.length} rows. But ${wtdWeight} missing; partial-week rollup will be display-only`;
                statusColor = '#ef6c00';
                missingWeightCount += 1;
            }
        }
        const li = document.createElement('li');
        li.innerHTML = `<span style="color: ${statusColor}; font-weight: bold;">${statusIcon}</span> <strong>${label}:</strong> ${statusText}`;
        list.appendChild(li);
    });

    if (footer) {
        if (isDaily && missingWeightCount > 0) {
            footer.textContent = `⚠ ${missingWeightCount} metric(s) lack the raw counts needed for accurate week-to-date math. Those tiles will show yesterday's number only.`;
        } else if (isDaily) {
            footer.textContent = '✓ All six daily metrics have the raw counts needed for accurate week-to-date rollups.';
        } else {
            footer.textContent = '';
        }
    }

    panel.style.display = 'block';
}

function hideUploadColumnInspector() {
    const panel = document.getElementById('uploadColumnInspector');
    if (panel) panel.style.display = 'none';
}

function captureUploadUndoSnapshot({ store, weekKey, previousValue, label, periodType }) {
    try {
        const snapshot = {
            timestamp: new Date().toISOString(),
            store,
            weekKey,
            previousValue: previousValue || null,
            label: label || weekKey,
            periodType: periodType || 'week'
        };
        localStorage.setItem(UPLOAD_UNDO_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (e) {
        console.warn('[undo] Failed to capture snapshot:', e);
    }
}

function loadUploadUndoSnapshot() {
    try {
        const raw = localStorage.getItem(UPLOAD_UNDO_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function clearUploadUndoSnapshot() {
    try { localStorage.removeItem(UPLOAD_UNDO_STORAGE_KEY); } catch (e) { /* noop */ }
    refreshUploadUndoBanner();
}

function undoLastUpload() {
    const snap = loadUploadUndoSnapshot();
    if (!snap) {
        showToast('Nothing to undo.', 3000);
        return;
    }
    const targetStore = snap.store === 'ytd' ? ytdData
        : snap.store === 'daily' ? dailyData
        : weeklyData;
    if (snap.previousValue) {
        targetStore[snap.weekKey] = snap.previousValue;
    } else {
        delete targetStore[snap.weekKey];
    }
    if (snap.store === 'daily') saveDailyData();
    else { saveWeeklyData(); saveYtdData(); }
    populateDeleteWeekDropdown();
    populateUploadedDataDropdown();
    clearUploadUndoSnapshot();
    showToast(`↩️ Undid upload for ${snap.label}`, 4000);
}

function refreshUploadUndoBanner() {
    const banner = document.getElementById('uploadUndoBanner');
    if (!banner) return;
    const snap = loadUploadUndoSnapshot();
    if (!snap) {
        banner.style.display = 'none';
        return;
    }
    const whenLabel = document.getElementById('uploadUndoWhen');
    const targetLabel = document.getElementById('uploadUndoTarget');
    if (whenLabel) {
        const d = new Date(snap.timestamp);
        whenLabel.textContent = d.toLocaleString();
    }
    if (targetLabel) targetLabel.textContent = snap.label;
    banner.style.display = 'flex';
}

// ============================================
// UPLOAD DRIFT VALIDATION (hard errors)
// ============================================

// One baseline per kind of upload. A week so far is only ever judged against
// the last week so far — judging it against a finished week or a full month
// blocked it for being smaller, which is the one thing it is guaranteed to be.
function loadUploadCoverageBaselines() {
    try {
        return _uploadDrift()?.readBaselines?.(localStorage.getItem(UPLOAD_METRIC_COVERAGE_KEY)) || {};
    } catch (e) {
        return {};
    }
}

/**
 * Blocking errors, and the softer notes that only warrant a question.
 * The rules are in modules/upload-drift.module.js; this reads the baseline.
 */
function buildUploadDriftErrors(employees, periodType) {
    const judge = _uploadDrift()?.judgeUpload;
    if (!judge) return { errors: [], warnings: [] };
    const verdict = judge({ employees, periodType, baselines: loadUploadCoverageBaselines() });
    return { errors: verdict.errors || [], warnings: verdict.warnings || [] };
}

function describeUploadKind(periodType) {
    return _uploadDrift()?.describeUploadKind?.(periodType) || 'previous';
}

function saveUploadMetricCoverage(employees, periodType) {
    const drift = _uploadDrift();
    if (!drift) return;
    try {
        const next = drift.writeBaseline(loadUploadCoverageBaselines(), periodType, drift.computeMetricCoverage(employees));
        localStorage.setItem(UPLOAD_METRIC_COVERAGE_KEY, JSON.stringify(next));
    } catch (e) { /* noop */ }
}

function clearUploadDriftBaseline() {
    try { localStorage.removeItem(UPLOAD_METRIC_COVERAGE_KEY); } catch (e) { /* noop */ }
    showToast('🧹 Drift baseline cleared. The next upload of each kind sets a new one.', 4000);
}

function buildMetricsUploadQualityWarnings(employees) {
    const safeEmployees = Array.isArray(employees) ? employees : [];
    if (!safeEmployees.length) return [];

    const holdBlankCount = safeEmployees.filter(emp => emp?.holdTime === '' || emp?.holdTime === null || emp?.holdTime === undefined).length;
    const holdBlankRatio = holdBlankCount / safeEmployees.length;
    const ahtPresentCount = safeEmployees.filter(emp => Number.isFinite(parseFloat(emp?.aht))).length;
    const acwPresentCount = safeEmployees.filter(emp => Number.isFinite(parseFloat(emp?.acw))).length;

    const warnings = [];
    // If hold time is blank for ALL employees, the source view simply doesn't have it (e.g. Advisors View) — skip warning
    if (holdBlankRatio >= 0.65 && holdBlankCount < safeEmployees.length && (ahtPresentCount > 0 || acwPresentCount > 0)) {
        warnings.push(`Hold Time is blank for ${holdBlankCount}/${safeEmployees.length} associates. Please confirm source column mapping before save.`);
    }

    return warnings;
}

// REFACTOR: ~170 lines — split into validateUploadInput(), generateUploadWarnings(),
// handleDataOverwrite(), finalizeUploadUI().
function handleLoadPastedDataClick() {
    const pastedData = document.getElementById('pasteDataTextarea').value;
    const weekEndingDate = document.getElementById('pasteWeekEndingDate').value;

    const validation = validatePastedData(pastedData);
    if (!validation.valid) {
        alert('⚠️ Data validation failed:\n\n' + validation.issues.join('\n'));
        return;
    }

    if (!weekEndingDate) {
        alert('⚠️ Please select the week ending date (Saturday)');
        return;
    }

    const endDate = weekEndingDate;

    // Period type is set by the upload wizard dropdown (hidden input).
    const selectedPeriodType = document.getElementById('uploadPeriodType')?.value || '';
    const isDailySelected = selectedPeriodType === 'daily';
    const isCustomSelected = selectedPeriodType === 'custom';
    const isYtdSelected = selectedPeriodType === 'ytd';
    const isWeekInProgressSelected = selectedPeriodType === 'week-in-progress';

    // Trust an explicit start date from the input whenever one is
    // present — the upload wizard populates this for every period
    // type (including month and quarter) so the key matches what the
    // dropdown computed. Only fall back to computed starts when the
    // input is empty (legacy free-form upload path).
    const explicitStart = document.getElementById('pasteStartDate')?.value || '';
    let startDate;
    if (explicitStart) {
        startDate = explicitStart;
        if (startDate > endDate) {
            alert('⚠️ Start date cannot be after end date.');
            return;
        }
    } else if (isCustomSelected || isWeekInProgressSelected) {
        alert('⚠️ Please select a start date.');
        return;
    } else if (isDailySelected) {
        startDate = endDate; // Daily: start = end (same day)
    } else if (isYtdSelected) {
        // YTD always starts Jan 1 of the end date's year
        const ytdYear = new Date(weekEndingDate).getFullYear();
        startDate = `${ytdYear}-01-01`;
    } else {
        const endDateObj = new Date(weekEndingDate);
        endDateObj.setDate(endDateObj.getDate() - 6);
        startDate = endDateObj.toISOString().split('T')[0];
    }

    const detectedPeriodType = detectUploadPeriodTypeByRange(startDate, endDate);
    const periodType = resolveSelectedUploadPeriodType(detectedPeriodType);

    // Ensure YTD always starts Jan 1
    if (periodType === 'ytd') {
        const ytdYear = new Date(weekEndingDate).getFullYear();
        startDate = `${ytdYear}-01-01`;
    }

    saveSmartDefault('lastPeriodType', periodType);

    if (!pastedData) {
        alert('⚠️ Please paste data first');
        return;
    }

    try {
        const employees = parsePastedData(pastedData, startDate, endDate);
        if (employees.length === 0) {
            alert('ℹ️ No valid employee data found');
            return;
        }

        const drift = buildUploadDriftErrors(employees, periodType);
        if (drift.errors.length) {
            alert(`🛑 Upload blocked. Possible column drift:\n\n${drift.errors.join('\n\n')}\n\nFix the paste and try again. If this is intentional, use "Clear drift baseline" under Settings → Delete Data.`);
            return;
        }

        const qualityWarnings = drift.warnings.concat(buildMetricsUploadQualityWarnings(employees));
        if (qualityWarnings.length) {
            const proceed = confirm(`⚠️ Upload quality warning:\n\n${qualityWarnings.join('\n')}\n\nContinue saving this upload?`);
            if (!proceed) {
                return;
            }
        }

        const weekKey = `${startDate}|${endDate}`;

        // Check if data already exists for this period and warn about what's missing/changing
        const targetStore = getPeriodDataStore(periodType);
        const existingData = targetStore[weekKey];
        if (existingData && existingData.employees && existingData.employees.length > 0) {
            const existingCount = existingData.employees.length;
            const newCount = employees.length;
            // Check which metrics the new upload has that old didn't, and vice versa.
            // Same metric set used by drift detection (DRIFT_METRIC_KEYS).
            const metricKeys = DRIFT_METRIC_KEYS;
            const metricLabels = DRIFT_METRIC_LABELS;
            const hasData = (emps, key) => emps.some(e => e[key] !== '' && e[key] !== 0 && e[key] !== null && e[key] !== undefined);
            const oldHas = metricKeys.filter(k => hasData(existingData.employees, k));
            const newHas = metricKeys.filter(k => hasData(employees, k));
            const newlyAdded = newHas.filter(k => !oldHas.includes(k)).map(k => metricLabels[k]);
            const willLose = oldHas.filter(k => !newHas.includes(k)).map(k => metricLabels[k]);

            let overwriteMsg = `⚠️ Data already exists for this period (${existingCount} employees).\n\nNew upload: ${newCount} employees.\n`;
            if (newlyAdded.length) overwriteMsg += `\n✅ New metrics being added: ${newlyAdded.join(', ')}`;
            if (willLose.length) overwriteMsg += `\n❌ Metrics that will be LOST (not in new data): ${willLose.join(', ')}`;
            if (!newlyAdded.length && !willLose.length) overwriteMsg += `\nMetrics are the same. Data values will be updated.`;
            overwriteMsg += `\n\nOverwrite existing data?`;

            if (!confirm(overwriteMsg)) return;
        }

        const yearEndProfileSelect = document.getElementById('uploadYearEndProfile');
        const selectedYearEndProfile = (yearEndProfileSelect?.value || 'auto').trim();
        const uploadContext = buildPastedUploadContext(startDate, endDate, periodType, selectedYearEndProfile);
        const { label, normalizedEndDate, metadata } = uploadContext;

        captureUploadUndoSnapshot({
            store: periodType === 'ytd' ? 'ytd' : periodType === 'daily' ? 'daily' : 'weekly',
            weekKey,
            previousValue: existingData ? JSON.parse(JSON.stringify(existingData)) : null,
            label,
            periodType
        });

        targetStore[weekKey] = {
            employees,
            metadata
        };

        // Purge superseded same-kind entries: newest YTD per year and
        // newest week-in-progress per Monday are the only survivors.
        let teamMembersChanged = false;
        if (periodType === 'ytd') {
            const thisYear = normalizedEndDate.getFullYear();
            Object.keys(ytdData).forEach(k => {
                if (k === weekKey) return;
                const m = ytdData[k]?.metadata || {};
                if (m.autoGeneratedYtd) return;
                const endText = m.endDate || (k.includes('|') ? k.split('|')[1] : '');
                const y = parseInt(String(endText).split('-')[0], 10);
                if (y === thisYear) {
                    delete ytdData[k];
                    if (myTeamMembers && myTeamMembers[k]) {
                        delete myTeamMembers[k];
                        teamMembersChanged = true;
                    }
                }
            });
        } else if (periodType === 'week-in-progress' || periodType === 'month-to-date') {
            // Both of these are one row that keeps being re-uploaded as the period
            // runs on, so yesterday's copy of the same period is replaced rather
            // than left beside the new one. Matched on start date, because the end
            // moves every day and the key moves with it.
            Object.keys(weeklyData).forEach(k => {
                if (k === weekKey) return;
                const m = weeklyData[k]?.metadata || {};
                if (m.periodType !== periodType) return;
                const startText = m.startDate || (k.includes('|') ? k.split('|')[0] : '');
                if (startText === startDate) {
                    delete weeklyData[k];
                    if (myTeamMembers && myTeamMembers[k]) {
                        delete myTeamMembers[k];
                        teamMembersChanged = true;
                    }
                }
            });
        }
        if (teamMembersChanged) saveTeamMembers();

        // YTD auto-rebuild is driven by weekly/monthly/quarterly/custom uploads
        // only. Daily uploads are ephemeral and do not feed YTD (they'd
        // overweight short time-spans), and the 'ytd' branch below handles the
        // real-YTD rebuild case.
        const feedsYtd = periodType !== 'ytd' && periodType !== 'daily';
        if (feedsYtd) {
            upsertAutoYtdForYear(normalizedEndDate.getFullYear(), endDate);
        } else if (periodType === 'ytd') {
            // Real YTD uploaded — clean up stale auto-YTDs and rebuild if
            // there are weekly periods after this YTD's end date.
            const ytdYear = normalizedEndDate.getFullYear();
            let latestWeeklyEnd = null;
            Object.entries(weeklyData || {}).forEach(([k, v]) => {
                const meta = v?.metadata || {};
                const pt = meta.periodType || 'week';
                if (!['week', 'week-in-progress', 'month', 'quarter', 'custom'].includes(pt)) return;
                const edt = meta.endDate || (k.includes('|') ? k.split('|')[1] : '');
                if (!edt) return;
                const [y] = edt.split('-').map(Number);
                if (y !== ytdYear) return;
                if (!latestWeeklyEnd || edt > latestWeeklyEnd) latestWeeklyEnd = edt;
            });
            // If weekly data exists after (or at) this YTD, rebuild auto-YTD
            // anchored to the new real upload. If none, just clean stale ones.
            upsertAutoYtdForYear(ytdYear, latestWeeklyEnd || endDate);
        }

        // Purge dailies now superseded by a larger period upload: they covered
        // this same date range, and the new upload is authoritative.
        let purgedDailyCount = 0;
        if (periodType !== 'daily') {
            purgedDailyCount = purgeDailiesCoveredBy(startDate, endDate);
        }

        if (periodType === 'daily') {
            saveDailyData();
        } else {
            saveWeeklyData();
            saveYtdData();
            if (purgedDailyCount > 0) saveDailyData();
        }

        // Auto-calculate center averages when uploading 30+ employees
        if (employees.length >= 30) {
            const autoAvg = calculateCenterAveragesFromEmployees(employees);
            if (autoAvg) {
                setCallCenterAverageForPeriod(weekKey, autoAvg);
                showToast('📊 Center averages auto-calculated from ' + employees.length + ' employees', 4000);
            }
        }

        populateDeleteWeekDropdown();
        populateUploadedDataDropdown();
        window.DevCoachModules?.uploadWizard?.refresh?.();

        document.getElementById('uploadSuccessMessage').style.display = 'block';
        renderUploadColumnInspector(employees, periodType);
        document.getElementById('pasteDataTextarea').value = '';

        saveUploadMetricCoverage(employees, periodType);
        refreshUploadUndoBanner();
        refreshStorageQuotaWidget();
        window.DevCoachModules?.centerRanking?.resetPeriodSelection?.();

        showOnlySection('uploadSection');

        if (periodType !== 'ytd') {
        }

        showToast(`✅ Loaded ${employees.length} employees for ${label}`, 4000);
    } catch (error) {
        console.error('Error parsing pasted data:', error);
        alert(`⚠️ Error parsing data: ${error.message}\n\nPlease ensure you copied the full table with headers from PowerBI.`);
    }
}

function handleTestPastedDataClick() {
    const pastedData = document.getElementById('pasteDataTextarea')?.value || '';
    const weekEndingDate = document.getElementById('pasteWeekEndingDate')?.value;
    const preview = document.getElementById('dataValidationPreview');

    const validation = validatePastedData(pastedData);
    if (!validation.valid) {
        alert('⚠️ Data validation failed:\n\n' + validation.issues.join('\n'));
        return;
    }

    if (!pastedData.trim()) {
        alert('⚠️ Please paste data first');
        return;
    }

    let endDate = weekEndingDate;
    let startDate = '';

    const isTestDaily = (document.getElementById('uploadPeriodType')?.value || '') === 'daily';

    // Same rule as the real save path: if an explicit start date is
    // present (wizard or user), trust it. Only compute a fallback
    // when both the input and end date are missing.
    const testExplicitStart = document.getElementById('pasteStartDate')?.value || '';

    if (weekEndingDate) {
        if (testExplicitStart) {
            startDate = testExplicitStart;
        } else if (isTestDaily) {
            startDate = weekEndingDate;
        } else {
            const endDateObj = new Date(weekEndingDate);
            endDateObj.setDate(endDateObj.getDate() - 6);
            startDate = endDateObj.toISOString().split('T')[0];
        }
    } else {
        const today = new Date();
        endDate = today.toISOString().split('T')[0];
        if (testExplicitStart) {
            startDate = testExplicitStart;
        } else if (isTestDaily) {
            startDate = endDate;
        } else {
            const startDateObj = new Date(today);
            startDateObj.setDate(startDateObj.getDate() - 6);
            startDate = startDateObj.toISOString().split('T')[0];
        }
    }

    try {
        const employees = parsePastedData(pastedData, startDate, endDate);
        if (!employees.length) {
            alert('ℹ️ Test parse complete, but no valid employee rows were detected.');
            return;
        }

        const metricsChecked = ['scheduleAdherence', 'overallExperience', 'overallExperienceTop3', 'overallSentiment', 'fcr', 'aht', 'acw', 'reliability'];
        const metricCoverage = metricsChecked
            .map(metricKey => {
                const hasValueCount = employees.filter(emp => {
                    const value = emp?.[metricKey];
                    return value !== '' && value !== null && value !== undefined && !Number.isNaN(parseFloat(value));
                }).length;
                return `${METRICS_REGISTRY[metricKey]?.label || metricKey}: ${hasValueCount}/${employees.length}`;
            })
            .join('<br>');

        const sampleNames = employees.slice(0, 5).map(emp => emp.name).join(', ');
        const dateLabel = weekEndingDate ? `${startDate} to ${endDate}` : `${startDate} to ${endDate} (auto test range)`;
        const qualityWarnings = buildMetricsUploadQualityWarnings(employees);
        const qualityHtml = qualityWarnings.length
            ? `<div style="margin-top: 8px; color: #8a6d1f;"><strong>Warnings:</strong><br>${qualityWarnings.join('<br>')}</div>`
            : '';

        // Spot-check: show parsed values for first 5 employees
        const spotCheckKeys = ['aht', 'scheduleAdherence', 'overallSentiment', 'overallExperience', 'cxRepOverall', 'reliability', 'totalCalls', 'surveyTotal'];
        const spotCheckHtml = employees.slice(0, 5).map(emp => {
            const vals = spotCheckKeys.map(k => {
                const v = emp[k];
                const label = k === 'scheduleAdherence' ? 'Adh' : k === 'overallSentiment' ? 'Sent' : k === 'overallExperience' ? 'OE' : k === 'cxRepOverall' ? 'RepSat' : k === 'totalCalls' ? 'Calls' : k === 'surveyTotal' ? 'Surveys' : k.toUpperCase();
                return `${label}:${v === '' || v === null || v === undefined ? '--' : v}`;
            }).join(' | ');
            return `<div style="font-size: 0.85em; margin: 2px 0;"><strong>${escapeHtml(emp.firstName || emp.name)}</strong>: ${vals}</div>`;
        }).join('');

        if (preview) {
            preview.style.display = 'block';
            preview.className = 'validation-success';
            preview.innerHTML = `
                ✅ <strong>Test Upload Passed (No Save Performed)</strong><br>
                📅 Parse window: ${dateLabel}<br>
                👥 Employees parsed: ${employees.length}<br>
                👤 Sample: ${sampleNames}${employees.length > 5 ? '...' : ''}<br>
                <div style="margin-top: 8px;"><strong>Metric coverage:</strong><br>${metricCoverage}</div>
                <div style="margin-top: 8px; padding: 8px; background: var(--bg-surface-raised); border-radius: 4px; color: var(--text-primary);"><strong>Spot check (parsed values):</strong><br>${spotCheckHtml}</div>
                ${qualityHtml}
            `;
        }

        showToast(`✅ Test Upload passed for ${employees.length} employees (no data saved).`, 4500);
    } catch (error) {
        console.error('Error in test parse:', error);
        const preview = document.getElementById('dataValidationPreview');
        if (preview) preview.style.display = 'none';
        alert(`⚠️ Test Upload failed: ${error.message}\n\nNo data was saved.`);
    }
}

function handleDataFileInputChange(event) {
    const file = event?.target?.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (loadEvent) => {
        try {
            const data = JSON.parse(loadEvent.target.result);

            // A file carrying allStores restores every key, not just the five
            // the named fields cover. Without this the 1:1 notes, mid-year
            // review notes, PTO, reliability, coaching history and celebrations
            // are silently absent from a restore the toast calls successful.
            const restoreReport = data.allStores ? applyAllStoresVerbatim(data.allStores) : null;

            if (data.weeklyData) weeklyData = data.weeklyData;
            if (data.ytdData) ytdData = data.ytdData;
            if (data.callListeningLogs) callListeningLogs = data.callListeningLogs;
            if (data.sentimentPhraseDatabase) sentimentPhraseDatabase = data.sentimentPhraseDatabase;
            if (data.associateSentimentSnapshots) associateSentimentSnapshots = data.associateSentimentSnapshots;

            saveWeeklyData();
            saveYtdData();
            saveCallListeningLogs();
            saveSentimentPhraseDatabase();
            saveAssociateSentimentSnapshots();
            normalizeTeamMembersForExistingWeeks();
            saveTeamMembers();

            if (restoreReport && restoreReport.failed.length) {
                // Never let a partial restore pass as a success. The user needs
                // to know which stores are missing before they carry on working
                // on top of them.
                alert('⚠️ Restored ' + restoreReport.restored + ' of ' + restoreReport.total + ' stores.\n\n' +
                    'These could NOT be written, most likely because browser storage is full:\n\n' +
                    restoreReport.failed.join('\n') +
                    '\n\nKeep the backup file. Free up space and restore again.');
            } else if (restoreReport) {
                showToast(`✅ Restored all ${restoreReport.restored} stores.`, 5000);
            } else {
                showToast('✅ Data imported successfully!');
            }
            document.getElementById('dataFileInput').value = '';
            populateDeleteWeekDropdown();
            populateDeleteSentimentDropdown();
            populateDeleteEmployeeYearOptions();
            renderEmployeesList();
        } catch (error) {
            console.error('Error importing data:', error);
            alert('ℹ️ Error importing data: ' + error.message);
        }
    };
    reader.readAsText(file);
}

function handleBackupMetricDataClick() {
    const weeklyCount = Object.keys(weeklyData || {}).length;
    const ytdCount = Object.keys(ytdData || {}).length;
    if (weeklyCount === 0 && ytdCount === 0) {
        alert('Nothing to back up. No weekly or YTD data has been uploaded yet.');
        return;
    }

    const backup = {
        version: 1,
        exportedAt: new Date().toISOString(),
        appVersion: (typeof APP_VERSION !== 'undefined' ? APP_VERSION : null),
        weeklyData: weeklyData || {},
        ytdData: ytdData || {}
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `coaching-tool-metric-backup-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (typeof showToast === 'function') {
        showToast(`Backed up ${weeklyCount} weekly + ${ytdCount} YTD period${(weeklyCount + ytdCount) === 1 ? '' : 's'}`, 3000);
    }
}

async function handleResetMetricDataClick() {
    const weeklyCount = Object.keys(weeklyData || {}).length;
    const ytdCount = Object.keys(ytdData || {}).length;

    const confirmation = prompt(
        `♻️ Reset Metric Data\n\n` +
        `This will wipe every uploaded period:\n` +
        `  • ${weeklyCount} weekly/daily/monthly/quarterly period${weeklyCount === 1 ? '' : 's'}\n` +
        `  • ${ytdCount} YTD period${ytdCount === 1 ? '' : 's'}\n\n` +
        `Kept intact:\n` +
        `  • Coaching history\n` +
        `  • Team members\n` +
        `  • Tips\n` +
        `  • Attendance tracker\n` +
        `  • Pattern memory\n` +
        `  • Sentiment data\n` +
        `  • Employee nicknames\n\n` +
        `Back up first via "Download Backup" if you haven't.\n\n` +
        `Type "RESET" to confirm:`
    );
    if (confirmation !== 'RESET') {
        alert('Reset cancelled.');
        return;
    }

    const storage = window.DevCoachModules?.storage;
    weeklyData = {};
    ytdData = {};
    dailyData = {};
    if (storage?.saveWeeklyData) storage.saveWeeklyData(weeklyData);
    if (storage?.saveYtdData) storage.saveYtdData(ytdData);
    if (storage?.saveDailyData) storage.saveDailyData(dailyData);

    coachingLatestWeekKey = null;

    try { if (typeof populateDeleteWeekDropdown === 'function') populateDeleteWeekDropdown(); } catch (e) { /* ok */ }

    alert(`✅ Metric data reset. ${weeklyCount + ytdCount} period${(weeklyCount + ytdCount) === 1 ? '' : 's'} cleared. The page will now reload.`);
    location.reload();
}

async function handleDeleteAllDataClick() {
    const message = `⚠️ WARNING: This will permanently delete ALL data:\n\n` +
        `• All weekly, monthly, quarterly, and YTD uploads\n` +
        `• Team member selections\n` +
        `• Coaching history\n` +
        `• Call center averages\n` +
        `• Call listening logs\n` +
        `• Sentiment data\n` +
        `• All saved notes and preferences\n` +
        `• Synced backup on the server\n\n` +
        `This action CANNOT be undone!\n\n` +
        `Type "DELETE" to confirm:`;

    const confirmation = prompt(message);
    if (confirmation !== 'DELETE') {
        alert('⚠️ Deletion cancelled');
        return;
    }

    // Delete remote backup first (before clearing local config that has the endpoint/secret)
    const remoteResult = await deleteAllRemoteData();
    if (!remoteResult.ok) {
        const proceed = confirm(`⚠️ Could not delete remote backup: ${remoteResult.reason}\n\nClick OK to continue deleting local data anyway, or Cancel to abort.`);
        if (!proceed) return;
    }

    // The bulk stores live in IndexedDB once the backend has switched, and the
    // prefix sweep below cannot see them. Clear that FIRST: if it fails, the
    // localStorage copies are still here and the outcome is "nothing deleted",
    // which is recoverable. The other order gives "half deleted", and worse,
    // the next boot would re-hydrate the data the user just deleted.
    const idb = window.DevCoachModules?.idbBackend;
    if (idb?.isAvailable?.()) {
        try {
            await idb.clear();
        } catch (error) {
            console.error('[delete-all] Could not clear IndexedDB:', error);
            alert('⚠️ Could not delete the stored data.\n\nNothing has been deleted. Your data is intact. Please try again, or reload and retry.');
            return;
        }
    }

    // Clear ALL localStorage keys with the app prefix
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(STORAGE_PREFIX)) {
            keysToRemove.push(key);
        }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));

    // Suppress auto-restore from repo backup after intentional delete
    sessionStorage.setItem(STORAGE_PREFIX + 'deleteAllJustRan', '1');

    // Reset all in-memory state
    weeklyData = {};
    ytdData = {};
    dailyData = {};
    myTeamMembers = {};
    callListeningLogs = {};
    coachingHistory = {};
    sentimentPhraseDatabase = null;
    associateSentimentSnapshots = {};
    coachingLatestWeekKey = null;

    // Refresh the page for a clean state
    const remoteMsg = remoteResult.ok ? ' and server backup' : '';
    alert(`✅ All local data${remoteMsg} has been deleted. The page will now reload.`);
    location.reload();
}

function handleDeleteSelectedWeekClick() {
    const weekSelect = document.getElementById('deleteWeekSelect');
    if (!weekSelect) return;
    const selectedWeek = weekSelect.value;

    if (!selectedWeek) {
        alert('⚠️ Please select a week to delete');
        return;
    }

    const weekLabel = weekSelect.options[weekSelect.selectedIndex].text;
    if (!confirm(`Are you sure you want to delete data for:\n\n${weekLabel}\n\nThis action cannot be undone.`)) {
        return;
    }

    // Delete from whichever store holds this key (weekly, ytd, daily, or any combination)
    if (weeklyData[selectedWeek]) {
        delete weeklyData[selectedWeek];
        saveWeeklyData();
    }
    if (ytdData[selectedWeek]) {
        delete ytdData[selectedWeek];
        saveYtdData();
    }
    if (dailyData[selectedWeek]) {
        delete dailyData[selectedWeek];
        saveDailyData();
    }
    delete myTeamMembers[selectedWeek];
    normalizeTeamMembersForExistingWeeks();
    saveTeamMembers();

    populateDeleteWeekDropdown();
    populateDeleteSentimentDropdown();
    populateDeleteEmployeeYearOptions();
    renderEmployeesList();
    showToast('✅ Period deleted successfully');

    const employeeSelect = document.getElementById('employeeSelect');
    if (employeeSelect) employeeSelect.value = '';

    ['metricsSection', 'employeeInfoSection', 'customNotesSection', 'generateEmailBtn'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
    });
}

function handleDeleteWeekSelectChange() {
    const panelToggleButton = document.getElementById('toggleTeamMemberSelectorBtn');
    const isExpanded = panelToggleButton?.getAttribute('aria-expanded') === 'true';
    notifyTeamFilterChanged();
    if (isExpanded) {
        renderEmployeesList();
    }
}

function applyTeamMembersEmployeesPanelState(isExpanded) {
    const panelToggleButton = document.getElementById('toggleTeamMemberSelectorBtn');
    const panelBody = document.getElementById('teamMemberSelectorBody');
    if (!panelToggleButton || !panelBody) return;

    panelToggleButton.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    panelToggleButton.textContent = isExpanded ? 'Hide Team Members & Employees' : 'Show Team Members & Employees';
    panelBody.style.display = isExpanded ? 'block' : 'none';

    if (isExpanded) {
        renderEmployeesList();
    }
}

function loadTeamMembersEmployeesPanelExpandedPreference() {
    try {
        return localStorage.getItem(STORAGE_PREFIX + 'teamMemberSelectorExpanded') === 'true';
    } catch (error) {
        console.error('Error loading team members & employees panel preference:', error);
        return false;
    }
}

function saveTeamMembersEmployeesPanelExpandedPreference(isExpanded) {
    try {
        localStorage.setItem(STORAGE_PREFIX + 'teamMemberSelectorExpanded', isExpanded ? 'true' : 'false');
    } catch (error) {
        console.error('Error saving team members & employees panel preference:', error);
    }
}

function handleToggleTeamMembersEmployeesPanelClick() {
    const panelToggleButton = document.getElementById('toggleTeamMemberSelectorBtn');
    if (!panelToggleButton) return;

    const isExpanded = panelToggleButton.getAttribute('aria-expanded') === 'true';
    const shouldExpand = !isExpanded;
    applyTeamMembersEmployeesPanelState(shouldExpand);
    saveTeamMembersEmployeesPanelExpandedPreference(shouldExpand);
}

function handleDeleteSelectedSentimentClick() {
    const sentimentSelect = document.getElementById('deleteSentimentSelect');
    if (!sentimentSelect) return;
    const selectedKey = sentimentSelect.value;

    if (!selectedKey) {
        alert('⚠️ Please select sentiment data to delete');
        return;
    }

    const sentimentLabel = sentimentSelect.options[sentimentSelect.selectedIndex].text;
    if (!confirm(`Are you sure you want to delete:\n\n${sentimentLabel}\n\nThis action cannot be undone.`)) {
        return;
    }

    const pipeIndex = selectedKey.indexOf('|');
    if (pipeIndex === -1) {
        console.warn('[handleDeleteSelectedSentimentClick] Invalid key format (no pipe delimiter):', selectedKey);
        return;
    }
    const employeeId = selectedKey.substring(0, pipeIndex);
    const timeframe = selectedKey.substring(pipeIndex + 1);

    if (associateSentimentSnapshots[employeeId]) {
        associateSentimentSnapshots[employeeId] = associateSentimentSnapshots[employeeId].filter(
            snapshot => `${snapshot.timeframeStart} to ${snapshot.timeframeEnd}` !== timeframe
        );

        if (associateSentimentSnapshots[employeeId].length === 0) {
            delete associateSentimentSnapshots[employeeId];
        }

        saveAssociateSentimentSnapshots();
        populateDeleteSentimentDropdown();
        showToast('✅ Sentiment data deleted successfully');
    }
}

function loadYearEndAnnualGoalsStore() {
    try {
        const raw = localStorage.getItem(YEAR_END_ANNUAL_GOALS_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (error) {
        console.error('Error loading year-end annual goals store:', error);
        return {};
    }
}

function saveYearEndAnnualGoalsStore(store) {
    try {
        localStorage.setItem(YEAR_END_ANNUAL_GOALS_STORAGE_KEY, JSON.stringify(store || {}));
    } catch (error) {
        console.error('Error saving year-end annual goals store:', error);
    }
}

function loadYearEndDraftStore() {
    try {
        const raw = localStorage.getItem(YEAR_END_DRAFT_STORAGE_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch (error) {
        console.error('Error loading year-end draft store:', error);
        return {};
    }
}

function saveYearEndDraftStore(store) {
    try {
        localStorage.setItem(YEAR_END_DRAFT_STORAGE_KEY, JSON.stringify(store || {}));
    } catch (error) {
        console.error('Error saving year-end draft store:', error);
    }
}

function loadCallListeningLogs() {
    return window.DevCoachModules?.storage?.loadCallListeningLogs?.() || {};
}

function saveCallListeningLogs(triggerSync = true, reason = 'updated') {
    try {
        const ok = window.DevCoachModules?.storage?.saveCallListeningLogs?.(callListeningLogs || {});
        if (ok === false) notifyStorageSaveFailed('call listening logs');
        if (triggerSync) {
            queueCallListeningRepoSync(reason);
        }
        return ok;
    } catch (error) {
        console.error('Error saving call listening logs:', error);
        return false;
    }
}

// REFACTOR: ~150 wrapper functions below simply delegate to modules.
// These exist for backward compatibility during the module extraction.
// Future: call window.DevCoachModules.<module>.<fn>() directly at call sites,
// or use a delegateAll() factory to eliminate this boilerplate.
function getDefaultCallListeningSyncConfig() {
    return window.DevCoachModules?.repoSync?.getDefaultCallListeningSyncConfig?.();
}

function loadCallListeningSyncConfig() {
    return window.DevCoachModules?.repoSync?.loadCallListeningSyncConfig?.();
}

function saveCallListeningSyncConfig(config) {
    return window.DevCoachModules?.repoSync?.saveCallListeningSyncConfig?.(config);
}

function enforceRepoAutoSyncEnabled() {
    return window.DevCoachModules?.repoSync?.enforceRepoAutoSyncEnabled?.();
}

function setCallListeningSyncStatus(message, type = 'info') {
    return window.DevCoachModules?.repoSync?.setCallListeningSyncStatus?.(message, type);
}

function withRepoSyncSuppressed(action) {
    return window.DevCoachModules?.repoSync?.withRepoSyncSuppressed?.(action);
}

function shouldSyncForStorageKey(key) {
    return window.DevCoachModules?.repoSync?.shouldSyncForStorageKey?.(key);
}

function installRepoSyncStorageHooks() {
    return window.DevCoachModules?.repoSync?.installRepoSyncStorageHooks?.();
}

function loadRepoSyncLastSuccess() {
    return window.DevCoachModules?.repoSync?.loadRepoSyncLastSuccess?.();
}

function saveRepoSyncLastSuccess(meta) {
    return window.DevCoachModules?.repoSync?.saveRepoSyncLastSuccess?.(meta);
}

function renderCallListeningLastSync(meta = null) {
    return window.DevCoachModules?.repoSync?.renderCallListeningLastSync?.(meta);
}

function buildDiagnosticsSummary() {
    return window.DevCoachModules?.repoSync?.buildDiagnosticsSummary?.();
}

function bindDiagnosticsCopyAction() {
    return window.DevCoachModules?.repoSync?.bindDiagnosticsCopyAction?.();
}

function setAutoSyncEnabledStatus(config) {
    return window.DevCoachModules?.repoSync?.setAutoSyncEnabledStatus?.(config);
}

function getTotalCallListeningLogCount() {
    return Object.values(callListeningLogs || {}).reduce((count, entries) => {
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

function initializeRepoSyncControls() {
    return window.DevCoachModules?.repoSync?.initializeRepoSyncControls?.();
}

function setRepoExcelUploadStatus(message, type = 'info') {
    return window.DevCoachModules?.repoSync?.setRepoExcelUploadStatus?.(message, type);
}

function arrayBufferToBase64(buffer) {
    return window.DevCoachModules?.repoSync?.arrayBufferToBase64?.(buffer);
}

async function uploadExcelFileToRepo() {
    return window.DevCoachModules?.repoSync?.uploadExcelFileToRepo?.();
}

function openRepoExcelFile(fileName) {
    return window.DevCoachModules?.repoSync?.openRepoExcelFile?.(fileName);
}

async function fetchReferenceCsvFromWorkspaceOrRepo(fileName) {
    return window.DevCoachModules?.repoSync?.fetchReferenceCsvFromWorkspaceOrRepo?.(fileName);
}

function appendCsvAsSheet(workbook, csvText, sheetName) {
    return window.DevCoachModules?.repoSync?.appendCsvAsSheet?.(workbook, csvText, sheetName);
}

async function exportIntelligenceLedgerWorkbook() {
    return window.DevCoachModules?.repoSync?.exportIntelligenceLedgerWorkbook?.();
}

function getCallListeningSyncConfigFromUI() {
    return window.DevCoachModules?.repoSync?.getCallListeningSyncConfigFromUI?.();
}

function summarizeStorageValue(rawValue) {
    return window.DevCoachModules?.repoSync?.summarizeStorageValue?.(rawValue);
}

function getAllAppStorageSnapshot() {
    return window.DevCoachModules?.repoSync?.getAllAppStorageSnapshot?.();
}

function hasNonEmptyEntries(value) {
    return window.DevCoachModules?.repoSync?.hasNonEmptyEntries?.(value);
}

function getMeaningfulLocalDataSources() {
    return window.DevCoachModules?.repoSync?.getMeaningfulLocalDataSources?.();
}

function getMeaningfulBackupDataSources(payload) {
    return window.DevCoachModules?.repoSync?.getMeaningfulBackupDataSources?.(payload);
}

function buildRepoSyncHeaders(sharedSecret) {
    return window.DevCoachModules?.repoSync?.buildRepoSyncHeaders?.(sharedSecret);
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

function buildRepoSyncPayload(reason = 'updated') {
    return window.DevCoachModules?.repoSync?.buildRepoSyncPayload?.(reason);
}

function summarizeLocalBackupFreshness() {
    const weeklyKeys = Object.keys(weeklyData || {});
    const ytdKeys = Object.keys(ytdData || {});
    const latestWeeklyEndMs = getLatestPeriodEndMsFromMap(weeklyData || {});

    return {
        generatedAt: new Date().toISOString(),
        weeklyPeriods: weeklyKeys.length,
        ytdPeriods: ytdKeys.length,
        latestWeeklyEndDate: latestWeeklyEndMs ? new Date(latestWeeklyEndMs).toISOString().slice(0, 10) : null,
        latestWeeklyEndMs,
        footprintScore: getBackupFootprintScore({
            weeklyData,
            ytdData,
            coachingHistory,
            callListeningLogs,
            associateSentimentSnapshots,
            myTeamMembers
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
    return window.DevCoachModules?.repoSync?.getBackupFootprintScore?.(payload) ?? 0;
}

// Public wrapper for manual repo-sync triggers (e.g., explicit "Sync Now" buttons,
// reasons unrelated to a storage write). Storage writes trigger sync automatically
// via the localStorage.setItem hook in repo-sync.module.js.
function queueRepoSync(reason = 'updated') {
    return window.DevCoachModules?.repoSync?.queueRepoSync?.(reason);
}

function isLocalSummaryCaughtUp(localSummary, baselineSummary) {
    return window.DevCoachModules?.repoSync?.isLocalSummaryCaughtUp?.(localSummary, baselineSummary);
}

function clearRepoSyncAutoPause() {
    return window.DevCoachModules?.repoSync?.clearRepoSyncAutoPause?.();
}

function pauseRepoSyncForRegression(existingSummary = null) {
    return window.DevCoachModules?.repoSync?.pauseRepoSyncForRegression?.(existingSummary);
}

function canQueueRepoSync() {
    return window.DevCoachModules?.repoSync?.canQueueRepoSync?.();
}

function scheduleRepoSync(reason) {
    return window.DevCoachModules?.repoSync?.scheduleRepoSync?.(reason);
}

function setRepoSyncQueuedStatus() {
    return window.DevCoachModules?.repoSync?.setRepoSyncQueuedStatus?.();
}

function queueCallListeningRepoSync(reason = 'updated') {
    return window.DevCoachModules?.repoSync?.queueCallListeningRepoSync?.(reason);
}

function hasMeaningfulLocalData() {
    return window.DevCoachModules?.repoSync?.hasMeaningfulLocalData?.();
}

function hasMeaningfulBackupData(payload) {
    return window.DevCoachModules?.repoSync?.hasMeaningfulBackupData?.(payload);
}

async function withRepoSyncHydrationLock(action) {
    return window.DevCoachModules?.repoSync?.withRepoSyncHydrationLock?.(action);
}

async function fetchRepoBackupPayload() {
    return window.DevCoachModules?.repoSync?.fetchRepoBackupPayload?.() || null;
}

function applyRepoBackupPayload(payload) {
    return window.DevCoachModules?.repoSync?.applyRepoBackupPayload?.(payload);
}

function loadRepoBackupAppliedAt() {
    return window.DevCoachModules?.repoSync?.loadRepoBackupAppliedAt?.() || '';
}

function saveRepoBackupAppliedAt(isoText) {
    return window.DevCoachModules?.repoSync?.saveRepoBackupAppliedAt?.(isoText);
}

function parseTimeMs(value) {
    return window.DevCoachModules?.repoSync?.parseTimeMs?.(value) || 0;
}

function getLatestLocalRepoDataTimestampMs() {
    return window.DevCoachModules?.repoSync?.getLatestLocalRepoDataTimestampMs?.() || 0;
}

async function tryAutoRestoreFromRepoBackupOnEmptyState() {
    return window.DevCoachModules?.repoSync?.tryAutoRestoreFromRepoBackupOnEmptyState?.() || false;
}

async function deleteAllRemoteData() {
    return window.DevCoachModules?.repoSync?.deleteAllRemoteData?.() || { ok: false, reason: 'module not loaded' };
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

async function parseRepoSyncSuccessResponse(response) {
    try {
        return await response.json();
    } catch (error) {
        return null;
    }
}

function buildRepoSyncMeta(reason, responseData) {
    return window.DevCoachModules?.repoSync?.buildRepoSyncMeta?.(reason, responseData);
}

function getRepoSyncEndpointIfAllowed(config, forceSync) {
    return window.DevCoachModules?.repoSync?.getRepoSyncEndpointIfAllowed?.(config, forceSync);
}

function finalizeRepoSyncSuccess(reason, responseData) {
    return window.DevCoachModules?.repoSync?.finalizeRepoSyncSuccess?.(reason, responseData);
}

function handleRepoSyncFailure(error) {
    return window.DevCoachModules?.repoSync?.handleRepoSyncFailure?.(error);
}

function formatSummaryLabel(summary) {
    return window.DevCoachModules?.repoSync?.formatSummaryLabel?.(summary);
}

async function maybeHandleRepoSyncConflict(error) {
    return window.DevCoachModules?.repoSync?.maybeHandleRepoSyncConflict?.(error);
}

async function requestValidatedRepoSyncResponse(endpoint, config, payload) {
    return window.DevCoachModules?.repoSync?.requestValidatedRepoSyncResponse?.(endpoint, config, payload);
}

async function syncRepoData(reason = 'updated', options = {}) {
    return window.DevCoachModules?.repoSync?.syncRepoData?.(reason, options);
}

function getCallListeningEntriesForEmployee(employeeName) {
    if (!employeeName) return [];
    const entries = Array.isArray(callListeningLogs?.[employeeName]) ? callListeningLogs[employeeName] : [];
    return entries.slice().sort((a, b) => {
        const dateA = getCallListeningEntryTimestamp(a);
        const dateB = getCallListeningEntryTimestamp(b);
        return dateB - dateA;
    });
}

function getCallListeningEntryTimestamp(entry) {
    return new Date(entry?.listenedOn || entry?.createdAt || 0).getTime();
}

function findCallListeningEntryById(employeeName, entryId) {
    if (!employeeName || !entryId) return null;
    const entries = callListeningLogs?.[employeeName];
    if (!Array.isArray(entries)) return null;
    return entries.find(entry => entry?.id === entryId) || null;
}

function toCsvCell(value) {
    const text = String(value ?? '');
    if (!/[",\n]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
}

function getCallListeningCsvHeaders() {
    return [
        'Associate',
        'Call Date',
        'Call Reference',
        'What Went Well',
        'Improvement Areas',
        'Oscar URL',
        'Relevant Info',
        'Manager Notes',
        'Created At',
        'QA Verified First',
        'QA Disclosures',
        'QA Process Explained',
        'QA Resolved',
        'QA Notated',
        'Kudos',
        'Call Opportunities',
        'Tech Opportunities'
    ];
}

const CALL_QA_CSV_WORD = { met: 'Yes', opportunity: 'Opportunity', unknown: 'Not in transcript' };

// One column per form question so a season of calls can be pivoted in Excel.
// Entries saved before transcripts existed leave the columns blank rather than
// reading as a pass.
function buildCallListeningQaCells(entry) {
    const blank = ['', '', '', '', '', '', '', ''];
    if (!entry?.transcript) return blank;

    const analysis = window.DevCoachModules?.callTranscript?.analyzeTranscript?.(entry.transcript, {
        associateName: entry.employeeName
    });
    const qa = scoreCallListeningQa(entry.transcript, entry.employeeName, analysis);
    if (!qa?.ok) return blank;

    const verdict = (id) => CALL_QA_CSV_WORD[qa.checks.find(item => item.id === id)?.verdict] || '';
    const labels = (items) => (items || []).map(item => item.label).join('; ');

    return [
        verdict('verification'),
        verdict('disclosures'),
        verdict('process'),
        verdict('resolved'),
        verdict('notation'),
        labels(qa.kudos),
        labels(qa.callOpportunities),
        labels(qa.techOpportunities)
    ];
}

function buildCallListeningCsvRow(employeeName, entry) {
    return [
        toCsvCell(employeeName),
        toCsvCell(entry.listenedOn || ''),
        toCsvCell(entry.callReference || ''),
        toCsvCell(entry.whatWentWell || ''),
        toCsvCell(entry.improvementAreas || ''),
        toCsvCell(entry.oscarUrl || ''),
        toCsvCell(entry.relevantInfo || ''),
        toCsvCell(entry.managerNotes || ''),
        toCsvCell(entry.createdAt ? new Date(entry.createdAt).toLocaleString() : ''),
        ...buildCallListeningQaCells(entry).map(toCsvCell)
    ].join(',');
}

function exportCallListeningLogsToCSV() {
    const headers = getCallListeningCsvHeaders();
    const lines = [headers.join(',')];
    Object.entries(callListeningLogs || {}).forEach(([employeeName, entries]) => {
        (entries || []).forEach(entry => {
            lines.push(buildCallListeningCsvRow(employeeName, entry));
        });
    });

    return lines.join('\n');
}

function downloadCallListeningLogsCSV() {
    const csv = exportCallListeningLogsToCSV();
    if (csv.split('\n').length <= 1) {
        showToast('⚠️ No call listening logs to export yet.', 3500);
        return;
    }

    const filename = `call_listening_logs_${new Date().toISOString().split('T')[0]}.csv`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    showToast(`✅ Downloaded ${filename}`, 3000);
}

function getYearEndDraftState(employeeName, reviewYear) {
    const defaults = {
        trackStatus: '',
        positivesText: '',
        improvementsText: '',
        managerContext: '',
        copilotResponse: '',
        performanceRating: '',
        meritDetails: '',
        bonusAmount: '',
        verbalSummary: ''
    };

    if (!employeeName || !reviewYear) return defaults;

    const store = loadYearEndDraftStore();
    const stateKey = `${String(reviewYear)}::${employeeName}`;
    const saved = store[stateKey] || {};

    const allowedTrackStatuses = new Set([
        'on-track',
        'off-track',
        'on-track-successful',
        'on-track-exceptional'
    ]);

    return {
        trackStatus: allowedTrackStatuses.has(saved.trackStatus) ? saved.trackStatus : '',
        positivesText: typeof saved.positivesText === 'string' ? saved.positivesText : '',
        improvementsText: typeof saved.improvementsText === 'string' ? saved.improvementsText : '',
        managerContext: typeof saved.managerContext === 'string' ? saved.managerContext : '',
        copilotResponse: typeof saved.copilotResponse === 'string' ? saved.copilotResponse : '',
        performanceRating: typeof saved.performanceRating === 'string' ? saved.performanceRating : '',
        meritDetails: typeof saved.meritDetails === 'string' ? saved.meritDetails : '',
        bonusAmount: typeof saved.bonusAmount === 'string' ? saved.bonusAmount : '',
        verbalSummary: typeof saved.verbalSummary === 'string' ? saved.verbalSummary : ''
    };
}

function persistYearEndDraftState(employeeName, reviewYear) {
    if (!employeeName || !reviewYear) return;

    const trackSelect = document.getElementById('yearEndTrackSelect');
    const positivesInput = document.getElementById('yearEndPositivesInput');
    const improvementsInput = document.getElementById('yearEndImprovementsInput');
    const managerContextInput = document.getElementById('yearEndManagerContext');
    const responseInput = document.getElementById('yearEndCopilotResponse');
    const performanceRatingInput = document.getElementById('yearEndPerformanceRatingInput');
    const meritDetailsInput = document.getElementById('yearEndMeritDetailsInput');
    const bonusAmountInput = document.getElementById('yearEndBonusAmountInput');
    const verbalSummaryOutput = document.getElementById('yearEndVerbalSummaryOutput');

    const nextState = {
        trackStatus: trackSelect?.value || '',
        positivesText: positivesInput?.value || '',
        improvementsText: improvementsInput?.value || '',
        managerContext: managerContextInput?.value || '',
        copilotResponse: responseInput?.value || '',
        performanceRating: performanceRatingInput?.value || '',
        meritDetails: meritDetailsInput?.value || '',
        bonusAmount: bonusAmountInput?.value || '',
        verbalSummary: verbalSummaryOutput?.value || ''
    };

    const store = loadYearEndDraftStore();
    store[`${String(reviewYear)}::${employeeName}`] = nextState;
    saveYearEndDraftStore(store);
}

function buildDefaultYearEndAnnualGoalsState() {
    const defaults = {};
    YEAR_END_ANNUAL_GOALS.forEach(goal => {
        defaults[goal.key] = { status: 'met', note: '' };
    });
    return defaults;
}

function getYearEndAnnualGoalsState(employeeName, reviewYear) {
    const defaults = buildDefaultYearEndAnnualGoalsState();
    if (!employeeName || !reviewYear) return defaults;

    const store = loadYearEndAnnualGoalsStore();
    const stateKey = `${String(reviewYear)}::${employeeName}`;
    const saved = store[stateKey] || {};

    YEAR_END_ANNUAL_GOALS.forEach(goal => {
        const savedGoal = saved[goal.key] || {};
        defaults[goal.key] = {
            status: savedGoal.status === 'not-met' ? 'not-met' : 'met',
            note: (savedGoal.note || '').trim()
        };
    });

    return defaults;
}

function persistYearEndAnnualGoalsState(employeeName, reviewYear) {
    if (!employeeName || !reviewYear) return;
    const container = document.getElementById('yearEndAnnualGoalsContainer');
    if (!container) return;

    const nextState = buildDefaultYearEndAnnualGoalsState();
    YEAR_END_ANNUAL_GOALS.forEach(goal => {
        const statusEl = container.querySelector(`[data-goal-status="${goal.key}"]`);
        const noteEl = container.querySelector(`[data-goal-note="${goal.key}"]`);
        nextState[goal.key] = {
            status: statusEl?.value === 'not-met' ? 'not-met' : 'met',
            note: (noteEl?.value || '').trim()
        };
    });

    const store = loadYearEndAnnualGoalsStore();
    store[`${String(reviewYear)}::${employeeName}`] = nextState;
    saveYearEndAnnualGoalsStore(store);
}

function renderYearEndAnnualGoalsInputs(employeeName, reviewYear) {
    const container = document.getElementById('yearEndAnnualGoalsContainer');
    if (!container) return;

    const state = getYearEndAnnualGoalsState(employeeName, reviewYear);
    container.innerHTML = YEAR_END_ANNUAL_GOALS.map(goal => {
        const current = state[goal.key] || { status: 'met', note: '' };
        const safeNote = escapeHtml(current.note).replace(/"/g, '&quot;');
        return `
            <div style="display: grid; grid-template-columns: minmax(260px, 2fr) 140px 1fr; gap: 10px; align-items: center; padding: 10px; border: 1px solid #e6dcfa; border-radius: 6px; background: #faf7ff;">
                <div>
                    <div style="font-weight: bold; color: #4a148c;">${escapeHtml(goal.label)}</div>
                    <div style="font-size: 0.85em; color: var(--text-secondary);">Goal: ${escapeHtml(goal.expectation)}</div>
                </div>
                <select data-goal-status="${goal.key}" style="width: 100%; padding: 6px; border: 1px solid var(--border); border-radius: 4px; cursor: pointer;">
                    <option value="met"${current.status === 'met' ? ' selected' : ''}>✅ Meeting</option>
                    <option value="not-met"${current.status === 'not-met' ? ' selected' : ''}>⚠️ Not Met</option>
                </select>
                <input type="text" data-goal-note="${goal.key}" value="${safeNote}" placeholder="Optional note/details" style="width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 4px;">
            </div>
        `;
    }).join('');

    container.querySelectorAll('[data-goal-status], [data-goal-note]').forEach(el => {
        const eventName = el.matches('select') ? 'change' : 'input';
        el.addEventListener(eventName, () => {
            persistYearEndAnnualGoalsState(employeeName, reviewYear);
            appendMissingYearEndImprovementFollowUps(employeeName, reviewYear);
            if (el.matches('select')) {
                updateYearEndSnapshotDisplay();
            }
        });
    });
}

function appendMissingYearEndImprovementFollowUps(employeeName, reviewYear) {
    const improvementsInput = document.getElementById('yearEndImprovementsInput');
    if (!improvementsInput || !employeeName || !reviewYear) return;

    persistYearEndAnnualGoalsState(employeeName, reviewYear);

    const annualGoals = collectYearEndAnnualGoals(employeeName, reviewYear);
    const annualFollowUps = annualGoals.notMetGoals.map(goal => `Annual Goal Follow-up: ${goal}`);
    const requiredLines = annualFollowUps.filter(Boolean);

    if (!requiredLines.length) return;

    const existingLines = String(improvementsInput.value || '')
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean);
    const existingNormalized = new Set(existingLines.map(line => line.toLowerCase()));
    const missingRequiredLines = requiredLines.filter(line => !existingNormalized.has(line.toLowerCase()));

    if (missingRequiredLines.length) {
        improvementsInput.value = existingLines.length
            ? `${existingLines.join('\n')}\n${missingRequiredLines.join('\n')}`
            : missingRequiredLines.join('\n');

        persistYearEndDraftState(employeeName, reviewYear);
    }
}

function collectYearEndAnnualGoals(employeeName, reviewYear) {
    const state = getYearEndAnnualGoalsState(employeeName, reviewYear);
    const metGoals = [];
    const notMetGoals = [];

    YEAR_END_ANNUAL_GOALS.forEach(goal => {
        const goalState = state[goal.key] || { status: 'met', note: '' };
        const noteText = String(goalState.note || '').trim();
        const noteNumberMatch = noteText.match(/\d+(?:\.\d+)?/);
        const noteNumericValue = noteNumberMatch ? parseFloat(noteNumberMatch[0]) : NaN;
        const hasPositiveRedFlagCount = goal.key === 'redFlagViolations' && Number.isFinite(noteNumericValue) && noteNumericValue > 0;
        const noteSuffix = goalState.note ? ` (${goalState.note})` : '';
        const text = `${goal.label}: ${goal.expectation}${noteSuffix}`;
        if (goalState.status === 'not-met' || hasPositiveRedFlagCount) {
            notMetGoals.push(text);
        } else {
            metGoals.push(text);
        }
    });

    return { metGoals, notMetGoals };
}

function getYearEndTargetConfig(metricKey, reviewYear, periodMetadata) {
    const profileModule = getMetricProfilesModule();
    const targetsByYear = profileModule?.TARGETS_BY_YEAR || YEAR_END_TARGETS_BY_YEAR;

    const parsedYear = parseInt(reviewYear, 10);
    const customTargets = Number.isInteger(parsedYear) ? targetsByYear[parsedYear] : null;
    const metadataProfile = periodMetadata?.yearEndTargetProfile;
    const metadataYear = parseInt(periodMetadata?.yearEndReviewYear, 10);
    const profileYear = Number.isInteger(parsedYear)
        ? parsedYear
        : (metadataProfile === 'auto' ? metadataYear : parseInt(metadataProfile, 10));
    const profileTargets = Number.isInteger(profileYear) ? targetsByYear[profileYear] : null;

    if (customTargets && customTargets[metricKey]) return { ...customTargets[metricKey], profileYear: parsedYear };
    if (profileTargets && profileTargets[metricKey]) return { ...profileTargets[metricKey], profileYear: profileYear };

    const fallback = METRICS_REGISTRY[metricKey]?.target;
    if (!fallback) return null;
    return { ...fallback, profileYear: null };
}

function populateDeleteWeekDropdown() {
    const dropdown = document.getElementById('deleteWeekSelect');
    if (!dropdown) return;

    dropdown.innerHTML = '<option value="">-- Choose a week --</option>';

    const allData = Object.assign({}, weeklyData, ytdData, dailyData);
    const weeks = Object.keys(allData).map(weekKey => {
        const weekData = allData[weekKey];
        const endDateStr = weekKey.split('|')[1];
        // Parse date safely to avoid timezone issues
        const [year, month, day] = endDateStr.split('-').map(Number);
        const endDate = new Date(year, month - 1, day);
        
        // Use the stored label if available, otherwise default to "Week ending..."
        const label = weekData.metadata?.label || `Week ending ${endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
        return { weekKey, label, endDate };
    });
    
    // Sort by date descending
    weeks.sort((a, b) => b.endDate - a.endDate);
    
    weeks.forEach(week => {
        const option = document.createElement('option');
        option.value = week.weekKey;
        option.textContent = week.label;
        dropdown.appendChild(option);
    });
}

function populateDeleteSentimentDropdown() {
    const dropdown = document.getElementById('deleteSentimentSelect');
    if (!dropdown) return;

    dropdown.innerHTML = '<option value="">-- Choose sentiment data --</option>';
    
    const sentimentEntries = [];

    // Iterate through all employees and their sentiment snapshots
    Object.entries(associateSentimentSnapshots || {}).forEach(([employeeId, snapshots]) => {
        if (Array.isArray(snapshots)) {
            snapshots.forEach(snapshot => {
                if (!snapshot?.timeframeStart || !snapshot?.timeframeEnd) return;
                const timeframe = `${snapshot.timeframeStart} to ${snapshot.timeframeEnd}`;
                sentimentEntries.push({
                    key: `${employeeId}|${timeframe}`,
                    label: `${snapshot.associateName || employeeId} - ${timeframe}`,
                    date: new Date(snapshot.savedAt || snapshot.timeframeEnd)
                });
            });
        }
    });
    
    // Sort by date descending (most recent first)
    sentimentEntries.sort((a, b) => b.date - a.date);
    
    sentimentEntries.forEach(entry => {
        const option = document.createElement('option');
        option.value = entry.key;
        option.textContent = entry.label;
        dropdown.appendChild(option);
    });
}

function populateDeleteEmployeeYearOptions() {
    const dropdown = document.getElementById('deleteEmployeeYearSelect');
    if (!dropdown) return;

    window.DevCoachModules.associatePicker.populateSelect(dropdown, getYearEndEmployees(), {
        preserveSelection: true
    });
}

function getPeriodReviewYear(periodKey, period) {
    const explicitYear = parseInt(period?.metadata?.yearEndReviewYear, 10);
    if (Number.isInteger(explicitYear)) return explicitYear;

    const endDateText = period?.metadata?.endDate || (String(periodKey || '').includes('|') ? String(periodKey).split('|')[1] : '');
    if (endDateText) {
        const parsed = new Date(endDateText);
        if (!isNaN(parsed.getTime())) return parsed.getFullYear();
    }

    return NaN;
}

function getEntryYear(entry) {
    if (!entry || typeof entry !== 'object') return NaN;
    const dateCandidates = [entry.listenedOn, entry.createdAt, entry.date, entry.coachingDate, entry.weekEndingDate, entry.timeframeEnd, entry.periodEndDate];
    for (const candidate of dateCandidates) {
        if (!candidate) continue;
        const parsed = new Date(candidate);
        if (!isNaN(parsed.getTime())) return parsed.getFullYear();
    }
    return NaN;
}

function normalizeTeamMembersForExistingWeeks() {
    const validWeekKeys = new Set(Object.keys(weeklyData || {}));
    const normalized = {};

    Object.entries(myTeamMembers || {}).forEach(([weekKey, members]) => {
        if (!validWeekKeys.has(weekKey)) return;
        const weekEmployees = (weeklyData[weekKey]?.employees || []).map(emp => String(emp?.name || '').trim()).filter(Boolean);
        const validEmployees = new Set(weekEmployees);
        const safeMembers = Array.isArray(members) ? members.map(name => String(name || '').trim()).filter(Boolean) : [];
        const filteredMembers = safeMembers.filter(name => validEmployees.has(name));
        normalized[weekKey] = filteredMembers;
    });

    // Auto-seed new week keys with DEFAULT_TEAM_MEMBERS so only your team is checked
    validWeekKeys.forEach(function(weekKey) {
        if (normalized[weekKey] && normalized[weekKey].length > 0) return;
        var weekEmployees = (weeklyData[weekKey]?.employees || []).map(function(emp) { return String(emp?.name || '').trim(); }).filter(Boolean);
        var weekSet = new Set(weekEmployees);
        var seeded = DEFAULT_TEAM_MEMBERS.filter(function(name) { return weekSet.has(name); });
        if (seeded.length > 0) normalized[weekKey] = seeded;
    });

    myTeamMembers = normalized;
}

function deleteEmployeeDataByYear(employeeName, reviewYear) {
    const targetName = String(employeeName || '').trim().toLowerCase();
    if (!targetName || !Number.isInteger(reviewYear)) return;

    let weeklyPeriodsTouched = 0;
    let ytdPeriodsTouched = 0;
    let coachingEntriesRemoved = 0;
    let callEntriesRemoved = 0;

    Object.entries(weeklyData || {}).forEach(([periodKey, period]) => {
        const periodYear = getPeriodReviewYear(periodKey, period);
        if (periodYear !== reviewYear || !Array.isArray(period?.employees)) return;
        const before = period.employees.length;
        period.employees = period.employees.filter(emp => String(emp?.name || '').trim().toLowerCase() !== targetName);
        if (period.employees.length !== before) weeklyPeriodsTouched += 1;
    });

    Object.entries(ytdData || {}).forEach(([periodKey, period]) => {
        const periodYear = getPeriodReviewYear(periodKey, period);
        if (periodYear !== reviewYear || !Array.isArray(period?.employees)) return;
        const before = period.employees.length;
        period.employees = period.employees.filter(emp => String(emp?.name || '').trim().toLowerCase() !== targetName);
        if (period.employees.length !== before) ytdPeriodsTouched += 1;
    });

    Object.entries(coachingHistory || {}).forEach(([name, entries]) => {
        if (String(name || '').trim().toLowerCase() !== targetName || !Array.isArray(entries)) return;
        const before = entries.length;
        coachingHistory[name] = entries.filter(entry => getEntryYear(entry) !== reviewYear);
        coachingEntriesRemoved += (before - coachingHistory[name].length);
        if (!coachingHistory[name].length) delete coachingHistory[name];
    });

    Object.entries(callListeningLogs || {}).forEach(([name, entries]) => {
        if (String(name || '').trim().toLowerCase() !== targetName || !Array.isArray(entries)) return;
        const before = entries.length;
        callListeningLogs[name] = entries.filter(entry => getEntryYear(entry) !== reviewYear);
        callEntriesRemoved += (before - callListeningLogs[name].length);
        if (!callListeningLogs[name].length) delete callListeningLogs[name];
    });

    const annualGoalsStore = loadYearEndAnnualGoalsStore();
    Object.keys(annualGoalsStore).forEach(key => {
        const [yearPart, namePart] = String(key).split('::');
        if (parseInt(yearPart, 10) === reviewYear && String(namePart || '').trim().toLowerCase() === targetName) {
            delete annualGoalsStore[key];
        }
    });
    saveYearEndAnnualGoalsStore(annualGoalsStore);

    const yearEndDraftStore = loadYearEndDraftStore();
    Object.keys(yearEndDraftStore).forEach(key => {
        const [yearPart, namePart] = String(key).split('::');
        if (parseInt(yearPart, 10) === reviewYear && String(namePart || '').trim().toLowerCase() === targetName) {
            delete yearEndDraftStore[key];
        }
    });
    saveYearEndDraftStore(yearEndDraftStore);

    normalizeTeamMembersForExistingWeeks();

    saveWeeklyData();
    saveYtdData();
    saveTeamMembers();
    saveCoachingHistory();
    saveCallListeningLogs(true, `${reviewYear} data removed for ${employeeName}`);

    populateDeleteWeekDropdown();
    populateDeleteSentimentDropdown();
    populateDeleteEmployeeYearOptions();
    renderEmployeesList();

    showToast(`✅ Removed ${employeeName} ${reviewYear} data (weekly: ${weeklyPeriodsTouched}, ytd: ${ytdPeriodsTouched}, coaching entries: ${coachingEntriesRemoved}, call logs: ${callEntriesRemoved}).`, 4500);
}

function updateTeamSelection() {
    const weekKey = document.querySelector('.team-member-checkbox')?.dataset.week;
    if (!weekKey) return;
    
    const selectedCheckboxes = document.querySelectorAll(`.team-member-checkbox[data-week="${weekKey}"]:checked`);
    const selectedMembers = Array.from(selectedCheckboxes).map(cb => cb.dataset.name);
    
    setTeamMembersForWeek(weekKey, selectedMembers);
    
}

// ============================================
// KEYBOARD SHORTCUTS
// ============================================

// The shortcuts the app actually honours. Kept in one list so the help
// overlay below can't drift out of sync with the handler. An undocumented
// shortcut may as well not exist.
const KEYBOARD_SHORTCUTS = [
    { keys: 'Ctrl + S', label: 'Back up / export data' },
    { keys: 'Ctrl + H', label: 'Jump to My Team' },
    { keys: 'Ctrl + T', label: 'Jump to Coaching Tips' },
    { keys: 'Esc',      label: 'Close the open dialog' },
    { keys: '?',        label: 'Show this list' }
];

// Modals are appended to <body> under an id ending in Modal/Overlay. Escape
// closes the most recently opened one.
function closeTopmostModal() {
    const open = document.querySelectorAll('body > [id$="Modal"], body > [id$="Overlay"]');
    const top = open[open.length - 1];
    if (!top) return false;
    top.remove();
    return true;
}

function toggleShortcutHelp() {
    const existing = document.getElementById('shortcutHelpOverlay');
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement('div');
    overlay.id = 'shortcutHelpOverlay';
    overlay.className = 'modal-overlay is-open';
    const rows = KEYBOARD_SHORTCUTS.map(s =>
        `<div class="shortcut-row"><kbd>${escapeHtml(s.keys)}</kbd><span>${escapeHtml(s.label)}</span></div>`
    ).join('');
    overlay.innerHTML =
        `<div class="modal-card modal-card-sm">` +
        `<div class="modal-head"><h3>Keyboard shortcuts</h3>` +
        `<button type="button" class="modal-close" aria-label="Close">&#10005;</button></div>` +
        `<div class="shortcut-list">${rows}</div></div>`;
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay || e.target.closest('.modal-close')) overlay.remove();
    });
    document.body.appendChild(overlay);
}

function initializeKeyboardShortcuts() {
    document.getElementById('shortcutHelpBtn')?.addEventListener('click', toggleShortcutHelp);

    document.addEventListener('keydown', (e) => {
        // Escape closes dialogs even from inside a field, that's the one
        // shortcut you reach for while typing.
        if (e.key === 'Escape' && closeTopmostModal()) {
            e.preventDefault();
            return;
        }

        // Don't trigger the rest while typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            return;
        }

        // ? - Shortcut help
        if (e.key === '?' && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            toggleShortcutHelp();
            return;
        }

        // Ctrl+S - Save/backup
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            document.getElementById('exportDataBtn')?.click();
        }

        // Ctrl+H - My Team
        if (e.ctrlKey && e.key === 'h') {
            e.preventDefault();
            document.getElementById('coachingEmailBtn')?.click();
        }

        // Ctrl+T - Tips Management
        if (e.ctrlKey && e.key === 't') {
            e.preventDefault();
            showOnlySection('manageDataSection');
            document.getElementById('subNavCoachingTips')?.click();
        }
    });
}


// (Tips Management UI removed - migrated to tips.module.js)


// ============================================
// METRIC TREND EMAIL GENERATOR
// ============================================

const AVERAGE_FORM_FIELD_MAP = {
    adherence: 'avgAdherence',
    overallExperience: 'avgOverallExperience',
    repSatisfaction: 'avgRepSatisfaction',
    fcr: 'avgFCR',
    transfers: 'avgTransfers',
    sentiment: 'avgSentiment',
    positiveWord: 'avgPositiveWord',
    negativeWord: 'avgNegativeWord',
    managingEmotions: 'avgManagingEmotions',
    aht: 'avgAHT',
    acw: 'avgACW',
    holdTime: 'avgHoldTime',
    reliability: 'avgReliability'
};

    // Save/Copy handlers are in metric-trends.module.js (initializeMetricTrends)

const TREND_METRIC_MAPPINGS = {
    scheduleAdherence: 'scheduleAdherence',
    overallExperience: 'overallExperience',
    cxRepOverall: 'repSatisfaction',
    fcr: 'fcr',
    transfers: 'transfers',
    overallSentiment: 'sentiment',
    positiveWord: 'positiveWord',
    negativeWord: 'negativeWord',
    managingEmotions: 'managingEmotions',
    aht: 'aht',
    acw: 'acw',
    holdTime: 'holdTime',
    reliability: 'reliability'
};

/**
 * Analyzes employee metrics to identify performance gaps and trends.
 * Compares individual achievements against targets and team center averages.
 * 
 * @param {Object} employeeData - Employee's current metric values
 *   Keys: scheduleAdherence, overallExperience, fcr, transfers, aht, acw, etc.
 * @param {Object} centerAverages - Team's center average values for comparison
 * @returns {Object} Analysis result with structure:
 *   {weakest: Metric, trendingDown: Metric | null, allMetrics: Array}
 *   weakest = furthest from target
 *   trendingDown = random metric not meeting target (for variety week-to-week)
 *
 * @example
 * const analysis = analyzeTrendMetrics(empData, centerAvgs);
 * if (analysis.weakest) console.log(`Weakest: ${analysis.weakest.label}`);
 * if (analysis.trendingDown) console.log(`Random focus: ${analysis.trendingDown.label}`);
 */
/**
 * Displays a modal panel for trend-based coaching with praise, focus areas, and tips.
 * User can review coaching suggestions, add notes, and optionally launch Copilot for email drafting.
 * 
 * @param {string} employeeName - Employee identifier (display name)
 * @param {string} displayName - Formatted name for display in modal
 * @param {Object} weakestMetric - Employee's lowest-performing metric
 * @param {Object} trendingMetric - Second metric below target
 * @param {string[]} tipsForWeakest - Array of coaching tips for weakest metric
 * @param {string[]} tipsForTrending - Array of coaching tips for trending metric
 * @param {string} weekKey - Period identifier for logging
 * @param {Object} periodMeta - Period metadata with label and dates
 * @param {string} emailSubject - Subject line for potential email
 * @returns {void} Creates modal in DOM, handles clicks and coaching logging
 * 
 * @example
 * showTrendsWithTipsPanel('john', 'John Doe', weakest, trending, ['Tip 1', 'Tip 2'], ['Tip 3', 'Tip 4'], 'key', {...}, 'Subject');
 */
/**
 * Builds a natural language prompt for Microsoft Copilot to draft a coaching email.
 * Incorporates performance data, tips, and optional notes into guidance for AI.
 * 
 * @param {string} displayName - Employee's name for personalization
 * @param {Object} weakestMetric - Employee's lowest-performing metric
 * @param {Object} trendingMetric - Second metric below target
 * @param {string[]} tipsForWeakest - 2 random tips for weakest metric
 * @param {string[]} tipsForTrending - 2 random tips for trending metric
 * @param {string} userNotes - Optional additional context from hiring manager
 * @returns {string} Formatted prompt text for Copilot to generate coaching email
 *
 * @example
 * const prompt = buildTrendCoachingPrompt('John', weakest, trending, ['Tip 1', 'Tip 2'], ['Tip 3', 'Tip 4'], '');
 */
// ============================================
// PHASE 3 - METRIC ROW RENDERER
// ============================================

// ============================================
// YEARLY AVERAGE CALCULATIONS
// ============================================

// ============================================
// EXECUTIVE SUMMARY
// ============================================

function buildExecutiveSummaryCallouts(latestKey, latestWeek) {
    const delegated = window.DevCoachModules?.trendIntelligence?.buildExecutiveSummaryCallouts?.({
        latestWeek,
        centerAvg: latestKey ? getCenterAverageForWeek(latestKey) : null,
        metricsRegistry: METRICS_REGISTRY,
        isReverseMetric,
        formatMetricValue,
        isAssociateIncludedByTeamFilter
    });
    return Array.isArray(delegated) ? delegated : [];
}

function buildExecutiveSummarySavedNotesText(associate) {
    const saved = getExecutiveSummaryNotesStore();
    const employeeNotes = saved[associate] || {};
    const ytdNotes = employeeNotes['ytd-summary'] || {};

    const delegated = window.DevCoachModules?.trendIntelligence?.buildExecutiveSummarySavedNotesText?.(ytdNotes);
    return delegated || 'SAVED RISK NOTES:\n- No saved red flags or phishing notes.\n';
}

async function generateExecutiveSummaryCopilotEmail() {
    const associate = document.getElementById('summaryAssociateSelect')?.value;
    if (!associate) {
        showToast('Select an associate first', 3000);
        return;
    }

    const latestKey = getLatestWeeklyKey();
    const latestWeek = latestKey ? weeklyData[latestKey] : null;
    if (!latestKey || !latestWeek) {
        showToast('No weekly data available', 3000);
        return;
    }

    const endDate = latestWeek?.metadata?.endDate
        ? formatDateMMDDYYYY(latestWeek.metadata.endDate)
        : (latestKey?.split('|')[1] ? formatDateMMDDYYYY(latestKey.split('|')[1]) : 'this period');

    // Load tips from CSV
    const allTips = await loadServerTips();

    // Build individual wins callouts
    const individualWins = buildExecutiveSummaryCallouts(latestKey, latestWeek);
    let individualWinsText = '';
    if (individualWins.length > 0) {
        individualWinsText = 'INDIVIDUAL WINS (Team Members Crushing Metrics vs Call Center Average):\\n';
        individualWins.forEach(item => {
            individualWinsText += `- ${item.name}: ${item.metric} at ${item.value} vs center ${item.center} (${item.diff})\\n`;
        });
    } else {
        individualWinsText = 'INDIVIDUAL WINS: No call center averages configured yet.\\n';
    }

    // Build team performance vs center average
    const teamPerformance = buildTeamVsCenterAnalysis(latestKey, latestWeek);
    let teamPerformanceText = 'TEAM PERFORMANCE vs CALL CENTER AVERAGE:\\n';
    if (teamPerformance.length > 0) {
        teamPerformance.forEach(item => {
            const indicator = item.diff > 0 ? '✓' : item.diff < 0 ? '✗' : '=';
            teamPerformanceText += `${indicator} ${item.metric}: Team ${item.teamValue} vs Center ${item.centerValue} (${item.diffFormatted})\\n`;
        });
    } else {
        teamPerformanceText += 'No call center averages configured yet.\\n';
    }

    // Find biggest opportunity and get a tip
    let focusAreaText = '';
    const biggestOpportunity = teamPerformance.find(item => item.diff < 0);
    if (biggestOpportunity && allTips[biggestOpportunity.metricKey]) {
        const tips = allTips[biggestOpportunity.metricKey] || [];
        const randomTip = tips[Math.floor(Math.random() * tips.length)];
        focusAreaText = `TEAM FOCUS AREA & TIP:\\n- ${biggestOpportunity.metric}: Team needs improvement (${biggestOpportunity.diffFormatted} below center)\\n- Tip: ${randomTip}\\n`;
    } else {
        focusAreaText = 'TEAM FOCUS AREA: Team is performing well across all metrics!\\n';
    }

    const savedNotesText = buildExecutiveSummarySavedNotesText(associate);

    const copilotPrompt = window.DevCoachModules?.trendIntelligence?.buildExecutiveSummaryCopilotPrompt?.({
        endDate,
        individualWinsText,
        teamPerformanceText,
        focusAreaText,
        savedNotesText
    }) || '';

    if (!copilotPrompt) {
        showToast('Trend Intelligence module not available. Refresh and try again.', 3500);
        return;
    }

    // Call Copilot with the prompt
    openCopilotWithPrompt(copilotPrompt, 'Executive Summary Email');
}

// ============================================
// OFFLINE COPILOT SUPPORT
// ============================================

function buildTeamVsCenterAnalysis(latestKey, latestWeek) {
    const delegated = window.DevCoachModules?.trendIntelligence?.buildTeamVsCenterAnalysis?.({
        latestWeek,
        centerAvg: latestKey ? getCenterAverageForWeek(latestKey) : null,
        metricsRegistry: METRICS_REGISTRY,
        isReverseMetric,
        formatMetricValue,
        isAssociateIncludedByTeamFilter
    });
    return Array.isArray(delegated) ? delegated : [];
}

// ============================================
// SUPERVISOR INTELLIGENCE HELPERS
// ============================================

function getWeeklyKeysSorted() {
    const allData = Object.assign({}, weeklyData, ytdData);
    return Object.keys(allData)
        .map(key => ({ key, date: parseWeekKeyDate(key, allData[key]) }))
        .sort((a, b) => a.date - b.date)
        .map(item => item.key);
}

/**
 * When a period ended, as a local timestamp.
 *
 * Date.parse on a bare "YYYY-MM-DD" is defined as UTC midnight. Read back with
 * getFullYear in a timezone west of Greenwich that is the previous local day,
 * so in Phoenix Date.parse('2026-01-01') is 31 December 2025. Used only for
 * sorting that would not matter, because every key shifts equally. It is used
 * for year bucketing too, where a year-to-date period ending 1 January landed
 * in the wrong year.
 *
 * Anchoring at local noon is what period-index already does, for the same
 * reason: noon is far enough from both midnights that no offset moves the date.
 */
function parseWeekKeyDate(weekKey, week) {
    const parseLocal = (value) => {
        const text = String(value == null ? '' : value).trim();
        if (!text) return NaN;
        // Bare ISO dates get anchored at local noon. Anything else already
        // carries its own time or is a written label, so it is left alone.
        const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text + 'T12:00:00' : text;
        return Date.parse(iso);
    };

    // Try metadata endDate first (most reliable, ISO format)
    const endDate = week?.metadata?.endDate;
    if (endDate) {
        const parsed = parseLocal(endDate);
        if (Number.isFinite(parsed)) return parsed;
    }

    // Try parsing from the weekKey itself (format: "startDate|endDate")
    const parts = (weekKey || '').split('|');
    const keyEnd = parts[1] || parts[0] || '';
    if (keyEnd) {
        const parsed = parseLocal(keyEnd);
        if (Number.isFinite(parsed)) return parsed;
    }

    // Fallback: try label/weekEnding
    const label = week?.metadata?.label || week?.metadata?.weekEnding || '';
    const match = label.match(/Week ending\s+(.+)$/i);
    const dateStr = match ? match[1] : label;
    if (dateStr) {
        const parsed = parseLocal(dateStr);
        if (Number.isFinite(parsed)) return parsed;
    }

    return 0;
}

function getLatestWeeklyKey() {
    const keys = getWeeklyKeysSorted();
    return keys.length ? keys[keys.length - 1] : null;
}

function getPeriodDataStore(periodType) {
    if (periodType === 'ytd') return ytdData;
    // 'daily' = data periodType; 'dod' = day-over-day trend comparison mode.
    if (periodType === 'daily' || periodType === 'dod') return dailyData;
    return weeklyData;
}

// Drops any dailyData rows whose date falls inside [rangeStart, rangeEnd]
// (inclusive). Used when a larger period upload (week/month/quarter/custom/YTD)
// supersedes the ephemeral daily rows for the same dates. Returns the count
// removed so the caller can decide whether to persist dailyData.

/**
 * Drops the oldest archived days until the archive will save again.
 *
 * dailyArchive is uncapped on the IndexedDB backend, but a browser in the
 * localStorage fallback -- IndexedDB blocked, a private window, a stalled open
 * -- meets the 4 MB ceiling after roughly four months of check-ins. Before
 * this, that wedged: the archive write failed forever, so dailies never left
 * the working set, dailyData grew every week, and once IT passed the ceiling
 * the daily upload itself stopped persisting while the UI still reported
 * success. The cost of keeping every old day was new days.
 *
 * So when there is genuinely no room, the oldest days go. They are the right
 * thing to give up: the archive is day-level detail sitting behind a weekly
 * upload that is already authoritative for the same dates, and the newest days
 * are the ones a trend question actually reaches for. What must never be
 * dropped is the rows this call is trying to archive right now, which is what
 * protectedKeys is.
 *
 * Returns how many were dropped, or 0 if it could not make room at all.
 */
function makeRoomInDailyArchive(storage, archive, protectedKeys) {
    const safe = new Set(protectedKeys);
    // Daily keys are "YYYY-MM-DD|YYYY-MM-DD", so a plain sort is chronological.
    const evictable = Object.keys(archive).filter((key) => !safe.has(key)).sort();

    // Held so a failed sweep can be undone. The archive object is the live
    // cache by reference in IndexedDB mode, so leaving it emptied after a write
    // that never landed would throw away history the store still holds.
    const removed = {};
    let dropped = 0;

    // A month at a time: one-at-a-time would re-serialize the whole archive per
    // day removed, and this runs on the upload path.
    while (evictable.length) {
        evictable.splice(0, 30).forEach((key) => {
            removed[key] = archive[key];
            delete archive[key];
            dropped += 1;
        });
        if (storage?.saveWithSizeCheck?.('dailyArchive', archive) !== false) return dropped;
    }

    // No room even with everything evictable gone, so the ceiling was not the
    // problem. Put it all back and let the caller roll the working set back
    // instead.
    Object.keys(removed).forEach((key) => { archive[key] = removed[key]; });
    return 0;
}

/**
 * Moves dailies out of the working set once a larger upload covers them.
 *
 * These used to be deleted outright, because dailies were ephemeral and
 * localStorage had a ceiling. Neither is true now, and the day-level detail is
 * the only thing that can answer "how was this person trending in March" at any
 * resolution finer than a week. Destroying it to save space that is no longer
 * scarce is the wrong trade.
 *
 * They move to dailyArchive rather than staying in dailyData, so everything
 * that reads dailyData behaves exactly as before: the working set still means
 * "days not yet covered by a weekly upload". Nothing on screen changes; the
 * rows simply still exist.
 */
function purgeDailiesCoveredBy(rangeStart, rangeEnd) {
    if (!rangeStart || !rangeEnd) return 0;

    const storage = window.DevCoachModules?.storage;
    const archive = storage?.readStore?.('dailyArchive') || {};
    // Only the rows THIS call moved. The archive already holds everything moved
    // before it, and the rollback below must not pour a year of history back
    // into the working set.
    const movedKeys = [];

    Object.keys(dailyData).forEach(key => {
        const meta = dailyData[key]?.metadata || {};
        // Daily key format is "YYYY-MM-DD|YYYY-MM-DD" with start === end.
        const dayDate = meta.endDate || (key.includes('|') ? key.split('|')[1] : '');
        if (!dayDate) return;
        if (dayDate >= rangeStart && dayDate <= rangeEnd) {
            archive[key] = dailyData[key];
            delete dailyData[key];
            movedKeys.push(key);
        }
    });

    if (movedKeys.length) {
        // A failed archive write must not cost the rows. They are still in
        // dailyData at this point only if the save succeeded, so save first and
        // let the caller's own save of dailyData follow.
        let archived = storage?.saveWithSizeCheck?.('dailyArchive', archive) !== false;

        // Only the localStorage fallback has a ceiling; on the backend the
        // archive is uncapped and a failure there means something else is
        // wrong, which eviction would not fix and would cost history for
        // nothing.
        if (!archived && storage?.isBackedByIdb?.('dailyArchive') === false) {
            const dropped = makeRoomInDailyArchive(storage, archive, movedKeys);
            if (dropped > 0) {
                console.warn(`[dailies] The archive was full; dropped the ${dropped} oldest archived day(s) to make room.`);
                archived = true;
            }
        }

        if (!archived) {
            console.error('[dailies] Could not archive; restoring them to the working set.');
            // Exactly the rows this call took, and no others. This used to walk
            // every key in the archive, which pours the whole accumulated year
            // back into dailyData -- on a browser sitting in the localStorage
            // fallback that took the working set from five keys to eighty in one
            // upload, and it grew from there until dailyData itself hit the cap
            // and daily check-ins stopped persisting with nothing on screen to
            // say so.
            //
            // The delete matters too: in IndexedDB mode readStore hands back the
            // live cache BY REFERENCE, so these rows were written into it before
            // saveWithSizeCheck was ever called and would survive a failed write.
            movedKeys.forEach((key) => {
                dailyData[key] = archive[key];
                delete archive[key];
            });
            // Silence here is the actual damage. The rows are safe, but the
            // archive is full and will stay full, so say so rather than letting
            // it fail quietly on every upload from here on.
            notifyStorageSaveFailed('archived daily check-ins');
            return 0;
        }
    }
    return movedKeys.length;
}

// Weighted team averages across a set of employees within a single period.
// Matches the aggregation rule (never average-of-averages): weight by
// surveyTotal for survey-backed metrics, totalCalls otherwise.
const SURVEY_WEIGHTED_METRIC_KEYS = new Set(['overallExperience', 'cxRepOverall', 'fcr']);
function buildTeamWeightedAverages(employees, metricKeys) {
    const out = {};
    (metricKeys || []).forEach(key => { out[key] = null; });
    if (!Array.isArray(employees) || !employees.length) return out;

    const sums = {};
    const weights = {};
    employees.forEach(emp => {
        if (!emp) return;
        const totalCalls = parseInt(emp.totalCalls, 10);
        const surveyTotal = parseInt(emp.surveyTotal, 10);
        metricKeys.forEach(key => {
            const value = parseFloat(emp[key]);
            if (!Number.isFinite(value)) return;
            let w;
            if (SURVEY_WEIGHTED_METRIC_KEYS.has(key)) {
                w = Number.isInteger(surveyTotal) && surveyTotal > 0 ? surveyTotal : 0;
            } else {
                w = Number.isInteger(totalCalls) && totalCalls > 0 ? totalCalls : 1;
            }
            if (w <= 0) return;
            sums[key] = (sums[key] || 0) + value * w;
            weights[key] = (weights[key] || 0) + w;
        });
    });

    metricKeys.forEach(key => {
        if (weights[key] > 0) out[key] = sums[key] / weights[key];
    });
    return out;
}

function getTrendMetadataType(periodType) {
    if (periodType === 'dod') return 'daily';
    if (periodType === 'mom') return 'month';
    if (periodType === 'ytd') return 'ytd';
    return 'week';
}

function getTrendKeysForPeriodType(periodType) {
    const sourceData = getPeriodDataStore(periodType);
    const metadataType = getTrendMetadataType(periodType);

    return Object.keys(sourceData || {})
        .filter(key => (sourceData[key]?.metadata?.periodType || (periodType === 'ytd' ? 'ytd' : 'week')) === metadataType)
        .sort((a, b) => parseWeekKeyDate(a, sourceData[a]) - parseWeekKeyDate(b, sourceData[b]));
}

function getTrendPeriodRecord(periodKey) {
    return weeklyData[periodKey] || ytdData[periodKey] || dailyData[periodKey] || null;
}

function getTrendPeriodLabel(periodKey) {
    const period = getTrendPeriodRecord(periodKey);
    return period?.metadata?.label || formatWeekLabel(periodKey) || periodKey;
}

function formatTrendBucketLabel(periodKeys) {
    if (!Array.isArray(periodKeys) || periodKeys.length === 0) return 'No data';
    if (periodKeys.length === 1) return getTrendPeriodLabel(periodKeys[0]);
    return `${getTrendPeriodLabel(periodKeys[0])} -> ${getTrendPeriodLabel(periodKeys[periodKeys.length - 1])}`;
}

function getPreviousWeeklyKey(latestKey) {
    const keys = getWeeklyKeysSorted();
    const idx = keys.indexOf(latestKey);
    if (idx > 0) return keys[idx - 1];
    return null;
}

function getTrendPeriodDescriptor(periodType) {
    if (periodType === 'dod') {
        return { label: 'Day over Day', shortLabel: 'DoD', compareLabel: 'day' };
    }
    if (periodType === 'mom') {
        return { label: 'Month over Month', shortLabel: 'MoM', compareLabel: 'month' };
    }
    if (periodType === 'ytd') {
        return { label: 'Year to Date', shortLabel: 'YTD', compareLabel: 'year' };
    }
    return { label: 'Week over Week', shortLabel: 'WoW', compareLabel: 'week' };
}

function getTrendComparisonBuckets(keys, periodType) {
    const descriptor = getTrendPeriodDescriptor(periodType);
    const typedKeys = Array.isArray(keys) && keys.length ? keys : getTrendKeysForPeriodType(periodType);

    if (!typedKeys.length) {
        return {
            descriptor,
            currentKeys: [],
            previousKeys: [],
            thirdKeys: []
        };
    }

    if (periodType === 'mom' || periodType === 'dod' || periodType === 'wow') {
        return {
            descriptor,
            currentKeys: typedKeys.slice(-1),
            previousKeys: typedKeys.slice(-2, -1),
            thirdKeys: typedKeys.slice(-3, -2)
        };
    }

    if (periodType === 'ytd') {
        const sourceData = getPeriodDataStore(periodType);
        const yearBuckets = {};
        typedKeys.forEach(weekKey => {
            const parsed = parseWeekKeyDate(weekKey, sourceData[weekKey]);
            if (!parsed) return;
            const year = new Date(parsed).getFullYear();
            if (!yearBuckets[year]) yearBuckets[year] = [];
            yearBuckets[year].push(weekKey);
        });

        const years = Object.keys(yearBuckets).map(y => parseInt(y, 10)).sort((a, b) => a - b);
        const currentYear = years.length ? years[years.length - 1] : null;

        return {
            descriptor,
            currentKeys: currentYear ? (yearBuckets[currentYear] || []) : [],
            previousKeys: currentYear ? (yearBuckets[currentYear - 1] || []) : [],
            thirdKeys: currentYear ? (yearBuckets[currentYear - 2] || []) : []
        };
    }

    return {
        descriptor,
        currentKeys: typedKeys.slice(-1),
        previousKeys: typedKeys.slice(-2, -1),
        thirdKeys: typedKeys.slice(-3, -2)
    };
}

function buildEmployeeAggregateForPeriod(employeeName, periodKeys) {
    if (!employeeName || !Array.isArray(periodKeys) || periodKeys.length === 0) return null;

    const surveyBackedMetrics = new Set(['overallExperience', 'cxRepOverall', 'fcr']);
    const cumulativeMetrics = new Set(['reliability']);
    const weightedSums = {};
    const weightedCounts = {};
    const cumulativeSums = {};
    let periodsIncluded = 0;

    periodKeys.forEach(weekKey => {
        const week = getTrendPeriodRecord(weekKey);
        const employee = week?.employees?.find(emp => emp.name === employeeName);
        if (!employee) return;

        periodsIncluded += 1;
        const tc = parseInt(employee?.totalCalls, 10);
        const st = parseInt(employee?.surveyTotal, 10);

        Object.keys(METRICS_REGISTRY).forEach(metricKey => {
            if (surveyBackedMetrics.has(metricKey) && (!Number.isInteger(st) || st <= 0)) return;

            const value = parseFloat(employee[metricKey]);
            if (Number.isNaN(value)) return;

            if (cumulativeMetrics.has(metricKey)) {
                cumulativeSums[metricKey] = (cumulativeSums[metricKey] || 0) + value;
            } else {
                let w = 1;
                if (surveyBackedMetrics.has(metricKey)) {
                    w = Number.isInteger(st) && st > 0 ? st : 0;
                } else {
                    w = Number.isInteger(tc) && tc > 0 ? tc : 1;
                }
                if (w > 0) {
                    weightedSums[metricKey] = (weightedSums[metricKey] || 0) + value * w;
                    weightedCounts[metricKey] = (weightedCounts[metricKey] || 0) + w;
                }
            }
        });
    });

    if (periodsIncluded === 0) return null;

    const aggregate = {
        name: employeeName,
        periodsIncluded,
        periodKeys: [...periodKeys]
    };

    Object.keys(weightedSums).forEach(metricKey => {
        if (weightedCounts[metricKey] > 0) {
            aggregate[metricKey] = weightedSums[metricKey] / weightedCounts[metricKey];
        }
    });

    Object.keys(cumulativeSums).forEach(metricKey => {
        aggregate[metricKey] = cumulativeSums[metricKey];
    });

    return aggregate;
}

function getEmployeeNamesForPeriod(periodKeys) {
    const names = new Set();
    if (!Array.isArray(periodKeys)) return names;
    const teamFilterContext = getTeamSelectionContext();

    periodKeys.forEach(weekKey => {
        const employees = getTrendPeriodRecord(weekKey)?.employees || [];
        employees.forEach(emp => {
            if (emp?.name && isAssociateIncludedByTeamFilter(emp.name, teamFilterContext)) {
                names.add(emp.name);
            }
        });
    });

    return names;
}

function getTrendDeltaThreshold(metricKey) {
    const unit = METRICS_REGISTRY[metricKey]?.unit || '%';
    if (unit === 'sec') return { value: 20, unit };
    if (unit === 'hrs') return { value: 2, unit };
    return { value: 4, unit };
}

function resolveCoachingHistoryForEmployee(employeeName) {
    if (!employeeName) return [];

    if (typeof getCoachingHistoryForEmployee === 'function') {
        try {
            const resolvedHistory = getCoachingHistoryForEmployee(employeeName);
            if (Array.isArray(resolvedHistory)) return resolvedHistory;
        } catch (error) {
            console.warn('Using fallback coaching history resolver:', error);
        }
    }

    const history = coachingHistory?.[employeeName];
    if (!Array.isArray(history)) return [];
    return history
        .slice()
        .sort((a, b) => new Date(b.generatedAt).getTime() - new Date(a.generatedAt).getTime());
}

function calculateCoachingImpact(employeeName, currentSnapshot) {
    if (!employeeName || !currentSnapshot) return null;

    const history = resolveCoachingHistoryForEmployee(employeeName);
    if (!history.length) return null;

    const latestSession = history[0];
    const coachedMetrics = (latestSession.metricsCoached || []).filter(Boolean);
    if (!coachedMetrics.length) return null;

    const impacts = [];
    coachedMetrics.forEach(metricKey => {
        const baseline = getEmployeeMetricForWeek(employeeName, latestSession.weekEnding, metricKey);
        const currentValue = currentSnapshot[metricKey];
        if (baseline === undefined || baseline === null || currentValue === undefined || currentValue === null) return;

        const parsedBaseline = parseFloat(baseline);
        const parsedCurrent = parseFloat(currentValue);
        if (Number.isNaN(parsedBaseline) || Number.isNaN(parsedCurrent)) return;

        const delta = metricDelta(metricKey, parsedCurrent, parsedBaseline);
        const threshold = getTrendDeltaThreshold(metricKey).value;
        const normalized = Math.max(-1, Math.min(1, delta / threshold));

        impacts.push({
            metricKey,
            delta,
            unit: METRICS_REGISTRY[metricKey]?.unit || '%',
            normalized
        });
    });

    if (!impacts.length) return null;

    const avgNormalized = impacts.reduce((sum, item) => sum + item.normalized, 0) / impacts.length;
    const score = Math.round(50 + (avgNormalized * 50));
    const status = score >= 65 ? 'positive' : score <= 35 ? 'negative' : 'mixed';

    return {
        score,
        status,
        metricCount: impacts.length,
        generatedAt: latestSession.generatedAt,
        details: impacts
            .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
            .slice(0, 2)
            .map(item => {
                const direction = item.delta > 0 ? 'improved' : item.delta < 0 ? 'declined' : 'held steady';
                const amount = Math.abs(item.delta);
                const formatted = item.unit === 'sec'
                    ? `${Math.round(amount)}${item.unit}`
                    : item.unit === 'hrs'
                    ? `${amount.toFixed(1)} ${item.unit}`
                    : `${amount.toFixed(1)}${item.unit}`;
                return `${METRICS_REGISTRY[item.metricKey]?.label || item.metricKey} ${direction} by ${formatted}`;
            })
    };
}

function renderCoachingPriorityQueue() {
    const container = document.getElementById('coachingPriorityQueueOutput');
    if (!container) return;

    const legendStorageKey = STORAGE_PREFIX + 'trendQueueLegendExpanded';
    let isLegendExpanded = true;
    try {
        const storedLegendState = localStorage.getItem(legendStorageKey);
        if (storedLegendState === '0' || storedLegendState === 'false') {
            isLegendExpanded = false;
        } else if (storedLegendState === '1' || storedLegendState === 'true') {
            isLegendExpanded = true;
        }
    } catch {
        // keep default open state
    }

    const keys = getWeeklyKeysSorted();
    if (keys.length < 2) {
        container.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.95em;">Upload at least 2 periods of data to generate a priority queue.</div>';
        return;
    }

    const periodType = document.getElementById('trendPeriodSelector')?.value || 'wow';
    const buckets = getTrendComparisonBuckets(keys, periodType);

    if (!buckets.currentKeys.length || !buckets.previousKeys.length) {
        container.innerHTML = `<div style="color: var(--text-secondary); font-size: 0.95em;">Not enough data for ${escapeHtml(buckets.descriptor.label)} queue generation.</div>`;
        return;
    }

    const employeeNames = Array.from(getEmployeeNamesForPeriod(buckets.currentKeys)).sort();
    if (!employeeNames.length) {
        container.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.95em;">No employees found in the current window.</div>';
        return;
    }

    const coreMetrics = window.CORE_PERFORMANCE_METRICS || ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment', 'transfers', 'aht'];
    const queue = {
        coachNow: [],
        recognizeNow: [],
        watchlist: []
    };

    employeeNames.forEach(employeeName => {
        const entry = buildCoachingPriorityEntry(employeeName, buckets, coreMetrics);
        if (!entry) return;

        queue[entry.category].push({
            name: employeeName,
            score: entry.score,
            reason: entry.reason,
            why: entry.why || []
        });
    });

    trendPrioritySnapshot = {
        queue,
        buckets,
        employeeNamesCount: employeeNames.length
    };

    queue.coachNow.sort((a, b) => b.score - a.score);
    queue.recognizeNow.sort((a, b) => b.score - a.score);
    queue.watchlist.sort((a, b) => b.score - a.score);

    let html = `<div style="padding: 10px; border: 1px solid #e6eefc; border-radius: 6px; background: #f8fbff;">`;
    html += `<strong>Mode:</strong> ${buckets.descriptor.label} • <strong>Team Members Scored:</strong> ${employeeNames.length}`;
    html += `</div>`;

    html += renderCoachingPriorityBucket(
        '🎯 Coach Now',
        queue.coachNow,
        '#ffebee',
        '#f5c6cb',
        'No urgent coaching interventions this cycle.',
        'Why coach now:'
    );
    html += renderCoachingPriorityBucket(
        '🏆 Recognize Now',
        queue.recognizeNow,
        '#e8f5e9',
        '#c8e6c9',
        'No standout recognition callouts this cycle.',
        'Why recognize now:'
    );
    html += renderCoachingPriorityBucket(
        '👀 Watchlist',
        queue.watchlist,
        '#fff8e1',
        '#ffe0b2',
        'No watchlist candidates right now.',
        'Why watch:'
    );

    html += `
        <details id="trendQueueLegend" ${isLegendExpanded ? 'open' : ''} style="margin-top: 10px; border: 1px solid #d9e2ef; border-radius: 6px; background: #f7f9fc; color: #455a64; font-size: 0.88em; line-height: 1.45;">
            <summary style="cursor: pointer; padding: 10px; font-weight: 700; color: #2f4f87;">📘 Scoring Legend (Show/Hide)</summary>
            <div style="padding: 0 10px 10px 10px;">
                <div><strong>Coach Now:</strong> +14 below target, +10/+6/+3 severity, +12 significant drop, +12 negative coaching impact.</div>
                <div><strong>Recognize Now:</strong> +9 meeting target, +8 strong improvement, +15 all core metrics on target, +10 positive coaching impact.</div>
                <div><strong>Watchlist:</strong> points for mixed/flat signals, mixed coaching impact, or no coaching touch in 30+ days.</div>
                <div style="margin-top: 4px;"><strong>Note:</strong> Scores are weighted points (not percentages), so totals can exceed 100.</div>
            </div>
        </details>
    `;

    container.innerHTML = html;

    const legendDetails = document.getElementById('trendQueueLegend');
    if (legendDetails) {
        legendDetails.addEventListener('toggle', () => {
            try {
                localStorage.setItem(legendStorageKey, legendDetails.open ? '1' : '0');
            } catch {
                // ignore storage write failures
            }
        });
    }
}

function buildCoachingPriorityEntry(employeeName, buckets, coreMetrics) {
    const currentEmp = buildEmployeeAggregateForPeriod(employeeName, buckets.currentKeys);
    const prevEmp = buildEmployeeAggregateForPeriod(employeeName, buckets.previousKeys);
    if (!currentEmp || !prevEmp) return null;

    let coachScore = 0;
    let recognizeScore = 0;
    let watchScore = 0;
    const coachReasons = [];
    const recognizeReasons = [];
    const watchReasons = [];

    coreMetrics.forEach(metricKey => {
        const current = currentEmp[metricKey];
        const prev = prevEmp[metricKey];
        if (current === undefined || current === null) return;

        const meets = metricMeetsTarget(metricKey, current);
        const delta = prev === undefined || prev === null ? 0 : metricDelta(metricKey, current, prev);
        const thresholdData = getTrendDeltaThreshold(metricKey);

        if (!meets) {
            coachScore += 14;
            const severity = getMetricSeverity(metricKey, current);
            if (severity === 'high') coachScore += 10;
            else if (severity === 'medium') coachScore += 6;
            else coachScore += 3;

            if (coachReasons.length < 3) {
                coachReasons.push(`${METRICS_REGISTRY[metricKey]?.label || metricKey} below target`);
            }
        } else {
            recognizeScore += 9;
        }

        if (delta > 5) {
            recognizeScore += 8;
            if (recognizeReasons.length < 3) {
                recognizeReasons.push(`${METRICS_REGISTRY[metricKey]?.label || metricKey} improving (+${delta.toFixed(1)})`);
            }
        }

        if (delta < -thresholdData.value) {
            coachScore += 12;
            if (coachReasons.length < 3) {
                coachReasons.push(`${METRICS_REGISTRY[metricKey]?.label || metricKey} dropped ${delta.toFixed(1)}${thresholdData.unit}`);
            }
        }

        if (Math.abs(delta) <= 1.5) {
            watchScore += 2;
        }
    });

    const meetsAllCore = (window.CORE_SURVEY_METRICS || ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment']).every(metricKey =>
        metricMeetsTarget(metricKey, currentEmp[metricKey])
    );

    if (meetsAllCore) {
        recognizeScore += 15;
        if (recognizeReasons.length < 3) recognizeReasons.push('All core metrics at/above target');
    }

    const impact = calculateCoachingImpact(employeeName, currentEmp);
    if (impact?.status === 'positive') {
        recognizeScore += 10;
        if (recognizeReasons.length < 3) recognizeReasons.push(`Coaching impact ${impact.score}/100`);
    } else if (impact?.status === 'negative') {
        coachScore += 12;
        if (coachReasons.length < 3) coachReasons.push(`Coaching impact ${impact.score}/100 (needs reset)`);
    } else if (impact?.status === 'mixed') {
        watchScore += 6;
        if (watchReasons.length < 3) watchReasons.push(`Mixed coaching impact ${impact.score}/100`);
    }

    const history = resolveCoachingHistoryForEmployee(employeeName);
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const hasRecentCoaching = history.some(h => new Date(h.generatedAt).getTime() >= thirtyDaysAgo);
    if (!hasRecentCoaching) {
        watchScore += 8;
        if (watchReasons.length < 3) watchReasons.push('No coaching touch in 30+ days');
    }

    if (coachScore < 35 && recognizeScore < 35) {
        watchScore += 8;
        if (watchReasons.length < 3) watchReasons.push('Mixed/flat trend signals');
    }

    const topCategory = [
        { key: 'coachNow', score: coachScore },
        { key: 'recognizeNow', score: recognizeScore },
        { key: 'watchlist', score: watchScore }
    ].sort((a, b) => b.score - a.score)[0];

    if (topCategory.score <= 0) return null;

    const reason = topCategory.key === 'coachNow'
        ? (coachReasons[0] || 'Performance signals need intervention')
        : topCategory.key === 'recognizeNow'
        ? (recognizeReasons[0] || 'Strong and improving performance')
        : (watchReasons[0] || 'Monitor for next period shifts');

    const why = topCategory.key === 'coachNow'
        ? coachReasons
        : topCategory.key === 'recognizeNow'
        ? recognizeReasons
        : watchReasons;

    return {
        category: topCategory.key,
        score: topCategory.score,
        reason,
        why
    };
}

function renderCoachingPriorityBucket(title, entries, bg, border, emptyText, whyLabel = 'Why:') {
    let html = `<div style="padding: 10px; border: 1px solid ${border}; border-radius: 6px; background: ${bg};">`;
    html += `<strong>${title}</strong>`;
    if (!entries.length) {
        html += `<div style="margin-top: 6px; color: var(--text-secondary); font-size: 0.9em;">${emptyText}</div>`;
    } else {
        html += '<div style="margin-top: 6px; display: grid; gap: 6px;">';
        entries.slice(0, 5).forEach(entry => {
            const whyText = Array.isArray(entry.why) && entry.why.length
                ? entry.why.slice(0, 3).join(' • ')
                : entry.reason;
            html += `<div>
                <div><strong>${escapeHtml(entry.name)}</strong> • Score ${entry.score} • ${escapeHtml(entry.reason)}</div>
                <div style="margin-top: 2px; color: #455a64; font-size: 0.88em;"><strong>${whyLabel}</strong> ${escapeHtml(whyText)}</div>
            </div>`;
        });
        html += '</div>';
    }
    html += '</div>';
    return html;
}

function buildTrendSeriesData(metricKey, employeeName, keys, periodType) {
    const toMetricValue = (weekKey) => {
        const employee = getTrendPeriodRecord(weekKey)?.employees?.find(e => e.name === employeeName);
        const value = parseFloat(employee?.[metricKey]);
        return Number.isNaN(value) ? null : value;
    };

    return keys
        .slice(-8)
        .map(weekKey => ({ label: getTrendPeriodLabel(weekKey), value: toMetricValue(weekKey) }))
        .filter(item => item.value !== null);
}

function metricMeetsTarget(metricKey, value) {
    const def = METRICS_REGISTRY[metricKey];
    if (!def || value === undefined || value === null || value === '') return false;
    const target = def.target?.value ?? getMetricTarget(metricKey);
    if (isReverseMetric(metricKey)) {
        return value <= target;
    }
    return value >= target;
}

function metricGapToTarget(metricKey, value) {
    const def = METRICS_REGISTRY[metricKey];
    const target = def?.target?.value ?? getMetricTarget(metricKey);
    if (value === undefined || value === null || value === '') return 0;
    return isReverseMetric(metricKey) ? (value - target) : (target - value);
}

function metricDelta(metricKey, current, previous) {
    if (current === undefined || previous === undefined) return 0;
    return isReverseMetric(metricKey) ? (previous - current) : (current - previous);
}

function getMetricSeverity(metricKey, value) {
    const gap = Math.abs(metricGapToTarget(metricKey, value));
    const unit = METRICS_REGISTRY[metricKey]?.unit || '%';
    if (unit === 'sec') {
        if (gap > 25) return 'high';
        if (gap > 10) return 'medium';
        return 'low';
    }
    if (unit === 'hrs') {
        if (gap > 3) return 'high';
        if (gap > 1) return 'medium';
        return 'low';
    }
    if (gap > 5) return 'high';
    if (gap > 2) return 'medium';
    return 'low';
}

function loadTipUsageHistory() {
    try {
        const storage = window.DevCoachModules?.storage;
        if (storage?.loadTipUsageHistory) return storage.loadTipUsageHistory() || {};
        return JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'tipUsageHistory') || '{}');
    } catch {
        return {};
    }
}

function saveTipUsageHistory(history) {
    window.DevCoachModules?.storage?.saveWithSizeCheck?.('tipUsageHistory', history);
}

function selectSmartTip({ employeeId, metricKey, severity, tips }) {
    if (!tips || tips.length === 0) return null;
    const history = loadTipUsageHistory();
    const now = Date.now();
    const cutoff = now - 30 * 24 * 60 * 60 * 1000;
    const empHistory = history[employeeId] || {};
    const metricHistory = empHistory[metricKey] || [];
    const recentlyUsed = new Set(metricHistory.filter(h => new Date(h.usedAt).getTime() >= cutoff).map(h => h.tip));

    const available = tips.filter(tip => !recentlyUsed.has(tip));
    let pickFrom;
    if (available.length) {
        pickFrom = available;
    } else {
        const lastUsedByTip = {};
        metricHistory.forEach(h => {
            const t = new Date(h.usedAt).getTime();
            if (!lastUsedByTip[h.tip] || t > lastUsedByTip[h.tip]) {
                lastUsedByTip[h.tip] = t;
            }
        });
        const sortedByAge = [...tips].sort((a, b) => (lastUsedByTip[a] || 0) - (lastUsedByTip[b] || 0));
        const poolSize = Math.max(1, Math.ceil(sortedByAge.length / 4));
        pickFrom = sortedByAge.slice(0, poolSize);
    }
    const severityFiltered = pickFrom.filter(tip => {
        if (severity === 'high') return tip.length <= 120;
        if (severity === 'low') return tip.length >= 60;
        return true;
    });

    const selectionPool = severityFiltered.length ? severityFiltered : pickFrom;
    const chosen = selectionPool[Math.floor(Math.random() * selectionPool.length)];

    // Uncapped: knowing a tip was given eight months ago is the point of
    // keeping the history at all.
    const updated = metricHistory.concat([{ tip: chosen, usedAt: new Date().toISOString() }]);
    history[employeeId] = { ...empHistory, [metricKey]: updated };
    saveTipUsageHistory(history);

    const prefixMap = {
        high: 'Try this today:',
        medium: 'Practice this:',
        low: 'Keep building by:'
    };
    return `${prefixMap[severity] || 'Tip:'} ${chosen}`;
}

function getCoachingContext(employeeId, metricKey, currentValue) {
    const history = resolveCoachingHistoryForEmployee(employeeId);
    const last = history.find(entry => (entry.metricsCoached || []).includes(metricKey));
    if (!last) return null;

    const priorValue = getEmployeeMetricForWeek(employeeId, last.weekEnding, metricKey);
    if (priorValue === null || priorValue === undefined) return null;

    const change = metricDelta(metricKey, currentValue, priorValue);
    const trend = change > 0 ? 'improved' : change < 0 ? 'declined' : 'unchanged';
    const unit = METRICS_REGISTRY[metricKey]?.unit || '';
    const amount = Math.abs(change);
    const display = unit === '%' ? `${amount.toFixed(1)}%` : unit === 'sec' ? `${Math.round(amount)}s` : unit === 'hrs' ? `${amount.toFixed(1)} hrs` : amount.toFixed(1);

    if (trend === 'improved') {
        return `Previously coached on ${METRICS_REGISTRY[metricKey]?.label || metricKey} on ${last.weekEnding}. Performance improved by ${display}. Reinforce progress and encourage consistency.`;
    }
    if (trend === 'unchanged') {
        return `Previously coached on ${METRICS_REGISTRY[metricKey]?.label || metricKey} on ${last.weekEnding}. Performance is steady. Consider a different angle (habit, confidence, or workflow).`;
    }
    return `Previously coached on ${METRICS_REGISTRY[metricKey]?.label || metricKey} on ${last.weekEnding}. Performance declined by ${display}. Consider a supportive reset and barrier removal.`;
}

function getEmployeeMetricForWeek(employeeId, weekKey, metricKey) {
    const week = weeklyData[weekKey] || ytdData[weekKey];
    if (!week || !week.employees) return null;
    const emp = week.employees.find(e => e.name === employeeId);
    if (!emp) return null;
    return emp[metricKey];
}

function detectComplianceFlags(text) {
    if (!text) return [];
    const flags = [];
    const lower = text.toLowerCase();
    const keywords = [
        { key: 'safety', label: 'Safety' },
        { key: 'esh', label: 'ESH' },
        { key: 'abusive', label: 'Abusive Customer' },
        { key: 'harassment', label: 'Harassment' },
        { key: 'threat', label: 'Threat' },
        { key: 'pci', label: 'PCI' },
        { key: 'credit card', label: 'Sensitive Data' },
        { key: 'ssn', label: 'Sensitive Data' },
        { key: 'pii', label: 'Sensitive Data' },
        { key: 'phi', label: 'Sensitive Data' },
        { key: 'hipaa', label: 'Sensitive Data' }
    ];
    keywords.forEach(({ key, label }) => {
        if (lower.includes(key)) flags.push(label);
    });
    return [...new Set(flags)];
}

function logComplianceFlag(entry) {
    try {
        const log = (window.DevCoachModules?.storage?.readStore?.('complianceLog') ?? []);
        log.push(entry);
        window.DevCoachModules?.storage?.saveWithSizeCheck?.('complianceLog', log);
    } catch {
        // no-op
    }
}

function buildConfidenceInsight(employeeData, coachedMetricKeys) {
    if (!employeeData) return null;
    const signals = [];
    if ((employeeData.transfers || 0) > (getMetricTarget('transfers') + 2)) signals.push('high transfers');
    if ((employeeData.holdTime || 0) > (getMetricTarget('holdTime') + 10)) signals.push('elevated hold time');
    if ((employeeData.fcr || 0) < (getMetricTarget('fcr') - 3)) signals.push('lower FCR');
    if (coachedMetricKeys && coachedMetricKeys.length >= 2) signals.push('repeat coaching');

    if (signals.length >= 2) {
        return 'Pattern suggests knowledge hesitation. Recommend job aid review, shadowing, or confidence-building practice instead of metric pressure.';
    }
    return null;
}

function renderSupervisorIntelligence() {
    initializeTrendIntelligence();
    renderTrendIntelligence();
    renderRecognitionIntelligence();
    renderCoachingImpactTracker();
    renderCoachingLoadAwareness();
    renderCoachingPriorityQueue();
    renderComplianceAlerts();
}

var trendIntelligenceListenersAttached = false;
let trendIntelligenceFocusMode = true;
let trendPrioritySnapshot = null;

function setTrendFocusMode(enabled) {
    trendIntelligenceFocusMode = Boolean(enabled);
    const focusBtn = document.getElementById('trendFocusModeBtn');
    if (focusBtn) {
        focusBtn.textContent = trendIntelligenceFocusMode ? '🪄 Focus Mode: On' : '🪄 Focus Mode: Off';
    }

    const secondarySectionIds = [
        'trendVisualizationsContainer',
        'coachingImpactTrackerPanel',
        'coachingLoadOutput',
        'complianceAlertsOutput'
    ];

    secondarySectionIds.forEach(id => {
        const element = document.getElementById(id);
        if (!element) return;
        const card = id === 'coachingImpactTrackerPanel'
            ? element
            : element.closest('div[style*="border: 1px solid #cfe1ff"]');
        if (card) {
            card.style.display = trendIntelligenceFocusMode ? 'none' : 'block';
        }
    });

    const simplePanel = document.getElementById('trendSimpleViewOutput');
    if (simplePanel) {
        simplePanel.style.display = 'block';
    }
}

function renderTrendSimpleView() {
    const container = document.getElementById('trendSimpleViewOutput');
    if (!container) return;

    const goalsSummaryHtml = buildTrendGoalsSummaryHtml();

    const snapshot = trendPrioritySnapshot;
    if (!snapshot) {
        container.innerHTML = `${goalsSummaryHtml}<div style="padding: 12px; border: 1px solid #d7e7ff; border-radius: 8px; background: #f8fbff; color: #546e7a;">Simple View is waiting for trend data. Click Refresh Analysis.</div>`;
        return;
    }

    const topCoach = (snapshot.queue?.coachNow || []).slice(0, 3);
    const topRecognize = (snapshot.queue?.recognizeNow || []).slice(0, 2);
    const modeLabel = snapshot.buckets?.descriptor?.label || 'Current comparison window';
    const scoredCount = snapshot.employeeNamesCount || 0;

    const coachHtml = topCoach.length
        ? topCoach.map(entry => `<li style="margin-bottom: 4px;"><strong>${escapeHtml(entry.name)}</strong> — ${escapeHtml(entry.reason)}</li>`).join('')
        : '<li>No urgent coaching interventions this cycle.</li>';

    const recognizeHtml = topRecognize.length
        ? topRecognize.map(entry => `<li style="margin-bottom: 4px;"><strong>${escapeHtml(entry.name)}</strong> — ${escapeHtml(entry.reason)}</li>`).join('')
        : '<li>No standout recognition callouts this cycle.</li>';

    container.innerHTML = `
        ${goalsSummaryHtml}
        <div style="padding: 14px; border: 1px solid #d7e7ff; border-radius: 8px; background: #f8fbff;">
            <div style="font-weight: 700; color: #2f4f87; margin-bottom: 8px;">🧭 Simple View — This Week’s Priorities</div>
            <div style="color: #546e7a; font-size: 0.9em; margin-bottom: 10px;">${modeLabel} • Team Members Scored: ${scoredCount}</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div style="padding: 10px; border-radius: 6px; background: #fff0f0; border: 1px solid #f3c9c9;">
                    <div style="font-weight: 700; color: var(--red-text); margin-bottom: 6px;">Coach First (Top 3)</div>
                    <ul style="margin: 0; padding-left: 18px; color: var(--text-primary);">${coachHtml}</ul>
                </div>
                <div style="padding: 10px; border-radius: 6px; background: #eef8f0; border: 1px solid #cde6d1;">
                    <div style="font-weight: 700; color: var(--green-text); margin-bottom: 6px;">Recognize Now (Top 2)</div>
                    <ul style="margin: 0; padding-left: 18px; color: var(--text-primary);">${recognizeHtml}</ul>
                </div>
            </div>
        </div>
    `;
}

const TREND_TRACKER_METRICS = window.CORE_PERFORMANCE_METRICS || ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment', 'transfers', 'aht'];

function buildTeamAggregateForPeriod(periodKeys) {
    if (!Array.isArray(periodKeys) || periodKeys.length === 0) return null;

    const surveyBackedMetrics = new Set(['overallExperience', 'cxRepOverall', 'fcr']);
    const weightedSums = {};
    const weightedCounts = {};
    let periodsIncluded = 0;
    const teamFilterContext = getTeamSelectionContext();

    periodKeys.forEach(periodKey => {
        const period = getTrendPeriodRecord(periodKey);
        const employees = (period?.employees || []).filter(emp => isAssociateIncludedByTeamFilter(emp?.name, teamFilterContext));
        if (!employees.length) return;

        periodsIncluded += 1;

        employees.forEach(employee => {
            const totalCalls = parseInt(employee?.totalCalls, 10);
            const surveyTotal = parseInt(employee?.surveyTotal, 10);

            TREND_TRACKER_METRICS.forEach(metricKey => {
                if (surveyBackedMetrics.has(metricKey) && (!Number.isInteger(surveyTotal) || surveyTotal <= 0)) return;

                const value = parseFloat(employee?.[metricKey]);
                if (!Number.isFinite(value)) return;

                const weight = surveyBackedMetrics.has(metricKey)
                    ? surveyTotal
                    : (Number.isInteger(totalCalls) && totalCalls > 0 ? totalCalls : 1);

                if (weight > 0) {
                    weightedSums[metricKey] = (weightedSums[metricKey] || 0) + (value * weight);
                    weightedCounts[metricKey] = (weightedCounts[metricKey] || 0) + weight;
                }
            });
        });
    });

    if (periodsIncluded === 0) return null;

    const aggregate = {
        name: 'Team',
        periodsIncluded,
        periodKeys: [...periodKeys]
    };

    Object.keys(weightedSums).forEach(metricKey => {
        if (weightedCounts[metricKey] > 0) {
            aggregate[metricKey] = weightedSums[metricKey] / weightedCounts[metricKey];
        }
    });

    return aggregate;
}

function summarizeTrackerMetrics(currentAggregate, previousAggregate) {
    if (!currentAggregate || !previousAggregate) return [];

    return TREND_TRACKER_METRICS.map(metricKey => {
        const currentValue = parseFloat(currentAggregate?.[metricKey]);
        const previousValue = parseFloat(previousAggregate?.[metricKey]);
        if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return null;

        return {
            metricKey,
            delta: metricDelta(metricKey, currentValue, previousValue),
            currentValue,
            previousValue,
            label: METRICS_REGISTRY[metricKey]?.label || metricKey
        };
    }).filter(Boolean);
}

function pickTrackerFocusMetric(currentAggregate) {
    if (!currentAggregate) return null;

    return TREND_TRACKER_METRICS.map(metricKey => {
        const currentValue = parseFloat(currentAggregate?.[metricKey]);
        if (!Number.isFinite(currentValue)) return null;

        return {
            metricKey,
            currentValue,
            gap: Math.abs(metricGapToTarget(metricKey, currentValue)),
            meetsTarget: metricMeetsTarget(metricKey, currentValue),
            label: METRICS_REGISTRY[metricKey]?.label || metricKey
        };
    }).filter(Boolean).sort((a, b) => {
        if (a.meetsTarget !== b.meetsTarget) return a.meetsTarget ? 1 : -1;
        return b.gap - a.gap;
    })[0] || null;
}

function formatTrackerDelta(metricKey, delta) {
    const formatted = formatMetricDisplay(metricKey, Math.abs(delta));
    return `${delta >= 0 ? '+' : '-'}${formatted}`;
}

function buildTrendCadenceSummary(periodType, selectedEmployee) {
    const keys = getTrendKeysForPeriodType(periodType);
    const buckets = getTrendComparisonBuckets(keys, periodType);
    if (!buckets.currentKeys.length || !buckets.previousKeys.length) return null;

    const currentAggregate = selectedEmployee
        ? buildEmployeeAggregateForPeriod(selectedEmployee, buckets.currentKeys)
        : buildTeamAggregateForPeriod(buckets.currentKeys);
    const previousAggregate = selectedEmployee
        ? buildEmployeeAggregateForPeriod(selectedEmployee, buckets.previousKeys)
        : buildTeamAggregateForPeriod(buckets.previousKeys);

    if (!currentAggregate || !previousAggregate) return null;

    const metricSummaries = summarizeTrackerMetrics(currentAggregate, previousAggregate);
    if (!metricSummaries.length) return null;

    const topImprovement = metricSummaries.slice().sort((a, b) => b.delta - a.delta)[0] || null;
    const topRisk = metricSummaries.slice().sort((a, b) => a.delta - b.delta)[0] || null;
    const focusMetric = pickTrackerFocusMetric(currentAggregate);

    return {
        descriptor: getTrendPeriodDescriptor(periodType),
        currentLabel: formatTrendBucketLabel(buckets.currentKeys),
        previousLabel: formatTrendBucketLabel(buckets.previousKeys),
        topImprovement,
        topRisk,
        focusMetric
    };
}

function buildTrendCadenceTrackerText() {
    const selectedEmployee = getTrendSelectedEmployee();
    const scopeLabel = selectedEmployee ? selectedEmployee : 'Team';
    const sections = [`Multi-Period Tracker for ${scopeLabel}`];

    ['dod', 'wow', 'mom'].forEach(periodType => {
        const summary = buildTrendCadenceSummary(periodType, selectedEmployee);
        const descriptor = getTrendPeriodDescriptor(periodType);

        sections.push('');
        sections.push(descriptor.shortLabel);

        if (!summary) {
            sections.push('Not enough data yet.');
            return;
        }

        sections.push(`${summary.previousLabel} -> ${summary.currentLabel}`);
        if (summary.topImprovement) {
            sections.push(`Improving: ${summary.topImprovement.label} ${formatTrackerDelta(summary.topImprovement.metricKey, summary.topImprovement.delta)}`);
        }
        if (summary.topRisk) {
            sections.push(`Watch: ${summary.topRisk.label} ${formatTrackerDelta(summary.topRisk.metricKey, summary.topRisk.delta)}`);
        }
        if (summary.focusMetric) {
            sections.push(`Current focus: ${summary.focusMetric.label} at ${formatMetricDisplay(summary.focusMetric.metricKey, summary.focusMetric.currentValue)}`);
        }
    });

    return sections.join('\n');
}

function copyTrendCadenceTracker() {
    const text = buildTrendCadenceTrackerText();
    if (!text.trim()) {
        showToast('No tracker summary available yet.', 2800);
        return;
    }

    copyToClipboard(text, { message: '📋 Tracker summary copied' });
}

function renderTrendCadenceTracker() {
    const container = document.getElementById('trendCadenceTrackerOutput');
    if (!container) return;

    const selectedEmployee = getTrendSelectedEmployee();
    container.innerHTML = ['dod', 'wow', 'mom'].map(periodType => {
        const summary = buildTrendCadenceSummary(periodType, selectedEmployee);
        const descriptor = getTrendPeriodDescriptor(periodType);

        if (!summary) {
            return `<div style="padding: 12px; border: 1px solid #d7e7ff; border-radius: 8px; background: #f8fbff;">
                <div style="font-weight: 700; color: #2f4f87; margin-bottom: 6px;">${descriptor.shortLabel}</div>
                <div style="color: #546e7a; font-size: 0.9em;">Not enough ${descriptor.compareLabel} data yet.</div>
            </div>`;
        }

        const improvingText = summary.topImprovement
            ? `${summary.topImprovement.label} ${formatTrackerDelta(summary.topImprovement.metricKey, summary.topImprovement.delta)}`
            : 'No clear improvement yet';
        const riskText = summary.topRisk
            ? `${summary.topRisk.label} ${formatTrackerDelta(summary.topRisk.metricKey, summary.topRisk.delta)}`
            : 'No clear drop yet';
        const focusText = summary.focusMetric
            ? `${summary.focusMetric.label} at ${formatMetricDisplay(summary.focusMetric.metricKey, summary.focusMetric.currentValue)}`
            : 'No focus metric identified';

        return `<div style="padding: 14px; border: 1px solid #d7e7ff; border-radius: 8px; background: #f8fbff;">
            <div style="display: flex; justify-content: space-between; gap: 10px; align-items: center; margin-bottom: 8px; flex-wrap: wrap;">
                <div style="font-weight: 700; color: #2f4f87;">${summary.descriptor.label}</div>
                <div style="font-size: 0.82em; color: #546e7a;">${escapeHtml(summary.previousLabel)} -> ${escapeHtml(summary.currentLabel)}</div>
            </div>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px;">
                <div style="padding: 10px; border-radius: 6px; background: #eef8f0; border: 1px solid #cde6d1;">
                    <div style="font-weight: 700; color: var(--green-text); margin-bottom: 4px;">Improving</div>
                    <div style="color: var(--text-primary); font-size: 0.9em;">${escapeHtml(improvingText)}</div>
                </div>
                <div style="padding: 10px; border-radius: 6px; background: #fff4e5; border: 1px solid #ffe0b2;">
                    <div style="font-weight: 700; color: #e65100; margin-bottom: 4px;">Watch</div>
                    <div style="color: var(--text-primary); font-size: 0.9em;">${escapeHtml(riskText)}</div>
                </div>
                <div style="padding: 10px; border-radius: 6px; background: #eef3fb; border: 1px solid #c6d8f5;">
                    <div style="font-weight: 700; color: #2f4f87; margin-bottom: 4px;">Current Focus</div>
                    <div style="color: var(--text-primary); font-size: 0.9em;">${escapeHtml(focusText)}</div>
                </div>
            </div>
        </div>`;
    }).join('');
}

function buildTrendGoalsSummaryHtml() {
    const goalItems = [
        ['scheduleAdherence', 'Adherence'],
        ['overallSentiment', 'Overall Sentiment'],
        ['overallExperience', 'OE Top 2'],
        ['fcr', 'FCR'],
        ['aht', 'AHT'],
        ['acw', 'ACW'],
        ['transfers', 'Transfers'],
        ['reliability', 'Reliability']
    ];

    const itemsHtml = goalItems.map(([metricKey, label]) => {
        const target = getMetricTrendTarget(metricKey);
        const formatted = Number.isFinite(target) ? formatMetricDisplay(metricKey, target) : 'n/a';
        return `<li style="margin: 0 0 4px 0;"><strong>${label}:</strong> ${formatted}</li>`;
    }).join('');

    return `
        <div style="margin-bottom: 12px; padding: 12px; border: 1px solid #d9e7ff; border-radius: 8px; background: #f5f9ff;">
            <div style="font-weight: 700; color: #2f4f87; margin-bottom: 6px;">🎯 2026 Goals Snapshot</div>
            <ul style="margin: 0; padding-left: 18px; color: #3f5168; columns: 2; column-gap: 24px;">${itemsHtml}</ul>
        </div>
    `;
}

function buildTrendThisWeekPlanText() {
    const snapshot = trendPrioritySnapshot;
    if (!snapshot) return '';

    const topCoach = (snapshot.queue?.coachNow || []).slice(0, 3);
    const topRecognize = (snapshot.queue?.recognizeNow || []).slice(0, 2);
    const modeLabel = snapshot.buckets?.descriptor?.label || 'Current comparison window';
    const scoredCount = snapshot.employeeNamesCount || 0;

    const lines = [
        'This Week Plan',
        `${modeLabel} • Team Members Scored: ${scoredCount}`,
        '',
        'Coach First (Top 3)'
    ];

    if (topCoach.length) {
        topCoach.forEach((entry, index) => {
            const whyText = Array.isArray(entry.why) && entry.why.length
                ? ` | Why: ${entry.why.slice(0, 3).join(' • ')}`
                : '';
            lines.push(`[ ] ${index + 1}. ${entry.name} — ${entry.reason}${whyText}`);
        });
    } else {
        lines.push('[ ] No urgent coaching interventions this cycle.');
    }

    lines.push('');
    lines.push('Recognize Now (Top 2)');

    if (topRecognize.length) {
        topRecognize.forEach((entry, index) => {
            const whyText = Array.isArray(entry.why) && entry.why.length
                ? ` | Why: ${entry.why.slice(0, 3).join(' • ')}`
                : '';
            lines.push(`[ ] ${index + 1}. ${entry.name} — ${entry.reason}${whyText}`);
        });
    } else {
        lines.push('[ ] No standout recognition callouts this cycle.');
    }

    return lines.join('\n');
}

function copyTrendThisWeekPlan() {
    if (!trendPrioritySnapshot) {
        renderCoachingPriorityQueue();
    }

    const text = buildTrendThisWeekPlanText();
    if (!text) {
        showToast('No trend priorities available yet. Click Refresh Analysis first.', 3200);
        return;
    }

    copyToClipboard(text, { message: '📋 This Week Plan copied' });
}

function getTrendSelectedEmployee() {
    return document.getElementById('trendEmployeeSelector')?.value || '';
}

function syncTrendCadenceQuickButtons() {
    const periodType = document.getElementById('trendPeriodSelector')?.value || 'wow';
    document.querySelectorAll('#trendCadenceQuickSelect .trend-cadence-btn').forEach(btn => {
        const isActive = btn.dataset.period === periodType;
        btn.style.background = isActive ? '#2f4f87' : '#ffffff';
        btn.style.color = isActive ? '#ffffff' : '#2f4f87';
        btn.style.borderColor = isActive ? '#2f4f87' : '#bfd6fb';
        btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

function openTrendDrilldownForAssociate(associateName) {
    const name = String(associateName || '').trim();
    if (!name) return;

    const employeeSelect = document.getElementById('trendEmployeeSelector');
    if (!employeeSelect) return;

    let option = Array.from(employeeSelect.options).find(opt => opt.value === name);
    if (!option) {
        option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        employeeSelect.appendChild(option);
    }

    employeeSelect.value = name;
    renderTrendIntelligence();
    renderTrendVisualizations();
    renderCoachingImpactTracker();
    showToast(`Drilled into ${name}`, 2200);
}

function openTrendTeamSummaryView() {
    const employeeSelect = document.getElementById('trendEmployeeSelector');
    if (!employeeSelect) return;

    employeeSelect.value = '';
    renderTrendIntelligence();
    renderTrendVisualizations();
    renderCoachingImpactTracker();
    showToast('Returned to Team view', 2000);
}

function buildTrendAiExplainPrompt() {
    const selectedEmployee = getTrendSelectedEmployee();
    const keys = getWeeklyKeysSorted();
    const latestKey = keys.length ? keys[keys.length - 1] : null;
    const prevKey = keys.length > 1 ? keys[keys.length - 2] : null;

    if (!selectedEmployee || !latestKey) {
        return '';
    }

    const latestWeek = weeklyData[latestKey];
    const prevWeek = prevKey ? weeklyData[prevKey] : null;
    const current = latestWeek?.employees?.find(e => e.name === selectedEmployee);
    const previous = prevWeek?.employees?.find(e => e.name === selectedEmployee);
    if (!current) return '';

    const metricKeys = ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment', 'transfers', 'aht', 'acw', 'holdTime'];
    const lines = metricKeys.map(metricKey => {
        const metricLabel = METRICS_REGISTRY[metricKey]?.label || metricKey;
        const currentValue = current?.[metricKey];
        const previousValue = previous?.[metricKey];
        if (currentValue === undefined || currentValue === null || currentValue === '') return null;
        const currentDisplay = formatMetricDisplay(metricKey, parseFloat(currentValue));
        const targetDisplay = formatMetricDisplay(metricKey, getMetricTrendTarget(metricKey));
        const trend = previousValue !== undefined && previousValue !== null && previousValue !== ''
            ? metricDelta(metricKey, parseFloat(currentValue), parseFloat(previousValue)).toFixed(1)
            : 'N/A';
        return `- ${metricLabel}: current ${currentDisplay}, target ${targetDisplay}, delta vs prior ${trend}`;
    }).filter(Boolean).join('\n');

    return `You are a performance coach helping a supervisor interpret trends for ${selectedEmployee}.\n\nUse this metric snapshot:\n${lines}\n\nDeliver:\n1) What behavior patterns likely drive results\n2) Top 2 risks and why\n3) Top 2 leverage strengths\n4) One direct coaching conversation opener\n\nKeep it concise, practical, and supervisor-ready.`;
}

function buildTrendAiGoalPrompt() {
    const selectedEmployee = getTrendSelectedEmployee();
    const keys = getWeeklyKeysSorted();
    const latestKey = keys.length ? keys[keys.length - 1] : null;
    const prevKey = keys.length > 1 ? keys[keys.length - 2] : null;

    if (!selectedEmployee || !latestKey) {
        return '';
    }

    const latestWeek = weeklyData[latestKey];
    const prevWeek = prevKey ? weeklyData[prevKey] : null;
    const current = latestWeek?.employees?.find(e => e.name === selectedEmployee);
    const previous = prevWeek?.employees?.find(e => e.name === selectedEmployee);
    if (!current) return '';

    const focusMetric = ['overallSentiment', 'fcr', 'scheduleAdherence', 'transfers', 'aht']
        .map(metricKey => ({
            metricKey,
            value: parseFloat(current?.[metricKey]),
            gap: metricGapToTarget(metricKey, parseFloat(current?.[metricKey]))
        }))
        .filter(item => Number.isFinite(item.value))
        .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))[0];

    if (!focusMetric) return '';

    const previousValue = previous ? parseFloat(previous[focusMetric.metricKey]) : NaN;
    const trendText = Number.isFinite(previousValue)
        ? metricDelta(focusMetric.metricKey, focusMetric.value, previousValue).toFixed(1)
        : 'N/A';

    return `Create one measurable 30-day development goal for ${selectedEmployee}.\n\nFocus metric: ${METRICS_REGISTRY[focusMetric.metricKey]?.label || focusMetric.metricKey}\nCurrent: ${formatMetricDisplay(focusMetric.metricKey, focusMetric.value)}\nTarget: ${formatMetricDisplay(focusMetric.metricKey, getMetricTrendTarget(focusMetric.metricKey))}\nTrend delta vs prior: ${trendText}\n\nOutput required:\n- Goal statement (single sentence)\n- 3 weekly behavior commitments\n- Weekly check-in metric to track\n\nKeep it accountable and realistic for a frontline associate.`;
}

function launchTrendCopilotPrompt(prompt, emptyMessage) {
    if (!prompt) {
        showToast(emptyMessage || 'Select an associate first', 3000);
        return;
    }
    openCopilotWithPrompt(prompt, 'Trend Intelligence Copilot');
}

function computeCoachingImpactForEmployee(employeeName) {
    const history = resolveCoachingHistoryForEmployee(employeeName);
    if (!history.length) return null;

    const keys = getWeeklyKeysSorted();
    if (keys.length < 2) return null;

    const latestKey = keys[keys.length - 1];
    const previousKey = keys[keys.length - 2];
    const latestWeek = weeklyData[latestKey];
    const previousWeek = weeklyData[previousKey];
    const current = latestWeek?.employees?.find(e => e.name === employeeName);
    const previous = previousWeek?.employees?.find(e => e.name === employeeName);
    if (!current || !previous) return null;

    const recent = history.slice(0, 3);
    const recentMetricKeys = Array.from(new Set(recent.flatMap(h => Array.isArray(h.metricsCoached) ? h.metricsCoached : [])));
    if (!recentMetricKeys.length) return null;

    let improved = 0;
    let total = 0;
    let volatilityReduced = 0;

    recentMetricKeys.forEach(metricKey => {
        const currentValue = parseFloat(current[metricKey]);
        const previousValue = parseFloat(previous[metricKey]);
        if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return;

        const delta = metricDelta(metricKey, currentValue, previousValue);
        const improvedMetric = delta > 0;
        if (improvedMetric) improved += 1;
        total += 1;

        const details = getMetricVolatilityDetails(employeeName, metricKey, latestKey, latestWeek?.metadata?.periodType || 'week');
        if (details && !details.isVolatile) volatilityReduced += 1;
    });

    if (total === 0) return null;

    const momentumScore = Math.round((improved / total) * 100);
    const consistencyScore = Math.round((volatilityReduced / total) * 100);
    const goalProgressScore = Math.round(((recentMetricKeys.filter(metricKey => metricMeetsTarget(metricKey, current[metricKey])).length) / total) * 100);

    return {
        employeeName,
        momentumScore,
        consistencyScore,
        goalProgressScore,
        totalTracked: total
    };
}

function renderCoachingImpactTracker() {
    const container = document.getElementById('coachingImpactTrackerOutput');
    if (!container) return;

    const employeeSet = new Set();
    const teamFilterContext = getTeamSelectionContext();
    Object.values(weeklyData).forEach(week => {
        week?.employees?.forEach(emp => {
            if (emp?.name && isAssociateIncludedByTeamFilter(emp.name, teamFilterContext)) {
                employeeSet.add(emp.name);
            }
        });
    });

    const scored = Array.from(employeeSet)
        .map(name => computeCoachingImpactForEmployee(name))
        .filter(Boolean)
        .sort((a, b) => ((b.momentumScore + b.consistencyScore + b.goalProgressScore) - (a.momentumScore + a.consistencyScore + a.goalProgressScore)));

    if (!scored.length) {
        container.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.95em;">No coaching impact data yet. Log coaching sessions to track momentum and outcomes.</div>';
        return;
    }

    const selectedEmployee = getTrendSelectedEmployee();
    const spotlight = selectedEmployee ? scored.find(s => s.employeeName === selectedEmployee) : scored[0];
    const list = selectedEmployee ? [spotlight].filter(Boolean) : scored.slice(0, 5);

    container.innerHTML = list.map(item => `
        <div style="padding: 10px; border: 1px solid #e6eefc; border-radius: 6px; background: #f8fbff;">
            <strong>${escapeHtml(item.employeeName)}</strong><br>
            Momentum: <strong>${item.momentumScore}%</strong> · Consistency: <strong>${item.consistencyScore}%</strong> · Goal Progress: <strong>${item.goalProgressScore}%</strong>
            <div style="color: #546e7a; font-size: 0.88em; margin-top: 4px;">Tracked metrics: ${item.totalTracked}</div>
        </div>
    `).join('');
}

function initializeTrendIntelligence() {
    // Populate employee selector
    const employeeSelect = document.getElementById('trendEmployeeSelector');
    if (employeeSelect) {
        const allEmployees = new Set();
        const teamFilterContext = getTeamSelectionContext();
        for (const weekKey in weeklyData) {
            const week = weeklyData[weekKey];
            if (week.employees && Array.isArray(week.employees)) {
                week.employees.forEach(emp => {
                    if (emp.name && isAssociateIncludedByTeamFilter(emp.name, teamFilterContext)) {
                        allEmployees.add(emp.name);
                    }
                });
            }
        }
        
        // The blank option here is not a "pick someone" prompt: selecting it runs
        // the group analysis. Its label is kept rather than replaced with the
        // shared placeholder, because the shared wording would misdescribe what
        // choosing it does.
        const firstOption = employeeSelect.querySelector('option[value=""]');
        window.DevCoachModules.associatePicker.populateSelect(employeeSelect, Array.from(allEmployees), {
            placeholder: firstOption ? firstOption.textContent : undefined,
            preserveSelection: true
        });
    }

    // Attach event listeners once
    if (!trendIntelligenceListenersAttached) {
        document.getElementById('trendCadenceQuickSelect')?.addEventListener('click', (event) => {
            const button = event.target.closest('.trend-cadence-btn');
            if (!button) return;
            const periodType = button.dataset.period;
            const periodSelect = document.getElementById('trendPeriodSelector');
            if (!periodSelect || !periodType) return;

            periodSelect.value = periodType;
            syncTrendCadenceQuickButtons();
            renderTrendIntelligence();
            renderTrendVisualizations();
        });

        document.getElementById('refreshTrendsBtn')?.addEventListener('click', () => {
            renderTrendIntelligence();
            renderTrendVisualizations();
        });

        document.getElementById('trendPeriodSelector')?.addEventListener('change', () => {
            syncTrendCadenceQuickButtons();
            renderTrendIntelligence();
            renderTrendVisualizations();
        });

        document.getElementById('trendEmployeeSelector')?.addEventListener('change', () => {
            renderTrendIntelligence();
            renderTrendVisualizations();
            renderCoachingImpactTracker();
        });

        document.getElementById('generateTrendCoachingBtn')?.addEventListener('click', generateTrendCoachingEmail);
        document.getElementById('copyTrendWeekPlanBtn')?.addEventListener('click', copyTrendThisWeekPlan);
        document.getElementById('trendFocusModeBtn')?.addEventListener('click', () => {
            setTrendFocusMode(!trendIntelligenceFocusMode);
        });
        document.getElementById('copilotExplainTrendBtn')?.addEventListener('click', () => {
            launchTrendCopilotPrompt(buildTrendAiExplainPrompt(), 'Select an associate to use AI Explain Insight');
        });
        document.getElementById('copilotGoalBtn')?.addEventListener('click', () => {
            launchTrendCopilotPrompt(buildTrendAiGoalPrompt(), 'Select an associate to generate a 30-day goal');
        });
        document.getElementById('copyTrendCadenceBtn')?.addEventListener('click', copyTrendCadenceTracker);
        document.getElementById('trendIntelligenceOutput')?.addEventListener('click', (event) => {
            const backToTeamButton = event.target.closest('.trend-back-to-team-btn');
            if (backToTeamButton) {
                openTrendTeamSummaryView();
                return;
            }

            const button = event.target.closest('.trend-drilldown-btn[data-trend-associate]');
            if (!button) return;
            openTrendDrilldownForAssociate(button.getAttribute('data-trend-associate'));
        });
        trendIntelligenceListenersAttached = true;
    }

    setTrendFocusMode(trendIntelligenceFocusMode);
    syncTrendCadenceQuickButtons();

    // Initial render of visualizations
    renderTrendVisualizations();
}

function renderComplianceAlerts() {
    const container = document.getElementById('complianceAlertsOutput');
    if (!container) return;
    const log = (window.DevCoachModules?.storage?.readStore?.('complianceLog') ?? []);
    const teamFilterContext = getTeamSelectionContext();
    const filteredLog = log.filter(entry => isAssociateIncludedByTeamFilter(entry?.employeeId, teamFilterContext));
    if (!filteredLog.length) {
        container.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.95em;">No compliance flags logged.</div>';
        return;
    }
    const items = filteredLog.slice(-5).reverse().map(entry => {
        return `<div style="padding: 10px; border: 1px solid #f1d5d5; border-radius: 6px; background: #fff7f7;">
            <strong>${escapeHtml(entry.employeeId || 'Unknown')}</strong> • ${escapeHtml(entry.flag || '')} • ${escapeHtml(new Date(entry.timestamp).toLocaleString())}
        </div>`;
    }).join('');
    container.innerHTML = items;
}

function renderCoachingLoadAwareness() {
    const container = document.getElementById('coachingLoadOutput');
    if (!container) return;
    const now = Date.now();
    const thirtyDays = now - THIRTY_DAYS_MS;
    const fourteenDays = now - FOURTEEN_DAYS_MS;

    const noRecent = [];
    const highLoad = [];
    const teamFilterContext = getTeamSelectionContext();

    // Get all unique employees from weekly data
    const allEmployees = new Set();
    Object.values(weeklyData).forEach(week => {
        if (week && week.employees) {
            week.employees.forEach(emp => {
                if (emp.name && isAssociateIncludedByTeamFilter(emp.name, teamFilterContext)) {
                    allEmployees.add(emp.name);
                }
            });
        }
    });

    // Check each employee's coaching history
    allEmployees.forEach(employeeId => {
        const history = resolveCoachingHistoryForEmployee(employeeId);
        if (!history.length) {
            // Never been coached
            noRecent.push(employeeId);
            return;
        }
        const last = history[0];
        if (new Date(last.generatedAt).getTime() < thirtyDays) {
            // Last coaching was over 30 days ago
            noRecent.push(employeeId);
        }
        const recentCount = history.filter(h => new Date(h.generatedAt).getTime() >= fourteenDays).length;
        if (recentCount >= 3) {
            highLoad.push(`${employeeId} (${recentCount} in 14 days)`);
        }
    });

    container.innerHTML = `
        <div style="padding: 10px; border: 1px solid #e6eefc; border-radius: 6px; background: #f8fbff;">
            <strong>Not coached in 30+ days:</strong> ${noRecent.length ? noRecent.map(n => escapeHtml(n)).join(', ') : 'None'}
        </div>
        <div style="padding: 10px; border: 1px solid #e6eefc; border-radius: 6px; background: #f8fbff;">
            <strong>High coaching load:</strong> ${highLoad.length ? highLoad.map(n => escapeHtml(n)).join(', ') : 'None'}
        </div>
    `;
}

async function generateOneOnOnePrep() {
    const output = document.getElementById('oneOnOnePrepOutput');
    if (!output) return;

    const associate = document.getElementById('oneOnOneAssociateSelect')?.value
        || document.getElementById('summaryAssociateSelect')?.value;
    if (!associate) {
        showToast('Select an associate first', 3000);
        return;
    }

    const latestKey = getLatestWeeklyKey();
    const prevKey = getPreviousWeeklyKey(latestKey);
    const latestWeek = latestKey ? weeklyData[latestKey] : null;
    const prevWeek = prevKey ? weeklyData[prevKey] : null;

    const current = latestWeek?.employees?.find(e => e.name === associate);
    const previous = prevWeek?.employees?.find(e => e.name === associate);

    if (!current) {
        output.value = 'No recent weekly data for this associate.';
        return;
    }

    const metricsToUse = window.CORE_PERFORMANCE_METRICS || ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment', 'transfers', 'aht'];
    const wins = metricsToUse.filter(key => metricMeetsTarget(key, current[key])).slice(0, 2);
    const trends = previous ? metricsToUse.map(key => ({
        key,
        delta: metricDelta(key, current[key], previous[key])
    })).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 2) : [];

    const history = resolveCoachingHistoryForEmployee(associate).slice(0, 3);
    const lastCoaching = history.length
        ? history.map(h => `${h.weekEnding || new Date(h.generatedAt).toLocaleDateString()}: ${(h.metricsCoached || []).join(', ') || 'General'}`)
        : ['None in last period'];

    const tips = await loadServerTips();
    const opportunities = metricsToUse
        .filter(key => !metricMeetsTarget(key, current[key]))
        .sort((a, b) => Math.abs(metricGapToTarget(b, current[b])) - Math.abs(metricGapToTarget(a, current[a])));
    const focusMetric = opportunities[0];
    const talkingPoint = focusMetric
        ? selectSmartTip({ employeeId: associate, metricKey: focusMetric, severity: getMetricSeverity(focusMetric, current[focusMetric]), tips: tips[focusMetric] || [] })
        : null;

    const winText = wins.length ? wins.map(key => METRICS_REGISTRY[key]?.label || key).join(', ') : 'No standout wins yet';
    const trendText = trends.length
        ? trends.map(t => `${METRICS_REGISTRY[t.key]?.label || t.key} (${t.delta > 0 ? 'up' : t.delta < 0 ? 'down' : 'flat'})`).join(', ')
        : 'No clear trend changes';

    output.value = `Prep for 1:1 — ${associate}\n` +
        `Key Wins: ${winText}\n` +
        `Current Trends: ${trendText}\n` +
        `Last Coaching Topics: ${lastCoaching.join(' | ')}\n` +
        `Suggested Talking Point: ${talkingPoint || 'Reinforce momentum and ask what support would help this week.'}`;
}

function copyOneOnOnePrep() {
    const output = document.getElementById('oneOnOnePrepOutput');
    if (!output) return;
    copyToClipboard(output.value || '', { message: '📋 1:1 prep copied' });
}

function renderRecognitionIntelligence() {
    const container = document.getElementById('recognitionIntelligenceOutput');
    if (!container) return;

    const latestKey = getLatestWeeklyKey();
    const prevKey = getPreviousWeeklyKey(latestKey);
    if (!latestKey || !prevKey) {
        container.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.95em;">Not enough data for recognition signals.</div>';
        return;
    }

    const latestWeek = weeklyData[latestKey];
    const prevWeek = weeklyData[prevKey];
    if (!latestWeek?.employees || !prevWeek?.employees) {
        container.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.95em;">Not enough data for recognition signals.</div>';
        return;
    }

    const mostImproved = [];
    const recoveryWins = [];
    const quietConsistent = [];
    const teamFilterContext = getTeamSelectionContext();
    const latestFilteredEmployees = latestWeek.employees.filter(emp => isAssociateIncludedByTeamFilter(emp?.name, teamFilterContext));
    const previousByName = new Map(
        prevWeek.employees
            .filter(emp => isAssociateIncludedByTeamFilter(emp?.name, teamFilterContext))
            .map(emp => [emp.name, emp])
    );

    latestFilteredEmployees.forEach(emp => {
        const prevEmp = previousByName.get(emp.name);
        if (!prevEmp) return;

        const sentimentDelta = metricDelta('overallSentiment', emp.overallSentiment, prevEmp.overallSentiment);
        if (sentimentDelta > SENTIMENT_IMPROVEMENT_THRESHOLD) {
            mostImproved.push({ name: emp.name, delta: sentimentDelta });
        }

        const recoveryMetric = (window.CORE_SURVEY_METRICS || ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment']).find(key =>
            !metricMeetsTarget(key, prevEmp[key]) && metricMeetsTarget(key, emp[key])
        );
        if (recoveryMetric) {
            recoveryWins.push(`${escapeHtml(emp.name)} (${METRICS_REGISTRY[recoveryMetric]?.label || recoveryMetric})`);
        }

        const consistent = (window.CORE_SURVEY_METRICS || ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment']).every(key => metricMeetsTarget(key, emp[key]));
        const recentCoaching = resolveCoachingHistoryForEmployee(emp.name).find(h =>
            new Date(h.generatedAt).getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000
        );
        if (consistent && !recentCoaching) {
            quietConsistent.push(emp.name);
        }
    });

    mostImproved.sort((a, b) => b.delta - a.delta);
    const mostImprovedText = mostImproved.length
        ? `${escapeHtml(mostImproved[0].name)} (+${mostImproved[0].delta.toFixed(1)} sentiment)`
        : 'None yet';

    container.innerHTML = `
        <div style="padding: 10px; border: 1px solid #e6eefc; border-radius: 6px; background: #f8fbff;">
            <strong>Most Improved (30 days):</strong> ${mostImprovedText}
        </div>
        <div style="padding: 10px; border: 1px solid #e6eefc; border-radius: 6px; background: #f8fbff;">
            <strong>Recovery Wins:</strong> ${recoveryWins.length ? recoveryWins.join(', ') : 'None'}
        </div>
        <div style="padding: 10px; border: 1px solid #e6eefc; border-radius: 6px; background: #f8fbff;">
            <strong>Quiet Consistency:</strong> ${quietConsistent.length ? quietConsistent.map(n => escapeHtml(n)).join(', ') : 'None'}
        </div>
    `;
}

function renderTrendIntelligence() {
    const container = document.getElementById('trendIntelligenceOutput');
    const modeIndicator = document.getElementById('trendModeIndicator');
    const modeText = document.getElementById('trendModeText');
    const emailBtnText = document.getElementById('trendEmailBtnText');
    
    if (!container) return;

    const selectedEmployee = document.getElementById('trendEmployeeSelector')?.value;
    const periodType = document.getElementById('trendPeriodSelector')?.value || 'wow';
    const periodDescriptor = getTrendPeriodDescriptor(periodType);
    const keys = getTrendKeysForPeriodType(periodType);
    
    if (keys.length < 2) {
        container.innerHTML = `<div style="color: var(--text-secondary); font-size: 0.95em;">Upload at least 2 ${periodDescriptor.compareLabel} periods to see ${periodDescriptor.shortLabel} trends.</div>`;
        const simpleContainer = document.getElementById('trendSimpleViewOutput');
        if (simpleContainer) {
            simpleContainer.innerHTML = `<div style="padding: 12px; border: 1px solid #d7e7ff; border-radius: 8px; background: #f8fbff; color: #546e7a;">Upload at least 2 ${periodDescriptor.compareLabel} periods to unlock Simple View priorities.</div>`;
        }
        if (modeIndicator) modeIndicator.style.display = 'none';
        renderTrendCadenceTracker();
        return;
    }

    // Update mode indicator and button text
    if (modeIndicator && modeText && emailBtnText) {
        if (selectedEmployee) {
            modeIndicator.style.display = 'block';
            modeIndicator.style.background = 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)';
            modeText.textContent = `👤 Individual Coaching Mode (${periodDescriptor.shortLabel}): ${selectedEmployee}`;
            emailBtnText.textContent = '🤖 Generate Individual Coaching Email';
        } else {
            modeIndicator.style.display = 'block';
            modeIndicator.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            modeText.textContent = `📊 Team-Wide Analysis Mode (${periodDescriptor.shortLabel})`;
            emailBtnText.textContent = '📧 Generate Group Email';
        }
    }

    // Render based on mode
    if (selectedEmployee) {
        renderIndividualTrendAnalysis(container, selectedEmployee, keys, periodType);
    } else {
        renderGroupTrendAnalysis(container, keys, periodType);
    }

    renderCoachingPriorityQueue();
    renderTrendSimpleView();
    renderTrendCadenceTracker();
    renderCoachingImpactTracker();
}

function renderTrendVisualizations() {
    const visualContainer = document.getElementById('trendVisualizationsContainer');
    const chartsGrid = document.getElementById('trendChartsGrid');
    if (!visualContainer || !chartsGrid) return;

    const employeeName = document.getElementById('trendEmployeeSelector')?.value;
    const periodType = document.getElementById('trendPeriodSelector')?.value || 'wow';

    if (!employeeName) {
        visualContainer.style.display = 'none';
        return;
    }

    const keys = getTrendKeysForPeriodType(periodType);
    if (keys.length < 2) {
        visualContainer.style.display = 'none';
        return;
    }

    visualContainer.style.display = 'block';

    // Get data for selected employee across periods
    const metricsToShow = window.CORE_PERFORMANCE_METRICS || ['scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht', 'overallSentiment'];
    const trendData = {};

    metricsToShow.forEach(metricKey => {
        trendData[metricKey] = buildTrendSeriesData(metricKey, employeeName, keys, periodType);
    });
    // Create bar charts for each metric
    chartsGrid.innerHTML = '';
    metricsToShow.forEach(metricKey => {
        const metric = METRICS_REGISTRY[metricKey];
        const data = trendData[metricKey];

        if (!data || data.length < 2) return;

        const chartContainer = document.createElement('div');
        chartContainer.style.cssText = 'background: var(--bg-surface); padding: 15px; border-radius: 8px; border: 1px solid var(--border);';

        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'max-height: 250px;';

        chartContainer.appendChild(canvas);
        chartsGrid.appendChild(chartContainer);

        const dataLabelPlugin = {
            id: 'barDataLabels',
            afterDatasetsDraw(chart) {
                const ctx = chart.ctx;
                chart.data.datasets.forEach((dataset, i) => {
                    const meta = chart.getDatasetMeta(i);
                    meta.data.forEach((bar, index) => {
                        const value = dataset.data[index];
                        if (value === null || value === undefined) return;
                        const unit = metric.unit || '';
                        const label = unit === '%' ? value.toFixed(1) + '%'
                            : unit === 'sec' ? Math.round(value) + 's'
                            : unit === 'hrs' ? value.toFixed(1) + 'h'
                            : String(Math.round(value * 10) / 10);
                        ctx.save();
                        ctx.font = 'bold 10px sans-serif';
                        ctx.fillStyle = '#333';
                        ctx.textAlign = 'center';
                        ctx.fillText(label, bar.x, bar.y - 4);
                        ctx.restore();
                    });
                });
            }
        };

        var _existing = typeof Chart.getChart === 'function' ? Chart.getChart(canvas) : null;
        if (_existing) _existing.destroy();

        new Chart(canvas, {
            type: 'bar',
            data: {
                labels: data.map(d => d.label),
                datasets: [{
                    label: metric.label || metricKey,
                    data: data.map(d => d.value),
                    backgroundColor: 'rgba(60, 120, 200, 0.6)',
                    borderColor: 'rgba(60, 120, 200, 1)',
                    borderWidth: 2
                }]
            },
            plugins: [dataLabelPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: true,
                layout: {
                    padding: { top: 16 }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    title: {
                        display: true,
                        text: `${metric.label || metricKey} Trend`,
                        font: { size: 14, weight: 'bold' }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: metric.unit === '%',
                        title: {
                            display: true,
                            text: metric.unit || ''
                        }
                    }
                }
            }
        });
    });
}
window.renderTrendVisualizations = renderTrendVisualizations;

async function generateTrendCoachingEmail() {
    const delegated = window.DevCoachModules?.trendCoachingEmail?.generateTrendCoachingEmail;
    if (typeof delegated !== 'function') {
        showToast('Trend coaching module not available. Refresh and try again.', 3500);
        return;
    }

    await delegated({
        selectedEmployeeName: document.getElementById('trendEmployeeSelector')?.value || '',
        getWeeklyKeysSorted,
        weeklyData,
        formatDateMMDDYYYY,
        loadServerTips,
        metricsRegistry: METRICS_REGISTRY,
        metricMeetsTarget,
        metricDelta,
        formatMetricValue,
        getCenterAverageForWeek,
        getEmployeeNickname,
        isAssociateIncludedByTeamFilter,
        openCopilotWithPrompt,
        showToast
    });
}

async function generateIndividualCoachingEmail(employeeName) {
    const delegated = window.DevCoachModules?.trendCoachingEmail?.generateIndividualCoachingEmail;
    if (typeof delegated !== 'function') {
        showToast('Trend coaching module not available. Refresh and try again.', 3500);
        return;
    }

    await delegated({
        employeeName,
        getWeeklyKeysSorted,
        weeklyData,
        formatDateMMDDYYYY,
        loadServerTips,
        metricsRegistry: METRICS_REGISTRY,
        metricMeetsTarget,
        metricDelta,
        formatMetricValue,
        isAssociateIncludedByTeamFilter,
        getEmployeeNickname,
        openCopilotWithPrompt,
        showToast
    });
}

async function generateGroupCoachingEmail() {
    const delegated = window.DevCoachModules?.trendCoachingEmail?.generateGroupCoachingEmail;
    if (typeof delegated !== 'function') {
        showToast('Trend coaching module not available. Refresh and try again.', 3500);
        return;
    }

    await delegated({
        getWeeklyKeysSorted,
        weeklyData,
        formatDateMMDDYYYY,
        getCenterAverageForWeek,
        loadServerTips,
        metricsRegistry: METRICS_REGISTRY,
        metricMeetsTarget,
        metricDelta,
        formatMetricValue,
        isAssociateIncludedByTeamFilter,
        showToast
    });
}

function buildTodaysFocusData() {
    const latestKey = getLatestWeeklyKey();
    if (!latestKey) return null;
    const prevKey = getPreviousWeeklyKey(latestKey);
    const latestWeek = weeklyData[latestKey];
    const prevWeek = prevKey ? weeklyData[prevKey] : null;
    if (!latestWeek?.employees) return null;

    const teamFilterContext = getTeamSelectionContext();
    const latestEmployees = latestWeek.employees.filter(emp => isAssociateIncludedByTeamFilter(emp?.name, teamFilterContext));
    if (!latestEmployees.length) return null;

    const metricsToUse = ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht'];
    const averages = buildTeamWeightedAverages(latestEmployees, metricsToUse);

    let prevAverages = {};
    metricsToUse.forEach(key => { prevAverages[key] = null; });
    if (prevWeek?.employees) {
        const previousEmployees = getFilteredEmployeesForPeriod(prevWeek, teamFilterContext);
        prevAverages = buildTeamWeightedAverages(previousEmployees, metricsToUse);
    }

    let teamWin = null;
    let focusArea = null;
    let bestScore = -Infinity;
    let worstScore = -Infinity;

    const distribution = {};
    metricsToUse.forEach(key => {
        distribution[key] = { better: 0, worse: 0, total: 0 };
    });

    latestEmployees.forEach(emp => {
        metricsToUse.forEach(key => {
            const avg = averages[key];
            const value = emp[key];
            if (avg === null || value === undefined || value === null || value === '') return;
            distribution[key].total += 1;
            const better = isReverseMetric(key) ? value <= avg : value >= avg;
            if (better) distribution[key].better += 1;
            else distribution[key].worse += 1;
        });
    });

    metricsToUse.forEach(key => {
        const value = averages[key];
        if (value === null) return;
        const improvement = prevAverages[key] !== null && prevAverages[key] !== undefined ? metricDelta(key, value, prevAverages[key]) : 0;
        const ratio = distribution[key].total ? distribution[key].better / distribution[key].total : 0;
        const score = ratio + (improvement > 0 ? 0.5 : 0);
        if (score > bestScore) {
            bestScore = score;
            teamWin = key;
        }

        const focusRatio = distribution[key].total ? distribution[key].worse / distribution[key].total : 0;
        if (focusRatio > worstScore) {
            worstScore = focusRatio;
            focusArea = key;
        }
    });

    const callouts = buildTodaysFocusCallouts(latestEmployees, metricsToUse, averages);

    return {
        latestKey,
        latestWeek,
        averages,
        teamWin,
        focusArea,
        callouts
    };
}

function buildTodaysFocusCallouts(employees, metricsToUse, averages) {
    const scores = (employees || []).map(emp => {
        let wins = 0;
        metricsToUse.forEach(key => {
            const avg = averages[key];
            const value = emp[key];
            if (avg === null || value === undefined || value === null || value === '') return;
            const better = isReverseMetric(key) ? value <= avg : value >= avg;
            if (better) wins += 1;
        });
        return { name: emp.name, wins };
    });

    return scores
        .filter(item => item.wins > 0)
        .sort((a, b) => b.wins - a.wins)
        .slice(0, 3);
}


function generateVerintSummary() {
    const moduleApi = window.DevCoachModules?.copilotPrompt;
    if (!moduleApi?.generateVerintSummary) {
        showToast('Verint Summary module not available. Refresh and try again.', 3500);
        return;
    }

    moduleApi.generateVerintSummary({
        document,
        navigator,
        console,
        alert,
        showToast,
        saveNickname,
        getCoachingHistoryForEmployee,
        getEmployeeNickname
    });
}

function collectIndividualTrendWarningsAndRationale(currentEmp, prevEmp, thirdEmp, periodLabel) {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.collectIndividualTrendWarningsAndRationale) {
        return { warnings: [], rationale: [] };
    }
    return moduleApi.collectIndividualTrendWarningsAndRationale(currentEmp, prevEmp, thirdEmp, periodLabel, {
        metricDelta,
        getTrendDeltaThreshold,
        metricsRegistry: METRICS_REGISTRY
    });
}

function collectIndividualTrendWinsAndRationale(employeeName, currentEmp, prevEmp, periodLabel) {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.collectIndividualTrendWinsAndRationale) {
        return { wins: [], rationale: [] };
    }
    return moduleApi.collectIndividualTrendWinsAndRationale(employeeName, currentEmp, prevEmp, periodLabel, {
        metricDelta,
        metricMeetsTarget,
        metricsRegistry: METRICS_REGISTRY
    });
}

function buildIndividualTrendHeaderHtml(employeeName, descriptor, currentEmp, prevEmp, thirdEmp) {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.buildIndividualTrendHeaderHtml) return '';
    return moduleApi.buildIndividualTrendHeaderHtml(employeeName, descriptor, currentEmp, prevEmp, thirdEmp);
}

function buildIndividualTrendItemsSectionHtml(title, titleColor, itemBorderColor, itemBgColor, items) {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.buildIndividualTrendItemsSectionHtml) return '';
    return moduleApi.buildIndividualTrendItemsSectionHtml(title, titleColor, itemBorderColor, itemBgColor, items);
}

function buildIndividualTrendCoachingImpactHtml(coachingImpact) {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.buildIndividualTrendCoachingImpactHtml) return '';
    return moduleApi.buildIndividualTrendCoachingImpactHtml(coachingImpact);
}

function buildIndividualTrendNoSignalsHtml(employeeName, warnings, wins) {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.buildIndividualTrendNoSignalsHtml) return '';
    return moduleApi.buildIndividualTrendNoSignalsHtml(employeeName, warnings, wins);
}

function renderIndividualTrendAnalysis(container, employeeName, keys, periodType = 'wow') {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.renderIndividualTrendAnalysis) {
        container.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.95em;">Trend Intelligence module not available. Refresh and try again.</div>';
        return;
    }

    moduleApi.renderIndividualTrendAnalysis(container, employeeName, keys, periodType, {
        metricDelta,
        metricMeetsTarget,
        getTrendDeltaThreshold,
        metricsRegistry: METRICS_REGISTRY,
        getTrendComparisonBuckets,
        buildEmployeeAggregateForPeriod,
        calculateCoachingImpact
    });
}

function hasGroupThreePeriodDecline(currentEmp, prevEmp, thirdEmp) {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.hasGroupThreePeriodDecline) return false;
    return moduleApi.hasGroupThreePeriodDecline(currentEmp, prevEmp, thirdEmp, { metricDelta });
}

function hasGroupSuddenDrop(currentEmp, prevEmp) {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.hasGroupSuddenDrop) return false;
    return moduleApi.hasGroupSuddenDrop(currentEmp, prevEmp, { metricDelta });
}

function hasGroupImprovement(currentEmp, prevEmp) {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.hasGroupImprovement) return false;
    return moduleApi.hasGroupImprovement(currentEmp, prevEmp, { metricDelta });
}

function isGroupConsistentPerformer(currentEmp) {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.isGroupConsistentPerformer) return false;
    return moduleApi.isGroupConsistentPerformer(currentEmp, { metricMeetsTarget });
}

function classifyGroupTrendEmployee(teamInsights, employeeName, currentEmp, prevEmp, thirdEmp) {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.classifyGroupTrendEmployee) return;
    moduleApi.classifyGroupTrendEmployee(teamInsights, employeeName, currentEmp, prevEmp, thirdEmp, {
        metricDelta,
        metricMeetsTarget
    });
}

function buildGroupTrendHeaderHtml(buckets) {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.buildGroupTrendHeaderHtml) return '';
    return moduleApi.buildGroupTrendHeaderHtml(buckets);
}

function buildGroupTrendSummaryCardsHtml(teamInsights) {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.buildGroupTrendSummaryCardsHtml) return '';
    return moduleApi.buildGroupTrendSummaryCardsHtml(teamInsights);
}

function buildGroupTrendNamedSectionHtml(title, titleColor, bgColor, borderColor, names) {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.buildGroupTrendNamedSectionHtml) return '';
    return moduleApi.buildGroupTrendNamedSectionHtml(title, titleColor, bgColor, borderColor, names);
}

function renderGroupTrendAnalysis(container, keys, periodType = 'wow') {
    const moduleApi = window.DevCoachModules?.trendIntelligence;
    if (!moduleApi?.renderGroupTrendAnalysis) {
        container.innerHTML = '<div style="color: var(--text-secondary); font-size: 0.95em;">Trend Intelligence module not available. Refresh and try again.</div>';
        return;
    }

    moduleApi.renderGroupTrendAnalysis(container, keys, periodType, {
        metricDelta,
        metricMeetsTarget,
        getTrendComparisonBuckets,
        getEmployeeNamesForPeriod,
        buildEmployeeAggregateForPeriod
    });
}

// ============================================
// EMPLOYEE LIST VIEWER
// ============================================

function renderEmployeesList() {
    const moduleApi = window.DevCoachModules?.employeeList;
    if (!moduleApi?.renderEmployeesList) {
        const container = document.getElementById('employeesList');
        if (container) {
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: var(--text-tertiary);">Employee List module not available. Refresh and try again.</div>';
        }
        return;
    }

    const teamSelectionContext = getTeamSelectionContext();
    const teamSelectionWeek = teamSelectionContext.weekKey;
    const teamSelectionMembers = teamSelectionContext.selectedMembers;

    moduleApi.renderEmployeesList({
        container: document.getElementById('employeesList'),
        weeklyData,
        storagePrefix: STORAGE_PREFIX,
        escapeHtml,
        getEmployeeNickname,
        onSaveName: saveEmployeePreferredName,
        onDeleteEmployee: deleteEmployee,
        teamSelectionWeek,
        teamSelectionMembers,
        supervisorAssignments: getEmployeeSupervisors(),
        onTeamSelectionChange: ({ weekKey, selectedMembers }) => {
            const normalizedWeekKey = String(weekKey || '').trim();
            if (!normalizedWeekKey) return;
            setTeamMembersForWeek(normalizedWeekKey, Array.isArray(selectedMembers) ? selectedMembers : []);
        },
        onSupervisorChange: ({ name, supervisor }) => {
            setEmployeeSupervisor(name, supervisor);
        }
    });
}

function deleteEmployee(employeeName) {
    const moduleApi = window.DevCoachModules?.employeeList;
    if (!moduleApi?.deleteEmployee) return;

    moduleApi.deleteEmployee(employeeName, {
        confirmDelete: (message) => confirm(message),
        weeklyData,
        ytdData,
        storagePrefix: STORAGE_PREFIX,
        saveWeeklyData,
        saveYtdData,
        normalizeTeamMembersForExistingWeeks,
        saveTeamMembers,
        showToast,
        onAfterDelete: () => {
            renderEmployeesList();
            populateDeleteEmployeeYearOptions();
        }
    });
}


// ============================================
// INITIALIZATION
// ============================================

async function initApp() {
    
    installDebugListeners();

    // Dark mode toggle
    (function initDarkMode() {
        var STORAGE_KEY = 'devCoachingTool_theme';
        // bootstrap.js already resolved data-theme before first paint, so this
        // only wires the toggle. Setting the attribute again here would risk
        // drifting from what the stylesheet was rendered against.
        var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
        var btn = document.getElementById('darkModeToggle');
        if (btn) {
            btn.textContent = isDark ? '\u2600\uFE0F' : '\uD83C\uDF19';
            btn.addEventListener('click', function() {
                var current = document.documentElement.getAttribute('data-theme');
                var next = current === 'dark' ? 'light' : 'dark';
                document.documentElement.setAttribute('data-theme', next);
                localStorage.setItem(STORAGE_KEY, next);
                btn.textContent = next === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
            });
        }
    })();

    // Load data from localStorage
    weeklyData = loadWeeklyData();
    ytdData = loadYtdData();
    dailyData = loadDailyData();
    coachingHistory = loadCoachingHistory();
    callListeningLogs = loadCallListeningLogs();
    sentimentPhraseDatabase = loadSentimentPhraseDatabase();
    associateSentimentSnapshots = loadAssociateSentimentSnapshots();
    ensureSentimentPhraseDatabaseDefaults();
    migrateReliabilityCenterAverages();
    cleanupStaleAutoYtds();
    cleanupStaleDuplicatePeriods();
    loadTeamMembers();
    bindTeamFilterChangeHandlers();
    notifyTeamFilterChanged();

    // When local state is empty, wait for auto-restore before first UI render.
    // This avoids intermittent "empty dashboard/rankings until refresh" behavior.
    let restoredFromRepo = false;
    const hadLocalDataAtBoot = Object.keys(weeklyData).length > 0 || Object.keys(ytdData).length > 0;
    if (!hadLocalDataAtBoot) {
        showToast('Checking for synced data...', 3000);
        try {
            restoredFromRepo = await tryAutoRestoreFromRepoBackupOnEmptyState();
        } catch (err) {
            console.error('Auto-restore failed:', err);
        }
    }
    if (restoredFromRepo) {
        // Re-load all in-memory variables from localStorage after restore.
        weeklyData = loadWeeklyData();
        ytdData = loadYtdData();
        dailyData = loadDailyData();
        coachingHistory = loadCoachingHistory();
        callListeningLogs = loadCallListeningLogs();
        sentimentPhraseDatabase = loadSentimentPhraseDatabase();
        associateSentimentSnapshots = loadAssociateSentimentSnapshots();
        loadTeamMembers();
        cleanupStaleAutoYtds();
        cleanupStaleDuplicatePeriods();
        saveYtdData();
        showToast('✅ Restored synced data for this browser profile.', 4000);
        notifyTeamFilterChanged();
    }
    

    // Initialize default coaching tips (first load only)
    // NOTE: typeof guards like this exist because module load order is not guaranteed.
    // Future: use a module-ready event or ensure load order in index.html/bootstrap.js.
    if (typeof initializeDefaultTips === 'function') {
        initializeDefaultTips();
    } else {
        console.warn('initializeDefaultTips is not available; skipping default tip initialization.');
    }
    
    // Initialize event handlers
    initializeEventHandlers();
    initializeKeyboardShortcuts();
    window.DevCoachModules?.selectedAssociate?.initialize();
    enforceRepoAutoSyncEnabled();
    initializeRepoSyncControls();
    bindDiagnosticsCopyAction();
    // Footer quick sync button
    const footerSyncBtn = document.getElementById('footerSyncBtn');
    if (footerSyncBtn) {
        footerSyncBtn.addEventListener('click', async () => {
            const repoSync = window.DevCoachModules?.repoSync;
            const config = repoSync?.loadCallListeningSyncConfig?.();
            if (!config?.isWorkPc) {
                showToast('Sync is disabled. Not marked as Work PC.', 3500);
                return;
            }
            footerSyncBtn.disabled = true;
            footerSyncBtn.textContent = 'Syncing...';
            try {
                await repoSync.syncRepoData('manual footer sync', { force: true, allowDataRegression: true });
                showToast('Sync complete!', 3000);
            } catch (e) {
                showToast('Sync failed: ' + (e.message || e), 4000);
            } finally {
                footerSyncBtn.disabled = false;
                footerSyncBtn.textContent = 'Sync Now';
            }
        });
    }
    installRepoSyncStorageHooks();
    renderCallListeningLastSync();
    
    // Restore last viewed section/sub-section on refresh
    restoreLastViewedSection();
    
    // If we have data, update period/team controls from the final startup snapshot.
    if (Object.keys(weeklyData).length > 0 || Object.keys(ytdData).length > 0) {
        populateDeleteWeekDropdown();
    }
    
    // Restore smart defaults
    restoreSmartDefaults();
    
    // Ensure data is saved before page unload (survives Ctrl+Shift+R).
    // Skip when a repo restore just wrote fresh data straight to localStorage. 
    // otherwise these saves would overwrite it with stale in-memory globals.
    // Only writes stores that actually changed this session.
    //
    // This used to save all seven unconditionally, and it is wired to
    // visibilitychange as well as beforeunload, so alt-tab, minimize and every
    // tab switch re-pushed the entire local state from memory. On a second
    // machine that means a work PC which merely had the tab open overwrites
    // everything the home PC wrote. Saving what did not change is not a
    // harmless extra write; it is the widest way this app loses data.
    function saveEverythingBeforeLeaving() {
        if (window.__skipBeforeunloadSave) return;
        const storage = window.DevCoachModules?.storage;
        const dirty = storage?.isStoreDirty;
        // With no dirty tracking available, fall back to the old behavior
        // rather than silently skipping a save that was needed.
        const changed = (key) => (typeof dirty === 'function' ? dirty(key) : true);

        if (changed('weeklyData')) saveWeeklyData();
        if (changed('ytdData')) saveYtdData();
        if (changed('dailyData')) saveDailyData();
        if (changed('coachingHistory')) saveCoachingHistory();
        if (changed('callListeningLogs')) saveCallListeningLogs();
        if (changed('sentimentPhraseDatabase')) saveSentimentPhraseDatabase();
        if (changed('associateSentimentSnapshots')) saveAssociateSentimentSnapshots();
    }

    window.addEventListener('beforeunload', saveEverythingBeforeLeaving);

    startCloudSyncBackground();

    // After the sync is up, so anything unsent reaches the cloud before a
    // duplicate is removed. Not awaited: it must never delay boot.
    reclaimLocalStorageSpaceAutomatically().catch((error) => {
        console.warn('[reclaim] Skipped:', error?.message || error);
    });

    // beforeunload is the weakest point of the IndexedDB backend and no amount
    // of engineering fixes it: a browser will not hold a page open for a
    // pending transaction, so a write started here can be lost. Two things
    // make that survivable. Writes already happen on mutation, so this handler
    // is a backstop rather than the durability mechanism. And visibilitychange
    // fires reliably where beforeunload does not (tab switches, mobile
    // backgrounding, task-switcher kills), which gives the write a real chance
    // to finish well before the page is actually torn down.
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'hidden') return;
        saveEverythingBeforeLeaving();
        window.DevCoachModules?.idbBackend?.flush?.();
    });
    
    // Auto-sync remains event-driven via data saves/storage updates.
    
    
}

function setAppVersionLabel(statusSuffix = '') {
    const versionEl = document.getElementById('appVersion');
    if (!versionEl) return;
    versionEl.textContent = `Version: ${APP_VERSION}${statusSuffix}`;

    const deployMarkerEl = document.getElementById('deployMarker');
    if (deployMarkerEl) {
        fetch(GITHUB_REPO_API_URL + '/commits/main', { headers: { Accept: 'application/vnd.github.v3+json' } })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data?.sha) {
                    deployMarkerEl.textContent = `Deploy: ${data.sha.slice(0, 7)}`;
                } else {
                    deployMarkerEl.textContent = `Deploy: v${APP_VERSION}`;
                }
            })
            .catch(() => { deployMarkerEl.textContent = `Deploy: v${APP_VERSION}`; });
    }

    const lastSyncFooterEl = document.getElementById('lastSyncFooter');
    if (lastSyncFooterEl) {
        const lastSuccess = loadRepoSyncLastSuccess();
        if (!lastSuccess?.syncedAt) {
            lastSyncFooterEl.textContent = 'Last Sync: none yet';
        }
    }
}

async function bootAppSafely() {
    setAppVersionLabel();
    try {
        await initApp();
        const actionAudit = window.DevCoachModules?.actionRegistry?.report?.();
        window.__appActionAudit = actionAudit || null;
        window.__appBootOk = true;
    } catch (error) {
        window.__appBootOk = false;
        const logger = window.DevCoachModules?.logger;
        if (logger) logger.error('startup', 'Fatal startup error', error);
        else console.error('Fatal startup error:', error);
        try {
            addDebugEntry('startup', error?.message || String(error), {
                stack: error?.stack || null
            });
        } catch (loggingError) {
            console.error('Failed to log startup error:', loggingError);
        }
        setAppVersionLabel(' (startup error)');
        if (document.body) {
            showToast('⚠️ Startup error detected. Open Debug for details.', 6000);
        }
    }
}

// ============================================
// INITIALIZATION TRIGGER
// ============================================

// Boot is triggered via script.js onload handler in index.html to guarantee
// all scripts have fully loaded before initialization runs.

// ===== EXECUTIVE SUMMARY FUNCTIONS =====

// -----------------------------------------------------------------------------
// COACHING EMAIL - WEEKLY CHECK-IN (METRIC-BASED)
// Uses latest uploaded data + coaching tips bank to build a Copilot prompt
// -----------------------------------------------------------------------------

function initializeCoachingEmail() {
    return window.DevCoachModules?.coachingEmail?.initializeCoachingEmail?.();
}

// ============================================
// QUICK CHECK-IN (Teams message: praise + focus)
// ============================================

// This used to be a 214-line generator with its own greeting, intro, win,
// focus and closer pools. A second, weaker implementation of the check-in
// the Weekly Pulse tab already produced. Two pools meant the same associate
// could get two different voices from the same app depending on which tab
// you happened to be standing in, and only one of them was being improved.
//
// The Pulse builder is the real one: it reads the same period comparison the
// Pulse tab shows, and it has the monthly/quarterly/kickoff variants. This is
// now a thin adapter onto it.
async function generateQuickCheckin() {
    const select = document.getElementById('coachingEmployeeSelect');
    const output = document.getElementById('quickCheckinOutput');
    const copyBtn = document.getElementById('copyQuickCheckinBtn');
    if (!select || !output) return;

    const employeeName = (select.value || '').trim();
    if (!employeeName) {
        showToast('Pick an associate first.', 2500);
        return;
    }

    const pulse = window.DevCoachModules?.morningPulse;
    if (!pulse?.generateCheckinMessage || !pulse?.resolveCheckinPeriods) {
        showToast('⚠️ Weekly Pulse module unavailable. Refresh and try again.', 3500);
        return;
    }

    const periods = pulse.resolveCheckinPeriods();
    if (!periods) {
        showToast('Upload a week of data first.', 3000);
        return;
    }

    const message = await pulse.generateCheckinMessage(
        employeeName, periods.latestKey, periods.baselineKey
    );
    if (!message) {
        showToast(`Not enough data to build a check-in for ${employeeName}.`, 3000);
        return;
    }

    output.value = message;
    output.style.display = 'block';
    if (copyBtn) copyBtn.style.display = 'inline-block';

    await copyToClipboard(message, { message: '📋 Quick check-in copied to clipboard' });
}

function bindQuickCheckinHandlers() {
    const genBtn = document.getElementById('generateQuickCheckinBtn');
    const copyBtn = document.getElementById('copyQuickCheckinBtn');
    const output = document.getElementById('quickCheckinOutput');

    if (genBtn) bindElementOnce(genBtn, 'click', generateQuickCheckin);
    if (copyBtn && output) {
        bindElementOnce(copyBtn, 'click', () => {
            copyToClipboard(output.value || '', { button: copyBtn });
        });
    }
}

function getCallListeningEmployeeOptions() {
    const dataEmployees = getYearEndEmployees();
    const logEmployees = Object.keys(callListeningLogs || {});
    return filterAssociateNamesByTeamSelection(Array.from(new Set([...dataEmployees, ...logEmployees]))).sort();
}

function getCallListeningTranscriptForStorage() {
    const raw = (document.getElementById('callListeningTranscript')?.value || '').trim();
    const prepare = window.DevCoachModules?.callTranscript?.prepareForStorage;
    return typeof prepare === 'function' ? prepare(raw) : raw;
}

function getCallListeningDraftFromForm() {
    return {
        employeeName: (document.getElementById('callListeningEmployeeSelect')?.value || '').trim(),
        listenedOn: (document.getElementById('callListeningDate')?.value || '').trim(),
        // Persisted on the entry rather than re-read from the transcript.
        // prepareForStorage rewrites the Verint header into a bracketed summary
        // that extractMetadata cannot parse back, so a saved call had already
        // lost its time and length by the time any prompt asked for them.
        callTime: (document.getElementById('callListeningTime')?.value || '').trim(),
        callReference: (document.getElementById('callListeningReference')?.value || '').trim(),
        transcript: getCallListeningTranscriptForStorage(),
        whatWentWell: (document.getElementById('callListeningStrengths')?.value || '').trim(),
        improvementAreas: (document.getElementById('callListeningImprovements')?.value || '').trim(),
        oscarUrl: (document.getElementById('callListeningOscarUrl')?.value || '').trim(),
        relevantInfo: (document.getElementById('callListeningRelevantInfo')?.value || '').trim(),
        managerNotes: (document.getElementById('callListeningManagerNotes')?.value || '').trim()
    };
}

function validateCallListeningDraft(draft) {
    if (!draft.employeeName) {
        alert('⚠️ Please select an associate first.');
        return false;
    }
    if (!draft.listenedOn) {
        alert('⚠️ Please select a call date.');
        return false;
    }
    if (!draft.whatWentWell && !draft.improvementAreas) {
        alert('⚠️ Add at least one note in what went well or improvement areas.');
        return false;
    }
    return true;
}

function getLatestCallListeningEntry(employeeName) {
    const existing = Array.isArray(callListeningLogs[employeeName]) ? callListeningLogs[employeeName] : [];
    return existing[existing.length - 1] || null;
}

function isSameCallListeningDraftAsEntry(draft, existingEntry) {
    if (!existingEntry) return false;
    return existingEntry.listenedOn === draft.listenedOn
        && (existingEntry.callTime || '') === draft.callTime
        && (existingEntry.callReference || '') === draft.callReference
        && (existingEntry.transcript || '') === draft.transcript
        && (existingEntry.whatWentWell || '') === draft.whatWentWell
        && (existingEntry.improvementAreas || '') === draft.improvementAreas
        && (existingEntry.oscarUrl || '') === draft.oscarUrl
        && (existingEntry.relevantInfo || '') === draft.relevantInfo
        && (existingEntry.managerNotes || '') === draft.managerNotes;
}

/**
 * The form's contents as an entry, without saving it.
 *
 * Copying a Verint note and generating a prompt both used to save a log on the
 * way past. Nothing said so, which is how the same call ended up stored twice
 * under different dates and a supervisor could not account for what was in
 * memory. Reading the form is not a decision to keep it; pressing Save is.
 */
function buildUnsavedCallListeningEntry() {
    const draft = getCallListeningDraftFromForm();
    if (!validateCallListeningDraft(draft)) return null;
    return { id: '', ...draft, createdAt: new Date().toISOString() };
}

function createCallListeningEntry(draft) {
    return {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ...draft,
        createdAt: new Date().toISOString()
    };
}

function appendCallListeningEntry(employeeName, entry) {
    if (!callListeningLogs[employeeName]) {
        callListeningLogs[employeeName] = [];
    }
    callListeningLogs[employeeName].push(entry);
    if (callListeningLogs[employeeName].length > 500) {
        // No cap. The 500 was there for the 5MB localStorage ceiling, and
        // these logs are the record of what was actually said on a call, which
        // is exactly what someone asks about months later.
    }
}

function updateCallListeningStatus(employeeName, listenedOn) {
    const status = document.getElementById('callListeningStatus');
    if (!status) return;
    status.textContent = `Saved call listening log for ${employeeName} (${listenedOn}).`;
    status.style.display = 'block';
}

function upsertCallListeningEntryFromForm(showSavedToast = false) {
    getCallListeningSyncConfigFromUI();
    const draft = getCallListeningDraftFromForm();
    if (!validateCallListeningDraft(draft)) {
        return null;
    }

    const latest = getLatestCallListeningEntry(draft.employeeName);
    const isSameAsLatest = isSameCallListeningDraftAsEntry(draft, latest);

    if (isSameAsLatest) {
        if (showSavedToast) showToast('✅ Call log already saved.', 2500);
        return latest;
    }

    const entry = createCallListeningEntry(draft);
    appendCallListeningEntry(draft.employeeName, entry);

    saveCallListeningLogs();
    renderCallListeningHistoryForSelectedEmployee();
    updateCallListeningStatus(draft.employeeName, draft.listenedOn);

    if (showSavedToast) showToast('✅ Call listening log saved.', 2500);
    return entry;
}

function buildCallListeningQaText(entry) {
    if (!entry?.transcript) return '';
    const analysis = window.DevCoachModules?.callTranscript?.analyzeTranscript?.(entry.transcript, {
        associateName: entry.employeeName
    });
    const qa = scoreCallListeningQa(entry.transcript, entry.employeeName, analysis);
    return window.DevCoachModules?.callQa?.buildQaText?.(qa) || '';
}

function buildCallListeningWordChoiceText(entry) {
    if (!entry?.transcript) return '';
    const analysis = window.DevCoachModules?.callTranscript?.analyzeTranscript?.(entry.transcript, {
        associateName: entry.employeeName
    });
    const scan = scanCallListeningWordChoice(entry.transcript, entry.employeeName, analysis);
    return window.DevCoachModules?.callWordChoice?.buildWordChoiceText?.(scan) || '';
}

function buildCallListeningVerintSummary(entry) {
    if (!entry) return '';
    const qaText = buildCallListeningQaText(entry);
    const wordChoiceText = buildCallListeningWordChoiceText(entry);
    const moment = window.DevCoachModules?.callTranscript?.formatCallMoment?.(entry.listenedOn, entry.callTime);
    const recap = window.DevCoachModules?.callSummary?.buildSummaryText?.(
        buildCallSummary(entry.transcript, entry.employeeName, null, entry),
        { voice: 'supervisor' }
    ) || '';
    return [
        `Call Listening Date: ${entry.listenedOn || ''}${entry.callTime ? ` ${entry.callTime}` : ''}`,
        ...(moment ? [`Call Taken: ${moment}`] : []),
        `Associate: ${entry.employeeName || ''}`,
        `Call Reference: ${entry.callReference || 'N/A'}`,
        ...(recap ? ['', 'Call summary:', recap] : []),
        '',
        'What went well:',
        entry.whatWentWell || 'N/A',
        '',
        'Improvement opportunities:',
        entry.improvementAreas || 'N/A',
        '',
        'Relevant info shared:',
        entry.relevantInfo || 'N/A',
        '',
        'Manager notes:',
        entry.managerNotes || 'N/A',
        ...(qaText ? ['', qaText] : []),
        ...(wordChoiceText ? ['', wordChoiceText] : [])
    ].join('\n');
}

function copyCallListeningVerintSummary(entryId = null) {
    const employeeName = (document.getElementById('callListeningEmployeeSelect')?.value || '').trim();
    let entry = null;

    if (entryId && employeeName) {
        entry = findCallListeningEntryById(employeeName, entryId);
    }
    if (!entry) {
        entry = buildUnsavedCallListeningEntry();
    }
    if (!entry) return;

    const summaryText = buildCallListeningVerintSummary(entry);
    copyToClipboard(summaryText, { message: '📋 Verint call summary copied to clipboard' });
}

function loadCallListeningEntryIntoForm(entryId) {
    const employeeSelect = document.getElementById('callListeningEmployeeSelect');
    const employeeName = (employeeSelect?.value || '').trim();
    if (!employeeName) return;

    const entry = findCallListeningEntryById(employeeName, entryId);
    if (!entry) return;

    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value || '';
    };

    setValue('callListeningDate', entry.listenedOn);
    setValue('callListeningTime', entry.callTime);
    setValue('callListeningReference', entry.callReference);
    setValue('callListeningTranscript', entry.transcript);
    setValue('callListeningStrengths', entry.whatWentWell);
    setValue('callListeningImprovements', entry.improvementAreas);
    setValue('callListeningOscarUrl', entry.oscarUrl);
    setValue('callListeningRelevantInfo', entry.relevantInfo);
    setValue('callListeningManagerNotes', entry.managerNotes);

    // Re-read the call so the recap, the QA answers, the language scan and the
    // metric chips come back with it. The notes are already in the boxes, so
    // the drafting step is deliberately skipped: running it would append a
    // second copy of bullets that were saved with the log.
    const associateName = employeeName || entry.employeeName;
    const analysis = window.DevCoachModules?.callTranscript?.analyzeTranscript?.(entry.transcript || '', {
        associateName
    });
    if (analysis?.ok) {
        renderCallListeningReadPanels(entry.transcript, associateName, analysis);
        const summary = document.getElementById('callTranscriptAnalysisSummary');
        if (summary) {
            summary.textContent = buildCallListeningAnalysisSummary(analysis, associateName);
            summary.style.display = 'block';
        }
    }

    showToast('✅ Loaded saved call log into form.', 2500);
}

function deleteCallListeningEntryById(entryId) {
    const employeeName = (document.getElementById('callListeningEmployeeSelect')?.value || '').trim();
    if (!employeeName || !entryId) return;

    const entries = Array.isArray(callListeningLogs[employeeName]) ? callListeningLogs[employeeName] : [];
    const target = entries.find(entry => entry?.id === entryId);
    if (!target) return;

    const confirmed = confirm(`Delete this call listening entry for ${employeeName} (${target.listenedOn || 'date unknown'})?`);
    if (!confirmed) return;

    callListeningLogs[employeeName] = entries.filter(entry => entry?.id !== entryId);
    if (!callListeningLogs[employeeName].length) {
        delete callListeningLogs[employeeName];
    }

    saveCallListeningLogs(true, 'entry deleted');
    renderCallListeningHistoryForSelectedEmployee();
    showToast('✅ Call listening entry deleted.', 2500);
}

// Drops drafted bullets into a feedback box without clobbering what the
// supervisor already typed.
function mergeCallListeningDraftText(textareaId, draftText) {
    const field = document.getElementById(textareaId);
    if (!field || !draftText) return;

    const existing = field.value.trim();
    field.value = existing ? `${existing}\n${draftText}` : draftText;
}

// A Verint export already carries the call date and who took it, so the
// supervisor should not have to retype either.
function applyCallListeningTranscriptMetadata(meta) {
    const applied = [];
    if (!meta) return applied;

    if (meta.callDate) {
        const dateInput = document.getElementById('callListeningDate');
        if (dateInput && dateInput.value !== meta.callDate) {
            dateInput.value = meta.callDate;
            applied.push(`call date ${meta.callDate}`);
        }
    }

    if (meta.callTime) {
        const timeInput = document.getElementById('callListeningTime');
        const tidy = window.DevCoachModules?.callTranscript?.tidyCallTime?.(meta.callTime) || meta.callTime;
        if (timeInput && timeInput.value.trim() !== tidy) {
            timeInput.value = tidy;
            applied.push(`call time ${tidy}`);
        }
    }

    const employeeSelect = document.getElementById('callListeningEmployeeSelect');
    const matchOption = window.DevCoachModules?.callTranscript?.matchAssociateOption;
    if (meta.advisorDisplayName && employeeSelect && !employeeSelect.value && typeof matchOption === 'function') {
        const options = Array.from(employeeSelect.options).map(option => option.value).filter(Boolean);
        const match = matchOption(options, meta.advisorDisplayName);
        if (match) {
            employeeSelect.value = match;
            renderCallListeningHistoryForSelectedEmployee();
            applied.push(match);
        }
    }

    return applied;
}

// Scores the transcript against the Interaction Review form. Silence is
// measured once by the analyzer and handed over rather than recomputed.
function scoreCallListeningQa(transcript, associateName, analysis) {
    const scorer = window.DevCoachModules?.callQa;
    if (!scorer?.scoreCall || !transcript) return null;

    return scorer.scoreCall(transcript, {
        associateName,
        context: { silenceGaps: analysis?.silenceGaps || [] }
    });
}

function renderCallQaScorecard(transcript, associateName, analysis) {
    const panel = document.getElementById('callQaPanel');
    const results = document.getElementById('callQaResults');
    if (!panel || !results) return null;

    const qa = scoreCallListeningQa(transcript, associateName, analysis);
    const html = qa ? window.DevCoachModules?.callQa?.buildQaHtml?.(qa, escapeHtml) : '';

    if (!html) {
        panel.style.display = 'none';
        return null;
    }

    results.innerHTML = html;
    panel.style.display = 'block';
    return qa;
}

/**
 * The recap of one call. Reuses an analysis where the caller already has one,
 * since summarizing would otherwise re-run the whole rules engine.
 */
function buildCallSummary(transcript, associateName, analysis, entry) {
    const summarizer = window.DevCoachModules?.callSummary;
    if (!summarizer?.summarizeCall || !transcript) return null;

    const summary = summarizer.summarizeCall(transcript, {
        associateName,
        analysis,
        // The stored transcript no longer carries its Verint header, so the
        // date and time come off the entry that does.
        callDate: entry?.listenedOn || '',
        callTime: entry?.callTime || ''
    });
    return summary?.ok ? summary : null;
}

function scanCallListeningWordChoice(transcript, associateName, analysis) {
    const scanner = window.DevCoachModules?.callWordChoice;
    if (!scanner?.scanTranscript || !transcript) return null;

    const scan = scanner.scanTranscript(transcript, { associateName, analysis });
    return scan?.ok ? scan : null;
}

// Rendered in the agent's own voice, because this is the recap that goes to
// them and seeing it as they will read it is the point of showing it here.
function renderCallSummaryPanel(transcript, associateName, analysis) {
    const panel = document.getElementById('callSummaryPanel');
    if (!panel) return null;

    const entry = {
        listenedOn: (document.getElementById('callListeningDate')?.value || '').trim(),
        callTime: (document.getElementById('callListeningTime')?.value || '').trim()
    };
    const summary = buildCallSummary(transcript, associateName, analysis, entry);
    const summarizer = window.DevCoachModules?.callSummary;
    const html = summary ? summarizer?.buildSummaryHtml?.(summary, escapeHtml) : '';

    callMetricSummary = summary;

    panel.innerHTML = html || '';
    panel.style.display = html ? 'block' : 'none';
    return summary;
}

function renderCallWordChoicePanel(transcript, associateName, analysis) {
    const panel = document.getElementById('callWordChoicePanel');
    const results = document.getElementById('callWordChoiceResults');
    if (!panel || !results) return null;

    const scan = scanCallListeningWordChoice(transcript, associateName, analysis);
    const html = scan ? window.DevCoachModules?.callWordChoice?.buildWordChoiceHtml?.(scan, escapeHtml) : '';

    if (!html) {
        panel.style.display = 'none';
        return null;
    }

    results.innerHTML = html;
    panel.style.display = 'block';
    return scan;
}

function copyCallListeningWordChoice() {
    const transcript = (document.getElementById('callListeningTranscript')?.value || '').trim();
    if (!transcript) {
        showToast('⚠️ Paste a call transcript first.', 3000);
        return;
    }

    const associateName = (document.getElementById('callListeningEmployeeSelect')?.value || '').trim();
    const analysis = window.DevCoachModules?.callTranscript?.analyzeTranscript?.(transcript, { associateName });
    const scan = scanCallListeningWordChoice(transcript, associateName, analysis);
    const text = window.DevCoachModules?.callWordChoice?.buildWordChoiceText?.(scan);

    if (!text) {
        showToast('⚠️ No scored phrases came up on this call.', 3000);
        return;
    }

    copyToClipboard(text, { message: '📋 Language read copied to clipboard' });
}

/* ── The metric bridge on the Call Listening page ──
 *
 * Holds the briefs for the call currently on screen so clicking a metric chip
 * is a re-render rather than a rescore of eight transcripts.
 */
let callMetricBriefs = [];
let callMetricSelectedKey = '';
// The calls behind the current briefs, in words, so the prompt can name them.
let callMetricCallMoments = [];
// The recap of the call on screen. Held as the structured summary rather than
// rendered text, because the message needs it worded differently from the
// panel: whatever the message is about to coach in detail is left out of it.
let callMetricSummary = null;

/**
 * The latest weekly period that actually contains this associate.
 *
 * Walked newest first rather than trusting the newest upload, because a rep
 * who was out, or new, is missing from periods either side of them and the
 * bridge would otherwise report no metrics at all for them.
 */
function findLatestPeriodForAssociate(employeeName) {
    if (!employeeName || typeof weeklyData === 'undefined') return null;

    const endDate = (key) => weeklyData[key]?.metadata?.endDate
        || (key.includes('|') ? key.split('|')[1] : key);

    const keys = Object.keys(weeklyData || {})
        .filter(key => (weeklyData[key]?.metadata?.periodType || 'week') === 'week')
        .sort((a, b) => String(endDate(b)).localeCompare(String(endDate(a))));

    for (const key of keys) {
        const period = weeklyData[key];
        const employee = period?.employees?.find(item => item?.name === employeeName);
        if (employee) return { weekKey: key, period, employee };
    }
    return null;
}

/**
 * Which tips this associate has already been sent, so the selector can stop
 * repeating advice that has already had its chance.
 */
function alreadyGivenSuggestionIds(employeeName) {
    const history = (typeof coachingHistory !== 'undefined' ? coachingHistory : {})[employeeName] || [];
    const ids = [];
    history.forEach(entry => {
        (entry?.suggestions || []).forEach(item => {
            if (item?.id) ids.push(item.id);
        });
    });
    return ids;
}

function buildCallMetricBriefs(transcript, associateName, analysis) {
    const bridge = window.DevCoachModules?.callCoachingBridge;
    if (!bridge?.collectFindings || !associateName) return [];

    const bundle = getAssociateMetricBundle(associateName);
    if (!bundle?.allMetrics?.length) return [];

    const wordChoice = scanCallListeningWordChoice(transcript, associateName, analysis);
    const { findings, callMoments } = bridge.collectFindings({
        analysis,
        wordChoice,
        associateName,
        // Passed so a saved copy of the call on screen is recognised as the
        // same call and not counted twice.
        transcript,
        callDate: (document.getElementById('callListeningDate')?.value || '').trim(),
        callTime: (document.getElementById('callListeningTime')?.value || '').trim(),
        history: callListeningLogs?.[associateName] || []
    });
    callMetricCallMoments = callMoments || [];

    const effectiveness = window.DevCoachModules?.coachingOutcomes?.suggestionEffectiveness?.() || {};
    const alreadyGiven = alreadyGivenSuggestionIds(associateName);

    return bridge.metricsInFocus(bundle.allMetrics, findings)
        .map(metric => bridge.buildMetricBrief(metric, { effectiveness, alreadyGiven }));
}

function renderCallMetricBrief() {
    const container = document.getElementById('callMetricBrief');
    const bridge = window.DevCoachModules?.callCoachingBridge;
    if (!container || !bridge) return;

    const brief = callMetricBriefs.find(item => item.metricKey === callMetricSelectedKey);
    container.innerHTML = brief ? bridge.briefHtml(brief, escapeHtml) : '';

    document.querySelectorAll('#callMetricChips .call-metric-chip').forEach(chip => {
        chip.setAttribute('aria-pressed', String(chip.dataset.metricKey === callMetricSelectedKey));
    });
}

function renderCallMetricCoachPanel(transcript, associateName, analysis) {
    const panel = document.getElementById('callMetricCoachPanel');
    const chips = document.getElementById('callMetricChips');
    const status = document.getElementById('callMetricCoachStatus');
    if (!panel || !chips) return;

    // This panel reads the weekly metric data, which the rest of the transcript
    // analysis does not need. A surprise in that data must cost the supervisor
    // the chips, not the QA answers and the drafted feedback they came for.
    try {
        callMetricBriefs = buildCallMetricBriefs(transcript, associateName, analysis);
    } catch (error) {
        logAppError('Metric coach panel failed to build', error, {
            source: 'callListening.metricCoach',
            associateName
        });
        callMetricBriefs = [];
    }

    if (!callMetricBriefs.length) {
        panel.style.display = 'none';
        callMetricSelectedKey = '';
        callMetricCallMoments = [];
        return;
    }

    const bridge = window.DevCoachModules.callCoachingBridge;
    chips.innerHTML = bridge.buttonsHtml(callMetricBriefs, escapeHtml);
    callMetricSelectedKey = callMetricBriefs[0].metricKey;
    panel.style.display = 'block';

    if (status) {
        const reviewed = callMetricBriefs[0].evidence[0]?.callsTotal || 1;
        status.textContent = `Read across ${reviewed} call${reviewed === 1 ? '' : 's'} with a saved transcript. Generating a prompt logs the metric and the tips, so next week's upload can show whether they landed.`;
    }

    renderCallMetricBrief();
}

function handleCallMetricChipClick(event) {
    const chip = event.target.closest('.call-metric-chip');
    if (!chip || !chip.dataset.metricKey) return;
    callMetricSelectedKey = chip.dataset.metricKey;
    renderCallMetricBrief();
}

function getSelectedCallMetricBrief() {
    const brief = callMetricBriefs.find(item => item.metricKey === callMetricSelectedKey);
    if (!brief) {
        showToast('⚠️ Analyze a transcript first, then pick a metric.', 3000);
        return null;
    }
    return brief;
}

function copySelectedCallMetricRead() {
    const brief = getSelectedCallMetricBrief();
    if (!brief) return;

    const lines = [
        brief.headline,
        '',
        'What her calls show:',
        ...brief.evidence.map(finding => `- ${finding.text} Came up ${finding.appearsOn}.${finding.quote ? ` "${finding.quote}"` : ''}`),
        '',
        'What to try:',
        ...brief.tips.map(tip => `- ${tip.text}`)
    ];

    copyToClipboard(lines.join('\n'), { message: '📋 Metric read copied to clipboard' });
}

/**
 * What happened the last time this metric was coached for this associate.
 *
 * The most recent settled verdict, so the message can say whether the last
 * round worked. A pending one is skipped: "we are still waiting on next
 * week's upload" is a sentence for the supervisor, not the associate.
 *
 * The values are formatted here because coaching-outcomes stores raw numbers
 * and the message needs "8:32", not 512.
 */
function findPriorCoachingOutcome(employeeName, metricKey) {
    const outcomes = window.DevCoachModules?.coachingOutcomes?.buildOutcomes?.(employeeName) || [];
    const settled = outcomes
        .filter(outcome => outcome.metricKey === metricKey && outcome.verdict !== 'pending')
        .sort((a, b) => String(b.coachedAt || '').localeCompare(String(a.coachedAt || '')));

    if (!settled.length) return null;

    const outcome = settled[0];
    const label = (value) => (value === null || value === undefined)
        ? ''
        : (typeof formatMetricDisplay === 'function' ? formatMetricDisplay(metricKey, value) : String(value));

    return {
        verdict: outcome.verdict,
        beatTeam: outcome.beatTeam,
        beforeLabel: label(outcome.beforeValue),
        afterLabel: label(outcome.afterValue)
    };
}

/**
 * Writes the message here and drops it straight into the send box.
 *
 * Copilot refuses this sometimes, reading a supervisor coaching their own
 * associate as a request to evaluate a named employee. The app already holds
 * every part of the message, so a refusal should not be able to stop the
 * conversation happening. Same logging as the Copilot path, because the
 * coaching is just as real.
 */
function writeCallMetricMessage() {
    const brief = getSelectedCallMetricBrief();
    if (!brief) return;

    const bridge = window.DevCoachModules.callCoachingBridge;
    const employeeName = (document.getElementById('callListeningEmployeeSelect')?.value || '').trim();
    const preferredName = getEmployeeNickname(employeeName) || employeeName.split(' ')[0] || employeeName;

    // Only enough of the recap to place the call. The associate was on it, so
    // a full recap read as a case file with second person pronouns in it.
    const callLabel = window.DevCoachModules?.callSummary?.buildCallLabel?.(callMetricSummary) || 'call';

    const message = bridge.buildMetricMessage(brief, {
        associateName: employeeName,
        preferredName,
        callMoments: callMetricCallMoments,
        callLabel,
        priorOutcome: findPriorCoachingOutcome(employeeName, brief.metricKey)
    });

    const body = document.getElementById('callListeningOutlookBody');
    const outlookBtn = document.getElementById('generateCallListeningOutlookBtn');
    if (body) {
        body.value = message;
        if (outlookBtn) updateCallListeningOutlookButtonState(body, outlookBtn);
        body.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    recordSelectedCallMetricCoaching(brief, employeeName, false);
    showToast('✍️ Message written. Read it over, edit anything, then generate the email.', 4000);
}

/**
 * Logs that this metric and these suggestions were coached.
 *
 * Called from both the written and the Copilot path, because coaching-outcomes
 * measures what was suggested and it makes no difference to next week's numbers
 * which one drafted the words.
 */
function recordSelectedCallMetricCoaching(brief, employeeName, aiAssisted) {
    const found = findLatestPeriodForAssociate(employeeName);
    recordCoachingEvent({
        employeeId: employeeName,
        weekEnding: found?.period?.metadata?.endDate || '',
        metricsCoached: [brief.metricKey],
        aiAssisted: !!aiAssisted,
        suggestions: brief.tips.map(tip => ({ id: tip.id, metricKey: tip.metricKey, text: tip.text }))
    });
}

/**
 * Builds the Copilot prompt for the selected metric and logs what was
 * suggested.
 *
 * The logging is the point of the whole loop: coaching-outcomes joins these
 * suggestion ids to next week's upload, so the selector can stop offering
 * advice that never moves anything. It records on prompt generation rather
 * than on send, because that is the moment the supervisor commits to this
 * advice, and nothing downstream can observe the send.
 */
function generateCallMetricCoachPrompt() {
    const brief = getSelectedCallMetricBrief();
    if (!brief) return;

    const bridge = window.DevCoachModules.callCoachingBridge;
    const employeeName = (document.getElementById('callListeningEmployeeSelect')?.value || '').trim();
    const preferredName = getEmployeeNickname(employeeName) || employeeName.split(' ')[0] || employeeName;

    const prompt = bridge.buildMetricPrompt(brief, {
        associateName: employeeName,
        preferredName,
        callMoments: callMetricCallMoments
    });

    const promptArea = document.getElementById('callListeningPromptArea');
    if (promptArea) promptArea.value = prompt;

    const handoff = window.DevCoachModules?.callListening?.copyPromptAndOpenCopilot?.({
        prompt,
        button: document.getElementById('generateMetricCoachPromptBtn'),
        openWindow: window.open
    });

    if (!handoff?.ok) {
        showToast('⚠️ Could not open the Copilot flow.', 3500);
        return;
    }

    const outlookSection = document.getElementById('callListeningOutlookSection');
    if (outlookSection) outlookSection.style.display = 'block';

    recordSelectedCallMetricCoaching(brief, employeeName, true);
}

function copyCallListeningQaAnswers() {
    const transcript = (document.getElementById('callListeningTranscript')?.value || '').trim();
    if (!transcript) {
        showToast('⚠️ Paste a call transcript first.', 3000);
        return;
    }

    const analyzer = window.DevCoachModules?.callTranscript;
    const associateName = (document.getElementById('callListeningEmployeeSelect')?.value || '').trim();
    const analysis = analyzer?.analyzeTranscript?.(transcript, { associateName });
    const qa = scoreCallListeningQa(transcript, associateName, analysis);
    const text = window.DevCoachModules?.callQa?.buildQaText?.(qa);

    if (!text) {
        showToast('⚠️ Could not score this transcript.', 3000);
        return;
    }

    copyToClipboard(text, { message: '📋 QA answers copied to clipboard' });
}

/**
 * Every read of the call on screen: the recap, the QA answers, the language
 * scan and the metric chips.
 *
 * Split out because loading a saved call needs all of it and must not touch
 * the feedback boxes. Loading used to restore the fields and stop, so the AHT
 * chips and everything else vanished and the only way back was to press
 * Analyze again, which then appended a second copy of the drafted bullets on
 * top of the ones that were saved.
 */
/**
 * The associate's metric bundle, computed once per read of a call.
 *
 * Three separate things want it: the KPI ordering, the summary line that says
 * which KPIs it ordered around, and the metric chips. Each was calling
 * buildTrendEmailAnalysisBundle for itself, so analyzing one transcript ran
 * analyzeTrendMetrics over every metric three times, volatility lookups
 * included, and three answers that only agree by luck.
 *
 * Cached against the associate and the week it came from, so selecting a
 * different person or uploading a new week gets a fresh read rather than a
 * stale one.
 */
let callMetricBundleCache = null;

function getAssociateMetricBundle(associateName) {
    if (!associateName) return null;

    const found = findLatestPeriodForAssociate(associateName);
    if (!found) return null;

    if (callMetricBundleCache
        && callMetricBundleCache.associateName === associateName
        && callMetricBundleCache.weekKey === found.weekKey) {
        return callMetricBundleCache;
    }

    try {
        const bundle = typeof buildTrendEmailAnalysisBundle === 'function'
            ? buildTrendEmailAnalysisBundle(found.employee, found.weekKey, found.period)
            : null;
        if (!bundle) return null;

        callMetricBundleCache = {
            associateName,
            weekKey: found.weekKey,
            period: found.period,
            allMetrics: bundle.allMetrics || [],
            missedMetricKeys: (bundle.allMetrics || [])
                .filter(metric => !metric.meetsTarget)
                .map(metric => metric.metricKey)
        };
        return callMetricBundleCache;
    } catch (error) {
        logAppError('Could not read KPIs for call feedback', error, {
            source: 'callListening.kpiOrder',
            associateName
        });
        return null;
    }
}

/**
 * The KPIs this associate is currently missing, or an empty list when there is
 * no weekly data for them to be missing anything in.
 */
function missedMetricKeysForAssociate(associateName) {
    return getAssociateMetricBundle(associateName)?.missedMetricKeys || [];
}

/**
 * Reorders the drafted feedback in place so KPI relevant points lead.
 *
 * In place because buildStrengthsDraft and buildImprovementsDraft read the
 * arrays straight off the analysis, and because the capped lists and the full
 * ones both have to move together or the email and the panels disagree about
 * what mattered.
 */
function prioritizeCallAnalysisForAssociate(analysis, associateName) {
    const bridge = window.DevCoachModules?.callCoachingBridge;
    if (!bridge?.prioritizeByMetrics || !analysis?.ok) return [];

    const missed = missedMetricKeysForAssociate(associateName);
    if (!missed.length) return [];

    analysis.allImprovements = bridge.prioritizeByMetrics(analysis.allImprovements, missed);
    analysis.improvements = analysis.allImprovements.slice(0, analysis.improvements.length);

    return bridge.missedMetricsCovered(analysis.improvements, missed);
}

/**
 * The one line summary, plus which of the associate's KPIs the feedback was
 * ordered around. Said out loud because a reordering nobody can see is
 * indistinguishable from a random one.
 */
function buildCallListeningAnalysisSummary(analysis, associateName) {
    const analyzer = window.DevCoachModules?.callTranscript;
    const base = analyzer?.buildAnalysisSummary?.(analysis) || '';
    const bridge = window.DevCoachModules?.callCoachingBridge;
    if (!bridge?.missedMetricsCovered) return base;

    const covered = bridge.missedMetricsCovered(
        analysis?.improvements,
        missedMetricKeysForAssociate(associateName)
    );
    if (!covered.length) return base;

    const labels = covered
        .map(key => (window.METRICS_REGISTRY || {})[key]?.label || key)
        .join(', ');
    return `${base} Ordered for the KPIs ${associateName} is missing: ${labels}.`;
}

function renderCallListeningReadPanels(transcript, associateName, analysis) {
    renderCallSummaryPanel(transcript, associateName, analysis);
    renderCallQaScorecard(transcript, associateName, analysis);
    renderCallWordChoicePanel(transcript, associateName, analysis);
    renderCallMetricCoachPanel(transcript, associateName, analysis);
}

function analyzeCallListeningTranscript() {
    const transcriptField = document.getElementById('callListeningTranscript');
    const summary = document.getElementById('callTranscriptAnalysisSummary');
    const transcript = (transcriptField?.value || '').trim();

    if (!transcript) {
        showToast('⚠️ Paste a call transcript first.', 3000);
        return;
    }

    const analyzer = window.DevCoachModules?.callTranscript;
    if (!analyzer?.analyzeTranscript) {
        showToast('⚠️ Call Transcript module is unavailable. Refresh and try again.', 3500);
        return;
    }

    const associateName = (document.getElementById('callListeningEmployeeSelect')?.value || '').trim();
    const analysis = analyzer.analyzeTranscript(transcript, { associateName });
    if (!analysis.ok) {
        showToast('⚠️ Nothing readable in that transcript.', 3000);
        return;
    }

    const applied = applyCallListeningTranscriptMetadata(analysis.meta);
    const forName = associateName || analysis.meta?.advisorDisplayName;

    // Ordered for this associate before the bullets are drafted, so the
    // feedback leads with what moves the KPIs they are actually missing rather
    // than with whatever is most serious in general.
    prioritizeCallAnalysisForAssociate(analysis, forName);

    mergeCallListeningDraftText('callListeningStrengths', analyzer.buildStrengthsDraft(analysis));
    mergeCallListeningDraftText('callListeningImprovements', analyzer.buildImprovementsDraft(analysis));

    renderCallListeningReadPanels(transcript, forName, analysis);

    if (summary) {
        summary.textContent = buildCallListeningAnalysisSummary(analysis, forName);
        summary.style.display = 'block';
    }

    showToast(
        applied.length
            ? `✅ Draft feedback written. Filled in ${applied.join(' and ')} from the transcript.`
            : '✅ Draft feedback written from the transcript. Edit it before you send.',
        3500
    );
}

function clearCallListeningTranscript() {
    const transcriptField = document.getElementById('callListeningTranscript');
    if (!transcriptField || !transcriptField.value.trim()) return;
    if (!confirm('Clear the pasted transcript? Your feedback notes stay as they are.')) return;

    transcriptField.value = '';
    const summary = document.getElementById('callTranscriptAnalysisSummary');
    if (summary) summary.style.display = 'none';
}

function buildCallListeningPrompt(entry) {
    const preferredName = getEmployeeNickname(entry.employeeName) || entry.employeeName.split(' ')[0] || entry.employeeName;
    const delegated = window.DevCoachModules?.callListening?.buildPrompt?.(entry, preferredName);
    return delegated || '';
}

function generateCallListeningPromptAndCopy() {
    const entry = buildUnsavedCallListeningEntry();
    if (!entry) return;

    const promptArea = document.getElementById('callListeningPromptArea');
    const button = document.getElementById('generateCallListeningPromptBtn');
    const outlookSection = document.getElementById('callListeningOutlookSection');

    if (!promptArea) return;
    const prompt = buildCallListeningPrompt(entry);
    if (!prompt) {
        showToast('⚠️ Call Listening module is unavailable. Refresh and try again.', 3500);
        return;
    }
    promptArea.value = prompt;

    const delegatedResult = window.DevCoachModules?.callListening?.copyPromptAndOpenCopilot?.({
        prompt,
        button,
        showToast,
        alertFn: alert,
        openWindow: window.open
    });
    if (delegatedResult?.ok) {
        if (outlookSection) {
            outlookSection.style.display = 'block';
        }
        return;
    }

    showToast('⚠️ Call Listening module could not open Copilot flow.', 3500);
}

/**
 * Fills the To: field for the selected associate and says where it came from.
 *
 * An address the supervisor has already typed is never overwritten, because
 * that typed value is the correction the pattern needs.
 */
function refreshCallListeningRecipient() {
    const input = document.getElementById('callListeningRecipient');
    const note = document.getElementById('callListeningRecipientNote');
    if (!input) return;

    const employeeName = (document.getElementById('callListeningEmployeeSelect')?.value || '').trim();
    const utils = window.DevCoachModules?.sharedUtils;

    if (!employeeName) {
        if (note) note.textContent = 'Pick an associate and their address fills in here.';
        return;
    }

    const overrides = utils?.getAssociateEmailOverrides?.() || {};
    const resolved = utils?.resolveAssociateEmail?.(employeeName) || '';

    if (!input.value.trim() || input.dataset.autofilledFor !== employeeName) {
        input.value = resolved;
        input.dataset.autofilledFor = employeeName;
    }

    if (!note) return;
    if (!resolved) {
        note.textContent = 'No address pattern set yet. Type one here, or set the pattern once in Settings > Team Members.';
    } else if (overrides[employeeName]) {
        note.textContent = 'Saved address for this associate.';
    } else {
        note.textContent = 'Built from your address pattern. Correct it here if it is wrong and it will be remembered.';
    }
}

function generateCallListeningOutlookEmail() {
    const employeeName = (document.getElementById('callListeningEmployeeSelect')?.value || '').trim();
    const callDate = (document.getElementById('callListeningDate')?.value || '').trim();
    const bodyText = (document.getElementById('callListeningOutlookBody')?.value || '').trim();
    const to = (document.getElementById('callListeningRecipient')?.value || '').trim();

    const delegatedResult = window.DevCoachModules?.callListening?.generateOutlookDraft?.({
        employeeName,
        callDate,
        bodyText,
        to,
        getEmployeeNickname,
        showToast,
        onError: (error) => console.error('Error opening Outlook draft from call listening:', error)
    });
    if (delegatedResult?.ok || delegatedResult?.reason === 'missing-body') {
        return;
    }
    showToast('⚠️ Call Listening module is unavailable. Refresh and try again.', 3500);
}

function buildCallListeningHistorySummaryText(employeeName, entryCount) {
    const delegated = window.DevCoachModules?.callListening?.buildHistorySummaryText?.(employeeName, entryCount);
    return delegated || `${entryCount} saved call listening log${entryCount === 1 ? '' : 's'} for ${employeeName}.`;
}

function buildCallListeningHistoryItemHtml(entry) {
    const delegated = window.DevCoachModules?.callListening?.buildHistoryItemHtml?.(entry, escapeHtml);
    if (delegated) return delegated;
    return '<li>Unable to render call listening history item.</li>';
}

function resolveCallListeningHistoryContext() {
    const employeeName = (document.getElementById('callListeningEmployeeSelect')?.value || '').trim();
    const summary = document.getElementById('callListeningHistorySummary');
    const list = document.getElementById('callListeningHistoryList');
    return { employeeName, summary, list };
}

function dispatchCallListeningHistoryAction(action, entryId) {
    if (!entryId) return;
    if (action === 'load') {
        loadCallListeningEntryIntoForm(entryId);
    } else if (action === 'copy-verint') {
        copyCallListeningVerintSummary(entryId);
    } else if (action === 'delete') {
        deleteCallListeningEntryById(entryId);
    }
}

// Rescoring every stored transcript is not free, so it only runs when the
// history for one associate is on screen.
/**
 * What repeats across this associate's calls.
 *
 * The counting comes from callCoachingBridge, which already scores this exact
 * set of transcripts for the metric chips. call-trends used to score them
 * again for its own tallies, so one render ran both engines over eight
 * transcripts twice and produced two sets of numbers that agreed only while
 * both were maintained.
 */
function renderCallListeningTrends(employeeName) {
    const container = document.getElementById('callListeningTrends');
    if (!container) return;

    const trends = window.DevCoachModules?.callTrends;
    const bridge = window.DevCoachModules?.callCoachingBridge;
    const entries = employeeName ? getCallListeningEntriesForEmployee(employeeName) : [];
    const withTranscript = entries.filter(entry => entry?.transcript);

    if (!trends?.buildTrendHtml || !bridge?.collectFindings || withTranscript.length < 2) {
        container.style.display = 'none';
        container.innerHTML = '';
        return;
    }

    const summary = bridge.collectFindings({ associateName: employeeName, history: entries });
    const html = trends.buildTrendHtml(summary, escapeHtml);
    container.innerHTML = html;
    container.style.display = html ? 'block' : 'none';
}

/**
 * Whether the last coaching moved anything, shown where the coaching happens.
 *
 * coaching-outcomes has measured this since it was written and only ever
 * rendered it on the Coaching page. So the answer to "did what I said last
 * time work" was two clicks away from the place you decide what to say next,
 * which is the one moment it is worth knowing.
 */
function renderCallListeningOutcomes(employeeName) {
    window.DevCoachModules?.coachingOutcomes?.renderForEmployee?.(
        document.getElementById('callOutcomesPanel'),
        employeeName
    );
}

function renderCallListeningHistoryForSelectedEmployee() {
    const { employeeName, summary, list } = resolveCallListeningHistoryContext();
    if (!summary || !list) return;

    renderCallListeningTrends(employeeName);
    renderCallListeningOutcomes(employeeName);

    if (!employeeName) {
        summary.textContent = 'Select an associate to view call listening history.';
        list.innerHTML = '';
        return;
    }

    const entries = getCallListeningEntriesForEmployee(employeeName);
    summary.textContent = buildCallListeningHistorySummaryText(employeeName, entries.length);

    if (!entries.length) {
        list.innerHTML = '<li>No call listening logs saved yet for this associate.</li>';
        return;
    }

    list.innerHTML = entries.slice(0, 50).map(buildCallListeningHistoryItemHtml).join('');
}

/* ── Everything saved, for everyone ──
 *
 * The per-associate history above answers "what have I logged for Esther".
 * This answers "what is this app actually holding", which is a different and
 * more important question, because generating a prompt and copying a Verint
 * note both save a log without saying so. A call you do not remember saving
 * still feeds the coaching, so it has to be visible and removable.
 */

function collectAllSavedCalls() {
    const logs = (typeof callListeningLogs !== 'undefined' ? callListeningLogs : {}) || {};
    const bridge = window.DevCoachModules?.callCoachingBridge;

    return Object.keys(logs)
        .sort((a, b) => a.localeCompare(b))
        .map(employeeName => {
            const entries = (Array.isArray(logs[employeeName]) ? logs[employeeName] : [])
                .slice()
                .sort((a, b) => String(b.listenedOn || '').localeCompare(String(a.listenedOn || '')));

            // Flagged rather than hidden, so a duplicate that was inflating the
            // counts is something you can see and delete.
            const seen = new Set();
            const rows = entries.map(entry => {
                const fingerprint = bridge?.callFingerprint?.(entry.transcript) || '';
                const duplicate = Boolean(fingerprint) && seen.has(fingerprint);
                if (fingerprint) seen.add(fingerprint);
                return { entry, duplicate };
            });

            return { employeeName, rows };
        })
        .filter(group => group.rows.length);
}

// Which rows are open. Keyed by employee and entry id together, because entry
// ids are only unique inside one associate's log.
const expandedSavedCalls = new Set();

function savedCallKey(employeeName, entryId) {
    return `${employeeName}|${entryId}`;
}

function findSavedCall(employeeName, entryId) {
    const entries = Array.isArray(callListeningLogs?.[employeeName]) ? callListeningLogs[employeeName] : [];
    return entries.find(entry => entry?.id === entryId) || null;
}

/**
 * What one saved call actually holds, read only.
 *
 * Built on expand rather than up front: rescoring a transcript is cheap for one
 * call and wasteful for forty, and most rows are never opened.
 *
 * Deliberately does not touch the form. Loading a call into the form is the
 * other button on the row, and mixing the two would mean glancing at an old
 * call quietly replaced whatever was being worked on.
 */
function buildSavedCallDetailHtml(employeeName, entry) {
    const analyzer = window.DevCoachModules?.callTranscript;
    const notes = [
        ['What went well', entry.whatWentWell],
        ['Improvement opportunities', entry.improvementAreas],
        ['Relevant info shared', entry.relevantInfo],
        ['Manager notes', entry.managerNotes],
        ['Oscar / knowledge base', entry.oscarUrl]
    ].filter(([, value]) => String(value || '').trim());

    const notesHtml = notes.length
        ? notes.map(([label, value]) => `<div class="saved-call-note">
                <div class="saved-call-note-label">${escapeHtml(label)}</div>
                <div>${escapeHtml(value)}</div>
            </div>`).join('')
        : '<div class="call-qa-detail">No notes were saved with this call.</div>';

    let readHtml = '';
    let summaryHtml = '';
    let trimmedHtml = '';
    let transcriptHtml = '<div class="call-qa-detail">No transcript was saved with this call, so it cannot be re-read.</div>';

    // A call saved under the old 8000 character cap lost its ending
    // permanently, and no change to the cap brings it back. Saying so beats
    // letting a supervisor wonder why a 39 minute call stops at 15:46.
    if (/\[transcript truncated/.test(String(entry.transcript || ''))) {
        trimmedHtml = '<div class="call-note call-note-warn" style="margin-bottom: var(--space-2);">'
            + 'This transcript was cut short by an older storage limit, so the end of the call is not here and cannot be recovered. '
            + 'Paste the original into the form and save it again to keep the whole call.'
            + '</div>';
    }

    if (entry.transcript && analyzer?.analyzeTranscript) {
        const analysis = analyzer.analyzeTranscript(entry.transcript, { associateName: employeeName });
        if (analysis?.ok) {
            const strengths = (analysis.allStrengths || []).length;
            const issues = (analysis.allImprovements || []).length;
            readHtml = `<div class="call-qa-detail">Re-read now: ${strengths} strength${strengths === 1 ? '' : 's'}, ${issues} coaching point${issues === 1 ? '' : 's'}.</div>`;
        }
        // Third person here, because this view is the supervisor reading about
        // somebody else. The same recap goes to the associate as "you".
        summaryHtml = window.DevCoachModules?.callSummary?.buildSummaryHtml?.(
            buildCallSummary(entry.transcript, employeeName, analysis, entry),
            escapeHtml,
            { voice: 'supervisor' }
        ) || '';
        transcriptHtml = `<pre class="saved-call-transcript">${escapeHtml(entry.transcript)}</pre>`;
    }

    return `<div class="saved-call-detail">
        ${summaryHtml}
        ${notesHtml}
        ${readHtml}
        <div class="saved-call-note-label" style="margin-top: var(--space-3);">Transcript as saved</div>
        ${trimmedHtml}
        ${transcriptHtml}
    </div>`;
}

/**
 * How much room the saved calls take, in words.
 *
 * Measured rather than estimated, because the transcripts are most of it and
 * they vary from a two minute call to a forty minute one. Serializing to
 * measure costs about 9ms at 300 calls, which is affordable in a panel that
 * only renders when it is opened.
 *
 * Shown because it only ever grows, and because every sync ships the whole of
 * it regardless of what changed. Invisible growth is the kind that becomes a
 * surprise.
 */
function describeSavedCallsSize() {
    try {
        const bytes = new Blob([JSON.stringify(callListeningLogs || {})]).size;
        if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB stored`;
        return `${(bytes / 1024 / 1024).toFixed(1)}MB stored`;
    } catch (error) {
        return '';
    }
}

function renderAllSavedCalls() {
    const container = document.getElementById('allSavedCalls');
    const summary = document.getElementById('allSavedCallsSummary');
    if (!container || !summary) return;

    const groups = collectAllSavedCalls();
    const total = groups.reduce((sum, group) => sum + group.rows.length, 0);
    const duplicates = groups.reduce(
        (sum, group) => sum + group.rows.filter(row => row.duplicate).length, 0
    );

    if (!total) {
        summary.textContent = 'Nothing saved yet. No calls are feeding the coaching.';
        container.innerHTML = '';
        return;
    }

    // The size is shown because it only ever grows and every sync ships the
    // whole of it. Invisible growth is the kind that becomes a surprise; a
    // number on the screen is one Scott can watch and act on.
    const stored = describeSavedCallsSize();

    summary.textContent = `${total} saved call${total === 1 ? '' : 's'} across ${groups.length} associate${groups.length === 1 ? '' : 's'}${stored ? `, ${stored}` : ''}.`
        + (duplicates ? ` ${duplicates} look${duplicates === 1 ? 's' : ''} like the same call saved more than once.` : '');

    const describe = window.DevCoachModules?.callListening?.describeCallMoment;

    container.innerHTML = groups.map(group => {
        const rows = group.rows.map(({ entry, duplicate }) => {
            const moment = (typeof describe === 'function' ? describe(entry) : '') || entry.listenedOn || 'date unknown';
            const bits = [
                entry.callReference ? `Ref ${entry.callReference}` : '',
                entry.transcript ? 'transcript saved' : 'no transcript',
                duplicate ? 'looks like a duplicate' : ''
            ].filter(Boolean).join(' • ');

            const key = savedCallKey(group.employeeName, entry.id || '');
            const open = expandedSavedCalls.has(key);

            return `<li class="saved-call-row${duplicate ? ' saved-call-duplicate' : ''}">
                <div class="saved-call-line">
                    <button type="button" class="saved-call-remove" title="Delete this call from memory"
                        data-saved-employee="${escapeHtml(group.employeeName)}"
                        data-saved-id="${escapeHtml(entry.id || '')}">✕</button>
                    <button type="button" class="saved-call-open" aria-expanded="${open}"
                        data-saved-open-employee="${escapeHtml(group.employeeName)}"
                        data-saved-open-id="${escapeHtml(entry.id || '')}">
                        <span class="saved-call-caret">${open ? '▾' : '▸'}</span>
                        <span class="saved-call-when">${escapeHtml(moment)}</span>
                        <span class="call-qa-detail">${escapeHtml(bits)}</span>
                    </button>
                </div>
                ${open ? buildSavedCallDetailHtml(group.employeeName, entry) : ''}
            </li>`;
        }).join('');

        return `<div class="saved-call-group">
            <div class="call-trend-title">${escapeHtml(group.employeeName)} (${group.rows.length})</div>
            <ul class="saved-call-list">${rows}</ul>
        </div>`;
    }).join('');
}

function toggleAllSavedCalls() {
    const container = document.getElementById('allSavedCalls');
    const button = document.getElementById('showAllSavedCallsBtn');
    if (!container) return;

    const opening = container.style.display === 'none';
    if (opening) renderAllSavedCalls();
    container.style.display = opening ? 'block' : 'none';
    if (button) button.textContent = opening ? '🔎 Hide Everything Saved' : '🔎 Show Everything Saved';
}

function deleteSavedCall(employeeName, entryId) {
    if (!employeeName || !entryId) return;

    const entries = Array.isArray(callListeningLogs[employeeName]) ? callListeningLogs[employeeName] : [];
    const target = entries.find(entry => entry?.id === entryId);
    if (!target) return;

    const describe = window.DevCoachModules?.callListening?.describeCallMoment;
    const moment = (typeof describe === 'function' ? describe(target) : '') || target.listenedOn || 'date unknown';
    if (!confirm(`Delete the ${employeeName} call from ${moment}? This removes it from the coaching for good.`)) return;

    callListeningLogs[employeeName] = entries.filter(entry => entry?.id !== entryId);
    if (!callListeningLogs[employeeName].length) {
        delete callListeningLogs[employeeName];
    }

    saveCallListeningLogs(true, 'saved call deleted');
    renderAllSavedCalls();
    renderCallListeningHistoryForSelectedEmployee();
    showToast('✅ Call deleted from memory.', 2500);
}

function toggleSavedCall(employeeName, entryId) {
    const key = savedCallKey(employeeName, entryId);
    if (expandedSavedCalls.has(key)) expandedSavedCalls.delete(key);
    else expandedSavedCalls.add(key);
    renderAllSavedCalls();
}

/**
 * Puts an old call back in the form to work on.
 *
 * Confirmed first when the form already holds something, because the form is
 * where unsent work lives and loading over it is not undoable.
 */
function loadSavedCallIntoForm(employeeName, entryId) {
    const entry = findSavedCall(employeeName, entryId);
    if (!entry) return false;

    const select = document.getElementById('callListeningEmployeeSelect');
    const transcriptField = document.getElementById('callListeningTranscript');
    const hasWork = String(transcriptField?.value || '').trim()
        || String(document.getElementById('callListeningStrengths')?.value || '').trim()
        || String(document.getElementById('callListeningImprovements')?.value || '').trim();

    if (hasWork && !confirm('Load this call into the form? What is in the form now will be replaced.')) return false;

    if (select && select.value !== employeeName) {
        select.value = employeeName;
        renderCallListeningHistoryForSelectedEmployee();
        refreshCallListeningRecipient();
    }

    loadCallListeningEntryIntoForm(entryId);
    document.getElementById('callListeningTranscript')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return true;
}

/**
 * Clicking a saved call loads it.
 *
 * It used to only expand a read-only view, with a Load button underneath, so
 * getting an old call back took two clicks and a hunt for the second one.
 * Clicking a call means "work on this call", so it loads the form and every
 * panel with it, and the detail opens at the same time because that is where
 * the transcript is.
 *
 * The confirm before overwriting unsent work stays. That is the only reason
 * the two steps existed, and it is cheaper to ask than to lose a draft.
 */
function handleAllSavedCallsClick(event) {
    const remove = event.target?.closest('.saved-call-remove');
    if (remove) {
        deleteSavedCall(remove.dataset.savedEmployee, remove.dataset.savedId);
        return;
    }

    const open = event.target?.closest('.saved-call-open');
    if (!open) return;

    const employeeName = open.dataset.savedOpenEmployee;
    const entryId = open.dataset.savedOpenId;

    // Collapsing an already open row is just closing it, and should not
    // reload anything.
    if (expandedSavedCalls.has(savedCallKey(employeeName, entryId))) {
        toggleSavedCall(employeeName, entryId);
        return;
    }

    if (!loadSavedCallIntoForm(employeeName, entryId)) return;
    toggleSavedCall(employeeName, entryId);
}

function populateCallListeningEmployeeSelect(employeeSelect, employees, currentSelection) {
    window.DevCoachModules.associatePicker.populateSelect(employeeSelect, employees, {
        selected: currentSelection
    });
}

function setCallListeningSectionStatus(status, employeeCount) {
    status.textContent = employeeCount
        ? `Loaded ${employeeCount} associates. Save call notes to keep a permanent reference log.`
        : 'No associates found yet. Upload data first, then log call listening notes.';
    status.style.display = 'block';
}

function updateCallListeningOutlookButtonState(outlookBody, outlookBtn) {
    const hasContent = outlookBody.value.trim().length > 0;
    outlookBtn.disabled = !hasContent;
    outlookBtn.style.opacity = hasContent ? '1' : '0.6';
    outlookBtn.style.cursor = hasContent ? 'pointer' : 'not-allowed';
    // The panel is visible from the start now, so the button has to say why it
    // is not usable yet rather than just looking dim.
    outlookBtn.title = hasContent ? '' : 'Paste the message from Copilot first';
}

function bindCallListeningSectionHandlers(employeeSelect, saveBtn, copyVerintBtn, exportBtn, generatePromptBtn, historyList, outlookBody, outlookBtn) {
    bindElementOnce(employeeSelect, 'change', renderCallListeningHistoryForSelectedEmployee);
    bindElementOnce(employeeSelect, 'change', refreshCallListeningRecipient);
    bindElementOnce(document.getElementById('analyzeCallTranscriptBtn'), 'click', analyzeCallListeningTranscript);
    bindElementOnce(document.getElementById('clearCallTranscriptBtn'), 'click', clearCallListeningTranscript);
    bindElementOnce(document.getElementById('copyCallQaBtn'), 'click', copyCallListeningQaAnswers);
    bindElementOnce(document.getElementById('copyCallWordChoiceBtn'), 'click', copyCallListeningWordChoice);
    bindElementOnce(document.getElementById('callMetricChips'), 'click', handleCallMetricChipClick);
    bindElementOnce(document.getElementById('showAllSavedCallsBtn'), 'click', toggleAllSavedCalls);
    bindElementOnce(document.getElementById('allSavedCalls'), 'click', handleAllSavedCallsClick);
    bindElementOnce(document.getElementById('writeMetricMessageBtn'), 'click', writeCallMetricMessage);
    bindElementOnce(document.getElementById('generateMetricCoachPromptBtn'), 'click', generateCallMetricCoachPrompt);
    bindElementOnce(document.getElementById('copyMetricCoachBtn'), 'click', copySelectedCallMetricRead);
    bindElementOnce(saveBtn, 'click', () => upsertCallListeningEntryFromForm(true));
    bindElementOnce(copyVerintBtn, 'click', () => copyCallListeningVerintSummary());
    bindElementOnce(exportBtn, 'click', downloadCallListeningLogsCSV);
    bindElementOnce(generatePromptBtn, 'click', generateCallListeningPromptAndCopy);
    bindElementOnce(outlookBody, 'input', () => updateCallListeningOutlookButtonState(outlookBody, outlookBtn));
    bindElementOnce(outlookBtn, 'click', generateCallListeningOutlookEmail);
    bindElementOnce(historyList, 'click', (event) => {
        const button = event.target?.closest('button[data-call-action]');
        if (!button) return;
        const action = button.getAttribute('data-call-action');
        const entryId = button.getAttribute('data-entry-id');
        dispatchCallListeningHistoryAction(action, entryId);
    });
}

function initializeCallListeningSection() {
    const employeeSelect = document.getElementById('callListeningEmployeeSelect');
    const status = document.getElementById('callListeningStatus');
    const dateInput = document.getElementById('callListeningDate');
    const saveBtn = document.getElementById('saveCallListeningBtn');
    const copyVerintBtn = document.getElementById('copyCallListeningVerintBtn');
    const exportBtn = document.getElementById('exportCallListeningCsvBtn');
    const generatePromptBtn = document.getElementById('generateCallListeningPromptBtn');
    const historyList = document.getElementById('callListeningHistoryList');
    const outlookBody = document.getElementById('callListeningOutlookBody');
    const outlookBtn = document.getElementById('generateCallListeningOutlookBtn');

    if (!employeeSelect || !status || !dateInput || !saveBtn || !copyVerintBtn || !exportBtn || !generatePromptBtn || !historyList || !outlookBody || !outlookBtn) {
        return;
    }

    if (!dateInput.value) {
        dateInput.value = new Date().toISOString().split('T')[0];
    }

    const currentSelection = employeeSelect.value;
    const employees = getCallListeningEmployeeOptions();
    populateCallListeningEmployeeSelect(employeeSelect, employees, currentSelection);
    setCallListeningSectionStatus(status, employees.length);
    bindCallListeningSectionHandlers(employeeSelect, saveBtn, copyVerintBtn, exportBtn, generatePromptBtn, historyList, outlookBody, outlookBtn);
    updateCallListeningOutlookButtonState(outlookBody, outlookBtn);
    refreshCallListeningRecipient();

    renderCallListeningHistoryForSelectedEmployee();
}

function getYearEndEmployees() {
    const employees = new Set();
    const normalizeName = (name) => String(name || '').trim();

    Object.entries(weeklyData || {}).forEach(([, period]) => {
        (period?.employees || []).forEach(emp => {
            const normalizedName = normalizeName(emp?.name);
            if (normalizedName) employees.add(normalizedName);
        });
    });

    Object.values(ytdData || {}).forEach(period => {
        (period?.employees || []).forEach(emp => {
            const normalizedName = normalizeName(emp?.name);
            if (normalizedName) employees.add(normalizedName);
        });
    });

    return filterAssociateNamesByTeamSelection(Array.from(employees)).sort();
}

function normalizeYearEndEmployeeLookupName(name) {
    return String(name || '').trim().toLowerCase();
}

function matchesYearEndReviewYear(explicitReviewYear, endDate, reviewYear) {
    return (Number.isInteger(explicitReviewYear) && explicitReviewYear === reviewYear)
        || (!isNaN(endDate.getTime()) && endDate.getFullYear() === reviewYear);
}

function buildYearPeriodCandidate(sourceName, periodKey, period, requestedName, reviewYear) {
    const employeeRecord = (period?.employees || []).find(emp => normalizeYearEndEmployeeLookupName(emp?.name) === requestedName);
    if (!employeeRecord) return null;

    const metadata = period?.metadata || {};
    const explicitReviewYear = parseInt(metadata.yearEndReviewYear, 10);
    const endDateText = metadata.endDate || (periodKey.includes('|') ? periodKey.split('|')[1] : '');
    const endDate = endDateText ? new Date(endDateText) : new Date(NaN);

    if (!matchesYearEndReviewYear(explicitReviewYear, endDate, reviewYear)) {
        return null;
    }

    // YTD data should strongly outweigh daily/weekly for year-end calculations
    // Real YTD uploads outweigh auto-generated YTD
    const isYtd = sourceName === 'ytdData' || metadata.periodType === 'ytd';
    const isAutoYtd = isYtd && metadata.autoGeneratedYtd;
    const priority = (isYtd ? (isAutoYtd ? 50 : 100) : 1)
        + (Number.isInteger(explicitReviewYear) && explicitReviewYear === reviewYear ? 2 : 0);

    return {
        sourceName,
        periodKey,
        period,
        employeeRecord,
        endDate,
        priority,
        label: metadata.label || `${metadata.periodType || 'period'} ending ${formatDateMMDDYYYY(endDateText) || endDateText}`
    };
}

function collectYearPeriodCandidatesForEmployee(employeeName, reviewYear) {
    const requestedName = normalizeYearEndEmployeeLookupName(employeeName);
    const candidates = [];

    const appendCandidate = (sourceName, periodKey, period) => {
        const candidate = buildYearPeriodCandidate(sourceName, periodKey, period, requestedName, reviewYear);
        if (candidate) candidates.push(candidate);
    };

    Object.entries(ytdData || {}).forEach(([periodKey, period]) => appendCandidate('ytdData', periodKey, period));
    Object.entries(weeklyData || {}).forEach(([periodKey, period]) => appendCandidate('weeklyData', periodKey, period));

    return candidates;
}

function getLatestYearPeriodForEmployee(employeeName, reviewYear) {
    const yearNum = parseInt(reviewYear, 10);
    if (!employeeName || !Number.isInteger(yearNum)) return null;
    const candidates = collectYearPeriodCandidatesForEmployee(employeeName, yearNum);

    if (!candidates.length) return null;

    // Sort: Real YTD (100+) > Auto YTD (50+) > weekly/daily (1+)
    // Within same tier, newest date first
    candidates.sort((a, b) => {
        // Real YTD uploads are the source of truth, always preferred
        const aTier = a.priority >= 100 ? 2 : a.priority >= 50 ? 1 : 0;
        const bTier = b.priority >= 100 ? 2 : b.priority >= 50 ? 1 : 0;
        if (aTier !== bTier) return bTier - aTier;
        // Within same tier, newest date first
        if (a.endDate.getTime() !== b.endDate.getTime()) {
            return b.endDate.getTime() - a.endDate.getTime();
        }
        return b.priority - a.priority;
    });

    return candidates[0];
}

function parseYearEndMetricValue(employeeRecord, metricKey) {
    const rawValue = employeeRecord?.[metricKey];
    if (rawValue === null || rawValue === undefined || rawValue === '' || rawValue === 'N/A') {
        return null;
    }
    const value = parseFloat(rawValue);
    return isNaN(value) ? null : value;
}

function isYearEndTargetConfigValid(targetConfig) {
    return Boolean(targetConfig && targetConfig.value !== undefined && targetConfig.value !== null);
}

function doesYearEndMetricMeetTarget(value, targetConfig) {
    return targetConfig.type === 'min'
        ? value >= targetConfig.value
        : value <= targetConfig.value;
}

function buildYearEndMetricEntry(metricKey, metricLabel, value, targetConfig, meetsTarget) {
    return {
        key: metricKey,
        label: metricLabel,
        value: formatMetricDisplay(metricKey, value),
        target: formatMetricDisplay(metricKey, targetConfig.value),
        meetsTarget
    };
}

function buildYearEndMetricSnapshot(employeeRecord, reviewYear, periodMetadata = null) {
    const wins = [];
    const opportunities = [];
    const profileYears = new Set();

    getMetricOrder().forEach(({ key }) => {
        const metricConfig = METRICS_REGISTRY[key];
        if (!metricConfig) return;

        const value = parseYearEndMetricValue(employeeRecord, key);
        if (value === null) return;

        const targetConfig = getYearEndTargetConfig(key, reviewYear, periodMetadata);
        if (!isYearEndTargetConfigValid(targetConfig)) return;
        if (targetConfig.profileYear) profileYears.add(targetConfig.profileYear);

        const meetsTarget = doesYearEndMetricMeetTarget(value, targetConfig);
        const entry = buildYearEndMetricEntry(key, metricConfig.label, value, targetConfig, meetsTarget);

        if (entry.meetsTarget) {
            wins.push(entry);
        } else {
            opportunities.push(entry);
        }
    });

    return {
        wins,
        opportunities,
        targetProfileYear: profileYears.size ? Array.from(profileYears)[0] : null
    };
}

function parseOnOffMirrorNumber(value) {
    return window.DevCoachModules?.onOffTracker?.parseOnOffMirrorNumber?.(value);
}

function isValidOnOffPercent(value) {
    return window.DevCoachModules?.onOffTracker?.isValidOnOffPercent?.(value);
}

function pickYearEndAssociateOverallValue(employeeRecord) {
    return window.DevCoachModules?.onOffTracker?.pickYearEndAssociateOverallValue?.(employeeRecord);
}

function buildYearEndOnOffValues(employeeRecord, associateOverallPick) {
    return window.DevCoachModules?.onOffTracker?.buildYearEndOnOffValues?.(employeeRecord, associateOverallPick);
}

function getYearEndOnOffScoreOrFallback(metricKey, value, scoreYear) {
    return window.DevCoachModules?.onOffTracker?.getYearEndOnOffScoreOrFallback?.(metricKey, value, scoreYear);
}

function buildYearEndOnOffScores(values, scoreYear) {
    return window.DevCoachModules?.onOffTracker?.buildYearEndOnOffScores?.(values, scoreYear);
}

function resolveYearEndOnOffTrackStatus(ratingAverage) {
    return window.DevCoachModules?.onOffTracker?.resolveYearEndOnOffTrackStatus?.(ratingAverage);
}

function calculateYearEndOnOffMirror(employeeRecord, reviewYear = new Date().getFullYear()) {
    return window.DevCoachModules?.onOffTracker?.calculateYearEndOnOffMirror?.(employeeRecord, reviewYear);
}

function applyOnOffMirrorResultToElements(summaryEl, detailsEl, result, reviewYear, goalSource, periodMetadata = null) {
    return window.DevCoachModules?.onOffTracker?.applyOnOffMirrorResultToElements?.(summaryEl, detailsEl, result, reviewYear, goalSource, periodMetadata);
}

function renderYearEndOnOffMirror(employeeRecord, reviewYear = new Date().getFullYear(), periodMetadata = null) {
    return window.DevCoachModules?.onOffTracker?.renderYearEndOnOffMirror?.(employeeRecord, reviewYear, periodMetadata);
}

function renderOnOffMirrorForElementIds(employeeRecord, summaryElementId, detailsElementId, reviewYear = new Date().getFullYear()) {
    return window.DevCoachModules?.onOffTracker?.renderOnOffMirrorForElementIds?.(employeeRecord, summaryElementId, detailsElementId, reviewYear);
}

function resolveOnOffBandGoalText(bands, bandKey, formatKey) {
    return window.DevCoachModules?.onOffTracker?.resolveOnOffBandGoalText?.(bands, bandKey, formatKey) || '';
}

function resolveMetricTrendsGoalText(metricKey, formatKey, reviewYear, periodMetadata) {
    return window.DevCoachModules?.onOffTracker?.resolveMetricTrendsGoalText?.(metricKey, formatKey, reviewYear, periodMetadata) || '';
}

function resolveOnOffGoalText(goalSource, bands, targetMetricKey, bandMetricKey, formatKey, reviewYear, periodMetadata) {
    return window.DevCoachModules?.onOffTracker?.resolveOnOffGoalText?.(goalSource, bands, targetMetricKey, bandMetricKey, formatKey, reviewYear, periodMetadata) || '';
}

function buildOnOffScoreRows(result, goalSource, bands, reviewYear, periodMetadata) {
    return window.DevCoachModules?.onOffTracker?.buildOnOffScoreRows?.(result, goalSource, bands, reviewYear, periodMetadata);
}

function getOnOffScoreCellStyle(score) {
    return window.DevCoachModules?.onOffTracker?.getOnOffScoreCellStyle?.(score) || '';
}

function getOnOffStatusStyle(statusText) {
    return window.DevCoachModules?.onOffTracker?.getOnOffStatusStyle?.(statusText) || '';
}

function buildOnOffHeaderSummaryHtml(ratingText, statusText, statusStyle) {
    return window.DevCoachModules?.onOffTracker?.buildOnOffHeaderSummaryHtml?.(ratingText, statusText, statusStyle) || '';
}

function buildOnOffRowsHtml(rows) {
    return window.DevCoachModules?.onOffTracker?.buildOnOffRowsHtml?.(rows) || '';
}

function buildOnOffScoreTableHtml(result, reviewYear = new Date().getFullYear(), options = {}) {
    return window.DevCoachModules?.onOffTracker?.buildOnOffScoreTableHtml?.(result, reviewYear, options) || '';
}

function getOnOffTrackerLegendBandsByYear(reviewYear) {
    return window.DevCoachModules?.onOffTracker?.getOnOffTrackerLegendBandsByYear?.(reviewYear) || null;
}

function buildOnOffLegendMissingConfigCardHtml(label) {
    return window.DevCoachModules?.onOffTracker?.buildOnOffLegendMissingConfigCardHtml?.(label) || '';
}

function buildOnOffLegendMinTypeCardHtml(metricKey, label, config) {
    return window.DevCoachModules?.onOffTracker?.buildOnOffLegendMinTypeCardHtml?.(metricKey, label, config) || '';
}

function buildOnOffLegendMaxTypeCardHtml(metricKey, label, config) {
    return window.DevCoachModules?.onOffTracker?.buildOnOffLegendMaxTypeCardHtml?.(metricKey, label, config) || '';
}

function buildOnOffLegendMetricCardHtml(metric, bands) {
    return window.DevCoachModules?.onOffTracker?.buildOnOffLegendMetricCardHtml?.(metric, bands) || '';
}

function buildOnOffLegendContainerHtml(reviewYear, cardsHtml, sourceLabel, usingFallback) {
    return window.DevCoachModules?.onOffTracker?.buildOnOffLegendContainerHtml?.(reviewYear, cardsHtml, sourceLabel, usingFallback) || '';
}

function renderOnOffTrackerLegend(reviewYear) {
    return window.DevCoachModules?.onOffTracker?.renderOnOffTrackerLegend?.(reviewYear);
}

function populateOnOffTrackerEmployeeSelect(employeeSelect) {
    return window.DevCoachModules?.onOffTracker?.populateOnOffTrackerEmployeeSelect?.(employeeSelect) || [];
}

function resetOnOffTrackerPanel(panel, factsSummary, summary, details) {
    return window.DevCoachModules?.onOffTracker?.resetOnOffTrackerPanel?.(panel, factsSummary, summary, details);
}

function bindOnOffTrackerHandlers(employeeSelect, reviewYearInput, calculateBtn) {
    return window.DevCoachModules?.onOffTracker?.bindOnOffTrackerHandlers?.(employeeSelect, reviewYearInput, calculateBtn);
}

function resolveOnOffTrackerFactsSummaryText(latestPeriod) {
    return window.DevCoachModules?.onOffTracker?.resolveOnOffTrackerFactsSummaryText?.(latestPeriod) || '';
}

function initializeOnOffTracker() {
    return window.DevCoachModules?.onOffTracker?.initializeOnOffTracker?.();
}

function initializeMidYearTab() {
    return window.DevCoachModules?.onOffTracker?.initializeMidYearTab?.();
}

function updateOnOffTrackerDisplay() {
    return window.DevCoachModules?.onOffTracker?.updateOnOffTrackerDisplay?.();
}

function bindElementOnce(element, eventName, handler) {
    if (!element || element.dataset.bound) return;
    element.addEventListener(eventName, handler);
    element.dataset.bound = 'true';
}

function getYearEndCommentsElements() {
    return window.DevCoachModules?.yearEndComments?.getYearEndCommentsElements?.() || {};
}

function hasRequiredYearEndCommentsElements(elements) {
    return window.DevCoachModules?.yearEndComments?.hasRequiredYearEndCommentsElements?.(elements) ?? false;
}

function resetYearEndCommentsInitialState(snapshotPanel, promptArea) {
    return window.DevCoachModules?.yearEndComments?.resetYearEndCommentsInitialState?.(snapshotPanel, promptArea);
}

function initializeYearEndReviewYearInput(reviewYearInput) {
    return window.DevCoachModules?.yearEndComments?.initializeYearEndReviewYearInput?.(reviewYearInput);
}

function populateYearEndEmployeeSelect(employeeSelect) {
    return window.DevCoachModules?.yearEndComments?.populateYearEndEmployeeSelect?.(employeeSelect) || [];
}

function bindYearEndPrimaryActionHandlers(elements) {
    return window.DevCoachModules?.yearEndComments?.bindYearEndPrimaryActionHandlers?.(elements);
}

function bindYearEndDraftPersistenceHandlers(elements) {
    return window.DevCoachModules?.yearEndComments?.bindYearEndDraftPersistenceHandlers?.(elements);
}

function initializeYearEndComments() {
    return window.DevCoachModules?.yearEndComments?.initializeYearEndComments?.();
}

function clearYearEndOnOffMirror(onOffSummary, onOffDetails) {
    return window.DevCoachModules?.yearEndComments?.clearYearEndOnOffMirror?.(onOffSummary, onOffDetails);
}

function clearYearEndDraftInputs(trackSelect, positivesInput, improvementsInput, managerContextInput, responseInput, performanceRatingInput, meritDetailsInput, bonusAmountInput, verbalSummaryOutput) {
    return window.DevCoachModules?.yearEndComments?.clearYearEndDraftInputs?.(trackSelect, positivesInput, improvementsInput, managerContextInput, responseInput, performanceRatingInput, meritDetailsInput, bonusAmountInput, verbalSummaryOutput);
}

function applyYearEndSavedDraft(savedDraft, trackSelect, positivesInput, improvementsInput, managerContextInput, responseInput, performanceRatingInput, meritDetailsInput, bonusAmountInput, verbalSummaryOutput) {
    return window.DevCoachModules?.yearEndComments?.applyYearEndSavedDraft?.(savedDraft, trackSelect, positivesInput, improvementsInput, managerContextInput, responseInput, performanceRatingInput, meritDetailsInput, bonusAmountInput, verbalSummaryOutput);
}

function buildYearEndSummaryLine(latestPeriod, targetProfileYear, wins, opportunities) {
    return window.DevCoachModules?.yearEndComments?.buildYearEndSummaryLine?.(latestPeriod, targetProfileYear, wins, opportunities) || '';
}

function autoPopulateYearEndNarrativeInputs(positivesInput, improvementsInput, wins, opportunities, annualGoals) {
    return window.DevCoachModules?.yearEndComments?.autoPopulateYearEndNarrativeInputs?.(positivesInput, improvementsInput, wins, opportunities, annualGoals);
}

function buildYearEndDraftContext(employeeName, reviewYear, latestPeriod, endDateText, wins, opportunities, targetProfileYear, annualGoals) {
    return window.DevCoachModules?.yearEndComments?.buildYearEndDraftContext?.(employeeName, reviewYear, latestPeriod, endDateText, wins, opportunities, targetProfileYear, annualGoals) || {};
}

function getYearEndSnapshotElements() {
    return window.DevCoachModules?.yearEndComments?.getYearEndSnapshotElements?.() || {};
}

function clearYearEndSnapshotListsAndPrompt(summary, winsList, improvementList, promptArea) {
    return window.DevCoachModules?.yearEndComments?.clearYearEndSnapshotListsAndPrompt?.(summary, winsList, improvementList, promptArea);
}

function setYearEndSnapshotStatus(status, snapshotPanel, text, showPanel) {
    return window.DevCoachModules?.yearEndComments?.setYearEndSnapshotStatus?.(status, snapshotPanel, text, showPanel);
}

function renderYearEndSnapshotMetricLists(winsList, improvementList, wins, opportunities) {
    return window.DevCoachModules?.yearEndComments?.renderYearEndSnapshotMetricLists?.(winsList, improvementList, wins, opportunities);
}

function resolveYearEndEndDateText(latestPeriod) {
    return window.DevCoachModules?.yearEndComments?.resolveYearEndEndDateText?.(latestPeriod) || '';
}

function updateYearEndSnapshotDisplay() {
    return window.DevCoachModules?.yearEndComments?.updateYearEndSnapshotDisplay?.();
}

function getYearEndPromptInputs() {
    return window.DevCoachModules?.yearEndComments?.getYearEndPromptInputs?.() || {};
}

function validateYearEndPromptInputs(employeeName, reviewYear, trackStatus, promptArea) {
    return window.DevCoachModules?.yearEndComments?.validateYearEndPromptInputs?.(employeeName, reviewYear, trackStatus, promptArea) ?? false;
}

function ensureYearEndDraftContext(employeeName, reviewYear) {
    return window.DevCoachModules?.yearEndComments?.ensureYearEndDraftContext?.(employeeName, reviewYear);
}

function buildYearEndPromptSupportData(employeeName, reviewYear) {
    return window.DevCoachModules?.yearEndComments?.buildYearEndPromptSupportData?.(employeeName, reviewYear) || {};
}

function resolveYearEndPromptHeaderData(employeeName, reviewYear, trackStatus) {
    return window.DevCoachModules?.yearEndComments?.resolveYearEndPromptHeaderData?.(employeeName, reviewYear, trackStatus) || {};
}

function buildYearEndCopilotPrompt(inputData, supportData, headerData) {
    const delegated = window.DevCoachModules?.yearEnd?.buildCopilotPrompt?.(inputData, supportData, headerData);
    return delegated || '';
}

function generateYearEndPromptAndCopy() {
    return window.DevCoachModules?.yearEndComments?.generateYearEndPromptAndCopy?.();
}

function copyYearEndResponseToClipboard() {
    return window.DevCoachModules?.yearEndComments?.copyYearEndResponseToClipboard?.();
}

function focusYearEndResponseInput(responseInput) {
    return window.DevCoachModules?.yearEndComments?.focusYearEndResponseInput?.(responseInput);
}

async function getClipboardTextViaReadText() {
    return window.DevCoachModules?.yearEndComments?.getClipboardTextViaReadText?.();
}

async function extractClipboardTextFromItem(item) {
    return window.DevCoachModules?.yearEndComments?.extractClipboardTextFromItem?.(item);
}

async function getClipboardTextViaReadItems() {
    return window.DevCoachModules?.yearEndComments?.getClipboardTextViaReadItems?.();
}

async function readYearEndClipboardText() {
    return window.DevCoachModules?.yearEndComments?.readYearEndClipboardText?.();
}

async function pasteYearEndResponseFromClipboard() {
    return window.DevCoachModules?.yearEndComments?.pasteYearEndResponseFromClipboard?.();
}

function extractYearEndBoxText(responseText, boxNumber) {
    const delegated = window.DevCoachModules?.yearEnd?.extractBoxText?.(responseText, boxNumber);
    return typeof delegated === 'string' ? delegated : '';
}

function copyYearEndBoxResponseToClipboard(boxNumber) {
    return window.DevCoachModules?.yearEndComments?.copyYearEndBoxResponseToClipboard?.(boxNumber);
}

function generateYearEndVerbalSummary() {
    return window.DevCoachModules?.yearEndComments?.generateYearEndVerbalSummary?.();
}

function copyYearEndVerbalSummary() {
    return window.DevCoachModules?.yearEndComments?.copyYearEndVerbalSummary?.();
}

function deleteLatestCoachingEntry() {
    return window.DevCoachModules?.coachingEmail?.deleteLatestCoachingEntry?.();
}

function clearCoachingHistoryForEmployee() {
    return window.DevCoachModules?.coachingEmail?.clearCoachingHistoryForEmployee?.();
}

function getCoachingEmailDisplayElements() {
    return window.DevCoachModules?.coachingEmail?.getCoachingEmailDisplayElements?.() || {};
}

function resetCoachingEmailDisplayState(elements) {
    return window.DevCoachModules?.coachingEmail?.resetCoachingEmailDisplayState?.(elements);
}

function resolveCoachingEmployeeRecord(employeeName) {
    return window.DevCoachModules?.coachingEmail?.resolveCoachingEmployeeRecord?.(employeeName) || null;
}

function buildCoachingDisplayMetricData(employeeRecord) {
    return window.DevCoachModules?.coachingEmail?.buildCoachingDisplayMetricData?.(employeeRecord) || { wins: [], opportunities: [] };
}

function resolveCoachingDisplayEndDate() {
    return window.DevCoachModules?.coachingEmail?.resolveCoachingDisplayEndDate?.() || '';
}

function renderCoachingMetricLists(winsList, oppList, wins, opportunities) {
    return window.DevCoachModules?.coachingEmail?.renderCoachingMetricLists?.(winsList, oppList, wins, opportunities);
}

function updateCoachingEmailDisplay() {
    return window.DevCoachModules?.coachingEmail?.updateCoachingEmailDisplay?.();
}

function getCoachingHistoryElements() {
    return window.DevCoachModules?.coachingEmail?.getCoachingHistoryElements?.() || {};
}

function setCoachingHistoryEmptyState(summary, list, panel, summaryText) {
    return window.DevCoachModules?.coachingEmail?.setCoachingHistoryEmptyState?.(summary, list, panel, summaryText);
}

function renderCoachingHistory(employeeName) {
    const { panel, summary, list } = getCoachingHistoryElements();

    if (!panel || !summary || !list) return;

    const delegated = window.DevCoachModules?.coaching?.renderHistoryView;
    if (typeof delegated === 'function') {
        delegated({
            panel,
            summary,
            list,
            employeeName,
            history: resolveCoachingHistoryForEmployee(employeeName),
            formatDate: formatDateMMDDYYYY,
            metricsRegistry: METRICS_REGISTRY
        });
        return;
    }

    setCoachingHistoryEmptyState(summary, list, panel, 'Coaching module unavailable. Refresh and try again.');
}

function chooseCoachingTip(metricConfig, usedTips) {
    return window.DevCoachModules?.coachingEmail?.chooseCoachingTip?.(metricConfig, usedTips);
}

function collectCoachingPromptMetricData(employeeRecord) {
    return window.DevCoachModules?.coachingEmail?.collectCoachingPromptMetricData?.(employeeRecord) || { wins: [], opportunities: [] };
}

function resolveCoachingPromptPeriodEndDate() {
    return window.DevCoachModules?.coachingEmail?.resolveCoachingPromptPeriodEndDate?.() || '';
}

function buildCoachingPromptMetricsText(wins, opportunities) {
    return window.DevCoachModules?.coachingEmail?.buildCoachingPromptMetricsText?.(wins, opportunities) || { winsText: '', oppText: '' };
}

function buildCoachingPromptRoleSection(employeeName) {
    return window.DevCoachModules?.coachingEmail?.buildCoachingPromptRoleSection?.(employeeName) || '';
}

function buildCoachingPromptVoiceToneSection() {
    return window.DevCoachModules?.coachingEmail?.buildCoachingPromptVoiceToneSection?.() || '';
}

function buildCoachingPromptRulesSection() {
    return window.DevCoachModules?.coachingEmail?.buildCoachingPromptRulesSection?.() || '';
}

function buildCoachingPromptFlowSection(preferredName) {
    return window.DevCoachModules?.coachingEmail?.buildCoachingPromptFlowSection?.(preferredName) || '';
}

function buildCoachingPromptOutputRequirementsSection(preferredName) {
    return window.DevCoachModules?.coachingEmail?.buildCoachingPromptOutputRequirementsSection?.(preferredName) || '';
}

function buildCoachingPromptDataSection(endDate, winsText, oppText) {
    return window.DevCoachModules?.coachingEmail?.buildCoachingPromptDataSection?.(endDate, winsText, oppText) || '';
}

function buildCoachingPromptDataRulesSection() {
    return window.DevCoachModules?.coachingEmail?.buildCoachingPromptDataRulesSection?.() || '';
}

function buildCoachingPromptFinalInstructionSection(preferredName) {
    return window.DevCoachModules?.coachingEmail?.buildCoachingPromptFinalInstructionSection?.(preferredName) || '';
}

function buildCoachingPrompt(employeeRecord) {
    return window.DevCoachModules?.coachingEmail?.buildCoachingPrompt?.(employeeRecord) || '';
}

function getCoachingPromptGenerationInputs() {
    return window.DevCoachModules?.coachingEmail?.getCoachingPromptGenerationInputs?.() || {};
}

function resolveCoachingPromptEmployeeRecord(employeeName) {
    return window.DevCoachModules?.coachingEmail?.resolveCoachingPromptEmployeeRecord?.(employeeName) || null;
}

function buildLatestCoachingSummaryData(employeeRecord) {
    return window.DevCoachModules?.coachingEmail?.buildLatestCoachingSummaryData?.(employeeRecord) || {};
}

function recordAndRenderCoachingEvent(employeeName, weekEnding, coachedMetricKeys) {
    return window.DevCoachModules?.coachingEmail?.recordAndRenderCoachingEvent?.(employeeName, weekEnding, coachedMetricKeys);
}

function revealCoachingOutlookSection() {
    return window.DevCoachModules?.coachingEmail?.revealCoachingOutlookSection?.();
}

function generateCoachingPromptAndCopy() {
    return window.DevCoachModules?.coachingEmail?.generateCoachingPromptAndCopy?.();
}

function getCoachingOutlookGenerationInputs() {
    return window.DevCoachModules?.coachingEmail?.getCoachingOutlookGenerationInputs?.() || {};
}

function generateOutlookEmailFromCoPilot() {
    const { bodyText, selectedEmployee } = getCoachingOutlookGenerationInputs();

    const delegated = window.DevCoachModules?.coaching?.generateOutlookDraftFromCopilot;
    if (typeof delegated === 'function') {
        delegated({
            bodyText,
            selectedEmployee,
            periodMeta: weeklyData[coachingLatestWeekKey]?.metadata || {},
            periodKey: coachingLatestWeekKey,
            getEmployeeNickname,
            formatDate: formatDateMMDDYYYY,
            showToast,
            onError: (error) => {
                console.error('Error opening Outlook draft from coaching email:', error);
            }
        });
        return;
    }

    showToast('⚠️ Coaching module is unavailable. Refresh and try again.', 3500);
}

// ============================================
// SENTIMENT & LANGUAGE SUMMARY ENGINE
// ============================================

// Sentiment functions are implemented in modules/sentiment.module.js
// The module sets window.* globals directly, so no delegation wrappers needed.

