/* ========================================
   RELIABILITY TRACKER - SUPERVISOR DASHBOARD
   Main application logic for supervisor view
   ======================================== */

// ============================================
// GLOBAL STATE
// ============================================
let currentSupervisor = null;
let currentEmployee = null;
let currentPeriod = 'week';
let currentDateRange = { startDate: '', endDate: '' };

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    // Initialize sample data if needed
    ReliabilityDataService.initializeWithSampleData();
    
    // Setup event listeners
    initializeEventListeners();
    
    // Populate supervisor dropdown
    populateSupervisorSelect();
    
    // Show initial section
    showSection('employeeSelectionSection');
});

// ============================================
// EVENT LISTENERS
// ============================================
function initializeEventListeners() {
    // Navigation buttons
    document.getElementById('teamOverviewBtn').addEventListener('click', () => {
        if (!currentSupervisor) {
            alert('Please select your name first');
            return;
        }
        showTeamOverview();
    });
    
    document.getElementById('addLeaveBtn').addEventListener('click', () => {
        if (!currentEmployee) {
            alert('Please select an employee first');
            return;
        }
        showSection('employeeDetailSection');
        document.getElementById('leaveDate').focus();
    });
    
    document.getElementById('manageDataBtn').addEventListener('click', () => {
        showSection('manageDataSection');
        populateManageDataSupervisorSelect();
        renderTeamMembersManagementList();
    });
    
    // Supervisor selection
    document.getElementById('supervisorSelect').addEventListener('change', handleSupervisorChange);
    
    // Employee selection
    document.getElementById('employeeSelect').addEventListener('change', handleEmployeeChange);
    
    // Add employee button
    document.getElementById('addNewEmployeeBtn').addEventListener('click', openAddEmployeeModal);
    document.getElementById('addEmployeeForm').addEventListener('submit', handleAddEmployee);
    
    // Leave entry form
    document.getElementById('addLeaveForm').addEventListener('submit', handleAddLeaveEntry);
    document.getElementById('clearLeaveForm').addEventListener('click', clearLeaveForm);
    
    // Time input listeners for real-time calculation
    document.getElementById('departureTime').addEventListener('change', updateCalculatedHours);
    document.getElementById('scheduledEndTime').addEventListener('change', updateCalculatedHours);
    
    // Period buttons
    document.querySelectorAll('.period-btn').forEach(btn => {
        btn.addEventListener('click', handlePeriodChange);
    });
    
    document.getElementById('applyCustomRange').addEventListener('click', applyCustomDateRange);
    
    // Email button
    document.getElementById('emailEmployeeBtn').addEventListener('click', openEmailComposer);
    document.getElementById('cancelEmailBtn').addEventListener('click', closeEmailComposer);
    document.getElementById('sendEmailBtn').addEventListener('click', handleSendEmail);
    document.getElementById('emailTemplate').addEventListener('change', handleEmailTemplateChange);
    
    // Data management
    document.getElementById('exportDataBtn').addEventListener('click', exportData);
    document.getElementById('importDataBtn').addEventListener('click', () => {
        document.getElementById('dataFileInput').click();
    });
    document.getElementById('dataFileInput').addEventListener('change', importData);
    document.getElementById('deleteAllDataBtn').addEventListener('click', deleteAllData);
    
    // Manage Data supervisor selection
    document.getElementById('manageDataSupervisor')?.addEventListener('change', handleManageDataSupervisorChange);
    
    // Manage My Team button
    document.getElementById('manageTeamBtn')?.addEventListener('click', () => {
        console.log('Manage My Team button clicked');
        
        // Get supervisor from dropdown or use currentSupervisor
        const supervisorName = document.getElementById('supervisorSelect')?.value || currentSupervisor;
        console.log('Supervisor name:', supervisorName);
        console.log('currentSupervisor:', currentSupervisor);
        
        if (supervisorName) {
            currentSupervisor = supervisorName;
            document.getElementById('manageDataSupervisor').value = supervisorName;
            handleManageDataSupervisorChange({ target: { value: supervisorName } });
            showSection('manageDataSection');
            console.log('Navigating to Manage Data section');
        } else {
            alert('❌ Please select a supervisor first');
        }
    });
    
    // Team member management
    document.getElementById('addTeamMemberBtn')?.addEventListener('click', handleAddTeamMember);
    document.getElementById('newTeamMemberName')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('addTeamMemberBtn').click();
        }
    });
}

// ============================================
// SECTION MANAGEMENT
// ============================================
function showSection(sectionId) {
    const sections = [
        'employeeSelectionSection',
        'teamOverviewSection',
        'employeeDetailSection',
        'emailCompositionSection',
        'manageDataSection'
    ];
    
    sections.forEach(id => {
        const section = document.getElementById(id);
        if (section) {
            section.style.display = id === sectionId ? 'block' : 'none';
        }
    });
}

// Make showSection available globally for inline onclick handlers
window.showSection = showSection;

