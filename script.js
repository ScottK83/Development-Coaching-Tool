/* ========================================
   DEVELOPMENT COACHING TOOL
   Complete rewrite with proper encoding and parsing
   ======================================== */

/* ========================================
   ?? DESIGN INTENT & DEVELOPMENT GUIDELINES
   ========================================
   
   This application prioritizes deterministic behavior over heuristics.
   - Avoid "smart guessing" unless explicitly requested
   - Prefer explicit mappings and clear failure modes
   - Maintain predictable, testable code paths
   
   CRITICAL RULES FOR MODIFICATIONS:
   
   ? Do not add new metric definitions, targets, labels, or tips 
      unless modifying the centralized metric configuration
   
   ? Do not duplicate logic that already exists
      Always search for an existing helper before creating a new one
   
   ? Do not add new parsing logic
      Use existing: parsePercentage, parseSurveyPercentage, 
      parseSeconds, and parseHours functions
   
   ? Do not modify header mapping behavior without explicit instruction
   
   ? If code can be reused, refactor instead of copy/paste
   ? Keep data transformations explicit and traceable
   ? Document any deviation from these guidelines with reasoning
   
   ======================================== */

// ============================================
// GLOBAL STATE
// ============================================
const APP_VERSION = '2026.04.03.22'; // Version: YYYY.MM.DD.NN
const DEBUG = true; // Set to true to enable console logging
const STORAGE_PREFIX = 'devCoachingTool_'; // Namespace for localStorage keys

// ============================================
// ERROR HANDLING & SUPPRESSION
// ============================================
// Suppress all source map and network-related warnings that clutter the console
const SUPPRESSED_PATTERNS = [
    /JSON\.parse.*\.map/i,
    /source map error/i,
    /failed to load source map/i,
    /uncaught syntaxerror.*json/i,
    /chart\.umd\.js\.map/i,
    /lib-chart\.js\.map/i
];

const isSuppressed = (msg) => {
    if (!msg) return false;
    return SUPPRESSED_PATTERNS.some(pattern => pattern.test(msg));
};

if (!DEBUG) {
    let lastErrorCapture = null;
    console.log = () => {};
    console.warn = () => {};
    console.error = (...args) => {
        const msg = args.join(' ');
        if (isSuppressed(msg)) return;
        lastErrorCapture = { message: msg, timestamp: new Date().toISOString() };
        try { localStorage.setItem(STORAGE_PREFIX + 'lastError', JSON.stringify(lastErrorCapture)); } catch(_e) {}
    };
} else {
    // DEBUG mode: suppress annoyances, keep real errors
    const originalError = console.error;
    const originalWarn = console.warn;
    console.error = (...args) => {
        const msg = args.join(' ');
        if (isSuppressed(msg)) return;
        originalError.apply(console, args);
    };
    console.warn = (...args) => {
        const msg = args.join(' ');
        if (isSuppressed(msg)) return;
        originalWarn.apply(console, args);
    };
}

// Global error handler - catches runtime errors
window.addEventListener('error', (event) => {
    const msg = event.message || '';
    if (isSuppressed(msg) || (event.filename && event.filename.includes('.map'))) {
        event.preventDefault();
        return;
    }

    const errorInfo = {
        message: event.message,
        source: event.filename,
        line: event.lineno,
        column: event.colno,
        timestamp: new Date().toISOString()
    };
    localStorage.setItem(STORAGE_PREFIX + 'lastError', JSON.stringify(errorInfo));
    showToast('⚠️ An error occurred. Check Debug panel for details.', 5000);
    event.preventDefault();
});

// Suppress unhandled promise rejections from source map loading
window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason || {};
    const msg = (reason.message || String(reason)).toLowerCase();
    if (isSuppressed(msg) || msg.includes('source map') || msg.includes('.map')) {
        event.preventDefault();
        return;
    }
});

// Unsaved changes tracking
window.addEventListener('beforeunload', (e) => {
    if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
    }
});

let weeklyData = {};
let ytdData = {};
let currentPeriodType = 'week';
let currentPeriod = null;

// Smart defaults and state tracking
let hasUnsavedChanges = false;
let lastSelectedEmployee = null;
let lastError = null;
let myTeamMembers = {}; // Stores selected team members by weekKey: { "2026-01-24|2026-01-20": ["Alyssa", "John", ...] }
let coachingLatestWeekKey = null;
let coachingHistory = {};
let yearEndDraftContext = null;
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
    const result = window.DevCoachModules?.storage?.saveWeeklyData?.(weeklyData);
    queueRepoSync('weekly data updated');
    return result;
}
function loadYtdData() {
    return window.DevCoachModules?.storage?.loadYtdData?.() || {};
}
function saveYtdData() {
    const result = window.DevCoachModules?.storage?.saveYtdData?.(ytdData);
    queueRepoSync('ytd data updated');
    return result;
}
function loadCoachingHistory() {
    return window.DevCoachModules?.storage?.loadCoachingHistory?.() || {};
}
function saveCoachingHistory() {
    const result = window.DevCoachModules?.storage?.saveCoachingHistory?.(coachingHistory);
    queueRepoSync('coaching history updated');
    return result;
}
function loadSentimentPhraseDatabase() {
    return window.DevCoachModules?.storage?.loadSentimentPhraseDatabase?.();
}
function saveSentimentPhraseDatabase() {
    const result = window.DevCoachModules?.storage?.saveSentimentPhraseDatabase?.(sentimentPhraseDatabase);
    queueRepoSync('sentiment phrase database updated');
    return result;
}
function loadAssociateSentimentSnapshots() {
    return window.DevCoachModules?.storage?.loadAssociateSentimentSnapshots?.() || {};
}
function saveAssociateSentimentSnapshots() {
    const result = window.DevCoachModules?.storage?.saveAssociateSentimentSnapshots?.(associateSentimentSnapshots);
    queueRepoSync('associate sentiment snapshots updated');
    return result;
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
const LOCALSTORAGE_MAX_SIZE_MB = 4;
const REGEX_TIMEOUT_MS = 100;
const FILE_PARSE_CHUNK_SIZE = 100;
const DEBUG_MAX_ENTRIES = 50;
const YEAR_END_ANNUAL_GOALS_STORAGE_KEY = STORAGE_PREFIX + 'yearEndAnnualGoals';
const YEAR_END_DRAFT_STORAGE_KEY = STORAGE_PREFIX + 'yearEndDraftEntries';
const CALL_LISTENING_LOGS_STORAGE_KEY = STORAGE_PREFIX + 'callListeningLogs';
const CALL_LISTENING_SYNC_CONFIG_STORAGE_KEY = STORAGE_PREFIX + 'callListeningSyncConfig';
const REPO_SYNC_LAST_SUCCESS_STORAGE_KEY = STORAGE_PREFIX + 'repoSyncLastSuccess';
const REPO_BACKUP_APPLIED_AT_STORAGE_KEY = STORAGE_PREFIX + 'repoBackupAppliedAt';
const UI_NAV_STATE_STORAGE_KEY = STORAGE_PREFIX + 'uiNavState';

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
const SENTIMENT_PHRASE_DB_STORAGE_KEY = 'sentimentPhraseDatabase';
const ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY = 'associateSentimentSnapshots';

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
        z-index: 10000;
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
            <div style="background: white; padding: 30px 40px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3); text-align: center;">
                <div style="width: 50px; height: 50px; border: 5px solid #f3f3f3; border-top: 5px solid #2196F3; border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 15px;"></div>
                <div style="font-size: 16px; color: #333; font-weight: 600;">${escapeHtml(message)}</div>
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

function enableDatePickerOpen(input) {
    if (!input) return;
    const openPicker = () => {
        if (typeof input.showPicker === 'function') {
            try {
                input.showPicker();
            } catch (error) {
                // Ignore if browser disallows programmatic picker
            }
        }
    };
    input.addEventListener('click', openPicker);
    input.addEventListener('focus', openPicker);
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
function fallbackCopyDebug(text) {
    window.DevCoachModules?.debug?.fallbackCopyDebug?.(text);
}

// ============================================
// NICKNAME MEMORY
// ============================================

function saveNickname(employeeFullName, nickname) {
    try {
        const nicknames = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'employeeNicknames') || '{}');
        nicknames[employeeFullName] = nickname;
        localStorage.setItem(STORAGE_PREFIX + 'employeeNicknames', JSON.stringify(nicknames));
    } catch (error) {
        console.error('Error saving nickname:', error);
    }
}

function getSavedNickname(employeeFullName) {
    try {
        const nicknames = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'employeeNicknames') || '{}');
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

function appendCoachingLogEntry(entry) {
    if (!entry || !entry.employeeId) return;
    if (!coachingHistory[entry.employeeId]) {
        coachingHistory[entry.employeeId] = [];
    }
    coachingHistory[entry.employeeId].push(entry);
    if (coachingHistory[entry.employeeId].length > 200) {
        coachingHistory[entry.employeeId] = coachingHistory[entry.employeeId].slice(-200);
    }
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
    let csv = 'Employee,Week Ending,Metrics Coached,AI Assisted,Generated At\n';
    
    Object.entries(coachingHistory).forEach(([employeeId, entries]) => {
        entries.forEach(entry => {
            const metricsStr = (entry.metricsCoached || []).join(';');
            const aiStr = entry.aiAssisted ? 'Yes' : 'No';
            const timestamp = entry.generatedAt ? new Date(entry.generatedAt).toLocaleString() : '';
            
            // Escape commas in metric list
            const escapedMetrics = metricsStr.includes(',') ? `"${metricsStr}"` : metricsStr;
            
            csv += `${employeeId},${entry.weekEnding || ''},${escapedMetrics},${aiStr},${timestamp}\n`;
        });
    });
    
    return csv;
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
 * Exports all app data (including sentiment snapshots) to JSON file
 */
function exportToExcel() {
    const exportData = {
        weeklyData: weeklyData || {},
        ytdData: ytdData || {},
        callListeningLogs: callListeningLogs || {},
        sentimentPhraseDatabase: sentimentPhraseDatabase || null,
        associateSentimentSnapshots: associateSentimentSnapshots || {},
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

    showToast(`✅ Exported ${weekCount} weeks + ${sentimentCount} sentiment snapshots + ${callListeningCount} call logs to ${exportFileDefaultName}`, 5000);
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
    queueRepoSync('team members updated');
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
        updateEmployeeDropdown();
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
        const saved = localStorage.getItem(STORAGE_PREFIX + 'callCenterAverages');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading call center averages:', error);
        return {};
    }
}

function saveCallCenterAverages(averages) {
    try {
        localStorage.setItem(STORAGE_PREFIX + 'callCenterAverages', JSON.stringify(averages));
        queueRepoSync('call center averages updated');
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

function getEmployeeNickname(fullName) {
    if (!fullName) return '';
    
    // Check if a custom preferred name has been set
    const preferredNames = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'employeePreferredNames') || '{}');
    if (preferredNames[fullName]) {
        return preferredNames[fullName];
    }
    
    // Default: return first name
    return fullName.split(' ')[0];
}

function setEmployeePreferredName(fullName, preferredName) {
    if (!fullName) return;
    
    const preferredNames = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'employeePreferredNames') || '{}');
    
    if (preferredName && preferredName.trim()) {
        preferredNames[fullName] = preferredName.trim();
    } else {
        // If empty, remove the custom preference (fall back to first name)
        delete preferredNames[fullName];
    }
    
    localStorage.setItem(STORAGE_PREFIX + 'employeePreferredNames', JSON.stringify(preferredNames));
}

