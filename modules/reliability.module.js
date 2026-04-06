// reliability.module.js — Reliability Tracker
// Reconciles Verint Time Off Summary and Payroll Time Entry Excel files
// to track PTOST buffer usage and flag reliability events.
(function() {
    'use strict';

    var PTOST_BUFFER_LIMIT = 40;
    var STORAGE_KEY = 'reliabilityTracker';

    // ============================================
    // STORAGE
    // ============================================

    function loadStore() {
        var mod = window.DevCoachModules?.storage;
        if (mod?.loadReliabilityTracker) return mod.loadReliabilityTracker();
        try {
            var saved = localStorage.getItem('devCoachingTool_' + STORAGE_KEY);
            return saved ? JSON.parse(saved) : { employees: {} };
        } catch (e) { return { employees: {} }; }
    }

    function saveStore(store) {
        var mod = window.DevCoachModules?.storage;
        if (mod?.saveReliabilityTracker) return mod.saveReliabilityTracker(store);
        try { localStorage.setItem('devCoachingTool_' + STORAGE_KEY, JSON.stringify(store)); } catch (e) { console.error('Reliability save error:', e); }
    }

    // ============================================
    // UTILITY
    // ============================================

    function stripUnicode(s) {
        if (typeof s !== 'string') return '';
        return s.replace(/[\u202c\u202d\u200e\u200f\u200b]/g, '').trim();
    }

    function round2(n) { return Math.round(n * 100) / 100; }

    function normalizeEmployeeName(raw) {
        // Payroll: "ROBERT BERRELLEZA" -> "Berrelleza, Robert"
        // Verint:  "Berrelleza, Robert" (already correct)
        var s = stripUnicode(raw).trim();
        if (!s) return '';
        // If already "Last, First" format
        if (s.includes(',')) {
            var parts = s.split(',').map(function(p) { return p.trim(); });
            return parts.map(function(p) {
                return p.split(/\s+/).map(function(w) {
                    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
                }).join(' ');
            }).join(', ');
        }
        // "FIRST LAST" or "FIRST MIDDLE LAST"
        var words = s.split(/\s+/);
        if (words.length < 2) return s;
        var last = words[words.length - 1];
        var first = words.slice(0, -1).join(' ');
        return [last, first].map(function(p) {
            return p.split(/\s+/).map(function(w) {
                return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
            }).join(' ');
        }).join(', ');
    }

    function formatDate(d) {
        if (!d) return '';
        if (typeof d === 'string') d = new Date(d);
        var m = d.getMonth() + 1;
        var day = d.getDate();
        var y = d.getFullYear();
        return m + '/' + day + '/' + y;
    }

    function getFirstName(fullName) {
        if (typeof getEmployeeNickname === 'function') return getEmployeeNickname(fullName);
        if (!fullName) return '';
        if (fullName.includes(',')) return fullName.split(',')[1].trim().split(/\s+/)[0];
        return fullName.split(/\s+/)[0];
    }

    var escapeHtml = function(s) {
        return window.DevCoachModules?.sharedUtils?.escapeHtml?.(s) ?? String(s ?? '');
    };

    // ============================================
    // PARSING — VERINT TIME OFF SUMMARY
    // ============================================

    function parseVerintExcel(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                try {
                    var XLSX = window.XLSX;
                    if (!XLSX) return reject(new Error('SheetJS not loaded'));
                    var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                    var ws = wb.Sheets[wb.SheetNames[0]];
                    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                    resolve(extractVerintData(rows));
                } catch (err) { reject(err); }
            };
            reader.onerror = function() { reject(new Error('File read error')); };
            reader.readAsArrayBuffer(file);
        });
    }

    function extractVerintData(rows) {
        // Find employee name from "Employee: Last, First" row
        var employeeName = '';
        var employeeRow = rows.find(function(r) {
            return String(r[1] || '').trim().startsWith('Employee:');
        });
        if (employeeRow) {
            employeeName = String(employeeRow[1]).replace(/^Employee:\s*/, '').trim();
        }

        // Extract summary totals for same-day / PTOST categories
        // Col B = activity name (index 1), Col H = Used Hours (index 7)
        var summaryCategories = {};
        var SAME_DAY_KEYS = [
            'Same Day', 'Same Day - Full PTOST', 'Same Day - No Call No Show',
            'Same Day - Partial', 'Same day - Partial PTOST',
            'Tardy EQ GT 6 Min', 'Tardy EQ GT 6 Min PTOST', 'Tardy LT 6 Min'
        ];
        rows.forEach(function(r) {
            var activity = String(r[1] || '').trim();
            if (SAME_DAY_KEYS.indexOf(activity) >= 0) {
                var used = parseFloat(r[7]) || 0;
                summaryCategories[activity] = used;
            }
        });

        // Extract chronological detail events (Time Off Activities section)
        // Header row: "Time Off Activities", ..., "From", ..., "To", ..., "Length (Hours)"
        var events = [];
        var detailStartIdx = -1;
        for (var i = 0; i < rows.length; i++) {
            if (String(rows[i][1] || '').trim() === 'Time Off Activities') {
                detailStartIdx = i + 1;
                break;
            }
        }
        if (detailStartIdx > 0) {
            for (var j = detailStartIdx; j < rows.length; j++) {
                var row = rows[j];
                var activity = String(row[1] || '').trim();
                // Stop at "Total Time Off" or "Time Off Requests" or empty section
                if (activity.startsWith('Total Time Off') || activity === 'Time Off Requests' || activity === '') break;

                var fromStr = String(row[5] || '');
                var toStr = String(row[8] || '');
                var lengthStr = String(row[11] || '').trim();
                var hours = parseFloat(lengthStr) || 0;
                var fromDate = fromStr ? new Date(fromStr) : null;

                events.push({
                    activity: activity,
                    from: fromDate,
                    to: toStr ? new Date(toStr) : null,
                    hours: hours,
                    dateStr: fromDate ? formatDate(fromDate) : ''
                });
            }
        }

        // Sort events chronologically
        events.sort(function(a, b) { return (a.from || 0) - (b.from || 0); });

        return {
            employeeName: employeeName,
            summary: summaryCategories,
            events: events
        };
    }

    // ============================================
    // PARSING — PAYROLL TIME ENTRY
    // ============================================

    function parsePayrollExcel(file) {
        return new Promise(function(resolve, reject) {
            var reader = new FileReader();
            reader.onload = function(e) {
                try {
                    var XLSX = window.XLSX;
                    if (!XLSX) return reject(new Error('SheetJS not loaded'));
                    var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
                    var ws = wb.Sheets[wb.SheetNames[0]];
                    var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
                    resolve(extractPayrollData(rows));
                } catch (err) { reject(err); }
            };
            reader.onerror = function() { reject(new Error('File read error')); };
            reader.readAsArrayBuffer(file);
        });
    }

    function extractPayrollData(rows) {
        // Row 4 (index 3) = headers: Emplid, Name, ..., Date, ..., TRC, Quantity, ..., Task Code
        // Row 5+ = data
        // Columns: A=Emplid(0), B=Name(1), G=Date(6), I=In(8), N=Out(13), O=TRC(14), P=Quantity(15), W=TaskCode(22)
        var employees = {};
        for (var i = 4; i < rows.length; i++) {
            var row = rows[i];
            var rawName = stripUnicode(String(row[1] || ''));
            if (!rawName) continue;

            var name = normalizeEmployeeName(rawName);
            var emplid = stripUnicode(String(row[0] || ''));
            var dateStr = String(row[6] || '');
            var clockIn = String(row[8] || '').trim();
            var clockOut = String(row[13] || '').trim();
            var trc = stripUnicode(String(row[14] || '')).toUpperCase();
            var quantity = parseFloat(row[15]) || 0;
            var taskCode = stripUnicode(String(row[22] || '')).toUpperCase();

            var dateObj = dateStr ? new Date(dateStr) : null;

            if (!employees[name]) {
                employees[name] = { emplid: emplid, entries: [] };
            }

            employees[name].entries.push({
                date: dateObj,
                dateStr: dateObj ? formatDate(dateObj) : '',
                clockIn: clockIn,
                clockOut: clockOut,
                trc: trc,
                quantity: quantity,
                taskCode: taskCode
            });
        }

        // Sort each employee's entries chronologically
        Object.keys(employees).forEach(function(name) {
            employees[name].entries.sort(function(a, b) { return (a.date || 0) - (b.date || 0); });
        });

        return employees;
    }

    // ============================================
    // RECONCILIATION
    // ============================================

    function reconcileEmployee(verintData, payrollEntries) {
        var result = {
            ptostHoursUsed: 0,
            ptostBufferRemaining: PTOST_BUFFER_LIMIT,
            ptostEvents: [],          // All PTOST events (chronological)
            reliabilityHours: 0,
            reliabilityEvents: [],     // Events that count against reliability
            discrepancies: [],         // Verint says absent but payroll says worked
            unschdPtoEvents: []        // PTO with UNSCHD task code
        };

        if (!payrollEntries || !payrollEntries.length) {
            // Verint-only: use summary data
            if (verintData) {
                var ptostCategories = ['Same Day - Full PTOST', 'Same day - Partial PTOST', 'Tardy EQ GT 6 Min PTOST'];
                var sameDayCategories = ['Same Day', 'Same Day - Partial', 'Same Day - No Call No Show', 'Tardy EQ GT 6 Min', 'Tardy LT 6 Min'];

                ptostCategories.forEach(function(cat) {
                    result.ptostHoursUsed += (verintData.summary[cat] || 0);
                });

                var unexcusedSameDay = 0;
                sameDayCategories.forEach(function(cat) {
                    unexcusedSameDay += (verintData.summary[cat] || 0);
                });

                result.ptostBufferRemaining = round2(Math.max(0, PTOST_BUFFER_LIMIT - result.ptostHoursUsed));
                // If PTOST used > 40, the overage plus unexcused = reliability
                var ptostOverage = round2(Math.max(0, result.ptostHoursUsed - PTOST_BUFFER_LIMIT));
                result.reliabilityHours = round2(ptostOverage + unexcusedSameDay);

                // Build events from Verint detail
                if (verintData.events) {
                    verintData.events.forEach(function(ev) {
                        if (ptostCategories.some(function(cat) { return ev.activity === cat; })) {
                            result.ptostEvents.push(ev);
                        }
                        if (sameDayCategories.some(function(cat) { return ev.activity === cat; })) {
                            result.reliabilityEvents.push(ev);
                        }
                    });
                }
            }
            return result;
        }

        // --- Payroll-based reconciliation (source of truth) ---

        // Gather all PTOST entries chronologically
        var ptostEntries = payrollEntries.filter(function(e) { return e.trc === 'PTOST'; });
        var runningPtost = 0;

        ptostEntries.forEach(function(entry) {
            runningPtost = round2(runningPtost + entry.quantity);
            var ev = {
                activity: 'PTOST',
                dateStr: entry.dateStr,
                hours: entry.quantity,
                from: entry.date,
                runningTotal: runningPtost,
                protected: runningPtost <= PTOST_BUFFER_LIMIT
            };
            result.ptostEvents.push(ev);

            // If this entry pushes past the 40h buffer, the overage is a reliability event
            if (runningPtost > PTOST_BUFFER_LIMIT) {
                var overage = round2(Math.min(entry.quantity, runningPtost - PTOST_BUFFER_LIMIT));
                result.reliabilityEvents.push({
                    activity: 'PTOST (over 40h buffer)',
                    dateStr: entry.dateStr,
                    hours: overage,
                    from: entry.date
                });
                result.reliabilityHours = round2(result.reliabilityHours + overage);
            }
        });

        result.ptostHoursUsed = round2(runningPtost);
        result.ptostBufferRemaining = round2(Math.max(0, PTOST_BUFFER_LIMIT - runningPtost));

        // Gather PTO + UNSCHD task code entries (unscheduled PTO not covered by PTOST)
        var unschdPto = payrollEntries.filter(function(e) {
            return e.trc === 'PTO' && e.taskCode === 'UNSCHD';
        });
        unschdPto.forEach(function(entry) {
            result.unschdPtoEvents.push({
                activity: 'PTO (UNSCHD)',
                dateStr: entry.dateStr,
                hours: entry.quantity,
                from: entry.date
            });
            result.reliabilityHours = round2(result.reliabilityHours + entry.quantity);
            result.reliabilityEvents.push({
                activity: 'PTO (UNSCHD)',
                dateStr: entry.dateStr,
                hours: entry.quantity,
                from: entry.date
            });
        });

        // --- Fraud detection: Verint says Same Day absent, but payroll shows REG with clock times ---
        if (verintData && verintData.events) {
            var sameDayVerintDates = {};
            verintData.events.forEach(function(ev) {
                if (ev.activity.indexOf('Same Day') === 0 && ev.from) {
                    var key = ev.from.toISOString().slice(0, 10);
                    sameDayVerintDates[key] = ev;
                }
            });

            payrollEntries.forEach(function(entry) {
                if (entry.trc !== 'REG' || !entry.clockIn || !entry.date) return;
                var key = entry.date.toISOString().slice(0, 10);
                if (sameDayVerintDates[key]) {
                    result.discrepancies.push({
                        date: entry.dateStr,
                        verintActivity: sameDayVerintDates[key].activity,
                        verintHours: sameDayVerintDates[key].hours,
                        payrollTrc: 'REG',
                        payrollHours: entry.quantity,
                        payrollClockIn: entry.clockIn,
                        payrollClockOut: entry.clockOut
                    });
                }
            });
        }

        return result;
    }

    // ============================================
    // EMAIL DRAFTS
    // ============================================

    function buildPtostDesignationEmail(employeeName, events) {
        var firstName = getFirstName(employeeName);
        var lines = [];
        lines.push('Hi ' + firstName + ',\n');
        lines.push('I wanted to follow up regarding some unscheduled time off entries on your record.\n');
        lines.push('You have the following unscheduled absence(s) that have not been designated as PTOST:\n');

        events.forEach(function(ev) {
            lines.push('  - ' + ev.dateStr + ': ' + ev.hours + ' hours (' + ev.activity + ')');
        });

        lines.push('\nAs a reminder, you have a 40-hour PTOST buffer available to cover unscheduled absences. Using PTOST keeps these hours from counting against your reliability.');
        lines.push('\nWould you like me to designate any or all of these as PTOST? Please let me know and I\'ll submit the update.\n');
        lines.push('Thanks,');
        return lines.join('\n');
    }

    function buildWfmCorrectionEmail(employeeName, discrepancies) {
        var firstName = getFirstName(employeeName);
        var lines = [];
        lines.push('Hi WFM,\n');
        lines.push('I found the following discrepancies for ' + employeeName + ' between Verint and Payroll that need correction:\n');

        discrepancies.forEach(function(d) {
            lines.push('  - ' + d.date + ': Verint shows "' + d.verintActivity + '" (' + d.verintHours + 'h absent), but Payroll shows REG ' + d.payrollHours + 'h with clock-in at ' + d.payrollClockIn);
        });

        lines.push('\nCan you please review and correct these entries?\n');
        lines.push('Thank you.');
        return lines.join('\n');
    }

    // ============================================
    // DISPLAY
    // ============================================

    function getTierInfo(reliabilityHours) {
        if (reliabilityHours <= 0)  return { label: 'Clean', color: '#2e7d32', bg: '#e8f5e9' };
        if (reliabilityHours <= 16) return { label: 'Verbal', color: '#f57f17', bg: '#fff8e1' };
        if (reliabilityHours <= 24) return { label: 'Written', color: '#e65100', bg: '#fff3e0' };
        if (reliabilityHours <= 32) return { label: 'Final', color: '#b71c1c', bg: '#ffebee' };
        return { label: 'Termination', color: '#4a148c', bg: '#f3e5f5' };
    }

    function renderTeamTable(container) {
        var store = loadStore();
        var employees = store.employees || {};
        var names = Object.keys(employees).sort();

        var html = '';
        html += '<div style="margin-bottom:16px;">';
        html += '<h3 style="margin:0 0 12px 0; color:#00695c;">📋 Reliability Tracker</h3>';

        // Upload buttons
        html += '<div style="display:flex; gap:10px; margin-bottom:16px; flex-wrap:wrap;">';
        html += '<button type="button" id="relUploadVerint" style="padding:8px 16px; background:#7b1fa2; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600;">📋 Upload Verint (per employee)</button>';
        html += '<input type="file" id="relVerintInput" accept=".xlsx,.xls" multiple style="display:none;">';
        html += '<button type="button" id="relUploadPayroll" style="padding:8px 16px; background:#00695c; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600;">💰 Upload Payroll (all employees)</button>';
        html += '<input type="file" id="relPayrollInput" accept=".xlsx,.xls" style="display:none;">';
        html += '</div>';

        if (names.length === 0) {
            html += '<div style="padding:20px; background:#f5f5f5; border-radius:8px; text-align:center; color:#666;">';
            html += 'No data yet. Upload Verint and/or Payroll files to get started.';
            html += '</div>';
            html += '</div>';
            container.innerHTML = html;
            bindUploadButtons(container);
            return;
        }

        // Summary table
        html += '<div style="overflow-x:auto;">';
        html += '<table style="width:100%; border-collapse:collapse; font-size:0.88em;">';
        html += '<thead><tr style="background:#e0f2f1; color:#00695c;">';
        html += '<th style="padding:8px; text-align:left; border-bottom:2px solid #00695c;">Employee</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">PTOST Used</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">Buffer Left</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">Reliability Hours</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">Tier</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">Discrepancies</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">Sources</th>';
        html += '</tr></thead><tbody>';

        names.forEach(function(name) {
            var emp = employees[name];
            var r = emp.reconciled || {};
            var tier = getTierInfo(r.reliabilityHours || 0);
            var discCount = (r.discrepancies || []).length;

            html += '<tr style="border-bottom:1px solid #e0e0e0; cursor:pointer;" class="rel-employee-row" data-name="' + escapeHtml(name) + '">';
            html += '<td style="padding:8px; font-weight:600;">' + escapeHtml(name) + '</td>';
            html += '<td style="padding:8px; text-align:center;">' + (r.ptostHoursUsed || 0) + 'h</td>';
            html += '<td style="padding:8px; text-align:center;">' + (r.ptostBufferRemaining !== undefined ? r.ptostBufferRemaining : PTOST_BUFFER_LIMIT) + 'h</td>';
            html += '<td style="padding:8px; text-align:center; font-weight:700; color:' + tier.color + ';">' + (r.reliabilityHours || 0) + 'h</td>';
            html += '<td style="padding:8px; text-align:center;"><span style="padding:2px 8px; border-radius:4px; background:' + tier.bg + '; color:' + tier.color + '; font-weight:600; font-size:0.85em;">' + tier.label + '</span></td>';
            html += '<td style="padding:8px; text-align:center;">' + (discCount > 0 ? '<span style="color:#b71c1c; font-weight:700;">⚠ ' + discCount + '</span>' : '✓') + '</td>';

            var sources = [];
            if (emp.hasVerint) sources.push('V');
            if (emp.hasPayroll) sources.push('P');
            html += '<td style="padding:8px; text-align:center; font-size:0.8em; color:#666;">' + (sources.join('+') || '—') + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';

        // Detail panel (shown when clicking a row)
        html += '<div id="relDetailPanel" style="display:none; margin-top:16px;"></div>';
        html += '</div>';

        container.innerHTML = html;
        bindUploadButtons(container);
        bindRowClicks(container);
    }

    function renderEmployeeDetail(container, employeeName) {
        var store = loadStore();
        var emp = store.employees?.[employeeName];
        if (!emp) { container.innerHTML = ''; return; }
        var r = emp.reconciled || {};
        var tier = getTierInfo(r.reliabilityHours || 0);
        var firstName = getFirstName(employeeName);

        var html = '';
        html += '<div style="padding:16px; background:#fff; border-radius:8px; border:1px solid #e0e0e0;">';

        // Header
        html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">';
        html += '<h4 style="margin:0; color:#00695c;">' + escapeHtml(employeeName) + '</h4>';
        html += '<button type="button" id="relCloseDetail" style="padding:4px 12px; border:1px solid #ccc; background:#fff; border-radius:4px; cursor:pointer;">✕ Close</button>';
        html += '</div>';

        // Status cards
        html += '<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-bottom:16px;">';
        html += '<div style="padding:10px; background:#e0f2f1; border-radius:6px; text-align:center;"><div style="font-size:1.3em; font-weight:700; color:#00695c;">' + (r.ptostHoursUsed || 0) + 'h</div><div style="font-size:0.75em; color:#666;">PTOST Used</div></div>';
        html += '<div style="padding:10px; background:#e3f2fd; border-radius:6px; text-align:center;"><div style="font-size:1.3em; font-weight:700; color:#0d47a1;">' + (r.ptostBufferRemaining !== undefined ? r.ptostBufferRemaining : PTOST_BUFFER_LIMIT) + 'h</div><div style="font-size:0.75em; color:#666;">Buffer Left</div></div>';
        html += '<div style="padding:10px; background:' + tier.bg + '; border-radius:6px; text-align:center;"><div style="font-size:1.3em; font-weight:700; color:' + tier.color + ';">' + (r.reliabilityHours || 0) + 'h</div><div style="font-size:0.75em; color:#666;">Against Reliability</div></div>';
        html += '<div style="padding:10px; background:' + tier.bg + '; border-radius:6px; text-align:center;"><div style="font-size:1.3em; font-weight:700; color:' + tier.color + ';">' + tier.label + '</div><div style="font-size:0.75em; color:#666;">Tier</div></div>';
        html += '</div>';

        // PTOST buffer usage bar
        var pctUsed = Math.min(100, ((r.ptostHoursUsed || 0) / PTOST_BUFFER_LIMIT) * 100);
        var barColor = pctUsed >= 100 ? '#b71c1c' : pctUsed >= 75 ? '#e65100' : '#2e7d32';
        html += '<div style="margin-bottom:16px;">';
        html += '<div style="font-size:0.82em; font-weight:600; margin-bottom:4px;">PTOST Buffer (' + (r.ptostHoursUsed || 0) + ' / ' + PTOST_BUFFER_LIMIT + 'h)</div>';
        html += '<div style="height:12px; background:#e0e0e0; border-radius:6px; overflow:hidden;">';
        html += '<div style="height:100%; width:' + pctUsed + '%; background:' + barColor + '; border-radius:6px; transition:width 0.3s;"></div>';
        html += '</div></div>';

        // PTOST Events table
        if (r.ptostEvents && r.ptostEvents.length > 0) {
            html += '<details open style="margin-bottom:12px;">';
            html += '<summary style="cursor:pointer; font-weight:600; color:#00695c; font-size:0.9em;">PTOST Events (' + r.ptostEvents.length + ')</summary>';
            html += '<table style="width:100%; border-collapse:collapse; font-size:0.82em; margin-top:6px;">';
            html += '<tr style="background:#e0f2f1;"><th style="padding:4px 8px; text-align:left;">Date</th><th style="padding:4px 8px; text-align:center;">Hours</th><th style="padding:4px 8px; text-align:center;">Running Total</th><th style="padding:4px 8px; text-align:center;">Status</th></tr>';
            r.ptostEvents.forEach(function(ev) {
                var isProtected = (ev.runningTotal || 0) <= PTOST_BUFFER_LIMIT;
                html += '<tr style="border-bottom:1px solid #f0f0f0;">';
                html += '<td style="padding:4px 8px;">' + escapeHtml(ev.dateStr) + '</td>';
                html += '<td style="padding:4px 8px; text-align:center;">' + ev.hours + '</td>';
                html += '<td style="padding:4px 8px; text-align:center;">' + (ev.runningTotal || '—') + '</td>';
                html += '<td style="padding:4px 8px; text-align:center;">' + (isProtected ? '<span style="color:#2e7d32;">Protected</span>' : '<span style="color:#b71c1c;">Over buffer</span>') + '</td>';
                html += '</tr>';
            });
            html += '</table></details>';
        }

        // Reliability Events
        if (r.reliabilityEvents && r.reliabilityEvents.length > 0) {
            html += '<details open style="margin-bottom:12px;">';
            html += '<summary style="cursor:pointer; font-weight:600; color:#b71c1c; font-size:0.9em;">Reliability Events (' + r.reliabilityEvents.length + ')</summary>';
            html += '<table style="width:100%; border-collapse:collapse; font-size:0.82em; margin-top:6px;">';
            html += '<tr style="background:#ffebee;"><th style="padding:4px 8px; text-align:left;">Date</th><th style="padding:4px 8px; text-align:left;">Type</th><th style="padding:4px 8px; text-align:center;">Hours</th></tr>';
            r.reliabilityEvents.forEach(function(ev) {
                html += '<tr style="border-bottom:1px solid #f0f0f0;">';
                html += '<td style="padding:4px 8px;">' + escapeHtml(ev.dateStr) + '</td>';
                html += '<td style="padding:4px 8px;">' + escapeHtml(ev.activity) + '</td>';
                html += '<td style="padding:4px 8px; text-align:center; color:#b71c1c; font-weight:600;">' + ev.hours + '</td>';
                html += '</tr>';
            });
            html += '</table></details>';
        }

        // Discrepancies (fraud flags)
        if (r.discrepancies && r.discrepancies.length > 0) {
            html += '<details open style="margin-bottom:12px;">';
            html += '<summary style="cursor:pointer; font-weight:600; color:#b71c1c; font-size:0.9em;">⚠ Discrepancies (' + r.discrepancies.length + ')</summary>';
            html += '<div style="padding:8px; background:#fff3e0; border-radius:4px; font-size:0.8em; color:#e65100; margin:6px 0;">Verint shows absence but payroll shows hours worked — may need correction.</div>';
            html += '<table style="width:100%; border-collapse:collapse; font-size:0.82em; margin-top:6px;">';
            html += '<tr style="background:#ffebee;"><th style="padding:4px 8px; text-align:left;">Date</th><th style="padding:4px 8px; text-align:left;">Verint</th><th style="padding:4px 8px; text-align:left;">Payroll</th></tr>';
            r.discrepancies.forEach(function(d) {
                html += '<tr style="border-bottom:1px solid #f0f0f0;">';
                html += '<td style="padding:4px 8px;">' + escapeHtml(d.date) + '</td>';
                html += '<td style="padding:4px 8px;">' + escapeHtml(d.verintActivity) + ' (' + d.verintHours + 'h)</td>';
                html += '<td style="padding:4px 8px;">REG ' + d.payrollHours + 'h (in: ' + escapeHtml(d.payrollClockIn) + ')</td>';
                html += '</tr>';
            });
            html += '</table></details>';
        }

        // Action buttons
        html += '<div style="display:flex; gap:10px; margin-top:12px; flex-wrap:wrap;">';

        // Email associate about PTOST designation
        var undesignated = (r.reliabilityEvents || []).filter(function(ev) {
            return ev.activity.indexOf('PTOST') < 0;
        });
        if (undesignated.length > 0 && (r.ptostBufferRemaining || 0) > 0) {
            html += '<button type="button" id="relEmailAssociate" style="padding:8px 16px; background:#1565c0; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600;">✉ Ask ' + escapeHtml(firstName) + ' about PTOST</button>';
        }

        // Email WFM about discrepancies
        if ((r.discrepancies || []).length > 0) {
            html += '<button type="button" id="relEmailWfm" style="padding:8px 16px; background:#e65100; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600;">✉ Draft WFM Correction</button>';
        }

        html += '</div>';
        html += '</div>';

        container.innerHTML = html;

        // Bind close
        document.getElementById('relCloseDetail')?.addEventListener('click', function() {
            container.style.display = 'none';
        });

        // Bind email buttons
        document.getElementById('relEmailAssociate')?.addEventListener('click', function() {
            var msg = buildPtostDesignationEmail(employeeName, undesignated);
            copyAndNotify(msg, 'PTOST email copied to clipboard');
        });

        document.getElementById('relEmailWfm')?.addEventListener('click', function() {
            var msg = buildWfmCorrectionEmail(employeeName, r.discrepancies);
            copyAndNotify(msg, 'WFM correction email copied to clipboard');
        });
    }

    function copyAndNotify(text, toastMsg) {
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).then(function() {
                if (typeof showToast === 'function') showToast(toastMsg, 3000);
            });
        }
    }

    // ============================================
    // EVENT BINDING
    // ============================================

    function bindUploadButtons(container) {
        var verintBtn = document.getElementById('relUploadVerint');
        var verintInput = document.getElementById('relVerintInput');
        var payrollBtn = document.getElementById('relUploadPayroll');
        var payrollInput = document.getElementById('relPayrollInput');

        verintBtn?.addEventListener('click', function() { verintInput?.click(); });
        verintInput?.addEventListener('change', async function() {
            var files = Array.from(this.files || []);
            if (!files.length) return;
            var loaded = 0;
            for (var i = 0; i < files.length; i++) {
                try {
                    await handleVerintUpload(files[i]);
                    loaded++;
                } catch (err) {
                    console.error('Verint upload error:', err);
                    if (typeof showToast === 'function') showToast('Error parsing ' + files[i].name + ': ' + err.message, 5000);
                }
            }
            if (loaded > 0) {
                if (typeof showToast === 'function') showToast(loaded + ' Verint file(s) loaded.', 3000);
                var dash = document.getElementById('reliabilityDashboard');
                if (dash) renderTeamTable(dash);
            }
            this.value = '';
        });

        payrollBtn?.addEventListener('click', function() { payrollInput?.click(); });
        payrollInput?.addEventListener('change', async function() {
            var file = this.files?.[0];
            if (!file) return;
            try {
                await handlePayrollUpload(file);
                if (typeof showToast === 'function') showToast('Payroll loaded.', 3000);
                var dash = document.getElementById('reliabilityDashboard');
                if (dash) renderTeamTable(dash);
            } catch (err) {
                console.error('Payroll upload error:', err);
                if (typeof showToast === 'function') showToast('Error parsing payroll: ' + err.message, 5000);
            }
            this.value = '';
        });
    }

    function bindRowClicks(container) {
        var rows = container.querySelectorAll('.rel-employee-row');
        rows.forEach(function(row) {
            row.addEventListener('click', function() {
                var name = this.getAttribute('data-name');
                var panel = document.getElementById('relDetailPanel');
                if (panel) {
                    panel.style.display = 'block';
                    renderEmployeeDetail(panel, name);
                    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
    }

    // ============================================
    // UPLOAD HANDLERS
    // ============================================

    async function handleVerintUpload(file) {
        var verint = await parseVerintExcel(file);
        if (!verint.employeeName) throw new Error('Could not find employee name in Verint file');

        var store = loadStore();
        var name = verint.employeeName;
        if (!store.employees[name]) store.employees[name] = {};

        store.employees[name].verint = verint;
        store.employees[name].hasVerint = true;

        // Reconcile with existing payroll data if present
        var payrollEntries = store.employees[name].payroll?.entries || null;
        store.employees[name].reconciled = reconcileEmployee(verint, payrollEntries);

        saveStore(store);
        return verint;
    }

    async function handlePayrollUpload(file) {
        var payrollByEmployee = await parsePayrollExcel(file);
        var store = loadStore();

        Object.keys(payrollByEmployee).forEach(function(name) {
            if (!store.employees[name]) store.employees[name] = {};
            store.employees[name].payroll = payrollByEmployee[name];
            store.employees[name].hasPayroll = true;

            // Reconcile with existing Verint data if present
            var verint = store.employees[name].verint || null;
            store.employees[name].reconciled = reconcileEmployee(verint, payrollByEmployee[name].entries);
        });

        saveStore(store);
        return payrollByEmployee;
    }

    // ============================================
    // INITIALIZE
    // ============================================

    function initialize() {
        var container = document.getElementById('reliabilityDashboard');
        if (!container) return;
        renderTeamTable(container);
    }

    // ============================================
    // MODULE EXPORT
    // ============================================

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.reliability = {
        initialize: initialize,
        handleVerintUpload: handleVerintUpload,
        handlePayrollUpload: handlePayrollUpload,
        parseVerintExcel: parseVerintExcel,
        parsePayrollExcel: parsePayrollExcel,
        reconcileEmployee: reconcileEmployee
    };
})();
