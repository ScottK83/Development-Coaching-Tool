(function() {
    'use strict';

    // ============================================
    // UPLOAD WIZARD MODULE
    // Dropdown-driven upload period picker — the only path for
    // choosing what period an upload covers. Computes a rolling list
    // of sensible options from today's date (last completed week,
    // this week in progress, last completed month, last completed
    // quarter, YTD, daily) and annotates each with its upload state
    // so the dropdown doubles as a to-do list: unselected = not yet
    // uploaded.
    //
    // Writes the user's selection to three hidden inputs in index.html:
    //   #uploadPeriodType    — the period kind (week, ytd, daily, ...)
    //   #pasteStartDate      — inclusive range start (YYYY-MM-DD)
    //   #pasteWeekEndingDate — inclusive range end   (YYYY-MM-DD)
    // The save path in script.js reads those three values.
    //
    // Above the dropdown sits the coverage report: what the store is missing,
    // by kind of period — weeks, months, quarters, and whether a real YTD
    // exists for this year at all — with a clickable chip for each one that can
    // be filled. The chips carry the ids of options in the dropdown below them,
    // so a click is a lookup rather than a second derivation of the same dates.
    // ============================================

    const MS_PER_DAY = 86_400_000;

    // Period kinds that span multiple weeks — uploading one of these leaves
    // the individual weeks inside it blank for week-over-week trends. YTD is
    // deliberately absent: it's a whole-year roll-up uploaded on purpose, so
    // listing every unfilled week of the year would just be noise.
    const MULTI_WEEK_PERIOD_TYPES = new Set(['month', 'quarter', 'custom']);
    const MAX_RANGE_GAPS_SHOWN = 16;

    // Period kinds you upload again and again on purpose. Their range grows as
    // the period runs on, and the save path replaces the row on file rather
    // than leaving the older copy beside it, so there is nothing to protect by
    // greying them out. Marking them "already uploaded" only blocked the
    // correction — worst on the same day, when the end date hasn't moved yet,
    // the key still matches and the option went dead until tomorrow. These stay
    // selectable however many times they're pasted, and say what they replace.
    const REUPLOADABLE_PERIOD_TYPES = new Set(['week-in-progress', 'month-to-date']);

    function getWeeklyStore() {
        return (typeof weeklyData !== 'undefined' ? weeklyData : null)
            || window.DevCoachModules?.storage?.loadWeeklyData?.()
            || {};
    }

    function startOfDay(d) {
        return new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }

    function isoDate(d) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    function fmtShort(d) {
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    function fmtLong(d) {
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function addDays(d, n) {
        const x = new Date(d);
        x.setDate(x.getDate() + n);
        return x;
    }

    // Parse YYYY-MM-DD as a local Date (avoids UTC day-shift).
    function parseLocalDate(isoStr) {
        if (!isoStr) return new Date(NaN);
        const [y, m, d] = String(isoStr).split('-').map(Number);
        if (!y || !m || !d) return new Date(NaN);
        return new Date(y, m - 1, d);
    }

    // Monday of the week containing d (weeks run Mon -> Sun).
    function mondayOf(d) {
        const x = startOfDay(d);
        const dow = x.getDay();
        return addDays(x, dow === 0 ? -6 : -(dow - 1));
    }

    // Given today, compute the full list of upload options.
    //
    // The list is deterministic and doesn't yet know about upload
    // state — that's applied separately so the function stays pure
    // and testable.
    function computeUploadOptions(today = new Date()) {
        const options = [];
        const now = startOfDay(today);
        const dow = now.getDay(); // 0 = Sun, 1 = Mon, ... 6 = Sat

        // Week boundaries (Monday start)
        const daysBackToMon = dow === 0 ? 6 : dow - 1;
        const thisWeekMon = addDays(now, -daysBackToMon);
        const thisMonthFirstForMtd = new Date(now.getFullYear(), now.getMonth(), 1);
        const mtdMonthName = thisMonthFirstForMtd.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const lastWeekMon = addDays(thisWeekMon, -7);
        const lastWeekSun = addDays(thisWeekMon, -1);
        const yesterday = addDays(now, -1);

        // 0. Daily — user picks a specific day (defaults to yesterday).
        //    Dailies are ephemeral: they power "yesterday's check-in" and
        //    partial-week views, and get purged when a weekly upload for
        //    the same week lands.
        options.push({
            id: 'daily',
            label: 'Daily data (pick a day, defaults to yesterday)',
            periodType: 'daily',
            startDate: null,
            endDate: null,
            requiresDailyDatePick: true,
            defaultDate: isoDate(yesterday),
            priority: 0
        });

        // 1. This week in progress (Mon -> yesterday). Today's data
        //    isn't available yet (PowerBI publishes the prior day), so
        //    the range ends at yesterday. Skipped on Monday since there
        //    are no complete days in the current week yet.
        if (yesterday >= thisWeekMon) {
            options.push({
                id: 'week-in-progress',
                label: `This week in progress (${fmtShort(thisWeekMon)}, ${fmtShort(yesterday)})`,
                periodType: 'week-in-progress',
                startDate: isoDate(thisWeekMon),
                endDate: isoDate(yesterday),
                priority: 1
            });
        }

        // 2. Last completed week
        options.push({
            id: `week-${isoDate(lastWeekMon)}`,
            label: `Last week (${fmtShort(lastWeekMon)}, ${fmtShort(lastWeekSun)})`,
            periodType: 'week',
            startDate: isoDate(lastWeekMon),
            endDate: isoDate(lastWeekSun),
            priority: 2
        });

        // 2b. Month to date. The current month up to yesterday, replacing itself
        //     on every upload — the point is one row that is always the real
        //     month so far, rather than a rebuild stitched from whole weeks that
        //     starts in the previous month.
        if (yesterday >= thisMonthFirstForMtd) {
            options.push({
                id: 'month-to-date',
                label: `${mtdMonthName} to date (${fmtShort(thisMonthFirstForMtd)}, ${fmtShort(yesterday)})`,
                periodType: 'month-to-date',
                startDate: isoDate(thisMonthFirstForMtd),
                endDate: isoDate(yesterday),
                priority: 2.5
            });
        }

        // 3. Last completed month
        const thisMonthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastMonthEnd = addDays(thisMonthFirst, -1);
        const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
        const monthName = lastMonthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        options.push({
            id: `month-${isoDate(lastMonthStart)}`,
            label: `${monthName} (last completed month)`,
            periodType: 'month',
            startDate: isoDate(lastMonthStart),
            endDate: isoDate(lastMonthEnd),
            priority: 3
        });

        // 4. Last completed quarter
        const currentQIdx = Math.floor(now.getMonth() / 3); // 0..3
        let lastQStartMonthIdx, lastQYear;
        if (currentQIdx === 0) {
            lastQStartMonthIdx = 9; // Oct (month index)
            lastQYear = now.getFullYear() - 1;
        } else {
            lastQStartMonthIdx = (currentQIdx - 1) * 3;
            lastQYear = now.getFullYear();
        }
        const lastQStart = new Date(lastQYear, lastQStartMonthIdx, 1);
        const lastQEnd = new Date(lastQYear, lastQStartMonthIdx + 3, 0); // last day of quarter
        const qNumber = Math.floor(lastQStartMonthIdx / 3) + 1;
        options.push({
            id: `quarter-${lastQYear}-q${qNumber}`,
            label: `Q${qNumber} ${lastQYear} (last completed quarter)`,
            periodType: 'quarter',
            startDate: isoDate(lastQStart),
            endDate: isoDate(lastQEnd),
            priority: 4
        });

        // 5. YTD — user picks the end date. Always pending because YTD
        //    is re-uploaded ad-hoc. We'll still show the latest uploaded
        //    YTD end date as a hint in the summary area.
        options.push({
            id: 'ytd',
            label: `YTD (pick end date)`,
            periodType: 'ytd',
            startDate: `${now.getFullYear()}-01-01`,
            endDate: null,
            requiresEndDatePick: true,
            priority: 5
        });

        return options;
    }

    // Find completed weeks with no weekly upload, so gaps in the
    // week-over-week trend line are visible and fillable.
    //
    // The scan window runs from the earliest week already on file
    // through the last completed week — weeks before the first upload
    // aren't gaps, they're just before the user started — and reaches
    // back at most a year, since trend views never look further. Only real
    // 'week' uploads count as coverage: a month/quarter/YTD upload
    // spanning the same dates gives no weekly granularity, and a
    // week-in-progress row isn't a finished week.
    //
    // Returns { weeks, totalMissing, shownCount } with weeks ordered
    // most-recent-first and capped at maxOptions.
    // Mondays that already have a real weekly upload, plus the earliest one.
    // Only 'week' periods count — a month/quarter/YTD row covering the same
    // dates carries no weekly granularity, and a week-in-progress row isn't
    // a finished week.
    function scanUploadedWeeks(weeklyStore) {
        const weekly = weeklyStore || {};
        const mondays = new Set();
        let earliestMon = null;
        Object.keys(weekly).forEach(k => {
            const meta = weekly[k]?.metadata || {};
            if ((meta.periodType || 'week') !== 'week') return;
            const startText = meta.startDate || (k.includes('|') ? k.split('|')[0] : '');
            const start = parseLocalDate(startText);
            if (isNaN(start)) return;
            const mon = mondayOf(start);
            mondays.add(isoDate(mon));
            if (!earliestMon || mon < earliestMon) earliestMon = mon;
        });
        return { mondays, earliestMon };
    }

    // Completed weeks overlapping [startISO, endISO] that have no weekly
    // upload. This is what a month/quarter/YTD upload can't give you: the
    // range lands as one row, so the weeks inside it are still blank for
    // week-over-week trends. Boundary weeks that straddle the range are
    // included — you need them for the trend line to be continuous.
    function missingWeeksInRange(weeklyStore, startISO, endISO, today = new Date()) {
        const start = parseLocalDate(startISO);
        const end = parseLocalDate(endISO);
        if (isNaN(start) || isNaN(end) || start > end) return [];

        const lastCompleteSun = addDays(mondayOf(today), -1);
        const uploaded = scanUploadedWeeks(weeklyStore).mondays;
        const out = [];
        for (let mon = mondayOf(start); mon <= end; mon = addDays(mon, 7)) {
            const sun = addDays(mon, 6);
            if (sun > lastCompleteSun) break;  // week hasn't finished yet
            if (sun < start) continue;         // no overlap with the range
            const iso = isoDate(mon);
            if (uploaded.has(iso)) continue;
            out.push({ startDate: iso, endDate: isoDate(sun) });
        }
        return out;
    }

    // Earliest date any period upload covers, whatever its kind. This anchors
    // the gap scan. Anchoring it to weekly uploads alone made the feature
    // vanish exactly when it was most needed: with only last week uploaded,
    // the window collapsed to that one week and reported no gaps at all. A
    // month or quarter upload says you care about that span, so the weeks
    // inside it are fair game even though the range row doesn't cover them.
    // YTD is excluded — it starts Jan 1 and would open the window to the
    // entire year on every upload.
    const RANGE_TYPES_FOR_SCAN = new Set(['week', 'week-in-progress', 'month', 'quarter', 'custom']);

    function earliestCoveredMonday(weeklyStore) {
        const weekly = weeklyStore || {};
        let earliest = null;
        Object.keys(weekly).forEach(k => {
            const meta = weekly[k]?.metadata || {};
            if (!RANGE_TYPES_FOR_SCAN.has(meta.periodType || 'week')) return;
            const startText = meta.startDate || (k.includes('|') ? k.split('|')[0] : '');
            const start = parseLocalDate(startText);
            if (isNaN(start)) return;
            const mon = mondayOf(start);
            if (!earliest || mon < earliest) earliest = mon;
        });
        return earliest;
    }

    const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    // What the month rebuild demands of an upload calling itself a month: at
    // least a fortnight, or two weekly uploads ending inside it. Kept in step
    // with period-compare's MIN_WEEKS_FOR_MONTH.
    const MIN_DAYS_FOR_MONTH_UPLOAD = 14;
    const MIN_WEEKS_FOR_MONTH = 2;

    /* How each month of this year is covered, and by what.

       A month upload is not a lesser substitute for its weeks: the rankings
       rebuild a month from weeklies only when no monthly upload exists for it,
       and rank the two identically. One file per month is a complete answer for
       trends, month-over-month movement and the rankings trajectory. Weeks add
       week-over-week detail inside a month and nothing else.

       That mattered here because the only monthly option the wizard offered was
       "last completed month", so a supervisor told four months were blank had no
       way to fill them except seventeen weekly uploads. */
    function monthCoverage(weeklyStore, today) {
        const year = today.getFullYear();
        const weekly = weeklyStore || {};
        const weeksIn = {};
        const monthUploads = new Set();

        Object.keys(weekly).forEach(k => {
            const meta = weekly[k]?.metadata || {};
            const type = meta.periodType || 'week';
            const end = parseLocalDate(meta.endDate || (k.includes('|') ? k.split('|')[1] : ''));
            if (isNaN(end) || end.getFullYear() !== year) return;
            if (type === 'week') {
                weeksIn[end.getMonth()] = (weeksIn[end.getMonth()] || 0) + 1;
            } else if (type === 'month') {
                const start = parseLocalDate(meta.startDate || (k.includes('|') ? k.split('|')[0] : ''));
                // A "month" covering less than a fortnight is thrown out by the
                // rebuild, so it must not read as coverage here either.
                if (isNaN(start)) return;
                if (Math.round((end - start) / MS_PER_DAY) + 1 >= MIN_DAYS_FOR_MONTH_UPLOAD) {
                    monthUploads.add(end.getMonth());
                }
            } else if (type === 'month-to-date') {
                // Covers its month for as far as the month has gone. It is only
                // ever the current one, which is never offered for backfill.
                monthUploads.add(end.getMonth());
            }
        });

        const out = [];
        for (let m = 0; m <= today.getMonth(); m++) {
            const weeks = weeksIn[m] || 0;
            let status = 'none';
            if (monthUploads.has(m)) status = 'uploaded';
            else if (weeks >= MIN_WEEKS_FOR_MONTH) status = 'rebuilt';
            else if (weeks > 0) status = 'thin';
            out.push({
                month: m,
                name: MONTH_NAMES[m],
                weeks,
                status,
                covered: status === 'uploaded' || status === 'rebuilt',
                inProgress: m === today.getMonth()
            });
        }
        return out;
    }

    // Completed months of this year that no upload covers, offered as monthly
    // periods. One of these replaces four or five weekly uploads.
    function missingMonthOptions(weeklyStore, today) {
        const year = today.getFullYear();
        return monthCoverage(weeklyStore, today)
            .filter(mo => !mo.covered && !mo.inProgress)
            .map(mo => {
                const start = new Date(year, mo.month, 1);
                const end = new Date(year, mo.month + 1, 0);
                return {
                    id: `month-${isoDate(start)}`,
                    label: `${mo.name} ${year} (never uploaded)` +
                        (mo.weeks ? ` to ${mo.weeks} week${mo.weeks === 1 ? '' : 's'} on file` : ''),
                    periodType: 'month',
                    startDate: isoDate(start),
                    endDate: isoDate(end),
                    isMissingPeriod: true,
                    priority: 2.4
                };
            })
            .reverse();   // nearest first, like the missing weeks
    }

    // The month indices each quarter owns. Used both for the "all three months
    // are covered" test and for the calendar bounds of a quarter option.
    const QUARTER_MONTHS = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [9, 10, 11]];

    /* How each completed quarter of this year is covered, and by what.

       Two things count as coverage and they are not the same thing. A real
       quarter upload IS the quarter, one row, whole. Three covered months add
       up to the same span with month-over-month detail inside it, so they count
       too, on the same reasoning that lets a month rebuilt from weeklies rank
       beside a month uploaded whole.

       It does not run the other way, and that asymmetry is the part worth
       saying out loud. A quarter upload does not make its months covered:
       monthCoverage only counts month, month-to-date and week rows, and nothing
       in the app splits a quarter row back into three months. Clearing a Q1
       warning by uploading Q1 leaves January, February and March exactly as
       blank as they were for the rankings trajectory, so the banner has to name
       that rather than let a chip imply the quarter fixed everything under it.

       Unlike months there is no minimum span here. The fortnight floor on a
       month upload exists to mirror the month rebuild, which throws short rows
       out; no code rebuilds a quarter from anything, so a row labelled quarter
       is taken at its word. */
    function quarterCoverage(weeklyStore, today) {
        const year = today.getFullYear();
        const weekly = weeklyStore || {};
        const now = startOfDay(today);

        const quarterUploads = new Set();
        Object.keys(weekly).forEach(k => {
            const meta = weekly[k]?.metadata || {};
            if ((meta.periodType || 'week') !== 'quarter') return;
            const end = parseLocalDate(meta.endDate || (k.includes('|') ? k.split('|')[1] : ''));
            if (isNaN(end) || end.getFullYear() !== year) return;
            quarterUploads.add(Math.floor(end.getMonth() / 3));
        });

        // monthCoverage has already applied its own floor, so a month that
        // reads as covered here needs no second opinion. It only reports
        // months up to the current one, which is why a month with no entry is
        // treated as uncovered — that only ever happens in a quarter the
        // calendar has not finished, and those are filtered out below anyway.
        const byMonth = {};
        monthCoverage(weekly, today).forEach(mo => { byMonth[mo.month] = mo; });

        const out = [];
        for (let q = 0; q < 4; q++) {
            const start = new Date(year, q * 3, 1);
            const end = new Date(year, q * 3 + 3, 0);
            const monthsMissing = QUARTER_MONTHS[q]
                .filter(m => !byMonth[m] || !byMonth[m].covered)
                .map(m => MONTH_NAMES[m]);
            const uploaded = quarterUploads.has(q);
            const rebuilt = !uploaded && monthsMissing.length === 0;
            out.push({
                quarter: q + 1,
                name: `Q${q + 1}`,
                year,
                startDate: isoDate(start),
                endDate: isoDate(end),
                complete: end < now,
                status: uploaded ? 'uploaded'
                    : rebuilt ? 'rebuilt'
                        : monthsMissing.length === 3 ? 'none' : 'partial',
                monthsMissing,
                covered: uploaded || rebuilt
            });
        }
        return out;
    }

    // Completed quarters of this year that nothing covers, offered as quarter
    // periods. The id is the same shape computeUploadOptions builds for "last
    // completed quarter" on purpose: the two lists meet in the dropdown, and a
    // chip whose id is one character off is a chip that does nothing.
    function missingQuarterOptions(weeklyStore, today) {
        const year = today.getFullYear();
        return quarterCoverage(weeklyStore, today)
            .filter(q => q.complete && !q.covered)
            .map(q => {
                const short = q.monthsMissing.length;
                return {
                    id: `quarter-${year}-q${q.quarter}`,
                    label: `${q.name} ${year} (never uploaded)` +
                        (short && short < 3
                            ? ` to ${short} of its 3 months ${short === 1 ? 'is' : 'are'} blank too`
                            : ''),
                    periodType: 'quarter',
                    quarter: q.quarter,
                    startDate: q.startDate,
                    endDate: q.endDate,
                    monthsMissing: q.monthsMissing,
                    isMissingPeriod: true,
                    priority: 2.3
                };
            })
            .reverse();   // nearest first, like the weeks and the months
    }

    /* How far behind the last finished week a YTD upload may fall before it
       counts as stale. Five weeks, because a YTD re-uploaded once a month is
       the normal rhythm here and a four-week line would nag at the ordinary
       cadence. Past five weeks it is not a cadence any more, it is a YTD that
       stopped. */
    const STALE_YTD_DAYS = 35;

    /* Whether a real year-to-date upload exists for this year, and how old it is.

       This is the one entry in the coverage report that is not a hole in a
       trend line, and it matters more than it looks. A YTD upload is the source
       of truth for the whole app, and the code downstream does not improvise
       without one: morning-pulse's attachYearPace reads the newest YTD, checks
       its year against the current one, and returns without writing a word if
       they differ. So "no YTD on file" and "your YTD closed in April" both
       reach the user as the year-pace sentence quietly vanishing from their
       messages, with nothing anywhere saying why. The banner is the only place
       that can say it.

       A null store means "nobody asked", not "nothing on file", which is why it
       returns null rather than a missing verdict. computeMissingWeeks is called
       from tests and from callers holding only the weekly store, and inventing
       a YTD warning out of an argument nobody passed would light the banner up
       over a year that is completely covered. */
    function ytdCoverage(ytdStore, today) {
        if (!ytdStore) return null;
        const year = today.getFullYear();
        const lastCompleteSun = addDays(mondayOf(today), -1);

        /* Only a REAL year-to-date upload counts here.
         *
         * The app writes an auto-generated year-to-date row of its own, stitched
         * from whatever weeks are on file, and stamps it autoGeneratedYtd. That
         * row is useful and it is also not the thing this block is asking about:
         * counting it would mean the banner sees a year-to-date file for the
         * current year on almost every install, so "no YTD on file" could never
         * fire and the one warning that explains why the year-pace features stay
         * quiet would be dead code that always passed.
         *
         * futures.findRealYtdUpload draws the same line for the same reason, and
         * the two have to agree: a banner saying the year-to-date file is fine
         * while futures ignores it as auto-built is worse than no banner. */
        let latest = null;
        Object.keys(ytdStore).forEach(k => {
            const meta = ytdStore[k]?.metadata || {};
            if (meta.autoGeneratedYtd) return;
            const endText = meta.endDate || (k.includes('|') ? k.split('|')[1] : '');
            const end = parseLocalDate(endText);
            if (isNaN(end)) return;
            if (!latest || end > latest.end) latest = { end, endText };
        });

        const latestYear = latest ? latest.end.getFullYear() : null;
        const hasCurrentYear = latestYear === year;
        const daysBehind = hasCurrentYear
            ? Math.round((lastCompleteSun - latest.end) / MS_PER_DAY)
            : null;

        return {
            year,
            latestEnd: latest ? latest.endText : null,
            latestYear,
            hasCurrentYear,
            daysBehind,
            closedMonth: hasCurrentYear ? MONTH_NAMES[latest.end.getMonth()] : null,
            isMissing: !hasCurrentYear,
            isStale: hasCurrentYear && daysBehind > STALE_YTD_DAYS
        };
    }

    /* Weeks of this year that sit BEFORE the first upload, and the months that
       have no weekly upload at all.

       These are deliberately not counted as gaps: a gap is a hole between
       things you have, and the scan starts at the first upload because weeks
       before it were "just before you started". That reads right in week two of
       a new install and wrong in August — the trajectory, the month rebuilds
       and every year-to-date comparison run January to now, so four blank
       months at the front of the year are missing data by every definition the
       rest of the app uses, and the banner said "1 week never uploaded".

       Kept as a separate bucket so eighteen weeks of never-had-it cannot drown
       the one week that is genuinely an oversight. */
    function priorYearCoverage(weeklyStore, today, earliestMon, maxOptions) {
        const year = today.getFullYear();
        const jan1 = new Date(year, 0, 1);
        const uploaded = scanUploadedWeeks(weeklyStore).mondays;

        // Months nothing covers — no monthly upload, and no weeks either. A
        // monthly upload counts, because the rankings treat it as the month.
        const coverage = monthCoverage(weeklyStore, today);
        const emptyMonths = coverage
            .filter(mo => mo.status === 'none' && !mo.inProgress)
            .map(mo => mo.name);
        const monthOptions = missingMonthOptions(weeklyStore, today);

        const weeks = [];
        if (earliestMon && earliestMon > jan1) {
            for (let mon = mondayOf(jan1); mon < earliestMon; mon = addDays(mon, 7)) {
                const sun = addDays(mon, 6);
                if (sun < jan1) continue;   // that week belongs to last year
                const iso = isoDate(mon);
                if (uploaded.has(iso)) continue;
                weeks.push({
                    id: `week-${iso}`,
                    label: `${fmtShort(mon)}. ${fmtLong(sun)} (before your first upload)`,
                    periodType: 'week',
                    startDate: iso,
                    endDate: isoDate(sun),
                    isMissingWeek: true,
                    priority: 2.6
                });
            }
        }
        weeks.reverse();   // nearest to the data you have comes first

        return {
            priorWeeks: weeks.slice(0, maxOptions),
            priorCount: weeks.length,
            priorShownCount: Math.min(weeks.length, maxOptions),
            firstCoveredDate: earliestMon ? isoDate(earliestMon) : null,
            emptyMonths,
            monthOptions
        };
    }

    // The whole coverage picture, every kind of period at once.
    //
    // The name is now half the truth — it started as weeks and grew months,
    // quarters and the YTD check — but the shape it returns is what refresh()
    // and the tests read, so the weeks half is left exactly as it was and the
    // rest is added beside it. ytdStore is last and optional for the same
    // reason: every existing caller passes two arguments.
    function computeMissingWeeks(weeklyStore, today = new Date(), maxOptions = 12, ytdStore = null) {
        const lastWeekMon = addDays(mondayOf(today), -7);
        const { mondays: uploadedMondays } = scanUploadedWeeks(weeklyStore);
        const earliestMon = earliestCoveredMonday(weeklyStore);

        const prior = priorYearCoverage(weeklyStore, today, earliestMon, maxOptions);
        const quarterOptions = missingQuarterOptions(weeklyStore, today);
        const wider = {
            year: today.getFullYear(),
            quarterOptions,
            quarterCount: quarterOptions.length,
            ytd: ytdCoverage(ytdStore, today)
        };
        if (!earliestMon) {
            return Object.assign({ weeks: [], totalMissing: 0, shownCount: 0 }, prior, wider);
        }

        const oldestScanned = addDays(lastWeekMon, -7 * 51);
        const scanFrom = earliestMon > oldestScanned ? earliestMon : oldestScanned;

        const missing = [];
        for (let mon = scanFrom; mon <= lastWeekMon; mon = addDays(mon, 7)) {
            const iso = isoDate(mon);
            if (uploadedMondays.has(iso)) continue;
            const sun = addDays(mon, 6);
            const weeksAgo = Math.round((lastWeekMon - mon) / (7 * MS_PER_DAY)) + 1;
            missing.push({
                id: `week-${iso}`,
                label: `${fmtShort(mon)}. ${fmtLong(sun)} (${weeksAgo} week${weeksAgo === 1 ? '' : 's'} ago)`,
                periodType: 'week',
                startDate: iso,
                endDate: isoDate(sun),
                isMissingWeek: true,
                priority: 2.5
            });
        }

        missing.reverse(); // most recent gap first — likeliest to be filled
        return Object.assign({
            weeks: missing.slice(0, maxOptions),
            totalMissing: missing.length,
            shownCount: Math.min(missing.length, maxOptions)
        }, prior, wider);
    }

    // The copy already on file for a re-uploadable period: same kind, same
    // start date, any end date. Matched on the start rather than the full key
    // because the end moves every day and the key moves with it — yesterday's
    // Monday-to-Tuesday row is still the row this paste is about to replace.
    function latestSameStartUpload(weekly, opt) {
        let best = null;
        Object.keys(weekly).forEach(k => {
            const meta = weekly[k]?.metadata || {};
            if (meta.periodType !== opt.periodType) return;
            const startText = meta.startDate || (k.includes('|') ? k.split('|')[0] : '');
            if (startText !== opt.startDate) return;
            const endText = meta.endDate || (k.includes('|') ? k.split('|')[1] : '');
            const uploadedAt = meta.uploadedAt || null;
            if (!best ||
                endText > best.endDate ||
                (endText === best.endDate && (uploadedAt || '') > (best.uploadedAt || ''))) {
                best = { endDate: endText, uploadedAt };
            }
        });
        return best;
    }

    // Annotate each option with upload state by looking it up in
    // weeklyData / ytdData. For the YTD option, we don't mark it
    // uploaded (since end date is user-picked), but we record the
    // most recent existing YTD so the summary can display it.
    function annotateUploadState(options, weeklyStore, ytdStore, dailyStore) {
        const weekly = weeklyStore || {};
        const ytd = ytdStore || {};
        const daily = dailyStore || {};

        // Find most recent YTD by end date
        let latestYtdEnd = null;
        Object.keys(ytd).forEach(k => {
            const endText = ytd[k]?.metadata?.endDate || (k.includes('|') ? k.split('|')[1] : '');
            const endDate = new Date(endText);
            if (!isNaN(endDate) && (!latestYtdEnd || endDate > latestYtdEnd.date)) {
                latestYtdEnd = { date: endDate, endText };
            }
        });

        // Build a set of daily dates already uploaded (YYYY-MM-DD).
        const dailyUploadedDates = new Set();
        Object.keys(daily).forEach(k => {
            const endText = daily[k]?.metadata?.endDate || (k.includes('|') ? k.split('|')[1] : '');
            if (endText) dailyUploadedDates.add(endText);
        });

        return options.map(opt => {
            if (opt.periodType === 'ytd') {
                return {
                    ...opt,
                    latestYtdEnd: latestYtdEnd ? latestYtdEnd.endText : null
                };
            }
            if (opt.periodType === 'daily') {
                return {
                    ...opt,
                    dailyUploadedDates: Array.from(dailyUploadedDates).sort()
                };
            }
            if (!opt.endDate) return opt;
            if (REUPLOADABLE_PERIOD_TYPES.has(opt.periodType)) {
                const prior = latestSameStartUpload(weekly, opt);
                return prior ? { ...opt, priorUpload: prior } : opt;
            }
            const key = `${opt.startDate}|${opt.endDate}`;
            const existing = weekly[key];
            if (existing) {
                return {
                    ...opt,
                    isUploaded: true,
                    uploadedAt: existing.metadata?.uploadedAt || null
                };
            }
            return opt;
        });
    }

    // Says in the dropdown itself that this period already has a copy on file,
    // so picking it a second time doesn't look like a mistake.
    function reuploadSuffix(opt) {
        if (!opt.priorUpload) return '';
        const when = opt.priorUpload.uploadedAt
            ? new Date(opt.priorUpload.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
            : '';
        return when
            ? ` to ✓ uploaded ${when}, re-upload replaces it`
            : ' to re-upload replaces what is on file';
    }

    // Render the dropdown options into the select element. Pending
    // options come first and are selectable; already-uploaded options
    // are grouped below and rendered as disabled (visible as a
    // progress indicator but not clickable, so the user can't
    // accidentally re-upload the same period).
    function renderDropdown(selectEl, options) {
        if (!selectEl) return;
        const prev = selectEl.value;
        selectEl.innerHTML = '';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '-- Select a period --';
        selectEl.appendChild(placeholder);

        const isMissing = (o) => o.isMissingWeek || o.isMissingPeriod;
        const pending = options.filter(o => !o.isUploaded && !isMissing(o));
        const missing = options.filter(o => !o.isUploaded && isMissing(o));
        const uploaded = options.filter(o => o.isUploaded);

        function appendOption(grp, opt, prefix) {
            const el = document.createElement('option');
            el.value = opt.id;
            el.textContent = `${prefix || ''}${opt.label}${reuploadSuffix(opt)}`;
            el.dataset.periodType = opt.periodType;
            el.dataset.startDate = opt.startDate || '';
            el.dataset.endDate = opt.endDate || '';
            if (opt.requiresEndDatePick) el.dataset.requiresEndDatePick = '1';
            if (opt.requiresDailyDatePick) el.dataset.requiresDailyDatePick = '1';
            if (opt.defaultDate) el.dataset.defaultDate = opt.defaultDate;
            if (opt.latestYtdEnd) el.dataset.latestYtdEnd = opt.latestYtdEnd;
            if (Array.isArray(opt.dailyUploadedDates) && opt.dailyUploadedDates.length) {
                el.dataset.dailyUploadedDates = opt.dailyUploadedDates.join(',');
            }
            if (opt.priorUpload) {
                el.dataset.priorEndDate = opt.priorUpload.endDate || '';
                el.dataset.priorUploadedAt = opt.priorUpload.uploadedAt || '';
            }
            grp.appendChild(el);
        }

        if (pending.length) {
            const grp = document.createElement('optgroup');
            grp.label = 'Pending';
            pending.forEach(opt => appendOption(grp, opt));
            selectEl.appendChild(grp);
        }
        if (missing.length) {
            const grp = document.createElement('optgroup');
            grp.label = 'Never uploaded (gaps in your trend line)';
            missing.forEach(opt => appendOption(grp, opt, '⚠️ '));
            selectEl.appendChild(grp);
        }
        if (uploaded.length) {
            const grp = document.createElement('optgroup');
            grp.label = 'Already uploaded';
            uploaded.forEach(opt => {
                const el = document.createElement('option');
                el.value = opt.id;
                el.disabled = true;
                const when = opt.uploadedAt ? new Date(opt.uploadedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
                el.textContent = `✓ ${opt.label}${when ? ` — uploaded ${when}` : ''}`;
                el.dataset.periodType = opt.periodType;
                el.dataset.startDate = opt.startDate || '';
                el.dataset.endDate = opt.endDate || '';
                grp.appendChild(el);
            });
            selectEl.appendChild(grp);
        }

        // Restore previous selection only if it's still in the pending
        // list. A just-uploaded option becomes disabled and we don't
        // want it to stay "selected" — reset to the placeholder.
        const stillPending = prev && (pending.some(o => o.id === prev) || missing.some(o => o.id === prev));
        selectEl.value = stillPending ? prev : '';
    }

    // Sync the selected option into the three hidden inputs that drive
    // the save path: #uploadPeriodType, #pasteStartDate, #pasteWeekEndingDate.
    function applySelectionToHiddenInputs(option, dateOverride) {
        const typeInput = document.getElementById('uploadPeriodType');
        const startInput = document.getElementById('pasteStartDate');
        const endInput = document.getElementById('pasteWeekEndingDate');
        if (!option) {
            if (typeInput) typeInput.value = '';
            if (startInput) startInput.value = '';
            if (endInput) endInput.value = '';
            return;
        }
        // For YTD, dateOverride is the end date. For daily, it's the single day
        // (start === end). For everything else, we use the fixed dates in the option.
        let startDate;
        let endDate;
        if (option.periodType === 'daily') {
            endDate = dateOverride || option.defaultDate || '';
            startDate = endDate;
        } else if (option.periodType === 'ytd') {
            endDate = dateOverride || option.endDate || '';
            startDate = endDate ? `${endDate.slice(0, 4)}-01-01` : '';
        } else {
            endDate = option.endDate || '';
            startDate = option.startDate || '';
        }

        if (typeInput) typeInput.value = option.periodType || '';
        if (startInput) startInput.value = startDate;
        if (endInput) endInput.value = endDate;
    }

    function updateSummary(summaryEl, option, dateOverride) {
        if (!summaryEl) return;
        if (!option) {
            summaryEl.style.display = 'none';
            summaryEl.textContent = '';
            return;
        }
        // Daily — single-day save.
        if (option.periodType === 'daily') {
            const day = dateOverride || option.defaultDate;
            if (!day) {
                summaryEl.style.display = 'block';
                summaryEl.textContent = 'Pick which day this data is for.';
                return;
            }
            const d = parseLocalDate(day);
            summaryEl.style.display = 'block';
            summaryEl.textContent = `Will save as daily. ${fmtLong(d)}. (Ephemeral; cleared when a weekly upload covers this date.)`;
            return;
        }
        const endDate = dateOverride || option.endDate;
        if (!endDate) {
            // YTD with no end date picked yet
            summaryEl.style.display = 'block';
            const hint = option.latestYtdEnd
                ? ` Most recent YTD on file ends ${option.latestYtdEnd}.`
                : ' No YTD on file yet.';
            summaryEl.textContent = `Pick the last day this YTD covers.${hint}`;
            return;
        }
        const start = option.periodType === 'ytd'
            ? `${endDate.slice(0, 4)}-01-01`
            : option.startDate;
        const startD = parseLocalDate(start);
        const endD = parseLocalDate(endDate);
        summaryEl.style.display = 'block';
        let text = `Will save as ${option.periodType}. ${fmtLong(startD)} through ${fmtLong(endD)}.`;
        if (option.priorUpload) {
            const priorEnd = parseLocalDate(option.priorUpload.endDate);
            const through = isNaN(priorEnd) ? '' : ` through ${fmtLong(priorEnd)}`;
            const uploadedAt = option.priorUpload.uploadedAt ? new Date(option.priorUpload.uploadedAt) : null;
            const when = uploadedAt && !isNaN(uploadedAt) ? `, uploaded ${fmtLong(uploadedAt)}` : '';
            text += ` Replaces the copy already on file (${option.periodType}${through}${when}).`;
        }
        summaryEl.textContent = text;

        // A range upload lands as a single row. Spell out which weeks inside
        // it are still missing, so it's obvious what else to paste if you
        // want week-over-week movement across the range.
        if (MULTI_WEEK_PERIOD_TYPES.has(option.periodType)) {
            const gaps = missingWeeksInRange(getWeeklyStore(), start, endDate);
            if (gaps.length) {
                const shown = gaps.slice(0, MAX_RANGE_GAPS_SHOWN);
                const chips = shown.map(g =>
                    `<span style="display:inline-block; padding:2px 8px; margin:2px 4px 2px 0; background:var(--bg-surface, var(--bg-surface)); color:var(--text-primary, var(--text-primary)); border:1px solid var(--yellow, #e0a800); border-radius:10px; font-size:0.9em; white-space:nowrap;">${fmtShort(parseLocalDate(g.startDate))}. ${fmtShort(parseLocalDate(g.endDate))}</span>`
                ).join('');
                const more = gaps.length > shown.length
                    ? `<div style="margin-top:4px;">+ ${gaps.length - shown.length} more.</div>`
                    : '';
                summaryEl.innerHTML = `<div>${text}</div>` +
                    `<div style="margin-top:8px; font-weight:bold;">⚠️ ${gaps.length} week${gaps.length === 1 ? '' : 's'} inside this range ${gaps.length === 1 ? 'has' : 'have'} no weekly upload:</div>` +
                    `<div style="margin-top:4px;">${chips}</div>` +
                    more +
                    `<div style="margin-top:6px; font-size:0.95em;">This upload covers the whole range as one row. Upload these weeks separately for week-over-week trends.</div>`;
            }
        }
    }

    // Renders a per-weekday checklist for the current week into a summary
    // element: which days have been uploaded to dailyData, which are still
    // missing. Helps the user see daily-upload progress at a glance.
    function renderDailyWeekSummary(summaryEl, uploadedDates, today = new Date()) {
        if (!summaryEl) return;
        const now = startOfDay(today);
        const dow = now.getDay();
        const daysBackToMon = dow === 0 ? 6 : dow - 1;
        const weekMon = addDays(now, -daysBackToMon);
        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const uploadedSet = new Set((uploadedDates || '').split(',').filter(Boolean));

        const parts = [];
        for (let i = 0; i < 7; i++) {
            const d = addDays(weekMon, i);
            if (d > now) break; // Don't show future days
            const iso = isoDate(d);
            const mark = uploadedSet.has(iso) ? '✓' : '-';
            parts.push(`${dayNames[i]} ${mark}`);
        }
        if (!parts.length) {
            summaryEl.style.display = 'none';
            return;
        }
        summaryEl.style.display = 'block';
        summaryEl.textContent = `This week so far: ${parts.join(' · ')}`;
    }

    /* ── Clickable gap chips ──

       Every chip carries the id of an <option> that the same refresh() already
       put in #uploadWizardSelect: refresh folds gaps.weeks, gaps.monthOptions,
       gaps.quarterOptions and gaps.priorWeeks into the dropdown, then hands the
       identical gaps object to the banner. So filling the picker is a lookup by
       id rather than a second, drifting derivation of the same dates. */

    const CHIP_CLASS = 'upload-gap-chip';
    const CHIP_STYLE_ID = 'uploadGapChipStyles';
    const GAP_STATUS_ID = 'uploadWizardGapStatus';
    const CHIP_BASE_STYLE = 'display:inline-block; padding:3px 9px; margin:2px 4px 2px 0; ' +
        'background:var(--bg-surface, var(--bg-surface)); color:var(--text-primary, var(--text-primary)); ' +
        'border:1px solid var(--yellow, #e0a800); border-radius:10px; font-size:0.82em; ' +
        'white-space:nowrap; cursor:pointer; font-family:inherit;';

    function _escapeHtml(str) {
        const mod = window.DevCoachModules?.sharedUtils;
        if (mod?.escapeHtml) return mod.escapeHtml(str);
        return String(str ?? '')
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /* Hover and focus cannot be said in a style attribute, and a chip you can
       tab to with no visible focus ring is a chip only a mouse can find. The
       two rules go in one injected stylesheet rather than into styles-v2.css
       because this module owns the banner outright and nothing else renders
       these.

       They carry !important because the chips also hold their resting look in
       an inline style attribute, which beats a class selector every time. The
       hover and focus colours would otherwise lose to the chip's own
       background. The inline base stays regardless, so a chip is still a
       readable chip on a page where this injection found no <head> to write to. */
    function ensureChipStyles() {
        if (typeof document === 'undefined' || !document.head || !document.createElement) return;
        if (document.getElementById && document.getElementById(CHIP_STYLE_ID)) return;
        const el = document.createElement('style');
        el.id = CHIP_STYLE_ID;
        el.textContent =
            `.${CHIP_CLASS}:hover { background: var(--yellow, #e0a800) !important; color: #2b2000 !important; }` +
            `.${CHIP_CLASS}:focus { outline: 3px solid var(--brand, #0d6efd) !important; outline-offset: 2px; }` +
            `.${CHIP_CLASS}:focus-visible { outline: 3px solid var(--brand, #0d6efd) !important; outline-offset: 2px; }`;
        document.head.appendChild(el);
    }

    // A chip is a real <button>, never a styled <span> with a handler on it.
    // The banner is a list of actions: a span cannot be tabbed to, does not
    // fire on Enter or Space, and is announced by a screen reader as nothing
    // at all.
    function gapChip(optionId, text) {
        const label = _escapeHtml(text);
        return `<button type="button" class="${CHIP_CLASS}" ` +
            `data-upload-option="${_escapeHtml(optionId || '')}" ` +
            `title="${_escapeHtml('Load ' + text + ' into the period picker')}" ` +
            `style="${CHIP_BASE_STYLE}">${label}</button>`;
    }

    function weekChipText(opt) {
        return `${fmtShort(parseLocalDate(opt.startDate))}. ${fmtShort(parseLocalDate(opt.endDate))}`;
    }

    function monthChipText(opt) {
        const d = parseLocalDate(opt.startDate);
        return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`;
    }

    function quarterChipText(opt) {
        return `Q${opt.quarter} ${parseLocalDate(opt.startDate).getFullYear()}`;
    }

    function chipsFor(items, textOf) {
        return (items || []).map(it => gapChip(it.id, textOf(it))).join('');
    }

    // "January, February, March and April", the way the empty-month sentence
    // has always read it.
    function andList(names) {
        if (!names || !names.length) return '';
        if (names.length === 1) return names[0];
        return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
    }

    function gapStatusEl(bannerEl) {
        const byId = typeof document !== 'undefined' && document.getElementById
            ? document.getElementById(GAP_STATUS_ID)
            : null;
        if (byId) return byId;
        return bannerEl && typeof bannerEl.querySelector === 'function'
            ? bannerEl.querySelector(`#${GAP_STATUS_ID}`)
            : null;
    }

    // The status line is the only feedback a click has. Once the banner is
    // carrying four blocks the dropdown is below the fold on a laptop, and
    // "nothing happened" and "it worked, off screen" look identical from where
    // the user is sitting.
    function setGapStatus(bannerEl, text, tone) {
        const el = gapStatusEl(bannerEl);
        if (!el) return;
        el.textContent = text || '';
        if (!el.style) return;
        el.style.display = text ? 'block' : 'none';
        el.style.color = tone === 'bad'
            ? 'var(--red-text, #b3261e)'
            : 'var(--text-primary, var(--text-primary))';
    }

    /* Put a chip's period into the picker.

       The change event is dispatched rather than the select's handler called
       directly, because more than one thing listens to that select: the YTD end
       date picker and the daily date picker both open off it, and the summary
       line under the dropdown is written by it. Assigning .value fires nothing,
       so without the dispatch the picker would show the right period while the
       hidden inputs the save path reads still held the last one. The worst
       possible version of this feature, since the upload would look correct and
       land on the wrong dates.

       Failures are reported into the banner rather than returned quietly. A
       chip whose option is not in the dropdown means the two lists have drifted
       apart, and a dead chip that says nothing when clicked is the version of
       that bug nobody ever reports. */
    function selectPeriodFromChip(optionId, bannerEl) {
        const selectEl = typeof document !== 'undefined' && document.getElementById
            ? document.getElementById('uploadWizardSelect')
            : null;
        if (!selectEl) {
            setGapStatus(bannerEl, 'The period picker is not on screen. Open the Upload tab and try again.', 'bad');
            return { ok: false, reason: 'no-select' };
        }

        const options = selectEl.options ? Array.prototype.slice.call(selectEl.options) : [];
        const match = options.find(o => o && o.value === optionId);
        if (!match) {
            setGapStatus(bannerEl,
                `That period (${optionId}) is not in the list any more. Reload the page to rebuild it.`, 'bad');
            return { ok: false, reason: 'no-option' };
        }
        if (match.disabled) {
            setGapStatus(bannerEl,
                `${match.textContent || optionId} is already uploaded, so there is nothing to backfill.`, 'bad');
            return { ok: false, reason: 'disabled' };
        }

        selectEl.value = optionId;
        if (typeof selectEl.dispatchEvent === 'function' && typeof Event === 'function') {
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (typeof selectEl.scrollIntoView === 'function') {
            selectEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        if (typeof selectEl.focus === 'function') selectEl.focus();
        setGapStatus(bannerEl,
            `Loaded into the picker: ${match.textContent || optionId}. Paste that period's data below and press Load Data.`);
        return { ok: true, label: match.textContent || optionId };
    }

    /* One listener on the banner, not one per chip.

       The banner's innerHTML is rebuilt on every upload and on every refresh,
       so per-chip listeners would be re-attached to brand new nodes each time
       while the old ones went out with the nodes they were on. Delegation binds
       to the one element that survives the re-render.

       The bound flag lives on the element for the same reason the select's
       does: refresh() runs many times in a session, and a listener that stacks
       up fires the fill once per past render. */
    function bindGapChips(bannerEl) {
        if (!bannerEl || typeof bannerEl.addEventListener !== 'function') return;
        if (bannerEl.dataset) {
            if (bannerEl.dataset.gapChipsBound) return;
            bannerEl.dataset.gapChipsBound = '1';
        } else {
            if (bannerEl._gapChipsBound) return;
            bannerEl._gapChipsBound = true;
        }
        bannerEl.addEventListener('click', (ev) => {
            const target = ev && ev.target;
            const chip = target && typeof target.closest === 'function'
                ? target.closest('[data-upload-option]')
                : null;
            if (!chip) return;
            if (typeof ev.preventDefault === 'function') ev.preventDefault();
            selectPeriodFromChip(chip.getAttribute('data-upload-option'), bannerEl);
        });
    }

    /* The coverage report: every kind of period the scan knows about, grouped
       by kind, with a chip for each one that can be filled in a click.

       The blocks stay separate and the separations are not cosmetic. A hole
       between uploads is probably an oversight. A blank start to the year is a
       decision about how far back to go. A missing quarter is neither, and a
       missing YTD is not a gap in a trend line at all. It is a feature switch
       nobody knows is off. Rolling them into one number is exactly what made
       four blank months read as "1 week never uploaded".

       The strings are still locally formatted dates and month names, so the
       innerHTML stays reasonable, but the chips now carry option ids in
       attributes and ids are data: they are built from period keys that the
       user's own uploads write into the store. Every id and every label goes
       through escapeHtml, on the principle that an attribute is the one place
       where a stray quote stops being a typo and starts being markup. */
    function renderGapBanner(bannerEl, gaps) {
        if (!bannerEl) return;
        const months = (gaps && gaps.emptyMonths) || [];
        const monthOptions = (gaps && gaps.monthOptions) || [];
        const quarterOptions = (gaps && gaps.quarterOptions) || [];
        const priorWeeks = (gaps && gaps.priorWeeks) || [];
        const ytd = (gaps && gaps.ytd) || null;
        const ytdProblem = !!(ytd && (ytd.isMissing || ytd.isStale));

        if (!gaps || (!gaps.totalMissing && !gaps.priorCount && !months.length
            && !quarterOptions.length && !ytdProblem)) {
            bannerEl.style.display = 'none';
            bannerEl.innerHTML = '';
            return;
        }

        const { weeks, totalMissing, shownCount } = gaps;
        // Colors come from the theme variables so the banner stays legible in
        // both light and dark mode. Hardcoded hex reads as invisible text
        // once the dark theme swaps the surface underneath it.
        const HEAD = 'font-weight:bold; margin-bottom:6px; color:var(--yellow-text, #6c4400);';
        const BODY = 'font-size:0.85em; margin-bottom:6px; color:var(--text-primary, var(--text-primary));';
        const RULE = 'margin-top:12px; padding-top:10px; border-top:1px solid var(--border);';
        const FAINT = 'margin-top:6px; font-size:0.8em; color:var(--yellow-text, #6c4400);';

        const weekChips = chipsFor(weeks, weekChipText);
        const monthChips = chipsFor(monthOptions, monthChipText);
        const quarterChips = chipsFor(quarterOptions, quarterChipText);
        const priorChips = chipsFor(priorWeeks, weekChipText);

        // A tally across the kinds, so the shape of the problem is readable
        // before any of the detail is.
        const tally = [];
        if (totalMissing) tally.push(`${totalMissing} week${totalMissing === 1 ? '' : 's'} missing`);
        // The blank start counts here as well, or the tally reads "1 week
        // missing" over a banner that goes on to list eighteen more.
        if (gaps.priorCount) tally.push(`${gaps.priorCount} week${gaps.priorCount === 1 ? '' : 's'} before your first upload`);
        if (monthOptions.length) tally.push(`${monthOptions.length} month${monthOptions.length === 1 ? '' : 's'} missing`);
        if (quarterOptions.length) tally.push(`${quarterOptions.length} quarter${quarterOptions.length === 1 ? '' : 's'} missing`);
        if (ytd && ytd.isMissing) tally.push('no YTD on file');
        else if (ytd && ytd.isStale) tally.push(`YTD ${ytd.daysBehind} days old`);
        const anyChips = !!(weekChips || monthChips || quarterChips || priorChips);
        const header =
            `<div style="${HEAD}">📋 Coverage${gaps.year ? ` for ${gaps.year}` : ''}: ${tally.join(' · ')}</div>` +
            (anyChips ? `<div style="${BODY}">Click any chip to load that period into the picker below.</div>` : '');

        // YTD leads, because it is the only one here that turns something off.
        const ytdBlock = !ytdProblem ? '' :
            `<div style="${HEAD}">${ytd.isMissing
                ? `🚫 No YTD on file for ${ytd.year}`
                : `🕓 Your YTD closed in ${ytd.closedMonth}`}</div>` +
            `<div style="${BODY}">${ytd.isMissing
                ? (ytd.latestEnd
                    ? `The newest YTD upload ends ${fmtLong(parseLocalDate(ytd.latestEnd))}, which is last year's.`
                    : 'Nothing has ever been uploaded as a YTD file.')
                : `It ends ${fmtLong(parseLocalDate(ytd.latestEnd))}, ${ytd.daysBehind} days behind the last finished week.`}
                A real YTD upload is the source of truth for the whole app, and the parts that need one do not guess without it: the morning pulse refuses to say anything about year pace until a current-year YTD is on file. That is what "the feature went quiet for no reason" looks like from here.</div>` +
            `<div style="${BODY}">YTD is the one period with no chip. It needs the end date it covers, which only you know, so pick "YTD (pick end date)" from the dropdown below and set that date.</div>`;

        const more = totalMissing > shownCount
            ? `<div style="${FAINT}">+ ${totalMissing - shownCount} older week${totalMissing - shownCount === 1 ? '' : 's'} not shown.</div>`
            : '';
        const gapBlock = !totalMissing ? '' :
            `<div style="${HEAD}">⚠️ ${totalMissing} week${totalMissing === 1 ? '' : 's'} never uploaded</div>` +
            `<div style="${BODY}">Week-over-week trends skip these gaps. Click one to load it into the picker below.</div>` +
            `<div>${weekChips}</div>${more}`;

        // Monthly first inside this block, because it is one file per month
        // against four or five, and the rankings cannot tell the difference: a
        // month rebuilt from weeks and a month uploaded whole are ranked by the
        // same code.
        const priorMore = (gaps.priorCount || 0) > priorWeeks.length
            ? `<div style="${FAINT}">+ ${gaps.priorCount - priorWeeks.length} older week${gaps.priorCount - priorWeeks.length === 1 ? '' : 's'} not shown.</div>`
            : '';
        // firstCoveredDate is null when the store is empty, and formatting that
        // rendered a heading reading "Nothing uploaded before Invalid Date" on
        // exactly the install least able to interpret it.
        const startHead = gaps.firstCoveredDate
            ? `📅 Nothing uploaded before ${fmtLong(parseLocalDate(gaps.firstCoveredDate))}`
            : '📅 Nothing uploaded yet this year';
        const startBlock = !(gaps.priorCount || months.length) ? '' :
            `<div style="${HEAD}">${startHead}</div>` +
            (months.length
                ? `<div style="${BODY}">${andList(months)} ${months.length === 1 ? 'has' : 'have'} no data at all, so ${months.length === 1 ? 'it is' : 'they are'} blank in trends, month rebuilds and the rankings trajectory.</div>`
                : '') +
            (monthOptions.length
                ? `<div style="${BODY}"><strong>You do not need the weeks.</strong> Upload each one as a Monthly period. One file per month, ranked exactly like a month rebuilt from weeklies.</div>` +
                  `<div style="margin-bottom:6px;">${monthChips}</div>`
                : '') +
            (gaps.priorCount
                ? `<div style="${BODY}">The ${gaps.priorCount} individual week${gaps.priorCount === 1 ? ' is' : 's are'} there too, if you want week-over-week detail inside those months.</div>` +
                  `<div>${priorChips}</div>${priorMore}`
                : '');

        const quarterBlock = !quarterOptions.length ? '' :
            `<div style="${HEAD}">📆 ${quarterOptions.length} completed quarter${quarterOptions.length === 1 ? '' : 's'} with no quarterly upload</div>` +
            `<div style="${BODY}">${quarterOptions.map(q => {
                const miss = q.monthsMissing || [];
                return miss.length >= 3
                    ? `${quarterChipText(q)} has nothing on file for any of its three months`
                    : `${quarterChipText(q)} is missing ${andList(miss)}`;
            }).join('. ')}. A quarterly upload lands as one row for the whole quarter, so it fills the quarter and nothing inside it: the months and weeks it spans stay exactly as blank as they are now.</div>` +
            `<div>${quarterChips}</div>`;

        const status = `<div id="${GAP_STATUS_ID}" role="status" aria-live="polite" ` +
            `style="display:none; ${RULE} font-size:0.85em; font-weight:bold; color:var(--text-primary, var(--text-primary));"></div>`;

        const blocks = [ytdBlock, gapBlock, startBlock, quarterBlock].filter(Boolean);

        ensureChipStyles();
        bannerEl.style.display = 'block';
        // Every block is ruled off from the one above it, the header included:
        // four kinds of period stacked with no divider read as one long
        // complaint rather than four separate answers.
        bannerEl.innerHTML = header +
            blocks.map(b => `<div style="${RULE}">${b}</div>`).join('') +
            status;
        bindGapChips(bannerEl);
    }

    // Read the currently selected <option> back out as an option object. The
    // dataset attributes set in appendOption are the only state that survives a
    // re-render, so they are the source of truth here.
    function optionFromSelect(selectEl) {
        const opt = selectEl?.options?.[selectEl.selectedIndex];
        if (!opt || !opt.value) return null;
        return {
            id: opt.value,
            periodType: opt.dataset.periodType,
            startDate: opt.dataset.startDate || null,
            endDate: opt.dataset.endDate || null,
            requiresEndDatePick: opt.dataset.requiresEndDatePick === '1',
            requiresDailyDatePick: opt.dataset.requiresDailyDatePick === '1',
            defaultDate: opt.dataset.defaultDate || null,
            dailyUploadedDates: opt.dataset.dailyUploadedDates || '',
            latestYtdEnd: opt.dataset.latestYtdEnd || null,
            priorUpload: (opt.dataset.priorEndDate || opt.dataset.priorUploadedAt)
                ? { endDate: opt.dataset.priorEndDate || '', uploadedAt: opt.dataset.priorUploadedAt || '' }
                : null
        };
    }

    // Refresh the dropdown using current weeklyData / ytdData. Called
    // on initial render and whenever an upload completes (so the
    // dropdown instantly reflects the new upload state).
    function refresh() {
        const selectEl = document.getElementById('uploadWizardSelect');
        if (!selectEl) return;
        const weekly = getWeeklyStore();
        const ytd = (typeof ytdData !== 'undefined' ? ytdData : null)
            || window.DevCoachModules?.storage?.loadYtdData?.()
            || {};
        const daily = (typeof dailyData !== 'undefined' ? dailyData : null)
            || window.DevCoachModules?.storage?.loadDailyData?.()
            || {};
        const today = new Date();
        const options = annotateUploadState(computeUploadOptions(today), weekly, ytd, daily);

        // Fold in missing weeks, skipping any the standard option list
        // already covers (e.g. "Last week" when last week is a gap).
        // The ytd store goes in so the banner can report whether a real YTD
        // exists for this year at all: it is the source of truth downstream,
        // and its absence is invisible everywhere else.
        const gaps = computeMissingWeeks(weekly, today, 12, ytd);
        const knownIds = new Set(options.map(o => o.id));
        // Weeks before the first upload are offered too. Telling someone four
        // months are blank and giving them no way to fill them is half a feature.
        // Quarters ride the same path; the last completed one is already in the
        // standard list, so the filter below keeps it from appearing twice.
        const extraGaps = gaps.weeks
            .concat(gaps.quarterOptions || [])
            .concat(gaps.monthOptions || [])
            .concat(gaps.priorWeeks || [])
            .filter(w => !knownIds.has(w.id));
        renderDropdown(selectEl, options.concat(extraGaps));
        renderGapBanner(document.getElementById('uploadWizardGapBanner'), gaps);

        // If the just-uploaded option cleared the selection, also
        // reset the YTD/daily date pickers, summary line, and legacy date
        // inputs so the UI doesn't dangle with stale values.
        if (!selectEl.value) {
            const ytdPicker = document.getElementById('uploadWizardYtdDatePicker');
            const ytdInput = document.getElementById('uploadWizardYtdEnd');
            const dailyPicker = document.getElementById('uploadWizardDailyDatePicker');
            const dailyInput = document.getElementById('uploadWizardDailyDate');
            const dailyWeekSummary = document.getElementById('uploadWizardDailyWeekSummary');
            const summaryEl = document.getElementById('uploadWizardSummary');
            if (ytdPicker) ytdPicker.style.display = 'none';
            if (ytdInput) ytdInput.value = '';
            if (dailyPicker) dailyPicker.style.display = 'none';
            if (dailyInput) dailyInput.value = '';
            if (dailyWeekSummary) {
                dailyWeekSummary.style.display = 'none';
                dailyWeekSummary.textContent = '';
            }
            if (summaryEl) {
                summaryEl.style.display = 'none';
                summaryEl.textContent = '';
            }
            applySelectionToHiddenInputs(null);
        } else {
            // The selection survived — a period that can be uploaded again.
            // Re-render the summary so it names the copy that just landed
            // rather than the one it replaced.
            const option = optionFromSelect(selectEl);
            const override = option?.requiresDailyDatePick
                ? (document.getElementById('uploadWizardDailyDate')?.value || option.defaultDate || null)
                : option?.requiresEndDatePick
                    ? (document.getElementById('uploadWizardYtdEnd')?.value || null)
                    : null;
            // The end date moves at midnight, so re-sync the hidden inputs
            // rather than trusting what the last selection wrote.
            applySelectionToHiddenInputs(option, override);
            updateSummary(document.getElementById('uploadWizardSummary'), option, override);
        }
    }

    function bind() {
        const selectEl = document.getElementById('uploadWizardSelect');
        if (!selectEl || selectEl.dataset.wizardBound) return;
        selectEl.dataset.wizardBound = '1';

        const ytdPicker = document.getElementById('uploadWizardYtdDatePicker');
        const ytdInput = document.getElementById('uploadWizardYtdEnd');
        const dailyPicker = document.getElementById('uploadWizardDailyDatePicker');
        const dailyInput = document.getElementById('uploadWizardDailyDate');
        const dailyWeekSummary = document.getElementById('uploadWizardDailyWeekSummary');
        const summaryEl = document.getElementById('uploadWizardSummary');
        refresh();

        function currentOptionFromDropdown() {
            return optionFromSelect(selectEl);
        }

        selectEl.addEventListener('change', () => {
            const option = currentOptionFromDropdown();
            if (!option) {
                if (ytdPicker) ytdPicker.style.display = 'none';
                if (dailyPicker) dailyPicker.style.display = 'none';
                applySelectionToHiddenInputs(null);
                updateSummary(summaryEl, null);
                return;
            }
            if (option.requiresEndDatePick) {
                if (ytdPicker) ytdPicker.style.display = 'block';
                if (dailyPicker) dailyPicker.style.display = 'none';
                applySelectionToHiddenInputs(option, ytdInput?.value || null);
                updateSummary(summaryEl, option, ytdInput?.value || null);
                if (ytdInput && !ytdInput.value) ytdInput.focus();
            } else if (option.requiresDailyDatePick) {
                if (ytdPicker) ytdPicker.style.display = 'none';
                if (dailyPicker) dailyPicker.style.display = 'block';
                // Seed with defaultDate (yesterday) if user hasn't picked yet.
                if (dailyInput && !dailyInput.value && option.defaultDate) {
                    dailyInput.value = option.defaultDate;
                }
                const chosen = dailyInput?.value || option.defaultDate || null;
                applySelectionToHiddenInputs(option, chosen);
                updateSummary(summaryEl, option, chosen);
                renderDailyWeekSummary(dailyWeekSummary, option.dailyUploadedDates);
                if (dailyInput) dailyInput.focus();
            } else {
                if (ytdPicker) ytdPicker.style.display = 'none';
                if (dailyPicker) dailyPicker.style.display = 'none';
                applySelectionToHiddenInputs(option);
                updateSummary(summaryEl, option);
            }
        });

        if (ytdInput) {
            ytdInput.addEventListener('change', () => {
                const option = currentOptionFromDropdown();
                if (!option) return;
                applySelectionToHiddenInputs(option, ytdInput.value);
                updateSummary(summaryEl, option, ytdInput.value);
            });
        }

        if (dailyInput) {
            dailyInput.addEventListener('change', () => {
                const option = currentOptionFromDropdown();
                if (!option) return;
                applySelectionToHiddenInputs(option, dailyInput.value);
                updateSummary(summaryEl, option, dailyInput.value);
            });
        }

    }

    // Public API
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.uploadWizard = {
        computeUploadOptions,
        annotateUploadState,
        computeMissingWeeks,
        missingWeeksInRange,
        monthCoverage,
        missingMonthOptions,
        quarterCoverage,
        missingQuarterOptions,
        ytdCoverage,
        // Exported for the tests: this banner is the thing a supervisor reads
        // to decide whether their year is complete, so its wording is pinned.
        renderGapBanner,
        // Exported because the chips are the one part of the banner with a
        // consequence, and a test that only reads the markup would never notice
        // the change event going missing.
        selectPeriodFromChip,
        refresh,
        bind
    };
})();
