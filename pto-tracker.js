/* ========================================
   PTO RELIABILITY TRACKER
   Track associate PTO and analyze reliability
   ======================================== */

// ============================================
// GLOBAL STATE
// ============================================
let ptoData = [];
let currentView = 'addPTO';

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', function() {
    loadPTOData();
    initializeEventListeners();
    showSection('addPTOSection');
    updateRecentEntries();
    populateEmployeeDatalist();
});

// ============================================
// EVENT LISTENERS
// ============================================
function initializeEventListeners() {
    // Navigation buttons
    document.getElementById('addPTOBtn').addEventListener('click', () => showSection('addPTOSection'));
    document.getElementById('viewReportsBtn').addEventListener('click', () => {
        showSection('reportsSection');
        generateReport();
    });
    document.getElementById('exportPTOBtn').addEventListener('click', exportToExcel);
    document.getElementById('managePTODataBtn').addEventListener('click', () => showSection('managePTODataSection'));

    // Form handlers
    document.getElementById('ptoEntryForm').addEventListener('submit', handlePTOSubmit);
    document.getElementById('clearFormBtn').addEventListener('click', clearForm);

    // Report filters
    document.getElementById('reportEmployeeSelect').addEventListener('change', generateReport);
    document.getElementById('applyFilterBtn').addEventListener('click', generateReport);

    // Data management
    document.getElementById('exportPTODataBtn').addEventListener('click', exportPTOData);
    document.getElementById('importPTODataBtn').addEventListener('click', () => {
        document.getElementById('ptoDataFileInput').click();
    });
    document.getElementById('ptoDataFileInput').addEventListener('change', importPTOData);
    document.getElementById('deleteAllPTOBtn').addEventListener('click', deleteAllPTOData);
}

// ============================================
// SECTION MANAGEMENT
// ============================================
function showSection(sectionId) {
    const sections = ['addPTOSection', 'reportsSection', 'managePTODataSection'];
    sections.forEach(id => {
        const section = document.getElementById(id);
        if (section) {
            section.style.display = id === sectionId ? 'block' : 'none';
        }
    });
    
    if (sectionId === 'reportsSection') {
        populateReportEmployeeSelect();
    }
}

// ============================================
// DATA MANAGEMENT
// ============================================
function loadPTOData() {
    const saved = localStorage.getItem('ptoTrackerData');
    if (saved) {
        try {
            ptoData = JSON.parse(saved);
        } catch (e) {
            console.error('Error loading PTO data:', e);
            ptoData = [];
        }
    }
}

function savePTOData() {
    localStorage.setItem('ptoTrackerData', JSON.stringify(ptoData));
}

// ============================================
// FORM HANDLING
// ============================================
function handlePTOSubmit(e) {
    e.preventDefault();
    
    const entry = {
        id: Date.now(),
        employeeName: document.getElementById('employeeName').value.trim(),
        date: document.getElementById('ptoDate').value,
        hours: parseFloat(document.getElementById('ptoHours').value),
        type: document.getElementById('ptoType').value,
        notes: document.getElementById('ptoNotes').value.trim(),
        createdAt: new Date().toISOString()
    };
    
    ptoData.push(entry);
    savePTOData();
    
    // Show success message
    alert(`✅ PTO entry saved for ${entry.employeeName}`);
    
    clearForm();
    updateRecentEntries();
    populateEmployeeDatalist();
}

function clearForm() {
    document.getElementById('ptoEntryForm').reset();
    document.getElementById('ptoHours').value = 8;
}

function populateEmployeeDatalist() {
    const employeeNames = [...new Set(ptoData.map(entry => entry.employeeName))].sort();
    const datalist = document.getElementById('employeeList');
    datalist.innerHTML = employeeNames.map(name => `<option value="${name}">`).join('');
}

// ============================================
// RECENT ENTRIES
// ============================================
function updateRecentEntries() {
    const container = document.getElementById('recentEntriesList');
    
    if (ptoData.length === 0) {
        container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">No PTO entries yet. Add your first entry above!</p>';
        return;
    }
    
    const recentEntries = [...ptoData]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 10);
    
    container.innerHTML = `
        <div style="overflow-x: auto;">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>Employee</th>
                        <th>Date</th>
                        <th>Hours</th>
                        <th>Type</th>
                        <th>Notes</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${recentEntries.map(entry => `
                        <tr>
                            <td>${entry.employeeName}</td>
                            <td>${formatDate(entry.date)}</td>
                            <td>${entry.hours}</td>
                            <td><span class="badge badge-${entry.type.toLowerCase()}">${entry.type}</span></td>
                            <td>${entry.notes || '-'}</td>
                            <td>
                                <button onclick="deleteEntry(${entry.id})" class="btn-danger-small" title="Delete">🗑️</button>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

