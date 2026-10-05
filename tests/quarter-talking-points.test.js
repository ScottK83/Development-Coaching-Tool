'use strict';

/**
 * The Q3 check-ins, as they will actually be run.
 *
 * Three things are pinned here, all found by replaying the Quarterly tab
 * against the real store on the Monday the meetings start:
 *
 *   The tab opened on Q4. From October 1 the newest quarter to have started
 *   is one with nothing in it, and every document was titled "Q4 2026 Check
 *   In" and closed on "going into next year".
 *
 *   Hours over the allowance were left out of Areas of Focus for seven of
 *   eighteen associates, one of them a hundred hours over, because any rate
 *   that happened to be falling outranked them for the two places in the box.
 *
 *   There was no sheet to talk from. The document is a file note; the meeting
 *   needed the same facts as things to say.
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

// Three quarter uploads for one associate, each given its own overrides.
function year(name, q1, q2, q3) {
    return Object.assign({},
        period('quarter', '2026-01-01', '2026-03-31', [person(name, q1)]),
        period('quarter', '2026-04-01', '2026-06-30', [person(name, q2)]),
        period('quarter', '2026-07-01', '2026-09-30', [person(name, q3)])
    );
}

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
        saveWithSizeCheck(key, data) { browser.store[PREFIX + key] = JSON.stringify(data); },
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
    const ui = t.loadModule('modules/quarter-review-ui.module.js').quarterReviewUi;

    global.window.formatMetricDisplay = (key, value) => {
        const def = global.METRICS_REGISTRY[key] || {};
        const n = Math.round(value * 10) / 10;
        if (def.unit === 'sec') return `${Math.round(value)}s`;
        if (def.unit === '%') return `${n}%`;
        if (def.unit === 'hrs') return `${n} hrs`;
        return String(n);
    };
    return { qr, ui };
}

function ctxFor(t, store, name) {
    const { qr } = load(t, store);
    return { qr, ctx: qr.buildContext(name, 2026, { throughQuarter: 3 }) };
}

function section(tp, id) {
    return tp.sections.find((s) => s.id === id) || null;
}

function renderInto(ui, setup) {
    global.document._els.q1ReviewContent = { innerHTML: '' };
    if (setup) setup();
    ui.render();
    return global.document._els.q1ReviewContent.innerHTML;
}

/* ── Which check-in the tab opens on ── */

const FULL_YEAR = year('Jordan Reyes',
    { aht: 451, reliability: 6 }, { aht: 438, reliability: 5 }, { aht: 421, reliability: 3.5 });

suite('check-ins: in October the tab opens on the quarter that just closed', (t) => {
    t.pinClock('2026-10-05');
    const { ui } = load(t, FULL_YEAR);
    const html = renderInto(ui, () => { ui.state.employee = 'Jordan Reyes'; });

    t.equal('it opens on Q3', ui.state.quarter, 3);
    t.check('the document is a Q3 check-in', /Q3 2026 Check In: Jordan Reyes/.test(html));
    t.check('not a Q4 one', !/Q4 2026 Check In/.test(html));
    t.check('an empty Q4 is not offered as a check-in', !/data-quarter="4"/.test(html));
    t.check('but the coverage panel still shows it', /Q4 2026/.test(html));
});

suite('check-ins: a new quarter one week old does not take over', (t) => {
    t.pinClock('2026-10-13');
    const store = Object.assign({}, FULL_YEAR,
        period('week', '2026-10-05', '2026-10-11', [person('Jordan Reyes', { aht: 400 })]));
    const { ui } = load(t, store);
    const html = renderInto(ui);

    t.equal('Q3 is still the one it opens on', ui.state.quarter, 3);
    t.check('Q4 is offered, since it has data', /data-quarter="4"/.test(html));
});

suite('check-ins: once a quarter is half uploaded it is the one', (t) => {
    t.pinClock('2026-11-20');
    const store = Object.assign({}, FULL_YEAR,
        period('month', '2026-10-01', '2026-10-31', [person('Jordan Reyes')]),
        period('month-to-date', '2026-11-01', '2026-11-18', [person('Jordan Reyes')]));
    const { ui } = load(t, store);
    renderInto(ui);

    t.equal('Q4 is the one it opens on', ui.state.quarter, 4);
});

