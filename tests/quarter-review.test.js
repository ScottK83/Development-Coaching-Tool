'use strict';

/**
 * The check-in document that goes into an associate's record.
 *
 * Two things are pinned here. The first is that the quarters actually appear:
 * a document whose whole reason for existing is "Q1 here, Q2 here, Q3 here"
 * fails if it prints one number and calls it the year.
 *
 * The second is the house rules, because this is the first generator in the
 * app that writes record copy itself instead of handing a prompt to Copilot.
 * Everything the tier vocabulary suite and the coaching voice suite enforce on
 * the prompts has to hold on the finished text too, and there is no model in
 * the loop to smooth over a slip.
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
        totalCalls: 500,
        surveyTotal: 40, repSurveyTotal: 40, fcrSurveyTotal: 40,
        scheduleAdherence: 94, cxRepOverall: 85, fcr: 78, overallExperience: 80,
        overallSentiment: 90, transfers: 4, transfersCount: 20,
        aht: 420, acw: 55, holdTime: 25, reliability: 0
    }, over || {});
}

function load(t, store) {
    const browser = t.installFakeBrowser();
    global.window.weeklyData = store;
    global.window.ytdData = {};
    global.weeklyData = store;
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

    // The display formatter lives in metric-trends, which drags in most of the
    // app. The review module falls back to a bare number without it, and every
    // assertion below is about the sentence rather than the unit suffix, so it
    // is given the real formatter's shape instead.
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

/* A year that improves on handle time and adherence and slips on rep sat. */
const IMPROVING = Object.assign({},
    period('quarter', '2026-01-01', '2026-03-31', [person('Jordan Reyes', {
        aht: 451, scheduleAdherence: 91.2, cxRepOverall: 86.0, reliability: 6
    })]),
    period('quarter', '2026-04-01', '2026-06-30', [person('Jordan Reyes', {
        aht: 438, scheduleAdherence: 93.4, cxRepOverall: 83.5, reliability: 5
    })]),
    period('quarter', '2026-07-01', '2026-09-30', [person('Jordan Reyes', {
        aht: 421, scheduleAdherence: 94.1, cxRepOverall: 81.0, reliability: 3.5
    })])
);

function ctxFor(t, store, name = 'Jordan Reyes') {
    const qr = load(t, store);
    return { qr, ctx: qr.buildContext(name, 2026) };
}

/* ── The quarters show up ── */

suite('quarter review: the document names every quarter', (t) => {
    t.pinClock('2026-09-22');
    const { qr, ctx } = ctxFor(t, IMPROVING);
    t.check('a context was built', !!ctx);
    if (!ctx) return;

    const notes = qr.buildNotes(ctx);
    const body = notes.full;

    t.check('Q1 is named', body.includes('Q1'));
    t.check('Q2 is named', body.includes('Q2'));
    t.check('Q3 is named', body.includes('Q3'));

    t.check('and so are the handle times for each', /451s/.test(body) && /438s/.test(body) && /421s/.test(body));
    t.check('the adherence progression is there too',
        /91\.2%/.test(body) && /93\.4%/.test(body) && /94\.1%/.test(body));
});

suite('quarter review: a falling reverse metric reads as improvement', (t) => {
    t.pinClock('2026-09-22');
    const { qr, ctx } = ctxFor(t, IMPROVING);
    const aht = ctx.metrics.find((m) => m.metricKey === 'aht');

    t.equal('handle time improved across the year', aht.direction, 'improving');
    t.equal('and it is at goal now', aht.meetsTarget, true);

    const sentence = qr.metricSentence(aht, ctx);
    t.check('the sentence says it came down', /came down/.test(sentence));
    t.check('and does not say it went up', !/climbed/.test(sentence));
    t.check('it carries all three quarters',
        /451s in Q1/.test(sentence) && /438s in Q2/.test(sentence) && /421s in Q3/.test(sentence));
    t.check('and states the goal', /426s/.test(sentence));
});

