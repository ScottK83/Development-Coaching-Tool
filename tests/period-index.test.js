'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/period-index.module.js').periodIndex;
}

// A realistic spread: two finished weeks, this week in progress, two days of
// it uploaded separately, a month, a quarter, and two YTD files.
function stores() {
    return {
        weeklyData: {
            '2026-07-20|2026-07-26': { metadata: { periodType: 'week', endDate: '2026-07-26' }, employees: [{ name: 'A' }] },
            '2026-07-27|2026-08-02': { metadata: { periodType: 'week', endDate: '2026-08-02' }, employees: [{ name: 'A' }] },
            '2026-08-03|2026-08-04': { metadata: { periodType: 'week-in-progress', endDate: '2026-08-04' }, employees: [{ name: 'A' }] },
            '2026-07-01|2026-07-31': { metadata: { periodType: 'month', endDate: '2026-07-31' }, employees: [{ name: 'A' }] },
            '2026-06-01|2026-06-30': { metadata: { periodType: 'month', endDate: '2026-06-30' }, employees: [{ name: 'A' }] },
            '2026-04-01|2026-06-30': { metadata: { periodType: 'quarter', endDate: '2026-06-30' }, employees: [{ name: 'A' }] }
        },
        dailyData: {
            '2026-08-03|2026-08-03': { metadata: { periodType: 'daily', endDate: '2026-08-03' }, employees: [{ name: 'A' }] },
            '2026-08-04|2026-08-04': { metadata: { periodType: 'daily', endDate: '2026-08-04' }, employees: [{ name: 'A' }] }
        },
        ytdData: {
            '2026-01-01|2026-05-31': { metadata: { periodType: 'ytd', endDate: '2026-05-31' }, employees: [{ name: 'A' }] },
            '2026-01-01|2026-08-02': { metadata: { periodType: 'ytd', endDate: '2026-08-02' }, employees: [{ name: 'A' }] }
        }
    };
}

const WEDNESDAY = '2026-08-05';

suite('period index: every upload normalises to the same shape', (t) => {
    const pi = load(t);
    const index = pi.buildIndex(stores());

    t.equal("everything is indexed", index.all.length, 10);
    t.check('and it reads oldest first', index.all[0].end <= index.all[index.all.length - 1].end);
    t.check('each entry knows which store it came from', index.all.every(e => e.store));

    const entry = pi.parsePeriod('2026-07-27|2026-08-02', { metadata: { periodType: 'week', endDate: '2026-08-02' }, employees: [1, 2] }, 'weekly');
    t.equal('the range comes off the key', entry.start, '2026-07-27');
    t.equal('and the end off the metadata', entry.end, '2026-08-02');
    t.equal('with a headcount', entry.employeeCount, 2);

    // Metadata beats the key, because a key can be reused.
    const conflicting = pi.parsePeriod('2026-01-01|2026-01-07', { metadata: { endDate: '2026-02-02' } }, 'weekly');
    t.equal('metadata wins over the key', conflicting.end, '2026-02-02');

    // Uploads predating the type field were all weeks.
    t.equal('an untyped upload is a week', pi.parsePeriod('2026-01-01|2026-01-07', {}, 'weekly').type, 'week');

    // A period that cannot be placed in time answers no question.
    t.check('an unusable key is dropped', pi.parsePeriod('', {}, 'weekly') === null);
    t.equal('and does not pollute the index', pi.buildIndex({ weeklyData: { '': {} } }).all.length, 0);
});

suite('period index: week-shaped and week-finished are different questions', (t) => {
    const pi = load(t);

    // This is the disagreement that caused the trouble: two spellings of "is
    // this a week", one counting an in-progress upload and one not. They were
    // not one rule written twice — they were two rules that both needed names.
    t.check('an in-progress upload is week-shaped', pi.isWeekLike('week-in-progress'));
    t.check('but it is not a finished week', !pi.isCompleteWeek('week-in-progress'));
    t.check('a custom range is week-shaped', pi.isWeekLike('custom'));
    t.check('and also not finished', !pi.isCompleteWeek('custom'));
    t.check('a week is both', pi.isWeekLike('week') && pi.isCompleteWeek('week'));
    t.check('a month is neither', !pi.isWeekLike('month') && !pi.isCompleteWeek('month'));
    t.check('an untyped upload counts as a week either way', pi.isWeekLike() && pi.isCompleteWeek());
});

