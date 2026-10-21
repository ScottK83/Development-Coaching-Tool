'use strict';

const { suite } = require('./harness');

/**
 * HOW THE MESSAGES READ
 *
 * Scott, 2026-10-14, on a smoke test of 1,440 generated messages: "Think
 * about the wording. See if it comes off natural, celebratory, goal focused
 * if not meeting, etc. Think of the way they would receive the info. Offer
 * lots of kudos and praise. Make sure the numbers are simplified, and easy to
 * read as well."
 *
 * The pools are random, so every check here draws many messages and asserts
 * over all of them. What is held:
 *
 *   - two emojis a message at most, the opener's and the sign-off's;
 *   - a move is said in words ("down 40 seconds", "up 1.4 points"), never as
 *     "-40s" or "+0.9%", and no arrows;
 *   - dates read "Oct 13", never "10/13/2026"; "an 82% target", never "a 82";
 *   - the sign-off is the last thing a private message says, with the
 *     standings, the near-miss line and the team note above it;
 *   - a high five never carries a placing, names two extra wins at most, and
 *     with nothing on target thanks the effort instead of promising numbers;
 *   - a survey nobody answered is never a focus, and a thin survey sample is
 *     one item, not three wins;
 *   - a focus is always a number short of target;
 *   - a month is named ("in September"), and a month to date is "so far".
 */

const W2 = '2026-09-28|2026-10-02';
const W1 = '2026-10-05|2026-10-09';
const WIP = '2026-10-12|2026-10-13';
const SEP = '2026-09-01|2026-09-30';
const OCT = '2026-10-01|2026-10-13';
const Y1 = '2026-01-01|2026-09-30';
const Y2 = '2026-01-01|2026-10-13';

const EMOJI = /\p{Extended_Pictographic}/gu;
const emojiCount = (m) => (String(m).match(EMOJI) || []).length;

function row(name, base, shift, scale, extra) {
    const r = Object.assign({ name, totalCalls: 220, surveyTotal: 6, repSurveyTotal: 6, fcrSurveyTotal: 6 }, base);
    Object.keys(shift || {}).forEach(k => { r[k] = Math.round((r[k] + shift[k] * scale) * 10) / 10; });
    return Object.assign(r, extra || {});
}

// A struggling associate nobody surveyed, a star, one survey answered, a
// mixed week, and somebody with fourteen calls in the latest week.
const TEAM = {
    'Lupe Garcia': [{ scheduleAdherence: 88.2, aht: 604, acw: 70, holdTime: 66, overallSentiment: 85.1, positiveWord: 80.2, negativeWord: 81.0, managingEmotions: 93.0, cxRepOverall: 0, fcr: 0, overallExperience: 0, transfers: 9, surveyTotal: 0, repSurveyTotal: 0, fcrSurveyTotal: 0, totalCalls: 180 },
        { scheduleAdherence: -1.1, aht: 24, holdTime: 40, managingEmotions: -0.3 }],
    'Kristin Moore': [{ scheduleAdherence: 97.4, aht: 398, acw: 30, holdTime: 11, overallSentiment: 93.2, positiveWord: 91.0, negativeWord: 88.1, managingEmotions: 98.2, cxRepOverall: 100, fcr: 92, overallExperience: 96, transfers: 3.1, surveyTotal: 8, repSurveyTotal: 8, fcrSurveyTotal: 8, totalCalls: 260 },
        { scheduleAdherence: -0.8, aht: 19, acw: 19, holdTime: -6, cxRepOverall: -5, overallSentiment: -1.4 }],
    'Destiny Ruiz': [{ scheduleAdherence: 94.1, aht: 471, acw: 41, holdTime: 26, overallSentiment: 89.3, positiveWord: 84.8, negativeWord: 83.6, managingEmotions: 95.3, cxRepOverall: 100, fcr: 100, overallExperience: 100, transfers: 5.0, surveyTotal: 1, repSurveyTotal: 1, fcrSurveyTotal: 1, totalCalls: 210 },
        { scheduleAdherence: -2.0, aht: 41, overallSentiment: -0.9 }],
    'Alyssa Dimes': [{ scheduleAdherence: 95.1, aht: 564, acw: 55, holdTime: 63, overallSentiment: 92.7, positiveWord: 88.0, negativeWord: 85.0, managingEmotions: 96.0, cxRepOverall: 88.5, fcr: 80, overallExperience: 85, transfers: 6.5, surveyTotal: 5, repSurveyTotal: 5, fcrSurveyTotal: 5, totalCalls: 230 },
        { scheduleAdherence: -2.1, aht: -24, holdTime: 24, cxRepOverall: 6, overallSentiment: 0.5 }],
    'Christi Reyes': [{ scheduleAdherence: 96.0, aht: 415, acw: 35, holdTime: 18, overallSentiment: 91.0, positiveWord: 90.0, negativeWord: 87.0, managingEmotions: 97.0, cxRepOverall: 93, fcr: 85, overallExperience: 90, transfers: 4.0, surveyTotal: 12, repSurveyTotal: 12, fcrSurveyTotal: 12, totalCalls: 14 },
        { scheduleAdherence: -3.0, aht: 60, holdTime: 10, overallSentiment: -2.0 }]
};
const rows = (scale, extra) => Object.keys(TEAM).map(n => row(n, TEAM[n][0], TEAM[n][1], scale, extra ? extra(n) : null));

// The near-miss line celebrations writes, the way it writes it.
const CELEBRATIONS = {
    nearMissFor: () => ({ metricKey: 'negativeWord', label: 'Avoiding Negative Words', rank: 17, away: 2, bar: 15, value: 83.6 }),
    describeNearMiss: () => 'One more thing: you are 2 spots away from top 15 in Avoiding Negative Words. 83.6% has you at #17 in the Call Center.'
};

