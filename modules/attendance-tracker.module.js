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

        return {
            ptostUsed: ptostUsed,
            unplannedNotPtost: unplannedNotPtost,
            totalUnplanned: totalUnplanned,
            reclassificationGap: unplannedNotPtost,
            ptostRemaining: round2(Math.max(0, PTOST_ANNUAL_LIMIT - ptostUsed)),
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
        var allUnplanned = UNPLANNED_NOT_PTOST.concat(PTOST_CATEGORIES);
        return activities
            .filter(function(a) { return allUnplanned.indexOf(a.activity) !== -1; })
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

        var ptost = calculatePtostUsage(data.ptoSubCategories || {});
        var tier = calculateDisciplineTier(ptost.totalUnplanned);
        var fmlaData = data.summary?.['FMLA'] || { used: 0 };
        var fmlaActivities = (data.activities || []).filter(function(a) { return a.activity === 'FMLA'; });
        var unplannedItems = getUnplannedLineItems(data.activities || []);
        var reclassItems = getNeedsReclassificationItems(data.activities || []);
        var plannedItems = getPlannedLineItems(data.activities || []);

        var firstName = employeeName.split(/[\s,]+/)[0];
        if (typeof getEmployeeNickname === 'function') {
            firstName = getEmployeeNickname(employeeName) || firstName;
        }

        var bereavementData = data.summary?.['WFO-Bereavement'] || { used: 0 };
        var bereavementActivities = (data.activities || []).filter(function(a) { return a.activity === 'WFO-Bereavement' || a.activity === 'Bereavement'; });

        var html = '';

        // Upload info
        html += '<div style="margin-bottom:12px; font-size:0.85em; color:#666;">Verint data uploaded: ' + new Date(data.uploadedAt).toLocaleDateString() + (data.organization ? ' | Org: ' + escHtml(data.organization) : '') + '</div>';

        // --- Always-visible summary cards ---

        // PTOST Tracker
        html += '<div style="margin-bottom:16px; padding:16px; background:#fff; border-radius:8px; border:1px solid #e0e0e0;">';
        html += '<h4 style="margin:0 0 12px 0; color:#0d47a1;">PTOST Tracker (40 hrs/year)</h4>';
        html += renderProgressBar(ptost.ptostUsed, PTOST_ANNUAL_LIMIT, '#1565c0', 20);
        html += '<div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; margin-top:10px; text-align:center;">';
        html += '<div style="padding:8px; background:#e3f2fd; border-radius:6px;"><div style="font-size:1.2em; font-weight:700; color:#0d47a1;">' + ptost.ptostUsed + 'h</div><div style="font-size:0.75em; color:#666;">PTOST Used</div></div>';
        html += '<div style="padding:8px; background:#fff3e0; border-radius:6px;"><div style="font-size:1.2em; font-weight:700; color:#e65100;">' + ptost.unplannedNotPtost + 'h</div><div style="font-size:0.75em; color:#666;">Needs Reclassification</div></div>';
        html += '<div style="padding:8px; background:#e8f5e9; border-radius:6px;"><div style="font-size:1.2em; font-weight:700; color:#2e7d32;">' + ptost.ptostRemaining + 'h</div><div style="font-size:0.75em; color:#666;">PTOST Remaining</div></div>';
        html += '</div>';
        if (ptost.reclassificationGap > 0) {
            html += '<div style="margin-top:10px; padding:8px 12px; background:#fff3e0; border-radius:6px; border-left:3px solid #e65100; font-size:0.85em; color:#e65100;">';
            html += '<strong>' + ptost.reclassificationGap + 'h</strong> need reclassification. Use Quick Messages below.';
            html += '</div>';
        }
        html += '</div>';

        // PTO Balance
        var ptoSummary = data.summary?.['PTO'] || {};
        var ptoTotal = round2(ptoSummary.total || 0);
        var ptoCarryover = round2(ptoSummary.carryover || 0);
        var ptoUsed = round2(ptoSummary.used || 0);
        var ptoScheduled = round2(ptoSummary.scheduled || 0);
        var ptoRemaining = round2(ptoSummary.remaining || 0);
        var ptoAllotment = round2(ptoTotal - ptoCarryover);
        var ptoRemainingColor = ptoRemaining > 16 ? '#2e7d32' : ptoRemaining > 8 ? '#e65100' : '#b71c1c';

        html += '<div style="margin-bottom:16px; padding:16px; background:#fff; border-radius:8px; border:1px solid #e0e0e0;">';
        html += '<h4 style="margin:0 0 10px 0; color:#2e7d32;">PTO Balance</h4>';
        html += renderProgressBar(ptoUsed, ptoTotal, '#2e7d32', 16);
        html += '<div style="display:grid; grid-template-columns:repeat(5, 1fr); gap:6px; margin-top:10px; text-align:center;">';
        html += '<div style="padding:6px; background:#e8f5e9; border-radius:6px;"><div style="font-size:1em; font-weight:700; color:#2e7d32;">' + ptoCarryover + 'h</div><div style="font-size:0.7em; color:#666;">Carryover</div></div>';
        html += '<div style="padding:6px; background:#e8f5e9; border-radius:6px;"><div style="font-size:1em; font-weight:700; color:#2e7d32;">' + ptoAllotment + 'h</div><div style="font-size:0.7em; color:#666;">Allotment</div></div>';
        html += '<div style="padding:6px; background:#fff3e0; border-radius:6px;"><div style="font-size:1em; font-weight:700; color:#e65100;">' + ptoUsed + 'h</div><div style="font-size:0.7em; color:#666;">Used</div></div>';
        html += '<div style="padding:6px; background:#e3f2fd; border-radius:6px;"><div style="font-size:1em; font-weight:700; color:#1565c0;">' + ptoScheduled + 'h</div><div style="font-size:0.7em; color:#666;">Scheduled</div></div>';
        html += '<div style="padding:6px; background:#f5f5f5; border-radius:6px;"><div style="font-size:1em; font-weight:700; color:' + ptoRemainingColor + ';">' + ptoRemaining + 'h</div><div style="font-size:0.7em; color:#666;">Remaining</div></div>';
        html += '</div></div>';

        // Attendance Policy Status
        html += '<div style="margin-bottom:16px; padding:16px; background:#fff; border-radius:8px; border:1px solid #e0e0e0;">';
        html += '<h4 style="margin:0 0 6px 0; color:' + tier.tier.color + ';">Attendance Policy Status</h4>';
        html += renderTierBar(ptost.totalUnplanned);
        html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; flex-wrap:wrap; gap:8px;">';
        html += '<div style="padding:6px 14px; border-radius:20px; background:' + tier.tier.bg + '; color:' + tier.tier.color + '; font-weight:700; font-size:0.9em;">' + tier.tier.label + '</div>';
        html += '<div style="font-size:0.85em; color:#666;">' + ptost.totalUnplanned + 'h total unplanned</div>';
        if (tier.nextTier) {
            html += '<div style="font-size:0.82em; color:' + tier.nextTier.color + '; font-weight:600;">' + tier.hoursUntilNext + 'h until ' + tier.nextTier.label + '</div>';
        }
        html += '</div></div>';

        // --- Collapsible detail sections ---

        var detailStyle = 'margin-bottom:12px; border:1px solid #e0e0e0; border-radius:8px; overflow:hidden;';
        var summaryStyle = 'padding:12px 16px; cursor:pointer; font-weight:600; font-size:0.95em; background:#fafafa; user-select:none;';
        var contentStyle = 'padding:12px 16px;';

        // Unplanned Absences
        if (unplannedItems.length > 0) {
            var unplannedTotalHrs = round2(unplannedItems.reduce(function(s, i) { return s + i.hours; }, 0));
            html += '<details style="' + detailStyle + '" open>';
            html += '<summary style="' + summaryStyle + 'color:#d84315;">Unplanned Absences (' + unplannedItems.length + ' entries, ' + unplannedTotalHrs + 'h)</summary>';
            html += '<div style="' + contentStyle + '">';
            html += '<table style="width:100%; border-collapse:collapse; font-size:0.85em;">';
            html += '<tr style="background:#eceff1;"><th style="padding:6px 8px; text-align:left;">Date</th><th style="padding:6px 8px; text-align:left;">Activity</th><th style="padding:6px 8px; text-align:right;">Hours</th><th style="padding:6px 8px; text-align:center;">Status</th></tr>';
            unplannedItems.forEach(function(item) {
                var colors = ACTIVITY_COLORS[item.activity] || DEFAULT_ACTIVITY_COLOR;
                var isPtost = PTOST_CATEGORIES.indexOf(item.activity) !== -1;
                var statusLabel = isPtost ? 'PTOST' : 'Needs Reclassification';
                var statusColor = isPtost ? '#0d47a1' : '#e65100';
                html += '<tr style="border-bottom:1px solid #f0f0f0;">';
                html += '<td style="padding:6px 8px;">' + formatDateDisplay(item.fromDate) + '</td>';
                html += '<td style="padding:6px 8px;"><span style="padding:2px 6px; border-radius:3px; background:' + colors.bg + '; color:' + colors.text + '; font-size:0.88em;">' + escHtml(item.activity) + '</span></td>';
                html += '<td style="padding:6px 8px; text-align:right; font-weight:600;">' + item.hours + 'h</td>';
                html += '<td style="padding:6px 8px; text-align:center; color:' + statusColor + '; font-weight:600; font-size:0.82em;">' + statusLabel + '</td>';
                html += '</tr>';
            });
            html += '</table></div></details>';
        }

        // Planned Time Off
        if (plannedItems.length > 0) {
            var plannedTotalHrs = round2(plannedItems.reduce(function(s, i) { return s + i.hours; }, 0));
            html += '<details style="' + detailStyle + '">';
            html += '<summary style="' + summaryStyle + 'color:#2e7d32;">Planned Time Off (' + plannedItems.length + ' entries, ' + plannedTotalHrs + 'h)</summary>';
            html += '<div style="' + contentStyle + '">';
            html += '<table style="width:100%; border-collapse:collapse; font-size:0.85em;">';
            html += '<tr style="background:#e8f5e9;"><th style="padding:6px 8px; text-align:left;">Date</th><th style="padding:6px 8px; text-align:left;">Type</th><th style="padding:6px 8px; text-align:right;">Hours</th></tr>';
            plannedItems.forEach(function(item) {
                var colors = ACTIVITY_COLORS[item.activity] || { bg: '#e8f5e9', text: '#2e7d32' };
                html += '<tr style="border-bottom:1px solid #f0f0f0;">';
                html += '<td style="padding:6px 8px;">' + formatDateDisplay(item.fromDate) + '</td>';
                html += '<td style="padding:6px 8px;"><span style="padding:2px 6px; border-radius:3px; background:' + colors.bg + '; color:' + colors.text + '; font-size:0.88em;">' + escHtml(item.activity) + '</span></td>';
                html += '<td style="padding:6px 8px; text-align:right; font-weight:600;">' + item.hours + 'h</td>';
                html += '</tr>';
            });
            html += '</table></div></details>';
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
            var msg = generateAssociateMessage(firstName, ptost, tier, reclassItems);
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
    }

    // --- Message Generators ---

    function generateAssociateMessage(firstName, ptost, tier, reclassItems) {
        var msg = 'Hey ' + firstName + '! Quick attendance update for you:\n\n';

        msg += 'PTOST Used: ' + ptost.ptostUsed + ' / ' + ptost.ptostLimit + ' hours\n';
        msg += 'PTOST Remaining: ' + ptost.ptostRemaining + ' hours\n';

        // Key scenario: they have PTOST left AND unexcused hours
        if (ptost.reclassificationGap > 0 && ptost.ptostRemaining > 0) {
            var canCover = Math.min(ptost.reclassificationGap, ptost.ptostRemaining);
            var wouldRemain = round2(ptost.ptostRemaining - canCover);
            var uncovered = round2(ptost.reclassificationGap - canCover);

            msg += '\nYou currently have ' + ptost.reclassificationGap + ' hours of unplanned/unexcused time that counts against your reliability. ';
            msg += 'The good news is you still have ' + ptost.ptostRemaining + ' hours of PTOST available.\n\n';

            msg += 'I can reach out to WFM and get ';
            if (canCover >= ptost.reclassificationGap) {
                msg += 'all ' + ptost.reclassificationGap + ' hours excused as PTOST';
                msg += ' (you\'d still have ' + wouldRemain + ' hours of PTOST left after that).\n';
            } else {
                msg += canCover + ' hours excused as PTOST, but ' + uncovered + ' hours would remain unexcused since that\'s all the PTOST you have left.\n';
            }

            msg += '\nHere are the specific dates:\n';
            reclassItems.forEach(function(item) {
                msg += '  - ' + formatDateDisplay(item.fromDate) + ': ' + item.hours + 'h (' + item.activity + ')\n';
            });

            msg += '\nWould you like me to go ahead and get these excused? Just let me know.';
        } else if (ptost.reclassificationGap > 0 && ptost.ptostRemaining <= 0) {
            // No PTOST left — these hours are unexcused and count against policy
            msg += '\nYou have ' + ptost.reclassificationGap + ' hours of unplanned time that is currently unexcused. ';
            msg += 'Unfortunately your PTOST balance is at 0, so these hours go against the attendance policy.\n';

            msg += '\nTotal Unplanned Hours: ' + ptost.totalUnplanned + ' hours\n';
            msg += 'Current Status: ' + tier.tier.label + '\n';
            if (tier.nextTier) {
                msg += tier.hoursUntilNext + ' hours until ' + tier.nextTier.label + '\n';
            }

            msg += '\nPlease be mindful of attendance going forward. Let me know if you have any questions about the attendance policy or if there\'s anything I can help with.';
        } else {
            // No reclassification needed
            msg += '\nTotal Unplanned Hours: ' + ptost.totalUnplanned + ' hours\n';
            msg += 'Current Status: ' + tier.tier.label + '\n';
            if (tier.nextTier) {
                msg += tier.hoursUntilNext + ' hours until ' + tier.nextTier.label + '\n';
            }

            if (ptost.totalUnplanned >= 24) {
                msg += '\nPlease be mindful of attendance going forward. Let me know if there\'s anything I can help with.';
            } else if (ptost.totalUnplanned >= 16) {
                msg += '\nJust want to make sure you\'re aware of where things stand. Let me know if you need anything.';
            } else {
                msg += '\nYou\'re in good shape. Keep it up!';
            }
        }

        return msg;
    }

    function generateWfmMessage(employeeName, reclassItems, ptost) {
        if (reclassItems.length === 0) {
            return 'No entries need reclassification for ' + employeeName + '.';
        }

        var totalHours = round2(reclassItems.reduce(function(sum, item) { return sum + item.hours; }, 0));
        var canCover = ptost ? Math.min(totalHours, ptost.ptostRemaining) : totalHours;

        var msg = 'Hi WFM team,\n\n';

        if (ptost && ptost.ptostRemaining > 0) {
            msg += employeeName + ' has ' + ptost.ptostRemaining + 'h of PTOST remaining (used ' + ptost.ptostUsed + '/' + ptost.ptostLimit + 'h). ';
            msg += 'Please reclassify the following unplanned entries as PTOST:\n\n';
        } else {
            msg += 'Please reclassify the following entries as PTOST for ' + employeeName + ':\n\n';
        }

        reclassItems.forEach(function(item) {
            msg += '- ' + formatDateDisplay(item.fromDate) + ': ' + item.activity + ' - ' + item.hours + 'h\n';
        });

        msg += '\nTotal: ' + totalHours + 'h to reclassify';
        if (ptost && ptost.ptostRemaining > 0 && totalHours > ptost.ptostRemaining) {
            msg += ' (note: only ' + ptost.ptostRemaining + 'h of PTOST remaining — ' + round2(totalHours - ptost.ptostRemaining) + 'h will exceed their PTOST balance)';
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
        var allNames = new Set(associateNames);
        Object.values(weekly).concat(Object.values(ytd)).forEach(function(period) {
            (period?.employees || []).forEach(function(emp) {
                if (emp?.name && (typeof isAssociateIncludedByTeamFilter !== 'function' || isAssociateIncludedByTeamFilter(emp.name, ctx))) {
                    allNames.add(emp.name);
                }
            });
        });

        var sortedNames = Array.from(allNames).sort();

        // Render upload + dropdown + dashboard
        var html = '';

        // Upload row
        html += '<div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:16px; align-items:center;">';
        html += '<input type="file" id="attendanceVerintInput" accept=".xlsx,.xls" multiple style="display:none;">';
        html += '<button type="button" id="attendanceVerintBtn" style="background:linear-gradient(135deg, #7b1fa2 0%, #4a148c 100%); color:white; border:none; border-radius:6px; padding:10px 20px; cursor:pointer; font-weight:bold;">Upload Verint Excel(s)</button>';
        html += '<span id="attendanceVerintFileName" style="font-size:0.85em; color:#666;"></span>';
        html += '</div>';

        // Associate dropdown
        html += '<div style="margin-bottom:16px;">';
        html += '<label for="attendanceAssociateSelect" style="font-weight:bold; display:block; margin-bottom:6px;">Select Associate:</label>';
        html += '<select id="attendanceAssociateSelect" style="width:100%; max-width:400px; padding:10px; border:2px solid #7b1fa2; border-radius:4px; font-size:1em; cursor:pointer;">';
        html += '<option value="">-- Choose an associate --</option>';
        var loadedCount = 0;
        var missingCount = 0;
        sortedNames.forEach(function(name) {
            var verint = store.associates?.[name]?.verintData;
            var indicator = '';
            if (verint?.uploadedAt) {
                var uploadDate = new Date(verint.uploadedAt).toLocaleDateString();
                indicator = '\u2705 ' + uploadDate + ' \u2014 ';
                loadedCount++;
            } else {
                indicator = '\u274C No data \u2014 ';
                missingCount++;
            }
            html += '<option value="' + escHtml(name) + '">' + indicator + escHtml(name) + '</option>';
        });
        html += '</select>';
        if (sortedNames.length > 0) {
            html += '<div style="margin-top:6px; font-size:0.85em; color:#666;">' + loadedCount + ' loaded, ' + missingCount + ' missing</div>';
        }
        html += '</div>';

        // Dashboard area
        html += '<div id="attendanceEmployeeDashboard"></div>';

        container.innerHTML = html;

        // Bind events
        document.getElementById('attendanceVerintBtn')?.addEventListener('click', function() {
            document.getElementById('attendanceVerintInput')?.click();
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
            var empDash = document.getElementById('attendanceEmployeeDashboard');
            if (!empDash) return;
            var name = this.value;
            if (!name) { empDash.innerHTML = ''; return; }
            renderAttendanceDashboard(empDash, name);
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
        parseVerintExcel: parseVerintExcel,
        handleVerintUploadFromUploadPage: handleVerintUploadFromUploadPage
    };
    window.initializeAttendanceTracker = initializeAttendanceTracker;
})();