// ============================================
// SUPERVISOR MANAGEMENT
// ============================================
function populateSupervisorSelect() {
    const select = document.getElementById('supervisorSelect');
    const teams = ReliabilityDataService.getSupervisorTeams();
    const supervisors = Object.keys(teams);
    
    // Add unique supervisors from employees table
    const employees = ReliabilityDataService.getAllEmployees();
    employees.forEach(emp => {
        if (emp.supervisorName && !supervisors.includes(emp.supervisorName)) {
            supervisors.push(emp.supervisorName);
        }
    });
    
    // Add a default supervisor for testing
    if (supervisors.length === 0) {
        supervisors.push('Jane Manager');
    }
    
    select.innerHTML = '<option value="">-- Select your name --</option>' +
        supervisors.sort().map(name => `<option value="${name}">${name}</option>`).join('');
}

function handleSupervisorChange(e) {
    currentSupervisor = e.target.value;
    
    if (currentSupervisor) {
        document.getElementById('employeeSelectContainer').style.display = 'block';
        populateEmployeeSelect();
    } else {
        document.getElementById('employeeSelectContainer').style.display = 'none';
        currentEmployee = null;
    }
}

function populateManageDataSupervisorSelect() {
    const select = document.getElementById('manageDataSupervisor');
    const teams = ReliabilityDataService.getSupervisorTeams();
    const supervisors = Object.keys(teams);
    
    // Add unique supervisors from employees table
    const employees = ReliabilityDataService.getAllEmployees();
    employees.forEach(emp => {
        if (emp.supervisorName && !supervisors.includes(emp.supervisorName)) {
            supervisors.push(emp.supervisorName);
        }
    });
    
    // Add a default supervisor for testing
    if (supervisors.length === 0) {
        supervisors.push('Jane Manager');
    }
    
    select.innerHTML = '<option value="">-- Select your name --</option>' +
        supervisors.sort().map(name => `<option value="${name}">${name}</option>`).join('');
    
    // Pre-select if already chosen
    if (currentSupervisor) {
        select.value = currentSupervisor;
    }
}

function handleManageDataSupervisorChange(e) {
    currentSupervisor = e.target.value;
    console.log('Supervisor changed to:', currentSupervisor);
    renderTeamMembersManagementList();
}

// ============================================
// EMPLOYEE MANAGEMENT
// ============================================
function populateEmployeeSelect() {
    const select = document.getElementById('employeeSelect');
    const teamMembers = ReliabilityDataService.getTeamMembers(currentSupervisor);
    
    select.innerHTML = '<option value="">-- Choose an employee --</option>' +
        teamMembers.sort().map(name => `<option value="${name}">${name}</option>`).join('');
}

function handleEmployeeChange(e) {
    currentEmployee = e.target.value;
    
    if (currentEmployee) {
        showEmployeeDetail();
    }
}

function openAddEmployeeModal() {
    document.getElementById('addEmployeeModal').style.display = 'flex';
    document.getElementById('newEmployeeName').focus();
}

function closeAddEmployeeModal() {
    document.getElementById('addEmployeeModal').style.display = 'none';
    document.getElementById('addEmployeeForm').reset();
}

window.closeAddEmployeeModal = closeAddEmployeeModal;

function handleAddEmployee(e) {
    e.preventDefault();
    
    const employeeData = {
        fullName: document.getElementById('newEmployeeName').value.trim(),
        email: document.getElementById('newEmployeeEmail').value.trim(),
        hireDate: document.getElementById('newEmployeeHireDate').value,
        supervisorName: currentSupervisor,
        isActive: true
    };
    
    // Save employee
    ReliabilityDataService.saveEmployee(employeeData);
    
    // Add to supervisor's team
    ReliabilityDataService.addTeamMember(currentSupervisor, employeeData.fullName);
    
    // Create default schedule
    ReliabilityDataService.saveSchedule({
        employeeName: employeeData.fullName,
        effectiveStartDate: employeeData.hireDate
    });
    
    alert(`✅ ${employeeData.fullName} added to your team!`);
    
    closeAddEmployeeModal();
    populateEmployeeSelect();
    
    // Select the new employee
    document.getElementById('employeeSelect').value = employeeData.fullName;
    currentEmployee = employeeData.fullName;
    showEmployeeDetail();
}