window.saveEmployeePreferredName = function(fullName) {
    const input = document.getElementById(`prefName_${fullName}`);
    if (!input) return;
    
    const preferredName = input.value.trim();
    setEmployeePreferredName(fullName, preferredName);
    
    showToast('✅ Preferred name updated!');
    renderEmployeesList();
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

function getActivePeriodContext() {
    const metadataSource = currentPeriodType === 'ytd' ? ytdData : weeklyData;
    const metadata = currentPeriod && metadataSource[currentPeriod]?.metadata ? metadataSource[currentPeriod].metadata : null;
    
    // Determine friendly time reference based on period type
    let timeReference = 'this period';
    if (currentPeriodType === 'daily') {
        timeReference = 'today';
    } else if (currentPeriodType === 'week') {
        timeReference = 'this week';
    } else if (currentPeriodType === 'month') {
        timeReference = 'this month';
    } else if (currentPeriodType === 'quarter') {
        timeReference = 'this quarter';
    } else if (currentPeriodType === 'ytd') {
        timeReference = 'this year';
    }
    
    return {
        periodLabel: metadata?.label || 'this period',
        weekEnding: metadata?.endDate || metadata?.label || 'unspecified',
        timeReference: timeReference,
        periodType: currentPeriodType
    };
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
function recordCoachingEvent({ employeeId, weekEnding, metricsCoached, aiAssisted }) {
    if (!employeeId) {
        console.warn('recordCoachingEvent: Missing employeeId');
        return;
    }
    appendCoachingLogEntry({
        employeeId,
        weekEnding,
        metricsCoached: metricsCoached || [],
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

function updateEmployeeDropdown() {
    const dropdown = document.getElementById('employeeSelect');
    if (!dropdown) return;
    
    dropdown.innerHTML = '<option value="">-- Choose an employee --</option>';
    
    const employees = new Set();
    const teamFilterContext = getTeamSelectionContext();
    
    // For week/month/quarter: currentPeriod is the weekKey
    if (currentPeriod && weeklyData[currentPeriod] && currentPeriodType !== 'ytd') {
        weeklyData[currentPeriod].employees.forEach(emp => {
            if (isAssociateIncludedByTeamFilter(emp.name, teamFilterContext)) {
                employees.add(emp.name);
            }
        });
    } else if (currentPeriodType === 'ytd' && currentPeriod && ytdData[currentPeriod]) {
        ytdData[currentPeriod].employees.forEach(emp => {
            if (isAssociateIncludedByTeamFilter(emp.name, teamFilterContext)) {
                employees.add(emp.name);
            }
        });
    }
    
    Array.from(employees).sort().forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        dropdown.appendChild(option);
    });
}

function getEmployeeDataForPeriod(employeeName) {
    // For week/month/quarter: currentPeriod is the weekKey - look it up directly
    if (currentPeriod && weeklyData[currentPeriod] && currentPeriodType !== 'ytd') {
        const week = weeklyData[currentPeriod];
        if (week && week.employees) {
            return week.employees.find(emp => emp.name === employeeName);
        }
    } else if (currentPeriodType === 'ytd' && currentPeriod && ytdData[currentPeriod]) {
        const ytdPeriod = ytdData[currentPeriod];
        if (ytdPeriod && ytdPeriod.employees) {
            return ytdPeriod.employees.find(emp => emp.name === employeeName);
        }
    }
    
    return null;
}

function updatePeriodDropdown() {
    const dropdown = document.getElementById('specificPeriod');
    if (!dropdown) return;
    
    dropdown.innerHTML = '<option value="">-- Choose a date range --</option>';
    
    const periods = [];
    
    const sourceData = currentPeriodType === 'ytd' ? ytdData : weeklyData;
    Object.keys(sourceData).forEach(weekKey => {
        const metadata = sourceData[weekKey].metadata;
        const storedPeriodType = metadata.periodType || 'week';
        
        // Only show periods that match the current view type
        if (currentPeriodType !== storedPeriodType) {
            return; // Skip this period if it doesn't match the current view
        }
        
        // Use the stored label from upload
        const label = metadata.label;
        const startDate = new Date(metadata.startDate);
        
        periods.push({ 
            value: weekKey, 
            label: label, 
            date: startDate 
        });
    });
    
    // Sort by date descending
    periods.sort((a, b) => b.date - a.date);
    
    periods.forEach(period => {
        const option = document.createElement('option');
        option.value = period.value;
        option.textContent = period.label;
        dropdown.appendChild(option);
    });
}

// ============================================
// UI HELPER FUNCTIONS
// ============================================

function populateMetricInputs(employee) {
    // Populate metrics from registry
    Object.keys(METRICS_REGISTRY).forEach(metricKey => {
        const input = document.getElementById(metricKey);
        if (input) {
            const value = employee[metricKey];
            // Explicitly handle 0 as a valid value (for ACW, holdTime, reliability)
            input.value = (value === 0 || (value !== '' && value !== null && value !== undefined)) ? value : '';
        }
    });
    
    const totalCallsInput = document.getElementById('totalCalls');
    if (totalCallsInput) {
        // FIX #4: UI safeguard - hide totalCalls if surveyTotal > totalCalls (data integrity issue)
        if (employee.surveyTotal > employee.totalCalls && employee.totalCalls > 0) {
            totalCallsInput.value = '';
            totalCallsInput.style.display = 'none';
            const label = document.querySelector('label[for="totalCalls"]');
            if (label) label.style.display = 'none';
        } else {
            totalCallsInput.value = employee.totalCalls || 0;
            totalCallsInput.style.display = '';
            const label = document.querySelector('label[for="totalCalls"]');
            if (label) label.style.display = '';
        }
    }
    
    const surveyInput = document.getElementById('surveyTotal');
    if (surveyInput) {
        surveyInput.value = employee.surveyTotal || 0;
    }
    
    // Apply highlighting
    applyMetricHighlights();
}

function applyMetricHighlights() {
    const configs = Object.values(METRICS_REGISTRY).map(metric => ({
        id: metric.key,
        target: metric.target.value,
        type: metric.target.type
    }));

    configs.forEach(cfg => {
        const el = document.getElementById(cfg.id);
        if (!el || el.value === '' || el.value === null || el.value === undefined) {
            if (el) {
                el.style.background = '';
                el.style.borderColor = '';
            }
            return;
        }

        const val = parseFloat(el.value);
        if (isNaN(val)) {
            el.style.background = '';
            el.style.borderColor = '';
            return;
        }

        const meets = cfg.type === 'min' ? val >= cfg.target : val <= cfg.target;
        el.style.background = meets ? '#d4edda' : '#fff3cd';
        el.style.borderColor = meets ? '#28a745' : '#ffc107';
    });
}

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

function bindUploadAndPasteHandlers() {
    document.querySelectorAll('.upload-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.upload-period-btn').forEach(button => {
                if (button === btn) {
                    button.style.background = '#28a745';
                    button.style.borderColor = '#28a745';
                    button.style.color = 'white';
                } else {
                    button.style.background = 'white';
                    button.style.borderColor = '#ddd';
                    button.style.color = '#666';
                }
            });
            // Update date label based on period type
            const period = btn.dataset.period;
            const label = document.getElementById('pasteWeekEndingLabel');
            const hint = document.getElementById('pasteWeekEndingHint');
            const customStartContainer = document.getElementById('customStartDateContainer');
            if (label && hint) {
                // Show/hide custom start date picker
                if (customStartContainer) {
                    customStartContainer.style.display = period === 'custom' ? 'block' : 'none';
                }
                if (period === 'daily') {
                    label.textContent = 'Date:';
                    hint.textContent = 'Select the date for this daily data.';
                } else if (period === 'week') {
                    label.textContent = 'Week Ending (Sunday):';
                    hint.textContent = 'Week runs Monday - Sunday';
                } else if (period === 'month') {
                    label.textContent = 'Month Ending Date:';
                    hint.textContent = 'Last day of the month period.';
                } else if (period === 'quarter') {
                    label.textContent = 'Quarter Ending Date:';
                    hint.textContent = 'Last day of the quarter period.';
                } else if (period === 'ytd') {
                    label.textContent = 'YTD Ending Date:';
                    hint.textContent = 'Last day of the YTD period.';
                } else if (period === 'custom') {
                    label.textContent = 'End Date:';
                    hint.textContent = 'Select your custom date range.';
                }
            }
        });
    });

    document.getElementById('showUploadMetricsBtn')?.addEventListener('click', () => {
        const container = document.getElementById('pasteDataContainer');
        if (container) {
            const isHidden = window.getComputedStyle(container).display === 'none';
            container.style.display = isHidden ? 'block' : 'none';
        }
    });


    document.getElementById('showUploadSentimentBtn')?.addEventListener('click', openUploadSentimentModal);

    // Verint upload from Upload page
    document.getElementById('showUploadVerintBtn')?.addEventListener('click', () => {
        document.getElementById('uploadVerintFileInput')?.click();
    });
    document.getElementById('uploadVerintFileInput')?.addEventListener('change', async function() {
        var files = Array.from(this.files || []);
        if (!files.length) return;
        var loaded = 0;
        var errors = 0;
        for (var i = 0; i < files.length; i++) {
            try {
                await window.DevCoachModules?.attendanceTracker?.handleVerintUploadFromUploadPage?.(files[i]);
                loaded++;
            } catch (err) {
                console.error('Verint upload error for file ' + files[i].name + ':', err);
                errors++;
            }
        }
        if (typeof showToast === 'function') {
            if (errors > 0) showToast(loaded + ' loaded, ' + errors + ' failed. Check console.', 5000);
            else showToast(loaded + ' Verint file' + (loaded !== 1 ? 's' : '') + ' loaded. View in My Team > Attendance.', 4000);
        }
        this.value = '';
    });

    // Payroll upload from Upload page
    document.getElementById('showUploadPayrollBtn')?.addEventListener('click', () => {
        document.getElementById('uploadPayrollFileInput')?.click();
    });
    document.getElementById('uploadPayrollFileInput')?.addEventListener('change', async function() {
        var file = this.files?.[0];
        if (!file) return;
        if (typeof importPayrollExcel === 'function') {
            importPayrollExcel(file);
        } else if (typeof window.importPayrollExcel === 'function') {
            window.importPayrollExcel(file);
        } else {
            if (typeof showToast === 'function') showToast('PTO module not loaded. Upload from My Team > Attendance.', 5000);
        }
        this.value = '';
    });
    document.getElementById('sentimentUploadCancelBtn')?.addEventListener('click', closeUploadSentimentModal);
    document.getElementById('sentimentUploadSubmitBtn')?.addEventListener('click', handleSentimentUploadSubmit);
    document.getElementById('pasteDataTextarea')?.addEventListener('input', handlePasteDataTextareaInput);
    document.getElementById('loadPastedDataBtn')?.addEventListener('click', handleLoadPastedDataClick);
    document.getElementById('testPastedDataBtn')?.addEventListener('click', handleTestPastedDataClick);
    enableDatePickerOpen(document.getElementById('pasteWeekEndingDate'));

    // Auto-detect period type when either date changes
    document.getElementById('pasteWeekEndingDate')?.addEventListener('change', autoDetectPeriodFromDates);
    document.getElementById('pasteStartDate')?.addEventListener('change', autoDetectPeriodFromDates);
}

function autoDetectPeriodFromDates() {
    const endDate = document.getElementById('pasteWeekEndingDate')?.value;
    if (!endDate) {
        updateDetectedBadge(null);
        return;
    }

    const startDate = document.getElementById('pasteStartDate')?.value;

    // If both dates provided, use range detection
    if (startDate) {
        const detected = detectUploadPeriodTypeByRange(startDate, endDate);
        selectPeriodButton(detected);
        updateDetectedBadge(detected);
        return;
    }

    // Single date — use heuristics
    const endDateObj = new Date(endDate + 'T00:00:00');
    const dayOfWeek = endDateObj.getDay();
    const month = endDateObj.getMonth();
    const day = endDateObj.getDate();
    const year = endDateObj.getFullYear();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const diffFromToday = Math.round((today - endDateObj) / (1000 * 60 * 60 * 24));

    // Sunday → week ending
    if (dayOfWeek === 0) {
        selectPeriodButton('week');
        updateDetectedBadge('week');
        return;
    }

    // End of month
    const nextDay = new Date(year, month, day + 1);
    if (nextDay.getMonth() !== month) {
        if (month === 2 || month === 5 || month === 8 || month === 11) {
            selectPeriodButton('quarter');
            updateDetectedBadge('quarter');
        } else {
            selectPeriodButton('month');
            updateDetectedBadge('month');
        }
        return;
    }

    // Recent date, past first week of month → likely YTD
    if (diffFromToday <= 5 && diffFromToday >= -1 && day > 7) {
        const jan1 = new Date(year, 0, 1);
        const daysFromJan1 = Math.round((endDateObj - jan1) / (1000 * 60 * 60 * 24));
        if (daysFromJan1 > 30) {
            selectPeriodButton('ytd');
            updateDetectedBadge('ytd');
            return;
        }
    }

    // Today/yesterday early in month → daily
    if (diffFromToday >= 0 && diffFromToday <= 1 && day <= 7) {
        selectPeriodButton('daily');
        updateDetectedBadge('daily');
        return;
    }

    // Fallback → week
    selectPeriodButton('week');
    updateDetectedBadge('week');
}

function selectPeriodButton(periodType) {
    const btn = document.querySelector(`.upload-period-btn[data-period="${periodType}"]`);
    if (btn) btn.click();
}

