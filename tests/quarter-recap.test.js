'use strict';

/**
 * The recap email after a quarterly check-in, and the list of who has had one.
 *
 * Scott's ask, after a morning of Q3 meetings: "a draft of an email that
 * shows their progress through the 4 KPIs (not reliability, but maybe tell
 * them the hours against reliability) and says here's where you were in Q1,
 * Q2, Q3. With a neat little graphic ... And keep track of me sending."
 *
 * What these pin:
 *   - the numbers are the check-in document's numbers, quarter by quarter,
 *     including leaving out a survey quarter too thin to quote;
 *   - the at goal mark judges the check-in quarter only, and an improvement
 *     is only claimed when the newest quarter did not slip back (four real
 *     Q3 series are pinned below);
 *   - hours missed are the year's total against the allowance, dated, in one
 *     line of text that can be switched off, never in the picture, and never
 *     as something to work on;
 *   - the copy holds the house rules (no dashes, no rating words, no
 *     placings, no caveats), and what was quietly left out is told to Scott
 *     in the panel instead;
 *   - a failed picture copy never opens the draft, because Ctrl+V would then
 *     paste the previous associate's card;
 *   - "sent" is only ever claimed when Scott says so, survives a merge of two
 *     machines, can be undone, and a refused save never shows as sent.
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

function load(t, store, ytd, extra) {
    const opts = extra || {};
    const browser = t.installFakeBrowser();
    const ytdStore = ytd || {};
    global.window.weeklyData = store;
    global.weeklyData = store;
    global.window.ytdData = ytdStore;
    global.ytdData = ytdStore;
    browser.store[PREFIX + 'weeklyData'] = JSON.stringify(store);

    const io = { reads: 0, refuse: false };
    global.window.DevCoachModules.storage = {
        readStore(key) {
            if (key === 'quarterRecapEmails') io.reads += 1;
            const raw = browser.store[PREFIX + key];
            return raw === undefined ? undefined : JSON.parse(raw);
        },
        saveWithSizeCheck(key, data) {
            if (io.refuse) return false;
            browser.store[PREFIX + key] = JSON.stringify(data);
            return true;
        },
        loadWeeklyData() { return store; },
        loadYtdData() { return ytdStore; },
        loadDailyData() { return {}; }
    };
    Object.assign(global.window.DevCoachModules, opts.modules || {});

    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.SURVEY_WEIGHT_FIELD = global.window.SURVEY_WEIGHT_FIELD;
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/period-compare.module.js');
    t.loadModule('modules/shared-utils.module.js');
    t.loadModule('modules/quarter-trend.module.js');
    t.loadModule('modules/quarter-review.module.js');
    const readsBeforeRecap = io.reads;
    t.loadModule('modules/quarter-recap.module.js');
    io.readsAtLoad = io.reads - readsBeforeRecap;
    const mods = t.loadModule('modules/quarter-review-ui.module.js');

    global.window.formatMetricDisplay = (key, value) => {
        const def = global.METRICS_REGISTRY[key] || {};
        const n = Math.round(value * 10) / 10;
        if (def.unit === 'sec') return `${Math.round(value)}s`;
        if (def.unit === '%') return `${n.toFixed(1)}%`;
        if (def.unit === 'hrs') return `${n.toFixed(1)} hrs`;
        return String(n);
    };
    const toasts = [];
    global.window.showToast = (msg) => { toasts.push(String(msg)); };
    return {
        mods, browser, io, toasts,
        recap: mods.quarterRecap, review: mods.quarterReview, ui: mods.quarterReviewUi
    };
}

function contextFor(env, name, quarter) {
    return env.review.buildContext(name, 2026, { throughQuarter: quarter || 3 });
}

function mailFor(env, name, quarter, options) {
    return env.recap.buildRecapEmail(contextFor(env, name, quarter), options);
}

function lineFor(body, label) {
    return body.split('\n').filter((l) => l.indexOf(label + ':') > -1)[0] || '';
}

function renderInto(env, setup) {
    global.document._els.q1ReviewContent = { innerHTML: '' };
    if (setup) setup();
    env.ui.render();
    return global.document._els.q1ReviewContent.innerHTML;
}

const YEAR = Object.assign({},
    period('quarter', '2026-01-01', '2026-03-31', [person('Jordan Reyes', {
        aht: 451, scheduleAdherence: 92.1, overallSentiment: 89, cxRepOverall: 76, reliability: 6
    })]),
    period('quarter', '2026-04-01', '2026-06-30', [person('Jordan Reyes', {
        aht: 438, scheduleAdherence: 93.4, overallSentiment: 87.2, cxRepOverall: 79, reliability: 5
    })]),
    period('quarter', '2026-07-01', '2026-09-30', [person('Jordan Reyes', {
        aht: 421, scheduleAdherence: 94, overallSentiment: 86.5, cxRepOverall: 80.5, reliability: 3.5
    })])
);

// The same associate with someone joining them, so the list has a "next".
const TEAM = Object.assign({}, YEAR,
    period('quarter', '2026-07-01', '2026-09-30', [
        YEAR['2026-07-01|2026-09-30'].employees[0],
        person('Casey New', { aht: 440, reliability: 1 })
    ]));

const DASHES = ['—', '–', '―', '&mdash;', '&ndash;', '&#8212;', '&#8213;', '\\u2014', '\\u2013'];
const RATING_WORDS = [/off[- ]track/i, /on[- ]track/i, /\bexceptional\b/i, /\bsuccessful\b/i, /\btier\b/i, /score\s*[123]\b/i];
const PLACING_WORDS = [/\brank/i, /\bplac(e|ed|ing)\b/i, /\bbetter than \d+/i, /\bcall center\b/i, /\bcentre\b/i, /\baverage of\b/i];

/* ── The email ── */

