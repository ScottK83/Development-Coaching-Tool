'use strict';

const { suite } = require('./harness');

/**
 * RANKED ON ONE SCALE
 *
 * The tips audit (2026-10-25): "the weakest metric" and the call coaching
 * chips were ranked by the raw gap to goal, which adds seconds to percentage
 * points. Handle time 14 seconds over a 426 goal (3%) outranked Rep Sat 12
 * points under an 82 goal (15%), so the seconds metrics led nearly every
 * time (151 of the first 255 Today tips were handle time). The gap is now a
 * share of the goal, the same for every metric.
 */

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/message-voice.module.js');
    t.loadModule('modules/metric-trends.module.js');
    t.loadModule('modules/call-coaching-bridge.module.js');
    return global.window.DevCoachModules;
}

function metric(metricKey, value, target, type) {
    return {
        metricKey,
        label: metricKey,
        employeeValue: value,
        target,
        targetType: type,
        meetsTarget: false,
        gapFromTarget: type === 'min' ? Math.max(0, target - value) : Math.max(0, value - target),
        trendDirection: 'stable',
        trendDelta: 0,
        classification: 'Needs Focus'
    };
}

suite('ranking scale: the weakest metric is the one furthest from goal as a share of it', (t) => {
    const { metricTrends: mt } = load(t);
    const list = [metric('aht', 440, 426, 'max'), metric('cxRepOverall', 70, 82, 'min')];
    t.equal('Rep Sat 12 points under an 82 goal leads handle time 14 seconds over 426',
        mt.pickWeakestAndTrending(list).weakest.metricKey, 'cxRepOverall');

    const far = [metric('aht', 534, 426, 'max'), metric('scheduleAdherence', 91, 93, 'min')];
    t.equal('a handle time far over goal still leads a small adherence miss',
        mt.pickWeakestAndTrending(far).weakest.metricKey, 'aht');

    // A share of the goal over-weights the small numbers: 9% against 6% is
    // "50% off". In steps it is six half points, behind 134 seconds.
    const small = [metric('transfers', 9, 6, 'max'), metric('aht', 560, 426, 'max')];
    t.equal('transfers 3 points over does not outrank handle time 134 seconds over',
        mt.pickWeakestAndTrending(small).weakest.metricKey, 'aht');

    const noSurveys = [Object.assign(metric('overallExperience', 0, 75, 'min'), { measured: false }), metric('aht', 440, 426, 'max')];
    t.equal('a survey metric nobody answered is never the weakest',
        mt.pickWeakestAndTrending(noSurveys).weakest.metricKey, 'aht');
});

suite('ranking scale: the call coaching chips are ordered the same way', (t) => {
    const { callCoachingBridge: B } = load(t);
    const all = [metric('aht', 440, 426, 'max'), metric('cxRepOverall', 70, 82, 'min')];
    const findings = [{ key: 'deadAirGap', count: 1, weight: 6 }, { key: 'recap', count: 1, weight: 5 }];
    const order = B.metricsInFocus(all, findings).map(item => item.metricKey);
    t.equal('Rep Sat first', order[0], 'cxRepOverall');
    t.equal('then handle time', order[1], 'aht');
});