function updateDetectedBadge(periodType) {
    const hint = document.getElementById('periodAutoDetectHint');
    if (!hint) return;
    if (!periodType) { hint.textContent = ''; return; }

    const labels = { daily: 'Daily', week: 'Week', month: 'Month', quarter: 'Quarter', ytd: 'YTD', custom: 'Custom' };
    hint.textContent = `(auto-detected: ${labels[periodType] || periodType})`;
}

function initializeDashboard() {
    window.DevCoachModules?.dashboard?.initializeDashboard?.();
}

function embedTeamSnapshot() {
    const target = document.getElementById('embeddedTeamSnapshot');
    const source = document.getElementById('teamSnapshotSection');
    if (target && source && !target.hasChildNodes()) {
        // Move the inner content from standalone section into the embedded container
        while (source.firstChild) target.appendChild(source.firstChild);
    }
    if (typeof initializeTeamSnapshot === 'function') initializeTeamSnapshot();
}

function embedPtoTracker() {
    const target = document.getElementById('embeddedPto') || document.getElementById('embeddedPtoInMyTeam');
    const source = document.getElementById('ptoSection');
    if (target && source && !target.hasChildNodes()) {
        while (source.firstChild) target.appendChild(source.firstChild);
    }
    if (typeof initializePtoTracker === 'function') initializePtoTracker();
}

