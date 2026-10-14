'use strict';

/**
 * How the quarterly check-in reads to the person it is about.
 *
 * Scott, 2026-10-14: "Think about the wording. See if it comes off natural,
 * celebratory, goal focused if not meeting, etc. Think of the way they would
 * receive the info. Offer lots of kudos and praise. Make sure the numbers are
 * simplified, and easy to read as well."
 *
 * A smoke test of eight associates found the file note telling a struggling
 * associate he "held the quarter steady with no metric moving far in either
 * direction" directly above "handle time climbed in each quarter", a
 * strengths box of four sentences of figures with no recognition in it,
 * three perfect quarters undersold as "held steady", handle time that came
 * down every quarter called steady, and the same closing sentences word for
 * word across the team. These pin the fixes, run through the app's real
 * number formatter so "93%" is what a reader actually sees.
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

function load(t, store, history) {
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
    const h = history || {};
    global.coachingHistory = h.coaching || {};
    global.window.coachingHistory = global.coachingHistory;
    global.callListeningLogs = h.calls || {};
    global.window.callListeningLogs = global.callListeningLogs;

    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.SURVEY_WEIGHT_FIELD = global.window.SURVEY_WEIGHT_FIELD;
    // The real formatter, so a whole number prints the way it does in the
    // app ("93%", not "93.0%").
    t.loadModule('modules/metric-trends.module.js');
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/period-compare.module.js');
    t.loadModule('modules/quarter-trend.module.js');
    return t.loadModule('modules/quarter-review.module.js').quarterReview;
}

function ctxFor(t, store, name, history) {
    const qr = load(t, store, history);
    return { qr, ctx: qr.buildContext(name, 2026, { throughQuarter: 3, preparedOn: '2026-10-14' }) };
}

// Nothing at goal. Handle time climbing, rep satisfaction rising to its best
// quarter, transfers over goal, the rest short. Hours over the allowance.
const CARLOS = year('Carlos Diaz',
    { aht: 440, scheduleAdherence: 91.5, overallSentiment: 85, cxRepOverall: 74.2, fcr: 70, overallExperience: 70, transfers: 8, transfersCount: 40, reliability: 8 },
    { aht: 452, scheduleAdherence: 91.0, overallSentiment: 85.4, cxRepOverall: 71.9, fcr: 69, overallExperience: 71, transfers: 8.3, transfersCount: 41.5, reliability: 8 },
    { aht: 465, scheduleAdherence: 91.2, overallSentiment: 85.2, cxRepOverall: 76.5, fcr: 70.5, overallExperience: 70, transfers: 8.1, transfersCount: 40.5, reliability: 7 });

const CARLOS_HISTORY = {
    coaching: { 'Carlos Diaz': [
        { generatedAt: '2026-05-01T10:00:00Z', metricsCoached: ['aht'] },
        { generatedAt: '2026-07-01T10:00:00Z', metricsCoached: ['cxRepOverall'] },
        { generatedAt: '2026-08-01T10:00:00Z', metricsCoached: [] }
    ] },
    calls: { 'Carlos Diaz': [{ listenedOn: '2026-07-10' }, { listenedOn: '2026-08-10' }] }
};

// Zero surveys all year. Handle time 446s, 442s, 439s: down every quarter,
// inside the 8 second band. Adherence 96.5%. Five hours for the year.
const ELI = year('Eli Brooks',
    { aht: 446, scheduleAdherence: 96.5, surveyTotal: 0, repSurveyTotal: 0, fcrSurveyTotal: 0, cxRepOverall: 0, fcr: 0, overallExperience: 0, reliability: 2 },
    { aht: 442, scheduleAdherence: 96.4, surveyTotal: 0, repSurveyTotal: 0, fcrSurveyTotal: 0, cxRepOverall: 0, fcr: 0, overallExperience: 0, reliability: 1.5 },
    { aht: 439, scheduleAdherence: 96.6, surveyTotal: 0, repSurveyTotal: 0, fcrSurveyTotal: 0, cxRepOverall: 0, fcr: 0, overallExperience: 0, reliability: 1.5 });

// Everything at goal, rep satisfaction a perfect 100% every quarter.
const FAITH = year('Faith Moore',
    { aht: 400, scheduleAdherence: 95, cxRepOverall: 100, overallSentiment: 93, reliability: 12 },
    { aht: 395, scheduleAdherence: 95.5, cxRepOverall: 100, overallSentiment: 94, reliability: 12 },
    { aht: 398, scheduleAdherence: 96.2, cxRepOverall: 100, overallSentiment: 94.5, reliability: 10.5 });

// At goal in Q1 and Q2, a first dip in Q3 on handle time and adherence.
const DANA = year('Dana Dip',
    { aht: 410, scheduleAdherence: 94.5 }, { aht: 405, scheduleAdherence: 94.1 }, { aht: 431, scheduleAdherence: 92.7 });

const NO_POINT_ZERO = /\d\.0(%|s\b| hrs?\b)/;

/* ── A hard quarter still has a first box ── */

