'use strict';

/**
 * Two rules that both come down to reading a date correctly.
 *
 * OVERLAPPING PERIODS ARE NOT ADDITIVE. Adding is right for a run of weeks:
 * they are disjoint, and the hours missed in each really do stack. It is wrong
 * the moment two periods cover the same days, because the wider one already
 * counts what the narrower one counts. getTrendComparisonBuckets' 'ytd' branch
 * buckets year-to-date keys BY YEAR and hands the whole bucket in, so a year
 * holding both a March and a June year-to-date file reported reliability 8
 * where the truth was 4 -- a 100% inflation on a metric measured against a hard
 * 18-hour ceiling and scored at year end.
 *
 * THE JAN-1 RULE HAS TO FIRE. detectUploadPeriodTypeByRange read a bare
 * YYYY-MM-DD with new Date(), which is UTC midnight, then asked it for the
 * local month and day. West of Greenwich that is the previous day, so in
 * Phoenix new Date('2026-01-01') is 31 December 2025 and the "starts on Jan 1,
 * so it is a year to date" branch was unreachable in the timezone the app is
 * used in. The fall-through is not a near miss: a genuine 171-day range fails
 * month, fails quarter, fails the 180-day floor, and lands on `week`.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function bodyOf(src, fnName) {
    const at = src.indexOf('function ' + fnName + '(');
    if (at === -1) return null;
    const end = src.indexOf('\n}\n', at);
    return end === -1 ? src.slice(at) : src.slice(at, end);
}

suite('overlapping periods: the aggregate drops a window another one contains', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const body = bodyOf(src, 'buildEmployeeAggregateForPeriod');
    t.check('the aggregator is still there', !!body);
    if (!body) return;

    t.check('it works out each period range', /const ranges = periodKeys\.map\(rangeOf\)/.test(body));
    t.check('and drops the ones inside another', /usableKeys = ranges\.filter\(r => !isInsideAnother\(r\)\)/.test(body));
    t.check('then aggregates over what is left', /usableKeys\.forEach\(weekKey =>/.test(body));
    t.check('and reports what it actually used', /periodKeys: \[\.\.\.usableKeys\]/.test(body));
});

suite('overlapping periods: the containment rule itself', (t) => {
    // The rule, applied here rather than reached for, because the aggregator
    // lives in script.js and the suite does not load it as a program.
    const inside = (r, others) => others.some((o) =>
        o.key !== r.key && o.start <= r.start && o.end >= r.end
        && !(o.start === r.start && o.end === r.end && others.indexOf(o) > others.indexOf(r)));

    const weeks = [
        { key: 'w1', start: '2026-01-05', end: '2026-01-11' },
        { key: 'w2', start: '2026-01-12', end: '2026-01-18' },
        { key: 'w3', start: '2026-01-19', end: '2026-01-25' }
    ];
    t.check('disjoint weeks contain nothing', weeks.every((w) => !inside(w, weeks)));

    const withMonth = weeks.concat([{ key: 'm', start: '2026-01-01', end: '2026-01-31' }]);
    t.check('every week is inside the month', weeks.every((w) => inside(w, withMonth)));
    t.check('and the month is inside nothing',
        !inside(withMonth[withMonth.length - 1], withMonth));

    const twoYtd = [
        { key: 'mar', start: '2026-01-01', end: '2026-03-31' },
        { key: 'jun', start: '2026-01-01', end: '2026-06-21' }
    ];
    t.check('the earlier year-to-date file is inside the later one', inside(twoYtd[0], twoYtd));
    t.check('and the later one survives', !inside(twoYtd[1], twoYtd));

    // Two identical windows: keep one, drop the other, never both.
    const twins = [
        { key: 'a', start: '2026-01-01', end: '2026-01-31' },
        { key: 'b', start: '2026-01-01', end: '2026-01-31' }
    ];
    const survivors = twins.filter((r) => !inside(r, twins));
    t.equal('an exact duplicate leaves exactly one standing', survivors.length, 1);
});

suite('upload detection: a Jan 1 start is read as Jan 1', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const body = bodyOf(src, 'detectUploadPeriodTypeByRange');
    t.check('the detector is still there', !!body);
    if (!body) return;

    t.check('it anchors bare dates at local noon', /T12:00:00/.test(body));
    t.check('rather than parsing them straight', !/const start = new Date\(startDate\)/.test(body));

    // The reason, demonstrated: a bare ISO date read back locally is the day
    // before, west of Greenwich.
    const realTz = process.env.TZ;
    try {
        process.env.TZ = 'America/Phoenix';
        const bare = new Date('2026-01-01');
        if (bare.getDate() === 31) {
            t.check('a bare ISO date really does read back as the previous day', true);
            t.equal('which is why the month check failed', bare.getMonth(), 11);
            const noon = new Date('2026-01-01T12:00:00');
            t.equal('while the noon anchor reads January', noon.getMonth(), 0);
            t.equal('on the first', noon.getDate(), 1);
        } else {
            t.check('timezone pin took effect', false);
        }
    } finally {
        if (realTz === undefined) delete process.env.TZ; else process.env.TZ = realTz;
    }
});
