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
let weeklyData = {};
let ytdData = {};
let currentPeriodType = 'week';
let currentPeriod = null;
let myTeamMembers = {}; // Stores selected team members by weekKey: { "2026-01-24|2026-01-20": ["Alyssa", "John", ...] }
let coachingLatestWeekKey = null;
let coachingHistory = {};
let debugState = { entries: [] };

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
        target: { type: 'min', value: 80 },
        unit: '%',
        columnIndex: 15,
        chartType: 'line',
        chartColor: '#4CAF50',
        defaultTip: "CX Rep Overall: Customers appreciate your service! Keep building those strong relationships through empathy and professionalism."
    },
    fcr: {
        key: 'fcr',
        label: 'First Call Resolution',
        icon: '✅',
        target: { type: 'min', value: 70 },
        unit: '%',
        columnIndex: 13,
        chartType: 'line',
        chartColor: '#FF5722',
        defaultTip: "First Call Resolution: You're doing well! Continue focusing on resolving issues on the first contact whenever possible."
    },
    overallExperience: {
        key: 'overallExperience',
        label: 'Overall Experience',
        icon: '⭐',
        target: { type: 'min', value: 81 },
        unit: '%',
        columnIndex: 17,
        chartType: null,
        chartColor: null,
        defaultTip: "Overall Experience: Great job creating positive experiences! Continue to personalize your interactions."
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
        defaultTip: "Overall Sentiment: Keep up the positive tone in your interactions. It makes a big difference!"
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
        defaultTip: "Positive Word Usage: Your positive language is appreciated! Continue using encouraging and supportive words."
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
        defaultTip: "Avoiding Negative Words: You're doing great at keeping conversations positive. Keep it up!"
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
        defaultTip: "Managing Emotions: You're doing great here! Keep maintaining composure even during challenging interactions."
    },
    aht: {
        key: 'aht',
        label: 'Average Handle Time',
        icon: '⏱️',
        target: { type: 'max', value: 440 },
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
    const subSections = ['subSectionCoachingEmail', 'subSectionSentiment', 'subSectionMetricTrends', 'subSectionTrendIntelligence'];
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
    const subNavButtons = ['subNavCoachingEmail', 'subNavSentiment', 'subNavMetricTrends', 'subNavTrendIntelligence'];
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
    const subSections = ['subSectionTeamData', 'subSectionCoachingTips'];
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
    const subNavButtons = ['subNavTeamData', 'subNavCoachingTips'];
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
            populateDeleteWeekDropdown();
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
    if (debugState.entries.length > 50) {
        debugState.entries = debugState.entries.slice(-50);
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
        const value = localStorage.getItem(key);
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
        const nicknames = JSON.parse(localStorage.getItem('employeeNicknames') || '{}');
        nicknames[employeeFullName] = nickname;
        localStorage.setItem('employeeNicknames', JSON.stringify(nicknames));
    } catch (error) {
        console.error('Error saving nickname:', error);
    }
}