function loadTeam(t, options) {
    const opts = options || {};
    t.installFakeBrowser();
    t.pinClock('2026-10-14');
    global.weeklyData = {
        [W2]: { metadata: { periodType: 'week', startDate: '2026-09-28', endDate: '2026-10-02' }, employees: rows(2, n => (n === 'Christi Reyes' ? { totalCalls: 230 } : null)) },
        [W1]: { metadata: { periodType: 'week', startDate: '2026-10-05', endDate: '2026-10-09' }, employees: rows(1, n => (n === 'Christi Reyes' ? { totalCalls: 230 } : null)) },
        [WIP]: { metadata: { periodType: 'week-in-progress', startDate: '2026-10-12', endDate: '2026-10-13' }, employees: rows(0) },
        [SEP]: { metadata: { periodType: 'month', startDate: '2026-09-01', endDate: '2026-09-30' }, employees: rows(1.5, () => ({ totalCalls: 900 })) },
        [OCT]: { metadata: { periodType: 'month-to-date', startDate: '2026-10-01', endDate: '2026-10-13' }, employees: rows(0.3, () => ({ totalCalls: 500 })) }
    };
    global.ytdData = {
        [Y1]: { metadata: { periodType: 'ytd', startDate: '2026-01-01', endDate: '2026-09-30' }, employees: rows(1.2, () => ({ totalCalls: 30 })) },
        [Y2]: { metadata: { periodType: 'ytd', startDate: '2026-01-01', endDate: '2026-10-13' }, employees: rows(0.9, () => ({ totalCalls: 32 })) }
    };
    global.dailyData = {
        'd1|2026-10-12': { metadata: { periodType: 'daily', startDate: '2026-10-12', endDate: '2026-10-12' }, employees: rows(0, () => ({ totalCalls: 88 })) }
    };
    global.getWeeklyKeysSorted = () => [W2, W1, WIP];
    global.getEmployeeNickname = (n) => n.split(' ')[0];
    global.window.DevCoachModules.storage = { loadWeeklyData: () => global.weeklyData, loadYtdData: () => global.ytdData, loadDailyData: () => global.dailyData };
    const registry = t.loadModule('modules/metrics-registry.module.js');
    global.isReverseMetric = registry.metricsRegistryHelpers.isReverseMetric;
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.metricDelta = (key, cur, prev) => (global.isReverseMetric(key) ? prev - cur : cur - prev);
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/metric-trends.module.js');
    t.loadModule('modules/message-voice.module.js');
    t.loadModule('modules/period-index.module.js');
    t.loadModule('modules/year-standing.module.js');
    t.loadModule('modules/daily-outreach.module.js');
    global.window.DevCoachModules.periodComparison = { periodFor: (k) => global.ytdData[k] || null };
    if (opts.celebrations) global.window.DevCoachModules.celebrations = opts.celebrations;
    global.loadServerTips = async () => ({
        aht: ['Use hold only when you need to look something up', 'Practice this: summarize the next step before you close the call'],
        scheduleAdherence: ['Log in a couple of minutes before your shift starts'],
        overallSentiment: ['Use the customer name once or twice on each call'],
        holdTime: ['Tell the customer what you are checking before you place them on hold.']
    });
    const pulse = t.loadModule('modules/morning-pulse.module.js').morningPulse;
    return { pulse, outreach: global.window.DevCoachModules.dailyOutreach, voice: global.window.DevCoachModules.messageVoice };
}

// Leaves nothing behind for the suites that run after this file. A daily file
// left in global.dailyData shows up as a period in center-ranking's picker,
// which the rank ladder suites do not expect.
function cleanUp() {
    delete global.loadServerTips;
    delete global.metricMeetsTarget;
    delete global.getWeeklyKeysSorted;
    delete global.getEmployeeNickname;
    global.weeklyData = {};
    global.ytdData = {};
    global.dailyData = {};
}

const WINDOWS = {
    thisWeek: { windowId: 'thisWeek', unit: 'week', latestKey: WIP, baselineKey: W1, latestLabel: 'this week so far', baselineLabel: 'last week' },
    lastWeek: { windowId: 'lastWeek', unit: 'week', latestKey: W1, baselineKey: W2, latestLabel: 'last week', baselineLabel: 'the week before' },
    mtd: { windowId: 'mtd', unit: 'month', latestKey: OCT, baselineKey: SEP, latestLabel: 'October 2026 so far', baselineLabel: 'September 2026' },
    ytd: { windowId: 'ytd', unit: 'year', latestKey: Y2, baselineKey: Y1, latestLabel: 'the year so far', baselineLabel: 'the report through Sep 30' }
};

async function everything(pulse, outreach, times) {
    const out = [];
    const daily = pulse.collectDailyRowsThisWeek();
    const WED = new Date(2026, 9, 14, 9);
    for (let i = 0; i < times; i++) {
        for (const name of Object.keys(TEAM)) {
            for (const [wid, cmp] of Object.entries(WINDOWS)) {
                for (const planId of ['monday', 'tuesday', 'wednesday', 'friday']) {
                    out.push({ kind: 'private', wid, name, text: await pulse.buildOutreachMessage(outreach, outreach.planById(planId), name, cmp.latestKey, cmp.baselineKey, daily.byName.get(name) || null, cmp) });
                }
                out.push({ kind: 'highfive', wid, name, text: await pulse.generateHighFiveMessage(name, cmp.latestKey, cmp.baselineKey, { now: WED }) });
            }
            out.push({ kind: 'checkin', name, text: await pulse.generateCheckinMessage(name, W1, W2, { now: WED }) });
            out.push({ kind: 'midweek', name, text: await pulse.generateMidweekCheckinMessage(name, WIP, W1) });
            out.push({ kind: 'monthly', name, text: await pulse.generateMonthlyCheckinMessage(name, SEP, null) });
            for (const g of ['wow', 'ytd']) out.push({ kind: 'growth', name, text: await pulse.generateGrowthMessage(name, g) });
        }
    }
    return out.filter(m => m.text);
}

