'use strict';

const { suite } = require('./harness');

/**
 * WHAT THE CHOSEN WINDOW IS MEASURED AGAINST
 *
 * My Team had two controls that both claimed to own time. The "Covering" chips
 * decided which upload the shout-out was ranked over; the weekday tabs decided
 * which upload every private message was written from. The second never asked
 * the first anything. resolveCheckinPeriods took the newest two week-shaped
 * files and handed those to every generator, whatever the chips said.
 *
 * So picking "Month to date" re-ranked the celebrations over September, left
 * the header reading "Covers last week", and left the messages underneath
 * comparing two weeks. One screen, three stretches of time.
 *
 * These pin the rules Scott stated for the pairs, and the thing that makes them
 * worth having: a window with nothing to compare against says so rather than
 * quietly falling back to two weeks.
 */

// A Tuesday. This week starts Monday the 21st, so the 14th to the 20th is the
// last completed week and September is the month in progress.
const TODAY = '2026-09-22';

function team(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push({
            name: 'Person' + i,
            totalCalls: 100,
            surveyTotal: 10,
            repSurveyTotal: 10,
            fcrSurveyTotal: 10,
            aht: 320,
            negativeWord: 95,
            reliability: 0.5
        });
    }
    return out;
}

function week(start, end, count) {
    return [`${start}|${end}`, { metadata: { periodType: 'week', startDate: start, endDate: end }, employees: team(count) }];
}

function stores(overrides) {
    const weekly = Object.fromEntries([
        // August, four whole weeks, so the month can be rebuilt and is
        // comparable rather than partial.
        week('2026-07-27', '2026-08-02', 124),
        week('2026-08-03', '2026-08-09', 125),
        week('2026-08-10', '2026-08-16', 126),
        week('2026-08-17', '2026-08-23', 126),
        week('2026-08-24', '2026-08-30', 126),
        // September.
        week('2026-08-31', '2026-09-06', 126),
        week('2026-09-07', '2026-09-13', 126),
        // The last completed week, and the week before it.
        week('2026-09-14', '2026-09-20', 126)
    ]);

    // This week, two days in.
    weekly['2026-09-21|2026-09-22'] = {
        metadata: { periodType: 'week-in-progress', startDate: '2026-09-21', endDate: '2026-09-22' },
        employees: team(120)
    };
    // The month so far, straight from the source.
    weekly['2026-09-01|2026-09-17'] = {
        metadata: { periodType: 'month-to-date', startDate: '2026-09-01', endDate: '2026-09-17' },
        employees: team(126)
    };

    return Object.assign({
        weeklyData: weekly,
        ytdData: {
            '2026-01-01|2026-08-16': { metadata: { periodType: 'ytd', endDate: '2026-08-16' }, employees: team(127) },
            '2026-01-01|2026-09-20': { metadata: { periodType: 'ytd', endDate: '2026-09-20' }, employees: team(127) }
        },
        dailyData: {
            '2026-09-18|2026-09-18': { metadata: { periodType: 'daily', endDate: '2026-09-18' }, employees: team(118) },
            '2026-09-21|2026-09-21': { metadata: { periodType: 'daily', endDate: '2026-09-21' }, employees: team(119) }
        }
    }, overrides || {});
}

function load(t, overrides) {
    t.pinClock(TODAY);
    t.installFakeBrowser();
    const data = stores(overrides);

    // celebrations reads the bare globals; period-index reads through storage.
    // Both point at the same objects, the way script.js has them.
    global.weeklyData = data.weeklyData;
    global.ytdData = data.ytdData;
    global.dailyData = data.dailyData;

    global.window.DevCoachModules.storage = {
        loadWeeklyData: () => data.weeklyData,
        loadYtdData: () => data.ytdData,
        loadDailyData: () => data.dailyData
    };
    global.window.DevCoachModules.centerRanking = {
        buildCenterRankings: () => ({ rankings: [], totalEmployees: 0, teamMembers: new Set(), periodKey: '' }),
        buildRankingsForPeriod: () => null
    };

    t.loadModule('modules/period-index.module.js');
    t.loadModule('modules/period-compare.module.js');
    const celebrations = t.loadModule('modules/celebrations.module.js').celebrations;
    const compare = t.loadModule('modules/period-comparison.module.js').periodComparison;
    compare.resetCache();

    return {
        compare,
        // The window the way the page holds it: resolved by celebrations, so the
        // current side is the exact upload the shout-out is ranked over.
        forId: (id) => compare.resolve(celebrations.resolveShoutOutWindow(id, TODAY), TODAY)
    };
}

suite('period comparison: month to date is measured against the whole of last month', (t) => {
    const { forId } = load(t);
    const cmp = forId('mtd');

    t.equal('the near side is the month-to-date upload', cmp.latestKey, '2026-09-01|2026-09-17');
    t.equal('the far side is August, rebuilt from its weeks', cmp.baselineKey, 'month:2026-08');
    t.equal('and the prose is told it is a month', cmp.unit, 'month');

    // Not "this week against last week", which is what every message on the
    // page said no matter which chip was lit.
    t.equal('the near side names the month', cmp.latestLabel, 'September 2026 so far');
    t.equal('and so does the far side', cmp.baselineLabel, 'August 2026');
    t.equal('read as one line', cmp.headline, 'September 2026 so far against August 2026');
});

