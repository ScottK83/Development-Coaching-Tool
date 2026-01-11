/* ========================================
   DEVELOPMENT COACHING TOOL
   Complete rewrite with proper encoding and parsing
   ======================================== */

// ============================================
// GLOBAL STATE
// ============================================
let weeklyData = {};
let uploadHistory = [];
let coachingHistory = {};
let currentPeriodType = 'week';
let currentPeriod = null;

// ============================================
// TARGET METRICS
// ============================================
const TARGETS = {
    driver: {
        scheduleAdherence: { min: 95 },
        cxRepOverall: { min: 85 },
        fcr: { min: 70 },
        overallExperience: { min: 80 },
        transfers: { max: 9 },
        overallSentiment: { min: 75 },
        positiveWord: { min: 80 },
        negativeWord: { min: 80 },
        managingEmotions: { min: 80 },
        aht: { max: 480 },
        acw: { max: 120 },
        holdTime: { max: 60 },
        reliability: { max: 0 }
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

function showToast(message, duration = 2000) {
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

function updateTabHighlight(activeSectionId) {
    const tabMapping = {
        'coachingForm': 'homeBtn',
        'coachingSection': 'generateCoachingBtn',
        'dashboardSection': 'employeeDashboard',
        'tipsManagementSection': 'manageTips',
        'executiveSummarySection': 'executiveSummaryBtn'
    };
    
    ['homeBtn', 'generateCoachingBtn', 'employeeDashboard', 'manageTips'].forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.style.background = '#e9ecef';
            btn.style.color = '#333';
        }
    });
    
    const activeButtonId = tabMapping[activeSectionId];
    if (activeButtonId && activeButtonId !== 'executiveSummaryBtn') {
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
        console.warn(`⚠️ Unexpected percentage value: ${parsed}. Treating as 0.`);
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
        console.warn(`⚠️ Unexpected survey percentage: ${parsed}. Treating as empty.`);
        return '';
    }
    
    return parseFloat(parsed.toFixed(2));
}

/**
 * Parse time in seconds
 * Handles: "480", 480, null
 * Returns: integer seconds or empty string
 */
