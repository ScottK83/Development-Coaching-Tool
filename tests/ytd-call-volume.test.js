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

/* ── Every floor and column that read a YTD file's calls ──
 *
 * Seventeen of 126 associates have fewer than 20 surveys for the year. On any
 * year-to-date view the call floors read that as fewer than 20 calls: no
 * shout-out, no highlight, no pace line, and a near-miss note saying they
 * "only took 12 calls". */

const fs = require('fs');
const path = require('path');
const { ROOT } = require('./harness');

const YTD_KEY = '2026-01-01|2026-09-22';

function ytdFile(rows) {
    return { [YTD_KEY]: { metadata: { periodType: 'ytd', startDate: '2026-01-01', endDate: '2026-09-22' }, employees: rows } };
}

suite('ytd calls: a YTD file\'s rows come back with calls that mean calls', (t) => {
    const weekly = weeks('Pat Few', 10, 130, 420);
    const { futures } = load(t, weekly, ytdFile([
        row('Pat Few', { totalCalls: 12, surveyTotal: 12 }),
        row('Real Count', { totalCalls: 4800, surveyTotal: 30 }),
        row('No Uploads', { totalCalls: 9, surveyTotal: 9 })
    ]));
    const period = global.ytdData[YTD_KEY];
    const rows = futures.withYtdCalls(period);
    const byName = Object.fromEntries(rows.map((r) => [r.name, r]));

    t.equal('a filled count becomes the run rate over the weeks covered', byName['Pat Few'].totalCalls, 130 * 38);
    t.equal('and says it is an estimate', byName['Pat Few'].callsEstimated, true);
    t.equal('a real count is left as it is', byName['Real Count'].totalCalls, 4800);
    t.check('and not marked', !byName['Real Count'].callsEstimated);
    t.equal('nothing to estimate from is unknown, not zero', byName['No Uploads'].totalCalls, '');
    t.equal('the stored row is untouched', period.employees[0].totalCalls, 12);

    const weekPeriod = global.weeklyData['2026-01-05|2026-01-11'];
    t.check('a week comes back as it is', futures.withYtdCalls(weekPeriod) === weekPeriod.employees);
});

suite('ytd calls: a YTD ranking does not read surveys as calls', (t) => {
    t.pinClock('2026-10-05');
    const names = Array.from({ length: 32 }, (_, i) => 'Agent ' + (i + 1));
    const weekly = {};
    names.forEach((n) => Object.assign(weekly, weeks(n, 10, 125, 420)));
    // Merge the per-name weeks into shared weekly periods.
    const merged = {};
    Object.keys(weekly).forEach((k) => {
        merged[k] = merged[k] || { metadata: weekly[k].metadata, employees: [] };
    });
    names.forEach((n) => {
        const own = weeks(n, 10, 125, 420);
        Object.keys(own).forEach((k) => merged[k].employees.push(own[k].employees[0]));
    });
    const ytd = ytdFile(names.map((n, i) => row(n, { totalCalls: 12 + i, surveyTotal: 12 + i, aht: 400 + i })));

    load(t, merged, ytd);
    t.loadModule('modules/on-off-tracker.module.js');
    const M = global.window.DevCoachModules;
    t.loadModule('modules/center-ranking.module.js');
    t.loadModule('modules/period-compare.module.js');
    const cel = t.loadModule('modules/celebrations.module.js').celebrations;
    global.window.getMetricRatingScore = M.metricProfiles.getRatingScore;
    global.window.getTeamMembersForWeek = () => [];

    const res = M.centerRanking.buildRankingsForPeriod(YTD_KEY);
    const agent = res.rankings.find((r) => r.name === 'Agent 1');
    t.equal('the row carries the year\'s calls', agent.totalCalls, 125 * 38);
    t.equal('marked as an estimate', agent.callsEstimated, true);
    t.equal('so the celebration floor lets them through', cel.volumeVerdict(agent).ok, true);
    t.check('nobody on the board reads as thin',
        res.rankings.every((r) => cel.volumeVerdict(r).ok));
});

