'use strict';

/**
 * A quarter is assembled from one kind of upload, not from all of them.
 *
 * weeklyData holds weeks, months and quarters side by side, keyed only by date
 * span. Scott uploads all three. So the obvious implementation, "aggregate
 * every period whose end date falls in April to June", counts April's calls in
 * the April month row, again in April's four weekly rows, and a third time in
 * the Q2 row. Calls, surveys and missed hours all accumulate, so nothing in the
 * review survives it: the handle time is weighted by a tripled denominator and
 * the missed hours are literally three times the real figure.
 *
 * These suites pin the choice. One granularity per quarter, chosen by how much
 * of the quarter it actually covers, with a real quarter upload winning a tie
 * because its edges line up with the calendar and a week's edges do not.
 */

const { suite } = require('./harness');

const PREFIX = 'devCoachingTool_';

function period(type, start, end, employees) {
    return {
        [`${start}|${end}`]: {
            metadata: { periodType: type, startDate: start, endDate: end },
            employees
        }
    };
}

function person(name, over) {
    return Object.assign({
        name,
        totalCalls: 100,
        surveyTotal: 10, repSurveyTotal: 10, fcrSurveyTotal: 10,
        scheduleAdherence: 94, cxRepOverall: 85, fcr: 78, overallExperience: 80,
        overallSentiment: 90, transfers: 4, transfersCount: 4,
        aht: 420, acw: 55, holdTime: 25, reliability: 0
    }, over || {});
}

function load(t, store) {
    const browser = t.installFakeBrowser();
    global.window.weeklyData = store;
    global.window.ytdData = {};
    global.weeklyData = store;
    global.ytdData = {};
    browser.store[PREFIX + 'weeklyData'] = JSON.stringify(store);

    global.window.DevCoachModules.storage = {
        readStore(key) {
            const raw = browser.store[PREFIX + key];
            return raw === undefined ? undefined : JSON.parse(raw);
        },
        loadWeeklyData() { return store; },
        loadYtdData() { return {}; },
        loadDailyData() { return {}; }
    };

    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.SURVEY_WEIGHT_FIELD = global.window.SURVEY_WEIGHT_FIELD;
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/period-compare.module.js');
    return t.loadModule('modules/quarter-trend.module.js').quarterTrend;
}

/* ── Quarter bounds ── */

suite('quarter trend: a quarter knows its own calendar', (t) => {
    const qt = load(t, {});

    const q1 = qt.quarterBounds(2026, 1);
    t.equal('Q1 starts on new year', q1.startDate, '2026-01-01');
    t.equal('and ends on the last day of March', q1.endDate, '2026-03-31');

    const q3 = qt.quarterBounds(2026, 3);
    t.equal('Q3 starts in July', q3.startDate, '2026-07-01');
    t.equal('and ends on the last day of September', q3.endDate, '2026-09-30');
    t.equal('and is labelled the way a supervisor says it', q3.label, 'Q3 2026');

    t.equal('a leap February still ends correctly',
        qt.quarterBounds(2024, 1).endDate, '2024-03-31');
    t.equal('Q4 ends on new year eve', qt.quarterBounds(2026, 4).endDate, '2026-12-31');

    t.equal('there is no quarter five', qt.quarterBounds(2026, 5), null);
    t.equal('there is no quarter zero', qt.quarterBounds(2026, 0), null);
});

suite('quarter trend: a boundary date lands in one quarter only', (t) => {
    const qt = load(t, {});
    // Parsed at local midnight. new Date('2026-04-01') is UTC and reads as
    // March 31 west of Greenwich, which is the whole quarter walked back a day.
    t.equal('the first of April is Q2', qt.quarterOfDate('2026-04-01', 2026), 2);
    t.equal('the last of March is Q1', qt.quarterOfDate('2026-03-31', 2026), 1);
    t.equal('the last of December is Q4', qt.quarterOfDate('2026-12-31', 2026), 4);
    t.equal('another year does not count', qt.quarterOfDate('2025-04-01', 2026), null);
});

/* ── The double count ── */