// ============================================
// TEAM OVERVIEW
// ============================================
function showTeamOverview() {
    showSection('teamOverviewSection');
    
    const teamMembers = ReliabilityDataService.getTeamMembers(currentSupervisor);
    const allEntries = ReliabilityDataService.getAllLeaveEntries();
    
    // Calculate team statistics
    let totalReliabilityHours = 0;
    let flaggedEmployees = 0;
    let lowPTOSTCount = 0;
    
    const teamData = teamMembers.map(employeeName => {
        const range = ReliabilityUtils.getDateRange('month');
        const analysis = ReliabilityAnalysisService.calculateReliabilityHours(
            employeeName,
            allEntries,
            range.startDate,
            range.endDate
        );
        
        const ptostBalance = PTOSTService.getCurrentBalance(employeeName, allEntries);
        
        if (analysis.reliabilityHours >= 8) flaggedEmployees++;
        if (ptostBalance.remainingMinutes < 300) lowPTOSTCount++; // Less than 5 hours
        totalReliabilityHours += analysis.reliabilityHours;
        
        return {
            employeeName,
            reliabilityHours: analysis.reliabilityHours,
            ptostRemaining: ptostBalance.remainingMinutes,
            ptostPercent: ptostBalance.percentUsed
        };
    });
    
    // Display summary stats
    document.getElementById('teamSummaryStats').innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${teamMembers.length}</div>
                <div class="stat-label">Team Members</div>
            </div>
            <div class="stat-card ${flaggedEmployees > 0 ? 'stat-warning' : ''}">
                <div class="stat-value">${flaggedEmployees}</div>
                <div class="stat-label">High Reliability</div>
            </div>
            <div class="stat-card ${lowPTOSTCount > 0 ? 'stat-warning' : ''}">
                <div class="stat-value">${lowPTOSTCount}</div>
                <div class="stat-label">Low PTOST Balance</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${totalReliabilityHours.toFixed(1)}h</div>
                <div class="stat-label">Total Reliability</div>
            </div>
        </div>
    `;
    
    // Display team members list
    document.getElementById('teamMembersList').innerHTML = `
        <h3>Team Members</h3>
        <div style="overflow-x: auto;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Employee</th>
                        <th>Reliability (Month)</th>
                        <th>PTOST Remaining</th>
                        <th>PTOST Used</th>
                        <th>Status</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${teamData.map(emp => {
                        const reliabilityStatus = emp.reliabilityHours >= 16 ? 'error' : 
                                                 emp.reliabilityHours >= 8 ? 'warning' : 'success';
                        const ptostStatus = emp.ptostPercent >= 90 ? 'error' :
                                           emp.ptostPercent >= 75 ? 'warning' : 'success';
                        
                        return `
                            <tr>
                                <td><strong>${emp.employeeName}</strong></td>
                                <td class="status-${reliabilityStatus}">${emp.reliabilityHours.toFixed(1)}h</td>
                                <td>${LeaveCalculationService.formatMinutesAsHours(emp.ptostRemaining)}</td>
                                <td class="status-${ptostStatus}">${emp.ptostPercent}%</td>
                                <td>
                                    ${emp.reliabilityHours >= 8 ? '<span class="badge badge-warning">⚠️ Review</span>' : '<span class="badge badge-success">✓ Good</span>'}
                                </td>
                                <td>
                                    <button onclick="selectEmployee('${emp.employeeName}')" class="btn-small">View Details</button>
                                </td>
                            </tr>
                        `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function selectEmployee(employeeName) {
    currentEmployee = employeeName;
    document.getElementById('employeeSelect').value = employeeName;
    showEmployeeDetail();
}

window.selectEmployee = selectEmployee;

// ============================================
// EMPLOYEE DETAIL VIEW
// ============================================
function showEmployeeDetail() {
    showSection('employeeDetailSection');
    
    document.getElementById('employeeDetailHeader').textContent = `📊 ${currentEmployee}`;
    
    // Set date range based on current period
    currentDateRange = ReliabilityUtils.getDateRange(currentPeriod);
    
    // Update all displays
    updatePTOSTBalance();
    updateReliabilitySummary();
    updateLeaveHistory();
    updateEmailHistory();
    
    // Pre-fill form defaults
    document.getElementById('leaveDate').value = ReliabilityUtils.getTodayDate();
    const schedule = ReliabilityDataService.getActiveSchedule(currentEmployee);
    document.getElementById('scheduledEndTime').value = schedule.shiftEndTime;
}

function updatePTOSTBalance() {
    const allEntries = ReliabilityDataService.getAllLeaveEntries();
    const balance = PTOSTService.getCurrentBalance(currentEmployee, allEntries);
    const flags = PTOSTService.generateWarningFlags(balance);
    
    const percentWidth = Math.min(100, balance.percentUsed);
    const barColor = balance.isExhausted ? '#f44336' : 
                    balance.percentUsed >= 90 ? '#ff9800' :
                    balance.percentUsed >= 75 ? '#ffc107' : '#4CAF50';
    
    document.getElementById('ptostBalanceDisplay').innerHTML = `
        <div class="ptost-bar-container">
            <div class="ptost-bar" style="width: ${percentWidth}%; background: ${barColor};"></div>
        </div>
        <div class="ptost-stats">
            <div class="ptost-stat">
                <div class="ptost-stat-label">Used</div>
                <div class="ptost-stat-value">${LeaveCalculationService.formatMinutesAsHours(balance.usedMinutes)}</div>
            </div>
            <div class="ptost-stat">
                <div class="ptost-stat-label">Remaining</div>
                <div class="ptost-stat-value ${balance.isExhausted ? 'text-danger' : ''}">${LeaveCalculationService.formatMinutesAsHours(balance.remainingMinutes)}</div>
            </div>
            <div class="ptost-stat">
                <div class="ptost-stat-label">Threshold</div>
                <div class="ptost-stat-value">${LeaveCalculationService.formatMinutesAsHours(balance.thresholdMinutes)}</div>
            </div>
            <div class="ptost-stat">
                <div class="ptost-stat-label">Reset Date</div>
                <div class="ptost-stat-value">${ReliabilityUtils.formatDate(balance.resetDate)}</div>
            </div>
        </div>
        
        ${flags.length > 0 ? `
            <div class="ptost-flags">
                ${flags.map(flag => `
                    <div class="flag flag-${flag.severity}">
                        <strong>${flag.message}</strong><br>
                        <small>${flag.action}</small>
                    </div>
                `).join('')}
            </div>
        ` : ''}
    `;
}

function updateReliabilitySummary() {
    const allEntries = ReliabilityDataService.getAllLeaveEntries();
    const analysis = ReliabilityAnalysisService.calculateReliabilityHours(
        currentEmployee,
        allEntries,
        currentDateRange.startDate,
        currentDateRange.endDate
    );
    
    const flags = ReliabilityAnalysisService.generateReliabilityFlags(analysis.reliabilityHours);
    
    document.getElementById('reliabilitySummaryDisplay').innerHTML = `
        <div class="reliability-breakdown">
            <div class="breakdown-item">
                <div class="breakdown-label">Total Missed:</div>
                <div class="breakdown-value">${LeaveCalculationService.formatMinutesAsHours(analysis.totalMissedMinutes)}</div>
            </div>
            <div class="breakdown-item">
                <div class="breakdown-label">Planned Leave:</div>
                <div class="breakdown-value">${LeaveCalculationService.formatMinutesAsHours(analysis.plannedMinutes)}</div>
            </div>
            <div class="breakdown-item">
                <div class="breakdown-label">PTOST Used:</div>
                <div class="breakdown-value">${LeaveCalculationService.formatMinutesAsHours(analysis.ptostMinutes)}</div>
            </div>
            <div class="breakdown-item breakdown-highlight">
                <div class="breakdown-label">Reliability Hours:</div>
                <div class="breakdown-value ${analysis.reliabilityHours >= 8 ? 'text-danger' : 'text-success'}">${analysis.reliabilityHours.toFixed(1)}h</div>
            </div>
        </div>
        
        <div style="margin-top: 15px; padding: 12px; background: #f9f9f9; border-radius: 4px; font-size: 0.9em; color: #666;">
            <strong>ℹ️ What is Reliability?</strong><br>
            Reliability hours = Unplanned absences NOT covered by PTOST. These represent time the employee missed work without protection.
        </div>
        
        ${flags.length > 0 ? `
            <div class="reliability-flags" style="margin-top: 15px;">
                ${flags.map(flag => `
                    <div class="flag flag-${flag.severity}">
                        <strong>${flag.message}</strong><br>
                        <small>${flag.action}</small>
                    </div>
                `).join('')}
            </div>
        ` : ''}
    `;
}

function updateLeaveHistory() {
    const entries = ReliabilityDataService.getLeaveEntriesForEmployee(
        currentEmployee,
        currentDateRange.startDate,
        currentDateRange.endDate
    );
    
    if (entries.length === 0) {
        document.getElementById('leaveHistoryDisplay').innerHTML = `
            <p style="text-align: center; color: #999; padding: 20px;">No leave entries for this period.</p>
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
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${entries.map(entry => `
                        <tr>
                            <td>${ReliabilityUtils.formatDate(entry.leaveDate)}</td>
                            <td>${entry.departureTime ? ReliabilityUtils.formatTime(entry.departureTime) : 'All day'}</td>
                            <td>${LeaveCalculationService.formatMinutesAsHours(entry.minutesMissed)}</td>
                            <td><span class="badge badge-${entry.leaveType.toLowerCase()}">${entry.leaveType}</span></td>
                            <td>
                                <label class="checkbox-container">
                                    <input type="checkbox" ${entry.ptostApplied ? 'checked' : ''} 
                                           onchange="togglePTOST('${entry.entryId}', this.checked)"
                                           ${entry.leaveType === 'Planned' ? 'disabled' : ''}>
                                    <span>${entry.ptostApplied ? '✓' : ''}</span>
                                </label>
                            </td>
                            <td style="max-width: 200px; overflow: hidden; text-overflow: ellipsis;" title="${entry.reason || ''}">${entry.reason || '-'}</td>
                            <td>
                                <button onclick="editLeaveEntry('${entry.entryId}')" class="btn-small">✏️</button>
                                <button onclick="deleteLeaveEntry('${entry.entryId}')" class="btn-small btn-danger">🗑️</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function updateEmailHistory() {
    const emails = ReliabilityDataService.getEmailsForEmployee(currentEmployee);
    
    if (emails.length === 0) {
        document.getElementById('emailHistoryDisplay').innerHTML = `
            <p style="text-align: center; color: #999; padding: 20px;">No emails sent yet.</p>
        `;
        return;
    }
    
    document.getElementById('emailHistoryDisplay').innerHTML = `
        <div class="email-history-list">
            ${emails.map(email => `
                <div class="email-history-item">
                    <div class="email-header">
                        <strong>${email.subject}</strong>
                        <span class="email-date">${ReliabilityUtils.formatDate(email.sentAt.split('T')[0])}</span>
                    </div>
                    <div class="email-type"><span class="badge badge-${email.emailType}">${email.emailType}</span></div>
                    <div class="email-preview">${email.bodyText.substring(0, 150)}...</div>
                    ${email.employeeResponse ? `
                        <div class="email-response">
                            <strong>Response:</strong> ${email.employeeResponse}
                        </div>
                    ` : ''}
                </div>
            `).join('')}
        </div>
    `;
}

// ============================================
// PERIOD MANAGEMENT
// ============================================
function handlePeriodChange(e) {
    // Update active button
    document.querySelectorAll('.period-btn').forEach(btn => btn.classList.remove('active'));
    e.target.classList.add('active');
    
    currentPeriod = e.target.dataset.period;
    
    // Show/hide custom date range
    if (currentPeriod === 'custom') {
        document.getElementById('customDateRange').style.display = 'block';
    } else {
        document.getElementById('customDateRange').style.display = 'none';
        currentDateRange = ReliabilityUtils.getDateRange(currentPeriod);
        updateReliabilitySummary();
        updateLeaveHistory();
    }
}

function applyCustomDateRange() {
    const startDate = document.getElementById('customStartDate').value;
    const endDate = document.getElementById('customEndDate').value;
    
    if (!startDate || !endDate) {
        alert('Please select both start and end dates');
        return;
    }
    
    if (startDate > endDate) {
        alert('Start date must be before end date');
        return;
    }
    
    currentDateRange = { startDate, endDate };
    updateReliabilitySummary();
    updateLeaveHistory();
}

// ============================================
// LEAVE ENTRY MANAGEMENT
// ============================================
function updateCalculatedHours() {
    const departureTime = document.getElementById('departureTime').value;
    const scheduledEndTime = document.getElementById('scheduledEndTime').value;
    
    if (departureTime && scheduledEndTime) {
        const schedule = ReliabilityDataService.getActiveSchedule(currentEmployee);
        const minutesMissed = LeaveCalculationService.calculateMinutesMissed(
            departureTime,
            scheduledEndTime,
            schedule.lunchDurationMinutes,
            schedule.lunchStartTime
        );
        
        const hours = LeaveCalculationService.minutesToHours(minutesMissed);
        document.getElementById('calculatedHoursValue').textContent = hours.toFixed(1);
        document.getElementById('calculatedHours').style.display = 'block';
    } else {
        document.getElementById('calculatedHours').style.display = 'none';
    }
}

function handleAddLeaveEntry(e) {
    e.preventDefault();
    
    const leaveDate = document.getElementById('leaveDate').value;
    const leaveType = document.getElementById('leaveType').value;
    const departureTime = document.getElementById('departureTime').value;
    const scheduledEndTime = document.getElementById('scheduledEndTime').value;
    const applyPTOST = document.getElementById('applyPTOST').checked;
    const reason = document.getElementById('leaveReason').value.trim();
    const supervisorNotes = document.getElementById('supervisorNotes').value.trim();
    
    // Calculate minutes missed
    const schedule = ReliabilityDataService.getActiveSchedule(currentEmployee);
    let minutesMissed;
    
    if (departureTime && scheduledEndTime) {
        minutesMissed = LeaveCalculationService.calculateMinutesMissed(
            departureTime,
            scheduledEndTime,
            schedule.lunchDurationMinutes,
            schedule.lunchStartTime
        );
    } else {
        // Full day absence
        minutesMissed = schedule.scheduledHoursPerDay * 60;
    }
    
    // Check PTOST availability if applying
    if (applyPTOST && leaveType === 'Unplanned') {
        const allEntries = ReliabilityDataService.getAllLeaveEntries();
        const canUse = PTOSTService.canApplyPTOST(currentEmployee, minutesMissed, allEntries);
        
        if (!canUse.allowed) {
            if (!confirm(`⚠️ ${canUse.message}\n\nDo you want to save this entry without PTOST?`)) {
                return;
            }
            document.getElementById('applyPTOST').checked = false;
        }
    }
    
    // Validation
    if (minutesMissed <= 0) {
        alert('Invalid time entry. Please check departure and end times.');
        return;
    }
    
    // Create entry
    const entry = {
        entryId: ReliabilityUtils.generateId(),
        employeeName: currentEmployee,
        leaveDate,
        departureTime: departureTime || null,
        scheduledEndTime: scheduledEndTime || null,
        minutesMissed,
        leaveType,
        ptostApplied: applyPTOST && leaveType === 'Unplanned',
        reason,
        supervisorNotes,
        createdBy: currentSupervisor,
        createdAt: new Date().toISOString(),
        isDeleted: false
    };
    
    // Validate
    const validation = ValidationService.validateLeaveEntry(entry);
    if (!validation.isValid) {
        alert('Validation errors:\n' + validation.errors.join('\n'));
        return;
    }
    
    // Save
    ReliabilityDataService.saveLeaveEntry(entry);
    
    alert(`✅ Leave entry saved: ${LeaveCalculationService.formatMinutesAsHours(minutesMissed)} on ${ReliabilityUtils.formatDate(leaveDate)}`);
    
    // Refresh displays
    clearLeaveForm();
    updatePTOSTBalance();
    updateReliabilitySummary();
    updateLeaveHistory();
}

function clearLeaveForm() {
    document.getElementById('addLeaveForm').reset();
    document.getElementById('leaveDate').value = ReliabilityUtils.getTodayDate();
    const schedule = ReliabilityDataService.getActiveSchedule(currentEmployee);
    document.getElementById('scheduledEndTime').value = schedule.shiftEndTime;
    document.getElementById('calculatedHours').style.display = 'none';
}

function togglePTOST(entryId, shouldApply) {
    const entry = ReliabilityDataService.getLeaveEntryById(entryId);
    
    if (!entry) {
        alert('Entry not found');
        return;
    }
    
    // Check if PTOST can be applied
    if (shouldApply) {
        const allEntries = ReliabilityDataService.getAllLeaveEntries();
        const canUse = PTOSTService.canApplyPTOST(currentEmployee, entry.minutesMissed, allEntries);
        
        if (!canUse.allowed) {
            alert(`⚠️ ${canUse.message}`);
            updateLeaveHistory(); // Reset checkbox
            return;
        }
    }
    
    // Update entry
    entry.ptostApplied = shouldApply;
    entry.lastModifiedBy = currentSupervisor;
    entry.lastModifiedAt = new Date().toISOString();
    
    ReliabilityDataService.saveLeaveEntry(entry);
    
    // Log specific audit for PTOST toggle
    ReliabilityDataService.logAudit({
        entityType: 'LeaveEntry',
        entityId: entryId,
        action: 'PTOST_TOGGLED',
        performedBy: currentSupervisor,
        changeDetails: { ptostApplied: shouldApply, entryDate: entry.leaveDate }
    });
    
    // Refresh displays
    updatePTOSTBalance();
    updateReliabilitySummary();
    updateLeaveHistory();
}

window.togglePTOST = togglePTOST;

function deleteLeaveEntry(entryId) {
    const entry = ReliabilityDataService.getLeaveEntryById(entryId);
    
    if (!confirm(`Delete leave entry from ${ReliabilityUtils.formatDate(entry.leaveDate)}?`)) {
        return;
    }
    
    const reason = prompt('Reason for deletion (optional):');
    
    ReliabilityDataService.deleteLeaveEntry(entryId, currentSupervisor, reason || 'Deleted by supervisor');
    
    // Refresh displays
    updatePTOSTBalance();
    updateReliabilitySummary();
    updateLeaveHistory();
}

window.deleteLeaveEntry = deleteLeaveEntry;

function editLeaveEntry(entryId) {
    alert('Edit functionality coming soon! For now, you can delete and re-add the entry.');
}

window.editLeaveEntry = editLeaveEntry;

// ============================================
// EMAIL COMPOSITION
// ============================================
function openEmailComposer() {
    showSection('emailCompositionSection');
    
    document.getElementById('emailRecipientName').textContent = currentEmployee;
    
    // Populate leave entries for selection
    const entries = ReliabilityDataService.getLeaveEntriesForEmployee(currentEmployee);
    document.getElementById('emailLeaveSelection').innerHTML = entries
        .filter(e => !e.isDeleted)
        .slice(0, 10) // Last 10 entries
        .map(entry => `
            <label style="display: block; padding: 8px; cursor: pointer;">
                <input type="checkbox" value="${entry.entryId}" class="email-entry-checkbox" style="margin-right: 8px;">
                ${ReliabilityUtils.formatDate(entry.leaveDate)} - ${LeaveCalculationService.formatMinutesAsHours(entry.minutesMissed)} 
                (${entry.leaveType}${entry.ptostApplied ? ', PTOST' : ''})
            </label>
        `).join('');
    
    // Set default template
    handleEmailTemplateChange();
}

function closeEmailComposer() {
    showSection('employeeDetailSection');
}

function handleEmailTemplateChange() {
    const template = document.getElementById('emailTemplate').value;
    const allEntries = ReliabilityDataService.getAllLeaveEntries();
    const balance = PTOSTService.getCurrentBalance(currentEmployee, allEntries);
    const analysis = ReliabilityAnalysisService.calculateReliabilityHours(
        currentEmployee,
        allEntries,
        currentDateRange.startDate,
        currentDateRange.endDate
    );
    
    let subject = '';
    let body = '';
    
    switch(template) {
        case 'ptost_offer':
            subject = 'PTOST Available for Recent Absence';
            body = `Hi ${currentEmployee},

I noticed you missed some time recently. These absences are currently marked as unplanned.

You have ${LeaveCalculationService.formatMinutesAsHours(balance.remainingMinutes)} of PTOST remaining (out of 40 hours). Would you like to use PTOST to cover any of these absences?

Please let me know, and I'll update the records.

Thanks,
${currentSupervisor}`;
            break;
            
        case 'balance_warning':
            subject = 'PTOST Balance Update';
            body = `Hi ${currentEmployee},

I wanted to give you an update on your PTOST balance.

Current Balance: ${LeaveCalculationService.formatMinutesAsHours(balance.remainingMinutes)} remaining
Used This Year: ${LeaveCalculationService.formatMinutesAsHours(balance.usedMinutes)}

${balance.percentUsed >= 75 ? 'Please be mindful of your remaining balance. Additional unplanned absences may require pre-scheduling or could affect your reliability.' : ''}

Let me know if you have any questions.

Thanks,
${currentSupervisor}`;
            break;
            
        case 'reliability_concern':
            subject = 'Attendance Discussion';
            body = `Hi ${currentEmployee},

I'd like to schedule some time to discuss your recent attendance. 

Current reliability hours: ${analysis.reliabilityHours.toFixed(1)} hours

I want to understand if there are any challenges you're facing and how we can support you in improving attendance.

Please let me know when you're available to chat.

Thanks,
${currentSupervisor}`;
            break;
            
        case 'custom':
            subject = '';
            body = `Hi ${currentEmployee},\n\n\n\nThanks,\n${currentSupervisor}`;
            break;
    }
    
    document.getElementById('emailSubject').value = subject;
    document.getElementById('emailBody').value = body;
}

function handleSendEmail() {
    const subject = document.getElementById('emailSubject').value.trim();
    const body = document.getElementById('emailBody').value.trim();
    const template = document.getElementById('emailTemplate').value;
    
    if (!subject || !body) {
        alert('Please enter both subject and message');
        return;
    }
    
    // Get selected leave entries
    const selectedEntries = Array.from(document.querySelectorAll('.email-entry-checkbox:checked'))
        .map(cb => cb.value);
    
    if (!confirm(`Send this email to ${currentEmployee}?\n\nSubject: ${subject}\n\nThis will be logged in the system.`)) {
        return;
    }
    
    // Save email to log
    const emailData = {
        employeeName: currentEmployee,
        sentBy: currentSupervisor,
        emailType: template,
        subject,
        bodyText: body,
        relatedLeaveEntryIds: selectedEntries
    };
    
    ReliabilityDataService.saveEmail(emailData);
    
    alert('✅ Email logged successfully!\n\nNote: This tool does not actually send emails. Copy the text and send through your email system.');
    
    // Offer to copy to clipboard
    if (confirm('Copy email to clipboard?')) {
        const emailText = `To: ${currentEmployee}\nSubject: ${subject}\n\n${body}`;
        navigator.clipboard.writeText(emailText).then(() => {
            alert('📋 Email copied to clipboard!');
        });
    }
    
    closeEmailComposer();
    updateEmailHistory();
}

// ============================================
// DATA MANAGEMENT
// ============================================
function exportData() {
    const data = ReliabilityDataService.exportAllData();
    const dataStr = JSON.stringify(data, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Reliability-Tracker-Backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
}

function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const data = JSON.parse(event.target.result);
            
            if (!confirm(`Import data from backup?\n\nThis will replace all current data. Make sure you've backed up first!`)) {
                return;
            }
            
            ReliabilityDataService.importAllData(data);
            alert('✅ Data imported successfully!');
            
            // Refresh displays
            populateSupervisorSelect();
            if (currentSupervisor) {
                populateEmployeeSelect();
            }
            if (currentEmployee) {
                showEmployeeDetail();
            }
        } catch (error) {
            alert('❌ Error importing data: ' + error.message);
        }
    };
    reader.readAsText(file);
    
    // Reset file input
    e.target.value = '';
}

function deleteAllData() {
    if (!confirm('⚠️ DELETE ALL DATA?\n\nThis will permanently delete all employees, leave entries, emails, and audit logs.\n\nThis action CANNOT be undone!')) {
        return;
    }
    
    if (!confirm('Are you absolutely sure? This is your last chance!')) {
        return;
    }
    
    const confirmText = prompt('Type "DELETE ALL" to confirm:');
    if (confirmText !== 'DELETE ALL') {
        alert('Deletion cancelled.');
        return;
    }
    
    ReliabilityDataService.clearAllData();
    alert('✅ All data has been deleted.');
    
    // Reset UI
    currentSupervisor = null;
    currentEmployee = null;
    populateSupervisorSelect();
    showSection('employeeSelectionSection');
}

// ============================================
// TEAM MEMBER MANAGEMENT
// ============================================

function renderTeamMembersManagementList() {
    if (!currentSupervisor) {
        return;
    }
    
    const employees = ReliabilityDataService.getSupervisorTeams()[currentSupervisor] || [];
    const container = document.getElementById('teamMembersManagementList');
    
    if (employees.length === 0) {
        container.innerHTML = '<div style="padding: 20px; text-align: center; color: #999;">No team members yet. Add one above!</div>';
        return;
    }
    
    container.innerHTML = employees.map(empName => {
        const employee = ReliabilityDataService.getEmployees().find(e => e.name === empName);
        if (!employee) return '';
        
        const ptostBalance = PTOSTService.getCurrentBalance(empName);
        
        return `
            <div style="padding: 12px; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: center; background: white;">
                <div style="flex: 1;">
                    <strong style="color: #2e7d32; font-size: 1.1em;">${employee.name}</strong>
                    <div style="font-size: 0.85em; color: #666; margin-top: 4px;">
                        <span style="margin-right: 15px;">💼 PTOST Balance: ${ptostBalance.remaining}h / ${ptostBalance.total}h</span>
                    </div>
                </div>
                <div style="display: flex; gap: 8px;">
                    <button type="button" class="edit-employee-pto-btn btn-secondary" data-name="${employee.name}" style="background: #2196F3; color: white; padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85em;">✏️ Edit PTO</button>
                    <button type="button" class="delete-team-member-btn btn-secondary" data-name="${employee.name}" style="background: #dc3545; color: white; padding: 6px 12px; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85em;">🗑️ Delete</button>
                </div>
            </div>
        `;
    }).join('');
    
    // Add event listeners
    document.querySelectorAll('.edit-employee-pto-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const name = e.currentTarget.dataset.name;
            editEmployeePTO(name);
        });
    });
    
    document.querySelectorAll('.delete-team-member-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const name = e.currentTarget.dataset.name;
            deleteTeamMember(name);
        });
    });
}

