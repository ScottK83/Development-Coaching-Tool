'use strict';

/**
 * Targets survive New Year, and every surface judges them as printed.
 *
 * Only 2025 and 2026 have entries. On January 1, 2027 every Met/Not-met pill,
 * on-target flag and rating went blank. The newest year now carries forward
 * until the new figures are entered.
 *
 * Several surfaces compared the raw value: 92.96 prints as "93.0%", met the
 * target on the rankings card and was "below goal" in celebrations and the
 * quarterly document.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    return t.loadModule('modules/metric-profiles.module.js').metricProfiles;
}

suite('targets: a year with no entry uses the newest one before it', (t) => {
    const mp = load(t);
    t.equal('2027 adherence target is 2026\'s', mp.getYearTarget('scheduleAdherence', 2027).value, 93);
    t.equal('2027 reliability budget is 2026\'s', mp.getYearTarget('reliability', 2027).value, 18);
    t.equal('2027 still meets and misses', mp.meetsYearTarget('scheduleAdherence', 95, 2027), true);
    t.equal('2027 still rates', mp.getRatingScore('scheduleAdherence', 95, 2027), 3);
    t.equal('and has bands', mp.hasRatingBand('aht', 2027), true);
    t.equal('a year on file keeps its own figure', mp.getYearTarget('cxRepOverall', 2025).value, 80);
    t.equal('a year before the first on file has nothing to borrow', mp.getYearTarget('aht', 2024), null);
});

suite('targets: a value is judged as it is printed', (t) => {
    const mp = load(t);
    const target = mp.getYearTarget('scheduleAdherence', 2026);
    t.equal('92.96 shows as 93.0% and meets a 93 target', mp.valueMeetsTarget('scheduleAdherence', 92.96, target), true);
    t.equal('92.94 shows as 92.9% and does not', mp.valueMeetsTarget('scheduleAdherence', 92.94, target), false);
});

suite('targets: the surfaces that compared raw values now go through the shared rounding', (t) => {
    const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    t.check('celebrations rounds before judging', read('modules/celebrations.module.js').indexOf('roundToDisplayPrecision(meta.registry, actual)') > -1);
    t.check('the quarterly document does', read('modules/quarter-review.module.js').indexOf('profiles.valueMeetsTarget(target.metricKey') > -1);
    t.check('its table does', read('modules/quarter-review-ui.module.js').indexOf('profiles.valueMeetsTarget(m.metricKey') > -1);
    t.check('tip effectiveness does', read('modules/metric-stability.module.js').indexOf('valueMeetsTarget(metricKey, value, target)') > -1);
    t.check('trend emails do', /function isMetricMeetingTarget[\s\S]{0,400}roundToDisplayPrecision/.test(read('modules/metric-trends.module.js')));
    t.check('trend targets take the period\'s year', read('modules/metric-trends.module.js').indexOf('getMetricTrendTarget(registryKey, reviewYear)') > -1);
});