suite('pulse voice: every message keeps to two emojis and simple numbers', async (t) => {
    const { pulse, outreach, voice } = loadTeam(t, { celebrations: CELEBRATIONS });
    try {
        global.metricMeetsTarget = (key, v) => {
            const tg = global.METRICS_REGISTRY[key]?.target;
            return tg ? (tg.type === 'min' ? v >= tg.value : v <= tg.value) : false;
        };
        const all = await everything(pulse, outreach, 2);
        t.check(`a full round was written (${all.length})`, all.length > 150);

        const bad = (name, test) => {
            const hits = all.filter(m => test(m.text, m));
            t.equal(`${name} (${hits[0] ? hits[0].kind + ' ' + hits[0].name + ': ' + hits[0].text.slice(0, 140).replace(/\n/g, ' | ') : 'clean'})`, hits.length, 0);
        };
        bad('no message has more than two emojis', m => voice.countEmojis(m) > 2);
        bad('no move is written with a sign', m => /(^|[\s(])[-+]\d+(\.\d+)?(s|%)(?=[\s,.!)]|$)/.test(m));
        bad('no arrows', m => /→/.test(m));
        bad('no slash dates', m => /\d{2}\/\d{2}\/\d{4}/.test(m));
        bad('no "a 82%" or "a 88%"', m => /\ba (8\d|11|18)(\.\d)?%/.test(m));
        bad('no number ends in ".0"', m => /\d\.0(%|s\b)/.test(m));
        bad('no em or en dash', m => /[–—]/.test(m));
        bad('no data disclaimers', m => /landed in a file|newest full week|Not enough in yet|rather than a scorecard/i.test(m));
        bad('no column-label jargon', m => /\+Word|Avoid Neg\b|Volume \d/.test(m));
        bad('one label for negative words', m => /Avoiding Negative Words/.test(m));
        bad('never two "One more thing" lines', m => (m.match(/One more thing/g) || []).length > 1);
        bad('a tip always ends like a sentence', m => /Tip: [^\n]*[A-Za-z0-9]$/m.test(m));
        bad('no high five carries a placing', (m, x) => x.kind === 'highfive'
            && (/#\d+ in the call center/i.test(m) || /\d+(st|nd|rd|th) in the call center/i.test(m) || /\btop \d+\b/i.test(m)));
        bad('"doesn\'t happen by accident" at most once', m => (m.match(/happen by accident/g) || []).length > 1);
        bad('"What a run" at most once', m => (m.match(/What a run/g) || []).length > 1);
        bad('nobody unsurveyed hears about Rep Satisfaction', (m, x) => x.name === 'Lupe Garcia' && /Rep Satisfaction/.test(m));
        bad('a September review never says "this month\'s" or "next month"', (m, x) => x.kind === 'monthly' && /this month's|next month|September 2026/.test(m));

        // The sign-off closes every private message. The standings, the
        // near-miss line and the team note all sit above it.
        bad('the sign-off is the last paragraph', (m, x) => x.kind === 'private'
            && /Where you (stand|stood|finished)|One more thing, and it matters|Worth knowing:|Where the year stands|in the Call Center/.test(m.split('\n\n').slice(-1)[0]));
        const withNearMiss = all.filter(m => m.kind === 'private' && /Worth knowing: you are 2 spots away/.test(m.text));
        t.check('the private messages still carry the near-miss line', withNearMiss.length > 0);
    } finally {
        cleanUp();
    }
});

suite('pulse voice: the private round is plainer than it was', async (t) => {
    const { pulse, outreach } = loadTeam(t);
    try {
        const daily = pulse.collectDailyRowsThisWeek();
        const plan = outreach.planById('wednesday');

        // Last week window on a Wednesday: this week's dailies are a different
        // period, so they are left off, and the week is named plainly.
        const last = await pulse.buildOutreachMessage(outreach, plan, 'Lupe Garcia', W1, W2, daily.byName.get('Lupe Garcia'), WINDOWS.lastWeek);
        t.check('a Last week message carries no week-to-date recap', last.indexOf('Week to date') === -1);
        t.check('and names the week plainly', last.indexOf("Here's how last week went, next to two weeks ago.") > -1);

        // Under a month to date the standings speak of October as running.
        const mtd = await pulse.buildOutreachMessage(outreach, outreach.planById('monday'), 'Alyssa Dimes', OCT, SEP, null, WINDOWS.mtd);
        t.check('the opener names October against September', /your October/.test(mtd.split('\n')[0]) && /September/.test(mtd.split('\n')[0]));
        t.check('a "Better than September" line, in words', /Better than September: [^\n]*(up|down) from \d/.test(mtd));
    } finally {
        cleanUp();
    }
});

suite('pulse voice: the daily recap says itself in plain words', (t) => {
    t.installFakeBrowser();
    t.loadModule('modules/period-index.module.js');
    const outreach = t.loadModule('modules/daily-outreach.module.js').dailyOutreach;
    const metrics = [
        { key: 'totalCalls', label: 'Calls', say: v => `${v} calls` },
        { key: 'aht', label: 'Handle time', say: v => `handle time ${v}` },
        { key: 'scheduleAdherence', label: 'Adherence', say: v => `adherence ${v}` }
    ];
    const recap = outreach.buildDailyRecap(outreach.PLANS.wednesday, { totalCalls: 88, aht: 471, scheduleAdherence: 91.8 },
        { metrics, formatValue: (k, v) => (k === 'aht' ? `${v}s` : k === 'totalCalls' ? String(v) : `${v}%`), dayCount: 2 });
    t.equal('calls, handle time, adherence', recap, 'Week to date (2 days in): 88 calls, handle time 471s, adherence 91.8%.');
});

/* ── The high five ── */

function loadOne(t, emp, base, metrics, extra) {
    t.installFakeBrowser();
    t.pinClock('2026-10-14');
    global.weeklyData = {
        [W2]: { metadata: { periodType: 'week', startDate: '2026-09-28', endDate: '2026-10-02' }, employees: [base] },
        [W1]: { metadata: { periodType: 'week', startDate: '2026-10-05', endDate: '2026-10-09' }, employees: [emp] }
    };
    global.ytdData = (extra && extra.ytd) || {};
    global.dailyData = {};
    const registry = t.loadModule('modules/metrics-registry.module.js');
    global.isReverseMetric = registry.metricsRegistryHelpers.isReverseMetric;
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.metricDelta = (key, cur, prev) => (global.isReverseMetric(key) ? prev - cur : cur - prev);
    global.window.analyzeTrendMetrics = (e, c, y, p, ctx) => ({
        allMetrics: (ctx && ctx.periodType === 'ytd' && extra && extra.ytdMetrics) ? extra.ytdMetrics : metrics
    });
    t.loadModule('modules/message-voice.module.js');
    if (extra && extra.celebrations) global.window.DevCoachModules.celebrations = extra.celebrations;
    if (extra && extra.tips) global.loadServerTips = async () => extra.tips;
    return t.loadModule('modules/morning-pulse.module.js').morningPulse;
}

const M = (metricKey, label, value, target, type, meets, classification) => ({
    metricKey, label, employeeValue: value, target, targetType: type, meetsTarget: meets,
    classification: classification || (meets ? 'On Track' : 'Needs Focus'),
    gapFromTarget: meets ? 0 : Math.abs(value - target)
});

async function drawHighFives(pulse, times, name) {
    const out = [];
    for (let i = 0; i < times; i++) out.push(await pulse.generateHighFiveMessage(name || 'Sam Lee', W1, W2, { now: new Date(2026, 9, 14) }));
    return out;
}

suite('pulse voice: a high five names two extra wins, then counts', async (t) => {
    const emp = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 9, repSurveyTotal: 9, fcrSurveyTotal: 9 };
    const nine = [
        M('aht', 'Average Handle Time', 400, 426, 'max', true), M('scheduleAdherence', 'Schedule Adherence', 96, 93, 'min', true),
        M('overallSentiment', 'Overall Sentiment', 92, 88, 'min', true), M('cxRepOverall', 'Rep Satisfaction', 90, 82, 'min', true),
        M('positiveWord', 'Positive Word', 90, 86, 'min', true), M('negativeWord', 'Avoid Negative Words', 88, 83, 'min', true),
        M('managingEmotions', 'Managing Emotions', 97, 95, 'min', true), M('acw', 'After Call Work', 40, 60, 'max', true),
        M('holdTime', 'Hold Time', 20, 30, 'max', true), M('transfers', 'Transfers', 8, 6, 'max', false)
    ];
    const pulse = loadOne(t, emp, Object.assign({}, emp), nine);
    const drawn = await drawHighFives(pulse, 120);
    const mentions = m => (m.match(/ at \d/g) || []).length + (m.match(/ \(\d+(\.\d+)?(s|%)\)/g) || []).length;
    t.check('four wins by name at most (two leading, two extra)', drawn.every(m => mentions(m) <= 4));
    t.check('the rest are counted', drawn.every(m => /\d+ more goals? on target/.test(m)));
    t.equal('not everything is on target, so no "perfect run"', drawn.filter(m => /perfect run|nothing left to ask for/.test(m)).length, 0);
    t.check('scorecard metrics lead', drawn.every(m => /Average Handle Time|Schedule Adherence|Overall Sentiment|Rep Satisfaction/.test(m.split('\n')[0])));

    const sweep = loadOne(t, emp, Object.assign({}, emp), nine.slice(0, 9));
    const swept = await drawHighFives(sweep, 80);
    t.check('everything on target may be called the perfect run', swept.some(m => /perfect run|nothing left to ask for/.test(m)));
    t.check('and the rest are "every other goal"', swept.every(m => /every other goal too/.test(m)));
});

suite('pulse voice: one survey is one item, not three wins', async (t) => {
    const emp = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 1, repSurveyTotal: 1, fcrSurveyTotal: 1 };
    const metrics = [
        M('cxRepOverall', 'Rep Satisfaction', 100, 82, 'min', true), M('fcr', 'First Call Resolution', 100, 73, 'min', true),
        M('overallExperience', 'Overall Experience', 100, 75, 'min', true),
        M('aht', 'Average Handle Time', 420, 426, 'max', true), M('scheduleAdherence', 'Schedule Adherence', 94, 93, 'min', true),
        M('overallSentiment', 'Overall Sentiment', 90, 88, 'min', true), M('holdTime', 'Hold Time', 40, 30, 'max', false)
    ];
    const pulse = loadOne(t, emp, Object.assign({}, emp), metrics);
    const drawn = await drawHighFives(pulse, 120);
    const surveyNames = m => ['Rep Satisfaction', 'First Call Resolution', 'Overall Experience'].filter(l => m.indexOf(l) > -1).length;
    t.check('at most one survey metric is named', drawn.every(m => surveyNames(m) <= 1));
    // Four on target out of five countable (the three surveys are one).
    t.check('the count is over five goals, not seven', drawn.every(m => !/\b(of|out of) 7\b/.test(m)));
    t.check('and never inflated past it', drawn.filter(m => /\b(of|out of) 5\b/.test(m)).every(m => /\b4 (of|out of) 5\b/.test(m)));
    // The first metric the praise names is one measured on calls.
    const LABELS = ['Rep Satisfaction', 'First Call Resolution', 'Overall Experience', 'Average Handle Time', 'Schedule Adherence', 'Overall Sentiment'];
    const firstNamed = m => LABELS.map(l => ({ l, at: m.indexOf(l) })).filter(x => x.at > -1).sort((a, b) => a.at - b.at)[0];
    t.check('and the one survey does not lead the praise',
        drawn.every(m => { const f = firstNamed(m); return f && ['Rep Satisfaction', 'First Call Resolution', 'Overall Experience'].indexOf(f.l) === -1; }));
});

suite('pulse voice: with nothing on target, the high five thanks the effort', async (t) => {
    const emp = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0 };
    const metrics = [
        M('scheduleAdherence', 'Schedule Adherence', 88.2, 93, 'min', false), M('aht', 'Average Handle Time', 604, 426, 'max', false),
        M('overallSentiment', 'Overall Sentiment', 84, 88, 'min', false), M('cxRepOverall', 'Rep Satisfaction', 0, 82, 'min', false)
    ];
    const pulse = loadOne(t, Object.assign({ aht: 604 }, emp), Object.assign({ aht: 600 }, emp), metrics);
    const drawn = await drawHighFives(pulse, 150);
    t.equal('no opener promises numbers', drawn.filter(m => /need to see these numbers|highlight your numbers|What a run|Pulled your numbers/.test(m)).length, 0);
    t.equal('no closer assumes a strong week', drawn.filter(m => /Hard to top|stacking numbers|What a run|standard now|Heck of a run/.test(m)).length, 0);
    t.check('one goal is named, gently', drawn.every(m => /goal/.test(m) && /corner|with you|got your back/.test(m)));
    t.check('the closest goal, not the worst', drawn.every(m => /Overall Sentiment|Schedule Adherence/.test(m) && !/Average Handle Time is/.test(m)));
    t.equal('nobody surveyed hears about rep satisfaction', drawn.filter(m => /Rep Satisfaction/.test(m)).length, 0);
    t.check('two emojis at most', drawn.every(m => emojiCount(m) <= 2));
});

