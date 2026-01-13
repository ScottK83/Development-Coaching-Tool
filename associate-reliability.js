/* ========================================
   RELIABILITY TRACKER - ASSOCIATE DASHBOARD
   Personal view for employees
   ======================================== */

// ============================================
// GLOBAL STATE
// ============================================
let currentEmployee = null;
let currentHistoryPeriod = 'all';

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    // Initialize sample data if needed
    ReliabilityDataService.initializeWithSampleData();
    
    // Setup event listeners
    initializeEventListeners();
    
    // Populate employee dropdown
    populateEmployeeSelect();
    
    // Show selection section
    showTab('summary');
});

// ============================================
// EVENT LISTENERS
// ============================================
function initializeEventListeners() {
    // Employee selection
    document.getElementById('employeeNameSelect').addEventListener('change', handleEmployeeSelection);
    
    // Tab navigation
    document.querySelectorAll('.nav-tab').forEach(tab => {
        if (!tab.classList.contains('logout-tab')) {
            tab.addEventListener('click', handleTabChange);
        }
    });
    
    // History period buttons
    document.querySelectorAll('#historyTab .period-btn').forEach(btn => {
        btn.addEventListener('click', handleHistoryPeriodChange);
    });
}

// ============================================
// EMPLOYEE SELECTION
// ============================================
function populateEmployeeSelect() {
    const select = document.getElementById('employeeNameSelect');
    const employees = ReliabilityDataService.getAllEmployees();
    const employeeNames = employees.map(e => e.fullName).sort();
    
    select.innerHTML = '<option value="">-- Select your name --</option>' +
        employeeNames.map(name => `<option value="${name}">${name}</option>`).join('');
}

function handleEmployeeSelection(e) {
    currentEmployee = e.target.value;
    
    if (currentEmployee) {
        document.getElementById('selectionSection').style.display = 'none';
        document.getElementById('dashboardSection').style.display = 'block';
        document.getElementById('summaryHeader').textContent = `👤 ${currentEmployee}`;
        document.getElementById('summaryDate').textContent = new Date().toLocaleDateString();
        
        // Load all data
        loadAllDashboardData();
    }
}

function logout() {
    currentEmployee = null;
    document.getElementById('dashboardSection').style.display = 'none';
    document.getElementById('selectionSection').style.display = 'block';
    document.getElementById('employeeNameSelect').value = '';
    document.querySelectorAll('.nav-tab').forEach(tab => tab.classList.remove('active'));
}

window.logout = logout;

// ============================================
// TAB MANAGEMENT
// ============================================
function handleTabChange(e) {
    const tabName = e.target.dataset.tab;
    showTab(tabName);
}

function showTab(tabName) {
    // Hide all tabs
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.style.display = 'none';
    });
    
    // Remove active class from all buttons
    document.querySelectorAll('.nav-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected tab
    const tabElement = document.getElementById(tabName + 'Tab');
    if (tabElement) {
        tabElement.style.display = 'block';
    }
    
    // Add active class to button
    event.target.classList.add('active');
    
    // Load tab-specific data if needed
    if (tabName === 'history') {
        loadLeaveHistory();
    } else if (tabName === 'ptost') {
        loadPTOSTDetails();
    }
}

// ============================================
// LOAD ALL DASHBOARD DATA
// ============================================
function loadAllDashboardData() {
    // Get current period data (YTD)
    const range = ReliabilityUtils.getDateRange('ytd');
    const allEntries = ReliabilityDataService.getAllLeaveEntries();
    
    // Calculate statistics
    const breakdown = LeaveCalculationService.getMinutesBreakdown(
        allEntries,
        currentEmployee,
        range.startDate,
        range.endDate
    );
    
    const balance = PTOSTService.getCurrentBalance(currentEmployee, allEntries);
    const analysis = ReliabilityAnalysisService.calculateReliabilityHours(
        currentEmployee,
        allEntries,
        range.startDate,
        range.endDate
    );
    
    // Update summary stats
    document.getElementById('plannedHoursValue').textContent = 
        LeaveCalculationService.formatMinutesAsHours(breakdown.planned);
    
    document.getElementById('unplannedHoursValue').textContent = 
        LeaveCalculationService.formatMinutesAsHours(breakdown.unplanned);
    
    document.getElementById('ptostUsedValue').textContent = 
        LeaveCalculationService.formatMinutesAsHours(balance.usedMinutes);
    
    document.getElementById('reliabilityHoursValue').textContent = 
        analysis.reliabilityHours.toFixed(1) + 'h';
    
    // Update PTOST display
    updatePTOSTSummary(balance);
    
    // Update reliability display
    updateReliabilitySummary(analysis);
    
    // Load emails
    loadEmails();
}

