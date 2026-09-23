'use strict';

/**
 * "vs prior" finds the period before, at every month end.
 *
 * The previous month's end was built by arithmetic, new Date(y, m - 2, d),
 * which overflows: Apr 30 became "Mar 30" and Mar 31 became Mar 3. No key
 * contained those dates, so a month only found its predecessor in January and
 * August, and the trend emails silently lost their comparison. A week in
 * progress looked for another week in progress, but the week before it is
 * stored as a finished week.
 */

const { suite } = require('./harness');

function load(t, weeklyData) {
    t.installFakeBrowser();
    global.window.DevCoachModules.storage = { loadWeeklyData: () => weeklyData, loadYtdData: () => ({}) };
    return t.loadModule('modules/executive-summary.module.js').executiveSummary
        || global.window.getPreviousPeriodData && { getPreviousPeriodData: global.window.getPreviousPeriodData };
}

const period = (start, end, periodType) => ({ metadata: { startDate: start, endDate: end, periodType }, employees: [] });

suite('previous period: a month finds the month before it', (t) => {
    const data = {
        '2026-02-01|2026-02-28': period('2026-02-01', '2026-02-28', 'month'),
        '2026-03-01|2026-03-31': period('2026-03-01', '2026-03-31', 'month'),
        '2026-04-01|2026-04-30': period('2026-04-01', '2026-04-30', 'month'),
        '2026-04-20|2026-04-26': period('2026-04-20', '2026-04-26', 'week')
    };
    const api = load(t, data);
    const prev = api.getPreviousPeriodData;
    t.equal('April finds March', prev('2026-04-01|2026-04-30', 'month'), '2026-03-01|2026-03-31');
    t.equal('March finds February', prev('2026-03-01|2026-03-31', 'month'), '2026-02-01|2026-02-28');
    t.equal('February has nothing before it here', prev('2026-02-01|2026-02-28', 'month'), null);
});

suite('previous period: a week in progress finds the finished week before it', (t) => {
    const data = {
        '2026-09-14|2026-09-20': period('2026-09-14', '2026-09-20', 'week'),
        '2026-09-21|2026-09-23': period('2026-09-21', '2026-09-23', 'week-in-progress')
    };
    const prev = load(t, data).getPreviousPeriodData;
    t.equal('the last full week is found', prev('2026-09-21|2026-09-23', 'week-in-progress'), '2026-09-14|2026-09-20');
    t.equal('and the first week on file has nothing before it', prev('2026-09-14|2026-09-20', 'week'), null);
});

suite('previous period: a gap is not bridged', (t) => {
    const data = {
        '2026-01-01|2026-01-31': period('2026-01-01', '2026-01-31', 'month'),
        '2026-04-01|2026-04-30': period('2026-04-01', '2026-04-30', 'month')
    };
    const prev = load(t, data).getPreviousPeriodData;
    t.equal('April is not compared with January', prev('2026-04-01|2026-04-30', 'month'), null);
});
