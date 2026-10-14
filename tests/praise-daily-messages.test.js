'use strict';

/**
 * PRAISE IN EVERY DAILY MESSAGE, EVEN WITH EVERY GOAL MISSED
 *
 * Scott, 2026-10-14: "Make sure to, in every piece of feedback. From the
 * calls, to the metrics ... Make sure to provide positive feedback."
 *
 * What was wrong, for somebody missing every goal:
 *
 *   - the check-in and the Monday kickoff drew from a pool where some lines
 *     were sympathy, not praise ("Not every week is going to be a highlight
 *     reel", "Rough stretch");
 *   - the monthly review opened "Tough month" or "Not the month we wanted";
 *   - the growth note listed what slipped and ended "Let's regroup" with no
 *     praise anywhere in it;
 *   - the sentiment Copilot prompt asked for recognition only when all three
 *     were at goal, so two at goal and one short got none.
 *
 * Now each one leads with the best TRUE positive (better than the center,
 * closest to goal, a real move) and thanks the effort only when the numbers
 * have none. The praise never names the metric the focus is about to ask for
 * work on, a 0s handle time is never praise (no calls, no message), and the
 * tense follows the period.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const W2 = '2026-09-28|2026-10-02';
const W1 = '2026-10-05|2026-10-09';
const WIP = '2026-10-12|2026-10-13';
const WED = new Date(2026, 9, 14, 9);

// Sympathy dressed as kindness. None of it is praise.
const SYMPATHY = /highlight reel|rough stretch|tough (month|stretch|start|week)|\bgrind|don't cooperate|hang in there|not every (week|stretch|month)|stubborn|not the (month|start) we wanted|wasn't the month|some months are like this|use it as fuel|clean slate|isn't over/i;
const FINISHED_ONLY = / was your closest| came in better than| beat the center| came within| was on target| was right where/;
const RUNNING_ONLY = / is your closest| is better than the center| is beating the center| is within \d| is on target| is right where/;
const EFFORT = /effort|work ethic|how hard you work|appreciate|Thank you|Thanks for/i;

const M = (metricKey, label, value, target, type, meets, center) => ({
    metricKey, label, employeeValue: value, target, targetType: type, meetsTarget: meets,
    classification: meets ? 'On Track' : 'Needs Focus',
    gapFromTarget: meets ? 0 : Math.abs(value - target),
    centerValue: center || 0,
    isBelowCenter: center ? (type === 'max' ? value > center : value < center) : false
});

function load(t, emp, base, metrics, options) {
    const opts = options || {};
    t.installFakeBrowser();
    t.pinClock('2026-10-14');
    const latestKey = opts.latestKey || W1;
    const latestType = opts.latestType || 'week';
    const [ls, le] = latestKey.split('|');
    global.weeklyData = {
        [W2]: { metadata: { periodType: 'week', startDate: '2026-09-28', endDate: '2026-10-02' }, employees: [base] },
        [latestKey]: { metadata: { periodType: latestType, startDate: ls, endDate: le }, employees: [emp] }
    };
    global.ytdData = {};
    global.dailyData = {};
    const registry = t.loadModule('modules/metrics-registry.module.js');
    global.isReverseMetric = registry.metricsRegistryHelpers.isReverseMetric;
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.metricDelta = (key, cur, prev) => (global.isReverseMetric(key) ? prev - cur : cur - prev);
    global.window.analyzeTrendMetrics = () => ({ allMetrics: metrics });
    global.getEmployeeNickname = (n) => n.split(' ')[0];
    global.loadServerTips = async () => ({ aht: ['Use hold only when you need to look something up'] });
    t.loadModule('modules/message-voice.module.js');
    return t.loadModule('modules/morning-pulse.module.js').morningPulse;
}

function cleanUp() {
    delete global.loadServerTips;
    delete global.getEmployeeNickname;
    global.weeklyData = {};
    global.ytdData = {};
    global.dailyData = {};
}

async function draw(times, fn) {
    const out = [];
    for (let i = 0; i < times; i++) out.push(await fn());
    return out;
}

const firstParagraph = (m) => String(m || '').split('\n\n')[0];

// Everything short of target. Handle time is the widest gap and so the focus;
// Schedule Adherence is two points short, the nearest to goal by far.
const EMP = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0, aht: 520, scheduleAdherence: 91, overallSentiment: 85 };
const BASE = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0, aht: 522, scheduleAdherence: 91.2, overallSentiment: 85.1 };
const ALL_RED = [
    M('aht', 'Average Handle Time', 520, 426, 'max', false),
    M('scheduleAdherence', 'Schedule Adherence', 91, 93, 'min', false),
    M('overallSentiment', 'Overall Sentiment', 85, 88, 'min', false)
];

/* ── The check-in ── */