suite('recap email: where each KPI was in each quarter', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    const mail = mailFor(env, 'Jordan Reyes');

    t.check('it is built', !!mail);
    t.equal('the subject names the check-in', mail.subject, 'Your Q3 check-in recap');
    t.check('it greets them by first name', mail.body.indexOf('Hi Jordan,') === 0);
    t.check('it thanks them for the meeting, and says where they were in Scott\'s words',
        mail.body.indexOf('Thanks for sitting down with me for your Q3 check-in. Here\'s where you were in Q1, Q2 and Q3:') > -1);

    t.equal('handle time, every quarter, the move and the goal', lineFor(mail.body, 'Average Handle Time'),
        '✅ Average Handle Time: Q1 451s, Q2 438s, Q3 421s, down 30 seconds (goal 426s or lower)');
    t.equal('adherence, with the goal written the way it was set', lineFor(mail.body, 'Schedule Adherence'),
        '✅ Schedule Adherence: Q1 92.1%, Q2 93.4%, Q3 94.0%, up 1.9 points (goal 93% or better)');
    t.equal('sentiment, which slipped, says nothing about the slip', lineFor(mail.body, 'Overall Sentiment'),
        '🔸 Overall Sentiment: Q1 89.0%, Q2 87.2%, Q3 86.5% (goal 88% or better)');
    t.equal('rep satisfaction, climbing toward goal', lineFor(mail.body, 'Rep Satisfaction'),
        '🔸 Rep Satisfaction: Q1 76.0%, Q2 79.0%, Q3 80.5%, up 4.5 points (goal 82% or better)');

    const order = ['Average Handle Time', 'Schedule Adherence', 'Overall Sentiment', 'Rep Satisfaction']
        .map((label) => mail.body.indexOf(label + ':'));
    t.check('in the order the check-in raises them', order.every((v, i) => v > -1 && (i === 0 || v > order[i - 1])));
    ['First Call Resolution', 'Overall Experience', 'Transfers'].forEach((label) => {
        t.check(`${label} is not one of the four`, mail.body.indexOf(label) === -1);
    });

    t.check('a line on where Q3 left them', mail.body.indexOf('Some of these are already at goal, and Q4 is a full quarter to bring the rest along.') > -1);
    t.check('the hours, dated', mail.body.indexOf('Reliability: 14.5 hrs missed in 2026 through September 30 (allowance 18 hrs).') > -1);
    t.check('and it signs off the way Scott\'s other emails do',
        mail.body.split('\n').pop() === 'Happy to walk through any of it.');
    t.check('no rising chart mark, which reads backwards on handle time', mail.body.indexOf('📈') === -1);
});

suite('recap email: the order keeps the hours away from anything forward looking', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    const lines = mailFor(env, 'Jordan Reyes').body.split('\n');
    const hoursAt = lines.findIndex((l) => /^Reliability:/.test(l));
    const countAt = lines.findIndex((l) => /Q4 is a full quarter/.test(l));
    t.check('the KPI summary comes before the hours', countAt > -1 && countAt < hoursAt);
    t.check('and nothing after the hours asks for a focus or looks to Q4',
        !/focus|work on|Q4|thoughts\?/i.test(lines.slice(hoursAt + 1).join('\n')));
});

suite('recap email: an improvement is only claimed when the newest quarter held it', (t) => {
    t.pinClock('2026-10-07');
    // Four real Q3 series from the 10/07 replay, and one that should keep
    // its words. Each "moved around" in the check-in document.
    const rows = (q, values) => values.map(([name, over]) => person(name, over));
    const env = load(t, Object.assign({},
        period('quarter', '2026-01-01', '2026-03-31', rows(1, [
            ['Kristin Villela', { aht: 618 }], ['Angelina Fierro', { aht: 655 }], ['Sabrina Gage', { aht: 517 }],
            ['Kamella Dash', { cxRepOverall: 75.0 }], ['Esperanza Palomera', { aht: 591 }]])),
        period('quarter', '2026-04-01', '2026-06-30', rows(2, [
            ['Kristin Villela', { aht: 510 }], ['Angelina Fierro', { aht: 481 }], ['Sabrina Gage', { aht: 432 }],
            ['Kamella Dash', { cxRepOverall: 81.8 }], ['Esperanza Palomera', { aht: 502 }]])),
        period('quarter', '2026-07-01', '2026-09-30', rows(3, [
            ['Kristin Villela', { aht: 589 }], ['Angelina Fierro', { aht: 540 }], ['Sabrina Gage', { aht: 474 }],
            ['Kamella Dash', { cxRepOverall: 76.5 }], ['Esperanza Palomera', { aht: 503 }]]))));

    t.equal('618, 510, 589 claims nothing', lineFor(mailFor(env, 'Kristin Villela').body, 'Average Handle Time'),
        '🔸 Average Handle Time: Q1 618s, Q2 510s, Q3 589s (goal 426s or lower)');
    t.check('655, 481, 540 claims nothing', !/down|up/.test(lineFor(mailFor(env, 'Angelina Fierro').body, 'Average Handle Time')));
    t.check('517, 432, 474 claims nothing', !/down|up/.test(lineFor(mailFor(env, 'Sabrina Gage').body, 'Average Handle Time')));
    t.check('75.0, 81.8, 76.5 claims nothing', !/down|up/.test(lineFor(mailFor(env, 'Kamella Dash').body, 'Rep Satisfaction')));
    // A one second uptick in Q3 is inside the noise band, so the climb holds.
    t.check('591, 502, 503 keeps its words', /Q3 503s, down 88 seconds/.test(lineFor(mailFor(env, 'Esperanza Palomera').body, 'Average Handle Time')));
});

suite('recap email: a survey quarter too thin to quote is left out, the same as the document', (t) => {
    t.pinClock('2026-10-07');
    const thin = Object.assign({}, YEAR,
        period('quarter', '2026-04-01', '2026-06-30', [person('Jordan Reyes', {
            aht: 438, scheduleAdherence: 93.4, overallSentiment: 87.2, cxRepOverall: 100,
            repSurveyTotal: 2, surveyTotal: 2, fcrSurveyTotal: 2, reliability: 5
        })]));
    const env = load(t, thin);
    const mail = mailFor(env, 'Jordan Reyes');

    t.equal('rep satisfaction skips Q2', lineFor(mail.body, 'Rep Satisfaction'),
        '🔸 Rep Satisfaction: Q1 76.0%, Q3 80.5%, up 4.5 points (goal 82% or better)');
    t.check('the two survey 100% is nowhere', mail.body.indexOf('100.0%') === -1);
    t.check('handle time still has all three', mail.body.indexOf('Q1 451s, Q2 438s, Q3 421s') > -1);
    const rep = mail.model.kpis.filter((k) => k.metricKey === 'cxRepOverall')[0];
    t.equal('the picture has an empty Q2 tile for it', rep.points[1].shown, false);
    t.check('and no caveat explains the gap', !/survey|too few|not enough/i.test(mail.body));
});

suite('recap email: a check-in quarter too thin to judge gets no mark, and Scott is told', (t) => {
    t.pinClock('2026-10-07');
    const thinNow = Object.assign({}, YEAR,
        period('quarter', '2026-07-01', '2026-09-30', [person('Jordan Reyes', {
            aht: 421, scheduleAdherence: 94, overallSentiment: 86.5, cxRepOverall: 100,
            repSurveyTotal: 1, surveyTotal: 1, fcrSurveyTotal: 1, reliability: 3.5
        })]));
    const env = load(t, thinNow);
    const mail = mailFor(env, 'Jordan Reyes');
    const line = lineFor(mail.body, 'Rep Satisfaction');

    // Judging it on Q2 would tell someone whose Q3 was poor that it was fine.
    t.equal('the line carries no mark at all', line, 'Rep Satisfaction: Q1 76.0%, Q2 79.0%, up 3 points (goal 82% or better)');
    t.check('the Q3 tile is empty', mail.model.kpis[3].points[2].shown === false);
    t.check('the summary counts only what Q3 judged', mail.body.indexOf('Most of these are at goal in Q3. Keep it going 💪') > -1);
    const notes = env.recap.buildRecapNotes(mail.model);
    t.check('the panel tells Scott why', notes.some((n) => n === 'Rep Satisfaction has no Q3 number in the email: one survey in Q3, too few to quote.'));
    t.check('and the email does not', !/survey/i.test(mail.body));
});