function getSavedNickname(employeeFullName) {
    try {
        const nicknames = JSON.parse(localStorage.getItem('employeeNicknames') || '{}');
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
    
    
    // Skip the header line - we don't need to parse it since we use positional logic
    // We just validate that the first row looks like a header
    const headerLine = lines[0];
    const hasNameHeader = headerLine.toLowerCase().includes('name');
    
    if (!hasNameHeader) {
        throw new Error('ℹ️ Header row not found! Make sure to include the header row at the top of your pasted data.');
    }
    
    
    // Parse employee data
    const employees = [];
    
    for (let i = 1; i < lines.length; i++) {
        const rawRow = lines[i];
        
        if (!rawRow.trim()) continue; // Skip empty lines
        
        let cells;
        try {
            // Use the smart PowerBI row parser
            const parsed = parsePowerBIRow(rawRow);
            cells = parsed;
        } catch (error) {
            
            continue;
        }
        
        // Validate we have 22 cells
        if (cells.length !== 22) {
            if (cells.length < 22) {
                while (cells.length < 22) {
                    cells.push(null);
                }
            } else {
                cells = cells.slice(0, 22);
            }
        }
        
        // Extract name parts for display
        const nameField = cells[0];
        let firstName = '', lastName = '';
        
        // Try parsing "LastName, FirstName" format
        const lastFirstMatch = nameField.match(/^([^,]+),\s*(.+)$/);
        if (lastFirstMatch) {
            lastName = lastFirstMatch[1].trim();
            firstName = lastFirstMatch[2].trim();
        } else {
            // Fallback: "FirstName LastName" format
            const parts = nameField.trim().split(/\s+/);
            if (parts.length >= 2) {
                firstName = parts[0];
                lastName = parts.slice(1).join(' ');
            } else if (parts.length === 1) {
                firstName = parts[0];
            }
        }
        
        const displayName = `${firstName} ${lastName}`.trim();
        
        
        // Direct positional access using COLUMN_MAPPING
        const getCell = (colIndex) => {
            const value = cells[colIndex];
            return (value === null || value === undefined) ? '' : value;
        };
        
        // Parse critical numeric fields with validation (using column positions)
        const surveyTotalRaw = getCell(17); // OE Survey Total at position 17
        const totalCallsRaw = getCell(1);   // TotalCallsAnswered at position 1
        
        const surveyTotal = Number.isInteger(parseInt(surveyTotalRaw, 10)) ? parseInt(surveyTotalRaw, 10) : 0;
        const parsedTotalCalls = parseInt(totalCallsRaw, 10);
        if (!Number.isInteger(parsedTotalCalls)) {
            continue; // skip rows without numeric total calls (absent employees)
        }
        let totalCalls = parsedTotalCalls;
        
        const employeeData = {
            name: displayName,
            firstName: firstName,
            scheduleAdherence: parsePercentage(getCell(METRICS_REGISTRY.scheduleAdherence.columnIndex)) || 0,
            cxRepOverall: parseSurveyPercentage(getCell(METRICS_REGISTRY.cxRepOverall.columnIndex)),
            fcr: parseSurveyPercentage(getCell(METRICS_REGISTRY.fcr.columnIndex)),
            overallExperience: parseSurveyPercentage(getCell(METRICS_REGISTRY.overallExperience.columnIndex)),
            transfers: parsePercentage(getCell(METRICS_REGISTRY.transfers.columnIndex)) || 0,
            transfersCount: parseInt(getCell(METRICS_REGISTRY.transfersCount.columnIndex)) || 0,
            aht: parseSeconds(getCell(METRICS_REGISTRY.aht.columnIndex)) || '',
            talkTime: parseSeconds(getCell(5)) || '',
            acw: parseSeconds(getCell(METRICS_REGISTRY.acw.columnIndex)),
            holdTime: parseSeconds(getCell(METRICS_REGISTRY.holdTime.columnIndex)),
            reliability: parseHours(getCell(METRICS_REGISTRY.reliability.columnIndex)) || 0,
            overallSentiment: parsePercentage(getCell(METRICS_REGISTRY.overallSentiment.columnIndex)) || '',
            positiveWord: parsePercentage(getCell(METRICS_REGISTRY.positiveWord.columnIndex)) || '',
            negativeWord: parsePercentage(getCell(METRICS_REGISTRY.negativeWord.columnIndex)) || '',
            managingEmotions: parsePercentage(getCell(METRICS_REGISTRY.managingEmotions.columnIndex)) || '',
            surveyTotal: surveyTotal,
            totalCalls: totalCalls
        };
        
        // Data integrity check: surveyTotal cannot exceed totalCalls
        if (employeeData.surveyTotal > employeeData.totalCalls && employeeData.totalCalls > 0) {
            console.warn(`?? DATA INTEGRITY: ${displayName}: surveyTotal (${employeeData.surveyTotal}) > totalCalls (${employeeData.totalCalls}). Invalidating totalCalls.`);
            employeeData.totalCalls = 0;
        }
        
        if (i <= 3) {
            
            
            
            
            
        }
        
        employees.push(employeeData);
    }
    
    
    return employees;
}

// ============================================
// DATA LOADING - EXCEL FILES
// ============================================



// ============================================
// TIPS MANAGEMENT
// ============================================

async function loadServerTips() {
    try {
        const response = await fetch('tips.csv');
        const csv = await response.text();
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
        const modifiedServerTips = JSON.parse(localStorage.getItem('modifiedServerTips') || '{}');
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
        const deletedServerTips = JSON.parse(localStorage.getItem('deletedServerTips') || '{}');
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
        const saved = localStorage.getItem('userCustomTips');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading user tips:', error);
        return {};
    }
}

function saveUserTips(tips) {
    try {
        localStorage.setItem('userCustomTips', JSON.stringify(tips));
    } catch (error) {
        console.error('Error saving user tips:', error);
    }
}

function loadCustomMetrics() {
    try {
        const saved = localStorage.getItem('customMetrics');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading custom metrics:', error);
        return {};
    }
}

function saveCustomMetrics(metrics) {
    try {
        localStorage.setItem('customMetrics', JSON.stringify(metrics));
    } catch (error) {
        console.error('Error saving custom metrics:', error);
    }
}

function normalizeMetricKey(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}


// ============================================
// STORAGE FUNCTIONS
// ============================================

function loadWeeklyData() {
    try {
        const saved = localStorage.getItem('weeklyData');
        const data = saved ? JSON.parse(saved) : {};
        return data;
    } catch (error) {
        console.error('Error loading weekly data:', error);
        return {};
    }
}

function saveWeeklyData() {
    try {
        const dataToSave = JSON.stringify(weeklyData);
        localStorage.setItem('weeklyData', dataToSave);
    } catch (error) {
        console.error('Error saving weekly data:', error);
    }
}

function loadYtdData() {
    try {
        const saved = localStorage.getItem('ytdData');
        const data = saved ? JSON.parse(saved) : {};
        return data;
    } catch (error) {
        console.error('Error loading YTD data:', error);
        return {};
    }
}

function saveYtdData() {
    try {
        const dataToSave = JSON.stringify(ytdData);
        localStorage.setItem('ytdData', dataToSave);
    } catch (error) {
        console.error('Error saving YTD data:', error);
    }
}

function loadCoachingHistory() {
    try {
        const saved = localStorage.getItem('coachingHistory');
        const data = saved ? JSON.parse(saved) : {};
        return data;
    } catch (error) {
        console.error('Error loading coaching history:', error);
        return {};
    }
}

function saveCoachingHistory() {
    try {
        const dataToSave = JSON.stringify(coachingHistory);
        localStorage.setItem('coachingHistory', dataToSave);
    } catch (error) {
        console.error('Error saving coaching history:', error);
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

// ============================================
// TEAM MEMBER MANAGEMENT
// ============================================

function loadTeamMembers() {
    try {
        const saved = localStorage.getItem('myTeamMembers');
        myTeamMembers = saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading team members:', error);
        myTeamMembers = {};
    }
}

function saveTeamMembers() {
    try {
        localStorage.setItem('myTeamMembers', JSON.stringify(myTeamMembers));
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
        const saved = localStorage.getItem('callCenterAverages');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading call center averages:', error);
        return {};
    }
}

function saveCallCenterAverages(averages) {
    try {
        localStorage.setItem('callCenterAverages', JSON.stringify(averages));
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
    const preferredNames = JSON.parse(localStorage.getItem('employeePreferredNames') || '{}');
    if (preferredNames[fullName]) {
        return preferredNames[fullName];
    }
    
    // Default: return first name
    return fullName.split(' ')[0];
}

function setEmployeePreferredName(fullName, preferredName) {
    if (!fullName) return;
    
    const preferredNames = JSON.parse(localStorage.getItem('employeePreferredNames') || '{}');
    
    if (preferredName && preferredName.trim()) {
        preferredNames[fullName] = preferredName.trim();
    } else {
        // If empty, remove the custom preference (fall back to first name)
        delete preferredNames[fullName];
    }
    
    localStorage.setItem('employeePreferredNames', JSON.stringify(preferredNames));
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
        const displayValue = `${val}${unit}`;
        const targetDisplay = `${metricDef.target.value}${unit}`;

        if (meetsTarget) {
            celebrate.push(`- ${metricDef.label}: ${displayValue} (Target: ${targetDisplay})`);
        } else {
            const gap = metricDef.target.type === 'min'
                ? `${(metricDef.target.value - val).toFixed(1)}${unit} below target`
                : `${(val - metricDef.target.value).toFixed(1)}${unit} above target`;
            needsCoaching.push(`- ${metricDef.label}: ${displayValue} (Target: ${targetDisplay}, ${gap})`);
            coachedMetricKeys.push(key);
        }
    });

    return { celebrate, needsCoaching, coachedMetricKeys };
}

function recordCoachingEvent({ employeeId, weekEnding, metricsCoached, aiAssisted }) {
    if (!employeeId) return;
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
    let selectedUploadPeriod = 'week'; // default
    document.querySelectorAll('.upload-period-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // Update selection
            selectedUploadPeriod = btn.dataset.period;
            
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
            // Re-attach event listeners after moving
            document.getElementById('generateSentimentSummaryBtn')?.addEventListener('click', generateSentimentSummary);
            document.getElementById('copySentimentSummaryBtn')?.addEventListener('click', copySentimentSummary);
            document.getElementById('sentimentPositiveFile')?.addEventListener('change', () => handleSentimentFileChange('Positive'));
            document.getElementById('sentimentNegativeFile')?.addEventListener('change', () => handleSentimentFileChange('Negative'));
            document.getElementById('sentimentEmotionsFile')?.addEventListener('change', () => handleSentimentFileChange('Emotions'));
        }
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
    
    // SENTIMENT & LANGUAGE SUMMARY WORKFLOW
    document.getElementById('generateSentimentSummaryBtn')?.addEventListener('click', generateSentimentSummary);
    document.getElementById('copySentimentSummaryBtn')?.addEventListener('click', copySentimentSummary);
    document.getElementById('sentimentPositiveFile')?.addEventListener('change', () => handleSentimentFileChange('Positive'));
    document.getElementById('sentimentNegativeFile')?.addEventListener('change', () => handleSentimentFileChange('Negative'));
    document.getElementById('sentimentEmotionsFile')?.addEventListener('change', () => handleSentimentFileChange('Emotions'));
    
    // Load pasted data
    document.getElementById('loadPastedDataBtn')?.addEventListener('click', () => {
        
        const pastedData = document.getElementById('pasteDataTextarea').value;
        const startDate = document.getElementById('pasteStartDate').value;
        const endDate = document.getElementById('pasteEndDate').value;
        
        
        
        // Get selected period type
        const selectedBtn = document.querySelector('.upload-period-btn[style*="background: rgb(40, 167, 69)"]') || 
                           document.querySelector('.upload-period-btn[style*="background:#28a745"]') ||
                           document.querySelector('.upload-period-btn[data-period="week"]');
        const periodType = selectedBtn ? selectedBtn.dataset.period : 'week';
        
        
        if (!startDate || !endDate) {
            alert('⚠️ Please select both start and end dates');
            return;
        }
        
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
            
            // Parse dates safely (avoid timezone issues)
            const [endYear, endMonth, endDay] = endDate.split('-').map(Number);
            const [startYear, startMonth, startDay] = startDate.split('-').map(Number);
            const endDateObj = new Date(endYear, endMonth - 1, endDay);
            const startDateObj = new Date(startYear, startMonth - 1, startDay);
            
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
                    uploadedAt: new Date().toISOString()
                }
            };
            

            
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

    enableDatePickerOpen(document.getElementById('pasteStartDate'));
    enableDatePickerOpen(document.getElementById('pasteEndDate'));
    
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
    
    // Upload more data button
    document.getElementById('uploadMoreDataBtn')?.addEventListener('click', () => {
        // Hide success message and clear form
        document.getElementById('uploadSuccessMessage').style.display = 'none';
        document.getElementById('pasteDataTextarea').value = '';
        document.getElementById('pasteStartDate').value = '';
        document.getElementById('pasteEndDate').value = '';
        
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
                
                saveWeeklyData();
                saveYtdData();
                
                showToast('✅ Data imported successfully!');
                document.getElementById('dataFileInput').value = '';
                populateDeleteWeekDropdown();
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
        
        
        // Clear all data
        weeklyData = {};
        ytdData = {};
        
        saveWeeklyData();
        saveYtdData();
        
        populateDeleteWeekDropdown();
        
        // Hide all sections
        ['metricsSection', 'employeeInfoSection', 'customNotesSection', 'generateEmailBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        
        alert('✅ All data has been deleted');
    });
    
    // Populate delete week dropdown on load
    populateDeleteWeekDropdown();
    
    // Initialize red flag handlers
    initializeRedFlag();
}

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
        html += `
            <label style="display: flex; align-items: center; gap: 10px; padding: 8px; cursor: pointer; hover: background: #f5f5f5;">
                <input type="checkbox" class="team-member-checkbox" data-week="${selectedWeek}" data-name="${emp.name}" ${isSelected ? 'checked' : ''} style="width: 18px; height: 18px; cursor: pointer;">
                <span>${emp.name}</span>
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

// ============================================
// TIPS MANAGEMENT UI
// ============================================

async function renderTipsManagement() {
    const container = document.getElementById('tipsContainer');
    if (!container) return;
    
    const userTips = loadUserTips();
    const serverTips = await loadServerTips();
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
        const currentServerTips = await loadServerTips();
        const currentUserTips = loadUserTips();
        const serverTipsForMetric = currentServerTips[metricKey] || [];
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
                                <button onclick="updateServerTip('${metricKey}', ${originalIndex})" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; white-space: nowrap;">💾 Save</button>
                                <button onclick="deleteServerTip('${metricKey}', ${originalIndex})" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; white-space: nowrap;">🗑️ Delete</button>
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
                                <button onclick="updateTip('${metricKey}', ${index})" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; white-space: nowrap;">💾 Save</button>
                                <button onclick="deleteTip('${metricKey}', ${index})" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; white-space: nowrap;">🗑️ Delete</button>
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
                <button onclick="addTip('${metricKey}')" style="background: #28a745; color: white; border: none; border-radius: 4px; padding: 10px 20px; cursor: pointer; font-size: 1em; font-weight: bold;">➕ Add Tip</button>
            </div>
        `;
        tipsHtml += '</div>';
        displayArea.innerHTML = tipsHtml;
    });
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
    
    // Save current selection before re-rendering
    const currentSelection = metricKey;
    
    // Re-render the entire tips management section
    await renderTipsManagement();
    
    // Restore the selection and trigger display
    const selector = document.getElementById('categoriesSelector');
    if (selector && currentSelection) {
        selector.value = currentSelection;
        selector.dispatchEvent(new Event('change'));
    }
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
        
        // Save current selection before re-rendering
        const currentSelection = metricKey;
        
        // Re-render the entire tips management section
        await renderTipsManagement();
        
        // Restore the selection and trigger display
        const selector = document.getElementById('categoriesSelector');
        if (selector && currentSelection) {
            selector.value = currentSelection;
            selector.dispatchEvent(new Event('change'));
        }
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
    let modifiedServerTips = JSON.parse(localStorage.getItem('modifiedServerTips') || '{}');
    
    if (!modifiedServerTips[metricKey]) {
        modifiedServerTips[metricKey] = {};
    }
    
    modifiedServerTips[metricKey][index] = updatedTip;
    localStorage.setItem('modifiedServerTips', JSON.stringify(modifiedServerTips));
    
    showToast('✅ Server tip updated!');
    
    // Save current selection before re-rendering
    const currentSelection = metricKey;
    
    // Re-render the entire tips management section
    await renderTipsManagement();
    
    // Restore the selection and trigger display
    const selector = document.getElementById('categoriesSelector');
    if (selector && currentSelection) {
        selector.value = currentSelection;
        selector.dispatchEvent(new Event('change'));
    }
};