suite('quarter review: a slipping metric is named plainly', (t) => {
    t.pinClock('2026-09-22');
    const { qr, ctx } = ctxFor(t, IMPROVING);
    const rep = ctx.metrics.find((m) => m.metricKey === 'cxRepOverall');

    t.equal('rep satisfaction went the wrong way', rep.direction, 'declining');
    t.equal('and is below goal', rep.meetsTarget, false);

    const sentence = qr.metricSentence(rep, ctx);
    t.check('the sentence says it slipped', /slipped/.test(sentence));
    t.check('it carries the three readings',
        /86%/.test(sentence) && /83\.5%/.test(sentence) && /81%/.test(sentence));

    // It started the year ABOVE the 82% goal, so the sentence must not claim
    // it moved further from a goal it was already clearing. What belongs in a
    // record is the quarter it went under.
    t.check('the quarter it dropped below goal is named',
        /Q3 is the first quarter under the 82% goal/.test(sentence));
    t.check('and it is not described as moving away from a goal it was meeting',
        !/further from goal/.test(sentence));

    const notes = qr.buildNotes(ctx);
    t.check('and it lands in the focus box', /slipped/.test(notes.box2));
    t.check('not in the strengths box', !/slipped/.test(notes.box1));
});

/* ── Reliability is the year, never the quarter ── */

suite('quarter review: missed hours are the year running total', (t) => {
    t.pinClock('2026-09-22');
    const { qr, ctx } = ctxFor(t, IMPROVING);
    const rel = ctx.reliability;

    // 6 + 5 + 3.5 across the three quarters.
    t.equal('the year to date total is the quarters added up', rel.yearToDate, 14.5);
    t.equal('the running total after Q1', rel.checkpoints[0].runningTotal, 6);
    t.equal('after Q2', rel.checkpoints[1].runningTotal, 11);
    t.equal('after Q3', rel.checkpoints[2].runningTotal, 14.5);
    t.equal('which is inside the eighteen hour allowance', rel.meetsTarget, true);

    const sentence = qr.reliabilitySentence(rel, ctx);
    t.check('the sentence leads with the year figure', /14\.5 hrs for the year to date/.test(sentence));
    t.check('and shows the running total at each quarter',
        /6 hrs through Q1/.test(sentence) && /11 hrs through Q2/.test(sentence));
    // The quarter's own hours are the one thing that must not appear as a
    // standalone figure. 3.5 is Q3's share and is not a number an associate
    // is shown.
    t.check('but never a single quarter share on its own', !/3\.5 hrs through/.test(sentence));
});

suite('quarter review: being over the allowance is said directly', (t) => {
    t.pinClock('2026-09-22');
    const over = Object.assign({},
        period('quarter', '2026-01-01', '2026-03-31', [person('Sam Over', { reliability: 10 })]),
        period('quarter', '2026-04-01', '2026-06-30', [person('Sam Over', { reliability: 9 })]),
        period('quarter', '2026-07-01', '2026-09-30', [person('Sam Over', { reliability: 4 })])
    );
    const { qr, ctx } = ctxFor(t, over, 'Sam Over');
    const rel = ctx.reliability;

    t.equal('twenty three hours for the year', rel.yearToDate, 23);
    t.equal('which is over the allowance', rel.meetsTarget, false);
    t.equal('by five hours', rel.overBy, 5);

    const sentence = qr.reliabilitySentence(rel, ctx);
    t.check('the overage is stated', /5 hrs over the allowance/.test(sentence));
    t.check('with the time left in the year', /one quarter to go/.test(sentence));

    const notes = qr.buildNotes(ctx);
    t.check('and it is a focus area', /over the allowance/.test(notes.box2));
});

/* ── House rules ── */

function allCopy(qr, ctx) {
    const notes = qr.buildNotes(ctx, { notes: 'Volunteered for the offline documents project.' });
    return [notes.full, notes.box1, notes.box2, qr.buildPrompt(ctx)].join('\n');
}

