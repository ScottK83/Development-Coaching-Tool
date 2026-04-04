(function() {
    'use strict';

    // ============================================
    // ATTENDANCE TRACKER MODULE
    // Verint reconciliation, PTOST tracking,
    // attendance policy tiers, message generation
    // ============================================

    // --- Constants ---

    var PTOST_ANNUAL_LIMIT = 40;

    // Verint sub-categories that are UNPLANNED and NOT yet reclassified as PTOST
    var UNPLANNED_NOT_PTOST = [
        'Same Day',
        'Same Day - Partial',
        'Same Day - No Call No Show',
        'Tardy EQ GT 6 Min'
    ];

    // Verint sub-categories already marked as PTOST
    var PTOST_CATEGORIES = [
        'Same Day - Full PTOST',
        'Same day - Partial PTOST',
        'Tardy EQ GT 6 Min PTOST'
    ];

    var DISCIPLINE_TIERS = [
        { hours: 0,  label: 'Clear',                color: '#2e7d32', bg: '#e8f5e9' },
        { hours: 16, label: 'Verbal Warning',        color: '#e65100', bg: '#fff3e0' },
        { hours: 24, label: 'Written Warning',       color: '#d84315', bg: '#fbe9e7' },
        { hours: 32, label: 'Second Written Warning', color: '#b71c1c', bg: '#ffebee' },
        { hours: 40, label: 'Termination Eligible',  color: '#880e4f', bg: '#fce4ec' }
    ];

    var ACTIVITY_COLORS = {
        'FMLA':                     { bg: '#fce4ec', text: '#880e4f' },
        'Holiday':                  { bg: '#e8f5e9', text: '#1b5e20' },
        'Pre Planned Absence':      { bg: '#e8f5e9', text: '#2e7d32' },
        'Same Day':                 { bg: '#fff3e0', text: '#e65100' },
        'Same Day - Partial':       { bg: '#fff3e0', text: '#e65100' },
        'Same Day - No Call No Show': { bg: '#ffebee', text: '#b71c1c' },
        'Same Day - Full PTOST':    { bg: '#e3f2fd', text: '#0d47a1' },
        'Same day - Partial PTOST': { bg: '#e3f2fd', text: '#0d47a1' },
        'Tardy EQ GT 6 Min':        { bg: '#fff3e0', text: '#e65100' },
        'Tardy EQ GT 6 Min PTOST':  { bg: '#e3f2fd', text: '#0d47a1' },
        'Tardy LT 6 Min':           { bg: '#f5f5f5', text: '#616161' },
        'VTO-PTO':                  { bg: '#f3e5f5', text: '#6a1b9a' },
        'Alternate Day Off':        { bg: '#e0f2f1', text: '#004d40' },
        'Extra Day off':            { bg: '#e0f2f1', text: '#004d40' }
    };
    var DEFAULT_ACTIVITY_COLOR = { bg: '#f5f5f5', text: '#333' };

    // --- Storage ---

    function loadStore() {
        var mod = window.DevCoachModules?.storage;
        if (mod?.loadAttendanceTracker) return mod.loadAttendanceTracker();
        try {
            var saved = localStorage.getItem('devCoachingTool_attendanceTracker');
            return saved ? JSON.parse(saved) : { associates: {} };
        } catch (e) { return { associates: {} }; }
    }

    function saveStore(store) {
        var mod = window.DevCoachModules?.storage;
        if (mod?.saveAttendanceTracker) { mod.saveAttendanceTracker(store); }
        else {
            try { localStorage.setItem('devCoachingTool_attendanceTracker', JSON.stringify(store)); }
            catch (e) { console.error('Attendance save failed:', e); }
        }
        if (typeof window.queueRepoSync === 'function') window.queueRepoSync('attendance tracker updated');
    }

    // --- Utility ---

    function cleanStr(s) {
        if (!s) return '';
        // Keep only printable characters: ASCII 0x20-0x7E, Latin Extended, common Unicode letters
        // Strip all control chars, directional markers, invisible formatters, geometric shapes
        var cleaned = String(s);
        // Remove known problematic unicode ranges
        cleaned = cleaned.replace(/[\u0000-\u001F\u007F-\u009F]/g, ''); // control chars
        cleaned = cleaned.replace(/[\u200B-\u200F\u202A-\u202E\u2028-\u202F]/g, ''); // directional/format
        cleaned = cleaned.replace(/[\u2060-\u206F\uFE00-\uFE0F\uFEFF]/g, ''); // invisible formatters
        cleaned = cleaned.replace(/[\u2B00-\u2BFF]/g, ''); // geometric shapes (⬭⬬ etc)
        cleaned = cleaned.replace(/[\u2066-\u2069]/g, ''); // isolate markers
        return cleaned.trim();
    }

    function parseDate(raw) {
        if (!raw) return null;
        if (raw instanceof Date) {
            if (isNaN(raw.getTime())) return null;
            return raw.toISOString().split('T')[0];
        }
        var s = String(raw).trim();
        // ISO
        var isoMatch = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (isoMatch) return `${isoMatch[1]}-${isoMatch[2].padStart(2,'0')}-${isoMatch[3].padStart(2,'0')}`;
        // US
        var usMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (usMatch) {
            var yr = usMatch[3].length === 2 ? (parseInt(usMatch[3]) < 50 ? '20' + usMatch[3] : '19' + usMatch[3]) : usMatch[3];
            return `${yr}-${usMatch[1].padStart(2,'0')}-${usMatch[2].padStart(2,'0')}`;
        }
        // Excel serial
        var num = parseFloat(s);
        if (num > 40000 && num < 60000) {
            var d = new Date((num - 25569) * 86400000);
            return d.toISOString().split('T')[0];
        }
        return null;
    }

    function formatDateDisplay(isoDate) {
        if (!isoDate) return '';
        var parts = isoDate.split('-');
        return `${parseInt(parts[1])}/${parseInt(parts[2])}/${parts[0]}`;
    }

    function escHtml(s) {
        var fn = window.DevCoachModules?.sharedUtils?.escapeHtml;
        if (fn) return fn(s);
        return String(s).replace(/[&<>"']/g, function(c) {
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
        });
    }

    function round2(n) { return Math.round(n * 100) / 100; }

    // --- Verint Excel Parser ---

    function parseVerintExcel(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                try {
                    var XLSX = window.XLSX;
                    if (!XLSX) { reject('XLSX library not loaded'); return; }
                    var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
                    var ws = wb.Sheets[wb.SheetNames[0]];
                    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
                    var result = parseVerintRows(rows);
                    resolve(result);
                } catch (err) {
                    reject('Failed to parse Verint Excel: ' + err.message);
                }
            };
            reader.onerror = function() { reject('Failed to read file'); };
            reader.readAsArrayBuffer(file);
        });
    }

    function parseVerintRows(rows) {
        var employeeName = '';
        var organization = '';
        var summary = {};
        var ptoSubCategories = {};
        var activities = [];
        var requests = [];

        // 1. Find employee name
        for (var i = 0; i < Math.min(rows.length, 20); i++) {
            var row = rows[i];
            for (var j = 0; j < row.length; j++) {
                var cell = cleanStr(String(row[j] || ''));
                var empMatch = cell.match(/^Employee:\s*(.+)/i);
                if (empMatch) {
                    employeeName = empMatch[1].trim();
                    // Check if organization is in a later cell
                    for (var k = j + 1; k < row.length; k++) {
                        var orgCell = cleanStr(String(row[k] || ''));
                        var orgMatch = orgCell.match(/^Organization:\s*(.+)/i);
                        if (orgMatch) { organization = orgMatch[1].trim(); break; }
                    }
                    break;
                }
            }
            if (employeeName) break;
        }

        // 2. Parse summary section
        var inSummary = false;
        var inPtoSub = false;
        var currentYear = new Date().getFullYear();
        var summaryParsed = false;

        for (var i = 0; i < rows.length; i++) {
            var row = rows[i];
            var colB = cleanStr(String(row[1] || ''));

            // Detect summary header
            if (colB === 'Time Off Activity' || colB.indexOf('Time Off Activity') === 0) {
                inSummary = true;
                continue;
            }

            // Detect end of summary / start of activities
            if (colB === 'Time Off Activities' || colB.indexOf('Time Off Activities') === 0) {
                inSummary = false;
                // Parse activities section starting from here
                var activitiesResult = parseActivitiesSection(rows, i);
                activities = activitiesResult.activities;
                // Continue to find requests
                var requestsResult = parseRequestsSection(rows, activitiesResult.endRow);
                requests = requestsResult.requests;
                break;
            }

            if (!inSummary) continue;

            // Skip year-range rows like "12/27/2025 - 12/27/2026"
            if (colB.match(/^\d{1,2}\/\d{1,2}\/\d{4}\s*-\s*\d{1,2}\/\d{1,2}\/\d{4}/)) {
                // Check if this is current year range
                var yearMatch = colB.match(/(\d{4})\s*$/);
                if (yearMatch && parseInt(yearMatch[1]) > currentYear) {
                    // Future year range — skip until next year range or end
                    summaryParsed = true;
                }
                inPtoSub = false;
                continue;
            }

            // Skip if we already parsed current year and hit future year
            if (summaryParsed) continue;

            // Skip employee name row
            if (colB.match(/^Employee:/i)) continue;

            if (!colB) continue;

            var numVal = function(v) { return parseFloat(String(v || '').replace(/[$,]/g, '')) || 0; };
            var totalHrs = numVal(row[3]);
            var carryoverHrs = numVal(row[4]);
            var usedHrs = numVal(row[7]);
            var scheduledHrs = numVal(row[9]);
            var remainingHrs = numVal(row[10]);

            // Check if this is a PTO sub-category (indented with spaces)
            var rawColB = String(row[1] || '');
            var isIndented = rawColB.length > 0 && rawColB !== rawColB.trimStart();

            if (colB === 'PTO') {
                inPtoSub = true;
                summary['PTO'] = { total: totalHrs, carryover: carryoverHrs, used: usedHrs, scheduled: scheduledHrs, remaining: remainingHrs };
                continue;
            }

            if (inPtoSub && isIndented) {
                ptoSubCategories[colB] = { used: usedHrs, scheduled: scheduledHrs };
                continue;
            }

            if (inPtoSub && !isIndented) {
                inPtoSub = false;
            }

            // Top-level category
            if (colB && !isIndented) {
                summary[colB] = { total: totalHrs, carryover: carryoverHrs, used: usedHrs, scheduled: scheduledHrs, remaining: remainingHrs };
            }
        }

        return {
            employeeName: employeeName,
            organization: organization,
            summary: summary,
            ptoSubCategories: ptoSubCategories,
            activities: activities,
            requests: requests,
            uploadedAt: new Date().toISOString()
        };
    }

    function parseActivitiesSection(rows, startRow) {
        var activities = [];
        var i = startRow + 1; // Skip header

        for (; i < rows.length; i++) {
            var row = rows[i];
            var colB = cleanStr(String(row[1] || ''));

            // End marker
            if (colB.match(/^Total Time Off/i)) { i++; break; }
            if (colB.match(/^Time Off Requests/i)) break;
            if (!colB) continue;

            // Activity name in col B, From in col F area, To in col I area, Length in col L area
            var fromRaw = row[5] || '';
            var toRaw = row[8] || '';
            var hoursRaw = cleanStr(String(row[11] || ''));

            var fromDate = null;
            var toDate = null;

            // Handle datetime objects
            if (fromRaw instanceof Date) {
                fromDate = fromRaw.toISOString().split('T')[0];
            } else {
                fromDate = parseDate(fromRaw);
            }
            if (toRaw instanceof Date) {
                toDate = toRaw.toISOString().split('T')[0];
            } else {
                toDate = parseDate(toRaw);
            }

            var hours = parseFloat(hoursRaw) || 0;

            if (fromDate && hours > 0) {
                activities.push({
                    activity: colB,
                    fromDate: fromDate,
                    toDate: toDate || fromDate,
                    hours: round2(hours)
                });
            }
        }

        return { activities: activities, endRow: i };
    }

    function parseRequestsSection(rows, startRow) {
        var requests = [];

        // Find the requests header
        var headerRow = startRow;
        for (; headerRow < rows.length; headerRow++) {
            var colB = cleanStr(String(rows[headerRow]?.[1] || ''));
            if (colB.match(/^Time Off Requests$/i)) { headerRow++; break; }
        }

        for (var i = headerRow; i < rows.length; i++) {
            var row = rows[i];
            var colB = cleanStr(String(row[1] || ''));
            if (colB.match(/^Time Off Requests\s*=/i)) break;
            if (!colB) continue;

            var fromRaw = row[5] || '';
            var toRaw = row[8] || '';
            var statusRaw = cleanStr(String(row[11] || ''));

            var fromDate = fromRaw instanceof Date ? fromRaw.toISOString().split('T')[0] : parseDate(fromRaw);
            var toDate = toRaw instanceof Date ? toRaw.toISOString().split('T')[0] : parseDate(toRaw);

            requests.push({
                type: colB,
                fromDate: fromDate,
                toDate: toDate,
                status: statusRaw
            });
        }

        return { requests: requests };
    }

    // --- Policy Engine ---

    function calculatePtostUsage(ptoSubCategories) {
        var ptostUsed = 0;
        var unplannedNotPtost = 0;

        PTOST_CATEGORIES.forEach(function(cat) {
            ptostUsed += (ptoSubCategories[cat]?.used || 0);
        });

        UNPLANNED_NOT_PTOST.forEach(function(cat) {
            unplannedNotPtost += (ptoSubCategories[cat]?.used || 0);
        });

        var totalUnplanned = round2(ptostUsed + unplannedNotPtost);
        ptostUsed = round2(ptostUsed);
        unplannedNotPtost = round2(unplannedNotPtost);

        var ptostRemaining = round2(Math.max(0, PTOST_ANNUAL_LIMIT - ptostUsed));

        // Attendance policy: unplanned NOT-PTOST hours count against reliability RIGHT NOW.
        // PTOST-marked hours are already excused.
        // ptostRemaining = hours they CAN still use to excuse some of the unplanned hours.
        // If they use all remaining PTOST: leftover = unplannedNotPtost - ptostRemaining
        var canExcuse = round2(Math.min(unplannedNotPtost, ptostRemaining));
        var afterExcusing = round2(Math.max(0, unplannedNotPtost - ptostRemaining));

        return {
            ptostUsed: ptostUsed,
            unplannedNotPtost: unplannedNotPtost,
            totalUnplanned: totalUnplanned,
            policyHours: unplannedNotPtost,       // currently against reliability
            policyHoursAfterExcusing: afterExcusing, // what would remain if they use all PTOST
            canExcuse: canExcuse,                  // how many hours can be excused
            reclassificationGap: unplannedNotPtost,
            ptostRemaining: ptostRemaining,
            ptostLimit: PTOST_ANNUAL_LIMIT
        };
    }

    function calculateDisciplineTier(totalUnplannedHours) {
        var currentTier = DISCIPLINE_TIERS[0];
        var nextTier = null;

        for (var i = DISCIPLINE_TIERS.length - 1; i >= 0; i--) {
            if (totalUnplannedHours >= DISCIPLINE_TIERS[i].hours) {
                currentTier = DISCIPLINE_TIERS[i];
                nextTier = i < DISCIPLINE_TIERS.length - 1 ? DISCIPLINE_TIERS[i + 1] : null;
                break;
            }
        }

        return {
            tier: currentTier,
            nextTier: nextTier,
            hoursUntilNext: nextTier ? round2(nextTier.hours - totalUnplannedHours) : 0,
            totalHours: round2(totalUnplannedHours)
        };
    }

    function getUnplannedLineItems(activities) {
        // Only unexcused — NOT including PTOST (those are already excused)
        return activities
            .filter(function(a) { return UNPLANNED_NOT_PTOST.indexOf(a.activity) !== -1; })
            .sort(function(a, b) { return a.fromDate.localeCompare(b.fromDate); });
    }

    function getPtostLineItems(activities) {
        return activities
            .filter(function(a) { return PTOST_CATEGORIES.indexOf(a.activity) !== -1; })
            .sort(function(a, b) { return a.fromDate.localeCompare(b.fromDate); });
    }

    function getNeedsReclassificationItems(activities) {
        return activities
            .filter(function(a) { return UNPLANNED_NOT_PTOST.indexOf(a.activity) !== -1; })
            .sort(function(a, b) { return a.fromDate.localeCompare(b.fromDate); });
    }

    var PLANNED_CATEGORIES = ['Pre Planned Absence', 'Holiday', 'VTO-PTO', 'Alternate Day Off', 'Extra Day off'];

    function getPlannedLineItems(activities) {
        return activities
            .filter(function(a) { return PLANNED_CATEGORIES.indexOf(a.activity) !== -1; })
            .sort(function(a, b) { return a.fromDate.localeCompare(b.fromDate); });
    }

    // --- Name Matching ---

    function normalizeNameForMatch(name) {
        return cleanStr(name).toLowerCase().replace(/\s+/g, ' ');
    }

    // --- Payroll PTO Report Parser ---

    function parsePayrollPtoText(text) {
        // Parse PWMS1001 PTO & Vacation Balances report text
        // Handles both line-by-line format and PDF.js concatenated format
        var results = [];
        var lines = text.split('\n').map(function(l) { return l.trim(); }).filter(function(l) { return l.length > 0; });

        for (var i = 0; i < lines.length; i++) {
            var line = lines[i];

            // Format 1: Data line with numbers, name on next line
            // e.g.: "17347 6790 PTO     11.73    160.00     78.50      0.00     93.23"
            var dataMatch = line.match(/^\d+\s+\d+\s+PTO\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.-]+)\s+([\d.]+)/);
            if (dataMatch) {
                var prevYr = parseFloat(dataMatch[1]);
                var earned = parseFloat(dataMatch[2]);
                var taken = parseFloat(dataMatch[3]);
                var remaining = parseFloat(dataMatch[5]);

                // Next line should be the name
                var nameLine = (i + 1 < lines.length) ? lines[i + 1] : '';
                var nameClean = nameLine.split(/\s{2,}|Transition/)[0].trim();
                nameClean = nameClean.replace(/\s+$/, '');

                if (nameClean && !nameClean.match(/^[\d=_*]+$/) && !nameClean.match(/^(Total|End|Report|Run|PTO)/i)) {
                    results.push({ name: nameClean, prevYr: round2(prevYr), earned: round2(earned), taken: round2(taken), remaining: round2(remaining) });
                    i++;
                }
                continue;
            }

            // Format 2: PDF.js might put numbers and name on same line or nearby
            // Look for pattern: ID DEPT PTO numbers... then name somewhere
            // Also try: "11.73  160.00  78.50  0.00  93.23" followed by name
            var numsMatch = line.match(/([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.-]+)\s+([\d.]+)\s*$/);
            if (numsMatch && line.match(/PTO/)) {
                var prevYr = parseFloat(numsMatch[1]);
                var earned = parseFloat(numsMatch[2]);
                var taken = parseFloat(numsMatch[3]);
                var remaining = parseFloat(numsMatch[5]);
                // Sanity check: earned should be >= 100 (annual allotment)
                if (earned < 100) continue;

                var nameLine = (i + 1 < lines.length) ? lines[i + 1] : '';
                var nameClean = nameLine.split(/\s{2,}|Transition/)[0].trim();
                if (nameClean && nameClean.match(/[a-zA-Z]/) && !nameClean.match(/^(Total|End|Report|Run|PTO|ID|Page)/i)) {
                    results.push({ name: nameClean, prevYr: round2(prevYr), earned: round2(earned), taken: round2(taken), remaining: round2(remaining) });
                    i++;
                }
            }
        }

        return results;
    }

    // --- Payroll Excel Parser (PW_TL_RPT_EX / PW_TL_PAYB_E) ---

    function parsePayrollExcel(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                try {
                    var XLSX = window.XLSX;
                    if (!XLSX) { reject('XLSX library not loaded'); return; }
                    var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array', cellDates: true });
                    var ws = wb.Sheets[wb.SheetNames[0]];
                    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
                    var result = parsePayrollRows(rows);
                    resolve(result);
                } catch (err) {
                    reject('Failed to parse payroll Excel: ' + err.message);
                }
            };
            reader.onerror = function() { reject('Failed to read file'); };
            reader.readAsArrayBuffer(file);
        });
    }

    function parsePayrollRows(rows) {
        // Find header row
        var headerRow = -1;
        for (var i = 0; i < Math.min(rows.length, 10); i++) {
            var firstCell = cleanStr(String(rows[i]?.[0] || ''));
            if (firstCell.match(/Emplid/i) || firstCell.match(/Empl.*ID/i)) {
                headerRow = i;
                break;
            }
        }
        if (headerRow < 0) return {};

        // Detect column layout
        var header = rows[headerRow];
        var colMap = {};
        for (var c = 0; c < header.length; c++) {
            var h = cleanStr(String(header[c] || '')).toLowerCase();
            if (h === 'name') colMap.name = c;
            else if (h === 'date' || h === 'reported date') colMap.date = c;
            else if (h === 'trc') colMap.trc = c;
            else if (h === 'quantity') colMap.qty = c;
            else if (h === 'status') colMap.status = c;
            else if (h === 'task code') colMap.task = c;
            else if (h === 'in' && !colMap.clockIn) colMap.clockIn = c;
            else if (h === 'out') colMap.clockOut = c;
            else if (h === 'transfer' || h === 'lunch') colMap.lunchOut = c;
            else if (h === 'in' && colMap.clockIn !== undefined) colMap.lunchIn = c;
        }

        // Fallback to known positions if header detection misses
        if (colMap.name === undefined) colMap.name = 1;
        if (colMap.date === undefined) colMap.date = 6;
        if (colMap.trc === undefined) colMap.trc = 14;
        if (colMap.qty === undefined) colMap.qty = 15;
        if (colMap.status === undefined) colMap.status = 16;
        if (colMap.task === undefined) colMap.task = 22;

        var byEmployee = {};

        for (var i = headerRow + 1; i < rows.length; i++) {
            var row = rows[i];
            var rawName = cleanStr(String(row[colMap.name] || ''));
            if (!rawName) continue;

            var trc = cleanStr(String(row[colMap.trc] || '')).toUpperCase();
            if (!trc) continue;

            // Skip regular/overtime/short-day for attendance purposes
            if (trc === 'REG' || trc === 'OT4' || trc === 'OT5' || trc === 'SD') continue;

            var dateRaw = row[colMap.date];
            var dateStr = null;
            if (dateRaw instanceof Date) {
                dateStr = dateRaw.toISOString().split('T')[0];
            } else {
                dateStr = parseDate(dateRaw);
            }
            if (!dateStr) continue;

            var qty = parseFloat(row[colMap.qty]) || 0;
            if (qty <= 0) continue;

            var status = cleanStr(String(row[colMap.status] || ''));
            var taskCode = cleanStr(String(row[colMap.task] || '')).toUpperCase();

            if (!byEmployee[rawName]) byEmployee[rawName] = [];
            byEmployee[rawName].push({
                date: dateStr,
                trc: trc,
                hours: round2(qty),
                status: status,
                taskCode: taskCode
            });
        }

        // Build summary per employee
        var result = {};
        Object.keys(byEmployee).forEach(function(name) {
            var entries = byEmployee[name].sort(function(a, b) { return a.date.localeCompare(b.date); });
            var ptostTotal = 0;
            var unschdTotal = 0;
            var fmlaTotal = 0;
            var brvTotal = 0;
            var ptoTotal = 0;
            var ptostEntries = [];
            var unschdEntries = [];
            var fmlaEntries = [];
            var brvEntries = [];
            var ptoEntries = [];
            var pendingEntries = [];

            entries.forEach(function(e) {
                if (e.trc === 'PTOST') {
                    ptostTotal += e.hours;
                    ptostEntries.push(e);
                } else if (e.trc === 'FMLNP') {
                    fmlaTotal += e.hours;
                    fmlaEntries.push(e);
                } else if (e.trc === 'BRV') {
                    brvTotal += e.hours;
                    brvEntries.push(e);
                } else if (e.trc === 'PTO') {
                    ptoTotal += e.hours;
                    ptoEntries.push(e);
                    if (e.taskCode === 'UNSCHD') {
                        unschdTotal += e.hours;
                        unschdEntries.push(e);
                    }
                } else if (e.trc === 'HOL' || e.trc === 'STD' || e.trc === 'PPL' || e.trc === 'NOP') {
                    // Track but don't count against anything
                }

                if (e.status === 'Needs Approval') {
                    pendingEntries.push(e);
                }
            });

            result[name] = {
                entries: entries,
                ptostTotal: round2(ptostTotal),
                ptostRemaining: round2(Math.max(0, PTOST_ANNUAL_LIMIT - ptostTotal)),
                ptostOver: round2(Math.max(0, ptostTotal - PTOST_ANNUAL_LIMIT)),
                unschdTotal: round2(unschdTotal),
                fmlaTotal: round2(fmlaTotal),
                brvTotal: round2(brvTotal),
                ptoTotal: round2(ptoTotal),
                ptostEntries: ptostEntries,
                unschdEntries: unschdEntries,
                fmlaEntries: fmlaEntries,
                brvEntries: brvEntries,
                ptoEntries: ptoEntries,
                pendingEntries: pendingEntries
            };
        });

        return result;
    }

    function matchEmployeeToExisting(verintName) {
        var cleaned = cleanStr(verintName);
        // Build list of all known names from all sources
        var allNames = new Set();
        // From weekly/ytd data
        var weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        var ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        Object.values(weekly).concat(Object.values(ytd)).forEach(function(period) {
            (period?.employees || []).forEach(function(emp) { if (emp?.name) allNames.add(emp.name); });
        });
        // From attendance store
        var store = loadStore();
        Object.keys(store.associates || {}).forEach(function(name) { allNames.add(name); });

        var verintNorm = normalizeNameForMatch(cleaned);

        // Direct match
        for (var name of allNames) {
            if (normalizeNameForMatch(name) === verintNorm) return name;
        }

        // Try "Last, First" → "Last, First" (already in this format in data)
        // Try reverse: "Last, First" → match against "First Last"
        var commaParts = cleaned.split(',').map(function(s) { return s.trim(); });
        if (commaParts.length === 2) {
            var reversed = commaParts[1] + ' ' + commaParts[0];
            var reversedNorm = normalizeNameForMatch(reversed);
            for (var name of allNames) {
                if (normalizeNameForMatch(name) === reversedNorm) return name;
            }
            // Partial last name match
            var lastNorm = normalizeNameForMatch(commaParts[0]);
            for (var name of allNames) {
                if (normalizeNameForMatch(name).indexOf(lastNorm) !== -1) return name;
            }
        }

        return cleaned; // Return as-is if no match
    }

    // --- Dashboard Rendering ---

    function renderProgressBar(value, max, color, height) {
        var pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
        return '<div style="background:#e0e0e0; border-radius:6px; height:' + (height || 20) + 'px; overflow:hidden; position:relative;">' +
            '<div style="background:' + color + '; height:100%; width:' + pct + '%; border-radius:6px; transition:width 0.3s;"></div>' +
        '</div>';
    }

    function renderTierBar(totalHours) {
        var maxH = 48;
        var pct = function(h) { return Math.min(100, (h / maxH) * 100); };
        var currentPct = pct(totalHours);

        var markers = DISCIPLINE_TIERS.slice(1).map(function(t) {
            var p = pct(t.hours);
            return '<div style="position:absolute; left:' + p + '%; top:-18px; font-size:0.7em; color:' + t.color + '; transform:translateX(-50%); white-space:nowrap;">' + t.hours + 'h</div>' +
                '<div style="position:absolute; left:' + p + '%; top:0; bottom:0; width:2px; background:' + t.color + '; opacity:0.5;"></div>';
        }).join('');

        var barColor = totalHours >= 40 ? '#880e4f' : totalHours >= 32 ? '#b71c1c' : totalHours >= 24 ? '#d84315' : totalHours >= 16 ? '#e65100' : '#2e7d32';

        return '<div style="position:relative; margin-top:24px; margin-bottom:8px;">' +
            markers +
            '<div style="background:#e0e0e0; border-radius:6px; height:24px; overflow:hidden; position:relative;">' +
                '<div style="background:' + barColor + '; height:100%; width:' + currentPct + '%; border-radius:6px; transition:width 0.3s;"></div>' +
            '</div>' +
            '<div style="display:flex; justify-content:space-between; font-size:0.75em; color:#999; margin-top:4px;">' +
                '<span>0h</span><span>' + maxH + 'h</span>' +
            '</div>' +
        '</div>';
    }

    function sourceBadge(label, colors) {
        return '<span style="display:inline-flex; align-items:center; gap:4px; padding:2px 8px; border-radius:999px; font-size:0.75em; font-weight:700; background:' + colors.bg + '; color:' + colors.text + ';">' + label + '</span>';
    }

    function renderAttendanceDashboard(container, employeeName) {
        var store = loadStore();
        var data = store.associates?.[employeeName]?.verintData;

        if (!data) {
            container.innerHTML = '<div style="padding:20px; color:#666; text-align:center;">No Verint data uploaded for this associate. Use the upload button above.</div>';
            return;
        }

        var fmlaData = data.summary?.['FMLA'] || { used: 0 };
        var fmlaActivities = (data.activities || []).filter(function(a) { return a.activity === 'FMLA'; });
        var unplannedItems = getUnplannedLineItems(data.activities || []);
        var ptostItems = getPtostLineItems(data.activities || []);
        var reclassItems = getNeedsReclassificationItems(data.activities || []);
        var plannedItems = getPlannedLineItems(data.activities || []);

        // Load missed lunch flags
        // Auto-bake: entries over 4 hours default to missed lunch unless user explicitly unchecked (false)
        var savedLunchFlags = store.associates?.[employeeName]?.missedLunchFlags || {};
        var lunchFlags = {};
        unplannedItems.forEach(function(item) {
            var key = item.fromDate + '|' + item.activity;
            if (savedLunchFlags[key] === true) {
                lunchFlags[key] = true;
            } else if (savedLunchFlags[key] === false) {
                // User explicitly unchecked — respect it
                lunchFlags[key] = false;
            } else if (item.hours > 4) {
                // Auto-bake: >4 hours = missed lunch by default
                lunchFlags[key] = true;
            }
        });

        // Calculate PTOST usage + missed lunch adjustments
        var entryNotes = store.associates?.[employeeName]?.entryNotes || {};
        var EXCUSING_REASONS = ['pc_issues', 'system_outage', 'mgr_approved'];
        var ptost = calculatePtostUsage(data.ptoSubCategories || {});
        var missedLunchTotal = 0;
        var excusedByReasonTotal = 0;
        unplannedItems.forEach(function(item) {
            var key = item.fromDate + '|' + item.activity;
            var note = entryNotes[key] || {};
            var isExcusedByReason = EXCUSING_REASONS.indexOf(note.reason) !== -1;
            if (isExcusedByReason) {
                var hrs = lunchFlags[key] ? round2(item.hours + 0.5) : item.hours;
                excusedByReasonTotal += hrs;
            } else if (lunchFlags[key]) {
                missedLunchTotal += 0.5;
            }
        });
        // Adjust for missed lunch and excused-by-reason
        if (missedLunchTotal > 0 || excusedByReasonTotal > 0) {
            ptost.unplannedNotPtost = round2(ptost.unplannedNotPtost + missedLunchTotal - excusedByReasonTotal);
            ptost.totalUnplanned = round2(ptost.totalUnplanned + missedLunchTotal - excusedByReasonTotal);
            ptost.policyHours = round2(Math.max(0, ptost.unplannedNotPtost));
            ptost.reclassificationGap = round2(Math.max(0, ptost.unplannedNotPtost));
            ptost.canExcuse = round2(Math.min(ptost.policyHours, ptost.ptostRemaining));
            ptost.policyHoursAfterExcusing = round2(Math.max(0, ptost.policyHours - ptost.ptostRemaining));
            ptost.missedLunchTotal = missedLunchTotal;
            ptost.excusedByReasonTotal = excusedByReasonTotal;
        }
        var verintReliabilityBasis = round2(ptost.policyHours || 0);
        var firstName = employeeName.split(/[\s,]+/)[0];
        if (typeof getEmployeeNickname === 'function') {
            firstName = getEmployeeNickname(employeeName) || firstName;
        }

        var bereavementData = data.summary?.['WFO-Bereavement'] || { used: 0 };
        var bereavementActivities = (data.activities || []).filter(function(a) { return a.activity === 'WFO-Bereavement' || a.activity === 'Bereavement'; });

        // If payroll data exists, override PTOST and policy calculations
        var payroll = store.associates?.[employeeName]?.payrollData;
        var hasPayroll = !!payroll;
        if (hasPayroll) {
            ptost.ptostUsed = payroll.ptostTotal;
            ptost.ptostRemaining = payroll.ptostRemaining;
            ptost.unplannedNotPtost = payroll.unschdTotal;
            ptost.policyHours = payroll.unschdTotal;
            ptost.reclassificationGap = ptost.unplannedNotPtost;
            ptost.canExcuse = round2(Math.min(ptost.policyHours, ptost.ptostRemaining));
            ptost.policyHoursAfterExcusing = round2(Math.max(0, ptost.policyHours - ptost.ptostRemaining));
            fmlaData = { used: payroll.fmlaTotal };
            fmlaActivities = payroll.fmlaEntries || [];
            bereavementData = { used: payroll.brvTotal };
            bereavementActivities = payroll.brvEntries || [];
        }
        var payrollReliabilityBasis = hasPayroll ? round2(ptost.policyHours || 0) : null;

        // Load manual reliability override
        var manualReliability = store.associates?.[employeeName]?.manualReliabilityHours;
        var staleZeroOverride = manualReliability === 0 && hasPayroll && payrollReliabilityBasis === 0 && verintReliabilityBasis > 0;
        var hasManualReliability = (manualReliability !== undefined && manualReliability !== null) && !staleZeroOverride;
        var calcHours = ptost.policyHours;
        var preferredBasis = (!hasManualReliability && hasPayroll && payrollReliabilityBasis === 0 && verintReliabilityBasis > 0)
            ? verintReliabilityBasis
            : calcHours;
        var reliabilityHours = hasManualReliability ? manualReliability : preferredBasis;
        // Recalculate tier based on actual reliability hours used
        var tier = calculateDisciplineTier(reliabilityHours);
        // Recalculate canExcuse based on actual reliability
        var canExcuse = round2(Math.min(reliabilityHours, ptost.ptostRemaining));
        var afterExcusing = round2(Math.max(0, reliabilityHours - ptost.ptostRemaining));

        var html = '';

        // Focused coach view: default to a single side-by-side reconciliation workflow.
        var ptoSummary = data.summary?.['PTO'] || {};
        var manualPto = store.associates?.[employeeName]?.manualPto || {};
        var ptoCarryover = round2(manualPto.carryover !== undefined ? manualPto.carryover : (ptoSummary.carryover || 0));
        var ptoAllotment = round2(manualPto.allotment !== undefined ? manualPto.allotment : ((ptoSummary.total || 0) - (ptoSummary.carryover || 0)));
        var ptoTotal = round2(ptoCarryover + ptoAllotment);
        var ptoUsed = round2(manualPto.payrollTaken !== undefined ? manualPto.payrollTaken : (ptoSummary.used || 0));
        var ptoRemaining = round2(manualPto.payrollRemaining !== undefined ? manualPto.payrollRemaining : (ptoSummary.remaining || 0));

        var payrollEntries = hasPayroll ? (payroll.entries || []) : [];
        var payrollPtoEntries = payrollEntries.filter(function(e) { return e.trc === 'PTO'; });
        var payrollPtostEntries = payrollEntries.filter(function(e) { return e.trc === 'PTOST'; });
        var ptoApprovedHrs = round2(payrollPtoEntries.filter(function(e) { return e.status === 'Approved'; }).reduce(function(s, e) { return s + e.hours; }, 0));
        var ptoPendingHrs = round2(payrollPtoEntries.filter(function(e) { return e.status === 'Needs Approval'; }).reduce(function(s, e) { return s + e.hours; }, 0));
        var ptostApprovedHrs = round2(payrollPtostEntries.filter(function(e) { return e.status === 'Approved'; }).reduce(function(s, e) { return s + e.hours; }, 0));
        var ptostPendingHrs = round2(payrollPtostEntries.filter(function(e) { return e.status === 'Needs Approval'; }).reduce(function(s, e) { return s + e.hours; }, 0));

        var comparePayroll = payrollEntries.filter(function(e) {
            return e.trc === 'PTOST' || (e.trc === 'PTO' && e.taskCode === 'UNSCHD');
        });
        var compareVerint = (data.activities || []).filter(function(a) {
            return PTOST_CATEGORIES.indexOf(a.activity) !== -1 ||
                UNPLANNED_NOT_PTOST.indexOf(a.activity) !== -1;
        });

        // Separate category data for their own sections
        var holPayrollHrs = round2(payrollEntries.filter(function(e) { return e.trc === 'HOL'; }).reduce(function(s, e) { return s + e.hours; }, 0));
        var holVerintHrs = round2((data.activities || []).filter(function(a) { return a.activity === 'Holiday'; }).reduce(function(s, a) { return s + a.hours; }, 0));

        var fmlaPayrollHrs = round2(payrollEntries.filter(function(e) { return e.trc === 'FMLNP' || e.trc === 'FML'; }).reduce(function(s, e) { return s + e.hours; }, 0));
        var fmlaVerintHrs = round2((data.activities || []).filter(function(a) { return a.activity === 'FMLA'; }).reduce(function(s, a) { return s + a.hours; }, 0));

        var brvPayrollHrs = round2(payrollEntries.filter(function(e) { return e.trc === 'BRV'; }).reduce(function(s, e) { return s + e.hours; }, 0));
        var brvVerintHrs = round2((data.activities || []).filter(function(a) { return a.activity === 'WFO-Bereavement' || a.activity === 'Bereavement'; }).reduce(function(s, a) { return s + a.hours; }, 0));

        var prePlannedPayrollHrs = round2(payrollEntries.filter(function(e) { return e.trc === 'PTO' && e.taskCode !== 'UNSCHD'; }).reduce(function(s, e) { return s + e.hours; }, 0));
        var prePlannedVerintHrs = round2((data.activities || []).filter(function(a) { return a.activity === 'Pre Planned Absence'; }).reduce(function(s, a) { return s + a.hours; }, 0));

        var payrollByDate = {};
        comparePayroll.forEach(function(e) {
            if (!payrollByDate[e.date]) payrollByDate[e.date] = [];
            payrollByDate[e.date].push(e);
        });

        var verintByDate = {};
        compareVerint.forEach(function(a) {
            var d = a.fromDate;
            if (!verintByDate[d]) verintByDate[d] = [];
            verintByDate[d].push(a);
        });

        var allDatesMap = {};
        Object.keys(payrollByDate).forEach(function(d) { allDatesMap[d] = true; });
        Object.keys(verintByDate).forEach(function(d) { allDatesMap[d] = true; });
        var compareDates = Object.keys(allDatesMap).sort().reverse();

        function buildPtostApprovedCumulativeByDate(payrollRecords) {
            var approvedPtost = (payrollRecords || []).filter(function(r) {
                return r.trc === 'PTOST' && r.status === 'Approved' && r.date;
            });

            var byDate = {};
            approvedPtost.forEach(function(r) {
                byDate[r.date] = round2((byDate[r.date] || 0) + (r.hours || 0));
            });

            var cumulativeByDate = {};
            var running = 0;
            Object.keys(byDate).sort().forEach(function(date) {
                running = round2(running + byDate[date]);
                cumulativeByDate[date] = running;
            });

            return {
                totalApproved: running,
                cumulativeByDate: cumulativeByDate
            };
        }

        var ptostApprovedRollup = buildPtostApprovedCumulativeByDate(payrollEntries);
        var ptostApprovedCumulativeByDate = ptostApprovedRollup.cumulativeByDate;

        var mismatchDates = [];

        html += '<div style="margin-bottom:12px; padding:10px 12px; border:1px solid #dbeafe; background:#f8fbff; border-radius:8px;">';
        html += '<div style="display:flex; flex-wrap:wrap; align-items:center; gap:8px; margin-bottom:6px;">';
        html += '<span style="font-size:0.86em; font-weight:700; color:#1e3a8a;">Attendance Coach View</span>';
        html += sourceBadge('Payroll = official', { bg: '#e0f2f1', text: '#00695c' });
        html += sourceBadge('Verint = displayed coding', { bg: '#f3e5f5', text: '#6a1b9a' });
        html += sourceBadge('Orange/Red = needs action', { bg: '#fff3e0', text: '#e65100' });
        html += '</div>';
        html += '<div style="font-size:0.8em; color:#334155;">One screen to coach from: approval status, PTO left, and side-by-side differences by date.</div>';
        html += '</div>';

        html += '<div style="margin-bottom:14px; padding:14px; background:#fff; border:1px solid #e5e7eb; border-radius:8px;">';
        html += '<h4 style="margin:0 0 10px 0; color:#0f172a;">Snapshot</h4>';
        html += '<div style="display:grid; grid-template-columns:repeat(4, minmax(130px, 1fr)); gap:8px;">';
        html += '<div style="padding:8px; border-radius:6px; background:#f8fafc;"><div style="font-size:0.75em; color:#64748b;">PTO Left</div><div style="font-size:1.2em; font-weight:800; color:#0f766e;">' + ptoRemaining + 'h</div><div style="font-size:0.72em; color:#64748b;">' + (hasPayroll ? 'from Payroll' : 'from Verint') + '</div></div>';
        html += '<div style="padding:8px; border-radius:6px; background:#f8fafc;"><div style="font-size:0.75em; color:#64748b;">' + (hasPayroll ? 'PTO Status (Payroll)' : 'PTO Status (Verint)') + '</div><div style="font-size:1.05em; font-weight:800; color:#1d4ed8;">' + (hasPayroll ? (ptoApprovedHrs + 'h approved in Payroll') : (ptoUsed + 'h used in Verint')) + '</div><div style="font-size:0.72em; color:#b45309;">' + (hasPayroll ? (ptoPendingHrs + 'h pending in Payroll') : 'Upload Payroll for approvals') + '</div></div>';
        html += '<div style="padding:8px; border-radius:6px; background:#f8fafc;"><div style="font-size:0.75em; color:#64748b;">' + (hasPayroll ? 'PTOST Status (Payroll)' : 'PTOST Status (Verint)') + '</div><div style="font-size:1.05em; font-weight:800; color:#0d47a1;">' + (hasPayroll ? (ptostApprovedHrs + 'h approved in Payroll') : (ptost.ptostUsed + 'h used in Verint')) + '</div><div style="font-size:0.72em; color:#b45309;">' + (hasPayroll ? (ptostPendingHrs + 'h pending in Payroll') : 'Upload Payroll for approvals') + '</div></div>';
        html += '<div style="padding:8px; border-radius:6px; background:#f8fafc;"><div style="font-size:0.75em; color:#64748b;">Reliability Basis</div><div style="font-size:1.05em; font-weight:800; color:#7c3aed;">Verint ' + verintReliabilityBasis + 'h</div><div style="font-size:0.72em; color:#64748b;">' + (payrollReliabilityBasis !== null ? ('Payroll ' + payrollReliabilityBasis + 'h') : 'No Payroll basis yet') + '</div></div>';
        html += '</div>';
        html += '<div style="display:grid; grid-template-columns:repeat(4, minmax(130px, 1fr)); gap:8px; margin-top:8px;">';
        html += '<div style="padding:8px; border-radius:6px; background:#eff6ff; border:1px solid #bfdbfe;"><div style="font-size:0.75em; color:#1d4ed8; font-weight:700;">Pre Planned Absence</div><div style="font-size:1.05em; font-weight:800; color:#1d4ed8;">' + (hasPayroll ? prePlannedPayrollHrs : prePlannedVerintHrs) + 'h</div><div style="font-size:0.72em; color:#64748b;">' + (hasPayroll ? ('Payroll · Verint: ' + prePlannedVerintHrs + 'h') : 'from Verint') + '</div></div>';
        html += '<div style="padding:8px; border-radius:6px; background:#f0fdf4; border:1px solid #bbf7d0;"><div style="font-size:0.75em; color:#166534; font-weight:700;">Holiday</div><div style="font-size:1.05em; font-weight:800; color:#166534;">' + (hasPayroll ? holPayrollHrs : holVerintHrs) + 'h</div><div style="font-size:0.72em; color:#64748b;">' + (hasPayroll ? ('Payroll · Verint: ' + holVerintHrs + 'h') : 'from Verint') + '</div></div>';
        html += '<div style="padding:8px; border-radius:6px; background:#fdf4ff; border:1px solid #e9d5ff;"><div style="font-size:0.75em; color:#7e22ce; font-weight:700;">FMLA</div><div style="font-size:1.05em; font-weight:800; color:#7e22ce;">' + (hasPayroll ? fmlaPayrollHrs : fmlaVerintHrs) + 'h</div><div style="font-size:0.72em; color:#64748b;">' + (hasPayroll ? ('Payroll · Verint: ' + fmlaVerintHrs + 'h') : 'from Verint') + '</div></div>';
        html += '<div style="padding:8px; border-radius:6px; background:#fff1f2; border:1px solid #fecdd3;"><div style="font-size:0.75em; color:#9f1239; font-weight:700;">Bereavement</div><div style="font-size:1.05em; font-weight:800; color:#9f1239;">' + (hasPayroll ? brvPayrollHrs : brvVerintHrs) + 'h</div><div style="font-size:0.72em; color:#64748b;">' + (hasPayroll ? ('Payroll · Verint: ' + brvVerintHrs + 'h') : 'from Verint') + '</div></div>';
        html += '</div>';

        html += '<div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:10px;">';
        html += '<label style="font-size:0.82em; font-weight:600; color:#334155;">PowerBI reliability hours:</label>';
        html += '<input type="number" id="manualReliabilityInput" step="0.01" value="' + (hasManualReliability ? manualReliability : '') + '" placeholder="' + preferredBasis + '" style="width:90px; padding:5px; border:2px solid ' + tier.tier.color + '; border-radius:5px; font-weight:700; color:' + tier.tier.color + '; text-align:center;">';
        html += '<button type="button" id="useVerintBasisBtn" style="padding:5px 10px; border:1px solid #6a1b9a; color:#6a1b9a; background:#fff; border-radius:999px; font-size:0.78em; font-weight:700; cursor:pointer;">Use Verint basis</button>';
        html += '<div style="font-size:0.8em; color:#475569;">Showing ' + reliabilityHours + 'h against reliability.</div>';
        html += '</div>';
        html += '</div>';

        html += '<div style="margin-bottom:16px; padding:14px; background:#fff; border:1px solid #e5e7eb; border-radius:8px;">';
        html += '<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:8px;">';
        html += '<h4 style="margin:0; color:#0f172a;">Side-by-Side by Date</h4>';
        html += '<select id="attendanceDiffFilter" style="padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; font-size:0.82em;">';
        html += '<option value="all">Show all dates</option>';
        html += '<option value="diff">Show differences only</option>';
        html += '<option value="approval">Show pending approvals</option>';
        html += '</select>';
        html += '</div>';
        html += '<div style="font-size:0.8em; color:#475569; margin-bottom:8px;">This table is only unscheduled/PTOST items. Matches are checked by date and PTOST hours. Pre Planned Absence is tracked in the separate snapshot card above.</div>';
        html += '<div style="overflow:auto;">';
        html += '<table style="width:100%; border-collapse:collapse; font-size:0.84em; min-width:860px;">';
        html += '<tr style="background:#f1f5f9;">';
        html += '<th style="padding:7px 8px; text-align:left;">Date</th>';
        html += '<th style="padding:7px 8px; text-align:left;">Payroll (official + status)</th>';
        html += '<th style="padding:7px 8px; text-align:left;">Verint (shown)</th>';
        html += '<th style="padding:7px 8px; text-align:left;">Difference</th>';
        html += '<th style="padding:7px 8px; text-align:left;">Action</th>';
        html += '</tr>';

        compareDates.forEach(function(date) {
            var pItems = payrollByDate[date] || [];
            var vItems = verintByDate[date] || [];

            var payrollText = pItems.length ? pItems.map(function(p) {
                var status = p.status || 'Unknown';
                var statusColor = status === 'Approved' ? '#166534' : status === 'Needs Approval' ? '#b45309' : '#475569';
                var tag = p.trc + ' ' + p.hours + 'h';
                return tag + ' <span style="color:' + statusColor + ';">[' + status + ']</span>';
            }).join(' | ') : '<span style="color:#94a3b8;">No Payroll entry</span>';

            var verintText = vItems.length ? vItems.map(function(v) {
                return escHtml(v.activity) + ' ' + v.hours + 'h';
            }).join(' | ') : '<span style="color:#94a3b8;">No Verint entry</span>';

            var payrollPtostHrs = round2(pItems.filter(function(p) { return p.trc === 'PTOST'; }).reduce(function(s, p) { return s + p.hours; }, 0));
            var verintPtostHrs = round2(vItems.filter(function(v) { return PTOST_CATEGORIES.indexOf(v.activity) !== -1; }).reduce(function(s, v) { return s + v.hours; }, 0));
            var verintUnplannedHrs = round2(vItems.filter(function(v) { return UNPLANNED_NOT_PTOST.indexOf(v.activity) !== -1; }).reduce(function(s, v) { return s + v.hours; }, 0));
            var payrollHasPtost = payrollPtostHrs > 0;
            var verintHasPtost = verintPtostHrs > 0;
            var hasPending = pItems.some(function(p) { return p.status === 'Needs Approval'; });
            var hasVerintTardy = vItems.some(function(v) { return /tardy/i.test(String(v.activity || '')); });
            var ptostHoursMatch = payrollHasPtost && verintHasPtost && Math.abs(payrollPtostHrs - verintPtostHrs) < 0.01;
            var cumulativeApprovedPtost = ptostApprovedCumulativeByDate[date] || 0;

            var diff = 'Aligned';
            var diffColor = '#166534';
            var action = 'None';

            if (payrollHasPtost && !verintHasPtost) {
                if (Math.abs(payrollPtostHrs - verintUnplannedHrs) < 0.01 && verintUnplannedHrs > 0) {
                    diff = 'Coding mismatch only (hours match)';
                    diffColor = '#b91c1c';
                    action = 'Send WFM fix';
                    mismatchDates.push(date);
                } else {
                    diff = 'Payroll PTOST missing in Verint';
                    diffColor = '#b91c1c';
                    action = 'Send WFM fix';
                    mismatchDates.push(date);
                }
            } else if (!payrollHasPtost && verintHasPtost) {
                diff = 'Verint PTOST missing in Payroll';
                diffColor = '#b45309';
                action = 'Check payroll coding';
            } else if (payrollHasPtost && verintHasPtost && !ptostHoursMatch) {
                diff = 'PTOST hours mismatch (' + payrollPtostHrs + 'h vs ' + verintPtostHrs + 'h)';
                diffColor = '#b45309';
                action = 'Verify edits in Payroll/Verint';
            } else if (hasPending) {
                diff = 'Pending payroll approval';
                diffColor = '#b45309';
                action = 'Wait/approve in Payroll';
            } else if (!pItems.length && hasVerintTardy) {
                diff = 'Tardy only - no payroll entry';
                diffColor = '#b45309';
                action = 'Verify next Payroll report';
            } else if (!pItems.length && vItems.length) {
                diff = 'Only in Verint';
                diffColor = '#b45309';
                action = 'Verify next Payroll report';
            } else if (pItems.length && !vItems.length) {
                diff = 'Only in Payroll';
                diffColor = '#b45309';
                action = 'May need Verint update';
            }

            if (payrollHasPtost && cumulativeApprovedPtost > PTOST_ANNUAL_LIMIT) {
                diff = 'PTOST balance exhausted - should be PTO Unscheduled';
                diffColor = '#b91c1c';
            }

            var rowBg = diffColor === '#166534' ? '#f8fff9' : '#fff7ed';
            if (diffColor === '#b91c1c') rowBg = '#fff5f5';

            html += '<tr data-att-row="1" data-is-diff="' + (diff !== 'Aligned' ? '1' : '0') + '" data-has-pending="' + (hasPending ? '1' : '0') + '" style="border-bottom:1px solid #e5e7eb; background:' + rowBg + ';">';
            html += '<td style="padding:7px 8px; white-space:nowrap; font-weight:600;">' + formatDateDisplay(date) + '</td>';
            html += '<td style="padding:7px 8px; color:#0f172a;">' + payrollText + '</td>';
            html += '<td style="padding:7px 8px; color:#0f172a;">' + verintText + '</td>';
            html += '<td style="padding:7px 8px; color:' + diffColor + '; font-weight:700;">' + diff + '</td>';
            html += '<td style="padding:7px 8px; color:#334155;">' + action + '</td>';
            html += '</tr>';
        });

        html += '</table></div>';
        html += '<div style="margin-top:10px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">';
        html += '<button type="button" id="copyAssociatePtostMsgBtn" style="background:#2563eb; color:white; border:none; border-radius:6px; padding:8px 12px; cursor:pointer; font-weight:700;">Copy Associate PTOST Message</button>';
        html += '<span style="font-size:0.8em; color:#64748b;">Includes "do you want me to claim PTOST" language when claimable hours exist.</span>';
        html += '</div>';
        if (mismatchDates.length > 0) {
            html += '<div style="margin-top:10px; display:flex; gap:8px; align-items:center; flex-wrap:wrap;">';
            html += '<button type="button" id="copyMismatchMsgBtn" style="background:#b91c1c; color:white; border:none; border-radius:6px; padding:8px 12px; cursor:pointer; font-weight:700;">Copy WFM Fix Message</button>';
            html += '<span style="font-size:0.8em; color:#64748b;">' + mismatchDates.length + ' date(s) need Verint updates to match Payroll.</span>';
            html += '</div>';
        }
        html += '</div>';

        container.innerHTML = html;

        document.getElementById('attendanceDiffFilter')?.addEventListener('change', function() {
            var mode = this.value;
            container.querySelectorAll('[data-att-row="1"]').forEach(function(row) {
                var isDiff = row.getAttribute('data-is-diff') === '1';
                var hasPending = row.getAttribute('data-has-pending') === '1';
                var show = mode === 'all' || (mode === 'diff' && isDiff) || (mode === 'approval' && hasPending);
                row.style.display = show ? '' : 'none';
            });
        });

        document.getElementById('manualReliabilityInput')?.addEventListener('change', function() {
            var val = this.value.trim();
            var s = loadStore();
            if (!s.associates[employeeName]) s.associates[employeeName] = {};
            if (val === '') delete s.associates[employeeName].manualReliabilityHours;
            else s.associates[employeeName].manualReliabilityHours = parseFloat(val);
            saveStore(s);
            renderAttendanceDashboard(container, employeeName);
        });

        document.getElementById('useVerintBasisBtn')?.addEventListener('click', function() {
            var s = loadStore();
            if (!s.associates[employeeName]) s.associates[employeeName] = {};
            s.associates[employeeName].manualReliabilityHours = verintReliabilityBasis;
            saveStore(s);
            renderAttendanceDashboard(container, employeeName);
        });

        document.getElementById('copyAssociatePtostMsgBtn')?.addEventListener('click', function() {
            var msgPtost = Object.assign({}, ptost, {
                policyHours: reliabilityHours,
                canExcuse: canExcuse,
                policyHoursAfterExcusing: afterExcusing
            });
            var msg = generateAssociateMessage(firstName, msgPtost, tier, reclassItems);
            navigator.clipboard.writeText(msg).then(function() {
                if (typeof showToast === 'function') showToast('Associate PTOST message copied!', 2500);
            });
        });

        document.getElementById('copyMismatchMsgBtn')?.addEventListener('click', function() {
            var msg = 'Hi WFM team,\\n\\nPlease update Verint to match Payroll PTOST coding for ' + employeeName + ' on these dates:\\n';
            mismatchDates.forEach(function(d) { msg += '- ' + formatDateDisplay(d) + '\\n'; });
            msg += '\\nThank you.';
            navigator.clipboard.writeText(msg).then(function() {
                if (typeof showToast === 'function') showToast('WFM fix message copied!', 2500);
            });
        });

        return;

        // Data source info + plain-language guide
        var sourceInfo = [];
        if (hasPayroll) sourceInfo.push('Payroll: ' + new Date(payroll.uploadedAt).toLocaleDateString() + ' (PTOST: ' + payroll.ptostTotal + 'h)');
        if (data.uploadedAt) sourceInfo.push('Verint: ' + new Date(data.uploadedAt).toLocaleDateString());
        html += '<div style="margin-bottom:10px; font-size:0.85em; color:#666;">' + (hasPayroll ? '\uD83D\uDCCA Payroll is source of truth for PTO/PTOST hours' : '\u26A0\uFE0F Verint-only view right now. Upload Payroll Excel to confirm official PTO/PTOST numbers.') + '</div>';
        if (sourceInfo.length) html += '<div style="margin-bottom:8px; font-size:0.8em; color:#999;">' + sourceInfo.join(' | ') + '</div>';
        html += '<div style="margin-bottom:14px; padding:10px 12px; border:1px solid #dbeafe; background:#f8fbff; border-radius:8px;">';
        html += '<div style="display:flex; flex-wrap:wrap; align-items:center; gap:6px; margin-bottom:8px;">';
        html += '<span style="font-size:0.82em; font-weight:700; color:#1e3a8a;">How to read this:</span>';
        html += sourceBadge('Payroll = official hours', { bg: '#e0f2f1', text: '#00695c' });
        html += sourceBadge('Verint = activity labels', { bg: '#f3e5f5', text: '#6a1b9a' });
        html += sourceBadge('Action needed = orange/red rows', { bg: '#fff3e0', text: '#e65100' });
        html += '</div>';
        html += '<div style="font-size:0.8em; color:#334155; line-height:1.45;">';
        html += 'What you can change here: set a reason on unexcused rows, update your Payroll numbers in My Records, and use Copy WFM Fix Message when Payroll and Verint disagree.';
        html += '</div>';
        html += '</div>';

        // ===== ALWAYS VISIBLE: Reliability Status =====
        html += '<div style="margin-bottom:16px; padding:16px; background:#fff; border-radius:8px; border:1px solid #e0e0e0;">';
        html += '<h4 style="margin:0 0 8px 0; color:' + tier.tier.color + ';">Reliability</h4>';

        // Manual entry field
        html += '<div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;">';
        html += '<label style="font-size:0.85em; font-weight:600; color:#333; white-space:nowrap;">Hours against reliability (from PowerBI):</label>';
        html += '<input type="number" id="manualReliabilityInput" step="0.01" value="' + (hasManualReliability ? manualReliability : '') + '" placeholder="' + preferredBasis + '" style="width:100px; padding:6px; border:2px solid ' + tier.tier.color + '; border-radius:4px; font-size:1em; font-weight:700; color:' + tier.tier.color + '; text-align:center;">';
        if (hasManualReliability && Math.abs(manualReliability - calcHours) > 0.1) {
            html += '<span style="font-size:0.8em; color:#999;">Verint calc: ' + calcHours + 'h</span>';
        }
        html += '</div>';
        if (staleZeroOverride) {
            html += '<div style="margin:-6px 0 10px; font-size:0.8em; color:#7c2d12;">Showing Verint basis by default because stored override is 0h while Verint has unexcused hours.</div>';
        }
        html += '<div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:-4px 0 10px 0;">';
        html += sourceBadge('Verint basis: ' + verintReliabilityBasis + 'h', { bg: '#f3e5f5', text: '#6a1b9a' });
        if (payrollReliabilityBasis !== null) {
            html += sourceBadge('Payroll basis: ' + payrollReliabilityBasis + 'h', { bg: '#e0f2f1', text: '#00695c' });
        }
        html += '<button type="button" id="useVerintBasisBtn" style="padding:4px 10px; border:1px solid #6a1b9a; color:#6a1b9a; background:#fff; border-radius:999px; font-size:0.78em; font-weight:700; cursor:pointer;">Use Verint basis</button>';
        html += '<span style="font-size:0.78em; color:#64748b;">Quick baseline from your Verint upload before manual overrides.</span>';
        html += '</div>';
        html += '<div style="margin:-4px 0 10px; font-size:0.78em; color:#64748b;">Verint basis formula: unplanned not-PTOST hours + missed lunch adjustments - manager/system excused reason hours.</div>';

        html += renderTierBar(reliabilityHours);
        html += '<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-top:10px; text-align:center;">';
        html += '<div style="padding:8px; background:' + tier.tier.bg + '; border-radius:6px;"><div style="font-size:1.3em; font-weight:700; color:' + tier.tier.color + ';">' + reliabilityHours + 'h</div><div style="font-size:0.75em; color:#666;">Against Reliability</div></div>';
        html += '<div style="padding:8px; background:#e3f2fd; border-radius:6px;"><div style="font-size:1.3em; font-weight:700; color:#0d47a1;">' + ptost.ptostRemaining + 'h</div><div style="font-size:0.75em; color:#666;">PTOST Available</div></div>';
        html += '<div style="padding:8px; border-radius:6px; background:' + (tier.nextTier ? tier.nextTier.bg : '#e8f5e9') + ';"><div style="font-size:1.3em; font-weight:700; color:' + (tier.nextTier ? tier.nextTier.color : '#2e7d32') + ';">' + (tier.nextTier ? tier.hoursUntilNext + 'h' : 'N/A') + '</div><div style="font-size:0.75em; color:#666;">' + (tier.nextTier ? 'Until ' + tier.nextTier.label : 'No next tier') + '</div></div>';
        html += '</div>';
        html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; flex-wrap:wrap; gap:8px;">';
        html += '<div style="padding:6px 14px; border-radius:20px; background:' + tier.tier.bg + '; color:' + tier.tier.color + '; font-weight:700; font-size:0.9em;">' + tier.tier.label + '</div>';
        if (canExcuse > 0) {
            html += '<div style="font-size:0.85em; color:#1565c0; font-weight:600;">Can excuse ' + canExcuse + 'h with PTOST \u2192 ' + afterExcusing + 'h would remain</div>';
        }
        html += '</div>';
        html += '</div>';

        // ===== ALWAYS VISIBLE: PTO Balance =====
        var ptoSummary = data.summary?.['PTO'] || {};
        var manualPto = store.associates?.[employeeName]?.manualPto || {};

        // Use payroll (manual) values when available, fall back to Verint
        var ptoCarryover = round2(manualPto.carryover !== undefined ? manualPto.carryover : (ptoSummary.carryover || 0));
        var ptoAllotment = round2(manualPto.allotment !== undefined ? manualPto.allotment : ((ptoSummary.total || 0) - (ptoSummary.carryover || 0)));
        var ptoTotal = round2(ptoCarryover + ptoAllotment);
        var ptoUsed = round2(manualPto.payrollTaken !== undefined ? manualPto.payrollTaken : (ptoSummary.used || 0));
        var ptoScheduled = round2(ptoSummary.scheduled || 0);
        var ptoRemaining = round2(manualPto.payrollRemaining !== undefined ? manualPto.payrollRemaining : (ptoSummary.remaining || 0));
        var ptoRemainingColor = ptoRemaining > 16 ? '#2e7d32' : ptoRemaining > 8 ? '#e65100' : '#b71c1c';
        var hasPayrollData = manualPto.carryover !== undefined || manualPto.allotment !== undefined || manualPto.payrollRemaining !== undefined;

        html += '<div style="margin-bottom:16px; padding:16px; background:#fff; border-radius:8px; border:1px solid #e0e0e0;">';
        html += '<h4 style="margin:0 0 10px 0; color:#2e7d32;">PTO Balance' + (hasPayrollData ? ' <span style="font-size:0.7em; font-weight:normal; color:#666;">(from Payroll)</span>' : ' <span style="font-size:0.7em; font-weight:normal; color:#999;">(from Verint)</span>') + '</h4>';
        html += renderProgressBar(ptoUsed, ptoTotal, '#2e7d32', 16);
        html += '<div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:6px; margin-top:8px; text-align:center;">';
        html += '<div style="padding:6px; background:#e8f5e9; border-radius:6px;"><div style="font-size:1em; font-weight:700; color:#2e7d32;">' + ptoCarryover + 'h</div><div style="font-size:0.7em; color:#666;">Carryover</div></div>';
        html += '<div style="padding:6px; background:#e8f5e9; border-radius:6px;"><div style="font-size:1em; font-weight:700; color:#2e7d32;">' + ptoAllotment + 'h</div><div style="font-size:0.7em; color:#666;">Allotment</div></div>';
        html += '<div style="padding:6px; background:#fff3e0; border-radius:6px;"><div style="font-size:1em; font-weight:700; color:#e65100;">' + ptoUsed + 'h</div><div style="font-size:0.7em; color:#666;">Used</div></div>';
        html += '<div style="padding:6px; background:#e3f2fd; border-radius:6px;"><div style="font-size:1em; font-weight:700; color:#1565c0;">' + ptoScheduled + 'h</div><div style="font-size:0.7em; color:#666;">Scheduled</div></div>';
        html += '<div style="padding:6px; background:#f5f5f5; border-radius:6px;"><div style="font-size:1em; font-weight:700; color:' + ptoRemainingColor + ';">' + ptoRemaining + 'h</div><div style="font-size:0.7em; color:#666;">Remaining</div></div>';
        html += '</div>';
        // Manual override inputs
        html += '<div style="margin-top:12px; padding:10px; background:#f9f9f9; border-radius:6px; border:1px dashed #ccc;">';
        html += '<div style="font-size:0.8em; color:#666; margin-bottom:6px; font-weight:600;">My Records:</div>';
        html += '<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px;">';
        html += '<div><label style="font-size:0.75em; color:#555; display:block; margin-bottom:2px;">Carryover:</label>';
        html += '<input type="number" class="manual-pto-input" data-field="carryover" step="0.5" value="' + (manualPto.carryover !== undefined ? manualPto.carryover : '') + '" placeholder="' + ptoCarryover + '" style="width:100%; padding:5px; border:1px solid #ddd; border-radius:4px; font-size:0.85em;"></div>';
        html += '<div><label style="font-size:0.75em; color:#555; display:block; margin-bottom:2px;">Allotment:</label>';
        html += '<input type="number" class="manual-pto-input" data-field="allotment" step="0.5" value="' + (manualPto.allotment !== undefined ? manualPto.allotment : '') + '" placeholder="' + ptoAllotment + '" style="width:100%; padding:5px; border:1px solid #ddd; border-radius:4px; font-size:0.85em;"></div>';
        html += '<div><label style="font-size:0.75em; color:#555; display:block; margin-bottom:2px;">PTO Left (Payroll):</label>';
        html += '<input type="number" class="manual-pto-input" data-field="payrollRemaining" step="0.5" value="' + (manualPto.payrollRemaining !== undefined ? manualPto.payrollRemaining : '') + '" placeholder="Enter hrs" style="width:100%; padding:5px; border:1px solid #ddd; border-radius:4px; font-size:0.85em;"></div>';
        html += '</div>';
        if (manualPto.payrollRemaining !== undefined && manualPto.payrollRemaining !== ptoRemaining) {
            var diff = round2(manualPto.payrollRemaining - ptoRemaining);
            var diffColor = Math.abs(diff) > 2 ? '#b71c1c' : '#e65100';
            html += '<div style="margin-top:6px; padding:5px 8px; background:#fff3e0; border-radius:4px; border-left:3px solid ' + diffColor + '; font-size:0.8em; color:' + diffColor + ';">';
            html += 'Discrepancy: Payroll ' + manualPto.payrollRemaining + 'h vs Verint ' + ptoRemaining + 'h (' + (diff > 0 ? '+' : '') + diff + 'h)';
            html += '</div>';
        }
        html += '</div></div>';

        // ===== COLLAPSIBLE SECTIONS =====
        var detailStyle = 'margin-bottom:12px; border:1px solid #e0e0e0; border-radius:8px; overflow:hidden;';
        var summaryStyle = 'padding:12px 16px; cursor:pointer; font-weight:600; font-size:0.95em; background:#fafafa; user-select:none;';
        var contentStyle = 'padding:12px 16px;';

        // Helper for line item tables
        function buildTable(items, headerBg, columns) {
            var t = '<table style="width:100%; border-collapse:collapse; font-size:0.85em;">';
            t += '<tr style="background:' + headerBg + ';">';
            columns.forEach(function(col) { t += '<th style="padding:6px 8px; text-align:' + (col.align || 'left') + ';">' + col.label + '</th>'; });
            t += '</tr>';
            items.forEach(function(item) {
                var colors = ACTIVITY_COLORS[item.activity] || DEFAULT_ACTIVITY_COLOR;
                var lunchKey = item.fromDate + '|' + item.activity;
                var hasLunch = !!lunchFlags[lunchKey];
                var hrs = hasLunch ? round2(item.hours + 0.5) : item.hours;
                var isPtost = PTOST_CATEGORIES.indexOf(item.activity) !== -1;
                t += '<tr style="border-bottom:1px solid #f0f0f0;">';
                t += '<td style="padding:6px 8px;">' + formatDateDisplay(item.fromDate) + '</td>';
                t += '<td style="padding:6px 8px;"><span style="padding:2px 6px; border-radius:3px; background:' + colors.bg + '; color:' + colors.text + '; font-size:0.88em;">' + escHtml(item.activity) + '</span></td>';
                t += '<td style="padding:6px 8px; text-align:right; font-weight:600;">' + hrs + 'h' + (hasLunch ? ' <span style="font-size:0.78em; color:#999;">(+.5 lunch)</span>' : '') + '</td>';
                if (columns.length > 3) {
                    var statusLabel = isPtost ? 'Excused' : 'Unexcused';
                    var statusColor = isPtost ? '#0d47a1' : '#e65100';
                    t += '<td style="padding:6px 8px; text-align:center; color:' + statusColor + '; font-weight:600; font-size:0.82em;">' + statusLabel + '</td>';
                }
                t += '</tr>';
            });
            t += '</table>';
            return t;
        }

        // Unexcused Absences (against reliability)
        if (unplannedItems.length > 0) {
            var unplannedTotalHrs = round2(unplannedItems.reduce(function(s, i) { return s + i.hours; }, 0) + missedLunchTotal);

            // Figure out which days can be excused with remaining PTOST
            var ptostBudget = ptost.ptostRemaining;
            var canExcuseKeys = {};
            unplannedItems.forEach(function(item) {
                var lunchKey = item.fromDate + '|' + item.activity;
                var hrs = lunchFlags[lunchKey] ? round2(item.hours + 0.5) : item.hours;
                if (ptostBudget >= hrs) {
                    canExcuseKeys[lunchKey] = true;
                    ptostBudget = round2(ptostBudget - hrs);
                } else if (ptostBudget > 0) {
                    canExcuseKeys[lunchKey] = 'partial';
                    ptostBudget = 0;
                }
            });

            html += '<details style="' + detailStyle + '">';
            html += '<summary style="' + summaryStyle + 'color:#d84315;">Unexcused Absences (' + unplannedItems.length + ' entries, ' + unplannedTotalHrs + 'h)</summary>';
            html += '<div style="' + contentStyle + '">';
            if (ptost.ptostRemaining > 0) {
                html += '<div style="margin-bottom:8px; font-size:0.82em; color:#1565c0;"><strong>\uD83D\uDEA9 Highlighted rows</strong> can be excused with remaining PTOST (' + ptost.ptostRemaining + 'h available)</div>';
            }
            // Load entry notes/reasons
            var entryNotes = store.associates?.[employeeName]?.entryNotes || {};

            // Custom table with highlighting + reason column
            html += '<table style="width:100%; border-collapse:collapse; font-size:0.85em;">';
            html += '<tr style="background:#eceff1;"><th style="padding:6px 8px; text-align:left;">Date</th><th style="padding:6px 8px; text-align:left;">Activity</th><th style="padding:6px 8px; text-align:right;">Hours</th><th style="padding:6px 8px; text-align:left;">Reason</th><th style="padding:6px 8px; text-align:center;">Action</th></tr>';
            unplannedItems.forEach(function(item) {
                var colors = ACTIVITY_COLORS[item.activity] || DEFAULT_ACTIVITY_COLOR;
                var lunchKey = item.fromDate + '|' + item.activity;
                var hasLunch = !!lunchFlags[lunchKey];
                var hrs = hasLunch ? round2(item.hours + 0.5) : item.hours;
                var excusable = canExcuseKeys[lunchKey];
                var note = entryNotes[lunchKey] || {};
                var reason = note.reason || '';
                var isExcusedByReason = reason === 'pc_issues' || reason === 'system_outage' || reason === 'mgr_approved';
                var rowBg = isExcusedByReason ? '#e0f2f1' : excusable === true ? '#e3f2fd' : excusable === 'partial' ? '#fff8e1' : 'transparent';
                var actionLabel = isExcusedByReason ? '\u2705 Excused' : excusable === true ? '\u2705 PTOST' : excusable === 'partial' ? '\u26A0\uFE0F Partial' : '';
                var actionColor = isExcusedByReason ? '#00695c' : excusable === true ? '#0d47a1' : '#e65100';
                html += '<tr style="border-bottom:1px solid #f0f0f0; background:' + rowBg + ';">';
                html += '<td style="padding:6px 8px;">' + formatDateDisplay(item.fromDate) + '</td>';
                html += '<td style="padding:6px 8px;"><span style="padding:2px 6px; border-radius:3px; background:' + colors.bg + '; color:' + colors.text + '; font-size:0.88em;">' + escHtml(item.activity) + '</span></td>';
                html += '<td style="padding:6px 8px; text-align:right; font-weight:600;">' + hrs + 'h' + (hasLunch ? ' <span style="font-size:0.78em; color:#999;">(+.5)</span>' : '') + '</td>';
                // Reason dropdown + note
                html += '<td style="padding:4px 6px;">';
                html += '<select class="entry-reason-select" data-key="' + escHtml(lunchKey) + '" data-employee="' + escHtml(employeeName) + '" style="padding:3px; border:1px solid #ddd; border-radius:3px; font-size:0.88em; width:100%; max-width:140px;">';
                html += '<option value=""' + (reason === '' ? ' selected' : '') + '>--</option>';
                html += '<option value="no_reason"' + (reason === 'no_reason' ? ' selected' : '') + '>No reason given</option>';
                html += '<option value="personal"' + (reason === 'personal' ? ' selected' : '') + '>Personal</option>';
                html += '<option value="sick"' + (reason === 'sick' ? ' selected' : '') + '>Sick</option>';
                html += '<option value="pc_issues"' + (reason === 'pc_issues' ? ' selected' : '') + '>PC/Tech Issues</option>';
                html += '<option value="system_outage"' + (reason === 'system_outage' ? ' selected' : '') + '>System Outage</option>';
                html += '<option value="mgr_approved"' + (reason === 'mgr_approved' ? ' selected' : '') + '>Manager Approved</option>';
                html += '<option value="other"' + (reason === 'other' ? ' selected' : '') + '>Other</option>';
                html += '</select>';
                if (reason === 'other' || note.detail) {
                    html += '<input type="text" class="entry-reason-detail" data-key="' + escHtml(lunchKey) + '" data-employee="' + escHtml(employeeName) + '" value="' + escHtml(note.detail || '') + '" placeholder="Details..." style="margin-top:3px; padding:3px; border:1px solid #ddd; border-radius:3px; font-size:0.82em; width:100%; max-width:140px;">';
                }
                html += '</td>';
                html += '<td style="padding:6px 8px; text-align:center; font-size:0.82em; color:' + actionColor + '; font-weight:600;">' + actionLabel + '</td>';
                html += '</tr>';
            });
            html += '</table></div></details>';
        }

        // PTOST Details (excused absences)
        html += '<details style="' + detailStyle + '">';
        html += '<summary style="' + summaryStyle + 'color:#0d47a1;">Excused / PTOST (' + ptost.ptostUsed + 'h used of ' + PTOST_ANNUAL_LIMIT + 'h, ' + ptost.ptostRemaining + 'h remaining)</summary>';
        html += '<div style="' + contentStyle + '">';
        html += renderProgressBar(ptost.ptostUsed, PTOST_ANNUAL_LIMIT, '#1565c0', 16);
        html += '<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin:8px 0; text-align:center;">';
        html += '<div style="padding:6px; background:#e3f2fd; border-radius:6px;"><div style="font-weight:700; color:#0d47a1;">' + ptost.ptostUsed + 'h</div><div style="font-size:0.7em; color:#666;">Used</div></div>';
        html += '<div style="padding:6px; background:#fff3e0; border-radius:6px;"><div style="font-weight:700; color:#e65100;">' + ptost.unplannedNotPtost + 'h</div><div style="font-size:0.7em; color:#666;">Verint shows unexcused</div></div>';
        html += '<div style="padding:6px; background:#e8f5e9; border-radius:6px;"><div style="font-weight:700; color:#2e7d32;">' + ptost.ptostRemaining + 'h</div><div style="font-size:0.7em; color:#666;">Remaining</div></div>';
        html += '</div>';
        html += '<div style="margin:6px 0 10px; font-size:0.8em; color:#334155;">';
        html += sourceBadge('Payroll', { bg: '#e0f2f1', text: '#00695c' }) + ' decides PTOST totals. ' + sourceBadge('Verint', { bg: '#f3e5f5', text: '#6a1b9a' }) + ' may still need WFM coding updates.';
        html += '</div>';
        if (hasPayroll && payroll.ptostTotal > PTOST_ANNUAL_LIMIT) {
            html += '<div style="margin:8px 0; padding:8px 12px; background:#ffebee; border-radius:6px; border-left:3px solid #d32f2f; font-size:0.88em; color:#d32f2f; font-weight:600;">';
            html += '\uD83D\uDED1 PTOST is ' + round2(payroll.ptostTotal - PTOST_ANNUAL_LIMIT) + 'h OVER the 40h limit! Payroll will flag this.';
            html += '</div>';
        }
        if (hasPayroll && payroll.pendingEntries && payroll.pendingEntries.length > 0) {
            html += '<div style="margin:8px 0; padding:8px 12px; background:#fff3e0; border-radius:6px; border-left:3px solid #e65100; font-size:0.85em; color:#e65100;">';
            html += '\u23F3 ' + payroll.pendingEntries.length + ' entries pending approval';
            html += '</div>';
        }
        // Show payroll PTOST entries if available, otherwise Verint
        var ptostDisplayItems = hasPayroll ? (payroll.ptostEntries || []) : ptostItems;
        if (ptostDisplayItems.length > 0) {
            html += '<table style="width:100%; border-collapse:collapse; font-size:0.85em;">';
            html += '<tr style="background:#e3f2fd;"><th style="padding:6px 8px; text-align:left;">Date</th><th style="padding:6px 8px; text-align:left;">Source</th><th style="padding:6px 8px; text-align:right;">Hours</th><th style="padding:6px 8px; text-align:left;">Status</th></tr>';
            ptostDisplayItems.forEach(function(item) {
                var date = item.date || item.fromDate;
                var src = item.trc ? 'Payroll' : 'Verint';
                var hrs = item.hours;
                var status = item.status || '';
                var taskNote = item.taskCode === 'UNSCHD' ? ' (UNSCHD)' : '';
                html += '<tr style="border-bottom:1px solid #f0f0f0;">';
                html += '<td style="padding:6px 8px;">' + formatDateDisplay(date) + '</td>';
                html += '<td style="padding:6px 8px; font-size:0.85em; color:#666;">' + src + taskNote + '</td>';
                html += '<td style="padding:6px 8px; text-align:right; font-weight:600;">' + hrs + 'h</td>';
                html += '<td style="padding:6px 8px; font-size:0.85em; color:#666;">' + status + '</td>';
                html += '</tr>';
            });
            html += '</table>';
        }
        html += '</div></details>';

        // Payroll vs Verint Reconciliation
        if (hasPayroll && data.activities) {
            // Build sets of dates by category from Verint
            var verintPtostDates = {};
            (data.activities || []).forEach(function(a) {
                if (PTOST_CATEGORIES.indexOf(a.activity) !== -1) {
                    verintPtostDates[a.fromDate] = a;
                }
            });
            var verintUnplannedDates = {};
            (data.activities || []).forEach(function(a) {
                if (UNPLANNED_NOT_PTOST.indexOf(a.activity) !== -1) {
                    verintUnplannedDates[a.fromDate] = a;
                }
            });

            // Side-by-side view: one row per actionable date so coaches can explain differences quickly.
            var payrollByDate = {};
            (payroll.entries || []).forEach(function(pe) {
                if (pe.trc === 'PTOST' || (pe.trc === 'PTO' && pe.taskCode === 'UNSCHD')) {
                    if (!payrollByDate[pe.date]) payrollByDate[pe.date] = [];
                    payrollByDate[pe.date].push(pe);
                }
            });

            var verintByDate = {};
            (data.activities || []).forEach(function(a) {
                if (PTOST_CATEGORIES.indexOf(a.activity) !== -1 || UNPLANNED_NOT_PTOST.indexOf(a.activity) !== -1) {
                    if (!verintByDate[a.fromDate]) verintByDate[a.fromDate] = [];
                    verintByDate[a.fromDate].push(a);
                }
            });

            var compareDatesSet = {};
            Object.keys(payrollByDate).forEach(function(d) { compareDatesSet[d] = true; });
            Object.keys(verintByDate).forEach(function(d) { compareDatesSet[d] = true; });
            var compareDates = Object.keys(compareDatesSet).sort();

            if (compareDates.length > 0) {
                html += '<details style="' + detailStyle + '" open>';
                html += '<summary style="' + summaryStyle + 'color:#334155;">Side-by-Side: Payroll vs Verint (' + compareDates.length + ' dates)</summary>';
                html += '<div style="' + contentStyle + '">';
                html += '<div style="margin-bottom:8px; font-size:0.83em; color:#475569;">Left side is Payroll (official coding). Right side is Verint (what the schedule tool currently shows).</div>';
                html += '<table style="width:100%; border-collapse:collapse; font-size:0.84em;">';
                html += '<tr style="background:#f1f5f9;">';
                html += '<th style="padding:7px 8px; text-align:left;">Date</th>';
                html += '<th style="padding:7px 8px; text-align:left;">Payroll (official)</th>';
                html += '<th style="padding:7px 8px; text-align:left;">Verint (shown)</th>';
                html += '<th style="padding:7px 8px; text-align:left;">What this means</th>';
                html += '</tr>';

                compareDates.forEach(function(date) {
                    var pItems = payrollByDate[date] || [];
                    var vItems = verintByDate[date] || [];

                    var payrollText = pItems.length ? pItems.map(function(p) {
                        var tag = p.trc;
                        if (p.trc === 'PTO' && p.taskCode === 'UNSCHD') tag = 'PTO (UNSCHD)';
                        return tag + ' ' + p.hours + 'h' + (p.status ? ' [' + p.status + ']' : '');
                    }).join(' | ') : 'No Payroll entry';

                    var verintText = vItems.length ? vItems.map(function(v) {
                        return v.activity + ' ' + v.hours + 'h';
                    }).join(' | ') : 'No Verint entry';

                    var payrollHasPtost = pItems.some(function(p) { return p.trc === 'PTOST'; });
                    var verintHasPtost = vItems.some(function(v) { return PTOST_CATEGORIES.indexOf(v.activity) !== -1; });
                    var meaning = '';
                    var meaningColor = '#1f2937';

                    if (payrollHasPtost && !verintHasPtost) {
                        meaning = 'Mismatch: ask WFM to update Verint to PTOST';
                        meaningColor = '#b91c1c';
                    } else if (!payrollHasPtost && verintHasPtost) {
                        meaning = 'Check Payroll coding (Verint shows PTOST, Payroll does not)';
                        meaningColor = '#b45309';
                    } else if (!pItems.length && vItems.length) {
                        meaning = 'Only in Verint: verify with Payroll report';
                        meaningColor = '#b45309';
                    } else if (pItems.length && !vItems.length) {
                        meaning = 'Only in Payroll: Verint may need update';
                        meaningColor = '#b45309';
                    } else {
                        meaning = 'Aligned';
                        meaningColor = '#166534';
                    }

                    var rowBg = meaningColor === '#166534' ? '#f8fff9' : '#fff7ed';
                    if (meaningColor === '#b91c1c') rowBg = '#fff5f5';

                    html += '<tr style="border-bottom:1px solid #e5e7eb; background:' + rowBg + ';">';
                    html += '<td style="padding:7px 8px; white-space:nowrap; font-weight:600;">' + formatDateDisplay(date) + '</td>';
                    html += '<td style="padding:7px 8px; color:#0f172a;">' + escHtml(payrollText) + '</td>';
                    html += '<td style="padding:7px 8px; color:#0f172a;">' + escHtml(verintText) + '</td>';
                    html += '<td style="padding:7px 8px; color:' + meaningColor + '; font-weight:600;">' + escHtml(meaning) + '</td>';
                    html += '</tr>';
                });

                html += '</table>';
                html += '</div></details>';
            }

            // Find discrepancies: payroll has PTOST but Verint doesn't
            var needsWfmFix = [];
            (payroll.ptostEntries || []).forEach(function(pe) {
                if (!verintPtostDates[pe.date]) {
                    // Payroll says PTOST but Verint doesn't have it as PTOST
                    var verintEntry = verintUnplannedDates[pe.date];
                    needsWfmFix.push({
                        date: pe.date,
                        payrollTrc: 'PTOST',
                        payrollHours: pe.hours,
                        verintActivity: verintEntry ? verintEntry.activity : 'Not in Verint',
                        verintHours: verintEntry ? verintEntry.hours : 0
                    });
                }
            });

            if (needsWfmFix.length > 0) {
                html += '<details style="' + detailStyle + '" open>';
                html += '<summary style="' + summaryStyle + 'color:#d32f2f;">\uD83D\uDEA8 Mismatch: Payroll says PTOST, Verint does not (' + needsWfmFix.length + ' entries)</summary>';
                html += '<div style="' + contentStyle + '">';
                html += '<div style="margin-bottom:8px; font-size:0.85em; color:#d32f2f;">Payroll is already correct for these dates. Verint coding is the part that needs to change. Use the button below to send WFM the exact fixes.</div>';
                html += '<table style="width:100%; border-collapse:collapse; font-size:0.85em;">';
                html += '<tr style="background:#ffebee;"><th style="padding:6px 8px; text-align:left;">Date</th><th style="padding:6px 8px; text-align:left;">Payroll</th><th style="padding:6px 8px; text-align:left;">Verint Shows</th><th style="padding:6px 8px; text-align:right;">Payroll Hrs</th></tr>';
                needsWfmFix.forEach(function(fix) {
                    html += '<tr style="border-bottom:1px solid #f0f0f0; background:#fff5f5;">';
                    html += '<td style="padding:6px 8px; font-weight:600;">' + formatDateDisplay(fix.date) + '</td>';
                    html += '<td style="padding:6px 8px;"><span style="padding:2px 6px; border-radius:3px; background:#e3f2fd; color:#0d47a1; font-size:0.88em;">PTOST</span></td>';
                    html += '<td style="padding:6px 8px;"><span style="padding:2px 6px; border-radius:3px; background:#fff3e0; color:#e65100; font-size:0.88em;">' + escHtml(fix.verintActivity) + '</span></td>';
                    html += '<td style="padding:6px 8px; text-align:right; font-weight:600;">' + fix.payrollHours + 'h</td>';
                    html += '</tr>';
                });
                html += '</table>';

                // Auto-generate WFM message for these
                html += '<div style="margin-top:10px;">';
                html += '<button type="button" id="wfmReconcileBtn" style="background:#d32f2f; color:white; border:none; border-radius:6px; padding:8px 16px; cursor:pointer; font-weight:bold;">Copy WFM Fix Message</button>';
                html += '</div>';
                html += '</div></details>';
            }
        }

        // Planned Time Off
        if (plannedItems.length > 0) {
            var plannedTotalHrs = round2(plannedItems.reduce(function(s, i) { return s + i.hours; }, 0));
            html += '<details style="' + detailStyle + '">';
            html += '<summary style="' + summaryStyle + 'color:#2e7d32;">Planned Time Off (' + plannedItems.length + ' entries, ' + plannedTotalHrs + 'h)</summary>';
            html += '<div style="' + contentStyle + '">';
            html += buildTable(plannedItems, '#e8f5e9', [
                { label: 'Date' }, { label: 'Type' }, { label: 'Hours', align: 'right' }
            ]);
            html += '</div></details>';
        }

        // FMLA
        html += '<details style="' + detailStyle + '">';
        html += '<summary style="' + summaryStyle + 'color:#880e4f;">FMLA (' + round2(fmlaData.used) + 'h' + (fmlaActivities.length > 0 ? ', ' + fmlaActivities.length + ' entries' : '') + ')</summary>';
        html += '<div style="' + contentStyle + '">';
        if (fmlaActivities.length > 0) {
            html += '<table style="width:100%; border-collapse:collapse; font-size:0.85em;">';
            html += '<tr style="background:#fce4ec;"><th style="padding:6px 8px; text-align:left;">Date</th><th style="padding:6px 8px; text-align:right;">Hours</th></tr>';
            fmlaActivities.forEach(function(a) {
                html += '<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:6px 8px;">' + formatDateDisplay(a.fromDate) + '</td><td style="padding:6px 8px; text-align:right; font-weight:600;">' + a.hours + 'h</td></tr>';
            });
            html += '</table>';
        } else {
            html += '<div style="color:#999; font-size:0.9em;">No FMLA entries in Verint.</div>';
        }
        html += '</div></details>';

        // Bereavement
        html += '<details style="' + detailStyle + '">';
        html += '<summary style="' + summaryStyle + 'color:#4a148c;">Bereavement (' + round2(bereavementData.used) + 'h' + (bereavementActivities.length > 0 ? ', ' + bereavementActivities.length + ' entries' : '') + ')</summary>';
        html += '<div style="' + contentStyle + '">';
        if (bereavementActivities.length > 0) {
            html += '<table style="width:100%; border-collapse:collapse; font-size:0.85em;">';
            html += '<tr style="background:#ede7f6;"><th style="padding:6px 8px; text-align:left;">Date</th><th style="padding:6px 8px; text-align:right;">Hours</th></tr>';
            bereavementActivities.forEach(function(a) {
                html += '<tr style="border-bottom:1px solid #f0f0f0;"><td style="padding:6px 8px;">' + formatDateDisplay(a.fromDate) + '</td><td style="padding:6px 8px; text-align:right; font-weight:600;">' + a.hours + 'h</td></tr>';
            });
            html += '</table>';
        } else {
            html += '<div style="color:#999; font-size:0.9em;">No bereavement entries in Verint.</div>';
        }
        html += '</div></details>';

        // Quick Messages
        html += '<details style="' + detailStyle + '" open>';
        html += '<summary style="' + summaryStyle + 'color:#7b1fa2;">Quick Messages</summary>';
        html += '<div style="' + contentStyle + '">';
        html += '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">';
        html += '<button type="button" id="attendanceAssocMsgBtn" style="flex:1; min-width:180px; background:linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%); color:white; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">Send Associate Update</button>';
        html += '<button type="button" id="attendanceWfmMsgBtn" style="flex:1; min-width:180px; background:linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color:white; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">Generate WFM Reclassification</button>';
        html += '</div>';
        html += '<textarea id="attendanceMsgOutput" readonly style="width:100%; height:150px; padding:12px; border:1px solid #ddd; border-radius:6px; font-size:0.92em; color:#333; background:#f9f9f9; resize:vertical; display:none; font-family:inherit;"></textarea>';
        html += '<button type="button" id="attendanceMsgCopyBtn" style="display:none; margin-top:8px; background:#16a34a; color:white; border:none; border-radius:6px; padding:8px 16px; cursor:pointer; font-weight:bold;">Copy to Clipboard</button>';
        html += '</div></details>';

        container.innerHTML = html;

        // Bind message buttons
        document.getElementById('attendanceAssocMsgBtn')?.addEventListener('click', function() {
            var msgPtost = Object.assign({}, ptost, { policyHours: reliabilityHours, canExcuse: canExcuse, policyHoursAfterExcusing: afterExcusing });
            var msg = generateAssociateMessage(firstName, msgPtost, tier, reclassItems);
            showMessage(msg);
        });
        document.getElementById('attendanceWfmMsgBtn')?.addEventListener('click', function() {
            var msg = generateWfmMessage(employeeName, reclassItems, ptost);
            showMessage(msg);
        });
        document.getElementById('attendanceMsgCopyBtn')?.addEventListener('click', function() {
            var textarea = document.getElementById('attendanceMsgOutput');
            navigator.clipboard.writeText(textarea?.value || '').then(function() {
                if (typeof showToast === 'function') showToast('Copied!', 2000);
            });
        });

        function showMessage(msg) {
            var textarea = document.getElementById('attendanceMsgOutput');
            var copyBtn = document.getElementById('attendanceMsgCopyBtn');
            if (textarea) { textarea.value = msg; textarea.style.display = 'block'; }
            if (copyBtn) copyBtn.style.display = 'inline-block';
            navigator.clipboard.writeText(msg).catch(function() {});
        }

        // Bind manual PTO inputs — save on change
        // Bind reason dropdowns
        container.querySelectorAll('.entry-reason-select').forEach(function(sel) {
            sel.addEventListener('change', function() {
                var key = this.dataset.key;
                var emp = this.dataset.employee;
                var store = loadStore();
                if (!store.associates[emp]) store.associates[emp] = {};
                if (!store.associates[emp].entryNotes) store.associates[emp].entryNotes = {};
                if (!store.associates[emp].entryNotes[key]) store.associates[emp].entryNotes[key] = {};
                store.associates[emp].entryNotes[key].reason = this.value;
                saveStore(store);
                renderAttendanceDashboard(container, emp);
            });
        });
        container.querySelectorAll('.entry-reason-detail').forEach(function(input) {
            input.addEventListener('change', function() {
                var key = this.dataset.key;
                var emp = this.dataset.employee;
                var store = loadStore();
                if (!store.associates[emp]) store.associates[emp] = {};
                if (!store.associates[emp].entryNotes) store.associates[emp].entryNotes = {};
                if (!store.associates[emp].entryNotes[key]) store.associates[emp].entryNotes[key] = {};
                store.associates[emp].entryNotes[key].detail = this.value;
                saveStore(store);
            });
        });

        // Bind WFM reconciliation message
        document.getElementById('wfmReconcileBtn')?.addEventListener('click', function() {
            var msg = 'Hi WFM team,\n\nThe following dates are coded as PTOST in Payroll for ' + employeeName + ' but are not reflected in Verint. Please update Verint to match:\n\n';
            var fixes = hasPayroll ? [] : [];
            if (hasPayroll && data.activities) {
                var verintPtostSet = {};
                (data.activities || []).forEach(function(a) {
                    if (PTOST_CATEGORIES.indexOf(a.activity) !== -1) verintPtostSet[a.fromDate] = true;
                });
                (payroll.ptostEntries || []).forEach(function(pe) {
                    if (!verintPtostSet[pe.date]) {
                        msg += '- ' + formatDateDisplay(pe.date) + ': ' + pe.hours + 'h (Payroll: PTOST)\n';
                    }
                });
            }
            msg += '\nThank you!';
            navigator.clipboard.writeText(msg).then(function() {
                if (typeof showToast === 'function') showToast('WFM fix message copied!', 3000);
            });
        });

        // Bind reliability hours input
        document.getElementById('manualReliabilityInput')?.addEventListener('change', function() {
            var val = this.value.trim();
            var store = loadStore();
            if (!store.associates[employeeName]) store.associates[employeeName] = {};
            if (val === '') {
                delete store.associates[employeeName].manualReliabilityHours;
            } else {
                store.associates[employeeName].manualReliabilityHours = parseFloat(val);
            }
            saveStore(store);
            renderAttendanceDashboard(container, employeeName);
        });

        document.getElementById('useVerintBasisBtn')?.addEventListener('click', function() {
            var store = loadStore();
            if (!store.associates[employeeName]) store.associates[employeeName] = {};
            store.associates[employeeName].manualReliabilityHours = verintReliabilityBasis;
            saveStore(store);
            renderAttendanceDashboard(container, employeeName);
        });

        container.querySelectorAll('.manual-pto-input').forEach(function(input) {
            input.addEventListener('change', function() {
                var field = this.dataset.field;
                var val = this.value.trim();
                var store = loadStore();
                if (!store.associates[employeeName]) store.associates[employeeName] = {};
                if (!store.associates[employeeName].manualPto) store.associates[employeeName].manualPto = {};
                if (val === '') {
                    delete store.associates[employeeName].manualPto[field];
                } else {
                    store.associates[employeeName].manualPto[field] = parseFloat(val);
                }
                saveStore(store);
                // Re-render to show discrepancy
                renderAttendanceDashboard(container, employeeName);
            });
        });

    }

    // --- Message Generators ---

    function generateAssociateMessage(firstName, ptost, tier, reclassItems) {
        var msg = 'Hey ' + firstName + '! Quick attendance update for you:\n\n';

        msg += 'You\'ve used ' + ptost.ptostUsed + ' hours of your ' + ptost.ptostLimit + ' PTOST hours.\n';
        msg += 'PTOST Remaining: ' + ptost.ptostRemaining + ' hours\n';

        // Scenario 1: has unexcused hours AND PTOST remaining to cover some/all
        if (ptost.policyHours > 0 && ptost.ptostRemaining > 0) {
            msg += '\nYou have ' + ptost.policyHours + ' hours of unplanned/unscheduled time that currently goes against your reliability.\n\n';

            msg += 'Here are those dates:\n';
            reclassItems.forEach(function(item) {
                msg += '  - ' + formatDateDisplay(item.fromDate) + ': ' + item.hours + 'h\n';
            });

            if (ptost.canExcuse >= ptost.policyHours) {
                msg += '\nIf you\'d like, I can reach out to WFM and mark all ' + ptost.policyHours + ' hours as PTOST to get them excused. ';
                msg += 'You\'d still have ' + round2(ptost.ptostRemaining - ptost.canExcuse) + ' hours of PTOST remaining after that.\n';
            } else {
                msg += '\nI can mark ' + ptost.canExcuse + ' hours as PTOST to get them excused, but the remaining ' + ptost.policyHoursAfterExcusing + ' hours would stay against your reliability since that would use up your PTOST.\n';
            }

            msg += '\nWould you like me to go ahead and get those hours excused? Just let me know.';

        // Scenario 2: has unexcused hours but NO PTOST left
        } else if (ptost.policyHours > 0 && ptost.ptostRemaining <= 0) {
            msg += '\nYou have ' + ptost.policyHours + ' hours of unplanned time against your reliability, and your PTOST balance is at 0.\n';
            msg += '\nPlease be mindful of attendance going forward. Let me know if you have any questions.';

        // Scenario 3: no unexcused hours
        } else {
            msg += '\nNo unexcused hours against your reliability right now. You\'re in good shape!\n';
            if (ptost.ptostUsed > 0) {
                msg += 'All ' + ptost.ptostUsed + ' hours of unplanned time have been excused as PTOST.\n';
            }
            msg += '\nKeep it up!';
        }

        return msg;
    }

    function generateWfmMessage(employeeName, reclassItems, ptost) {
        if (reclassItems.length === 0) {
            return 'No entries need reclassification for ' + employeeName + '.';
        }

        // Only include items that PTOST can cover
        var budget = ptost ? ptost.ptostRemaining : 999;
        var itemsToExcuse = [];
        var excessItems = [];
        reclassItems.forEach(function(item) {
            if (budget >= item.hours) {
                itemsToExcuse.push(item);
                budget = round2(budget - item.hours);
            } else {
                excessItems.push(item);
            }
        });

        var excuseHours = round2(itemsToExcuse.reduce(function(s, i) { return s + i.hours; }, 0));

        var msg = 'Hi WFM team,\n\n';

        if (ptost && ptost.ptostRemaining > 0) {
            msg += employeeName + ' has ' + ptost.ptostRemaining + 'h of PTOST remaining (used ' + ptost.ptostUsed + '/' + ptost.ptostLimit + 'h). ';
            msg += 'Please reclassify the following entries as PTOST:\n\n';
        } else {
            msg += 'Please reclassify the following entries as PTOST for ' + employeeName + ':\n\n';
        }

        itemsToExcuse.forEach(function(item) {
            msg += '- ' + formatDateDisplay(item.fromDate) + ': ' + item.activity + ' - ' + item.hours + 'h\n';
        });

        msg += '\nTotal: ' + excuseHours + 'h to reclassify';
        if (excessItems.length > 0) {
            var excessHours = round2(excessItems.reduce(function(s, i) { return s + i.hours; }, 0));
            msg += '\n\nNote: ' + excessHours + 'h of additional unplanned time cannot be covered (PTOST exhausted).';
        }
        msg += '\n\nThank you!';

        return msg;
    }

    // --- Initialization ---

    function migrateStoreKeys(store) {
        // Fix keys with unicode garbage (⬭NAME⬬ etc)
        if (!store.associates) return false;
        var dirty = false;
        var keys = Object.keys(store.associates);
        keys.forEach(function(key) {
            var cleaned = cleanStr(key);
            if (cleaned !== key) {
                // Merge into cleaned key
                var existing = store.associates[cleaned] || {};
                var bad = store.associates[key];
                // Copy payrollData/verintData/etc from bad key to clean key if clean doesn't have it
                Object.keys(bad).forEach(function(prop) {
                    if (!existing[prop]) existing[prop] = bad[prop];
                });
                store.associates[cleaned] = existing;
                delete store.associates[key];
                dirty = true;
            }
        });
        return dirty;
    }

    function initializeAttendanceTracker() {
        var container = document.getElementById('attendanceDashboard');
        if (!container) return;

        var store = loadStore();
        if (migrateStoreKeys(store)) {
            saveStore(store);
        }
        var associateNames = Object.keys(store.associates || {}).sort();

        // Also include names from weekly/ytd data
        var weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        var ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        var ctx = typeof getTeamSelectionContext === 'function' ? getTeamSelectionContext() : null;
        var hasTeamFilter = typeof isAssociateIncludedByTeamFilter === 'function';

        // Build set of team-filtered names from weekly/ytd data
        var teamNames = new Set();
        Object.values(weekly).concat(Object.values(ytd)).forEach(function(period) {
            (period?.employees || []).forEach(function(emp) {
                if (emp?.name && (!hasTeamFilter || isAssociateIncludedByTeamFilter(emp.name, ctx))) {
                    teamNames.add(emp.name);
                }
            });
        });

        // Only show attendance associates who are also in team filter
        var allNames = new Set();
        associateNames.forEach(function(name) {
            if (!hasTeamFilter || teamNames.has(name) || isAssociateIncludedByTeamFilter(name, ctx)) {
                allNames.add(name);
            }
        });
        // Also add team members who might not have attendance data yet
        teamNames.forEach(function(name) { allNames.add(name); });

        var sortedNames = Array.from(allNames).sort();

        // Render upload + dropdown + dashboard
        var html = '';

        // Upload row
        html += '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px; align-items:center;">';
        html += '<input type="file" id="attendanceVerintInput" accept=".xlsx,.xls" multiple style="display:none;">';
        html += '<button type="button" id="attendanceVerintBtn" style="background:linear-gradient(135deg, #7b1fa2 0%, #4a148c 100%); color:white; border:none; border-radius:6px; padding:10px 20px; cursor:pointer; font-weight:bold;">Upload Verint Excel(s)</button>';
        html += '<input type="file" id="attendancePayrollPdfInput" accept=".pdf" style="display:none;">';
        html += '<input type="file" id="attendancePayrollExcelInput" accept=".xlsx,.xls" style="display:none;">';
        html += '<button type="button" id="attendancePayrollExcelBtn" style="background:linear-gradient(135deg, #1565c0 0%, #0d47a1 100%); color:white; border:none; border-radius:6px; padding:10px 20px; cursor:pointer; font-weight:bold;">Upload Payroll Excel</button>';
        html += '<button type="button" id="attendancePayrollPdfBtn" style="background:linear-gradient(135deg, #00695c 0%, #004d40 100%); color:white; border:none; border-radius:6px; padding:10px 20px; cursor:pointer; font-weight:bold;">Upload PTO Balances (PDF)</button>';
        html += '<span id="attendanceUploadStatus" style="font-size:0.85em; color:#666;"></span>';
        html += '</div>';

        // Associate dropdown
        html += '<div style="margin-bottom:16px;">';
        html += '<label for="attendanceAssociateSelect" style="font-weight:bold; display:block; margin-bottom:6px;">Select Associate:</label>';
        html += '<select id="attendanceAssociateSelect" style="width:100%; max-width:400px; padding:10px; border:2px solid #7b1fa2; border-radius:4px; font-size:1em; cursor:pointer;">';
        html += '<option value="">-- Choose an associate --</option>';
        var loadedCount = 0;
        var missingCount = 0;
        var fixableCount = 0;
        sortedNames.forEach(function(name) {
            var verint = store.associates?.[name]?.verintData;
            var indicator = '';
            var fixFlag = '';
            var payrollD = store.associates?.[name]?.payrollData;
            if (payrollD) {
                indicator = '\u2705 Payroll';
                loadedCount++;
                // Use payroll data for flags
                if (payrollD.ptostTotal > PTOST_ANNUAL_LIMIT) {
                    fixFlag = ' \uD83D\uDED1 PTOST OVER 40 (' + payrollD.ptostTotal + 'h)';
                } else if (payrollD.unschdTotal > 0 && payrollD.ptostRemaining > 0) {
                    fixFlag = ' \uD83D\uDEA9 ' + payrollD.unschdTotal + 'h policy, ' + payrollD.ptostRemaining + 'h PTOST left';
                    fixableCount++;
                } else if (payrollD.unschdTotal > 0) {
                    fixFlag = ' \u26A0\uFE0F ' + payrollD.unschdTotal + 'h against policy';
                }
            } else if (verint?.uploadedAt) {
                var uploadDate = new Date(verint.uploadedAt).toLocaleDateString();
                indicator = '\u2705 ' + uploadDate;
                loadedCount++;
                var empPtost = calculatePtostUsage(verint.ptoSubCategories || {});
                if (empPtost.unplannedNotPtost > 0 && empPtost.ptostRemaining > 0) {
                    fixFlag = ' \uD83D\uDEA9 Can fix ' + empPtost.unplannedNotPtost + 'h';
                    fixableCount++;
                } else if (empPtost.unplannedNotPtost > 0) {
                    fixFlag = ' \u26A0\uFE0F ' + empPtost.unplannedNotPtost + 'h unexcused';
                }
            } else {
                indicator = '\u274C No data';
                missingCount++;
            }
            html += '<option value="' + escHtml(name) + '">' + indicator + fixFlag + ' \u2014 ' + escHtml(name) + '</option>';
        });
        html += '</select>';
        if (sortedNames.length > 0) {
            var statusParts = [loadedCount + ' loaded'];
            if (missingCount > 0) statusParts.push(missingCount + ' missing');
            if (fixableCount > 0) statusParts.push('\uD83D\uDEA9 ' + fixableCount + ' can be fixed with PTOST');
            html += '<div style="margin-top:6px; font-size:0.85em; color:#666;">' + statusParts.join(', ') + '</div>';
        }
        html += '</div>';

        // Dashboard area
        html += '<div id="attendanceEmployeeDashboard"></div>';

        container.innerHTML = html;

        // Bind events
        document.getElementById('attendanceVerintBtn')?.addEventListener('click', function() {
            document.getElementById('attendanceVerintInput')?.click();
        });

        // Payroll PDF upload
        // Payroll Excel upload
        document.getElementById('attendancePayrollExcelBtn')?.addEventListener('click', function() {
            document.getElementById('attendancePayrollExcelInput')?.click();
        });

        document.getElementById('attendancePayrollExcelInput')?.addEventListener('change', async function() {
            var file = this.files?.[0];
            if (!file) return;
            var statusEl = document.getElementById('attendanceUploadStatus');
            if (statusEl) statusEl.textContent = 'Parsing payroll Excel...';
            console.log('[Payroll Upload] File selected:', file.name, file.size, 'bytes');

            try {
                var payrollData = await parsePayrollExcel(file);
                var employeeNames = Object.keys(payrollData);
                console.log('[Payroll Upload] Parsed', employeeNames.length, 'employees:', employeeNames.slice(0, 5));

                if (employeeNames.length === 0) {
                    if (statusEl) statusEl.textContent = 'No employees found in payroll Excel.';
                    console.error('[Payroll Upload] ZERO employees parsed');
                    this.value = '';
                    return;
                }

                var store = loadStore();
                if (!store.associates) store.associates = {};
                console.log('[Payroll Upload] Existing store keys:', Object.keys(store.associates).slice(0, 5));

                var matched = 0;
                employeeNames.forEach(function(rawName) {
                    var matchedName = matchEmployeeToExisting(rawName);
                    console.log('[Payroll Upload] ' + rawName + ' -> ' + matchedName);
                    if (!store.associates[matchedName]) store.associates[matchedName] = {};
                    store.associates[matchedName].payrollData = payrollData[rawName];
                    store.associates[matchedName].payrollData.uploadedAt = new Date().toISOString();
                    store.associates[matchedName].payrollData.rawName = rawName;
                    matched++;
                });
                saveStore(store);
                console.log('[Payroll Upload] Saved', matched, 'to store');

                // Verify save
                var verify = loadStore();
                var firstKey = Object.keys(verify.associates || {})[0];
                console.log('[Payroll Upload] Verify - first key:', firstKey, 'has payrollData:', !!verify.associates?.[firstKey]?.payrollData);

                if (statusEl) statusEl.textContent = matched + ' associates loaded from payroll!';
                if (typeof showToast === 'function') showToast(matched + ' payroll records imported.', 4000);

                // Refresh
                initializeAttendanceTracker();
                var select = document.getElementById('attendanceAssociateSelect');
                if (select?.value) {
                    select.dispatchEvent(new Event('change'));
                }
            } catch (err) {
                console.error('[Payroll Upload] ERROR:', err, err.stack);
                if (statusEl) statusEl.textContent = 'Error: ' + err;
                if (typeof showToast === 'function') showToast('Payroll Excel error: ' + err, 5000);
            }
            this.value = '';
        });

        // PTO Balance PDF upload
        document.getElementById('attendancePayrollPdfBtn')?.addEventListener('click', function() {
            document.getElementById('attendancePayrollPdfInput')?.click();
        });

        document.getElementById('attendancePayrollPdfInput')?.addEventListener('change', async function() {
            var file = this.files?.[0];
            if (!file) return;
            var statusEl = document.getElementById('attendanceUploadStatus');
            if (statusEl) statusEl.textContent = 'Reading PDF...';

            try {
                // Use bundled pdf.js
                if (!window.pdfjsLib) throw new Error('PDF library not loaded');
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'lib-pdf.worker.js?v=' + Date.now();

                var arrayBuffer = await file.arrayBuffer();
                var pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                var allText = '';
                for (var p = 1; p <= pdf.numPages; p++) {
                    var page = await pdf.getPage(p);
                    var content = await page.getTextContent();
                    // Group by Y position to reconstruct lines
                    var lineMap = {};
                    content.items.forEach(function(item) {
                        var y = Math.round(item.transform[5]);
                        if (!lineMap[y]) lineMap[y] = [];
                        lineMap[y].push({ x: item.transform[4], str: item.str });
                    });
                    Object.keys(lineMap).map(Number).sort(function(a, b) { return b - a; }).forEach(function(y) {
                        allText += lineMap[y].sort(function(a, b) { return a.x - b.x; }).map(function(i) { return i.str; }).join('  ') + '\n';
                    });
                }

                var parsed = parsePayrollPtoText(allText);
                if (parsed.length === 0) {
                    if (statusEl) statusEl.textContent = 'Could not parse employees from PDF.';
                    this.value = '';
                    return;
                }

                var store = loadStore();
                if (!store.associates) store.associates = {};
                parsed.forEach(function(entry) {
                    var matchedName = matchEmployeeToExisting(entry.name);
                    if (!store.associates[matchedName]) store.associates[matchedName] = {};
                    if (!store.associates[matchedName].manualPto) store.associates[matchedName].manualPto = {};
                    store.associates[matchedName].manualPto.carryover = entry.prevYr;
                    store.associates[matchedName].manualPto.allotment = entry.earned;
                    store.associates[matchedName].manualPto.payrollRemaining = entry.remaining;
                    store.associates[matchedName].manualPto.payrollTaken = entry.taken;
                });
                saveStore(store);

                if (statusEl) statusEl.textContent = parsed.length + ' associates updated!';
                if (typeof showToast === 'function') showToast(parsed.length + ' PTO balances imported from payroll PDF.', 4000);

                var select = document.getElementById('attendanceAssociateSelect');
                if (select?.value) renderAttendanceDashboard(container, select.value);
            } catch (err) {
                console.error('Payroll PDF error:', err);
                if (statusEl) statusEl.textContent = 'Error: ' + err.message;
                if (typeof showToast === 'function') showToast('PDF read failed: ' + err.message, 5000);
            }
            this.value = '';
        });

        document.getElementById('attendanceVerintInput')?.addEventListener('change', async function() {
            var files = Array.from(this.files || []);
            if (!files.length) return;

            var loaded = 0;
            var errors = 0;
            var lastMatchedName = '';
            var store = loadStore();
            if (!store.associates) store.associates = {};

            document.getElementById('attendanceVerintFileName').textContent = files.length + ' file' + (files.length !== 1 ? 's' : '') + ' selected';

            for (var f = 0; f < files.length; f++) {
                try {
                    var result = await parseVerintExcel(files[f]);
                    if (!result.employeeName) {
                        console.warn('No employee name found in:', files[f].name);
                        errors++;
                        continue;
                    }

                    var matchedName = matchEmployeeToExisting(result.employeeName);
                    if (!store.associates[matchedName]) store.associates[matchedName] = {};
                    store.associates[matchedName].verintData = result;
                    lastMatchedName = matchedName;
                    loaded++;
                } catch (err) {
                    console.error('Verint parse error for', files[f].name, ':', err);
                    errors++;
                }
            }

            saveStore(store);

            if (typeof showToast === 'function') {
                if (errors > 0) showToast(loaded + ' loaded, ' + errors + ' failed. Check console.', 5000);
                else showToast(loaded + ' Verint file' + (loaded !== 1 ? 's' : '') + ' loaded!', 4000);
            }

            // Refresh the dropdown and auto-select last loaded
            initializeAttendanceTracker();
            if (lastMatchedName) {
                var select = document.getElementById('attendanceAssociateSelect');
                if (select) {
                    select.value = lastMatchedName;
                    select.dispatchEvent(new Event('change'));
                }
            }

            this.value = '';
        });

        document.getElementById('attendanceAssociateSelect')?.addEventListener('change', function() {
            try {
                var empDash = document.getElementById('attendanceEmployeeDashboard');
                if (!empDash) { console.error('attendanceEmployeeDashboard not found'); return; }
                var name = this.value;
                if (!name) { empDash.innerHTML = ''; return; }
                console.log('[Attendance] Rendering dashboard for:', name);
                renderAttendanceDashboard(empDash, name);
                console.log('[Attendance] Dashboard rendered successfully');
            } catch (e) {
                console.error('[Attendance] RENDER CRASH:', e.message, e.stack);
            }
        });
    }

    // --- Handle upload from Upload page ---

    function handleVerintUploadFromUploadPage(file) {
        return parseVerintExcel(file).then(function(result) {
            if (!result.employeeName) {
                if (typeof showToast === 'function') showToast('Could not find employee name in Verint file', 5000);
                return;
            }
            var matchedName = matchEmployeeToExisting(result.employeeName);
            var store = loadStore();
            if (!store.associates) store.associates = {};
            if (!store.associates[matchedName]) store.associates[matchedName] = {};
            store.associates[matchedName].verintData = result;
            saveStore(store);
            if (typeof showToast === 'function') showToast('Verint data loaded for ' + matchedName + '. View in My Team > Attendance.', 5000);
        });
    }

    // --- Export ---

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.attendanceTracker = {
        initializeAttendanceTracker: initializeAttendanceTracker,
        renderAttendanceDashboard: renderAttendanceDashboard,
        parseVerintExcel: parseVerintExcel,
        parsePayrollExcel: parsePayrollExcel,
        handleVerintUploadFromUploadPage: handleVerintUploadFromUploadPage
    };
    window.initializeAttendanceTracker = initializeAttendanceTracker;
})();
