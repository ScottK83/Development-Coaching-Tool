'use strict';

/**
 * EVERY COACHING EMAIL HAS SOMETHING TRUE TO PRAISE
 *
 * Scott, 2026-10-14: "Make sure to, in every piece of feedback. From the
 * calls, to the metrics ... Make sure to provide positive feedback."
 *
 * Someone missing every goal got, from the four coaching generators:
 *
 *   People > Coach prompt: "None at goal this week. Open with real thanks"
 *   under a flow that said "Lead with the wins listed below".
 *   Center > Trends individual prompt: the same "None at goal" line.
 *   The trend prompt: "No clear strengths are separated enough from
 *   baseline", then "open with specific praise for the strengths above".
 *   The follow-up email: a generic "Thank you for the work you are putting
 *   in", with a real 40 second gain on handle time sitting unused.
 *
 * Each now opens on messageVoice.truePositive's best true thing, and a 0
 * second handle time (no calls) is never praised as a win.
 */

const { suite } = require('./harness');

const WEEK = '2026-10-05|2026-10-09';
const PRIOR_WEEK = '2026-09-28|2026-10-02';
const WEEK_META = { periodType: 'week', startDate: '2026-10-05', endDate: '2026-10-09' };
const PRIOR_META = { periodType: 'week', startDate: '2026-09-28', endDate: '2026-10-02' };

// Below goal on every measure, no surveys. Handle time came down 40 seconds
// from the week before, which is the true thing to say.
const RED = {
    name: 'Derek Hale', scheduleAdherence: 89, transfers: 9, aht: 560, holdTime: 41, acw: 75,
    overallExperience: 0, cxRepOverall: 0, fcr: 0, surveyTotal: 0, repSurveyTotal: 0, fcrSurveyTotal: 0,
    overallSentiment: 80, positiveWord: 70, negativeWord: 75, managingEmotions: 90, reliability: 3
};
const RED_BEFORE = { ...RED, aht: 600, reliability: 1 };

// Out all week: no handle, hold or wrap time, and so no transfers either.
const NO_CALLS = { ...RED, aht: 0, holdTime: 0, acw: 0, transfers: 0 };

const DASHES = /[—–―]/;
const ZERO_SECONDS = /\b0s\b|\b0 seconds\b/;

function loadCoaching(t, store, extra = {}) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/message-voice.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.weeklyData = store;
    global.ytdData = {};
    t.loadModule('modules/metric-trends.module.js');
    ['getMetricOrder', 'formatMetricDisplay', 'isMetricMeetingTarget'].forEach((name) => { global[name] = global.window[name]; });
    global.getMetricTips = (key) => [`A tip for ${key}.`];
    global.getEmployeeNickname = (name) => String(name).split(' ')[0];
    global.formatDateMMDDYYYY = (iso) => iso;
    global.coachingLatestWeekKey = WEEK;
    global.window.DevCoachModules.periodCompare = { latestYtdReliability: () => ({}) };
    if (extra.centerAverages) global.window.getCenterAverageForWeek = () => extra.centerAverages;
    t.loadModule('modules/coaching-email.module.js');
    return global.window.DevCoachModules;
}

function dataSection(prompt) {
    return prompt.slice(prompt.indexOf('DATA FOR THIS EMAIL'), prompt.indexOf('DATA RULES'));
}

function twoWeeks(current, before) {
    const store = { [WEEK]: { metadata: WEEK_META, employees: [current] } };
    if (before) store[PRIOR_WEEK] = { metadata: PRIOR_META, employees: [before] };
    return store;
}

