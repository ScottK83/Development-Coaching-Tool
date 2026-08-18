/* ============================================
   PERIOD COMPARE
   Builds month-sized and YTD-sized employee aggregates out of stored periods,
   and turns two of them into rank movement ("100th last month, 75th this month").

   Rank is never stored anywhere — center-ranking computes it on demand from
   whatever employee array it is handed. So "last month's rank" is not history
   being read back, it is last month's data being re-ranked now. That is what
   makes this possible without a migration, and also why the aggregate has to be
   built correctly: a sloppy aggregate silently produces a plausible wrong rank.

   Three things this module exists to get right:

   1. Weighted aggregation. Rate metrics are weighted by call volume, survey
      metrics by survey count. Simple-averaging a rate across weeks overweights
      the quiet weeks and is wrong every time.

   2. Reliability. It is CUMULATIVE year-to-date hours, not a per-period figure,
      and it feeds the rank composite. It is SCORED on the running total, because
      the budget it is measured against is annual and a slice of it means nothing
      — see the long note above the substitution in buildMonthAggregate. What a
      month carries is therefore the total as of THAT month, taken from the
      newest year-to-date file that had closed by then; the hours accrued in the
      month itself ride along as reliabilityAccrued, for coaching, never scored.

   3. Population. A rank delta only means something when both sides ranked the
      same people. If ten reps had no data last month, everyone's rank shifts for
      reasons unrelated to performance. Movement is computed over the people
      present in BOTH periods, and the shared count is reported so the caller can
      say what the rank is out of.
   ============================================ */