// ============================================
// PTOST SUMMARY & DETAILS
// ============================================
function updatePTOSTSummary(balance) {
    const percentWidth = Math.min(100, balance.percentUsed);
    const barColor = balance.isExhausted ? '#f44336' : 
                    balance.percentUsed >= 90 ? '#ff9800' :
                    balance.percentUsed >= 75 ? '#ffc107' : '#4CAF50';
    
    document.getElementById('ptostSummaryDisplay').innerHTML = `
        <div class="ptost-bar-container">
            <div class="ptost-bar" style="width: ${percentWidth}%; background: ${barColor};"></div>
        </div>
        
        <div class="ptost-stats">
            <div class="ptost-stat">
                <div class="ptost-stat-label">Threshold</div>
                <div class="ptost-stat-value">${LeaveCalculationService.formatMinutesAsHours(balance.thresholdMinutes)}</div>
            </div>
            <div class="ptost-stat">
                <div class="ptost-stat-label">Used</div>
                <div class="ptost-stat-value">${LeaveCalculationService.formatMinutesAsHours(balance.usedMinutes)}</div>
            </div>
            <div class="ptost-stat">
                <div class="ptost-stat-label">Remaining</div>
                <div class="ptost-stat-value ${balance.isExhausted ? 'text-danger' : 'text-success'}">${LeaveCalculationService.formatMinutesAsHours(balance.remainingMinutes)}</div>
            </div>
        </div>
        
        ${balance.percentUsed >= 75 ? `
            <div class="flag flag-warning">
                <strong>⚠️ Low PTOST Balance</strong><br>
                <small>You have used ${balance.percentUsed}% of your PTOST. Be mindful of additional unplanned absences.</small>
            </div>
        ` : ''}
        
        ${balance.isExhausted ? `
            <div class="flag flag-error">
                <strong>❌ PTOST Exhausted</strong><br>
                <small>Your PTOST balance is depleted. Additional unplanned absences will be tracked as reliability hours.</small>
            </div>
        ` : ''}
    `;
}