suite('check-ins: in January the check-in due is last year\'s Q4', (t) => {
    t.pinClock('2027-01-06');
    const store = Object.assign({}, FULL_YEAR,
        period('quarter', '2026-10-01', '2026-12-31', [person('Jordan Reyes', { aht: 410 })]));
    const { ui } = load(t, store);
    const html = renderInto(ui, () => { ui.state.employee = 'Jordan Reyes'; });

    t.equal('the year is 2026', ui.state.year, 2026);
    t.equal('and the quarter is Q4', ui.state.quarter, 4);
    t.check('so the document is the Q4 check-in', /Q4 2026 Check In: Jordan Reyes/.test(html));
});

/* ── What goes in the focus box ── */

/* Hours over the allowance led this box from 9/30. Scott reversed it on the
 * morning of the Q3 meetings: areas of focus do not reference reliability. */
suite('check-ins: areas of focus never reference reliability', (t) => {
    t.pinClock('2026-10-05');
    // Two rates below goal and falling, which used to take both places.
    const store = year('Sam Over',
        { reliability: 10, aht: 450, cxRepOverall: 80 },
        { reliability: 9, aht: 470, cxRepOverall: 76 },
        { reliability: 14, aht: 490, cxRepOverall: 70 });
    const { qr, ctx } = ctxFor(t, store, 'Sam Over');
    const split = qr.splitForBoxes(ctx);

    t.check('33 hours over is not in the focus split', !split.focus.some((m) => m.metricKey === 'reliability'));
    t.equal('the rates take both places', split.focus.length, 2);
    const notes = qr.buildNotes(ctx);
    t.check('the box says nothing about hours', !/hrs|hours|allowance|reliab|attendance/i.test(notes.box2));
    t.check('nor does the strengths box', !/allowance/.test(notes.box1));
    t.check('the lead rate still gets its expectation', /expectation is visible movement/.test(notes.box2));

    // Copilot is not handed the hours to put back in.
    const prompt = qr.buildPrompt(ctx);
    t.check('the prompt carries no hours fact', !/- Reliability:/.test(prompt));
    t.check('and asks for them to stay out', /Keep reliability, attendance and hours missed out of Areas of Focus/.test(prompt));
});

suite('check-ins: a move inside the noise band is not a slide', (t) => {
    t.pinClock('2026-10-05');
    // Transfers 6.9, 7.2, 7.0 is a metric that held. Adherence 93.5, 93.3,
    // 91.3 is one that fell through its goal.
    const store = year('Jay Steady',
        { transfers: 6.9, transfersCount: 34.5, scheduleAdherence: 93.5 },
        { transfers: 7.2, transfersCount: 36, scheduleAdherence: 93.3 },
        { transfers: 7.0, transfersCount: 35, scheduleAdherence: 91.3 });
    const { qr, ctx } = ctxFor(t, store, 'Jay Steady');
    const split = qr.splitForBoxes(ctx);
    const transfers = split.focus.find((m) => m.metricKey === 'transfers');
    const adherence = split.focus.find((m) => m.metricKey === 'scheduleAdherence');

    t.equal('transfers is below goal, not falling', transfers.why, 'missed');
    t.equal('adherence is falling', adherence.why, 'missed-and-falling');
    t.equal('so adherence is raised first', split.focus[0].metricKey, 'scheduleAdherence');
});

suite('check-ins: a reading from an earlier quarter does not lead', (t) => {
    t.pinClock('2026-10-05');
    // One first-call survey in Q3, so the newest solid reading is Q2's.
    const store = year('Sabi Thin',
        { fcr: 100, overallSentiment: 87.3 },
        { fcr: 28.6, overallSentiment: 89 },
        { fcr: 100, fcrSurveyTotal: 1, overallSentiment: 85.4 });
    const { qr, ctx } = ctxFor(t, store, 'Sabi Thin');
    const split = qr.splitForBoxes(ctx);
    const fcr = split.focus.find((m) => m.metricKey === 'fcr');

    t.equal('first call resolution reads off Q2', fcr.latestQuarter, 'Q2');
    t.equal('so the Q3 miss is raised ahead of it', split.focus[0].metricKey, 'overallSentiment');
});

/* ── The talking points ── */

