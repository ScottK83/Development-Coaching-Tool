'use strict';

/**
 * The quarterly recap email, as the associate reads it.
 *
 * Scott, 2026-10-13: "2 emojis." The recap carried a ✅ or 🔸 on every KPI
 * line plus a 🌟 or 💪 on the close, four or five in all. The hours line
 * landed directly under "Keep it going 💪" and read as the thing to keep
 * going. And an associate below goal on every KPI got no thanks at all for
 * the quarter they had just put in (Scott, 2026-10-14: "Think of the way they
 * would receive the info"). Run through the app's real formatter, so "93%"
 * is what the reader sees.
 */

const { suite } = require('./harness');

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

function year(name, q1, q2, q3) {
    return Object.assign({},
        period('quarter', '2026-01-01', '2026-03-31', [person(name, q1)]),
        period('quarter', '2026-04-01', '2026-06-30', [person(name, q2)]),
        period('quarter', '2026-07-01', '2026-09-30', [person(name, q3)])
    );
}

function load(t, store, options) {
    const opts = options || {};
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
        saveWithSizeCheck(key, data) { browser.store[PREFIX + key] = JSON.stringify(data); return true; },
        loadWeeklyData() { return store; },
        loadYtdData() { return {}; },
        loadDailyData() { return {}; }
    };
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.SURVEY_WEIGHT_FIELD = global.window.SURVEY_WEIGHT_FIELD;
    t.loadModule('modules/metric-trends.module.js');
    if (opts.voice !== false) t.loadModule('modules/message-voice.module.js');
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/period-compare.module.js');
    t.loadModule('modules/shared-utils.module.js');
    t.loadModule('modules/quarter-trend.module.js');
    t.loadModule('modules/quarter-review.module.js');
    const M = t.loadModule('modules/quarter-recap.module.js');
    return { review: M.quarterReview, recap: M.quarterRecap, voice: M.messageVoice };
}

function mailFor(env, name) {
    const ctx = env.review.buildContext(name, 2026, { throughQuarter: 3 });
    return env.recap.buildRecapEmail(ctx, { to: '', cc: '' });
}

// A pictograph count that does not lean on the module under test.
function emojiCount(text) {
    return (String(text).match(/\p{Extended_Pictographic}/gu) || []).filter((c) => !/[©®™]/.test(c)).length;
}

const ALL_GOOD = year('Faith Moore',
    { aht: 400, scheduleAdherence: 95, cxRepOverall: 100, overallSentiment: 93, reliability: 3 },
    { aht: 395, scheduleAdherence: 95.5, cxRepOverall: 100, overallSentiment: 94, reliability: 3 },
    { aht: 398, scheduleAdherence: 96.2, cxRepOverall: 100, overallSentiment: 94.5, reliability: 3 });
const MOSTLY = year('Eli Brooks',
    { aht: 446, scheduleAdherence: 96.5, reliability: 2 },
    { aht: 442, scheduleAdherence: 96.4, reliability: 1.5 },
    { aht: 439, scheduleAdherence: 96.6, reliability: 1.5 });
const NONE = year('Carlos Diaz',
    { aht: 440, scheduleAdherence: 91.5, overallSentiment: 85, cxRepOverall: 74.2, reliability: 8 },
    { aht: 452, scheduleAdherence: 91.0, overallSentiment: 85.4, cxRepOverall: 71.9, reliability: 8 },
    { aht: 465, scheduleAdherence: 91.2, overallSentiment: 85.2, cxRepOverall: 76.5, reliability: 7 });

suite('review voice: the recap email stays inside two emojis', (t) => {
    t.pinClock('2026-10-14');
    [[ALL_GOOD, 'Faith Moore'], [MOSTLY, 'Eli Brooks'], [NONE, 'Carlos Diaz']].forEach(([store, name]) => {
        const env = load(t, store);
        const mail = mailFor(env, name);
        t.check(`${name}: at most two emojis (${emojiCount(mail.body)})`, emojiCount(mail.body) <= 2);
        t.check(`${name}: and the app's own counter agrees`, env.voice.countEmojis(mail.body) <= 2);
        t.check(`${name}: no per-line marks`, !/✅|🔸/.test(mail.body));
        // Even without the limiter loaded, the copy is inside the budget.
        const bare = load(t, store, { voice: false });
        t.check(`${name}: inside the budget on its own`, emojiCount(mailFor(bare, name).body) <= 2);
    });
});

suite('review voice: at goal is said in words, the goal is said when it is not', (t) => {
    t.pinClock('2026-10-14');
    const env = load(t, MOSTLY);
    const body = mailFor(env, 'Eli Brooks').body;
    t.check('adherence at goal says so', /^Schedule Adherence: Q1 96\.5%, Q2 96\.4%, Q3 96\.6% \(at goal\)$/m.test(body));
    // 446, 442, 439: better every quarter, so the email says so, as the file
    // note does.
    t.check('handle time below goal carries its goal, and the move every quarter',
        /^Average Handle Time: Q1 446s, Q2 442s, Q3 439s, down 7 seconds \(goal 426s or lower\)$/m.test(body));
    t.check('goals read as round numbers', !/\d\.0(%|s\b| hrs)/.test(body));
});

suite('review voice: the hours sit with the numbers, above a close about the KPIs', (t) => {
    t.pinClock('2026-10-14');
    const env = load(t, MOSTLY);
    const lines = mailFor(env, 'Eli Brooks').body.split('\n');
    const hoursAt = lines.findIndex((l) => /^For your records, missed time for 2026 through September 30 is 5 hrs \(allowance 17\.9 hrs\)\.$/.test(l));
    const closeAt = lines.findIndex((l) => /^Most of your KPIs are at goal in Q3\. Keep it going 💪$/.test(l));
    t.check('the hours line is there, worded as a record', hoursAt > -1);
    t.check('and comes before the closing line, not under it', closeAt > hoursAt);
    t.check('the KPI lines come first', lines.findIndex((l) => /^Average Handle Time:/.test(l)) < hoursAt);
});

suite('review voice: every KPI below goal still ends on thanks', (t) => {
    t.pinClock('2026-10-14');
    const env = load(t, NONE);
    const body = mailFor(env, 'Carlos Diaz').body;
    t.check('a warmer close for a hard quarter',
        /Q4 is a full quarter to move your KPIs, and I'm here to help\. Thanks for the work you put in this quarter\./.test(body));
    t.check('the rise is still said', /Rep Satisfaction: Q1 74\.2%, Q2 71\.9%, Q3 76\.5%, up 2\.3 points \(goal 82% or better\)/.test(body));
    t.check('no emoji on a hard quarter', emojiCount(body) === 0);

    const good = load(t, ALL_GOOD);
    t.check('a clean quarter is not thanked for its effort as though it were a hard one',
        !/Thanks for the work you put in/.test(mailFor(good, 'Faith Moore').body));
    t.check('and keeps its one emoji', emojiCount(mailFor(good, 'Faith Moore').body) === 1);
});
