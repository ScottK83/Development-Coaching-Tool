(function () {
    'use strict';

    // ============================================
    // QUARTER REVIEW MODULE
    //
    // The document that goes into an associate's record at a quarterly
    // check-in. Two things come out of here off one set of facts:
    //
    //   buildNotes()   finished text, written here, paste ready
    //   buildPrompt()  the same facts handed to Copilot to reword
    //
    // Everything else in the review path emits a prompt and nothing else, so
    // the wording of a record document depends on what a model felt like
    // saying that morning. The numbers in a personnel file should not vary
    // between runs, so the figures, the direction of each one and the sentence
    // that carries them are built here. Copilot stays available for when a
    // particular associate needs the tone moved.
    //
    // House rules this copy has to hold to, all of them enforced by tests:
    //   - No dash characters of any kind in a string. Commas and full stops.
    //   - No rating vocabulary. Associates are not shown the internal scale,
    //     so no "on track", "off track", "exceptional", "successful", "tier",
    //     or a score named as a number. review-tier-vocabulary.test.js sweeps
    //     these files for it.
    //   - Third person, about the associate, never "you". This is a file note,
    //     not a letter to them.
    //   - No "only X away from" phrasing. The gap is a number and stands.
    //   - Missed hours are the year's running total, never the quarter's.
    //   - No caveats about the data in associate facing copy.
    // ============================================

    /* The metrics a quarterly check-in speaks to, in the order a supervisor
     * would raise them: the two that describe the work, then how customers
     * rated it, then attendance. */
    var REVIEW_METRICS = [
        'aht',
        'scheduleAdherence',
        'overallSentiment',
        'cxRepOverall',
        'fcr',
        'overallExperience',
        'transfers',
        'reliability'
    ];

    // Missed hours are described against the year, so they never take part in
    // the quarter by quarter prose the other metrics get.
    var RELIABILITY = 'reliability';

    // The four a review is actually about, matching the set the year end
    // scoring uses minus attendance. Used where one metric has to stand for a
    // whole quarter, so it is one of these rather than whichever happens to
    // sit furthest from a generous goal.
    var CORE_METRICS = ['aht', 'scheduleAdherence', 'overallSentiment', 'cxRepOverall'];

    // Fewer responses than this behind a survey quarter and the quarter is not
    // quoted as a movement. Three is the floor the year end scoring already
    // uses, and a quarter swinging on two surveys is noise in a record.
    var MIN_SURVEYS_FOR_TREND = 3;

    /* ── Access to the rest of the app ── */

    function _qt() { return (window.DevCoachModules || {}).quarterTrend || null; }

    // Through quarter-trend so a name spelled differently between two
    // uploads is still one person, rather than a quarter with no data.
    function _findEmployee(quarterAggregate, name) {
        var qt = _qt();
        if (qt && typeof qt.findEmployee === 'function') return qt.findEmployee(quarterAggregate, name);
        return (quarterAggregate && quarterAggregate.employees && quarterAggregate.employees[name]) || null;
    }
    function _registry() { return window.METRICS_REGISTRY || {}; }
    function _profiles() { return (window.DevCoachModules || {}).metricProfiles || {}; }

    function _label(metricKey) {
        var def = _registry()[metricKey];
        return (def && def.label) || metricKey;
    }

    function _display(metricKey, value) {
        if (typeof window.formatMetricDisplay === 'function') {
            return window.formatMetricDisplay(metricKey, value);
        }
        return String(value);
    }

    /* How much a metric MOVED, which is not how a metric READS.
     *
     * A rate that goes from 91.2% to 94.1% moved 2.9 percentage points, and
     * calling that "2.9% better" is the ambiguity that makes a reader wonder
     * whether it means 2.9 points or 2.9 percent of 91.2. A record should not
     * make anyone work that out, so a movement gets a plain unit word and only
     * a level keeps the % sign.
     */
    function _movementAmount(metricKey, size) {
        var def = _registry()[metricKey] || {};
        var n = Math.round(size * 10) / 10;
        if (def.unit === 'sec') return Math.round(size) + (Math.round(size) === 1 ? ' second' : ' seconds');
        if (def.unit === 'hrs') return n + (n === 1 ? ' hour' : ' hours');
        if (def.unit === '%') return n + (n === 1 ? ' point' : ' points');
        return String(n);
    }

    function _targetFor(metricKey, year) {
        var profiles = _profiles();
        var forYear = typeof profiles.getTargetsForYear === 'function'
            ? profiles.getTargetsForYear(year)
            : ((profiles.TARGETS_BY_YEAR || {})[parseInt(year, 10)] || {});
        if (forYear[metricKey]) return Object.assign({ metricKey: metricKey }, forYear[metricKey]);
        var def = _registry()[metricKey];
        return (def && def.target) || null;
    }

    function _meetsTarget(target, value) {
        if (!target || !Number.isFinite(value)) return null;
        var profiles = _profiles();
        if (target.metricKey && typeof profiles.valueMeetsTarget === 'function') {
            return profiles.valueMeetsTarget(target.metricKey, value, target);
        }
        return target.type === 'min' ? value >= target.value : value <= target.value;
    }

    function _firstName(name) {
        if (typeof window.getEmployeeNickname === 'function') {
            var nick = window.getEmployeeNickname(name);
            if (nick) return nick;
        }
        return String(name || '').split(' ')[0] || name;
    }

    // A record carries dates the way the business writes them. Done here
    // rather than through the app's shared helper because this module is also
    // the one thing in the review path that has to produce finished copy with
    // nothing else loaded.
    function _formatDate(dateText) {
        var parts = String(dateText || '').split('-');
        if (parts.length === 3 && parts[0].length === 4) {
            return parts[1] + '/' + parts[2] + '/' + parts[0];
        }
        return dateText || '';
    }

    function _round1(n) {
        return Math.round(n * 10) / 10;
    }

    /* A stable pick from a few phrasings.
     *
     * Eighteen documents opening on the same sentence read as a form, so the
     * recognition lines and closings come in a few wordings (Scott,
     * 2026-10-14: "See if it comes off natural"). Chosen off the name and the
     * quarter rather than at random, because a record must read the same
     * every time it is built: regenerating a file note should never change
     * its words.
     */
    function _pick(options, seed) {
        var text = String(seed || '');
        var h = 0;
        for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 100003;
        return options[h % options.length];
    }

    // A metric that did not move, said a few ways (see metricSentence).
    var STEADY_WORDS = ['held steady', 'stayed level', 'stayed consistent'];
    var STEADY_YEAR_WORDS = ['held steady across the year', 'stayed level across the year', 'stayed consistent all year'];

    // The name a closing sentence uses for a metric the box has just named in
    // full. "Bring handle time down toward 426s" reads as speech; "bring
    // average handle time down toward 426s" reads as a report heading.
    var SHORT_LABELS = {
        aht: 'handle time',
        scheduleAdherence: 'adherence',
        overallSentiment: 'sentiment',
        cxRepOverall: 'rep satisfaction',
        fcr: 'first call resolution',
        overallExperience: 'overall experience',
        transfers: 'transfers'
    };

    function _shortLabel(metricKey) {
        return SHORT_LABELS[metricKey] || _label(metricKey).toLowerCase();
    }

    // "Q4", or null when the check-in is the year's last quarter.
    function _nextQuarterName(ctx) {
        return ctx.quarter < 4 ? 'Q' + (ctx.quarter + 1) : null;
    }

    /* ── Building the facts ── */

    /* One associate, one year, every quarter that has started.
     *
     * The quarter aggregates are built once by the caller and passed in, so a
     * whole team can be prepared without reading the store once per person.
     */
    function buildContext(employeeName, year, options) {
        var opts = options || {};
        var qt = _qt();
        if (!qt || !employeeName) return null;

        var quarters = opts.quarters || qt.buildYearQuarters(year, opts);
        if (!quarters || !quarters.length) return null;

        var throughQuarter = opts.throughQuarter
            || quarters[quarters.length - 1].quarter;
        var scoped = quarters.filter(function (q) { return q.quarter <= throughQuarter; });
        if (!scoped.length) return null;

        var current = scoped[scoped.length - 1];
        var metrics = [];

        REVIEW_METRICS.forEach(function (metricKey) {
            if (metricKey === RELIABILITY) return;
            var series = qt.buildMetricSeries(employeeName, metricKey, scoped);
            if (!series.measuredCount) return;

            var target = _targetFor(metricKey, year);
            var usable = _usablePoints(metricKey, series);

            // Standing is read off the newest quarter solid enough to quote,
            // not simply the newest one there is.
            //
            // The floor already kept a two response quarter out of the prose.
            // It did not keep it out of the verdict, so a quarter where two
            // people happened to answer set "at goal" for the whole document
            // while the sentence beneath quoted the quarters that actually had
            // surveys behind them. When no quarter clears the floor, nothing
            // is claimed either way rather than falling back to the thinnest
            // reading available.
            var isSurvey = !!(window.SURVEY_WEIGHT_FIELD || {})[metricKey];
            var latest = usable.length ? usable[usable.length - 1]
                : (isSurvey ? null : series.last);

            // Every quarter too thin to quote leaves nothing to say. The
            // metric is dropped rather than carried through with a null
            // verdict for each box to interpret on its own.
            if (isSurvey && !usable.length) return;

            metrics.push({
                metricKey: metricKey,
                label: _label(metricKey),
                series: series,
                usablePoints: usable,
                target: target,
                latestValue: latest ? latest.value : null,
                latestQuarter: latest ? latest.name : null,
                meetsTarget: latest ? _meetsTarget(target, latest.value) : null,
                gap: _gap(target, latest),
                direction: series.overall.direction,
                latestMove: series.latestMove.direction,
                movedAcross: _spanChange(metricKey, usable),
                isReverse: !!(_registry()[metricKey] || {}).isReverse
            });
        });

        return {
            name: employeeName,
            firstName: _firstName(employeeName),
            year: parseInt(year, 10),
            quarter: current.quarter,
            quarterLabel: current.label,
            quarters: scoped,
            current: current,
            metrics: metrics,
            reliability: _reliabilityFacts(employeeName, year, scoped),
            coverage: _coverageFacts(scoped, employeeName),
            support: _supportFacts(employeeName, scoped),
            preparedOn: opts.preparedOn || _today()
        };
    }

    function _today() {
        var d = new Date();
        return d.getFullYear() + '-'
            + (d.getMonth() + 1 < 10 ? '0' : '') + (d.getMonth() + 1) + '-'
            + (d.getDate() < 10 ? '0' : '') + d.getDate();
    }

    /* Points solid enough to quote as a movement.
     *
     * A survey rate resting on one or two responses is not a quarter's worth
     * of customer opinion, and putting it in a record as "slipped to 74%"
     * treats two people as a trend.
     */
    function _usablePoints(metricKey, series) {
        var fields = window.SURVEY_WEIGHT_FIELD || {};
        var isSurvey = !!fields[metricKey];
        return series.measured.filter(function (p) {
            if (!isSurvey) return true;
            return p.surveyCount >= MIN_SURVEYS_FOR_TREND;
        });
    }

    function _gap(target, point) {
        if (!target || !point || !point.hasValue) return null;
        var diff = point.value - target.value;
        return {
            signed: diff,
            size: Math.abs(diff),
            meets: _meetsTarget(target, point.value)
        };
    }

    /* How far the metric moved from its first usable quarter to its last, with
     * the metric's polarity applied so "better" means better. */
    function _spanChange(metricKey, usable) {
        if (!usable || usable.length < 2) return null;
        var first = usable[0];
        var last = usable[usable.length - 1];
        // Measured on the numbers as they are printed, so "That is 30 seconds
        // better" is the gap between the two figures the reader can see
        // (451s and 421s), not the 30.8 between the values behind them. The
        // recap email measures a move the same way, so the two agree.
        var from = printedValue(metricKey, first.value);
        var to = printedValue(metricKey, last.value);
        var mm = (window.DevCoachModules || {}).metricMovement;
        var better = mm && typeof mm.performanceDelta === 'function'
            ? mm.performanceDelta(metricKey, to, from)
            : to - from;
        var raw = printedValue(metricKey, to - from);
        return {
            from: first,
            to: last,
            raw: raw,
            size: Math.abs(raw),
            improved: Number.isFinite(better) ? better > 0 : null,
            quartersApart: usable.length
        };
    }

    /* A value as the page prints it: 92.84 is 92.8, 420.6 seconds is 421.
     *
     * Read back off the display rather than rounded again here, because the
     * display rounds with toFixed and a second rounding rule disagrees with
     * it on a tie (70.05 prints 70.0 and rounds to 70.1). Differences of two
     * printed values are put through it too, which keeps 92.8 minus 91.6 at
     * 1.2 rather than 1.1999999999999886.
     */
    function printedValue(metricKey, value) {
        if (!Number.isFinite(value)) return value;
        var negative = value < 0;
        var shown = parseFloat(String(_display(metricKey, Math.abs(value))).replace(/[^0-9.]/g, ''));
        if (!Number.isFinite(shown)) return value;
        return negative ? -shown : shown;
    }

    /* Missed hours, as the year's running total at the close of each quarter.
     *
     * The quarter's own hours are what the aggregate carries, so the running
     * figure is those hours accumulated forward. Stated this way the trend is
     * still visible without ever putting a single quarter's hours in front of
     * an associate as though that were the number that counts.
     */
    function _reliabilityFacts(employeeName, year, quarters) {
        var target = _targetFor(RELIABILITY, year);
        var running = 0;
        var any = false;
        var checkpoints = quarters.map(function (qa) {
            var emp = _findEmployee(qa, employeeName);
            var accrued = emp ? parseFloat(emp.reliabilityAccrued) : NaN;
            if (Number.isFinite(accrued)) {
                running += accrued;
                any = true;
            }
            return {
                quarter: qa.quarter,
                name: qa.name,
                label: qa.label,
                accrued: Number.isFinite(accrued) ? _round1(accrued) : null,
                runningTotal: any ? _round1(running) : null,
                hasValue: Number.isFinite(accrued)
            };
        });

        // The year's figure comes from the year-to-date upload when there is
        // one, and only falls back to adding the quarters up when there is
        // not.
        //
        // That upload IS the running total, published by the business, and it
        // is the source of truth everywhere else in this app. Summing quarters
        // can only match it when every quarter of the year is loaded: a
        // supervisor who started uploading in April gets a year figure missing
        // Q1 entirely, and it lands in the record as a bare number against an
        // annual allowance with nothing to say it is short.
        var summed = any ? _round1(running) : null;
        var fromYtd = _ytdReliabilityFor(employeeName, year);
        var total = Number.isFinite(fromYtd) ? _round1(fromYtd) : summed;
        var has = Number.isFinite(total);

        // The quarter by quarter running line is only shown when it actually
        // adds up to the year figure. A year-to-date upload that covers months
        // the quarters here do not would otherwise be followed by a sequence
        // climbing to a different number, and a record that disagrees with
        // itself in consecutive sentences is worse than one that says less.
        var reconciles = !Number.isFinite(fromYtd)
            || (Number.isFinite(summed) && Math.abs(summed - total) <= 0.5);

        // Inside that margin the quarters still land a few tenths away from
        // the file: a day of October in the year to date upload, or hours
        // re-coded after a quarter went up. Left alone the record said "16.5
        // hrs for the year to date" and then "16.8 hrs through Q3" in the
        // next sentence. The file is the record, so the check-in quarter's
        // running total takes its figure. If that would put the total below
        // the quarter before, nothing honest can be drawn and the line goes.
        //
        // The newest quarter WITH data, not simply the newest quarter. From
        // October 1 a year read without a check-in quarter ends on an empty
        // Q4, and the year end prompt was told "16.8 hrs through Q3, 16.8 hrs
        // through Q4" with nothing uploaded for Q4 at all. A quarter with no
        // upload has no running total to state.
        var lastIdx = -1;
        checkpoints.forEach(function (c, i) { if (c.hasValue) lastIdx = i; });
        for (var j = lastIdx + 1; j < checkpoints.length; j++) checkpoints[j].runningTotal = null;
        if (reconciles && Number.isFinite(fromYtd) && lastIdx >= 0) {
            var before = lastIdx > 0 ? checkpoints[lastIdx - 1].runningTotal : null;
            if (before !== null && total < before) reconciles = false;
            else checkpoints[lastIdx].runningTotal = total;
        }

        // The allowance is for a whole year, so it only means what it says
        // about somebody who was here for one.
        //
        // A July starter who burned 15 hours in a single quarter is on a pace
        // of sixty, and measured against the annual 18 they came out UNDER it,
        // so the document filed them under strengths and praised their
        // attendance. Whether a partial year earns a prorated allowance is a
        // policy question this code cannot answer, so nothing is prorated. The
        // verdict is withheld instead, and the sentence says which quarter the
        // hours start from so a reader can see it for themselves.
        // Only when the figure is the sum of the quarters on hand. A quarter
        // missing because nobody uploaded it and a quarter missing because the
        // associate was not here yet look identical from here, and the year to
        // date file tells them apart: if it supplied the number, it covers the
        // year by definition and the allowance applies normally.
        var withData = checkpoints.filter(function (c) { return c.hasValue; });
        var partialYear = !Number.isFinite(fromYtd)
            && withData.length > 0
            && withData.length < checkpoints.length;

        // The day the year figure runs through: the year to date file's end
        // when it supplied the number, otherwise the end of the newest quarter
        // that had hours. The recap email quotes the hours as of this date,
        // because the newest file can reach past the quarter being discussed.
        var through = null;
        if (Number.isFinite(fromYtd)) {
            var pc = (window.DevCoachModules || {}).periodCompare;
            through = pc && typeof pc.latestYtdThrough === 'function'
                ? pc.latestYtdThrough(parseInt(year, 10)) : null;
        } else if (lastIdx >= 0) {
            var lastQ = quarters[lastIdx];
            through = (lastQ && (lastQ.spanEnd || lastQ.endDate)) || null;
        }

        return {
            through: through,
            target: target,
            checkpoints: checkpoints,
            checkpointsReconcile: reconciles,
            partialYear: partialYear,
            quartersCovered: withData.length,
            quartersElapsed: checkpoints.length,
            firstQuarterWithData: withData.length ? withData[0] : null,
            yearToDate: total,
            summedFromQuarters: summed,
            fromYtdUpload: Number.isFinite(fromYtd),
            hasValue: has,
            meetsTarget: (has && !partialYear) ? _meetsTarget(target, total) : null,
            overBy: (has && target && total > target.value) ? _round1(total - target.value) : 0
        };
    }

    function _ytdReliabilityFor(employeeName, year) {
        var pc = (window.DevCoachModules || {}).periodCompare;
        if (!pc || typeof pc.latestYtdReliability !== 'function') return NaN;
        var map = pc.latestYtdReliability(parseInt(year, 10)) || {};
        var value = parseFloat(map[employeeName]);
        if (Number.isFinite(value)) return value;
        // The same person typed with other spacing or case, found the way the
        // recap's year to date column finds them, so the hours and that
        // column always come from the same row.
        if (typeof pc.latestYtdRow === 'function') {
            var found = pc.latestYtdRow(employeeName, parseInt(year, 10));
            var loose = found ? parseFloat(found.row.reliability) : NaN;
            if (Number.isFinite(loose)) return loose;
        }
        return NaN;
    }

    /* What this associate's document actually covers.
     *
     * Per associate, not per quarter. A quarter is "not empty" as soon as
     * anyone is in it, so a header built off that claimed the document covered
     * January through September for somebody who joined in July, and the dates
     * in a file note are the part a reader trusts without checking.
     */
    function _coverageFacts(quarters, employeeName) {
        var mine = quarters.filter(function (q) {
            return !!_findEmployee(q, employeeName);
        });
        return {
            quartersWithData: mine.length,
            quartersRequested: quarters.length,
            missing: quarters.filter(function (q) {
                return !_findEmployee(q, employeeName);
            }).map(function (q) { return q.name; }),
            spanStart: mine.length ? mine[0].spanStart || mine[0].startDate : null,
            spanEnd: mine.length ? mine[mine.length - 1].spanEnd || mine[mine.length - 1].endDate : null
        };
    }

    /* ── What the supervisor actually did ──
     *
     * Metrics alone make a scorecard, not a check-in. A record that says
     * handle time came down and never says it was coached twice reads as
     * something that happened to the associate rather than something they and
     * their supervisor worked on, and the second reading is the one a review
     * is for.
     *
     * Both stores are keyed by name and carry a date, so this is a count over
     * the quarter's span. Nothing is invented when a store is absent: the
     * counts come back zero and the sentence is not built.
     */
    function _supportFacts(employeeName, quarters) {
        var withData = quarters.filter(function (q) { return !q.empty; });
        var from = withData.length ? (withData[0].startDate || '') : '';
        var to = withData.length ? (withData[withData.length - 1].endDate || '') : '';
        var inSpan = function (dateText) {
            var d = String(dateText || '').slice(0, 10);
            return !!d && (!from || d >= from) && (!to || d <= to);
        };

        var history = (typeof coachingHistory !== 'undefined' ? coachingHistory : null)
            || (typeof window !== 'undefined' ? window.coachingHistory : null) || {};
        var sessions = (history[employeeName] || []).filter(function (entry) {
            return entry && inSpan(entry.generatedAt);
        });

        var metricsCoached = {};
        sessions.forEach(function (entry) {
            (entry.metricsCoached || []).forEach(function (key) { metricsCoached[key] = true; });
        });

        var logs = (typeof callListeningLogs !== 'undefined' ? callListeningLogs : null)
            || (typeof window !== 'undefined' ? window.callListeningLogs : null) || {};
        var calls = (Array.isArray(logs[employeeName]) ? logs[employeeName] : []).filter(function (entry) {
            return entry && inSpan(entry.listenedOn || entry.createdAt);
        });

        return {
            coachingSessions: sessions.length,
            metricsCoached: Object.keys(metricsCoached),
            callsReviewed: calls.length,
            spanStart: from,
            spanEnd: to
        };
    }

    /* One sentence, only when there is something to say. */
    function supportSentence(ctx) {
        var sup = ctx.support;
        if (!sup) return '';
        var parts = [];
        if (sup.coachingSessions > 0) {
            parts.push(sup.coachingSessions === 1
                ? 'one coaching conversation'
                : sup.coachingSessions + ' coaching conversations');
        }
        if (sup.callsReviewed > 0) {
            parts.push(sup.callsReviewed === 1
                ? 'one call reviewed together'
                : sup.callsReviewed + ' calls reviewed together');
        }
        if (!parts.length) return '';

        var joined = parts.length === 1 ? parts[0] : parts.join(' and ');
        // Said as the associate's effort, not the supervisor's activity log.
        // "Carlos and I have had 3 coaching conversations" is a count; "Carlos
        // has put real work in" is recognition, and on a hard quarter it may
        // be the only praise the box can honestly carry (Scott, 2026-10-14:
        // "Offer lots of kudos and praise"). One session is not "real work"
        // yet, so a single one is still said plainly.
        var total = (sup.coachingSessions || 0) + (sup.callsReviewed || 0);
        var line = total >= 2
            ? ctx.firstName + ' has put real work in, with ' + joined + ' over this stretch'
            : ctx.firstName + ' and I have had ' + joined + ' over this stretch';

        // Naming what was worked on is the part that makes the count mean
        // something, but only the ones this document already discusses, so it
        // cannot introduce a metric out of nowhere.
        var discussed = ctx.metrics.map(function (m) { return m.metricKey; });
        var named = sup.metricsCoached
            .filter(function (k) { return discussed.indexOf(k) >= 0; })
            .map(function (k) { return _label(k).toLowerCase(); });
        if (named.length === 1) line += ', on ' + named[0];
        else if (named.length === 2) line += ', on ' + named[0] + ' and ' + named[1];
        else if (named.length > 2) line += ', on ' + named.slice(0, -1).join(', ') + ' and ' + named[named.length - 1];

        return line + '.';
    }

    /* ── Sorting the facts into the two boxes ── */

    /* Box 1 takes what is going well: at target, or moved the right way by
     * enough to be worth naming. Box 2 takes what is not, worst first, where
     * worst means below target and still going the wrong way.
     */
    function splitForBoxes(ctx) {
        var strengths = [];
        var focus = [];
        var watch = [];

        ctx.metrics.forEach(function (m) {
            var moved = m.movedAcross;
            // A move inside the noise band is not a direction. Without the
            // band, transfers going 6.9% to 7.0% ranked as "missed and
            // falling" and led the focus box, while the sentence written about
            // it said, correctly, that it held steady.
            var clear = moved && moved.size > _stableBand(m.metricKey);
            var improving = clear && moved.improved === true;
            var declining = clear && moved.improved === false;

            if (m.meetsTarget === true) {
                strengths.push(Object.assign({}, m, {
                    why: improving ? 'improved-and-met' : 'met'
                }));
                // At goal and still sliding is worth raising in the meeting
                // even though nothing is missed yet. A quarter of the same
                // again and it is a miss, and the supervisor who says so now
                // is not the one writing it up in January.
                if (declining) {
                    var points = m.usablePoints && m.usablePoints.length ? m.usablePoints : m.series.measured;
                    var kind = points.length >= 2 ? _pathShape(m, points).kind : null;
                    if (kind === 'falling' || kind === 'fell') {
                        watch.push(Object.assign({}, m, { why: 'met-but-falling' }));
                    }
                }
                return;
            }
            if (m.meetsTarget === false) {
                focus.push(Object.assign({}, m, {
                    why: declining ? 'missed-and-falling' : improving ? 'missed-but-rising' : 'missed'
                }));
                return;
            }
            // No target configured. A clear improvement is still worth saying.
            if (improving && moved.size > 0) {
                strengths.push(Object.assign({}, m, { why: 'improved' }));
            }
        });

        // Missed hours inside the allowance are a strength. Over it, or on a
        // partial year with no verdict, they go in neither box, because areas
        // of focus do not reference reliability (Scott, on 2026-10-05). Hours
        // over the allowance used to lead the focus box; that is reversed, and
        // the focus box is the rates alone.
        //
        // Inside the allowance is only praise when the hours are also inside
        // an even share of it, the rule the talking points already used. 16.5
        // of 18 with a quarter still to go is inside, and the strengths box
        // was praising it as "Eli has missed 16.5 hrs" (Scott, 2026-10-14).
        var rel = ctx.reliability;
        if (_hoursOnPace(rel, ctx)) {
            strengths.push({ metricKey: RELIABILITY, label: _label(RELIABILITY), why: 'met', reliability: rel });
        }

        // Below goal and moving the right way. Still a focus, because it is
        // still short, but also progress worth crediting. Carlos lifted rep
        // satisfaction to its best quarter of the year, and the box that is
        // meant to say so said "held the quarter steady" (Scott, 2026-10-14).
        var progress = [];
        focus.forEach(function (m) {
            var p = _progressFor(m);
            if (p) progress.push(Object.assign({}, m, { progress: p }));
        });

        var focusRank = { 'missed-and-falling': 0, 'missed': 1, 'missed-but-rising': 2 };
        // A reading from an earlier quarter, because the check-in quarter had
        // too few surveys to quote. It is still true, but a Q3 check-in that
        // leads on a Q2 number is talking about the wrong quarter.
        // Only when the check-in quarter has readings at all: with nothing in
        // it every metric is equally old, and demoting all of them just
        // promoted whatever was exempt.
        var currentName = ctx.current ? ctx.current.name : null;
        var anyCurrent = ctx.metrics.some(function (m) { return m.latestQuarter === currentName; });
        var stale = function (m) {
            return anyCurrent && m.metricKey !== RELIABILITY && !!m.latestQuarter && m.latestQuarter !== currentName;
        };
        focus.sort(function (a, b) {
            if (stale(a) !== stale(b)) return stale(a) ? 1 : -1;
            var ra = focusRank[a.why] === undefined ? 1 : focusRank[a.why];
            var rb = focusRank[b.why] === undefined ? 1 : focusRank[b.why];
            if (ra !== rb) return ra - rb;
            // Then by how badly it missed. Returning 0 here left the order to
            // the metric registry, so a metric missing by a tenth of a point
            // was raised ahead of one missing by forty, purely because handle
            // time is declared before first call resolution. Only two make it
            // into the box, so that decided which gaps a supervisor saw.
            return _missSeverity(b) - _missSeverity(a);
        });

        var strengthRank = { 'improved-and-met': 0, 'met': 1, 'improved': 2 };
        // A perfect score in every quarter leads: it is the headline, and in
        // registry order it sat behind handle time and adherence. Then the
        // four KPIs a review is about ahead of the rest at the same rank, so
        // transfers never takes the lead sentence from adherence. Hours stay
        // last whatever their rank: they are said in a line of their own.
        var rankOf = function (m) {
            if (m.metricKey === RELIABILITY) return 9;
            if (_isPerfect(m)) return -1;
            return strengthRank[m.why] === undefined ? 1 : strengthRank[m.why];
        };
        var coreOf = function (m) { return CORE_METRICS.indexOf(m.metricKey) >= 0 ? 0 : 1; };
        strengths.sort(function (a, b) {
            var ra = rankOf(a), rb = rankOf(b);
            if (ra !== rb) return ra - rb;
            return coreOf(a) - coreOf(b);
        });

        // Biggest slide first: if only one is going to be raised, raise that.
        watch.sort(function (a, b) {
            var sa = a.movedAcross ? a.movedAcross.size : 0;
            var sb = b.movedAcross ? b.movedAcross.size : 0;
            return sb - sa;
        });

        // The four KPIs first, so a rise in rep satisfaction is credited
        // ahead of one in first call resolution; then the focus box's order.
        var focusOrder = focus.map(function (m) { return m.metricKey; });
        progress.sort(function (a, b) {
            var ca = CORE_METRICS.indexOf(a.metricKey) >= 0 ? 0 : 1;
            var cb = CORE_METRICS.indexOf(b.metricKey) >= 0 ? 0 : 1;
            if (ca !== cb) return ca - cb;
            return focusOrder.indexOf(a.metricKey) - focusOrder.indexOf(b.metricKey);
        });

        return { strengths: strengths, focus: focus, watch: watch, progress: progress };
    }

    /* Missed hours worth opening on: inside the allowance AND inside an even
     * share of it for the quarters gone. */
    function _hoursOnPace(rel, ctx) {
        if (!rel || !rel.hasValue || rel.meetsTarget !== true || !rel.target) return false;
        return rel.yearToDate <= rel.target.value * Math.min(ctx.quarter, 4) / 4 + 0.05;
    }

    /* A survey score of 100% in every quarter it was read. */
    function _isPerfect(m) {
        if (!m || m.isReverse || (_registry()[m.metricKey] || {}).unit !== '%') return false;
        var points = m.usablePoints && m.usablePoints.length ? m.usablePoints : m.series.measured;
        return points.length > 0 && points.every(function (p) { return _display(m.metricKey, p.value) === '100%'; });
    }

    /* Whether a metric below goal is moving the right way, and how to say it.
     *
     * Three shapes count, each measured on the printed numbers:
     *   every  improved in every quarter, three or more of them, by at least
     *          half the noise band overall (446s, 442s, 439s);
     *   best   the newest quarter is the best of the year and clearly better
     *          than the one before (74.2%, 71.9%, 76.5%);
     *   year   clearly better than where the year started, without the
     *          newest quarter giving a clear amount of it back.
     * Anything else is not credited. A rise that slipped back in the newest
     * quarter is the same thing the recap email declines to call a move.
     */
    function _progressFor(m) {
        if (!m || m.meetsTarget !== false) return null;
        var points = m.usablePoints && m.usablePoints.length ? m.usablePoints : m.series.measured;
        if (points.length < 2) return null;
        var mm = (window.DevCoachModules || {}).metricMovement;
        var better = function (a, b) {
            var pa = printedValue(m.metricKey, a.value);
            var pb = printedValue(m.metricKey, b.value);
            var d = mm && typeof mm.performanceDelta === 'function'
                ? mm.performanceDelta(m.metricKey, pa, pb)
                : (m.isReverse ? pb - pa : pa - pb);
            return Number.isFinite(d) ? d : 0;
        };
        var gapOf = function (a, b) {
            return Math.abs(printedValue(m.metricKey, a.value) - printedValue(m.metricKey, b.value));
        };
        var band = _stableBand(m.metricKey);
        var first = points[0];
        var last = points[points.length - 1];
        var prev = points[points.length - 2];

        var path = _pathShape(m, points);
        if (points.length >= 3 && path.kind === 'climbing' && gapOf(last, first) >= band / 2) {
            return { kind: 'every', from: first, to: last };
        }
        var isBest = points.every(function (p) { return p === last || better(last, p) > 0; });
        if (points.length >= 2 && better(last, prev) > 0 && gapOf(last, prev) > band && isBest) {
            return { kind: 'best', from: prev, to: last, ofYear: points.length >= 3 };
        }
        var gaveBack = better(last, prev) < 0 && gapOf(last, prev) > band;
        if (better(last, first) > 0 && gapOf(last, first) > band && !gaveBack) {
            return { kind: 'year', from: first, to: last };
        }
        return null;
    }

    /* The progress, as box 1 credits it. Active voice, the associate as the
     * subject: it is their work that moved it. A second one in the same box
     * leads on the metric instead, so two sentences in a row do not both
     * open "Carlos lifted". */
    function progressSentence(m, ctx, index) {
        var p = m.progress || _progressFor(m);
        if (!p) return '';
        var name = ctx.firstName;
        var label = m.label.toLowerCase();
        var from = _display(m.metricKey, p.from.value) + ' in ' + p.from.name;
        var to = _display(m.metricKey, p.to.value) + ' in ' + p.to.name;
        if (index > 0) {
            var also = _cap(label) + (m.isReverse ? ' also came down' : ' also came up');
            if (p.kind === 'every') return also + ' in every quarter, from ' + from + ' to ' + to + '.';
            if (p.kind === 'best') return also + ', from ' + from + ' to ' + to + (p.ofYear ? ', its best quarter of the year.' : '.');
            return also + ' over the year, from ' + from + ' to ' + to + '.';
        }
        if (p.kind === 'every') {
            return m.isReverse
                ? name + ' brought ' + label + ' down in every quarter this year, from ' + from + ' to ' + to + '.'
                : name + ' lifted ' + label + ' in every quarter this year, from ' + from + ' to ' + to + '.';
        }
        var verb = m.isReverse ? ' brought ' + label + ' down from ' : ' lifted ' + label + ' from ';
        if (p.kind === 'best') {
            return name + verb + from + ' to ' + to + (p.ofYear ? ', the best quarter of the year.' : '.');
        }
        return name + (m.isReverse ? ' has brought ' + label + ' down from ' : ' has lifted ' + label + ' from ')
            + from + ' to ' + to + '.';
    }

    /* ── The sentences ── */

    /* "451s in Q1, 438s in Q2, and 421s in Q3" */
    function progressionPhrase(metricKey, points) {
        var parts = points.map(function (p) {
            return _display(metricKey, p.value) + ' in ' + p.name;
        });
        if (parts.length === 1) return parts[0];
        if (parts.length === 2) return parts[0] + ' and then ' + parts[1];
        return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
    }

    function targetPhrase(metricKey, target) {
        if (!target) return '';
        var goal = _display(metricKey, target.value);
        return target.type === 'min'
            ? 'against a goal of ' + goal + ' or better'
            : 'against a goal of ' + goal + ' or lower';
    }

    /* Where the metric sat against goal in each quarter, as a shape.
     *
     * Movement alone is not the story a record needs. A rate that fell five
     * points while staying above goal and a rate that fell five points THROUGH
     * the goal are different facts, and the second one is the one that belongs
     * in a file. Describing only the movement says "five points further from
     * goal" about a metric that started above it, which is simply untrue.
     */
    function _goalStory(m) {
        var points = m.usablePoints && m.usablePoints.length ? m.usablePoints : m.series.measured;
        if (!m.target || points.length === 0) return { shape: 'unknown', points: points };
        var met = points.map(function (p) { return _meetsTarget(m.target, p.value); });
        var firstMet = met[0];
        var lastMet = met[met.length - 1];

        if (met.every(Boolean)) return { shape: 'always', points: points, met: met };
        if (met.every(function (v) { return v === false; })) return { shape: 'never', points: points, met: met };

        if (!firstMet && lastMet) {
            var upAt = met.indexOf(true);
            return { shape: 'crossed-up', points: points, met: met, at: points[upAt] };
        }
        if (firstMet && !lastMet) {
            var downAt = met.indexOf(false);
            var firstBelow = points[downAt];
            var onlyLast = met.lastIndexOf(true) === met.length - 2;
            return {
                shape: 'crossed-down', points: points, met: met,
                at: firstBelow, onlyLast: onlyLast
            };
        }
        return { shape: 'mixed', points: points, met: met };
    }

    /* The SHAPE of the path, not just its endpoints.
     *
     * Direction is computed from the first quarter against the last, which is
     * the right thing for a headline and the wrong thing for a sentence. An
     * associate who went 420, 470, 418 has a first and last two seconds apart,
     * so endpoint logic called that "came down in each quarter this year" and
     * called 95, 88, 95 "held steady". Both of those are false statements in a
     * personnel record, and the second one erases the quarter worth talking
     * about.
     *
     * So the steps are walked. A claim about every quarter is only made when
     * every quarter supports it, and a path that reversed is described as a
     * path that reversed.
     */
    function _pathShape(m, points) {
        var mm = (window.DevCoachModules || {}).metricMovement;
        var band = _stableBand(m.metricKey);
        var steps = [];
        var held = false;
        for (var i = 1; i < points.length; i++) {
            // Two quarters that read the same on the page did not move. 100%,
            // 100%, 66.7% was written up as "slipped in each quarter", with
            // the numbers beside it showing Q2 did not.
            if (_display(m.metricKey, points[i].value) === _display(m.metricKey, points[i - 1].value)) {
                steps.push(0);
                held = true;
                continue;
            }
            var better = mm && typeof mm.performanceDelta === 'function'
                ? mm.performanceDelta(m.metricKey, points[i].value, points[i - 1].value)
                : points[i].value - points[i - 1].value;
            steps.push(Number.isFinite(better) ? better : 0);
        }

        var values = points.map(function (p) { return p.value; });
        var spread = Math.max.apply(null, values) - Math.min.apply(null, values);
        if (spread <= band) {
            // Every step the right way is a direction even inside the band.
            // Handle time of 446s, 442s, 439s came down every quarter, and
            // the record called it "held steady" because the whole run fit
            // inside 8 seconds (Scott, 2026-10-14). Only the good direction
            // is lifted out of the band: a 0.2 point wobble down while at goal
            // is still noise, and is not written up as a slide.
            var everyBetter = steps.length >= 2 && steps.every(function (s) { return s > 0; });
            if (everyBetter) return { kind: 'climbing', steps: steps, spread: spread, insideBand: true };
            return { kind: 'steady', steps: steps, spread: spread };
        }

        // "Each quarter" only when every quarter moved. One that held makes
        // it a rise or a fall over the year, still one way, not every step.
        var improvedAny = steps.some(function (s) { return s > 0; });
        var worsenedAny = steps.some(function (s) { return s < 0; });
        if (improvedAny && !worsenedAny) return { kind: held ? 'rose' : 'climbing', steps: steps, spread: spread };
        if (worsenedAny && !improvedAny) return { kind: held ? 'fell' : 'falling', steps: steps, spread: spread };

        // It reversed. The quarter worth naming is the one furthest the wrong
        // way, and it is only worth naming when it is not an endpoint: an
        // endpoint is already the start or the finish of the sentence.
        var worstIdx = 0;
        for (var j = 1; j < points.length; j++) {
            var cmp = mm && typeof mm.performanceDelta === 'function'
                ? mm.performanceDelta(m.metricKey, points[j].value, points[worstIdx].value)
                : points[j].value - points[worstIdx].value;
            if (Number.isFinite(cmp) && cmp < 0) worstIdx = j;
        }
        // "Finished close to where the year started" is only true when it did.
        // Close is the noise band, or a quarter of the swing when the swing is
        // large: 82, 55, 83 came back, but 4.4%, 6.4%, 6.1% transfers did not,
        // and the record said it had.
        var net = Math.abs(values[values.length - 1] - values[0]);
        return {
            kind: 'swung',
            steps: steps,
            spread: spread,
            worst: points[worstIdx],
            worstIsInterior: worstIdx > 0 && worstIdx < points.length - 1,
            endsClose: net <= Math.max(band, spread / 4)
        };
    }

    function _stableBand(metricKey) {
        var mm = (window.DevCoachModules || {}).metricMovement;
        var bands = (mm && mm.DEFAULT_STABLE_BAND) || { percent: 1, sec: 8, hrs: 0.5, fallback: 1 };
        var unit = (_registry()[metricKey] || {}).unit;
        if (unit === '%') return bands.percent;
        if (unit === 'sec') return bands.sec;
        if (unit === 'hrs') return bands.hrs;
        return bands.fallback;
    }

    /* One metric, as prose.
     *
     * Three depths, because a box that gives every metric the same three
     * sentences reads as a form someone filled in rather than notes someone
     * wrote. The metric that matters most gets the movement, the amount and
     * the standing; the next gets the movement and the standing; the rest are
     * a clause apiece.
     */
    function metricSentence(m, ctx, depth) {
        if (m.metricKey === RELIABILITY) return reliabilitySentence(ctx.reliability, ctx);

        var style = depth || 'lead';
        var points = m.usablePoints && m.usablePoints.length ? m.usablePoints : m.series.measured;
        if (!points.length) return '';
        var label = m.label.toLowerCase();
        var story = _goalStory(m);
        var moved = m.movedAcross;
        var lines = [];

        // A full score is said as one. "Rep satisfaction held steady across
        // the year, 100% in Q3, inside the 82% goal" undersold three perfect
        // quarters as a metric that merely did not move (Scott, 2026-10-14).
        if (_isPerfect(m)) {
            return points.length < 2
                ? _cap(label) + ' for ' + points[0].name + ' was a perfect 100%.'
                : _cap(label) + ' was a perfect 100% in every quarter this year.';
        }

        if (points.length < 2) {
            lines.push(_cap(label) + ' for ' + points[0].name + ' was '
                + _display(m.metricKey, points[0].value) + ', '
                + targetPhrase(m.metricKey, m.target) + '.');
            return lines.join(' ');
        }

        var path = _pathShape(m, points);
        // "held steady" went out 83 times in 42 documents, three times in one
        // document in 22 of them (tone audit, 2026-10-25). Picked off the
        // metric and its numbers, so one document's metrics differ and a
        // rebuilt note reads the same.
        var steadySeed = m.metricKey + '|' + points.map(function (p) { return p.value; }).join(',');
        var movementWord;
        if (path.kind === 'steady') movementWord = _pick(STEADY_WORDS, steadySeed);
        else if (path.kind === 'climbing') movementWord = m.isReverse ? 'came down in each quarter this year' : 'improved in each quarter this year';
        else if (path.kind === 'falling') movementWord = m.isReverse ? 'climbed in each quarter this year' : 'slipped in each quarter this year';
        else if (path.kind === 'rose') movementWord = m.isReverse ? 'came down this year' : 'improved this year';
        else if (path.kind === 'fell') movementWord = m.isReverse ? 'climbed this year' : 'slipped this year';
        else movementWord = 'moved around this year';

        if (style === 'brief') {
            // "Went from 90% to 90%" is a sentence nobody writes. A metric
            // that did not move gets said as a metric that did not move.
            if (path.kind === 'steady') {
                // "Both inside the goal" needs two readings to refer to. A
                // metric that held gets the singular tail instead. The figure
                // is the newest quarter's, said as such: "held at 95.7% across
                // the year" about 95.2%, 95.0%, 95.7% claims two readings that
                // were not taken.
                var newest = points[points.length - 1];
                lines.push(_cap(label) + ' ' + _pick(STEADY_YEAR_WORDS, steadySeed) + ', '
                    + _display(m.metricKey, newest.value) + ' in ' + newest.name
                    + _goalTail(story, m, 'steady') + '.');
            } else {
                lines.push(_cap(label) + ' went from '
                    + _display(m.metricKey, points[0].value) + ' in ' + points[0].name
                    + ' to ' + _display(m.metricKey, points[points.length - 1].value)
                    + ' in ' + points[points.length - 1].name + _goalTail(story, m, 'brief') + '.');
            }
            return lines.join(' ');
        }

        // Support depth closes on the same sentence. Split off into its own it
        // becomes "Which moved it inside the goal in Q2", a fragment, and three
        // of those in a row is what makes a document read as generated.
        if (style !== 'lead') {
            lines.push(_cap(label) + ' ' + movementWord + ', '
                + progressionPhrase(m.metricKey, points) + _goalTail(story, m, 'support') + '.');
            return lines.join(' ');
        }

        lines.push(_cap(label) + ' ' + movementWord + ', '
            + progressionPhrase(m.metricKey, points) + '.');

        // A path that reversed gets its outlier named rather than a net change
        // that hides it. Two seconds between January and September is not the
        // story when one quarter was fifty seconds off.
        // The support tail, not the lead one: "after a dip to 54.5% in Q2,
        // which moved it inside the goal" credits the dip with the recovery.
        if (path.kind === 'swung' && path.worstIsInterior && path.endsClose) {
            lines.push(_cap(_swingNote(m, path, ctx)) + _goalTail(story, m, 'support') + '.');
        // "Held steady" and "that is 3 points better than where they started"
        // contradict each other inside one paragraph. A move small enough to
        // call steady is a move too small to then quantify as progress, and
        // that holds for the net of a path that wandered: 91.8%, 93.6%, 92.3%
        // is not "0.5 points better than where they started".
        } else if (path.kind !== 'steady' && moved && moved.size > _stableBand(m.metricKey)) {
            lines.push('That is ' + _movementAmount(m.metricKey, moved.size)
                + (moved.improved === true ? ' better than' : ' off')
                + ' where ' + ctx.firstName + ' started the year'
                + _goalTail(story, m, 'lead') + '.');
        } else {
            var tail = _goalTail(story, m, 'support');
            // Appended, not promoted into its own sentence: on its own it reads
            // "Every quarter of it inside the goal", which has no verb.
            if (tail) {
                lines[lines.length - 1] = lines[lines.length - 1].replace(/\.$/, '') + tail + '.';
            }
        }

        return lines.join(' ');
    }

    function _swingNote(m, path, ctx) {
        var worst = path.worst;
        var word = m.isReverse ? 'a spike to ' : 'a dip to ';
        return ctx.firstName + ' finished close to where the year started, after '
            + word + _display(m.metricKey, worst.value) + ' in ' + worst.name;
    }

    /* The clause that says where the movement left it against goal.
     *
     * Worded differently at each depth on purpose. The same clause repeated
     * down a box is the tell that nobody wrote it.
     */
    function _goalTail(story, m, style) {
        if (!m.target) return '';
        var goal = _display(m.metricKey, m.target.value);
        var last = story.points[story.points.length - 1];
        var lastName = last ? last.name : m.latestQuarter;

        switch (story.shape) {
            case 'always':
                if (style === 'steady') return ', inside the ' + goal + ' goal';
                if (style === 'brief') return ', both inside the ' + goal + ' goal';
                if (style === 'support') {
                    return _pick([', every quarter of it inside the ' + goal + ' goal',
                        ', inside the ' + goal + ' goal in every quarter'], m.metricKey + '|' + lastName + '|' + goal + '|' + (last ? last.value : ''));
                }
                return ', and it has stayed inside the ' + goal + ' goal all year';
            case 'never':
                var off = _movementAmount(m.metricKey, m.gap ? m.gap.size : 0);
                // "Short of" means below, which is the wrong word entirely for
                // a metric where lower is better: handle time at 475 against a
                // 426 goal is 49 seconds ABOVE it, not short of it.
                var side = m.isReverse ? ' above the ' : ' short of the ';
                if (style === 'brief') return ', still outside the ' + goal + ' goal';
                if (style === 'support') return ', leaving it ' + off + side + goal + ' goal';
                return ', and it is still ' + off + side + goal + ' goal';
            case 'crossed-up':
                if (style === 'brief') return ', clearing the ' + goal + ' goal in ' + story.at.name;
                // "Has been inside since Q3" when Q3 is the newest quarter
                // claims a run that is one reading long.
                if (style === 'support' && story.at === last) {
                    return ', and ' + lastName + ' is the first quarter inside the ' + goal + ' goal';
                }
                if (style === 'support') return ', and it has been inside the ' + goal + ' goal since ' + story.at.name;
                return ', which moved it inside the ' + goal + ' goal in ' + story.at.name;
            case 'crossed-down':
                // "Under the goal" is failure for adherence and success for
                // handle time. Said of a reverse metric that blew its ceiling
                // it is not merely the wrong word, it reports the miss as good
                // news: 470s against a 426s goal came out as "it has been under
                // the 426s goal since Q2".
                var past = _missSide(m);
                if (story.onlyLast) {
                    if (style === 'brief') return ', going ' + past + ' the ' + goal + ' goal in ' + lastName;
                    return ', and ' + lastName + ' is the first quarter ' + past + ' the ' + goal + ' goal';
                }
                if (style === 'brief') return ', ' + past + ' the ' + goal + ' goal since ' + story.at.name;
                return ', and it has been ' + past + ' the ' + goal + ' goal since ' + story.at.name;
            case 'mixed':
                if (m.meetsTarget) return ', and it is back inside the ' + goal + ' goal';
                return ', and it is ' + _missSide(m) + ' the ' + goal + ' goal';
            default:
                return '';
        }
    }

    function _cap(text) {
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
    }

    /* Which side of its goal a missing metric sits on.
     *
     * A goal is a floor for most metrics and a ceiling for handle time,
     * transfers and missed hours, so there is no single word for missing one.
     * Adherence misses by falling below 93%; handle time misses by climbing
     * above 426s.
     */
    function _missSide(m) {
        return m && m.isReverse ? 'above' : 'below';
    }

    /* How badly a metric missed, on a scale the metrics share.
     *
     * Raw gaps are not comparable: 40 seconds of handle time and 4 points of
     * adherence are different units and different severities. The gap as a
     * fraction of the goal puts them on one scale well enough to decide which
     * of two misses a supervisor should be shown first.
     */
    /* The metric sitting furthest clear of its goal.
     *
     * By margin as a fraction of the goal, so seconds and percentage points
     * are comparable, which is the same scale _missSeverity uses at the other
     * end.
     */
    function _strongest(strengths) {
        // Drawn from the KPIs a review is actually about. Transfers has the
        // most generous goal of the set, so by raw margin it won for almost
        // everybody, and "transfers the furthest clear of it" is not the line
        // a supervisor would open with about a good quarter.
        var pick = function (pool) {
            var best = null;
            var bestMargin = -1;
            pool.forEach(function (m) {
                if (m.metricKey === RELIABILITY) return;
                if (!m.target || !Number.isFinite(m.latestValue)) return;
                var goal = Math.abs(m.target.value);
                if (!goal) return;
                var margin = Math.abs(m.latestValue - m.target.value) / goal;
                if (margin > bestMargin) { bestMargin = margin; best = m; }
            });
            return best;
        };
        var all = strengths || [];
        var core = all.filter(function (m) { return CORE_METRICS.indexOf(m.metricKey) >= 0; });
        return pick(core) || pick(all);
    }

    function _missSeverity(m) {
        if (!m || !m.gap || !m.target) return 0;
        var goal = Math.abs(m.target.value);
        if (!goal) return m.gap.size;
        return m.gap.size / goal;
    }

    /* Missed hours, always as the year's running total.
     *
     * The per quarter figures are the running total at each quarter's close,
     * not the hours belonging to that quarter, so the sentence reads as one
     * number growing rather than three separate ones.
     */
    function reliabilitySentence(rel, ctx) {
        if (!rel || !rel.hasValue) return '';
        var name = ctx.firstName;
        var target = rel.target;
        var goalText = target ? _display(RELIABILITY, target.value) : '';
        var lines = [];

        // A partial year says which quarter it starts from. Fifteen hours
        // reads as comfortable against an annual eighteen and reads as a
        // problem when it happened in one quarter, and the only difference on
        // the page is this clause.
        if (rel.partialYear && rel.firstQuarterWithData) {
            var span = rel.quartersCovered === 1
                ? 'in ' + rel.firstQuarterWithData.name
                : 'since ' + rel.firstQuarterWithData.name;
            lines.push(name + ' has missed ' + _display(RELIABILITY, rel.yearToDate)
                + ' ' + span
                + (target ? ', against an allowance of ' + goalText + ' for a full year' : '') + '.');
        } else {
            lines.push(name + ' has missed ' + _display(RELIABILITY, rel.yearToDate)
                + ' for the year to date'
                + (target ? ', against an allowance of ' + goalText + ' for the year' : '') + '.');
        }

        var withValues = rel.checkpoints.filter(function (c) { return c.runningTotal !== null; });
        if (rel.checkpointsReconcile && withValues.length >= 2) {
            var parts = withValues.map(function (c) {
                return _display(RELIABILITY, c.runningTotal) + ' through ' + c.name;
            });
            lines.push('That was '
                + (parts.length === 2
                    ? parts[0] + ' and ' + parts[1]
                    : parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1])
                + '.');
        }

        if (rel.meetsTarget === false && rel.overBy > 0) {
            var left = _quartersLeftPhrase(ctx);
            lines.push(left
                ? 'That puts the year ' + _display(RELIABILITY, rel.overBy)
                    + ' over the allowance with ' + left + ' to go.'
                : 'That closed the year ' + _display(RELIABILITY, rel.overBy)
                    + ' over the allowance.');
        }
        return lines.join(' ');
    }

    /* How much year is left, as a noun phrase, or null when none is.
     *
     * This used to return "the year closed" for a Q4 check-in, which every
     * caller then dropped into a sentence built around a span of time: "with
     * the year closed to go", "visible movement over the year closed". Four
     * broken sentences, in every Q4 document, which is the one that matters
     * most. A Q4 check-in has no quarters left, so callers say something else
     * rather than pushing a sentence fragment through the same slot.
     */
    function _quartersLeftPhrase(ctx) {
        var left = 4 - ctx.quarter;
        if (left <= 0) return null;
        return left === 1 ? 'one quarter' : left + ' quarters';
    }

    /* ── The finished notes ── */

    /* Two boxes of finished prose, plus the header a file note carries.
     *
     * The caller gets the boxes separately because Success Factors takes them
     * as two fields, and the joined version because the whole thing is also
     * worth having on a clipboard.
     */
    function buildNotes(ctx, options) {
        var opts = options || {};
        var split = splitForBoxes(ctx);
        var seed = ctx.name + '|' + ctx.year + '|' + ctx.quarter;

        // A metric raised as a slide in the focus box is not also given the
        // full treatment in the strengths box. Saying the same three
        // sentences twice in one document is how a reader stops reading.
        var raisedAsSlide = (!split.focus.length && split.watch.length)
            ? split.watch[0].metricKey : null;

        // Rates only. Hours inside an even share of the allowance get a line
        // of their own below, worded as the praise it is.
        var rated = split.strengths.filter(function (m) {
            return m.metricKey !== raisedAsSlide && m.metricKey !== RELIABILITY;
        });

        // Depth falls away down the list. The first strength is the one the
        // supervisor would lead with in the room, the third is a clause, and
        // the rest are named together at the end. Capped at four, the box
        // used to drop the fifth outright, which is how a 96.5% adherence
        // went unmentioned in a strengths box (Scott, 2026-10-14).
        var strengthLines = rated.slice(0, 3).map(function (m, i) {
            return metricSentence(m, ctx, i === 0 ? 'lead' : i === 1 ? 'support' : 'brief');
        }).filter(Boolean);
        var also = _alsoClause(rated.slice(3));

        // Only the progress box 1 actually credits counts as said, so box 2
        // never shortens a metric whose rise was not mentioned.
        var credited = split.progress.slice(0, 2);
        var progressKeys = credited.map(function (m) { return m.metricKey; });
        var progressLines = credited
            .map(function (m, i) { return progressSentence(m, ctx, i); })
            .filter(Boolean);
        var hours = _hoursPraise(split.strengths, ctx);
        var support = supportSentence(ctx);

        // Box 1 opens on the person, then the numbers. Four sentences of
        // figures with no recognition word in them read as a printout, not
        // as a supervisor who noticed (Scott, 2026-10-14).
        var box1Parts = [_openingLine(ctx, rated.length, split.focus.length, seed)]
            .concat(strengthLines, [also], progressLines, [hours]);
        // Nothing at goal and nothing rising. The box used to say "held the
        // quarter steady with no metric moving far in either direction",
        // which was false whenever something had moved, and was printed
        // directly above "handle time climbed in each quarter". The measure
        // nearest its goal is a true thing to build from instead.
        if (!rated.length && !progressLines.length) box1Parts.push(_closestLine(split.focus, ctx));
        // The work behind the numbers, ahead of the supervisor's own note.
        box1Parts.push(support);
        if (opts.notes) box1Parts.push(String(opts.notes).trim());
        var box1 = box1Parts.filter(Boolean).join(' ');

        var shown = split.focus.slice(0, 2);
        var focusLines = shown.map(function (m, i) {
            // Credited as progress in box 1 already, so box 2 says where it
            // stands rather than walking the same quarters a second time.
            if (progressKeys.indexOf(m.metricKey) >= 0) return _standingSentence(m);
            if (_isFirstDip(m)) return _firstDipSentence(m);
            return metricSentence(m, ctx, i === 0 ? 'lead' : 'support');
        }).filter(Boolean);

        var next = _nextQuarterName(ctx);
        var box2Parts = [];
        if (focusLines.length) {
            box2Parts.push(focusLines.join(' '));
            box2Parts.push(_focusClose(shown, ctx, progressKeys, seed));
        } else if (split.watch.length) {
            // Nothing missed, but something is sliding toward a miss. That is
            // the conversation worth having now, and "everything is at goal"
            // would bury it.
            var slide = split.watch[0];
            box2Parts.push('Every performance metric is at goal for ' + ctx.quarterLabel + '.');
            box2Parts.push(metricSentence(slide, ctx, 'lead'));
            box2Parts.push('It is still at goal, so this is one to watch rather than fix, and the aim '
                + (next ? 'for ' + next : 'going into next year') + ' is to stop the slide.');
        } else {
            // Named rather than left generic. Every associate with a clean
            // quarter was getting a byte identical focus box, and a file note
            // that could have been written about anybody reads as one that was.
            var best = _strongest(split.strengths);
            var opening = 'Every performance metric is at goal for ' + ctx.quarterLabel;
            if (best) {
                opening += ', ' + best.label.toLowerCase() + ' the furthest clear of it at '
                    + _display(best.metricKey, best.latestValue);
            }
            // "The focus for the rest of the year is holding that through one
            // quarter" went into every clean document word for word.
            box2Parts.push(opening + '. ' + _pick(next
                ? [next + ' is about keeping this going.',
                    'The goal for ' + next + ' is more of the same.',
                    next + ' is about holding this level through the end of the year.']
                : ['The goal going into next year is to keep this going.',
                    'Next year is about carrying this forward.'], seed));
        }
        var box2 = box2Parts.filter(Boolean).join(' ');

        var header = buildHeader(ctx);
        return {
            header: header,
            box1: box1,
            box2: box2,
            strengths: split.strengths,
            focus: split.focus,
            progress: split.progress,
            full: header + '\n\nPROGRESS AND STRENGTHS\n' + box1
                + '\n\nAREAS OF FOCUS\n' + box2 + '\n'
        };
    }

    /* The first line of box 1: the person, recognised, before any number.
     * Scaled to how much of the year is at goal, and never a grade. */
    function _openingLine(ctx, ratedCount, focusCount, seed) {
        if (!ratedCount) return '';
        var n = ctx.firstName;
        var done = ctx.quarter >= 4;
        if (!focusCount) {
            return _pick(done
                ? [n + ' had a great year, and it shows in every measure.',
                    'There is a lot to recognize in ' + n + '\'s year.']
                : [n + ' is having a great year, and it shows in every measure.',
                    'There is a lot to recognize in ' + n + '\'s year so far.'], seed);
        }
        if (ratedCount >= focusCount) {
            return _pick([n + ' has a lot to be proud of this year.',
                'There is plenty in ' + n + '\'s year to be proud of.'], seed);
        }
        return _pick([n + ' has real strengths to build on this year.',
            n + ' has solid ground to build on this year.'], seed);
    }

    /* "Schedule adherence (96.5%), transfers (4%) and overall experience
     * (80%) were also inside goal all year." The strengths past the third,
     * named rather than dropped. */
    function _alsoClause(rest) {
        if (!rest || !rest.length) return '';
        var parts = rest.map(function (m, i) {
            var label = m.label.toLowerCase();
            return (i === 0 ? _cap(label) : label) + ' (' + _display(m.metricKey, m.latestValue) + ')';
        });
        var list = parts.length === 1 ? parts[0]
            : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
        var allYear = rest.every(function (m) { return _goalStory(m).shape === 'always'; });
        var quarter = rest[0].latestQuarter;
        var sameQuarter = rest.every(function (m) { return m.latestQuarter === quarter; });
        var when = allYear ? ' all year' : (sameQuarter && quarter ? ' in ' + quarter : '');
        return list + (rest.length === 1 ? ' was' : ' were') + ' also inside goal' + when + '.';
    }

    /* Missed hours as praise, only when they have earned it: inside an even
     * share of the allowance (splitForBoxes decides). "Eli has missed 5 hrs
     * for the year to date" sat in a strengths box as a bare fact; this says
     * what it is. Still the year's running total, never a quarter's. */
    function _hoursPraise(strengths, ctx) {
        var has = (strengths || []).some(function (m) { return m.metricKey === RELIABILITY; });
        var rel = ctx.reliability;
        if (!has || !rel || !rel.target) return '';
        var allowance = 'the ' + printedValue(RELIABILITY, rel.target.value) + ' hr allowance.';
        var span = ctx.quarter < 4 ? ' so far this year' : ' for the year';
        var inside = rel.yearToDate <= rel.target.value / 2 ? 'well inside ' : 'inside ';
        // "Kept missed time to 0 hrs" reads oddly, and "no time missed"
        // claims more than the counted figure does (time re-coded out of the
        // count is still time away), so a zero is said as the figure.
        if (Math.round(rel.yearToDate * 10) === 0) {
            return ctx.firstName + '\'s missed time' + span + ' is 0 hrs, ' + inside + allowance;
        }
        return ctx.firstName + ' kept missed time to ' + _display(RELIABILITY, rel.yearToDate)
            + span + ', ' + inside + allowance;
    }

    /* Box 1 when nothing is at goal and nothing is rising: the measure
     * nearest its goal, said as the place to start. */
    function _closestMetric(focus) {
        var pool = (focus || []).filter(function (m) {
            if (m.metricKey === RELIABILITY || !m.target || !Number.isFinite(m.latestValue)) return false;
            // No handle time is no calls, not a place to build from.
            return !((_registry()[m.metricKey] || {}).unit === 'sec' && m.latestValue <= 0);
        });
        if (!pool.length) return null;
        return pool.slice().sort(function (a, b) { return _missSeverity(a) - _missSeverity(b); })[0];
    }

    function _closestLine(focus, ctx) {
        var closest = _closestMetric(focus);
        if (!closest) return '';
        return ctx.firstName + ' is closest to goal on ' + _shortLabel(closest.metricKey)
            + ', at ' + _display(closest.metricKey, closest.latestValue) + ' in ' + closest.latestQuarter
            + ' against the ' + _display(closest.metricKey, closest.target.value)
            + ' goal, and that is a good place to build from.';
    }

    /* Where a metric box 1 already credited as progress stands now. */
    function _standingSentence(m) {
        if (!m.target || !m.gap || !Number.isFinite(m.latestValue)) return '';
        return _cap(m.label.toLowerCase()) + ' was ' + _display(m.metricKey, m.latestValue)
            + ' in ' + m.latestQuarter + ', ' + _movementAmount(m.metricKey, m.gap.size)
            + (m.isReverse ? ' above the ' : ' short of the ') + _display(m.metricKey, m.target.value) + ' goal.';
    }

    /* At goal in every quarter but the newest. */
    function _isFirstDip(m) {
        if (!m || m.meetsTarget !== false || !m.target) return false;
        var story = _goalStory(m);
        if (story.shape !== 'crossed-down' || story.points.length < 2) return false;
        return story.met.slice(0, -1).every(Boolean);
    }

    /* "Schedule adherence was inside the 93% goal in Q1 and Q2, at 94.5% and
     * 94.1%, and dipped to 92.7% in Q3." A first miss after a run at goal is
     * a dip, and "slipped in each quarter this year" read as a slide for a
     * 0.3 point miss (Scott, 2026-10-14). Every number is still on it. */
    function _firstDipSentence(m) {
        var story = _goalStory(m);
        var earlier = story.points.slice(0, -1);
        var last = story.points[story.points.length - 1];
        var join = function (items) {
            return items.length === 1 ? items[0]
                : items.slice(0, -1).join(', ') + ' and ' + items[items.length - 1];
        };
        return _cap(m.label.toLowerCase()) + ' was inside the ' + _display(m.metricKey, m.target.value)
            + ' goal in ' + join(earlier.map(function (p) { return p.name; }))
            + (earlier.length > 1 ? ', at ' : ' at ')
            + join(earlier.map(function (p) { return _display(m.metricKey, p.value); }))
            + ', and ' + (m.isReverse ? 'rose' : 'dipped') + ' to ' + _display(m.metricKey, last.value)
            + ' in ' + last.name + '.';
    }

    /* The closing line of the focus box. Direct about what has to move,
     * without naming a consequence the supervisor has not decided on.
     *
     * Fitted to the lead metric, and named. "This is the one to move first"
     * used to follow whichever sentence came last, so in one document "This"
     * sat under an adherence sentence and meant handle time. Three templates
     * went out word for word across a whole team, and a first 0.3 point miss
     * got the same "visible movement" line as a year long slide (Scott,
     * 2026-10-14). */
    function _focusClose(shown, ctx, progressKeys, seed) {
        if (!shown || !shown.length) return '';
        var name = ctx.firstName;
        var lead = shown[0];
        var short = _shortLabel(lead.metricKey);
        var goal = lead.target ? _display(lead.metricKey, lead.target.value) : 'goal';
        var next = _nextQuarterName(ctx);
        var goalFor = next ? 'the goal for ' + next : 'the goal going into next year';

        if (_isFirstDip(lead)) {
            var back = function (m) {
                return _shortLabel(m.metricKey) + ' back ' + (m.isReverse ? 'under ' : 'above ')
                    + _display(m.metricKey, m.target.value);
            };
            // Two first dips side by side are one sentence, not a close that
            // names only the first of them.
            var both = shown.length > 1 && _isFirstDip(shown[1]);
            return 'Getting ' + back(lead) + (both ? ' and ' + back(shown[1]) : '')
                + (next ? ' in ' + next : ' going into next year') + ' is the focus.';
        }
        if ((progressKeys || []).indexOf(lead.metricKey) >= 0) {
            return name + ' is already moving ' + short + ' the right way, and ' + goalFor
                + ' is to keep it moving toward ' + goal + '.';
        }
        if (lead.why === 'missed-and-falling') {
            var together = name + ' and I will work on ' + (shown.length > 1 ? 'it' : short)
                + ' together in our one to ones, and ' + goalFor + ' is to turn it back toward ' + goal + '.';
            return shown.length > 1 ? _cap(short) + ' is the one to move first. ' + together : together;
        }
        if (lead.why === 'missed-but-rising') {
            return name + ' has moved ' + short + ' the right way over the year, and ' + goalFor
                + ' is to keep it moving toward ' + goal + '.';
        }
        var move = lead.isReverse ? 'bring ' + short + ' down toward ' + goal : 'lift ' + short + ' toward ' + goal;
        var moving = lead.isReverse ? 'bringing ' + short + ' down toward ' + goal : 'lifting ' + short + ' toward ' + goal;
        return _pick([_cap(goalFor) + ' is to ' + move + '.',
            (next || 'Next year') + ' is about ' + moving + '.'], seed);
    }

    /* The two lines that make it a file note rather than a paragraph: who and
     * when, then what window the numbers below actually came from. */
    function buildHeader(ctx) {
        var lines = [];
        lines.push(ctx.quarterLabel + ' Check In: ' + ctx.name);
        var second = 'Prepared ' + _formatDate(ctx.preparedOn);
        var cov = ctx.coverage;
        if (cov.spanStart && cov.spanEnd) {
            second += '. Covers ' + _formatDate(cov.spanStart) + ' through ' + _formatDate(cov.spanEnd);
        }
        lines.push(second + '.');
        return lines.join('\n');
    }

    /* ── The facts, as lines ──
     *
     * One line per measure, quarter by quarter, with the goal and where it
     * stands. Shared rather than inlined into the prompt because the year-end
     * generator wants the same block: a year-end review that says how the year
     * MOVED is a better record than one that quotes a single closing figure.
     */
    function factLines(ctx, options) {
        var opts = options || {};
        var out = [];
        ctx.metrics.forEach(function (m) {
            var points = m.usablePoints && m.usablePoints.length ? m.usablePoints : m.series.measured;
            if (!points.length) return;
            var line = '- ' + m.label + ': '
                + points.map(function (p) { return p.name + ' ' + _display(m.metricKey, p.value); }).join(', ');
            if (m.target) {
                line += ' (goal ' + _display(m.metricKey, m.target.value)
                    + (m.target.type === 'min' ? ' or better)' : ' or lower)');
            }
            if (m.meetsTarget === true) line += ', at goal';
            // A gap is a movement, so points rather than a % sign: "15.3% off
            // goal" reads as fifteen percent of the goal.
            else if (m.meetsTarget === false && m.gap) line += ', ' + _movementAmount(m.metricKey, m.gap.size) + ' off goal';
            out.push(line);
        });

        var rel = ctx.reliability;
        if (rel.hasValue && opts.reliability !== false) {
            var relLine = '- ' + _label(RELIABILITY) + ': ' + _display(RELIABILITY, rel.yearToDate)
                + ' missed for the year';
            if (rel.target) relLine += ' (allowance ' + _display(RELIABILITY, rel.target.value) + ' for the year)';
            var pts = rel.checkpoints.filter(function (c) { return c.runningTotal !== null; });
            // Same rule as the file note. Without it the prompt said "22.9
            // hrs missed for the year" and then "running at 17.9 hrs through
            // Q3", and Copilot was told to keep every number exactly.
            if (rel.checkpointsReconcile && pts.length >= 2) {
                relLine += ', running at ' + pts.map(function (c) {
                    return _display(RELIABILITY, c.runningTotal) + ' through ' + c.name;
                }).join(', ');
            }
            out.push(relLine);
        }
        return out;
    }

    /* The same block as a ready made string, for a prompt built elsewhere.
     * Returns an empty string when there is nothing to say, so a caller can
     * append it unconditionally.
     */
    function buildProgressionBlock(employeeName, year, options) {
        var ctx = buildContext(employeeName, year, options);
        if (!ctx) return '';
        var lines = factLines(ctx, options);
        if (!lines.length) return '';
        return 'How each measure moved across the quarters of ' + ctx.year + ':\n'
            + lines.join('\n');
    }

    /* True things to praise, for a prompt built elsewhere.
     *
     * Scott, 2026-10-14: "Make sure to, in every piece of feedback ... make
     * sure to provide positive feedback." The Mid-Year and Year-End prompts
     * had nothing to hand Copilot for someone with no goal met. These are
     * the same judgements the file note's first box makes, as fact lines:
     *
     *   progress  below goal and moving the right way (_progressFor)
     *   closest   the measure nearest its goal, in the newest solid quarter
     *   support   the coaching sessions and calls worked on together
     *
     * Hours are never in here: Mid-Year and Year-End keep them out entirely.
     * options.ongoing false words a finished year in the past tense.
     */
    function praiseFacts(ctx, options) {
        if (!ctx) return [];
        var opts = options || {};
        var ongoing = opts.ongoing !== false;
        var split = splitForBoxes(ctx);
        var out = [];
        split.progress.slice(0, 2).forEach(function (m) {
            var p = m.progress;
            out.push({
                kind: 'progress',
                metricKey: m.metricKey,
                label: m.label,
                text: m.label + (ongoing ? ', moving the right way: ' : ', moved the right way: ')
                    + _display(m.metricKey, p.from.value) + ' in ' + p.from.name + ' to '
                    + _display(m.metricKey, p.to.value) + ' in ' + p.to.name
                    + (p.kind === 'best' && p.ofYear ? ', the best quarter of the year' : '')
            });
        });
        var closest = _closestMetric(split.focus);
        if (closest) {
            out.push({
                kind: 'closest',
                metricKey: closest.metricKey,
                label: closest.label,
                text: closest.label + ', the closest to goal: ' + _display(closest.metricKey, closest.latestValue)
                    + ' in ' + closest.latestQuarter + ' against the '
                    + _display(closest.metricKey, closest.target.value) + ' goal'
            });
        }
        var together = _togetherLine(ctx);
        if (together) {
            out.push({
                kind: 'support',
                metricKey: '',
                label: '',
                text: 'The work ' + ctx.firstName + (ongoing ? ' has put in with me this year: ' : ' put in with me this year: ')
                    + together.charAt(0).toLowerCase() + together.slice(1).replace(/\.$/, '')
            });
        }
        return out;
    }

    function buildPraiseFacts(employeeName, year, options) {
        return praiseFacts(buildContext(employeeName, year, options), options);
    }

    /* ── Talking points for the meeting ──
     *
     * The document above is a file note: finished prose, third person, for
     * the record. This is the sheet the supervisor reads from with the
     * associate in the room. It takes the same split, so what is said in the
     * meeting and what goes on file cannot disagree, but as short lines with
     * every quarter's number on them, and a few questions to open each part.
     *
     * The questions are the one place in this module written as "you": they
     * are said to the associate, not filed about them.
     */
    function buildTalkingPoints(ctx, options) {
        var opts = options || {};
        var split = splitForBoxes(ctx);
        var rel = ctx.reliability;
        var next = ctx.quarter < 4 ? 'Q' + (ctx.quarter + 1) : 'next year';
        var watchKeys = split.watch.map(function (m) { return m.metricKey; });

        var wins = split.strengths.filter(function (m) {
            return m.metricKey !== RELIABILITY && watchKeys.indexOf(m.metricKey) < 0;
        });
        var winItems = wins.slice(0, 3).map(function (m) { return _talkItem(m, ctx); });
        // Inside the allowance is only something to open the meeting on when
        // the hours are also inside an even share of it. 16.5 of 18 with a
        // quarter still to go is inside, and it is not a win. The file note
        // uses the same test, so the two never disagree about it.
        if (_hoursOnPace(rel, ctx)) winItems.push(_reliabilityItem(rel, ctx));

        // Below goal and moving the right way, unless it is already one of
        // the two things to work on. A sheet for someone with nothing at goal
        // opened straight on what to fix, then listed five more misses under
        // it, and gave the supervisor no win to start the meeting with
        // (Scott, 2026-10-14).
        var focusKeys = split.focus.slice(0, 2).map(function (m) { return m.metricKey; });
        var rising = split.progress.filter(function (m) { return focusKeys.indexOf(m.metricKey) < 0; });
        var risingItems = rising.slice(0, 2).map(function (m) { return _talkItem(m, ctx); });

        // Rates only. Hours are never something to work on in these sheets
        // (Scott, 2026-10-05), so a total over the allowance, or close to it,
        // is not raised here at all; on pace it is still a win above.
        var focusItems = split.focus.slice(0, 2).map(function (m) { return _talkItem(m, ctx); });

        // Nothing at goal and nothing rising outside the two to work on. The
        // sheet still opens on something true: a rise inside one of the two,
        // or the measure nearest its goal (Scott, 2026-10-14: "Make sure to
        // provide positive feedback" in every piece of feedback). Hours on
        // pace stay a win of their own, but they are not the only opener.
        var workingLines = (!wins.length && !risingItems.length) ? _workingLines(split, ctx) : [];

        var sections = [];
        if (winItems.length || workingLines.length) {
            sections.push({ id: 'wins', heading: 'Start with what is working', items: winItems, lines: workingLines });
        }
        if (risingItems.length) {
            sections.push({ id: 'rising', heading: 'Moving the right way', items: risingItems });
        }
        if (focusItems.length) {
            sections.push({ id: 'focus', heading: 'What to work on in ' + next, items: focusItems });
        } else {
            sections.push({
                id: 'focus', heading: 'What to work on in ' + next,
                lines: ['Every performance metric is at goal for ' + ctx.quarterLabel + '. The ask for '
                    + next + ' is to hold it.']
            });
        }
        // No third list of misses. Two things to work on is the meeting; the
        // rest under "also below goal, if there is time" read as a pile on to
        // the associate it was about (Scott, 2026-10-14).
        var watchItems = split.watch.map(function (m) { return _talkItem(m, ctx); });
        if (watchItems.length) {
            sections.push({ id: 'watch', heading: 'Keep an eye on', items: watchItems });
        }
        var moreWins = wins.slice(3).map(function (m) { return _briefLine(m, ctx); }).filter(Boolean);
        if (moreWins.length) {
            sections.push({ id: 'moreWins', heading: 'Also at goal', lines: moreWins });
        }

        var together = _togetherLine(ctx);
        if (together) sections.push({ id: 'together', heading: 'Worked on together this year', lines: [together] });

        sections.push({ id: 'ask', heading: 'Questions to ask', lines: _questions(wins, split, next, rising) });

        if (opts.notes && String(opts.notes).trim()) {
            sections.push({ id: 'notes', heading: 'My notes', lines: [String(opts.notes).trim()] });
        }

        var title = ctx.quarterLabel + ' check in: ' + ctx.name;
        return { title: title, sections: sections, text: _talkingText(title, sections) };
    }

    /* One metric: every quarter's number, which way it went, where it stands. */
    function _talkItem(m, ctx) {
        var points = m.usablePoints && m.usablePoints.length ? m.usablePoints : m.series.measured;
        var numbers = points.map(function (p) {
            return p.name + ' ' + _display(m.metricKey, p.value);
        }).join(', ');
        // How many surveys the newest figure rests on. A swing from 100% to
        // 61.5% reads differently once it is known to be 13 people.
        var isSurvey = !!(window.SURVEY_WEIGHT_FIELD || {})[m.metricKey];
        var last = points[points.length - 1];
        var sample = (isSurvey && last && last.surveyCount > 0)
            ? (last.surveyCount === 1 ? 'one survey' : last.surveyCount + ' surveys') + ' in ' + last.name
            : '';

        var said = [];
        var progress = m.progress;
        if (progress && progress.kind !== 'every') {
            // A metric on its way up is said as one. 74.2%, 71.9%, 76.5% is
            // "up and down" by its path, and under "Moving the right way"
            // that undersold the best quarter of the year.
            said.push((m.isReverse ? 'Down from ' : 'Up from ') + _display(m.metricKey, progress.from.value)
                + ' in ' + progress.from.name
                + (progress.kind === 'best' && progress.ofYear ? ', the best quarter of the year.' : '.'));
        } else if (points.length >= 2) {
            var kind = _pathShape(m, points).kind;
            said.push(kind === 'steady' ? 'Held steady.'
                : kind === 'climbing' ? 'Better each quarter.'
                    : kind === 'falling' ? 'Slipped each quarter.'
                        : kind === 'rose' ? 'Better this year.'
                            : kind === 'fell' ? 'Slipped this year.'
                                : 'Up and down this year.');
        }
        said.push(_standingPhrase(m));
        said.push(_thinCurrentPhrase(m, ctx));

        return {
            metricKey: m.metricKey,
            label: m.label,
            numbers: numbers,
            goal: m.target ? _goalWords(m.metricKey, m.target) : '',
            sample: sample,
            said: said.filter(Boolean).join(' ')
        };
    }

    function _goalWords(metricKey, target) {
        return 'goal ' + _display(metricKey, target.value)
            + (target.type === 'min' ? ' or better' : ' or lower');
    }

    // "1.7 points short", "45 seconds over".
    function _gapShort(m) {
        if (!m.gap) return '';
        return _movementAmount(m.metricKey, m.gap.size) + (m.isReverse ? ' over' : ' short');
    }

    function _standingPhrase(m) {
        if (!m.target || m.meetsTarget === null || m.meetsTarget === undefined) return '';
        var story = _goalStory(m);
        var at = m.latestQuarter;
        if (m.meetsTarget) {
            if (story.shape === 'always') return 'At goal all year.';
            if (story.shape === 'crossed-up') {
                return story.at.name === at ? 'Reached goal in ' + at + '.' : 'At goal since ' + story.at.name + '.';
            }
            return 'At goal in ' + at + '.';
        }
        var side = _missSide(m);
        var gap = _gapShort(m);
        if (story.shape === 'crossed-down' && story.onlyLast) {
            return 'First quarter ' + side + ' goal, ' + gap + '.';
        }
        if (story.shape === 'crossed-down') {
            return _cap(side) + ' goal since ' + story.at.name + ', ' + gap + ' in ' + at + '.';
        }
        if (story.shape === 'never') return _cap(side) + ' goal all year, ' + gap + ' in ' + at + '.';
        return _cap(side) + ' goal in ' + at + ', ' + gap + '.';
    }

    /* The check-in quarter had a reading too thin to quote, so the line
     * above is about an earlier quarter. Said, so it is not mistaken for
     * this quarter's number. */
    function _thinCurrentPhrase(m, ctx) {
        if (!ctx.current || m.latestQuarter === ctx.current.name) return '';
        var cur = m.series.points.filter(function (p) { return p.quarter === ctx.quarter; })[0];
        // No reading at all is an empty quarter, not a thin one, and is not
        // worth a line on every metric.
        if (!cur || !cur.hasValue) return '';
        if (cur.surveyCount > 0) {
            return ctx.current.name + ' had ' + (cur.surveyCount === 1 ? 'one survey' : cur.surveyCount + ' surveys')
                + ', too few to read.';
        }
        return ctx.current.name + ' had too few surveys to read.';
    }

    /* Missed hours: the year's running total, always. */
    function _reliabilityItem(rel, ctx) {
        var hrs = function (v) { return _display(RELIABILITY, v); };
        var withValues = rel.checkpoints.filter(function (c) { return c.runningTotal !== null; });
        var lastRunning = withValues.length ? withValues[withValues.length - 1].runningTotal : null;
        var numbers = hrs(rel.yearToDate) + ' missed this year';
        // The climb quarter by quarter, only when it lands on the year figure.
        // Two different totals for the year on one line is worse than one.
        if (rel.checkpointsReconcile && withValues.length >= 2 && hrs(lastRunning) === hrs(rel.yearToDate)) {
            numbers = withValues.map(function (c) {
                return hrs(c.runningTotal) + ' through ' + c.name;
            }).join(', ');
        }

        var said = '';
        var left = _quartersLeftPhrase(ctx);
        if (rel.partialYear && rel.firstQuarterWithData) {
            said = hrs(rel.yearToDate) + ' missed since ' + rel.firstQuarterWithData.name
                + '. The allowance is set for a full year.';
        } else if (rel.meetsTarget === false) {
            said = hrs(rel.overBy) + ' over the allowance'
                + (left ? ', with ' + left + ' still to go.' : ' for the year.');
        } else if (rel.meetsTarget === true && rel.target) {
            var room = _round1(rel.target.value - rel.yearToDate);
            said = room > 0
                ? hrs(room) + ' left in the allowance' + (left ? ' for the rest of the year.' : '.')
                : 'Right at the allowance.';
        }

        return {
            metricKey: RELIABILITY,
            label: _label(RELIABILITY),
            numbers: numbers,
            goal: rel.target ? 'allowance ' + hrs(rel.target.value) + ' for the year' : '',
            said: said
        };
    }

    // "Transfers: 7.0% in Q3, 1 point over goal."
    function _briefLine(m, ctx) {
        if (!Number.isFinite(m.latestValue)) return '';
        var line = m.label + ': ' + _display(m.metricKey, m.latestValue) + ' in ' + m.latestQuarter;
        if (m.meetsTarget === false && m.gap) line += ', ' + _gapShort(m) + (m.isReverse ? ' goal' : ' of goal');
        else if (m.target) line += ' (' + _goalWords(m.metricKey, m.target) + ')';
        var thin = ctx ? _thinCurrentPhrase(m, ctx) : '';
        return line + '.' + (thin ? ' ' + thin : '');
    }

    function _togetherLine(ctx) {
        var sup = ctx.support;
        if (!sup) return '';
        var parts = [];
        if (sup.coachingSessions > 0) {
            parts.push(sup.coachingSessions === 1 ? 'one coaching session' : sup.coachingSessions + ' coaching sessions');
        }
        if (sup.callsReviewed > 0) {
            parts.push(sup.callsReviewed === 1 ? 'one call reviewed' : sup.callsReviewed + ' calls reviewed');
        }
        if (!parts.length) return '';
        var discussed = ctx.metrics.map(function (m) { return m.metricKey; });
        var named = sup.metricsCoached
            .filter(function (k) { return discussed.indexOf(k) >= 0; })
            .map(function (k) { return _label(k).toLowerCase(); });
        // "on average handle time, rep satisfaction" had no "and" before the
        // last one (tone audit, 2026-10-25).
        var namedText = named.length <= 1 ? (named[0] || '')
            : named.length === 2 ? named.join(' and ')
            : named.slice(0, -1).join(', ') + ', and ' + named[named.length - 1];
        return _cap(parts.join(' and ')) + (named.length ? ', on ' + namedText : '') + '.';
    }

    /* The opener when nothing is at goal and nothing outside the two focus
     * metrics is rising: a rise inside one of them, else the measure nearest
     * its goal, else the work put in. Third person, like the file note. */
    function _workingLines(split, ctx) {
        var lines = split.progress.slice(0, 2)
            .map(function (m, i) { return progressSentence(m, ctx, i); })
            .filter(Boolean);
        if (!lines.length) {
            var closest = _closestLine(split.focus, ctx);
            if (closest) lines.push(closest);
        }
        if (!lines.length) {
            var support = supportSentence(ctx);
            if (support) lines.push(support);
        }
        if (!lines.length) {
            var voice = (window.DevCoachModules || {}).messageVoice;
            var effort = voice && typeof voice.truePositive === 'function'
                ? voice.truePositive([], { ongoing: ctx.quarter < 4 }).text : '';
            if (effort) lines.push(effort);
        }
        return lines;
    }

    function _questions(wins, split, next, rising) {
        var out = [];
        // A question about something going well, even on a hard quarter:
        // a metric on its way up is worth asking about as much as one at goal,
        // and with neither, the measure nearest its goal is still a place
        // something is working.
        var good = wins.length ? wins[0]
            : (rising && rising.length ? rising[0]
                : (split.progress && split.progress.length ? split.progress[0] : null));
        var closest = good ? null : _closestMetric(split.focus);
        if (good) out.push('What has been working for you on ' + good.label.toLowerCase() + '?');
        else if (closest) {
            out.push('What has been working for you on ' + closest.label.toLowerCase()
                + ', where you are closest to goal?');
        }
        var firstRate = split.focus[0];
        if (firstRate) out.push('What gets in the way on ' + firstRate.label.toLowerCase() + '?');
        else if (split.watch.length) out.push('What has changed on ' + split.watch[0].label.toLowerCase() + ' lately?');
        out.push('What do you want to work on in ' + next + ', and what do you need from me?');
        return out;
    }

    function _talkingText(title, sections) {
        var out = [title];
        sections.forEach(function (s) {
            out.push('');
            out.push(s.heading.toUpperCase());
            (s.items || []).forEach(function (item) {
                var line = '- ' + item.label + ': ' + item.numbers;
                var aside = [item.goal, item.sample].filter(Boolean).join(', ');
                if (aside) line += ' (' + aside + ')';
                line += '.';
                if (item.said) line += ' ' + item.said;
                out.push(line);
            });
            (s.lines || []).forEach(function (line) { out.push('- ' + line); });
        });
        return out.join('\n') + '\n';
    }

    /* ── The Copilot prompt ──
     *
     * Same facts, handed over for rewording. First person, help me polish my
     * notes: a "you are a supervisor evaluating an employee" persona trips
     * Copilot's guardrail on individualised employee evaluation and comes back
     * as a refusal. on-off-tracker learned that one the hard way.
     */
    function buildPrompt(ctx, options) {
        var opts = options || {};
        var notes = buildNotes(ctx, opts);
        var split = { strengths: notes.strengths, focus: notes.focus, progress: notes.progress || [] };
        var name = ctx.firstName;
        var out = [];

        out.push('I am a call center supervisor and I have written up my quarterly check in notes for '
            + name + '. I need help polishing them into the two boxes our review system takes. '
            + 'This is a ' + ctx.quarterLabel + ' check in, so the year is still running.');
        out.push('');
        out.push('Here is how each measure has moved across the quarters this year:');
        // Hours go to Copilot only when they are being recognised. Over the
        // allowance they are in neither box, and handed over as a fact they
        // came back as an area of focus, which Scott does not want there.
        var hoursRecognised = split.strengths.some(function (m) { return m.metricKey === RELIABILITY; });
        factLines(ctx, { reliability: hoursRecognised }).forEach(function (line) { out.push(line); });

        var support = supportSentence(ctx);
        if (support) {
            out.push('');
            out.push('What we have worked on together over this stretch:');
            out.push('- ' + support);
        }

        out.push('');
        out.push('What I want recognised:');
        // Progress below goal and the work put in count as much as a metric
        // at goal. With none of the second kind this used to hand Copilot
        // "steady performance with nothing moving far either way" about an
        // associate whose rep satisfaction had just had its best quarter
        // (Scott, 2026-10-14).
        var recognised = split.strengths.slice(0, 4).map(function (m) { return '- ' + m.label; });
        split.progress.slice(0, 2).forEach(function (m) {
            var p = m.progress;
            recognised.push('- ' + m.label + ', moving the right way: ' + _display(m.metricKey, p.from.value)
                + ' in ' + p.from.name + ' to ' + _display(m.metricKey, p.to.value) + ' in ' + p.to.name);
        });
        if (support) recognised.push('- The work ' + name + ' has put in with me this year');
        if (!recognised.length) {
            // Named, so Copilot is handed a real measure to praise rather
            // than told to find one.
            var closest = _closestMetric(split.focus);
            recognised.push(closest
                ? '- The effort ' + name + ' brings, and ' + closest.label.toLowerCase() + ', the closest to goal at '
                    + _display(closest.metricKey, closest.latestValue) + ' in ' + closest.latestQuarter
                : '- The effort ' + name + ' brings');
        }
        recognised.forEach(function (line) { out.push(line); });

        out.push('');
        out.push('What I want them working on:');
        if (split.focus.length) {
            split.focus.slice(0, 2).forEach(function (m) { out.push('- ' + m.label); });
        } else {
            out.push('- Holding the current level through the rest of the year');
        }

        if (opts.notes) {
            out.push('');
            out.push('My own notes on what ' + name + ' has been working on. Work this in naturally, do not quote it:');
            out.push(String(opts.notes).trim());
        }

        out.push('');
        out.push('My draft, which you are welcome to rewrite:');
        out.push('');
        out.push('Progress and strengths: ' + notes.box1);
        out.push('');
        out.push('Areas of focus: ' + notes.box2);
        out.push('');
        out.push('Please tighten this into two boxes I can paste in. Requirements:');
        out.push('- Write about ' + name + ' in the third person. These are my notes for a record, not a letter to them, so do not use "you"');
        out.push('- Keep every number and every quarter comparison exactly as I have given it. Do not round differently and do not invent a figure');
        out.push('- Show the movement across the quarters, since that is the point of the document');
        out.push('- Present tense for where things stand, since the year is still running');
        out.push('- Plain, factual and specific, the way a supervisor writes a file note. Warm is fine, flowery is not');
        out.push('- Open Progress and strengths by recognising ' + name + ' by name, and give real credit for every gain, including the ones still short of goal');
        out.push('- Be direct about what needs to improve, and say what is expected, without naming any consequence');
        out.push('- Use the % symbol rather than the word percent');
        out.push('- Do not use dashes of any kind. Use commas and full stops');
        out.push('- Do not grade the overall performance or use any rating words');
        out.push('- Keep reliability, attendance and hours missed out of Areas of Focus');
        out.push('- About 4 to 7 sentences per box');
        out.push('- Return exactly this format and nothing else:');
        out.push('Progress & Strengths:');
        out.push('[text]');
        out.push('');
        out.push('Areas of Focus:');
        out.push('[text]');

        return out.join('\n');
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.quarterReview = {
        REVIEW_METRICS: REVIEW_METRICS,
        // The recap email reads these rather than keeping its own copies, so
        // the four KPIs it sends and the noise band it judges a move by are
        // the ones this document uses.
        CORE_METRICS: CORE_METRICS.slice(),
        stableBand: _stableBand,
        movementAmount: _movementAmount,
        printedValue: printedValue,
        MIN_SURVEYS_FOR_TREND: MIN_SURVEYS_FOR_TREND,
        buildContext: buildContext,
        splitForBoxes: splitForBoxes,
        progressionPhrase: progressionPhrase,
        metricSentence: metricSentence,
        reliabilitySentence: reliabilitySentence,
        supportSentence: supportSentence,
        buildHeader: buildHeader,
        buildNotes: buildNotes,
        buildPrompt: buildPrompt,
        buildTalkingPoints: buildTalkingPoints,
        factLines: factLines,
        buildProgressionBlock: buildProgressionBlock,
        praiseFacts: praiseFacts,
        buildPraiseFacts: buildPraiseFacts
    };
})();
