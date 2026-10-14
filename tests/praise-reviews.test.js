'use strict';

/**
 * EVERY REVIEW, PROMPT AND TALKING-POINT SHEET HAS PRAISE IN IT
 *
 * Scott, 2026-10-14: "Make sure to, in every piece of feedback. From the
 * calls, to the metrics ... Make sure to provide positive feedback."
 *
 * What was wrong for someone missing every goal:
 *   - Mid-Year left out "Strengths and progress to recognize" and still
 *     asked Copilot for "genuine strengths and forward momentum".
 *   - The goal-pace Teams check-in asked for "genuine, specific praise" and
 *     listed nothing to praise.
 *   - Year-End filled the positives box with "Consistent effort and
 *     willingness to grow throughout the year.", a line about anybody.
 *   - The quarterly talking points opened straight on what to fix, with no
 *     "what has been working" question.
 *   - The 1:1 sheet opened on the year's misses and "Slipped".
 *
 * Each case is someone with nothing at goal. The praise has to be there, be
 * true, keep the urgent tone serious, and never bring hours into focus.
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

// Nothing at goal, nothing rising, nothing logged. Hours over the allowance.
const PAT = year('Pat Flat',
    { aht: 470, scheduleAdherence: 90, overallSentiment: 84, cxRepOverall: 74, fcr: 66, overallExperience: 66, transfers: 9, transfersCount: 45, reliability: 9 },
    { aht: 480, scheduleAdherence: 89.5, overallSentiment: 84.2, cxRepOverall: 73, fcr: 65, overallExperience: 65, transfers: 9.2, transfersCount: 46, reliability: 9 },
    { aht: 490, scheduleAdherence: 89, overallSentiment: 84.1, cxRepOverall: 72, fcr: 64, overallExperience: 64, transfers: 9.4, transfersCount: 47, reliability: 9 });
const PAT_YTD = person('Pat Flat', { aht: 480, scheduleAdherence: 89.5, overallSentiment: 84.1, cxRepOverall: 73, repSurveyTotal: 120, surveyTotal: 120, reliability: 27 });

// Nothing at goal, but rep satisfaction rose to its best quarter, and the
// work is logged.
const CARLOS = year('Carlos Diaz',
    { aht: 440, scheduleAdherence: 91.5, overallSentiment: 85, cxRepOverall: 74.2, fcr: 70, overallExperience: 70, transfers: 8, transfersCount: 40, reliability: 8 },
    { aht: 452, scheduleAdherence: 91.0, overallSentiment: 85.4, cxRepOverall: 71.9, fcr: 69, overallExperience: 71, transfers: 8.3, transfersCount: 41.5, reliability: 8 },
    { aht: 465, scheduleAdherence: 91.2, overallSentiment: 85.2, cxRepOverall: 76.5, fcr: 70.5, overallExperience: 70, transfers: 8.1, transfersCount: 40.5, reliability: 7 });
const CARLOS_YTD = person('Carlos Diaz', { aht: 452, scheduleAdherence: 91.2, overallSentiment: 85.2, cxRepOverall: 74.2, repSurveyTotal: 120, surveyTotal: 120, reliability: 23 });
const CARLOS_HISTORY = {
    coaching: { 'Carlos Diaz': [
        { generatedAt: '2026-05-01T10:00:00Z', metricsCoached: ['aht'] },
        { generatedAt: '2026-07-01T10:00:00Z', metricsCoached: ['cxRepOverall'] },
        { generatedAt: '2026-08-01T10:00:00Z', metricsCoached: [] }
    ] },
    calls: { 'Carlos Diaz': [{ listenedOn: '2026-07-10' }, { listenedOn: '2026-08-10' }] }
};

// Hours as a measure. "Work on meeting your scheduled hours" in an adherence
// tip is about the schedule, not missed time, so the word alone is not it.
const HOURS = /\bhrs?\b|hours missed|missed hours|allowance|reliab|attendance/i;
const TIER_WORDS = [/off[- ]track/i, /on[- ]track/i, /\bexceptional\b/i, /\bsuccessful\b/i, /\btier\b/i];

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
    const h = opts.history || {};
    global.coachingHistory = h.coaching || {};
    global.window.coachingHistory = global.coachingHistory;
    global.callListeningLogs = h.calls || {};
    global.window.callListeningLogs = global.callListeningLogs;

    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.SURVEY_WEIGHT_FIELD = global.window.SURVEY_WEIGHT_FIELD;
    t.loadModule('modules/metric-trends.module.js');
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/message-voice.module.js');
    t.loadModule('modules/period-compare.module.js');
    t.loadModule('modules/quarter-trend.module.js');
    t.loadModule('modules/quarter-review.module.js');
    return global.window.DevCoachModules;
}

/* ── Mid-Year and the goal-pace check-in ── */

