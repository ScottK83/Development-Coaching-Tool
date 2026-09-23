'use strict';

/**
 * Dates are Phoenix dates.
 *
 * new Date('YYYY-MM-DD') is UTC midnight, the previous evening in Phoenix, and
 * toISOString() of "now" is already tomorrow after 5 pm there. Each of these
 * put something on the wrong day: the Daily Check-in header named Sunday for
 * Monday's data, a contest entry typed in the evening landed on tomorrow, a
 * Verint date cell written as ISO text came in a day early, and a YTD ending
 * Jan 1 started on the previous year's Jan 1.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

suite('local dates: an ISO date cell stays on its own day', (t) => {
    const realTz = process.env.TZ;
    try {
        process.env.TZ = 'America/Phoenix';
        const probe = new Date('2026-09-07T00:30:00Z');
        const tzTook = probe.getDate() === 6;
        t.check('the pinned timezone actually took effect', tzTook);
        if (!tzTook) return;

        const src = read('modules/reliability.module.js');
        const start = src.indexOf('function parseSpreadsheetDate(');
        let depth = 0, end = -1;
        for (let i = src.indexOf('{', start); i < src.length; i += 1) {
            if (src[i] === '{') depth += 1;
            else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i + 1; break; } }
        }
        const parse = new Function(src.slice(start, end) + '\nreturn parseSpreadsheetDate;')();
        const d = parse('2026-09-14');
        t.equal('Sep 14 is Sep 14', d.getDate(), 14);
        t.equal('in September', d.getMonth(), 8);
    } finally {
        process.env.TZ = realTz;
    }
});

suite('local dates: no default is taken from the UTC clock', (t) => {
    const contest = read('modules/contest-ui.module.js');
    t.check('the contest day is not a UTC date', contest.indexOf('new Date().toISOString().slice(0, 10)') === -1);
    t.check('the check-in header is not parsed as UTC', read('modules/morning-pulse.module.js').indexOf('new Date(yesterdayIso)') === -1);
    const script = read('script.js');
    t.check('a YTD year comes from the text', script.indexOf('new Date(weekEndingDate).getFullYear()') === -1);
    t.check('the call listening date is not a UTC date', script.indexOf("dateInput.value = new Date().toISOString()") === -1);
});
