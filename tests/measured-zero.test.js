'use strict';

/**
 * A measured zero is a reading, not a missing value.
 *
 * team-snapshot builds a `cells` array whose `hasValue` flag is already the
 * whole presence test (team-snapshot.module.js:359 —
 * `value !== undefined && value !== null && value !== '' && !isNaN(num)`).
 * computeTeamMetricValue then re-checked `cell.value !== 0` on top of it,
 * which quietly redefined "measured zero" as "no reading".
 *
 * Zero is not missing on this list. It is the best possible number on every
 * reverse metric in SNAPSHOT_METRICS, and on transfersCount it is an ordinary
 * week's work. Excluding those rows took the best performers out of the
 * denominator, so the team figure printed on the shared snapshot came out
 * worse than the team actually was — and on reliability, which is summed
 * rather than averaged, a team that missed no hours at all reported "--"
 * instead of 0.
 */

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    global.window.METRICS_REGISTRY = {
        transfers: { key: 'transfers', unit: '%', isReverse: true },
        transfersCount: { key: 'transfersCount', unit: '#', isReverse: true },
        reliability: { key: 'reliability', unit: 'hrs', isReverse: true },
        scheduleAdherence: { key: 'scheduleAdherence', unit: '%', isReverse: false }
    };
    return t.loadModule('modules/team-snapshot.module.js').teamSnapshot;
}

// A snapshot row, shaped the way assembleSnapshotData shapes one.
function row(name, totalCalls, values) {
    return {
        name,
        totalCalls,
        surveyTotal: 10,
        cells: Object.keys(values).map((metricKey) => ({
            metricKey,
            value: values[metricKey],
            hasValue: values[metricKey] !== undefined && values[metricKey] !== null && !isNaN(values[metricKey])
        }))
    };
}

suite('team snapshot: a zero counts toward the team figure', (t) => {
    const api = load(t);
    t.check('computeTeamMetricValue is reachable', typeof api.computeTeamMetricValue === 'function');

    // Two associates, equal call volume. One transferred nothing all week,
    // which is the best number on the sheet; the other transferred 10%.
    // The team rate is 5%, and printing 10% tells the team it is twice as
    // transfer-happy as it is.
    const rows = [
        row('Perfect', 100, { transfers: 0 }),
        row('Average', 100, { transfers: 10 })
    ];
    t.equal('the zero is averaged in, not dropped',
        api.computeTeamMetricValue(rows, 'transfers'), 5);

    // The same shape on a count, where zero is simply an ordinary week.
    const counts = [
        row('Perfect', 100, { transfersCount: 0 }),
        row('Average', 100, { transfersCount: 20 })
    ];
    t.equal('and so is a zero count', api.computeTeamMetricValue(counts, 'transfersCount'), 10);

    // Weighting still applies: the zero row carries twice the volume, so it
    // pulls the average further than an unweighted mean would.
    const weighted = [
        row('Perfect', 200, { transfers: 0 }),
        row('Average', 100, { transfers: 9 })
    ];
    t.equal('and the zero row carries its call volume',
        api.computeTeamMetricValue(weighted, 'transfers'), 3);
});

suite('team snapshot: a team that missed no hours reports zero, not nothing', (t) => {
    const api = load(t);

    // reliability is summed rather than averaged. Every member at zero is a
    // perfect month, and it used to render as "--".
    const perfect = [
        row('A', 100, { reliability: 0 }),
        row('B', 100, { reliability: 0 })
    ];
    t.equal('a perfect team totals zero', api.computeTeamMetricValue(perfect, 'reliability'), 0);

    const mixed = [
        row('A', 100, { reliability: 0 }),
        row('B', 100, { reliability: 6 })
    ];
    t.equal('and one absence still totals only that absence',
        api.computeTeamMetricValue(mixed, 'reliability'), 6);
});

suite('team snapshot: genuinely absent readings are still absent', (t) => {
    const api = load(t);

    // The other half of the rule. Dropping the zero check must not start
    // counting rows that carry no reading at all.
    const noneAtAll = [
        row('A', 100, { transfers: null }),
        row('B', 100, { transfers: undefined })
    ];
    t.equal('no readings means no figure',
        api.computeTeamMetricValue(noneAtAll, 'transfers'), null);

    t.equal('and no rows at all means no figure',
        api.computeTeamMetricValue([], 'transfers'), null);

    t.equal('a summed metric with no readings is null, not zero',
        api.computeTeamMetricValue(noneAtAll.map((r) => row(r.name, 100, { reliability: null })), 'reliability'),
        null);

    // A row that simply does not carry this metric at all.
    t.equal('a metric nobody has is null',
        api.computeTeamMetricValue([row('A', 100, { transfers: 4 })], 'aht'), null);
});
