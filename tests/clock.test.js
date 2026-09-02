'use strict';

/**
 * The suite runs on a fixed clock.
 *
 * Every fixture here is written in 2026 and the modules ask the real calendar
 * what year and month it is, so for most of this suite's life its result
 * depended on the day you ran it. It changed underneath us twice: eight
 * period-compare assertions started failing on 2026-09-01 when August stopped
 * being the current month, and 143 assertions across ~40 suites fail from
 * 2027-01-01 because the helpers default to the current year.
 *
 * The first one went unnoticed for a day and quietly disabled the pre-push
 * gate. That is the damage a calendar-dependent suite does: it stops being a
 * signal and becomes something people bypass.
 *
 * So the clock is pinned in harness.js, and pinned here so it stays that way.
 */

const { suite } = require('./harness');

suite('clock: the suite does not depend on the day it runs', (t) => {
    const now = new Date();

    // If this fails, harness.js stopped pinning the clock and every date-bound
    // assertion in the suite is once again a time bomb.
    t.equal('the year is fixed, not the wall clock', now.getFullYear(), 2026);
    t.equal('and so is the month', now.getMonth(), 7); // August, zero-based

    // The month-to-date feature only lets a row take over the CURRENT month,
    // so August is not an arbitrary choice — it is what those fixtures need.
    t.equal('August, which is what the month-to-date fixtures are written for',
        now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0'), '2026-08');

    // Date.now() and new Date() must agree, or code that mixes them sees time
    // jump between two lines.
    t.check('Date.now() agrees with new Date()',
        Math.abs(Date.now() - now.getTime()) < 1000);
});

suite('clock: every other Date form still works normally', (t) => {
    // Only the argument-less constructor is redirected. The fixtures are built
    // from explicit date strings and the modules parse them, so these have to
    // behave exactly as they always did.
    t.equal('a parsed date string keeps its own value',
        new Date('2026-03-14T00:00:00Z').getUTCFullYear(), 2026);
    t.equal('...and its own month', new Date('2026-03-14T00:00:00Z').getUTCMonth(), 2);
    t.equal('a millisecond epoch keeps its own value',
        new Date(0).getUTCFullYear(), 1970);
    t.equal('date arithmetic still works',
        new Date('2026-12-31T00:00:00Z').getTime() - new Date('2026-12-30T00:00:00Z').getTime(),
        86400000);

    // The pinned clock is a real Date, not a stub with holes in it.
    t.check('the pinned value is a genuine Date', new Date() instanceof Date);
    t.check('and reports a sane ISO string', /^2026-08-18T/.test(new Date().toISOString()));
});
