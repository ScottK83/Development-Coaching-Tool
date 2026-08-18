(function () {
    'use strict';

    var STORAGE_PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';

    // Supervisor color palette for row highlighting
    // bg = light-mode row tint, dark = dark-mode row tint, dot = vivid accent for
    // the name-cell indicator (needs to read clearly on BOTH row backgrounds).
    var SUPERVISOR_COLORS = {
        'Scott':            { bg: '#e3f2fd', dark: '#0d2137', dot: '#1e88e5' },
        'Miranda Chase':    { bg: '#fce4ec', dark: '#2a1015', dot: '#ec407a' },
        'Kathy Cruz':       { bg: '#f3e5f5', dark: '#1f0f24', dot: '#ab47bc' },
        'Angie Delgado':    { bg: '#fff3e0', dark: '#2a1d08', dot: '#fb8c00' },
        'Sarah Gregory':    { bg: '#e8f5e9', dark: '#0d2010', dot: '#43a047' },
        'Schnelle Howard':  { bg: '#e0f7fa', dark: '#0a1f22', dot: '#00acc1' },
        'Nicole Pazienza':  { bg: '#fff9c4', dark: '#2a2508', dot: '#fdd835' },
        'Angela Allison':   { bg: '#f1f8e9', dark: '#1a2410', dot: '#7cb342' }
    };

    function _isDark() {
        return document.documentElement.getAttribute('data-theme') === 'dark';
    }

    function _getSupervisorColor(empName) {
        try {
            var sups = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'employeeSupervisors') || '{}');
            var sup = sups[empName];
            if (sup && SUPERVISOR_COLORS[sup]) {
                var isDark = _isDark();
                return isDark ? SUPERVISOR_COLORS[sup].dark : SUPERVISOR_COLORS[sup].bg;
            }
        } catch (_e) { /* localStorage parse failure — fall through to default */ }
        return null;
    }

    function _getSupervisorDotColor(empName) {
        try {
            var sups = JSON.parse(localStorage.getItem(STORAGE_PREFIX + 'employeeSupervisors') || '{}');
            var sup = sups[empName];
            if (sup && SUPERVISOR_COLORS[sup]) return SUPERVISOR_COLORS[sup].dot;
        } catch (_e) { /* localStorage parse failure — fall through to default */ }
        return '#90a4ae';
    }

    function _escapeHtml(str) {
        var mod = window.DevCoachModules?.sharedUtils;
        if (mod?.escapeHtml) return mod.escapeHtml(str);
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _formatMetricDisplay(key, value) {
        return typeof window.formatMetricDisplay === 'function' ? window.formatMetricDisplay(key, value) : String(value);
    }
    function _getTeamMembersForWeek(weekKey) {
        return typeof window.getTeamMembersForWeek === 'function' ? window.getTeamMembersForWeek(weekKey) : [];
    }
    function _getLatestWeeklyKey() {
        return typeof window.getLatestWeeklyKey === 'function' ? window.getLatestWeeklyKey() : null;
    }
    function _getWeeklyData() {
        return typeof weeklyData !== 'undefined' ? weeklyData : {};
    }
    function _getYtdData() {
        return typeof ytdData !== 'undefined' ? ytdData : {};
    }

    // ── Period selector ──
    var _selectedRankingPeriodKey = null;
    var _rankingPeriodInitialized = false;

    /* ── Rank movement ──
       Follows the period selector, matching the matchup panel. Picking a week and
       still being shown month-over-month reads as a stuck panel: the header and the
       table change, the movement column does not.

       Movement measures INTO the selected period, not into the newest one — a
       column describing a period the table is not showing is a bug however
       carefully it is captioned. The caption names both periods either way, so the
       movement is never read as covering the same span as the ranking. */

    // Marks a period key as a month assembled on the fly rather than one stored
    // under this key. Anything reading period keys must not assume a lookup.
    var MONTH_KEY_PREFIX = 'month:';

    // Column heading per scope. Short, because the column is one glyph wide.
    var MOVEMENT_COLUMN_LABEL = { month: 'MoM', week: 'WoW', ytd: 'Move' };
    var SCOPE_NOUN = { month: 'month', week: 'week', ytd: 'year-to-date file' };

    var _momCache;

    // Which granularity the selected period belongs to, mirroring the matchup
    // scope buttons so the two surfaces group periods the same way.
    function _scopeForSelectedPeriod() {
        if (!_selectedRankingPeriodKey) return 'month';
        var match = _getAvailableRankingPeriods().filter(function (p) {
            return p.key === _selectedRankingPeriodKey;
        })[0];
        var type = match && match.type;
        if (type === 'ytd') return 'ytd';
        if (type === 'week' || type === 'week-in-progress') return 'week';
        // Quarters and days have no comparable series of their own; months are the
        // nearest thing that does, and the caption says which months.
        return 'month';
    }

    // The key period-compare knows the selected period by. Months are keyed
    // 'YYYY-MM' there whether they were uploaded or rebuilt from weeks; everything
    // else is keyed by its store key.
    function _movementAnchorKey(scope) {
        if (!_selectedRankingPeriodKey) return null;
        if (scope !== 'month') return _selectedRankingPeriodKey;
        if (String(_selectedRankingPeriodKey).indexOf(MONTH_KEY_PREFIX) === 0) {
            return String(_selectedRankingPeriodKey).slice(MONTH_KEY_PREFIX.length);
        }
        var match = _getAvailableRankingPeriods().filter(function (p) {
            return p.key === _selectedRankingPeriodKey;
        })[0];
        var end = (match && match.endDate) || '';
        return end ? String(end).slice(0, 7) : null;
    }

    /* The rank on a card is meaningless without the window it was measured over.
       It sits directly above two more ranks that DO name their months, so a reader
       puts all three in sequence and gets an impossible timeline — "#9 ... #21 in
       July ... #29 in August" reads as a person who was 21st, then 29th, and is
       somehow now 9th. Every rank on the card names its own period. */
    function _selectedPeriodPhrase(data) {
        var key = (data && data.periodKey) || _selectedRankingPeriodKey;
        var match = key ? _getAvailableRankingPeriods().filter(function (p) {
            return p.key === key;
        })[0] : null;
        // "July 2026 (rebuilt from 4 weeks)" is provenance, not a period name, and
        // the provenance is already stated in the header.
        var trim = function (label) { return String(label).replace(/\s*\([^)]*\)\s*$/, ''); };
        if (match) {
            if (match.type === 'ytd') return 'year to date';
            return 'in ' + trim(match.label);
        }
        return (data && data.source) ? 'in ' + trim(data.source) : 'in this period';
    }

    function _monthMovement() {
        if (_momCache !== undefined) return _momCache;
        var pc = window.DevCoachModules && window.DevCoachModules.periodCompare;
        if (!pc || !pc.buildMovementForScope) { _momCache = null; return _momCache; }
        var scope = _scopeForSelectedPeriod();
        try {
            var mv = pc.buildMovementForScope(scope, { anchorKey: _movementAnchorKey(scope) });
            var fellBack = false;
            // A single year-to-date file has nothing to compare against. Months are
            // the useful answer there, said out loud rather than shown silently.
            if (!mv && scope !== 'month') {
                mv = pc.buildMovementForScope('month');
                fellBack = !!mv;
            }
            if (mv) { mv.requestedScope = scope; mv.fellBack = fellBack; }
            _momCache = mv || null;
        } catch (err) {
            console.warn('[center-ranking] Rank movement unavailable:', err && err.message);
            _momCache = null;
        }
        return _momCache;
    }

    function _movementByName() {
        var mom = _monthMovement();
        if (!mom) return null;
        var map = {};
        mom.movements.forEach(function (m) { map[m.name] = m; });
        return map;
    }

    // Positive delta means moved toward 1st.
    //
    // Movement with no score change behind it is shown greyed rather than green or
    // red. The centre compresses into very few scoring buckets, so twenty-odd people
    // sit tied and reshuffle on tiebreakers alone — colouring that like an
    // improvement would invite congratulating someone whose metrics never moved.
    function _movementBadge(mv, showDash, labels) {
        // Labels come off upload metadata, and these land inside a title attribute.
        var was = _escapeHtml((labels && labels.previous) || 'the period before');
        var now = _escapeHtml((labels && labels.current) || 'this period');
        /* The ranks the move was between, printed under the arrow.

           This column sits directly beside the Rank column, and the two count
           over different periods and different populations. A bare "▼39" has
           nothing to be measured from except the rank next to it, so "21, down
           39" gets read as a fall from minus eighteen. Naming both ends costs
           one small line and removes the only arithmetic a reader can do. */
        var pair = function (text) {
            return '<div style="font-size: 0.78em; color: var(--text-tertiary); white-space: nowrap;">' + text + '</div>';
        };
        if (!mv || !Number.isFinite(mv.delta)) {
            return showDash
                ? '<span style="color: var(--text-tertiary);" title="Not scored in ' + was + ', so there is nothing to measure against">&middot;</span>'
                : '';
        }
        if (mv.delta === 0) {
            return '<span style="color: var(--text-tertiary);" title="Same rank in ' + was + ' and ' + now + '">&#8213;</span>' +
                pair('#' + mv.curRank + ' both');
        }
        var up = mv.delta > 0;
        var color = mv.scoreChanged ? (up ? '#2e7d32' : '#c62828') : 'var(--text-tertiary)';
        var title = '#' + mv.prevRank + ' in ' + was + ', #' + mv.curRank + ' in ' + now + '. ' +
            (mv.scoreChanged
                ? 'KPIs met ' + mv.prevKpisMet + '→' + mv.curKpisMet + ', score ' + mv.prevScoreSum + '→' + mv.curScoreSum
                : 'Same score (' + mv.curKpisMet + ' KPIs, ' + mv.curScoreSum + ') — position shifted among tied people, not performance');
        return '<span style="color: ' + color + '; font-weight: ' + (mv.scoreChanged ? 'bold' : 'normal') + '; white-space: nowrap;"' +
            ' title="' + title + '">' + (up ? '&#9650;' : '&#9660;') + Math.abs(mv.delta) +
            (mv.scoreChanged ? '' : '<span style="opacity:0.7;">*</span>') + '</span>' +
            pair('#' + mv.prevRank + '&rarr;' + mv.curRank);
    }

    function _getAvailableRankingPeriods() {
        var periods = [];
        var wData = _getWeeklyData();
        var yData = _getYtdData();

        // Head count of the fullest month of the year, so a monthly upload covering
        // a fraction of the centre can be marked. Still offered — a one-team report
        // is a legitimate thing to look at — but marked, because "July 2026 (18
        // employees)" sitting above "June 2026 (123 employees)" in the same group is
        // exactly how an 18-person centre ranking gets opened by mistake.
        //
        // Measured against the month counts rather than getMonthBuckets().partial:
        // a thin upload that lost its month to the weekly rebuild is not flagged
        // there, and that is precisely the upload still listed here on its own key.
        var _pcMod = window.DevCoachModules && window.DevCoachModules.periodCompare;
        var _partialFraction = (_pcMod && _pcMod.PARTIAL_MONTH_FRACTION) || 0.6;
        var _fullestMonth = 0;
        try {
            var _counts = (_pcMod && _pcMod.getMonthBuckets) ? (_pcMod.getMonthBuckets().counts || {}) : {};
            Object.keys(_counts).forEach(function (mo) { _fullestMonth = Math.max(_fullestMonth, _counts[mo] || 0); });
        } catch (_e) { /* no month data — nothing to mark against */ }

        Object.keys(wData).forEach(function(key) {
            var data = wData[key];
            var meta = data?.metadata || {};
            var count = (data?.employees || []).length;
            if (count < 2) return;
            var pType = meta.periodType || 'week';
            var endStr = meta.endDate || (key.includes('|') ? key.split('|')[1] : '');
            var label = meta.label || _fmtPeriodLabel(key, pType);
            var partial = pType === 'month' && _fullestMonth > 0 && count < _fullestMonth * _partialFraction;
            periods.push({ key: key, label: label, type: pType, source: 'weekly', count: count, endDate: endStr, partial: partial });
        });

        Object.keys(yData).forEach(function(key) {
            var data = yData[key];
            var meta = data?.metadata || {};
            if (meta.autoGeneratedYtd) return;
            var count = (data?.employees || []).length;
            if (count < 2) return;
            var pType = meta.periodType || 'ytd';
            var endStr = meta.endDate || (key.includes('|') ? key.split('|')[1] : '');
            var label = meta.label || _fmtPeriodLabel(key, pType);
            periods.push({ key: key, label: label, type: pType, source: 'ytd', count: count, endDate: endStr });
        });

        // Months rebuilt from weekly uploads. Not stored under these keys —
        // buildRankingsForPeriod recognises the prefix and assembles them.
        var _pc = window.DevCoachModules && window.DevCoachModules.periodCompare;
        if (_pc && _pc.getMonthPeriodOptions) {
            periods = periods.concat(_pc.getMonthPeriodOptions());
        }

        periods.sort(function(a, b) {
            var aDate = a.endDate || a.key.split('|')[1] || '';
            var bDate = b.endDate || b.key.split('|')[1] || '';
            return bDate.localeCompare(aDate);
        });
        return periods;
    }

    function _fmtPeriodLabel(key, type) {
        var parts = key.split('|');
        var endDate = parts[1] || parts[0] || '';
        var prefix;
        if (type === 'ytd') prefix = 'YTD';
        else if (type === 'month') prefix = 'Monthly';
        else if (type === 'quarter') prefix = 'Quarterly';
        else if (type === 'daily') prefix = 'Daily';
        else if (type === 'week-in-progress') prefix = 'Week in progress';
        else prefix = 'Weekly';
        return prefix + ' ending ' + endDate;
    }

    function _renderRankingPeriodSelector(selectedValue) {
        var periods = _getAvailableRankingPeriods();
        var typeOrder = ['ytd', 'quarter', 'month', 'month-agg', 'week', 'week-in-progress', 'daily'];
        var typeLabels = { ytd: 'YTD', quarter: 'Quarterly', month: 'Monthly', 'month-agg': 'Monthly (rebuilt from weeks)', week: 'Weekly', 'week-in-progress': 'Week to Date', daily: 'Daily' };
        var grouped = {};
        periods.forEach(function(p) {
            var t = p.type || 'week';
            if (!grouped[t]) grouped[t] = [];
            grouped[t].push(p);
        });

        var html = '<div style="margin-bottom: 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">';
        html += '<label style="font-weight: 600; color: var(--text-secondary); font-size: 0.9em;">Period:</label>';
        html += '<select id="rankingPeriodSelect" style="padding: 6px 10px; border: 1px solid var(--border); border-radius: 6px; font-size: 0.9em; min-width: 260px;">';
        html += '<option value="">Auto (Best Available)</option>';

        typeOrder.forEach(function(t) {
            if (!grouped[t] || grouped[t].length === 0) return;
            html += '<optgroup label="' + (typeLabels[t] || t) + '">';
            grouped[t].forEach(function(p) {
                var val = p.key;
                var sel = (val === selectedValue) ? ' selected' : '';
                html += '<option value="' + _escapeHtml(val) + '"' + sel + '>' + _escapeHtml(p.label) +
                    ' (' + p.count + ' employees' + (p.partial ? ' &mdash; partial upload' : '') + ')</option>';
            });
            html += '</optgroup>';
        });

        html += '</select></div>';
        return html;
    }

    function _onRankingPeriodChange() {
        var select = document.getElementById('rankingPeriodSelect');
        if (!select) return;
        _selectedRankingPeriodKey = select.value || null;
        renderCenterRanking();
    }

    /**
     * Score an employee using the 5-KPI system (3/2/1 per KPI).
     * Returns { scores, values, kpisMet, scoreSum, kpiScore, trackLabel, trackStatusValue, ... } or null.
     */
    // Metrics outside the 5-KPI scorecard. These get individual ranks so
    // wins on them can be recognized, but they are deliberately absent
    // from METRIC_KEYS — they must never move a composite rank or score.
    var EXTRA_RANK_METRICS = [
        { key: 'fcr', field: 'fcr', reverse: false, survey: true },
        { key: 'overallExperience', field: 'overallExperience', reverse: false, survey: true },
        { key: 'transfers', field: 'transfers', reverse: true },        // lower is better
        { key: 'positiveWord', field: 'positiveWord', reverse: false },
        { key: 'negativeWord', field: 'negativeWord', reverse: false }, // 'Avoid Negative Words' scores how well you avoided them, so higher is better
        { key: 'managingEmotions', field: 'managingEmotions', reverse: false }
    ];
    // The five scorecard KPIs. Hoisted alongside EXTRA_RANK_METRICS so both
    // lists can be checked against the metrics registry — a direction flag that
    // disagrees with the registry silently ranks the worst performer first.
    // `registry` names the registry key each rank key reads from.
    var KPI_RANK_METRICS = [
        { key: 'aht', field: 'values.aht', reverse: true, registry: 'aht' },
        { key: 'adherence', field: 'values.adherence', reverse: false, registry: 'scheduleAdherence' },
        { key: 'sentiment', field: 'values.sentiment', reverse: false, registry: 'overallSentiment' },
        { key: 'associateOverall', field: 'values.associateOverall', reverse: false, registry: 'cxRepOverall' },
        { key: 'reliability', field: 'reliability', reverse: true, registry: 'reliability' }
    ];
    var MIN_SURVEYS_FOR_RANK = 3;

    /* A KPI with no data for the period is not a failed KPI.

       kpisMet and scoreSum are raw counts out of five, and they are sort
       priorities 1 and 2 — so someone measured on four KPIs is compared against
       five-KPI totals and loses a whole tier for missing data. Meanwhile the band
       printed beside the rank comes from kpiScore, which IS normalised, so the
       card could read "Exceptional — 12/12 (KPI: 3.0)" next to a mid-pack rank
       and be telling the truth twice in two incompatible units.

       The sort is put on the same footing as the band: both counts are scaled to
       a five-KPI basis. Scaling stops at MIN_MEASURED_FOR_SCALED because below
       that there is too little measured to stand in for a full scorecard — two
       KPIs at 3 is not an exceptional year, and pro-rating it would crown it.
       Those records keep their raw counts, which sinks them, and the card says
       how many KPIs went unmeasured rather than leaving it to be inferred. */
    var FULL_KPI_COUNT = 5;
    var MIN_MEASURED_FOR_SCALED = 4;

    // Colour by the share of MEASURED KPIs met, so 4/4 reads like 5/5 rather than
    // like 4/5. Identical to the old thresholds when all five were measured.
    function _kpiMetColor(kpisMet, measuredCount, dark) {
        var rate = measuredCount > 0 ? kpisMet / measuredCount : 0;
        if (rate >= 0.8) return dark ? '#66bb6a' : '#2e7d32';
        if (rate >= 0.6) return dark ? '#ffa726' : '#e65100';
        return dark ? '#ef5350' : '#c62828';
    }

    // Pull the extra metric values off the raw employee row. Survey-backed
    // metrics are withheld below the survey floor: 100% off one response
    // isn't an achievement, and letting it rank would crowd out real wins.
    function buildExtraRankValues(emp, surveyTotal) {
        var out = {};
        EXTRA_RANK_METRICS.forEach(function (m) {
            var raw = parseFloat(emp[m.field]);
            if (!isFinite(raw)) { out[m.key] = null; return; }
            if (m.survey && !(surveyTotal >= MIN_SURVEYS_FOR_RANK)) { out[m.key] = null; return; }
            out[m.key] = raw;
        });
        return out;
    }

    // Survey scores exactly as uploaded, with nothing withheld.
    //
    // buildExtraRankValues deliberately blanks these below the ranking floor so
    // 100% off a single response cannot out-rank a real week — right for a
    // placing, wrong for everything else, because the number is still true.
    // Callouts that judge against 100 rather than against the floor read from
    // here instead, and the sample size travels with them as surveyTotal.
    var SURVEY_VALUE_KEYS = ['cxRepOverall', 'fcr', 'overallExperience'];

    function buildSurveyValues(emp) {
        var out = {};
        SURVEY_VALUE_KEYS.forEach(function (k) {
            var raw = parseFloat(emp[k]);
            out[k] = isFinite(raw) ? raw : null;
        });
        return out;
    }

    function scoreEmployee(emp, year) {
        var onOff = window.DevCoachModules?.onOffTracker;
        if (!onOff?.calculateYearEndOnOffMirror) return null;

        var result = onOff.calculateYearEndOnOffMirror(emp, year);
        if (!result) return null;

        var scores = result.scores || {};
        var SCORE_KEYS = ['aht', 'adherence', 'sentiment', 'associateOverall', 'reliability'];

        // Require at least one valid score
        var validScores = SCORE_KEYS.map(function (k) { return scores[k]; }).filter(function (s) { return s !== null && s !== undefined; });
        if (validScores.length === 0) return null;
        var measuredCount = validScores.length;

        // KPIs Met: count of KPIs scoring 2 (Meets) or 3 (Exceeds)
        var kpisMet = 0;
        SCORE_KEYS.forEach(function (k) {
            if (scores[k] !== null && scores[k] !== undefined && scores[k] >= 2) kpisMet++;
        });

        // Score Sum: total of MEASURED KPI scores only. Blank KPIs are not
        // back-filled — a missing slot must neither pad nor drag the total.
        var scoreSum = validScores.reduce(function (a, b) { return a + b; }, 0);

        // KPI Score = average score across the KPIs the agent actually has
        // data for (1.0-3.0 scale).
        var kpiScore = scoreSum / measuredCount;

        // Track band from the per-KPI average, so the cutoffs scale to however
        // many KPIs were measured. 2.8 = old 14/15 Exceptional, 1.8 = old 9/15
        // Successful. An agent with 3 blank KPIs is judged on the 2 real ones.
        var trackLabel, trackStatusValue;
        if (kpiScore >= 2.8) {
            trackLabel = 'Exceptional'; trackStatusValue = 'on-track-exceptional';
        } else if (kpiScore >= 1.8) {
            trackLabel = 'Successful'; trackStatusValue = 'on-track-successful';
        } else {
            trackLabel = 'Off Track'; trackStatusValue = 'off-track';
        }

        // Reliability: keep a genuinely missing value as null, not 0 — 0 is a
        // legitimate perfect score, so coercing blanks to 0 would crown them.
        var reliabilityVal = parseFloat(emp.reliability);
        if (isNaN(reliabilityVal)) reliabilityVal = null;

        return {
            kpisMet: kpisMet,
            scoreSum: scoreSum,
            measuredCount: measuredCount,
            kpiScore: kpiScore,
            ratingAverage: kpiScore,
            trackLabel: trackLabel,
            trackStatusValue: trackStatusValue,
            scores: scores,
            values: result.values || {},
            reliability: reliabilityVal,
            surveyTotal: parseInt(emp.surveyTotal, 10) || 0,
            totalCalls: parseInt(emp.totalCalls, 10) || 0
        };
    }

    /* Reliability is hours of work missed against a budget for the WHOLE YEAR —
       18 for a 3, 24 for a 2 — not a rate that stands on its own in any window.
       buildMonthAggregate spells the reasoning out at length and substitutes the
       running year-to-date total before scoring a rebuilt month. The stored-period
       paths never got the same treatment, so selecting a week or an uploaded month
       scored a week's 0 hours against an annual 18-hour budget and handed the whole
       centre a free KPI — while the movement column beside it, built the other way,
       disagreed about the same person in the same period.

       One rule, applied on both paths. A year-to-date file already carries the
       running total in that column and is left alone. */
    function _withCumulativeReliability(employees, year, isYtdSource) {
        var list = employees || [];
        if (isYtdSource) return list;
        var pc = window.DevCoachModules && window.DevCoachModules.periodCompare;
        if (!pc || !pc.latestYtdReliability) return list;
        var cumulative;
        try {
            cumulative = pc.latestYtdReliability(year) || {};
        } catch (err) {
            return list;
        }
        // Copied rather than mutated — these rows are the stored upload, and every
        // other surface reads the same objects.
        return list.map(function (emp) {
            if (!emp || !emp.name) return emp;
            var copy = Object.assign({}, emp);
            var raw = parseFloat(emp.reliability);
            // Kept for coaching — "you missed 6 hours that week" is still the
            // useful sentence — but never scored.
            copy.reliabilityAccrued = isFinite(raw) ? raw : null;
            // Left null with no year-to-date file to read. Unmeasured is correct:
            // 0 is a perfect score, so guessing would crown people.
            copy.reliability = isFinite(cumulative[emp.name]) ? cumulative[emp.name] : null;
            return copy;
        });
    }

    /**
     * Build rankings from the best available data source for a year.
     * Uses getLatestYearPeriodForEmployee logic via YTD data, or falls
     * back to the latest weekly upload with the most employees.
     */
    function buildCenterRankings() {
        var currentYear = new Date().getFullYear();
        var wData = _getWeeklyData();
        var yData = _getYtdData();

        // Find the single most recent upload with 30+ employees.
        // Priority: newest real YTD > newest non-YTD upload.
        // No merging. One period. That's it.
        var bestYtd = null;
        var bestYtdTime = 0;
        var bestYtdKey = '';
        var bestYtdSource = '';

        Object.entries(yData).forEach(function (entry) {
            var meta = entry[1]?.metadata || {};
            if (meta.autoGeneratedYtd) return;
            var endStr = meta.endDate || (entry[0].includes('|') ? entry[0].split('|')[1] : '');
            var endYear = parseInt(String(endStr).split('-')[0], 10);
            if (endYear !== currentYear) return;
            var count = (entry[1].employees || []).length;
            if (count < 30) return;
            var uploadedAt = meta.uploadedAt ? new Date(meta.uploadedAt).getTime() : 0;
            if (uploadedAt > bestYtdTime) {
                bestYtd = entry[1];
                bestYtdTime = uploadedAt;
                bestYtdKey = entry[0];
                bestYtdSource = meta.label || 'YTD upload';
            }
        });

        // Fall back to newest weekly/custom upload with 30+ employees
        var bestWeekly = null;
        var bestWeeklyTime = 0;
        var bestWeeklyKey = '';
        var bestWeeklySource = '';

        Object.entries(wData).forEach(function (entry) {
            var meta = entry[1]?.metadata || {};
            var endStr = meta.endDate || (entry[0].includes('|') ? entry[0].split('|')[1] : '');
            var endYear = parseInt(String(endStr).split('-')[0], 10);
            if (endYear !== currentYear) return;
            var count = (entry[1].employees || []).length;
            if (count < 30) return;
            var uploadedAt = meta.uploadedAt ? new Date(meta.uploadedAt).getTime() : 0;
            if (uploadedAt > bestWeeklyTime) {
                bestWeekly = entry[1];
                bestWeeklyTime = uploadedAt;
                bestWeeklyKey = entry[0];
                bestWeeklySource = meta.label || entry[0];
            }
        });

        // Use the most recently uploaded source. Real YTD wins ties.
        var bestPeriod, bestKey, bestSource;
        if (bestYtd && (!bestWeekly || bestYtdTime >= bestWeeklyTime)) {
            bestPeriod = bestYtd;
            bestKey = bestYtdKey;
            bestSource = bestYtdSource;
        } else if (bestWeekly) {
            bestPeriod = bestWeekly;
            bestKey = bestWeeklyKey;
            bestSource = bestWeeklySource;
        } else {
            return null;
        }

        // Use this period's employees directly. No merging. No overlaying.
        var baseEmployees = {};
        (bestPeriod.employees || []).forEach(function (emp) {
            if (emp && emp.name) baseEmployees[emp.name] = emp;
        });

        var mergedEmployees = _withCumulativeReliability(
            Object.values(baseEmployees), currentYear, bestPeriod === bestYtd);

        var rankings = _scoreAndRank(mergedEmployees, currentYear);

        // Identify team members — check weekly keys first, fall back to YTD/any key
        var latestKey = _getLatestWeeklyKey();
        if (!latestKey) {
            var teamFilter = window.DevCoachModules?.teamFilter;
            if (teamFilter?.getTeamSelectionContext) {
                latestKey = teamFilter.getTeamSelectionContext().weekKey || '';
            }
        }
        var teamMembers = latestKey ? _getTeamMembersForWeek(latestKey) : [];
        var teamSet = new Set(teamMembers);

        return {
            rankings: rankings,
            totalEmployees: rankings.length,
            source: bestSource,
            periodKey: bestKey,
            teamMembers: teamSet
        };
    }

    /**
     * Shared scoring + ranking logic. Takes an array of employee objects,
     * scores each one, assigns per-metric ranks, then sorts by 4-level
     * priority: KPIs Met → Score Sum → KPI Rank Total → Tiebreaker.
     * Returns the sorted rankings array.
     */
    function _scoreAndRank(employees, year) {
        var METRIC_KEYS = ['aht', 'adherence', 'sentiment', 'associateOverall', 'reliability'];

        // Dedupe by name (last row wins) so a doubled upload row can't be
        // scored twice and skew every other employee's metric ranks.
        var _byName = {};
        (employees || []).forEach(function (emp) {
            if (emp && emp.name) _byName[emp.name] = emp;
        });

        var rankings = [];
        Object.values(_byName).forEach(function (emp) {
            var score = scoreEmployee(emp, year);
            if (!score) return;

            rankings.push({
                extraValues: buildExtraRankValues(emp, score.surveyTotal),
                surveyValues: buildSurveyValues(emp),
                name: emp.name,
                kpisMet: score.kpisMet,
                scoreSum: score.scoreSum,
                measuredCount: score.measuredCount,
                kpiScore: score.kpiScore,
                ratingAverage: score.ratingAverage,
                trackLabel: score.trackLabel,
                trackStatusValue: score.trackStatusValue,
                scores: score.scores,
                values: score.values,
                reliability: score.reliability,
                // Hours missed in the period itself, where the caller substituted
                // the cumulative year total for scoring. Coaching wants the slice
                // — "you missed 6 hours in July" — and the rank must not have it.
                reliabilityAccrued: Number.isFinite(parseFloat(emp.reliabilityAccrued))
                    ? parseFloat(emp.reliabilityAccrued) : null,
                surveyTotal: score.surveyTotal,
                totalCalls: score.totalCalls
            });
        });

        // ── Step 5: Individual KPI Ranks ──
        var metricRankKeys = KPI_RANK_METRICS.slice().concat(EXTRA_RANK_METRICS.map(function (m) {
            return { key: m.key, field: 'extraValues.' + m.key, reverse: m.reverse };
        }));

        var _isNullVal = function (v) {
            return v === null || v === undefined || (typeof v === 'number' && isNaN(v));
        };

        metricRankKeys.forEach(function (mk) {
            var getVal = function (e) {
                if (!mk.field.includes('.')) return e[mk.field];
                var parts = mk.field.split('.');
                var bucket = e[parts[0]];
                return bucket ? bucket[parts[1]] : null;
            };
            var sorted = rankings.slice().sort(function (a, b) {
                var aVal = getVal(a), bVal = getVal(b);
                var aNull = _isNullVal(aVal), bNull = _isNullVal(bVal);
                if (aNull && bNull) return 0;
                if (aNull) return 1;   // missing values sink to the end
                if (bNull) return -1;
                return mk.reverse ? (aVal - bVal) : (bVal - aVal);
            });
            var lastRank = 0, lastVal;
            sorted.forEach(function (emp, idx) {
                if (!emp.metricRanks) emp.metricRanks = {};
                var val = getVal(emp);
                // No data for this metric — leave the rank null. It displays as
                // '?' and the KPI Rank Total step below substitutes the worst
                // rank, so a blank metric can never out-rank a measured one.
                if (_isNullVal(val)) {
                    emp.metricRanks[mk.key] = null;
                    return;
                }
                // Standard 1-2-2-4 ranking, with an epsilon tie test so decimal
                // values that display identically aren't split into two ranks.
                if (idx === 0 || _isNullVal(lastVal) || Math.abs(val - lastVal) >= 1e-9) {
                    emp.metricRanks[mk.key] = idx + 1;
                } else {
                    emp.metricRanks[mk.key] = lastRank;
                }
                lastRank = emp.metricRanks[mk.key];
                lastVal = val;
            });
        });

        // ── KPI Rank Total = sum of all 5 individual ranks (lower = better) ──
        var worstRank = rankings.length + 1;
        rankings.forEach(function (r) {
            var ranks = r.metricRanks || {};
            var total = 0;
            METRIC_KEYS.forEach(function (k) {
                total += (ranks[k] && ranks[k] > 0) ? ranks[k] : worstRank;
            });
            r.kpiRankTotal = total;
        });

        // ── Step 6: Tiebreaker (min-max normalized average) ──
        var metricMinMax = {};
        METRIC_KEYS.forEach(function (mk) {
            var vals = rankings.map(function (r) {
                var v = mk === 'reliability' ? r.reliability : r.values[mk];
                return (v !== null && v !== undefined && !isNaN(v)) ? v : null;
            }).filter(function (v) { return v !== null; });
            metricMinMax[mk] = {
                min: vals.length ? Math.min.apply(null, vals) : 0,
                max: vals.length ? Math.max.apply(null, vals) : 0
            };
        });

        rankings.forEach(function (r) {
            var normalized = [];
            var _norm = function (val, key, invert) {
                if (val === null || val === undefined || isNaN(val)) return;
                var mm = metricMinMax[key];
                var range = mm.max - mm.min;
                if (range === 0) { normalized.push(0.5); return; }
                normalized.push(invert ? (mm.max - val) / range : (val - mm.min) / range);
            };
            _norm(r.values.adherence, 'adherence', false);
            _norm(r.reliability, 'reliability', true);
            _norm(r.values.aht, 'aht', true);
            _norm(r.values.associateOverall, 'associateOverall', false);
            _norm(r.values.sentiment, 'sentiment', false);

            r.tiebreaker = normalized.length > 0
                ? normalized.reduce(function (a, b) { return a + b; }, 0) / normalized.length
                : 0;
        });

        // ── Rank basis ──
        // Scaled to five KPIs so a missing slot neither pads nor drags the sort,
        // matching what scoreEmployee already does for the displayed band. A fully
        // measured record scales by 1 and is untouched.
        rankings.forEach(function (r) {
            var scale = (r.measuredCount >= MIN_MEASURED_FOR_SCALED && r.measuredCount > 0)
                ? FULL_KPI_COUNT / r.measuredCount
                : 1;
            r.rankKpisMet = r.kpisMet * scale;
            r.rankScoreSum = r.scoreSum * scale;
        });

        // ── Step 7: Final Rank — 4-level priority sort ──
        rankings.sort(function (a, b) {
            // Priority 1: KPIs Met (most first — descending), on a five-KPI basis
            if (Math.abs(a.rankKpisMet - b.rankKpisMet) > 1e-9) return b.rankKpisMet - a.rankKpisMet;
            // Priority 2: Score Sum (highest first — descending), same basis
            if (Math.abs(a.rankScoreSum - b.rankScoreSum) > 1e-9) return b.rankScoreSum - a.rankScoreSum;
            // Priority 3: KPI Rank Total (lowest first — ascending)
            if (a.kpiRankTotal !== b.kpiRankTotal) return a.kpiRankTotal - b.kpiRankTotal;
            // Priority 4: Tiebreaker (highest first — descending)
            if (Math.abs(a.tiebreaker - b.tiebreaker) > 1e-9) return b.tiebreaker - a.tiebreaker;
            // Priority 5: Name — deterministic order for otherwise-identical employees
            return a.name.localeCompare(b.name);
        });

        rankings.forEach(function (r, i) { r.rank = i + 1; });

        // Backward-compat: compositeScore (lower = better, used by matchup module)
        rankings.forEach(function (r) { r.compositeScore = r.rank; });

        return rankings;
    }

    /**
     * Build rankings for a specific period key (weekly or YTD).
     * Unlike buildCenterRankings which merges all periods,
     * this ranks only the employees present in the given period.
     */
    /**
     * A month rebuilt from weekly uploads has no stored entry to look up, so
     * period-compare assembles one on demand — volume-weighted metrics, and
     * reliability converted from a running year-to-date total into the hours
     * actually accrued in that month.
     */
    function _buildRankingsForMonth(monthKey) {
        var pc = window.DevCoachModules && window.DevCoachModules.periodCompare;
        if (!pc || !pc.buildMonthAggregate) return null;

        var year = parseInt(String(monthKey).split('-')[0], 10) || new Date().getFullYear();
        var agg = pc.buildMonthAggregate(monthKey, year);
        if (!agg || !agg.employees.length) return null;

        var rankings = _scoreAndRank(agg.employees, year);
        if (!rankings.length) return null;

        var lastWeekKey = agg.weekKeys[agg.weekKeys.length - 1];
        return {
            rankings: rankings,
            totalEmployees: rankings.length,
            source: agg.label + (agg.fromUpload ? ' (uploaded month)' : ' (rebuilt from ' + agg.weekCount + ' weeks)'),
            periodKey: MONTH_KEY_PREFIX + monthKey,
            teamMembers: new Set(_getTeamMembersForWeek(lastWeekKey))
        };
    }

    function buildRankingsForPeriod(periodKey) {
        if (!periodKey) return null;
        if (String(periodKey).indexOf(MONTH_KEY_PREFIX) === 0) {
            return _buildRankingsForMonth(String(periodKey).slice(MONTH_KEY_PREFIX.length));
        }
        var wData = _getWeeklyData();
        var yData = _getYtdData();
        var period = wData[periodKey] || yData[periodKey];
        if (!period || !period.employees?.length) return null;

        var meta = period.metadata || {};
        var endStr = meta.endDate || (periodKey.includes('|') ? periodKey.split('|')[1] : '');
        var endYear = parseInt(String(endStr).split('-')[0], 10) || new Date().getFullYear();

        var _isYtdSource = (meta.periodType || (yData[periodKey] ? 'ytd' : 'week')) === 'ytd';
        var rankings = _scoreAndRank(
            _withCumulativeReliability(period.employees, endYear, _isYtdSource), endYear);
        if (!rankings.length) return null;

        // Identify team members for this period
        var teamMembers = _getTeamMembersForWeek(periodKey);
        var teamSet = new Set(teamMembers);

        return {
            rankings: rankings,
            totalEmployees: rankings.length,
            source: meta.label || periodKey,
            periodKey: periodKey,
            teamMembers: teamSet
        };
    }


    /* ── Trajectory ──
       "Down 39" is a fact about one step. The question it always raises next is
       what the rest of the year looked like, and until now the only way to answer
       it was to change the period selector eight times and write the numbers down.

       Two surfaces: a strip of per-period deltas on the card, and the whole year
       on click. Both read the same series, so they can never disagree.

       Rank shown per month is over the people scored in that month. The arrow into
       a month is measured over the people scored in both it and the month before.
       Those are two scales — the same two the table and its movement column use —
       so the arrow is not always the difference of the two ranks either side of
       it, and the modal prints the shared pair it IS the difference of. */

    var TRAJECTORY_SCOPE = 'month';

    function _timeline() {
        var pc = window.DevCoachModules && window.DevCoachModules.periodCompare;
        if (!pc || !pc.buildRankTimeline) return null;
        try {
            return pc.buildRankTimeline(TRAJECTORY_SCOPE);
        } catch (err) {
            console.warn('[center-ranking] Trajectory unavailable:', err && err.message);
            return null;
        }
    }

    function _timelineFor(name) {
        var tl = _timeline();
        return (tl && tl.byName[name]) || null;
    }

    // "July 2026" -> "Jul", so a dozen chips fit across a 240px card. Anything
    // whose shape this does not recognise is trimmed rather than dropped.
    var MONTH_ABBREV = {
        January: 'Jan', February: 'Feb', March: 'Mar', April: 'Apr',
        May: 'May', June: 'Jun', July: 'Jul', August: 'Aug',
        September: 'Sep', October: 'Oct', November: 'Nov', December: 'Dec'
    };
    function _shortPeriodLabel(label) {
        var word = String(label || '').split(' ')[0];
        return MONTH_ABBREV[word] || (word.length > 5 ? word.slice(0, 5) : word);
    }

    function _deltaColor(pt) {
        // A move with no score change behind it is greyed, everywhere. The centre
        // compresses into few scoring buckets, so people reshuffle on tiebreakers
        // alone and colouring that green invites congratulating nobody's work.
        if (!pt.scoreChanged) return 'var(--text-tertiary)';
        return pt.delta > 0 ? (_isDark() ? '#66bb6a' : '#2e7d32') : (_isDark() ? '#ef5350' : '#c62828');
    }

    function _deltaMarkup(pt) {
        if (!Number.isFinite(pt.delta)) return '';
        if (pt.delta === 0) return ' <span style="color: var(--text-tertiary);">&#8213;</span>';
        return ' <span style="color: ' + _deltaColor(pt) + ';">' +
            (pt.delta > 0 ? '&#9650;' : '&#9660;') + Math.abs(pt.delta) +
            (pt.scoreChanged ? '' : '<span style="opacity:0.7;">*</span>') + '</span>';
    }

    function _pointTitle(pt) {
        var parts = [pt.label + (pt.inProgress ? ' (so far)' : '') +
            ' — #' + pt.rank + ' of ' + pt.total];
        if (Number.isFinite(pt.delta) && pt.delta !== 0) {
            parts.push((pt.delta > 0 ? 'up ' : 'down ') + Math.abs(pt.delta) +
                ' (#' + pt.sharedPrevRank + ' to #' + pt.sharedRank + ' over the ' +
                pt.sharedTotal + ' in both months)');
        }
        parts.push(pt.kpisMet + '/' + pt.measuredCount + ' KPIs, score ' + pt.scoreSum);
        return parts.join('. ') + '.';
    }

    // The strip on the card: one chip per period, rank and the move into it.
    function _renderTimelineStrip(series) {
        if (!series || series.length < 2) return '';
        var chips = series.map(function (pt) {
            return '<span title="' + _escapeHtml(_pointTitle(pt)) + '" style="font-size: 0.72em; ' +
                'padding: 1px 4px; border-radius: 3px; background: rgba(127,127,127,0.13); white-space: nowrap;">' +
                (pt.inProgress
                    ? '<span style="color: #e65100;">' + _escapeHtml(_shortPeriodLabel(pt.label)) + '</span>'
                    : _escapeHtml(_shortPeriodLabel(pt.label))) +
                ' <strong>' + pt.rank + '</strong>' + _deltaMarkup(pt) + '</span>';
        });
        return '<div style="margin-top: 6px; display: flex; flex-wrap: wrap; gap: 3px;">' + chips.join('') + '</div>';
    }

    /* ── The year, drawn ──
       Rank 1 at the top, so up is better and the line reads the way the word
       does. Inline SVG rather than a chart library: this is one polyline in a
       modal, and it has to theme itself from the same CSS variables as
       everything around it. */
    function _trajectorySvg(series, reference) {
        var W = 620, H = 200, padL = 42, padR = 18, padT = 18, padB = 30;
        var worst = series.reduce(function (m, pt) { return Math.max(m, pt.total); }, 1);
        if (reference && Number.isFinite(reference.rank)) worst = Math.max(worst, reference.total || 1);
        var span = Math.max(1, worst - 1);
        var n = series.length;
        var x = function (i) { return n < 2 ? (padL + (W - padL - padR) / 2) : padL + (i * (W - padL - padR)) / (n - 1); };
        var y = function (rank) { return padT + ((rank - 1) / span) * (H - padT - padB); };

        var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" role="img" ' +
            'aria-label="Rank by month, best at the top" style="display:block;">';

        // Gridlines at best, middle and worst.
        [1, Math.round((1 + worst) / 2), worst].forEach(function (rank) {
            var yy = y(rank);
            svg += '<line x1="' + padL + '" y1="' + yy + '" x2="' + (W - padR) + '" y2="' + yy +
                '" stroke="var(--border)" stroke-width="1" />';
            svg += '<text x="' + (padL - 6) + '" y="' + (yy + 4) + '" text-anchor="end" ' +
                'font-size="10" fill="var(--text-tertiary)">#' + rank + '</text>';
        });

        // Where they stand over the whole selected period, so the big number on
        // the card is reconciled against the months in one glance.
        if (reference && Number.isFinite(reference.rank)) {
            var ry = y(reference.rank);
            svg += '<line x1="' + padL + '" y1="' + ry + '" x2="' + (W - padR) + '" y2="' + ry +
                '" stroke="#1565c0" stroke-width="1.5" stroke-dasharray="5 4" />';
            svg += '<text x="' + (W - padR) + '" y="' + (ry - 5) + '" text-anchor="end" ' +
                'font-size="10" fill="#1565c0">#' + reference.rank + ' ' + _escapeHtml(reference.label) + '</text>';
        }

        var points = series.map(function (pt, i) { return x(i) + ',' + y(pt.rank); });
        svg += '<polyline points="' + points.join(' ') + '" fill="none" stroke="#1565c0" stroke-width="2" ' +
            'stroke-linejoin="round" stroke-linecap="round" />';

        series.forEach(function (pt, i) {
            var fill = pt.trackStatusValue === 'on-track-exceptional' ? '#2e7d32'
                : pt.trackStatusValue === 'on-track-successful' ? '#1565c0' : '#c62828';
            svg += '<circle cx="' + x(i) + '" cy="' + y(pt.rank) + '" r="4.5" fill="' + fill + '" />';
            svg += '<text x="' + x(i) + '" y="' + (y(pt.rank) - 9) + '" text-anchor="middle" ' +
                'font-size="10" font-weight="bold" fill="var(--text-primary)">' + pt.rank + '</text>';
            svg += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle" ' +
                'font-size="10" fill="' + (pt.inProgress ? '#e65100' : 'var(--text-secondary)') + '">' +
                _escapeHtml(_shortPeriodLabel(pt.label)) + '</text>';
        });

        return svg + '</svg>';
    }

    // The five KPIs, one row each, a column per period. This is the answer to
    // "which metric moved", which is the only useful next question after a rank
    // drop and was previously a period-selector safari to find.
    var TRAJECTORY_METRIC_ROWS = [
        { label: 'AHT', scoreKey: 'aht', rankKey: 'aht', registry: 'aht' },
        { label: 'Adherence', scoreKey: 'adherence', rankKey: 'adherence', registry: 'scheduleAdherence' },
        { label: 'Sentiment', scoreKey: 'sentiment', rankKey: 'sentiment', registry: 'overallSentiment' },
        { label: 'CX Adv', scoreKey: 'associateOverall', rankKey: 'associateOverall', registry: 'cxRepOverall' },
        { label: 'Reliability', scoreKey: 'reliability', rankKey: 'reliability', registry: 'reliability' }
    ];

    function _trajectoryMetricValue(pt, row) {
        if (row.scoreKey === 'reliability') return pt.reliability;
        var v = (pt.values || {})[row.scoreKey];
        return v === undefined ? null : v;
    }

    function _scoreDot(score) {
        if (score === null || score === undefined) return '';
        var bg = score === 3 ? '#2e7d32' : score === 2 ? '#1565c0' : '#c62828';
        return '<span style="display: inline-block; width: 15px; height: 15px; line-height: 15px; ' +
            'border-radius: 50%; font-size: 0.62em; font-weight: bold; color: #fff; background: ' + bg +
            '; text-align: center; margin-right: 3px;">' + score + '</span>';
    }

    function buildTrajectoryHtml(name) {
        var series = _timelineFor(name);
        if (!series || !series.length) {
            return '<p style="color: var(--text-secondary);">No month-by-month history for ' +
                _escapeHtml(name) + ' yet. Two full months of uploads are needed before a trajectory exists.</p>';
        }

        var reference = null;
        if (_lastRankingData) {
            var row = _lastRankingData.rankings.filter(function (r) { return r.name === name; })[0];
            if (row) {
                reference = { rank: row.rank, total: _lastRankingData.totalEmployees,
                    label: _selectedPeriodPhrase(_lastRankingData) };
            }
        }

        var html = '';
        html += '<p style="margin: 0 0 10px 0; color: var(--text-secondary); font-size: 0.85em;">' +
            'Rank in each month, over the people scored in that month. The arrow into a month is measured ' +
            'against the month before, over the people scored in both — which is why it is not always the ' +
            'difference of the two ranks either side of it. Best rank sits at the top.' +
            (reference ? ' The dashed line is <strong>#' + reference.rank + ' ' + _escapeHtml(reference.label) +
                '</strong>, the figure on the card.' : '') + '</p>';

        html += '<div style="background: var(--bg-surface-raised); border: 1px solid var(--border); ' +
            'border-radius: 8px; padding: 8px 4px 2px 4px; margin-bottom: 14px;">' +
            _trajectorySvg(series, reference) + '</div>';

        var th = 'padding: 5px 6px; border-bottom: 2px solid var(--border); font-size: 0.78em; ' +
            'color: var(--text-secondary); text-align: center; white-space: nowrap;';
        var td = 'padding: 5px 6px; border-bottom: 1px solid var(--border); text-align: center; white-space: nowrap;';

        html += '<div style="overflow-x: auto;"><table style="width: 100%; border-collapse: collapse; font-size: 0.85em;">';
        html += '<thead><tr><th style="' + th + ' text-align: left;">Month</th>';
        series.forEach(function (pt) {
            html += '<th style="' + th + '">' + _escapeHtml(_shortPeriodLabel(pt.label)) +
                (pt.inProgress ? ' <span style="color:#e65100;">(so far)</span>' : '') + '</th>';
        });
        html += '</tr></thead><tbody>';

        function bodyRow(label, cells, strong) {
            var out = '<tr><td style="' + td + ' text-align: left; color: var(--text-secondary);' +
                (strong ? ' font-weight: 700; color: var(--text-primary);' : '') + '">' + label + '</td>';
            cells.forEach(function (c) { out += '<td style="' + td + '">' + c + '</td>'; });
            return out + '</tr>';
        }

        html += bodyRow('Rank', series.map(function (pt) {
            return '<strong>#' + pt.rank + '</strong> <span style="color: var(--text-tertiary); font-size: 0.85em;">of ' +
                pt.total + '</span>';
        }), true);

        html += bodyRow('Move', series.map(function (pt) {
            if (!Number.isFinite(pt.delta)) return '<span style="color: var(--text-tertiary);" title="Nothing before this to measure against">&middot;</span>';
            if (pt.delta === 0) return '<span style="color: var(--text-tertiary);">&#8213;</span>';
            return '<span style="color: ' + _deltaColor(pt) + '; font-weight: 600;">' +
                (pt.delta > 0 ? '&#9650;' : '&#9660;') + Math.abs(pt.delta) + '</span>' +
                '<div style="font-size: 0.72em; color: var(--text-tertiary);">#' + pt.sharedPrevRank +
                '&rarr;' + pt.sharedRank + '</div>';
        }));

        html += bodyRow('KPIs met', series.map(function (pt) {
            return '<span style="font-weight: 600; color: ' + _kpiMetColor(pt.kpisMet, pt.measuredCount, _isDark()) + ';">' +
                pt.kpisMet + '/' + pt.measuredCount + '</span>';
        }));

        html += bodyRow('Score', series.map(function (pt) {
            return pt.scoreSum + '/' + (pt.measuredCount * 3) +
                '<div style="font-size: 0.72em; color: var(--text-tertiary);">' + pt.kpiScore.toFixed(1) + '</div>';
        }));

        html += bodyRow('Band', series.map(function (pt) {
            var c = pt.trackStatusValue === 'on-track-exceptional' ? '#2e7d32'
                : pt.trackStatusValue === 'on-track-successful' ? '#1565c0' : '#c62828';
            return '<span style="display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 0.72em; ' +
                'font-weight: bold; color: #fff; background: ' + c + ';">' + _escapeHtml(pt.trackLabel) + '</span>';
        }));

        html += '<tr><td colspan="' + (series.length + 1) + '" style="padding: 10px 6px 4px 6px; ' +
            'font-size: 0.78em; color: var(--text-secondary); border-bottom: 2px solid var(--border);">' +
            'The five KPIs behind it &mdash; value, its 3/2/1 score, and where that ranked in the month.</td></tr>';

        TRAJECTORY_METRIC_ROWS.forEach(function (row) {
            html += bodyRow(row.label, series.map(function (pt) {
                var value = _trajectoryMetricValue(pt, row);
                var score = (pt.scores || {})[row.scoreKey];
                if (value === null || value === undefined || isNaN(value)) {
                    return '<span style="color: var(--text-tertiary);" title="Not measured in ' +
                        _escapeHtml(pt.label) + '">&mdash;</span>';
                }
                var mRank = (pt.metricRanks || {})[row.rankKey];
                return _scoreDot(score === undefined ? null : score) + _escapeHtml(_formatMetricDisplay(row.registry, value)) +
                    (Number.isFinite(mRank) ? '<div style="font-size: 0.72em; color: var(--text-tertiary);">#' + mRank + '</div>' : '');
            }));
        });

        html += '</tbody></table></div>';
        return html;
    }

    function _openTrajectory(name) {
        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';

        var content = document.createElement('div');
        content.className = 'modal-content';
        content.style.maxWidth = '860px';
        content.innerHTML =
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">' +
                '<h3 style="margin: 0; color: var(--text-primary);">' + _escapeHtml(name) + '</h3>' +
                '<button id="rankTrajectoryClose" style="background: none; border: none; font-size: 1.5em; ' +
                'cursor: pointer; color: var(--text-secondary); padding: 0 4px;">&times;</button>' +
            '</div>' +
            '<div style="max-height: 74vh; overflow-y: auto;">' + buildTrajectoryHtml(name) + '</div>' +
            '<div style="margin-top: 14px; display: flex; gap: 10px;">' +
                '<button id="rankTrajectoryFind" style="padding: 8px 16px; background: #1565c0; color: white; ' +
                'border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.9em;">Find in table</button>' +
            '</div>';

        overlay.appendChild(content);
        document.body.appendChild(overlay);

        var close = function () { overlay.remove(); };
        document.getElementById('rankTrajectoryClose').addEventListener('click', close);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        document.getElementById('rankTrajectoryFind').addEventListener('click', function () {
            close();
            _scrollToRow(name);
        });
    }

    // The old behaviour of a name click, kept behind a button in the modal.
    function _scrollToRow(name) {
        var row = document.querySelector('#centerRankingTableWrapper tr[data-employee="' + CSS.escape(name) + '"]');
        if (!row) return;
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.style.transition = 'background 0.3s';
        row.style.background = _isDark() ? '#1e3a5f' : '#bbdefb';
        setTimeout(function () { row.style.background = ''; }, 2000);
    }

    /**
     * Render the center ranking view
     */
    function renderCenterRanking() {
        var container = document.getElementById('centerRankingContent');
        if (!container) return;

        // Recomputed per render, not per sort — an upload between renders must
        // not leave stale movement on screen.
        _momCache = undefined;
        var _pcMod2 = window.DevCoachModules && window.DevCoachModules.periodCompare;
        if (_pcMod2 && _pcMod2.resetTimelineCache) _pcMod2.resetTimelineCache();

        // Drop the remembered key if it no longer resolves (period was deleted,
        // replaced by cleanup, or hydrated from a different source mid-session).
        //
        // A 'month:' key is assembled on demand and is deliberately absent from
        // both stores, so it must not be tested by lookup — doing so threw away
        // every rebuilt-month selection the instant it was made, and the view
        // silently snapped back to the auto-picked YTD.
        if (_selectedRankingPeriodKey && String(_selectedRankingPeriodKey).indexOf(MONTH_KEY_PREFIX) !== 0) {
            var wData = _getWeeklyData();
            var yData = _getYtdData();
            if (!wData[_selectedRankingPeriodKey] && !yData[_selectedRankingPeriodKey]) {
                _selectedRankingPeriodKey = null;
                _rankingPeriodInitialized = false;
            }
        }

        // Default to most recent YTD period on first render. Only mark as
        // initialized once a YTD is actually found — otherwise a later render
        // (after data hydrates) will re-attempt the auto-pick.
        if (!_rankingPeriodInitialized) {
            var periods = _getAvailableRankingPeriods();
            var ytdPeriod = periods.find(function(p) { return p.type === 'ytd' && p.count >= 30; });
            if (ytdPeriod) {
                _selectedRankingPeriodKey = ytdPeriod.key;
                _rankingPeriodInitialized = true;
            }
        }

        var currentSelectValue = _selectedRankingPeriodKey || '';

        var data;
        if (_selectedRankingPeriodKey) {
            data = buildRankingsForPeriod(_selectedRankingPeriodKey);
        }
        // Fall back to the best-available source if the selected period
        // produced nothing. Covers stale keys, insufficient employees in the
        // selected period, and mid-session data swaps.
        if (!data || data.rankings.length === 0) {
            data = buildCenterRankings();
            if (data && data.rankings.length > 0) {
                _selectedRankingPeriodKey = data.periodKey || null;
                currentSelectValue = _selectedRankingPeriodKey || '';
            }
        }

        if (!data || data.rankings.length === 0) {
            container.innerHTML = _renderRankingPeriodSelector(currentSelectValue) +
                '<p style="color: var(--text-tertiary); text-align: center; padding: 40px;">No ranking data available. Upload a full center data set (30+ employees) to see rankings.</p>';
            var sel = document.getElementById('rankingPeriodSelect');
            if (sel) sel.addEventListener('change', _onRankingPeriodChange);
            return;
        }

        var html = '';

        // Period selector
        html += _renderRankingPeriodSelector(currentSelectValue);

        // Header
        html += '<div style="margin-bottom: 20px; padding: 15px; background: ' + (_isDark() ? '#12243a' : '#e3f2fd') +
            '; border-radius: 8px; border-left: 4px solid #1565c0;">';
        html += '<strong>Center Rankings</strong> &mdash; ' + data.totalEmployees + ' employees scored';
        html += '<br><span style="color: var(--text-secondary); font-size: 0.85em;">Source: ' + _escapeHtml(data.source) + ' | Ranked by KPIs Met &rarr; Score Sum &rarr; KPI Rank Total &rarr; Tiebreaker</span>';

        // Say exactly what the movement column compares, including the shared
        // population. "75th of 127" against "100th of 121" would not be a
        // like-for-like move, so movement is ranked over the people present in
        // both periods and that count is stated rather than implied.
        var _mom = _monthMovement();
        if (_mom) {
            html += '<br><span style="color: var(--text-secondary); font-size: 0.85em;">' +
                '&#9650;&#9660; Movement: <strong>' + _escapeHtml(_mom.previous.label) + '</strong> &rarr; <strong>' +
                _escapeHtml(_mom.current.label) + (_mom.current.inProgress ? ' (so far)' : '') + '</strong>' +
                ' &mdash; ranked across the ' + _mom.total + ' scored in both';
            if (_mom.onlyCurrent.length || _mom.onlyPrevious.length) {
                html += ' (' + _mom.onlyCurrent.length + ' new, ' + _mom.onlyPrevious.length + ' not in the later one)';
            }
            html += '.';
            // Two rank scales sit on this page — the table's, over everyone in the
            // selected period, and movement's, over the people in both, across a
            // different window. Left unsaid, the difference reads as the numbers
            // disagreeing. Stated unconditionally: the windows differ even when the
            // head counts happen to match, and that is the half readers get wrong.
            html += ' Rank in the table is <strong>' + _escapeHtml(_selectedPeriodPhrase(data)) +
                '</strong>, out of ' + data.totalEmployees +
                ' &mdash; a different window from the movement column, not just a different count.';
            if (_mom.fellBack) {
                html += ' <span style="color: #e65100;">Only one ' + (SCOPE_NOUN[_mom.requestedScope] || _mom.requestedScope) +
                    ' is available, so there is nothing to compare it against &mdash; showing months instead.</span>';
            }
            // A comparison that stops short of today explains itself, rather than
            // looking like uploads went missing.
            if (_mom.skippedInProgress) {
                html += ' <span style="color: #e65100;">' + _escapeHtml(_mom.skippedInProgress.label) +
                    ' is still in progress' +
                    (_mom.skippedInProgress.weekCount ? ' (' + _mom.skippedInProgress.weekCount + ' weeks so far)' : '') +
                    ', so it is set aside &mdash; half a month against a full one moves people on sample size, not performance.</span>';
            } else if (_mom.comparingInProgress) {
                html += ' <span style="color: #e65100;">' + _escapeHtml(_mom.current.label) +
                    ' is not finished yet, so it is being compared against a full month &mdash; expect movement that is partly sample size.</span>';
            }
            html += '</span>';

            // Without this, a June-to-July comparison shown in September just looks
            // stale, when in fact August was skipped for covering a fraction of the centre.
            if (_mom.skippedPartial && _mom.skippedPartial.length) {
                html += '<br><span style="color: #e65100; font-size: 0.85em;">Skipped ' +
                    _mom.skippedPartial.map(function (s) {
                        return _escapeHtml(s.label) + ' &mdash; only ' + s.count + ' associates uploaded';
                    }).join(', ') +
                    '. Upload the full ' + (SCOPE_NOUN[_mom.scope] || 'period') + ' to compare against it.</span>';
            }
        }
        html += '</div>';

        // Team summary
        var teamRanks = data.rankings.filter(function (r) { return data.teamMembers.has(r.name); });
        var _teamMovement = _movementByName();
        var _teamPeriodPhrase = _selectedPeriodPhrase(data);
        var _teamMovementLabels = _mom
            ? { previous: _mom.previous.label, current: _mom.current.label + (_mom.current.inProgress ? ' (so far)' : ''), total: _mom.total }
            : null;
        if (teamRanks.length > 0) {
            html += '<div style="margin-bottom: 20px; padding: 15px; background: var(--bg-surface); border-radius: 8px; border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(0,0,0,0.08);">';
            html += '<h4 style="margin-top: 0; color: var(--text-primary);">Your Team</h4>';
            /* The headline rank and the movement ranks are measured over different
               WINDOWS as well as different populations, and the window is the half
               that gets missed. The old caption offered only "126 in this period"
               against "123 scored in both", which actively hands the reader a wrong
               story: told the whole difference is three missing people, a
               supervisor correctly concludes that #9 and #29 cannot both be true.

               Said once here rather than repeated on every card. */
            if (_teamMovementLabels) {
                html += '<p style="margin: 0 0 12px 0; color: var(--text-secondary); font-size: 0.85em;">' +
                    'The big number is where each person ranks <strong>' + _escapeHtml(_teamPeriodPhrase) +
                    '</strong>, out of the ' + data.totalEmployees + ' scored in that period. The line under it is a ' +
                    'separate <strong>' + _escapeHtml(_teamMovementLabels.previous) + '</strong> &rarr; <strong>' +
                    _escapeHtml(_teamMovementLabels.current) + '</strong> comparison, with both of those periods ' +
                    're-ranked from scratch over the ' + _teamMovementLabels.total + ' people scored in both. ' +
                    'Different window, different field &mdash; the two sets of ranks are not on the same scale ' +
                    'and are not meant to line up.</p>';
            }
            html += '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 10px;">';

            teamRanks.forEach(function (r) {
                var statusColor = r.trackStatusValue === 'on-track-exceptional' ? (_isDark() ? '#66bb6a' : '#2e7d32') :
                    r.trackStatusValue === 'on-track-successful' ? (_isDark() ? '#9ccc65' : '#8bc34a') :
                    (_isDark() ? '#ef5350' : '#c62828');
                var statusBg = r.trackStatusValue === 'on-track-exceptional' ? (_isDark() ? '#0d2a1a' : '#e8f5e9') :
                    r.trackStatusValue === 'on-track-successful' ? (_isDark() ? '#16240f' : '#f1f8e9') :
                    (_isDark() ? '#2a1210' : '#fbe9e7');
                // Share of the rest of the centre this person finished ahead of.
                // The old line printed this same percentile under a "top N%" label,
                // which inverted it: #9 of 126 read "top 94%" and last place read
                // "top 1%", so the weakest performer on the panel looked elite.
                var aheadOf = data.totalEmployees > 1
                    ? Math.round(((data.totalEmployees - r.rank) / (data.totalEmployees - 1)) * 100)
                    : 100;

                html += '<div style="padding: 12px 16px; background: ' + statusBg + '; border-radius: 8px; border-left: 4px solid ' + statusColor + ';">';
                html += '<div class="ranking-card-name" data-employee="' + _escapeHtml(r.name) + '" style="font-weight: bold; font-size: 1.05em; cursor: pointer; text-decoration: underline;">' + _escapeHtml(r.name) + '</div>';
                html += '<div style="margin-top: 4px;">';
                html += '<span style="font-size: 1.3em; font-weight: bold; color: ' + statusColor + ';">#' + r.rank + '</span>';
                html += ' <span style="color: var(--text-secondary); font-size: 0.85em;">of ' + data.totalEmployees +
                    ' ' + _escapeHtml(_teamPeriodPhrase) + ' &mdash; better than ' + aheadOf + '%</span>';
                html += '</div>';

                // Spelled out on the team cards rather than left as an arrow —
                // this is the line you would actually read before a one-on-one.
                var _cardMv = _teamMovement && _teamMovement[r.name];
                if (_cardMv && Number.isFinite(_cardMv.delta) && _teamMovementLabels) {
                    var _was = _escapeHtml(_teamMovementLabels.previous);
                    var _now = _escapeHtml(_teamMovementLabels.current);
                    if (_cardMv.delta === 0) {
                        html += '<div style="margin-top: 4px; font-size: 0.85em; color: var(--text-secondary);">Held at #' +
                            _cardMv.curRank + ' &mdash; same in ' + _was + ' and ' + _now + '</div>';
                    } else if (!_cardMv.scoreChanged) {
                        // Said plainly, because this is the line that would otherwise
                        // get read out as praise for a move nobody earned.
                        html += '<div style="margin-top: 4px; font-size: 0.85em; color: var(--text-secondary);">' +
                            'Moved ' + (_cardMv.delta > 0 ? 'up ' : 'down ') + Math.abs(_cardMv.delta) +
                            ' &mdash; #' + _cardMv.prevRank + ' in ' + _was + ', #' + _cardMv.curRank + ' in ' + _now +
                            ', on the same score (' + _cardMv.curKpisMet + '/' +
                            (_cardMv.curMeasuredCount || FULL_KPI_COUNT) + ' KPIs, ' +
                            _cardMv.curScoreSum + ' in both)</div>';
                    } else {
                        var _up = _cardMv.delta > 0;
                        html += '<div style="margin-top: 4px; font-size: 0.85em; font-weight: 600; color: ' +
                            (_up ? (_isDark() ? '#66bb6a' : '#2e7d32') : (_isDark() ? '#ef5350' : '#c62828')) + ';">' +
                            (_up ? '&#9650; Up ' : '&#9660; Down ') + Math.abs(_cardMv.delta) +
                            ' &mdash; #' + _cardMv.prevRank + ' in ' + _was + ', #' + _cardMv.curRank + ' in ' + _now +
                            '<span style="font-weight: 400; color: var(--text-secondary);"> (KPIs met ' +
                            _cardMv.prevKpisMet + '&rarr;' + _cardMv.curKpisMet + ', score ' +
                            _cardMv.prevScoreSum + '&rarr;' + _cardMv.curScoreSum + ')</span></div>';
                    }
                }
                // The whole year under the one-step move, so "down 39" is read
                // against where they have actually been rather than in isolation.
                html += _renderTimelineStrip(_timelineFor(r.name));

                var kpiColor = _kpiMetColor(r.kpisMet, r.measuredCount, _isDark());
                html += '<div style="margin-top: 4px; font-size: 0.85em; color: var(--text-secondary);">' + _escapeHtml(r.trackLabel) + ' &mdash; Score: ' + r.scoreSum + '/' + (r.measuredCount * 3) + ' (KPI: ' + r.kpiScore.toFixed(1) + ')</div>';
                // Denominator is what was actually measured. Printing "4/5 KPIs met"
                // beside "Score: 12/12" said the same record two incompatible ways.
                html += '<div style="margin-top: 2px; font-size: 0.85em;"><span style="font-weight: 700; color: ' + kpiColor + ';">' +
                    r.kpisMet + '/' + r.measuredCount + ' KPIs met</span>' +
                    (r.measuredCount < FULL_KPI_COUNT
                        ? '<span style="color: var(--text-tertiary); font-weight: 400;"> &mdash; ' +
                          (FULL_KPI_COUNT - r.measuredCount) + ' not measured</span>'
                        : '') + '</div>';
                html += '<div style="font-size: 0.8em; color: #888;">Rank Total: ' + r.kpiRankTotal + ' | TB: ' + r.tiebreaker.toFixed(3) + '</div>';
                html += '</div>';
            });

            html += '</div></div>';
        }

        // Store data for re-sorting
        _lastRankingData = data;
        _currentSort = { key: 'rank', dir: 'asc' };

        // Full ranking table
        html += '<div id="centerRankingTableWrapper" style="padding: 20px; background: var(--bg-surface); border-radius: 8px; border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(0,0,0,0.08);">';
        html += '<h4 style="margin-top: 0; color: var(--text-primary);">Full Center Rankings</h4>';
        html += '<p style="margin: 0 0 12px 0; color: var(--text-secondary); font-size: 0.85em;">Click any column header to sort. ' +
            'The <strong>Rank</strong> column is ' + _escapeHtml(_selectedPeriodPhrase(data)) + '. Each metric shows value and rank (#).' +
            (_mom ? ' <strong>' + (MOVEMENT_COLUMN_LABEL[_mom.scope] || 'Move') + '</strong> is a separate ' +
                _escapeHtml(_mom.previous.label) + ' &rarr; ' + _escapeHtml(_mom.current.label) +
                ' comparison, re-ranked over the ' + _mom.total + ' people scored in both &mdash; the two ranks under the arrow are on that scale, ' +
                'not on the Rank column\'s, so the two do not subtract.' +
                ' A greyed value marked * moved with no change in KPIs met or score &mdash; position shifted among tied people, not performance.' : '') +
            '</p>';
        html += '</div>';

        container.innerHTML = html;
        renderRankingTable('rank', 'asc');

        // Bind period selector
        var sel = document.getElementById('rankingPeriodSelect');
        if (sel) sel.addEventListener('change', _onRankingPeriodChange);

        // A name opens that person's year. Scrolling to their row — what this
        // used to do — is a button inside it, because the row says no more than
        // the card already did.
        container.querySelectorAll('.ranking-card-name').forEach(function (el) {
            el.addEventListener('click', function () { _openTrajectory(el.dataset.employee); });
        });
    }

    var _lastRankingData = null;
    var _currentSort = { key: 'composite', dir: 'asc' };

    var SORT_COLUMNS = [
        { key: 'rank', label: 'Rank', getValue: function(r) { return r.rank; }, reverse: false },
        { key: 'kpisMet', label: 'KPIs Met', getValue: function(r) { return r.kpisMet; }, reverse: true },
        { key: 'scoreSum', label: 'Score Sum', getValue: function(r) { return r.scoreSum; }, reverse: true },
        { key: 'kpiScore', label: 'KPI Score', getValue: function(r) { return r.kpiScore; }, reverse: true },
        { key: 'kpiRankTotal', label: 'Rank Total', getValue: function(r) { return r.kpiRankTotal; }, reverse: false },
        { key: 'tiebreaker', label: 'Tiebreaker', getValue: function(r) { return r.tiebreaker; }, reverse: true },
        { key: 'aht', label: 'AHT', getValue: function(r) { return r.values.aht; }, reverse: false },
        { key: 'adherence', label: 'Adherence', getValue: function(r) { return r.values.adherence; }, reverse: true },
        { key: 'sentiment', label: 'Sentiment', getValue: function(r) { return r.values.sentiment; }, reverse: true },
        { key: 'associateOverall', label: 'Assoc Overall', getValue: function(r) { return r.values.associateOverall; }, reverse: true },
        { key: 'reliability', label: 'Reliability', getValue: function(r) { return r.reliability; }, reverse: false },
        // Sorts on movement that has a score change behind it. A move with no score
        // change is a reshuffle among tied people, so it returns null and sinks to
        // the bottom rather than topping a list of "biggest movers" it did not earn.
        { key: 'mom', label: 'MoM', reverse: true, getValue: function(r) {
            var map = _movementByName();
            var mv = map && map[r.name];
            return (mv && mv.scoreChanged && Number.isFinite(mv.delta)) ? mv.delta : null;
        } }
    ];

    function renderRankingTable(sortKey, sortDir) {
        var wrapper = document.getElementById('centerRankingTableWrapper');
        if (!wrapper || !_lastRankingData) return;
        var data = _lastRankingData;

        // Sort rankings
        var col = SORT_COLUMNS.find(function(c) { return c.key === sortKey; });
        var sorted = data.rankings.slice().sort(function(a, b) {
            var aVal = col ? col.getValue(a) : a.rank;
            var bVal = col ? col.getValue(b) : b.rank;
            aVal = aVal !== null && aVal !== undefined ? aVal : (sortDir === 'asc' ? Infinity : -Infinity);
            bVal = bVal !== null && bVal !== undefined ? bVal : (sortDir === 'asc' ? Infinity : -Infinity);
            return sortDir === 'asc' ? (aVal - bVal) : (bVal - aVal);
        });

        var thStyle = 'padding: 6px 3px; text-align: center; border-bottom: 2px solid #ddd; cursor: pointer; user-select: none; font-size: 0.85em;';
        var arrow = function(key) {
            if (key !== sortKey) return ' <span style="opacity: 0.3;">&#8597;</span>';
            return sortDir === 'asc' ? ' <span style="color: #1565c0;">&#9650;</span>' : ' <span style="color: #1565c0;">&#9660;</span>';
        };

        var _tableMovement = _movementByName();
        var _mv = _monthMovement();
        var _mvLabels = _mv ? { previous: _mv.previous.label, current: _mv.current.label } : null;
        var _momHeading = MOVEMENT_COLUMN_LABEL[_mv && _mv.scope] || 'Move';
        var _momTitle = _mv
            ? 'Rank movement from ' + _mv.previous.label + ' to ' + _mv.current.label +
              ', over the ' + _mv.total + ' scored in both. Sorts by moves with a real score change behind them.'
            : 'Rank movement between the last two comparable periods.';

        var html = '<div style="overflow-x: auto;">';
        html += '<table style="width: 100%; border-collapse: collapse; font-size: 0.82em; table-layout: auto;">';
        html += '<thead><tr style="background: var(--bg-surface-raised);">';
        html += '<th class="rank-sort-header" data-sort="rank" style="' + thStyle + ' width: 30px;"' +
            ' title="Rank ' + _escapeHtml(_selectedPeriodPhrase(data)) + ', out of the ' + data.totalEmployees +
            ' scored in that period. The ' + _momHeading + ' column beside it counts over different periods.">Rank' + arrow('rank') + '</th>';
        html += '<th class="rank-sort-header" data-sort="mom" style="' + thStyle + ' width: 58px;" title="' + _escapeHtml(_momTitle) + '">' + _momHeading + arrow('mom') + '</th>';
        html += '<th style="' + thStyle + ' text-align: left;">Name</th>';
        html += '<th class="rank-sort-header" data-sort="kpisMet" style="' + thStyle + '">KPIs Met' + arrow('kpisMet') + '</th>';
        html += '<th class="rank-sort-header" data-sort="scoreSum" style="' + thStyle + '">Score Sum' + arrow('scoreSum') + '</th>';
        html += '<th class="rank-sort-header" data-sort="kpiScore" style="' + thStyle + '">KPI Score' + arrow('kpiScore') + '</th>';
        html += '<th style="' + thStyle + '">Status</th>';
        html += '<th class="rank-sort-header" data-sort="aht" style="' + thStyle + '">AHT' + arrow('aht') + '</th>';
        html += '<th class="rank-sort-header" data-sort="adherence" style="' + thStyle + '">Adh' + arrow('adherence') + '</th>';
        html += '<th class="rank-sort-header" data-sort="sentiment" style="' + thStyle + '">Sent' + arrow('sentiment') + '</th>';
        html += '<th class="rank-sort-header" data-sort="associateOverall" style="' + thStyle + '">CX Adv' + arrow('associateOverall') + '</th>';
        html += '<th class="rank-sort-header" data-sort="reliability" style="' + thStyle + '">Rel' + arrow('reliability') + '</th>';
        html += '</tr></thead><tbody>';

        sorted.forEach(function (r, idx) {
            var isTeam = data.teamMembers.has(r.name);
            var supColor = _getSupervisorColor(r.name);
            var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            var defaultBg = isDark ? (idx % 2 === 0 ? '#1a1f2e' : 'transparent') : (idx % 2 === 0 ? '#fafafa' : '#fff');
            var rowBg = supColor || (isTeam ? (isDark ? '#0d2a1a' : '#e8f5e9') : defaultBg);
            var fontWeight = (isTeam || supColor) ? 'bold' : 'normal';

            // Status colors
            var statusColor, statusBg, statusText;
            if (r.trackStatusValue === 'on-track-exceptional') {
                statusColor = '#fff'; statusBg = '#2e7d32'; statusText = 'Exceptional';
            } else if (r.trackStatusValue === 'on-track-successful') {
                statusColor = '#fff'; statusBg = '#1565c0'; statusText = 'Successful';
            } else {
                statusColor = '#fff'; statusBg = '#c62828'; statusText = 'Off Track';
            }

            var scoreColor = function (s) {
                if (s === 3) return '#2e7d32';
                if (s === 2) return '#1565c0';
                return '#c62828';
            };

            // Rank cell formatting per spec
            var rankBg = '', rankColor = '';
            if (r.rank <= 26) { rankBg = '#1F4E79'; rankColor = '#FFFFFF'; }
            else if (r.rank >= 105) { rankBg = '#c62828'; rankColor = '#FFFFFF'; }

            var teamBorder = isTeam ? 'outline: 2px solid #2e7d32; outline-offset: -2px; ' : '';
            html += '<tr class="ranking-row" data-employee="' + _escapeHtml(r.name) + '" style="' + teamBorder + 'background: ' + rowBg + '; border-bottom: 1px solid var(--border); font-weight: ' + fontWeight + ';">';

            // Rank
            var rankStyle = 'padding: 4px 3px; text-align: center; font-weight: bold;';
            if (rankBg) rankStyle += ' background: ' + rankBg + '; color: ' + rankColor + ';';
            html += '<td style="' + rankStyle + '">' + r.rank + '</td>';

            // Rank movement into the selected period
            html += '<td style="padding: 4px 3px; text-align: center; font-size: 0.9em;">' +
                _movementBadge(_tableMovement && _tableMovement[r.name], true, _mvLabels) + '</td>';

            // Name
            html += '<td class="ranking-name-cell" style="padding: 4px 3px; white-space: nowrap;">';
            if (isTeam) {
                html += '<span style="color: #1565c0;">&#9733; </span>';
            } else if (supColor) {
                var _dotColor = _getSupervisorDotColor(r.name);
                html += '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + _dotColor + ';box-shadow:0 0 0 1px rgba(0,0,0,0.25);margin-right:5px;vertical-align:middle;"></span>';
            }
            html += _escapeHtml(r.name) + '</td>';

            // KPIs Met
            var kpiMetColor = _kpiMetColor(r.kpisMet, r.measuredCount, false);
            html += '<td style="padding: 4px 3px; text-align: center; font-weight: bold; color: ' + kpiMetColor + ';">' + r.kpisMet + '/' + r.measuredCount + '</td>';

            // Score Sum
            html += '<td style="padding: 4px 3px; text-align: center; font-weight: bold;">' + r.scoreSum + '</td>';

            // KPI Score
            html += '<td style="padding: 4px 3px; text-align: center; font-weight: bold; color: ' + scoreColor(Math.round(r.kpiScore)) + ';">' + r.kpiScore.toFixed(1) + '</td>';

            // Status badge
            html += '<td style="padding: 4px 3px; text-align: center;"><span style="display: inline-block; padding: 1px 5px; border-radius: 8px; font-size: 0.72em; font-weight: bold; color: ' + statusColor + '; background: ' + statusBg + ';">' + statusText + '</span></td>';

            // Individual metric cells
            var metricPairs = [
                { score: r.scores.aht, value: r.values.aht, key: 'aht', rankKey: 'aht' },
                { score: r.scores.adherence, value: r.values.adherence, key: 'scheduleAdherence', rankKey: 'adherence' },
                { score: r.scores.sentiment, value: r.values.sentiment, key: 'overallSentiment', rankKey: 'sentiment' },
                { score: r.scores.associateOverall, value: r.values.associateOverall, key: 'cxRepOverall', rankKey: 'associateOverall' },
                { score: r.scores.reliability, value: r.reliability, key: 'reliability', rankKey: 'reliability' }
            ];

            metricPairs.forEach(function (mp) {
                var display = mp.value !== null && mp.value !== undefined ? _formatMetricDisplay(mp.key, mp.value) : '--';
                var metricRank = r.metricRanks?.[mp.rankKey] || '?';
                var rankTextColor = metricRank <= 10 ? '#2e7d32' : metricRank <= Math.round(data.totalEmployees * 0.5) ? '#666' : '#c62828';
                var scoreBadge = mp.score !== null
                    ? '<span style="display: inline-block; width: 18px; height: 18px; line-height: 18px; border-radius: 50%; font-size: 0.7em; font-weight: bold; color: white; background: ' + scoreColor(mp.score) + '; text-align: center; margin-right: 3px;">' + mp.score + '</span>'
                    : '';
                var surveyBadge = '';
                if (mp.rankKey === 'associateOverall' && r.surveyTotal > 0) {
                    surveyBadge = ' <span style="font-size: 0.68em; color: #888;">(' + r.surveyTotal + ')</span>';
                }
                var cellColor = mp.score !== null ? scoreColor(mp.score) : '#333';
                html += '<td style="padding: 4px 3px; text-align: center; color: ' + cellColor + '; white-space: nowrap;">' +
                    scoreBadge + display + surveyBadge + ' <span style="font-size: 0.72em; color: ' + rankTextColor + ';">#' + metricRank + '</span></td>';
            });

            html += '</tr>';
        });

        html += '</tbody></table>';
        html += '</div>';

        // Keep the header content, replace just the table area
        var existingHeader = wrapper.querySelector('h4');
        var existingDesc = wrapper.querySelector('p');
        wrapper.innerHTML = '';
        if (existingHeader) wrapper.appendChild(existingHeader);
        if (existingDesc) wrapper.appendChild(existingDesc);
        var tableDiv = document.createElement('div');
        tableDiv.innerHTML = html;
        wrapper.appendChild(tableDiv.firstChild);

        // Bind sort headers
        wrapper.querySelectorAll('.rank-sort-header').forEach(function(th) {
            th.addEventListener('click', function() {
                var newKey = th.dataset.sort;
                var col = SORT_COLUMNS.find(function(c) { return c.key === newKey; });
                var defaultDir = col && col.reverse ? 'desc' : 'asc';
                var newDir;
                if (_currentSort.key === newKey) {
                    newDir = _currentSort.dir === 'asc' ? 'desc' : 'asc';
                } else {
                    newDir = defaultDir;
                }
                _currentSort = { key: newKey, dir: newDir };
                renderRankingTable(newKey, newDir);
            });
        });
    }

    /**
     * Reset the period selector so the next render re-picks the best YTD period.
     * Call after new data uploads so rankings reflect the latest data.
     */
    function resetPeriodSelection() {
        _rankingPeriodInitialized = false;
        _selectedRankingPeriodKey = null;
    }

    /* ── Module export ── */
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.centerRanking = {
        EXTRA_RANK_METRICS: EXTRA_RANK_METRICS,
        KPI_RANK_METRICS: KPI_RANK_METRICS,
        renderCenterRanking: renderCenterRanking,
        buildCenterRankings: buildCenterRankings,
        buildRankingsForPeriod: buildRankingsForPeriod,
        // Ranks an arbitrary employee array. period-compare uses it to re-rank a
        // past month, since rank is computed on demand and never stored.
        scoreAndRankEmployees: _scoreAndRank,
        // The modal body, built without touching the DOM, so what a name click
        // shows can be asserted rather than eyeballed.
        buildTrajectoryHtml: buildTrajectoryHtml,
        resetPeriodSelection: resetPeriodSelection
    };

    window.renderCenterRanking = renderCenterRanking;
})();