suite('recap email: a KPI with no quotable quarter at all drops out quietly', (t) => {
    t.pinClock('2026-10-07');
    const noSurveys = {};
    Object.keys(YEAR).forEach((key) => {
        noSurveys[key] = Object.assign({}, YEAR[key], {
            employees: YEAR[key].employees.map((e) => Object.assign({}, e, { repSurveyTotal: 1, surveyTotal: 1, fcrSurveyTotal: 1 }))
        });
    });
    const env = load(t, noSurveys);
    const mail = mailFor(env, 'Jordan Reyes');
    t.check('rep satisfaction is not in it', mail.body.indexOf('Rep Satisfaction') === -1);
    t.check('the other three are', /Average Handle Time:/.test(mail.body) && /Overall Sentiment:/.test(mail.body));
    t.check('nothing claims four KPIs', !/four|4 KPIs/i.test(mail.body));
    t.equal('the picture has three rows', env.recap.layoutRecapCard(mail.model).rows.length, 3);
});

suite('recap email: someone who joined in April gets the quarters they were here for', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, Object.assign({}, YEAR,
        period('quarter', '2026-04-01', '2026-06-30', [
            YEAR['2026-04-01|2026-06-30'].employees[0],
            person('Casey New', { aht: 470, reliability: 2 })
        ]),
        period('quarter', '2026-07-01', '2026-09-30', [
            YEAR['2026-07-01|2026-09-30'].employees[0],
            person('Casey New', { aht: 440, reliability: 1 })
        ])));
    const mail = mailFor(env, 'Casey New');

    t.check('two quarters, not an empty Q1', mail.body.indexOf('Here\'s where you were in Q2 and Q3:') > -1);
    t.check('the line starts at Q2', mail.body.indexOf('Average Handle Time: Q2 470s, Q3 440s, down 30 seconds') > -1);
    t.equal('the picture has two columns', mail.model.columns.map((c) => c.name).join(','), 'Q2,Q3');
});

suite('recap email: a Q4 recap looks to next year and still fits a mailto', (t) => {
    t.pinClock('2027-01-12');
    const longName = 'Christi Martinez-Sharp Wellington';
    const env = load(t, Object.assign({},
        period('quarter', '2026-01-01', '2026-03-31', [person(longName, { aht: 451, scheduleAdherence: 92, reliability: 4 })]),
        period('quarter', '2026-04-01', '2026-06-30', [person(longName, { aht: 438, scheduleAdherence: 92.5, reliability: 4 })]),
        period('quarter', '2026-07-01', '2026-09-30', [person(longName, { aht: 431, scheduleAdherence: 92.8, reliability: 4 })]),
        period('quarter', '2026-10-01', '2026-12-31', [person(longName, { aht: 470, scheduleAdherence: 90, overallSentiment: 80, cxRepOverall: 60, reliability: 4 })])));
    const mail = mailFor(env, longName, 4);
    t.equal('the subject says Q4', mail.subject, 'Your Q4 check-in recap');
    t.check('four quarters', mail.body.indexOf('in Q1, Q2, Q3 and Q4:') > -1);
    t.check('the close looks to next year', /Next year is a fresh start on these/.test(mail.body));
    t.equal('the picture has four columns', mail.model.columns.length, 4);
    t.check(`the longest case still fits a mailto (${mail.href.length} chars)`, mail.href.length < 2000);
});

/* ── Hours missed ── */

suite('recap email: hours missed are the year total against the allowance', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    const mail = mailFor(env, 'Jordan Reyes');
    const line = lineFor(mail.body, 'Reliability');

    // 6 + 5 + 3.5. Never a quarter's own 3.5.
    t.equal('the total, dated, against the allowance', line,
        'Reliability: 14.5 hrs missed in 2026 through September 30 (allowance 18 hrs).');
    t.check('no quarter\'s own hours appear', !/(^|[^\d.])3\.5 hrs/.test(mail.body) && !/(^|[^\d.])5\.0 hrs/.test(mail.body));
    t.check('and never as better or worse, or a verdict', !/better|worse|improv|over|inside|under/i.test(line));
    t.equal('the email says the hours line went in', mail.includedHours, true);
});

suite('recap email: the year to date upload is the year total, dated by its last day', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR, period('ytd', '2026-01-01', '2026-10-05', [person('Jordan Reyes', { reliability: 16.25 })]));
    const mail = mailFor(env, 'Jordan Reyes');
    t.equal('the upload\'s figure, through the day it runs to', lineFor(mail.body, 'Reliability'),
        'Reliability: 16.3 hrs missed in 2026 through October 5 (allowance 18 hrs).');
    t.check('the summed quarters are not in the email', mail.body.indexOf('14.5') === -1);
    const notes = env.recap.buildRecapNotes(mail.model);
    t.check('Scott is told the two disagree', notes.some((n) => /year to date file says 16\.3 hrs, and the quarters add up to 14\.5 hrs/.test(n)));
});

suite('recap email: no hours missed is said in words', (t) => {
    t.pinClock('2026-10-07');
    const none = {};
    Object.keys(YEAR).forEach((key) => {
        none[key] = Object.assign({}, YEAR[key], {
            employees: YEAR[key].employees.map((e) => Object.assign({}, e, { reliability: 0 }))
        });
    });
    const env = load(t, none);
    t.equal('not "0 hrs"', lineFor(mailFor(env, 'Jordan Reyes').body, 'Reliability'),
        'Reliability: no hours missed in 2026 through September 30 (allowance 18 hrs).');
});

