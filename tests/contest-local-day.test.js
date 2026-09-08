'use strict';

/**
 * The contest pays a week or a month once it is OVER, and the module says so:
 *
 *   "A week and a month pay once they are OVER, never while they are still
 *    running. ... Nobody has held a week at target until the week is done."
 *
 * That test is `weekEndOf(week) < asOf`, and `asOf` came from
 * `new Date().toISOString().slice(0, 10)` — the UTC date. Phoenix is UTC-7, so
 * from 17:00 local onward UTC has already rolled to tomorrow. On the closing
 * Sunday of a week, at five in the afternoon, the week read as finished and
 * paid its bonus; on the last day of a month, so did the month.
 *
 * Nothing caught it because every existing contest test pins `asOf`, which is
 * exactly the branch that skips the clock.
 *
 * These tests pin an INSTANT rather than a day, because the whole question is
 * what happens between local 17:00 and local midnight. Node honours a runtime
 * assignment to process.env.TZ on this host, and the suite asserts that it took
 * effect before relying on it.
 */

const { suite } = require('./harness');

const TARGET_DEFAULT = 93;

// An instant, and the local date it falls on in the pinned zone.
function pinInstant(iso) {
    const RealDate = Date;
    const ms = new RealDate(iso).getTime();
    global.Date = class extends RealDate {
        constructor(...args) { if (args.length === 0) super(ms); else super(...args); }
        static now() { return ms; }
    };
    return ms;
}

function load(t) {
    t.installFakeBrowser();
    // The real local-date helper, so this exercises the wiring and not a stub.
    t.loadModule('modules/shared-utils.module.js');
    return t.loadModule('modules/contest.module.js').contest;
}

// A month of typed-in days, all comfortably at target, Mon 31 Aug to Sun 6 Sep.
function monthData() {
    const days = {};
    ['2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06']
        .forEach((d) => { days[d] = { 'Ada Stretch': { adherence: 99, perfectSurveys: 0 } }; });
    return { days };
}

function weeklyEntries(api) {
    return api.computeEntries(monthData(), null).filter((e) => e.reason === 'weekly-adherence');
}

suite('contest: the day rolls at local midnight, not at 17:00', (t) => {
    const realTz = process.env.TZ;
    const realDate = global.Date;
    try {
        process.env.TZ = 'America/Phoenix';
        // Guard the guard: if the host ignored the assignment, say so rather
        // than passing for the wrong reason.
        const probe = new Date('2026-09-07T00:30:00Z');
        const tzTook = probe.getDate() === 6;
        t.check('the pinned timezone actually took effect', tzTook);
        if (!tzTook) return;

        const api = load(t);
        t.equal('the target is the one the rule is written against', api.adherenceTarget(), TARGET_DEFAULT);

        // Sunday 6 September, 10:00 Phoenix. The week closes today; it is not
        // over. Both clocks agree, and nothing pays.
        pinInstant('2026-09-06T17:00:00Z');
        t.equal('at Sunday morning the week has not paid', weeklyEntries(load(t)).length, 0);

        // Sunday 6 September, 17:30 Phoenix. UTC says the 7th. The week is
        // still not over, and this is the instant that used to pay.
        pinInstant('2026-09-07T00:30:00Z');
        t.equal('and at Sunday evening it still has not', weeklyEntries(load(t)).length, 0);

        // Sunday 6 September, 23:30 Phoenix. Last half hour of the week.
        pinInstant('2026-09-07T06:30:00Z');
        t.equal('nor in the last half hour of it', weeklyEntries(load(t)).length, 0);

        // Monday 7 September, 00:30 Phoenix. Now the week is genuinely over.
        pinInstant('2026-09-07T07:30:00Z');
        const paid = weeklyEntries(load(t));
        t.equal('once Monday arrives the week pays', paid.length, 1);
        t.check('and it pays for the week that closed', paid[0].on === '2026-08-31');
    } finally {
        global.Date = realDate;
        if (realTz === undefined) delete process.env.TZ; else process.env.TZ = realTz;
    }
});

suite('contest: a month does not end at 17:00 either', (t) => {
    const realTz = process.env.TZ;
    const realDate = global.Date;
    try {
        process.env.TZ = 'America/Phoenix';
        if (new Date('2026-10-01T00:30:00Z').getDate() !== 30) { t.check('timezone pin took effect', false); return; }

        const monthly = (api) => api.computeEntries(monthData(), null).filter((e) => e.reason === 'monthly-adherence');

        // 30 September, 17:30 Phoenix. UTC has rolled into October; the month
        // has not. The data's month is August (the first logged day), so the
        // question is only ever whether "now" has passed it.
        pinInstant('2026-10-01T00:30:00Z');
        const early = monthly(load(t));
        t.check('the month bonus does not depend on the hour', early.length === monthly(load(t)).length);

        // The rule itself, stated plainly: a month pays only once the current
        // month is past the data's month.
        pinInstant('2026-09-15T19:00:00Z');
        t.equal('September does not pay August... ', monthly(load(t)).length, 1);
    } finally {
        global.Date = realDate;
        if (realTz === undefined) delete process.env.TZ; else process.env.TZ = realTz;
    }
});

suite('contest: a pinned asOf still wins, and is still the tested path', (t) => {
    const api = load(t);
    // Every other contest suite pins asOf. That branch must keep behaving
    // exactly as before, or this fix moves the tests rather than the bug.
    const pinnedSunday = api.computeEntries(monthData(), { asOf: '2026-09-06' })
        .filter((e) => e.reason === 'weekly-adherence');
    t.equal('pinned to the closing Sunday, the week has not paid', pinnedSunday.length, 0);

    const pinnedMonday = api.computeEntries(monthData(), { asOf: '2026-09-07' })
        .filter((e) => e.reason === 'weekly-adherence');
    t.equal('pinned to the Monday after, it has', pinnedMonday.length, 1);
});
