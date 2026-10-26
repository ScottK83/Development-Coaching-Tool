'use strict';

const { suite } = require('./harness');

/**
 * DID IT HOLD
 *
 * The deep dive plan (2026-10-25, approved 2026-10-26): judge coaching at one
 * week and at three. One week after is noisy for any one person; three weeks
 * says whether the change held. The three weeks are combined the app's one
 * way (buildEmployeeAggregateForPeriod, stubbed here as a call weighted
 * average) and judged against the rest of the team over the same weeks.
 *
 * And a week with no calls, or a survey metric nobody answered, is not a
 * number to measure by: a 0 second handle time read as a huge improvement.
 */

function week(end, people) {
    return { metadata: { periodType: 'week', endDate: end }, employees: people };
}

function person(name, aht, extra = {}) {
    return Object.assign({ name, aht, totalCalls: 100, cxRepOverall: 80, repSurveyTotal: 5 }, extra);
}

function load(t, weeks, history) {
    t.installFakeBrowser();
    global.window.METRICS_REGISTRY = {
        aht: { label: 'Average Handle Time', isReverse: true, unit: 'sec', target: { type: 'max', value: 426 } },
        cxRepOverall: { label: 'Rep Satisfaction', isReverse: false, unit: '%', target: { type: 'min', value: 82 } }
    };
    global.weeklyData = weeks;
    global.coachingHistory = history;
    // The real one lives in script.js; this is the same shape, weighted by calls.
    global.buildEmployeeAggregateForPeriod = (name, keys) => {
        let n = 0; let sum = 0; let periods = 0;
        keys.forEach((key) => {
            const emp = (weeks[key]?.employees || []).find(e => e.name === name);
            if (!emp) return;
            periods += 1;
            sum += emp.aht * emp.totalCalls;
            n += emp.totalCalls;
        });
        return periods ? { periodsIncluded: periods, aht: n ? sum / n : NaN } : null;
    };
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/coaching-outcomes.module.js');
    return global.window.DevCoachModules.coachingOutcomes;
}

const TEAM = (aht) => [person('A', aht), person('B', aht + 10), person('C', aht + 20)];

suite('coaching outcomes: judged at one week and at three, against the team', (t) => {
    const weeks = {
        w1: week('2026-08-09', [person('Esther', 520), ...TEAM(400)]),
        w2: week('2026-08-16', [person('Esther', 470), ...TEAM(400)]),
        w3: week('2026-08-23', [person('Esther', 460), ...TEAM(401)]),
        w4: week('2026-08-30', [person('Esther', 450), ...TEAM(399)])
    };
    const outcomes = load(t, weeks, {
        Esther: [{ employeeId: 'Esther', weekEnding: '2026-08-09', generatedAt: '2026-08-10T12:00:00Z', metricsCoached: ['aht'], source: 'call', behaviors: ['silence'] }]
    });
    const [o] = outcomes.buildOutcomes('Esther');

    t.equal('one week after: moved', o.verdict, 'moved');
    t.equal('three weeks after: moved', o.verdict3, 'moved');
    t.equal('the three weeks combined', Math.round(o.afterValue3), 460);
    t.check('and it beat the team, which held flat', o.beatTeam3 === true);
    t.equal('the source is kept', o.source, 'call');
    t.equal('and the scorecard lines', JSON.stringify(o.behaviors), JSON.stringify(['silence']));

    const [row] = outcomes.summarizeByMetric(outcomes.buildOutcomes());
    t.equal('the summary counts the three week results', row.total3, 1);
    t.equal('and the ones that moved', row.moved3, 1);
});

suite('coaching outcomes: three weeks not uploaded yet is waiting, not a verdict', (t) => {
    const weeks = {
        w1: week('2026-08-09', [person('Esther', 520), ...TEAM(400)]),
        w2: week('2026-08-16', [person('Esther', 470), ...TEAM(400)])
    };
    const outcomes = load(t, weeks, {
        Esther: [{ employeeId: 'Esther', weekEnding: '2026-08-09', generatedAt: '2026-08-10T12:00:00Z', metricsCoached: ['aht'] }]
    });
    const [o] = outcomes.buildOutcomes('Esther');
    t.equal('one week is in', o.verdict, 'moved');
    t.equal('three weeks is waiting', o.verdict3, 'pending');
});

suite('coaching outcomes: a week with no calls is not a number to measure by', (t) => {
    const weeks = {
        w1: week('2026-08-09', [person('Esther', 520), ...TEAM(400)]),
        w2: week('2026-08-16', [person('Esther', 0, { totalCalls: 0 }), ...TEAM(400)]),
        w3: week('2026-08-23', [person('Esther', 500), ...TEAM(400)]),
        w4: week('2026-08-30', [person('Esther', 500), ...TEAM(400)])
    };
    const outcomes = load(t, weeks, {
        Esther: [{ employeeId: 'Esther', weekEnding: '2026-08-09', generatedAt: '2026-08-10T12:00:00Z', metricsCoached: ['aht'] }]
    });
    const [o] = outcomes.buildOutcomes('Esther');
    t.equal('out the week after: no one week verdict, never "moved" to 0s', o.verdict, 'pending');
    t.equal('and no three week verdict across that week either', o.verdict3, 'pending');
});

suite('coaching outcomes: a survey metric nobody answered is not a 0%', (t) => {
    const weeks = {
        w1: week('2026-08-09', [person('Esther', 520, { cxRepOverall: 75 }), ...TEAM(400)]),
        w2: week('2026-08-16', [person('Esther', 470, { cxRepOverall: 0, repSurveyTotal: 0 }), ...TEAM(400)])
    };
    const outcomes = load(t, weeks, {
        Esther: [{ employeeId: 'Esther', weekEnding: '2026-08-09', generatedAt: '2026-08-10T12:00:00Z', metricsCoached: ['cxRepOverall'] }]
    });
    const [o] = outcomes.buildOutcomes('Esther');
    t.equal('no surveys the week after: waiting, not "went backwards" to 0%', o.verdict, 'pending');
});