const IMPROVING = year('Jordan Reyes',
    { aht: 451, scheduleAdherence: 91.2, cxRepOverall: 86.0, reliability: 2 },
    { aht: 438, scheduleAdherence: 93.4, cxRepOverall: 83.5, reliability: 1 },
    { aht: 421, scheduleAdherence: 94.1, cxRepOverall: 81.0, reliability: 1.5 });

suite('talking points: the sheet carries every quarter and the same split', (t) => {
    t.pinClock('2026-10-05');
    const { qr, ctx } = ctxFor(t, IMPROVING, 'Jordan Reyes');
    const tp = qr.buildTalkingPoints(ctx);

    t.equal('titled for the quarter and the associate', tp.title, 'Q3 2026 check in: Jordan Reyes');

    const wins = section(tp, 'wins');
    const aht = wins.items.find((i) => i.metricKey === 'aht');
    t.check('handle time is a win', !!aht);
    t.equal('with every quarter on it', aht.numbers, 'Q1 451s, Q2 438s, Q3 421s');
    t.check('and where it stands', /Reached goal in Q3/.test(aht.said));

    const focus = section(tp, 'focus');
    t.equal('the focus section is headed for the next quarter', focus.heading, 'What to work on in Q4');
    const rep = focus.items.find((i) => i.metricKey === 'cxRepOverall');
    t.check('rep satisfaction is what to work on', !!rep);
    t.check('with how far short it is', /1 point short/.test(rep.said));
    t.check('and the survey count behind it', rep.sample === '40 surveys in Q3');

    const focusKeys = qr.splitForBoxes(ctx).focus.slice(0, 2).map((m) => m.metricKey);
    t.equal('the focus items are the document\'s focus items',
        focus.items.map((i) => i.metricKey).join(','), focusKeys.join(','));

    const asks = section(tp, 'ask').lines;
    t.check('there is a question about the win', asks.some((q) => /working for you/.test(q)));
    t.check('one about the focus', asks.some((q) => /gets in the way on rep satisfaction/.test(q)));
    t.check('and one about next quarter', asks.some((q) => /work on in Q4/.test(q)));
});

suite('talking points: hours over the allowance are not something to work on', (t) => {
    t.pinClock('2026-10-05');
    const store = year('Sam Over', { reliability: 20 }, { reliability: 10 }, { reliability: 87 });
    const { qr, ctx } = ctxFor(t, store, 'Sam Over');
    const tp = qr.buildTalkingPoints(ctx);
    const focus = section(tp, 'focus');

    t.check('reliability is not in what to work on',
        !(focus.items || []).some((i) => i.metricKey === 'reliability'));
    t.check('it is not a win', !(section(tp, 'wins') || { items: [] }).items.some((i) => i.metricKey === 'reliability'));
    t.check('attendance is not asked about', !section(tp, 'ask').lines.some((q) => /attendance/.test(q)));
    t.check('and the sheet does not mention the hours', !/117 hrs|allowance/.test(tp.text));
});

suite('talking points: hours near the allowance are not opened on as a win', (t) => {
    t.pinClock('2026-10-05');
    const near = year('Near Limit', { reliability: 0.2 }, { reliability: 0.7 }, { reliability: 15.6 });
    const { qr, ctx } = ctxFor(t, near, 'Near Limit');
    const tp = qr.buildTalkingPoints(ctx);

    t.check('16.5 of 18 is not in the wins',
        !(section(tp, 'wins') || { items: [] }).items.some((i) => i.metricKey === 'reliability'));
    // Nor raised as one to watch: that is a focus by another name.
    const watch = section(tp, 'watch');
    t.check('it is not one to keep an eye on either',
        !(watch && watch.items.some((i) => i.metricKey === 'reliability')));

    const { qr: qr2, ctx: ctx2 } = ctxFor(t, year('Well Inside', { reliability: 3 }, { reliability: 3 }, { reliability: 3 }), 'Well Inside');
    const tp2 = qr2.buildTalkingPoints(ctx2);
    t.check('9 of 18 through Q3 is a win',
        section(tp2, 'wins').items.some((i) => i.metricKey === 'reliability'));
});