function embedPtoInMyTeam() {
    const target = document.getElementById('embeddedPtoInMyTeam');
    const source = document.getElementById('ptoSection');
    if (target && source && !target.hasChildNodes()) {
        while (source.firstChild) target.appendChild(source.firstChild);
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
        showMyTeamSubSection('subSectionMorningPulse', 'subNavMorningPulse');
        if (window.DevCoachModules?.morningPulse?.initializeMorningPulse) window.DevCoachModules.morningPulse.initializeMorningPulse();
    });
    document.getElementById('subNavMorningPulse')?.addEventListener('click', () => {
        showMyTeamSubSection('subSectionMorningPulse', 'subNavMorningPulse');
        if (window.DevCoachModules?.morningPulse?.initializeMorningPulse) window.DevCoachModules.morningPulse.initializeMorningPulse();
    });
    document.getElementById('subNavCoachingEmail')?.addEventListener('click', () => {
        showMyTeamSubSection('subSectionCoachingEmail', 'subNavCoachingEmail');
        initializeCoachingEmail();
    });
    document.getElementById('subNavCallListening')?.addEventListener('click', () => {
        showMyTeamSubSection('subSectionCallListening', 'subNavCallListening');
        initializeCallListeningSection();
    });
    document.getElementById('subNavAttendance')?.addEventListener('click', () => {
        showMyTeamSubSection('subSectionAttendance', 'subNavAttendance');
        if (window.DevCoachModules?.attendanceTracker?.initializeAttendanceTracker) {
            window.DevCoachModules.attendanceTracker.initializeAttendanceTracker();
        }
        embedPtoInMyTeam();
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

    // --- Review Prep ---
    document.getElementById('reviewPrepBtn')?.addEventListener('click', () => {
        showOnlySection('reviewPrepSection');
        ensureReviewPrepMounted('subSectionOnOffTracker');
        showReviewPrepSubSection('subSectionOnOffTracker', 'subNavRpScoreCard');
        initializeOnOffTracker();
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
    if (subSection.parentElement === container) return;
    container.appendChild(subSection);
}

// --- Generic DOM mount helper for Trends & Analysis ---
// Moves an old sub-section div (with its real content) into a new container div

function ensureTrendsMounted(sourceId, targetId) {
    var target = document.getElementById(targetId);
    var source = document.getElementById(sourceId);
    if (!target || !source) return;
    if (source.parentElement === target) return;
    target.appendChild(source);
    source.style.display = 'block';
}

// --- DOM mount helpers for Trends & Analysis ---
// These move content from standalone hidden sections into the new Trends sub-sections

function ensureTrendIntelligenceMountedInTrends() {
    var target = document.getElementById('subSectionTaTrendIntelligence');
    if (!target || target.querySelector('#executiveSummaryContainer')) return;
    var source = document.getElementById('executiveSummarySection');
    if (!source) return;
    while (source.firstChild) target.appendChild(source.firstChild);
}

function ensureMetricTrendsMountedInTrends() {
    var target = document.getElementById('subSectionTaMetricTrends');
    if (!target || target.hasChildNodes()) return;
    var source = document.getElementById('metricTrendsSection');
    if (!source) return;
    while (source.firstChild) target.appendChild(source.firstChild);
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
        if (tipsManagementSection && subSectionCoachingTips && !subSectionCoachingTips.hasChildNodes()) {
            while (tipsManagementSection.firstChild) {
                subSectionCoachingTips.appendChild(tipsManagementSection.firstChild);
            }
        }
        renderTipsManagement();
    });
    document.getElementById('subNavSyncBackup')?.addEventListener('click', () => {
        showManageDataSubSection('subSectionSyncBackup');
        initializeRepoSyncControls();
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
    document.getElementById('generateTodaysFocusBtn')?.addEventListener('click', generateTodaysFocus);
    document.getElementById('copyTodaysFocusBtn')?.addEventListener('click', copyTodaysFocus);
    document.getElementById('generateTodaysFocusCopilotBtn')?.addEventListener('click', generateTodaysFocusCopilotEmail);
    document.getElementById('generateOneOnOneBtn')?.addEventListener('click', generateOneOnOnePrep);
    document.getElementById('copyOneOnOneBtn')?.addEventListener('click', copyOneOnOnePrep);
    document.getElementById('redFlagBtn')?.addEventListener('click', () => showOnlySection('redFlagSection'));
    document.getElementById('subNavTeamSnapshot')?.addEventListener('click', () => {
        showMyTeamSubSection('subSectionTeamSnapshot', 'subNavTeamSnapshot');
        embedTeamSnapshot();
    });

    document.getElementById('refreshDebugBtn')?.addEventListener('click', renderDebugPanel);
    document.getElementById('copyDebugBtn')?.addEventListener('click', copyDebugInfo);
    document.getElementById('clearDebugBtn')?.addEventListener('click', () => {
        debugState.entries = [];
        renderDebugPanel();
        showToast('✅ Debug errors cleared', 3000);
    });
}

function bindCoachingFormHandlers() {
    document.querySelectorAll('.period-type-btn').forEach(btn => {
        btn.addEventListener('click', () => handlePeriodTypeButtonClick(btn));
    });
    document.getElementById('specificPeriod')?.addEventListener('change', handleSpecificPeriodChange);
    document.getElementById('employeeSelect')?.addEventListener('change', handleEmployeeSelectChange);
    document.getElementById('employeeSearch')?.addEventListener('input', handleEmployeeSearchInput);
    document.getElementById('generateCopilotPromptBtn')?.addEventListener('click', generateCopilotPrompt);
    document.getElementById('copilotOutputText')?.addEventListener('input', handleCopilotOutputInput);
    document.getElementById('generateVerintSummaryBtn')?.addEventListener('click', generateVerintSummary);
    Object.keys(METRICS_REGISTRY).forEach(metricKey => {
        document.getElementById(metricKey)?.addEventListener('input', applyMetricHighlights);
    });
    document.getElementById('exportDataBtn')?.addEventListener('click', exportToExcel);
    document.getElementById('exportCoachingHistoryBtn')?.addEventListener('click', downloadCoachingHistoryCSV);
    document.getElementById('uploadMoreDataBtn')?.addEventListener('click', handleUploadMoreDataClick);
    document.getElementById('importDataBtn')?.addEventListener('click', () => {
        document.getElementById('dataFileInput').click();
    });
    document.getElementById('dataFileInput')?.addEventListener('change', handleDataFileInputChange);
}

function bindDataAdminHandlers() {
    document.getElementById('deleteSelectedWeekBtn')?.addEventListener('click', handleDeleteSelectedWeekClick);
    document.getElementById('selectAllTeamBtn')?.addEventListener('click', handleSelectAllTeamClick);
    document.getElementById('deselectAllTeamBtn')?.addEventListener('click', handleDeselectAllTeamClick);
    document.getElementById('deleteWeekSelect')?.addEventListener('change', handleDeleteWeekSelectChange);
    document.getElementById('toggleTeamMemberSelectorBtn')?.addEventListener('click', handleToggleTeamMembersEmployeesPanelClick);
    applyTeamMembersEmployeesPanelState(loadTeamMembersEmployeesPanelExpandedPreference());

    populateDeleteSentimentDropdown();
    populateDeleteEmployeeYearOptions();

    document.getElementById('deleteEmployeeYearBtn')?.addEventListener('click', handleDeleteEmployeeYearClick);
    document.getElementById('deleteSelectedSentimentBtn')?.addEventListener('click', handleDeleteSelectedSentimentClick);
    document.getElementById('deleteAllDataBtn')?.addEventListener('click', handleDeleteAllDataClick);
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
        preview.style.background = '#d4edda';
        preview.style.border = '2px solid #28a745';
        preview.style.color = '#155724';
        preview.innerHTML = `
            ✅ <strong>Data looks good!</strong><br>
            📊 ${validation.employeeCount} employees detected<br>
            👤 Preview: ${validation.preview.join(', ')}${validation.employeeCount > 3 ? '...' : ''}
        `;
    } else {
        preview.style.background = '#f8d7da';
        preview.style.border = '2px solid #dc3545';
        preview.style.color = '#721c24';
        preview.innerHTML = `
            ⚠️ <strong>Data validation issues:</strong><br>
            ${validation.issues.map(i => `• ${i}`).join('<br>')}
        `;
    }
}

// Legacy stubs for any code that still references old inner tab functions
function handleSubNavMetricTrendsClick(skipShowSubSection) {
    ensureMetricTrendsMountedInTrends();
    initializeMetricTrends();
}

function handleSubNavTrendIntelligenceClick(skipShowSubSection) {
    ensureTrendIntelligenceMountedInTrends();
    renderExecutiveSummary();
}

function handleCopilotOutputInput(event) {
    const verintBtn = document.getElementById('generateVerintSummaryBtn');
    const hasContent = event.target.value.trim().length > 0;

    if (verintBtn) {
        verintBtn.disabled = !hasContent;
        verintBtn.style.opacity = hasContent ? '1' : '0.5';
        verintBtn.style.cursor = hasContent ? 'pointer' : 'not-allowed';
    }
}

function handleUploadMoreDataClick() {
    document.getElementById('uploadSuccessMessage').style.display = 'none';
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
        while (sentimentSection.firstChild) {
            subSectionSentiment.appendChild(sentimentSection.firstChild);
        }
    }

    if (!sentimentListenersAttached) {
        document.getElementById('generateSentimentSummaryBtn')?.addEventListener('click', generateSentimentSummary);
        document.getElementById('copySentimentSummaryBtn')?.addEventListener('click', copySentimentSummary);
        document.getElementById('generateCoPilotPromptBtn')?.addEventListener('click', generateSentimentCoPilotPrompt);
        document.getElementById('sentimentPositiveFile')?.addEventListener('change', () => handleSentimentFileChange('Positive'));
        document.getElementById('sentimentNegativeFile')?.addEventListener('change', () => handleSentimentFileChange('Negative'));
        document.getElementById('sentimentEmotionsFile')?.addEventListener('change', () => handleSentimentFileChange('Emotions'));
        document.getElementById('sentimentPositivePasteBtn')?.addEventListener('click', (e) => { e.preventDefault(); openSentimentPasteModal('Positive'); });
        document.getElementById('sentimentNegativePasteBtn')?.addEventListener('click', (e) => { e.preventDefault(); openSentimentPasteModal('Negative'); });
        document.getElementById('sentimentEmotionsPasteBtn')?.addEventListener('click', (e) => { e.preventDefault(); openSentimentPasteModal('Emotions'); });
        document.getElementById('savePhraseDatabaseBtn')?.addEventListener('click', saveSentimentPhraseDatabaseFromForm);
        document.getElementById('saveAssociateSentimentSnapshotBtn')?.addEventListener('click', saveAssociateSentimentSnapshotFromCurrentReports);
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
    if (daysDiff >= 26 && daysDiff <= 33) return 'month';
    if (daysDiff >= 88 && daysDiff <= 95) return 'quarter';
    if (daysDiff >= 180) return 'ytd';
    return 'week';
}

function resolveSelectedUploadPeriodType(detectedPeriodType) {
    // Respect the user's explicit selection — don't auto-override
    const selectedBtn = document.querySelector('.upload-period-btn[style*="background: rgb(40, 167, 69)"]') ||
        document.querySelector('.upload-period-btn[style*="background:#28a745"]');
    if (selectedBtn) {
        return selectedBtn.dataset.period;
    }

    // No button selected, use detection
    return detectedPeriodType;
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
    } else if (periodType === 'month') {
        label = `${startDateObj.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;
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

function syncWeeklyViewAfterPastedUpload(weekKey) {
    currentPeriodType = 'week';

    document.querySelectorAll('.period-type-btn').forEach(b => {
        b.style.background = 'white';
        b.style.color = '#666';
        b.style.borderColor = '#ddd';
    });
    const weekBtn = document.querySelector('.period-type-btn[data-period="week"]');
    if (weekBtn) {
        weekBtn.style.background = '#2196F3';
        weekBtn.style.color = 'white';
        weekBtn.style.borderColor = '#2196F3';
    }

    updatePeriodDropdown();

    const periodDropdown = document.getElementById('specificPeriod');
    if (periodDropdown) {
        for (let index = 0; index < periodDropdown.options.length; index += 1) {
            if (periodDropdown.options[index].value === weekKey) {
                periodDropdown.selectedIndex = index;
                currentPeriod = weekKey;
                updateEmployeeDropdown();
                break;
            }
        }
    }
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

    // Check which period type button is selected
    const selectedDailyBtn = document.querySelector('.upload-period-btn[data-period="daily"][style*="background: rgb(40, 167, 69)"]') ||
        document.querySelector('.upload-period-btn[data-period="daily"][style*="background:#28a745"]');
    const selectedCustomBtn = document.querySelector('.upload-period-btn[data-period="custom"][style*="background: rgb(40, 167, 69)"]') ||
        document.querySelector('.upload-period-btn[data-period="custom"][style*="background:#28a745"]');
    const isDailySelected = !!selectedDailyBtn;
    const isCustomSelected = !!selectedCustomBtn;

    const selectedYtdBtn = document.querySelector('.upload-period-btn[data-period="ytd"][style*="background: rgb(40, 167, 69)"]') ||
        document.querySelector('.upload-period-btn[data-period="ytd"][style*="background:#28a745"]');
    const isYtdSelected = !!selectedYtdBtn;

    let startDate;
    if (isCustomSelected) {
        startDate = document.getElementById('pasteStartDate')?.value;
        if (!startDate) {
            alert('⚠️ Please select a start date for your custom range.');
            return;
        }
        if (startDate > endDate) {
            alert('⚠️ Start date cannot be after end date.');
            return;
        }
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

        const qualityWarnings = buildMetricsUploadQualityWarnings(employees);
        if (qualityWarnings.length) {
            const proceed = confirm(`⚠️ Upload quality warning:\n\n${qualityWarnings.join('\n')}\n\nContinue saving this upload?`);
            if (!proceed) {
                return;
            }
        }

        const weekKey = `${startDate}|${endDate}`;

        // Check if data already exists for this period and warn about what's missing/changing
        const targetStore = periodType === 'ytd' ? ytdData : weeklyData;
        const existingData = targetStore[weekKey];
        if (existingData && existingData.employees && existingData.employees.length > 0) {
            const existingCount = existingData.employees.length;
            const newCount = employees.length;
            // Check which metrics the new upload has that old didn't, and vice versa
            const metricKeys = ['scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience', 'transfers', 'aht', 'overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions', 'reliability'];
            const metricLabels = { scheduleAdherence: 'Adherence', cxRepOverall: 'RepSat', fcr: 'FCR', overallExperience: 'OE', transfers: 'Transfers', aht: 'AHT', overallSentiment: 'Sentiment', positiveWord: '+Word', negativeWord: '-Word', managingEmotions: 'Emotions', reliability: 'Reliability' };
            const hasData = (emps, key) => emps.some(e => e[key] !== '' && e[key] !== 0 && e[key] !== null && e[key] !== undefined);
            const oldHas = metricKeys.filter(k => hasData(existingData.employees, k));
            const newHas = metricKeys.filter(k => hasData(employees, k));
            const newlyAdded = newHas.filter(k => !oldHas.includes(k)).map(k => metricLabels[k]);
            const willLose = oldHas.filter(k => !newHas.includes(k)).map(k => metricLabels[k]);

            let overwriteMsg = `⚠️ Data already exists for this period (${existingCount} employees).\n\nNew upload: ${newCount} employees.\n`;
            if (newlyAdded.length) overwriteMsg += `\n✅ New metrics being added: ${newlyAdded.join(', ')}`;
            if (willLose.length) overwriteMsg += `\n❌ Metrics that will be LOST (not in new data): ${willLose.join(', ')}`;
            if (!newlyAdded.length && !willLose.length) overwriteMsg += `\nMetrics are the same — data values will be updated.`;
            overwriteMsg += `\n\nOverwrite existing data?`;

            if (!confirm(overwriteMsg)) return;
        }

        const yearEndProfileSelect = document.getElementById('uploadYearEndProfile');
        const selectedYearEndProfile = (yearEndProfileSelect?.value || 'auto').trim();
        const uploadContext = buildPastedUploadContext(startDate, endDate, periodType, selectedYearEndProfile);
        const { label, normalizedEndDate, metadata } = uploadContext;

        targetStore[weekKey] = {
            employees,
            metadata
        };

        if (periodType !== 'ytd') {
            upsertAutoYtdForYear(normalizedEndDate.getFullYear(), endDate);
        }

        saveWeeklyData();
        saveYtdData();

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
        populateTeamMemberSelector();

        document.getElementById('uploadSuccessMessage').style.display = 'block';
        document.getElementById('pasteDataTextarea').value = '';

        showOnlySection('uploadSection');

        if (periodType !== 'ytd') {
            syncWeeklyViewAfterPastedUpload(weekKey);
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

    // Check if Daily or Custom is selected
    const testDailyBtn = document.querySelector('.upload-period-btn[data-period="daily"][style*="background: rgb(40, 167, 69)"]') ||
        document.querySelector('.upload-period-btn[data-period="daily"][style*="background:#28a745"]');
    const testCustomBtn = document.querySelector('.upload-period-btn[data-period="custom"][style*="background: rgb(40, 167, 69)"]') ||
        document.querySelector('.upload-period-btn[data-period="custom"][style*="background:#28a745"]');
    const isTestDaily = !!testDailyBtn;
    const isTestCustom = !!testCustomBtn;

    if (weekEndingDate) {
        if (isTestCustom) {
            startDate = document.getElementById('pasteStartDate')?.value || weekEndingDate;
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
        if (isTestCustom) {
            startDate = document.getElementById('pasteStartDate')?.value || endDate;
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
            return `<div style="font-size: 0.85em; margin: 2px 0;"><strong>${emp.firstName || emp.name}</strong>: ${vals}</div>`;
        }).join('');

        if (preview) {
            preview.style.display = 'block';
            preview.style.background = '#d4edda';
            preview.style.border = '2px solid #28a745';
            preview.style.color = '#155724';
            preview.innerHTML = `
                ✅ <strong>Test Upload Passed (No Save Performed)</strong><br>
                📅 Parse window: ${dateLabel}<br>
                👥 Employees parsed: ${employees.length}<br>
                👤 Sample: ${sampleNames}${employees.length > 5 ? '...' : ''}<br>
                <div style="margin-top: 8px;"><strong>Metric coverage:</strong><br>${metricCoverage}</div>
                <div style="margin-top: 8px; padding: 8px; background: #f8f9fa; border-radius: 4px; color: #333;"><strong>Spot check (parsed values):</strong><br>${spotCheckHtml}</div>
                ${qualityHtml}
            `;
        }

        showToast(`✅ Test Upload passed for ${employees.length} employees (no data saved).`, 4500);
    } catch (error) {
        console.error('Error in test parse:', error);
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

            showToast('✅ Data imported successfully!');
            document.getElementById('dataFileInput').value = '';
            populateDeleteWeekDropdown();
            populateDeleteSentimentDropdown();
            populateDeleteEmployeeYearOptions();
            populateTeamMemberSelector();
            renderEmployeesList();
        } catch (error) {
            console.error('Error importing data:', error);
            alert('ℹ️ Error importing data: ' + error.message);
        }
    };
    reader.readAsText(file);
}

function handleDeleteAllDataClick() {
    const message = `⚠️ WARNING: This will permanently delete ALL data:\n\n` +
        `• All weekly, monthly, quarterly, and YTD uploads\n` +
        `• Team member selections\n` +
        `• Coaching history\n` +
        `• Call center averages\n` +
        `• Call listening logs\n` +
        `• Sentiment data\n` +
        `• All saved notes and preferences\n\n` +
        `This action CANNOT be undone!\n\n` +
        `Type "DELETE" to confirm:`;

    const confirmation = prompt(message);
    if (confirmation !== 'DELETE') {
        alert('⚠️ Deletion cancelled');
        return;
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

    // Reset all in-memory state
    weeklyData = {};
    ytdData = {};
    myTeamMembers = {};
    callListeningLogs = {};
    coachingHistory = {};
    sentimentPhraseDatabase = null;
    associateSentimentSnapshots = {};
    coachingLatestWeekKey = null;
    yearEndDraftContext = null;

    // Refresh the page for a clean state
    alert('✅ All data has been deleted. The page will now reload.');
    location.reload();
}

function handlePeriodTypeButtonClick(button) {
    document.querySelectorAll('.period-type-btn').forEach(btn => {
        btn.style.background = 'white';
        btn.style.color = '#666';
        btn.style.borderColor = '#ddd';
    });
    button.style.background = '#2196F3';
    button.style.color = 'white';
    button.style.borderColor = '#2196F3';

    currentPeriodType = button.dataset.period;
    updatePeriodDropdown();

    const periodDropdown = document.getElementById('specificPeriod');
    if (periodDropdown && periodDropdown.options.length > 1) {
        periodDropdown.selectedIndex = 1;
        currentPeriod = periodDropdown.value;
        updateEmployeeDropdown();
    }
}

function handleSpecificPeriodChange(event) {
    currentPeriod = event.target.value;
    if (currentPeriod) {
        updateEmployeeDropdown();
    }
}

function handleEmployeeSelectChange(event) {
    const selectedName = event.target.value;

    if (selectedName) {
        saveSmartDefault('lastEmployee', selectedName);
    }

    if (!selectedName) {
        ['metricsSection', 'employeeInfoSection', 'customNotesSection', 'generateEmailBtn'].forEach(id => {
            const element = document.getElementById(id);
            if (element) element.style.display = 'none';
        });
        return;
    }

    const employee = getEmployeeDataForPeriod(selectedName);
    if (!employee) {
        alert('ℹ️ Error loading employee data');
        return;
    }

    ['employeeInfoSection', 'metricsSection', 'aiAssistSection', 'customNotesSection'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'block';
    });

    const oldGenerateBtn = document.getElementById('generateEmailBtn');
    if (oldGenerateBtn) oldGenerateBtn.style.display = 'none';

    const savedNickname = getSavedNickname(selectedName);
    const defaultNickname = getEmployeeNickname(selectedName) || employee.firstName || '';
    document.getElementById('employeeName').value = savedNickname || defaultNickname;
    populateMetricInputs(employee);

    const surveyStatusEl = document.getElementById('surveyStatusMsg');
    if (surveyStatusEl) {
        const hasSurveys = (employee.surveyTotal || 0) > 0;
        surveyStatusEl.textContent = hasSurveys ? '' : 'No surveys in this period; survey-based metrics are omitted.';
    }

    document.getElementById('employeeName').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function handleEmployeeSearchInput(event) {
    const searchText = event.target.value.toLowerCase();
    const dropdown = document.getElementById('employeeSelect');
    if (!dropdown) return;

    const options = dropdown.options;
    for (let index = 1; index < options.length; index += 1) {
        const option = options[index];
        const text = option.textContent.toLowerCase();
        option.style.display = text.includes(searchText) ? '' : 'none';
    }
}

function handleDeleteSelectedWeekClick() {
    const weekSelect = document.getElementById('deleteWeekSelect');
    const selectedWeek = weekSelect.value;

    if (!selectedWeek) {
        alert('⚠️ Please select a week to delete');
        return;
    }

    const weekLabel = weekSelect.options[weekSelect.selectedIndex].text;
    if (!confirm(`Are you sure you want to delete data for:\n\n${weekLabel}\n\nThis action cannot be undone.`)) {
        return;
    }

    delete weeklyData[selectedWeek];
    delete myTeamMembers[selectedWeek];
    saveWeeklyData();
    normalizeTeamMembersForExistingWeeks();
    saveTeamMembers();

    populateDeleteWeekDropdown();
    populateDeleteSentimentDropdown();
    populateDeleteEmployeeYearOptions();
    populateTeamMemberSelector();
    renderEmployeesList();
    showToast('✅ Week deleted successfully');

    const employeeSelect = document.getElementById('employeeSelect');
    if (employeeSelect) employeeSelect.value = '';

    ['metricsSection', 'employeeInfoSection', 'customNotesSection', 'generateEmailBtn'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
    });
}

function handleSelectAllTeamClick() {
    document.querySelectorAll('.team-member-checkbox').forEach(checkbox => {
        checkbox.checked = true;
    });
    updateTeamSelection();
}

function handleDeselectAllTeamClick() {
    document.querySelectorAll('.team-member-checkbox').forEach(checkbox => {
        checkbox.checked = false;
    });
    updateTeamSelection();
}

function handleDeleteWeekSelectChange() {
    const panelToggleButton = document.getElementById('toggleTeamMemberSelectorBtn');
    const isExpanded = panelToggleButton?.getAttribute('aria-expanded') === 'true';
    notifyTeamFilterChanged();
    if (isExpanded) {
        populateTeamMemberSelector();
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
        populateTeamMemberSelector();
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
        queueRepoSync('year-end annual goals updated');
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
        queueRepoSync('year-end draft updated');
    } catch (error) {
        console.error('Error saving year-end draft store:', error);
    }
}

function loadCallListeningLogs() {
    try {
        const raw = localStorage.getItem(CALL_LISTENING_LOGS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        console.error('Error loading call listening logs:', error);
        return {};
    }
}

function saveCallListeningLogs(triggerSync = true, reason = 'updated') {
    try {
        if (!saveWithSizeCheck('callListeningLogs', callListeningLogs || {})) {
            console.error('Failed to save call listening logs due to size');
        }
        if (triggerSync) {
            queueCallListeningRepoSync(reason);
        }
    } catch (error) {
        console.error('Error saving call listening logs:', error);
    }
}

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

function openRepoUploadsFolder() {
    return window.DevCoachModules?.repoSync?.openRepoUploadsFolder?.();
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
    const origin = window?.location?.origin;
    const timestamp = Date.now();
    const urls = [];

    if (origin && origin !== 'null') {
        urls.push(`${origin}/data/coaching-tool-sync-backup.json?cb=${timestamp}`);
    }

    urls.push(`https://raw.githubusercontent.com/ScottK83/Development-Coaching-Tool/main/data/coaching-tool-sync-backup.json?cb=${timestamp}`);

    const payloadCandidates = [];

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

function applyRepoBackupPayload(payload) {
    return window.DevCoachModules?.repoSync?.applyRepoBackupPayload?.(payload);
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
        const shouldRestore = confirm(`Your data was updated on another computer on ${remoteWhen}.\n\nClick OK to sync this PC with that newer data.\nClick Cancel to keep this PC's current data as-is.`);
        if (!shouldRestore) {
            return false;
        }
    }

    await withRepoSyncHydrationLock(async () => {
        applyRepoBackupPayload(payload);
    });

    saveRepoBackupAppliedAt(new Date().toISOString());

    return true;
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
        'Created At'
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
        toCsvCell(entry.createdAt ? new Date(entry.createdAt).toLocaleString() : '')
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
                    <div style="font-size: 0.85em; color: #666;">Goal: ${escapeHtml(goal.expectation)}</div>
                </div>
                <select data-goal-status="${goal.key}" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;">
                    <option value="met"${current.status === 'met' ? ' selected' : ''}>✅ Meeting</option>
                    <option value="not-met"${current.status === 'not-met' ? ' selected' : ''}>⚠️ Not Met</option>
                </select>
                <input type="text" data-goal-note="${goal.key}" value="${safeNote}" placeholder="Optional note/details" style="width: 100%; padding: 6px 8px; border: 1px solid #ddd; border-radius: 4px;">
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

    const allData = Object.assign({}, weeklyData, ytdData);
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
    
    console.log('🔍 Populating sentiment dropdown. Current data:', associateSentimentSnapshots);
    
    const sentimentEntries = [];
    
    // Iterate through all employees and their sentiment snapshots
    Object.entries(associateSentimentSnapshots || {}).forEach(([employeeId, snapshots]) => {
        console.log(`  Employee: ${employeeId}, Snapshots:`, snapshots);
        if (Array.isArray(snapshots)) {
            snapshots.forEach(snapshot => {
                const timeframe = `${snapshot.timeframeStart} to ${snapshot.timeframeEnd}`;
                sentimentEntries.push({
                    key: `${employeeId}|${timeframe}`,
                    label: `${snapshot.associateName || employeeId} - ${timeframe}`,
                    date: new Date(snapshot.savedAt || snapshot.timeframeEnd)
                });
            });
        }
    });
    
    console.log(`📊 Found ${sentimentEntries.length} sentiment entries to display`);
    
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

    const currentValue = dropdown.value;
    dropdown.innerHTML = '<option value="">-- Choose an associate --</option>';

    const employees = getYearEndEmployees();
    employees.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        dropdown.appendChild(option);
    });

    if (currentValue && employees.includes(currentValue)) {
        dropdown.value = currentValue;
    }
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
    populateTeamMemberSelector();
    renderEmployeesList();

    showToast(`✅ Removed ${employeeName} ${reviewYear} data (weekly: ${weeklyPeriodsTouched}, ytd: ${ytdPeriodsTouched}, coaching entries: ${coachingEntriesRemoved}, call logs: ${callEntriesRemoved}).`, 4500);
}