suite('pulse voice: a rate jump needs real volume and a real move', async (t) => {
    const metrics = [M('aht', 'Average Handle Time', 410, 426, 'max', true), M('managingEmotions', 'Managing Emotions', 94.3, 95, 'min', false)];
    // Fourteen calls in the latest week: a 60 second drop is not a move.
    const thin = loadOne(t, { name: 'Sam Lee', totalCalls: 14, aht: 410, managingEmotions: 94.3 }, { name: 'Sam Lee', totalCalls: 240, aht: 470, managingEmotions: 94.0 }, metrics);
    const thinDrawn = await drawHighFives(thin, 60);
    t.equal('no jump off fourteen calls', thinDrawn.filter(m => /seconds/.test(m)).length, 0);

    // A 0.3 point move in Managing Emotions is under its noise floor.
    const small = loadOne(t, { name: 'Sam Lee', totalCalls: 240, aht: 410, managingEmotions: 94.3 }, { name: 'Sam Lee', totalCalls: 240, aht: 412, managingEmotions: 94.0 }, metrics);
    const smallDrawn = await drawHighFives(small, 60);
    t.equal('no "crushed it" on a 0.3 point move', smallDrawn.filter(m => /Managing Emotions[^\n]*0\.3/.test(m)).length, 0);

    // A real move is said in words, with both numbers.
    const real = loadOne(t, { name: 'Sam Lee', totalCalls: 240, holdTime: 26, aht: 410 }, { name: 'Sam Lee', totalCalls: 240, holdTime: 66, aht: 412 },
        [M('holdTime', 'Hold Time', 26, 30, 'max', true), M('aht', 'Average Handle Time', 410, 426, 'max', true)]);
    const realDrawn = await drawHighFives(real, 60);
    t.check('"Hold Time ... down 40 seconds (66s to 26s)"', realDrawn.every(m => /Hold Time[^\n]*down 40 seconds/.test(m) && m.indexOf('(66s to 26s)') > -1));
    t.equal('never "Hold Time at -40s"', realDrawn.filter(m => /at -\d|-40s/.test(m)).length, 0);
});

