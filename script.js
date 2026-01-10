// Utility functions
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

function showOnlySection(sectionId) {
    const sections = [
        { id: 'coachingForm', conditional: false },
        { id: 'coachingSection', conditional: false },
        { id: 'resultsSection', conditional: false },
        { id: 'dashboardSection', conditional: false },
        { id: 'historySection', conditional: false },
        { id: 'tipsManagementSection', conditional: false },
        { id: 'executiveSummarySection', conditional: false }
    ];
    
    sections.forEach(section => {
        const el = document.getElementById(section.id);
        if (el) el.style.display = (section.id === sectionId) ? 'block' : 'none';
    });
    
    // Hide employee-specific sections when switching away from Generate Coaching
    if (sectionId !== 'coachingSection') {
        const metricsSection = document.getElementById('metricsSection');
        const employeeInfoSection = document.getElementById('employeeInfoSection');
        const customNotesSection = document.getElementById('customNotesSection');
        const generateBtn = document.getElementById('generateEmailBtn');
        if (metricsSection) metricsSection.style.display = 'none';
        if (employeeInfoSection) employeeInfoSection.style.display = 'none';
        if (customNotesSection) customNotesSection.style.display = 'none';
        if (generateBtn) generateBtn.style.display = 'none';
    }
    
    // Remember active section in localStorage
    localStorage.setItem('activeSection', sectionId);
    
    // Update tab button highlighting
    updateTabHighlight(sectionId);
}

function updateTabHighlight(activeSectionId) {
    // Map section IDs to button IDs
    const tabMapping = {
        'coachingForm': 'homeBtn',
        'coachingSection': 'generateCoachingBtn',
        'dashboardSection': 'employeeDashboard',
        'tipsManagementSection': 'manageTips',
        'executiveSummarySection': 'executiveSummaryBtn'
    };
    
    // Reset all buttons to default style
    ['homeBtn', 'generateCoachingBtn', 'employeeDashboard', 'manageTips'].forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.style.background = '#e9ecef';
            btn.style.color = '#333';
        }
    });
    
    // Highlight active button (except executive summary which stays orange)
    const activeButtonId = tabMapping[activeSectionId];
    if (activeButtonId && activeButtonId !== 'executiveSummaryBtn') {
        const activeBtn = document.getElementById(activeButtonId);
        if (activeBtn) {
            activeBtn.style.background = '#2196F3';
            activeBtn.style.color = 'white';
        }
    }
}

function exportToPDF() {
    window.print();
}

// Target metrics for comparison
const TARGETS = {
    driver: {
        scheduleAdherence: { min: 93 },
        cxRepOverall: { min: 80 },
        fcr: { min: 70 },
        overallExperience: { min: 80 },
        transfers: { max: 6 },
        overallSentiment: { min: 88 },
        positiveWord: { min: 86 },
        negativeWord: { min: 83 },
        managingEmotions: { min: 95 },
        aht: { max: 440 },
        acw: { max: 60 },
        holdTime: { max: 30 },
        reliability: { max: 16 }
    }
};

// Custom tips loaded from CSV
let customTips = {};
let serverTips = {}; // Tips from server
let userTips = {};   // Custom tips added by user
let hiddenTips = {}; // Tips hidden (e.g., server tips soft-deleted)
let tipOrder = {};   // Preserve tip positions per metric
let uploadHistory = []; // Store all data uploads with time labels

// New centralized data structure for uploaded weeks
let weeklyData = {}; // { "2025-12-21|2025-12-27": { employees: [...], metadata: {...} } }
let currentPeriodType = 'week'; // week, month, quarter, ytd
let currentPeriod = null; // Selected specific period

// Smart date detection: return time period label
function detectTimePeriod(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    
    // Full year (365+ days)
    if (diffDays >= 365 && start.getMonth() === 0 && end.getMonth() === 11) {
        return `${start.getFullYear()}`;
    }
    
    // Quarter (approx 90 days, aligned to Q1/Q2/Q3/Q4)
    const quarter = Math.floor(start.getMonth() / 3) + 1;
    if (diffDays >= 85 && diffDays <= 95) {
        return `Q${quarter} ${start.getFullYear()}`;
    }
    
    // Full month (approx 28-31 days)
    if (diffDays >= 27 && diffDays <= 32 && start.getMonth() === end.getMonth()) {
        const monthName = start.toLocaleString('default', { month: 'long', year: 'numeric' });
        return monthName;
    }
    
    // Week (7 days)
    if (diffDays === 7) {
        const weekNum = Math.ceil((start.getDate() + new Date(start.getFullYear(), start.getMonth(), 1).getDay()) / 7);
        const monthName = start.toLocaleString('default', { month: 'short' });
        return `Week ${weekNum} ${monthName} ${start.getFullYear()}`;
    }
    
    // Fallback: custom date range
    return `${startDate} to ${endDate}`;
}

// Parse a sheet name like "12.27" or "1.10" into a week range (Mon–Sat)
function parseWeekFromSheetName(sheetName) {
    try {
        const match = /([0-9]{1,2})[\.\/_-]([0-9]{1,2})(?:[\.\/_-]([0-9]{2,4}))?/i.exec(String(sheetName).trim());
        if (!match) return null;

        const month = parseInt(match[1], 10);
        const day = parseInt(match[2], 10);
        let year = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();

        // Normalize two-digit years
        if (year < 100) {
            year += year >= 70 ? 1900 : 2000;
        }

        // Heuristic: if month is December and today is January, assume previous year
        const today = new Date();
        const todayMonth = today.getMonth() + 1;
        if (!match[3] && month === 12 && todayMonth === 1) {
            year -= 1;
        }
        if (!match[3] && month === 1 && todayMonth === 12) {
            year += 1;
        }

        let endDate = new Date(year, month - 1, day);

        // Align end date to Saturday of that week if needed
        // JS: 0=Sun,1=Mon,...,6=Sat
        const endDow = endDate.getDay();
        if (endDow !== 6) {
            const deltaToSat = (6 - endDow + 7) % 7; // forward to Saturday
            endDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate() + deltaToSat);
        }

        // Compute start date as Monday of the same week
        let startDate = new Date(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
        const startDow = startDate.getDay();
        const deltaToMon = (startDow >= 1 ? startDow - 1 : 6); // back to Monday
        startDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() - deltaToMon);

        const startISO = startDate.toISOString().split('T')[0];
        const endISO = endDate.toISOString().split('T')[0];
        const label = `Week ending ${endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;

        return { startDate: startISO, endDate: endISO, timePeriod: label };
    } catch (err) {
        console.warn('Failed to parse sheet name for week range:', sheetName, err);
        return null;
    }
}

// Helper functions to parse Excel data
function parsePercentage(value) {
    if (!value && value !== 0) return 0;
    if (value === 'N/A' || value === 'n/a') return 0;
    // If already a decimal (0.83), convert to percentage (83)
    if (typeof value === 'number' && value <= 1) {
        return parseFloat((value * 100).toFixed(2));
    }
    // If string with %, remove it
    if (typeof value === 'string' && value.includes('%')) {
        const parsed = parseFloat(value.replace('%', ''));
        return isNaN(parsed) ? 0 : parsed;
    }
    const parsed = parseFloat(value);
    return isNaN(parsed) ? 0 : parsed;
}

// For survey-based metrics - return empty string for N/A instead of 0
function parseSurveyPercentage(value) {
    if (!value && value !== 0) return '';
    if (value === 'N/A' || value === 'n/a') return '';
    // If already a decimal (0.83), convert to percentage (83)
    if (typeof value === 'number' && value <= 1) {
        return parseFloat((value * 100).toFixed(2));
    }
    // If string with %, remove it
    if (typeof value === 'string' && value.includes('%')) {
        const parsed = parseFloat(value.replace('%', ''));
        return isNaN(parsed) ? '' : parsed;
    }
    const parsed = parseFloat(value);
    return isNaN(parsed) ? '' : parsed;
}

function parseSeconds(value) {
    if (!value && value !== 0) return '';
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return '';
    return Math.round(parsed);
}

function parseHours(value) {
    if (!value && value !== 0) return 0;  // Default to 0 for blank reliability
    const parsed = parseFloat(value);
    if (isNaN(parsed)) return 0;
    return parseFloat(parsed.toFixed(2));
}

function loadUploadHistory() {
    try {
        const saved = localStorage.getItem('uploadHistory');
        return saved ? JSON.parse(saved) : [];
    } catch (error) {
        console.error('Error loading upload history:', error);
        return [];
    }
}

function saveUploadHistory(history) {
    try {
        localStorage.setItem('uploadHistory', JSON.stringify(history));
    } catch (error) {
        console.error('Error saving upload history:', error);
    }
}

function loadTipOrder() {
    try {
        const saved = localStorage.getItem('tipOrder');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading tip order:', error);
        return {};
    }
}

function saveTipOrder(order) {
    try {
        localStorage.setItem('tipOrder', JSON.stringify(order));
    } catch (error) {
        console.error('Error saving tip order:', error);
    }
}

// Auto-export tips to Excel
function autoExportTipsToExcel() {
    try {
        if (typeof XLSX === 'undefined') {
            console.warn('SheetJS not available, skipping auto-export');
            return;
        }

        // Export comprehensive workbook whenever tips are updated
        exportComprehensiveExcel();
    } catch (error) {
        console.error('Error auto-exporting tips:', error);
    }
}

// Export employee history to Excel with multiple sheets
function exportEmployeeHistoryToExcel() {
    try {
        if (typeof XLSX === 'undefined') {
            alert('SheetJS library not available. Cannot export to Excel.');
            return;
        }

        const history = getAllHistory();
        
        if (Object.keys(history).length === 0) {
            alert('No employee history to export.');
            return;
        }

        const wb = XLSX.utils.book_new();

        // Sheet 1: All Employees Summary
        const summaryData = [['Employee Name', 'Total Sessions', 'Date Ranges Covered']];
        
        Object.keys(history).sort().forEach(empName => {
            const sessions = history[empName];
            const dateRanges = [...new Set(sessions.map(s => s.dateRange).filter(d => d))].join(', ');
            summaryData.push([empName, sessions.length, dateRanges || 'N/A']);
        });

        const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
        summaryWs['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 50 }];
        XLSX.utils.book_append_sheet(wb, summaryWs, 'Summary');

        // Sheet 2: Detailed History for Each Employee
        const detailData = [['Employee', 'Date', 'Date Range', 'Metric', 'Value', 'Target', 'Status', 'Was Coached']];
        
        Object.keys(history).sort().forEach(empName => {
            history[empName].forEach(session => {
                const metrics = session.metrics || {};
                
                // Add each metric as a row
                Object.keys(metrics).forEach(metricKey => {
                    if (metricKey === 'reliability') return; // Skip reliability for now
                    
                    const value = metrics[metricKey];
                    const target = TARGETS.driver[metricKey];
                    let targetStr = '';
                    let status = '';
                    
                    if (target) {
                        if (target.min !== undefined) {
                            targetStr = `≥ ${target.min}`;
                            status = value >= target.min ? '✅ Met' : '❌ Missed';
                        } else if (target.max !== undefined) {
                            targetStr = `≤ ${target.max}`;
                            status = value <= target.max ? '✅ Met' : '❌ Missed';
                        }
                    }
                    
                    detailData.push([
                        empName,
                        session.date || '',
                        session.dateRange || '',
                        AREA_NAMES[metricKey] || metricKey,
                        value,
                        targetStr,
                        status,
                        session.wasCoached ? 'Yes' : 'No'
                    ]);
                });
            });
        });

        const detailWs = XLSX.utils.aoa_to_sheet(detailData);
        detailWs['!cols'] = [
            { wch: 25 },  // Employee
            { wch: 12 },  // Date
            { wch: 20 },  // Date Range
            { wch: 30 },  // Metric
            { wch: 10 },  // Value
            { wch: 10 },  // Target
            { wch: 12 },  // Status
            { wch: 12 }   // Was Coached
        ];
        XLSX.utils.book_append_sheet(wb, detailWs, 'Detailed History');

        // Tab 4: Upload History (auditing)
        try {
            const uploads = loadUploadHistory();
            const uploadRows = [['Time Period', 'Start Date', 'End Date', 'Employee Count', 'Timestamp', 'Source Sheet']];
            (uploads || []).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)).forEach(u => {
                uploadRows.push([
                    u.timePeriod || '',
                    u.startDate || '',
                    u.endDate || '',
                    String(u.employeeCount ?? ''),
                    u.timestamp ? new Date(u.timestamp).toLocaleString() : '',
                    u.sourceSheet || ''
                ]);
            });
            const uploadsWs = XLSX.utils.aoa_to_sheet(uploadRows);
            uploadsWs['!cols'] = [
                { wch: 28 }, { wch: 12 }, { wch: 12 }, { wch: 16 }, { wch: 22 }, { wch: 20 }
            ];
            XLSX.utils.book_append_sheet(wb, uploadsWs, 'Upload History');
        } catch (auditErr) {
            console.warn('Could not build Upload History tab:', auditErr);
        }

        // Generate and download
        const timestamp = new Date().toISOString().split('T')[0];
        XLSX.writeFile(wb, `employee-history-${timestamp}.xlsx`);
        
        showToast('📊 Employee history exported to Excel');
    } catch (error) {
        console.error('Error exporting employee history:', error);
        alert('Error exporting to Excel: ' + error.message);
    }
}

// Export comprehensive workbook with all data in multiple tabs
function exportComprehensiveExcel() {
    try {
        if (typeof XLSX === 'undefined') {
            alert('SheetJS library not available. Cannot export to Excel.');
            return;
        }

        const wb = XLSX.utils.book_new();

        // Tab 1: Coaching Tips
        const tipsData = [['Metric', 'Tip']];
        Object.keys(AREA_NAMES).forEach(metricKey => {
            const metricName = AREA_NAMES[metricKey];
            const tips = customTips[metricKey] || [];
            
            if (tips.length > 0) {
                tips.forEach(tip => {
                    tipsData.push([metricName, tip]);
                });
            } else {
                tipsData.push([metricName, '(No tips available)']);
            }
        });

        const tipsWs = XLSX.utils.aoa_to_sheet(tipsData);
        tipsWs['!cols'] = [{ wch: 30 }, { wch: 100 }];
        XLSX.utils.book_append_sheet(wb, tipsWs, 'Coaching Tips');

        // Tab 2: Employee Summary
        const history = getAllHistory();
        const summaryData = [['Employee Name', 'Total Sessions', 'Date Ranges Covered']];
        
        Object.keys(history).sort().forEach(empName => {
            const sessions = history[empName];
            const dateRanges = [...new Set(sessions.map(s => s.dateRange).filter(d => d))].join(', ');
            summaryData.push([empName, sessions.length, dateRanges || 'N/A']);
        });

        const summaryWs = XLSX.utils.aoa_to_sheet(summaryData);
        summaryWs['!cols'] = [{ wch: 25 }, { wch: 15 }, { wch: 50 }];
        XLSX.utils.book_append_sheet(wb, summaryWs, 'Employee Summary');

        // Tab 3: Detailed History
        const detailData = [['Employee', 'Date', 'Date Range', 'Metric', 'Value', 'Target', 'Status', 'Was Coached']];
        
        Object.keys(history).sort().forEach(empName => {
            history[empName].forEach(session => {
                const metrics = session.metrics || {};
                
                Object.keys(metrics).forEach(metricKey => {
                    if (metricKey === 'reliability') return;
                    
                    const value = metrics[metricKey];
                    const target = TARGETS.driver[metricKey];
                    let targetStr = '';
                    let status = '';
                    
                    if (target) {
                        if (target.min !== undefined) {
                            targetStr = `≥ ${target.min}`;
                            status = value >= target.min ? '✅ Met' : '❌ Missed';
                        } else if (target.max !== undefined) {
                            targetStr = `≤ ${target.max}`;
                            status = value <= target.max ? '✅ Met' : '❌ Missed';
                        }
                    }
                    
                    detailData.push([
                        empName,
                        session.date || '',
                        session.dateRange || '',
                        AREA_NAMES[metricKey] || metricKey,
                        value,
                        targetStr,
                        status,
                        session.wasCoached ? 'Yes' : 'No'
                    ]);
                });
            });
        });

        const detailWs = XLSX.utils.aoa_to_sheet(detailData);
        detailWs['!cols'] = [
            { wch: 25 }, { wch: 12 }, { wch: 20 }, { wch: 30 },
            { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }
        ];
        XLSX.utils.book_append_sheet(wb, detailWs, 'Detailed History');

        // Generate and download
        const timestamp = new Date().toISOString().split('T')[0];
        XLSX.writeFile(wb, `coaching-tool-complete-${timestamp}.xlsx`);
        
        showToast('📊 Complete data exported to Excel with multiple tabs!');
    } catch (error) {
        console.error('Error exporting comprehensive Excel:', error);
        alert('Error exporting to Excel: ' + error.message);
    }
}

// Shared area names mapping
const AREA_NAMES = {
    scheduleAdherence: 'Schedule Adherence',
    cxRepOverall: 'Customer Experience',
    fcr: 'First Call Resolution',
    overallExperience: 'Overall Experience',
    transfers: 'Transfers',
    overallSentiment: 'Overall Sentiment',
    positiveWord: 'Positive Word Choice',
    negativeWord: 'Avoid Negative Word Choice',
    managingEmotions: 'Managing Emotions',
    aht: 'Average Handle Time',
    acw: 'After Call Work',
    holdTime: 'Hold Time',
    reliability: 'Reliability'
};

// Improvement tips for each metric (fallback if no CSV loaded)
const IMPROVEMENT_TIPS = {
    scheduleAdherence: "Schedule Adherence: Focus on being present for all scheduled shifts. This is foundational to your team relying on you.",
    cxRepOverall: "Customer Experience: Every interaction is an opportunity to exceed expectations. Work on consistency and attention to detail.",
    fcr: "First Call Resolution: Before transferring, confirm you've exhausted available resources. Take time to understand the full issue first.",
    transfers: "Transfers: Reduce transfers by building your product knowledge and taking time to fully understand customer needs before responding.",
    overallSentiment: "Overall Sentiment: Let your enthusiasm for helping customers shine through. Your tone sets the temperature for the conversation.",
    positiveWord: "Positive Word Choice: Use constructive language. Say 'Let me find out' instead of 'I don't know' to maintain customer confidence.",
    negativeWord: "Negative Word Choice: Avoid language that sounds dismissive. Replace 'You'll have to...' with 'Let me help you...'",
    managingEmotions: "Managing Emotions: You're doing great here! Keep maintaining composure even during challenging interactions.",
    aht: "Average Handle Time: Focus on efficiency without rushing. Prepare your responses, but don't skip necessary steps.",
    acw: "After Call Work: Complete your documentation promptly. This keeps you available for the next customer and maintains accuracy.",
    holdTime: "Hold Time: Minimize hold time by gathering information upfront. It improves customer experience and efficiency.",
    reliability: "Reliability: Your availability is crucial. Work toward reducing unexpected absences and maintaining consistent attendance."
};

// Generate email subject and body
function generateEmailContent(employeeName, coachingEmail) {
    const nameParts = employeeName.trim().split(' ');
    const firstName = nameParts[0];
    const lastName = nameParts[nameParts.length - 1];
    const emailAddress = `${firstName.toLowerCase()}.${lastName.toLowerCase()}@aps.com`;
    const subject = `Quick Check-In: Let's Chat About Your Metrics!`;
    
    return {
        to: emailAddress,
        subject: subject,
        body: coachingEmail
    };
}

