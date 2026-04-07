(function() {
'use strict';
// ============================================
// PTO / PAYROLL TIME-OFF TRACKER
// Upload payroll Excel, view/edit entries, track PTO balance
// ============================================

var PTO_TRACKING_YEAR = 2026;
var STORAGE_PREFIX = 'devCoachingTool_';
var DEFAULT_ANNUAL_ALLOTMENT = 120;

// TRC codes that count against PTO balance
var PTO_BALANCE_TRCS = ['PTO', 'PTOST', 'PTO Unsched'];

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

var ALL_TRC_LABELS = ['PTO', 'PTOST', 'PTO Unsched', 'STD', 'FMLA', 'Bereavement', 'Parental Leave', 'No Pay'];

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

// Track currently selected employee for event delegation
var currentPtoEmployee = '';

function showToast(msg, ms) {
    if (typeof window.showToast === 'function') { window.showToast(msg, ms); return; }
    console.log('[PTO]', msg);
}

function escapeHtml(str) {
    var utils = window.DevCoachModules?.sharedUtils;
    if (utils?.escapeHtml) return utils.escapeHtml(str);
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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
// BALANCE CALCULATION
// ============================================

function getAssociateData(store, name) {
    if (!store.associates) store.associates = {};
    if (!store.associates[name]) store.associates[name] = { payrollEntries: [] };
    var data = store.associates[name];
    if (data.carryoverHours == null) data.carryoverHours = 0;
    if (data.annualAllotment == null) data.annualAllotment = store.defaultAnnualAllotment || DEFAULT_ANNUAL_ALLOTMENT;
    return data;
}

function calculatePtoBalance(store, name) {
    var data = getAssociateData(store, name);
    var carryover = data.carryoverHours || 0;
    var allotment = data.annualAllotment != null ? data.annualAllotment : (store.defaultAnnualAllotment || DEFAULT_ANNUAL_ALLOTMENT);
    var used;
    if (data.takenHours != null) {
        used = Number(data.takenHours) || 0;
    } else {
        used = 0;
        (data.payrollEntries || []).forEach(function(e) {
            if (PTO_BALANCE_TRCS.indexOf(e.trc) >= 0) {
                used += (e.hours || 0);
            }
        });
    }
    used = Math.round(used * 100) / 100;
    var remaining = data.reportedRemaining != null
        ? (Math.round((Number(data.reportedRemaining) || 0) * 100) / 100)
        : (Math.round((carryover + allotment - used) * 100) / 100);
    return { carryover: carryover, allotment: allotment, used: used, remaining: remaining };
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

    const store = loadPtoStore();
    Object.keys(store.associates || {}).forEach(n => {
        if (isIncludedByTeamFilter(n, filterCtx)) names.add(n);
    });

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
    str = str.replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g, '');
    str = str.replace(/[©®™●■□▪▫◆◇○◎★☆•‣⁃△▲▼►◄→←↑↓]/g, '');
    str = str.replace(/^[^\w\s]+|[^\w\s]+$/g, '');
    return str.trim();
}

function parseExcelDate(raw) {
    if (raw == null || raw === '') return null;
    if (raw instanceof Date && !isNaN(raw.getTime())) return raw.toISOString().slice(0, 10);
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
// STORE NAME RESOLUTION (case-insensitive)
// ============================================

function resolveStoreKey(store, employeeName) {
    if (store.associates?.[employeeName]) return employeeName;
    var lower = employeeName.toLowerCase();
    var keys = Object.keys(store.associates || {});
    for (var i = 0; i < keys.length; i++) {
        if (keys[i].toLowerCase() === lower) return keys[i];
    }
    return employeeName;
}

function parseHoursValue(raw) {
    if (raw == null || raw === '') return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw * 100) / 100;
    var s = String(raw).trim();
    if (!s) return null;
    s = s.replace(/,/g, '').replace(/hrs?|hours?/ig, '').trim();
    var n = parseFloat(s);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100) / 100;
}

function normalizeHeaderKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findHeaderIndex(headers, candidates) {
    for (var i = 0; i < headers.length; i++) {
        if (candidates.indexOf(headers[i]) >= 0) return i;
    }
    return -1;
}

function importPtoBalanceExcel(file) {
    if (!file) return;
    var fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.xlsx') && !fileName.endsWith('.xls')) {
        showToast('Please upload an Excel file (.xlsx or .xls)', 4000);
        return;
    }

    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var data = new Uint8Array(e.target.result);
            var workbook = XLSX.read(data, { type: 'array' });
            var firstSheet = workbook.Sheets[workbook.SheetNames[0]];
            var rows = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: true, defval: '' });
            processPtoBalanceRows(rows);
        } catch (err) {
            console.error('PTO balance import error:', err);
            showToast('Failed to read PTO balance file. Check format and try again.', 5000);
        }
    };
    reader.onerror = function() { showToast('Failed to read file', 4000); };
    reader.readAsArrayBuffer(file);
}