suite('period comparison: a week is measured against a week', (t) => {
    const { forId } = load(t);

    const thisWeek = forId('thisWeek');
    t.equal('this week so far is the week-in-progress file',
        thisWeek.latestKey, '2026-09-21|2026-09-22');
    t.equal('against the last week that finished',
        thisWeek.baselineKey, '2026-09-14|2026-09-20');
    t.equal('in weeks', thisWeek.unit, 'week');

    const lastWeek = forId('lastWeek');
    t.equal('last week is that finished week',
        lastWeek.latestKey, '2026-09-14|2026-09-20');
    t.equal('and steps past itself to the week before',
        lastWeek.baselineKey, '2026-09-07|2026-09-13');
    t.equal('named as the week before', lastWeek.baselineLabel, 'the week before');
});

suite('period comparison: a day is measured against the day before it', (t) => {
    const { forId } = load(t);
    const cmp = forId('day');

    t.equal('the newest day file is the near side', cmp.latestKey, '2026-09-21|2026-09-21');
    t.equal('the one before it is the far side', cmp.baselineKey, '2026-09-18|2026-09-18');
    t.equal('and the prose is told it is a day', cmp.unit, 'day');

    // The 21st is the day before the 22nd, so it really is yesterday. The label
    // says so rather than printing a date a person has to work out.
    t.equal('yesterday is called yesterday', cmp.latestLabel, 'yesterday');
    t.equal('and the day before it is dated', cmp.baselineLabel, 'Sep 18');
});

suite('period comparison: year to date is measured against the report before it', (t) => {
    const { forId } = load(t);
    const cmp = forId('ytd');

    t.equal('the newest year-to-date report is the near side', cmp.latestKey, '2026-01-01|2026-09-20');
    t.equal('the one before it is the far side', cmp.baselineKey, '2026-01-01|2026-08-16');
    t.equal('and the prose is told it is a year', cmp.unit, 'year');
});

/**
 * The half of this that matters most.
 *
 * Falling back to two weeks is exactly what the old code did, and it is worse
 * than having no comparison: the message reads as a month-over-month move and
 * is a week-over-week one. A missing baseline is a fact with a fix, so it comes
 * back with the reason attached.
 */
suite('period comparison: no other side says why, rather than substituting one', (t) => {
    // August stripped out. September is still the month to date; there is
    // simply nothing behind the month before it.
    const weekly = stores().weeklyData;
    Object.keys(weekly).forEach((k) => {
        if (String(weekly[k].metadata.endDate).slice(0, 7) === '2026-08') delete weekly[k];
    });
    const { forId } = load(t, { weeklyData: weekly });
    const cmp = forId('mtd');

    t.equal('the month to date still resolves', cmp.latestKey, '2026-09-01|2026-09-17');
    t.equal('but nothing is invented to compare it against', cmp.baselineKey, null);
    t.check('and the reason names the month that is missing',
        cmp.reason.indexOf('August 2026') > -1);
    t.equal('the line says so out loud', cmp.headline, 'September 2026 so far, on its own');

    // The unit is still the month. A message with no comparison in it must not
    // start calling September a week.
    t.equal('and it is still a month', cmp.unit, 'month');
});

suite('period comparison: a month too thin to stand cannot anchor one', (t) => {
    // One week of August is a gap in the uploads wearing a month's name.
    const weekly = stores().weeklyData;
    Object.keys(weekly).forEach((k) => {
        const end = String(weekly[k].metadata.endDate);
        if (end.slice(0, 7) === '2026-08' && end !== '2026-08-09') delete weekly[k];
    });
    const { forId } = load(t, { weeklyData: weekly });
    const cmp = forId('mtd');

    t.equal('no baseline is handed back', cmp.baselineKey, null);
    t.check('and it says the month is short of weeks rather than absent',
        cmp.reason.indexOf('too few weeks') > -1);
});

suite('period comparison: any period key can be read, not just a weekly one', (t) => {
    const { compare } = load(t);

    const month = compare.periodFor('month:2026-08');
    t.check('a rebuilt month comes back as a period', Boolean(month));
    t.check('with employees in it', (month.employees || []).length > 0);
    t.equal('shaped so every generator can read it', month.metadata.periodType, 'month-agg');
    t.equal('and carrying the month it covers', month.metadata.endDate, '2026-08-30');

    // These three came back null before, which is why naming any of them at a
    // message generator produced an empty message with no reason on it.
    t.check('a day file reads', Boolean(compare.periodFor('2026-09-21|2026-09-21')));
    t.check('a year-to-date report reads', Boolean(compare.periodFor('2026-01-01|2026-09-20')));
    t.check('a weekly upload still reads', Boolean(compare.periodFor('2026-09-14|2026-09-20')));
    t.check('and a key behind nothing is still null', compare.periodFor('nope|nope') === null);
});

suite('period comparison: the month rebuild is only built once per render', (t) => {
    const { compare } = load(t);

    const first = compare.periodFor('month:2026-08');
    const second = compare.periodFor('month:2026-08');
    t.check('the same object comes back', first === second);

    // Eighteen messages must not rebuild August eighteen times; an upload
    // between renders must not leave a stale one on screen either.
    compare.resetCache();
    t.check('until the cache is dropped', compare.periodFor('month:2026-08') !== first);
});

suite('period comparison: nothing uploaded is not a crash', (t) => {
    const { compare, forId } = load(t, { weeklyData: {}, ytdData: {}, dailyData: {} });

    const cmp = forId('mtd');
    t.equal('no near side', cmp.latestKey, null);
    t.equal('no far side either', cmp.baselineKey, null);
    t.check('and a reason rather than an exception', cmp.reason.length > 0);
    t.equal('the line is empty rather than half a sentence', cmp.headline, '');

    t.check('a null key reads as nothing', compare.periodFor(null) === null);
    t.check('and describing nothing is an empty string', compare.describe(null) === '');
});