window.deleteServerTip = async function(metricKey, index) {
    if (!confirm('Are you sure you want to delete this server tip? This will hide it from the list.')) {
        return;
    }
    
    // Load deleted server tips list
    let deletedServerTips = JSON.parse(localStorage.getItem('deletedServerTips') || '{}');
    
    if (!deletedServerTips[metricKey]) {
        deletedServerTips[metricKey] = [];
    }
    
    // Mark this index as deleted
    if (!deletedServerTips[metricKey].includes(index)) {
        deletedServerTips[metricKey].push(index);
    }
    
    localStorage.setItem('deletedServerTips', JSON.stringify(deletedServerTips));
    
    showToast('\u{1F5D1}\u{FE0F} Server tip deleted');
    
    // Save current selection before re-rendering
    const currentSelection = metricKey;
    
    // Re-render the entire tips management section
    await renderTipsManagement();
    
    // Restore the selection and trigger display
    const selector = document.getElementById('categoriesSelector');
    if (selector && currentSelection) {
        selector.value = currentSelection;
        selector.dispatchEvent(new Event('change'));
    }
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
    
    // Save current selection before re-rendering
    const currentSelection = metricKey;
    
    // Re-render the entire tips management section
    await renderTipsManagement();
    
    // Restore the selection and trigger display
    const selector = document.getElementById('categoriesSelector');
    if (selector && currentSelection) {
        selector.value = currentSelection;
        selector.dispatchEvent(new Event('change'));
    }
};

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
    
    // Set default dates to current week (Monday-Sunday)
    const avgWeekMonday = document.getElementById('avgWeekMonday');
    const avgWeekSunday = document.getElementById('avgWeekSunday');
    
    if (avgWeekMonday && !avgWeekMonday.value) {
        // Get this Monday
        const today = new Date();
        const day = today.getDay();
        const diff = today.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is Sunday
        const monday = new Date(today.setDate(diff));
        avgWeekMonday.value = monday.toISOString().split('T')[0];
        
        // Auto-set Sunday (6 days after Monday)
        if (avgWeekSunday) {
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            avgWeekSunday.value = sunday.toISOString().split('T')[0];
        }
    }
    
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
    
    // Show the metrics form immediately
    const avgMetricsForm = document.getElementById('avgMetricsForm');
    if (avgMetricsForm) avgMetricsForm.style.display = 'block';
    

    
    // Populate uploaded data dropdown and set up listener
    populateUploadedDataDropdown();
    setupUploadedDataListener();
    
    // Populate trend generation dropdowns
    populateTrendPeriodDropdown();
    populateEmployeeDropdown();
    
    // Load existing averages when date/type changes
    setupAveragesLoader();
    
    // Set up event listeners
    setupMetricTrendsListeners();
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
    
    const avgUploadedDataSelect = document.getElementById('avgUploadedDataSelect');
    if (avgUploadedDataSelect?.value) {
        trendPeriodSelect.value = avgUploadedDataSelect.value;
        trendPeriodSelect.dispatchEvent(new Event('change'));
    }
    
    // Add change listener to filter employees by selected period
    trendPeriodSelect.addEventListener('change', (e) => {
        populateEmployeeDropdownForPeriod(e.target.value);
    });
    
    
}

function populateEmployeeDropdown() {
    const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');
    
    if (!trendEmployeeSelect) {
        
        return;
    }
    
    // Get all unique employees (for initial load)
    const employeeSet = new Set();
    Object.values(weeklyData).forEach(week => {
        if (week && week.employees) {
            week.employees.forEach(emp => {
                employeeSet.add(emp.name);
            });
        }
    });
    Object.values(ytdData).forEach(period => {
        if (period && period.employees) {
            period.employees.forEach(emp => {
                employeeSet.add(emp.name);
            });
        }
    });
    
    if (employeeSet.size === 0) {
        trendEmployeeSelect.innerHTML = '<option value="">No employees available</option>';
        return;
    }
    
    // Build options
    let options = '<option value="">Select Employee...</option>';
    options += '<option value="ALL">All Associates</option>';
    Array.from(employeeSet).sort().forEach(name => {
        options += `<option value="${name}">${name}</option>`;
    });
    
    trendEmployeeSelect.innerHTML = options;

    updateTrendButtonsVisibility();
}

