(function() {
'use strict';
// ============================================
// PTO / PAYROLL TIME-OFF TRACKER (SIMPLIFIED)
// Upload payroll Excel, view missed days per employee
// ============================================

var PTO_TRACKING_YEAR = 2026;
var STORAGE_PREFIX = 'devCoachingTool_';

var PAYROLL_TRC_MAP = {
    'pto': 'PTO',
    'ptost': 'PTOST',
    'pto unscheduled': 'PTO Unsched',
    'std': 'STD',
    'fmlnp': 'FMLA',
    'brv': 'Bereavement',
    'ppl': 'Parental Leave',
    'nop': 'No Pay'
};

var TRC_COLORS = {
    'PTO':             { bg: '#e8f5e9', text: '#1b5e20' },
    'PTOST':           { bg: '#e3f2fd', text: '#0d47a1' },
    'PTO Unsched':     { bg: '#fff3e0', text: '#e65100' },
    'STD':             { bg: '#e0f2f1', text: '#004d40' },
    'FMLA':            { bg: '#fce4ec', text: '#880e4f' },
    'Bereavement':     { bg: '#ede7f6', text: '#4a148c' },
    'Parental Leave':  { bg: '#e8eaf6', text: '#1a237e' },
    'No Pay':          { bg: '#efebe9', text: '#3e2723' }
};

function showToast(msg, ms) {
    if (typeof window.showToast === 'function') { window.showToast(msg, ms); return; }
    console.log('[PTO]', msg);
}

// ============================================
// STORAGE
// ============================================

function loadPtoStore() {
    const storage = window.DevCoachModules?.storage;
    if (storage?.loadPtoTracker) return storage.loadPtoTracker() || { associates: {} };
    try {
        const raw = localStorage.getItem(STORAGE_PREFIX + 'ptoTracker');
        return raw ? JSON.parse(raw) : { associates: {} };
    } catch (e) { return { associates: {} }; }
}

function savePtoStore(store) {
    const storage = window.DevCoachModules?.storage;
    let ok = false;
    if (storage?.savePtoTracker) {
        ok = storage.savePtoTracker(store);
    } else {
        try {
            localStorage.setItem(STORAGE_PREFIX + 'ptoTracker', JSON.stringify(store));
            ok = true;
        } catch (e) {
            console.error('[PTO] savePtoStore failed:', e);
        }
    }
    if (!ok) {
        console.error('[PTO] Failed to save PTO data - localStorage may be full');
        showToast('ERROR: Could not save payroll data. Storage may be full.', 8000);
    }
    if (ok && typeof window.queueRepoSync === 'function') {
        window.queueRepoSync('pto tracker updated');
    }
    return ok;
}

// ============================================
// TEAM FILTER
// ============================================

function getTeamFilterContext() {
    var teamFilter = window.DevCoachModules?.teamFilter;
    if (teamFilter?.getTeamSelectionContext) return teamFilter.getTeamSelectionContext();
    return { isFiltering: false, selectedSet: null };
}

function isIncludedByTeamFilter(name, ctx) {
    var teamFilter = window.DevCoachModules?.teamFilter;
    if (teamFilter?.isAssociateIncludedByTeamFilter) return teamFilter.isAssociateIncludedByTeamFilter(name, ctx);
    return true;
}

// ============================================
// EMPLOYEE LIST
// ============================================

function getEmployeeNames() {
    const filterCtx = getTeamFilterContext();
    const names = new Set();

    // From payroll store
    const store = loadPtoStore();
    Object.keys(store.associates || {}).forEach(n => {
        if (isIncludedByTeamFilter(n, filterCtx)) names.add(n);
    });

    // From weekly/ytd data
    const weeklyData = window.DevCoachModules?.storage?.loadWeeklyData?.() || {};
    const ytdData = window.DevCoachModules?.storage?.loadYtdData?.() || {};
    [weeklyData, ytdData].forEach(source => {
        Object.values(source).forEach(period => {
            if (!Array.isArray(period?.employees)) return;
            period.employees.forEach(emp => {
                const name = String(emp?.name || '').trim();
                if (name && isIncludedByTeamFilter(name, filterCtx)) names.add(name);
            });
        });
    });

    return Array.from(names).sort((a, b) => a.localeCompare(b));
}

// ============================================
// EXCEL PARSING UTILITIES
// ============================================

function cleanUnicodeControl(str) {
    // Strip directional/formatting Unicode
    str = str.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
    // Strip common garbage characters from Excel exports (©, ®, ™, ●, ■, □, etc.)
    str = str.replace(/[©®™●■□▪▫◆◇○◎★☆•‣⁃△▲▼►◄→←↑↓]/g, '');
    // Strip any remaining non-printable or symbol characters at start/end of string
    str = str.replace(/^[^\w\s]+|[^\w\s]+$/g, '');
    return str.trim();
}

function parseExcelDate(raw) {
    if (raw == null || raw === '') return null;

    if (raw instanceof Date && !isNaN(raw.getTime())) {
        return raw.toISOString().slice(0, 10);
    }

    if (typeof raw === 'number' && raw > 40000 && raw < 60000) {
        const date = new Date((raw - 25569) * 86400000);
        if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    }

    const str = String(raw).trim();

    const isoMatch = str.match(/^(\d{4}-\d{2}-\d{2})/);
    if (isoMatch) return isoMatch[1];

    const usMatch = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (usMatch) return `${usMatch[3]}-${String(usMatch[1]).padStart(2, '0')}-${String(usMatch[2]).padStart(2, '0')}`;

    const usShort = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
    if (usShort) {
        const yr = parseInt(usShort[3], 10);
        const fullYear = yr >= 50 ? 1900 + yr : 2000 + yr;
        return `${fullYear}-${String(usShort[1]).padStart(2, '0')}-${String(usShort[2]).padStart(2, '0')}`;
    }

    const MONTHS = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
                     jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
    const namedMatch = str.match(/^(\d{1,2})-([A-Za-z]+)-(\d{2,4})$/);
    if (namedMatch) {
        const monthKey = namedMatch[2].slice(0, 3).toLowerCase();
        const month = MONTHS[monthKey];
        if (month) {
            let year = parseInt(namedMatch[3], 10);
            if (year < 100) year = year >= 50 ? 1900 + year : 2000 + year;
            return `${year}-${month}-${String(namedMatch[1]).padStart(2, '0')}`;
        }
    }

    const serial = parseFloat(str);
    if (Number.isFinite(serial) && serial > 40000 && serial < 60000) {
        const date = new Date((serial - 25569) * 86400000);
        if (!isNaN(date.getTime())) return date.toISOString().slice(0, 10);
    }

    return null;
}

function resolveEmployeeName(rawName, nameLookup) {
    const lower = rawName.toLowerCase();
    if (nameLookup[lower]) return nameLookup[lower];
    const titleCased = rawName.replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    nameLookup[lower] = titleCased;
    return titleCased;
}

// ============================================
// EXCEL IMPORT
// ============================================

function importPayrollExcel(file) {
    if (!file) return;
    const fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
        showToast('Please upload an Excel file (.xlsx or .xls)', 4000);
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: true, defval: '' });
            processPayrollExcelRows(rows);
        } catch (err) {
            console.error('Payroll Excel import error:', err);
            showToast('Failed to read Excel file. Check format and try again.', 5000);
        }
    };
    reader.onerror = function() { showToast('Failed to read file', 4000); };
    reader.readAsArrayBuffer(file);
}

