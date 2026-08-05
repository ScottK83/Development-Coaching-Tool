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
            dailyMode: 'none',
            perWeek: true
        },
        tuesday: {
            id: 'tuesday',
            label: 'Tuesday Follow-up',
            covers: 'lastWeekPlusMonday',
            coverageLabel: 'last week plus Monday',
            base: 'kickoff',
            dailyMode: 'monday',
            perWeek: false
        },
        midweek: {
            id: 'midweek',
            label: 'Midweek Check-in',
            covers: 'thisWeek',
            coverageLabel: 'this week so far',
            base: 'midweek',
            dailyMode: 'wtd',
            perWeek: false
        },
        thursday: {
            id: 'thursday',
            label: 'Thursday Check-in',
            covers: 'thisWeek',
            coverageLabel: 'this week so far',
            base: 'midweek',
            dailyMode: 'wtd',
            perWeek: false
        },
        friday: {
            id: 'friday',
            label: 'Friday Finish',
            covers: 'thisWeek',
            coverageLabel: 'this week so far',
            base: 'midweek',
            dailyMode: 'wtd',
            perWeek: false
        },
        weekend: {
            id: 'weekend',
            label: 'Weekend Recap',
            covers: 'lastWeek',
            coverageLabel: 'last week',
            base: 'kickoff',
            dailyMode: 'none',
            perWeek: true
        }
    };

    // Saturday and Sunday aren't part of the weekday rotation, so they fall
    // back to the completed week rather than blocking the sweep entirely.
    const PLAN_BY_WEEKDAY = ['weekend', 'monday', 'tuesday', 'midweek', 'thursday', 'friday', 'weekend'];

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

    /**
     * The thing a send is recorded against. A Monday kickoff is a once-a-week
     * message, so it's stamped with the week it covers — running the sweep
     * twice on the same Monday should recognise the first pass. The midweek
     * messages are once-a-day, so they're stamped with the day.
     */
    function stampFor(plan, context) {
        const ctx = context || {};
        if (plan && plan.perWeek) return ctx.weeklyKey || ctx.todayIso || '';
        return ctx.todayIso || '';
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

        if (plan.covers === 'thisWeek' && dailyRows < 1) {
            return { ok: false, reason: 'No daily uploads for this week yet.' };
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
        mondayOf,
        stampFor,
        sendKey,
        checkCoverage,
        buildDailyRecap,
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