function loadTracker(t, store, ytdRow, options) {
    const M = load(t, store, options);
    const profiles = M.metricProfiles;
    global.getMetricRatingScore = (key, value, yr) => profiles.getRatingScore(key, value, yr);
    global.window.getMetricRatingScore = global.getMetricRatingScore;
    global.window.getLatestYearPeriodForEmployee = () => ({ employeeRecord: ytdRow, label: 'YTD', sourceName: 'ytdData' });
    global.window.getEmployeeNickname = () => '';
    global.window.getRandomTipsForMetric = () => [];
    global.copyToClipboard = () => {};
    global.alert = () => {};
    t.loadModule('modules/on-off-tracker.module.js');

    const els = global.document._els;
    const field = (value) => ({ value, dataset: {}, style: {}, textContent: '' });
    Object.assign(els, {
        midYearEmployeeSelect: field(ytdRow.name),
        midYearReviewYear: field('2026'),
        midYearNotes: field(''),
        midYearStatusOverride: field((options && options.override) || 'auto'),
        midYearOutput: field(''),
        midYearText: field(''),
        onOffTrackerEmployeeSelect: field(ytdRow.name),
        onOffTrackerReviewYear: field('2026'),
        onOffCheckinOutput: field(''),
        onOffCheckinText: field('')
    });
    return {
        tracker: global.window.DevCoachModules.onOffTracker,
        midYear() { global.window.DevCoachModules.onOffTracker.generateMidYearReviewTab(); return els.midYearText.textContent; },
        checkin() { global.window.DevCoachModules.onOffTracker.generateQuickCheckinPrompt(); return els.onOffCheckinText.textContent; }
    };
}

function block(prompt, heading) {
    const at = prompt.indexOf(heading);
    if (at < 0) return '';
    const rest = prompt.slice(at + heading.length);
    const end = rest.search(/\n\n|\n[A-Z][^\n]*:\n/);
    return end < 0 ? rest : rest.slice(0, end);
}

suite('praise in reviews: Mid-Year with nothing at goal still has strengths to recognize', (t) => {
    t.pinClock('2026-10-14');
    const pat = loadTracker(t, PAT, PAT_YTD);
    const prompt = pat.midYear();

    t.check('the prompt was built', /mid-year review comments for Pat/.test(prompt));
    t.check('no goal is met', /Pat is not yet meeting any of the 4 core goals/.test(prompt));
    const strengths = block(prompt, 'Strengths and progress to recognize:\n');
    t.check('the strengths block is there', strengths.length > 0);
    t.check('it names the measure nearest its goal, with the real numbers',
        /- Schedule Adherence: 89\.5% against the 93% goal, the closest of the core measures to goal, and a good place to build from/.test(strengths));
    t.check('and asks Copilot not to call a missed goal met',
        /No core goal is being met yet, so the Progress and Strengths section must not call any goal met/.test(prompt));

    // The urgent tier stays urgent, and still names a strength.
    t.check('the tone is still the urgent one', /carry real urgency/.test(prompt));
    t.check('the formal performance management line is still there', /formal performance management up to and including disciplinary action/.test(prompt));
    t.check('and a genuine strength is required anyway',
        /Still name at least one genuine strength or real piece of progress from my notes, with its numbers\. Being fair about what is working does not soften the urgency\./.test(prompt));

    const focus = block(prompt, 'Areas of opportunity that need focused improvement:\n');
    t.check('27 hours is not an area of focus', focus.length > 0 && !HOURS.test(focus));
    t.check('nor praised', !HOURS.test(strengths));
    t.check('no tier vocabulary', !TIER_WORDS.some((re) => re.test(prompt)));
    t.check('no em or en dashes', !/[—–]/.test(prompt));
});