function deleteEntry(entryId) {
    if (!confirm('Are you sure you want to delete this PTO entry?')) return;
    
    ptoData = ptoData.filter(entry => entry.id !== entryId);
    savePTOData();
    updateRecentEntries();
    
    if (document.getElementById('reportsSection').style.display !== 'none') {
        generateReport();
    }
}

// Make deleteEntry available globally
window.deleteEntry = deleteEntry;

// ============================================
// REPORTS & ANALYTICS
// ============================================
function populateReportEmployeeSelect() {
    const select = document.getElementById('reportEmployeeSelect');
    const employeeNames = [...new Set(ptoData.map(entry => entry.employeeName))].sort();
    
    select.innerHTML = '<option value="">-- All Employees --</option>' +
        employeeNames.map(name => `<option value="${name}">${name}</option>`).join('');
}

function generateReport() {
    const selectedEmployee = document.getElementById('reportEmployeeSelect').value;
    const startDate = document.getElementById('reportStartDate').value;
    const endDate = document.getElementById('reportEndDate').value;
    
    // Filter data
    let filteredData = [...ptoData];
    
    if (selectedEmployee) {
        filteredData = filteredData.filter(entry => entry.employeeName === selectedEmployee);
    }
    
    if (startDate) {
        filteredData = filteredData.filter(entry => entry.date >= startDate);
    }
    
    if (endDate) {
        filteredData = filteredData.filter(entry => entry.date <= endDate);
    }
    
    // Generate summary statistics
    generateSummaryStats(filteredData, selectedEmployee);
    
    // Generate detailed table
    generatePTOTable(filteredData);
    
    // Generate reliability analysis
    if (selectedEmployee) {
        generateReliabilityAnalysis(filteredData, selectedEmployee);
    } else {
        document.getElementById('reliabilityAnalysis').innerHTML = '';
    }
}

function generateSummaryStats(data, selectedEmployee) {
    const container = document.getElementById('summaryStats');
    
    if (data.length === 0) {
        container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">No data for selected filters.</p>';
        return;
    }
    
    const totalHours = data.reduce((sum, entry) => sum + entry.hours, 0);
    const totalDays = totalHours / 8;
    const uniqueEmployees = new Set(data.map(entry => entry.employeeName)).size;
    
    const typeBreakdown = data.reduce((acc, entry) => {
        acc[entry.type] = (acc[entry.type] || 0) + entry.hours;
        return acc;
    }, {});
    
    container.innerHTML = `
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-value">${totalHours.toFixed(1)}</div>
                <div class="stat-label">Total Hours</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${totalDays.toFixed(1)}</div>
                <div class="stat-label">Total Days</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${data.length}</div>
                <div class="stat-label">Total Entries</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${selectedEmployee ? '1' : uniqueEmployees}</div>
                <div class="stat-label">Employee${selectedEmployee ? '' : 's'}</div>
            </div>
        </div>
        
        <div style="margin-top: 20px; padding: 15px; background: white; border-radius: 8px; border: 2px solid #2196F3;">
            <h4 style="margin-top: 0;">PTO Type Breakdown</h4>
            <div class="type-breakdown">
                ${Object.entries(typeBreakdown).map(([type, hours]) => `
                    <div class="type-row">
                        <span class="badge badge-${type.toLowerCase()}">${type}</span>
                        <span>${hours.toFixed(1)} hours (${(hours/8).toFixed(1)} days)</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
}

function generatePTOTable(data) {
    const tbody = document.getElementById('ptoTableBody');
    
    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: #999;">No records found</td></tr>';
        return;
    }
    
    const sortedData = [...data].sort((a, b) => new Date(b.date) - new Date(a.date));
    
    tbody.innerHTML = sortedData.map(entry => `
        <tr>
            <td>${entry.employeeName}</td>
            <td>${formatDate(entry.date)}</td>
            <td>${entry.hours}</td>
            <td><span class="badge badge-${entry.type.toLowerCase()}">${entry.type}</span></td>
            <td>${entry.notes || '-'}</td>
            <td>
                <button onclick="deleteEntry(${entry.id})" class="btn-danger-small" title="Delete">🗑️</button>
            </td>
        </tr>
    `).join('');
}