suite('recap email: hours past the allowance are stated, never set as something to work on', (t) => {
    t.pinClock('2026-10-07');
    const over = (hours) => Object.assign({},
        period('quarter', '2026-01-01', '2026-03-31', [person('Jordan Reyes', { aht: 451, reliability: hours[0] })]),
        period('quarter', '2026-04-01', '2026-06-30', [person('Jordan Reyes', { aht: 438, reliability: hours[1] })]),
        period('quarter', '2026-07-01', '2026-09-30', [person('Jordan Reyes', { aht: 421, reliability: hours[2] })]));
    const env = load(t, over([10, 8, 6]));
    const mail = mailFor(env, 'Jordan Reyes');
    t.equal('the line is the two facts', lineFor(mail.body, 'Reliability'),
        'Reliability: 24 hrs missed in 2026 through September 30 (allowance 18 hrs).');
    t.check('no focus wording anywhere near it',
        !/focus|work on|improve|reduce|attendance policy|over the allowance/i.test(lineFor(mail.body, 'Reliability')));
    t.equal('24 against 18 needs no note', env.recap.buildRecapNotes(mail.model).length, 0);

    // Far past it is worth a second look before it goes: it may be leave.
    const far = load(t, over([20, 12, 8]));
    const notes = far.recap.buildRecapNotes(mailFor(far, 'Jordan Reyes').model);
    t.check('40 hrs against 18 asks Scott to check for leave',
        notes.some((n) => n === '40 hrs is more than twice the 18 hrs allowance. If any of it is protected leave, untick Include the hours line.'));
});

suite('recap email: the hours line can be left out for one associate', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    const mail = mailFor(env, 'Jordan Reyes', 3, { includeHours: false });
    t.check('no hours in the text', mail.body.indexOf('Reliability') === -1 && !/hrs/.test(mail.body));
    t.equal('and the email says so', mail.includedHours, false);
    t.equal('nor a note about hours that are not going', env.recap.buildRecapNotes(mail.model, { includeHours: false }).length, 0);
});

suite('recap email: a part year is not judged against a whole year allowance', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, Object.assign({}, YEAR,
        period('quarter', '2026-04-01', '2026-06-30', [
            YEAR['2026-04-01|2026-06-30'].employees[0],
            person('Casey New', { aht: 470, reliability: 9 })
        ]),
        period('quarter', '2026-07-01', '2026-09-30', [
            YEAR['2026-07-01|2026-09-30'].employees[0],
            person('Casey New', { aht: 440, reliability: 6 })
        ])));
    const mail = mailFor(env, 'Casey New');
    // A quarter nobody uploaded and a quarter before they started look the
    // same from here, so a total that may be short is not sent.
    t.check('no hours line goes out', mail.body.indexOf('Reliability') === -1);
    t.equal('nothing claims the hours went in', mail.includedHours, false);
    const notes = env.recap.buildRecapNotes(mail.model);
    t.check('Scott is told why, in the panel', notes.some((n) =>
        n === 'Hours are left out of Casey\'s email. There is no year to date figure, and Q1 has no hours uploaded, so the total could be short. Add them by hand if you have the number.'));
});

suite('recap email: no attendance column means no hours line, not zero', (t) => {
    t.pinClock('2026-10-07');
    const blank = {};
    Object.keys(YEAR).forEach((key) => {
        blank[key] = Object.assign({}, YEAR[key], {
            employees: YEAR[key].employees.map((e) => Object.assign({}, e, { reliability: '' }))
        });
    });
    const env = load(t, blank);
    const mail = mailFor(env, 'Jordan Reyes');
    t.check('nothing about hours', mail.body.indexOf('Reliability') === -1);
    t.equal('and nothing to switch off', mail.model.hours, null);
});

/* ── House rules ── */

suite('recap email: the copy holds the house rules', (t) => {
    t.pinClock('2026-10-07');
    const rough = Object.assign({}, YEAR,
        period('quarter', '2026-07-01', '2026-09-30', [person('Jordan Reyes', {
            aht: 470, scheduleAdherence: 90, overallSentiment: 80, cxRepOverall: 70, reliability: 30
        })]));
    [YEAR, rough].forEach((store, i) => {
        const env = load(t, store);
        const mail = mailFor(env, 'Jordan Reyes');
        const notes = env.recap.buildRecapNotes(mail.model).join('\n');
        const all = mail.subject + '\n' + mail.body;
        DASHES.forEach((d) => t.check(`case ${i}: no ${JSON.stringify(d)}`, (all + notes).indexOf(d) === -1));
        RATING_WORDS.forEach((re) => t.check(`case ${i}: no rating word ${re}`, !re.test(all)));
        PLACING_WORDS.forEach((re) => t.check(`case ${i}: no placing ${re}`, !re.test(all)));
        t.check(`case ${i}: no caveat about the data`, !/upload|file|data|estimate|approximately|may not/i.test(all));
    });
});

suite('recap email: the module source holds the dash rule, spaced hyphens included', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'modules/quarter-recap.module.js'), 'utf8');
    const literals = src.match(/'(?:[^'\\\n]|\\.)*'/g) || [];
    t.equal('no dash in any string', literals.filter((s) => /[—–―]|\\u201[34]|\\u2015|&mdash;|&ndash;/.test(s)).join(' | ') || '(none)', '(none)');
    t.equal('and no hyphen standing in for one', literals.filter((s) => / - /.test(s)).join(' | ') || '(none)', '(none)');
});

/* ── The mailto ── */

suite('recap email: the draft opens addressed, and fits in a mailto', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    const mail = mailFor(env, 'Jordan Reyes');

    t.equal('to the associate, by the address pattern', mail.to, 'jordan.reyes@aps.com');
    t.equal('copied to the coaching address like every coaching draft', mail.cc, 'Brandywine.Lockhart@aps.com');
    t.check('the href is a mailto to them', mail.href.indexOf('mailto:jordan.reyes%40aps.com?cc=') === 0);
    t.check('with the subject', mail.href.indexOf('subject=Your%20Q3%20check-in%20recap') > -1);
    t.check('and the body, line breaks kept', mail.href.indexOf('&body=Hi%20Jordan%2C%0A') > -1);
    // An over-long mailto opens nothing at all on older Chrome and Edge, with
    // no error anywhere.
    t.check(`short enough for every browser (${mail.href.length} chars)`, mail.href.length < 2000);

    const cleared = mailFor(env, 'Jordan Reyes', 3, { cc: '' });
    t.check('a cleared CC leaves the cc out entirely', cleared.href.indexOf('cc=') === -1);
});

suite('recap email: an address override wins over the pattern', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    env.mods.sharedUtils.setAssociateEmailOverride('Jordan Reyes', 'jr.custom@aps.com');
    t.equal('the override is the To', mailFor(env, 'Jordan Reyes').to, 'jr.custom@aps.com');
});

/* ── The picture ── */

function recordingContext() {
    const calls = { text: [], fills: [], fillStyles: [] };
    return {
        calls,
        scale() {}, fillRect() { calls.fillStyles.push(this.fillStyle); }, beginPath() {}, moveTo() {}, lineTo() {},
        arcTo() {}, arc() {}, closePath() {}, stroke() {}, setLineDash() {},
        fill() { calls.fills.push(this.fillStyle); },
        fillText(s) { calls.text.push(String(s)); },
        measureText(s) { return { width: String(s).length * 6 }; }
    };
}

