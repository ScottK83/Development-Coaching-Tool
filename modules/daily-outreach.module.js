(function () {
    'use strict';

    /**
     * DAILY OUTREACH
     *
     * "Run My Monday" only ever knew how to run on a Monday. This holds the
     * rules that let the same sweep run any day of the week: what a given
     * weekday's message is allowed to talk about, whether the uploads on hand
     * actually back it up, and whether that associate already got it.
     *
     * Everything here is pure apart from the four localStorage calls at the
     * bottom, so the weekday rules can be tested without a browser.
     */

    const PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
    const SENT_LOG_KEY = PREFIX + 'dailyOutreachSent';
    // A send log is only useful for as long as you'd plausibly re-send. Two
    // months of keys is a few KB; keeping the year would slowly bloat storage
    // that already has a 4MB ceiling.
    const RETENTION_DAYS = 60;

    /**
     * covers:
     *   lastWeek           the completed week's upload
     *   lastWeekPlusMonday the completed week, plus how Monday went
     *   thisWeek           week-to-date, built from daily uploads
     *
     * base tells the caller which existing message generator to start from;
     * dailyMode tells it which daily rows to append.
     *
     * styleLabel is what the day sounds like rather than what it covers, and it
     * is the only one of these My Team reads now. That page gave the weekday
     * ownership of the period and then put a window picker above it that owned
     * the period too, so one screen could announce "covers last week" over a
     * month-to-date field. The window owns time there; the weekday owns tone.
     *
     * covers and coverageLabel stay, because Run My Day still sweeps on the real
     * calendar weekday and genuinely does mean "today is Wednesday, so this is a
     * midweek note about this week".
     */
    const PLANS = {
        monday: {
            id: 'monday',
            styleLabel: 'Opens the period. Recaps how it went and sets one focus.',
            label: 'Monday Kickoff',
            covers: 'lastWeek',
            coverageLabel: 'last week',
            base: 'kickoff',
            dailyMode: 'none'
        },
        tuesday: {
            id: 'tuesday',
            styleLabel: 'A follow-up on the same recap, with how the first day back went added.',
            label: 'Tuesday Follow-up',
            covers: 'lastWeekPlusMonday',
            coverageLabel: 'last week plus Monday',
            base: 'kickoff',
            dailyMode: 'monday'
        },
        wednesday: {
            id: 'wednesday',
            styleLabel: 'A check-in partway through. Leads with what has moved.',
            label: 'Wednesday Check-in',
            covers: 'thisWeek',
            coverageLabel: 'this week so far vs last week',
            base: 'weekProgress',
            dailyMode: 'wtd'
        },
        thursday: {
            id: 'thursday',
            styleLabel: 'A check-in partway through. Leads with what has moved.',
            label: 'Thursday Check-in',
            covers: 'thisWeek',
            coverageLabel: 'this week so far vs last week',
            base: 'weekProgress',
            dailyMode: 'wtd'
        },
        friday: {
            id: 'friday',
            styleLabel: 'Closes the period out.',
            label: 'Friday Finish',
            covers: 'thisWeek',
            coverageLabel: 'the week you just worked',
            base: 'weekClosing',
            dailyMode: 'wtd'
        },
        weekend: {
            id: 'weekend',
            styleLabel: 'Opens the period. Recaps how it went and sets one focus.',
            label: 'Weekend Recap',
            covers: 'lastWeek',
            coverageLabel: 'last week',
            base: 'kickoff',
            dailyMode: 'none'
        }
    };

    // Saturday and Sunday aren't part of the weekday rotation, so they fall
    // back to the completed week rather than blocking the sweep entirely.
    const PLAN_BY_WEEKDAY = ['weekend', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'weekend'];

    // The days you can actually pick, in the order they happen.
    const WEEKDAY_IDS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];

    function isoDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function planForDate(date) {
        const when = date instanceof Date ? date : new Date();
        return PLANS[PLAN_BY_WEEKDAY[when.getDay()]];
    }

    function planById(id) {
        return PLANS[id] || null;
    }

    // Week boundaries belong to period-index; this was one of three copies.
    function mondayOf(date) {
        const shared = window.DevCoachModules?.periodIndex;
        return shared ? shared.mondayOf(date instanceof Date ? date : new Date()) : '';
    }

    function weekdayPlans() {
        return WEEKDAY_IDS.map(id => PLANS[id]);
    }

    function shiftDays(iso, days) {
        const when = new Date(iso + 'T12:00:00');
        if (Number.isNaN(when.getTime())) return iso;
        when.setDate(when.getDate() + days);
        return isoDate(when);
    }

    /**
     * How many days of this week a period upload actually covers.
     *
     * "(N days in)" hangs off the standings block, and the standings are read
     * out of the newest weekly file, not out of the daily uploads. Counting
     * daily uploads for that label was the mistake: a week-in-progress upload
     * archives every daily it supersedes, so a Monday-through-Thursday file
     * read as "2 days in" purely because two of its four days had already been
     * folded into it and left the working set. The file's own date range is the
     * honest answer, because it is the thing the numbers came from.
     *
     * Weekdays only, clamped to this week's Monday at the front and to today at
     * the back: a file dated forward does not mean days nobody has worked yet.
     * Returns 0 when the period ends before this week, which is the no-day-count
     * case rather than a zero to print. Those standings are a whole week, and
     * "(0 days in)" on a full week would be worse than saying nothing.
     */
    function daysCoveredThisWeek(facts) {
        const f = facts || {};
        const todayIso = String(f.todayIso || isoDate(new Date())).slice(0, 10);
        const mondayIso = mondayOf(new Date(todayIso + 'T12:00:00'));
        const end = String(f.endDate || '').slice(0, 10);
        if (!mondayIso || !end || end < mondayIso) return 0;

        const start = String(f.startDate || '').slice(0, 10);
        const from = start && start > mondayIso ? start : mondayIso;
        const to = end < todayIso ? end : todayIso;
        if (to < from) return 0;

        let days = 0;
        for (let iso = from; iso <= to; iso = shiftDays(iso, 1)) {
            const dow = new Date(iso + 'T12:00:00').getDay();
            if (dow !== 0 && dow !== 6) days += 1;
        }
        return days;
    }

    /**
     * Does the tool actually hold the period this day's post claims to describe?
     *
     * This is the gap that mattered: a Monday post says "here's your last week",
     * and nothing checked that last week was ever uploaded. With a three-week-old
     * file on disk it would happily describe that as last week. Per-period rather
     * than per-person, so it can be answered once, before any message is written.
     *
     * facts:
     *   todayIso          the day being sent from
     *   latestWeekEndIso  end date of the newest weekly upload
     *   dailyDayCount     distinct days uploaded this week
     */
    function checkPeriodData(plan, facts) {
        const f = facts || {};
        const todayIso = f.todayIso || isoDate(new Date());
        const thisWeekStart = mondayOf(new Date(todayIso + 'T12:00:00'));

        const end = String(f.latestWeekEndIso || '').slice(0, 10);

        if (plan.covers === 'thisWeek') {
            const days = Number.isFinite(f.dailyDayCount) ? f.dailyDayCount : 0;
            // A "this week in progress" upload already covers the week so far.
            // Requiring day-by-day files on top of it would be asking for the
            // same numbers twice.
            const weeklyIsInWeek = Boolean(end) && end >= thisWeekStart;

            if (days < 1 && !weeklyIsInWeek) {
                return {
                    ok: false,
                    reason: 'Missing data from this period.',
                    detail: 'Nothing uploaded for this week yet. No week-in-progress file and no daily files.'
                };
            }

            const parts = [];
            if (weeklyIsInWeek) parts.push(`week-in-progress file through ${end}`);
            if (days > 0) parts.push(`${days} daily file${days === 1 ? '' : 's'}`);
            return { ok: true, reason: '', detail: `Using the ${parts.join(' plus ')}.` };
        }

        const lastWeekStart = shiftDays(thisWeekStart, -7);

        if (!end) {
            return { ok: false, reason: 'Missing data from this period.', detail: 'No weekly file has been uploaded at all.' };
        }
        if (end < lastWeekStart) {
            return {
                ok: false,
                reason: 'Missing data from this period.',
                detail: `Last week hasn't been uploaded. The newest weekly file ends ${end}.`
            };
        }
        return { ok: true, reason: '', detail: `Weekly file ends ${end}.` };
    }

    /**
     * What a send is recorded against: the calendar week it went out in.
     *
     * Every day's post is a once-a-week thing per person — "have I sent Alyssa
     * her Tuesday post this week" is the question being asked, so all five days
     * share a week stamp rather than each carrying its own date.
     */
    function stampFor(plan, context) {
        const ctx = context || {};
        return mondayOf(ctx.todayIso ? new Date(ctx.todayIso + 'T12:00:00') : new Date());
    }

    function sendKey(planId, stamp, employeeName) {
        return `${planId}|${stamp}|${employeeName}`;
    }

    /**
     * Does the data on hand actually support this day's message?
     *
     * evidence:
     *   inWeekly       associate appears in the selected weekly upload
     *   dailyRowCount  daily rows for this associate, Monday through today
     *   hasMondayRow   a daily row specifically for Monday
     *
     * Returns { ok, reason, warning }. `warning` is for a message that can
     * still go out but will be thinner than intended.
     */
    function checkCoverage(plan, evidence) {
        const facts = evidence || {};
        const dailyRows = Number.isFinite(facts.dailyRowCount) ? facts.dailyRowCount : 0;

        // Every message is built on the weekly snapshot, even the midweek one —
        // it needs targets and a focal point to talk against.
        if (!facts.inWeekly) {
            return { ok: false, reason: 'Not in the selected weekly upload.' };
        }

        // A week-in-progress upload already carries this associate's week so
        // far, so daily rows are one way to satisfy this, not the only way.
        if (plan.covers === 'thisWeek' && dailyRows < 1 && !facts.weeklyCoversThisWeek) {
            return { ok: false, reason: 'No uploads covering this week yet.' };
        }

        if (plan.covers === 'lastWeekPlusMonday' && !facts.hasMondayRow) {
            // The weekly recap still stands on its own; only the Monday
            // addendum is missing, so this is a note rather than a block.
            return { ok: true, reason: '', warning: "Monday's daily upload is missing, so the message covers last week only." };
        }

        return { ok: true, reason: '', warning: '' };
    }

    /**
     * The daily numbers appended under the base message. `rollup` is a
     * metric-keyed object the caller has already weighted; this module does
     * not do metric math, so there's only one place that owns it.
     *
     * A metric may carry `say(valueText)` to put itself in plain words:
     * "88 calls, handle time 471s, adherence 91.8%" rather than "Volume 88,
     * AHT 471s, +Word 84.8%" (Scott, 2026-10-14). One without it is written
     * as label and value, the way it always was. The heading is words too,
     * not a chart emoji: a message keeps two emojis, the opener's and the
     * sign-off's.
     */
    function buildDailyRecap(plan, rollup, options) {
        if (!plan || plan.dailyMode === 'none' || !rollup) return '';

        const opts = options || {};
        const metrics = Array.isArray(opts.metrics) ? opts.metrics : [];
        const format = typeof opts.formatValue === 'function' ? opts.formatValue : (key, value) => String(value);

        const parts = metrics
            .filter(m => Number.isFinite(rollup[m.key]))
            .map(m => (typeof m.say === 'function'
                ? m.say(format(m.key, rollup[m.key]))
                : `${m.label} ${format(m.key, rollup[m.key])}`));

        if (!parts.length) return '';

        if (plan.dailyMode === 'monday') {
            return `Monday looked like this: ${parts.join(', ')}.`;
        }

        const days = Number.isFinite(opts.dayCount) ? opts.dayCount : 0;
        const dayText = days > 0 ? ` (${days} day${days === 1 ? '' : 's'} in)` : '';
        return `Week to date${dayText}: ${parts.join(', ')}.`;
    }

    function joinList(items) {
        if (items.length <= 1) return items[0] || '';
        if (items.length === 2) return `${items[0]} and ${items[1]}`;
        return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
    }

    // "an 82% target", "a 93% target". Eight, eleven and eighteen are said
    // with a vowel sound up front, and "a 82.0% target" read unproofed.
    function withArticle(text) {
        const s = String(text || '').trim();
        return (/^(8|11(?!\d)|18(?!\d))/.test(s) ? 'an ' : 'a ') + s;
    }

    function pickOne(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    /* The praise the message leads with.
     *
     * The old text had none: the #1 person in the center got the same rows of
     * numbers as somebody having a rough week (Scott, 2026-10-14: "Offer lots
     * of kudos and praise"). A clean sweep is said as one; otherwise two wins
     * by name and the rest as a count; with nothing on target, real movement
     * gets the credit; and with neither, the effort does.
     */
    function praiseLine(d, ongoing) {
        const wins = Array.isArray(d.wins) ? d.wins : [];
        const goals = Number(d.goalCount) || 0;
        if (d.allOnTarget && goals > 1) {
            return ongoing
                ? pickOne([
                    `Every one of your ${goals} goals is on target so far. That's a clean sweep, and it doesn't happen by accident. 🙌`,
                    `On target on all ${goals} of your goals so far. That's as good as it gets. 🙌`
                ])
                : pickOne([
                    `Every one of your ${goals} goals landed on target. That's a clean sweep. 🙌`,
                    `On target on all ${goals} of your goals. That's as good as it gets. 🙌`
                ]);
        }
        if (wins.length) {
            const named = wins.slice(0, 2).map(w => `${w.label} at ${w.valueText}`);
            const rest = wins.length - named.length;
            const list = rest
                ? `${named.join(', ')}, and ${rest} more ${rest === 1 ? 'goal' : 'goals'} on target`
                : joinList(named);
            return pickOne([
                `Love what I'm seeing: ${list}. 🙌`,
                `Big kudos on ${list}. 🙌`,
                `You're doing great work: ${list}. 🙌`
            ]);
        }
        if ((d.improved || []).length) {
            return 'I can see the work paying off, a few numbers are moving the right way.';
        }
        return pickOne([
            'I see the effort you\'re putting in, and it matters.',
            'Appreciate you showing up and putting in the work.'
        ]);
    }

    /**
     * The midweek and end-of-week message: where this week stands against last
     * week, and what actually moved.
     *
     * The old midweek note just recalled Monday's focus and said keep going,
     * which reads as filler when the numbers to compare are sitting right
     * there. This one leads with praise, then the comparison.
     *
     * data:
     *   firstName    who it's addressed to
     *   tone         'midweek' (Wed/Thu) or 'closing' (Fri)
     *   daysIn       days of data behind it, 0 if unknown
     *   thisWeek     false when the numbers are not this week's
     *   nowName      what the numbers are called when not this week's
     *                ("last week"); priorName what they are held against
     *   weekOpen     true when the week described still has a day left to work
     *   standings    [{ label, latestText, baseText }]: where they are now
     *   improved     [{ label, deltaText }]: moved the right way past noise
     *   slipped      [{ label, deltaText }]: moved the wrong way past noise,
     *                on a metric short of target
     *   wins         [{ label, valueText }]: on target, best first
     *   goalCount    how many goals the message can speak to
     *   allOnTarget  every one of them on target
     *   focus        { label, valueText, targetText, yearText } or null
     *   hasBaseline  whether last week was available to compare against
     */
    function buildWeekProgressText(data) {
        const d = data || {};
        const name = d.firstName || 'there';
        const closing = d.tone === 'closing';
        const standings = d.standings || [];
        const improved = d.improved || [];
        const slipped = d.slipped || [];

        // Only say "this week" when the numbers really are this week's. With
        // no week-in-progress file the newest weekly upload is last week, and
        // calling that "this week" would be a plain misstatement. It is named
        // plainly instead: no remark about files or uploads in a message to
        // an associate (Scott's no-disclaimers rule).
        const thisWeek = d.thisWeek !== false;
        const nowName = thisWeek ? 'this week' : (d.nowName || 'last week');
        const priorName = thisWeek ? 'last week' : (d.priorName || 'the week before');
        /* Whether the week being described still has a day left in it.
         *
         * The Friday message is written off whatever file is on hand, and that
         * file usually stops on Thursday. "Where you landed" and "how it went"
         * hand back a finished result on a week the reader is still standing
         * in, and the standings block under this now offers them places they
         * can still take. The two have to agree, so the same fact decides both.
         */
        const open = d.weekOpen === true && thisWeek;
        const opener = closing
            ? (thisWeek
                ? (open
                    ? `Hey ${name}! Closing out the week, so here is how it is going next to last week.`
                    : `Hey ${name}! Closing out the week, so here is how it went next to last week.`)
                : `Hey ${name}! Closing out the week with a look at how ${nowName} went, next to ${priorName}.`)
            : (thisWeek
                ? `Hey ${name}! Quick look at where this week stands next to last week.`
                : `Hey ${name}! Here's how ${nowName} went, next to ${priorName}.`);

        const blocks = [opener];
        blocks.push(praiseLine(d, thisWeek && (!closing || open)));

        if (standings.length) {
            const dayText = thisWeek && d.daysIn > 0 ? ` (${d.daysIn} day${d.daysIn === 1 ? '' : 's'} in)` : '';
            const heading = closing
                ? (open ? 'Where you stand' : 'Where you landed')
                : (thisWeek ? 'Where you are' : nowName.charAt(0).toUpperCase() + nowName.slice(1));
            const parts = standings.map(s => `${s.label} ${s.latestText}`);
            blocks.push(`${heading}${dayText}: ${joinList(parts)}.`);
        }

        if (improved.length) {
            blocks.push(`Better than ${priorName}: ${joinList(improved.map(i => `${i.label} ${i.deltaText}`))}.`);
        } else if (d.hasBaseline && standings.length && !slipped.length) {
            blocks.push(`Holding steady against ${priorName}, no real slippage anywhere.`);
        }

        if (slipped.length) {
            blocks.push(`Slid a little: ${joinList(slipped.map(s => `${s.label} ${s.deltaText}`))}.`);
        }

        if (d.focus) {
            // Next week, unless there is still a day of this one to spend on it.
            const push = closing && !open ? 'Worth a push next week' : 'Worth a push';
            const f = d.focus;
            if (f.yearText) {
                const whose = nowName === 'this week' ? 'this week\'s' : nowName === 'last week' ? 'last week\'s' : 'that week\'s';
                blocks.push(`${push}: ${f.label} for the year is ${f.yearText} against ${withArticle(f.targetText)} target, and ${whose} ${f.valueText} is exactly how we close that.`);
            } else {
                blocks.push(`${push}: ${f.label} is ${f.valueText} against ${withArticle(f.targetText)} target.`);
            }
        }

        const hadWins = (d.wins || []).length > 0 || improved.length > 0;
        blocks.push(closing
            ? `${hadWins ? 'Good work this week.' : 'Thanks for the effort this week.'} Have a good weekend.`
            : 'Keep it rolling, and I will check back before the week is out.');

        return blocks.join('\n\n');
    }

    /**
     * Slots the recap in after the opening paragraph. Appending it to the end
     * would land it under the sign-off, which reads like a postscript nobody
     * asked for.
     */
    function insertRecap(message, recap) {
        const body = String(message || '').trim();
        const line = String(recap || '').trim();
        if (!line) return body;
        if (!body) return line;

        const blocks = body.split(/\n\n+/);
        blocks.splice(1, 0, line);
        return blocks.join('\n\n');
    }

    // --- Send log ---

    function loadSentLog() {
        try {
            const raw = localStorage.getItem(SENT_LOG_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    function saveSentLog(log) {
        try {
            localStorage.setItem(SENT_LOG_KEY, JSON.stringify(log || {}));
        } catch (e) { /* storage full or blocked — the sweep still works */ }
    }

    // Drops entries older than the retention window. Pure so the cutoff is
    // testable without waiting two months.
    function pruneSentLog(log, todayIso) {
        const cutoff = new Date(todayIso + 'T00:00:00');
        if (Number.isNaN(cutoff.getTime())) return log || {};
        cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
        const cutoffIso = isoDate(cutoff);

        const kept = {};
        Object.keys(log || {}).forEach(key => {
            const entry = log[key];
            const at = (entry && entry.at ? String(entry.at) : '').slice(0, 10);
            if (!at || at >= cutoffIso) kept[key] = entry;
        });
        return kept;
    }

    function getSentEntry(log, planId, stamp, employeeName) {
        return (log || {})[sendKey(planId, stamp, employeeName)] || null;
    }

    function markSent(planId, stamp, employeeName, whenIso) {
        const log = loadSentLog();
        log[sendKey(planId, stamp, employeeName)] = {
            at: whenIso || new Date().toISOString(),
            plan: planId,
            employee: employeeName
        };
        saveSentLog(log);
        return log;
    }

    function clearSent(planId, stamp, employeeName) {
        const log = loadSentLog();
        delete log[sendKey(planId, stamp, employeeName)];
        saveSentLog(log);
        return log;
    }

    function clearAllSentForStamp(planId, stamp) {
        const log = loadSentLog();
        const prefix = `${planId}|${stamp}|`;
        Object.keys(log).forEach(key => {
            if (key.indexOf(prefix) === 0) delete log[key];
        });
        saveSentLog(log);
        return log;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.dailyOutreach = {
        PLANS,
        RETENTION_DAYS,
        isoDate,
        planForDate,
        planById,
        weekdayPlans,
        WEEKDAY_IDS,
        mondayOf,
        stampFor,
        sendKey,
        checkCoverage,
        checkPeriodData,
        shiftDays,
        daysCoveredThisWeek,
        buildDailyRecap,
        buildWeekProgressText,
        joinList,
        insertRecap,
        loadSentLog,
        saveSentLog,
        pruneSentLog,
        getSentEntry,
        markSent,
        clearSent,
        clearAllSentForStamp
    };
})();