suite('praise daily: an all-red check-in leads with the closest goal, in the past tense', async (t) => {
    const pulse = load(t, EMP, BASE, ALL_RED);
    try {
        const out = await draw(60, () => pulse.generateCheckinMessage('Sam Lee', W1, W2, { now: WED }));
        t.check('a message every time', out.every(Boolean));
        t.check('the opening names Schedule Adherence, the closest goal, with its real numbers',
            out.every(m => /Schedule Adherence/.test(firstParagraph(m)) && /91%/.test(firstParagraph(m)) && /93%/.test(firstParagraph(m))));
        t.check('said as the closest, or within 2 points', out.every(m => /closest to goal|within 2 points/.test(firstParagraph(m))));
        t.equal('the praise never names the focus metric', out.filter(m => /Average Handle Time/.test(firstParagraph(m))).length, 0);
        t.check('and the focus is still the handle time', out.every(m => /Average Handle Time/.test(m.split('\n\n').slice(1).join(' '))));
        t.equal('no sympathy line', out.filter(m => SYMPATHY.test(m)).length, 0);
        t.equal('a finished week is spoken of in the past', out.filter(m => RUNNING_ONLY.test(m)).length, 0);
    } finally {
        cleanUp();
    }
});

suite('praise daily: a week still running is praised in the present', async (t) => {
    const pulse = load(t, EMP, BASE, ALL_RED, { latestKey: WIP, latestType: 'week-in-progress' });
    try {
        const out = await draw(60, () => pulse.generateCheckinMessage('Sam Lee', WIP, W2, { now: WED }));
        t.check('a message every time', out.every(Boolean));
        t.check('the praise is there', out.every(m => /Schedule Adherence/.test(firstParagraph(m))));
        t.equal('and nothing in it says the week is over', out.filter(m => FINISHED_ONLY.test(m)).length, 0);
    } finally {
        cleanUp();
    }
});

suite('praise daily: better than the center comes before closest to goal', async (t) => {
    const metrics = [
        M('aht', 'Average Handle Time', 520, 426, 'max', false, 517),
        M('scheduleAdherence', 'Schedule Adherence', 91, 93, 'min', false),
        M('overallSentiment', 'Overall Sentiment', 85, 88, 'min', false, 82)
    ];
    const pulse = load(t, EMP, BASE, metrics);
    try {
        const out = await draw(60, () => pulse.generateCheckinMessage('Sam Lee', W1, W2, { now: WED }));
        t.check('Overall Sentiment against the center average, both numbers',
            out.every(m => /Overall Sentiment at 85%[^\n]*center average of 82%/.test(firstParagraph(m))));
        t.equal('never the handle time, which is behind the center as well as the goal',
            out.filter(m => /Average Handle Time[^\n]*center/.test(m)).length, 0);
    } finally {
        cleanUp();
    }
});

suite('praise daily: ahead of the center on the focus metric, the praise goes elsewhere', async (t) => {
    // Handle time beats the center but is the focus; praising it and then
    // asking for work on it is what FOCUS_IMPROVING was written to stop.
    const metrics = [
        M('aht', 'Average Handle Time', 480, 426, 'max', false, 517),
        M('scheduleAdherence', 'Schedule Adherence', 91, 93, 'min', false),
        M('overallSentiment', 'Overall Sentiment', 85, 88, 'min', false, 86)
    ];
    const pulse = load(t, Object.assign({}, EMP, { aht: 480 }), Object.assign({}, BASE, { aht: 482 }), metrics);
    try {
        const out = await draw(60, () => pulse.generateCheckinMessage('Sam Lee', W1, W2, { now: WED }));
        t.equal('the praise is not the focus metric', out.filter(m => /Average Handle Time/.test(firstParagraph(m))).length, 0);
        t.check('it is the closest goal instead', out.every(m => /Schedule Adherence[^\n]*91%/.test(firstParagraph(m))));
    } finally {
        cleanUp();
    }
});