function populateTeamMemberSelector() {
    const selector = document.getElementById('teamMemberSelector');
    const deleteWeekDropdown = document.getElementById('deleteWeekSelect');
    
    if (!selector) return;
    
    // Get currently selected week (from delete dropdown or most recent)
    let selectedWeek = deleteWeekDropdown?.value;
    
    if (!selectedWeek) {
        // Use the most recent week if none selected
        const weeks = Object.keys(weeklyData).concat(Object.keys(ytdData || {})).sort().reverse();
        selectedWeek = weeks[0];
    }

    if (!selectedWeek || !(weeklyData[selectedWeek] || (ytdData && ytdData[selectedWeek]))) {
        selector.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No data available</div>';
        return;
    }

    const employees = (weeklyData[selectedWeek] || ytdData[selectedWeek]).employees || [];
    const selectedMembers = getTeamMembersForWeek(selectedWeek);
    
    if (employees.length === 0) {
        selector.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No employees in this week</div>';
        return;
    }
    
    // Create checkboxes for each employee
    let html = '';
    employees.forEach(emp => {
        const isSelected = selectedMembers.length === 0 || selectedMembers.includes(emp.name);
        const escapedName = escapeHtml(emp.name);
        html += `
            <label style="display: flex; align-items: center; gap: 10px; padding: 8px; cursor: pointer; hover: background: #f5f5f5;">
                <input type="checkbox" class="team-member-checkbox" data-week="${selectedWeek}" data-name="${escapedName}" ${isSelected ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
                <span>${escapedName}</span>
            </label>
        `;
    });
    
    selector.innerHTML = html;
    
    // Add event listeners to checkboxes
    document.querySelectorAll('.team-member-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', updateTeamSelection);
    });
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

function initializeKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        // Don't trigger when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') {
            return;
        }
        
        // Ctrl+G - Generate email
        if (e.ctrlKey && e.key === 'g') {
            e.preventDefault();
            const generateBtn = document.getElementById('generateEmailBtn');
            if (generateBtn && generateBtn.style.display !== 'none') {
                generateBtn.click();
            }
        }
        
        // Ctrl+S - Save/backup
        if (e.ctrlKey && e.key === 's') {
            e.preventDefault();
            document.getElementById('exportDataBtn')?.click();
        }
        
        // Ctrl+H - Employee History
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
        
        // Escape - Clear form
        if (e.key === 'Escape') {
            const employeeSelect = document.getElementById('employeeSelect');
            if (employeeSelect && employeeSelect.value) {
                employeeSelect.value = '';
                employeeSelect.dispatchEvent(new Event('change'));
                showToast('✅ Form cleared');
            }
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

function parseWeekKeyDate(weekKey, week) {
    // Try metadata endDate first (most reliable, ISO format)
    const endDate = week?.metadata?.endDate;
    if (endDate) {
        const parsed = Date.parse(endDate);
        if (Number.isFinite(parsed)) return parsed;
    }

    // Try parsing from the weekKey itself (format: "startDate|endDate")
    const parts = (weekKey || '').split('|');
    const keyEnd = parts[1] || parts[0] || '';
    if (keyEnd) {
        const parsed = Date.parse(keyEnd);
        if (Number.isFinite(parsed)) return parsed;
    }

    // Fallback: try label/weekEnding
    const label = week?.metadata?.label || week?.metadata?.weekEnding || '';
    const match = label.match(/Week ending\s+(.+)$/i);
    const dateStr = match ? match[1] : label;
    if (dateStr) {
        const parsed = Date.parse(dateStr);
        if (Number.isFinite(parsed)) return parsed;
    }

    return 0;
}

function getLatestWeeklyKey() {
    const keys = getWeeklyKeysSorted();
    return keys.length ? keys[keys.length - 1] : null;
}

function getPreviousWeeklyKey(latestKey) {
    const keys = getWeeklyKeysSorted();
    const idx = keys.indexOf(latestKey);
    if (idx > 0) return keys[idx - 1];
    return null;
}

function getTrendPeriodDescriptor(periodType) {
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
    if (!Array.isArray(keys) || keys.length === 0) {
        return {
            descriptor,
            currentKeys: [],
            previousKeys: [],
            thirdKeys: []
        };
    }

    if (periodType === 'mom') {
        return {
            descriptor,
            currentKeys: keys.slice(-4),
            previousKeys: keys.slice(-8, -4),
            thirdKeys: keys.slice(-12, -8)
        };
    }

    if (periodType === 'ytd') {
        const yearBuckets = {};
        keys.forEach(weekKey => {
            const parsed = parseWeekKeyDate(weekKey, weeklyData[weekKey]);
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
        currentKeys: keys.slice(-1),
        previousKeys: keys.slice(-2, -1),
        thirdKeys: keys.slice(-3, -2)
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
        const week = weeklyData[weekKey];
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
        const employees = weeklyData[weekKey]?.employees || [];
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
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">Upload at least 2 periods of data to generate a priority queue.</div>';
        return;
    }

    const periodType = document.getElementById('trendPeriodSelector')?.value || 'wow';
    const buckets = getTrendComparisonBuckets(keys, periodType);

    if (!buckets.currentKeys.length || !buckets.previousKeys.length) {
        container.innerHTML = `<div style="color: #666; font-size: 0.95em;">Not enough data for ${buckets.descriptor.label} queue generation.</div>`;
        return;
    }

    const employeeNames = Array.from(getEmployeeNamesForPeriod(buckets.currentKeys)).sort();
    if (!employeeNames.length) {
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">No employees found in the current window.</div>';
        return;
    }

    const coreMetrics = ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment', 'transfers', 'aht'];
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

    const meetsAllCore = ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment'].every(metricKey =>
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
        html += `<div style="margin-top: 6px; color: #666; font-size: 0.9em;">${emptyText}</div>`;
    } else {
        html += '<div style="margin-top: 6px; display: grid; gap: 6px;">';
        entries.slice(0, 5).forEach(entry => {
            const whyText = Array.isArray(entry.why) && entry.why.length
                ? entry.why.slice(0, 3).join(' • ')
                : entry.reason;
            html += `<div>
                <div><strong>${entry.name}</strong> • Score ${entry.score} • ${entry.reason}</div>
                <div style="margin-top: 2px; color: #455a64; font-size: 0.88em;"><strong>${whyLabel}</strong> ${whyText}</div>
            </div>`;
        });
        html += '</div>';
    }
    html += '</div>';
    return html;
}

function buildTrendSeriesData(metricKey, employeeName, keys, periodType) {
    const toMetricValue = (weekKey) => {
        const employee = weeklyData[weekKey]?.employees?.find(e => e.name === employeeName);
        const value = parseFloat(employee?.[metricKey]);
        return Number.isNaN(value) ? null : value;
    };

    if (periodType === 'mom') {
        const monthBuckets = {};
        keys.forEach(weekKey => {
            const parsed = parseWeekKeyDate(weekKey, weeklyData[weekKey]);
            if (!parsed) return;
            const date = new Date(parsed);
            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            if (!monthBuckets[monthKey]) {
                monthBuckets[monthKey] = { label: date.toLocaleString('en-US', { month: 'short', year: '2-digit' }), values: [] };
            }
            const value = toMetricValue(weekKey);
            if (value !== null) monthBuckets[monthKey].values.push(value);
        });

        return Object.keys(monthBuckets)
            .sort()
            .map(key => ({
                label: monthBuckets[key].label,
                value: monthBuckets[key].values.length
                    ? monthBuckets[key].values.reduce((a, b) => a + b, 0) / monthBuckets[key].values.length
                    : null
            }))
            .filter(item => item.value !== null)
            .slice(-6);
    }

    if (periodType === 'ytd') {
        const yearBuckets = {};
        keys.forEach(weekKey => {
            const parsed = parseWeekKeyDate(weekKey, weeklyData[weekKey]);
            if (!parsed) return;
            const year = new Date(parsed).getFullYear();
            if (!yearBuckets[year]) yearBuckets[year] = [];
            const value = toMetricValue(weekKey);
            if (value !== null) yearBuckets[year].push(value);
        });

        return Object.keys(yearBuckets)
            .map(year => parseInt(year, 10))
            .sort((a, b) => a - b)
            .map(year => ({
                label: `${year}`,
                value: yearBuckets[year].length
                    ? yearBuckets[year].reduce((a, b) => a + b, 0) / yearBuckets[year].length
                    : null
            }))
            .filter(item => item.value !== null)
            .slice(-5);
    }

    return keys
        .slice(-8)
        .map(weekKey => ({ label: formatWeekLabel(weekKey), value: toMetricValue(weekKey) }))
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
        return JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'tipUsageHistory') || '{}');
    } catch {
        return {};
    }
}

