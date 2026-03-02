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
const APP_VERSION = '2026.03.02.13'; // Version: YYYY.MM.DD.NN
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
    const originalError = console.error;
    console.log = () => {};
    console.warn = () => {};
    console.error = (...args) => {
        const msg = args.join(' ');
        if (isSuppressed(msg)) return;
        lastError = { message: msg, timestamp: new Date().toISOString() };
        localStorage.setItem(STORAGE_PREFIX + 'lastError', JSON.stringify(lastError));
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
let callListeningSyncTimer = null;
let repoSyncStorageHookInstalled = false;
let repoSyncSuppressCounter = 0;
let repoSyncHydrationInProgress = false;
let repoSyncConflictPromptMutedUntil = 0;
let repoSyncAutoPausedReason = '';
let repoSyncAutoPausedExistingSummary = null;
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

const YEAR_END_TARGETS_BY_YEAR = {
    2025: {
        scheduleAdherence: { type: 'min', value: 93 },
        cxRepOverall: { type: 'min', value: 80 },
        fcr: { type: 'min', value: 70 },
        transfers: { type: 'max', value: 6 },
        overallSentiment: { type: 'min', value: 88 },
        positiveWord: { type: 'min', value: 86 },
        negativeWord: { type: 'min', value: 83 },
        managingEmotions: { type: 'min', value: 95 },
        aht: { type: 'max', value: 440 },
        acw: { type: 'max', value: 60 },
        holdTime: { type: 'max', value: 30 },
        reliability: { type: 'max', value: 16 }
    },
    2026: {
        scheduleAdherence: { type: 'min', value: 93 },
        cxRepOverall: { type: 'min', value: 82 },
        fcr: { type: 'min', value: 73 },
        overallExperience: { type: 'min', value: 75 },
        transfers: { type: 'max', value: 6 },
        overallSentiment: { type: 'min', value: 88 },
        positiveWord: { type: 'min', value: 86 },
        negativeWord: { type: 'min', value: 83 },
        managingEmotions: { type: 'min', value: 95 },
        aht: { type: 'max', value: 426 },
        acw: { type: 'max', value: 60 },
        reliability: { type: 'max', value: 18 }
    }
};

const METRIC_RATING_BANDS_BY_YEAR = {
    2026: {
        scheduleAdherence: {
            type: 'min',
            score3: { min: 94.5 },
            score2: { min: 92.5 }
        },
        cxRepOverall: {
            type: 'min',
            score3: { min: 84 },
            score2: { min: 81.5 }
        },
        overallSentiment: {
            type: 'min',
            score3: { min: 90 },
            score2: { min: 87.5 }
        },
        reliability: {
            type: 'max',
            score3: { max: 18 },
            score2: { max: 24 }
        },
        aht: {
            type: 'max',
            score3: { max: 414 },
            score2: { max: 434 }
        },
        transfers: {
            type: 'max',
            score3: { max: 4 },
            score2: { max: 6 }
        }
    }
};

function getMetricProfilesModule() {
    return window?.DevCoachModules?.metricProfiles || null;
}

function getMetricRatingScore(metricKey, value, year) {
    const profileModule = getMetricProfilesModule();
    if (profileModule?.getRatingScore) {
        const moduleScore = profileModule.getRatingScore(metricKey, value, year);
        if (moduleScore !== null && moduleScore !== undefined) return moduleScore;
    }

    const yearNum = parseInt(year, 10);
    const numeric = parseFloat(value);
    if (!Number.isInteger(yearNum) || Number.isNaN(numeric)) return null;

    const config = METRIC_RATING_BANDS_BY_YEAR[yearNum]?.[metricKey];
    if (!config) return null;

    if (config.type === 'min') {
        if (numeric >= config.score3.min) return 3;
        if (numeric >= config.score2.min) return 2;
        return 1;
    }

    if (config.type === 'max') {
        if (numeric <= config.score3.max) return 3;
        if (numeric <= config.score2.max) return 2;
        return 1;
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

const METRICS_REGISTRY = {
    scheduleAdherence: {
        key: 'scheduleAdherence',
        label: 'Schedule Adherence',
        icon: '📅',
        target: { type: 'min', value: 93 },
        unit: '%',
        columnIndex: 8,
        chartType: 'line',
        chartColor: '#2196F3',
        defaultTip: "Schedule Adherence: Being present and available is essential. Work on meeting your scheduled hours consistently."
    },
    cxRepOverall: {
        key: 'cxRepOverall',
        label: 'Rep Satisfaction',
        icon: '😊',
        target: { type: 'min', value: 82 },
        unit: '%',
        columnIndex: 15,
        chartType: 'line',
        chartColor: '#4CAF50',
        defaultTip: "Focus on building stronger connections with customers through empathy and professionalism. Listen actively and show genuine care for their concerns."
    },
    fcr: {
        key: 'fcr',
        label: 'First Call Resolution',
        icon: '✅',
        target: { type: 'min', value: 73 },
        unit: '%',
        columnIndex: 13,
        chartType: 'line',
        chartColor: '#FF5722',
        defaultTip: "Work on resolving more issues on the first contact. Take time to fully understand the problem before offering solutions."
    },
    overallExperience: {
        key: 'overallExperience',
        label: 'Overall Experience',
        icon: '⭐',
        target: { type: 'min', value: 75 },
        unit: '%',
        columnIndex: 17,
        chartType: null,
        chartColor: null,
        defaultTip: "Focus on creating more positive customer experiences. Personalize your interactions and ensure each customer feels valued."
    },
    transfers: {
        key: 'transfers',
        label: 'Transfers',
        icon: '🔄',
        target: { type: 'max', value: 6 },
        unit: '%',
        columnIndex: 2,
        chartType: 'bar',
        chartColor: '#FF9800',
        defaultTip: "Transfers: You're managing transfers well. When possible, try to resolve issues yourself to enhance the customer experience."
    },
    transfersCount: {
        key: 'transfersCount',
        label: 'Number of Transfers',
        icon: '🔢',
        target: { type: 'max', value: 20 },
        unit: '',
        columnIndex: 3,
        chartType: 'bar',
        chartColor: '#FF6F00',
        defaultTip: "Number of Transfers: Monitor your total transfer count. Focus on resolving issues independently when possible."
    },
    overallSentiment: {
        key: 'overallSentiment',
        label: 'Overall Sentiment',
        icon: '💭',
        target: { type: 'min', value: 88 },
        unit: '%',
        columnIndex: 12,
        chartType: 'line',
        chartColor: '#E91E63',
        defaultTip: "Work on maintaining a more positive tone throughout your interactions. Your words and attitude significantly impact customer experience."
    },
    positiveWord: {
        key: 'positiveWord',
        label: 'Positive Word',
        icon: '👍',
        target: { type: 'min', value: 86 },
        unit: '%',
        columnIndex: 11,
        chartType: 'line',
        chartColor: '#4CAF50',
        defaultTip: "Increase your use of positive language. Use encouraging and supportive words on EVERY call to reach 100% usage."
    },
    negativeWord: {
        key: 'negativeWord',
        label: 'Avoid Negative Words',
        icon: '⚠️',
        target: { type: 'min', value: 83 },
        unit: '%',
        columnIndex: 10,
        chartType: 'line',
        chartColor: '#F44336',
        defaultTip: "Work on eliminating negative words from your conversations. Replace negative phrases with positive alternatives."
    },
    managingEmotions: {
        key: 'managingEmotions',
        label: 'Managing Emotions',
        icon: '😌',
        target: { type: 'min', value: 95 },
        unit: '%',
        columnIndex: 9,
        chartType: 'line',
        chartColor: '#00BCD4',
        defaultTip: "Focus on maintaining composure during challenging interactions. Stay calm and professional even when customers are upset."
    },
    aht: {
        key: 'aht',
        label: 'Average Handle Time',
        icon: '⏱️',
        target: { type: 'max', value: 426 },
        unit: 'sec',
        columnIndex: 4,
        chartType: 'line',
        chartColor: '#9C27B0',
        defaultTip: "Average Handle Time: Focus on efficiency without rushing. Prepare your responses, but don't skip necessary steps."
    },
    acw: {
        key: 'acw',
        label: 'After Call Work',
        icon: '📝',
        target: { type: 'max', value: 60 },
        unit: 'sec',
        columnIndex: 7,
        chartType: 'bar',
        chartColor: '#3F51B5',
        defaultTip: "After Call Work: Complete your documentation promptly. This keeps you available for the next customer and maintains accuracy."
    },
    holdTime: {
        key: 'holdTime',
        label: 'Hold Time',
        icon: '⏳',
        target: { type: 'max', value: 30 },
        unit: 'sec',
        columnIndex: 6,
        chartType: 'bar',
        chartColor: '#009688',
        defaultTip: "Hold Time: Minimize hold time by gathering information upfront. It improves customer experience and efficiency."
    },
    reliability: {
        key: 'reliability',
        label: 'Reliability',
        icon: '🎯',
        target: { type: 'max', value: 16 },
        unit: 'hrs',
        columnIndex: 22,
        chartType: 'bar',
        chartColor: '#795548',
        defaultTip: "Reliability: Your availability is crucial. Work toward reducing unexpected absences and maintaining consistent attendance."
    }
};

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
function validatePastedData(dataText) {
    const lines = dataText.trim().split('\n');
    const issues = [];
    
    if (lines.length < 2) {
        issues.push('Data must have at least a header row and one data row');
        return { valid: false, issues, preview: null };
    }
    
    const headers = lines[0].split('\t');
    
    // DEBUG: Show all headers at import time
    if (DEBUG) {
        console.log('=== HEADERS AT IMPORT ===');
        headers.forEach((h, idx) => console.log(`[${idx}] "${h}"`));
    }
    
    // Check for required columns with flexible matching
    const normalize = (str) => str.toLowerCase().replace(/[\s\-_]+/g, '|');
    const hasNameColumn = headers.some(h => {
        const normalizedHeader = normalize(h);
        // Match 'name' in normalized header (handles "Name (Last, First)", "name_last_first", etc.)
        return normalizedHeader.includes('name');
    });
    const hasAdherenceColumn = headers.some(h => normalize(h).includes('adherence') || normalize(h).includes('schedule'));
    
    if (!hasNameColumn) {
        issues.push('Missing required column: Name');
    }
    if (!hasAdherenceColumn) {
        issues.push('Missing required column: Adherence or Schedule');
    }
    
    const dataRows = lines.slice(1).filter(line => line.trim());
    const employeeCount = dataRows.length;
    
    if (employeeCount === 0) {
        issues.push('No employee data found');
    }
    
    // Preview first few employees
    const preview = dataRows.slice(0, 3).map(row => {
        const cols = row.split('\t');
        return cols[0] || 'Unknown';
    });
    
    return {
        valid: issues.length === 0,
        issues,
        employeeCount,
        preview,
        headers
    };
}

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
function showOnlySection(sectionId) {
    // Hide all sections
    const sections = document.querySelectorAll('section[id$="Section"], form[id$="Form"]');
    sections.forEach(section => {
        section.style.display = 'none';
    });
    
    // Show the specified section
    const targetSection = document.getElementById(sectionId);
    if (targetSection) {
        targetSection.style.display = 'block';
        saveUiNavState({ sectionId });
    }
}

/**
 * Show a specific sub-section within the Coaching & Analysis section
 */
function showSubSection(subSectionId, activeButtonId = null) {
    // Hide all sub-sections
    const subSections = ['subSectionCoachingEmail', 'subSectionYearEnd', 'subSectionOnOffTracker', 'subSectionSentiment', 'subSectionMetricTrends', 'subSectionTrendIntelligence', 'subSectionCallListening'];
    subSections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    
    // Show the specified sub-section
    const targetSubSection = document.getElementById(subSectionId);
    if (targetSubSection) {
        targetSubSection.style.display = 'block';
    }
    
    // Update sub-nav button active states
    const subNavButtons = ['subNavCoachingEmail', 'subNavYearEnd', 'subNavOnOffTracker', 'subNavSentiment', 'subNavMetricTrends', 'subNavTrendIntelligence', 'subNavCallListening'];
    const selectedSubNavButton = activeButtonId || (
        subSectionId === 'subSectionCoachingEmail' ? 'subNavCoachingEmail'
            : subSectionId === 'subSectionYearEnd' ? 'subNavYearEnd'
                : subSectionId === 'subSectionOnOffTracker' ? 'subNavOnOffTracker'
                : subSectionId === 'subSectionSentiment' ? 'subNavSentiment'
                    : subSectionId === 'subSectionMetricTrends' ? 'subNavMetricTrends'
                        : subSectionId === 'subSectionTrendIntelligence' ? 'subNavTrendIntelligence'
                            : subSectionId === 'subSectionCallListening' ? 'subNavCallListening'
                            : ''
    );

    subNavButtons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            if (btnId === selectedSubNavButton) {
                btn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                btn.style.opacity = '1';
            } else {
                btn.style.background = '#ccc';
                btn.style.opacity = '0.7';
            }
        }
    });

    saveUiNavState({
        sectionId: 'coachingEmailSection',
        coachingSubSectionId: subSectionId
    });
}

/**
 * Show a specific sub-section within the Manage Data section
 */
function showManageDataSubSection(subSectionId) {
    // Hide all sub-sections
    const subSections = ['subSectionTeamData', 'subSectionCoachingTips', 'subSectionSentimentKeywords'];
    subSections.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
    
    // Show the specified sub-section
    const targetSubSection = document.getElementById(subSectionId);
    if (targetSubSection) {
        targetSubSection.style.display = 'block';
    }
    
    // Update sub-nav button active states
    const subNavButtons = ['subNavTeamData', 'subNavCoachingTips', 'subNavSentimentKeywords'];
    subNavButtons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            if (btnId.replace('subNav', 'subSection') === subSectionId) {
                btn.style.background = 'linear-gradient(135deg, #ff9800 0%, #ff5722 100%)';
                btn.style.opacity = '1';
            } else {
                btn.style.background = '#ccc';
                btn.style.opacity = '0.7';
            }
        }
    });

    saveUiNavState({
        sectionId: 'manageDataSection',
        manageDataSubSectionId: subSectionId
    });
}

function getDefaultUiNavState() {
    return {
        sectionId: 'coachingForm',
        coachingSubSectionId: 'subSectionCoachingEmail',
        manageDataSubSectionId: 'subSectionTeamData'
    };
}

function loadUiNavState() {
    try {
        const raw = localStorage.getItem(UI_NAV_STATE_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        const defaults = getDefaultUiNavState();
        return {
            sectionId: typeof parsed?.sectionId === 'string' ? parsed.sectionId : defaults.sectionId,
            coachingSubSectionId: typeof parsed?.coachingSubSectionId === 'string' ? parsed.coachingSubSectionId : defaults.coachingSubSectionId,
            manageDataSubSectionId: typeof parsed?.manageDataSubSectionId === 'string' ? parsed.manageDataSubSectionId : defaults.manageDataSubSectionId
        };
    } catch (error) {
        console.error('Error loading UI nav state:', error);
        return getDefaultUiNavState();
    }
}

function saveUiNavState(partialState = {}) {
    try {
        const current = loadUiNavState();
        const next = {
            ...current,
            ...partialState
        };
        localStorage.setItem(UI_NAV_STATE_STORAGE_KEY, JSON.stringify(next));
    } catch (error) {
        console.error('Error saving UI nav state:', error);
    }
}

function restoreLastViewedSection() {
    const state = loadUiNavState();
    const sectionId = state.sectionId || 'coachingForm';

    const coachingSubSectionToButton = {
        subSectionCoachingEmail: 'subNavCoachingEmail',
        subSectionYearEnd: 'subNavYearEnd',
        subSectionOnOffTracker: 'subNavOnOffTracker',
        subSectionSentiment: 'subNavSentiment',
        subSectionMetricTrends: 'subNavMetricTrends',
        subSectionTrendIntelligence: 'subNavTrendIntelligence',
        subSectionCallListening: 'subNavCallListening'
    };

    const manageDataSubSectionToButton = {
        subSectionTeamData: 'subNavTeamData',
        subSectionCoachingTips: 'subNavCoachingTips',
        subSectionSentimentKeywords: 'subNavSentimentKeywords'
    };

    if (sectionId === 'coachingEmailSection') {
        showOnlySection('coachingEmailSection');
        const subSectionId = state.coachingSubSectionId || 'subSectionCoachingEmail';
        const buttonId = coachingSubSectionToButton[subSectionId] || 'subNavCoachingEmail';
        document.getElementById(buttonId)?.click();
        return;
    }

    if (sectionId === 'manageDataSection') {
        showOnlySection('manageDataSection');
        const subSectionId = state.manageDataSubSectionId || 'subSectionTeamData';
        const buttonId = manageDataSubSectionToButton[subSectionId] || 'subNavTeamData';
        document.getElementById(buttonId)?.click();
        return;
    }

    if (sectionId === 'debugSection') {
        showOnlySection('debugSection');
        renderDebugPanel();
        return;
    }

    if (sectionId === 'redFlagSection') {
        showOnlySection('redFlagSection');
        return;
    }

    if (sectionId === 'ptoSection') {
        showOnlySection('ptoSection');
        initializePtoTracker();
        return;
    }

    showOnlySection('coachingForm');
    initializeSection('coachingForm');
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
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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

function buildDebugSnapshot() {
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

function copyDebugInfo() {
    const payload = JSON.stringify(buildDebugPayload(), null, 2);
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(payload)
            .then(() => showToast('✅ Debug info copied to clipboard', 3000))
            .catch(() => fallbackCopyDebug(payload));
    } else {
        fallbackCopyDebug(payload);
    }
}

function fallbackCopyDebug(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
        showToast('✅ Debug info copied to clipboard', 3000);
    } catch (err) {
        console.error('Failed to copy debug info:', err);
        showToast('⚠️ Unable to copy debug info', 3000);
    } finally {
        document.body.removeChild(textarea);
    }
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



/*
// ============================================
// TIPS MANAGEMENT
// ============================================

const EMBEDDED_TIPS_CSV = `Metric,Tip
scheduleAdherence,Log in 2-3 minutes early to avoid system lag delays
scheduleAdherence,Set phone reminders 5 minutes before breaks end
scheduleAdherence,Keep a visible timer on your desk for break times
scheduleAdherence,Put break end times in Outlook calendar with pop-up alerts
scheduleAdherence,If you're consistently late from breaks - set a timer for 2 minutes before break ends
scheduleAdherence,Review your Verint schedule every Sunday night so you know your week
scheduleAdherence,Keep your workstation logged in during breaks to avoid login delays
scheduleAdherence,Have your supervisor's number saved - call immediately if you'll be late
scheduleAdherence,Plan bathroom breaks during natural call lulls - don't wait until urgent
scheduleAdherence,If system issues make you late - report it immediately for exception coding
fcr,Take 10 extra seconds to confirm you fully answered the question before ending call
fcr,Ask 'Is there anything else I can help you with today?' and wait for actual response
fcr,Use teach-back method: 'Let me make sure I explained that clearly...' to catch confusion
fcr,Don't rush the close - customers will call back if they're still confused
fcr,If you're unsure you resolved it - say 'If you have any issues call back and reference ticket X'
fcr,Check account notes from previous calls - often tells you what customer REALLY needs
fcr,Ask clarifying questions upfront: 'Just to make sure I help you completely - is this about X or Y?'
fcr,Before ending call - summarize what you did: 'So I've updated X and you should see Y'
fcr,If customer says 'I guess that works' - dig deeper - they're not satisfied yet
fcr,Keep a list of your personal callbacks - identify your patterns and fix root causes
transfers,Before transferring - take 10 seconds to check knowledge base - customers prefer waiting over restarting
transfers,Say 'Let me see if I can help you with that first' before defaulting to transfer
transfers,Memorize which department handles top 5 transfer reasons to route correctly first time
transfers,If you do transfer - give customer the direct number in case call drops
transfers,Warm transfer when possible - brief the next rep so customer doesn't repeat story
transfers,Learn the 5 things you transfer most - make those your study priority this month
transfers,Before transferring billing issues - verify you can't do a simple payment arrangement first
transfers,If customer asks for supervisor - try to resolve first: 'I'd love to help you - let me see what I can do'
transfers,Keep a transfer log - track why you transferred - find your knowledge gaps
transfers,If you transfer more than 2 times in one shift - review those calls to understand why
aht,Use quick reference card while talking - it's faster than searching knowledge base mid-call
aht,Memorize top 5 most common customer questions to avoid looking up every time
aht,Practice your greeting and closing to get under 10 seconds each
aht,Type account notes WHILE talking - not in silence after
aht,Have frequently-used links bookmarked and organized in toolbar
aht,Use dual monitors if available - one for customer info - one for tools
aht,Learn keyboard shortcuts for your main programs - mouse clicking adds 5-10 seconds per call
aht,Don't over-explain simple things - 'Your payment is due the 15th' not a 3-minute explanation of billing cycles
aht,If you're searching for something - tell customer what you're doing so silence doesn't feel awkward
aht,Review your longest calls weekly - find your time-wasters and eliminate them
acw,Start documentation DURING the call not after - fill in account notes while talking
acw,Use text expander shortcuts for common phrases like 'Customer called regarding billing question'
acw,Have your wrap-up template ready to go - fill in blanks rather than typing from scratch
acw,Use consistent abbreviations so you type faster - create your own shorthand system
acw,Don't write a novel - brief accurate notes are better than essays
acw,If call was simple - notes can be simple: 'Changed due date to 20th per customer request'
acw,Use drop-down options in CRM when available - faster than typing
acw,Practice typing without looking - every second counts in ACW
acw,If your ACW is high - time yourself on next 5 calls to see where seconds go
acw,Set a personal ACW goal - try to beat your own time each day
holdTime,Put customer on hold BEFORE looking things up not after - Say 'Let me pull that up one moment' then hit hold button
holdTime,Keep frequently used screens already open in browser tabs
holdTime,Learn keyboard shortcuts for your main tools - mouse clicking adds 5-10 seconds per call
holdTime,Ask ALL your questions before putting customer on hold - don't hold multiple times
holdTime,If you need to research - estimate time: 'This may take 2-3 minutes - are you able to hold?'
holdTime,Check in every 30-45 seconds during long holds: 'Still researching - appreciate your patience'
holdTime,Have your knowledge base search open in separate tab - ready to use instantly
holdTime,Learn where information lives in systems - don't hunt around while customer waits
holdTime,If hold will be long - offer callback instead of making customer wait
holdTime,Practice navigation - the faster you move through screens the less customers wait
overallSentiment,Smile while talking - customers hear it in your voice even on the phone
overallSentiment,Use customer's name at least twice during call - beginning and end
overallSentiment,Match the customer's energy level - if they're calm be calm - if concerned show empathy
overallSentiment,Lead with empathy on difficult calls: 'I understand this is frustrating - let me help'
overallSentiment,Sound genuinely interested - not robotic - vary your tone
overallSentiment,Use their words back: If they say 'bill is confusing' say 'Let me clarify that confusing bill'
overallSentiment,End on positive note even if you couldn't do everything: 'I'm glad I could at least help with X'
overallSentiment,Acknowledge their effort: 'I appreciate you calling in about this instead of letting it slide'
overallSentiment,Avoid dead air - if you're thinking say 'Let me think about best way to help you here'
overallSentiment,Thank them for patience if call took longer: 'Thanks for bearing with me on that'
positiveWord,Replace 'problem' with 'situation' - it sounds less negative
positiveWord,Say 'I'd be happy to help you with that' instead of 'I can help you'
positiveWord,Use 'absolutely' instead of 'yes' - it's more enthusiastic
positiveWord,Say 'Let me find that information' not 'I don't have that information'
positiveWord,Replace 'You need to' with 'The next step is' - sounds less demanding
positiveWord,Say 'I can' instead of 'I can't' - focus on what you CAN do
positiveWord,Use 'opportunity' instead of 'issue' when appropriate
positiveWord,Say 'Let me get that handled for you' instead of 'Let me fix that problem'
positiveWord,Replace 'Your account shows' with 'I see here that' - sounds more collaborative
positiveWord,Say 'moving forward' instead of 'from now on' - sounds more optimistic
negativeWord,Replace 'unfortunately' with 'what I can do is...' to focus on solutions
negativeWord,Never say 'I don't know' - say 'Great question let me find that answer for you'
negativeWord,Avoid 'but' - use 'and' or 'however' to sound less contradictory
negativeWord,Don't say 'That's not my department' - say 'Let me connect you with the right team'
negativeWord,Replace 'You'll have to' with 'The next step is' - sounds less harsh
negativeWord,Avoid 'policy won't allow' - say 'Here's what I can offer instead'
negativeWord,Don't say 'That's impossible' - say 'Let me see what options we have'
negativeWord,Replace 'You're wrong' with 'Let me clarify what happened here'
negativeWord,Avoid 'There's nothing I can do' - always offer SOMETHING even if small
negativeWord,Don't say 'You didn't' - say 'It looks like this step was missed'
managingEmotions,Take a 3-second breath before responding to frustrated customers
managingEmotions,Use phrases like 'I understand your frustration' before solving - validate first
managingEmotions,Lower your voice volume slightly when customer raises theirs - it naturally de-escalates
managingEmotions,Don't take angry words personally - they're frustrated with situation not you
managingEmotions,Stay solution-focused: 'I hear you - let me see what I can do to help'
managingEmotions,Acknowledge their feelings: 'I can tell this has been really frustrating for you'
managingEmotions,Give yourself 30 seconds between difficult calls to reset mentally
managingEmotions,If customer is yelling - let them vent for 20-30 seconds then redirect calmly
managingEmotions,Use 'we' language: 'Let's figure this out together' - creates partnership feeling
managingEmotions,If you're getting triggered - put on hold for 10 seconds and breathe - then come back calm
reliability,Set two alarms for your shift - one for wake up one for leave house time
reliability,Have a backup plan for transportation issues - know your bus backup route
reliability,If you're running late call supervisor as soon as you know - not when you arrive
reliability,Review your Verint time entries weekly - make sure PTOST is coded correctly
reliability,Use PTOST for first 40 hours of unplanned time off - code it in Verint ahead of time
reliability,Schedule planned time off weeks in advance - don't wait until last minute
reliability,If you're sick - call out at least 2 hours before shift - don't text
reliability,Keep track of your PTOST usage - don't be surprised when you run out
reliability,Set recurring calendar reminders for your regular shifts - avoid forgetting
reliability,If you have consistent late issues - talk to supervisor about schedule adjustment before it becomes disciplinary
cxRepOverall,Listen for the REAL issue behind the question - sometimes billing question is actually payment plan need
cxRepOverall,End every call with specific next steps - don't leave customer wondering what happens next
cxRepOverall,Follow up on promises - if you said you'd call back - call back
cxRepOverall,Take ownership of the customer's issue - don't pass the buck
cxRepOverall,Be proactive - if you see a potential issue on account - address it before they ask
cxRepOverall,Make customer feel heard - repeat back their concern to show you listened
cxRepOverall,Go one step beyond - if they ask about bill also mention upcoming due date
cxRepOverall,Show you care about resolution not just call completion
cxRepOverall,Use their communication style - if they're chatty engage - if they're rushed be efficient
cxRepOverall,End with confidence: 'You're all set - reach out if you need anything else'`;

async function loadServerTips() {
    try {
        // Use embedded CSV data for offline support
        const csv = EMBEDDED_TIPS_CSV;
        const lines = csv.split('\n').map(line => line.trim()).filter(line => line);
        const dataLines = lines.slice(1);
        
        const tips = {};
        const tipsWithOriginalIndex = {}; // Track original indices
        
        dataLines.forEach((line, lineIndex) => {
            const match = line.match(/^([^,]+),"?([^"]*)"?$/);
            if (match) {
                const metric = match[1].trim();
                const tip = match[2].trim();
                
                if (!tips[metric]) {
                    tips[metric] = [];
                    tipsWithOriginalIndex[metric] = [];
                }
                const originalIndex = tips[metric].length;
                tips[metric].push(tip);
                tipsWithOriginalIndex[metric].push({ tip, originalIndex });
            }
        });
        
        // Apply modified server tips from localStorage
        const modifiedServerTips = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'modifiedServerTips') || '{}');
        Object.keys(modifiedServerTips).forEach(metricKey => {
            if (tipsWithOriginalIndex[metricKey]) {
                Object.keys(modifiedServerTips[metricKey]).forEach(index => {
                    const originalIdx = parseInt(index);
                    // Find the tip object with this original index
                    const tipObj = tipsWithOriginalIndex[metricKey].find(t => t.originalIndex === originalIdx);
                    if (tipObj) {
                        tipObj.tip = modifiedServerTips[metricKey][index];
                    }
                });
            }
        });
        
        // Filter out deleted server tips (using original indices)
        const deletedServerTips = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'deletedServerTips') || '{}');
        Object.keys(deletedServerTips).forEach(metricKey => {
            if (tipsWithOriginalIndex[metricKey]) {
                const deletedIndices = deletedServerTips[metricKey] || [];
                tipsWithOriginalIndex[metricKey] = tipsWithOriginalIndex[metricKey].filter(
                    item => !deletedIndices.includes(item.originalIndex)
                );
            }
        });
        
        // Store the indexed version for later use
        window._serverTipsWithIndex = tipsWithOriginalIndex;
        
        // Return simple array for backward compatibility
        const simpleTips = {};
        Object.keys(tipsWithOriginalIndex).forEach(metricKey => {
            simpleTips[metricKey] = tipsWithOriginalIndex[metricKey].map(item => item.tip);
        });
        
        return simpleTips;
    } catch (error) {
        console.error('Error loading tips:', error);
        // Ensure _serverTipsWithIndex is always set to prevent render errors
        window._serverTipsWithIndex = {};
        return {};
    }
}

function loadUserTips() {
    try {
        const saved = localStorage.getItem(STORAGE_PREFIX + 'userCustomTips');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading user tips:', error);
        return {};
    }
}

function saveUserTips(tips) {
    try {
        localStorage.setItem(STORAGE_PREFIX + 'userCustomTips', JSON.stringify(tips));
    } catch (error) {
        console.error('Error saving user tips:', error);
    }
}



function loadCoachingHistory() {
    try {
        const saved = localStorage.getItem(STORAGE_PREFIX + 'coachingHistory');
        const data = saved ? JSON.parse(saved) : {};
        return data;
    } catch (error) {
        console.error('Error loading coaching history:', error);
        return {};
    }
}

function saveCoachingHistory() {
    try {
        if (!saveWithSizeCheck('coachingHistory', coachingHistory)) {
            console.error('Failed to save coaching history due to size');
        }
    } catch (error) {
        console.error('Error saving coaching history:', error);
    }
}

function loadSentimentPhraseDatabase() {
    try {
        const saved = localStorage.getItem(STORAGE_PREFIX + SENTIMENT_PHRASE_DB_STORAGE_KEY);
        return saved ? JSON.parse(saved) : null;
    } catch (error) {
        console.error('Error loading sentiment phrase database:', error);
        return null;
    }
}

function saveSentimentPhraseDatabase() {
    try {
        if (!saveWithSizeCheck(SENTIMENT_PHRASE_DB_STORAGE_KEY, sentimentPhraseDatabase || {})) {
            console.error('Failed to save sentiment phrase database due to size');
        }
    } catch (error) {
        console.error('Error saving sentiment phrase database:', error);
    }
}

function loadAssociateSentimentSnapshots() {
    try {
        const saved = localStorage.getItem(STORAGE_PREFIX + ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY);
        let loaded = saved ? JSON.parse(saved) : {};
        
        // Migrate old format (object with timeframe keys) to new format (array)
        Object.keys(loaded).forEach(employeeName => {
            const employeeData = loaded[employeeName];
            
            // Check if it's in old format (object with timeframe keys instead of array)
            if (employeeData && typeof employeeData === 'object' && !Array.isArray(employeeData)) {
                const migratedArray = [];
                Object.entries(employeeData).forEach(([timeframeKey, snapshot]) => {
                    // timeframeKey format: "2026-02-06_2026-02-20"
                    const [start, end] = timeframeKey.split('_');
                    
                    // Check if snapshot is in OLD data structure (positive/negative/emotions)
                    // vs NEW structure (scores/calls/topPhrases)
                    if (snapshot.positive || snapshot.negative || snapshot.emotions) {
                        // Convert old format to new format
                        snapshot = {
                            associateName: employeeName,
                            timeframeStart: start,
                            timeframeEnd: end,
                            savedAt: snapshot.savedAt || new Date().toISOString(),
                            scores: {
                                positiveWord: snapshot.positive?.percentage || 0,
                                negativeWord: snapshot.negative?.percentage || 0,
                                managingEmotions: snapshot.emotions?.percentage || 0
                            },
                            calls: {
                                positiveTotal: snapshot.positive?.totalCalls || 0,
                                positiveDetected: snapshot.positive?.callsDetected || 0,
                                negativeTotal: snapshot.negative?.totalCalls || 0,
                                negativeDetected: snapshot.negative?.callsDetected || 0,
                                emotionsTotal: snapshot.emotions?.totalCalls || 0,
                                emotionsDetected: snapshot.emotions?.callsDetected || 0
                            },
                            topPhrases: {
                                positiveA: snapshot.positive?.phrases || [],
                                negativeA: snapshot.negative?.phrases?.filter(p => p.speaker === 'A') || [],
                                negativeC: snapshot.negative?.phrases?.filter(p => p.speaker === 'C') || [],
                                emotions: snapshot.emotions?.phrases || []
                            },
                            suggestions: snapshot.suggestions || {}
                        };
                    } else {
                        // Already in new format, just ensure required properties
                        if (!snapshot.timeframeStart) snapshot.timeframeStart = start;
                        if (!snapshot.timeframeEnd) snapshot.timeframeEnd = end;
                        if (!snapshot.associateName) snapshot.associateName = employeeName;
                        if (!snapshot.savedAt) snapshot.savedAt = new Date().toISOString();
                    }
                    
                    migratedArray.push(snapshot);
                });
                
                loaded[employeeName] = migratedArray;
            }
        });
        
        // Save migrated data back to localStorage if migration occurred
        const needsSave = Object.values(loaded).some(data => Array.isArray(data));
        if (needsSave) {
            localStorage.setItem(STORAGE_PREFIX + ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY, JSON.stringify(loaded));
            console.log('💾 Saved migrated sentiment data to localStorage');
        }
        
        return loaded;
    } catch (error) {
        console.error('Error loading associate sentiment snapshots:', error);
        return {};
    }
}

function saveAssociateSentimentSnapshots() {
    try {
        if (!saveWithSizeCheck(ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY, associateSentimentSnapshots || {})) {
            console.error('Failed to save associate sentiment snapshots due to size');
        }
    } catch (error) {
        console.error('Error saving associate sentiment snapshots:', error);
    }
}

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
    
    const weekCount = Object.keys(weeklyData || {}).length;
    const sentimentCount = Object.keys(associateSentimentSnapshots || {}).reduce((sum, emp) => sum + (associateSentimentSnapshots[emp]?.length || 0), 0);
    const callListeningCount = Object.values(callListeningLogs || {}).reduce((sum, entries) => sum + (Array.isArray(entries) ? entries.length : 0), 0);

    showToast(`✅ Exported ${weekCount} weeks + ${sentimentCount} sentiment snapshots + ${callListeningCount} call logs to ${exportFileDefaultName}`, 5000);
}

// ============================================
// TEAM MEMBER MANAGEMENT
// ============================================

function loadTeamMembers() {
    try {
        const saved = localStorage.getItem(STORAGE_PREFIX + 'myTeamMembers');
        myTeamMembers = saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading team members:', error);
        myTeamMembers = {};
    }
}

function saveTeamMembers() {
    try {
        if (!saveWithSizeCheck('myTeamMembers', myTeamMembers)) {
            console.error('Failed to save team members due to size');
        }
        queueRepoSync('team members updated');
    } catch (error) {
        console.error('Error saving team members:', error);
    }
}

function setTeamMembersForWeek(weekKey, memberNames) {
    myTeamMembers[weekKey] = memberNames;
    saveTeamMembers();
    notifyTeamFilterChanged();
}

function getTeamMembersForWeek(weekKey) {
    return myTeamMembers[weekKey] || [];
}

function isTeamMember(weekKey, employeeName) {
    const members = getTeamMembersForWeek(weekKey);
    return members.length === 0 || members.includes(employeeName);
}

function getLatestTeamSelectionWeekKey() {
    const weekKeys = Object.keys(weeklyData || {});
    if (!weekKeys.length) return '';

    const getEndTimestamp = (weekKey) => {
        const metadataEnd = String(weeklyData?.[weekKey]?.metadata?.endDate || '').trim();
        const fallbackEnd = String(weekKey || '').split('|')[1] || String(weekKey || '').split('|')[0] || '';
        const candidate = metadataEnd || fallbackEnd;
        const parsed = candidate ? new Date(candidate) : new Date(NaN);
        return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
    };

    return weekKeys.reduce((latest, key) => {
        if (!latest) return key;
        return getEndTimestamp(key) > getEndTimestamp(latest) ? key : latest;
    }, '');
}

function getTeamSelectionWeekKey() {
    const dropdownWeek = String(document.getElementById('deleteWeekSelect')?.value || '').trim();
    if (dropdownWeek && weeklyData?.[dropdownWeek]) return dropdownWeek;
    return getLatestTeamSelectionWeekKey();
}

function getTeamSelectionContext() {
    const weekKey = getTeamSelectionWeekKey();
    const employeesForWeek = Array.isArray(weeklyData?.[weekKey]?.employees)
        ? weeklyData[weekKey].employees.map(emp => String(emp?.name || '').trim()).filter(Boolean)
        : [];
    const selectedMembers = weekKey
        ? getTeamMembersForWeek(weekKey).map(name => String(name || '').trim()).filter(Boolean)
        : [];

    return {
        weekKey,
        selectedMembers,
        selectedSet: selectedMembers.length ? new Set(selectedMembers) : null,
        totalEmployeesInWeek: employeesForWeek.length,
        isFiltering: selectedMembers.length > 0
    };
}

function isAssociateIncludedByTeamFilter(employeeName, context = null) {
    const normalizedName = String(employeeName || '').trim();
    if (!normalizedName) return false;
    const filterContext = context || getTeamSelectionContext();
    if (!filterContext?.isFiltering || !filterContext?.selectedSet) return true;
    return filterContext.selectedSet.has(normalizedName);
}

function filterAssociateNamesByTeamSelection(names) {
    const context = getTeamSelectionContext();
    return (Array.isArray(names) ? names : [])
        .map(name => String(name || '').trim())
        .filter(Boolean)
        .filter(name => isAssociateIncludedByTeamFilter(name, context));
}

function updateTeamFilterStatusChip() {
    const chip = document.getElementById('teamFilterStatusChip');
    if (!chip) return;

    const context = getTeamSelectionContext();
    if (!context.weekKey) {
        chip.textContent = 'Active Team Filter: No weekly data loaded';
        chip.style.background = '#eceff1';
        chip.style.color = '#455a64';
        return;
    }

    const weekLabel = formatWeekLabel(context.weekKey) || context.weekKey;
    if (!context.isFiltering) {
        chip.textContent = `Active Team Filter: All associates • Week ending ${weekLabel}`;
        chip.style.background = '#e8f5e9';
        chip.style.color = '#2e7d32';
        return;
    }

    chip.textContent = `Active Team Filter: ${context.selectedMembers.length} selected • Week ending ${weekLabel}`;
    chip.style.background = '#fff3e0';
    chip.style.color = '#ef6c00';
}

function notifyTeamFilterChanged() {
    const context = getTeamSelectionContext();
    updateTeamFilterStatusChip();
    window.dispatchEvent(new CustomEvent('devcoach:teamFilterChanged', { detail: context }));
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
    if (currentPeriodType === 'week') {
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
        });
    });

    document.getElementById('showUploadMetricsBtn')?.addEventListener('click', () => {
        const container = document.getElementById('pasteDataContainer');
        if (container) {
            container.style.display = container.style.display === 'none' ? 'block' : 'none';
        }
    });

    document.getElementById('showUploadSentimentBtn')?.addEventListener('click', openUploadSentimentModal);
    document.getElementById('sentimentUploadCancelBtn')?.addEventListener('click', closeUploadSentimentModal);
    document.getElementById('sentimentUploadSubmitBtn')?.addEventListener('click', handleSentimentUploadSubmit);
    document.getElementById('pasteDataTextarea')?.addEventListener('input', handlePasteDataTextareaInput);
    document.getElementById('loadPastedDataBtn')?.addEventListener('click', handleLoadPastedDataClick);
    document.getElementById('testPastedDataBtn')?.addEventListener('click', handleTestPastedDataClick);
    enableDatePickerOpen(document.getElementById('pasteWeekEndingDate'));
}

function bindNavigationHandlers() {
    document.getElementById('homeBtn')?.addEventListener('click', () => showOnlySection('coachingForm'));
    document.getElementById('coachingEmailBtn')?.addEventListener('click', () => {
        showOnlySection('coachingEmailSection');
        showSubSection('subSectionCoachingEmail', 'subNavCoachingEmail');
        initializeCoachingEmail();
    });

    document.getElementById('subNavCoachingEmail')?.addEventListener('click', () => {
        showSubSection('subSectionCoachingEmail', 'subNavCoachingEmail');
        initializeCoachingEmail();
    });
    document.getElementById('subNavYearEnd')?.addEventListener('click', () => {
        showSubSection('subSectionYearEnd', 'subNavYearEnd');
        initializeYearEndComments();
    });
    document.getElementById('subNavOnOffTracker')?.addEventListener('click', () => {
        showSubSection('subSectionOnOffTracker', 'subNavOnOffTracker');
        initializeOnOffTracker();
    });
    document.getElementById('subNavSentiment')?.addEventListener('click', handleSubNavSentimentClick);
    document.getElementById('subNavMetricTrends')?.addEventListener('click', handleSubNavMetricTrendsClick);
    document.getElementById('subNavTrendIntelligence')?.addEventListener('click', handleSubNavTrendIntelligenceClick);
    document.getElementById('subNavCallListening')?.addEventListener('click', () => {
        showSubSection('subSectionCallListening', 'subNavCallListening');
        initializeCallListeningSection();
    });
}

function bindManageDataNavigationHandlers() {
    document.getElementById('manageDataBtn')?.addEventListener('click', () => {
        showOnlySection('manageDataSection');
        showManageDataSubSection('subSectionTeamData');
        initializeRepoSyncControls();
        populateDeleteWeekDropdown();
        renderEmployeesList();
    });

    document.getElementById('subNavTeamData')?.addEventListener('click', () => {
        showManageDataSubSection('subSectionTeamData');
        initializeRepoSyncControls();
        populateDeleteWeekDropdown();
        renderEmployeesList();
    });
    document.getElementById('subNavCoachingTips')?.addEventListener('click', () => {
        showManageDataSubSection('subSectionCoachingTips');
        const tipsManagementSection = document.getElementById('tipsManagementSection');
        const subSectionCoachingTips = document.getElementById('subSectionCoachingTips');
        if (tipsManagementSection && subSectionCoachingTips) {
            while (tipsManagementSection.firstChild) {
                subSectionCoachingTips.appendChild(tipsManagementSection.firstChild);
            }
        }
        renderTipsManagement();
    });
    document.getElementById('subNavSentimentKeywords')?.addEventListener('click', () => {
        showManageDataSubSection('subSectionSentimentKeywords');
        renderSentimentDatabasePanel();
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
    document.getElementById('ptoBtn')?.addEventListener('click', () => {
        showOnlySection('ptoSection');
        initializePtoTracker();
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

function handleSubNavMetricTrendsClick() {
    showSubSection('subSectionMetricTrends', 'subNavMetricTrends');
    const metricTrendsSection = document.getElementById('metricTrendsSection');
    const subSectionMetricTrends = document.getElementById('subSectionMetricTrends');
    if (metricTrendsSection && subSectionMetricTrends) {
        while (metricTrendsSection.firstChild) {
            subSectionMetricTrends.appendChild(metricTrendsSection.firstChild);
        }
    }
    initializeMetricTrends();
}

function ensureTrendIntelligenceMounted() {
    const subSection = document.getElementById('subSectionTrendIntelligence');
    if (!subSection) return;

    const alreadyMounted = Boolean(subSection.querySelector('#executiveSummaryContainer'));
    if (alreadyMounted) return;

    const sourceSection = document.getElementById('executiveSummarySection');
    if (!sourceSection) return;

    while (sourceSection.firstChild) {
        subSection.appendChild(sourceSection.firstChild);
    }

    const placeholderText = Array.from(subSection.querySelectorAll('p')).find(p =>
        (p.textContent || '').toLowerCase().includes('trend intelligence content will appear here')
    );
    if (placeholderText) {
        placeholderText.remove();
    }
}

function handleSubNavTrendIntelligenceClick() {
    showSubSection('subSectionTrendIntelligence', 'subNavTrendIntelligence');
    ensureTrendIntelligenceMounted();
    renderExecutiveSummary();

    const summarySelect = document.getElementById('summaryAssociateSelect');
    if (summarySelect) {
        summarySelect.value = '';
    }

    const dataContainer = document.getElementById('summaryDataContainer');
    const chartsContainer = document.getElementById('summaryChartsContainer');

    if (dataContainer) dataContainer.style.display = 'none';
    if (chartsContainer) chartsContainer.innerHTML = '';
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

function handleSubNavSentimentClick() {
    showSubSection('subSectionSentiment', 'subNavSentiment');

    const sentimentSection = document.getElementById('sentimentSection');
    const subSectionSentiment = document.getElementById('subSectionSentiment');
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

    if (daysDiff >= 26 && daysDiff <= 33) return 'month';
    if (daysDiff >= 88 && daysDiff <= 95) return 'quarter';
    if (daysDiff >= 180) return 'ytd';
    return 'week';
}

function resolveSelectedUploadPeriodType(detectedPeriodType) {
    const periodButtons = document.querySelectorAll('.upload-period-btn');
    periodButtons.forEach(btn => {
        if (btn.dataset.period === detectedPeriodType) {
            btn.click();
        }
    });

    const selectedBtn = document.querySelector('.upload-period-btn[style*="background: rgb(40, 167, 69)"]') ||
        document.querySelector('.upload-period-btn[style*="background:#28a745"]') ||
        document.querySelector('.upload-period-btn[data-period="week"]');
    return selectedBtn ? selectedBtn.dataset.period : detectedPeriodType;
}

function buildPastedUploadContext(startDate, endDate, periodType, selectedYearEndProfile) {
    const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
    const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
    const normalizedEndDate = new Date(endYear, endMonth - 1, endDay);
    const startDateObj = new Date(startYear, startMonth - 1, startDay);
    const autoReviewYear = String(normalizedEndDate.getFullYear());
    const yearEndReviewYear = selectedYearEndProfile === 'auto' ? autoReviewYear : selectedYearEndProfile;

    let label;
    if (periodType === 'week') {
        label = `Week ending ${normalizedEndDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
    } else if (periodType === 'month') {
        label = `${startDateObj.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;
    } else if (periodType === 'quarter') {
        const quarter = Math.floor(startDateObj.getMonth() / 3) + 1;
        label = `Q${quarter} ${startDateObj.getFullYear()}`;
    } else if (periodType === 'ytd') {
        label = `YTD through ${normalizedEndDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
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
    if (holdBlankCount === safeEmployees.length && (ahtPresentCount > 0 || acwPresentCount > 0)) {
        warnings.push('Hold Time is blank for all associates. This source export may not include a hold-time column; if expected, verify the Hold header in source data.');
    } else if (holdBlankRatio >= 0.65 && (ahtPresentCount > 0 || acwPresentCount > 0)) {
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
    const endDateObj = new Date(weekEndingDate);
    endDateObj.setDate(endDateObj.getDate() - 6);
    const startDate = endDateObj.toISOString().split('T')[0];

    const detectedPeriodType = detectUploadPeriodTypeByRange(startDate, endDate);
    const periodType = resolveSelectedUploadPeriodType(detectedPeriodType);

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
        const yearEndProfileSelect = document.getElementById('uploadYearEndProfile');
        const selectedYearEndProfile = (yearEndProfileSelect?.value || 'auto').trim();
        const uploadContext = buildPastedUploadContext(startDate, endDate, periodType, selectedYearEndProfile);
        const { label, normalizedEndDate, metadata } = uploadContext;

        const targetStore = periodType === 'ytd' ? ytdData : weeklyData;
        targetStore[weekKey] = {
            employees,
            metadata
        };

        if (periodType !== 'ytd') {
            upsertAutoYtdForYear(normalizedEndDate.getFullYear(), endDate);
        }

        saveWeeklyData();
        saveYtdData();

        populateDeleteWeekDropdown();
        populateUploadedDataDropdown();
        populateTeamMemberSelector();

        document.getElementById('uploadSuccessMessage').style.display = 'block';
        document.getElementById('pasteDataTextarea').value = '';

        showOnlySection('coachingSection');

        if (periodType !== 'ytd') {
            syncWeeklyViewAfterPastedUpload(weekKey);
        }

        alert(`✅ Loaded ${employees.length} employees for ${label}!\n\nManage associates in "👥 Team Members & Employees" under "📊 Manage Data".`);

        setTimeout(() => {
            location.reload();
        }, 500);
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

    if (weekEndingDate) {
        const endDateObj = new Date(weekEndingDate);
        endDateObj.setDate(endDateObj.getDate() - 6);
        startDate = endDateObj.toISOString().split('T')[0];
    } else {
        const today = new Date();
        endDate = today.toISOString().split('T')[0];
        const startDateObj = new Date(today);
        startDateObj.setDate(startDateObj.getDate() - 6);
        startDate = startDateObj.toISOString().split('T')[0];
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
    const weekCount = Object.keys(weeklyData).length;
    if (weekCount === 0) {
        alert('⚠️ No data to delete');
        return;
    }

    const message = `⚠️ WARNING: This will permanently delete:\n\n` +
        `📊 ${weekCount} week(s) of employee data\n\n` +
        `This action CANNOT be undone!\n\n` +
        `Type "DELETE" to confirm:`;

    const confirmation = prompt(message);
    if (confirmation !== 'DELETE') {
        alert('⚠️ Deletion cancelled');
        return;
    }

    weeklyData = {};
    ytdData = {};
    myTeamMembers = {};
    callListeningLogs = {};

    localStorage.removeItem(STORAGE_PREFIX + 'weeklyData');
    localStorage.removeItem(STORAGE_PREFIX + 'ytdData');
    localStorage.removeItem(STORAGE_PREFIX + 'myTeamMembers');
    localStorage.removeItem(STORAGE_PREFIX + 'callCenterAverages');
    localStorage.removeItem(STORAGE_PREFIX + 'employeeNicknames');
    localStorage.removeItem(STORAGE_PREFIX + 'employeePreferredNames');
    localStorage.removeItem(STORAGE_PREFIX + 'coachingHistory');
    localStorage.removeItem(STORAGE_PREFIX + 'callListeningLogs');
    localStorage.removeItem(STORAGE_PREFIX + 'tipUsageHistory');
    localStorage.removeItem(STORAGE_PREFIX + 'complianceLog');
    localStorage.removeItem(STORAGE_PREFIX + 'executiveSummaryNotes');
    localStorage.removeItem(STORAGE_PREFIX + SENTIMENT_PHRASE_DB_STORAGE_KEY);
    localStorage.removeItem(STORAGE_PREFIX + ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY);

    sentimentPhraseDatabase = null;
    associateSentimentSnapshots = {};

    saveWeeklyData();
    saveYtdData();
    saveTeamMembers();
    saveCallListeningLogs(true, 'cleared all data');

    populateDeleteWeekDropdown();
    populateDeleteEmployeeYearOptions();

    ['metricsSection', 'employeeInfoSection', 'customNotesSection', 'generateEmailBtn'].forEach(id => {
        const element = document.getElementById(id);
        if (element) element.style.display = 'none';
    });

    alert('✅ All data has been deleted (including call center averages and history)');
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
    return {
        endpoint: 'https://dev-coaching-sync.scottk.workers.dev',
        autoSyncEnabled: true,
        sharedSecret: ''
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
            sharedSecret: typeof parsed?.sharedSecret === 'string' ? parsed.sharedSecret : defaults.sharedSecret
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
        sharedSecret: String(config?.sharedSecret || '').trim()
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
        sharedSecret: String(current?.sharedSecret || '').trim()
    };

    const endpointChanged = String(current?.endpoint || '').trim() !== endpoint;
    const autoSyncChanged = current?.autoSyncEnabled !== normalized.autoSyncEnabled;
    const secretChanged = String(current?.sharedSecret || '').trim() !== normalized.sharedSecret;

    if (endpointChanged || autoSyncChanged || secretChanged) {
        saveCallListeningSyncConfig(normalized);
    }

    return normalized;
}

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

function withRepoSyncSuppressed(action) {
    repoSyncSuppressCounter += 1;
    try {
        return action();
    } finally {
        repoSyncSuppressCounter = Math.max(0, repoSyncSuppressCounter - 1);
    }
}

function shouldSyncForStorageKey(key) {
    const storageKey = String(key || '');
    if (!storageKey || !storageKey.startsWith(STORAGE_PREFIX)) return false;

    const ignoredKeys = new Set([
        CALL_LISTENING_SYNC_CONFIG_STORAGE_KEY,
        REPO_SYNC_LAST_SUCCESS_STORAGE_KEY
    ]);

    return !ignoredKeys.has(storageKey);
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
    const details = [data.reason, data.commit].filter(Boolean).join(' • ');
    if (el) {
        el.textContent = `Last successful sync: ${when}${details ? ` (${details})` : ''}`;
    }
    if (lastSyncFooterEl) {
        lastSyncFooterEl.textContent = `Last Sync: ${when}`;
    }
}

function buildDiagnosticsSummary() {
    const syncMeta = loadRepoSyncLastSuccess();
    const teamContext = getTeamSelectionContext();
    const shortCommit = String(syncMeta?.commit || '').trim().slice(0, 7) || 'n/a';
    const syncedAt = syncMeta?.syncedAt ? new Date(syncMeta.syncedAt).toLocaleString() : 'none';

    return [
        `Version: ${APP_VERSION}`,
        `Deploy: ${shortCommit}`,
        `Last Sync: ${syncedAt}`,
        `Team Filter Week: ${teamContext.weekKey || 'none'}`,
        `Team Filter Mode: ${teamContext.isFiltering ? `${teamContext.selectedMembers.length} selected` : 'all associates'}`,
        `Current Period Type: ${currentPeriodType || 'unknown'}`,
        `Current Period: ${currentPeriod || 'none'}`,
        `Weekly Periods Loaded: ${Object.keys(weeklyData || {}).length}`,
        `YTD Periods Loaded: ${Object.keys(ytdData || {}).length}`
    ].join('\n');
}

function bindDiagnosticsCopyAction() {
    const button = document.getElementById('copyDiagnosticsBtn');
    if (!button || button.dataset.bound === 'true') return;

    button.addEventListener('click', async () => {
        const diagnostics = buildDiagnosticsSummary();
        try {
            await navigator.clipboard.writeText(diagnostics);
            showToast('✅ Diagnostics copied.', 2500);
        } catch (_error) {
            alert(`Copy failed. Diagnostics:\n\n${diagnostics}`);
        }
    });

    button.dataset.bound = 'true';
}

function setAutoSyncEnabledStatus(config) {
    if (config?.autoSyncEnabled && String(config?.endpoint || '').trim()) {
        setCallListeningSyncStatus('Auto-sync enabled. Changes will sync after save/update/delete.', 'info');
    } else {
        setCallListeningSyncStatus('Auto-sync disabled. Add Worker URL and enable auto-sync to push to repo.', 'info');
    }
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
    const syncEndpointInput = document.getElementById('callListeningSyncEndpoint');
    const syncSecretInput = document.getElementById('callListeningSyncSecret');
    const autoSyncCheckbox = document.getElementById('callListeningAutoSyncEnabled');
    const syncNowBtn = document.getElementById('syncNowBtn');
    const forceRestoreBtn = document.getElementById('forceRestoreRepoBtn');
    const exportLedgerBtn = document.getElementById('exportIntelligenceLedgerXlsxBtn');
    const openFullExcelBtn = document.getElementById('openFullBackupExcelBtn');
    const openPtoExcelBtn = document.getElementById('openPtoExcelBtn');

    if (!syncEndpointInput || !autoSyncCheckbox || !syncNowBtn || !openFullExcelBtn) {
        return;
    }

    const syncConfig = loadCallListeningSyncConfig();
    syncEndpointInput.value = syncConfig.endpoint || '';
    if (syncSecretInput) syncSecretInput.value = syncConfig.sharedSecret || '';
    autoSyncCheckbox.checked = syncConfig.autoSyncEnabled;
    setAutoSyncEnabledStatus(syncConfig);
    renderCallListeningLastSync();

    if (!syncNowBtn.dataset.bound) {
        syncNowBtn.addEventListener('click', async () => {
            await runWithButtonBusyState(syncNowBtn, '⏳ Syncing...', async () => {
                getCallListeningSyncConfigFromUI();
                await syncRepoData('manual sync now', { force: true });
            });
        });
        syncNowBtn.dataset.bound = 'true';
    }
    if (forceRestoreBtn && !forceRestoreBtn.dataset.bound) {
        forceRestoreBtn.addEventListener('click', async () => {
            const confirmed = confirm('Restore from repo backup and overwrite ALL local data in this browser profile? This cannot be undone.');
            if (!confirmed) return;

            await runWithButtonBusyState(forceRestoreBtn, '⏳ Restoring...', async () => {
                setCallListeningSyncStatus('Restoring from repo backup (overwrite local)...', 'info');

                try {
                    const payload = await fetchRepoBackupPayload();
                    if (!hasMeaningfulBackupData(payload)) {
                        throw new Error('No repo backup data found to restore.');
                    }

                    await withRepoSyncHydrationLock(async () => {
                        applyRepoBackupPayload(payload);
                    });

                    saveRepoBackupAppliedAt(payload?.generatedAt || new Date().toISOString());

                    setCallListeningSyncStatus('Restore complete. Reloading with restored profile...', 'success');
                    showToast('✅ Local profile overwritten from repo backup.', 3500);
                    setTimeout(() => window.location.reload(), 500);
                } catch (error) {
                    console.error('Force restore failed:', error);
                    setCallListeningSyncStatus(`Restore failed: ${error.message}`, 'error');
                    showToast(`⚠️ Restore failed: ${error.message}`, 4000);
                }
            });
        });
        forceRestoreBtn.dataset.bound = 'true';
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
            await runWithButtonBusyState(exportLedgerBtn, '⏳ Exporting...', async () => {
                await exportIntelligenceLedgerWorkbook();
            });
        });
        exportLedgerBtn.dataset.bound = 'true';
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
    if (syncSecretInput && !syncSecretInput.dataset.bound) {
        const persistSecretConfig = () => {
            getCallListeningSyncConfigFromUI();
        };
        syncSecretInput.addEventListener('change', persistSecretConfig);
        syncSecretInput.addEventListener('input', persistSecretConfig);
        syncSecretInput.dataset.bound = 'true';
    }
    if (!autoSyncCheckbox.dataset.bound) {
        autoSyncCheckbox.addEventListener('change', () => {
            const nextConfig = getCallListeningSyncConfigFromUI();
            setAutoSyncEnabledStatus(nextConfig);
        });
        autoSyncCheckbox.dataset.bound = 'true';
    }
}

function openRepoExcelFile(fileName) {
    const githubUrl = `https://github.com/ScottK83/Development-Coaching-Tool/raw/main/data/${encodeURIComponent(fileName)}?t=${Date.now()}`;
    const baseUrl = window?.location?.origin;
    const localUrl = baseUrl && baseUrl !== 'null' ? `${baseUrl}/data/${fileName}` : '';
    const fileUrl = githubUrl || localUrl;

    if (!fileUrl) {
        showToast('⚠️ Could not build Excel file URL.', 3500);
        return;
    }

    if (fileName === 'call-listening-logs.xlsx') {
        const totalCallLogs = getTotalCallListeningLogCount();
        if (totalCallLogs === 0) {
            showToast('ℹ️ Call Logs Excel will be blank until at least one call listening entry is saved.', 4500);
        }
    }

    window.open(fileUrl, '_blank');
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
        showToast('⚠️ XLSX library not loaded. Refresh and try again.', 3500);
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
        showToast('✅ Intelligence ledger exported to .xlsx', 3000);
    } catch (error) {
        console.error('Error exporting intelligence ledger workbook:', error);
        showToast(`⚠️ Could not export ledger: ${error.message}`, 4500);
    }
}

function getCallListeningSyncConfigFromUI() {
    const endpoint = document.getElementById('callListeningSyncEndpoint')?.value || '';
    const sharedSecret = document.getElementById('callListeningSyncSecret')?.value || '';
    const autoSyncEnabled = document.getElementById('callListeningAutoSyncEnabled')?.checked ?? true;
    return saveCallListeningSyncConfig({ endpoint, autoSyncEnabled, sharedSecret });
}

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
    return [
        weeklyData,
        ytdData,
        coachingHistory,
        callListeningLogs,
        associateSentimentSnapshots,
        myTeamMembers,
        window.DevCoachModules?.storage?.loadPtoTracker?.() || null,
        loadCallCenterAverages(),
        loadYearEndAnnualGoalsStore(),
        loadYearEndDraftStore()
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

function buildRepoSyncPayload(reason = 'updated') {
    const ptoTracker = window.DevCoachModules?.storage?.loadPtoTracker?.() || {};
    const localDataSummary = summarizeLocalBackupFreshness();

    return {
        appVersion: APP_VERSION,
        reason,
        generatedAt: new Date().toISOString(),
        localDataSummary,
        weeklyData: weeklyData || {},
        ytdData: ytdData || {},
        coachingHistory: coachingHistory || {},
        callListeningLogs: callListeningLogs || {},
        sentimentPhraseDatabase: sentimentPhraseDatabase || null,
        associateSentimentSnapshots: associateSentimentSnapshots || {},
        myTeamMembers: myTeamMembers || {},
        callCenterAverages: loadCallCenterAverages() || {},
        ptoTracker: ptoTracker && typeof ptoTracker === 'object' ? ptoTracker : {},
        yearEndAnnualGoalsStore: loadYearEndAnnualGoalsStore(),
        yearEndDraftStore: loadYearEndDraftStore(),
        appStorageSnapshot: getAllAppStorageSnapshot(),
        callListeningCsv: exportCallListeningLogsToCSV()
    };
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
    if (!canQueueRepoSync()) return;
    scheduleRepoSync(reason);
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
    const config = loadCallListeningSyncConfig();
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
    }, 1200);
}

function setRepoSyncQueuedStatus() {
    setCallListeningSyncStatus('Sync queued (all app data)...', 'info');
}

function queueCallListeningRepoSync(reason = 'updated') {
    queueRepoSync(reason);
}

function hasMeaningfulLocalData() {
    return getMeaningfulLocalDataSources().some(hasNonEmptyEntries);
}

function hasMeaningfulBackupData(payload) {
    if (!payload || typeof payload !== 'object') return false;

    return getMeaningfulBackupDataSources(payload).some(hasNonEmptyEntries);
}

async function withRepoSyncHydrationLock(action) {
    repoSyncHydrationInProgress = true;
    try {
        return await action();
    } finally {
        repoSyncHydrationInProgress = false;
    }
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
    weeklyData = coerceObject(payload?.weeklyData);
    ytdData = coerceObject(payload?.ytdData);
    coachingHistory = coerceObject(payload?.coachingHistory);
    callListeningLogs = coerceObject(payload?.callListeningLogs);
    sentimentPhraseDatabase = coerceNullableObject(payload?.sentimentPhraseDatabase);
    associateSentimentSnapshots = coerceObject(payload?.associateSentimentSnapshots);
    myTeamMembers = coerceObject(payload?.myTeamMembers);

    saveWeeklyData();
    saveYtdData();
    saveCoachingHistory();
    saveCallListeningLogs(false, 'restored from repo backup');
    saveSentimentPhraseDatabase();
    saveAssociateSentimentSnapshots();
    normalizeTeamMembersForExistingWeeks();
    saveTeamMembers();
    saveCallCenterAverages(coerceObject(payload?.callCenterAverages));
    if (window.DevCoachModules?.storage?.savePtoTracker) {
        const restoredPtoTracker = coerceObject(payload?.ptoTracker);
        window.DevCoachModules.storage.savePtoTracker(restoredPtoTracker);
    }
    saveYearEndAnnualGoalsStore(coerceObject(payload?.yearEndAnnualGoalsStore));
    saveYearEndDraftStore(coerceObject(payload?.yearEndDraftStore));
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
    return {
        syncedAt: new Date().toISOString(),
        reason,
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

function finalizeRepoSyncSuccess(reason, responseData) {
    repoSyncConflictPromptMutedUntil = 0;
    clearRepoSyncAutoPause();
    const syncMeta = buildRepoSyncMeta(reason, responseData);
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
    setCallListeningSyncStatus(`Sync failed: ${error.message}`, 'error');
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
    const existingSummary = error?.payload?.existingSummary || null;
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
            showToast('✅ Restored latest repo backup. Sync is now aligned.', 4000);
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

async function syncRepoData(reason = 'updated', options = {}) {
    const config = loadCallListeningSyncConfig();
    const forceSync = options?.force === true;
    const endpoint = getRepoSyncEndpointIfAllowed(config, forceSync);
    if (!endpoint) return;
    setCallListeningSyncStatus('Syncing all app data to repo...', 'info');

    try {
        const payload = buildRepoSyncPayload(reason);
        if (options?.allowDataRegression === true) {
            payload.allowDataRegression = true;
        }

        const response = await requestValidatedRepoSyncResponse(endpoint, config, payload);

        const responseData = await parseRepoSyncSuccessResponse(response);
        finalizeRepoSyncSuccess(reason, responseData);
    } catch (error) {
        error.interactive = forceSync;
        const handledConflict = await maybeHandleRepoSyncConflict(error);
        if (handledConflict) return;
        handleRepoSyncFailure(error);
    }
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
    
    const weeks = Object.keys(weeklyData).map(weekKey => {
        const weekData = weeklyData[weekKey];
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
        const weeks = Object.keys(weeklyData).sort().reverse();
        selectedWeek = weeks[0];
    }
    
    if (!selectedWeek || !weeklyData[selectedWeek]) {
        selector.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No data available</div>';
        return;
    }
    
    const employees = weeklyData[selectedWeek].employees || [];
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

/*
// ============================================
// TIPS MANAGEMENT UI
// ============================================

async function renderTipsManagement() {
    const container = document.getElementById('tipsContainer');
    if (!container) return;

    const customMetrics = loadCustomMetrics();
    
    // Build metricNames from METRICS_REGISTRY + customMetrics
    const metricNames = {};
    Object.entries(METRICS_REGISTRY).forEach(([key, metric]) => {
        metricNames[key] = metric.label;
    });
    // Add custom metrics
    Object.assign(metricNames, customMetrics);
    
    // Sort all tip categories alphabetically by display name
    const sortedCategories = Object.keys(metricNames)
        .sort((a, b) => metricNames[a].localeCompare(metricNames[b]));
    
    let html = '<div style="margin-bottom: 20px;">';
    html += '<p>Select a tip category below to expand and manage its coaching tips.</p>';
    html += '</div>';
    
    // Category Selector Section
    html += '<div id="manageCategorySection" style="margin-bottom: 25px; padding: 20px; background: white; border-radius: 8px; border: 2px solid #2196F3;">';
    html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">';
    html += '<label for="categoriesSelector" style="font-weight: bold; color: #2196F3; font-size: 1.1em; margin: 0;">Select Tip Category:</label>';
    html += '<button id="newMetricBtn" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 10px 16px; cursor: pointer; font-weight: bold; font-size: 0.95em;">+ New Category</button>';
    html += '</div>';
    html += '<select id="categoriesSelector" style="width: 100%; padding: 12px; border: 2px solid #2196F3; border-radius: 4px; font-size: 1em; cursor: pointer;">';
    html += '<option value="">-- Choose a category --</option>';
    // Add sorted categories
    sortedCategories.forEach(metricKey => {
        html += `<option value="${metricKey}">${metricNames[metricKey]}</option>`;
    });
    html += '</select>';
    html += '</div>';
    
    // Create New Metric section (hidden by default)
    html += '<div id="createMetricSection" style="display: none; margin-bottom: 25px; padding: 20px; background: #f0f8ff; border-radius: 8px; border: 2px dashed #2196F3;">';
    html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">';
    html += '<h3 style="color: #2196F3; margin: 0;">➕ Create New Category</h3>';
    html += '<button id="backToManageBtn" style="background: #6c757d; color: white; border: none; border-radius: 4px; padding: 8px 16px; cursor: pointer; font-weight: bold; font-size: 0.95em;">Back</button>';
    html += '</div>';
    html += '<div style="margin-bottom: 12px;">';
    html += '<label for="newMetricName" style="font-weight: bold; display: block; margin-bottom: 5px; color: #1976D2;">Category Name:</label>';
    html += '<input type="text" id="newMetricName" placeholder="e.g., Accuracy, Compliance, Efficiency" style="width: 100%; padding: 10px; border: 2px solid #2196F3; border-radius: 4px; font-size: 0.95em; box-sizing: border-box;">';
    html += '</div>';
    html += '<div style="margin-bottom: 12px;">';
    html += '<label for="newMetricTip" style="font-weight: bold; display: block; margin-bottom: 5px; color: #1976D2;">First Tip:</label>';
    html += '<textarea id="newMetricTip" placeholder="Enter a coaching tip for this new category..." style="width: 100%; padding: 10px; border: 2px solid #2196F3; border-radius: 4px; font-size: 0.95em; resize: vertical; box-sizing: border-box;" rows="2"></textarea>';
    html += '</div>';
    html += '<button id="createMetricBtn" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 10px 20px; cursor: pointer; font-weight: bold;">Create Category</button>';
    html += '</div>';
    
    // Tips display area (expandable category)
    html += '<div id="tipsDisplayArea" style="display: none;"></div>';
    
    container.innerHTML = html;
    
    // Helper function to switch to create mode
    function switchToCreateMode() {
        document.getElementById('manageCategorySection').style.display = 'none';
        document.getElementById('createMetricSection').style.display = 'block';
        document.getElementById('tipsDisplayArea').style.display = 'none';
        document.getElementById('categoriesSelector').value = '';
        document.getElementById('newMetricName').value = '';
        document.getElementById('newMetricTip').value = '';
        document.getElementById('newMetricName').focus();
    }
    
    // Helper function to switch back to manage mode
    function switchToManageMode() {
        document.getElementById('manageCategorySection').style.display = 'block';
        document.getElementById('createMetricSection').style.display = 'none';
        document.getElementById('tipsDisplayArea').style.display = 'none';
        document.getElementById('categoriesSelector').value = '';
    }
    
    // + New Metric button handler
    document.getElementById('newMetricBtn').addEventListener('click', switchToCreateMode);
    
    // Back button handler
    document.getElementById('backToManageBtn').addEventListener('click', switchToManageMode);
    
    // Create metric button handler
    document.getElementById('createMetricBtn').addEventListener('click', async () => {
        const nameInput = document.getElementById('newMetricName');
        const tipInput = document.getElementById('newMetricTip');
        const metricName = nameInput.value.trim();
        const initialTip = tipInput.value.trim();
        
        if (!metricName) {
            alert('⚠️ Please enter a metric name');
            return;
        }
        
        if (!initialTip) {
            alert('⚠️ Please enter at least one tip');
            return;
        }
        
        const metricKey = normalizeMetricKey(metricName);
        
        // Check for duplicates
        if (metricNames[metricKey]) {
            alert('⚠️ A metric with this name already exists');
            return;
        }
        
        // Save custom metric
        const updated = loadCustomMetrics();
        updated[metricKey] = metricName;
        saveCustomMetrics(updated);
        
        // Save initial tip as user tip
        const tips = loadUserTips();
        if (!tips[metricKey]) {
            tips[metricKey] = [];
        }
        tips[metricKey].push(initialTip);
        saveUserTips(tips);
        
        showToast('✅ Metric created successfully!');
        
        // Switch back to manage mode and re-render
        switchToManageMode();
        await renderTipsManagement();
    });
    
    // Add change listener for category selection
    document.getElementById('categoriesSelector').addEventListener('change', async (e) => {
        const metricKey = e.target.value;
        const displayArea = document.getElementById('tipsDisplayArea');
        
        if (!metricKey) {
            displayArea.style.display = 'none';
            return;
        }
        
        // Exit create mode if we were in it
        document.getElementById('manageCategorySection').style.display = 'block';
        document.getElementById('createMetricSection').style.display = 'none';
        
        displayArea.style.display = 'block';
        await loadServerTips();
        const currentUserTips = loadUserTips();
        const serverTipsWithIndex = (window._serverTipsWithIndex && window._serverTipsWithIndex[metricKey]) || [];
        const userTipsForMetric = currentUserTips[metricKey] || [];
        const metricName = metricNames[metricKey];
        
        let tipsHtml = `<div style="padding: 20px; background: #f8f9fa; border-radius: 8px;">`;
        tipsHtml += `<h3 style="color: #2196F3; margin-top: 0; border-bottom: 2px solid #2196F3; padding-bottom: 10px;">📂 ${metricName}</h3>`;
        tipsHtml += '<div style="margin: 20px 0;"><h4 style="color: #1976D2; margin-bottom: 12px;">📋 Tips</h4>';
        
        // Server tips - use original indices
        if (serverTipsWithIndex.length > 0) {
            serverTipsWithIndex.forEach((tipObj) => {
                // Safety check for tipObj structure
                if (!tipObj || typeof tipObj.originalIndex === 'undefined') {
                    
                    return;
                }
                const tip = tipObj.tip;
                const originalIndex = tipObj.originalIndex;
                tipsHtml += `
                    <div style="margin-bottom: 12px; padding: 15px; background: #e3f2fd; border-left: 4px solid #2196F3; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <div style="display: flex; justify-content: space-between; align-items: start; gap: 15px;">
                            <textarea id="editServerTip_${metricKey}_${originalIndex}" style="flex: 1; padding: 8px; border: 1px solid #1976D2; border-radius: 4px; font-size: 0.95em; resize: vertical; min-height: 60px; background: white;" rows="2">${escapeHtml(tip)}</textarea>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <button class="updateServerTipBtn" data-metric="${metricKey}" data-index="${originalIndex}" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; white-space: nowrap;">💾 Save</button>
                                <button class="deleteServerTipBtn" data-metric="${metricKey}" data-index="${originalIndex}" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; white-space: nowrap;">🗑️ Delete</button>
                            </div>
                        </div>
                    </div>
                `;
            });
        }
        
        // Custom tips
        if (userTipsForMetric.length > 0) {
            userTipsForMetric.forEach((tip, index) => {
                tipsHtml += `
                    <div style="margin-bottom: 12px; padding: 15px; background: white; border-left: 4px solid #28a745; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <div style="display: flex; justify-content: space-between; align-items: start; gap: 15px;">
                            <textarea id="editTip_${metricKey}_${index}" style="flex: 1; padding: 8px; border: 1px solid #28a745; border-radius: 4px; font-size: 0.95em; resize: vertical; min-height: 60px;" rows="2">${escapeHtml(tip)}</textarea>
                            <div style="display: flex; flex-direction: column; gap: 8px;">
                                <button class="updateTipBtn" data-metric="${metricKey}" data-index="${index}" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; white-space: nowrap;">💾 Save</button>
                                <button class="deleteTipBtn" data-metric="${metricKey}" data-index="${index}" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; white-space: nowrap;">🗑️ Delete</button>
                            </div>
                        </div>
                    </div>
                `;
            });
        }
        
        if (serverTipsWithIndex.length === 0 && userTipsForMetric.length === 0) {
            tipsHtml += '<div style="margin: 20px 0; padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;"><em>No tips found for this metric</em></div>';
        }

        tipsHtml += '</div>';

        // Add new tip
        tipsHtml += `
            <div style="margin-top: 15px; padding: 15px; background: white; border-radius: 8px; border: 2px dashed #28a745;">
                <textarea id="newTip_${metricKey}" placeholder="Enter a new custom coaching tip for ${metricName}..." style="width: 100%; padding: 12px; border: 2px solid #28a745; border-radius: 4px; font-size: 0.95em; resize: vertical; margin-bottom: 10px;" rows="3"></textarea>
                <button class="addTipBtn" data-metric="${metricKey}" style="background: #28a745; color: white; border: none; border-radius: 4px; padding: 10px 20px; cursor: pointer; font-size: 1em; font-weight: bold;">➕ Add Tip</button>
            </div>
        `;
        tipsHtml += '</div>';
        displayArea.innerHTML = tipsHtml;
        
        // Event delegation is bound once below (outside category-change handler)
    });

    // Add event delegation for tip management buttons (bind once)
    if (!displayArea.dataset.bound) {
        displayArea.addEventListener('click', (e) => {
            const actionButton = e.target.closest('button');
            if (!actionButton) return;

            if (actionButton.classList.contains('updateServerTipBtn')) {
                const metric = actionButton.dataset.metric;
                const index = parseInt(actionButton.dataset.index, 10);
                updateServerTip(metric, index);
            } else if (actionButton.classList.contains('deleteServerTipBtn')) {
                const metric = actionButton.dataset.metric;
                const index = parseInt(actionButton.dataset.index, 10);
                deleteServerTip(metric, index);
            } else if (actionButton.classList.contains('updateTipBtn')) {
                const metric = actionButton.dataset.metric;
                const index = parseInt(actionButton.dataset.index, 10);
                updateTip(metric, index);
            } else if (actionButton.classList.contains('deleteTipBtn')) {
                const metric = actionButton.dataset.metric;
                const index = parseInt(actionButton.dataset.index, 10);
                deleteTip(metric, index);
            } else if (actionButton.classList.contains('addTipBtn')) {
                const metric = actionButton.dataset.metric;
                addTip(metric);
            }
        });
        displayArea.dataset.bound = 'true';
    }
}

async function rerenderTipsManagementAndRestoreSelection(metricKey) {
    await renderTipsManagement();
    const selector = document.getElementById('categoriesSelector');
    if (selector && metricKey) {
        selector.value = metricKey;
        selector.dispatchEvent(new Event('change'));
    }
}

window.addTip = async function(metricKey) {
    const textarea = document.getElementById(`newTip_${metricKey}`);
    if (!textarea) {
        console.error('Textarea not found for add operation');
        return;
    }
    
    const tip = textarea.value.trim();
    
    if (!tip) {
        alert('⚠️ Please enter a tip first');
        return;
    }
    
    const userTips = loadUserTips();
    if (!userTips[metricKey]) {
        userTips[metricKey] = [];
    }
    
    // Ensure it's an array before pushing
    if (!Array.isArray(userTips[metricKey])) {
        console.error('userTips[metricKey] is not an array, resetting');
        userTips[metricKey] = [];
    }
    
    userTips[metricKey].push(tip);
    saveUserTips(userTips);
    
    textarea.value = '';
    showToast('✅ Tip added successfully!');

    await rerenderTipsManagementAndRestoreSelection(metricKey);
};

window.updateTip = async function(metricKey, index) {
    const textarea = document.getElementById(`editTip_${metricKey}_${index}`);
    if (!textarea) {
        console.error('Textarea not found for edit operation');
        return;
    }
    
    const updatedTip = textarea.value.trim();
    
    if (!updatedTip) {
        alert('⚠️ Tip cannot be empty');
        return;
    }
    
    const userTips = loadUserTips();
    if (userTips[metricKey] && userTips[metricKey][index] !== undefined) {
        userTips[metricKey][index] = updatedTip;
        saveUserTips(userTips);
        
        showToast('✅ Tip updated successfully!');

        await rerenderTipsManagementAndRestoreSelection(metricKey);
    } else {
        
        showToast('⚠️ Could not update tip - please refresh the page');
    }
};

window.updateServerTip = async function(metricKey, index) {
    const textarea = document.getElementById(`editServerTip_${metricKey}_${index}`);
    if (!textarea) {
        console.error('Textarea not found for server tip edit operation');
        showToast('⚠️ Could not update tip - please refresh the page');
        return;
    }
    
    const updatedTip = textarea.value.trim();
    
    if (!updatedTip) {
        alert('⚠️ Tip cannot be empty');
        return;
    }
    
    // Validate index is a valid number
    if (typeof index !== 'number' && isNaN(parseInt(index))) {
        console.error('Invalid index for server tip update:', index);
        showToast('⚠️ Could not update tip - invalid index');
        return;
    }
    
    // Load modified server tips (stored separately)
    let modifiedServerTips = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'modifiedServerTips') || '{}');
    
    if (!modifiedServerTips[metricKey]) {
        modifiedServerTips[metricKey] = {};
    }
    
    modifiedServerTips[metricKey][index] = updatedTip;
    localStorage.setItem(STORAGE_PREFIX + 'modifiedServerTips', JSON.stringify(modifiedServerTips));
    
    showToast('✅ Server tip updated!');

    await rerenderTipsManagementAndRestoreSelection(metricKey);
};

window.deleteServerTip = async function(metricKey, index) {
    if (!confirm('Are you sure you want to delete this server tip? This will hide it from the list.')) {
        return;
    }
    
    // Load deleted server tips list
    let deletedServerTips = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'deletedServerTips') || '{}');
    
    if (!deletedServerTips[metricKey]) {
        deletedServerTips[metricKey] = [];
    }
    
    // Mark this index as deleted
    if (!deletedServerTips[metricKey].includes(index)) {
        deletedServerTips[metricKey].push(index);
    }
    
    localStorage.setItem(STORAGE_PREFIX + 'deletedServerTips', JSON.stringify(deletedServerTips));
    
    showToast('\u{1F5D1}\u{FE0F} Server tip deleted');

    await rerenderTipsManagementAndRestoreSelection(metricKey);
};

window.deleteTip = async function(metricKey, index) {
    if (!confirm('Are you sure you want to delete this tip?')) {
        return;
    }
    
    const userTips = loadUserTips();
    if (userTips[metricKey] && Array.isArray(userTips[metricKey])) {
        // Validate index is within bounds
        if (index < 0 || index >= userTips[metricKey].length) {
            
            showToast('⚠️ Could not delete tip - please refresh the page');
            return;
        }
        
        userTips[metricKey].splice(index, 1);
        if (userTips[metricKey].length === 0) {
            delete userTips[metricKey];
        }
        saveUserTips(userTips);
        
        showToast('\u{1F5D1}\u{FE0F} Tip deleted');
    } else {
        
        showToast('⚠️ Could not delete tip - please refresh the page');
        return;
    }

    await rerenderTipsManagementAndRestoreSelection(metricKey);
};

*/

// ============================================
// METRIC TREND EMAIL GENERATOR
// ============================================

function initializeMetricTrends() {
    // Check if data exists for trend generation
    const allWeeks = Object.keys(weeklyData);
    const statusDiv = document.getElementById('metricTrendsStatus');
    
    if (allWeeks.length === 0) {
        // Show warning message
        if (statusDiv) statusDiv.style.display = 'block';
    } else {
        // Hide warning message
        if (statusDiv) statusDiv.style.display = 'none';
    }
    
    // Don't auto-set dates - let user select a period first
    const avgWeekMonday = document.getElementById('avgWeekMonday');
    const avgWeekSunday = document.getElementById('avgWeekSunday');
    
    // Auto-calculate Sunday when Monday changes (safe date parsing)
    avgWeekMonday?.addEventListener('change', (e) => {
        const dateStr = e.target.value;
        if (!dateStr || !avgWeekSunday) return;
        
        // Parse date safely to avoid timezone issues
        const [year, month, day] = dateStr.split('-').map(Number);
        const monday = new Date(year, month - 1, day);
        
        if (!isNaN(monday)) {
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            avgWeekSunday.value = sunday.toISOString().split('T')[0];
        }
    });
    
    // Toggle metrics form visibility
    const avgMetricsForm = document.getElementById('avgMetricsForm');
    const toggleAvgMetricsBtn = document.getElementById('toggleAvgMetricsBtn');
    
    // Ensure form starts collapsed
    if (avgMetricsForm) {
        avgMetricsForm.style.display = 'none';
    }
    if (toggleAvgMetricsBtn) {
        toggleAvgMetricsBtn.textContent = '✏️ Edit Averages';
        // Remove any existing click handlers to prevent duplicates
        const oldBtn = toggleAvgMetricsBtn.cloneNode(true);
        toggleAvgMetricsBtn.parentNode.replaceChild(oldBtn, toggleAvgMetricsBtn);
        oldBtn.addEventListener('click', () => {
            if (avgMetricsForm) {
                const isVisible = avgMetricsForm.style.display !== 'none';
                avgMetricsForm.style.display = isVisible ? 'none' : 'block';
                oldBtn.textContent = isVisible ? '✏️ Edit Averages' : '✏️ Hide Averages';
            }
        });
    }

    // Show target hints on Call Center Averages metric inputs
    renderCallCenterAverageTargets();
    

    
    // Populate uploaded data dropdown and set up listener
    populateUploadedDataDropdown();
    setupUploadedDataListener();
    
    // Populate trend generation dropdowns (starts with blank selections)
    populateTrendPeriodDropdown();
    initializeEmployeeDropdown();
    
    // Load existing averages when date/type changes
    setupAveragesLoader();
    
    // Set up event listeners
    setupMetricTrendsListeners();
}

function renderCallCenterAverageTargets() {
    const avgToMetricMap = {
        avgAdherence: 'scheduleAdherence',
        avgOverallExperience: 'overallExperience',
        avgRepSatisfaction: 'cxRepOverall',
        avgFCR: 'fcr',
        avgTransfers: 'transfers',
        avgSentiment: 'overallSentiment',
        avgPositiveWord: 'positiveWord',
        avgNegativeWord: 'negativeWord',
        avgManagingEmotions: 'managingEmotions',
        avgAHT: 'aht',
        avgACW: 'acw',
        avgHoldTime: 'holdTime',
        avgReliability: 'reliability'
    };

    const formatTargetLabel = (metricKey) => {
        const metric = METRICS_REGISTRY[metricKey];
        if (!metric || !metric.target) return null;

        const operator = metric.target.type === 'min' ? '≥' : '≤';
        const unit = metric.unit === 'sec'
            ? 's'
            : metric.unit === 'hrs'
                ? ' hrs'
                : (metric.unit || '');

        return `Target: ${operator}${metric.target.value}${unit}`;
    };

    const formatTargetSuffix = (metricKey) => {
        const metric = METRICS_REGISTRY[metricKey];
        if (!metric || !metric.target) return null;

        const operator = metric.target.type === 'min' ? '≥' : '≤';
        const unit = metric.unit === 'sec'
            ? 's'
            : metric.unit === 'hrs'
                ? ' hrs'
                : (metric.unit || '');

        return `(${operator}${metric.target.value}${unit})`;
    };

    Object.entries(avgToMetricMap).forEach(([inputId, metricKey]) => {
        const input = document.getElementById(inputId);
        if (!input || !input.parentElement) return;

        const hintId = `${inputId}TargetHint`;
        let hint = document.getElementById(hintId);
        const targetText = formatTargetLabel(metricKey);
        const targetSuffix = formatTargetSuffix(metricKey);
        const label = input.parentElement.querySelector('label');

        if (label && targetSuffix) {
            if (!label.dataset.baseLabel) {
                label.dataset.baseLabel = label.textContent.replace(/\s*\(.*\)\s*:\s*$/, '').trim();
            }
            label.textContent = `${label.dataset.baseLabel} ${targetSuffix}:`;
        }

        if (!targetText) return;

        if (!hint) {
            hint = document.createElement('div');
            hint.id = hintId;
            hint.style.fontSize = '0.8em';
            hint.style.color = '#666';
            hint.style.marginTop = '4px';
            input.insertAdjacentElement('afterend', hint);
        }

        hint.textContent = targetText;
    });
}

function populateTrendPeriodDropdown() {
    const trendPeriodSelect = document.getElementById('trendPeriodSelect');
    const selectedPeriodType = document.querySelector('input[name="trendPeriodType"]:checked')?.value || 'week';
    
    if (!trendPeriodSelect) {
        
        return;
    }
    
    
    const sourceData = selectedPeriodType === 'ytd' ? ytdData : weeklyData;
    const allWeeks = Object.keys(sourceData).sort().reverse(); // Most recent first
    
    if (allWeeks.length === 0) {
        trendPeriodSelect.innerHTML = '<option value="">No data available</option>';
        return;
    }
    
    // Filter by period type
    const filteredPeriods = allWeeks.filter(weekKey => {
        const week = sourceData[weekKey];
        const periodType = week.metadata?.periodType || 'week';
        return periodType === selectedPeriodType;
    });
    
    if (filteredPeriods.length === 0) {
        trendPeriodSelect.innerHTML = `<option value="">No ${selectedPeriodType} data available</option>`;
        return;
    }
    
    // Build options
    let options = '<option value="">Select Period...</option>';
    filteredPeriods.forEach(weekKey => {
        const week = sourceData[weekKey];
        const displayText = week.metadata?.label || weekKey;
        options += `<option value="${weekKey}">${displayText}</option>`;
    });
    
    trendPeriodSelect.innerHTML = options;
    
    // Add change listener to filter employees by selected period
    if (!trendPeriodSelect.dataset.bound) {
        trendPeriodSelect.addEventListener('change', (e) => {
            populateEmployeeDropdownForPeriod(e.target.value);
        });
        trendPeriodSelect.dataset.bound = 'true';
    }
    
    
}

function initializeEmployeeDropdown() {
    const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');
    if (trendEmployeeSelect) {
        trendEmployeeSelect.innerHTML = '<option value="">-- Choose an employee --</option>';
    }
}

function populateEmployeeDropdownForPeriod(weekKey) {
    const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');
    
    if (!trendEmployeeSelect) {
        return;
    }
    
    if (!weekKey) {
        // No period selected, show blank option only
        trendEmployeeSelect.innerHTML = '<option value="">-- Choose an employee --</option>';
        updateTrendButtonsVisibility();
        return;
    }
    
    // Get employees only for selected period
    const periodData = ytdData[weekKey] || weeklyData[weekKey];
    if (!periodData || !periodData.employees) {
        trendEmployeeSelect.innerHTML = '<option value="">No employees in this period</option>';
        updateTrendButtonsVisibility();
        return;
    }
    
    const teamFilterContext = getTeamSelectionContext();
    const employees = periodData.employees
        .filter(emp => isAssociateIncludedByTeamFilter(emp?.name, teamFilterContext))
        .map(emp => emp.name)
        .sort();
    
    // Build options
    let options = '<option value="">Select Employee...</option>';
    options += '<option value="ALL">All Associates</option>';
    employees.forEach(name => {
        options += `<option value="${name}">${name}</option>`;
    });
    
    trendEmployeeSelect.innerHTML = options;

    updateTrendButtonsVisibility();
}

function populateTrendSentimentDropdown(employeeName) {
    const sentimentDropdown = document.getElementById('trendSentimentSelect');
    
    if (!sentimentDropdown) return;
    
    // Reset to default
    sentimentDropdown.innerHTML = '<option value="">-- No sentiment data --</option>';
    
    // If no employee or "ALL" selected, just show default
    if (!employeeName || employeeName === 'ALL') {
        return;
    }
    
    // Get sentiment snapshots for this employee
    const snapshots = associateSentimentSnapshots[employeeName];
    
    if (!snapshots || !Array.isArray(snapshots) || snapshots.length === 0) {
        return;
    }
    
    // Get the currently selected period/week so we can pull percentages from that week
    const selectedWeekKey = document.getElementById('trendPeriodSelect')?.value;
    const selectedPeriodType = document.querySelector('input[name="trendPeriodType"]:checked')?.value || 'week';
    const sourceData = selectedPeriodType === 'ytd' ? ytdData : weeklyData;
    const selectedWeek = selectedWeekKey ? (sourceData[selectedWeekKey] || {}) : {};
    
    // Get the employee's data from the selected week
    let empDataInSelectedWeek = null;
    if (selectedWeek.employees) {
        empDataInSelectedWeek = selectedWeek.employees.find(e => e.name === employeeName);
    }
    
    // Sort by date (most recent first)
    const sortedSnapshots = [...snapshots].sort((a, b) => {
        const dateA = new Date(a.savedAt || a.timeframeEnd);
        const dateB = new Date(b.savedAt || b.timeframeEnd);
        return dateB - dateA;
    });
    
    // Build options
    sortedSnapshots.forEach((snapshot, index) => {
        const timeframe = `${snapshot.timeframeStart} to ${snapshot.timeframeEnd}`;
        
        // Use percentages from the selected week if available, otherwise 0
        const negScore = empDataInSelectedWeek?.negativeWord || 0;
        const posScore = empDataInSelectedWeek?.positiveWord || 0;
        const emoScore = empDataInSelectedWeek?.managingEmotions || 0;
        
        const label = `${timeframe} (${negScore}% avoiding negative, ${posScore}% using positive, ${emoScore}% managing emotions)`;
        const value = `${snapshot.timeframeStart}|${snapshot.timeframeEnd}`; // Use timeframe as value
        
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        sentimentDropdown.appendChild(option);
    });
}

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

function getAverageValueFromSource(source, key) {
    if (!source || typeof source !== 'object') return '';
    const direct = source[key];
    if (direct !== undefined && direct !== null) return direct;
    const nested = source.data ? source.data[key] : undefined;
    return nested !== undefined && nested !== null ? nested : '';
}

function applyAveragesToForm(source) {
    Object.entries(AVERAGE_FORM_FIELD_MAP).forEach(([avgKey, inputId]) => {
        const input = document.getElementById(inputId);
        if (!input) return;
        input.value = getAverageValueFromSource(source, avgKey);
    });
}

function getPreviousWeekKey(currentWeekKey) {
    const allKeys = Object.keys(weeklyData).sort();
    const currentIndex = allKeys.indexOf(currentWeekKey);
    if (currentIndex <= 0) return null;
    return allKeys[currentIndex - 1] || null;
}

function readAveragesFromForm() {
    const averageData = {};
    Object.entries(AVERAGE_FORM_FIELD_MAP).forEach(([avgKey, inputId]) => {
        const parsed = parseFloat(document.getElementById(inputId)?.value);
        averageData[avgKey] = Number.isFinite(parsed) ? parsed : 0;
    });
    return averageData;
}

function setupAveragesLoader() {
    const avgPeriodType = document.getElementById('avgPeriodType');
    const avgWeekMonday = document.getElementById('avgWeekMonday');
    
    if (!avgPeriodType || !avgWeekMonday) return;
    
    const loadAveragesForPeriod = () => {
        const periodType = avgPeriodType.value;
        const mondayDate = avgWeekMonday.value;
        
        if (!mondayDate) return;
        
        // Create storage key from period type and Monday date
        const storageKey = `${mondayDate}_${periodType}`;
        const averages = getCallCenterAverageForPeriod(storageKey);

        applyAveragesToForm(averages);
    };
    
    avgPeriodType.addEventListener('change', loadAveragesForPeriod);
    avgWeekMonday.addEventListener('change', loadAveragesForPeriod);
}

function populateUploadedDataDropdown() {

    const avgUploadedDataSelect = document.getElementById('avgUploadedDataSelect');
    const selectedPeriodType = document.querySelector('input[name="trendPeriodType"]:checked')?.value || 'week';
    
    if (!avgUploadedDataSelect) return;
    
    
    const sourceData = selectedPeriodType === 'ytd' ? ytdData : weeklyData;
    const allWeeks = Object.keys(sourceData).sort().reverse(); // Most recent first
    
    if (allWeeks.length === 0) {
        avgUploadedDataSelect.innerHTML = '<option value="">-- No uploaded data available --</option>';
        return;
    }
    
    // Filter by period type
    const filteredPeriods = allWeeks.filter(weekKey => {
        const week = sourceData[weekKey];
        const periodType = week.metadata?.periodType || 'week';
        return periodType === selectedPeriodType;
    });
    
    if (filteredPeriods.length === 0) {
        avgUploadedDataSelect.innerHTML = `<option value="">No ${selectedPeriodType} data available</option>`;
        return;
    }
    
    // Build options
    let options = '<option value="">-- Choose a period from your data --</option>';
    filteredPeriods.forEach(weekKey => {
        const week = sourceData[weekKey];
        const displayText = week.metadata?.label || week.week_start || weekKey;
        options += `<option value="${weekKey}">${displayText}</option>`;
    });
    
    avgUploadedDataSelect.innerHTML = options;
    
}

function setupUploadedDataListener() {
    const avgUploadedDataSelect = document.getElementById('avgUploadedDataSelect');
    avgUploadedDataSelect?.addEventListener('change', (e) => {
        const weekKey = e.target.value;
        displayCallCenterAverages(weekKey);
        
        // Auto-sync to Metric Trends section
        if (weekKey) {
            const trendPeriodSelect = document.getElementById('trendPeriodSelect');
            if (trendPeriodSelect) {
                trendPeriodSelect.value = weekKey;
                trendPeriodSelect.dispatchEvent(new Event('change'));
                
            }
        }
    });
}

function displayCallCenterAverages(weekKey) {
    const avgMetricsForm = document.getElementById('avgMetricsForm');
    const periodTypeField = document.getElementById('avgPeriodType');
    const mondayField = document.getElementById('avgWeekMonday');
    const sundayField = document.getElementById('avgWeekSunday');
    
    const periodData = weeklyData[weekKey] || ytdData[weekKey];
    if (!weekKey || !periodData) {
        // Keep form hidden when no period selected
        if (avgMetricsForm && avgMetricsForm.style.display !== 'none') {
            // Don't hide if it was already visible - user might have it open
        } else {
            if (avgMetricsForm) avgMetricsForm.style.display = 'none';
        }
        periodTypeField.value = '';
        mondayField.value = '';
        sundayField.value = '';
        return;
    }
    
    const week = periodData;
    const metadata = week.metadata || {};
    
    // Load period info into hidden fields (don't show toast)
    periodTypeField.value = metadata.periodType || 'week';
    mondayField.value = metadata.startDate || '';
    sundayField.value = metadata.endDate || '';
    
    // Get saved averages for this period
    const centerAvg = getCallCenterAverageForPeriod(weekKey);
    
    // Load the averages into the form (or clear if none)
    applyAveragesToForm(centerAvg);
    
    // Don't auto-expand the form - let user click "Edit Averages" button
    // Form expansion is controlled by toggleAvgMetricsBtn only
}

    // Save Call Center Averages button
    document.getElementById('saveAvgBtn')?.addEventListener('click', () => {
        const weekKey = document.getElementById('avgUploadedDataSelect')?.value;
        
        if (!weekKey) {
            alert('⚠️ Please select a period first');
            return;
        }
        
        const averageData = readAveragesFromForm();
        
        setCallCenterAverageForPeriod(weekKey, averageData);
        clearUnsavedChanges();
        showToast('✅ Call center averages saved!', 3000);
    });

    // Copy from Previous Week button
    document.getElementById('copyPreviousAvgBtn')?.addEventListener('click', () => {
        const currentWeekKey = document.getElementById('avgUploadedDataSelect')?.value;
        
        if (!currentWeekKey) {
            alert('⚠️ Please select a period first');
            return;
        }
        
        const previousWeekKey = getPreviousWeekKey(currentWeekKey);
        if (!previousWeekKey) {
            alert('ℹ️ No previous week found');
            return;
        }

        const previousAverages = getCallCenterAverageForPeriod(previousWeekKey);
        
        if (!previousAverages || Object.keys(previousAverages).length === 0) {
            alert('ℹ️ No averages found for previous week');
            return;
        }
        
        // Copy all values
        applyAveragesToForm(previousAverages);
        
        markUnsavedChanges();
        showToast('✅ Copied from previous week! Click Save to apply.', 4000);
    });

function updateTrendButtonsVisibility() {
    const employeeDropdown = document.getElementById('trendEmployeeSelect');
    const generateTrendBtn = document.getElementById('generateTrendBtn');
    const generateAllTrendBtn = document.getElementById('generateAllTrendBtn');
    const generateTeamTrendBtn = document.getElementById('generateTeamTrendBtn');
    const selectedValue = employeeDropdown?.value || '';

    applyTrendButtonVisibility(selectedValue, generateTrendBtn, generateAllTrendBtn, generateTeamTrendBtn);
}

function applyTrendButtonVisibility(selectedValue, generateTrendBtn, generateAllTrendBtn, generateTeamTrendBtn) {
    if (selectedValue === '') {
        if (generateTrendBtn) generateTrendBtn.style.display = 'none';
        if (generateAllTrendBtn) generateAllTrendBtn.style.display = 'none';
        if (generateTeamTrendBtn) generateTeamTrendBtn.style.display = 'none';
    } else if (selectedValue === 'ALL') {
        if (generateTrendBtn) generateTrendBtn.style.display = 'none';
        if (generateAllTrendBtn) generateAllTrendBtn.style.display = 'block';
        if (generateTeamTrendBtn) generateTeamTrendBtn.style.display = 'block';
    } else {
        if (generateTrendBtn) generateTrendBtn.style.display = 'block';
        if (generateAllTrendBtn) generateAllTrendBtn.style.display = 'none';
        if (generateTeamTrendBtn) generateTeamTrendBtn.style.display = 'none';
    }
}

function setupMetricTrendsListeners() {
    // Add event listeners to period type radio buttons
    const periodTypeRadios = document.querySelectorAll('input[name="trendPeriodType"]');
    periodTypeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            const selectedType = radio.value;
            
            // Update both dropdowns
            populateUploadedDataDropdown(); // Call Center Average dropdown
            populateTrendPeriodDropdown(); // Metric Trends dropdown
            
            // Clear employee selection
            document.getElementById('trendEmployeeSelect').innerHTML = '<option value="">-- Choose an employee --</option>';
            updateTrendButtonsVisibility();
        });
    });
    
    // Add listener to employee dropdown to show metrics preview
    const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');
    if (trendEmployeeSelect) {
        trendEmployeeSelect.addEventListener('change', (e) => {
            const employeeName = e.target.value;
            const weekKey = document.getElementById('trendPeriodSelect')?.value;
            const nicknameInput = document.getElementById('trendNickname');
            
            // Populate sentiment dropdown for selected employee
            populateTrendSentimentDropdown(employeeName);
            
            if (nicknameInput) {
                if (!employeeName || employeeName === 'ALL') {
                    nicknameInput.value = '';
                    nicknameInput.placeholder = 'How to address them in the email (e.g., "John")';
                } else {
                    const savedNickname = getSavedNickname(employeeName);
                    const defaultNickname = getEmployeeNickname(employeeName) || '';
                    nicknameInput.value = savedNickname || defaultNickname || '';
                    nicknameInput.placeholder = 'How to address them in the email';
                }
            }
            
            if (employeeName === 'ALL') {
                document.getElementById('metricsPreviewSection').style.display = 'none';
                updateTrendButtonsVisibility();
                return;
            }
            
            if (employeeName && weekKey) {
                displayMetricsPreview(employeeName, weekKey);
            } else {
                document.getElementById('metricsPreviewSection').style.display = 'none';
            }

            updateTrendButtonsVisibility();
        });
    }
    
    // Generate trend email buttons
    const generateTrendBtn = document.getElementById('generateTrendBtn');
    const generateAllTrendBtn = document.getElementById('generateAllTrendBtn');
    const generateTeamTrendBtn = document.getElementById('generateTeamTrendBtn');
    const saveMetricsPreviewBtn = document.getElementById('saveMetricsPreviewBtn');
    
    if (!generateTrendBtn) {
        console.error('generateTrendBtn element not found!');
    } else {
        generateTrendBtn.addEventListener('click', generateTrendEmail);
    }

    if (!generateAllTrendBtn) {
        console.error('generateAllTrendBtn element not found!');
    } else {
        generateAllTrendBtn.addEventListener('click', generateAllTrendEmails);
    }

    if (!generateTeamTrendBtn) {
        console.error('generateTeamTrendBtn element not found!');
    } else {
        generateTeamTrendBtn.addEventListener('click', generateTeamTrendSummary);
    }
    
    if (saveMetricsPreviewBtn) {
        saveMetricsPreviewBtn.addEventListener('click', saveMetricsPreviewEdits);
    }
    
    // Ensure buttons are correctly shown on initial load
    updateTrendButtonsVisibility();
    
}

function displayMetricsPreview(employeeName, weekKey) {
    const metricsPreviewSection = document.getElementById('metricsPreviewSection');
    const metricsPreviewGrid = document.getElementById('metricsPreviewGrid');
    const metricsPreviewSurveyCount = document.getElementById('metricsPreviewSurveyCount');
    
    if (!metricsPreviewSection || !metricsPreviewGrid) return;
    
    const periodData = ytdData[weekKey] || weeklyData[weekKey];
    if (!periodData || !periodData.employees) return;
    
    const employee = periodData.employees.find(emp => emp.name === employeeName);
    if (!employee) return;
    
    metricsPreviewSection.dataset.employee = employeeName;
    metricsPreviewSection.dataset.period = weekKey;

    const surveyTotal = Number.isFinite(parseInt(employee.surveyTotal, 10)) ? parseInt(employee.surveyTotal, 10) : 0;
    const periodType = String(periodData?.metadata?.periodType || 'period').toLowerCase();
    const periodTypeLabel = periodType === 'week' ? 'week' : periodType === 'month' ? 'month' : periodType === 'quarter' ? 'quarter' : periodType === 'ytd' ? 'YTD period' : 'period';
    const periodLabel = String(periodData?.metadata?.label || weekKey || '').trim();
    if (metricsPreviewSurveyCount) {
        metricsPreviewSurveyCount.textContent = `Surveys in loaded ${periodTypeLabel}: ${surveyTotal}${periodLabel ? ` • ${periodLabel}` : ''}`;
    }
    

    
    // Define metrics to show
    const metricsToPreview = [
        { key: 'scheduleAdherence', label: 'Schedule Adherence', unit: '%' },
        { key: 'overallExperience', label: 'Overall Experience', unit: '%' },
        { key: 'cxRepOverall', label: 'Rep Satisfaction', unit: '%' },
        { key: 'fcr', label: 'FCR', unit: '%' },
        { key: 'transfers', label: 'Transfers', unit: '%' },
        { key: 'overallSentiment', label: 'Sentiment Score', unit: '%' },
        { key: 'positiveWord', label: 'Positive Word Usage', unit: '%' },
        { key: 'negativeWord', label: 'Avoiding Negative Words', unit: '%' },
        { key: 'managingEmotions', label: 'Managing Emotions', unit: '%' },
        { key: 'aht', label: 'Average Handle Time', unit: 's' },
        { key: 'acw', label: 'After Call Work', unit: 's' },
        { key: 'holdTime', label: 'Hold Time', unit: 's' },
        { key: 'reliability', label: 'Reliability', unit: 'hrs' }
    ];
    
    // Generate HTML for each metric with target values like call center averages
    let html = '';
    metricsToPreview.forEach(metric => {
        const rawValue = employee[metric.key] !== undefined ? employee[metric.key] : '';
        const registryMetric = METRICS_REGISTRY[metric.key];
        const target = registryMetric?.target?.value;
        const targetType = registryMetric?.target?.type;
        const isWholeNumberMetric = metric.key === 'aht' || metric.key === 'acw' || metric.key === 'holdTime';
        const isTenthsMetric = !isWholeNumberMetric;

        let value = rawValue;
        if (isWholeNumberMetric && rawValue !== '' && rawValue !== null && rawValue !== undefined) {
            const numericValue = parseFloat(rawValue);
            value = Number.isFinite(numericValue) ? Math.round(numericValue) : rawValue;
        } else if (isTenthsMetric && rawValue !== '' && rawValue !== null && rawValue !== undefined) {
            const numericValue = parseFloat(rawValue);
            value = Number.isFinite(numericValue) ? numericValue.toFixed(1) : rawValue;
        }
        
        // Build target hint like call center averages do
        let targetHint = '';
        if (target !== undefined && targetType) {
            const targetSymbol = targetType === 'min' ? '≥' : '≤';
            targetHint = ` (Target: ${targetSymbol} ${target}${metric.unit})`;
            if (metric.key === 'overallSentiment') {
                targetHint = ' (Target 88%)';
            }
        }
        
        html += `
            <div>
                <label style="font-weight: bold; display: block; margin-bottom: 3px; font-size: 0.85em;">${metric.label} (${metric.unit})${targetHint}:</label>
                <input type="number" class="metric-preview-input" data-metric="${metric.key}" step="${isWholeNumberMetric ? '1' : '0.1'}" value="${value}" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px;">
            </div>
        `;
    });
    
    metricsPreviewGrid.innerHTML = html;
    metricsPreviewSection.style.display = 'block';
}

function saveMetricsPreviewEdits() {
    const metricsPreviewSection = document.getElementById('metricsPreviewSection');
    if (!metricsPreviewSection) return;
    
    const employeeName = metricsPreviewSection.dataset.employee || document.getElementById('trendEmployeeSelect')?.value;
    const weekKey = metricsPreviewSection.dataset.period || document.getElementById('trendPeriodSelect')?.value;
    
    if (!employeeName || !weekKey) {
        showToast('Please select both period and employee', 4000);
        return;
    }
    
    const periodData = ytdData[weekKey] || weeklyData[weekKey];
    if (!periodData || !periodData.employees) {
        showToast('No data found for selected period', 4000);
        return;
    }
    
    const employee = periodData.employees.find(emp => emp.name === employeeName);
    if (!employee) {
        showToast('Employee not found for selected period', 4000);
        return;
    }
    
    const inputs = metricsPreviewSection.querySelectorAll('.metric-preview-input');
    let updatedCount = 0;
    inputs.forEach(input => {
        const metricKey = input.dataset.metric;
        if (!metricKey) return;
        const rawValue = input.value.trim();
        if (rawValue === '') return;
        const parsed = parseFloat(rawValue);
        if (Number.isNaN(parsed)) return;
        employee[metricKey] = parsed;
        updatedCount += 1;
    });
    
    if (ytdData[weekKey]) {
        saveYtdData();
    } else {
        saveWeeklyData();
    }
    
    showToast(updatedCount > 0 ? '✅ Metrics saved' : 'No changes to save', 3000);
}

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
function getMetricBandByUnit(metricKey, bands = { percent: 2, sec: 15, hrs: 1, fallback: 2 }) {
    const unit = METRICS_REGISTRY[metricKey]?.unit;
    if (unit === 'sec') return bands.sec;
    if (unit === 'hrs') return bands.hrs;
    if (unit === '%') return bands.percent;
    return bands.fallback;
}

function resolveMetricTrendDirection(metricKey, currentValue, previousValue) {
    const prev = parseFloat(previousValue);
    if (!Number.isFinite(prev)) {
        return {
            delta: null,
            direction: 'stable'
        };
    }

    const delta = metricDelta(metricKey, currentValue, prev);
    const stableBand = getMetricBandByUnit(metricKey, { percent: 1, sec: 8, hrs: 0.5, fallback: 1 });
    if (Math.abs(delta) < stableBand) {
        return {
            delta,
            direction: 'stable'
        };
    }

    return {
        delta,
        direction: delta > 0 ? 'improving' : 'declining'
    };
}

function getMetricVolatilityDetails(employeeName, metricKey, weekKey, periodType = 'week') {
    if (!employeeName || !weekKey) return null;

    const keys = getWeeklyKeysSorted().filter(key => {
        const metaType = weeklyData[key]?.metadata?.periodType || 'week';
        return metaType === periodType;
    });
    const idx = keys.indexOf(weekKey);
    if (idx < 0) return null;

    const sampleKeys = keys.slice(Math.max(0, idx - 3), idx + 1);
    const values = sampleKeys
        .map(key => {
            const period = weeklyData[key];
            const emp = period?.employees?.find(e => e.name === employeeName);
            const value = parseFloat(emp?.[metricKey]);
            return Number.isFinite(value) ? value : null;
        })
        .filter(v => v !== null);

    if (values.length < 3) return null;

    const deltas = [];
    for (let i = 1; i < values.length; i++) {
        deltas.push(metricDelta(metricKey, values[i], values[i - 1]));
    }

    if (!deltas.length) return null;

    const avgSwing = deltas.reduce((sum, d) => sum + Math.abs(d), 0) / deltas.length;
    const directionBand = getMetricBandByUnit(metricKey, { percent: 1, sec: 8, hrs: 0.5, fallback: 1 });
    let signChanges = 0;
    let lastSign = 0;

    deltas.forEach(delta => {
        if (Math.abs(delta) < directionBand) return;
        const sign = delta > 0 ? 1 : -1;
        if (lastSign !== 0 && sign !== lastSign) signChanges += 1;
        lastSign = sign;
    });

    const volatilityBand = getMetricBandByUnit(metricKey, { percent: 2.5, sec: 18, hrs: 1.1, fallback: 2.5 });
    const isVolatile = avgSwing >= volatilityBand || signChanges >= 2;

    return {
        isVolatile,
        avgSwing,
        signChanges,
        sampleSize: values.length
    };
}

function classifyTrendMetric(metric) {
    const margin = metric.targetType === 'min'
        ? metric.employeeValue - metric.target
        : metric.target - metric.employeeValue;
    const nearBand = getMetricBandByUnit(metric.metricKey, { percent: 2, sec: 20, hrs: 1, fallback: 2 });
    const exceedBand = getMetricBandByUnit(metric.metricKey, { percent: 4, sec: 35, hrs: 2, fallback: 4 });
    const watchDropBand = getMetricBandByUnit(metric.metricKey, { percent: 2, sec: 15, hrs: 1, fallback: 2 });

    if (metric.meetsTarget) {
        if (metric.trendDirection === 'declining' && (margin <= nearBand || Math.abs(metric.trendDelta || 0) >= watchDropBand)) {
            return 'Watch Area';
        }
        if (margin >= exceedBand || metric.trendDirection === 'improving') {
            return 'Exceeding Expectation';
        }
        return 'On Track';
    }

    if (metric.trendDirection === 'improving' && metric.gapFromTarget <= nearBand) {
        return 'Watch Area';
    }

    return 'Needs Focus';
}

function analyzeTrendMetrics(employeeData, centerAverages, reviewYear = null, previousEmployeeData = null, context = {}) {
    const allMetrics = [];
    const employeeName = context.employeeName || employeeData?.name;
    const weekKey = context.weekKey || null;
    const periodType = context.periodType || 'week';

    Object.entries(TREND_METRIC_MAPPINGS).forEach(([registryKey, csvKey]) => {
        const employeeValue = parseFloat(employeeData[registryKey]) || 0;
        const centerValue = parseFloat(centerAverages[csvKey]) || 0;
        const metric = METRICS_REGISTRY[registryKey];
        if (!metric || employeeValue === 0) return;

        const target = getMetricTrendTarget(registryKey);
        const targetType = getMetricTrendTargetType(registryKey);
        const isReverse = isReverseMetric(registryKey);
        const meetsTarget = targetType === 'min'
            ? employeeValue >= target
            : employeeValue <= target;
        const isBelowCenter = centerValue > 0
            ? (isReverse ? employeeValue > centerValue : employeeValue < centerValue)
            : false;

        const previousValueRaw = previousEmployeeData ? parseFloat(previousEmployeeData[registryKey]) : NaN;
        const previousValue = Number.isFinite(previousValueRaw) ? previousValueRaw : null;
        const trendState = resolveMetricTrendDirection(registryKey, employeeValue, previousValue);
        const volatility = getMetricVolatilityDetails(employeeName, registryKey, weekKey, periodType);

        const metricRecord = {
            metricKey: registryKey,
            label: metric.label,
            employeeValue,
            centerValue,
            target,
            targetType,
            meetsTarget,
            isReverse,
            isBelowCenter,
            gap: Math.abs(employeeValue - centerValue),
            gapFromTarget: targetType === 'min'
                ? Math.max(0, target - employeeValue)
                : Math.max(0, employeeValue - target),
            previousValue,
            trendDelta: trendState.delta,
            trendDirection: trendState.direction,
            isVolatile: Boolean(volatility?.isVolatile),
            volatilityDetails: volatility,
            classification: 'On Track'
        };

        metricRecord.classification = classifyTrendMetric(metricRecord);
        allMetrics.push(metricRecord);
    });

    const weakest = allMetrics.length > 0
        ? [...allMetrics].sort((a, b) => {
            const riskA = (a.gapFromTarget || 0) + (a.trendDirection === 'declining' ? getMetricBandByUnit(a.metricKey, { percent: 2, sec: 15, hrs: 1, fallback: 2 }) : 0);
            const riskB = (b.gapFromTarget || 0) + (b.trendDirection === 'declining' ? getMetricBandByUnit(b.metricKey, { percent: 2, sec: 15, hrs: 1, fallback: 2 }) : 0);
            return riskB - riskA;
        })[0]
        : null;

    const decliningCandidates = allMetrics
        .filter(m => m.metricKey !== weakest?.metricKey)
        .filter(m => m.trendDirection === 'declining' || m.classification === 'Watch Area' || m.classification === 'Needs Focus')
        .sort((a, b) => {
            const riskA = (a.gapFromTarget || 0) + Math.abs(a.trendDelta || 0);
            const riskB = (b.gapFromTarget || 0) + Math.abs(b.trendDelta || 0);
            return riskB - riskA;
        });

    const trendingDown = decliningCandidates.length > 0 ? decliningCandidates[0] : null;

    return {
        weakest,
        trendingDown,
        allMetrics
    };
}

function getShuffledCopy(items) {
    const shuffled = Array.isArray(items) ? [...items] : [];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function pickRandomItem(items) {
    const shuffled = getShuffledCopy(items);
    return shuffled.length > 0 ? shuffled[0] : null;
}

function pickRandomItems(items, count = 1) {
    return getShuffledCopy(items).slice(0, count);
}

function getRandomTipsForMetric(metricKey, count = 2) {
    /**
     * Get random tips for a specific metric
     * Handles both server-side hints and user tips
     */
    // Use the getMetricTips function from tips-module.js if available
    if (typeof getMetricTips === 'function') {
        const allTips = getMetricTips(metricKey);
        if (!allTips || allTips.length === 0) {
            return [];
        }

        return pickRandomItems(allTips, count);
    }
    
    return [];
}

function getTrendTipsForMetrics(weakestMetric, trendingMetric) {
    return {
        tipsForWeakest: weakestMetric ? getRandomTipsForMetric(weakestMetric.metricKey, 2) : [],
        tipsForTrending: trendingMetric ? getRandomTipsForMetric(trendingMetric.metricKey, 2) : []
    };
}

function getSelectedTrendSentimentSnapshot(employeeName) {
    const sentimentSelect = document.getElementById('trendSentimentSelect');
    const selectedSentiment = sentimentSelect?.value;
    if (!selectedSentiment) return null;

    const [startDate, endDate] = selectedSentiment.split('|');
    const snapshots = associateSentimentSnapshots[employeeName];
    if (!Array.isArray(snapshots)) return null;

    const matchingSnapshot = snapshots.find(s => s.timeframeStart === startDate && s.timeframeEnd === endDate) || null;
    if (matchingSnapshot) {
        console.log('📊 Using selected sentiment snapshot:', matchingSnapshot);
    }
    return matchingSnapshot;
}

function resolveTrendEmailContext(employeeName, weekKey) {
    const period = weeklyData[weekKey];
    if (!period) {
        if (ytdData[weekKey]) {
            showToast('YTD period selected. Please select a weekly period for Metric Trends.', 5000);
        } else {
            showToast('No data found for this period', 5000);
        }
        return null;
    }

    const employee = period.employees.find(e => e.name === employeeName);
    if (!employee) {
        showToast('Employee not found in selected period', 5000);
        return null;
    }

    const currentPeriodType = period.metadata?.periodType || 'week';
    const prevPeriodKey = getPreviousPeriodData(weekKey, currentPeriodType);
    const prevPeriod = prevPeriodKey ? weeklyData[prevPeriodKey] : null;
    const prevEmployee = prevPeriod?.employees.find(e => e.name === employeeName);

    return {
        period,
        periodMeta: period.metadata || {},
        employee,
        prevEmployee
    };
}

function handleTrendEmailImageReady(
    employeeName,
    displayName,
    weakestMetric,
    trendingMetric,
    tipsForWeakest,
    tipsForTrending,
    weekKey,
    periodMeta,
    sentimentSnapshot,
    allMetrics
) {
    const emailSubject = buildTrendEmailSubject(periodMeta, displayName);

    if (DEBUG) {
        console.log('Opening Outlook with subject:', emailSubject);
    }

    openTrendEmailOutlook(emailSubject);
    showToast('📧 Outlook opening... Image is copied to clipboard. Paste into email body, then use the prompt below for coaching text.', 4000);

    if (weakestMetric || trendingMetric) {
        showTrendsWithTipsPanel(
            employeeName,
            displayName,
            weakestMetric,
            trendingMetric,
            tipsForWeakest,
            tipsForTrending,
            weekKey,
            periodMeta,
            emailSubject,
            sentimentSnapshot,
            allMetrics
        );
    }
}

function getReviewYearFromEndDate(endDate) {
    return parseInt(String(endDate || '').split('-')[0], 10) || null;
}

function buildTrendEmailAnalysisBundle(employee, weekKey, period) {
    const centerAverages = getCallCenterAverageForPeriod(weekKey) || {};
    const reviewYear = getReviewYearFromEndDate(period?.metadata?.endDate);
    const prevPeriodKey = getPreviousPeriodData(weekKey, period?.metadata?.periodType || 'week');
    const prevPeriod = prevPeriodKey ? weeklyData[prevPeriodKey] : null;
    const previousEmployee = prevPeriod?.employees?.find(e => e.name === employee?.name) || null;
    const trendAnalysis = analyzeTrendMetrics(employee, centerAverages, reviewYear, previousEmployee, {
        employeeName: employee?.name,
        weekKey,
        periodType: period?.metadata?.periodType || 'week'
    });
    const weakestMetric = trendAnalysis.weakest;
    const trendingMetric = trendAnalysis.trendingDown;
    const allMetrics = trendAnalysis.allMetrics || [];
    const { tipsForWeakest, tipsForTrending } = getTrendTipsForMetrics(weakestMetric, trendingMetric);

    return {
        weakestMetric,
        trendingMetric,
        allMetrics,
        tipsForWeakest,
        tipsForTrending
    };
}

function getTrendEmailSelection() {
    const employeeName = document.getElementById('trendEmployeeSelect')?.value;
    const weekKey = document.getElementById('trendPeriodSelect')?.value;
    const nickname = document.getElementById('trendNickname')?.value.trim();

    if (!employeeName || !weekKey) {
        console.error('Missing selection - Employee:', employeeName, 'Week:', weekKey);
        showToast('Please select both employee and period', 5000);
        return null;
    }

    return { employeeName, weekKey, nickname };
}

function getTrendEmailDisplayName(employeeName, nickname) {
    if (employeeName && nickname) {
        saveNickname(employeeName, nickname);
    }
    return nickname || employeeName;
}

function generateTrendEmail() {
    const selection = getTrendEmailSelection();
    if (!selection) return;
    const { employeeName, weekKey, nickname } = selection;

    const trendContext = resolveTrendEmailContext(employeeName, weekKey);
    if (!trendContext) return;
    const { period, periodMeta, employee, prevEmployee } = trendContext;

    const displayName = getTrendEmailDisplayName(employeeName, nickname);
    showToast('ℹ️ Creating email image...', 3000);

    const {
        weakestMetric,
        trendingMetric,
        allMetrics,
        tipsForWeakest,
        tipsForTrending
    } = buildTrendEmailAnalysisBundle(employee, weekKey, period);
    const sentimentSnapshot = getSelectedTrendSentimentSnapshot(employeeName);

    createTrendEmailImage(displayName, weekKey, period, employee, prevEmployee, () => {
        handleTrendEmailImageReady(
            employeeName,
            displayName,
            weakestMetric,
            trendingMetric,
            tipsForWeakest,
            tipsForTrending,
            weekKey,
            periodMeta,
            sentimentSnapshot,
            allMetrics
        );
    });
}

function openTrendEmailOutlook(emailSubject) {
    /**
     * Open Outlook/mail client with trend email
     */
    try {
        const mailtoLink = document.createElement('a');
        mailtoLink.href = `mailto:?subject=${encodeURIComponent(emailSubject)}`;
        document.body.appendChild(mailtoLink);
        mailtoLink.click();
        document.body.removeChild(mailtoLink);
        console.log('Mailto link clicked');
    } catch(e) {
        console.error('Error opening mailto:', e);
    }
}

function getTrendPeriodDisplay(periodType = 'week') {
    const normalized = String(periodType || 'week').toLowerCase();
    const periodTypeText = normalized === 'month' ? 'month' : normalized === 'quarter' ? 'quarter' : normalized === 'ytd' ? 'ytd' : 'week';
    const periodTypeTitle = normalized === 'month' ? 'Monthly' : normalized === 'quarter' ? 'Quarterly' : normalized === 'ytd' ? 'YTD' : 'Weekly';
    const periodLabel = normalized === 'month' ? 'Month' : normalized === 'quarter' ? 'Quarter' : normalized === 'ytd' ? 'YTD' : 'Week';
    return { periodTypeText, periodTypeTitle, periodLabel };
}

function buildTrendEmailSubject(periodMeta, displayName) {
    const { periodTypeTitle, periodLabel } = getTrendPeriodDisplay(periodMeta?.periodType);
    const endDate = periodMeta?.endDate || 'unknown';
    return `Trending Metrics - ${periodTypeTitle} - ${periodLabel} ending ${endDate} for ${displayName}`;
}

function buildTrendFocusAreas(weakestMetric, tipsForWeakest, trendingMetric, tipsForTrending, allMetrics) {
    const belowTargetMetrics = Array.isArray(allMetrics)
        ? allMetrics
            .filter(metric => metric && !metric.meetsTarget)
            .sort((a, b) => (b.gapFromTarget || 0) - (a.gapFromTarget || 0))
        : [];

    const focusCandidates = [];
    const seenFocusMetricKeys = new Set();
    const addFocusCandidate = (metric, tips) => {
        if (!metric || !metric.metricKey || seenFocusMetricKeys.has(metric.metricKey)) return;
        const normalizedTips = Array.isArray(tips)
            ? tips.map(tip => String(tip || '').trim()).filter(Boolean)
            : [];
        focusCandidates.push({ metric, tips: normalizedTips });
        seenFocusMetricKeys.add(metric.metricKey);
    };

    addFocusCandidate(weakestMetric, tipsForWeakest);
    addFocusCandidate(trendingMetric, tipsForTrending);

    belowTargetMetrics.forEach(metric => {
        if (focusCandidates.length >= 2) return;
        addFocusCandidate(metric, getRandomTipsForMetric(metric.metricKey, 2));
    });

    return focusCandidates.slice(0, 2).map((candidate, index) => ({
        metric: candidate.metric,
        tips: candidate.tips.length > 0 ? candidate.tips : ['No coaching tips available yet for this metric.'],
        bgColor: index === 0 ? '#fff3cd' : '#ffe0b2',
        borderColor: index === 0 ? '#ff9800' : '#f57c00',
        titleColor: index === 0 ? '#ff9800' : '#f57c00'
    }));
}

function buildTrendSentimentSectionHtml(employeeName, weekKey, sentimentSnapshot) {
    const periodData = ytdData[weekKey] || weeklyData[weekKey];
    const periodEmployee = periodData?.employees?.find(emp => emp.name === employeeName) || null;
    const sentimentMetrics = periodEmployee
        ? {
            negativeWord: periodEmployee.negativeWord,
            positiveWord: periodEmployee.positiveWord,
            managingEmotions: periodEmployee.managingEmotions
        }
        : null;
    const sentimentFocusText = buildSentimentFocusAreasForPrompt(sentimentSnapshot, sentimentMetrics);
    const sentimentHtml = sentimentSnapshot
        ? `
        <div style="margin: 20px 0; padding: 15px; background: #fff8e1; border-radius: 4px; border-left: 4px solid #ffb300;">
            <h4 style="color: #8d6e00; margin-top: 0;">💬 Sentiment Focus (${sentimentSnapshot.timeframeStart} to ${sentimentSnapshot.timeframeEnd})</h4>
            <p style="margin: 0; color: #333; white-space: pre-wrap;">${escapeHtml(sentimentFocusText)}</p>
        </div>
        `
        : '';

    return { sentimentHtml, sentimentFocusText };
}

function renderTrendFocusAreasHtml(focusAreas) {
    return focusAreas.map((focusArea, areaIndex) => {
        const tipsHtml = focusArea.tips.map((tip, tipIndex) => `
            <div style="background: #f0f0f0; padding: 12px; border-radius: 4px; margin-bottom: 10px; border-left: 4px solid #9c27b0;">
                <strong>💡 Tip ${tipIndex + 1}:</strong> ${tip}
            </div>
        `).join('');

        const heading = focusAreas.length === 1
            ? `📉 Focus Area: ${focusArea.metric.label}`
            : `📉 Focus Area ${areaIndex + 1}: ${focusArea.metric.label}`;

        return `
            <div style="margin-bottom: 20px; padding: 15px; background: ${focusArea.bgColor}; border-radius: 4px; border-left: 4px solid ${focusArea.borderColor};">
                <h4 style="color: ${focusArea.titleColor}; margin-top: 0;">${heading}</h4>
                <p style="margin: 5px 0 15px 0; color: #333;">
                    Currently at <strong>${focusArea.metric.employeeValue.toFixed(1)}</strong>, 
                    target is <strong>${focusArea.metric.targetType === 'min' ? '≥' : '≤'} ${focusArea.metric.target.toFixed(1)}</strong>
                </p>
                ${tipsHtml}
            </div>
        `;
    }).join('');
}

function renderTrendIntelligenceSnapshotHtml(allMetrics) {
    const metrics = Array.isArray(allMetrics) ? allMetrics : [];
    if (metrics.length === 0) return '';

    const classificationPriority = {
        'Needs Focus': 0,
        'Watch Area': 1,
        'On Track': 2,
        'Exceeding Expectation': 3
    };

    const sorted = [...metrics].sort((a, b) => {
        const classA = classificationPriority[a.classification] ?? 9;
        const classB = classificationPriority[b.classification] ?? 9;
        if (classA !== classB) return classA - classB;
        const riskA = (a.gapFromTarget || 0) + Math.max(0, -(a.trendDelta || 0));
        const riskB = (b.gapFromTarget || 0) + Math.max(0, -(b.trendDelta || 0));
        return riskB - riskA;
    });

    const topItems = sorted.slice(0, 6);
    const rows = topItems.map(metric => {
        const directionText = metric.trendDirection === 'improving'
            ? 'Improving'
            : metric.trendDirection === 'declining'
            ? 'Declining'
            : 'Stable';
        const directionColor = metric.trendDirection === 'improving'
            ? '#2e7d32'
            : metric.trendDirection === 'declining'
            ? '#b71c1c'
            : '#455a64';

        const classColor = metric.classification === 'Exceeding Expectation'
            ? '#2e7d32'
            : metric.classification === 'On Track'
            ? '#0277bd'
            : metric.classification === 'Watch Area'
            ? '#ef6c00'
            : '#b71c1c';

        const volatilityText = metric.isVolatile ? 'Volatile' : 'Stable';
        const volatilityColor = metric.isVolatile ? '#ef6c00' : '#455a64';

        return `
            <tr>
                <td style="padding: 8px; border-bottom: 1px solid #eee; color: #333;">${metric.label}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; color: ${classColor}; font-weight: 600;">${metric.classification || 'On Track'}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; color: ${directionColor};">${directionText}</td>
                <td style="padding: 8px; border-bottom: 1px solid #eee; color: ${volatilityColor};">${volatilityText}</td>
            </tr>
        `;
    }).join('');

    const counts = {
        exceeding: metrics.filter(m => m.classification === 'Exceeding Expectation').length,
        onTrack: metrics.filter(m => m.classification === 'On Track').length,
        watch: metrics.filter(m => m.classification === 'Watch Area').length,
        needsFocus: metrics.filter(m => m.classification === 'Needs Focus').length
    };

    return `
        <div style="margin: 20px 0; padding: 15px; background: #f4f9ff; border-radius: 4px; border-left: 4px solid #1976d2;">
            <div style="display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 10px; flex-wrap: wrap;">
                <h4 style="color: #1976d2; margin: 0;">🧠 Intelligence Snapshot</h4>
                <button id="copyTrendIntelligenceSnapshotBtn" type="button" style="padding: 8px 12px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 0.85em;">
                    📋 Copy Snapshot
                </button>
            </div>
            <p style="margin: 0 0 10px 0; color: #455a64; font-size: 0.9em;">
                Exceeding: <strong>${counts.exceeding}</strong> · On Track: <strong>${counts.onTrack}</strong> · Watch: <strong>${counts.watch}</strong> · Needs Focus: <strong>${counts.needsFocus}</strong>
            </p>
            <table style="width: 100%; border-collapse: collapse; font-size: 0.9em; background: white; border: 1px solid #e3eef9;">
                <thead>
                    <tr style="background: #e3f2fd; color: #0d47a1; text-align: left;">
                        <th style="padding: 8px; border-bottom: 1px solid #d3e7f9;">Metric</th>
                        <th style="padding: 8px; border-bottom: 1px solid #d3e7f9;">Class</th>
                        <th style="padding: 8px; border-bottom: 1px solid #d3e7f9;">Momentum</th>
                        <th style="padding: 8px; border-bottom: 1px solid #d3e7f9;">Volatility</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows}
                </tbody>
            </table>
        </div>
    `;
}

function buildTrendIntelligenceSnapshotText(allMetrics) {
    const metrics = Array.isArray(allMetrics) ? allMetrics : [];
    if (metrics.length === 0) return 'No intelligence snapshot data available.';

    const classificationPriority = {
        'Needs Focus': 0,
        'Watch Area': 1,
        'On Track': 2,
        'Exceeding Expectation': 3
    };

    const counts = {
        exceeding: metrics.filter(m => m.classification === 'Exceeding Expectation').length,
        onTrack: metrics.filter(m => m.classification === 'On Track').length,
        watch: metrics.filter(m => m.classification === 'Watch Area').length,
        needsFocus: metrics.filter(m => m.classification === 'Needs Focus').length
    };

    const topItems = [...metrics]
        .sort((a, b) => {
            const classA = classificationPriority[a.classification] ?? 9;
            const classB = classificationPriority[b.classification] ?? 9;
            if (classA !== classB) return classA - classB;
            const riskA = (a.gapFromTarget || 0) + Math.max(0, -(a.trendDelta || 0));
            const riskB = (b.gapFromTarget || 0) + Math.max(0, -(b.trendDelta || 0));
            return riskB - riskA;
        })
        .slice(0, 8);

    const lines = topItems.map(metric => {
        const directionText = metric.trendDirection === 'improving'
            ? 'Improving'
            : metric.trendDirection === 'declining'
            ? 'Declining'
            : 'Stable';
        const volatilityText = metric.isVolatile ? 'Volatile' : 'Stable';
        const currentText = formatMetricDisplay(metric.metricKey, metric.employeeValue);
        const goalText = formatMetricDisplay(metric.metricKey, metric.target);
        const previousText = metric.previousValue !== null && metric.previousValue !== undefined
            ? formatMetricDisplay(metric.metricKey, metric.previousValue)
            : 'N/A';
        const teamText = Number.isFinite(metric.centerValue) && metric.centerValue > 0
            ? formatMetricDisplay(metric.metricKey, metric.centerValue)
            : 'N/A';
        return `- ${metric.label}: ${metric.classification || 'On Track'} | Current ${currentText} | Goal ${goalText} | Previous ${previousText} | Team ${teamText} | ${directionText} | ${volatilityText}`;
    });

    return [
        'INTELLIGENCE SNAPSHOT',
        `Exceeding: ${counts.exceeding} | On Track: ${counts.onTrack} | Watch: ${counts.watch} | Needs Focus: ${counts.needsFocus}`,
        '',
        ...lines
    ].join('\n');
}

function attachTrendTipsModalHandlers(options) {
    const {
        modal,
        displayName,
        primaryFocusMetric,
        secondaryFocusMetric,
        primaryFocusTips,
        secondaryFocusTips,
        sentimentSnapshot,
        allMetrics,
        copilotPrompt,
        focusAreas,
        employeeName,
        periodLabel
    } = options;

    document.getElementById('copyPromptBtn').addEventListener('click', () => {
        const textarea = document.getElementById('copilotPromptDisplay');
        textarea.select();
        document.execCommand('copy');
        showToast('✅ Prompt copied! Opening Copilot...', 2000);
        window.open('https://copilot.microsoft.com', '_blank');
    });

    const copySnapshotBtn = document.getElementById('copyTrendIntelligenceSnapshotBtn');
    if (copySnapshotBtn) {
        copySnapshotBtn.addEventListener('click', () => {
            const summaryText = buildTrendIntelligenceSnapshotText(allMetrics || []);
            navigator.clipboard.writeText(summaryText).then(() => {
                showToast('✅ Intelligence snapshot copied', 2000);
            }).catch(() => {
                const textarea = document.createElement('textarea');
                textarea.value = summaryText;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                showToast('✅ Intelligence snapshot copied', 2000);
            });
        });
    }

    document.getElementById('logTrendCoachingBtn').addEventListener('click', () => {
        const userNotesText = document.getElementById('trendCoachingNotes').value.trim();
        const finalPrompt = userNotesText
            ? buildTrendCoachingPrompt(
                displayName,
                primaryFocusMetric,
                secondaryFocusMetric,
                primaryFocusTips,
                secondaryFocusTips,
                userNotesText,
                sentimentSnapshot,
                allMetrics
            )
            : copilotPrompt;

        const metricsCoached = focusAreas
            .map(area => area.metric?.metricKey)
            .filter(Boolean);

        recordCoachingEvent({
            employeeId: employeeName,
            weekEnding: periodLabel,
            metricsCoached: metricsCoached,
            aiAssisted: true
        });

        showToast('✅ Coaching logged', 2000);
        document.getElementById('copilotPromptDisplay').value = finalPrompt;
        showToast('💡 Updated prompt above with your notes. Copy and paste into CoPilot!', 3000);
        document.getElementById('copilotPromptDisplay').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    document.getElementById('skipTrendCoachingBtn').addEventListener('click', () => {
        document.body.removeChild(modal);
    });

    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

function buildTrendTipsModalHtml(displayName, periodLabel, summaryBoxesHtml, focusAreasHtml, sentimentHtml, intelligenceSnapshotHtml, copilotPrompt) {
    return `
        <h3 style="color: #9c27b0; margin-top: 0;">📊 Coaching Summary for ${displayName}</h3>
        <p style="color: #666; margin-bottom: 20px; font-size: 0.95em;">${periodLabel}</p>

        ${summaryBoxesHtml}
        
        ${focusAreasHtml ? `<h4 style="color: #9c27b0; margin: 0 0 12px 0;">🎯 Coaching Focus</h4>${focusAreasHtml}` : ''}

        ${intelligenceSnapshotHtml}

        ${sentimentHtml}
        
        <div style="margin: 20px 0;">
            <label style="display: block; margin-bottom: 8px; font-weight: bold;">💬 Additional Notes (optional):</label>
            <textarea id="trendCoachingNotes" style="width: 100%; height: 70px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-family: Arial;" placeholder="Any additional coaching notes..."></textarea>
        </div>
        
        <div style="margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 4px; border: 1px solid #ddd;">
            <h4 style="color: #333; margin-top: 0;">🤖 CoPilot Prompt</h4>
            <p style="color: #666; font-size: 0.9em; margin: 0 0 10px 0;">
                Copy this prompt and paste it into <strong><a href="https://copilot.microsoft.com" target="_blank" style="color: #1976d2;">Microsoft CoPilot</a></strong> to draft the coaching email:
            </p>
            <textarea id="copilotPromptDisplay" readonly style="width: 100%; height: 200px; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 0.85em; background: white; color: #333;">${copilotPrompt}</textarea>
            <button id="copyPromptBtn" style="margin-top: 10px; padding: 10px 16px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">
                📋 Copy Prompt
            </button>
        </div>
        
        <div style="display: flex; gap: 10px; margin-top: 20px;">
            <button id="logTrendCoachingBtn" style="flex: 1; padding: 12px; background: #9c27b0; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.95em;">
                ✅ Log Coaching
            </button>
            <button id="skipTrendCoachingBtn" style="flex: 1; padding: 12px; background: #999; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 0.95em;">
                Skip
            </button>
        </div>
    `;
}

function createTrendTipsModalElements() {
    const modal = document.createElement('div');
    modal.id = 'trendTipsModal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    `;

    const panel = document.createElement('div');
    panel.style.cssText = `
        background: white;
        border-radius: 8px;
        padding: 24px;
        max-width: 650px;
        max-height: 85vh;
        overflow-y: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;

    return { modal, panel };
}

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
function showTrendsWithTipsPanel(employeeName, displayName, weakestMetric, trendingMetric, tipsForWeakest, tipsForTrending, weekKey, periodMeta, emailSubject, sentimentSnapshot = null, allMetrics = null) {
    /**
     * Show a modal/panel with:
     * - Praise for strongest metric
     * - Focus area (trending down metric) with 2 coaching tips
     * - Open Copilot with coaching prompt
     */
    const { modal, panel } = createTrendTipsModalElements();
    
    const periodLabel = periodMeta.label || (periodMeta.endDate ? `Week ending ${formatDateMMDDYYYY(periodMeta.endDate)}` : 'this period');
    const { positiveHighlights, improvementAreas } = buildTrendHighlightsAndImprovements(allMetrics || []);
    const summaryBoxesHtml = renderTrendSummaryBoxesHtml(
        positiveHighlights,
        improvementAreas,
        'No above-target metrics in this period.',
        'No below-target metrics in this period.'
    );
    
    const focusAreas = buildTrendFocusAreas(
        weakestMetric,
        tipsForWeakest,
        trendingMetric,
        tipsForTrending,
        allMetrics
    );

    const primaryFocusMetric = focusAreas[0]?.metric || null;
    const secondaryFocusMetric = focusAreas[1]?.metric || null;
    const primaryFocusTips = focusAreas[0]?.tips || [];
    const secondaryFocusTips = focusAreas[1]?.tips || [];

    const focusAreasHtml = renderTrendFocusAreasHtml(focusAreas);
    const intelligenceSnapshotHtml = renderTrendIntelligenceSnapshotHtml(allMetrics || []);

    const { sentimentHtml } = buildTrendSentimentSectionHtml(employeeName, weekKey, sentimentSnapshot);
    
    // Build the comprehensive Copilot prompt (NEW)
    const userNotes = ''; // Will be filled by user in textarea
    const copilotPrompt = buildTrendCoachingPrompt(
        displayName, 
        primaryFocusMetric,
        secondaryFocusMetric,
        primaryFocusTips,
        secondaryFocusTips,
        userNotes,
        sentimentSnapshot,
        allMetrics
    );
    
    panel.innerHTML = buildTrendTipsModalHtml(
        displayName,
        periodLabel,
        summaryBoxesHtml,
        focusAreasHtml,
        intelligenceSnapshotHtml,
        sentimentHtml,
        copilotPrompt
    );
    
    modal.appendChild(panel);
    document.body.appendChild(modal);

    attachTrendTipsModalHandlers({
        modal,
        displayName,
        primaryFocusMetric,
        secondaryFocusMetric,
        primaryFocusTips,
        secondaryFocusTips,
        sentimentSnapshot,
        allMetrics,
        copilotPrompt,
        focusAreas,
        employeeName,
        periodLabel
    });
}

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
function buildTrendCoachingPrompt(displayName, weakestMetric, trendingMetric, tipsForWeakest, tipsForTrending, userNotes, sentimentSnapshot = null, allTrendMetrics = null) {
    const metrics = Array.isArray(allTrendMetrics) ? allTrendMetrics : [];
    const getTrendLabel = (metric) => {
        if (!metric || metric.trendDelta === null || metric.trendDelta === undefined) return 'stable (no prior period)';
        if (metric.trendDirection === 'improving') return `improving (${formatMetricDisplay(metric.metricKey, Math.abs(metric.trendDelta))})`;
        if (metric.trendDirection === 'declining') return `declining (${formatMetricDisplay(metric.metricKey, Math.abs(metric.trendDelta))})`;
        return 'stable';
    };

    const classificationOrder = {
        'Needs Focus': 0,
        'Watch Area': 1,
        'On Track': 2,
        'Exceeding Expectation': 3
    };

    const strengths = [...metrics]
        .filter(m => m.classification === 'Exceeding Expectation' || (m.classification === 'On Track' && m.trendDirection === 'improving'))
        .sort((a, b) => (classificationOrder[b.classification] - classificationOrder[a.classification]) || ((b.trendDelta || 0) - (a.trendDelta || 0)))
        .slice(0, 4);

    const priorities = [...metrics]
        .filter(m => m.classification === 'Needs Focus' || m.classification === 'Watch Area')
        .sort((a, b) => {
            const scoreA = (a.gapFromTarget || 0) + Math.max(0, -(a.trendDelta || 0));
            const scoreB = (b.gapFromTarget || 0) + Math.max(0, -(b.trendDelta || 0));
            return scoreB - scoreA;
        })
        .slice(0, 4);

    const efficientSet = new Set(['aht', 'acw', 'holdTime', 'transfers']);
    const behaviorSet = new Set(['overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions', 'overallExperience', 'cxRepOverall', 'fcr']);
    const efficiencyNeeds = priorities.filter(m => efficientSet.has(m.metricKey)).length;
    const behaviorNeeds = priorities.filter(m => behaviorSet.has(m.metricKey)).length;

    const patternInsights = [];
    if (efficiencyNeeds > 0 && behaviorNeeds > 0) {
        patternInsights.push('Balanced pressure pattern: both call-control efficiency and communication-quality metrics need attention, suggesting pace and conversation quality are competing.');
    } else if (efficiencyNeeds > 0) {
        patternInsights.push('Execution pattern: primary risk is call flow efficiency, indicating opportunities in structure, pacing, and decision speed during interactions.');
    } else if (behaviorNeeds > 0) {
        patternInsights.push('Customer-experience pattern: tone and communication consistency are the main opportunities, pointing to word choice and emotional control habits.');
    } else {
        patternInsights.push('Consistency pattern: performance is generally steady with no concentrated risk cluster, so coaching should focus on sustaining repeatable habits.');
    }

    const volatilityRisks = metrics.filter(m => m.isVolatile).slice(0, 2);
    if (volatilityRisks.length > 0) {
        patternInsights.push(`Volatility signal: ${volatilityRisks.map(m => m.label).join(' and ')} show noticeable swings, so consistency routines should be reinforced to stabilize outcomes.`);
    }

    const topPriority = priorities[0] || weakestMetric || null;
    const topPriorityTips = topPriority?.metricKey === weakestMetric?.metricKey
        ? (tipsForWeakest || [])
        : topPriority?.metricKey === trendingMetric?.metricKey
        ? (tipsForTrending || [])
        : [];

    const actionTipLines = (topPriorityTips || []).slice(0, 2).map(t => `- ${t}`);
    if (actionTipLines.length === 0) {
        actionTipLines.push('- Use one call-plan checklist per shift to standardize call control and reduce avoidable variance.');
        actionTipLines.push('- Complete a 5-minute end-of-day reflection to identify one repeatable behavior for the next shift.');
    }

    const resolveThirtyDayGoal = () => {
        if (!topPriority) return 'Maintain all key metrics in On Track or Exceeding status for four consecutive weekly reviews.';
        if (topPriority.meetsTarget) {
            return `${topPriority.label}: hold at or better than ${formatMetricDisplay(topPriority.metricKey, topPriority.target)} while avoiding further decline across the next 30 days.`;
        }
        const gap = topPriority.gapFromTarget || 0;
        const closeBy = Math.max(getMetricBandByUnit(topPriority.metricKey, { percent: 1.5, sec: 12, hrs: 0.8, fallback: 1.5 }), gap * 0.4);
        const goalValue = topPriority.targetType === 'min'
            ? topPriority.employeeValue + closeBy
            : topPriority.employeeValue - closeBy;
        const boundedGoal = topPriority.targetType === 'min'
            ? Math.min(goalValue, topPriority.target)
            : Math.max(goalValue, topPriority.target);
        return `${topPriority.label}: move from ${formatMetricDisplay(topPriority.metricKey, topPriority.employeeValue)} to at least ${formatMetricDisplay(topPriority.metricKey, boundedGoal)} within 30 days.`;
    };

    const metricTableLines = metrics
        .sort((a, b) => (classificationOrder[a.classification] - classificationOrder[b.classification]) || (b.gapFromTarget - a.gapFromTarget))
        .map(metric => {
            const current = formatMetricDisplay(metric.metricKey, metric.employeeValue);
            const target = formatMetricDisplay(metric.metricKey, metric.target);
            const previous = metric.previousValue !== null && metric.previousValue !== undefined
                ? formatMetricDisplay(metric.metricKey, metric.previousValue)
                : 'N/A';
            const teamAvg = metric.centerValue > 0 ? formatMetricDisplay(metric.metricKey, metric.centerValue) : 'N/A';
            const volatility = metric.isVolatile ? 'swinging' : 'stable';
            return `- ${metric.label}: current ${current} | goal ${target} | previous ${previous} | team avg ${teamAvg} | momentum ${getTrendLabel(metric)} | volatility ${volatility} | class ${metric.classification}`;
        })
        .join('\n');

    const strengthLines = strengths.length > 0
        ? strengths.map(m => `- ${m.label}: demonstrates ${m.trendDirection === 'improving' ? 'building momentum and coachability' : 'reliable execution under normal call demand'}.`).join('\n')
        : '- No clear strengths are separated enough from baseline this period; reinforce foundational consistency first.';

    const priorityLines = priorities.length > 0
        ? priorities.map(m => `- ${m.label}: ${m.trendDirection === 'declining' ? 'declining trajectory' : 'below-target performance'} requires focused coaching to prevent broader impact.`).join('\n')
        : '- No immediate risk areas detected; maintain consistent coaching cadence and monitor for drift.';

    const leadershipLinks = [];
    priorities.forEach(m => {
        if (['aht', 'acw', 'holdTime', 'transfers', 'fcr'].includes(m.metricKey)) {
            leadershipLinks.push(`- ${m.label} → Decision quality, Accountability, Continuous improvement`);
        }
        if (['overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions', 'overallExperience', 'cxRepOverall'].includes(m.metricKey)) {
            leadershipLinks.push(`- ${m.label} → Communication clarity, Customer focus, Emotional regulation`);
        }
        if (['scheduleAdherence', 'reliability'].includes(m.metricKey)) {
            leadershipLinks.push(`- ${m.label} → Accountability, Collaboration, Continuous improvement`);
        }
    });

    const leadershipSection = leadershipLinks.length > 0
        ? Array.from(new Set(leadershipLinks)).slice(0, 4).join('\n')
        : '- Current trends align to maintaining Accountability and Continuous improvement through consistent execution habits.';

    const sentimentMetrics = metrics.length > 0
        ? {
            negativeWord: metrics.find(m => m.metricKey === 'negativeWord')?.employeeValue,
            positiveWord: metrics.find(m => m.metricKey === 'positiveWord')?.employeeValue,
            managingEmotions: metrics.find(m => m.metricKey === 'managingEmotions')?.employeeValue
        }
        : null;
    const sentimentFocusText = sentimentSnapshot
        ? buildSentimentFocusAreasForPrompt(sentimentSnapshot, sentimentMetrics)
        : '';

    const actionPlanSection = [
        'Immediate tactical adjustments:',
        ...actionTipLines,
        'Skill development suggestions:',
        '- Run one focused call-listening review each week with behavior-specific feedback and one repeatable behavior target.',
        'Process adjustments:',
        '- Add a mid-week checkpoint on trend direction so downward momentum is coached before end-of-period results lock in.',
        `30-day measurable improvement goal: ${resolveThirtyDayGoal()}`
    ].join('\n');

    const notesSection = userNotes ? `\nMANAGER CONTEXT:\n${userNotes}\n` : '';
    const sentimentSection = sentimentFocusText ? `\nSENTIMENT CONTEXT:\n${sentimentFocusText}\n` : '';

    return `You are the AI Intelligence Layer for a Supervisor Development Coaching Tool.

Use the performance data below to produce deep coaching intelligence and a ready-to-send coaching email.

ASSOCIATE: ${displayName}

METRIC INTELLIGENCE INPUT:
${metricTableLines || '- No metric data available.'}
${sentimentSection}${notesSection}
OUTPUT REQUIREMENTS:
- Compare each metric to goal and previous period.
- Identify patterns across efficiency, sentiment, call control, and emotional regulation.
- Flag volatility and early risks, even when still above goal.
- Use behavioral interpretation, not numeric restatement.

Generate exactly this structure:

=== EXECUTIVE PERFORMANCE SUMMARY ===
3-5 sentences for supervisor use.

=== STRENGTHS TO LEVERAGE ===
${strengthLines}

=== PRIORITY DEVELOPMENT AREAS ===
${priorityLines}

=== PERFORMANCE PATTERN INSIGHTS ===
${patternInsights.join(' ')}

=== RECOMMENDED ACTION PLAN ===
${actionPlanSection}

=== LEADERSHIP COMPETENCY CONNECTION ===
${leadershipSection}

=== COACHING MESSAGE DRAFT ===
Write a copy-ready coaching email directly to ${displayName}.

Tone requirements:
- Supportive but direct
- Accountability-focused
- Growth-oriented
- Professional
- No filler phrases
- No mention of AI

Formatting requirements:
- Outlook-ready plain text
- Clean headings and bullets
- No technical commentary
- No em dash characters.`;
}



function getMetricOrder() {
    // PHASE 3 - LOCKED ORDER: Core Performance ? Survey ? Sentiment ? Reliability
    return [
        // CORE PERFORMANCE GROUP (6 metrics)
        { key: 'scheduleAdherence', group: 'Core Performance' },
        { key: 'transfers', group: 'Core Performance' },
        { key: 'aht', group: 'Core Performance' },
        { key: 'holdTime', group: 'Core Performance' },
        { key: 'acw', group: 'Core Performance' },
        // SURVEY GROUP (3 metrics)
        { key: 'overallExperience', group: 'Survey' },
        { key: 'cxRepOverall', group: 'Survey' },
        { key: 'fcr', group: 'Survey' },
        // SENTIMENT GROUP (3 metrics)
        { key: 'overallSentiment', group: 'Sentiment' },
        { key: 'positiveWord', group: 'Sentiment' },
        { key: 'negativeWord', group: 'Sentiment' },
        { key: 'managingEmotions', group: 'Sentiment' },
        // RELIABILITY GROUP (1 metric)
        { key: 'reliability', group: 'Reliability' }
    ];
}

// ============================================
// PHASE 3 - METRIC ROW RENDERER
// ============================================

function isReverseMetric(metricKey) {
    // Lower is better for these metrics
    const reverseMetrics = ['transfers', 'aht', 'holdTime', 'acw', 'reliability'];
    return reverseMetrics.includes(metricKey);
}

function resolveTrendMetricYtdDisplay(metric, isSurveyMetric, ytdValue, ytdSurveyTotal) {
    let formattedYtd = '';
    const ytdValueNum = parseFloat(ytdValue);
    const ytdHasValue = ytdValue !== undefined && ytdValue !== null && ytdValue !== '' && !isNaN(ytdValueNum);

    if (isSurveyMetric) {
        if (ytdSurveyTotal > 0 && ytdHasValue) {
            formattedYtd = formatMetricValue(metric.key, ytdValueNum);
        } else if (ytdSurveyTotal === 0) {
            formattedYtd = 'N/A';
        } else {
            formattedYtd = 'N/A';
        }
    } else if (ytdHasValue) {
        formattedYtd = formatMetricValue(metric.key, ytdValueNum);
    }

    return formattedYtd;
}

function resolveTrendRowBackgroundColor(noSurveys, meetsGoal) {
    if (noSurveys) return '#ffffff';
    if (meetsGoal) return '#d4edda';
    return '#fff3cd';
}

function resolveTrendCenterComparisonDisplay(associateValue, centerAvg, isAboveCenter, metricKey, centerExists) {
    if (!centerExists) {
        return {
            color: '#999999',
            text: 'N/A'
        };
    }

    const difference = associateValue - centerAvg;
    let text = formatMetricValue(metricKey, Math.abs(difference));
    if (difference > 0) text = `+${text}`;
    else if (difference < 0) text = `-${text}`;

    return {
        color: isAboveCenter ? '#0056B3' : '#DAA520',
        text
    };
}

function resolveTrendDirectionDisplay(associateValue, previousValue, isReverse, metricKey, periodType) {
    const prevNum = previousValue !== undefined && previousValue !== null ? parseFloat(previousValue) : null;
    const prevIsValid = prevNum !== null && !isNaN(prevNum);

    if (!prevIsValid) {
        return {
            color: '#666666',
            text: 'N/A'
        };
    }

    const trendDiff = associateValue - prevNum;
    const absDiff = Math.abs(trendDiff);
    const isImprovement = isReverse ? trendDiff < 0 : trendDiff > 0;

    if (absDiff < 0.1) {
        return {
            color: '#666666',
            text: '➡️ No change'
        };
    }

    const changeValue = formatMetricValue(metricKey, absDiff);
    const periodLabel = periodType === 'month' ? 'month' : periodType === 'quarter' ? 'quarter' : 'week';
    const sign = trendDiff > 0 ? '+' : '-';
    const directionEmoji = trendDiff > 0 ? '📈' : '📉';

    return {
        color: isImprovement ? '#28a745' : '#dc3545',
        text: `${directionEmoji} ${sign}${changeValue} vs last ${periodLabel}`
    };
}

function drawTrendMetricRowShell(ctx, x, y, width, height, rowBgColor) {
    ctx.fillStyle = rowBgColor;
    ctx.fillRect(x, y, width, height);

    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);
}

function drawTrendMetricBaseCells(ctx, x, y, metric, target, noSurveys, associateValue, centerExists, centerAvg) {
    ctx.fillStyle = '#333333';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    const targetDisplay = formatMetricDisplay(metric.key, target);
    ctx.fillText(`${metric.label} (${targetDisplay})`, x + 10, y + 24);

    ctx.fillStyle = noSurveys ? '#999999' : '#333333';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    const formattedValue = noSurveys ? 'N/A' : formatMetricValue(metric.key, associateValue);
    ctx.fillText(formattedValue, x + 240, y + 24);

    ctx.fillStyle = '#333333';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    const formattedCenter = centerExists ? formatMetricValue(metric.key, centerAvg) : 'N/A';
    ctx.fillText(formattedCenter, x + 340, y + 24);
}

function drawTrendMetricCenterAndTrendCells(ctx, x, y, noSurveys, associateValue, centerAvg, isAboveCenter, metric, previousValue, isReverse, metricKey, periodType) {
    if (!noSurveys) {
        const centerExists = centerAvg > 0;
        const vsCenterDisplay = resolveTrendCenterComparisonDisplay(
            associateValue,
            centerAvg,
            isAboveCenter,
            metric.key,
            centerExists
        );

        ctx.fillStyle = vsCenterDisplay.color;
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(vsCenterDisplay.text, x + 460, y + 24);

        const trendingDisplay = resolveTrendDirectionDisplay(
            associateValue,
            previousValue,
            isReverse,
            metricKey,
            periodType
        );

        ctx.fillStyle = trendingDisplay.color;
        ctx.font = '13px Arial';
        ctx.textAlign = 'left';
        ctx.fillText(trendingDisplay.text, x + 570, y + 24);
        return;
    }

    ctx.fillStyle = '#999999';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('N/A', x + 460, y + 24);
    ctx.textAlign = 'left';
    ctx.fillText('N/A', x + 570, y + 24);
}

function renderMetricRow(ctx, x, y, width, height, metric, associateValue, centerAvg, ytdValue, target, previousValue, rowIndex, alternatingColor, surveyTotal = 0, metricKey = '', periodType = 'week', ytdSurveyTotal = 0, reviewYear = null) {
    /**
     * PHASE 3.1 - METRIC ROW RENDERER
     * Renders a single metric row with full conditional logic
     * 
     * ROW COLORS:
     * - Green: Metric meets goal
     * - Yellow: Metric does NOT meet goal
     * - White: Survey metric with no surveys
     * 
     * VS CENTER CELL COLORS (nested within row):
     * - Blue: Associate is above center average
     * - Dark Yellow: Associate is below center average
     * - Gray: Center average unavailable
     * 
     * Reverse logic applies to: Transfers, AHT, Hold Time, ACW, Reliability
     * 
     * Survey metrics show N/A if no surveys received
     */
    
    // Check if this is a survey metric with no surveys
    const SURVEY_METRICS = ['cxRepOverall', 'fcr', 'overallExperience'];
    const isSurveyMetric = SURVEY_METRICS.includes(metricKey);
    const noSurveys = isSurveyMetric && surveyTotal === 0;
    
    const meetsGoal = isMetricMeetingTarget(metric.key, associateValue, target);
    const isReverse = isReverseMetric(metric.key);
    
    // Determine if associate is above/below center
    const centerExists = centerAvg > 0;
    const isAboveCenter = centerExists ? 
        (isReverse ? associateValue < centerAvg : associateValue > centerAvg) : 
        false;
    
    const rowBgColor = resolveTrendRowBackgroundColor(noSurveys, meetsGoal);

    drawTrendMetricRowShell(ctx, x, y, width, height, rowBgColor);
    drawTrendMetricBaseCells(ctx, x, y, metric, target, noSurveys, associateValue, centerExists, centerAvg);
    drawTrendMetricCenterAndTrendCells(
        ctx,
        x,
        y,
        noSurveys,
        associateValue,
        centerAvg,
        isAboveCenter,
        metric,
        previousValue,
        isReverse,
        metricKey,
        periodType
    );
    
    // YTD value - always render for all view types
    // CRITICAL: YTD display is INDEPENDENT of weekly survey count
    const formattedYtd = resolveTrendMetricYtdDisplay(metric, isSurveyMetric, ytdValue, ytdSurveyTotal);
    
    ctx.fillStyle = '#333333';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(formattedYtd, x + 730, y + 24);
    ctx.textAlign = 'left'; // Reset to default
}

function createTrendEmailImage(empName, weekKey, period, current, previous, onClipboardReady) {
    // ============================================
    // PHASE 5 - SINGLE-SOURCE EMAIL GENERATION
    // ============================================
    
    if (!current) {
        console.error('Invalid employee data:', current);
        showToast('ℹ️ Employee data is missing', 5000);
        return;
    }
    
    const trendContext = buildTrendEmailContext(weekKey, period, current, previous);
    // CREATE CANVAS IMAGE (will be resized based on content)
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 2400; // Increased to accommodate legend + all sections
    const ctx = canvas.getContext('2d');

    drawTrendEmailCanvasSections(ctx, empName, current, previous, trendContext);

    finalizeTrendEmailImageOutput(canvas, empName, period, onClipboardReady);
}

function drawTrendEmailCanvasSections(ctx, empName, current, previous, trendContext) {
    const {
        metadata,
        reviewYear,
        metricOrder,
        metrics,
        prevMetrics,
        centerAvg,
        hasSurveys,
        meetingGoals,
        beatingCenter,
        totalMetrics,
        successRate,
        improvedText,
        periodDisplay,
        periodTypeText,
        improvedSub
    } = trendContext;

    const periodLabel = periodDisplay.periodLabel;
    const subjectLine = buildTrendEmailSubject(metadata, empName);
    let y = drawTrendEmailCanvasLayoutStart(ctx, empName, subjectLine);

    y = drawTrendSummaryCardsRow(ctx, y, {
        meetingGoals,
        totalMetrics,
        successRate,
        beatingCenter,
        improvedText,
        improvedSub
    });

    y = drawTrendSummaryBoxesSection(ctx, y, current, centerAvg, reviewYear);
    y = drawTrendMetricsSectionHeader(ctx, y, periodLabel);

    const tableOptions = buildTrendMetricsTableOptions(trendContext, periodLabel);
    y = drawTrendMetricsTableBody(ctx, y, tableOptions);

    drawTrendInsightsLegendAndReliabilitySection(
        ctx,
        y,
        metricOrder,
        metrics,
        prevMetrics,
        centerAvg,
        previous,
        periodTypeText,
        hasSurveys
    );
}

function finalizeTrendEmailImageOutput(canvas, empName, period, onClipboardReady) {
    canvas.toBlob(pngBlob => {
        if (!pngBlob) {
            console.error('Failed to create blob from canvas');
            showToast('ℹ️ Error creating image', 5000);
            return;
        }

        copyTrendImageToClipboardOrDownload(pngBlob, empName, period, onClipboardReady);
    }, 'image/png');
}

function buildTrendEmailContext(weekKey, period, current, previous) {
    const metadata = period?.metadata || {};
    const reviewYear = getReviewYearFromEndDate(metadata.endDate);

    const metricOrder = getMetricOrder();
    const { metrics, prevMetrics } = buildTrendMetricMaps(metricOrder, current, previous);

    const callCenterAverages = loadCallCenterAverages();
    const centerAvg = callCenterAverages[weekKey] || {};

    const ytdPeriod = getYtdPeriodForWeekKey(weekKey);
    const ytdEmployee = ytdPeriod?.employees?.find(e => e.name === current.name) || null;
    const ytdAvailable = !!ytdEmployee;

    const { surveyTotal, ytdSurveyTotal } = calculateTrendSurveyTotals(current, metadata);
    const hasSurveys = surveyTotal > 0;

    const {
        meetingGoals,
        improved,
        beatingCenter,
        totalMetrics,
        successRate,
        improvedText
    } = calculateTrendSummaryStats(metricOrder, metrics, prevMetrics, centerAvg, previous, hasSurveys);

    const periodDisplay = getTrendPeriodDisplay(metadata.periodType);
    const periodTypeText = periodDisplay.periodTypeText;
    const improvedSub = previous ? `From Last ${periodTypeText.charAt(0).toUpperCase() + periodTypeText.slice(1)}` : 'No Prior Data';

    return {
        metadata,
        reviewYear,
        metricOrder,
        metrics,
        prevMetrics,
        centerAvg,
        ytdEmployee,
        ytdAvailable,
        surveyTotal,
        ytdSurveyTotal,
        hasSurveys,
        meetingGoals,
        improved,
        beatingCenter,
        totalMetrics,
        successRate,
        improvedText,
        periodDisplay,
        periodTypeText,
        improvedSub
    };
}

function buildTrendMetricsTableOptions(trendContext, periodLabel) {
    return {
        metricOrder: trendContext.metricOrder,
        metrics: trendContext.metrics,
        prevMetrics: trendContext.prevMetrics,
        centerAvg: trendContext.centerAvg,
        ytdEmployee: trendContext.ytdEmployee,
        hasSurveys: trendContext.hasSurveys,
        surveyTotal: trendContext.surveyTotal,
        ytdSurveyTotal: trendContext.ytdSurveyTotal,
        reviewYear: trendContext.reviewYear,
        metadata: trendContext.metadata,
        periodLabel,
        ytdAvailable: trendContext.ytdAvailable
    };
}

function drawTrendEmailCanvasLayoutStart(ctx, empName, subjectLine) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 900, 2400);

    const gradient = ctx.createLinearGradient(0, 0, 900, 100);
    gradient.addColorStop(0, '#003DA5');
    gradient.addColorStop(1, '#0056B3');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 900, 100);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Arial';
    ctx.fillText('📊 Performance Summary', 50, 45);
    ctx.font = '14px Arial';
    ctx.fillText(subjectLine, 50, 75);

    let y = 130;
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 20px Arial';
    ctx.fillText(`Hi ${empName},`, 50, y);
    y += 40;

    ctx.font = '15px Arial';
    ctx.fillStyle = '#666666';
    ctx.fillText(`Here's your performance summary and how you compare to call center averages.`, 50, y);

    return y + 50;
}

function drawTrendSummaryCardsRow(ctx, y, stats) {
    drawEmailCard(
        ctx,
        50,
        y,
        250,
        110,
        '#ffffff',
        '#28a745',
        '✅ Meeting Goals',
        `${stats.meetingGoals}/${stats.totalMetrics}`,
        `${stats.successRate}% Success Rate`
    );
    drawEmailCard(
        ctx,
        325,
        y,
        250,
        110,
        '#ffffff',
        '#2196F3',
        '📈 Above Average',
        `${stats.beatingCenter}/${stats.totalMetrics}`,
        'Better than Call Center'
    );
    drawEmailCard(
        ctx,
        600,
        y,
        250,
        110,
        '#ffffff',
        '#ff9800',
        '📈 Improved',
        stats.improvedText,
        stats.improvedSub
    );

    return y + 140;
}

function drawTrendSummaryBoxesSection(ctx, y, current, centerAvg, reviewYear) {
    const trendAnalysisForSummary = analyzeTrendMetrics(current, centerAvg, reviewYear);
    const trendSummary = buildTrendHighlightsAndImprovements(trendAnalysisForSummary.allMetrics || []);
    const summaryBoxesHeight = drawTrendSummaryBoxesOnCanvas(
        ctx,
        40,
        y,
        820,
        trendSummary.positiveHighlights,
        trendSummary.improvementAreas,
        'No above-target metrics in this period.',
        'No below-target metrics in this period.'
    );
    return y + summaryBoxesHeight + 24;
}

function drawTrendInsightsLegendAndReliabilitySection(ctx, y, metricOrder, metrics, prevMetrics, centerAvg, previous, periodTypeText, hasSurveys = true) {
    const { improvedMetrics, keyWins, focusMetrics } = buildTrendHighlightsData(
        metricOrder,
        metrics,
        prevMetrics,
        centerAvg,
        previous
    );

    const hasUnavailableCenterOrTrend = !previous || metricOrder.some(({ key }) => {
        if (metrics[key] === undefined) return false;
        const centerValue = parseFloat(getCenterAverageForMetric(centerAvg, key));
        return !Number.isFinite(centerValue) || centerValue <= 0;
    });

    let nextY = drawTrendHighlightsSection(ctx, y, keyWins, improvedMetrics, focusMetrics, periodTypeText, previous);
    nextY += 30 + drawTrendLegendOnCanvas(ctx, nextY + 30, periodTypeText, {
        includeNoSurveyData: !hasSurveys,
        includeUnavailableState: hasUnavailableCenterOrTrend
    });

    const reliabilityHours = parseFloat(metrics.reliability) || 0;
    if (reliabilityHours > 0) {
        nextY += drawTrendReliabilityNoteOnCanvas(ctx, nextY);
    }

    return nextY;
}

function drawTrendMetricsSectionHeader(ctx, y, periodLabel) {
    ctx.fillStyle = '#e3f2fd';
    ctx.fillRect(40, y, 820, 50);
    ctx.fillStyle = '#003DA5';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('📊 Your Metrics', 50, y + 32);
    y += 70;

    ctx.fillStyle = '#003DA5';
    ctx.fillRect(40, y, 820, 45);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'left';
    ctx.fillText('Metric', 50, y + 28);
    ctx.textAlign = 'center';
    ctx.fillText('Your Metric', 280, y + 28);
    ctx.fillText('Center Avg', 380, y + 28);
    ctx.fillText('vs. Center Avg', 500, y + 28);
    ctx.textAlign = 'left';
    ctx.fillText(`Change vs last ${periodLabel}`, 570, y + 28);
    ctx.textAlign = 'center';
    ctx.fillText('YTD', 770, y + 28);
    ctx.textAlign = 'left';

    return y + 45;
}

function drawTrendMetricsTableBody(ctx, y, options) {
    const {
        metricOrder,
        metrics,
        prevMetrics,
        centerAvg,
        ytdEmployee,
        hasSurveys,
        surveyTotal,
        ytdSurveyTotal,
        reviewYear,
        metadata,
        periodLabel,
        ytdAvailable
    } = options;

    if (!ytdAvailable) {
        ctx.fillStyle = '#666666';
        ctx.font = '12px Arial';
        ctx.fillText('YTD not available – source data not provided.', 50, y + 18);
        y += 28;
    }

    let currentGroup = null;
    let rowIdx = 0;

    metricOrder.forEach(({ key, group }) => {
        if (metrics[key] === undefined) return;

        const metric = METRICS_REGISTRY[key];
        if (!metric) return;

        if (group !== currentGroup) {
            currentGroup = group;

            const isSurveyGroupNoSurveys = group === 'Survey' && !hasSurveys;
            const headerBgColor = isSurveyGroupNoSurveys ? '#ffffff' : '#e3f2fd';
            const headerTextColor = isSurveyGroupNoSurveys ? '#999999' : '#0056B3';

            ctx.fillStyle = headerBgColor;
            ctx.fillRect(40, y, 820, 40);
            ctx.fillStyle = headerTextColor;
            ctx.font = 'bold 16px Arial, "Segoe UI Emoji", "Apple Color Emoji"';

            let groupEmoji = '📊';
            if (group === 'Core Performance') groupEmoji = '🎯';
            else if (group === 'Survey') groupEmoji = '📋';
            else if (group === 'Sentiment') groupEmoji = '💬';
            else if (group === 'Reliability') groupEmoji = '⏰';

            let groupLabel;
            if (group === 'Survey') {
                if (metadata.periodType === 'week') {
                    groupLabel = `${groupEmoji} ${group} (${surveyTotal} this week | ${ytdSurveyTotal} YTD)`;
                } else {
                    groupLabel = `${groupEmoji} ${group} (${surveyTotal} this ${periodLabel.toLowerCase()} | ${ytdSurveyTotal} YTD)`;
                }
            } else {
                groupLabel = `${groupEmoji} ${group}`;
            }

            ctx.fillText(groupLabel, 50, y + 26);
            y += 45;
            rowIdx = 0;
        }

        const curr = parseFloat(metrics[key]) || 0;
        const prev = prevMetrics[key] !== undefined ? parseFloat(prevMetrics[key]) : undefined;
        const center = getCenterAverageForMetric(centerAvg, key);
        const target = getMetricTrendTarget(key);
        const ytdValue = ytdEmployee ? ytdEmployee[key] : undefined;

        renderMetricRow(ctx, 40, y, 820, 38, metric, curr, center, ytdValue, target, prev, rowIdx, '', surveyTotal, key, metadata.periodType, ytdSurveyTotal, reviewYear);
        y += 38;
        rowIdx++;
    });

    return y;
}

function drawTrendHighlightsSection(ctx, y, keyWins, improvedMetrics, focusMetrics, periodTypeText, previous) {
    y += 30;

    if (keyWins.length > 0) {
        ctx.fillStyle = '#e8f5e9';
        ctx.fillRect(40, y, 820, 40);
        ctx.fillStyle = '#1b5e20';
        ctx.font = 'bold 18px Arial';
        ctx.fillText('🏆 Key Wins (Meeting Target & Beating Center)', 50, y + 26);
        y += 50;

        keyWins.slice(0, 5).forEach(item => {
            ctx.fillStyle = '#333333';
            ctx.font = 'bold 14px Arial';
            ctx.fillText(`- ${item.label}:`, 60, y + 20);
            ctx.font = '14px Arial';
            ctx.fillText(`${item.curr} (Target: ${item.target}, Center: ${item.center})`, 220, y + 20);
            y += 35;
        });
    }

    if (improvedMetrics.length > 0 || previous) {
        y += 10;
        ctx.fillStyle = '#e3f2fd';
        ctx.fillRect(40, y, 820, 40);
        ctx.fillStyle = '#0d47a1';
        ctx.font = 'bold 18px Arial';
        const periodCapitalized = periodTypeText.charAt(0).toUpperCase() + periodTypeText.slice(1);
        ctx.fillText(`⭐ Highlights (Improved from Last ${periodCapitalized})`, 50, y + 26);
        y += 50;

        if (improvedMetrics.length === 0 && previous) {
            ctx.fillStyle = '#666666';
            ctx.font = '14px Arial';
            ctx.fillText(`- No improvements detected this ${periodTypeText}`, 60, y + 20);
            y += 40;
        } else {
            improvedMetrics.slice(0, 5).forEach(item => {
                ctx.fillStyle = '#333333';
                ctx.font = 'bold 14px Arial';
                ctx.fillText(`- ${item.label}:`, 60, y + 20);
                ctx.font = '14px Arial';
                ctx.fillText(`${item.curr} ${item.arrow} ${item.change} vs last ${periodTypeText}`, 220, y + 20);
                y += 35;
            });
        }
    }

    if (focusMetrics.length > 0) {
        y += 10;
        ctx.fillStyle = '#fff3e0';
        ctx.fillRect(40, y, 820, 40);
        ctx.fillStyle = '#e65100';
        ctx.font = 'bold 18px Arial';
        ctx.fillText('⚠️ Focus Areas (Below Center Average)', 50, y + 26);
        y += 50;

        focusMetrics.slice(0, 5).forEach(item => {
            ctx.fillStyle = '#333333';
            ctx.font = 'bold 14px Arial';
            ctx.fillText(`- ${item.label}:`, 60, y + 20);
            ctx.font = '14px Arial';
            ctx.fillText(`${item.curr} (Center: ${item.center}, Target: ${item.target})`, 220, y + 20);
            y += 35;
        });
    }

    return y;
}

function drawTrendLegendOnCanvas(ctx, y, periodTypeText, options = {}) {
    const {
        includeNoSurveyData = true,
        includeUnavailableState = true
    } = options;

    const legendItems = [
        { color: '#d4edda', label: 'Meets goal' },
        { color: '#fff3cd', label: 'Below goal' },
        { color: '#0056B3', label: 'Above center average' },
        { color: '#DAA520', label: 'Below center average' },
        { color: '#28a745', symbol: '📈', label: `Improved from last ${periodTypeText}` },
        { color: '#dc3545', symbol: '📉', label: `Declined from last ${periodTypeText}` },
        { color: '#6c757d', symbol: '➡️', label: `No change from last ${periodTypeText}` }
    ];

    if (includeNoSurveyData) {
        legendItems.splice(2, 0, { color: '#ffffff', stroke: '#888888', label: 'No survey data (survey metrics)' });
    }

    if (includeUnavailableState) {
        legendItems.splice(includeNoSurveyData ? 5 : 4, 0, { color: '#999999', label: 'Center/trend unavailable' });
    }

    const legendColumns = 3;
    const legendRows = Math.ceil(legendItems.length / legendColumns);
    const legendRowHeight = 32;
    const legendTopPadding = 20;
    const legendBottomPadding = 16;
    const legendHeaderHeight = 30;
    const legendBoxHeight = legendTopPadding + legendHeaderHeight + (legendRows * legendRowHeight) + legendBottomPadding;
    const legendBoxX = 40;
    const legendBoxWidth = 820;
    const legendCellWidth = legendBoxWidth / legendColumns;
    const legendStartX = 50;
    const legendStartY = y + legendTopPadding + legendHeaderHeight;

    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(legendBoxX, y, legendBoxWidth, legendBoxHeight);

    ctx.fillStyle = '#003DA5';
    ctx.font = 'bold 18px Arial';
    ctx.fillText('📋 Legend', 50, y + legendTopPadding + 10);

    legendItems.forEach((item, idx) => {
        const col = idx % legendColumns;
        const row = Math.floor(idx / legendColumns);
        const legendX = legendStartX + (col * legendCellWidth);
        const legendY = legendStartY + (row * legendRowHeight);

        if (item.symbol) {
            ctx.font = '16px Arial';
            ctx.fillStyle = item.color;
            ctx.fillText(item.symbol, legendX, legendY);
            ctx.fillStyle = '#333333';
            ctx.font = '13px Arial';
            ctx.fillText(item.label, legendX + 25, legendY);
        } else {
            ctx.fillStyle = item.color;
            ctx.fillRect(legendX, legendY - 12, 15, 15);
            if (item.stroke) {
                ctx.strokeStyle = item.stroke;
                ctx.lineWidth = 1;
                ctx.strokeRect(legendX, legendY - 12, 15, 15);
            }
            ctx.fillStyle = '#333333';
            ctx.font = '13px Arial';
            ctx.fillText(item.label, legendX + 22, legendY);
        }
    });

    return legendBoxHeight + 10;
}

function drawTrendReliabilityNoteOnCanvas(ctx, y) {
    const noteY = y + 20;
    ctx.fillStyle = '#fff3cd';
    ctx.fillRect(40, noteY, 820, 120);
    ctx.strokeStyle = '#ff9800';
    ctx.lineWidth = 2;
    ctx.strokeRect(40, noteY, 820, 120);

    ctx.fillStyle = '#856404';
    ctx.font = 'bold 16px Arial';
    ctx.fillText('🎯 Reliability Note', 50, noteY + 25);

    ctx.fillStyle = '#333333';
    ctx.font = '13px Arial';
    const note1 = 'Reliability reflects unplanned absences not covered by PTO/ST or pre-scheduled in Verint. If you called in';
    const note2 = 'or were late without using protected time, those hours count against reliability. If you believe this is an';
    const note3 = 'error, check Verint for "Same Day" entries. If you have PTO/ST available and want to apply it, reply to let';
    const note4 = 'me know. Note: Once you reach 16 hours, APS attendance policy takes effect.';

    ctx.fillText(note1, 50, noteY + 50);
    ctx.fillText(note2, 50, noteY + 68);
    ctx.fillText(note3, 50, noteY + 86);
    ctx.fillText(note4, 50, noteY + 104);

    return 150;
}

function buildTrendMetricMaps(metricOrder, current, previous) {
    const metrics = {};
    const prevMetrics = {};

    metricOrder.forEach(({ key }) => {
        if (current?.[key] !== undefined) {
            metrics[key] = current[key];
        }
        if (previous?.[key] !== undefined) {
            prevMetrics[key] = previous[key];
        }
    });

    return { metrics, prevMetrics };
}

function copyTrendImageToClipboardOrDownload(pngBlob, empName, period, onClipboardReady) {
    const reader = new FileReader();
    reader.onload = function(e) {
        const dataUrl = e.target.result;
        const htmlEmail = `<html><body><img src="${dataUrl}" style="max-width: 100%; height: auto;"></body></html>`;

        if (navigator.clipboard && navigator.clipboard.write) {
            const htmlBlob = new Blob([htmlEmail], { type: 'text/html' });
            const htmlClipboardItem = new ClipboardItem({ 'text/html': htmlBlob });
            navigator.clipboard.write([htmlClipboardItem]).then(() => {
                console.log('HTML email with embedded image copied to clipboard');
                showToast('✅ Email with image ready to paste!', 3000);
                if (onClipboardReady) onClipboardReady();
            }).catch(err => {
                console.error('HTML clipboard error:', err);
                navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': pngBlob })
                ]).then(() => {
                    console.log('Image copied to clipboard (HTML failed)');
                    showToast('✅ Image copied to clipboard!', 3000);
                    if (onClipboardReady) onClipboardReady();
                }).catch(err2 => {
                    console.error('Image clipboard error:', err2);
                    downloadImageFallback(pngBlob, empName, period);
                    if (onClipboardReady) onClipboardReady();
                });
            });
        } else {
            console.log('Clipboard API not available, downloading instead');
            downloadImageFallback(pngBlob, empName, period);
            if (onClipboardReady) onClipboardReady();
        }
    };
    reader.readAsDataURL(pngBlob);
}

function calculateTrendSurveyTotals(current, metadata) {
    let surveyTotal = current.surveyTotal ? parseInt(current.surveyTotal, 10) : 0;
    let ytdSurveyTotal = 0;

    if (current?.isTeamAggregate) {
        ytdSurveyTotal = surveyTotal;
        return { surveyTotal, ytdSurveyTotal };
    }

    const currentEndDate = metadata.endDate || '';
    const currentYear = currentEndDate.substring(0, 4);

    if (DEBUG) {
        console.log(`=== YTD SURVEY LOOKUP (${current.name}) for ${metadata.periodType} ===`);
        console.log(`Current period: ${currentEndDate}, year: ${currentYear}`);
    }

    let aggregatedYtdSurveys = 0;
    for (const wk in weeklyData) {
        const weekMeta = weeklyData[wk]?.metadata || {};
        const weekEndDate = weekMeta.endDate || wk.split('|')[1] || '';
        const weekYear = weekEndDate.substring(0, 4);
        const weekPeriodType = weekMeta.periodType || 'week';

        if (weekPeriodType === 'week' && weekYear === currentYear && weekEndDate <= currentEndDate) {
            const weekEmp = weeklyData[wk]?.employees?.find(e => e.name === current.name);
            if (weekEmp && weekEmp.surveyTotal) {
                const weekSurvey = parseInt(weekEmp.surveyTotal, 10);
                aggregatedYtdSurveys += weekSurvey;
                if (DEBUG) console.log(`  Adding ${wk}: +${weekSurvey} surveys (running total: ${aggregatedYtdSurveys})`);
            }
        }
    }

    ytdSurveyTotal = aggregatedYtdSurveys;

    if (metadata.periodType === 'month' || metadata.periodType === 'ytd') {
        surveyTotal = ytdSurveyTotal;
        if (DEBUG) console.log(`${metadata.periodType} aggregated surveys: ${surveyTotal}`);
    }

    if (DEBUG) console.log(`Final: surveyTotal=${surveyTotal}, ytdSurveyTotal=${ytdSurveyTotal}, periodType=${metadata.periodType}`);

    return { surveyTotal, ytdSurveyTotal };
}

function calculateTrendSummaryStats(metricOrder, metrics, prevMetrics, centerAvg, previous, hasSurveys) {
    const surveyMetricKeys = ['cxRepOverall', 'fcr', 'overallExperience'];
    let meetingGoals = 0;
    let improved = 0;
    let beatingCenter = 0;
    let measuredMetricCount = 0;

    metricOrder.forEach(({ key }) => {
        if (metrics[key] === undefined) return;

        if (!hasSurveys && surveyMetricKeys.includes(key)) return;

        measuredMetricCount++;

        const curr = parseFloat(metrics[key]) || 0;
        const target = getMetricTrendTarget(key);
        const center = getCenterAverageForMetric(centerAvg, key);

        if (isMetricMeetingTarget(key, curr, target)) meetingGoals++;

        if (center > 0) {
            const isReverse = isReverseMetric(key);
            if (isReverse ? curr < center : curr > center) {
                beatingCenter++;
            }
        }

        if (previous && prevMetrics[key] !== undefined) {
            const prev = parseFloat(prevMetrics[key]) || 0;
            if (curr > prev) improved++;
        }
    });

    const totalMetrics = measuredMetricCount;
    const successRate = Math.round(meetingGoals / totalMetrics * 100);
    const improvedText = previous ? improved.toString() : 'N/A';

    return {
        meetingGoals,
        improved,
        beatingCenter,
        totalMetrics,
        successRate,
        improvedText
    };
}

function buildTrendHighlightsData(metricOrder, metrics, prevMetrics, centerAvg, previous) {
    const improvedMetrics = [];
    const keyWins = [];
    const focusMetrics = [];

    metricOrder.forEach(({ key }) => {
        if (metrics[key] === undefined) return;
        const metric = METRICS_REGISTRY[key];
        if (!metric) return;

        const curr = parseFloat(metrics[key]) || 0;
        const prev = prevMetrics[key] !== undefined ? parseFloat(prevMetrics[key]) : undefined;
        const center = getCenterAverageForMetric(centerAvg, key);
        const target = getMetricTrendTarget(key);
        const isReverse = isReverseMetric(key);

        if (previous && prev !== undefined && prev !== null) {
            const change = curr - prev;
            const hasImproved = isReverse ? change < 0 : change > 0;

            if (hasImproved && Math.abs(change) > 0.1) {
                const arrow = change > 0 ? '📈' : '📉';
                const changeText = formatMetricDisplay(key, Math.abs(change));
                improvedMetrics.push({
                    label: metric.label,
                    curr: formatMetricDisplay(key, curr),
                    change: changeText,
                    arrow: arrow
                });
            }
        }

        const meetingTarget = isReverse ? curr <= target : curr >= target;
        const beatingCenter = center > 0 && (isReverse ? curr < center : curr > center);
        if (meetingTarget && beatingCenter) {
            keyWins.push({
                label: metric.label,
                curr: formatMetricDisplay(key, curr),
                target: formatMetricDisplay(key, target),
                center: formatMetricDisplay(key, center)
            });
        }

        if (center > 0) {
            const isBelowCenter = isReverse ? curr > center : curr < center;
            if (isBelowCenter) {
                focusMetrics.push({
                    label: metric.label,
                    curr: formatMetricDisplay(key, curr),
                    center: formatMetricDisplay(key, center),
                    target: formatMetricDisplay(key, target)
                });
            }
        }
    });

    return { improvedMetrics, keyWins, focusMetrics };
}

function downloadImageFallback(blob, empName, period) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const periodMetadata = period.metadata || {};
    a.download = `TrendReport_${empName}_${periodMetadata.startDate || 'unknown'}.png`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('ℹ️ Image downloaded!', 4000);
}

function drawEmailCard(ctx, x, y, w, h, bgColor, borderColor, title, mainText, subText) {
    // Card background
    ctx.fillStyle = bgColor;
    ctx.fillRect(x, y, w, h);
    
    // Border
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);

    // Text
    ctx.fillStyle = '#333';
    ctx.font = 'bold 14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(title, x + w/2, y + 30);
    
    ctx.font = 'bold 40px Arial';
    ctx.fillText(mainText, x + w/2, y + 75);
    
    ctx.font = '13px Arial';
    ctx.fillStyle = '#666';
    ctx.fillText(subText, x + w/2, y + 100);
    
    ctx.textAlign = 'left';
}

function wrapCanvasTextLines(ctx, text, maxWidth) {
    const safeText = String(text || '').trim();
    if (!safeText) return [''];

    const words = safeText.split(/\s+/);
    const lines = [];
    let currentLine = '';

    words.forEach(word => {
        const candidate = currentLine ? `${currentLine} ${word}` : word;
        if (ctx.measureText(candidate).width <= maxWidth) {
            currentLine = candidate;
        } else {
            if (currentLine) lines.push(currentLine);
            currentLine = word;
        }
    });

    if (currentLine) lines.push(currentLine);
    return lines.length > 0 ? lines : [''];
}

function drawTrendSummaryBoxesOnCanvas(ctx, x, y, totalWidth, positiveHighlights, improvementAreas, positiveEmptyText, improvementEmptyText) {
    const gap = 16;
    const boxWidth = (totalWidth - gap) / 2;
    const leftX = x;
    const rightX = x + boxWidth + gap;
    const padding = 14;
    const titleHeight = 24;
    const lineHeight = 21;
    const maxTextWidth = boxWidth - (padding * 2) - 8;

    const buildLines = (items, emptyText) => {
        const source = Array.isArray(items) && items.length > 0 ? items : [emptyText || 'No items.'];
        const lines = [];
        source.forEach(item => {
            const wrapped = wrapCanvasTextLines(ctx, `• ${item}`, maxTextWidth);
            wrapped.forEach(line => lines.push(line));
        });
        return lines;
    };

    ctx.font = '12px Arial';
    const positiveLines = buildLines(positiveHighlights, positiveEmptyText);
    const improvementLines = buildLines(improvementAreas, improvementEmptyText);
    const maxLines = Math.max(positiveLines.length, improvementLines.length, 1);
    const boxHeight = padding + titleHeight + 8 + (maxLines * lineHeight) + padding;

    // Positive box
    ctx.fillStyle = '#e8f5e9';
    ctx.strokeStyle = '#81c784';
    ctx.lineWidth = 1;
    ctx.fillRect(leftX, y, boxWidth, boxHeight);
    ctx.strokeRect(leftX, y, boxWidth, boxHeight);

    ctx.fillStyle = '#2e7d32';
    ctx.font = 'bold 18px Arial';
    ctx.fillText('✅', leftX + padding, y + padding + 18);
    ctx.font = 'bold 24px Arial';
    ctx.fillText('Positive Highlights', leftX + padding + 34, y + padding + 18);

    ctx.fillStyle = '#1b5e20';
    ctx.font = '12px Arial';
    positiveLines.forEach((line, index) => {
        ctx.fillText(line, leftX + padding, y + padding + titleHeight + 16 + (index * lineHeight));
    });

    // Improvement box
    ctx.fillStyle = '#ffebee';
    ctx.strokeStyle = '#ef9a9a';
    ctx.lineWidth = 1;
    ctx.fillRect(rightX, y, boxWidth, boxHeight);
    ctx.strokeRect(rightX, y, boxWidth, boxHeight);

    ctx.fillStyle = '#c62828';
    ctx.font = 'bold 18px Arial';
    ctx.fillText('⚠️', rightX + padding, y + padding + 18);
    ctx.font = 'bold 24px Arial';
    ctx.fillText('Improvement Areas', rightX + padding + 34, y + padding + 18);

    ctx.fillStyle = '#b71c1c';
    ctx.font = '12px Arial';
    improvementLines.forEach((line, index) => {
        ctx.fillText(line, rightX + padding, y + padding + titleHeight + 16 + (index * lineHeight));
    });

    return boxHeight;
}

function getMetricTarget(metric, reviewYear = null) {
    const profileModule = getMetricProfilesModule();

    const parsedYear = parseInt(reviewYear, 10);
    if (Number.isInteger(parsedYear)) {
        const yearTarget = profileModule?.getYearTarget
            ? profileModule.getYearTarget(metric, parsedYear)
            : YEAR_END_TARGETS_BY_YEAR[parsedYear]?.[metric];
        if (yearTarget && yearTarget.value !== undefined && yearTarget.value !== null) {
            return yearTarget.value;
        }
    }

    // PHASE 3 - Use METRICS_REGISTRY as default source of truth
    const metricDef = METRICS_REGISTRY[metric];
    if (metricDef && metricDef.target) {
        return metricDef.target.value;
    }

    return 90; // Safe fallback
}

function getMetricTrendTarget(metricKey) {
    const metricDef = METRICS_REGISTRY[metricKey];
    if (metricDef?.target && metricDef.target.value !== undefined && metricDef.target.value !== null) {
        return metricDef.target.value;
    }
    return getMetricTarget(metricKey, null);
}

function getMetricTrendTargetType(metricKey) {
    return METRICS_REGISTRY[metricKey]?.target?.type || 'min';
}

function formatMetricValue(key, value) {
    const metric = METRICS_REGISTRY[key];
    if (!metric) return value.toFixed(1);
    
    if (metric.unit === 'sec') {
        // Seconds - no decimal points
        return Math.round(value).toString();
    } else if (metric.unit === '%') {
        // Percentages - one decimal point
        return value.toFixed(1);
    } else if (metric.unit === 'hrs') {
        // Hours - one decimal point (not rounded to whole number)
        return value.toFixed(1);
    } else {
        // Raw numbers - no decimal points
        return Math.round(value).toString();
    }
}

function formatMetricDisplay(key, value) {
    const metric = METRICS_REGISTRY[key];
    if (!metric) return value.toString();
    
    const formatted = formatMetricValue(key, value);
    
    if (metric.unit === 'sec') {
        return `${formatted}s`;
    } else if (metric.unit === '%') {
        return `${formatted}%`;
    } else if (metric.unit === 'hrs') {
        return `${formatted} hrs`;
    } else {
        return formatted;
    }
}

function getCenterAverageForMetric(centerAvg, metricKey) {
    // Map metric keys to center average keys
    const keyMapping = {
        scheduleAdherence: 'adherence',
        overallSentiment: 'sentiment',
        cxRepOverall: 'repSatisfaction'
    };
    
    const lookupKey = keyMapping[metricKey] || metricKey;
    return parseFloat(centerAvg[lookupKey]) || 0;
}

function parseIsoDateSafe(dateText) {
    if (!dateText || typeof dateText !== 'string') return null;
    const parts = dateText.split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    const [year, month, day] = parts;
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function buildYtdAggregateForYear(year, uptoEndDateText) {
    const yearNum = parseInt(year, 10);
    const uptoEndDate = parseIsoDateSafe(uptoEndDateText);
    if (!Number.isInteger(yearNum) || !uptoEndDate) return null;

    const sourcePeriods = Object.entries(weeklyData || {})
        .map(([periodKey, period]) => {
            const metadata = period?.metadata || {};
            const periodType = metadata.periodType || 'week';
            const endDateText = metadata.endDate || (periodKey.includes('|') ? periodKey.split('|')[1] : '');
            const endDate = parseIsoDateSafe(endDateText);
            return { periodKey, period, metadata, periodType, endDateText, endDate };
        })
        .filter(item => {
            if (!item.endDate) return false;
            if (!['week', 'month', 'quarter'].includes(item.periodType)) return false;
            if (item.endDate.getFullYear() !== yearNum) return false;
            return item.endDate <= uptoEndDate;
        })
        .sort((a, b) => a.endDate - b.endDate);

    if (!sourcePeriods.length) return null;

    const sourceType = sourcePeriods.some(item => item.periodType === 'week')
        ? 'week'
        : (sourcePeriods.some(item => item.periodType === 'month') ? 'month' : 'quarter');
    const selectedPeriods = sourcePeriods.filter(item => item.periodType === sourceType);
    if (!selectedPeriods.length) return null;

    const metricKeysToAverage = [
        'scheduleAdherence', 'transfers', 'cxRepOverall', 'fcr', 'overallExperience',
        'aht', 'talkTime', 'acw', 'holdTime', 'overallSentiment', 'managingEmotions',
        'negativeWord', 'positiveWord'
    ];
    const surveyWeightedMetrics = new Set(['cxRepOverall', 'fcr', 'overallExperience']);

    const aggregatedEmployees = {};

    selectedPeriods.forEach(({ period }) => {
        (period?.employees || []).forEach(emp => {
            if (!emp?.name) return;

            if (!aggregatedEmployees[emp.name]) {
                aggregatedEmployees[emp.name] = {
                    name: emp.name,
                    firstName: emp.firstName,
                    transfersCount: 0,
                    surveyTotal: 0,
                    reliability: 0,
                    totalCalls: 0,
                    weightedSums: {},
                    weightedCounts: {}
                };
            }

            const agg = aggregatedEmployees[emp.name];
            const surveyTotal = parseInt(emp.surveyTotal, 10);
            const totalCalls = parseInt(emp.totalCalls, 10);

            agg.transfersCount += Number.isFinite(parseFloat(emp.transfersCount)) ? parseFloat(emp.transfersCount) : 0;
            agg.surveyTotal += Number.isInteger(surveyTotal) ? surveyTotal : 0;
            agg.reliability += Number.isFinite(parseFloat(emp.reliability)) ? parseFloat(emp.reliability) : 0;
            agg.totalCalls += Number.isInteger(totalCalls) ? totalCalls : 0;

            metricKeysToAverage.forEach(metricKey => {
                const metricValue = parseFloat(emp[metricKey]);
                if (!Number.isFinite(metricValue)) return;

                let weight = 1;
                if (surveyWeightedMetrics.has(metricKey)) {
                    weight = Number.isInteger(surveyTotal) && surveyTotal > 0 ? surveyTotal : 0;
                } else {
                    weight = Number.isInteger(totalCalls) && totalCalls > 0 ? totalCalls : 1;
                }
                if (weight <= 0) return;

                agg.weightedSums[metricKey] = (agg.weightedSums[metricKey] || 0) + (metricValue * weight);
                agg.weightedCounts[metricKey] = (agg.weightedCounts[metricKey] || 0) + weight;
            });
        });
    });

    Object.keys(aggregatedEmployees).forEach(name => {
        const agg = aggregatedEmployees[name];
        metricKeysToAverage.forEach(metricKey => {
            const totalWeight = agg.weightedCounts[metricKey] || 0;
            if (totalWeight > 0) {
                agg[metricKey] = agg.weightedSums[metricKey] / totalWeight;
            }
        });
        delete agg.weightedSums;
        delete agg.weightedCounts;
    });

    const ytdStartText = `${yearNum}-01-01`;
    const ytdKey = `${ytdStartText}|${uptoEndDateText}`;
    const endDateObj = parseIsoDateSafe(uptoEndDateText);
    const ytdLabel = endDateObj
        ? `YTD through ${endDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`
        : `YTD through ${uptoEndDateText}`;

    return {
        key: ytdKey,
        entry: {
            employees: Object.values(aggregatedEmployees),
            metadata: {
                startDate: ytdStartText,
                endDate: uptoEndDateText,
                label: ytdLabel,
                periodType: 'ytd',
                autoGeneratedYtd: true,
                sourcePeriodType: sourceType,
                yearEndTargetProfile: 'auto',
                yearEndReviewYear: String(yearNum),
                uploadedAt: new Date().toISOString()
            }
        }
    };
}

function upsertAutoYtdForYear(year, uptoEndDateText) {
    const aggregate = buildYtdAggregateForYear(year, uptoEndDateText);
    if (!aggregate) return;

    const yearNum = parseInt(year, 10);
    Object.keys(ytdData || {}).forEach(existingKey => {
        const existing = ytdData[existingKey];
        const metadata = existing?.metadata || {};
        if (!metadata.autoGeneratedYtd) return;
        const existingEndDateText = metadata.endDate || (existingKey.includes('|') ? existingKey.split('|')[1] : '');
        const existingEndDate = parseIsoDateSafe(existingEndDateText);
        if (!existingEndDate) return;
        if (existingEndDate.getFullYear() === yearNum) {
            delete ytdData[existingKey];
        }
    });

    ytdData[aggregate.key] = aggregate.entry;
}

function getYtdPeriodForWeekKey(weekKey) {
    if (!weekKey) return null;
    const parts = weekKey.split('|');
    const endDate = parts[1] || '';
    if (!endDate) return null;
    
    // First, try to find explicit YTD data
    const matchingKey = Object.keys(ytdData).find(key => {
        const metadataEndDate = ytdData[key]?.metadata?.endDate;
        return (metadataEndDate && metadataEndDate === endDate) || key.split('|')[1] === endDate;
    });
    if (matchingKey) {
        return ytdData[matchingKey];
    }

    // If no explicit YTD data, calculate from uploaded periods up to this end date
    const yearNum = parseInt(endDate.split('-')[0], 10);
    if (!Number.isInteger(yearNum)) return null;
    const aggregate = buildYtdAggregateForYear(yearNum, endDate);
    return aggregate ? aggregate.entry : null;
}



function isMetricMeetingTarget(metric, value, target) {
    // PHASE 3 - Use METRICS_REGISTRY target type
    const metricDef = METRICS_REGISTRY[metric];
    if (metricDef && metricDef.target) {
        return metricDef.target.type === 'min' ? value >= target : value <= target;
    }
    // Fallback: assume 'min' type
    return value >= target;
}

function buildTrendHighlightsAndImprovements(allTrendMetrics) {
    const safeMetrics = Array.isArray(allTrendMetrics) ? allTrendMetrics : [];
    const positiveHighlights = [];
    const improvementAreas = [];

    safeMetrics.forEach(metric => {
        if (!metric || !metric.metricKey || metric.employeeValue === undefined || metric.target === undefined) {
            return;
        }

        const currentDisplay = formatMetricDisplay(metric.metricKey, metric.employeeValue);
        const targetDisplay = formatMetricDisplay(metric.metricKey, metric.target);
        const line = `${metric.label}: ${currentDisplay} vs target ${targetDisplay}`;

        if (metric.meetsTarget) {
            positiveHighlights.push(line);
        } else {
            improvementAreas.push(line);
        }
    });

    return { positiveHighlights, improvementAreas };
}

function renderTrendSummaryBoxesHtml(positiveHighlights, improvementAreas, positiveEmptyText, improvementEmptyText) {
    const renderListItems = (items) => items.map(item => `<li style="margin: 0 0 6px 0;">${escapeHtml(item)}</li>`).join('');

    const positiveHtml = positiveHighlights.length > 0
        ? `<ul style="margin: 0; padding-left: 20px;">${renderListItems(positiveHighlights)}</ul>`
        : `<p style="margin: 0; color: #2e7d32;">${escapeHtml(positiveEmptyText || 'No above-target metrics in this period.')}</p>`;

    const improvementHtml = improvementAreas.length > 0
        ? `<ul style="margin: 0; padding-left: 20px;">${renderListItems(improvementAreas)}</ul>`
        : `<p style="margin: 0; color: #b71c1c;">${escapeHtml(improvementEmptyText || 'No below-target metrics in this period.')}</p>`;

    return `
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0 20px 0;">
            <div style="padding: 14px; border: 1px solid #81c784; border-radius: 8px; background: #e8f5e9; color: #1b5e20;">
                <h4 style="margin: 0 0 10px 0; color: #2e7d32;">✅ Positive Highlights</h4>
                ${positiveHtml}
            </div>
            <div style="padding: 14px; border: 1px solid #ef9a9a; border-radius: 8px; background: #ffebee; color: #b71c1c;">
                <h4 style="margin: 0 0 10px 0; color: #b71c1c;">⚠️ Improvement Areas</h4>
                ${improvementHtml}
            </div>
        </div>
    `;
}

function buildTeamTrendCoachingPrompt(periodLabel, teamMetrics, teamSize) {
    const { positiveHighlights, improvementAreas } = buildTrendHighlightsAndImprovements(teamMetrics);
    let prompt = `Draft a concise team coaching update for ${periodLabel}.\n`;
    prompt += `Audience: the full team (${teamSize} associates in this data set).\n\n`;

    prompt += `POSITIVE HIGHLIGHTS:\n`;
    if (positiveHighlights.length > 0) {
        positiveHighlights.forEach(line => {
            prompt += `- ${line}\n`;
        });
    } else {
        prompt += `- No above-target metrics in this period.\n`;
    }
    prompt += `\n`;

    prompt += `IMPROVEMENT AREAS:\n`;
    if (improvementAreas.length > 0) {
        improvementAreas.forEach(line => {
            prompt += `- ${line}\n`;
        });
    } else {
        prompt += `- No below-target metrics in this period.\n`;
    }
    prompt += `\n`;

    prompt += `Write in a warm, motivational tone. Keep it factual, avoid fluff, and end with 2-3 team actions for next period.`;
    return prompt;
}

function getFilteredEmployeesForPeriod(period, context = null) {
    if (!period || !Array.isArray(period.employees)) return [];

    const teamFilterContext = context || getTeamSelectionContext();
    return period.employees.filter(emp => isAssociateIncludedByTeamFilter(emp?.name, teamFilterContext));
}

function collectTeamTrendMetrics(period) {
    const teamFilterContext = getTeamSelectionContext();
    const filteredEmployees = getFilteredEmployeesForPeriod(period, teamFilterContext);
    if (!filteredEmployees.length) return [];

    const teamMetrics = [];

    getMetricOrder().forEach(({ key }) => {
        const metricDef = METRICS_REGISTRY[key];
        if (!metricDef) return;

        const values = filteredEmployees
            .map(emp => parseFloat(emp[key]))
            .filter(value => !Number.isNaN(value));

        if (values.length === 0) return;

        const teamValue = values.reduce((sum, value) => sum + value, 0) / values.length;
        const target = getMetricTrendTarget(key);
        const targetType = getMetricTrendTargetType(key);
        const meetsTarget = targetType === 'min' ? teamValue >= target : teamValue <= target;

        teamMetrics.push({
            metricKey: key,
            label: metricDef.label,
            employeeValue: teamValue,
            target,
            targetType,
            meetsTarget,
            gapFromTarget: targetType === 'min'
                ? Math.max(0, target - teamValue)
                : Math.max(0, teamValue - target)
        });
    });

    return teamMetrics;
}

function buildTeamTrendAggregateEmployee(period) {
    if (!period || !Array.isArray(period.employees) || period.employees.length === 0) {
        return null;
    }

    const teamFilterContext = getTeamSelectionContext();
    const filteredEmployees = getFilteredEmployeesForPeriod(period, teamFilterContext);
    if (!filteredEmployees.length) return null;

    const aggregate = { name: 'Team Combined', isTeamAggregate: true };

    getMetricOrder().forEach(({ key }) => {
        const values = filteredEmployees
            .map(emp => parseFloat(emp?.[key]))
            .filter(value => !Number.isNaN(value));

        if (values.length === 0) {
            return;
        }

        aggregate[key] = values.reduce((sum, value) => sum + value, 0) / values.length;
    });

    const totalSurveyCount = filteredEmployees
        .map(emp => {
            const surveyTotal = parseFloat(emp?.surveyTotal);
            if (!Number.isNaN(surveyTotal)) {
                return surveyTotal;
            }
            return parseFloat(emp?.surveysOffered);
        })
        .filter(value => !Number.isNaN(value))
        .reduce((sum, value) => sum + value, 0);

    if (totalSurveyCount > 0) {
        aggregate.surveyTotal = totalSurveyCount;
    }

    const totalCalls = filteredEmployees
        .map(emp => parseFloat(emp?.totalCalls))
        .filter(value => !Number.isNaN(value))
        .reduce((sum, value) => sum + value, 0);

    if (totalCalls > 0) {
        aggregate.totalCalls = totalCalls;
    }

    return aggregate;
}

function createTeamTrendSummaryModal() {
    const modal = document.createElement('div');
    modal.id = 'teamTrendSummaryModal';
    modal.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 10000;
    `;
    return modal;
}

function createTeamTrendSummaryPanel(periodLabel, teamSize, summaryBoxesHtml, teamPrompt) {
    const panel = document.createElement('div');
    panel.style.cssText = `
        background: white;
        border-radius: 8px;
        padding: 24px;
        max-width: 900px;
        width: 92%;
        max-height: 88vh;
        overflow-y: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    `;

    panel.innerHTML = `
        <h3 style="color: #2e7d32; margin-top: 0;">👥 Team Metric Trend Summary</h3>
        <p style="color: #666; margin-bottom: 6px; font-size: 0.95em;">${escapeHtml(periodLabel)}</p>
        <p style="color: #666; margin: 0 0 14px 0; font-size: 0.9em;">Based on ${teamSize} associates</p>

        ${summaryBoxesHtml}

        <div style="margin: 20px 0; padding: 15px; background: #f5f5f5; border-radius: 4px; border: 1px solid #ddd;">
            <h4 style="color: #333; margin-top: 0;">🤖 Team CoPilot Prompt</h4>
            <textarea id="teamTrendPromptDisplay" readonly style="width: 100%; height: 180px; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-family: 'Courier New', monospace; font-size: 0.85em; background: white; color: #333;">${teamPrompt}</textarea>
        </div>

        <div style="display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap;">
            <button id="copyTeamTrendPromptBtn" style="flex: 1; min-width: 180px; padding: 12px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">📋 Copy Prompt</button>
            <button id="openTeamTrendEmailBtn" style="flex: 1; min-width: 180px; padding: 12px; background: #2e7d32; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">📧 Open Team Email Draft</button>
            <button id="closeTeamTrendSummaryBtn" style="flex: 1; min-width: 180px; padding: 12px; background: #777; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;">Close</button>
        </div>
    `;

    return panel;
}

function attachTeamTrendSummaryModalHandlers(modal, teamSubject, weekKey, period) {
    const closeModal = () => {
        if (document.body.contains(modal)) {
            document.body.removeChild(modal);
        }
    };

    document.getElementById('copyTeamTrendPromptBtn')?.addEventListener('click', () => {
        const textarea = document.getElementById('teamTrendPromptDisplay');
        textarea.select();
        document.execCommand('copy');
        showToast('✅ Team prompt copied', 2000);
        window.open('https://copilot.microsoft.com', '_blank');
    });

    document.getElementById('openTeamTrendEmailBtn')?.addEventListener('click', () => {
        const currentTeam = buildTeamTrendAggregateEmployee(period);
        if (!currentTeam) {
            showToast('No team data available to build email image', 4000);
            return;
        }

        const periodType = period?.metadata?.periodType || 'week';
        const prevPeriodKey = getPreviousPeriodData(weekKey, periodType);
        const prevPeriod = prevPeriodKey ? weeklyData[prevPeriodKey] : null;
        const previousTeam = buildTeamTrendAggregateEmployee(prevPeriod);

        showToast('ℹ️ Creating team email image...', 3000);
        createTrendEmailImage('Team', weekKey, period, currentTeam, previousTeam, () => {
            openTrendEmailOutlook(teamSubject);
            showToast('📧 Outlook opening... Team image is copied to clipboard. Paste into email body.', 4500);
        });
    });

    document.getElementById('closeTeamTrendSummaryBtn')?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
}

function generateTeamTrendSummary() {
    const weekKey = document.getElementById('trendPeriodSelect')?.value;
    if (!weekKey) {
        showToast('Please select a period first', 5000);
        return;
    }

    const period = weeklyData[weekKey];
    if (!period || !Array.isArray(period.employees) || period.employees.length === 0) {
        showToast('Team summary currently supports weekly data with employees', 5000);
        return;
    }

    const teamFilterContext = getTeamSelectionContext();
    const filteredEmployees = getFilteredEmployeesForPeriod(period, teamFilterContext);
    if (!filteredEmployees.length) {
        showToast('No checked team members found for this period', 5000);
        return;
    }

    const periodMeta = period.metadata || {};
    const reviewYear = parseInt((periodMeta.endDate || '').split('-')[0], 10) || null;
    const teamMetrics = collectTeamTrendMetrics(period);

    if (teamMetrics.length === 0) {
        showToast('No team metrics found for this period', 5000);
        return;
    }

    const { positiveHighlights, improvementAreas } = buildTrendHighlightsAndImprovements(teamMetrics);
    const summaryBoxesHtml = renderTrendSummaryBoxesHtml(
        positiveHighlights,
        improvementAreas,
        'No above-target team metrics in this period.',
        'No below-target team metrics in this period.'
    );

    const periodLabel = periodMeta.label || (periodMeta.endDate ? `Week ending ${formatDateMMDDYYYY(periodMeta.endDate)}` : 'this period');
    const teamPrompt = buildTeamTrendCoachingPrompt(periodLabel, teamMetrics, filteredEmployees.length);
    const teamSubject = `Trending Metrics - Team Summary - Week ending ${periodMeta.endDate || ''}`;

    const modal = createTeamTrendSummaryModal();
    const panel = createTeamTrendSummaryPanel(periodLabel, filteredEmployees.length, summaryBoxesHtml, teamPrompt);

    modal.appendChild(panel);
    document.body.appendChild(modal);
    attachTeamTrendSummaryModalHandlers(modal, teamSubject, weekKey, period);
}


function generateAllTrendEmails() {
    const weekKey = document.getElementById('trendPeriodSelect')?.value;
    if (!weekKey) {
        showToast('Please select a period first', 5000);
        return;
    }
    
    const week = weeklyData[weekKey];
    if (!week || !week.employees || week.employees.length === 0) {
        showToast('No data found for this period', 5000);
        return;
    }
    
    const teamFilterContext = getTeamSelectionContext();
    const employeeNames = week.employees
        .filter(emp => isAssociateIncludedByTeamFilter(emp?.name, teamFilterContext))
        .map(emp => emp.name)
        .filter(Boolean);
    if (employeeNames.length === 0) {
        showToast('No checked team members found for this period', 5000);
        return;
    }
    
    showToast('Opening drafts for all associates... Please allow pop-ups.', 6000);
    
    employeeNames.forEach((name, index) => {
        setTimeout(() => {
            // Batch email generation using canvas-based email system
            generateTrendEmail(name, weekKey);
        }, index * 500);
    });
}

// ============================================
// YEARLY AVERAGE CALCULATIONS
// ============================================

function getYearlyAverageForEmployee(employeeName, metricKey) {
    /**
     * Calculate employee's yearly average (Jan 1 - current date) for a specific metric
     * Returns: { value: number, count: number } or null if no data
     */
    const currentYear = new Date().getFullYear();
    
    const sums = {};
    const counts = {};
    
    Object.entries(weeklyData).forEach(([weekKey, weekData]) => {
        const [startDateStr, endDateStr] = weekKey.split('|');
        const [endYear] = endDateStr.split('-').map(Number);
        
        // Only include data from current year up to today
        if (endYear === currentYear) {
            weekData.employees?.forEach(emp => {
                if (emp.name === employeeName) {
                    const value = parseFloat(emp[metricKey]);
                    if (!isNaN(value)) {
                        sums[metricKey] = (sums[metricKey] || 0) + value;
                        counts[metricKey] = (counts[metricKey] || 0) + 1;
                    }
                }
            });
        }
    });
    
    if (counts[metricKey] && counts[metricKey] > 0) {
        return {
            value: parseFloat((sums[metricKey] / counts[metricKey]).toFixed(2)),
            count: counts[metricKey]
        };
    }
    
    return null;
}

function getPreviousPeriodData(currentWeekKey, periodType) {
    /**
     * Find the previous period's data based on period type
     * Returns: weekKey of previous period or null
     */
    const [startStr, endStr] = currentWeekKey.split('|');
    const [endYear, endMonth, endDay] = endStr.split('-').map(Number);
    const endDate = new Date(endYear, endMonth - 1, endDay);
    
    let previousPeriodEnd = null;
    
    if (periodType === 'week') {
        // Previous week = 7 days back
        previousPeriodEnd = new Date(endDate);
        previousPeriodEnd.setDate(previousPeriodEnd.getDate() - 7);
    } else if (periodType === 'month') {
        // Previous month = 1st of previous month to 1st of current month - 1 day
        previousPeriodEnd = new Date(endYear, endMonth - 2, endDay);
    } else if (periodType === 'quarter') {
        // Previous quarter = same day, 3 months back
        previousPeriodEnd = new Date(endDate);
        previousPeriodEnd.setMonth(previousPeriodEnd.getMonth() - 3);
    } else if (periodType === 'ytd') {
        // YTD doesn't have a "previous" in the same sense
        return null;
    }
    
    if (!previousPeriodEnd) return null;
    
    const prevEndStr = `${previousPeriodEnd.getFullYear()}-${String(previousPeriodEnd.getMonth() + 1).padStart(2, '0')}-${String(previousPeriodEnd.getDate()).padStart(2, '0')}`;
    
    // Find matching period in weeklyData (must match period type)
    for (const key of Object.keys(weeklyData).sort().reverse()) {
        if (!key.includes(prevEndStr)) continue;
        const metadata = weeklyData[key]?.metadata || {};
        const keyPeriodType = metadata.periodType || 'week';
        if (keyPeriodType !== periodType) continue;
        return key;
    }
    
    return null;
}


// ============================================
// EXECUTIVE SUMMARY
// ============================================

function getExecutiveSummaryActiveYear(allWeeks) {
    const years = allWeeks.map(weekKey => {
        const metadataEndDate = weeklyData[weekKey]?.metadata?.endDate;
        const fallbackEndDate = weekKey.includes('|') ? weekKey.split('|')[1] : '';
        const endDateText = metadataEndDate || fallbackEndDate;
        const parsedYear = parseInt(String(endDateText || '').slice(0, 4), 10);
        return Number.isInteger(parsedYear) ? parsedYear : null;
    }).filter(Number.isInteger);

    return years.length ? Math.max(...years) : new Date().getFullYear();
}

function buildExecutiveSummaryAggregateMetrics(allWeeks, selectedAssociate = '') {
    const metricKeys = getMetricOrder().map(item => item.key);
    const activeYear = getExecutiveSummaryActiveYear(allWeeks);
    const metrics = {
        totalWeeks: 0,
        totalEmployees: new Set(),
        averagesByMetric: {},
        activeYear,
        selectedAssociate
    };

    metricKeys.forEach(metricKey => {
        metrics.averagesByMetric[metricKey] = [];
    });

    const teamFilterContext = getTeamSelectionContext();

    allWeeks.forEach(weekKey => {
        const week = weeklyData[weekKey];
        if (!week || !week.employees) return;

        const metadataEndDate = week?.metadata?.endDate;
        const fallbackEndDate = weekKey.includes('|') ? weekKey.split('|')[1] : '';
        const endDateText = metadataEndDate || fallbackEndDate;
        const endYear = parseInt(String(endDateText || '').slice(0, 4), 10);
        if (!Number.isInteger(endYear) || endYear !== activeYear) return;

        metrics.totalWeeks += 1;

        week.employees.forEach(emp => {
            if (!emp?.name) return;
            if (selectedAssociate && emp.name !== selectedAssociate) return;
            if (!isAssociateIncludedByTeamFilter(emp.name, teamFilterContext)) return;

            metrics.totalEmployees.add(emp.name);

            metricKeys.forEach(metricKey => {
                const value = parseFloat(emp[metricKey]);
                if (!Number.isFinite(value)) return;
                metrics.averagesByMetric[metricKey].push(value);
            });
        });
    });

    return metrics;
}

function calculateExecutiveSummaryAverages(metrics) {
    const averages = {};
    Object.keys(metrics.averagesByMetric || {}).forEach(metricKey => {
        const values = metrics.averagesByMetric[metricKey] || [];
        if (!values.length) {
            averages[metricKey] = null;
            return;
        }
        averages[metricKey] = values.reduce((sum, value) => sum + value, 0) / values.length;
    });
    return averages;
}

function getExecutiveSummaryMetricCardStyle(metricKey, averageValue, reviewYear) {
    const neutralStyle = {
        background: 'linear-gradient(135deg, #90a4ae 0%, #78909c 100%)',
        textColor: '#ffffff'
    };

    if (!Number.isFinite(averageValue)) return neutralStyle;

    const onOffMetrics = new Set(['aht', 'scheduleAdherence', 'overallSentiment', 'cxRepOverall', 'reliability']);
    if (onOffMetrics.has(metricKey)) {
        const score = getYearEndOnOffScoreOrFallback(metricKey, averageValue, reviewYear);
        if (score === 3) return { background: 'linear-gradient(135deg, #2e7d32 0%, #43a047 100%)', textColor: '#ffffff' };
        if (score === 2) return { background: 'linear-gradient(135deg, #f0de87 0%, #e6c65a 100%)', textColor: '#222222' };
        if (score === 1) return { background: 'linear-gradient(135deg, #c62828 0%, #ef5350 100%)', textColor: '#ffffff' };
    }

    if (metricMeetsTarget(metricKey, averageValue)) {
        return { background: 'linear-gradient(135deg, #2e7d32 0%, #43a047 100%)', textColor: '#ffffff' };
    }

    const gap = Math.abs(metricGapToTarget(metricKey, averageValue));
    const threshold = getTrendDeltaThreshold(metricKey)?.value || 0;
    if (threshold > 0 && gap <= threshold) {
        return { background: 'linear-gradient(135deg, #f0de87 0%, #e6c65a 100%)', textColor: '#222222' };
    }

    return { background: 'linear-gradient(135deg, #c62828 0%, #ef5350 100%)', textColor: '#ffffff' };
}

function buildExecutiveSummaryCards(metrics, averages) {
    const reviewYear = metrics.activeYear || new Date().getFullYear();
    const metricCards = getMetricOrder().map(({ key }) => {
        const metricDef = METRICS_REGISTRY[key];
        if (!metricDef) return null;

        const averageValue = averages[key];
        const style = getExecutiveSummaryMetricCardStyle(key, averageValue, reviewYear);

        return {
            label: `Avg ${metricDef.label}`,
            value: Number.isFinite(averageValue) ? formatMetricDisplay(key, averageValue) : 'N/A',
            icon: '📈',
            ...style
        };
    }).filter(Boolean);

    return [
        { label: 'Total Data Periods', value: metrics.totalWeeks, icon: '📊' },
        { label: 'Total Employees', value: metrics.totalEmployees.size, icon: '👥' },
        ...metricCards
    ].map(card => ({
        background: card.background || 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        textColor: card.textColor || '#ffffff',
        ...card
    }));
}

function renderExecutiveSummaryCardsHtml(cards) {
    return cards.map(card => `
            <div style="padding: 20px; background: ${card.background}; color: ${card.textColor}; border-radius: 8px; text-align: center;">
                <div style="font-size: 2em; margin-bottom: 8px;">${card.icon}</div>
                <div style="font-size: 1.8em; font-weight: bold; margin-bottom: 4px;">${card.value}</div>
                <div style="font-size: 0.9em; opacity: 0.9;">${card.label}</div>
            </div>
        `).join('');
}

function renderExecutiveSummary() {
    const container = document.getElementById('executiveSummaryContainer');
    if (!container) return;
    
    const allWeeks = Object.keys(weeklyData);
    
    if (allWeeks.length === 0) {
        container.innerHTML = '<p style="color: #666; font-style: italic;">No data uploaded yet. Upload some weekly data to see the executive summary!</p>';
        return;
    }

    const selectedAssociate = document.getElementById('summaryAssociateSelect')?.value || '';
    const metrics = buildExecutiveSummaryAggregateMetrics(allWeeks, selectedAssociate);
    const averages = calculateExecutiveSummaryAverages(metrics);
    const cards = buildExecutiveSummaryCards(metrics, averages);
    
    let html = '<div style="margin-bottom: 30px;">';
    const scopeLabel = selectedAssociate
        ? `Performance Overview — ${escapeHtml(selectedAssociate)} (${metrics.activeYear} YTD)`
        : `Performance Overview (${metrics.activeYear} YTD)`;
    html += `<h3>${scopeLabel}</h3>`;
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 20px;">';
    html += renderExecutiveSummaryCardsHtml(cards);
    
    html += '</div></div>';
    
    container.innerHTML = html;
    renderSupervisorIntelligence();
    
    // Initialize the new yearly individual summary section
    initializeYearlyIndividualSummary();
}

function handleExecutiveSummaryAssociateChange() {
    renderExecutiveSummary();
    loadExecutiveSummaryData();
    renderYearlySummaryTrendCharts();
    syncOneOnOneAssociateSelect();
}

function initializeYearlyIndividualSummary() {
    
    populateExecutiveSummaryAssociate();
    populateOneOnOneAssociateSelect();
    
    // Period type is always YTD for executive summary
    const summaryAssociateSelect = document.getElementById('summaryAssociateSelect');

    bindElementOnce(summaryAssociateSelect, 'change', handleExecutiveSummaryAssociateChange);
}

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

function openCopilotWithPrompt(prompt, title = 'CoPilot') {
    const encodedPrompt = encodeURIComponent(prompt);
    const copilotUrl = `https://copilot.microsoft.com/?showconv=1&sendquery=1&q=${encodedPrompt}`;
    
    // Try to open Copilot; if offline or browser blocks it, offer clipboard fallback
    const windowRef = window.open(copilotUrl, '_blank');
    
    // If window is null or blocked, provide clipboard alternative
    if (!windowRef) {
        navigator.clipboard.writeText(prompt).then(() => {
            showToast('✅ Prompt copied to clipboard! Open Copilot and paste it there.', 5000);
            alert(`${title} prompt copied to clipboard.\n\n1. Go to https://copilot.microsoft.com\n2. Paste the prompt (Ctrl+V)\n3. Let CoPilot generate the email\n\nThis feature requires internet connection for Copilot.`);
        }).catch(() => {
            // Fallback if clipboard also fails
            const tempDiv = document.createElement('div');
            tempDiv.style.cssText = 'position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%); background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 16px rgba(0,0,0,0.2); max-width: 600px; z-index: 10001;';
            tempDiv.innerHTML = `
                <h3 style="margin-top: 0;">📋 Copy This Prompt</h3>
                <p>Clipboard failed. Copy this text and paste at <a href="https://copilot.microsoft.com" target="_blank">copilot.microsoft.com</a>:</p>
                <textarea readonly style="width: 100%; height: 200px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 0.85em;">${escapeHtml(prompt)}</textarea>
                <button onclick="this.parentElement.parentElement.removeChild(this.parentElement);" style="margin-top: 10px; padding: 8px 16px; background: #2196F3; color: white; border: none; border-radius: 4px; cursor: pointer;">Close</button>
            `;
            document.body.appendChild(tempDiv);
        });
    } else {
        showToast('Opening CoPilot with your prompt...', 3000);
    }
}

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

function populateOneOnOneAssociateSelect() {
    const select = document.getElementById('oneOnOneAssociateSelect');
    if (!select) return;

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

    const sortedEmployees = Array.from(allEmployees).sort();
    select.innerHTML = '<option value="">-- Choose an associate --</option>';
    sortedEmployees.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });

    syncOneOnOneAssociateSelect();
}

function syncOneOnOneAssociateSelect() {
    const select = document.getElementById('oneOnOneAssociateSelect');
    const summarySelect = document.getElementById('summaryAssociateSelect');
    if (!select || !summarySelect) return;
    if (summarySelect.value && select.value !== summarySelect.value) {
        select.value = summarySelect.value;
    }
}

// ============================================
// SUPERVISOR INTELLIGENCE HELPERS
// ============================================

function getWeeklyKeysSorted() {
    return Object.keys(weeklyData)
        .map(key => ({ key, date: parseWeekKeyDate(key, weeklyData[key]) }))
        .sort((a, b) => a.date - b.date)
        .map(item => item.key);
}

function parseWeekKeyDate(weekKey, week) {
    const label = week?.metadata?.label || week?.metadata?.weekEnding || week?.week_start || weekKey || '';
    const match = label.match(/Week ending\s+(.+)$/i);
    const dateStr = match ? match[1] : label;
    const parsed = Date.parse(dateStr);
    return Number.isFinite(parsed) ? parsed : 0;
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

    const sums = {};
    const counts = {};
    const surveyBackedMetrics = new Set(['overallExperience', 'cxRepOverall', 'fcr']);
    let periodsIncluded = 0;

    periodKeys.forEach(weekKey => {
        const week = weeklyData[weekKey];
        const employee = week?.employees?.find(emp => emp.name === employeeName);
        if (!employee) return;

        periodsIncluded += 1;
        const surveyTotal = Number.isInteger(parseInt(employee?.surveyTotal, 10))
            ? parseInt(employee.surveyTotal, 10)
            : 0;

        Object.keys(METRICS_REGISTRY).forEach(metricKey => {
            if (surveyBackedMetrics.has(metricKey) && surveyTotal <= 0) return;

            const value = parseFloat(employee[metricKey]);
            if (Number.isNaN(value)) return;
            sums[metricKey] = (sums[metricKey] || 0) + value;
            counts[metricKey] = (counts[metricKey] || 0) + 1;
        });
    });

    if (periodsIncluded === 0) return null;

    const aggregate = {
        name: employeeName,
        periodsIncluded,
        periodKeys: [...periodKeys]
    };

    Object.keys(sums).forEach(metricKey => {
        aggregate[metricKey] = sums[metricKey] / counts[metricKey];
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
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', 'true');
        area.style.position = 'fixed';
        area.style.left = '-9999px';
        document.body.appendChild(area);
        area.select();
        const copied = document.execCommand('copy');
        document.body.removeChild(area);
        if (copied) {
            showToast('✅ This Week Plan copied', 2800);
        } else {
            showToast('Unable to copy This Week Plan', 3000);
        }
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
            options: {
                responsive: true,
                maintainAspectRatio: true,
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
    loadTeamMembers();
    bindTeamFilterChangeHandlers();
    notifyTeamFilterChanged();

    const restoredFromRepo = await tryAutoRestoreFromRepoBackupOnEmptyState();
    if (restoredFromRepo) {
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
        const lastSuccess = loadRepoSyncLastSuccess();
        const commit = String(lastSuccess?.commit || '').trim();
        const shortCommit = commit ? commit.slice(0, 7) : '';
        if (shortCommit) {
            deployMarkerEl.textContent = `Deploy: ${shortCommit}`;
        } else {
            deployMarkerEl.textContent = 'Deploy: n/a';
        }
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

function populateExecutiveSummaryAssociate() {
    
    const select = document.getElementById('summaryAssociateSelect');
    if (!select) return;
    const currentSelection = select.value;

    const allEmployees = new Set();
    const teamFilterContext = getTeamSelectionContext();
    
    // Collect all unique employee names from weeklyData
    for (const weekKey in weeklyData) {
        const week = weeklyData[weekKey];
        if (week.employees && Array.isArray(week.employees)) {
            week.employees.forEach(emp => {
                if (!emp.name) return;

                allEmployees.add(emp.name);
            });
        }
    }
    
    // Sort and populate dropdown
    const sortedEmployees = filterAssociateNamesByTeamSelection(Array.from(allEmployees)).sort();
    select.innerHTML = '<option value="">-- Choose an associate --</option>';
    sortedEmployees.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });

    if (currentSelection && sortedEmployees.includes(currentSelection)) {
        select.value = currentSelection;
    }
    
    
}

function loadExecutiveSummaryData() {
    const associate = document.getElementById('summaryAssociateSelect').value;
    const periodType = 'ytd'; // Always use Year-to-Date

    if (!associate) {
        setExecutiveSummaryVisibility(false);
        return;
    }

    const matchingPeriods = collectExecutiveSummaryPeriodsForAssociate(associate);

    // Populate data table
    populateExecutiveSummaryTable(associate, matchingPeriods, periodType);
    
    // Display metric trend charts
    renderYearlySummaryTrendCharts();

    setExecutiveSummaryVisibility(true);
}

function setExecutiveSummaryVisibility(isVisible) {
    const dataContainer = document.getElementById('summaryDataContainer');
    const chartsContainer = document.getElementById('summaryChartsContainer');
    const display = isVisible ? 'block' : 'none';

    if (dataContainer) dataContainer.style.display = display;
    if (chartsContainer) chartsContainer.style.display = display;
}

function collectExecutiveSummaryPeriodsForAssociate(associate) {
    const matchingPeriods = [];
    for (const weekKey in weeklyData) {
        const weekData = weeklyData[weekKey];
        const employee = weekData?.employees?.find(e => e.name === associate);
        if (!employee) continue;

        matchingPeriods.push({
            weekKey,
            label: weekData.metadata?.label || weekKey,
            employee,
            centerAverage: getCenterAverageForWeek(weekKey),
            startDate: weekData.metadata?.startDate,
            endDate: weekData.metadata?.endDate
        });
    }
    return matchingPeriods;
}

function calculateExecutiveSummaryYtdAverages(periods) {
    const sums = {
        scheduleAdherence: { total: 0, count: 0 },
        overallExperience: { total: 0, count: 0 },
        fcr: { total: 0, count: 0 },
        transfers: { total: 0, count: 0 }
    };

    periods.forEach(period => {
        if (!period.employee) return;

        Object.keys(sums).forEach(metricKey => {
            const value = period.employee[metricKey];
            if (value === undefined || value === null || value === '') return;
            sums[metricKey].total += parseFloat(value);
            sums[metricKey].count += 1;
        });
    });

    const average = (metricKey) => sums[metricKey].count > 0
        ? (sums[metricKey].total / sums[metricKey].count).toFixed(1)
        : 0;

    return {
        avgAdherence: average('scheduleAdherence'),
        avgExperience: average('overallExperience'),
        avgFCR: average('fcr'),
        avgTransfers: average('transfers')
    };
}

function populateExecutiveSummaryTable(associate, periods, periodType) {
    const tbody = document.getElementById('summaryDataTable');
    tbody.innerHTML = '';
    
    // Create a single YTD summary row instead of showing all periods
    const { avgAdherence, avgExperience, avgFCR, avgTransfers } = calculateExecutiveSummaryYtdAverages(periods);
    
    const row = document.createElement('tr');
    row.innerHTML = `
        <td style="padding: 12px; border: 1px solid #ddd; background: #f9f9f9; font-weight: bold;">Year-to-Date Summary</td>
        <td style="padding: 12px; border: 1px solid #ddd;">${avgAdherence}%</td>
        <td style="padding: 12px; border: 1px solid #ddd;">${avgExperience}</td>
        <td style="padding: 12px; border: 1px solid #ddd;">${avgFCR}%</td>
        <td style="padding: 12px; border: 1px solid #ddd;">${avgTransfers}</td>
        <td style="padding: 12px; border: 1px solid #ddd;">
            <input type="text" class="redflags-input" data-week="ytd-summary" placeholder="Add red flags..." 
                style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;">
        </td>
        <td style="padding: 12px; border: 1px solid #ddd;">
            <input type="text" class="phishing-input" data-week="ytd-summary" placeholder="Phishing attempts..." 
                style="width: 100%; padding: 6px; border: 1px solid #ccc; border-radius: 3px;">
        </td>
    `;
    tbody.appendChild(row);
    
    // Load saved red flags and phishing data
    loadExecutiveSummaryNotes(associate);
}

function getExecutiveSummaryNotesStore() {
    return localStorage.getItem(STORAGE_PREFIX + 'executiveSummaryNotes')
        ? JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'executiveSummaryNotes'))
        : {};
}

function bindExecutiveSummaryNotesInputs(selector, noteKey, associate, employeeNotes) {
    document.querySelectorAll(selector).forEach(input => {
        const weekKey = input.dataset.week;
        input.value = employeeNotes[weekKey]?.[noteKey] || '';
        bindElementOnce(input, 'input', () => saveExecutiveSummaryNotes(associate));
        bindElementOnce(input, 'change', () => saveExecutiveSummaryNotes(associate));
    });
}

function saveExecutiveSummaryNoteFields(saved, associate, selector, noteKey) {
    document.querySelectorAll(selector).forEach(input => {
        const weekKey = input.dataset.week;
        if (!saved[associate][weekKey]) saved[associate][weekKey] = {};
        saved[associate][weekKey][noteKey] = input.value;
    });
}

function loadExecutiveSummaryNotes(associate) {
    const saved = getExecutiveSummaryNotesStore();
    const employeeNotes = saved[associate] || {};

    bindExecutiveSummaryNotesInputs('.redflags-input', 'redFlags', associate, employeeNotes);
    bindExecutiveSummaryNotesInputs('.phishing-input', 'phishing', associate, employeeNotes);
}

function saveExecutiveSummaryNotes(associate) {
    const saved = getExecutiveSummaryNotesStore();
    
    if (!saved[associate]) {
        saved[associate] = {};
    }

    saveExecutiveSummaryNoteFields(saved, associate, '.redflags-input', 'redFlags');
    saveExecutiveSummaryNoteFields(saved, associate, '.phishing-input', 'phishing');
    
    localStorage.setItem(STORAGE_PREFIX + 'executiveSummaryNotes', JSON.stringify(saved));
    showToast(`? Notes saved for ${associate}`, 3000);
}

function getYearlySummaryMetricsToShow() {
    return ['scheduleAdherence', 'overallExperience', 'cxRepOverall', 'fcr', 'transfers', 'aht', 'acw', 'holdTime', 'overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions', 'reliability'];
}

function collectYearlySummaryTrendData(employeeName, keys, metricsToShow) {
    const trendData = {};

    metricsToShow.forEach(metricKey => {
        trendData[metricKey] = [];
        keys.forEach(weekKey => {
            const week = weeklyData[weekKey];
            const emp = week?.employees?.find(e => e.name === employeeName);
            if (emp && emp[metricKey] !== undefined && emp[metricKey] !== null && emp[metricKey] !== '') {
                trendData[metricKey].push({
                    weekKey,
                    value: parseFloat(emp[metricKey]),
                    label: formatWeekLabel(weekKey)
                });
            }
        });
    });

    return trendData;
}

function initializeYearlySummaryChartsContainer(chartsContainer) {
    chartsContainer.innerHTML = '<h4 style="margin: 0 0 20px 0; color: #ff9800; font-size: 1.3em;">📊 Weekly Metric Trends</h4>';

    const chartsGrid = document.createElement('div');
    chartsGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px;';
    chartsContainer.appendChild(chartsGrid);
    return chartsGrid;
}

function buildYearlySummaryChartCard(chartsGrid) {
    const chartContainer = document.createElement('div');
    chartContainer.style.cssText = 'background: white; padding: 15px; border-radius: 8px; border: 1px solid #e0e0e0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);';

    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'max-height: 250px;';

    chartContainer.appendChild(canvas);
    chartsGrid.appendChild(chartContainer);

    return canvas;
}

function renderYearlySummaryMetricChart(canvas, metric, metricKey, data) {
    new Chart(canvas, {
        type: 'bar',
        data: {
            labels: data.map(d => d.label),
            datasets: [{
                label: metric.label || metricKey,
                data: data.map(d => d.value),
                backgroundColor: 'rgba(255, 152, 0, 0.6)',
                borderColor: 'rgba(255, 152, 0, 1)',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
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
}

function renderYearlySummaryTrendCharts() {
    const chartsContainer = document.getElementById('summaryChartsContainer');
    if (!chartsContainer) return;

    const employeeName = document.getElementById('summaryAssociateSelect')?.value;
    
    if (!employeeName) {
        chartsContainer.innerHTML = '';
        return;
    }

    const keys = getWeeklyKeysSorted();
    if (keys.length < 2) {
        chartsContainer.innerHTML = '<p style="color: #999; padding: 20px;">Not enough weekly data to show trends (need at least 2 weeks).</p>';
        return;
    }

    const metricsToShow = getYearlySummaryMetricsToShow();
    const trendData = collectYearlySummaryTrendData(employeeName, keys, metricsToShow);
    const chartsGrid = initializeYearlySummaryChartsContainer(chartsContainer);

    // Create bar charts for each metric
    metricsToShow.forEach(metricKey => {
        const metric = METRICS_REGISTRY[metricKey];
        const data = trendData[metricKey];
        
        if (!data || data.length < 1) return;

        const canvas = buildYearlySummaryChartCard(chartsGrid);
        renderYearlySummaryMetricChart(canvas, metric, metricKey, data);
    });
}

function getCenterAverageForWeek(weekKey) {
    // Load call center averages from localStorage
    const callCenterAverages = localStorage.getItem(STORAGE_PREFIX + 'callCenterAverages') ? JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'callCenterAverages')) : {};
    const avg = callCenterAverages[weekKey];
    
    if (!avg || Object.keys(avg).length === 0) {
        
        return null;
    }
    
    // Map center average keys to employee data keys for consistency
    // Center averages use: adherence, repSatisfaction
    // Email metrics use: scheduleAdherence, cxRepOverall
    return {
        scheduleAdherence: avg.adherence,
        overallExperience: avg.overallExperience,
        cxRepOverall: avg.repSatisfaction,
        fcr: avg.fcr,
        transfers: avg.transfers,
        overallSentiment: avg.sentiment,
        positiveWord: avg.positiveWord,
        negativeWord: avg.negativeWord,
        managingEmotions: avg.managingEmotions,
        aht: avg.aht,
        acw: avg.acw,
        holdTime: avg.holdTime,
        reliability: avg.reliability
    };
}

// -----------------------------------------------------------------------------
// COACHING EMAIL - WEEKLY CHECK-IN (METRIC-BASED)
// Uses latest uploaded data + coaching tips bank to build a Copilot prompt
// -----------------------------------------------------------------------------

function getLatestWeekKeyForCoaching() {
    const weekKeys = Object.keys(weeklyData || {});
    if (weekKeys.length === 0) return null;

    const getEndDate = (weekKey) => {
        const metaEnd = weeklyData[weekKey]?.metadata?.endDate;
        if (metaEnd) return new Date(metaEnd);
        const parts = weekKey.split('|');
        const endDate = parts[1] || parts[0];
        return new Date(endDate);
    };

    return weekKeys.reduce((latest, key) => {
        if (!latest) return key;
        return getEndDate(key) > getEndDate(latest) ? key : latest;
    }, null);
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
    const latestWeek = weeklyData[coachingWeekKey];
    const teamFilterContext = getTeamSelectionContext();
    const employees = (latestWeek.employees || [])
        .filter(emp => emp && emp.name)
        .filter(emp => isAssociateIncludedByTeamFilter(emp.name, teamFilterContext))
        .map(emp => emp.name)
        .sort();

    return { latestWeek, employees };
}

function setCoachingLatestPeriodStatus(status, coachingWeekKey, latestWeek) {
    const endDate = latestWeek?.metadata?.endDate
        ? formatDateMMDDYYYY(latestWeek.metadata.endDate)
        : (coachingWeekKey.split('|')[1] ? formatDateMMDDYYYY(coachingWeekKey.split('|')[1]) : coachingWeekKey);
    status.textContent = `Using latest period: Week of ${endDate}`;
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

    if (!weeklyData || Object.keys(weeklyData).length === 0) {
        status.textContent = 'No data available. Upload data first to generate coaching emails.';
        status.style.display = 'block';
        return;
    }

    coachingLatestWeekKey = getLatestWeekKeyForCoaching();
    if (!coachingLatestWeekKey || !weeklyData[coachingLatestWeekKey]) {
        status.textContent = 'Unable to find the latest data period.';
        status.style.display = 'block';
        return;
    }

    const { latestWeek, employees } = getCoachingLatestPeriodEmployees(coachingLatestWeekKey);
    populateCoachingEmployeeSelectOptions(select, employees);
    setCoachingLatestPeriodStatus(status, coachingLatestWeekKey, latestWeek);
    bindCoachingOutlookInputState(outlookBody, outlookBtn);
    bindCoachingEmailActionHandlers(select, generateBtn, outlookBtn);

    
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

    const priority = ((sourceName === 'ytdData' || metadata.periodType === 'ytd') ? 2 : 1)
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

    candidates.sort((a, b) => {
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
    if (value === null || value === undefined || value === '' || value === 'N/A') return null;
    const numeric = parseFloat(value);
    return Number.isNaN(numeric) ? null : numeric;
}

function isValidOnOffPercent(value) {
    return value !== null && value >= 0 && value <= 100;
}

function pickYearEndAssociateOverallValue(employeeRecord) {
    const overallExperienceVal = parseOnOffMirrorNumber(employeeRecord?.overallExperience);
    const cxRepOverallVal = parseOnOffMirrorNumber(employeeRecord?.cxRepOverall);

    if (isValidOnOffPercent(overallExperienceVal) && overallExperienceVal > 0) {
        return { value: overallExperienceVal, source: 'overallExperience' };
    }
    if (isValidOnOffPercent(cxRepOverallVal) && cxRepOverallVal > 0) {
        return { value: cxRepOverallVal, source: 'cxRepOverall' };
    }
    if (isValidOnOffPercent(overallExperienceVal)) {
        return { value: overallExperienceVal, source: 'overallExperience' };
    }
    if (isValidOnOffPercent(cxRepOverallVal)) {
        return { value: cxRepOverallVal, source: 'cxRepOverall' };
    }

    return { value: null, source: 'none' };
}

function buildYearEndOnOffValues(employeeRecord, associateOverallPick) {
    return {
        aht: parseOnOffMirrorNumber(employeeRecord?.aht),
        adherence: parseOnOffMirrorNumber(employeeRecord?.scheduleAdherence),
        sentiment: parseOnOffMirrorNumber(employeeRecord?.overallSentiment),
        associateOverall: associateOverallPick.value,
        reliability: parseOnOffMirrorNumber(employeeRecord?.reliability)
    };
}

function getYearEndOnOffScoreOrFallback(metricKey, value, scoreYear) {
    if (value === null) return null;

    const configuredScore = getMetricRatingScore(metricKey, value, scoreYear);
    if (configuredScore !== null && configuredScore !== undefined) {
        return configuredScore;
    }

    if (metricKey === 'aht') {
        return value <= 419 ? 3 : (value <= 460 ? 2 : 1);
    }
    if (metricKey === 'scheduleAdherence') {
        return value >= 94.5 ? 3 : (value >= 92.5 ? 2 : 1);
    }
    if (metricKey === 'overallSentiment') {
        return value >= 90.1 ? 3 : (value >= 87.5 ? 2 : 1);
    }
    if (metricKey === 'cxRepOverall') {
        return value > 82 ? 3 : (value >= 79.5 ? 2 : 1);
    }
    if (metricKey === 'reliability') {
        return value > 24.1 ? 1 : (value >= 16.1 ? 2 : 3);
    }

    return null;
}

function buildYearEndOnOffScores(values, scoreYear) {
    return {
        aht: getYearEndOnOffScoreOrFallback('aht', values.aht, scoreYear),
        adherence: getYearEndOnOffScoreOrFallback('scheduleAdherence', values.adherence, scoreYear),
        sentiment: getYearEndOnOffScoreOrFallback('overallSentiment', values.sentiment, scoreYear),
        associateOverall: getYearEndOnOffScoreOrFallback('cxRepOverall', values.associateOverall, scoreYear),
        reliability: getYearEndOnOffScoreOrFallback('reliability', values.reliability, scoreYear)
    };
}

function resolveYearEndOnOffTrackStatus(ratingAverage) {
    if (ratingAverage <= 1.79) {
        return { trackLabel: 'Off Track', trackStatusValue: 'off-track' };
    }
    if (ratingAverage <= 2.79) {
        return { trackLabel: 'On Track/Successful', trackStatusValue: 'on-track-successful' };
    }
    return { trackLabel: 'On Track/Exceptional', trackStatusValue: 'on-track-exceptional' };
}

function calculateYearEndOnOffMirror(employeeRecord, reviewYear = new Date().getFullYear()) {
    const associateOverallPick = pickYearEndAssociateOverallValue(employeeRecord);
    const values = buildYearEndOnOffValues(employeeRecord, associateOverallPick);

    const scoreYear = parseInt(reviewYear, 10);
    const scores = buildYearEndOnOffScores(values, scoreYear);

    const scoreValues = Object.values(scores);
    const hasAllScores = scoreValues.every(score => score !== null);
    if (!hasAllScores) {
        return {
            isComplete: false,
            values,
            scores,
            ratingAverage: null,
            trackLabel: 'Insufficient KPI data to calculate On/Off Track',
            trackStatusValue: '',
            associateOverallSource: associateOverallPick.source
        };
    }

    const ratingAverage = scoreValues.reduce((sum, score) => sum + score, 0) / scoreValues.length;
    const { trackLabel, trackStatusValue } = resolveYearEndOnOffTrackStatus(ratingAverage);

    return {
        isComplete: true,
        values,
        scores,
        ratingAverage,
        trackLabel,
        trackStatusValue,
        associateOverallSource: associateOverallPick.source
    };
}

function applyOnOffMirrorResultToElements(summaryEl, detailsEl, result, reviewYear, goalSource, periodMetadata = null) {
    detailsEl.innerHTML = buildOnOffScoreTableHtml(result, reviewYear, {
        goalSource,
        periodMetadata
    });

    if (!result.isComplete) {
        summaryEl.textContent = '⚠️ Missing one or more KPI values. On/Off Track could not be calculated exactly.';
        return result;
    }

    summaryEl.textContent = `Rating Average: ${result.ratingAverage.toFixed(2)} • Calculated Status: ${result.trackLabel}`;
    return result;
}

function renderYearEndOnOffMirror(employeeRecord, reviewYear = new Date().getFullYear(), periodMetadata = null) {
    const summaryEl = document.getElementById('yearEndOnOffSummary');
    const detailsEl = document.getElementById('yearEndOnOffDetails');
    if (!summaryEl || !detailsEl) return null;

    const result = calculateYearEndOnOffMirror(employeeRecord, reviewYear);
    return applyOnOffMirrorResultToElements(summaryEl, detailsEl, result, reviewYear, 'onoff', periodMetadata);
}

function renderOnOffMirrorForElementIds(employeeRecord, summaryElementId, detailsElementId, reviewYear = new Date().getFullYear()) {
    const summaryEl = document.getElementById(summaryElementId);
    const detailsEl = document.getElementById(detailsElementId);
    if (!summaryEl || !detailsEl) return null;

    const result = calculateYearEndOnOffMirror(employeeRecord, reviewYear);
    return applyOnOffMirrorResultToElements(summaryEl, detailsEl, result, reviewYear, 'onoff', null);
}

function resolveOnOffBandGoalText(bands, bandKey, formatKey) {
    const config = bands?.[bandKey];
    if (!config) return 'N/A';
    if (config.type === 'min') {
        const targetValue = config.score3?.min ?? config.score2?.min;
        return targetValue === undefined ? 'N/A' : `≥ ${formatMetricDisplay(formatKey, targetValue)}`;
    }
    const targetValue = config.score3?.max ?? config.score2?.max;
    return targetValue === undefined ? 'N/A' : `≤ ${formatMetricDisplay(formatKey, targetValue)}`;
}

function resolveMetricTrendsGoalText(metricKey, formatKey, reviewYear, periodMetadata) {
    const targetConfig = getYearEndTargetConfig(metricKey, reviewYear, periodMetadata);
    if (!targetConfig || targetConfig.value === undefined || targetConfig.value === null) return 'N/A';
    const operator = targetConfig.type === 'min' ? '≥' : '≤';
    return `${operator} ${formatMetricDisplay(formatKey, targetConfig.value)}`;
}

function resolveOnOffGoalText(goalSource, bands, targetMetricKey, bandMetricKey, formatKey, reviewYear, periodMetadata) {
    const annualGoalText = resolveMetricTrendsGoalText(targetMetricKey, formatKey, reviewYear, periodMetadata);
    if (annualGoalText !== 'N/A') {
        return annualGoalText;
    }
    return resolveOnOffBandGoalText(bands, bandMetricKey, formatKey);
}

function buildOnOffScoreRows(result, goalSource, bands, reviewYear, periodMetadata) {
    return [
        {
            label: 'AHT',
            valueText: result.values.aht === null ? 'N/A' : formatMetricDisplay('aht', result.values.aht),
            goalText: resolveOnOffGoalText(goalSource, bands, 'aht', 'aht', 'aht', reviewYear, periodMetadata),
            score: result.scores.aht
        },
        {
            label: 'Adherence',
            valueText: result.values.adherence === null ? 'N/A' : formatMetricDisplay('scheduleAdherence', result.values.adherence),
            goalText: resolveOnOffGoalText(goalSource, bands, 'scheduleAdherence', 'scheduleAdherence', 'scheduleAdherence', reviewYear, periodMetadata),
            score: result.scores.adherence
        },
        {
            label: 'Overall Sentiment',
            valueText: result.values.sentiment === null ? 'N/A' : formatMetricDisplay('overallSentiment', result.values.sentiment),
            goalText: resolveOnOffGoalText(goalSource, bands, 'overallSentiment', 'overallSentiment', 'overallSentiment', reviewYear, periodMetadata),
            score: result.scores.sentiment
        },
        {
            label: 'Associate Overall (Surveys)',
            valueText: result.values.associateOverall === null ? 'N/A' : formatMetricDisplay('overallExperience', result.values.associateOverall),
            goalText: resolveOnOffGoalText(goalSource, bands, 'cxRepOverall', 'cxRepOverall', 'overallExperience', reviewYear, periodMetadata),
            score: result.scores.associateOverall
        },
        {
            label: 'Reliability',
            valueText: result.values.reliability === null ? 'N/A' : formatMetricDisplay('reliability', result.values.reliability),
            goalText: resolveOnOffGoalText(goalSource, bands, 'reliability', 'reliability', 'reliability', reviewYear, periodMetadata),
            score: result.scores.reliability
        }
    ];
}

function getOnOffScoreCellStyle(score) {
    if (score === 1) return 'background: #ff1a1a; color: #fff; font-weight: bold;';
    if (score === 2) return 'background: #f0de87; color: #222; font-weight: bold;';
    if (score === 3) return 'background: #00b050; color: #fff; font-weight: bold;';
    return 'background: #eee; color: #666; font-weight: bold;';
}

function getOnOffStatusStyle(statusText) {
    return statusText === 'Off Track'
        ? 'background: #ff1a1a; color: #fff;'
        : statusText === 'On Track/Exceptional'
            ? 'background: #00b050; color: #fff;'
            : statusText === 'On Track/Successful'
                ? 'background: #c8f7c5; color: #1b5e20;'
                : 'background: #ddd; color: #222;';
}

function buildOnOffHeaderSummaryHtml(ratingText, statusText, statusStyle) {
    return `
        <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 12px;">
            <div style="padding: 10px 14px; border-radius: 8px; border: 1px solid #d6c4f5; background: #f4effc;">
                <div style="font-size: 0.8em; color: #4a148c;">Rating Average</div>
                <div style="font-size: 1.4em; font-weight: bold; color: #4a148c;">${ratingText}</div>
                <div style="font-size: 0.75em; color: #6a1b9a;">Goal: 2.80+ (On Track/Exceptional)</div>
            </div>
            <div style="padding: 10px 14px; border-radius: 8px; border: 1px solid #d6c4f5; ${statusStyle} font-weight: bold;">
                ${statusText}
            </div>
        </div>
    `;
}

function buildOnOffRowsHtml(rows) {
    return rows.map(row => `
                        <tr>
                            <td style="padding: 8px; border: 1px solid #e3d7f7;">${row.label}</td>
                            <td style="padding: 8px; border: 1px solid #e3d7f7;">${row.valueText}</td>
                            <td style="padding: 8px; border: 1px solid #e3d7f7;">${row.goalText}</td>
                            <td style="padding: 8px; border: 1px solid #e3d7f7; text-align: center; ${getOnOffScoreCellStyle(row.score)}">${row.score === null ? 'N/A' : row.score}</td>
                        </tr>
                    `).join('');
}

function buildOnOffScoreTableHtml(result, reviewYear = new Date().getFullYear(), options = {}) {
    const goalSource = options?.goalSource === 'metric-trends' ? 'metric-trends' : 'onoff';
    const periodMetadata = options?.periodMetadata || null;
    const { bands } = getOnOffTrackerLegendBandsByYear(reviewYear);
    const rows = buildOnOffScoreRows(result, goalSource, bands, reviewYear, periodMetadata);

    const ratingText = result.ratingAverage === null ? 'N/A' : result.ratingAverage.toFixed(2);
    const statusText = result.trackLabel || 'N/A';
    const statusStyle = getOnOffStatusStyle(statusText);
    const summaryHtml = buildOnOffHeaderSummaryHtml(ratingText, statusText, statusStyle);
    const rowsHtml = buildOnOffRowsHtml(rows);

    return `
        ${summaryHtml}
        <div style="overflow-x: auto;">
            <table style="width: 100%; border-collapse: collapse; font-size: 0.9em;">
                <thead>
                    <tr>
                        <th style="text-align: left; padding: 8px; border: 1px solid #d6c4f5; background: #ede7f6; color: #4a148c;">Metric</th>
                        <th style="text-align: left; padding: 8px; border: 1px solid #d6c4f5; background: #ede7f6; color: #4a148c;">Actual</th>
                        <th style="text-align: left; padding: 8px; border: 1px solid #d6c4f5; background: #ede7f6; color: #4a148c;">Annual Goal</th>
                        <th style="text-align: center; padding: 8px; border: 1px solid #d6c4f5; background: #ede7f6; color: #4a148c;">Score</th>
                    </tr>
                </thead>
                <tbody>
                    ${rowsHtml}
                    <tr>
                        <td style="padding: 8px; border: 1px solid #e3d7f7; font-weight: bold;">Rating Average</td>
                        <td style="padding: 8px; border: 1px solid #e3d7f7;" colspan="3">${ratingText}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px; border: 1px solid #e3d7f7; font-weight: bold;">Overall Status</td>
                        <td style="padding: 8px; border: 1px solid #e3d7f7;" colspan="3">${statusText}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    `;
}

function getOnOffTrackerLegendBandsByYear(reviewYear) {
    const yearNum = parseInt(reviewYear, 10);
    const moduleBands = window?.DevCoachModules?.metricProfiles?.RATING_BANDS_BY_YEAR?.[yearNum];
    if (moduleBands) {
        return {
            bands: moduleBands,
            sourceLabel: `${yearNum} rating profile`,
            usingFallback: false
        };
    }

    const inlineBands = METRIC_RATING_BANDS_BY_YEAR?.[yearNum];
    if (inlineBands) {
        return {
            bands: inlineBands,
            sourceLabel: `${yearNum} inline rating bands`,
            usingFallback: false
        };
    }

    return {
        bands: {
            aht: { type: 'max', score3: { max: 419 }, score2: { max: 460 } },
            scheduleAdherence: { type: 'min', score3: { min: 94.5 }, score2: { min: 92.5 } },
            overallSentiment: { type: 'min', score3: { min: 90.1 }, score2: { min: 87.5 } },
            cxRepOverall: { type: 'min', score3: { min: 82 }, score2: { min: 79.5 } },
            reliability: { type: 'max', score3: { max: 16 }, score2: { max: 24 } }
        },
        sourceLabel: 'default mirror fallback bands',
        usingFallback: true
    };
}

function buildOnOffLegendMissingConfigCardHtml(label) {
    return `<div style="padding: 10px; border: 1px solid #e3d7f7; border-radius: 6px; background: #fff;">
                <div style="font-weight: bold; color: #4a148c; margin-bottom: 4px;">${label}</div>
                <div style="font-size: 0.85em; color: #666;">No rating bands configured for selected year.</div>
            </div>`;
}

function buildOnOffLegendMinTypeCardHtml(metricKey, label, config) {
    const score3 = formatMetricDisplay(metricKey, config.score3.min);
    const score2 = formatMetricDisplay(metricKey, config.score2.min);
    return `<div style="padding: 10px; border: 1px solid #e3d7f7; border-radius: 6px; background: #fff;">
                <div style="font-weight: bold; color: #4a148c; margin-bottom: 4px;">${label}</div>
                <div style="font-size: 0.85em; color: #1b5e20;">Score 3: ≥ ${score3}</div>
                <div style="font-size: 0.85em; color: #8d6e00;">Score 2: ≥ ${score2} and &lt; ${score3}</div>
                <div style="font-size: 0.85em; color: #b71c1c;">Score 1: &lt; ${score2}</div>
            </div>`;
}

function buildOnOffLegendMaxTypeCardHtml(metricKey, label, config) {
    const score3 = formatMetricDisplay(metricKey, config.score3.max);
    const score2 = formatMetricDisplay(metricKey, config.score2.max);
    return `<div style="padding: 10px; border: 1px solid #e3d7f7; border-radius: 6px; background: #fff;">
            <div style="font-weight: bold; color: #4a148c; margin-bottom: 4px;">${label}</div>
            <div style="font-size: 0.85em; color: #1b5e20;">Score 3: ≤ ${score3}</div>
            <div style="font-size: 0.85em; color: #8d6e00;">Score 2: &gt; ${score3} and ≤ ${score2}</div>
            <div style="font-size: 0.85em; color: #b71c1c;">Score 1: &gt; ${score2}</div>
        </div>`;
}

function buildOnOffLegendMetricCardHtml(metric, bands) {
    const config = bands?.[metric.key];
    if (!config) {
        return buildOnOffLegendMissingConfigCardHtml(metric.label);
    }
    if (config.type === 'min') {
        return buildOnOffLegendMinTypeCardHtml(metric.key, metric.label, config);
    }
    return buildOnOffLegendMaxTypeCardHtml(metric.key, metric.label, config);
}

function buildOnOffLegendContainerHtml(reviewYear, cardsHtml, sourceLabel, usingFallback) {
    return `
        <div style="font-weight: bold; color: #4a148c; margin-bottom: 8px;">🎯 On/Off Tracker 3-Tier Scoring Legend (${reviewYear || 'N/A'})</div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 8px; margin-bottom: 8px;">${cardsHtml}</div>
        <div style="font-size: 0.8em; color: #5e35b1;">Status bands: Off Track ≤ 1.79 · On Track/Successful 1.80–2.79 · On Track/Exceptional ≥ 2.80</div>
        <div style="font-size: 0.78em; color: #777; margin-top: 3px;">Source: ${sourceLabel}${usingFallback ? ' (used when selected year has no rating profile)' : ''}</div>
    `;
}

function renderOnOffTrackerLegend(reviewYear) {
    const legendEl = document.getElementById('onOffTrackerLegend');
    if (!legendEl) return;

    const { bands, sourceLabel, usingFallback } = getOnOffTrackerLegendBandsByYear(reviewYear);
    const legendMetrics = [
        { key: 'aht', label: 'AHT' },
        { key: 'scheduleAdherence', label: 'Adherence' },
        { key: 'overallSentiment', label: 'Overall Sentiment' },
        { key: 'cxRepOverall', label: 'Associate Overall (Surveys)' },
        { key: 'reliability', label: 'Reliability' }
    ];

    const cards = legendMetrics.map(metric => buildOnOffLegendMetricCardHtml(metric, bands)).join('');
    legendEl.innerHTML = buildOnOffLegendContainerHtml(reviewYear, cards, sourceLabel, usingFallback);
}

function populateOnOffTrackerEmployeeSelect(employeeSelect) {
    employeeSelect.innerHTML = '<option value="">-- Choose an associate --</option>';
    const employees = getYearEndEmployees();
    employees.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        employeeSelect.appendChild(option);
    });
    return employees;
}

function resetOnOffTrackerPanel(panel, factsSummary, summary, details) {
    panel.style.display = 'none';
    factsSummary.textContent = '';
    summary.textContent = '';
    details.innerHTML = '';
}

function bindOnOffTrackerHandlers(employeeSelect, reviewYearInput, calculateBtn) {
    const calculate = () => updateOnOffTrackerDisplay();
    bindElementOnce(employeeSelect, 'change', calculate);
    bindElementOnce(reviewYearInput, 'input', calculate);
    bindElementOnce(calculateBtn, 'click', calculate);
}

function resolveOnOffTrackerFactsSummaryText(latestPeriod) {
    const endDateText = latestPeriod.period?.metadata?.endDate
        ? formatDateMMDDYYYY(latestPeriod.period.metadata.endDate)
        : formatDateMMDDYYYY(latestPeriod.periodKey.split('|')[1] || latestPeriod.periodKey);
    const sourceText = latestPeriod.sourceName === 'ytdData' ? 'YTD upload' : 'Latest period upload';
    return `${latestPeriod.label} • Source: ${sourceText} • End date: ${endDateText}`;
}

function initializeOnOffTracker() {
    const employeeSelect = document.getElementById('onOffTrackerEmployeeSelect');
    const reviewYearInput = document.getElementById('onOffTrackerReviewYear');
    const status = document.getElementById('onOffTrackerStatus');
    const panel = document.getElementById('onOffTrackerPanel');
    const factsSummary = document.getElementById('onOffTrackerFactsSummary');
    const summary = document.getElementById('onOffTrackerSummary');
    const details = document.getElementById('onOffTrackerDetails');
    const calculateBtn = document.getElementById('onOffTrackerCalculateBtn');

    if (!employeeSelect || !reviewYearInput || !status || !panel || !factsSummary || !summary || !details || !calculateBtn) return;

    if (!reviewYearInput.value) {
        reviewYearInput.value = String(new Date().getFullYear());
    }

    renderOnOffTrackerLegend(reviewYearInput.value);

    const employees = populateOnOffTrackerEmployeeSelect(employeeSelect);

    if (!employees.length) {
        status.textContent = 'No employee data found yet. Upload yearly metrics first.';
        status.style.display = 'block';
        panel.style.display = 'none';
        return;
    }

    status.textContent = `Loaded ${employees.length} associates. Select associate and review year.`;
    status.style.display = 'block';

    bindOnOffTrackerHandlers(employeeSelect, reviewYearInput, calculateBtn);
    resetOnOffTrackerPanel(panel, factsSummary, summary, details);
}

function updateOnOffTrackerDisplay() {
    const employeeName = document.getElementById('onOffTrackerEmployeeSelect')?.value;
    const reviewYear = document.getElementById('onOffTrackerReviewYear')?.value;
    const status = document.getElementById('onOffTrackerStatus');
    const panel = document.getElementById('onOffTrackerPanel');
    const factsSummary = document.getElementById('onOffTrackerFactsSummary');

    if (!status || !panel || !factsSummary) return;

    renderOnOffTrackerLegend(reviewYear);

    if (!employeeName || !reviewYear) {
        panel.style.display = 'none';
        status.textContent = 'Select associate and review year to calculate On/Off Track.';
        status.style.display = 'block';
        return;
    }

    const latestPeriod = getLatestYearPeriodForEmployee(employeeName, reviewYear);
    if (!latestPeriod) {
        panel.style.display = 'none';
        status.textContent = `No ${reviewYear} data found for ${employeeName}. Upload ${reviewYear} metrics first.`;
        status.style.display = 'block';
        return;
    }

    factsSummary.textContent = resolveOnOffTrackerFactsSummaryText(latestPeriod);

    renderOnOffMirrorForElementIds(latestPeriod.employeeRecord, 'onOffTrackerSummary', 'onOffTrackerDetails', reviewYear);

    status.textContent = `On/Off tracker calculated for ${employeeName} (${reviewYear}).`;
    status.style.display = 'block';
    panel.style.display = 'block';
}

function bindElementOnce(element, eventName, handler) {
    if (!element || element.dataset.bound) return;
    element.addEventListener(eventName, handler);
    element.dataset.bound = 'true';
}

function getYearEndCommentsElements() {
    return {
        employeeSelect: document.getElementById('yearEndEmployeeSelect'),
        reviewYearInput: document.getElementById('yearEndReviewYear'),
        status: document.getElementById('yearEndStatus'),
        snapshotPanel: document.getElementById('yearEndSnapshotPanel'),
        promptArea: document.getElementById('yearEndPromptArea'),
        trackSelect: document.getElementById('yearEndTrackSelect'),
        positivesInput: document.getElementById('yearEndPositivesInput'),
        improvementsInput: document.getElementById('yearEndImprovementsInput'),
        managerContextInput: document.getElementById('yearEndManagerContext'),
        responseInput: document.getElementById('yearEndCopilotResponse'),
        performanceRatingInput: document.getElementById('yearEndPerformanceRatingInput'),
        meritDetailsInput: document.getElementById('yearEndMeritDetailsInput'),
        bonusAmountInput: document.getElementById('yearEndBonusAmountInput'),
        verbalSummaryOutput: document.getElementById('yearEndVerbalSummaryOutput'),
        calculateOnOffBtn: document.getElementById('calculateYearEndOnOffBtn'),
        generateBtn: document.getElementById('generateYearEndPromptBtn'),
        pasteResponseBtn: document.getElementById('pasteYearEndResponseBtn'),
        copyBtn: document.getElementById('copyYearEndResponseBtn'),
        copyBox1Btn: document.getElementById('copyYearEndBox1Btn'),
        copyBox2Btn: document.getElementById('copyYearEndBox2Btn'),
        generateVerbalSummaryBtn: document.getElementById('generateYearEndVerbalSummaryBtn'),
        copyVerbalSummaryBtn: document.getElementById('copyYearEndVerbalSummaryBtn')
    };
}

function hasRequiredYearEndCommentsElements(elements) {
    return Boolean(
        elements.employeeSelect
        && elements.reviewYearInput
        && elements.status
        && elements.snapshotPanel
        && elements.promptArea
        && elements.trackSelect
        && elements.positivesInput
        && elements.improvementsInput
        && elements.managerContextInput
        && elements.responseInput
        && elements.performanceRatingInput
        && elements.meritDetailsInput
        && elements.bonusAmountInput
        && elements.verbalSummaryOutput
        && elements.generateBtn
        && elements.copyBtn
        && elements.generateVerbalSummaryBtn
        && elements.copyVerbalSummaryBtn
    );
}

function resetYearEndCommentsInitialState(snapshotPanel, promptArea) {
    yearEndDraftContext = null;
    promptArea.value = '';
    snapshotPanel.style.display = 'none';
}

function initializeYearEndReviewYearInput(reviewYearInput) {
    if (!reviewYearInput.value) {
        reviewYearInput.value = String(new Date().getFullYear());
    }
}

function populateYearEndEmployeeSelect(employeeSelect) {
    employeeSelect.innerHTML = '<option value="">-- Choose an associate --</option>';
    const employees = getYearEndEmployees();
    employees.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        employeeSelect.appendChild(option);
    });
    return employees;
}

function bindYearEndPrimaryActionHandlers(elements) {
    bindElementOnce(elements.employeeSelect, 'change', updateYearEndSnapshotDisplay);
    bindElementOnce(elements.reviewYearInput, 'input', updateYearEndSnapshotDisplay);
    bindElementOnce(elements.generateBtn, 'click', generateYearEndPromptAndCopy);
    bindElementOnce(elements.pasteResponseBtn, 'click', pasteYearEndResponseFromClipboard);
    bindElementOnce(elements.copyBtn, 'click', copyYearEndResponseToClipboard);
    bindElementOnce(elements.copyBox1Btn, 'click', () => copyYearEndBoxResponseToClipboard(1));
    bindElementOnce(elements.copyBox2Btn, 'click', () => copyYearEndBoxResponseToClipboard(2));
    bindElementOnce(elements.generateVerbalSummaryBtn, 'click', generateYearEndVerbalSummary);
    bindElementOnce(elements.copyVerbalSummaryBtn, 'click', copyYearEndVerbalSummary);
    bindElementOnce(elements.calculateOnOffBtn, 'click', () => {
        const selectedEmployee = elements.employeeSelect.value;
        const selectedYear = elements.reviewYearInput.value;
        if (!selectedEmployee || !selectedYear) {
            alert('⚠️ Select associate and review year first.');
            return;
        }
        updateYearEndSnapshotDisplay();
        document.getElementById('yearEndSnapshotPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        showToast('✅ On/Off tracker calculated using Excel mirror logic.', 3000);
    });
}

function bindYearEndDraftPersistenceHandlers(elements) {
    const persistDraft = () => {
        persistYearEndDraftState(elements.employeeSelect.value, elements.reviewYearInput.value);
    };

    bindElementOnce(elements.trackSelect, 'change', persistDraft);
    bindElementOnce(elements.positivesInput, 'input', persistDraft);
    bindElementOnce(elements.improvementsInput, 'input', persistDraft);
    bindElementOnce(elements.managerContextInput, 'input', persistDraft);
    bindElementOnce(elements.responseInput, 'input', persistDraft);
    bindElementOnce(elements.performanceRatingInput, 'input', persistDraft);
    bindElementOnce(elements.meritDetailsInput, 'input', persistDraft);
    bindElementOnce(elements.bonusAmountInput, 'input', persistDraft);
    bindElementOnce(elements.verbalSummaryOutput, 'input', persistDraft);
}

function initializeYearEndComments() {
    const elements = getYearEndCommentsElements();
    if (!hasRequiredYearEndCommentsElements(elements)) return;

    resetYearEndCommentsInitialState(elements.snapshotPanel, elements.promptArea);
    initializeYearEndReviewYearInput(elements.reviewYearInput);

    const employees = populateYearEndEmployeeSelect(elements.employeeSelect);
    if (!employees.length) {
        elements.status.textContent = 'No employee data found yet. Upload yearly metrics first.';
        elements.status.style.display = 'block';
        renderYearEndAnnualGoalsInputs('', elements.reviewYearInput.value || String(new Date().getFullYear()));
        return;
    }

    elements.status.textContent = `Loaded ${employees.length} associates. Select associate and review year.`;
    elements.status.style.display = 'block';

    bindYearEndPrimaryActionHandlers(elements);
    bindYearEndDraftPersistenceHandlers(elements);
    renderYearEndAnnualGoalsInputs(elements.employeeSelect.value, elements.reviewYearInput.value);
}

function clearYearEndOnOffMirror(onOffSummary, onOffDetails) {
    if (onOffSummary) onOffSummary.textContent = '';
    if (onOffDetails) onOffDetails.innerHTML = '';
}

function clearYearEndDraftInputs(trackSelect, positivesInput, improvementsInput, managerContextInput, responseInput, performanceRatingInput, meritDetailsInput, bonusAmountInput, verbalSummaryOutput) {
    if (trackSelect) trackSelect.value = '';
    if (positivesInput) positivesInput.value = '';
    if (improvementsInput) improvementsInput.value = '';
    if (managerContextInput) managerContextInput.value = '';
    if (responseInput) responseInput.value = '';
    if (performanceRatingInput) performanceRatingInput.value = '';
    if (meritDetailsInput) meritDetailsInput.value = '';
    if (bonusAmountInput) bonusAmountInput.value = '';
    if (verbalSummaryOutput) verbalSummaryOutput.value = '';
}

function applyYearEndSavedDraft(savedDraft, trackSelect, positivesInput, improvementsInput, managerContextInput, responseInput, performanceRatingInput, meritDetailsInput, bonusAmountInput, verbalSummaryOutput) {
    if (trackSelect) trackSelect.value = savedDraft.trackStatus;
    if (positivesInput) positivesInput.value = savedDraft.positivesText;
    if (improvementsInput) improvementsInput.value = savedDraft.improvementsText;
    if (managerContextInput) managerContextInput.value = savedDraft.managerContext;
    if (responseInput) responseInput.value = savedDraft.copilotResponse;
    if (performanceRatingInput) performanceRatingInput.value = savedDraft.performanceRating;
    if (meritDetailsInput) meritDetailsInput.value = savedDraft.meritDetails;
    if (bonusAmountInput) bonusAmountInput.value = savedDraft.bonusAmount;
    if (verbalSummaryOutput) verbalSummaryOutput.value = savedDraft.verbalSummary;
}

function buildYearEndSummaryLine(latestPeriod, targetProfileYear, wins, opportunities) {
    const profileLabel = targetProfileYear ? `${targetProfileYear} goals` : 'current goals';
    const sourceLabel = latestPeriod.sourceName === 'ytdData' ? 'YTD upload' : 'Latest period upload';
    return `${latestPeriod.label} • Source: ${sourceLabel} • Targets: ${profileLabel} • ${wins.length} positives • ${opportunities.length} improvement areas`;
}

function autoPopulateYearEndNarrativeInputs(positivesInput, improvementsInput, wins, opportunities, annualGoals) {
    if (positivesInput && !positivesInput.value.trim()) {
        const metGoalLines = annualGoals.metGoals.slice(0, 4).map(goal => `Annual Goal Met: ${goal}`);
        positivesInput.value = wins.length
            ? wins.slice(0, 6).map(w => `${w.label}: ${w.value} vs target ${w.target}`).concat(metGoalLines).join('\n')
            : ['Consistent effort and willingness to grow throughout the year.', ...metGoalLines].join('\n');
    }

    if (improvementsInput && !improvementsInput.value.trim()) {
        const annualFollowUps = annualGoals.notMetGoals.map(goal => `Annual Goal Follow-up: ${goal}`);
        improvementsInput.value = opportunities.length
            ? opportunities.slice(0, 6).map(o => `${o.label}: ${o.value} vs target ${o.target}`).concat(annualFollowUps).join('\n')
            : annualFollowUps.length
                ? annualFollowUps.join('\n')
                : 'Continue building consistency and sustaining current performance levels.';
    }
}

function buildYearEndDraftContext(employeeName, reviewYear, latestPeriod, endDateText, wins, opportunities, targetProfileYear, annualGoals) {
    return {
        employeeName,
        reviewYear,
        periodLabel: latestPeriod.label,
        sourceLabel: latestPeriod.sourceName === 'ytdData' ? 'YTD upload' : 'latest uploaded period',
        endDateText,
        wins,
        opportunities,
        targetProfileYear,
        annualGoals
    };
}

function getYearEndSnapshotElements() {
    return {
        status: document.getElementById('yearEndStatus'),
        snapshotPanel: document.getElementById('yearEndSnapshotPanel'),
        summary: document.getElementById('yearEndFactsSummary'),
        winsList: document.getElementById('yearEndWinsList'),
        improvementList: document.getElementById('yearEndImprovementList'),
        onOffSummary: document.getElementById('yearEndOnOffSummary'),
        onOffDetails: document.getElementById('yearEndOnOffDetails'),
        trackSelect: document.getElementById('yearEndTrackSelect'),
        positivesInput: document.getElementById('yearEndPositivesInput'),
        improvementsInput: document.getElementById('yearEndImprovementsInput'),
        managerContextInput: document.getElementById('yearEndManagerContext'),
        responseInput: document.getElementById('yearEndCopilotResponse'),
        performanceRatingInput: document.getElementById('yearEndPerformanceRatingInput'),
        meritDetailsInput: document.getElementById('yearEndMeritDetailsInput'),
        bonusAmountInput: document.getElementById('yearEndBonusAmountInput'),
        verbalSummaryOutput: document.getElementById('yearEndVerbalSummaryOutput'),
        promptArea: document.getElementById('yearEndPromptArea')
    };
}

function clearYearEndSnapshotListsAndPrompt(summary, winsList, improvementList, promptArea) {
    if (promptArea) promptArea.value = '';
    if (summary) summary.textContent = '';
    if (winsList) winsList.innerHTML = '';
    if (improvementList) improvementList.innerHTML = '';
    yearEndDraftContext = null;
}

function setYearEndSnapshotStatus(status, snapshotPanel, text, showPanel) {
    if (!status || !snapshotPanel) return;
    status.textContent = text;
    status.style.display = 'block';
    snapshotPanel.style.display = showPanel ? 'block' : 'none';
}

function renderYearEndSnapshotMetricLists(winsList, improvementList, wins, opportunities) {
    if (winsList) {
        winsList.innerHTML = wins.length
            ? wins.map(w => `<li>${w.label}: ${w.value} vs target ${w.target}</li>`).join('')
            : '<li>No metrics currently at goal in this period.</li>';
    }

    if (improvementList) {
        improvementList.innerHTML = opportunities.length
            ? opportunities.map(o => `<li>${o.label}: ${o.value} vs target ${o.target}</li>`).join('')
            : '<li>No below-target metrics detected in this period.</li>';
    }
}

function resolveYearEndEndDateText(latestPeriod) {
    const metadataEndDate = latestPeriod?.period?.metadata?.endDate;
    const fallbackDate = latestPeriod?.periodKey?.split('|')[1] || latestPeriod?.periodKey;
    return formatDateMMDDYYYY(metadataEndDate || fallbackDate);
}

function updateYearEndSnapshotDisplay() {
    const employeeName = document.getElementById('yearEndEmployeeSelect')?.value;
    const reviewYear = document.getElementById('yearEndReviewYear')?.value;
    const {
        status,
        snapshotPanel,
        summary,
        winsList,
        improvementList,
        onOffSummary,
        onOffDetails,
        trackSelect,
        positivesInput,
        improvementsInput,
        managerContextInput,
        responseInput,
        performanceRatingInput,
        meritDetailsInput,
        bonusAmountInput,
        verbalSummaryOutput,
        promptArea
    } = getYearEndSnapshotElements();

    if (!status || !snapshotPanel || !summary || !winsList || !improvementList || !promptArea) return;

    clearYearEndSnapshotListsAndPrompt(summary, winsList, improvementList, promptArea);

    if (!employeeName || !reviewYear) {
        setYearEndSnapshotStatus(status, snapshotPanel, 'Select associate and review year to load year-end facts.', false);
        clearYearEndOnOffMirror(onOffSummary, onOffDetails);
        clearYearEndDraftInputs(trackSelect, positivesInput, improvementsInput, managerContextInput, responseInput, performanceRatingInput, meritDetailsInput, bonusAmountInput, verbalSummaryOutput);
        return;
    }

    const latestPeriod = getLatestYearPeriodForEmployee(employeeName, reviewYear);
    if (!latestPeriod) {
        setYearEndSnapshotStatus(status, snapshotPanel, `No ${reviewYear} data found for ${employeeName}. Upload ${reviewYear} metrics first.`, false);
        clearYearEndOnOffMirror(onOffSummary, onOffDetails);
        return;
    }

    renderYearEndAnnualGoalsInputs(employeeName, reviewYear);
    const savedDraft = getYearEndDraftState(employeeName, reviewYear);
    applyYearEndSavedDraft(savedDraft, trackSelect, positivesInput, improvementsInput, managerContextInput, responseInput, performanceRatingInput, meritDetailsInput, bonusAmountInput, verbalSummaryOutput);

    const annualGoals = collectYearEndAnnualGoals(employeeName, reviewYear);
    const { wins, opportunities, targetProfileYear } = buildYearEndMetricSnapshot(
        latestPeriod.employeeRecord,
        reviewYear,
        latestPeriod.period?.metadata
    );
    const endDateText = resolveYearEndEndDateText(latestPeriod);

    summary.textContent = buildYearEndSummaryLine(latestPeriod, targetProfileYear, wins, opportunities);

    renderYearEndSnapshotMetricLists(winsList, improvementList, wins, opportunities);

    const onOffMirror = renderYearEndOnOffMirror(
        latestPeriod.employeeRecord,
        reviewYear,
        latestPeriod.period?.metadata || null
    );
    if (trackSelect && !trackSelect.value && onOffMirror?.trackStatusValue) {
        trackSelect.value = onOffMirror.trackStatusValue;
    }

    autoPopulateYearEndNarrativeInputs(positivesInput, improvementsInput, wins, opportunities, annualGoals);

    appendMissingYearEndImprovementFollowUps(employeeName, reviewYear);

    yearEndDraftContext = buildYearEndDraftContext(
        employeeName,
        reviewYear,
        latestPeriod,
        endDateText,
        wins,
        opportunities,
        targetProfileYear,
        annualGoals
    );

    setYearEndSnapshotStatus(status, snapshotPanel, `Year-end facts loaded for ${employeeName} (${reviewYear}).`, true);

    // Persist defaults if we auto-populated empty fields
    persistYearEndDraftState(employeeName, reviewYear);
}

function getYearEndPromptInputs() {
    return {
        employeeName: document.getElementById('yearEndEmployeeSelect')?.value,
        reviewYear: document.getElementById('yearEndReviewYear')?.value,
        trackStatus: document.getElementById('yearEndTrackSelect')?.value,
        positivesText: document.getElementById('yearEndPositivesInput')?.value.trim() || '',
        improvementsText: document.getElementById('yearEndImprovementsInput')?.value.trim() || '',
        managerContext: document.getElementById('yearEndManagerContext')?.value.trim() || '',
        promptArea: document.getElementById('yearEndPromptArea'),
        button: document.getElementById('generateYearEndPromptBtn')
    };
}

function validateYearEndPromptInputs(employeeName, reviewYear, trackStatus, promptArea) {
    if (!employeeName) {
        alert('⚠️ Please select an associate first.');
        return false;
    }
    if (!reviewYear) {
        alert('⚠️ Please enter a review year.');
        return false;
    }
    if (!trackStatus) {
        alert('⚠️ Please mark whether the associate is on track or off track.');
        return false;
    }
    if (!promptArea) return false;
    return true;
}

function ensureYearEndDraftContext(employeeName, reviewYear) {
    appendMissingYearEndImprovementFollowUps(employeeName, reviewYear);

    if (!yearEndDraftContext || yearEndDraftContext.employeeName !== employeeName || yearEndDraftContext.reviewYear !== reviewYear) {
        updateYearEndSnapshotDisplay();
    }
}

function buildYearEndPromptSupportData(employeeName, reviewYear) {
    const fallbackPositives = (yearEndDraftContext?.wins || [])
        .map(w => `${w.label}: ${w.value} vs target ${w.target}`)
        .join('\n');
    const fallbackImprovements = (yearEndDraftContext?.opportunities || [])
        .map(o => `${o.label}: ${o.value} vs target ${o.target}`)
        .join('\n');
    const annualGoals = collectYearEndAnnualGoals(employeeName, reviewYear);
    const annualMetText = annualGoals.metGoals.length
        ? annualGoals.metGoals.map(line => `- ${line}`).join('\n')
        : '- None recorded';
    const annualNotMetText = annualGoals.notMetGoals.length
        ? annualGoals.notMetGoals.map(line => `- ${line}`).join('\n')
        : '- None';

    return {
        fallbackPositives,
        fallbackImprovements,
        annualMetText,
        annualNotMetText
    };
}

function resolveYearEndPromptHeaderData(employeeName, reviewYear, trackStatus) {
    const preferredName = getEmployeeNickname(employeeName) || employeeName.split(' ')[0] || employeeName;
    const trackLabel = trackStatus === 'on-track-exceptional'
        ? 'On Track/Exceptional'
        : trackStatus === 'on-track-successful' || trackStatus === 'on-track'
            ? 'On Track/Successful'
            : 'Off Track';
    const periodLabel = yearEndDraftContext?.periodLabel || `${reviewYear} year-end period`;
    const sourceLabel = yearEndDraftContext?.sourceLabel || 'uploaded metrics';
    const targetProfileLabel = yearEndDraftContext?.targetProfileYear
        ? `${yearEndDraftContext.targetProfileYear} year-end goals`
        : 'current metric goals';

    return {
        preferredName,
        trackLabel,
        periodLabel,
        sourceLabel,
        targetProfileLabel
    };
}

function buildYearEndCopilotPrompt(inputData, supportData, headerData) {
    const delegated = window.DevCoachModules?.yearEnd?.buildCopilotPrompt?.(inputData, supportData, headerData);
    return delegated || '';
}

function setYearEndPromptButtonFeedback(button) {
    if (!button) return;
    const originalText = button.textContent;
    button.textContent = '✅ Copied + Opening Copilot';
    setTimeout(() => {
        button.textContent = originalText;
    }, 1500);
}

function copyYearEndPromptWithFallbacks(prompt, copilotWindow) {
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(prompt)
            .then(() => {
                showToast('✅ Year-end prompt copied. Paste into Copilot with Ctrl+V.', 4000);
                if (!copilotWindow) {
                    alert('✅ Year-end prompt copied to clipboard.\n\nOpen https://copilot.microsoft.com and paste with Ctrl+V.');
                }
            })
            .catch(() => {
                showToast('⚠️ Could not copy automatically. Prompt is in the box below for manual copy.', 4500);
                if (!copilotWindow) {
                    openCopilotWithPrompt(prompt, 'Year-End Comments');
                }
            });
        return;
    }

    showToast('⚠️ Clipboard not available. Copy the prompt from the box below.', 4500);
    if (!copilotWindow) {
        openCopilotWithPrompt(prompt, 'Year-End Comments');
    }
}

function generateYearEndPromptAndCopy() {
    const inputData = getYearEndPromptInputs();

    if (!validateYearEndPromptInputs(inputData.employeeName, inputData.reviewYear, inputData.trackStatus, inputData.promptArea)) {
        return;
    }

    ensureYearEndDraftContext(inputData.employeeName, inputData.reviewYear);
    const supportData = buildYearEndPromptSupportData(inputData.employeeName, inputData.reviewYear);
    const headerData = resolveYearEndPromptHeaderData(inputData.employeeName, inputData.reviewYear, inputData.trackStatus);
    const prompt = buildYearEndCopilotPrompt(inputData, supportData, headerData);
    if (!prompt) {
        showToast('⚠️ Year-End module is unavailable. Refresh and try again.', 3500);
        return;
    }

    inputData.promptArea.value = prompt;
    setYearEndPromptButtonFeedback(inputData.button);

    const copilotWindow = window.open('https://copilot.microsoft.com', '_blank');
    copyYearEndPromptWithFallbacks(prompt, copilotWindow);
}

function copyYearEndResponseToClipboard() {
    const responseText = document.getElementById('yearEndCopilotResponse')?.value.trim();
    if (!responseText) {
        alert('⚠️ Paste the Copilot year-end comments first.');
        return;
    }

    navigator.clipboard.writeText(responseText)
        .then(() => showToast('✅ Year-end notes copied to clipboard!', 3000))
        .catch(() => showToast('⚠️ Unable to copy year-end notes.', 3000));
}

function focusYearEndResponseInput(responseInput) {
    if (responseInput && typeof responseInput.focus === 'function') {
        responseInput.focus();
    }
}

async function getClipboardTextViaReadText() {
    if (!navigator.clipboard?.readText) return '';
    return String(await navigator.clipboard.readText() || '');
}

async function extractClipboardTextFromItem(item) {
    if (item.types.includes('text/plain')) {
        const plainBlob = await item.getType('text/plain');
        const plainText = await plainBlob.text();
        if (plainText && plainText.trim()) return plainText;
    }

    if (item.types.includes('text/html')) {
        const htmlBlob = await item.getType('text/html');
        const htmlText = await htmlBlob.text();
        const parser = new DOMParser();
        const htmlDoc = parser.parseFromString(htmlText, 'text/html');
        const parsedText = String(htmlDoc.body?.innerText || '').trim();
        if (parsedText && parsedText.trim()) return parsedText;
    }

    return '';
}

async function getClipboardTextViaReadItems() {
    if (!navigator.clipboard?.read) return '';

    const clipboardItems = await navigator.clipboard.read();
    for (const item of clipboardItems) {
        const text = await extractClipboardTextFromItem(item);
        if (text && text.trim()) return text;
    }

    return '';
}

async function readYearEndClipboardText() {
    let clipboardText = await getClipboardTextViaReadText();
    if (clipboardText && clipboardText.trim()) return clipboardText;
    clipboardText = await getClipboardTextViaReadItems();
    return clipboardText;
}

async function pasteYearEndResponseFromClipboard() {
    const responseInput = document.getElementById('yearEndCopilotResponse');
    const employeeName = document.getElementById('yearEndEmployeeSelect')?.value;
    const reviewYear = document.getElementById('yearEndReviewYear')?.value;
    if (!responseInput) return;

    try {
        if (!navigator.clipboard) {
            showToast('⚠️ Clipboard paste is not available in this browser. Use Ctrl+V in the box.', 4500);
            focusYearEndResponseInput(responseInput);
            return;
        }

        const clipboardText = await readYearEndClipboardText();

        if (!clipboardText || !clipboardText.trim()) {
            showToast('⚠️ Clipboard read was blocked or returned no text. Click the box and press Ctrl+V.', 4500);
            focusYearEndResponseInput(responseInput);
            return;
        }

        responseInput.value = clipboardText;
        persistYearEndDraftState(employeeName, reviewYear);
        showToast('✅ Final notes pasted from clipboard.', 3000);
    } catch (error) {
        showToast('⚠️ Could not access clipboard API. Click in the box and use Ctrl+V.', 4500);
        focusYearEndResponseInput(responseInput);
    }
}

function extractYearEndBoxText(responseText, boxNumber) {
    const delegated = window.DevCoachModules?.yearEnd?.extractBoxText?.(responseText, boxNumber);
    return typeof delegated === 'string' ? delegated : '';
}

function copyYearEndBoxResponseToClipboard(boxNumber) {
    const responseText = document.getElementById('yearEndCopilotResponse')?.value.trim();
    if (!responseText) {
        alert('⚠️ Paste the Copilot year-end comments first.');
        return;
    }

    const boxText = extractYearEndBoxText(responseText, boxNumber);
    if (!boxText) {
        showToast(`⚠️ Could not find Box ${boxNumber} in the pasted response.`, 3500);
        return;
    }

    navigator.clipboard.writeText(boxText)
        .then(() => showToast(`✅ Box ${boxNumber} copied to clipboard!`, 3000))
        .catch(() => showToast(`⚠️ Unable to copy Box ${boxNumber}.`, 3000));
}

function generateYearEndVerbalSummary() {
    const employeeName = document.getElementById('yearEndEmployeeSelect')?.value;
    const reviewYear = document.getElementById('yearEndReviewYear')?.value;
    const performanceRating = document.getElementById('yearEndPerformanceRatingInput')?.value.trim() || 'Not provided';
    const meritDetails = document.getElementById('yearEndMeritDetailsInput')?.value.trim() || 'Not provided';
    const bonusAmount = document.getElementById('yearEndBonusAmountInput')?.value.trim() || 'Not provided';
    const output = document.getElementById('yearEndVerbalSummaryOutput');

    if (!employeeName) {
        alert('⚠️ Please select an associate first.');
        return;
    }
    if (!reviewYear) {
        alert('⚠️ Please enter a review year.');
        return;
    }
    if (!output) return;

    const preferredName = getEmployeeNickname(employeeName) || employeeName.split(' ')[0] || employeeName;
    const summary = window.DevCoachModules?.yearEnd?.buildVerbalSummary?.(
        preferredName,
        reviewYear,
        performanceRating,
        meritDetails,
        bonusAmount
    ) || '';

    if (!summary) {
        showToast('⚠️ Year-End module is unavailable. Refresh and try again.', 3500);
        return;
    }

    output.value = summary;
    persistYearEndDraftState(employeeName, reviewYear);
    showToast('✅ Verbal summary generated.', 3000);
}

function copyYearEndVerbalSummary() {
    const outputText = document.getElementById('yearEndVerbalSummaryOutput')?.value.trim();
    if (!outputText) {
        alert('⚠️ Generate the verbal summary first.');
        return;
    }

    navigator.clipboard.writeText(outputText)
        .then(() => showToast('✅ Verbal summary copied to clipboard!', 3000))
        .catch(() => showToast('⚠️ Unable to copy verbal summary.', 3000));
}

function deleteLatestCoachingEntry() {
    const employeeName = document.getElementById('coachingEmployeeSelect')?.value;
    if (!employeeName) {
        showToast('Select an associate first', 3000);
        return;
    }

    const history = coachingHistory[employeeName] || [];
    if (!history.length) {
        showToast('No coaching history to delete', 3000);
        return;
    }

    const confirmed = confirm(`Delete the latest coaching entry for ${employeeName}?`);
    if (!confirmed) return;

    coachingHistory[employeeName] = history.slice(1);
    saveCoachingHistory();
    renderCoachingHistory(employeeName);
    showToast('✅ Latest coaching entry deleted', 3000);
}

function clearCoachingHistoryForEmployee() {
    const employeeName = document.getElementById('coachingEmployeeSelect')?.value;
    if (!employeeName) {
        showToast('Select an associate first', 3000);
        return;
    }

    const confirmed = confirm(`Clear ALL coaching history for ${employeeName}? This cannot be undone.`);
    if (!confirmed) return;

    coachingHistory[employeeName] = [];
    saveCoachingHistory();
    renderCoachingHistory(employeeName);
    showToast('✅ Coaching history cleared', 3000);
}

function getCoachingEmailDisplayElements() {
    return {
        panel: document.getElementById('coachingMetricsPanel'),
        summary: document.getElementById('coachingMetricsSummary'),
        winsList: document.getElementById('coachingWinsList'),
        oppList: document.getElementById('coachingOpportunitiesList'),
        promptArea: document.getElementById('coachingPromptArea'),
        outlookSection: document.getElementById('coachingOutlookSection'),
        outlookBody: document.getElementById('coachingOutlookBody'),
        outlookBtn: document.getElementById('generateOutlookEmailBtn')
    };
}

function resetCoachingEmailDisplayState(elements) {
    elements.winsList.innerHTML = '';
    elements.oppList.innerHTML = '';
    elements.promptArea.value = '';

    if (elements.outlookSection && elements.outlookBody && elements.outlookBtn) {
        elements.outlookSection.style.display = 'none';
        elements.outlookBody.value = '';
        elements.outlookBtn.disabled = true;
        elements.outlookBtn.style.opacity = '0.6';
        elements.outlookBtn.style.cursor = 'not-allowed';
    }
}

function resolveCoachingEmployeeRecord(employeeName) {
    if (!employeeName || !coachingLatestWeekKey) return null;
    return weeklyData[coachingLatestWeekKey]?.employees?.find(emp => emp.name === employeeName) || null;
}

function buildCoachingDisplayMetricData(employeeRecord) {
    const wins = [];
    const opportunities = [];
    const metricKeys = getMetricOrder().map(m => m.key);

    metricKeys.forEach(key => {
        const metricConfig = METRICS_REGISTRY[key];
        const value = employeeRecord[key];
        if (!metricConfig || value === null || value === undefined || value === '' || value === 'N/A') return;

        const numValue = parseFloat(value);
        if (isNaN(numValue)) return;

        const target = metricConfig.target?.value;
        if (target === undefined || target === null) return;

        const meetsTarget = isMetricMeetingTarget(key, numValue, target);
        const entry = {
            key,
            label: metricConfig.label,
            value: formatMetricDisplay(key, numValue),
            target: formatMetricDisplay(key, target)
        };

        if (meetsTarget) {
            wins.push(entry);
        } else {
            opportunities.push(entry);
        }
    });

    return { wins, opportunities };
}

function resolveCoachingDisplayEndDate() {
    const period = weeklyData[coachingLatestWeekKey];
    const metadataEndDate = period?.metadata?.endDate;
    if (metadataEndDate) {
        return formatDateMMDDYYYY(metadataEndDate);
    }

    const keyEndDate = coachingLatestWeekKey.split('|')[1];
    return keyEndDate ? formatDateMMDDYYYY(keyEndDate) : coachingLatestWeekKey;
}

function renderCoachingMetricLists(winsList, oppList, wins, opportunities) {
    winsList.innerHTML = wins.length
        ? wins.map(w => `<li>${w.label}: ${w.value} vs target ${w.target}</li>`).join('')
        : '<li>No metrics meeting goal in the latest period.</li>';

    oppList.innerHTML = opportunities.length
        ? opportunities.map(o => `<li>${o.label}: ${o.value} vs target ${o.target}</li>`).join('')
        : '<li>No focus areas below target in the latest period.</li>';
}

function updateCoachingEmailDisplay() {
    const employeeName = document.getElementById('coachingEmployeeSelect')?.value;
    const elements = getCoachingEmailDisplayElements();

    if (!elements.panel || !elements.summary || !elements.winsList || !elements.oppList || !elements.promptArea) return;

    resetCoachingEmailDisplayState(elements);

    const employeeRecord = resolveCoachingEmployeeRecord(employeeName);
    if (!employeeRecord) {
        elements.panel.style.display = 'none';
        renderCoachingHistory(employeeName);
        return;
    }

    const { wins, opportunities } = buildCoachingDisplayMetricData(employeeRecord);
    const endDate = resolveCoachingDisplayEndDate();

    elements.summary.textContent = `Week of ${endDate} • ${wins.length} wins • ${opportunities.length} focus areas`;
    renderCoachingMetricLists(elements.winsList, elements.oppList, wins, opportunities);

    elements.panel.style.display = 'block';
    renderCoachingHistory(employeeName);
}

function getCoachingHistoryElements() {
    return {
        panel: document.getElementById('coachingHistoryPanel'),
        summary: document.getElementById('coachingHistorySummary'),
        list: document.getElementById('coachingHistoryList')
    };
}

function setCoachingHistoryEmptyState(summary, list, panel, summaryText) {
    summary.textContent = summaryText;
    list.innerHTML = '';
    panel.style.display = 'block';
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
    const tips = getMetricTips(metricConfig.label);
    let selectedTip = metricConfig.defaultTip;
    if (tips && tips.length > 0) {
        const available = tips.filter(t => !usedTips.has(t));
        selectedTip = (available.length > 0
            ? available[Math.floor(Math.random() * available.length)]
            : tips[Math.floor(Math.random() * tips.length)]);
    }
    usedTips.add(selectedTip);
    return selectedTip;
}

function collectCoachingPromptMetricData(employeeRecord) {
    const wins = [];
    const opportunities = [];
    const usedTips = new Set();

    getMetricOrder().map(m => m.key).forEach(key => {
        const metricConfig = METRICS_REGISTRY[key];
        const value = employeeRecord[key];
        if (!metricConfig || value === null || value === undefined || value === '' || value === 'N/A') return;

        const numValue = parseFloat(value);
        if (isNaN(numValue)) return;

        const target = metricConfig.target?.value;
        if (target === undefined || target === null) return;

        const meetsTarget = isMetricMeetingTarget(key, numValue, target);
        const displayValue = formatMetricDisplay(key, numValue);
        const displayTarget = formatMetricDisplay(key, target);

        if (meetsTarget) {
            wins.push({ label: metricConfig.label, value: displayValue, target: displayTarget });
            return;
        }

        opportunities.push({
            label: metricConfig.label,
            value: displayValue,
            target: displayTarget,
            tip: chooseCoachingTip(metricConfig, usedTips)
        });
    });

    return { wins, opportunities };
}

function resolveCoachingPromptPeriodEndDate() {
    const weeklyMeta = weeklyData[coachingLatestWeekKey]?.metadata;
    if (weeklyMeta?.endDate) {
        return formatDateMMDDYYYY(weeklyMeta.endDate);
    }
    return coachingLatestWeekKey.split('|')[1]
        ? formatDateMMDDYYYY(coachingLatestWeekKey.split('|')[1])
        : coachingLatestWeekKey;
}

function buildCoachingPromptMetricsText(wins, opportunities) {
    const winsText = wins.length
        ? wins.map(w => `- ${w.label}: ${w.value} vs target ${w.target}`).join('\n')
        : '- No metrics meeting goal in this period.';

    const oppText = opportunities.length
        ? opportunities.map(o => `- ${o.label}: ${o.value} vs target ${o.target}\n  Coaching tip: ${o.tip}`).join('\n')
        : '- No metrics below target in this period.';

    return { winsText, oppText };
}

function buildCoachingPromptRoleSection(employeeName) {
    return `ROLE

You are a real contact center supervisor writing a weekly coaching check-in email for ${employeeName}.
This should sound like it is coming directly from their supervisor — warm, human, supportive, and invested in their success.
This is a recurring weekly email.
Assume you have written to this associate before.
Vary wording and structure naturally like a human would.`;
}

function buildCoachingPromptVoiceToneSection() {
    return `VOICE & TONE (CRITICAL)

- Warm and empathetic
- Friendly and conversational
- Confident and assured
- Encouraging and forward-looking
- Clear and direct expectations
- Supportive and invested in success
- Authentic supervisor-to-associate connection
- Cheerleading first, coaching second`;
}

function buildCoachingPromptRulesSection() {
    return `HARD WRITING RULES

- Do NOT number sections
- Do NOT label sections (no "Key Wins," "Opportunities," etc.)
- Do NOT sound like a report or checklist
- Do NOT use robotic or instructional language
- Do NOT repeat phrasing across bullets
- Do NOT use HR clichés or jargon
- Do NOT use the phrase "This is an opportunity to"
- Do NOT use em dashes (—)
- Write in natural paragraphs with clean, simple bullet points where appropriate`;
}

function buildCoachingPromptFlowSection(preferredName) {
    return `EMAIL FLOW (INTERNAL – DO NOT SHOW)

Opening:
- Start by greeting ${preferredName} by name
- Lead with confidence and appreciation
- Set a positive, supportive tone

Celebrate Wins:
- Call out strong metrics first with current performance and target
- Explain briefly why those wins matter
- Use bullets where helpful, but keep them clean and natural

Coaching:
- Discuss only metrics below target
- Include current performance and target for each metric
- Pull exactly ONE relevant coaching tip per metric
- Rewrite the tip naturally in your own words
- Make guidance actionable but conversational
- Frame as refinement and focus, not correction

Expectations:
- Clearly state that improvement is expected where metrics are off
- Balance accountability with belief in the associate
- Emphasize progress, consistency, and confidence

Close:
- End on encouragement and confidence
- Reinforce momentum and support
- Tie focus areas to growth and future readiness`;
}

function buildCoachingPromptOutputRequirementsSection(preferredName) {
    return `OUTPUT REQUIREMENTS

- Address ${preferredName} by name in the opening
- Use clean bullets for metrics (wins and opportunities)
- Show current performance vs target in each bullet
- Pull exactly ONE tip per opportunity metric
- Rewrite tips in natural language—never copy verbatim
- Sound like a real supervisor: natural, human, and supportive
- No numbered sections or labels`;
}

function buildCoachingPromptDataSection(endDate, winsText, oppText) {
    return `DATA FOR THIS EMAIL

Week of ${endDate}

Strengths:
${winsText}

Focus Areas:
${oppText}`;
}

function buildCoachingPromptDataRulesSection() {
    return `DATA RULES

- Only reference metrics and data provided above
- Do not invent feedback or metrics
- Do not assume external factors
- Every tip must relate directly to the data provided`;
}

function buildCoachingPromptFinalInstructionSection(preferredName) {
    return `FINAL INSTRUCTION

Generate the coaching email for ${preferredName} now.`;
}

function buildCoachingPrompt(employeeRecord) {
    const { wins, opportunities } = collectCoachingPromptMetricData(employeeRecord);
    const endDate = resolveCoachingPromptPeriodEndDate();

    const preferredName = getEmployeeNickname(employeeRecord.name);
    const { winsText, oppText } = buildCoachingPromptMetricsText(wins, opportunities);

    return [
        buildCoachingPromptRoleSection(employeeRecord.name),
        buildCoachingPromptVoiceToneSection(),
        buildCoachingPromptRulesSection(),
        buildCoachingPromptFlowSection(preferredName),
        buildCoachingPromptOutputRequirementsSection(preferredName),
        buildCoachingPromptDataSection(endDate, winsText, oppText),
        buildCoachingPromptDataRulesSection(),
        buildCoachingPromptFinalInstructionSection(preferredName)
    ].join('\n\n');
}

function getCoachingPromptGenerationInputs() {
    return {
        employeeName: document.getElementById('coachingEmployeeSelect')?.value,
        promptArea: document.getElementById('coachingPromptArea'),
        button: document.getElementById('generateCoachingPromptBtn')
    };
}

function resolveCoachingPromptEmployeeRecord(employeeName) {
    if (!employeeName || !coachingLatestWeekKey) return null;
    return weeklyData[coachingLatestWeekKey]?.employees?.find(emp => emp.name === employeeName) || null;
}

function buildLatestCoachingSummaryData(employeeRecord) {
    const periodMeta = weeklyData[coachingLatestWeekKey]?.metadata || {};
    const weekEnding = periodMeta.endDate || (coachingLatestWeekKey.split('|')[1] || '');
    const periodLabel = periodMeta.label || (weekEnding ? `Week ending ${formatDateMMDDYYYY(weekEnding)}` : 'this period');
    const preferredName = getEmployeeNickname(employeeRecord.name) || employeeRecord.firstName || employeeRecord.name;
    const reliabilityHours = (() => {
        const parsed = parseFloat(employeeRecord.reliability);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    })();
    const { celebrate, needsCoaching, coachedMetricKeys } = evaluateMetricsForCoaching(employeeRecord);

    return {
        weekEnding,
        summaryData: {
            firstName: preferredName,
            periodLabel,
            celebrate,
            needsCoaching,
            reliabilityHours,
            customNotes: '',
            timeReference: 'this week'
        },
        coachedMetricKeys
    };
}

function recordAndRenderCoachingEvent(employeeName, weekEnding, coachedMetricKeys) {
    recordCoachingEvent({
        employeeId: employeeName,
        weekEnding: weekEnding || 'this period',
        metricsCoached: coachedMetricKeys,
        aiAssisted: true
    });
    renderCoachingHistory(employeeName);
}

function showCoachingPromptCopiedState(button) {
    if (!button) return;
    const originalText = button.textContent;
    button.textContent = '✅ Copied to CoPilot';
    setTimeout(() => {
        button.textContent = originalText;
    }, 1200);
}

function revealCoachingOutlookSection() {
    const outlookSection = document.getElementById('coachingOutlookSection');
    if (!outlookSection) return;
    outlookSection.style.display = 'block';
    outlookSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function openCopilotForCoachingPrompt() {
    setTimeout(() => {
        window.open('https://copilot.microsoft.com', '_blank');
    }, 500);
}

function generateCoachingPromptAndCopy() {
    const { employeeName, promptArea, button } = getCoachingPromptGenerationInputs();

    if (!employeeName) {
        alert('⚠️ Please select an associate first.');
        return;
    }

    const employeeRecord = resolveCoachingPromptEmployeeRecord(employeeName);
    if (!employeeRecord) {
        alert('⚠️ No data found for that associate in the latest period.');
        return;
    }

    const prompt = buildCoachingPrompt(employeeRecord);
    promptArea.value = prompt;

    const { weekEnding, summaryData, coachedMetricKeys } = buildLatestCoachingSummaryData(employeeRecord);
    window.latestCoachingSummaryData = summaryData;

    recordAndRenderCoachingEvent(employeeName, weekEnding || summaryData.periodLabel, coachedMetricKeys);
    promptArea.select();
    document.execCommand('copy');

    showCoachingPromptCopiedState(button);
    revealCoachingOutlookSection();
    openCopilotForCoachingPrompt();
}

function getCoachingOutlookGenerationInputs() {
    const outlookBody = document.getElementById('coachingOutlookBody');
    return {
        outlookBody,
        selectedEmployee: document.getElementById('coachingEmployeeSelect')?.value,
        bodyText: (outlookBody?.value || '').trim()
    };
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

const DEFAULT_SENTIMENT_PHRASE_DATABASE = {
    positive: {
        A: [
            'have wonderful', 'anything else', 'I can help', 'anything else help', 'happy to', 'anything else you',
            'of course', 'happy help', 'absolutely', 'what can', 'how help', 'do for you', 'taken care',
            'what I can do', 'anything else do', 'work you', 'enjoy', 'what we can do', 'you got it',
            'take time', 'no problem', 'can definitely', 'here help', "let's get", 'perfectly',
            "don't worry", 'glad to', 'take care for you', "let's make sure", 'wish best',
            'answered questions', 'lovely', 'being customer', 'you bet', 'thank you part', 'took care',
            'happy assist', 'my pleasure', 'a pleasure', 'appreciate business', 'congratulations', 'certainly',
            'thank you being', 'questions or concerns'
        ],
        C: [
            'really appreciate', "you've been", 'very helpful'
        ]
    },
    negative: {
        A: [
            'not sure', 'an error', "we can't", 'no way', 'yes but', 'unfortunately', "I can't give",
            'trying help', 'sorry but', 'I understand but', "we don't have", 'not my problem', 'any notes',
            "can't provide", "I can't do", "I can't see", 'you need to go', 'no notes', "I can't find",
            'sorry feel', 'our policy', 'nothing do', "I can't tell", "don't do that", 'unable help',
            'like I said'
        ],
        C: [
            'you understand', "i don't care", 'not helping', 'not helping', "you don't care", 'let finish',
            'not listening'
        ]
    },
    emotions: {
        C: [
            'frustrated',
            'your company',
            'frustrating',
            'ridiculous',
            'really upset',
            'you people',
            'what NEAR hell',
            'fuck you',
            'not my fault',
            'horrible',
            'wasting NEAR "my time"',
            'this NEAR "B\'S"',
            'screwed',
            "you don't care",
            'our fault',
            'stupid',
            'complaint',
            'totally unacceptable',
            "can't NEAR believe",
            'very unhappy',
            'your fault NOTIN "not your fault"',
            'not NEAR "good enough"',
            'cannot NEAR believe',
            'not happy',
            'seriously',
            'pissed off',
            'unacceptable',
            'fucking',
            'kill myself',
            'Monopoly',
            'bull shit',
            "i'm NEAR angry"
        ]
    }
};

function normalizePhraseList(textValue) {
    if (!textValue) return [];
    const unique = new Set();

    const parseManualPhraseLine = (line) => {
        if (!line) return '';
        let cleaned = String(line).trim();

        if (!/[a-z0-9]/i.test(cleaned)) {
            return '';
        }

        const taggedInParens = cleaned.match(/^[+\-#]?\s*\(([AC]):\s*(.+)\)$/i);
        if (taggedInParens) {
            cleaned = taggedInParens[2].trim();
        } else {
            const taggedDirect = cleaned.match(/^[+\-#]?\s*([AC]):\s*(.+)$/i);
            if (taggedDirect) {
                cleaned = taggedDirect[2].trim();
            } else {
                cleaned = cleaned.replace(/^[+\-#]+\s*/, '').trim();
            }
        }

        cleaned = cleaned.replace(/^"|"$/g, '').trim();

        if (!/[a-z0-9]/i.test(cleaned)) {
            return '';
        }

        return cleaned;
    };

    textValue
        .split('\n')
        .map(parseManualPhraseLine)
        .filter(Boolean)
        .forEach(item => unique.add(item));
    return Array.from(unique);
}

function normalizePhraseForMatch(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function formatKeywordPhraseForDisplay(value) {
    let phrase = String(value || '').trim();
    if (!phrase) return '';

    phrase = phrase
        .replace(/\bNOTIN\b\s*"[^"]*"/gi, '')
        .replace(/\bNOTIN\b\s*'[^']*'/gi, '')
        .replace(/\bNOTIN\b\s*[^\s]+/gi, '')
        .replace(/\bNEAR\b/gi, ' ... ')
        .replace(/\s+/g, ' ')
        .trim();

    return phrase;
}

function normalizeDateStringForStorage(dateString) {
    if (!dateString) return '';

    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        return dateString;
    }

    const slashMatch = dateString.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (slashMatch) {
        const month = slashMatch[1].padStart(2, '0');
        const day = slashMatch[2].padStart(2, '0');
        let year = slashMatch[3];
        if (year.length === 2) {
            year = year >= '70' ? `19${year}` : `20${year}`;
        }
        return `${year}-${month}-${day}`;
    }

    const parsed = new Date(dateString);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
    }

    return '';
}

function parseDateForComparison(dateString) {
    const normalized = normalizeDateStringForStorage(dateString);
    if (!normalized) return null;
    const parsed = new Date(`${normalized}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function ensureSentimentPhraseDatabaseDefaults() {
    if (!sentimentPhraseDatabase || typeof sentimentPhraseDatabase !== 'object') {
        sentimentPhraseDatabase = JSON.parse(JSON.stringify(DEFAULT_SENTIMENT_PHRASE_DATABASE));
        saveSentimentPhraseDatabase();
        return;
    }

    sentimentPhraseDatabase.positive = sentimentPhraseDatabase.positive || { A: [], C: [] };
    sentimentPhraseDatabase.negative = sentimentPhraseDatabase.negative || { A: [], C: [] };
    sentimentPhraseDatabase.emotions = sentimentPhraseDatabase.emotions || { C: [] };
    sentimentPhraseDatabase.positive.A = Array.isArray(sentimentPhraseDatabase.positive.A) ? sentimentPhraseDatabase.positive.A : [];
    sentimentPhraseDatabase.positive.C = Array.isArray(sentimentPhraseDatabase.positive.C) ? sentimentPhraseDatabase.positive.C : [];
    sentimentPhraseDatabase.negative.A = Array.isArray(sentimentPhraseDatabase.negative.A) ? sentimentPhraseDatabase.negative.A : [];
    sentimentPhraseDatabase.negative.C = Array.isArray(sentimentPhraseDatabase.negative.C) ? sentimentPhraseDatabase.negative.C : [];
    sentimentPhraseDatabase.emotions.C = Array.isArray(sentimentPhraseDatabase.emotions.C) ? sentimentPhraseDatabase.emotions.C : [];
}

function renderSentimentDatabasePanel() {
    ensureSentimentPhraseDatabaseDefaults();

    const positiveA = document.getElementById('phraseDbPositiveA');
    const positiveC = document.getElementById('phraseDbPositiveC');
    const negativeA = document.getElementById('phraseDbNegativeA');
    const negativeC = document.getElementById('phraseDbNegativeC');
    const emotionsC = document.getElementById('phraseDbEmotionsC');
    const status = document.getElementById('phraseDbStatus');
    const snapshotStatus = document.getElementById('associateSnapshotStatus');

    if (!positiveA || !positiveC || !negativeA || !negativeC || !emotionsC) {
        return;
    }

    positiveA.value = (sentimentPhraseDatabase.positive?.A || []).join('\n');
    positiveC.value = (sentimentPhraseDatabase.positive?.C || []).join('\n');
    negativeA.value = (sentimentPhraseDatabase.negative?.A || []).join('\n');
    negativeC.value = (sentimentPhraseDatabase.negative?.C || []).join('\n');
    emotionsC.value = (sentimentPhraseDatabase.emotions?.C || []).join('\n');

    const totalCount =
        (sentimentPhraseDatabase.positive?.A?.length || 0) +
        (sentimentPhraseDatabase.positive?.C?.length || 0) +
        (sentimentPhraseDatabase.negative?.A?.length || 0) +
        (sentimentPhraseDatabase.negative?.C?.length || 0) +
        (sentimentPhraseDatabase.emotions?.C?.length || 0);

    if (status) {
        status.textContent = `Saved phrase database: ${totalCount} phrases total.`;
    }

    if (snapshotStatus) {
        const totalSnapshots = Object.values(associateSentimentSnapshots || {}).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
        snapshotStatus.textContent = totalSnapshots > 0
            ? `Saved associate snapshots: ${totalSnapshots}`
            : 'No associate snapshot saved yet.';
    }
}

function saveSentimentPhraseDatabaseFromForm() {
    const positiveA = document.getElementById('phraseDbPositiveA');
    const positiveC = document.getElementById('phraseDbPositiveC');
    const negativeA = document.getElementById('phraseDbNegativeA');
    const negativeC = document.getElementById('phraseDbNegativeC');
    const emotionsC = document.getElementById('phraseDbEmotionsC');

    if (!positiveA || !positiveC || !negativeA || !negativeC || !emotionsC) {
        return;
    }

    sentimentPhraseDatabase = {
        positive: {
            A: normalizePhraseList(positiveA.value),
            C: normalizePhraseList(positiveC.value)
        },
        negative: {
            A: normalizePhraseList(negativeA.value),
            C: normalizePhraseList(negativeC.value)
        },
        emotions: {
            C: normalizePhraseList(emotionsC.value)
        },
        updatedAt: new Date().toISOString()
    };

    saveSentimentPhraseDatabase();
    renderSentimentDatabasePanel();
    showToast('✅ Sentiment phrase database saved', 2500);
}

function syncSentimentSnapshotDateInputsFromReports() {
    const startInput = document.getElementById('sentimentSnapshotStart');
    const endInput = document.getElementById('sentimentSnapshotEnd');
    if (!startInput || !endInput) return;

    const positive = sentimentReports.positive;
    if (!positive) return;

    const start = normalizeDateStringForStorage(positive.startDate);
    const end = normalizeDateStringForStorage(positive.endDate);

    if (start && !startInput.value) startInput.value = start;
    if (end && !endInput.value) endInput.value = end;
}

function saveAssociateSentimentSnapshotFromCurrentReports() {
    const { positive, negative, emotions } = sentimentReports;
    if (!positive || !negative || !emotions) {
        showToast('⚠️ Upload all 3 sentiment reports before saving a snapshot', 4000);
        return;
    }

    ensureSentimentPhraseDatabaseDefaults();

    const associateName = (positive.associateName || negative.associateName || emotions.associateName || '').trim();
    if (!associateName) {
        showToast('⚠️ Associate name not found in uploaded reports', 4000);
        return;
    }

    const startInput = document.getElementById('sentimentSnapshotStart');
    const endInput = document.getElementById('sentimentSnapshotEnd');
    const startDate = normalizeDateStringForStorage(startInput?.value || positive.startDate || negative.startDate || emotions.startDate);
    const endDate = normalizeDateStringForStorage(endInput?.value || positive.endDate || negative.endDate || emotions.endDate);

    if (!startDate || !endDate) {
        showToast('⚠️ Timeframe start and end are required', 4000);
        return;
    }

    const sortByValue = (a, b) => b.value - a.value;
    const toTopRows = (items) => items.slice(0, 5).map(item => ({
        phrase: item.phrase,
        value: item.value,
        speaker: item.speaker || 'A'
    }));

    const positiveUsed = positive.phrases.filter(p => p.value > 0 && (p.speaker || 'A') === 'A').sort(sortByValue);
    const negativeUsedA = negative.phrases.filter(p => p.value > 0 && p.speaker === 'A').sort(sortByValue);
    const negativeUsedC = negative.phrases.filter(p => p.value > 0 && p.speaker === 'C').sort(sortByValue);
    const emotionsUsed = emotions.phrases.filter(p => p.value > 0).sort(sortByValue);

    const usedPositiveSet = new Set(positiveUsed.map(p => normalizePhraseForMatch(p.phrase)));
    const positiveUnusedFromDb = (sentimentPhraseDatabase.positive?.A || [])
        .filter(phrase => !usedPositiveSet.has(normalizePhraseForMatch(phrase)))
        .slice(0, 8);

    const snapshot = {
        associateName,
        timeframeStart: startDate,
        timeframeEnd: endDate,
        savedAt: new Date().toISOString(),
        topPhrases: {
            positiveA: toTopRows(positiveUsed),
            negativeA: toTopRows(negativeUsedA),
            negativeC: toTopRows(negativeUsedC),
            emotions: toTopRows(emotionsUsed)
        },
        suggestions: {
            positiveAdditions: positiveUnusedFromDb,
            negativeAlternatives: (sentimentPhraseDatabase.positive?.A || []).slice(0, 8),
            emotionCustomerCues: (sentimentPhraseDatabase.emotions?.C || []).slice(0, 8)
        }
    };

    if (!associateSentimentSnapshots[associateName]) {
        associateSentimentSnapshots[associateName] = [];
    }

    const existingIndex = associateSentimentSnapshots[associateName].findIndex(entry =>
        entry.timeframeStart === startDate && entry.timeframeEnd === endDate
    );

    if (existingIndex >= 0) {
        associateSentimentSnapshots[associateName][existingIndex] = snapshot;
    } else {
        associateSentimentSnapshots[associateName].push(snapshot);
    }

    associateSentimentSnapshots[associateName] = associateSentimentSnapshots[associateName]
        .sort((a, b) => new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime())
        .slice(0, 200);

    console.log('💾 Saving sentiment snapshot:', { associateName, startDate, endDate, snapshot });
    console.log('📦 All snapshots after save:', associateSentimentSnapshots);
    
    saveAssociateSentimentSnapshots();
    populateDeleteSentimentDropdown();
    renderSentimentDatabasePanel();
    showToast(`✅ Saved sentiment snapshot for ${associateName} (${startDate} to ${endDate})`, 3000);
}

function formatSentimentSnapshotForPrompt(snapshotData, startDate, endDate) {
    /**
     * Convert sentiment snapshot data to prompt-compatible format.
     * Supports phrases-only uploads (no percentages/calls) and legacy data.
     */
    if (!snapshotData) return null;
    
    const existingScores = snapshotData.scores || null;
    const fallbackScores = {
        positiveWord: snapshotData.positive?.percentage || 0,
        negativeWord: snapshotData.negative?.percentage || 0,
        managingEmotions: snapshotData.emotions?.percentage || 0
    };

    const formatted = {
        timeframeStart: startDate,
        timeframeEnd: endDate,
        scores: existingScores || fallbackScores,
        calls: snapshotData.calls || {
            positiveTotal: snapshotData.positive?.totalCalls || 0,
            positiveDetected: snapshotData.positive?.callsDetected || 0,
            negativeTotal: snapshotData.negative?.totalCalls || 0,
            negativeDetected: snapshotData.negative?.callsDetected || 0,
            emotionsTotal: snapshotData.emotions?.totalCalls || 0,
            emotionsDetected: snapshotData.emotions?.callsDetected || 0
        },
        topPhrases: snapshotData.topPhrases || {
            positiveA: (snapshotData.positive?.phrases || []).map(p => ({ phrase: p.phrase, value: p.value, speaker: p.speaker || 'A' })),
            negativeA: (snapshotData.negative?.phrases || []).map(p => ({ phrase: p.phrase, value: p.value, speaker: p.speaker || 'A' })),
            negativeC: (snapshotData.negative?.phrases || []).filter(p => p.speaker === 'C').map(p => ({ phrase: p.phrase, value: p.value, speaker: 'C' })),
            emotions: (snapshotData.emotions?.phrases || []).map(p => ({ phrase: p.phrase, value: p.value, speaker: p.speaker || 'C' }))
        },
        suggestions: snapshotData.suggestions || {
            negativeAlternatives: ['solution-focused language', 'collaborative phrasing', 'positive ownership'],
            positiveAdditions: ['I appreciate', 'happy to help', 'glad to assist']
        }
    };
    
    return formatted;
}

function buildSentimentFocusAreasForPrompt(snapshot, weeklyMetrics = null) {
    if (!snapshot) return '';

    const negativeTarget = METRICS_REGISTRY.negativeWord?.target?.value || 83;
    const positiveTarget = METRICS_REGISTRY.positiveWord?.target?.value || 86;
    const emotionsTarget = METRICS_REGISTRY.managingEmotions?.target?.value || 95;

    const hasScoreData = snapshot.scores && Object.values(snapshot.scores).some(value => Number(value) > 0);
    const scoreSource = weeklyMetrics || (hasScoreData ? snapshot.scores : null);

    const focusLines = [];

    if (!scoreSource) {
        const topPos = (snapshot.topPhrases?.positiveA || []).slice(0, 3)
            .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
            .join(', ');
        const topNeg = (snapshot.topPhrases?.negativeA || []).slice(0, 3)
            .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
            .join(', ');
        const cues = (snapshot.topPhrases?.emotions || []).slice(0, 3)
            .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
            .join(', ');

        if (topPos) focusLines.push(`Positive keywords used: ${topPos}.`);
        if (topNeg) focusLines.push(`Negative keywords used: ${topNeg}.`);
        if (cues) focusLines.push(`Customer emotion cues heard: ${cues}.`);

        return focusLines.length > 0
            ? focusLines.join('\n')
            : 'Sentiment keyword report available, but no frequent phrases were captured.';
    }

    const negScore = Number(scoreSource.negativeWord || 0);
    const posScore = Number(scoreSource.positiveWord || 0);
    const emoScore = Number(scoreSource.managingEmotions || 0);

    if (negScore < negativeTarget) {
        const usingNegative = 100 - negScore;
        const usingNegativeTarget = 100 - negativeTarget;
        const topNeg = (snapshot.topPhrases?.negativeA || []).slice(0, 3)
            .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
            .join(', ') || 'none listed';
        const replacements = (snapshot.suggestions?.negativeAlternatives || []).slice(0, 3).join(', ') || 'solution-focused alternatives';
        focusLines.push(
            `Focus Area - Avoiding Negative Words: ${negScore}% (Using Negative Words: ${usingNegative}%). Target: ${negativeTarget}% (Using Negative Words: ${usingNegativeTarget}%). ` +
            `Most used phrases: ${topNeg}. Try saying this instead: ${replacements}.`
        );
    }

    if (posScore < positiveTarget) {
        const topPos = (snapshot.topPhrases?.positiveA || []).slice(0, 3)
            .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
            .join(', ') || 'none listed';
        const additions = (snapshot.suggestions?.positiveAdditions || []).slice(0, 3).join(', ') || 'positive ownership phrases';
        focusLines.push(
            `Focus Area - Using Positive Words: ${posScore}% (Target: ${positiveTarget}%). ` +
            `Most used phrases: ${topPos}. Add these phrases to every call: ${additions}.`
        );
    }

    if (emoScore < emotionsTarget) {
        const cues = (snapshot.topPhrases?.emotions || []).slice(0, 3)
            .map(item => `"${formatKeywordPhraseForDisplay(item.phrase)}" (${item.value})`)
            .join(', ') || 'no frequent cues captured';
        focusLines.push(
            `Focus Area - Managing emotions is at ${emoScore}%, target is ${emotionsTarget}%. ` +
            `Heightened customer phrases detected: ${cues}. Use de-escalation acknowledgment before solving.`
        );
    }

    if (focusLines.length === 0) {
        return 'In the latest report, sentiment metrics are meeting targets. Reinforce consistency and continue current phrasing habits.';
    }

    return focusLines.join('\n');
}

// Curse word filter for sentiment analysis
const CURSE_WORDS = [
    'damn', 'hell', 'crap', 'piss', 'ass', 'bastard', 'bitch', 'fuck', 'shit',
    'dick', 'pussy', 'whore', 'slut', 'cock', 'asshole', 'motherfucker', 'goddamn',
    'dammit', 'bloody', 'arsehole', 'bollocks', 'bugger', 'cunt', 'fart', 'git',
    'prat', 'sod', 'twat', 'wanker', 'crappy', 'shitty', 'frickin', 'freakin',
    'jackass', 'douchebag', 'douche', 'schmuck', 'turd', 'ass hat', 'dipshit'
];

/**
 * Check if a phrase contains curse words
 * @param {string} phrase - Phrase to check
 * @returns {boolean} - True if phrase contains curse words
 */
function containsCurseWords(phrase) {
    if (!phrase) return false;
    const lowerPhrase = phrase.toLowerCase();
    return CURSE_WORDS.some(word => lowerPhrase.includes(word));
}

/**
 * Censor curse words in a phrase
 * @param {string} phrase - Phrase to censor
 * @returns {string} - Phrase with curse words replaced with [censored]
 */
function censorCurseWords(phrase) {
    if (!phrase) return phrase;
    let censored = phrase;
    const lowerPhrase = phrase.toLowerCase();
    CURSE_WORDS.forEach(word => {
        const regex = new RegExp(word, 'gi');
        if (lowerPhrase.includes(word)) {
            censored = censored.replace(regex, '[censored]');
        }
    });
    return censored;
}

let sentimentReports = {
    positive: null,
    negative: null,
    emotions: null
};

function buildPositiveLanguageSentimentSection(positive, associateName) {
    let section = '';
    section += `═══════════════════════════════════\n`;
    section += `POSITIVE LANGUAGE\n`;
    section += `═══════════════════════════════════\n`;
    section += `Keywords Summary (phrases used)\n\n`;

    const posUsedPhrases = positive.phrases
        .filter(p => p.value > 0 && !containsCurseWords(p.phrase))
        .sort((a, b) => b.value - a.value);
    if (posUsedPhrases.length > 0) {
        section += `✓ DOING WELL - You used these positive words/phrases:\n`;
        posUsedPhrases.slice(0, SENTIMENT_TOP_WINS_COUNT).forEach(p => {
            section += `  • "${censorCurseWords(p.phrase)}" - ${p.value} calls\n`;
        });
        if (posUsedPhrases.length > SENTIMENT_TOP_WINS_COUNT) {
            section += `  [... and ${posUsedPhrases.length - SENTIMENT_TOP_WINS_COUNT} more positive phrases]\n`;
        }
    } else {
        section += `✓ DOING WELL:\n`;
        section += `  • No strong positive phrases detected in this period\n`;
    }
    section += `\n`;

    const posUnusedPhrases = positive.phrases
        .filter(p => p.value === 0 && !containsCurseWords(p.phrase))
        .sort((a, b) => a.value - b.value);
    if (posUnusedPhrases.length > 0) {
        section += `⬆ INCREASE YOUR SCORE - Try using these phrases more often:\n`;
        posUnusedPhrases.slice(0, SENTIMENT_BOTTOM_COUNT).forEach(p => {
            section += `  • "${censorCurseWords(p.phrase)}"\n`;
        });
    }
    section += `\n`;

    section += `📝 SCRIPTED OPENING (with positive language):\n`;
    section += `  "Hello! Thank you for calling. My name is ${escapeHtml(associateName)}. I'm here to\n`;
    section += `   help you and I appreciate the opportunity to assist you today."\n\n`;

    section += `📝 OWNERSHIP STATEMENT (take responsibility):\n`;
    section += `  "I understand this is important to you. I'm going to take ownership of\n`;
    section += `   this and personally ensure we get this resolved for you."\n\n`;

    section += `📝 SCRIPTED CLOSING (with positive language):\n`;
    section += `  "I truly appreciate you taking the time to work with me on this. We've\n`;
    section += `   accomplished great things together today, and I'm delighted we could help."\n\n`;

    return section;
}

function buildNegativeLanguageSentimentSection(negative) {
    let section = '';
    section += `═══════════════════════════════════\n`;
    section += `AVOIDING NEGATIVE LANGUAGE\n`;
    section += `═══════════════════════════════════\n`;
    section += `Keywords Summary (phrases used)\n\n`;

    const assocNegative = negative.phrases.filter(p => p.speaker === 'A' && p.value > 0 && !containsCurseWords(p.phrase));
    const assocNegativeUnused = negative.phrases.filter(p => p.speaker === 'A' && p.value === 0 && !containsCurseWords(p.phrase));
    const custNegative = negative.phrases.filter(p => p.speaker === 'C' && p.value > 0 && !containsCurseWords(p.phrase));

    if (assocNegative.length === 0) {
        section += `✓ EXCELLENT - Minimal negative language in your calls\n`;
        section += `  • You're avoiding negative words effectively\n`;
    } else {
        section += `⚠ PHRASES YOU USED - These came out in your calls, avoid them:\n`;
        assocNegative.sort((a, b) => b.value - a.value).forEach(p => {
            section += `  • "${censorCurseWords(p.phrase)}" - used ${p.value} times\n`;
        });
    }
    section += `\n`;

    if (assocNegativeUnused.length > 0) {
        section += `🛡 WATCH OUT - Database phrases you haven't used yet (prevent bad habits):\n`;
        assocNegativeUnused.slice(0, SENTIMENT_BOTTOM_COUNT).forEach(p => {
            section += `  • "${censorCurseWords(p.phrase)}" - Don't let this slip in\n`;
        });
    }
    section += `\n`;

    const negativeReplacements = {
        'not sure': 'I\'ll find out for you',
        'an error': 'Let me correct that for you',
        'we can\'t': 'Here\'s what we can do',
        'can\'t': 'We can',
        'no way': 'I understand, let\'s work on this',
        'i can\'t': 'I can help you with',
        'no': 'Yes, I can',
        'unable': 'I\'m able to help you',
        'don\'t': 'Do',
        'sorry but': 'I apologize and here\'s how I\'ll fix this',
        'unfortunately': 'Great news - here\'s what we can do'
    };

    section += `✅ POSITIVE ALTERNATIVES - Say these instead:\n`;
    if (assocNegative.length > 0) {
        assocNegative.sort((a, b) => b.value - a.value).slice(0, 3).forEach(p => {
            const phrase = p.phrase.toLowerCase().replace(/[^a-z0-9\s]/g, '');
            const replacement = Object.entries(negativeReplacements).find(([key]) => phrase.includes(key))?.[1];
            if (replacement) {
                section += `  • Instead of "${censorCurseWords(p.phrase)}" → "${replacement}"\n`;
            }
        });
    } else {
        section += `  • "I understand your concern, here's how I can help"\n`;
        section += `  • "Let me find a solution for you"\n`;
        section += `  • "I appreciate you working with me on this"\n`;
    }
    section += `\n`;

    if (custNegative.length > 0) {
        section += `📌 CUSTOMER CONTEXT - They said (understand their frustration):\n`;
        custNegative.sort((a, b) => b.value - a.value).slice(0, SENTIMENT_CUSTOMER_CONTEXT_COUNT).forEach(p => {
            section += `  • "${censorCurseWords(p.phrase)}" - detected ${p.value} times\n`;
        });
        section += `  → Acknowledge their concern, don't make excuses\n`;
    }
    section += `\n`;

    section += `📝 SCRIPTED RESPONSE (when customer is frustrated):\n`;
    section += `  "I hear your frustration, and I completely understand. I'm committed to\n`;
    section += `   finding a solution for you right now. Let me see what I can do for you."\n\n`;

    return section;
}

function buildManagingEmotionsSentimentSection(emotions) {
    let section = '';
    section += `═══════════════════════════════════\n`;
    section += `MANAGING EMOTIONS\n`;
    section += `═══════════════════════════════════\n`;
    section += `Coverage: ${emotions.callsDetected} / ${emotions.totalCalls} calls (${emotions.percentage}%)\n\n`;

    const emotionUsedPhrases = emotions.phrases.filter(p => p.value > 0 && !containsCurseWords(p.phrase));
    const emotionUnusedPhrases = emotions.phrases.filter(p => p.value === 0 && !containsCurseWords(p.phrase));

    if (emotionUsedPhrases.length === 0 || emotions.percentage <= SENTIMENT_EMOTION_LOW_THRESHOLD) {
        section += `✓ STRONG PERFORMANCE - You're managing customer emotions effectively\n`;
        section += `  • Low emotion escalation (${emotions.percentage}%) - Calming presence detected\n`;
    } else {
        section += `📌 EMOTION INDICATORS DETECTED - Customer emotional phrases in calls:\n`;
        emotionUsedPhrases.sort((a, b) => b.value - a.value).forEach(p => {
            section += `  • "${censorCurseWords(p.phrase)}" - detected in ${p.value} calls\n`;
        });
    }
    section += `\n`;

    if (emotionUnusedPhrases.length > 0) {
        section += `🛡 WATCH OUT - Emotion phrases to prevent (haven't shown up yet):\n`;
        emotionUnusedPhrases.slice(0, SENTIMENT_BOTTOM_COUNT).forEach(p => {
            section += `  • "${censorCurseWords(p.phrase)}" - Avoid letting this develop\n`;
        });
    }
    section += `\n`;

    section += `✅ TECHNIQUES TO MASTER - How to manage emotions:\n`;
    section += `  • Acknowledge their feelings first: "I can hear the frustration in your voice"\n`;
    section += `  • Show you understand: "If I were in your position, I'd feel the same way"\n`;
    section += `  • Don't interrupt or talk over them - let them finish\n`;
    section += `  • Take action, not excuses: "Here's exactly what I'm going to do..."\n`;
    section += `  • Follow up: "I'll personally make sure this gets resolved for you"\n`;
    section += `\n`;

    section += `📝 SCRIPTED RESPONSE (when emotion is high):\n`;
    section += `  "I completely understand your frustration. I'm listening to you, and I want\n`;
    section += `   you to know I'm going to take personal ownership of this. Let me get this\n`;
    section += `   resolved for you right now. Here's what I can do..."\n\n`;

    return section;
}

function generateSentimentSummary() {
    const { positive, negative, emotions } = sentimentReports;
    
    // Validation: ensure all 3 files uploaded
    if (!positive || !negative || !emotions) {
        alert('⚠️ Please upload all 3 files (Positive Language, Avoiding Negative Language, Managing Emotions)');
        return;
    }
    
    const delegated = window.DevCoachModules?.sentiment?.buildSentimentSummaryText;
    let summary = '';
    if (typeof delegated === 'function') {
        const composed = delegated(
            { positive, negative, emotions },
            {
                escapeHtml,
                buildPositiveLanguageSentimentSection,
                buildNegativeLanguageSentimentSection,
                buildManagingEmotionsSentimentSection
            }
        );
        summary = composed?.summary || '';
    }

    if (!summary) {
        alert('⚠️ Sentiment module is unavailable or could not build summary. Refresh and try again.');
        return;
    }
    
    // Display the summary
    document.getElementById('sentimentSummaryText').textContent = summary;
    document.getElementById('sentimentSummaryOutput').style.display = 'block';
    
    showToast('✅ Summary generated successfully', 2000);
}

function parseSentimentReportDate(line, label) {
    if (!line || !line.toLowerCase().includes(`${label} date`)) {
        return '';
    }

    const dateMatch = line.match(new RegExp(`${label}\\s+date[:\\s,]*"?([0-9]{1,2}[/\\-][0-9]{1,2}[/\\-][0-9]{2,4})`, 'i'));
    if (dateMatch) {
        return dateMatch[1].trim();
    }

    console.warn(`⚠️ Found "${label} date" line but couldn't parse: "${line}"`);
    return '';
}

function handleSentimentInteractionsMatch(report, inKeywordsSection, allInteractionsMatches, interactionsMatch, line, lineIndex) {
    const callsDetected = parseInt(interactionsMatch[1]);
    const percentage = parseInt(interactionsMatch[2]);
    const totalCalls = parseInt(interactionsMatch[3]);

    console.log(`📊 PARSE DEBUG - FOUND Interactions at line ${lineIndex}: ${percentage}% (inKeywordsSection=${inKeywordsSection})`);
    allInteractionsMatches.push({
        lineIndex,
        lineContent: line,
        callsDetected: callsDetected,
        percentage: percentage,
        totalCalls: totalCalls,
        inKeywordsSection: inKeywordsSection
    });

    if (inKeywordsSection && !report.inKeywordsSection) {
        report.callsDetected = callsDetected;
        report.percentage = percentage;
        report.totalCalls = totalCalls;
        report.inKeywordsSection = true;
        console.log(`✅ SET METRICS (in keywords section): ${callsDetected} detected, ${totalCalls} total, ${percentage}%`);
    } else if (!inKeywordsSection && !report.inKeywordsSection) {
        report.callsDetected = callsDetected;
        report.percentage = percentage;
        report.totalCalls = totalCalls;
        console.log(`⚠️ TENTATIVE METRICS (no keywords section yet): ${callsDetected} detected, ${totalCalls} total, ${percentage}%`);
    }
}

function appendParsedSentimentPhrase(phrases, rawPhrase, value, fallbackMode = 'none') {
    const extracted = extractSentimentSpeakerAndPhrase(rawPhrase);
    if (extracted) {
        phrases.push({ phrase: extracted.phrase, value, speaker: extracted.speaker });
        return true;
    }

    if (fallbackMode === 'defaultA') {
        const cleanPhrase = String(rawPhrase || '').replace(/^"(.*)"$/, '$1');
        phrases.push({ phrase: cleanPhrase, value, speaker: 'A' });
        return true;
    }

    if (fallbackMode === 'simpleTagged') {
        const simpleMatch = String(rawPhrase || '').match(/[+\-#]\s*\(([AC]):\s*"?([^")]+)"?\)/i);
        if (simpleMatch) {
            const speaker = simpleMatch[1].toUpperCase();
            const cleanPhrase = simpleMatch[2].trim();
            phrases.push({ phrase: cleanPhrase, value, speaker });
            return true;
        }
    }

    return false;
}

function parseSentimentKeywordLine(report, line, pendingPhrase) {
    const csvQuotedMatch = line.match(/^"([^"]+(?:""[^"]+)*)",(\d+)/);
    if (csvQuotedMatch) {
        const rawPhrase = csvQuotedMatch[1].replace(/""/g, '"').trim();
        const value = parseInt(csvQuotedMatch[2]);
        appendParsedSentimentPhrase(report.phrases, rawPhrase, value, 'none');
        return { handled: true, pendingPhrase };
    }

    const csvMatch = line.match(/^([^,]+),(\d+)$/);
    if (csvMatch) {
        const rawPhrase = csvMatch[1].trim();
        const value = parseInt(csvMatch[2]);
        appendParsedSentimentPhrase(report.phrases, rawPhrase, value, 'defaultA');
        return { handled: true, pendingPhrase };
    }

    if (line.match(/^[+\-#]/)) {
        return { handled: true, pendingPhrase: line.trim() };
    }

    if (pendingPhrase && line.match(/^\d+$/)) {
        const value = parseInt(line.trim());
        appendParsedSentimentPhrase(report.phrases, pendingPhrase, value, 'simpleTagged');
        return { handled: true, pendingPhrase: null };
    }

    return { handled: false, pendingPhrase };
}

function logSentimentParseCompletion(fileType, report, allInteractionsMatches) {
    console.log(`📊 PARSE COMPLETE [fileType=${fileType}] - All Interactions matches found:`, allInteractionsMatches);
    console.log(`📊 PARSE COMPLETE [fileType=${fileType}] - Final report:`, report);
    console.log(`📊 PARSE COMPLETE [fileType=${fileType}] - Percentages: callsDetected=${report.callsDetected}, totalCalls=${report.totalCalls}, percentage=${report.percentage}%, inKeywordsSection=${report.inKeywordsSection}`);

    if (report.percentage === 0) {
        console.error(`⚠️ WARNING: ${fileType} percentage is 0. This might mean:`);
        console.error(`   - No Interactions line was found in the file`);
        console.error(`   - The regex didn't match the email format`);
        console.error(`   - The Keywords section was never detected (inKeywordsSection=${report.inKeywordsSection})`);
        console.error(`   - All ${allInteractionsMatches.length} Interactions matches were before keywords section`);
    }
}

function isSentimentKeywordsSectionLine(line) {
    const normalized = String(line || '').toLowerCase();
    return normalized.includes('keywords') || normalized.includes('query result metrics');
}

function isSentimentHeaderLine(line) {
    const trimmed = String(line || '').trim();
    return trimmed === 'Name' || trimmed === 'Value' || /^Name,Value/i.test(trimmed);
}

function parseSentimentAssociateName(line) {
    if (!line || line.length <= 10) {
        return '';
    }

    const nameMatch = line.match(/^(?:Employee|Agent|Name)[:\s]+(.+)$/i);
    return nameMatch ? nameMatch[1].trim() : '';
}

function createEmptySentimentReport() {
    return {
        associateName: '',
        startDate: '',
        endDate: '',
        totalCalls: 0,
        callsDetected: 0,
        percentage: 0,
        phrases: [],
        inKeywordsSection: false
    };
}

function parseSentimentFile(fileType, lines) {
    // Parse the "English Speech – Charts Report" format
    console.log(`📊 PARSE START - fileType=${fileType}, total lines=${lines.length}`);
    console.log(`📊 PARSE START - First 10 lines:`, lines.slice(0, 10));
    
    const report = createEmptySentimentReport();
    
    let inKeywordsSection = false;
    let pendingPhrase = null; // For handling phrase/value on separate lines
    let allInteractionsMatches = []; // Track ALL Interactions lines found
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        if (!report.associateName) {
            const associateName = parseSentimentAssociateName(line);
            if (associateName) {
                report.associateName = associateName;
            }
        }
        
        if (!report.startDate) {
            const startDate = parseSentimentReportDate(line, 'start');
            if (startDate) {
                report.startDate = startDate;
                console.log(`✅ Found start date: ${report.startDate}`);
            }
        }

        if (!report.endDate) {
            const endDate = parseSentimentReportDate(line, 'end');
            if (endDate) {
                report.endDate = endDate;
                console.log(`✅ Found end date: ${report.endDate}`);
            }
        }
        
        // Extract total calls and calls with category detected
        // Format in Excel CSV: "Interactions:,165 (76% out of 218 matching data filter),,"
        console.log(`📊 PARSE DEBUG [fileType=${fileType}] - Line ${i}: "${line}"`);
        const interactionsMatch = line.match(/Interactions:?,?\s*(\d+)\s*\(.*?(\d+)%.*?out\s+of\s+(\d+)/i);
        if (interactionsMatch) {
            handleSentimentInteractionsMatch(report, inKeywordsSection, allInteractionsMatches, interactionsMatch, line, i);
            continue;
        }
        
        // Detect keywords section
        if (isSentimentKeywordsSectionLine(line)) {
            inKeywordsSection = true;
            console.log(`✅ Found keywords section at line ${i}`);
            continue;
        }
        
        // Skip "Name" and "Value" header lines
        if (isSentimentHeaderLine(line)) {
            console.log(`Skipping header line: "${line}"`);
            continue;
        }
        
        // Parse keyword phrases - handling BOTH formats
        if (inKeywordsSection && report.totalCalls > 0) {
            const keywordLineResult = parseSentimentKeywordLine(report, line, pendingPhrase);
            pendingPhrase = keywordLineResult.pendingPhrase;
            if (keywordLineResult.handled) {
                continue;
            }
        }
    }
    
    logSentimentParseCompletion(fileType, report, allInteractionsMatches);
    
    return report;
}

function extractSentimentSpeakerAndPhrase(rawPhrase) {
    if (!rawPhrase) return null;
    const compact = String(rawPhrase).trim();
    const tagged = compact.match(/[+\-#]?\s*\(([AC]):\s*(.+)\)$/i);
    if (tagged) {
        return {
            speaker: tagged[1].toUpperCase(),
            phrase: tagged[2].trim().replace(/^"|"$/g, '')
        };
    }

    const direct = compact.match(/^([AC]):\s*(.+)$/i);
    if (direct) {
        return {
            speaker: direct[1].toUpperCase(),
            phrase: direct[2].trim().replace(/^"|"$/g, '')
        };
    }

    return null;
}

function openSentimentPasteModal(fileType) {
    // Create modal backdrop
    const backdrop = document.createElement('div');
    backdrop.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 10000;';
    
    // Create modal dialog
    const modal = document.createElement('div');
    modal.style.cssText = 'background: white; border-radius: 8px; padding: 30px; max-width: 600px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.3);';
    
    modal.innerHTML = `
        <h2 style="margin-top: 0; color: #333;">Paste ${fileType} Sentiment Data</h2>
        <p style="color: #666; margin-bottom: 15px;">Paste your CSV or Excel data below. Format: one entry per line, with columns for Speaker (A/C) and Phrase.</p>
        <textarea id="pasteArea" style="width: 100%; height: 200px; padding: 10px; border: 1px solid #ddd; border-radius: 4px; font-family: monospace; font-size: 12px; resize: vertical;" placeholder="Paste data here..."></textarea>
        <div style="margin-top: 20px; display: flex; gap: 10px; justify-content: flex-end;">
            <button id="pasteCancelBtn" style="padding: 10px 20px; background: #f0f0f0; border: 1px solid #ddd; border-radius: 4px; cursor: pointer; font-size: 14px;">Cancel</button>
            <button id="pasteSubmitBtn" style="padding: 10px 20px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px;">Parse & Import</button>
        </div>
    `;
    
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    
    // Get button references from the modal
    const textarea = modal.querySelector('#pasteArea');
    const cancelBtn = modal.querySelector('#pasteCancelBtn');
    const submitBtn = modal.querySelector('#pasteSubmitBtn');
    
    // Focus textarea
    textarea.focus();
    
    // Cancel button
    cancelBtn.addEventListener('click', () => {
        backdrop.remove();
    });
    
    // Submit button
    submitBtn.addEventListener('click', () => {
        const pastedText = textarea.value.trim();
        if (!pastedText) {
            alert('Please paste some data');
            return;
        }
        
        const lines = pastedText.split('\n').filter(line => line.trim());
        const statusDiv = document.getElementById(`sentiment${fileType}Status`);
        
        statusDiv.textContent = `⏳ Processing pasted ${fileType.toLowerCase()} data...`;
        statusDiv.style.color = '#ff9800';
        
        try {
            // Parse pasted data using existing parser
            const report = parseSentimentFile(fileType, lines);
            sentimentReports[fileType.toLowerCase()] = report;
            
            // Update UI
            syncSentimentSnapshotDateInputsFromReports();
            
            // Show success status
            statusDiv.textContent = `✅ Parsed ${report.phrases.length} sentiment phrase(s) from ${report.speakers.size} speaker(s)`;
            statusDiv.style.color = '#4CAF50';
            
            // Close modal
            backdrop.remove();
        } catch (error) {
            console.error('Error parsing pasted data:', error);
            statusDiv.textContent = `❌ Error: ${error.message}`;
            statusDiv.style.color = '#f44336';
        }
    });
    
    // Close on backdrop click
    backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
            backdrop.remove();
        }
    });
}

function handleSentimentFileChange(fileType) {
    const fileInput = document.getElementById(`sentiment${fileType}File`);
    const statusDiv = document.getElementById(`sentiment${fileType}Status`);
    
    if (!fileInput.files || fileInput.files.length === 0) {
        statusDiv.textContent = 'No file selected';
        statusDiv.style.color = '#666';
        sentimentReports[fileType.toLowerCase()] = null;
        return;
    }
    
    const file = fileInput.files[0];
    const fileName = file.name.toLowerCase();
    const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
    const isEmotions = fileType === 'Emotions';
    
    statusDiv.textContent = `⏳ Processing ${file.name}...`;
    statusDiv.style.color = '#ff9800';
    showLoadingSpinner(`Processing ${escapeHtml(file.name)}...`);
    
    const reader = new FileReader();
    
    reader.onload = (e) => {
        try {
            let lines = [];
            
            if (isExcel) {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                const csvContent = XLSX.utils.sheet_to_csv(firstSheet);
                lines = csvContent.split('\n').filter(line => line.trim());
                if (isEmotions) {
                    console.log(`🎭 MANAGING EMOTIONS - Excel file converted to ${lines.length} lines`);
                    console.log('🎭 First 30 lines:', lines.slice(0, 30));
                }
            } else {
                const content = e.target.result;
                lines = content.split('\n').filter(line => line.trim());
                if (isEmotions) {
                    console.log(`🎭 MANAGING EMOTIONS - Text file has ${lines.length} lines`);
                }
            }
            
            // Parse file
            const report = parseSentimentFile(fileType, lines);
            sentimentReports[fileType.toLowerCase()] = report;
            
            if (isEmotions) {
                console.log(`🎭 MANAGING EMOTIONS - Parsed result:`, {
                    name: report.associateName,
                    totalCalls: report.totalCalls,
                    detected: report.callsDetected,
                    percentage: report.percentage,
                    phrasesCount: report.phrases.length,
                    allPhrases: report.phrases
                });
            } else {
                console.log(`✅ Parsed ${fileType}:`, {
                    name: report.associateName,
                    totalCalls: report.totalCalls,
                    detected: report.callsDetected,
                    percentage: report.percentage,
                    phrasesCount: report.phrases.length
                });
            }
            
            statusDiv.textContent = `✅ ${escapeHtml(report.associateName || 'Loaded')} - ${report.totalCalls} calls, ${report.phrases.length} phrases`;
            statusDiv.style.color = '#4caf50';
            syncSentimentSnapshotDateInputsFromReports();
            hideLoadingSpinner();
        } catch (error) {
            statusDiv.textContent = `❌ Error parsing file`;
            statusDiv.style.color = '#f44336';
            console.error('File parsing error:', error);
            if (isEmotions) {
                console.error('🎭 MANAGING EMOTIONS ERROR:', error);
            }
            hideLoadingSpinner();
            showToast(`❌ Failed to parse ${fileType} file: ${error.message}`, 5000);
        }
    };
    
    reader.onerror = () => {
        statusDiv.textContent = '❌ Failed to read file';
        statusDiv.style.color = '#f44336';
        hideLoadingSpinner();
        showToast('❌ Failed to read file', 5000);
    };
    
    if (isExcel) {
        reader.readAsArrayBuffer(file);
    } else {
        reader.readAsText(file);
    }
}

// ===== UPLOAD SENTIMENT MODAL FUNCTIONS =====

function openUploadSentimentModal() {
    const modal = document.getElementById('uploadSentimentModal');
    if (!modal) return;
    
    // Populate associate dropdown
    populateSentimentAssociateDropdown();
    
    // Reset form
    document.getElementById('sentimentUploadAssociate').value = '';
    document.getElementById('sentimentUploadPullDate').value = '';
    document.getElementById('sentimentUploadPositiveFile').value = '';
    document.getElementById('sentimentUploadNegativeFile').value = '';
    document.getElementById('sentimentUploadEmotionsFile').value = '';
    const statusDiv = document.getElementById('sentimentUploadStatus');
    if (statusDiv) {
        statusDiv.style.display = 'none';
        statusDiv.textContent = '';
    }
    
    modal.style.display = 'flex';
}

function closeUploadSentimentModal() {
    const modal = document.getElementById('uploadSentimentModal');
    if (modal) modal.style.display = 'none';
}

function populateSentimentAssociateDropdown() {
    const select = document.getElementById('sentimentUploadAssociate');
    if (!select) return;
    
    const allEmployees = new Set();
    const teamFilterContext = getTeamSelectionContext();
    
    // Collect all unique employee names from weeklyData
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
    
    // Sort and populate dropdown
    const sortedEmployees = Array.from(allEmployees).sort();
    select.innerHTML = '<option value="">-- Select an associate --</option>';
    sortedEmployees.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });
}

function handleSentimentUploadSubmit() {
    const associate = document.getElementById('sentimentUploadAssociate').value;
    const pullDate = document.getElementById('sentimentUploadPullDate').value;
    const positiveFileInput = document.getElementById('sentimentUploadPositiveFile');
    const negativeFileInput = document.getElementById('sentimentUploadNegativeFile');
    const emotionsFileInput = document.getElementById('sentimentUploadEmotionsFile');
    const statusDiv = document.getElementById('sentimentUploadStatus');
    
    // Validation
    if (!associate) {
        alert('Please select an associate');
        return;
    }
    if (!pullDate) {
        alert('Please enter the pull date');
        return;
    }
    
    // Check if at least one file is selected
    const hasPositive = positiveFileInput.files && positiveFileInput.files.length > 0;
    const hasNegative = negativeFileInput.files && negativeFileInput.files.length > 0;
    const hasEmotions = emotionsFileInput.files && emotionsFileInput.files.length > 0;
    
    if (!hasPositive && !hasNegative && !hasEmotions) {
        alert('Please select at least one sentiment file to upload');
        return;
    }
    
    // Calculate date range (14 days prior to pull date)
    const endDate = pullDate;
    const pullDateObj = new Date(pullDate);
    pullDateObj.setDate(pullDateObj.getDate() - 14);
    const startDate = pullDateObj.toISOString().split('T')[0];
    
    // Initialize snapshot storage
    if (!associateSentimentSnapshots[associate]) {
        associateSentimentSnapshots[associate] = {};
    }
    
    const timeframeKey = `${startDate}_${endDate}`;
    if (!associateSentimentSnapshots[associate][timeframeKey]) {
        associateSentimentSnapshots[associate][timeframeKey] = {
            startDate,
            endDate,
            pullDate,
            positive: null,
            negative: null,
            emotions: null
        };
    }
    
    statusDiv.textContent = '⏳ Processing files...';
    statusDiv.style.color = '#ff9800';
    statusDiv.style.display = 'block';
    
    // Process files
    const filePromises = [];
    
    if (hasPositive) {
        filePromises.push(
            processUploadedSentimentFile(positiveFileInput.files[0], 'Positive', associate, timeframeKey)
        );
    }
    
    if (hasNegative) {
        filePromises.push(
            processUploadedSentimentFile(negativeFileInput.files[0], 'Negative', associate, timeframeKey)
        );
    }
    
    if (hasEmotions) {
        filePromises.push(
            processUploadedSentimentFile(emotionsFileInput.files[0], 'Emotions', associate, timeframeKey)
        );
    }
    
    Promise.all(filePromises)
        .then(results => {
            // Save all processed data
            results.forEach(({ type, report }) => {
                const typeKey = type.toLowerCase();
                // Only save phrases - percentages come from weekly metrics, not sentiment files
                associateSentimentSnapshots[associate][timeframeKey][typeKey] = {
                    phrases: report.phrases
                };
            });
            
            // Save to localStorage
            saveAssociateSentimentSnapshots();
            
            // IMPORTANT: Convert from old format to new array format immediately
            loadAssociateSentimentSnapshots();  // This migrates old format to new array format
            
            // Repopulate dropdown with migrated data
            if (window.setupMetricTrendsListeners && typeof setupMetricTrendsListeners === 'function') {
                const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');
                if (trendEmployeeSelect && trendEmployeeSelect.value === associate) {
                    populateTrendSentimentDropdown(associate);
                }
            }
            
            const uploadedTypes = results.map(r => r.type).join(', ');
            statusDiv.textContent = `✅ Saved ${uploadedTypes} for ${associate} (pulled ${pullDate})`;
            statusDiv.style.color = '#4CAF50';
            
            showToast(`✅ Sentiment data saved for ${associate}`, 3000);
            
            // Close modal after short delay
            setTimeout(() => {
                closeUploadSentimentModal();
            }, 1500);
        })
        .catch(error => {
            statusDiv.textContent = `❌ Error: ${error.message}`;
            statusDiv.style.color = '#f44336';
            console.error('Upload sentiment error:', error);
        });
}

function processUploadedSentimentFile(file, type, associate, timeframeKey) {
    return new Promise((resolve, reject) => {
        const fileName = file.name.toLowerCase();
        const isExcel = fileName.endsWith('.xlsx') || fileName.endsWith('.xls');
        console.log(`📊 PROCESS START - File: ${file.name}, Type: ${type}, Associate: ${associate}, TimeframeKey: ${timeframeKey}`);
        
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                let lines = [];
                
                if (isExcel) {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
                    const csvContent = XLSX.utils.sheet_to_csv(firstSheet);
                    lines = csvContent.split('\n').filter(line => line.trim());
                } else {
                    const content = e.target.result;
                    lines = content.split('\n').filter(line => line.trim());
                }
                
                // Parse file
                const report = parseSentimentFile(type, lines);
                console.log(`📊 PROCESS PARSED - Type: ${type}, Report percentage: ${report.percentage}%, callsDetected: ${report.callsDetected}, totalCalls: ${report.totalCalls}`);
                resolve({ type, report });
                
            } catch (error) {
                reject(new Error(`Failed to parse ${type} file: ${error.message}`));
            }
        };
        
        reader.onerror = () => {
            reject(new Error(`Failed to read ${type} file`));
        };
        
        if (isExcel) {
            reader.readAsArrayBuffer(file);
        } else {
            reader.readAsText(file);
        }
    });
}

function copySentimentSummary() {
    const summaryText = document.getElementById('sentimentSummaryText').textContent;
    
    if (!summaryText.trim()) {
        alert('⚠️ No summary to copy. Generate a summary first.');
        return;
    }
    
    // Copy to clipboard
    navigator.clipboard.writeText(summaryText).then(() => {
        const button = document.getElementById('copySentimentSummaryBtn');
        const originalText = button.textContent;
        button.textContent = '✅ Copied!';
        setTimeout(() => {
            button.textContent = originalText;
        }, 2000);
        showToast('✅ Summary copied to clipboard', 2000);
    }).catch(() => {
        // Fallback for older browsers
        const textarea = document.createElement('textarea');
        textarea.value = summaryText;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        showToast('✅ Summary copied to clipboard', 2000);
    });
}

function generateSentimentCoPilotPrompt() {
    const { positive, negative, emotions } = sentimentReports;
    
    if (!positive || !negative || !emotions) {
        alert('⚠️ Please generate the summary first');
        return;
    }
    
    const associateName = positive.associateName || 'the associate';
    const delegatedPrompt = window.DevCoachModules?.sentiment?.buildSentimentCopilotPrompt?.(
        { positive, negative, emotions },
        {
            associateName,
            POSITIVE_GOAL: 86,
            NEGATIVE_GOAL: 83,
            EMOTIONS_GOAL: 95,
            MIN_PHRASE_VALUE,
            TOP_PHRASES_COUNT,
            escapeHtml
        }
    );
    const prompt = delegatedPrompt || '';

    if (!prompt) {
        alert('⚠️ Could not generate CoPilot prompt from sentiment data.');
        return;
    }
    
    // Copy to clipboard and show feedback
    navigator.clipboard.writeText(prompt).then(() => {
        showToast('✅ CoPilot prompt copied! Opening CoPilot...', 2000);
        setTimeout(() => {
            window.open('https://copilot.microsoft.com', '_blank');
        }, 500);
    }).catch(() => {
        alert('Could not copy. Here\'s the prompt to manually copy:\n\n' + prompt);
    });
}