function populateEmployeeDropdownForPeriod(weekKey) {
    const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');
    
    if (!trendEmployeeSelect) {
        
        return;
    }
    
    if (!weekKey) {
        // No period selected, show all employees
        populateEmployeeDropdown();
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
        avgMetricsForm.style.display = 'none';
        periodTypeField.value = '';
        mondayField.value = '';
        sundayField.value = '';
        return;
    }
    
    const week = periodData;
    const metadata = week.metadata || {};
    
    // Display period info - use label for better display
    const periodLabel = metadata.label || `${metadata.startDate} to ${metadata.endDate}`;
    showToast(`Editing averages for: ${periodLabel}`, 5000);
    
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
    
    avgMetricsForm.style.display = 'block';
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
        alert('✅ Call center averages saved!');
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
    
    // Generate HTML for each metric
    let html = '';
    metricsToPreview.forEach(metric => {
        const value = employee[metric.key] !== undefined ? employee[metric.key] : '';
        html += `
            <div>
                <label style="font-weight: bold; display: block; margin-bottom: 3px; font-size: 0.85em;">${metric.label} (${metric.unit}):</label>
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
 * Build the HTML email for a trend email
 * Can be used for both single and bulk email generation
 */
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
    createTrendEmailImage(displayName, weekKey, period, employee, prevEmployee, () => {
        // AFTER image is copied to clipboard, THEN open Outlook
        const periodMeta = period.metadata || {};
        const mailPeriodType = periodMeta.periodType === 'week' ? 'Weekly' : periodMeta.periodType === 'month' ? 'Monthly' : periodMeta.periodType === 'quarter' ? 'Quarterly' : 'Weekly';
        const mailPeriodLabel = periodMeta.periodType === 'week' ? 'Week' : periodMeta.periodType === 'month' ? 'Month' : periodMeta.periodType === 'quarter' ? 'Quarter' : 'Week';
        const mailEndDate = periodMeta.endDate || 'unknown';
        const emailSubject = `Trending Metrics - ${mailPeriodType} - ${mailPeriodLabel} ending ${mailEndDate} for ${displayName}`;
        
        console.log('Opening Outlook with subject:', emailSubject);
        
        // Open mailto AFTER clipboard is ready
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
    });
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
    if (meetsGoal) {
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
    const targetDisplay = formatMetricDisplay(metric.key, target);
    ctx.fillText(`${metric.label} (${targetDisplay})`, x + 10, y + 24);
    
    // Associate value - always display the metric value (even if surveys = 0)
    ctx.fillStyle = '#333333';
    ctx.font = 'bold 14px Arial';
    const formattedValue = formatMetricValue(metric.key, associateValue);
    ctx.fillText(formattedValue, x + 230, y + 24);
    
    // Center average - use formatMetricValue
    ctx.font = '14px Arial';
    const formattedCenter = centerExists ? formatMetricValue(metric.key, centerAvg) : 'N/A';
    ctx.fillText(formattedCenter, x + 330, y + 24);
    
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
    ctx.fillText(vsCenterText, x + 450, y + 24);
    
    // Trending (if previous data exists) - show emoji + change value
    let trendingColor = '#666666';
    let trendingText = 'N/A';
    let trendingEmoji = '';
    
    if (previousValue !== undefined && previousValue !== null) {
        const trendDiff = associateValue - previousValue;
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
    ctx.fillText(trendingText, x + 570, y + 24);
    
    // YTD value (now last column)
    let formattedYtd = '';
    const ytdValueNum = parseFloat(ytdValue);
    const ytdHasValue = ytdValue !== undefined && ytdValue !== null && ytdValue !== '' && !isNaN(ytdValueNum);
    const ytdNoSurveys = isSurveyMetric && ytdSurveyTotal === 0;
    if (ytdHasValue) {
        formattedYtd = ytdNoSurveys ? 'N/A' : formatMetricValue(metric.key, ytdValueNum);
    }
    ctx.fillStyle = '#333333';
    ctx.font = '14px Arial';
    ctx.fillText(formattedYtd, x + 720, y + 24);
}

// ============================================
// PHASE 4 - HTML TABLE RENDERER
// ============================================

function buildMetricTableHTML(empName, period, current, previous, centerAvg, ytdEmployee = null) {
    /**
     * PHASE 4 - HTML TABLE RENDERER
     * Mirrors canvas rendering logic in web-friendly HTML format
     * 
     * Uses same color logic:
     * - Green row: Meets goal
     * - Yellow row: Below goal
     * - Blue cell: Above center average
     * - Dark yellow cell: Below center average
     * - Gray cell: Center unavailable
     * 
     * Reverse logic for: Transfers, AHT, Hold Time, ACW, Reliability
     */
    
    if (!current) return '';
    
    // Extract metrics data
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
    
    const ytdAvailable = !!ytdEmployee;
    
    // Build HTML table
    let html = '';
    if (!ytdAvailable) {
        html += `<div style="color: #666; font-size: 0.9em; margin: 10px 0;">YTD not available – source data not provided.</div>`;
    }
    html += `<table style="width: 100%; border-collapse: collapse; font-family: Arial, sans-serif; margin: 20px 0;">`;
    
    // Table headers
    html += `<thead>
        <tr style="background-color: #003DA5; color: white;">
            <th style="padding: 12px; text-align: left; border: 1px solid #ddd; font-weight: bold;">Metric</th>
            <th style="padding: 12px; text-align: center; border: 1px solid #ddd; font-weight: bold;">Your Value</th>
            <th style="padding: 12px; text-align: center; border: 1px solid #ddd; font-weight: bold;">Center Avg</th>
            <th style="padding: 12px; text-align: center; border: 1px solid #ddd; font-weight: bold;">Target</th>
            <th style="padding: 12px; text-align: center; border: 1px solid #ddd; font-weight: bold;">vs Center</th>
            <th style="padding: 12px; text-align: center; border: 1px solid #ddd; font-weight: bold;">Trend</th>
            <th style="padding: 12px; text-align: center; border: 1px solid #ddd; font-weight: bold;">YTD</th>
        </tr>
    </thead>`;
    
    html += '<tbody>';
    
    let currentGroup = null;
    
    metricOrder.forEach(({ key, group }) => {
        // Skip if metric doesn't exist in data
        if (metrics[key] === undefined) return;
        
        const metric = METRICS_REGISTRY[key];
        if (!metric) return;
        
        // Insert group header if entering new group
        if (group !== currentGroup) {
            currentGroup = group;
            html += `<tr style="background-color: #e3f2fd; border: 1px solid #ddd;">
                <td colspan="6" style="padding: 12px; font-weight: bold; color: #0056B3; font-size: 15px;">
                    ${group}
                </td>
            </tr>`;
        }
        
        const curr = parseFloat(metrics[key]) || 0;
        const prev = prevMetrics[key] !== undefined ? parseFloat(prevMetrics[key]) : undefined;
        const center = parseFloat(centerAvg[key]) || 0;
        const target = getMetricTarget(key);
        const meetsGoal = isMetricMeetingTarget(key, curr, target);
        const isReverse = isReverseMetric(key);
        
        // Determine row background color
        const rowBgColor = meetsGoal ? '#d4edda' : '#fff3cd';
        
        // Determine vs center color
        const centerExists = center > 0;
        const isAboveCenter = centerExists ? 
            (isReverse ? curr < center : curr > center) : 
            false;
        
        let vsCenterColor, vsCenterText;
        if (!centerExists) {
            vsCenterColor = '#999999';
            vsCenterText = 'N/A';
        } else {
            const percentDiff = ((curr - center) / center * 100).toFixed(1);
            vsCenterText = `${percentDiff}%`;
            vsCenterColor = isAboveCenter ? '#0056B3' : '#DAA520';
        }
        
        // Trending - apply reverse logic for metrics where lower is better
        let trendingColor = '#666666';
        let trendingText = 'N/A';
        if (prev !== undefined && prev !== null) {
            // Handle case where prev is 0 (avoid division by zero)
            if (prev === 0) {
                // If previous was 0, show the absolute change
                const absDiff = Math.abs(curr - prev);
                const sign = curr > prev ? '+' : '';
                trendingText = `${sign}${absDiff.toFixed(2)}`;
                // For reverse metrics, lower is better
                if (isReverse) {
                    trendingColor = curr < 0 ? '#28a745' : (curr > 0 ? '#dc3545' : '#666666');
                } else {
                    trendingColor = curr > 0 ? '#28a745' : (curr < 0 ? '#dc3545' : '#666666');
                }
            } else {
                const trendPercent = ((curr - prev) / prev * 100).toFixed(1);
                trendingText = `${trendPercent > 0 ? '+' : ''}${trendPercent}%`;
                // For reverse metrics (lower is better), invert the color logic
                if (isReverse) {
                    trendingColor = curr > prev ? '#dc3545' : (curr < prev ? '#28a745' : '#666666');
                } else {
                    trendingColor = curr > prev ? '#28a745' : (curr < prev ? '#dc3545' : '#666666');
                }
            }
        }
        
        const targetDisplay = formatMetricDisplay(key, target);
        const ytdDisplay = ytdEmployee && ytdEmployee[key] !== undefined ? formatMetricDisplay(key, ytdEmployee[key]) : '';
        html += `<tr style="background-color: ${rowBgColor}; border: 1px solid #ddd;">
            <td style="padding: 12px; text-align: left; border: 1px solid #ddd; font-weight: 500;">${metric.label} <span style="color: #666; font-size: 0.9em;">(${targetDisplay})</span></td>
            <td style="padding: 12px; text-align: center; border: 1px solid #ddd; font-weight: bold; color: #333;">${curr.toFixed(2)}</td>
            <td style="padding: 12px; text-align: center; border: 1px solid #ddd;">${centerExists ? center.toFixed(2) : 'N/A'}</td>
            <td style="padding: 12px; text-align: center; border: 1px solid #ddd;">${target}</td>
            <td style="padding: 12px; text-align: center; border: 1px solid #ddd; color: ${vsCenterColor}; font-weight: bold;">${vsCenterText}</td>
            <td style="padding: 12px; text-align: center; border: 1px solid #ddd; color: ${trendingColor}; font-weight: bold;">${trendingText}</td>
            <td style="padding: 12px; text-align: center; border: 1px solid #ddd;">${ytdDisplay}</td>
        </tr>`;
    });
    
    html += '</tbody></table>';
    
    return html;
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
    const surveyTotal = current.surveyTotal ? parseInt(current.surveyTotal, 10) : 0;
    const ytdSurveyTotal = ytdEmployee?.surveyTotal ? parseInt(ytdEmployee.surveyTotal, 10) : 0;

    
    
    
    
    // SUMMARY STATISTICS (used by both canvas and HTML)
    let meetingGoals = 0;
    let improved = 0;
    let beatingCenter = 0;

    metricOrder.forEach(({ key }) => {
        if (metrics[key] === undefined) return;
        
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

    const totalMetrics = Object.keys(metrics).length;
    const successRate = Math.round(meetingGoals / totalMetrics * 100);
    const improvedText = previous ? improved.toString() : 'N/A';
    const metadata = period.metadata || {};
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
    ctx.fillText('Metric', 50, y + 28);
    ctx.fillText('Your Metric', 230, y + 28);
    ctx.fillText('Center Avg', 330, y + 28);
    ctx.fillText('vs. Center Avg', 450, y + 28);
    ctx.fillText(`Change vs last ${periodLabel}`, 570, y + 28);
    ctx.fillText('YTD', 720, y + 28);
    
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
    
    metricOrder.forEach(({ key, group }) => {
        if (metrics[key] === undefined) return;
        
        const metric = METRICS_REGISTRY[key];
        if (!metric) return;
        
        // Draw group header
        if (group !== currentGroup) {
            currentGroup = group;
            ctx.fillStyle = '#e3f2fd';
            ctx.fillRect(40, y, 820, 40);
            ctx.fillStyle = '#0056B3';
            ctx.font = 'bold 16px Arial, "Segoe UI Emoji", "Apple Color Emoji"';
            // Add emojis to group headers
            let groupEmoji = '📊';
            if (group === 'Core Performance') groupEmoji = '🎯';
            else if (group === 'Survey') groupEmoji = '📋';
            else if (group === 'Sentiment') groupEmoji = '💬';
            else if (group === 'Reliability') groupEmoji = '⏰';
            
            const groupLabel = group === 'Survey' ? `${groupEmoji} ${group} (${surveyTotal} ${periodLabel.toLowerCase()} | ${ytdSurveyTotal} YTD)` : `${groupEmoji} ${group}`;
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

function getYtdPeriodForWeekKey(weekKey) {
    if (!weekKey) return null;
    const parts = weekKey.split('|');
    const endDate = parts[1] || '';
    if (!endDate) return null;
    const matchingKey = Object.keys(ytdData).find(key => key.split('|')[1] === endDate);
    return matchingKey ? ytdData[matchingKey] : null;
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
    const yearStartStr = `${currentYear}-01-01`;
    
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

    // Open CoPilot in new tab with the prompt
    const encodedPrompt = encodeURIComponent(copilotPrompt);
    const copilotUrl = `https://copilot.microsoft.com/?showconv=1&sendquery=1&q=${encodedPrompt}`;
    window.open(copilotUrl, '_blank');

    showToast('Opening CoPilot with your email prompt...', 3000);
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
        return JSON.parse(localStorage.getItem('tipUsageHistory') || '{}');
    } catch {
        return {};
    }
}

function saveTipUsageHistory(history) {
    localStorage.setItem('tipUsageHistory', JSON.stringify(history));
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
        const log = JSON.parse(localStorage.getItem('complianceLog') || '[]');
        log.push(entry);
        localStorage.setItem('complianceLog', JSON.stringify(log.slice(-200)));
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
    renderComplianceAlerts();
}

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

    // Attach event listeners
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

    // Initial render of visualizations
    renderTrendVisualizations();
}

