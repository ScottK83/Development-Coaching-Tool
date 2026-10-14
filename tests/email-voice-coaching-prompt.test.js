'use strict';

/**
 * THE WEEKLY COACHING PROMPT (People > Coach) AND THE CENTER > TRENDS PROMPT
 *
 * Scott, 2026-10-14: "Think about the wording... goal focused if not meeting
 * ... Offer lots of kudos and praise. Make sure the numbers are simplified."
 * What the prompts handed Copilot before this:
 *
 *   A zero-survey associate was coached on "Overall Experience: 0.0% vs
 *   target 75.0%", Rep Sat and FCR too, each with a tip.
 *   Reliability went in as a focus area with an attendance tip.
 *   Thirteen strengths or thirteen focus areas, each with a tip, and "Clearly
 *   state that improvement is expected", which came back long and scolding.
 *   The trends prompt said "Currently 604, Target 426 to fell vs last
 *   period", asked for a "factual" email, and compared the newest week with
 *   the year-to-date file.
 */

const { suite } = require('./harness');

const WEEK = '2026-10-05|2026-10-09';

function loadCoaching(t, employees) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.weeklyData = { [WEEK]: { metadata: { periodType: 'week', startDate: '2026-10-05', endDate: '2026-10-09' }, employees } };
    global.ytdData = {};
    t.loadModule('modules/metric-trends.module.js');
    ['getMetricOrder', 'formatMetricDisplay', 'isMetricMeetingTarget'].forEach((name) => { global[name] = global.window[name]; });
    global.getMetricTips = (key) => [`A tip for ${key}.`];
    global.getEmployeeNickname = (name) => String(name).split(' ')[0];
    global.formatDateMMDDYYYY = (iso) => iso;
    global.coachingLatestWeekKey = WEEK;
    // 26.5 hours for the year, well over the 18 hour allowance.
    global.window.DevCoachModules.periodCompare = { latestYtdReliability: () => ({ 'Derek Hale': 26.5 }) };
    t.loadModule('modules/coaching-email.module.js');
    t.loadModule('modules/coaching.module.js');
    return global.window.DevCoachModules;
}

// Below goal on almost everything, no surveys at all.
const DEREK = {
    name: 'Derek Hale', scheduleAdherence: 88, transfers: 9, aht: 604, holdTime: 41, acw: 75,
    overallExperience: 0, cxRepOverall: 0, fcr: 0, surveyTotal: 0, repSurveyTotal: 0, fcrSurveyTotal: 0,
    overallSentiment: 80, positiveWord: 70, negativeWord: 75, managingEmotions: 90, reliability: 3
};

function dataSection(prompt) {
    return prompt.slice(prompt.indexOf('DATA FOR THIS EMAIL'), prompt.indexOf('DATA RULES'));
}

suite('email voice, coaching prompt: no survey, no survey coaching', (t) => {
    const { coachingEmail: ce } = loadCoaching(t, [DEREK]);
    const data = dataSection(ce.buildCoachingPrompt(DEREK));

    t.check('no Overall Experience line', !/Overall Experience/.test(data));
    t.check('no Rep Satisfaction line', !/Rep Sat/i.test(data));
    t.check('no First Call Resolution line', !/First Call|FCR/.test(data));
    t.check('and no 0% anywhere', !/\b0(\.0)?%/.test(data));

    t.equal('nine measures are left to talk about', ce.collectCoachingPromptMetricData(DEREK).measuredCount, 9);

    // With Overall Experience surveys behind it, that one is fair game again,
    // and rep sat and FCR, still unanswered, are still left out.
    const withSurveys = { ...DEREK, overallExperience: 60, surveyTotal: 5 };
    const { coachingEmail: again } = loadCoaching(t, [withSurveys]);
    t.equal('a metric with surveys behind it counts again',
        again.collectCoachingPromptMetricData(withSurveys).measuredCount, 10);
});

suite('email voice, coaching prompt: reliability stays out of the weekly email', (t) => {
    const { coachingEmail: ce } = loadCoaching(t, [DEREK]);
    const prompt = ce.buildCoachingPrompt(DEREK);
    const data = dataSection(prompt);

    t.check('not a focus area', !/Reliability/.test(data));
    t.check('no attendance tip', !/A tip for reliability/.test(data));
    t.check('and Copilot is told to leave it out', /Do not mention attendance, reliability or hours missed/.test(prompt));
});