suite('period index: this week so far prefers the upload over the days', (t) => {
    const pi = load(t);

    const withBoth = pi.thisWeekSoFar(pi.buildIndex(stores()), WEDNESDAY);
    t.equal('a week-in-progress file answers it', withBoth.source, 'week-in-progress');
    t.equal('and it is the current one', withBoth.primary.end, '2026-08-04');

    // Dailies are the fallback, not the requirement. Asking for day files on
    // top of a week-in-progress upload is asking for the same numbers twice —
    // which is exactly what used to declare the period missing.
    const daysOnly = stores();
    delete daysOnly.weeklyData['2026-08-03|2026-08-04'];
    const fallback = pi.thisWeekSoFar(pi.buildIndex(daysOnly), WEDNESDAY);
    t.equal('with no upload the days answer it', fallback.source, 'daily');
    t.equal('and both days are offered', fallback.entries.length, 2);

    const nothing = pi.thisWeekSoFar(pi.buildIndex({ weeklyData: {
        '2026-07-27|2026-08-02': { metadata: { periodType: 'week', endDate: '2026-08-02' } }
    } }), WEDNESDAY);
    t.check('last week alone does not cover this week', nothing === null);
});

suite('period index: last completed week never means this one', (t) => {
    const pi = load(t);
    const index = pi.buildIndex(stores());

    const last = pi.lastCompletedWeek(index, WEDNESDAY);
    t.equal('it is the week that ended', last.end, '2026-08-02');
    t.check('not the two days of this week that happen to be uploaded', last.type === 'week');

    t.equal('and the one before it is findable', pi.weekBefore(index, last).end, '2026-07-26');
    t.check('the oldest week has nothing before it', pi.weekBefore(index, pi.weekBefore(index, last)) === null);

    // "Here is your last week" has to be true. A three week old file standing
    // in for last week is the bug this guards.
    t.check('last week is fresh', pi.isFreshFor(last, WEDNESDAY));
    t.check('a stale file is not', !pi.isFreshFor({ end: '2026-07-12' }, WEDNESDAY));
    t.check('and nothing at all is not fresh either', !pi.isFreshFor(null, WEDNESDAY));
});

suite('period index: the longer horizons answer plainly', (t) => {
    const pi = load(t);
    const index = pi.buildIndex(stores());

    t.equal('the year is the newest YTD file', pi.yearToDate(index).end, '2026-08-02');
    t.equal('with an earlier one to measure against', pi.previousYearToDate(index).end, '2026-05-31');

    t.equal('the latest month is July', pi.latestOfType(index, 'month').end, '2026-07-31');
    t.equal('and the one before it is June', pi.previousOfType(index, 'month').end, '2026-06-30');
    t.equal('the quarter is there too', pi.latestOfType(index, 'quarter').end, '2026-06-30');

    // A month is a month upload or nothing. Averaging weeks into one is the
    // thing this makes impossible rather than merely discouraged.
    const noMonths = pi.buildIndex({ weeklyData: stores().weeklyData });
    t.check('a single month has no previous', pi.previousOfType(pi.buildIndex({
        weeklyData: { '2026-07-01|2026-07-31': { metadata: { periodType: 'month', endDate: '2026-07-31' } } }
    }), 'month') === null);
    t.check('and no months means no month', pi.latestOfType(pi.buildIndex({ dailyData: {} }), 'month') === null);
});

suite('period index: only this week counts as this week', (t) => {
    const pi = load(t);
    const index = pi.buildIndex(stores());

    const days = pi.dailiesThisWeek(index, WEDNESDAY);
    t.equal('both uploaded days are in', days.length, 2);
    t.check('and nothing from last week leaked in', days.every(d => d.end >= '2026-08-03'));

    // A day uploaded ahead of today is not part of "so far".
    const withFuture = stores();
    withFuture.dailyData['2026-08-09|2026-08-09'] = { metadata: { periodType: 'daily', endDate: '2026-08-09' } };
    t.equal('a future day is excluded', pi.dailiesThisWeek(pi.buildIndex(withFuture), WEDNESDAY).length, 2);

    t.equal('the week starts on Monday', pi.mondayOf('2026-08-05'), '2026-08-03');
    t.equal('and Sunday belongs to the week that just ended', pi.mondayOf('2026-08-09'), '2026-08-03');
});