function renderComplianceAlerts() {
    const container = document.getElementById('complianceAlertsOutput');
    if (!container) return;
    const log = JSON.parse(localStorage.getItem('complianceLog') || '[]');
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
            modeText.textContent = `👤 Individual Coaching Mode: ${selectedEmployee}`;
            emailBtnText.textContent = '🤖 Generate Individual Coaching Email';
        } else {
            modeIndicator.style.display = 'block';
            modeIndicator.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
            modeText.textContent = '📊 Team-Wide Analysis Mode';
            emailBtnText.textContent = '📧 Generate Group Email';
        }
    }

    // Render based on mode
    if (selectedEmployee) {
        renderIndividualTrendAnalysis(container, selectedEmployee, keys);
    } else {
        renderGroupTrendAnalysis(container, keys);
    }
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
        winsText = 'WINS (What They Achieved):\\n';
        wins.forEach(w => {
            winsText += `- ${w.metric}: ${w.value}\\n`;
        });
    } else {
        winsText = 'WINS: No metrics currently meeting target\\n';
    }

    let opportunitiesText = '';
    if (opportunities.length > 0) {
        opportunitiesText = 'OPPORTUNITIES (Areas to Improve):\\n';
        opportunities.forEach(opp => {
            opportunitiesText += `- ${opp.metric}: Currently ${opp.value}, Target ${opp.target}`;
            if (opp.trend !== 0) {
                opportunitiesText += ` (${opp.trend > 0 ? 'improving' : 'declining'})`;
            }
            opportunitiesText += '\\n';
            if (opp.tip) {
                opportunitiesText += `  TIP: ${opp.tip}\\n`;
            }
        });
    } else {
        opportunitiesText = 'OPPORTUNITIES: All metrics meeting targets!\\n';
    }

    const preferredName = getEmployeeNickname(employeeName) || currentEmp.firstName || employeeName.split(' ')[0];

    const copilotPrompt = `I'm a supervisor preparing a coaching email for an employee named ${preferredName} for their week ending ${endDate} performance review. I need your help drafting this in a natural, warm tone - not corporate or template-like.

Here's the performance data:

${winsText}
${opportunitiesText}

Can you help me write an email to ${preferredName} with this structure:

1. Warm, conversational greeting

2. WINS section:
   - Brief intro line
    - Bullets in this concise format: "• Metric Name - Goal X%. You were at Y%."
   - After bullets: A paragraph celebrating their achievements and encouraging them to keep it up

3. OPPORTUNITIES section:
   - Brief supportive intro line
    - Bullets in this format: "• Metric Name - Goal X%. You were at Y%."
    - Note: If Reliability is included, format as: "• Reliability - X hours unscheduled" (no goal needed)
   - After bullets: A paragraph with coaching tips (reword the tips naturally so they don't sound templated). Be constructive and supportive.

4. Warm close inviting them to discuss

Keep it conversational, upbeat, and motivating. Use "you" language. Avoid corporate buzzwords and any mention of AI or analysis. Make this sound like a genuine supervisor who cares about their success.

Vary your wording and sentence structure so it doesn't sound templated or AI-generated. Use natural phrasing and avoid repeating the same patterns.

Add emojis throughout the email to make it fun and engaging! Use them in the greeting, with wins, with opportunities, and in the closing. Make it feel warm and approachable.

Do NOT use em dashes (—) anywhere in the email.

Use the % symbol instead of writing out "percent" (e.g., "95%" not "95 percent").

The email should be ready to send as-is. Just give me the complete email to ${preferredName}, nothing else.`;

    // Open CoPilot with the prompt
    const encodedPrompt = encodeURIComponent(copilotPrompt);
    const copilotUrl = `https://copilot.microsoft.com/?showconv=1&sendquery=1&q=${encodedPrompt}`;
    window.open(copilotUrl, '_blank');

    showToast('Opening CoPilot with individual coaching email...', 3000);
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
        window.open('https://m365.cloud.microsoft.com/chat', '_blank');
        
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
        window.open('https://m365.cloud.microsoft.com/chat', '_blank');
        
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

