(function () {
    'use strict';

    // ============================================
    // QUARTER TREND MODULE
    //
    // "Q1 AHT was here, Q2 here, Q3 here." One quarter's worth of numbers per
    // associate, for every quarter of a year, so a review document can show a
    // direction instead of a single snapshot.
    //
    // The whole difficulty is picking WHICH uploads make up a quarter. This app
    // stores weeks, months, quarters and year-to-date rows side by side in
    // weeklyData, keyed only by date span. A quarter naively assembled from
    // "everything ending between April and June" counts April three times: once
    // in its month row, once in its weeks, once in the Q2 row. Calls, surveys
    // and missed hours all accumulate, so the double count is not a rounding
    // error, it lands on every figure in the review.
    //
    // The rule here is ONE granularity per quarter, chosen by how much of the
    // quarter it actually covers. That differs from the year-to-date aggregator
    // in metric-trends, which always prefers weeks, and the difference is
    // deliberate: a year-to-date range is arbitrary and weeks tile it finely,
    // but a quarter is an exact calendar span. Weeks straddle its edges (the
    // week of Mar 30 to Apr 5 belongs to neither quarter cleanly), while a
    // month row or a real quarter upload lines up with it exactly. So coverage
    // decides, and the priority below only breaks ties.
    // ============================================

    var QUARTER_MONTHS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]];
    var MS_PER_DAY = 24 * 60 * 60 * 1000;

    // Granularity groups. Types inside a group can be deduped against each
    // other by containment; types in different groups never mix, because that
    // is exactly what double counts.
    var GRANULARITIES = [
        { id: 'quarter', label: 'quarter upload', types: ['quarter'] },
        { id: 'month', label: 'monthly uploads', types: ['month', 'month-to-date'] },
        { id: 'week', label: 'weekly uploads', types: ['week', 'week-in-progress', 'custom'] }
    ];

    /* ── Small helpers ── */

    function _weeklyData() {
        return typeof weeklyData !== 'undefined' ? weeklyData : {};
    }

    function _periodCompare() {
        return (window.DevCoachModules || {}).periodCompare || null;
    }

    function _metricMovement() {
        return (window.DevCoachModules || {}).metricMovement || null;
    }

    function pad2(n) {
        return (n < 10 ? '0' : '') + n;
    }

    function isoDate(d) {
        return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
    }

    // Local-midnight parse. new Date('2026-04-01') is UTC and lands on Mar 31
    // in any western timezone, which walks a quarter boundary by a day.
    function parseLocalDate(text) {
        if (!text || typeof text !== 'string') return null;
        var parts = text.split('-');
        if (parts.length < 3) return null;
        var y = parseInt(parts[0], 10);
        var m = parseInt(parts[1], 10);
        var d = parseInt(parts[2], 10);
        if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
        var out = new Date(y, m - 1, d);
        return isNaN(out.getTime()) ? null : out;
    }

    function quarterOfMonth(monthIndex) {
        return Math.floor(monthIndex / 3) + 1;
    }

    /* ── Quarter bounds ── */

    // quarterBounds(2026, 3) -> { year, quarter, startDate, endDate, ... }
    function quarterBounds(year, quarter) {
        var y = parseInt(year, 10);
        var q = parseInt(quarter, 10);
        if (!Number.isInteger(y) || !Number.isInteger(q) || q < 1 || q > 4) return null;
        var start = new Date(y, (q - 1) * 3, 1);
        var end = new Date(y, (q - 1) * 3 + 3, 0);
        return {
            year: y,
            quarter: q,
            name: 'Q' + q,
            label: 'Q' + q + ' ' + y,
            startDate: isoDate(start),
            endDate: isoDate(end),
            startMs: start.getTime(),
            endMs: end.getTime(),
            months: QUARTER_MONTHS[q - 1].slice()
        };
    }

    // The quarter a date falls in, or null when it is in another year.
    function quarterOfDate(dateText, year) {
        var d = parseLocalDate(dateText);
        if (!d) return null;
        if (parseInt(year, 10) && d.getFullYear() !== parseInt(year, 10)) return null;
        return quarterOfMonth(d.getMonth());
    }

    /* ── Interval union, for honest coverage ──
     *
     * Summing each period's length overstates coverage the moment two of them
     * overlap, and a "custom" row overlapping a week is exactly the case that
     * would make a thin quarter look complete. Merging the intervals first
     * makes the number mean what it says.
     */
    function coveredDays(intervals, clipStartMs, clipEndMs) {
        var clipped = [];
        (intervals || []).forEach(function (iv) {
            var s = Math.max(iv.startMs, clipStartMs);
            var e = Math.min(iv.endMs, clipEndMs);
            if (e >= s) clipped.push({ startMs: s, endMs: e });
        });
        if (!clipped.length) return 0;
        clipped.sort(function (a, b) { return a.startMs - b.startMs; });
        var total = 0;
        var curStart = clipped[0].startMs;
        var curEnd = clipped[0].endMs;
        for (var i = 1; i < clipped.length; i++) {
            if (clipped[i].startMs <= curEnd + MS_PER_DAY) {
                if (clipped[i].endMs > curEnd) curEnd = clipped[i].endMs;
            } else {
                total += Math.round((curEnd - curStart) / MS_PER_DAY) + 1;
                curStart = clipped[i].startMs;
                curEnd = clipped[i].endMs;
            }
        }
        total += Math.round((curEnd - curStart) / MS_PER_DAY) + 1;
        return total;
    }

    /* ── Candidate periods ── */

    // Every stored period described as an interval, with its type and key.
    function describePeriods(store) {
        var data = store || _weeklyData();
        return Object.keys(data).map(function (key) {
            var entry = data[key];
            var meta = (entry && entry.metadata) || {};
            var keyParts = key.indexOf('|') >= 0 ? key.split('|') : [];
            var startText = meta.startDate || keyParts[0] || '';
            var endText = meta.endDate || keyParts[1] || '';
            var start = parseLocalDate(startText);
            var end = parseLocalDate(endText);
            if (!end) return null;
            // A year-to-date row carries the RUNNING year total, not this
            // period's share of it. Added to period slices it roughly doubles
            // missed hours, against a budget with a hard ceiling. Those rows
            // belong to ytdData and should never appear here, but the cost of
            // one slipping through is high enough to be worth a line.
            if (meta.periodType === 'ytd') return null;
            // A row with no start date is treated as a single day rather than
            // dropped: it still carries real numbers.
            var realStart = start || end;
            return {
                key: key,
                entry: entry,
                type: meta.periodType || 'week',
                startDate: isoDate(realStart),
                endDate: isoDate(end),
                startMs: realStart.getTime(),
                endMs: end.getTime()
            };
        }).filter(Boolean);
    }

    // Drop any period wholly inside another one from the same group. Keeps the
    // larger span, which is the one that carries the complete figure.
    function dropContained(periods) {
        var sorted = periods.slice().sort(function (a, b) {
            var spanA = a.endMs - a.startMs;
            var spanB = b.endMs - b.startMs;
            if (spanB !== spanA) return spanB - spanA;
            return a.startMs - b.startMs;
        });
        var kept = [];
        sorted.forEach(function (p) {
            var swallowed = kept.some(function (k) {
                return p.startMs >= k.startMs && p.endMs <= k.endMs;
            });
            if (!swallowed) kept.push(p);
        });
        return kept.sort(function (a, b) { return a.endMs - b.endMs; });
    }

    /* ── Choosing the granularity for one quarter ── */

    // A period belongs to a quarter when its END date falls inside it. That is
    // the convention the rest of the app buckets by (period-compare's month
    // buckets, q1-review's week filter), so a quarter assembled here lines up
    // with the months and weeks shown everywhere else.
    function periodsInQuarter(periods, bounds) {
        return periods.filter(function (p) {
            return p.endMs >= bounds.startMs && p.endMs <= bounds.endMs;
        });
    }

    /* Build one granularity's candidate set for a quarter, with its coverage. */
    function buildCandidate(gran, periods, bounds, todayMs) {
        var mine = periodsInQuarter(periods, bounds).filter(function (p) {
            return gran.types.indexOf(p.type) >= 0;
        });
        if (!mine.length) return null;
        var kept = dropContained(mine);
        var elapsedEnd = Math.min(bounds.endMs, todayMs);
        var elapsed = Math.round((elapsedEnd - bounds.startMs) / MS_PER_DAY) + 1;
        var days = coveredDays(kept, bounds.startMs, bounds.endMs);
        var spanStart = kept.reduce(function (m, p) { return Math.min(m, p.startMs); }, Infinity);
        var spanEnd = kept.reduce(function (m, p) { return Math.max(m, p.endMs); }, -Infinity);
        return {
            granularity: gran.id,
            sourceLabel: gran.label,
            periods: kept,
            periodCount: kept.length,
            coveredDays: days,
            elapsedDays: Math.max(1, elapsed),
            coverageRatio: days / Math.max(1, elapsed),
            spanStart: isoDate(new Date(spanStart)),
            spanEnd: isoDate(new Date(spanEnd))
        };
    }

    /* Pick the granularity that actually covers the most of the quarter.
     *
     * Priority only breaks ties, and it runs quarter first, then months, then
     * weeks: when two sources cover the same span, the one whose edges line up
     * with the quarter is the truer figure.
     */
    function chooseQuarterSource(year, quarter, options) {
        var opts = options || {};
        var bounds = quarterBounds(year, quarter);
        if (!bounds) return null;
        var todayMs = opts.todayMs || _todayMs();
        var periods = opts.periods || describePeriods(opts.store);
        var candidates = GRANULARITIES.map(function (g) {
            return buildCandidate(g, periods, bounds, todayMs);
        }).filter(Boolean);
        if (!candidates.length) return null;

        // A day of slack, so a month set that misses a single boundary day does
        // not lose to a week set that happens to reach one day further.
        var best = candidates[0];
        candidates.forEach(function (c) {
            if (c.coveredDays > best.coveredDays + 1) best = c;
        });
        return { bounds: bounds, chosen: best, candidates: candidates };
    }

    /* ── The aggregate ── */

    // One quarter, every associate, correctly weighted.
    //
    // The weighting is not reimplemented here. period-compare's
    // aggregateEmployeesFrom is the version that survived the survey
    // denominator fixes: each survey question by its own response count, every
    // rate by call volume, missed hours summed rather than maxed. Handing it a
    // single-granularity period set is the whole job.
    function buildQuarterAggregate(year, quarter, options) {
        var pick = chooseQuarterSource(year, quarter, options);
        if (!pick) return null;
        var pc = _periodCompare();
        if (!pc || typeof pc.aggregateEmployeesFrom !== 'function') return null;

        var rows = pc.aggregateEmployeesFrom(pick.chosen.periods.map(function (p) { return p.entry; }));
        rows.forEach(finishQuarterRow);
        var byName = {};
        rows.forEach(function (r) { byName[r.name] = r; });

        return {
            year: pick.bounds.year,
            quarter: pick.bounds.quarter,
            name: pick.bounds.name,
            label: pick.bounds.label,
            startDate: pick.bounds.startDate,
            endDate: pick.bounds.endDate,
            spanStart: pick.chosen.spanStart,
            spanEnd: pick.chosen.spanEnd,
            granularity: pick.chosen.granularity,
            sourceLabel: pick.chosen.sourceLabel,
            periodCount: pick.chosen.periodCount,
            periodKeys: pick.chosen.periods.map(function (p) { return p.key; }),
            coveredDays: pick.chosen.coveredDays,
            elapsedDays: pick.chosen.elapsedDays,
            coverageRatio: pick.chosen.coverageRatio,
            employees: byName,
            employeeList: rows
        };
    }

    // Argument-less on purpose. The test harness pins exactly this form, so a
    // suite can ask what this module does in March without waiting for March.
    function _todayMs() {
        return new Date().getTime();
    }

    /* Two corrections the generic aggregator cannot make on its own.
     *
     * It averages every rate, which is right for a rate whose denominator it
     * carries and wrong for transfers, where the counts and the calls are both
     * on the row. A weighted average of weekly transfer rates is not the
     * quarter's transfer rate; transfers over calls is.
     *
     * And it leaves missed hours as the sum for the span, which is the
     * quarter's own hours. That figure is useful to a supervisor and is not
     * what goes in front of an associate, so it is kept under its own name
     * rather than left in the field the rest of the app reads as the year.
     */
    function finishQuarterRow(row) {
        var count = parseFloat(row.transfersCount);
        var calls = parseFloat(row.totalCalls);
        if (Number.isFinite(count) && Number.isFinite(calls) && calls > 0 && count > 0) {
            row.transfers = (count / calls) * 100;
        }
        var rel = parseFloat(row.reliability);
        row.reliabilityAccrued = Number.isFinite(rel) ? Math.round(rel * 100) / 100 : null;
        return row;
    }

    /* ── The series ── */

    // Quarters of a year that have started, newest last. A quarter the calendar
    // has not reached is not a gap in the data, it is simply not due yet.
    function elapsedQuarters(year, todayMs) {
        var y = parseInt(year, 10);
        var today = new Date(todayMs || _todayMs());
        var out = [];
        for (var q = 1; q <= 4; q++) {
            var b = quarterBounds(y, q);
            if (!b) continue;
            if (b.startMs > today.getTime()) break;
            out.push(q);
        }
        return out;
    }

    /* Every quarter of a year, aggregated once.
     *
     * Built in one pass and handed round rather than rebuilt per associate:
     * with 127 associates, re-aggregating a quarter for each of them reads the
     * whole store 127 times over.
     */
    function buildYearQuarters(year, options) {
        var opts = options || {};
        var todayMs = opts.todayMs || _todayMs();
        var periods = opts.periods || describePeriods(opts.store);
        var quarters = (opts.quarters || elapsedQuarters(year, todayMs));
        var out = [];
        quarters.forEach(function (q) {
            var agg = buildQuarterAggregate(year, q, {
                periods: periods,
                todayMs: todayMs
            });
            var bounds = quarterBounds(year, q);
            out.push(agg || {
                year: bounds.year,
                quarter: q,
                name: bounds.name,
                label: bounds.label,
                startDate: bounds.startDate,
                endDate: bounds.endDate,
                granularity: null,
                sourceLabel: 'no uploads',
                periodCount: 0,
                periodKeys: [],
                coveredDays: 0,
                elapsedDays: 0,
                coverageRatio: 0,
                employees: {},
                employeeList: [],
                empty: true
            });
        });
        return out;
    }

    /* One metric, one associate, across the quarters given.
     *
     * Returns a point per quarter, including the quarters with no reading, so
     * a caller can say "no data for Q1" rather than silently drawing a line
     * from Q2 to Q3 and calling it the year.
     */
    function buildMetricSeries(employeeName, metricKey, quarterAggregates) {
        var points = (quarterAggregates || []).map(function (qa) {
            var emp = qa.employees ? qa.employees[employeeName] : null;
            var raw = emp ? emp[metricKey] : undefined;
            var val = parseFloat(raw);
            var has = Number.isFinite(val);
            return {
                quarter: qa.quarter,
                name: qa.name,
                label: qa.label,
                value: has ? val : null,
                hasValue: has,
                totalCalls: emp && Number.isFinite(parseFloat(emp.totalCalls)) ? parseFloat(emp.totalCalls) : 0,
                surveyCount: emp ? _surveyCountFor(metricKey, emp) : 0,
                spanStart: qa.spanStart || qa.startDate,
                spanEnd: qa.spanEnd || qa.endDate,
                sourceLabel: qa.sourceLabel,
                coverageRatio: qa.coverageRatio
            };
        });

        var measured = points.filter(function (p) { return p.hasValue; });
        var first = measured.length ? measured[0] : null;
        var last = measured.length ? measured[measured.length - 1] : null;
        var prior = measured.length > 1 ? measured[measured.length - 2] : null;

        return {
            metricKey: metricKey,
            points: points,
            measured: measured,
            measuredCount: measured.length,
            first: first,
            last: last,
            prior: prior,
            // One reading is a reading, not a direction. Without this guard the
            // single measured quarter is compared against itself and comes back
            // "stable", which reads in the document as "held steady all year"
            // on the strength of one number.
            overall: measured.length > 1 ? _direction(metricKey, last, first) : _direction(metricKey, null, null),
            latestMove: _direction(metricKey, last, prior)
        };
    }

    // The response count standing behind a survey metric, for the floor that
    // keeps a two-survey quarter from being read as a trend.
    function _surveyCountFor(metricKey, emp) {
        var fields = window.SURVEY_WEIGHT_FIELD || {};
        var field = fields[metricKey];
        if (!field) return 0;
        var own = parseInt(emp[field], 10);
        if (Number.isInteger(own) && own > 0) return own;
        var fallback = parseInt(emp.surveyTotal, 10);
        return Number.isInteger(fallback) && fallback > 0 ? fallback : 0;
    }

    /* Direction between two points, with the metric's polarity applied.
     *
     * metric-movement owns which way is better for a reverse metric, and owns
     * the band below which a move is noise rather than news. Recomputing either
     * here is how two screens end up disagreeing about the same pair of
     * numbers.
     */
    function _direction(metricKey, current, previous) {
        if (!current || !previous || !current.hasValue || !previous.hasValue) {
            return { direction: 'insufficient', delta: null, hasPrior: false };
        }
        var mm = _metricMovement();
        if (mm && typeof mm.resolveDirection === 'function') {
            var res = mm.resolveDirection(metricKey, current.value, previous.value);
            return {
                direction: res.direction,
                delta: res.delta,
                hasPrior: true,
                from: previous,
                to: current,
                rawChange: current.value - previous.value
            };
        }
        var better = current.value - previous.value;
        return {
            direction: better === 0 ? 'stable' : (better > 0 ? 'improving' : 'declining'),
            delta: better,
            hasPrior: true,
            from: previous,
            to: current,
            rawChange: current.value - previous.value
        };
    }

    /* ── Coverage readout ──
     *
     * What a supervisor needs before trusting any of the above: which quarters
     * are real, what they were built from, and how much of each one is actually
     * covered. There is no browser console here, so this is the answer to
     * "do I have Q1 and Q2 loaded".
     */
    function quarterCoverageReport(year, options) {
        var opts = options || {};
        var todayMs = opts.todayMs || _todayMs();
        var periods = opts.periods || describePeriods(opts.store);
        var quarters = elapsedQuarters(year, todayMs);
        return quarters.map(function (q) {
            var pick = chooseQuarterSource(year, q, { periods: periods, todayMs: todayMs });
            var bounds = quarterBounds(year, q);
            var complete = bounds.endMs <= todayMs;
            if (!pick) {
                return {
                    quarter: q, name: bounds.name, label: bounds.label,
                    startDate: bounds.startDate, endDate: bounds.endDate,
                    complete: complete, status: 'none', granularity: null,
                    sourceLabel: 'nothing uploaded', periodCount: 0,
                    coveredDays: 0, elapsedDays: 0, coverageRatio: 0,
                    headcount: 0, alternatives: []
                };
            }
            var chosen = pick.chosen;
            var ratio = chosen.coverageRatio;
            var status = ratio >= 0.95 ? 'full' : ratio >= 0.6 ? 'partial' : 'thin';
            var agg = buildQuarterAggregate(year, q, { periods: periods, todayMs: todayMs });
            return {
                quarter: q,
                name: bounds.name,
                label: bounds.label,
                startDate: bounds.startDate,
                endDate: bounds.endDate,
                spanStart: chosen.spanStart,
                spanEnd: chosen.spanEnd,
                complete: complete,
                status: status,
                granularity: chosen.granularity,
                sourceLabel: chosen.sourceLabel,
                periodCount: chosen.periodCount,
                coveredDays: chosen.coveredDays,
                elapsedDays: chosen.elapsedDays,
                coverageRatio: ratio,
                headcount: agg ? agg.employeeList.length : 0,
                alternatives: pick.candidates.map(function (c) {
                    return {
                        granularity: c.granularity,
                        sourceLabel: c.sourceLabel,
                        periodCount: c.periodCount,
                        coveredDays: c.coveredDays
                    };
                })
            };
        });
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.quarterTrend = {
        QUARTER_MONTHS: QUARTER_MONTHS,
        GRANULARITIES: GRANULARITIES,
        quarterBounds: quarterBounds,
        quarterOfDate: quarterOfDate,
        describePeriods: describePeriods,
        dropContained: dropContained,
        coveredDays: coveredDays,
        chooseQuarterSource: chooseQuarterSource,
        buildQuarterAggregate: buildQuarterAggregate,
        buildYearQuarters: buildYearQuarters,
        buildMetricSeries: buildMetricSeries,
        elapsedQuarters: elapsedQuarters,
        quarterCoverageReport: quarterCoverageReport
    };
})();