suite('praise daily: far from every goal, the check-in thanks the effort', async (t) => {
    const metrics = [
        M('aht', 'Average Handle Time', 604, 426, 'max', false),
        M('scheduleAdherence', 'Schedule Adherence', 84, 93, 'min', false),
        M('overallSentiment', 'Overall Sentiment', 79, 88, 'min', false)
    ];
    const emp = Object.assign({}, EMP, { aht: 604, scheduleAdherence: 84, overallSentiment: 79 });
    const pulse = load(t, emp, Object.assign({}, emp), metrics);
    try {
        const out = await draw(80, () => pulse.generateCheckinMessage('Sam Lee', W1, W2, { now: WED }));
        t.equal('nine points short is not called close', out.filter(m => /closest|within \d/.test(m)).length, 0);
        t.check('the effort is thanked', out.every(m => EFFORT.test(firstParagraph(m))));
        t.equal('and never with sympathy', out.filter(m => SYMPATHY.test(m)).length, 0);
    } finally {
        cleanUp();
    }
});

suite('praise daily: a 0 second handle time is no calls, not a win', async (t) => {
    const metrics = [M('aht', 'Average Handle Time', 0, 426, 'max', true), M('scheduleAdherence', 'Schedule Adherence', 91, 93, 'min', false)];
    const emp = Object.assign({}, EMP, { aht: 0, totalCalls: 0 });
    const pulse = load(t, emp, BASE, metrics);
    try {
        t.equal('no check-in is written', await pulse.generateCheckinMessage('Sam Lee', W1, W2, { now: WED }), null);
        t.equal('no kickoff either', await pulse.generateMondayKickoffMessage('Sam Lee', W1, W2, { now: WED }), null);
        t.equal('nor a monthly review', await pulse.generateMonthlyCheckinMessage('Sam Lee', W1, W2), null);
    } finally {
        cleanUp();
    }
    // And the true positive itself never reaches for a 0s number.
    const live = load(t, EMP, BASE, ALL_RED.concat([M('holdTime', 'Hold Time', 0, 30, 'max', false)]));
    try {
        const out = await draw(40, () => live.generateCheckinMessage('Sam Lee', W1, W2, { now: WED }));
        t.equal('no 0s is ever praised', out.filter(m => /\b0s\b|Hold Time/.test(firstParagraph(m))).length, 0);
    } finally {
        cleanUp();
    }
});

/* ── The Monday kickoff ── */

suite('praise daily: an all-red Monday kickoff opens on a true positive', async (t) => {
    const pulse = load(t, EMP, BASE, ALL_RED);
    try {
        const out = await draw(60, () => pulse.generateMondayKickoffMessage('Sam Lee', W1, W2, { now: WED }));
        t.check('a message every time', out.every(Boolean));
        t.check('Schedule Adherence leads, with its real numbers', out.every(m => /Schedule Adherence[^\n]*91%/.test(firstParagraph(m))));
        t.equal('the praise is not the focus metric', out.filter(m => /Average Handle Time/.test(firstParagraph(m))).length, 0);
        t.equal('it is not followed by "With those wins in mind"', out.filter(m => /those wins/i.test(m)).length, 0);
        t.equal('no sympathy line', out.filter(m => SYMPATHY.test(m)).length, 0);
        t.equal('past tense for last week', out.filter(m => RUNNING_ONLY.test(m)).length, 0);
    } finally {
        cleanUp();
    }
});

/* ── The monthly review ── */

// August and September finished, October running (the clock is Oct 14).
function loadMonths(t, metrics) {
    const emp = Object.assign({}, EMP, { totalCalls: 900 });
    const pulse = load(t, emp, emp, metrics);
    global.weeklyData = {
        m8: { metadata: { periodType: 'month', startDate: '2026-08-01', endDate: '2026-08-31' }, employees: [Object.assign({}, emp)] },
        m9: { metadata: { periodType: 'month', startDate: '2026-09-01', endDate: '2026-09-30' }, employees: [Object.assign({}, emp)] },
        m10: { metadata: { periodType: 'month-to-date', startDate: '2026-10-01', endDate: '2026-10-13' }, employees: [Object.assign({}, emp)] }
    };
    return pulse;
}

