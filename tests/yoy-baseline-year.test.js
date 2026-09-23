'use strict';

/**
 * Year over year compares last year with this one, whichever years those are.
 *
 * The baseline was fixed at 2025 while "this year" came from the clock, so in
 * 2027 it compared 2025 with 2027. Last year's own YTD upload is now used when
 * no baseline for that year has been pasted, and a pasted 2025 baseline is not
 * passed off as 2026.
 */

const { suite } = require('./harness');

function load(t, clock, ytd, pasted) {
    t.pinClock(clock);
    t.installFakeBrowser();
    global.ytdData = ytd || {};
    global.weeklyData = {};
    global.window.DevCoachModules.storage = {
        readStore: (key) => (key === 'yoyBaseline2025' ? pasted : undefined),
        saveWithSizeCheck: () => true
    };
    return t.loadModule('modules/yoy-comparison.module.js').yoyComparison;
}

const ytd2026 = {
    'ytd|2026-12-27': {
        metadata: { periodType: 'ytd', endDate: '2026-12-27' },
        employees: [{ name: 'Dana Reed', aht: 410 }, { name: 'Chris Vale', aht: 430 }]
    }
};

suite('year over year: in 2027 the baseline is 2026', (t) => {
    t.check('last year\'s YTD upload is the baseline', load(t, '2027-03-01', ytd2026, null).hasBaseline());

    const pasted2025 = { employees: [{ name: 'Dana Reed' }], metadata: { year: 2025 } };
    t.check('a 2025 paste is not used as 2026', !load(t, '2027-03-01', {}, pasted2025).hasBaseline());

    const legacy = { employees: [{ name: 'Dana Reed' }] };
    t.check('a paste saved before the year was recorded still counts as 2025 in 2026',
        load(t, '2026-08-18', {}, legacy).hasBaseline());
});