function editEmployeePTO(employeeName) {
    const employee = ReliabilityDataService.getEmployees().find(e => e.name === employeeName);
    if (!employee) return;
    
    const ptostBalance = PTOSTService.getCurrentBalance(employeeName);
    const currentPTO = ptostBalance.total;
    
    const newPTO = prompt(`Edit starting PTOST hours for ${employeeName}:\n\nCurrent: ${currentPTO} hours\n\nEnter new value:`, currentPTO);
    
    if (newPTO === null) return; // Cancelled
    
    const ptoNumber = parseFloat(newPTO);
    if (isNaN(ptoNumber) || ptoNumber < 0 || ptoNumber > 120) {
        alert('❌ Invalid PTO value. Must be between 0 and 120 hours.');
        return;
    }
    
    // Update employee schedule with new initial PTOST
    const schedule = ReliabilityDataService.getEmployeeSchedule(employeeName);
    if (schedule) {
        schedule.initialPTOST = ptoNumber;
        ReliabilityDataService.saveEmployeeSchedule(schedule);
    } else {
        // Create new schedule with default values
        ReliabilityDataService.saveEmployeeSchedule({
            employeeName: employeeName,
            shiftStart: '08:00',
            shiftEnd: '17:00',
            lunchDuration: 30,
            workDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
            initialPTOST: ptoNumber
        });
    }
    
    alert(`✅ Updated ${employeeName}'s starting PTOST to ${ptoNumber} hours`);
    renderTeamMembersManagementList();
}