suite('quarter review: the copy holds the house rules', (t) => {
    t.pinClock('2026-09-22');
    const { qr, ctx } = ctxFor(t, IMPROVING);
    const body = allCopy(qr, ctx);

    // The seven dash forms the repo sweep forbids.
    ['—', '–', '―', '&mdash;', '&ndash;', '&#8212;', '&#8213;'].forEach((d) => {
        t.check(`no ${JSON.stringify(d)} anywhere in the copy`, !body.includes(d));
    });

    // Rating vocabulary. Associates are not shown the internal scale.
    [/off[- ]track/i, /on[- ]track/i, /\bexceptional\b/i, /performance classification/i,
        /\bsuccessful\b/i, /\btier\b/i, /score\s*[123]\b/i].forEach((re) => {
        t.check(`no rating vocabulary matching ${re}`, !re.test(body));
    });

    t.check('nothing is only so far away from anything', !/only .{0,20}away from/i.test(body));
    t.check('no promise of an exception', !/exception cod|we can waive|will be excused/i.test(body));
    t.check('nobody is told they are new', !/if you'?re new|as you learn/i.test(body));
});

suite('quarter review: the notes are about the associate, not to them', (t) => {
    t.pinClock('2026-09-22');
    const { qr, ctx } = ctxFor(t, IMPROVING);
    const notes = qr.buildNotes(ctx);
    const prose = notes.box1 + ' ' + notes.box2;

    // A file note is third person throughout. "you" and "your" are the tell
    // that a letter has been written instead.
    t.check('no second person in the notes', !/\byou\b|\byour\b/i.test(prose));
    t.check('the associate is named', prose.includes('Jordan'));
});

/* ── Structure ── */

suite('quarter review: the header says what the document covers', (t) => {
    t.pinClock('2026-09-22');
    const { qr, ctx } = ctxFor(t, IMPROVING);
    const header = qr.buildHeader(ctx);

    t.check('the quarter is in the title', header.includes('Q3 2026'));
    t.check('the full name is in the title', header.includes('Jordan Reyes'));
    t.check('the preparation date is stated', /09\/22\/2026/.test(header));
    t.check('and the span the numbers cover', /01\/01\/2026/.test(header) && /09\/30\/2026/.test(header));
});

suite('quarter review: the two boxes are separate and both filled', (t) => {
    t.pinClock('2026-09-22');
    const { qr, ctx } = ctxFor(t, IMPROVING);
    const notes = qr.buildNotes(ctx);

    t.check('there is a strengths box', notes.box1.length > 40);
    t.check('there is a focus box', notes.box2.length > 40);
    t.check('they are not the same text', notes.box1 !== notes.box2);
    t.check('the full version carries both headings',
        notes.full.includes('PROGRESS AND STRENGTHS') && notes.full.includes('AREAS OF FOCUS'));
    t.check('the focus box sets an expectation', /expectation/i.test(notes.box2));
});

suite('quarter review: the focus box names at most two things', (t) => {
    t.pinClock('2026-09-22');
    // Everything below goal at once.
    const bad = Object.assign({},
        period('quarter', '2026-01-01', '2026-03-31', [person('Alex Behind', {
            aht: 470, scheduleAdherence: 88, cxRepOverall: 70, fcr: 60,
            overallSentiment: 80, overallExperience: 60, transfers: 12, transfersCount: 60, reliability: 12
        })]),
        period('quarter', '2026-04-01', '2026-06-30', [person('Alex Behind', {
            aht: 480, scheduleAdherence: 87, cxRepOverall: 68, fcr: 58,
            overallSentiment: 79, overallExperience: 58, transfers: 13, transfersCount: 65, reliability: 12
        })])
    );
    const { qr, ctx } = ctxFor(t, bad, 'Alex Behind');
    const split = qr.splitForBoxes(ctx);

    t.check('plenty is behind goal', split.focus.length > 2);
    const notes = qr.buildNotes(ctx);

    // Naming seven failures in a record is a pile on, and it gives the
    // associate nothing to act on. The worst two are the ones that get worked.
    const named = split.focus.slice(0, 2).map((m) => m.label);
    const others = split.focus.slice(2).map((m) => m.label);
    named.forEach((label) => {
        t.check(`${label} is raised`, notes.box2.toLowerCase().includes(label.toLowerCase()));
    });
    t.check('and the rest are held back', others.every((label) =>
        !notes.box2.toLowerCase().includes(label.toLowerCase())));
});

suite('quarter review: a falling metric below goal is raised first', (t) => {
    t.pinClock('2026-09-22');
    const { qr, ctx } = ctxFor(t, IMPROVING);
    const split = qr.splitForBoxes(ctx);

    t.check('there is something to work on', split.focus.length > 0);
    t.equal('and it is the one below goal and still falling',
        split.focus[0].metricKey, 'cxRepOverall');
    t.equal('flagged as such', split.focus[0].why, 'missed-and-falling');
});

/* ── Thin data ── */

suite('quarter review: a survey quarter resting on two responses is not quoted', (t) => {
    t.pinClock('2026-09-22');
    const thin = Object.assign({},
        period('quarter', '2026-01-01', '2026-03-31', [person('Pat Thin', {
            cxRepOverall: 95, repSurveyTotal: 2, surveyTotal: 2
        })]),
        period('quarter', '2026-04-01', '2026-06-30', [person('Pat Thin', {
            cxRepOverall: 84, repSurveyTotal: 30, surveyTotal: 30
        })]),
        period('quarter', '2026-07-01', '2026-09-30', [person('Pat Thin', {
            cxRepOverall: 85, repSurveyTotal: 30, surveyTotal: 30
        })])
    );
    const { qr, ctx } = ctxFor(t, thin, 'Pat Thin');
    const rep = ctx.metrics.find((m) => m.metricKey === 'cxRepOverall');

    t.equal('all three quarters have a reading', rep.series.measuredCount, 3);
    t.equal('but only two rest on enough responses', rep.usablePoints.length, 2);

    const sentence = qr.metricSentence(rep, ctx);
    // Two surveys reading 95% would otherwise open the story as a collapse
    // from 95 to 85, which is a story about two people.
    t.check('the two response quarter is not quoted', !/95%/.test(sentence));
    t.check('the solid quarters are', /84%/.test(sentence) && /85%/.test(sentence));
});

suite('quarter review: one quarter of data makes no claim about a year', (t) => {
    t.pinClock('2026-09-22');
    const { qr, ctx } = ctxFor(t, period('quarter', '2026-07-01', '2026-09-30',
        [person('Solo Quarter', { aht: 421 })]), 'Solo Quarter');

    const aht = ctx.metrics.find((m) => m.metricKey === 'aht');
    t.equal('no direction is claimed', aht.direction, 'insufficient');
    t.equal('and nothing was spanned', aht.movedAcross, null);

    const sentence = qr.metricSentence(aht, ctx);
    t.check('the sentence states the one quarter', /for Q3 was 421s/.test(sentence));
    t.check('and claims no movement', !/across the year/.test(sentence));
});

suite('quarter review: a missing quarter is reported, not invented', (t) => {
    t.pinClock('2026-09-22');
    const { ctx } = ctxFor(t, Object.assign({},
        period('quarter', '2026-04-01', '2026-06-30', [person('Gap Person', { aht: 438 })]),
        period('quarter', '2026-07-01', '2026-09-30', [person('Gap Person', { aht: 421 })])
    ), 'Gap Person');

    t.equal('two quarters carried data', ctx.coverage.quartersWithData, 2);
    t.equal('three were asked for', ctx.coverage.quartersRequested, 3);
    t.equal('and the empty one is named', ctx.coverage.missing.join(','), 'Q1');
});

/* ── The prompt ── */

suite('quarter review: the prompt carries the quarters and the draft', (t) => {
    t.pinClock('2026-09-22');
    const { qr, ctx } = ctxFor(t, IMPROVING);
    const prompt = qr.buildPrompt(ctx, { notes: 'Took on the offline documents project.' });

    t.check('it opens as help me polish my own notes', /I am a call center supervisor/.test(prompt));
    // A "you are a supervisor evaluating an employee" persona is what trips
    // Copilot's refusal, so the first person framing is load bearing.
    t.check('and not as a persona instruction', !/You are a /.test(prompt));

    t.check('every quarter reading is handed over',
        /Q1 451s/.test(prompt) && /Q2 438s/.test(prompt) && /Q3 421s/.test(prompt));
    t.check('the goals come with them', /goal 426s or lower/.test(prompt));
    t.check('the supervisor notes are included', /offline documents project/.test(prompt));
    t.check('the locally written draft is offered', /My draft/.test(prompt));
    t.check('the numbers are pinned against drift', /Do not round differently/.test(prompt));
    t.check('third person is required', /third person/.test(prompt));
    t.check('and the output shape is fixed', /Progress & Strengths:/.test(prompt));
});
