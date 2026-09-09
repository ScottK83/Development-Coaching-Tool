'use strict';

/**
 * A survey metric is weighted by its own response count.
 *
 * The three survey questions are answered independently: a customer can answer
 * the Overall Experience question and skip the rep-sat one. The export carries
 * a separate count for each -- repSurveyTotal, fcrSurveyTotal, surveyTotal --
 * and data-parsing has read all three for a long time.
 *
 * Five aggregators weighted all three by surveyTotal, the Overall Experience
 * count. That is wrong twice. A rep-sat figure sits behind a denominator it does
 * not belong to; and worse, a period where nobody answered the rep-sat question
 * cannot be told from one that scored 0%, because both arrive as 0 with a
 * positive Overall Experience weight.
 *
 * Measured, before the fix: an associate who answered only an Overall
 * Experience survey one week, then scored 100% rep-sat across 40 responses the
 * next, came out of buildEmployeeAggregateForPeriod at 0% -- the entire weight
 * sat on the week with no rep-sat responses in it. period-compare, which already
 * used the right denominators, returned 100%.
 *
 * The baseline cannot catch this: its fixture gives every associate the same
 * count in all three columns, so the right and wrong denominators agree.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function loadRegistry(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    return global.window;
}

suite('survey denominator: each question is weighted by its own responses', (t) => {
    const w = loadRegistry(t);

    t.equal('rep satisfaction uses the rep-sat count', w.SURVEY_WEIGHT_FIELD.cxRepOverall, 'repSurveyTotal');
    t.equal('first call resolution uses the FCR count', w.SURVEY_WEIGHT_FIELD.fcr, 'fcrSurveyTotal');
    t.equal('overall experience uses the overall count', w.SURVEY_WEIGHT_FIELD.overallExperience, 'surveyTotal');

    // The row that produced the wrong answer: forty overall-experience
    // responses, none of them answering the rep-sat question.
    const row = { surveyTotal: 40, repSurveyTotal: 0, fcrSurveyTotal: 0 };
    t.equal('a week nobody answered rep-sat in weighs nothing for rep-sat',
        w.getSurveyWeight('cxRepOverall', row), 0);
    t.equal('nor for FCR', w.getSurveyWeight('fcr', row), 0);
    t.equal('while overall experience keeps its forty',
        w.getSurveyWeight('overallExperience', row), 40);

    const other = { surveyTotal: 0, repSurveyTotal: 40, fcrSurveyTotal: 40 };
    t.equal('and the week that did answer carries the weight',
        w.getSurveyWeight('cxRepOverall', other), 40);

    // Not a survey metric at all. Null rather than 0, because the caller has to
    // tell "weight this by calls" from "a survey nobody answered".
    t.equal('a call-weighted metric reports no survey weight',
        w.getSurveyWeight('aht', { surveyTotal: 40 }), null);
    t.equal('and so does reliability', w.getSurveyWeight('reliability', { surveyTotal: 40 }), null);

    // An export that predates the per-question columns falls back, which is the
    // behaviour that shipped for years.
    t.equal('an older export falls back to the overall count',
        w.getSurveyWeight('cxRepOverall', { surveyTotal: 25 }), 25);
    t.equal('and a row with no counts at all weighs nothing',
        w.getSurveyWeight('cxRepOverall', {}), 0);
});

suite('survey denominator: the aggregators go through the shared map', (t) => {
    // The five aggregators live in script.js and in metric-trends, which the
    // unit suite does not load as a program, and the behaviour baseline cannot
    // see the difference because its fixture gives every column the same count.
    // So this pins the wiring: no aggregator may reach for surveyTotal itself
    // when deciding a survey metric's weight.
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');

    t.check('script.js takes the survey keys from the registry map',
        /SURVEY_WEIGHTED_METRIC_KEYS\s*=\s*new Set\(Object\.keys\(\s*window\.SURVEY_WEIGHT_FIELD/.test(script));
    t.check('and resolves the weight through a single helper',
        /function surveyWeightFor\(metricKey, employee\)/.test(script));

    // Every survey-weighted branch must ask the helper. A branch that still
    // reads surveyTotal directly is the bug coming back.
    const offenders = [];
    script.split('\n').forEach((line, i) => {
        if (!/surveyBackedMetrics\.has|SURVEY_WEIGHTED_METRIC_KEYS\.has/.test(line)) return;
        // The declaration line itself is not a weighting decision.
        if (/=\s*new Set|=\s*SURVEY_WEIGHTED_METRIC_KEYS/.test(line)) return;
        if (/\bsurveyTotal\b/.test(line)) offenders.push(`script.js:${i + 1}  ${line.trim()}`);
    });
    t.equal('no survey branch weighs by surveyTotal directly',
        offenders.join('\n      ') || '(none)', '(none)');

    // The modules that already had it right keep their own copies of the map;
    // those must agree with the registry or the two answers diverge again.
    ['modules/period-compare.module.js', 'modules/morning-pulse.module.js', 'modules/contest.module.js']
        .forEach((rel) => {
            const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
            t.check(`${rel} still maps rep-sat to repSurveyTotal`,
                /cxRepOverall:\s*'repSurveyTotal'/.test(src));
            t.check(`${rel} still maps FCR to fcrSurveyTotal`,
                /fcr:\s*'fcrSurveyTotal'/.test(src));
        });
});
