'use strict';

/**
 * Two panels that were dead in a state nobody thought to try.
 *
 * getCenterAverageForWeek threw on any install that has never saved a centre
 * average. readStore returns undefined for a store that was never written,
 * `?? null` makes it null, and JSON.stringify(null) is the STRING "null" --
 * which is truthy, so the assignment ran and set callCenterAverages to null.
 * The next line read a property off it and threw, taking the Executive Summary
 * callouts and the team-vs-centre analysis with it. script.js's own
 * loadCallCenterAverages returns {} for the same state.
 *
 * populateEmployeeDropdownForPeriod looked in ytdData and weeklyData but not
 * dailyData, while the period dropdown beside it offers daily periods. So
 * Metric Charts' Daily option filled its period list correctly and then always
 * said "No employees in this period" -- selectable, never usable.
 */

const { suite } = require('./harness');

const PREFIX = 'devCoachingTool_';

suite('fresh install: the centre average lookup does not throw', (t) => {
    const browser = t.installFakeBrowser();
    global.window.weeklyData = {};
    global.window.ytdData = {};
    global.weeklyData = {};
    global.ytdData = {};

    // A storage module that has never seen the store, which is what a fresh
    // install looks like: readStore returns undefined, not {}.
    global.window.DevCoachModules.storage = {
        readStore(key) {
            const raw = browser.store[PREFIX + key];
            return raw === undefined ? undefined : JSON.parse(raw);
        }
    };

    const es = t.loadModule('modules/executive-summary.module.js').executiveSummary;

    let threw = false;
    let result;
    try {
        result = es.getCenterAverageForWeek('2026-06-15|2026-06-21');
    } catch (error) {
        threw = true;
    }
    t.check('it does not throw', !threw);
    t.equal('and reports no average rather than crashing', result, null);

    // With a real average on file it still returns one.
    browser.store[PREFIX + 'callCenterAverages'] = JSON.stringify({
        '2026-06-15|2026-06-21': { adherence: 93, aht: 420 }
    });
    const withData = es.getCenterAverageForWeek('2026-06-15|2026-06-21');
    t.check('a stored average still comes back', !!withData);
    t.equal('mapped onto the employee key', withData.scheduleAdherence, 93);

    // And a week that simply has no average is still null.
    t.equal('a week with no average is null',
        es.getCenterAverageForWeek('2026-01-01|2026-01-07'), null);
});

suite('metric charts: the daily period offers its associates', (t) => {
    const browser = t.installFakeBrowser();
    const DAY = '2026-06-23|2026-06-23';

    global.window.weeklyData = {};
    global.window.ytdData = {};
    global.window.dailyData = {
        [DAY]: {
            metadata: { periodType: 'daily', startDate: '2026-06-23', endDate: '2026-06-23' },
            employees: [{ name: 'Ada Stretch' }, { name: 'Ben Ongoal' }]
        }
    };
    global.weeklyData = global.window.weeklyData;
    global.ytdData = global.window.ytdData;
    global.dailyData = global.window.dailyData;

    global.getTeamSelectionContext = () => ({ isFiltering: false, selectedSet: null });
    global.isAssociateIncludedByTeamFilter = () => true;
    global.window.getTeamSelectionContext = global.getTeamSelectionContext;
    global.window.isAssociateIncludedByTeamFilter = global.isAssociateIncludedByTeamFilter;

    let captured = null;
    global.window.DevCoachModules.associatePicker = {
        populateSelect(el, names, opts) { captured = { names: names || [], opts: opts || {} }; }
    };

    const els = { trendEmployeeSelect: { options: [], value: '' } };
    global.document.getElementById = (id) => els[id] || null;

    t.loadModule('modules/metrics-registry.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    const mt = t.loadModule('modules/metric-trends.module.js').metricTrends;

    mt.populateEmployeeDropdownForPeriod(DAY);

    t.check('the dropdown was populated', !!captured);
    if (!captured) return;

    t.check('it is not the "no employees" placeholder',
        captured.opts.placeholder !== 'No employees in this period');
    t.equal('both associates from the day are offered', captured.names.length, 2);
    t.check('by name', captured.names.indexOf('Ada Stretch') > -1);
    t.check('and the All Associates option travels with them',
        (captured.opts.extraOptions || []).some((o) => o.value === 'ALL'));
});
