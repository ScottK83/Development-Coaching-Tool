(function () {
    'use strict';

    // ============================================
    // CHEERLEADING MODULE
    // For each team member, scans every metric for a
    // true positive angle and assembles an encouraging,
    // copy-ready message (headline + supporting bullets).
    //
    // Three signal types:
    //  1. Knocking on the door  — close to a YTD target,
    //     with the Futures required-pace path to get there.
    //  2. Week-over-week win    — improved vs last week.
    //  3. Monthly momentum      — improved vs last month.
    //
    // Data is read ONLY from canonical sources:
    //  - futures.buildFuturesData() for YTD + targets + pace
    //  - weeklyData with the same call/survey weighting used
    //    by buildYtdAggregateForYear / computeTeamMetricValue
    // ============================================

    // "Knocking on the door": within this fraction of the target.
    var CLOSE_REL = 0.01;
    // Minimum relative move before a week/month change is worth a cheer.
    var MIN_DELTA_REL = 0.01;
    // Uploaded weeks a month needs before it can stand in for "the month".
    var MIN_WEEKS_FOR_MONTH = 2;
    // Survey responses needed on both sides before a survey metric can cheer.
    var MIN_SURVEYS_FOR_CHEER = 3;

    // Metrics eligible for week-over-week / monthly improvement cheers.
    // Reliability is cumulative (attendance) — excluded by design.
    var DELTA_METRICS = [
        'scheduleAdherence', 'cxRepOverall', 'fcr', 'overallExperience',
        'transfers', 'overallSentiment', 'positiveWord', 'negativeWord',
        'managingEmotions', 'aht', 'acw', 'holdTime'
    ];
    var SURVEY_WEIGHTED = { cxRepOverall: true, fcr: true, overallExperience: true };

    var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    /* ── Helpers ── */

    function _escapeHtml(str) {
        var mod = window.DevCoachModules && window.DevCoachModules.sharedUtils;
        if (mod && mod.escapeHtml) return mod.escapeHtml(str);
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }
    function _fmt(key, value) {
        return typeof window.formatMetricDisplay === 'function' ? window.formatMetricDisplay(key, value) : String(value);
    }
    // A few registry labels are written for table headers and read badly in a
    // sentence ("Your Avoid Negative Words improved..."). These are the
    // conversational forms, used only in cheer copy.
    var CONVERSATIONAL_LABELS = {
        positiveWord: 'Positive Word Usage',
        negativeWord: 'Avoiding Negative Words',
        transfers: 'Transfer Rate',
        aht: 'Handle Time',
        acw: 'After Call Work',
        cxRepOverall: 'Rep Satisfaction'
    };

    function _metricLabel(key) {
        if (CONVERSATIONAL_LABELS[key]) return CONVERSATIONAL_LABELS[key];
        var reg = window.METRICS_REGISTRY && window.METRICS_REGISTRY[key];
        return (reg && reg.label) || key;
    }

    // Picks from a pool without repeating until the pool is exhausted, so one
    // message doesn't use the same sentence shape for every bullet.
    function _rotator(pool) {
        var used = [];
        return function () {
            var avail = pool.filter(function (t) { return used.indexOf(t) === -1; });
            if (!avail.length) { used = []; avail = pool; }
            var chosen = avail[Math.floor(Math.random() * avail.length)];
            used.push(chosen);
            return chosen;
        };
    }
    function _metricIcon(key) {
        var reg = window.METRICS_REGISTRY && window.METRICS_REGISTRY[key];
        return (reg && reg.icon) || '';
    }
    function _firstName(name) {
        if (typeof getEmployeeNickname === 'function') return getEmployeeNickname(name);
        return String(name).split(/[\s,]+/)[0];
    }
    function _weeklyData() {
        return typeof weeklyData !== 'undefined' ? weeklyData : {};
    }
    function _year() {
        return new Date().getFullYear();
    }
    function _targets() {
        var mp = window.DevCoachModules && window.DevCoachModules.metricProfiles;
        return (mp && mp.TARGETS_BY_YEAR && mp.TARGETS_BY_YEAR[_year()]) || {};
    }
    function _isReverse(metricKey) {
        var t = _targets()[metricKey];
        return t ? t.type === 'max' : false;
    }
    function _isImprovement(metricKey, prev, cur) {
        return _isReverse(metricKey) ? (cur < prev) : (cur > prev);
    }
    function pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }
    function _monthName(yyyymm) {
        var m = parseInt(String(yyyymm).slice(5, 7), 10);
        return MONTH_NAMES[m - 1] || yyyymm;
    }

    // The in-sentence phrase for a month. The month still in progress reads
    // "so far in July", so a part-month is never presented as a finished one.
    function _monthPhrase(yyyymm, nowMonth) {
        if (!yyyymm) return '';
        return (yyyymm === nowMonth ? 'so far in ' : 'in ') + _monthName(yyyymm);
    }

    /* ── Period helpers ── */

    // Weekly periods for the current year, oldest → newest. Completed weeks
    // only by default; pass includeInProgress to also pick up a partial
    // (week-in-progress) upload as the most recent point.
    function _currentYearWeekKeys(includeInProgress) {
        var wData = _weeklyData();
        var year = _year();
        var keys = Object.keys(wData).filter(function (k) {
            var p = wData[k];
            var pType = (p && p.metadata && p.metadata.periodType) || 'week';
            if (pType !== 'week' && !(includeInProgress && pType === 'week-in-progress')) return false;
            var endStr = (p && p.metadata && p.metadata.endDate) || (k.indexOf('|') !== -1 ? k.split('|')[1] : '');
            return parseInt(String(endStr).split('-')[0], 10) === year;
        });
        keys.sort(function (a, b) {
            return String(_endDate(a)).localeCompare(String(_endDate(b)));
        });
        return keys;
    }
    function _periodType(key) {
        var p = _weeklyData()[key];
        return (p && p.metadata && p.metadata.periodType) || 'week';
    }

    // Real monthly uploads for the current year, keyed by the month they
    // cover. A month someone actually uploaded is the authority for that
    // month; rebuilding it out of weekly buckets is only the fallback.
    function _currentYearMonthUploads() {
        var wData = _weeklyData();
        var year = _year();
        var byMonth = {};
        Object.keys(wData).forEach(function (k) {
            if (_periodType(k) !== 'month') return;
            var end = String(_endDate(k));
            if (parseInt(end.split('-')[0], 10) !== year) return;
            var mo = end.slice(0, 7);
            // Two uploads covering the same month: the later one wins.
            if (!byMonth[mo] || String(_endDate(byMonth[mo])).localeCompare(end) < 0) {
                byMonth[mo] = k;
            }
        });
        return byMonth;
    }

    // Days a period covers, inclusive. Keeps a three-day month-to-date upload
    // from standing in for "so far in August".
    function _spanDays(key) {
        var s = _startDate(key), e = _endDate(key);
        if (!s || !e) return 0;
        var sd = new Date(s + 'T00:00:00'), ed = new Date(e + 'T00:00:00');
        if (isNaN(sd.getTime()) || isNaN(ed.getTime())) return 0;
        return Math.round((ed - sd) / 86400000) + 1;
    }
    function _endDate(key) {
        var p = _weeklyData()[key];
        return (p && p.metadata && p.metadata.endDate) || (key.indexOf('|') !== -1 ? key.split('|')[1] : key);
    }
    function _endMonth(key) {
        return String(_endDate(key)).slice(0, 7); // YYYY-MM
    }
    function _startDate(key) {
        var p = _weeklyData()[key];
        return (p && p.metadata && p.metadata.startDate) || (key.indexOf('|') !== -1 ? key.split('|')[0] : '');
    }
    function _mondayOf(iso) {
        var parts = String(iso).split('-').map(Number);
        if (!parts[0] || !parts[1] || !parts[2]) return null;
        var d = new Date(parts[0], parts[1] - 1, parts[2]);
        var dow = d.getDay();
        d.setDate(d.getDate() + (dow === 0 ? -6 : -(dow - 1)));
        return d;
    }
    // How a weekly period should be named in a sentence. With gaps in the
    // uploads the two most recent weeks are often not adjacent, so calling
    // the newest one "this week" and the one before it "last week" states
    // something false to the employee. Anything that isn't genuinely the
    // current or prior week gets named by its date instead.
    function _weekPhrase(key, today) {
        if (!key) return '';
        if (_periodType(key) === 'week-in-progress') return 'this week so far';
        var mon = _mondayOf(_startDate(key));
        var curMon = _mondayOf(_isoToday(today));
        if (!mon || !curMon) return 'the week of ' + _weekStartLabel(key);
        var diffWeeks = Math.round((curMon - mon) / (7 * 86400000));
        if (diffWeeks === 0) return 'this week';
        if (diffWeeks === 1) return 'last week';
        return 'the week of ' + _weekStartLabel(key);
    }
    function _isoToday(today) {
        var d = today || new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    function _weekStartLabel(key) {
        try {
            var d = new Date(_startDate(key) + 'T00:00:00');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch (e) { return _startDate(key); }
    }
    function _weekLabel(key) {
        try {
            var d = new Date(_endDate(key) + 'T00:00:00');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch (e) { return _endDate(key); }
    }

    // Weighted value for one employee across a set of weekly periods.
    // Rate metrics weight by call volume, survey metrics by survey count —
    // the same rule as buildYtdAggregateForYear / computeTeamMetricValue.
    function _empValue(empName, weekKeys, metricKey) {
        var wData = _weeklyData();
        var wSum = 0, wTotal = 0;
        (weekKeys || []).forEach(function (key) {
            var period = wData[key];
            if (!period || !period.employees) return;
            var emp = null;
            for (var i = 0; i < period.employees.length; i++) {
                if (period.employees[i] && period.employees[i].name === empName) {
                    emp = period.employees[i];
                    break;
                }
            }
            if (!emp) return;
            var val = parseFloat(emp[metricKey]);
            if (!isFinite(val)) return;
            var w;
            if (SURVEY_WEIGHTED[metricKey]) {
                var st = parseInt(emp.surveyTotal, 10);
                w = (isFinite(st) && st > 0) ? st : 0;
            } else {
                var tc = parseInt(emp.totalCalls, 10);
                w = (isFinite(tc) && tc > 0) ? tc : 1;
            }
            if (w <= 0) return;
            wSum += val * w;
            wTotal += w;
        });
        return wTotal > 0 ? wSum / wTotal : null;
    }

    // Total survey responses an employee had across a set of periods.
    function _empSurveyTotal(empName, weekKeys) {
        var wData = _weeklyData();
        var total = 0;
        (weekKeys || []).forEach(function (key) {
            var period = wData[key];
            if (!period || !period.employees) return;
            for (var i = 0; i < period.employees.length; i++) {
                var e = period.employees[i];
                if (e && e.name === empName) {
                    var st = parseInt(e.surveyTotal, 10);
                    if (isFinite(st)) total += st;
                    break;
                }
            }
        });
        return total;
    }

    // Survey-backed metrics off a tiny sample produce meaningless swings: two
    // responses read as 50%, one reads as 0% or 100%, so a different customer
    // answering looks like a 50-point jump. Both sides of the comparison need
    // a real sample before the move means anything.
    function _sampleIsBigEnough(metricKey, empName, prevKeys, curKeys) {
        if (!SURVEY_WEIGHTED[metricKey]) return true;
        return _empSurveyTotal(empName, prevKeys) >= MIN_SURVEYS_FOR_CHEER
            && _empSurveyTotal(empName, curKeys) >= MIN_SURVEYS_FOR_CHEER;
    }

    // Collapse survey metrics down to the single strongest move, since they
    // all describe the same responses.
    function _keepOneSurveyMetric(byMetric) {
        var surveyKeys = Object.keys(byMetric).filter(function (k) { return SURVEY_WEIGHTED[k]; });
        if (surveyKeys.length < 2) return;
        var best = null, bestRel = -1;
        surveyKeys.forEach(function (k) {
            var d = byMetric[k];
            var rel = d.prev !== 0 ? Math.abs(d.cur - d.prev) / Math.abs(d.prev) : 0;
            if (rel > bestRel) { bestRel = rel; best = k; }
        });
        surveyKeys.forEach(function (k) { if (k !== best) delete byMetric[k]; });
    }

    /* ── Cheer detection ── */

    // Sentence pools. Every bullet in a message used to have the identical
    // shape ("Your X improved from A last week to B this week."), which reads
    // like a mail merge. Each cheer kind now draws from a pool that rotates.
    // `pw`/`cw` are the period words ("last week"/"this week", "in May"/"in
    // June") so the same templates serve both weekly and monthly cheers.
    var DELTA_TEMPLATES = [
        function (l, p, c, pw, cw) { return 'Your ' + l + ' went from ' + p + ' ' + pw + ' to ' + c + ' ' + cw + '.'; },
        function (l, p, c, pw, cw) { return l + ' moved the right way, ' + p + ' ' + pw + ' to ' + c + ' ' + cw + '.'; },
        function (l, p, c, pw, cw) { return 'Nice move on ' + l + ': ' + p + ' ' + pw + ', ' + c + ' ' + cw + '.'; },
        function (l, p, c, pw, cw) { return 'Your ' + l + ' improved from ' + p + ' ' + pw + ' to ' + c + ' ' + cw + '.'; },
        function (l, p, c, pw, cw) { return l + ' is looking better, ' + p + ' ' + pw + ' and ' + c + ' ' + cw + '.'; },
        function (l, p, c, pw, cw) { return 'Good jump on ' + l + ', ' + p + ' ' + pw + ' to ' + c + ' ' + cw + '.'; }
    ];
    var EXCEED_TEMPLATES = [
        function (l, v) { return 'Your ' + l + ' is already past goal at ' + v + '. Keep doing what you\'re doing.'; },
        function (l, v) { return l + ' is sitting above goal at ' + v + '. No notes there.'; },
        function (l, v) { return 'You\'ve got ' + l + ' handled, ' + v + ' and past goal.'; },
        function (l, v) { return l + ' at ' + v + ' is past goal. That one\'s locked in.'; },
        function (l, v) { return 'Nothing to fix on ' + l + '. You\'re at ' + v + ', past goal.'; }
    ];
    var MEET_TEMPLATES = [
        function (l, v, t) { return 'Your ' + l + ' is right at goal, ' + v + ' against the ' + t + ' target.'; },
        function (l, v, t) { return l + ' is sitting on goal at ' + v + '.'; },
        function (l, v, t) { return 'You\'re holding ' + l + ' at goal, ' + v + ' against ' + t + '.'; }
    ];

    function _closeText(mk, m, weekInfo) {
        var label = _metricLabel(mk);
        var gap = m.isReverse ? (m.currentAvg - m.meetTarget) : (m.meetTarget - m.currentAvg);
        var weeksLeft = weekInfo.weeksRemaining;
        var cur = _fmt(mk, m.currentAvg);
        var goal = _fmt(mk, m.meetTarget);
        var gapStr = _fmt(mk, Math.abs(gap));

        // When the gap rounds away to nothing, "just 0.0% short of the 93.0%
        // goal" reads as a typo. They're on the line — say that instead.
        if (parseFloat(gapStr) === 0) {
            return 'Your ' + label + ' for the year is right on the line at ' + cur +
                ' against a ' + goal + ' goal. Hold it and it\'s yours.';
        }

        var opener = 'You\'re at ' + cur + ' on ' + label + ' for the year, ' + gapStr +
            ' off the ' + goal + ' goal. ';
        var req = m.requiredToMeet;
        if (weeksLeft <= 0 || req === null || req === undefined) {
            return opener + 'You\'re right on the doorstep.';
        }
        var move = m.isReverse ? (m.currentAvg - req) : (req - m.currentAvg);
        if (move > 0) {
            return opener + 'Average about ' + _fmt(mk, req) + ' a week the rest of the year and you get there.';
        }
        return opener + 'Just hold your current pace and you\'ll get there.';
    }

    // Returns a weight-sorted list of cheers for one employee.
    function buildCheersForEmployee(emp, weekInfo, periods) {
        var metrics = emp.metrics || {};
        var thisWeek = periods.wowCurLabel || (periods.wowCurInProgress ? 'this week so far' : 'this week');
        var lastWeek = periods.wowPrevLabel || 'last week';

        // 1. Week-over-week and monthly improvements.
        var wowByMetric = {}, monByMetric = {};
        DELTA_METRICS.forEach(function (mk) {
            if (periods.wowCur && periods.wowPrev) {
                var c = _empValue(emp.name, [periods.wowCur], mk);
                var p = _empValue(emp.name, [periods.wowPrev], mk);
                if (c !== null && p !== null && _isImprovement(mk, p, c)
                    && _sampleIsBigEnough(mk, emp.name, [periods.wowPrev], [periods.wowCur])) {
                    var rel = p !== 0 ? Math.abs(c - p) / Math.abs(p) : 0;
                    if (rel >= MIN_DELTA_REL) wowByMetric[mk] = { prev: p, cur: c };
                }
            }
            if (periods.monCur && periods.monPrev) {
                var curKeys = periods.monthsMap[periods.monCur];
                var prevKeys = periods.monthsMap[periods.monPrev];
                var cm = _empValue(emp.name, curKeys, mk);
                var pm = _empValue(emp.name, prevKeys, mk);
                if (cm !== null && pm !== null && _isImprovement(mk, pm, cm)
                    && _sampleIsBigEnough(mk, emp.name, prevKeys, curKeys)) {
                    var relm = pm !== 0 ? Math.abs(cm - pm) / Math.abs(pm) : 0;
                    if (relm >= MIN_DELTA_REL) monByMetric[mk] = { prev: pm, cur: cm };
                }
            }
        });

        // Survey metrics all come off the same handful of responses, so
        // reporting Rep Satisfaction, FCR and Overall Experience separately
        // sells one customer's answers as three wins. Keep the strongest and
        // drop the rest.
        _keepOneSurveyMetric(wowByMetric);
        _keepOneSurveyMetric(monByMetric);

        // 2. One best cheer per metric.
        var metricSet = {};
        Object.keys(metrics).forEach(function (k) { metricSet[k] = true; });
        Object.keys(wowByMetric).forEach(function (k) { metricSet[k] = true; });
        Object.keys(monByMetric).forEach(function (k) { metricSet[k] = true; });

        // One rotator set per person, so a single message never repeats a
        // sentence shape even though the pools are shared across the team.
        var nextDelta = _rotator(DELTA_TEMPLATES);
        var nextExceed = _rotator(EXCEED_TEMPLATES);
        var nextMeet = _rotator(MEET_TEMPLATES);

        var cheers = [];
        Object.keys(metricSet).forEach(function (mk) {
            if (mk === 'reliability') return; // attendance — excluded by design
            var m = metrics[mk];
            var label = _metricLabel(mk);

            // Knocking on the door (flagship cheer).
            if (m && !m.isCumulative && !m.currentlyMeeting && m.meetAchievable && m.requiredToMeet !== null) {
                var gap = m.isReverse ? (m.currentAvg - m.meetTarget) : (m.meetTarget - m.currentAvg);
                if (gap > 0 && m.meetTarget && (gap / Math.abs(m.meetTarget)) <= CLOSE_REL) {
                    var text = _closeText(mk, m, weekInfo);
                    if (wowByMetric[mk]) {
                        text += ' And it\'s already moving, ' + _fmt(mk, wowByMetric[mk].prev) +
                            ' ' + lastWeek + ' to ' + _fmt(mk, wowByMetric[mk].cur) + ' ' + thisWeek + '.';
                    }
                    cheers.push({ weight: 100, metricKey: mk, icon: _metricIcon(mk), kind: 'close', text: text });
                    return;
                }
            }
            // Week-over-week win.
            if (wowByMetric[mk]) {
                cheers.push({
                    weight: 70, metricKey: mk, icon: _metricIcon(mk), kind: 'wow',
                    text: nextDelta()(label, _fmt(mk, wowByMetric[mk].prev), _fmt(mk, wowByMetric[mk].cur),
                        lastWeek, thisWeek)
                });
                return;
            }
            // Monthly momentum.
            if (monByMetric[mk]) {
                cheers.push({
                    weight: 55, metricKey: mk, icon: _metricIcon(mk), kind: 'month',
                    text: nextDelta()(label, _fmt(mk, monByMetric[mk].prev), _fmt(mk, monByMetric[mk].cur),
                        periods.monPrevLabel, periods.monCurLabel)
                });
                return;
            }
            // Already exceeding / meeting.
            if (m && !m.isCumulative) {
                if (m.currentlyExceeding) {
                    cheers.push({
                        weight: 45, metricKey: mk, icon: _metricIcon(mk), kind: 'exceed',
                        text: nextExceed()(label, _fmt(mk, m.currentAvg))
                    });
                    return;
                }
                if (m.currentlyMeeting) {
                    cheers.push({
                        weight: 35, metricKey: mk, icon: _metricIcon(mk), kind: 'meet',
                        text: nextMeet()(label, _fmt(mk, m.currentAvg), _fmt(mk, m.meetTarget))
                    });
                    return;
                }
            }
        });

        cheers.sort(function (a, b) { return b.weight - a.weight; });
        return cheers;
    }

    /* ── Build full data set ── */

    function buildCheerData() {
        var futures = window.DevCoachModules && window.DevCoachModules.futures;
        if (!futures || !futures.buildFuturesData) return null;

        var fData = futures.buildFuturesData();
        if (!fData || !fData.employees || !fData.employees.length) return null;

        // Monthly bucketing uses completed weeks only; week-over-week also
        // counts a partial (in-progress) week as the latest point.
        var weekKeys = _currentYearWeekKeys(false);
        var wowKeys = _currentYearWeekKeys(true);

        // Week-over-week: the two most recent weekly points.
        var wowCur = wowKeys.length >= 2 ? wowKeys[wowKeys.length - 1] : null;
        var wowPrev = wowKeys.length >= 2 ? wowKeys[wowKeys.length - 2] : null;
        var wowCurInProgress = wowCur ? (_periodType(wowCur) === 'week-in-progress') : false;

        // Monthly comparison. Waiting for a month to fully elapse means that
        // on Jul 27 every monthly cheer still talks about June, which is stale
        // by then. The current month is allowed in once it has enough weeks
        // behind it, and gets labelled "so far in July" so nobody reads a
        // part-month as a finished one.
        var now = new Date();
        var nowMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        var monthsMap = {};
        weekKeys.forEach(function (k) {
            var mo = _endMonth(k);
            if (mo) { (monthsMap[mo] = monthsMap[mo] || []).push(k); }
        });

        // A real monthly upload outranks the weekly reconstruction for its
        // month. Bucketing weeks by end date makes "July" mean the weeks
        // *ending* in July — roughly Jun 29 through Jul 26 — so a rebuilt
        // figure can sit well off the July number on the uploaded report, and
        // the report is what the employee will be shown. Quote the upload
        // wherever the month was uploaded outright.
        var monthUploads = _currentYearMonthUploads();
        var fromUpload = {};
        Object.keys(monthUploads).forEach(function (mo) {
            var key = monthUploads[mo];
            if (_spanDays(key) < MIN_WEEKS_FOR_MONTH * 7) return;
            monthsMap[mo] = [key];
            fromUpload[mo] = true;
        });

        // A month standing on a single uploaded week isn't a month. Comparing
        // one week of June against one week of May and calling it monthly
        // movement is how a gap in the uploads turns into a false claim. A
        // month carried by its own upload is already whole, so the week count
        // doesn't apply to it.
        var usable = Object.keys(monthsMap).filter(function (mo) {
            if (mo > nowMonth) return false;
            return fromUpload[mo] || monthsMap[mo].length >= MIN_WEEKS_FOR_MONTH;
        }).sort();
        var monCur = usable.length >= 2 ? usable[usable.length - 1] : null;
        var monPrev = usable.length >= 2 ? usable[usable.length - 2] : null;

        // Name each week honestly. When the two points are adjacent and the
        // newest really is last week, "the week before" reads better than a
        // second date; otherwise both get named outright.
        var curPhrase = _weekPhrase(wowCur, now);
        var prevPhrase = _weekPhrase(wowPrev, now);
        var curMon = wowCur ? _mondayOf(_startDate(wowCur)) : null;
        var prevMon = wowPrev ? _mondayOf(_startDate(wowPrev)) : null;
        var adjacent = curMon && prevMon && Math.round((curMon - prevMon) / (7 * 86400000)) === 1;
        if (adjacent && (curPhrase === 'this week' || curPhrase === 'this week so far' || curPhrase === 'last week')) {
            prevPhrase = curPhrase === 'last week' ? 'the week before' : 'last week';
        }
        // Never let both sides carry the same name. "from 0.0% last week to
        // 100.0% last week" is nonsense on its face; fall back to dates.
        if (prevPhrase && prevPhrase === curPhrase) {
            prevPhrase = 'the week of ' + _weekStartLabel(wowPrev);
            curPhrase = 'the week of ' + _weekStartLabel(wowCur);
        }

        var periods = {
            wowCur: wowCur, wowPrev: wowPrev, wowCurInProgress: wowCurInProgress,
            wowCurLabel: curPhrase, wowPrevLabel: prevPhrase,
            monCur: monCur, monPrev: monPrev, monthsMap: monthsMap,
            monFromUpload: fromUpload,
            monCurLabel: _monthPhrase(monCur, nowMonth),
            monPrevLabel: _monthPhrase(monPrev, nowMonth)
        };

        var people = [];
        fData.employees.forEach(function (emp) {
            var cheers = buildCheersForEmployee(emp, fData.weekInfo, periods);
            if (cheers.length) {
                people.push({
                    name: emp.name,
                    firstName: _firstName(emp.name),
                    dataSource: emp.dataSource || '',
                    cheers: cheers
                });
            }
        });

        // Best cheer first, then name.
        people.sort(function (a, b) {
            var d = b.cheers[0].weight - a.cheers[0].weight;
            return d !== 0 ? d : a.firstName.localeCompare(b.firstName);
        });

        return {
            people: people,
            weekInfo: fData.weekInfo,
            periods: periods,
            dataSource: (fData.employees[0] && fData.employees[0].dataSource) || '',
            totalTeam: fData.employees.length
        };
    }

    /* ── Message generation ── */

    var GREETINGS = [
        function (n) { return 'Hey ' + n + '! 🎉'; },
        function (n) { return n + ', quick one for you 🌟'; },
        function (n) { return 'Hey ' + n + ' 👋'; },
        function (n) { return n + '! Wanted to share some good news 😊'; },
        function (n) { return 'Hi ' + n + '! 💪'; },
        function (n) { return n + ', take a look at this 👀'; },
        function (n) { return 'Hey ' + n + ', this one\'s worth a look 👀'; },
        function (n) { return n + '! Good stuff in your numbers 🙌'; },
        function (n) { return 'Hey ' + n + ', got something good to share 😊'; }
    ];
    // Says why this message is arriving. Without it the note opens on a
    // number and reads like it came out of nowhere. Deliberately cadence
    // neutral — no "weekly" — since these don't go out on a fixed schedule.
    var CONTEXT_LINES = [
        'I was going back through everyone\'s numbers and yours stood out, so I wanted to send this your way.',
        'I like to look through where everyone is at and pass along the good stuff when I see it. Here\'s yours.',
        'Been reviewing how everyone\'s tracking, and there\'s some good news in yours worth sharing.',
        'I go through these numbers pretty regularly, and a few things in yours are worth pointing out.',
        'Wanted to send this along after looking through where everyone stands. Some good movement on your side.',
        'I try to catch the wins when I\'m looking through everyone\'s numbers, and you had a few.',
        'Was reviewing where everyone\'s at and figured you\'d want to see this.',
        'Spent some time in everyone\'s numbers today and yours had a few things worth calling out.'
    ];
    var BRIDGES = [
        'A couple more things worth calling out:',
        'And it doesn\'t stop there:',
        'Some other bright spots:',
        'Plus these:',
        'A few more good signs:',
        'There\'s more:',
        'Also worth a mention:'
    ];
    var CLOSERS = [
        'Keep it rolling. You\'re closer than you think. 💪',
        'Proud of the direction you\'re heading. Keep going! 🚀',
        'That\'s real progress. Stay with it! 🌟',
        'Love seeing this. Keep stacking good days! 🙌',
        'You\'re doing the work and it shows. Keep pushing! 🔥',
        'Small steps add up. Keep at it! 👏',
        'Nice work. Let\'s keep it going. 🙌',
        'Keep it up. You\'ve got a good thing going here. 💪'
    ];

    function buildCheerMessage(person) {
        var cheers = person.cheers || [];
        if (!cheers.length) return '';
        var lines = [];
        lines.push(pick(GREETINGS)(person.firstName));
        lines.push('');
        lines.push(pick(CONTEXT_LINES)); // why they're hearing from you
        lines.push('');
        lines.push(cheers[0].text); // headline
        var rest = cheers.slice(1, 4); // up to 3 supporting bullets
        if (rest.length) {
            lines.push('');
            lines.push(pick(BRIDGES));
            rest.forEach(function (c) { lines.push('• ' + c.text); });
        }
        lines.push('');
        lines.push(pick(CLOSERS));
        return lines.join('\n');
    }

    // All team members' cheer messages in one document, divider-separated.
    function buildAllCheers(people) {
        if (!people || !people.length) return 'No cheers to share right now.';
        return people.map(function (p) {
            return buildCheerMessage(p);
        }).join('\n\n--------------------\n\n');
    }

    /* ── Kind badges ── */

    var KIND_BADGE = {
        close: { text: '🎯 Knocking on the door', bg: '#dcfce7', color: '#166534' },
        wow: { text: '📈 Improving', bg: '#dbeafe', color: '#1e40af' },
        month: { text: '📈 Monthly gain', bg: '#dbeafe', color: '#1e40af' },
        exceed: { text: '🏆 Crushing it', bg: '#fef3c7', color: '#92400e' },
        meet: { text: '✅ At goal', bg: '#dcfce7', color: '#166534' }
    };

    /* ── Render ── */

    function renderCheerleading(container) {
        if (!container) return;

        var data = buildCheerData();

        if (!data) {
            container.innerHTML = '<div style="text-align:center; padding:60px 20px; color:#94a3b8;">' +
                '<div style="font-size:3em; margin-bottom:16px;">📣</div>' +
                '<h3 style="color:#64748b; margin:0 0 8px 0;">No Data Yet</h3>' +
                '<p style="margin:0;">Upload weekly or YTD data to see cheer suggestions for your team.</p></div>';
            return;
        }

        var html = '';

        // Data transparency banner.
        var p = data.periods;
        html += '<div style="margin-bottom:16px; padding:12px 16px; background:#ecfdf5; border-left:4px solid #10b981; border-radius:8px; font-size:0.85em; color:#065f46;">';
        html += '<strong>📣 Cheerleader</strong> builds an encouraging, copy-ready message for each team member from your live data.';
        html += '<div style="margin-top:6px; color:#047857;">';
        html += 'YTD source: ' + _escapeHtml(data.dataSource || 'n/a') + ' &nbsp;•&nbsp; ';
        html += (p.wowCur && p.wowPrev)
            ? 'Week over week: ' + _escapeHtml(_weekLabel(p.wowPrev)) + ' vs ' + _escapeHtml(_weekLabel(p.wowCur)) +
                (p.wowCurInProgress ? ' (in progress)' : '')
            : 'Week over week: needs two weekly uploads';
        html += ' &nbsp;•&nbsp; ';
        // Name the source per month. A month rebuilt from weekly buckets spans
        // the weeks *ending* in it, not the calendar month, so it can disagree
        // with the monthly report — say which one is being quoted.
        var _monTag = function (mo) {
            return _escapeHtml(_monthName(mo)) +
                ((p.monFromUpload && p.monFromUpload[mo]) ? ' (upload)' : ' (from weeks)');
        };
        html += (p.monCur && p.monPrev)
            ? 'Monthly: ' + _monTag(p.monPrev) + ' vs ' + _monTag(p.monCur)
            : 'Monthly: needs two completed months';
        html += ' &nbsp;•&nbsp; ' + data.weekInfo.weeksRemaining + ' weeks left in ' + data.weekInfo.currentYear;
        html += '</div></div>';

        if (!data.people.length) {
            html += '<div style="text-align:center; padding:50px 20px; color:#94a3b8;">' +
                '<div style="font-size:2.5em; margin-bottom:12px;">🔍</div>' +
                '<h3 style="color:#64748b; margin:0 0 8px 0;">No Cheers to Surface Right Now</h3>' +
                '<p style="margin:0;">Once team members get close to a goal or improve week over week, they will show up here.</p></div>';
            container.innerHTML = html;
            return;
        }

        html += '<div style="margin-bottom:16px; display:flex; gap:12px; flex-wrap:wrap; align-items:center;">';
        html += '<button type="button" id="cheerCopyAll" style="padding:12px 24px; background:linear-gradient(135deg, #10b981 0%, #059669 100%); color:#fff; border:none; border-radius:8px; font-weight:bold; font-size:1em; cursor:pointer; box-shadow:0 2px 8px rgba(5,150,105,0.3);">📋 Copy All Cheers</button>';
        html += '<span style="color:#64748b; font-size:0.9em;">📣 ' +
            data.people.length + ' of ' + data.totalTeam + ' team member' + (data.totalTeam !== 1 ? 's' : '') +
            ' have something to cheer.</span>';
        html += '</div>';

        html += renderCheerCards(data.people);

        container.innerHTML = html;
        bindCheerButtons(container, data.people);
    }

    function renderCheerCards(people) {
        var html = '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(360px, 1fr)); gap:16px;">';

        people.forEach(function (person) {
            var headline = person.cheers[0];
            var bullets = person.cheers.slice(1, 4);
            var badge = KIND_BADGE[headline.kind] || KIND_BADGE.meet;

            html += '<div class="cheer-card" style="background:#fff; border-radius:10px; border:2px solid #10b981; padding:16px; display:flex; flex-direction:column; gap:10px;">';

            // Header.
            html += '<div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">';
            html += '<div style="font-weight:700; font-size:1.1em; color:#1a1a2e;">' + _escapeHtml(person.firstName) + '</div>';
            html += '<span style="padding:3px 10px; background:' + badge.bg + '; color:' + badge.color + '; border-radius:12px; font-size:0.78em; font-weight:700; white-space:nowrap;">' + badge.text + '</span>';
            html += '</div>';

            // Headline cheer.
            html += '<div style="padding:10px 12px; background:#ecfdf5; border-left:3px solid #10b981; border-radius:4px; font-size:0.9em; color:#064e3b;">' +
                (headline.icon ? headline.icon + ' ' : '') + _escapeHtml(headline.text) + '</div>';

            // Supporting bullets.
            if (bullets.length) {
                html += '<div style="display:flex; flex-direction:column; gap:6px;">';
                bullets.forEach(function (c) {
                    html += '<div style="padding:7px 11px; background:#f0fdf4; border-left:3px solid #86efac; border-radius:4px; font-size:0.85em; color:#166534;">' +
                        (c.icon ? c.icon + ' ' : '') + _escapeHtml(c.text) + '</div>';
                });
                html += '</div>';
            }

            // Action button.
            html += '<button type="button" class="cheer-msg-btn" data-employee="' + _escapeHtml(person.name) + '" ' +
                'style="margin-top:auto; background:linear-gradient(135deg, #10b981 0%, #059669 100%); color:#fff; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold; font-size:0.9em;">' +
                '💬 Cheer Message</button>';

            html += '</div>';
        });

        html += '</div>';
        return html;
    }

    function bindCheerButtons(container, people) {
        var copyAll = container.querySelector('#cheerCopyAll');
        if (copyAll) {
            copyAll.addEventListener('click', function () {
                showCheerModal('All Cheer Messages', buildAllCheers(people), function () {
                    return buildAllCheers(people);
                });
            });
        }
        container.querySelectorAll('.cheer-msg-btn').forEach(function (btn) {
            btn.addEventListener('click', function () {
                var person = people.find(function (x) { return x.name === btn.dataset.employee; });
                if (!person) return;
                showCheerModal(person.firstName + ' - Cheer Message', buildCheerMessage(person), function () {
                    return buildCheerMessage(person);
                });
            });
        });
    }

    /* ── Modal ── */

    function showCheerModal(title, message, regenerateFn) {
        try {
            navigator.clipboard.writeText(message);
            if (typeof showToast === 'function') showToast('Copied to clipboard!', 2000);
        } catch (e) { /* clipboard may be unavailable — modal still copyable */ }

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10000; padding:20px;';

        overlay.innerHTML =
            '<div style="background:#fff; border-radius:12px; max-width:600px; width:100%; max-height:80vh; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
                '<div style="padding:16px 20px; border-bottom:1px solid #e5e7eb; display:flex; justify-content:space-between; align-items:center;">' +
                    '<h3 style="margin:0; color:#1a1a2e;">📣 ' + _escapeHtml(title) + '</h3>' +
                    '<button type="button" id="cheerModalClose" style="background:none; border:none; font-size:1.5em; cursor:pointer; color:#999;">✕</button>' +
                '</div>' +
                '<div style="padding:20px; overflow-y:auto; flex:1;">' +
                    '<textarea id="cheerModalText" style="width:100%; min-height:250px; border:1px solid #e5e7eb; border-radius:8px; padding:12px; font-size:0.95em; font-family:inherit; resize:vertical; line-height:1.5;">' + _escapeHtml(message) + '</textarea>' +
                '</div>' +
                '<div style="padding:12px 20px; border-top:1px solid #e5e7eb; display:flex; gap:8px; justify-content:flex-end;">' +
                    '<button type="button" id="cheerModalRegenerate" style="padding:10px 16px; background:#f1f5f9; border:1px solid #cbd5e1; border-radius:8px; cursor:pointer; font-weight:600;">🔄 Regenerate</button>' +
                    '<button type="button" id="cheerModalCopy" style="padding:10px 16px; background:linear-gradient(135deg, #10b981 0%, #059669 100%); color:#fff; border:none; border-radius:8px; cursor:pointer; font-weight:600;">📋 Copy</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        overlay.querySelector('#cheerModalClose').addEventListener('click', function () { overlay.remove(); });
        overlay.addEventListener('click', function (e) { if (e.target === overlay) overlay.remove(); });

        overlay.querySelector('#cheerModalCopy').addEventListener('click', function () {
            var textarea = overlay.querySelector('#cheerModalText');
            try {
                navigator.clipboard.writeText(textarea.value);
                if (typeof showToast === 'function') showToast('Copied!', 2000);
            } catch (e) { textarea.select(); }
        });

        var regenBtn = overlay.querySelector('#cheerModalRegenerate');
        if (regenerateFn) {
            regenBtn.addEventListener('click', function () {
                var newMessage = regenerateFn();
                var textarea = overlay.querySelector('#cheerModalText');
                if (textarea && newMessage) {
                    textarea.value = newMessage;
                    try {
                        navigator.clipboard.writeText(newMessage);
                        if (typeof showToast === 'function') showToast('Regenerated & copied!', 2000);
                    } catch (e) { /* ok */ }
                }
            });
        } else {
            regenBtn.style.display = 'none';
        }
    }

    /* ── Module export ── */
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.cheerleading = {
        renderCheerleading: renderCheerleading,
        buildCheerData: buildCheerData,
        buildCheerMessage: buildCheerMessage
    };
})();
