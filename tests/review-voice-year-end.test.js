'use strict';

/**
 * The Year-End review: what goes into "Positives to highlight" and
 * "Improvement areas needed", and the summary read aloud at the meeting.
 *
 * Found in the 10/14 smoke test:
 *   - Faith's only improvement area was "Reliability: 34.5 hrs vs target
 *     18.0 hrs", so Copilot built Box 2 around attendance. Hours stay out of
 *     Year-End tone and focus (Scott, 2026-10-13: "Leave hours out of it").
 *   - Eli had no surveys all year and read "Overall Experience: 0.0% vs
 *     target 75.0%" as a failure in three survey metrics. A survey nobody
 *     answered is not a bad survey result.
 *   - Positives were capped at six in registry order, so hold time and after
 *     call work pushed rep satisfaction and sentiment off the list.
 *   - The verbal summary read "Your overall performance rating is: Not
 *     provided." aloud when a box was blank.
 *
 * buildYearEndMetricSnapshot lives in script.js, which does not load under
 * the harness, so it is lifted out and run against the real modules, the
 * same way the retention suite runs the purge.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function loadModules(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.SURVEY_WEIGHT_FIELD = global.window.SURVEY_WEIGHT_FIELD;
    t.loadModule('modules/metric-trends.module.js');
    return t.loadModule('modules/year-end.module.js');
}

function liftSnapshot() {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const cut = (from, to) => {
        const a = script.indexOf(from);
        const b = script.indexOf(to, a);
        if (a < 0 || b < 0) throw new Error('not found in script.js: ' + from);
        return script.slice(a, b);
    };
    const src = cut('function getYearEndTargetConfig', 'function populateDeleteWeekDropdown')
        + cut('function parseYearEndMetricValue', 'function calculateYearEndOnOffMirror');
    return new Function('window', 'METRICS_REGISTRY', 'formatMetricDisplay', 'getMetricOrder',
        'getMetricProfilesModule', 'YEAR_END_TARGETS_BY_YEAR',
        src + '; return buildYearEndMetricSnapshot;')(
        global.window, global.window.METRICS_REGISTRY, global.window.formatMetricDisplay,
        global.window.getMetricOrder, () => global.window.DevCoachModules.metricProfiles, {});
}

function row(over) {
    return Object.assign({
        name: 'Somebody', totalCalls: 2000, surveyTotal: 120, repSurveyTotal: 120, fcrSurveyTotal: 120,
        scheduleAdherence: 94, cxRepOverall: 85, fcr: 78, overallExperience: 80,
        overallSentiment: 90, transfers: 4, aht: 420, acw: 55, holdTime: 25, reliability: 0
    }, over || {});
}

const keys = (list) => list.map((e) => e.key);

suite('review voice: a zero-survey year has no 0% improvement areas', (t) => {
    const M = loadModules(t);
    const build = liftSnapshot();
    const snap = build(row({
        name: 'Eli Brooks', surveyTotal: 0, repSurveyTotal: 0, fcrSurveyTotal: 0,
        cxRepOverall: 0, fcr: 0, overallExperience: 0, aht: 439, scheduleAdherence: 96.6, reliability: 5
    }), '2026', null);

    ['overallExperience', 'cxRepOverall', 'fcr'].forEach((key) => {
        t.check(`${key} is not an improvement area`, keys(snap.opportunities).indexOf(key) === -1);
        t.check(`${key} is not a positive either`, keys(snap.wins).indexOf(key) === -1);
    });
    t.check('no improvement area reads 0%', !snap.opportunities.some((o) => /^0(\.0)?%$/.test(o.value)));
    t.equal('handle time is the one real improvement area', keys(snap.opportunities).join(','), 'aht');

    // Two surveys is still too few; three is a score.
    const two = build(row({ repSurveyTotal: 2, cxRepOverall: 50 }), '2026', null);
    t.check('two rep sat surveys are not a score', keys(two.opportunities).indexOf('cxRepOverall') === -1);
    const three = build(row({ repSurveyTotal: 3, cxRepOverall: 50 }), '2026', null);
    t.check('three are', keys(three.opportunities).indexOf('cxRepOverall') > -1);

    t.equal('the rule, said by the module', M.yearEnd.reviewExclusion('fcr', row({ fcrSurveyTotal: 0 })), 'surveys');
    t.equal('a metric that is not a survey is never thinned', M.yearEnd.reviewExclusion('aht', row({ surveyTotal: 0 })), '');
});

suite('review voice: reliability is out of the Year-End lists', (t) => {
    loadModules(t);
    const build = liftSnapshot();
    const over = build(row({ name: 'Faith Moore', reliability: 34.5, aht: 398, scheduleAdherence: 96.2, cxRepOverall: 100 }), '2026', null);
    t.check('34.5 hours is not an improvement area', keys(over.opportunities).indexOf('reliability') === -1);
    t.check('so a year with no other miss has none', over.opportunities.length === 0);
    const inside = build(row({ reliability: 3 }), '2026', null);
    t.check('and 3 hours is not a positive either', keys(inside.wins).indexOf('reliability') === -1);
});

suite('review voice: the four KPIs lead both Year-End lists', (t) => {
    loadModules(t);
    const build = liftSnapshot();
    const strong = build(row({ aht: 398, scheduleAdherence: 96.2, overallSentiment: 94.5, cxRepOverall: 100 }), '2026', null);
    t.equal('handle time, adherence, sentiment and rep satisfaction come first',
        keys(strong.wins).slice(0, 4).join(','), 'aht,scheduleAdherence,overallSentiment,cxRepOverall');
    t.check('so the cap of six keeps them all', ['overallSentiment', 'cxRepOverall'].every((k) => keys(strong.wins).slice(0, 6).indexOf(k) > -1));

    const weak = build(row({ aht: 470, scheduleAdherence: 90, overallSentiment: 84, cxRepOverall: 70, transfers: 9, holdTime: 60, acw: 90 }), '2026', null);
    t.equal('and lead the improvement areas', keys(weak.opportunities).slice(0, 4).join(','), 'aht,scheduleAdherence,overallSentiment,cxRepOverall');
});

suite('review voice: Year-End lines read simply, with the direction of the goal', (t) => {
    const M = loadModules(t);
    const build = liftSnapshot();
    const snap = build(row({ aht: 439, scheduleAdherence: 92.96 }), '2026', null);
    // 92.96 prints as 93%, so it is judged as 93% and is at goal.
    t.check('a value that prints at goal is a positive', keys(snap.wins).indexOf('scheduleAdherence') > -1);
    const aht = snap.opportunities.find((o) => o.key === 'aht');
    t.equal('handle time says which way the goal runs', M.yearEnd.metricLine(aht), 'Average Handle Time: 439s (goal 426s or lower)');
    const adh = snap.wins.find((o) => o.key === 'scheduleAdherence');
    t.equal('adherence too, with no ".0"', M.yearEnd.metricLine(adh), 'Schedule Adherence: 93% (goal 93% or better)');
});

suite('review voice: the Year-End prompt keeps hours out', (t) => {
    const M = loadModules(t);
    const prompt = M.yearEnd.buildCopilotPrompt(
        { employeeName: 'Faith Moore', reviewYear: 2026, positivesText: '', improvementsText: '', managerContext: '' },
        { fallbackPositives: '', fallbackImprovements: '', annualMetText: '- None recorded', annualNotMetText: '- None' },
        { preferredName: 'Faith', trackLabel: 'On Track/Successful', periodLabel: 'p', sourceLabel: 's', targetProfileLabel: 't' });
    t.check('the instruction is there', /- Keep reliability, attendance and hours missed out of the review/.test(prompt));
});

suite('review voice: the verbal summary never reads "Not provided" aloud', (t) => {
    const M = loadModules(t);
    const full = M.yearEnd.buildVerbalSummary('Faith', 2026, 'Meets expectations', '3% effective 1 March', '$1,200');
    t.check('every filled line is there', /rating for 2026 is Meets expectations\.\nYour merit increase is 3% effective 1 March\.\nYour incentive bonus is \$1,200\.$/.test(full));
    // Said, not read off the form (tone audit, 2026-10-25).
    t.check('no form label read aloud', !/ is: |details are|bonus amount/.test(full));
    const noBonus = M.yearEnd.buildVerbalSummary('Faith', 2026, 'Meets expectations', '3% effective 1 March', '');
    t.check('a blank bonus leaves its line out', !/bonus/.test(noBonus) && /merit increase/.test(noBonus));
    t.check('and nothing says Not provided', !/Not provided/i.test(noBonus));

    // The screen refuses to build one without a rating at all.
    t.loadModule('modules/year-end-comments.module.js');
    const els = global.document._els;
    const field = (value) => ({ value, dataset: {} });
    Object.assign(els, {
        yearEndEmployeeSelect: field('Faith Moore'),
        yearEndReviewYear: field('2026'),
        yearEndPerformanceRatingInput: field(''),
        yearEndMeritDetailsInput: field(''),
        yearEndBonusAmountInput: field(''),
        yearEndVerbalSummaryOutput: field('')
    });
    const alerts = [];
    const toasts = [];
    global.alert = (msg) => alerts.push(String(msg));
    global.window.getEmployeeNickname = () => 'Faith';
    global.window.persistYearEndDraftState = () => {};
    global.window.showToast = (msg) => toasts.push(String(msg));
    const yec = global.window.DevCoachModules.yearEndComments;

    yec.generateYearEndVerbalSummary();
    t.equal('nothing is built without a rating', els.yearEndVerbalSummaryOutput.value, '');
    t.check('and the supervisor is told why', alerts.some((a) => /performance rating/.test(a)));

    els.yearEndPerformanceRatingInput.value = 'Meets expectations';
    yec.generateYearEndVerbalSummary();
    const out = els.yearEndVerbalSummaryOutput.value;
    t.check('with a rating it builds', /rating (for 2026 )?is Meets expectations\./.test(out));
    t.check('blank merit and bonus are left out, not read as Not provided', !/Not provided|merit|bonus/i.test(out));
    t.check('and the supervisor is told which lines went', toasts.some((m) => /merit increase and incentive\/bonus lines were left out/.test(m)));

    const src = fs.readFileSync(path.join(ROOT, 'modules/year-end-comments.module.js'), 'utf8');
    t.check('"Not provided" is not built anywhere in the screen', src.indexOf("'Not provided'") === -1);
});
