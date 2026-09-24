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
        if (mp && typeof mp.getTargetsForYear === 'function') return mp.getTargetsForYear(_year());
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
    // Weighted value for one employee across a set of weekly periods.
    // Rate metrics weight by call volume, survey metrics by survey count. 
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

    // Whether a comparison is two week-shaped uploads, the only shape the
    // week-over-week cheer can read. _empValue walks the weekly store, and a
    // month or a year against its predecessor is not a week-over-week move.
    function _isWeekShapedComparison(cmp) {
        if (!cmp || !cmp.latestKey || !cmp.baselineKey) return false;
        if (cmp.unit && cmp.unit !== 'week') return false;
        var wData = _weeklyData();
        var weekLike = function (key) {
            var t = wData[key] && wData[key].metadata && wData[key].metadata.periodType || 'week';
            return !!wData[key] && (t === 'week' || t === 'week-in-progress' || t === 'custom');
        };
        return weekLike(cmp.latestKey) && weekLike(cmp.baselineKey);
    }

    /**
     * options.comparison is the window My Team is showing. When it is two weeks,
     * those are the two weeks the cheer compares, named the way the page names
     * them. When it is anything else, the week-over-week cheer is left out
     * rather than quietly measured over two different weeks: the year pace and
     * the monthly movement still stand, because they are about the year and the
     * month and say so. Left out entirely, nothing changes: the newest two
     * weekly uploads, as before.
     */
    function buildCheerData(options) {
        var futures = window.DevCoachModules && window.DevCoachModules.futures;
        if (!futures || !futures.buildFuturesData) return null;

        var fData = futures.buildFuturesData();
        if (!fData || !fData.employees || !fData.employees.length) return null;

        // Monthly bucketing uses completed weeks only; week-over-week also
        // counts a partial (in-progress) week as the latest point.
        var weekKeys = _currentYearWeekKeys(false);
        var wowKeys = _currentYearWeekKeys(true);

        // Week-over-week: the two most recent weekly points, unless a window
        // was handed over, in which case it decides.
        var cmp = options && options.comparison;
        var wowCur = wowKeys.length >= 2 ? wowKeys[wowKeys.length - 1] : null;
        var wowPrev = wowKeys.length >= 2 ? wowKeys[wowKeys.length - 2] : null;
        if (cmp) {
            var weekShaped = _isWeekShapedComparison(cmp);
            wowCur = weekShaped ? cmp.latestKey : null;
            wowPrev = weekShaped ? cmp.baselineKey : null;
        }
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
        var fromWindow = Boolean(cmp && wowCur && cmp.latestLabel && cmp.baselineLabel);
        var curMon = wowCur ? _mondayOf(_startDate(wowCur)) : null;
        var prevMon = wowPrev ? _mondayOf(_startDate(wowPrev)) : null;
        var adjacent = curMon && prevMon && Math.round((curMon - prevMon) / (7 * 86400000)) === 1;
        if (fromWindow) {
            // The page already said "this week so far against last week" above
            // the message. The cheer uses the same words for the same weeks.
            curPhrase = cmp.latestLabel;
            prevPhrase = cmp.baselineLabel;
        } else if (adjacent && (curPhrase === 'this week' || curPhrase === 'this week so far' || curPhrase === 'last week')) {
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

    // Openers live in message-voice.module.js so every tab that greets an
    // associate sounds like the same person wrote it.
    var GREETINGS = (window.DevCoachModules && window.DevCoachModules.messageVoice
        && window.DevCoachModules.messageVoice.greetingPool('celebratory')) || [
        function (n) { return 'Hey ' + n + '! 🎉'; }
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

    /**
     * One person's cheer over the window My Team is showing, or '' when there is
     * nothing true to cheer. The day page's Cheer tone reads this.
     */
    function cheerMessageFor(name, comparison) {
        var data = buildCheerData({ comparison: comparison || null });
        if (!data) return '';
        var person = data.people.filter(function (p) { return p.name === name; })[0];
        return person ? buildCheerMessage(person) : '';
    }

    /* ── Module export ── */
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.cheerleading = {
        buildCheerData: buildCheerData,
        buildCheerMessage: buildCheerMessage,
        cheerMessageFor: cheerMessageFor
    };
})();
