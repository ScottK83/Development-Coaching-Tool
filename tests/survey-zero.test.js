'use strict';

const { suite } = require('./harness');

/**
 * A survey metric nobody answered is not a score of nought.
 *
 * Rep satisfaction arrives as the number 0 in two completely different weeks:
 * the week four customers were asked and all four were unhappy, and the week
 * nobody was asked at all. Downstream they used to look identical, and the
 * second one was read as the first. That got the week wrong twice over:
 *
 *   - "Rep Satisfaction at 0.0%" was printed as the thing to work on, to
 *     somebody no customer had been surveyed about;
 *   - the detractor rule then suppressed the other survey metrics from what it
 *     believed was the same unhappy sample, so a genuine FCR win went unsaid;
 *   - and in the standings block a 0 sorts as the worst week in the building,
 *     which is a placing off nothing at all.
 *
 * The rule is the one Scott gave: only speak about rep satisfaction if a survey
 * came back. If not, say nothing — not a win, not an opportunity, not a placing,
 * and never a zero. The response count travels with the rate to decide it, per
 * metric, the same way period-compare weights them.
 */

const WEEK_KEY = '2026-08-17|2026-08-21';
const PREV_KEY = '2026-08-10|2026-08-14';

// Rep sat and FCR both read 0. Whether that is four unhappy customers or an
// empty column is decided entirely by the counts on the employee row.
const METRICS_WITH_ZERO_SURVEYS = [
    { metricKey: 'scheduleAdherence', label: 'Schedule Adherence', employeeValue: 95.1, target: 93, targetType: 'min', classification: 'Exceeding Expectation', meetsTarget: true, gapFromTarget: 0 },
    { metricKey: 'aht', label: 'Average Handle Time', employeeValue: 415, target: 426, targetType: 'max', classification: 'On Track', meetsTarget: true, gapFromTarget: 0 },
    { metricKey: 'cxRepOverall', label: 'Rep Satisfaction', employeeValue: 0, target: 82, targetType: 'min', classification: 'Needs Focus', meetsTarget: false, gapFromTarget: 82 },
    { metricKey: 'fcr', label: 'First Call Resolution', employeeValue: 0, target: 73, targetType: 'min', classification: 'Needs Focus', meetsTarget: false, gapFromTarget: 73 }
];

const REGISTRY = {
    scheduleAdherence: { label: 'Schedule Adherence', unit: '%', isReverse: false, target: { type: 'min', value: 93 } },
    aht: { label: 'Average Handle Time', unit: 'sec', isReverse: true, target: { type: 'max', value: 426 } },
    cxRepOverall: { label: 'Rep Satisfaction', unit: '%', isReverse: false, target: { type: 'min', value: 82 } },
    fcr: { label: 'First Call Resolution', unit: '%', isReverse: false, target: { type: 'min', value: 73 } }
};

function loadPulse(t, empOverrides, metrics) {
    t.installFakeBrowser();
    const emp = Object.assign({
        name: 'Christi Reyes',
        totalCalls: 250,
        surveyTotal: 0,
        cxRepOverall: 0,
        fcr: 0,
        scheduleAdherence: 95.1,
        aht: 415
    }, empOverrides || {});

    global.weeklyData = {
        [PREV_KEY]: {
            metadata: { periodType: 'week', startDate: '2026-08-10', endDate: '2026-08-14' },
            employees: [Object.assign({}, emp, { aht: 440 })]
        },
        [WEEK_KEY]: {
            metadata: { periodType: 'week', startDate: '2026-08-17', endDate: '2026-08-21' },
            employees: [emp]
        }
    };
    global.ytdData = {};
    global.dailyData = {};
    global.METRICS_REGISTRY = REGISTRY;
    global.window.METRICS_REGISTRY = REGISTRY;
    global.isReverseMetric = key => Boolean(REGISTRY[key] && REGISTRY[key].isReverse);
    global.metricDelta = (key, latest, base) => (REGISTRY[key] && REGISTRY[key].isReverse ? base - latest : latest - base);
    global.formatDateMMDDYYYY = (s) => {
        const [year, month, day] = String(s || '').split('-');
        return year && month && day ? `${month}/${day}/${year}` : '';
    };
    global.window.analyzeTrendMetrics = () => ({ allMetrics: metrics || METRICS_WITH_ZERO_SURVEYS });
    return t.loadModule('modules/morning-pulse.module.js').morningPulse;
}

// The pools are random, so one draw proves nothing. Draw enough that a banned
// line would have to show up if it were still reachable at all.
async function draw(pulse, times) {
    const out = [];
    for (let i = 0; i < times; i++) {
        out.push(await pulse.generateMondayKickoffMessage('Christi Reyes', WEEK_KEY, PREV_KEY));
    }
    return out;
}

