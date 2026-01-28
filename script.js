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
let coachingLogYTD = [];
let currentPeriodType = 'week';
let currentPeriod = null;

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
        icon: '⏰',
        target: { type: 'min', value: 93 },
        unit: '%',
        columnIndex: 7,
        chartType: 'line',
        chartColor: '#2196F3',
        defaultTip: "Schedule Adherence: Being present and available is essential. Work on meeting your scheduled hours consistently."
    },
    cxRepOverall: {
        key: 'cxRepOverall',
        label: 'CX Rep Overall',
        icon: '⭐',
        target: { type: 'min', value: 80 },
        unit: '%',
        columnIndex: 14,
        chartType: 'line',
        chartColor: '#4CAF50',
        defaultTip: "CX Rep Overall: Customers appreciate your service! Keep building those strong relationships through empathy and professionalism."
    },
    fcr: {
        key: 'fcr',
        label: 'First Call Resolution',
        icon: '✓',
        target: { type: 'min', value: 70 },
        unit: '%',
        columnIndex: 12,
        chartType: 'line',
        chartColor: '#FF5722',
        defaultTip: "First Call Resolution: You're doing well! Continue focusing on resolving issues on the first contact whenever possible."
    },
    overallExperience: {
        key: 'overallExperience',
        label: 'Overall Experience',
        icon: '🎯',
        target: { type: 'min', value: 81 },
        unit: '%',
        columnIndex: 16,
        chartType: null,
        chartColor: null,
        defaultTip: "Overall Experience: Great job creating positive experiences! Continue to personalize your interactions."
    },
    transfers: {
        key: 'transfers',
        label: 'Transfers',
        icon: '📞',
        target: { type: 'max', value: 6 },
        unit: '%',
        columnIndex: 2,
        chartType: 'bar',
        chartColor: '#FF9800',
        defaultTip: "Transfers: You're managing transfers well. When possible, try to resolve issues yourself to enhance the customer experience."
    },
    overallSentiment: {
        key: 'overallSentiment',
        label: 'Overall Sentiment',
        icon: '😊',
        target: { type: 'min', value: 88 },
        unit: '%',
        columnIndex: 11,
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
        columnIndex: 10,
        chartType: 'line',
        chartColor: '#4CAF50',
        defaultTip: "Positive Word Usage: Your positive language is appreciated! Continue using encouraging and supportive words."
    },
    negativeWord: {
        key: 'negativeWord',
        label: 'Avoid Negative Word',
        icon: '🚫',
        target: { type: 'min', value: 83 },
        unit: '%',
        columnIndex: 9,
        chartType: 'line',
        chartColor: '#F44336',
        defaultTip: "Avoiding Negative Words: You're doing great at keeping conversations positive. Keep it up!"
    },
    managingEmotions: {
        key: 'managingEmotions',
        label: 'Managing Emotions',
        icon: '❤️',
        target: { type: 'min', value: 95 },
        unit: '%',
        columnIndex: 8,
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
        columnIndex: 3,
        chartType: 'line',
        chartColor: '#9C27B0',
        defaultTip: "Average Handle Time: Focus on efficiency without rushing. Prepare your responses, but don't skip necessary steps."
    },
    acw: {
        key: 'acw',
        label: 'After Call Work',
        icon: '📋',
        target: { type: 'max', value: 60 },
        unit: 'sec',
        columnIndex: 6,
        chartType: 'bar',
        chartColor: '#3F51B5',
        defaultTip: "After Call Work: Complete your documentation promptly. This keeps you available for the next customer and maintains accuracy."
    },
    holdTime: {
        key: 'holdTime',
        label: 'Hold Time',
        icon: '☎️',
        target: { type: 'max', value: 30 },
        unit: 'sec',
        columnIndex: 5,
        chartType: 'bar',
        chartColor: '#009688',
        defaultTip: "Hold Time: Minimize hold time by gathering information upfront. It improves customer experience and efficiency."
    },
    reliability: {
        key: 'reliability',
        label: 'Reliability',
        icon: '🛡️',
        target: { type: 'max', value: 16 },
        unit: '%',
        columnIndex: 21,
        chartType: 'bar',
        chartColor: '#795548',
        defaultTip: "Reliability: Your availability is crucial. Work toward reducing unexpected absences and maintaining consistent attendance."
    }
};

// ============================================
// UTILITY FUNCTIONS
// ============================================

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
        return nicknames[employeeFullName] || null;
    } catch (error) {
        console.error('Error loading nickname:', error);
        return null;
    }
}

// ============================================
// SECTION NAVIGATION
// ============================================

function showOnlySection(sectionId) {
    const sections = [
        'coachingForm',
        'coachingSection',
        'resultsSection',
        'dashboardSection',
        'tipsManagementSection',
        'metricTrendsSection',
        'manageDataSection',
        'executiveSummarySection'
    ];
    
    sections.forEach(section => {
        const el = document.getElementById(section);
        if (el) el.style.display = (section === sectionId) ? 'block' : 'none';
    });
    
    // Hide employee-specific sections when switching away
    if (sectionId !== 'coachingSection') {
        ['metricsSection', 'employeeInfoSection', 'customNotesSection', 'generateEmailBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }
    
    localStorage.setItem('activeSection', sectionId);
    updateTabHighlight(sectionId);
}

// Initialize data for the active section
function initializeSection(sectionId) {
    switch (sectionId) {
        case 'coachingForm':
            // Home tab - no initialization needed (form is static)
            break;
        case 'coachingSection':
            // Generate Coaching tab - reset employee selection
            resetEmployeeSelection();
            break;
        case 'dashboardSection':
            // Employee Dashboard - render employee history
            renderEmployeeHistory();
            break;
        case 'tipsManagementSection':
            // Manage Tips - render tips management interface
            renderTipsManagement();
            break;
        case 'metricTrendsSection':
            // Metric Trends - initialize trend email generator
            initializeMetricTrends();
            break;
        case 'manageDataSection':
            // Manage Data - populate delete week dropdown
            populateDeleteWeekDropdown();
            break;
        case 'executiveSummarySection':
            // Executive Summary - render summary
            renderExecutiveSummary();
            break;
        default:
            // No initialization needed
            break;
    }
}

function updateTabHighlight(activeSectionId) {
    const tabMapping = {
        'coachingForm': 'homeBtn',
        'coachingSection': 'generateCoachingBtn',
        'dashboardSection': 'employeeDashboard',
        'tipsManagementSection': 'manageTips',
        'metricTrendsSection': 'metricTrendsBtn',
        'manageDataSection': 'manageDataBtn',
        'executiveSummarySection': 'executiveSummaryBtn'
    };
    
    // Reset all buttons
    ['homeBtn', 'generateCoachingBtn', 'employeeDashboard', 'manageTips', 'metricTrendsBtn', 'manageDataBtn', 'executiveSummaryBtn'].forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.style.background = '#e9ecef';
            btn.style.color = '#333';
        }
    });
    
    // Highlight active button
    const activeButtonId = tabMapping[activeSectionId];
    if (activeButtonId) {
        const activeBtn = document.getElementById(activeButtonId);
        if (activeBtn) {
            activeBtn.style.background = '#2196F3';
            activeBtn.style.color = 'white';
        }
    }
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
        console.warn(`?? Unexpected percentage value: ${parsed}. Treating as 0.`);
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
        console.warn(`?? Unexpected survey percentage: ${parsed}. Treating as empty.`);
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

// POWERBI SCHEMA - EXACTLY 22 COLUMNS IN THIS ORDER
// This is the ground truth for all data parsing
const POWERBI_COLUMNS = [
    'Name (Last, First)',
    'TotalCallsAnswered',
    'Transfers%',
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
    3: CANONICAL_SCHEMA.AHT_SECONDS,
    4: CANONICAL_SCHEMA.TALK_SECONDS,
    5: CANONICAL_SCHEMA.HOLD_SECONDS,
    6: CANONICAL_SCHEMA.ACW_SECONDS,
    7: CANONICAL_SCHEMA.ADHERENCE_PERCENT,
    8: CANONICAL_SCHEMA.EMOTIONS_PERCENT,
    9: CANONICAL_SCHEMA.NEGATIVE_WORD_PERCENT,
    10: CANONICAL_SCHEMA.POSITIVE_WORD_PERCENT,
    11: CANONICAL_SCHEMA.SENTIMENT_PERCENT,
    12: CANONICAL_SCHEMA.FCR_PERCENT,
    13: CANONICAL_SCHEMA.CX_REP_OVERALL, // OverallFCRTotal
    14: CANONICAL_SCHEMA.CX_REP_OVERALL, // RepSat%
    15: CANONICAL_SCHEMA.CX_REP_OVERALL, // OverallRepTotal
    16: CANONICAL_SCHEMA.OVERALL_EXPERIENCE,
    17: CANONICAL_SCHEMA.SURVEY_TOTAL,   // OE Survey Total
    18: 'TotalIn-OfficeShrink%',
    19: 'TotalOOOShrink%',
    20: 'TotalShrinkage%',
    21: CANONICAL_SCHEMA.RELIABILITY_HOURS
};

