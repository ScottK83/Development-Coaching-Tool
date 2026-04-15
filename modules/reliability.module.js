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

    function inferEmployeeNameFromFileName(fileName, candidates) {
        var base = String(fileName || '')
            .replace(/\.[^.]+$/, '')
            .replace(/[_\-\.]+/g, ' ')
            .trim();
        if (!base) return '';

        var fileKey = buildEmployeeLookupKey(base);
        if (!fileKey) return '';

        var list = Array.isArray(candidates) ? candidates : [];
        var matches = list.filter(function(name) {
            var k = buildEmployeeLookupKey(normalizeEmployeeName(name || ''));
            return k && (fileKey.indexOf(k) >= 0 || k.indexOf(fileKey) >= 0);
        });

        if (matches.length === 1) return matches[0];

        // Secondary pass using first/last token checks.
        var lowerBase = base.toLowerCase();
        var tokenMatches = list.filter(function(name) {
            var norm = normalizeEmployeeName(name || '');
            if (!norm) return false;
            var parts = norm.split(',').map(function(p) { return p.trim().toLowerCase(); });
            var last = parts[0] || '';
            var first = (parts[1] || '').split(/\s+/)[0] || '';
            return (last && lowerBase.indexOf(last) >= 0) && (first && lowerBase.indexOf(first) >= 0);
        });
        return tokenMatches.length === 1 ? tokenMatches[0] : '';
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

    function parseSpreadsheetDate(value) {
        if (value === null || value === undefined || value === '') return null;

        if (value instanceof Date && !isNaN(value.getTime())) {
            var yearVal = value.getFullYear();
            // Legacy bad parse path: Excel serial became year (e.g., year 46024).
            if (yearVal >= 20000 && yearVal <= 80000) {
                var serialFromYear = yearVal;
                var utcMsFromYear = (serialFromYear - 25569) * 86400 * 1000;
                var utcFromYear = new Date(utcMsFromYear);
                return new Date(utcFromYear.getUTCFullYear(), utcFromYear.getUTCMonth(), utcFromYear.getUTCDate());
            }
            return new Date(value.getFullYear(), value.getMonth(), value.getDate());
        }

        var raw = String(value).trim();
        if (!raw) return null;

        // Legacy bad parse path persisted as M/D/##### where ##### is Excel serial.
        var legacySerialMatch = raw.match(/^\d{1,2}\/\d{1,2}\/(\d{5})$/);
        if (legacySerialMatch) {
            var legacySerial = Number(legacySerialMatch[1]);
            if (legacySerial >= 20000 && legacySerial <= 80000) {
                var legacyUtcMs = (legacySerial - 25569) * 86400 * 1000;
                var legacyUtc = new Date(legacyUtcMs);
                return new Date(legacyUtc.getUTCFullYear(), legacyUtc.getUTCMonth(), legacyUtc.getUTCDate());
            }
        }

        // Excel serial date support (e.g., 46024).
        var serial = Number(raw);
        if (isFinite(serial) && serial > 0) {
            var whole = Math.floor(serial);
            if (whole >= 20000 && whole <= 80000) {
                var utcMs = (whole - 25569) * 86400 * 1000;
                var utc = new Date(utcMs);
                return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
            }
        }

        var parsed = new Date(raw);
        if (isNaN(parsed.getTime())) return null;
        if (parsed.getFullYear() >= 20000 && parsed.getFullYear() <= 80000) {
            var serialYear = parsed.getFullYear();
            var serialUtcMs = (serialYear - 25569) * 86400 * 1000;
            var serialUtc = new Date(serialUtcMs);
            return new Date(serialUtc.getUTCFullYear(), serialUtc.getUTCMonth(), serialUtc.getUTCDate());
        }
        return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
    }

    function formatDate(d) {
        if (!d) return '';
        d = parseSpreadsheetDate(d);
        if (!d) return '';
        var m = d.getMonth() + 1;
        var day = d.getDate();
        var y = d.getFullYear();
        return m + '/' + day + '/' + y;
    }

    function normalizeTaskCode(taskCode) {
        var cleaned = stripUnicode(String(taskCode || ''))
            .toUpperCase()
            .replace(/[^A-Z0-9_-]/g, '');
        return cleaned;
    }

    function getFirstName(fullName) {
        if (typeof getEmployeeNickname === 'function') return getEmployeeNickname(fullName);
        if (!fullName) return '';
        if (fullName.includes(',')) return fullName.split(',')[1].trim().split(/\s+/)[0];
        return fullName.split(/\s+/)[0];
    }

    function getYtdReliabilityHoursForEmployee(employeeName) {
        var mod = window.DevCoachModules?.storage;
        if (!mod?.loadYtdData) return null;

        var ytdData = mod.loadYtdData() || {};
        var targetKey = buildEmployeeLookupKey(normalizeEmployeeName(employeeName || ''));
        if (!targetKey) return null;

        var best = null;
        Object.keys(ytdData).forEach(function(periodKey) {
            var period = ytdData[periodKey] || {};
            var list = Array.isArray(period.employees) ? period.employees : [];
            list.forEach(function(emp) {
                var nameKey = buildEmployeeLookupKey(normalizeEmployeeName(emp?.name || ''));
                if (!nameKey || nameKey !== targetKey) return;
                var val = Number(emp?.reliability);
                if (!isFinite(val)) return;
                best = val;
            });
        });

        return best == null ? null : round2(best);
    }

    function getPtoBalanceForEmployee(employeeName) {
        var mod = window.DevCoachModules?.storage;
        if (!mod?.loadPtoTracker) return null;

        var store = mod.loadPtoTracker() || {};
        var associates = store.associates || {};
        var targetKey = buildEmployeeLookupKey(normalizeEmployeeName(employeeName || ''));
        if (!targetKey) return null;

        var foundName = Object.keys(associates).find(function(name) {
            return buildEmployeeLookupKey(normalizeEmployeeName(name || '')) === targetKey;
        });
        if (!foundName) return null;

        var data = associates[foundName] || {};
        var carryover = round2(Number(data.carryoverHours || 0));
        var earned = round2(Number(data.annualAllotment != null ? data.annualAllotment : (store.defaultAnnualAllotment || 120)));
        // Prefer Taken value from the PTO/Vacation Balance PDF if it was imported
        var used;
        if (data.takenHours != null) {
            used = round2(Number(data.takenHours));
        } else {
            used = 0;
            (data.payrollEntries || []).forEach(function(e) {
                if (['PTO', 'PTOST', 'PTO Unsched'].indexOf(String(e?.trc || '')) >= 0) {
                    used += Number(e?.hours || 0);
                }
            });
            used = round2(used);
        }
        // Prefer the system-reported remaining if available
        var remaining = data.reportedRemaining != null
            ? round2(Number(data.reportedRemaining))
            : round2(carryover + earned - used);
        return {
            carryover: carryover,
            earned: earned,
            used: used,
            remaining: remaining
        };
    }

    function buildActionRows(employeeName, reconciled) {
        var rows = [];
        var r = reconciled || {};

        (r.correctionCandidates || []).forEach(function(c) {
            rows.push({
                employee: employeeName,
                date: c.date,
                actionType: 'WFM PTOST Update',
                target: 'WFM',
                hours: round2(Number(c.hours || 0)),
                detail: c.activity || 'Same Day',
                note: c.reason || 'Can be changed to PTOST'
            });
        });

        (r.discrepancies || []).forEach(function(d) {
            rows.push({
                employee: employeeName,
                date: d.date,
                actionType: 'WFM Correction',
                target: 'WFM',
                hours: round2(Number(d.verintHours || 0)),
                detail: d.verintActivity || 'Verint/Payroll mismatch',
                note: 'Payroll shows REG ' + d.payrollHours + 'h @ ' + d.payrollClockIn
            });
        });

        (r.pcIssueCandidates || []).forEach(function(p) {
            rows.push({
                employee: employeeName,
                date: p.date,
                actionType: 'PC Issue Follow-up',
                target: 'Associate',
                hours: round2(Number(p.verintHours || 0)),
                detail: p.verintActivity || 'Tardy',
                note: 'Payroll clock-in ' + p.payrollClockIn
            });
        });

        (r.reviewCodingCandidates || []).forEach(function(m) {
            rows.push({
                employee: employeeName,
                date: m.date,
                actionType: 'WFM Coding Review',
                target: 'WFM',
                hours: round2(Number(m.verintHours || 0)),
                detail: m.verintActivity || 'Verint Same Day',
                note: 'Payroll coded PTO ' + round2(Number(m.payrollPtoHours || 0)) + 'h'
            });
        });

        return rows;
    }

    function exportActionRowsCsv(actionRows, employeeName) {
        if (!Array.isArray(actionRows) || !actionRows.length) return false;
        var headers = ['Employee', 'Date', 'Action Type', 'Target', 'Hours', 'Detail', 'Note'];
        var lines = [headers.join(',')];

        function csvCell(value) {
            var s = String(value == null ? '' : value);
            if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
            return s;
        }

        actionRows.forEach(function(r) {
            lines.push([
                csvCell(r.employee),
                csvCell(r.date),
                csvCell(r.actionType),
                csvCell(r.target),
                csvCell(r.hours),
                csvCell(r.detail),
                csvCell(r.note)
            ].join(','));
        });

        var blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        var stamp = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = 'reliability-actions-' + getFirstName(employeeName).toLowerCase() + '-' + stamp + '.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        return true;
    }

    function buildReviewSummaryText(employeeName, reconciled, ytdReliability, unexplainedDelta) {
        var r = reconciled || {};
        var lines = [];
        lines.push('Reliability Review Summary: ' + employeeName);
        lines.push('YTD Reliability: ' + (ytdReliability == null ? 'N/A' : (ytdReliability + 'h')));
        lines.push('Modeled Reliability: ' + round2(Number(r.reliabilityHours || 0)) + 'h');
        lines.push('Delta: ' + (unexplainedDelta == null ? 'N/A' : (unexplainedDelta + 'h')));
        lines.push('Same Day (No PTOST): ' + round2(Number(r.sameDayNoPtostHours || 0)) + 'h');
        lines.push('PTOST Over 40h: ' + round2(Number(r.ptostOverageHours || 0)) + 'h');
        lines.push('PTOST Running: ' + round2(Number(r.ptostHoursUsed || 0)) + 'h');
        lines.push('Unscheduled Running: ' + round2(Number(r.unscheduledRunningHours || 0)) + 'h');
        lines.push('Discrepancies: ' + ((r.discrepancies || []).length));
        lines.push('PC Issues: ' + ((r.pcIssueCandidates || []).length));
        lines.push('WFM PTOST Updates: ' + ((r.correctionCandidates || []).length));
        lines.push('WFM Coding Reviews: ' + ((r.reviewCodingCandidates || []).length));
        return lines.join('\n');
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
                var m = cell.match(/^employee(?:\s*name)?\s*:\s*(.+)$/i);
                if (m && m[1]) return m[1].trim();

                if (/^employee(?:\s*name)?\s*:$/i.test(cell) || /^employee(?:\s*name)?$/i.test(cell)) {
                    var rightCell = stripUnicode(String(row[c + 1] || '')).trim();
                    if (rightCell) return rightCell;
                }
            }
        }

        // Fallback: search top rows for any cell that already looks like "Last, First".
        for (var r = 0; r < Math.min(rows.length, 40); r++) {
            var scanRow = Array.isArray(rows[r]) ? rows[r] : [];
            for (var k = 0; k < Math.min(scanRow.length, 12); k++) {
                var candidate = stripUnicode(String(scanRow[k] || '')).trim();
                if (candidate && isLikelyEmployeeName(candidate)) return candidate;
            }
        }

        // Fallback: derive employee text from filename if sheet label is missing.
        employeeName = extractNameFromFileName(fileName);
        if (isLikelyEmployeeName(employeeName)) return employeeName;

        return '';
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

                var fromRaw = row[fromCol];
                var toRaw = row[toCol];
                var lengthStr = String(row[hoursCol] || '').trim();
                var hours = parseFloat(lengthStr) || 0;
                var fromDate = parseSpreadsheetDate(fromRaw);
                var toDate = parseSpreadsheetDate(toRaw);

                events.push({
                    activity: activity,
                    from: fromDate,
                    to: toDate,
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
            var dateValue = row[6];
            var clockIn = String(row[8] || '').trim();
            var clockOut = String(row[13] || '').trim();
            var trc = stripUnicode(String(row[14] || '')).toUpperCase();
            var quantity = parseFloat(row[15]) || 0;
            var taskCode = stripUnicode(String(row[22] || '')).toUpperCase().replace(/[^A-Z0-9_-]/g, '');

            var dateObj = parseSpreadsheetDate(dateValue);

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
            ptostOverageHours: 0,
            unscheduledRunningHours: 0,
            sameDayNoPtostHours: 0,
            correctableSameDayHours: 0,
            remainingSameDayExposureHours: 0,
            reliabilityHours: 0,
            timeline: [],           // Unified day-by-day timeline
            discrepancies: [],      // Verint says absent but payroll says worked
            correctionCandidates: [],
            reviewCodingCandidates: [], // Verint same-day conflicts with payroll PTO coding
            pcIssueCandidates: [],
            reasonBuckets: {
                sameDayNoPtostHours: 0,
                ptostOverageHours: 0,
                modeledReliabilityHours: 0
            },
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
            d = parseSpreadsheetDate(d);
            if (!d) return null;
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
                    taskCode: normalizeTaskCode(entry.taskCode),
                    clockIn: entry.clockIn,
                    clockOut: entry.clockOut
                });
            });
        }

        // Walk dates chronologically and build timeline
        var sortedDates = Object.keys(dateMap).sort();
        var runningPtost = 0;
        var runningUnscheduled = 0;

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

            // Payroll PTO family (any PTO code)
            var payrollAnyPto = payrollItems.filter(function(p) {
                return ['PTO', 'PTOST', 'PTO Unsched'].indexOf(String(p.trc || '')) >= 0;
            });
            var payrollAnyPtoHours = payrollAnyPto.reduce(function(s, p) { return s + Number(p.quantity || 0); }, 0);

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
            var verintAbsenceSameDay = verintItems.filter(function(v) { return v.type === 'same-day' || v.type === 'ptost'; });
            var verintPtost = verintItems.filter(function(v) { return v.type === 'ptost' || v.type === 'tardy-ptost'; });
            var verintSameDayNoPtost = verintItems.filter(function(v) { return v.type === 'same-day' || v.type === 'tardy'; });
            var verintTardy = verintItems.filter(function(v) { return v.type === 'tardy'; });
            var mismatchSameDayVsPayrollPto = payrollAnyPtoHours > 0 && verintSameDayNoPtost.length > 0 && verintPtost.length === 0;

            var isSameDay = payrollUnschdHours > 0 || verintSameDayNoPtost.length > 0;
            var isSameDayPtost = (payrollPtostHours > 0 && !mismatchSameDayVsPayrollPto) || verintPtost.length > 0;
            var isBereavement = payrollItems.some(function(p) { return p.trc === 'BRV'; }) ||
                verintItems.some(function(v) { return String(v.activity || '').toLowerCase().includes('bereavement'); });
            var isFmla = payrollItems.some(function(p) { return p.trc === 'FMLA' || p.trc === 'FMLNP'; }) ||
                verintItems.some(function(v) { return String(v.activity || '').toLowerCase().includes('fmla'); });

            if (isSameDay) result.dayBuckets.sameDay.push(formatDate(new Date(dk + 'T12:00:00')));
            if (isSameDayPtost) result.dayBuckets.sameDayPtost.push(formatDate(new Date(dk + 'T12:00:00')));
            if (isBereavement) result.dayBuckets.bereavement.push(formatDate(new Date(dk + 'T12:00:00')));
            if (isFmla) result.dayBuckets.fmla.push(formatDate(new Date(dk + 'T12:00:00')));

            var verintNoPtostHours = verintSameDayNoPtost.reduce(function(s, v) { return s + v.hours; }, 0);
            var hasPayrollLeave = payrollPtostHours > 0 || payrollUnschdHours > 0 || payrollPlannedPto.length > 0 || payrollOtherLeave.length > 0;
            var sameDayExposureHours = 0;

            // Policy: Same Day without PTOST counts against reliability.
            if (payrollUnschdHours > 0) {
                sameDayExposureHours = payrollUnschdHours;
            } else if (verintNoPtostHours > 0 && !hasPayrollLeave && payrollReg.length === 0) {
                sameDayExposureHours = verintNoPtostHours;
            }

            if (sameDayExposureHours > 0) {
                entry.sameDayExposureHours = round2(sameDayExposureHours);
                result.sameDayNoPtostHours = round2(result.sameDayNoPtostHours + sameDayExposureHours);
                result.reliabilityHours = round2(result.reliabilityHours + sameDayExposureHours);
                entry.flags.push('Same Day without PTOST (' + entry.sameDayExposureHours + 'h against reliability)');
            }

            // Review mismatch: Verint says Same Day (non-PTOST) but Payroll coded any PTO.
            // Keep Full PTOST matches clean (e.g., Same Day - Full PTOST + Payroll PTOST).
            if (mismatchSameDayVsPayrollPto) {
                var mismatchHours = round2(verintSameDayNoPtost.reduce(function(s, v) { return s + Number(v.hours || 0); }, 0));
                entry.reviewCodingHours = mismatchHours;
                entry.flags.push('Review coding: Verint Same Day, Payroll PTO (' + mismatchHours + 'h)');
                result.reviewCodingCandidates.push({
                    date: entry.dateStr,
                    dateKey: entry.date,
                    verintActivity: verintSameDayNoPtost.map(function(v) { return v.activity; }).join(', '),
                    verintHours: mismatchHours,
                    payrollPtoHours: round2(payrollAnyPtoHours)
                });
            }

            // --- Track PTOST running total ---
            if (payrollPtostHours > 0) {
                if (mismatchSameDayVsPayrollPto) {
                    runningUnscheduled = round2(runningUnscheduled + payrollPtostHours);
                    entry.unscheduledRunning = runningUnscheduled;
                    result.unscheduledRunningHours = runningUnscheduled;
                } else {
                    runningPtost = round2(runningPtost + payrollPtostHours);
                    entry.ptostRunning = runningPtost;
                    entry.ptostProtected = runningPtost <= PTOST_BUFFER_LIMIT;

                    if (runningPtost > PTOST_BUFFER_LIMIT) {
                        var overage = round2(Math.min(payrollPtostHours, runningPtost - PTOST_BUFFER_LIMIT));
                        entry.ptostOverage = overage;
                        result.ptostOverageHours = round2(result.ptostOverageHours + overage);
                        result.reliabilityHours = round2(result.reliabilityHours + overage);
                        entry.flags.push('PTOST over 40h buffer (+' + overage + 'h reliability)');
                    }
                }
            } else if (verintItems.some(function(v) { return v.type === 'ptost' || v.type === 'tardy-ptost'; })) {
                // Verint shows PTOST but payroll doesn't — track from Verint
                var verintPtostHours = verintItems.filter(function(v) { return v.type === 'ptost' || v.type === 'tardy-ptost'; })
                    .reduce(function(s, v) { return s + v.hours; }, 0);
                runningPtost = round2(runningPtost + verintPtostHours);
                entry.ptostRunning = runningPtost;
                entry.ptostProtected = runningPtost <= PTOST_BUFFER_LIMIT;
            }

            // Payroll may show REG when only part of the day is impacted.
            // Only raise discrepancy when Verint absence is substantial and REG is near full-day.
            if (verintAbsenceSameDay.length > 0 && payrollReg.length > 0 && payrollPtostHours === 0 && payrollUnschdHours === 0 && payrollPlannedPto.length === 0) {
                var verintHrs = round2(verintAbsenceSameDay.reduce(function(s, v) { return s + v.hours; }, 0));
                var regHrs = round2(payrollReg.reduce(function(s, p) { return s + p.quantity; }, 0));
                var nearFullRegDay = regHrs >= 7;
                var substantialVerintAbsence = verintHrs >= 2;

                entry.flags.push('Partial day worked in Payroll (REG ' + regHrs + 'h)');

                if (nearFullRegDay && substantialVerintAbsence) {
                    entry.flags.push('⚠ DISCREPANCY: Verint absence conflicts with near-full REG day');
                    result.discrepancies.push({
                        date: entry.dateStr,
                        dateKey: entry.date,
                        verintActivity: verintAbsenceSameDay.map(function(v) { return v.activity; }).join(', '),
                        verintHours: verintHrs,
                        payrollHours: regHrs,
                        payrollClockIn: payrollReg[0].clockIn
                    });
                }
            }

            // Tardy in Verint but valid payroll clock-in can be documented as PC issue.
            if (verintTardy.length > 0 && payrollReg.length > 0 && payrollPtostHours === 0 && payrollUnschdHours === 0) {
                var tardyHours = verintTardy.reduce(function(s, v) { return s + v.hours; }, 0);
                var firstClock = String(payrollReg[0]?.clockIn || '').trim();
                entry.flags.push('PC ISSUE CANDIDATE: Verint tardy, Payroll clock-in at ' + (firstClock || 'recorded time'));
                result.pcIssueCandidates.push({
                    date: entry.dateStr,
                    dateKey: entry.date,
                    verintActivity: verintTardy.map(function(v) { return v.activity; }).join(', '),
                    verintHours: round2(tardyHours),
                    payrollClockIn: firstClock || 'recorded time'
                });
            }

            // Classify the day for display
            if (mismatchSameDayVsPayrollPto) {
                entry.category = 'same-day';
            } else if (payrollPtostHours > 0 || verintItems.some(function(v) { return v.type === 'ptost' || v.type === 'tardy-ptost'; })) {
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
        result.unscheduledRunningHours = round2(runningUnscheduled);

        var correctionRemaining = result.ptostBufferRemaining;
        result.timeline.forEach(function(t) {
            if (correctionRemaining <= 0) return;
            var dayHours = Number(t.sameDayExposureHours || t.reviewCodingHours || 0);
            if (dayHours <= 0) return;
            var isDiscrepancyDay = (t.flags || []).some(function(f) { return String(f || '').indexOf('DISCREPANCY') >= 0; });
            if (isDiscrepancyDay) return;

            var canDesignate = round2(Math.min(dayHours, correctionRemaining));
            if (canDesignate <= 0) return;

            correctionRemaining = round2(correctionRemaining - canDesignate);
            result.correctionCandidates.push({
                date: t.dateStr,
                dateKey: t.date,
                hours: canDesignate,
                originalHours: dayHours,
                activity: (t.verint || []).map(function(v) { return v.activity; }).join(', ') || 'Same Day',
                reason: canDesignate < dayHours
                    ? 'Partial conversion due to PTOST 40h limit'
                    : ((Number(t.reviewCodingHours || 0) > 0)
                        ? 'Verint Same Day with Payroll PTO: update to PTOST'
                        : 'Can be changed to PTOST')
            });
        });

        result.correctableSameDayHours = round2(result.correctionCandidates.reduce(function(sum, c) {
            return sum + Number(c.hours || 0);
        }, 0));
        result.remainingSameDayExposureHours = round2(Math.max(0, result.sameDayNoPtostHours - result.correctableSameDayHours));
        result.reasonBuckets = {
            sameDayNoPtostHours: round2(result.sameDayNoPtostHours || 0),
            ptostOverageHours: round2(result.ptostOverageHours || 0),
            modeledReliabilityHours: round2(result.reliabilityHours || 0)
        };

        Object.keys(result.dayBuckets).forEach(function(key) {
            result.dayBuckets[key] = Array.from(new Set(result.dayBuckets[key] || []));
        });

        return result;
    }

    // ============================================
    // EMAIL DRAFTS
    // ============================================

    function buildPtostDesignationEmail(employeeName, events) {
        var lines = [];
        lines.push('Hi WFM Team,\n');
        lines.push('Please review the entries below for ' + employeeName + ' and update coding to PTOST where applicable.\n');

        events.forEach(function(ev) {
            lines.push('  - ' + ev.dateStr + ': ' + ev.hours + 'h (' + ev.activity + ')');
        });

        lines.push('\nThese updates are limited to remaining PTOST eligibility under the 40-hour policy cap.');
        lines.push('\nThank you,');
        return lines.join('\n');
    }

    function buildWfmCorrectionEmail(employeeName, discrepancies) {
        var lines = [];
        lines.push('Hi WFM Team,\n');
        lines.push('Please review the discrepancies below for ' + employeeName + ' between Verint and Payroll:\n');

        discrepancies.forEach(function(d) {
            lines.push('  - ' + d.date + ': Verint shows "' + d.verintActivity + '" (' + d.verintHours + 'h), while Payroll shows REG ' + d.payrollHours + 'h with clock-in at ' + d.payrollClockIn + '.');
        });

        lines.push('\nPlease update as needed.\n');
        lines.push('Thank you,');
        return lines.join('\n');
    }

    function buildPcIssueEmail(employeeName, pcIssues) {
        var firstName = getFirstName(employeeName);
        var lines = [];
        lines.push('Hi ' + firstName + ',\n');
        lines.push('I reviewed a few attendance records where Verint marked tardy but Payroll shows you clocked in on time.');
        lines.push('I am documenting these as potential PC/system issues for follow-up:\n');

        (pcIssues || []).forEach(function(d) {
            lines.push('  - ' + d.date + ': Verint "' + d.verintActivity + '" (' + d.verintHours + 'h), Payroll clock-in at ' + d.payrollClockIn);
        });

        lines.push('\nIf you had technical issues on these dates, reply with any details so we can keep the record accurate.');
        lines.push('\nThanks,');
        return lines.join('\n');
    }

    function buildVerintCorrectionsDraft(employeeName, correctionCandidates, pcIssues, discrepancies, reviewCodingCandidates) {
        var lines = [];
        var items = [];

        (correctionCandidates || []).forEach(function(c) {
            items.push({ date: c.date, dateKey: c.dateKey, label: 'Convert to PTOST', hours: Number(c.hours || 0) });
        });

        (pcIssues || []).forEach(function(p) {
            items.push({ date: p.date, dateKey: p.dateKey, label: 'PC issue follow-up', hours: Number(p.verintHours || 0) });
        });

        (discrepancies || []).forEach(function(d) {
            items.push({ date: d.date, dateKey: d.dateKey, label: 'Payroll correction needed', hours: Number(d.verintHours || 0) });
        });

        (reviewCodingCandidates || []).forEach(function(d) {
            items.push({ date: d.date, dateKey: d.dateKey, label: 'Review coding mismatch (Verint Same Day / Payroll PTO)', hours: Number(d.verintHours || 0) });
        });

        function getSortableDateValue(item) {
            var key = String(item?.dateKey || '').trim();
            if (key) {
                var parsedKey = parseSpreadsheetDate(key);
                if (parsedKey && !Number.isNaN(parsedKey.getTime())) return parsedKey.getTime();
            }

            var raw = String(item?.date || '').trim();
            if (!raw) return Number.POSITIVE_INFINITY;

            // Handles ISO/date-like values first.
            var parsed = parseSpreadsheetDate(raw);
            if (parsed && !Number.isNaN(parsed.getTime())) return parsed.getTime();

            // Handles display dates like M/D or M/D/YYYY.
            var mdY = raw.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
            if (mdY) {
                var mm = Number(mdY[1]);
                var dd = Number(mdY[2]);
                var yy = mdY[3] ? Number(mdY[3]) : new Date().getFullYear();
                if (yy < 100) yy += 2000;
                return new Date(yy, mm - 1, dd).getTime();
            }

            return Number.POSITIVE_INFINITY;
        }

        function getYear(item) {
            var ts = getSortableDateValue(item);
            if (!Number.isFinite(ts)) return NaN;
            return new Date(ts).getFullYear();
        }

        // Business rule: do not send correction rows for 2025 and earlier.
        items = items.filter(function(item) {
            var y = getYear(item);
            return Number.isFinite(y) && y >= 2026;
        });

        items.sort(function(a, b) {
            var da = getSortableDateValue(a);
            var db = getSortableDateValue(b);
            if (da !== db) return da - db;
            return String(a.date || '').localeCompare(String(b.date || ''));
        });

        // Keep one row per date to avoid confusing duplicates across sections.
        // Priority: Convert to PTOST > Payroll correction needed > Review coding mismatch > PC issue follow-up.
        var groupedByDate = {};
        items.forEach(function(item) {
            var key = String(item.dateKey || item.date || '').trim();
            if (!key) key = String(item.date || '').trim();
            if (!groupedByDate[key]) {
                groupedByDate[key] = {
                    date: item.date,
                    dateKey: item.dateKey,
                    labels: {},
                    hours: 0
                };
            }

            groupedByDate[key].labels[item.label] = true;
            groupedByDate[key].hours = round2(Number(groupedByDate[key].hours || 0) + Number(item.hours || 0));
        });

        function pickPrimaryLabel(labels) {
            if (labels['Convert to PTOST']) return 'Convert to PTOST';
            if (labels['Payroll correction needed']) return 'Payroll correction needed';
            if (labels['Review coding mismatch (Verint Same Day / Payroll PTO)']) return 'Review coding mismatch (Verint Same Day / Payroll PTO)';
            if (labels['PC issue follow-up']) return 'PC issue follow-up';
            return 'Needs review';
        }

        items = Object.keys(groupedByDate).map(function(k) {
            var g = groupedByDate[k];
            return {
                date: g.date,
                dateKey: g.dateKey,
                label: pickPrimaryLabel(g.labels),
                hours: g.hours
            };
        });

        items.sort(function(a, b) {
            var da = getSortableDateValue(a);
            var db = getSortableDateValue(b);
            if (da !== db) return da - db;
            return String(a.date || '').localeCompare(String(b.date || ''));
        });

        lines.push('Hi WFM Team,');
        lines.push('');
        lines.push('Please review the attendance updates below for ' + employeeName + '.');
        lines.push('Items are grouped by what can be updated now vs what needs review.');
        lines.push('');

        var ptostRows = items.filter(function(i) { return i.label === 'Convert to PTOST'; });
        var otherRows = items.filter(function(i) { return i.label !== 'Convert to PTOST'; });

        if (ptostRows.length > 0) {
            lines.push('Can update now (within PTOST 40h cap):');
            ptostRows.forEach(function(item) {
                var hrs = item.hours > 0 ? ' (' + round2(item.hours) + 'h)' : '';
                lines.push('- ' + item.date + ': ' + item.label + hrs);
            });
            lines.push('');
        }

        if (otherRows.length > 0) {
            lines.push('Needs review:');
            otherRows.forEach(function(item) {
                var hrs = item.hours > 0 ? ' (' + round2(item.hours) + 'h)' : '';
                lines.push('- ' + item.date + ': ' + item.label + hrs);
            });
            lines.push('');
        }

        if (items.length === 0) {
            lines.push('- No updates are currently flagged.');
            lines.push('');
        }

        lines.push('Thank you,');

        return {
            subject: employeeName + ' - Attendance Coding Updates',
            body: lines.join('\n')
        };
    }

    function openMailDraft(subject, body) {
        var safeSubject = encodeURIComponent(String(subject || ''));
        var safeBody = encodeURIComponent(String(body || ''));
        window.location.href = 'mailto:?subject=' + safeSubject + '&body=' + safeBody;
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
        if (!tf?.getTeamSelectionContext) return [];

        var ctx = tf.getTeamSelectionContext();
        if (!Array.isArray(ctx?.selectedMembers) || !ctx.selectedMembers.length) return [];

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
                    var taskCode = normalizeTaskCode(p.taskCode);
                    if (taskCode) label += ' / ' + taskCode;
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

    function getEmployeeReviewPriority(name, employeeRecord) {
        var emp = employeeRecord || {};
        var r = emp.reconciled || {};
        var ytdReliability = getYtdReliabilityHoursForEmployee(name);
        var modeledReliability = round2(Number(r.reliabilityHours || 0));
        var delta = ytdReliability == null ? null : round2(ytdReliability - modeledReliability);

        var discrepancyCount = (r.discrepancies || []).length;
        var pcIssueCount = (r.pcIssueCandidates || []).length;
        var wfmUpdateCount = (r.correctionCandidates || []).length;
        var reviewCodingCount = (r.reviewCodingCandidates || []).length;

        var score = 0;
        if (ytdReliability != null && ytdReliability > 0) score += 2;
        if (Math.abs(modeledReliability) > 0.01) score += 2;
        if (delta != null && Math.abs(delta) > 2) score += 5;
        else if (delta != null && Math.abs(delta) > 0.25) score += 3;
        score += discrepancyCount * 2;
        score += pcIssueCount * 2;
        score += wfmUpdateCount;
        score += reviewCodingCount;

        var reviewCount = discrepancyCount + pcIssueCount + wfmUpdateCount + reviewCodingCount + ((delta != null && Math.abs(delta) > 0.25) ? 1 : 0);
        var needsReview = score > 0 && reviewCount > 0;

        var label = needsReview
            ? '⚠ ' + name + (reviewCount > 1 ? ' (' + reviewCount + ')' : '')
            : name;

        return {
            name: name,
            score: score,
            needsReview: needsReview,
            label: label
        };
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
        var prioritized = names.map(function(name) {
            return getEmployeeReviewPriority(name, employees[name]);
        }).sort(function(a, b) {
            if (b.score !== a.score) return b.score - a.score;
            return a.name.localeCompare(b.name);
        });
        var reviewCount = prioritized.filter(function(p) { return p.needsReview; }).length;

        var html = '';
        html += '<div style="margin-bottom:16px;">';
        html += '<h3 style="margin:0 0 12px 0; color:#00695c;">📋 Reliability Tracker</h3>';
        html += '<p style="font-size:0.88em; color:#666; margin-bottom:16px;">Upload files in the Upload section.</p>';

        html += '<div style="display:flex; gap:10px; align-items:end; flex-wrap:wrap; margin-bottom:10px;">';
        html += '<div>';
        html += '<label style="display:block; font-size:0.78em; color:#555; margin-bottom:2px;">Employee breakdown</label>';
        html += '<select id="relEmployeeSelect" style="padding:6px 10px; border:1px solid #cdd; border-radius:4px; min-width:260px;">';
        html += '<option value="">Select employee...</option>';
        prioritized.forEach(function(item) {
            html += '<option value="' + escapeHtml(item.name) + '">' + escapeHtml(item.label) + '</option>';
        });
        html += '</select>';
        html += '</div>';
        html += '<div style="font-size:0.78em; color:#666;">Tip: choose one checked team member to view detail.</div>';
        if (reviewCount > 0) {
            html += '<div style="font-size:0.78em; color:#b26a00; font-weight:600;">Review queue: ' + reviewCount + ' associate' + (reviewCount === 1 ? '' : 's') + '.</div>';
        }
        html += '</div>';

        if (names.length === 0) {
            html += '<div style="padding:20px; background:#f5f5f5; border-radius:8px; text-align:center; color:#666;">';
            html += 'No checked team members found in Settings for the current period.';
            html += '</div>';
            html += '</div>';
            container.innerHTML = html;
            return;
        }
        html += '<div id="relSelectionHint" style="padding:14px; border:1px dashed #b0bec5; border-radius:8px; color:#607d8b; background:#fafcfd; margin-top:8px;">Select an employee from the dropdown to view reliability details.</div>';

        // Detail panel (shown when clicking a row)
        html += '<div id="relDetailPanel" style="display:none; margin-top:16px;"></div>';
        html += '</div>';

        container.innerHTML = html;
        bindReliabilityControls(container);
    }

    // Category display config
    var CAT_STYLES = {
        'ptost':    { label: 'PTOST',       bg: '#e8f5e9', color: '#2e7d32', icon: '🛡' },
        'same-day': { label: 'Same Day/Partial', bg: '#ffebee', color: '#b71c1c', icon: '⚠' },
        'tardy':    { label: 'Tardy',       bg: '#fff3e0', color: '#e65100', icon: '⏰' },
        'planned':  { label: 'Planned',     bg: '#e3f2fd', color: '#0d47a1', icon: '📅' },
        'other':    { label: 'Other',       bg: '#f5f5f5', color: '#666',    icon: '—' }
    };

    // ============================================
    // DISCREPANCY VIEW (simplified default)
    // ============================================
    // Shows only what disagrees: Verint vs Payroll side-by-side,
    // PTOST running total against the 40h cap, and a dense action list.
    // Full timeline / KPI cards live in the Classic view behind a tab.
    function buildDiscrepancyViewHtml(r, employeeName) {
        var timeline = r.timeline || [];
        var ptostUsed = round2(Number(r.ptostHoursUsed || 0));
        var ptostRemaining = round2(Math.max(0, PTOST_BUFFER_LIMIT - ptostUsed));
        var ptostPct = Math.min(100, (ptostUsed / PTOST_BUFFER_LIMIT) * 100);
        var ptostColor = ptostPct >= 100 ? '#b71c1c' : ptostPct >= 75 ? '#e65100' : '#2e7d32';
        var sameDayAgainst = round2(Number(r.sameDayNoPtostHours || 0));
        var discCount = (r.discrepancies || []).length;
        var reviewCount = (r.reviewCodingCandidates || []).length;
        var pcCount = (r.pcIssueCandidates || []).length;

        // Collect every day where something disagrees or counts against reliability
        var rows = [];
        (timeline || []).forEach(function(t) {
            var exposure = round2(Number(t.sameDayExposureHours || 0));
            var overage = round2(Number(t.ptostOverage || 0));
            var flags = t.flags || [];
            var hasDiscrepancy = flags.some(function(f) { return String(f).toUpperCase().indexOf('DISCREPANCY') >= 0; });
            var hasPcIssue = flags.some(function(f) { return String(f).toUpperCase().indexOf('PC ISSUE') >= 0; });
            var hasReview = flags.some(function(f) { return String(f).toLowerCase().indexOf('review coding') >= 0; });
            var hasPartial = flags.some(function(f) { return String(f).indexOf('Partial day') >= 0; });

            if (exposure <= 0 && overage <= 0 && !hasDiscrepancy && !hasPcIssue && !hasReview && !hasPartial) return;

            var verintDesc = (t.verint || []).map(function(v) {
                return (v.activity || v.type || '') + (v.hours ? ' (' + round2(v.hours) + 'h)' : '');
            }).filter(Boolean).join(', ') || '—';

            var nonRegPayroll = (t.payroll || []).filter(function(p) { return p.trc !== 'REG'; });
            var payrollDesc = nonRegPayroll.map(function(p) {
                var s = p.trc;
                if (p.taskCode) s += '/' + p.taskCode;
                if (p.quantity) s += ' ' + round2(p.quantity) + 'h';
                return s;
            }).join(', ');
            var payrollReg = (t.payroll || []).filter(function(p) { return p.trc === 'REG' && p.clockIn; });
            if (payrollReg.length > 0) {
                var regHrs = round2(payrollReg.reduce(function(s, p) { return s + Number(p.quantity || 0); }, 0));
                payrollDesc = (payrollDesc ? payrollDesc + ' + ' : '') + 'REG ' + regHrs + 'h @ ' + (payrollReg[0].clockIn || '');
            }
            if (!payrollDesc) payrollDesc = '—';

            var hrs = exposure > 0 ? exposure
                : overage > 0 ? overage
                : round2((t.verint || []).reduce(function(s, v) { return s + Number(v.hours || 0); }, 0));

            var problem, color, action;
            if (hasDiscrepancy) {
                problem = '⚠ Verint absent, Payroll REG'; color = '#b71c1c';
                action = 'Payroll wrong — send correction';
            } else if (hasReview) {
                problem = '⚠ Verint Same Day vs Payroll PTO'; color = '#e65100';
                action = 'Re-code to PTOST (if buffer remains)';
            } else if (hasPcIssue) {
                problem = 'PC issue — Verint tardy, clocked in'; color = '#1565c0';
                action = 'Document as system issue';
            } else if (overage > 0) {
                problem = 'PTOST over 40h cap'; color = '#e65100';
                action = 'Counts against reliability';
            } else if (exposure > 0) {
                problem = 'Same Day without PTOST'; color = '#b71c1c';
                action = 'Counts against reliability';
            } else if (hasPartial) {
                problem = 'Partial day — review'; color = '#78909c';
                action = 'Confirm payroll matches';
            } else {
                problem = '—'; color = '#78909c'; action = '—';
            }

            rows.push({
                dateStr: t.dateStr,
                verint: verintDesc,
                payroll: payrollDesc,
                hrs: hrs,
                problem: problem,
                color: color,
                action: action
            });
        });

        // PTOST ledger — every day that moved the running total
        var ptostLedger = [];
        (timeline || []).forEach(function(t) {
            if (t.ptostRunning == null) return;
            var dayPtost = (t.payroll || []).filter(function(p) { return p.trc === 'PTOST'; })
                .reduce(function(s, p) { return s + Number(p.quantity || 0); }, 0);
            if (dayPtost <= 0) {
                dayPtost = (t.verint || []).filter(function(v) { return v.type === 'ptost' || v.type === 'tardy-ptost'; })
                    .reduce(function(s, v) { return s + Number(v.hours || 0); }, 0);
            }
            if (dayPtost <= 0) return;
            ptostLedger.push({
                dateStr: t.dateStr,
                hrs: round2(dayPtost),
                running: round2(t.ptostRunning),
                protected: t.ptostProtected !== false,
                overage: round2(Number(t.ptostOverage || 0))
            });
        });

        var html = '';
        html += '<div id="relDiscView">';

        // Verdict tiles
        html += '<div style="display:grid; grid-template-columns:repeat(4,1fr); gap:10px; margin-bottom:14px;">';
        html += '<div style="padding:12px; background:#fff; border:1px solid #ffcdd2; border-radius:8px; text-align:center;">';
        html += '<div style="font-size:1.8em; font-weight:800; color:#b71c1c;">' + sameDayAgainst + 'h</div>';
        html += '<div style="font-size:0.78em; color:#666;">Against reliability</div></div>';
        html += '<div style="padding:12px; background:#fff; border:1px solid #b2dfdb; border-radius:8px;">';
        html += '<div style="display:flex; justify-content:space-between; align-items:baseline;"><div style="font-size:1.6em; font-weight:800; color:' + ptostColor + ';">' + ptostUsed + '<span style="font-size:0.55em; color:#90a4ae;"> / 40h</span></div><div style="font-size:0.75em; color:#607d8b;">' + ptostRemaining + 'h left</div></div>';
        html += '<div style="margin-top:6px; height:6px; background:#e0e0e0; border-radius:3px; overflow:hidden;"><div style="height:100%; width:' + ptostPct + '%; background:' + ptostColor + ';"></div></div>';
        html += '<div style="font-size:0.75em; color:#607d8b; text-align:center; margin-top:4px;">PTOST buffer</div></div>';
        html += '<div style="padding:12px; background:#fff; border:1px solid #ffe0b2; border-radius:8px; text-align:center;">';
        html += '<div style="font-size:1.8em; font-weight:800; color:#e65100;">' + (discCount + reviewCount) + '</div>';
        html += '<div style="font-size:0.78em; color:#666;">Payroll discrepancies</div></div>';
        html += '<div style="padding:12px; background:#fff; border:1px solid #bbdefb; border-radius:8px; text-align:center;">';
        html += '<div style="font-size:1.8em; font-weight:800; color:#1565c0;">' + pcCount + '</div>';
        html += '<div style="font-size:0.78em; color:#666;">PC issue candidates</div></div>';
        html += '</div>';

        // Discrepancy table — only rows that disagree or count
        html += '<div style="margin-bottom:14px; background:#fff; border:1px solid #e0e0e0; border-radius:8px; overflow:hidden;">';
        html += '<div style="padding:10px 14px; background:#fafafa; border-bottom:1px solid #e0e0e0; font-weight:700; color:#37474f;">What needs attention (' + rows.length + ')</div>';
        if (rows.length === 0) {
            html += '<div style="padding:20px; text-align:center; color:#2e7d32; font-weight:600;">✓ Verint and Payroll agree. Nothing to review.</div>';
        } else {
            html += '<table style="width:100%; border-collapse:collapse; font-size:0.85em;">';
            html += '<thead><tr style="background:#f5f7f8; color:#455a64;">';
            html += '<th style="padding:8px 10px; text-align:left; border-bottom:1px solid #e0e0e0; white-space:nowrap;">Date</th>';
            html += '<th style="padding:8px 10px; text-align:left; border-bottom:1px solid #e0e0e0;">Verint says</th>';
            html += '<th style="padding:8px 10px; text-align:left; border-bottom:1px solid #e0e0e0;">Payroll says</th>';
            html += '<th style="padding:8px 10px; text-align:center; border-bottom:1px solid #e0e0e0; white-space:nowrap;">Hours</th>';
            html += '<th style="padding:8px 10px; text-align:left; border-bottom:1px solid #e0e0e0;">Problem</th>';
            html += '<th style="padding:8px 10px; text-align:left; border-bottom:1px solid #e0e0e0;">Action</th>';
            html += '</tr></thead><tbody>';
            rows.forEach(function(row) {
                html += '<tr style="border-bottom:1px solid #f0f0f0;">';
                html += '<td style="padding:8px 10px; white-space:nowrap; font-weight:600;">' + escapeHtml(row.dateStr) + '</td>';
                html += '<td style="padding:8px 10px; color:#455a64;">' + escapeHtml(row.verint) + '</td>';
                html += '<td style="padding:8px 10px; color:#455a64;">' + escapeHtml(row.payroll) + '</td>';
                html += '<td style="padding:8px 10px; text-align:center; font-weight:700;">' + row.hrs + 'h</td>';
                html += '<td style="padding:8px 10px; color:' + row.color + '; font-weight:600;">' + escapeHtml(row.problem) + '</td>';
                html += '<td style="padding:8px 10px; color:#455a64; font-size:0.92em;">' + escapeHtml(row.action) + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table>';
        }
        html += '</div>';

        // PTOST ledger
        if (ptostLedger.length > 0) {
            html += '<div style="margin-bottom:14px; background:#fff; border:1px solid #e0e0e0; border-radius:8px; overflow:hidden;">';
            html += '<div style="padding:10px 14px; background:#fafafa; border-bottom:1px solid #e0e0e0; font-weight:700; color:#37474f;">PTOST ledger — running total vs 40h cap</div>';
            html += '<table style="width:100%; border-collapse:collapse; font-size:0.85em;">';
            html += '<thead><tr style="background:#f5f7f8; color:#455a64;">';
            html += '<th style="padding:6px 10px; text-align:left; border-bottom:1px solid #e0e0e0;">Date</th>';
            html += '<th style="padding:6px 10px; text-align:center; border-bottom:1px solid #e0e0e0;">PTOST this day</th>';
            html += '<th style="padding:6px 10px; text-align:center; border-bottom:1px solid #e0e0e0;">Running total</th>';
            html += '<th style="padding:6px 10px; text-align:left; border-bottom:1px solid #e0e0e0;">Status</th>';
            html += '</tr></thead><tbody>';
            ptostLedger.forEach(function(row) {
                var statusText, statusColor, rowBg = '';
                if (row.overage > 0) {
                    statusText = '✗ Over cap (+' + row.overage + 'h against)'; statusColor = '#b71c1c'; rowBg = 'background:#fff5f5;';
                } else if (row.protected) {
                    statusText = '✓ Protected'; statusColor = '#2e7d32';
                } else {
                    statusText = '⚠ Over cap'; statusColor = '#e65100'; rowBg = 'background:#fff8e1;';
                }
                html += '<tr style="border-bottom:1px solid #f0f0f0;' + rowBg + '">';
                html += '<td style="padding:6px 10px; white-space:nowrap; font-weight:600;">' + escapeHtml(row.dateStr) + '</td>';
                html += '<td style="padding:6px 10px; text-align:center;">' + row.hrs + 'h</td>';
                html += '<td style="padding:6px 10px; text-align:center; font-weight:700;">' + row.running + 'h</td>';
                html += '<td style="padding:6px 10px; color:' + statusColor + '; font-weight:600;">' + statusText + '</td>';
                html += '</tr>';
            });
            html += '</tbody></table></div>';
        }

        // Action bar — same buttons as classic so nothing is lost
        html += '<div style="display:flex; gap:10px; flex-wrap:wrap;">';
        html += '<button type="button" id="relDiscCopySummary" style="padding:8px 16px; background:#37474f; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600;">📋 Copy Manager Summary</button>';
        if ((discCount + reviewCount + pcCount) > 0) {
            html += '<button type="button" id="relDiscEmailCorrections" style="padding:8px 16px; background:#0d47a1; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600;">✉ Open Corrections Email</button>';
        }
        html += '</div>';

        html += '</div>'; // end relDiscView
        return html;
    }

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
        var correctionCandidates = r.correctionCandidates || [];
        var ptoBalance = getPtoBalanceForEmployee(employeeName);
        var ytdReliability = getYtdReliabilityHoursForEmployee(employeeName);
        var reasonBuckets = r.reasonBuckets || {
            sameDayNoPtostHours: round2(r.sameDayNoPtostHours || 0),
            ptostOverageHours: round2(r.ptostOverageHours || 0),
            modeledReliabilityHours: round2(r.reliabilityHours || 0)
        };

        var correctionByDate = {};
        correctionCandidates.forEach(function(c) {
            var k = String(c.date || '');
            correctionByDate[k] = round2((correctionByDate[k] || 0) + Number(c.hours || 0));
        });

        var safeCorrectionRows = [];
        var holdCorrectionRows = [];
        (timeline || []).forEach(function(t) {
            var exposure = round2(Number(t.sameDayExposureHours || 0));
            if (exposure <= 0) return;
            var corrected = round2(Number(correctionByDate[t.dateStr] || 0));
            var remaining = round2(Math.max(0, exposure - corrected));
            if (corrected > 0) safeCorrectionRows.push(t.dateStr + ' (' + corrected + 'h)');
            if (remaining > 0) holdCorrectionRows.push(t.dateStr + ' (' + remaining + 'h hold)');
        });
        var modeledReliability = round2(reasonBuckets.modeledReliabilityHours || 0);
        var unexplainedDelta = ytdReliability == null ? null : round2(ytdReliability - modeledReliability);
        var actionRows = buildActionRows(employeeName, r);

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

        // Tab bar — Discrepancies (default) / Classic
        html += '<div style="display:flex; gap:4px; margin-bottom:12px; border-bottom:2px solid #e0e0e0;">';
        html += '<button type="button" id="relTabDisc" data-tab="disc" style="padding:8px 16px; border:none; background:#00695c; color:#fff; cursor:pointer; font-weight:700; border-radius:6px 6px 0 0; font-size:0.9em;">Discrepancies</button>';
        html += '<button type="button" id="relTabClassic" data-tab="classic" style="padding:8px 16px; border:none; background:#eceff1; color:#455a64; cursor:pointer; font-weight:600; border-radius:6px 6px 0 0; font-size:0.9em;">Classic view</button>';
        html += '</div>';

        // Render discrepancy view (default visible)
        html += buildDiscrepancyViewHtml(r, employeeName);

        // Everything below here is the Classic view — wrapped and hidden by default
        html += '<div id="relClassicWrap" style="display:none;">';

        var needsReviewCount = timeline.filter(function(t) {
            return (t.flags || []).some(function(f) {
                var s = String(f || '').toLowerCase();
                return s.indexOf('review') >= 0 ||
                    s.indexOf('discrepancy') >= 0 ||
                    s.indexOf('pc issue candidate') >= 0 ||
                    s.indexOf('against reliability') >= 0 ||
                    s.indexOf('ptost over 40h') >= 0;
            });
        }).length;

        if (needsReviewCount > 0) {
            html += '<div style="margin-bottom:12px; padding:8px 10px; border-radius:6px; background:#fff8e1; border:1px solid #ffe08a; color:#8a5300; font-size:0.83em; font-weight:700;">';
            html += '⚠ ' + needsReviewCount + ' day(s) need review for ' + escapeHtml(firstName) + '.';
            html += '</div>';
        }

        var ptoRemainingValue = ptoBalance ? Number(ptoBalance.remaining || 0) : null;
        var ptoIsNegative = ptoRemainingValue != null && ptoRemainingValue < 0;
        var ptoRemainingText = ptoBalance
            ? (ptoIsNegative ? ('Overused by ' + round2(Math.abs(ptoRemainingValue)) + 'h') : (round2(ptoRemainingValue) + 'h'))
            : '—';

        html += '<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-bottom:16px;">';
        html += '<div style="padding:10px; background:#fff8e1; border-radius:6px; text-align:center;"><div style="font-size:1.15em; font-weight:700; color:#e65100;">' + (ptoBalance ? ptoBalance.carryover : '—') + (ptoBalance ? 'h' : '') + '</div><div style="font-size:0.75em; color:#666;">PTO Carryover</div></div>';
        html += '<div style="padding:10px; background:#e8f5e9; border-radius:6px; text-align:center;"><div style="font-size:1.15em; font-weight:700; color:#2e7d32;">' + (ptoBalance ? ptoBalance.earned : '—') + (ptoBalance ? 'h' : '') + '</div><div style="font-size:0.75em; color:#666;">PTO Earned</div></div>';
        html += '<div style="padding:10px; background:#ffebee; border-radius:6px; text-align:center;"><div style="font-size:1.15em; font-weight:700; color:#c62828;">' + (ptoBalance ? ptoBalance.used : '—') + (ptoBalance ? 'h' : '') + '</div><div style="font-size:0.75em; color:#666;">PTO Used</div></div>';
        html += '<div style="padding:10px; background:' + (ptoIsNegative ? '#ffebee' : '#e3f2fd') + '; border-radius:6px; text-align:center;"><div style="font-size:1.05em; font-weight:700; color:' + (ptoIsNegative ? '#b71c1c' : '#1565c0') + ';">' + ptoRemainingText + '</div><div style="font-size:0.75em; color:#666;">PTO Remaining</div></div>';
        html += '</div>';
        if (ptoIsNegative) {
            html += '<div style="margin:-8px 0 12px 0; font-size:0.8em; color:#8d1f1f;">PTO used is currently higher than carryover + earned in the imported PTO tracker data.</div>';
        }

        var payrollFollowUpCount = (correctionCandidates || []).length + (r.pcIssueCandidates || []).length + (r.discrepancies || []).length + (r.reviewCodingCandidates || []).length;
        var payrollFollowUpNeeded = payrollFollowUpCount > 0;
        var ptostUsed = round2(Number(r.ptostHoursUsed || 0));
        var ptostRemaining = round2(Math.max(0, PTOST_BUFFER_LIMIT - ptostUsed));
        var unscheduledHours = round2(Number(r.unscheduledRunningHours || 0));

        // Status cards
        html += '<div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:10px; margin-bottom:16px;">';
        html += '<div style="padding:10px; background:#e0f2f1; border-radius:6px; text-align:center;"><div style="font-size:1.3em; font-weight:700; color:#00695c;">' + ptostUsed + 'h / ' + PTOST_BUFFER_LIMIT + 'h</div><div style="font-size:0.75em; color:#666;">PTOST Logged</div></div>';
        html += '<div style="padding:10px; background:#e3f2fd; border-radius:6px; text-align:center;"><div style="font-size:1.3em; font-weight:700; color:#0d47a1;">' + ptostRemaining + 'h</div><div style="font-size:0.75em; color:#666;">PTOST Left Before 40h</div></div>';
        html += '<div style="padding:10px; background:#fff3e0; border-radius:6px; text-align:center;"><div style="font-size:1.3em; font-weight:700; color:#ef6c00;">' + unscheduledHours + 'h</div><div style="font-size:0.75em; color:#666;">Unscheduled or Unplanned</div></div>';
        html += '<div style="padding:10px; background:' + (payrollFollowUpNeeded ? '#fff8e1' : '#e8f5e9') + '; border-radius:6px; text-align:center;"><div style="font-size:1.05em; font-weight:700; color:' + (payrollFollowUpNeeded ? '#8a5300' : '#2e7d32') + ';">' + (payrollFollowUpNeeded ? 'Yes (' + payrollFollowUpCount + ')' : 'No') + '</div><div style="font-size:0.75em; color:#666;">Needs Payroll Follow-up</div></div>';
        html += '</div>';

        var mismatchDates = [];
        (timeline || []).forEach(function(t) {
            var hasMismatchFlag = (t.flags || []).some(function(f) {
                var s = String(f || '').toLowerCase();
                return s.indexOf('review coding:') >= 0 || s.indexOf('discrepancy') >= 0;
            });
            if (hasMismatchFlag) mismatchDates.push(t.dateStr);
        });
        mismatchDates = Array.from(new Set(mismatchDates));

        // ── High-level Summary ──────────────────────────────────────────
        var ptostBarPct = Math.min(100, (ptostUsed / PTOST_BUFFER_LIMIT) * 100);
        var ptostBarColor = ptostBarPct >= 100 ? '#b71c1c' : ptostBarPct >= 75 ? '#e65100' : '#2e7d32';
        var tierBadgeBg = tier.bg; var tierBadgeColor = tier.color;

        html += '<div style="margin-bottom:14px; padding:12px 14px; background:#f7fdfc; border:1px solid #b2dfdb; border-radius:8px;">';
        html += '<div style="font-weight:700; color:#00695c; font-size:0.95em; margin-bottom:10px; letter-spacing:0.02em;">At a Glance</div>';

        // Row 1: 4 key stat chips
        html += '<div style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px; margin-bottom:10px;">';

        // PTOST chip with inline mini-bar
        html += '<div style="background:#fff; border:1px solid #b2dfdb; border-radius:6px; padding:8px 10px;">';
        html += '<div style="font-size:0.7em; color:#607d8b; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:3px;">PTOST</div>';
        html += '<div style="font-size:1.25em; font-weight:700; color:' + ptostBarColor + ';">' + ptostUsed + '<span style="font-size:0.65em; color:#90a4ae;"> / 40h</span></div>';
        html += '<div style="margin-top:5px; height:5px; background:#e0e0e0; border-radius:3px; overflow:hidden;">';
        html += '<div style="height:100%; width:' + ptostBarPct + '%; background:' + ptostBarColor + '; border-radius:3px;"></div></div>';
        html += '</div>';

        // Reliability tier chip
        html += '<div style="background:' + tierBadgeBg + '; border:1px solid ' + tierBadgeColor + '33; border-radius:6px; padding:8px 10px;">';
        html += '<div style="font-size:0.7em; color:#607d8b; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:3px;">Reliability</div>';
        html += '<div style="font-size:1.25em; font-weight:700; color:' + tierBadgeColor + ';">' + tier.label + '</div>';
        html += '<div style="font-size:0.75em; color:' + tierBadgeColor + '; opacity:0.85;">' + (r.reliabilityHours || 0) + 'h against</div>';
        html += '</div>';

        // Unscheduled chip
        var unschedChipColor = unscheduledHours > 0 ? '#e65100' : '#2e7d32';
        html += '<div style="background:#fff; border:1px solid #ffe0b2; border-radius:6px; padding:8px 10px;">';
        html += '<div style="font-size:0.7em; color:#607d8b; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:3px;">Unscheduled</div>';
        html += '<div style="font-size:1.25em; font-weight:700; color:' + unschedChipColor + ';">' + unscheduledHours + 'h</div>';
        html += '<div style="font-size:0.75em; color:#90a4ae;">mismatch rows</div>';
        html += '</div>';

        // Payroll follow-up chip
        var followChipBg = payrollFollowUpNeeded ? '#fff8e1' : '#e8f5e9';
        var followChipColor = payrollFollowUpNeeded ? '#8a5300' : '#2e7d32';
        html += '<div style="background:' + followChipBg + '; border:1px solid ' + (payrollFollowUpNeeded ? '#ffe08a' : '#a5d6a7') + '; border-radius:6px; padding:8px 10px;">';
        html += '<div style="font-size:0.7em; color:#607d8b; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:3px;">Payroll Actions</div>';
        html += '<div style="font-size:1.25em; font-weight:700; color:' + followChipColor + ';">' + (payrollFollowUpNeeded ? payrollFollowUpCount + ' item' + (payrollFollowUpCount !== 1 ? 's' : '') : 'None') + '</div>';
        html += '<div style="font-size:0.75em; color:#90a4ae;">' + (payrollFollowUpNeeded ? 'need follow-up' : 'all clear') + '</div>';
        html += '</div>';

        html += '</div>'; // end grid row 1

        // Row 2: Correct Now / Hold two-column table (only if there are any)
        if (safeCorrectionRows.length > 0 || holdCorrectionRows.length > 0 || mismatchDates.length > 0) {
            html += '<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:4px;">';

            // Correct Now
            html += '<div style="background:#e8f5e9; border:1px solid #a5d6a7; border-radius:6px; padding:8px 10px;">';
            html += '<div style="font-size:0.72em; font-weight:700; color:#2e7d32; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:5px;">✓ Correct Now (stays ≤ 40h)</div>';
            if (safeCorrectionRows.length > 0) {
                safeCorrectionRows.forEach(function(row) {
                    html += '<div style="font-size:0.82em; color:#1b5e20; padding:1px 0;">' + escapeHtml(row) + '</div>';
                });
            } else {
                html += '<div style="font-size:0.82em; color:#90a4ae;">—</div>';
            }
            html += '</div>';

            // Hold
            html += '<div style="background:#fff8e1; border:1px solid #ffe082; border-radius:6px; padding:8px 10px;">';
            html += '<div style="font-size:0.72em; font-weight:700; color:#8a5300; text-transform:uppercase; letter-spacing:0.04em; margin-bottom:5px;">⏸ Hold (would exceed 40h)</div>';
            if (holdCorrectionRows.length > 0) {
                holdCorrectionRows.forEach(function(row) {
                    html += '<div style="font-size:0.82em; color:#6d4200; padding:1px 0;">' + escapeHtml(row) + '</div>';
                });
            } else {
                html += '<div style="font-size:0.82em; color:#90a4ae;">—</div>';
            }
            html += '</div>';

            html += '</div>'; // end two-col grid

            if (mismatchDates.length > 0) {
                html += '<div style="margin-top:6px; font-size:0.8em; color:#616161;">';
                html += '<span style="font-weight:600; color:#b71c1c;">⚠ Mismatched days (Verint/Payroll coding differs):</span> ';
                html += escapeHtml(mismatchDates.join(', '));
                html += '</div>';
            }
        }

        // Subtext: YTD delta status
        var deltaColor = unexplainedDelta == null ? '#555' : (Math.abs(unexplainedDelta) > 0.25 ? '#b71c1c' : '#2e7d32');
        var reconStatus, reconStatusColor;
        if (unexplainedDelta == null) {
            reconStatus = 'Partial coverage'; reconStatusColor = '#e65100';
        } else if (Math.abs(unexplainedDelta) <= 0.25) {
            reconStatus = 'Matched'; reconStatusColor = '#2e7d32';
        } else if (Math.abs(unexplainedDelta) <= 2) {
            reconStatus = 'Partial coverage'; reconStatusColor = '#e65100';
        } else {
            reconStatus = 'Needs correction'; reconStatusColor = '#b71c1c';
        }
        html += '<div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:12px; font-size:0.8em; color:#607d8b; border-top:1px solid #e0f2f1; padding-top:7px;">';
        html += '<span>Can still convert: <strong style="color:#00695c;">' + (r.correctableSameDayHours || 0) + 'h</strong> across ' + correctionCandidates.length + ' day(s)</span>';
        html += '<span>Still exposed: <strong style="color:' + (Number(r.remainingSameDayExposureHours || 0) > 0 ? '#b71c1c' : '#2e7d32') + ';">' + (r.remainingSameDayExposureHours || 0) + 'h</strong></span>';
        html += '<span>YTD delta: <strong style="color:' + deltaColor + ';">' + (unexplainedDelta == null ? '—' : (unexplainedDelta + 'h')) + '</strong> (' + reconStatus + ')</span>';
        html += '<span>PTOST threshold: <strong>' + ((r.ptostHoursUsed || 0) >= PTOST_BUFFER_LIMIT ? '<span style="color:#b71c1c;">Reached</span>' : 'Not reached') + '</strong></span>';
        html += '</div>';

        html += '</div>'; // end At a Glance

        // ── Missed / Flagged Day Summary ──────────────────────────────────────
        var missedRows = timeline.filter(function(t) {
            return t.category === 'same-day' || t.category === 'ptost' ||
                Number(t.sameDayExposureHours || 0) > 0 || Number(t.ptostOverage || 0) > 0 ||
                (t.flags || []).some(function(f) {
                    var s = String(f || '').toUpperCase();
                    return s.indexOf('DISCREPANCY') >= 0 || s.indexOf('PC ISSUE') >= 0 || s.indexOf('REVIEW') >= 0;
                });
        });

        if (missedRows.length > 0) {
            html += '<div style="margin-bottom:14px; padding:12px 14px; background:#fafcfd; border:1px solid #d0dde5; border-radius:8px;">';
            html += '<div style="font-weight:700; color:#37474f; font-size:0.88em; margin-bottom:8px; letter-spacing:0.02em;">Missed / Flagged Days (' + missedRows.length + ')</div>';
            html += '<table style="width:100%; border-collapse:collapse; font-size:0.81em;">';
            html += '<thead><tr style="background:#eceff1;">';
            html += '<th style="padding:5px 8px; text-align:left; border-bottom:1px solid #cfd8dc; white-space:nowrap;">Date</th>';
            html += '<th style="padding:5px 8px; text-align:left; border-bottom:1px solid #cfd8dc;">Verint</th>';
            html += '<th style="padding:5px 8px; text-align:left; border-bottom:1px solid #cfd8dc;">Payroll</th>';
            html += '<th style="padding:5px 8px; text-align:center; border-bottom:1px solid #cfd8dc; white-space:nowrap;">Hrs</th>';
            html += '<th style="padding:5px 8px; text-align:center; border-bottom:1px solid #cfd8dc; white-space:nowrap;">vs Reliability</th>';
            html += '</tr></thead><tbody>';

            missedRows.forEach(function(t) {
                var verintDesc = (t.verint || []).map(function(v) {
                    return escapeHtml(v.activity || v.type || '');
                }).filter(Boolean).join(', ') || '—';

                var nonRegPayroll = (t.payroll || []).filter(function(p) { return p.trc !== 'REG'; });
                var payrollDesc = nonRegPayroll.map(function(p) {
                    var s = p.trc;
                    if (p.taskCode) s += '/' + p.taskCode;
                    return s;
                }).join(', ') || '—';

                var totalHrs = round2(
                    (t.verint || []).filter(function(v) { return v.type !== 'planned'; })
                        .reduce(function(s, v) { return s + Number(v.hours || 0); }, 0) ||
                    nonRegPayroll.reduce(function(s, p) { return s + Number(p.quantity || 0); }, 0)
                );

                var exposure = round2(Number(t.sameDayExposureHours || 0));
                var overage = round2(Number(t.ptostOverage || 0));
                var hasDiscrepancy = (t.flags || []).some(function(f) { return String(f).toUpperCase().indexOf('DISCREPANCY') >= 0; });
                var hasPcIssue = (t.flags || []).some(function(f) { return String(f).toUpperCase().indexOf('PC ISSUE') >= 0; });
                var hasMismatch = (t.flags || []).some(function(f) { return String(f).toUpperCase().indexOf('REVIEW') >= 0; });

                var vsText, vsColor;
                if (exposure > 0) {
                    vsText = '+' + exposure + 'h';
                    vsColor = '#b71c1c';
                } else if (overage > 0) {
                    vsText = '+' + overage + 'h overage';
                    vsColor = '#e65100';
                } else if (hasDiscrepancy) {
                    vsText = '⚠ Discrepancy';
                    vsColor = '#e65100';
                } else if (hasPcIssue) {
                    vsText = 'PC Issue';
                    vsColor = '#1565c0';
                } else if (hasMismatch) {
                    vsText = 'Review';
                    vsColor = '#e65100';
                } else if (t.category === 'ptost' && t.ptostProtected !== false) {
                    vsText = 'Protected';
                    vsColor = '#2e7d32';
                } else {
                    vsText = '—';
                    vsColor = '#78909c';
                }

                var rowBg = (hasDiscrepancy || hasMismatch) ? 'background:#fff8e1;' : (exposure > 0 ? 'background:#fff5f5;' : '');
                html += '<tr style="border-bottom:1px solid #eceff1;' + rowBg + '">';
                html += '<td style="padding:5px 8px; white-space:nowrap; font-weight:600;">' + escapeHtml(t.dateStr) + '</td>';
                html += '<td style="padding:5px 8px; color:#455a64;">' + verintDesc + '</td>';
                html += '<td style="padding:5px 8px; color:#455a64;">' + escapeHtml(payrollDesc) + '</td>';
                html += '<td style="padding:5px 8px; text-align:center;">' + (totalHrs || '—') + '</td>';
                html += '<td style="padding:5px 8px; text-align:center; font-weight:700; color:' + vsColor + ';">' + vsText + '</td>';
                html += '</tr>';
            });

            html += '</tbody></table>';
            html += '</div>';
        }

        // Running bars
        var ptostPct = Math.min(100, ((r.ptostHoursUsed || 0) / PTOST_BUFFER_LIMIT) * 100);
        var ptostColor = ptostPct >= 100 ? '#b71c1c' : ptostPct >= 75 ? '#e65100' : '#2e7d32';
        var unschedPct = Math.min(100, ((r.unscheduledRunningHours || 0) / PTOST_BUFFER_LIMIT) * 100);
        var unschedColor = unschedPct >= 100 ? '#b71c1c' : unschedPct >= 75 ? '#ef6c00' : '#ff8f00';

        html += '<div style="margin-bottom:16px; display:grid; grid-template-columns:1fr; gap:8px;">';
        html += '<div>';
        html += '<div style="font-size:0.82em; font-weight:600; margin-bottom:4px;">PTOST Logged (' + (r.ptostHoursUsed || 0) + ' / ' + PTOST_BUFFER_LIMIT + 'h)</div>';
        html += '<div style="height:12px; background:#e0e0e0; border-radius:6px; overflow:hidden;">';
        html += '<div style="height:100%; width:' + ptostPct + '%; background:' + ptostColor + '; border-radius:6px; transition:width 0.3s;"></div>';
        html += '</div>';
        html += '</div>';
        html += '<div>';
        html += '<div style="font-size:0.82em; font-weight:600; margin-bottom:4px;">Unscheduled or Unplanned (' + (r.unscheduledRunningHours || 0) + 'h)</div>';
        html += '<div style="height:12px; background:#e0e0e0; border-radius:6px; overflow:hidden;">';
        html += '<div style="height:100%; width:' + unschedPct + '%; background:' + unschedColor + '; border-radius:6px; transition:width 0.3s;"></div>';
        html += '</div>';
        html += '</div>';
        html += '</div>';

        // Payroll visibility controls
        html += '<div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:10px; padding:8px 10px; background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; font-size:0.82em;">';
        html += '<strong style="color:#334155;">Show Payroll:</strong>';
        html += '<label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" id="relShowBrv" checked> BRV</label>';
        html += '<label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" id="relShowFmla" checked> FMLA</label>';
        html += '<label style="display:flex; align-items:center; gap:6px; cursor:pointer;"><input type="checkbox" id="relShowHoliday" checked> Holiday</label>';
        html += '<label style="display:flex; align-items:center; gap:6px; cursor:pointer; margin-left:8px; font-weight:700; color:#8a5300;"><input type="checkbox" id="relManagerMode" ' + (needsReviewCount > 0 ? 'checked' : '') + '> Manager Mode</label>';
        html += '</div>';

        // Filter tabs
        html += '<div style="display:flex; gap:6px; margin-bottom:12px; flex-wrap:wrap;">';
        html += '<button type="button" class="rel-filter-btn" data-filter="all" style="padding:4px 12px; border:1px solid #00695c; background:#00695c; color:#fff; border-radius:4px; cursor:pointer; font-size:0.82em; font-weight:600;">All (' + timeline.length + ')</button>';
        var catCounts = { ptost: 0, 'same-day': 0, planned: 0 };
        timeline.forEach(function(t) { if (catCounts[t.category] !== undefined) catCounts[t.category]++; });
        html += '<button type="button" class="rel-filter-btn" data-filter="same-day" style="padding:4px 12px; border:1px solid #b71c1c; background:#fff; color:#b71c1c; border-radius:4px; cursor:pointer; font-size:0.82em;">Same Day (' + catCounts['same-day'] + ')</button>';
        html += '<button type="button" class="rel-filter-btn" data-filter="ptost" style="padding:4px 12px; border:1px solid #2e7d32; background:#fff; color:#2e7d32; border-radius:4px; cursor:pointer; font-size:0.82em;">PTOST (' + catCounts.ptost + ')</button>';
        html += '<button type="button" class="rel-filter-btn" data-filter="planned" style="padding:4px 12px; border:1px solid #0d47a1; background:#fff; color:#0d47a1; border-radius:4px; cursor:pointer; font-size:0.82em;">Planned (' + catCounts.planned + ')</button>';
        if (needsReviewCount > 0) {
            html += '<button type="button" class="rel-filter-btn" data-filter="needs-review" style="padding:4px 12px; border:1px solid #f57f17; background:#fff; color:#f57f17; border-radius:4px; cursor:pointer; font-size:0.82em; font-weight:600;">Needs Review (' + needsReviewCount + ')</button>';
        }
        if ((r.pcIssueCandidates || []).length > 0) {
            html += '<button type="button" class="rel-filter-btn" data-filter="pc-issue" style="padding:4px 12px; border:1px solid #1565c0; background:#fff; color:#1565c0; border-radius:4px; cursor:pointer; font-size:0.82em;">PC Issues (' + r.pcIssueCandidates.length + ')</button>';
        }
        if ((r.discrepancies || []).length > 0) {
            html += '<button type="button" class="rel-filter-btn" data-filter="discrepancy" style="padding:4px 12px; border:1px solid #e65100; background:#fff; color:#e65100; border-radius:4px; cursor:pointer; font-size:0.82em;">Discrepancies (' + r.discrepancies.length + ')</button>';
        }
        html += '</div>';

        // Day-by-day timeline table
        html += '<div id="relTimelineTable">';
        html += buildTimelineTable(timeline, r.discrepancies || [], 'all', { showBrv: true, showFmla: true, showHoliday: true });
        html += '</div>';

        html += '<div style="margin-top:12px; padding:10px; background:#fafafa; border:1px solid #e6e6e6; border-radius:6px;">';
        html += '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:8px;">';
        html += '<strong style="color:#455a64; font-size:0.88em;">Payroll Action List (' + actionRows.length + ')</strong>';
        html += '<button type="button" id="relExportActionsCsv" style="padding:5px 10px; border:1px solid #607d8b; background:#fff; color:#455a64; border-radius:4px; cursor:pointer; font-size:0.8em;">Export CSV</button>';
        html += '</div>';
        if (actionRows.length === 0) {
            html += '<div style="font-size:0.82em; color:#78909c;">No actions currently needed.</div>';
        } else {
            html += '<div style="max-height:180px; overflow:auto; border:1px solid #eceff1; border-radius:4px;">';
            html += '<table style="width:100%; border-collapse:collapse; font-size:0.8em;">';
            html += '<thead><tr style="background:#f5f7f8;"><th style="padding:5px 6px; text-align:left;">Date</th><th style="padding:5px 6px; text-align:left;">Action</th><th style="padding:5px 6px; text-align:left;">Target</th><th style="padding:5px 6px; text-align:center;">Hours</th><th style="padding:5px 6px; text-align:left;">Detail</th></tr></thead><tbody>';
            actionRows.forEach(function(a) {
                html += '<tr style="border-top:1px solid #eef2f4;"><td style="padding:5px 6px; white-space:nowrap;">' + escapeHtml(a.date) + '</td><td style="padding:5px 6px;">' + escapeHtml(a.actionType) + '</td><td style="padding:5px 6px;">' + escapeHtml(a.target) + '</td><td style="padding:5px 6px; text-align:center;">' + escapeHtml(a.hours) + '</td><td style="padding:5px 6px;">' + escapeHtml(a.detail) + '</td></tr>';
            });
            html += '</tbody></table></div>';
        }
        html += '</div>';

        // Action buttons
        html += '<div style="display:flex; gap:10px; margin-top:16px; flex-wrap:wrap;">';

        html += '<button type="button" id="relCopySummary" style="padding:8px 16px; background:#37474f; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600;">📋 Copy Manager Summary</button>';

        if (((r.pcIssueCandidates || []).length + (correctionCandidates || []).length + (r.discrepancies || []).length) > 0) {
            html += '<button type="button" id="relEmailCorrections" style="padding:8px 16px; background:#0d47a1; color:#fff; border:none; border-radius:4px; cursor:pointer; font-weight:600;">✉ Open Corrections Email</button>';
        }

        html += '</div>';
        html += '</div>'; // end relClassicWrap
        html += '</div>'; // end outer panel

        container.innerHTML = html;

        // Tab toggle: Discrepancies (default) / Classic
        function setTab(which) {
            var discBtn = document.getElementById('relTabDisc');
            var classicBtn = document.getElementById('relTabClassic');
            var discView = document.getElementById('relDiscView');
            var classicWrap = document.getElementById('relClassicWrap');
            if (!discBtn || !classicBtn || !discView || !classicWrap) return;
            var active = which === 'classic' ? classicBtn : discBtn;
            var inactive = which === 'classic' ? discBtn : classicBtn;
            active.style.background = '#00695c'; active.style.color = '#fff';
            inactive.style.background = '#eceff1'; inactive.style.color = '#455a64';
            discView.style.display = which === 'classic' ? 'none' : '';
            classicWrap.style.display = which === 'classic' ? '' : 'none';
        }
        document.getElementById('relTabDisc')?.addEventListener('click', function() { setTab('disc'); });
        document.getElementById('relTabClassic')?.addEventListener('click', function() { setTab('classic'); });

        // Wire the Discrepancy view's action buttons to reuse Classic view handlers
        document.getElementById('relDiscCopySummary')?.addEventListener('click', function() {
            document.getElementById('relCopySummary')?.click();
        });
        document.getElementById('relDiscEmailCorrections')?.addEventListener('click', function() {
            document.getElementById('relEmailCorrections')?.click();
        });

        // Bind close
        document.getElementById('relCloseDetail')?.addEventListener('click', function() {
            container.style.display = 'none';
        });

        // Bind filter tabs and visibility controls
        var currentFilter = needsReviewCount > 0 ? 'needs-review' : 'all';

        if (currentFilter !== 'all') {
            var activeDefault = container.querySelector('.rel-filter-btn[data-filter="' + currentFilter + '"]');
            if (activeDefault) {
                container.querySelectorAll('.rel-filter-btn').forEach(function(b) {
                    b.style.background = '#fff';
                    b.style.fontWeight = 'normal';
                    b.style.color = b.style.borderColor;
                });
                activeDefault.style.background = activeDefault.style.borderColor;
                activeDefault.style.color = '#fff';
                activeDefault.style.fontWeight = '600';
                var tableDiv = document.getElementById('relTimelineTable');
                if (tableDiv) tableDiv.innerHTML = buildTimelineTable(timeline, r.discrepancies || [], currentFilter, getTimelineOptions());
            }
        }

        function getTimelineOptions() {
            return {
                showBrv: container.querySelector('#relShowBrv')?.checked !== false,
                showFmla: container.querySelector('#relShowFmla')?.checked !== false,
                showHoliday: container.querySelector('#relShowHoliday')?.checked !== false,
                managerMode: container.querySelector('#relManagerMode')?.checked === true
            };
        }

        function renderTimelineForCurrentView() {
            var tableDiv = document.getElementById('relTimelineTable');
            if (tableDiv) tableDiv.innerHTML = buildTimelineTable(timeline, r.discrepancies || [], currentFilter, getTimelineOptions());
        }

        container.querySelectorAll('.rel-filter-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                currentFilter = this.getAttribute('data-filter') || 'all';
                // Update active button style
                container.querySelectorAll('.rel-filter-btn').forEach(function(b) {
                    b.style.background = '#fff';
                    b.style.fontWeight = 'normal';
                });
                this.style.background = this.style.borderColor;
                this.style.color = '#fff';
                this.style.fontWeight = '600';
                // Re-render table
                renderTimelineForCurrentView();
            });
        });

        container.querySelector('#relShowBrv')?.addEventListener('change', renderTimelineForCurrentView);
        container.querySelector('#relShowFmla')?.addEventListener('change', renderTimelineForCurrentView);
        container.querySelector('#relShowHoliday')?.addEventListener('change', renderTimelineForCurrentView);
        container.querySelector('#relManagerMode')?.addEventListener('change', function() {
            var managerOn = container.querySelector('#relManagerMode')?.checked === true;
            if (managerOn) {
                currentFilter = 'needs-review';
                var reviewBtn = container.querySelector('.rel-filter-btn[data-filter="needs-review"]');
                if (reviewBtn) {
                    container.querySelectorAll('.rel-filter-btn').forEach(function(b) {
                        b.style.background = '#fff';
                        b.style.fontWeight = 'normal';
                        b.style.color = b.style.borderColor;
                    });
                    reviewBtn.style.background = reviewBtn.style.borderColor;
                    reviewBtn.style.color = '#fff';
                    reviewBtn.style.fontWeight = '600';
                }
            }
            renderTimelineForCurrentView();
        });

        // Bind email button
        document.getElementById('relEmailCorrections')?.addEventListener('click', function() {
            // Reconcile from latest stored data at click-time so open/stale panels can't miss rows.
            var latestStore = loadStore();
            var latestEmp = latestStore.employees?.[employeeName] || emp || {};
            var latestReconciled = reconcileEmployee(latestEmp.verint || null, latestEmp.payroll?.entries || null);
            if (!latestStore.employees) latestStore.employees = {};
            if (!latestStore.employees[employeeName]) latestStore.employees[employeeName] = latestEmp;
            latestStore.employees[employeeName].reconciled = latestReconciled;
            saveStore(latestStore);

            var draft = buildVerintCorrectionsDraft(
                employeeName,
                latestReconciled.correctionCandidates || [],
                latestReconciled.pcIssueCandidates || [],
                latestReconciled.discrepancies || [],
                latestReconciled.reviewCodingCandidates || []
            );
            openMailDraft(draft.subject, draft.body);
            if (typeof showToast === 'function') showToast('Opening Outlook draft for Verint corrections', 2500);
        });

        document.getElementById('relExportActionsCsv')?.addEventListener('click', function() {
            if (exportActionRowsCsv(actionRows, employeeName)) {
                if (typeof showToast === 'function') showToast('Reliability actions CSV downloaded', 3000);
            }
        });

        document.getElementById('relCopySummary')?.addEventListener('click', function() {
            var txt = buildReviewSummaryText(employeeName, r, ytdReliability, unexplainedDelta);
            copyAndNotify(txt, 'Review summary copied');
        });
    }

    function buildTimelineTable(timeline, discrepancies, filter, options) {
        var opts = options || { showBrv: true, showFmla: true, showHoliday: true, managerMode: false };
        var discDates = {};
        (discrepancies || []).forEach(function(d) { discDates[d.date] = true; });

        function isActionableRow(t) {
            var flags = t.flags || [];
            var hasActionFlag = flags.some(function(f) {
                var s = String(f || '').toLowerCase();
                return s.indexOf('review') >= 0 ||
                    s.indexOf('discrepancy') >= 0 ||
                    s.indexOf('pc issue candidate') >= 0 ||
                    s.indexOf('against reliability') >= 0 ||
                    s.indexOf('ptost over 40h') >= 0;
            });
            return hasActionFlag || Number(t.sameDayExposureHours || 0) > 0 || t.unscheduledRunning !== undefined;
        }

        function showVerintItem(v) {
            var activity = String(v?.activity || '').toLowerCase();
            if (!opts.showBrv && activity.indexOf('bereavement') >= 0) return false;
            if (!opts.showFmla && activity.indexOf('fmla') >= 0) return false;
            if (!opts.showHoliday && activity.indexOf('holiday') >= 0) return false;
            return true;
        }

        function showPayrollItem(p) {
            var trc = String(p?.trc || '').toUpperCase();
            if (!opts.showBrv && trc === 'BRV') return false;
            if (!opts.showFmla && (trc === 'FMLA' || trc === 'FMLNP')) return false;
            if (!opts.showHoliday && (trc === 'HOL' || trc === 'HOLIDAY')) return false;
            return true;
        }

        function rowHasVisibleData(t) {
            var verintVisible = (t.verint || []).some(showVerintItem);
            var payrollVisible = (t.payroll || []).some(function(p) { return p.trc !== 'REG' && showPayrollItem(p); });
            if (opts.managerMode && !isActionableRow(t)) return false;
            return verintVisible || payrollVisible || Boolean(discDates[t.dateStr]);
        }

        var filtered = timeline;
        if (filter === 'discrepancy') {
            filtered = timeline.filter(function(t) { return discDates[t.dateStr]; });
        } else if (filter === 'needs-review') {
            filtered = timeline.filter(function(t) {
                return (t.flags || []).some(function(f) {
                    var s = String(f || '').toLowerCase();
                    return s.indexOf('review') >= 0 ||
                        s.indexOf('discrepancy') >= 0 ||
                        s.indexOf('pc issue candidate') >= 0 ||
                        s.indexOf('against reliability') >= 0 ||
                        s.indexOf('ptost over 40h') >= 0;
                });
            });
        } else if (filter === 'pc-issue') {
            filtered = timeline.filter(function(t) {
                return (t.flags || []).some(function(f) { return String(f || '').indexOf('PC ISSUE CANDIDATE') >= 0; });
            });
        } else if (filter !== 'all') {
            filtered = timeline.filter(function(t) { return t.category === filter; });
        }

        filtered = filtered.filter(rowHasVisibleData);

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
        html += '<th style="padding:6px 8px; text-align:center; border-bottom:2px solid #ccc;">Running</th>';
        html += '<th style="padding:6px 8px; text-align:left; border-bottom:2px solid #ccc;">Flags</th>';
        html += '</tr></thead><tbody>';

        filtered.forEach(function(t) {
            var cat = CAT_STYLES[t.category] || CAT_STYLES.other;
            var hasFlag = t.flags && t.flags.length > 0;
            var isDiscrepancy = Boolean(discDates[t.dateStr]) || (hasFlag && t.flags.some(function(f) { return f.indexOf('DISCREPANCY') >= 0; }));
            var isPcIssue = hasFlag && t.flags.some(function(f) { return f.indexOf('PC ISSUE CANDIDATE') >= 0; });
            var isReliabilityReview = hasFlag && t.flags.some(function(f) {
                var s = String(f || '').toLowerCase();
                return s.indexOf('review') >= 0 || s.indexOf('against reliability') >= 0 || s.indexOf('ptost over 40h') >= 0;
            });
            var rowBg = isDiscrepancy
                ? '#ffe9e9'
                : (isPcIssue ? '#e8f1ff' : (isReliabilityReview ? '#fff8e1' : ''));
            var rowBorder = isDiscrepancy
                ? '4px solid #c62828'
                : (isPcIssue ? '4px solid #1565c0' : (isReliabilityReview ? '4px solid #f57f17' : 'none'));

            // Verint column
            var verintVisible = (t.verint || []).filter(showVerintItem);
            var verintText = verintVisible.map(function(v) { return v.activity + ' (' + v.hours + 'h)'; }).join('<br>') || '<span style="color:#999;">—</span>';

            // Payroll column
            var payrollVisible = (t.payroll || []).filter(function(p) { return p.trc !== 'REG' && showPayrollItem(p); });
            var payrollText = payrollVisible.map(function(p) {
                var label = p.trc;
                var taskCode = normalizeTaskCode(p.taskCode);
                if (taskCode) label += ' / ' + taskCode;
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
            verintVisible.forEach(function(v) { totalHours += v.hours; });
            var payrollNonReg = payrollVisible;
            if (payrollNonReg.length > 0) {
                totalHours = payrollNonReg.reduce(function(s, p) { return s + p.quantity; }, 0);
            }

            html += '<tr style="border-bottom:1px solid #eee;' + (rowBg ? ' background:' + rowBg + ';' : '') + ' border-left:' + rowBorder + ';">';
            html += '<td style="padding:6px 8px; white-space:nowrap;">' + escapeHtml(t.dateStr) + '</td>';
            html += '<td style="padding:6px 8px;"><span style="display:inline-block; padding:1px 6px; border-radius:3px; background:' + cat.bg + '; color:' + cat.color + '; font-weight:600; font-size:0.9em;">' + cat.icon + ' ' + cat.label + '</span></td>';
            html += '<td style="padding:6px 8px;">' + verintText + '</td>';
            html += '<td style="padding:6px 8px;">' + payrollText + '</td>';
            html += '<td style="padding:6px 8px; text-align:center; font-weight:600;">' + round2(totalHours) + '</td>';
            html += '<td style="padding:6px 8px; text-align:center;">';
            if (t.ptostRunning !== undefined) {
                var ptColor = t.ptostProtected ? '#2e7d32' : '#b71c1c';
                html += '<span style="color:' + ptColor + '; font-weight:600;">' + t.ptostRunning + 'h</span>';
            } else if (t.unscheduledRunning !== undefined) {
                html += '<span style="color:#e65100; font-weight:700;">Unsched ' + t.unscheduledRunning + 'h</span>';
            } else {
                html += '<span style="color:#ccc;">—</span>';
            }
            html += '</td>';
            html += '<td style="padding:6px 8px; font-size:0.9em;">';
            if (t.flags && t.flags.length > 0) {
                if (isDiscrepancy || isPcIssue || isReliabilityReview) {
                    html += '<div style="display:inline-block; margin-bottom:4px; padding:1px 6px; border-radius:8px; font-size:0.78em; font-weight:700; background:#fff3cd; color:#8a5300; border:1px solid #ffe08a;">REVIEW</div>';
                }
                html += t.flags.map(function(f) {
                    var fColor = f.indexOf('DISCREPANCY') >= 0
                        ? '#b71c1c'
                        : f.indexOf('PC ISSUE CANDIDATE') >= 0
                            ? '#1565c0'
                            : f.indexOf('reliability') >= 0
                                ? '#b71c1c'
                                : '#666';
                    return '<div style="color:' + fColor + ';">' + escapeHtml(f) + '</div>';
                }).join('');
            } else if (isDiscrepancy) {
                html += '<div style="color:#b71c1c; font-weight:700;">⚠ Discrepancy</div>';
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
        var hint = container.querySelector('#relSelectionHint');

        select?.addEventListener('change', function() {
            var name = this.value;
            var panel = document.getElementById('relDetailPanel');
            if (!panel) return;
            if (!name) {
                panel.style.display = 'none';
                if (hint) hint.style.display = '';
                return;
            }
            panel.style.display = 'block';
            if (hint) hint.style.display = 'none';
            renderEmployeeDetail(panel, name);
            panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        if (!verint.employeeName) {
            var selectedMembers = window.DevCoachModules?.teamFilter?.getTeamSelectionContext?.()?.selectedMembers || [];
            var inferred = inferEmployeeNameFromFileName(file?.name || '', selectedMembers);
            if (inferred) verint.employeeName = inferred;
            else if (selectedMembers.length === 1) verint.employeeName = selectedMembers[0];
            else throw new Error('Could not find employee name in Verint file. Include Employee/Employee Name in export, or include employee name in filename.');
        }

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