suite('praise in every coaching email: People > Coach prompt, all red', (t) => {
    const { coachingEmail: ce } = loadCoaching(t, twoWeeks(RED, RED_BEFORE));
    const data = ce.collectCoachingPromptMetricData(RED);
    t.equal('nothing is at goal', data.wins.length, 0);
    t.equal('the positive is the real move', data.positive && data.positive.kind, 'improved');
    t.equal('on handle time', data.positive && data.positive.key, 'aht');
    t.check('and it is true: handle time really came down', RED.aht < RED_BEFORE.aht);

    const prompt = ce.buildCoachingPrompt(RED);
    const section = dataSection(prompt);
    t.check('the data hands Copilot the positive, in words',
        /Your Average Handle Time moved the right way, down 40 seconds\./.test(section));
    t.check('under a heading that matches it', /The positive to open with:/.test(section) && !/Wins to celebrate:/.test(section));
    t.check('the flow leads with the positive', /Lead with the positive listed below, with its number/.test(prompt));
    t.check('no "lead with the wins" when there are none', !/Lead with the wins/.test(prompt));
    t.check('the old "None at goal" line is gone', !/None at goal/.test(prompt));
    t.check('no "At goal on 0 of" tally to repeat back', !/At goal on 0 of/.test(prompt));
    t.check('no "bullets for the wins" when there are none', !/bullets for the wins/.test(prompt));
    t.check('the focus areas are still there', /Focus areas \(at most two\):\n- /.test(section));
    t.check('no em or en dashes', !DASHES.test(prompt));

    // With a win, the flow is the one it always was.
    const better = { ...RED, scheduleAdherence: 95 };
    const { coachingEmail: again } = loadCoaching(t, twoWeeks(better, RED_BEFORE));
    const withWin = again.buildCoachingPrompt(better);
    t.check('a real win still leads as a win', /Lead with the wins listed below/.test(withWin) && /Schedule Adherence: 95%/.test(withWin));
    t.equal('and no stand-in positive is made up', again.collectCoachingPromptMetricData(better).positive, null);
});

suite('praise in every coaching email: People > Coach prompt, no prior week', (t) => {
    const { coachingEmail: ce } = loadCoaching(t, twoWeeks(RED, null), { centerAverages: { scheduleAdherence: 85, aht: 500 } });
    const positive = ce.collectCoachingPromptMetricData(RED).positive;
    t.equal('better than the center counts', positive && positive.kind, 'aboveCenter');
    t.check('said with both numbers, in the past tense for a finished week',
        /Schedule Adherence of 89% was better than the center average of 85%/.test(positive.text));

    const { coachingEmail: bare } = loadCoaching(t, twoWeeks(RED, null));
    const closest = bare.collectCoachingPromptMetricData(RED).positive;
    t.equal('with nothing else, the closest to goal', closest && closest.kind, 'closest');
    t.check('which is a true statement with its goal', /closest to goal, at .* against the .* goal/.test(closest.text));
});

suite('praise in every coaching email: People > Coach prompt, no calls', (t) => {
    const { coachingEmail: ce } = loadCoaching(t, twoWeeks(NO_CALLS, RED_BEFORE));
    t.check('a 0s handle time is read as no calls', ce.coachingTookNoCalls(NO_CALLS));
    const data = ce.collectCoachingPromptMetricData(NO_CALLS);
    t.equal('nothing is praised as a win', data.wins.length, 0);
    t.equal('only the effort', data.positive && data.positive.kind, 'effort');
    const prompt = ce.buildCoachingPrompt(NO_CALLS);
    t.check('no 0 second time anywhere in the data', !ZERO_SECONDS.test(dataSection(prompt)));
    t.check('no 0% transfers as a win', !/Transfers: 0%/.test(prompt));
    t.check('the effort line is what leads', /The positive to open with:\n- I saw the effort you put in, and it matters\./.test(prompt));
    t.check('with no number asked for', !/Lead with the positive listed below, with its number/.test(prompt));

    // A 0 second hold time on a week with calls is still not a win.
    const holdZero = { ...RED, holdTime: 0 };
    const { coachingEmail: ce2 } = loadCoaching(t, twoWeeks(holdZero, RED_BEFORE));
    const held = ce2.collectCoachingPromptMetricData(holdZero);
    t.check('a 0s hold time is never a top win', !held.wins.some((w) => w.key === 'holdTime'));
});

function loadTrends(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/message-voice.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.weeklyData = {};
    global.ytdData = {};
    t.loadModule('modules/metric-trends.module.js');
    return t.loadModule('modules/trend-coaching-email.module.js').trendCoachingEmail;
}