suite('talking points: a thin check-in quarter is said, not hidden', (t) => {
    t.pinClock('2026-10-05');
    const store = year('Sabi Thin',
        { fcr: 70, overallSentiment: 87.3 },
        { fcr: 28.6, overallSentiment: 89 },
        { fcr: 100, fcrSurveyTotal: 1, overallSentiment: 85.4 });
    const { qr, ctx } = ctxFor(t, store, 'Sabi Thin');
    const text = qr.buildTalkingPoints(ctx).text;

    t.check('the Q2 figure is labelled Q2', /Q2 28\.6%|28\.6% in Q2/.test(text));
    t.check('and the thin Q3 is named', /Q3 had one survey, too few to read/.test(text));
    t.check('the one survey is never quoted as a Q3 figure', !/Q3 100%/.test(text));
});

suite('talking points: a clean quarter still has something to say', (t) => {
    t.pinClock('2026-10-05');
    const { qr, ctx } = ctxFor(t, year('All Good', {}, {}, {}), 'All Good');
    const tp = qr.buildTalkingPoints(ctx);

    const focus = section(tp, 'focus');
    t.check('the focus says everything is at goal', /Every performance metric is at goal/.test(focus.lines[0]));
    t.check('and the ask is to hold it', /hold it/.test(focus.lines[0]));
    t.check('there are still questions', section(tp, 'ask').lines.length >= 2);
});

suite('talking points: the supervisor\'s note is on the sheet', (t) => {
    t.pinClock('2026-10-05');
    const { qr, ctx } = ctxFor(t, IMPROVING, 'Jordan Reyes');
    const tp = qr.buildTalkingPoints(ctx, { notes: 'Ask about the offline documents project.' });

    t.check('it is its own section', section(tp, 'notes').lines[0] === 'Ask about the offline documents project.');
    t.check('and in the copied text', /MY NOTES\n- Ask about the offline documents project\./.test(tp.text));
    t.check('with no note there is no empty section', !section(qr.buildTalkingPoints(ctx), 'notes'));
});

suite('talking points: the copy holds the house rules', (t) => {
    t.pinClock('2026-10-05');
    const fixtures = [
        [IMPROVING, 'Jordan Reyes'],
        [year('Sam Over', { reliability: 20 }, { reliability: 10 }, { reliability: 87, aht: 520 }), 'Sam Over'],
        [year('All Good', {}, {}, {}), 'All Good']
    ];
    const body = fixtures.map(([store, name]) => {
        const { qr, ctx } = ctxFor(t, store, name);
        return qr.buildTalkingPoints(ctx, { notes: 'A note.' }).text;
    }).join('\n');

    ['—', '–', '―', '&mdash;', '&ndash;', '&#8212;', '&#8213;'].forEach((d) => {
        t.check(`no ${JSON.stringify(d)} anywhere`, !body.includes(d));
    });
    [/off[- ]track/i, /on[- ]track/i, /\bexceptional\b/i, /performance classification/i,
        /\bsuccessful\b/i, /\btier\b/i, /score\s*[123]\b/i].forEach((re) => {
        t.check(`no rating vocabulary matching ${re}`, !re.test(body));
    });
    t.check('nothing is only so far away from anything', !/only .{0,20}away from/i.test(body));
    t.check('reliability is never "better by"', !/better by/i.test(body));
});

/* ── The button ── */

suite('check-ins: the talking points button opens the sheet', (t) => {
    t.pinClock('2026-10-05');
    const { ui } = load(t, IMPROVING);

    const closed = renderInto(ui, () => { ui.state.employee = 'Jordan Reyes'; });
    t.check('the button is there once an associate is picked', /id="quarterReviewTalkToggle"/.test(closed));
    t.check('and the sheet is not, until it is clicked', !/quarterReviewTalkBody/.test(closed));

    const open = renderInto(ui, () => { ui.state.showTalking = true; });
    t.check('opened, the sheet is shown', /id="quarterReviewTalkBody"/.test(open));
    t.check('with its sections', /Start with what is working/.test(open) && /Questions to ask/.test(open));
    t.check('and a copy button', /id="quarterReviewTalkCopy"/.test(open));
    t.check('the document is still below it', /Progress &amp; Strengths/.test(open));
    t.check('the button now closes it', /Hide talking points/.test(open));

    const before = renderInto(ui, () => { ui.state.employee = ''; });
    t.check('no associate, no button', !/quarterReviewTalkToggle/.test(before));
    t.equal('the sheet stays open for the next associate', ui.state.showTalking, true);
});