suite('praise in reviews: Mid-Year credits progress across the quarters and the work put in', (t) => {
    t.pinClock('2026-10-14');
    const carlos = loadTracker(t, CARLOS, CARLOS_YTD, { history: CARLOS_HISTORY });
    const strengths = block(carlos.midYear(), 'Strengths and progress to recognize:\n');

    t.check('rep satisfaction rising to its best quarter is named',
        /- Rep Satisfaction, moving the right way: 71\.9% in Q2 to 76\.5% in Q3, the best quarter of the year/.test(strengths));
    t.check('the coaching and calls are named as the work put in',
        /- The work Carlos has put in with me this year: 3 coaching sessions and 2 calls reviewed/.test(strengths));
    t.check('a rise is praised instead of the closest measure', !/closest/.test(strengths));
    t.check('no hours', !HOURS.test(strengths));
});

suite('praise in reviews: Mid-Year with the Off Track override still names a strength', (t) => {
    t.pinClock('2026-10-14');
    const pat = loadTracker(t, PAT, PAT_YTD, { override: 'off' });
    const prompt = pat.midYear();
    t.check('it reads as a real improvement push', /needs a real improvement push/.test(prompt));
    t.check('and still requires a genuine strength', /Still name at least one genuine strength/.test(prompt));
    t.check('with one to name', /Schedule Adherence: 89\.5% against the 93% goal/.test(block(prompt, 'Strengths and progress to recognize:\n')));
});

suite('praise in reviews: the goal-pace check-in has praise to start on', (t) => {
    t.pinClock('2026-10-14');
    const pat = loadTracker(t, PAT, PAT_YTD);
    const prompt = pat.checkin();

    const going = block(prompt, 'What is going well that I want to acknowledge:\n');
    t.check('there is something going well listed', going.length > 0);
    t.check('it is the measure nearest its goal', /Schedule Adherence: 89\.5% against the 93% goal/.test(going));
    t.check('the message opens on it, without claiming a goal is met',
        /1\. Starts with genuine, specific praise for what is going well in my notes, by name\. No goal is met yet, so it does not say one is/.test(prompt));
    t.check('no hours in the areas to build on', !HOURS.test(block(prompt, 'Areas I want to gently encourage them to build on:\n')));
    t.check('no em or en dashes', !/[—–]/.test(prompt));

    const carlos = loadTracker(t, CARLOS, CARLOS_YTD, { history: CARLOS_HISTORY });
    const carlosGoing = block(carlos.checkin(), 'What is going well that I want to acknowledge:\n');
    t.check('a rise is listed for the associate who has one', /Rep Satisfaction, moving the right way/.test(carlosGoing));
});

/* ── Year-End ── */

function loadYearEnd(t, store, options) {
    load(t, store, options);
    t.loadModule('modules/year-end.module.js');
    t.loadModule('modules/year-end-comments.module.js');
    return global.window.DevCoachModules;
}

const PAT_OPPORTUNITIES = [
    { key: 'aht', label: 'Average Handle Time', value: '480s', target: '426s', targetType: 'max', meetsTarget: false },
    { key: 'scheduleAdherence', label: 'Schedule Adherence', value: '89.5%', target: '93%', targetType: 'min', meetsTarget: false },
    { key: 'overallSentiment', label: 'Overall Sentiment', value: '84.1%', target: '88%', targetType: 'min', meetsTarget: false }
];