function loadPTOSTDetails() {
    const allEntries = ReliabilityDataService.getAllLeaveEntries();
    const balance = PTOSTService.getCurrentBalance(currentEmployee, allEntries);
    const history = PTOSTService.getUsageHistory(currentEmployee, allEntries);
    
    const monthlyData = Object.entries(history.byMonth).map(([month, data]) => {
        const monthName = new Date(month + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        return {
            month: monthName,
            hours: LeaveCalculationService.minutesToHours(data.totalMinutes),
            count: data.entries.length
        };
    });
    
    document.getElementById('ptostDetailDisplay').innerHTML = `
        <div style="background: white; padding: 15px; border-radius: 8px; border: 2px solid #2196F3; margin-bottom: 20px;">
            <h4 style="margin-top: 0;">Balance Summary</h4>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
                <div>
                    <div style="font-size: 0.85em; color: #666; text-transform: uppercase;">Annual Threshold</div>
                    <div style="font-size: 1.5em; font-weight: bold; color: #2196F3;">${LeaveCalculationService.formatMinutesAsHours(balance.thresholdMinutes)}</div>
                </div>
                <div>
                    <div style="font-size: 0.85em; color: #666; text-transform: uppercase;">Reset Date</div>
                    <div style="font-size: 1.5em; font-weight: bold; color: #666;">${ReliabilityUtils.formatDate(balance.resetDate)}</div>
                </div>
                <div>
                    <div style="font-size: 0.85em; color: #666; text-transform: uppercase;">Currently Used</div>
                    <div style="font-size: 1.5em; font-weight: bold; color: #FF9800;">${LeaveCalculationService.formatMinutesAsHours(balance.usedMinutes)}</div>
                </div>
                <div>
                    <div style="font-size: 0.85em; color: #666; text-transform: uppercase;">Currently Remaining</div>
                    <div style="font-size: 1.5em; font-weight: bold; color: ${balance.isExhausted ? '#f44336' : '#4CAF50'};">${LeaveCalculationService.formatMinutesAsHours(balance.remainingMinutes)}</div>
                </div>
            </div>
        </div>
        
        ${monthlyData.length > 0 ? `
            <div style="background: white; padding: 15px; border-radius: 8px; border: 2px solid #FF9800;">
                <h4 style="margin-top: 0;">Monthly Breakdown</h4>
                <div style="overflow-x: auto;">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Month</th>
                                <th>Hours Used</th>
                                <th>Occurrences</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${monthlyData.map(m => `
                                <tr>
                                    <td>${m.month}</td>
                                    <td><strong>${m.hours.toFixed(1)}h</strong></td>
                                    <td>${m.count}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        ` : `
            <p style="text-align: center; color: #999;">No PTOST usage yet.</p>
        `}
    `;
}

// ============================================
// RELIABILITY SUMMARY
// ============================================
function updateReliabilitySummary(analysis) {
    const message = analysis.reliabilityHours >= 16 
        ? '⚠️ Your reliability hours are high. Consider speaking with your supervisor about recent absences.'
        : analysis.reliabilityHours >= 8
        ? '📌 Your reliability hours indicate some unplanned absences. You can discuss with your supervisor about using PTOST.'
        : '✅ Your reliability hours are low. Great job maintaining attendance!';
    
    const messageColor = analysis.reliabilityHours >= 16 ? '#f44336' :
                        analysis.reliabilityHours >= 8 ? '#FF9800' : '#4CAF50';
    
    document.getElementById('reliabilitySummaryDisplay').innerHTML = `
        <div style="padding: 15px; background: ${messageColor}22; border-left: 4px solid ${messageColor}; border-radius: 4px; margin-bottom: 15px;">
            <div style="font-size: 1.2em; font-weight: bold; color: ${messageColor}; margin-bottom: 8px;">
                ${analysis.reliabilityHours.toFixed(1)} Reliability Hours
            </div>
            <div style="color: #333; font-size: 0.95em;">
                ${message}
            </div>
        </div>
        
        <div style="background: white; padding: 12px; border-radius: 4px; border: 1px solid #ddd; margin-bottom: 15px;">
            <strong>What does this mean?</strong><br>
            <small style="color: #666; line-height: 1.6;">
                Reliability hours are time you missed work that was not covered by PTOST and was not pre-planned. 
                Help you manage your time and PTO accordingly.
            </small>
        </div>
    `;
}

// ============================================
// ATTENDANCE HISTORY
// ============================================
function handleHistoryPeriodChange(e) {
    // Update active button
    document.querySelectorAll('#historyTab .period-btn').forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');
    
    currentHistoryPeriod = e.target.dataset.period;
    loadLeaveHistory();
}

function loadLeaveHistory() {
    const allEntries = ReliabilityDataService.getAllLeaveEntries();
    let entries = allEntries.filter(e => e.employeeName === currentEmployee && !e.isDeleted);
    
    // Filter by period
    const today = new Date();
    const year = today.getFullYear();
    
    switch(currentHistoryPeriod) {
        case 'ytd':
            entries = entries.filter(e => e.leaveDate >= `${year}-01-01`);
            break;
        case '3months':
            const threeMonthsAgo = new Date(today);
            threeMonthsAgo.setMonth(today.getMonth() - 3);
            const threeMonthsDate = ReliabilityUtils.formatDateForInput(threeMonthsAgo);
            entries = entries.filter(e => e.leaveDate >= threeMonthsDate);
            break;
        case 'all':
        default:
            // All entries
            break;
    }
    
    // Sort by date descending
    entries.sort((a, b) => b.leaveDate.localeCompare(a.leaveDate));
    
    if (entries.length === 0) {
        document.getElementById('leaveHistoryDisplay').innerHTML = `
            <p style="text-align: center; color: #999; padding: 20px;">No leave entries.</p>
        `;
        return;
    }
    
    document.getElementById('leaveHistoryDisplay').innerHTML = `
        <div style="overflow-x: auto;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Time</th>
                        <th>Hours</th>
                        <th>Type</th>
                        <th>PTOST</th>
                        <th>Reason</th>
                    </tr>
                </thead>
                <tbody>
                    ${entries.map(entry => `
                        <tr>
                            <td><strong>${ReliabilityUtils.formatDate(entry.leaveDate)}</strong></td>
                            <td>${entry.departureTime ? ReliabilityUtils.formatTime(entry.departureTime) : 'All day'}</td>
                            <td>${LeaveCalculationService.formatMinutesAsHours(entry.minutesMissed)}</td>
                            <td><span class="badge badge-${entry.leaveType.toLowerCase()}">${entry.leaveType}</span></td>
                            <td>
                                <span style="font-weight: bold; ${entry.ptostApplied ? 'color: #4CAF50;' : 'color: #999;'}">
                                    ${entry.ptostApplied ? '✓ Yes' : '✗ No'}
                                </span>
                            </td>
                            <td style="max-width: 250px; overflow: hidden; text-overflow: ellipsis;" title="${entry.reason || ''}">
                                ${entry.reason || '—'}
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// ============================================
// EMAILS
// ============================================
function loadEmails() {
    const emails = ReliabilityDataService.getEmailsForEmployee(currentEmployee);
    
    if (emails.length === 0) {
        document.getElementById('emailsSection').style.display = 'none';
        return;
    }
    
    document.getElementById('emailsSection').style.display = 'block';
    
    document.getElementById('emailsDisplay').innerHTML = `
        <div class="email-history-list">
            ${emails.map(email => `
                <div class="email-history-item">
                    <div class="email-header">
                        <strong>${email.subject}</strong>
                        <span class="email-date" style="color: #999; font-size: 0.9em;">
                            ${ReliabilityUtils.formatDate(email.sentAt.split('T')[0])}
                        </span>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <small style="background: #E3F2FD; color: #0056B3; padding: 4px 8px; border-radius: 4px; display: inline-block;">
                            From: ${email.sentBy}
                        </small>
                    </div>
                    <div class="email-preview" style="white-space: pre-wrap; font-family: Arial, sans-serif; font-size: 0.95em; line-height: 1.5; margin-bottom: 10px;">
                        ${email.bodyText}
                    </div>
                    ${email.employeeResponse ? `
                        <div class="email-response" style="background: #F3E5F5; padding: 10px; border-radius: 4px; border-left: 3px solid #9C27B0; margin-top: 10px;">
                            <strong>Your Response:</strong><br>
                            ${email.employeeResponse}
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        </div>
    `;
}