suite('praise daily: an all-red September leads with a real positive, not "Tough month"', async (t) => {
    const pulse = loadMonths(t, ALL_RED);
    try {
        const out = await draw(60, () => pulse.generateMonthlyCheckinMessage('Sam Lee', 'm9', 'm8'));
        t.check('a message every time', out.every(Boolean));
        t.check('Schedule Adherence, the closest goal, opens it', out.every(m => /Schedule Adherence[^\n]*91%/.test(firstParagraph(m))));
        t.equal('no sympathy line', out.filter(m => SYMPATHY.test(m)).length, 0);
        t.equal('September is over, so the praise is in the past', out.filter(m => RUNNING_ONLY.test(m)).length, 0);
        t.equal('and still no "this month\'s" or "next month"', out.filter(m => /this month's|next month/i.test(m)).length, 0);
    } finally {
        cleanUp();
    }
});

suite('praise daily: October so far is praised as still running', async (t) => {
    const pulse = loadMonths(t, ALL_RED);
    try {
        const out = await draw(60, () => pulse.generateMonthlyCheckinMessage('Sam Lee', 'm10', 'm9'));
        t.check('a message every time', out.every(Boolean));
        t.check('the praise is there', out.every(m => /Schedule Adherence[^\n]*91%/.test(firstParagraph(m))));
        t.equal('nothing says October is over', out.filter(m => FINISHED_ONLY.test(m) || /On to the next one/.test(m)).length, 0);
    } finally {
        cleanUp();
    }
});

suite('praise daily: a month with nothing true to name thanks the effort, kindly', async (t) => {
    const far = [
        M('aht', 'Average Handle Time', 604, 426, 'max', false),
        M('scheduleAdherence', 'Schedule Adherence', 84, 93, 'min', false),
        M('overallSentiment', 'Overall Sentiment', 79, 88, 'min', false)
    ];
    const pulse = loadMonths(t, far);
    try {
        const done = await draw(60, () => pulse.generateMonthlyCheckinMessage('Sam Lee', 'm9', 'm8'));
        t.check('September: thanks for the effort', done.every(m => EFFORT.test(firstParagraph(m))));
        t.equal('September: no sympathy', done.filter(m => SYMPATHY.test(m)).length, 0);
        t.equal('September: past tense', done.filter(m => /you're putting in|you're working|you keep showing/.test(m)).length, 0);
        const running = await draw(60, () => pulse.generateMonthlyCheckinMessage('Sam Lee', 'm10', 'm9'));
        t.check('October so far: thanks for the effort', running.every(m => EFFORT.test(firstParagraph(m))));
        t.equal('October so far: present tense', running.filter(m => /you put in|you worked|you kept showing|you brought/.test(m)).length, 0);
    } finally {
        cleanUp();
    }
});

/* ── The growth note ── */

suite('praise daily: everything slipped, and the growth note still has praise in it', async (t) => {
    // Handle time and adherence slipped; sentiment held, two points short,
    // the nearest to goal of the three.
    const metrics = [
        M('aht', 'Average Handle Time', 520, 426, 'max', false),
        M('scheduleAdherence', 'Schedule Adherence', 89, 93, 'min', false),
        M('overallSentiment', 'Overall Sentiment', 86, 88, 'min', false)
    ];
    const down = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0, aht: 520, scheduleAdherence: 89, overallSentiment: 86 };
    const before = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0, aht: 480, scheduleAdherence: 93, overallSentiment: 86 };
    const pulse = load(t, down, before, metrics);
    global.window.DevCoachModules.periodIndex = { currentIndex: () => ({}), weekLikeKeys: () => [W2, W1], keysOfType: () => [] };
    try {
        const out = await draw(60, () => pulse.generateGrowthMessage('Sam Lee', 'wow'));
        t.check('a message every time', out.every(Boolean));
        const praiseAt = m => m.search(/Overall Sentiment (was your closest|at 86% came within)/);
        t.check('Overall Sentiment, which held and is closest to goal, is praised', out.every(m => praiseAt(m) > -1 && /86%/.test(m) && /88%/.test(m)));
        t.check('kudos first: before the list of what slipped', out.every(m => praiseAt(m) < m.indexOf('Slipped a bit:')));
        t.check('the slips are still said, in words', out.every(m => /Average Handle Time: up 40 seconds \(480s to 520s\)/.test(m)));
        t.equal('the focus metric is not the praise', out.filter(m => /Average Handle Time (was|is) your closest/.test(m)).length, 0);
        t.equal('a metric listed as slipped is never the praise', out.filter(m => /Schedule Adherence (was your closest|at 89% came within)/.test(m)).length, 0);
        t.equal('the week of Oct 5 is over, so the past tense', out.filter(m => RUNNING_ONLY.test(m)).length, 0);
        t.equal('no rising chart on it', out.filter(m => /📈/.test(m)).length, 0);
    } finally {
        cleanUp();
    }
});

