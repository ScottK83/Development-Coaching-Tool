'use strict';

const { suite } = require('./harness');

const REGISTRY = {
    aht:              { unit: 'sec', isReverse: true,  label: 'Average Handle Time' },
    holdTime:         { unit: 'sec', isReverse: true,  label: 'Hold Time' },
    acw:              { unit: 'sec', isReverse: true,  label: 'After Call Work' },
    transfers:        { unit: '%',   isReverse: true,  label: 'Transfers' },
    overallSentiment: { unit: '%',   isReverse: false, label: 'Overall Sentiment' },
    fcr:              { unit: '%',   isReverse: false, label: 'First Call Resolution' },
    reliability:      { unit: 'hrs', isReverse: true,  label: 'Reliability' }
};

function load(t) {
    t.installFakeBrowser();
    global.window.METRICS_REGISTRY = REGISTRY;
    global.window.formatMetricDisplay = (k, v) => {
        const unit = (REGISTRY[k] || {}).unit || '%';
        return unit === 'sec' ? `${Math.round(v)}s` : unit === 'hrs' ? `${v}h` : `${v}%`;
    };
    return t.loadModule('modules/metric-movement.module.js').metricMovement;
}

suite('metricMovement — polarity', (t) => {
    const mm = load(t);

    // Alyssa's real case: handle time 562s -> 607s.
    const worse = mm.resolveDirection('aht', 607, 562);
    t.equal('AHT 562->607 is a decline in performance', worse.direction, 'declining');
    const dW = mm.describe('aht', worse.direction, worse.delta);
    t.equal('  the number is reported as rising', dW.numberRose, true);
    t.equal('  worded as getting worse, not a direction', dW.word, 'getting worse');
    t.equal('  arrow follows the number, so points up', dW.arrow, '▲');
    t.equal('  but the arrow is flagged bad', dW.arrowIsGood, false);
    t.equal('  polarity is stated', dW.polarity, 'lower is better');

    // The inversion that shipped: AHT 700 -> 607 is a win.
    const better = mm.resolveDirection('aht', 607, 700);
    t.equal('AHT 700->607 is an improvement', better.direction, 'improving');
    const dB = mm.describe('aht', better.direction, better.delta);
    t.equal('  the number fell', dB.numberRose, false);
    t.equal('  arrow points DOWN (a green up-arrow here was the old bug)', dB.arrow, '▼');
    t.equal('  and is flagged good', dB.arrowIsGood, true);

    // Normal metric behaves the mirror way.
    const sentDown = mm.resolveDirection('overallSentiment', 88, 93);
    t.equal('Sentiment 93->88 declines', sentDown.direction, 'declining');
    t.equal('  number fell', mm.describe('overallSentiment', sentDown.direction, sentDown.delta).numberRose, false);
    t.equal('  arrow points down', mm.describe('overallSentiment', sentDown.direction, sentDown.delta).arrow, '▼');

    const sentUp = mm.resolveDirection('overallSentiment', 93, 88);
    t.equal('Sentiment 88->93 improves', sentUp.direction, 'improving');
    t.equal('  arrow points up', mm.describe('overallSentiment', sentUp.direction, sentUp.delta).arrow, '▲');
});

suite('metricMovement — every reverse metric agrees', (t) => {
    const mm = load(t);

    ['aht', 'holdTime', 'acw', 'transfers', 'reliability'].forEach((key) => {
        const r = mm.resolveDirection(key, 100, 50); // number went up
        const d = mm.describe(key, r.direction, r.delta);
        t.check(`${key}: rising number => worse, ▲, "getting worse"`,
            d.direction === 'declining' && d.numberRose === true &&
            d.arrow === '▲' && d.word === 'getting worse' && d.arrowIsGood === false);
    });

    ['overallSentiment', 'fcr'].forEach((key) => {
        const r = mm.resolveDirection(key, 50, 100); // number went down
        const d = mm.describe(key, r.direction, r.delta);
        t.check(`${key}: falling number => worse, ▼, "getting worse"`,
            d.direction === 'declining' && d.numberRose === false &&
            d.arrow === '▼' && d.word === 'getting worse' && d.arrowIsGood === false);
    });

    // The invariant that both shipped bugs violated.
    Object.keys(REGISTRY).forEach((key) => {
        ['improving', 'declining'].forEach((dir) => {
            const d = mm.describe(key, dir, 10);
            const good = d.arrowIsGood;
            const rose = d.numberRose;
            const expected = d.isReverse ? !rose : rose;
            t.check(`${key}/${dir}: arrow direction is consistent with the verdict`, good === expected);
        });
    });
});

suite('metricMovement — stability band', (t) => {
    const mm = load(t);

    t.equal('AHT moving 5s is inside the 8s band', mm.resolveDirection('aht', 605, 600).direction, 'stable');
    t.equal('AHT moving 20s is outside it', mm.resolveDirection('aht', 620, 600).direction, 'declining');
    t.equal('a 0.5% sentiment move is stable', mm.resolveDirection('overallSentiment', 90.5, 90).direction, 'stable');
    t.equal('a 3% sentiment move is not', mm.resolveDirection('overallSentiment', 93, 90).direction, 'improving');
    t.equal('caller can override the band', mm.resolveDirection('aht', 605, 600, { sec: 2, percent: 1, hrs: 0.5, fallback: 1 }).direction, 'declining');
});

