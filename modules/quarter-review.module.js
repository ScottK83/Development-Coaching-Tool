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
        var mm = (window.DevCoachModules || {}).metricMovement;
        var better = mm && typeof mm.performanceDelta === 'function'
            ? mm.performanceDelta(metricKey, last.value, first.value)
            : last.value - first.value;
        return {
            from: first,
            to: last,
            raw: last.value - first.value,
            size: Math.abs(last.value - first.value),
            improved: Number.isFinite(better) ? better > 0 : null,
            quartersApart: usable.length
        };
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

        return {
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
        return Number.isFinite(value) ? value : NaN;
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
        var line = ctx.firstName + ' and I have had ' + joined + ' over this stretch';

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
            var improving = moved && moved.improved === true;
            var declining = moved && moved.improved === false;

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
                    if (points.length >= 2 && _pathShape(m, points).kind === 'falling') {
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

        // Missed hours sit in whichever box the year's total puts them.
        var rel = ctx.reliability;
        // meetsTarget is null on a partial year, where the annual allowance
        // says nothing useful. Neither box claims a verdict then; the sentence
        // is still available to a caller that wants to state the hours.
        if (rel.hasValue && rel.target) {
            if (rel.meetsTarget === true) {
                strengths.push({ metricKey: RELIABILITY, label: _label(RELIABILITY), why: 'met', reliability: rel });
            } else if (rel.meetsTarget === false) {
                focus.push({ metricKey: RELIABILITY, label: _label(RELIABILITY), why: 'missed', reliability: rel });
            } else if (rel.partialYear && rel.yearToDate > 0) {
                // No verdict, but hours worth raising. Withholding the verdict
                // must not mean withholding the hours: fifteen of them in one
                // quarter is the single most useful thing on the page about a
                // new starter, and leaving it out entirely was worse than the
                // wrong verdict it replaced. Ranked last, so a real miss is
                // still raised ahead of it.
                focus.push({ metricKey: RELIABILITY, label: _label(RELIABILITY), why: 'partial-year', reliability: rel });
            }
        }

        var focusRank = { 'missed-and-falling': 0, 'missed': 1, 'missed-but-rising': 2, 'partial-year': 3 };
        focus.sort(function (a, b) {
            var ra = focusRank[a.why] === undefined ? 1 : focusRank[a.why];
            var rb = focusRank[b.why] === undefined ? 1 : focusRank[b.why];
            if (ra !== rb) return ra - rb;
            // Reliability outranks a rate when both are behind: missed hours
            // are the one of these with a hard ceiling on them.
            if (a.metricKey === RELIABILITY) return -1;
            if (b.metricKey === RELIABILITY) return 1;
            // Then by how badly it missed. Returning 0 here left the order to
            // the metric registry, so a metric missing by a tenth of a point
            // was raised ahead of one missing by forty, purely because handle
            // time is declared before first call resolution. Only two make it
            // into the box, so that decided which gaps a supervisor saw.
            return _missSeverity(b) - _missSeverity(a);
        });

        var strengthRank = { 'improved-and-met': 0, 'met': 1, 'improved': 2 };
        strengths.sort(function (a, b) {
            var ra = strengthRank[a.why] === undefined ? 1 : strengthRank[a.why];
            var rb = strengthRank[b.why] === undefined ? 1 : strengthRank[b.why];
            return ra - rb;
        });

        // Biggest slide first: if only one is going to be raised, raise that.
        watch.sort(function (a, b) {
            var sa = a.movedAcross ? a.movedAcross.size : 0;
            var sb = b.movedAcross ? b.movedAcross.size : 0;
            return sb - sa;
        });

        return { strengths: strengths, focus: focus, watch: watch };
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
        for (var i = 1; i < points.length; i++) {
            var better = mm && typeof mm.performanceDelta === 'function'
                ? mm.performanceDelta(m.metricKey, points[i].value, points[i - 1].value)
                : points[i].value - points[i - 1].value;
            steps.push(Number.isFinite(better) ? better : 0);
        }

        var values = points.map(function (p) { return p.value; });
        var spread = Math.max.apply(null, values) - Math.min.apply(null, values);
        if (spread <= band) return { kind: 'steady', steps: steps, spread: spread };

        var improvedAny = steps.some(function (s) { return s > 0; });
        var worsenedAny = steps.some(function (s) { return s < 0; });
        if (improvedAny && !worsenedAny) return { kind: 'climbing', steps: steps, spread: spread };
        if (worsenedAny && !improvedAny) return { kind: 'falling', steps: steps, spread: spread };

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
        return {
            kind: 'swung',
            steps: steps,
            spread: spread,
            worst: points[worstIdx],
            worstIsInterior: worstIdx > 0 && worstIdx < points.length - 1
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

        if (points.length < 2) {
            lines.push(_cap(label) + ' for ' + points[0].name + ' was '
                + _display(m.metricKey, points[0].value) + ', '
                + targetPhrase(m.metricKey, m.target) + '.');
            return lines.join(' ');
        }

        var path = _pathShape(m, points);
        var movementWord;
        if (path.kind === 'steady') movementWord = 'held steady';
        else if (path.kind === 'climbing') movementWord = m.isReverse ? 'came down in each quarter this year' : 'improved in each quarter this year';
        else if (path.kind === 'falling') movementWord = m.isReverse ? 'climbed in each quarter this year' : 'slipped in each quarter this year';
        else movementWord = 'moved around this year';

        if (style === 'brief') {
            // "Went from 90% to 90%" is a sentence nobody writes. A metric
            // that did not move gets said as a metric that did not move.
            if (path.kind === 'steady') {
                // "Both inside the goal" needs two readings to refer to. A
                // metric that held gets the singular tail instead.
                lines.push(_cap(label) + ' held at '
                    + _display(m.metricKey, points[points.length - 1].value)
                    + ' across the year' + _goalTail(story, m, 'steady') + '.');
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
        if (path.kind === 'swung' && path.worstIsInterior) {
            lines.push(_cap(_swingNote(m, path, ctx)) + _goalTail(story, m, 'lead') + '.');
        // "Held steady" and "that is 3 points better than where they started"
        // contradict each other inside one paragraph. A move small enough to
        // call steady is a move too small to then quantify as progress.
        } else if (path.kind !== 'steady' && moved && moved.size > 0) {
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
                if (style === 'support') return ', every quarter of it inside the ' + goal + ' goal';
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

    // "over one quarter", or "going into next year" when the year is done.
    function _overRemainingPhrase(ctx) {
        var left = _quartersLeftPhrase(ctx);
        return left ? 'over ' + left : 'going into next year';
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
        var name = ctx.firstName;

        // A metric raised as a slide in the focus box is not also given the
        // full treatment in the strengths box. Saying the same three
        // sentences twice in one document is how a reader stops reading.
        var raisedAsSlide = (!split.focus.length && split.watch.length)
            ? split.watch[0].metricKey : null;

        // Depth falls away down the list. The first strength is the one the
        // supervisor would lead with in the room, and the fourth is a clause.
        var strengthLines = split.strengths
            .filter(function (m) { return m.metricKey !== raisedAsSlide; })
            .slice(0, 4)
            .map(function (m, i) {
                return metricSentence(m, ctx, i === 0 ? 'lead' : i === 1 ? 'support' : 'brief');
            })
            .filter(Boolean);
        var focusLines = split.focus.slice(0, 2)
            .map(function (m, i) { return metricSentence(m, ctx, i === 0 ? 'lead' : 'support'); })
            .filter(Boolean);

        var box1 = strengthLines.length
            ? strengthLines.join(' ')
            : name + ' held the quarter steady with no metric moving far in either direction.';

        var box2Parts = [];
        if (focusLines.length) {
            box2Parts.push(focusLines.join(' '));
            box2Parts.push(_focusClose(split.focus, ctx));
        } else if (split.watch.length) {
            // Nothing missed, but something is sliding toward a miss. That is
            // the conversation worth having now, and "everything is at goal"
            // would bury it.
            var slide = split.watch[0];
            box2Parts.push('Every tracked metric is at goal for ' + ctx.quarterLabel + '.');
            box2Parts.push(metricSentence(slide, ctx, 'lead'));
            box2Parts.push('It is still at goal, so this is one to watch rather than fix, and the aim is to stop the slide '
                + _overRemainingPhrase(ctx) + '.');
        } else {
            var left = _quartersLeftPhrase(ctx);
            // Named rather than left generic. Every associate with a clean
            // quarter was getting a byte identical focus box, and a file note
            // that could have been written about anybody reads as one that was.
            var best = _strongest(split.strengths);
            var opening = 'Every tracked metric is at goal for ' + ctx.quarterLabel;
            if (best) {
                opening += ', ' + best.label.toLowerCase() + ' the furthest clear of it at '
                    + _display(best.metricKey, best.latestValue);
            }
            box2Parts.push(opening + '. '
                + (left
                    ? 'The focus for the rest of the year is holding that through ' + left + '.'
                    : 'The focus is holding that through next year.'));
        }
        var box2 = box2Parts.filter(Boolean).join(' ');

        // The work behind the numbers, ahead of the supervisor's own note.
        var support = supportSentence(ctx);
        if (support) box1 = box1 + ' ' + support;

        if (opts.notes) {
            box1 = box1 + ' ' + String(opts.notes).trim();
        }

        var header = buildHeader(ctx);
        return {
            header: header,
            box1: box1,
            box2: box2,
            strengths: split.strengths,
            focus: split.focus,
            full: header + '\n\nPROGRESS AND STRENGTHS\n' + box1
                + '\n\nAREAS OF FOCUS\n' + box2 + '\n'
        };
    }

    /* The expectation line. Direct about what has to move, without naming a
     * consequence the supervisor has not decided on. */
    function _focusClose(focus, ctx) {
        if (!focus.length) return '';
        var name = ctx.firstName;
        var lead = focus[0];
        var over = _overRemainingPhrase(ctx);
        if (lead.why === 'missed-and-falling') {
            return 'This is the one to move first. ' + name
                + ' and I will work it in our one to ones, and the expectation is visible movement '
                + over + '.';
        }
        if (lead.why === 'partial-year') {
            var rel = lead.reliability;
            var since = rel && rel.firstQuarterWithData ? rel.firstQuarterWithData.name : 'they started';
            return 'The allowance is set for a full year and ' + name
                + ' has been on the team since ' + since
                + ', so the figure above is the hours themselves rather than a reading against it. '
                + 'We will talk through the time missed and what sits behind it.';
        }
        if (lead.why === 'missed-but-rising') {
            return name + ' is already moving this the right way, and the expectation is that it reaches goal '
                + over + '.';
        }
        return 'The expectation is steady progress toward goal ' + over + '.';
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
    function factLines(ctx) {
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
            else if (m.meetsTarget === false && m.gap) line += ', ' + _display(m.metricKey, m.gap.size) + ' off goal';
            out.push(line);
        });

        var rel = ctx.reliability;
        if (rel.hasValue) {
            var relLine = '- ' + _label(RELIABILITY) + ': ' + _display(RELIABILITY, rel.yearToDate)
                + ' missed for the year';
            if (rel.target) relLine += ' (allowance ' + _display(RELIABILITY, rel.target.value) + ' for the year)';
            var pts = rel.checkpoints.filter(function (c) { return c.runningTotal !== null; });
            if (pts.length >= 2) {
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
        var lines = factLines(ctx);
        if (!lines.length) return '';
        return 'How each measure moved across the quarters of ' + ctx.year + ':\n'
            + lines.join('\n');
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
        var split = { strengths: notes.strengths, focus: notes.focus };
        var name = ctx.firstName;
        var out = [];

        out.push('I am a call center supervisor and I have written up my quarterly check in notes for '
            + name + '. I need help polishing them into the two boxes our review system takes. '
            + 'This is a ' + ctx.quarterLabel + ' check in, so the year is still running.');
        out.push('');
        out.push('Here is how each measure has moved across the quarters this year:');
        factLines(ctx).forEach(function (line) { out.push(line); });

        var support = supportSentence(ctx);
        if (support) {
            out.push('');
            out.push('What we have worked on together over this stretch:');
            out.push('- ' + support);
        }

        out.push('');
        out.push('What I want recognised:');
        if (split.strengths.length) {
            split.strengths.slice(0, 4).forEach(function (m) { out.push('- ' + m.label); });
        } else {
            out.push('- Steady performance with nothing moving far either way');
        }

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
        out.push('- Be direct about what needs to improve, and say what is expected, without naming any consequence');
        out.push('- Use the % symbol rather than the word percent');
        out.push('- Do not use dashes of any kind. Use commas and full stops');
        out.push('- Do not grade the overall performance or use any rating words');
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
        factLines: factLines,
        buildProgressionBlock: buildProgressionBlock
    };
})();
