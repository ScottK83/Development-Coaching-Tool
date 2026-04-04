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
        return String(s).replace(/[\u0000-\u001F\u007F-\u009F\uFE00-\uFE0F\u200B-\u200F\u2028-\u202F]/g, '').trim();
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

    function matchEmployeeToExisting(verintName) {
        // Verint format: "LastName, FirstName  " (with possible trailing spaces)
        var cleaned = cleanStr(verintName);
        // Try to find in weeklyData/ytdData employee lists
        var allNames = new Set();
        var weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        var ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        Object.values(weekly).concat(Object.values(ytd)).forEach(function(period) {
            (period?.employees || []).forEach(function(emp) { if (emp?.name) allNames.add(emp.name); });
        });

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
        var ptost = calculatePtostUsage(data.ptoSubCategories || {});
        var missedLunchTotal = 0;
        unplannedItems.forEach(function(item) {
            var key = item.fromDate + '|' + item.activity;
            if (lunchFlags[key]) missedLunchTotal += 0.5;
        });
        if (missedLunchTotal > 0) {
            ptost.unplannedNotPtost = round2(ptost.unplannedNotPtost + missedLunchTotal);
            ptost.totalUnplanned = round2(ptost.totalUnplanned + missedLunchTotal);
            ptost.policyHours = ptost.unplannedNotPtost;
            ptost.reclassificationGap = ptost.unplannedNotPtost;
            ptost.canExcuse = round2(Math.min(ptost.unplannedNotPtost, ptost.ptostRemaining));
            ptost.policyHoursAfterExcusing = round2(Math.max(0, ptost.unplannedNotPtost - ptost.ptostRemaining));
            ptost.missedLunchTotal = missedLunchTotal;
        }
        var firstName = employeeName.split(/[\s,]+/)[0];
        if (typeof getEmployeeNickname === 'function') {
            firstName = getEmployeeNickname(employeeName) || firstName;
        }

        var bereavementData = data.summary?.['WFO-Bereavement'] || { used: 0 };
        var bereavementActivities = (data.activities || []).filter(function(a) { return a.activity === 'WFO-Bereavement' || a.activity === 'Bereavement'; });

        // Load manual reliability override
        var manualReliability = store.associates?.[employeeName]?.manualReliabilityHours;
        var verintCalcHours = ptost.policyHours;
        var reliabilityHours = (manualReliability !== undefined && manualReliability !== null) ? manualReliability : verintCalcHours;
        // Recalculate tier based on actual reliability hours used
        var tier = calculateDisciplineTier(reliabilityHours);
        // Recalculate canExcuse based on actual reliability
        var canExcuse = round2(Math.min(reliabilityHours, ptost.ptostRemaining));
        var afterExcusing = round2(Math.max(0, reliabilityHours - ptost.ptostRemaining));

        var html = '';

        // Upload info
        html += '<div style="margin-bottom:12px; font-size:0.85em; color:#666;">Verint data uploaded: ' + new Date(data.uploadedAt).toLocaleDateString() + (data.organization ? ' | Org: ' + escHtml(data.organization) : '') + '</div>';

        // ===== ALWAYS VISIBLE: Reliability Status =====
        html += '<div style="margin-bottom:16px; padding:16px; background:#fff; border-radius:8px; border:1px solid #e0e0e0;">';
        html += '<h4 style="margin:0 0 8px 0; color:' + tier.tier.color + ';">Reliability</h4>';

        // Manual entry field
        html += '<div style="display:flex; align-items:center; gap:12px; margin-bottom:10px;">';
        html += '<label style="font-size:0.85em; font-weight:600; color:#333; white-space:nowrap;">Hours against reliability (from PowerBI):</label>';
        html += '<input type="number" id="manualReliabilityInput" step="0.01" value="' + (manualReliability !== undefined && manualReliability !== null ? manualReliability : '') + '" placeholder="' + verintCalcHours + '" style="width:100px; padding:6px; border:2px solid ' + tier.tier.color + '; border-radius:4px; font-size:1em; font-weight:700; color:' + tier.tier.color + '; text-align:center;">';
        if (manualReliability !== undefined && manualReliability !== null && Math.abs(manualReliability - verintCalcHours) > 0.1) {
            html += '<span style="font-size:0.8em; color:#999;">Verint calc: ' + verintCalcHours + 'h</span>';
        }
        html += '</div>';

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
            // Custom table with highlighting
            html += '<table style="width:100%; border-collapse:collapse; font-size:0.85em;">';
            html += '<tr style="background:#eceff1;"><th style="padding:6px 8px; text-align:left;">Date</th><th style="padding:6px 8px; text-align:left;">Activity</th><th style="padding:6px 8px; text-align:right;">Hours</th><th style="padding:6px 8px; text-align:center;">Action</th></tr>';
            unplannedItems.forEach(function(item) {
                var colors = ACTIVITY_COLORS[item.activity] || DEFAULT_ACTIVITY_COLOR;
                var lunchKey = item.fromDate + '|' + item.activity;
                var hasLunch = !!lunchFlags[lunchKey];
                var hrs = hasLunch ? round2(item.hours + 0.5) : item.hours;
                var excusable = canExcuseKeys[lunchKey];
                var rowBg = excusable === true ? '#e3f2fd' : excusable === 'partial' ? '#fff8e1' : 'transparent';
                var actionLabel = excusable === true ? '\u2705 Excuse with PTOST' : excusable === 'partial' ? '\u26A0\uFE0F Partial' : '';
                var actionColor = excusable === true ? '#0d47a1' : '#e65100';
                html += '<tr style="border-bottom:1px solid #f0f0f0; background:' + rowBg + ';">';
                html += '<td style="padding:6px 8px;">' + formatDateDisplay(item.fromDate) + '</td>';
                html += '<td style="padding:6px 8px;"><span style="padding:2px 6px; border-radius:3px; background:' + colors.bg + '; color:' + colors.text + '; font-size:0.88em;">' + escHtml(item.activity) + '</span></td>';
                html += '<td style="padding:6px 8px; text-align:right; font-weight:600;">' + hrs + 'h' + (hasLunch ? ' <span style="font-size:0.78em; color:#999;">(+.5)</span>' : '') + '</td>';
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
        html += '<div style="padding:6px; background:#fff3e0; border-radius:6px;"><div style="font-weight:700; color:#e65100;">' + ptost.unplannedNotPtost + 'h</div><div style="font-size:0.7em; color:#666;">Needs Reclassification</div></div>';
        html += '<div style="padding:6px; background:#e8f5e9; border-radius:6px;"><div style="font-weight:700; color:#2e7d32;">' + ptost.ptostRemaining + 'h</div><div style="font-size:0.7em; color:#666;">Remaining</div></div>';
        html += '</div>';
        if (ptostItems.length > 0) {
            html += buildTable(ptostItems, '#e3f2fd', [
                { label: 'Date' }, { label: 'Activity' }, { label: 'Hours', align: 'right' }
            ]);
        }
        html += '</div></details>';

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

            msg += '\nAs a reminder, our attendance policy is:\n';
            msg += '  - 16 hours: Verbal Warning\n';
            msg += '  - 24 hours: Written Warning\n';
            msg += '  - 32 hours: Second Written Warning\n';
            msg += '  - 40 hours: Termination Eligible\n';

            msg += '\nWould you like me to go ahead and get those hours excused? Just let me know.';

        // Scenario 2: has unexcused hours but NO PTOST left
        } else if (ptost.policyHours > 0 && ptost.ptostRemaining <= 0) {
            msg += '\nYou have ' + ptost.policyHours + ' hours of unplanned time against your reliability, and your PTOST balance is at 0.\n';
            msg += 'Current Status: ' + tier.tier.label + '\n';
            if (tier.nextTier) {
                msg += tier.hoursUntilNext + ' hours until ' + tier.nextTier.label + '\n';
            }

            msg += '\nAs a reminder, our attendance policy is:\n';
            msg += '  - 16 hours: Verbal Warning\n';
            msg += '  - 24 hours: Written Warning\n';
            msg += '  - 32 hours: Second Written Warning\n';
            msg += '  - 40 hours: Termination Eligible\n';

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

    function initializeAttendanceTracker() {
        var container = document.getElementById('attendanceDashboard');
        if (!container) return;

        var store = loadStore();
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
        html += '<button type="button" id="attendancePayrollPdfBtn" style="background:linear-gradient(135deg, #00695c 0%, #004d40 100%); color:white; border:none; border-radius:6px; padding:10px 20px; cursor:pointer; font-weight:bold;">Upload Payroll PDF</button>';
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
            if (verint?.uploadedAt) {
                var uploadDate = new Date(verint.uploadedAt).toLocaleDateString();
                indicator = '\u2705 ' + uploadDate;
                loadedCount++;

                // Check if they have unexcused hours that PTOST can cover
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
        handleVerintUploadFromUploadPage: handleVerintUploadFromUploadPage
    };
    window.initializeAttendanceTracker = initializeAttendanceTracker;
})();
