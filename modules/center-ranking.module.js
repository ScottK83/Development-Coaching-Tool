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
            var sups = (window.DevCoachModules?.storage?.readStore?.('employeeSupervisors') ?? {});
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
            var sups = (window.DevCoachModules?.storage?.readStore?.('employeeSupervisors') ?? {});
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

       Movement measures INTO the selected period, not into the newest one. A
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
        // A month-to-date row is a month, and months are what it compares against.
        if (type === 'month-to-date') return 'month';
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
       puts all three in sequence and gets an impossible timeline. "#9 ... #21 in
       July ... #29 in August" reads as a person who was 21st, then 29th, and is
       somehow now 9th. Every rank on the card names its own period. */
    function _selectedPeriodName(data) {
        var key = (data && data.periodKey) || _selectedRankingPeriodKey;
        var match = key ? _getAvailableRankingPeriods().filter(function (p) {
            return p.key === key;
        })[0] : null;
        // "July 2026 (rebuilt from 4 weeks)" is provenance, not a period name, and
        // the provenance is already stated in the header.
        var trim = function (label) { return String(label).replace(/\s*\([^)]*\)\s*$/, ''); };
        if (match) return match.type === 'ytd' ? 'Year to date' : trim(match.label);
        return (data && data.source) ? trim(data.source) : '';
    }

    function _selectedPeriodPhrase(data) {
        var name = _selectedPeriodName(data);
        if (!name) return 'in this period';
        return name === 'Year to date' ? 'year to date' : 'in ' + name;
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
    // sit tied and reshuffle on tiebreakers alone. Colouring that like an
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
            return '<span style="color: var(--text-tertiary);" title="Same rank in ' + was + ' and ' + now + '">-</span>' +
                pair('#' + mv.curRank + ' both');
        }
        var up = mv.delta > 0;
        var color = mv.scoreChanged ? (up ? '#2e7d32' : '#c62828') : 'var(--text-tertiary)';
        var title = '#' + mv.prevRank + ' in ' + was + ', #' + mv.curRank + ' in ' + now + '. ' +
            (mv.scoreChanged
                ? 'KPIs met ' + mv.prevKpisMet + '→' + mv.curKpisMet + ', score ' + mv.prevScoreSum + '→' + mv.curScoreSum
                : 'Same score (' + mv.curKpisMet + ' KPIs, ' + mv.curScoreSum + '), position shifted among tied people, not performance');
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
        // a fraction of the centre can be marked. Still offered. A one-team report
        // is a legitimate thing to look at. But marked, because "July 2026 (18
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

    // One wording for every surface. See periodIndex.periodLabel.
    function _fmtPeriodLabel(key, type) {
        return window.DevCoachModules.periodIndex.periodLabel(key, type);
    }

    // Whether the full list of every upload on file is showing. The chips
    // answer the common question; this is the rarer one, one click behind.
    var _rankingShowAllPeriods = false;

    function _renderRankingPeriodSelector(selectedValue) {
        var picker = window.DevCoachModules && window.DevCoachModules.periodPicker;
        var periods = _getAvailableRankingPeriods();
        var typeOrder = ['ytd', 'quarter', 'month-to-date', 'month', 'month-agg', 'week', 'week-in-progress', 'daily'];
        var typeLabels = { ytd: 'YTD', quarter: 'Quarterly', 'month-to-date': 'Month to Date', month: 'Monthly', 'month-agg': 'Monthly (rebuilt from weeks)', week: 'Weekly', 'week-in-progress': 'Week to Date', daily: 'Daily' };
        var grouped = {};
        periods.forEach(function(p) {
            var t = p.type || 'week';
            if (!grouped[t]) grouped[t] = [];
            grouped[t].push(p);
        });

        // The chips first: the four or five windows anybody actually asks for,
        // in the same row, in the same order, in the same colours as My Team.
        var chipHtml = '';
        var windows = picker ? picker.windows() : [];
        if (picker && windows.length) {
            var chosenChip = picker.idForKey(windows, selectedValue);
            var items = windows.concat([{
                id: 'pick',
                label: 'Pick a period',
                available: true,
                title: 'Any single upload on file, by its own dates'
            }]);
            // A key that is none of the windows came out of the full list, so
            // that is the chip that is lit and the list stays open under it.
            var showAll = _rankingShowAllPeriods || (selectedValue && !chosenChip);
            chipHtml = picker.renderRow(items, chosenChip || (showAll ? 'pick' : 'latest'), {
                id: 'rankingPeriodChips',
                chipClass: 'cr-period-chip',
                marginBottom: showAll ? '10px' : '16px'
            });
            if (!showAll) return chipHtml;
        }

        var html = chipHtml + '<div style="margin-bottom: 16px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap;">';
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
                    ' (' + p.count + ' employees' + (p.partial ? ', partial upload' : '') + ')</option>';
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

    // Clicking a chip either picks that window or opens the full list.
    function _bindRankingPeriodChips() {
        var picker = window.DevCoachModules && window.DevCoachModules.periodPicker;
        var row = document.getElementById('rankingPeriodChips');
        if (!picker || !row) return;
        picker.bindRow(row, function (id) {
            if (id === 'pick') {
                _rankingShowAllPeriods = true;
            } else {
                _rankingShowAllPeriods = false;
                _selectedRankingPeriodKey = picker.keyForId(picker.windows(), id);
            }
            _rankingPeriodInitialized = true;
            renderCenterRanking();
        }, { chipClass: 'cr-period-chip' });
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
            // Which survey actually stands behind the "CX Adv" number. The scorer
            // falls back from rep sat to Overall Experience when rep sat is blank
            // or zero, and every surface downstream printed the result under the
            // rep-sat label, so a cell could read "CX Adv 66.7%" while rep sat was
            // 100% and untouched.
            associateOverallSource: result.associateOverallSource || null,
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
                associateOverallSource: score.associateOverallSource,
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
            teamMembers: new Set(_getTeamMembersForWeek(lastWeekKey)),

            /* What this month ACTUALLY covers, carried rather than left behind.

               A rebuild buckets whole weekly uploads by the date they end on, so
               January 2026 can hold five of them and start on 28 December. A
               consumer that throws this away and re-derives the window from the
               calendar month gets a shorter month than the volume in these
               rankings was banked over, and then reads a pace out of it that no
               real month could produce. The what-if ladder did exactly that and
               inflated every projected value and placing by a quarter.

               weekCount is the number of weekly uploads behind a rebuild, which
               is a week apiece and therefore exact where dividing days by seven
               only rounds. It is deliberately null for an uploaded month, where
               the single entry is a month rather than a week and counting it as
               one would overstate the pace fourfold. */
            spanStart: agg.spanStart || null,
            spanEnd: agg.spanEnd || null,
            weekCount: agg.fromUpload ? null : agg.weekCount
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

    function _pcMonthLabel(monthKey) {
        var pc = window.DevCoachModules && window.DevCoachModules.periodCompare;
        return (pc && pc.monthLabel) ? pc.monthLabel(monthKey) : String(monthKey);
    }

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
        if (pt.delta === 0) return ' <span style="color: var(--text-tertiary);">-</span>';
        return ' <span style="color: ' + _deltaColor(pt) + ';">' +
            (pt.delta > 0 ? '&#9650;' : '&#9660;') + Math.abs(pt.delta) +
            (pt.scoreChanged ? '' : '<span style="opacity:0.7;">*</span>') + '</span>';
    }

    function _pointTitle(pt) {
        var parts = [pt.label + (pt.inProgress ? ' (so far)' : '') +
            ': #' + pt.rank + ' of ' + pt.total];
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
    // One geometry for the chart and the table beneath it, so a plotted point
    // sits directly over the column it belongs to at every scroll position.
    var TRAJECTORY_LABEL_COL = 104;   // the sticky row-label column
    var TRAJECTORY_COL_WIDTH = 116;   // one period

    function _trajectoryGeometry(columns) {
        return {
            labelCol: TRAJECTORY_LABEL_COL,
            colWidth: TRAJECTORY_COL_WIDTH,
            width: TRAJECTORY_LABEL_COL + TRAJECTORY_COL_WIDTH * columns.length
        };
    }

    /* One column per month of the year so far, whether it produced a rank or not.

       A trajectory that starts in May reads as a year that started in May. The
       empty months are part of the progress picture — they say the data is
       missing, not that the person is — and each one carries the reason, because
       "one week uploaded" and "nothing uploaded" send you to different places. */
    function _trajectoryColumns(series) {
        var tl = _timeline();
        var coverage = tl && tl.coverage;
        var byKey = {};
        series.forEach(function (pt) { byKey[pt.key] = pt; });

        if (!coverage || !coverage.length) {
            return series.map(function (pt) { return { key: pt.key, label: pt.label, point: pt, status: 'ranked' }; });
        }

        var columns = coverage.map(function (mo) {
            return {
                key: mo.key,
                label: mo.label,
                inProgress: !!mo.inProgress,
                status: byKey[mo.key] ? 'ranked' : mo.status,
                reason: byKey[mo.key] ? '' : mo.reason,
                point: byKey[mo.key] || null
            };
        });

        // A month the coverage list does not know about — a scope that is not
        // months, or a period from another year — must still be shown.
        series.forEach(function (pt) {
            if (!columns.some(function (c) { return c.key === pt.key; })) {
                columns.push({ key: pt.key, label: pt.label, status: 'ranked', point: pt, reason: '' });
            }
        });
        return columns;
    }

    function _trajectorySvg(columns, reference, geom) {
        var series = columns.filter(function (c) { return c.point; }).map(function (c) { return c.point; });
        if (!series.length) return '';
        var W = geom.width, H = 200, padL = geom.labelCol, padR = 8, padT = 18, padB = 30;
        var worst = series.reduce(function (m, pt) {
            return Math.max(m, pt.total, pt.overallTotal || 0);
        }, 1);
        if (reference && Number.isFinite(reference.rank)) worst = Math.max(worst, reference.total || 1);
        var span = Math.max(1, worst - 1);
        var x = function (i) { return padL + geom.colWidth * (i + 0.5); };
        var y = function (rank) { return padT + ((rank - 1) / span) * (H - padT - padB); };

        var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" ' +
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

        /* Two lines, drawn as one run per unbroken stretch of months so a gap in
           the uploads shows as a gap rather than a trend through months nobody
           measured.

           The heavy blue line is the month itself. The lighter one underneath is
           where they stand for the YEAR as of that month — the question a month
           rank cannot answer, because someone can have a poor August and still be
           climbing on the year. */
        var drawRuns = function (valueOf, stroke, width, dash) {
            var run = [];
            var flush = function () {
                if (run.length > 1) {
                    svg += '<polyline points="' + run.join(' ') + '" fill="none" stroke="' + stroke +
                        '" stroke-width="' + width + '"' + (dash ? ' stroke-dasharray="' + dash + '"' : '') +
                        ' stroke-linejoin="round" stroke-linecap="round" />';
                }
                run = [];
            };
            columns.forEach(function (col, i) {
                var v = col.point ? valueOf(col.point) : null;
                if (!Number.isFinite(v)) { flush(); return; }
                run.push(x(i) + ',' + y(v));
            });
            flush();
        };

        drawRuns(function (pt) { return pt.overallRank; }, '#8e6bbf', 2, '4 3');
        drawRuns(function (pt) { return pt.rank; }, '#1565c0', 2, null);

        // Hollow markers for the year line, so the two are told apart without
        // relying on colour alone.
        columns.forEach(function (col, i) {
            if (!col.point || !Number.isFinite(col.point.overallRank)) return;
            svg += '<circle cx="' + x(i) + '" cy="' + y(col.point.overallRank) + '" r="3.5" ' +
                'fill="var(--bg-surface)" stroke="#8e6bbf" stroke-width="2" />';
        });

        columns.forEach(function (col, i) {
            if (!col.point) {
                // An empty slot is still a month of the year, so it keeps its
                // label and says so rather than vanishing.
                svg += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle" ' +
                    'font-size="10" fill="var(--text-tertiary)">' + _escapeHtml(_shortPeriodLabel(col.label)) + '</text>';
                svg += '<text x="' + x(i) + '" y="' + (padT + (H - padT - padB) / 2) + '" text-anchor="middle" ' +
                    'font-size="9" fill="var(--text-tertiary)">no data</text>';
                return;
            }
            var pt = col.point;
            var fill = pt.trackStatusValue === 'on-track-exceptional' ? '#2e7d32'
                : pt.trackStatusValue === 'on-track-successful' ? '#1565c0' : '#c62828';
            svg += '<circle cx="' + x(i) + '" cy="' + y(pt.rank) + '" r="4.5" fill="' + fill + '" />';
            svg += '<text x="' + x(i) + '" y="' + (y(pt.rank) - 9) + '" text-anchor="middle" ' +
                'font-size="10" font-weight="bold" fill="var(--text-primary)">' + pt.rank + '</text>';
            svg += '<text x="' + x(i) + '" y="' + (H - 8) + '" text-anchor="middle" ' +
                'font-size="10" fill="' + (col.inProgress ? '#e65100' : 'var(--text-secondary)') + '">' +
                _escapeHtml(_shortPeriodLabel(col.label)) + '</text>';
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

    // A month where the CX Adv figure is not rep sat at all. Marked rather than
    // footnoted: the reader is comparing it against a rep-sat number they have
    // open in another window, and silence there costs them the comparison.
    function _substitutedSurveyNote(pt, row) {
        if (row.scoreKey !== 'associateOverall') return '';
        if (pt.associateOverallSource !== 'overallExperience') return '';
        return '<span title="Rep sat was blank or zero this month, so this is Overall Experience"' +
            ' style="color: #e65100; font-weight: 700;"> OE</span>';
    }

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


    /* ── The what-if ladder ──

       A supervisor preparing a one-to-one keeps asking the same question and
       until now had to answer it on paper: if this person held a better number
       for a month, where would that actually leave them? The value half of that
       is safe arithmetic. The placing half is not, because it is computed on a
       frozen field and the field is never frozen — the other 126 people are
       working the same month and a good many of them are pushing the same way.
       Somebody who does exactly what they were asked and lands three places
       short of what they were promised has been made a liar of by their coach.

       So the ladder is built here, in the modal that opens when a manager
       clicks a name, and nowhere an associate can be shown it. The caveat is
       printed beside every block rather than left to be remembered, because the
       numbers are persuasive and a remembered caveat is not.

       Every piece of arithmetic below belongs to rank-projection.module.js.
       Nothing in this file recomputes a blend or a placing; it decides what is
       worth saying and refuses to say the rest. The module is reached at call
       time and its absence is silence rather than a crash, because it is not in
       every page that loads this one.

       Reliability is absent by design, and the section says so out loud rather
       than quietly dropping a metric the table above lists. It is hours missed
       against a budget for the whole year, not an average, so "hold this for a
       month" has nothing to blend. */

    /* The number the ladder holds somebody to.

       It has to be a figure that survives being said out loud in a one-to-one,
       which rules out a round number chosen because it looks like a goal. The
       figure standing at #10 in this same period is defensible on its own: a
       colleague in this centre is producing it right now, on this metric, under
       the same conditions, and the top 10 is the door supervisors actually ask
       about.

       Somebody already inside that door cannot be held to it. The blend would
       pull their year DOWN and the ladder would print a fall dressed as a plan,
       so for them the held figure is the one at the very top of the field
       instead. Somebody already at the top of the field has nothing above them
       to hold to, and the block says so rather than inventing a stretch. */
    var LADDER_DOOR_RANK = 10;

    /* The rungs, measured in weeks.

       Four weeks rather than a calendar month because every volume behind every
       other number in this modal is counted in whole weeks; a 30.4-day month
       would be the only quantity here measured in days, and the extra precision
       buys nothing a supervisor can act on. The third rung is the weeks left in
       the year and is appended per period, since a December period has none. */
    var LADDER_RUNGS = [
        { label: '1 week', weeks: 1 },
        { label: '1 month', weeks: 4 }
    ];

    /* The projectable KPIs, in the order the table above reads them, with the
       two survey metrics that rank but sit outside the five-KPI scorecard added
       on the end. Labels are copied from TRAJECTORY_METRIC_ROWS where the two
       overlap, so one modal never names the same number two ways. */
    var LADDER_ROWS = [
        { label: 'AHT', rankKey: 'aht' },
        { label: 'Adherence', rankKey: 'adherence' },
        { label: 'Sentiment', rankKey: 'sentiment' },
        { label: 'CX Adv', rankKey: 'associateOverall' },
        { label: 'FCR', rankKey: 'fcr' },
        { label: 'Overall Experience', rankKey: 'overallExperience' }
    ];

    var LADDER_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

    function _rankProjection() {
        var mod = window.DevCoachModules && window.DevCoachModules.rankProjection;
        return (mod && mod.projectValue) ? mod : null;
    }

    function _ladderIsReverse(rp, rankKey) {
        var registryKey = rp.registryKeyFor ? rp.registryKeyFor(rankKey) : null;
        if (!registryKey) return false;
        if (typeof window.isReverseMetric === 'function') return !!window.isReverseMetric(registryKey);
        var entry = window.METRICS_REGISTRY && window.METRICS_REGISTRY[registryKey];
        return !!(entry && entry.isReverse);
    }

    function _ladderBetter(value, other, reverse) {
        return reverse ? value < other : value > other;
    }

    function _ladderIsDate(value) {
        return /^\d{4}-\d{2}-\d{2}$/.test(String(value == null ? '' : value));
    }

    /* The dates the selected period really covers, plus the exact number of
       weeks banked inside them where the period knows it.

       The blend needs a volume per week, and the only honest way to get one is
       to divide the volume already banked by the weeks it was banked over. A
       week or a year-to-date file carries startDate and endDate on the upload,
       with the pipe-separated key as the fallback for older files that were
       stored without metadata.

       A month used to be derived from its name, and that was the bug. A rebuilt
       month is aggregated from whole weekly uploads bucketed by the date they
       END on, so January 2026 can hold five weeks and begin on 28 December.
       Measuring it as the 31 days on the calendar called five weeks of banked
       calls four, lifted the per-week pace by a quarter, and every rung then
       printed a value and a placing better than a real month could deliver: for
       somebody on 91.2% adherence held to a 96.0% door, 93.6% and approx #16
       where the truth was 93.3% and #17. Nothing about that error was visible on
       the page, which is what makes it worth this much comment. So the span the
       aggregate really covered is carried through _buildRankingsForMonth and
       read here instead. It runs the other way too: a month rebuilt from two or
       three weeks was being read as four and its pace understated. */
    function _ladderSpan(data) {
        var key = String((data && data.periodKey) || _selectedRankingPeriodKey || '');
        if (!key) return null;
        if (key.indexOf(MONTH_KEY_PREFIX) === 0) {
            var counted = (data && Number.isFinite(data.weekCount) && data.weekCount > 0) ? data.weekCount : null;
            if (_ladderIsDate(data && data.spanStart) && _ladderIsDate(data && data.spanEnd)) {
                return { start: data.spanStart, end: data.spanEnd, weeks: counted };
            }

            // Last resort, for an aggregate that came back without dates on it:
            // the calendar month, which is the approximation described above and
            // is only reached when there is nothing truer to read. A rebuild
            // still gets its pace right here, because the week count travels
            // separately from the dates.
            var month = key.slice(MONTH_KEY_PREFIX.length);
            var y = parseInt(month.slice(0, 4), 10);
            var m = parseInt(month.slice(5, 7), 10);
            if (!y || !m) return null;
            // Day 0 of the next month is the last day of this one, which beats
            // carrying a table of month lengths and a leap-year rule beside it.
            var lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
            return {
                start: month + '-01',
                end: month + '-' + (lastDay < 10 ? '0' : '') + lastDay,
                weeks: counted
            };
        }
        var period = _getWeeklyData()[key] || _getYtdData()[key];
        var meta = (period && period.metadata) || {};
        var parts = key.split('|');
        var start = meta.startDate || parts[0] || '';
        var end = meta.endDate || parts[1] || '';
        if (!_ladderIsDate(start) || !_ladderIsDate(end)) return null;
        return { start: start, end: end, weeks: null };
    }

    // Both ends inclusive: a Monday-to-Sunday week is seven days of work, not
    // six, and rounding it to one week matters because the per-week volume this
    // divides out is what every rung is scaled by. A counted week total beats
    // that rounding wherever the period carried one, since those weeks are whole
    // uploads and no arithmetic on the dates can be surer than a count of them.
    function _ladderWeeks(span) {
        var start = Date.parse(span.start + 'T00:00:00Z');
        var end = Date.parse(span.end + 'T00:00:00Z');
        if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
        var yearEnd = Date.parse(span.end.slice(0, 4) + '-12-31T00:00:00Z');
        var covered = (Number.isFinite(span.weeks) && span.weeks > 0)
            ? span.weeks
            : Math.round((end - start + 86400000) / LADDER_WEEK_MS);
        return {
            covered: Math.max(1, covered),
            left: Number.isFinite(yearEnd) ? Math.max(0, Math.round((yearEnd - end) / LADDER_WEEK_MS)) : 0
        };
    }

    function _ladderHoldValue(rp, rankings, rankKey, currentValue) {
        var reverse = _ladderIsReverse(rp, rankKey);
        var door = rp.thresholdValueForRank(rankings, rankKey, LADDER_DOOR_RANK);
        if (door !== null && _ladderBetter(door, currentValue, reverse)) {
            return { value: door, place: LADDER_DOOR_RANK };
        }
        var front = rp.thresholdValueForRank(rankings, rankKey, 1);
        if (front !== null && _ladderBetter(front, currentValue, reverse)) {
            return { value: front, place: 1 };
        }
        return null;
    }

    /* isProjectable answers yes or no, and yes or no is not enough here.

       The modal already names the months it has no ranking for instead of
       showing eleven columns and hoping nobody counts; a metric that silently
       vanishes from this list would send the reader back to the upload to work
       out why. So the two floors are re-tested against the same numbers purely
       to say WHICH one stopped it. If the gate ever changes, this changes with
       it or the page starts naming a floor that is no longer the reason. */
    function _ladderFloorReason(rp, rankKey, row) {
        var callFloor = Number.isFinite(window.MIN_CALLS_TO_JUDGE) ? window.MIN_CALLS_TO_JUDGE : 20;
        var calls = parseFloat(row.totalCalls);
        if (Number.isFinite(calls) && calls < callFloor) {
            return 'not paced , ' + calls + ' call' + (calls === 1 ? '' : 's') + ' in this period, under the ' +
                callFloor + ' the centre needs before it judges a number.';
        }
        var surveyFloor = Number.isFinite(rp.MIN_SURVEYS_TO_PROJECT) ? rp.MIN_SURVEYS_TO_PROJECT : 3;
        var surveys = parseFloat(row.surveyTotal);
        var isSurveyKey = !!(rp.SURVEY_WEIGHTED_RANK_KEYS && rp.SURVEY_WEIGHTED_RANK_KEYS.has(rankKey));
        if (isSurveyKey && Number.isFinite(surveys) && surveys < surveyFloor) {
            return 'not paced , ' + surveys + ' survey' + (surveys === 1 ? '' : 's') + ' returned, under the ' +
                surveyFloor + ' a survey metric needs before it ranks.';
        }
        return 'not paced , the volume behind it is too thin to build a pace on.';
    }

    /**
     * The ladder itself. Returns '' rather than a placeholder whenever the
     * pieces are not there, because an empty section under a heading reads as a
     * bug and a missing section reads as a view that had nothing to add.
     */
    function _buildLadderHtml(name) {
        var rp = _rankProjection();
        if (!rp || !_lastRankingData) return '';
        var rankings = _lastRankingData.rankings || [];
        var row = rankings.filter(function (r) { return r.name === name; })[0];
        if (!row) return '';

        var wrap = 'margin-top: 18px; padding-top: 14px; border-top: 2px solid var(--border);';
        var note = 'margin: 0 0 8px 0; color: var(--text-secondary); font-size: 0.82em; line-height: 1.5;';

        var span = _ladderSpan(_lastRankingData);
        var weeks = span ? _ladderWeeks(span) : null;
        if (!weeks) {
            return '<div id="rankLadderBlock" style="' + wrap + '"><p style="' + note + '">' +
                'No what-if ladder for this period: it carries no start and end date, and without them there is ' +
                'no way to work out how much volume a week of it is worth. Pick a dated period and the ladder ' +
                'comes back.</p></div>';
        }

        /* The last rung is the weeks left in the year, and late in December those
           run down into the stretches already on the list. A period ending on 27
           December leaves one week, which printed a second rung reading "the rest
           of the year (1 weeks)" directly under a "1 week" rung carrying the
           identical number: a grammar slip and a duplicated row in one place.
           Where the two stretches coincide the standing rung is marked as the
           rest of the year rather than repeated underneath it.

           The singular is still spelled out below. What keeps 1 away from that
           line is the contents of LADDER_RUNGS, a list somebody may reasonably
           edit, and grammar should not be resting on it. */
        var rungs = LADDER_RUNGS.slice();
        if (weeks.left > 0) {
            var coincides = rungs.some(function (rung) { return rung.weeks === weeks.left; });
            if (coincides) {
                rungs = rungs.map(function (rung) {
                    return rung.weeks === weeks.left
                        ? { label: rung.label, weeks: rung.weeks, tail: 'the rest of the year' }
                        : rung;
                });
            } else {
                rungs.push({
                    label: 'the rest of the year',
                    weeks: weeks.left,
                    tail: weeks.left + ' week' + (weeks.left === 1 ? '' : 's')
                });
            }
        }

        var th = 'padding: 5px 8px; border-bottom: 2px solid var(--border); font-size: 0.76em; ' +
            'color: var(--text-secondary); text-align: left; font-weight: 600;';
        var tdBase = 'padding: 5px 8px; border-bottom: 1px solid var(--border); font-size: 0.84em;';
        var tdRung = tdBase + ' padding-left: 26px; color: var(--text-secondary);';
        var numeric = ' text-align: right; white-space: nowrap;';
        var quiet = 'color: var(--text-tertiary);';

        var html = '<div id="rankLadderBlock" style="' + wrap + '">';
        html += '<h4 style="margin: 0 0 6px 0; color: var(--text-primary); font-size: 0.95em;">' +
            'What a stretch would do for ' + _escapeHtml(name) + '</h4>';

        html += '<p style="' + note + '">' +
            'Each rung holds one number for a stretch of weeks and blends it onto what is already banked ' +
            _escapeHtml(_selectedPeriodPhrase(_lastRankingData)) + ', weighted by volume the same way the ' +
            'year-to-date figures are built. That weighting is most of the story: the calls already behind ' +
            'the number keep their weight, so a month at a much better figure moves the year by far less than ' +
            'the two numbers averaged.</p>';

        html += '<p style="' + note + '">' +
            '<strong>The placings assume every other person in the centre finishes the year exactly where they ' +
            'stand today.</strong> Nobody does. The whole field is working the same weeks and a good many of ' +
            'them are pushing the same way, so these placings flatter, and that is why they live in this modal ' +
            'and go into nobody&rsquo;s inbox. Read them as the shape of what is possible, not as anything ' +
            'anyone can be held to. Where a rung moves the value by less than the metric&rsquo;s own noise ' +
            'threshold no placing is shown at all: in a field this dense a tenth of a point can be twenty ' +
            'places, and that is churn rather than progress.</p>';

        html += '<p style="' + note + '">' +
            'The number held is whichever figure is standing at #' + LADDER_DOOR_RANK + ' in the centre for that ' +
            'metric right now, because a colleague is producing it this period under the same conditions. ' +
            'Anyone already inside that door is held to the figure at the top of the field instead, since ' +
            'holding the #' + LADDER_DOOR_RANK + ' number would drag them backwards.</p>';

        html += '<p style="' + note + '">' +
            'Reliability is not on the ladder. It is hours missed against a budget for the whole year rather ' +
            'than an average, so there is no value to hold for a month and nothing to blend.</p>';

        html += '<table style="width: 100%; border-collapse: collapse; background: var(--bg-surface);">';
        html += '<thead><tr><th style="' + th + '">Metric</th>' +
            '<th style="' + th + numeric + '">Value</th>' +
            '<th style="' + th + ' padding-left: 16px;">Where that lands</th></tr></thead><tbody>';

        LADDER_ROWS.forEach(function (spec) {
            var rankKey = spec.rankKey;
            var registryKey = rp.registryKeyFor(rankKey);
            var label = '<td style="' + tdBase + '"><strong class="rank-ladder-metric">' +
                _escapeHtml(spec.label) + '</strong></td>';

            // Said before anything else, because the floors are the reason a
            // metric has no ladder and the reader is owed the reason rather
            // than a gap.
            if (!rp.isProjectable(rankKey, row)) {
                html += '<tr>' + label + '<td colspan="2" style="' + tdBase + ' padding-left: 16px; ' + quiet + '">' +
                    _ladderFloorReason(rp, rankKey, row) + '</td></tr>';
                return;
            }

            var current = rp.rankedValueFor(row, rankKey);
            if (current === null || current === undefined || isNaN(current)) {
                html += '<tr>' + label + '<td colspan="2" style="' + tdBase + ' padding-left: 16px; ' + quiet + '">' +
                    'not measured in this period.</td></tr>';
                return;
            }

            // Ranked over the people who have the metric at all. A blank is not
            // a bad score and must not pad the denominator into a bigger field
            // than the placing was taken from.
            var measured = rankings.filter(function (r) {
                var value = rp.rankedValueFor(r, rankKey);
                return value !== null && value !== undefined && !isNaN(value);
            }).length;
            var rank = (row.metricRanks || {})[rankKey];

            html += '<tr>' + label +
                '<td style="' + tdBase + numeric + '"><strong>' +
                _escapeHtml(_formatMetricDisplay(registryKey, current)) + '</strong></td>' +
                '<td style="' + tdBase + ' padding-left: 16px;">' +
                (Number.isFinite(rank) ? '#' + rank + ' of ' + measured : '<span style="' + quiet + '">not ranked</span>') +
                '</td></tr>';

            // Survey metrics are weighted by responses returned and everything
            // else by calls taken, matching how the year aggregate is built. A
            // hundred calls carrying two surveys is two responses of evidence.
            var isSurveyKey = !!(rp.SURVEY_WEIGHTED_RANK_KEYS && rp.SURVEY_WEIGHTED_RANK_KEYS.has(rankKey));
            var volumeSoFar = parseFloat(isSurveyKey ? row.surveyTotal : row.totalCalls);
            if (!Number.isFinite(volumeSoFar) || volumeSoFar <= 0) {
                html += '<tr><td colspan="3" style="' + tdRung + '">' +
                    'no ' + (isSurveyKey ? 'survey' : 'call') + ' volume on this upload, so there is nothing to ' +
                    'weight a blend against.</td></tr>';
                return;
            }

            var hold = _ladderHoldValue(rp, rankings, rankKey, current);
            if (!hold) {
                html += '<tr><td colspan="3" style="' + tdRung + '">' +
                    'already the best figure in the field, so there is nothing above it to hold to.</td></tr>';
                return;
            }

            var perWeek = volumeSoFar / weeks.covered;
            var holdText = _escapeHtml(_formatMetricDisplay(registryKey, hold.value));

            rungs.forEach(function (rung) {
                var projected = rp.projectValue(current, volumeSoFar, hold.value, perWeek * rung.weeks);
                if (projected === null) return;

                var where;
                if (rp.moveIsNoise(rankKey, projected - current)) {
                    where = '<span style="' + quiet + '">rank move is inside the noise</span>';
                } else {
                    var landed = rp.projectRank(rankings, rankKey, name, projected);
                    where = Number.isFinite(landed)
                        ? 'approx #' + landed
                        : '<span style="' + quiet + '">no placing to give</span>';
                }

                html += '<tr><td style="' + tdRung + '">hold ' + holdText + ' for ' + rung.label +
                    (rung.tail ? ' <span style="' + quiet + '">(' + rung.tail + ')</span>' : '') + '</td>' +
                    '<td style="' + tdRung + numeric + '">' +
                    _escapeHtml(_formatMetricDisplay(registryKey, projected)) + '</td>' +
                    '<td style="' + tdRung + ' padding-left: 16px;">' + where + '</td></tr>';
            });
        });

        html += '</tbody></table></div>';
        return html;
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

        var html = '<div style="display: flex; flex-direction: column; min-height: 0; height: 100%;">';
        html += '<p style="flex: 0 0 auto; margin: 0 0 10px 0; color: var(--text-secondary); font-size: 0.85em;">' +
            'Rank in each month, over the people scored in that month. The arrow into a month is measured ' +
            'against the month before, over the people scored in both. Which is why it is not always the ' +
            'difference of the two ranks either side of it. Best rank sits at the top. ' +
            'A month rebuilt from weekly uploads covers whole weeks, so its dates can start in the ' +
            'month before , the span under each heading is what it really covers. ' +
            'The purple line is where they stand year to date as of each month, which is what says ' +
            'whether the year is moving; a single month cannot. It reads the uploaded year-to-date file ' +
            'wherever one had closed by that month, so it agrees with the card; before that it is rebuilt ' +
            'from the months on file and says which month those start in.' +
            (reference ? ' The flat blue line is <strong>#' + reference.rank + ' ' + _escapeHtml(reference.label) +
                '</strong>, the figure on the card.' : '') + '</p>';

        var columns = _trajectoryColumns(series);
        var geom = _trajectoryGeometry(columns);

        var th = 'padding: 5px 6px; border-bottom: 2px solid var(--border); font-size: 0.78em; ' +
            'color: var(--text-secondary); text-align: center; white-space: nowrap;';
        var td = 'padding: 5px 6px; border-bottom: 1px solid var(--border); text-align: center; white-space: nowrap;';
        // The row labels stay put while the months slide past; without this,
        // scrolling to November leaves five unlabelled rows of numbers.
        var stick = 'position: sticky; left: 0; z-index: 1; background: var(--bg-surface);';

        html += '<div style="flex: 0 0 auto; margin: 0 0 8px 0; font-size: 0.8em; color: var(--text-secondary); ' +
            'display: flex; gap: 14px; flex-wrap: wrap; align-items: center;">' +
            '<span><span style="display:inline-block;width:16px;height:0;border-top:2px solid #1565c0;' +
            'vertical-align:middle;margin-right:5px;"></span>Rank that month</span>' +
            '<span><span style="display:inline-block;width:16px;height:0;border-top:2px dashed #8e6bbf;' +
            'vertical-align:middle;margin-right:5px;"></span>Year to date, as of that month</span>' +
            (reference ? '<span><span style="display:inline-block;width:16px;height:0;border-top:2px dashed #1565c0;' +
                'vertical-align:middle;margin-right:5px;"></span>' + _escapeHtml(reference.label) + ' (the card figure)</span>' : '') +
            '</div>';

        html += '<div style="flex: 1 1 auto; min-height: 0; overflow: auto;">' +
            '<div style="width: ' + geom.width + 'px;">';
        html += '<div style="background: var(--bg-surface-raised); border: 1px solid var(--border); ' +
            'border-radius: 8px; padding: 8px 0 2px 0; margin-bottom: 14px;">' +
            _trajectorySvg(columns, reference, geom) + '</div>';

        html += '<table style="width: ' + geom.width + 'px; border-collapse: collapse; ' +
            'table-layout: fixed; font-size: 0.85em;">';
        html += '<colgroup><col style="width: ' + geom.labelCol + 'px;" />' +
            columns.map(function () { return '<col style="width: ' + geom.colWidth + 'px;" />'; }).join('') +
            '</colgroup>';
        html += '<thead><tr><th style="' + th + stick + ' text-align: left;">Month</th>';
        columns.forEach(function (col) {
            var pt = col.point;
            // A rebuilt month runs from the start of the first week ENDING in it,
            // so "August" can begin in July. Someone holding this column up
            // against a calendar-month report needs to see that.
            var span = pt && pt.spanStart && pt.spanEnd
                ? _escapeHtml(pt.spanStart.slice(5) + ' to ' + pt.spanEnd.slice(5))
                : '';
            var offCalendar = pt && pt.spanStart && pt.spanStart.slice(0, 7) !== String(pt.key).slice(0, 7);
            html += '<th style="' + th + (pt ? '' : ' color: var(--text-tertiary);') + '"' +
                (span ? ' title="' + _escapeHtml(col.label) + ' covers ' + span + '"' : '') + '>' +
                _escapeHtml(_shortPeriodLabel(col.label)) +
                (col.inProgress ? ' <span style="color:#e65100;">(so far)</span>' : '') +
                (span ? '<div style="font-weight: 400; font-size: 0.86em; color: ' +
                    (offCalendar ? '#e65100' : 'var(--text-tertiary)') + ';">' + span + '</div>' : '') +
                '</th>';
        });
        html += '</tr></thead><tbody>';

        /* `cells` is built from the ranked months only; the empty ones are filled
           in here so every row walks the same twelve columns without each caller
           having to remember which months are missing. */
        function bodyRow(label, cellFor, strong) {
            var out = '<tr><td style="' + td + stick + ' text-align: left; color: var(--text-secondary);' +
                (strong ? ' font-weight: 700; color: var(--text-primary);' : '') + '">' + label + '</td>';
            columns.forEach(function (col) {
                out += '<td style="' + td + '">' +
                    (col.point ? cellFor(col.point) : '<span style="color: var(--text-tertiary);">&middot;</span>') +
                    '</td>';
            });
            return out + '</tr>';
        }

        // Said once, at the top, so the empty columns below are already explained.
        var missing = columns.filter(function (col) { return !col.point && col.reason; });
        if (missing.length) {
            html += '<tr><td colspan="' + (columns.length + 1) + '" style="' + stick +
                ' padding: 6px; font-size: 0.76em; color: #e65100; border-bottom: 1px solid var(--border);">' +
                'No ranking for ' + missing.map(function (col) {
                    return _escapeHtml(_shortPeriodLabel(col.label)) + ' (' + _escapeHtml(col.reason) + ')';
                }).join(', ') + '.</td></tr>';
        }

        html += bodyRow('Rank', function (pt) {
            return '<strong>#' + pt.rank + '</strong> <span style="color: var(--text-tertiary); font-size: 0.85em;">of ' +
                pt.total + '</span>';
        }, true);

        /* Two things can stand behind this row, and they are not the same number.

           Where a real year-to-date file had closed by that month, that file is
           what gets ranked — it is the source of truth and it is where the figure
           on the card comes from, so the two must agree. Everywhere else it is
           rebuilt from the months on file, and if those start in May then this is
           "since May" and saying "year" would be a lie. The cell says which. */
        html += bodyRow('Year to date', function (pt) {
            if (!Number.isFinite(pt.overallRank)) {
                return '<span style="color: var(--text-tertiary);">&middot;</span>';
            }
            var partial = pt.overallSource === 'rebuilt' && pt.overallCoversFrom &&
                String(pt.overallCoversFrom).slice(5) !== '01';
            var note = partial
                ? '<div style="font-size: 0.7em; color: #e65100;">from ' +
                  _escapeHtml(_shortPeriodLabel(_pcMonthLabel(pt.overallCoversFrom))) + ' only</div>'
                : '';
            return '<strong style="color: #8e6bbf;">#' + pt.overallRank + '</strong>' +
                '<span style="color: var(--text-tertiary); font-size: 0.85em;"> of ' + pt.overallTotal + '</span>' + note;
        }, true);

        // Movement of the YEAR figure, month to month. This is the number that
        // answers "are they climbing", which a single month's rank never does.
        var prevOverall = null;
        html += bodyRow('Year to date move', function (pt) {
            var prev = prevOverall;
            prevOverall = Number.isFinite(pt.overallRank) ? pt.overallRank : prevOverall;
            if (!Number.isFinite(pt.overallRank) || !Number.isFinite(prev)) {
                return '<span style="color: var(--text-tertiary);" title="Nothing before this to measure against">&middot;</span>';
            }
            var d = prev - pt.overallRank;
            if (d === 0) return '<span style="color: var(--text-tertiary);">-</span>';
            var up = d > 0;
            return '<span style="font-weight: 600; color: ' +
                (up ? (_isDark() ? '#66bb6a' : '#2e7d32') : (_isDark() ? '#ef5350' : '#c62828')) + ';">' +
                (up ? '&#9650;' : '&#9660;') + Math.abs(d) + '</span>' +
                '<div style="font-size: 0.72em; color: var(--text-tertiary);">#' + prev + '&rarr;' + pt.overallRank + '</div>';
        });

        html += bodyRow('Move', function (pt) {
            if (!Number.isFinite(pt.delta)) return '<span style="color: var(--text-tertiary);" title="Nothing before this to measure against">&middot;</span>';
            if (pt.delta === 0) return '<span style="color: var(--text-tertiary);">-</span>';
            return '<span style="color: ' + _deltaColor(pt) + '; font-weight: 600;">' +
                (pt.delta > 0 ? '&#9650;' : '&#9660;') + Math.abs(pt.delta) + '</span>' +
                '<div style="font-size: 0.72em; color: var(--text-tertiary);">#' + pt.sharedPrevRank +
                '&rarr;' + pt.sharedRank + '</div>';
        });

        html += bodyRow('KPIs met', function (pt) {
            return '<span style="font-weight: 600; color: ' + _kpiMetColor(pt.kpisMet, pt.measuredCount, _isDark()) + ';">' +
                pt.kpisMet + '/' + pt.measuredCount + '</span>';
        });

        html += bodyRow('Score', function (pt) {
            return pt.scoreSum + '/' + (pt.measuredCount * 3) +
                '<div style="font-size: 0.72em; color: var(--text-tertiary);">' + pt.kpiScore.toFixed(1) + '</div>';
        });

        html += bodyRow('Band', function (pt) {
            var c = pt.trackStatusValue === 'on-track-exceptional' ? '#2e7d32'
                : pt.trackStatusValue === 'on-track-successful' ? '#1565c0' : '#c62828';
            return '<span style="display: inline-block; padding: 1px 6px; border-radius: 8px; font-size: 0.72em; ' +
                'font-weight: bold; color: #fff; background: ' + c + ';">' + _escapeHtml(pt.trackLabel) + '</span>';
        });

        html += '<tr><td colspan="' + (columns.length + 1) + '" style="' + stick + ' padding: 10px 6px 4px 6px; ' +
            'font-size: 0.78em; color: var(--text-secondary); border-bottom: 2px solid var(--border);">' +
            'The five KPIs behind it , value, its 3/2/1 score, and where that ranked in the month.</td></tr>';

        TRAJECTORY_METRIC_ROWS.forEach(function (row) {
            html += bodyRow(row.label, function (pt) {
                var value = _trajectoryMetricValue(pt, row);
                var score = (pt.scores || {})[row.scoreKey];
                if (value === null || value === undefined || isNaN(value)) {
                    return '<span style="color: var(--text-tertiary);" title="Not measured in ' +
                        _escapeHtml(pt.label) + '">,</span>';
                }
                var mRank = (pt.metricRanks || {})[row.rankKey];
                return _scoreDot(score === undefined ? null : score) + _escapeHtml(_formatMetricDisplay(row.registry, value)) +
                    _substitutedSurveyNote(pt, row) +
                    (Number.isFinite(mRank) ? '<div style="font-size: 0.72em; color: var(--text-tertiary);">#' + mRank + '</div>' : '');
            });
        });

        html += '</tbody></table>';

        // Inside the scroller, so a tall picture scrolls with the table instead
        // of squeezing it out of the modal. Filled in by _openTrajectory once the
        // modal is in the document; a canvas cannot be built from an HTML string.
        html += '<div id="rankTrajectoryImageBlock" style="margin-top: 16px;">' +
            '<div style="font-size: 0.8em; color: var(--text-secondary); margin-bottom: 6px;">' +
            'This is the picture that goes in the email. Right-click it to copy if the button will not.</div>' +
            '<div id="rankTrajectoryImage" style="overflow: auto; border: 1px solid var(--border); ' +
            'border-radius: 8px; background: #fff; padding: 6px;"></div></div>';

        // The fixed-width strip closes first so the ladder gets the modal's own
        // width instead of the year table's. It stays inside the scroller, so a
        // long ladder scrolls with everything else rather than squeezing the
        // chart out of a flex column.
        html += '</div>';
        html += _buildLadderHtml(name);
        html += '</div>';

        if (geom.width > 620) {
            html += '<p style="flex: 0 0 auto; margin: 8px 0 0 0; color: var(--text-tertiary); font-size: 0.78em;">' +
                'Scroll sideways for the rest of the year.</p>';
        }
        return html + '</div>';
    }


    /* ── Month over month, as an email ──

       Written to the associate, not about them. Plain text, because a mailto
       body is plain text in every client — a table drawn in spaces survives the
       trip, and anything cleverer arrives as markup.

       Only the two most recent months that both have data, because "here is
       July against August" is a conversation and eight columns is a report
       nobody reads. */

    var COACHING_CC = 'Brandywine.Lockhart@aps.com';

    // first.last@aps.com. Matches the rule the red-flag and trend emails use, so
    // one person cannot end up addressed two different ways.
    function _apsEmailFor(name) {
        var parts = String(name || '').trim().split(/\s+/)
            .map(function (part) { return part.replace(/[^a-zA-Z0-9'-]/g, ''); })
            .filter(Boolean);
        if (!parts.length) return '';
        return parts.join('.').toLowerCase() + '@aps.com';
    }

    function _padEnd(text, width) {
        var out = String(text);
        while (out.length < width) out += ' ';
        return out;
    }
    function _padStart(text, width) {
        var out = String(text);
        while (out.length < width) out = ' ' + out;
        return out;
    }

    /**
     * The two most recent points that both carry data, oldest first, or null.
     * A trajectory with one month has no month-over-month story to tell.
     */
    function _lastTwoScored(series) {
        var scored = (series || []).filter(function (pt) { return pt && Number.isFinite(pt.rank); });
        if (scored.length < 2) return null;
        return [scored[scored.length - 2], scored[scored.length - 1]];
    }

    /* ── The message ──

       Short, and the picture carries the numbers.

       Two goes at putting the year in the body both failed for the same reason:
       a mailto body is plain text, and Outlook renders plain text as HTML with
       runs of spaces collapsed to one. A spaced table arrived as a wall of
       words; rewriting it as one line per month arrived as eight dense lines of
       prose. Neither is something you would send someone.

       So the body says only what a body is good at. Who it is to, what it is,
       and how the month went. And the grid goes in as the picture, which is the
       one form that keeps its shape wherever it lands. */

    function buildMonthOverMonthEmail(name) {
        var model = buildYearImageModel(name);
        if (!model) return null;
        var scored = model.columns.filter(function (c) { return c.present; });
        if (!scored.length) return null;

        var pair = _lastTwoScored(_timelineFor(name));
        var firstName = String(name || '').trim().split(/\s+/)[0] || name;

        var lines = [];
        lines.push('Hi ' + firstName + ',');
        lines.push('');
        lines.push('Here is how your numbers have landed each month this year, against target.');

        if (pair) {
            var prev = pair[0], cur = pair[1];
            var swing = cur.kpiScore - prev.kpiScore;
            lines.push('');
            if (Math.abs(swing) < 0.05) {
                lines.push(cur.label + ' holds you about where you were in ' + prev.label + '.');
            } else if (swing > 0) {
                lines.push(cur.label + ' is a better month than ' + prev.label + '. Nice work.');
            } else {
                lines.push(cur.label + ' is a step back from ' + prev.label + '.');
            }
        }

        lines.push('');
        lines.push('Happy to walk through any of it.');

        return {
            to: _apsEmailFor(name),
            cc: COACHING_CC,
            subject: 'Your ' + model.year + ' numbers, month by month',
            body: lines.join('\n'),
            monthCount: scored.length
        };
    }

    /* ── One month, as an email ──

       The year email's body cannot carry its numbers: eight months of table
       arrives in Outlook as a wall of words, which is why that one sends a
       picture. One month is five lines, and five one-per-metric lines survive
       plain text in every client. So this email needs no picture, no clipboard,
       and nothing to paste.

       Same rules as the year card, because the same person receives it:
       targets, not rating bands. No rank, no track label, no score digit.
       What they are given is the goal and where they landed against it. */

    function buildMonthlyStatsEmail(name) {
        var model = buildYearImageModel(name);
        if (!model) return null;
        var scored = model.columns.filter(function (c) { return c.present; });
        if (!scored.length) return null;

        // The most recent month with data. If it is still running it is
        // written as "so far": a part-month is never presented as a finished
        // one, same rule the celebrations copy follows.
        var col = scored[scored.length - 1];
        var withData = col.metrics.filter(function (m) { return m.display; });
        if (!withData.length) return null;

        var registry = window.METRICS_REGISTRY || {};
        var firstName = String(name || '').trim().split(/\s+/)[0] || name;

        var met = withData.filter(function (m) { return m.meets === true; }).length;
        var judged = withData.filter(function (m) { return m.meets !== null; }).length;

        var lines = [];
        lines.push('Hi ' + firstName + ',');
        lines.push('');
        lines.push(col.inProgress
            ? 'Here is where ' + col.fullLabel + ' stands so far against target:'
            : 'Here is how ' + col.fullLabel + ' landed against target:');
        lines.push('');

        withData.forEach(function (m) {
            // The registry's full names, not the grid's abbreviations. "CX Adv"
            // is a column heading; "Rep Satisfaction" is what the metric is
            // called everywhere the associate sees it.
            var full = (registry[m.registry] && registry[m.registry].label) || m.label;
            var phrase = _targetPhrase(m.registry, model.year);
            var line = '- ' + full + ': ' + m.display;
            if (phrase) line += ' (goal: ' + phrase + ')';
            if (m.meets === true) line += '. Met.';
            else if (m.meets === false) line += '. Not there yet.';
            lines.push(line);
        });

        lines.push('');
        if (judged) {
            lines.push('That is ' + met + ' of ' + judged + ' goals met' +
                (col.inProgress ? ' so far' : '') + '.');
            lines.push('');
        }
        lines.push('Happy to walk through any of it.');

        return {
            to: _apsEmailFor(name),
            cc: COACHING_CC,
            // The coverage label may or may not carry the year already; June
            // arrives as "June 2026" here. Appending blindly produced the
            // subject "Your June 2026 2026 numbers", which the baseline caught
            // before anybody's inbox did.
            subject: 'Your ' + col.fullLabel +
                (String(col.fullLabel).indexOf(String(model.year)) === -1 ? ' ' + model.year : '') +
                ' numbers',
            body: lines.join('\n'),
            monthLabel: col.fullLabel,
            inProgress: !!col.inProgress
        };
    }

    /* ── The year, as a picture ──

       A mail body is plain text, so the two-month table is all the text can
       carry. The year needs a picture, and a picture pastes into a draft.

       Drawn on a canvas rather than screenshotting the modal: the modal is
       themed from CSS variables that do not survive rasterising, it is sized for
       a browser rather than a mail window, and half of what is on it. The
       scroll box, the sticky column, the buttons. Is furniture nobody wants in
       an email. This draws light-on-white regardless of the app theme, because
       a mail client is not the app.

       The model is separated from the drawing so what goes IN the picture can be
       asserted; a canvas can only be eyeballed. */

    /* The published target for a metric, and whether a value clears it.

       Not the 3/2/1 rating bands. Those are an internal scoring device. The
       difference between a 2 and a 3 is a stretch mark nobody outside this tool
       is measured on, and putting the digit in front of an associate invites a
       conversation about a number they were never given. What they are given is
       the target: 426 seconds, 93% adherence. Meets it or does not. */
    function _targetFor(registryKey, year) {
        var mp = window.DevCoachModules && window.DevCoachModules.metricProfiles;
        if (!mp || !mp.getYearTarget) return null;
        try {
            return mp.getYearTarget(registryKey, year) || null;
        } catch (err) {
            return null;
        }
    }

    /* Judged on the number that is SHOWN, not the one behind it.

       Percentages display to one decimal, so 92.96 prints as "93.0%". And
       against a 93% target the raw value is below while the printed one is not.
       The card then says "93.0%" and "below" in the same cell, which is a
       contradiction the reader cannot resolve, because they do not have the
       second decimal to resolve it with. Reported as "why didn't Johnathan meet
       July adherence at a 93".

       The rounding lives in metric-profiles alongside the targets and the rating
       bands, so the badge on the rankings table and the pill on this card cannot
       come to different conclusions about the same number. */
    function _meetsTarget(registryKey, value, year) {
        var mp = window.DevCoachModules && window.DevCoachModules.metricProfiles;
        if (!mp || !mp.meetsYearTarget) return null;
        try {
            return mp.meetsYearTarget(registryKey, value, year);
        } catch (err) {
            return null;
        }
    }

    // What the target reads as in a sentence, for the key under the picture and
    // the footer of the email. "426 sec or lower", "93% or higher".
    function _targetPhrase(registryKey, year) {
        var target = _targetFor(registryKey, year);
        if (!target || !isFinite(target.value)) return '';
        return _formatMetricDisplay(registryKey, target.value) +
            (target.type === 'max' ? ' or lower' : ' or higher');
    }

    var IMG_MEETS_COLOR = '#2e7d32';
    var IMG_BELOW_COLOR = '#c62828';
    var IMG_FONT = '-apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';

    /* ── Placing inside one metric ──

       This card carries no overall placing, on purpose, and still does not. A
       composite rank is a management number and it is the one thing that turns
       a coaching picture into a league table.

       A placing inside a single metric is a different claim, and it is the one
       Scott asked for: "you are 6th on adherence" is a coaching fact somebody
       can act on, because it names the thing to work on. It is only honest
       while it is unmistakably per metric, so every one of these is drawn under
       its own metric and the footer says in plain words that it is not an
       overall placing. */

    function _metricIsReverse(registryKey) {
        if (typeof window.isReverseMetric === 'function') return !!window.isReverseMetric(registryKey);
        var entry = window.METRICS_REGISTRY && window.METRICS_REGISTRY[registryKey];
        return !!(entry && entry.isReverse);
    }

    function _ordinal(n) {
        var mod100 = n % 100;
        if (mod100 >= 11 && mod100 <= 13) return n + 'th';
        var mod10 = n % 10;
        return n + (mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th');
    }

    /**
     * Everybody placed on one metric, best first.
     *
     * Competition ranking, so a tie shares a placing rather than being split by
     * whatever order the names arrived in. Anyone the metric did not measure is
     * left out of the field entirely instead of being ranked last on a blank.
     */
    function _metricRankMap(holders, row) {
        var reverse = _metricIsReverse(row.registry);
        var scored = [];

        holders.forEach(function (h) {
            var value = _trajectoryMetricValue(h.holder, row);
            if (value === null || value === undefined || isNaN(value)) return;
            scored.push({ name: h.name, value: Number(value) });
        });

        scored.sort(function (a, b) { return reverse ? a.value - b.value : b.value - a.value; });

        var map = {};
        var lastValue = null;
        var lastRank = 0;
        scored.forEach(function (entry, index) {
            var rank = (lastValue !== null && entry.value === lastValue) ? lastRank : index + 1;
            lastValue = entry.value;
            lastRank = rank;
            map[entry.name] = { rank: rank, total: scored.length };
        });
        return map;
    }

    var _SURVEY_WEIGHTED_AVG = { cxRepOverall: true, fcr: true, overallExperience: true };

    /**
     * What the centre actually ran at, for one metric.
     *
     * Volume weighted, following computeTeamMetricValue, because a flat mean of
     * per person rates counts a twelve call week the same as a two hundred call
     * one. That is the mistake this app avoids everywhere else and it would be
     * no less wrong printed next to somebody name.
     *
     * Reliability is the exception and is a mean per person. It is hours missed,
     * so the centre total is a five figure number nobody can place themselves
     * against; what somebody wants to know is what a typical person missed.
     */
    function _centerAverageForMetric(holders, row) {
        var values = [];
        var wSum = 0;
        var wTotal = 0;

        holders.forEach(function (h) {
            var value = _trajectoryMetricValue(h.holder, row);
            if (value === null || value === undefined || isNaN(value)) return;
            values.push(Number(value));

            var weight;
            if (_SURVEY_WEIGHTED_AVG[row.registry]) {
                weight = Number(h.holder.surveyTotal) > 0 ? Number(h.holder.surveyTotal) : 0;
            } else {
                weight = Number(h.holder.totalCalls) > 0 ? Number(h.holder.totalCalls) : 1;
            }
            if (weight > 0) { wSum += Number(value) * weight; wTotal += weight; }
        });

        if (!values.length) return null;
        if (row.registry === 'reliability') {
            return values.reduce(function (a, b) { return a + b; }, 0) / values.length;
        }
        return wTotal > 0 ? wSum / wTotal : null;
    }

    /** Per metric placings for one period, keyed by metric label then name. */
    function _metricRanksFor(holders) {
        var out = {};
        TRAJECTORY_METRIC_ROWS.forEach(function (row) {
            out[row.label] = _metricRankMap(holders, row);
        });
        return out;
    }

    /** The most recent uploaded YTD for a year, which is the year's truth. */
    function _latestYtdKeyForYear(year) {
        var yData = _getYtdData();
        var best = null;
        var bestEnd = '';
        Object.keys(yData).forEach(function (key) {
            var meta = (yData[key] && yData[key].metadata) || {};
            var end = meta.endDate || (String(key).indexOf('|') > -1 ? String(key).split('|')[1] : '');
            if (!end || String(end).slice(0, 4) !== String(year)) return;
            if (String(end) > bestEnd) { bestEnd = String(end); best = key; }
        });
        return best;
    }

    /**
     * The year so far, as one column, with a placing inside each metric.
     *
     * Read off the uploaded YTD rather than averaged out of the months. A real
     * YTD upload is the year's own arithmetic and takes precedence over
     * anything rebuilt beside it, and averaging twelve monthly rates would be
     * wrong regardless of what it was compared against.
     */
    function _buildYtdColumn(name, year) {
        var key = _latestYtdKeyForYear(year);
        if (!key) return null;

        var data = buildRankingsForPeriod(key);
        if (!data || !data.rankings || !data.rankings.length) return null;

        var mine = null;
        var holders = data.rankings.map(function (r) {
            if (r.name === name) mine = r;
            return { name: r.name, holder: r };
        });
        if (!mine) return null;

        var ranks = _metricRanksFor(holders);

        var metrics = TRAJECTORY_METRIC_ROWS.map(function (row) {
            var value = _trajectoryMetricValue(mine, row);
            var has = !(value === null || value === undefined || isNaN(value));
            var placing = ranks[row.label] && ranks[row.label][name];
            return {
                label: row.label,
                registry: row.registry,
                meets: has ? _meetsTarget(row.registry, value, year) : null,
                display: has ? _formatMetricDisplay(row.registry, value) : '',
                rank: has && placing ? placing.rank : null,
                rankTotal: has && placing ? placing.total : null
            };
        });

        var centerMetrics = TRAJECTORY_METRIC_ROWS.map(function (row) {
            var avg = _centerAverageForMetric(holders, row);
            return {
                label: row.label,
                display: (avg === null || avg === undefined || isNaN(avg))
                    ? '' : _formatMetricDisplay(row.registry, avg)
            };
        });

        return {
            label: 'YTD',
            present: true,
            metrics: metrics,
            centerMetrics: centerMetrics,
            meetsCount: metrics.filter(function (m) { return m.meets === true; }).length,
            measuredAgainstTarget: metrics.filter(function (m) { return m.meets !== null; }).length
        };
    }

    function buildYearImageModel(name) {
        var series = _timelineFor(name);
        if (!series || !series.length) return null;
        var columns = _trajectoryColumns(series);
        if (!columns.length) return null;
        var tl = _timeline();
        var year = (tl && tl.year) || new Date().getFullYear();

        // January through whatever has data, which is what _trajectoryColumns
        // already covers. The empty months included, so a gap reads as a gap
        // rather than as a year that started in May.
        var first = columns[0], last = columns[columns.length - 1];

        // Everybody who has a point in a month, so the placing inside each
        // metric is worked out against the whole centre for that same month
        // rather than against whoever happens to be on screen.
        var holdersByPeriod = {};
        Object.keys((tl && tl.byName) || {}).forEach(function (who) {
            (tl.byName[who] || []).forEach(function (point) {
                if (!point || !point.key) return;
                (holdersByPeriod[point.key] = holdersByPeriod[point.key] || [])
                    .push({ name: who, holder: point });
            });
        });
        var ranksByPeriod = {};
        Object.keys(holdersByPeriod).forEach(function (key) {
            ranksByPeriod[key] = _metricRanksFor(holdersByPeriod[key]);
        });

        return {
            name: name,
            ytd: _buildYtdColumn(name, year),
            title: name,
            year: year,
            subtitle: _shortPeriodLabel(first.label) + ' to ' + _shortPeriodLabel(last.label) + ' ' +
                (String(last.key).slice(0, 4) || ''),
            targets: TRAJECTORY_METRIC_ROWS.map(function (row) {
                return { label: row.label, phrase: _targetPhrase(row.registry, year) };
            }).filter(function (tg) { return tg.phrase; }),
            columns: columns.map(function (col) {
                var pt = col.point;
                return {
                    key: col.key,
                    label: _shortPeriodLabel(col.label),
                    fullLabel: col.label,
                    present: !!pt,
                    inProgress: !!col.inProgress,
                    rank: pt ? pt.rank : null,
                    total: pt ? pt.total : null,
                    overallRank: pt ? pt.overallRank : null,
                    overallTotal: pt ? pt.overallTotal : null,
                    kpisMet: pt ? pt.kpisMet : null,
                    measuredCount: pt ? pt.measuredCount : null,
                    // Counted against the target, not the rating band, so it
                    // agrees with the words printed beside it.
                    meetsCount: pt ? TRAJECTORY_METRIC_ROWS.filter(function (row) {
                        return _meetsTarget(row.registry, _trajectoryMetricValue(pt, row), year) === true;
                    }).length : null,
                    measuredAgainstTarget: pt ? TRAJECTORY_METRIC_ROWS.filter(function (row) {
                        return _meetsTarget(row.registry, _trajectoryMetricValue(pt, row), year) !== null;
                    }).length : null,
                    kpiScore: pt ? pt.kpiScore : null,
                    trackLabel: pt ? pt.trackLabel : null,
                    metrics: TRAJECTORY_METRIC_ROWS.map(function (row) {
                        var value = pt ? _trajectoryMetricValue(pt, row) : null;
                        var has = !(value === null || value === undefined || isNaN(value));
                        var placing = has && ranksByPeriod[col.key]
                            && ranksByPeriod[col.key][row.label]
                            && ranksByPeriod[col.key][row.label][name];
                        return {
                            label: row.label,
                            registry: row.registry,
                            meets: has ? _meetsTarget(row.registry, value, year) : null,
                            display: has ? _formatMetricDisplay(row.registry, value) : '',
                            rank: placing ? placing.rank : null,
                            rankTotal: placing ? placing.total : null
                        };
                    })
                };
            })
        };
    }

    /* Rank appears nowhere on this card.

       It is a management number, and this picture is sent to the associate. The
       chart used to plot it, so taking the row out and leaving the chart would
       have moved the placement rather than removed it. The whole thing is
       redrawn around targets met instead, which answers "is the year moving"
       without measuring anyone against anybody else. The modal keeps the rank
       view; that one is not going anywhere near an inbox. */
    function _drawYearCard(model) {
        var canvas = document.createElement('canvas');
        if (!canvas || typeof canvas.getContext !== 'function') return null;
        var ctx = canvas.getContext('2d');
        if (!ctx) return null;

        var n = model.columns.length;
        var padX = 34, labelW = 116, colW = 96;
        // The year so far sits in its own wider column in front of January, so
        // the first thing read is where the year actually stands.
        var ytd = model.ytd || null;
        var ytdW = ytd ? 104 : 0;
        // The centre beside the person, so above or below it is read rather
        // than worked out.
        var hasAvg = !!(ytd && ytd.centerMetrics);
        var avgW = hasAvg ? 96 : 0;
        var headerH = 96, chartH = 210, gap = 26, headRowH = 30;
        // Taller rows than before: every cell now carries a placing under its
        // verdict, and 44px had no room left under the pill.
        var rowH = 46;
        var rows = TRAJECTORY_METRIC_ROWS.length + 1;   // targets-met row + one per metric
        var W = padX * 2 + labelW + ytdW + avgW + colW * n;
        var H = headerH + chartH + gap + headRowH + rowH * rows + 84;

        // Drawn at 2x and scaled down, so it is not a blurry paste on a normal
        // display and still sharp on a high-DPI one.
        var SCALE = 2;
        canvas.width = W * SCALE;
        canvas.height = H * SCALE;
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        ctx.scale(SCALE, SCALE);

        var text = function (str, x, y, size, color, weight, align) {
            ctx.font = (weight || '400') + ' ' + size + 'px ' + IMG_FONT;
            ctx.fillStyle = color;
            ctx.textAlign = align || 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(String(str), x, y);
        };

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);

        ctx.fillStyle = '#0f2a4a';
        ctx.fillRect(0, 0, W, headerH);
        text(model.title, padX, 38, 26, '#ffffff', '700');
        text(model.subtitle, padX, 68, 14, '#9fc0e4');
        text('Targets met, month by month', W - padX, 38, 14, '#9fc0e4', '400', 'right');

        // ── Chart: how many targets were met each month ──
        var chartTop = headerH + 24;
        var chartBottom = headerH + chartH - 30;
        var most = model.columns.reduce(function (m, c) {
            return Math.max(m, c.measuredAgainstTarget || 0);
        }, 1);
        var x = function (i) { return padX + labelW + ytdW + avgW + colW * (i + 0.5); };
        var y = function (v) { return chartBottom - (v / most) * (chartBottom - chartTop); };

        // Up is better, which is the way the word reads.
        [0, Math.round(most / 2), most].forEach(function (v) {
            var yy = y(v);
            ctx.strokeStyle = '#e6ecf3';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(padX + labelW - 8, yy);
            ctx.lineTo(W - padX, yy);
            ctx.stroke();
            text(v, padX + labelW - 14, yy, 11, '#9aa7b4', '400', 'right');
        });
        text('All ' + most, padX + labelW - 14, chartTop - 15, 11, '#2e7d32', '700', 'right');

        // One run per unbroken stretch, so a month with no upload shows as a gap
        // rather than a line drawn through it.
        ctx.strokeStyle = '#1565c0';
        ctx.lineWidth = 3;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        var drawing = false;
        ctx.beginPath();
        model.columns.forEach(function (c, i) {
            if (!c.present || !Number.isFinite(c.meetsCount)) { drawing = false; return; }
            if (!drawing) { ctx.moveTo(x(i), y(c.meetsCount)); drawing = true; }
            else ctx.lineTo(x(i), y(c.meetsCount));
        });
        ctx.stroke();

        model.columns.forEach(function (c, i) {
            if (!c.present || !Number.isFinite(c.meetsCount)) {
                text('no data', x(i), (chartTop + chartBottom) / 2, 11, '#c3ccd6', '400', 'center');
                return;
            }
            var all = c.measuredAgainstTarget > 0 && c.meetsCount === c.measuredAgainstTarget;
            ctx.beginPath();
            ctx.arc(x(i), y(c.meetsCount), 6, 0, Math.PI * 2);
            ctx.fillStyle = all ? IMG_MEETS_COLOR : '#1565c0';
            ctx.fill();
            text(c.meetsCount + ' of ' + c.measuredAgainstTarget, x(i), y(c.meetsCount) - 17,
                12, '#0f2a4a', '700', 'center');
        });

        // ── Grid ──
        var gridTop = headerH + chartH + gap;
        var gridBottom = gridTop + headRowH + rowH * rows;
        var ytdCx = padX + labelW + ytdW / 2;
        var avgCx = padX + labelW + ytdW + avgW / 2;

        // A placing, drawn small and grey under the verdict it belongs to.
        // The verdict is the cell colour now. A pill inside a shaded cell was
        // saying the same thing twice and spending the row height to do it.
        var MEETS_BG = "#e4f3e8", MEETS_INK = "#1a6b32";
        var BELOW_BG = "#fbe6e4", BELOW_INK = "#a52f26";

        var shade = function (m, left, width, ry) {
            if (!m || m.meets === null) return;
            ctx.fillStyle = m.meets ? MEETS_BG : BELOW_BG;
            // Inset by a pixel so the row rule above stays visible.
            ctx.fillRect(left, ry - rowH / 2 + 1, width, rowH - 1);
        };

        // Just the placing. The field size lives in the footer once, because it
        // is not the same number in every cell and repeating it forty times was
        // the noisiest thing on the card.
        var placing = function (m, cx, ry) {
            if (!m || !m.rank) return;
            text(_ordinal(m.rank), cx, ry + 13, 10, "#7d8d9d", "600", "center");
        };

        if (ytd) {
            ctx.fillStyle = "#eef4fb";
            ctx.fillRect(padX + labelW, gridTop, ytdW, gridBottom - gridTop);
            text("YTD", ytdCx, gridTop + headRowH / 2, 13, "#0f2a4a", "700", "center");
        }
        if (hasAvg) {
            ctx.fillStyle = "#f4f6f9";
            ctx.fillRect(padX + labelW + ytdW, gridTop, avgW, gridBottom - gridTop);
            text("Center avg", avgCx, gridTop + headRowH / 2, 12, "#5b6b7c", "700", "center");
        }
        model.columns.forEach(function (c, i) {
            var cx = x(i);
            if (i % 2 === 1) {
                ctx.fillStyle = '#f7f9fc';
                ctx.fillRect(cx - colW / 2, gridTop, colW, gridBottom - gridTop);
            }
            text(c.label + (c.inProgress ? '*' : ''), cx, gridTop + headRowH / 2, 13,
                c.inProgress ? '#b45309' : '#0f2a4a', '700', 'center');
        });

        var rowLabels = ['Targets met'].concat(TRAJECTORY_METRIC_ROWS.map(function (r) { return r.label; }));
        rowLabels.forEach(function (label, r) {
            var ry = gridTop + headRowH + rowH * r + rowH / 2;
            ctx.strokeStyle = '#eef2f7';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(padX, ry - rowH / 2);
            ctx.lineTo(W - padX, ry - rowH / 2);
            ctx.stroke();
            text(label, padX + 6, ry, 12, '#5b6b7c', r === 0 ? '700' : '400');

            if (hasAvg) {
                if (r === 0) {
                    text('', avgCx, ry, 12, '#5b6b7c', '400', 'center');
                } else {
                    var cm = ytd.centerMetrics[r - 1];
                    text(cm && cm.display ? cm.display : '.', avgCx, ry,
                        12.5, cm && cm.display ? '#5b6b7c' : '#c3ccd6', '600', 'center');
                }
            }

            if (ytd) {
                if (r === 0) {
                    text(ytd.meetsCount + ' of ' + ytd.measuredAgainstTarget, ytdCx, ry, 13, '#0f2a4a', '700', 'center');
                } else {
                    var ym = ytd.metrics[r - 1];
                    if (!ym || !ym.display) {
                        text('.', ytdCx, ry, 12, '#c3ccd6', '400', 'center');
                    } else if (ym.meets !== null) {
                        shade(ym, padX + labelW, ytdW, ry);
                        text(ym.display, ytdCx, ry - 7, 13.5, ym.meets ? MEETS_INK : BELOW_INK, '700', 'center');
                        placing(ym, ytdCx, ry);
                    } else {
                        text(ym.display, ytdCx, ry - 7, 13.5, '#0f2a4a', '700', 'center');
                        placing(ym, ytdCx, ry);
                    }
                }
            }

            model.columns.forEach(function (c, i) {
                var cx = x(i);
                if (!c.present) { text('.', cx, ry, 12, '#c3ccd6', '400', 'center'); return; }
                if (r === 0) {
                    text(c.meetsCount + ' of ' + c.measuredAgainstTarget, cx, ry, 13, '#0f2a4a', '700', 'center');
                    return;
                }
                var m = c.metrics[r - 1];
                if (!m || !m.display) { text('.', cx, ry, 12, '#c3ccd6', '400', 'center'); return; }

                // A filled pill in the verdict's colour, with the word in it. The
                // value sits above, because the value is what backs the verdict up
                // and the verdict is the point.
                if (m.meets !== null) {
                    shade(m, cx - colW / 2, colW, ry);
                    text(m.display, cx, ry - 7, 12.5, m.meets ? MEETS_INK : BELOW_INK, '700', 'center');
                    placing(m, cx, ry);
                } else {
                    text(m.display, cx, ry - 7, 12.5, '#26364a', '400', 'center');
                    placing(m, cx, ry);
                }
            });
        });

        var lastRow = gridTop + headRowH + rowH * rows;
        ctx.strokeStyle = '#eef2f7';
        ctx.beginPath();
        ctx.moveTo(padX, lastRow);
        ctx.lineTo(W - padX, lastRow);
        ctx.stroke();

        // The key names the targets, so "meets" is a claim the reader can check
        // rather than a colour they have to take on trust.
        var key = (model.targets || []).map(function (tg) { return tg.label + ' ' + tg.phrase; }).join('   ');
        text('Target:  ' + key, padX + 6, lastRow + 16, 11, '#7a8794');
        text('* month still in progress', padX + 6, lastRow + 32, 11, '#9aa7b4');
        // Said in full, because a placing with no scope on it is read as an
        // overall one, and that is not what any of these are.
        text('Green meets the target, red is below it.', padX + 6, lastRow + 48, 11, '#7a8794');
        text('Placings are within that one metric, against everyone measured in that column. '
            + 'They are not an overall ranking.', padX + 6, lastRow + 64, 11, '#7a8794');

        return canvas;
    }

    function _canvasBlob(canvas) {
        return new Promise(function (resolve, reject) {
            if (!canvas || typeof canvas.toBlob !== 'function') { reject(new Error('no canvas')); return; }
            canvas.toBlob(function (blob) {
                if (blob) resolve(blob); else reject(new Error('no blob'));
            }, 'image/png');
        });
    }

    function _downloadCanvas(canvas, name) {
        return _canvasBlob(canvas).then(function (blob) {
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = String(name).replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '-year.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
            return 'downloaded';
        });
    }

    /* Copy the picture, and say plainly when it could not be copied.

       The ClipboardItem is built with the blob PROMISE rather than the blob, so
       it is constructed inside the click and keeps the user activation the
       clipboard demands; waiting for toBlob first loses it and the write is
       refused. Where the clipboard will not take an image at all. Firefox and
       Safari still refuse. The file downloads, and if even that fails the
       picture is still on screen to be copied by hand. */
    function _copyYearImage(canvas, name) {
        if (!canvas) return Promise.resolve(false);
        if (!(window.ClipboardItem && navigator.clipboard && navigator.clipboard.write)) {
            return _downloadCanvas(canvas, name).catch(function () { return false; });
        }
        var item;
        try {
            item = new window.ClipboardItem({ 'image/png': _canvasBlob(canvas) });
        } catch (err) {
            return _downloadCanvas(canvas, name).catch(function () { return false; });
        }
        return navigator.clipboard.write([item])
            .then(function () { return 'copied'; })
            .catch(function () {
                return _downloadCanvas(canvas, name).catch(function () { return false; });
            });
    }

    function _reportImageResult(result) {
        var say = function (msg) {
            if (typeof window.showToast === 'function') window.showToast(msg, 4000);
            else console.info('[center-ranking] ' + msg);
        };
        if (result === 'copied') say('Chart copied - paste it into the draft');
        else if (result === 'downloaded') say('Year chart saved to your downloads - attach it to the draft');
        else say('Could not copy automatically - right-click the picture below and copy it');
    }

    /* Opens the draft addressed and subject-filled, and puts the year picture on
       the clipboard.

       The text goes in the mail body, where it needs no pasting. The clipboard
       is spent on the picture instead, since that is the thing a mailto cannot
       carry at all. */
    function _emailMonthOverMonth(name) {
        var mail = buildMonthOverMonthEmail(name);
        if (!mail) {
            alert('Two months of data are needed before there is a month-over-month story to send.');
            return;
        }
        var href = 'mailto:' + encodeURIComponent(mail.to) +
            '?cc=' + encodeURIComponent(mail.cc) +
            '&subject=' + encodeURIComponent(mail.subject) +
            '&body=' + encodeURIComponent(mail.body);

        /* The picture is copied first, while the click still counts as user
           activation. Opening the draft first moves focus to the mail client
           and the clipboard refuses a write from a document that is not
           focused. */
        _copyYearImage(_lastTrajectoryCanvas, name).then(function (result) {
            _reportImageResult(result);
            var link = document.createElement('a');
            link.href = href;
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        });
    }

    /* Opens the monthly draft. Nothing to copy first: one month's numbers fit
       in the body, so unlike the year email there is no picture and no
       clipboard step for the user to lose. */
    function _emailMonthlySummary(name) {
        var mail = buildMonthlyStatsEmail(name);
        if (!mail) {
            alert('No month with data to summarize yet.');
            return;
        }
        var href = 'mailto:' + encodeURIComponent(mail.to) +
            '?cc=' + encodeURIComponent(mail.cc) +
            '&subject=' + encodeURIComponent(mail.subject) +
            '&body=' + encodeURIComponent(mail.body);
        var link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    // The canvas currently on screen, so the buttons copy the picture the viewer
    // is looking at rather than quietly drawing a second one.
    var _lastTrajectoryCanvas = null;

    function _openTrajectory(name) {
        // Built up front so the button can carry the month's name, and so a
        // roster with no month of data simply has no button rather than a
        // button that apologises when clicked.
        var monthlyMail = null;
        try { monthlyMail = buildMonthlyStatsEmail(name); } catch (err) { monthlyMail = null; }

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.display = 'flex';

        var content = document.createElement('div');
        content.className = 'modal-content';
        content.style.maxWidth = '1040px';
        content.style.overflow = 'hidden';
        content.style.display = 'flex';
        content.style.flexDirection = 'column';
        content.innerHTML =
            '<div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">' +
                '<h3 style="margin: 0; color: var(--text-primary);">' + _escapeHtml(name) + '</h3>' +
                '<button id="rankTrajectoryClose" style="background: none; border: none; font-size: 1.5em; ' +
                'cursor: pointer; color: var(--text-secondary); padding: 0 4px;">&times;</button>' +
            '</div>' +
            // min-height:0 or a flex child refuses to shrink and scrolls the page
            // instead. Scrolling belongs to the box around the table, one level in,
            // so its bars sit on its own edges rather than at the end of the content.
            '<div style="flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden;">' +
            buildTrajectoryHtml(name) + '</div>' +
            '<div style="margin-top: 14px; display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">' +
                '<button id="rankTrajectoryEmail" style="padding: 8px 16px; background: #2e7d32; color: white; ' +
                'border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.9em;">' +
                'Email month over month summary</button>' +
                (monthlyMail
                    ? '<button id="rankTrajectoryMonthEmail" style="padding: 8px 16px; background: #00695c; color: white; ' +
                      'border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.9em;">' +
                      'Email ' + _escapeHtml(monthlyMail.monthLabel) + ' summary</button>'
                    : '') +
                '<button id="rankTrajectoryCopyImage" style="padding: 8px 16px; background: #5b3f8c; color: white; ' +
                'border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.9em;">Copy picture</button>' +
                '<button id="rankTrajectorySaveImage" style="padding: 8px 16px; background: var(--bg-surface-raised); ' +
                'color: var(--text-primary); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; ' +
                'font-size: 0.9em;">Save picture</button>' +
                '<button id="rankTrajectoryFind" style="padding: 8px 16px; background: #1565c0; color: white; ' +
                'border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 0.9em;">Find in table</button>' +
                '<span style="color: var(--text-tertiary); font-size: 0.78em;">Goes to ' +
                _escapeHtml(_apsEmailFor(name)) + '. The picture is copied , paste it into the draft.</span>' +
            '</div>';

        overlay.appendChild(content);
        document.body.appendChild(overlay);

        _lastTrajectoryCanvas = null;
        var holder = document.getElementById('rankTrajectoryImage');
        if (holder) {
            try {
                var model = buildYearImageModel(name);
                var card = model && _drawYearCard(model);
                if (card) {
                    card.style.maxWidth = '100%';
                    card.style.height = 'auto';
                    card.style.display = 'block';
                    holder.appendChild(card);
                    _lastTrajectoryCanvas = card;
                } else {
                    holder.parentNode.style.display = 'none';
                }
            } catch (err) {
                console.warn('[center-ranking] Year picture unavailable:', err && err.message);
                if (holder.parentNode) holder.parentNode.style.display = 'none';
            }
        }

        var close = function () { overlay.remove(); };
        document.getElementById('rankTrajectoryClose').addEventListener('click', close);
        overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });
        document.getElementById('rankTrajectoryFind').addEventListener('click', function () {
            close();
            _scrollToRow(name);
        });
        var emailBtn = document.getElementById('rankTrajectoryEmail');
        if (emailBtn) emailBtn.addEventListener('click', function () { _emailMonthOverMonth(name); });

        var monthEmailBtn = document.getElementById('rankTrajectoryMonthEmail');
        if (monthEmailBtn) monthEmailBtn.addEventListener('click', function () { _emailMonthlySummary(name); });

        var copyImgBtn = document.getElementById('rankTrajectoryCopyImage');
        if (copyImgBtn) copyImgBtn.addEventListener('click', function () {
            _copyYearImage(_lastTrajectoryCanvas, name).then(_reportImageResult);
        });
        var saveImgBtn = document.getElementById('rankTrajectorySaveImage');
        if (saveImgBtn) saveImgBtn.addEventListener('click', function () {
            _downloadCanvas(_lastTrajectoryCanvas, name).then(_reportImageResult, function () {
                _reportImageResult(false);
            });
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

        // Recomputed per render, not per sort. An upload between renders must
        // not leave stale movement on screen.
        _momCache = undefined;
        var _pcMod2 = window.DevCoachModules && window.DevCoachModules.periodCompare;
        if (_pcMod2 && _pcMod2.resetTimelineCache) _pcMod2.resetTimelineCache();

        // Drop the remembered key if it no longer resolves (period was deleted,
        // replaced by cleanup, or hydrated from a different source mid-session).
        //
        // A 'month:' key is assembled on demand and is deliberately absent from
        // both stores, so it must not be tested by lookup. Doing so threw away
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
        // initialized once a YTD is actually found. Otherwise a later render
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
            _bindRankingPeriodChips();
            return;
        }

        var html = '';

        // Period selector
        html += _renderRankingPeriodSelector(currentSelectValue);

        // Header
        html += '<div style="margin-bottom: 20px; padding: 15px; background: ' + (_isDark() ? '#12243a' : '#e3f2fd') +
            '; border-radius: 8px; border-left: 4px solid #1565c0;">';
        html += '<strong>Center Rankings</strong> , ' + data.totalEmployees + ' employees scored';
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
                ', ranked across the ' + _mom.total + ' scored in both';
            if (_mom.onlyCurrent.length || _mom.onlyPrevious.length) {
                html += ' (' + _mom.onlyCurrent.length + ' new, ' + _mom.onlyPrevious.length + ' not in the later one)';
            }
            html += '.';
            // Two rank scales sit on this page. The table's, over everyone in the
            // selected period, and movement's, over the people in both, across a
            // different window. Left unsaid, the difference reads as the numbers
            // disagreeing. Stated unconditionally: the windows differ even when the
            // head counts happen to match, and that is the half readers get wrong.
            html += ' Rank in the table is <strong>' + _escapeHtml(_selectedPeriodPhrase(data)) +
                '</strong>, out of ' + data.totalEmployees +
                ', a different window from the movement column, not just a different count.';
            if (_mom.fellBack) {
                html += ' <span style="color: #e65100;">Only one ' + (SCOPE_NOUN[_mom.requestedScope] || _mom.requestedScope) +
                    ' is available, so there is nothing to compare it against , showing months instead.</span>';
            }
            // A comparison that stops short of today explains itself, rather than
            // looking like uploads went missing.
            if (_mom.skippedInProgress) {
                html += ' <span style="color: #e65100;">' + _escapeHtml(_mom.skippedInProgress.label) +
                    ' is still in progress' +
                    (_mom.skippedInProgress.weekCount ? ' (' + _mom.skippedInProgress.weekCount + ' weeks so far)' : '') +
                    ', so it is set aside , half a month against a full one moves people on sample size, not performance.</span>';
            } else if (_mom.comparingInProgress) {
                html += ' <span style="color: #e65100;">' + _escapeHtml(_mom.current.label) +
                    ' is not finished yet, so it is being compared against a full month , expect movement that is partly sample size.</span>';
            }
            html += '</span>';

            // Without this, a June-to-July comparison shown in September just looks
            // stale, when in fact August was skipped for covering a fraction of the centre.
            if (_mom.skippedPartial && _mom.skippedPartial.length) {
                html += '<br><span style="color: #e65100; font-size: 0.85em;">Skipped ' +
                    _mom.skippedPartial.map(function (s) {
                        return _escapeHtml(s.label) + ', only ' + s.count + ' associates uploaded';
                    }).join(', ') +
                    '. Upload the full ' + (SCOPE_NOUN[_mom.scope] || 'period') + ' to compare against it.</span>';
            }
        }
        html += '</div>';

        // Team summary
        var teamRanks = data.rankings.filter(function (r) { return data.teamMembers.has(r.name); });
        var _teamMovement = _movementByName();
        var _teamPeriodPhrase = _selectedPeriodPhrase(data);
        var _teamPeriodName = _selectedPeriodName(data) || 'this period';
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
                    'Different window, different field , the two sets of ranks are not on the same scale ' +
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

                html += '<div class="ranking-card" data-employee="' + _escapeHtml(r.name) + '" style="padding: 12px 16px; background: ' + statusBg + '; border-radius: 8px; border-left: 4px solid ' + statusColor + '; cursor: pointer;">';
                html += '<div class="ranking-card-name" style="font-weight: bold; font-size: 1.05em; text-decoration: underline;">' + _escapeHtml(r.name) + '</div>';
                html += '<div style="margin-top: 4px; display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap;">';
                html += '<span style="font-size: 1.3em; font-weight: bold; color: ' + statusColor + ';">#' + r.rank + '</span>';
                // The window, hard against the number it belongs to, before
                // anything else gets a chance to be read instead.
                html += '<span style="display: inline-block; padding: 1px 6px; border-radius: 4px; ' +
                    'background: #1565c0; color: #fff; font-size: 0.62em; font-weight: 700; ' +
                    'letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap;">' +
                    _escapeHtml(_teamPeriodName) + '</span>';
                html += '<span style="color: var(--text-secondary); font-size: 0.85em;">of ' + data.totalEmployees +
                    ', better than ' + aheadOf + '%</span>';
                html += '</div>';

                // Spelled out on the team cards rather than left as an arrow. 
                // this is the line you would actually read before a one-on-one.
                var _cardMv = _teamMovement && _teamMovement[r.name];
                if (_cardMv && Number.isFinite(_cardMv.delta) && _teamMovementLabels) {
                    var _was = _escapeHtml(_teamMovementLabels.previous);
                    var _now = _escapeHtml(_teamMovementLabels.current);
                    if (_cardMv.delta === 0) {
                        html += '<div style="margin-top: 4px; font-size: 0.85em; color: var(--text-secondary);">Held at #' +
                            _cardMv.curRank + ', same in ' + _was + ' and ' + _now + '</div>';
                    } else if (!_cardMv.scoreChanged) {
                        // Said plainly, because this is the line that would otherwise
                        // get read out as praise for a move nobody earned.
                        html += '<div style="margin-top: 4px; font-size: 0.85em; color: var(--text-secondary);">' +
                            'Moved ' + (_cardMv.delta > 0 ? 'up ' : 'down ') + Math.abs(_cardMv.delta) +
                            ', #' + _cardMv.prevRank + ' in ' + _was + ', #' + _cardMv.curRank + ' in ' + _now +
                            ', on the same score (' + _cardMv.curKpisMet + '/' +
                            (_cardMv.curMeasuredCount || FULL_KPI_COUNT) + ' KPIs, ' +
                            _cardMv.curScoreSum + ' in both)</div>';
                    } else {
                        var _up = _cardMv.delta > 0;
                        html += '<div style="margin-top: 4px; font-size: 0.85em; font-weight: 600; color: ' +
                            (_up ? (_isDark() ? '#66bb6a' : '#2e7d32') : (_isDark() ? '#ef5350' : '#c62828')) + ';">' +
                            (_up ? '&#9650; Up ' : '&#9660; Down ') + Math.abs(_cardMv.delta) +
                            ', #' + _cardMv.prevRank + ' in ' + _was + ', #' + _cardMv.curRank + ' in ' + _now +
                            '<span style="font-weight: 400; color: var(--text-secondary);"> (KPIs met ' +
                            _cardMv.prevKpisMet + '&rarr;' + _cardMv.curKpisMet + ', score ' +
                            _cardMv.prevScoreSum + '&rarr;' + _cardMv.curScoreSum + ')</span></div>';
                    }
                }
                // The whole year under the one-step move, so "down 39" is read
                // against where they have actually been rather than in isolation.
                html += _renderTimelineStrip(_timelineFor(r.name));

                var kpiColor = _kpiMetColor(r.kpisMet, r.measuredCount, _isDark());
                html += '<div style="margin-top: 4px; font-size: 0.85em; color: var(--text-secondary);">' + _escapeHtml(r.trackLabel) + ', Score: ' + r.scoreSum + '/' + (r.measuredCount * 3) + ' (KPI: ' + r.kpiScore.toFixed(1) + ')</div>';
                // Denominator is what was actually measured. Printing "4/5 KPIs met"
                // beside "Score: 12/12" said the same record two incompatible ways.
                html += '<div style="margin-top: 2px; font-size: 0.85em;"><span style="font-weight: 700; color: ' + kpiColor + ';">' +
                    r.kpisMet + '/' + r.measuredCount + ' KPIs met</span>' +
                    (r.measuredCount < FULL_KPI_COUNT
                        ? '<span style="color: var(--text-tertiary); font-weight: 400;"> , ' +
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
            'The <strong>Rank</strong> column is ' + _escapeHtml(_selectedPeriodPhrase(data)) +
            '. Click any name for that person’s month-by-month history. Each metric shows value and rank (#).' +
            (_mom ? ' <strong>' + (MOVEMENT_COLUMN_LABEL[_mom.scope] || 'Move') + '</strong> is a separate ' +
                _escapeHtml(_mom.previous.label) + ' &rarr; ' + _escapeHtml(_mom.current.label) +
                ' comparison, re-ranked over the ' + _mom.total + ' people scored in both , the two ranks under the arrow are on that scale, ' +
                'not on the Rank column\'s, so the two do not subtract.' +
                ' A greyed value marked * moved with no change in KPIs met or score , position shifted among tied people, not performance.' : '') +
            '</p>';
        html += '</div>';

        container.innerHTML = html;
        renderRankingTable('rank', 'asc');

        // Bind period selector
        var sel = document.getElementById('rankingPeriodSelect');
        if (sel) sel.addEventListener('change', _onRankingPeriodChange);
        _bindRankingPeriodChips();

        // A name opens that person's year. Scrolling to their row. What this
        // used to do. Is a button inside it, because the row says no more than
        // the card already did.
        container.querySelectorAll('.ranking-card').forEach(function (el) {
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
            html += '<td class="ranking-name-cell" data-employee="' + _escapeHtml(r.name) +
                '" title="Open ' + _escapeHtml(r.name) + '’s year" ' +
                'style="padding: 4px 3px; white-space: nowrap; cursor: pointer;">';
            if (isTeam) {
                html += '<span style="color: #1565c0;">&#9733; </span>';
            } else if (supColor) {
                var _dotColor = _getSupervisorDotColor(r.name);
                html += '<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:' + _dotColor + ';box-shadow:0 0 0 1px rgba(0,0,0,0.25);margin-right:5px;vertical-align:middle;"></span>';
            }
            html += '<span style="text-decoration: underline; text-decoration-style: dotted; text-underline-offset: 2px;">' +
                _escapeHtml(r.name) + '</span></td>';

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

        // Any name in the centre opens that person's year.
        wrapper.querySelectorAll('.ranking-name-cell').forEach(function (cell) {
            cell.addEventListener('click', function () {
                var name = cell.dataset ? cell.dataset.employee : null;
                if (name) _openTrajectory(name);
            });
        });

        // Bind sort headers. Re-bound on every render, since sorting rebuilds
        // the table and throws the old nodes away.
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
        // The draft, built without touching the DOM or a mail client, so its
        // wording can be asserted rather than eyeballed.
        buildMonthOverMonthEmail: buildMonthOverMonthEmail,
        buildMonthlyStatsEmail: buildMonthlyStatsEmail,
        // What goes into the year picture. The canvas itself can only be
        // eyeballed; this is the part that can be asserted.
        buildYearImageModel: buildYearImageModel,
        rankWithinMetric: _metricRankMap,
        ordinal: _ordinal,
        // Exported so the geometry can be checked against a recording context.
        // Pixels cannot be asserted; coordinates landing off the canvas can.
        drawYearCard: _drawYearCard,
        resetPeriodSelection: resetPeriodSelection
    };

    window.renderCenterRanking = renderCenterRanking;
})();