function parseSeconds(value) {
    if (!value && value !== 0) return '';
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

// Canonical schema - authoritative field names
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

// Header patterns - MUST be in order: most specific patterns first!
// Order matters because we stop at first match
// Uses array to guarantee deterministic iteration (object key order not guaranteed)
const HEADER_PATTERNS = [
    { canonical: CANONICAL_SCHEMA.EMPLOYEE_NAME, patterns: ['name (last'] },
    { canonical: CANONICAL_SCHEMA.TOTAL_CALLS, patterns: ['totalcallsanswered'] },
    { canonical: CANONICAL_SCHEMA.ADHERENCE_PERCENT, patterns: ['adherence%'] },
    { canonical: CANONICAL_SCHEMA.TRANSFERS_PERCENT, patterns: ['transfer%'] },
    { canonical: CANONICAL_SCHEMA.AHT_SECONDS, patterns: ['aht'] },
    { canonical: CANONICAL_SCHEMA.TALK_SECONDS, patterns: ['talk'] },
    { canonical: CANONICAL_SCHEMA.ACW_SECONDS, patterns: ['acw'] },
    { canonical: CANONICAL_SCHEMA.HOLD_SECONDS, patterns: ['hold'] },
    { canonical: CANONICAL_SCHEMA.RELIABILITY_HOURS, patterns: ['reliability'] },
    { canonical: CANONICAL_SCHEMA.SURVEY_TOTAL, patterns: ['oe survey total'] },
    { canonical: CANONICAL_SCHEMA.CX_REP_OVERALL, patterns: ['repsat%'] },
    { canonical: CANONICAL_SCHEMA.FCR_PERCENT, patterns: ['fcr%'] },
    { canonical: CANONICAL_SCHEMA.OVERALL_EXPERIENCE, patterns: ['overallexpitotal'] },
    { canonical: CANONICAL_SCHEMA.SENTIMENT_PERCENT, patterns: ['sentimentscore'] },
    { canonical: CANONICAL_SCHEMA.POSITIVE_WORD_PERCENT, patterns: ['positivewordscore'] },
    { canonical: CANONICAL_SCHEMA.NEGATIVE_WORD_PERCENT, patterns: ['negativewordscore'] },
    { canonical: CANONICAL_SCHEMA.EMOTIONS_PERCENT, patterns: ['emotionscore'] }
];

// Only employee name is strictly required for ingestion
// Other fields are optional - system will work with partial data
const REQUIRED_FIELDS = [
    CANONICAL_SCHEMA.EMPLOYEE_NAME
];

// Map headers to canonical schema using simple substring matching
function mapHeadersToSchema(headers) {
    const mapping = {};
    const sourceMapping = {}; // For logging: canonical -> source header
    const usedIndices = new Set(); // Track which header indices we've already mapped
    
    console.log('🔍 DEBUG: Starting header mapping...');
    console.log('🔍 DEBUG: Available headers:', headers);
    
    // Try to match each canonical field - using array to guarantee order
    for (const { canonical, patterns } of HEADER_PATTERNS) {
        for (let i = 0; i < headers.length; i++) {
            if (usedIndices.has(i)) continue; // Skip already-mapped headers
            
            const header = headers[i].toLowerCase();
            
            // Check if any pattern matches (simple substring search)
            const matchedPattern = patterns.find(pattern => header.includes(pattern));
            if (matchedPattern) {
                mapping[canonical] = i;
                sourceMapping[canonical] = headers[i];
                usedIndices.add(i);
                console.log(`🎯 Matched header[${i}]="${headers[i]}" -> canonical="${canonical}" (pattern: "${matchedPattern}")`);
                break; // Found match, move to next canonical field
            }
        }
    }
    
    // Find unmapped headers
    const unmapped = headers.filter((h, i) => !usedIndices.has(i));
    
    // Validate required fields
    const missing = REQUIRED_FIELDS.filter(field => !(field in mapping));
    
    // Log mapping results
    console.log('📋 Column Mapping Results:');
    console.log('✅ Mapped:', sourceMapping);
    if (unmapped.length > 0) {
        console.log('⚠️  Unmapped columns:', unmapped);
    }
    if (missing.length > 0) {
        console.error('❌ Missing required fields:', missing);
        console.error('📝 Available headers:', headers.join(', '));
        throw new Error(`Missing required columns: ${missing.join(', ')}. Check the headers in your PowerBI data.`);
    }
    
    // Warn about optional unmapped fields that we recognize
    const optionalFields = [
        CANONICAL_SCHEMA.ADHERENCE_PERCENT,
        CANONICAL_SCHEMA.TRANSFERS_PERCENT,
        CANONICAL_SCHEMA.AHT_SECONDS
    ];
    const missingOptional = optionalFields.filter(field => !(field in mapping));
    if (missingOptional.length > 0) {
        console.warn('⚠️  Optional fields not found (data will be incomplete):', missingOptional);
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
    
    // Detect separator (PowerBI uses TAB)
    let separator = '\t';
    if (!lines[0].includes('\t')) {
        separator = lines[0].includes(',') ? ',' : /\s{2,}/;
    }
    
    // CRITICAL: Protect composite headers containing commas BEFORE splitting
    // Example: "Name (Last, First)" must remain as one column
    const COMMA_PLACEHOLDER = '__COMMA__';
    
    // Protect commas within parentheses in header row
    let headerRow = lines[0];
    headerRow = headerRow.replace(/\(([^)]*),([^)]*)\)/g, (match, before, after) => {
        return `(${before}${COMMA_PLACEHOLDER}${after})`;
    });
    
    // Parse headers with protected commas
    let headers = headerRow.split(separator).map(h => {
        // Restore commas in composite headers
        return h.trim().replace(new RegExp(COMMA_PLACEHOLDER, 'g'), ',');
    });
    
    console.log('📋 Parsed headers:', headers);
    console.log('🔍 Name column header:', headers.find(h => h.toLowerCase().includes('name')));
    
    // Validate that first row looks like headers (should contain "Name" or "Adherence")
    const hasNameHeader = headers.some(h => h.toLowerCase().includes('name'));
    const hasAdherenceHeader = headers.some(h => h.toLowerCase().includes('adherence'));
    
    if (!hasNameHeader && !hasAdherenceHeader) {
        throw new Error('❌ Header row not found! Make sure to include the header row (Name, TotalCallsAnswered, Transfers%, etc.) at the top of your pasted data.');
    }
    
    // Map headers to canonical schema
    const colMapping = mapHeadersToSchema(headers);
    
    // Parse employee data
    const employees = [];
    
    for (let i = 1; i < lines.length; i++) {
        let rawRow = lines[i];
        
        console.log('🔍 Raw row:', rawRow);
        
        // CRITICAL: Protect composite name field commas BEFORE splitting
        // Must match header protection logic
        rawRow = rawRow.replace(/\(([^)]*),([^)]*)\)/g, (match, before, after) => {
            return `(${before}${COMMA_PLACEHOLDER}${after})`;
        });
        
        // Split the row by separator to match header structure
        const cells = rawRow.split(separator).map(c => {
            // Restore commas in protected fields
            return c.trim().replace(new RegExp(COMMA_PLACEHOLDER, 'g'), ',');
        });
        
        // Extract name from the mapped name column
        const rawName = cells[colMapping[CANONICAL_SCHEMA.EMPLOYEE_NAME]] || '';
        
        // Parse the name using regex (handles "LastName, FirstName" format)
        const nameMatch = rawName.match(/^([^,]+),\s*(\S+)/);
        
        if (!nameMatch) {
            console.warn('⚠️ Skipping row - no valid name found:', rawName);
            continue;
        }
        
        const lastName = nameMatch[1].trim();
        const firstName = nameMatch[2].trim();
        const displayName = `${firstName} ${lastName}`;
        
        console.log('✅ Parsed firstName:', firstName);
        console.log('✅ Parsed lastName:', lastName);
        console.log('✅ Display name:', displayName);
        
        // Warn about potential parsing issues but don't reject
        if (firstName === lastName) {
            console.warn('⚠️ firstName equals lastName - possible data issue:', displayName);
        }
        
        console.log('📊 Total cells:', cells.length);
        
        // Helper to safely get cell value by canonical field
        const getCell = (canonicalField) => {
            const idx = colMapping[canonicalField];
            if (idx === undefined) return '';
            return cells[idx] || '';
        };
        
        // Get survey total first to determine if survey metrics should be included
        const surveyTotal = parseInt(getCell(CANONICAL_SCHEMA.SURVEY_TOTAL)) || 0;
        
        const employeeData = {
            name: displayName,
            firstName: firstName,
            scheduleAdherence: parsePercentage(getCell(CANONICAL_SCHEMA.ADHERENCE_PERCENT)) || 0,
            cxRepOverall: surveyTotal > 0 ? parseSurveyPercentage(getCell(CANONICAL_SCHEMA.CX_REP_OVERALL)) : '',
            fcr: surveyTotal > 0 ? parseSurveyPercentage(getCell(CANONICAL_SCHEMA.FCR_PERCENT)) : '',
            overallExperience: surveyTotal > 0 ? parseSurveyPercentage(getCell(CANONICAL_SCHEMA.OVERALL_EXPERIENCE)) : '',
            transfers: parsePercentage(getCell(CANONICAL_SCHEMA.TRANSFERS_PERCENT)) || 0,
            aht: parseSeconds(getCell(CANONICAL_SCHEMA.AHT_SECONDS)) || '',
            talkTime: parseSeconds(getCell(CANONICAL_SCHEMA.TALK_SECONDS)) || '',
            acw: parseSeconds(getCell(CANONICAL_SCHEMA.ACW_SECONDS)) || '',
            holdTime: parseSeconds(getCell(CANONICAL_SCHEMA.HOLD_SECONDS)) || '',
            reliability: parseHours(getCell(CANONICAL_SCHEMA.RELIABILITY_HOURS)) || 0,
            overallSentiment: parsePercentage(getCell(CANONICAL_SCHEMA.SENTIMENT_PERCENT)) || '',
            positiveWord: parsePercentage(getCell(CANONICAL_SCHEMA.POSITIVE_WORD_PERCENT)) || '',
            negativeWord: parsePercentage(getCell(CANONICAL_SCHEMA.NEGATIVE_WORD_PERCENT)) || '',
            managingEmotions: parsePercentage(getCell(CANONICAL_SCHEMA.EMOTIONS_PERCENT)) || '',
            surveyTotal: surveyTotal,
            totalCalls: parseInt(getCell(CANONICAL_SCHEMA.TOTAL_CALLS)) || 0
        };
        
        // Debug log for first 3 employees
        if (i <= 3) {
            console.log(`\n✅ ${displayName}:`);
            console.log('  Survey Total:', surveyTotal);
            console.log('  Adherence:', employeeData.scheduleAdherence + '%');
            console.log('  Transfers:', employeeData.transfers + '%');
            console.log('  RepSat:', employeeData.cxRepOverall || 'N/A');
        }
        
        employees.push(employeeData);
    }
    
    console.log(`✅ Parsed ${employees.length} employees`);
    
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
        dataLines.forEach(line => {
            const match = line.match(/^([^,]+),"?([^"]*)"?$/);
            if (match) {
                const metric = match[1].trim();
                const tip = match[2].trim();
                
                if (!tips[metric]) {
                    tips[metric] = [];
                }
                tips[metric].push(tip);
            }
        });
        
        // Apply modified server tips from localStorage
        const modifiedServerTips = JSON.parse(localStorage.getItem('modifiedServerTips') || '{}');
        Object.keys(modifiedServerTips).forEach(metricKey => {
            if (tips[metricKey]) {
                Object.keys(modifiedServerTips[metricKey]).forEach(index => {
                    const idx = parseInt(index);
                    if (tips[metricKey][idx] !== undefined) {
                        tips[metricKey][idx] = modifiedServerTips[metricKey][index];
                    }
                });
            }
        });
        
        return tips;
    } catch (error) {
        console.error('Error loading tips:', error);
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

function loadCoachingHistory() {
    try {
        const saved = localStorage.getItem('coachingHistory');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading coaching history:', error);
        return {};
    }
}

function saveCoachingHistory() {
    try {
        localStorage.setItem('coachingHistory', JSON.stringify(coachingHistory));
    } catch (error) {
        console.error('Error saving coaching history:', error);
    }
}

// ============================================
// EMAIL GENERATION
// ============================================

const DEFAULT_TIPS = {
    scheduleAdherence: "Schedule Adherence: Being present and available is essential. Work on meeting your scheduled hours consistently.",
    cxRepOverall: "CX Rep Overall: Customers appreciate your service! Keep building those strong relationships through empathy and professionalism.",
    fcr: "First Call Resolution: You're doing well! Continue focusing on resolving issues on the first contact whenever possible.",
    overallExperience: "Overall Experience: Great job creating positive experiences! Continue to personalize your interactions.",
    transfers: "Transfers: You're managing transfers well. When possible, try to resolve issues yourself to enhance the customer experience.",
    overallSentiment: "Overall Sentiment: Keep up the positive tone in your interactions. It makes a big difference!",
    positiveWord: "Positive Word Usage: Your positive language is appreciated! Continue using encouraging and supportive words.",
    negativeWord: "Avoiding Negative Words: You're doing great at keeping conversations positive. Keep it up!",
    managingEmotions: "Managing Emotions: You're doing great here! Keep maintaining composure even during challenging interactions.",
    aht: "Average Handle Time: Focus on efficiency without rushing. Prepare your responses, but don't skip necessary steps.",
    acw: "After Call Work: Complete your documentation promptly. This keeps you available for the next customer and maintains accuracy.",
    holdTime: "Hold Time: Minimize hold time by gathering information upfront. It improves customer experience and efficiency.",
    reliability: "Reliability: Your availability is crucial. Work toward reducing unexpected absences and maintaining consistent attendance."
};

async function generateCoachingEmail(employeeName, employeeData, customNotes = '') {
    // Determine struggling areas
    const strugglingAreas = [];
    
    // Check each metric against targets
    if (employeeData.scheduleAdherence < TARGETS.driver.scheduleAdherence.min) {
        strugglingAreas.push('scheduleAdherence');
    }
    if (employeeData.cxRepOverall && employeeData.cxRepOverall < TARGETS.driver.cxRepOverall.min) {
        strugglingAreas.push('cxRepOverall');
    }
    if (employeeData.fcr && employeeData.fcr < TARGETS.driver.fcr.min) {
        strugglingAreas.push('fcr');
    }
    if (employeeData.overallExperience && employeeData.overallExperience < TARGETS.driver.overallExperience.min) {
        strugglingAreas.push('overallExperience');
    }
    if (employeeData.transfers > TARGETS.driver.transfers.max) {
        strugglingAreas.push('transfers');
    }
    if (employeeData.overallSentiment && employeeData.overallSentiment < TARGETS.driver.overallSentiment.min) {
        strugglingAreas.push('overallSentiment');
    }
    if (employeeData.positiveWord && employeeData.positiveWord < TARGETS.driver.positiveWord.min) {
        strugglingAreas.push('positiveWord');
    }
    if (employeeData.negativeWord && employeeData.negativeWord < TARGETS.driver.negativeWord.min) {
        strugglingAreas.push('negativeWord');
    }
    if (employeeData.managingEmotions && employeeData.managingEmotions < TARGETS.driver.managingEmotions.min) {
        strugglingAreas.push('managingEmotions');
    }
    if (employeeData.aht && employeeData.aht > TARGETS.driver.aht.max) {
        strugglingAreas.push('aht');
    }
    if (employeeData.acw && employeeData.acw > TARGETS.driver.acw.max) {
        strugglingAreas.push('acw');
    }
    if (employeeData.holdTime && employeeData.holdTime > TARGETS.driver.holdTime.max) {
        strugglingAreas.push('holdTime');
    }
    if (employeeData.reliability > TARGETS.driver.reliability.max) {
        strugglingAreas.push('reliability');
    }
    
    // Load tips
    const serverTips = await loadServerTips();
    const userTips = loadUserTips();
    const allTips = { ...serverTips, ...userTips };
    
    // Build email body
    let emailBody = `Hi ${employeeName},\n\n`;
    emailBody += `I wanted to take a moment to check in with you about your recent performance metrics.\n\n`;
    
    if (strugglingAreas.length === 0) {
        emailBody += `Great job! You're meeting all your targets. Keep up the excellent work! 🌟\n\n`;
    } else {
        emailBody += `I noticed a few areas where we can focus on improvement:\n\n`;
        
        strugglingAreas.forEach(area => {
            const tips = allTips[area] || [];
            const tip = tips.length > 0 
                ? tips[Math.floor(Math.random() * tips.length)]
                : DEFAULT_TIPS[area];
            
            emailBody += `• ${tip}\n\n`;
        });
    }
    
    if (customNotes) {
        emailBody += `Additional Notes:\n${customNotes}\n\n`;
    }
    
    emailBody += `Let me know if you'd like to discuss any of these areas in more detail. I'm here to support you!\n\n`;
    emailBody += `Best regards`;
    
    // Generate email address (firstName.lastName@aps.com)
    const nameParts = employeeData.name.split(' ');
    const firstName = nameParts[0].toLowerCase();
    const lastName = nameParts[nameParts.length - 1].toLowerCase();
    const emailAddress = `${firstName}.${lastName}@aps.com`;
    
    return {
        to: emailAddress,
        subject: `Quick Check-In: Let's Chat About Your Metrics!`,
        body: emailBody
    };
}

// ============================================
// PERIOD MANAGEMENT
// ============================================

function updateEmployeeDropdown() {
    const dropdown = document.getElementById('employeeSelect');
    if (!dropdown) return;
    
    dropdown.innerHTML = '<option value="">-- Choose an employee --</option>';
    
    const employees = new Set();
    
    if (currentPeriodType === 'week' && currentPeriod) {
        const week = weeklyData[currentPeriod];
        if (week && week.employees) {
            week.employees.forEach(emp => employees.add(emp.name));
        }
    } else if (currentPeriodType === 'month' && currentPeriod) {
        Object.keys(weeklyData).forEach(weekKey => {
            const startDate = new Date(weekKey.split('|')[0]);
            const monthKey = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
            if (monthKey === currentPeriod) {
                weeklyData[weekKey].employees.forEach(emp => employees.add(emp.name));
            }
        });
    } else if (currentPeriodType === 'quarter' && currentPeriod) {
        const [year, q] = currentPeriod.split('-Q');
        const quarterNum = parseInt(q);
        Object.keys(weeklyData).forEach(weekKey => {
            const startDate = new Date(weekKey.split('|')[0]);
            const weekQuarter = Math.floor(startDate.getMonth() / 3) + 1;
            if (startDate.getFullYear() === parseInt(year) && weekQuarter === quarterNum) {
                weeklyData[weekKey].employees.forEach(emp => employees.add(emp.name));
            }
        });
    } else if (currentPeriodType === 'ytd' && currentPeriod) {
        Object.keys(weeklyData).forEach(weekKey => {
            const startDate = new Date(weekKey.split('|')[0]);
            if (startDate.getFullYear() === parseInt(currentPeriod)) {
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
    if (currentPeriodType === 'week' && currentPeriod) {
        const week = weeklyData[currentPeriod];
        if (week && week.employees) {
            return week.employees.find(emp => emp.name === employeeName);
        }
    } else if (['month', 'quarter', 'ytd'].includes(currentPeriodType) && currentPeriod) {
        // Aggregate data across multiple weeks
        const weekKeys = Object.keys(weeklyData).filter(weekKey => {
            const startDate = new Date(weekKey.split('|')[0]);
            
            if (currentPeriodType === 'month') {
                const monthKey = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
                return monthKey === currentPeriod;
            } else if (currentPeriodType === 'quarter') {
                const [year, q] = currentPeriod.split('-Q');
                const quarterNum = parseInt(q);
                const weekQuarter = Math.floor(startDate.getMonth() / 3) + 1;
                return startDate.getFullYear() === parseInt(year) && weekQuarter === quarterNum;
            } else if (currentPeriodType === 'ytd') {
                return startDate.getFullYear() === parseInt(currentPeriod);
            }
            return false;
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
    
    const periods = new Set();
    
    Object.keys(weeklyData).forEach(weekKey => {
        const startDate = new Date(weekKey.split('|')[0]);
        
        if (currentPeriodType === 'week') {
            const endDate = new Date(weekKey.split('|')[1]);
            const label = `Week ending ${endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
            periods.add(JSON.stringify({ value: weekKey, label: label, date: endDate }));
        } else if (currentPeriodType === 'month') {
            const monthKey = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
            const label = startDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
            periods.add(JSON.stringify({ value: monthKey, label: label, date: startDate }));
        } else if (currentPeriodType === 'quarter') {
            const quarter = Math.floor(startDate.getMonth() / 3) + 1;
            const quarterKey = `${startDate.getFullYear()}-Q${quarter}`;
            const label = `Q${quarter} ${startDate.getFullYear()}`;
            periods.add(JSON.stringify({ value: quarterKey, label: label, date: startDate }));
        } else if (currentPeriodType === 'ytd') {
            const yearKey = startDate.getFullYear().toString();
            const label = `Year ${yearKey}`;
            periods.add(JSON.stringify({ value: yearKey, label: label, date: startDate }));
        }
    });
    
    // Sort by date descending
    const sortedPeriods = Array.from(periods)
        .map(p => JSON.parse(p))
        .sort((a, b) => b.date - a.date);
    
    sortedPeriods.forEach(period => {
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
    const fields = [
        'scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience',
        'transfers', 'overallSentiment', 'positiveWord', 'negativeWord',
        'managingEmotions', 'aht', 'acw', 'holdTime', 'reliability'
    ];
    
    fields.forEach(field => {
        const input = document.getElementById(field);
        if (input) {
            input.value = employee[field] !== '' && employee[field] !== null ? employee[field] : '';
        }
    });
    
    const totalCallsInput = document.getElementById('totalCalls');
    if (totalCallsInput) {
        totalCallsInput.value = employee.totalCalls || 0;
    }
    
    const surveyInput = document.getElementById('surveyTotal');
    if (surveyInput) {
        surveyInput.value = employee.surveyTotal || 0;
    }
    
    // Apply highlighting
    applyMetricHighlights();
}

function applyMetricHighlights() {
    const configs = [
        { id: 'scheduleAdherence', target: TARGETS.driver.scheduleAdherence.min, type: 'min' },
        { id: 'cxRepOverall', target: TARGETS.driver.cxRepOverall.min, type: 'min' },
        { id: 'fcr', target: TARGETS.driver.fcr.min, type: 'min' },
        { id: 'overallExperience', target: TARGETS.driver.overallExperience.min, type: 'min' },
        { id: 'transfers', target: TARGETS.driver.transfers.max, type: 'max' },
        { id: 'overallSentiment', target: TARGETS.driver.overallSentiment.min, type: 'min' },
        { id: 'positiveWord', target: TARGETS.driver.positiveWord.min, type: 'min' },
        { id: 'negativeWord', target: TARGETS.driver.negativeWord.min, type: 'min' },
        { id: 'managingEmotions', target: TARGETS.driver.managingEmotions.min, type: 'min' },
        { id: 'aht', target: TARGETS.driver.aht.max, type: 'max' },
        { id: 'acw', target: TARGETS.driver.acw.max, type: 'max' },
        { id: 'holdTime', target: TARGETS.driver.holdTime.max, type: 'max' },
        { id: 'reliability', target: TARGETS.driver.reliability.max, type: 'max' }
    ];

    configs.forEach(cfg => {
        const el = document.getElementById(cfg.id);
        if (!el || !el.value) {
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
    // Tab navigation
    document.getElementById('homeBtn')?.addEventListener('click', () => showOnlySection('coachingForm'));
    document.getElementById('generateCoachingBtn')?.addEventListener('click', () => showOnlySection('coachingSection'));
    document.getElementById('employeeDashboard')?.addEventListener('click', () => {
        showOnlySection('dashboardSection');
        renderEmployeeHistory();
    });
    document.getElementById('manageTips')?.addEventListener('click', () => {
        showOnlySection('tipsManagementSection');
        renderTipsManagement();
    });
    document.getElementById('manageDataBtn')?.addEventListener('click', () => {
        showOnlySection('manageDataSection');
        populateDeleteWeekDropdown();
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
        
        if (!startDate || !endDate) {
            alert('❌ Please select both start and end dates');
            return;
        }
        
        if (!pastedData) {
            alert('❌ Please paste data first');
            return;
        }
        
        try {
            const employees = parsePastedData(pastedData, startDate, endDate);
            
            if (employees.length === 0) {
                alert('❌ No valid employee data found');
                return;
            }
            
            // Store data
            const weekKey = `${startDate}|${endDate}`;
            const endDateObj = new Date(endDate);
            const label = `Week ending ${endDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
            
            weeklyData[weekKey] = {
                employees: employees,
                metadata: {
                    startDate: startDate,
                    endDate: endDate,
                    label: label,
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
            alert(`❌ Error parsing data: ${error.message}\n\nPlease ensure you copied the full table with headers from PowerBI.`);
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
        
        console.log('🔍 Employee selected:', selectedName);
        console.log('📅 Current period type:', currentPeriodType);
        console.log('📅 Current period:', currentPeriod);
        
        if (!selectedName) {
            ['metricsSection', 'employeeInfoSection', 'customNotesSection', 'generateEmailBtn'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            return;
        }
        
        const employee = getEmployeeDataForPeriod(selectedName);
        console.log('👤 Employee data:', employee);
        
        if (!employee) {
            alert('❌ Error loading employee data');
            return;
        }
        
        // Show sections
        ['employeeInfoSection', 'metricsSection', 'customNotesSection'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'block';
        });
        const generateBtn = document.getElementById('generateEmailBtn');
        if (generateBtn) generateBtn.style.display = 'inline-block';
        
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
    document.getElementById('generateEmailBtn')?.addEventListener('click', async () => {
        const employeeName = document.getElementById('employeeName').value;
        const customNotes = document.getElementById('customNotes').value;
        
        if (!employeeName) {
            alert('❌ Please enter employee name');
            return;
        }
        
        // Get current metric values
        const employeeData = {
            name: document.getElementById('employeeSelect').value,
            scheduleAdherence: parseFloat(document.getElementById('scheduleAdherence').value) || 0,
            cxRepOverall: document.getElementById('cxRepOverall').value ? parseFloat(document.getElementById('cxRepOverall').value) : '',
            fcr: document.getElementById('fcr').value ? parseFloat(document.getElementById('fcr').value) : '',
            overallExperience: document.getElementById('overallExperience').value ? parseFloat(document.getElementById('overallExperience').value) : '',
            transfers: parseFloat(document.getElementById('transfers').value) || 0,
            overallSentiment: document.getElementById('overallSentiment').value ? parseFloat(document.getElementById('overallSentiment').value) : '',
            positiveWord: document.getElementById('positiveWord').value ? parseFloat(document.getElementById('positiveWord').value) : '',
            negativeWord: document.getElementById('negativeWord').value ? parseFloat(document.getElementById('negativeWord').value) : '',
            managingEmotions: document.getElementById('managingEmotions').value ? parseFloat(document.getElementById('managingEmotions').value) : '',
            aht: document.getElementById('aht').value ? parseFloat(document.getElementById('aht').value) : '',
            acw: document.getElementById('acw').value ? parseFloat(document.getElementById('acw').value) : '',
            holdTime: document.getElementById('holdTime').value ? parseFloat(document.getElementById('holdTime').value) : '',
            reliability: parseFloat(document.getElementById('reliability').value) || 0,
            surveyTotal: parseInt(document.getElementById('surveyTotal').value) || 0
        };
        
        const email = await generateCoachingEmail(employeeName, employeeData, customNotes);
        
        // Display email
        const emailOutput = document.getElementById('emailOutput');
        emailOutput.innerHTML = `
            <div style="background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                <p><strong>To:</strong> ${escapeHtml(email.to)}</p>
                <p><strong>Subject:</strong> ${escapeHtml(email.subject)}</p>
            </div>
            <div style="white-space: pre-wrap; background: white; padding: 20px; border: 1px solid #ddd; border-radius: 8px;">
${escapeHtml(email.body)}
            </div>
        `;
        
        showOnlySection('resultsSection');
        
        // Save to history
        if (!coachingHistory[employeeData.name]) {
            coachingHistory[employeeData.name] = [];
        }
        coachingHistory[employeeData.name].push({
            date: new Date().toISOString(),
            period: currentPeriod,
            periodType: currentPeriodType,
            email: email,
            metrics: employeeData
        });
        saveCoachingHistory();
        
        showToast('✅ Email generated successfully!');
    });
    
    // Metric input highlighting
    const metricInputs = [
        'scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience',
        'transfers', 'overallSentiment', 'positiveWord', 'negativeWord',
        'managingEmotions', 'aht', 'acw', 'holdTime', 'reliability'
    ];
    
    metricInputs.forEach(id => {
        document.getElementById(id)?.addEventListener('input', applyMetricHighlights);
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
                if (data.coachingHistory) coachingHistory = data.coachingHistory;
                
                saveWeeklyData();
                saveCoachingHistory();
                
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
        const coachingCount = Object.keys(coachingHistory).length;
        
        if (weekCount === 0 && coachingCount === 0) {
            alert('ℹ️ No data to delete');
            return;
        }
        
        const message = `⚠️ WARNING: This will permanently delete:\n\n` +
            `• ${weekCount} week(s) of employee data\n` +
            `• ${coachingCount} employee(s) coaching history\n\n` +
            `This action CANNOT be undone!\n\n` +
            `Type "DELETE" to confirm:`;
        
        const confirmation = prompt(message);
        
        if (confirmation !== 'DELETE') {
            alert('❌ Deletion cancelled');
            return;
        }
        
        // Clear all data
        weeklyData = {};
        coachingHistory = {};
        
        saveWeeklyData();
        saveCoachingHistory();
        
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
                showToast('🔄 Form cleared');
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
    
    const metricNames = {
        scheduleAdherence: 'Schedule Adherence',
        cxRepOverall: 'CX Rep Overall',
        fcr: 'First Call Resolution',
        overallExperience: 'Overall Experience',
        transfers: 'Transfers',
        overallSentiment: 'Overall Sentiment',
        positiveWord: 'Positive Word',
        negativeWord: 'Avoid Negative Word',
        managingEmotions: 'Managing Emotions',
        aht: 'Average Handle Time',
        acw: 'After Call Work',
        holdTime: 'Hold Time',
        reliability: 'Reliability'
    };
    
    let html = '<div style="margin-bottom: 20px;">';
    html += '<p>Select a metric to view and manage its coaching tips. Server tips (from tips.csv) are shown in blue and are read-only. Your custom tips can be edited or deleted.</p>';
    html += '</div>';
    
    // Dropdown selector
    html += '<div style="margin-bottom: 25px; padding: 20px; background: white; border-radius: 8px; border: 2px solid #2196F3;">';
    html += '<label for="metricSelector" style="font-weight: bold; display: block; margin-bottom: 10px; color: #2196F3; font-size: 1.1em;">Select Metric:</label>';
    html += '<select id="metricSelector" style="width: 100%; padding: 12px; border: 2px solid #2196F3; border-radius: 4px; font-size: 1em; cursor: pointer;">';
    html += '<option value="">-- Choose a metric --</option>';
    Object.keys(metricNames).forEach(metricKey => {
        html += `<option value="${metricKey}">${metricNames[metricKey]}</option>`;
    });
    html += '</select>';
    html += '</div>';
    
    // Tips display area
    html += '<div id="tipsDisplayArea" style="display: none;"></div>';
    
    container.innerHTML = html;
    
    // Add change listener
    document.getElementById('metricSelector').addEventListener('change', (e) => {
        const metricKey = e.target.value;
        const displayArea = document.getElementById('tipsDisplayArea');
        
        if (!metricKey) {
            displayArea.style.display = 'none';
            return;
        }
        
        displayArea.style.display = 'block';
        const serverTipsForMetric = serverTips[metricKey] || [];
        const userTipsForMetric = userTips[metricKey] || [];
        const metricName = metricNames[metricKey];
        
        let tipsHtml = `<div style="padding: 20px; background: #f8f9fa; border-radius: 8px;">`;
        tipsHtml += `<h3 style="color: #2196F3; margin-top: 0; border-bottom: 2px solid #2196F3; padding-bottom: 10px;">${metricName}</h3>`;
        
        // Server tips
        if (serverTipsForMetric.length > 0) {
            tipsHtml += '<div style="margin: 20px 0;"><h4 style="color: #1976D2; margin-bottom: 12px;">📚 Server Tips (from tips.csv)</h4>';
            serverTipsForMetric.forEach((tip, index) => {
                tipsHtml += `
                    <div style="margin-bottom: 12px; padding: 15px; background: #e3f2fd; border-left: 4px solid #2196F3; border-radius: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
                        <div style="display: flex; justify-content: space-between; align-items: start; gap: 15px;">
                            <textarea id="editServerTip_${metricKey}_${index}" style="flex: 1; padding: 8px; border: 1px solid #1976D2; border-radius: 4px; font-size: 0.95em; resize: vertical; min-height: 60px; background: white;" rows="2">${escapeHtml(tip)}</textarea>
                            <button onclick="updateServerTip('${metricKey}', ${index})" style="background: #2196F3; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer; white-space: nowrap;">💾 Save</button>
                        </div>
                    </div>
                `;
            });
            tipsHtml += '</div>';
        } else {
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
    const tip = textarea.value.trim();
    
    if (!tip) {
        alert('❌ Please enter a tip first');
        return;
    }
    
    const userTips = loadUserTips();
    if (!userTips[metricKey]) {
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
    const updatedTip = textarea.value.trim();
    
    if (!updatedTip) {
        alert('❌ Tip cannot be empty');
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
    }
};

window.updateServerTip = function(metricKey, index) {
    const textarea = document.getElementById(`editServerTip_${metricKey}_${index}`);
    const updatedTip = textarea.value.trim();
    
    if (!updatedTip) {
        alert('❌ Tip cannot be empty');
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

window.deleteTip = function(metricKey, index) {
    if (!confirm('Are you sure you want to delete this tip?')) {
        return;
    }
    
    const userTips = loadUserTips();
    if (userTips[metricKey]) {
        userTips[metricKey].splice(index, 1);
        if (userTips[metricKey].length === 0) {
            delete userTips[metricKey];
        }
        saveUserTips(userTips);
    }
    
    showToast('✅ Tip deleted');
    
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
    container.innerHTML = '<p style="color: #666; font-style: italic; padding: 20px; text-align: center;">Select an employee above to view their performance trends and coaching history.</p>';
}

function handleEmployeeHistorySelection(e) {
    const employeeName = e.target.value;
    const container = document.getElementById('historyContainer');
    
    if (!employeeName || !container) {
        container.innerHTML = '<p style="color: #666; font-style: italic; padding: 20px; text-align: center;">Select an employee above to view their performance trends and coaching history.</p>';
        return;
    }
    
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
        return;
    }
    
    // Sort by date
    employeeData.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
    
    // Get coaching sessions
    const coachingSessions = coachingHistory[employeeName] || [];
    
    // Build HTML
    let html = `<div style="margin-bottom: 30px;">`;
    html += `<h3 style="color: #2196F3; border-bottom: 3px solid #2196F3; padding-bottom: 10px;">${escapeHtml(employeeName)}</h3>`;
    
    // Summary cards
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 15px; margin: 20px 0;">';
    html += `
        <div style="padding: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border-radius: 8px; text-align: center;">
            <div style="font-size: 2em;">📊</div>
            <div style="font-size: 1.6em; font-weight: bold; margin: 8px 0;">${employeeData.length}</div>
            <div style="font-size: 0.9em; opacity: 0.9;">Weeks of Data</div>
        </div>
        <div style="padding: 20px; background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; border-radius: 8px; text-align: center;">
            <div style="font-size: 2em;">✉️</div>
            <div style="font-size: 1.6em; font-weight: bold; margin: 8px 0;">${coachingSessions.length}</div>
            <div style="font-size: 0.9em; opacity: 0.9;">Coaching Sessions</div>
        </div>
    `;
    html += '</div>';
    
    // Trend charts
    html += '<div style="margin: 30px 0;">';
    html += '<h4 style="color: #2196F3; margin-bottom: 20px;">📈 Performance Trends</h4>';
    
    // Key metrics charts
    const chartIds = ['scheduleChart', 'cxChart', 'transfersChart', 'ahtChart'];
    html += '<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap: 20px;">';
    
    chartIds.forEach(chartId => {
        html += `
            <div style="background: white; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                <canvas id="${chartId}"></canvas>
            </div>
        `;
    });
    html += '</div></div>';
    
    // Week over week comparison
    html += '<div style="margin: 30px 0; background: #f8f9fa; padding: 20px; border-radius: 8px;">';
    html += '<h4 style="color: #2196F3; margin-top: 0;">📅 Week-by-Week Performance</h4>';
    html += '<div style="overflow-x: auto;">';
    html += '<table style="width: 100%; border-collapse: collapse; background: white;">';
    html += '<thead><tr style="background: #2196F3; color: white;">';
    html += '<th style="padding: 12px; text-align: left;">Week Ending</th>';
    html += '<th style="padding: 12px; text-align: center;">Adherence</th>';
    html += '<th style="padding: 12px; text-align: center;">CX Rep</th>';
    html += '<th style="padding: 12px; text-align: center;">Transfers</th>';
    html += '<th style="padding: 12px; text-align: center;">AHT</th>';
    html += '<th style="padding: 12px; text-align: center;">Surveys</th>';
    html += '</tr></thead><tbody>';
    
    employeeData.slice().reverse().forEach((week, idx) => {
        const bgColor = idx % 2 === 0 ? '#ffffff' : '#f8f9fa';
        html += `<tr style="background: ${bgColor};">`;
        html += `<td style="padding: 12px; border-bottom: 1px solid #ddd;">${week.label}</td>`;
        html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">${week.scheduleAdherence || 'N/A'}</td>`;
        html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">${week.cxRepOverall || 'N/A'}</td>`;
        html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">${week.transfers || 'N/A'}</td>`;
        html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">${week.aht || 'N/A'}</td>`;
        html += `<td style="padding: 12px; text-align: center; border-bottom: 1px solid #ddd;">${week.surveyTotal || 0}</td>`;
        html += '</tr>';
    });
    html += '</tbody></table></div></div>';
    
    // Coaching metrics analysis
    if (coachingSessions.length > 0) {
        html += '<div style="margin: 30px 0;">';
        html += '<h4 style="color: #2196F3;">💡 Coaching Focus Areas</h4>';
        
        // Count which metrics were coached on
        const metricCoaching = {};
        const metricNames = {
            scheduleAdherence: 'Schedule Adherence',
            cxRepOverall: 'CX Rep Overall',
            fcr: 'First Call Resolution',
            overallExperience: 'Overall Experience',
            transfers: 'Transfers',
            overallSentiment: 'Overall Sentiment',
            positiveWord: 'Positive Word',
            negativeWord: 'Negative Word',
            managingEmotions: 'Managing Emotions',
            aht: 'Average Handle Time',
            acw: 'After Call Work',
            holdTime: 'Hold Time',
            reliability: 'Reliability'
        };
        
        coachingSessions.forEach(session => {
            const emailBody = session.email.body.toLowerCase();
            Object.keys(metricNames).forEach(metric => {
                const metricLower = metricNames[metric].toLowerCase();
                if (emailBody.includes(metricLower) || emailBody.includes(metric.toLowerCase())) {
                    metricCoaching[metric] = (metricCoaching[metric] || 0) + 1;
                }
            });
        });
        
        const sortedMetrics = Object.entries(metricCoaching).sort((a, b) => b[1] - a[1]);
        
        if (sortedMetrics.length > 0) {
            html += '<div style="background: white; padding: 20px; border-radius: 8px;">';
            html += '<canvas id="coachingFocusChart" style="max-height: 300px;"></canvas>';
            html += '</div>';
        }
        html += '</div>';
        
        // Coaching history
        html += '<div style="margin: 30px 0;">';
        html += '<h4 style="color: #2196F3;">📧 Coaching History</h4>';
        
        coachingSessions.slice().reverse().forEach(session => {
            const date = new Date(session.date);
            html += `
                <div style="margin-bottom: 15px; padding: 15px; background: white; border-radius: 8px; border-left: 4px solid #28a745;">
                    <p style="margin: 0 0 8px 0;"><strong>📅 ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}</strong></p>
                    <p style="margin: 0 0 8px 0; color: #666;">Period: ${session.periodType} - ${session.period}</p>
                    <details style="margin-top: 10px;">
                        <summary style="cursor: pointer; color: #2196F3; font-weight: bold;">📄 View Email Content</summary>
                        <div style="margin-top: 10px; padding: 15px; background: #f8f9fa; border-radius: 4px; white-space: pre-wrap; font-family: 'Courier New', monospace; font-size: 0.9em;">
${escapeHtml(session.email.body)}
                        </div>
                    </details>
                </div>
            `;
        });
        html += '</div>';
    }
    
    html += '</div>';
    container.innerHTML = html;
    
    // Render charts after DOM update
    setTimeout(() => {
        renderEmployeeCharts(employeeData, employeeName, metricCoaching);
    }, 100);
}

function renderEmployeeCharts(employeeData, employeeName, metricCoaching) {
    const labels = employeeData.map(d => {
        const endDate = new Date(d.endDate);
        return endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    });
    
    const chartOptions = {
        responsive: true,
        maintainAspectRatio: true,
        plugins: {
            legend: { display: false },
            title: { display: true, font: { size: 14, weight: 'bold' } }
        },
        scales: {
            y: { beginAtZero: true }
        }
    };
    
    // Schedule Adherence Chart
    const scheduleCtx = document.getElementById('scheduleChart');
    if (scheduleCtx) {
        new Chart(scheduleCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Schedule Adherence %',
                    data: employeeData.map(d => parseFloat(d.scheduleAdherence) || null),
                    borderColor: '#2196F3',
                    backgroundColor: 'rgba(33, 150, 243, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                ...chartOptions,
                plugins: {
                    ...chartOptions.plugins,
                    title: { ...chartOptions.plugins.title, text: '⏰ Schedule Adherence Trend' }
                }
            }
        });
    }
    
    // CX Rep Chart
    const cxCtx = document.getElementById('cxChart');
    if (cxCtx) {
        new Chart(cxCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'CX Rep Overall %',
                    data: employeeData.map(d => parseFloat(d.cxRepOverall) || null),
                    borderColor: '#4CAF50',
                    backgroundColor: 'rgba(76, 175, 80, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                ...chartOptions,
                plugins: {
                    ...chartOptions.plugins,
                    title: { ...chartOptions.plugins.title, text: '⭐ CX Rep Overall Trend' }
                }
            }
        });
    }
    
    // Transfers Chart
    const transfersCtx = document.getElementById('transfersChart');
    if (transfersCtx) {
        new Chart(transfersCtx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Transfers %',
                    data: employeeData.map(d => parseFloat(d.transfers) || null),
                    backgroundColor: '#FF9800',
                    borderColor: '#F57C00',
                    borderWidth: 2
                }]
            },
            options: {
                ...chartOptions,
                plugins: {
                    ...chartOptions.plugins,
                    title: { ...chartOptions.plugins.title, text: '📞 Transfers Trend' }
                }
            }
        });
    }
    
    // AHT Chart
    const ahtCtx = document.getElementById('ahtChart');
    if (ahtCtx) {
        new Chart(ahtCtx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'AHT (seconds)',
                    data: employeeData.map(d => parseFloat(d.aht) || null),
                    borderColor: '#9C27B0',
                    backgroundColor: 'rgba(156, 39, 176, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                ...chartOptions,
                plugins: {
                    ...chartOptions.plugins,
                    title: { ...chartOptions.plugins.title, text: '⏱️ Average Handle Time Trend' }
                }
            }
        });
    }
    
    // Coaching Focus Chart
    if (metricCoaching && Object.keys(metricCoaching).length > 0) {
        const coachingCtx = document.getElementById('coachingFocusChart');
        if (coachingCtx) {
            const metricNames = {
                scheduleAdherence: 'Schedule Adherence',
                cxRepOverall: 'CX Rep Overall',
                fcr: 'First Call Resolution',
                overallExperience: 'Overall Experience',
                transfers: 'Transfers',
                overallSentiment: 'Overall Sentiment',
                positiveWord: 'Positive Word',
                negativeWord: 'Negative Word',
                managingEmotions: 'Managing Emotions',
                aht: 'Average Handle Time',
                acw: 'After Call Work',
                holdTime: 'Hold Time',
                reliability: 'Reliability'
            };
            
            const sortedMetrics = Object.entries(metricCoaching).sort((a, b) => b[1] - a[1]);
            
            new Chart(coachingCtx, {
                type: 'bar',
                data: {
                    labels: sortedMetrics.map(m => metricNames[m[0]] || m[0]),
                    datasets: [{
                        label: 'Times Coached',
                        data: sortedMetrics.map(m => m[1]),
                        backgroundColor: [
                            '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF',
                            '#FF9F40', '#FF6384', '#C9CBCF', '#4BC0C0', '#FF6384',
                            '#36A2EB', '#FFCE56', '#9966FF'
                        ]
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: true,
                    plugins: {
                        legend: { display: false },
                        title: { 
                            display: true, 
                            text: 'Metrics Coached Most Frequently',
                            font: { size: 14, weight: 'bold' }
                        }
                    },
                    scales: {
                        x: { 
                            beginAtZero: true,
                            ticks: { stepSize: 1 }
                        }
                    }
                }
            });
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
        avgAHT: [],
        employeesCoached: Object.keys(coachingHistory).length,
        totalCoachingSessions: Object.values(coachingHistory).reduce((sum, sessions) => sum + sessions.length, 0)
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
        { label: 'Total Weeks', value: metrics.totalWeeks, icon: '📅' },
        { label: 'Total Employees', value: metrics.totalEmployees.size, icon: '👥' },
        { label: 'Avg Schedule Adherence', value: avgAdherence + '%', icon: '⏰' },
        { label: 'Avg Transfers', value: avgTransfers + '%', icon: '📞' },
        { label: 'Avg Handle Time', value: avgAHT + 's', icon: '⏱️' },
        { label: 'Employees Coached', value: metrics.employeesCoached, icon: '✉️' },
        { label: 'Total Coaching Sessions', value: metrics.totalCoachingSessions, icon: '📊' }
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
        
        // Export coaching history
        const historyData = [];
        Object.keys(coachingHistory).forEach(employeeName => {
            coachingHistory[employeeName].forEach(session => {
                historyData.push({
                    'Employee': employeeName,
                    'Date': new Date(session.date).toLocaleDateString(),
                    'Period Type': session.periodType,
                    'Period': session.period,
                    'Email To': session.email.to,
                    'Email Subject': session.email.subject
                });
            });
        });
        
        if (historyData.length > 0) {
            const historyWs = XLSX.utils.json_to_sheet(historyData);
            XLSX.utils.book_append_sheet(wb, historyWs, 'Coaching History');
        }
        
        // Save file
        XLSX.writeFile(wb, `coaching-tool-data-${new Date().toISOString().split('T')[0]}.xlsx`);
        showToast('✅ Data exported to Excel!');
        
    } catch (error) {
        console.error('Error exporting to Excel:', error);
        alert('❌ Error exporting data: ' + error.message);
    }
}

// ============================================
// INITIALIZATION
// ============================================

function initApp() {
    console.log('🚀 Initializing Development Coaching Tool...');
    
    // Load data from localStorage
    weeklyData = loadWeeklyData();
    coachingHistory = loadCoachingHistory();
    
    console.log(`📊 Loaded ${Object.keys(weeklyData).length} weeks of data`);
    console.log(`✉️ Loaded ${Object.keys(coachingHistory).length} employee coaching histories`);
    
    // Initialize event handlers
    initializeEventHandlers();
    initializeKeyboardShortcuts();
    
    // Restore active section
    const activeSection = localStorage.getItem('activeSection') || 'coachingForm';
    showOnlySection(activeSection);
    
    // If we have data, update the period dropdown
    if (Object.keys(weeklyData).length > 0) {
        updatePeriodDropdown();
    }
    
    console.log('✅ Application initialized successfully!');
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

