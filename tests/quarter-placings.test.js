'use strict';

/**
 * Where an associate placed in each of the five KPIs, quarter by quarter.
 *
 * Asked for on the morning of the Q3 check-ins: "so I can see each quarter
 * where they placed in each of the 5 KPIs and the target goal, see
 * improvement each quarter and give them a focus for the final quarter."
 * Not for the file. The panel sits on the Quarterly tab and nothing in it
 * reaches the document, the talking points or the Copilot prompt.
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

const Q = {
    1: ['2026-01-01', '2026-03-31'],
    2: ['2026-04-01', '2026-06-30'],
    3: ['2026-07-01', '2026-09-30']
};

// quarters: { 1: [rows], 2: [rows], 3: [rows] }
function store(quarters) {
    const out = {};
    Object.keys(quarters).forEach((q) => Object.assign(out, period('quarter', Q[q][0], Q[q][1], quarters[q])));
    return out;
}

function load(t, weekly, ytd) {
    const browser = t.installFakeBrowser();
    global.window.weeklyData = weekly;
    global.weeklyData = weekly;
    global.window.ytdData = ytd || {};
    global.ytdData = global.window.ytdData;
    browser.store[PREFIX + 'weeklyData'] = JSON.stringify(weekly);
    global.window.DevCoachModules.storage = {
        readStore(key) {
            const raw = browser.store[PREFIX + key];
            return raw === undefined ? undefined : JSON.parse(raw);
        },
        saveWithSizeCheck(key, data) { browser.store[PREFIX + key] = JSON.stringify(data); },
        loadWeeklyData() { return weekly; },
        loadYtdData() { return global.ytdData; },
        loadDailyData() { return {}; }
    };

    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.SURVEY_WEIGHT_FIELD = global.window.SURVEY_WEIGHT_FIELD;
    const profiles = global.window.DevCoachModules.metricProfiles;
    global.getMetricRatingScore = (key, value, year) => profiles.getRatingScore(key, value, year);
    global.window.getMetricRatingScore = global.getMetricRatingScore;
    t.loadModule('modules/on-off-tracker.module.js');
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/period-compare.module.js');
    const qt = t.loadModule('modules/quarter-trend.module.js').quarterTrend;
    const qr = t.loadModule('modules/quarter-review.module.js').quarterReview;
    const cr = t.loadModule('modules/center-ranking.module.js').centerRanking;
    const ui = t.loadModule('modules/quarter-review-ui.module.js').quarterReviewUi;

    global.window.formatMetricDisplay = (key, value) => {
        const def = global.METRICS_REGISTRY[key] || {};
        if (def.unit === 'sec') return `${Math.round(value)}s`;
        if (def.unit === '%') return `${value.toFixed(1)}%`;
        if (def.unit === 'hrs') return `${value.toFixed(1)} hrs`;
        return String(value);
    };
    return { qt, qr, cr, ui };
}

function placings(t, weekly, name, ytd, through) {
    const mods = load(t, weekly, ytd);
    const quarters = mods.qt.buildYearQuarters(2026).filter((q) => q.quarter <= (through || 3));
    return Object.assign({ model: mods.cr.buildQuarterPlacings(name, 2026, quarters), quarters }, mods);
}

const row = (model, registry) => model.rows.find((r) => r.registry === registry);

suite('quarter placings: each KPI is placed against the centre, every quarter', (t) => {
    t.pinClock('2026-10-05');
    const field = (ahts) => ahts.map((aht, i) => person('P' + i, { aht }));
    const weekly = store({
        1: [person('Jordan Reyes', { aht: 480 })].concat(field([400, 420, 440, 460])),
        2: [person('Jordan Reyes', { aht: 430 })].concat(field([400, 420, 440, 460])),
        3: [person('Jordan Reyes', { aht: 405 })].concat(field([400, 420, 440, 460]))
    });
    const { model } = placings(t, weekly, 'Jordan Reyes');
    const aht = row(model, 'aht');

    t.equal('five KPIs', model.rows.length, 5);
    t.equal('labelled as the page labels them', aht.label, 'Average Handle Time');
    t.equal('last in Q1', aht.cells[0].rank, 5);
    t.equal('third in Q2', aht.cells[1].rank, 3);
    t.equal('second in Q3, lower handle time placing higher', aht.cells[2].rank, 2);
    t.equal('out of the whole field', aht.cells[2].total, 5);
    t.equal('up two places into Q2', aht.cells[1].climbed, 2);
    t.equal('up three across the year', aht.climbed, 3);
    t.check('the goal travels with it', aht.target && aht.target.value > 0);
    t.equal('and the figure is the document figure', aht.cells[2].display, '405s');
});

suite('quarter placings: reliability is placed on the year so far, not the quarter', (t) => {
    t.pinClock('2026-10-05');
    // Clean Q3 for Jordan after a bad first half; the others steady.
    const weekly = store({
        1: [person('Jordan Reyes', { reliability: 10 }), person('A', { reliability: 4 }), person('B', { reliability: 5 })],
        2: [person('Jordan Reyes', { reliability: 6 }), person('A', { reliability: 4 }), person('B', { reliability: 5 })],
        3: [person('Jordan Reyes', { reliability: 0 }), person('A', { reliability: 4 }), person('B', { reliability: 5 })]
    });
    const { model } = placings(t, weekly, 'Jordan Reyes');
    const rel = row(model, 'reliability');

    t.equal('16 hours for the year by Q3', rel.cells[2].value, 16);
    t.equal('which is still the most, so last', rel.cells[2].rank, 3);
    t.equal('not first on a clean quarter', rel.cells[2].rank !== 1, true);
});

suite('quarter placings: the YTD file stands for the quarter it closes', (t) => {
    t.pinClock('2026-10-05');
    const weekly = store({
        1: [person('Jordan Reyes', { reliability: 0 }), person('A', { reliability: 1 })],
        2: [person('Jordan Reyes', { reliability: 1 }), person('A', { reliability: 1 })],
        3: [person('Jordan Reyes', { reliability: 2 }), person('A', { reliability: 1 })]
    });
    // Re-coded hours: the file has 8 for Jordan where the quarters add to 3.
    const ytd = period('ytd', '2026-01-01', '2026-10-01', [
        person('Jordan Reyes', { reliability: 8 }), person('A', { reliability: 3 })]);

    const q3 = placings(t, weekly, 'Jordan Reyes', ytd).model;
    t.equal('Q3 takes the file figure, as the document does', row(q3, 'reliability').cells[2].value, 8);
    t.equal('for everybody', row(q3, 'reliability').cells[2].rank, 2);
    t.equal('earlier quarters are the sums', row(q3, 'reliability').cells[1].value, 1);

    // Looking back at Q2 in October: a file pulled October 1 does not close
    // Q2, so it is not handed the summer's hours.
    const q2 = placings(t, weekly, 'Jordan Reyes', ytd, 2).model;
    t.equal('Q2 look-back stays on the sums', row(q2, 'reliability').cells[1].value, 1);
});

suite('quarter placings: a smaller field is not a climb', (t) => {
    t.pinClock('2026-10-05');
    // Last of four, then last of three: one person had no adherence in Q2.
    const weekly = store({
        1: [person('Jordan Reyes', { scheduleAdherence: 85 }), person('A', { scheduleAdherence: 95 }),
            person('B', { scheduleAdherence: 94 }), person('C', { scheduleAdherence: 93 })],
        2: [person('Jordan Reyes', { scheduleAdherence: 86 }), person('A', { scheduleAdherence: 95 }),
            person('B', { scheduleAdherence: 94 }), person('C', { scheduleAdherence: '' })]
    });
    const { model } = placings(t, weekly, 'Jordan Reyes', null, 2);
    const adh = row(model, 'scheduleAdherence');

    t.equal('4th of 4 in Q1', adh.cells[0].rank, 4);
    t.equal('3rd of 3 in Q2', adh.cells[1].rank, 3);
    t.equal('which is no climb at all', adh.cells[1].climbed, 0);
    t.equal('across the year either', adh.climbed, 0);
});

suite('quarter placings: two surveys do not make a placing to build on', (t) => {
    t.pinClock('2026-10-05');
    const weekly = store({
        1: [person('Jordan Reyes', { cxRepOverall: 70 }), person('A', { cxRepOverall: 90 }), person('B', { cxRepOverall: 80 })],
        2: [person('Jordan Reyes', { cxRepOverall: 70 }), person('A', { cxRepOverall: 90 }), person('B', { cxRepOverall: 80 })],
        3: [person('Jordan Reyes', { cxRepOverall: 100, repSurveyTotal: 2, surveyTotal: 2 }),
            person('A', { cxRepOverall: 90 }), person('B', { cxRepOverall: 80 })]
    });
    const { model } = placings(t, weekly, 'Jordan Reyes');
    const rep = row(model, 'cxRepOverall');

    t.check('Q3 is marked as under the floor', rep.cells[2].thin);
    t.equal('placed against the field without joining it', rep.cells[2].total, 2);
    t.equal('no climb is claimed into it', rep.cells[2].climbed, null);
    t.equal('the year runs to the last solid quarter', rep.climbed, 0);
});

suite('quarter placings: the suggested focus is a rate below goal, never hours', (t) => {
    t.pinClock('2026-10-05');
    const others = () => [person('A', { aht: 400, reliability: 0 }), person('B', { aht: 410, reliability: 0 })];
    const weekly = store({
        1: [person('Jordan Reyes', { aht: 470, reliability: 20 })].concat(others()),
        2: [person('Jordan Reyes', { aht: 470, reliability: 20 })].concat(others()),
        3: [person('Jordan Reyes', { aht: 470, reliability: 20 })].concat(others())
    });
    const { model } = placings(t, weekly, 'Jordan Reyes');

    t.check('the hours are the worst placing', row(model, 'reliability').cells[2].rank === 3);
    t.check('and still in the table', row(model, 'reliability').cells[2].value === 60);
    t.equal('but the focus is the rate below goal', model.focus.registry, 'aht');
    t.equal('said as below goal', model.focus.belowGoal, true);
});

suite('quarter placings: the panel is for the supervisor, not the file', (t) => {
    t.pinClock('2026-10-05');
    const weekly = store({
        1: [person('Jordan Reyes', { aht: 470 }), person('A', { aht: 400 })],
        2: [person('Jordan Reyes', { aht: 450 }), person('A', { aht: 400 })],
        3: [person('Jordan Reyes', { aht: 430 }), person('A', { aht: 400 })]
    });
    const { qr, qt, ui } = load(t, weekly);
    global.document._els.q1ReviewContent = { innerHTML: '' };
    ui.state.employee = 'Jordan Reyes';
    ui.render();
    const html = global.document._els.q1ReviewContent.innerHTML;

    t.check('the panel is on the tab', /Where Jordan placed in the call center/.test(html));
    t.check('and says who it is for', /For you, not the file/.test(html));
    t.check('with a focus for next quarter', /Suggested focus for Q4: Average Handle Time/.test(html));

    const quarters = qt.buildYearQuarters(2026).filter((q) => q.quarter <= 3);
    const ctx = qr.buildContext('Jordan Reyes', 2026, { quarters, throughQuarter: 3 });
    const filed = [qr.buildNotes(ctx).full, qr.buildTalkingPoints(ctx).text, qr.buildPrompt(ctx)].join('\n');
    t.check('no placing reaches the document, sheet or prompt', !/\b\d+(st|nd|rd|th) of \d+/.test(filed));
    t.check('and no dashes in the panel copy', !/[‒–—―]/.test(html));
});