function importPtoBalancePdf(file) {
    if (!file) return;
    var fileName = file.name.toLowerCase();
    if (!fileName.endsWith('.pdf')) {
        showToast('Please upload a PDF file (.pdf)', 4000);
        return;
    }

    var reader = new FileReader();
    reader.onload = function(e) {
        try {
            var pdfData = new Uint8Array(e.target.result);
            pdfjsLib.getDocument(pdfData).promise.then(function(pdf) {
                var pagePromises = [];
                for (var p = 1; p <= pdf.numPages; p++) {
                    pagePromises.push(pdf.getPage(p).then(function(page) {
                        return page.getTextContent().then(function(content) {
                            return extractPdfLines(content.items || []);
                        });
                    }));
                }
                Promise.all(pagePromises).then(function(pages) {
                    var allLines = [];
                    pages.forEach(function(lines) {
                        if (Array.isArray(lines) && lines.length) allLines = allLines.concat(lines);
                    });
                    processPtoBalancePdf(allLines);
                });
            }).catch(function(err) {
                console.error('PDF parse error:', err);
                showToast('Failed to read PDF. Check format and try again.', 5000);
            });
        } catch (err) {
            console.error('PTO PDF import error:', err);
            showToast('Failed to read PTO PDF file.', 5000);
        }
    };
    reader.onerror = function() { showToast('Failed to read file', 4000); };
    reader.readAsArrayBuffer(file);
}

function extractPdfLines(items) {
    // Rebuild text lines by grouping by Y coordinate and sorting by X coordinate.
    var buckets = {};
    var yKeys = [];

    items.forEach(function(item) {
        var txt = String(item?.str || '').trim();
        if (!txt) return;
        var x = Number(item?.transform?.[4] || 0);
        var y = Number(item?.transform?.[5] || 0);
        var bucketY = Math.round(y);
        if (!buckets[bucketY]) {
            buckets[bucketY] = [];
            yKeys.push(bucketY);
        }
        buckets[bucketY].push({ x: x, text: txt });
    });

    yKeys.sort(function(a, b) { return b - a; });
    var lines = [];
    yKeys.forEach(function(y) {
        var row = buckets[y] || [];
        row.sort(function(a, b) { return a.x - b.x; });
        var line = row.map(function(part) { return part.text; }).join(' ').replace(/\s+/g, ' ').trim();
        if (line) lines.push(line);
    });
    return lines;
}

function isLikelyPersonLabel(label) {
    var s = cleanUnicodeControl(String(label || '').trim());
    if (!s) return false;
    if (/carryover|earned|used|balance|hours|total|summary|time\s*off|employee\s*id|id\b/i.test(s)) return false;
    var alpha = (s.match(/[A-Za-z]/g) || []).length;
    if (alpha < 4) return false;
    if (s.indexOf(',') >= 0) return true;
    return /[A-Za-z'\-]+\s+[A-Za-z'\-]+/.test(s);
}

function parseNumbersFromLine(line) {
    var matches = String(line || '').match(/-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?/g) || [];
    return matches.map(function(v) { return parseHoursValue(String(v).replace(/,/g, '')); }).filter(function(v) { return v != null; });
}

function processPtoBalancePdf(input) {
    // Extract balance data: Carryover, Earned, Used for each employee
    var lines = Array.isArray(input)
        ? input.map(function(l) { return String(l || '').trim(); }).filter(function(l) { return l.length > 0; })
        : String(input || '').split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });
    
    var store = loadPtoStore();
    var nameLookup = {};
    Object.keys(store.associates || {}).forEach(function(n) { nameLookup[n.toLowerCase()] = n; });
    var weeklyData = window.DevCoachModules?.storage?.loadWeeklyData?.() || {};
    var ytdData = window.DevCoachModules?.storage?.loadYtdData?.() || {};
    [weeklyData, ytdData].forEach(function(source) {
        Object.values(source).forEach(function(period) {
            if (!Array.isArray(period?.employees)) return;
            period.employees.forEach(function(emp) {
                var n = String(emp?.name || '').trim();
                if (n && !nameLookup[n.toLowerCase()]) nameLookup[n.toLowerCase()] = n;
            });
        });
    });

    var updated = 0;
    var matched = false;
    var pendingName = '';

    // Pattern A: Name and numbers on same line.
    // Pattern B: Name line followed by number line.
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var numbers = parseNumbersFromLine(line);
        var firstNumMatch = String(line).match(/-?\d/);
        var namePart = firstNumMatch
            ? cleanUnicodeControl(String(line).slice(0, firstNumMatch.index).trim())
            : cleanUnicodeControl(String(line).trim());

        if (isLikelyPersonLabel(namePart) && numbers.length >= 3) {
            var resolvedNameA = resolveEmployeeName(namePart, nameLookup);
            var assocA = getAssociateData(store, resolvedNameA);
            assocA.carryoverHours = numbers[0];
            assocA.annualAllotment = numbers[1];
            if (numbers.length >= 3) assocA.takenHours = numbers[2];
            if (numbers.length >= 5) assocA.reportedRemaining = numbers[4];
            matched = true;
            updated++;
            pendingName = '';
            continue;
        }

        if (isLikelyPersonLabel(line) && numbers.length < 3) {
            pendingName = line;
            continue;
        }

        if (pendingName && numbers.length >= 3) {
            var resolvedNameB = resolveEmployeeName(cleanUnicodeControl(pendingName), nameLookup);
            var assocB = getAssociateData(store, resolvedNameB);
            assocB.carryoverHours = numbers[0];
            assocB.annualAllotment = numbers[1];
            if (numbers.length >= 3) assocB.takenHours = numbers[2];
            if (numbers.length >= 5) assocB.reportedRemaining = numbers[4];
            matched = true;
            updated++;
            pendingName = '';
        }
    }
    
    if (matched && updated > 0) {
        savePtoStore(store);
        populateAssociateSelect();
        showToast('Imported ' + updated + ' employee balance(s) from PDF', 4000);
    } else {
        showToast('No recognizable PTO balance data found in PDF. Expected: Name, Carryover, Earned, Used.', 5000);
    }
}