function renderIndividualTrendAnalysis(container, employeeName, keys) {
    const latestKey = keys[keys.length - 1];
    const previousKey = keys[keys.length - 2];
    const thirdKey = keys.length >= 3 ? keys[keys.length - 3] : null;

    const latestWeek = weeklyData[latestKey];
    const previousWeek = weeklyData[previousKey];
    const thirdWeek = thirdKey ? weeklyData[thirdKey] : null;

    if (!latestWeek?.employees || !previousWeek?.employees) {
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">Not enough employee data to analyze trends.</div>';
        return;
    }

    const currentEmp = latestWeek.employees.find(emp => emp.name === employeeName);
    const prevEmp = previousWeek.employees.find(e => e.name === employeeName);
    
    if (!currentEmp) {
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">Selected employee not found in current data.</div>';
        return;
    }

    const warnings = [];
    const wins = [];

    // Check for 3-period decline if we have enough data
    if (thirdWeek?.employees && prevEmp) {
        const thirdEmp = thirdWeek.employees.find(e => e.name === employeeName);
        if (thirdEmp) {
            ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr', 'transfers', 'aht'].forEach(metricKey => {
                const a = currentEmp[metricKey];
                const b = prevEmp[metricKey];
                const c = thirdEmp[metricKey];
                if (a === undefined || b === undefined || c === undefined) return;
                const worse1 = metricDelta(metricKey, a, b) < 0;
                const worse2 = metricDelta(metricKey, b, c) < 0;
                if (worse1 && worse2) {
                    warnings.push(`📉 3-week decline in ${METRICS_REGISTRY[metricKey]?.label || metricKey}. This needs immediate attention.`);
                }
            });
        }
    }

    // Check for sudden drops (week over week)
    if (prevEmp) {
        ['overallSentiment', 'overallExperience', 'fcr', 'scheduleAdherence', 'aht', 'holdTime', 'transfers'].forEach(metricKey => {
            const current = currentEmp[metricKey];
            const prev = prevEmp[metricKey];
            if (current === undefined || prev === undefined) return;
            const delta = metricDelta(metricKey, current, prev);
            const unit = METRICS_REGISTRY[metricKey]?.unit || '%';
            const threshold = unit === 'sec' ? 20 : unit === 'hrs' ? 2 : 4;
            if (delta < -threshold) {
                warnings.push(`⚠️ Sudden drop in ${METRICS_REGISTRY[metricKey]?.label || metricKey} (${delta.toFixed(1)}${unit}). Needs supportive conversation.`);
    }
        });
    }
    const copilotEmail = document.getElementById('copilotOutputText')?.value.trim();
    // Check for consistency and wins
    const meetsAllTargets = ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment'].every(metricKey => 
        metricMeetsTarget(metricKey, currentEmp[metricKey])
    );
    
    if (meetsAllTargets) {
        wins.push(`✅ ${employeeName} is meeting all key targets. Consider recognition!`);
    }

    // Check for improvement trends
    if (prevEmp) {
        ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr'].forEach(metricKey => {
            const current = currentEmp[metricKey];
            const prev = prevEmp[metricKey];
            if (current === undefined || prev === undefined) return;
            const delta = metricDelta(metricKey, current, prev);
            if (delta > 5) {
                wins.push(`🎉 Strong improvement in ${METRICS_REGISTRY[metricKey]?.label || metricKey} (+${delta.toFixed(1)})`);
            }
        });

    }
    // Build output
    let html = `<div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e0e0e0;">`;
    html += `<h5 style="margin-top: 0; color: #f5576c;">Individual Coaching Insights for ${employeeName}</h5>`;
    
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

