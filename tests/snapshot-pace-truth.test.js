'use strict';

/**
 * Scott, 2026-10-21, on the Snapshot and Pace pages: "I'm highly skeptical of
 * the way this looks. Why are all avg the same as their numbers?" and "How is
 * it not possible for Christi to raise her adherence by .8 points?"
 *
 * The Snapshot and the Year to date tab asked window.DevCoachModules.metrics
 * for their target, direction and format checks. Nothing ever registered that
 * module, so every check quietly did nothing: every cell read "Below Target",
 * AHT, ACW and transfers counted higher as better, numbers printed raw, and
 * Focus of the Day always named Schedule Adherence.
 *
 * His answers on 2026-10-22: the snapshot always covers the whole team (a one
 * person pick in Who made Team Avg an average of one), and Rel comes off the
 * shared snapshot (it posted each person's hours to the team chat, and graded
 * one period's hours against the year's allowance).
 *
 * Pace hid the number behind "Not achievable" whenever it needed better than
 * the best period so far. Christi needed 96.5% a week against a best of
 * 96.4%: a stretch to coach to, not an impossibility.
 */

const { suite } = require('./harness');

const KEY = '2026-10-01|2026-10-20';

function emp(name, values) {
    return Object.assign({ name: name, firstName: name.split(' ')[0], surveyTotal: 0 }, values);
}

function loadHelpers(t) {
    const env = t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    t.loadModule('modules/metric-trends.module.js');
    return env;
}

function loadSnapshot(t, options) {
    const { els } = loadHelpers(t);
    const weekly = {
        [KEY]: {
            metadata: { periodType: 'month-to-date', label: 'October 2026 to date (through Oct 20)' },
            employees: [
                emp('Jadyn Able', { totalCalls: 312, scheduleAdherence: 91.11, transfers: 5.5, transfersCount: 19,
                    aht: 312, acw: 55, overallSentiment: 91.9, positiveWord: 93.5, negativeWord: 85.7,
                    managingEmotions: 96.4, reliability: 17 }),
                emp('Angelina Baker', { totalCalls: 320, scheduleAdherence: 93.38, transfers: 11.56, transfersCount: 37,
                    aht: 730, acw: 193, overallSentiment: 92.8, positiveWord: 99.7, negativeWord: 85,
                    managingEmotions: 93.8, reliability: 4.63 }),
                emp('Casey Cole', { totalCalls: 300, scheduleAdherence: 95, transfers: 4, transfersCount: 12,
                    aht: 500, acw: 50, overallSentiment: 90, positiveWord: 90, negativeWord: 90,
                    managingEmotions: 97, reliability: 0 })
            ]
        }
    };
    const stored = {
        callCenterAverages: { [KEY]: { aht: 480, reliability: 5.91, holdTime: 12.86, lastUpdated: 'earlier' } }
    };
    global.window.DevCoachModules.storage = {
        loadWeeklyData: () => weekly,
        loadYtdData: () => ({}),
        loadDailyData: () => ({}),
        readStore: (k) => stored[k],
        saveWithSizeCheck: (k, v) => { stored[k] = v; return true; }
    };
    // Who narrows to one person unless the caller asks to ignore that pick.
    global.window.DevCoachModules.teamFilter = {
        getTeamSelectionContext: (opts) => (options.whoOnePerson && !(opts && opts.ignoreTeamScope))
            ? { isFiltering: true, selectedSet: new Set(['Jadyn Able']) }
            : { isFiltering: false, selectedSet: null },
        isAssociateIncludedByTeamFilter: (name, ctx) => !ctx.isFiltering || ctx.selectedSet.has(name)
    };
    els.snapCenterAvg_aht = { value: '487.33' };
    els.snapCenterAvg_transfers = { value: '6.79' };
    els.snapCenterAvg_scheduleAdherence = { value: '93.08' };
    els.snapCenterAvg_managingEmotions = { value: '95.26' };
    els.snapshotPeriodSelect = { value: KEY + '|weekly' };
    els.snapshotGraphicContainer = { innerHTML: '' };
    els.snapshotExportBtns = { style: {} };
    const snap = t.loadModule('modules/team-snapshot.module.js').teamSnapshot;
    return { snap, els, stored };
}