suite('pulse voice: a high five never carries a placing', async (t) => {
    const emp = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0 };
    const metrics = [M('scheduleAdherence', 'Schedule Adherence', 95, 93, 'min', true), M('negativeWord', 'Avoid Negative Words', 83.6, 83, 'min', true)];
    const pulse = loadOne(t, emp, Object.assign({}, emp), metrics, { celebrations: CELEBRATIONS });
    const drawn = await drawHighFives(pulse, 100);
    t.equal('no "#17 in the Call Center"', drawn.filter(m => /#\d+ in the call center/i.test(m)).length, 0);
    t.equal('no "top 15"', drawn.filter(m => /\btop \d+\b/i.test(m)).length, 0);
});

/* ── Focus, check-in, monthly, growth ── */

suite('pulse voice: an on-target metric is never the focus', async (t) => {
    const emp = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 8, repSurveyTotal: 8 };
    // Rep Satisfaction dipped but is six points over target: Watch Area, met.
    const metrics = [
        M('cxRepOverall', 'Rep Satisfaction', 88.5, 82, 'min', true, 'Watch Area'),
        M('aht', 'Average Handle Time', 440, 426, 'max', false),
        M('scheduleAdherence', 'Schedule Adherence', 95, 93, 'min', true)
    ];
    const pulse = loadOne(t, emp, Object.assign({}, emp), metrics);
    const out = [];
    for (let i = 0; i < 60; i++) {
        out.push(await pulse.generateCheckinMessage('Sam Lee', W1, W2, { now: new Date(2026, 9, 14) }));
        out.push(await pulse.generateMondayKickoffMessage('Sam Lee', W1, W2, { now: new Date(2026, 9, 14) }));
    }
    t.equal('Rep Satisfaction is never said to have slipped or dipped', out.filter(m => /Rep Satisfaction (slipped|dipped|has slipped|has dipped|landed)/.test(m)).length, 0);
    t.check('the focus is the metric really short of target', out.every(m => /Average Handle Time/.test(m.split('\n\n').slice(1).join(' '))));
});