function saveTipUsageHistory(history) {
    localStorage.setItem(STORAGE_PREFIX + 'tipUsageHistory', JSON.stringify(history));
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
    const pickFrom = available.length ? available : tips;
    const severityFiltered = pickFrom.filter(tip => {
        if (severity === 'high') return tip.length <= 120;
        if (severity === 'low') return tip.length >= 60;
        return true;
    });

    const selectionPool = severityFiltered.length ? severityFiltered : pickFrom;
    const chosen = selectionPool[Math.floor(Math.random() * selectionPool.length)];

    const updated = metricHistory.concat([{ tip: chosen, usedAt: new Date().toISOString() }]).slice(-50);
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
        const log = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'complianceLog') || '[]');
        log.push(entry);
        localStorage.setItem(STORAGE_PREFIX + 'complianceLog', JSON.stringify(log.slice(-200)));
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

let trendIntelligenceListenersAttached = false;
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
        ? topCoach.map(entry => `<li style="margin-bottom: 4px;"><strong>${entry.name}</strong> — ${entry.reason}</li>`).join('')
        : '<li>No urgent coaching interventions this cycle.</li>';

    const recognizeHtml = topRecognize.length
        ? topRecognize.map(entry => `<li style="margin-bottom: 4px;"><strong>${entry.name}</strong> — ${entry.reason}</li>`).join('')
        : '<li>No standout recognition callouts this cycle.</li>';

    container.innerHTML = `
        ${goalsSummaryHtml}
        <div style="padding: 14px; border: 1px solid #d7e7ff; border-radius: 8px; background: #f8fbff;">
            <div style="font-weight: 700; color: #2f4f87; margin-bottom: 8px;">🧭 Simple View — This Week’s Priorities</div>
            <div style="color: #546e7a; font-size: 0.9em; margin-bottom: 10px;">${modeLabel} • Team Members Scored: ${scoredCount}</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px;">
                <div style="padding: 10px; border-radius: 6px; background: #fff0f0; border: 1px solid #f3c9c9;">
                    <div style="font-weight: 700; color: #b71c1c; margin-bottom: 6px;">Coach First (Top 3)</div>
                    <ul style="margin: 0; padding-left: 18px; color: #333;">${coachHtml}</ul>
                </div>
                <div style="padding: 10px; border-radius: 6px; background: #eef8f0; border: 1px solid #cde6d1;">
                    <div style="font-weight: 700; color: #1b5e20; margin-bottom: 6px;">Recognize Now (Top 2)</div>
                    <ul style="margin: 0; padding-left: 18px; color: #333;">${recognizeHtml}</ul>
                </div>
            </div>
        </div>
    `;
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

    const fallbackCopy = () => {
        navigator.clipboard.writeText(text).then(() => {
            showToast('✅ This Week Plan copied', 2800);
        }).catch(() => {
            showToast('Unable to copy This Week Plan', 3000);
        });
    };

    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text)
            .then(() => showToast('✅ This Week Plan copied', 2800))
            .catch(() => fallbackCopy());
        return;
    }

    fallbackCopy();
}