function trendContext() {
    const registry = global.window.METRICS_REGISTRY;
    return {
        metricsRegistry: registry,
        metricMeetsTarget: (key, value) => global.window.isMetricMeetingTarget(key, parseFloat(value), registry[key].target.value),
        metricDelta: (key, current, previous) => (registry[key].isReverse ? previous - current : current - previous),
        formatMetricValue: (key, value) => String(value),
        getEmployeeNickname: (name) => String(name).split(' ')[0]
    };
}

function trendPrompt(api, current, before) {
    return api.buildIndividualCoachingPrompt(trendContext(), {
        employeeName: 'Derek Hale', currentEmp: current, previousEmp: before,
        latestKey: WEEK, latestWeek: { metadata: WEEK_META }, periodType: 'week',
        allTips: { aht: ['Keep a quick reference sheet where you can see it.'], transfers: ['Ask a peer first.'] }
    });
}

suite('praise in every coaching email: Center > Trends prompt, all red', (t) => {
    const api = loadTrends(t);
    // Adherence came up 3 points, but transfers and handle time are the two
    // biggest misses, so adherence is not a focus area. Its move still counts.
    const now = { name: 'Derek Hale', scheduleAdherence: 89, overallExperience: 0, fcr: 0, surveyTotal: 0, transfers: 9, aht: 560, overallSentiment: 80 };
    const before = { ...now, scheduleAdherence: 86 };
    const prompt = trendPrompt(api, now, before);

    t.check('the focus areas are the two biggest misses', /- Transfers: /.test(prompt) && /- Average Handle Time: /.test(prompt));
    t.check('adherence is not one of them', !/- Schedule Adherence: /.test(prompt));
    t.check('but its real move is the positive', /THE POSITIVE TO OPEN WITH:\n- Your Schedule Adherence moved the right way, up 3 points\./.test(prompt));
    t.check('and it is true', now.scheduleAdherence > before.scheduleAdherence);
    t.check('the instructions lead with it', /lead with the positive above, with its number,/.test(prompt));
    t.check('no "celebrate the wins" when there are none', !/celebrate the wins/.test(prompt) && !/WINS TO CELEBRATE/.test(prompt));
    t.check('the old "None at goal" line is gone', !/None at goal/.test(prompt));
    t.check('no em or en dashes', !DASHES.test(prompt));
});

suite('praise in every coaching email: Center > Trends prompt, no calls', (t) => {
    const api = loadTrends(t);
    const now = { name: 'Derek Hale', scheduleAdherence: 89, overallExperience: 0, fcr: 0, surveyTotal: 0, transfers: 0, aht: 0, overallSentiment: 80 };
    const before = { ...now, scheduleAdherence: 86, aht: 540, transfers: 8 };
    const prompt = trendPrompt(api, now, before);
    t.check('no 0s handle time anywhere', !ZERO_SECONDS.test(prompt) && !/- Average Handle Time:/.test(prompt));
    t.check('no 0% transfers praised', !/Transfers: 0%/.test(prompt));
    t.check('only the effort leads', /THE POSITIVE TO OPEN WITH:\n- I saw the effort you put in, and it matters\./.test(prompt));
});

function loadMetricTrends(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/message-voice.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.weeklyData = {};
    global.ytdData = {};
    global.DEBUG = false;
    global.getMetricTips = (key) => [`A tip for ${key}`];
    global.loadCallCenterAverages = () => ({});
    return t.loadModule('modules/metric-trends.module.js').metricTrends;
}

// The bundle's path: analyze, then keep only what a message may talk about.
function analyze(mt, employee, before, center = {}) {
    const analysis = mt.analyzeTrendMetrics(employee, center, 2026, before, {});
    const metrics = mt.coachableTrendMetrics(analysis.allMetrics, employee, before);
    return { metrics, ...mt.pickWeakestAndTrending(metrics) };
}

function strengthsOf(prompt) {
    return prompt.slice(prompt.indexOf('=== STRENGTHS TO LEVERAGE ==='), prompt.indexOf('=== PRIORITY DEVELOPMENT AREAS ==='));
}

