'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * Many hats review, Phase 5: Scott's own pages (audit/2026-11-03-many-hats.md,
 * S2, S3, S5 to S10). Names here are made up.
 */

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

const REGISTRY = {
    aht: { key: 'aht', label: 'Average Handle Time', unit: 'sec', isReverse: true, target: { type: 'max', value: 426 } },
    scheduleAdherence: { key: 'scheduleAdherence', label: 'Schedule Adherence', unit: '%', target: { type: 'min', value: 93 } },
    overallSentiment: { key: 'overallSentiment', label: 'Overall Sentiment', unit: '%', target: { type: 'min', value: 88 } },
    cxRepOverall: { key: 'cxRepOverall', label: 'Rep Satisfaction', unit: '%', target: { type: 'min', value: 82 } },
    reliability: { key: 'reliability', label: 'Reliability', unit: 'hrs', isReverse: true, target: { type: 'max', value: 17.9 } }
};

suite('many hats S2: Intelligence reads the year from the YTD upload', (t) => {
    t.installFakeBrowser();
    global.window.METRICS_REGISTRY = REGISTRY;
    const ytd = {
        '2026-01-01|2026-09-20': { metadata: { periodType: 'ytd', endDate: '2026-09-20' }, employees: [
            { name: 'Ann Cole', totalCalls: 30, surveyTotal: 30, scheduleAdherence: 90, reliability: 2 }
        ] },
        '2026-01-01|2026-11-01': { metadata: { periodType: 'ytd', endDate: '2026-11-01' }, employees: [
            { name: 'Ann Cole', totalCalls: 3000, surveyTotal: 40, scheduleAdherence: 95, aht: 400, cxRepOverall: 80, reliability: 3 },
            { name: 'Ben Dorr', totalCalls: 1000, surveyTotal: 10, scheduleAdherence: 91, aht: 480, cxRepOverall: 90, reliability: 5 }
        ] },
        '2025-01-01|2025-12-28': { metadata: { periodType: 'ytd', endDate: '2025-12-28' }, employees: [
            { name: 'Ann Cole', totalCalls: 4000, surveyTotal: 50, scheduleAdherence: 99 }
        ] }
    };
    global.window.DevCoachModules.storage = { loadYtdData: () => ytd, loadWeeklyData: () => ({}) };
    global.window.DevCoachModules.metricsRegistry = { getMetricOrder: () => Object.keys(REGISTRY).map(key => ({ key })) };
    global.window.getMetricOrder = () => Object.keys(REGISTRY).map(key => ({ key }));
    const es = t.loadModule('modules/executive-summary.module.js').executiveSummary;

    const found = es.findYtdForYear(2026);
    t.equal('the newest file of the year is the one read', found && found.endDate, '2026-11-01');
    t.equal('and never last year\'s', es.findYtdForYear(2027), null);

    const metrics = es.buildExecutiveSummaryYtdMetrics(found, 2026, '');
    const averages = es.calculateExecutiveSummaryAverages(metrics);
    t.equal('the team is the people in the file', metrics.totalEmployees.size, 2);
    t.equal('reliability is per person, from the file', averages.reliability, 4);
    t.check('adherence is weighted by volume, not a plain mean of 93',
        Math.abs(averages.scheduleAdherence - 94) < 0.01);
    t.check('rep sat is weighted by surveys: (80x40 + 90x10) / 50 = 82',
        Math.abs(averages.cxRepOverall - 82) < 0.01);

    const one = es.buildExecutiveSummaryYtdMetrics(found, 2026, 'Ben Dorr');
    const cards = es.buildExecutiveSummaryCards(one, es.calculateExecutiveSummaryAverages(one));
    t.check('one associate gets no "Total Employees 1" tile', !cards.some(c => /Total|Team members/.test(c.label)));
    t.check('and no "Avg Average Handle Time"', !cards.some(c => /^Avg /.test(c.label)));
    const team = es.buildExecutiveSummaryCards(metrics, averages);
    t.check('the team view keeps a head count', team.some(c => c.label === 'Team members' && c.value === 2));
    t.check('"Total Data Periods" is gone', !team.some(c => /Data Periods/.test(c.label)));
});