suite('review voice: a struggling file note credits the progress and the work', (t) => {
    t.pinClock('2026-10-14');
    const { qr, ctx } = ctxFor(t, CARLOS, 'Carlos Diaz', CARLOS_HISTORY);
    const notes = qr.buildNotes(ctx);

    t.equal('nothing is at goal', qr.splitForBoxes(ctx).strengths.length, 0);
    t.check('box 1 never claims the quarter held steady',
        !/held the quarter steady|nothing moving far|no metric moving/i.test(notes.box1));
    t.check('it credits the rise in rep satisfaction, by name, as the best quarter of the year',
        notes.box1.indexOf('Carlos lifted rep satisfaction from 71.9% in Q2 to 76.5% in Q3, the best quarter of the year.') === 0);
    t.check('a second rise leads on the metric, not "Carlos lifted" twice',
        /First call resolution also came up, from 69% in Q2 to 70\.5% in Q3/.test(notes.box1)
        && (notes.box1.match(/Carlos lifted/g) || []).length === 1);
    t.check('and the work put in is recognised',
        /Carlos has put real work in, with 3 coaching conversations and 2 calls reviewed together/.test(notes.box1));
    t.check('hours over the allowance are in neither box', !/hrs|allowance|missed time/.test(notes.box1 + notes.box2));

    // The close names the metric it is about, so "This" can never point at
    // the sentence above it instead.
    t.check('the close names handle time', /Handle time is the one to move first\./.test(notes.box2));
    t.check('and sets the goal for the next quarter', /the goal for Q4 is to turn it back toward 426s\./.test(notes.box2));
    t.check('no unnamed "This is the one"', !/This is the one/.test(notes.box2));
    t.check('no old template', !/expectation is visible movement over one quarter/.test(notes.box2));

    const prompt = qr.buildPrompt(ctx);
    t.check('Copilot is not told "nothing moving far either way"', !/nothing moving far either way/i.test(prompt));
    t.check('it is handed the rise to recognise', /- Rep Satisfaction, moving the right way: 71\.9% in Q2 to 76\.5% in Q3/.test(prompt));
    t.check('and the work', /- The work Carlos has put in with me this year/.test(prompt));
    t.check('and asked to lead on recognition', /Open Progress and strengths by recognising Carlos by name/.test(prompt));
});

suite('review voice: with nothing rising and nothing logged, box 1 still says something true', (t) => {
    t.pinClock('2026-10-14');
    const flat = year('Pat Flat',
        { aht: 470, scheduleAdherence: 90, overallSentiment: 84, cxRepOverall: 74, fcr: 66, overallExperience: 66, transfers: 9, transfersCount: 45, reliability: 9 },
        { aht: 480, scheduleAdherence: 89.5, overallSentiment: 84.2, cxRepOverall: 73, fcr: 65, overallExperience: 65, transfers: 9.2, transfersCount: 46, reliability: 9 },
        { aht: 490, scheduleAdherence: 89, overallSentiment: 84.1, cxRepOverall: 72, fcr: 64, overallExperience: 64, transfers: 9.4, transfersCount: 47, reliability: 9 });
    const { qr, ctx } = ctxFor(t, flat, 'Pat Flat');
    const notes = qr.buildNotes(ctx);

    t.check('the box is not empty', notes.box1.length > 30);
    t.check('and does not claim the quarter held', !/held the quarter steady/i.test(notes.box1));
    t.check('it names the measure nearest its goal as the place to build from',
        /^Pat is closest to goal on adherence, at 89% in Q3 against the 93% goal, and that is a good place to build from\./.test(notes.box1));
});

/* ── Praise reads as praise ── */