function renderGroupTrendAnalysis(container, keys) {
    const latestKey = keys[keys.length - 1];
    const previousKey = keys[keys.length - 2];
    const thirdKey = keys.length >= 3 ? keys[keys.length - 3] : null;

    const latestWeek = weeklyData[latestKey];
    const previousWeek = weeklyData[previousKey];
    const thirdWeek = thirdKey ? weeklyData[thirdKey] : null;

    if (!latestWeek?.employees || !previousWeek?.employees) {
        container.innerHTML = '<div style="color: #666; font-size: 0.95em;">Not enough employee data to analyze trends.</div>';
        return;
    }

    const teamInsights = {
        atRisk: [],
        declining: [],
        improving: [],
        consistent: []
    };

    latestWeek.employees.forEach(emp => {
        const prevEmp = previousWeek.employees.find(e => e.name === emp.name);
        if (!prevEmp) return;

        // Check for 3-period decline
        if (thirdWeek?.employees) {
            const thirdEmp = thirdWeek.employees.find(e => e.name === emp.name);
            if (thirdEmp) {
                const hasDecline = ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr'].some(metricKey => {
                    const a = emp[metricKey];
                    const b = prevEmp[metricKey];
                    const c = thirdEmp[metricKey];
                    if (a === undefined || b === undefined || c === undefined) return false;
                    const worse1 = metricDelta(metricKey, a, b) < 0;
                    const worse2 = metricDelta(metricKey, b, c) < 0;
                    return worse1 && worse2;
                });

                if (hasDecline) {
                    teamInsights.atRisk.push(emp.name);
                    return;
                }
            }
        }

        // Check for sudden drops
        const hasSuddenDrop = ['overallSentiment', 'overallExperience', 'fcr', 'scheduleAdherence'].some(metricKey => {
            const current = emp[metricKey];
            const prev = prevEmp[metricKey];
            if (current === undefined || prev === undefined) return false;
            const delta = metricDelta(metricKey, current, prev);
            return delta < -4;
        });

        if (hasSuddenDrop) {
            teamInsights.declining.push(emp.name);
            return;
        }

        // Check for improvements
        const hasImprovement = ['overallSentiment', 'scheduleAdherence', 'overallExperience', 'fcr'].some(metricKey => {
            const current = emp[metricKey];
            const prev = prevEmp[metricKey];
            if (current === undefined || prev === undefined) return false;
            const delta = metricDelta(metricKey, current, prev);
            return delta > 5;
        });

        if (hasImprovement) {
            teamInsights.improving.push(emp.name);
            return;
        }

        // Check for consistency
        const consistent = ['scheduleAdherence', 'overallExperience', 'fcr', 'overallSentiment'].every(metricKey => 
            metricMeetsTarget(metricKey, emp[metricKey])
        );
        
        if (consistent) {
            teamInsights.consistent.push(emp.name);
        }
    });

    // Build team overview
    let html = `<div style="background: white; padding: 20px; border-radius: 8px; border: 1px solid #e0e0e0;">`;
    html += `<h5 style="margin-top: 0; color: #764ba2;">Team-Wide Trend Analysis</h5>`;
    
    // Summary cards
    html += `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px; margin-bottom: 20px;">`;
    
    html += `<div style="padding: 15px; background: linear-gradient(135deg, #e53935 0%, #ef5350 100%); color: white; border-radius: 8px; text-align: center;">`;
    html += `<div style="font-size: 2em; font-weight: bold;">${teamInsights.atRisk.length}</div>`;
    html += `<div style="font-size: 0.9em; opacity: 0.95;">At Risk (3-week decline)</div>`;
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
    
    const preferredNames = JSON.parse(localStorage.getItem('employeePreferredNames') || '{}');
    
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
                    <input type="text" id="prefName_${name}" value="${defaultValue}" placeholder="${getEmployeeNickname(name)}" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 0.9em; box-sizing: border-box;">
                    <div style="font-size: 0.75em; color: #999; margin-top: 3px;">Current: <strong>${currentPreferred}</strong></div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button onclick="saveEmployeePreferredName('${name}')" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; font-size: 0.9em; white-space: nowrap;">💾 Save</button>
                    <button onclick="deleteEmployee('${name}')" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; font-size: 0.9em; white-space: nowrap;">🗑️ Delete</button>
                </div>
            </div>
        </div>
    `}).join('');
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
    const preferredNames = JSON.parse(localStorage.getItem('employeePreferredNames') || '{}');
    delete preferredNames[employeeName];
    localStorage.setItem('employeePreferredNames', JSON.stringify(preferredNames));
    
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
    loadTeamMembers();
    

    if (Object.keys(weeklyData).length > 0) {
        
    } else {
        
    }
    
    // Initialize default coaching tips (first load only)
    initializeDefaultTips();
    
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
    
    // Ensure data is saved before page unload (survives Ctrl+Shift+R)
    window.addEventListener('beforeunload', () => {
        saveWeeklyData();
        saveYtdData();
        saveCoachingHistory();
        
    });
    
    
}

// ============================================
// INITIALIZATION TRIGGER
// ============================================

// Initialize app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        
        initApp();
    });
} else {
    // DOM already loaded (if script runs late)
    
    initApp();
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
    const saved = localStorage.getItem('executiveSummaryNotes') ? JSON.parse(localStorage.getItem('executiveSummaryNotes')) : {};
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
    const saved = localStorage.getItem('executiveSummaryNotes') ? JSON.parse(localStorage.getItem('executiveSummaryNotes')) : {};
    
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
    
    localStorage.setItem('executiveSummaryNotes', JSON.stringify(saved));
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
    const callCenterAverages = localStorage.getItem('callCenterAverages') ? JSON.parse(localStorage.getItem('callCenterAverages')) : {};
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

// -----------------------------------------------------------------------------
// UTILITY FEATURE - MANAGE TIPS - DO NOT DELETE
// Completely isolated from Metric Trends, emails, and coaching workflows.
// -----------------------------------------------------------------------------

// Default tips for each metric (preloaded on first use)
const DEFAULT_METRIC_TIPS = {
    "Schedule Adherence": [
        "Focus on being work-ready at the start of shift, after breaks, and after lunches.",
        "Use alarms or reminders to stay aligned with your schedule throughout the day.",
        "If something unexpected pulls you off schedule, communicate early.",
        "Strong adherence helps keep call volume balanced for the team.",
        "Building consistent habits now supports future shift flexibility."
    ],
    "Rep Satisfaction": [
        "Be mindful of tone, especially during challenging moments.",
        "Show patience and empathy when addressing concerns.",
        "Take ownership of the issue, even if another team is involved.",
        "Calm delivery builds trust with customers.",
        "How you say it matters as much as the solution itself."
    ],
    "First Call Resolution": [
        "Fully understand the customer's need before taking action.",
        "Use available tools to resolve issues in one interaction.",
        "Clarify expectations so the customer knows what will happen next.",
        "Confirm all questions are addressed before closing the call.",
        "Strong ownership helps reduce repeat contacts."
    ],
    "Overall Experience": [
        "Set a positive tone early by explaining how you will help.",
        "Clear explanations shape how the interaction is remembered.",
        "Avoid rushed language so customers feel supported.",
        "Summarize next steps before ending the call.",
        "Reassurance helps create a positive overall experience."
    ],
    "Transfers": [
        "Take a moment to fully assess the customer's request before transferring.",
        "Use available job aids and resources to resolve more calls independently.",
        "Building confidence in handling issues reduces unnecessary transfers.",
        "When a transfer is needed, clearly explain the reason to the customer.",
        "Fewer transfers improve both customer experience and call flow."
    ],
    "Overall Sentiment": [
        "Lead the call with calm confidence.",
        "A steady approach helps de-escalate tense situations.",
        "Acknowledge emotions without taking them personally.",
        "Respectful communication improves sentiment.",
        "Staying composed supports better outcomes."
    ],
    "Positive Word": [
        "Emphasize what you can do for the customer.",
        "Use affirming language throughout the interaction.",
        "Reinforce helpful actions verbally.",
        "Keep conversations solution-focused.",
        "Intentional word choice shapes tone."
    ],
    "Avoid Negative Words": [
        "Replace limiting phrases with neutral or positive alternatives.",
        "Focus on solutions rather than constraints.",
        "Small wording changes can shift customer perception.",
        "Practice positive phrasing consistently.",
        "Clear communication builds trust."
    ],
    "Managing Emotions": [
        "You're doing great here! Keep maintaining composure even during challenging interactions.",
        "Take a deep breath before responding to emotional customers.",
        "Acknowledge the customer's feelings: 'I understand this is frustrating.'",
        "Stay calm and professional, even if the customer is upset.",
        "If needed, take a brief pause after difficult calls to reset."
    ],
    "Average Handle Time": [
        "Use confident ownership statements to guide the call.",
        "Ask focused questions early to avoid rework later.",
        "Navigate systems efficiently using common paths and shortcuts.",
        "Balance efficiency with accuracy to avoid repeat work.",
        "Confidence and structure naturally improve handle time."
    ],
    "After Call Work": [
        "Complete your documentation promptly. This keeps you available for the next customer and maintains accuracy.",
        "Have templates ready for common call types to speed up ACW.",
        "Document as you go during the call when possible.",
        "Be thorough but concise in your notes.",
        "If you're spending too long, ask your supervisor for tips on streamlining."
    ],
    "Hold Time": [
        "Minimize hold time by gathering information upfront. It improves customer experience and efficiency.",
        "Explain what you're doing when you place someone on hold.",
        "Set realistic time expectations: 'This will take about 30 seconds.'",
        "Check back every 30-45 seconds if research is taking longer.",
        "If the hold will be long, offer to call the customer back instead."
    ],
    "Reliability": [
        "Plan ahead and submit time-off requests early.",
        "Communicate promptly if something unexpected affects attendance.",
        "Consistent reliability supports the entire team.",
        "Strong attendance builds long-term flexibility.",
        "Proactive planning prevents last-minute coverage issues."
    ]
};

function initializeDefaultTips() {
    const stored = localStorage.getItem('metricCoachingTips');
    if (stored) {
        return;
    }
    
    // Load server tips from CSV file
    loadServerTips().then(serverTips => {
        // Store server tips as the default tips
        if (Object.keys(serverTips).length > 0) {
            localStorage.setItem('metricCoachingTips', JSON.stringify(serverTips));
        } else {
            // If CSV doesn't load, use hardcoded defaults
            localStorage.setItem('metricCoachingTips', JSON.stringify(DEFAULT_METRIC_TIPS));
        }
    }).catch(() => {
        // On error, use hardcoded defaults
        localStorage.setItem('metricCoachingTips', JSON.stringify(DEFAULT_METRIC_TIPS));
    });
}

function getMetricTips(metricName) {
    const normalizedMetric = metricName.toLowerCase();
    
    // First check the new user tips system
    const userTips = loadUserTips();
    const userTipsForMetric = userTips[metricName] || [];
    if (userTipsForMetric.length > 0) {
        return userTipsForMetric;
    }

    // Fall back to default tips
    const stored = localStorage.getItem('metricCoachingTips');
    const allTips = stored ? JSON.parse(stored) : DEFAULT_METRIC_TIPS;
    return allTips[metricName] || [];
}

// ============================================
// SENTIMENT & LANGUAGE SUMMARY ENGINE
// ============================================

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
    summary += `Associate: ${associateName}\n`;
    summary += `Date Range: ${dateRange}\n\n`;
    
    // POSITIVE LANGUAGE Section
    summary += `POSITIVE LANGUAGE\n`;
    summary += `- Coverage: ${positive.callsDetected} / ${positive.totalCalls} calls (${positive.percentage}%)\n`;
    summary += `- Doing well:\n`;
    const posTopPhrases = positive.phrases
        .filter(p => p.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);
    posTopPhrases.forEach(p => {
        summary += `  • "${p.phrase}" - used in ${p.value} calls\n`;
    });
    summary += `- Could increase score by using more:\n`;
    const posLowPhrases = positive.phrases
        .filter(p => p.value === 0 || p.value < 10)
        .sort((a, b) => a.value - b.value)
        .slice(0, 5);
    posLowPhrases.forEach(p => {
        summary += `  • "${p.phrase}" - used in ${p.value} calls\n`;
    });
    summary += `\n`;
    
    // AVOIDING NEGATIVE LANGUAGE Section
    summary += `AVOIDING NEGATIVE LANGUAGE\n`;
    summary += `- Coverage: ${negative.callsDetected} / ${negative.totalCalls} calls (${negative.percentage}%)\n`;
    const negPhrases = negative.phrases.filter(p => p.value > 0);
    if (negPhrases.length === 0) {
        summary += `- Doing well:\n`;
        summary += `  • Minimal negative language detected\n`;
        summary += `- Watch for:\n`;
        summary += `  • Continue avoiding negative phrases\n`;
    } else {
        summary += `- Watch for:\n`;
        negPhrases.sort((a, b) => b.value - a.value).slice(0, 5).forEach(p => {
            summary += `  • "${p.phrase}" - detected in ${p.value} calls\n`;
        });
    }
    summary += `\n`;
    
    // MANAGING EMOTIONS Section
    summary += `MANAGING EMOTIONS\n`;
    summary += `- Coverage: ${emotions.callsDetected} / ${emotions.totalCalls} calls (${emotions.percentage}%)\n`;
    summary += `- Customer emotion indicators detected:\n`;
    const emoTopPhrases = emotions.phrases
        .filter(p => p.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 5);
    emoTopPhrases.forEach(p => {
        summary += `  • "${p.phrase}" - detected in ${p.value} calls\n`;
    });
    summary += `- Opportunity:\n`;
    summary += `  • Use steady language and acknowledgment to manage customer emotions\n`;
    summary += `  • Phrases like "I understand" and "I appreciate" can help de-escalate\n`;
    
    // Display the summary
    document.getElementById('sentimentSummaryText').textContent = summary;
    document.getElementById('sentimentSummaryOutput').style.display = 'block';
    
    showToast('✅ Summary generated successfully', 2000);
}

function parseSentimentFile(fileType, lines) {
    // Parse the "English Speech – Charts Report" format
    const report = {
        associateName: '',
        startDate: '',
        endDate: '',
        totalCalls: 0,
        callsDetected: 0,
        percentage: 0,
        phrases: []
    };
    
    let inKeywordsSection = false;
    
    for (const line of lines) {
        // Extract associate name: look for "Employee:", "Agent:", or "Name:"
        if (!report.associateName) {
            const nameMatch = line.match(/^(?:Employee|Agent|Name)[:\s]+(.+)$/i);
            if (nameMatch) {
                report.associateName = nameMatch[1].trim();
            }
        }
        
        // Extract start date
        if (!report.startDate) {
            const startMatch = line.match(/^Start date[:\s]+([0-9/\-]+)/i);
            if (startMatch) {
                report.startDate = startMatch[1].trim().split(',')[0]; // Remove time if present
            }
        }
        
        // Extract end date
        if (!report.endDate) {
            const endMatch = line.match(/^End date[:\s]+([0-9/\-]+)/i);
            if (endMatch) {
                report.endDate = endMatch[1].trim().split(',')[0]; // Remove time if present
            }
        }
        
        // Extract total calls and calls with category detected
        // Format: "Interactions: 165 (76% out of 218 matching data filter)"
        const interactionsMatch = line.match(/Interactions[:\s]+(\d+)\s*\(.*?(\d+)%.*?out\s+of\s+(\d+)/i);
        if (interactionsMatch) {
            report.callsDetected = parseInt(interactionsMatch[1]);
            report.percentage = parseInt(interactionsMatch[2]);
            report.totalCalls = parseInt(interactionsMatch[3]);
            continue;
        }
        
        // Detect keywords section
        if (line.toLowerCase().includes('keywords') || line.match(/^Name[,\t]/i)) {
            inKeywordsSection = true;
            continue;
        }
        
        // Parse keyword phrases
        // Format: + (A:phrase) VALUE or + (C:phrase) VALUE
        if (inKeywordsSection && report.totalCalls > 0) {
            // Match CSV format with quotes
            const csvQuotedMatch = line.match(/^"([^"]+(?:""[^"]+)*)",(\d+)/);
            if (csvQuotedMatch) {
                let rawPhrase = csvQuotedMatch[1].replace(/""/g, '"').trim();
                const value = parseInt(csvQuotedMatch[2]);
                
                // Extract actual phrase from + (A:phrase) or + (C:phrase) format
                const phraseMatch = rawPhrase.match(/[+\-#]\s*\([AC]:\s*"?([^"]+)"?\)/i);
                if (phraseMatch) {
                    const cleanPhrase = phraseMatch[1].trim();
                    report.phrases.push({ phrase: cleanPhrase, value });
                }
                continue;
            }
            
            // Match simple CSV format
            const csvMatch = line.match(/^([^,]+),(\d+)$/);
            if (csvMatch) {
                let rawPhrase = csvMatch[1].trim();
                const value = parseInt(csvMatch[2]);
                
                // Extract actual phrase
                const phraseMatch = rawPhrase.match(/[+\-#]\s*\([AC]:\s*"?([^"]+)"?\)/i);
                if (phraseMatch) {
                    const cleanPhrase = phraseMatch[1].trim();
                    report.phrases.push({ phrase: cleanPhrase, value });
                } else {
                    // If no prefix, use raw phrase (cleanup quotes)
                    const cleanPhrase = rawPhrase.replace(/^"(.*)"$/, '$1');
                    report.phrases.push({ phrase: cleanPhrase, value });
                }
            }
        }
    }
    
    return report;
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
    
    statusDiv.textContent = `⏳ Processing ${file.name}...`;
    statusDiv.style.color = '#ff9800';
    
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
            const report = parseSentimentFile(fileType, lines);
            sentimentReports[fileType.toLowerCase()] = report;
            
            statusDiv.textContent = `✅ ${report.associateName || 'Loaded'} - ${report.totalCalls} calls, ${report.phrases.length} phrases`;
            statusDiv.style.color = '#4caf50';
        } catch (error) {
            statusDiv.textContent = `❌ Error parsing file`;
            statusDiv.style.color = '#f44336';
            console.error('File parsing error:', error);
        }
    };
    
    if (isExcel) {
        reader.readAsArrayBuffer(file);
    } else {
        reader.readAsText(file);
    }
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

// ============================================
// RED FLAG COACHING FUNCTIONALITY
// ============================================

function initializeRedFlag() {
    document.getElementById('generateRedFlagEmailBtn')?.addEventListener('click', generateRedFlagEmail);
    document.getElementById('copyRedFlagEmailBtn')?.addEventListener('click', copyRedFlagEmail);
    document.getElementById('clearRedFlagEmailBtn')?.addEventListener('click', clearRedFlagEmail);
}

function generateRedFlagEmail() {
    const associateName = document.getElementById('redFlagAssociateName').value.trim();
    const customerName = document.getElementById('redFlagCustomerName').value.trim();
    const accountNumber = document.getElementById('redFlagAccountNumber').value.trim();
    const reason = document.getElementById('redFlagReason').value.trim();
    
    // Validation
    if (!associateName) {
        alert('⚠️ Please enter the associate name.');
        return;
    }
    if (!customerName) {
        alert('⚠️ Please enter the customer name.');
        return;
    }
    if (!accountNumber) {
        alert('⚠️ Please enter the account number.');
        return;
    }
    if (!reason) {
        alert('⚠️ Please enter the red flag reason/details.');
        return;
    }
    
    // Generate email
    const emailTemplate = generateRedFlagEmailTemplate(associateName, customerName, accountNumber, reason);
    
    // Display preview
    document.getElementById('redFlagEmailPreviewText').textContent = emailTemplate;
    document.getElementById('redFlagEmailPreviewSection').style.display = 'block';
    
    
}

function generateRedFlagEmailTemplate(associateName, customerName, accountNumber, reason) {
    const currentDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    
    // Parse the reason to make it more readable
    let parsedReason = reason;
    let specificIssue = '';
    
    // Check for common formats like "Failed KIQ (JAH ADDED WITHOUT ID)"
    if (reason.includes('JAH ADDED WITHOUT ID')) {
        specificIssue = 'An authorized user (JAH - Joint Account Holder) was added to the account without first receiving and verifying their picture ID as required by Experian.';
    } else if (reason.includes('COMPLETED ORDER') && reason.includes('WITHOUT')) {
        specificIssue = 'The order was completed without following required Experian verification procedures.';
    } else if (reason.includes('PICTURE ID') || reason.includes('ID REQUIRED')) {
        specificIssue = 'Required picture ID was not obtained before completing the account modification.';
    } else {
        specificIssue = reason;
    }
    
    const emailTemplate = `Subject: Important Coaching - Compliance with Experian Verification Procedures