function recordingCanvas() {
    const ctx = recordingContext();
    const canvas = { style: {}, width: 0, height: 0, getContext: () => ctx, toBlob(cb) { cb({ size: 1 }); } };
    return { canvas, ctx, doc: { createElement: () => canvas } };
}

suite('recap picture: a scoreboard that sits in an email', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    const layout = env.recap.layoutRecapCard(mailFor(env, 'Jordan Reyes').model);

    t.equal('640 wide, which fits a reading pane', layout.W, 640);
    t.equal('one row per KPI', layout.rows.length, 4);
    t.check('three tiles fit beside the labels', layout.tilesX > layout.padX + 100 && layout.changeX + 60 <= layout.W - layout.padX + 10);
    t.check('and the first name is the biggest text on it', layout.titleSize > layout.valueSize);
    t.check('rows run down the card in order', layout.rows.every((r, i) => i === 0 || r.y > layout.rows[i - 1].y));
    t.check('and the card ends below the last row', layout.rows[3].y + layout.tileH < layout.H);
});

suite('recap picture: what is drawn is the same numbers, and nothing it should not say', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    const model = mailFor(env, 'Jordan Reyes').model;
    const rec = recordingCanvas();
    const canvas = env.recap.drawRecapCard(model, { document: rec.doc });
    const drawn = rec.ctx.calls.text;
    const all = drawn.join('\n');

    t.check('a canvas comes back', canvas === rec.canvas);
    t.equal('drawn at true size by default, which is what goes into the email', rec.canvas.width, 640);
    t.check('the title is theirs', /Jordan's 2026, quarter by quarter/.test(all));
    t.check('each KPI is labelled', ['Average Handle Time', 'Schedule Adherence', 'Overall Sentiment', 'Rep Satisfaction']
        .every((label) => drawn.indexOf(label) > -1));
    t.check('each quarter heading', ['Q1', 'Q2', 'Q3'].every((q) => drawn.indexOf(q) > -1));
    t.check('each quarter value', ['451s', '438s', '421s', '92.1%', '94.0%', '86.5%', '80.5%']
        .every((v) => drawn.indexOf(v) > -1));
    t.check('the goals', drawn.indexOf('Goal 426s or lower') > -1 && drawn.indexOf('Goal 93% or better') > -1);
    t.check('the moves that held, short', drawn.indexOf('down 30s') > -1 && drawn.indexOf('up 4.5 pts') > -1 && drawn.indexOf('since Q1') > -1);
    // Handle time Q3, adherence Q2 and Q3, sentiment Q1: four tiles at goal.
    t.equal('a tick on every tile at goal, so colour is never the only sign', drawn.filter((s) => s === '✓').length, 4);
    t.check('and the key says what green means', drawn.indexOf('✓ Green tiles are at goal.') > -1);
    t.check('at goal tiles are tinted green', rec.ctx.calls.fills.indexOf('#e4f3e8') > -1);
    t.check('nothing is red', rec.ctx.calls.fills.concat(rec.ctx.calls.fillStyles).every((c) => !/#c62828|#dc2626|#b91c1c/i.test(String(c))));

    // Hours stay out of the picture: Scott cannot edit a pasted image.
    t.check('no hours drawn', !/hrs|Reliability|allowance/i.test(all));
    DASHES.forEach((d) => t.check(`no ${JSON.stringify(d)} drawn`, all.indexOf(d) === -1));
    RATING_WORDS.forEach((re) => t.check(`no rating word ${re} drawn`, !re.test(all)));
    PLACING_WORDS.forEach((re) => t.check(`no placing ${re} drawn`, !re.test(all)));

    const sharp = recordingCanvas();
    env.recap.drawRecapCard(model, { document: sharp.doc, scale: 2 });
    t.equal('the on screen copy can be drawn sharper', sharp.canvas.width, 1280);
});

suite('recap picture: a quarter that is not shown is an empty tile', (t) => {
    t.pinClock('2026-10-07');
    const thin = Object.assign({}, YEAR,
        period('quarter', '2026-04-01', '2026-06-30', [person('Jordan Reyes', {
            aht: 438, scheduleAdherence: 93.4, overallSentiment: 87.2, cxRepOverall: 100,
            repSurveyTotal: 2, surveyTotal: 2, fcrSurveyTotal: 2, reliability: 5
        })]));
    const env = load(t, thin);
    const rec = recordingCanvas();
    env.recap.drawRecapCard(mailFor(env, 'Jordan Reyes').model, { document: rec.doc });
    t.check('a dot stands in for it', rec.ctx.calls.text.indexOf('·') > -1);
    t.check('and its number is nowhere', rec.ctx.calls.text.indexOf('100.0%') === -1);
});

suite('recap picture: without a canvas there is no picture, and nothing throws', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    let out = 'unset';
    try { out = env.recap.drawRecapCard(mailFor(env, 'Jordan Reyes').model); } catch (err) { out = 'threw: ' + err.message; }
    t.equal('no canvas support, no picture', out, null);
});

// Node ships a read-only global navigator, so a stub has to be defined over
// it rather than assigned, and put back afterwards.
function withNavigator(value, fn) {
    const before = Object.getOwnPropertyDescriptor(global, 'navigator');
    Object.defineProperty(global, 'navigator', { value, configurable: true, writable: true });
    return Promise.resolve().then(fn).finally(() => {
        if (before) Object.defineProperty(global, 'navigator', before);
        else delete global.navigator;
    });
}

function refusal(name, message) {
    const err = new Error(message);
    err.name = name;
    return err;
}

suite('recap picture: the copy reports what happened, in the browser\'s own words', async (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    const canvas = recordingCanvas().canvas;

    t.equal('no canvas', (await env.recap.copyCardImage(null)).state, 'failed');
    delete global.window.ClipboardItem;
    t.equal('no clipboard image support', (await env.recap.copyCardImage(canvas)).state, 'unsupported');

    const written = [];
    global.window.ClipboardItem = class { constructor(items) { this.items = items; } };
    await withNavigator({ clipboard: { write: (items) => { written.push(items); return Promise.resolve(); } } }, async () => {
        t.equal('copied when the clipboard takes it', (await env.recap.copyCardImage(canvas)).state, 'copied');
        t.check('as a png', written.length === 1 && !!written[0][0].items['image/png']);
    });
    await withNavigator({ clipboard: { write: () => Promise.reject(refusal('NotAllowedError', 'Document is not focused.')) } }, async () => {
        const result = await env.recap.copyCardImage(canvas);
        t.equal('a refusal is a failure', result.state, 'failed');
        t.equal('with the reason Scott has no console to read', result.reason, 'NotAllowedError: Document is not focused.');
    });
    await withNavigator({ clipboard: { write: () => new Promise(() => {}) } }, async () => {
        const result = await env.recap.copyCardImage(canvas, { timeoutMs: 20 });
        t.equal('a write that never answers gives up', result.state, 'failed');
        t.check('and says so', /did not answer/.test(result.reason));
    });
    delete global.window.ClipboardItem;
});

suite('recap picture: copying never falls back to a download', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'modules/quarter-recap.module.js'), 'utf8');
    const ui = fs.readFileSync(path.join(ROOT, 'modules/quarter-review-ui.module.js'), 'utf8');
    [src, ui].forEach((text, i) => {
        t.check(`file ${i}: no download attribute`, !/\.download\s*=/.test(text));
        t.check(`file ${i}: no object URL`, !/createObjectURL/.test(text));
    });
    // Built with the blob promise, inside the click, or the clipboard refuses.
    t.check('the clipboard item gets the promise, not an awaited blob',
        /var blob = new Promise/.test(src) && /new window\.ClipboardItem\(\{ 'image\/png': blob \}\)/.test(src));
});