suite('praise in every coaching email: trend prompt, all red', (t) => {
    const mt = loadMetricTrends(t);
    const { metrics, weakest, trendingDown } = analyze(mt, RED, RED_BEFORE);
    const prompt = mt.buildTrendCoachingPrompt('Derek', weakest, trendingDown, [], [], '', null, metrics, { periodMeta: WEEK_META, weekKey: WEEK });
    const strengths = strengthsOf(prompt);

    t.check('the old "no clear strengths" line is gone', !/No clear strengths/.test(prompt));
    t.check('the strengths section carries the real positive',
        /Your Average Handle Time moved the right way, down 40 seconds\./.test(strengths));
    t.check('the email is told to open with that positive', /open with specific praise for the positive under STRENGTHS TO LEVERAGE/.test(prompt));
    t.check('not with "the strengths above" that are not there', !/praise for the strengths above/.test(prompt));
    t.check('still warm', /genuinely proud of them/.test(prompt));
    t.check('no em or en dashes', !DASHES.test(prompt));
});

suite('praise in every coaching email: trend prompt, a plain goal on target counts', (t) => {
    const mt = loadMetricTrends(t);
    // Adherence just over goal and holding: not "Exceeding", not improving.
    const steady = { ...RED, scheduleAdherence: 93.5 };
    const { metrics, weakest, trendingDown } = analyze(mt, steady, { ...RED_BEFORE, scheduleAdherence: 93.4 });
    const prompt = mt.buildTrendCoachingPrompt('Derek', weakest, trendingDown, [], [], '', null, metrics);
    const strengths = strengthsOf(prompt);
    t.check('the on-target goal is the strength', /Schedule Adherence: on target at 93\.5% \(goal 93% or better\)/.test(strengths));
    t.check('and the praise line points at it', /praise for the strengths above/.test(prompt));
});

suite('praise in every coaching email: trend prompt, no calls', (t) => {
    const mt = loadMetricTrends(t);
    const { metrics, weakest, trendingDown } = analyze(mt, NO_CALLS, RED_BEFORE);
    const prompt = mt.buildTrendCoachingPrompt('Derek', weakest, trendingDown, [], [], '', null, metrics);
    const strengths = strengthsOf(prompt);
    t.check('a 0s handle time is not a strength', !/Average Handle Time|Hold Time|After Call Work|Transfers/.test(strengths));
    t.check('the effort is', /I saw the effort you put in, and it matters\./.test(strengths));
    t.check('with thanks, not a number, asked for', /open with real thanks for their effort/.test(prompt));
});

suite('praise in every coaching email: follow-up email, all red', (t) => {
    const mt = loadMetricTrends(t);
    const { metrics, weakest, trendingDown } = analyze(mt, RED, RED_BEFORE);
    const body = mt.buildCoachingEmailBody('Derek Hale', metrics, weakest, trendingDown, ['Keep a quick reference sheet where you can see it'], [], WEEK_META);

    t.check('opens on something good, specifically',
        /I wanted to follow up on the week of Oct 5, and I want to start with something good\. Your Average Handle Time moved the right way, down 40 seconds\./.test(body));
    t.check('the generic effort line is not used when there is a real positive', !/Thank you for the work you are putting in/.test(body));
    t.check('praise comes before the coaching', body.indexOf('something good') < body.indexOf('work on next'));
    t.check('still at most two focus areas', body.split('\n').filter((line) => line.startsWith('- ')).length <= 2);
    t.check('no em or en dashes', !DASHES.test(body));
    t.check('no reliability', !/Reliability|hours/.test(body));
    t.check('no zero-survey metric', !/Overall Experience|Rep Sat|First Call/.test(body));
});

suite('praise in every coaching email: follow-up email, no calls', (t) => {
    const mt = loadMetricTrends(t);
    const { metrics, weakest, trendingDown } = analyze(mt, NO_CALLS, RED_BEFORE);
    const body = mt.buildCoachingEmailBody('Derek Hale', metrics, weakest, trendingDown, [], [], WEEK_META);
    t.check('no 0s time praised or coached', !ZERO_SECONDS.test(body));
    t.check('no "nice work" on numbers with no calls behind them', !/nice work/.test(body));
    t.check('the effort line, as the last resort', /Thank you for the work you are putting in/.test(body));
});
