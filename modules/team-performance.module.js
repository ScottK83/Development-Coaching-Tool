(function () {
    'use strict';

    /*
     * TEAM PERFORMANCE (Scott, 2026-11-13)
     *
     * "Build a working Team Performance page I can use to write my year-end
     * self-review." The team's five scorecard KPIs (the five that carry
     * year-end rating bands in metric-profiles) in one period against another:
     * the result in each, the change, the goal, and whether the team met it.
     * A copy button writes the results and a first-person draft as plain text.
     *
     * Nothing here is a new way of counting:
     *  - Which uploads make up a period is quarter-trend's rule. One
     *    granularity (quarter, month or week uploads), the one covering the
     *    most of the dates; an upload belongs where its END date falls;
     *    overlapping copies are dropped. So "January" is the weeks ending in
     *    January, the same January period-compare and the Teams page show.
     *  - Each associate's figure across those uploads is period-compare's
     *    aggregateEmployeesFrom: rates by calls, Rep Sat by its own responses,
     *    missed hours summed.
     *  - The team figure is the Teams page's (matchup, Team Snapshot): rates by
     *    calls, Rep Sat by responses, reliability as the average person's hours.
     *  - Goals, direction and display precision come from metric-profiles and
     *    the registry, judged as printed.
     *
     * Missing stays missing. No surveys is no Rep Sat, never 0%. A 0 second
     * handle time is no calls. A file with no attendance column is no
     * reliability, not perfect attendance.
     *
     * When the uploads do not cover a period, official team figures typed on
     * the page stand in. They are saved under teamPerformanceFigures, keyed by
     * team and exact dates, and synced like the other hand-typed stores.
     */

    var PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
    var FIGURES_KEY = PREFIX + 'teamPerformanceFigures';
    // The dates and team picked on this computer. View state, never synced.
    var VIEW_KEY = PREFIX + 'teamPerformanceView';

    // An upload may start up to six days before a period's first day, the way
    // a month rebuilt from weeks takes the week that ends on its 4th.
    var LEAD_IN_DAYS = 6;
    // A stretch this long with no upload is a gap worth saying out loud. Six
    // days at the end of a month is only the week that ends next month.
    var GAP_DAYS = 7;
    // Reliability's goal is hours for the year. A period this long is judged
    // against it; anything shorter is not.
    var FULL_YEAR_DAYS = 300;

    var KPIS = [
        { key: 'aht', label: 'Average Handle Time', weightBy: 'calls' },
        { key: 'scheduleAdherence', label: 'Schedule Adherence', weightBy: 'calls' },
        { key: 'overallSentiment', label: 'Overall Sentiment', weightBy: 'calls' },
        { key: 'cxRepOverall', label: 'Rep Satisfaction', weightBy: 'survey' },
        { key: 'reliability', label: 'Reliability', weightBy: 'person' }
    ];

    // Upload types that describe a stretch that is not finished.
    var PARTIAL_TYPES = ['week-in-progress', 'month-to-date', 'custom'];

    var MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    function mods() { return window.DevCoachModules || {}; }

    function escapeHtml(value) {
        var shared = mods().sharedUtils && mods().sharedUtils.escapeHtml;
        if (typeof shared === 'function') return shared(value);
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    /* ── Dates, as YYYY-MM-DD strings at local midnight ── */

    function pad2(n) { return (n < 10 ? '0' : '') + n; }

    function isoDate(d) {
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    function parseIso(text) {
        var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || '').trim());
        if (!m) return null;
        var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
        return isNaN(d.getTime()) || isoDate(d) !== m[0] ? null : d;
    }

    function addDays(iso, n) {
        var d = parseIso(iso);
        if (!d) return null;
        return isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
    }

    // Days from a to b, both counted.
    function dayCount(a, b) {
        var da = parseIso(a), db = parseIso(b);
        if (!da || !db) return 0;
        var utcA = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate());
        var utcB = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate());
        return Math.round((utcB - utcA) / 86400000) + 1;
    }

    function todayIso() { return isoDate(new Date()); }

    function fmtDate(iso, withYear) {
        var d = parseIso(iso);
        if (!d) return String(iso || '');
        var text = MONTHS_SHORT[d.getMonth()] + ' ' + d.getDate();
        return withYear === false ? text : text + ', ' + d.getFullYear();
    }

    // "Jan 5 to Jan 25, 2026", or both years when they differ.
    function fmtRange(start, end) {
        if (!start || !end) return '';
        if (String(start).slice(0, 4) === String(end).slice(0, 4)) {
            return fmtDate(start, false) + ' to ' + fmtDate(end);
        }
        return fmtDate(start) + ' to ' + fmtDate(end);
    }

    function monthRange(year, monthIndex) {
        var start = new Date(year, monthIndex, 1);
        var end = new Date(year, monthIndex + 1, 0);
        return { start: isoDate(start), end: isoDate(end) };
    }

    function quarterRange(year, quarter) {
        return { start: isoDate(new Date(year, (quarter - 1) * 3, 1)), end: isoDate(new Date(year, quarter * 3, 0)) };
    }

    // "January 2026" or "Q1 2026" when the dates are exactly that, otherwise
    // the dates themselves.
    function periodName(start, end) {
        var s = parseIso(start), e = parseIso(end);
        if (!s || !e) return '';
        var month = monthRange(s.getFullYear(), s.getMonth());
        if (month.start === start && month.end === end) return MONTHS_LONG[s.getMonth()] + ' ' + s.getFullYear();
        if (s.getMonth() % 3 === 0) {
            var q = Math.floor(s.getMonth() / 3) + 1;
            var quarter = quarterRange(s.getFullYear(), q);
            if (quarter.start === start && quarter.end === end) return 'Q' + q + ' ' + s.getFullYear();
        }
        return fmtRange(start, end);
    }

    /* ── Stores ── */

    function _weeklyData() { return typeof weeklyData !== 'undefined' ? weeklyData : {}; }
    function _coachingHistory() { return typeof coachingHistory !== 'undefined' ? coachingHistory : {}; }

    function norm(name) {
        return String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();
    }

    function registryEntry(key) {
        var reg = window.METRICS_REGISTRY || mods().metricsRegistry || {};
        return reg[key] || null;
    }

    function unitOf(key) {
        var entry = registryEntry(key);
        if (entry && entry.unit) return entry.unit;
        return key === 'aht' ? 'sec' : (key === 'reliability' ? 'hrs' : '%');
    }

    function isLowerBetter(key) {
        if (typeof window.isReverseMetric === 'function') return Boolean(window.isReverseMetric(key));
        var entry = registryEntry(key);
        return entry ? entry.isReverse === true : (key === 'aht' || key === 'reliability');
    }

    function noiseOf(key) {
        if (typeof window.getMetricNoiseThreshold === 'function') {
            var n = window.getMetricNoiseThreshold(key);
            if (Number.isFinite(n) && n > 0) return n;
        }
        return unitOf(key) === 'sec' ? 5 : (unitOf(key) === 'hrs' ? 0.5 : 1);
    }

    function surveyWeight(row) {
        if (typeof window.getSurveyWeight === 'function') {
            var w = window.getSurveyWeight('cxRepOverall', row);
            return Number.isFinite(w) ? w : 0;
        }
        var own = parseInt(row && row.repSurveyTotal, 10);
        if (Number.isInteger(own)) return own;
        var all = parseInt(row && row.surveyTotal, 10);
        return Number.isInteger(all) ? all : 0;
    }

    // Judged as printed, the way every other surface judges, so "93.0%" is
    // never below a 93 goal.
    function roundShown(key, value) {
        var profiles = mods().metricProfiles;
        if (profiles && typeof profiles.roundToDisplayPrecision === 'function') {
            return profiles.roundToDisplayPrecision(key, value);
        }
        return unitOf(key) === 'sec' ? Math.round(value) : Math.round(value * 10) / 10;
    }

    function targetFor(key, year) {
        var profiles = mods().metricProfiles;
        var target = profiles && profiles.getYearTarget ? profiles.getYearTarget(key, year) : null;
        if (target) return target;
        var entry = registryEntry(key);
        return entry ? entry.target || null : null;
    }

    function meetsTarget(key, value, target) {
        if (!target || !Number.isFinite(value)) return null;
        var profiles = mods().metricProfiles;
        if (profiles && typeof profiles.valueMeetsTarget === 'function') return profiles.valueMeetsTarget(key, value, target);
        return target.type === 'max' ? value <= target.value : value >= target.value;
    }

    /* ── Formatting ── */

    function fmtValue(key, value) {
        if (!Number.isFinite(value)) return 'No data';
        var unit = unitOf(key);
        if (unit === 'sec') return Math.round(value) + ' sec';
        if (unit === 'hrs') return value.toFixed(1) + ' hrs';
        return value.toFixed(1) + '%';
    }

    // The change in the KPI's own units: points for a rate, never a percent
    // of a percent.
    function fmtChange(key, change) {
        if (!Number.isFinite(change)) return '';
        if (change === 0) return 'No change';
        var sign = change > 0 ? '+' : '-';
        var size = Math.abs(change);
        var unit = unitOf(key);
        if (unit === 'sec') return sign + Math.round(size) + ' sec';
        if (unit === 'hrs') return sign + size.toFixed(1) + ' hrs';
        return sign + size.toFixed(1) + ' pts';
    }

    // "up 5.0 points", "down 24 seconds", "down 1.5 hours".
    function changeInWords(key, change) {
        if (!Number.isFinite(change)) return '';
        if (change === 0) return 'no change';
        var dir = change > 0 ? 'up ' : 'down ';
        var size = Math.abs(change);
        var unit = unitOf(key);
        if (unit === 'sec') {
            var secs = Math.round(size);
            return dir + secs + (secs === 1 ? ' second' : ' seconds');
        }
        if (unit === 'hrs') return dir + size.toFixed(1) + (size === 1 ? ' hour' : ' hours');
        return dir + size.toFixed(1) + (size === 1 ? ' point' : ' points');
    }

    function goalText(key, target) {
        if (!target || !Number.isFinite(target.value)) return 'No goal on file';
        var unit = unitOf(key);
        var v = unit === 'sec' ? Math.round(target.value) + ' sec'
            : (unit === 'hrs' ? target.value + ' hrs' : target.value + '%');
        if (key === 'reliability') return v + ' or less for the year';
        return v + (target.type === 'max' ? ' or lower' : ' or higher');
    }

    /* ── Teams ── */

    // My team first, then each supervisor's team, then the whole center. My
    // team is team-scope's answer, so it is the same people the Today page
    // and the Teams page call mine.
    function listTeams() {
        var scope = mods().teamScope || {};
        var map = (scope.getSupervisorMap && scope.getSupervisorMap()) || {};
        var myLabel = (scope.getMyLabel && scope.getMyLabel()) || null;
        var mine = (scope.getMyTeamNames && scope.getMyTeamNames()) || [];
        var teams = [{
            id: 'mine',
            label: myLabel ? 'My team (' + myLabel + ')' : 'My team',
            shortLabel: 'my team',
            supervisor: myLabel,
            names: mine.slice()
        }];
        var byLabel = {};
        Object.keys(map).forEach(function (name) {
            var label = String(map[name] || '').trim();
            if (!label || label === myLabel) return;
            (byLabel[label] = byLabel[label] || []).push(name);
        });
        Object.keys(byLabel).sort().forEach(function (label) {
            teams.push({ id: 'sup:' + label, label: label + '\'s team', shortLabel: label + '\'s team', supervisor: label, names: byLabel[label] });
        });
        teams.push({ id: 'center', label: 'Whole center', shortLabel: 'the center', supervisor: null, names: null });
        return teams;
    }

    function rosterSetOf(team) {
        if (!team || !team.names) return null;
        return new Set(team.names.map(norm).filter(Boolean));
    }

    /* ── Which uploads make up a period ── */

    function describeAll(store) {
        var qt = mods().quarterTrend;
        return qt && qt.describePeriods ? qt.describePeriods(store || _weeklyData()) : [];
    }

    function hasRosterMember(entry, rosterSet) {
        if (!rosterSet) return true;
        return ((entry && entry.employees) || []).some(function (emp) {
            return emp && rosterSet.has(norm(emp.name));
        });
    }

    // Stretches inside [start, end] that no kept upload covers, GAP_DAYS or
    // longer. Days after today are not missing, they have not happened.
    function findGaps(kept, start, end) {
        var stop = end < todayIso() ? end : addDays(todayIso(), -1);
        var gaps = [];
        if (!stop || stop < start) return gaps;
        var cursor = start;
        var push = function (from, to) {
            if (to >= from && dayCount(from, to) >= GAP_DAYS) gaps.push({ start: from, end: to });
        };
        kept.slice().sort(function (a, b) { return a.startDate.localeCompare(b.startDate); }).forEach(function (p) {
            if (p.startDate > cursor) push(cursor, addDays(p.startDate, -1) > stop ? stop : addDays(p.startDate, -1));
            var next = addDays(p.endDate, 1);
            if (next > cursor) cursor = next;
        });
        if (cursor <= stop) push(cursor, stop);
        return gaps;
    }

    /**
     * The uploads that make up [start, end], by quarter-trend's rule: one
     * granularity, the one that covers the most of the dates, ties going to
     * the coarser one because its edges line up with the calendar.
     *
     * options.periods  describePeriods output, to avoid re-reading the store
     * options.rosterSet  only uploads with someone from the team in them
     */
    function resolveRange(start, end, options) {
        var opts = options || {};
        var out = {
            start: start, end: end, ok: false, periods: [], granularity: null, sourceLabel: '',
            spanStart: null, spanEnd: null, coveredDays: 0, rangeDays: 0, gaps: [], partial: false
        };
        var s = parseIso(start), e = parseIso(end);
        var qt = mods().quarterTrend;
        if (!s || !e || e < s || !qt) return out;
        out.rangeDays = dayCount(start, end);

        var periods = opts.periods || describeAll(opts.store);
        var leadIn = addDays(start, -LEAD_IN_DAYS);
        var inRange = periods.filter(function (p) {
            return p.endDate >= start && p.endDate <= end && p.startDate >= leadIn;
        });

        var startMs = s.getTime(), endMs = e.getTime();
        var candidates = qt.GRANULARITIES.map(function (g) {
            var mine = inRange.filter(function (p) {
                return g.types.indexOf(p.type) >= 0 && hasRosterMember(p.entry, opts.rosterSet || null);
            });
            if (!mine.length) return null;
            var kept = qt.dropContained(mine);
            return { granularity: g.id, sourceLabel: g.label, periods: kept, covered: qt.coveredDays(kept, startMs, endMs) };
        }).filter(Boolean);
        if (!candidates.length) {
            out.gaps = findGaps([], start, end);
            return out;
        }

        // A day of slack, as quarter-trend gives it, so months missing one
        // boundary day do not lose to weeks reaching one day further.
        var best = candidates[0];
        candidates.forEach(function (c) { if (c.covered > best.covered + 1) best = c; });

        out.ok = true;
        out.periods = best.periods;
        out.granularity = best.granularity;
        out.sourceLabel = best.sourceLabel;
        out.coveredDays = best.covered;
        out.spanStart = best.periods.reduce(function (m, p) { return !m || p.startDate < m ? p.startDate : m; }, null);
        out.spanEnd = best.periods.reduce(function (m, p) { return !m || p.endDate > m ? p.endDate : m; }, null);
        out.gaps = findGaps(best.periods, start, end);
        out.partial = best.periods.some(function (p) { return PARTIAL_TYPES.indexOf(p.type) >= 0; });
        return out;
    }

    // "4 weekly uploads", "1 monthly upload".
    function describeSource(range) {
        if (!range || !range.ok) return 'No upload covers these dates';
        var n = range.periods.length;
        var noun = range.granularity === 'quarter' ? 'quarterly upload'
            : (range.granularity === 'month' ? 'monthly upload' : 'weekly upload');
        return n + ' ' + noun + (n === 1 ? '' : 's');
    }

    /* ── The team's figure for one period ── */

    // One associate's value for a KPI, or null when there is nothing real.
    function personValue(kpi, row, carried) {
        if (kpi.key === 'reliability') {
            var seen = carried && carried[row.name];
            if (!seen || !seen.reliabilityAny) return null;
            var hours = parseFloat(row.reliability);
            return Number.isFinite(hours) ? hours : null;
        }
        var v = parseFloat(row[kpi.key]);
        if (!Number.isFinite(v)) return null;
        // A 0 second handle time means no calls, never a win.
        if (kpi.key === 'aht' && v <= 0) return null;
        if (kpi.weightBy === 'survey' && !(surveyWeight(row) > 0)) return null;
        return v;
    }

    function teamKpi(kpi, rows, carried) {
        var n = 0, wSum = 0, wTotal = 0, calls = 0, responses = 0, anyCalls = false;
        rows.forEach(function (row) {
            var v = personValue(kpi, row, carried);
            if (v === null) return;
            var w = 1;
            if (kpi.weightBy === 'calls') {
                var c = parseInt(row.totalCalls, 10);
                if (c > 0) { w = c; calls += c; anyCalls = true; }
            } else if (kpi.weightBy === 'survey') {
                w = surveyWeight(row);
                responses += w;
            }
            if (!(w > 0)) return;
            n += 1;
            wSum += v * w;
            wTotal += w;
        });
        var method = kpi.weightBy === 'survey' ? 'responses'
            : (kpi.weightBy === 'person' ? 'person' : (anyCalls ? 'calls' : 'plain'));
        return { value: wTotal > 0 ? wSum / wTotal : null, n: n, calls: calls, responses: responses, method: method, official: false };
    }

    function buildTeamResult(range, team) {
        var result = { kpis: {}, members: [], rows: [] };
        var pc = mods().periodCompare, qt = mods().quarterTrend;
        if (range && range.ok && pc && qt) {
            var rosterSet = rosterSetOf(team);
            var rows = pc.aggregateEmployeesFrom(range.periods.map(function (p) { return p.entry; }));
            var carried = qt.columnsCarried(range.periods);
            rows = rows.filter(function (r) { return !rosterSet || rosterSet.has(norm(r.name)); });
            result.rows = rows;
            KPIS.forEach(function (kpi) { result.kpis[kpi.key] = teamKpi(kpi, rows, carried); });
            result.members = rows.filter(function (r) {
                return KPIS.some(function (kpi) { return personValue(kpi, r, carried) !== null; });
            }).map(function (r) { return r.name; }).sort();
        } else {
            KPIS.forEach(function (kpi) { result.kpis[kpi.key] = teamKpi(kpi, [], {}); });
        }
        return result;
    }

    /* ── Official figures, typed in ── */

    function figureKey(teamId, start, end) {
        return String(teamId) + '|' + start + '|' + end;
    }

    function loadFigures() {
        try {
            var raw = localStorage.getItem(FIGURES_KEY);
            var parsed = raw ? JSON.parse(raw) : {};
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function figuresFor(teamId, start, end) {
        var all = loadFigures();
        return all[figureKey(teamId, start, end)] || null;
    }

    // values: { kpiKey: number|null }. All blank removes the entry.
    function saveFigures(teamId, start, end, values) {
        var all = loadFigures();
        var key = figureKey(teamId, start, end);
        var clean = {};
        KPIS.forEach(function (kpi) {
            var v = values ? values[kpi.key] : null;
            if (Number.isFinite(v)) clean[kpi.key] = v;
        });
        if (Object.keys(clean).length) {
            all[key] = { values: clean, savedAt: new Date().toISOString() };
        } else {
            delete all[key];
        }
        try {
            localStorage.setItem(FIGURES_KEY, JSON.stringify(all));
            return true;
        } catch (e) {
            return false;
        }
    }

    /**
     * A typed figure, or null for blank. AHT takes seconds or m:ss; the rates
     * take 87.5 or 87.5%; reliability takes hours. Anything else is refused
     * with a reason rather than guessed at.
     */
    function parseEnteredValue(key, text) {
        var raw = String(text == null ? '' : text).trim();
        if (!raw) return { value: null };
        var unit = unitOf(key);
        var value;
        if (unit === 'sec' && /^\d+:\d{1,2}$/.test(raw)) {
            var parts = raw.split(':');
            value = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
        } else {
            var cleaned = raw.replace(/,/g, '').replace(/\s*(%|sec|secs|seconds|s|hrs|hours|hr|h)$/i, '');
            value = /^-?\d+(\.\d+)?$/.test(cleaned) ? parseFloat(cleaned) : NaN;
        }
        if (!Number.isFinite(value)) return { value: null, error: 'Not a number' };
        if (unit === '%' && (value < 0 || value > 100)) return { value: null, error: 'Between 0 and 100' };
        if (unit === 'sec' && (value <= 0 || value > 3600)) return { value: null, error: 'Seconds, 1 to 3600' };
        if (unit === 'hrs' && (value < 0 || value > 2000)) return { value: null, error: 'Hours, 0 or more' };
        return { value: value };
    }

    function applyFigures(result, figures) {
        if (!figures || !figures.values) return;
        KPIS.forEach(function (kpi) {
            var v = figures.values[kpi.key];
            if (!Number.isFinite(v)) return;
            result.kpis[kpi.key] = {
                value: v, n: null, calls: 0, responses: 0,
                method: 'official', official: true, savedAt: figures.savedAt || null
            };
        });
    }

    /* ── One KPI, two periods ── */

    function compareKpi(kpi, base, comp, ctx) {
        var b = base && Number.isFinite(base.value) ? roundShown(kpi.key, base.value) : null;
        var c = comp && Number.isFinite(comp.value) ? roundShown(kpi.key, comp.value) : null;
        var lowerBetter = isLowerBetter(kpi.key);
        var row = {
            key: kpi.key, label: kpi.label, lowerIsBetter: lowerBetter,
            baseline: base, comparison: comp, baselineValue: b, comparisonValue: c,
            change: null, status: 'missing', steps: 0,
            target: null, met: null, baselineMet: null, annualGoal: kpi.key === 'reliability'
        };
        if (b !== null && c !== null) {
            var places = unitOf(kpi.key) === 'sec' ? 1 : 10;
            row.change = Math.round((c - b) * places) / places;
            if (row.change === 0) row.status = 'level';
            else row.status = (lowerBetter ? row.change < 0 : row.change > 0) ? 'improved' : 'declined';
            row.steps = Math.abs(row.change) / noiseOf(kpi.key);
        }

        row.target = targetFor(kpi.key, ctx.comparisonYear);
        var baseTarget = targetFor(kpi.key, ctx.baselineYear);
        // Hours for the year are not judged on a month: 3 hours in March
        // against an 18 hour year would pass everyone.
        var judgeComp = !row.annualGoal || ctx.comparisonDays >= FULL_YEAR_DAYS;
        var judgeBase = !row.annualGoal || ctx.baselineDays >= FULL_YEAR_DAYS;
        row.met = judgeComp && c !== null ? meetsTarget(kpi.key, c, row.target) : null;
        row.baselineMet = judgeBase && b !== null ? meetsTarget(kpi.key, b, baseTarget) : null;
        row.judged = judgeComp;
        return row;
    }

    /* ── Who was counted ── */

    function rosterChange(team, base, comp) {
        var baseSet = new Set(base.members.map(norm));
        var compSet = new Set(comp.members.map(norm));
        var nameOf = {};
        base.members.concat(comp.members).forEach(function (n) { nameOf[norm(n)] = n; });
        var both = [], onlyBase = [], onlyComp = [];
        Object.keys(nameOf).forEach(function (k) {
            if (baseSet.has(k) && compSet.has(k)) both.push(nameOf[k]);
            else if (baseSet.has(k)) onlyBase.push(nameOf[k]);
            else onlyComp.push(nameOf[k]);
        });
        var neither = (team && team.names ? team.names : []).filter(function (n) {
            return !baseSet.has(norm(n)) && !compSet.has(norm(n));
        });
        var sort = function (a) { return a.sort(function (x, y) { return x.localeCompare(y); }); };
        return {
            rosterSize: team && team.names ? team.names.length : null,
            baselineCount: base.members.length,
            comparisonCount: comp.members.length,
            both: sort(both), onlyBaseline: sort(onlyBase), onlyComparison: sort(onlyComp), neither: sort(neither),
            changed: onlyBase.length > 0 || onlyComp.length > 0
        };
    }

    /* ── Reliability for the year, from the newest year-to-date upload ── */

    function reliabilityYearToDate(team, year) {
        var pc = mods().periodCompare;
        if (!pc || !pc.latestYtdThrough || !pc.latestYtdReliability) return null;
        var through = pc.latestYtdThrough(year);
        if (!through) return null;
        var hours = pc.latestYtdReliability(year) || {};
        var rosterSet = rosterSetOf(team);
        var values = Object.keys(hours).filter(function (name) {
            return !rosterSet || rosterSet.has(norm(name));
        }).map(function (name) { return hours[name]; }).filter(Number.isFinite);
        if (!values.length) return null;
        var target = targetFor('reliability', year);
        var average = values.reduce(function (a, b) { return a + b; }, 0) / values.length;
        var under = values.filter(function (v) { return meetsTarget('reliability', v, target) === true; }).length;
        return { year: year, through: through, average: roundShown('reliability', average), n: values.length, under: under, target: target };
    }

    /* ── Coaching that was written down ── */

    function metricLabel(key) {
        var kpi = KPIS.filter(function (k) { return k.key === key; })[0];
        if (kpi) return kpi.label;
        var entry = registryEntry(key);
        return entry && entry.label ? entry.label : key;
    }

    // Records in the coaching log for the team between two dates. A count of
    // what was logged, never a claim about what it did.
    function documentedCoaching(team, start, end) {
        var history = _coachingHistory() || {};
        var rosterSet = rosterSetOf(team);
        var records = 0, people = {}, byMetric = {};
        Object.keys(history).forEach(function (name) {
            if (rosterSet && !rosterSet.has(norm(name))) return;
            var list = Array.isArray(history[name]) ? history[name] : [];
            list.forEach(function (entry) {
                var day = String((entry && entry.generatedAt) || '').slice(0, 10);
                if (!parseIso(day) || day < start || day > end) return;
                records += 1;
                people[norm(name)] = true;
                ((entry && entry.metricsCoached) || []).forEach(function (m) {
                    byMetric[m] = (byMetric[m] || 0) + 1;
                });
            });
        });
        var topics = Object.keys(byMetric).map(function (k) {
            return { key: k, label: metricLabel(k), count: byMetric[k] };
        }).sort(function (a, b) { return b.count - a.count || a.label.localeCompare(b.label); });
        return { start: start, end: end, records: records, associates: Object.keys(people).length, topics: topics };
    }

    /* ── Month list and defaults ── */

    function yearsOnFile() {
        var years = {};
        var now = new Date().getFullYear();
        describeAll().forEach(function (p) {
            var y = parseInt(p.endDate.slice(0, 4), 10);
            if (y <= now) years[y] = true;
        });
        years[now] = true;
        return Object.keys(years).map(Number).sort(function (a, b) { return b - a; });
    }

    // The review year: the newest year with uploads in it, so the first days
    // of January still open on the year being reviewed.
    function defaultYear() {
        var now = new Date().getFullYear();
        var newest = 0;
        describeAll().forEach(function (p) {
            var y = parseInt(p.endDate.slice(0, 4), 10);
            if (y <= now && y > newest) newest = y;
        });
        return newest || now;
    }

    function monthOptions(year, team, periods) {
        var today = todayIso();
        var all = periods || describeAll();
        var rosterSet = rosterSetOf(team);
        var out = [];
        for (var m = 0; m < 12; m += 1) {
            var r = monthRange(year, m);
            if (r.start > today) break;
            var range = resolveRange(r.start, r.end, { periods: all, rosterSet: rosterSet });
            var result = range.ok ? buildTeamResult(range, team) : null;
            var hasData = !!(result && result.members.length);
            var ended = r.end < today;
            out.push({
                key: r.start.slice(0, 7), label: MONTHS_LONG[m] + ' ' + year, start: r.start, end: r.end,
                hasData: hasData, ended: ended,
                complete: hasData && ended && !range.partial && range.gaps.length === 0
            });
        }
        return out;
    }

    /**
     * First complete month of the year against the latest complete one. Less
     * than two complete months falls back to the first and latest months with
     * any numbers; none at all gives January against the last month that has
     * ended, ready for typed figures.
     */
    function defaultPeriods(year, team, periods) {
        var months = monthOptions(year, team, periods);
        var complete = months.filter(function (m) { return m.complete; });
        var withData = months.filter(function (m) { return m.hasData; });
        var pick = function (m, fallback) { return m ? { start: m.start, end: m.end } : fallback; };
        if (complete.length >= 2) {
            return { baseline: pick(complete[0]), comparison: pick(complete[complete.length - 1]), reason: 'complete' };
        }
        if (withData.length >= 2) {
            var base = complete[0] || withData[0];
            var later = withData.filter(function (m) { return m.start > base.start; });
            var comp = later.filter(function (m) { return m.complete; }).pop() || later[later.length - 1];
            return { baseline: pick(base), comparison: pick(comp), reason: 'partial' };
        }
        var ended = months.filter(function (m) { return m.ended; });
        var first = monthRange(year, 0);
        var last = ended.length ? ended[ended.length - 1] : (months[months.length - 1] || first);
        return { baseline: pick(months[0], first), comparison: pick(last), reason: 'none' };
    }

    /* ── The whole comparison ── */

    function buildModel(view, options) {
        var opts = options || {};
        var teams = opts.teams || listTeams();
        var team = teams.filter(function (t) { return t.id === view.teamId; })[0] || teams[0];
        var periods = opts.periods || describeAll();
        var rosterSet = rosterSetOf(team);

        function side(dates) {
            var range = resolveRange(dates.start, dates.end, { periods: periods, rosterSet: rosterSet });
            var result = buildTeamResult(range, team);
            var figures = figuresFor(team.id, dates.start, dates.end);
            applyFigures(result, figures);
            return {
                start: dates.start, end: dates.end, name: periodName(dates.start, dates.end),
                days: dayCount(dates.start, dates.end), range: range, result: result, figures: figures,
                inProgress: dates.end >= todayIso() || range.partial
            };
        }

        var baseline = side(view.baseline);
        var comparison = side(view.comparison);
        var ctx = {
            baselineYear: parseInt(String(view.baseline.end).slice(0, 4), 10),
            comparisonYear: parseInt(String(view.comparison.end).slice(0, 4), 10),
            baselineDays: baseline.days,
            comparisonDays: comparison.days
        };
        var rows = KPIS.map(function (kpi) {
            return compareKpi(kpi, baseline.result.kpis[kpi.key], comparison.result.kpis[kpi.key], ctx);
        });
        return {
            team: team,
            teams: teams,
            baseline: baseline,
            comparison: comparison,
            rows: rows,
            roster: rosterChange(team, baseline.result, comparison.result),
            reliabilityYtd: reliabilityYearToDate(team, ctx.comparisonYear),
            coaching: documentedCoaching(team, view.baseline.start, view.comparison.end),
            valid: !!(parseIso(view.baseline.start) && parseIso(view.baseline.end) && parseIso(view.comparison.start)
                && parseIso(view.comparison.end) && view.baseline.start <= view.baseline.end
                && view.comparison.start <= view.comparison.end)
        };
    }

    /* ── The copied summary ── */

    // Improvements, strongest first in noise steps (the same yardstick the
    // coaching ranks by), then level, then declines, then what is missing.
    function orderForSummary(rows) {
        var rank = { improved: 0, level: 1, declined: 2, missing: 3 };
        return rows.slice().sort(function (a, b) {
            if (rank[a.status] !== rank[b.status]) return rank[a.status] - rank[b.status];
            return b.steps - a.steps;
        });
    }

    function basisInWords(kpiResult) {
        if (!kpiResult || !Number.isFinite(kpiResult.value)) return '';
        if (kpiResult.method === 'official') return 'official figure entered by hand';
        var n = kpiResult.n + (kpiResult.n === 1 ? ' associate' : ' associates');
        if (kpiResult.method === 'calls') return n + ', weighted by calls';
        if (kpiResult.method === 'responses') return n + ', weighted by ' + kpiResult.responses + ' survey responses';
        if (kpiResult.method === 'person') return n + ', plain average per associate';
        return n + ', plain average (no call counts in the uploads)';
    }

    function goalSentence(row, model) {
        if (row.annualGoal && !row.judged) {
            var ytd = model.reliabilityYtd;
            var base = 'The goal (' + goalText(row.key, row.target) + ') is for the full year, so a shorter period is not judged against it.';
            if (ytd) {
                base += ' Year to date through ' + fmtDate(ytd.through) + ', the team averages ' + fmtValue('reliability', ytd.average)
                    + ' per associate, and ' + ytd.under + ' of ' + ytd.n + (ytd.under === 1 ? ' is' : ' are') + ' within the goal.';
            }
            return base;
        }
        if (row.met === true) return 'Met the goal (' + goalText(row.key, row.target) + ').';
        if (row.met === false) return 'Did not meet the goal (' + goalText(row.key, row.target) + ').';
        return '';
    }

    function resultLine(row, model) {
        var b = model.baseline, c = model.comparison;
        var base = row.baseline, comp = row.comparison;
        var label = row.label + (row.key === 'reliability' ? ' (average hours missed per associate)' : '');
        if (row.status === 'missing') {
            var parts = [];
            if (row.baselineValue === null) parts.push('no data for ' + b.name);
            if (row.comparisonValue === null) parts.push('no data for ' + c.name);
            var known = row.comparisonValue !== null ? ' ' + c.name + ': ' + fmtValue(row.key, row.comparisonValue) + '.'
                : (row.baselineValue !== null ? ' ' + b.name + ': ' + fmtValue(row.key, row.baselineValue) + '.' : '');
            var goal = row.comparisonValue !== null ? ' ' + goalSentence(row, model) : '';
            return '- ' + label + ': ' + parts.join(' and ') + ', so there is no change to report.' + known + goal;
        }
        var verdict = row.status === 'improved' ? 'Improved.' : (row.status === 'declined' ? 'Declined.' : 'Held level.');
        var counted = [];
        if (basisInWords(base)) counted.push(b.name + ': ' + basisInWords(base));
        if (basisInWords(comp)) counted.push(c.name + ': ' + basisInWords(comp));
        return '- ' + label + ': ' + fmtValue(row.key, row.baselineValue) + ' to ' + fmtValue(row.key, row.comparisonValue)
            + ', ' + changeInWords(row.key, row.change) + '. ' + verdict + ' ' + goalSentence(row, model)
            + (counted.length ? ' (' + counted.join('; ') + ')' : '');
    }

    function joinWords(list) {
        if (list.length <= 1) return list.join('');
        if (list.length === 2) return list[0] + ' and ' + list[1];
        return list.slice(0, -1).join(', ') + ', and ' + list[list.length - 1];
    }

    // A short first-person draft. Facts only: what moved, where it stands
    // against the goal, what is still being worked on, and the coaching that
    // was logged, which is never said to have caused anything.
    function buildDraft(model) {
        var b = model.baseline, c = model.comparison;
        var rows = orderForSummary(model.rows);
        var improved = rows.filter(function (r) { return r.status === 'improved'; });
        var compared = rows.filter(function (r) { return r.status !== 'missing'; });
        var who = model.team.id === 'mine' ? 'my team' : (model.team.id === 'center' ? 'the center' : model.team.shortLabel);
        var sentences = [];

        if (!compared.length) {
            sentences.push('The numbers for ' + b.name + ' and ' + c.name + ' are not both available yet, so this draft has no comparison in it.');
            return sentences.join(' ');
        }

        sentences.push('From ' + b.name + ' to ' + c.name + ', ' + who + ' improved on ' + improved.length + ' of the '
            + compared.length + ' scorecard KPIs we can compare.');

        var named = improved.slice(0, 3);
        named.forEach(function (r) {
            var s = r.label + ' moved from ' + fmtValue(r.key, r.baselineValue) + ' to ' + fmtValue(r.key, r.comparisonValue)
                + ', ' + changeInWords(r.key, r.change);
            if (r.met === true) s += ', and it meets the goal of ' + goalText(r.key, r.target) + '.';
            else if (r.met === false) s += '. We are still working toward the goal of ' + goalText(r.key, r.target) + '.';
            else s += '.';
            sentences.push(s);
        });

        // A real decline, or a goal still missed. An improvement named above
        // has already said where it stands against its goal.
        var working = rows.filter(function (r) {
            if (named.indexOf(r) !== -1) return false;
            return (r.status === 'declined' && r.steps >= 1) || r.met === false;
        });
        if (working.length) {
            var parts = working.map(function (r) {
                if (r.status === 'declined') {
                    return r.label + ' (' + (r.key === 'reliability' ? 'average hours missed per associate, ' : '')
                        + fmtValue(r.key, r.baselineValue) + ' to ' + fmtValue(r.key, r.comparisonValue)
                        + (r.met === false ? ', against a goal of ' + goalText(r.key, r.target) : '') + ')';
                }
                return r.label + ' (' + fmtValue(r.key, r.comparisonValue) + ' against a goal of ' + goalText(r.key, r.target) + ')';
            });
            sentences.push('We are still working on ' + joinWords(parts) + ', and ' + (working.length === 1 ? 'it is' : 'those are')
                + ' a focus for me going into next year.');
        }

        var co = model.coaching;
        if (co && co.records > 0) {
            var topics = co.topics.slice(0, 2).map(function (t) { return t.label.toLowerCase(); });
            sentences.push('Over the same stretch I documented ' + co.records + ' coaching '
                + (co.records === 1 ? 'conversation' : 'conversations') + ' in our coaching tool'
                + (topics.length ? ', most often on ' + joinWords(topics) : '') + '.');
        }
        return sentences.join(' ');
    }

    function buildSummaryText(model) {
        var b = model.baseline, c = model.comparison;
        var lines = [];
        lines.push('Team Performance: ' + model.team.label);
        [['Baseline', b], ['Comparison', c]].forEach(function (pair) {
            var p = pair[1];
            var used = p.range.ok
                ? describeSource(p.range) + ', ' + fmtRange(p.range.spanStart, p.range.spanEnd)
                : 'no upload covers these dates';
            var typed = p.figures ? '; official figures typed in for ' + KPIS.filter(function (k) {
                return Number.isFinite(p.figures.values[k.key]);
            }).map(function (k) { return k.label; }).join(', ') : '';
            lines.push(pair[0] + ': ' + p.name + ' (' + fmtRange(p.start, p.end) + '). Data used: ' + used + typed + '.');
            p.range.gaps.forEach(function (g) {
                lines.push('  Not covered by any upload: ' + fmtRange(g.start, g.end) + '.');
            });
            if (p.inProgress) lines.push('  This period is not finished yet, so its figures can still change.');
        });

        var ros = model.roster;
        var teamLine = model.team.names
            ? 'Team: today\'s roster of ' + ros.rosterSize + ' associates. '
            : 'Team: everyone in the uploads. ';
        teamLine += ros.baselineCount + ' had numbers in ' + b.name + ' and ' + ros.comparisonCount + ' in ' + c.name + '.';
        var appear = function (n) { return n + (n === 1 ? ' appears' : ' appear'); };
        if (ros.onlyComparison.length) teamLine += ' ' + appear(ros.onlyComparison.length) + ' only in ' + c.name + ' (new to the team, or no numbers before).';
        if (ros.onlyBaseline.length) teamLine += ' ' + appear(ros.onlyBaseline.length) + ' only in ' + b.name + '.';
        lines.push(teamLine);

        lines.push('');
        lines.push('Results (strongest improvements first)');
        orderForSummary(model.rows).forEach(function (row) { lines.push(resultLine(row, model)); });

        lines.push('');
        lines.push('How the team figures are built: Average Handle Time, Schedule Adherence and Overall Sentiment are each associate\'s result weighted by their calls, the way the Teams page builds a team figure. Rep Satisfaction is weighted by survey responses, and a period with no surveys has no figure. Reliability is a plain average of each associate\'s hours missed, not weighted. A figure marked official was typed in by hand.');

        var co = model.coaching;
        if (co && co.records > 0) {
            lines.push('');
            lines.push('Documented coaching (the app\'s coaching log, ' + fmtRange(co.start, co.end) + ')');
            var topics = co.topics.slice(0, 4).map(function (t) { return t.label + ' (' + t.count + ')'; });
            lines.push('- ' + co.records + ' coaching ' + (co.records === 1 ? 'record' : 'records') + ' for ' + co.associates + ' '
                + (co.associates === 1 ? 'associate' : 'associates') + (topics.length ? '. Most often about: ' + topics.join(', ') : '') + '.');
            lines.push('- This is a record of coaching that was logged. It does not show what caused any change above.');
        }

        lines.push('');
        lines.push('Draft for my self-review (edit before using)');
        lines.push(buildDraft(model));
        return lines.join('\n');
    }

    /* ── View state ── */

    var currentView = null;

    function loadSavedView() {
        try {
            var raw = localStorage.getItem(VIEW_KEY);
            var v = raw ? JSON.parse(raw) : null;
            if (v && v.baseline && v.comparison && parseIso(v.baseline.start) && parseIso(v.comparison.end)) return v;
        } catch (e) { /* fall through to the defaults */ }
        return null;
    }

    function saveView(view) {
        try { localStorage.setItem(VIEW_KEY, JSON.stringify(view)); } catch (e) { /* stays for this visit only */ }
    }

    function clearSavedView() {
        try { localStorage.removeItem(VIEW_KEY); } catch (e) { /* nothing saved */ }
    }

    function defaultView(teamId, year, teams, periods) {
        var list = teams || listTeams();
        var team = list.filter(function (t) { return t.id === teamId; })[0] || list[0];
        var y = year || defaultYear();
        var d = defaultPeriods(y, team, periods);
        return { teamId: team.id, year: y, baseline: d.baseline, comparison: d.comparison, reason: d.reason, edited: false };
    }

    /* ── The page ── */

    function presetOptions(year, months) {
        var today = todayIso();
        var opts = months.map(function (m) {
            var note = !m.hasData ? ' (no uploads)' : (!m.ended ? ' (in progress)' : (!m.complete ? ' (incomplete)' : ''));
            return { value: m.start + '|' + m.end, label: m.label + note };
        });
        for (var q = 1; q <= 4; q += 1) {
            var r = quarterRange(year, q);
            if (r.start > today) break;
            opts.push({ value: r.start + '|' + r.end, label: 'Q' + q + ' ' + year + (r.end >= today ? ' (in progress)' : '') });
        }
        return opts;
    }

    function periodControlsHtml(prefix, title, side, presets) {
        var current = side.start + '|' + side.end;
        var matched = presets.some(function (p) { return p.value === current; });
        var options = presets.map(function (p) {
            return '<option value="' + escapeHtml(p.value) + '"' + (p.value === current ? ' selected' : '') + '>' + escapeHtml(p.label) + '</option>';
        }).join('') + '<option value="custom"' + (matched ? '' : ' selected') + '>Custom dates</option>';

        var used = side.range.ok
            ? escapeHtml(describeSource(side.range)) + ', ' + escapeHtml(fmtRange(side.range.spanStart, side.range.spanEnd))
            : 'No upload covers these dates for this team';
        var notes = side.range.gaps.map(function (g) {
            return '<div class="callout callout-warn" style="margin-top:6px; font-size:0.86em;">No upload covers ' + escapeHtml(fmtRange(g.start, g.end)) + '.</div>';
        }).join('');
        if (side.inProgress) {
            notes += '<div class="callout callout-info" style="margin-top:6px; font-size:0.86em;">Not finished yet, so these figures can still change.</div>';
        }
        if (side.figures) {
            notes += '<div class="text-secondary" style="margin-top:6px; font-size:0.86em;">Official figures typed in for these dates are used where entered.</div>';
        }

        return '<div class="card-sunken" style="flex:1 1 300px; min-width:280px;">'
            + '<div class="eyebrow" style="margin-bottom:6px;">' + escapeHtml(title) + '</div>'
            + '<label class="text-secondary" style="display:block; font-size:0.85em; margin-bottom:4px;" for="' + prefix + 'Preset">Period</label>'
            + '<select id="' + prefix + 'Preset" data-tp-preset="' + prefix + '" style="width:100%; margin-bottom:8px;">' + options + '</select>'
            + '<div style="display:flex; gap:8px; flex-wrap:wrap;">'
            + '<label style="flex:1 1 120px; font-size:0.85em;" class="text-secondary">Start<input type="date" id="' + prefix + 'Start" data-tp-date="' + prefix + '" value="' + escapeHtml(side.start) + '" style="display:block; width:100%; margin-top:4px;"></label>'
            + '<label style="flex:1 1 120px; font-size:0.85em;" class="text-secondary">End<input type="date" id="' + prefix + 'End" data-tp-date="' + prefix + '" value="' + escapeHtml(side.end) + '" style="display:block; width:100%; margin-top:4px;"></label>'
            + '</div>'
            + '<div class="text-secondary" style="margin-top:8px; font-size:0.86em;">Data used: ' + used + '</div>'
            + notes
            + '</div>';
    }

    function valueCellHtml(row, kpiResult, shown, side) {
        var periodName = side.name;
        if (shown === null) {
            // "No surveys" only when people had numbers and nobody answered a
            // survey. With no upload at all it is simply no data.
            var why = kpiResult && kpiResult.method === 'responses' && side.result.members.length > 0 ? 'No surveys' : 'No data';
            return '<td><span class="text-faint">' + why + '</span></td>';
        }
        var basis = kpiResult.method === 'official' ? 'Official figure'
            : basisInWords(kpiResult).replace(/^./, function (ch) { return ch.toUpperCase(); });
        return '<td><div class="text-primary" style="font-weight:600;">' + escapeHtml(fmtValue(row.key, shown)) + '</div>'
            + '<div class="text-faint" style="font-size:12px;" title="' + escapeHtml(periodName) + '">' + escapeHtml(basis) + '</div></td>';
    }

    function changeCellHtml(row) {
        if (row.status === 'missing') return '<td><span class="pill">Can\'t compare</span></td>';
        var pill = row.status === 'improved' ? '<span class="pill pill-info">Improved</span>'
            : (row.status === 'declined' ? '<span class="pill pill-warn">Declined</span>' : '<span class="pill">No change</span>');
        var amount = row.change === 0 ? '' : '<div style="margin-top:4px; font-weight:600;">' + escapeHtml(fmtChange(row.key, row.change)) + '</div>';
        return '<td>' + pill + amount + '</td>';
    }

    function metCellHtml(row, model) {
        var main;
        if (row.annualGoal && !row.judged) {
            var ytd = model.reliabilityYtd;
            main = '<span class="pill">Year goal</span>';
            if (ytd) {
                main += '<div class="text-secondary" style="font-size:12px; margin-top:4px;">Year to date through ' + escapeHtml(fmtDate(ytd.through))
                    + ': ' + escapeHtml(fmtValue('reliability', ytd.average)) + ' average, ' + ytd.under + ' of ' + ytd.n + ' within</div>';
            } else {
                main += '<div class="text-faint" style="font-size:12px; margin-top:4px;">Judged on the full year</div>';
            }
            return '<td>' + main + '</td>';
        }
        if (row.met === true) main = '<span class="pill pill-good">Met</span>';
        else if (row.met === false) main = '<span class="pill pill-bad">Not met</span>';
        else main = '<span class="text-faint">No data</span>';
        var before = row.baselineMet === true ? 'Baseline: met' : (row.baselineMet === false ? 'Baseline: not met' : '');
        return '<td>' + main + (before ? '<div class="text-faint" style="font-size:12px; margin-top:4px;">' + before + '</div>' : '') + '</td>';
    }

    function tableHtml(model) {
        var b = model.baseline, c = model.comparison;
        var body = model.rows.map(function (row) {
            return '<tr data-tp-kpi="' + escapeHtml(row.key) + '">'
                + '<td><div class="text-primary" style="font-weight:600;">' + escapeHtml(row.label) + '</div>'
                + '<div class="text-faint" style="font-size:12px;">' + (row.lowerIsBetter ? 'Lower is better' : 'Higher is better')
                + (row.key === 'reliability' ? ', hours missed per associate' : '') + '</div></td>'
                + valueCellHtml(row, row.baseline, row.baselineValue, b)
                + valueCellHtml(row, row.comparison, row.comparisonValue, c)
                + changeCellHtml(row)
                + '<td class="text-secondary">' + escapeHtml(goalText(row.key, row.target)) + '</td>'
                + metCellHtml(row, model)
                + '</tr>';
        }).join('');
        return '<div style="overflow-x:auto;"><table class="data-table" id="tpTable">'
            + '<thead><tr><th>KPI</th>'
            + '<th>Baseline<div class="text-faint" style="font-weight:400;">' + escapeHtml(b.name) + '</div></th>'
            + '<th>Comparison<div class="text-faint" style="font-weight:400;">' + escapeHtml(c.name) + '</div></th>'
            + '<th>Change</th><th>Goal (' + escapeHtml(String(model.comparison.end).slice(0, 4)) + ')</th><th>Met goal in comparison?</th></tr></thead>'
            + '<tbody>' + body + '</tbody></table></div>';
    }

    function namesHtml(names, limit) {
        var max = limit || 12;
        var shown = names.slice(0, max).map(escapeHtml).join(', ');
        return names.length > max ? shown + ', and ' + (names.length - max) + ' more' : shown;
    }

    function rosterHtml(model) {
        var r = model.roster, b = model.baseline, c = model.comparison;
        var intro = model.team.names
            ? 'Today\'s roster for ' + escapeHtml(model.team.label) + ': ' + r.rosterSize + ' associates, from the supervisor assignments. People who left the team before today are not in either period.'
            : 'Everyone in the uploads for each period.';
        var lines = '<div class="text-secondary" style="font-size:0.9em;">' + intro + '</div>'
            + '<div style="display:flex; gap:16px; flex-wrap:wrap; margin-top:8px;">'
            + '<div><span class="stat">' + r.baselineCount + '</span> <span class="text-secondary">with numbers in ' + escapeHtml(b.name) + '</span></div>'
            + '<div><span class="stat">' + r.comparisonCount + '</span> <span class="text-secondary">with numbers in ' + escapeHtml(c.name) + '</span></div>'
            + '</div>';
        var changes = '';
        if (r.onlyComparison.length) {
            changes += '<div class="callout callout-warn" style="margin-top:8px; font-size:0.9em;">Only in ' + escapeHtml(c.name) + ' (' + r.onlyComparison.length + '): '
                + namesHtml(r.onlyComparison) + '. New to the team, or no numbers in ' + escapeHtml(b.name) + '.</div>';
        }
        if (r.onlyBaseline.length) {
            changes += '<div class="callout callout-warn" style="margin-top:8px; font-size:0.9em;">Only in ' + escapeHtml(b.name) + ' (' + r.onlyBaseline.length + '): '
                + namesHtml(r.onlyBaseline) + '. No numbers in ' + escapeHtml(c.name) + '.</div>';
        }
        if (model.team.names && r.neither.length) {
            changes += '<div class="text-faint" style="margin-top:8px; font-size:0.86em;">On the roster with no numbers in either period: ' + namesHtml(r.neither) + '.</div>';
        }
        if (!changes) changes = '<div class="text-secondary" style="margin-top:8px; font-size:0.9em;">The same people are counted in both periods.</div>';
        return '<div class="card"><div class="card-title">Who is counted</div>' + lines + changes + '</div>';
    }

    function coachingHtml(model) {
        var co = model.coaching;
        var body;
        if (!co || !co.records) {
            body = '<div class="text-secondary" style="font-size:0.9em;">No coaching is logged for this team between '
                + escapeHtml(fmtRange(co ? co.start : model.baseline.start, co ? co.end : model.comparison.end)) + '. The summary leaves coaching out.</div>';
        } else {
            body = '<div class="text-secondary" style="font-size:0.9em;">' + co.records + ' coaching ' + (co.records === 1 ? 'record' : 'records') + ' for '
                + co.associates + ' ' + (co.associates === 1 ? 'associate' : 'associates') + ' in the coaching log, '
                + escapeHtml(fmtRange(co.start, co.end)) + '.</div>'
                + (co.topics.length ? '<div style="display:flex; gap:6px; flex-wrap:wrap; margin-top:8px;">' + co.topics.slice(0, 6).map(function (t) {
                    return '<span class="pill">' + escapeHtml(t.label) + ' ' + t.count + '</span>';
                }).join('') + '</div>' : '')
                + '<div class="text-faint" style="font-size:0.86em; margin-top:8px;">A record of coaching that was logged. The summary keeps it apart from the results and does not say it caused them.</div>';
        }
        return '<div class="card"><div class="card-title">Documented coaching</div>' + body + '</div>';
    }

    function figuresHtml(model) {
        var b = model.baseline, c = model.comparison;
        var open = !b.range.ok || !c.range.ok || b.figures || c.figures;
        var input = function (side, sideKey, kpi) {
            var saved = side.figures && Number.isFinite(side.figures.values[kpi.key]) ? side.figures.values[kpi.key] : '';
            var unit = unitOf(kpi.key);
            var hint = unit === 'sec' ? 'seconds or m:ss' : (unit === 'hrs' ? 'hours' : 'percent');
            return '<td><input type="text" inputmode="decimal" id="tpFig_' + sideKey + '_' + kpi.key + '" data-tp-fig="' + sideKey + '" data-kpi="' + kpi.key
                + '" value="' + escapeHtml(saved) + '" placeholder="' + hint + '" aria-label="' + escapeHtml(kpi.label + ', ' + side.name) + '" style="width:100%; max-width:160px;"></td>';
        };
        var rows = KPIS.map(function (kpi) {
            return '<tr><td>' + escapeHtml(kpi.label) + '</td>' + input(b, 'base', kpi) + input(c, 'comp', kpi) + '</tr>';
        }).join('');
        return '<details class="card" id="tpFigures"' + (open ? ' open' : '') + '>'
            + '<summary class="card-title" style="cursor:pointer;">Official team figures (type them in)</summary>'
            + '<div class="text-secondary" style="font-size:0.9em; margin:6px 0 10px;">If the uploads do not cover a period, or you have the official team result from the report, type it here. '
            + 'A figure typed here replaces the upload figure for that KPI, for this team and these exact dates. Leave a box blank to keep the upload figure. Reliability is average hours missed per associate.</div>'
            + '<div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>KPI</th><th>Baseline: ' + escapeHtml(b.name) + '</th><th>Comparison: ' + escapeHtml(c.name) + '</th></tr></thead>'
            + '<tbody>' + rows + '</tbody></table></div>'
            + '<div id="tpFigError" class="tone-bad" style="font-size:0.86em; margin-top:6px; display:none;"></div>'
            + '<div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">'
            + '<button type="button" class="btn-secondary" id="tpFigSave">Save figures</button>'
            + '<button type="button" class="btn-ghost" id="tpFigClear">Clear typed figures for these dates</button>'
            + '</div></details>';
    }

    // Said for whichever period has nothing at all, so a blank column is
    // never mistaken for a page that failed.
    function emptyStateHtml(model) {
        var empty = [];
        if (model.rows.every(function (r) { return r.baselineValue === null; })) empty.push(model.baseline.name);
        if (model.rows.every(function (r) { return r.comparisonValue === null; })) empty.push(model.comparison.name);
        if (!empty.length) return '';
        return '<div class="callout callout-info" style="margin-top:12px;">No uploaded numbers cover ' + escapeHtml(empty.join(' or '))
            + ' for this team. Pick other dates, or type the official team figures in the box below and the comparison and the copy button will use them.</div>';
    }

    function render(container) {
        var host = container || document.getElementById('subSectionTaTeamPerformance');
        if (!host) return;
        var teams = listTeams();
        var periods = describeAll();
        if (!currentView) {
            var saved = loadSavedView();
            currentView = saved && saved.edited ? saved : defaultView(saved ? saved.teamId : 'mine', null, teams, periods);
        }
        var view = currentView;
        var model = buildModel(view, { teams: teams, periods: periods });
        var team = model.team;
        var years = yearsOnFile();
        var months = monthOptions(view.year, team, periods);
        var presets = presetOptions(view.year, months);

        var teamOptions = teams.map(function (t) {
            return '<option value="' + escapeHtml(t.id) + '"' + (t.id === team.id ? ' selected' : '') + '>' + escapeHtml(t.label) + '</option>';
        }).join('');
        var yearOptions = years.map(function (y) {
            return '<option value="' + y + '"' + (y === view.year ? ' selected' : '') + '>' + y + '</option>';
        }).join('');
        var reason = view.edited ? 'Your dates, saved on this computer.'
            : (view.reason === 'complete' ? 'Showing the first complete month of ' + view.year + ' against the latest complete month.'
                : (view.reason === 'partial' ? 'Fewer than two complete months are uploaded for ' + view.year + ', so this shows the first and latest months with numbers.'
                    : 'No monthly numbers are uploaded for ' + view.year + ' yet.'));

        var summary = model.valid ? buildSummaryText(model) : '';

        host.innerHTML = '<div class="card" id="tpControls">'
            + '<div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">'
            + '<div><div class="card-title">Team and periods</div>'
            + '<div class="text-secondary" style="font-size:0.9em;">The five scorecard KPIs for a team, one period against another. For your year-end self-review.</div></div>'
            + '<div style="display:flex; gap:8px; flex-wrap:wrap;">'
            + '<button type="button" class="btn-ghost" id="tpReset">Reset to defaults</button>'
            + '<button type="button" class="btn-primary" id="tpCopy"' + (model.valid ? '' : ' disabled') + '>Copy year-end summary</button>'
            + '</div></div>'
            + '<div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:12px;">'
            + '<label class="text-secondary" style="font-size:0.85em;">Team<select id="tpTeam" style="display:block; margin-top:4px; min-width:220px;">' + teamOptions + '</select></label>'
            + '<label class="text-secondary" style="font-size:0.85em;">Review year<select id="tpYear" style="display:block; margin-top:4px;">' + yearOptions + '</select></label>'
            + '</div>'
            + '<div class="text-faint" style="font-size:0.86em; margin-top:8px;">' + escapeHtml(reason) + '</div>'
            + '<div style="display:flex; gap:12px; flex-wrap:wrap; margin-top:12px;">'
            + periodControlsHtml('tpBase', 'Baseline', model.baseline, presets)
            + periodControlsHtml('tpComp', 'Comparison', model.comparison, presets)
            + '</div>'
            + (model.valid ? '' : '<div class="callout callout-bad" style="margin-top:10px;">Each period needs a start date on or before its end date.</div>')
            + '</div>'
            + '<div class="card" id="tpResults"><div class="card-title">Results</div>'
            + (model.valid ? tableHtml(model) + emptyStateHtml(model) : '')
            + '<div class="text-faint" style="font-size:0.86em; margin-top:10px;">Improved and met goal are separate: a KPI can improve and still be short of its goal. '
            + 'AHT, Adherence and Sentiment are weighted by calls and Rep Satisfaction by survey responses, the way the Teams page builds a team figure. '
            + 'Reliability is a plain average of hours missed per associate. Data comes from your weekly and monthly uploads unless a figure is typed in below.</div>'
            + '</div>'
            + (model.valid ? rosterHtml(model) + coachingHtml(model) : '')
            + figuresHtml(model)
            + '<details class="card" id="tpPreview"><summary class="card-title" style="cursor:pointer;">Preview the copied summary</summary>'
            + '<pre id="tpSummaryText" class="card-sunken" style="white-space:pre-wrap; font-family:inherit; font-size:0.88em; margin-top:8px;">' + escapeHtml(summary) + '</pre></details>';

        bind(host, model);
    }

    function updateView(next, opts) {
        currentView = Object.assign({}, currentView, next);
        if (!opts || opts.save !== false) {
            currentView.edited = true;
            saveView(currentView);
        }
    }

    function bind(host, model) {
        var rerender = function () { render(host); };
        var q = function (id) { return host.querySelector('#' + id); };

        q('tpTeam') && q('tpTeam').addEventListener('change', function (e) {
            var teamId = e.target.value;
            if (currentView.edited) {
                updateView({ teamId: teamId });
            } else {
                currentView = defaultView(teamId, currentView.year);
                saveView(Object.assign({}, currentView));
            }
            rerender();
        });
        q('tpYear') && q('tpYear').addEventListener('change', function (e) {
            currentView = defaultView(currentView.teamId, parseInt(e.target.value, 10));
            saveView(Object.assign({}, currentView));
            rerender();
        });
        ['tpBase', 'tpComp'].forEach(function (prefix) {
            var side = prefix === 'tpBase' ? 'baseline' : 'comparison';
            var preset = q(prefix + 'Preset');
            preset && preset.addEventListener('change', function (e) {
                if (e.target.value === 'custom') return;
                var parts = e.target.value.split('|');
                var next = {};
                next[side] = { start: parts[0], end: parts[1] };
                updateView(next);
                rerender();
            });
            [q(prefix + 'Start'), q(prefix + 'End')].forEach(function (input) {
                input && input.addEventListener('change', function () {
                    var start = q(prefix + 'Start').value, end = q(prefix + 'End').value;
                    if (!parseIso(start) || !parseIso(end)) return;
                    var next = {};
                    next[side] = { start: start, end: end };
                    updateView(next);
                    rerender();
                });
            });
        });
        q('tpReset') && q('tpReset').addEventListener('click', function () {
            clearSavedView();
            currentView = defaultView(currentView.teamId, null);
            rerender();
        });
        q('tpCopy') && q('tpCopy').addEventListener('click', function (e) {
            var text = buildSummaryText(buildModel(currentView));
            if (typeof window.copyToClipboard === 'function') {
                window.copyToClipboard(text, { button: e.currentTarget, message: 'Year-end summary copied. Paste it into your self-review and edit the draft.' });
            }
        });
        q('tpFigSave') && q('tpFigSave').addEventListener('click', function () {
            var errors = [];
            var values = { base: {}, comp: {} };
            host.querySelectorAll('[data-tp-fig]').forEach(function (input) {
                var parsed = parseEnteredValue(input.getAttribute('data-kpi'), input.value);
                if (parsed.error) errors.push(metricLabel(input.getAttribute('data-kpi')) + ' (' + parsed.error + ')');
                values[input.getAttribute('data-tp-fig')][input.getAttribute('data-kpi')] = parsed.value;
            });
            var errEl = q('tpFigError');
            if (errors.length) {
                if (errEl) { errEl.textContent = 'Not saved. Check: ' + errors.join(', ') + '.'; errEl.style.display = 'block'; }
                return;
            }
            saveFigures(model.team.id, currentView.baseline.start, currentView.baseline.end, values.base);
            saveFigures(model.team.id, currentView.comparison.start, currentView.comparison.end, values.comp);
            if (typeof window.showToast === 'function') window.showToast('Figures saved for these dates.', 2500);
            rerender();
        });
        q('tpFigClear') && q('tpFigClear').addEventListener('click', function () {
            saveFigures(model.team.id, currentView.baseline.start, currentView.baseline.end, {});
            saveFigures(model.team.id, currentView.comparison.start, currentView.comparison.end, {});
            rerender();
        });
    }

    // For the tests and a fresh start after Delete Data.
    function resetView() { currentView = null; }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.teamPerformance = {
        KPIS: KPIS,
        FIGURES_KEY: FIGURES_KEY,
        VIEW_KEY: VIEW_KEY,
        listTeams: listTeams,
        resolveRange: resolveRange,
        describeSource: describeSource,
        buildTeamResult: buildTeamResult,
        compareKpi: compareKpi,
        rosterChange: rosterChange,
        reliabilityYearToDate: reliabilityYearToDate,
        documentedCoaching: documentedCoaching,
        monthOptions: monthOptions,
        defaultPeriods: defaultPeriods,
        defaultYear: defaultYear,
        buildModel: buildModel,
        buildSummaryText: buildSummaryText,
        buildDraft: buildDraft,
        orderForSummary: orderForSummary,
        parseEnteredValue: parseEnteredValue,
        saveFigures: saveFigures,
        figuresFor: figuresFor,
        fmtValue: fmtValue,
        fmtChange: fmtChange,
        changeInWords: changeInWords,
        periodName: periodName,
        fmtRange: fmtRange,
        render: render,
        resetView: resetView
    };
})();