function generateReliabilityAnalysis(data, employeeName) {
    const container = document.getElementById('reliabilityAnalysis');
    
    if (data.length === 0) {
        container.innerHTML = '';
        return;
    }
    
    const totalHours = data.reduce((sum, entry) => sum + entry.hours, 0);
    const totalDays = totalHours / 8;
    const occurrences = data.length;
    
    // Calculate patterns
    const dates = data.map(entry => new Date(entry.date)).sort((a, b) => a - b);
    const daysBetween = [];
    for (let i = 1; i < dates.length; i++) {
        const diff = Math.floor((dates[i] - dates[i-1]) / (1000 * 60 * 60 * 24));
        daysBetween.push(diff);
    }
    
    const avgDaysBetween = daysBetween.length > 0 
        ? (daysBetween.reduce((a, b) => a + b, 0) / daysBetween.length).toFixed(1)
        : 'N/A';
    
    // Determine reliability status
    let reliabilityStatus = 'Good';
    let statusColor = '#4CAF50';
    let statusMessage = 'PTO usage is within normal range.';
    
    if (occurrences >= 10 || totalDays >= 15) {
        reliabilityStatus = 'Needs Attention';
        statusColor = '#ff9800';
        statusMessage = 'High PTO usage. Consider discussing attendance patterns.';
    }
    
    if (occurrences >= 15 || totalDays >= 20) {
        reliabilityStatus = 'Concern';
        statusColor = '#f44336';
        statusMessage = 'Very high PTO usage. Immediate conversation recommended.';
    }
    
    container.innerHTML = `
        <div style="padding: 20px; background: white; border-radius: 8px; border: 3px solid ${statusColor};">
            <h3 style="margin-top: 0; color: ${statusColor};">Reliability Analysis: ${employeeName}</h3>
            
            <div class="reliability-status" style="background: ${statusColor}20; padding: 15px; border-radius: 5px; margin-bottom: 20px;">
                <div style="font-size: 1.5em; font-weight: bold; color: ${statusColor};">${reliabilityStatus}</div>
                <div style="margin-top: 5px; color: #666;">${statusMessage}</div>
            </div>
            
            <div class="stats-grid">
                <div class="stat-card">
                    <div class="stat-value">${occurrences}</div>
                    <div class="stat-label">PTO Occurrences</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${totalDays.toFixed(1)}</div>
                    <div class="stat-label">Total Days Used</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${avgDaysBetween}</div>
                    <div class="stat-label">Avg Days Between</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${(totalHours / occurrences).toFixed(1)}</div>
                    <div class="stat-label">Avg Hours Per Entry</div>
                </div>
            </div>
        </div>
    `;
}

// ============================================
// DATA EXPORT/IMPORT
// ============================================
function exportToExcel() {
    if (ptoData.length === 0) {
        alert('No data to export!');
        return;
    }
    
    // Prepare data for export
    const exportData = ptoData.map(entry => ({
        'Employee Name': entry.employeeName,
        'Date': formatDate(entry.date),
        'Hours': entry.hours,
        'Type': entry.type,
        'Notes': entry.notes || '',
        'Created At': new Date(entry.createdAt).toLocaleString()
    }));
    
    // Convert to CSV
    const headers = Object.keys(exportData[0]);
    const csv = [
        headers.join(','),
        ...exportData.map(row => headers.map(header => {
            const value = row[header];
            return `"${String(value).replace(/"/g, '""')}"`;
        }).join(','))
    ].join('\n');
    
    // Download
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PTO-Data-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
}

function exportPTOData() {
    if (ptoData.length === 0) {
        alert('No data to export!');
        return;
    }
    
    const dataStr = JSON.stringify(ptoData, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PTO-Backup-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
}

function importPTOData(e) {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(event) {
        try {
            const imported = JSON.parse(event.target.result);
            if (Array.isArray(imported)) {
                if (confirm(`This will import ${imported.length} PTO entries. Continue?`)) {
                    ptoData = imported;
                    savePTOData();
                    updateRecentEntries();
                    populateEmployeeDatalist();
                    alert('✅ Data imported successfully!');
                }
            } else {
                alert('❌ Invalid data format!');
            }
        } catch (error) {
            alert('❌ Error importing data: ' + error.message);
        }
    };
    reader.readAsText(file);
    
    // Reset file input
    e.target.value = '';
}

function deleteAllPTOData() {
    if (!confirm('⚠️ Are you sure you want to delete ALL PTO data? This cannot be undone!')) return;
    if (!confirm('This is your last chance! Really delete everything?')) return;
    
    ptoData = [];
    savePTOData();
    updateRecentEntries();
    alert('✅ All PTO data has been deleted.');
    showSection('addPTOSection');
}

// ============================================
// UTILITY FUNCTIONS
// ============================================
function formatDate(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
    });
}
