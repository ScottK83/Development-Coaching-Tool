'use strict';

/**
 * A team reliability figure is hours PER PERSON.
 *
 * Reliability accrues across periods for one associate, so summing there is
 * right. Summing across PEOPLE gives a total, and both of these surfaces then
 * compared that total against the per-person 18-hour budget:
 *
 *   Executive Summary  a card labelled "Avg Reliability", coloured against the
 *                      target. Ten associates on 4 hours each read 40.0 hrs in
 *                      red where the truth is 4.0 in green. The adherence card
 *                      beside it was correctly weighted, so two cards in the
 *                      same row were built differently.
 *
 *   Team trend prompt  "IMPROVEMENT AREAS: Reliability 40.0 hrs vs target 18.0
 *                      hrs". Listing Reliability as an improvement area for
 *                      every team that has ever missed an hour, because with a
 *                      sum on one side and a per-person budget on the other it
 *                      could not do anything else.
 *
 * calculateCenterAveragesFromEmployees already divided by the head count it
 * counted. These now match it.
 *
 * The behaviour baseline cannot catch either: neither path is a recorded entry.
 */

const { suite } = require('./harness');

const PREFIX = 'devCoachingTool_';
const KEY = '2026-08-17|2026-08-23';

// Ten associates, four hours missed each. 40 hours across the team, 4 per
// person, comfortably inside an 18-hour budget.
function team(hoursEach, size) {
    const people = [];
    for (let i = 0; i < (size || 10); i++) {
        people.push({
            name: 'P' + i, totalCalls: 200,
            surveyTotal: 40, repSurveyTotal: 40, fcrSurveyTotal: 40,
            scheduleAdherence: 95, cxRepOverall: 85, fcr: 78, overallExperience: 80,
            overallSentiment: 90, transfers: 4, aht: 400,
            reliability: hoursEach
        });
    }
    return people;
}

function load(t, people) {
    const browser = t.installFakeBrowser();
    const week = {
        [KEY]: {
            metadata: { periodType: 'week', startDate: '2026-08-17', endDate: '2026-08-23' },
            employees: people
        }
    };
    global.window.weeklyData = week;
    global.window.ytdData = {};
    global.weeklyData = week;
    global.ytdData = {};
    browser.store[PREFIX + 'weeklyData'] = JSON.stringify(week);
    browser.store[PREFIX + 'myTeamMembers'] = JSON.stringify({ [KEY]: people.map((p) => p.name) });
    browser.store[PREFIX + 'activeTeamMember'] = '__all__';

    global.window.DevCoachModules.storage = {
        readStore(key) {
            const raw = browser.store[PREFIX + key];
            return raw === undefined ? undefined : JSON.parse(raw);
        },
        loadWeeklyData() { return week; },
        loadTeamMembers() { return JSON.parse(browser.store[PREFIX + 'myTeamMembers']); }
    };

    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;

    // script.js declares these at top level and both modules read them as bare
    // globals. Stubbed to pass everyone through, because what is under test here
    // is the arithmetic, not who is in scope.
    global.getTeamSelectionContext = function () {
        return { weekKey: KEY, selectedMembers: [], selectedSet: null, isFiltering: false };
    };
    global.isAssociateIncludedByTeamFilter = function () { return true; };
    global.window.getTeamSelectionContext = global.getTeamSelectionContext;
    global.window.isAssociateIncludedByTeamFilter = global.isAssociateIncludedByTeamFilter;

    // executive-summary reads its metric list through metric-trends'
    // getMetricOrder, so without it reliability is not in the set at all and the
    // sum is never initialised.
    const mt = t.loadModule('modules/metric-trends.module.js').metricTrends;

    return { week, mt };
}

suite('team figures: Executive Summary reports reliability per person', (t) => {
    const people = team(4);
    load(t, people);
    const es = t.loadModule('modules/executive-summary.module.js').executiveSummary;

    const metrics = es.buildExecutiveSummaryAggregateMetrics([KEY]);
    t.equal('all ten are counted', metrics.totalEmployees.size, 10);
    t.equal('and the raw hours across the team are still forty',
        metrics.cumulativeSums.reliability, 40);

    const averages = es.calculateExecutiveSummaryAverages(metrics);
    t.equal('but the card reports four, which is per person', averages.reliability, 4);
    t.check('and four is inside the eighteen hour budget', averages.reliability <= 18);

    // The card beside it was always right; they must agree about how they were
    // built, which is the half that made the original wrong figure believable.
    t.equal('adherence is still weighted, not summed', averages.scheduleAdherence, 95);
});

suite('team figures: the trend prompt compares like with like', (t) => {
    const people = team(4);
    const { mt } = load(t, people);
    if (typeof mt.collectTeamTrendMetrics !== 'function') {
        t.check('collectTeamTrendMetrics is reachable', false);
        return;
    }

    const rows = mt.collectTeamTrendMetrics(global.weeklyData[KEY]) || [];
    const rel = rows.find((r) => r.metricKey === 'reliability');
    t.check('reliability is in the prompt', !!rel);
    if (!rel) return;

    t.equal('the figure is per person', rel.employeeValue, 4);
    t.equal('measured against the per-person budget', rel.target, 18);
    t.check('so a team well inside budget MEETS it', rel.meetsTarget === true);
    t.equal('with no gap to close', rel.gapFromTarget, 0);
});

suite('team figures: a team genuinely over budget still fails', (t) => {
    // The other half. Averaging must not turn a real problem into a pass.
    const people = team(22);
    const { mt } = load(t, people);
    const rows = mt.collectTeamTrendMetrics(global.weeklyData[KEY]) || [];
    const rel = rows.find((r) => r.metricKey === 'reliability');

    t.equal('twenty-two hours each is twenty-two per person', rel.employeeValue, 22);
    t.check('which does not meet an eighteen hour budget', rel.meetsTarget === false);
    t.equal('and the gap is four hours, not four hundred', rel.gapFromTarget, 4);
});
