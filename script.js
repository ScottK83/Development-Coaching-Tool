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
const APP_VERSION = '2026.02.20.79'; // Version: YYYY.MM.DD.NN
const DEBUG = true; // Set to true to enable console logging
const STORAGE_PREFIX = 'devCoachingTool_'; // Namespace for localStorage keys

if (!DEBUG) {
    const originalError = console.error;
    console.log = () => {};
    console.warn = () => {};
    console.error = (...args) => {
        // Still capture errors even when DEBUG is off
        lastError = { message: args.join(' '), timestamp: new Date().toISOString() };
        localStorage.setItem(STORAGE_PREFIX + 'lastError', JSON.stringify(lastError));
    };
}

// Global error handler
window.addEventListener('error', (event) => {
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
let debugState = { entries: [] };
let sentimentPhraseDatabase = null;
let associateSentimentSnapshots = {};

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
    }
};

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
        target: { type: 'min', value: 84 },
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
        target: { type: 'max', value: 432 },
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
    }
}

/**
 * Show a specific sub-section within the Coaching & Analysis section
 */
function showSubSection(subSectionId) {
    // Hide all sub-sections
    const subSections = ['subSectionCoachingEmail', 'subSectionYearEnd', 'subSectionSentiment', 'subSectionMetricTrends', 'subSectionTrendIntelligence'];
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
    const subNavButtons = ['subNavCoachingEmail', 'subNavYearEnd', 'subNavSentiment', 'subNavMetricTrends', 'subNavTrendIntelligence'];
    subNavButtons.forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            if (btnId.replace('subNav', 'subSection') === subSectionId) {
                btn.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
                btn.style.opacity = '1';
            } else {
                btn.style.background = '#ccc';
                btn.style.opacity = '0.7';
            }
        }
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