suite('plumbing: one noise floor, not three', (t) => {
    t.installFakeBrowser();
    const modules = t.loadModule('modules/metrics-registry.module.js');
    const noise = global.window.getMetricNoiseThreshold;

    t.check('the registry answers it', typeof noise === 'function');
    t.equal('AHT needs a real move', noise('aht'), 15);
    t.equal('adherence needs a point', noise('scheduleAdherence'), 1);

    // An unlisted metric still gets a floor, or every flicker reads as movement.
    t.check('an unknown metric still has one', noise('somethingNew') > 0);

    // The three consumers used to carry their own table, and two of them
    // disagreed with the third about AHT by a factor of five.
    const offenders = [];
    ['morning-pulse', 'one-on-one', 'team-hub'].forEach(name => {
        const src = fs.readFileSync(path.join(ROOT, 'modules', `${name}.module.js`), 'utf8');
        if (/const NOISE = \{/.test(src)) offenders.push(name);
    });
    t.equal('no module keeps a private noise table', offenders.join(',') || 'none', 'none');

    // And each of them reaches the shared one.
    ['morning-pulse', 'one-on-one', 'team-hub'].forEach(name => {
        const src = fs.readFileSync(path.join(ROOT, 'modules', `${name}.module.js`), 'utf8');
        t.check(`${name} asks the registry`, src.indexOf('getMetricNoiseThreshold') > -1);
    });
});

suite('migration: the index agrees with the filters it replaced', (t) => {
    const pi = load(t);

    // The exact predicate the three migrated call sites used, kept here as the
    // thing being replaced so the swap is provable rather than asserted.
    const legacyWeekLike = (weekly) => Object.keys(weekly).filter(k => {
        const pt = weekly[k]?.metadata?.periodType;
        return !pt || pt === 'week' || pt === 'week-in-progress' || pt === 'custom';
    }).sort();

    const legacyCompleteWeek = (weekly) => legacyWeekLike(weekly).filter(k => {
        const pt = weekly[k]?.metadata?.periodType;
        return !pt || pt === 'week';
    });

    const weekly = stores().weeklyData;
    const index = pi.buildIndex({ weeklyData: weekly });

    t.equal('week-shaped keys match, in the same order',
        pi.weekLikeKeys(index).join(','), legacyWeekLike(weekly).join(','));
    t.equal('finished-week keys match too',
        pi.completeWeekKeys(index).join(','), legacyCompleteWeek(weekly).join(','));
    t.equal('and typed lookups match', pi.keysOfType(index, 'month').join(','),
        Object.keys(weekly).filter(k => weekly[k]?.metadata?.periodType === 'month').sort().join(','));

    // An upload with no type at all is the oldest data in the store, and both
    // the old rule and the new one count it as a week.
    const untyped = { '2026-01-05|2026-01-11': { metadata: {} } };
    t.equal('untyped uploads survive the swap',
        pi.weekLikeKeys(pi.buildIndex({ weeklyData: untyped })).join(','), legacyWeekLike(untyped).join(','));
});

suite('migration: where the ordering deliberately changed', (t) => {
    const pi = load(t);

    // The old filters sorted keys, which sorts by start date. With overlapping
    // ranges that disagrees with finishing order, and "latest period" has
    // always meant the one that finished last.
    const overlapping = {
        '2026-07-01|2026-08-10': { metadata: { periodType: 'custom', endDate: '2026-08-10' } },
        '2026-08-03|2026-08-09': { metadata: { periodType: 'week', endDate: '2026-08-09' } }
    };

    const legacy = Object.keys(overlapping).sort();
    const now = pi.weekLikeKeys(pi.buildIndex({ weeklyData: overlapping }));

    t.check('the two orders genuinely differ here', legacy.join(',') !== now.join(','));
    t.check('the old order ends on the range that started first',
        legacy[legacy.length - 1] === '2026-08-03|2026-08-09');
    t.check('the new order ends on the one that finished last',
        now[now.length - 1] === '2026-07-01|2026-08-10');

    // Which matters because every caller treats the last key as "most recent".
    t.equal('so "latest" is now the period that actually finished latest',
        pi.ofTypes(pi.buildIndex({ weeklyData: overlapping }), ['custom', 'week']).pop().end, '2026-08-10');
});
