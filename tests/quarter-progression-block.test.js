'use strict';

/**
 * The year-end and mid-year prompts get the quarters too.
 *
 * Both of them resolve a single period for the year and score five metrics
 * off it. That cannot tell someone who climbed all year apart from someone
 * who started there and stalled, and those are opposite conversations to have
 * with a person about their year.
 *
 * Worse, the year-end prompt told the model "when referencing a metric,
 * include the metric value and its goal" and then handed it no metrics at
 * all. Every figure in a year-end review came from whatever the supervisor
 * had typed into the two free-text boxes.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const PREFIX = 'devCoachingTool_';

function period(type, start, end, employees) {
    return {
        [`${start}|${end}`]: {
            metadata: { periodType: type, startDate: start, endDate: end },
            employees
        }
    };
}

function person(name, over) {
    return Object.assign({
        name,
        totalCalls: 500, surveyTotal: 40, repSurveyTotal: 40, fcrSurveyTotal: 40,
        scheduleAdherence: 94, cxRepOverall: 85, fcr: 78, overallExperience: 80,
        overallSentiment: 90, transfers: 4, transfersCount: 20,
        aht: 420, acw: 55, holdTime: 25, reliability: 0
    }, over || {});
}

const YEAR = Object.assign({},
    period('quarter', '2026-01-01', '2026-03-31', [person('Jordan Reyes', { aht: 451, reliability: 6 })]),
    period('quarter', '2026-04-01', '2026-06-30', [person('Jordan Reyes', { aht: 438, reliability: 5 })]),
    period('quarter', '2026-07-01', '2026-09-30', [person('Jordan Reyes', { aht: 421, reliability: 3.5 })])
);

function load(t, store) {
    const browser = t.installFakeBrowser();
    global.window.weeklyData = store;
    global.weeklyData = store;
    global.window.ytdData = {};
    global.ytdData = {};
    browser.store[PREFIX + 'weeklyData'] = JSON.stringify(store);

    global.window.DevCoachModules.storage = {
        readStore(key) {
            const raw = browser.store[PREFIX + key];
            return raw === undefined ? undefined : JSON.parse(raw);
        },
        loadWeeklyData() { return store; },
        loadYtdData() { return {}; },
        loadDailyData() { return {}; }
    };

    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.SURVEY_WEIGHT_FIELD = global.window.SURVEY_WEIGHT_FIELD;
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/period-compare.module.js');
    t.loadModule('modules/quarter-trend.module.js');
    const qr = t.loadModule('modules/quarter-review.module.js').quarterReview;
    global.window.formatMetricDisplay = (key, value) => {
        const def = global.METRICS_REGISTRY[key] || {};
        const n = Math.round(value * 10) / 10;
        if (def.unit === 'sec') return `${Math.round(value)}s`;
        if (def.unit === '%') return `${n}%`;
        if (def.unit === 'hrs') return `${n} hrs`;
        return String(n);
    };
    return qr;
}

suite('progression block: the quarters come out as plain lines', (t) => {
    t.pinClock('2026-09-22');
    const qr = load(t, YEAR);
    const block = qr.buildProgressionBlock('Jordan Reyes', 2026);

    t.check('it is headed by the year', /How each measure moved across the quarters of 2026:/.test(block));
    t.check('handle time carries all three quarters',
        /Average Handle Time: Q1 451s, Q2 438s, Q3 421s/.test(block));
    t.check('with its goal', /goal 426s or lower/.test(block));
    t.check('and where it stands', /at goal/.test(block));

    // The one metric that must not appear as a per quarter figure.
    t.check('missed hours are the year total', /14\.5 hrs missed for the year/.test(block));
    t.check('shown running at each quarter', /running at 6 hrs through Q1, 11 hrs through Q2/.test(block));
});

suite('progression block: nothing to say produces nothing', (t) => {
    t.pinClock('2026-09-22');
    const qr = load(t, {});
    // An empty string rather than a header with no lines under it, so a caller
    // can append it without checking.
    t.equal('an empty year gives an empty block', qr.buildProgressionBlock('Nobody', 2026), '');
    t.equal('and so does an unknown associate',
        load(t, YEAR).buildProgressionBlock('Not On The Team', 2026), '');
});

suite('progression block: the year-end prompt asks for the quarters', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'modules/year-end.module.js'), 'utf8');

    t.check('the prompt builder has a progression section', src.includes('function progressionSection'));
    t.check('and the prompt actually includes it', /\$\{progressionSection\(supportData\)\}/.test(src));
    t.check('and tells the model to use the quarters rather than the closing figure',
        /say so with the quarters rather than quoting/.test(src));

    const support = fs.readFileSync(path.join(ROOT, 'modules/year-end-comments.module.js'), 'utf8');
    t.check('and the support data builds one', /buildProgressionBlock\?\.\(employeeName, reviewYear\)/.test(support));
    t.check('carried on the object the prompt reads', /progression\s*$/m.test(support));
});

suite('progression block: the mid-year prompt asks for the quarters', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'modules/on-off-tracker.module.js'), 'utf8');

    t.check('the metric context builds one', /buildProgressionBlock\?\.\(employeeName, reviewYear\)/.test(src));
    t.check('it rides on the context', /progression: progression/.test(src));
    t.check('and the prompt prints it', /if \(ctx\.progression\)/.test(src));
});

suite('progression block: it breaks no house rule', (t) => {
    t.pinClock('2026-09-22');
    const qr = load(t, YEAR);
    const block = qr.buildProgressionBlock('Jordan Reyes', 2026);

    ['—', '–', '―', '&mdash;', '&ndash;', '&#8212;', '&#8213;'].forEach((d) => {
        t.check(`no ${JSON.stringify(d)} in the block`, !block.includes(d));
    });
    [/off[- ]track/i, /on[- ]track/i, /\bexceptional\b/i, /\btier\b/i, /score\s*[123]\b/i].forEach((re) => {
        t.check(`no rating vocabulary matching ${re}`, !re.test(block));
    });
});