suite('praise in reviews: Year-End positives name something true, not a line about anyone', (t) => {
    t.pinClock('2026-10-14');
    const M = loadYearEnd(t, PAT);
    const yec = M.yearEndComments;

    const pat = yec.buildYearEndPraiseLines('Pat Flat', '2026', PAT_OPPORTUNITIES);
    t.equal('with nothing rising, the measure nearest its goal', pat.join(' | '),
        'Closest to goal: Schedule Adherence: 89.5% (goal 93% or better)');

    const input = { value: '' };
    const improvements = { value: '' };
    yec.autoPopulateYearEndNarrativeInputs(input, improvements, [], PAT_OPPORTUNITIES, { metGoals: [], notMetGoals: [] }, pat);
    t.check('the positives box is filled with it', /Closest to goal: Schedule Adherence: 89\.5%/.test(input.value));
    t.check('not with the old generic line', !/Consistent effort and willingness to grow/.test(input.value));

    const last = { value: '' };
    yec.autoPopulateYearEndNarrativeInputs(last, { value: '' }, [], [], { metGoals: [], notMetGoals: [] }, []);
    t.check('the generic line is the last resort only', /Consistent effort/.test(last.value));

    const typed = { value: 'My own words.' };
    yec.autoPopulateYearEndNarrativeInputs(typed, { value: '' }, [], PAT_OPPORTUNITIES, { metGoals: [], notMetGoals: [] }, pat);
    t.equal('a supervisor\'s own words are never replaced', typed.value, 'My own words.');

    const C = loadYearEnd(t, CARLOS, { history: CARLOS_HISTORY });
    const carlos = C.yearEndComments.buildYearEndPraiseLines('Carlos Diaz', '2026', PAT_OPPORTUNITIES);
    t.check('a rise is said in the past tense for a finished year',
        carlos[0] === 'Rep Satisfaction, moved the right way: 71.9% in Q2 to 76.5% in Q3, the best quarter of the year');
    t.check('the work put in is there too', carlos.some((l) => /^The work Carlos put in with me this year: 3 coaching sessions and 2 calls reviewed/.test(l)));
    t.check('no hours in any of it', !carlos.concat(pat).some((l) => HOURS.test(l)));
});