suite('pulse voice: the check-in credits a move before it asks for more', async (t) => {
    const emp = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0, aht: 470 };
    const base = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0, aht: 511 };
    const metrics = [M('aht', 'Average Handle Time', 470, 426, 'max', false), M('scheduleAdherence', 'Schedule Adherence', 95, 93, 'min', true)];
    const pulse = loadOne(t, emp, base, metrics, { tips: { aht: ['Use hold only when you need to look something up'] } });
    try {
        const out = [];
        for (let i = 0; i < 80; i++) out.push(await pulse.generateCheckinMessage('Sam Lee', W1, W2, { now: new Date(2026, 9, 14) }));
        t.check('the move leads, in words', out.every(m => /Average Handle Time[^\n]*down 41 seconds/i.test(m)));
        t.equal('and the same metric is not scolded under it',
            out.filter(m => /needs real attention|turn this around|keeps missing|pattern, not a blip/.test(m)).length, 0);
        t.check('it is given the next stop instead', out.every(m => /next stop/i.test(m)));
        t.check('"last week" twice at most', out.every(m => (m.match(/last week/g) || []).length <= 2));
        t.check('the tip reads "Tip: ..." and ends with a full stop', out.every(m => /Tip: Use hold only when you need to look something up\./.test(m)));
    } finally {
        cleanUp();
    }
});

suite('pulse voice: the check-in says so when every goal is on target', async (t) => {
    const emp = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 6, repSurveyTotal: 6, fcrSurveyTotal: 6 };
    const metrics = [
        M('aht', 'Average Handle Time', 400, 426, 'max', true), M('scheduleAdherence', 'Schedule Adherence', 96, 93, 'min', true),
        M('overallSentiment', 'Overall Sentiment', 92, 88, 'min', true), M('cxRepOverall', 'Rep Satisfaction', 100, 82, 'min', true),
        M('fcr', 'First Call Resolution', 100, 73, 'min', true), M('holdTime', 'Hold Time', 20, 30, 'max', true)
    ];
    const pulse = loadOne(t, emp, Object.assign({}, emp), metrics);
    const out = [];
    for (let i = 0; i < 60; i++) out.push(await pulse.generateCheckinMessage('Sam Lee', W1, W2, { now: new Date(2026, 9, 14) }));
    t.check('a full sweep is said as one', out.every(m => /every one of your 6 goals|all 6 of your goals|all 6 of them/i.test(m)));
    t.check('and six perfect surveys are celebrated as surveys', out.every(m => /6 surveys/.test(m)));
});

suite('pulse voice: the focus on a lower-is-better metric names the target, not a direction', (t) => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(require('./harness').ROOT, 'modules/morning-pulse.module.js'), 'utf8');
    t.equal('no pool asks to "pull the YTD back up"', src.indexOf('pull the YTD back up'), -1);
    t.equal('nor to pull "that number up"', src.indexOf('pulling that number up'), -1);
});

