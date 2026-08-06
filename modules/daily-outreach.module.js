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
     */
    const PLANS = {
        monday: {
            id: 'monday',
            label: 'Monday Kickoff',
            covers: 'lastWeek',
            coverageLabel: 'last week',
            base: 'kickoff',
            dailyMode: 'none'
        },
        tuesday: {
            id: 'tuesday',
            label: 'Tuesday Follow-up',
            covers: 'lastWeekPlusMonday',
            coverageLabel: 'last week plus Monday',
            base: 'kickoff',
            dailyMode: 'monday'
        },
        wednesday: {
            id: 'wednesday',
            label: 'Wednesday Check-in',
            covers: 'thisWeek',
            coverageLabel: 'this week so far vs last week',
            base: 'weekProgress',
            dailyMode: 'wtd'
        },
        thursday: {
            id: 'thursday',
            label: 'Thursday Check-in',
            covers: 'thisWeek',
            coverageLabel: 'this week so far vs last week',
            base: 'weekProgress',
            dailyMode: 'wtd'
        },
        friday: {
            id: 'friday',
            label: 'Friday Finish',
            covers: 'thisWeek',
            coverageLabel: 'the week you just worked',
            base: 'weekClosing',
            dailyMode: 'wtd'
        },
        weekend: {
            id: 'weekend',
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

    // Monday of the week that contains `date`, as an ISO string.
    function mondayOf(date) {
        const when = new Date(date instanceof Date ? date.getTime() : Date.now());
        when.setHours(0, 0, 0, 0);
        const dow = when.getDay();
        when.setDate(when.getDate() - (dow === 0 ? 6 : dow - 1));
        return isoDate(when);
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
                    detail: 'Nothing uploaded for this week yet — no week-in-progress file and no daily files.'
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
                detail: `Last week hasn't been uploaded — the newest weekly file ends ${end}.`
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
     * metric-keyed object the caller has already weighted — this module does
     * not do metric math, so there's only one place that owns it.
     */
    function buildDailyRecap(plan, rollup, options) {
        if (!plan || plan.dailyMode === 'none' || !rollup) return '';

        const opts = options || {};
        const metrics = Array.isArray(opts.metrics) ? opts.metrics : [];
        const format = typeof opts.formatValue === 'function' ? opts.formatValue : (key, value) => String(value);

        const parts = metrics
            .filter(m => Number.isFinite(rollup[m.key]))
            .map(m => `${m.label} ${format(m.key, rollup[m.key])}`);

        if (!parts.length) return '';

        if (plan.dailyMode === 'monday') {
            return `📊 Monday looked like this: ${parts.join(', ')}.`;
        }

        const days = Number.isFinite(opts.dayCount) ? opts.dayCount : 0;
        const dayText = days > 0 ? ` (${days} day${days === 1 ? '' : 's'} in)` : '';
        return `📊 Week to date${dayText}: ${parts.join(', ')}.`;
    }

    function joinList(items) {
        if (items.length <= 1) return items[0] || '';
        if (items.length === 2) return `${items[0]} and ${items[1]}`;
        return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
    }

    /**
     * The midweek and end-of-week message: where this week stands against last
     * week, and what actually moved.
     *
     * The old midweek note just recalled Monday's focus and said keep going,
     * which reads as filler when the numbers to compare are sitting right
     * there. This one leads with the comparison.
     *
     * data:
     *   firstName    who it's addressed to
     *   tone         'midweek' (Wed/Thu) or 'closing' (Fri)
     *   sourceLabel  what "this week" is built from, for the standings line
     *   daysIn       days of data behind it, 0 if unknown
     *   standings    [{ label, latestText, baseText }] — current vs last week
     *   improved     [{ label, deltaText }] — moved the right way past noise
     *   slipped      [{ label, deltaText }] — moved the wrong way past noise
     *   focus        { label, valueText, targetText } or null
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
        // calling that "this week" would be a plain misstatement.
        const thisWeek = d.thisWeek !== false;
        const opener = closing
            ? (thisWeek
                ? `Hey ${name}! Closing out the week, so here is how it went next to last week.`
                : `Hey ${name}! Closing out the week. Your newest full week is still the one before this, so here it is against the week before that.`)
            : (thisWeek
                ? `Hey ${name}! Quick look at where this week stands next to last week.`
                : `Hey ${name}! This week has not landed in a file yet, so here is your most recent full week against the one before it.`);

        const blocks = [opener];

        if (standings.length) {
            const dayText = d.daysIn > 0 ? ` (${d.daysIn} day${d.daysIn === 1 ? '' : 's'} in)` : '';
            const heading = closing ? 'Where you landed' : (thisWeek ? 'Where you are' : 'Most recent full week');
            const parts = standings.map(s => (d.hasBaseline && s.baseText
                ? `${s.label} ${s.latestText}, was ${s.baseText}`
                : `${s.label} ${s.latestText}`));
            blocks.push(`📊 ${heading}${dayText}: ${parts.join('. ')}.`);
        }

        if (improved.length) {
            blocks.push(`✅ Up from last week: ${joinList(improved.map(i => `${i.label} ${i.deltaText}`))}.`);
        } else if (d.hasBaseline && standings.length && !slipped.length) {
            blocks.push('✅ Holding steady against last week, no real slippage anywhere.');
        }

        if (slipped.length) {
            blocks.push(`👀 Slid a little: ${joinList(slipped.map(s => `${s.label} ${s.deltaText}`))}.`);
        }

        if (d.focus) {
            const push = closing ? 'Worth a push next week' : 'Worth a push';
            blocks.push(`🎯 ${push}: ${d.focus.label} is ${d.focus.valueText} against a ${d.focus.targetText} target.`);
        }

        if (!standings.length) {
            blocks.push(closing
                ? 'Not enough in yet to put numbers on the week, but I wanted to close it out with you anyway.'
                : "Not enough in yet to put numbers on this week, so treat this as a nudge rather than a scorecard.");
        }

        blocks.push(closing
            ? 'Good work this week. Have a good weekend.'
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