function cellOf(data, firstName, metricKey) {
    const row = data.rows.find((r) => r.name === firstName);
    return row && row.cells.find((c) => c.metricKey === metricKey);
}

suite('snapshot truth: cells are judged by the real target, direction and format', (t) => {
    const { snap } = loadSnapshot(t, { whoOnePerson: false });
    const data = snap.assembleSnapshotData(KEY, 'weekly');

    t.equal('96.4 managing emotions meets a 95 target', cellOf(data, 'Jadyn', 'managingEmotions').meetsTarget, true);
    t.equal('85.7 avoid negative words meets an 83 target', cellOf(data, 'Jadyn', 'negativeWord').meetsTarget, true);
    t.equal('91.11 adherence misses a 93 target', cellOf(data, 'Jadyn', 'scheduleAdherence').meetsTarget, false);
    t.equal('312s handle time meets the 426s target', cellOf(data, 'Jadyn', 'aht').meetsTarget, true);
    t.equal('calls have no target, so they are neither met nor missed', cellOf(data, 'Jadyn', 'totalCalls').meetsTarget, null);

    const xfer = cellOf(data, 'Angelina', 'transfers');
    t.equal('11.56% transfers is worse than a 6.79% center', xfer.aboveAvg, false);
    t.check('and its distance from center reads as bad', xfer.avgDelta < 0);
    const aht = cellOf(data, 'Jadyn', 'aht');
    t.equal('312s handle time beats a 487s center', aht.aboveAvg, true);
    t.check('by about 175 seconds', Math.round(aht.avgDelta) === 175);

    t.equal('adherence prints as a percent', cellOf(data, 'Jadyn', 'scheduleAdherence').displayValue, '91.1%');
    t.equal('handle time prints in seconds', cellOf(data, 'Jadyn', 'aht').displayValue, '312s');

    const focus = snap.determineFocusMetric(data);
    t.equal('Focus of the Day is the metric most people miss, not the first on the list', focus.metricKey, 'aht');
    t.equal('two of three miss it', focus.missCount + ' of ' + focus.totalCount, '2 of 3');
});