suite('email voice, coaching prompt: three wins, two things to work on', (t) => {
    const strong = {
        name: 'Derek Hale', scheduleAdherence: 97, transfers: 2, aht: 380, holdTime: 20, acw: 40,
        overallExperience: 90, cxRepOverall: 92, fcr: 85, surveyTotal: 12, repSurveyTotal: 12, fcrSurveyTotal: 12,
        overallSentiment: 93, positiveWord: 95, negativeWord: 90, managingEmotions: 98, reliability: 2
    };
    const { coachingEmail: ce } = loadCoaching(t, [strong]);
    const data = ce.collectCoachingPromptMetricData(strong);
    t.check('at most three wins', data.wins.length === 3);
    t.check('and the tally says how many there really were', data.metCount >= 10);

    const { coachingEmail: ce2 } = loadCoaching(t, [DEREK]);
    const weak = ce2.collectCoachingPromptMetricData(DEREK);
    t.check('at most two focus areas', weak.opportunities.length === 2);
    t.check('each with one tip', weak.opportunities.every((entry) => /^A tip for /.test(entry.tip)));
    t.check('the biggest misses first', weak.opportunities[0].margin <= weak.opportunities[1].margin);
});

suite('email voice, coaching prompt: warm, short, simple numbers', (t) => {
    const { coachingEmail: ce, coaching } = loadCoaching(t, [DEREK]);
    const prompt = ce.buildCoachingPrompt(DEREK);
    const data = dataSection(prompt);

    t.check('no "improvement is expected"', !/improvement is expected/i.test(prompt));
    t.check('praise first', /Specific praise first/.test(prompt));
    t.check('at most 2 emojis', /At most 2 emojis/.test(prompt));
    t.check('under 200 words', /Under 200 words/.test(prompt));
    t.check('no em dashes', /no em dashes/i.test(prompt));
    t.check('goals in words, not symbols', /goal 426s or lower/.test(data) && !/[<>]=/.test(data) && !/vs target/.test(data));
    t.check('rates with their unit', /\d%, goal \d+(\.\d)?% or (better|lower)/.test(data));
    t.check('a finished week is talked about in the past', /past tense/.test(data));
    t.check('the week is named by its first day', /Week of Oct 5/.test(data));
    t.check('American: periods, not full stops', !/full stops/.test(prompt));

    const subject = coaching.buildOutlookSubject({
        selectedEmployee: 'Derek Hale',
        getEmployeeNickname: global.getEmployeeNickname,
        periodMeta: { endDate: '2026-10-09' },
        periodKey: WEEK
    });
    t.equal('the subject says the week it was', subject, 'Weekly coaching check-in for Derek, week of Oct 5');
    t.check('no hyphen separators or numeric dates', !/ - |\d+\/\d+\/\d{4}/.test(subject));
    t.equal('with only an end date it finds the Monday',
        coaching.buildOutlookSubject({ selectedEmployee: 'Derek', periodMeta: { endDate: '2026-10-09' } }),
        'Weekly coaching check-in for Derek, week of Oct 5');
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
    return t.loadModule('modules/trend-coaching-email.module.js');
}

function trendContext(store, order) {
    const registry = global.window.METRICS_REGISTRY;
    const meets = (key, value) => global.window.isMetricMeetingTarget(key, parseFloat(value), registry[key].target.value);
    return {
        weeklyData: store,
        getWeeklyKeysSorted: () => order,
        metricsRegistry: registry,
        metricMeetsTarget: meets,
        // Positive when better, as script.js's metricDelta is.
        metricDelta: (key, current, previous) => (registry[key].isReverse ? previous - current : current - previous),
        formatMetricValue: (key, value) => String(value),
        getEmployeeNickname: (name) => String(name).split(' ')[0]
    };
}

suite('email voice, trends prompt: same kind of period, and survey gated', (t) => {
    const M = loadTrends(t);
    const api = M.trendCoachingEmail;

    const thisWeek = { name: 'Derek Hale', scheduleAdherence: 96.2, overallExperience: 0, fcr: 0, surveyTotal: 0, transfers: 9, aht: 604, overallSentiment: 90 };
    const lastWeek = { name: 'Derek Hale', scheduleAdherence: 95.1, overallExperience: 0, fcr: 0, surveyTotal: 0, transfers: 10, aht: 640, overallSentiment: 89 };
    const ytd = { name: 'Derek Hale', scheduleAdherence: 91, overallExperience: 80, fcr: 70, surveyTotal: 40, transfers: 7, aht: 500, overallSentiment: 88 };
    const store = {
        '2026-09-28|2026-10-02': { metadata: { periodType: 'week', startDate: '2026-09-28', endDate: '2026-10-02' }, employees: [lastWeek] },
        '2026-09-01|2026-09-30': { metadata: { periodType: 'month', endDate: '2026-09-30' }, employees: [ytd] },
        '2026-10-05|2026-10-09': { metadata: { periodType: 'week', startDate: '2026-10-05', endDate: '2026-10-09' }, employees: [thisWeek] }
    };
    // The merged list getWeeklyKeysSorted returns: weeks, a month and the
    // year-to-date file, by end date.
    const order = ['2026-09-28|2026-10-02', '2026-09-01|2026-09-30', '2026-10-05|2026-10-09', '2026-01-01|2026-10-10'];
    const ctx = trendContext(store, order);

    const keys = api.pickComparisonKeys(ctx);
    t.equal('the newest week', keys.latestKey, '2026-10-05|2026-10-09');
    t.equal('against the week before, not the month or the year to date', keys.previousKey, '2026-09-28|2026-10-02');

    const prompt = api.buildIndividualCoachingPrompt(ctx, {
        employeeName: 'Derek Hale', currentEmp: thisWeek, previousEmp: lastWeek,
        latestKey: keys.latestKey, latestWeek: store[keys.latestKey], periodType: 'week',
        allTips: { aht: ['Keep a quick reference sheet where you can see it.'], transfers: ['Ask a peer first.'] }
    });

    t.check('no Overall Experience for a zero-survey week', !/Overall Experience/.test(prompt));
    t.check('no FCR either', !/First Call|FCR/.test(prompt));
    t.check('no 0% anywhere', !/\b0(\.0)?%/.test(prompt));
    t.check('the broken "to fell" is gone', !/\bto (fell|rose)\b/.test(prompt));
    t.check('moves read from and to', /from 640s to 604s/.test(prompt));
    t.check('with units on every number', /96\.2%/.test(prompt) && /604s/.test(prompt));
    t.check('goals in words', /goal 426s or lower/.test(prompt));
    t.check('warm, not "factual"', /warm/.test(prompt) && !/factual/.test(prompt));
    t.check('praise first', /celebrate the wins first/.test(prompt));
    t.check('at most 2 emojis, no em dashes', /at most 2 emojis, no em dashes/.test(prompt));
    t.check('the week is named by its first day', /the week of Oct 5/.test(prompt));
    t.check('reliability stays out', /Do not mention attendance, reliability/.test(prompt));
});

suite('email voice, trends prompt: the group email keeps its emoji budget', async (t) => {
    const M = loadTrends(t);
    const api = M.trendCoachingEmail;
    const voice = global.window.DevCoachModules.messageVoice;

    const a1 = { name: 'Ana Ruiz', scheduleAdherence: 97, overallExperience: 0, fcr: 0, surveyTotal: 0, transfers: 3, aht: 400, overallSentiment: 92 };
    const a0 = { name: 'Ana Ruiz', scheduleAdherence: 90, overallExperience: 0, fcr: 0, surveyTotal: 0, transfers: 9, aht: 520, overallSentiment: 85 };
    const store = {
        '2026-09-28|2026-10-02': { metadata: { periodType: 'week', startDate: '2026-09-28', endDate: '2026-10-02' }, employees: [a0] },
        '2026-10-05|2026-10-09': { metadata: { periodType: 'week', startDate: '2026-10-05', endDate: '2026-10-09' }, employees: [a1] }
    };
    const ctx = trendContext(store, Object.keys(store));
    let prompt = '';
    ctx.openCopilotWithPrompt = (text) => { prompt = text; };
    ctx.getCenterAverageForWeek = () => ({ scheduleAdherence: 92, aht: 450 });
    ctx.loadServerTips = async () => ({});
    await api.generateGroupCoachingEmail(ctx);

    t.check('a prompt was written', prompt.length > 0);
    t.equal('the data carries no emojis for Copilot to copy', voice.countEmojis(prompt), 0);
    t.check('and Copilot is held to two', /at most 2 emojis/.test(prompt));
    t.check('a zero-survey week is not a team miss on Overall Experience', !/Overall Experience \(/.test(prompt));
    t.check('handle time coming down is not "up"', !/Average Handle Time: [^\n]*\(up /.test(prompt));
    t.check('no numeric date in the subject', !/\d+\/\d+\/\d{4}/.test(prompt));
    // "5.0 pts" read like a stat sheet; "5 points" reads like a person.
    t.check('gaps are spelled out in points', /5 points above the center average/.test(prompt));
    t.check('with no "pts" and no trailing .0', !/\bpts\b|\d\.0 /.test(prompt));

    const ctxUnits = { metricsRegistry: global.window.METRICS_REGISTRY };
    t.equal('one point is singular', api.formatDifference(ctxUnits, 'scheduleAdherence', 1), '1 point');
    t.equal('a decimal that says something stays', api.formatDifference(ctxUnits, 'scheduleAdherence', -1.14), '1.1 points');
    t.equal('time in seconds, spelled out', api.formatDifference(ctxUnits, 'aht', 18.4), '18 seconds');
});