suite('review voice: a strong year opens on the person and names everything at goal', (t) => {
    t.pinClock('2026-10-14');
    const { qr, ctx } = ctxFor(t, FAITH, 'Faith Moore');
    const notes = qr.buildNotes(ctx);

    t.check('box 1 opens with recognition by name',
        /^(Faith is having a great year, and it shows in every measure\.|There is a lot to recognize in Faith's year so far\.)/.test(notes.box1));
    t.check('a full score is said as one', /Rep satisfaction was a perfect 100% in every quarter this year\./.test(notes.box1));
    t.check('not as a metric that merely held', !/Rep satisfaction held steady/.test(notes.box1));
    // Capped at four, the fifth strength simply vanished.
    t.check('the strengths past the third are named, with their numbers',
        /Average handle time \(398s\), first call resolution \(78%\), overall experience \(80%\) and transfers \(4%\) were also inside goal all year\./.test(notes.box1));
    t.check('34.5 hours is not praised', !/hrs|missed time|allowance/.test(notes.box1));

    t.check('the clean-quarter close is not the old template',
        !/The focus for the rest of the year is holding that through one quarter/.test(notes.box2));
    t.check('it looks to Q4 in plain words',
        /(Q4 is about keeping this going\.|The goal for Q4 is more of the same\.|Q4 is about holding this level through the end of the year\.)$/.test(notes.box2));
});

suite('review voice: handle time down every quarter is said, even inside the noise band', (t) => {
    t.pinClock('2026-10-14');
    const { qr, ctx } = ctxFor(t, ELI, 'Eli Brooks');
    const aht = ctx.metrics.find((m) => m.metricKey === 'aht');

    t.check('the lead sentence says it came down every quarter',
        /came down in each quarter this year/.test(qr.metricSentence(aht, ctx, 'lead')));
    t.check('and never that it held steady', !/held steady/.test(qr.metricSentence(aht, ctx, 'lead')));

    const notes = qr.buildNotes(ctx);
    t.check('box 1 credits it to Eli',
        /Eli brought average handle time down in every quarter this year, from 446s in Q1 to 439s in Q3\./.test(notes.box1));
    t.check('box 2 says where it stands without walking the quarters again',
        /Average handle time was 439s in Q3, 13 seconds above the 426s goal\./.test(notes.box2));
    t.check('and closes on the goal, by name',
        /Eli is already moving handle time the right way, and the goal for Q4 is to keep it moving toward 426s\./.test(notes.box2));

    // A zero-survey year never reads as a failure.
    t.check('no survey metric is in the document', !/rep satisfaction|first call|overall experience|(^|[^\d.])0%/i.test(notes.full));

    const tp = qr.buildTalkingPoints(ctx);
    t.check('the meeting sheet agrees', /Average Handle Time: Q1 446s, Q2 442s, Q3 439s .*Better each quarter\./.test(tp.text));
});

suite('review voice: hours inside an even share are praise, worded as praise', (t) => {
    t.pinClock('2026-10-14');
    const { qr, ctx } = ctxFor(t, ELI, 'Eli Brooks');
    const box1 = qr.buildNotes(ctx).box1;
    t.check('5 of 18 through Q3 is said as kept inside the allowance',
        /Eli kept missed time to 5 hrs so far this year, well inside the 17.9 hr allowance\./.test(box1));
    t.check('not as a bare fact', !/has missed 5 hrs/.test(box1));

    // 16.5 of 18 with a quarter to go is inside the allowance and not on pace.
    const near = ctxFor(t, year('Near Limit', { reliability: 0.2 }, { reliability: 0.7 }, { reliability: 15.6 }), 'Near Limit');
    const nearNotes = near.qr.buildNotes(near.ctx);
    t.check('hours near the allowance are not praised', !/hrs|missed time|allowance/.test(nearNotes.box1));
    t.check('nor raised as a focus', !/hrs|missed time|allowance/.test(nearNotes.box2));
    t.check('nor handed to Copilot', !/- Reliability:/.test(near.qr.buildPrompt(near.ctx)));

    const zero = ctxFor(t, year('Zero Hours', { reliability: 0 }, { reliability: 0 }, { reliability: 0 }), 'Zero Hours');
    t.check('a counted zero is said as the figure',
        /Zero's missed time so far this year is 0 hrs, well inside the 17.9 hr allowance\./.test(zero.qr.buildNotes(zero.ctx).box1));
});

/* ── Goal focused when not meeting, and kind about a first miss ── */

suite('review voice: a first dip below goal reads as a dip, with a goal to get back', (t) => {
    t.pinClock('2026-10-14');
    const { qr, ctx } = ctxFor(t, DANA, 'Dana Dip');
    const box2 = qr.buildNotes(ctx).box2;

    t.check('handle time is a first rise above goal, every number on it',
        /Average handle time was inside the 426s goal in Q1 and Q2, at 410s and 405s, and rose to 431s in Q3\./.test(box2));
    t.check('adherence is a dip, not a slide',
        /Schedule adherence was inside the 93% goal in Q1 and Q2, at 94\.5% and 94\.1%, and dipped to 92\.7% in Q3\./.test(box2));
    t.check('the close covers both, plainly',
        /Getting handle time back under 426s and adherence back above 93% in Q4 is the focus\./.test(box2));
    t.check('nothing heavy for a 0.3 point miss',
        !/one to move first|visible movement|slipped in each quarter/.test(box2));
});

suite('review voice: the closings are not one template for the whole team', (t) => {
    t.pinClock('2026-10-14');
    const names = ['Avery Stone', 'Blake Ruiz', 'Casey Lee', 'Drew Park', 'Emery Shah', 'Frankie Ho', 'Gray Diaz', 'Harper Kim'];
    const closes = new Set();
    const openers = new Set();
    names.forEach((name) => {
        const { qr, ctx } = ctxFor(t, year(name, {}, {}, {}), name);
        const notes = qr.buildNotes(ctx);
        closes.add(notes.box2.replace(/^.*?\.\s/, ''));
        openers.add(notes.box1.split('. ')[0].replace(name.split(' ')[0], 'NAME'));
        t.check(`${name}: no old clean-quarter template`, !/holding that through one quarter/.test(notes.box2));
    });
    t.check(`eight clean quarters do not all close the same way (${closes.size} closings)`, closes.size > 1);
    t.check(`nor all open the same way (${openers.size} openings)`, openers.size > 1);

    // And a document reads the same every time it is built.
    const again = ctxFor(t, year('Avery Stone', {}, {}, {}), 'Avery Stone');
    const once = again.qr.buildNotes(again.ctx).full;
    t.equal('the same associate gets the same words twice', again.qr.buildNotes(again.ctx).full, once);
});

/* ── The meeting sheet ── */

suite('review voice: a struggling sheet starts on a win and stops at two misses', (t) => {
    t.pinClock('2026-10-14');
    const { qr, ctx } = ctxFor(t, CARLOS, 'Carlos Diaz', CARLOS_HISTORY);
    const tp = qr.buildTalkingPoints(ctx);
    const ids = tp.sections.map((s) => s.id);

    t.equal('it opens on what is moving the right way', ids[0], 'rising');
    const rising = tp.sections[0];
    t.equal('headed in plain words', rising.heading, 'Moving the right way');
    t.check('rep satisfaction is on it, said as a rise',
        rising.items.some((i) => i.metricKey === 'cxRepOverall' && /^Up from 71\.9% in Q2, the best quarter of the year\./.test(i.said)));
    t.check('no list of further misses', ids.indexOf('moreFocus') === -1 && !/ALSO BELOW GOAL/.test(tp.text));
    t.equal('two things to work on', tp.sections.find((s) => s.id === 'focus').items.length, 2);
    t.check('a "what is working" question about the rise',
        tp.sections.find((s) => s.id === 'ask').lines[0] === 'What has been working for you on rep satisfaction?');
});

/* ── The numbers read simply, and the house rules hold ── */

suite('review voice: no ".0" and no house rule broken across the review copy', (t) => {
    t.pinClock('2026-10-14');
    [[CARLOS, 'Carlos Diaz', CARLOS_HISTORY], [ELI, 'Eli Brooks'], [FAITH, 'Faith Moore'], [DANA, 'Dana Dip']].forEach(([store, name, history]) => {
        const { qr, ctx } = ctxFor(t, store, name, history);
        const notes = qr.buildNotes(ctx);
        const all = [notes.full, qr.buildTalkingPoints(ctx).text, qr.buildPrompt(ctx)].join('\n');
        t.check(`${name}: no whole number printed with ".0"`, !NO_POINT_ZERO.test(all));
        t.check(`${name}: goals read as round numbers`, !/goal of \d+\.0|\d+\.0% goal|\d+\.0s goal/.test(all));
        ['—', '–', '―'].forEach((d) => t.check(`${name}: no ${JSON.stringify(d)}`, all.indexOf(d) === -1));
        [/off[- ]track/i, /on[- ]track/i, /\bexceptional\b/i, /\bsuccessful\b/i, /\btier\b/i].forEach((re) => {
            t.check(`${name}: no rating word ${re}`, !re.test(all));
        });
        t.check(`${name}: nothing is only so far away`, !/only .{0,20}away from/i.test(all));
        t.check(`${name}: the file note is third person`, !/\byou\b|\byour\b/i.test(notes.box1 + ' ' + notes.box2));
        t.check(`${name}: hours never in the focus box`, !/hrs|hours|allowance|reliab|attendance/i.test(notes.box2));
    });
});
