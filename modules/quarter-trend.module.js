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
    // So each quarter is built from ONE granularity, chosen by how much of the
    // quarter it actually covers. Coverage decides; the priority below only
    // breaks ties, running quarter, then month, then week. That is the
    // opposite of the year-to-date aggregator in metric-trends, which always
    // prefers weeks, and the difference is deliberate: a year-to-date range is
    // arbitrary and weeks tile it finely, but a quarter is an exact calendar
    // span that a month row or a real quarter upload lines up with exactly.
    //
    // One grain per quarter is not quite enough on its own, because a period
    // belongs to the quarter its END date falls in. The week of Mar 30 to Apr
    // 5 therefore sits in Q2 carrying two March days, which is harmless while
    // both quarters use the same grain and is not harmless when Q1 resolves to
    // months and Q2 to weeks: March 30 is then inside Q1's March row AND
    // inside Q2's straddling week. buildYearQuarters closes that by walking
    // the quarters in order and refusing any period that reaches back into a
    // day an earlier quarter already used. Quarter and month rows sit exactly
    // on calendar boundaries, so it only ever fires on a week.
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

    /* Reduce a group to periods that do not share a day.
     *
     * Containment alone is not enough. Two uploads of the same quarter a day
     * apart, 04-01 to 06-30 and 04-02 to 06-30, contain neither the other, so
     * both survived and every figure in the quarter doubled: calls, surveys
     * and missed hours all accumulate. Re-uploading a period after a
     * correction is ordinary, and the two copies rarely line up to the day.
     *
     * So overlap is the test, not containment. Longest span first, and
     * anything that shares a day with something already kept is dropped, which
     * keeps the copy covering the most of the quarter and discards the rest.
     */
    function dropContained(periods) {
        var sorted = periods.slice().sort(function (a, b) {
            var spanA = a.endMs - a.startMs;
            var spanB = b.endMs - b.startMs;
            if (spanB !== spanA) return spanB - spanA;
            // Same span: the later upload wins, so a correction supersedes the
            // copy it corrects rather than losing to it on a tie.
            return b.startMs - a.startMs;
        });
        var kept = [];
        sorted.forEach(function (p) {
            var overlaps = kept.some(function (k) {
                return p.startMs <= k.endMs && p.endMs >= k.startMs;
            });
            if (!overlaps) kept.push(p);
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

    /* Build one granularity's candidate set for a quarter, with its coverage.
     *
     * `claimed` holds day spans an earlier quarter of the same year already
     * used. A period reaching back into one of those is dropped rather than
     * counted a second time.
     */
    function buildCandidate(gran, periods, bounds, todayMs, claimed) {
        var mine = periodsInQuarter(periods, bounds).filter(function (p) {
            return gran.types.indexOf(p.type) >= 0;
        });
        if (claimed && claimed.length) {
            mine = mine.filter(function (p) {
                return !claimed.some(function (c) {
                    return p.startMs <= c.endMs && p.endMs >= c.startMs;
                });
            });
        }
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
            return buildCandidate(g, periods, bounds, todayMs, opts.excludeOverlapping);
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
        var carried = columnsCarried(pick.chosen.periods);
        rows.forEach(function (row) { finishQuarterRow(row, carried[row.name]); });
        var byName = {};
        var byKey = {};
        rows.forEach(function (r) {
            byName[r.name] = r;
            byKey[employeeKey(r.name)] = r;
        });

        var aggregate = {
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
            // The day spans actually used, so the next quarter of the same
            // year can refuse a period reaching back into one of them.
            periodSpans: pick.chosen.periods.map(function (p) {
                return { startMs: p.startMs, endMs: p.endMs };
            }),
            coveredDays: pick.chosen.coveredDays,
            elapsedDays: pick.chosen.elapsedDays,
            coverageRatio: pick.chosen.coverageRatio,
            employees: byName,
            employeeList: rows
        };

        // A lookup index, not part of the aggregate. Defined non-enumerable so
        // it stays out of JSON.stringify: as a plain property it duplicated
        // every associate row into the behaviour baseline, adding four hundred
        // lines of noise to a file whose whole value is that a diff means
        // something.
        Object.defineProperty(aggregate, 'employeesByKey', {
            value: byKey, enumerable: false, writable: false
        });
        return aggregate;
    }

    // Argument-less on purpose. The test harness pins exactly this form, so a
    // suite can ask what this module does in March without waiting for March.
    function _todayMs() {
        return new Date().getTime();
    }

    /* One associate, however their name was spelled in a given upload.
     *
     * Rows are keyed by the exact string the export carried, so "Jordan Reyes"
     * in one quarter and "jordan reyes " in the next are two different people
     * as far as the aggregate is concerned. On a quarter over quarter document
     * that does not read as an error, it reads as a quarter with no data, and
     * the trend quietly loses a point.
     */
    function employeeKey(name) {
        return String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();
    }

    // Exact spelling first, so an upload that genuinely distinguishes two
    // similar names is never merged by the fallback.
    function findEmployee(quarterAggregate, name) {
        if (!quarterAggregate) return null;
        var exact = quarterAggregate.employees && quarterAggregate.employees[name];
        if (exact) return exact;
        var byKey = quarterAggregate.employeesByKey;
        return (byKey && byKey[employeeKey(name)]) || null;
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
    function finishQuarterRow(row, carried) {
        var supplied = carried || {};

        // Only recompute the rate when every period that fed this row actually
        // carried a transfer count. The aggregator starts the count at zero and
        // adds what it finds, so a quarter where one month is missing the
        // column divides a partial count by a complete call volume, and the
        // rate comes out low enough to look like an improvement.
        var count = parseFloat(row.transfersCount);
        var calls = parseFloat(row.totalCalls);
        if (supplied.transfersEverywhere
            && Number.isFinite(count) && Number.isFinite(calls) && calls > 0) {
            row.transfers = (count / calls) * 100;
        }

        // Zero hours missed and no attendance column at all are the same value
        // once the aggregator has finished, because it seeds the total at zero
        // and only adds readings it can parse. Written into a record they are
        // opposite claims: one says perfect attendance, the other says nothing
        // was measured. Nothing read means no figure.
        var rel = parseFloat(row.reliability);
        row.reliabilityAccrued = (supplied.reliabilityAny && Number.isFinite(rel))
            ? Math.round(rel * 100) / 100
            : null;
        return row;
    }

    /* Which columns the source rows for each associate actually carried.
     *
     * The parser writes '' for a column the export did not include, and null
     * for a survey count it did not include, so an absent column and a real
     * zero are indistinguishable by the time the aggregate is built. This
     * walks the source rows once to tell them apart.
     */
    function columnsCarried(periods) {
        var out = {};
        (periods || []).forEach(function (p) {
            ((p.entry && p.entry.employees) || []).forEach(function (emp) {
                if (!emp || !emp.name) return;
                if (!out[emp.name]) {
                    out[emp.name] = { reliabilityAny: false, transfersEverywhere: true, periods: 0 };
                }
                var seen = out[emp.name];
                seen.periods += 1;
                if (Number.isFinite(parseFloat(emp.reliability))) seen.reliabilityAny = true;
                if (!Number.isFinite(parseFloat(emp.transfersCount))) seen.transfersEverywhere = false;
            });
        });
        return out;
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

        // Days already spoken for by an earlier quarter of this same year.
        //
        // A period belongs to the quarter its END date falls in, so the week
        // of Mar 30 to Apr 5 sits in Q2 carrying two March days. Harmless
        // while both quarters use the same grain, because then the day is
        // described once. It stops being harmless when Q1 resolves to months
        // and Q2 to weeks: March 30 is then inside Q1's March row AND inside
        // Q2's straddling week, and an absence that day is charged to the year
        // twice. The mirror case loses those days instead.
        //
        // Forcing one grain on the whole year would prevent it and cost too
        // much: a Q1 uploaded as a quarter with Q2 and Q3 as months would lose
        // Q1 entirely. So each quarter still picks its own grain, and a period
        // reaching back into a day an earlier quarter already covered is
        // dropped here. Quarter and month rows sit exactly on calendar
        // boundaries, so this only ever fires on a week, which is the only
        // grain with edges that do not line up.
        var claimed = [];

        var out = [];
        quarters.forEach(function (q) {
            var agg = buildQuarterAggregate(year, q, {
                periods: periods,
                todayMs: todayMs,
                excludeOverlapping: claimed
            });
            if (agg) {
                agg.periodSpans.forEach(function (span) { claimed.push(span); });
            }
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
            var emp = findEmployee(qa, employeeName);
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

        // Walked in order against the same running claim the document uses,
        // so the panel reports the periods that actually fed each quarter
        // rather than every period that could have.
        var claimed = [];

        return quarters.map(function (q) {
            var pick = chooseQuarterSource(year, q, {
                periods: periods, todayMs: todayMs, excludeOverlapping: claimed
            });
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
            var agg = buildQuarterAggregate(year, q, {
                periods: periods, todayMs: todayMs, excludeOverlapping: claimed
            });
            if (agg) agg.periodSpans.forEach(function (span) { claimed.push(span); });
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
        employeeKey: employeeKey,
        findEmployee: findEmployee,
        columnsCarried: columnsCarried,
        coveredDays: coveredDays,
        chooseQuarterSource: chooseQuarterSource,
        buildQuarterAggregate: buildQuarterAggregate,
        buildYearQuarters: buildYearQuarters,
        buildMetricSeries: buildMetricSeries,
        elapsedQuarters: elapsedQuarters,
        quarterCoverageReport: quarterCoverageReport
    };
})();