suite('praise in reviews: the Year-End screen hands the praise to the prompt', (t) => {
    t.pinClock('2026-10-14');
    const M = loadYearEnd(t, PAT);
    const els = global.document._els;
    const field = (value) => ({ value, dataset: {}, style: {}, textContent: '', innerHTML: '' });
    Object.assign(els, {
        yearEndEmployeeSelect: field('Pat Flat'),
        yearEndReviewYear: field('2026'),
        yearEndStatus: field(''), yearEndSnapshotPanel: field(''), yearEndFactsSummary: field(''),
        yearEndWinsList: field(''), yearEndImprovementList: field(''), yearEndTrackSelect: field(''),
        yearEndPositivesInput: field(''), yearEndImprovementsInput: field(''), yearEndManagerContext: field(''),
        yearEndCopilotResponse: field(''), yearEndPromptArea: field('')
    });
    Object.assign(global.window, {
        getLatestYearPeriodForEmployee: () => ({ employeeRecord: PAT_YTD, label: '2026 YTD', sourceName: 'ytdData', periodKey: '2026-01-01|2026-09-30', period: { metadata: { endDate: '2026-09-30' } } }),
        getYearEndDraftState: () => ({ trackStatus: '', positivesText: '', improvementsText: '', managerContext: '', copilotResponse: '', performanceRating: '', meritDetails: '', bonusAmount: '', verbalSummary: '' }),
        collectYearEndAnnualGoals: () => ({ metGoals: [], notMetGoals: [] }),
        buildYearEndMetricSnapshot: () => ({ wins: [], opportunities: PAT_OPPORTUNITIES, targetProfileYear: 2026 }),
        renderYearEndOnOffMirror: () => ({ trackStatusValue: 'off-track' }),
        renderYearEndAnnualGoalsInputs: () => {},
        appendMissingYearEndImprovementFollowUps: () => {},
        persistYearEndDraftState: () => {},
        formatDateMMDDYYYY: (d) => d,
        getEmployeeNickname: () => 'Pat'
    });
    const yec = M.yearEndComments;
    yec.updateYearEndSnapshotDisplay();
    t.check('the positives box opens on the true positive', /^Closest to goal: Schedule Adherence/.test(els.yearEndPositivesInput.value));

    const support = yec.buildYearEndPromptSupportData('Pat Flat', '2026');
    t.check('the prompt fallback carries it too', /Closest to goal: Schedule Adherence: 89\.5%/.test(support.fallbackPositives));

    const prompt = M.yearEnd.buildCopilotPrompt(
        { employeeName: 'Pat Flat', reviewYear: '2026', positivesText: '', improvementsText: '', managerContext: '' },
        support,
        { preferredName: 'Pat', trackLabel: 'Off Track', periodLabel: '2026 YTD', sourceLabel: 'YTD upload', targetProfileLabel: '2026 year-end goals' });
    t.check('the Off Track prompt carries the true positive', /Positives to highlight:\nClosest to goal: Schedule Adherence: 89\.5% \(goal 93% or better\)/.test(prompt));
    t.check('not the old generic one', !/Positive impact and steady contribution/.test(prompt));
    t.check('it is still serious', /fell short/.test(prompt) && /Do not soften it into a positive review/.test(prompt));
    t.check('and still asks for a genuine strength by name',
        /do name at least one genuine strength or real piece of progress from the positives below, with its number/.test(prompt));
    t.check('box 1 must carry one whatever the year', /Box 1 must name at least one specific, genuine strength or piece of progress/.test(prompt));
    t.check('no tier vocabulary', !TIER_WORDS.some((re) => re.test(prompt)));
    t.check('hours stay out of the review', /Keep reliability, attendance and hours missed out of the review/.test(prompt)
        && !/Reliability:/.test(prompt));
    t.check('no em or en dashes', !/[—–]/.test(prompt));
});

/* ── Quarterly talking points ── */

suite('praise in reviews: the quarterly sheet starts on what is working, even all red', (t) => {
    t.pinClock('2026-10-14');
    const M = load(t, PAT);
    const qr = M.quarterReview;
    const ctx = qr.buildContext('Pat Flat', 2026, { throughQuarter: 3, preparedOn: '2026-10-14' });
    t.equal('nothing is at goal', qr.splitForBoxes(ctx).strengths.length, 0);

    const tp = qr.buildTalkingPoints(ctx);
    t.equal('it opens on what is working', tp.sections[0].id, 'wins');
    t.equal('headed the usual way', tp.sections[0].heading, 'Start with what is working');
    t.check('with the measure nearest its goal, numbers and all',
        tp.sections[0].lines[0] === 'Pat is closest to goal on adherence, at 89% in Q3 against the 93% goal, and that is a good place to build from.');
    t.check('and in the copied text, ahead of what to work on',
        tp.text.indexOf('START WITH WHAT IS WORKING') > -1
        && tp.text.indexOf('START WITH WHAT IS WORKING') < tp.text.indexOf('WHAT TO WORK ON'));
    const asks = tp.sections.find((s) => s.id === 'ask').lines;
    t.equal('the first question is about what is working',
        asks[0], 'What has been working for you on schedule adherence, where you are closest to goal?');

    const focus = tp.sections.find((s) => s.id === 'focus');
    t.check('the focus is still two rates', focus.items.length === 2);
    t.check('and never hours', !focus.items.some((i) => i.metricKey === 'reliability') && !/hrs|allowance/.test(tp.text));
    t.check('no em or en dashes', !/[—–]/.test(tp.text));

    // Copilot is handed a named measure, not "the measure closest to goal".
    const prompt = qr.buildPrompt(ctx);
    t.check('the quarterly prompt names it', /- The effort Pat brings, and schedule adherence, the closest to goal at 89% in Q3/.test(prompt));
});