// Load tips from server
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
        
        return tips;
    } catch (error) {
        console.error('Error loading server tips:', error);
        return {};
    }
}

// Load user's custom tips from localStorage
function loadUserTips() {
    try {
        const saved = localStorage.getItem('userCustomTips');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading user tips:', error);
        return {};
    }
}

// Load hidden tips map from localStorage
function loadHiddenTips() {
    try {
        const saved = localStorage.getItem('hiddenTips');
        return saved ? JSON.parse(saved) : {};
    } catch (error) {
        console.error('Error loading hidden tips:', error);
        return {};
    }
}

// Save user's custom tips to localStorage
function saveUserTips(tips) {
    try {
        localStorage.setItem('userCustomTips', JSON.stringify(tips));
    } catch (error) {
        console.error('Error saving user tips:', error);
        alert('Warning: Could not save custom tips. Storage may be full.');
    }
}

// Save hidden tips map to localStorage
function saveHiddenTips(tips) {
    try {
        localStorage.setItem('hiddenTips', JSON.stringify(tips));
    } catch (error) {
        console.error('Error saving hidden tips:', error);
    }
}

// Merge server and user tips
function mergeTips() {
    const merged = {};
    const hidden = hiddenTips || {};

    // Start with server tips (minus hidden)
    Object.entries(serverTips).forEach(([metric, tips]) => {
        merged[metric] = tips.filter(tip => !(hidden[metric] || []).includes(tip));
    });

    // Add user tips (minus hidden)
    Object.entries(userTips).forEach(([metric, tips]) => {
        if (!merged[metric]) merged[metric] = [];
        const filtered = tips.filter(tip => !(hidden[metric] || []).includes(tip));
        merged[metric].push(...filtered);
    });

    // Reorder according to saved tipOrder, preserving duplicates
    Object.keys(merged).forEach(metric => {
        const currentList = merged[metric] || [];
        const orderList = tipOrder[metric] || [];
        const counts = {};
        currentList.forEach(t => { counts[t] = (counts[t] || 0) + 1; });
        const ordered = [];
        orderList.forEach(t => {
            if (counts[t] > 0) { ordered.push(t); counts[t]--; }
        });
        currentList.forEach(t => {
            if (counts[t] > 0) { ordered.push(t); counts[t]--; }
        });
        merged[metric] = ordered;
        tipOrder[metric] = ordered; // keep order in sync
    });

    customTips = merged;
    saveTipOrder(tipOrder);
}

// Show tips management interface
function showTipsManagement() {
    // Populate dropdown
    const metricSelect = document.getElementById('metricSelect');
    metricSelect.innerHTML = '<option value="">-- Choose a metric --</option>';
    
    Object.keys(AREA_NAMES).forEach(metricKey => {
        const option = document.createElement('option');
        option.value = metricKey;
        option.textContent = AREA_NAMES[metricKey];
        metricSelect.appendChild(option);
    });
    
    // Clear content initially
    document.getElementById('tipsManagementContent').innerHTML = '<p style="color: #999; font-style: italic; text-align: center; padding: 40px;">Select a metric from the dropdown above to view and manage its tips.</p>';
    
    // Show the section
    showOnlySection('tipsManagementSection');
}

// Show tips for selected metric
function showMetricTips(metricKey) {
    if (!metricKey) {
        document.getElementById('tipsManagementContent').innerHTML = '<p style="color: #999; font-style: italic; text-align: center; padding: 40px;">Select a metric from the dropdown above to view and manage its tips.</p>';
        return;
    }
    
    const content = document.getElementById('tipsManagementContent');
    const metricName = AREA_NAMES[metricKey];
    const tips = customTips[metricKey] || [];
    
    let html = `
        <div style="border: 1px solid #ddd; border-radius: 8px; padding: 20px; background: white;">
            <h3 style="color: #003DA5; margin-bottom: 15px;">${metricName}</h3>
            
            <div id="tips-${metricKey}" style="margin-bottom: 15px;">
    `;
    
    if (tips.length === 0) {
        html += `<p style="color: #999; font-style: italic;">No tips available for this metric.</p>`;
    } else {
        tips.forEach((tip, index) => {
            html += `
                <div style="display: flex; gap: 10px; margin-bottom: 10px; padding: 10px; background: #f8f9fa; border-radius: 4px; align-items: start;">
                    <div style="flex: 1;">
                        <textarea id="tip-${metricKey}-${index}" style="width: 100%; min-height: 60px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; resize: vertical;">${tip}</textarea>
                    </div>
                    <button onclick="saveTipEdit('${metricKey}', ${index})" style="background: #28a745; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer;">💾 Save</button>
                    <button onclick="deleteTip('${metricKey}', ${index})" style="background: #dc3545; color: white; border: none; border-radius: 4px; padding: 8px 12px; cursor: pointer;">🗑️ Delete</button>
                </div>
            `;
        });
    }
    
    html += `
            </div>
            
            <div style="margin-top: 15px;">
                <textarea id="newTip-${metricKey}" placeholder="Add a new tip for ${metricName}..." style="width: 100%; min-height: 60px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; resize: vertical;"></textarea>
                <button onclick="addNewTip('${metricKey}')" style="background: #007bff; color: white; border: none; border-radius: 4px; padding: 8px 15px; cursor: pointer; margin-top: 5px;">➕ Add Tip</button>
            </div>
        </div>
    `;
    
    content.innerHTML = html;
}

// Add a new tip
function addNewTip(metricKey) {
    const textarea = document.getElementById(`newTip-${metricKey}`);
    if (!textarea) return;
    
    const newTip = textarea.value.trim();
    
    if (!newTip) {
        alert('Please enter a tip before adding.');
        return;
    }
    
    // Add to user tips
    if (!userTips[metricKey]) {
        userTips[metricKey] = [];
    }
    userTips[metricKey].push(newTip);
    
    // Save and refresh
    // Update tip order (append to end)
    if (!tipOrder[metricKey]) tipOrder[metricKey] = customTips[metricKey] ? [...customTips[metricKey]] : [];
    tipOrder[metricKey].push(newTip);
    saveTipOrder(tipOrder);

    saveUserTips(userTips);
    mergeTips();
    showMetricTips(metricKey);
    
    showToast('✅ Tip added');
    autoExportTipsToExcel();
    document.getElementById(`newTip-${metricKey}`).value = '';
}

// Save edited tip
function saveTipEdit(metricKey, tipIndex) {
    const textarea = document.getElementById(`tip-${metricKey}-${tipIndex}`);
    if (!textarea) return;
    
    const editedTip = textarea.value.trim();
    
    if (!editedTip) {
        alert('Tip cannot be empty. Use delete if you want to remove it.');
        return;
    }
    const existing = customTips[metricKey] || [];
    const originalTip = existing[tipIndex];
    const serverTipsForMetric = serverTips[metricKey] || [];

    // If editing a server-sourced tip, hide the original server tip and store the edited version as a user tip
    if (serverTipsForMetric.includes(originalTip)) {
        if (!hiddenTips[metricKey]) hiddenTips[metricKey] = [];
        if (!hiddenTips[metricKey].includes(originalTip)) {
            hiddenTips[metricKey].push(originalTip);
        }
        // Ensure userTips exists
        if (!userTips[metricKey]) userTips[metricKey] = [];
        const idxUser = userTips[metricKey].indexOf(originalTip);
        if (idxUser !== -1) {
            userTips[metricKey][idxUser] = editedTip;
        } else {
            // Avoid duplicate entries
            if (!userTips[metricKey].includes(editedTip)) {
                userTips[metricKey].push(editedTip);
            }
        }
    } else {
        // Editing an existing user tip: replace in userTips
        if (!userTips[metricKey]) userTips[metricKey] = [];
        const idxUser = userTips[metricKey].indexOf(originalTip);
        if (idxUser !== -1) {
            userTips[metricKey][idxUser] = editedTip;
        } else {
            // Fallback: if the original isn't found (data drift), add edited tip and remove any exact duplicates
            if (!userTips[metricKey].includes(editedTip)) {
                userTips[metricKey].push(editedTip);
            }
        }
    }
    
    // Save and refresh
    // Update tip order to keep position the same
    if (!tipOrder[metricKey]) tipOrder[metricKey] = customTips[metricKey] ? [...customTips[metricKey]] : [];
    tipOrder[metricKey][tipIndex] = editedTip;
    saveTipOrder(tipOrder);

    saveHiddenTips(hiddenTips);
    saveUserTips(userTips);
    mergeTips();
    showMetricTips(metricKey);
    
    showToast('✅ Tip updated');
    autoExportTipsToExcel();
}

// Delete a tip (soft-delete server tips, remove user tips)
function deleteTip(metricKey, tipIndex) {
    if (!confirm('Are you sure you want to delete this tip?')) {
        return;
    }
    const existing = customTips[metricKey] || [];
    const tipValue = existing[tipIndex];
    if (tipValue === undefined) {
        alert('Tip not found.');
        return;
    }

    // Remove from the rendered list
    existing.splice(tipIndex, 1);

    const serverTipsForMetric = serverTips[metricKey] || [];
    const remainingTips = existing || [];

    // Track hidden tips so server tips stay removed after merge
    if (!hiddenTips[metricKey]) hiddenTips[metricKey] = [];
    if (!hiddenTips[metricKey].includes(tipValue)) {
        hiddenTips[metricKey].push(tipValue);
    }

    // Only keep user tips that remain (not hidden) and not in server tips
    userTips[metricKey] = remainingTips.filter(tip => !serverTipsForMetric.includes(tip));

    // Update tip order: remove at the same index
    if (!tipOrder[metricKey]) tipOrder[metricKey] = customTips[metricKey] ? [...customTips[metricKey]] : [];
    tipOrder[metricKey].splice(tipIndex, 1);
    saveTipOrder(tipOrder);

    saveHiddenTips(hiddenTips);
    saveUserTips(userTips);
    mergeTips();
    showMetricTips(metricKey);

    showToast('✅ Tip deleted');
    autoExportTipsToExcel();
}

// Get random tip for a metric
function getRandomTip(metric) {
    // First check custom tips
    if (customTips[metric] && customTips[metric].length > 0) {
        const tips = customTips[metric];
        const randomTip = tips[Math.floor(Math.random() * tips.length)];
        return randomTip;
    }
    
    // Fallback to default tips
    return IMPROVEMENT_TIPS[metric] || `Focus on improving ${metric}`;
}

// Identify struggling areas
function identifyStrugglingAreas(metrics) {
    const struggling = [];
    
    // Check driver metrics
    const driverMetrics = [
        { key: 'scheduleAdherence', value: metrics.scheduleAdherence, target: TARGETS.driver.scheduleAdherence },
        { key: 'cxRepOverall', value: metrics.cxRepOverall, target: TARGETS.driver.cxRepOverall },
        { key: 'fcr', value: metrics.fcr, target: TARGETS.driver.fcr },
        { key: 'overallExperience', value: metrics.overallExperience, target: TARGETS.driver.overallExperience },
        { key: 'transfers', value: metrics.transfers, target: TARGETS.driver.transfers },
        { key: 'overallSentiment', value: metrics.overallSentiment, target: TARGETS.driver.overallSentiment },
        { key: 'positiveWord', value: metrics.positiveWord, target: TARGETS.driver.positiveWord },
        { key: 'negativeWord', value: metrics.negativeWord, target: TARGETS.driver.negativeWord },
        { key: 'managingEmotions', value: metrics.managingEmotions, target: TARGETS.driver.managingEmotions },
        { key: 'aht', value: metrics.aht, target: TARGETS.driver.aht },
        { key: 'acw', value: metrics.acw, target: TARGETS.driver.acw },
        { key: 'holdTime', value: metrics.holdTime, target: TARGETS.driver.holdTime },
        { key: 'reliability', value: metrics.reliability, target: TARGETS.driver.reliability }
    ];

    driverMetrics.forEach(metric => {
        // Skip survey-based metrics (FCR, CX Rep Overall, Overall Experience) if they're empty (no surveys)
        if ((metric.key === 'fcr' || metric.key === 'cxRepOverall' || metric.key === 'overallExperience') && (metric.value === '' || metric.value === null || metric.value === undefined)) {
            return; // Skip this metric
        }
        
        const target = metric.target;
        const isMin = 'min' in target;
        
        if (isMin && metric.value < target.min) {
            struggling.push(metric.key);
        } else if (!isMin && metric.value > target.max) {
            struggling.push(metric.key);
        }
    });

    return struggling;
}

// History tracking functions
function getEmployeeHistory(employeeName) {
    try {
        const history = JSON.parse(localStorage.getItem('coachingHistory') || '{}');
        return history[employeeName] || [];
    } catch (error) {
        console.error('Error reading history:', error);
        return [];
    }
}

function saveToHistory(employeeName, strugglingAreas, metrics = null, dateRange = null) {
    try {
        const history = JSON.parse(localStorage.getItem('coachingHistory') || '{}');

        if (!history[employeeName]) {
            history[employeeName] = [];
        }

        history[employeeName].push({
            date: new Date().toISOString(),
            dateRange: dateRange || '',
            strugglingAreas,
            metrics
        });
        
        localStorage.setItem('coachingHistory', JSON.stringify(history));
    } catch (error) {
        if (error.name === 'QuotaExceededError') {
            console.warn('Storage quota exceeded, attempting cleanup...');
            if (confirm('⚠️ Storage is full! Would you like to keep only the last 15 sessions per employee and try again?')) {
                try {
                    const history = JSON.parse(localStorage.getItem('coachingHistory') || '{}');
                    // Keep only last 15 sessions per employee
                    Object.keys(history).forEach(name => {
                        if (history[name].length > 15) {
                            history[name] = history[name].slice(-15);
                        }
                    });
                    localStorage.setItem('coachingHistory', JSON.stringify(history));
                    
                    // Try saving again
                    if (!history[employeeName]) history[employeeName] = [];
                    history[employeeName].push({
                        date: new Date().toISOString(),
                        dateRange: dateRange || '',
                        strugglingAreas,
                        metrics
                    });
                    localStorage.setItem('coachingHistory', JSON.stringify(history));
                    console.log('✅ Storage cleaned up and data saved successfully');
                } catch (retryError) {
                    console.error('Cleanup failed:', retryError);
                    alert('❌ Could not save coaching history even after cleanup. Please export your data and clear history.');
                }
            } else {
                alert('❌ Data not saved. Please clear some history to continue.');
            }
        } else {
            console.error('Error saving history:', error);
            alert('Warning: Could not save coaching history. Error: ' + error.message);
        }
    }
}

function getAllHistory() {
    try {
        return JSON.parse(localStorage.getItem('coachingHistory') || '{}');
    } catch (error) {
        console.error('Error reading all history:', error);
        return {};
    }
}

function clearAllHistory() {
    localStorage.removeItem('coachingHistory');
    alert('All history cleared!');
    location.reload();
}

// Delete a specific session for an employee
function deleteSession(employeeName, sessionIndex) {
    const history = getAllHistory();
    if (history[employeeName]) {
        history[employeeName].splice(sessionIndex, 1);
        
        // If no sessions left for this employee, remove the employee entirely
        if (history[employeeName].length === 0) {
            delete history[employeeName];
        }
        
        localStorage.setItem('coachingHistory', JSON.stringify(history));
        showEmployeeDashboard(); // Refresh the display
    }
}