suite('ytd calls: a period with no calls column is unknown, not absent', (t) => {
    t.pinClock('2026-10-05');
    const names = Array.from({ length: 3 }, (_, i) => 'Agent ' + (i + 1));
    const weekly = week('2026-09-21', '2026-09-27', names.map((n) => row(n, { totalCalls: '' })));
    load(t, weekly);
    t.loadModule('modules/on-off-tracker.module.js');
    const M = global.window.DevCoachModules;
    t.loadModule('modules/center-ranking.module.js');
    const cel = t.loadModule('modules/celebrations.module.js').celebrations;
    global.window.getMetricRatingScore = M.metricProfiles.getRatingScore;
    global.window.getTeamMembersForWeek = () => [];

    const res = M.centerRanking.buildRankingsForPeriod('2026-09-21|2026-09-27');
    t.equal('a blank count stays blank', res.rankings[0].totalCalls, null);
    t.equal('so nobody is marked absent', cel.volumeVerdict(res.rankings[0]).ok, true);
});

suite('ytd calls: the snapshot weighs by the estimate and does not show it', (t) => {
    const weekly = weeks('Pat Few', 10, 130, 420);
    load(t, weekly, ytdFile([row('Pat Few', { totalCalls: 12, surveyTotal: 12 })]));
    global.window.DevCoachModules.storage = {
        loadWeeklyData: () => global.weeklyData,
        loadYtdData: () => global.ytdData,
        loadDailyData: () => ({})
    };
    const snap = t.loadModule('modules/team-snapshot.module.js').teamSnapshot;
    const rows = snap.getEmployeesForPeriod(YTD_KEY, 'ytd');
    t.equal('the snapshot gets the year\'s calls', rows[0].totalCalls, 130 * 38);
    t.equal('marked as an estimate', rows[0].callsEstimated, true);

    const src = fs.readFileSync(path.join(ROOT, 'modules/team-snapshot.module.js'), 'utf8');
    t.check('the Calls cell is left empty for an estimate',
        /metricKey === 'totalCalls' && emp\.callsEstimated\) hasValue = false/.test(src));
});

suite('ytd calls: no screen prints the survey count as calls', (t) => {
    const matchup = fs.readFileSync(path.join(ROOT, 'modules/matchup.module.js'), 'utf8');
    t.check('the matchup Calls column leaves an estimate out',
        /\(r\.callsEstimated \|\| r\.totalCalls == null\) \? '-' : String\(r\.totalCalls\)/.test(matchup));
    t.check('and no longer prints a blank as 0', !/String\(r\.totalCalls \|\| 0\)/.test(matchup));

    const yoy = fs.readFileSync(path.join(ROOT, 'modules/yoy-comparison.module.js'), 'utf8');
    t.check('year over year checks the count is real before comparing it',
        /metricKey === 'totalCalls'[\s\S]{0,200}hasRealCallCount/.test(yoy));
    t.check('every year over year read goes through that check',
        !/_num\((prior|cur)\[/.test(yoy));

    const pulse = fs.readFileSync(path.join(ROOT, 'modules/morning-pulse.module.js'), 'utf8');
    t.check('the pace line reads the YTD row with its calls corrected',
        /return withRealCalls\(ytd\[key\]\)\.find/.test(pulse));
    t.check('and so does the baseline floor', /const baseEmp = withRealCalls\(basePeriod\)\.find/.test(pulse));

    const hub = fs.readFileSync(path.join(ROOT, 'modules/team-hub.module.js'), 'utf8');
    t.check('highlights read the period through withYtdCalls', /withCalls\(resolved\.period\)/.test(hub));

    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    t.check('a YTD upload\'s centre averages weigh by calls',
        /periodType === 'ytd' && typeof withYtdCalls === 'function'[\s\S]{0,200}calculateCenterAveragesFromEmployees\(avgRows\)/.test(script));
});