suite('pulse voice: a September review on October 14 says September', async (t) => {
    const emp = { name: 'Sam Lee', totalCalls: 900, surveyTotal: 0, aht: 470 };
    const metricsGood = [
        M('aht', 'Average Handle Time', 410, 426, 'max', true), M('scheduleAdherence', 'Schedule Adherence', 96, 93, 'min', true),
        M('overallSentiment', 'Overall Sentiment', 92, 88, 'min', true), M('holdTime', 'Hold Time', 20, 30, 'max', true)
    ];
    const metricsTough = [
        M('aht', 'Average Handle Time', 520, 426, 'max', false), M('scheduleAdherence', 'Schedule Adherence', 89, 93, 'min', false),
        M('overallSentiment', 'Overall Sentiment', 84, 88, 'min', false), M('holdTime', 'Hold Time', 40, 30, 'max', false)
    ];
    const load = (metrics) => {
        const pulse = loadOne(t, emp, emp, metrics);
        global.weeklyData = {
            'm8': { metadata: { periodType: 'month', startDate: '2026-08-01', endDate: '2026-08-31' }, employees: [Object.assign({}, emp, { aht: 520 })] },
            'm9': { metadata: { periodType: 'month', startDate: '2026-09-01', endDate: '2026-09-30' }, employees: [emp] }
        };
        return pulse;
    };
    const good = load(metricsGood);
    const goodOut = [];
    for (let i = 0; i < 60; i++) goodOut.push(await good.generateMonthlyCheckinMessage('Sam Lee', 'm9', 'm8'));
    t.equal('never "this month\'s" or "last month\'s"', goodOut.filter(m => /this month's|last month's/.test(m)).length, 0);
    t.equal('never "next month"', goodOut.filter(m => /next month/i.test(m)).length, 0);
    t.equal('"September", not "September 2026"', goodOut.filter(m => /September 2026/.test(m)).length, 0);
    t.check('the jump is September\'s', goodOut.every(m => /in September/.test(m)));
    t.check('a sweep of the scorecard is celebrated', goodOut.every(m => /clean sweep|Doesn't get better/.test(m)));

    const tough = load(metricsTough);
    const toughOut = [];
    for (let i = 0; i < 60; i++) toughOut.push(await tough.generateMonthlyCheckinMessage('Sam Lee', 'm9', 'm8'));
    t.equal('nothing on target is not counted out loud', toughOut.filter(m => /\b0 of\b/.test(m)).length, 0);
    t.equal('and is not signed off as a solid month', toughOut.filter(m => /Solid month overall|even better month/.test(m)).length, 0);
    t.check('the focus looks ahead to October', toughOut.every(m => /October|going forward|biggest opportunity/.test(m)));
});

suite('pulse voice: growth says what moved, in the right tone', async (t) => {
    const metrics = [M('aht', 'Average Handle Time', 520, 426, 'max', false), M('scheduleAdherence', 'Schedule Adherence', 89, 93, 'min', false)];
    const down = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0, aht: 520, scheduleAdherence: 89 };
    const before = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0, aht: 480, scheduleAdherence: 93 };
    const pulse = loadOne(t, down, before, metrics);
    global.window.DevCoachModules.periodIndex = { currentIndex: () => ({}), weekLikeKeys: () => [W2, W1], keysOfType: () => [] };
    const out = [];
    for (let i = 0; i < 60; i++) out.push(await pulse.generateGrowthMessage('Sam Lee', 'wow'));
    t.check('a message was written', out.every(Boolean));
    t.equal('no rising chart over an all-decline message', out.filter(m => /📈/.test(m)).length, 0);
    t.equal('no "Keep climbing"', out.filter(m => /Keep climbing/.test(m)).length, 0);
    t.check('the weeks are named by their first day', out.every(m => /the week of Oct 5/.test(m) && /the week of Sep 28/.test(m)));
    t.check('moves in words', out.every(m => /Average Handle Time: up 40 seconds \(480s to 520s\)/.test(m)));

    const flat = loadOne(t, before, Object.assign({}, before), metrics);
    global.window.DevCoachModules.periodIndex = { currentIndex: () => ({}), weekLikeKeys: () => [W2, W1], keysOfType: () => [] };
    const flatOut = [];
    for (let i = 0; i < 40; i++) flatOut.push(await flat.generateGrowthMessage('Sam Lee', 'wow'));
    t.equal('a flat period is not "Keep climbing"', flatOut.filter(m => /Keep climbing/.test(m)).length, 0);
    t.equal('nor a regroup', flatOut.filter(m => /regroup|got in the way/.test(m)).length, 0);
});

suite('pulse voice: a focus is never a zero-survey metric, in any generator', async (t) => {
    const emp = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0, repSurveyTotal: 0, cxRepOverall: 0, aht: 430, scheduleAdherence: 95 };
    const metrics = [
        M('cxRepOverall', 'Rep Satisfaction', 0, 82, 'min', false),
        M('aht', 'Average Handle Time', 430, 426, 'max', false),
        M('scheduleAdherence', 'Schedule Adherence', 95, 93, 'min', true)
    ];
    const pulse = loadOne(t, emp, Object.assign({}, emp, { aht: 432 }), metrics);
    global.window.DevCoachModules.periodIndex = { currentIndex: () => ({}), weekLikeKeys: () => [W2, W1], keysOfType: () => [] };
    global.window.DevCoachModules.dailyOutreach = null;
    t.loadModule('modules/daily-outreach.module.js');
    const out = [];
    for (let i = 0; i < 30; i++) {
        out.push(await pulse.generateGrowthMessage('Sam Lee', 'wow'));
        out.push(await pulse.generateCheckinMessage('Sam Lee', W1, W2));
        out.push(await pulse.generateWeekProgressMessage('Sam Lee', W1, W2, { tone: 'midweek', latestIsThisWeek: false }));
        out.push(await pulse.generateMondayKickoffMessage('Sam Lee', W1, W2));
    }
    t.check('every generator wrote something', out.every(Boolean));
    t.equal('Rep Satisfaction is never named', out.filter(m => /Rep Satisfaction/.test(m)).length, 0);
});

/* ── The standings block over a month or a year ── */

function loadStandings(t, latestKey, meta) {
    t.installFakeBrowser();
    t.pinClock('2026-10-14');
    global.weeklyData = { [latestKey]: { metadata: meta, employees: [{ name: 'Dana Reed', totalCalls: 900, surveyTotal: 40, aht: 422, scheduleAdherence: 93.9 }] } };
    global.ytdData = {};
    global.dailyData = {};
    const registry = t.loadModule('modules/metrics-registry.module.js');
    global.isReverseMetric = registry.metricsRegistryHelpers.isReverseMetric;
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.window.analyzeTrendMetrics = () => ({ allMetrics: [] });
    t.loadModule('modules/rank-projection.module.js');
    const rows = [];
    for (let i = 0; i < 29; i++) {
        rows.push({ name: 'Peer ' + i, totalCalls: 900, surveyTotal: 40, metricRanks: {}, values: { aht: 401 + i * 2, adherence: 96 - i * 0.25, sentiment: 95 - i * 0.2, associateOverall: 92 - i * 0.3 }, extraValues: {} });
    }
    rows.push({ name: 'Dana Reed', totalCalls: 900, surveyTotal: 40, metricRanks: {}, values: { aht: 422, adherence: 93.9, sentiment: 90.1, associateOverall: 88 }, extraValues: {} });
    global.window.DevCoachModules.centerRanking = {
        buildRankingsForPeriod: () => ({ rankings: rows, totalEmployees: rows.length, periodKey: latestKey, teamMembers: new Set(['Dana Reed', 'Peer 2', 'Peer 6', 'Peer 10']) })
    };
    return t.loadModule('modules/morning-pulse.module.js').morningPulse;
}