suite('praise daily: the closest goal slipped, so the growth note thanks the effort instead', async (t) => {
    // Praising adherence as "closest to goal" and then listing it under
    // "Slipped a bit" is praise and a scolding for one number.
    const metrics = [M('aht', 'Average Handle Time', 520, 426, 'max', false), M('scheduleAdherence', 'Schedule Adherence', 89, 93, 'min', false)];
    const down = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0, aht: 520, scheduleAdherence: 89 };
    const before = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0, aht: 480, scheduleAdherence: 93 };
    const pulse = load(t, down, before, metrics);
    global.window.DevCoachModules.periodIndex = { currentIndex: () => ({}), weekLikeKeys: () => [W2, W1], keysOfType: () => [] };
    try {
        const out = await draw(40, () => pulse.generateGrowthMessage('Sam Lee', 'wow'));
        t.equal('the slipped metric is not praised', out.filter(m => /Schedule Adherence (was your closest|at 89% came within)/.test(m)).length, 0);
        t.check('the effort is thanked before the list', out.every(m => {
            const at = m.search(/I saw the effort|Thank you for the work you put in/);
            return at > -1 && at < m.indexOf('Slipped a bit:');
        }));
    } finally {
        cleanUp();
    }
});

suite('praise daily: a slip far from goal on everything still thanks the effort', async (t) => {
    const metrics = [M('aht', 'Average Handle Time', 640, 426, 'max', false), M('scheduleAdherence', 'Schedule Adherence', 82, 93, 'min', false)];
    const down = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0, aht: 640, scheduleAdherence: 82 };
    const before = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0, aht: 580, scheduleAdherence: 88 };
    const pulse = load(t, down, before, metrics);
    global.window.DevCoachModules.periodIndex = { currentIndex: () => ({}), weekLikeKeys: () => [W2, W1], keysOfType: () => [] };
    try {
        const out = await draw(40, () => pulse.generateGrowthMessage('Sam Lee', 'wow'));
        t.check('the effort is thanked before the list', out.every(m => {
            const at = m.search(/I saw the effort|Thank you for the work you put in/);
            return at > -1 && at < m.indexOf('Slipped a bit:');
        }));
    } finally {
        cleanUp();
    }
});

/* ── The pools themselves ── */

suite('praise daily: the no-win pools are praise, not sympathy', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'modules/morning-pulse.module.js'), 'utf8');
    const pool = (name) => {
        const at = src.indexOf(`const ${name} = [`);
        return at < 0 ? '' : src.slice(at, src.indexOf('];', at));
    };
    ['NO_WINS', 'MO_NO_WINS', 'MO_NO_WINS_ONGOING', 'GROWTH_EFFORT', 'GROWTH_EFFORT_ONGOING'].forEach((name) => {
        const body = pool(name);
        t.check(`${name} exists`, body.length > 0);
        t.check(`${name} has no sympathy line`, !SYMPATHY.test(body));
        t.check(`${name} thanks or credits the effort in every line`,
            body.split('\n').filter(l => /['`]/.test(l) && !/^\s*\/\//.test(l)).every(l => EFFORT.test(l) || /value|notice/i.test(l)));
    });
});

/* ── The sentiment Copilot prompt ── */

function loadSentiment(t, withVoice) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    Object.assign(global, {
        TOP_PHRASES_COUNT: 5, MIN_PHRASE_VALUE: 0, SENTIMENT_IMPROVEMENT_THRESHOLD: 3, SENTIMENT_TOP_WINS_COUNT: 5,
        SENTIMENT_BOTTOM_COUNT: 5, SENTIMENT_UNUSED_SUGGESTIONS: 3, SENTIMENT_MIN_PHRASES_FOR_BOTTOM: 5,
        SENTIMENT_CUSTOMER_CONTEXT_COUNT: 3, SENTIMENT_EMOTION_LOW_THRESHOLD: 5,
        escapeHtml: (v) => String(v == null ? '' : v)
    });
    if (withVoice) {
        t.loadModule('modules/metric-movement.module.js');
        t.loadModule('modules/message-voice.module.js');
    }
    return t.loadModule('modules/sentiment.module.js').sentiment;
}

