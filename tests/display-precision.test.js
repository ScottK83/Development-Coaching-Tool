'use strict';

const { suite } = require('./harness');

/**
 * A number and its verdict, printed in the same cell, must agree.
 *
 * Reported as "why didn't Johnathan meet July adherence at a 93". His raw
 * adherence was 92.96. Percentages are displayed to one decimal, so the cell
 * read "93.0%" and "below" at the same time, against a 93% target. The reader
 * cannot resolve that, because the second decimal is precisely what they were
 * not given.
 *
 * The rounding lives with the targets and the rating bands so that every
 * surface — the emailed picture, the rankings table, the year-end mirror —
 * reaches the same conclusion about the same number.
 */

function loadProfiles(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/metrics.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    const M = global.window.DevCoachModules;
    return { mp: M.metricProfiles, metrics: M.metrics };
}

suite('display precision: a percentage is judged as it is printed', (t) => {
    const { mp, metrics } = loadProfiles(t);

    // The reported case.
    t.equal('92.96 prints as 93.0%', metrics.formatMetricDisplay('scheduleAdherence', 92.96), '93.0%');
    t.equal('and meets a 93 target', mp.meetsYearTarget('scheduleAdherence', 92.96, 2026), true);

    // Still honest below the rounding boundary.
    t.equal('92.94 prints as 92.9%', metrics.formatMetricDisplay('scheduleAdherence', 92.94), '92.9%');
    t.equal('and does not meet', mp.meetsYearTarget('scheduleAdherence', 92.94, 2026), false);

    t.equal('exactly on target meets', mp.meetsYearTarget('scheduleAdherence', 93, 2026), true);
    t.equal('well under does not', mp.meetsYearTarget('scheduleAdherence', 79, 2026), false);
});

suite('display precision: every metric is judged as it is printed', (t) => {
    const { mp, metrics } = loadProfiles(t);

    /* One case per unit, each sitting just under its target by less than the
       last displayed digit — the shape that produced the contradiction. */
    const cases = [
        { key: 'scheduleAdherence', raw: 92.96, target: 93, dir: 'min' },
        { key: 'overallSentiment', raw: 87.96, target: 88, dir: 'min' },
        { key: 'cxRepOverall', raw: 81.97, target: 82, dir: 'min' },
        { key: 'fcr', raw: 72.98, target: 73, dir: 'min' },
        { key: 'overallExperience', raw: 74.96, target: 75, dir: 'min' },
        { key: 'positiveWord', raw: 85.98, target: 86, dir: 'min' },
        { key: 'negativeWord', raw: 82.97, target: 83, dir: 'min' },
        { key: 'managingEmotions', raw: 94.99, target: 95, dir: 'min' },
        { key: 'aht', raw: 426.4, target: 426, dir: 'max' },
        { key: 'acw', raw: 60.4, target: 60, dir: 'max' },
        { key: 'holdTime', raw: 30.4, target: 30, dir: 'max' },
        { key: 'transfers', raw: 6.04, target: 6, dir: 'max' },
        { key: 'reliability', raw: 18.004, target: 18, dir: 'max' }
    ];

    const wrong = [];
    cases.forEach((c) => {
        const shown = metrics.formatMetricDisplay(c.key, c.raw);
        const printed = parseFloat(String(shown).replace(/[^0-9.-]/g, ''));
        const verdict = mp.meetsYearTarget(c.key, c.raw, 2026);
        if (verdict === null) return;   // no target for this metric this year
        const expected = c.dir === 'max' ? printed <= c.target : printed >= c.target;
        if (verdict !== expected) wrong.push(c.key + ' shows ' + shown + ' but reads ' + verdict);
    });
    t.check('no metric disagrees with its own printed value: ' + JSON.stringify(wrong), wrong.length === 0);

    // And the rounding is not a licence: a real miss stays a miss.
    t.equal('a genuine miss is still a miss', mp.meetsYearTarget('scheduleAdherence', 92.4, 2026), false);
    t.equal('a genuinely slow AHT too', mp.meetsYearTarget('aht', 431, 2026), false);
});

suite('display precision: the rating bands round the same way', (t) => {
    const { mp, metrics } = loadProfiles(t);

    /* The bands sit at 94.5 and 92.5 for adherence. A raw 92.47 prints as 92.5%
       and used to score a 1 beside it — the same contradiction, one surface
       over. */
    t.equal('92.47 prints as 92.5%', metrics.formatMetricDisplay('scheduleAdherence', 92.47), '92.5%');
    t.equal('and scores the 2 its printed value earns', mp.getRatingScore('scheduleAdherence', 92.47, 2026), 2);
    t.equal('92.44 prints as 92.4%', metrics.formatMetricDisplay('scheduleAdherence', 92.44), '92.4%');
    t.equal('and scores the 1 that is', mp.getRatingScore('scheduleAdherence', 92.44, 2026), 1);

    // AHT is whole seconds, so the boundary is a whole second.
    t.equal('414.4 prints as 414 sec', metrics.formatMetricDisplay('aht', 414.4), '414 sec');
    t.equal('and earns the 3', mp.getRatingScore('aht', 414.4, 2026), 3);
    t.equal('414.6 rounds to 415', metrics.formatMetricDisplay('aht', 414.6), '415 sec');
    t.equal('and does not', mp.getRatingScore('aht', 414.6, 2026), 2);
});

suite('display precision: rounding follows the unit, not a fixed number of places', (t) => {
    const { mp } = loadProfiles(t);

    t.equal('percentages keep one decimal', mp.roundToDisplayPrecision('scheduleAdherence', 92.96), 93);
    t.equal('seconds are whole', mp.roundToDisplayPrecision('aht', 426.4), 426);
    t.equal('hours keep two', mp.roundToDisplayPrecision('reliability', 18.004), 18);
    t.equal('and two really is two', mp.roundToDisplayPrecision('reliability', 18.006), 18.01);

    // Nothing to round is not an error.
    t.check('a blank stays unusable', !Number.isFinite(mp.roundToDisplayPrecision('aht', '')));
    t.check('and so does nonsense', !Number.isFinite(mp.roundToDisplayPrecision('aht', 'abc')));
});