suite('pulse voice: a month is named, and a running one is spoken of as running', (t) => {
    const oct = loadStandings(t, OCT, { periodType: 'month-to-date', startDate: '2026-10-01', endDate: '2026-10-13' })
        .buildStandingsBlock('Dana Reed', OCT);
    t.check('"Where you stand in October so far"', oct.indexOf('Where you stand in October so far') === 0);
    t.check('the milestones look forward over the month', /could still move up about \d+ places this month\./.test(oct));
    t.equal('nothing is "would have finished"', oct.indexOf('would have finished'), -1);
    t.equal('no week words on a month', oct.indexOf('the week'), -1);

    const sep = loadStandings(t, SEP, { periodType: 'month', startDate: '2026-09-01', endDate: '2026-09-30' })
        .buildStandingsBlock('Dana Reed', SEP);
    t.check('"Where you finished in September"', sep.indexOf('Where you finished in September') === 0);
    t.check('and its milestones are in the past', sep.indexOf('would have finished') > -1);

    const year = loadStandings(t, Y2, { periodType: 'ytd', startDate: '2026-01-01', endDate: '2026-10-13' })
        .buildStandingsBlock('Dana Reed', Y2);
    t.check('the year so far is running too', year.indexOf('Where you stand for the year so far') === 0);
    t.check('"Call Center", capitalised', /in the Call Center/.test(year) && !/in the call center/.test(year));
});

/* ── The year block ── */

suite('pulse voice: the year block reads the year and never contradicts a placing', async (t) => {
    const emp = { name: 'Sam Lee', totalCalls: 240, surveyTotal: 0, aht: 470, scheduleAdherence: 97 };
    const weekMetrics = [
        M('aht', 'Average Handle Time', 470, 426, 'max', false),
        M('scheduleAdherence', 'Schedule Adherence', 97, 93, 'min', true),
        M('overallSentiment', 'Overall Sentiment', 85, 88, 'min', false)
    ];
    const ytdMetrics = [
        M('aht', 'Average Handle Time', 455, 426, 'max', false),
        M('scheduleAdherence', 'Schedule Adherence', 92.1, 93, 'min', false),
        M('overallSentiment', 'Overall Sentiment', 86.4, 88, 'min', false)
    ];
    const ytd = {
        'y1|2026-09-30': { metadata: { periodType: 'ytd', endDate: '2026-09-30' }, employees: [Object.assign({}, emp)] },
        'y2|2026-10-13': { metadata: { periodType: 'ytd', endDate: '2026-10-13' }, employees: [Object.assign({}, emp)] }
    };
    const pulse = loadOne(t, emp, Object.assign({}, emp, { aht: 472 }), weekMetrics, { ytd, ytdMetrics });
    t.loadModule('modules/year-standing.module.js');
    // AHT slipped but is still 2nd of 60; adherence and sentiment slipped
    // well down the floor.
    global.window.DevCoachModules.yearStanding.gatherYearMovement = () => ({
        earlier: { aht: 1, adherence: 10, sentiment: 12 },
        current: { aht: 2 + 6, adherence: 40, sentiment: 45 },
        fieldSize: 60
    });
    const out = [];
    for (let i = 0; i < 40; i++) out.push(await pulse.generateMondayKickoffMessage('Sam Lee', W1, W2, { now: new Date(2026, 9, 14) }));
    const blocks = out.map(m => (m.split('Where the year stands')[1] || '').split('\n\n')[0]);
    t.check('a year block was written', blocks.every(b => b.length > 0));
    t.check('it prints the year\'s number, not the week\'s', blocks.every(b => b.indexOf('92.1%') > -1 && b.indexOf('97%') === -1));
    t.equal('a metric in the top third is not called slipping', blocks.filter(b => /Average Handle Time/.test(b)).length, 0);
    t.check('and under a focus, one slip at most', blocks.every(b => (b.match(/passing you|losing ground|moving ahead of you/g) || []).length <= 1));
    t.check('the run-in is counted in weeks, and encouraging', out.every(m => /About 11 weeks left in the year/.test(m) && !/decides it/.test(m)));
});

/* ── The team note and the near-miss line ── */

suite('pulse voice: one "One more thing" per message', async (t) => {
    const { pulse, outreach } = loadTeam(t, { celebrations: CELEBRATIONS });
    try {
        // No note is built in any more (Scott, 2026-10-21), so the test writes
        // one that opens the way the near-miss line used to.
        pulse.saveTeamNote({ text: 'One more thing, and it matters. Let\'s finish the year strong together.', who: 'missing' });
        const out = [];
        for (let i = 0; i < 20; i++) {
            out.push(await pulse.buildOutreachMessage(outreach, outreach.planById('monday'), 'Lupe Garcia', W1, W2, null, WINDOWS.lastWeek));
        }
        t.check('the team note is there for somebody missing adherence', out.every(m => /One more thing, and it matters/.test(m)));
        t.check('the near-miss line is too', out.every(m => /Worth knowing: you are 2 spots away/.test(m)));
        t.check('and only one of them opens "One more thing"', out.every(m => (m.match(/One more thing/g) || []).length === 1));
        t.check('the near-miss line uses the registry\'s label', out.every(m => /Avoid Negative Words/.test(m) && !/Avoiding Negative Words/.test(m)));
    } finally {
        pulse.saveTeamNote({ text: '', who: 'missing' });
        cleanUp();
    }
});

// Runs last in this file, whatever happened above it.
suite('pulse voice: leaves no globals behind', (t) => {
    cleanUp();
    t.check('no daily files left over', Object.keys(global.dailyData).length === 0);
    t.check('no tips loader left over', typeof global.loadServerTips === 'undefined');
});
