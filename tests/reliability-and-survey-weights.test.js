'use strict';

/**
 * Two ways team and coaching figures went wrong.
 *
 * Reliability is the year's running hours missed per person. The coaching
 * email graded one week's hours against the year's budget, and team figures
 * added everyone's hours up and graded the sum against that per-person budget.
 *
 * Survey metrics weigh by the responses to that question. Weighting by
 * surveyTotal let someone with Overall Experience responses and no rep-sat
 * ones, who arrives at 0% rep sat, drag the team figure down at full volume.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

suite('team snapshot: survey metrics weigh by their own responses', (t) => {
    t.installFakeBrowser();
    global.window.METRICS_REGISTRY = { cxRepOverall: { key: 'cxRepOverall', unit: '%' } };
    t.loadModule('modules/metrics-registry.module.js');
    const api = t.loadModule('modules/team-snapshot.module.js').teamSnapshot;

    const rows = [
        // 20 rep-sat responses at 90%.
        { name: 'A', totalCalls: 100, surveyTotal: 20, employee: { surveyTotal: 20, repSurveyTotal: 20 },
          cells: [{ metricKey: 'cxRepOverall', value: 90, hasValue: true }] },
        // 30 surveys, none of them rep sat, so the row arrives at 0%.
        { name: 'B', totalCalls: 100, surveyTotal: 30, employee: { surveyTotal: 30, repSurveyTotal: 0 },
          cells: [{ metricKey: 'cxRepOverall', value: 0, hasValue: true }] }
    ];
    t.equal('the team rep sat is the answered responses only', api.computeTeamMetricValue(rows, 'cxRepOverall'), 90);
});

suite('coaching email: reliability is the year total, not the week', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'modules/coaching-email.module.js'), 'utf8').replace(/\r\n/g, '\n');
    const fn = src.slice(src.indexOf('function resolveReliabilityYearTotal'), src.indexOf('function buildCoachingDisplayMetricData'));
    t.check('it reads the year-to-date upload', fn.indexOf('latestYtdReliability') > -1);
    t.check('as of the coaching week, not the newest file', fn.indexOf('asOfMonth') > -1);
    t.equal('both the display and the prompt use it',
        (src.match(/const value = coachingMetricValue\(employeeRecord, key\);/g) || []).length, 2);
});

suite('team figures: reliability is hours per person everywhere a team is summarised', (t) => {
    const trends = fs.readFileSync(path.join(ROOT, 'modules/metric-trends.module.js'), 'utf8').replace(/\r\n/g, '\n');
    const agg = trends.slice(trends.indexOf('function buildTeamTrendAggregateEmployee'));
    t.check('the team trend aggregate divides by people', /aggregate\[key\] = sum \/ people/.test(agg.slice(0, 4000)));

    const matchup = fs.readFileSync(path.join(ROOT, 'modules/matchup.module.js'), 'utf8').replace(/\r\n/g, '\n');
    t.check('the matchup team average divides by people', /reduce\(function \(a, b\) \{ return a \+ b; \}, 0\) \/ sumVals\.length/.test(matchup));
});