suite('survey zero: nobody was asked, so nothing is said', async (t) => {
    const drawn = await draw(loadPulse(t), 120);

    t.check('a message was still written', drawn[0] && drawn[0].length > 0);
    t.equal('rep satisfaction is never named',
        drawn.filter(m => m.indexOf('Rep Satisfaction') > -1).length, 0);
    t.equal('and never printed as a zero',
        drawn.filter(m => /Rep Satisfaction at 0/.test(m)).length, 0);

    // The same empty sample stands behind FCR, so it goes with it rather than
    // being coached against on its own.
    t.equal('the other empty survey metric goes too',
        drawn.filter(m => m.indexOf('First Call Resolution') > -1).length, 0);

    // What is left is measured off calls she actually took, and still gets said.
    t.check('the metrics she was really measured on survive',
        drawn.some(m => m.indexOf('Schedule Adherence') > -1 || m.indexOf('Average Handle Time') > -1));
});

suite('survey zero: a real zero is still a real zero', async (t) => {
    // Four responses back, all of them detractors. That is a week worth talking
    // about and the gate must not swallow it.
    const drawn = await draw(loadPulse(t, { surveyTotal: 4, repSurveyTotal: 4, fcrSurveyTotal: 4 }), 60);

    t.check('rep satisfaction is coached against', drawn.some(m => m.indexOf('Rep Satisfaction') > -1));
});

suite('survey zero: each rate is judged by its own response count', async (t) => {
    /*
     * The counts are per metric, not per row. A week can carry five Overall
     * Experience responses and no rep-sat responses at all, and the parser keeps
     * the two columns apart precisely so this case can be told apart. Reading
     * the row-level total for both would put rep satisfaction back on the
     * message off somebody else's survey.
     */
    const drawn = await draw(loadPulse(t, { surveyTotal: 5, repSurveyTotal: 0, fcrSurveyTotal: 5 }), 120);

    t.equal('rep satisfaction has no responses of its own and stays out',
        drawn.filter(m => m.indexOf('Rep Satisfaction') > -1).length, 0);
    t.check('while the rate that does have them is spoken about',
        drawn.some(m => m.indexOf('First Call Resolution') > -1));

    // An absent column is not a zero. When the export never carried the
    // per-rate counts, the row total answers for them, exactly as before.
    const noOwnCounts = await draw(loadPulse(t, { surveyTotal: 5 }), 60);
    t.check('a missing count column falls back to the row total',
        noOwnCounts.some(m => m.indexOf('Rep Satisfaction') > -1));
});

/* ── The standings block ── */

function peerRow(i) {
    return {
        name: 'Peer ' + String(i).padStart(2, '0'),
        totalCalls: 240,
        surveyTotal: 40,
        reliability: 4 + i * 0.5,
        metricRanks: {},
        values: {
            aht: 401 + i * 2,
            adherence: 96 - i * 0.25,
            sentiment: 95 - i * 0.2,
            associateOverall: 92 - i * 0.3
        },
        extraValues: { fcr: 85 - i * 0.4, overallExperience: 88 - i * 0.35 }
    };
}

function loadStandings(t, danaOverrides) {
    t.installFakeBrowser();
    global.weeklyData = {
        [WEEK_KEY]: {
            metadata: { periodType: 'week', startDate: '2026-08-17', endDate: '2026-08-21' },
            employees: [{ name: 'Dana Reed', totalCalls: 250, surveyTotal: 0, aht: 422, scheduleAdherence: 93.9 }]
        }
    };
    global.ytdData = {};
    global.dailyData = {};

    const registry = t.loadModule('modules/metrics-registry.module.js');
    global.isReverseMetric = registry.metricsRegistryHelpers.isReverseMetric;
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.formatDateMMDDYYYY = (s) => {
        const [year, month, day] = String(s || '').split('-');
        return year && month && day ? `${month}/${day}/${year}` : '';
    };
    global.window.analyzeTrendMetrics = () => ({ allMetrics: [] });

    t.loadModule('modules/rank-projection.module.js');

    const rows = [];
    for (let i = 0; i < 29; i++) rows.push(peerRow(i));
    rows.push(Object.assign({
        name: 'Dana Reed',
        totalCalls: 250,
        surveyTotal: 0,
        reliability: 9,
        metricRanks: {},
        // The value an empty survey column arrives as, and the one that sorts
        // to the bottom of a field of thirty if nothing stops it.
        values: { aht: 422, adherence: 93.9, sentiment: 90.1, associateOverall: 0 },
        extraValues: { fcr: 0, overallExperience: 0 }
    }, danaOverrides || {}));

    const teamNames = new Set(['Dana Reed'].concat(
        [2, 6, 10, 15, 19, 23, 27].map(i => 'Peer ' + String(i).padStart(2, '0'))
    ));
    global.window.DevCoachModules.centerRanking = {
        buildRankingsForPeriod: () => ({
            rankings: rows, totalEmployees: rows.length,
            source: WEEK_KEY, periodKey: WEEK_KEY, teamMembers: teamNames
        })
    };
    return t.loadModule('modules/morning-pulse.module.js').morningPulse;
}