suite('praise in reviews: a quarterly sheet with a win is unchanged', (t) => {
    t.pinClock('2026-10-14');
    const M = load(t, CARLOS, { history: CARLOS_HISTORY });
    const qr = M.quarterReview;
    const ctx = qr.buildContext('Carlos Diaz', 2026, { throughQuarter: 3, preparedOn: '2026-10-14' });
    const tp = qr.buildTalkingPoints(ctx);
    t.equal('a rise still opens the sheet', tp.sections[0].id, 'rising');
    t.check('with no second opener on top of it', !tp.sections.some((s) => s.id === 'wins'));
});

/* ── The 1:1 sheet ── */

suite('praise in reviews: the 1:1 sheet always opens on something working', (t) => {
    const M = load(t, {});
    const ooo = t.loadModule('modules/one-on-one.module.js').oneOnOne;
    const year = [
        { key: 'aht', label: 'Average Handle Time', value: 480, target: 426 },
        { key: 'scheduleAdherence', label: 'Schedule Adherence', value: 91, target: 93 },
        { key: 'reliability', label: 'Reliability', value: 11, target: 18 }
    ];
    const slipped = [{ key: 'aht', label: 'Average Handle Time', before: 460, after: 480, gain: -20 }];

    const red = ooo.buildTalkingPoints({ employeeName: 'Pat Flat', date: '2026-10-14', yearToDate: year,
        sinceLast: { date: '2026-09-15', improved: [], slipped } });
    t.check('it opens on what is working, before the year so far',
        red.indexOf('START WITH WHAT IS WORKING') > -1 && red.indexOf('START WITH WHAT IS WORKING') < red.indexOf('THE YEAR SO FAR'));
    t.check('with the measure nearest its goal',
        /• Closest to goal: Schedule Adherence: 91% against a 93% goal, a good place to build from/.test(red));
    t.check('11 hours inside the allowance is not the praise', !/START WITH WHAT IS WORKING\n[^\n]*Reliability/.test(red));

    const better = ooo.buildTalkingPoints({ employeeName: 'Pat Flat', date: '2026-10-14', yearToDate: year,
        sinceLast: { date: '2026-09-15', improved: [], slipped },
        lastMonth: { improved: [{ key: 'scheduleAdherence', label: 'Schedule Adherence', before: 89, after: 91, gain: 2 }], slipped: [] } });
    t.check('a real move the right way comes ahead of the closest',
        /START WITH WHAT IS WORKING\n  • Better last month: Schedule Adherence: 89% → 91%/.test(better));

    const atGoal = ooo.buildTalkingPoints({ employeeName: 'Pat Flat', date: '2026-10-14',
        yearToDate: [{ key: 'scheduleAdherence', label: 'Schedule Adherence', value: 92.96, target: 93 }].concat(year.slice(0, 1)) });
    t.check('a goal held is the opener, judged as printed',
        /START WITH WHAT IS WORKING\n  • At goal: Schedule Adherence: 93% against a 93% goal/.test(atGoal));

    const held = ooo.buildTalkingPoints({ employeeName: 'Pat Flat', date: '2026-10-14',
        sinceLast: { date: '2026-09-15', improved: [], slipped: [], steady: [{ key: 'scheduleAdherence', label: 'Schedule Adherence', before: 91, after: 91, gain: 0 }] } });
    t.check('with no year figures, what held since the last meeting', /• Held steady since we last met: Schedule Adherence/.test(held));

    const noCalls = ooo.openingLines({ yearToDate: [{ key: 'aht', label: 'Average Handle Time', value: 0, target: 426 }] });
    t.equal('a 0s handle time is never praised as at goal', noCalls.join(' | '), '');

    const empty = ooo.buildTalkingPoints({ employeeName: 'James Garcia', date: '2026-08-15', yearToDate: [] });
    t.check('an empty sheet does not praise numbers it does not have', empty.indexOf('START WITH WHAT IS WORKING') === -1);
    t.check('no em or en dashes', ![red, better, atGoal, held].some((s) => /[—–]/.test(s)));
    t.check('M loaded', !!M);
});