// Diagnose trends for an employee
function diagnoseTrends(employeeName) {
    const history = getEmployeeHistory(employeeName);
    
    if (history.length === 0) {
        alert('No coaching history for this employee.');
        return;
    }
    
    // Sort by date
    const sortedHistory = history.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    const safeEmployeeName = escapeHtml(employeeName);
    
    let html = `
        <div style="max-width: 1000px; margin: 20px auto;">
            <h2 style="color: #003DA5; margin-bottom: 20px;">📊 Trend Analysis: ${safeEmployeeName}</h2>
            <p style="color: #666; margin-bottom: 30px;">Tracking ${sortedHistory.length} coaching session${sortedHistory.length > 1 ? 's' : ''}</p>
    `;
    
    // Analyze each metric across sessions
    const metricKeys = [
        { key: 'scheduleAdherence', name: 'Schedule Adherence', unit: '%', target: TARGETS.driver.scheduleAdherence, isMin: true },
        { key: 'cxRepOverall', name: 'CX Rep Overall', unit: '%', target: TARGETS.driver.cxRepOverall, isMin: true },
        { key: 'fcr', name: 'First Call Resolution', unit: '%', target: TARGETS.driver.fcr, isMin: true },
        { key: 'overallExperience', name: 'Overall Experience', unit: '%', target: TARGETS.driver.overallExperience, isMin: true },
        { key: 'transfers', name: 'Transfers', unit: '%', target: TARGETS.driver.transfers, isMin: false },
        { key: 'overallSentiment', name: 'Overall Sentiment', unit: '%', target: TARGETS.driver.overallSentiment, isMin: true },
        { key: 'positiveWord', name: 'Positive Word', unit: '%', target: TARGETS.driver.positiveWord, isMin: true },
        { key: 'negativeWord', name: 'Negative Word', unit: '%', target: TARGETS.driver.negativeWord, isMin: true },
        { key: 'managingEmotions', name: 'Managing Emotions', unit: '%', target: TARGETS.driver.managingEmotions, isMin: true },
        { key: 'aht', name: 'AHT', unit: 's', target: TARGETS.driver.aht, isMin: false },
        { key: 'acw', name: 'ACW', unit: 's', target: TARGETS.driver.acw, isMin: false },
        { key: 'holdTime', name: 'Hold Time', unit: 's', target: TARGETS.driver.holdTime, isMin: false },
        { key: 'reliability', name: 'Reliability', unit: ' hrs', target: TARGETS.driver.reliability, isMin: false }
    ];
    
    metricKeys.forEach(metric => {
        const values = sortedHistory
            .filter(s => s.metrics && s.metrics[metric.key] !== undefined && s.metrics[metric.key] !== 0)
            .map(s => ({
                date: new Date(s.date).toLocaleDateString(),
                dateRange: s.dateRange || '',
                value: s.metrics[metric.key],
                wasCoached: s.strugglingAreas.includes(metric.key)
            }));
        
        if (values.length === 0) return;
        
        const targetValue = metric.isMin ? metric.target.min : metric.target.max;
        const firstValue = values[0].value;
        const lastValue = values[values.length - 1].value;
        
        let trend = '→';
        let trendColor = '#666';
        let trendText = 'No change';
        
        if (values.length > 1) {
            const change = lastValue - firstValue;
            if (metric.isMin) {
                // Higher is better
                if (change > 0) {
                    trend = '📈';
                    trendColor = '#28a745';
                    trendText = `Improving (+${change.toFixed(2)}${metric.unit})`;
                } else if (change < 0) {
                    trend = '📉';
                    trendColor = '#dc3545';
                    trendText = `Declining (${change.toFixed(2)}${metric.unit})`;
                }
            } else {
                // Lower is better
                if (change < 0) {
                    trend = '📈';
                    trendColor = '#28a745';
                    trendText = `Improving (${change.toFixed(2)}${metric.unit})`;
                } else if (change > 0) {
                    trend = '📉';
                    trendColor = '#dc3545';
                    trendText = `Declining (+${change.toFixed(2)}${metric.unit})`;
                }
            }
        }
        
        const meetingTarget = metric.isMin ? lastValue >= targetValue : lastValue <= targetValue;
        const targetStatus = meetingTarget ? '✅ Meeting target' : '⚠️ Below target';
        
        // Create visual bar chart
        const minValue = Math.min(...values.map(v => v.value));
        const maxValue = Math.max(...values.map(v => v.value));
        const range = maxValue - minValue || 1;
        
        html += `
            <div style="border: 1px solid #ddd; border-radius: 8px; padding: 15px; margin-bottom: 15px; background: white;">
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <h3 style="margin: 0; color: #003DA5;">${metric.name}</h3>
                    <div style="text-align: right;">
                        <span style="font-size: 1.5em;">${trend}</span>
                        <div style="color: ${trendColor}; font-weight: bold;">${trendText}</div>
                        <div style="color: ${meetingTarget ? '#28a745' : '#dc3545'}; font-size: 0.9em;">${targetStatus}</div>
                    </div>
                </div>
                <div style="margin-bottom: 15px;">
                    <strong>Target:</strong> ${metric.isMin ? '≥' : '≤'}${targetValue}${metric.unit} | 
                    <strong>Current:</strong> ${lastValue}${metric.unit}
                </div>
                
                <!-- Visual Chart -->
                <div style="background: #f8f9fa; padding: 15px; border-radius: 4px; margin-bottom: 15px;">
                    <div style="display: flex; align-items: flex-end; gap: 5px; height: 150px; border-bottom: 2px solid #ddd; padding-bottom: 5px;">
        `;
        
        values.forEach((v, i) => {
            const heightPercent = range > 0 ? ((v.value - minValue) / range) * 100 : 50;
            const isImproving = i > 0 && (metric.isMin ? v.value > values[i-1].value : v.value < values[i-1].value);
            const isDeclining = i > 0 && (metric.isMin ? v.value < values[i-1].value : v.value > values[i-1].value);
            const barColor = v.wasCoached ? '#ffc107' : isImproving ? '#28a745' : isDeclining ? '#dc3545' : '#007bff';
            const dateShort = v.dateRange || v.date.substring(0, 5);
            
            html += `
                <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: flex-end;">
                    <div style="font-weight: bold; font-size: 0.85em; margin-bottom: 3px; color: ${barColor};">${v.value}${metric.unit}</div>
                    <div style="width: 100%; height: ${heightPercent}%; min-height: 10px; background: ${barColor}; border-radius: 4px 4px 0 0; transition: all 0.3s;"></div>
                    <div style="font-size: 0.75em; color: #666; margin-top: 5px; writing-mode: vertical-rl; transform: rotate(180deg);">${dateShort}</div>
                </div>
            `;
        });
        
        html += `
                    </div>
                    <div style="margin-top: 10px; font-size: 0.85em; color: #666;">
                        <span style="display: inline-block; width: 12px; height: 12px; background: #ffc107; border-radius: 2px; margin-right: 5px;"></span>Coached
                        <span style="display: inline-block; width: 12px; height: 12px; background: #28a745; border-radius: 2px; margin-left: 15px; margin-right: 5px;"></span>Improving
                        <span style="display: inline-block; width: 12px; height: 12px; background: #dc3545; border-radius: 2px; margin-left: 15px; margin-right: 5px;"></span>Declining
                    </div>
                </div>
                
                <!-- Session Details -->
                <div style="display: flex; gap: 10px; flex-wrap: wrap;">
        `;
        
        values.forEach((v, i) => {
            const isImproving = i > 0 && (metric.isMin ? v.value > values[i-1].value : v.value < values[i-1].value);
            const isDeclining = i > 0 && (metric.isMin ? v.value < values[i-1].value : v.value > values[i-1].value);
            const arrow = isImproving ? '⬆️' : isDeclining ? '⬇️' : '';
            const bgColor = v.wasCoached ? '#fff3cd' : '#f8f9fa';
            
            html += `
                <div style="background: ${bgColor}; padding: 8px 12px; border-radius: 4px; border: 1px solid #ddd;">
                    <div style="font-size: 0.85em; color: #666;">${v.date}${v.dateRange ? '<br>Week: ' + v.dateRange : ''}</div>
                    <div style="font-size: 1.1em; font-weight: bold;">${arrow} ${v.value}${metric.unit}</div>
                    ${v.wasCoached ? '<div style="font-size: 0.75em; color: #856404;">⚠️ Coached</div>' : ''}
                </div>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
    });
    
    html += `
            <button onclick="showEmployeeDashboard()" style="background: #003DA5; color: white; border: none; border-radius: 4px; padding: 10px 20px; cursor: pointer; font-size: 1em; margin-top: 20px;">← Back to Dashboard</button>
        </div>
    `;
    
    document.getElementById('dashboardContent').innerHTML = html;
}

// Show employee dashboard with expandable history per employee
function showEmployeeDashboard() {
    const history = getAllHistory();
    const dashboardContent = document.getElementById('dashboardContent');

    if (Object.keys(history).length === 0) {
        dashboardContent.innerHTML = '<p class="empty-state">No employee data loaded yet.</p>';
    } else {
        // Get all unique employees and date ranges
        const allEmployees = Object.keys(history).sort();
        const allDateRanges = new Set();
        
        Object.values(history).forEach(sessions => {
            sessions.forEach(s => {
                if (s.dateRange) allDateRanges.add(s.dateRange);
            });
        });
        
        const sortedDateRanges = Array.from(allDateRanges).sort().reverse();
        
        let html = `
        <!-- Employee and Date Range Selector -->
        <div style="background: #e3f2fd; padding: 20px; border-radius: 8px; margin-bottom: 20px; border-left: 4px solid #2196F3;">
            <h3 style="color: #003DA5; margin-bottom: 15px;">📊 Track Coaching Effectiveness</h3>
            <p style="color: #666; margin-bottom: 15px; font-size: 0.95em;">Select an employee to view their performance across different reporting periods and see if coaching helped improve their metrics.</p>
            
            <div style="margin-bottom: 15px;">
                <label style="font-weight: bold; display: block; margin-bottom: 8px;">1️⃣ Select Employee:</label>
                <select id="trendEmployeeSelect" onchange="updateDateRangeOptions()" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 1em;">
                    <option value="">-- Choose an employee --</option>
                    ${allEmployees.map(emp => `<option value="${emp}">${emp}</option>`).join('')}
                </select>
            </div>
            
            <div id="dateRangeContainer" style="display: none; margin-bottom: 15px;">
                <label style="font-weight: bold; display: block; margin-bottom: 8px;">2️⃣ Select Reporting Period:</label>
                <select id="trendDateRangeSelect" onchange="showEmployeeTrendData()" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 1em;">
                    <option value="">-- Choose a date range --</option>
                </select>
            </div>
            
            <div id="trendDataDisplay" style="display: none; margin-top: 20px; padding: 15px; background: white; border-radius: 5px; border: 1px solid #ddd;">
                <!-- Trend data will be displayed here -->
            </div>
        </div>

        <!-- Filter Section -->
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; margin-bottom: 20px;">`;
        
        // Employee filter
        html += '<div>';
        html += '<label style="font-weight: bold; display: block; margin-bottom: 8px;">Filter by Employee:</label>';
        html += '<select id="employeeFilter" onchange="filterDashboard()" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 1em;">';
        html += '<option value="">All Employees</option>';
        allEmployees.forEach(emp => {
            html += `<option value="${emp}">${emp}</option>`;
        });
        html += '</select></div>';
        
        // Date filter (initially hidden)
        html += '<div id="dateFilterContainer" style="display: none;">';
        html += '<label style="font-weight: bold; display: block; margin-bottom: 8px;">Filter by Date:</label>';
        html += '<select id="dateFilter" onchange="filterDashboard()" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 5px; font-size: 1em;">';
        html += '<option value="">All Dates</option>';
        sortedDateRanges.forEach(dateRange => {
            html += `<option value="${dateRange}">${dateRange}</option>`;
        });
        html += '</select></div>';
        
        html += '</div>';
        
        // Sort employees alphabetically
        const sortedEmployees = Object.entries(history).sort((a, b) => a[0].localeCompare(b[0]));

        html += '<div id="employeeList" style="display: flex; flex-direction: column; gap: 15px;">';

        sortedEmployees.forEach(([name, sessions]) => {
            const sessionCount = sessions.length;
            const uniqueId = name.replace(/\s+/g, '-');

            const safeName = escapeHtml(name);
            const safeNameForJs = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            
            html += `
                <div id="employee-card-${uniqueId}" style="border: 1px solid #ddd; border-radius: 8px; overflow: hidden;">
                    <div style="background: #f8f9fa; padding: 15px; cursor: pointer; display: flex; justify-content: space-between; align-items: center;" 
                         onclick="document.getElementById('employee-${uniqueId}').style.display = document.getElementById('employee-${uniqueId}').style.display === 'none' ? 'block' : 'none'">
                        <div>
                            <strong style="font-size: 1.1em;">${safeName}</strong>
                            <span style="margin-left: 10px; color: #666; font-size: 0.9em;">(${sessionCount} coaching session${sessionCount > 1 ? 's' : ''})</span>
                        </div>
                        <div style="display: flex; gap: 10px; align-items: center;">
                            <button onclick="event.stopPropagation(); diagnoseTrends('${safeNameForJs}')" 
                                    style="background: #28a745; color: white; border: none; border-radius: 4px; padding: 8px 15px; cursor: pointer; font-size: 0.9em;">📊 Diagnose Trends</button>
                            <span style="font-size: 1.2em;">▼</span>
                        </div>
                    </div>
                    <div id="employee-${uniqueId}" style="display: none; padding: 15px; background: white;">
            `;

            // Show each coaching session
            sessions.forEach((session, index) => {
                const sessionDate = new Date(session.date);
                const date = sessionDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const weekLabel = session.dateRange || 'No week set';
                const areas = session.strugglingAreas.map(a => AREA_NAMES[a] || a).join(', ');
                
                const safeNameForDelete = name.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                const safeDateLabel = escapeHtml(date);
                const safeWeekLabel = escapeHtml(weekLabel);
                const safeAreas = escapeHtml(areas);
                
                html += `
                    <div data-employee="${escapeHtml(name)}" data-date="${safeDateLabel}" data-week="${escapeHtml(session.dateRange || '')}" style="margin-bottom: 20px; padding: 10px; border-left: 3px solid #007bff; background: #f8f9fa; position: relative;">
                        <button onclick="if(confirm('Delete this session?')) deleteSession('${safeNameForDelete}', ${index})" 
                                style="position: absolute; top: 5px; right: 5px; background: #dc3545; color: white; border: none; border-radius: 4px; padding: 5px 10px; cursor: pointer; font-size: 0.85em;">🗑️ Delete</button>
                        <div style="font-weight: bold; margin-bottom: 5px;">Session ${index + 1} - ${safeDateLabel}</div>
                        <div style="font-size: 0.9em; color: #666; margin-bottom: 5px;">📅 Week: ${safeWeekLabel}</div>
                        <div style="color: #666; margin-bottom: 8px;"><strong>Areas:</strong> ${safeAreas}</div>
                `;

                // Show metrics if available
                if (session.metrics) {
                    html += '<div style="font-size: 0.9em; color: #555; display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 5px;">';
                    
                    if (session.metrics.scheduleAdherence) html += `<div>Schedule: ${session.metrics.scheduleAdherence}%</div>`;
                    if (session.metrics.fcr) html += `<div>FCR: ${session.metrics.fcr}%</div>`;
                    if (session.metrics.transfers) html += `<div>Transfers: ${session.metrics.transfers}%</div>`;
                    if (session.metrics.aht) html += `<div>AHT: ${session.metrics.aht}s</div>`;
                    if (session.metrics.acw) html += `<div>ACW: ${session.metrics.acw}s</div>`;
                    if (session.metrics.holdTime) html += `<div>Hold: ${session.metrics.holdTime}s</div>`;
                    if (session.metrics.reliability) html += `<div>Reliability: ${session.metrics.reliability} hrs</div>`;
                    if (session.metrics.overallSentiment) html += `<div>Sentiment: ${session.metrics.overallSentiment}%</div>`;
                    if (session.metrics.positiveWord) html += `<div>Positive: ${session.metrics.positiveWord}%</div>`;
                    if (session.metrics.negativeWord) html += `<div>Negative: ${session.metrics.negativeWord}%</div>`;
                    if (session.metrics.managingEmotions) html += `<div>Emotions: ${session.metrics.managingEmotions}%</div>`;
                    if (session.metrics.cxRepOverall) html += `<div>CX Rep: ${session.metrics.cxRepOverall}%</div>`;
                    
                    html += '</div>';
                }

                html += `</div>`;
            });

            html += `
                    </div>
                </div>
            `;
        });

        html += '</div>';
        dashboardContent.innerHTML = html;
    }

    showOnlySection('dashboardSection');
}

// Update date range dropdown based on selected employee
function updateDateRangeOptions() {
    const selectedEmployee = document.getElementById('trendEmployeeSelect')?.value || '';
    const dateRangeSelect = document.getElementById('trendDateRangeSelect');
    const dateRangeContainer = document.getElementById('dateRangeContainer');
    const trendDataDisplay = document.getElementById('trendDataDisplay');
    
    if (!dateRangeSelect || !dateRangeContainer) return;
    
    // Hide previous trend data
    if (trendDataDisplay) trendDataDisplay.style.display = 'none';
    
    if (!selectedEmployee) {
        dateRangeContainer.style.display = 'none';
        dateRangeSelect.innerHTML = '<option value="">-- Choose a date range --</option>';
        return;
    }
    
    const history = getAllHistory();
    const employeeSessions = history[selectedEmployee] || [];
    
    // Get unique date ranges for this employee
    const dateRanges = [...new Set(employeeSessions.map(s => s.dateRange).filter(dr => dr))];
    
    if (dateRanges.length === 0) {
        dateRangeContainer.style.display = 'none';
        dateRangeSelect.innerHTML = '<option value="">No date ranges available</option>';
        return;
    }
    
    // Sort date ranges (most recent first)
    dateRanges.sort().reverse();
    
    dateRangeContainer.style.display = 'block';
    dateRangeSelect.innerHTML = '<option value="">-- Choose a date range --</option>' + 
        dateRanges.map(dr => `<option value="${dr}">${dr}</option>`).join('');
}

// Show employee trend data for selected employee and date range
function showEmployeeTrendData() {
    const selectedEmployee = document.getElementById('trendEmployeeSelect')?.value || '';
    const selectedDateRange = document.getElementById('trendDateRangeSelect')?.value || '';
    const trendDataDisplay = document.getElementById('trendDataDisplay');
    
    if (!trendDataDisplay || !selectedEmployee || !selectedDateRange) {
        if (trendDataDisplay) trendDataDisplay.style.display = 'none';
        return;
    }
    
    const history = getAllHistory();
    const employeeSessions = history[selectedEmployee] || [];
    
    // Find the session for this date range
    const session = employeeSessions.find(s => s.dateRange === selectedDateRange);
    
    if (!session || !session.metrics) {
        trendDataDisplay.innerHTML = '<p style="color: #999; font-style: italic;">No data available for this date range.</p>';
        trendDataDisplay.style.display = 'block';
        return;
    }
    
    const metrics = session.metrics;
    const sessionDate = new Date(session.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    const strugglingAreas = session.strugglingAreas || [];
    const wasCoached = strugglingAreas.length > 0;
    
    // Find previous session for comparison
    const allSessions = employeeSessions.sort((a, b) => new Date(a.date) - new Date(b.date));
    const currentIndex = allSessions.findIndex(s => s.dateRange === selectedDateRange);
    const previousSession = currentIndex > 0 ? allSessions[currentIndex - 1] : null;
    
    // Build metrics display with comparison
    const safeEmployee = escapeHtml(selectedEmployee);
    const safeDateRange = escapeHtml(selectedDateRange);
    
    let html = `
        <div style="border-bottom: 2px solid #003DA5; padding-bottom: 10px; margin-bottom: 15px;">
            <h4 style="color: #003DA5; margin: 0;">${safeEmployee} - ${safeDateRange}</h4>
            <div style="font-size: 0.9em; color: #666; margin-top: 5px;">Uploaded: ${sessionDate}</div>
            ${wasCoached ? `<div style="margin-top: 8px; padding: 8px; background: #fff3cd; border-left: 3px solid #ffc107; border-radius: 3px;"><strong>⚠️ Coached on:</strong> ${strugglingAreas.map(a => AREA_NAMES[a] || a).join(', ')}</div>` : '<div style="margin-top: 8px; color: #28a745; font-weight: bold;">✅ Meeting all targets - No coaching needed</div>'}
            ${previousSession ? `<div style="margin-top: 8px; padding: 8px; background: #e3f2fd; border-left: 3px solid #2196F3; border-radius: 3px; font-size: 0.9em;">📈 Comparing to previous period: ${previousSession.dateRange}</div>` : ''}
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 12px;">
    `;
    
    // Display all metrics with target comparison
    const metricsList = [
        { key: 'scheduleAdherence', label: 'Schedule Adherence', unit: '%', target: TARGETS.driver.scheduleAdherence.min, isMin: true },
        { key: 'cxRepOverall', label: 'CX Rep Overall', unit: '%', target: TARGETS.driver.cxRepOverall.min, isMin: true },
        { key: 'fcr', label: 'First Call Resolution', unit: '%', target: TARGETS.driver.fcr.min, isMin: true },
        { key: 'overallExperience', label: 'Overall Experience', unit: '%', target: TARGETS.driver.overallExperience.min, isMin: true },
        { key: 'transfers', label: 'Transfers', unit: '%', target: TARGETS.driver.transfers.max, isMin: false },
        { key: 'overallSentiment', label: 'Overall Sentiment', unit: '%', target: TARGETS.driver.overallSentiment.min, isMin: true },
        { key: 'positiveWord', label: 'Positive Word', unit: '%', target: TARGETS.driver.positiveWord.min, isMin: true },
        { key: 'negativeWord', label: 'Negative Word', unit: '%', target: TARGETS.driver.negativeWord.min, isMin: true },
        { key: 'managingEmotions', label: 'Managing Emotions', unit: '%', target: TARGETS.driver.managingEmotions.min, isMin: true },
        { key: 'aht', label: 'AHT', unit: 's', target: TARGETS.driver.aht.max, isMin: false },
        { key: 'acw', label: 'ACW', unit: 's', target: TARGETS.driver.acw.max, isMin: false },
        { key: 'holdTime', label: 'Hold Time', unit: 's', target: TARGETS.driver.holdTime.max, isMin: false },
        { key: 'reliability', label: 'Reliability', unit: ' hrs', target: TARGETS.driver.reliability.max, isMin: false }
    ];
    
    metricsList.forEach(metric => {
        const value = metrics[metric.key];
        
        // Skip empty survey-based metrics
        if ((metric.key === 'fcr' || metric.key === 'cxRepOverall' || metric.key === 'overallExperience') && 
            (value === '' || value === null || value === undefined)) {
            return;
        }
        
        if (value !== undefined && value !== '' && value !== null) {
            const meetingTarget = metric.isMin ? value >= metric.target : value <= metric.target;
            const statusIcon = meetingTarget ? '✅' : '⚠️';
            const statusColor = meetingTarget ? '#28a745' : '#dc3545';
            const wasCoached = strugglingAreas.includes(metric.key);
            
            // Compare with previous period if available
            let comparisonHTML = '';
            if (previousSession && previousSession.metrics && previousSession.metrics[metric.key]) {
                const prevValue = previousSession.metrics[metric.key];
                const change = value - prevValue;
                const wasCoachedinPrevious = (previousSession.strugglingAreas || []).includes(metric.key);
                
                if (change !== 0) {
                    const isImprovement = metric.isMin ? change > 0 : change < 0;
                    const changeIcon = isImprovement ? '📈' : '📉';
                    const changeColor = isImprovement ? '#28a745' : '#dc3545';
                    const changeText = Math.abs(change).toFixed(2);
                    
                    comparisonHTML = `<div style="font-size: 0.75em; margin-top: 5px; color: ${changeColor}; font-weight: bold;">${changeIcon} ${isImprovement ? '+' : ''}${change > 0 ? '+' : ''}${changeText}${metric.unit} from last period</div>`;
                    
                    // Special highlight if this was coached and improved
                    if (wasCoachedinPrevious && isImprovement) {
                        comparisonHTML = `<div style="font-size: 0.75em; margin-top: 5px; padding: 4px; background: #d4edda; border-radius: 3px; color: #155724; font-weight: bold;">🎯 Coaching worked! +${changeText}${metric.unit}</div>`;
                    }
                }
            }
            
            const bgColor = wasCoached ? '#fff3cd' : '#f8f9fa';
            
            html += `
                <div style="padding: 12px; background: ${bgColor}; border-radius: 5px; border: 1px solid #ddd;">
                    <div style="font-size: 0.85em; color: #666; margin-bottom: 5px;">${metric.label}</div>
                    <div style="font-size: 1.4em; font-weight: bold; color: ${statusColor};">${statusIcon} ${value}${metric.unit}</div>
                    <div style="font-size: 0.8em; color: #666; margin-top: 3px;">Target: ${metric.isMin ? '≥' : '≤'}${metric.target}${metric.unit}</div>
                    ${wasCoached ? '<div style="font-size: 0.75em; color: #856404; margin-top: 3px; font-weight: bold;">📋 Coached this period</div>' : ''}
                    ${comparisonHTML}
                </div>
            `;
        }
    });
    
    html += '</div>';
    
    // Add coaching effectiveness summary if previous session exists
    if (previousSession) {
        const prevCoached = previousSession.strugglingAreas || [];
        const improved = [];
        const declined = [];
        
        prevCoached.forEach(area => {
            const currentVal = metrics[area];
            const prevVal = previousSession.metrics ? previousSession.metrics[area] : null;
            
            if (currentVal !== undefined && prevVal !== undefined && currentVal !== '' && prevVal !== '') {
                const metricDef = metricsList.find(m => m.key === area);
                if (metricDef) {
                    const change = currentVal - prevVal;
                    const isImprovement = metricDef.isMin ? change > 0 : change < 0;
                    
                    if (isImprovement) {
                        improved.push(AREA_NAMES[area] || area);
                    } else if (change < 0 && metricDef.isMin || change > 0 && !metricDef.isMin) {
                        declined.push(AREA_NAMES[area] || area);
                    }
                }
            }
        });
        
        if (improved.length > 0 || declined.length > 0) {
            html += `
                <div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px; border: 1px solid #ddd;">
                    <h4 style="color: #003DA5; margin: 0 0 10px 0;">📊 Coaching Impact Summary</h4>
            `;
            
            if (improved.length > 0) {
                html += `<div style="margin-bottom: 8px; padding: 8px; background: #d4edda; border-left: 3px solid #28a745; border-radius: 3px;">
                    <strong style="color: #155724;">✅ Improved After Coaching (${improved.length}):</strong> ${improved.join(', ')}
                </div>`;
            }
            
            if (declined.length > 0) {
                html += `<div style="padding: 8px; background: #f8d7da; border-left: 3px solid #dc3545; border-radius: 3px;">
                    <strong style="color: #721c24;">⚠️ Still Needs Work (${declined.length}):</strong> ${declined.join(', ')}
                </div>`;
            }
            
            html += '</div>';
        }
    }
    
    trendDataDisplay.innerHTML = html;
    trendDataDisplay.style.display = 'block';
}

// Filter dashboard by employee and date
function filterDashboard() {
    const selectedEmployee = document.getElementById('employeeFilter')?.value || '';
    const selectedDateRange = document.getElementById('dateFilter')?.value || '';
    const dateFilterContainer = document.getElementById('dateFilterContainer');
    
    // Show/hide date filter based on employee selection
    if (dateFilterContainer) {
        if (selectedEmployee) {
            dateFilterContainer.style.display = 'block';
        } else {
            dateFilterContainer.style.display = 'none';
            // Reset date filter when hiding
            const dateFilter = document.getElementById('dateFilter');
            if (dateFilter) dateFilter.value = '';
        }
    }
    
    const history = getAllHistory();
    
    Object.keys(history).forEach(name => {
        const uniqueId = name.replace(/\s+/g, '-');
        const employeeCard = document.getElementById(`employee-card-${uniqueId}`);
        const employeeDiv = document.getElementById(`employee-${uniqueId}`);
        
        if (!employeeCard || !employeeDiv) return;
        
        // Check employee filter
        const employeeMatches = !selectedEmployee || name === selectedEmployee;
        
        // Filter sessions by date range
        const sessionDivs = employeeDiv.querySelectorAll('[data-employee]');
        let visibleCount = 0;
        
        sessionDivs.forEach(div => {
            const sessionEmployee = div.getAttribute('data-employee');
            const sessionDateRange = div.getAttribute('data-week');
            
            const employeeFilterMatch = !selectedEmployee || sessionEmployee === selectedEmployee;
            const dateFilterMatch = !selectedDateRange || sessionDateRange === selectedDateRange;
            
            if (employeeFilterMatch && dateFilterMatch) {
                div.style.display = 'block';
                visibleCount++;
            } else {
                div.style.display = 'none';
            }
        });
        
        // Hide employee card if no sessions match or employee doesn't match filter
        if (!employeeMatches || visibleCount === 0) {
            employeeCard.style.display = 'none';
        } else {
            employeeCard.style.display = 'block';
        }
    });
}

// ========== NEW PERIOD SELECTION SYSTEM ==========

// Initialize period selector after data upload
function initializePeriodSelector() {
    // Load weekly data from localStorage
    const stored = localStorage.getItem('weeklyData');
    if (stored) {
        weeklyData = JSON.parse(stored);
    }
    
    // Set default to week view
    currentPeriodType = 'week';
    updatePeriodDropdown();
}

// Update the specific period dropdown based on selected period type
function updatePeriodDropdown() {
    const dropdown = document.getElementById('specificPeriod');
    const label = document.getElementById('specificPeriodContainer')?.querySelector('label');
    
    if (!dropdown) return;
    
    dropdown.innerHTML = '';
    
    if (currentPeriodType === 'week') {
        if (label) label.textContent = 'Select Week:';
        
        // Get all weeks sorted by date
        const weeks = Object.keys(weeklyData).sort((a, b) => {
            const dateA = new Date(a.split('|')[0]);
            const dateB = new Date(b.split('|')[0]);
            return dateB - dateA; // Most recent first
        });
        
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '-- Choose a week --';
        dropdown.appendChild(defaultOption);
        
        weeks.forEach(weekKey => {
            const week = weeklyData[weekKey];
            const option = document.createElement('option');
            option.value = weekKey;
            option.textContent = week.metadata.label;
            dropdown.appendChild(option);
        });
        
        // Auto-select most recent week
        if (weeks.length > 0) {
            dropdown.value = weeks[0];
            currentPeriod = weeks[0];
            updateEmployeeDropdown();
        }
        
    } else if (currentPeriodType === 'month') {
        if (label) label.textContent = 'Select Month:';
        
        // Group weeks by month
        const months = {};
        Object.keys(weeklyData).forEach(weekKey => {
            const startDate = new Date(weekKey.split('|')[0]);
            const monthKey = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
            const monthLabel = startDate.toLocaleDateString(undefined, { year: 'numeric', month: 'long' });
            
            if (!months[monthKey]) {
                months[monthKey] = {
                    label: monthLabel,
                    weeks: []
                };
            }
            months[monthKey].weeks.push(weekKey);
        });
        
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '-- Choose a month --';
        dropdown.appendChild(defaultOption);
        
        Object.keys(months).sort().reverse().forEach(monthKey => {
            const month = months[monthKey];
            const option = document.createElement('option');
            option.value = monthKey;
            option.textContent = month.label;
            dropdown.appendChild(option);
        });
        
        // Auto-select most recent month
        const monthKeys = Object.keys(months).sort().reverse();
        if (monthKeys.length > 0) {
            dropdown.value = monthKeys[0];
            currentPeriod = monthKeys[0];
            updateEmployeeDropdown();
        }
        
    } else if (currentPeriodType === 'quarter') {
        if (label) label.textContent = 'Select Quarter:';
        
        // Group weeks by quarter
        const quarters = {};
        Object.keys(weeklyData).forEach(weekKey => {
            const startDate = new Date(weekKey.split('|')[0]);
            const quarter = Math.floor(startDate.getMonth() / 3) + 1;
            const quarterKey = `${startDate.getFullYear()}-Q${quarter}`;
            const quarterLabel = `Q${quarter} ${startDate.getFullYear()}`;
            
            if (!quarters[quarterKey]) {
                quarters[quarterKey] = {
                    label: quarterLabel,
                    weeks: []
                };
            }
            quarters[quarterKey].weeks.push(weekKey);
        });
        
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '-- Choose a quarter --';
        dropdown.appendChild(defaultOption);
        
        Object.keys(quarters).sort().reverse().forEach(quarterKey => {
            const quarter = quarters[quarterKey];
            const option = document.createElement('option');
            option.value = quarterKey;
            option.textContent = quarter.label;
            dropdown.appendChild(option);
        });
        
        // Auto-select most recent quarter
        const quarterKeys = Object.keys(quarters).sort().reverse();
        if (quarterKeys.length > 0) {
            dropdown.value = quarterKeys[0];
            currentPeriod = quarterKeys[0];
            updateEmployeeDropdown();
        }
        
    } else if (currentPeriodType === 'ytd') {
        if (label) label.textContent = 'Year to Date:';
        dropdown.innerHTML = '';
        
        // Get all unique years
        const years = {};
        Object.keys(weeklyData).forEach(weekKey => {
            const startDate = new Date(weekKey.split('|')[0]);
            const year = startDate.getFullYear();
            if (!years[year]) {
                years[year] = {
                    label: `${year} Year to Date`,
                    weeks: []
                };
            }
            years[year].weeks.push(weekKey);
        });
        
        const defaultOption = document.createElement('option');
        defaultOption.value = '';
        defaultOption.textContent = '-- Choose a year --';
        dropdown.appendChild(defaultOption);
        
        Object.keys(years).sort().reverse().forEach(year => {
            const ytd = years[year];
            const option = document.createElement('option');
            option.value = year;
            option.textContent = ytd.label;
            dropdown.appendChild(option);
        });
        
        // Auto-select current year
        const currentYear = new Date().getFullYear();
        if (years[currentYear]) {
            dropdown.value = currentYear;
            currentPeriod = currentYear;
            updateEmployeeDropdown();
        }
    }
}

// Update employee dropdown based on selected period
function updateEmployeeDropdown() {
    const dropdown = document.getElementById('employeeSelect');
    if (!dropdown) return;
    
    console.log('==== UPDATING EMPLOYEE DROPDOWN ====');
    console.log('Current period type:', currentPeriodType);
    console.log('Current period:', currentPeriod);
    
    dropdown.innerHTML = '';
    const defaultOption = document.createElement('option');
    defaultOption.value = '';
    defaultOption.textContent = '-- Choose an employee --';
    dropdown.appendChild(defaultOption);
    
    // Get all unique employees from selected period
    const employees = new Set();
    
    if (currentPeriodType === 'week' && currentPeriod) {
        // Single week
        const week = weeklyData[currentPeriod];
        if (week && week.employees) {
            week.employees.forEach(emp => employees.add(emp.name));
        }
    } else if (currentPeriodType === 'month' && currentPeriod) {
        // All weeks in month
        Object.keys(weeklyData).forEach(weekKey => {
            const startDate = new Date(weekKey.split('|')[0]);
            const monthKey = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
            if (monthKey === currentPeriod) {
                weeklyData[weekKey].employees.forEach(emp => employees.add(emp.name));
            }
        });
    } else if (currentPeriodType === 'quarter' && currentPeriod) {
        // All weeks in quarter
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
        // All weeks in year
        Object.keys(weeklyData).forEach(weekKey => {
            const startDate = new Date(weekKey.split('|')[0]);
            if (startDate.getFullYear() === parseInt(currentPeriod)) {
                weeklyData[weekKey].employees.forEach(emp => employees.add(emp.name));
            }
        });
    }
    
    // Add employees to dropdown sorted alphabetically
    console.log('Employees found for dropdown:', Array.from(employees));
    Array.from(employees).sort().forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = name;
        dropdown.appendChild(option);
    });
}

// Get employee data for selected period
function getEmployeeDataForPeriod(employeeName) {
    if (currentPeriodType === 'week' && currentPeriod) {
        // Return data from single week
        const week = weeklyData[currentPeriod];
        if (week && week.employees) {
            return week.employees.find(emp => emp.name === employeeName);
        }
    } else if (['month', 'quarter', 'ytd'].includes(currentPeriodType) && currentPeriod) {
        // Aggregate data across multiple weeks
        const metricsToAggregate = [];
        
        Object.keys(weeklyData).forEach(weekKey => {
            const startDate = new Date(weekKey.split('|')[0]);
            let includeWeek = false;
            
            if (currentPeriodType === 'month') {
                const monthKey = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}`;
                includeWeek = (monthKey === currentPeriod);
            } else if (currentPeriodType === 'quarter') {
                const [year, q] = currentPeriod.split('-Q');
                const quarterNum = parseInt(q);
                const weekQuarter = Math.floor(startDate.getMonth() / 3) + 1;
                includeWeek = (startDate.getFullYear() === parseInt(year) && weekQuarter === quarterNum);
            } else if (currentPeriodType === 'ytd') {
                includeWeek = (startDate.getFullYear() === parseInt(currentPeriod));
            }
            
            if (includeWeek) {
                const emp = weeklyData[weekKey].employees.find(e => e.name === employeeName);
                if (emp) {
                    metricsToAggregate.push(emp);
                }
            }
        });
        
        // Calculate averages
        if (metricsToAggregate.length === 0) return null;
        
        const aggregated = {
            name: employeeName,
            surveyTotal: 0
        };
        
        const metricKeys = ['scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience', 
                          'transfers', 'aht', 'acw', 'holdTime', 'reliability',
                          'overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions'];
        
        metricKeys.forEach(key => {
            const values = metricsToAggregate
                .map(m => m[key])
                .filter(v => v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(v)))
                .map(v => parseFloat(v));
            
            if (values.length > 0) {
                const avg = values.reduce((sum, val) => sum + val, 0) / values.length;
                aggregated[key] = Math.round(avg * 100) / 100; // Round to 2 decimals
            } else {
                aggregated[key] = '';
            }
        });
        
        // Sum survey totals
        aggregated.surveyTotal = metricsToAggregate
            .map(m => m.surveyTotal || 0)
            .reduce((sum, val) => sum + val, 0);
        
        return aggregated;
    }
    
    return null;
}

// ========== END NEW PERIOD SELECTION SYSTEM ==========

// Initialize app robustly whether DOMContentLoaded has fired or not
function initApp() {
    console.log('🚀 Coaching Tool Initialized');
    
    // Restore last active section (or default to upload page)
    const lastActiveSection = localStorage.getItem('activeSection') || 'coachingForm';
    showOnlySection(lastActiveSection);
    
    // Auto-load tips from server and user storage
    (async () => {
        try {
            serverTips = await loadServerTips();
            userTips = loadUserTips();
            hiddenTips = loadHiddenTips();
            tipOrder = loadTipOrder();
            uploadHistory = loadUploadHistory();
            
            // Load weekly data from localStorage
            const stored = localStorage.getItem('weeklyData');
            if (stored) {
                weeklyData = JSON.parse(stored);
                // Initialize period selector but keep it hidden until user clicks Generate Coaching
                if (Object.keys(weeklyData).length > 0) {
                    initializePeriodSelector();
                }
            }
            
            mergeTips();
            console.log('✅ Tips loaded successfully');
        } catch (error) {
            console.warn('⚠️ Using fallback tips:', error);
        }
    })();

    // Load selected employee from quick access (OBSOLETE - keeping handler for backwards compatibility)
    document.getElementById('quickAccessLoadBtn')?.addEventListener('click', () => {
        const selectedRange = document.getElementById('quickDateRange')?.value || '';
        const selectedEmployee = document.getElementById('quickEmployee')?.value || '';
        
        if (!selectedRange || !selectedEmployee) {
            alert('Please select both a date range and employee');
            return;
        }
        
        const history = getAllHistory();
        const sessions = history[selectedEmployee] || [];
        
        if (!Array.isArray(sessions) || sessions.length === 0) {
            alert('No sessions found for this employee.');
            return;
        }
        
        const session = sessions.find(s => s && s.dateRange === selectedRange);
        
        if (!session || !session.metrics || typeof session.metrics !== 'object') {
            alert('No data found for this employee and date range.');
            return;
        }
        
        // Populate form with historical data
        const metrics = session.metrics;
        const safeEmployeeName = escapeHtml(selectedEmployee);
        document.getElementById('employeeName').value = safeEmployeeName;
        const surveyTotalValue = typeof metrics.surveyTotal === 'number' ? metrics.surveyTotal : 0;
        populateMetricInputs(metrics, surveyTotalValue);

        // Set dates with validation
        const parts = selectedRange.split(' to ');
        if (parts.length === 2 && parts[0] && parts[1]) {
            document.getElementById('startDate').value = parts[0].trim();
            document.getElementById('endDate').value = parts[1].trim();
        } else {
            console.warn('Invalid date range format:', selectedRange);
        }
        
        // Show sections
        document.getElementById('employeeInfoSection').style.display = 'block';
        document.getElementById('metricsSection').style.display = 'block';
        
        // Display YTD comparison
        displayYTDComparison(selectedEmployee, metrics);
        
        // Scroll to employee name
        document.getElementById('employeeName').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // Home button - show upload section
    document.getElementById('homeBtn')?.addEventListener('click', () => {
        showOnlySection('coachingForm');
        document.getElementById('coachingForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Generate Coaching button - show coaching section
    document.getElementById('generateCoachingBtn')?.addEventListener('click', () => {
        console.log('Generate Coaching clicked');
        const stored = localStorage.getItem('weeklyData');
        console.log('weeklyData from localStorage:', stored);
        
        if (!stored || Object.keys(JSON.parse(stored)).length === 0) {
            alert('⚠️ No data uploaded yet!\n\nPlease click "🏠 Upload Data" first to upload your weekly performance data.');
            return;
        }
        
        console.log('Showing coaching section...');
        showOnlySection('coachingSection');
        
        // Make sure period selector is visible
        const periodContainer = document.getElementById('periodSelectionContainer');
        console.log('periodSelectionContainer element:', periodContainer);
        if (periodContainer) {
            periodContainer.style.display = 'block';
            console.log('Period container display set to block');
        } else {
            console.error('periodSelectionContainer not found!');
        }
        
        // Reinitialize if needed
        console.log('weeklyData object:', weeklyData);
        if (Object.keys(weeklyData).length > 0) {
            console.log('Calling updatePeriodDropdown...');
            updatePeriodDropdown();
        } else {
            console.error('weeklyData is empty!');
        }
        
        document.getElementById('coachingSection')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Employee dashboard button
    const dashboardBtn = document.getElementById('employeeDashboard');
    console.log('Dashboard button found:', dashboardBtn);
    if (dashboardBtn) {
        dashboardBtn.addEventListener('click', (e) => {
            console.log('Dashboard button clicked');
            e.preventDefault();
            showEmployeeDashboard();
        });
    }

    // Manage Tips button
    const tipsBtn = document.getElementById('manageTips');
    console.log('Tips button found:', tipsBtn);
    if (tipsBtn) {
        tipsBtn.addEventListener('click', (e) => {
            console.log('Tips button clicked');
            e.preventDefault();
            showTipsManagement();
        });
    }

    // Close Tips Management button
    document.getElementById('closeTipsManagement')?.addEventListener('click', () => {
        showOnlySection('coachingForm');
    });

    // Executive Summary button
    document.getElementById('executiveSummaryBtn')?.addEventListener('click', () => {
        const prompt = generateExecutiveSummaryPrompt();
        document.getElementById('execSummaryPrompt').value = prompt;
        showOnlySection('executiveSummarySection');
    });

    // Copy Executive Summary prompt
    document.getElementById('copyExecSummary')?.addEventListener('click', () => {
        const prompt = document.getElementById('execSummaryPrompt').value;
        navigator.clipboard.writeText(prompt).then(() => {
            if (navigator.onLine) {
                showToast('✅ Summary copied! Opening Copilot...');
                window.open('https://copilot.microsoft.com/', '_blank');
            } else {
                showToast('✅ Summary copied! Paste in Copilot.');
            }
        }).catch(() => {
            alert('Failed to copy. Please select the text and copy manually.');
        });
    });

    // Email Executive Summary
    document.getElementById('outlookExecSummary')?.addEventListener('click', () => {
        const content = document.getElementById('generatedExecSummary')?.value.trim();
        
        if (!content) {
            alert('Please paste the generated summary from Copilot first!');
            return;
        }
        
        const subject = encodeURIComponent('Team Performance Summary - Development Coaching Tool');
        const body = encodeURIComponent(content);
        const mailtoLink = `mailto:?subject=${subject}&body=${body}`;
        
        window.location.href = mailtoLink;
    });

    // Close Executive Summary button
    document.getElementById('closeExecSummary')?.addEventListener('click', () => {
        showOnlySection('coachingForm');
    });

    // Back to Form button
    document.getElementById('backToFormBtn')?.addEventListener('click', () => {
        showOnlySection('coachingForm');
        document.getElementById('coachingForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Metric dropdown change
    document.getElementById('metricSelect')?.addEventListener('change', (e) => {
        showMetricTips(e.target.value);
    });

    // Export Tips button
    document.getElementById('exportTips')?.addEventListener('click', () => {
        autoExportTipsToExcel();
    });

    // Import Tips button
    document.getElementById('importTips')?.addEventListener('click', () => {
        document.getElementById('tipsFileInput').click();
    });

    // Enable/disable Load All Sheets button based on file selection
    document.getElementById('excelFile')?.addEventListener('change', (e) => {
        const btn = document.getElementById('loadSheetsByTabsBtn');
        if (!btn) return;
        if (e.target.files && e.target.files.length > 0) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        } else {
            btn.disabled = true;
            btn.style.opacity = '0.5';
            btn.style.cursor = 'not-allowed';
        }
    });

    // Backup/restore all app data
    document.getElementById('exportDataBtn')?.addEventListener('click', () => {
        exportComprehensiveExcel();
    });
    document.getElementById('exportDataExcelBtn')?.addEventListener('click', () => {
        exportComprehensiveExcel();
    });
    document.getElementById('importDataBtn')?.addEventListener('click', () => {
        document.getElementById('dataFileInput')?.click();
    });
    document.getElementById('dataFileInput')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            importAppData(file);
        }
        e.target.value = '';
    });

    // Handle file import
    document.getElementById('tipsFileInput')?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const importedData = JSON.parse(event.target.result);
                
                if (!importedData || typeof importedData !== 'object' || !importedData.customTips) {
                    alert('❌ Invalid tips file format. Expected JSON with customTips property.');
                    return;
                }
                
                // Merge imported tips with existing
                const confirmMerge = confirm('Do you want to MERGE these tips with your existing tips?\n\nClick OK to merge (keeps your current tips + adds new ones)\nClick Cancel to REPLACE all your tips with imported ones');
                
                if (confirmMerge) {
                    // Merge: combine both
                    Object.keys(importedData.customTips).forEach(metricKey => {
                        if (!userTips[metricKey]) {
                            userTips[metricKey] = [];
                        }
                        const tipsToAdd = importedData.customTips[metricKey];
                        if (Array.isArray(tipsToAdd)) {
                            tipsToAdd.forEach(tip => {
                                if (tip && !userTips[metricKey].includes(tip)) {
                                    userTips[metricKey].push(tip);
                                }
                            });
                        }
                    });
                } else {
                    // Replace: overwrite completely
                    userTips = {};
                    Object.keys(importedData.customTips).forEach(metricKey => {
                        const tips = importedData.customTips[metricKey];
                        if (Array.isArray(tips)) {
                            userTips[metricKey] = tips.filter(tip => tip && typeof tip === 'string');
                        }
                    });
                }
                
                saveUserTips(userTips);
                mergeTips();
                
                // Refresh current view if a metric is selected
                const currentMetric = document.getElementById('metricSelect').value;
                if (currentMetric) {
                    showMetricTips(currentMetric);
                }
                
                alert('✅ Tips imported successfully!');
            } catch (error) {
                alert('❌ Error reading tips file. Please make sure it\'s a valid JSON file.');
                console.error(error);
            }
        };
        reader.readAsText(file);
        
        // Reset input so same file can be selected again
        e.target.value = '';
    });

    // ========== UPLOAD METHOD SELECTION ==========
    
    // Show paste data container
    document.getElementById('showPasteBtn')?.addEventListener('click', () => {
        document.getElementById('uploadChoiceButtons').style.display = 'none';
        document.getElementById('pasteDataContainer').style.display = 'block';
        document.getElementById('excelUploadContainer').style.display = 'none';
    });
    
    // Show excel upload container
    document.getElementById('showExcelBtn')?.addEventListener('click', () => {
        document.getElementById('uploadChoiceButtons').style.display = 'none';
        document.getElementById('pasteDataContainer').style.display = 'none';
        document.getElementById('excelUploadContainer').style.display = 'block';
    });
    
    // Cancel paste and go back to choice
    document.getElementById('cancelPasteBtn')?.addEventListener('click', () => {
        document.getElementById('uploadChoiceButtons').style.display = 'block';
        document.getElementById('pasteDataContainer').style.display = 'none';
        document.getElementById('pasteDataTextarea').value = '';
    });
    
    // Cancel excel and go back to choice
    document.getElementById('cancelExcelBtn')?.addEventListener('click', () => {
        document.getElementById('uploadChoiceButtons').style.display = 'block';
        document.getElementById('excelUploadContainer').style.display = 'none';
        const fileInput = document.getElementById('excelFile');
        if (fileInput) fileInput.value = '';
    });

    // Close history button
    document.getElementById('closeHistory')?.addEventListener('click', () => {
        showOnlySection('coachingForm');
    });

    // Close dashboard button
    document.getElementById('closeDashboard')?.addEventListener('click', () => {
        showOnlySection('coachingForm');
    });

    // Export employee history to Excel
    document.getElementById('exportEmployeeHistoryBtn')?.addEventListener('click', () => {
        exportComprehensiveExcel();
    });

    // Back to form button
    document.getElementById('backToForm')?.addEventListener('click', () => {
        showOnlySection('coachingForm');
    });

    // Clear all history buttons (both in history and dashboard sections)
    document.getElementById('clearHistoryBtn')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all email history? This cannot be undone.')) {
            clearAllHistory();
        }
    });
    
    document.getElementById('clearDashboardHistoryBtn')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all email history? This cannot be undone.')) {
            clearAllHistory();
        }
    });

    // Clear uploaded data button
    document.getElementById('clearUploadedDataBtn')?.addEventListener('click', () => {
        if (confirm('⚠️ Are you sure you want to clear all uploaded data?\n\nThis will delete:\n• All weekly data\n• Upload history\n\nThis cannot be undone.')) {
            // Clear weeklyData
            weeklyData = {};
            localStorage.removeItem('weeklyData');
            
            // Clear upload history
            uploadHistory = [];
            saveUploadHistory(uploadHistory);
            
            // Hide success message
            const successMsg = document.getElementById('uploadSuccessMessage');
            if (successMsg) successMsg.style.display = 'none';
            
            // Hide Generate Coaching section
            const coachingSection = document.getElementById('coachingSection');
            if (coachingSection) coachingSection.style.display = 'none';
            
            // Reset form fields
            document.getElementById('pasteDataTextarea').value = '';
            document.getElementById('pasteStartDate').value = '';
            document.getElementById('pasteEndDate').value = '';
            const fileInput = document.getElementById('excelFile');
            if (fileInput) fileInput.value = '';
            
            // Reset upload choice UI
            document.getElementById('uploadChoiceButtons').style.display = 'block';
            document.getElementById('pasteDataContainer').style.display = 'none';
            document.getElementById('excelUploadContainer').style.display = 'none';
            
            alert('✅ All uploaded data has been cleared!');
        }
    });

    // Load all sheets using tab dates (Mon–Sat)
    document.getElementById('loadSheetsByTabsBtn')?.addEventListener('click', () => {
        const fileInput = document.getElementById('excelFile');
        const file = fileInput.files[0];
        if (!file) {
            alert('❌ Please select an Excel file first');
            return;
        }
        
        // Check if XLSX library is loaded
        if (typeof XLSX === 'undefined') {
            alert('❌ Excel library not loaded. Please refresh the page and try again.\n\nAlternatively, use the "Quick Paste from PowerBI" option below.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                
                console.log('Excel file loaded, sheet names:', workbook.SheetNames);

                const processSheet = (sheetName) => {
                    const sheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(sheet, { range: 0, defval: '' });
                    const employees = jsonData.map(row => {
                        const fullName = row['Name (Last, First)'] || '';
                        const firstName = fullName.includes(',') ? fullName.split(',')[1].trim() : fullName;
                        const employeeData = {
                            name: firstName,
                            scheduleAdherence: parsePercentage(row['Adherence%']),
                            cxRepOverall: parseSurveyPercentage(row['RepSat%']),
                            fcr: parseSurveyPercentage(row['FCR%']),
                            overallExperience: parseSurveyPercentage(row['OverallExperience%'] || row['Overall Experience%'] || row['OE%']),
                            transfers: parsePercentage(row['TransfersS%'] || row['TransferS%'] || row['Transfers%']),
                            aht: parseSeconds(row['AHT']),
                            acw: parseSeconds(row['ACW']),
                            holdTime: parseSeconds(row['Hold']),
                            reliability: parseHours(row['Reliability Hrs']),
                            overallSentiment: parsePercentage(row['OverallSentimentScore%']),
                            positiveWord: parsePercentage(row['PositiveWordScore%']),
                            negativeWord: parsePercentage(row['AvoidNegativeWordScore%']),
                            managingEmotions: parsePercentage(row['ManageEmotionsScore%']),
                            surveyTotal: parseInt(row['OE Survey Total']) || 0
                        };
                        if (!employeeData.surveyTotal || employeeData.surveyTotal === 0) {
                            employeeData.cxRepOverall = '';
                            employeeData.fcr = '';
                            employeeData.overallExperience = '';
                        }
                        return employeeData;
                    }).filter(emp => emp.name);
                    return employees;
                };

                const employeesBySheet = [];
                let hasGenericSheets = false;
                
                workbook.SheetNames.forEach(sn => {
                    const parsed = parseWeekFromSheetName(sn);
                    const employees = processSheet(sn);
                    
                    if (!parsed) {
                        hasGenericSheets = true;
                    }
                    
                    const start = parsed?.startDate || '';
                    const end = parsed?.endDate || '';
                    const label = parsed?.timePeriod || sn;
                    employeesBySheet.push({ 
                        name: sn, 
                        employees, 
                        start, 
                        end, 
                        label,
                        hasValidDates: !!parsed 
                    });
                });

                // Store all weeks in the new centralized structure
                weeklyData = {}; // Clear existing
                employeesBySheet.forEach(entry => {
                    if (entry.start && entry.end) {
                        const weekKey = `${entry.start}|${entry.end}`;
                        weeklyData[weekKey] = {
                            employees: entry.employees,
                            metadata: {
                                label: entry.label,
                                startDate: entry.start,
                                endDate: entry.end,
                                sheetName: entry.name,
                                timestamp: new Date().toISOString()
                            }
                        };
                    }
                });

                // Save to localStorage
                localStorage.setItem('weeklyData', JSON.stringify(weeklyData));

                // Bulk save all employees from all sheets with their respective date ranges to history
                employeesBySheet.forEach(entry => {
                    if (!entry.start || !entry.end) {
                        return;
                    }
                    
                    const dateRangeLabel = `${entry.start} to ${entry.end}`;
                    
                    entry.employees.forEach(emp => {
                        const name = emp.name || '';
                        if (!name) return;

                        // Check for duplicate sessions with same date range
                        const existingSessions = getEmployeeHistory(name);
                        const exists = (existingSessions || []).some(s => (s.dateRange || '') === dateRangeLabel);
                        
                        if (!exists) {
                            saveToHistory(name, [], emp, dateRangeLabel, false);
                        }
                    });
                    
                    const uploadRecord = {
                        id: Date.now() + Math.floor(Math.random() * 1000),
                        timePeriod: entry.label || 'Custom Upload',
                        startDate: entry.start || '',
                        endDate: entry.end || '',
                        employeeCount: entry.employees.length,
                        timestamp: new Date().toISOString(),
                        employeeMetrics: entry.employees,
                        sourceSheet: entry.name || ''
                    };
                    uploadHistory.push(uploadRecord);
                });
                
                saveUploadHistory(uploadHistory);

                // Show success message
                const successMsg = document.getElementById('uploadSuccessMessage');
                if (successMsg) {
                    successMsg.style.display = 'block';
                }

                // Initialize period selector with weeks (but keep it hidden)
                initializePeriodSelector();

                const sheetCount = employeesBySheet.length;
                const validWeeks = employeesBySheet.filter(s => s.hasValidDates).length;
                const totalEmployees = employeesBySheet.reduce((sum, s) => sum + s.employees.length, 0);
                const dateRanges = employeesBySheet.filter(s => s.hasValidDates).map(s => s.label).join(', ');
                
                let message = `✅ Loaded ${totalEmployees} employees across ${sheetCount} sheet${sheetCount>1?'s':''}!\n\n`;
                
                if (validWeeks > 0) {
                    message += `📆 Weeks loaded: ${dateRanges}\n\n`;
                }
                
                if (hasGenericSheets) {
                    message += `⚠️ Some sheets had generic names and were skipped.\n\n`;
                }
                
                message += `✓ Data saved. Use the selectors below to view employee metrics.`;
                
                alert(message);
            } catch (error) {
                console.error('Error parsing Excel:', error);
                console.error('Error stack:', error.stack);
                alert(`Error reading Excel file: ${error.message}\n\nCheck browser console (F12) for details.`);
            }
        };
        reader.readAsArrayBuffer(file);
    });

    // ========== PASTE DATA FROM POWERBI ==========
    
    document.getElementById('loadPastedDataBtn')?.addEventListener('click', () => {
        const pastedData = document.getElementById('pasteDataTextarea')?.value.trim();
        const startDate = document.getElementById('pasteStartDate')?.value;
        const endDate = document.getElementById('pasteEndDate')?.value;
        
        if (!pastedData) {
            alert('❌ Please paste data first');
            return;
        }
        
        if (!startDate || !endDate) {
            alert('❌ Please select both start and end dates');
            return;
        }
        
        try {
            // Parse pasted data (tab-separated or comma-separated)
            const lines = pastedData.split('\n').map(line => line.trim()).filter(line => line);
            
            if (lines.length < 2) {
                alert('❌ Data appears incomplete. Please paste header row and data rows.');
                return;
            }
            
            // Detect separator (tab, multiple spaces, or comma)
            let separator;
            if (lines[0].includes('\t')) {
                separator = '\t';
            } else if (/\s{2,}/.test(lines[0])) {
                // Multiple spaces (2 or more) - use regex split
                separator = /\s{2,}/;
            } else {
                separator = ',';
            }
            
            // Parse header row
            const headers = lines[0].split(separator).map(h => h.trim());
            console.log('==== HEADER DETECTION ====');
            console.log('First line (should be headers):', lines[0]);
            console.log('Detected headers:', headers);
            console.log('Separator used:', separator === '\t' ? 'TAB' : (separator instanceof RegExp ? 'MULTIPLE SPACES' : 'COMMA'));
            
            // Find column indices (case-insensitive partial matching)
            const findColumnIndex = (possibleNames) => {
                for (let name of possibleNames) {
                    const idx = headers.findIndex(h => h.toLowerCase().includes(name.toLowerCase()));
                    if (idx !== -1) return idx;
                }
                return -1;
            };
            
            const colIndices = {
                name: findColumnIndex(['Name (Last, First)', 'Name', 'Employee', 'Agent']),
                adherence: findColumnIndex(['Adherence%', 'Adherence', 'Schedule Adherence']),
                repSat: findColumnIndex(['RepSat%', 'RepSat', 'Rep Sat', 'CX Rep Overall', 'CX Rep']),
                fcr: findColumnIndex(['FCR%', 'FCR', 'First Call Resolution']),
                overallExp: findColumnIndex(['OverallExperience%', 'Overall Experience%', 'OverallExperience', 'Overall Experience', 'OE%', 'OE']),
                transfers: findColumnIndex(['TransferS%', 'Transfers%', 'Transfers', 'TransferS']),
                aht: findColumnIndex(['AHT', 'Average Handle Time']),
                acw: findColumnIndex(['ACW', 'After Call Work']),
                hold: findColumnIndex(['Hold', 'Hold Time']),
                reliability: findColumnIndex(['Reliability Hrs', 'Reliability Hours', 'Reliability']),
                sentiment: findColumnIndex(['OverallSentimentScore%', 'OverallSentiment%', 'Overall Sentiment', 'Sentiment']),
                positiveWord: findColumnIndex(['PositiveWordScore%', 'PositiveWord%', 'Positive Word', 'Positive']),
                negativeWord: findColumnIndex(['AvoidNegativeWordScore%', 'NegativeWord%', 'Avoid Negative', 'Negative']),
                emotions: findColumnIndex(['ManageEmotionsScore%', 'ManageEmotions%', 'Managing Emotions', 'Emotions']),
                surveyTotal: findColumnIndex(['OE Survey Total', 'Survey Total', 'Total Surveys'])
            };
            
            console.log('Column indices found:', colIndices);
            
            if (colIndices.name === -1) {
                console.error('Available headers:', headers);
                alert('❌ Could not find Name column.\n\nHeaders found: ' + headers.join(', ') + '\n\nPlease ensure your data includes a Name column.');
                return;
            }
            
            // Parse data rows
            const employees = [];
            for (let i = 1; i < lines.length; i++) {
                const cells = lines[i].split(separator).map(c => c.trim());
                
                if (cells.length < 2) continue; // Skip empty/invalid rows
                
                const fullName = cells[colIndices.name] || '';
                if (!fullName) continue;
                
                console.log('Processing name:', fullName); // Debug log
                
                // Extract first name (handle "Last, First" format)
                let firstName;
                if (fullName.includes(',')) {
                    // Format: "Last, First" - take the part after comma, then get FIRST WORD only
                    const parts = fullName.split(',');
                    const afterComma = parts[1].trim();
                    // Extract just the first word (in case there's extra text like "(Blank)" or numbers)
                    firstName = afterComma.split(/\s+/)[0];
                } else if (fullName.includes(' ')) {
                    // Format: "First Last" or "Last First" - take FIRST word
                    const parts = fullName.trim().split(/\s+/);
                    firstName = parts[0]; // Take first word
                } else {
                    // Single name - use as-is
                    firstName = fullName.trim();
                }
                
                console.log('Extracted first name:', firstName); // Debug log
                console.log('Creating employee with name:', firstName); // Debug log
                
                const employeeData = {
                    name: firstName,
                    scheduleAdherence: colIndices.adherence !== -1 ? parsePercentage(cells[colIndices.adherence]) : '',
                    cxRepOverall: colIndices.repSat !== -1 ? parseSurveyPercentage(cells[colIndices.repSat]) : '',
                    fcr: colIndices.fcr !== -1 ? parseSurveyPercentage(cells[colIndices.fcr]) : '',
                    overallExperience: colIndices.overallExp !== -1 ? parseSurveyPercentage(cells[colIndices.overallExp]) : '',
                    transfers: colIndices.transfers !== -1 ? parsePercentage(cells[colIndices.transfers]) : '',
                    aht: colIndices.aht !== -1 ? parseSeconds(cells[colIndices.aht]) : '',
                    acw: colIndices.acw !== -1 ? parseSeconds(cells[colIndices.acw]) : '',
                    holdTime: colIndices.hold !== -1 ? parseSeconds(cells[colIndices.hold]) : '',
                    reliability: colIndices.reliability !== -1 ? parseHours(cells[colIndices.reliability]) : 0,
                    overallSentiment: colIndices.sentiment !== -1 ? parsePercentage(cells[colIndices.sentiment]) : '',
                    positiveWord: colIndices.positiveWord !== -1 ? parsePercentage(cells[colIndices.positiveWord]) : '',
                    negativeWord: colIndices.negativeWord !== -1 ? parsePercentage(cells[colIndices.negativeWord]) : '',
                    managingEmotions: colIndices.emotions !== -1 ? parsePercentage(cells[colIndices.emotions]) : '',
                    surveyTotal: colIndices.surveyTotal !== -1 ? parseInt(cells[colIndices.surveyTotal]) || 0 : 0
                };
                
                // If no survey total, blank out survey-based metrics
                if (!employeeData.surveyTotal || employeeData.surveyTotal === 0) {
                    employeeData.cxRepOverall = '';
                    employeeData.fcr = '';
                    employeeData.overallExperience = '';
                }
                
                employees.push(employeeData);
            }
            
            if (employees.length === 0) {
                alert('❌ No valid employee data found. Please check your paste format.');
                return;
            }
            
            // Store in weekly data structure
            const weekKey = `${startDate}|${endDate}`;
            const startDateObj = new Date(startDate);
            const endDateObj = new Date(endDate);
            const label = `Week ending ${endDateObj.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
            
            weeklyData[weekKey] = {
                employees: employees,
                metadata: {
                    label: label,
                    startDate: startDate,
                    endDate: endDate,
                    sheetName: 'Pasted Data',
                    timestamp: new Date().toISOString()
                }
            };
            
            // Save to localStorage
            localStorage.setItem('weeklyData', JSON.stringify(weeklyData));
            
            // Save to history
            const dateRangeLabel = `${startDate} to ${endDate}`;
            employees.forEach(emp => {
                const existingSessions = getEmployeeHistory(emp.name);
                const exists = (existingSessions || []).some(s => (s.dateRange || '') === dateRangeLabel);
                
                if (!exists) {
                    saveToHistory(emp.name, [], emp, dateRangeLabel, false);
                }
            });
            
            // Add to upload history
            const uploadRecord = {
                id: Date.now(),
                timePeriod: label,
                startDate: startDate,
                endDate: endDate,
                employeeCount: employees.length,
                timestamp: new Date().toISOString(),
                employeeMetrics: employees,
                sourceSheet: 'Pasted Data'
            };
            uploadHistory.push(uploadRecord);
            saveUploadHistory(uploadHistory);
            
            console.log('==== POWERBI PASTE COMPLETE ====');
            console.log('Employee names stored:', employees.map(e => e.name));
            console.log('First 3 employee objects:', employees.slice(0, 3));
            
            // Show success message
            const successMsg = document.getElementById('uploadSuccessMessage');
            if (successMsg) {
                successMsg.style.display = 'block';
            }
            
            // Initialize period selector (but keep it hidden)
            initializePeriodSelector();
            
            // Clear the textarea
            document.getElementById('pasteDataTextarea').value = '';
            
            alert(`✅ Loaded ${employees.length} employees for ${label}!\n\n✓ Data saved. Use the selectors below to view employee metrics.`);
            
        } catch (error) {
            console.error('Error parsing pasted data:', error);
            alert(`❌ Error parsing data: ${error.message}\n\nPlease ensure you copied the full table with headers from PowerBI.`);
        }
    });

    // ========== EXCEL UPLOAD FUNCTIONALITY ==========
    
    let uploadedEmployeeData = [];

    function renderEmployeeDropdown(filterText = '') {
        const dropdown = document.getElementById('employeeSelect');
        if (!dropdown) return;
        const search = filterText.trim().toLowerCase();
        dropdown.innerHTML = '<option value="">-- Choose an employee --</option>';
        uploadedEmployeeData.forEach((emp, index) => {
            if (!search || emp.name.toLowerCase().includes(search)) {
                const option = document.createElement('option');
                option.value = index;
                option.textContent = emp.name;
                dropdown.appendChild(option);
            }
        });
    }

    function exportAppData() {
        try {
            const backup = {
                version: 1,
                exportedAt: new Date().toISOString(),
                coachingHistory: JSON.parse(localStorage.getItem('coachingHistory') || '{}'),
                userCustomTips: loadUserTips()
            };

            const dataStr = JSON.stringify(backup, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `coaching-backup-${new Date().toISOString().split('T')[0]}.json`;
            link.click();
            URL.revokeObjectURL(url);
            alert('✅ Backup created. Save the JSON file safely.');
        } catch (e) {
            console.error('Backup failed', e);
            alert('❌ Backup failed. See console for details.');
        }
    }

    function importAppData(file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const data = JSON.parse(event.target.result);
                if (!data || typeof data !== 'object') {
                    alert('❌ Invalid backup file.');
                    return;
                }

                const incomingHistory = data.coachingHistory || {};
                const incomingTips = data.userCustomTips || {};
                const merge = confirm('Merge with existing data?\nOK = Merge, Cancel = Replace.');

                let finalHistory = {};
                if (merge) {
                    const existingHistory = getAllHistory();
                    finalHistory = { ...existingHistory };
                    Object.entries(incomingHistory).forEach(([name, sessions]) => {
                        if (!Array.isArray(sessions)) return;
                        const current = finalHistory[name] || [];
                        const combined = [...current];
                        sessions.forEach(s => {
                            const key = `${s.dateRange || ''}|${s.date || ''}`;
                            const exists = combined.some(cs => `${cs.dateRange || ''}|${cs.date || ''}` === key);
                            if (!exists) combined.push(s);
                        });
                        finalHistory[name] = combined;
                    });
                } else {
                    finalHistory = incomingHistory;
                }

                localStorage.setItem('coachingHistory', JSON.stringify(finalHistory));
                userTips = incomingTips || {};
                saveUserTips(userTips);
                mergeTips();
                if (typeof initializeQuickAccess === 'function') {
                    initializeQuickAccess();
                }
                alert('✅ Data restored successfully.');
            } catch (e) {
                console.error('Import failed', e);
                alert('❌ Could not import backup. Make sure it is a valid JSON export.');
            }
        };
        reader.readAsText(file);
    }

    // Make entire date input field clickable to open calendar
    document.getElementById('startDate')?.addEventListener('click', function() {
        this.showPicker();
    });
    
    document.getElementById('endDate')?.addEventListener('click', function() {
        this.showPicker();
    });

    // Validate date range and enable/disable Load Data button
    function validateDateRange() {
        const startDate = document.getElementById('startDate')?.value || '';
        const endDate = document.getElementById('endDate')?.value || '';
        const loadBtn = document.getElementById('loadDataBtn');
        const validationMsg = document.getElementById('dateValidationMsg');
        const fileInput = document.getElementById('excelFile');
        
        if (!loadBtn) return;
        
        const hasFile = fileInput?.files && fileInput.files.length > 0;
        
        // Default to disabled state
        loadBtn.disabled = true;
        loadBtn.style.background = '#ccc';
        loadBtn.style.opacity = '0.5';
        loadBtn.style.cursor = 'not-allowed';
        
        if (!hasFile) {
            if (validationMsg) {
                validationMsg.textContent = '⚠️ Please select a file first';
                validationMsg.style.display = 'block';
            }
            return;
        }
        
        if (!startDate || !endDate) {
            if (validationMsg) {
                validationMsg.textContent = '⚠️ Please enter both Start and End dates to load data';
                validationMsg.style.display = 'block';
            }
            return;
        }
        
        // Check if end date is after start date
        if (new Date(endDate) < new Date(startDate)) {
            if (validationMsg) {
                validationMsg.textContent = '⚠️ End date must be after or equal to start date';
                validationMsg.style.display = 'block';
            }
            return;
        }
        
        // All validation passed - enable button
        loadBtn.disabled = false;
        loadBtn.style.background = 'linear-gradient(135deg, #2196F3 0%, #1976D2 100%)';
        loadBtn.style.opacity = '1';
        loadBtn.style.cursor = 'pointer';
        if (validationMsg) {
            validationMsg.textContent = '✅ Ready to load data';
            validationMsg.style.color = '#28a745';
            validationMsg.style.display = 'block';
        }
    }

    // Add listeners to date inputs
    document.getElementById('startDate')?.addEventListener('change', validateDateRange);
    document.getElementById('startDate')?.addEventListener('input', validateDateRange);
    document.getElementById('endDate')?.addEventListener('change', validateDateRange);
    document.getElementById('endDate')?.addEventListener('input', validateDateRange);

    document.getElementById('employeeSearch')?.addEventListener('input', (e) => {
        // Filter the employee dropdown based on search text
        const search = e.target.value.trim().toLowerCase();
        const dropdown = document.getElementById('employeeSelect');
        if (!dropdown) return;
        
        // Get all options except the default one
        const options = Array.from(dropdown.querySelectorAll('option'));
        options.forEach(option => {
            if (option.value === '') return; // Keep the default option
            const name = option.textContent.toLowerCase();
            option.style.display = (!search || name.includes(search)) ? '' : 'none';
        });
    });

    // ========== NEW PERIOD SELECTION EVENT LISTENERS ==========
    
    // Period type buttons (Week / Month / Quarter / YTD)
    document.querySelectorAll('.period-type-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const selectedType = e.target.getAttribute('data-period');
            if (!selectedType) return;
            
            // Update active button styling
            document.querySelectorAll('.period-type-btn').forEach(b => {
                b.style.background = 'white';
                b.style.color = '#666';
                b.style.borderColor = '#ddd';
            });
            e.target.style.background = '#2196F3';
            e.target.style.color = 'white';
            e.target.style.borderColor = '#2196F3';
            
            // Update period type and refresh dropdown
            currentPeriodType = selectedType;
            updatePeriodDropdown();
        });
    });
    
    // Specific period dropdown (week/month/quarter/year selection)
    document.getElementById('specificPeriod')?.addEventListener('change', (e) => {
        currentPeriod = e.target.value;
        updateEmployeeDropdown();
        
        // Clear employee selection
        const empSelect = document.getElementById('employeeSelect');
        if (empSelect) empSelect.value = '';
        
        // Hide employee info sections
        const employeeInfoSection = document.getElementById('employeeInfoSection');
        const metricsSection = document.getElementById('metricsSection');
        if (employeeInfoSection) employeeInfoSection.style.display = 'none';
        if (metricsSection) metricsSection.style.display = 'none';
    });
    
    // ========== END NEW PERIOD SELECTION EVENT LISTENERS ==========

    // Composite score UI removed per request

    // Initialize button state on page load with error handling
    setTimeout(() => {
        try {
            validateDateRange();
        } catch (e) {
            console.warn('Error validating date range during init:', e);
        }
    }, 150);

    // Load and parse Excel file (supports auto-detecting week ranges from sheet tabs)
    document.getElementById('loadDataBtn')?.addEventListener('click', () => {
        const fileInput = document.getElementById('excelFile');
        const file = fileInput.files[0];
        const startDateInput = document.getElementById('startDate')?.value || '';
        const endDateInput = document.getElementById('endDate')?.value || '';

        if (!file) {
            alert('❌ Please select an Excel file first');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });

                const processSheet = (sheetName) => {
                    const sheet = workbook.Sheets[sheetName];
                    const jsonData = XLSX.utils.sheet_to_json(sheet, { range: 0, defval: '' });

                    const employees = jsonData.map(row => {
                        const fullName = row['Name (Last, First)'] || '';
                        const firstName = fullName.includes(',') ? fullName.split(',')[1].trim() : fullName;
                        const employeeData = {
                            name: firstName,
                            scheduleAdherence: parsePercentage(row['Adherence%']),
                            cxRepOverall: parseSurveyPercentage(row['RepSat%']),
                            fcr: parseSurveyPercentage(row['FCR%']),
                            overallExperience: parseSurveyPercentage(row['OverallExperience%'] || row['Overall Experience%'] || row['OE%']),
                            transfers: parsePercentage(row['TransfersS%'] || row['TransferS%'] || row['Transfers%']),
                            aht: parseSeconds(row['AHT']),
                            acw: parseSeconds(row['ACW']),
                            holdTime: parseSeconds(row['Hold']),
                            reliability: parseHours(row['Reliability Hrs']),
                            overallSentiment: parsePercentage(row['OverallSentimentScore%']),
                            positiveWord: parsePercentage(row['PositiveWordScore%']),
                            negativeWord: parsePercentage(row['AvoidNegativeWordScore%']),
                            managingEmotions: parsePercentage(row['ManageEmotionsScore%']),
                            surveyTotal: parseInt(row['OE Survey Total']) || 0
                        };

                        if (!employeeData.surveyTotal || employeeData.surveyTotal === 0) {
                            employeeData.cxRepOverall = '';
                            employeeData.fcr = '';
                            employeeData.overallExperience = '';
                        }
                        return employeeData;
                    }).filter(emp => emp.name);

                    return employees;
                };

                let usedStart = startDateInput;
                let usedEnd = endDateInput;
                let timeLabel = null;

                // If dates were provided by the user, process only the first sheet with those dates
                // Otherwise, auto-detect week ranges from sheet names and record each sheet separately
                const employeesBySheet = [];

                if (usedStart && usedEnd) {
                    if (new Date(usedEnd) < new Date(usedStart)) {
                        alert('❌ End date must be after or equal to start date.');
                        document.getElementById('endDate')?.focus();
                        return;
                    }
                    const firstName = workbook.SheetNames[0];
                    const employees = processSheet(firstName);
                    employeesBySheet.push({ name: firstName, employees, start: usedStart, end: usedEnd, label: detectTimePeriod(usedStart, usedEnd) });
                } else {
                    // Auto-detect per sheet via tab name
                    workbook.SheetNames.forEach(sn => {
                        const parsed = parseWeekFromSheetName(sn);
                        const employees = processSheet(sn);
                        const start = parsed?.startDate || '';
                        const end = parsed?.endDate || '';
                        const label = parsed?.timePeriod || sn;
                        employeesBySheet.push({ name: sn, employees, start, end, label });
                    });
                }

                // Use the last sheet as the current in-page dataset
                const last = employeesBySheet[employeesBySheet.length - 1];
                uploadedEmployeeData = last?.employees || [];

                // Populate dropdown/UI
                const searchValue = document.getElementById('employeeSearch')?.value || '';
                renderEmployeeDropdown(searchValue);
                document.getElementById('employeeSelectContainer').style.display = 'block';
                document.getElementById('dateRangeInputContainer').style.display = 'block';

                // Immediately save all employees to history (merge into local storage per sheet)
                bulkSaveUploadedEmployees();

                // Record each sheet as its own upload entry
                employeesBySheet.forEach(entry => {
                    const timePeriod = entry.label || 'Custom Upload';
                    const uploadRecord = {
                        id: Date.now() + Math.floor(Math.random() * 1000),
                        timePeriod,
                        startDate: entry.start || '',
                        endDate: entry.end || '',
                        employeeCount: entry.employees.length,
                        timestamp: new Date().toISOString(),
                        employeeMetrics: entry.employees,
                        sourceSheet: entry.name || ''
                    };
                    uploadHistory.push(uploadRecord);
                });
                saveUploadHistory(uploadHistory);

                const sheetCount = employeesBySheet.length;
                const totalEmployees = employeesBySheet.reduce((sum, s) => sum + s.employees.length, 0);
                alert(`✅ Loaded ${totalEmployees} employees across ${sheetCount} sheet${sheetCount>1?'s':''}!\n\n📊 Data saved to Employee History.\n\nWeeks recorded using tab names (Mon–Sat).`);

            } catch (error) {
                console.error('Error parsing Excel:', error);
                alert('Error reading Excel file. Please make sure it is formatted correctly.');
            }
        };

        reader.readAsArrayBuffer(file);
    });

    // Auto-populate form when employee selected
    document.getElementById('employeeSelect')?.addEventListener('change', (e) => {
        const selectedName = e.target.value;
        
        if (!selectedName) {
            // Hide sections if no employee selected
            const metricsSection = document.getElementById('metricsSection');
            const employeeInfoSection = document.getElementById('employeeInfoSection');
            const customNotesSection = document.getElementById('customNotesSection');
            const generateBtn = document.getElementById('generateEmailBtn');
            if (metricsSection) metricsSection.style.display = 'none';
            if (employeeInfoSection) employeeInfoSection.style.display = 'none';
            if (customNotesSection) customNotesSection.style.display = 'none';
            if (generateBtn) generateBtn.style.display = 'none';
            return;
        }
        
        // Get employee data for the selected period
        const employee = getEmployeeDataForPeriod(selectedName);
        if (!employee) {
            alert('Error: Could not load employee data for selected period.');
            return;
        }
        
        // Show employee info and metrics sections
        const employeeInfoSection = document.getElementById('employeeInfoSection');
        const metricsSection = document.getElementById('metricsSection');
        const customNotesSection = document.getElementById('customNotesSection');
        const generateBtn = document.getElementById('generateEmailBtn');
        if (employeeInfoSection) employeeInfoSection.style.display = 'block';
        if (metricsSection) metricsSection.style.display = 'block';
        if (customNotesSection) customNotesSection.style.display = 'block';
        if (generateBtn) generateBtn.style.display = 'inline-block';
        
        // Populate all form fields
        document.getElementById('employeeName').value = employee.name || '';
        populateMetricInputs(employee, employee.surveyTotal ?? 0);
        
        // Calculate and display YTD comparison
        displayYTDComparison(employee.name, employee);
        
        // Update survey status message
        const surveyStatusEl = document.getElementById('surveyStatusMsg');
        if (surveyStatusEl) {
            const hasSurveys = (employee.surveyTotal || 0) > 0;
            if (!hasSurveys) {
                surveyStatusEl.textContent = 'No surveys in this period; survey-based metrics are omitted.';
            } else {
                surveyStatusEl.textContent = '';
            }
        }
        
        // Scroll to form
        document.getElementById('employeeName').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // When a past date range is selected, populate start/end dates
    document.getElementById('pastDateRanges')?.addEventListener('change', (e) => {
        const range = e.target.value;
        if (!range) return;
        const parts = range.split(' to ');
        if (parts.length === 2) {
            const [start, end] = parts;
            const startInput = document.getElementById('startDate');
            const endInput = document.getElementById('endDate');
            if (startInput && endInput) {
                startInput.value = start;
                endInput.value = end;
                // Ensure container is visible and validation reflects new values
                const container = document.getElementById('dateRangeInputContainer');
                if (container) container.style.display = 'block';
                // Re-validate to enable Load Data
                try { validateDateRange(); } catch {}
            }
        }
    });

    // Highlight metric inputs based on targets
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
            if (!el) return;

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

    // Populate metrics, blank survey fields when no surveys, then apply highlights
    function populateMetricInputs(metrics = {}, surveyTotal = 0) {
        const hasSurveys = Number(surveyTotal) > 0;
        const setVal = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.value = value;
        };

        setVal('surveyTotal', hasSurveys ? surveyTotal : '');
        setVal('scheduleAdherence', metrics.scheduleAdherence ?? '');
        setVal('cxRepOverall', hasSurveys ? (metrics.cxRepOverall ?? '') : '');
        setVal('fcr', hasSurveys ? (metrics.fcr ?? '') : '');
        setVal('overallExperience', hasSurveys ? (metrics.overallExperience ?? '') : '');
        setVal('transfers', metrics.transfers ?? '');
        setVal('aht', metrics.aht ?? '');
        setVal('acw', metrics.acw ?? '');
        setVal('holdTime', metrics.holdTime ?? '');
        setVal('reliability', metrics.reliability ?? '');
        setVal('overallSentiment', metrics.overallSentiment ?? '');
        setVal('positiveWord', metrics.positiveWord ?? '');
        setVal('negativeWord', metrics.negativeWord ?? '');
        setVal('managingEmotions', metrics.managingEmotions ?? '');

        applyMetricHighlights();
    }

    // Recalculate highlights when user edits metrics manually
    ['scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience', 'transfers', 'aht', 'acw', 'holdTime', 'reliability', 'overallSentiment', 'positiveWord', 'negativeWord', 'managingEmotions'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', applyMetricHighlights);
        }
    });

    // Calculate and display YTD comparison
    function displayYTDComparison(employeeName, currentMetrics) {
        const ytdContainer = document.getElementById('ytdComparison');
        if (!ytdContainer) return;
        
        const history = getAllHistory();
        const employeeSessions = history[employeeName] || [];
        
        if (employeeSessions.length === 0) {
            ytdContainer.style.display = 'none';
            return;
        }
        
        // Calculate YTD averages
        const metricSums = {};
        const metricCounts = {};
        
        employeeSessions.forEach(session => {
            if (!session.metrics) return;
            
            Object.keys(session.metrics).forEach(key => {
                const value = session.metrics[key];
                if (value !== '' && value !== null && value !== undefined) {
                    if (!metricSums[key]) {
                        metricSums[key] = 0;
                        metricCounts[key] = 0;
                    }
                    metricSums[key] += parseFloat(value);
                    metricCounts[key]++;
                }
            });
        });
        
        const ytdAverages = {};
        Object.keys(metricSums).forEach(key => {
            ytdAverages[key] = metricSums[key] / metricCounts[key];
        });
        
        // Compare current to YTD
        const comparisons = [];
        const metricDefs = [
            { key: 'scheduleAdherence', name: 'Schedule Adherence', unit: '%', isMin: true },
            { key: 'transfers', name: 'Transfers', unit: '%', isMin: false },
            { key: 'overallSentiment', name: 'Overall Sentiment', unit: '%', isMin: true },
            { key: 'aht', name: 'AHT', unit: 's', isMin: false },
            { key: 'acw', name: 'ACW', unit: 's', isMin: false }
        ];
        
        metricDefs.forEach(metric => {
            const currentValue = currentMetrics[metric.key];
            const ytdValue = ytdAverages[metric.key];
            
            if (currentValue !== undefined && currentValue !== '' && ytdValue !== undefined) {
                const diff = currentValue - ytdValue;
                const isBetter = metric.isMin ? diff > 0 : diff < 0;
                
                if (Math.abs(diff) > 0.01) {
                    comparisons.push({
                        name: metric.name,
                        current: currentValue,
                        ytd: ytdValue.toFixed(2),
                        diff: diff.toFixed(2),
                        unit: metric.unit,
                        isBetter: isBetter
                    });
                }
            }
        });
        
        if (comparisons.length === 0) {
            ytdContainer.style.display = 'none';
            return;
        }
        
        // Display comparison
        let html = `
            <strong style="color: #003DA5;">📊 YTD Performance vs This Report (${employeeSessions.length} period${employeeSessions.length > 1 ? 's' : ''} tracked):</strong>
            <div style="margin-top: 8px; display: flex; flex-wrap: wrap; gap: 8px;">
        `;
        
        comparisons.forEach(comp => {
            const icon = comp.isBetter ? '⬆️' : '⬇️';
            const color = comp.isBetter ? '#28a745' : '#dc3545';
            const sign = comp.diff > 0 ? '+' : '';
            
            html += `
                <span style="display: inline-block; padding: 5px 10px; background: white; border-radius: 4px; border: 1px solid ${color}; font-size: 0.85em;">
                    <strong style="color: ${color};">${icon} ${comp.name}:</strong> 
                    ${comp.current}${comp.unit} 
                    <span style="color: #666;">(YTD avg: ${comp.ytd}${comp.unit}, ${sign}${comp.diff}${comp.unit})</span>
                </span>
            `;
        });
        
        html += '</div>';
        ytdContainer.innerHTML = html;
        ytdContainer.style.display = 'block';
    }

    // Bulk-save all uploaded employees into history immediately after load
    function bulkSaveUploadedEmployees() {
        try {
            if (!uploadedEmployeeData || uploadedEmployeeData.length === 0) {
                console.log('No employee data to save');
                return;
            }
            
            const startDate = document.getElementById('startDate')?.value || '';
            const endDate = document.getElementById('endDate')?.value || '';
            const dateRangeLabel = startDate && endDate ? `${startDate} to ${endDate}` : '';
            
            if (!dateRangeLabel) {
                console.warn('No date range available for saving');
                return;
            }
            
            let savedCount = 0;
            let skippedCount = 0;

            uploadedEmployeeData.forEach(emp => {
                const name = emp.name || '';
                if (!name) {
                    console.log('Skipping employee with no name');
                    return;
                }

                // Check for duplicate sessions with same date range
                const existingSessions = getEmployeeHistory(name);
                const exists = (existingSessions || []).some(s => (s.dateRange || '') === dateRangeLabel);
                
                if (exists) {
                    console.log(`Skipping ${name} - already has data for ${dateRangeLabel}`);
                    skippedCount++;
                    return;
                }

                const metrics = {
                    scheduleAdherence: emp.scheduleAdherence,
                    cxRepOverall: emp.cxRepOverall ?? '',
                    fcr: emp.fcr ?? '',
                    overallExperience: emp.overallExperience ?? '',
                    transfers: emp.transfers,
                    overallSentiment: emp.overallSentiment,
                    positiveWord: emp.positiveWord,
                    negativeWord: emp.negativeWord,
                    managingEmotions: emp.managingEmotions,
                    aht: emp.aht,
                    acw: emp.acw,
                    holdTime: emp.holdTime,
                    reliability: emp.reliability,
                    surveyTotal: emp.surveyTotal ?? 0
                };

                // Identify struggling areas for this employee
                const strugglingAreas = identifyStrugglingAreas(metrics);
                
                // Save to history
                saveToHistory(name, strugglingAreas, metrics, dateRangeLabel);
                savedCount++;
                console.log(`Saved ${name} for ${dateRangeLabel}`);
            });
            
            console.log(`Bulk save complete: ${savedCount} saved, ${skippedCount} skipped (duplicates)`);
        } catch (e) {
            console.error('Bulk save failed:', e);
        }
    }


    // Update currentEmailData when user pastes generated email
    document.getElementById('generatedEmail')?.addEventListener('input', (e) => {
        const content = e.target.value.trim();
        const employeeName = document.getElementById('resultName').textContent;
        
        if (content && employeeName) {
            window.currentEmailData = {
                name: employeeName,
                content: content
            };
        }
    });

    // Outlook button
    document.getElementById('outlookEmail')?.addEventListener('click', () => {
        const content = document.getElementById('generatedEmail')?.value.trim();
        const employeeName = document.getElementById('resultName').textContent;
        
        if (!content) {
            alert('Please paste the generated email from Copilot first!');
            return;
        }
        
        if (!employeeName) {
            alert('Employee name not found!');
            return;
        }
        
        const emailData = generateEmailContent(employeeName, content);
        
        // Don't encode the email address in 'to' field
        const subject = encodeURIComponent(emailData.subject);
        const body = encodeURIComponent(emailData.body);
        const mailtoLink = `mailto:${emailData.to}?subject=${subject}&body=${body}`;
        
        window.location.href = mailtoLink;
    });

    // Copy prompt button - also auto-opens Copilot
    document.getElementById('copyPrompt')?.addEventListener('click', () => {
        const prompt = document.getElementById('aiPrompt').value;
        navigator.clipboard.writeText(prompt).then(() => {
            if (navigator.onLine) {
                alert('✅ Prompt copied!\n\nOpening Copilot - paste it there.');
                window.open('https://copilot.microsoft.com/', '_blank');
            } else {
                alert('✅ Prompt copied!\n\nOffline mode: Copilot won\'t open. Paste the prompt wherever you prefer.');
            }
        }).catch(() => {
            alert('Failed to copy. Please select the text and copy manually.');
        });
    });

    document.getElementById('exportPdfBtn')?.addEventListener('click', () => {
        exportToPDF();
    });

    // New email button
    document.getElementById('newCoaching')?.addEventListener('click', () => {
        showOnlySection('coachingForm');
        document.getElementById('generatedEmail').value = '';
        document.getElementById('coachingForm').reset();
    });

    // Form submission - Open Copilot with full email generation prompt
    document.getElementById('coachingFormInternal')?.addEventListener('submit', async (e) => {
        e.preventDefault();

        const employeeName = document.getElementById('employeeName').value;

        if (!employeeName) {
            alert('Please fill in employee name');
            return;
        }

        const surveyTotalInput = parseInt(document.getElementById('surveyTotal').value, 10) || 0;
        const hasSurveys = surveyTotalInput > 0;

        const metrics = {
            scheduleAdherence: parseFloat(document.getElementById('scheduleAdherence').value) || 0,
            cxRepOverall: hasSurveys && document.getElementById('cxRepOverall').value.trim() ? parseFloat(document.getElementById('cxRepOverall').value) : '',
            fcr: hasSurveys && document.getElementById('fcr').value.trim() ? parseFloat(document.getElementById('fcr').value) : '',
            overallExperience: hasSurveys && document.getElementById('overallExperience').value.trim() ? parseFloat(document.getElementById('overallExperience').value) : '',
            transfers: parseFloat(document.getElementById('transfers').value) || 0,
            overallSentiment: parseFloat(document.getElementById('overallSentiment').value) || 0,
            positiveWord: parseFloat(document.getElementById('positiveWord').value) || 0,
            negativeWord: parseFloat(document.getElementById('negativeWord').value) || 0,
            managingEmotions: parseFloat(document.getElementById('managingEmotions').value) || 0,
            aht: parseFloat(document.getElementById('aht').value) || 0,
            acw: parseFloat(document.getElementById('acw').value) || 0,
            holdTime: parseFloat(document.getElementById('holdTime').value) || 0,
            reliability: parseFloat(document.getElementById('reliability').value) || 0,
            surveyTotal: surveyTotalInput
        };

        const strugglingAreas = identifyStrugglingAreas(metrics);
        
        // Check coaching history for this employee
        const history = getEmployeeHistory(employeeName);
        const isRepeatCoaching = history.length > 0;
        
        // Count how many times each area has been coached
        const areaCounts = {};
        history.forEach(entry => {
            if (entry.strugglingAreas) {
                entry.strugglingAreas.forEach(area => {
                    areaCounts[area] = (areaCounts[area] || 0) + 1;
                });
            }
        });
        
        // Identify wins (metrics exceeding targets)
        const wins = [];
        if (metrics.scheduleAdherence >= TARGETS.driver.scheduleAdherence.min) {
            wins.push(`Schedule Adherence: ${metrics.scheduleAdherence}% (Target: ${TARGETS.driver.scheduleAdherence.min}%)`);
        }
        // Only include survey-based metrics if they have values
        if (metrics.cxRepOverall && metrics.cxRepOverall >= TARGETS.driver.cxRepOverall.min) {
            wins.push(`Customer Experience: ${metrics.cxRepOverall}% (Target: ${TARGETS.driver.cxRepOverall.min}%)`);
        }
        if (metrics.fcr && metrics.fcr >= TARGETS.driver.fcr.min) {
            wins.push(`FCR: ${metrics.fcr}% (Target: ${TARGETS.driver.fcr.min}%)`);
        }
        if (metrics.overallExperience && metrics.overallExperience >= TARGETS.driver.overallExperience.min) {
            wins.push(`Overall Experience: ${metrics.overallExperience}% (Target: ${TARGETS.driver.overallExperience.min}%)`);
        }
        if (metrics.overallSentiment >= TARGETS.driver.overallSentiment.min) {
            wins.push(`Overall Sentiment: ${metrics.overallSentiment}% (Target: ${TARGETS.driver.overallSentiment.min}%)`);
        }
        if (metrics.managingEmotions >= TARGETS.driver.managingEmotions.min) {
            wins.push(`Managing Emotions: ${metrics.managingEmotions}% (Target: ${TARGETS.driver.managingEmotions.min}%)`);
        }
        if (metrics.transfers <= TARGETS.driver.transfers.max) {
            wins.push(`Transfers: ${metrics.transfers}% (Target: <${TARGETS.driver.transfers.max}%)`);
        }
        if (metrics.aht <= TARGETS.driver.aht.max) {
            wins.push(`AHT: ${metrics.aht} seconds (Target: <${TARGETS.driver.aht.max} seconds)`);
        }
        
        // Build comprehensive Copilot prompt
        const openerOptions = [
            `Hey ${employeeName}! Quick snapshot on how things are trending so we can celebrate wins and line up next steps.`,
            `Hey ${employeeName}! Here's a quick look at your recent performance so we can keep what works and tune the rest.`,
            `Hey ${employeeName}! Fast pulse check on your latest metrics so we can celebrate and sharpen where needed.`,
            `Hey ${employeeName}! Quick rundown of what's landing well and what we should focus on next.`,
            `Hey ${employeeName}! Short update on your recent results to highlight wins and pick a couple priorities.`,
            `Hey ${employeeName}! Quick vibe check on your recent results so we can keep momentum and tighten a couple areas.`,
            `Hey ${employeeName}! Quick look at what is working and what to fine-tune this week.`,
            `Hey ${employeeName}! Quick pulse on your week so we can high-five the wins and pick two focus points.`
        ];
        const casualPhraseSets = [
            ['I noticed', 'By the way', 'Quick thing', 'Real talk'],
            ['Heads up', 'Quick heads up', 'I spotted', 'Worth noting'],
            ['I saw', 'Side note', 'One callout', 'Real quick'],
            ['Noticed this', 'Flagging this', 'Quick flag', 'One thing I liked']
        ];
        const transitionSets = [
            ['Here is the thing', 'Also', 'One more thing', 'Meanwhile'],
            ['So', 'Plus', 'And hey', 'Another quick one'],
            ['Also worth noting', 'On that note', 'Real quick', 'Next up'],
            ['Here is what I saw', 'Also saw', 'And', 'Last quick note']
        ];
        const styleGuidanceOptions = [
            'Sound like a human coworker. Use contractions, vary sentence length, mix short and medium lines. No em dashes; use commas, periods, or regular hyphens instead.',
            'Keep it breezy and specific. Contractions are good, sentences can start with And/But. Avoid em dashes; stick to commas, periods, or regular hyphens.',
            'Use casual, direct language with contractions. Vary rhythm with short and medium sentences. Skip em dashes; use commas, periods, or regular hyphens.',
            'Friendly, clear, and concise. Contractions welcome. Mix sentence lengths. Avoid em dashes; choose commas, periods, or regular hyphens.'
        ];
        const opener = openerOptions[Math.floor(Math.random() * openerOptions.length)];
        const casualPhrases = casualPhraseSets[Math.floor(Math.random() * casualPhraseSets.length)];
        const transitions = transitionSets[Math.floor(Math.random() * transitionSets.length)];
        const styleGuidance = styleGuidanceOptions[Math.floor(Math.random() * styleGuidanceOptions.length)];
        
        let prompt = `Write a friendly coaching email to ${employeeName} (CSR), 180–220 words. ${styleGuidance} Include a couple casual phrases (e.g., ${casualPhrases.join(', ')}), and vary transitions (e.g., ${transitions.join(', ')}). Be specific without sounding robotic. Start with this opener: "${opener}". Briefly set context, then list wins and improvements.\n\n`;
        if (!hasSurveys) {
            prompt += `Note: No customer surveys in the selected date range, so survey-based metrics (CX Rep Overall, FCR, Overall Experience) are omitted.\n\n`;
        }

        // Add wins if any
        if (wins.length > 0) {
            prompt += `WINS: ${wins.join(', ')}\n\n`;
        }

        if (strugglingAreas.length === 0) {
            prompt += `All targets met! Congratulate them.`;
        } else {
            // Build metrics list
            const detailedStruggles = [];
            strugglingAreas.forEach(area => {
                const readable = AREA_NAMES[area] || area;
                let current, target, unit = '%';
                
                if (area === 'scheduleAdherence') { current = metrics.scheduleAdherence; target = TARGETS.driver.scheduleAdherence.min; }
                else if (area === 'cxRepOverall') { current = metrics.cxRepOverall; target = TARGETS.driver.cxRepOverall.min; }
                else if (area === 'fcr') { current = metrics.fcr; target = TARGETS.driver.fcr.min; }
                else if (area === 'transfers') { current = metrics.transfers; target = TARGETS.driver.transfers.max; }
                else if (area === 'overallSentiment') { current = metrics.overallSentiment; target = TARGETS.driver.overallSentiment.min; }
                else if (area === 'positiveWord') { current = metrics.positiveWord; target = TARGETS.driver.positiveWord.min; }
                else if (area === 'negativeWord') { current = metrics.negativeWord; target = TARGETS.driver.negativeWord.min; }
                else if (area === 'managingEmotions') { current = metrics.managingEmotions; target = TARGETS.driver.managingEmotions.min; }
                else if (area === 'aht') { current = metrics.aht; target = TARGETS.driver.aht.max; unit = ' sec'; }
                else if (area === 'acw') { current = metrics.acw; target = TARGETS.driver.acw.max; unit = ' sec'; }
                else if (area === 'holdTime') { current = metrics.holdTime; target = TARGETS.driver.holdTime.max; unit = ' sec'; }
                else if (area === 'reliability') { current = metrics.reliability; target = TARGETS.driver.reliability.max; unit = ' hrs'; }
                
                if (current !== undefined && target !== undefined) {
                    detailedStruggles.push(`${readable}: ${current}${unit} (need: ${target}${unit})`);
                }
            });
            
            const hasReliabilityIssue = strugglingAreas.includes('reliability');
            const isRepeat = isRepeatCoaching && strugglingAreas.some(area => areaCounts[area] > 0);
            
            if (isRepeat) {
                prompt += `REPEAT COACHING - Use NEW wording, different examples, fresh approach. Don't repeat previous phrases:\n`;
            } else {
                prompt += `IMPROVE:\n`;
            }
            
            detailedStruggles.forEach(s => prompt += `• ${s}\n`);
            
            prompt += `\nTIPS (bullet format):\n`;
            strugglingAreas.forEach(area => {
                prompt += `• ${AREA_NAMES[area]}: ${getRandomTip(area)}\n`;
            });
            
            if (hasReliabilityIssue && metrics.reliability >= 16) {
                prompt += `\n(PTOST procedures required - code time in Verint)`;
            }
            
            prompt += `\n\nFORMATTING: Bold only the metric name at the start of each tip (e.g., **Schedule Adherence:** then normal text). Vary phrasing and avoid repeating the same structure. Give concrete, real-world examples. For word choice tips, suggest concise swaps (e.g., "Instead of [X], try [Y]"). No em dashes.`;
        }
        
        // Add custom notes if provided
        const customNotes = document.getElementById('customNotes')?.value.trim();
        if (customNotes) {
            prompt += `\n\n${customNotes}`;
        }
        
        // Save to history with date range
        const startDate = document.getElementById('startDate')?.value || '';
        const endDate = document.getElementById('endDate')?.value || '';
        const dateRangeLabel = startDate && endDate ? `${startDate} to ${endDate}` : '';
        saveToHistory(employeeName, strugglingAreas, metrics, dateRangeLabel);
        
        // Display the prompt
        document.getElementById('resultName').textContent = employeeName;
        document.getElementById('aiPrompt').value = prompt;
        showOnlySection('resultsSection');
        
        // Scroll to top of results
        document.getElementById('resultsSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
}
// Run initializer immediately if DOM is already parsed; otherwise wait
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}

// Build consolidated metrics summary
function buildConsolidatedMetrics(employeeName, currentMetrics) {
    const targetMap = {
        scheduleAdherence: { target: TARGETS.driver.scheduleAdherence.min, type: 'min', label: 'Schedule Adherence', unit: '%' },
        cxRepOverall: { target: TARGETS.driver.cxRepOverall.min, type: 'min', label: 'CX Rep Overall', unit: '%' },
        fcr: { target: TARGETS.driver.fcr.min, type: 'min', label: 'First Call Resolution', unit: '%' },
        overallExperience: { target: TARGETS.driver.overallExperience.min, type: 'min', label: 'Overall Experience', unit: '%' },
        transfers: { target: TARGETS.driver.transfers.max, type: 'max', label: 'Transfers', unit: '%' },
        overallSentiment: { target: TARGETS.driver.overallSentiment.min, type: 'min', label: 'Overall Sentiment', unit: '%' },
        positiveWord: { target: TARGETS.driver.positiveWord.min, type: 'min', label: 'Positive Word Choice', unit: '%' },
        negativeWord: { target: TARGETS.driver.negativeWord.min, type: 'min', label: 'Negative Word', unit: '%' },
        managingEmotions: { target: TARGETS.driver.managingEmotions.min, type: 'min', label: 'Managing Emotions', unit: '%' },
        aht: { target: TARGETS.driver.aht.max, type: 'max', label: 'AHT', unit: 's' },
        acw: { target: TARGETS.driver.acw.max, type: 'max', label: 'ACW', unit: 's' },
        holdTime: { target: TARGETS.driver.holdTime.max, type: 'max', label: 'Hold Time', unit: 's' },
        reliability: { target: TARGETS.driver.reliability.max, type: 'max', label: 'Reliability', unit: ' hrs' }
    };

    // Gather history for deltas
    const history = getAllHistory();
    const sessions = history[employeeName] || [];
    const sorted = [...sessions].sort((a, b) => new Date(a.date) - new Date(b.date));
    const previous = sorted.length > 0 ? sorted[sorted.length - 1] : null;

    // YTD averages
    const sums = {};
    const counts = {};
    sorted.forEach(s => {
        if (!s.metrics) return;
        Object.entries(s.metrics).forEach(([k, v]) => {
            if (v !== '' && v !== null && v !== undefined && !isNaN(parseFloat(v))) {
                sums[k] = (sums[k] || 0) + parseFloat(v);
                counts[k] = (counts[k] || 0) + 1;
            }
        });
    });
    const ytd = {};
    Object.keys(sums).forEach(k => {
        ytd[k] = sums[k] / counts[k];
    });

    const rows = [];
    Object.entries(targetMap).forEach(([key, meta]) => {
        const val = currentMetrics[key];
        if (val === '' || val === null || val === undefined || isNaN(parseFloat(val))) {
            return;
        }
        const numeric = parseFloat(val);
        const meets = meta.type === 'min' ? numeric >= meta.target : numeric <= meta.target;
        const prevVal = previous && previous.metrics ? previous.metrics[key] : undefined;
        const prevNum = prevVal === '' || prevVal === null || prevVal === undefined ? undefined : parseFloat(prevVal);
        const ytdVal = ytd[key];
        const deltaPrev = prevNum !== undefined && !isNaN(prevNum) ? (numeric - prevNum) : null;
        const deltaYtd = ytdVal !== undefined && !isNaN(ytdVal) ? (numeric - ytdVal) : null;
        rows.push({
            key,
            label: meta.label,
            value: numeric,
            target: meta.target,
            unit: meta.unit,
            meets,
            deltaPrev,
            deltaYtd,
            type: meta.type
        });
    });

    if (rows.length === 0) return '<p style="color: #666;">No metrics available to consolidate.</p>';

    const cell = (text) => `<td style="padding: 6px 8px; border-bottom: 1px solid #eee;">${text}</td>`;
    let html = '<table style="width: 100%; border-collapse: collapse; font-size: 0.95em;">';
    html += '<thead><tr style="background: #f1f3f5; text-align: left;"><th style="padding: 8px;">Metric</th><th style="padding: 8px;">Current</th><th style="padding: 8px;">Target</th><th style="padding: 8px;">Δ Prev</th><th style="padding: 8px;">Δ YTD</th><th style="padding: 8px;">Status</th></tr></thead>';
    html += '<tbody>';

    rows.forEach(r => {
        const statusColor = r.meets ? '#28a745' : '#dc3545';
        const statusText = r.meets ? '✅ On target' : '⚠️ Needs improvement';
        const formatDelta = (d, type) => {
            if (d === null || d === undefined || isNaN(d)) return '';
            const better = type === 'min' ? d > 0 : d < 0;
            const icon = better ? '📈' : d === 0 ? '→' : '📉';
            const color = better ? '#28a745' : d === 0 ? '#666' : '#dc3545';
            const sign = d > 0 ? '+' : '';
            return `<span style="color: ${color};">${icon} ${sign}${d.toFixed(2)}${r.unit}</span>`;
        };

        html += '<tr>';
        html += cell(`<strong>${r.label}</strong>`);
        html += cell(`${r.value}${r.unit}`);
        html += cell(`${r.type === 'min' ? '≥' : '≤'}${r.target}${r.unit}`);
        html += cell(formatDelta(r.deltaPrev, r.type));
        html += cell(formatDelta(r.deltaYtd, r.type));
        html += cell(`<span style="color: ${statusColor}; font-weight: 600;">${statusText}</span>`);
        html += '</tr>';
    });

    html += '</tbody></table>';
    return html;
}

// Composite score feature removed per request

// Aggregate data across all uploads for executive summary
function aggregateUploadData() {
    if (!uploadHistory || uploadHistory.length === 0) {
        return null;
    }

    const aggregated = {
        totalUploads: uploadHistory.length,
        timePeriods: [],
        totalEmployees: 0,
        employeeCount: {},
        metricAverages: {},
        metricsAboveTarget: {},
        metricsAbovePercent: {}
    };

    const metricConfigs = [
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

    // Initialize metric tracking
    metricConfigs.forEach(cfg => {
        aggregated.metricAverages[cfg.id] = { sum: 0, count: 0, values: [] };
        aggregated.metricsAboveTarget[cfg.id] = 0;
    });

    // Aggregate all upload data
    uploadHistory.forEach(upload => {
        aggregated.timePeriods.push(upload.timePeriod);
        aggregated.totalEmployees += upload.employeeCount;

        (upload.employeeMetrics || []).forEach(emp => {
            aggregated.employeeCount[emp.name] = (aggregated.employeeCount[emp.name] || 0) + 1;

            metricConfigs.forEach(cfg => {
                const val = emp[cfg.id];
                if (val !== undefined && val !== '' && !isNaN(parseFloat(val))) {
                    const numVal = parseFloat(val);
                    aggregated.metricAverages[cfg.id].sum += numVal;
                    aggregated.metricAverages[cfg.id].count++;
                    aggregated.metricAverages[cfg.id].values.push(numVal);

                    const meets = cfg.type === 'min' ? numVal >= cfg.target : numVal <= cfg.target;
                    if (meets) aggregated.metricsAboveTarget[cfg.id]++;
                }
            });
        });
    });

    // Calculate final averages and percentages
    metricConfigs.forEach(cfg => {
        const data = aggregated.metricAverages[cfg.id];
        if (data.count > 0) {
            const avg = data.sum / data.count;
            aggregated.metricAverages[cfg.id].average = avg.toFixed(2);
            aggregated.metricsAbovePercent[cfg.id] = ((aggregated.metricsAboveTarget[cfg.id] / data.count) * 100).toFixed(0);
        }
    });

    return aggregated;
}

// Generate executive summary AI prompt
function generateExecutiveSummaryPrompt() {
    const aggregated = aggregateUploadData();
    
    if (!aggregated) {
        return `No data available yet. Please upload employee data first.`;
    }

    const summaryLines = [];
    const metricNames = {
        scheduleAdherence: 'Schedule Adherence',
        cxRepOverall: 'Customer Experience',
        fcr: 'First Call Resolution',
        overallExperience: 'Overall Experience',
        transfers: 'Transfers',
        overallSentiment: 'Overall Sentiment',
        positiveWord: 'Positive Word Choice',
        negativeWord: 'Negative Word Choice',
        managingEmotions: 'Managing Emotions',
        aht: 'Average Handle Time',
        acw: 'After Call Work',
        holdTime: 'Hold Time',
        reliability: 'Reliability'
    };

    summaryLines.push(`Team Performance Summary`);
    summaryLines.push(`Time Periods Analyzed: ${aggregated.timePeriods.join(', ')}`);
    summaryLines.push(`Total Data Points: ${aggregated.totalUploads} uploads`);
    summaryLines.push(`Unique Employees Coached: ${Object.keys(aggregated.employeeCount).length}`);
    summaryLines.push(`Total Observations: ${aggregated.totalEmployees} employee-period records`);
    summaryLines.push(``);
    summaryLines.push(`Key Performance Metrics:`);

    Object.keys(aggregated.metricAverages).forEach(metricId => {
        const data = aggregated.metricAverages[metricId];
        if (data.count > 0) {
            const pct = aggregated.metricsAbovePercent[metricId];
            const name = metricNames[metricId];
            summaryLines.push(`• ${name}: Average ${data.average}, ${pct}% of team meeting target`);
        }
    });

    const prompt = `Write a professional 150-200 word executive summary for my manager based on this team performance data:\n\n${summaryLines.join('\n')}\n\nInclude: overall team health, top 3 strengths, top 3 areas for improvement, and one recommended focus for next period. Keep tone professional and data-driven.`;

    return prompt;
}