const APRIL_WEEKS = Object.assign({},
    period('week', '2026-04-06', '2026-04-12', [person('Sam Quarter', { reliability: 8 })]),
    period('week', '2026-04-13', '2026-04-19', [person('Sam Quarter', { reliability: 0 })]),
    period('week', '2026-04-20', '2026-04-26', [person('Sam Quarter', { reliability: 3 })])
);
const APRIL_MONTH = period('month', '2026-04-01', '2026-04-30',
    [person('Sam Quarter', { totalCalls: 400, reliability: 11 })]);
const Q2_QUARTER = period('quarter', '2026-04-01', '2026-06-30',
    [person('Sam Quarter', { totalCalls: 1200, reliability: 14 })]);

suite('quarter trend: overlapping uploads are not added together', (t) => {
    t.pinClock('2026-09-22');
    // Every grain of April present at once, which is what Scott actually has.
    const qt = load(t, Object.assign({}, APRIL_WEEKS, APRIL_MONTH, Q2_QUARTER));

    const q2 = qt.buildQuarterAggregate(2026, 2);
    t.check('Q2 was built', !!q2);
    if (!q2) return;

    const sam = q2.employees['Sam Quarter'];
    t.check('the associate is in it', !!sam);
    if (!sam) return;

    // The three sources say 11, 11 and 14 hours. Summed they would say 36.
    t.check('missed hours are not the sum of every grain', sam.reliability < 36);
    t.equal('the quarter upload is taken whole', sam.reliability, 14);
    t.equal('and its call volume is not tripled', sam.totalCalls, 1200);
    t.equal('because exactly one granularity was used', q2.granularity, 'quarter');
    t.equal('and it says so', q2.sourceLabel, 'quarter upload');
    t.equal('from a single period', q2.periodCount, 1);
});

suite('quarter trend: months beat weeks when both cover the quarter', (t) => {
    t.pinClock('2026-09-22');
    const months = Object.assign({},
        period('month', '2026-04-01', '2026-04-30', [person('Sam Quarter', { totalCalls: 400, reliability: 11 })]),
        period('month', '2026-05-01', '2026-05-31', [person('Sam Quarter', { totalCalls: 400, reliability: 2 })]),
        period('month', '2026-06-01', '2026-06-30', [person('Sam Quarter', { totalCalls: 400, reliability: 1 })])
    );
    const qt = load(t, Object.assign({}, APRIL_WEEKS, months));

    const q2 = qt.buildQuarterAggregate(2026, 2);
    t.equal('three whole months beat three weeks of April', q2.granularity, 'month');
    t.equal('so the quarter is the three months added up',
        q2.employees['Sam Quarter'].reliability, 14);
    t.equal('and the calls are the three months', q2.employees['Sam Quarter'].totalCalls, 1200);
    t.equal('and it covers the whole quarter', q2.coveredDays, 91);
});

suite('quarter trend: weeks are used when they are all there is', (t) => {
    t.pinClock('2026-09-22');
    const qt = load(t, APRIL_WEEKS);

    const q2 = qt.buildQuarterAggregate(2026, 2);
    t.equal('weeks carry the quarter', q2.granularity, 'week');
    t.equal('8 + 0 + 3 is eleven', q2.employees['Sam Quarter'].reliability, 11);
    t.equal('over three weekly uploads', q2.periodCount, 3);
    // Three weeks of a 91 day quarter. The number exists so the document can
    // say what it actually rests on instead of implying a full quarter.
    t.equal('and the coverage is reported honestly', q2.coveredDays, 21);
    t.check('which is well short of the quarter', q2.coverageRatio < 0.3);
});

/* ── Containment ── */

suite('quarter trend: a period inside another is dropped', (t) => {
    const qt = load(t, {});
    const kept = qt.dropContained([
        { key: 'a', startMs: Date.parse('2026-04-01'), endMs: Date.parse('2026-04-30') },
        { key: 'b', startMs: Date.parse('2026-04-06'), endMs: Date.parse('2026-04-12') },
        { key: 'c', startMs: Date.parse('2026-05-01'), endMs: Date.parse('2026-05-31') }
    ]);
    t.equal('two survive', kept.length, 2);
    t.equal('the month is kept', kept[0].key, 'a');
    t.equal('the week inside it is gone', kept.map((k) => k.key).join(','), 'a,c');
});