/* ── The sent log ── */

suite('recap log: drafted when it opens, sent only when marked, and Undo works', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    const r = env.recap;
    const status = () => r.statusFor('Jordan Reyes', 2026, 3);

    t.equal('nothing yet', status().state, 'none');
    t.equal('hours are in by default', status().includeHours, true);

    r.recordDrafted('Jordan Reyes', 2026, 3, { to: 'jordan.reyes@aps.com', subject: 'Your Q3 check-in recap', hours: true },
        { now: '2026-10-07T15:00:00Z' });
    t.equal('opening the draft is not sending it', status().state, 'drafted');

    r.markSent('Jordan Reyes', 2026, 3, {}, { now: '2026-10-07T15:05:00Z' });
    t.equal('marked sent', status().state, 'sent');
    t.equal('with when', status().at, '2026-10-07T15:05:00.000Z');

    r.undoSent('Jordan Reyes', 2026, 3, { now: '2026-10-07T15:06:00Z' });
    t.equal('undo takes it back to the draft', status().state, 'drafted');

    r.markSkipped('Jordan Reyes', 2026, 3, { now: '2026-10-07T15:07:00Z' });
    t.equal('it can be set aside as not sending', status().state, 'skipped');
    r.undoSent('Jordan Reyes', 2026, 3, { now: '2026-10-07T15:08:00Z' });
    t.equal('and that can be taken back too', status().state, 'drafted');

    r.setIncludeHours('Jordan Reyes', 2026, 3, false, { now: '2026-10-07T15:09:00Z' });
    t.equal('the hours switch is remembered', status().includeHours, false);
    r.setIncludeHours('Jordan Reyes', 2026, 3, true, { now: '2026-10-07T15:10:00Z' });
    t.equal('both ways', status().includeHours, true);

    const saved = JSON.parse(env.browser.store[PREFIX + 'quarterRecapEmails']);
    const list = saved['Jordan Reyes|2026|Q3'];
    t.check('the log is saved under its own store', Array.isArray(list));
    t.equal('every step is kept, nothing overwritten', list.length, 7);
    t.check('the draft remembers who it went to, and whether hours were in it',
        list[0].to === 'jordan.reyes@aps.com' && list[0].hours === true);
    t.equal('a different quarter is its own entry', r.statusFor('Jordan Reyes', 2026, 2).state, 'none');
    t.equal('the key tolerates stray spacing', r.recapKey(' Jordan Reyes ', '2026', '3'), 'Jordan Reyes|2026|Q3');
});

suite('recap log: a refused save is never shown as sent', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    env.io.refuse = true;
    t.equal('the mark reports it did not save', env.recap.markSent('Jordan Reyes', 2026, 3, {}), null);
    t.equal('and the status has not moved', env.recap.statusFor('Jordan Reyes', 2026, 3).state, 'none');
});

suite('recap log: nothing reads the log while the page is still loading', (t) => {
    t.pinClock('2026-10-07');
    // Modules load before the stores are hydrated. A read then sees an empty
    // log, and the first mark would save over the real one.
    const env = load(t, YEAR);
    t.equal('loading the module reads nothing', env.io.readsAtLoad, 0);
});

suite('recap log: two machines marking different people both survive a merge', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    const r = env.recap;

    // The real merge, lifted out of manifest-sync, so this is the code that
    // runs when both machines changed the store.
    const src = fs.readFileSync(path.join(ROOT, 'modules/manifest-sync.module.js'), 'utf8');
    const block = src.slice(src.indexOf('function canonicalize'), src.indexOf('async function reconcile'));
    const unionValues = new Function(block + '\nreturn unionValues;')();

    const work = {
        'Jordan Reyes|2026|Q3': [{ event: 'drafted', at: '2026-10-07T15:00:00.000Z' }, { event: 'sent', at: '2026-10-07T15:05:00.000Z' }]
    };
    const home = {
        'Jordan Reyes|2026|Q3': [{ event: 'drafted', at: '2026-10-07T15:00:00.000Z' }],
        'Casey New|2026|Q3': [{ event: 'sent', at: '2026-10-07T20:00:00.000Z' }]
    };
    const merged = unionValues(home, work);
    t.equal('Jordan is still sent', r.statusFor('Jordan Reyes', 2026, 3, merged).state, 'sent');
    t.equal('Casey is sent too', r.statusFor('Casey New', 2026, 3, merged).state, 'sent');

    // An Undo on one machine, merged with the other's older send. The merge
    // puts the other machine's entries first, so position means nothing.
    const undone = { 'Jordan Reyes|2026|Q3': work['Jordan Reyes|2026|Q3'].concat([{ event: 'unsent', at: '2026-10-08T09:00:00.000Z' }]) };
    t.equal('the later Undo wins, by time', r.statusFor('Jordan Reyes', 2026, 3, unionValues(work, undone)).state, 'drafted');
    t.equal('whichever side the merge starts from', r.statusFor('Jordan Reyes', 2026, 3, unionValues(undone, work)).state, 'drafted');
});

suite('recap log: the store is synced and merged entry by entry', (t) => {
    t.installFakeBrowser();
    const registry = t.loadModule('modules/store-registry.module.js').storeRegistry;
    t.equal('it is data, so it reaches the cloud', registry.tierOf('quarterRecapEmails'), 'data');
    t.equal('it merges rather than overwrites', registry.mergeStrategyOf('quarterRecapEmails'), 'unionByEntryHash');
    t.check('it is in the synced set', registry.syncedNames().indexOf('quarterRecapEmails') > -1);
    const repoSync = fs.readFileSync(path.join(ROOT, 'modules/repo-sync.module.js'), 'utf8');
    t.check('a mark queues a push of its own', /STORAGE_PREFIX \+ 'quarterRecapEmails'/.test(repoSync));
});