function processPayrollExcelRows(rows) {
    // Find header row
    let headerIdx = -1;
    let colMap = {};
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i];
        if (!Array.isArray(row)) continue;
        const lower = row.map(c => String(c || '').trim().toLowerCase());
        const nameIdx = lower.indexOf('name');
        const trcIdx = lower.indexOf('trc');
        if (nameIdx >= 0 && trcIdx >= 0) {
            headerIdx = i;
            colMap = {
                name: nameIdx,
                date: lower.indexOf('date'),
                trc: trcIdx,
                quantity: lower.indexOf('quantity'),
                status: lower.indexOf('status')
            };
            break;
        }
    }

    if (headerIdx < 0) {
        showToast('Could not find header row (expected Name, TRC, Quantity columns)', 5000);
        return;
    }

    console.log('[Payroll Excel] Header at row', headerIdx, 'colMap:', JSON.stringify(colMap));

    // Build name lookup from existing data
    const store = loadPtoStore();
    const nameLookup = {};
    Object.keys(store.associates || {}).forEach(n => { nameLookup[n.toLowerCase()] = n; });

    const weeklyData = window.DevCoachModules?.storage?.loadWeeklyData?.() || {};
    const ytdData = window.DevCoachModules?.storage?.loadYtdData?.() || {};
    [weeklyData, ytdData].forEach(source => {
        Object.values(source).forEach(period => {
            if (!Array.isArray(period?.employees)) return;
            period.employees.forEach(emp => {
                const name = String(emp?.name || '').trim();
                if (name && !nameLookup[name.toLowerCase()]) nameLookup[name.toLowerCase()] = name;
            });
        });
    });

    // Parse rows
    const byEmployee = {};
    let regCount = 0;
    let skippedCount = 0;

    for (let i = headerIdx + 1; i < rows.length; i++) {
        const row = rows[i];
        if (!Array.isArray(row)) continue;

        const rawName = cleanUnicodeControl(String(row[colMap.name] || '').trim());
        if (!rawName) continue;

        const rawTrc = cleanUnicodeControl(String(row[colMap.trc] || '').trim());
        if (!rawTrc) continue;

        const trcLower = rawTrc.toLowerCase();
        if (trcLower === 'reg') { regCount++; continue; }
        if (trcLower === 'trc') continue;

        const mappedLabel = PAYROLL_TRC_MAP[trcLower];
        if (!mappedLabel) { skippedCount++; continue; }

        const rawQty = cleanUnicodeControl(String(row[colMap.quantity] || '').trim());
        const hours = parseFloat(rawQty);
        if (!Number.isFinite(hours) || hours <= 0) { skippedCount++; continue; }

        const rawDate = row[colMap.date];
        const isoDate = parseExcelDate(rawDate);
        if (!isoDate) { skippedCount++; continue; }

        const year = parseInt(isoDate.slice(0, 4), 10);
        if (year !== PTO_TRACKING_YEAR) continue;

        const rawStatus = cleanUnicodeControl(String(row[colMap.status] || '').trim());
        const resolvedName = resolveEmployeeName(rawName, nameLookup);

        if (!byEmployee[resolvedName]) byEmployee[resolvedName] = [];
        byEmployee[resolvedName].push({
            date: isoDate,
            hours: Math.round(hours * 100) / 100,
            trc: mappedLabel,
            payrollTrc: rawTrc,
            status: rawStatus
        });
    }

    const employeeNames = Object.keys(byEmployee);
    const resultsEl = document.getElementById('ptoPayrollExcelResults');

    if (!employeeNames.length) {
        showToast(`No time-off entries found. ${regCount} REG skipped, ${skippedCount} unparseable.`, 5000);
        if (resultsEl) {
            resultsEl.innerHTML = `<div style="padding:10px;border-radius:6px;background:#fff3cd;color:#856404;margin-top:8px;">
                No time-off entries found. ${regCount} REG rows skipped, ${skippedCount} unparseable.
            </div>`;
        }
        return;
    }

    // Save: overwrite payrollEntries for each employee
    if (!store.associates) store.associates = {};
    let totalAdded = 0;
    const summary = {};

    employeeNames.forEach(name => {
        if (!store.associates[name]) store.associates[name] = { payrollEntries: [] };
        store.associates[name].payrollEntries = byEmployee[name].map(entry => ({
            id: `payroll-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
            ...entry
        }));
        totalAdded += byEmployee[name].length;
        byEmployee[name].forEach(e => {
            summary[e.trc] = (summary[e.trc] || 0) + e.hours;
        });
    });

    const saved = savePtoStore(store);

    const summaryLines = Object.entries(summary).map(([trc, hrs]) => `${trc}: ${hrs.toFixed(1)}h`).join(', ');

    if (!saved) {
        if (resultsEl) {
            resultsEl.innerHTML = `<div style="padding:10px;border-radius:6px;background:#f8d7da;color:#842029;margin-top:8px;">
                <strong>ERROR: Could not save payroll data.</strong> Browser storage may be full.<br>
                Parsed ${totalAdded} entries for ${employeeNames.length} employees but save failed.<br>
                Try clearing old data or using a different browser.
            </div>`;
        }
        return;
    }

    // Verify the save actually persisted
    const verifyStore = loadPtoStore();
    const verifyName = employeeNames[0];
    const verifyEntries = verifyStore.associates?.[verifyName]?.payrollEntries || [];
    if (!verifyEntries.length) {
        console.error('[PTO] Save verification failed - data not persisted for', verifyName);
        if (resultsEl) {
            resultsEl.innerHTML = `<div style="padding:10px;border-radius:6px;background:#fff3cd;color:#856404;margin-top:8px;">
                <strong>Warning:</strong> Data may not have saved correctly. Please re-upload or check browser storage.
            </div>`;
        }
        return;
    }

    showToast(`Imported ${totalAdded} entries for ${employeeNames.length} employees`, 5000);

    if (resultsEl) {
        resultsEl.innerHTML = `<div style="padding:10px;border-radius:6px;background:#e8f5e9;color:#1b5e20;margin-top:8px;">
            <strong>Imported ${totalAdded} entries</strong> for ${employeeNames.length} employees<br>
            <span style="font-size:0.9em;">${summaryLines}</span>
        </div>`;
    }

    // Refresh view
    populateAssociateSelect();
    const select = document.getElementById('ptoAssociateSelect');
    if (select?.value) renderEmployeeEntries(select.value);
}

// ============================================
// UI: POPULATE DROPDOWN
// ============================================

function populateAssociateSelect() {
    const select = document.getElementById('ptoAssociateSelect');
    if (!select) return;

    const current = select.value;
    select.innerHTML = '<option value="">-- Choose an associate --</option>';

    const names = getEmployeeNames();
    const store = loadPtoStore();

    // Build case-insensitive lookup for store names
    const storeLookup = {};
    Object.keys(store.associates || {}).forEach(n => { storeLookup[n.toLowerCase()] = n; });

    names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
        // Try exact match first, then case-insensitive
        let entries = store.associates?.[name]?.payrollEntries || [];
        if (!entries.length) {
            const storeName = storeLookup[name.toLowerCase()];
            if (storeName) entries = store.associates[storeName]?.payrollEntries || [];
        }
        const count = entries.length;
        opt.textContent = count > 0 ? `${name} (${count})` : name;
        select.appendChild(opt);
    });

    if (current && names.includes(current)) {
        select.value = current;
    }
}

// ============================================
// UI: RENDER ENTRIES TABLE
// ============================================

function renderEmployeeEntries(employeeName) {
    const container = document.getElementById('ptoEntriesContainer');
    if (!container) return;

    if (!employeeName) {
        container.innerHTML = '';
        return;
    }

    const store = loadPtoStore();
    const storeNames = Object.keys(store.associates || {});
    const entries = (store.associates?.[employeeName]?.payrollEntries || [])
        .filter(e => e.date)
        .sort((a, b) => a.date.localeCompare(b.date));

    if (!entries.length) {
        // Check if it's a name mismatch
        const lowerName = employeeName.toLowerCase();
        const match = storeNames.find(n => n.toLowerCase() === lowerName);
        if (match && match !== employeeName) {
            console.warn('[PTO] Name mismatch: dropdown has "' + employeeName + '" but store has "' + match + '"');
            // Use the store name instead
            const fixedEntries = (store.associates[match]?.payrollEntries || [])
                .filter(e => e.date)
                .sort((a, b) => a.date.localeCompare(b.date));
            if (fixedEntries.length) {
                // Render with corrected name - recurse won't loop since store has the name
                renderEmployeeEntriesFromData(container, fixedEntries);
                return;
            }
        }
        console.log('[PTO] No entries for "' + employeeName + '". Store has ' + storeNames.length + ' associates:', storeNames.slice(0, 5).join(', '));
        container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:20px;">No payroll entries. Upload a timecard Excel above.</p>';
        return;
    }

    renderEmployeeEntriesFromData(container, entries);
}

function renderEmployeeEntriesFromData(container, entries) {
    // Summary by TRC
    const totals = {};
    let totalHours = 0;
    entries.forEach(e => {
        totals[e.trc] = (totals[e.trc] || 0) + (e.hours || 0);
        totalHours += (e.hours || 0);
    });

    let html = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">';
    Object.entries(totals).forEach(([trc, hrs]) => {
        const color = TRC_COLORS[trc] || { bg: '#f5f5f5', text: '#333' };
        html += `<span style="display:inline-block;padding:5px 12px;border-radius:16px;font-size:0.85em;font-weight:600;background:${color.bg};color:${color.text};">${trc}: ${hrs.toFixed(1)}h</span>`;
    });
    html += `<span style="display:inline-block;padding:5px 12px;border-radius:16px;font-size:0.85em;font-weight:600;background:#f5f5f5;color:#333;">Total: ${totalHours.toFixed(1)}h</span>`;
    html += '</div>';

    // Table
    html += `<table style="width:100%;border-collapse:collapse;font-size:0.9em;">
        <thead>
            <tr style="background:#f8f9fa;text-align:left;">
                <th style="padding:8px 10px;border-bottom:2px solid #dee2e6;">Date</th>
                <th style="padding:8px 10px;border-bottom:2px solid #dee2e6;">Code</th>
                <th style="padding:8px 10px;border-bottom:2px solid #dee2e6;">Hours</th>
                <th style="padding:8px 10px;border-bottom:2px solid #dee2e6;">Status</th>
            </tr>
        </thead>
        <tbody>`;

    entries.forEach(e => {
        const color = TRC_COLORS[e.trc] || { bg: '#f5f5f5', text: '#333' };
        const dateStr = formatDateDisplay(e.date);
        const statusColor = (e.status || '').toLowerCase().includes('approved') ? '#1b5e20' : '#e65100';
        html += `<tr style="border-bottom:1px solid #f0f0f0;">
            <td style="padding:7px 10px;">${dateStr}</td>
            <td style="padding:7px 10px;"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:0.88em;font-weight:600;background:${color.bg};color:${color.text};">${e.trc}</span></td>
            <td style="padding:7px 10px;">${e.hours}</td>
            <td style="padding:7px 10px;color:${statusColor};font-size:0.88em;">${e.status || ''}</td>
        </tr>`;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
}

function formatDateDisplay(isoDate) {
    if (!isoDate) return '';
    const parts = isoDate.split('-');
    if (parts.length !== 3) return isoDate;
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    const day = DAYS[d.getDay()] || '';
    return `${day} ${parseInt(parts[1])}/${parseInt(parts[2])}`;
}

// ============================================
// INITIALIZATION
// ============================================

function migrateDirtyStoreNames() {
    const store = loadPtoStore();
    if (!store.associates) return;
    let changed = false;
    const newAssociates = {};
    Object.entries(store.associates).forEach(([name, data]) => {
        const clean = cleanUnicodeControl(name);
        if (clean !== name) {
            console.log('[PTO] Migrating dirty name "' + name + '" -> "' + clean + '"');
            // Merge into clean name if it already exists
            if (newAssociates[clean]?.payrollEntries?.length) {
                // Keep the one with more entries
                if ((data.payrollEntries || []).length > newAssociates[clean].payrollEntries.length) {
                    newAssociates[clean] = data;
                }
            } else {
                newAssociates[clean] = data;
            }
            changed = true;
        } else {
            newAssociates[clean] = data;
        }
    });
    if (changed) {
        store.associates = newAssociates;
        savePtoStore(store);
        console.log('[PTO] Migrated dirty names in store');
    }
}

function initializePtoTracker() {
    migrateDirtyStoreNames();

    const select = document.getElementById('ptoAssociateSelect');
    const excelBtn = document.getElementById('ptoPayrollExcelBtn');
    const excelInput = document.getElementById('ptoPayrollExcelInput');

    populateAssociateSelect();

    if (select && !select.dataset.bound) {
        select.addEventListener('change', () => renderEmployeeEntries(select.value));
        select.dataset.bound = 'true';
    }

    if (excelBtn && excelInput && !excelBtn.dataset.bound) {
        excelBtn.addEventListener('click', () => {
            excelInput.value = '';
            excelInput.click();
        });
        excelInput.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const fileNameEl = document.getElementById('ptoPayrollExcelFileName');
            if (fileNameEl) fileNameEl.textContent = file.name;
            importPayrollExcel(file);
        });
        excelBtn.dataset.bound = 'true';
    }

    // Render if associate already selected
    if (select?.value) renderEmployeeEntries(select.value);
}

// Make initializePtoTracker globally accessible
window.initializePtoTracker = initializePtoTracker;

})();