/* ── Coverage arithmetic ── */

suite('quarter trend: coverage counts a day once', (t) => {
    const qt = load(t, {});
    const day = (iso) => Date.parse(iso + 'T00:00:00');
    const qStart = day('2026-04-01');
    const qEnd = day('2026-06-30');

    t.equal('one whole month is its length',
        qt.coveredDays([{ startMs: day('2026-04-01'), endMs: day('2026-04-30') }], qStart, qEnd), 30);

    t.equal('two touching months join up without a gap or an overlap',
        qt.coveredDays([
            { startMs: day('2026-04-01'), endMs: day('2026-04-30') },
            { startMs: day('2026-05-01'), endMs: day('2026-05-31') }
        ], qStart, qEnd), 61);

    t.equal('an overlap is not counted twice',
        qt.coveredDays([
            { startMs: day('2026-04-01'), endMs: day('2026-04-30') },
            { startMs: day('2026-04-15'), endMs: day('2026-05-15') }
        ], qStart, qEnd), 45);

    t.equal('a period running past the quarter is clipped to it',
        qt.coveredDays([{ startMs: day('2026-06-01'), endMs: day('2026-07-31') }], qStart, qEnd), 30);

    t.equal('a period wholly outside counts for nothing',
        qt.coveredDays([{ startMs: day('2026-01-01'), endMs: day('2026-02-01') }], qStart, qEnd), 0);
});

/* ── The series ── */

function threeQuarters(ahtByQuarter) {
    return Object.assign({},
        period('quarter', '2026-01-01', '2026-03-31', [person('Sam Quarter', { aht: ahtByQuarter[0] })]),
        period('quarter', '2026-04-01', '2026-06-30', [person('Sam Quarter', { aht: ahtByQuarter[1] })]),
        period('quarter', '2026-07-01', '2026-09-30', [person('Sam Quarter', { aht: ahtByQuarter[2] })])
    );
}

suite('quarter trend: three quarters make a direction', (t) => {
    t.pinClock('2026-09-22');
    const qt = load(t, threeQuarters([451, 438, 421]));

    const quarters = qt.buildYearQuarters(2026);
    t.equal('three quarters have started', quarters.length, 3);

    const series = qt.buildMetricSeries('Sam Quarter', 'aht', quarters);
    t.equal('every quarter has a reading', series.measuredCount, 3);
    t.equal('and they come back in order',
        series.points.map((p) => p.value).join(','), '451,438,421');

    t.equal('the first is Q1', series.first.name, 'Q1');
    t.equal('the last is Q3', series.last.name, 'Q3');

    // Handle time is a reverse metric, so falling seconds is improvement.
    t.equal('falling handle time reads as improvement', series.overall.direction, 'improving');
    t.equal('and the latest move does too', series.latestMove.direction, 'improving');
    t.equal('the raw change over the year is thirty seconds down',
        series.overall.rawChange, -30);
});

suite('quarter trend: a rising reverse metric is a decline', (t) => {
    t.pinClock('2026-09-22');
    const qt = load(t, threeQuarters([410, 425, 448]));
    const series = qt.buildMetricSeries('Sam Quarter', 'aht', qt.buildYearQuarters(2026));
    t.equal('handle time climbing is getting worse', series.overall.direction, 'declining');
    t.equal('and so is the last step', series.latestMove.direction, 'declining');
});

suite('quarter trend: a quarter with no data is a gap, not a zero', (t) => {
    t.pinClock('2026-09-22');
    // Q1 never uploaded. Q2 and Q3 present.
    const qt = load(t, Object.assign({},
        period('quarter', '2026-04-01', '2026-06-30', [person('Sam Quarter', { aht: 438 })]),
        period('quarter', '2026-07-01', '2026-09-30', [person('Sam Quarter', { aht: 421 })])
    ));

    const quarters = qt.buildYearQuarters(2026);
    t.equal('all three elapsed quarters are returned', quarters.length, 3);
    t.equal('and the missing one is flagged', quarters[0].empty, true);

    const series = qt.buildMetricSeries('Sam Quarter', 'aht', quarters);
    t.equal('there are still three points', series.points.length, 3);
    t.equal('but only two readings', series.measuredCount, 2);
    t.equal('the empty quarter carries no value', series.points[0].value, null);
    t.equal('and says so', series.points[0].hasValue, false);
    t.equal('the trend starts where the data starts', series.first.name, 'Q2');
});