suite('many hats S2: a month card says when the newest month is old', (t) => {
    const script = read('script.js');
    t.check('the tracker notes a month that is not uploaded yet', /function trackerStaleMonthNote\(/.test(script));
    t.check('and its moves are in words', /function formatTrackerMove\(/.test(script) && /moveInWords\?\.\(item\.metricKey, item\.currentValue, item\.previousValue\)/.test(script));
});

suite('many hats S3: Year to date uses the Today page split', (t) => {
    t.installFakeBrowser();
    global.window.METRICS_REGISTRY = REGISTRY;
    const dash = t.loadModule('modules/dashboard.module.js').dashboard;

    const doingGood = dash.evaluateEmployee({ name: 'Ann Cole', surveyTotal: 20, aht: 400, scheduleAdherence: 95, overallSentiment: 90, cxRepOverall: 70 }, 2026);
    t.equal('three of four on the scorecard is Doing Good', doingGood.status.label, 'Doing Good');
    t.check('even though not every target is met', doingGood.meetsAll === false);

    const all = dash.evaluateEmployee({ name: 'Ben Dorr', surveyTotal: 20, aht: 400, scheduleAdherence: 95, overallSentiment: 90, cxRepOverall: 90 }, 2026);
    t.equal('all four is Crushing It', all.status.label, 'Crushing It');

    const support = dash.evaluateEmployee({ name: 'Cy Ames', surveyTotal: 20, aht: 500, scheduleAdherence: 90, overallSentiment: 80, cxRepOverall: 90 }, 2026);
    t.equal('one of four is Needs Support', support.status.label, 'Needs Support');

    const noSurveys = dash.evaluateEmployee({ name: 'Di Moss', surveyTotal: 0, aht: 400, scheduleAdherence: 95, overallSentiment: 80 }, 2026);
    t.equal('no surveys is judged on three, not on a 0%', noSurveys.status.measured, 3);

    global.window.DevCoachModules.teamScope = { getMyTeamRoster: () => ['Ann Cole', 'Ben Dorr', 'Eve Hart'] };
    const missing = dash.missingFromFile([{ name: 'Ann Cole' }, { name: 'Ben Dorr' }], { isFiltering: false });
    t.equal('the roster member with no row is named', missing.join(','), 'Eve Hart');

    const src = read('modules/dashboard.module.js');
    t.check('"Meeting All Targets" is no longer the headline', src.indexOf("'Meeting All Targets'") === -1 && src.indexOf('>Meeting All Targets<') === -1);
    t.check('nor "Need Coaching"', src.indexOf('Need Coaching</div>') === -1);
});

suite('many hats S5: no PTO balance with nothing behind it', (t) => {
    const pto = read('modules/pto.module.js');
    t.check('the balance says whether anything is on file', /hasData: hasPtoDataForYear\(data\)/.test(pto));
    t.check('and the panel says "Not on file" instead of 120h', /'Not on file'/.test(pto));
    const rel = read('modules/reliability.module.js');
    t.check('the attendance balance is withheld with no data', /data\.takenHours == null && data\.reportedRemaining == null && !hasYearRows\) return null;/.test(rel));
    t.check('the empty page gives the real reason', rel.indexOf('No attendance files are loaded yet.') > -1);
    t.check('not the old wrong one', rel.indexOf("'No checked team members found in Settings for the current period.'") === -1);
});

suite('many hats S7: the gap to the next level is in words', (t) => {
    t.installFakeBrowser();
    const oo = t.loadModule('modules/on-off-tracker.module.js').onOffTracker;
    const aht = { type: 'max', score2: { max: 520 }, score3: { max: 500 } };
    t.equal('handle time in seconds, no sign', oo.buildGapToNextText(1, 648, aht, 'aht'),
        '128 seconds to the next level, 148 seconds to the top level');
    const adh = { type: 'min', score2: { min: 93 }, score3: { min: 95 } };
    t.equal('a rate in points', oo.buildGapToNextText(2, 93.8, adh, 'scheduleAdherence'), '1.2 points to the top level');
    t.equal('the top level says nothing', oo.buildGapToNextText(3, 96, adh, 'scheduleAdherence'), '');
    t.check('the intro is plain', read('index.html').indexOf('Excel mirror KPI logic') === -1);
});

suite('many hats S8: quarterly says above or under the goal, and hours are not a race', (t) => {
    const qr = read('modules/quarter-review.module.js');
    t.check('no "inside the" goal for a metric that is not hours',
        !/' was inside the '|', inside the ' \+ goal|it inside the ' \+ goal/.test(qr));
    t.check('the side is chosen by direction', /function _metSide\(m\)/.test(qr));
    const ui = read('modules/quarter-review-ui.module.js');
    t.check('reliability has no place movement', /var hours = row\.registry === 'reliability';/.test(ui)
        && /hours \? '<span class="text-faint">-<\/span>' : _placingMove\(row\.climbed\)/.test(ui));
});

suite('many hats S9: who did not make it is ranked and formatted like the table', (t) => {
    t.installFakeBrowser();
    global.window.METRICS_REGISTRY = REGISTRY;
    const rankings = [
        { name: 'Ann Cole', surveyTotal: 1, metricRanks: { associateOverall: 12 }, values: { associateOverall: 0 } },
        { name: 'Ben Dorr', surveyTotal: 20, metricRanks: { associateOverall: 6 }, values: { associateOverall: 78 } }
    ];
    const data = () => ({ rankings, totalEmployees: 2, teamMembers: new Set(['Ann Cole', 'Ben Dorr']) });
    global.window.DevCoachModules.centerRanking = { buildCenterRankings: data, buildRankingsForPeriod: data };
    const celebrations = t.loadModule('modules/celebrations.module.js').celebrations;
    const src = read('modules/celebrations.module.js');
    t.check('a survey rank under three surveys is skipped', /surveys < 3\) return;/.test(src));
    t.check('and the value is formatted', /formatMetricValue\(info\.best\.metricKey, info\.best\.value\) \+ ' is still short of target/.test(src));
    const text = celebrations.describeNoCelebration({ name: 'Ben Dorr', reason: 'belowTarget', best: { rank: 6, label: 'Rep Satisfaction', value: 78, metricKey: 'associateOverall' } });
    t.check('the number carries its % sign', text.indexOf('78% is still short of target') > -1);
});

suite('many hats S10: the Snapshot opens on last week', (t) => {
    t.installFakeBrowser();
    global.window.DevCoachModules.periodIndex = { periodLabel: (k) => k };
    const snap = t.loadModule('modules/team-snapshot.module.js').teamSnapshot;
    const periods = [
        { key: '2026-11-02|2026-11-08', type: 'week', source: 'weekly' },
        { key: '2026-10-26|2026-11-01', type: 'week', source: 'weekly' },
        { key: '2026-01-01|2026-11-01', type: 'ytd', source: 'ytd' }
    ];
    t.equal('the newest finished week', snap.defaultPeriodValue(periods, '2026-11-04'), '2026-10-26|2026-11-01|weekly');
    t.equal('nothing to pick is nothing', snap.defaultPeriodValue([], '2026-11-04'), '');
    const src = read('modules/team-snapshot.module.js');
    t.check('the center boxes are rounded like the table', /String\(Math\.round\(num\)\) : String\(Math\.round\(num \* 10\) \/ 10\)/.test(src));
});