suite('recap module: it loads after the check-in document and before the tab', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const at = (f) => html.indexOf("'modules/" + f + "'");
    t.check('it is in the loader', at('quarter-recap.module.js') > -1);
    t.check('after quarter-review, which it reads', at('quarter-recap.module.js') > at('quarter-review.module.js'));
    t.check('before the tab that uses it', at('quarter-recap.module.js') < at('quarter-review-ui.module.js'));
});

/* ── The Quarterly tab ── */

// Elements the tab binds to, so a test can press a button the way a click
// would and see what the handler did.
function controls(ids) {
    const els = global.document._els;
    ids.forEach((id) => {
        els[id] = {
            id, listeners: {}, disabled: false, dataset: {}, style: {},
            addEventListener(type, fn) { this.listeners[type] = fn; }
        };
    });
    return els;
}

function press(el, type, extra) {
    return el.listeners[type || 'click'](Object.assign({ currentTarget: el, target: el }, extra || {}));
}

// A document whose canvases draw and whose links record the mailto they
// would have opened.
function dom() {
    const opened = [];
    global.document.createElement = (tag) => {
        if (tag === 'canvas') return recordingCanvas().canvas;
        if (tag === 'a') return { href: '', click() { opened.push(this.href); } };
        return { style: {}, dataset: {}, value: '', textContent: '', setAttribute() {}, select() {},
            addEventListener() {}, appendChild() {}, querySelector: () => null };
    };
    return { opened };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

const BUTTONS = ['quarterRecapOpen', 'quarterRecapOpenOnly', 'quarterRecapMarkSent', 'quarterRecapUndoSent',
    'quarterRecapSkip', 'quarterRecapNext', 'quarterRecapIncludeHours', 'quarterRecapCopyText'];

suite('quarterly tab: the recap email sits beside the talking points', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    const closed = renderInto(env, () => { env.ui.state.employee = 'Jordan Reyes'; });

    t.check('a button opens it', /id="quarterReviewRecapToggle"/.test(closed));
    t.check('named for the quarter', /Q3 recap email/.test(closed));
    t.check('with where it stands', /Recap not sent yet/.test(closed));
    t.check('and it starts closed', !/id="quarterRecapPanel"/.test(closed));

    const open = renderInto(env, () => { env.ui.state.showRecap = true; });
    t.check('open, the panel is there', /id="quarterRecapPanel"/.test(open));
    t.check('addressed', /jordan\.reyes@aps\.com/.test(open));
    t.check('with the subject', /Your Q3 check-in recap/.test(open));
    t.check('a place for the picture', /id="quarterRecapImage"/.test(open));
    t.check('the email text to read before sending', /Here&#039;s where you were in Q1, Q2 and Q3|Here's where you were in Q1, Q2 and Q3/.test(open));
    t.check('the hours switch, on', /id="quarterRecapIncludeHours" checked/.test(open));
    t.check('the one button that does it, first', open.indexOf('id="quarterRecapOpen"') > -1
        && open.indexOf('id="quarterRecapOpen"') < open.indexOf('id="quarterRecapMarkSent"'));
    t.check('the rest folded under More', /<details[^>]*><summary[^>]*>More<\/summary>[\s\S]*quarterRecapCopyImage[\s\S]*quarterRecapCopyText[\s\S]*quarterRecapSkip/.test(open));
    t.check('and a reminder to check the name on the picture', /check it says Jordan before you send/.test(open));
    t.equal('it stays open for the next associate', env.ui.state.showRecap, true);

    DASHES.forEach((d) => t.check(`no ${JSON.stringify(d)} in the panel`, !open.includes(d)));
    RATING_WORDS.forEach((re) => t.check(`no rating word ${re} in the panel`, !re.test(open)));
});

suite('quarterly tab: a failed copy keeps the draft shut and says why, in the panel', async (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    const { opened } = dom();
    const els = controls(BUTTONS);
    global.window.ClipboardItem = class { constructor(items) { this.items = items; } };
    renderInto(env, () => { env.ui.state.employee = 'Jordan Reyes'; env.ui.state.showRecap = true; });

    await withNavigator({ clipboard: { write: () => Promise.reject(refusal('NotAllowedError', 'Document is not focused.')) } }, async () => {
        press(els.quarterRecapOpen);
        await settle();
    });
    const html = global.document._els.q1ReviewContent.innerHTML;

    // Ctrl+V in that draft would paste the last picture copied, which in a
    // run of recaps is the previous associate's.
    t.equal('no draft was opened', opened.length, 0);
    t.equal('and no draft was logged', env.recap.statusFor('Jordan Reyes', 2026, 3).state, 'none');
    t.check('the panel says it did not copy', /The picture did not copy, so the email has not been opened\./.test(html));
    t.check('with the browser\'s own reason', /NotAllowedError: Document is not focused\./.test(html));
    t.check('and how to copy it by hand', /Right-click the picture below, choose Copy image/.test(html));
    t.check('and a button for after that', /id="quarterRecapOpenOnly"/.test(html));

    press(els.quarterRecapOpenOnly);
    t.equal('Open email opens the draft', opened.length, 1);
    t.check('to the right person', /^mailto:jordan\.reyes%40aps\.com/.test(opened[0]));
    t.equal('and logs it', env.recap.statusFor('Jordan Reyes', 2026, 3).state, 'drafted');
    t.check('and the failure note is gone', !/id="quarterRecapFailure"/.test(global.document._els.q1ReviewContent.innerHTML));
    delete global.window.ClipboardItem;
});

suite('quarterly tab: a good copy opens the draft once, and Mark as sent comes forward', async (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, TEAM);
    const { opened } = dom();
    const els = controls(BUTTONS);
    global.window.ClipboardItem = class { constructor(items) { this.items = items; } };
    renderInto(env, () => { env.ui.state.employee = 'Jordan Reyes'; env.ui.state.showRecap = true; });

    let writes = 0;
    await withNavigator({ clipboard: { write: () => { writes += 1; return Promise.resolve(); } } }, async () => {
        press(els.quarterRecapOpen);
        // A second click while the first copy is still running.
        press(els.quarterRecapOpen);
        await settle();
    });
    t.equal('one copy', writes, 1);
    t.equal('one draft', opened.length, 1);
    const log = JSON.parse(env.browser.store[PREFIX + 'quarterRecapEmails'])['Jordan Reyes|2026|Q3'];
    t.check('logged as a draft with the hours in it', log.length === 1 && log[0].event === 'drafted' && log[0].hours === true);
    t.check('and Scott is told to paste', env.toasts.some((m) => /Picture copied\. In the email, click where it should go and press Ctrl\+V\./.test(m)));

    const html = global.document._els.q1ReviewContent.innerHTML;
    t.check('the panel says the draft is open', /Recap draft opened 10\/07, not marked sent/.test(html));
    t.check('Mark as sent is now the first button', html.indexOf('id="quarterRecapMarkSent"') > -1
        && html.indexOf('id="quarterRecapMarkSent"') < html.indexOf('id="quarterRecapOpen"'));

    press(els.quarterRecapMarkSent);
    const after = global.document._els.q1ReviewContent.innerHTML;
    t.check('marked sent', /✓ Recap sent 10\/07/.test(after));
    t.check('the next person still to do is offered', /id="quarterRecapNext" data-name="Casey New"/.test(after));
    t.check('with Undo beside it', /id="quarterRecapUndoSent"/.test(after));

    els.quarterRecapNext.dataset.name = 'Casey New';
    press(els.quarterRecapNext);
    t.equal('Next moves to them', env.ui.state.employee, 'Casey New');
    t.equal('with the recap still open', env.ui.state.showRecap, true);
    delete global.window.ClipboardItem;
});