// Map headers to canonical schema - validates we have exactly 22 columns
function mapHeadersToSchema(headers) {
    // Validate we have exactly 22 columns
    if (headers.length !== 22) {
        throw new Error(`Expected exactly 22 columns, found ${headers.length}. PowerBI data must have all 22 columns in order.`);
    }
    
    const mapping = {};
    console.log('? Detected 22 columns - using positional mapping');
    
    // Map by position
    for (let i = 0; i < 22; i++) {
        if (COLUMN_MAPPING[i]) {
            mapping[COLUMN_MAPPING[i]] = i;
        }
    }
    
    console.log('?? Column Mapping:');
    for (let i = 0; i < 22; i++) {
        console.log(`  [${i}] ${headers[i]}`);
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
    
    console.log('?? Using Smart PowerBI Parser');
    
    // Skip the header line - we don't need to parse it since we use positional logic
    // We just validate that the first row looks like a header
    const headerLine = lines[0];
    const hasNameHeader = headerLine.toLowerCase().includes('name');
    
    if (!hasNameHeader) {
        throw new Error('? Header row not found! Make sure to include the header row at the top of your pasted data.');
    }
    
    console.log('? Header detected, parsing data rows...');
    
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
            console.warn(`?? Skipping row ${i}: ${error.message}`);
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
        const nameParts = nameField.match(/^([^,]+),\s*(.+)$/);
        const lastName = nameParts ? nameParts[1].trim() : '';
        const firstName = nameParts ? nameParts[2].trim() : '';
        const displayName = `${firstName} ${lastName}`;
        
        console.log(`? ${displayName} - ${cells.length}/22 cells`);
        
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
            cxRepOverall: surveyTotal > 0 ? parseSurveyPercentage(getCell(METRICS_REGISTRY.cxRepOverall.columnIndex)) : '',
            fcr: surveyTotal > 0 ? parseSurveyPercentage(getCell(METRICS_REGISTRY.fcr.columnIndex)) : '',
            overallExperience: surveyTotal > 0 ? parseSurveyPercentage(getCell(METRICS_REGISTRY.overallExperience.columnIndex)) : '',
            transfers: parsePercentage(getCell(METRICS_REGISTRY.transfers.columnIndex)) || 0,
            aht: parseSeconds(getCell(METRICS_REGISTRY.aht.columnIndex)) || '',
            talkTime: parseSeconds(getCell(4)) || '',
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
            console.log(`\n? ${displayName}:`);
            console.log('  Transfers:', employeeData.transfers + '%');
            console.log('  Adherence:', employeeData.scheduleAdherence + '%');
            console.log('  TotalCalls:', totalCalls);
            console.log('  SurveyTotal:', surveyTotal);
        }
        
        employees.push(employeeData);
    }
    
    console.log(`? Parsed ${employees.length} employees`);
    
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

function hasDataForTimeframe(employeeData, timeframe) {
    if (!employeeData || employeeData.length === 0) return false;
    
    if (timeframe === 'week') {
        return employeeData.length >= 1;
    } else if (timeframe === 'month') {
        return employeeData.length >= 4;
    } else if (timeframe === 'quarter') {
        return employeeData.length >= 13;
    }
    return false;
}


// ============================================
// STORAGE FUNCTIONS
// ============================================

function loadWeeklyData() {
    try {
        const saved = localStorage.getItem('weeklyData');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading weekly data:', error);
        return {};
    }
}

