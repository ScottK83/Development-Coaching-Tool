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
        // Remove directional/zero-width marks and normalize common pasted symbols.
        return s
            .replace(/[\u202a-\u202e\u200e\u200f\u200b\ufeff]/g, '')
            .replace(/[\u2022\u25CF\u00B7\u2027\u2219\u25E6\u2043]/g, ' ')
            .trim();
    }

    function round2(n) { return Math.round(n * 100) / 100; }

    function titleCaseWords(text) {
        return String(text || '')
            .split(/\s+/)
            .filter(Boolean)
            .map(function(w) {
                var lower = w.toLowerCase();
                return lower.charAt(0).toUpperCase() + lower.slice(1);
            })
            .join(' ');
    }

    function cleanEmployeeLabel(raw) {
        return stripUnicode(String(raw || ''))
            .replace(/^employee\s*[:\-]?\s*/i, '')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function isLikelyEmployeeName(name) {
        var s = cleanEmployeeLabel(name);
        if (!s) return false;
        var lower = s.toLowerCase();
        var blocked = [
            'same day', 'time off', 'activities', 'activity', 'pre planned', 'covid',
            'duty', 'jury', 'bereavement', 'fmla', 'holiday', 'no call', 'tardy',
            'total time off', 'time off requests', 'ptost', 'absence'
        ];
        for (var i = 0; i < blocked.length; i++) {
            if (lower.indexOf(blocked[i]) >= 0) return false;
        }
        return /^[A-Za-z'\- ]+,\s*[A-Za-z'\- ]+$/.test(s) || /^[A-Za-z'\- ]+\s+[A-Za-z'\- ]+$/.test(s);
    }

    function buildEmployeeLookupKey(name) {
        var base = stripUnicode(String(name || ''))
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^A-Za-z]/g, '')
            .toLowerCase();
        return base;
    }

    function scoreNameQuality(name) {
        var s = String(name || '');
        var score = 0;
        if (s.includes(', ')) score += 4;
        if (/^[A-Za-z'\- ]+, [A-Za-z'\- ]+$/.test(s)) score += 6;
        if (!/[•●·0-9]/.test(s)) score += 3;
        return score;
    }

    function choosePreferredDisplayName(a, b) {
        if (!a) return b || '';
        if (!b) return a || '';
        return scoreNameQuality(b) > scoreNameQuality(a) ? b : a;
    }

    function splitDisplayName(name) {
        var normalized = normalizeEmployeeName(name);
        if (!normalized.includes(',')) {
            var words = normalized.split(/\s+/).filter(Boolean);
            if (words.length < 2) return { last: normalized.toLowerCase(), first: '' };
            return {
                last: words[words.length - 1].toLowerCase(),
                first: words.slice(0, -1).join(' ').toLowerCase()
            };
        }
        var parts = normalized.split(',');
        return {
            last: String(parts[0] || '').trim().toLowerCase(),
            first: String(parts[1] || '').trim().toLowerCase()
        };
    }

    function isLikelySameEmployeeName(a, b) {
        var n1 = splitDisplayName(a);
        var n2 = splitDisplayName(b);
        if (!n1.last || !n2.last || n1.last !== n2.last) return false;
        if (!n1.first || !n2.first) return false;
        if (n1.first === n2.first) return true;
        // Handles malformed imports like "Orobert" vs "Robert".
        if (n1.first.length >= 5 && n1.first.slice(1) === n2.first) return true;
        if (n2.first.length >= 5 && n2.first.slice(1) === n1.first) return true;
        return false;
    }

    function findExistingEmployeeName(store, incomingName) {
        var target = buildEmployeeLookupKey(incomingName);
        if (!target) return null;
        var names = Object.keys(store?.employees || {});
        for (var i = 0; i < names.length; i++) {
            if (buildEmployeeLookupKey(names[i]) === target) return names[i];
        }
        for (var j = 0; j < names.length; j++) {
            if (isLikelySameEmployeeName(names[j], incomingName)) return names[j];
        }
        return null;
    }

    function consolidateDuplicateEmployees(store) {
        var employees = store?.employees || {};
        var mergedByKey = {};

        Object.keys(employees).forEach(function(name) {
            if (!isLikelyEmployeeName(name)) return;
            var key = buildEmployeeLookupKey(name);
            if (!key) return;

            var cleanName = normalizeEmployeeName(name) || String(name || '').trim();
            if (!isLikelyEmployeeName(cleanName)) return;

            var incoming = employees[name] || {};
            var targetKey = key;
            if (!mergedByKey[targetKey]) {
                var existingKey = Object.keys(mergedByKey).find(function(k) {
                    return isLikelySameEmployeeName(mergedByKey[k].name, cleanName);
                });
                if (existingKey) targetKey = existingKey;
            }

            if (!mergedByKey[targetKey]) {
                mergedByKey[targetKey] = {
                    name: cleanName,
                    data: {
                        hasVerint: Boolean(incoming.hasVerint),
                        hasPayroll: Boolean(incoming.hasPayroll),
                        verint: incoming.verint || null,
                        payroll: incoming.payroll || null,
                        reconciled: incoming.reconciled || null
                    }
                };
                return;
            }

            var target = mergedByKey[targetKey];
            target.name = choosePreferredDisplayName(target.name, cleanName);
            target.data.hasVerint = target.data.hasVerint || Boolean(incoming.hasVerint);
            target.data.hasPayroll = target.data.hasPayroll || Boolean(incoming.hasPayroll);
            if (!target.data.verint && incoming.verint) target.data.verint = incoming.verint;
            if (!target.data.payroll && incoming.payroll) target.data.payroll = incoming.payroll;
            if (!target.data.reconciled && incoming.reconciled) target.data.reconciled = incoming.reconciled;
        });

        var rebuilt = {};
        Object.keys(mergedByKey).forEach(function(key) {
            var item = mergedByKey[key];
            var data = item.data;
            data.reconciled = reconcileEmployee(data.verint || null, data.payroll?.entries || null);
            rebuilt[item.name] = data;
        });

        store.employees = rebuilt;
        return store;
    }

    function normalizeEmployeeName(raw) {
        // Payroll: "ROBERT BERRELLEZA" -> "Berrelleza, Robert"
        // Verint:  "Berrelleza, Robert" (already correct)
        var s = cleanEmployeeLabel(raw)
            .replace(/[^A-Za-z,\- '\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .replace(/\s+,/g, ',')
            .replace(/,\s*/g, ', ')
            .trim();
        if (!s) return '';
        // If already "Last, First" format
        if (s.includes(',')) {
            var parts = s.split(',').map(function(p) { return p.trim(); });
            var last = titleCaseWords(parts[0] || '');
            var first = titleCaseWords(parts[1] || '');
            return [last, first].filter(Boolean).join(', ');
        }
        // "FIRST LAST" or "FIRST MIDDLE LAST"
        var words = s.split(/\s+/);
        if (words.length < 2) return s;
        var last = words[words.length - 1];
        var first = words.slice(0, -1).join(' ');
        return [titleCaseWords(last), titleCaseWords(first)].join(', ');
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
                    resolve(extractVerintData(rows, file?.name || ''));
                } catch (err) { reject(err); }
            };
            reader.onerror = function() { reject(new Error('File read error')); };
            reader.readAsArrayBuffer(file);
        });
    }

    function extractNameFromFileName(fileName) {
        var base = String(fileName || '')
            .replace(/\.[^.]+$/, '')
            .replace(/[_-]+/g, ' ')
            .replace(/\b(time\s*off|summary|report|verint|pto|attendance|employee)\b/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return base;
    }

    function findVerintEmployeeName(rows, fileName) {
        var employeeName = '';

        // Search top rows and first few columns for any "Employee:" label.
        for (var i = 0; i < Math.min(rows.length, 40); i++) {
            var row = Array.isArray(rows[i]) ? rows[i] : [];
            for (var c = 0; c < Math.min(row.length, 12); c++) {
                var cell = stripUnicode(String(row[c] || '')).trim();
                if (!cell) continue;
                var m = cell.match(/^employee\s*:\s*(.+)$/i);
                if (m && m[1]) return m[1].trim();

                if (/^employee\s*:$/i.test(cell)) {
                    var rightCell = stripUnicode(String(row[c + 1] || '')).trim();
                    if (rightCell) return rightCell;
                }
            }
        }

        // Fallback: derive employee text from filename if sheet label is missing.
        employeeName = extractNameFromFileName(fileName);
        return isLikelyEmployeeName(employeeName) ? employeeName : '';
    }

    function findColumnIndexFromHeaderRow(row, candidates) {
        if (!Array.isArray(row)) return -1;
        for (var i = 0; i < row.length; i++) {
            var h = stripUnicode(String(row[i] || ''))
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '');
            if (!h) continue;
            for (var j = 0; j < candidates.length; j++) {
                if (h === candidates[j] || h.indexOf(candidates[j]) >= 0) return i;
            }
        }
        return -1;
    }

    function extractVerintData(rows, fileName) {
        var employeeName = findVerintEmployeeName(rows, fileName);

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
        // Header row usually follows "Time Off Activities" and may shift by column.
        var events = [];
        var detailStartIdx = -1;
        for (var i = 0; i < rows.length; i++) {
            var rowLabel = stripUnicode(String(rows[i][1] || rows[i][0] || '')).trim();
            if (rowLabel === 'Time Off Activities') {
                detailStartIdx = i + 1;
                break;
            }
        }

        var activityCol = 1;
        var fromCol = 5;
        var toCol = 8;
        var hoursCol = 11;

        if (detailStartIdx > 0) {
            for (var h = detailStartIdx; h < Math.min(rows.length, detailStartIdx + 8); h++) {
                var headerRow = Array.isArray(rows[h]) ? rows[h] : [];
                var fromIdx = findColumnIndexFromHeaderRow(headerRow, ['from', 'start', 'startdate']);
                var toIdx = findColumnIndexFromHeaderRow(headerRow, ['to', 'end', 'enddate']);
                var hrsIdx = findColumnIndexFromHeaderRow(headerRow, ['lengthhours', 'hours', 'duration']);
                var actIdx = findColumnIndexFromHeaderRow(headerRow, ['timeoffactivity', 'activity', 'type']);

                if (fromIdx >= 0 || toIdx >= 0 || hrsIdx >= 0 || actIdx >= 0) {
                    if (actIdx >= 0) activityCol = actIdx;
                    if (fromIdx >= 0) fromCol = fromIdx;
                    if (toIdx >= 0) toCol = toIdx;
                    if (hrsIdx >= 0) hoursCol = hrsIdx;
                    detailStartIdx = h + 1;
                    break;
                }
            }
        }

        if (detailStartIdx > 0) {
            for (var j = detailStartIdx; j < rows.length; j++) {
                var row = rows[j];
                var activity = String(row[activityCol] || '').trim();
                // Stop at "Total Time Off" or "Time Off Requests" or empty section
                if (activity.startsWith('Total Time Off') || activity === 'Time Off Requests' || activity === '') break;

                var fromStr = String(row[fromCol] || '');
                var toStr = String(row[toCol] || '');
                var lengthStr = String(row[hoursCol] || '').trim();
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
            if (!isLikelyEmployeeName(name)) continue;
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

    // Categories for classification
    var VERINT_PTOST_TYPES = ['Same Day - Full PTOST', 'Same day - Partial PTOST', 'Tardy EQ GT 6 Min PTOST'];
    var VERINT_SAME_DAY_TYPES = ['Same Day', 'Same Day - Full PTOST', 'Same day - Partial PTOST',
        'Same Day - No Call No Show', 'Same Day - Partial', 'Tardy EQ GT 6 Min', 'Tardy EQ GT 6 Min PTOST', 'Tardy LT 6 Min'];
    var VERINT_PLANNED_TYPES = ['Pre Planned Absence', 'Holiday', 'FMLA', 'WFO-Bereavement', 'WFO-Jury/Civic/Military Duty', 'LOA', 'VTO-PTO'];

    function classifyVerintEvent(activity) {
        if (VERINT_PTOST_TYPES.indexOf(activity) >= 0) return 'ptost';
        if (activity === 'Same Day' || activity === 'Same Day - Partial' || activity === 'Same Day - No Call No Show') return 'same-day';
        if (activity.indexOf('Tardy') === 0 && activity.indexOf('PTOST') < 0) return 'tardy';
        if (activity.indexOf('Tardy') === 0 && activity.indexOf('PTOST') >= 0) return 'tardy-ptost';
        if (VERINT_PLANNED_TYPES.indexOf(activity) >= 0) return 'planned';
        return 'other';
    }

    function reconcileEmployee(verintData, payrollEntries) {
        var result = {
            ptostHoursUsed: 0,
            ptostBufferRemaining: PTOST_BUFFER_LIMIT,
            reliabilityHours: 0,
            timeline: [],           // Unified day-by-day timeline
            discrepancies: [],      // Verint says absent but payroll says worked
            dayBuckets: {
                sameDay: [],
                sameDayPtost: [],
                bereavement: [],
                fmla: []
            }
        };

        // Build a date-keyed map of all events from both sources
        var dateMap = {}; // key: YYYY-MM-DD -> { verint: [], payroll: [] }

        function dateKey(d) {
            if (!d) return null;
            if (typeof d === 'string') d = new Date(d);
            return d.toISOString().slice(0, 10);
        }

        // Add Verint events
        if (verintData && verintData.events) {
            verintData.events.forEach(function(ev) {
                var k = dateKey(ev.from);
                if (!k) return;
                if (!dateMap[k]) dateMap[k] = { verint: [], payroll: [] };
                dateMap[k].verint.push({
                    activity: ev.activity,
                    hours: ev.hours,
                    type: classifyVerintEvent(ev.activity)
                });
            });
        }

        // Add Payroll entries
        if (payrollEntries && payrollEntries.length) {
            payrollEntries.forEach(function(entry) {
                var k = dateKey(entry.date);
                if (!k) return;
                if (!dateMap[k]) dateMap[k] = { verint: [], payroll: [] };
                dateMap[k].payroll.push({
                    trc: entry.trc,
                    quantity: entry.quantity,
                    taskCode: entry.taskCode,
                    clockIn: entry.clockIn,
                    clockOut: entry.clockOut
                });
            });
        }

        // Walk dates chronologically and build timeline
        var sortedDates = Object.keys(dateMap).sort();
        var runningPtost = 0;

        sortedDates.forEach(function(dk) {
            var day = dateMap[dk];
            var verintItems = day.verint;
            var payrollItems = day.payroll;

            // Skip days that are only REG worked (no time off)
            var hasTimeOff = verintItems.length > 0 ||
                payrollItems.some(function(p) { return p.trc !== 'REG'; });
            if (!hasTimeOff) return;

            var entry = {
                date: dk,
                dateStr: formatDate(new Date(dk + 'T12:00:00')),
                verint: verintItems,
                payroll: payrollItems,
                flags: []
            };

            // --- Determine what happened on this day ---

            // Payroll PTOST on this day
            var payrollPtost = payrollItems.filter(function(p) { return p.trc === 'PTOST'; });
            var payrollPtostHours = payrollPtost.reduce(function(s, p) { return s + p.quantity; }, 0);

            // Payroll PTO with UNSCHD task code
            var payrollUnschd = payrollItems.filter(function(p) { return p.trc === 'PTO' && p.taskCode === 'UNSCHD'; });
            var payrollUnschdHours = payrollUnschd.reduce(function(s, p) { return s + p.quantity; }, 0);

            // Payroll PTO without UNSCHD (planned PTO)
            var payrollPlannedPto = payrollItems.filter(function(p) { return p.trc === 'PTO' && p.taskCode !== 'UNSCHD'; });

            // Payroll other leave types
            var payrollOtherLeave = payrollItems.filter(function(p) {
                return ['BRV', 'FMLNP', 'STD', 'PPL', 'NOP'].indexOf(p.trc) >= 0;
            });

            // Payroll REG with clock times
            var payrollReg = payrollItems.filter(function(p) { return p.trc === 'REG' && p.clockIn; });

            // Verint same-day (unscheduled) events
            var verintSameDay = verintItems.filter(function(v) { return v.type === 'same-day' || v.type === 'ptost' || v.type === 'tardy' || v.type === 'tardy-ptost'; });
            var verintPtost = verintItems.filter(function(v) { return v.type === 'ptost' || v.type === 'tardy-ptost'; });
            var verintSameDayNoPtost = verintItems.filter(function(v) { return v.type === 'same-day' || v.type === 'tardy'; });

            var isSameDay = payrollUnschdHours > 0 || verintSameDayNoPtost.length > 0;
            var isSameDayPtost = payrollPtostHours > 0 || verintPtost.length > 0;
            var isBereavement = payrollItems.some(function(p) { return p.trc === 'BRV'; }) ||
                verintItems.some(function(v) { return String(v.activity || '').toLowerCase().includes('bereavement'); });
            var isFmla = payrollItems.some(function(p) { return p.trc === 'FMLA' || p.trc === 'FMLNP'; }) ||
                verintItems.some(function(v) { return String(v.activity || '').toLowerCase().includes('fmla'); });

            if (isSameDay) result.dayBuckets.sameDay.push(formatDate(new Date(dk + 'T12:00:00')));
            if (isSameDayPtost) result.dayBuckets.sameDayPtost.push(formatDate(new Date(dk + 'T12:00:00')));
            if (isBereavement) result.dayBuckets.bereavement.push(formatDate(new Date(dk + 'T12:00:00')));
            if (isFmla) result.dayBuckets.fmla.push(formatDate(new Date(dk + 'T12:00:00')));

            // --- Track PTOST running total ---
            if (payrollPtostHours > 0) {
                runningPtost = round2(runningPtost + payrollPtostHours);
                entry.ptostRunning = runningPtost;
                entry.ptostProtected = runningPtost <= PTOST_BUFFER_LIMIT;

                if (runningPtost > PTOST_BUFFER_LIMIT) {
                    var overage = round2(Math.min(payrollPtostHours, runningPtost - PTOST_BUFFER_LIMIT));
                    entry.ptostOverage = overage;
                    result.reliabilityHours = round2(result.reliabilityHours + overage);
                    entry.flags.push('PTOST over 40h buffer (+' + overage + 'h reliability)');
                }
            } else if (verintItems.some(function(v) { return v.type === 'ptost' || v.type === 'tardy-ptost'; })) {
                // Verint shows PTOST but payroll doesn't — track from Verint
                var verintPtostHours = verintItems.filter(function(v) { return v.type === 'ptost' || v.type === 'tardy-ptost'; })
                    .reduce(function(s, v) { return s + v.hours; }, 0);
                runningPtost = round2(runningPtost + verintPtostHours);
                entry.ptostRunning = runningPtost;
                entry.ptostProtected = runningPtost <= PTOST_BUFFER_LIMIT;
            }

            // --- PTO+UNSCHD counts against reliability ---
            if (payrollUnschdHours > 0) {
                result.reliabilityHours = round2(result.reliabilityHours + payrollUnschdHours);
                entry.flags.push('Unscheduled PTO (' + payrollUnschdHours + 'h against reliability)');
            }

            // --- Discrepancy: Verint says Same Day absent but payroll shows REG ---
            if (verintSameDay.length > 0 && payrollReg.length > 0 && payrollPtostHours === 0 && payrollUnschdHours === 0 && payrollPlannedPto.length === 0) {
                var verintHrs = verintSameDay.reduce(function(s, v) { return s + v.hours; }, 0);
                var regHrs = payrollReg.reduce(function(s, p) { return s + p.quantity; }, 0);
                entry.flags.push('⚠ DISCREPANCY: Verint says absent, Payroll shows worked');
                result.discrepancies.push({
                    date: entry.dateStr,
                    verintActivity: verintSameDay.map(function(v) { return v.activity; }).join(', '),
                    verintHours: verintHrs,
                    payrollHours: regHrs,
                    payrollClockIn: payrollReg[0].clockIn
                });
            }

            // Classify the day for display
            if (payrollPtostHours > 0 || verintItems.some(function(v) { return v.type === 'ptost' || v.type === 'tardy-ptost'; })) {
                entry.category = 'ptost';
            } else if (payrollUnschdHours > 0 || verintItems.some(function(v) { return v.type === 'same-day' || v.type === 'tardy'; })) {
                entry.category = 'same-day';
            } else if (payrollOtherLeave.length > 0 || verintItems.some(function(v) { return v.type === 'planned'; })) {
                entry.category = 'planned';
            } else if (payrollPlannedPto.length > 0) {
                entry.category = 'planned';
            } else {
                entry.category = 'other';
            }

            result.timeline.push(entry);
        });

        result.ptostHoursUsed = round2(runningPtost);
        result.ptostBufferRemaining = round2(Math.max(0, PTOST_BUFFER_LIMIT - runningPtost));

        Object.keys(result.dayBuckets).forEach(function(key) {
            result.dayBuckets[key] = Array.from(new Set(result.dayBuckets[key] || []));
        });

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

    function summarizeDateList(list) {
        var dates = Array.isArray(list) ? list : [];
        if (!dates.length) return '—';
        if (dates.length <= 3) return dates.join(', ');
        return dates.slice(0, 3).join(', ') + ' (+' + (dates.length - 3) + ')';
    }

    function getReliabilityNamesByTeamFilter(allNames) {
        var names = Array.isArray(allNames) ? allNames : [];
        var tf = window.DevCoachModules?.teamFilter;
        if (!tf?.getTeamSelectionContext) return names;

        var ctx = tf.getTeamSelectionContext();
        if (!ctx?.isFiltering || !Array.isArray(ctx.selectedMembers) || !ctx.selectedMembers.length) return names;

        var selectedExact = new Set(ctx.selectedMembers.map(function(n) { return String(n || '').trim().toLowerCase(); }).filter(Boolean));
        var selectedLookup = new Set(ctx.selectedMembers.map(function(n) {
            return buildEmployeeLookupKey(normalizeEmployeeName(n || ''));
        }).filter(Boolean));

        function getFirstToken(name) {
            var s = String(name || '').trim();
            if (!s) return '';
            if (s.includes(',')) return String(s.split(',')[1] || '').trim().split(/\s+/)[0].toLowerCase();
            return s.split(/\s+/)[0].toLowerCase();
        }

        return names.filter(function(name) {
            var raw = String(name || '').trim();
            var exact = raw.toLowerCase();
            var lookup = buildEmployeeLookupKey(normalizeEmployeeName(raw));
            var first = getFirstToken(raw);
            return selectedExact.has(exact) || selectedLookup.has(lookup) || selectedExact.has(first);
        });
    }

    function buildAllEmployeesDayTable(employees) {
        var rows = [];

        Object.keys(employees || {}).forEach(function(name) {
            var emp = employees[name] || {};
            var r = emp.reconciled || {};
            var timeline = r.timeline || [];
            var buckets = r.dayBuckets || {};
            var sameDaySet = new Set(buckets.sameDay || []);
            var sameDayPtostSet = new Set(buckets.sameDayPtost || []);
            var bereavementSet = new Set(buckets.bereavement || []);
            var fmlaSet = new Set(buckets.fmla || []);

            timeline.forEach(function(t) {
                var verintText = (t.verint || []).map(function(v) {
                    return v.activity + ' (' + v.hours + 'h)';
                }).join('; ') || '—';

                var payrollText = (t.payroll || []).filter(function(p) { return p.trc !== 'REG'; }).map(function(p) {
                    var label = p.trc;
                    if (p.taskCode) label += ' / ' + p.taskCode;
                    return label + ' (' + p.quantity + 'h)';
                }).join('; ');
                if (!payrollText) payrollText = '—';

                var totalHours = 0;
                (t.verint || []).forEach(function(v) { totalHours += Number(v.hours || 0); });
                var payrollNonReg = (t.payroll || []).filter(function(p) { return p.trc !== 'REG'; });
                if (payrollNonReg.length > 0) {
                    totalHours = payrollNonReg.reduce(function(sum, p) { return sum + Number(p.quantity || 0); }, 0);
                }

                rows.push({
                    date: t.dateStr || '',
                    dateKey: t.date || '',
                    employee: name,
                    sameDay: sameDaySet.has(t.dateStr || ''),
                    sameDayPtost: sameDayPtostSet.has(t.dateStr || ''),
                    bereavement: bereavementSet.has(t.dateStr || ''),
                    fmla: fmlaSet.has(t.dateStr || ''),
                    verint: verintText,
                    payroll: payrollText,
                    hours: round2(totalHours),
                    flags: (t.flags || []).join('; ')
                });
            });
        });

        rows.sort(function(a, b) {
            if (a.dateKey === b.dateKey) return a.employee.localeCompare(b.employee);
            return String(a.dateKey).localeCompare(String(b.dateKey)) * -1;
        });

        var html = '';
        html += '<div id="relAllEmployeesLedger" style="margin-top:16px;">';
        html += '<h4 style="margin:0 0 8px 0; color:#00695c;">Day-by-Day Breakdown (All Employees)</h4>';
        html += '<div style="font-size:0.8em; color:#666; margin-bottom:8px;">Use this to match exact dates across associates.</div>';

        if (!rows.length) {
            html += '<div style="padding:12px; border:1px solid #e0e0e0; border-radius:6px; color:#777;">No day-level events yet.</div>';
            html += '</div>';
            return html;
        }

        var minKey = rows[rows.length - 1].dateKey;
        var maxKey = rows[0].dateKey;

        html += '<div style="display:flex; gap:8px; align-items:end; flex-wrap:wrap; margin-bottom:8px;">';
        html += '<div><label style="display:block; font-size:0.76em; color:#555; margin-bottom:2px;">From</label><input type="date" id="relLedgerFrom" min="' + escapeHtml(minKey) + '" max="' + escapeHtml(maxKey) + '" style="padding:5px 8px; border:1px solid #cdd; border-radius:4px;"></div>';
        html += '<div><label style="display:block; font-size:0.76em; color:#555; margin-bottom:2px;">To</label><input type="date" id="relLedgerTo" min="' + escapeHtml(minKey) + '" max="' + escapeHtml(maxKey) + '" style="padding:5px 8px; border:1px solid #cdd; border-radius:4px;"></div>';
        html += '<button type="button" id="relLedgerApply" style="padding:6px 10px; border:1px solid #00695c; background:#00695c; color:#fff; border-radius:4px; cursor:pointer;">Apply</button>';
        html += '<button type="button" id="relLedgerClear" style="padding:6px 10px; border:1px solid #ccc; background:#fff; color:#333; border-radius:4px; cursor:pointer;">Clear</button>';
        html += '<div id="relLedgerCount" style="font-size:0.8em; color:#555; margin-left:auto;">Rows: ' + rows.length + '</div>';
        html += '</div>';

        html += '<div style="max-height:360px; overflow:auto; border:1px solid #dfe6e6; border-radius:6px;">';
        html += '<table style="width:100%; border-collapse:collapse; font-size:0.82em;">';
        html += '<thead><tr style="position:sticky; top:0; background:#ecf6f5; z-index:1;">';
        html += '<th style="padding:6px 8px; text-align:left; border-bottom:1px solid #c8dedd;">Date</th>';
        html += '<th style="padding:6px 8px; text-align:left; border-bottom:1px solid #c8dedd;">Employee</th>';
        html += '<th style="padding:6px 8px; text-align:center; border-bottom:1px solid #c8dedd;">Same Day</th>';
        html += '<th style="padding:6px 8px; text-align:center; border-bottom:1px solid #c8dedd;">Same Day PTOST</th>';
        html += '<th style="padding:6px 8px; text-align:center; border-bottom:1px solid #c8dedd;">Bereavement</th>';
        html += '<th style="padding:6px 8px; text-align:center; border-bottom:1px solid #c8dedd;">FMLA</th>';
        html += '<th style="padding:6px 8px; text-align:left; border-bottom:1px solid #c8dedd;">Verint</th>';
        html += '<th style="padding:6px 8px; text-align:left; border-bottom:1px solid #c8dedd;">Payroll</th>';
        html += '<th style="padding:6px 8px; text-align:center; border-bottom:1px solid #c8dedd;">Hours</th>';
        html += '<th style="padding:6px 8px; text-align:left; border-bottom:1px solid #c8dedd;">Flags</th>';
        html += '</tr></thead><tbody>';

        rows.forEach(function(row) {
            html += '<tr class="rel-ledger-row" data-date-key="' + escapeHtml(row.dateKey) + '" style="border-bottom:1px solid #eef2f2;">';
            html += '<td style="padding:6px 8px; white-space:nowrap;">' + escapeHtml(row.date) + '</td>';
            html += '<td style="padding:6px 8px; white-space:nowrap; font-weight:600;">' + escapeHtml(row.employee) + '</td>';
            html += '<td style="padding:6px 8px; text-align:center;">' + (row.sameDay ? '✓' : '—') + '</td>';
            html += '<td style="padding:6px 8px; text-align:center;">' + (row.sameDayPtost ? '✓' : '—') + '</td>';
            html += '<td style="padding:6px 8px; text-align:center;">' + (row.bereavement ? '✓' : '—') + '</td>';
            html += '<td style="padding:6px 8px; text-align:center;">' + (row.fmla ? '✓' : '—') + '</td>';
            html += '<td style="padding:6px 8px; min-width:190px;">' + escapeHtml(row.verint) + '</td>';
            html += '<td style="padding:6px 8px; min-width:190px;">' + escapeHtml(row.payroll) + '</td>';
            html += '<td style="padding:6px 8px; text-align:center;">' + row.hours + '</td>';
            html += '<td style="padding:6px 8px; min-width:180px; color:#666;">' + escapeHtml(row.flags || '—') + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div></div>';
        return html;
    }

    function bindAllEmployeesLedgerFilters(container) {
        var fromInput = container.querySelector('#relLedgerFrom');
        var toInput = container.querySelector('#relLedgerTo');
        var applyBtn = container.querySelector('#relLedgerApply');
        var clearBtn = container.querySelector('#relLedgerClear');
        var countEl = container.querySelector('#relLedgerCount');
        var rows = Array.from(container.querySelectorAll('.rel-ledger-row'));
        if (!fromInput || !toInput || !applyBtn || !clearBtn || !rows.length) return;

        function applyFilter() {
            var fromVal = fromInput.value || '';
            var toVal = toInput.value || '';
            var visible = 0;

            rows.forEach(function(row) {
                var key = row.getAttribute('data-date-key') || '';
                var keep = true;
                if (fromVal && key < fromVal) keep = false;
                if (toVal && key > toVal) keep = false;
                row.style.display = keep ? '' : 'none';
                if (keep) visible++;
            });

            if (countEl) countEl.textContent = 'Rows: ' + visible + ' / ' + rows.length;
        }

        applyBtn.addEventListener('click', applyFilter);
        clearBtn.addEventListener('click', function() {
            fromInput.value = '';
            toInput.value = '';
            rows.forEach(function(row) { row.style.display = ''; });
            if (countEl) countEl.textContent = 'Rows: ' + rows.length;
        });
    }

    function renderTeamTable(container) {
        var store = loadStore();
        consolidateDuplicateEmployees(store);
        var employees = store.employees || {};
        var names = getReliabilityNamesByTeamFilter(Object.keys(employees)).sort();

        var html = '';
        html += '<div style="margin-bottom:16px;">';
        html += '<h3 style="margin:0 0 12px 0; color:#00695c;">📋 Reliability Tracker</h3>';
        html += '<p style="font-size:0.88em; color:#666; margin-bottom:16px;">Upload files in the Upload section.</p>';

        html += '<div style="display:flex; gap:10px; align-items:end; flex-wrap:wrap; margin-bottom:10px;">';
        html += '<div>';
        html += '<label style="display:block; font-size:0.78em; color:#555; margin-bottom:2px;">Employee breakdown</label>';
        html += '<select id="relEmployeeSelect" style="padding:6px 10px; border:1px solid #cdd; border-radius:4px; min-width:260px;">';
        html += '<option value="">Select employee...</option>';
        names.forEach(function(name) {
            html += '<option value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</option>';
        });
        html += '</select>';
        html += '</div>';
        html += '<button type="button" id="relOpenLedger" style="padding:6px 10px; border:1px solid #ccc; background:#fff; color:#333; border-radius:4px; cursor:pointer;">Show All-Employees Day-by-Day</button>';
        html += '<div style="font-size:0.78em; color:#666;">Tip: click a row or use the dropdown for one-employee drill-down.</div>';
        html += '</div>';

        if (names.length === 0) {
            html += '<div style="padding:20px; background:#f5f5f5; border-radius:8px; text-align:center; color:#666;">';
            html += 'No data yet. Upload Verint and/or Payroll files to get started.';
            html += '</div>';
            html += '</div>';
            container.innerHTML = html;
            return;
        }

        // Summary table
        html += '<div style="overflow-x:auto;">';
        html += '<table style="width:100%; border-collapse:collapse; font-size:0.88em;">';
        html += '<thead><tr style="background:#e0f2f1; color:#00695c;">';
        html += '<th style="padding:8px; text-align:left; border-bottom:2px solid #00695c;">Employee</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">Same Day</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">Same Day PTOST</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">Bereavement</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">FMLA</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">PTOST Used</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">Buffer Left</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">Reliability Hours</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">Tier</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">Discrepancies</th>';
        html += '<th style="padding:8px; text-align:center; border-bottom:2px solid #00695c;">Data Source</th>';
        html += '</tr></thead><tbody>';

        names.forEach(function(name) {
            var emp = employees[name];
            var r = emp.reconciled || {};
            var tier = getTierInfo(r.reliabilityHours || 0);
            var discCount = (r.discrepancies || []).length;
            var buckets = r.dayBuckets || {};
            var sameDayDates = buckets.sameDay || [];
            var sameDayPtostDates = buckets.sameDayPtost || [];
            var bereavementDates = buckets.bereavement || [];
            var fmlaDates = buckets.fmla || [];

            html += '<tr style="border-bottom:1px solid #e0e0e0; cursor:pointer;" class="rel-employee-row" data-name="' + escapeHtml(name) + '">';
            html += '<td style="padding:8px; font-weight:600;">' + escapeHtml(name) + '</td>';
            html += '<td style="padding:8px; text-align:center;" title="' + escapeHtml(summarizeDateList(sameDayDates)) + '">' + sameDayDates.length + '</td>';
            html += '<td style="padding:8px; text-align:center;" title="' + escapeHtml(summarizeDateList(sameDayPtostDates)) + '">' + sameDayPtostDates.length + '</td>';
            html += '<td style="padding:8px; text-align:center;" title="' + escapeHtml(summarizeDateList(bereavementDates)) + '">' + bereavementDates.length + '</td>';
            html += '<td style="padding:8px; text-align:center;" title="' + escapeHtml(summarizeDateList(fmlaDates)) + '">' + fmlaDates.length + '</td>';
            html += '<td style="padding:8px; text-align:center;">' + (r.ptostHoursUsed || 0) + 'h</td>';
            html += '<td style="padding:8px; text-align:center;">' + (r.ptostBufferRemaining !== undefined ? r.ptostBufferRemaining : PTOST_BUFFER_LIMIT) + 'h</td>';
            html += '<td style="padding:8px; text-align:center; font-weight:700; color:' + tier.color + ';">' + (r.reliabilityHours || 0) + 'h</td>';
            html += '<td style="padding:8px; text-align:center;"><span style="padding:2px 8px; border-radius:4px; background:' + tier.bg + '; color:' + tier.color + '; font-weight:600; font-size:0.85em;">' + tier.label + '</span></td>';
            html += '<td style="padding:8px; text-align:center;">' + (discCount > 0 ? '<span style="color:#b71c1c; font-weight:700;">⚠ ' + discCount + '</span>' : '✓') + '</td>';

            var sourceLabel = 'None';
            if (emp.hasVerint && emp.hasPayroll) sourceLabel = 'Matched';
            else if (emp.hasVerint) sourceLabel = 'Verint only';
            else if (emp.hasPayroll) sourceLabel = 'Payroll only';
            var sourceColor = sourceLabel === 'Matched' ? '#2e7d32' : '#e65100';
            html += '<td style="padding:8px; text-align:center; font-size:0.8em; color:' + sourceColor + '; font-weight:600;">' + sourceLabel + '</td>';
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        html += '<div id="relLedgerWrap" style="display:none;">' + buildAllEmployeesDayTable(employees) + '</div>';

        // Detail panel (shown when clicking a row)
        html += '<div id="relDetailPanel" style="display:none; margin-top:16px;"></div>';
        html += '</div>';

        container.innerHTML = html;
        bindRowClicks(container);
        bindReliabilityControls(container);
        bindAllEmployeesLedgerFilters(container);
    }

    // Category display config
    var CAT_STYLES = {
        'ptost':    { label: 'PTOST',       bg: '#e8f5e9', color: '#2e7d32', icon: '🛡' },
        'same-day': { label: 'Same Day',    bg: '#ffebee', color: '#b71c1c', icon: '⚠' },
        'tardy':    { label: 'Tardy',       bg: '#fff3e0', color: '#e65100', icon: '⏰' },
        'planned':  { label: 'Planned',     bg: '#e3f2fd', color: '#0d47a1', icon: '📅' },
        'other':    { label: 'Other',       bg: '#f5f5f5', color: '#666',    icon: '—' }
    };

    function renderEmployeeDetail(container, employeeName) {
        var store = loadStore();
        var emp = store.employees?.[employeeName];
        if (!emp) { container.innerHTML = ''; return; }
        var r = emp.reconciled || {};
        var tier = getTierInfo(r.reliabilityHours || 0);
        var firstName = getFirstName(employeeName);
        var timeline = r.timeline || [];
        var buckets = r.dayBuckets || {};
        var sameDayDates = buckets.sameDay || [];
        var sameDayPtostDates = buckets.sameDayPtost || [];
        var bereavementDates = buckets.bereavement || [];
        var fmlaDates = buckets.fmla || [];

        var html = '';
        html += '<div style="padding:16px; background:#fff; border-radius:8px; border:1px solid #e0e0e0;">';

        // Header
        html += '<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">';
        html += '<h4 style="margin:0; color:#00695c;">' + escapeHtml(employeeName) + '</h4>';
        html += '<button type="button" id="relCloseDetail" style="padding:4px 12px; border:1px solid #ccc; background:#fff; border-radius:4px; cursor:pointer;">✕ Close</button>';
        html += '</div>';

        var sourceLabel = emp.hasVerint && emp.hasPayroll ? 'Matched' : (emp.hasVerint ? 'Verint only' : (emp.hasPayroll ? 'Payroll only' : 'None'));
        var sourceBg = sourceLabel === 'Matched' ? '#e8f5e9' : '#fff3e0';
        var sourceColor = sourceLabel === 'Matched' ? '#2e7d32' : '#e65100';
        var sourceNote = sourceLabel === 'Payroll only'
            ? 'No Verint file matched this employee in the current data.'
            : (sourceLabel === 'Verint only'
                ? 'No Payroll row matched this employee in the current data.'
                : 'Verint and Payroll are both matched for this employee.');
        html += '<div style="margin-bottom:12px; padding:8px 10px; border-radius:6px; background:' + sourceBg + '; color:' + sourceColor + '; font-size:0.83em; border:1px solid #e0e0e0;">';
        html += '<strong>Data Source:</strong> ' + sourceLabel + ' • ' + escapeHtml(sourceNote);
        html += '</div>';

        // Status cards
        html += '<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-bottom:16px;">';
        html += '<div style="padding:10px; background:#e0f2f1; border-radius:6px; text-align:center;"><div style="font-size:1.3em; font-weight:700; color:#00695c;">' + (r.ptostHoursUsed || 0) + 'h</div><div style="font-size:0.75em; color:#666;">PTOST Used</div></div>';
        html += '<div style="padding:10px; background:#e3f2fd; border-radius:6px; text-align:center;"><div style="font-size:1.3em; font-weight:700; color:#0d47a1;">' + (r.ptostBufferRemaining !== undefined ? r.ptostBufferRemaining : PTOST_BUFFER_LIMIT) + 'h</div><div style="font-size:0.75em; color:#666;">Buffer Left</div></div>';
        html += '<div style="padding:10px; background:' + tier.bg + '; border-radius:6px; text-align:center;"><div style="font-size:1.3em; font-weight:700; color:' + tier.color + ';">' + (r.reliabilityHours || 0) + 'h</div><div style="font-size:0.75em; color:#666;">Against Reliability</div></div>';
        html += '<div style="padding:10px; background:' + tier.bg + '; border-radius:6px; text-align:center;"><div style="font-size:1.3em; font-weight:700; color:' + tier.color + ';">' + tier.label + '</div><div style="font-size:0.75em; color:#666;">Tier</div></div>';
        html += '</div>';

        html += '<div style="margin-bottom:14px; padding:10px; background:#f9fbfb; border:1px solid #d9ecea; border-radius:6px; font-size:0.84em;">';
        html += '<div style="font-weight:700; color:#00695c; margin-bottom:6px;">Attendance Day Breakdown</div>';
        html += '<div><strong>Same Day:</strong> ' + (sameDayDates.length ? escapeHtml(sameDayDates.join(', ')) : '—') + '</div>';
        html += '<div><strong>Same Day PTOST:</strong> ' + (sameDayPtostDates.length ? escapeHtml(sameDayPtostDates.join(', ')) : '—') + '</div>';
        html += '<div><strong>Bereavement:</strong> ' + (bereavementDates.length ? escapeHtml(bereavementDates.join(', ')) : '—') + '</div>';
        html += '<div><strong>FMLA:</strong> ' + (fmlaDates.length ? escapeHtml(fmlaDates.join(', ')) : '—') + '</div>';
        html += '</div>';

        // PTOST buffer bar
        var pctUsed = Math.min(100, ((r.ptostHoursUsed || 0) / PTOST_BUFFER_LIMIT) * 100);
        var barColor = pctUsed >= 100 ? '#b71c1c' : pctUsed >= 75 ? '#e65100' : '#2e7d32';
        html += '<div style="margin-bottom:16px;">';
        html += '<div style="font-size:0.82em; font-weight:600; margin-bottom:4px;">PTOST Buffer (' + (r.ptostHoursUsed || 0) + ' / ' + PTOST_BUFFER_LIMIT + 'h)</div>';
        html += '<div style="height:12px; background:#e0e0e0; border-radius:6px; overflow:hidden;">';
        html += '<div style="height:100%; width:' + pctUsed + '%; background:' + barColor + '; border-radius:6px; transition:width 0.3s;"></div>';
        html += '</div></div>';

        // Filter tabs
        html += '<div style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap;">';
        html += '<button type="button" class="rel-filter-btn" data-filter="all" style="padding:4px 12px; border:1px solid #00695c; background:#00695c; color:#fff; border-radius:4px; cursor:pointer; font-size:0.82em; font-weight:600;">All (' + timeline.length + ')</button>';
        var catCounts = { ptost: 0, 'same-day': 0, planned: 0 };
        timeline.forEach(function(t) { if (catCounts[t.category] !== undefined) catCounts[t.category]++; });
        html += '<button type="button" class="rel-filter-btn" data-filter="same-day" style="padding:4px 12px; border:1px solid #b71c1c; background:#fff; color:#b71c1c; border-radius:4px; cursor:pointer; font-size:0.82em;">Same Day (' + catCounts['same-day'] + ')</button>';
        html += '<button type="button" class="rel-filter-btn" data-filter="ptost" style="padding:4px 12px; border:1px solid #2e7d32; background:#fff; color:#2e7d32; border-radius:4px; cursor:pointer; font-size:0.82em;">PTOST (' + catCounts.ptost + ')</button>';
        html += '<button type="button" class="rel-filter-btn" data-filter="planned" style="padding:4px 12px; border:1px solid #0d47a1; background:#fff; color:#0d47a1; border-radius:4px; cursor:pointer; font-size:0.82em;">Planned (' + catCounts.planned + ')</button>';
        if ((r.discrepancies || []).length > 0) {
            html += '<button type="button" class="rel-filter-btn" data-filter="discrepancy" style="padding:4px 12px; border:1px solid #e65100; background:#fff; color:#e65100; border-radius:4px; cursor:pointer; font-size:0.82em;">Discrepancies (' + r.discrepancies.length + ')</button>';
        }
        html += '</div>';

        // Day-by-day timeline table
        html += '<div id="relTimelineTable">';
        html += buildTimelineTable(timeline, r.discrepancies || [], 'all');
        html += '</div>';

        // Action buttons
        html += '<div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap;">';

        // Unscheduled events that could be designated as PTOST
        var undesignated = timeline.filter(function(t) {
            return t.category === 'same-day' && (r.ptostBufferRemaining || 0) > 0;
        });
        if (undesignated.length > 0) {
            html += '<button type="button" id="relEmailAssociate" style="padding:8px 16px; background:#1565c0; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600;">✉ Ask ' + escapeHtml(firstName) + ' about PTOST</button>';
        }

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

        // Bind filter tabs
        container.querySelectorAll('.rel-filter-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var filter = this.getAttribute('data-filter');
                // Update active button style
                container.querySelectorAll('.rel-filter-btn').forEach(function(b) {
                    b.style.background = '#fff';
                    b.style.fontWeight = 'normal';
                });
                this.style.background = this.style.borderColor;
                this.style.color = '#fff';
                this.style.fontWeight = '600';
                // Re-render table
                var tableDiv = document.getElementById('relTimelineTable');
                if (tableDiv) tableDiv.innerHTML = buildTimelineTable(timeline, r.discrepancies || [], filter);
            });
        });

        // Bind email buttons
        document.getElementById('relEmailAssociate')?.addEventListener('click', function() {
            var events = undesignated.map(function(t) {
                var hrs = 0;
                // Get hours from Verint same-day or payroll UNSCHD
                t.verint.forEach(function(v) { if (v.type === 'same-day' || v.type === 'tardy') hrs += v.hours; });
                t.payroll.forEach(function(p) { if (p.trc === 'PTO' && p.taskCode === 'UNSCHD') hrs += p.quantity; });
                var activities = t.verint.map(function(v) { return v.activity; }).join(', ') || 'Unscheduled PTO';
                return { dateStr: t.dateStr, hours: hrs || 8, activity: activities };
            });
            var msg = buildPtostDesignationEmail(employeeName, events);
            copyAndNotify(msg, 'PTOST email copied to clipboard');
        });

        document.getElementById('relEmailWfm')?.addEventListener('click', function() {
            var msg = buildWfmCorrectionEmail(employeeName, r.discrepancies);
            copyAndNotify(msg, 'WFM correction email copied to clipboard');
        });
    }

    function buildTimelineTable(timeline, discrepancies, filter) {
        var filtered = timeline;
        if (filter === 'discrepancy') {
            var discDates = {};
            discrepancies.forEach(function(d) { discDates[d.date] = true; });
            filtered = timeline.filter(function(t) { return discDates[t.dateStr]; });
        } else if (filter !== 'all') {
            filtered = timeline.filter(function(t) { return t.category === filter; });
        }

        if (filtered.length === 0) {
            return '<div style="padding:16px; text-align:center; color:#999; font-size:0.9em;">No events for this filter.</div>';
        }

        var html = '<table style="width:100%; border-collapse:collapse; font-size:0.82em;">';
        html += '<thead><tr style="background:#f5f5f5;">';
        html += '<th style="padding:6px 8px; text-align:left; border-bottom:2px solid #ccc;">Date</th>';
        html += '<th style="padding:6px 8px; text-align:left; border-bottom:2px solid #ccc;">Type</th>';
        html += '<th style="padding:6px 8px; text-align:left; border-bottom:2px solid #ccc;">Verint</th>';
        html += '<th style="padding:6px 8px; text-align:left; border-bottom:2px solid #ccc;">Payroll</th>';
        html += '<th style="padding:6px 8px; text-align:center; border-bottom:2px solid #ccc;">Hours</th>';
        html += '<th style="padding:6px 8px; text-align:center; border-bottom:2px solid #ccc;">PTOST Running</th>';
        html += '<th style="padding:6px 8px; text-align:left; border-bottom:2px solid #ccc;">Flags</th>';
        html += '</tr></thead><tbody>';

        filtered.forEach(function(t) {
            var cat = CAT_STYLES[t.category] || CAT_STYLES.other;
            var hasFlag = t.flags && t.flags.length > 0;
            var rowBg = hasFlag && t.flags.some(function(f) { return f.indexOf('DISCREPANCY') >= 0; }) ? '#fff8e1' : '';

            // Verint column
            var verintText = t.verint.map(function(v) { return v.activity + ' (' + v.hours + 'h)'; }).join('<br>') || '<span style="color:#999;">—</span>';

            // Payroll column
            var payrollText = t.payroll.filter(function(p) { return p.trc !== 'REG'; }).map(function(p) {
                var label = p.trc;
                if (p.taskCode) label += ' / ' + p.taskCode;
                return label + ' (' + p.quantity + 'h)';
            }).join('<br>');
            // Also show if they clocked in on a same-day
            var regEntries = t.payroll.filter(function(p) { return p.trc === 'REG' && p.clockIn; });
            if (regEntries.length > 0 && t.category !== 'planned') {
                var regLabel = regEntries.map(function(p) { return 'REG ' + p.quantity + 'h (in: ' + p.clockIn + ')'; }).join('<br>');
                payrollText = payrollText ? payrollText + '<br>' + regLabel : regLabel;
            }
            if (!payrollText) payrollText = '<span style="color:#999;">—</span>';

            // Total hours for the day (non-REG)
            var totalHours = 0;
            t.verint.forEach(function(v) { totalHours += v.hours; });
            var payrollNonReg = t.payroll.filter(function(p) { return p.trc !== 'REG'; });
            if (payrollNonReg.length > 0) {
                totalHours = payrollNonReg.reduce(function(s, p) { return s + p.quantity; }, 0);
            }

            html += '<tr style="border-bottom:1px solid #eee;' + (rowBg ? ' background:' + rowBg + ';' : '') + '">';
            html += '<td style="padding:6px 8px; white-space:nowrap;">' + escapeHtml(t.dateStr) + '</td>';
            html += '<td style="padding:6px 8px;"><span style="display:inline-block; padding:1px 6px; border-radius:3px; background:' + cat.bg + '; color:' + cat.color + '; font-weight:600; font-size:0.9em;">' + cat.icon + ' ' + cat.label + '</span></td>';
            html += '<td style="padding:6px 8px;">' + verintText + '</td>';
            html += '<td style="padding:6px 8px;">' + payrollText + '</td>';
            html += '<td style="padding:6px 8px; text-align:center; font-weight:600;">' + round2(totalHours) + '</td>';
            html += '<td style="padding:6px 8px; text-align:center;">';
            if (t.ptostRunning !== undefined) {
                var ptColor = t.ptostProtected ? '#2e7d32' : '#b71c1c';
                html += '<span style="color:' + ptColor + '; font-weight:600;">' + t.ptostRunning + 'h</span>';
            } else {
                html += '<span style="color:#ccc;">—</span>';
            }
            html += '</td>';
            html += '<td style="padding:6px 8px; font-size:0.9em;">';
            if (t.flags && t.flags.length > 0) {
                html += t.flags.map(function(f) {
                    var fColor = f.indexOf('DISCREPANCY') >= 0 ? '#e65100' : f.indexOf('reliability') >= 0 ? '#b71c1c' : '#666';
                    return '<div style="color:' + fColor + ';">' + escapeHtml(f) + '</div>';
                }).join('');
            } else {
                html += '<span style="color:#ccc;">—</span>';
            }
            html += '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        return html;
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

    function bindReliabilityControls(container) {
        var select = container.querySelector('#relEmployeeSelect');
        var ledgerBtn = container.querySelector('#relOpenLedger');
        var ledgerWrap = container.querySelector('#relLedgerWrap');

        select?.addEventListener('change', function() {
            var name = this.value;
            if (!name) return;
            var panel = document.getElementById('relDetailPanel');
            if (!panel) return;
            panel.style.display = 'block';
            renderEmployeeDetail(panel, name);
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });

        ledgerBtn?.addEventListener('click', function() {
            if (!ledgerWrap) return;
            var opening = ledgerWrap.style.display === 'none';
            ledgerWrap.style.display = opening ? '' : 'none';
            ledgerBtn.textContent = opening ? 'Hide All-Employees Day-by-Day' : 'Show All-Employees Day-by-Day';
            if (opening) ledgerWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        var normalizedName = normalizeEmployeeName(verint.employeeName);
        var name = findExistingEmployeeName(store, normalizedName) || normalizedName;
        if (!store.employees[name]) store.employees[name] = {};

        verint.employeeName = normalizedName;
        store.employees[name].verint = verint;
        store.employees[name].hasVerint = true;

        // Reconcile with existing payroll data if present
        var payrollEntries = store.employees[name].payroll?.entries || null;
        store.employees[name].reconciled = reconcileEmployee(verint, payrollEntries);

        consolidateDuplicateEmployees(store);
        saveStore(store);
        return verint;
    }

    async function handlePayrollUpload(file) {
        var payrollByEmployee = await parsePayrollExcel(file);
        var store = loadStore();

        Object.keys(payrollByEmployee).forEach(function(rawName) {
            var normalizedName = normalizeEmployeeName(rawName);
            var existingName = findExistingEmployeeName(store, normalizedName) || normalizedName;
            if (!store.employees[existingName]) store.employees[existingName] = {};
            store.employees[existingName].payroll = payrollByEmployee[rawName];
            store.employees[existingName].hasPayroll = true;

            // Reconcile with existing Verint data if present
            var verint = store.employees[existingName].verint || null;
            store.employees[existingName].reconciled = reconcileEmployee(verint, payrollByEmployee[rawName].entries);
        });

        consolidateDuplicateEmployees(store);
        saveStore(store);
        return payrollByEmployee;
    }

    // ============================================
    // INITIALIZE
    // ============================================

    function initialize() {
        var container = document.getElementById('reliabilityDashboard');
        if (!container) return;
        var store = loadStore();
        consolidateDuplicateEmployees(store);
        saveStore(store);
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