suite('snapshot truth: the whole team, every time, and no Rel column', (t) => {
    const { snap, els } = loadSnapshot(t, { whoOnePerson: true });
    const data = snap.assembleSnapshotData(KEY, 'weekly');
    t.equal('one person picked in Who still gives the whole team', data.rows.length, 3);
    t.check('no row carries reliability', data.rows.every((r) => r.cells.every((c) => c.metricKey !== 'reliability')));

    snap.generateSnapshot();
    const html = els.snapshotGraphicContainer.innerHTML;
    t.check('the picture has no Rel column', !/>Rel</.test(html));
    t.check('the picture names all three people', /Jadyn/.test(html) && /Angelina/.test(html) && /Casey/.test(html));
    t.check('a met target is shaded green', /background: #dcfce7; color: #166534;[^>]*>96\.4%/.test(html));
    t.check('the Calls cell is not shaded as a miss', !/background: #fee2e2; color: #991b1b;[^>]*>312</.test(html));
});

suite('snapshot truth: saving center averages keeps what the snapshot does not show', (t) => {
    const { snap, stored } = loadSnapshot(t, { whoOnePerson: false });
    snap.generateSnapshot();
    const saved = stored.callCenterAverages[KEY];
    t.equal('the typed handle time is saved', saved.aht, 487.33);
    t.equal('the stored reliability average survives', saved.reliability, 5.91);
    t.equal('the stored hold time average survives', saved.holdTime, 12.86);
});

suite('year to date tab: judged by the year target as printed', (t) => {
    loadHelpers(t);
    const dash = t.loadModule('modules/dashboard.module.js').dashboard;
    const result = dash.evaluateEmployee(emp('Pat Quinn', {
        scheduleAdherence: 92.96, aht: 430, managingEmotions: 96, transfers: 5
    }), 2026);
    const missed = result.worstMetrics.map((m) => m.key);
    t.check('92.96 adherence prints as 93% and meets the target', missed.indexOf('scheduleAdherence') === -1);
    t.check('430s handle time misses the 2026 target', missed.indexOf('aht') > -1);
    const pill = dash.formatMetricPill(result.worstMetrics.find((m) => m.key === 'aht'));
    t.check('the pill prints seconds, not a raw number', /430s/.test(pill) && /426s/.test(pill));
});

function christiData(metric) {
    return {
        weekInfo: { weeksCompleted: 42, weeksRemaining: 10, currentYear: 2026 },
        employees: [{ name: 'Christi Martinez', dataSource: 'YTD through Oct 18, 2026', metrics: { scheduleAdherence: metric } }]
    };
}

function rateMetric(overrides) {
    return Object.assign({
        currentAvg: 92.18, meetTarget: 93, exceedTarget: 95, isReverse: false, hasExceedBand: false,
        isCumulative: false, currentlyMeeting: false, currentlyExceeding: false,
        requiredToMeet: 96.54, requiredToExceed: null, meetAchievable: false, exceedAchievable: null,
        meetPossible: true, exceedPossible: null, bestSoFar: 96.38
    }, overrides);
}

suite('pace truth: a stretch shows its number and the best so far', (t) => {
    const { els } = loadHelpers(t);
    const futures = t.loadModule('modules/futures.module.js').futures;
    els.futuresTableContainer = { innerHTML: '' };

    futures.renderFuturesTable(christiData(rateMetric()), 'Christi Martinez', 'weekly');
    let html = els.futuresTableContainer.innerHTML;
    t.check('the needed average is shown', /96\.5%\/wk/.test(html));
    t.check('beside the best period so far', /best so far 96\.4%/i.test(html));
    t.check('it is not called "Not achievable"', !/Not achievable/i.test(html));
    t.check('the summary counts it as a stretch', /1 Stretch/.test(html));

    futures.renderFuturesTable(christiData(rateMetric({ requiredToMeet: 127.3, meetPossible: false, bestSoFar: 90 })), 'Christi Martinez', 'weekly');
    html = els.futuresTableContainer.innerHTML;
    t.check('over 100% is not possible, and says so', /Not possible/.test(html));
    t.check('the summary counts it as not possible', /1 Not possible/.test(html));
});

suite('pace truth: buildFuturesData carries whether a target is possible and the best so far', (t) => {
    loadHelpers(t);
    const YEAR = 2026;
    t.pinClock('2026-10-21');
    global.weeklyData = {
        '2026-10-05|2026-10-11': { metadata: { periodType: 'week', startDate: '2026-10-05', endDate: '2026-10-11' },
            employees: [emp('Christi Martinez', { scheduleAdherence: 96.38, totalCalls: 130 })] },
        '2026-10-12|2026-10-18': { metadata: { periodType: 'week', startDate: '2026-10-12', endDate: '2026-10-18' },
            employees: [emp('Christi Martinez', { scheduleAdherence: 90, totalCalls: 120 })] }
    };
    global.ytdData = {
        '2026-01-01|2026-10-18': { metadata: { periodType: 'ytd', startDate: '2026-01-01', endDate: '2026-10-18' },
            employees: [emp('Christi Martinez', { scheduleAdherence: 92.18, totalCalls: 5315, surveyTotal: 32 })] }
    };
    global.window.DevCoachModules.storage = {
        loadWeeklyData: () => global.weeklyData,
        loadYtdData: () => global.ytdData,
        loadDailyData: () => ({})
    };
    const futures = t.loadModule('modules/futures.module.js').futures;
    global.window.getWeeklyKeysSorted = () => Object.keys(global.weeklyData).sort();
    global.window.getTeamMembersForWeek = () => [];
    const data = futures.buildFuturesData();
    const m = data.employees[0].metrics.scheduleAdherence;
    t.check('the year needs more than the best week (' + (m.requiredToMeet && m.requiredToMeet.toFixed(2)) + ')', m.requiredToMeet > 96.38);
    t.equal('so it is out of reach', m.meetAchievable, false);
    t.equal('but possible', m.meetPossible, true);
    t.equal('and the best so far comes along', m.bestSoFar, 96.38);
    t.equal('for ' + YEAR, data.weekInfo.currentYear, YEAR);
});