Hi ${associateName},

I need to discuss an important compliance matter with you regarding customer ${customerName}, account #${accountNumber}.

Issue Identified:
${reason}

What Happened:
${specificIssue}

Why This Matters:
Following Experian verification procedures is critical for regulatory compliance, fraud prevention, and protecting both our customers and the company. When Experian flags an account for additional verification (such as requiring Picture ID), we must follow those requirements BEFORE completing any account changes.

Correct Procedure:

1. ALWAYS review Experian results carefully before proceeding
2. If Experian indicates "Picture ID Required" or requests additional information:
   - DO NOT add the authorized user (JAH) or complete the order yet
   - Place the order on HOLD
   - Inform the customer that we need the requested documentation
   - Explain what they need to send and how to send it
3. Once the required documents are received:
   - The team member who opens/receives the ID will verify it
   - Only after verification should the order be completed

Common Experian Flags to Watch For:
• Picture ID Required
• Additional Information Needed
• Manual Review Required
• Verification Pending

Expectation Going Forward:
I need you to carefully review ALL Experian results before completing any account modifications, especially when adding authorized users (JAH). If you're ever unsure about what action to take based on Experian's response, please ask a supervisor before proceeding.

This is a serious compliance matter that could result in fraud or regulatory penalties. I trust that you understand the importance of following these procedures consistently. Let's schedule a time to discuss this further and ensure you're comfortable with the verification process.

Please confirm you've received and understood this email.

Thank you,
Management Team`;
    
    return emailTemplate;
}

function copyRedFlagEmail() {
    const emailText = document.getElementById('redFlagEmailPreviewText').textContent;
    
    if (!emailText.trim()) {
        alert('⚠️ No email to copy. Please generate an email first.');
        return;
    }
    
    // Copy to clipboard
    const textarea = document.createElement('textarea');
    textarea.value = emailText;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    
    // Visual feedback
    const button = document.getElementById('copyRedFlagEmailBtn');
    const originalText = button.textContent;
    button.textContent = '✓ Copied! Opening Outlook...';
    
    // Open Outlook
    setTimeout(() => {
        window.open('mailto:', '_blank');
        setTimeout(() => {
            button.textContent = originalText;
        }, 500);
    }, 500);
    
    
}

function clearRedFlagEmail() {
    // Clear form
    document.getElementById('redFlagAssociateName').value = '';
    document.getElementById('redFlagCustomerName').value = '';
    document.getElementById('redFlagAccountNumber').value = '';
    document.getElementById('redFlagReason').value = '';
    
    // Hide preview
    document.getElementById('redFlagEmailPreviewSection').style.display = 'none';
    document.getElementById('redFlagEmailPreviewText').textContent = '';
    
    
}






