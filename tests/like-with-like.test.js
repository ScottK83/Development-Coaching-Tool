'use strict';

/**
 * Comparisons across metrics, weeks and people are made on a common footing.
 *
 *  - Morning Pulse picked the "biggest jump" on raw deltas, so fifteen seconds
 *    of AHT beat ten points of rep satisfaction nearly every time.
 *  - Tip effectiveness took a flat mean of weekly figures, so a one-survey week
 *    counted as much as a thirty-survey one.
 *  - The rankings tiebreaker dropped a missing metric from its average, which
 *    lifted the person with less data.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

suite('like with like: the biggest jump is measured in noise units', (t) => {
    const src = read('modules/morning-pulse.module.js');
    const fn = src.slice(src.indexOf('function getBiggestJump'), src.indexOf('function getBiggestJump') + 300);
    t.check('it compares jumpSize, not raw delta', fn.indexOf('jumpSize(d) > jumpSize(best)') > -1);
    t.check('and jumpSize divides by the metric noise', /function jumpSize[\s\S]{0,200}getGrowthNoiseThreshold/.test(src));
});

suite('like with like: tip effectiveness weights each week', (t) => {
    const src = read('modules/metric-stability.module.js');
    const fn = src.slice(src.indexOf('function avgInWindow'), src.indexOf('function improvementDelta'));
    t.check('it weights by volume', fn.indexOf('weekWeight(') > -1 && fn.indexOf('/ vals.length') === -1);
});

suite('like with like: a missing metric does not help the tiebreaker', (t) => {
    const src = read('modules/center-ranking.module.js');
    t.check('a missing value scores the bottom of its range',
        /isNaN\(val\)\) \{ normalized\.push\(0\); return; \}/.test(src));
});
