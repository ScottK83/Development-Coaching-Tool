'use strict';

/**
 * The suite runs on a fixed clock.
 *
 * Every fixture here is written in 2026 and the modules ask the real calendar
 * what year and month it is, so for most of this suite's life its result
 * depended on the day you ran it. It changed underneath us twice: eight
 * period-compare assertions started failing on 2026-09-01 when August stopped
 * being the current month, and 143 assertions across ~40 suites failed from
 * 2027-01-01 because the helpers defaulted to the current year.
 *
 * The first went unnoticed for a day and quietly disabled the pre-push gate.
 * That is the damage a calendar-dependent suite does: it stops being a signal
 * and becomes something people bypass.
 *
 * So harness.js pins the clock, TEST_CLOCK overrides it, and suites with
 * date-bound fixtures declare their own day with t.pinClock. What is checked
 * here is the machinery, not one particular date — these assertions have to
 * hold under TEST_CLOCK too, or the probe reports on itself instead of on the
 * application.
 */

const { suite } = require('./harness');

const OVERRIDDEN = !!process.env.TEST_CLOCK;
const DEFAULT_CLOCK = '2026-08-18';

suite('clock: the suite does not depend on the day it runs', (t) => {
    // Without an override the default pin must be in force. With one, the
    // override is the thing under test instead.
    if (!OVERRIDDEN) {
        const now = new Date();
        t.equal('the year is fixed, not the wall clock', now.getFullYear(), 2026);
        t.equal('and so is the month', now.getMonth(), 7); // August, zero-based
        t.check('on the day the month-to-date fixtures are written for',
            now.toISOString().startsWith(DEFAULT_CLOCK));
    } else {
        const expected = process.env.TEST_CLOCK;
        t.check(`TEST_CLOCK=${expected} is honoured`,
            expected === 'real' || new Date().toISOString().startsWith(expected));
    }

    // True either way: code that mixes the two must not see time jump between
    // two lines.
    t.check('Date.now() agrees with new Date()',
        Math.abs(Date.now() - new Date().getTime()) < 1000);
});

suite('clock: a suite can declare its own day', (t) => {
    // What the date-bound fixtures use. It has to work regardless of TEST_CLOCK,
    // which is the whole point: those suites test the app, not the calendar.
    t.pinClock('2026-08-18');
    t.equal('pinClock sets the year', new Date().getFullYear(), 2026);
    t.equal('and the month', new Date().getMonth(), 7);

    t.pinClock('2027-01-01');
    t.equal('and it can be moved again', new Date().getFullYear(), 2027);
    t.equal('to a different month', new Date().getMonth(), 0);

    let rejected = false;
    try { t.pinClock('not-a-date'); } catch (e) { rejected = true; }
    t.check('a bad date is refused rather than silently ignored', rejected);
});

suite('clock: a pinned suite does not leak into the next one', (t) => {
    // The suite above ended on 2027-01-01. If that escaped, every suite after
    // it would silently run on the wrong year — which is the original bug in a
    // new shape.
    if (!OVERRIDDEN) {
        t.equal('the clock is back to the default', new Date().getFullYear(), 2026);
        t.equal('month too', new Date().getMonth(), 7);
    } else {
        t.check('the clock is back to whatever TEST_CLOCK asked for',
            process.env.TEST_CLOCK === 'real'
            || new Date().toISOString().startsWith(process.env.TEST_CLOCK));
    }
});

suite('clock: every other Date form still works normally', (t) => {
    // Only the argument-less constructor is redirected. The fixtures are built
    // from explicit date strings and the modules parse them, so these have to
    // behave exactly as they always did.
    t.equal('a parsed date string keeps its own value',
        new Date('2026-03-14T00:00:00Z').getUTCFullYear(), 2026);
    t.equal('...and its own month', new Date('2026-03-14T00:00:00Z').getUTCMonth(), 2);
    t.equal('a millisecond epoch keeps its own value', new Date(0).getUTCFullYear(), 1970);
    t.equal('date arithmetic still works',
        new Date('2026-12-31T00:00:00Z').getTime() - new Date('2026-12-30T00:00:00Z').getTime(),
        86400000);
    t.check('the pinned value is a genuine Date', new Date() instanceof Date);
});
