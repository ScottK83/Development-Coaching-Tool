'use strict';

/**
 * A year-to-date file has no calls column, and it must not be weighed as if
 * it did.
 *
 * The YTD export carries no calls-answered column, so the parser fills every
 * YTD row's totalCalls with its survey count: 28 "calls" for somebody who took
 * four thousand. Replayed against the real store on 2026-09-30, two places
 * that set that number beside a real weekly count were badly wrong:
 *
 *   The YTD blend layered a two-day upload onto the YTD file and let the two
 *   days carry the year. Handle time 393s in the file came out 510s.
 *
 *   The rest-of-year projection counted the banked year as 28 calls against
 *   a run rate of 120 a week, so every required average came out a hair under
 *   goal: 559s of handle time "needed 424s" for the rest of the year.
 *
 * Fixed honestly, that second one needs 65s, which is arithmetic rather than
 * a target, so the projection also stops presenting an ask better than the
 * associate's best period this year.
 */

const { suite } = require('./harness');

function row(name, over) {
    return Object.assign({
        name, totalCalls: 120, surveyTotal: 2, repSurveyTotal: 2, fcrSurveyTotal: 2,
        aht: 450, scheduleAdherence: 93, overallSentiment: 90, reliability: 0
    }, over || {});
}

function week(start, end, rows, type) {
    return {
        [`${start}|${end}`]: {
            metadata: { periodType: type || 'week', startDate: start, endDate: end },
            employees: rows
        }
    };
}

// Weeks of the year, each with the given call count and handle time.
function weeks(name, count, calls, aht) {
    const out = {};
    for (let i = 0; i < count; i++) {
        const s = new Date(Date.UTC(2026, 0, 5 + i * 7));
        const e = new Date(Date.UTC(2026, 0, 11 + i * 7));
        const iso = (d) => d.toISOString().slice(0, 10);
        Object.assign(out, week(iso(s), iso(e), [row(name, { totalCalls: calls, aht: aht })]));
    }
    return out;
}

function load(t, weekly, ytd) {
    t.installFakeBrowser();
    global.weeklyData = weekly;
    global.window.weeklyData = weekly;
    global.ytdData = ytd || {};
    global.window.ytdData = global.ytdData;
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    const parsing = t.loadModule('modules/data-parsing.module.js').dataParsing;
    const futures = t.loadModule('modules/futures.module.js').futures;
    return { parsing, futures };
}

suite('ytd calls: a filled-in call count is recognised as one', (t) => {
    const { parsing } = load(t, {});
    t.equal('calls equal to surveys is the fill', parsing.hasRealCallCount({ totalCalls: 28, surveyTotal: 28 }), false);
    t.equal('more calls than surveys is real', parsing.hasRealCallCount({ totalCalls: 4200, surveyTotal: 28 }), true);
    t.equal('calls with no surveys is real', parsing.hasRealCallCount({ totalCalls: 300, surveyTotal: 0 }), true);
    t.equal('no calls is not a count', parsing.hasRealCallCount({ totalCalls: 0, surveyTotal: 0 }), false);
    t.equal('a blank is not a count', parsing.hasRealCallCount({ totalCalls: '', surveyTotal: 5 }), false);
    t.equal('fewer calls than surveys is a broken row', parsing.hasRealCallCount({ totalCalls: 3, surveyTotal: 9 }), false);
});

suite('ytd calls: the projection banks the run rate, not the survey count', (t) => {
    const { futures } = load(t, {});
    const weekInfo = { weeksCompleted: 38, weeksRemaining: 14 };
    const rate = { callsPerWeek: 120, surveysPerWeek: 0.8 };

    const filled = futures.projectedVolume({ totalCalls: 28, surveyTotal: 28 }, rate, 'aht', weekInfo);
    t.equal('the banked calls are the run rate over the weeks covered', filled.done, 120 * 38);
    t.equal('against the same rate for the weeks left', filled.remaining, 120 * 14);

    const ask = futures.calculateRequiredAverage(559, 38, 14, 426, filled);
    t.check('the ask is the honest one, far below goal', ask > 60 && ask < 70);

    const real = futures.projectedVolume({ totalCalls: 5000, surveyTotal: 28 }, rate, 'aht', weekInfo);
    t.equal('a real call count is used as it stands', real.done, 5000);

    const survey = futures.projectedVolume({ totalCalls: 28, surveyTotal: 28 }, rate, 'overallExperience', weekInfo);
    t.equal('survey metrics still bank the survey count', survey.done, 28);

    t.equal('no run rate and no calls leaves nothing to weigh by',
        futures.projectedVolume({ totalCalls: 28, surveyTotal: 28 }, null, 'aht', weekInfo), null);
});

suite('ytd calls: an ask better than their best period is not a target', (t) => {
    const weekly = weeks('Alex Slow', 6, 120, 540);
    weekly['2026-02-09|2026-02-15'].employees[0].aht = 470;
    // A light week with a freak figure does not count as what they can do.
    Object.assign(weekly, week('2026-03-02', '2026-03-08', [row('Alex Slow', { totalCalls: 6, aht: 250 })]));
    const { futures } = load(t, weekly);
    const keys = Object.keys(weekly);

    t.equal('the best period is their best real week', futures.bestPeriodValue('Alex Slow', 'aht', keys), 470);
    t.equal('65s is out of reach', futures.isWithinReach('Alex Slow', 'aht', 65, keys), false);
    t.equal('480s is within it', futures.isWithinReach('Alex Slow', 'aht', 480, keys), true);
    t.equal('matching their best is within it', futures.isWithinReach('Alex Slow', 'aht', 470, keys), true);
    t.equal('a percentage over 100 is still out', futures.isWithinReach('Alex Slow', 'scheduleAdherence', 101, keys), false);
    t.equal('with nothing on file only the arithmetic is judged', futures.isWithinReach('Nobody', 'aht', 65, keys), true);
});

suite('ytd calls: two days after the YTD file do not outweigh the year', (t) => {
    t.pinClock('2026-09-30');
    // Thirty-seven weeks at 120 calls, then a two-day upload after the file.
    const weekly = Object.assign(weeks('Robin Anchor', 37, 120, 390),
        week('2026-09-28', '2026-09-29', [row('Robin Anchor', { totalCalls: 50, aht: 700 })], 'week-in-progress'));
    const ytd = {
        '2026-01-01|2026-09-22': {
            metadata: { periodType: 'ytd', startDate: '2026-01-01', endDate: '2026-09-22' },
            employees: [row('Robin Anchor', { totalCalls: 28, surveyTotal: 28, aht: 393 })]
        }
    };
    load(t, weekly, ytd);
    t.loadModule('modules/metric-trends.module.js');
    const build = global.window.buildYtdAggregateForYear;

    const agg = build(2026, '2026-09-29');
    const robin = agg.entry.employees.find((e) => e.name === 'Robin Anchor');
    t.check('the blend stays with the year', Math.abs(robin.aht - 393) < 5);
    t.check('and was not dragged toward the two days', robin.aht < 400);
    t.check('the calls behind it are the year\'s, not the survey count', robin.totalCalls > 4000);

    // A YTD file that does carry calls is weighed by them, unchanged.
    ytd['2026-01-01|2026-09-22'].employees[0].totalCalls = 4500;
    const real = build(2026, '2026-09-29').entry.employees.find((e) => e.name === 'Robin Anchor');
    t.equal('a real count is its own weight', real.totalCalls, 4550);
});