suite('metricMovement — missing and malformed input', (t) => {
    const mm = load(t);

    t.equal('no prior period reports stable', mm.resolveDirection('aht', 600, undefined).direction, 'stable');
    t.equal('  and says it has no prior', mm.resolveDirection('aht', 600, undefined).hasPrior, false);
    t.equal('  sentence says so in words', mm.sentence('aht', 'stable', null), 'no prior period to compare');
    t.equal('non-numeric previous is treated as missing', mm.performanceDelta('aht', 600, 'N/A'), null);
    t.equal('unknown metric does not throw', mm.describe('somethingNew', 'improving', 5).direction, 'improving');
    t.equal('  and defaults to higher-is-better', mm.describe('somethingNew', 'improving', 5).polarity, 'higher is better');
    t.equal('stable renders no phrase', mm.phrase('aht', 'stable'), '');
    t.equal('stable arrow is neutral', mm.arrowHtml('aht', 'stable').includes('>=<'), true);
    // A horizontal bar is an em dash wearing a different code point, and the
    // no-em-dash rule covers the lookalikes too. An equals sign says "no change"
    // without one.
    t.check('and carries no dash of any kind',
        !/[–—―]/.test(mm.arrowHtml('aht', 'stable')));
});

suite('metricMovement — prompt sentences', (t) => {
    const mm = load(t);

    t.equal('AHT worsening reads unambiguously',
        mm.sentence('aht', 'declining', -45),
        'rose by 45s vs previous, which is worse');
    t.equal('AHT improving reads unambiguously',
        mm.sentence('aht', 'improving', 93),
        'fell by 93s vs previous, which is better');
    t.equal('sentiment worsening reads unambiguously',
        mm.sentence('overallSentiment', 'declining', -5),
        'fell by 5% vs previous, which is worse');
    t.equal('caller can name the comparison period',
        mm.sentence('aht', 'declining', -45, 'last week'),
        'rose by 45s vs last week, which is worse');

    // The words the old code used, which read backwards on reverse metrics.
    t.check('no reverse-metric sentence contains "trending up/down"',
        ['aht', 'holdTime', 'transfers'].every((k) =>
            !/trending (up|down)/.test(mm.sentence(k, 'declining', 10) + mm.sentence(k, 'improving', 10))));
    t.check('no reverse-metric phrase leans on the bare word "declining"',
        ['aht', 'holdTime', 'transfers'].every((k) => mm.phrase(k, 'declining') === ' (getting worse)'));
});

suite('metricMovement — arrow markup', (t) => {
    const mm = load(t);

    const good = mm.arrowHtml('aht', 'improving');
    t.check('improving AHT renders a green down-arrow', good.includes('▼') && good.includes('green'));
    const bad = mm.arrowHtml('aht', 'declining');
    t.check('declining AHT renders a red up-arrow', bad.includes('▲') && bad.includes('var(--red)'));
    const soft = mm.arrowHtml('aht', 'declining', { badColor: '#f9a825', stillOnTarget: true });
    t.check('caller can soften the colour when still on target',
        soft.includes('#f9a825') && soft.includes('still on target'));
    t.check('titles never say a bare direction word',
        !/title="(Declining|Improving)"/.test(good + bad));
});

suite('metricMovement: a move is said the way it happened', (t) => {
    const mm = load(t);
    // Intelligence printed "drop in Average Handle Time (-31.0sec)" for a
    // handle time that went from 562 to 593 (2026-11-03).
    t.equal('handle time that rose', mm.moveInWords('aht', 593, 562), 'up 31 seconds, from 562s to 593s');
    t.equal('handle time that fell', mm.moveInWords('aht', 689, 699), 'down 10 seconds, from 699s to 689s');
    t.equal('one second is singular', mm.moveInWords('holdTime', 41, 40), 'up 1 second, from 40s to 41s');
    t.equal('a percentage moves in points', mm.moveInWords('fcr', 70.5, 72.3), 'down 1.8 points, from 72.3% to 70.5%');
    t.equal('hours in hours', mm.moveInWords('reliability', 4.5, 3), 'up 1.5 hours, from 3h to 4.5h');
    t.equal('no move says so', mm.moveInWords('fcr', 70, 70), 'unchanged at 70%');
    t.equal('nothing to compare is nothing said', mm.moveInWords('fcr', 70, null), '');
});

suite('trend intelligence: alerts say the move, not a signed delta', (t) => {
    const mm = load(t);
    const intel = t.loadModule('modules/trend-intelligence.module.js').trendIntelligence;
    const context = {
        metricsRegistry: REGISTRY,
        metricDelta: (key, current, prev) => (REGISTRY[key].isReverse ? prev - current : current - prev),
        getTrendDeltaThreshold: () => ({ value: 15, unit: 'sec' })
    };
    const out = intel.collectIndividualTrendWarningsAndRationale({ aht: 593 }, { aht: 562 }, null, 'week', context);
    const line = out.warnings.join(' ');
    t.check('the warning was raised', out.warnings.length === 1);
    t.check('it says the number went up', line.indexOf('up 31 seconds, from 562s to 593s') > -1);
    t.check('and never prints the minus', line.indexOf('-31') === -1);
    t.check('the reason has no signed delta either', out.rationale.join(' ').indexOf('-31') === -1);
    t.check('movement module is the source', typeof mm.moveInWords === 'function');
});
