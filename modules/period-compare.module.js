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
      and it feeds the rank composite. Carrying the raw cumulative number into a
      monthly rank would mark everyone down in December purely for the year
      having gone on longer. Monthly aggregates therefore carry hours ACCRUED IN
      THAT MONTH — cumulative at month end minus cumulative at prior month end.

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
    var SURVEY_WEIGHTED = { cxRepOverall: true, fcr: true, overallExperience: true };

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
       Mirrors buildYtdAggregateForYear's math. Reliability is carried through as
       the running cumulative maximum here; callers wanting a per-month figure use
       buildMonthAggregate, which converts it to an accrued delta. */

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

                a._periodsSeen += 1;
                a.transfersCount += Number.isFinite(parseFloat(emp.transfersCount)) ? parseFloat(emp.transfersCount) : 0;
                a.surveyTotal += Number.isInteger(surveyTotal) ? surveyTotal : 0;
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
                    if (SURVEY_WEIGHTED[mk]) {
                        weight = Number.isInteger(surveyTotal) && surveyTotal > 0 ? surveyTotal : 0;
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

    /* ── Reliability: cumulative -> accrued ── */

    function _ytdData() {
        return typeof ytdData !== 'undefined' ? ytdData : {};
    }

    // Year-to-date hours missed per person, from the newest YTD upload of the year.
    // That upload is the only complete running total available: weekly uploads only
    // go back as far as someone started uploading them, and the months before that
    // cannot be reconstructed from anything on hand.
    function _latestYtdReliability(year) {
        var yData = _ytdData();
        var best = null, bestEnd = '';
        Object.keys(yData).forEach(function (k) {
            var meta = (yData[k] && yData[k].metadata) || {};
            var end = meta.endDate || (k.indexOf('|') !== -1 ? k.split('|')[1] : k);
            if (parseInt(String(end).split('-')[0], 10) !== year) return;
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

        // Cumulative -> accrued in this month. Clamped at 0: a cumulative figure
        // that appears to drop (a correction upstream, or a rep whose history was
        // restated) would otherwise read as negative hours, which is meaningless.
        var ytdRel = _latestYtdReliability(yr);
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
            // honest, not a bug — you cannot go back and not miss the shift.
            //
            // Sourced from the YTD upload rather than rebuilt from weeks, because
            // weekly coverage starts partway through the year and everything before
            // it is unrecoverable — a rebuild would understate the year and quietly
            // hand people a pass they have not earned. With no YTD upload the value
            // is left null, which scoreEmployee treats as unmeasured. Unmeasured is
            // correct here: 0 is a perfect score, so guessing would crown people.
            e.reliability = e.reliabilityCumulative;
        });

        return {
            key: monthKey,
            label: _monthLabel(monthKey),
            employees: employees,
            weekKeys: keys.slice(),
            fromUpload: !!buckets.fromUpload[monthKey],
            weekCount: keys.length
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
        var yr = year || _year();
        var buckets = getMonthBuckets(yr);
        // Partial months are stepped over rather than compared, so a one-team
        // upload filed as a month cannot become the headline comparison.
        if (buckets.comparable.length < 2) return null;

        var curKey = buckets.comparable[buckets.comparable.length - 1];
        var prevKey = buckets.comparable[buckets.comparable.length - 2];

        var skipped = buckets.usable.filter(function (mo) {
            return buckets.partial[mo] && mo > prevKey;
        });

        var cur = buildMonthAggregate(curKey, yr);
        var prev = buildMonthAggregate(prevKey, yr);
        if (!cur || !prev) return null;

        var compared = compareRankings(prev.employees, cur.employees, yr);
        if (!compared) return null;

        // A part-month must not read as a finished one.
        var now = new Date();
        var nowMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');

        return {
            current: { key: curKey, label: cur.label, weekCount: cur.weekCount, fromUpload: cur.fromUpload, inProgress: curKey === nowMonth },
            previous: { key: prevKey, label: prev.label, weekCount: prev.weekCount, fromUpload: prev.fromUpload },
            // Months newer than the pair that were passed over as partial. Surfaced
            // so a stale-looking comparison explains itself instead of just looking wrong.
            skippedPartial: skipped.map(function (mo) {
                return { key: mo, label: _monthLabel(mo), count: buckets.counts[mo] || 0 };
            }),
            total: compared.total,
            movements: compared.movements,
            onlyCurrent: compared.onlyCurrent,
            onlyPrevious: compared.onlyPrevious
        };
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
     * Comparable periods of one granularity, oldest first.
     *
     * 'month' rebuilds each month; 'week' and 'ytd' read stored uploads directly.
     * Anything covering far less of the centre than the fullest period of its kind
     * is dropped, so a one-team upload cannot become one half of a comparison.
     */
    function _scopePeriods(scope, year) {
        var yr = year || _year();
        var out = [];

        if (scope === 'month') {
            getMonthBuckets(yr).comparable.forEach(function (mo) {
                var agg = buildMonthAggregate(mo, yr);
                if (agg) out.push({ key: mo, label: agg.label, employees: agg.employees, end: mo });
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
            out.push({ key: k, label: meta.label || end, employees: emps, end: end });
        });

        out.sort(function (a, b) { return a.end.localeCompare(b.end); });
        return out;
    }

    /**
     * Team movement between the last two comparable periods of a given
     * granularity, so the comparison follows whatever the viewer selected rather
     * than always answering about months.
     */
    function buildTeamMovementForScope(scope, supervisors, year) {
        var yr = year || _year();
        var periods = _scopePeriods(scope, yr);

        var fullest = periods.reduce(function (m, p) { return Math.max(m, p.employees.length); }, 0);
        var usable = periods.filter(function (p) { return p.employees.length >= fullest * PARTIAL_MONTH_FRACTION; });
        if (usable.length < 2) return null;

        var cur = usable[usable.length - 1];
        var prev = usable[usable.length - 2];

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
        getMonthBuckets: getMonthBuckets,
        getMonthPeriodOptions: getMonthPeriodOptions,
        aggregateEmployeesFrom: aggregateEmployeesFrom,
        buildMonthAggregate: buildMonthAggregate,
        compareRankings: compareRankings,
        compareTeams: compareTeams,
        buildMonthOverMonthRanks: buildMonthOverMonthRanks,
        buildMonthOverMonthTeams: buildMonthOverMonthTeams,
        buildTeamMovementForScope: buildTeamMovementForScope,
        getMovementFor: getMovementFor,
        monthLabel: _monthLabel
    };
})();