function htmlToPlainText(html) {
    if (!html) return '';
    return html
        .replace(/<style[\s\S]*?<\/style>/gi, '')
        .replace(/<script[\s\S]*?<\/script>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

// ============================================
// DATA PARSING FUNCTIONS (FIXED)
// ============================================

/**
 * Parse a PowerBI data row
 * Finds where the name ends (first digit/N/A/(Blank)) then extracts remaining metrics
 */
function parsePowerBIRow(row) {
    // Normalize weird PowerBI spaces (including non-breaking spaces)
    row = row.replace(/\u00A0/g, ' ').trim();
    // Collapse cases like "95.2 %" -> "95.2%" so splitting stays aligned
    row = row.replace(/(\d+(?:\.\d+)?)\s+%/g, '$1%');
    
    // Match: name (stops at first digit, N/A, or (Blank)) + start of first metric
    const match = row.match(/^(.+?)\s+(?=(\(?\d|N\/A|\(Blank\)))/);
    
    if (!match) {
        throw new Error(`Row does not match expected format: "${row.substring(0, 50)}..."`);
    }
    
    const name = match[1].trim();
    const rest = row.slice(match[0].length).trim();
    
    // Split the metrics by any whitespace (1+ spaces or tabs)
    let metrics = rest.split(/\s+/);
    
    // Normalize values: handle (Blank), N/A, percentages, numbers
    metrics = metrics.map(val => {
        if (val === '(Blank)' || val === 'N/A') return null;
        val = val.replace(/,/g, '');
        if (val.endsWith('%')) return parseFloat(val);
        if (!isNaN(val) && val !== '') return Number(val);
        return val;
    });
    
    return [name, ...metrics];
}

/**
 * Parse percentage values properly
 * Handles: "83%", "0.83", 83, null, "N/A"
 * Returns: 83 (as number) or 0
 */
function parsePercentage(value) {
    if (!value && value !== 0) return 0;
    if (value === 'N/A' || value === 'n/a' || value === '') return 0;
    
    // Remove % sign if present
    if (typeof value === 'string') {
        value = value.replace('%', '').trim();
    }
    
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return 0;
    
    // If value is between 0 and 1, it's a decimal representation (0.83 = 83%)
    if (parsed > 0 && parsed < 1) {
        return parseFloat((parsed * 100).toFixed(2));
    }
    
    // If value is between 1 and 100, it's already a percentage
    if (parsed >= 1 && parsed <= 100) {
        return parseFloat(parsed.toFixed(2));
    }
    
    // If value > 100, something is wrong - likely wrong column
    // This catches the 424% transfers bug
    if (parsed > 100) {
        
        console.trace('Called from:');
        return 0;
    }
    
    return parseFloat(parsed.toFixed(2));
}

/**
 * Parse survey percentages (can be empty)
 * Returns: percentage or empty string
 */
function parseSurveyPercentage(value) {
    if (!value && value !== 0) return '';
    if (value === 'N/A' || value === 'n/a' || value === '') return '';
    
    // Remove % sign if present
    if (typeof value === 'string') {
        value = value.replace('%', '').trim();
    }
    
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return '';
    
    // If value is between 0 and 1, it's a decimal representation
    if (parsed > 0 && parsed < 1) {
        return parseFloat((parsed * 100).toFixed(2));
    }
    
    // If value is between 1 and 100, it's already a percentage
    if (parsed >= 1 && parsed <= 100) {
        return parseFloat(parsed.toFixed(2));
    }
    
    // If value > 100, something is wrong
    if (parsed > 100) {
        
        return '';
    }
    
    return parseFloat(parsed.toFixed(2));
}

/**
 * Parse time in seconds
 * Handles: "480", 480, "0", 0, null
 * Returns: integer seconds or empty string (keeps 0 as 0)
 */
function parseSeconds(value) {
    if (value === '' || value === null || value === undefined) return '';
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return '';
    return Math.round(parsed);
}

/**
 * Parse hours (for reliability)
 * Handles: "2.5", 2.5, 0, null
 * Returns: decimal hours
 */
function parseHours(value) {
    if (!value && value !== 0) return 0;
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return 0;
    return parseFloat(parsed.toFixed(2));
}

// ============================================
// CANONICAL SCHEMA & HEADER MAPPING
// ============================================

// POWERBI SCHEMA - EXACTLY 23 COLUMNS IN THIS ORDER
// This is the ground truth for all data parsing
const POWERBI_COLUMNS = [
    'Name (Last, First)',
    'TotalCallsAnswered',
    'Transfers%',
    'Number of Transfers',
    'AHT',
    'Talk',
    'Hold',
    'ACW',
    'Adherence%',
    'ManageEmotionsScore%',
    'AvoidNegativeWordScore%',
    'PositiveWordScore%',
    'OverallSentimentScore%',
    'FCR%',
    'OverallFCRTotal',
    'RepSat%',
    'OverallRepTotal',
    'OverallExperience%',
    'OE Survey Total',
    'TotalIn-OfficeShrink%',
    'TotalOOOShrink%',
    'TotalShrinkage%',
    'ReliabilityHours'
];

// Map PowerBI columns to canonical schema
const CANONICAL_SCHEMA = {
    EMPLOYEE_NAME: 'employee_name',
    ADHERENCE_PERCENT: 'adherence_percent',
    CX_REP_OVERALL: 'cx_rep_overall_percent',
    FCR_PERCENT: 'first_call_resolution_percent',
    OVERALL_EXPERIENCE: 'overall_experience_percent',
    TRANSFERS_PERCENT: 'transfer_percent',
    TRANSFERS_COUNT: 'transfer_count',
    AHT_SECONDS: 'average_handle_time_seconds',
    TALK_SECONDS: 'talk_time_seconds',
    ACW_SECONDS: 'after_call_work_seconds',
    HOLD_SECONDS: 'hold_time_seconds',
    RELIABILITY_HOURS: 'reliability_hours',
    SENTIMENT_PERCENT: 'overall_sentiment_percent',
    POSITIVE_WORD_PERCENT: 'positive_word_percent',
    NEGATIVE_WORD_PERCENT: 'avoid_negative_word_percent',
    EMOTIONS_PERCENT: 'manage_emotions_percent',
    SURVEY_TOTAL: 'survey_total',
    TOTAL_CALLS: 'total_calls_answered'
};

// Column mapping: PowerBI column position ? canonical schema
// Using positional indexing (column 0 = Name, column 1 = TotalCalls, etc.)
const COLUMN_MAPPING = {
    0: CANONICAL_SCHEMA.EMPLOYEE_NAME,
    1: CANONICAL_SCHEMA.TOTAL_CALLS,
    2: CANONICAL_SCHEMA.TRANSFERS_PERCENT,
    3: CANONICAL_SCHEMA.TRANSFERS_COUNT,
    4: CANONICAL_SCHEMA.AHT_SECONDS,
    5: CANONICAL_SCHEMA.TALK_SECONDS,
    6: CANONICAL_SCHEMA.HOLD_SECONDS,
    7: CANONICAL_SCHEMA.ACW_SECONDS,
    8: CANONICAL_SCHEMA.ADHERENCE_PERCENT,
    9: CANONICAL_SCHEMA.EMOTIONS_PERCENT,
    10: CANONICAL_SCHEMA.NEGATIVE_WORD_PERCENT,
    11: CANONICAL_SCHEMA.POSITIVE_WORD_PERCENT,
    12: CANONICAL_SCHEMA.SENTIMENT_PERCENT,
    13: CANONICAL_SCHEMA.FCR_PERCENT,
    14: CANONICAL_SCHEMA.CX_REP_OVERALL, // OverallFCRTotal
    15: CANONICAL_SCHEMA.CX_REP_OVERALL, // RepSat%
    16: CANONICAL_SCHEMA.CX_REP_OVERALL, // OverallRepTotal
    17: CANONICAL_SCHEMA.OVERALL_EXPERIENCE,
    18: CANONICAL_SCHEMA.SURVEY_TOTAL,   // OE Survey Total
    19: 'TotalIn-OfficeShrink%',
    20: 'TotalOOOShrink%',
    21: 'TotalShrinkage%',
    22: CANONICAL_SCHEMA.RELIABILITY_HOURS
};

// Map headers to canonical schema - validates we have exactly 23 columns
function mapHeadersToSchema(headers) {
    // Validate we have exactly 23 columns
    if (headers.length !== 23) {
        throw new Error(`Expected exactly 23 columns, found ${headers.length}. PowerBI data must have all 23 columns in order.`);
    }
    
    const mapping = {};
    
    // Map by position
    for (let i = 0; i < 23; i++) {
        if (COLUMN_MAPPING[i]) {
            mapping[COLUMN_MAPPING[i]] = i;
        }
    }
    
    
    for (let i = 0; i < 23; i++) {
        
    }
    
    return mapping;
}

// ============================================
// DATA LOADING - PASTED DATA
// ============================================

function parsePastedData(pastedText, startDate, endDate) {
    const lines = pastedText.split('\n').map(line => line.trim()).filter(line => line);
    
    if (lines.length < 2) {
        throw new Error('Data appears incomplete. Please paste header row and data rows.');
    }
    
    const headerLine = lines[0];
    const hasNameHeader = headerLine.toLowerCase().includes('name');
    
    if (!hasNameHeader) {
        throw new Error('ℹ️ Header row not found! Make sure to include the header row at the top of your pasted data.');
    }
    
    // Build header index map for flexible column detection
    const headers = headerLine.split('\t').map(h => h.toLowerCase());
    
    const findColumnIndex = (keywords) => {
        const matchesKeyword = (header, keyword) => {
            const hLower = header.toLowerCase();
            const kLower = keyword.toLowerCase();
            
            // Exact match
            if (hLower === kLower) return true;
            
            // Normalize: replace separators with pipes, remove non-alphanumeric except pipes
            const normalize = (str) => str.replace(/[\s\-_]+/g, '|').replace(/[^a-z0-9|]/g, '');
            const normalizedHeader = normalize(hLower);
            const normalizedKeyword = normalize(kLower);
            
            // Check if normalized keyword appears in normalized header
            if (normalizedHeader.includes(normalizedKeyword)) return true;
            
            // Also check if all words from keyword appear in header in order (even if concatenated)
            // e.g., "overall sentiment" should match "overallsentimentscore"
            const keywordWords = kLower.split(/[\s\-_]+/).filter(w => w.length > 0);
            let searchPos = 0;
            for (const word of keywordWords) {
                const foundPos = hLower.indexOf(word, searchPos);
                if (foundPos === -1) return false;
                searchPos = foundPos + word.length;
            }
            return true;
        };
        
        if (Array.isArray(keywords)) {
            return headers.findIndex(h => keywords.some(k => matchesKeyword(h, k)));
        }
        return headers.findIndex(h => matchesKeyword(h, keywords));
    };

    
    // Map all column indices by searching headers
    const colMap = {
        name: findColumnIndex('name'),
        totalCalls: findColumnIndex(['totalcalls', 'answered']),
        transfers: findColumnIndex(['transfers', 'transfer %']),
        transfersCount: findColumnIndex(['number of transfers']),
        aht: findColumnIndex(['aht', 'average handle']),
        talkTime: findColumnIndex(['talk']),
        holdTime: findColumnIndex(['hold']),
        acw: findColumnIndex(['acw', 'after call']),
        adherence: findColumnIndex(['adherence', 'schedule']),
        emotions: findColumnIndex(['managing emotions', 'emotion']),
        negativeWord: findColumnIndex(['avoid negative', 'negative word']),
        positiveWord: findColumnIndex(['positive word']),
        sentiment: findColumnIndex(['overall sentiment']),
        fcr: findColumnIndex(['fcr', 'first call resolution']),
        cxRepOverall: findColumnIndex(['rep satisfaction', 'rep sat', 'repsat']),
        overallExperience: findColumnIndex(['overall experience', 'overallexperience']),
        surveyTotal: findColumnIndex(['oe survey', 'survey total']),
        reliability: findColumnIndex(['reliability', 'reliability hours'])
    };
    
    // DEBUG: Log headers and column mapping
    if (DEBUG) {
        console.error('=== COLUMN MAPPING ===');
        console.error(`sentiment: ${colMap.sentiment}, header: "${headers[colMap.sentiment]}"`);
        console.error(`emotions: ${colMap.emotions}, header: "${headers[colMap.emotions]}"`);
        console.error(`negativeWord: ${colMap.negativeWord}, header: "${headers[colMap.negativeWord]}"`);
        console.error(`positiveWord: ${colMap.positiveWord}, header: "${headers[colMap.positiveWord]}"`);
        console.log('=== HEADERS ===');
        headers.forEach((h, idx) => console.log(`[${idx}] ${h}`));
        console.log('=== COLUMN MAPPING (details) ===');
        console.log(`surveyTotal index: ${colMap.surveyTotal}, header: "${headers[colMap.surveyTotal]}"`);
    }
    // DEBUG: Log column mapping
    if (DEBUG) {
        console.log('====== PASTED DATA DEBUG ======');
        console.log('Raw headers:', headerLine);
        console.log('Lowercased headers array:', headers);
        console.log('Column indices detected:');
        for (const [key, index] of Object.entries(colMap)) {
            const headerName = index >= 0 ? headers[index] : 'NOT FOUND';
            console.log(`  ${key}: index=${index}, header="${headerName}"`);
        }
        console.log('================================');
    }
    
    // Helper to safely get cell value
    const getCell = (cells, colIndex) => {
        if (colIndex < 0) return '';
        const value = cells[colIndex];
        return (value === null || value === undefined) ? '' : value;
    };
    
    // Parse employee data
    const employees = [];
    
    for (let i = 1; i < lines.length; i++) {
        const rawRow = lines[i];
        
        if (!rawRow.trim()) continue;
        
        let cells;
        try {
            const parsed = parsePowerBIRow(rawRow);
            cells = parsed;
        } catch (error) {
            continue;
        }
        
        // Extract name
        const nameField = getCell(cells, colMap.name);
        let firstName = '', lastName = '';
        
        const lastFirstMatch = nameField.match(/^([^,]+),\s*(.+)$/);
        if (lastFirstMatch) {
            lastName = lastFirstMatch[1].trim();
            firstName = lastFirstMatch[2].trim();
        } else {
            const parts = nameField.trim().split(/\s+/);
            if (parts.length >= 2) {
                firstName = parts[0];
                lastName = parts.slice(1).join(' ');
            } else if (parts.length === 1) {
                firstName = parts[0];
            }
        }
        
        const displayName = `${firstName} ${lastName}`.trim();
        
        // Parse all metrics using flexible column mapping
        const totalCallsRaw = getCell(cells, colMap.totalCalls);
        const parsedTotalCalls = parseInt(totalCallsRaw, 10);
        if (!Number.isInteger(parsedTotalCalls)) {
            continue;
        }
        
        const surveyTotalRaw = getCell(cells, colMap.surveyTotal);
        const surveyTotal = Number.isInteger(parseInt(surveyTotalRaw, 10)) ? parseInt(surveyTotalRaw, 10) : 0;
        let totalCalls = parsedTotalCalls;
        if (DEBUG) console.log(`${displayName} - surveyTotalRaw="${surveyTotalRaw}", surveyTotal=${surveyTotal}, colMap.surveyTotal=${colMap.surveyTotal}, totalCalls=${totalCalls}`);
        
        const employeeData = {
            name: displayName,
            firstName: firstName,
            scheduleAdherence: parsePercentage(getCell(cells, colMap.adherence)) || 0,
            cxRepOverall: parseSurveyPercentage(getCell(cells, colMap.cxRepOverall)),
            fcr: parseSurveyPercentage(getCell(cells, colMap.fcr)),
            overallExperience: parseSurveyPercentage(getCell(cells, colMap.overallExperience)),
            transfers: parsePercentage(getCell(cells, colMap.transfers)) || 0,
            transfersCount: parseInt(getCell(cells, colMap.transfersCount)) || 0,
            aht: parseSeconds(getCell(cells, colMap.aht)) || '',
            talkTime: parseSeconds(getCell(cells, colMap.talkTime)) || '',
            acw: parseSeconds(getCell(cells, colMap.acw)),
            holdTime: parseSeconds(getCell(cells, colMap.holdTime)),
            reliability: parseHours(getCell(cells, colMap.reliability)) || 0,
            overallSentiment: parsePercentage(getCell(cells, colMap.sentiment)) || '',
            positiveWord: parsePercentage(getCell(cells, colMap.positiveWord)) || '',
            negativeWord: parsePercentage(getCell(cells, colMap.negativeWord)) || '',
            managingEmotions: parsePercentage(getCell(cells, colMap.emotions)) || '',
            surveyTotal: surveyTotal,
            totalCalls: totalCalls
        };
        
        // Data integrity check: surveyTotal cannot exceed totalCalls
        if (employeeData.surveyTotal > employeeData.totalCalls && employeeData.totalCalls > 0) {
            console.warn(`⚠️ DATA INTEGRITY WARNING: ${displayName}: surveyTotal (${employeeData.surveyTotal}) > totalCalls (${employeeData.totalCalls}). This suggests the wrong column was detected for survey data.`);
            if (DEBUG) {
                console.log(`  Raw data for this employee:`, cells);
                console.log(`  totalCalls col ${colMap.totalCalls}: "${getCell(cells, colMap.totalCalls)}"`);
                console.log(`  surveyTotal col ${colMap.surveyTotal}: "${getCell(cells, colMap.surveyTotal)}"`);
                console.log(`  aht col ${colMap.aht}: "${getCell(cells, colMap.aht)}"`);
            }
        }
        
        if (i <= 3 && DEBUG) {
            console.log(`FIRST FEW ROWS DEBUG - ${displayName}:`);
            console.log(`  All raw cells:`, cells);
            for (let c = 0; c < cells.length; c++) {
                console.log(`    [${c}] "${cells[c]}" -> header: "${headers[c]}"`);
            }
        }
        
        employees.push(employeeData);
    }
    
    
    return employees;
}

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

function loadCustomMetrics() {
    try {
        const saved = localStorage.getItem(STORAGE_PREFIX + 'customMetrics');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading custom metrics:', error);
        return {};
    }
}

function saveCustomMetrics(metrics) {
    try {
        localStorage.setItem(STORAGE_PREFIX + 'customMetrics', JSON.stringify(metrics));
    } catch (error) {
        console.error('Error saving custom metrics:', error);
    }
}

function normalizeMetricKey(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

*/


// ============================================
// STORAGE FUNCTIONS
// ============================================

function loadWeeklyData() {
    try {
        const saved = localStorage.getItem(STORAGE_PREFIX + 'weeklyData');
        const data = saved ? JSON.parse(saved) : {};
        return data;
    } catch (error) {
        console.error('Error loading weekly data:', error);
        return {};
    }
}

function saveWithSizeCheck(key, data) {
    const str = JSON.stringify(data);
    const sizeInMB = new Blob([str]).size / 1024 / 1024;
    
    if (sizeInMB > LOCALSTORAGE_MAX_SIZE_MB) {
        showToast(`⚠️ Data too large (${sizeInMB.toFixed(1)}MB). Consider exporting old data.`, 5000);
        return false;
    }
    
    try {
        localStorage.setItem(STORAGE_PREFIX + key, str);
        return true;
    } catch (e) {
        if (e.name === 'QuotaExceededError') {
            showToast('❌ Storage full! Please export/delete old data.', 5000);
        } else {
            console.error('Failed to save to localStorage:', e);
        }
        return false;
    }
}

function saveWeeklyData() {
    try {
        if (!saveWithSizeCheck('weeklyData', weeklyData)) {
            console.error('Failed to save weekly data due to size');
        }
    } catch (error) {
        console.error('Error saving weekly data:', error);
    }
}

function loadYtdData() {
    try {
        const saved = localStorage.getItem(STORAGE_PREFIX + 'ytdData');
        const data = saved ? JSON.parse(saved) : {};
        return data;
    } catch (error) {
        console.error('Error loading YTD data:', error);
        return {};
    }
}

function saveYtdData() {
    try {
        if (!saveWithSizeCheck('ytdData', ytdData)) {
            console.error('Failed to save YTD data due to size');
        }
    } catch (error) {
        console.error('Error saving YTD data:', error);
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
    
    showToast(`✅ Exported ${weekCount} weeks + ${sentimentCount} sentiment snapshots to ${exportFileDefaultName}`, 5000);
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
    } catch (error) {
        console.error('Error saving team members:', error);
    }
}

function setTeamMembersForWeek(weekKey, memberNames) {
    myTeamMembers[weekKey] = memberNames;
    saveTeamMembers();
}

function getTeamMembersForWeek(weekKey) {
    return myTeamMembers[weekKey] || [];
}

function isTeamMember(weekKey, employeeName) {
    const members = getTeamMembersForWeek(weekKey);
    return members.length === 0 || members.includes(employeeName);
}

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
    } catch (error) {
        console.error('Error saving call center averages:', error);
    }
}

function calculateAveragesFromEmployees(employees) {
    if (!employees || employees.length === 0) return null;

    
    // Filter out employees with 0 calls answered
    const activeEmployees = employees.filter(emp => {
        const totalCalls = parseInt(emp.totalCalls);
        return !isNaN(totalCalls) && totalCalls > 0;
    });



    if (activeEmployees.length === 0) return null;

    const keyMapping = {
        scheduleAdherence: 'adherence',
        overallSentiment: 'sentiment',
        cxRepOverall: 'repSatisfaction'
    };

    const sums = {};
    const counts = {};

    activeEmployees.forEach(emp => {
        Object.keys(emp).forEach(key => {
            if (key === 'name' || key === 'id' || key === 'firstName' || key === 'surveyTotal' || key === 'totalCalls' || key === 'talkTime') return;

            const mappedKey = keyMapping[key] || key;
            const value = parseFloat(emp[key]);

            // Include any numeric value (including 0) - only skip if NaN (missing/blank)
            if (!isNaN(value)) {
                sums[mappedKey] = (sums[mappedKey] || 0) + value;
                counts[mappedKey] = (counts[mappedKey] || 0) + 1;
            }
        });
    });

    const averages = {};
    Object.keys(sums).forEach(key => {
        averages[key] = parseFloat((sums[key] / counts[key]).toFixed(2));
    });

    
    
    averages.employeeCount = activeEmployees.length;

    return Object.keys(averages).length > 0 ? averages : null;
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

function getTodayYYYYMMDD() {
    return new Date().toISOString().slice(0, 10);
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
    
    // For week/month/quarter: currentPeriod is the weekKey
    if (currentPeriod && weeklyData[currentPeriod] && currentPeriodType !== 'ytd') {
        weeklyData[currentPeriod].employees.forEach(emp => {
            // Only add if they're on the team (or no team selection yet)
            if (isTeamMember(currentPeriod, emp.name)) {
                employees.add(emp.name);
            }
        });
    } else if (currentPeriodType === 'ytd' && currentPeriod && ytdData[currentPeriod]) {
        ytdData[currentPeriod].employees.forEach(emp => {
            employees.add(emp.name);
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

function resetEmployeeSelection() {
    const employeeSelect = document.getElementById('employeeSelect');
    if (employeeSelect) {
        employeeSelect.selectedIndex = 0; // Reset to "-- Choose an employee --"
    }
    
    // Clear metrics from registry
    Object.keys(METRICS_REGISTRY).forEach(metricKey => {
        const input = document.getElementById(metricKey);
        if (input) {
            input.value = '';
            input.style.background = '';
            input.style.borderColor = '';
        }
    });
    
    // Clear employee name
    const employeeNameInput = document.getElementById('employeeName');
    if (employeeNameInput) employeeNameInput.value = '';
    
    // Hide sections
    ['metricsSection', 'employeeInfoSection', 'customNotesSection', 'generateEmailBtn'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    });
}

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

function copyToClipboard() {
    const emailOutput = document.getElementById('emailOutput');
    const text = emailOutput.innerText;
    
    navigator.clipboard.writeText(text).then(() => {
        showToast('✅ Email copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy:', err);
        showToast('✅ Failed to copy to clipboard');
    });
}

// ============================================
// EVENT HANDLERS
// ============================================

function initializeEventHandlers() {
    
    // Upload period type buttons
    document.querySelectorAll('.upload-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update button styles
            document.querySelectorAll('.upload-period-btn').forEach(b => {
                if (b === btn) {
                    b.style.background = '#28a745';
                    b.style.borderColor = '#28a745';
                    b.style.color = 'white';
                } else {
                    b.style.background = 'white';
                    b.style.borderColor = '#ddd';
                    b.style.color = '#666';
                }
            });
        });
    });
    
    // Upload Data section - show/hide upload types
    document.getElementById('showUploadMetricsBtn')?.addEventListener('click', () => {
        const container = document.getElementById('pasteDataContainer');
        if (container) {
            container.style.display = container.style.display === 'none' ? 'block' : 'none';
        }
    });
    
    document.getElementById('showUploadSentimentBtn')?.addEventListener('click', () => {
        openUploadSentimentModal();
    });
    
    // Upload Sentiment Modal handlers
    document.getElementById('sentimentUploadCancelBtn')?.addEventListener('click', closeUploadSentimentModal);
    document.getElementById('sentimentUploadSubmitBtn')?.addEventListener('click', handleSentimentUploadSubmit);
    
    // Tab navigation
    document.getElementById('homeBtn')?.addEventListener('click', () => showOnlySection('coachingForm'));
    document.getElementById('manageTips')?.addEventListener('click', () => {
        showOnlySection('manageDataSection');
        populateDeleteWeekDropdown();
        renderEmployeesList();
    });
    document.getElementById('coachingEmailBtn')?.addEventListener('click', () => {
        showOnlySection('coachingEmailSection');
        showSubSection('subSectionCoachingEmail');
        initializeCoachingEmail();
    });
    
    // Sub-navigation for Coaching & Analysis section
    document.getElementById('subNavCoachingEmail')?.addEventListener('click', () => {
        showSubSection('subSectionCoachingEmail');
        initializeCoachingEmail();
    });
    document.getElementById('subNavYearEnd')?.addEventListener('click', () => {
        showSubSection('subSectionYearEnd');
        initializeYearEndComments();
    });
    // Track if sentiment listeners are attached to prevent duplicates
    let sentimentListenersAttached = false;
    
    document.getElementById('subNavSentiment')?.addEventListener('click', () => {
        showSubSection('subSectionSentiment');
        // Move sentiment section content dynamically (only if not already moved)
        const sentimentSection = document.getElementById('sentimentSection');
        const subSectionSentiment = document.getElementById('subSectionSentiment');
        if (sentimentSection && subSectionSentiment && sentimentSection.children.length > 0) {
            // Move all children from sentimentSection to subSectionSentiment
            while (sentimentSection.firstChild) {
                subSectionSentiment.appendChild(sentimentSection.firstChild);
            }
        }
        
        // Attach event listeners only once
        if (!sentimentListenersAttached) {
            document.getElementById('generateSentimentSummaryBtn')?.addEventListener('click', generateSentimentSummary);
            document.getElementById('copySentimentSummaryBtn')?.addEventListener('click', copySentimentSummary);
            document.getElementById('generateCoPilotPromptBtn')?.addEventListener('click', generateSentimentCoPilotPrompt);
            document.getElementById('sentimentPositiveFile')?.addEventListener('change', () => handleSentimentFileChange('Positive'));
            document.getElementById('sentimentNegativeFile')?.addEventListener('change', () => handleSentimentFileChange('Negative'));
            document.getElementById('sentimentEmotionsFile')?.addEventListener('change', () => handleSentimentFileChange('Emotions'));
            
            // NEW: Add paste button handlers
            document.getElementById('sentimentPositivePasteBtn')?.addEventListener('click', (e) => { e.preventDefault(); openSentimentPasteModal('Positive'); });
            document.getElementById('sentimentNegativePasteBtn')?.addEventListener('click', (e) => { e.preventDefault(); openSentimentPasteModal('Negative'); });
            document.getElementById('sentimentEmotionsPasteBtn')?.addEventListener('click', (e) => { e.preventDefault(); openSentimentPasteModal('Emotions'); });
            
            document.getElementById('savePhraseDatabaseBtn')?.addEventListener('click', saveSentimentPhraseDatabaseFromForm);
            document.getElementById('saveAssociateSentimentSnapshotBtn')?.addEventListener('click', saveAssociateSentimentSnapshotFromCurrentReports);
            sentimentListenersAttached = true;
        }

        renderSentimentDatabasePanel();
    });
    document.getElementById('subNavMetricTrends')?.addEventListener('click', () => {
        showSubSection('subSectionMetricTrends');
        // Move metric trends section content dynamically
        const metricTrendsSection = document.getElementById('metricTrendsSection');
        const subSectionMetricTrends = document.getElementById('subSectionMetricTrends');
        if (metricTrendsSection && subSectionMetricTrends) {
            // Move all children from metricTrendsSection to subSectionMetricTrends
            while (metricTrendsSection.firstChild) {
                subSectionMetricTrends.appendChild(metricTrendsSection.firstChild);
            }
        }
        initializeMetricTrends();
    });
    document.getElementById('subNavTrendIntelligence')?.addEventListener('click', () => {
        showSubSection('subSectionTrendIntelligence');
        // Move executive summary section content dynamically
        const executiveSummarySection = document.getElementById('executiveSummarySection');
        const subSectionTrendIntelligence = document.getElementById('subSectionTrendIntelligence');
        if (executiveSummarySection && subSectionTrendIntelligence) {
            // Move all children from executiveSummarySection to subSectionTrendIntelligence
            while (executiveSummarySection.firstChild) {
                subSectionTrendIntelligence.appendChild(executiveSummarySection.firstChild);
            }
        }
        renderExecutiveSummary();
        
        // Reset the associate dropdown when navigating to this section
        const summarySelect = document.getElementById('summaryAssociateSelect');
        if (summarySelect) {
            summarySelect.value = '';
        }
        
        // Clear the data containers
        const dataContainer = document.getElementById('summaryDataContainer');
        const chartsContainer = document.getElementById('summaryChartsContainer');
        const emailSection = document.getElementById('summaryEmailSection');
        
        if (dataContainer) dataContainer.style.display = 'none';
        if (chartsContainer) chartsContainer.innerHTML = '';
        if (emailSection) emailSection.style.display = 'none';
    });
    
    document.getElementById('manageDataBtn')?.addEventListener('click', () => {
        showOnlySection('manageDataSection');
        showManageDataSubSection('subSectionTeamData');
        populateDeleteWeekDropdown();
        renderEmployeesList();
    });
    
    // Sub-navigation for Manage Data section
    document.getElementById('subNavTeamData')?.addEventListener('click', () => {
        showManageDataSubSection('subSectionTeamData');
        populateDeleteWeekDropdown();
        renderEmployeesList();
    });
    document.getElementById('subNavCoachingTips')?.addEventListener('click', () => {
        showManageDataSubSection('subSectionCoachingTips');
        // Move tips management section content dynamically
        const tipsManagementSection = document.getElementById('tipsManagementSection');
        const subSectionCoachingTips = document.getElementById('subSectionCoachingTips');
        if (tipsManagementSection && subSectionCoachingTips) {
            // Move all children from tipsManagementSection to subSectionCoachingTips
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
    
    document.getElementById('debugBtn')?.addEventListener('click', () => {
        showOnlySection('debugSection');
        renderDebugPanel();
    });
    document.getElementById('generateTodaysFocusBtn')?.addEventListener('click', generateTodaysFocus);
    document.getElementById('copyTodaysFocusBtn')?.addEventListener('click', copyTodaysFocus);
    document.getElementById('generateTodaysFocusCopilotBtn')?.addEventListener('click', generateTodaysFocusCopilotEmail);
    document.getElementById('generateOneOnOneBtn')?.addEventListener('click', generateOneOnOnePrep);
    document.getElementById('copyOneOnOneBtn')?.addEventListener('click', copyOneOnOnePrep);
    document.getElementById('redFlagBtn')?.addEventListener('click', () => {
        showOnlySection('redFlagSection');
    });
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
    
    // SENTIMENT & LANGUAGE SUMMARY WORKFLOW - Duplicate listeners removed, now only attached in subNav click handler
    
    // Drag and drop support for CSV files
    const pasteTextarea = document.getElementById('pasteDataTextarea');
    if (pasteTextarea) {
        // Prevent default drag behaviors
        ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
            pasteTextarea.addEventListener(eventName, (e) => {
                e.preventDefault();
                e.stopPropagation();
            });
        });
        
        // Highlight drop zone
        ['dragenter', 'dragover'].forEach(eventName => {
            pasteTextarea.addEventListener(eventName, () => {
                pasteTextarea.style.background = '#e3f2fd';
                pasteTextarea.style.borderColor = '#2196F3';
            });
        });
        
        ['dragleave', 'drop'].forEach(eventName => {
            pasteTextarea.addEventListener(eventName, () => {
                pasteTextarea.style.background = '';
                pasteTextarea.style.borderColor = '';
            });
        });
        
        // Handle dropped files
        pasteTextarea.addEventListener('drop', (e) => {
            const dt = e.dataTransfer;
            const files = dt.files;
            
            if (files.length === 0) return;
            
            const file = files[0];
            
            // Check if it's a CSV or text file
            if (!file.name.endsWith('.csv') && !file.type.includes('text')) {
                alert('⚠️ Please drop a CSV file');
                return;
            }
            
            // Read the file
            const reader = new FileReader();
            reader.onload = (event) => {
                pasteTextarea.value = event.target.result;
                // Trigger validation
                pasteTextarea.dispatchEvent(new Event('input'));
                showToast('✅ File loaded! Review data and click Load Data.', 4000);
            };
            reader.onerror = () => {
                alert('❌ Error reading file');
            };
            reader.readAsText(file);
        });
    }
    
    // Real-time data validation preview
    document.getElementById('pasteDataTextarea')?.addEventListener('input', (e) => {
        const dataText = e.target.value;
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
    });
    
    // Load pasted data
    document.getElementById('loadPastedDataBtn')?.addEventListener('click', () => {
        
        const pastedData = document.getElementById('pasteDataTextarea').value;
        const weekEndingDate = document.getElementById('pasteWeekEndingDate').value;
        
        // Validate data first
        const validation = validatePastedData(pastedData);
        if (!validation.valid) {
            alert('⚠️ Data validation failed:\n\n' + validation.issues.join('\n'));
            return;
        }
        
        if (!weekEndingDate) {
            alert('⚠️ Please select the week ending date (Saturday)');
            return;
        }
        
        // Calculate week range (Sunday - Saturday)
        const endDate = weekEndingDate;
        const endDateObj = new Date(weekEndingDate);
        endDateObj.setDate(endDateObj.getDate() - 6); // Go back 6 days to get Sunday
        const startDate = endDateObj.toISOString().split('T')[0];
        
        // Auto-detect period type from date range
        const start = new Date(startDate);
        const end = new Date(endDate);
        const daysDiff = Math.round((end - start) / (1000 * 60 * 60 * 24));
        
        let detectedPeriodType = 'week';
        if (daysDiff >= 5 && daysDiff <= 9) {
            detectedPeriodType = 'week';
        } else if (daysDiff >= 26 && daysDiff <= 33) {
            detectedPeriodType = 'month';
        } else if (daysDiff >= 88 && daysDiff <= 95) {
            detectedPeriodType = 'quarter';
        } else if (daysDiff >= 180) {
            detectedPeriodType = 'ytd';
        }
        
        // Auto-select the detected period type button
        const periodButtons = document.querySelectorAll('.upload-period-btn');
        periodButtons.forEach(btn => {
            if (btn.dataset.period === detectedPeriodType) {
                btn.click(); // Trigger the button click to activate it
            }
        });
        
        
        // Get selected period type (after auto-detection)
        const selectedBtn = document.querySelector('.upload-period-btn[style*="background: rgb(40, 167, 69)"]') || 
                           document.querySelector('.upload-period-btn[style*="background:#28a745"]') ||
                           document.querySelector('.upload-period-btn[data-period="week"]');
        const periodType = selectedBtn ? selectedBtn.dataset.period : detectedPeriodType;
        
        // Save period type as smart default
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
            
            // Store data with period type
            const weekKey = `${startDate}|${endDate}`;
            const yearEndProfileSelect = document.getElementById('uploadYearEndProfile');
            const selectedYearEndProfile = (yearEndProfileSelect?.value || 'auto').trim();
            
            // Parse dates safely (avoid timezone issues)
            const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
            const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
            const endDateObj = new Date(endYear, endMonth - 1, endDay);
            const startDateObj = new Date(startYear, startMonth - 1, startDay);
            const autoReviewYear = String(endDateObj.getFullYear());
            const yearEndReviewYear = selectedYearEndProfile === 'auto' ? autoReviewYear : selectedYearEndProfile;
            
            // Create label based on period type
            let label;
            if (periodType === 'week') {
                label = `Week ending ${endDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
            } else if (periodType === 'month') {
                label = `${startDateObj.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}`;
            } else if (periodType === 'quarter') {
                const quarter = Math.floor(startDateObj.getMonth() / 3) + 1;
                label = `Q${quarter} ${startDateObj.getFullYear()}`;
            } else if (periodType === 'ytd') {
                label = `YTD through ${endDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
            }
            
            const targetStore = periodType === 'ytd' ? ytdData : weeklyData;
            targetStore[weekKey] = {
                employees: employees,
                metadata: {
                    startDate: startDate,
                    endDate: endDate,
                    label: label,
                    periodType: periodType,
                    yearEndTargetProfile: selectedYearEndProfile,
                    yearEndReviewYear: yearEndReviewYear,
                    uploadedAt: new Date().toISOString()
                }
            };

            if (periodType !== 'ytd') {
                upsertAutoYtdForYear(endDateObj.getFullYear(), endDate);
            }
            

            
            saveWeeklyData();
            saveYtdData();
            
            populateDeleteWeekDropdown();
            populateUploadedDataDropdown();  // Refresh the uploaded data dropdown for metric trends
            
            // Populate team member selector
            populateTeamMemberSelector();
            
            // Show success
            document.getElementById('uploadSuccessMessage').style.display = 'block';
            document.getElementById('pasteDataTextarea').value = '';
            
            // Auto-switch to Coaching tab
            showOnlySection('coachingSection');
            
            // Refresh Generate Coaching UI with new data
            if (periodType !== 'ytd') {
                // Set period type to 'week' and refresh dropdown
                currentPeriodType = 'week';
                
                // Update period type button styles
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
                
                // Refresh period dropdown
                updatePeriodDropdown();
                
                // Auto-select the newly uploaded week
                const periodDropdown = document.getElementById('specificPeriod');
                if (periodDropdown) {
                    // Find the option that matches the newly uploaded week
                    for (let i = 0; i < periodDropdown.options.length; i++) {
                        if (periodDropdown.options[i].value === weekKey) {
                            periodDropdown.selectedIndex = i;
                            currentPeriod = weekKey;
                            updateEmployeeDropdown();
                            break;
                        }
                    }
                }
            }
            
            alert(`✅ Loaded ${employees.length} employees for ${label}!\n\nManage your team members in "📊 Manage Data" section.`);
            
            // Reload page to refresh UI
            setTimeout(() => {
                location.reload();
            }, 500);
            
            
        } catch (error) {
            console.error('Error parsing pasted data:', error);
            alert(`⚠️ Error parsing data: ${error.message}\n\nPlease ensure you copied the full table with headers from PowerBI.`);
        }
    });

    enableDatePickerOpen(document.getElementById('pasteWeekEndingDate'));
    
    // Excel file selection

    
    // Period type buttons
    document.querySelectorAll('.period-type-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update button styles
            document.querySelectorAll('.period-type-btn').forEach(b => {
                b.style.background = 'white';
                b.style.color = '#666';
                b.style.borderColor = '#ddd';
            });
            btn.style.background = '#2196F3';
            btn.style.color = 'white';
            btn.style.borderColor = '#2196F3';
            
            currentPeriodType = btn.dataset.period;
            updatePeriodDropdown();
            
            // Auto-select the first (most recent) period
            const periodDropdown = document.getElementById('specificPeriod');
            if (periodDropdown && periodDropdown.options.length > 1) {
                periodDropdown.selectedIndex = 1; // Select first real option (skip "-- Choose --")
                currentPeriod = periodDropdown.value;
                updateEmployeeDropdown();
            }
        });
    });
    
    // Period selection
    document.getElementById('specificPeriod')?.addEventListener('change', (e) => {
        currentPeriod = e.target.value;
        if (currentPeriod) {
            updateEmployeeDropdown();
        }
    });
    
    // Employee selection
    document.getElementById('employeeSelect')?.addEventListener('change', (e) => {
        const selectedName = e.target.value;
        
        // Save as smart default
        if (selectedName) {
            saveSmartDefault('lastEmployee', selectedName);
        }
        
        if (!selectedName) {
            ['metricsSection', 'employeeInfoSection', 'customNotesSection', 'generateEmailBtn'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            return;
        }
        
        const employee = getEmployeeDataForPeriod(selectedName);
        
        if (!employee) {
            alert('ℹ️ Error loading employee data');
            return;
        }
        
        // Show sections
        ['employeeInfoSection', 'metricsSection', 'aiAssistSection', 'customNotesSection'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'block';
        });
        
        // Hide old generate button if it exists
        const oldGenerateBtn = document.getElementById('generateEmailBtn');
        if (oldGenerateBtn) oldGenerateBtn.style.display = 'none';
        
        // Populate fields
        const savedNickname = getSavedNickname(selectedName);
        const defaultNickname = getEmployeeNickname(selectedName) || employee.firstName || '';
        document.getElementById('employeeName').value = savedNickname || defaultNickname;
        populateMetricInputs(employee);
        
        // Update survey status message
        const surveyStatusEl = document.getElementById('surveyStatusMsg');
        if (surveyStatusEl) {
            const hasSurveys = (employee.surveyTotal || 0) > 0;
            surveyStatusEl.textContent = hasSurveys ? '' : 'No surveys in this period; survey-based metrics are omitted.';
        }
        
        // Scroll to form
        document.getElementById('employeeName').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    
    // Note: nickname saves on generate actions, not on blur
    
    // Employee search
    document.getElementById('employeeSearch')?.addEventListener('input', (e) => {
        const searchText = e.target.value.toLowerCase();
        const dropdown = document.getElementById('employeeSelect');
        const options = dropdown.options;
        
        for (let i = 1; i < options.length; i++) {
            const option = options[i];
            const text = option.textContent.toLowerCase();
            option.style.display = text.includes(searchText) ? '' : 'none';
        }
    });
    
    // Generate email button
    // Generate Copilot Prompt Button
    document.getElementById('generateCopilotPromptBtn')?.addEventListener('click', () => {
        generateCopilotPrompt();
    });
    
    // [DEPRECATED: generateOutlookEmailBtn references removed - function deleted in Phase 1 cleanup]
    
    // Enable Generate Email button when Copilot output is pasted
    document.getElementById('copilotOutputText')?.addEventListener('input', (e) => {
        const verintBtn = document.getElementById('generateVerintSummaryBtn');
        const hasContent = e.target.value.trim().length > 0;
        
        if (verintBtn) {
            verintBtn.disabled = !hasContent;
            verintBtn.style.opacity = hasContent ? '1' : '0.5';
            verintBtn.style.cursor = hasContent ? 'pointer' : 'not-allowed';
        }
    });
    
    // Generate Verint Summary Button
    document.getElementById('generateVerintSummaryBtn')?.addEventListener('click', () => {
        generateVerintSummary();
    });
    
    // Metric input highlighting - attach to all metrics in registry
    Object.keys(METRICS_REGISTRY).forEach(metricKey => {
        document.getElementById(metricKey)?.addEventListener('input', applyMetricHighlights);
    });
    
    // Export data
    document.getElementById('exportDataBtn')?.addEventListener('click', () => {
        
        exportToExcel();
    });
    
    // Export coaching history as CSV
    document.getElementById('exportCoachingHistoryBtn')?.addEventListener('click', () => {
        downloadCoachingHistoryCSV();
    });
    
    // Upload more data button
    document.getElementById('uploadMoreDataBtn')?.addEventListener('click', () => {
        // Hide success message and clear form
        document.getElementById('uploadSuccessMessage').style.display = 'none';
        document.getElementById('pasteDataTextarea').value = '';
        document.getElementById('pasteWeekEndingDate').value = '';
        
        // Switch back to upload tab
        showOnlySection('uploadSection');
    });
    
    // Import data
    document.getElementById('importDataBtn')?.addEventListener('click', () => {
        
        document.getElementById('dataFileInput').click();
    });
    
    document.getElementById('dataFileInput')?.addEventListener('change', (e) => {
        
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                
                const data = JSON.parse(e.target.result);
                
                if (data.weeklyData) weeklyData = data.weeklyData;
                if (data.ytdData) ytdData = data.ytdData;
                if (data.sentimentPhraseDatabase) sentimentPhraseDatabase = data.sentimentPhraseDatabase;
                if (data.associateSentimentSnapshots) associateSentimentSnapshots = data.associateSentimentSnapshots;
                
                saveWeeklyData();
                saveYtdData();
                saveSentimentPhraseDatabase();
                saveAssociateSentimentSnapshots();
                
                showToast('✅ Data imported successfully!');
                document.getElementById('dataFileInput').value = '';
                populateDeleteWeekDropdown();
                populateDeleteSentimentDropdown();
            } catch (error) {
                console.error('Error importing data:', error);
                alert('ℹ️ Error importing data: ' + error.message);
            }
        };
        reader.readAsText(file);
    });

    // Delete selected week
    document.getElementById('deleteSelectedWeekBtn')?.addEventListener('click', () => {
        
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
        saveTeamMembers();
        
        populateDeleteWeekDropdown();
        populateDeleteSentimentDropdown();
        populateTeamMemberSelector();
        showToast('✅ Week deleted successfully');
        
        // Clear coaching form if needed (safely check if elements exist)
        const employeeSelect = document.getElementById('employeeSelect');
        if (employeeSelect) employeeSelect.value = '';
        
        ['metricsSection', 'employeeInfoSection', 'customNotesSection', 'generateEmailBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    });
    
    // Select/Deselect all team members
    document.getElementById('selectAllTeamBtn')?.addEventListener('click', () => {
        document.querySelectorAll('.team-member-checkbox').forEach(checkbox => {
            checkbox.checked = true;
        });
        updateTeamSelection();
    });
    
    document.getElementById('deselectAllTeamBtn')?.addEventListener('click', () => {
        document.querySelectorAll('.team-member-checkbox').forEach(checkbox => {
            checkbox.checked = false;
        });
        updateTeamSelection();
    });
    
    // Update team selector when week selection changes
    document.getElementById('deleteWeekSelect')?.addEventListener('change', () => {
        populateTeamMemberSelector();
    });
    
    // Populate and handle sentiment data deletion
    populateDeleteSentimentDropdown();
    
    document.getElementById('deleteSelectedSentimentBtn')?.addEventListener('click', () => {
        
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
        
        // Parse the selected key (format: "employeeId|timeframeStart to timeframeEnd")
        const pipeIndex = selectedKey.indexOf('|');
        const employeeId = selectedKey.substring(0, pipeIndex);
        const timeframe = selectedKey.substring(pipeIndex + 1);
        
        if (associateSentimentSnapshots[employeeId]) {
            // Remove the specific sentiment snapshot by comparing reconstructed timeframe
            associateSentimentSnapshots[employeeId] = associateSentimentSnapshots[employeeId].filter(
                snapshot => `${snapshot.timeframeStart} to ${snapshot.timeframeEnd}` !== timeframe
            );
            
            // If no more snapshots for this employee, remove the employee entry
            if (associateSentimentSnapshots[employeeId].length === 0) {
                delete associateSentimentSnapshots[employeeId];
            }
            
            saveAssociateSentimentSnapshots();
            populateDeleteSentimentDropdown();
            showToast('✅ Sentiment data deleted successfully');
        }
    });
    
    // Delete all data

    document.getElementById('deleteAllDataBtn')?.addEventListener('click', () => {
        
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
        
        
        // Clear ALL data including call center averages, team members, and history
        weeklyData = {};
        ytdData = {};
        myTeamMembers = {};
        
        // Clear all localStorage data
        localStorage.removeItem(STORAGE_PREFIX + 'weeklyData');
        localStorage.removeItem(STORAGE_PREFIX + 'ytdData');
        localStorage.removeItem(STORAGE_PREFIX + 'myTeamMembers');
        localStorage.removeItem(STORAGE_PREFIX + 'callCenterAverages');
        localStorage.removeItem(STORAGE_PREFIX + 'employeeNicknames');
        localStorage.removeItem(STORAGE_PREFIX + 'employeePreferredNames');
        localStorage.removeItem(STORAGE_PREFIX + 'coachingHistory');
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
        
        populateDeleteWeekDropdown();
        
        // Hide all sections
        ['metricsSection', 'employeeInfoSection', 'customNotesSection', 'generateEmailBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        
        alert('✅ All data has been deleted (including call center averages and history)');
    });
    
    // Data cleanup feature
    document.getElementById('cleanupSurveyDataBtn')?.addEventListener('click', () => {
        const issues = scanSurveyDataIssues();
        const resultsDiv = document.getElementById('cleanupResults');
        
        if (!resultsDiv) return;
        
        if (issues.length === 0) {
            resultsDiv.style.display = 'block';
            resultsDiv.style.background = '#d4edda';
            resultsDiv.style.border = '2px solid #28a745';
            resultsDiv.innerHTML = '<strong style="color: #28a745;">✅ No issues found!</strong><br>All survey totals look reasonable.';
            return;
        }
        
        // Show issues found
        let html = `<strong style="color: #ff9800;">⚠️ Found ${issues.length} corrupted survey value(s):</strong><br><br>`;
        html += '<div style="max-height: 300px; overflow-y: auto; margin: 10px 0;">';
        issues.forEach(issue => {
            html += `<div style="margin-bottom: 8px; padding: 8px; background: white; border-radius: 4px;">` +
                    `📅 <strong>${issue.weekLabel}</strong><br>` +
                    `👤 ${issue.employeeName}: Survey Total = <span style="color: #dc3545; font-weight: bold;">${issue.currentValue}</span><br>` +
                    `<span style="font-size: 0.85em; color: #666;\">(Likely a percentage/score instead of actual survey count)</span>` +
                    `</div>`;
        });
        html += '</div>';
        html += `<p style="color: #856404; margin: 10px 0;"><strong>These weeks will be deleted so you can re-upload with correct data.</strong></p>`;
        html += `<button type="button" id="fixSurveyDataBtn" class="btn-secondary" style="background: #ff9800; color: white; margin-top: 10px;">` +
                `🗑️ Delete Affected Weeks & Re-upload</button> `;
        html += `<button type="button" id="cancelCleanupBtn" class="btn-secondary" style="background: #6c757d; color: white; margin-top: 10px;">` +
                `Cancel</button>`;
        
        resultsDiv.style.display = 'block';
        resultsDiv.style.background = '#fff3cd';
        resultsDiv.style.border = '2px solid #ff9800';
        resultsDiv.innerHTML = html;
        
        // Add fix button handler
        document.getElementById('fixSurveyDataBtn')?.addEventListener('click', () => {
            const weeksSet = new Set(issues.map(i => i.weekKey));
            if (confirm(`This will DELETE ${weeksSet.size} week(s) with corrupted survey data:\n\n${Array.from(weeksSet).map(wk => issues.find(i => i.weekKey === wk).weekLabel).join('\\n')}\n\nYou can re-upload these weeks with correct data.\n\nContinue?`)) {
                fixSurveyDataIssues(issues);
                resultsDiv.style.background = '#d4edda';
                resultsDiv.style.border = '2px solid #28a745';
                resultsDiv.innerHTML = `<strong style="color: #28a745;">✅ Deleted corrupted week(s)!</strong><br>` +
                                       `You can now re-upload the correct data for those weeks.`;
            }
        });
        
        // Cancel button
        document.getElementById('cancelCleanupBtn')?.addEventListener('click', () => {
            resultsDiv.style.display = 'none';
        });
    });
    
    // Populate delete week dropdown on load
    populateDeleteWeekDropdown();
    
    // Initialize red flag handlers
    initializeRedFlag();
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
        });
    });
}

function collectYearEndAnnualGoals(employeeName, reviewYear) {
    const state = getYearEndAnnualGoalsState(employeeName, reviewYear);
    const metGoals = [];
    const notMetGoals = [];

    YEAR_END_ANNUAL_GOALS.forEach(goal => {
        const goalState = state[goal.key] || { status: 'met', note: '' };
        const noteSuffix = goalState.note ? ` (${goalState.note})` : '';
        const text = `${goal.label}: ${goal.expectation}${noteSuffix}`;
        if (goalState.status === 'not-met') {
            notMetGoals.push(text);
        } else {
            metGoals.push(text);
        }
    });

    return { metGoals, notMetGoals };
}

function getYearEndTargetConfig(metricKey, reviewYear, periodMetadata) {
    const parsedYear = parseInt(reviewYear, 10);
    const customTargets = Number.isInteger(parsedYear) ? YEAR_END_TARGETS_BY_YEAR[parsedYear] : null;
    const metadataProfile = periodMetadata?.yearEndTargetProfile;
    const metadataYear = parseInt(periodMetadata?.yearEndReviewYear, 10);
    const profileYear = Number.isInteger(parsedYear)
        ? parsedYear
        : (metadataProfile === 'auto' ? metadataYear : parseInt(metadataProfile, 10));
    const profileTargets = Number.isInteger(profileYear) ? YEAR_END_TARGETS_BY_YEAR[profileYear] : null;

    if (customTargets && customTargets[metricKey]) return { ...customTargets[metricKey], profileYear: parsedYear };
    if (profileTargets && profileTargets[metricKey]) return { ...profileTargets[metricKey], profileYear: profileYear };

    const fallback = METRICS_REGISTRY[metricKey]?.target;
    if (!fallback) return null;
    return { ...fallback, profileYear: null };
}

// Scan for unrealistic survey totals
function scanSurveyDataIssues() {
    const issues = [];
    const THRESHOLD = 20; // Any survey total > 20 per week is suspicious
    
    for (const weekKey in weeklyData) {
        const weekData = weeklyData[weekKey];
        const metadata = weekData.metadata || {};
        const weekLabel = metadata.endDate ? `Week ending ${metadata.endDate}` : weekKey;
        
        if (weekData.employees) {
            weekData.employees.forEach(emp => {
                if (emp.surveyTotal && emp.surveyTotal > THRESHOLD) {
                    issues.push({
                        weekKey: weekKey,
                        weekLabel: weekLabel,
                        employeeName: emp.name,
                        currentValue: emp.surveyTotal,
                        employee: emp
                    });
                }
            });
        }
    }
    
    return issues;
}

// Fix survey data issues by deleting corrupted weeks
function fixSurveyDataIssues(issues) {
    // Collect unique week keys to delete
    const weeksToDelete = new Set();
    issues.forEach(issue => {
        weeksToDelete.add(issue.weekKey);
    });
    
    // Delete the weeks
    weeksToDelete.forEach(weekKey => {
        delete weeklyData[weekKey];
        delete myTeamMembers[weekKey];
    });
    
    saveWeeklyData();
    saveTeamMembers();
    populateDeleteWeekDropdown();
    populateTeamMemberSelector();
    
    showToast(`✅ Deleted ${weeksToDelete.size} week(s) with corrupted data. Re-upload with correct survey counts.`);
}

/*
// ============================================
// PTO / TIME-OFF TRACKER
// ============================================

const PTO_STORAGE_KEY = 'ptoTracker';

function loadPtoTracker() {
    try {
        const saved = localStorage.getItem(PTO_STORAGE_KEY);
        return saved ? JSON.parse(saved) : {
            availableHours: 0,
            thresholds: { warning: 8, policy: 16 },
            entries: []
        };
    } catch (error) {
        console.error('Error loading PTO tracker:', error);
        return { availableHours: 0, thresholds: { warning: 8, policy: 16 }, entries: [] };
    }
}

function savePtoTracker(data) {
    try {
        localStorage.setItem(PTO_STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
        console.error('Error saving PTO tracker:', error);
    }
}

function initializePtoTracker() {
    const data = loadPtoTracker();
    const availableInput = document.getElementById('ptoAvailableHours');
    const warningInput = document.getElementById('ptoThresholdWarning');
    const policyInput = document.getElementById('ptoThresholdPolicy');
    const addBtn = document.getElementById('ptoAddEntryBtn');
    const generateBtn = document.getElementById('ptoGenerateEmailBtn');
    const copyBtn = document.getElementById('ptoCopyEmailBtn');

    if (availableInput) availableInput.value = data.availableHours ?? 0;
    if (warningInput) warningInput.value = data.thresholds?.warning ?? 8;
    if (policyInput) policyInput.value = data.thresholds?.policy ?? 16;

    renderPtoSummary(data);
    renderPtoEntries(data);

    if (availableInput && !availableInput.dataset.bound) {
        availableInput.addEventListener('input', () => {
            const updated = loadPtoTracker();
            updated.availableHours = parseFloat(availableInput.value) || 0;
            savePtoTracker(updated);
            renderPtoSummary(updated);
        });
        availableInput.dataset.bound = 'true';
    }

    if (warningInput && !warningInput.dataset.bound) {
        warningInput.addEventListener('input', () => {
            const updated = loadPtoTracker();
            updated.thresholds = updated.thresholds || { warning: 8, policy: 16 };
            updated.thresholds.warning = parseFloat(warningInput.value) || 0;
            savePtoTracker(updated);
            renderPtoSummary(updated);
        });
        warningInput.dataset.bound = 'true';
    }

    if (policyInput && !policyInput.dataset.bound) {
        policyInput.addEventListener('input', () => {
            const updated = loadPtoTracker();
            updated.thresholds = updated.thresholds || { warning: 8, policy: 16 };
            updated.thresholds.policy = parseFloat(policyInput.value) || 0;
            savePtoTracker(updated);
            renderPtoSummary(updated);
        });
        policyInput.dataset.bound = 'true';
    }

    if (addBtn && !addBtn.dataset.bound) {
        addBtn.addEventListener('click', addPtoEntry);
        addBtn.dataset.bound = 'true';
    }

    if (generateBtn && !generateBtn.dataset.bound) {
        generateBtn.addEventListener('click', generatePtoEmail);
        generateBtn.dataset.bound = 'true';
    }

    if (copyBtn && !copyBtn.dataset.bound) {
        copyBtn.addEventListener('click', copyPtoEmail);
        copyBtn.dataset.bound = 'true';
    }
}

function addPtoEntry() {
    const date = document.getElementById('ptoMissedDate')?.value;
    const hoursValue = document.getElementById('ptoMissedHours')?.value;
    const reason = document.getElementById('ptoMissedReason')?.value?.trim() || '';

    if (!date || !hoursValue) {
        showToast('Enter date and hours missed', 3000);
        return;
    }

    const hours = parseFloat(hoursValue);
    if (!Number.isFinite(hours) || hours <= 0) {
        showToast('Enter a valid hours value', 3000);
        return;
    }

    const data = loadPtoTracker();
    data.entries.push({
        id: `${Date.now()}`,
        date,
        hours,
        reason
    });
    savePtoTracker(data);
    renderPtoSummary(data);
    renderPtoEntries(data);

    const dateInput = document.getElementById('ptoMissedDate');
    const hoursInput = document.getElementById('ptoMissedHours');
    const reasonInput = document.getElementById('ptoMissedReason');
    if (dateInput) dateInput.value = '';
    if (hoursInput) hoursInput.value = '';
    if (reasonInput) reasonInput.value = '';
}

function deletePtoEntry(entryId) {
    const data = loadPtoTracker();
    data.entries = data.entries.filter(entry => entry.id !== entryId);
    savePtoTracker(data);
    renderPtoSummary(data);
    renderPtoEntries(data);
}

function renderPtoSummary(data) {
    const summary = document.getElementById('ptoSummary');
    if (!summary) return;
    
    const totalMissed = data.entries.reduce((sum, entry) => sum + (parseFloat(entry.hours) || 0), 0);
    const remaining = Math.max(0, (parseFloat(data.availableHours) || 0) - totalMissed);
    const warning = data.thresholds?.warning ?? 0;
    const policy = data.thresholds?.policy ?? 0;
    
    const status = totalMissed >= policy
        ? '🔴 Policy threshold reached'
        : totalMissed >= warning
            ? '🟠 Warning threshold reached'
            : '🟢 Below thresholds';
    
    summary.innerHTML = `
        <strong>Total Missed:</strong> ${totalMissed.toFixed(2)} hrs<br>
        <strong>PTO Remaining:</strong> ${remaining.toFixed(2)} hrs<br>
        <strong>Status:</strong> ${status}
    `;
}

function renderPtoEntries(data) {
    const container = document.getElementById('ptoEntries');
    if (!container) return;
    
    if (!data.entries.length) {
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">No missed time entries yet.</div>';
        return;
    }
    
    const rows = data.entries
        .slice()
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        .map(entry => {
            const reasonText = entry.reason ? ` • ${entry.reason}` : '';
            return `
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 10px; border: 1px solid #e5f3f0; border-radius: 6px; background: #f9fffd;">
                    <div>
                        <strong>${entry.date}</strong> — ${parseFloat(entry.hours).toFixed(2)} hrs${reasonText}
                    </div>
                    <button type="button" data-entry-id="${entry.id}" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 6px 10px; cursor: pointer;">Remove</button>
                </div>
            `;
        })
        .join('');
    
    container.innerHTML = rows;
    container.querySelectorAll('button[data-entry-id]').forEach(btn => {
        btn.addEventListener('click', () => deletePtoEntry(btn.dataset.entryId));
    });
}

function generatePtoEmail() {
    const data = loadPtoTracker();
    const output = document.getElementById('ptoEmailOutput');
    if (!output) return;
    
    const totalMissed = data.entries.reduce((sum, entry) => sum + (parseFloat(entry.hours) || 0), 0);
    const warning = data.thresholds?.warning ?? 0;
    const policy = data.thresholds?.policy ?? 0;
    
    let thresholdText = 'Below thresholds';
    if (totalMissed >= policy) thresholdText = `Reached policy threshold (${policy} hrs)`;
    else if (totalMissed >= warning) thresholdText = `Reached warning threshold (${warning} hrs)`;
    
    const entryLines = data.entries
        .slice()
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        .map(entry => `- ${entry.date}: ${parseFloat(entry.hours).toFixed(2)} hrs${entry.reason ? ` (${entry.reason})` : ''}`)
        .join('\n');
    
    output.value = `Hello,\n\n` +
        `This is a time-off/attendance check-in based on recent missed time.\n\n` +
        `Total missed time: ${totalMissed.toFixed(2)} hrs\n` +
        `PTO available: ${(parseFloat(data.availableHours) || 0).toFixed(2)} hrs\n` +
        `Status: ${thresholdText}\n\n` +
        `Missed time details:\n${entryLines || '- No entries recorded'}\n\n` +
        `If any of the missed time should be covered by PTO or needs correction, please let me know.\n\n` +
        `Thank you.`;
}

function copyPtoEmail() {
    const output = document.getElementById('ptoEmailOutput');
    if (!output) return;
    
    navigator.clipboard.writeText(output.value || '').then(() => {
        showToast('✅ PTO email copied to clipboard', 3000);
    }).catch(() => {
        showToast('Unable to copy PTO email', 3000);
    });
}

*/

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
            document.getElementById('employeeDashboard')?.click();
        }
        
        // Ctrl+T - Tips Management
        if (e.ctrlKey && e.key === 't') {
            e.preventDefault();
            document.getElementById('manageTips')?.click();
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

function populateEmployeeDropdown() {
    // Legacy function - now just calls initializeEmployeeDropdown
    initializeEmployeeDropdown();
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
    
    const employees = periodData.employees
        .filter(emp => ytdData[weekKey] ? true : isTeamMember(weekKey, emp.name))
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
        
        // Populate form fields
        document.getElementById('avgAdherence').value = averages.adherence || '';
        document.getElementById('avgOverallExperience').value = averages.overallExperience || '';
        document.getElementById('avgRepSatisfaction').value = averages.repSatisfaction || '';
        document.getElementById('avgFCR').value = averages.fcr || '';
        document.getElementById('avgTransfers').value = averages.transfers || '';
        document.getElementById('avgSentiment').value = averages.sentiment || '';
        document.getElementById('avgPositiveWord').value = averages.positiveWord || '';
        document.getElementById('avgNegativeWord').value = averages.negativeWord || '';
        document.getElementById('avgManagingEmotions').value = averages.managingEmotions || '';
        document.getElementById('avgAHT').value = averages.aht || '';
        document.getElementById('avgACW').value = averages.acw || '';
        document.getElementById('avgHoldTime').value = averages.holdTime || '';
        document.getElementById('avgReliability').value = averages.reliability || '';
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

function loadUploadedDataPeriod(weekKey) {
    const mondayInput = document.getElementById('avgWeekMonday');
    const sundayInput = document.getElementById('avgWeekSunday');
    
    if (!weekKey) {
        // Clear if no selection
        document.getElementById('avgPeriodType').value = 'week';
        mondayInput.value = '';
        sundayInput.value = '';
        // Enable date fields for manual entry
        mondayInput.disabled = false;
        sundayInput.disabled = false;
        // Clear all metric fields
        document.getElementById('avgAdherence').value = '';
        document.getElementById('avgOverallExperience').value = '';
        document.getElementById('avgRepSatisfaction').value = '';
        document.getElementById('avgFCR').value = '';
        document.getElementById('avgTransfers').value = '';
        document.getElementById('avgSentiment').value = '';
        document.getElementById('avgPositiveWord').value = '';
        document.getElementById('avgNegativeWord').value = '';
        document.getElementById('avgManagingEmotions').value = '';
        document.getElementById('avgAHT').value = '';
        document.getElementById('avgACW').value = '';
        document.getElementById('avgHoldTime').value = '';
        document.getElementById('avgReliability').value = '';
        return;
    }
    
    // Get the week data
    const week = weeklyData[weekKey];
    if (!week) return;
    
    // Parse the weekKey format: "startDate|endDate"
    const [startDate, endDate] = weekKey.split('|');
    
    // Set period type to "week" since we're selecting from weekly data
    document.getElementById('avgPeriodType').value = 'week';
    
    // Set the dates from the metadata
    mondayInput.value = startDate;
    sundayInput.value = endDate;
    
    // Enable date fields so user can edit if needed
    mondayInput.disabled = false;
    sundayInput.disabled = false;
    
    // Load saved call center averages for this period
    const averages = getCallCenterAverageForPeriod(weekKey);
    
    if (averages) {
        // Populate metric fields with saved values
        document.getElementById('avgAdherence').value = averages.adherence || '';
        document.getElementById('avgOverallExperience').value = averages.overallExperience || '';
        document.getElementById('avgRepSatisfaction').value = averages.repSatisfaction || '';
        document.getElementById('avgFCR').value = averages.fcr || '';
        document.getElementById('avgTransfers').value = averages.transfers || '';
        document.getElementById('avgSentiment').value = averages.sentiment || '';
        document.getElementById('avgPositiveWord').value = averages.positiveWord || '';
        document.getElementById('avgNegativeWord').value = averages.negativeWord || '';
        document.getElementById('avgManagingEmotions').value = averages.managingEmotions || '';
        document.getElementById('avgAHT').value = averages.aht || '';
        document.getElementById('avgACW').value = averages.acw || '';
        document.getElementById('avgHoldTime').value = averages.holdTime || '';
        document.getElementById('avgReliability').value = averages.reliability || '';
    }
    
    showToast(`Selected week of ${week.metadata?.label || startDate}`, 5000);
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
    const fieldMap = {
        'adherence': 'avgAdherence',
        'overallExperience': 'avgOverallExperience',
        'repSatisfaction': 'avgRepSatisfaction',
        'fcr': 'avgFCR',
        'transfers': 'avgTransfers',
        'sentiment': 'avgSentiment',
        'positiveWord': 'avgPositiveWord',
        'negativeWord': 'avgNegativeWord',
        'managingEmotions': 'avgManagingEmotions',
        'aht': 'avgAHT',
        'acw': 'avgACW',
        'holdTime': 'avgHoldTime',
        'reliability': 'avgReliability'
    };
    
    Object.entries(fieldMap).forEach(([avgKey, inputId]) => {
        const input = document.getElementById(inputId);
        if (input) {
            if (centerAvg) {
                // Check if it's in the main data object or nested in 'data' property
                const value = centerAvg[avgKey] !== undefined ? centerAvg[avgKey] : (centerAvg.data ? centerAvg.data[avgKey] : '');
                input.value = value !== null && value !== undefined ? value : '';
            } else {
                input.value = '';
            }
        }
    });
    
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
        
        const averageData = {
            adherence: parseFloat(document.getElementById('avgAdherence')?.value) || 0,
            overallExperience: parseFloat(document.getElementById('avgOverallExperience')?.value) || 0,
            repSatisfaction: parseFloat(document.getElementById('avgRepSatisfaction')?.value) || 0,
            fcr: parseFloat(document.getElementById('avgFCR')?.value) || 0,
            transfers: parseFloat(document.getElementById('avgTransfers')?.value) || 0,
            sentiment: parseFloat(document.getElementById('avgSentiment')?.value) || 0,
            positiveWord: parseFloat(document.getElementById('avgPositiveWord')?.value) || 0,
            negativeWord: parseFloat(document.getElementById('avgNegativeWord')?.value) || 0,
            managingEmotions: parseFloat(document.getElementById('avgManagingEmotions')?.value) || 0,
            aht: parseFloat(document.getElementById('avgAHT')?.value) || 0,
            acw: parseFloat(document.getElementById('avgACW')?.value) || 0,
            holdTime: parseFloat(document.getElementById('avgHoldTime')?.value) || 0,
            reliability: parseFloat(document.getElementById('avgReliability')?.value) || 0
        };
        
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
        
        // Find the previous week
        const allKeys = Object.keys(weeklyData).sort();
        const currentIndex = allKeys.indexOf(currentWeekKey);
        
        if (currentIndex <= 0) {
            alert('ℹ️ No previous week found');
            return;
        }
        
        const previousWeekKey = allKeys[currentIndex - 1];
        const previousAverages = getCallCenterAverageForPeriod(previousWeekKey);
        
        if (!previousAverages || Object.keys(previousAverages).length === 0) {
            alert('ℹ️ No averages found for previous week');
            return;
        }
        
        // Copy all values
        document.getElementById('avgAdherence').value = previousAverages.adherence || '';
        document.getElementById('avgOverallExperience').value = previousAverages.overallExperience || '';
        document.getElementById('avgRepSatisfaction').value = previousAverages.repSatisfaction || '';
        document.getElementById('avgFCR').value = previousAverages.fcr || '';
        document.getElementById('avgTransfers').value = previousAverages.transfers || '';
        document.getElementById('avgSentiment').value = previousAverages.sentiment || '';
        document.getElementById('avgPositiveWord').value = previousAverages.positiveWord || '';
        document.getElementById('avgNegativeWord').value = previousAverages.negativeWord || '';
        document.getElementById('avgManagingEmotions').value = previousAverages.managingEmotions || '';
        document.getElementById('avgAHT').value = previousAverages.aht || '';
        document.getElementById('avgACW').value = previousAverages.acw || '';
        document.getElementById('avgHoldTime').value = previousAverages.holdTime || '';
        document.getElementById('avgReliability').value = previousAverages.reliability || '';
        
        markUnsavedChanges();
        showToast('✅ Copied from previous week! Click Save to apply.', 4000);
    });

function updateTrendButtonsVisibility() {
    const employeeDropdown = document.getElementById('trendEmployeeSelect');
    const generateTrendBtn = document.getElementById('generateTrendBtn');
    const generateAllTrendBtn = document.getElementById('generateAllTrendBtn');
    const selectedValue = employeeDropdown?.value || '';

    if (selectedValue === '') {
        if (generateTrendBtn) generateTrendBtn.style.display = 'none';
        if (generateAllTrendBtn) generateAllTrendBtn.style.display = 'none';
    } else if (selectedValue === 'ALL') {
        if (generateTrendBtn) generateTrendBtn.style.display = 'none';
        if (generateAllTrendBtn) generateAllTrendBtn.style.display = 'block';
    } else {
        if (generateTrendBtn) generateTrendBtn.style.display = 'block';
        if (generateAllTrendBtn) generateAllTrendBtn.style.display = 'none';
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
    
    if (saveMetricsPreviewBtn) {
        saveMetricsPreviewBtn.addEventListener('click', saveMetricsPreviewEdits);
    }
    
    // Show/hide buttons based on employee selection
    const employeeDropdown = document.getElementById('trendEmployeeSelect');
    if (employeeDropdown) {
        employeeDropdown.addEventListener('change', (e) => {
            const selectedValue = e.target.value;
            const generateTrendBtn = document.getElementById('generateTrendBtn');
            const generateAllTrendBtn = document.getElementById('generateAllTrendBtn');
            
            if (selectedValue === '') {
                // No selection - hide both buttons
                if (generateTrendBtn) generateTrendBtn.style.display = 'none';
                if (generateAllTrendBtn) generateAllTrendBtn.style.display = 'none';
            } else if (selectedValue === 'ALL') {
                // All associates selected - show only "Generate All"
                if (generateTrendBtn) generateTrendBtn.style.display = 'none';
                if (generateAllTrendBtn) generateAllTrendBtn.style.display = 'block';
            } else {
                // Specific associate selected - show only "Generate Trend Email"
                if (generateTrendBtn) generateTrendBtn.style.display = 'block';
                if (generateAllTrendBtn) generateAllTrendBtn.style.display = 'none';
            }
        });
    }

    // Ensure buttons are correctly shown on initial load
    updateTrendButtonsVisibility();
    
}

function displayMetricsPreview(employeeName, weekKey) {
    const metricsPreviewSection = document.getElementById('metricsPreviewSection');
    const metricsPreviewGrid = document.getElementById('metricsPreviewGrid');
    
    if (!metricsPreviewSection || !metricsPreviewGrid) return;
    
    const periodData = ytdData[weekKey] || weeklyData[weekKey];
    if (!periodData || !periodData.employees) return;
    
    const employee = periodData.employees.find(emp => emp.name === employeeName);
    if (!employee) return;
    
    metricsPreviewSection.dataset.employee = employeeName;
    metricsPreviewSection.dataset.period = weekKey;
    

    
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
        const value = employee[metric.key] !== undefined ? employee[metric.key] : '';
        const registryMetric = METRICS_REGISTRY[metric.key];
        const target = registryMetric?.target?.value;
        const targetType = registryMetric?.target?.type;
        
        // Build target hint like call center averages do
        let targetHint = '';
        if (target !== undefined && targetType) {
            const targetSymbol = targetType === 'min' ? '≥' : '≤';
            targetHint = ` (Target: ${targetSymbol} ${target}${metric.unit})`;
        }
        
        html += `
            <div>
                <label style="font-weight: bold; display: block; margin-bottom: 3px; font-size: 0.85em;">${metric.label} (${metric.unit})${targetHint}:</label>
                <input type="number" class="metric-preview-input" data-metric="${metric.key}" step="0.01" value="${value}" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px;">
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

/**
 * Analyzes employee metrics to identify performance gaps and trends.
 * Compares individual achievements against targets and team center averages.
 * 
 * @param {Object} employeeData - Employee's current metric values
 *   Keys: scheduleAdherence, overallExperience, fcr, transfers, aht, acw, etc.
 * @param {Object} centerAverages - Team's center average values for comparison
 * @returns {Object} Analysis result with structure:
 *   {weakest: Metric, trendingDown: Metric | null}
 *   Each metric has: metricKey, label, achievementPct, employeeValue, target, centerValue
 *
 * @example
 * const analysis = analyzeTrendMetrics(empData, centerAvgs);
 * if (analysis.weakest) console.log(`Weakest: ${analysis.weakest.label}`);
 * if (analysis.trendingDown) console.log(`Trending: ${analysis.trendingDown.label}`);
 */
function analyzeTrendMetrics(employeeData, centerAverages) {
    /**
     * Analyze metrics and return:
     * 1. Weakest metric = furthest below their target
     * 2. Trending down = first metric below center average (if different from weakest)
     */
    const allMetrics = [];
    
    const metricMappings = {
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
    
    const isReverseMetric = (key) => ['transfers', 'aht', 'holdTime', 'acw', 'reliability'].includes(key);
    
    Object.entries(metricMappings).forEach(([registryKey, csvKey]) => {
        const employeeValue = parseFloat(employeeData[registryKey]) || 0;
        const centerValue = parseFloat(centerAverages[csvKey]) || 0;
        const metric = METRICS_REGISTRY[registryKey];
        
        if (!metric) return;
        
        // Skip if employee value is 0 (not provided)
        if (employeeValue === 0) return;
        
        const target = metric.target?.value || 0;
        const targetType = metric.target?.type || 'min';
        const isReverse = isReverseMetric(registryKey);
        
        // Check if meets target based on target type
        const meetsTarget = targetType === 'min' 
            ? employeeValue >= target 
            : employeeValue <= target;
        
        // Check if below center
        const isBelowCenter = centerValue > 0 
            ? (isReverse ? employeeValue > centerValue : employeeValue < centerValue)
            : false;
        
        allMetrics.push({
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
                ? Math.max(0, target - employeeValue)  // How far below target
                : Math.max(0, employeeValue - target)  // How far above target
        });
    });
    
    // Find weakest (largest gap from target among those not meeting target)
    const notMeetingTarget = allMetrics.filter(m => !m.meetsTarget);
    const weakest = notMeetingTarget.length > 0
        ? notMeetingTarget.reduce((prev, curr) => 
            curr.gapFromTarget > prev.gapFromTarget ? curr : prev
          )
        : null;
    
    // Find second priority coaching metric (second worst below target, not based on center average)
    // Prioritize non-sentiment metrics unless sentiment data is available
    const nonSentimentNotMeetingTarget = notMeetingTarget.filter(m => 
        !['positiveWord', 'negativeWord', 'managingEmotions'].includes(m.metricKey) &&
        m.metricKey !== weakest?.metricKey
    );
    const trendingDown = nonSentimentNotMeetingTarget.length > 0
        ? nonSentimentNotMeetingTarget.reduce((prev, curr) => 
            curr.gapFromTarget > prev.gapFromTarget ? curr : prev
          )
        : notMeetingTarget.find(m => m.metricKey !== weakest?.metricKey);
    
    return {
        weakest: weakest,
        trendingDown: trendingDown || (allMetrics.find(m => m.isBelowCenter) !== weakest ? allMetrics.find(m => m.isBelowCenter) : null),
        allMetrics: allMetrics  // NEW: include all metrics for comprehensive prompt building
    };
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
        
        // Fisher-Yates shuffle for proper randomization
        const shuffled = [...allTips];
        for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled.slice(0, count);
    }
    
    return [];
}

function generateTrendEmail() {
    const employeeName = document.getElementById('trendEmployeeSelect')?.value;
    const weekKey = document.getElementById('trendPeriodSelect')?.value;
    const nickname = document.getElementById('trendNickname')?.value.trim();
    
    if (!employeeName || !weekKey) {
        console.error('Missing selection - Employee:', employeeName, 'Week:', weekKey);
        showToast('Please select both employee and period', 5000);
        return;
    }

    if (employeeName && nickname) {
        saveNickname(employeeName, nickname);
    }
    
    // Get current period data (weekly only)
    const period = weeklyData[weekKey];
    if (!period) {
        if (ytdData[weekKey]) {
            showToast('YTD period selected. Please select a weekly period for Metric Trends.', 5000);
        } else {
            showToast('No data found for this period', 5000);
        }
        return;
    }
    
    const employee = period.employees.find(e => e.name === employeeName);
    if (!employee) {
        showToast('Employee not found in selected period', 5000);
        return;
    }
    
    // Get previous period (strictly same period type + correct previous period)
    const currentPeriodType = period.metadata?.periodType || 'week';
    const prevPeriodKey = getPreviousPeriodData(weekKey, currentPeriodType);
    const prevPeriod = prevPeriodKey ? weeklyData[prevPeriodKey] : null;
    const prevEmployee = prevPeriod?.employees.find(e => e.name === employeeName);
    
    // Use nickname if provided, otherwise use full name
    const displayName = nickname || employeeName;
    
    // Build email image FIRST (while page has focus)
    showToast('ℹ️ Creating email image...', 3000);
    
    // Get center averages for trend analysis
    const centerAgvs = getCallCenterAverageForPeriod(weekKey) || {};
    
    // Analyze metrics: find weakest + trending down
    const trendAnalysis = analyzeTrendMetrics(employee, centerAgvs);
    const weakestMetric = trendAnalysis.weakest;
    const trendingMetric = trendAnalysis.trendingDown;
    const allMetrics = trendAnalysis.allMetrics || [];  // NEW: capture all metrics
    
    // Get tips for the trending metric
    let tipsForTrend = [];
    if (trendingMetric) {
        tipsForTrend = getRandomTipsForMetric(trendingMetric.metricKey, 2);
    }

    const periodMeta = period.metadata || {};
    
    // Get sentiment snapshot from dropdown selection (instead of automatic lookup)
    let sentimentSnapshot = null;
    const sentimentSelect = document.getElementById('trendSentimentSelect');
    const selectedSentiment = sentimentSelect?.value;
    
    if (selectedSentiment) {
        // User selected a specific sentiment snapshot
        const [startDate, endDate] = selectedSentiment.split('|');
        const snapshots = associateSentimentSnapshots[employeeName];
        
        if (snapshots && Array.isArray(snapshots)) {
            const matchingSnapshot = snapshots.find(s => 
                s.timeframeStart === startDate && s.timeframeEnd === endDate
            );
            
            if (matchingSnapshot) {
                sentimentSnapshot = matchingSnapshot;
                console.log('📊 Using selected sentiment snapshot:', sentimentSnapshot);
            }
        }
    }
    // If no sentiment selected, sentimentSnapshot remains null (no sentiment in email)
    
    createTrendEmailImage(displayName, weekKey, period, employee, prevEmployee, () => {
        // AFTER image is copied to clipboard, show tips panel with strengths + areas to focus
        const mailPeriodType = periodMeta.periodType === 'week' ? 'Weekly' : periodMeta.periodType === 'month' ? 'Monthly' : periodMeta.periodType === 'quarter' ? 'Quarterly' : 'Weekly';
        const mailPeriodLabel = periodMeta.periodType === 'week' ? 'Week' : periodMeta.periodType === 'month' ? 'Month' : periodMeta.periodType === 'quarter' ? 'Quarter' : 'Week';
        const mailEndDate = periodMeta.endDate || 'unknown';
        const emailSubject = `Trending Metrics - ${mailPeriodType} - ${mailPeriodLabel} ending ${mailEndDate} for ${displayName}`;
        
        if (DEBUG) { console.log('Opening Outlook with subject:', emailSubject); }
        
        // ALWAYS open Outlook first so user can paste the image
        openTrendEmailOutlook(emailSubject);
        showToast('📧 Outlook opening... Image is copied to clipboard. Paste into email body, then use the prompt below for coaching text.', 4000);
        
        // If there's a trending metric with tips, ALSO show coaching panel for Copilot prompt
        if (trendingMetric && tipsForTrend.length > 0) {
            showTrendsWithTipsPanel(employeeName, displayName, weakestMetric, trendingMetric, tipsForTrend, weekKey, periodMeta, emailSubject, sentimentSnapshot, allMetrics);
        }
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

/**
 * Displays a modal panel for trend-based coaching with praise, focus areas, and tips.
 * User can review coaching suggestions, add notes, and optionally launch Copilot for email drafting.
 * 
 * @param {string} employeeName - Employee identifier (display name)
 * @param {string} displayName - Formatted name for display in modal
 * @param {Object} weakestMetric - Employee's lowest-performing metric
 *   Properties: {metricKey, label, meetsTarget, employeeValue, target, targetType}
 * @param {Object} trendingMetric - Metric below team center average
 *   Properties: {metricKey, label, employeeValue, centerValue}
 * @param {string[]} tips - Array of coaching tips for trending metric
 * @param {string} weekKey - Period identifier for logging
 * @param {Object} periodMeta - Period metadata with label and dates
 * @param {string} emailSubject - Subject line for potential email
 * @returns {void} Creates modal in DOM, handles clicks and coaching logging
 * 
 * @example
 * showTrendsWithTipsPanel('john', 'John Doe', weakest, trending, ['Tip 1', 'Tip 2'], 'key', {...}, 'Subject');
 */
function showTrendsWithTipsPanel(employeeName, displayName, weakestMetric, trendingMetric, tips, weekKey, periodMeta, emailSubject, sentimentSnapshot = null, allMetrics = null) {
    /**
     * Show a modal/panel with:
     * - Praise for strongest metric
     * - Focus area (trending down metric) with 2 coaching tips
     * - Open Copilot with coaching prompt
     */
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
    
    const periodLabel = periodMeta.label || (periodMeta.endDate ? `Week ending ${formatDateMMDDYYYY(periodMeta.endDate)}` : 'this period');
    
    // Build praise section for what they're doing well (weakest metric is close to target)
    let praiseHtml = '';
    if (weakestMetric && weakestMetric.gapFromTarget <= (weakestMetric.target * 0.25)) {
        // If weakest is within 25% of target, praise their overall performance
        praiseHtml = `
            <div style="margin-bottom: 20px; padding: 15px; background: #d4edda; border-radius: 4px; border-left: 4px solid #28a745;">
                <h4 style="color: #28a745; margin-top: 0;">🌟 Great Work!</h4>
                <p style="margin: 0; color: #333;">
                    ${displayName}'s <strong>${weakestMetric.label}</strong> is at <strong>${weakestMetric.employeeValue.toFixed(1)}</strong> 
                    (target: ${weakestMetric.target.toFixed(1)})
                </p>
            </div>
        `;
    }
    
    // Trending metric section
    const trendingHtml = `
        <div style="margin-bottom: 20px; padding: 15px; background: #fff3cd; border-radius: 4px; border-left: 4px solid #ff9800;">
            <h4 style="color: #ff9800; margin-top: 0;">📉 Focus Area</h4>
            <p style="margin: 5px 0 15px 0; color: #333;">
                <strong>${trendingMetric.label}</strong> is at <strong>${trendingMetric.employeeValue.toFixed(1)}</strong> 
                vs team average <strong>${trendingMetric.centerValue.toFixed(1)}</strong>
            </p>
        </div>
    `;
    
    const tipsHtml = tips.map((tip, i) => `
        <div style="background: #f0f0f0; padding: 12px; border-radius: 4px; margin-bottom: 10px; border-left: 4px solid #9c27b0;">
            <strong>💡 Tip ${i + 1}:</strong> ${tip}
        </div>
    `).join('');

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
    
    // Build the comprehensive Copilot prompt (NEW)
    const userNotes = ''; // Will be filled by user in textarea
    const copilotPrompt = buildTrendCoachingPrompt(
        displayName, 
        weakestMetric, 
        trendingMetric, 
        tips, 
        userNotes,
        sentimentSnapshot,
        allMetrics
    );
    
    panel.innerHTML = `
        <h3 style="color: #9c27b0; margin-top: 0;">📊 Coaching Summary for ${displayName}</h3>
        <p style="color: #666; margin-bottom: 20px; font-size: 0.95em;">${periodLabel}</p>
        
        ${praiseHtml}
        ${trendingHtml}
        
        <div style="margin: 20px 0; padding: 15px; background: #e3f2fd; border-radius: 4px;">
            <h4 style="color: #1976d2; margin-top: 0;">💡 Coaching Tips for ${trendingMetric.label}</h4>
            ${tipsHtml}
        </div>

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
    
    modal.appendChild(panel);
    document.body.appendChild(modal);
    
    // Copy prompt button handler
    document.getElementById('copyPromptBtn').addEventListener('click', () => {
        const textarea = document.getElementById('copilotPromptDisplay');
        textarea.select();
        document.execCommand('copy');
        showToast('✅ Prompt copied! Opening Copilot...', 2000);
        
        // Open Copilot in new tab
        window.open('https://copilot.microsoft.com', '_blank');
    });
    
    document.getElementById('logTrendCoachingBtn').addEventListener('click', () => {
        const userNotesText = document.getElementById('trendCoachingNotes').value.trim();
        
        // Rebuild prompt with user notes if provided
        const finalPrompt = userNotesText 
            ? buildTrendCoachingPrompt(
                displayName, 
                weakestMetric, 
                trendingMetric, 
                tips, 
                userNotesText,
                sentimentSnapshot,
                allMetrics
            )
            : copilotPrompt;
        
        // Log as coaching entry
        recordCoachingEvent({
            employeeId: employeeName,
            weekEnding: periodLabel,
            metricsCoached: [trendingMetric.metricKey],
            aiAssisted: true
        });
        
        showToast('✅ Coaching logged', 2000);
        
        // Update textarea with final prompt and offer to copy
        document.getElementById('copilotPromptDisplay').value = finalPrompt;
        showToast('💡 Updated prompt above with your notes. Copy and paste into CoPilot!', 3000);
        document.getElementById('copilotPromptDisplay').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    
    document.getElementById('skipTrendCoachingBtn').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Close on background click
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
}

/**
 * Builds a natural language prompt for Microsoft Copilot to draft a coaching email.
 * Incorporates performance data, tips, and optional notes into guidance for AI.
 * 
 * @param {string} displayName - Employee's name for personalization
 * @param {Object} weakestMetric - Employee's lowest-performing metric
 *   Properties: {label, meetsTarget, employeeValue, target, targetType}
 * @param {Object} trendingMetric - Metric showing downward trend from team average
 *   Properties: {label, employeeValue, centerValue}
 * @param {string[]} tips - Array of coaching tips for the focus metric
 * @param {string} userNotes - Optional additional context from hiring manager
 * @returns {string} Formatted prompt text for Copilot to generate coaching email
 *
 * @example
 * const prompt = buildTrendCoachingPrompt('John', weakest, trending, ['Tip 1', 'Tip 2'], '');
 * window.open(`https://copilot.microsoft.com/?q=${encodeURIComponent(prompt)}`);
 */
function buildTrendCoachingPrompt(displayName, weakestMetric, trendingMetric, tips, userNotes, sentimentSnapshot = null, allTrendMetrics = null) {
    /**
     * Build a concise, factual CoPilot prompt for trend coaching email
     * - List successes (meeting target)
     * - List opportunities (below target) with tips
     * - Include sentiment data if available
     * - Keep it brief and factual, no fluff
     */
    
    // SUCCESSES SECTION - Only metrics meeting target
    const successes = allTrendMetrics 
        ? allTrendMetrics.filter(m => m.meetsTarget) 
        : [];
    
    let prompt = `Draft a coaching email for ${displayName}.\n\n`;
    
    if (successes.length > 0) {
        prompt += `WINS:\n`;
        successes.slice(0, 3).forEach(metric => {
            prompt += `- ${metric.label}: ${metric.employeeValue.toFixed(1)} (target: ${metric.target.toFixed(1)})\n`;
        });
        prompt += `\n`;
    }
    
    // OPPORTUNITIES SECTION - Metrics not meeting target
    const opportunities = allTrendMetrics 
        ? allTrendMetrics.filter(m => !m.meetsTarget)
        : [];
    
    if (opportunities.length > 0) {
        prompt += `OPPORTUNITIES:\n`;
        opportunities.slice(0, 3).forEach(metric => {
            // For negativeWord metric: show both using % and avoiding %
            let displayValue = `${metric.employeeValue.toFixed(1)} (target: ${metric.target.toFixed(1)})`;
            if (metric.metricKey === 'negativeWord') {
                const usingNegative = (100 - metric.employeeValue).toFixed(1);
                const usingNegativeTarget = (100 - metric.target).toFixed(1);
                displayValue = `${metric.employeeValue.toFixed(1)}% avoiding, ${usingNegative}% using negative words (target: avoid ${metric.target.toFixed(1)}%, use ${usingNegativeTarget}%)`;
            }
            
            prompt += `- ${metric.label}: ${displayValue}\n`;
        });
        prompt += `\n`;
    }
    
    if (opportunities.length > 0) {
        prompt += `HOW TO IMPROVE:\n`;
        opportunities.slice(0, 3).forEach(metric => {
            // Add 1 random tip for this metric using Fisher-Yates for proper randomization
            const metricTips = typeof getMetricTips === 'function' ? getMetricTips(metric.metricKey) : [];
            if (metricTips && metricTips.length > 0) {
                // Shuffle tips and pick first one for true randomization
                const shuffled = [...metricTips];
                for (let i = shuffled.length - 1; i > 0; i--) {
                    const j = Math.floor(Math.random() * (i + 1));
                    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
                }
                const randomTip = shuffled[0];
                prompt += `- ${metric.label}: ${randomTip}\n`;
            }
        });
        prompt += `\n`;
    }
    
    // SENTIMENT SECTION - if snapshot exists
    if (sentimentSnapshot) {
        const sentimentMetrics = allTrendMetrics
            ? {
                negativeWord: allTrendMetrics.find(m => m.metricKey === 'negativeWord')?.employeeValue,
                positiveWord: allTrendMetrics.find(m => m.metricKey === 'positiveWord')?.employeeValue,
                managingEmotions: allTrendMetrics.find(m => m.metricKey === 'managingEmotions')?.employeeValue
            }
            : null;
        const sentimentFocusText = buildSentimentFocusAreasForPrompt(sentimentSnapshot, sentimentMetrics);
        if (sentimentFocusText) {
            prompt += `SENTIMENT DATA:\n`;
            prompt += `${sentimentFocusText}\n\n`;
        }
    }
    
    if (userNotes) {
        prompt += `ADDITIONAL NOTES:\n${userNotes}\n\n`;
    }
    
    prompt += `Make it warm and encouraging while staying factual and concise.`;
    
    return prompt;
}



function formatMetricName(camelCase) {
    // Map camelCase property names to display names
    const metricNameMap = {
        'scheduleAdherence': 'Schedule Adherence',
        'overallExperience': 'Overall Experience',
        'cxRepOverall': 'Rep Satisfaction',
        'fcr': 'FCR',
        'overallSentiment': 'Sentiment Overall',
        'positiveWord': 'Positive Word Usage',
        'negativeWord': 'Avoiding Negative Words',
        'managingEmotions': 'Managing Emotions',
        'aht': 'AHT',
        'acw': 'ACW',
        'holdTime': 'Hold Time',
        'reliability': 'Reliability'
    };
    
    return metricNameMap[camelCase] || camelCase;
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

function renderMetricRow(ctx, x, y, width, height, metric, associateValue, centerAvg, ytdValue, target, previousValue, rowIndex, alternatingColor, surveyTotal = 0, metricKey = '', periodType = 'week', ytdSurveyTotal = 0) {
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
    
    // ROW BACKGROUND COLOR
    let rowBgColor;
    if (noSurveys) {
        rowBgColor = '#ffffff'; // White - no surveys
    } else if (meetsGoal) {
        rowBgColor = '#d4edda'; // Green - meets goal
    } else {
        rowBgColor = '#fff3cd'; // Yellow - does not meet goal
    }
    
    // Draw row background
    ctx.fillStyle = rowBgColor;
    ctx.fillRect(x, y, width, height);
    
    // Draw row border
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, width, height);
    
    // Metric name with target
    ctx.fillStyle = '#333333';
    ctx.font = '14px Arial';
    ctx.textAlign = 'left';
    const targetDisplay = formatMetricDisplay(metric.key, target);
    ctx.fillText(`${metric.label} (${targetDisplay})`, x + 10, y + 24);
    
    // Associate value - show N/A if no surveys, otherwise display the metric value
    ctx.fillStyle = noSurveys ? '#999999' : '#333333';
    ctx.font = noSurveys ? 'bold 14px Arial' : 'bold 14px Arial';
    ctx.textAlign = 'center';
    const formattedValue = noSurveys ? 'N/A' : formatMetricValue(metric.key, associateValue);
    ctx.fillText(formattedValue, x + 240, y + 24);
    
    // Center average - ALWAYS show if available (independent of weekly surveys)
    ctx.fillStyle = '#333333';
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    const formattedCenter = centerExists ? formatMetricValue(metric.key, centerAvg) : 'N/A';
    ctx.fillText(formattedCenter, x + 340, y + 24);
    
    // VS CENTER and TRENDING - only calculate if employee has survey data this period
    if (!noSurveys) {
        // VS CENTER CELL - show raw difference
        let vsCenterColor;
        let vsCenterText;
        
        if (!centerExists) {
            vsCenterColor = '#999999'; // Gray - no data
            vsCenterText = 'N/A';
        } else {
            const difference = associateValue - centerAvg;
            
            // Always show raw difference
            vsCenterText = formatMetricValue(metric.key, Math.abs(difference));
            if (difference > 0) vsCenterText = `+${vsCenterText}`;
            else if (difference < 0) vsCenterText = `-${vsCenterText}`;
            
            if (isAboveCenter) {
                vsCenterColor = '#0056B3'; // Blue - above center
            } else {
                vsCenterColor = '#DAA520'; // Dark yellow - below center
            }
        }
        
        ctx.fillStyle = vsCenterColor;
        ctx.font = 'bold 14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText(vsCenterText, x + 460, y + 24);
        
        // Trending (if previous data exists) - show emoji + change value
        let trendingColor = '#666666';
        let trendingText = 'N/A';
        let trendingEmoji = '';
        
        // Only show trending if previous value exists AND is a valid number
        const prevNum = previousValue !== undefined && previousValue !== null ? parseFloat(previousValue) : null;
        const prevIsValid = prevNum !== null && !isNaN(prevNum);
        
        if (prevIsValid) {
            const trendDiff = associateValue - prevNum;
        const absDiff = Math.abs(trendDiff);
        
        // Determine improvement based on metric type
        const isImprovement = isReverse ? trendDiff < 0 : trendDiff > 0;
        
        if (absDiff < 0.1) {
            trendingEmoji = '➡️'; // Flat/no change
            trendingColor = '#666666';
            trendingText = '➡️ No change';
        } else {
            const changeValue = formatMetricValue(metricKey, absDiff);
            const periodLabel = periodType === 'month' ? 'month' : periodType === 'quarter' ? 'quarter' : 'week';
            const sign = trendDiff > 0 ? '+' : '-';
            const directionEmoji = trendDiff > 0 ? '📈' : '📉';
            trendingColor = isImprovement ? '#28a745' : '#dc3545';
            trendingText = `${directionEmoji} ${sign}${changeValue} vs last ${periodLabel}`;
        }
        }
        
        ctx.fillStyle = trendingColor;
        ctx.font = '13px Arial'; // Smaller font to fit change description
        ctx.textAlign = 'left';
        ctx.fillText(trendingText, x + 570, y + 24);
    } else {
        // If no surveys, show N/A for vs center and trend (but center avg already shown above)
        ctx.fillStyle = '#999999';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('N/A', x + 460, y + 24);
        ctx.textAlign = 'left';
        ctx.fillText('N/A', x + 570, y + 24);
    }
    
    // YTD value - always render for all view types
    // CRITICAL: YTD display is INDEPENDENT of weekly survey count
    let formattedYtd = '';
    const ytdValueNum = parseFloat(ytdValue);
    const ytdHasValue = ytdValue !== undefined && ytdValue !== null && ytdValue !== '' && !isNaN(ytdValueNum);
    
    // For survey metrics: Show YTD value if it exists, regardless of weekly count
    // Only show N/A if ytdSurveyTotal is 0 (no YTD surveys at all)
    if (isSurveyMetric) {
        // Check if there's any YTD survey data
        if (ytdSurveyTotal > 0 && ytdHasValue) {
            // YTD surveys exist, show the metric value
            formattedYtd = formatMetricValue(metric.key, ytdValueNum);
        } else if (ytdSurveyTotal === 0) {
            // No YTD surveys at all
            formattedYtd = 'N/A';
        } else {
            // Edge case: ytdSurveyTotal > 0 but no ytdValue
            formattedYtd = 'N/A';
        }
    } else {
        // Non-survey metrics: show value if available
        if (ytdHasValue) {
            formattedYtd = formatMetricValue(metric.key, ytdValueNum);
        }
    }
    
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
    
    // Extract metadata early (needed for survey total calculation)
    const metadata = period?.metadata || {};

    // SINGLE LOAD - Use for all calculations
    const metricOrder = getMetricOrder();
    const metrics = {};
    const prevMetrics = {};
    
    metricOrder.forEach(({ key }) => {
        if (current[key] !== undefined) {
            metrics[key] = current[key];
        }
        if (previous && previous[key] !== undefined) {
            prevMetrics[key] = previous[key];
        }
    });
    
    // SINGLE DATA SOURCE - Center averages (use weekKey for lookup)
    const callCenterAverages = loadCallCenterAverages();
    const centerAvg = callCenterAverages[weekKey] || {};

    // YTD data (separate dataset)
    const ytdPeriod = getYtdPeriodForWeekKey(weekKey);
    const ytdEmployee = ytdPeriod?.employees?.find(e => e.name === current.name) || null;
    const ytdAvailable = !!ytdEmployee;

    // Extract survey total for survey metrics
    // WEEK views: surveyTotal = current week only, ytdSurveyTotal = SUM of all weeks YTD
    // MONTH/YTD views: surveyTotal = aggregated for period, ytdSurveyTotal = SUM of all weeks YTD
    let surveyTotal = current.surveyTotal ? parseInt(current.surveyTotal, 10) : 0;
    let ytdSurveyTotal = 0;
    
    // Calculate YTD survey total by SUMMING all weeks in the year (not using most recent value)
    const currentEndDate = metadata.endDate || ''; // Format: YYYY-MM-DD
    const currentYear = currentEndDate.substring(0, 4); // Extract YYYY
    
    if (DEBUG) {
        console.log(`=== YTD SURVEY LOOKUP (${current.name}) for ${metadata.periodType} ===`);
        console.log(`Current period: ${currentEndDate}, year: ${currentYear}`);
    }
    
    // SUM all weekly survey totals from this year up to the current period
    // Each week's surveyTotal is just that week's count, not cumulative
    let aggregatedYtdSurveys = 0;
    
    for (const wk in weeklyData) {
        const weekMeta = weeklyData[wk]?.metadata || {};
        const weekEndDate = weekMeta.endDate || wk.split('|')[1] || '';
        const weekYear = weekEndDate.substring(0, 4);
        const weekPeriodType = weekMeta.periodType || 'week';
        
        // Sum WEEKLY records from same calendar year that end on or before current period
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
    
    // For MONTH/YTD views: also update surveyTotal to show aggregated value for the period
    if (metadata.periodType === 'month' || metadata.periodType === 'ytd') {
        surveyTotal = ytdSurveyTotal;
        if (DEBUG) console.log(`${metadata.periodType} aggregated surveys: ${surveyTotal}`);
    }
    // For WEEK views: surveyTotal stays as current week's count
    
    if (DEBUG) console.log(`Final: surveyTotal=${surveyTotal}, ytdSurveyTotal=${ytdSurveyTotal}, periodType=${metadata.periodType}`);

    
    
    // SUMMARY STATISTICS (used by both canvas and HTML)
    // When no surveys exist, exclude the 3 survey metrics from the denominator
    const surveyMetricKeys = ['cxRepOverall', 'fcr', 'overallExperience'];
    const hasSurveys = surveyTotal > 0;
    
    let meetingGoals = 0;
    let improved = 0;
    let beatingCenter = 0;
    let measuredMetricCount = 0;

    metricOrder.forEach(({ key }) => {
        if (metrics[key] === undefined) return;
        
        // Skip survey metrics if no surveys exist
        if (!hasSurveys && surveyMetricKeys.includes(key)) return;
        
        measuredMetricCount++;
        
        const curr = parseFloat(metrics[key]) || 0;
        const target = getMetricTarget(key);
        const center = getCenterAverageForMetric(centerAvg, key);
        
        if (isMetricMeetingTarget(key, curr, target)) meetingGoals++;
        
        // Check if beating center average
        if (center > 0) {
            const isReverse = isReverseMetric(key);
            if (isReverse ? curr < center : curr > center) {
                beatingCenter++;
            }
        }
        
        // Only count improvements if we have previous data
        if (previous && prevMetrics[key] !== undefined) {
            const prev = parseFloat(prevMetrics[key]) || 0;
            if (curr > prev) improved++;
        }
    });

    const totalMetrics = measuredMetricCount;
    const successRate = Math.round(meetingGoals / totalMetrics * 100);
    const improvedText = previous ? improved.toString() : 'N/A';
    // metadata already extracted at function start
    const periodTypeText = metadata.periodType === 'week' ? 'week' : metadata.periodType === 'month' ? 'month' : metadata.periodType === 'quarter' ? 'quarter' : 'week';
    const improvedSub = previous ? `From Last ${periodTypeText.charAt(0).toUpperCase() + periodTypeText.slice(1)}` : 'No Prior Data';

    // CREATE CANVAS IMAGE (will be resized based on content)
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 2400; // Increased to accommodate legend + all sections
    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 900, 1900);

    let y = 0;

    // Blue gradient header
    const gradient = ctx.createLinearGradient(0, 0, 900, 100);
    gradient.addColorStop(0, '#003DA5');
    gradient.addColorStop(1, '#0056B3');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 900, 100);

    // Header text with dynamic subject
    const periodType = metadata.periodType === 'week' ? 'Weekly' : metadata.periodType === 'month' ? 'Monthly' : metadata.periodType === 'quarter' ? 'Quarterly' : 'Weekly';
    const periodLabel = metadata.periodType === 'week' ? 'Week' : metadata.periodType === 'month' ? 'Month' : metadata.periodType === 'quarter' ? 'Quarter' : 'Week';
    const endDate = metadata.endDate || 'unknown';
    const subjectLine = `Trending Metrics - ${periodType} - ${periodLabel} ending ${endDate} for ${empName}`;
    
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Arial';
    ctx.fillText('📊 Performance Summary', 50, 45);
    ctx.font = '14px Arial';
    ctx.fillText(subjectLine, 50, 75);

    y = 130;

    // Greeting
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 20px Arial';
    ctx.fillText(`Hi ${empName},`, 50, y);
    y += 40;

    // Summary line
    ctx.font = '15px Arial';
    ctx.fillStyle = '#666666';
    ctx.fillText(`Here's your performance summary and how you compare to call center averages.`, 50, y);
    y += 50;

    // Summary cards (using shared statistics)
    drawEmailCard(ctx, 50, y, 250, 110, '#ffffff', '#28a745', '✅ Meeting Goals', `${meetingGoals}/${totalMetrics}`, `${successRate}% Success Rate`);
    drawEmailCard(ctx, 325, y, 250, 110, '#ffffff', '#2196F3', '📈 Above Average', `${beatingCenter}/${totalMetrics}`, `Better than Call Center`);
    drawEmailCard(ctx, 600, y, 250, 110, '#ffffff', '#ff9800', '📈 Improved', improvedText, improvedSub);

    y += 140;

    // Metrics section header
    ctx.fillStyle = '#e3f2fd';
    ctx.fillRect(40, y, 820, 50);
    ctx.fillStyle = '#003DA5';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('📊 Your Metrics', 50, y + 32);
    y += 70;

    // Table headers
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
    
    y += 45;

    if (!ytdAvailable) {
        ctx.fillStyle = '#666666';
        ctx.font = '12px Arial';
        ctx.fillText('YTD not available – source data not provided.', 50, y + 18);
        y += 28;
    }

    // RENDER METRICS using Phase 3 renderer
    let currentGroup = null;
    let rowIdx = 0;
    
    const SURVEY_METRICS = ['cxRepOverall', 'fcr', 'overallExperience'];
    
    metricOrder.forEach(({ key, group }) => {
        if (metrics[key] === undefined) return;
        
        const metric = METRICS_REGISTRY[key];
        if (!metric) return;
        
        // Draw group header
        if (group !== currentGroup) {
            currentGroup = group;
            
            // Survey group header styling when no surveys
            const isSurveyGroupNoSurveys = group === 'Survey' && !hasSurveys;
            const headerBgColor = isSurveyGroupNoSurveys ? '#ffffff' : '#e3f2fd';
            const headerTextColor = isSurveyGroupNoSurveys ? '#999999' : '#0056B3';
            
            ctx.fillStyle = headerBgColor;
            ctx.fillRect(40, y, 820, 40);
            ctx.fillStyle = headerTextColor;
            ctx.font = 'bold 16px Arial, "Segoe UI Emoji", "Apple Color Emoji"';
            // Add emojis to group headers
            let groupEmoji = '📊';
            if (group === 'Core Performance') groupEmoji = '🎯';
            else if (group === 'Survey') groupEmoji = '📋';
            else if (group === 'Sentiment') groupEmoji = '💬';
            else if (group === 'Reliability') groupEmoji = '⏰';
            
            // Always show weekly and YTD counts for survey metrics (independently)
            let groupLabel;
            if (group === 'Survey') {
                // Format depends on period type
                if (metadata.periodType === 'week') {
                    // Week view: "Survey (X this week | Y YTD)"
                    groupLabel = `${groupEmoji} ${group} (${surveyTotal} this week | ${ytdSurveyTotal} YTD)`;
                } else {
                    // Month/YTD view: "Survey (X this period | Y YTD)"
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
        const target = getMetricTarget(key);
        const ytdValue = ytdEmployee ? ytdEmployee[key] : undefined;
        
        renderMetricRow(ctx, 40, y, 820, 38, metric, curr, center, ytdValue, target, prev, rowIdx, '', surveyTotal, key, metadata.periodType, ytdSurveyTotal);
        y += 38;
        rowIdx++;
    });

    // ========== HIGHLIGHTS SECTION ==========
    y += 30;
    
    // Calculate improved, key wins, and focus metrics
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
        const target = getMetricTarget(key);
        const isReverse = isReverseMetric(key);
        
        // Check if improved from last week
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
        
        // Check for key wins (meeting target AND beating center)
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
        
        // Check if below center average
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
    
    // Key Wins (Meeting Target AND Beating Center)
    if (keyWins.length > 0) {
        ctx.fillStyle = '#e8f5e9';
        ctx.fillRect(40, y, 820, 40);
        ctx.fillStyle = '#1b5e20';
        ctx.font = 'bold 18px Arial';
        ctx.fillText('🏆 Key Wins (Meeting Target & Beating Center)', 50, y + 26);
        y += 50;
        
        keyWins.slice(0, 5).forEach((item, idx) => {
            ctx.fillStyle = '#333333';
            ctx.font = 'bold 14px Arial';
            ctx.fillText(`- ${item.label}:`, 60, y + 20);
            ctx.font = '14px Arial';
            ctx.fillText(`${item.curr} (Target: ${item.target}, Center: ${item.center})`, 220, y + 20);
            y += 35;
        });
    }
    
    // Highlights (Improved from Last Week)
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
            improvedMetrics.slice(0, 5).forEach((item, idx) => {
                ctx.fillStyle = '#333333';
                ctx.font = 'bold 14px Arial';
                ctx.fillText(`- ${item.label}:`, 60, y + 20);
                ctx.font = '14px Arial';
                ctx.fillText(`${item.curr} ${item.arrow} ${item.change} vs last ${periodTypeText}`, 220, y + 20);
                y += 35;
            });
        }
    }
    
    // Focus Areas (Below Center Average)
    if (focusMetrics.length > 0) {
        y += 10;
        ctx.fillStyle = '#fff3e0';
        ctx.fillRect(40, y, 820, 40);
        ctx.fillStyle = '#e65100';
        ctx.font = 'bold 18px Arial';
        ctx.fillText('⚠️ Focus Areas (Below Center Average)', 50, y + 26);
        y += 50;
        
        focusMetrics.slice(0, 5).forEach((item, idx) => {
            ctx.fillStyle = '#333333';
            ctx.font = 'bold 14px Arial';
            ctx.fillText(`- ${item.label}:`, 60, y + 20);
            ctx.font = '14px Arial';
            ctx.fillText(`${item.curr} (Center: ${item.center}, Target: ${item.target})`, 220, y + 20);
            y += 35;
        });
    }
    
    // ========== LEGEND SECTION ==========
    y += 30;
    ctx.fillStyle = '#f5f5f5';
    ctx.fillRect(40, y, 820, 180);
    
    ctx.fillStyle = '#003DA5';
    ctx.font = 'bold 18px Arial';
    ctx.fillText('📋 Legend', 50, y + 30);
    
    const legendItems = [
        { color: '#28a745', label: 'Meeting target' },
        { color: '#dc3545', label: 'Below target' },
        { color: '#6c757d', label: 'Better than center' },
        { color: '#ffc107', label: 'Behind center' },
        { color: '#28a745', symbol: '📈', label: `Improved from last ${periodTypeText}` },
        { color: '#dc3545', symbol: '📉', label: `Declined from last ${periodTypeText}` },
        { color: '#6c757d', symbol: '➡️', label: `No change from last ${periodTypeText}` }
    ];
    
    let legendY = y + 60;
    let legendX = 60;
    
    legendItems.forEach((item, idx) => {
        if (idx === 4) {
            legendX = 60;
            legendY += 35;
        }
        
        if (item.symbol) {
            ctx.font = '16px Arial';
            ctx.fillStyle = item.color;
            ctx.fillText(item.symbol, legendX, legendY);
            ctx.fillStyle = '#333333';
            ctx.font = '13px Arial';
            ctx.fillText(item.label, legendX + 25, legendY);
            legendX += 200;
        } else {
            ctx.fillStyle = item.color;
            ctx.fillRect(legendX, legendY - 12, 15, 15);
            ctx.fillStyle = '#333333';
            ctx.font = '13px Arial';
            ctx.fillText(item.label, legendX + 22, legendY);
            legendX += 200;
        }
    });
    
    y += 190;
    
    // Reliability Note (if employee has reliability hours)
    const reliabilityHours = parseFloat(metrics.reliability) || 0;
    if (reliabilityHours > 0) {
        y += 20;
        ctx.fillStyle = '#fff3cd';
        ctx.fillRect(40, y, 820, 120);
        ctx.strokeStyle = '#ff9800';
        ctx.lineWidth = 2;
        ctx.strokeRect(40, y, 820, 120);
        
        ctx.fillStyle = '#856404';
        ctx.font = 'bold 16px Arial';
        ctx.fillText('🎯 Reliability Note', 50, y + 25);
        
        ctx.fillStyle = '#333333';
        ctx.font = '13px Arial';
        const note1 = 'Reliability reflects unplanned absences not covered by PTO/ST or pre-scheduled in Verint. If you called in';
        const note2 = 'or were late without using protected time, those hours count against reliability. If you believe this is an';
        const note3 = 'error, check Verint for "Same Day" entries. If you have PTO/ST available and want to apply it, reply to let';
        const note4 = 'me know. Note: Once you reach 16 hours, APS attendance policy takes effect.';
        
        ctx.fillText(note1, 50, y + 50);
        ctx.fillText(note2, 50, y + 68);
        ctx.fillText(note3, 50, y + 86);
        ctx.fillText(note4, 50, y + 104);
        
        y += 130;
    }

    // Convert to image blob and handle output
    canvas.toBlob(pngBlob => {
        if (!pngBlob) {
            console.error('Failed to create blob from canvas');
            showToast('ℹ️ Error creating image', 5000);
            return;
        }

        // Convert blob to data URL for embedding in HTML
        const reader = new FileReader();
        reader.onload = function(e) {
            const dataUrl = e.target.result;
            
            // Create HTML with embedded image
            const htmlEmail = `<html><body><img src="${dataUrl}" style="max-width: 100%; height: auto;"></body></html>`;
            
            // Try to copy HTML to clipboard so image embeds in Outlook
            if (navigator.clipboard && navigator.clipboard.write) {
                const htmlBlob = new Blob([htmlEmail], { type: 'text/html' });
                const htmlClipboardItem = new ClipboardItem({ 'text/html': htmlBlob });
                navigator.clipboard.write([htmlClipboardItem]).then(() => {
                    console.log('HTML email with embedded image copied to clipboard');
                    showToast('✅ Email with image ready to paste!', 3000);
                    // Call callback to open Outlook AFTER clipboard is ready
                    if (onClipboardReady) onClipboardReady();
                }).catch(err => {
                    console.error('HTML clipboard error:', err);
                    // Fallback: try plain image copy using original PNG blob
                    navigator.clipboard.write([
                        new ClipboardItem({ 'image/png': pngBlob })
                    ]).then(() => {
                        console.log('Image copied to clipboard (HTML failed)');
                        showToast('✅ Image copied to clipboard!', 3000);
                        // Call callback to open Outlook AFTER clipboard is ready
                        if (onClipboardReady) onClipboardReady();
                    }).catch(err2 => {
                        console.error('Image clipboard error:', err2);
                        downloadImageFallback(pngBlob, empName, period);
                        // Still call callback even if clipboard failed
                        if (onClipboardReady) onClipboardReady();
                    });
                });
            } else {
                console.log('Clipboard API not available, downloading instead');
                downloadImageFallback(pngBlob, empName, period);
                // Still call callback even if clipboard not available
                if (onClipboardReady) onClipboardReady();
            }
        };
        reader.readAsDataURL(pngBlob);
    }, 'image/png');
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

function getMetricTarget(metric) {
    // PHASE 3 - Use METRICS_REGISTRY as single source of truth
    const metricDef = METRICS_REGISTRY[metric];
    if (metricDef && metricDef.target) {
        return metricDef.target.value;
    }
    
    return 90; // Safe fallback
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
    
    const employeeNames = week.employees.map(emp => emp.name).filter(Boolean);
    if (employeeNames.length === 0) {
        showToast('No employees found for this period', 5000);
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

function compareToCenter(employeeValue, centerValue, lowerIsBetter) {
    if (lowerIsBetter) {
        // For AHT, ACW: lower is better
        if (employeeValue <= centerValue) {
            return { status: 'meets', icon: '✅' };
        } else {
            return { status: 'below', icon: '📉' };
        }
    } else {
        // For all others: higher is better
        if (employeeValue >= centerValue) {
            return { status: 'meets', icon: '✅' };
        } else {
            return { status: 'below', icon: '📉' };
        }
    }
}

function getWeeklyStatisticsForEmployee(employeeName, metricKey, lowerIsBetter) {
    /**
     * Calculate how many weeks employee met target and beat center average
     * Returns: { meetingTarget: number, aboveAverage: number, totalWeeks: number }
     */
    const metricRegistry = METRICS_REGISTRY[metricKey];
    if (!metricRegistry) return { meetingTarget: 0, aboveAverage: 0, totalWeeks: 0 };
    
    const targetValue = metricRegistry.target.value;
    const targetType = metricRegistry.target.type; // 'min' or 'max'
    
    let meetingTarget = 0;
    let aboveAverage = 0;
    let totalWeeks = 0;
    
    // Only count weeks with periodType === 'week'
    Object.entries(weeklyData).forEach(([weekKey, weekData]) => {
        if (weekData.metadata?.periodType !== 'week') return;
        
        const employee = weekData.employees?.find(emp => emp.name === employeeName);
        if (!employee) return;
        
        const employeeValue = parseFloat(employee[metricKey]);
        if (isNaN(employeeValue)) return;
        
        totalWeeks++;
        
        // Check if meeting target
        if (targetType === 'min') {
            if (employeeValue >= targetValue) meetingTarget++;
        } else if (targetType === 'max') {
            if (employeeValue <= targetValue) meetingTarget++;
        }
        
        // Check if above center average
        const centerAvg = getCallCenterAverageForPeriod(weekKey);
        if (centerAvg) {
            // Convert metric key to center key
            const centerKeyMap = {
                'scheduleAdherence': 'adherence',
                'overallExperience': 'overallExperience',
                'cxRepOverall': 'repSatisfaction',
                'fcr': 'fcr',
                'transfers': 'transfers',
                'overallSentiment': 'sentiment',
                'positiveWord': 'positiveWord',
                'negativeWord': 'negativeWord',
                'managingEmotions': 'managingEmotions',
                'aht': 'aht',
                'acw': 'acw',
                'holdTime': 'holdTime',
                'reliability': 'reliability'
            };
            
            const centerKey = centerKeyMap[metricKey];
            const centerValue = centerAvg[centerKey];
            
            if (centerValue !== undefined && centerValue !== null) {
                if (lowerIsBetter) {
                    if (employeeValue <= centerValue) aboveAverage++;
                } else {
                    if (employeeValue >= centerValue) aboveAverage++;
                }
            }
        }
    });
    
    return { meetingTarget, aboveAverage, totalWeeks };
}

function getTargetHitRate(employeeName, metricKey, periodType = 'week') {
    /**
     * Calculate how many times employee met the target goal
     * Filtered by the specified period type (week, month, quarter, ytd)
     * Returns: { hits: number, total: number }
     */
    const metricRegistry = METRICS_REGISTRY[metricKey];
    if (!metricRegistry) return { hits: 0, total: 0 };
    
    const targetValue = metricRegistry.target.value;
    const targetType = metricRegistry.target.type; // 'min' or 'max'
    
    let hits = 0;
    let total = 0;
    
    // Count across periods matching the specified period type
    Object.entries(weeklyData).forEach(([weekKey, weekData]) => {
        // Filter by period type
        if ((weekData.metadata?.periodType || 'week') !== periodType) return;
        
        const employee = weekData.employees?.find(emp => emp.name === employeeName);
        if (!employee) return;
        
        const employeeValue = parseFloat(employee[metricKey]);
        if (isNaN(employeeValue)) return;
        
        total++;
        
        // Check if meeting target
        if (targetType === 'min') {
            if (employeeValue >= targetValue) hits++;
        } else if (targetType === 'max') {
            if (employeeValue <= targetValue) hits++;
        }
    });
    
    return { hits, total };
}

function getPeriodUnit(periodType, count) {
    /**
     * Returns the correct period unit label (singular/plural)
     */
    if (periodType === 'week') return count === 1 ? 'week' : 'weeks';
    if (periodType === 'month') return count === 1 ? 'month' : 'months';
    if (periodType === 'quarter') return count === 1 ? 'quarter' : 'quarters';
    return 'times'; // for ytd or unknown
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

function compareToYearlyAverage(employeeName, metricKey, currentValue, lowerIsBetter) {
    /**
     * Compare employee's current value to their yearly average
     * Returns: { status: 'meets'|'below'|'first', icon: '✅'|'📉'|'📈', yearlyAvg: number }
     */
    const yearlyAvg = getYearlyAverageForEmployee(employeeName, metricKey);
    
    if (!yearlyAvg) {
        return { status: 'first', icon: '📈', yearlyAvg: null };
    }
    
    const isMeeting = lowerIsBetter ? currentValue <= yearlyAvg.value : currentValue >= yearlyAvg.value;
    
    if (isMeeting) {
        return { status: 'meets', icon: '✅', yearlyAvg: yearlyAvg.value };
    } else {
        return { status: 'below', icon: '📉', yearlyAvg: yearlyAvg.value };
    }
}

function compareWeekOverWeek(currentValue, previousValue, lowerIsBetter) {
    const delta = currentValue - previousValue;
    
    if (delta === 0) {
        return { status: 'nochange', icon: '➡️', delta: 0 };
    }
    
    if (lowerIsBetter) {
        // For AHT, ACW: decrease is improvement
        if (delta < 0) {
            return { status: 'improved', icon: '📈', delta: Math.round(delta * 100) / 100 };
        } else {
            return { status: 'declined', icon: '📉', delta: Math.round(delta * 100) / 100 };
        }
    } else {
        // For others: increase is improvement
        if (delta > 0) {
            return { status: 'improved', icon: '📈', delta: Math.round(delta * 100) / 100 };
        } else {
            return { status: 'declined', icon: '📉', delta: Math.round(delta * 100) / 100 };
        }
    }
}


// ============================================
// EXECUTIVE SUMMARY
// ============================================

function renderExecutiveSummary() {
    const container = document.getElementById('executiveSummaryContainer');
    if (!container) return;
    
    const allWeeks = Object.keys(weeklyData);
    
    if (allWeeks.length === 0) {
        container.innerHTML = '<p style="color: #666; font-style: italic;">No data uploaded yet. Upload some weekly data to see the executive summary!</p>';
        return;
    }
    
    // Calculate aggregate metrics
    const metrics = {
        totalWeeks: allWeeks.length,
        totalEmployees: new Set(),
        avgScheduleAdherence: [],
        avgTransfers: [],
        avgAHT: []
    };
    
    allWeeks.forEach(weekKey => {
        const week = weeklyData[weekKey];
        if (week && week.employees) {
            week.employees.forEach(emp => {
                metrics.totalEmployees.add(emp.name);
                if (emp.scheduleAdherence) metrics.avgScheduleAdherence.push(emp.scheduleAdherence);
                if (emp.transfers) metrics.avgTransfers.push(emp.transfers);
                if (emp.aht) metrics.avgAHT.push(emp.aht);
            });
        }
    });
    
    const avgAdherence = metrics.avgScheduleAdherence.length > 0 
        ? (metrics.avgScheduleAdherence.reduce((a, b) => a + b, 0) / metrics.avgScheduleAdherence.length).toFixed(2)
        : 0;
    
    const avgTransfers = metrics.avgTransfers.length > 0
        ? (metrics.avgTransfers.reduce((a, b) => a + b, 0) / metrics.avgTransfers.length).toFixed(2)
        : 0;
    
    const avgAHT = metrics.avgAHT.length > 0
        ? Math.round(metrics.avgAHT.reduce((a, b) => a + b, 0) / metrics.avgAHT.length)
        : 0;
    
    let html = '<div style="margin-bottom: 30px;">';
    html += '<h3>Performance Overview</h3>';
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-top: 20px;">';
    
    const cards = [
        { label: 'Total Data Periods', value: metrics.totalWeeks, icon: '📊' },
        { label: 'Total Employees', value: metrics.totalEmployees.size, icon: '👥' },
        { label: 'Avg Schedule Adherence', value: avgAdherence + '%', icon: '✅' },
        { label: 'Avg Transfers', value: avgTransfers + '%', icon: '📉' },
        { label: 'Avg Handle Time', value: avgAHT + 's', icon: '⏱️' }
    ];
    
    cards.forEach(card => {
        html += `
            <div style="padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px; text-align: center;">
                <div style="font-size: 2em; margin-bottom: 8px;">${card.icon}</div>
                <div style="font-size: 1.8em; font-weight: bold; margin-bottom: 4px;">${card.value}</div>
                <div style="font-size: 0.9em; opacity: 0.9;">${card.label}</div>
            </div>
        `;
    });
    
    html += '</div></div>';
    
    container.innerHTML = html;
    renderSupervisorIntelligence();
    
    // Initialize the new yearly individual summary section
    initializeYearlyIndividualSummary();
}

function initializeYearlyIndividualSummary() {
    
    populateExecutiveSummaryAssociate();
    populateOneOnOneAssociateSelect();
    
    // Period type is always YTD for executive summary
    
    // Add event listener for associate dropdown
    document.getElementById('summaryAssociateSelect')?.addEventListener('change', () => {
        loadExecutiveSummaryData();
        renderYearlySummaryTrendCharts();
        showEmailSection();
        syncOneOnOneAssociateSelect();
    });
    
    // Generate CoPilot prompt for Executive Summary email
    document.getElementById('generateExecutiveSummaryCopilotBtn')?.addEventListener('click', generateExecutiveSummaryCopilotEmail);
    
    
}

function generateExecutiveSummaryEmail() {
    const associate = document.getElementById('summaryAssociateSelect')?.value;
    if (!associate) {
        showToast('Select an associate first', 3000);
        return;
    }

    const latestKey = getLatestWeeklyKey();
    const latestWeek = latestKey ? weeklyData[latestKey] : null;
    const endDate = latestWeek?.metadata?.endDate
        ? formatDateMMDDYYYY(latestWeek.metadata.endDate)
        : (latestKey?.split('|')[1] ? formatDateMMDDYYYY(latestKey.split('|')[1]) : 'this period');

    const callouts = buildExecutiveSummaryCallouts(latestKey, latestWeek);
    const calloutHtml = callouts.length
        ? callouts.map(item => `
            <li><strong>${item.name}</strong> — ${item.metric}: ${item.value} vs center ${item.center} (${item.diff})</li>
        `).join('')
        : '<li>No callouts available. Add call center averages to enable this section.</li>';

    const subject = `Wins Spotlight - Week of ${endDate}`;

    const htmlEmail = `
        <div style="font-family: Arial, sans-serif; font-size: 11pt; color: #111;">
            <p><strong>Subject:</strong> ${subject}</p>
            <p>Team,</p>
            <p>Here are this week’s wins vs the call center average. Huge shout-out to the teammates below who are absolutely crushing these metrics.</p>
            <h3 style="margin: 16px 0 8px; color: #1b5e20;">🏆 Wins vs Call Center Average</h3>
            <ul style="margin-top: 0;">
                ${calloutHtml}
            </ul>
            <p>Thank you for the strong performance and the impact you’re making every day. Let’s keep this momentum going!</p>
        </div>
    `;

    window.latestExecutiveSummaryHtml = htmlEmail;

    const preview = document.getElementById('executiveSummaryEmailPreview');
    const copyBtn = document.getElementById('copyExecutiveSummaryEmailBtn');
    if (copyBtn) copyBtn.style.display = 'inline-block';

    if (preview) {
        preview.style.display = 'block';
        const doc = preview.contentDocument || preview.contentWindow?.document;
        if (doc) {
            doc.open();
            doc.write(htmlEmail);
            doc.close();
        }
    }
}

function buildExecutiveSummaryCallouts(latestKey, latestWeek) {
    if (!latestKey || !latestWeek?.employees?.length) return [];
    const centerAvg = getCenterAverageForWeek(latestKey);
    if (!centerAvg) return [];

    const callouts = [];
    Object.keys(METRICS_REGISTRY).forEach(metricKey => {
        const metric = METRICS_REGISTRY[metricKey];
        const centerValue = centerAvg[metricKey];
        if (centerValue === undefined || centerValue === null || centerValue === '') return;

        let best = null;
        latestWeek.employees.forEach(emp => {
            const value = emp[metricKey];
            if (value === undefined || value === null || value === '') return;
            const numericValue = parseFloat(value);
            const numericCenter = parseFloat(centerValue);
            if (Number.isNaN(numericValue) || Number.isNaN(numericCenter)) return;

            const isReverse = isReverseMetric(metricKey);
            const diff = isReverse ? numericCenter - numericValue : numericValue - numericCenter;
            if (diff <= 0) return;

            if (!best || diff > best.diff) {
                best = {
                    name: emp.name,
                    metric: metric.label || metricKey,
                    value: formatMetricValue(metricKey, numericValue),
                    center: formatMetricValue(metricKey, numericCenter),
                    diff: `+${formatMetricValue(metricKey, diff)}`,
                    rawDiff: diff,
                    metricKey: metricKey
                };
            }
        });

        if (best) callouts.push(best);
    });

    return callouts
        .sort((a, b) => b.rawDiff - a.rawDiff)
        .slice(0, 5);
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

    const copilotPrompt = `Write a professional team email recognizing wins and providing guidance for the week ending ${endDate}.

${individualWinsText}
${teamPerformanceText}
${focusAreaText}
TONE & STYLE:
- Professional and motivating
- Celebrate specific wins with names
- Frame opportunities positively
- Keep it concise (under 200 words)
- Use bullet points for wins
- Do NOT use em dashes (—) anywhere in the email
- Use proper bullet points (•) not hyphens

SUBJECT LINE:
Team Update - Week of ${endDate}

Please generate the email now.`;

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
    if (!latestKey || !latestWeek?.employees?.length) return [];
    const centerAvg = getCenterAverageForWeek(latestKey);
    if (!centerAvg) return [];

    const analysis = [];
    Object.keys(METRICS_REGISTRY).forEach(metricKey => {
        const metric = METRICS_REGISTRY[metricKey];
        const centerValue = centerAvg[metricKey];
        if (centerValue === undefined || centerValue === null || centerValue === '') return;

        // Calculate team average for this metric
        const values = latestWeek.employees
            .map(emp => parseFloat(emp[metricKey]))
            .filter(v => !Number.isNaN(v) && v !== null && v !== undefined);
        
        if (values.length === 0) return;
        
        const teamAvg = values.reduce((sum, v) => sum + v, 0) / values.length;
        const numericCenter = parseFloat(centerValue);
        
        if (Number.isNaN(teamAvg) || Number.isNaN(numericCenter)) return;

        const isReverse = isReverseMetric(metricKey);
        const diff = isReverse ? numericCenter - teamAvg : teamAvg - numericCenter;
        
        const diffFormatted = diff > 0 
            ? `+${formatMetricValue(metricKey, Math.abs(diff))} better`
            : diff < 0
            ? `-${formatMetricValue(metricKey, Math.abs(diff))} below`
            : 'at center';

        analysis.push({
            metricKey: metricKey,
            metric: metric.label || metricKey,
            teamValue: formatMetricValue(metricKey, teamAvg),
            centerValue: formatMetricValue(metricKey, numericCenter),
            diff: diff,
            diffFormatted: diffFormatted,
            rawDiff: Math.abs(diff)
        });
    });

    return analysis.sort((a, b) => b.rawDiff - a.rawDiff);
}

function populateOneOnOneAssociateSelect() {
    const select = document.getElementById('oneOnOneAssociateSelect');
    if (!select) return;

    const allEmployees = new Set();
    for (const weekKey in weeklyData) {
        const week = weeklyData[weekKey];
        if (week.employees && Array.isArray(week.employees)) {
            week.employees.forEach(emp => {
                if (emp.name && isTeamMember(weekKey, emp.name)) {
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

function showEmailSection() {
    const associate = document.getElementById('summaryAssociateSelect').value;
    const section = document.getElementById('summaryEmailSection');
    if (associate && section) {
        section.style.display = 'block';
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
    let periodsIncluded = 0;

    periodKeys.forEach(weekKey => {
        const week = weeklyData[weekKey];
        const employee = week?.employees?.find(emp => emp.name === employeeName);
        if (!employee) return;

        periodsIncluded += 1;
        Object.keys(METRICS_REGISTRY).forEach(metricKey => {
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

    periodKeys.forEach(weekKey => {
        const employees = weeklyData[weekKey]?.employees || [];
        employees.forEach(emp => {
            if (emp?.name) names.add(emp.name);
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

function calculateCoachingImpact(employeeName, currentSnapshot) {
    if (!employeeName || !currentSnapshot) return null;

    const history = getCoachingHistoryForEmployee(employeeName);
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
        const currentEmp = buildEmployeeAggregateForPeriod(employeeName, buckets.currentKeys);
        const prevEmp = buildEmployeeAggregateForPeriod(employeeName, buckets.previousKeys);
        if (!currentEmp || !prevEmp) return;

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

                if (coachReasons.length < 2) {
                    coachReasons.push(`${METRICS_REGISTRY[metricKey]?.label || metricKey} below target`);
                }
            } else {
                recognizeScore += 9;
            }

            if (delta > 5) {
                recognizeScore += 8;
                if (recognizeReasons.length < 2) {
                    recognizeReasons.push(`${METRICS_REGISTRY[metricKey]?.label || metricKey} improving (+${delta.toFixed(1)})`);
                }
            }

            if (delta < -thresholdData.value) {
                coachScore += 12;
                if (coachReasons.length < 2) {
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
            if (recognizeReasons.length < 2) recognizeReasons.push('All core metrics at/above target');
        }

        const impact = calculateCoachingImpact(employeeName, currentEmp);
        if (impact?.status === 'positive') {
            recognizeScore += 10;
            if (recognizeReasons.length < 2) recognizeReasons.push(`Coaching impact ${impact.score}/100`);
        } else if (impact?.status === 'negative') {
            coachScore += 12;
            if (coachReasons.length < 2) coachReasons.push(`Coaching impact ${impact.score}/100 (needs reset)`);
        } else if (impact?.status === 'mixed') {
            watchScore += 6;
        }

        const history = getCoachingHistoryForEmployee(employeeName);
        const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
        const hasRecentCoaching = history.some(h => new Date(h.generatedAt).getTime() >= thirtyDaysAgo);
        if (!hasRecentCoaching) {
            watchScore += 8;
            if (watchReasons.length < 2) watchReasons.push('No coaching touch in 30+ days');
        }

        if (coachScore < 35 && recognizeScore < 35) {
            watchScore += 8;
            if (watchReasons.length < 2) watchReasons.push('Mixed/flat trend signals');
        }

        const topCategory = [
            { key: 'coachNow', score: coachScore },
            { key: 'recognizeNow', score: recognizeScore },
            { key: 'watchlist', score: watchScore }
        ].sort((a, b) => b.score - a.score)[0];

        if (topCategory.score <= 0) return;

        const reason = topCategory.key === 'coachNow'
            ? (coachReasons[0] || 'Performance signals need intervention')
            : topCategory.key === 'recognizeNow'
            ? (recognizeReasons[0] || 'Strong and improving performance')
            : (watchReasons[0] || 'Monitor for next period shifts');

        queue[topCategory.key].push({
            name: employeeName,
            score: topCategory.score,
            reason
        });
    });

    queue.coachNow.sort((a, b) => b.score - a.score);
    queue.recognizeNow.sort((a, b) => b.score - a.score);
    queue.watchlist.sort((a, b) => b.score - a.score);

    const renderBucket = (title, entries, bg, border, emptyText) => {
        let html = `<div style="padding: 10px; border: 1px solid ${border}; border-radius: 6px; background: ${bg};">`;
        html += `<strong>${title}</strong>`;
        if (!entries.length) {
            html += `<div style="margin-top: 6px; color: #666; font-size: 0.9em;">${emptyText}</div>`;
        } else {
            html += '<div style="margin-top: 6px; display: grid; gap: 6px;">';
            entries.slice(0, 5).forEach(entry => {
                html += `<div><strong>${entry.name}</strong> • Score ${entry.score} • ${entry.reason}</div>`;
            });
            html += '</div>';
        }
        html += '</div>';
        return html;
    };

    let html = `<div style="padding: 10px; border: 1px solid #e6eefc; border-radius: 6px; background: #f8fbff;">`;
    html += `<strong>Mode:</strong> ${buckets.descriptor.label} • <strong>Team Members Scored:</strong> ${employeeNames.length}`;
    html += `</div>`;

    html += renderBucket(
        '🎯 Coach Now',
        queue.coachNow,
        '#ffebee',
        '#f5c6cb',
        'No urgent coaching interventions this cycle.'
    );
    html += renderBucket(
        '🏆 Recognize Now',
        queue.recognizeNow,
        '#e8f5e9',
        '#c8e6c9',
        'No standout recognition callouts this cycle.'
    );
    html += renderBucket(
        '👀 Watchlist',
        queue.watchlist,
        '#fff8e1',
        '#ffe0b2',
        'No watchlist candidates right now.'
    );

    container.innerHTML = html;
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
    const history = getCoachingHistoryForEmployee(employeeId);
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
    renderCoachingLoadAwareness();
    renderCoachingPriorityQueue();
    renderComplianceAlerts();
}

let trendIntelligenceListenersAttached = false;

function initializeTrendIntelligence() {
    // Populate employee selector
    const employeeSelect = document.getElementById('trendEmployeeSelector');
    if (employeeSelect) {
        const allEmployees = new Set();
        for (const weekKey in weeklyData) {
            const week = weeklyData[weekKey];
            if (week.employees && Array.isArray(week.employees)) {
                week.employees.forEach(emp => {
                    if (emp.name && isTeamMember(weekKey, emp.name)) {
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
        });

        document.getElementById('generateTrendCoachingBtn')?.addEventListener('click', generateTrendCoachingEmail);
        trendIntelligenceListenersAttached = true;
    }

    // Initial render of visualizations
    renderTrendVisualizations();
}

function renderComplianceAlerts() {
    const container = document.getElementById('complianceAlertsOutput');
    if (!container) return;
    const log = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'complianceLog') || '[]');
    if (!log.length) {
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">No compliance flags logged.</div>';
        return;
    }
    const items = log.slice(-5).reverse().map(entry => {
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

    // Get all unique employees from weekly data
    const allEmployees = new Set();
    Object.values(weeklyData).forEach(week => {
        if (week && week.employees) {
            week.employees.forEach(emp => {
                if (emp.name) allEmployees.add(emp.name);
            });
        }
    });

    // Check each employee's coaching history
    allEmployees.forEach(employeeId => {
        const history = getCoachingHistoryForEmployee(employeeId);
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

    const history = getCoachingHistoryForEmployee(associate).slice(0, 3);
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

    latestWeek.employees.forEach(emp => {
        const prevEmp = prevWeek.employees.find(e => e.name === emp.name);
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
        const recentCoaching = getCoachingHistoryForEmployee(emp.name).find(h =>
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
    const employeeName = document.getElementById('trendEmployeeSelector')?.value;
    
    if (employeeName) {
        await generateIndividualCoachingEmail(employeeName);
    } else {
        await generateGroupCoachingEmail();
    }
}

async function generateIndividualCoachingEmail(employeeName) {
    const keys = getWeeklyKeysSorted();
    if (keys.length < 2) {
        showToast('Not enough data to generate coaching email', 3000);
        return;
    }

    const latestKey = keys[keys.length - 1];
    const previousKey = keys[keys.length - 2];
    const latestWeek = weeklyData[latestKey];
    const previousWeek = weeklyData[previousKey];

    const currentEmp = latestWeek?.employees?.find(e => e.name === employeeName);
    const previousEmp = previousWeek?.employees?.find(e => e.name === employeeName);

    if (!currentEmp) {
        showToast('No data found for this employee', 3000);
        return;
    }

    const endDate = latestWeek?.metadata?.endDate
        ? formatDateMMDDYYYY(latestWeek.metadata.endDate)
        : (latestKey?.split('|')[1] ? formatDateMMDDYYYY(latestKey.split('|')[1]) : 'this period');

    // Load tips
    const allTips = await loadServerTips();

    // Analyze metrics
    const metricsToAnalyze = ['scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht', 'overallSentiment'];
    const wins = [];
    const opportunities = [];

    metricsToAnalyze.forEach(metricKey => {
        const current = currentEmp[metricKey];
        if (current === undefined || current === null || current === '') return;

        const metric = METRICS_REGISTRY[metricKey];
        const meetsTarget = metricMeetsTarget(metricKey, current);
        
        if (meetsTarget) {
            wins.push({
                metricKey: metricKey,
                metric: metric.label || metricKey,
                value: formatMetricValue(metricKey, parseFloat(current))
            });
        } else {
            const previous = previousEmp?.[metricKey];
            const trend = previous !== undefined ? metricDelta(metricKey, parseFloat(current), parseFloat(previous)) : 0;
            const tips = allTips[metricKey] || [];
            const randomTip = tips.length ? tips[Math.floor(Math.random() * tips.length)] : null;
            
            opportunities.push({
                metricKey: metricKey,
                metric: metric.label || metricKey,
                value: formatMetricValue(metricKey, parseFloat(current)),
                target: formatMetricValue(metricKey, metric.target.value),
                trend: trend,
                tip: randomTip
            });
        }
    });

    // Build prompt
    let winsText = '';
    if (wins.length > 0) {
        winsText = 'WINS:\n';
        wins.forEach(w => {
            winsText += `- ${w.metric}: ${w.value}\n`;
        });
        winsText += '\n';
    }

    let opportunitiesText = '';
    let improvementTipsText = '';
    if (opportunities.length > 0) {
        opportunitiesText = 'OPPORTUNITIES:\n';
        opportunitiesText += opportunities.map(opp => {
            let text = `- ${opp.metric}: Currently ${opp.value}, Target ${opp.target}`;
            if (opp.trend !== 0) {
                text += ` (${opp.trend > 0 ? 'improving' : 'declining'})`;
            }
            return text;
        }).join('\n');
        opportunitiesText += '\n\n';
        
        improvementTipsText = 'HOW TO IMPROVE:\n';
        opportunities.forEach(opp => {
            if (opp.tip) {
                improvementTipsText += `- ${opp.metric}: ${opp.tip}\n`;
            }
        });
        improvementTipsText += '\n';
    }

    const preferredName = getEmployeeNickname(employeeName) || currentEmp.firstName || employeeName.split(' ')[0];

    const copilotPrompt = `Draft a brief, factual coaching email for ${preferredName} (week ending ${endDate}).

${winsText}
${opportunitiesText}
${improvementTipsText}
Keep it to 2-3 sentences + three bullet-point lists. Be direct and encouraging.`;

    openCopilotWithPrompt(copilotPrompt, 'Individual Coaching Email');
}

async function generateGroupCoachingEmail() {
    const keys = getWeeklyKeysSorted();
    if (keys.length < 2) {
        showToast('Not enough data to generate group email', 3000);
        return;
    }

    const latestKey = keys[keys.length - 1];
    const previousKey = keys[keys.length - 2];
    const latestWeek = weeklyData[latestKey];
    const previousWeek = weeklyData[previousKey];

    if (!latestWeek?.employees || !previousWeek?.employees) {
        showToast('Not enough employee data', 3000);
        return;
    }

    const endDate = latestWeek?.metadata?.endDate
        ? formatDateMMDDYYYY(latestWeek.metadata.endDate)
        : (latestKey?.split('|')[1] ? formatDateMMDDYYYY(latestKey.split('|')[1]) : 'this period');

    const centerAvg = getCenterAverageForWeek(latestKey);

    // Load tips
    const allTips = await loadServerTips();

    // Analyze team-wide patterns with detailed metrics
    const teamAnalysis = {
        rockstars: [], // Crushing it across the board + beating center average
        topPerformers: [], // Meeting all targets
        improving: [],
        needsSupport: [],
        commonOpportunities: {},
        teamWins: [],
        metricChampions: {} // Track who's destroying specific metrics
    };

    // Analyze each employee
    latestWeek.employees.forEach(emp => {
        const prevEmp = previousWeek.employees.find(e => e.name === emp.name);
        if (!prevEmp) return;

        let meetsAllTargets = true;
        let beatsAllCenterAvg = true;
        let hasImprovement = false;
        let needsHelp = false;
        let metricsAboveCenter = [];

        ['scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht', 'overallSentiment'].forEach(metricKey => {
            const current = emp[metricKey];
            const prev = prevEmp[metricKey];
            const metric = METRICS_REGISTRY[metricKey];
            
            if (current !== undefined && current !== null && current !== '') {
                const meetsTarget = metricMeetsTarget(metricKey, current);
                if (!meetsTarget) {
                    meetsAllTargets = false;
                    teamAnalysis.commonOpportunities[metricKey] = (teamAnalysis.commonOpportunities[metricKey] || 0) + 1;
                }

                // Check if beating center average
                const centerValue = centerAvg?.[metricKey];
                if (centerValue !== undefined && centerValue !== null) {
                    const currentFloat = parseFloat(current);
                    const centerFloat = parseFloat(centerValue);
                    const beatsCenterAvg = metric.higherIsBetter 
                        ? currentFloat > centerFloat 
                        : currentFloat < centerFloat;
                    
                    if (!beatsCenterAvg) {
                        beatsAllCenterAvg = false;
                    } else {
                        // Track metrics where they're crushing it
                        const delta = metric.higherIsBetter 
                            ? currentFloat - centerFloat 
                            : centerFloat - currentFloat;
                        
                        if (delta > 0) {
                            metricsAboveCenter.push({
                                metric: metric.label,
                                empValue: current,
                                centerValue: centerValue,
                                delta: delta
                            });
                            
                            // Track champions for this metric
                            if (!teamAnalysis.metricChampions[metricKey]) {
                                teamAnalysis.metricChampions[metricKey] = [];
                            }
                            teamAnalysis.metricChampions[metricKey].push({
                                name: emp.name,
                                value: current,
                                delta: delta
                            });
                        }
                    }
                }

                if (prev !== undefined) {
                    const delta = metricDelta(metricKey, parseFloat(current), parseFloat(prev));
                    if (delta > 5) hasImprovement = true;
                    if (delta < -5) needsHelp = true;
                }
            }
        });

        // Categorize employees
        if (hasImprovement) {
            // Track improving employees with their metrics for rockstar callouts
            const improvingMetrics = [];
            ['scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht', 'overallSentiment'].forEach(metricKey => {
                const current = emp[metricKey];
                const prev = prevEmp?.[metricKey];
                if (current !== undefined && prev !== undefined && current !== null && prev !== null && current !== '' && prev !== '') {
                    const delta = metricDelta(metricKey, parseFloat(current), parseFloat(prev));
                    if (delta > 5) {
                        const metric = METRICS_REGISTRY[metricKey];
                        improvingMetrics.push({
                            metric: metric.label,
                            empValue: formatMetricValue(metricKey, parseFloat(current)),
                            trend: `+${delta.toFixed(1)}%`
                        });
                    }
                }
            });
            teamAnalysis.improving.push({ name: emp.name, metrics: improvingMetrics });
        } else if (meetsAllTargets) {
            teamAnalysis.topPerformers.push(emp.name);
        } else if (needsHelp) {
            teamAnalysis.needsSupport.push(emp.name);
        }
    });

    // Find metric champions (top 3 per metric)
    Object.keys(teamAnalysis.metricChampions).forEach(metricKey => {
        teamAnalysis.metricChampions[metricKey].sort((a, b) => b.delta - a.delta);
        teamAnalysis.metricChampions[metricKey] = teamAnalysis.metricChampions[metricKey].slice(0, 3);
    });

    // Find top 3 common opportunities
    const topOpportunities = Object.entries(teamAnalysis.commonOpportunities)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([metricKey, count]) => {
            const metric = METRICS_REGISTRY[metricKey];
            const tips = allTips[metricKey] || [];
            const randomTip = tips.length ? tips[Math.floor(Math.random() * tips.length)] : null;
            return {
                metric: metric?.label || metricKey,
                count: count,
                tip: randomTip
            };
        });

    // Build team wins
    if (teamAnalysis.improving.length > 0) {
        teamAnalysis.teamWins.push(`🔥 ${teamAnalysis.improving.length} ROCKSTARS showing strong improvement and momentum`);
    }
    if (teamAnalysis.topPerformers.length > 0) {
        teamAnalysis.teamWins.push(`⭐ ${teamAnalysis.topPerformers.length} team members meeting all targets`);
    }

    // Build prompt
    let winsText = 'TEAM WINS & CELEBRATIONS:\n';
    if (teamAnalysis.teamWins.length > 0) {
        teamAnalysis.teamWins.forEach(win => {
            winsText += `${win}\n`;
        });
    } else {
        winsText += '- Team is working hard and showing effort\n';
    }

    let rockstarsText = '';
    if (teamAnalysis.improving.length > 0) {
        rockstarsText = '\n🏆 ROCKSTARS - SHOWING INCREDIBLE IMPROVEMENT:\n';
        rockstarsText += 'These team members are CRUSHING IT with strong week-over-week gains:\n';
        teamAnalysis.improving.slice(0, 5).forEach(rockstar => {
            rockstarsText += `\n${rockstar.name} - IMPROVING BIG TIME:\n`;
            if (rockstar.metrics && rockstar.metrics.length > 0) {
                rockstar.metrics.forEach(m => {
                    rockstarsText += `  • ${m.metric}: ${m.empValue} (${m.trend} improvement!)\n`;
                });
            }
        });
    }

    let championText = '';
    const topMetricsToHighlight = Object.entries(teamAnalysis.metricChampions)
        .filter(([_, champs]) => champs.length > 0)
        .slice(0, 3);
    
    if (topMetricsToHighlight.length > 0) {
        championText = '\n🎯 METRIC CHAMPIONS:\n';
        topMetricsToHighlight.forEach(([metricKey, champions]) => {
            const metric = METRICS_REGISTRY[metricKey];
            championText += `\n${metric.label} Leaders:\n`;
            champions.forEach((champ, idx) => {
                championText += `  ${idx + 1}. ${champ.name} - ${champ.value} (${champ.delta.toFixed(1)} above center avg!)\n`;
            });
        });
    }

    let recognitionText = '';
    if (teamAnalysis.topPerformers.length > 0) {
        recognitionText = '\n✅ CONSISTENT PERFORMERS (Meeting All Targets):\n';
        teamAnalysis.topPerformers.slice(0, 8).forEach(name => {
            recognitionText += `- ${name}\n`;
        });
    }

    let opportunitiesText = '\nTEAM DEVELOPMENT OPPORTUNITIES:\n';
    if (topOpportunities.length > 0) {
        topOpportunities.forEach(opp => {
            opportunitiesText += `- ${opp.metric} (${opp.count} team members need support)\n`;
            if (opp.tip) {
                opportunitiesText += `  💡 TIP: ${opp.tip}\n`;
            }
        });
    } else {
        opportunitiesText += '- Continue current momentum and consistency\n';
    }

    const copilotPrompt = `Write a HIGH-ENERGY, MOTIVATIONAL team-wide email for the week ending ${endDate}.

${winsText}
${rockstarsText}
${championText}
${recognitionText}
${opportunitiesText}

CRITICAL REQUIREMENTS:
- This is a GROUP email going to the entire call center team
- CALL OUT the rockstars who are KILLING IT and beating the call center average by name
- Make it EXCITING and CELEBRATORY for top performers
- Use phrases like "crushing it", "blowing the average out of the water", "absolutely dominating"
- Create FOMO for those not on the list - make them want to be recognized next week
- Be specific with numbers and metrics where people are excelling
- Frame development opportunities positively as "join the winners circle"

TONE & STYLE:
- HIGH ENERGY, MOTIVATIONAL, and CELEBRATORY
- Call out winners by name with specific achievements
- Make top performers feel like ROCKSTARS
- Professional but exciting and engaging
- Use bullet points and emojis (🔥⭐🏆💪🎯) for impact
- Do NOT use em dashes (—) anywhere in the email
- Keep it concise but impactful (under 350 words)

SUBJECT LINE:
🔥 This Week's ROCKSTARS - Week of ${endDate}

Please generate the coaching email now with HIGH ENERGY celebrating our top performers!`;

    // Copy to clipboard and open Copilot
    navigator.clipboard.writeText(copilotPrompt).then(() => {
        // Show instruction popup
        alert('✅ Group email prompt copied!\n\nCtrl+V and Enter to paste into Copilot.');
        
        // Open Copilot
        window.open('https://copilot.microsoft.com', '_blank');
        
        showToast('Prompt copied! Paste into CoPilot to generate the email.', 3000);
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('⚠️ Failed to copy prompt to clipboard. Please try again.');
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

    const metricsToUse = ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht'];
    const averages = {};
    metricsToUse.forEach(key => {
        const vals = latestWeek.employees.map(emp => emp[key]).filter(v => v !== '' && v !== undefined && v !== null);
        averages[key] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });

    const prevAverages = {};
    if (prevWeek?.employees) {
        metricsToUse.forEach(key => {
            const vals = prevWeek.employees.map(emp => emp[key]).filter(v => v !== '' && v !== undefined && v !== null);
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

    latestWeek.employees.forEach(emp => {
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

    const callouts = buildTodaysFocusCallouts(latestWeek, metricsToUse, averages);

    return {
        latestKey,
        latestWeek,
        averages,
        teamWin,
        focusArea,
        callouts
    };
}

function buildTodaysFocusCallouts(latestWeek, metricsToUse, averages) {
    const scores = latestWeek.employees.map(emp => {
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

    const prompt = `You are a contact center supervisor drafting a short team email for the week ending ${endDate}.

Include:
1) Wins: highlight the strongest team win (${winLabel}) and why it matters.
2) Focus Areas: call out the main focus area (${focusLabel}) with a supportive coaching tone.
3) Callouts: recognize these teammates by name: ${calloutText}.
4) A clear next-step ask for the team.

Requirements:
- Keep it concise and Teams/Outlook-ready
- Use friendly, motivating language
- Include a subject line
- Do NOT use em dashes (—)
- Add a few emojis for warmth (not excessive)

Write the complete email.`;

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
    const employeeName = document.getElementById('employeeName').value;
    const employeeSelect = document.getElementById('employeeSelect');
    const selectedEmployeeId = employeeSelect?.value;
    const firstName = (employeeName || '').split(' ')[0] || employeeName || (selectedEmployeeId ? selectedEmployeeId.split(' ')[0] : '');
    
    if (!firstName) {
        alert('⚠️ Please select an employee first');
        return;
    }

    if (!selectedEmployeeId) {
        alert('⚠️ Please select an employee first');
        return;
    }

    if (selectedEmployeeId && employeeName) {
        saveNickname(selectedEmployeeId, employeeName.trim());
    }
    const employeeData = getEmployeeDataForPeriod(selectedEmployeeId);
    if (!employeeData) {
        alert('⚠️ Unable to load metrics for this employee. Please reload data.');
        return;
    }
    const { periodLabel, timeReference } = getActivePeriodContext();
    const { celebrate, needsCoaching, coachedMetricKeys } = evaluateMetricsForCoaching(employeeData);
    
    // Get metadata for sentiment phrase lookup
    const metadataSource = currentPeriodType === 'ytd' ? ytdData : weeklyData;
    const metadata = currentPeriod && metadataSource[currentPeriod]?.metadata ? metadataSource[currentPeriod].metadata : null;
    const timeframeKey = metadata ? `${metadata.startDate}_${metadata.endDate}` : null;
    
    // Load tips from CSV
    const allTips = await loadServerTips();
    
    // Metric key mapping to match tips.csv keys
    const metricKeyMap = {
        'Schedule Adherence': 'scheduleAdherence',
        'CX Rep Overall': 'cxRepOverall',
        'First Call Resolution': 'fcr',
        'Overall Experience': 'overallExperience',
        'Transfers': 'transfers',
        'Overall Sentiment': 'overallSentiment',
        'Positive Word': 'positiveWord',
        'Avoid Negative Word': 'negativeWord',
        'Managing Emotions': 'managingEmotions',
        'Avg Handle Time': 'aht',
        'After Call Work': 'acw',
        'Hold Time': 'holdTime',
        'Reliability': 'reliability'
    };
    
    // Build coaching email with new unified prompt format
    const customNotes = document.getElementById('customNotes')?.value.trim();
    
    // Build WINS section
    let winsSection = `WINS (What ${firstName} Achieved):\n`;
    if (celebrate.length > 0) {
        celebrate.forEach(item => winsSection += `${item}\n`);
    } else {
        winsSection += `(none)\n`;
    }
    
    // Build OPPORTUNITIES section with smart tips
    let opportunitiesSection = `OPPORTUNITIES (Areas to Improve):\n`;
    const coachingContextLines = [];
    if (needsCoaching.length > 0) {
        needsCoaching.forEach(item => {
            opportunitiesSection += `${item}\n`;
            const metricMatch = item.match(/^- (.+?):/);
            if (metricMatch) {
                const metricLabel = metricMatch[1];
                const metricKey = metricKeyMap[metricLabel];
                if (metricKey) {
                    const metricValue = employeeData[metricKey];
                    const severity = getMetricSeverity(metricKey, metricValue);
                    const metricTips = allTips[metricKey] || [];
                    const smartTip = selectSmartTip({
                        employeeId: selectedEmployeeId,
                        metricKey,
                        severity,
                        tips: metricTips
                    });
                    if (smartTip) {
                        opportunitiesSection += `  TIP: ${smartTip}\n`;
                    }
                    
                    // Add uploaded sentiment phrases if available
                    if (timeframeKey && associateSentimentSnapshots[selectedEmployeeId]?.[timeframeKey]) {
                        const sentimentData = associateSentimentSnapshots[selectedEmployeeId][timeframeKey];
                        
                        // For Positive Word: reference positive phrases
                        if (metricKey === 'positiveWord' && sentimentData.positive?.phrases?.length > 0) {
                            const topPhrases = sentimentData.positive.phrases
                                .slice(0, 5)
                                .map(p => `"${p.phrase}" (${p.value}x)`)
                                .join(', ');
                            opportunitiesSection += `  YOUR POSITIVE PHRASES: ${topPhrases}. Use these on EVERY call to reach 100%!\n`;
                        }
                        
                        // For Negative Word: reference negative phrases to eliminate
                        if (metricKey === 'negativeWord' && sentimentData.negative?.phrases?.length > 0) {
                            const topPhrases = sentimentData.negative.phrases
                                .slice(0, 5)
                                .map(p => `"${p.phrase}" (${p.value}x)`)
                                .join(', ');
                            opportunitiesSection += `  NEGATIVE PHRASES TO ELIMINATE: ${topPhrases}. Avoid using these.\n`;
                        }
                        
                        // For Managing Emotions: reference emotion phrases
                        if (metricKey === 'managingEmotions' && sentimentData.emotions?.phrases?.length > 0) {
                            const topPhrases = sentimentData.emotions.phrases
                                .slice(0, 5)
                                .map(p => `"${p.phrase}" (${p.value}x)`)
                                .join(', ');
                            opportunitiesSection += `  EMOTION INDICATORS: ${topPhrases}. Focus on staying composed when these arise.\n`;
                        }
                    }
                    
                    const contextLine = getCoachingContext(selectedEmployeeId, metricKey, metricValue);
                    if (contextLine) coachingContextLines.push(contextLine);
                }
            }
        });
    } else {
        opportunitiesSection += `(none)\n`;
    }
    
    // Add reliability note if applicable
    const reliabilityMetric = needsCoaching.find(item => item.includes('Reliability'));
    let reliabilityHours = null;
    if (reliabilityMetric) {
        const hoursMatch = reliabilityMetric.match(/(\d+\.?\d*)\s*hrs?/);
        const parsedHours = hoursMatch?.[1] ? parseFloat(hoursMatch[1]) : NaN;
        reliabilityHours = Number.isFinite(parsedHours) ? parsedHours : employeeData.reliability;
        opportunitiesSection += `\nRELIABILITY NOTE:\nYou have ${reliabilityHours} hours listed as unscheduled/unplanned time. Please check Verint to make sure this aligns with any time missed ${timeReference} that was unscheduled. If this is an error, please let me know.\n`;
    }

    const confidenceInsight = buildConfidenceInsight(employeeData, coachedMetricKeys);
    let supervisorContext = '';
    if (coachingContextLines.length || confidenceInsight) {
        supervisorContext = `\nSUPERVISOR CONTEXT (use naturally, do not copy verbatim):\n`;
        coachingContextLines.forEach(line => supervisorContext += `- ${line}\n`);
        if (confidenceInsight) supervisorContext += `- ${confidenceInsight}\n`;
    }

    const complianceFlags = detectComplianceFlags(customNotes);
    if (complianceFlags.length > 0) {
        supervisorContext += `\nCOMPLIANCE FLAG: ${complianceFlags.join(', ')}. Please document and follow policy.\n`;
        logComplianceFlag({
            employeeId: selectedEmployeeId,
            flag: complianceFlags.join(', '),
            timestamp: new Date().toISOString()
        });
    }

    // Store data for Verint summary generation
    window.latestCoachingSummaryData = {
        firstName,
        periodLabel,
        celebrate,
        needsCoaching,
        reliabilityHours,
        customNotes,
        timeReference
    };
    
    let additionalContext = '';
    if (customNotes) {
        additionalContext = `\nADDITIONAL CONTEXT:\n${customNotes}\n`;
    }
    
    // Build the unified Copilot prompt - conversational format to avoid detection as system prompt
    const prompt = `I'm a supervisor preparing a coaching email for an employee named ${firstName} for their ${periodLabel} performance review. I need your help drafting this in a natural, warm tone - not corporate or template-like.

Here's the performance data:

${winsSection}

${opportunitiesSection}${additionalContext}${supervisorContext}

Can you help me write an email to ${firstName} with this structure:

1. Warm, conversational greeting

2. WINS section:
   - Brief intro line
    - Bullets in this concise format: "• Metric Name - Goal X%. You were at Y%."
   - After bullets: A paragraph celebrating their achievements and encouraging them to keep it up

3. OPPORTUNITIES section:
   - Brief supportive intro line
    - Bullets in this format: "• Metric Name - Goal X%. You were at Y%."
    - Note: If Reliability is included, format as: "• Reliability - X hours unscheduled" (no goal needed)
   - After bullets: A paragraph with coaching tips (reword the tips naturally so they don't sound templated). Be constructive and supportive. If there's a reliability note, weave it in naturally here.

4. Warm close inviting them to discuss

Keep it conversational, upbeat, and motivating. Use "you" language. Avoid corporate buzzwords and any mention of AI or analysis. Make this sound like a genuine supervisor who cares about their success.

Vary your wording and sentence structure so it doesn't sound templated or AI-generated. Use natural phrasing and avoid repeating the same patterns.

Add emojis throughout the email to make it fun and engaging! Use them in the greeting, with wins, with opportunities, and in the closing. Make it feel warm and approachable.

Do NOT use em dashes (—) anywhere in the email.

Use the % symbol instead of writing out "percent" (e.g., "95%" not "95 percent").

The email should be ready to send as-is. Just give me the complete email to ${firstName}, nothing else.`;
    
    // Copy to clipboard
    navigator.clipboard.writeText(prompt).then(() => {
        // Show instruction popup
        alert('Ctrl+V and Enter to paste.\nThen copy the next screen and come back to this window.');
        
        // Open Copilot
        window.open('https://copilot.microsoft.com', '_blank');
        
        // Show the paste section
        document.getElementById('copilotOutputSection').style.display = 'block';
        
        // Scroll to paste section
        document.getElementById('copilotOutputSection').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        showToast('✅ Prompt copied! Paste into CoPilot, then paste the result back here.');
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('⚠️ Failed to copy prompt to clipboard. Please try again.');
    });
}

function generateVerintSummary() {
    const employeeSelect = document.getElementById('employeeSelect');
    const selectedEmployeeId = employeeSelect?.value;
    const employeeName = document.getElementById('employeeName')?.value.trim();
    
    if (!selectedEmployeeId) {
        alert('⚠️ Please select an employee first');
        return;
    }
    
    if (employeeName) {
        saveNickname(selectedEmployeeId, employeeName);
    }

    // Get ALL coaching history for this employee
    const history = getCoachingHistoryForEmployee(selectedEmployeeId);
    
    if (history && history.length > 0) {
        const cleanLabel = (item) => {
            if (!item) return '';
            const match = item.match(/^-\s*(.+?):/);
            if (match) return match[1].trim();
            return item.replace(/^-/,'').split(':')[0].trim();
        };
        
        const firstName = getEmployeeNickname(selectedEmployeeId) || selectedEmployeeId.split(' ')[0];
        
        // Build narrative summary for the LATEST coaching session
        const latestSession = history[0];
        const date = new Date(latestSession.generatedAt).toLocaleDateString();
        const winsLabels = (latestSession.celebrate || []).map(cleanLabel).filter(Boolean);
        const oppLabels = (latestSession.needsCoaching || []).map(cleanLabel).filter(Boolean);
        
        let verintText = `Coaching Session with ${firstName} - ${date}\n\n`;
        
        // Wins section
        if (winsLabels.length > 0) {
            verintText += `I recognized ${firstName} for their strong performance in `;
            if (winsLabels.length === 1) {
                verintText += `${winsLabels[0]}`;
            } else if (winsLabels.length === 2) {
                verintText += `${winsLabels[0]} and ${winsLabels[1]}`;
            } else {
                verintText += winsLabels.slice(0, -1).join(', ') + `, and ${winsLabels[winsLabels.length - 1]}`;
            }
            verintText += `. Encouraged them to keep up the great work in these areas.\n\n`;
        } else {
            verintText += `We discussed ${firstName}'s current performance and acknowledged their efforts to improve.\n\n`;
        }
        
        // Development areas section
        if (oppLabels.length > 0) {
            verintText += `We reviewed development opportunities in `;
            if (oppLabels.length === 1) {
                verintText += `${oppLabels[0]}`;
            } else if (oppLabels.length === 2) {
                verintText += `${oppLabels[0]} and ${oppLabels[1]}`;
            } else {
                verintText += oppLabels.slice(0, -1).join(', ') + `, and ${oppLabels[oppLabels.length - 1]}`;
            }
            verintText += `. We discussed specific strategies and tips to help improve performance in these metrics. ${firstName} acknowledged the feedback and committed to implementing the discussed improvements.\n\n`;
        }
        
        // Action items
        verintText += `Action Items:\n`;
        if (oppLabels.length > 0) {
            oppLabels.forEach(metric => {
                verintText += `• Focus on improving ${metric}\n`;
            });
        } else {
            verintText += `• Continue current performance level\n`;
        }
        
        verintText += `\nNext Steps: Follow up next week to review progress and provide additional support as needed.`;
        
        // Add coaching history count
        if (history.length > 1) {
            verintText += `\n\n--- Previous Coaching Sessions: ${history.length - 1} ---`;
        }

        const outputElement = document.getElementById('verintSummaryOutput');
        outputElement.value = verintText;
        
        // Show the section
        document.getElementById('verintSummarySection').style.display = 'block';
        
        // Copy to clipboard
        navigator.clipboard.writeText(verintText).then(() => {
            showToast('✅ Verint coaching notes copied to clipboard!', 3000);
        }).catch(err => {
            console.error('Failed to copy:', err);
            showToast('⚠️ Failed to copy. Text is displayed above.', 3000);
        });
    } else {
        const outputElement = document.getElementById('verintSummaryOutput');
        outputElement.value = `No coaching history found for ${selectedEmployeeId}. Generate a coaching email first.`;
        document.getElementById('verintSummarySection').style.display = 'block';
    }
}

function renderIndividualTrendAnalysis(container, employeeName, keys, periodType = 'wow') {
    const buckets = getTrendComparisonBuckets(keys, periodType);
    const periodLabel = buckets.descriptor.compareLabel;
    const currentEmp = buildEmployeeAggregateForPeriod(employeeName, buckets.currentKeys);
    const prevEmp = buildEmployeeAggregateForPeriod(employeeName, buckets.previousKeys);
    const thirdEmp = buildEmployeeAggregateForPeriod(employeeName, buckets.thirdKeys);

    if (!currentEmp) {
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">Selected employee has no data in the selected comparison window.</div>';
        return;
    }

    if (!prevEmp) {
        container.innerHTML = `<div style="color: #666; font-size: 0.95em;">Not enough data for ${buckets.descriptor.label} analysis. Add more historical data.</div>`;
        return;
    }

    const warnings = [];
    const wins = [];
    const rationale = [];

    // Check for 3-period decline if we have enough data
    if (thirdEmp) {
        ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht'].forEach(metricKey => {
            const a = currentEmp[metricKey];
            const b = prevEmp[metricKey];
            const c = thirdEmp[metricKey];
            if (a === undefined || b === undefined || c === undefined) return;
            const worse1 = metricDelta(metricKey, a, b) < 0;
            const worse2 = metricDelta(metricKey, b, c) < 0;
            if (worse1 && worse2) {
                warnings.push(`📉 3-${periodLabel} decline in ${METRICS_REGISTRY[metricKey]?.label || metricKey}. This needs immediate attention.`);
                rationale.push(`${METRICS_REGISTRY[metricKey]?.label || metricKey}: negative deltas in two consecutive ${periodLabel}-to-${periodLabel} comparisons.`);
            }
        });
    }

    // Check for sudden drops based on selected period
    if (prevEmp) {
        ['overallSentiment', 'overallExperience', 'fcr', 'scheduleAdherence', 'aht', 'holdTime', 'transfers'].forEach(metricKey => {
            const current = currentEmp[metricKey];
            const prev = prevEmp[metricKey];
            if (current === undefined || prev === undefined) return;
            const delta = metricDelta(metricKey, current, prev);
            const thresholdData = getTrendDeltaThreshold(metricKey);
            const unit = thresholdData.unit;
            const threshold = thresholdData.value;
            if (delta < -threshold) {
                warnings.push(`⚠️ Sudden ${periodLabel}-over-${periodLabel} drop in ${METRICS_REGISTRY[metricKey]?.label || metricKey} (${delta.toFixed(1)}${unit}). Needs supportive conversation.`);
                rationale.push(`${METRICS_REGISTRY[metricKey]?.label || metricKey}: delta ${delta.toFixed(1)}${unit} crossed alert threshold (-${threshold}${unit}).`);
            }
        });
    }

    // Check for consistency and wins
    const meetsAllTargets = ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment'].every(metricKey => 
        metricMeetsTarget(metricKey, currentEmp[metricKey])
    );
    
    if (meetsAllTargets) {
        wins.push(`✅ ${employeeName} is meeting all key targets. Consider recognition!`);
        rationale.push('Target consistency rule: all core target metrics are currently at or above goal.');
    }

    // Check for improvement trends
    if (prevEmp) {
        ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr'].forEach(metricKey => {
            const current = currentEmp[metricKey];
            const prev = prevEmp[metricKey];
            if (current === undefined || prev === undefined) return;
            const delta = metricDelta(metricKey, current, prev);
            if (delta > 5) {
                wins.push(`🎉 Strong ${periodLabel}-over-${periodLabel} improvement in ${METRICS_REGISTRY[metricKey]?.label || metricKey} (+${delta.toFixed(1)})`);
                rationale.push(`${METRICS_REGISTRY[metricKey]?.label || metricKey}: improvement delta ${delta.toFixed(1)} exceeded +5 threshold.`);
            }
        });

    }

    const coachingImpact = calculateCoachingImpact(employeeName, currentEmp);

    // Build output
    let html = `<div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e0e0e0;">`;
    html += `<h5 style="margin-top: 0; color: #f5576c;">Individual Coaching Insights for ${employeeName} (${buckets.descriptor.shortLabel})</h5>`;
    html += `<div style="margin-bottom: 12px; padding: 10px; background: #f7f9fc; border-radius: 6px; border-left: 4px solid #607d8b; color: #455a64; font-size: 0.9em;">`;
    html += `<strong>Confidence:</strong> ${thirdEmp ? 'High' : 'Medium'} • Current window: ${currentEmp.periodsIncluded} ${currentEmp.periodsIncluded === 1 ? 'period' : 'periods'} • Comparison window: ${prevEmp.periodsIncluded}`;
    html += `</div>`;
    
    if (warnings.length > 0) {
        html += `<div style="margin-bottom: 15px;">`;
        html += `<div style="font-weight: 600; color: #e53935; margin-bottom: 8px;">🚨 Attention Needed:</div>`;
        warnings.forEach(w => {
            html += `<div style="padding: 10px; border-left: 3px solid #e53935; background: #ffebee; margin-bottom: 6px; border-radius: 4px;">${w}</div>`;
        });
        html += `</div>`;
    }

    if (wins.length > 0) {
        html += `<div style="margin-bottom: 15px;">`;
        html += `<div style="font-weight: 600; color: #43a047; margin-bottom: 8px;">✨ Wins & Strengths:</div>`;
        wins.forEach(w => {
            html += `<div style="padding: 10px; border-left: 3px solid #43a047; background: #e8f5e9; margin-bottom: 6px; border-radius: 4px;">${w}</div>`;
        });
        html += `</div>`;
    }

    if (coachingImpact) {
        const impactColor = coachingImpact.status === 'positive' ? '#2e7d32' : coachingImpact.status === 'negative' ? '#c62828' : '#ef6c00';
        const impactBg = coachingImpact.status === 'positive' ? '#e8f5e9' : coachingImpact.status === 'negative' ? '#ffebee' : '#fff3e0';
        const impactLabel = coachingImpact.status === 'positive' ? 'Coaching approach is working' : coachingImpact.status === 'negative' ? 'Coaching approach may need adjustment' : 'Mixed coaching impact';

        html += `<div style="margin-bottom: 15px;">`;
        html += `<div style="font-weight: 600; color: ${impactColor}; margin-bottom: 8px;">📌 Coaching Impact Score</div>`;
        html += `<div style="padding: 10px; border-left: 3px solid ${impactColor}; background: ${impactBg}; margin-bottom: 6px; border-radius: 4px;">`;
        html += `<strong>${coachingImpact.score}/100</strong> • ${impactLabel} (based on ${coachingImpact.metricCount} coached metrics since ${new Date(coachingImpact.generatedAt).toLocaleDateString()})`;
        if (coachingImpact.details.length) {
            html += `<div style="margin-top: 6px;">${coachingImpact.details.join(' • ')}</div>`;
        }
        html += `</div></div>`;
    }

    if (rationale.length > 0) {
        html += `<div style="margin-bottom: 15px;">`;
        html += `<div style="font-weight: 600; color: #455a64; margin-bottom: 8px;">🧩 Why these insights fired</div>`;
        rationale.slice(0, 3).forEach(item => {
            html += `<div style="padding: 10px; border-left: 3px solid #607d8b; background: #eceff1; margin-bottom: 6px; border-radius: 4px;">${item}</div>`;
        });
        html += `</div>`;
    }

    if (warnings.length === 0 && wins.length === 0) {
        html += `<div style="color: #666; padding: 15px; background: #f5f5f5; border-radius: 6px; text-align: center;">`;
        html += `<p style="margin: 0;">📊 No significant trends detected this period. ${employeeName} is performing steadily.</p>`;
        html += `</div>`;
    }

    html += `<div style="margin-top: 15px; padding: 12px; background: #fff3e0; border-radius: 6px; border-left: 4px solid #ff9800;">`;
    html += `<strong>💡 Next Step:</strong> Click "Generate Individual Coaching Email" to create a personalized development email with specific tips and action items.`;
    html += `</div>`;
    html += `</div>`;
    
    container.innerHTML = html;
}

function renderGroupTrendAnalysis(container, keys, periodType = 'wow') {
    const buckets = getTrendComparisonBuckets(keys, periodType);

    if (!buckets.currentKeys.length || !buckets.previousKeys.length) {
        container.innerHTML = `<div style="color: #666; font-size: 0.95em;">Not enough data for ${buckets.descriptor.label} group analysis.</div>`;
        return;
    }

    const teamInsights = {
        atRisk: [],
        declining: [],
        improving: [],
        consistent: []
    };

    const employeeNames = Array.from(getEmployeeNamesForPeriod(buckets.currentKeys));

    employeeNames.forEach(employeeName => {
        const currentEmp = buildEmployeeAggregateForPeriod(employeeName, buckets.currentKeys);
        const prevEmp = buildEmployeeAggregateForPeriod(employeeName, buckets.previousKeys);
        if (!prevEmp) return;

        // Check for 3-period decline
        if (buckets.thirdKeys.length) {
            const thirdEmp = buildEmployeeAggregateForPeriod(employeeName, buckets.thirdKeys);
            if (thirdEmp) {
                const hasDecline = ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr'].some(metricKey => {
                    const a = currentEmp[metricKey];
                    const b = prevEmp[metricKey];
                    const c = thirdEmp[metricKey];
                    if (a === undefined || b === undefined || c === undefined) return false;
                    const worse1 = metricDelta(metricKey, a, b) < 0;
                    const worse2 = metricDelta(metricKey, b, c) < 0;
                    return worse1 && worse2;
                });

                if (hasDecline) {
                    teamInsights.atRisk.push(employeeName);
                    return;
                }
            }
        }

        // Check for sudden drops
        const hasSuddenDrop = ['overallSentiment', 'overallExperience', 'fcr', 'scheduleAdherence'].some(metricKey => {
            const current = currentEmp[metricKey];
            const prev = prevEmp[metricKey];
            if (current === undefined || prev === undefined) return false;
            const delta = metricDelta(metricKey, current, prev);
            return delta < -4;
        });

        if (hasSuddenDrop) {
            teamInsights.declining.push(employeeName);
            return;
        }

        // Check for improvements
        const hasImprovement = ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr'].some(metricKey => {
            const current = currentEmp[metricKey];
            const prev = prevEmp[metricKey];
            if (current === undefined || prev === undefined) return false;
            const delta = metricDelta(metricKey, current, prev);
            return delta > 5;
        });

        if (hasImprovement) {
            teamInsights.improving.push(employeeName);
            return;
        }

        // Check for consistency
        const consistent = ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment'].every(metricKey => 
            metricMeetsTarget(metricKey, currentEmp[metricKey])
        );
        
        if (consistent) {
            teamInsights.consistent.push(employeeName);
        }
    });

    // Build team overview
    let html = `<div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e0e0e0;">`;
    html += `<h5 style="margin-top: 0; color: #764ba2;">Team-Wide Trend Analysis (${buckets.descriptor.shortLabel})</h5>`;
    html += `<div style="margin-bottom: 12px; padding: 10px; background: #f7f9fc; border-radius: 6px; border-left: 4px solid #607d8b; color: #455a64; font-size: 0.9em;">`;
    html += `<strong>Confidence:</strong> ${buckets.thirdKeys.length ? 'High' : 'Medium'} • Current window periods: ${buckets.currentKeys.length} • Comparison window periods: ${buckets.previousKeys.length}`;
    html += `</div>`;
    
    // Summary cards
    html += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px;">`;
    
    html += `<div style="padding: 15px; background: linear-gradient(135deg, #e53935 0%, #ef5350 100%); color: white; border-radius: 8px; text-align: center;">`;
    html += `<div style="font-size: 2em; font-weight: bold;">${teamInsights.atRisk.length}</div>`;
    html += `<div style="font-size: 0.9em; opacity: 0.95;">At Risk (3-period decline)</div>`;
    html += `</div>`;
    
    html += `<div style="padding: 15px; background: linear-gradient(135deg, #fb8c00 0%, #ffa726 100%); color: white; border-radius: 8px; text-align: center;">`;
    html += `<div style="font-size: 2em; font-weight: bold;">${teamInsights.declining.length}</div>`;
    html += `<div style="font-size: 0.9em; opacity: 0.95;">Declining (needs attention)</div>`;
    html += `</div>`;
    
    // Detailed lists
    if (teamInsights.atRisk.length > 0) {
        html += `<div style="margin-bottom: 15px;">`;
        html += `<div style="font-weight: 600; color: #e53935; margin-bottom: 8px;">🚨 At Risk - Need Immediate Coaching:</div>`;
        html += `<div style="padding: 12px; background: #ffebee; border-radius: 6px; border-left: 4px solid #e53935;">`;
        html += teamInsights.atRisk.join(', ');
        html += `</div></div>`;
    }

    if (teamInsights.declining.length > 0) {
        html += `<div style="margin-bottom: 15px;">`;
        html += `<div style="font-weight: 600; color: #fb8c00; margin-bottom: 8px;">⚠️ Declining - Watch Closely:</div>`;
        html += `<div style="padding: 12px; background: #fff3e0; border-radius: 6px; border-left: 4px solid #fb8c00;">`;
        html += teamInsights.declining.join(', ');
        html += `</div></div>`;
    }

    if (teamInsights.improving.length > 0) {
        html += `<div style="margin-bottom: 15px;">`;
        html += `<div style="font-weight: 600; color: #43a047; margin-bottom: 8px;">🎉 Improving - Recognize Progress:</div>`;
        html += `<div style="padding: 12px; background: #e8f5e9; border-radius: 6px; border-left: 4px solid #43a047;">`;
        html += teamInsights.improving.join(', ');
        html += `</div></div>`;
    }

    if (teamInsights.consistent.length > 0) {
        html += `<div style="margin-bottom: 15px;">`;
        html += `<div style="font-weight: 600; color: #1e88e5; margin-bottom: 8px;">✅ Consistent Performers:</div>`;
        html += `<div style="padding: 12px; background: #e3f2fd; border-radius: 6px; border-left: 4px solid #1e88e5;">`;
        html += teamInsights.consistent.join(', ');
        html += `</div></div>`;
    }

    html += `<div style="margin-top: 15px; padding: 12px; background: #e1f5fe; border-radius: 6px; border-left: 4px solid #0288d1;">`;
    html += `<strong>💡 Next Step:</strong> Click "Generate Group Email" to create a team-wide communication highlighting trends, celebrating wins, and sharing helpful tips for common opportunities.`;
    html += `</div>`;
    html += `</div>`;
    
    container.innerHTML = html;
}

// ============================================
// EMPLOYEE LIST VIEWER
// ============================================

function renderEmployeesList() {
    const container = document.getElementById('employeesList');
    
    // Get all unique employees from uploaded weekly data
    const employeeSet = new Set();
    Object.values(weeklyData).forEach(week => {
        if (week && week.employees) {
            week.employees.forEach(emp => {
                employeeSet.add(emp.name);
            });
        }
    });
    
    const employees = Array.from(employeeSet).sort();
    
    if (employees.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No employees yet. Upload weekly data to see your team members here!</div>';
        return;
    }
    
    const preferredNames = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'employeePreferredNames') || '{}');
    
    container.innerHTML = `<div style="padding: 15px; background: #f0f8ff; border-bottom: 2px solid #6a1b9a; font-weight: bold; color: #6a1b9a;">Total Employees: ${employees.length}</div>` + 
    employees.map(name => {
        const currentPreferred = preferredNames[name] || getEmployeeNickname(name);
        const defaultValue = preferredNames[name] || '';
        
        return `
        <div style="padding: 15px; border-bottom: 1px solid #eee; background: #fafafa;">
            <div style="display: flex; justify-content: space-between; align-items: start; gap: 15px;">
                <div style="flex: 1;">
                    <strong style="color: #6a1b9a;">${name}</strong>
                    <div style="font-size: 0.8em; color: #666; margin: 5px 0 0 0;">Source: Weekly Data Uploads</div>
                </div>
                <div style="flex: 1; min-width: 200px;">
                    <label style="font-size: 0.85em; color: #666; display: block; margin-bottom: 5px; font-weight: 500;">How to Address:</label>
                    <input type="text" id="prefName_${escapeHtml(name)}" value="${defaultValue}" placeholder="${getEmployeeNickname(name)}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9em; box-sizing: border-box;">
                    <div style="font-size: 0.75em; color: #999; margin-top: 3px;">Current: <strong>${currentPreferred}</strong></div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button class="saveEmployeeNameBtn" data-name="${escapeHtml(name)}" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; font-size: 0.9em; white-space: nowrap;">💾 Save</button>
                    <button class="deleteEmployeeBtn" data-name="${escapeHtml(name)}" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; font-size: 0.9em; white-space: nowrap;">🗑️ Delete</button>
                </div>
            </div>
        </div>
    `}).join('');
    
    // Add event delegation for employee management
    container.addEventListener('click', (e) => {
        if (e.target.classList.contains('saveEmployeeNameBtn')) {
            saveEmployeePreferredName(e.target.dataset.name);
        } else if (e.target.classList.contains('deleteEmployeeBtn')) {
            deleteEmployee(e.target.dataset.name);
        }
    });
}

function deleteEmployee(employeeName) {
    if (!confirm(`Are you sure you want to delete "${employeeName}" from ALL weekly data?\n\nThis will remove them from all uploaded weeks and cannot be undone.`)) {
        return;
    }
    
    // Remove from all weekly data
    let removedCount = 0;
    Object.keys(weeklyData).forEach(weekKey => {
        if (weeklyData[weekKey]?.employees) {
            const beforeLength = weeklyData[weekKey].employees.length;
            weeklyData[weekKey].employees = weeklyData[weekKey].employees.filter(emp => emp.name !== employeeName);
            if (weeklyData[weekKey].employees.length < beforeLength) {
                removedCount++;
            }
        }
    });
    
    // Save updated data
    saveWeeklyData();
    
    // Remove preferred name
    const preferredNames = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'employeePreferredNames') || '{}');
    delete preferredNames[employeeName];
    localStorage.setItem(STORAGE_PREFIX + 'employeePreferredNames', JSON.stringify(preferredNames));
    
    // Refresh the list
    renderEmployeesList();
    
    showToast(`✅ Deleted "${employeeName}" from ${removedCount} week(s)`, 3000);
}


// ============================================
// INITIALIZATION
// ============================================

function initApp() {
    
    installDebugListeners();
    
    // Load data from localStorage
    weeklyData = loadWeeklyData();
    ytdData = loadYtdData();
    coachingHistory = loadCoachingHistory();
    sentimentPhraseDatabase = loadSentimentPhraseDatabase();
    associateSentimentSnapshots = loadAssociateSentimentSnapshots();
    ensureSentimentPhraseDatabaseDefaults();
    loadTeamMembers();
    

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
    
    // Always show Upload Data page on refresh
    showOnlySection('coachingForm');
    
    // Initialize data for the active section (fixes refresh behavior)
    initializeSection('coachingForm');
    
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
        saveSentimentPhraseDatabase();
        saveAssociateSentimentSnapshots();
        
    });
    
    // Auto-sync on page load disabled (user will click Sync Now manually)
    
    
}

function setAppVersionLabel(statusSuffix = '') {
    const versionEl = document.getElementById('appVersion');
    if (!versionEl) return;
    versionEl.textContent = `Version: ${APP_VERSION}${statusSuffix}`;
    const statusEl = document.getElementById('systemStatus');
    if (statusEl) {
        statusEl.textContent = `System: ${APP_VERSION}`;
    }
}

function bootAppSafely() {
    setAppVersionLabel();
    try {
        initApp();
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
    const allEmployees = new Set();
    
    // Collect all unique employee names from weeklyData
    for (const weekKey in weeklyData) {
        const week = weeklyData[weekKey];
        if (week.employees && Array.isArray(week.employees)) {
            week.employees.forEach(emp => {
                if (emp.name && isTeamMember(weekKey, emp.name)) {
                    allEmployees.add(emp.name);
                }
            });
        }
    }
    
    // Sort and populate dropdown
    const sortedEmployees = Array.from(allEmployees).sort();
    select.innerHTML = '<option value="">-- Choose an associate --</option>';
    sortedEmployees.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });
    
    
}

function loadExecutiveSummaryData() {
    const associate = document.getElementById('summaryAssociateSelect').value;
    const periodType = 'ytd'; // Always use Year-to-Date
    
    
    if (!associate) {
        
        document.getElementById('summaryDataContainer').style.display = 'none';
        document.getElementById('summaryChartsContainer').style.display = 'none';
        return;
    }
    

    
    // Collect ALL periods (regardless of upload type) for YTD view
    const matchingPeriods = [];
    for (const weekKey in weeklyData) {
        const weekData = weeklyData[weekKey];
        
        // For executive summary (YTD), include all periods regardless of metadata type
        const employee = weekData.employees.find(e => e.name === associate);
        if (employee) {
            
            matchingPeriods.push({
                weekKey,
                label: weekData.metadata?.label || weekKey,
                employee: employee,
                centerAverage: getCenterAverageForWeek(weekKey),
                startDate: weekData.metadata?.startDate,
                endDate: weekData.metadata?.endDate
            });
        }
    }
    
    
    // Populate data table
    populateExecutiveSummaryTable(associate, matchingPeriods, periodType);
    
    // Display metric trend charts
    renderYearlySummaryTrendCharts();
    
    document.getElementById('summaryDataContainer').style.display = 'block';
    document.getElementById('summaryChartsContainer').style.display = 'block';
}

function populateExecutiveSummaryTable(associate, periods, periodType) {
    const tbody = document.getElementById('summaryDataTable');
    tbody.innerHTML = '';
    
    // Create a single YTD summary row instead of showing all periods
    // Aggregate all metrics across all periods
    let adherenceSum = 0, adherenceCount = 0;
    let experienceSum = 0, experienceCount = 0;
    let fcrSum = 0, fcrCount = 0;
    let transfersSum = 0, transfersCount = 0;
    
    periods.forEach(period => {
        if (!period.employee) return;
        
        if (period.employee.scheduleAdherence !== undefined && period.employee.scheduleAdherence !== null && period.employee.scheduleAdherence !== '') {
            adherenceSum += parseFloat(period.employee.scheduleAdherence);
            adherenceCount++;
        }
        if (period.employee.overallExperience !== undefined && period.employee.overallExperience !== null && period.employee.overallExperience !== '') {
            experienceSum += parseFloat(period.employee.overallExperience);
            experienceCount++;
        }
        if (period.employee.fcr !== undefined && period.employee.fcr !== null && period.employee.fcr !== '') {
            fcrSum += parseFloat(period.employee.fcr);
            fcrCount++;
        }
        if (period.employee.transfers !== undefined && period.employee.transfers !== null && period.employee.transfers !== '') {
            transfersSum += parseFloat(period.employee.transfers);
            transfersCount++;
        }
    });
    
    const avgAdherence = adherenceCount > 0 ? (adherenceSum / adherenceCount).toFixed(1) : 0;
    const avgExperience = experienceCount > 0 ? (experienceSum / experienceCount).toFixed(1) : 0;
    const avgFCR = fcrCount > 0 ? (fcrSum / fcrCount).toFixed(1) : 0;
    const avgTransfers = transfersCount > 0 ? (transfersSum / transfersCount).toFixed(1) : 0;
    
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

function loadExecutiveSummaryNotes(associate) {
    const saved = localStorage.getItem(STORAGE_PREFIX + 'executiveSummaryNotes') ? JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'executiveSummaryNotes')) : {};
    const employeeNotes = saved[associate] || {};
    
    // Populate red flags
    document.querySelectorAll('.redflags-input').forEach(input => {
        const weekKey = input.dataset.week;
        input.value = employeeNotes[weekKey]?.redFlags || '';
        input.addEventListener('change', () => saveExecutiveSummaryNotes(associate));
    });
    
    // Populate phishing
    document.querySelectorAll('.phishing-input').forEach(input => {
        const weekKey = input.dataset.week;
        input.value = employeeNotes[weekKey]?.phishing || '';
        input.addEventListener('change', () => saveExecutiveSummaryNotes(associate));
    });
}

function saveExecutiveSummaryNotes(associate) {
    const saved = localStorage.getItem(STORAGE_PREFIX + 'executiveSummaryNotes') ? JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'executiveSummaryNotes')) : {};
    
    if (!saved[associate]) {
        saved[associate] = {};
    }
    
    document.querySelectorAll('.redflags-input').forEach(input => {
        const weekKey = input.dataset.week;
        if (!saved[associate][weekKey]) saved[associate][weekKey] = {};
        saved[associate][weekKey].redFlags = input.value;
    });
    
    document.querySelectorAll('.phishing-input').forEach(input => {
        const weekKey = input.dataset.week;
        if (!saved[associate][weekKey]) saved[associate][weekKey] = {};
        saved[associate][weekKey].phishing = input.value;
    });
    
    localStorage.setItem(STORAGE_PREFIX + 'executiveSummaryNotes', JSON.stringify(saved));
    showToast(`? Notes saved for ${associate}`, 3000);
}

function displayExecutiveSummaryCharts(associate, periods, periodType) {
    
    const container = document.getElementById('summaryMetricsVisuals');
    if (!container) {
        console.error('ERROR: summaryMetricsVisuals container not found!');
        return;
    }
    container.innerHTML = '';
    
    if (!periods || periods.length === 0) {
        
        container.innerHTML = '<p style="color: #999; padding: 20px;">No data available for this associate.</p>';
        return;
    }
    
    // Average across all periods for this associate
    const surveyBasedMetrics = ['overallExperience', 'cxRepOverall', 'fcr'];
    const metrics = [
        { key: 'scheduleAdherence', label: 'Schedule Adherence', unit: '%', lowerIsBetter: false, isSurveyBased: false },
        { key: 'overallExperience', label: 'Overall Experience', unit: '', lowerIsBetter: false, isSurveyBased: true },
        { key: 'cxRepOverall', label: 'CX Rep Overall', unit: '', lowerIsBetter: false, isSurveyBased: true },
        { key: 'fcr', label: 'First Call Resolution', unit: '%', lowerIsBetter: false, isSurveyBased: true },
        { key: 'transfers', label: 'Transfers', unit: '%', lowerIsBetter: true, isSurveyBased: false },
        { key: 'overallSentiment', label: 'Sentiment', unit: '%', lowerIsBetter: false, isSurveyBased: false },
        { key: 'positiveWord', label: 'Positive Words', unit: '', lowerIsBetter: false, isSurveyBased: false },
        { key: 'negativeWord', label: 'Negative Words', unit: '', lowerIsBetter: true, isSurveyBased: false },
        { key: 'managingEmotions', label: 'Managing Emotions', unit: '%', lowerIsBetter: false, isSurveyBased: false },
        { key: 'aht', label: 'Average Handle Time', unit: 's', lowerIsBetter: true, isSurveyBased: false },
        { key: 'acw', label: 'After Call Work', unit: 's', lowerIsBetter: true, isSurveyBased: false },
        { key: 'holdTime', label: 'Hold Time', unit: 's', lowerIsBetter: true, isSurveyBased: false },
        { key: 'reliability', label: 'Reliability', unit: 'hrs', lowerIsBetter: true, isSurveyBased: false }
    ];
    
    // First pass: Calculate summary statistics and store for rendering
    const metricsData = [];
    let metricsMetTarget = 0;
    let metricsOutpacingPeers = 0;
    
    metrics.forEach(metric => {
        // Calculate employee average
        let employeeSum = 0, employeeCount = 0;
        periods.forEach(period => {
            if (period.employee && period.employee[metric.key] !== undefined && period.employee[metric.key] !== null && period.employee[metric.key] !== '') {
                employeeSum += parseFloat(period.employee[metric.key]);
                employeeCount++;
            }
        });
        const employeeAvg = employeeCount > 0 ? employeeSum / employeeCount : 0;
        
        // Calculate center average
        let centerSum = 0, centerCount = 0;
        periods.forEach(period => {
            const centerAverageData = period.centerAverage;
            // Check if the value exists (0 is valid, only skip if undefined, null, or empty string)
            // Must check for null/undefined FIRST before accessing properties
            if (centerAverageData !== null && centerAverageData !== undefined && centerAverageData[metric.key] !== undefined && centerAverageData[metric.key] !== null && centerAverageData[metric.key] !== '') {
                centerSum += parseFloat(centerAverageData[metric.key]);
                centerCount++;
            }
        });
        const centerAvg = centerCount > 0 ? centerSum / centerCount : null;
        
        // Get target from METRICS_REGISTRY
        const targetObj = METRICS_REGISTRY[metric.key]?.target;
        const targetValue = targetObj && typeof targetObj === 'object' && targetObj.value !== undefined ? targetObj.value : 'N/A';
        
        // Check if survey-based metric has no data
        const hasNoSurveyData = metric.isSurveyBased && employeeCount === 0;
        
        // Check if meeting target
        let isMeetingTarget = false;
        if (typeof targetValue === 'number' && !hasNoSurveyData) {
            isMeetingTarget = metric.lowerIsBetter ? (employeeAvg <= targetValue) : (employeeAvg >= targetValue);
            if (isMeetingTarget) metricsMetTarget++;
        }
        
        // Check if outpacing peers (center average)
        let isOutpacingPeers = false;
        if (centerAvg !== null && !hasNoSurveyData && typeof targetValue === 'number') {
            isOutpacingPeers = metric.lowerIsBetter ? (employeeAvg <= centerAvg) : (employeeAvg >= centerAvg);
            if (isOutpacingPeers) metricsOutpacingPeers++;
        }
        
        // Store data for rendering
        const maxValue = Math.max(
            employeeAvg || 0,
            centerAvg || 0,
            typeof targetValue === 'number' ? targetValue : employeeAvg || 0
        ) * 1.15;
        
        metricsData.push({
            metric,
            employeeAvg,
            centerAvg,
            targetValue,
            hasNoSurveyData,
            isMeetingTarget,
            maxValue
        });
    });
    
    // Display summary cards at top
    const summaryDiv = document.createElement('div');
    summaryDiv.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px; margin-bottom: 30px;';
    
    const meetingTargetCard = document.createElement('div');
    meetingTargetCard.style.cssText = 'background: linear-gradient(135deg, #4caf50 0%, #81c784 100%); color: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);';
    meetingTargetCard.innerHTML = `
        <div style="font-size: 0.9em; opacity: 0.95; margin-bottom: 8px;">Meeting Target Goals</div>
        <div style="font-size: 2.2em; font-weight: bold;">${metricsMetTarget} <span style="font-size: 1.1em;">/ 13</span></div>
        <div style="font-size: 0.85em; opacity: 0.9; margin-top: 8px;">metrics at or above goals</div>
    `;
    summaryDiv.appendChild(meetingTargetCard);
    
    const outpacingCard = document.createElement('div');
    outpacingCard.style.cssText = 'background: linear-gradient(135deg, #9c27b0 0%, #ba68c8 100%); color: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.15);';
    outpacingCard.innerHTML = `
        <div style="font-size: 0.9em; opacity: 0.95; margin-bottom: 8px;">Outpacing Your Peers</div>
        <div style="font-size: 2.2em; font-weight: bold;">${metricsOutpacingPeers} <span style="font-size: 1.1em;">/ 13</span></div>
        <div style="font-size: 0.85em; opacity: 0.9; margin-top: 8px;">categories better than center avg</div>
    `;
    summaryDiv.appendChild(outpacingCard);
    
    container.appendChild(summaryDiv);
    
    // Render metrics using pre-calculated data (no recalculation needed)
    metricsData.forEach(calc => {
        const { metric, employeeAvg, centerAvg, targetValue, hasNoSurveyData, isMeetingTarget, maxValue } = calc;
        
        // Determine bar color based on target achievement
        const barColor = isMeetingTarget ? 
            'linear-gradient(90deg, #4caf50, #81c784)' :  // Green if meeting target
            'linear-gradient(90deg, #ffc107, #ffb300)';    // Yellow if not meeting target
        
        // Create visual bar
        const chartDiv = document.createElement('div');
        chartDiv.style.cssText = 'background: white; padding: 15px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);';
        
        chartDiv.innerHTML = `
            <h5 style="margin: 0 0 12px 0; color: #ff9800;">${metric.label}</h5>
            <div style="margin-bottom: 8px;">
                <div style="display: flex; align-items: center; margin-bottom: 6px;">
                    <span style="width: 100px; font-weight: bold;">You:</span>
                    <div style="flex: 1; background: #e8f5e9; height: 24px; border-radius: 3px; position: relative;">
                        <div style="background: ${barColor}; height: 100%; border-radius: 3px; width: ${maxValue > 0 ? (employeeAvg / maxValue) * 100 : 0}%;"></div>
                    </div>
                    <span style="margin-left: 12px; font-weight: bold; min-width: 80px;">${hasNoSurveyData ? 'No survey data' : employeeAvg.toFixed(1) + metric.unit}</span>
                </div>
                <div style="display: flex; align-items: center; margin-bottom: 6px;">
                    <span style="width: 100px; font-weight: bold;">Center Avg:</span>
                    <div style="flex: 1; background: #f3e5f5; height: 24px; border-radius: 3px; position: relative;">
                        <div style="background: linear-gradient(90deg, #9c27b0, #ba68c8); height: 100%; border-radius: 3px; width: ${centerAvg !== null && maxValue > 0 ? (centerAvg / maxValue) * 100 : 0}%;"></div>
                    </div>
                    <span style="margin-left: 12px; font-weight: bold; min-width: 80px;">${centerAvg !== null ? centerAvg.toFixed(1) + metric.unit : 'No data'}</span>
                </div>
                <div style="display: flex; align-items: center;">
                    <span style="width: 100px; font-weight: bold;">Target:</span>
                    <span style="margin-left: 12px; font-weight: bold; color: #ff9800; font-size: 1.1em;">${typeof targetValue === 'number' ? targetValue.toFixed(1) + metric.unit : targetValue}</span>
                </div>
            </div>
            <div style="font-size: 0.85em; color: #666; margin-top: 10px; padding-top: 10px; border-top: 1px solid #eee;">
                ${hasNoSurveyData ? '⏳ Awaiting customer survey data' : (centerAvg === null ? '⚠️ No center average data entered' : (metric.lowerIsBetter ? (employeeAvg <= centerAvg ? '✅ Meeting center average' : '📉 Below center average') : (employeeAvg >= centerAvg ? '✅ Meeting center average' : '📉 Below center average')))}
            </div>
        `;
        
        container.appendChild(chartDiv);
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

    // Get data for selected employee across all weekly periods
    const metricsToShow = ['scheduleAdherence', 'overallExperience', 'cxRepOverall', 'fcr', 'transfers', 'aht', 'acw', 'holdTime', 'overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions', 'reliability'];
    const trendData = {};

    metricsToShow.forEach(metricKey => {
        trendData[metricKey] = [];
        keys.forEach(weekKey => {
            const week = weeklyData[weekKey];
            const emp = week?.employees?.find(e => e.name === employeeName);
            if (emp && emp[metricKey] !== undefined && emp[metricKey] !== null && emp[metricKey] !== '') {
                trendData[metricKey].push({
                    weekKey: weekKey,
                    value: parseFloat(emp[metricKey]),
                    label: formatWeekLabel(weekKey)
                });
            }
        });
    });

    // Create title
    chartsContainer.innerHTML = '<h4 style="margin: 0 0 20px 0; color: #ff9800; font-size: 1.3em;">📊 Weekly Metric Trends</h4>';

    // Create grid for charts
    const chartsGrid = document.createElement('div');
    chartsGrid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px;';
    chartsContainer.appendChild(chartsGrid);

    // Create bar charts for each metric
    metricsToShow.forEach(metricKey => {
        const metric = METRICS_REGISTRY[metricKey];
        const data = trendData[metricKey];
        
        if (!data || data.length < 1) return;

        const chartContainer = document.createElement('div');
        chartContainer.style.cssText = 'background: white; padding: 15px; border-radius: 8px; border: 1px solid #e0e0e0; box-shadow: 0 2px 4px rgba(0,0,0,0.1);';
        
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

function generateComparisonChart(metricsData) {
    return new Promise((resolve) => {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 1000;
            canvas.height = 400;
            const ctx = canvas.getContext('2d');
            
            const padding = 60;
            const chartWidth = canvas.width - padding * 2;
            const chartHeight = canvas.height - padding * 2;
            const barGroupWidth = chartWidth / metricsData.length;
            const barWidth = barGroupWidth / 3 * 0.8;
            const spacing = (barGroupWidth - barWidth * 3) / 2;
            
            const allValues = metricsData.flatMap(m => [m.employee, m.center, m.target || 0]);
            const maxValue = Math.max(...allValues, 100);
            const scale = chartHeight / maxValue;
            
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            
            ctx.strokeStyle = '#ddd';
            ctx.lineWidth = 1;
            ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
            
            ctx.strokeStyle = '#333';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(padding, padding);
            ctx.lineTo(padding, canvas.height - padding);
            ctx.lineTo(canvas.width - padding, canvas.height - padding);
            ctx.stroke();
            
            metricsData.forEach((metric, i) => {
                const baseX = padding + (i * barGroupWidth) + spacing;
                
                ctx.fillStyle = '#2196F3';
                const empHeight = metric.employee * scale;
                ctx.fillRect(baseX, canvas.height - padding - empHeight, barWidth, empHeight);
                
                ctx.fillStyle = '#4CAF50';
                const centerHeight = metric.center * scale;
                ctx.fillRect(baseX + barWidth, canvas.height - padding - centerHeight, barWidth, centerHeight);
                
                if (metric.target) {
                    ctx.fillStyle = '#FF9800';
                    const targetHeight = metric.target * scale;
                    ctx.fillRect(baseX + barWidth * 2, canvas.height - padding - targetHeight, barWidth, targetHeight);
                }
                
                ctx.save();
                ctx.fillStyle = '#333';
                ctx.font = '11px Arial';
                ctx.textAlign = 'center';
                ctx.translate(baseX + barWidth * 1.5, canvas.height - padding + 40);
                ctx.rotate(-Math.PI / 8);
                ctx.fillText(metric.name, 0, 0);
                ctx.restore();
            });
            
            ctx.fillStyle = '#666';
            ctx.font = '11px Arial';
            ctx.textAlign = 'right';
            for (let i = 0; i <= 5; i++) {
                const value = (maxValue / 5) * i;
                const y = canvas.height - padding - (chartHeight / 5) * i;
                ctx.fillText(Math.round(value * 10) / 10, padding - 10, y + 4);
            }
            
            const legendY = 20;
            const legendX = canvas.width - 200;
            ctx.font = 'bold 12px Arial';
            
            ctx.fillStyle = '#2196F3';
            ctx.fillRect(legendX, legendY, 15, 15);
            ctx.fillStyle = '#333';
            ctx.textAlign = 'left';
            ctx.fillText('Employee', legendX + 20, legendY + 12);
            
            ctx.fillStyle = '#4CAF50';
            ctx.fillRect(legendX, legendY + 20, 15, 15);
            ctx.fillStyle = '#333';
            ctx.fillText('Center Avg', legendX + 20, legendY + 32);
            
            ctx.fillStyle = '#FF9800';
            ctx.fillRect(legendX, legendY + 40, 15, 15);
            ctx.fillStyle = '#333';
            ctx.fillText('Target', legendX + 20, legendY + 52);
            
            ctx.fillStyle = '#333';
            ctx.font = 'bold 16px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('Performance Comparison: Employee vs Center Average vs Target', canvas.width / 2, 35);
            
            const base64 = canvas.toDataURL('image/png');
            resolve(base64);
        } catch (error) {
            console.error('Error generating chart:', error);
            resolve('');
        }
    });
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

    const latestWeek = weeklyData[coachingLatestWeekKey];
    const employees = (latestWeek.employees || [])
        .filter(emp => emp && emp.name)
        .filter(emp => isTeamMember(coachingLatestWeekKey, emp.name))
        .map(emp => emp.name)
        .sort();

    employees.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        select.appendChild(option);
    });

    const endDate = latestWeek?.metadata?.endDate
        ? formatDateMMDDYYYY(latestWeek.metadata.endDate)
        : (coachingLatestWeekKey.split('|')[1] ? formatDateMMDDYYYY(coachingLatestWeekKey.split('|')[1]) : coachingLatestWeekKey);
    status.textContent = `Using latest period: Week of ${endDate}`;
    status.style.display = 'block';

    if (!select.dataset.bound) {
        select.addEventListener('change', updateCoachingEmailDisplay);
        select.dataset.bound = 'true';
    }
    if (!generateBtn.dataset.bound) {
        generateBtn.addEventListener('click', generateCoachingPromptAndCopy);
        generateBtn.dataset.bound = 'true';
    }

    const deleteLatestBtn = document.getElementById('deleteLatestCoachingBtn');
    const clearHistoryBtn = document.getElementById('clearCoachingHistoryBtn');
    if (deleteLatestBtn && !deleteLatestBtn.dataset.bound) {
        deleteLatestBtn.addEventListener('click', deleteLatestCoachingEntry);
        deleteLatestBtn.dataset.bound = 'true';
    }
    if (clearHistoryBtn && !clearHistoryBtn.dataset.bound) {
        clearHistoryBtn.addEventListener('click', clearCoachingHistoryForEmployee);
        clearHistoryBtn.dataset.bound = 'true';
    }

    if (outlookBody && outlookBtn && !outlookBody.dataset.bound) {
        outlookBody.addEventListener('input', (e) => {
            const hasContent = e.target.value.trim().length > 0;
            outlookBtn.disabled = !hasContent;
            outlookBtn.style.opacity = hasContent ? '1' : '0.6';
            outlookBtn.style.cursor = hasContent ? 'pointer' : 'not-allowed';
        });
        outlookBody.dataset.bound = 'true';
    }

    if (outlookBtn && !outlookBtn.dataset.bound) {
        outlookBtn.addEventListener('click', generateOutlookEmailFromCoPilot);
        outlookBtn.dataset.bound = 'true';
    }

    
}

function getYearEndEmployees() {
    const employees = new Set();

    Object.entries(weeklyData || {}).forEach(([periodKey, period]) => {
        (period?.employees || []).forEach(emp => {
            if (!emp?.name) return;
            if (isTeamMember(periodKey, emp.name)) {
                employees.add(emp.name);
            }
        });
    });

    Object.values(ytdData || {}).forEach(period => {
        (period?.employees || []).forEach(emp => {
            if (emp?.name) employees.add(emp.name);
        });
    });

    return Array.from(employees).sort();
}

function getLatestYearPeriodForEmployee(employeeName, reviewYear) {
    const yearNum = parseInt(reviewYear, 10);
    if (!employeeName || !Number.isInteger(yearNum)) return null;

    const candidates = [];

    const pushCandidate = (sourceName, periodKey, period) => {
        const employeeRecord = (period?.employees || []).find(emp => emp?.name === employeeName);
        if (!employeeRecord) return;

        const metadata = period?.metadata || {};
        const explicitReviewYear = parseInt(metadata.yearEndReviewYear, 10);
        const endDateText = metadata.endDate || (periodKey.includes('|') ? periodKey.split('|')[1] : '');
        const endDate = endDateText ? new Date(endDateText) : new Date(NaN);
        const matchesReviewYear = (Number.isInteger(explicitReviewYear) && explicitReviewYear === yearNum)
            || (!isNaN(endDate.getTime()) && endDate.getFullYear() === yearNum);
        if (!matchesReviewYear) return;

        const priority = ((sourceName === 'ytdData' || metadata.periodType === 'ytd') ? 2 : 1)
            + (Number.isInteger(explicitReviewYear) && explicitReviewYear === yearNum ? 2 : 0);
        candidates.push({
            sourceName,
            periodKey,
            period,
            employeeRecord,
            endDate,
            priority,
            label: metadata.label || `${metadata.periodType || 'period'} ending ${formatDateMMDDYYYY(endDateText) || endDateText}`
        });
    };

    Object.entries(ytdData || {}).forEach(([periodKey, period]) => pushCandidate('ytdData', periodKey, period));
    Object.entries(weeklyData || {}).forEach(([periodKey, period]) => pushCandidate('weeklyData', periodKey, period));

    if (!candidates.length) return null;

    candidates.sort((a, b) => {
        if (a.endDate.getTime() !== b.endDate.getTime()) {
            return b.endDate.getTime() - a.endDate.getTime();
        }
        return b.priority - a.priority;
    });

    return candidates[0];
}

function buildYearEndMetricSnapshot(employeeRecord, reviewYear, periodMetadata = null) {
    const wins = [];
    const opportunities = [];
    const profileYears = new Set();

    getMetricOrder().forEach(({ key }) => {
        const metricConfig = METRICS_REGISTRY[key];
        const rawValue = employeeRecord?.[key];
        if (!metricConfig || rawValue === null || rawValue === undefined || rawValue === '' || rawValue === 'N/A') return;

        const value = parseFloat(rawValue);
        if (isNaN(value)) return;

        const targetConfig = getYearEndTargetConfig(key, reviewYear, periodMetadata);
        if (!targetConfig || targetConfig.value === undefined || targetConfig.value === null) return;
        if (targetConfig.profileYear) profileYears.add(targetConfig.profileYear);

        const meetsTarget = targetConfig.type === 'min'
            ? value >= targetConfig.value
            : value <= targetConfig.value;

        const entry = {
            key,
            label: metricConfig.label,
            value: formatMetricDisplay(key, value),
            target: formatMetricDisplay(key, targetConfig.value),
            meetsTarget: meetsTarget
        };

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

function initializeYearEndComments() {
    const employeeSelect = document.getElementById('yearEndEmployeeSelect');
    const reviewYearInput = document.getElementById('yearEndReviewYear');
    const status = document.getElementById('yearEndStatus');
    const snapshotPanel = document.getElementById('yearEndSnapshotPanel');
    const promptArea = document.getElementById('yearEndPromptArea');
    const generateBtn = document.getElementById('generateYearEndPromptBtn');
    const copyBtn = document.getElementById('copyYearEndResponseBtn');

    if (!employeeSelect || !reviewYearInput || !status || !snapshotPanel || !promptArea || !generateBtn || !copyBtn) return;

    yearEndDraftContext = null;
    promptArea.value = '';
    snapshotPanel.style.display = 'none';

    if (!reviewYearInput.value) {
        reviewYearInput.value = String(new Date().getFullYear());
    }

    employeeSelect.innerHTML = '<option value="">-- Choose an associate --</option>';
    const employees = getYearEndEmployees();
    employees.forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        employeeSelect.appendChild(option);
    });

    if (!employees.length) {
        status.textContent = 'No employee data found yet. Upload yearly metrics first.';
        status.style.display = 'block';
        renderYearEndAnnualGoalsInputs('', reviewYearInput.value || String(new Date().getFullYear()));
        return;
    }

    status.textContent = `Loaded ${employees.length} associates. Select associate and review year.`;
    status.style.display = 'block';

    if (!employeeSelect.dataset.bound) {
        employeeSelect.addEventListener('change', updateYearEndSnapshotDisplay);
        employeeSelect.dataset.bound = 'true';
    }
    if (!reviewYearInput.dataset.bound) {
        reviewYearInput.addEventListener('input', updateYearEndSnapshotDisplay);
        reviewYearInput.dataset.bound = 'true';
    }
    if (!generateBtn.dataset.bound) {
        generateBtn.addEventListener('click', generateYearEndPromptAndCopy);
        generateBtn.dataset.bound = 'true';
    }
    if (!copyBtn.dataset.bound) {
        copyBtn.addEventListener('click', copyYearEndResponseToClipboard);
        copyBtn.dataset.bound = 'true';
    }

    renderYearEndAnnualGoalsInputs(employeeSelect.value, reviewYearInput.value);
}

function updateYearEndSnapshotDisplay() {
    const employeeName = document.getElementById('yearEndEmployeeSelect')?.value;
    const reviewYear = document.getElementById('yearEndReviewYear')?.value;
    const status = document.getElementById('yearEndStatus');
    const snapshotPanel = document.getElementById('yearEndSnapshotPanel');
    const summary = document.getElementById('yearEndFactsSummary');
    const winsList = document.getElementById('yearEndWinsList');
    const improvementList = document.getElementById('yearEndImprovementList');
    const positivesInput = document.getElementById('yearEndPositivesInput');
    const improvementsInput = document.getElementById('yearEndImprovementsInput');
    const promptArea = document.getElementById('yearEndPromptArea');

    if (!status || !snapshotPanel || !summary || !winsList || !improvementList || !promptArea) return;

    promptArea.value = '';
    winsList.innerHTML = '';
    improvementList.innerHTML = '';
    yearEndDraftContext = null;

    if (!employeeName || !reviewYear) {
        snapshotPanel.style.display = 'none';
        status.textContent = 'Select associate and review year to load year-end facts.';
        status.style.display = 'block';
        return;
    }

    const latestPeriod = getLatestYearPeriodForEmployee(employeeName, reviewYear);
    if (!latestPeriod) {
        snapshotPanel.style.display = 'none';
        status.textContent = `No ${reviewYear} data found for ${employeeName}. Upload ${reviewYear} metrics first.`;
        status.style.display = 'block';
        return;
    }

    renderYearEndAnnualGoalsInputs(employeeName, reviewYear);
    const annualGoals = collectYearEndAnnualGoals(employeeName, reviewYear);
    const { wins, opportunities, targetProfileYear } = buildYearEndMetricSnapshot(
        latestPeriod.employeeRecord,
        reviewYear,
        latestPeriod.period?.metadata
    );
    const endDateText = latestPeriod.period?.metadata?.endDate
        ? formatDateMMDDYYYY(latestPeriod.period.metadata.endDate)
        : formatDateMMDDYYYY(latestPeriod.periodKey.split('|')[1] || latestPeriod.periodKey);

    const profileLabel = targetProfileYear ? `${targetProfileYear} goals` : 'current goals';
    summary.textContent = `${latestPeriod.label} • Source: ${latestPeriod.sourceName === 'ytdData' ? 'YTD upload' : 'Latest period upload'} • Targets: ${profileLabel} • ${wins.length} positives • ${opportunities.length} improvement areas`;

    winsList.innerHTML = wins.length
        ? wins.map(w => `<li>${w.label}: ${w.value} vs target ${w.target}</li>`).join('')
        : '<li>No metrics currently at goal in this period.</li>';

    improvementList.innerHTML = opportunities.length
        ? opportunities.map(o => `<li>${o.label}: ${o.value} vs target ${o.target}</li>`).join('')
        : '<li>No below-target metrics detected in this period.</li>';

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

    yearEndDraftContext = {
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

    status.textContent = `Year-end facts loaded for ${employeeName} (${reviewYear}).`;
    status.style.display = 'block';
    snapshotPanel.style.display = 'block';
}

function generateYearEndPromptAndCopy() {
    const employeeName = document.getElementById('yearEndEmployeeSelect')?.value;
    const reviewYear = document.getElementById('yearEndReviewYear')?.value;
    const trackStatus = document.getElementById('yearEndTrackSelect')?.value;
    const positivesText = document.getElementById('yearEndPositivesInput')?.value.trim() || '';
    const improvementsText = document.getElementById('yearEndImprovementsInput')?.value.trim() || '';
    const managerContext = document.getElementById('yearEndManagerContext')?.value.trim() || '';
    const promptArea = document.getElementById('yearEndPromptArea');
    const button = document.getElementById('generateYearEndPromptBtn');

    if (!employeeName) {
        alert('⚠️ Please select an associate first.');
        return;
    }
    if (!reviewYear) {
        alert('⚠️ Please enter a review year.');
        return;
    }
    if (!trackStatus) {
        alert('⚠️ Please mark whether the associate is on track or off track.');
        return;
    }
    if (!promptArea) return;

    if (!yearEndDraftContext || yearEndDraftContext.employeeName !== employeeName || yearEndDraftContext.reviewYear !== reviewYear) {
        updateYearEndSnapshotDisplay();
    }

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

    const preferredName = getEmployeeNickname(employeeName) || employeeName.split(' ')[0] || employeeName;
    const trackLabel = trackStatus === 'on-track' ? 'On Track' : 'Off Track';
    const periodLabel = yearEndDraftContext?.periodLabel || `${reviewYear} year-end period`;
    const sourceLabel = yearEndDraftContext?.sourceLabel || 'uploaded metrics';
    const targetProfileLabel = yearEndDraftContext?.targetProfileYear
        ? `${yearEndDraftContext.targetProfileYear} year-end goals`
        : 'current metric goals';

    const prompt = `I'm a supervisor preparing year-end comments for ${preferredName} (${employeeName}) for ${reviewYear}.

Use this data source: ${sourceLabel} (${periodLabel}).
Performance classification: ${trackLabel}.
Metric targets to apply: ${targetProfileLabel}.

Positives to highlight:
${positivesText || fallbackPositives || '- Positive impact and steady contribution to the team.'}

Improvement areas needed:
${improvementsText || fallbackImprovements || '- Continue improving consistency in key performance metrics.'}

Additional manager context:
${managerContext || '- None provided.'}

Annual APS goals status (not part of weekly report):
Met goals:
${annualMetText}

Goals needing follow-up:
${annualNotMetText}

Write a polished year-end comment ready to paste into employee notes.

Requirements:
- Professional, warm, and human - not robotic and not overly corporate
- Balance recognition with clear growth expectations
- Mention whether performance is on track or off track naturally
- Highlight positives first, then improvement areas
- Include a future-focused line similar to: "I feel with added focus on these areas, ${preferredName} can improve by ..."
- Include a positive confidence close similar to: "${preferredName} has been a wonderful addition to the team and is poised for success"
- Keep it concise: 2 short paragraphs plus 3-5 bullet points maximum
- Do NOT use em dashes (—)
- Return ONLY the final year-end comment text, nothing else.`;

    promptArea.value = prompt;

    if (button) {
        const originalText = button.textContent;
        button.textContent = '✅ Opening Copilot';
        setTimeout(() => {
            button.textContent = originalText;
        }, 1200);
    }

    openCopilotWithPrompt(prompt, 'Year-End Comments');
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

function updateCoachingEmailDisplay() {
    const employeeName = document.getElementById('coachingEmployeeSelect')?.value;
    const panel = document.getElementById('coachingMetricsPanel');
    const summary = document.getElementById('coachingMetricsSummary');
    const winsList = document.getElementById('coachingWinsList');
    const oppList = document.getElementById('coachingOpportunitiesList');
    const promptArea = document.getElementById('coachingPromptArea');
    const outlookSection = document.getElementById('coachingOutlookSection');
    const outlookBody = document.getElementById('coachingOutlookBody');
    const outlookBtn = document.getElementById('generateOutlookEmailBtn');

    if (!panel || !summary || !winsList || !oppList || !promptArea) return;

    winsList.innerHTML = '';
    oppList.innerHTML = '';
    promptArea.value = '';
    if (outlookSection && outlookBody && outlookBtn) {
        outlookSection.style.display = 'none';
        outlookBody.value = '';
        outlookBtn.disabled = true;
        outlookBtn.style.opacity = '0.6';
        outlookBtn.style.cursor = 'not-allowed';
    }

    if (!employeeName || !coachingLatestWeekKey) {
        panel.style.display = 'none';
        renderCoachingHistory(employeeName);
        return;
    }

    const employeeRecord = weeklyData[coachingLatestWeekKey]?.employees?.find(emp => emp.name === employeeName);
    if (!employeeRecord) {
        panel.style.display = 'none';
        renderCoachingHistory(employeeName);
        return;
    }

    const metricKeys = getMetricOrder().map(m => m.key);
    const wins = [];
    const opportunities = [];

    metricKeys.forEach(key => {
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

        const entry = {
            key: key,
            label: metricConfig.label,
            value: displayValue,
            target: displayTarget
        };

        if (meetsTarget) {
            wins.push(entry);
        } else {
            opportunities.push(entry);
        }
    });

    const endDate = weeklyData[coachingLatestWeekKey]?.metadata?.endDate
        ? formatDateMMDDYYYY(weeklyData[coachingLatestWeekKey].metadata.endDate)
        : (coachingLatestWeekKey.split('|')[1] ? formatDateMMDDYYYY(coachingLatestWeekKey.split('|')[1]) : coachingLatestWeekKey);

    summary.textContent = `Week of ${endDate} • ${wins.length} wins • ${opportunities.length} focus areas`;

    winsList.innerHTML = wins.length
        ? wins.map(w => `<li>${w.label}: ${w.value} vs target ${w.target}</li>`).join('')
        : '<li>No metrics meeting goal in the latest period.</li>';

    oppList.innerHTML = opportunities.length
        ? opportunities.map(o => `<li>${o.label}: ${o.value} vs target ${o.target}</li>`).join('')
        : '<li>No focus areas below target in the latest period.</li>';

    panel.style.display = 'block';
    renderCoachingHistory(employeeName);
}

function generateOutlookEmailFromCoPilot() {
    const outlookBody = document.getElementById('coachingOutlookBody');
    if (!outlookBody) return;

    const emailBody = outlookBody.value.trim();
    if (!emailBody) {
        alert('⚠️ Paste the CoPilot response first.');
        return;
    }

    const summary = window.latestCoachingSummaryData || {};
    const firstName = summary.firstName || '';
    const periodLabel = summary.periodLabel || 'this period';
    const subject = firstName
        ? `Coaching Check-In - ${periodLabel} for ${firstName}`
        : `Coaching Check-In - ${periodLabel}`;

    const buildHtmlFromPlainText = (text) => {
        const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        const paragraphs = escaped.split(/\n\n+/).map(block => {
            const withBreaks = block.replace(/\n/g, '<br>');
            return `<p style="margin: 0 0 12px 0;">${withBreaks}</p>`;
        });
        return `<div style="font-family: Arial, sans-serif; font-size: 11pt; color: #000;">${paragraphs.join('')}</div>`;
    };

    const htmlBody = buildHtmlFromPlainText(emailBody);
    const mailtoLink = `mailto:?subject=${encodeURIComponent(subject)}`;

    if (navigator.clipboard?.write) {
        const item = new ClipboardItem({
            'text/plain': new Blob([emailBody], { type: 'text/plain' }),
            'text/html': new Blob([htmlBody], { type: 'text/html' })
        });
        navigator.clipboard.write([item])
            .then(() => {
                showToast('✅ Email copied with formatting. Paste into Outlook.', 4000);
                window.location.href = mailtoLink;
            })
            .catch(() => {
                navigator.clipboard?.writeText?.(emailBody);
                window.location.href = mailtoLink;
            });
    } else if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(emailBody)
            .then(() => {
                showToast('✅ Email copied. Paste into Outlook.', 4000);
                window.location.href = mailtoLink;
            })
            .catch(() => {
                window.location.href = mailtoLink;
            });
    } else {
        window.location.href = mailtoLink;
    }
}

function renderCoachingHistory(employeeName) {
    const panel = document.getElementById('coachingHistoryPanel');
    const summary = document.getElementById('coachingHistorySummary');
    const list = document.getElementById('coachingHistoryList');

    if (!panel || !summary || !list) return;

    if (!employeeName) {
        panel.style.display = 'none';
        return;
    }

    const history = getCoachingHistoryForEmployee(employeeName);
    if (history.length === 0) {
        summary.textContent = 'No coaching history saved yet.';
        list.innerHTML = '';
        panel.style.display = 'block';
        return;
    }

    const latest = history[0];
    const latestDate = latest.weekEnding ? formatDateMMDDYYYY(latest.weekEnding) || latest.weekEnding : '';
    summary.textContent = `Last coaching: ${latestDate || 'N/A'} · Total coachings: ${history.length}`;

    const formatMetrics = (keys = []) => {
        if (!keys.length) return 'General review';
        return keys
            .map(key => METRICS_REGISTRY[key]?.label || key)
            .slice(0, 4)
            .join(', ');
    };

    const rows = history.slice(0, 5).map(entry => {
        const dateLabel = entry.weekEnding ? formatDateMMDDYYYY(entry.weekEnding) || entry.weekEnding : 'Unknown date';
        const metricsLabel = formatMetrics(entry.metricsCoached);
        const aiLabel = entry.aiAssisted ? ' · AI-assisted' : '';
        return `<li>${dateLabel} — ${metricsLabel}${aiLabel}</li>`;
    });

    list.innerHTML = rows.join('');
    panel.style.display = 'block';
}

function buildCoachingPrompt(employeeRecord) {
    const metricKeys = getMetricOrder().map(m => m.key);
    const wins = [];
    const opportunities = [];
    const usedTips = new Set();

    metricKeys.forEach(key => {
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
        } else {
            const tips = getMetricTips(metricConfig.label);
            let selectedTip = metricConfig.defaultTip;
            if (tips && tips.length > 0) {
                const available = tips.filter(t => !usedTips.has(t));
                selectedTip = (available.length > 0
                    ? available[Math.floor(Math.random() * available.length)]
                    : tips[Math.floor(Math.random() * tips.length)]);
            }
            usedTips.add(selectedTip);
            opportunities.push({ label: metricConfig.label, value: displayValue, target: displayTarget, tip: selectedTip });
        }
    });

    const endDate = weeklyData[coachingLatestWeekKey]?.metadata?.endDate
        ? formatDateMMDDYYYY(weeklyData[coachingLatestWeekKey].metadata.endDate)
        : (coachingLatestWeekKey.split('|')[1] ? formatDateMMDDYYYY(coachingLatestWeekKey.split('|')[1]) : coachingLatestWeekKey);

    const preferredName = getEmployeeNickname(employeeRecord.name);

    const winsText = wins.length
        ? wins.map(w => `- ${w.label}: ${w.value} vs target ${w.target}`).join('\n')
        : '- No metrics meeting goal in this period.';

    const oppText = opportunities.length
        ? opportunities.map(o => `- ${o.label}: ${o.value} vs target ${o.target}\n  Coaching tip: ${o.tip}`).join('\n')
        : '- No metrics below target in this period.';

    return `ROLE

You are a real contact center supervisor writing a weekly coaching check-in email for ${employeeRecord.name}.
This should sound like it is coming directly from their supervisor — warm, human, supportive, and invested in their success.
This is a recurring weekly email.
Assume you have written to this associate before.
Vary wording and structure naturally like a human would.

VOICE & TONE (CRITICAL)

- Warm and empathetic
- Friendly and conversational
- Confident and assured
- Encouraging and forward-looking
- Clear and direct expectations
- Supportive and invested in success
- Authentic supervisor-to-associate connection
- Cheerleading first, coaching second

HARD WRITING RULES

- Do NOT number sections
- Do NOT label sections (no "Key Wins," "Opportunities," etc.)
- Do NOT sound like a report or checklist
- Do NOT use robotic or instructional language
- Do NOT repeat phrasing across bullets
- Do NOT use HR clichés or jargon
- Do NOT use the phrase "This is an opportunity to"
- Do NOT use em dashes (—)
- Write in natural paragraphs with clean, simple bullet points where appropriate

EMAIL FLOW (INTERNAL – DO NOT SHOW)

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
- Tie focus areas to growth and future readiness

OUTPUT REQUIREMENTS

- Address ${preferredName} by name in the opening
- Use clean bullets for metrics (wins and opportunities)
- Show current performance vs target in each bullet
- Pull exactly ONE tip per opportunity metric
- Rewrite tips in natural language—never copy verbatim
- Sound like a real supervisor: natural, human, and supportive
- No numbered sections or labels

DATA FOR THIS EMAIL

Week of ${endDate}

Strengths:
${winsText}

Focus Areas:
${oppText}

DATA RULES

- Only reference metrics and data provided above
- Do not invent feedback or metrics
- Do not assume external factors
- Every tip must relate directly to the data provided

FINAL INSTRUCTION

Generate the coaching email for ${preferredName} now.`;
}

function generateCoachingPromptAndCopy() {
    const employeeName = document.getElementById('coachingEmployeeSelect')?.value;
    const promptArea = document.getElementById('coachingPromptArea');
    const button = document.getElementById('generateCoachingPromptBtn');

    if (!employeeName) {
        alert('⚠️ Please select an associate first.');
        return;
    }

    const employeeRecord = weeklyData[coachingLatestWeekKey]?.employees?.find(emp => emp.name === employeeName);
    if (!employeeRecord) {
        alert('⚠️ No data found for that associate in the latest period.');
        return;
    }

    const prompt = buildCoachingPrompt(employeeRecord);
    promptArea.value = prompt;

    const periodMeta = weeklyData[coachingLatestWeekKey]?.metadata || {};
    const weekEnding = periodMeta.endDate || (coachingLatestWeekKey.split('|')[1] || '');
    const periodLabel = periodMeta.label || (weekEnding ? `Week ending ${formatDateMMDDYYYY(weekEnding)}` : 'this period');
    const preferredName = getEmployeeNickname(employeeRecord.name) || employeeRecord.firstName || employeeRecord.name;
    const reliabilityHours = (() => {
        const parsed = parseFloat(employeeRecord.reliability);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    })();
    const { celebrate, needsCoaching, coachedMetricKeys } = evaluateMetricsForCoaching(employeeRecord);

    window.latestCoachingSummaryData = {
        firstName: preferredName,
        periodLabel,
        celebrate,
        needsCoaching,
        reliabilityHours,
        customNotes: '',
        timeReference: 'this week'
    };

    recordCoachingEvent({
        employeeId: employeeName,
        weekEnding: weekEnding || periodLabel,
        metricsCoached: coachedMetricKeys,
        aiAssisted: true
    });
    renderCoachingHistory(employeeName);
    promptArea.select();
    document.execCommand('copy');

    if (button) {
        const originalText = button.textContent;
        button.textContent = '✅ Copied to CoPilot';
        setTimeout(() => {
            button.textContent = originalText;
        }, 1200);
    }

    const outlookSection = document.getElementById('coachingOutlookSection');
    if (outlookSection) {
        outlookSection.style.display = 'block';
        outlookSection.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    // Open CoPilot
    setTimeout(() => {
        window.open('https://copilot.microsoft.com', '_blank');
    }, 500);
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

function getAssociateSentimentSnapshotForPeriod(associateName, periodMeta) {
    if (!associateName || !associateSentimentSnapshots[associateName]) {
        return null;
    }

    const snapshots = associateSentimentSnapshots[associateName];
    
    console.log(`📊 GET SNAPSHOT DEBUG - Looking for sentiment data for ${associateName}, periodMeta:`, periodMeta);
    console.log(`📊 GET SNAPSHOT DEBUG - associateSentimentSnapshots[${associateName}]:`, snapshots);
    
    // NEW FORMAT: Object with timeframeKeys (startDate_endDate)
    if (!Array.isArray(snapshots)) {
        // Build timeframeKey from period metadata
        const timeframeKey = periodMeta?.startDate && periodMeta?.endDate 
            ? `${periodMeta.startDate}_${periodMeta.endDate}` 
            : null;
        
        console.log(`📊 GET SNAPSHOT DEBUG - Computed timeframeKey: ${timeframeKey}`);
        
        if (!timeframeKey || !snapshots[timeframeKey]) {
            console.log(`📊 GET SNAPSHOT DEBUG - No exact match, searching for overlapping timeframes`);
            // No exact match - try to find overlapping timeframe
            const periodStart = parseDateForComparison(periodMeta?.startDate);
            const periodEnd = parseDateForComparison(periodMeta?.endDate);
            
            if (periodStart && periodEnd) {
                const allKeys = Object.keys(snapshots);
                for (const key of allKeys) {
                    const [snapStartStr, snapEndStr] = key.split('_');
                    const snapStart = parseDateForComparison(snapStartStr);
                    const snapEnd = parseDateForComparison(snapEndStr);
                    if (snapStart && snapEnd && snapStart <= periodEnd && snapEnd >= periodStart) {
                        console.log(`📊 GET SNAPSHOT DEBUG - Found overlapping snapshot with key: ${key}`);
                        const formattedSnapshot = formatSentimentSnapshotForPrompt(snapshots[key], snapStartStr, snapEndStr);
                        console.log(`📊 GET SNAPSHOT DEBUG - Returning formatted snapshot:`, formattedSnapshot);
                        return formattedSnapshot;
                    }
                }
            }
            console.log(`📊 GET SNAPSHOT DEBUG - No snapshot found`);
            return null;
        }
        
        // Exact match found
        console.log(`📊 GET SNAPSHOT DEBUG - Exact match found for key: ${timeframeKey}`);
        const exactSnapshot = snapshots[timeframeKey];
        console.log(`📊 GET SNAPSHOT DEBUG - Raw snapshot data:`, exactSnapshot);
        const formattedSnapshot = formatSentimentSnapshotForPrompt(exactSnapshot, periodMeta.startDate, periodMeta.endDate);
        console.log(`📊 GET SNAPSHOT DEBUG - Formatted snapshot after formatSentimentSnapshotForPrompt:`, formattedSnapshot);
        return formattedSnapshot;
    }
    
    // LEGACY FORMAT: Array of snapshots
    if (snapshots.length === 0) {
        return null;
    }

    const periodStart = parseDateForComparison(periodMeta?.startDate);
    const periodEnd = parseDateForComparison(periodMeta?.endDate);

    if (!periodStart || !periodEnd) {
        return snapshots[0] || null;
    }

    const overlapping = snapshots
        .map(snapshot => {
            const snapStart = parseDateForComparison(snapshot.timeframeStart);
            const snapEnd = parseDateForComparison(snapshot.timeframeEnd);
            if (!snapStart || !snapEnd) return null;
            const overlaps = snapStart <= periodEnd && snapEnd >= periodStart;
            if (!overlaps) return null;
            const overlapStart = snapStart > periodStart ? snapStart : periodStart;
            const overlapEnd = snapEnd < periodEnd ? snapEnd : periodEnd;
            const overlapMs = Math.max(0, overlapEnd.getTime() - overlapStart.getTime());
            return { snapshot, overlapMs };
        })
        .filter(Boolean)
        .sort((a, b) => {
            if (b.overlapMs !== a.overlapMs) return b.overlapMs - a.overlapMs;
            return new Date(b.snapshot.savedAt).getTime() - new Date(a.snapshot.savedAt).getTime();
        });

    return overlapping.length > 0 ? overlapping[0].snapshot : snapshots[0] || null;
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

function generateSentimentSummary() {
    const { positive, negative, emotions } = sentimentReports;
    
    // Validation: ensure all 3 files uploaded
    if (!positive || !negative || !emotions) {
        alert('⚠️ Please upload all 3 files (Positive Language, Avoiding Negative Language, Managing Emotions)');
        return;
    }
    
    // Extract associate name (should be same across all files)
    const associateName = positive.associateName || negative.associateName || emotions.associateName || 'Unknown Associate';
    
    // Extract date range (should be same across all files)
    const startDate = positive.startDate || negative.startDate || emotions.startDate || 'N/A';
    const endDate = positive.endDate || negative.endDate || emotions.endDate || 'N/A';
    const dateRange = `${startDate} – ${endDate}`;
    
    // Build summary according to specification
    let summary = '';
    summary += `Associate: ${escapeHtml(associateName)}\n`;
    summary += `Date Range: ${escapeHtml(dateRange)}\n\n`;
    
    // POSITIVE LANGUAGE Section
    summary += `═══════════════════════════════════\n`;
    summary += `POSITIVE LANGUAGE\n`;
    summary += `═══════════════════════════════════\n`;
    summary += `Keywords Summary (phrases used)\n\n`;
    
    // Phrases they DID use well
    const posUsedPhrases = positive.phrases
        .filter(p => p.value > 0 && !containsCurseWords(p.phrase))
        .sort((a, b) => b.value - a.value);
    if (posUsedPhrases.length > 0) {
        summary += `✓ DOING WELL - You used these positive words/phrases:\n`;
        posUsedPhrases.slice(0, SENTIMENT_TOP_WINS_COUNT).forEach(p => {
            summary += `  • "${censorCurseWords(p.phrase)}" - ${p.value} calls\n`;
        });
        if (posUsedPhrases.length > SENTIMENT_TOP_WINS_COUNT) {
            summary += `  [... and ${posUsedPhrases.length - SENTIMENT_TOP_WINS_COUNT} more positive phrases]\n`;
        }
    } else {
        summary += `✓ DOING WELL:\n`;
        summary += `  • No strong positive phrases detected in this period\n`;
    }
    summary += `\n`;
    
    // Phrases they COULD use more
    const posUnusedPhrases = positive.phrases
        .filter(p => p.value === 0 && !containsCurseWords(p.phrase))
        .sort((a, b) => a.value - b.value);
    if (posUnusedPhrases.length > 0) {
        summary += `⬆ INCREASE YOUR SCORE - Try using these phrases more often:\n`;
        posUnusedPhrases.slice(0, SENTIMENT_BOTTOM_COUNT).forEach(p => {
            summary += `  • "${censorCurseWords(p.phrase)}"\n`;
        });
    }
    summary += `\n`;
    
    // Scripted Opening with Positive Language
    summary += `📝 SCRIPTED OPENING (with positive language):\n`;
    summary += `  "Hello! Thank you for calling. My name is ${escapeHtml(associateName)}. I'm here to\n`;
    summary += `   help you and I appreciate the opportunity to assist you today."\n\n`;
    
    // Scripted Ownership Statement
    summary += `📝 OWNERSHIP STATEMENT (take responsibility):\n`;
    summary += `  "I understand this is important to you. I'm going to take ownership of\n`;
    summary += `   this and personally ensure we get this resolved for you."\n\n`;
    
    // Scripted Closing with Positive Language
    summary += `📝 SCRIPTED CLOSING (with positive language):\n`;
    summary += `  "I truly appreciate you taking the time to work with me on this. We've\n`;
    summary += `   accomplished great things together today, and I'm delighted we could help."\n\n`;
    
    // AVOIDING NEGATIVE LANGUAGE Section
    summary += `═══════════════════════════════════\n`;
    summary += `AVOIDING NEGATIVE LANGUAGE\n`;
    summary += `═══════════════════════════════════\n`;
    summary += `Keywords Summary (phrases used)\n\n`;
    
    // Separate associate negative from customer negative
    const assocNegative = negative.phrases.filter(p => p.speaker === 'A' && p.value > 0 && !containsCurseWords(p.phrase));
    const assocNegativeUnused = negative.phrases.filter(p => p.speaker === 'A' && p.value === 0 && !containsCurseWords(p.phrase));
    const custNegative = negative.phrases.filter(p => p.speaker === 'C' && p.value > 0 && !containsCurseWords(p.phrase));
    
    if (assocNegative.length === 0) {
        summary += `✓ EXCELLENT - Minimal negative language in your calls\n`;
        summary += `  • You're avoiding negative words effectively\n`;
    } else {
        summary += `⚠ PHRASES YOU USED - These came out in your calls, avoid them:\n`;
        assocNegative.sort((a, b) => b.value - a.value).forEach(p => {
            summary += `  • "${censorCurseWords(p.phrase)}" - used ${p.value} times\n`;
        });
    }
    summary += `\n`;
    
    if (assocNegativeUnused.length > 0) {
        summary += `🛡 WATCH OUT - Database phrases you haven't used yet (prevent bad habits):\n`;
        assocNegativeUnused.slice(0, SENTIMENT_BOTTOM_COUNT).forEach(p => {
            summary += `  • "${censorCurseWords(p.phrase)}" - Don't let this slip in\n`;
        });
    }
    summary += `\n`;
    
    // Map of negative phrases to positive replacements
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
    
    summary += `✅ POSITIVE ALTERNATIVES - Say these instead:\n`;
    if (assocNegative.length > 0) {
        assocNegative.sort((a, b) => b.value - a.value).slice(0, 3).forEach(p => {
            const phrase = p.phrase.toLowerCase().replace(/[^a-z0-9\s]/g, '');
            const replacement = Object.entries(negativeReplacements).find(([key]) => phrase.includes(key))?.[1];
            if (replacement) {
                summary += `  • Instead of "${censorCurseWords(p.phrase)}" → "${replacement}"\n`;
            }
        });
    } else {
        summary += `  • "I understand your concern, here's how I can help"\n`;
        summary += `  • "Let me find a solution for you"\n`;
        summary += `  • "I appreciate you working with me on this"\n`;
    }
    summary += `\n`;
    
    if (custNegative.length > 0) {
        summary += `📌 CUSTOMER CONTEXT - They said (understand their frustration):\n`;
        custNegative.sort((a, b) => b.value - a.value).slice(0, SENTIMENT_CUSTOMER_CONTEXT_COUNT).forEach(p => {
            summary += `  • "${censorCurseWords(p.phrase)}" - detected ${p.value} times\n`;
        });
        summary += `  → Acknowledge their concern, don't make excuses\n`;
    }
    summary += `\n`;
    
    summary += `📝 SCRIPTED RESPONSE (when customer is frustrated):\n`;
    summary += `  "I hear your frustration, and I completely understand. I'm committed to\n`;
    summary += `   finding a solution for you right now. Let me see what I can do for you."\n\n`;
    
    // MANAGING EMOTIONS Section
    summary += `═══════════════════════════════════\n`;
    summary += `MANAGING EMOTIONS\n`;
    summary += `═══════════════════════════════════\n`;
    summary += `Coverage: ${emotions.callsDetected} / ${emotions.totalCalls} calls (${emotions.percentage}%)\n\n`;
    
    const emotionUsedPhrases = emotions.phrases.filter(p => p.value > 0 && !containsCurseWords(p.phrase));
    const emotionUnusedPhrases = emotions.phrases.filter(p => p.value === 0 && !containsCurseWords(p.phrase));
    
    if (emotionUsedPhrases.length === 0 || emotions.percentage <= SENTIMENT_EMOTION_LOW_THRESHOLD) {
        summary += `✓ STRONG PERFORMANCE - You're managing customer emotions effectively\n`;
        summary += `  • Low emotion escalation (${emotions.percentage}%) - Calming presence detected\n`;
    } else {
        summary += `📌 EMOTION INDICATORS DETECTED - Customer emotional phrases in calls:\n`;
        emotionUsedPhrases.sort((a, b) => b.value - a.value).forEach(p => {
            summary += `  • "${censorCurseWords(p.phrase)}" - detected in ${p.value} calls\n`;
        });
    }
    summary += `\n`;
    
    if (emotionUnusedPhrases.length > 0) {
        summary += `🛡 WATCH OUT - Emotion phrases to prevent (haven't shown up yet):\n`;
        emotionUnusedPhrases.slice(0, SENTIMENT_BOTTOM_COUNT).forEach(p => {
            summary += `  • "${censorCurseWords(p.phrase)}" - Avoid letting this develop\n`;
        });
    }
    summary += `\n`;
    
    summary += `✅ TECHNIQUES TO MASTER - How to manage emotions:\n`;
    summary += `  • Acknowledge their feelings first: "I can hear the frustration in your voice"\n`;
    summary += `  • Show you understand: "If I were in your position, I'd feel the same way"\n`;
    summary += `  • Don't interrupt or talk over them - let them finish\n`;
    summary += `  • Take action, not excuses: "Here's exactly what I'm going to do..."\n`;
    summary += `  • Follow up: "I'll personally make sure this gets resolved for you"\n`;
    summary += `\n`;
    
    summary += `📝 SCRIPTED RESPONSE (when emotion is high):\n`;
    summary += `  "I completely understand your frustration. I'm listening to you, and I want\n`;
    summary += `   you to know I'm going to take personal ownership of this. Let me get this\n`;
    summary += `   resolved for you right now. Here's what I can do..."\n\n`;
    
    // Display the summary
    document.getElementById('sentimentSummaryText').textContent = summary;
    document.getElementById('sentimentSummaryOutput').style.display = 'block';
    
    showToast('✅ Summary generated successfully', 2000);
}

function parseSentimentFile(fileType, lines) {
    // Parse the "English Speech – Charts Report" format
    console.log(`📊 PARSE START - fileType=${fileType}, total lines=${lines.length}`);
    console.log(`📊 PARSE START - First 10 lines:`, lines.slice(0, 10));
    
    const report = {
        associateName: '',
        startDate: '',
        endDate: '',
        totalCalls: 0,
        callsDetected: 0,
        percentage: 0,
        phrases: [],
        inKeywordsSection: false  // Track which Interactions line we used
    };
    
    let inKeywordsSection = false;
    let pendingPhrase = null; // For handling phrase/value on separate lines
    let allInteractionsMatches = []; // Track ALL Interactions lines found
    
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Extract associate name: look for "Employee:", "Agent:", or "Name:"
        // But NOT if line is just "Name" (which is the keywords header)
        if (!report.associateName && line.length > 10) {
            const nameMatch = line.match(/^(?:Employee|Agent|Name)[:\s]+(.+)$/i);
            if (nameMatch) {
                report.associateName = nameMatch[1].trim();
            }
        }
        
        // Extract start date - handle multiple formats including Excel CSV with quotes/commas
        if (!report.startDate) {
            if (line.toLowerCase().includes('start date')) {
                // Handle: "Start date:,"1/25/2026, 12:00 AM",," or "Start date: 1/25/2026"
                const startMatch = line.match(/start\s+date[:\s,]*"?([0-9]{1,2}[/\-][0-9]{1,2}[/\-][0-9]{2,4})/i);
                if (startMatch) {
                    report.startDate = startMatch[1].trim();
                    console.log(`✅ Found start date: ${report.startDate}`);
                } else {
                    console.warn(`⚠️ Found "start date" line but couldn't parse: "${line}"`);
                }
            }
        }
        
        // Extract end date - handle multiple formats including Excel CSV with quotes/commas
        if (!report.endDate) {
            if (line.toLowerCase().includes('end date')) {
                // Handle: "End date:,"1/31/2026, 11:59 PM",," or "End date: 1/31/2026"
                const endMatch = line.match(/end\s+date[:\s,]*"?([0-9]{1,2}[/\-][0-9]{1,2}[/\-][0-9]{2,4})/i);
                if (endMatch) {
                    report.endDate = endMatch[1].trim();
                    console.log(`✅ Found end date: ${report.endDate}`);
                } else {
                    console.warn(`⚠️ Found "end date" line but couldn't parse: "${line}"`);
                }
            }
        }
        
        // Extract total calls and calls with category detected
        // Format in Excel CSV: "Interactions:,165 (76% out of 218 matching data filter),,"
        console.log(`📊 PARSE DEBUG [fileType=${fileType}] - Line ${i}: "${line}"`);
        const interactionsMatch = line.match(/Interactions:?,?\s*(\d+)\s*\(.*?(\d+)%.*?out\s+of\s+(\d+)/i);
        if (interactionsMatch) {
            const callsDetected = parseInt(interactionsMatch[1]);
            const percentage = parseInt(interactionsMatch[2]);
            const totalCalls = parseInt(interactionsMatch[3]);
            
            console.log(`📊 PARSE DEBUG - FOUND Interactions at line ${i}: ${percentage}% (inKeywordsSection=${inKeywordsSection})`);
            allInteractionsMatches.push({
                lineIndex: i,
                lineContent: line,
                callsDetected: callsDetected,
                percentage: percentage,
                totalCalls: totalCalls,
                inKeywordsSection: inKeywordsSection
            });
            
            // UPDATED LOGIC: Accept Interactions lines that appear AFTER keywords section
            // BUT also accept the LAST Interactions line found even if no Keywords section (fallback)
            if (inKeywordsSection && !report.inKeywordsSection) {
                // Keywords section found - use this data
                report.callsDetected = callsDetected;
                report.percentage = percentage;
                report.totalCalls = totalCalls;
                report.inKeywordsSection = true;
                console.log(`✅ SET METRICS (in keywords section): ${callsDetected} detected, ${totalCalls} total, ${percentage}%`);
            } else if (!inKeywordsSection && !report.inKeywordsSection) {
                // No keywords section found yet - tentatively use this (will be overwritten if keywords section appears later)
                report.callsDetected = callsDetected;
                report.percentage = percentage;
                report.totalCalls = totalCalls;
                console.log(`⚠️ TENTATIVE METRICS (no keywords section yet): ${callsDetected} detected, ${totalCalls} total, ${percentage}%`);
            }
            continue;
        }
        
        // Detect keywords section
        if (line.toLowerCase().includes('keywords') || line.toLowerCase().includes('query result metrics')) {
            inKeywordsSection = true;
            console.log(`✅ Found keywords section at line ${i}`);
            continue;
        }
        
        // Skip "Name" and "Value" header lines
        if (line.trim() === 'Name' || line.trim() === 'Value' || line.match(/^Name,Value/i)) {
            console.log(`Skipping header line: "${line}"`);
            continue;
        }
        
        // Parse keyword phrases - handling BOTH formats
        if (inKeywordsSection && report.totalCalls > 0) {
            // Format 1: CSV with comma separator: "+(A:absolutely),83"
            const csvQuotedMatch = line.match(/^"([^"]+(?:""[^"]+)*)",(\d+)/);
            if (csvQuotedMatch) {
                let rawPhrase = csvQuotedMatch[1].replace(/""/g, '"').trim();
                const value = parseInt(csvQuotedMatch[2]);
                
                // Extract speaker (A or C) and phrase
                const extracted = extractSentimentSpeakerAndPhrase(rawPhrase);
                if (extracted) {
                    report.phrases.push({ phrase: extracted.phrase, value, speaker: extracted.speaker });
                }
                continue;
            }
            
            const csvMatch = line.match(/^([^,]+),(\d+)$/);
            if (csvMatch) {
                let rawPhrase = csvMatch[1].trim();
                const value = parseInt(csvMatch[2]);
                
                // Extract speaker and phrase
                const extracted = extractSentimentSpeakerAndPhrase(rawPhrase);
                if (extracted) {
                    report.phrases.push({ phrase: extracted.phrase, value, speaker: extracted.speaker });
                } else {
                    const cleanPhrase = rawPhrase.replace(/^"(.*)"$/, '$1');
                    report.phrases.push({ phrase: cleanPhrase, value, speaker: 'A' });
                }
                continue;
            }
            
            // Format 2: Phrase on one line, value on next line
            // Check if current line is a phrase (starts with + or contains parentheses)
            if (line.match(/^[+\-#]/)) {
                pendingPhrase = line.trim();
                continue;
            }
            
            // Check if current line is just a number (the value for the previous phrase)
            if (pendingPhrase && line.match(/^\d+$/)) {
                const value = parseInt(line.trim());
                
                // Extract speaker and phrase
                const extracted = extractSentimentSpeakerAndPhrase(pendingPhrase);
                if (extracted) {
                    report.phrases.push({ phrase: extracted.phrase, value, speaker: extracted.speaker });
                } else {
                    // Fallback: try simpler extraction
                    const simpleMatch = pendingPhrase.match(/[+\-#]\s*\(([AC]):\s*"?([^")]+)"?\)/i);
                    if (simpleMatch) {
                        const speaker = simpleMatch[1].toUpperCase();
                        const cleanPhrase = simpleMatch[2].trim();
                        report.phrases.push({ phrase: cleanPhrase, value, speaker });
                    }
                }
                pendingPhrase = null;
                continue;
            }
        }
    }
    
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
    
    // Collect all unique employee names from weeklyData
    for (const weekKey in weeklyData) {
        const week = weeklyData[weekKey];
        if (week.employees && Array.isArray(week.employees)) {
            week.employees.forEach(emp => {
                if (emp.name && isTeamMember(weekKey, emp.name)) {
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
    
    // Goals from METRICS_REGISTRY
    const POSITIVE_GOAL = 86; // positiveWord target
    const NEGATIVE_GOAL = 83; // negativeWord target (higher = better at avoiding)
    const EMOTIONS_GOAL = 95; // managingEmotions target
    
    // Build data summary for CoPilot
    let dataSummary = `DATA SUMMARY:\n\n`;
    dataSummary += `POSITIVE LANGUAGE: ${positive.callsDetected}/${positive.totalCalls} calls (${positive.percentage}%)\n`;
    dataSummary += `Goal: ${POSITIVE_GOAL}% | Status: ${positive.percentage >= POSITIVE_GOAL ? '✓ Met goal' : '✗ Below goal'}\n`;
    dataSummary += `Top 5 positive phrases they're using:\n`;
    const topPos = positive.phrases
        .filter(p => p.value > MIN_PHRASE_VALUE)
        .sort((a, b) => b.value - a.value)
        .slice(0, TOP_PHRASES_COUNT);
    topPos.forEach(p => {
        const percentageOfCalls = ((p.value / positive.totalCalls) * 100).toFixed(0);
        dataSummary += `  • "${escapeHtml(p.phrase)}" (${p.value}x / ${percentageOfCalls}% of calls)\n`;
    });
    dataSummary += `\n→ COACHING TIP: Encourage them to use these positive phrases on MORE calls (aim for 100% usage).\n`;
    
    dataSummary += `\nAVOIDING NEGATIVE: ${negative.callsDetected}/${negative.totalCalls} calls (${negative.percentage}%)\n`;
    dataSummary += `Goal: ${NEGATIVE_GOAL}% | Status: ${negative.percentage >= NEGATIVE_GOAL ? '✓ Met goal' : '✗ Below goal'}\n`;
    const assocNeg = negative.phrases
        .filter(p => p.speaker === 'A' && p.value > MIN_PHRASE_VALUE)
        .sort((a, b) => b.value - a.value)
        .slice(0, TOP_PHRASES_COUNT);
    if (assocNeg.length > 0) {
        dataSummary += `Top 5 negative words associate said (MUST ELIMINATE):\n`;
        assocNeg.forEach(p => {
            dataSummary += `  • "${escapeHtml(p.phrase)}" (${p.value}x)\n`;
        });
        dataSummary += `\n→ COACHING TIP: These words must be removed from their vocabulary completely. Replace with positive alternatives.\n`;
    } else {
        dataSummary += `  ✓ Minimal negative language detected\n`;
    }
    
    dataSummary += `\nMANAGING EMOTIONS: ${emotions.callsDetected}/${emotions.totalCalls} calls (${emotions.percentage}%)\n`;
    dataSummary += `Goal: ${EMOTIONS_GOAL}% | Status: ${emotions.percentage >= EMOTIONS_GOAL ? '✓ Met goal' : '✗ Below goal'}\n`;
    const emoDetected = emotions.phrases
        .filter(p => p.value > MIN_PHRASE_VALUE)
        .sort((a, b) => b.value - a.value)
        .slice(0, TOP_PHRASES_COUNT);
    if (emoDetected.length > 0) {
        dataSummary += `Customer emotional phrases detected:\n`;
        emoDetected.forEach(p => {
            dataSummary += `  • "${escapeHtml(p.phrase)}" (${p.value}x)\n`;
        });
    } else {
        dataSummary += `  ✓ Low emotional indicators detected\n`;
    }
    
    // Extract date range for subject line (use individual dates from report)
    const startDate = positive.startDate || 'Unknown';
    const endDate = positive.endDate || 'Unknown';
    
    const prompt = `Write a brief coaching email to ${associateName} using bullet points.

SUBJECT LINE: Sentiment Summary - ${startDate} - ${endDate}

${dataSummary}

KEY COACHING POINTS TO INCLUDE:

1. POSITIVE LANGUAGE: Recognize the good phrases they're using. Encourage them to use these phrases on EVERY call (100% usage rate), not just some calls.

2. NEGATIVE LANGUAGE: These words MUST be completely eliminated from their vocabulary. Help them identify positive alternatives to replace these negative words.

3. Use the actual numbers and percentages from the data above.

FORMAT:

WHAT'S GOING WELL:
* Highlight 2-3 positive phrases they're using effectively
* Mention their current usage rate

AREA TO FOCUS ON:
* Address the negative language that needs elimination
* Be specific about which words to remove

CONCRETE ACTION FOR THIS WEEK:
* Challenge them to use positive phrases on MORE calls (aim for 100%)
* Give them 1-2 positive alternatives for the negative words they're saying

CLOSING:
* End with confidence and encouragement

Keep it under 200 words. Real tone, no corporate speak. Be direct but supportive.`;
    
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