const report = (pct) => ({
    associateName: 'Angelina Fierro', startDate: '2026-09-01', endDate: '2026-09-30',
    totalCalls: 212, callsDetected: 190, percentage: pct,
    phrases: [{ phrase: 'happy to help', value: 41, speaker: 'A' }, { phrase: 'unfortunately', value: 12, speaker: 'A' }]
});
const GOALS = { POSITIVE_GOAL: 86, NEGATIVE_GOAL: 83, EMOTIONS_GOAL: 95 };

suite('praise daily: the sentiment prompt praises the two at goal when the third is short', (t) => {
    const s = loadSentiment(t, true);
    const prompt = s.buildSentimentCopilotPrompt(
        { positive: report(88.4), negative: report(74.2), emotions: report(96.1) },
        Object.assign({ associateName: 'Angelina Fierro' }, GOALS));
    t.check('both are named as at goal', /Praise first: Positive Language \(88\.4%\) and Managing Emotions \(96\.1%\) are at goal/.test(prompt));
    t.check('and it is told to open with that', /Open the note by recognizing that/.test(prompt) && /- Open with the praise above/.test(prompt));
    t.check('the praise comes before the focus', prompt.indexOf('Praise first') < prompt.indexOf('Focus on Avoiding Negative Words'));
});

suite('praise daily: with all three short, the prompt still carries true praise', (t) => {
    [true, false].forEach((withVoice) => {
        const s = loadSentiment(t, withVoice);
        const tag = withVoice ? '' : ' (without message-voice)';
        // Negative words is the widest gap; Managing Emotions is the closest.
        const prompt = s.buildSentimentCopilotPrompt(
            { positive: report(82), negative: report(74.2), emotions: report(93.2) },
            Object.assign({ associateName: 'Angelina Fierro' }, GOALS));
        t.check('the closest goal is the praise' + tag, /Praise first: Managing Emotions is the closest to goal, at 93\.2% against a 95% goal/.test(prompt));
        t.check('the focus is the widest gap' + tag, /Focus on Avoiding Negative Words/.test(prompt));
        t.check('no ".0" and "an 86% goal"' + tag, !/\d\.0%/.test(prompt) && /against an 86% goal/.test(prompt) && !/\ba 8\d%/.test(prompt));
        t.check('no em or en dash' + tag, !/[—–]/.test(prompt));

        const moved = s.buildSentimentCopilotPrompt(
            { positive: report(82), negative: report(74.2), emotions: report(93.2) },
            Object.assign({ associateName: 'Angelina Fierro', prior: { positive: 78.4, negative: report(74), emotions: 93.4 } }, GOALS));
        t.check('a real move since the last report comes first' + tag,
            /Praise first: Positive Language moved the right way since the last report, up 3\.6 points \(78\.4% to 82%\)/.test(moved));
    });
});

suite('praise daily: the prompt never praises the focus as the closest goal', (t) => {
    const s = loadSentiment(t, true);
    // Managing Emotions has the widest gap in points (3.2) and is also the
    // nearest as a share of its goal, so "closest" would praise the focus.
    const prompt = s.buildSentimentCopilotPrompt(
        { positive: report(83), negative: report(80), emotions: report(91.8) },
        Object.assign({ associateName: 'Angelina Fierro' }, GOALS));
    t.check('the focus is Managing Emotions', /Focus on Managing Emotions/.test(prompt));
    const praise = (prompt.match(/Praise first: [^\n]*/) || [''])[0];
    t.check('the praise is somewhere else', praise.length > 0 && praise.indexOf('Managing Emotions') === -1);
    t.check('and is not called "the closest" when it is not', !/Positive Language is the closest/.test(praise) && /within 3 points of an 86% goal/.test(praise));
});