function deleteTeamMember(employeeName) {
    if (!confirm(`Are you sure you want to remove ${employeeName} from your team?\n\nThis will also delete all their leave entries and data.`)) {
        return;
    }
    
    // Delete employee and all related data
    const employees = ReliabilityDataService.getEmployees();
    const employee = employees.find(e => e.name === employeeName);
    
    if (employee) {
        // Delete all leave entries
        const entries = ReliabilityDataService.getLeaveEntriesForEmployee(employeeName);
        entries.forEach(entry => {
            ReliabilityDataService.deleteLeaveEntry(entry.id);
        });
        
        // Delete employee
        ReliabilityDataService.deleteEmployee(employee.id);
        
        // Remove from supervisor team
        ReliabilityDataService.removeTeamMember(currentSupervisor, employeeName);
    }
    
    alert(`✅ ${employeeName} has been removed from your team.`);
    renderTeamMembersManagementList();
    populateEmployeeSelect();
}

function handleAddTeamMember() {
    console.log('handleAddTeamMember called');
    console.log('Current supervisor:', currentSupervisor);
    
    const nameInput = document.getElementById('newTeamMemberName');
    const ptoInput = document.getElementById('initialPTO');
    const messageDiv = document.getElementById('addTeamMemberMessage');
    
    console.log('Name input:', nameInput?.value);
    console.log('PTO input:', ptoInput?.value);
    
    const name = nameInput.value.trim();
    const initialPTO = parseFloat(ptoInput.value) || 40;
    
    if (!name) {
        messageDiv.textContent = '❌ Please enter a name';
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.style.borderLeft = '4px solid #dc3545';
        return;
    }
    
    if (!currentSupervisor) {
        messageDiv.textContent = '❌ Please select yourself as supervisor first';
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.style.borderLeft = '4px solid #dc3545';
        return;
    }
    
    // Check if employee already exists
    const existingEmployees = ReliabilityDataService.getEmployees();
    if (existingEmployees.find(e => e.name.toLowerCase() === name.toLowerCase())) {
        messageDiv.textContent = `❌ ${name} already exists in the system`;
        messageDiv.style.display = 'block';
        messageDiv.style.background = '#f8d7da';
        messageDiv.style.color = '#721c24';
        messageDiv.style.borderLeft = '4px solid #dc3545';
        return;
    }
    
    // Create new employee
    const newEmployee = {
        id: Date.now().toString(),
        name: name,
        email: '',
        hireDate: new Date().toISOString().split('T')[0],
        supervisor: currentSupervisor
    };
    
    ReliabilityDataService.saveEmployee(newEmployee);
    
    // Add to supervisor's team
    ReliabilityDataService.addTeamMember(currentSupervisor, name);
    
    // Create schedule with initial PTOST
    ReliabilityDataService.saveEmployeeSchedule({
        employeeName: name,
        shiftStart: '08:00',
        shiftEnd: '17:00',
        lunchDuration: 30,
        workDays: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        initialPTOST: initialPTO
    });
    
    messageDiv.textContent = `✅ Added ${name} with ${initialPTO} hours starting PTOST`;
    messageDiv.style.display = 'block';
    messageDiv.style.background = '#d4edda';
    messageDiv.style.color = '#155724';
    messageDiv.style.borderLeft = '4px solid #28a745';
    
    // Clear inputs
    nameInput.value = '';
    ptoInput.value = '40';
    
    // Refresh lists
    renderTeamMembersManagementList();
    populateEmployeeSelect();
    
    setTimeout(() => {
        messageDiv.style.display = 'none';
    }, 3000);
}