function getTrendSelectedEmployee() {
    return document.getElementById('trendEmployeeSelector')?.value || '';
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
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">No coaching impact data yet. Log coaching sessions to track momentum and outcomes.</div>';
        return;
    }

    const selectedEmployee = getTrendSelectedEmployee();
    const spotlight = selectedEmployee ? scored.find(s => s.employeeName === selectedEmployee) : scored[0];
    const list = selectedEmployee ? [spotlight].filter(Boolean) : scored.slice(0, 5);

    container.innerHTML = list.map(item => `
        <div style="padding: 10px; border: 1px solid #e6eefc; border-radius: 6px; background: #f8fbff;">
            <strong>${item.employeeName}</strong><br>
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
        
        const currentValue = employeeSelect.value;
        const firstOption = employeeSelect.querySelector('option[value=""]');
        employeeSelect.innerHTML = '';
        if (firstOption) employeeSelect.appendChild(firstOption.cloneNode(true));
        
        Array.from(allEmployees).sort().forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            option.textContent = name;
            employeeSelect.appendChild(option);
        });
        
        if (currentValue && Array.from(allEmployees).includes(currentValue)) {
            employeeSelect.value = currentValue;
        }
    }

    // Attach event listeners once
    if (!trendIntelligenceListenersAttached) {
        document.getElementById('refreshTrendsBtn')?.addEventListener('click', () => {
            renderTrendIntelligence();
            renderTrendVisualizations();
        });

        document.getElementById('trendPeriodSelector')?.addEventListener('change', () => {
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
        trendIntelligenceListenersAttached = true;
    }

    setTrendFocusMode(trendIntelligenceFocusMode);

    // Initial render of visualizations
    renderTrendVisualizations();
}

function renderComplianceAlerts() {
    const container = document.getElementById('complianceAlertsOutput');
    if (!container) return;
    const log = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'complianceLog') || '[]');
    const teamFilterContext = getTeamSelectionContext();
    const filteredLog = log.filter(entry => isAssociateIncludedByTeamFilter(entry?.employeeId, teamFilterContext));
    if (!filteredLog.length) {
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">No compliance flags logged.</div>';
        return;
    }
    const items = filteredLog.slice(-5).reverse().map(entry => {
        return `<div style="padding: 10px; border: 1px solid #f1d5d5; border-radius: 6px; background: #fff7f7;">
            <strong>${entry.employeeId || 'Unknown'}</strong> • ${entry.flag} • ${new Date(entry.timestamp).toLocaleString()}
        </div>`;
    }).join('');
    container.innerHTML = items;
}

function renderCoachingLoadAwareness() {
    const container = document.getElementById('coachingLoadOutput');
    if (!container) return;
    const now = Date.now();
    const thirtyDays = now - 30 * 24 * 60 * 60 * 1000;
    const fourteenDays = now - 14 * 24 * 60 * 60 * 1000;

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
            <strong>Not coached in 30+ days:</strong> ${noRecent.length ? noRecent.join(', ') : 'None'}
        </div>
        <div style="padding: 10px; border: 1px solid #e6eefc; border-radius: 6px; background: #f8fbff;">
            <strong>High coaching load:</strong> ${highLoad.length ? highLoad.join(', ') : 'None'}
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

    const metricsToUse = ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment', 'transfers', 'aht'];
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
    navigator.clipboard.writeText(output.value || '').then(() => {
        showToast('✅ 1:1 prep copied', 3000);
    }).catch(() => {
        showToast('Unable to copy 1:1 prep', 3000);
    });
}

function renderRecognitionIntelligence() {
    const container = document.getElementById('recognitionIntelligenceOutput');
    if (!container) return;

    const latestKey = getLatestWeeklyKey();
    const prevKey = getPreviousWeeklyKey(latestKey);
    if (!latestKey || !prevKey) {
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">Not enough data for recognition signals.</div>';
        return;
    }

    const latestWeek = weeklyData[latestKey];
    const prevWeek = weeklyData[prevKey];
    if (!latestWeek?.employees || !prevWeek?.employees) {
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">Not enough data for recognition signals.</div>';
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
        if (sentimentDelta > 3) {
            mostImproved.push({ name: emp.name, delta: sentimentDelta });
        }

        const recoveryMetric = ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment'].find(key =>
            !metricMeetsTarget(key, prevEmp[key]) && metricMeetsTarget(key, emp[key])
        );
        if (recoveryMetric) {
            recoveryWins.push(`${emp.name} (${METRICS_REGISTRY[recoveryMetric]?.label || recoveryMetric})`);
        }

        const consistent = ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment'].every(key => metricMeetsTarget(key, emp[key]));
        const recentCoaching = resolveCoachingHistoryForEmployee(emp.name).find(h =>
            new Date(h.generatedAt).getTime() >= Date.now() - 30 * 24 * 60 * 60 * 1000
        );
        if (consistent && !recentCoaching) {
            quietConsistent.push(emp.name);
        }
    });

    mostImproved.sort((a, b) => b.delta - a.delta);
    const mostImprovedText = mostImproved.length
        ? `${mostImproved[0].name} (+${mostImproved[0].delta.toFixed(1)} sentiment)`
        : 'None yet';

    container.innerHTML = `
        <div style="padding: 10px; border: 1px solid #e6eefc; border-radius: 6px; background: #f8fbff;">
            <strong>Most Improved (30 days):</strong> ${mostImprovedText}
        </div>
        <div style="padding: 10px; border: 1px solid #e6eefc; border-radius: 6px; background: #f8fbff;">
            <strong>Recovery Wins:</strong> ${recoveryWins.length ? recoveryWins.join(', ') : 'None'}
        </div>
        <div style="padding: 10px; border: 1px solid #e6eefc; border-radius: 6px; background: #f8fbff;">
            <strong>Quiet Consistency:</strong> ${quietConsistent.length ? quietConsistent.join(', ') : 'None'}
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
    const keys = getWeeklyKeysSorted();
    
    if (keys.length < 2) {
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">Upload at least 2 weeks of data to see trends.</div>';
        const simpleContainer = document.getElementById('trendSimpleViewOutput');
        if (simpleContainer) {
            simpleContainer.innerHTML = '<div style="padding: 12px; border: 1px solid #d7e7ff; border-radius: 8px; background: #f8fbff; color: #546e7a;">Upload at least 2 weeks of data to unlock Simple View priorities.</div>';
        }
        if (modeIndicator) modeIndicator.style.display = 'none';
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

    const keys = getWeeklyKeysSorted();
    if (keys.length < 2) {
        visualContainer.style.display = 'none';
        return;
    }

    visualContainer.style.display = 'block';

    // Get data for selected employee across periods
    const metricsToShow = ['scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht', 'overallSentiment'];
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
        chartContainer.style.cssText = 'background: white; padding: 15px; border-radius: 8px; border: 1px solid #e0e0e0;';
        
        const canvas = document.createElement('canvas');
        canvas.style.cssText = 'max-height: 250px;';
        
        chartContainer.appendChild(canvas);
        chartsGrid.appendChild(chartContainer);

        // Inline plugin to draw data labels on bars
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

        // Create bar chart
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

async function generateTodaysFocus() {
    const output = document.getElementById('todaysFocusOutput');
    if (!output) return;

    const focusData = buildTodaysFocusData();
    if (!focusData) {
        output.value = 'Today’s Focus\n• ✅ Team Win: No data available yet\n• ⚠️ Focus Area: Upload the latest data to generate focus\n• 🎯 Today’s Ask: Paste this week’s PowerBI export';
        return;
    }

    const tips = await loadServerTips();
    const focusTip = focusData.focusArea ? selectSmartTip({
        employeeId: 'TEAM',
        metricKey: focusData.focusArea,
        severity: 'medium',
        tips: tips[focusData.focusArea] || []
    }) : null;

    const teamWinLabel = focusData.teamWin ? METRICS_REGISTRY[focusData.teamWin]?.label || focusData.teamWin : 'Team metrics';
    const focusLabel = focusData.focusArea ? METRICS_REGISTRY[focusData.focusArea]?.label || focusData.focusArea : 'Key metric';

    output.value = `Today’s Focus\n` +
        `• ✅ Team Win: ${teamWinLabel} is ahead of the team average for many teammates\n` +
        `• ⚠️ Focus Area: ${focusLabel} is below the team average for several teammates\n` +
        `• 🎯 Today’s Ask: ${focusTip ? focusTip.replace(/^.*?:\s*/, '') : 'Use a quick reminder before breaks to stay green'}`;
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
    const averages = {};
    metricsToUse.forEach(key => {
        const vals = latestEmployees.map(emp => emp[key]).filter(v => v !== '' && v !== undefined && v !== null);
        averages[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });

    const prevAverages = {};
    if (prevWeek?.employees) {
        const previousEmployees = getFilteredEmployeesForPeriod(prevWeek, teamFilterContext);
        metricsToUse.forEach(key => {
            const vals = previousEmployees.map(emp => emp[key]).filter(v => v !== '' && v !== undefined && v !== null);
            prevAverages[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        });
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

function generateTodaysFocusCopilotEmail() {
    const focusData = buildTodaysFocusData();
    if (!focusData) {
        showToast('Upload the latest weekly data first', 3000);
        return;
    }

    const endDate = focusData.latestWeek?.metadata?.endDate
        ? formatDateMMDDYYYY(focusData.latestWeek.metadata.endDate)
        : (focusData.latestKey?.split('|')[1] ? formatDateMMDDYYYY(focusData.latestKey.split('|')[1]) : 'this week');

    const winLabel = focusData.teamWin ? METRICS_REGISTRY[focusData.teamWin]?.label || focusData.teamWin : 'Team metrics';
    const focusLabel = focusData.focusArea ? METRICS_REGISTRY[focusData.focusArea]?.label || focusData.focusArea : 'Key metric';
    const calloutText = focusData.callouts.length
        ? focusData.callouts.map(c => `${c.name} (${c.wins} wins vs avg)`).join(', ')
        : 'No clear callouts yet';

    const prompt = window.DevCoachModules?.trendIntelligence?.buildTodaysFocusCopilotPrompt?.({
        endDate,
        winLabel,
        focusLabel,
        calloutText
    }) || '';

    if (!prompt) {
        showToast('Trend Intelligence module not available. Refresh and try again.', 3500);
        return;
    }

    navigator.clipboard.writeText(prompt).then(() => {
        showToast('✅ CoPilot prompt copied. Paste into CoPilot.', 3000);
        window.open('https://copilot.microsoft.com', '_blank');
    }).catch(() => {
        showToast('Unable to copy CoPilot prompt', 3000);
    });
}

function copyTodaysFocus() {
    const output = document.getElementById('todaysFocusOutput');
    if (!output) return;
    navigator.clipboard.writeText(output.value || '').then(() => {
        showToast('✅ Today’s Focus copied', 3000);
    }).catch(() => {
        showToast('Unable to copy Today’s Focus', 3000);
    });
}

// ============================================
// COPILOT PROMPT GENERATION (HUMAN-IN-LOOP)
// ============================================

async function generateCopilotPrompt() {
    const moduleApi = window.DevCoachModules?.copilotPrompt;
    if (!moduleApi?.generateCopilotPrompt) {
        showToast('CoPilot Prompt module not available. Refresh and try again.', 3500);
        return;
    }

    await moduleApi.generateCopilotPrompt({
        document,
        window,
        navigator,
        console,
        alert,
        showToast,
        saveNickname,
        getEmployeeDataForPeriod,
        getActivePeriodContext,
        evaluateMetricsForCoaching,
        currentPeriodType,
        ytdData,
        weeklyData,
        currentPeriod,
        loadServerTips,
        getMetricSeverity,
        selectSmartTip,
        associateSentimentSnapshots,
        getCoachingContext,
        buildConfidenceInsight,
        detectComplianceFlags,
        logComplianceFlag
    });
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
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">Trend Intelligence module not available. Refresh and try again.</div>';
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
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">Trend Intelligence module not available. Refresh and try again.</div>';
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
            container.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">Employee List module not available. Refresh and try again.</div>';
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
        onTeamSelectionChange: ({ weekKey, selectedMembers }) => {
            const normalizedWeekKey = String(weekKey || '').trim();
            if (!normalizedWeekKey) return;
            setTeamMembersForWeek(normalizedWeekKey, Array.isArray(selectedMembers) ? selectedMembers : []);
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
            populateTeamMemberSelector();
        }
    });
}


// ============================================
// INITIALIZATION
// ============================================

async function initApp() {
    
    installDebugListeners();
    
    // Load data from localStorage
    weeklyData = loadWeeklyData();
    ytdData = loadYtdData();
    coachingHistory = loadCoachingHistory();
    callListeningLogs = loadCallListeningLogs();
    sentimentPhraseDatabase = loadSentimentPhraseDatabase();
    associateSentimentSnapshots = loadAssociateSentimentSnapshots();
    ensureSentimentPhraseDatabaseDefaults();
    migrateReliabilityCenterAverages();
    cleanupStaleAutoYtds();
    loadTeamMembers();
    bindTeamFilterChangeHandlers();
    notifyTeamFilterChanged();

    const restoredFromRepo = await tryAutoRestoreFromRepoBackupOnEmptyState();
    if (restoredFromRepo) {
        // Re-load all in-memory variables from localStorage after restore
        weeklyData = loadWeeklyData();
        ytdData = loadYtdData();
        coachingHistory = loadCoachingHistory();
        callListeningLogs = loadCallListeningLogs();
        sentimentPhraseDatabase = loadSentimentPhraseDatabase();
        associateSentimentSnapshots = loadAssociateSentimentSnapshots();
        loadTeamMembers();
        cleanupStaleAutoYtds(); // re-run after restore to remove stale auto-YTDs from backup
        saveYtdData(); // persist the cleanup
        showToast('✅ Restored synced data for this browser profile.', 4000);
        notifyTeamFilterChanged();
    }
    

    if (Object.keys(weeklyData).length > 0) {
        
    } else {
        
    }
    
    // Initialize default coaching tips (first load only)
    if (typeof initializeDefaultTips === 'function') {
        initializeDefaultTips();
    } else {
        console.warn('initializeDefaultTips is not available; skipping default tip initialization.');
    }
    
    // Initialize event handlers
    initializeEventHandlers();
    initializeKeyboardShortcuts();
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
                showToast('Sync is disabled — not marked as Work PC.', 3500);
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
    
    // If we have data, update the period dropdown
    if (Object.keys(weeklyData).length > 0 || Object.keys(ytdData).length > 0) {
        updatePeriodDropdown();
        populateDeleteWeekDropdown();
        populateTeamMemberSelector();
    }
    
    // Restore smart defaults
    restoreSmartDefaults();
    
    // Ensure data is saved before page unload (survives Ctrl+Shift+R)
    window.addEventListener('beforeunload', () => {
        saveWeeklyData();
        saveYtdData();
        saveCoachingHistory();
        saveCallListeningLogs();
        saveSentimentPhraseDatabase();
        saveAssociateSentimentSnapshots();
        
    });
    
    // Auto-sync remains event-driven via data saves/storage updates.
    
    
}

function setAppVersionLabel(statusSuffix = '') {
    const versionEl = document.getElementById('appVersion');
    if (!versionEl) return;
    versionEl.textContent = `Version: ${APP_VERSION}${statusSuffix}`;

    const deployMarkerEl = document.getElementById('deployMarker');
    if (deployMarkerEl) {
        fetch('https://api.github.com/repos/ScottK83/Development-Coaching-Tool/commits/main', { headers: { Accept: 'application/vnd.github.v3+json' } })
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
        window.__appBootOk = true;
    } catch (error) {
        window.__appBootOk = false;
        console.error('Fatal startup error:', error);
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

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        bootAppSafely();
    });
} else {
    // DOM already loaded (if script runs late)
    bootAppSafely();
}

// ===== EXECUTIVE SUMMARY FUNCTIONS =====

// -----------------------------------------------------------------------------
// COACHING EMAIL - WEEKLY CHECK-IN (METRIC-BASED)
// Uses latest uploaded data + coaching tips bank to build a Copilot prompt
// -----------------------------------------------------------------------------

function getLatestWeekKeyForCoaching() {
    var mod = window.DevCoachModules?.coachingEmail;
    return mod?.getLatestWeekKeyForCoaching ? mod.getLatestWeekKeyForCoaching() : null;
}

function resetCoachingEmailUiState(select, status, panel, promptArea, outlookSection, outlookBody, outlookBtn) {
    status.style.display = 'none';
    panel.style.display = 'none';
    promptArea.value = '';

    if (outlookSection && outlookBody && outlookBtn) {
        outlookSection.style.display = 'none';
        outlookBody.value = '';
        outlookBtn.disabled = true;
        outlookBtn.style.opacity = '0.6';
        outlookBtn.style.cursor = 'not-allowed';
    }

    select.innerHTML = '<option value="">-- Choose an associate --</option>';
}

function populateCoachingEmployeeSelectOptions(select, employees) {
    employees.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });
}

function getCoachingLatestPeriodEmployees(coachingWeekKey) {
    const latestWeek = weeklyData[coachingWeekKey] || ytdData[coachingWeekKey];
    const teamFilterContext = getTeamSelectionContext();
    const employees = (latestWeek.employees || [])
        .filter(emp => emp && emp.name)
        .filter(emp => isAssociateIncludedByTeamFilter(emp.name, teamFilterContext))
        .map(emp => emp.name)
        .sort();

    return { latestWeek, employees };
}

function setCoachingLatestPeriodStatus(status, coachingWeekKey, latestWeek) {
    const periodType = latestWeek?.metadata?.periodType || 'week';
    const label = latestWeek?.metadata?.label;
    if (label) {
        status.textContent = `Using latest period: ${label}`;
    } else {
        const endDate = latestWeek?.metadata?.endDate
            ? formatDateMMDDYYYY(latestWeek.metadata.endDate)
            : (coachingWeekKey.split('|')[1] ? formatDateMMDDYYYY(coachingWeekKey.split('|')[1]) : coachingWeekKey);
        const prefix = periodType === 'ytd' ? 'YTD through' : periodType === 'month' ? 'Month of' : 'Week of';
        status.textContent = `Using latest period: ${prefix} ${endDate}`;
    }
    status.style.display = 'block';
}

function bindCoachingOutlookInputState(outlookBody, outlookBtn) {
    if (!outlookBody || !outlookBtn) return;
    bindElementOnce(outlookBody, 'input', (e) => {
        const hasContent = e.target.value.trim().length > 0;
        outlookBtn.disabled = !hasContent;
        outlookBtn.style.opacity = hasContent ? '1' : '0.6';
        outlookBtn.style.cursor = hasContent ? 'pointer' : 'not-allowed';
    });
}

function bindCoachingEmailActionHandlers(select, generateBtn, outlookBtn) {
    const deleteLatestBtn = document.getElementById('deleteLatestCoachingBtn');
    const clearHistoryBtn = document.getElementById('clearCoachingHistoryBtn');

    bindElementOnce(select, 'change', updateCoachingEmailDisplay);
    bindElementOnce(generateBtn, 'click', generateCoachingPromptAndCopy);
    bindElementOnce(deleteLatestBtn, 'click', deleteLatestCoachingEntry);
    bindElementOnce(clearHistoryBtn, 'click', clearCoachingHistoryForEmployee);
    bindElementOnce(outlookBtn, 'click', generateOutlookEmailFromCoPilot);
}

function initializeCoachingEmail() {
    var mod = window.DevCoachModules?.coachingEmail;
    if (mod?.initializeCoachingEmail) return mod.initializeCoachingEmail();

    const select = document.getElementById('coachingEmployeeSelect');
    const status = document.getElementById('coachingEmailStatus');
    const panel = document.getElementById('coachingMetricsPanel');
    const promptArea = document.getElementById('coachingPromptArea');
    const generateBtn = document.getElementById('generateCoachingPromptBtn');
    const outlookSection = document.getElementById('coachingOutlookSection');
    const outlookBody = document.getElementById('coachingOutlookBody');
    const outlookBtn = document.getElementById('generateOutlookEmailBtn');

    if (!select || !status || !panel || !promptArea || !generateBtn) return;

    resetCoachingEmailUiState(select, status, panel, promptArea, outlookSection, outlookBody, outlookBtn);

    const ytd = typeof ytdData !== 'undefined' ? ytdData : {};
    if ((!weeklyData || Object.keys(weeklyData).length === 0) && Object.keys(ytd).length === 0) {
        status.textContent = 'No data available. Upload data first to generate coaching emails.';
        status.style.display = 'block';
        return;
    }

    coachingLatestWeekKey = getLatestWeekKeyForCoaching();
    if (!coachingLatestWeekKey || !(weeklyData[coachingLatestWeekKey] || ytd[coachingLatestWeekKey])) {
        status.textContent = 'Unable to find the latest data period.';
        status.style.display = 'block';
        return;
    }

    const { latestWeek, employees } = getCoachingLatestPeriodEmployees(coachingLatestWeekKey);
    populateCoachingEmployeeSelectOptions(select, employees);
    setCoachingLatestPeriodStatus(status, coachingLatestWeekKey, latestWeek);
    bindCoachingOutlookInputState(outlookBody, outlookBtn);
    bindCoachingEmailActionHandlers(select, generateBtn, outlookBtn);
    bindQuickCheckinHandlers();
}

// ============================================
// QUICK CHECK-IN (Teams message: praise + focus)
// ============================================

async function generateQuickCheckin() {
    const select = document.getElementById('coachingEmployeeSelect');
    const output = document.getElementById('quickCheckinOutput');
    const copyBtn = document.getElementById('copyQuickCheckinBtn');
    if (!select || !output) return;

    const employeeName = select.value;
    if (!employeeName) {
        alert('Please select an associate first.');
        return;
    }

    const firstName = employeeName.split(/[\s,]+/)[0] || employeeName;

    // Get employee data from the coaching tab's latest period
    const ytd = typeof ytdData !== 'undefined' ? ytdData : {};
    const weekKey = coachingLatestWeekKey;
    const periodData = weeklyData[weekKey] || ytd[weekKey];
    const employeeData = periodData?.employees?.find(emp => emp.name === employeeName);
    if (!employeeData) {
        alert('No data found for this employee. Try selecting a different associate.');
        return;
    }

    const endDate = periodData?.metadata?.endDate
        ? formatDateMMDDYYYY(periodData.metadata.endDate)
        : (weekKey?.split('|')[1] ? formatDateMMDDYYYY(weekKey.split('|')[1]) : 'this period');
    const periodLabel = 'week of ' + endDate;
    const coachingEval = evaluateMetricsForCoaching(employeeData);
    const celebrate = coachingEval.celebrate || [];
    const needsCoaching = coachingEval.needsCoaching || [];

    // Build praise section from top wins
    let praiseText = '';
    if (celebrate.length > 0) {
        // Parse metric name and value from celebrate strings like "- Schedule Adherence: 99.2% (Goal: 95%)"
        const topWins = celebrate.slice(0, 2);
        const winDetails = topWins.map(w => {
            const match = w.match(/^-\s*(.+?):\s*(.+?)(?:\s*\(Goal.*)?$/);
            return match ? { metric: match[1], detail: match[2].trim() } : { metric: w.replace(/^-\s*/, ''), detail: '' };
        });
        if (winDetails.length === 1) {
            praiseText = `You're rocking ${winDetails[0].metric} at ${winDetails[0].detail}! \uD83D\uDD25`;
        } else {
            praiseText = `You're rocking ${winDetails[0].metric} at ${winDetails[0].detail} and ${winDetails[1].metric} at ${winDetails[1].detail}! \uD83D\uDD25\uD83D\uDCAA`;
        }
    } else {
        praiseText = `I see you putting in the effort and I appreciate it! \uD83D\uDE4C`;
    }

    // Build focus section from top coaching need + tip
    let focusText = '';
    if (needsCoaching.length > 0) {
        const topFocus = needsCoaching[0];
        const focusMatch = topFocus.match(/^-\s*(.+?):\s*(.+?)(?:\s*\(Goal.*)?$/);
        const focusMetric = focusMatch ? focusMatch[1] : topFocus.replace(/^-\s*/, '');
        const focusDetail = focusMatch ? focusMatch[2].trim() : '';

        // Try to get a tip — build lookup from METRICS_REGISTRY labels
        const metricKeyByLabel = {};
        if (typeof METRICS_REGISTRY === 'object') {
            Object.keys(METRICS_REGISTRY).forEach(k => {
                const label = METRICS_REGISTRY[k]?.label;
                if (label) metricKeyByLabel[label] = k;
            });
        }
        // Add known aliases
        metricKeyByLabel['Avoid Negative Words'] = 'negativeWord';
        metricKeyByLabel['Avoid Negative Word'] = 'negativeWord';
        metricKeyByLabel['CX Rep Overall'] = 'cxRepOverall';

        const metricKey = metricKeyByLabel[focusMetric];
        let tipText = '';
        if (metricKey) {
            try {
                const allTips = await (typeof loadServerTips === 'function' ? loadServerTips() : Promise.resolve({}));
                // Tips are keyed by label (e.g. "Rep Satisfaction"), not metricKey
                const metricTips = allTips[metricKey] || allTips[focusMetric] || [];
                if (metricTips.length > 0) {
                    const tip = typeof selectSmartTip === 'function'
                        ? selectSmartTip({ employeeId: employeeName, metricKey, severity: 'medium', tips: metricTips })
                        : metricTips[Math.floor(Math.random() * metricTips.length)];
                    if (tip) tipText = tip;
                }
            } catch (e) { /* no tips available */ }
        }

        focusText = `\uD83C\uDFAF Your focus this week should be ${focusMetric}${focusDetail ? ' (currently at ' + focusDetail + ')' : ''}.`;
        if (tipText) {
            // Strip redundant prefixes like "Practice this:" since we add our own intro
            const cleanTip = tipText.replace(/^(Practice this|Try this|Tip|Focus on this)\s*:\s*/i, '').trim();
            const finalTip = cleanTip.charAt(0).toUpperCase() + cleanTip.slice(1);
            focusText += ` \uD83D\uDCA1 ${finalTip}`;
        }
    }

    // Assemble the message
    let message = `Hey ${firstName}! \uD83D\uDC4B Your data for ${periodLabel} is looking great. ${praiseText}`;
    if (focusText) {
        message += `\n\n${focusText}`;
    }
    message += `\n\nKeep up the great work! \uD83D\uDE80 Let me know if you need anything.`;

    output.value = message;
    output.style.display = 'block';
    if (copyBtn) copyBtn.style.display = 'inline-block';

    // Auto-copy
    try {
        await navigator.clipboard.writeText(message);
        showToast('Quick check-in copied to clipboard!', 3000);
    } catch (e) { /* user can click copy */ }
}

function bindQuickCheckinHandlers() {
    const genBtn = document.getElementById('generateQuickCheckinBtn');
    const copyBtn = document.getElementById('copyQuickCheckinBtn');
    const output = document.getElementById('quickCheckinOutput');

    if (genBtn) bindElementOnce(genBtn, 'click', generateQuickCheckin);
    if (copyBtn && output) {
        bindElementOnce(copyBtn, 'click', () => {
            navigator.clipboard.writeText(output.value || '').then(() => {
                showToast('Copied!', 2000);
            });
        });
    }
}

function getCallListeningEmployeeOptions() {
    const dataEmployees = getYearEndEmployees();
    const logEmployees = Object.keys(callListeningLogs || {});
    return filterAssociateNamesByTeamSelection(Array.from(new Set([...dataEmployees, ...logEmployees]))).sort();
}

function getCallListeningDraftFromForm() {
    return {
        employeeName: (document.getElementById('callListeningEmployeeSelect')?.value || '').trim(),
        listenedOn: (document.getElementById('callListeningDate')?.value || '').trim(),
        callReference: (document.getElementById('callListeningReference')?.value || '').trim(),
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
        && (existingEntry.callReference || '') === draft.callReference
        && (existingEntry.whatWentWell || '') === draft.whatWentWell
        && (existingEntry.improvementAreas || '') === draft.improvementAreas
        && (existingEntry.oscarUrl || '') === draft.oscarUrl
        && (existingEntry.relevantInfo || '') === draft.relevantInfo
        && (existingEntry.managerNotes || '') === draft.managerNotes;
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
        callListeningLogs[employeeName] = callListeningLogs[employeeName].slice(-500);
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

function buildCallListeningVerintSummary(entry) {
    if (!entry) return '';
    return [
        `Call Listening Date: ${entry.listenedOn || ''}`,
        `Associate: ${entry.employeeName || ''}`,
        `Call Reference: ${entry.callReference || 'N/A'}`,
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
        entry.managerNotes || 'N/A'
    ].join('\n');
}

function copyCallListeningVerintSummary(entryId = null) {
    const employeeName = (document.getElementById('callListeningEmployeeSelect')?.value || '').trim();
    let entry = null;

    if (entryId && employeeName) {
        entry = findCallListeningEntryById(employeeName, entryId);
    }
    if (!entry) {
        entry = upsertCallListeningEntryFromForm(false);
    }
    if (!entry) return;

    const summaryText = buildCallListeningVerintSummary(entry);
    navigator.clipboard.writeText(summaryText)
        .then(() => showToast('✅ Verint call summary copied to clipboard!', 3000))
        .catch(() => showToast('⚠️ Unable to copy Verint summary.', 3000));
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
    setValue('callListeningReference', entry.callReference);
    setValue('callListeningStrengths', entry.whatWentWell);
    setValue('callListeningImprovements', entry.improvementAreas);
    setValue('callListeningOscarUrl', entry.oscarUrl);
    setValue('callListeningRelevantInfo', entry.relevantInfo);
    setValue('callListeningManagerNotes', entry.managerNotes);

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

function buildCallListeningPrompt(entry) {
    const preferredName = getEmployeeNickname(entry.employeeName) || entry.employeeName.split(' ')[0] || entry.employeeName;
    const delegated = window.DevCoachModules?.callListening?.buildPrompt?.(entry, preferredName);
    return delegated || '';
}

function generateCallListeningPromptAndCopy() {
    const entry = upsertCallListeningEntryFromForm(false);
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
        openWindow: window.open,
        clipboardWriteText: navigator.clipboard?.writeText?.bind(navigator.clipboard)
    });
    if (delegatedResult?.ok) {
        if (outlookSection) {
            outlookSection.style.display = 'block';
        }
        return;
    }

    showToast('⚠️ Call Listening module could not open Copilot flow.', 3500);
}

function generateCallListeningOutlookEmail() {
    const employeeName = (document.getElementById('callListeningEmployeeSelect')?.value || '').trim();
    const callDate = (document.getElementById('callListeningDate')?.value || '').trim();
    const bodyText = (document.getElementById('callListeningOutlookBody')?.value || '').trim();

    const delegatedResult = window.DevCoachModules?.callListening?.generateOutlookDraft?.({
        employeeName,
        callDate,
        bodyText,
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

function renderCallListeningHistoryForSelectedEmployee() {
    const { employeeName, summary, list } = resolveCallListeningHistoryContext();
    if (!summary || !list) return;

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

function populateCallListeningEmployeeSelect(employeeSelect, employees, currentSelection) {
    employeeSelect.innerHTML = '<option value="">-- Choose an associate --</option>';
    employees.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        employeeSelect.appendChild(option);
    });

    if (currentSelection && employees.includes(currentSelection)) {
        employeeSelect.value = currentSelection;
    }
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
}

function bindCallListeningSectionHandlers(employeeSelect, saveBtn, copyVerintBtn, exportBtn, generatePromptBtn, historyList, outlookBody, outlookBtn) {
    bindElementOnce(employeeSelect, 'change', renderCallListeningHistoryForSelectedEmployee);
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
        // Real YTD uploads are the source of truth — always preferred
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

function setYearEndPromptButtonFeedback(button) {
    return window.DevCoachModules?.yearEndComments?.setYearEndPromptButtonFeedback?.(button);
}

function copyYearEndPromptWithFallbacks(prompt, copilotWindow) {
    return window.DevCoachModules?.yearEndComments?.copyYearEndPromptWithFallbacks?.(prompt, copilotWindow);
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

function showCoachingPromptCopiedState(button) {
    return window.DevCoachModules?.coachingEmail?.showCoachingPromptCopiedState?.(button);
}

function revealCoachingOutlookSection() {
    return window.DevCoachModules?.coachingEmail?.revealCoachingOutlookSection?.();
}

function openCopilotForCoachingPrompt() {
    return window.DevCoachModules?.coachingEmail?.openCopilotForCoachingPrompt?.();
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

