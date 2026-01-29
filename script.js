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
let myTeamMembers = {}; // Stores selected team members by weekKey: { "2026-01-24|2026-01-20": ["Alyssa", "John", ...] }

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
 * Initialize the content of a section when it's shown
 */
function initializeSection(sectionId) {
    switch(sectionId) {
        case 'coachingSection':
            resetEmployeeSelection();
            break;
        case 'dashboardSection':
            renderEmployeeHistory();
            break;
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

    console.log(`📊 Calculating averages from ${employees.length} total employees`);

    // Filter out employees with 0 calls answered
    const activeEmployees = employees.filter(emp => {
        const totalCalls = parseInt(emp.totalCalls);
        return !isNaN(totalCalls) && totalCalls > 0;
    });

    console.log(`📞 ${activeEmployees.length} employees with calls answered (excluding ${employees.length - activeEmployees.length} with 0 calls)`);

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

    console.log(' Calculated averages:', averages);
    console.log('📊 Count per metric:', counts);
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
    // Extract first name from full name
    if (!fullName) return '';
    return fullName.split(' ')[0];
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
        weeklyData[currentPeriod].employees.forEach(emp => {
            // Only add if they're on the team (or no team selection yet)
            if (isTeamMember(currentPeriod, emp.name)) {
                employees.add(emp.name);
            }
        });
    } else if (currentPeriodType === 'ytd' && currentPeriod) {
        // For YTD: aggregate all weeks in the year
        Object.keys(weeklyData).forEach(weekKey => {
            const [year] = weekKey.split('|')[0].split('-');
            if (year === currentPeriod) {
                weeklyData[weekKey].employees.forEach(emp => {
                    // Only add if they're on the team (or no team selection yet)
                    if (isTeamMember(weekKey, emp.name)) {
                        employees.add(emp.name);
                    }
                });
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
                if (emp && isTeamMember(weekKey, emp.name)) {
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
    
    document.getElementById('downloadOfflineBtn')?.addEventListener('click', downloadOfflinePackage);
    

    
    // Load pasted data
    document.getElementById('loadPastedDataBtn')?.addEventListener('click', () => {
        console.log('📋 Load Data button clicked');
        const pastedData = document.getElementById('pasteDataTextarea').value;
        const startDate = document.getElementById('pasteStartDate').value;
        const endDate = document.getElementById('pasteEndDate').value;
        
        console.log('📊 Paste data received - Length:', pastedData.length, 'chars');
        console.log('📅 Dates: Start=' + startDate, 'End=' + endDate);
        
        // Get selected period type
        const selectedBtn = document.querySelector('.upload-period-btn[style*="background: rgb(40, 167, 69)"]') || 
                           document.querySelector('.upload-period-btn[style*="background:#28a745"]') ||
                           document.querySelector('.upload-period-btn[data-period="week"]');
        const periodType = selectedBtn ? selectedBtn.dataset.period : 'week';
        
        console.log('⏰ Period type:', periodType);
        
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
            console.log('👥 Parsed employees:', employees.length);
            
            if (employees.length === 0) {
                alert('❌ No valid employee data found');
                return;
            }
            
            // Store data with period type
            const weekKey = `${startDate}|${endDate}`;
            console.log('🔑 Created weekKey:', weekKey);
            
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
            
            console.log('📦 Data added to weeklyData. Total weeks now:', Object.keys(weeklyData).length);
            
            saveWeeklyData();
            console.log('✅ Data saved to localStorage');
            
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
            
            alert(`✅ Loaded ${employees.length} employees for ${label}!\n\nManage your team members in "🗄️ Manage Data" section.`);
            
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
        delete myTeamMembers[selectedWeek];
        saveWeeklyData();
        saveTeamMembers();
        
        populateDeleteWeekDropdown();
        populateTeamMemberSelector();
        showToast('✅ Week deleted successfully');
        
        // Clear coaching form if needed
        document.getElementById('employeeSelect').value = '';
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
        const endDateStr = weekKey.split('|')[1];
        // Parse date safely to avoid timezone issues
        const [year, month, day] = endDateStr.split('-').map(Number);
        const endDate = new Date(year, month - 1, day);
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
    console.log(`✅ Updated team members for ${weekKey}:`, selectedMembers);
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
        console.warn('trendPeriodSelect element not found');
        return;
    }
    
    console.log(`📅 Populating periods for type: ${selectedPeriodType}`);
    
    // Get all weeks from weeklyData
    const allWeeks = Object.keys(weeklyData).sort().reverse(); // Most recent first
    
    if (allWeeks.length === 0) {
        trendPeriodSelect.innerHTML = '<option value="">No data available</option>';
        return;
    }
    
    // Filter by period type
    const filteredPeriods = allWeeks.filter(weekKey => {
        const week = weeklyData[weekKey];
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
        const week = weeklyData[weekKey];
        const displayText = week.metadata?.label || weekKey;
        options += `<option value="${weekKey}">${displayText}</option>`;
    });
    
    trendPeriodSelect.innerHTML = options;
    
    // Add change listener to filter employees by selected period
    trendPeriodSelect.addEventListener('change', (e) => {
        populateEmployeeDropdownForPeriod(e.target.value);
    });
    
    console.log(`✅ ${filteredPeriods.length} periods found for ${selectedPeriodType}`);
}

function populateEmployeeDropdown() {
    const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');
    
    if (!trendEmployeeSelect) {
        console.warn('trendEmployeeSelect element not found');
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
}

function populateEmployeeDropdownForPeriod(weekKey) {
    const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');
    
    if (!trendEmployeeSelect) {
        console.warn('trendEmployeeSelect element not found');
        return;
    }
    
    if (!weekKey) {
        // No period selected, show all employees
        populateEmployeeDropdown();
        return;
    }
    
    // Get employees only for selected period, filtered by team
    const week = weeklyData[weekKey];
    if (!week || !week.employees) {
        trendEmployeeSelect.innerHTML = '<option value="">No employees in this period</option>';
        return;
    }
    
    const employees = week.employees
        .filter(emp => isTeamMember(weekKey, emp.name))
        .map(emp => emp.name)
        .sort();
    
    // Build options
    let options = '<option value="">Select Employee...</option>';
    options += '<option value="ALL">All Associates</option>';
    employees.forEach(name => {
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

function populateUploadedDataDropdown() {
    const avgUploadedDataSelect = document.getElementById('avgUploadedDataSelect');
    const selectedPeriodType = document.querySelector('input[name="trendPeriodType"]:checked')?.value || 'week';
    
    if (!avgUploadedDataSelect) return;
    
    console.log(`📅 Populating Call Center Average dropdown for type: ${selectedPeriodType}`);
    
    // Get all weeks from weeklyData
    const allWeeks = Object.keys(weeklyData).sort().reverse(); // Most recent first
    
    if (allWeeks.length === 0) {
        avgUploadedDataSelect.innerHTML = '<option value="">-- No uploaded data available --</option>';
        return;
    }
    
    // Filter by period type
    const filteredPeriods = allWeeks.filter(weekKey => {
        const week = weeklyData[weekKey];
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
        const week = weeklyData[weekKey];
        const displayText = week.metadata?.label || week.week_start || weekKey;
        options += `<option value="${weekKey}">${displayText}</option>`;
    });
    
    avgUploadedDataSelect.innerHTML = options;
    console.log(`✅ ${filteredPeriods.length} periods found for ${selectedPeriodType}`);
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
                console.log(`📊 Auto-synced period to Metric Trends: ${weekKey}`);
            }
        }
    });
}

function displayCallCenterAverages(weekKey) {
    const avgMetricsForm = document.getElementById('avgMetricsForm');
    const periodTypeField = document.getElementById('avgPeriodType');
    const mondayField = document.getElementById('avgWeekMonday');
    const sundayField = document.getElementById('avgWeekSunday');
    
    if (!weekKey || !weeklyData[weekKey]) {
        avgMetricsForm.style.display = 'none';
        periodTypeField.value = '';
        mondayField.value = '';
        sundayField.value = '';
        return;
    }
    
    const week = weeklyData[weekKey];
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

function setupMetricTrendsListeners() {
    // Add event listeners to period type radio buttons
    const periodTypeRadios = document.querySelectorAll('input[name="trendPeriodType"]');
    periodTypeRadios.forEach(radio => {
        radio.addEventListener('change', () => {
            const selectedType = radio.value;
            console.log(`🔄 Period type changed to: ${selectedType}`);
            
            // Update both dropdowns
            populateUploadedDataDropdown(); // Call Center Average dropdown
            populateTrendPeriodDropdown(); // Metric Trends dropdown
            
            // Clear employee selection
            document.getElementById('trendEmployeeSelect').innerHTML = '<option value="">-- Choose an employee --</option>';
        });
    });
    
    // Add listener to employee dropdown to show metrics preview
    const trendEmployeeSelect = document.getElementById('trendEmployeeSelect');
    if (trendEmployeeSelect) {
        trendEmployeeSelect.addEventListener('change', (e) => {
            const employeeName = e.target.value;
            const weekKey = document.getElementById('trendPeriodSelect')?.value;
            
            if (employeeName === 'ALL') {
                document.getElementById('metricsPreviewSection').style.display = 'none';
                return;
            }
            
            if (employeeName && weekKey) {
                displayMetricsPreview(employeeName, weekKey);
            } else {
                document.getElementById('metricsPreviewSection').style.display = 'none';
            }
        });
    }
    
    // Generate trend email buttons
    const generateTrendBtn = document.getElementById('generateTrendBtn');
    const generateAllTrendBtn = document.getElementById('generateAllTrendBtn');
    
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
    
}

function displayMetricsPreview(employeeName, weekKey) {
    const metricsPreviewSection = document.getElementById('metricsPreviewSection');
    const metricsPreviewGrid = document.getElementById('metricsPreviewGrid');
    
    if (!metricsPreviewSection || !metricsPreviewGrid) return;
    
    const week = weeklyData[weekKey];
    if (!week || !week.employees) return;
    
    const employee = week.employees.find(emp => emp.name === employeeName);
    if (!employee) return;
    
    console.log(`📊 Displaying metrics preview for ${employeeName} (${weekKey})`);
    
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

/**
 * Build the HTML email for a trend email
 * Can be used for both single and bulk email generation
 */
function buildTrendEmailHtml(employeeName, weekKey, options = {}) {
    const useEdits = options.useEdits !== false;
    
    if (!employeeName || !weekKey) {
        console.error('Missing selection - Employee:', employeeName, 'Week:', weekKey);
        return null;
    }
    
    // Get employee data for this week
    const week = weeklyData[weekKey];
    
    if (!week || !week.employees) {
        console.error('No data found for week:', weekKey);
        return null;
    }
    
    const employee = week.employees.find(emp => emp.name === employeeName);
    
    if (!employee) {
        console.error('Employee not found:', employeeName);
        return null;
    }
    
    // Check if user edited any metrics in preview and override with edited values
    let editedEmployee = { ...employee };
    
    if (useEdits) {
        const metricInputs = document.querySelectorAll('.metric-preview-input');
        metricInputs.forEach(input => {
            const metricKey = input.dataset.metric;
            const editedValue = input.value;
            
            if (editedValue !== '' && editedValue !== null) {
                const numValue = parseFloat(editedValue);
                if (!isNaN(numValue)) {
                    editedEmployee[metricKey] = numValue;
                    if (numValue !== employee[metricKey]) {
                        console.log(`📝 Using edited value for ${metricKey}: ${employee[metricKey]} → ${numValue}`);
                    }
                }
            }
        });
    }
    
    // Use editedEmployee for email generation
    const employeeToUse = editedEmployee;
    
    // Get call center averages for this period
    const centerAvg = getCallCenterAverageForPeriod(weekKey);
    console.log('📊 Center averages for', weekKey + ':', centerAvg);
    
    // Get the week start date from metadata
    const weekStart = week.metadata?.label || week.week_start || `${week.metadata?.startDate}`;
    const periodType = week.metadata?.periodType || 'week';
    const periodLabel = periodType === 'week' ? 'Week' : periodType === 'month' ? 'Month' : periodType === 'ytd' ? 'Year' : 'Period';
    
    // Initialize tracking variables
    let totalMetricsEvaluated = 0;
    let meetsTargetCount = 0;
    let outpacingPeersCount = 0;
    let improvedCount = 0;
    
    // Start building HTML email
    let htmlEmail = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 800px;
            margin: 0 auto;
            padding: 0;
            background: #f5f5f5;
        }
        .container {
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            border-radius: 12px;
            margin: -30px -30px 30px -30px;
            text-align: center;
        }
        .header h1 {
            margin: 0 0 10px 0;
            font-size: 28px;
        }
        .header p {
            margin: 0;
            font-size: 16px;
            opacity: 0.95;
        }
        .greeting {
            font-size: 18px;
            margin-bottom: 20px;
        }
        .cards {
            display: flex;
            gap: 20px;
            margin: 30px 0;
            flex-wrap: wrap;
        }
        .card {
            flex: 1;
            min-width: 180px;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        }
        .card-success { background: linear-gradient(135deg, #84fab0 0%, #8fd3f4 100%); }
        .card-info { background: linear-gradient(135deg, #a8edea 0%, #fed6e3 100%); }
        .card-warning { background: linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%); }
        .card-value {
            font-size: 48px;
            font-weight: bold;
            margin: 10px 0;
            color: #2c3e50;
        }
        .card-label {
            font-size: 14px;
            font-weight: 600;
            color: #34495e;
            margin: 5px 0;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
        }
        th {
            background: #667eea;
            color: white;
            padding: 12px;
            text-align: left;
            font-weight: 600;
        }
        td {
            padding: 10px;
            border: 1px solid #ddd;
        }
        .metric-row-good { background: #d4edda; }
        .metric-row-watch { background: #fff3cd; }
        .section {
            margin: 25px 0;
        }
        .section-title {
            font-size: 18px;
            font-weight: bold;
            color: #667eea;
            margin: 20px 0 10px 0;
            padding-bottom: 5px;
            border-bottom: 2px solid #667eea;
        }
        .highlight-box {
            background: #e8f5e9;
            border-left: 4px solid #4caf50;
            padding: 15px;
            margin: 15px 0;
            border-radius: 4px;
        }
        .watch-box {
            background: #fff3e0;
            border-left: 4px solid #ff9800;
            padding: 15px;
            margin: 15px 0;
            border-radius: 4px;
        }
        .reliability-box {
            background: #ffe0e0;
            border-left: 4px solid #f44336;
            padding: 15px;
            margin: 15px 0;
            border-radius: 4px;
        }
        .legend {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 8px;
            font-size: 14px;
            margin: 20px 0;
        }
        .footer {
            text-align: center;
            padding: 20px;
            color: #666;
            font-size: 14px;
            border-top: 1px solid #ddd;
            margin-top: 30px;
        }
        .disclaimer {
            font-size: 12px;
            color: #999;
            font-style: italic;
            margin-top: 15px;
        }
    </style>
</head>
<body style="margin: 0; padding: 20px; background: #f5f5f5;">
    <div class="container" style="background: white; padding: 30px; border-radius: 12px;">
        <div class="header">
            <h1>📊 Performance Summary</h1>
            <p>${weekStart} • ${periodLabel} Report</p>
        </div>
        
        <div class="greeting">Hi ${getEmployeeNickname(employeeName) || employeeName.split(' ')[0]},</div>
        <p>Here's your performance summary for ${weekStart}.</p>
`;

    // Temporarily store metrics data for later processing
    let metricsHtml = '';
    const highlights = [];
    const watchAreas = [];
    let hasReliabilityMetric = false;
    
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
    
    metricsToAnalyze.forEach(metric => {
        const employeeValue = employeeToUse[metric.key];
        
        // Skip if employee doesn't have this metric
        // Allow Reliability to be 0 (that's good!), but skip empty strings, null, undefined, NaN, etc.
        const isReliability = metric.key === 'reliability';
        const isEmpty = employeeValue === undefined || employeeValue === null || employeeValue === '' || isNaN(employeeValue);
        const isZeroButNotReliability = employeeValue === 0 && !isReliability;
        
        if (isEmpty || isZeroButNotReliability) {
            console.log(`⏭️  Skipping ${metric.label}: value=${employeeValue}`);
            return;
        }
        
        // Track if reliability metric is present
        if (isReliability) {
            hasReliabilityMetric = true;
        }
        
        totalMetricsEvaluated++;
        
        // Get period type for comparison
        const currentPeriodType = week.metadata?.periodType || 'week';
        console.log(`📈 ${metric.label} - Period Type: ${currentPeriodType}`);
        
        // ============ TARGET CHECK ============
        const metricRegistry = METRICS_REGISTRY[metric.key];
        let meetsTarget = false;
        let targetValue = null;
        
        if (metricRegistry && metricRegistry.target) {
            targetValue = metricRegistry.target.value;
            const targetType = metricRegistry.target.type;
            
            if (targetType === 'min') {
                meetsTarget = employeeValue >= targetValue;
            } else if (targetType === 'max') {
                meetsTarget = employeeValue <= targetValue;
            }
        }
        
        if (meetsTarget) meetsTargetCount++;
        
        // ============ CALL CENTER AVERAGE COMPARISON ============
        let callCenterComparison = null;
        let centerValue = null;
        let outpacingPeers = false;
        
        if (centerAvg && centerAvg[metric.centerKey] !== undefined && centerAvg[metric.centerKey] !== null) {
            centerValue = centerAvg[metric.centerKey];
            const meetsCenter = metric.lowerIsBetter 
                ? employeeValue <= centerValue 
                : employeeValue >= centerValue;
            outpacingPeers = meetsCenter;
            const icon = meetsCenter ? '✅' : '❌';
            callCenterComparison = {
                centerAvg: centerValue,
                status: meetsCenter ? 'meets' : 'below',
                icon: icon
            };
            console.log(`  Call Center Avg: ${centerValue}, Status: ${callCenterComparison.status}, Icon: ${icon}`);
        }
        
        if (outpacingPeers) outpacingPeersCount++;
        
        // ============ TREND COMPARISON (WoW/MoM/YoY) ============
        let trendIcon = '➖';
        let trendDelta = 0;
        let trendText = 'No change';
        let improved = false;
        
        const previousKey = getPreviousPeriodData(weekKey, currentPeriodType);
        if (previousKey && weeklyData[previousKey]) {
            const prevWeekData = weeklyData[previousKey];
            const previousEmployee = prevWeekData.employees?.find(emp => emp.name === employeeName);
            
            if (previousEmployee) {
                const previousValue = previousEmployee[metric.key];
                if (previousValue !== undefined && previousValue !== null) {
                    const wow = compareWeekOverWeek(employeeValue, previousValue, metric.lowerIsBetter);
                    trendIcon = wow.icon;
                    trendDelta = wow.delta;
                    improved = wow.status === 'improved';
                    
                    const sign = trendDelta > 0 ? '+' : '';
                    const periodLabel2 = currentPeriodType === 'week' ? 'last week' : currentPeriodType === 'month' ? 'last month' : currentPeriodType === 'ytd' ? 'last year' : 'last period';
                    trendText = `${sign}${trendDelta.toFixed(1)}${metric.unit} vs ${periodLabel2}`;
                    
                    console.log(`  ${currentPeriodType === 'week' ? 'WoW' : currentPeriodType === 'month' ? 'MoM' : 'YoY'}: ${previousValue} → ${employeeValue}, Delta: ${trendDelta}, Icon: ${trendIcon}`);
                    
                    // Add to highlights if improved
                    if (improved) {
                        improvedCount++;
                        highlights.push({
                            label: metric.label,
                            value: employeeValue,
                            unit: metric.unit,
                            centerValue: centerValue,
                            trendText: trendText,
                            icon: trendIcon
                        });
                    }
                }
            }
        } else {
            console.log(`  No previous ${currentPeriodType} data available`);
        }
        
        // Build HTML table row - use inline styles for Outlook compatibility
        const rowBgColor = meetsTarget ? '#d4edda' : '#fff3cd';
        const statusIcon = meetsTarget ? '✅' : '❌';
        const vsCenter = centerValue !== null ? (outpacingPeers ? '📈 Better' : '📉 Behind') : 'N/A';
        
        metricsHtml += `
            <tr style="background: ${rowBgColor};">
                <td style="padding: 10px; border: 1px solid #ddd;">${statusIcon} ${metric.label}</td>
                <td style="padding: 10px; text-align: center; font-weight: bold; border: 1px solid #ddd;">${employeeValue.toFixed(1)}${metric.unit}</td>
                <td style="padding: 10px; text-align: center; border: 1px solid #ddd;">${centerValue !== null ? centerValue.toFixed(1) + metric.unit : 'N/A'}</td>
                <td style="padding: 10px; text-align: center; border: 1px solid #ddd;">${targetValue !== null ? targetValue + metric.unit : 'N/A'}</td>
                <td style="padding: 10px; text-align: center; border: 1px solid #ddd;">${vsCenter}</td>
                <td style="padding: 10px; text-align: center; border: 1px solid #ddd;">${trendIcon} ${trendText}</td>
            </tr>
        `;
        
        // Track for watch areas
        if (callCenterComparison && callCenterComparison.status === 'below') {
            const targetStats = getTargetHitRate(employeeName, metric.key, currentPeriodType);
            const statsText = targetStats.total > 0 ? ` - Met target ${targetStats.hits}/${targetStats.total} ${getPeriodUnit(currentPeriodType, targetStats.total)}` : '';
            watchAreas.push({
                label: metric.label,
                value: employeeValue,
                unit: metric.unit,
                centerValue: centerValue,
                statsText: statsText
            });
        }
    });
    
    // Add visual cards to HTML email (Outlook-safe table layout)
    htmlEmail += `
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 20px 0; border-collapse: collapse;">
            <tr>
                <td width="33%" style="padding: 10px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border: 2px solid #28a745; background: #d4edda; margin: 0;">
                        <tr><td style="padding: 15px; text-align: center; font-family: Arial, sans-serif;">
                            <div style="font-size: 11px; color: #155724; font-weight: bold; margin: 0;">✅ MEETING TARGET GOALS</div>
                            <div style="font-size: 36px; font-weight: bold; color: #155724; margin: 8px 0;"><span style="display: inline-block;">${meetsTargetCount}/${totalMetricsEvaluated}</span></div>
                            <div style="font-size: 12px; color: #155724; margin: 0;">${totalMetricsEvaluated > 0 ? Math.round((meetsTargetCount/totalMetricsEvaluated)*100) : 0}% Success</div>
                        </td></tr>
                    </table>
                </td>
                <td width="33%" style="padding: 10px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border: 2px solid #0056b3; background: #cfe2ff; margin: 0;">
                        <tr><td style="padding: 15px; text-align: center; font-family: Arial, sans-serif;">
                            <div style="font-size: 11px; color: #004085; font-weight: bold; margin: 0;">📈 OUTPACING YOUR PEERS</div>
                            <div style="font-size: 36px; font-weight: bold; color: #004085; margin: 8px 0;"><span style="display: inline-block;">${outpacingPeersCount}/${totalMetricsEvaluated}</span></div>
                            <div style="font-size: 12px; color: #004085; margin: 0;">${totalMetricsEvaluated > 0 ? Math.round((outpacingPeersCount/totalMetricsEvaluated)*100) : 0}% Above Center</div>
                        </td></tr>
                    </table>
                </td>
                <td width="33%" style="padding: 10px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border: 2px solid #ff9800; background: #fff3cd; margin: 0;">
                        <tr><td style="padding: 15px; text-align: center; font-family: Arial, sans-serif;">
                            <div style="font-size: 11px; color: #664d03; font-weight: bold; margin: 0;">⬆️ IMPROVED METRICS</div>
                            <div style="font-size: 36px; font-weight: bold; color: #664d03; margin: 8px 0;"><span style="display: inline-block;">${improvedCount}</span></div>
                            <div style="font-size: 12px; color: #664d03; margin: 0;">From ${periodLabel === 'Week' ? 'Last Week' : periodLabel === 'Month' ? 'Last Month' : 'Last Period'}</div>
                        </td></tr>
                    </table>
                </td>
            </tr>
        </table>
        
        <div style="margin: 25px 0;">
            <div style="font-size: 18px; font-weight: bold; color: #667eea; margin: 20px 0 10px 0; padding-bottom: 5px; border-bottom: 2px solid #667eea;">📊 Your Metrics</div>
            <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <thead>
                    <tr>
                        <th style="background: #667eea; color: white; padding: 12px; text-align: left; font-weight: 600; border: 1px solid #999;">Metric</th>
                        <th style="background: #667eea; color: white; padding: 12px; text-align: center; font-weight: 600; border: 1px solid #999;">Your Value</th>
                        <th style="background: #667eea; color: white; padding: 12px; text-align: center; font-weight: 600; border: 1px solid #999;">Center Avg</th>
                        <th style="background: #667eea; color: white; padding: 12px; text-align: center; font-weight: 600; border: 1px solid #999;">Target</th>
                        <th style="background: #667eea; color: white; padding: 12px; text-align: center; font-weight: 600; border: 1px solid #999;">vs. Center</th>
                        <th style="background: #667eea; color: white; padding: 12px; text-align: center; font-weight: 600; border: 1px solid #999;">Trend</th>
                    </tr>
                </thead>
                <tbody>
                    ${metricsHtml}
                </tbody>
            </table>
        </div>
    `;
    
    // Only show highlights if there are any
    if (highlights.length > 0) {
        htmlEmail += `
        <div class="highlight-box">
            <div class="section-title">✨ Highlights (Improved from ${periodLabel === 'Week' ? 'Last Week' : periodLabel === 'Month' ? 'Last Month' : 'Last Period'})</div>
        `;
        highlights.slice(0, 3).forEach(h => {
            htmlEmail += `<div>• ${h.label}: <strong>${h.value.toFixed(1)}${h.unit}</strong> ${h.icon} <em>${h.trendText}</em></div>`;
        });
        htmlEmail += `</div>`;
    }
    
    // Only show watch areas if there are any
    if (watchAreas.length > 0) {
        htmlEmail += `
        <div class="watch-box">
            <div class="section-title">📈 Focus Areas (Below Center Average)</div>
        `;
        watchAreas.slice(0, 3).forEach(w => {
            htmlEmail += `<div>• ${w.label}: <strong>${w.value.toFixed(1)}${w.unit}</strong> (Center: ${w.centerValue.toFixed(1)}${w.unit})${w.statsText}</div>`;
        });
        htmlEmail += `</div>`;
    }
    
    // Reliability explanation section (if metric exists and has a value > 0)
    if (hasReliabilityMetric && employeeToUse.reliability > 0) {
        htmlEmail += `
        <div class="reliability-box">
            <div class="section-title">📋 Reliability Note</div>
            <p>You have <strong>${employeeToUse.reliability} hours</strong> of unscheduled time. This represents time missed that was not pre-approved in Verint and not covered by sick time. If you would like to use sick time to cover this, please let me know.</p>
            <p><strong>Important:</strong> You have 40 hours of sick time to cover unscheduled/unplanned time missed. After those 40 hours are used, any time missed that is not pre-scheduled will be subject to our attendance policy.</p>
            <p>If you feel this was done in error, let me know and I can research further.</p>
        </div>
        `;
    }
    
    // Legend and closing
    htmlEmail += `
        <div class="legend">
            <strong>Legend:</strong> ✅ = Meeting target | ❌ = Below target | 📈 = Better than center | 📉 = Behind center | ⬆️ = Improved | ⬇️ = Declined | ➖ = No change
        </div>
        
        <p>Let me know if you have any questions or want to discuss these results.</p>
        
        <div class="footer">
            <p>Keep up the great work! 🌟</p>
            <div class="disclaimer">
                Disclaimer: This summary is close enough to use as a guide. YTD stats will be used in future shift bids.
            </div>
        </div>
    </div>
</body>
</html>
    `;
    
    console.log('📧 HTML email generated for', employeeName);
    
    return { htmlEmail, weekStart, subject: `Performance Summary – ${employeeName} – ${weekStart}` };
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
    
    // Get current period data
    const period = weeklyData[weekKey];
    if (!period) {
        showToast('No data found for this period', 5000);
        return;
    }
    
    const employee = period.employees.find(e => e.name === employeeName);
    if (!employee) {
        showToast('Employee not found in selected period', 5000);
        return;
    }
    
    // Get previous period
    const allPeriods = Object.keys(weeklyData).sort();
    const currentIdx = allPeriods.indexOf(weekKey);
    const prevPeriod = currentIdx > 0 ? weeklyData[allPeriods[currentIdx - 1]] : null;
    const prevEmployee = prevPeriod?.employees.find(e => e.name === employeeName);
    
    // Use nickname if provided, otherwise use full name
    const displayName = nickname || employeeName;
    
    // Build email image
    showToast('⏳ Creating email image...', 3000);
    
    setTimeout(() => {
        createTrendEmailImage(displayName, period, employee, prevEmployee);
    }, 100);
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
    // Define the order and grouping of metrics
    return [
        { key: 'scheduleAdherence', group: null },
        { key: 'overallExperience', group: 'Surveys' },
        { key: 'cxRepOverall', group: 'Surveys' },
        { key: 'fcr', group: 'Surveys' },
        { key: 'overallSentiment', group: 'Sentiment' },
        { key: 'positiveWord', group: 'Sentiment' },
        { key: 'negativeWord', group: 'Sentiment' },
        { key: 'managingEmotions', group: 'Sentiment' },
        { key: 'aht', group: null },
        { key: 'acw', group: null },
        { key: 'holdTime', group: null },
        { key: 'reliability', group: null }
    ];
}

function createTrendEmailImage(empName, period, current, previous) {
    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 1400;
    const ctx = canvas.getContext('2d');

    // White background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 900, 1400);

    let y = 0;

    // Blue gradient header (matching webpage)
    const gradient = ctx.createLinearGradient(0, 0, 900, 100);
    gradient.addColorStop(0, '#003DA5');
    gradient.addColorStop(1, '#0056B3');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 900, 100);

    // Header text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 32px Arial';
    ctx.fillText('📊 Performance Summary', 50, 50);
    ctx.font = '16px Arial';
    ctx.fillText(`Week ending ${period.endDate}`, 50, 80);

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

    // Metrics comparison - validate data structure
    if (!current) {
        console.error('Invalid employee data:', current);
        showToast('❌ Employee data is missing', 5000);
        return;
    }

    // Metrics are direct properties on the employee object
    // Filter to only include the metrics we want to show
    const metricOrder = getMetricOrder();
    const metrics = {};
    const prevMetrics = {};
    
    // Only include metrics that are in our defined order
    metricOrder.forEach(({ key }) => {
        if (current[key] !== undefined) {
            metrics[key] = current[key];
        }
        if (previous && previous[key] !== undefined) {
            prevMetrics[key] = previous[key];
        }
    });

    // Get center averages for this period
    const callCenterAverages = loadCallCenterAverages();
    const centerAvg = callCenterAverages[period.startDate] || {};

    console.log('Center averages:', centerAvg);

    // Count summary cards - only count metrics that exist
    let meetingGoals = 0;
    let improved = 0;
    let beatingCenter = 0;

    metricOrder.forEach(({ key }) => {
        if (metrics[key] === undefined) return;
        
        const curr = parseFloat(metrics[key]) || 0;
        const target = getMetricTarget(key);
        const center = parseFloat(centerAvg[key]) || 0;
        
        if (isMetricMeetingTarget(key, curr, target)) meetingGoals++;
        
        // Check if beating center average
        if (center > 0) {
            const lowerMetric = key.toLowerCase();
            const isLowerBetter = lowerMetric.includes('downtime') || lowerMetric.includes('scrap') || 
                                  lowerMetric.includes('defect') || lowerMetric.includes('transfer');
            if (isLowerBetter ? curr < center : curr > center) {
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
    const improvedSub = previous ? 'From Last Week' : 'No Prior Data';

    // Draw summary cards with white background and colored borders
    drawEmailCard(ctx, 50, y, 250, 110, '#ffffff', '#28a745', '✅ Meeting Goals', `${meetingGoals}/${totalMetrics}`, `${successRate}% Success Rate`);
    drawEmailCard(ctx, 325, y, 250, 110, '#ffffff', '#2196F3', '📊 Above Average', `${beatingCenter}/${totalMetrics}`, `Better than Call Center`);
    drawEmailCard(ctx, 600, y, 250, 110, '#ffffff', '#ff9800', '🔼 Improved', improvedText, improvedSub);

    y += 140;

    // "Your Metrics" section header with light blue background
    ctx.fillStyle = '#e3f2fd';
    ctx.fillRect(40, y, 820, 50);
    ctx.fillStyle = '#003DA5';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('📊 Your Metrics', 50, y + 32);
    y += 70;

    // Table headers with blue background
    ctx.fillStyle = '#003DA5';
    ctx.fillRect(40, y, 820, 45);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 14px Arial';
    ctx.fillText('Metric', 50, y + 28);
    ctx.fillText('Your Metric', 300, y + 28);
    ctx.fillText('Center Avg', 420, y + 28);
    ctx.fillText('Target', 540, y + 28);
    ctx.fillText('vs. Center Avg', 630, y + 28);
    ctx.fillText('Trending', 770, y + 28);
    
    y += 45;

    // Table rows with group headers
    let currentGroup = null;
    let rowIdx = 0;
    
    metricOrder.forEach(({ key, group }) => {
        // Skip if metric doesn't exist in data
        if (metrics[key] === undefined) return;
        
        // Draw group header if entering a new group
        if (group !== currentGroup && group !== null) {
            currentGroup = group;
            ctx.fillStyle = '#e3f2fd';
            ctx.fillRect(40, y, 820, 35);
            ctx.fillStyle = '#0056B3';
            ctx.font = 'bold 16px Arial';
            ctx.fillText(`📋 ${group}`, 50, y + 22);
            y += 35;
            rowIdx = 0; // Reset alternating row colors for new group
        }
        
        const curr = parseFloat(metrics[key]) || 0;
        const prev = parseFloat(prevMetrics[key]) || 0;
        const center = parseFloat(centerAvg[key]) || 0;
        const target = getMetricTarget(key);
        const formattedMetricName = formatMetricName(key);
        
        // Check if beating center average
        const lowerMetric = key.toLowerCase();
        const isLowerBetter = lowerMetric.includes('downtime') || lowerMetric.includes('scrap') || 
                              lowerMetric.includes('defect') || lowerMetric.includes('transfer');
        const isBeatingCenter = center > 0 && (isLowerBetter ? curr < center : curr > center);
        
        // vs. Center Avg calculation
        const vsCenter = center > 0 ? ((curr - center) / center * 100).toFixed(1) + '%' : 'N/A';
        
        // Trending calculation
        const trendingValue = prev ? ((curr - prev) / prev * 100).toFixed(1) + '%' : 'N/A';
        const trendingSymbol = prev ? (curr > prev ? '📈' : (curr < prev ? '📉' : '➡️')) : '';

        // Row background - light green if beating center average
        if (isBeatingCenter) {
            ctx.fillStyle = '#d4edda'; // Light green for beating center
        } else {
            ctx.fillStyle = rowIdx % 2 === 0 ? '#f8f9fa' : '#ffffff';
        }
        ctx.fillRect(40, y, 820, 38);

        // Metric name
        ctx.fillStyle = '#333333';
        ctx.font = '14px Arial';
        ctx.fillText(formattedMetricName, 50, y + 24);
        
        // Your Metric value
        ctx.fillStyle = '#333333';
        ctx.font = 'bold 14px Arial';
        ctx.fillText(curr.toFixed(2), 300, y + 24);
        
        // Center Average
        ctx.font = '14px Arial';
        ctx.fillText(center > 0 ? center.toFixed(2) : 'N/A', 420, y + 24);
        
        // Target
        ctx.fillText(target.toString(), 540, y + 24);
        
        // vs. Center Avg
        const vsCenterNum = center > 0 ? ((curr - center) / center * 100) : 0;
        if (isBeatingCenter) {
            ctx.fillStyle = '#28a745'; // Green for beating center
        } else if (center > 0) {
            ctx.fillStyle = '#dc3545'; // Red for behind center
        } else {
            ctx.fillStyle = '#666666';
        }
        ctx.fillText(vsCenter, 630, y + 24);
        
        // Trending
        const changeNum = prev ? ((curr - prev) / prev * 100) : 0;
        ctx.fillStyle = changeNum > 0 ? '#28a745' : (changeNum < 0 ? '#dc3545' : '#666666');
        ctx.fillText(`${trendingSymbol} ${trendingValue}`, 770, y + 24);

        y += 38;
        rowIdx++;
    });

    // Footer with light background
    y += 20;
    ctx.fillStyle = '#f8f9fa';
    ctx.fillRect(0, y, 900, 50);
    ctx.fillStyle = '#666666';
    ctx.font = '13px Arial';
    ctx.fillText('Generated: ' + new Date().toLocaleDateString(), 50, y + 30);
    ctx.fillText('Development Coaching Tool', 700, y + 30);

    // Convert to image and copy to clipboard
    canvas.toBlob(blob => {
        if (!blob) {
            console.error('Failed to create blob from canvas');
            showToast('❌ Error creating image', 5000);
            return;
        }

        console.log('Canvas blob created successfully');

        // Try clipboard copy
        if (navigator.clipboard && navigator.clipboard.write) {
            navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
            ]).then(() => {
                console.log('✅ Copied to clipboard');
                showToast('✅ Image copied to clipboard! Opening Outlook...', 3000);
                
                // Open Outlook
                setTimeout(() => {
                    window.open(`mailto:?subject=Trend Report - ${empName}`, '_blank');
                }, 500);
            }).catch(err => {
                console.error('Clipboard error:', err);
                // Fallback to download
                downloadImageFallback(blob, empName, period);
            });
        } else {
            console.warn('Clipboard API not available, downloading instead');
            downloadImageFallback(blob, empName, period);
        }
    }, 'image/png');
}

function downloadImageFallback(blob, empName, period) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `TrendReport_${empName}_${period.startDate}.png`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('📥 Image downloaded! Open Outlook and insert the file.', 4000);
    
    setTimeout(() => {
        window.open(`mailto:?subject=Trend Report - ${empName}`, '_blank');
    }, 500);
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
    const lowerMetric = metric.toLowerCase();
    // High percentage goals (95+)
    if (lowerMetric.includes('quality') || lowerMetric.includes('yield') || lowerMetric.includes('fcr')) return 95;
    // Medium-high percentage goals (90+)
    if (lowerMetric.includes('adherence') || lowerMetric.includes('experience') || lowerMetric.includes('satisfaction') || 
        lowerMetric.includes('sentiment') || lowerMetric.includes('positive') || lowerMetric.includes('negative') || 
        lowerMetric.includes('emotion') || lowerMetric.includes('overall')) return 90;
    // Lower percentage goals (85+)
    if (lowerMetric.includes('oee') || lowerMetric.includes('utilization')) return 85;
    // Time-based goals (seconds)
    if (lowerMetric.includes('aht') || lowerMetric.includes('handle')) return 300; // 5 minutes
    if (lowerMetric.includes('acw') || lowerMetric.includes('aftercall')) return 90;
    if (lowerMetric.includes('talk') || lowerMetric.includes('talktime')) return 240; // 4 minutes
    if (lowerMetric.includes('hold')) return 30;
    // Reliability (hours)
    if (lowerMetric.includes('reliability')) return 2;
    // Lower is better metrics
    if (lowerMetric.includes('downtime')) return 5;
    if (lowerMetric.includes('scrap')) return 2;
    if (lowerMetric.includes('transfer')) return 10;
    // Survey/Call counts
    if (lowerMetric.includes('survey') || lowerMetric.includes('totalcalls') || lowerMetric.includes('calls')) return 100;
    // Default
    return 90;
}

function isMetricMeetingTarget(metric, value, target) {
    const lowerMetric = metric.toLowerCase();
    const isLowerBetter = lowerMetric.includes('downtime') || lowerMetric.includes('scrap') || 
                          lowerMetric.includes('defect') || lowerMetric.includes('transfer');
    return isLowerBetter ? value <= target : value >= target;
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
            const result = buildTrendEmailHtml(name, weekKey, { useEdits: false });
            if (!result) return;
            const plainText = htmlToPlainText(result.htmlEmail);
            const mailtoLink = `mailto:?subject=${encodeURIComponent(result.subject)}&body=${encodeURIComponent(plainText)}`;
            window.open(mailtoLink, '_blank');
        }, index * 500);
    });
}

function compareToCenter(employeeValue, centerValue, lowerIsBetter) {
    if (lowerIsBetter) {
        // For AHT, ACW: lower is better
        if (employeeValue <= centerValue) {
            return { status: 'meets', icon: '✅' };
        } else {
            return { status: 'below', icon: '⬇️' };
        }
    } else {
        // For all others: higher is better
        if (employeeValue >= centerValue) {
            return { status: 'meets', icon: '✅' };
        } else {
            return { status: 'below', icon: '⬇️' };
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
    
    // Find matching period in weeklyData
    for (const key of Object.keys(weeklyData).sort().reverse()) {
        if (key.includes(prevEndStr)) {
            return key;
        }
    }
    
    return null;
}

function compareToYearlyAverage(employeeName, metricKey, currentValue, lowerIsBetter) {
    /**
     * Compare employee's current value to their yearly average
     * Returns: { status: 'meets'|'below'|'first', icon: '✅'|'❌'|'⚠️', yearlyAvg: number }
     */
    const yearlyAvg = getYearlyAverageForEmployee(employeeName, metricKey);
    
    if (!yearlyAvg) {
        return { status: 'first', icon: '⚠️', yearlyAvg: null };
    }
    
    const isMeeting = lowerIsBetter ? currentValue <= yearlyAvg.value : currentValue >= yearlyAvg.value;
    
    if (isMeeting) {
        return { status: 'meets', icon: '✅', yearlyAvg: yearlyAvg.value };
    } else {
        return { status: 'below', icon: '❌', yearlyAvg: yearlyAvg.value };
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
            return { status: 'improved', icon: '⬆️', delta: Math.round(delta * 100) / 100 };
        } else {
            return { status: 'declined', icon: '⬇️', delta: Math.round(delta * 100) / 100 };
        }
    } else {
        // For others: increase is improvement
        if (delta > 0) {
            return { status: 'improved', icon: '⬆️', delta: Math.round(delta * 100) / 100 };
        } else {
            return { status: 'declined', icon: '⬇️', delta: Math.round(delta * 100) / 100 };
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
        { label: 'Avg Schedule Adherence', value: avgAdherence + '%', icon: '⏰' },
        { label: 'Avg Transfers', value: avgTransfers + '%', icon: '📞' },
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
    
    // Initialize the new yearly individual summary section
    initializeYearlyIndividualSummary();
}

function initializeYearlyIndividualSummary() {
    console.log('📊 Initializing Yearly Individual Summary...');
    populateExecutiveSummaryAssociate();
    
    // Period type is always YTD for executive summary
    
    // Add event listener for associate dropdown
    document.getElementById('summaryAssociateSelect')?.addEventListener('change', () => {
        loadExecutiveSummaryData();
        showEmailSection();
    });
    
    // Add event listener for email generation button
    document.getElementById('generateExecutiveSummaryEmailBtn')?.addEventListener('click', generateExecutiveSummaryEmail);
    
    // Add event listener for copy button
    document.getElementById('copyExecutiveSummaryEmailBtn')?.addEventListener('click', () => {
        const htmlEmail = window.latestExecutiveSummaryHtml;
        if (!htmlEmail || htmlEmail.trim() === '') {
            showToast('Generate an email first', 5000);
            return;
        }
        const blob = new Blob([htmlEmail], { type: 'text/html' });
        const htmlClipboardItem = new ClipboardItem({ 'text/html': blob });
        navigator.clipboard.write([htmlClipboardItem]).then(() => {
            showToast('Email copied to clipboard!', 5000);
        }).catch(() => {
            navigator.clipboard.writeText(htmlEmail).then(() => {
                showToast('Copied as plain text', 5000);
            }).catch(() => {
                showToast('Failed to copy email', 5000);
            });
        });
    });
    
    console.log('✅ Yearly Individual Summary initialized');
}

function showEmailSection() {
    const associate = document.getElementById('summaryAssociateSelect').value;
    const section = document.getElementById('summaryEmailSection');
    if (associate && section) {
        section.style.display = 'block';
    }
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
    let reliabilityHours = null;
    if (reliabilityMetric) {
        const hoursMatch = reliabilityMetric.match(/(\d+\.?\d*)\s*hrs?/);
        const parsedHours = hoursMatch?.[1] ? parseFloat(hoursMatch[1]) : NaN;
        reliabilityHours = Number.isFinite(parsedHours) ? parsedHours : employeeData.reliability;
        opportunitiesSection += `\nRELIABILITY NOTE:\nYou have ${reliabilityHours} hours listed as unscheduled/unplanned time. Please check Verint to make sure this aligns with any time missed ${timeReference} that was unscheduled. If this is an error, please let me know.\n`;
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

Vary your wording and sentence structure so it doesn’t sound templated or AI-generated. Use natural phrasing and avoid repeating the same patterns.

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
    const summaryData = window.latestCoachingSummaryData;
    
    if (summaryData) {
        const cleanLabel = (item) => {
            if (!item) return '';
            const match = item.match(/^-\s*(.+?):/);
            if (match) return match[1].trim();
            return item.replace(/^-/,'').split(':')[0].trim();
        };
        const formatList = (items) => {
            const list = items.filter(Boolean);
            if (list.length === 0) return '';
            if (list.length === 1) return list[0];
            if (list.length === 2) return `${list[0]} and ${list[1]}`;
            return `${list[0]}, ${list[1]}, and ${list[2]}`;
        };
        
        const winsLabels = summaryData.celebrate.map(cleanLabel).filter(Boolean);
        const oppLabels = summaryData.needsCoaching.map(cleanLabel).filter(Boolean);
        
        const winsSentence = winsLabels.length > 0
            ? `Recognized strengths in ${formatList(winsLabels)}.`
            : `Reviewed overall performance highlights for ${summaryData.periodLabel}.`;
        
        const oppSentence = oppLabels.length > 0
            ? `Coached on improving ${formatList(oppLabels)} with clear next steps.`
            : `No major coaching gaps identified for this period.`;
        
        const reliabilitySentence = summaryData.reliabilityHours !== null && summaryData.reliabilityHours !== undefined
            ? `Reviewed ${summaryData.reliabilityHours} hours of unscheduled time and Verint alignment.`
            : '';
        
        const notesSentence = summaryData.customNotes
            ? `Additional context noted: ${summaryData.customNotes.trim().replace(/\s+/g, ' ')}.`
            : '';
        
        const summaryParts = [winsSentence, oppSentence];
        if (reliabilitySentence) {
            summaryParts.push(reliabilitySentence);
        } else if (notesSentence) {
            summaryParts.push(notesSentence);
        }
        
        const verintSummary = summaryParts.join(' ');
        
        navigator.clipboard.writeText(verintSummary).then(() => {
            alert('✅ Verint summary copied to clipboard.');
        }).catch(err => {
            console.error('Failed to copy:', err);
            alert('❌ Failed to copy summary to clipboard. Please try again.');
        });
        return;
    }
    
    const copilotEmail = document.getElementById('copilotOutputText')?.value.trim();
    if (!copilotEmail) {
        alert('⚠️ Generate the coaching prompt first so I can build a Verint summary.');
        return;
    }
    
    const summaryPrompt = `Based on this coaching email, create a brief Verint coaching summary (2-3 sentences max) that captures the key coaching points. Make it concise and suitable for internal system notes.

Email:
${copilotEmail}

Verint Summary:`;
    
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
    console.log('🚀 Initializing Development Coaching Tool...');
    
    // Load data from localStorage
    weeklyData = loadWeeklyData();
    coachingLogYTD = loadCoachingLog();
    loadTeamMembers();
    
    console.log(`📊 Loaded ${Object.keys(weeklyData).length} weeks of data`);
    console.log('📦 weeklyData keys:', Object.keys(weeklyData));
    if (Object.keys(weeklyData).length > 0) {
        console.log('✅ Weekly data successfully loaded from localStorage');
    } else {
        console.warn('⚠️ No weekly data in localStorage. Upload CSV to populate.');
    }
    
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
        populateDeleteWeekDropdown();
        populateTeamMemberSelector();
    }
    
    // Ensure data is saved before page unload (survives Ctrl+Shift+R)
    window.addEventListener('beforeunload', () => {
        saveWeeklyData();
        console.log('💾 Auto-saving weekly data on page unload');
    });
    
    console.log('? Application initialized successfully!');
}

// ===== EXECUTIVE SUMMARY FUNCTIONS =====

function populateExecutiveSummaryAssociate() {
    console.log('📋 Populating Executive Summary associate dropdown...');
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
    
    console.log(`✅ Populated ${sortedEmployees.length} team members`);
}

function loadExecutiveSummaryData() {
    const associate = document.getElementById('summaryAssociateSelect').value;
    const periodType = 'ytd'; // Always use Year-to-Date
    
    console.log(`\n📊 loadExecutiveSummaryData started - associate: ${associate}`);
    
    if (!associate) {
        console.log('⚠️ No associate selected');
        document.getElementById('summaryDataContainer').style.display = 'none';
        document.getElementById('summaryChartsContainer').style.display = 'none';
        return;
    }
    
    console.log(`📊 Loading executive summary for ${associate} (YTD)`);
    console.log(`Available weeks in weeklyData: ${Object.keys(weeklyData).length}`);
    
    // Collect ALL periods (regardless of upload type) for YTD view
    const matchingPeriods = [];
    for (const weekKey in weeklyData) {
        const weekData = weeklyData[weekKey];
        
        // For executive summary (YTD), include all periods regardless of metadata type
        const employee = weekData.employees.find(e => e.name === associate);
        if (employee) {
            console.log(`  ✅ Found ${associate} in period ${weekKey}`);
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
    
    console.log(`Found ${matchingPeriods.length} periods for YTD summary`);
    
    // Populate data table
    populateExecutiveSummaryTable(associate, matchingPeriods, periodType);
    
    // Display metric comparisons
    displayExecutiveSummaryCharts(associate, matchingPeriods, periodType);
    
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
    showToast(`✅ Notes saved for ${associate}`, 3000);
}

function displayExecutiveSummaryCharts(associate, periods, periodType) {
    console.log(`📊 displayExecutiveSummaryCharts called for ${associate} with ${periods.length} periods`);
    
    const container = document.getElementById('summaryMetricsVisuals');
    if (!container) {
        console.error('ERROR: summaryMetricsVisuals container not found!');
        return;
    }
    container.innerHTML = '';
    
    if (!periods || periods.length === 0) {
        console.warn('⚠️ No periods provided to displayExecutiveSummaryCharts');
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
                ${hasNoSurveyData ? '💬 Awaiting customer survey data' : (centerAvg === null ? '⚠️ No center average data entered' : (metric.lowerIsBetter ? (employeeAvg <= centerAvg ? '✅ Meeting center average' : '⚠️ Below center average') : (employeeAvg >= centerAvg ? '✅ Meeting center average' : '⚠️ Below center average')))}
            </div>
        `;
        
        container.appendChild(chartDiv);
    });
    
    console.log(`✅ displayExecutiveSummaryCharts completed - rendered ${metrics.length} metrics`);
}

function getCenterAverageForWeek(weekKey) {
    // Load call center averages from localStorage
    const callCenterAverages = localStorage.getItem('callCenterAverages') ? JSON.parse(localStorage.getItem('callCenterAverages')) : {};
    const avg = callCenterAverages[weekKey];
    
    if (!avg || Object.keys(avg).length === 0) {
        console.warn(`⚠️ No call center average found for ${weekKey}. Make sure it's entered in Metric Trends.`);
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

function generateExecutiveSummaryEmail() {
    console.log('📧 Generating Executive Summary email...');
    const associate = document.getElementById('summaryAssociateSelect').value;
    const periodType = 'ytd'; // Always use Year-to-Date
    
    if (!associate) {
        showToast('Please select an associate first', 5000);
        return;
    }
    
    // Get YTD metrics for the associate
    const periods = [];
    for (const weekKey in weeklyData) {
        const weekData = weeklyData[weekKey];
        // For executive summary (YTD), include all periods regardless of metadata type
        const employee = weekData.employees.find(e => e.name === associate);
        if (employee) {
            periods.push({
                employee,
                centerAverage: getCenterAverageForWeek(weekKey)
            });
        }
    }
    
    if (periods.length === 0) {
        showToast('No data found for this associate and period type', 5000);
        return;
    }
    
    // Check if associate has any surveys
    let totalSurveys = 0;
    periods.forEach(period => {
        if (period.employee && period.employee.surveyTotal) {
            totalSurveys += parseInt(period.employee.surveyTotal) || 0;
        }
    });
    const hasSurveys = totalSurveys > 0;
    
    // Calculate YTD averages
    const metrics = [
        { key: 'scheduleAdherence', label: 'Schedule Adherence', unit: '%', surveyBased: false },
        { key: 'overallExperience', label: 'Overall Experience', unit: '%', surveyBased: true },
        { key: 'cxRepOverall', label: 'CX Rep Overall', unit: '%', surveyBased: true },
        { key: 'fcr', label: 'First Call Resolution', unit: '%', surveyBased: true },
        { key: 'transfers', label: 'Transfers', unit: '%', surveyBased: false },
        { key: 'overallSentiment', label: 'Sentiment', unit: '%', surveyBased: true },
        { key: 'positiveWord', label: 'Positive Words', unit: '%', surveyBased: true },
        { key: 'negativeWord', label: 'Negative Words', unit: '%', surveyBased: true },
        { key: 'managingEmotions', label: 'Managing Emotions', unit: '%', surveyBased: true },
        { key: 'aht', label: 'Average Handle Time', unit: 's', surveyBased: false },
        { key: 'acw', label: 'After Call Work', unit: 's', surveyBased: false },
        { key: 'holdTime', label: 'Hold Time', unit: 's', surveyBased: false },
        { key: 'reliability', label: 'Reliability', unit: 'hrs', surveyBased: false }
    ];
    
    let meetsTargetCount = 0;
    let outpacingPeersCount = 0;
    let totalMetricsEvaluated = 0;
    
    let metricsHtml = '';
    
    metrics.forEach(metric => {
        // If no surveys and metric is survey-based, give them the point (don't count against them)
        if (!hasSurveys && metric.surveyBased) {
            meetsTargetCount++;
            outpacingPeersCount++;
            totalMetricsEvaluated++;
            return; // Skip to next metric
        }
        
        // Calculate averages
        let empSum = 0, empCount = 0;
        let centerSum = 0, centerCount = 0;
        
        periods.forEach(period => {
            if (period.employee && period.employee[metric.key] !== undefined && period.employee[metric.key] !== null && period.employee[metric.key] !== '') {
                empSum += parseFloat(period.employee[metric.key]);
                empCount++;
            }
            if (period.centerAverage && period.centerAverage[metric.key] !== undefined && period.centerAverage[metric.key] !== null && period.centerAverage[metric.key] !== '') {
                centerSum += parseFloat(period.centerAverage[metric.key]);
                centerCount++;
            }
        });
        
        if (empCount === 0) return; // Skip if no data for this metric
        
        totalMetricsEvaluated++;
        
        const empAvg = empSum / empCount;
        const centerAvg = centerCount > 0 ? centerSum / centerCount : null;
        const targetObj = METRICS_REGISTRY[metric.key]?.target;
        const targetValue = targetObj && typeof targetObj === 'object' ? targetObj.value : null;
        const targetType = targetObj?.type || 'min';
        
        // Determine if meeting target
        let meetsTarget = false;
        let status = '❓';
        if (typeof targetValue === 'number') {
            if (targetType === 'max') {
                // Lower is better
                meetsTarget = empAvg <= targetValue;
                status = meetsTarget ? '✅' : '❌';
            } else {
                // Higher is better
                meetsTarget = empAvg >= targetValue;
                status = meetsTarget ? '✅' : '❌';
            }
        }
        
        if (meetsTarget) meetsTargetCount++;
        
        // Determine if outpacing peers
        let outpacingPeers = false;
        let comparison = '';
        if (centerAvg !== null) {
            if (targetType === 'max') {
                // Lower is better
                outpacingPeers = empAvg < centerAvg;
                const diff = centerAvg - empAvg;
                comparison = outpacingPeers ? `📈 ${diff.toFixed(1)}${metric.unit} better` : `📉 ${Math.abs(diff).toFixed(1)}${metric.unit} behind`;
            } else {
                // Higher is better
                outpacingPeers = empAvg > centerAvg;
                const diff = empAvg - centerAvg;
                comparison = outpacingPeers ? `📈 ${diff.toFixed(1)}${metric.unit} better` : `📉 ${Math.abs(diff).toFixed(1)}${metric.unit} behind`;
            }
        }
        
        if (outpacingPeers) outpacingPeersCount++;
        
        // Build metric row HTML
        const bgColor = meetsTarget ? '#d4edda' : '#fff3cd';
        metricsHtml += `
            <tr style="background: ${bgColor};">
                <td style="padding: 10px; border: 1px solid #ddd;">${status} ${metric.label}</td>
                <td style="padding: 10px; border: 1px solid #ddd; text-align: center; font-weight: bold;">${empAvg.toFixed(1)}${metric.unit}</td>
                <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${centerAvg !== null ? centerAvg.toFixed(1) + metric.unit : 'N/A'}</td>
                <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${typeof targetValue === 'number' ? targetValue + metric.unit : 'N/A'}</td>
                <td style="padding: 10px; border: 1px solid #ddd; text-align: center;">${comparison || 'N/A'}</td>
            </tr>
        `;
    });
    
    // Build HTML email
    const firstName = associate.split(' ')[0];
    let htmlEmail = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 800px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 8px; margin-bottom: 20px; }
        .header h1 { margin: 0; font-size: 28px; }
        .header p { margin: 5px 0 0 0; opacity: 0.9; }
        .cards { display: flex; gap: 20px; margin: 20px 0; }
        .card { flex: 1; background: white; border-radius: 8px; padding: 20px; text-align: center; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .card.success { border-left: 4px solid #28a745; }
        .card.info { border-left: 4px solid #2196F3; }
        .card-value { font-size: 48px; font-weight: bold; margin: 10px 0; }
        .card-label { font-size: 14px; color: #666; text-transform: uppercase; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th { background: #f8f9fa; padding: 12px; text-align: left; border: 1px solid #ddd; font-weight: bold; }
        td { padding: 10px; border: 1px solid #ddd; }
        .footer { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-top: 20px; text-align: center; color: #666; }
    </style>
</head>
<body>
    <div class="header">
        <h1>🎯 Year-to-Date Performance Review</h1>
        <p><strong>${associate}</strong></p>
        <p>Report Date: ${new Date().toLocaleDateString()} | Period: Year-to-Date</p>
    </div>
    
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin: 20px 0; border-collapse: collapse;">
        <tr>
            <td width="50%" style="padding: 10px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border: 1px solid #d4edda; background: #d4edda; border-radius: 8px;">
                    <tr><td style="padding: 14px; text-align: center; font-family: Arial, sans-serif;">
                        <div style="font-size: 12px; color: #2c3e50; font-weight: bold;">✅ Meeting Target Goals</div>
                        <div style="font-size: 36px; font-weight: bold; color: #2c3e50; margin: 6px 0;">${meetsTargetCount}/${totalMetricsEvaluated}</div>
                        <div style="font-size: 12px; color: #2c3e50;">${Math.round((meetsTargetCount/totalMetricsEvaluated)*100)}% Success Rate</div>
                    </td></tr>
                </table>
            </td>
            <td width="50%" style="padding: 10px;">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border: 1px solid #d1ecf1; background: #d1ecf1; border-radius: 8px;">
                    <tr><td style="padding: 14px; text-align: center; font-family: Arial, sans-serif;">
                        <div style="font-size: 12px; color: #2c3e50; font-weight: bold;">📈 Outpacing Your Peers</div>
                        <div style="font-size: 36px; font-weight: bold; color: #2c3e50; margin: 6px 0;">${outpacingPeersCount}/${totalMetricsEvaluated}</div>
                        <div style="font-size: 12px; color: #2c3e50;">${Math.round((outpacingPeersCount/totalMetricsEvaluated)*100)}% Above Center</div>
                    </td></tr>
                </table>
            </td>
        </tr>
    </table>
    
    ${!hasSurveys ? '<p style="background: #fff3cd; padding: 15px; border-left: 4px solid #ffc107; border-radius: 4px;">ℹ️ <strong>Note:</strong> No survey data available for this period. Survey-based metrics are marked as meeting goals by default.</p>' : ''}
    
    <h2 style="margin-top: 30px;">📊 Detailed Performance Metrics</h2>
    <table>
        <thead>
            <tr>
                <th>Metric</th>
                <th style="text-align: center;">Your YTD Avg</th>
                <th style="text-align: center;">Center Avg</th>
                <th style="text-align: center;">Target</th>
                <th style="text-align: center;">vs. Center</th>
            </tr>
        </thead>
        <tbody>
            ${metricsHtml}
        </tbody>
    </table>
    
    <div class="footer">
        <p><strong>Great work, ${firstName}! 🌟</strong></p>
        <p>Continue focusing on areas marked with ❌ and maintain excellence in areas marked with ✅</p>
    </div>
</body>
</html>
    `;
    
    // Display and copy
    const previewContainer = document.getElementById('executiveSummaryEmailPreview');
    if (previewContainer) {
        window.latestExecutiveSummaryHtml = htmlEmail;
        previewContainer.srcdoc = htmlEmail;
        previewContainer.style.display = 'block';
        console.log('✅ HTML email generated and displayed');
    }
    
    // Copy HTML to clipboard with formatting
    const blob = new Blob([htmlEmail], { type: 'text/html' });
    const htmlClipboardItem = new ClipboardItem({ 'text/html': blob });
    
    navigator.clipboard.write([htmlClipboardItem]).then(() => {
        console.log('✅ HTML email copied to clipboard with formatting');
        showToast('✅ Email copied! Opening new email...', 3000);
        
        // Open blank email in default email client
        window.location.href = 'mailto:?subject=Yearly Performance Review - ' + encodeURIComponent(associate.toUpperCase());
    }).catch((err) => {
        console.error('❌ Failed to copy formatted email:', err);
        // Fallback to plain text if HTML clipboard fails
        navigator.clipboard.writeText(htmlEmail).then(() => {
            showToast('⚠️ Copied as plain text. You may need to paste into Outlook\'s HTML editor.', 5000);
            // Still try to open email
            window.location.href = 'mailto:?subject=Yearly Performance Review - ' + encodeURIComponent(associate.toUpperCase());
        });
    });
}

// ===== END EXECUTIVE SUMMARY FUNCTIONS =====

// ===== OFFLINE PACKAGE DOWNLOAD =====
async function downloadOfflinePackage() {
    showToast('📦 Preparing offline package...', 3000);
    
    try {
        // Create JSZip instance
        const JSZip = window.JSZip || await import('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js');
        const zip = new JSZip();
        
        // Fetch current page HTML
        const indexResponse = await fetch('index.html');
        const indexHtml = await indexResponse.text();
        
        // Replace CDN links with local files
        const offlineIndex = indexHtml
            .replace('https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js', 'lib-xlsx.js')
            .replace('https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.js', 'lib-chart.js')
            .replace('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js', 'lib-html2canvas.js')
            .replace('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js', 'lib-jszip.js');
        
        zip.file('index.html', offlineIndex);
        
        // Add essential files
        const files = [
            'homepage.html',
            'script.js',
            'styles.css',
            'homepage-styles.css',
            'tips.csv',
            'lib-xlsx.js',
            'lib-chart.js',
            'lib-html2canvas.js',
            'lib-jszip.js'
        ];
        
        for (const file of files) {
            try {
                const response = await fetch(file);
                if (response.ok) {
                    const content = await response.blob();
                    zip.file(file, content);
                }
            } catch (err) {
                console.log(`⚠️ Could not fetch ${file}:`, err);
            }
        }
        
        // Add README
        const readme = `# Development Coaching Tool - Offline Package

This package contains everything you need to run the Development Coaching Tool offline.

## How to Use:

1. Extract this ZIP file to a folder on your computer
2. Open index.html in your web browser
3. The tool will work completely offline - no internet required!

## What's Included:

- Main application files (index.html, script.js, styles.css)
- All JavaScript libraries (Chart.js, SheetJS, html2canvas)
- Tips database (tips.csv)
- Homepage and styling files

## System Requirements:

- Any modern web browser (Chrome, Firefox, Edge, Safari)
- No internet connection required after extraction
- No installation needed - just open index.html

Created: ${new Date().toLocaleString()}
`;
        
        zip.file('OFFLINE-README.txt', readme);
        
        // Generate ZIP
        const blob = await zip.generateAsync({ type: 'blob' });
        
        // Trigger download
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'coaching-tool-offline.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast('✅ Offline package downloaded! Extract and open index.html', 5000);
    } catch (err) {
        console.error('Error creating offline package:', err);
        showToast('❌ Could not create offline package. Check console for details.', 5000);
    }
}
// ===== END OFFLINE PACKAGE =====

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}


