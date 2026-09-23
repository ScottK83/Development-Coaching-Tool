'use strict';

/**
 * The Quarterly tab renders, and renders the right year.
 *
 * The view this replaced was wrong in the one way a screenshot cannot show.
 * It was written during Q1, when the year to date and Q1 covered the same
 * dates, so it read the newest year-to-date upload and printed it in a column
 * headed "Q1 Avg". That was true in March and has been false in every month
 * since, silently, on the tab a supervisor uses to write into someone's
 * record.
 *
 * So the load-bearing assertion here is the negative one: a year-to-date file
 * sitting in the store alongside the quarters must not reach the table.
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

function load(t, store, ytd) {
    const browser = t.installFakeBrowser();
    const ytdStore = ytd || {};
    global.window.weeklyData = store;
    global.weeklyData = store;
    global.window.ytdData = ytdStore;
    global.ytdData = ytdStore;
    browser.store[PREFIX + 'weeklyData'] = JSON.stringify(store);

    global.window.DevCoachModules.storage = {
        readStore(key) {
            const raw = browser.store[PREFIX + key];
            return raw === undefined ? undefined : JSON.parse(raw);
        },
        saveWithSizeCheck(key, data) { browser.store[PREFIX + key] = JSON.stringify(data); },
        loadWeeklyData() { return store; },
        loadYtdData() { return ytdStore; },
        loadDailyData() { return {}; }
    };

    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.SURVEY_WEIGHT_FIELD = global.window.SURVEY_WEIGHT_FIELD;
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/period-compare.module.js');
    t.loadModule('modules/quarter-trend.module.js');
    t.loadModule('modules/quarter-review.module.js');
    const ui = t.loadModule('modules/quarter-review-ui.module.js').quarterReviewUi;

    global.window.formatMetricDisplay = (key, value) => {
        const def = global.METRICS_REGISTRY[key] || {};
        const n = Math.round(value * 10) / 10;
        if (def.unit === 'sec') return `${Math.round(value)}s`;
        if (def.unit === '%') return `${n}%`;
        if (def.unit === 'hrs') return `${n} hrs`;
        return String(n);
    };
    return ui;
}

function renderInto(ui, setup) {
    global.document._els.q1ReviewContent = { innerHTML: '' };
    if (setup) setup();
    ui.render();
    return global.document._els.q1ReviewContent.innerHTML;
}

const YEAR = Object.assign({},
    period('quarter', '2026-01-01', '2026-03-31', [person('Jordan Reyes', { aht: 451, reliability: 6 })]),
    period('quarter', '2026-04-01', '2026-06-30', [person('Jordan Reyes', { aht: 438, reliability: 5 })]),
    period('quarter', '2026-07-01', '2026-09-30', [person('Jordan Reyes', { aht: 421, reliability: 3.5 })])
);

suite('quarterly tab: the coverage panel says what each quarter rests on', (t) => {
    t.pinClock('2026-09-22');
    const ui = load(t, YEAR);
    const html = renderInto(ui);

    t.check('all three quarters are shown', /Q1 2026/.test(html) && /Q2 2026/.test(html) && /Q3 2026/.test(html));
    t.check('each one names what built it', /quarter upload/.test(html));
    t.check('and the quarter still running says so', /still running/.test(html));
    t.check('the associate can be picked', /quarterReviewEmployee/.test(html));
    t.check('and nothing is generated before one is', /Pick an associate to build/.test(html));
});

suite('quarterly tab: picking an associate builds the progression table', (t) => {
    t.pinClock('2026-09-22');
    const ui = load(t, YEAR);
    const html = renderInto(ui, () => { ui.state.employee = 'Jordan Reyes'; });

    t.check('the table is headed with the associate', /Jordan Reyes across 2026/.test(html));
    t.check('every quarter reading is in it',
        html.includes('451s') && html.includes('438s') && html.includes('421s'));
    t.check('the goal column is there', html.includes('426s'));
    t.check('and the direction across the year', /better|worse/.test(html));

    t.check('the two boxes are rendered',
        /Progress &amp; Strengths/.test(html) && /Areas of Focus/.test(html));
    t.check('with a copy button for both', /quarterReviewCopyAll/.test(html));
    t.check('and a Copilot handoff', /quarterReviewCopilot/.test(html));
    t.check('and somewhere to type context', /quarterReviewNotes/.test(html));
});

suite('quarterly tab: a year-to-date file never reaches the quarter columns', (t) => {
    t.pinClock('2026-09-22');
    // The exact shape that broke the old view: a year-to-date upload whose
    // numbers differ from every quarter. If it leaks, 999 shows up in a
    // quarter column under a Q heading.
    const ui = load(t, YEAR, Object.assign({},
        period('ytd', '2026-01-01', '2026-09-19', [person('Jordan Reyes', { aht: 999, reliability: 99 })])
    ));
    const html = renderInto(ui, () => { ui.state.employee = 'Jordan Reyes'; });

    t.check('the year-to-date handle time is nowhere in the table', !html.includes('999s'));
    t.check('the real quarters are', html.includes('451s') && html.includes('421s'));

    // Missed hours are the exception, and deliberately so: the year-to-date
    // upload IS the running year total, and it outranks a sum of whichever
    // quarters happen to be loaded. The row says where the figure came from,
    // and the quarter columns go blank rather than showing a running total
    // that climbs to a different number.
    t.check('the year-to-date hours are used for the year', /99 hrs from the year-to-date upload/.test(html));
    t.check('and the quarter columns do not contradict it', !/>14\.5 hrs</.test(html));
    t.check('and the table says where the numbers came from',
        /never from a year-to-date file/.test(html));
});

suite('quarterly tab: missed hours show as the year running total', (t) => {
    t.pinClock('2026-09-22');
    const ui = load(t, YEAR);
    const html = renderInto(ui, () => { ui.state.employee = 'Jordan Reyes'; });

    t.check('the row is labelled as a running total', /year running total/.test(html));
    // 6, then 6+5, then 6+5+3.5. The quarter's own 3.5 is never a column.
    t.check('Q1 shows six hours', html.includes('6 hrs'));
    t.check('Q2 shows eleven', html.includes('11 hrs'));
    t.check('Q3 shows fourteen and a half', html.includes('14.5 hrs'));
    t.check('and the quarter share alone is not a column', !/>3\.5 hrs</.test(html));
});

suite('quarterly tab: the quarter being prepared can be changed', (t) => {
    t.pinClock('2026-09-22');
    const ui = load(t, YEAR);

    // Defaults to the newest started quarter, which is the one a supervisor
    // opening the tab in September is preparing for.
    renderInto(ui, () => { ui.state.employee = 'Jordan Reyes'; });
    t.equal('it opens on the current quarter', ui.state.quarter, 3);

    const q2 = renderInto(ui, () => { ui.state.quarter = 2; });
    t.check('asked for Q2, the document is headed Q2', /Q2 2026 Check In/.test(q2));
    t.check('and Q3 is not in the document', !/Q3 2026 Check In/.test(q2));
    // The Q3 column is dropped from the table too: a Q2 check-in should not
    // show a quarter that had not happened when the conversation was held.
    t.check('nor is the Q3 reading in the table', !q2.includes('421s'));
    t.check('but Q1 and Q2 are', q2.includes('451s') && q2.includes('438s'));
});

suite('quarterly tab: an associate with no data is said so plainly', (t) => {
    t.pinClock('2026-09-22');
    const ui = load(t, YEAR);
    const html = renderInto(ui, () => { ui.state.employee = 'Nobody Here'; });
    // Not in the roster for any quarter, so the picker drops the selection and
    // the tab returns to asking for one rather than rendering an empty table.
    t.check('no table is drawn for them', !/across 2026/.test(html));
    t.check('and the tab asks for an associate again', /Pick an associate to build/.test(html));
});

suite('quarterly tab: a year with nothing in it does not render a table', (t) => {
    t.pinClock('2026-09-22');
    const ui = load(t, {});
    const html = renderInto(ui);
    t.check('the quarters are still listed', /Q1 2026/.test(html));
    t.check('each reporting nothing', /nothing uploaded/.test(html));
    t.check('and no document is offered', !/Check-in document/.test(html));
});

suite('quarterly tab: the rendered copy holds the house rules', (t) => {
    t.pinClock('2026-09-22');
    const ui = load(t, YEAR);
    const html = renderInto(ui, () => { ui.state.employee = 'Jordan Reyes'; });

    ['—', '–', '―', '&mdash;', '&ndash;', '&#8212;', '&#8213;'].forEach((d) => {
        t.check(`no ${JSON.stringify(d)} in the rendered tab`, !html.includes(d));
    });
    [/off[- ]track/i, /on[- ]track/i, /\bexceptional\b/i, /\btier\b/i].forEach((re) => {
        t.check(`no rating vocabulary matching ${re}`, !re.test(html));
    });
});

suite('quarterly tab: typing a note does not destroy the button you click next', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'modules/quarter-review-ui.module.js'), 'utf8');

    // A full render on blur replaced the panel between mousedown and mouseup,
    // so typing a note and then clicking Copy did nothing at all. The two
    // boxes are rewritten in place instead.
    const blur = src.slice(src.indexOf("'quarterReviewNotes', 'blur'"));
    const handler = blur.slice(0, blur.indexOf('});'));
    t.check('the blur handler does not re-render', !/\brender\(\)/.test(handler));
    t.check('it refreshes the boxes in place', /_refreshBoxes\(\)/.test(handler));
    t.check('and still saves the note', /_saveNotes\(\)/.test(handler));
    t.check('_refreshBoxes writes text, not markup',
        /one\.textContent = built\.notes\.box1/.test(src));
});

suite('quarterly tab: the Copilot button copies once', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'modules/quarter-review-ui.module.js'), 'utf8');
    const exec = fs.readFileSync(path.join(ROOT, 'modules/executive-summary.module.js'), 'utf8');

    // openCopilotWithPrompt copies the prompt and raises its own toast, so
    // copying here too put the same text on the clipboard twice and stacked
    // two notifications saying different things.
    t.check('the shared opener copies for itself',
        /function openCopilotWithPrompt[\s\S]{0,700}copyToClipboard\(prompt/.test(exec));

    const btn = src.slice(src.indexOf("'quarterReviewCopilot', 'click'"));
    const handler = btn.slice(0, btn.indexOf('\n        });'));
    const copiesItself = (handler.match(/_copy\(/g) || []).length;
    t.equal('this handler copies only on the fallback path', copiesItself, 1);
    t.check('and that path is the one where the opener is missing',
        /if \(typeof window\.openCopilotWithPrompt === 'function'\)[\s\S]*\} else \{[\s\S]*_copy\(/.test(handler));
});

suite('quarterly tab: the tab never falls back to the view it replaced', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const handler = script.slice(script.indexOf("subNavRpQuarterly')?.addEventListener"));
    const body = handler.slice(0, handler.indexOf('});'));

    // Quietly reverting to the old view would put year-to-date numbers under a
    // quarter heading again, and the supervisor reading it could not tell.
    t.check('the quarter review is called', /renderQuarterReview\(\)/.test(body));
    t.check('and nothing calls the old one', !/renderQ1Review\(\)/.test(body));
});

suite('quarterly tab: a name with markup in it cannot break the page', (t) => {
    t.pinClock('2026-09-22');
    const nasty = '<img src=x onerror=alert(1)>';
    const ui = load(t, period('quarter', '2026-07-01', '2026-09-30',
        [person(nasty, { aht: 421 })]));
    const html = renderInto(ui, () => { ui.state.employee = nasty; });

    t.check('the tag is escaped, not rendered', !html.includes('<img src=x'));
    t.check('and the escaped form is what appears', html.includes('&lt;img'));
});