suite('survey zero: no placing off a survey nobody answered', (t) => {
    const block = loadStandings(t).buildStandingsBlock('Dana Reed', WEEK_KEY);

    t.check('the block was still written', block.indexOf('Where you stood') > -1);
    t.check('rep satisfaction is absent', block.indexOf('Rep Satisfaction') === -1);
    t.check('and nobody is told they finished last at it', block.indexOf('30th of 30') === -1);

    // The pinned slot is what makes this load bearing: without the gate, rep
    // satisfaction is now guaranteed a line, so a 0 would print every week
    // rather than only when it happened to win the sort.
    t.check('the slot goes back to a metric that was measured',
        block.indexOf('Overall Sentiment') > -1 || block.indexOf('Schedule Adherence') > -1);

    // isProjectable lets an unknown count through on purpose, so a row with no
    // survey column at all must be stopped here rather than there.
    const noColumn = loadStandings(t, {
        surveyTotal: undefined,
        values: { aht: 422, adherence: 93.9, sentiment: 90.1, associateOverall: 0 }
    }).buildStandingsBlock('Dana Reed', WEEK_KEY);
    t.check('an unknown survey count is not treated as a survey either',
        noColumn.indexOf('Rep Satisfaction') === -1);

    // And a week that really was surveyed still gets its placing.
    const surveyed = loadStandings(t, {
        surveyTotal: 12,
        values: { aht: 422, adherence: 93.9, sentiment: 90.1, associateOverall: 88 }
    }).buildStandingsBlock('Dana Reed', WEEK_KEY);
    t.check('a surveyed week is placed as before', surveyed.indexOf('Rep Satisfaction') > -1);
});

suite('survey zero: a substituted number gets no placing under a borrowed label', (t) => {
    /*
     * When rep sat comes back blank or zero the scorer substitutes Overall
     * Experience and marks the row. Center ranking flags that for the manager
     * with an orange OE beside the cell; this block cannot flag it, because a
     * placing off a substituted row is wrong twice over. It answers a different
     * question from the one the label asks, and it answers it against a column
     * where some rows are rep sat and some are Overall Experience, which is not
     * a field anybody actually finished in.
     *
     * Dropped rather than relabelled, and the pinned slot goes back to a metric
     * that was measured.
     */
    const substituted = loadStandings(t, {
        surveyTotal: 12,
        associateOverallSource: 'overallExperience',
        values: { aht: 422, adherence: 93.9, sentiment: 90.1, associateOverall: 88 }
    }).buildStandingsBlock('Dana Reed', WEEK_KEY);

    t.check('the block is still written', substituted.indexOf('Where you stood') > -1);
    t.check('no rep satisfaction bullet', substituted.indexOf('Rep Satisfaction') === -1);
    t.check('and it is not relabelled either', substituted.indexOf('Overall Experience') === -1);
    t.check('the slot goes to a metric that was measured',
        substituted.indexOf('Overall Sentiment') > -1 || substituted.indexOf('Schedule Adherence') > -1);

    // The identical row with the substitution flag cleared is placed as normal,
    // so this is the flag doing the work rather than the numbers.
    const genuine = loadStandings(t, {
        surveyTotal: 12,
        associateOverallSource: 'cxRepOverall',
        values: { aht: 422, adherence: 93.9, sentiment: 90.1, associateOverall: 88 }
    }).buildStandingsBlock('Dana Reed', WEEK_KEY);
    t.check('a real rep sat figure is placed', genuine.indexOf('Rep Satisfaction: 15th of 30') > -1);

    // An older row that predates the flag carries no source at all, and must
    // not be read as a substitution and silently dropped.
    const unmarked = loadStandings(t, {
        surveyTotal: 12,
        values: { aht: 422, adherence: 93.9, sentiment: 90.1, associateOverall: 88 }
    }).buildStandingsBlock('Dana Reed', WEEK_KEY);
    t.check('an unmarked row is placed as before', unmarked.indexOf('Rep Satisfaction') > -1);
});