suite('quarter trend: one quarter is not a trend', (t) => {
    t.pinClock('2026-09-22');
    const qt = load(t, period('quarter', '2026-07-01', '2026-09-30',
        [person('Sam Quarter', { aht: 421 })]));

    const series = qt.buildMetricSeries('Sam Quarter', 'aht', qt.buildYearQuarters(2026));
    t.equal('one reading', series.measuredCount, 1);
    t.equal('and no direction claimed from it', series.overall.direction, 'insufficient');
    t.equal('nor from a prior that does not exist', series.latestMove.direction, 'insufficient');
    t.equal('and nothing pretends there was a prior', series.overall.hasPrior, false);
});

/* ── Elapsed quarters ── */

suite('quarter trend: a quarter the calendar has not reached is not missing', (t) => {
    const qt = load(t, {});

    t.pinClock('2026-09-22');
    t.equal('in September, three quarters have started',
        qt.elapsedQuarters(2026).join(','), '1,2,3');

    t.pinClock('2026-02-10');
    t.equal('in February, only the first has', qt.elapsedQuarters(2026).join(','), '1');

    t.pinClock('2026-12-31');
    t.equal('by new year eve, all four have', qt.elapsedQuarters(2026).join(','), '1,2,3,4');

    t.pinClock('2026-10-01');
    t.equal('the day Q4 opens, it counts', qt.elapsedQuarters(2026).join(','), '1,2,3,4');
});

/* ── Coverage readout ── */

suite('quarter trend: the coverage readout says what each quarter rests on', (t) => {
    t.pinClock('2026-09-22');
    const qt = load(t, Object.assign({},
        // Q1 whole, from a quarter upload.
        period('quarter', '2026-01-01', '2026-03-31', [person('Sam Quarter')]),
        // Q2 whole, from three months.
        period('month', '2026-04-01', '2026-04-30', [person('Sam Quarter')]),
        period('month', '2026-05-01', '2026-05-31', [person('Sam Quarter')]),
        period('month', '2026-06-01', '2026-06-30', [person('Sam Quarter')]),
        // Q3 part way, because the quarter is not over.
        period('month', '2026-07-01', '2026-07-31', [person('Sam Quarter')]),
        period('month', '2026-08-01', '2026-08-31', [person('Sam Quarter')])
    ));

    const report = qt.quarterCoverageReport(2026);
    t.equal('three quarters are reported', report.length, 3);

    t.equal('Q1 came from the quarter upload', report[0].granularity, 'quarter');
    t.equal('and is complete', report[0].status, 'full');
    t.equal('and the calendar agrees it is over', report[0].complete, true);

    t.equal('Q2 came from months', report[1].granularity, 'month');
    t.equal('and is complete too', report[1].status, 'full');

    t.equal('Q3 came from months', report[2].granularity, 'month');
    t.equal('and the calendar knows it is not over', report[2].complete, false);
    t.equal('July and August cover sixty two days', report[2].coveredDays, 62);
    // 22 days of September have elapsed, so 62 of 84.
    t.check('which is most of the quarter so far', report[2].coverageRatio > 0.7);
    t.check('but not all of it', report[2].coverageRatio < 1);

    t.check('the readout names the headcount it found', report[0].headcount === 1);
    t.check('and lists what else it could have used', Array.isArray(report[0].alternatives));
});

suite('quarter trend: a quarter with nothing uploaded says so', (t) => {
    t.pinClock('2026-09-22');
    const qt = load(t, {});
    const report = qt.quarterCoverageReport(2026);
    t.equal('every elapsed quarter is still listed', report.length, 3);
    t.equal('each one reports nothing', report[0].status, 'none');
    t.equal('with no granularity chosen', report[0].granularity, null);
    t.equal('and it is said in words', report[0].sourceLabel, 'nothing uploaded');
    t.equal('and no phantom headcount', report[0].headcount, 0);
});