function processPtoBalanceRows(rows) {
    var headerIdx = -1;
    var colMap = { name: -1, carryover: -1, allotment: -1, remaining: -1, used: -1 };

    for (var i = 0; i < Math.min(rows.length, 12); i++) {
        var row = Array.isArray(rows[i]) ? rows[i] : [];
        var normalized = row.map(normalizeHeaderKey);
        var nameIdx = findHeaderIndex(normalized, ['name', 'employee', 'employeename', 'associate', 'associatename']);
        if (nameIdx < 0) continue;

        var carryIdx = findHeaderIndex(normalized, ['carryover', 'carryoverhours', 'ptocarryover', 'carryoverpto']);
        var allotIdx = findHeaderIndex(normalized, ['annualallotment', 'allotment', 'annualpto', 'ptoallotment', 'yearlyallotment']);
        var remIdx = findHeaderIndex(normalized, ['remaining', 'balance', 'available', 'ptobalance', 'ptoavailable']);
        var usedIdx = findHeaderIndex(normalized, ['used', 'taken', 'usedhours', 'ptoused']);

        if (carryIdx >= 0 || allotIdx >= 0 || remIdx >= 0 || usedIdx >= 0) {
            headerIdx = i;
            colMap = { name: nameIdx, carryover: carryIdx, allotment: allotIdx, remaining: remIdx, used: usedIdx };
            break;
        }
    }

    var resultsEl = document.getElementById('ptoBalanceExcelResults');
    if (headerIdx < 0) {
        showToast('Could not find balance columns. Need Name + Carryover/Allotment/Remaining.', 5000);
        if (resultsEl) {
            resultsEl.innerHTML = '<div style="padding:10px;border-radius:6px;background:#fff3cd;color:#856404;margin-top:8px;">Could not detect PTO balance columns. Expected Name and at least one of Carryover, Annual Allotment, Remaining.</div>';
        }
        return;
    }

    var store = loadPtoStore();
    var nameLookup = {};
    Object.keys(store.associates || {}).forEach(function(n) { nameLookup[n.toLowerCase()] = n; });
    var weeklyData = window.DevCoachModules?.storage?.loadWeeklyData?.() || {};
    var ytdData = window.DevCoachModules?.storage?.loadYtdData?.() || {};
    [weeklyData, ytdData].forEach(function(source) {
        Object.values(source).forEach(function(period) {
            if (!Array.isArray(period?.employees)) return;
            period.employees.forEach(function(emp) {
                var n = String(emp?.name || '').trim();
                if (n && !nameLookup[n.toLowerCase()]) nameLookup[n.toLowerCase()] = n;
            });
        });
    });

    var updated = 0;
    var derived = 0;
    for (var r = headerIdx + 1; r < rows.length; r++) {
        var dataRow = Array.isArray(rows[r]) ? rows[r] : [];
        var rawName = cleanUnicodeControl(String(dataRow[colMap.name] || '').trim());
        if (!rawName) continue;

        var resolvedName = resolveEmployeeName(rawName, nameLookup);
        var assoc = getAssociateData(store, resolvedName);

        var carry = colMap.carryover >= 0 ? parseHoursValue(dataRow[colMap.carryover]) : null;
        var allot = colMap.allotment >= 0 ? parseHoursValue(dataRow[colMap.allotment]) : null;
        var remaining = colMap.remaining >= 0 ? parseHoursValue(dataRow[colMap.remaining]) : null;
        var used = colMap.used >= 0 ? parseHoursValue(dataRow[colMap.used]) : null;

        var touched = false;
        if (carry != null) {
            assoc.carryoverHours = carry;
            touched = true;
        }
        if (allot != null) {
            assoc.annualAllotment = allot;
            touched = true;
        } else if (remaining != null && used != null) {
            var baseCarry = carry != null ? carry : (assoc.carryoverHours || 0);
            var inferredAllot = Math.max(0, Math.round((remaining + used - baseCarry) * 100) / 100);
            assoc.annualAllotment = inferredAllot;
            derived++;
            touched = true;
        }

        if (touched) updated++;
    }

    if (!updated) {
        showToast('No PTO balances were updated from this file.', 4000);
        if (resultsEl) {
            resultsEl.innerHTML = '<div style="padding:10px;border-radius:6px;background:#fff3cd;color:#856404;margin-top:8px;">No balance updates applied. Check that the sheet includes numeric carryover/allotment or remaining + used values.</div>';
        }
        return;
    }

    savePtoStore(store);
    var selected = document.getElementById('ptoAssociateSelect')?.value || '';
    if (selected) renderEmployeeView(selected);
    populateAssociateSelect();
    showToast('PTO balances updated for ' + updated + ' employees.', 5000);
    if (resultsEl) {
        var extra = derived > 0 ? ' Derived annual allotment for ' + derived + ' employee(s) using Remaining + Used - Carryover.' : '';
        resultsEl.innerHTML = '<div style="padding:10px;border-radius:6px;background:#e8f5e9;color:#1b5e20;margin-top:8px;"><strong>Updated PTO balances for ' + updated + ' employee(s).</strong>' + extra + '</div>';
    }
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
            // Find "Unschd" column (may also appear as "unscheduled", "unsched", etc.)
            var unschdIdx = -1;
            for (var u = 0; u < lower.length; u++) {
                if (lower[u].indexOf('unsch') >= 0) { unschdIdx = u; break; }
            }
            colMap = { name: nameIdx, date: lower.indexOf('date'), trc: trcIdx, quantity: lower.indexOf('quantity'), status: lower.indexOf('status'), unschd: unschdIdx };
            break;
        }
    }

    if (headerIdx < 0) {
        showToast('Could not find header row (expected Name, TRC, Quantity columns)', 5000);
        return;
    }

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

        // Parse "Unschd" column - any truthy value (Y, Yes, X, 1, a number > 0) means unscheduled
        var isUnscheduled = false;
        if (colMap.unschd >= 0) {
            var rawUnschd = String(row[colMap.unschd] || '').trim().toLowerCase();
            isUnscheduled = rawUnschd === 'y' || rawUnschd === 'yes' || rawUnschd === 'x' || rawUnschd === '1' || rawUnschd === 'true'
                || (Number.isFinite(parseFloat(rawUnschd)) && parseFloat(rawUnschd) > 0);
        }
        // Also flag if TRC itself is "PTO Unsched"
        if (mappedLabel === 'PTO Unsched') isUnscheduled = true;

        const resolvedName = resolveEmployeeName(rawName, nameLookup);

        if (!byEmployee[resolvedName]) byEmployee[resolvedName] = [];
        byEmployee[resolvedName].push({
            date: isoDate,
            hours: Math.round(hours * 100) / 100,
            trc: mappedLabel,
            payrollTrc: rawTrc,
            status: rawStatus,
            unscheduled: isUnscheduled
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

    if (!store.associates) store.associates = {};
    let totalAdded = 0;
    const summary = {};

    employeeNames.forEach(name => {
        if (!store.associates[name]) store.associates[name] = { payrollEntries: [] };
        // Preserve carryover/allotment if already set
        var existing = store.associates[name];
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
                <strong>ERROR: Could not save payroll data.</strong> Browser storage may be full.
            </div>`;
        }
        return;
    }

    const verifyStore = loadPtoStore();
    const verifyName = employeeNames[0];
    const verifyEntries = verifyStore.associates?.[verifyName]?.payrollEntries || [];
    if (!verifyEntries.length) {
        if (resultsEl) {
            resultsEl.innerHTML = `<div style="padding:10px;border-radius:6px;background:#fff3cd;color:#856404;margin-top:8px;">
                <strong>Warning:</strong> Data may not have saved correctly. Please re-upload.
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

    populateAssociateSelect();
    const select = document.getElementById('ptoAssociateSelect');
    if (select?.value) renderEmployeeView(select.value);
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
    const storeLookup = {};
    Object.keys(store.associates || {}).forEach(n => { storeLookup[n.toLowerCase()] = n; });

    names.forEach(name => {
        const opt = document.createElement('option');
        opt.value = name;
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
// UI: BALANCE PANEL
// ============================================

function renderBalancePanel(employeeName) {
    var panel = document.getElementById('ptoBalancePanel');
    if (!panel) return;

    if (!employeeName) {
        panel.innerHTML = '';
        return;
    }

    var store = loadPtoStore();
    var storeKey = resolveStoreKey(store, employeeName);
    var data = getAssociateData(store, storeKey);
    var bal = calculatePtoBalance(store, storeKey);

    var remainColor = bal.remaining > 16 ? '#1b5e20' : bal.remaining >= 8 ? '#e65100' : '#b71c1c';
    var remainBg = bal.remaining > 16 ? '#e8f5e9' : bal.remaining >= 8 ? '#fff3e0' : '#fce4ec';

    // Count unscheduled
    var unschedHours = 0;
    var unschedDays = 0;
    var unschedDates = {};
    (data.payrollEntries || []).forEach(function(e) {
        if (e.unscheduled) {
            unschedHours += (e.hours || 0);
            if (e.date && !unschedDates[e.date]) { unschedDays++; unschedDates[e.date] = true; }
        }
    });

    panel.innerHTML = `
        <div style="margin-bottom:20px;padding:16px;background:#fff;border-radius:10px;border:1px solid #d0dce5;">
            <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:flex-end;margin-bottom:12px;">
                <div style="flex:0 0 auto;">
                    <label style="font-size:0.8em;color:#666;display:block;margin-bottom:2px;">Carryover Hours</label>
                    <input type="number" id="ptoCarryover" value="${data.carryoverHours || 0}" min="0" step="1"
                        style="width:90px;padding:6px 8px;border:1px solid #c0cdd8;border-radius:5px;font-size:0.95em;text-align:center;">
                </div>
                <div style="flex:0 0 auto;">
                    <label style="font-size:0.8em;color:#666;display:block;margin-bottom:2px;">Annual Allotment</label>
                    <input type="number" id="ptoAllotment" value="${data.annualAllotment != null ? data.annualAllotment : DEFAULT_ANNUAL_ALLOTMENT}" min="0" step="1"
                        style="width:90px;padding:6px 8px;border:1px solid #c0cdd8;border-radius:5px;font-size:0.95em;text-align:center;">
                </div>
                <div style="flex:0 0 auto;padding:6px 16px;border-radius:8px;background:${remainBg};text-align:center;">
                    <div style="font-size:0.75em;color:#666;">PTO Remaining</div>
                    <div style="font-size:1.3em;font-weight:700;color:${remainColor};">${bal.remaining}h</div>
                </div>
                <div style="flex:0 0 auto;padding:6px 12px;font-size:0.85em;color:#666;">
                    Used: <strong>${bal.used}h</strong> of ${bal.carryover + bal.allotment}h
                </div>
            </div>
            ${unschedHours > 0 ? `<div style="padding:6px 12px;background:#fff3e0;border-radius:6px;font-size:0.85em;color:#e65100;">
                Unscheduled PTO: <strong>${unschedHours.toFixed(1)}h</strong> across <strong>${unschedDays}</strong> day${unschedDays !== 1 ? 's' : ''}
            </div>` : ''}
        </div>`;
}

function saveBalanceFields(employeeName) {
    var store = loadPtoStore();
    var storeKey = resolveStoreKey(store, employeeName);
    var data = getAssociateData(store, storeKey);

    var carryEl = document.getElementById('ptoCarryover');
    var allotEl = document.getElementById('ptoAllotment');
    if (carryEl) data.carryoverHours = parseFloat(carryEl.value) || 0;
    if (allotEl) data.annualAllotment = parseFloat(allotEl.value) || 0;

    savePtoStore(store);
    renderBalancePanel(employeeName);
}

// ============================================
// UI: RENDER EMPLOYEE VIEW (balance + table)
// ============================================

function renderEmployeeView(employeeName) {
    currentPtoEmployee = employeeName;
    renderBalancePanel(employeeName);
    renderEmployeeEntries(employeeName);
}

function renderEmployeeEntries(employeeName) {
    const container = document.getElementById('ptoEntriesContainer');
    if (!container) return;

    if (!employeeName) {
        container.innerHTML = '';
        return;
    }

    const store = loadPtoStore();
    var storeKey = resolveStoreKey(store, employeeName);
    const entries = (store.associates?.[storeKey]?.payrollEntries || [])
        .filter(e => e.date)
        .sort((a, b) => a.date.localeCompare(b.date));

    if (!entries.length) {
        container.innerHTML = '<p style="color:#94a3b8;text-align:center;padding:20px;">No payroll entries. Upload a timecard Excel above.</p>';
        return;
    }

    renderEntriesTable(container, entries, storeKey);
}

function renderEntriesTable(container, entries, storeKey) {
    // Summary badges
    const totals = {};
    let totalHours = 0;
    let unschedHours = 0;
    entries.forEach(e => {
        totals[e.trc] = (totals[e.trc] || 0) + (e.hours || 0);
        totalHours += (e.hours || 0);
        if (e.unscheduled) unschedHours += (e.hours || 0);
    });

    let html = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:14px;">';
    Object.entries(totals).forEach(([trc, hrs]) => {
        const color = TRC_COLORS[trc] || { bg: '#f5f5f5', text: '#333' };
        html += `<span style="display:inline-block;padding:5px 12px;border-radius:16px;font-size:0.85em;font-weight:600;background:${color.bg};color:${color.text};">${escapeHtml(trc)}: ${hrs.toFixed(1)}h</span>`;
    });
    html += `<span style="display:inline-block;padding:5px 12px;border-radius:16px;font-size:0.85em;font-weight:600;background:#f5f5f5;color:#333;">Total: ${totalHours.toFixed(1)}h</span>`;
    if (unschedHours > 0) {
        html += `<span style="display:inline-block;padding:5px 12px;border-radius:16px;font-size:0.85em;font-weight:600;background:#fff3e0;color:#e65100;">Unsched: ${unschedHours.toFixed(1)}h</span>`;
    }
    html += '</div>';

    // Add entry button
    html += `<div style="margin-bottom:10px;">
        <button type="button" id="ptoAddEntryBtn" style="padding:6px 14px;border:1px dashed #5a2c8a;background:#f8f0ff;color:#5a2c8a;border-radius:6px;font-size:0.85em;cursor:pointer;">+ Add Entry</button>
    </div>`;

    // Table
    html += `<table style="width:100%;border-collapse:collapse;font-size:0.9em;">
        <thead>
            <tr style="background:#f8f9fa;text-align:left;">
                <th style="padding:8px 10px;border-bottom:2px solid #dee2e6;">Date</th>
                <th style="padding:8px 10px;border-bottom:2px solid #dee2e6;">Code</th>
                <th style="padding:8px 10px;border-bottom:2px solid #dee2e6;">Hours</th>
                <th style="padding:8px 10px;border-bottom:2px solid #dee2e6;">Status</th>
                <th style="padding:8px 10px;border-bottom:2px solid #dee2e6;width:40px;"></th>
            </tr>
        </thead>
        <tbody>`;

    entries.forEach(e => {
        const color = TRC_COLORS[e.trc] || { bg: '#f5f5f5', text: '#333' };
        const dateStr = formatDateDisplay(e.date);
        const statusColor = (e.status || '').toLowerCase().includes('approved') ? '#1b5e20' : '#e65100';
        const rowBorder = e.unscheduled ? 'border-left:3px solid #e65100;' : '';
        const unschedLabel = e.unscheduled ? '<span style="display:inline-block;padding:2px 6px;border-radius:8px;font-size:0.78em;font-weight:600;background:#fff3e0;color:#e65100;">UNSCHED</span>' : '';

        html += `<tr style="border-bottom:1px solid #f0f0f0;${rowBorder}" data-entry-id="${escapeHtml(e.id)}">
            <td style="padding:7px 10px;">${escapeHtml(dateStr)}</td>
            <td style="padding:7px 10px;" class="pto-edit-trc" data-id="${escapeHtml(e.id)}" title="Click to change">
                <span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:0.88em;font-weight:600;background:${color.bg};color:${color.text};cursor:pointer;">${escapeHtml(e.trc)}</span>
                ${unschedLabel}
            </td>
            <td style="padding:7px 10px;" class="pto-edit-hours" data-id="${escapeHtml(e.id)}" title="Click to edit">
                <span style="cursor:pointer;border-bottom:1px dashed #ccc;">${e.hours}</span>
            </td>
            <td style="padding:7px 10px;color:${statusColor};font-size:0.88em;">${escapeHtml(e.status || '')}</td>
            <td style="padding:7px 10px;text-align:center;">
                <button type="button" class="pto-delete-entry" data-id="${escapeHtml(e.id)}" title="Delete entry"
                    style="background:none;border:none;color:#b71c1c;cursor:pointer;font-size:1.1em;padding:2px 6px;">&#x2715;</button>
            </td>
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
// ENTRY EDITING (event delegation)
// ============================================

function bindEntryEventDelegation() {
    var container = document.getElementById('ptoEntriesContainer');
    if (!container || container.dataset.ptoBound) return;
    container.dataset.ptoBound = 'true';

    // Click events: edit TRC, edit hours, delete, add entry
    container.addEventListener('click', function(e) {
        var target = e.target.closest('.pto-edit-trc');
        if (target) { startEditTrc(target, target.dataset.id); return; }

        target = e.target.closest('.pto-edit-hours');
        if (target) { startEditHours(target, target.dataset.id); return; }

        target = e.target.closest('.pto-delete-entry');
        if (target) { deleteEntry(currentPtoEmployee, target.dataset.id); return; }

        target = e.target.closest('#ptoAddEntryBtn');
        if (target) { showAddEntryForm(); return; }
    });

    // Balance field changes
    var balPanel = document.getElementById('ptoBalancePanel');
    if (balPanel && !balPanel.dataset.ptoBound) {
        balPanel.dataset.ptoBound = 'true';
        balPanel.addEventListener('change', function(e) {
            if (e.target.id === 'ptoCarryover' || e.target.id === 'ptoAllotment') {
                saveBalanceFields(currentPtoEmployee);
            }
        });
    }
}

function startEditTrc(cell, entryId) {
    if (cell.querySelector('select')) return; // Already editing
    var store = loadPtoStore();
    var storeKey = resolveStoreKey(store, currentPtoEmployee);
    var entries = store.associates?.[storeKey]?.payrollEntries || [];
    var entry = entries.find(function(e) { return e.id === entryId; });
    if (!entry) return;

    var select = document.createElement('select');
    select.style.cssText = 'padding:3px 6px;border-radius:5px;font-size:0.9em;';
    ALL_TRC_LABELS.forEach(function(label) {
        var opt = document.createElement('option');
        opt.value = label;
        opt.textContent = label;
        if (label === entry.trc) opt.selected = true;
        select.appendChild(opt);
    });

    cell.innerHTML = '';
    cell.appendChild(select);
    select.focus();

    function finish() {
        var newTrc = select.value;
        if (newTrc !== entry.trc) {
            entry.trc = newTrc;
            entry.unscheduled = newTrc === 'PTO Unsched' || entry.unscheduled;
            savePtoStore(store);
        }
        renderEmployeeView(currentPtoEmployee);
    }
    select.addEventListener('change', finish);
    select.addEventListener('blur', finish);
}

function startEditHours(cell, entryId) {
    if (cell.querySelector('input')) return;
    var store = loadPtoStore();
    var storeKey = resolveStoreKey(store, currentPtoEmployee);
    var entries = store.associates?.[storeKey]?.payrollEntries || [];
    var entry = entries.find(function(e) { return e.id === entryId; });
    if (!entry) return;

    var input = document.createElement('input');
    input.type = 'number';
    input.min = '0';
    input.step = '0.25';
    input.value = entry.hours;
    input.style.cssText = 'width:60px;padding:3px 6px;border:1px solid #c0cdd8;border-radius:5px;font-size:0.9em;text-align:center;';

    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    function finish() {
        var val = parseFloat(input.value);
        if (Number.isFinite(val) && val >= 0 && val !== entry.hours) {
            entry.hours = Math.round(val * 100) / 100;
            savePtoStore(store);
        }
        renderEmployeeView(currentPtoEmployee);
    }
    input.addEventListener('blur', finish);
    input.addEventListener('keydown', function(e) { if (e.key === 'Enter') finish(); });
}

function deleteEntry(employeeName, entryId) {
    if (!confirm('Delete this entry?')) return;
    var store = loadPtoStore();
    var storeKey = resolveStoreKey(store, employeeName);
    var data = store.associates?.[storeKey];
    if (!data) return;
    data.payrollEntries = (data.payrollEntries || []).filter(function(e) { return e.id !== entryId; });
    savePtoStore(store);
    populateAssociateSelect();
    renderEmployeeView(employeeName);
}

// ============================================
// ADD ENTRY FORM
// ============================================

function showAddEntryForm() {
    var container = document.getElementById('ptoEntriesContainer');
    if (!container) return;
    if (document.getElementById('ptoAddEntryForm')) return;

    var today = new Date().toISOString().slice(0, 10);
    var form = document.createElement('div');
    form.id = 'ptoAddEntryForm';
    form.style.cssText = 'padding:12px 16px;background:#f8f0ff;border:1px solid #d0b8e8;border-radius:8px;margin-bottom:12px;display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;';

    var trcOptions = ALL_TRC_LABELS.map(function(label) {
        return '<option value="' + escapeHtml(label) + '">' + escapeHtml(label) + '</option>';
    }).join('');

    form.innerHTML = `
        <div>
            <label style="font-size:0.78em;color:#666;display:block;">Date</label>
            <input type="date" id="ptoNewDate" value="${today}" style="padding:5px 8px;border:1px solid #c0cdd8;border-radius:5px;font-size:0.9em;">
        </div>
        <div>
            <label style="font-size:0.78em;color:#666;display:block;">Code</label>
            <select id="ptoNewTrc" style="padding:5px 8px;border:1px solid #c0cdd8;border-radius:5px;font-size:0.9em;">${trcOptions}</select>
        </div>
        <div>
            <label style="font-size:0.78em;color:#666;display:block;">Hours</label>
            <input type="number" id="ptoNewHours" value="8" min="0" step="0.25" style="width:70px;padding:5px 8px;border:1px solid #c0cdd8;border-radius:5px;font-size:0.9em;text-align:center;">
        </div>
        <div>
            <label style="font-size:0.78em;color:#666;display:block;">Unsched?</label>
            <input type="checkbox" id="ptoNewUnsched" style="margin-top:6px;">
        </div>
        <div style="display:flex;gap:6px;">
            <button type="button" id="ptoSaveNewEntry" style="padding:6px 14px;background:#5a2c8a;color:#fff;border:none;border-radius:5px;font-size:0.85em;cursor:pointer;">Save</button>
            <button type="button" id="ptoCancelNewEntry" style="padding:6px 14px;background:#eee;color:#333;border:1px solid #ccc;border-radius:5px;font-size:0.85em;cursor:pointer;">Cancel</button>
        </div>`;

    var addBtn = document.getElementById('ptoAddEntryBtn');
    if (addBtn) addBtn.insertAdjacentElement('afterend', form);
    else container.insertBefore(form, container.firstChild);

    document.getElementById('ptoSaveNewEntry').addEventListener('click', function() {
        saveNewEntry();
    });
    document.getElementById('ptoCancelNewEntry').addEventListener('click', function() {
        form.remove();
    });
}

function saveNewEntry() {
    var dateEl = document.getElementById('ptoNewDate');
    var trcEl = document.getElementById('ptoNewTrc');
    var hoursEl = document.getElementById('ptoNewHours');
    var unschedEl = document.getElementById('ptoNewUnsched');

    var date = dateEl?.value;
    var trc = trcEl?.value;
    var hours = parseFloat(hoursEl?.value);
    var unsched = unschedEl?.checked || false;

    if (!date) { showToast('Please enter a date', 3000); return; }
    if (!Number.isFinite(hours) || hours <= 0) { showToast('Please enter valid hours', 3000); return; }

    var store = loadPtoStore();
    var storeKey = resolveStoreKey(store, currentPtoEmployee);
    var data = getAssociateData(store, storeKey);

    data.payrollEntries.push({
        id: `manual-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        date: date,
        hours: Math.round(hours * 100) / 100,
        trc: trc,
        payrollTrc: 'manual',
        status: 'Manual',
        unscheduled: unsched || trc === 'PTO Unsched'
    });

    savePtoStore(store);
    populateAssociateSelect();
    renderEmployeeView(currentPtoEmployee);
    showToast('Entry added', 2000);
}

// ============================================
// MIGRATION
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
            if (newAssociates[clean]?.payrollEntries?.length) {
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
    }
}

function migrateUnscheduledField() {
    var store = loadPtoStore();
    var changed = false;
    Object.values(store.associates || {}).forEach(function(data) {
        (data.payrollEntries || []).forEach(function(e) {
            if (e.unscheduled == null) {
                e.unscheduled = e.trc === 'PTO Unsched';
                changed = true;
            }
        });
    });
    if (changed) savePtoStore(store);
}

// ============================================
// INITIALIZATION
// ============================================

function initializePtoTracker() {
    migrateDirtyStoreNames();
    migrateUnscheduledField();

    const select = document.getElementById('ptoAssociateSelect');

    populateAssociateSelect();

    if (select && !select.dataset.bound) {
        select.addEventListener('change', () => renderEmployeeView(select.value));
        select.dataset.bound = 'true';
    }

    var pdfBtn = document.getElementById('ptoPdfBtn') || document.getElementById('showUploadPtoPdfBtn');
    var pdfInput = document.getElementById('ptoPdfInput');
    if (pdfBtn && pdfInput && !pdfBtn.dataset.bound) {
        pdfBtn.addEventListener('click', function() {
            pdfInput.value = '';
            pdfInput.click();
        });
        pdfInput.addEventListener('change', function(e) {
            var file = e.target.files?.[0];
            if (!file) return;
            importPtoBalancePdf(file);
        });
        pdfBtn.dataset.bound = 'true';
    }

    var clearBtn = document.getElementById('ptoClearAllBtn');
    if (clearBtn && !clearBtn.dataset.bound) {
        clearBtn.addEventListener('click', function() {
            var store = loadPtoStore();
            var count = Object.keys(store.associates || {}).length;
            if (!count) { showToast('No entries to clear', 3000); return; }
            if (!confirm('Delete ALL payroll entries for all ' + count + ' employees? This cannot be undone.')) return;
            store.associates = {};
            savePtoStore(store);
            populateAssociateSelect();
            renderEmployeeView('');
            showToast('All payroll entries cleared', 3000);
        });
        clearBtn.dataset.bound = 'true';
    }

    bindEntryEventDelegation();

    if (select?.value) renderEmployeeView(select.value);
}

window.initializePtoTracker = initializePtoTracker;

})();