(function () {
    'use strict';

    // A month rebuilt from weekly uploads needs at least this many weeks behind
    // it. One week of June against one week of May is not monthly movement, it is
    // a gap in the uploads wearing a month's name. Matches cheerleading.
    var MIN_WEEKS_FOR_MONTH = 2;

    // Marks a period key as a month assembled on demand rather than one stored
    // under that key. Kept in step with center-ranking's copy.
    var MONTH_KEY_PREFIX = 'month:';

    // A month covering this little of the centre is a partial upload wearing a
    // month's name — one team's report filed as "July", say. The shared-population
    // guard already refuses to rank 18 people against 123, but honest is not the
    // same as useful: an 18-person rank displayed beside a 127-person one reads as
    // a centre rank and is not one. Partial months stay selectable as periods in
    // their own right; they just cannot anchor a comparison.
    var PARTIAL_MONTH_FRACTION = 0.6;

    var METRIC_KEYS_TO_AVERAGE = [
        'scheduleAdherence', 'transfers', 'cxRepOverall', 'fcr', 'overallExperience',
        'aht', 'talkTime', 'acw', 'holdTime', 'overallSentiment', 'managingEmotions',
        'negativeWord', 'positiveWord'
    ];
    /* Which response count each survey rate is weighted by.

       All three used to share the Overall Experience count, because that was the
       only one parsed. That is wrong twice: a rep-sat figure is weighted by a
       denominator it does not belong to, and — worse — a week where nobody
       answered the rep-sat question cannot be told from a week that scored 0%,
       because both arrive as 0 with a positive OE weight. A rep whose real rep
       sat was 100% across the month came out at 66.7%, which flipped the KPI
       from a 3 to a 1.

       Falls back to surveyTotal when the export did not carry the column, which
       is exactly the old behaviour. */
    var SURVEY_WEIGHT_FIELD = {
        cxRepOverall: 'repSurveyTotal',
        fcr: 'fcrSurveyTotal',
        overallExperience: 'surveyTotal'
    };

    var MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    /* ── Store access ── */

    function _weeklyData() {
        return typeof weeklyData !== 'undefined' ? weeklyData : {};
    }
    function _year() {
        return new Date().getFullYear();
    }
    function _entry(key) {
        return _weeklyData()[key] || null;
    }
    function _meta(key) {
        var p = _entry(key);
        return (p && p.metadata) || {};
    }
    function _endDate(key) {
        return _meta(key).endDate || (String(key).indexOf('|') !== -1 ? String(key).split('|')[1] : String(key));
    }
    function _startDate(key) {
        return _meta(key).startDate || (String(key).indexOf('|') !== -1 ? String(key).split('|')[0] : '');
    }
    function _endMonth(key) {
        return String(_endDate(key)).slice(0, 7); // YYYY-MM
    }
    function _periodType(key) {
        return _meta(key).periodType || 'week';
    }
    function _yearOf(key) {
        return parseInt(String(_endDate(key)).split('-')[0], 10);
    }
    function _spanDays(key) {
        var s = _startDate(key), e = _endDate(key);
        if (!s || !e) return 0;
        var sd = new Date(s + 'T00:00:00'), ed = new Date(e + 'T00:00:00');
        if (isNaN(sd.getTime()) || isNaN(ed.getTime())) return 0;
        return Math.round((ed - sd) / 86400000) + 1;
    }

    function _nowMonth() {
        var now = new Date();
        return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    }

    function _monthLabel(monthKey) {
        var parts = String(monthKey).split('-');
        var mi = parseInt(parts[1], 10) - 1;
        return (MONTH_NAMES[mi] || monthKey) + ' ' + parts[0];
    }
    function _prevMonthKey(monthKey) {
        var parts = String(monthKey).split('-');
        var y = parseInt(parts[0], 10), m = parseInt(parts[1], 10);
        if (!y || !m) return null;
        if (m === 1) return (y - 1) + '-12';
        return y + '-' + String(m - 1).padStart(2, '0');
    }

    /* ── Month bucketing ──
       Weeks bucket by the month they END in, so "July" means the weeks ending in
       July (roughly Jun 29 - Jul 26). A real monthly upload replaces the
       reconstruction for its month, because the uploaded report is the number
       that will be quoted back to people. */

    function getMonthBuckets(year) {
        var yr = year || _year();
        var wData = _weeklyData();
        var monthsMap = {};
        var fromUpload = {};

        Object.keys(wData).forEach(function (k) {
            if (_periodType(k) !== 'week') return;
            if (_yearOf(k) !== yr) return;
            var mo = _endMonth(k);
            if (mo) (monthsMap[mo] = monthsMap[mo] || []).push(k);
        });

        // Head count for a set of period keys, by distinct name.
        function _headCount(keys) {
            var names = {};
            (keys || []).forEach(function (k) {
                var e = _entry(k);
                ((e && e.employees) || []).forEach(function (emp) {
                    if (emp && emp.name) names[emp.name] = 1;
                });
            });
            return Object.keys(names).length;
        }

        /* A month-to-date upload is the real month so far, straight from the
           source. It beats the weekly rebuild for its month outright — the
           rebuild runs on whole weeks, so it starts in the previous month and
           stops at the last finished week, which is exactly the mismatch a
           month-to-date row exists to remove.

           No fortnight floor and no head-count test: it only ever describes the
           current month, it is never offered for backfill, and on the second of
           the month one day of real data still beats nothing or a rebuild made
           mostly of last month. It stays flagged in progress either way. */
        var _nowMo = _nowMonth();
        Object.keys(wData).forEach(function (k) {
            if (_periodType(k) !== 'month-to-date') return;
            if (_yearOf(k) !== yr) return;
            var mtdMo = String(_endDate(k)).slice(0, 7);
            if (mtdMo !== _nowMo) return;
            monthsMap[mtdMo] = [k];
            fromUpload[mtdMo] = true;
        });

        Object.keys(wData).forEach(function (k) {
            if (_periodType(k) !== 'month') return;
            if (_yearOf(k) !== yr) return;
            if (_spanDays(k) < MIN_WEEKS_FOR_MONTH * 7) return;
            var mo = String(_endDate(k)).slice(0, 7);

            // Two uploads covering one month: the later one wins.
            if (fromUpload[mo] && String(_endDate(monthsMap[mo][0])).localeCompare(String(_endDate(k))) >= 0) return;

            // An uploaded month is authoritative for its month — the report is what
            // gets quoted back to people — so it wins even when its head count sits
            // a little under the weekly rebuild. People join and leave mid-month,
            // and a 122-person report against 127 distinct names across five weeks
            // is roster drift, not an incomplete file.
            //
            // It only loses when it covers a fraction of the centre: one team's
            // report filed as "July" would otherwise discard four complete weekly
            // uploads and leave the month looking like 18 people.
            var weeklyKeys = fromUpload[mo] ? [] : (monthsMap[mo] || []);
            if (weeklyKeys.length && _headCount([k]) < _headCount(weeklyKeys) * PARTIAL_MONTH_FRACTION) return;

            monthsMap[mo] = [k];
            fromUpload[mo] = true;
        });

        Object.keys(monthsMap).forEach(function (mo) {
            monthsMap[mo].sort(function (a, b) {
                return String(_endDate(a)).localeCompare(String(_endDate(b)));
            });
        });

        var now = new Date();
        var nowMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        var usable = Object.keys(monthsMap).filter(function (mo) {
            if (mo > nowMonth) return false;
            return fromUpload[mo] || monthsMap[mo].length >= MIN_WEEKS_FOR_MONTH;
        }).sort();

        // Head count per month, measured against the fullest month of the year
        // rather than the roster, so this keeps working while the roster changes.
        var counts = {};
        usable.forEach(function (mo) {
            var names = {};
            (monthsMap[mo] || []).forEach(function (k) {
                var e = _entry(k);
                ((e && e.employees) || []).forEach(function (emp) {
                    if (emp && emp.name) names[emp.name] = 1;
                });
            });
            counts[mo] = Object.keys(names).length;
        });

        var fullest = usable.reduce(function (max, mo) { return Math.max(max, counts[mo] || 0); }, 0);
        var partial = {};
        usable.forEach(function (mo) {
            partial[mo] = fullest > 0 && (counts[mo] || 0) < fullest * PARTIAL_MONTH_FRACTION;
        });
        var comparable = usable.filter(function (mo) { return !partial[mo]; });

        return {
            monthsMap: monthsMap,
            fromUpload: fromUpload,
            usable: usable,
            counts: counts,
            partial: partial,
            comparable: comparable
        };
    }

    /* ── Weighted aggregation ──
       Mirrors buildYtdAggregateForYear's math. Reliability is SUMMED here, which
       is right for weekly rows: a weekly upload carries the hours missed in that
       week, so the total across a month's weeks is the hours missed in the month.
       buildMonthAggregate keeps that as reliabilityAccrued and then replaces the
       scored value with the running year-to-date total as of that month. */

    function aggregateEmployeesFrom(entries) {
        var agg = {};

        (entries || []).forEach(function (entry) {
            ((entry && entry.employees) || []).forEach(function (emp) {
                if (!emp || !emp.name) return;

                if (!agg[emp.name]) {
                    agg[emp.name] = {
                        name: emp.name,
                        firstName: emp.firstName,
                        transfersCount: 0,
                        surveyTotal: 0,
                        repSurveyTotal: 0,
                        fcrSurveyTotal: 0,
                        reliability: 0,
                        totalCalls: 0,
                        _periodsSeen: 0,
                        _sums: {},
                        _weights: {}
                    };
                }

                var a = agg[emp.name];
                var surveyTotal = parseInt(emp.surveyTotal, 10);
                var totalCalls = parseInt(emp.totalCalls, 10);

                // A rate's own denominator, or the Overall Experience count when
                // the export never carried one. Null and undefined both mean
                // "column absent", not "nobody answered".
                var surveyWeightFor = function (metricKey) {
                    var field = SURVEY_WEIGHT_FIELD[metricKey];
                    if (!field) return 0;
                    var own = emp[field];
                    if (own === null || own === undefined || own === '') {
                        return Number.isInteger(surveyTotal) && surveyTotal > 0 ? surveyTotal : 0;
                    }
                    var n = parseInt(own, 10);
                    return Number.isInteger(n) && n > 0 ? n : 0;
                };

                a._periodsSeen += 1;
                a.transfersCount += Number.isFinite(parseFloat(emp.transfersCount)) ? parseFloat(emp.transfersCount) : 0;
                a.surveyTotal += Number.isInteger(surveyTotal) ? surveyTotal : 0;
                a.repSurveyTotal += surveyWeightFor('cxRepOverall');
                a.fcrSurveyTotal += surveyWeightFor('fcr');
                a.totalCalls += Number.isInteger(totalCalls) ? totalCalls : 0;

                // ADDITIVE across weekly periods. A weekly upload carries the hours
                // missed IN THAT WEEK, not a running total — a typical sequence is
                // 0, 0, 0, 8.5, 0, one bad week among zeroes. Taking the highest
                // value seen (which the older YTD aggregator does) keeps the single
                // worst week and discards every other absence.
                var rel = parseFloat(emp.reliability);
                if (Number.isFinite(rel)) a.reliability += rel;

                METRIC_KEYS_TO_AVERAGE.forEach(function (mk) {
                    var val = parseFloat(emp[mk]);
                    if (!Number.isFinite(val)) return;
                    var weight;
                    if (SURVEY_WEIGHT_FIELD[mk]) {
                        weight = surveyWeightFor(mk);
                    } else {
                        weight = Number.isInteger(totalCalls) && totalCalls > 0 ? totalCalls : 1;
                    }
                    if (weight <= 0) return;
                    a._sums[mk] = (a._sums[mk] || 0) + val * weight;
                    a._weights[mk] = (a._weights[mk] || 0) + weight;
                });
            });
        });

        return Object.keys(agg).map(function (name) {
            var a = agg[name];
            METRIC_KEYS_TO_AVERAGE.forEach(function (mk) {
                var w = a._weights[mk] || 0;
                if (w > 0) a[mk] = a._sums[mk] / w;
            });
            delete a._sums;
            delete a._weights;
            return a;
        });
    }

    /* ── Reliability: the running year-to-date total, as of a given month ── */

    function _ytdData() {
        return typeof ytdData !== 'undefined' ? ytdData : {};
    }

    // Year-to-date hours missed per person, from the newest YTD upload of the year.
    // That upload is the only complete running total available: weekly uploads only
    // go back as far as someone started uploading them, and the months before that
    // cannot be reconstructed from anything on hand.
    /* opts.asOfMonth ('YYYY-MM') picks the newest year-to-date file that had
       already closed by the end of that month, rather than the newest one there
       is. Without it, January was scored with the hours someone had missed by
       August — absence that had not happened yet — and since kpisMet is the first
       sort key that cost a whole tier in every historical month, not a nudge.

       With no file old enough there is nothing honest to say, so the answer is
       empty and scoreEmployee treats reliability as unmeasured. Guessing is worse:
       0 is a perfect score. */
    function _latestYtdReliability(year, opts) {
        var yData = _ytdData();
        var asOf = opts && opts.asOfMonth ? String(opts.asOfMonth) : null;
        var best = null, bestEnd = '';
        Object.keys(yData).forEach(function (k) {
            var meta = (yData[k] && yData[k].metadata) || {};
            var end = meta.endDate || (k.indexOf('|') !== -1 ? k.split('|')[1] : k);
            if (parseInt(String(end).split('-')[0], 10) !== year) return;
            // A file ending inside the month still describes that month's total.
            if (asOf && String(end).slice(0, 7) > asOf) return;
            if (!best || String(end).localeCompare(bestEnd) > 0) { best = yData[k]; bestEnd = String(end); }
        });
        if (!best) return {};

        var out = {};
        (best.employees || []).forEach(function (emp) {
            if (!emp || !emp.name) return;
            var rel = parseFloat(emp.reliability);
            if (Number.isFinite(rel)) out[emp.name] = rel;
        });
        return out;
    }

    /* ── Month aggregate ── */

    function buildMonthAggregate(monthKey, year) {
        var yr = year || _year();
        var buckets = getMonthBuckets(yr);
        var keys = buckets.monthsMap[monthKey];
        if (!keys || !keys.length) return null;
        if (!buckets.fromUpload[monthKey] && keys.length < MIN_WEEKS_FOR_MONTH) return null;

        var employees = aggregateEmployeesFrom(keys.map(_entry));
        if (!employees.length) return null;

        // Two figures per person: what they missed IN this month (summed from the
        // weeks above) and the running year-to-date total as of this month. The
        // first is for coaching, the second is what gets scored.
        var ytdRel = _latestYtdReliability(yr, { asOfMonth: monthKey });
        employees.forEach(function (e) {
            // Aggregation summed the month's weeks, so this IS hours missed in the
            // month. Kept for coaching — "you missed 6 hours in July" is the useful
            // sentence — but never scored.
            e.reliabilityAccrued = Math.round(e.reliability * 100) / 100;
            e.reliabilityCumulative = Number.isFinite(ytdRel[e.name]) ? ytdRel[e.name] : null;

            // SCORED ON THE CUMULATIVE YEAR-TO-DATE FIGURE, in every period.
            //
            // Reliability is unlike every other metric here. AHT, sentiment and the
            // survey scores are rates that stand on their own in any window — a bad
            // week can be followed by a good one. Reliability is hours of work
            // missed against a budget for the WHOLE YEAR (18 for a 3, 24 for a 2),
            // and hours already missed cannot be un-missed. Most weeks it is
            // untouched and adds nothing; then someone misses two days.
            //
            // So a per-period slice is meaningless. Scoring a month's accrued hours
            // (~1.4) against an annual 18 passed everybody — the centre averaged
            // 2.97 of 3 monthly against 2.37 on YTD. Annualising that slice was no
            // better: one bad month projects to a catastrophic year for someone
            // whose actual year-to-date total is still well inside budget.
            //
            // The figure that answers "are they on track for the year" is the
            // running total, so that is what gets scored, whatever period is being
            // viewed. A consequence worth stating: reliability can only hold or
            // worsen month over month, never improve. That is the metric being
            // honest, not a bug — you cannot go back and not miss the shift. It holds
            // only while both months read the same year-to-date file; asOfMonth is
            // what lets an earlier month carry a smaller total than a later one.
            //
            // Sourced from the YTD upload rather than rebuilt from weeks, because
            // weekly coverage starts partway through the year and everything before
            // it is unrecoverable — a rebuild would understate the year and quietly
            // hand people a pass they have not earned. With no YTD upload the value
            // is left null, which scoreEmployee treats as unmeasured. Unmeasured is
            // correct here: 0 is a perfect score, so guessing would crown people.
            e.reliability = e.reliabilityCumulative;
        });

        var spanStart = keys.reduce(function (min, k) {
            var d = _startDate(k);
            return (!min || String(d) < min) ? String(d) : min;
        }, '');
        var spanEnd = keys.reduce(function (max, k) {
            var d = _endDate(k);
            return (!max || String(d) > max) ? String(d) : max;
        }, '');

        return {
            key: monthKey,
            label: _monthLabel(monthKey),
            employees: employees,
            weekKeys: keys.slice(),
            fromUpload: !!buckets.fromUpload[monthKey],
            weekCount: keys.length,
            // The dates this month actually covers. A rebuild runs from the start
            // of the first week ENDING in the month, so "August" can begin in July
            // — which is exactly the gap between this column and a calendar-month
            // report someone is holding it up against.
            spanStart: spanStart || null,
            spanEnd: spanEnd || null
        };
    }

    /* ── Rank movement ── */

    function _rank(employees, year) {
        var cr = window.DevCoachModules && window.DevCoachModules.centerRanking;
        if (!cr || !cr.scoreAndRankEmployees) return null;
        return cr.scoreAndRankEmployees(employees, year);
    }

    /**
     * Rank two employee sets over the people common to both, so the denominator
     * is identical on each side and a delta reflects performance rather than a
     * changing population.
     *
     * Returns null when the overlap is too thin to say anything.
     */
    // Ranks both sides over the people common to both. Shared by the individual
    // and team comparisons so they can never disagree about who was included.
    function _rankShared(prevEmployees, curEmployees, year, minShared) {
        var prevByName = {}, curByName = {};
        (prevEmployees || []).forEach(function (e) { if (e && e.name) prevByName[e.name] = e; });
        (curEmployees || []).forEach(function (e) { if (e && e.name) curByName[e.name] = e; });

        var shared = Object.keys(curByName).filter(function (n) { return n in prevByName; });
        if (shared.length < minShared) return null;

        var prevRanked = _rank(shared.map(function (n) { return prevByName[n]; }), year);
        var curRanked = _rank(shared.map(function (n) { return curByName[n]; }), year);
        if (!prevRanked || !curRanked) return null;

        return { shared: shared, prevByName: prevByName, curByName: curByName, prevRanked: prevRanked, curRanked: curRanked };
    }

    function compareRankings(prevEmployees, curEmployees, year, opts) {
        var options = opts || {};
        var minShared = Number.isFinite(options.minShared) ? options.minShared : 5;
        var yr = year || _year();

        var ranked = _rankShared(prevEmployees, curEmployees, yr, minShared);
        if (!ranked) return null;
        var shared = ranked.shared, prevByName = ranked.prevByName, curByName = ranked.curByName;
        var prevRanked = ranked.prevRanked, curRanked = ranked.curRanked;

        var prevByName2 = {};
        prevRanked.forEach(function (r) { prevByName2[r.name] = r; });

        var movements = curRanked.map(function (r) {
            var was = prevByName2[r.name];
            var has = was && Number.isFinite(was.rank) && Number.isFinite(r.rank);

            // Rank alone cannot carry this. The composite sorts on KPIs met, then
            // score sum, then rank total — and a whole centre compresses into very
            // few distinct (kpisMet, scoreSum) buckets, the biggest holding twenty
            // or more people who are effectively tied. Order inside a bucket turns
            // on tiebreakers, so someone can move twenty ranks without a single
            // metric changing. Carrying the score change alongside lets a caller
            // tell a real improvement from a reshuffle among equals.
            var scoreSumDelta = has ? (r.scoreSum - was.scoreSum) : null;
            var kpisMetDelta = has ? (r.kpisMet - was.kpisMet) : null;

            return {
                name: r.name,
                curRank: r.rank,
                prevRank: has ? was.rank : null,
                // Positive means improved — moved toward 1st.
                delta: has ? (was.rank - r.rank) : null,
                scoreSumDelta: scoreSumDelta,
                kpisMetDelta: kpisMetDelta,
                prevScoreSum: has ? was.scoreSum : null,
                curScoreSum: r.scoreSum,
                prevKpisMet: has ? was.kpisMet : null,
                curKpisMet: r.kpisMet,
                // How many of the five were measured, so a caller never prints
                // "3/5 KPIs" for someone only three KPIs were scored on.
                prevMeasuredCount: has ? was.measuredCount : null,
                curMeasuredCount: r.measuredCount,
                // True when the underlying scoring actually moved. False means the
                // rank changed while performance did not.
                scoreChanged: has ? (scoreSumDelta !== 0 || kpisMetDelta !== 0) : false,
                compositeScore: r.compositeScore,
                kpisMet: r.kpisMet,
                ratingAverage: r.ratingAverage
            };
        });

        // Anyone ranked in only one of the two periods. Reported rather than
        // hidden, so a thin comparison is visible as thin.
        var onlyCurrent = Object.keys(curByName).filter(function (n) { return !(n in prevByName); });
        var onlyPrevious = Object.keys(prevByName).filter(function (n) { return !(n in curByName); });

        return {
            total: shared.length,
            movements: movements,
            onlyCurrent: onlyCurrent.sort(),
            onlyPrevious: onlyPrevious.sort()
        };
    }

    /**
     * How each supervisor's team moved between two periods.
     *
     * Ranked on average KPI score, NOT on average rank position. Average rank is a
     * function of who else was in the pool — a team can shed a weak performer and
     * every remaining member's rank improves without anyone doing anything
     * differently. Average KPI score is on a fixed 1-3 scale, so a team that scored
     * 2.31 and now scores 2.58 genuinely improved, whatever anyone else did.
     *
     * Average rank is still reported alongside, because it is the number visible on
     * the rankings table and leaving it out invites the two being reconciled by hand.
     */
    function compareTeams(prevEmployees, curEmployees, supervisors, year, opts) {
        var options = opts || {};
        var minShared = Number.isFinite(options.minShared) ? options.minShared : 5;
        var minTeamSize = Number.isFinite(options.minTeamSize) ? options.minTeamSize : 3;
        var yr = year || _year();
        var sups = supervisors || {};

        var ranked = _rankShared(prevEmployees, curEmployees, yr, minShared);
        if (!ranked) return null;

        function group(rankedList) {
            var out = {};
            rankedList.forEach(function (r) {
                var sup = sups[r.name];
                if (!sup) return; // unassigned people cannot be attributed to a team
                if (!out[sup]) out[sup] = { ratings: [], ranks: [] };
                if (Number.isFinite(r.ratingAverage)) out[sup].ratings.push(r.ratingAverage);
                if (Number.isFinite(r.rank)) out[sup].ranks.push(r.rank);
            });
            return out;
        }

        function summarise(grouped) {
            var out = {};
            Object.keys(grouped).forEach(function (name) {
                var g = grouped[name];
                if (g.ratings.length < minTeamSize) return;
                var mean = function (a) { return a.reduce(function (x, y) { return x + y; }, 0) / a.length; };
                out[name] = {
                    count: g.ratings.length,
                    avgRating: mean(g.ratings),
                    avgRank: g.ranks.length ? mean(g.ranks) : null
                };
            });
            return out;
        }

        var prev = summarise(group(ranked.prevRanked));
        var cur = summarise(group(ranked.curRanked));

        var names = Object.keys(cur).filter(function (n) { return n in prev; });
        if (names.length < 2) return null;

        // Standard competition placing (1-2-2-4) with an epsilon tie test. Two teams
        // on the same average must share a place: assigning them separate places on
        // sort order alone means a tie breaking the other way next month shows up as
        // movement, and there is no performance behind it.
        function placings(stats, keys) {
            var order = keys.slice().sort(function (a, b) { return stats[b].avgRating - stats[a].avgRating; });
            var out = {};
            var lastPlace = 0, lastVal = null;
            order.forEach(function (n, i) {
                var val = stats[n].avgRating;
                if (lastVal === null || Math.abs(val - lastVal) >= 1e-9) {
                    lastPlace = i + 1;
                }
                out[n] = lastPlace;
                lastVal = val;
            });
            return out;
        }
        var prevPlace = placings(prev, names);
        var curPlace = placings(cur, names);

        var teams = names.map(function (n) {
            return {
                name: n,
                count: cur[n].count,
                prevCount: prev[n].count,
                prevAvgRating: prev[n].avgRating,
                curAvgRating: cur[n].avgRating,
                ratingDelta: cur[n].avgRating - prev[n].avgRating,
                prevAvgRank: prev[n].avgRank,
                curAvgRank: cur[n].avgRank,
                prevPlace: prevPlace[n],
                curPlace: curPlace[n],
                // Positive means moved toward 1st.
                placeDelta: prevPlace[n] - curPlace[n]
            };
        }).sort(function (a, b) { return a.curPlace - b.curPlace; });

        return { total: ranked.shared.length, teamCount: names.length, teams: teams };
    }

    /**
     * The headline case: the two most recent usable months, compared.
     * Returns null when there aren't two months worth comparing.
     */
    function buildMonthOverMonthRanks(year) {
        return buildMovementForScope('month', { year: year });
    }

    /**
     * Individual rank movement between two periods of one granularity — the
     * counterpart to buildTeamMovementForScope, so the rankings table and the
     * matchup panel can be made to answer about the same window.
     *
     * opts.anchorKey names the period to measure TO. Without it the newest
     * comparable period is used. With it, someone looking at the week ending the
     * 12th sees how that week moved rather than how the newest week moved — a
     * column describing a period the table is not showing reads as a bug however
     * carefully it is captioned.
     */
    function buildMovementForScope(scope, opts) {
        var options = opts || {};
        var yr = options.year || _year();
        var sc = scope || 'month';

        var all = _periodsForScope(sc, yr);
        // Partial periods are stepped over rather than compared, so a one-team
        // upload filed as a month cannot become the headline comparison.
        var usable = all.filter(function (p) { return !p.partial; });
        if (usable.length < 2) return null;

        var curIdx = usable.length - 1;
        var steppedOverInProgress = null;
        if (options.anchorKey) {
            // From 1, not 0: the oldest period has nothing behind it to compare
            // against, so anchoring there falls back to the newest pair.
            for (var i = 1; i < usable.length; i++) {
                if (String(usable[i].key) === String(options.anchorKey)) { curIdx = i; break; }
            }
        } else if (usable[curIdx].inProgress && curIdx >= 2) {
            /* A month still being lived in is not a month. Two weeks of August
               against four weeks of July moves people tens of ranks on nothing but
               a shorter sample, and the head-count guard never catches it because
               the roster barely changes. Weeks already work this way — a
               week-in-progress is excluded outright — and months were the one
               granularity that never got the same treatment.

               Stepped over only while a complete pair remains behind it, so the
               column does not vanish in the first days of a month; when the
               unfinished month is the only comparison available it is kept and
               flagged instead. Reported either way, because a June-to-July
               comparison shown in August looks stale unless it says why. */
            steppedOverInProgress = usable[curIdx];
            curIdx -= 1;
        }
        var cur = usable[curIdx];
        var prev = usable[curIdx - 1];

        var compared = compareRankings(prev.employees, cur.employees, yr);
        if (!compared) return null;

        // A part-month must not read as a finished one.
        var nowMonth = _nowMonth();

        return {
            scope: sc,
            current: { key: cur.key, label: cur.label, weekCount: cur.weekCount, fromUpload: cur.fromUpload, inProgress: sc === 'month' && cur.key === nowMonth },
            previous: { key: prev.key, label: prev.label, weekCount: prev.weekCount, fromUpload: prev.fromUpload },
            // Periods newer than the pair that were passed over as partial.
            // Surfaced so a stale-looking comparison explains itself instead of
            // just looking wrong.
            skippedPartial: all.filter(function (p) {
                return p.partial && String(p.key) > String(prev.key);
            }).map(function (p) {
                return { key: p.key, label: p.label, count: p.count };
            }),
            // The unfinished month that was passed over, so the caller can say why
            // the comparison stops short of today.
            skippedInProgress: steppedOverInProgress
                ? { key: steppedOverInProgress.key, label: steppedOverInProgress.label,
                    count: steppedOverInProgress.count, weekCount: steppedOverInProgress.weekCount }
                : null,
            // True when an unfinished period is one side of the comparison anyway —
            // either the viewer asked for it, or it was the only thing available.
            comparingInProgress: sc === 'month' && cur.key === nowMonth,
            total: compared.total,
            movements: compared.movements,
            onlyCurrent: compared.onlyCurrent,
            onlyPrevious: compared.onlyPrevious
        };
    }

    /* Every month of the year so far, ranked or not, and why not.

       A trajectory that silently starts in May looks like the year started in
       May. It did not — those months exist, they just could not be ranked, and
       the difference between "no data" and "one week of data" and "one team's
       upload" is the difference between shrugging and knowing which file to go
       and find. So all twelve slots are returned and the empty ones carry their
       reason. */
    function buildMonthCoverage(year) {
        var yr = year || _year();
        var buckets = getMonthBuckets(yr);
        var nowMonth = _nowMonth();
        var out = [];

        for (var m = 1; m <= 12; m++) {
            var mo = yr + '-' + String(m).padStart(2, '0');
            if (mo > nowMonth) break;

            var keys = buckets.monthsMap[mo] || [];
            var names = {};
            keys.forEach(function (k) {
                var e = _entry(k);
                ((e && e.employees) || []).forEach(function (emp) {
                    if (emp && emp.name) names[emp.name] = 1;
                });
            });
            var count = Object.keys(names).length;
            var isUsable = buckets.usable.indexOf(mo) !== -1;

            var entry = {
                key: mo,
                label: _monthLabel(mo),
                weekCount: keys.length,
                count: count,
                fromUpload: !!buckets.fromUpload[mo],
                inProgress: mo === nowMonth,
                status: 'none',
                reason: 'nothing uploaded for this month'
            };
            if (isUsable && !buckets.partial[mo]) {
                entry.status = 'ranked';
                entry.reason = '';
            } else if (isUsable) {
                entry.status = 'partial';
                entry.reason = 'only ' + count + ' associates in the upload';
            } else if (keys.length > 0) {
                entry.status = 'thin';
                entry.reason = keys.length + ' week' + (keys.length === 1 ? '' : 's') +
                    ' uploaded, ' + MIN_WEEKS_FOR_MONTH + ' needed to rebuild a month';
            }
            out.push(entry);
        }
        return out;
    }

    /* ── Rank timeline ──
       Every period of one granularity in order, with each person's rank in each.

       Two rank scales travel together here, deliberately, because that is what
       the rankings table and its movement column already do and a third answer
       would just be a fourth number to reconcile:

         - `rank` for a period is over the people scored IN THAT PERIOD. It is the
           number the table shows when that period is selected, so the timeline
           and the table can never disagree about a month.

         - `delta` into a period is measured over the people scored in BOTH it and
           the period before, because a rank out of 118 against a rank out of 126
           is not a like-for-like move. So the arrow is not always exactly the
           difference of the two ranks printed either side of it — and the shared
           ranks it IS the difference of travel alongside, for anyone who checks.

       Rank is never stored, so this is every month re-ranked on demand. That is
       ~2 rankings per month of data; cheap enough per render, cached anyway
       because the modal asks for it once per person. */
    var _timelineCache = {};

    function resetTimelineCache() {
        _timelineCache = {};
    }

    function buildRankTimeline(scope, year) {
        var yr = year || _year();
        var sc = scope || 'month';
        var cacheKey = sc + '|' + yr;
        if (Object.prototype.hasOwnProperty.call(_timelineCache, cacheKey)) return _timelineCache[cacheKey];

        // Partial periods are stepped over the same way the pairwise comparison
        // steps over them: a one-team upload filed as a month is not a point on
        // anybody's year. An unfinished month IS kept — the trajectory is the one
        // place where "so far" is worth seeing — and carries its flag.
        var usable = _periodsForScope(sc, yr).filter(function (p) { return !p.partial; });
        if (!usable.length) { _timelineCache[cacheKey] = null; return null; }

        var ranked = usable.map(function (p) { return _rank(p.employees, yr) || []; });

        var moves = usable.map(function () { return {}; });
        var moveTotals = usable.map(function () { return null; });
        for (var i = 1; i < usable.length; i++) {
            var cmp = compareRankings(usable[i - 1].employees, usable[i].employees, yr);
            if (!cmp) continue;
            var m = {};
            cmp.movements.forEach(function (mv) { m[mv.name] = mv; });
            moves[i] = m;
            moveTotals[i] = cmp.total;
        }

        var byName = {};
        ranked.forEach(function (rows, i) {
            var per = usable[i];
            rows.forEach(function (r) {
                var mv = moves[i][r.name] || null;
                if (!byName[r.name]) byName[r.name] = [];
                byName[r.name].push({
                    key: per.key,
                    label: per.label,
                    inProgress: !!per.inProgress,
                    fromUpload: !!per.fromUpload,
                    weekCount: per.weekCount || null,
                    spanStart: per.spanStart || null,
                    spanEnd: per.spanEnd || null,
                    // Over everyone scored in this period.
                    rank: r.rank,
                    total: rows.length,
                    kpisMet: r.kpisMet,
                    measuredCount: r.measuredCount,
                    scoreSum: r.scoreSum,
                    kpiScore: r.kpiScore,
                    trackLabel: r.trackLabel,
                    trackStatusValue: r.trackStatusValue,
                    /* The five KPIs themselves, not just what they totalled to.
                       "Down 39" is a fact about a rank; the question it always
                       raises is which metric moved, and that answer has to be in
                       the same payload or the caller ends up re-ranking the year
                       a second time to find it. Values, their 3/2/1 scores, and
                       the per-metric rank inside this period. */
                    values: r.values || {},
                    reliability: r.reliability,
                    reliabilityAccrued: r.reliabilityAccrued,
                    associateOverallSource: r.associateOverallSource || null,
                    scores: r.scores || {},
                    metricRanks: r.metricRanks || {},
                    // Over the people in this period and the one before it.
                    delta: mv && Number.isFinite(mv.delta) ? mv.delta : null,
                    sharedPrevRank: mv ? mv.prevRank : null,
                    sharedRank: mv ? mv.curRank : null,
                    sharedTotal: moveTotals[i],
                    scoreChanged: mv ? !!mv.scoreChanged : false
                });
            });
        });

        var out = {
            scope: sc,
            year: yr,
            periods: usable.map(function (per, i) {
                return { key: per.key, label: per.label, total: ranked[i].length, inProgress: !!per.inProgress };
            }),
            // Every month of the year, including the ones that produced no rank,
            // so a caller can show the whole year rather than the ranked part of it.
            coverage: sc === 'month' ? buildMonthCoverage(yr) : null,
            byName: byName
        };
        _timelineCache[cacheKey] = out;
        return out;
    }

    /** One person's trajectory, oldest first, or null if they were never scored. */
    function getTimelineFor(name, scope, year) {
        var tl = buildRankTimeline(scope, year);
        return (tl && tl.byName[name]) || null;
    }

    /**
     * Selector-ready entries for months that can be rebuilt from weekly uploads.
     * Shared by the rankings and matchup period pickers so "which months exist"
     * is decided in one place.
     *
     * Months carried by their own upload are skipped — they are already listed as
     * stored periods, and offering the same month twice under two labels invites
     * comparing a rebuild against an upload and calling the difference movement.
     */
    function getMonthPeriodOptions(year) {
        var yr = year || _year();
        var buckets = getMonthBuckets(yr);
        var out = [];

        buckets.usable.forEach(function (mo) {
            if (buckets.fromUpload[mo]) return;
            var keys = buckets.monthsMap[mo] || [];

            var names = {};
            keys.forEach(function (k) {
                var e = _entry(k);
                ((e && e.employees) || []).forEach(function (emp) {
                    if (emp && emp.name) names[emp.name] = 1;
                });
            });

            var parts = mo.split('-');
            var lastDay = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10), 0).getDate();

            out.push({
                key: MONTH_KEY_PREFIX + mo,
                label: _monthLabel(mo) + ' (rebuilt from ' + keys.length + ' weeks)',
                type: 'month-agg',
                source: 'computed',
                count: Object.keys(names).length,
                endDate: mo + '-' + String(lastDay).padStart(2, '0')
            });
        });

        return out;
    }

    /**
     * Team movement across the same month pair the individual view uses, so the
     * two surfaces always describe the same two months.
     */
    function buildMonthOverMonthTeams(supervisors, year) {
        var yr = year || _year();
        var buckets = getMonthBuckets(yr);
        if (buckets.comparable.length < 2) return null;

        var curKey = buckets.comparable[buckets.comparable.length - 1];
        var prevKey = buckets.comparable[buckets.comparable.length - 2];

        var cur = buildMonthAggregate(curKey, yr);
        var prev = buildMonthAggregate(prevKey, yr);
        if (!cur || !prev) return null;

        var compared = compareTeams(prev.employees, cur.employees, supervisors, yr);
        if (!compared) return null;

        return {
            current: { key: curKey, label: cur.label },
            previous: { key: prevKey, label: prev.label },
            total: compared.total,
            teamCount: compared.teamCount,
            teams: compared.teams
        };
    }

    /**
     * Every period of one granularity, oldest first, each flagged `partial` when
     * it covers far less of the centre than the fullest period of its kind.
     *
     * 'month' rebuilds each month; 'week' and 'ytd' read stored uploads directly.
     * Partial periods are returned rather than dropped so a caller can say which
     * ones it stepped over — silently skipping a month is what makes a June-to-July
     * comparison shown in September look stale rather than deliberate.
     */
    function _periodsForScope(scope, year) {
        var yr = year || _year();
        var out = [];

        if (scope === 'month') {
            var buckets = getMonthBuckets(yr);
            buckets.usable.forEach(function (mo) {
                var agg = buildMonthAggregate(mo, yr);
                if (!agg) return;
                out.push({
                    key: mo, label: agg.label, employees: agg.employees, end: mo,
                    spanStart: agg.spanStart, spanEnd: agg.spanEnd,
                    weekCount: agg.weekCount, fromUpload: agg.fromUpload,
                    count: buckets.counts[mo] || agg.employees.length,
                    partial: !!buckets.partial[mo],
                    // The calendar month has not finished yet. Distinct from
                    // `partial`, which is about head count: a two-week August has
                    // very nearly the full roster, so the population guard waves it
                    // straight through even though it is half a month of work.
                    inProgress: mo === _nowMonth()
                });
            });
            return out;
        }

        var src = scope === 'ytd' ? _ytdData() : _weeklyData();
        // Completed weeks only. A three-day week-in-progress against a full one is
        // not movement, it is four fewer days — and the head count barely drops, so
        // the population guard never catches it.
        var types = scope === 'ytd' ? ['ytd'] : ['week'];

        Object.keys(src).forEach(function (k) {
            var entry = src[k];
            var meta = (entry && entry.metadata) || {};
            var type = meta.periodType || (scope === 'ytd' ? 'ytd' : 'week');
            if (types.indexOf(type) === -1) return;
            var end = String(meta.endDate || (k.indexOf('|') > -1 ? k.split('|')[1] : k));
            if (parseInt(end.split('-')[0], 10) !== yr) return;
            var emps = (entry && entry.employees) || [];
            if (!emps.length) return;
            out.push({ key: k, label: meta.label || end, employees: emps, end: end, count: emps.length });
        });

        out.sort(function (a, b) { return a.end.localeCompare(b.end); });

        var fullest = out.reduce(function (m, p) { return Math.max(m, p.count); }, 0);
        out.forEach(function (p) {
            p.partial = fullest > 0 && p.count < fullest * PARTIAL_MONTH_FRACTION;
        });
        return out;
    }

    /**
     * Team movement between the last two comparable periods of a given
     * granularity, so the comparison follows whatever the viewer selected rather
     * than always answering about months.
     */
    function buildTeamMovementForScope(scope, supervisors, year) {
        var yr = year || _year();
        var usable = _periodsForScope(scope, yr).filter(function (p) { return !p.partial; });
        if (usable.length < 2) return null;

        // Same unfinished-month rule as the individual view, so the two surfaces
        // can never end up describing different pairs of months.
        var curIdx = usable.length - 1;
        if (usable[curIdx].inProgress && curIdx >= 2) curIdx -= 1;
        var cur = usable[curIdx];
        var prev = usable[curIdx - 1];

        var compared = compareTeams(prev.employees, cur.employees, supervisors, yr);
        if (!compared) return null;

        return {
            scope: scope,
            current: { key: cur.key, label: cur.label },
            previous: { key: prev.key, label: prev.label },
            total: compared.total,
            teamCount: compared.teamCount,
            teams: compared.teams
        };
    }

    /** Movement for one person, or null. Convenience for coaching surfaces. */
    function getMovementFor(name, momData) {
        if (!name || !momData || !momData.movements) return null;
        for (var i = 0; i < momData.movements.length; i++) {
            if (momData.movements[i].name === name) return momData.movements[i];
        }
        return null;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.periodCompare = {
        MIN_WEEKS_FOR_MONTH: MIN_WEEKS_FOR_MONTH,
        MONTH_KEY_PREFIX: MONTH_KEY_PREFIX,
        PARTIAL_MONTH_FRACTION: PARTIAL_MONTH_FRACTION,
        getMonthBuckets: getMonthBuckets,
        getMonthPeriodOptions: getMonthPeriodOptions,
        aggregateEmployeesFrom: aggregateEmployeesFrom,
        buildMonthAggregate: buildMonthAggregate,
        compareRankings: compareRankings,
        // Year-to-date hours missed, by name. center-ranking applies the same
        // cumulative-not-slice rule to stored periods that buildMonthAggregate
        // applies to rebuilt months, and both must read it from one place.
        latestYtdReliability: _latestYtdReliability,
        compareTeams: compareTeams,
        buildMonthOverMonthRanks: buildMonthOverMonthRanks,
        buildMonthOverMonthTeams: buildMonthOverMonthTeams,
        buildMovementForScope: buildMovementForScope,
        buildMonthCoverage: buildMonthCoverage,
        buildRankTimeline: buildRankTimeline,
        getTimelineFor: getTimelineFor,
        resetTimelineCache: resetTimelineCache,
        buildTeamMovementForScope: buildTeamMovementForScope,
        getMovementFor: getMovementFor,
        monthLabel: _monthLabel
    };
})();