function saveWeeklyData() {
    try {
        localStorage.setItem('weeklyData', JSON.stringify(weeklyData));
    } catch (error) {
        console.error('Error saving weekly data:', error);
    }
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

function loadCoachingLog() {
    try {
        const saved = localStorage.getItem('coachingLogYTD');
        return saved ? JSON.parse(saved) : [];
    } catch (error) {
        console.error('Error loading coaching log:', error);
        return [];
    }
}

function saveCoachingLog() {
    try {
        localStorage.setItem('coachingLogYTD', JSON.stringify(coachingLogYTD));
    } catch (error) {
        console.error('Error saving coaching log:', error);
    }
}

function appendCoachingLogEntry(entry) {
    const generatedAt = entry.generatedAt || new Date().toISOString();
    coachingLogYTD.push({ ...entry, generatedAt, timestamp: Date.now() });
    saveCoachingLog();
}

function getActivePeriodContext() {
    const metadata = currentPeriod && weeklyData[currentPeriod]?.metadata ? weeklyData[currentPeriod].metadata : null;
    
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
    if (currentPeriod && weeklyData[currentPeriod]) {
        weeklyData[currentPeriod].employees.forEach(emp => employees.add(emp.name));
    } else if (currentPeriodType === 'ytd' && currentPeriod) {
        // For YTD: aggregate all weeks in the year
        Object.keys(weeklyData).forEach(weekKey => {
            const [year] = weekKey.split('|')[0].split('-');
            if (year === currentPeriod) {
                weeklyData[weekKey].employees.forEach(emp => employees.add(emp.name));
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
    if (currentPeriod && weeklyData[currentPeriod]) {
        const week = weeklyData[currentPeriod];
        if (week && week.employees) {
            return week.employees.find(emp => emp.name === employeeName);
        }
    } else if (currentPeriodType === 'ytd' && currentPeriod) {
        // For YTD: aggregate all weeks in the year
        const weekKeys = Object.keys(weeklyData).filter(weekKey => {
            const [year] = weekKey.split('|')[0].split('-');
            return year === currentPeriod;
        });
        
        // Calculate averages
        const values = {
            scheduleAdherence: [],
            cxRepOverall: [],
            fcr: [],
            overallExperience: [],
            transfers: [],
            overallSentiment: [],
            positiveWord: [],
            negativeWord: [],
            managingEmotions: [],
            aht: [],
            acw: [],
            holdTime: [],
            reliability: [],
            surveyTotal: 0
        };
        
        weekKeys.forEach(weekKey => {
            const week = weeklyData[weekKey];
            if (week && week.employees) {
                const emp = week.employees.find(e => e.name === employeeName);
                if (emp) {
                    Object.keys(values).forEach(key => {
                        if (key === 'surveyTotal') {
                            values.surveyTotal += (emp.surveyTotal || 0);
                        } else if (emp[key] && emp[key] !== '') {
                            values[key].push(emp[key]);
                        }
                    });
                }
            }
        });
        
        // Calculate averages
        const avgData = {
            name: employeeName,
            firstName: employeeName.split(' ')[0],
            surveyTotal: values.surveyTotal
        };
        
        Object.keys(values).forEach(key => {
            if (key !== 'surveyTotal' && values[key].length > 0) {
                const sum = values[key].reduce((a, b) => a + b, 0);
                avgData[key] = parseFloat((sum / values[key].length).toFixed(2));
            } else if (key !== 'surveyTotal') {
                avgData[key] = '';
            }
        });
        
        return avgData;
    }
    
    return null;
}

function updatePeriodDropdown() {
    const dropdown = document.getElementById('specificPeriod');
    if (!dropdown) return;
    
    dropdown.innerHTML = '<option value="">-- Choose a date range --</option>';
    
    const periods = [];
    
    Object.keys(weeklyData).forEach(weekKey => {
        const metadata = weeklyData[weekKey].metadata;
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
        showToast('❌ Failed to copy to clipboard');
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
    document.getElementById('generateCoachingBtn')?.addEventListener('click', () => {
        showOnlySection('coachingSection');
        resetEmployeeSelection();
    });
    document.getElementById('employeeDashboard')?.addEventListener('click', () => {
        showOnlySection('dashboardSection');
        renderEmployeeHistory();
    });
    document.getElementById('manageTips')?.addEventListener('click', () => {
        showOnlySection('tipsManagementSection');
        renderTipsManagement();
    });
    document.getElementById('metricTrendsBtn')?.addEventListener('click', () => {
        showOnlySection('metricTrendsSection');
        initializeMetricTrends();
    });
    document.getElementById('manageDataBtn')?.addEventListener('click', () => {
        showOnlySection('manageDataSection');
        populateDeleteWeekDropdown();
        renderEmployeesList();
    });
    document.getElementById('executiveSummaryBtn')?.addEventListener('click', () => {
        showOnlySection('executiveSummarySection');
        renderExecutiveSummary();
    });
    

    
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
                alert('❌ No valid employee data found');
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
            }
            
            weeklyData[weekKey] = {
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
            populateDeleteWeekDropdown();
            
            // Show success
            document.getElementById('uploadSuccessMessage').style.display = 'block';
            document.getElementById('pasteDataTextarea').value = '';
            
            // Auto-switch to Coaching tab
            showOnlySection('coachingSection');
            
            // Refresh Generate Coaching UI with new data
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
            
            alert(`✅ Loaded ${employees.length} employees for ${label}!\n\nSelect an employee below to generate coaching email.`);
            
        } catch (error) {
            console.error('Error parsing pasted data:', error);
            alert(`? Error parsing data: ${error.message}\n\nPlease ensure you copied the full table with headers from PowerBI.`);
        }
    });
    
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
            alert('❌ Error loading employee data');
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
        document.getElementById('employeeName').value = savedNickname || employee.firstName || '';
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
    
    // Save nickname on blur
    document.getElementById('employeeName')?.addEventListener('blur', (e) => {
        const employeeSelect = document.getElementById('employeeSelect');
        const selectedName = employeeSelect?.value;
        const nickname = e.target.value.trim();
        
        if (selectedName && nickname) {
            saveNickname(selectedName, nickname);
        }
    });
    
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
    
    // Enable Generate Email button when Copilot output is pasted
    document.getElementById('copilotOutputText')?.addEventListener('input', (e) => {
        const outlookBtn = document.getElementById('generateOutlookEmailBtn');
        const verintBtn = document.getElementById('generateVerintSummaryBtn');
        const hasContent = e.target.value.trim().length > 0;
        
        if (outlookBtn) {
            outlookBtn.disabled = !hasContent;
            outlookBtn.style.opacity = hasContent ? '1' : '0.5';
            outlookBtn.style.cursor = hasContent ? 'pointer' : 'not-allowed';
        }
        
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
    
    // Generate Outlook Email Button
    document.getElementById('generateOutlookEmailBtn')?.addEventListener('click', () => {
        generateOutlookEmail();
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
                
                saveWeeklyData();
                
                showToast('✅ Data imported successfully!');
                document.getElementById('dataFileInput').value = '';
                populateDeleteWeekDropdown();
            } catch (error) {
                console.error('Error importing data:', error);
                alert('❌ Error importing data: ' + error.message);
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
        saveWeeklyData();
        
        populateDeleteWeekDropdown();
        showToast('✅ Week deleted successfully');
        
        // Clear coaching form if needed
        document.getElementById('employeeSelect').value = '';
        ['metricsSection', 'employeeInfoSection', 'customNotesSection', 'generateEmailBtn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    });
    
    
    // Delete all data
    document.getElementById('deleteAllDataBtn')?.addEventListener('click', () => {
        const weekCount = Object.keys(weeklyData).length;
        
        if (weekCount === 0) {
            alert('ℹ️ No data to delete');
            return;
        }
        
        const message = `⚠️ WARNING: This will permanently delete:\n\n` +
            `📊 ${weekCount} week(s) of employee data\n\n` +
            `This action CANNOT be undone!\n\n` +
            `Type "DELETE" to confirm:`;
        
        const confirmation = prompt(message);
        
        if (confirmation !== 'DELETE') {
            alert('ℹ️ Deletion cancelled');
            return;
        }
        
        // Clear all data
        weeklyData = {};
        
        saveWeeklyData();
        
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
}

function populateDeleteWeekDropdown() {
    const dropdown = document.getElementById('deleteWeekSelect');
    if (!dropdown) return;
    
    dropdown.innerHTML = '<option value="">-- Choose a week --</option>';
    
    const weeks = Object.keys(weeklyData).map(weekKey => {
        const endDate = new Date(weekKey.split('|')[1]);
        const label = `Week ending ${endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
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
                showToast('🧹 Form cleared');
            }
        }
    });
}

// TO BE CONTINUED WITH TIPS MANAGEMENT, HISTORY, AND EXPORT FUNCTIONS...

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
    
    let html = '<div style="margin-bottom: 20px;">';
    html += '<p>Select a metric to view and manage its coaching tips. Server tips (from tips.csv) are shown in blue and are read-only. Your custom tips can be edited or deleted.</p>';
    html += '</div>';
    
    // Manage Existing Metric section (default visible)
    html += '<div id="manageMetricSection" style="margin-bottom: 25px; padding: 20px; background: white; border-radius: 8px; border: 2px solid #2196F3;">';
    html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">';
    html += '<label for="metricSelector" style="font-weight: bold; color: #2196F3; font-size: 1.1em; margin: 0;">Select Metric:</label>';
    html += '<button id="newMetricBtn" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 10px 16px; cursor: pointer; font-weight: bold; font-size: 0.95em;">+ New Metric</button>';
    html += '</div>';
    html += '<select id="metricSelector" style="width: 100%; padding: 12px; border: 2px solid #2196F3; border-radius: 4px; font-size: 1em; cursor: pointer;">';
    html += '<option value="">-- Choose a metric --</option>';
    // Sort metrics alphabetically by label
    Object.keys(metricNames)
        .sort((a, b) => metricNames[a].localeCompare(metricNames[b]))
        .forEach(metricKey => {
            html += `<option value="${metricKey}">${metricNames[metricKey]}</option>`;
        });
    html += '</select>';
    html += '</div>';
    
    // Create New Metric section (hidden by default)
    html += '<div id="createMetricSection" style="display: none; margin-bottom: 25px; padding: 20px; background: #f0f8ff; border-radius: 8px; border: 2px dashed #2196F3;">';
    html += '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">';
    html += '<h3 style="color: #2196F3; margin: 0;">? Create New Metric</h3>';
    html += '<button id="backToManageBtn" style="background: #6c757d; color: white; border: none; border-radius: 4px; padding: 8px 16px; cursor: pointer; font-weight: bold; font-size: 0.95em;">Back</button>';
    html += '</div>';
    html += '<div style="margin-bottom: 12px;">';
    html += '<label for="newMetricName" style="font-weight: bold; display: block; margin-bottom: 5px; color: #1976D2;">Metric Name:</label>';
    html += '<input type="text" id="newMetricName" placeholder="e.g., Accuracy, Compliance, Efficiency" style="width: 100%; padding: 10px; border: 2px solid #2196F3; border-radius: 4px; font-size: 0.95em; box-sizing: border-box;">';
    html += '</div>';
    html += '<div style="margin-bottom: 12px;">';
    html += '<label for="newMetricTip" style="font-weight: bold; display: block; margin-bottom: 5px; color: #1976D2;">First Tip:</label>';
    html += '<textarea id="newMetricTip" placeholder="Enter a coaching tip for this new metric..." style="width: 100%; padding: 10px; border: 2px solid #2196F3; border-radius: 4px; font-size: 0.95em; resize: vertical; box-sizing: border-box;" rows="2"></textarea>';
    html += '</div>';
    html += '<button id="createMetricBtn" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 10px 20px; cursor: pointer; font-weight: bold;">Create Metric</button>';
    html += '</div>';
    
    // Tips display area
    html += '<div id="tipsDisplayArea" style="display: none;"></div>';
    
    container.innerHTML = html;
    
    // Helper function to switch to create mode
    function switchToCreateMode() {
        document.getElementById('manageMetricSection').style.display = 'none';
        document.getElementById('createMetricSection').style.display = 'block';
        document.getElementById('tipsDisplayArea').style.display = 'none';
        document.getElementById('metricSelector').value = '';
        document.getElementById('newMetricName').value = '';
        document.getElementById('newMetricTip').value = '';
        document.getElementById('newMetricName').focus();
    }
    
    // Helper function to switch back to manage mode
    function switchToManageMode() {
        document.getElementById('manageMetricSection').style.display = 'block';
        document.getElementById('createMetricSection').style.display = 'none';
        document.getElementById('tipsDisplayArea').style.display = 'none';
        document.getElementById('metricSelector').value = '';
    }
    
    // + New Metric button handler
    document.getElementById('newMetricBtn').addEventListener('click', switchToCreateMode);
    
    // Back button handler
    document.getElementById('backToManageBtn').addEventListener('click', switchToManageMode);
    
    // Create metric button handler
    document.getElementById('createMetricBtn').addEventListener('click', () => {
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
        renderTipsManagement();
    });
    
    // Add change listener for metric selection
    document.getElementById('metricSelector').addEventListener('change', async (e) => {
        const metricKey = e.target.value;
        const displayArea = document.getElementById('tipsDisplayArea');
        
        if (!metricKey) {
            displayArea.style.display = 'none';
            return;
        }
        
        // Exit create mode if we were in it
        document.getElementById('manageMetricSection').style.display = 'block';
        document.getElementById('createMetricSection').style.display = 'none';
        
        displayArea.style.display = 'block';
        const currentServerTips = await loadServerTips();
        const currentUserTips = loadUserTips();
        const serverTipsForMetric = currentServerTips[metricKey] || [];
        const serverTipsWithIndex = (window._serverTipsWithIndex && window._serverTipsWithIndex[metricKey]) || [];
        const userTipsForMetric = currentUserTips[metricKey] || [];
        const metricName = metricNames[metricKey];
        
        let tipsHtml = `<div style="padding: 20px; background: #f8f9fa; border-radius: 8px;">`;
        tipsHtml += `<h3 style="color: #2196F3; margin-top: 0; border-bottom: 2px solid #2196F3; padding-bottom: 10px;">${metricName}</h3>`;
        
        // Server tips - use original indices
        if (serverTipsWithIndex.length > 0) {
            tipsHtml += '<div style="margin: 20px 0;"><h4 style="color: #1976D2; margin-bottom: 12px;">📋 Server Tips (from tips.csv)</h4>';
            serverTipsWithIndex.forEach((tipObj) => {
                // Safety check for tipObj structure
                if (!tipObj || typeof tipObj.originalIndex === 'undefined') {
                    console.warn('Invalid tip object:', tipObj);
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
            tipsHtml += '</div>';
        } else if (serverTipsForMetric.length === 0) {
            tipsHtml += '<div style="margin: 20px 0; padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;"><em>No server tips found for this metric in tips.csv</em></div>';
        }
        
        // Custom tips
        tipsHtml += '<div style="margin: 25px 0;"><h4 style="color: #28a745; margin-bottom: 12px;">✏️ Your Custom Tips</h4>';
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
        
        // Add new tip (single section)
        tipsHtml += `
            <div style="margin-top: 15px; padding: 15px; background: white; border-radius: 8px; border: 2px dashed #28a745;">
                <textarea id="newTip_${metricKey}" placeholder="Enter a new custom coaching tip for ${metricName}..." style="width: 100%; padding: 12px; border: 2px solid #28a745; border-radius: 4px; font-size: 0.95em; resize: vertical; margin-bottom: 10px;" rows="3"></textarea>
                <button onclick="addTip('${metricKey}')" style="background: #28a745; color: white; border: none; border-radius: 4px; padding: 10px 20px; cursor: pointer; font-size: 1em; font-weight: bold;">➕ Add Custom Tip</button>
            </div>
        `;
        tipsHtml += '</div>';
        displayArea.innerHTML = tipsHtml;
    });
}

window.addTip = function(metricKey) {
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
    
    // Re-trigger the dropdown to refresh the display
    const selector = document.getElementById('metricSelector');
    if (selector && selector.value) {
        selector.dispatchEvent(new Event('change'));
    } else {
        renderTipsManagement();
    }
};

window.updateTip = function(metricKey, index) {
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
        
        // Re-trigger the dropdown to refresh the display
        const selector = document.getElementById('metricSelector');
        if (selector && selector.value) {
            selector.dispatchEvent(new Event('change'));
        }
    } else {
        console.warn(`Invalid index ${index} for metric ${metricKey}`);
        showToast('⚠️ Could not update tip - please refresh the page');
    }
};

window.updateServerTip = function(metricKey, index) {
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
    
    // Re-trigger the dropdown to refresh the display
    const selector = document.getElementById('metricSelector');
    if (selector && selector.value) {
        selector.dispatchEvent(new Event('change'));
    }
};

window.deleteServerTip = function(metricKey, index) {
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
    
    showToast('🗑️ Server tip deleted');
    
    // Re-trigger the dropdown to refresh the display
    const selector = document.getElementById('metricSelector');
    if (selector && selector.value) {
        selector.dispatchEvent(new Event('change'));
    }
};

window.deleteTip = function(metricKey, index) {
    if (!confirm('Are you sure you want to delete this tip?')) {
        return;
    }
    
    const userTips = loadUserTips();
    if (userTips[metricKey] && Array.isArray(userTips[metricKey])) {
        // Validate index is within bounds
        if (index < 0 || index >= userTips[metricKey].length) {
            console.warn(`Invalid index ${index} for deletion. Array length: ${userTips[metricKey].length}`);
            showToast('⚠️ Could not delete tip - please refresh the page');
            return;
        }
        
        userTips[metricKey].splice(index, 1);
        if (userTips[metricKey].length === 0) {
            delete userTips[metricKey];
        }
        saveUserTips(userTips);
        
        showToast('🗑️ Tip deleted');
    } else {
        console.warn(`No tips found for metric ${metricKey}`);
        showToast('⚠️ Could not delete tip - please refresh the page');
        return;
    }
    
    // Re-trigger the dropdown to refresh the display
    const selector = document.getElementById('metricSelector');
    if (selector && selector.value) {
        selector.dispatchEvent(new Event('change'));
    } else {
        renderTipsManagement();
    }
};

// ============================================
// EMPLOYEE HISTORY UI
// ============================================

// Chart.js value label plugin (inline, no external deps)
const valueLabelPlugin = {
    id: 'valueLabelPlugin',
    afterDatasetsDraw(chart) {
        const { ctx, scales } = chart;
        const fontSize = 10;
        ctx.save();
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = '#444';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';

        chart.data.datasets.forEach((dataset, datasetIndex) => {
            if (dataset.skipValueLabel) return;
            const meta = chart.getDatasetMeta(datasetIndex);
            meta.data.forEach((element, index) => {
                const value = dataset.data[index];
                if (value === null || value === undefined || isNaN(value)) return;

                const unit = dataset.valueUnit || '';
                const formatted = `${value}${unit}`;
                const position = element.tooltipPosition();
                // Nudge labels slightly above the element for readability
                const offsetY = dataset.type === 'bar' ? 6 : 8;
                const y = position.y - offsetY;
                // Keep labels inside chart area when near top
                const minY = scales.y?.top || 0;
                const finalY = Math.max(y, minY + fontSize + 2);
                ctx.fillText(formatted, position.x, finalY);
            });
        });
        ctx.restore();
    }
};
if (typeof Chart !== 'undefined' && Chart.register) {
    Chart.register(valueLabelPlugin);
}

function renderEmployeeHistory() {
    const container = document.getElementById('historyContainer');
    const selector = document.getElementById('historyEmployeeSelect');
    if (!container || !selector) return;
    
    // Populate employee selector
    const allEmployees = new Set();
    Object.keys(weeklyData).forEach(weekKey => {
        if (weeklyData[weekKey].employees) {
            weeklyData[weekKey].employees.forEach(emp => allEmployees.add(emp.name));
        }
    });
    
    selector.innerHTML = '<option value="">-- Choose an employee --</option>';
    Array.from(allEmployees).sort().forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        selector.appendChild(option);
    });
    
    // Add change listener
    selector.removeEventListener('change', handleEmployeeHistorySelection); // Remove old listener
    selector.addEventListener('change', handleEmployeeHistorySelection);
    
    // Initial state
    const historyContainer = document.getElementById('historyContainer');
    if (historyContainer) {
        historyContainer.innerHTML = '<p style="color: #666; font-style: italic; padding: 20px; text-align: center;">Select an employee above to view their performance trends.</p>';
    }
    
    // Reset timeframe to week and hide until employee selected
    document.getElementById('timeframeSelectorContainer').style.display = 'none';
    document.getElementById('underperformingSnapshot').style.display = 'none';
    
    // Add timeframe button listeners
    ['timeframeWeek', 'timeframeMonth', 'timeframeQuarter'].forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.addEventListener('click', () => {
                // Check if this button's timeframe has data
                const employeeSelect = document.getElementById('historyEmployeeSelect');
                if (employeeSelect && employeeSelect.value) {
                    const employeeName = employeeSelect.value;
                    
                    // Collect all data for this employee
                    const employeeData = [];
                    Object.keys(weeklyData).sort().forEach(weekKey => {
                        const week = weeklyData[weekKey];
                        if (week.employees) {
                            const empData = week.employees.find(e => e.name === employeeName);
                            if (empData) {
                                employeeData.push({
                                    weekKey: weekKey,
                                    startDate: week.metadata.startDate,
                                    endDate: week.metadata.endDate,
                                    label: week.metadata.label,
                                    ...empData
                                });
                            }
                        }
                    });
                    
                    const timeframe = btnId.replace('timeframe', '').toLowerCase();
                    
                    // Only allow selection if data exists for this timeframe
                    if (!hasDataForTimeframe(employeeData, timeframe)) {
                        showToast(`\u26a0\ufe0f No data available for ${timeframe} view. Need ${timeframe === 'month' ? '4 weeks' : timeframe === 'quarter' ? '13 weeks' : '1 week'}.`);
                        return;
                    }
                    
                    // Update button styles
                    document.querySelectorAll('.timeframe-btn').forEach(b => {
                        b.style.background = 'white';
                        b.style.color = '#666';
                        b.style.borderColor = '#ddd';
                    });
                    btn.style.background = '#FF9800';
                    btn.style.color = 'white';
                    btn.style.borderColor = '#FF9800';
                    
                    // Re-render with new timeframe
                    handleEmployeeHistorySelection({ target: employeeSelect });
                }
            });
        }
    });
}

function handleEmployeeHistorySelection(e) {
    const employeeName = e.target.value;
    const container = document.getElementById('historyContainer');
    const timeframeContainer = document.getElementById('timeframeSelectorContainer');
    const snapshotContainer = document.getElementById('underperformingSnapshot');
    
    if (!employeeName || !container) {
        container.innerHTML = '<p style="color: #666; font-style: italic; padding: 20px; text-align: center;">Select an employee above to view their performance trends.</p>';
        timeframeContainer.style.display = 'none';
        snapshotContainer.style.display = 'none';
        return;
    }
    
    // Show timeframe selector
    timeframeContainer.style.display = 'block';
    
    // Get selected timeframe
    const activeBtn = document.querySelector('.timeframe-btn[style*="background: rgb(255, 152, 0)"], .timeframe-btn[style*="background:#FF9800"]') || document.getElementById('timeframeWeek');
    const timeframe = activeBtn.id.replace('timeframe', '').toLowerCase();
    
    // Collect all data for this employee
    const employeeData = [];
    Object.keys(weeklyData).sort().forEach(weekKey => {
        const week = weeklyData[weekKey];
        if (week.employees) {
            const empData = week.employees.find(e => e.name === employeeName);
            if (empData) {
                employeeData.push({
                    weekKey: weekKey,
                    startDate: week.metadata.startDate,
                    endDate: week.metadata.endDate,
                    label: week.metadata.label,
                    ...empData
                });
            }
        }
    });
    
    if (employeeData.length === 0) {
        container.innerHTML = '<p style="color: #666; font-style: italic;">No data found for this employee.</p>';
        timeframeContainer.style.display = 'none';
        snapshotContainer.style.display = 'none';
        return;
    }
    
    // Sort by date
    employeeData.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    
    // Filter data by timeframe
    let filteredData = employeeData;
    if (timeframe === 'month') {
        // Last 4 weeks
        filteredData = employeeData.slice(-4);
    } else if (timeframe === 'quarter') {
        // Last 13 weeks
        filteredData = employeeData.slice(-13);
    } else {
        // Week - show latest
        filteredData = employeeData.slice(-1);
    }
    
    // Calculate underperforming metrics using METRICS_REGISTRY
    const latestData = filteredData[filteredData.length - 1];
    const underperforming = [];
    
    Object.values(METRICS_REGISTRY).forEach(metric => {
        const value = latestData[metric.key];
        if (value !== '' && value !== null && value !== undefined) {
            const numVal = parseFloat(value);
            if (!isNaN(numVal)) {
                const meetsTarget = metric.target.type === 'min' ? numVal >= metric.target.value : numVal <= metric.target.value;
                if (!meetsTarget) {
                    underperforming.push({
                        label: metric.label,
                        value: numVal,
                        target: metric.target.value,
                        unit: metric.unit,
                        type: metric.target.type
                    });
                }
            }
        }
    });
    
    // Render underperforming snapshot
    if (underperforming.length > 0) {
        let snapshotHtml = '<div style="margin-bottom: 30px; padding: 20px; background: #fff3cd; border-left: 4px solid #ff9800; border-radius: 8px;">';
        snapshotHtml += '<h4 style="color: #856404; margin-top: 0;">?? Metrics Below Target</h4>';
        snapshotHtml += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 15px;">';
        
        underperforming.forEach(item => {
            const gap = item.type === 'min' 
                ? (item.target - item.value).toFixed(1)
                : (item.value - item.target).toFixed(1);
            
            snapshotHtml += `
                <div style="padding: 15px; background: white; border-radius: 4px;">
                    <div style="font-weight: bold; color: #856404; margin-bottom: 5px;">${escapeHtml(item.label)}</div>
                    <div style="font-size: 1.4em; font-weight: bold; color: #d9534f; margin-bottom: 3px;">${item.value}${item.unit}</div>
                    <div style="font-size: 0.9em; color: #666;">Target: ${item.target}${item.unit}</div>
                    <div style="font-size: 0.85em; color: #856404; margin-top: 3px;">Gap: ${gap}${item.unit}</div>
                </div>
            `;
        });
        
        snapshotHtml += '</div></div>';
        snapshotContainer.innerHTML = snapshotHtml;
        snapshotContainer.style.display = 'block';
    } else {
        snapshotContainer.innerHTML = '<div style="margin-bottom: 30px; padding: 20px; background: #d4edda; border-left: 4px solid #28a745; border-radius: 8px;"><h4 style="color: #155724; margin-top: 0;">? All Metrics Meeting Target</h4></div>';
        snapshotContainer.style.display = 'block';
    }

    // Coaching history (persistent; context only)
    const coachingEvents = (coachingLogYTD || []).filter(evt => evt.employeeId === employeeName);
    coachingEvents.sort((a, b) => {
        const dateA = new Date(a.generatedAt || a.timestamp || 0).getTime();
        const dateB = new Date(b.generatedAt || b.timestamp || 0).getTime();
        return dateB - dateA;
    });
    let coachingHistoryHtml = '<div style="margin-bottom: 25px; padding: 20px; background: #f5f7fb; border-radius: 8px; border: 1px solid #e0e7ff;">';
    coachingHistoryHtml += '<h4 style="margin-top: 0; color: #3f51b5;">?? Coaching History</h4>';
    if (coachingEvents.length === 0) {
        coachingHistoryHtml += '<div style="color: #666; font-style: italic;">No coaching sessions logged yet.</div>';
    } else {
        coachingEvents.forEach(evt => {
            const eventDate = evt.generatedAt ? new Date(evt.generatedAt).toLocaleString() : 'Unknown date';
            const metrics = (evt.metricsCoached || []).map(key => METRICS_REGISTRY[key]?.label || key).join(', ') || 'None recorded';
            const weekEnding = evt.weekEnding || 'unspecified period';
            const aiFlag = evt.aiAssisted ? 'AI-assisted' : 'Manual';
            coachingHistoryHtml += `
                <div style="padding: 12px 0; border-bottom: 1px solid #e0e7ff;">
                    <div style="font-weight: bold; color: #3f51b5;">${eventDate}</div>
                    <div style="font-size: 0.95em; color: #333;">Week ending: ${escapeHtml(weekEnding)}</div>
                    <div style="font-size: 0.95em; color: #333;">Metrics coached: ${escapeHtml(metrics)}</div>
                    <div style="font-size: 0.9em; color: #666;">${aiFlag}</div>
                </div>
            `;
        });
    }
    coachingHistoryHtml += '</div>';
    
    // Build HTML for trends (always show charts even with one data point)
    let html = `<div style="margin-bottom: 30px;">`;
    html += `<h3 style="color: #2196F3; border-bottom: 3px solid #2196F3; padding-bottom: 10px;">${escapeHtml(employeeName)}</h3>`;
    html += coachingHistoryHtml;
    
    // Summary cards
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin: 20px 0;">';
    html += `
        <div style="padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px; text-align: center;">
            <div style="font-size: 2em;">??</div>
            <div style="font-size: 1.6em; font-weight: bold; margin: 8px 0;">${employeeData.length}</div>
            <div style="font-size: 0.9em; opacity: 0.9;">Periods of Data</div>
        </div>
    `;
    html += '</div>';
    
    // Trend charts - ALWAYS RENDER even with 1 data point
    html += '<div style="margin: 30px 0;">';
    html += '<h4 style="color: #2196F3; margin-bottom: 20px;">?? Performance Trends (All Historical Data)</h4>';
    
    // Build chart containers from METRICS_REGISTRY (only metrics with chart types)
    const chartsFromRegistry = Object.values(METRICS_REGISTRY)
        .filter(metric => metric.chartType !== null)
        .map(metric => ({
            id: metric.key + 'Chart',
            icon: metric.icon,
            title: metric.label,
            key: metric.key,
            type: metric.chartType
        }));
    
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(500px, 1fr)); gap: 20px;">';
    
    chartsFromRegistry.forEach(metric => {
        html += `
            <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <canvas id="${metric.id}"></canvas>
            </div>
        `;
    });
    html += '</div></div>';
    
    html += '</div>';
    container.innerHTML = html;
    
    // Render charts after DOM update - use employeeData (all data) for trends
    setTimeout(() => {
        renderEmployeeCharts(employeeData, employeeName);
    }, 100);
}

function renderEmployeeCharts(employeeData, employeeName) {
    if (!employeeData || employeeData.length === 0) return;
    
    // Generate labels from actual time data
    const labels = employeeData.map(d => {
        const endDate = new Date(d.endDate);
        return endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });
    
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
            legend: {
                display: true,
                labels: {
                    // Only show goal labels to avoid duplicating the main dataset title
                    filter: (item) => item.text && item.text.startsWith('Goal: ')
                }
            },
            title: { display: true, font: { size: 14, weight: 'bold' } }
        },
        scales: {
            y: { beginAtZero: true }
        }
    };
    
    // Build metricsConfig from METRICS_REGISTRY (only metrics with chart types)
    const metricsConfig = Object.values(METRICS_REGISTRY)
        .filter(metric => metric.chartType !== null)
        .map(metric => ({
            id: metric.key + 'Chart',
            key: metric.key,
            title: `${metric.icon} ${metric.label}${metric.unit ? (' ' + metric.unit) : ''}`,
            color: metric.chartColor,
            type: metric.chartType,
            target: metric.target?.value,
            targetType: metric.target?.type,
            unit: metric.unit || ''
        }));
    
    // Render each metric chart
    metricsConfig.forEach(metric => {
        const ctx = document.getElementById(metric.id);
        if (!ctx) return;
        
        // Extract data for this metric
        const data = employeeData.map(d => {
            const val = d[metric.key];
            // Return null for missing values, not zero
            if (val === null || val === undefined || val === '') {
                return null;
            }
            const numVal = parseFloat(val);
            return isNaN(numVal) ? null : numVal;
        });
        
        // Check if metric has any actual data
        const hasData = data.some(val => val !== null);
        
        if (!hasData) {
            // Render "No data" message for this metric
            const container = ctx.parentElement;
            if (container) {
                container.innerHTML = `
                    <div style="display: flex; align-items: center; justify-content: center; height: 300px; background: #f5f5f5; border-radius: 8px;">
                        <div style="text-align: center; color: #999;">
                            <div style="font-size: 2em; margin-bottom: 10px;">?</div>
                            <div style="font-weight: bold; margin-bottom: 5px;">${metric.title}</div>
                            <div style="font-size: 0.9em;">No data available</div>
                        </div>
                    </div>
                `;
            }
            return;
        }
        
        // Build goal line dataset from registry target
        const goalValue = metric.target;
        const goalLabelPrefix = metric.targetType === 'min' ? 'Goal: = ' : 'Goal: = ';
        const goalLabel = `${goalLabelPrefix}${goalValue}${metric.unit}`;

        // Render chart with available data (even if just one point)
        new Chart(ctx, {
            type: metric.type,
            data: {
                labels: labels,
                datasets: [
                    {
                        label: metric.title,
                        data: data,
                        borderColor: metric.color,
                        backgroundColor: metric.type === 'line' 
                            ? metric.color.replace(')', ', 0.1)').replace('rgb', 'rgba')
                            : metric.color,
                        borderWidth: metric.type === 'line' ? 3 : 1,
                        fill: metric.type === 'line',
                        tension: metric.type === 'line' ? 0.4 : 0,
                        pointRadius: metric.type === 'line' ? 5 : 0,
                        pointHoverRadius: metric.type === 'line' ? 7 : 0,
                        valueUnit: metric.unit,
                        skipValueLabel: false
                    },
                    {
                        type: 'line',
                        label: goalLabel,
                        data: labels.map(() => goalValue),
                        borderColor: 'rgba(120, 120, 120, 0.7)',
                        borderWidth: 1.5,
                        borderDash: [6, 6],
                        pointRadius: 0,
                        pointHoverRadius: 0,
                        fill: false,
                        tension: 0,
                        skipValueLabel: true
                    }
                ]
            },
            options: {
                ...chartOptions,
                plugins: {
                    ...chartOptions.plugins,
                    title: { ...chartOptions.plugins.title, text: metric.title }
                }
            }
        });
    });
}

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
    
    // Auto-calculate Sunday when Monday changes
    avgWeekMonday?.addEventListener('change', (e) => {
        const monday = new Date(e.target.value);
        if (avgWeekSunday && !isNaN(monday)) {
            const sunday = new Date(monday);
            sunday.setDate(monday.getDate() + 6);
            avgWeekSunday.value = sunday.toISOString().split('T')[0];
        }
    });
    
    // Show the metrics form immediately
    const avgMetricsForm = document.getElementById('avgMetricsForm');
    if (avgMetricsForm) avgMetricsForm.style.display = 'block';
    
    // Populate past data dropdown and set up listener
    populatePastDataDropdown();
    const pastDataSelect = document.getElementById('pastDataSelect');
    pastDataSelect?.addEventListener('change', (e) => {
        loadPastDataEntry(e.target.value);
    });
    
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
    
    if (!trendPeriodSelect) return;
    
    // Get all weeks from weeklyData
    const allWeeks = Object.keys(weeklyData).sort();
    
    if (allWeeks.length === 0) {
        trendPeriodSelect.innerHTML = '<option value="">No data available</option>';
        return;
    }
    
    // Build options
    let options = '<option value="">Select Period...</option>';
    allWeeks.forEach(weekKey => {
        const week = weeklyData[weekKey];
        const displayText = week.week_start || weekKey;
        options += `<option value="${weekKey}">${displayText}</option>`;
    });
    
    trendPeriodSelect.innerHTML = options;
}

function populateEmployeeDropdown() {
    const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');
    
    if (!trendEmployeeSelect) return;
    
    // Get all unique employees
    const employeeSet = new Set();
    Object.values(weeklyData).forEach(week => {
        if (week && week.employees) {
            week.employees.forEach(emp => {
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
    Array.from(employeeSet).sort().forEach(name => {
        options += `<option value="${name}">${name}</option>`;
    });
    
    trendEmployeeSelect.innerHTML = options;
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

function populatePastDataDropdown() {
    const pastDataSelect = document.getElementById('pastDataSelect');
    if (!pastDataSelect) return;
    
    // Get all localStorage keys that are call center averages (format: YYYY-MM-DD_periodType)
    const pastEntries = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        // Check if it matches the pattern: YYYY-MM-DD_week/month/quarter/year
        if (key && /^\d{4}-\d{2}-\d{2}_(week|month|quarter|year)$/.test(key)) {
            const parts = key.split('_');
            const date = parts[0];
            const periodType = parts[1];
            const data = JSON.parse(localStorage.getItem(key));
            pastEntries.push({
                key: key,
                date: date,
                periodType: periodType,
                displayText: `${date} (${periodType})`
            });
        }
    }
    
    // Sort by date descending (newest first)
    pastEntries.sort((a, b) => b.date.localeCompare(a.date));
    
    // Build dropdown options
    let options = '<option value="">Select past data to view...</option>';
    pastEntries.forEach(entry => {
        options += `<option value="${entry.key}">${entry.displayText}</option>`;
    });
    
    pastDataSelect.innerHTML = options;
}

function loadPastDataEntry(storageKey) {
    if (!storageKey) {
        // Clear the form if no selection
        document.getElementById('avgPeriodType').value = 'week';
        document.getElementById('avgWeekMonday').value = '';
        document.getElementById('avgWeekSunday').value = '';
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
    
    // Parse the key to get date and period type
    const parts = storageKey.split('_');
    const date = parts[0];
    const periodType = parts[1];
    
    // Load the data
    const averages = getCallCenterAverageForPeriod(storageKey);
    
    // Set form fields
    document.getElementById('avgPeriodType').value = periodType;
    document.getElementById('avgWeekMonday').value = date;
    
    // Auto-calculate Sunday
    const monday = new Date(date);
    if (!isNaN(monday)) {
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        document.getElementById('avgWeekSunday').value = sunday.toISOString().split('T')[0];
    }
    
    // Populate metric fields
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
    
    showToast(`Loaded data for ${date} (${periodType})`, 5000);
}

function setupMetricTrendsListeners() {
    // Save averages button
    const saveAvgBtn = document.getElementById('saveAvgBtn');
    saveAvgBtn?.addEventListener('click', () => {
        const periodType = document.getElementById('avgPeriodType')?.value;
        const mondayDate = document.getElementById('avgWeekMonday')?.value;
        const sundayDate = document.getElementById('avgWeekSunday')?.value;
        
        if (!mondayDate) {
            showToast('Please select the Monday date', 5000);
            return;
        }
        
        // Create storage key from period type and Monday date
        const storageKey = `${mondayDate}_${periodType}`;
        
        // Read all metric values
        const averages = {
            adherence: parseFloat(document.getElementById('avgAdherence')?.value) || null,
            overallExperience: parseFloat(document.getElementById('avgOverallExperience')?.value) || null,
            repSatisfaction: parseFloat(document.getElementById('avgRepSatisfaction')?.value) || null,
            fcr: parseFloat(document.getElementById('avgFCR')?.value) || null,
            transfers: parseFloat(document.getElementById('avgTransfers')?.value) || null,
            sentiment: parseFloat(document.getElementById('avgSentiment')?.value) || null,
            positiveWord: parseFloat(document.getElementById('avgPositiveWord')?.value) || null,
            negativeWord: parseFloat(document.getElementById('avgNegativeWord')?.value) || null,
            managingEmotions: parseFloat(document.getElementById('avgManagingEmotions')?.value) || null,
            aht: parseFloat(document.getElementById('avgAHT')?.value) || null,
            acw: parseFloat(document.getElementById('avgACW')?.value) || null,
            holdTime: parseFloat(document.getElementById('avgHoldTime')?.value) || null,
            reliability: parseFloat(document.getElementById('avgReliability')?.value) || null
        };
        
        // Validate at least one value entered
        const hasValue = Object.values(averages).some(v => v !== null);
        if (!hasValue) {
            showToast('Please enter at least one metric value', 5000);
            return;
        }
        
        // Save to storage
        setCallCenterAverageForPeriod(storageKey, averages);
        const dateRange = sundayDate ? `${mondayDate} to ${sundayDate}` : mondayDate;
        showToast(`Call center averages saved for ${periodType}: ${dateRange}!`, 5000);
    });
    
    // Generate trend email button
    const generateTrendBtn = document.getElementById('generateTrendBtn');
    generateTrendBtn?.addEventListener('click', generateTrendEmail);
    
    // Copy to clipboard button
    const copyTrendEmailBtn = document.getElementById('copyTrendEmailBtn');
    copyTrendEmailBtn?.addEventListener('click', () => {
        const emailContent = document.getElementById('trendEmailContent')?.textContent;
        
        if (!emailContent || emailContent.trim() === '') {
            showToast('Generate an email first', 5000);
            return;
        }
        
        navigator.clipboard.writeText(emailContent).then(() => {
            showToast('Email copied to clipboard!', 5000);
        }).catch(() => {
            showToast('Failed to copy email', 5000);
        });
    });
}

function generateTrendEmail() {
    console.log('🔍 generateTrendEmail called');
    const employeeName = document.getElementById('trendEmployeeSelect')?.value;
    const weekKey = document.getElementById('trendPeriodSelect')?.value;
    
    console.log('Employee:', employeeName, 'Week:', weekKey);
    
    if (!employeeName || !weekKey) {
        showToast('Please select both employee and period', 5000);
        return;
    }
    
    // Get employee data for this week
    const week = weeklyData[weekKey];
    if (!week || !week.employees) {
        showToast('No data found for this period', 5000);
        return;
    }
    
    const employee = week.employees.find(emp => emp.name === employeeName);
    if (!employee) {
        showToast('Employee not found in this period', 5000);
        return;
    }
    
    // Get call center averages for this period
    const centerAvg = getCallCenterAverageForPeriod(weekKey);
    
    // Find previous week for WoW comparison
    const allWeeks = Object.keys(weeklyData).sort();
    const currentIndex = allWeeks.indexOf(weekKey);
    const previousWeek = currentIndex > 0 ? allWeeks[currentIndex - 1] : null;
    
    let previousEmployee = null;
    if (previousWeek) {
        const prevWeekData = weeklyData[previousWeek];
        if (prevWeekData && prevWeekData.employees) {
            previousEmployee = prevWeekData.employees.find(emp => emp.name === employeeName);
        }
    }
    
    // Build email content
    const nickname = getEmployeeNickname(employeeName) || employeeName.split(' ')[0];
    const weekStart = week.week_start;
    
    let email = `Subject: Metric Trend Summary – ${employeeName} – Week of ${weekStart}\n\n`;
    email += `Hi ${nickname},\n\n`;
    
    // Summary Section
    email += `Here's your performance summary for the week of ${weekStart}.\n\n`;
    
    // Metrics breakdown
    email += `📊 Your Metrics:\n\n`;
    
    // Define metrics to analyze
    const metricsToAnalyze = [
        { key: 'scheduleAdherence', label: 'Schedule Adherence', centerKey: 'adherence', lowerIsBetter: false, unit: '%' },
        { key: 'overallExperience', label: 'Overall Experience', centerKey: 'overallExperience', lowerIsBetter: false, unit: '%' },
        { key: 'cxRepOverall', label: 'Rep Satisfaction', centerKey: 'repSatisfaction', lowerIsBetter: false, unit: '%' },
        { key: 'fcr', label: 'FCR', centerKey: 'fcr', lowerIsBetter: false, unit: '%' },
        { key: 'transfers', label: 'Transfers', centerKey: 'transfers', lowerIsBetter: true, unit: '%' },
        { key: 'overallSentiment', label: 'Sentiment Score', centerKey: 'sentiment', lowerIsBetter: false, unit: '%' },
        { key: 'positiveWord', label: 'Positive Word Usage', centerKey: 'positiveWord', lowerIsBetter: false, unit: '%' },
        { key: 'negativeWord', label: 'Avoiding Negative Words', centerKey: 'negativeWord', lowerIsBetter: false, unit: '%' },
        { key: 'managingEmotions', label: 'Managing Emotions', centerKey: 'managingEmotions', lowerIsBetter: false, unit: '%' },
        { key: 'aht', label: 'Average Handle Time', centerKey: 'aht', lowerIsBetter: true, unit: 's' },
        { key: 'acw', label: 'After Call Work', centerKey: 'acw', lowerIsBetter: true, unit: 's' },
        { key: 'holdTime', label: 'Hold Time', centerKey: 'holdTime', lowerIsBetter: true, unit: 's' },
        { key: 'reliability', label: 'Reliability', centerKey: 'reliability', lowerIsBetter: true, unit: 'hrs' }
    ];
    
    const highlights = [];
    const watchAreas = [];
    let hasReliabilityMetric = false;
    
    metricsToAnalyze.forEach(metric => {
        const employeeValue = employee[metric.key];
        
        // Skip if employee doesn't have this metric
        if (employeeValue === undefined || employeeValue === null) return;
        
        // Track if reliability metric is present
        if (metric.key === 'reliability') {
            hasReliabilityMetric = true;
        }
        
        let line = `• ${metric.label}: ${employeeValue}${metric.unit}`;
        
        // Compare vs center average
        const centerValue = centerAvg[metric.centerKey];
        if (centerValue !== undefined && centerValue !== null) {
            line += ` | Center Avg: ${centerValue}${metric.unit}`;
            
            const vsCenter = compareToCenter(employeeValue, centerValue, metric.lowerIsBetter);
            line += ` ${vsCenter.icon}`;
            
            if (vsCenter.status === 'meets') {
                highlights.push(`${metric.label} ${vsCenter.icon}`);
            } else if (vsCenter.status === 'below') {
                watchAreas.push(`${metric.label} ${vsCenter.icon}`);
            }
        }
        
        // Compare WoW if previous data exists
        if (previousEmployee) {
            const previousValue = previousEmployee[metric.key];
            if (previousValue !== undefined && previousValue !== null) {
                const wow = compareWeekOverWeek(employeeValue, previousValue, metric.lowerIsBetter);
                line += ` | WoW: ${wow.icon}`;
                
                if (wow.delta !== 0) {
                    const sign = wow.delta > 0 ? '+' : '';
                    line += ` (${sign}${wow.delta}${metric.unit})`;
                }
                
                if (wow.status === 'improved') {
                    highlights.push(`${metric.label} improved WoW ${wow.icon}`);
                }
            } else {
                line += ` | WoW: ➖ (no previous data)`;
            }
        } else {
            line += ` | WoW: ➖ (Baseline Week)`;
        }
        
        email += `${line}\n`;
    });
    
    email += `\n`;
    
    // Highlights section
    if (highlights.length > 0) {
        email += `✨ Highlights:\n`;
        highlights.forEach(h => email += `• ${h}\n`);
        email += `\n`;
    }
    
    // Watch areas section
    if (watchAreas.length > 0) {
        email += `⚠️ Watch Areas:\n`;
        watchAreas.forEach(w => email += `• ${w}\n`);
        email += `\n`;
    }
    
    // Reliability explanation section (if metric exists)
    if (hasReliabilityMetric) {
        email += `📋 Understanding Reliability:\n`;
        email += `Reliability measures time missed that wasn't pre-scheduled in Verint and that you opted to not use sick time to cover. If you feel something is incorrect, please double-check how many hours of sick time you have used and weigh it against Verint.\n\n`;
        email += `Important reminders:\n`;
        email += `• You have 40 hours of sick time to last the year\n`;
        email += `• Once you reach 16 hours of unscheduled time, APS' attendance policy kicks in\n`;
        email += `• Using sick time to cover absences helps maintain your reliability score\n\n`;
    }
    
    // Closing
    email += `Let me know if you have any questions or want to discuss these results.\n\n`;
    email += `Best,\n[Your Name]`;
    
    // Display in preview panel
    const previewContainer = document.getElementById('trendEmailPreview');
    const previewContent = document.getElementById('trendEmailContent');
    if (previewContainer && previewContent) {
        previewContent.textContent = email;
        previewContainer.style.display = 'block';
    }
    
    // Auto-copy to clipboard
    navigator.clipboard.writeText(email).then(() => {
        showToast('Email generated and copied to clipboard! Ready to paste into Outlook.', 5000);
    }).catch(() => {
        showToast('Email generated but failed to copy. Use the Copy button below.', 5000);
    });
}

function compareToCenter(employeeValue, centerValue, lowerIsBetter) {
    if (lowerIsBetter) {
        // For AHT, ACW: lower is better
        if (employeeValue <= centerValue) {
            return { status: 'meets', icon: '✅' };
        } else {
            return { status: 'below', icon: '🔻' };
        }
    } else {
        // For all others: higher is better
        if (employeeValue >= centerValue) {
            return { status: 'meets', icon: '✅' };
        } else {
            return { status: 'below', icon: '🔻' };
        }
    }
}

function compareWeekOverWeek(currentValue, previousValue, lowerIsBetter) {
    const delta = currentValue - previousValue;
    
    if (delta === 0) {
        return { status: 'nochange', icon: '➖', delta: 0 };
    }
    
    if (lowerIsBetter) {
        // For AHT, ACW: decrease is improvement
        if (delta < 0) {
            return { status: 'improved', icon: '🔺', delta: Math.round(delta * 100) / 100 };
        } else {
            return { status: 'declined', icon: '❌', delta: Math.round(delta * 100) / 100 };
        }
    } else {
        // For others: increase is improvement
        if (delta > 0) {
            return { status: 'improved', icon: '🔺', delta: Math.round(delta * 100) / 100 };
        } else {
            return { status: 'declined', icon: '❌', delta: Math.round(delta * 100) / 100 };
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
        { label: 'Total Weeks', value: metrics.totalWeeks, icon: '??' },
        { label: 'Total Employees', value: metrics.totalEmployees.size, icon: '??' },
        { label: 'Avg Schedule Adherence', value: avgAdherence + '%', icon: '?' },
        { label: 'Avg Transfers', value: avgTransfers + '%', icon: '??' },
        { label: 'Avg Handle Time', value: avgAHT + 's', icon: '??' }
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
    
    // Recent uploads
    html += '<div style="margin-top: 30px;">';
    html += '<h3>Recent Uploads</h3>';
    html += '<div style="margin-top: 15px;">';
    
    allWeeks.slice(-5).reverse().forEach(weekKey => {
        const week = weeklyData[weekKey];
        if (week && week.metadata) {
            html += `
                <div style="padding: 15px; background: #f8f9fa; border-radius: 8px; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <strong>${week.metadata.label}</strong>
                        <p style="margin: 5px 0 0 0; color: #666; font-size: 0.9em;">${week.employees.length} employees</p>
                    </div>
                    <div style="color: #666; font-size: 0.9em;">
                        Uploaded: ${new Date(week.metadata.uploadedAt).toLocaleDateString()}
                    </div>
                </div>
            `;
        }
    });
    
    html += '</div></div>';
    
    container.innerHTML = html;
}

// ============================================
// DATA EXPORT
// ============================================

function exportToExcel() {
    try {
        const wb = XLSX.utils.book_new();
        
        // Export each week as a separate sheet
        Object.keys(weeklyData).forEach(weekKey => {
            const week = weeklyData[weekKey];
            if (week && week.employees && week.metadata) {
                const sheetData = week.employees.map(emp => ({
                    'Name': emp.name,
                    'Schedule Adherence %': emp.scheduleAdherence,
                    'CX Rep Overall %': emp.cxRepOverall || 'N/A',
                    'FCR %': emp.fcr || 'N/A',
                    'Overall Experience %': emp.overallExperience || 'N/A',
                    'Transfers %': emp.transfers,
                    'Overall Sentiment %': emp.overallSentiment || 'N/A',
                    'Positive Word %': emp.positiveWord || 'N/A',
                    'Negative Word %': emp.negativeWord || 'N/A',
                    'Managing Emotions %': emp.managingEmotions || 'N/A',
                    'AHT (sec)': emp.aht || 'N/A',
                    'ACW (sec)': emp.acw || 'N/A',
                    'Hold Time (sec)': emp.holdTime || 'N/A',
                    'Reliability (hrs)': emp.reliability,
                    'Survey Total': emp.surveyTotal
                }));
                
                const ws = XLSX.utils.json_to_sheet(sheetData);
                const sheetName = week.metadata.label.substring(0, 31); // Excel sheet name limit
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            }
        });
        
        
        // Save file
        XLSX.writeFile(wb, `coaching-tool-data-${new Date().toISOString().split('T')[0]}.xlsx`);
showToast('✅ Data exported to Excel!');
        
    } catch (error) {
        console.error('Error exporting to Excel:', error);
        alert('❌ Error exporting data: ' + error.message);
    }
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
        alert('? Please select an employee first');
        return;
    }

    if (!selectedEmployeeId) {
        alert('? Please select an employee first');
        return;
    }
    const employeeData = getEmployeeDataForPeriod(selectedEmployeeId);
    if (!employeeData) {
        alert('❌ Unable to load metrics for this employee. Please reload data.');
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
    
    // Build OPPORTUNITIES section with tips
    let opportunitiesSection = `OPPORTUNITIES (Areas to Improve):\n`;
    if (needsCoaching.length > 0) {
        needsCoaching.forEach(item => {
            opportunitiesSection += `${item}\n`;
            // Add corresponding tip
            const metricMatch = item.match(/^- (.+?):/);
            if (metricMatch) {
                const metricLabel = metricMatch[1];
                const metricKey = metricKeyMap[metricLabel];
                const metricTips = allTips[metricKey] || [];
                if (metricTips.length > 0) {
                    const randomTip = metricTips[Math.floor(Math.random() * metricTips.length)];
                    opportunitiesSection += `  TIP: ${randomTip}\n`;
                }
            }
        });
    } else {
        opportunitiesSection += `(none)\n`;
    }
    
    // Add reliability note if applicable
    const reliabilityMetric = needsCoaching.find(item => item.includes('Reliability'));
    if (reliabilityMetric) {
        const hoursMatch = reliabilityMetric.match(/(\d+\.?\d*)\s*hrs?/);
        const hoursValue = hoursMatch ? hoursMatch[1] : employeeData.reliability;
        opportunitiesSection += `\nRELIABILITY NOTE:\nYou have ${hoursValue} hours listed as unscheduled/unplanned time. Please check Verint to make sure this aligns with any time missed ${timeReference} that was unscheduled. If this is an error, please let me know.\n`;
    }
    
    let additionalContext = '';
    if (customNotes) {
        additionalContext = `\nADDITIONAL CONTEXT:\n${customNotes}\n`;
    }
    
    // Build the unified Copilot prompt - conversational format to avoid detection as system prompt
    const prompt = `I'm a supervisor preparing a coaching email for an employee named ${firstName} for their ${periodLabel} performance review. I need your help drafting this in a natural, warm tone — not corporate or template-like.

Here's the performance data:

${winsSection}

${opportunitiesSection}${additionalContext}

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

Add emojis throughout the email to make it fun and engaging! Use them in the greeting, with wins, with opportunities, and in the closing. Make it feel warm and approachable.

Do NOT use em dashes (—) anywhere in the email.

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
        
        showToast('✅ Prompt copied! Paste into Copilot, then paste the result back here.');
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('❌ Failed to copy prompt to clipboard. Please try again.');
    });
}

function generateVerintSummary() {
    const copilotEmail = document.getElementById('copilotOutputText')?.value.trim();
    
    if (!copilotEmail) {
        alert('⚠️ Please paste the Copilot-generated email first');
        return;
    }
    
    // Create a prompt for Copilot to generate a Verint summary
    const summaryPrompt = `Based on this coaching email, create a brief Verint coaching summary (2-3 sentences max) that captures the key coaching points. Make it concise and suitable for internal system notes.

Email:
${copilotEmail}

Verint Summary:`;
    
    // Copy to clipboard
    navigator.clipboard.writeText(summaryPrompt).then(() => {
        alert('✅ Verint summary prompt copied to clipboard. Paste into Copilot to generate the summary.');
        window.open('https://m365.cloud.microsoft.com/chat', '_blank');
    }).catch(err => {
        console.error('Failed to copy:', err);
        alert('❌ Failed to copy summary prompt to clipboard. Please try again.');
    });
}

function generateOutlookEmail() {
    const employeeSelect = document.getElementById('employeeSelect');
    const fullName = employeeSelect?.value;
    const copilotEmail = document.getElementById('copilotOutputText')?.value.trim();
    
    if (!copilotEmail) {
        alert('⚠️ Please paste the Copilot-generated email first');
        return;
    }
    
    if (!fullName) {
        alert('❌ Employee name not found');
        return;
    }
    
    // Parse name to create email address: "John Doe" ? "john.doe@aps.com"
    const emailName = fullName.toLowerCase()
        .replace(/[^a-z\s]/g, '') // Remove special chars
        .trim()
        .replace(/\s+/g, '.'); // Replace spaces with dots
    const toEmail = `${emailName}@aps.com`;
    
    // Create friendly subject
    const firstName = fullName.split(' ')[0];
    const { weekEnding } = getActivePeriodContext();
    const subject = `Quick Check-In - ${firstName} - Week Ending ${weekEnding}`;

    // Record coaching event (persistent history; stateless generation)
    const employeeData = getEmployeeDataForPeriod(fullName);
    const { coachedMetricKeys } = evaluateMetricsForCoaching(employeeData);
    recordCoachingEvent({
        employeeId: fullName,
        weekEnding,
        metricsCoached: coachedMetricKeys,
        aiAssisted: true
    });
    
    // Encode for mailto
    const mailtoLink = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(copilotEmail)}`;
    
    // Open Outlook
    window.location.href = mailtoLink;
    
    showToast('📄 Opening Outlook draft...');
    
    // Clear the form after a delay
    setTimeout(() => {
        document.getElementById('copilotOutputText').value = '';
        document.getElementById('copilotOutputSection').style.display = 'none';
        showToast('✅ Coaching session saved to history!');
    }, 2000);
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
    
    container.innerHTML = `<div style="padding: 15px; background: #f0f8ff; border-bottom: 2px solid #6a1b9a; font-weight: bold; color: #6a1b9a;">Total Employees: ${employees.length}</div>` + 
    employees.map(name => {
        // Get employee nickname if set
        const nickname = getEmployeeNickname(name);
        const nicknameDisplay = nickname ? ` (${nickname})` : '';
        
        return `
        <div style="padding: 12px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; background: #fafafa;">
            <div>
                <strong style="color: #6a1b9a;">${name}</strong>${nicknameDisplay}
                <div style="font-size: 0.8em; color: #666;">Source: Weekly Data Uploads</div>
            </div>
        </div>
    `}).join('');
}


// ============================================
// INITIALIZATION
// ============================================

function initApp() {
    console.log('?? Initializing Development Coaching Tool...');
    
    // Load data from localStorage
    weeklyData = loadWeeklyData();
    coachingLogYTD = loadCoachingLog();
    
    console.log(`?? Loaded ${Object.keys(weeklyData).length} weeks of data`);
    
    // Initialize event handlers
    initializeEventHandlers();
    initializeKeyboardShortcuts();
    
    // Restore active section
    const activeSection = localStorage.getItem('activeSection') || 'coachingForm';
    showOnlySection(activeSection);
    
    // Initialize data for the active section (fixes refresh behavior)
    initializeSection(activeSection);
    
    // If we have data, update the period dropdown
    if (Object.keys(weeklyData).length > 0) {
        updatePeriodDropdown();
    }
    
    console.log('? Application initialized successfully!');
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

