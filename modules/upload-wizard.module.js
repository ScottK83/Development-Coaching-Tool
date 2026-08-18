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
    // ============================================

    const MS_PER_DAY = 86_400_000;

    // Period kinds that span multiple weeks — uploading one of these leaves
    // the individual weeks inside it blank for week-over-week trends. YTD is
    // deliberately absent: it's a whole-year roll-up uploaded on purpose, so
    // listing every unfilled week of the year would just be noise.
    const MULTI_WEEK_PERIOD_TYPES = new Set(['month', 'quarter', 'custom']);
    const MAX_RANGE_GAPS_SHOWN = 16;

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
            label: 'Daily data (pick a day — defaults to yesterday)',
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
                label: `This week in progress (${fmtShort(thisWeekMon)} – ${fmtShort(yesterday)})`,
                periodType: 'week-in-progress',
                startDate: isoDate(thisWeekMon),
                endDate: isoDate(yesterday),
                priority: 1
            });
        }

        // 2. Last completed week
        options.push({
            id: `week-${isoDate(lastWeekMon)}`,
            label: `Last week (${fmtShort(lastWeekMon)} – ${fmtShort(lastWeekSun)})`,
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
                label: `${mtdMonthName} to date (${fmtShort(thisMonthFirstForMtd)} – ${fmtShort(yesterday)})`,
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
                        (mo.weeks ? ` — ${mo.weeks} week${mo.weeks === 1 ? '' : 's'} on file` : ''),
                    periodType: 'month',
                    startDate: isoDate(start),
                    endDate: isoDate(end),
                    isMissingPeriod: true,
                    priority: 2.4
                };
            })
            .reverse();   // nearest first, like the missing weeks
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
                    label: `${fmtShort(mon)} – ${fmtLong(sun)} (before your first upload)`,
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

    function computeMissingWeeks(weeklyStore, today = new Date(), maxOptions = 12) {
        const lastWeekMon = addDays(mondayOf(today), -7);
        const { mondays: uploadedMondays } = scanUploadedWeeks(weeklyStore);
        const earliestMon = earliestCoveredMonday(weeklyStore);

        const prior = priorYearCoverage(weeklyStore, today, earliestMon, maxOptions);
        if (!earliestMon) {
            return Object.assign({ weeks: [], totalMissing: 0, shownCount: 0 }, prior);
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
                label: `${fmtShort(mon)} – ${fmtLong(sun)} (${weeksAgo} week${weeksAgo === 1 ? '' : 's'} ago)`,
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
        }, prior);
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
            el.textContent = `${prefix || ''}${opt.label}`;
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
            summaryEl.textContent = `Will save as daily — ${fmtLong(d)}. (Ephemeral; cleared when a weekly upload covers this date.)`;
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
        summaryEl.textContent = `Will save as ${option.periodType} — ${fmtLong(startD)} through ${fmtLong(endD)}.`;

        // A range upload lands as a single row. Spell out which weeks inside
        // it are still missing, so it's obvious what else to paste if you
        // want week-over-week movement across the range.
        if (MULTI_WEEK_PERIOD_TYPES.has(option.periodType)) {
            const gaps = missingWeeksInRange(getWeeklyStore(), start, endDate);
            if (gaps.length) {
                const shown = gaps.slice(0, MAX_RANGE_GAPS_SHOWN);
                const chips = shown.map(g =>
                    `<span style="display:inline-block; padding:2px 8px; margin:2px 4px 2px 0; background:var(--bg-surface, var(--bg-surface)); color:var(--text-primary, var(--text-primary)); border:1px solid var(--yellow, #e0a800); border-radius:10px; font-size:0.9em; white-space:nowrap;">${fmtShort(parseLocalDate(g.startDate))} – ${fmtShort(parseLocalDate(g.endDate))}</span>`
                ).join('');
                const more = gaps.length > shown.length
                    ? `<div style="margin-top:4px;">+ ${gaps.length - shown.length} more.</div>`
                    : '';
                summaryEl.innerHTML = `<div>${summaryEl.textContent}</div>` +
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
            const mark = uploadedSet.has(iso) ? '✓' : '—';
            parts.push(`${dayNames[i]} ${mark}`);
        }
        if (!parts.length) {
            summaryEl.style.display = 'none';
            return;
        }
        summaryEl.style.display = 'block';
        summaryEl.textContent = `This week so far: ${parts.join(' · ')}`;
    }

    // Show a summary of the weeks that never got uploaded. All strings
    // here are locally formatted dates, so plain innerHTML is safe.
    function renderGapBanner(bannerEl, gaps) {
        if (!bannerEl) return;
        if (!gaps || (!gaps.totalMissing && !gaps.priorCount && !(gaps.emptyMonths || []).length)) {
            bannerEl.style.display = 'none';
            bannerEl.innerHTML = '';
            return;
        }
        const { weeks, totalMissing, shownCount } = gaps;
        // Colors come from the theme variables so the banner stays legible in
        // both light and dark mode — hardcoded hex reads as invisible text
        // once the dark theme swaps the surface underneath it.
        const chips = weeks.map(w => {
            const mon = parseLocalDate(w.startDate);
            const sun = parseLocalDate(w.endDate);
            return `<span style="display:inline-block; padding:2px 8px; margin:2px 4px 2px 0; background:var(--bg-surface, var(--bg-surface)); color:var(--text-primary, var(--text-primary)); border:1px solid var(--yellow, #e0a800); border-radius:10px; font-size:0.82em; white-space:nowrap;">${fmtShort(mon)} – ${fmtShort(sun)}</span>`;
        }).join('');
        const more = totalMissing > shownCount
            ? `<div style="margin-top:6px; font-size:0.8em; color:var(--yellow-text, #6c4400);">+ ${totalMissing - shownCount} older week${totalMissing - shownCount === 1 ? '' : 's'} not shown.</div>`
            : '';
        // Two different problems, said separately. A hole between uploads is
        // probably an oversight; a blank start to the year is a decision about
        // how far back to go, and lumping them into one count made the January
        // to April hole read as "1 week never uploaded".
        const gapBlock = totalMissing ? `
            <div style="font-weight:bold; margin-bottom:6px; color:var(--yellow-text, #6c4400);">⚠️ ${totalMissing} week${totalMissing === 1 ? '' : 's'} never uploaded</div>
            <div style="font-size:0.85em; margin-bottom:6px; color:var(--text-primary, var(--text-primary));">Week-over-week trends skip these gaps. Pick one from the dropdown below to backfill it.</div>
            <div>${chips}</div>
            ${more}` : '';

        const months = gaps.emptyMonths || [];
        const monthText = months.length === 1
            ? `${months[0]} has`
            : `${months.slice(0, -1).join(', ')} and ${months[months.length - 1]} have`;
        // Monthly first, because it is one file per month against four or five,
        // and the rankings cannot tell the difference: a month rebuilt from weeks
        // and a month uploaded whole are ranked by the same code.
        const monthCount = (gaps.monthOptions || []).length;
        const startBlock = (gaps.priorCount || months.length) ? `
            <div style="${totalMissing ? 'margin-top:12px; padding-top:10px; border-top:1px solid var(--border);' : ''} font-weight:bold; margin-bottom:6px; color:var(--yellow-text, #6c4400);">📅 Nothing uploaded before ${fmtLong(parseLocalDate(gaps.firstCoveredDate))}</div>
            ${months.length ? `<div style="font-size:0.85em; margin-bottom:6px; color:var(--text-primary, var(--text-primary));">${monthText} no data at all, so ${months.length === 1 ? 'it is' : 'they are'} blank in trends, month rebuilds and the rankings trajectory.</div>` : ''}
            ${monthCount ? `<div style="font-size:0.85em; margin-bottom:4px; color:var(--text-primary, var(--text-primary));"><strong>You do not need the weeks.</strong> Upload each one as a Monthly period — one file per month, ranked exactly like a month rebuilt from weeklies. ${monthCount === 1 ? 'It is' : 'All ' + monthCount + ' are'} in the dropdown.</div>` : ''}
            ${gaps.priorCount ? `<div style="font-size:0.85em; color:var(--text-primary, var(--text-primary));">The ${gaps.priorCount} individual week${gaps.priorCount === 1 ? ' is' : 's are'} there too, if you want week-over-week detail inside those months.</div>` : ''}` : '';

        bannerEl.style.display = 'block';
        bannerEl.innerHTML = gapBlock + startBlock;
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
        const gaps = computeMissingWeeks(weekly, today);
        const knownIds = new Set(options.map(o => o.id));
        // Weeks before the first upload are offered too — telling someone four
        // months are blank and giving them no way to fill them is half a feature.
        const extraGaps = gaps.weeks
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
            const opt = selectEl.options[selectEl.selectedIndex];
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
                latestYtdEnd: opt.dataset.latestYtdEnd || null
            };
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
        // Exported for the tests: this banner is the thing a supervisor reads
        // to decide whether their year is complete, so its wording is pinned.
        renderGapBanner,
        refresh,
        bind
    };
})();