suite('quarterly tab: the hours switch takes the line out of the email', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    const els = controls(BUTTONS);
    renderInto(env, () => { env.ui.state.employee = 'Jordan Reyes'; env.ui.state.showRecap = true; });

    press(els.quarterRecapIncludeHours, 'change', { target: { checked: false } });
    const off = global.document._els.q1ReviewContent.innerHTML;
    t.check('the line is gone from the email text', !/Reliability:/.test(off));
    t.check('the switch shows off', /id="quarterRecapIncludeHours">/.test(off));
    t.equal('and it is remembered', env.recap.statusFor('Jordan Reyes', 2026, 3).includeHours, false);

    press(els.quarterRecapIncludeHours, 'change', { target: { checked: true } });
    t.check('switched back on, it returns', /Reliability: 14\.5 hrs missed/.test(global.document._els.q1ReviewContent.innerHTML));
});

suite('quarterly tab: a refused save says to reload, and changes nothing', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, YEAR);
    const els = controls(BUTTONS);
    renderInto(env, () => { env.ui.state.employee = 'Jordan Reyes'; env.ui.state.showRecap = true; });
    env.io.refuse = true;
    press(els.quarterRecapMarkSent);
    t.check('Scott is told to reload', env.toasts.indexOf('Not saved. Reload the page, then mark it again.') > -1);
    t.check('not that storage is broken', !env.toasts.some((m) => /Storage is unavailable/.test(m)));
    t.check('and Mark as sent is still there to press', /id="quarterRecapMarkSent"/.test(global.document._els.q1ReviewContent.innerHTML));
});

suite('quarterly tab: notes for Scott stay in the panel', (t) => {
    t.pinClock('2026-10-07');
    const env = load(t, Object.assign({},
        period('quarter', '2026-01-01', '2026-03-31', [person('Jordan Reyes', { reliability: 20 })]),
        period('quarter', '2026-04-01', '2026-06-30', [person('Jordan Reyes', { reliability: 12 })]),
        period('quarter', '2026-07-01', '2026-09-30', [person('Jordan Reyes', { reliability: 8 })])));
    const html = renderInto(env, () => { env.ui.state.employee = 'Jordan Reyes'; env.ui.state.showRecap = true; });
    t.check('a before you send box', /Before you send \(only you see this\)/.test(html));
    t.check('with the check on the hours', /40 hrs is more than twice the 18 hrs allowance/.test(html));
    t.check('which is not in the email text', !/twice/.test(mailFor(env, 'Jordan Reyes').body));
});

suite('quarterly tab: the recap list keeps count for the quarter', (t) => {
    t.pinClock('2026-10-07');
    const team = Object.assign({},
        period('quarter', '2026-07-01', '2026-09-30', [
            person('Jordan Reyes', { aht: 421 }), person('Casey New', { aht: 440 }),
            person('Dana Gone', { aht: 430 }), person('Lee Leave', { aht: 430 })
        ]));
    const env = load(t, team, null, {
        modules: { associateActivity: { isInactive: (name) => name === 'Dana Gone' } }
    });
    const before = renderInto(env);

    t.check('the list is on the tab before anyone is picked', /id="quarterRecapRoster"/.test(before));
    t.check('headed for the quarter', /Q3 recap emails/.test(before));
    t.check('nobody sent yet', /0 of 3 sent/.test(before));
    t.check('one chip per associate', (before.match(/class="quarter-recap-chip"/g) || []).length === 3);
    t.check('someone away is not on the list', !/data-name="Dana Gone"/.test(before));

    env.recap.recordDrafted('Casey New', 2026, 3, {}, { now: '2026-10-07T15:00:00Z' });
    env.recap.markSent('Jordan Reyes', 2026, 3, {}, { now: '2026-10-07T16:00:00Z' });
    env.recap.markSent('Dana Gone', 2026, 3, {}, { now: '2026-10-07T16:30:00Z' });
    env.recap.markSkipped('Lee Leave', 2026, 3, { now: '2026-10-07T16:40:00Z' });
    const after = renderInto(env);
    // Lee is not being sent one, so the list counts three, not four.
    t.check('the count moves, and the one not being sent drops out of it', /2 of 3 sent/.test(after));
    t.check('an opened draft is called out', /1 opened and not marked sent/.test(after));
    t.check('and the one not being sent is named as such', /1 not sending/.test(after));
    t.check('someone away who was sent one stays on the record', /data-name="Dana Gone"/.test(after));
});

suite('quarterly tab: the picture is copied before the draft opens, at true size', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'modules/quarter-review-ui.module.js'), 'utf8');
    const start = src.indexOf("_on('quarterRecapOpen', 'click'");
    const handler = src.slice(start, src.indexOf("_on('quarterRecapOpenOnly'", start));

    t.check('the handler exists', start > -1);
    t.check('the copy is drawn at true size for Outlook', /drawRecapCard\(built\.mail\.model, \{ scale: 1 \}\)/.test(handler));
    const copyAt = handler.indexOf('copyCardImage(');
    const openAt = handler.indexOf('_openRecapDraft(');
    t.check('the copy starts first, inside the click', copyAt > -1 && openAt > copyAt);
    t.check('the draft only opens on a good copy', /if \(!result \|\| result\.state !== 'copied'\) \{[\s\S]*?return;\s*\}\s*_openRecapDraft\(/.test(handler));

    const opener = src.slice(src.indexOf('function _openMailto'), src.indexOf('function _openMailto') + 500);
    t.check('the mailto opens in place, never a new tab', !/target/.test(opener));
});

suite('quarterly tab: a name with markup cannot break the recap list', (t) => {
    t.pinClock('2026-10-07');
    const nasty = '<img src=x onerror=alert(1)>';
    const env = load(t, period('quarter', '2026-07-01', '2026-09-30', [person(nasty, { aht: 421 })]));
    const html = renderInto(env, () => { env.ui.state.employee = nasty; env.ui.state.showRecap = true; });
    t.check('the tag is escaped, not rendered', !html.includes('<img src=x'));
    t.check('and the escaped form is what appears', html.includes('&lt;img'));
});
