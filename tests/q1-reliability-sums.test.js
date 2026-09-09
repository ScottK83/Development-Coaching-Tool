'use strict';

/**
 * Q1 Review adds up the hours missed in the quarter.
 *
 * It used to take the highest value it saw, on the belief that the reliability
 * column is a running total. It is not, for anything but a YTD upload:
 * metric-trends:3469 says "a weekly or monthly upload carries the hours missed
 * IN THAT PERIOD -- a typical sequence is 0, 0, 0, 8.5, 0", and futures:278
 * says the same. Both of those modules fixed exactly this mistake in their own
 * aggregation; Q1 Review was the copy left behind.
 *
 * Maxing keeps an associate's single worst week and silently discards every
 * other absence. A quarter of 8 + 8 + 3 came out as 8 -- inside the 18-hour
 * budget, listed as a strength, and driving the sort and the review copy off a
 * figure less than half the real one.
 *
 * The behaviour baseline cannot catch this: its fixture has no Q1 data at all,
 * because every week in it falls in May and June.
 */

const { suite } = require('./harness');

const PREFIX = 'devCoachingTool_';

function week(start, end, employees) {
    return {
        [`${start}|${end}`]: {
            metadata: { periodType: 'week', startDate: start, endDate: end },
            employees
        }
    };
}

function person(name, reliability, extra) {
    return Object.assign({
        name, totalCalls: 200,
        surveyTotal: 40, repSurveyTotal: 40, fcrSurveyTotal: 40,
        scheduleAdherence: 95, cxRepOverall: 85, fcr: 78, overallExperience: 80,
        overallSentiment: 90, transfers: 4, aht: 400, reliability
    }, extra || {});
}

function load(t, weekly) {
    const browser = t.installFakeBrowser();
    global.window.weeklyData = weekly;
    global.window.ytdData = {};
    global.weeklyData = weekly;
    global.ytdData = {};
    browser.store[PREFIX + 'weeklyData'] = JSON.stringify(weekly);

    global.window.DevCoachModules.storage = {
        readStore(key) {
            const raw = browser.store[PREFIX + key];
            return raw === undefined ? undefined : JSON.parse(raw);
        },
        loadWeeklyData() { return weekly; }
    };

    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    return t.loadModule('modules/q1-review.module.js').q1Review;
}

// Three weeks inside Q1. One clean, two with a full day missed apiece, and a
// short absence: 8 + 8 + 3 = 19 hours, which is over the 18-hour budget.
const Q1_WEEKS = Object.assign({},
    week('2026-01-05', '2026-01-11', [person('Sam Quarter', 8), person('Clean Colleague', 0)]),
    week('2026-02-02', '2026-02-08', [person('Sam Quarter', 8), person('Clean Colleague', 0)]),
    week('2026-03-02', '2026-03-08', [person('Sam Quarter', 3), person('Clean Colleague', 0)])
);

suite('q1 review: the quarter adds up its weeks', (t) => {
    t.pinClock('2026-04-15');   // inside 2026, after Q1 has closed
    const q1 = load(t, Q1_WEEKS);

    const data = q1.buildQ1ReviewData();
    t.check('Q1 data was built', !!data);
    if (!data) return;

    const rows = data.employees || [];
    const sam = rows.find((r) => r.name === 'Sam Quarter');
    t.check('the associate is in it', !!sam);
    if (!sam) return;

    const rel = sam.metrics && sam.metrics.reliability;
    t.check('reliability is reported for the quarter', !!rel);
    if (!rel) return;

    t.equal('8 + 8 + 3 is nineteen, not the worst single week', rel.average, 19);
    t.check('which is over the eighteen hour budget', rel.average > 18);
    t.check('so it does not meet target', rel.meetsTarget === false);
    // gap is signed target-minus-value on a reverse metric, so negative is over
    // budget. One hour over, which is the number the review copy quotes.
    t.equal('and it is one hour over', rel.gap, -1);

    const clean = rows.find((r) => r.name === 'Clean Colleague');
    t.equal('and somebody who missed nothing still totals nothing',
        clean.metrics.reliability.average, 0);
    t.check('and meets target', clean.metrics.reliability.meetsTarget === true);
});

suite('q1 review: a single bad week is not the whole quarter', (t) => {
    // The shape that made maxing look right: one absence among zeroes. Max and
    // sum agree here, which is exactly why the bug survived.
    t.pinClock('2026-04-15');
    const q1 = load(t, Object.assign({},
        week('2026-01-05', '2026-01-11', [person('Solo Absence', 0)]),
        week('2026-02-02', '2026-02-08', [person('Solo Absence', 8.5)]),
        week('2026-03-02', '2026-03-08', [person('Solo Absence', 0)])
    ));

    const data = q1.buildQ1ReviewData();
    const rows = (data && data.employees) || [];
    const solo = rows.find((r) => r.name === 'Solo Absence');
    t.check('the associate is in it', !!solo);
    if (!solo) return;
    t.equal('one absence among zeroes totals that absence',
        solo.metrics.reliability.average, 8.5);
    t.check('and stays inside the budget', solo.metrics.reliability.meetsTarget === true);
});
