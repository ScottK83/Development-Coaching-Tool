'use strict';

const { suite } = require('./harness');

/**
 * EVERY PIECE OF FEEDBACK HAS PRAISE IN IT: THE RANKINGS EMAILS AND VERINT
 *
 * Scott, 2026-10-14: "Make sure to, in every piece of feedback. From the
 * calls, to the metrics ... Make sure to provide positive feedback."
 *
 * Three emails go to one associate from the Rankings trajectory view, and
 * someone missing every goal got none: the year to date email closed on
 * "Plenty of year left to move these", the month over month email on "A
 * harder month", and the one-month email said "That is 0 of N goals met"
 * under a "Not there yet." on every line. Each now opens on the best true
 * thing: moved the right way, better than the center, closest to goal, and
 * only then the effort.
 *
 * The Verint coaching note read celebrate / needsCoaching off the coaching
 * log, which recordCoachingEvent never saves, so every note said
 * "acknowledged their efforts to improve" and named nothing. It reads the
 * period the session was about now.
 */

/* ── Loading ── */

// The real formatter's rules: seconds as "500s", one decimal dropped when
// it is ".0", hours as "hrs".
function formatter(key, value) {
    const metric = global.window.METRICS_REGISTRY[key];
    if (!metric) return String(value);
    const fixed = metric.unit === 'sec' ? String(Math.round(value)) : Number(value).toFixed(1).replace(/\.0$/, '');
    if (metric.unit === 'sec') return fixed + 's';
    if (metric.unit === '%') return fixed + '%';
    if (metric.unit === 'hrs') return fixed + ' hrs';
    return fixed;
}

function loadRankings(t, weekly, ytd) {
    t.installFakeBrowser();
    global.document.documentElement = { getAttribute: () => null };
    global.CSS = { escape: (s) => String(s) };
    global.weeklyData = weekly || {};
    global.ytdData = ytd || {};
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/message-voice.module.js');
    t.loadModule('modules/on-off-tracker.module.js');
    t.loadModule('modules/center-ranking.module.js');
    t.loadModule('modules/period-compare.module.js');
    const M = global.window.DevCoachModules;
    global.window.getMetricRatingScore = M.metricProfiles.getRatingScore;
    global.window.formatMetricDisplay = formatter;
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.window.getTeamMembersForWeek = () => [];
    global.window.getLatestWeeklyKey = () => null;
    M.centerRanking.resetPeriodSelection();
    return M.centerRanking;
}

/* ── Fixtures ──
   Forty people spread across the scores, so the center floor is cleared and
   the center averages are real, and one more, Zed Red, set per suite. */
function emp(name, over) {
    return Object.assign({
        name, totalCalls: 100, surveyTotal: 10, repSurveyTotal: 10, reliability: 0,
        scheduleAdherence: 95, cxRepOverall: 90, overallSentiment: 92, aht: 500
    }, over || {});
}
function roster(shift, zed) {
    const people = Array.from({ length: 40 }, (_, i) => emp('P' + i, {
        scheduleAdherence: 78 + ((i + shift) % 22),
        cxRepOverall: 70 + ((i * 3 + shift) % 30),
        aht: 400 + ((i * 7 + shift) % 200)
    }));
    if (zed) people.push(emp('Zed Red', zed));
    return people;
}
function period(start, end, type, employees, label) {
    return { [`${start}|${end}`]: { employees, metadata: { startDate: start, endDate: end, periodType: type, label: label || end } } };
}
// June and July as monthly uploads, so a survey count is the month's own.
function months(june, july) {
    return Object.assign({},
        period('2026-06-01', '2026-06-30', 'month', roster(0, june), 'June 2026'),
        period('2026-07-01', '2026-07-31', 'month', roster(3, july), 'July 2026'));
}
const MONTH = { scope: 'month', anchor: null };

// What every one of these must hold to, whatever it says.
function voiceRules(t, label, body) {
    t.check(label + ': no em or en dash', !/[–—]/.test(body));
    t.check(label + ': no move as a signed percent', !/[+-]\d+(\.\d+)?%/.test(body));
    t.check(label + ': no trailing .0', !/\d\.0\b/.test(body));
    t.check(label + ': no 0% and no 0s', !/(^|[^\d.])0(\.0)?(%|s\b)/.test(body));
    t.check(label + ': no placing named', !/place|rank|#\d/i.test(body));
    t.check(label + ': no hype for someone missing everything', !/absolutely OFF|CLINIC|on FIRE|crushing it/.test(body));
}

function firstLines(body, n) {
    return body.split('\n').filter((l) => l.trim()).slice(0, n).join('\n');
}

/* ── Month over month ── */

suite('praise rankings: a harder month still opens on something true', (t) => {
    // Every goal missed in July, and every one worse than June. Adherence
    // still beat the center average, which sits near 88.5%.
    const cr = loadRankings(t, months(
        { aht: 480, scheduleAdherence: 92, overallSentiment: 86, cxRepOverall: 80, reliability: 4 },
        { aht: 500, scheduleAdherence: 91, overallSentiment: 85, cxRepOverall: 78, reliability: 4 }
    ), {});
    const mail = cr.buildMonthOverMonthEmail('Zed Red', MONTH);
    t.check('there is a draft', !!mail);
    if (!mail) return;
    const body = mail.body;

    t.check('it is the July story', body.indexOf('July 2026 next to June 2026:') > -1);
    t.check('nothing moved the right way', !/📈|🎉 (AHT|Adherence|Sentiment|CX Adv)/.test(body));
    t.check('the praise comes before any number is read',
        /^Hi Zed,\n\nFirst, the good news: your Schedule Adherence was better than the center average in July, 91% against \d+(\.\d)?%\.\n/.test(body));
    t.check('the honest lines are all still there', (body.match(/📉/g) || []).length >= 4);
    t.check('and the close is goal focused, not a verdict',
        /A harder month than June 2026\. Pick one of these to go at first and build from there\./.test(body));
    t.check('the hours are never the praise', !/good news[^\n]*Reliability/.test(body));
    t.check('still a message, not a report', body.length < 700);
    voiceRules(t, 'month over month', body);
});

suite('praise rankings: no hours added is not the praise in an all-red month', (t) => {
    // Reliability held at 0, so its line is a 🎉 and the month reads "mixed",
    // but hours are never praise material: the opener is still added.
    const cr = loadRankings(t, months(
        { aht: 480, scheduleAdherence: 92, overallSentiment: 86, cxRepOverall: 80 },
        { aht: 500, scheduleAdherence: 91, overallSentiment: 85, cxRepOverall: 78 }
    ), {});
    const body = cr.buildMonthOverMonthEmail('Zed Red', MONTH).body;
    t.check('the opener is a goal, not the hours',
        /^Hi Zed,\n\nFirst, the good news: your Schedule Adherence was better than the center average in July/.test(body));
    voiceRules(t, 'mixed month', body);
});

suite('praise rankings: a month with a win in it is left as it was', (t) => {
    const cr = loadRankings(t, months(
        { aht: 480, scheduleAdherence: 92, overallSentiment: 86, cxRepOverall: 80 },
        { aht: 420, scheduleAdherence: 91, overallSentiment: 85, cxRepOverall: 78 }
    ), {});
    const body = cr.buildMonthOverMonthEmail('Zed Red', MONTH).body;
    t.check('an AHT on target is praise already', /🎉 AHT 420s, better by/.test(body));
    t.check('so no extra opener is added', body.indexOf('First, the good news') === -1);
});

/* ── One month ── */

suite('praise rankings: zero goals met opens on the move the right way', (t) => {
    // AHT came down 40 seconds and is still over 426. Everything else slid.
    const cr = loadRankings(t, months(
        { aht: 520, scheduleAdherence: 92, overallSentiment: 86, cxRepOverall: 80 },
        { aht: 480, scheduleAdherence: 91, overallSentiment: 85, cxRepOverall: 78 }
    ), {});
    const mail = cr.buildMonthlyStatsEmail('Zed Red');
    t.check('there is a mail', !!mail);
    if (!mail) return;
    const body = mail.body;

    t.check('kudos first, with the move in words',
        firstLines(body, 2) === 'Hi Zed,\nFirst, the good news: your Average Handle Time moved the right way in July, down 40 seconds from June.');
    t.check('the honest tally stays', /That is 0 of 4 goals met\./.test(body) || /That is 1 of 5 goals met\./.test(body));
    t.check('no wall of "Not there yet."', body.indexOf('Not there yet.') === -1);
    t.check('each miss says how far there is to go',
        /- Average Handle Time: 480s \(goal: 426s or lower\), 54 seconds from goal\./.test(body)
        && /- Schedule Adherence: 91% \(goal: 93% or higher\), 2 points from goal\./.test(body));
    t.check('the hours still read as a total, never as praise', !/good news[^\n]*Reliability/.test(body));
    voiceRules(t, 'one month', body);
});

suite('praise rankings: nothing better than before or the center, so closest to goal', (t) => {
    const cr = loadRankings(t, months(
        { aht: 530, scheduleAdherence: 87, overallSentiment: 86, cxRepOverall: 80 },
        { aht: 540, scheduleAdherence: 86, overallSentiment: 85, cxRepOverall: 78 }
    ), {});
    const body = cr.buildMonthlyStatsEmail('Zed Red').body;
    t.check('the nearest goal, as a share of the goal, leads',
        /First, the good news: your Overall Sentiment was the closest to goal in July, at 85% against the 88% goal, and that is a strong base to build on\./.test(body));
    voiceRules(t, 'closest', body);
});

suite('praise rankings: Rep Satisfaction on two surveys is never the praise', (t) => {
    // 95% on two surveys clears the 82% goal as a number, but three surveys
    // is the floor the center's placings ask for.
    const cr = loadRankings(t, months(
        { aht: 530, scheduleAdherence: 87, overallSentiment: 86, cxRepOverall: 95, surveyTotal: 2, repSurveyTotal: 2 },
        { aht: 540, scheduleAdherence: 86, overallSentiment: 85, cxRepOverall: 95, surveyTotal: 2, repSurveyTotal: 2 }
    ), {});
    const body = cr.buildMonthlyStatsEmail('Zed Red').body;
    t.check('an opener is still added', body.indexOf('First, the good news') > -1);
    t.check('and it is not the thin survey', !/good news[^\n]*Rep Satisfaction/.test(body));
});

suite('praise rankings: no calls at all gets the effort, never a 0s', (t) => {
    const cr = loadRankings(t, months(
        { aht: 530, scheduleAdherence: 87, overallSentiment: 86, cxRepOverall: 80 },
        { aht: 0, totalCalls: 0, scheduleAdherence: 86, overallSentiment: 0, cxRepOverall: 0, surveyTotal: 0, repSurveyTotal: 0 }
    ), {});
    const mail = cr.buildMonthlyStatsEmail('Zed Red');
    t.check('there is a mail', !!mail);
    if (!mail) return;
    t.check('the effort, in the past tense for a finished month',
        firstLines(mail.body, 2) === 'Hi Zed,\nI saw the effort you put in, and it matters.');
    t.check('the 0s handle time is not on the list', mail.body.indexOf('Average Handle Time') === -1);
    voiceRules(t, 'no calls', mail.body);
});

/* ── Year to date ── */

suite('praise rankings: a year with nothing on target opens on the best of it', (t) => {
    const ytd = period('2026-01-01', '2026-07-31', 'ytd',
        roster(4, { aht: 520, scheduleAdherence: 91, overallSentiment: 85, cxRepOverall: 78, reliability: 6 }), 'YTD through Jul 31');
    const cr = loadRankings(t, months(
        { aht: 520, scheduleAdherence: 91, overallSentiment: 85, cxRepOverall: 78 },
        { aht: 520, scheduleAdherence: 91, overallSentiment: 85, cxRepOverall: 78 }
    ), ytd);
    const mail = cr.buildMonthOverMonthEmail('Zed Red', { scope: 'ytd' });
    t.check('it is the year to date email', !!mail && mail.scope === 'ytd');
    if (!mail) return;
    const body = mail.body;

    t.check('the year still running is said in the present tense',
        /^Hi Zed,\n\nFirst, the good news: your Schedule Adherence is better than the center average this year, 91% against \d+(\.\d)?%\.\n/.test(body));
    t.check('the misses are still listed against target', (body.match(/🔸/g) || []).length === 4);
    t.check('the hours on target are not called "already there"', body.indexOf('already there') === -1);
    t.check('the close looks forward',
        body.indexOf('Plenty of year left to bring these to target. Pick one to go at first and build from there.') > -1);
    t.check('the old close is gone', body.indexOf('Worth picking one to go at') === -1);
    voiceRules(t, 'year to date', body);
});

/* ── Verint ── */

function loadVerint(t, weekly) {
    t.installFakeBrowser();
    global.weeklyData = weekly;
    global.ytdData = {};
    t.loadModule('modules/shared-utils.module.js');
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/message-voice.module.js');
    t.loadModule('modules/copilot-prompt.module.js');
    global.window.formatMetricDisplay = formatter;
    global.window.copyToClipboard = () => {};
    return global.window.DevCoachModules.copilotPrompt;
}

function verintFor(api, session, extra) {
    const els = {
        coachingEmployeeSelect: { value: 'Zed Red' },
        verintSummaryOutput: { value: '' },
        verintSummarySection: { style: {} }
    };
    const text = api.generateVerintSummary(Object.assign({
        document: { getElementById: (id) => els[id] || null },
        navigator: {},
        showToast() {},
        getCoachingHistoryForEmployee: () => [session],
        getEmployeeNickname: () => 'Zed'
    }, extra || {}));
    return { text, shown: els.verintSummaryOutput.value };
}

// What recordCoachingEvent really saves, and nothing more.
function session(metricsCoached, weekEnding) {
    return {
        employeeId: 'Zed Red',
        weekEnding: weekEnding === undefined ? '2026-08-09' : weekEnding,
        metricsCoached,
        suggestions: [],
        aiAssisted: true,
        generatedAt: '2026-08-11T15:00:00.000Z'
    };
}

function weeks(before, after) {
    return Object.assign({},
        period('2026-07-27', '2026-08-02', 'week', [emp('Zed Red', before), emp('Pat Other')], 'Week ending Aug 2'),
        period('2026-08-03', '2026-08-09', 'week', [emp('Zed Red', after), emp('Pat Other')], 'Week ending Aug 9'));
}

suite('praise verint: the wins come from the period the session was about', (t) => {
    const api = loadVerint(t, weeks(
        { aht: 450, scheduleAdherence: 90, overallSentiment: 80, cxRepOverall: 70, surveyTotal: 5, repSurveyTotal: 5 },
        { aht: 400, scheduleAdherence: 95, overallSentiment: 80, cxRepOverall: 70, surveyTotal: 5, repSurveyTotal: 5, reliability: 30 }
    ));
    const out = verintFor(api, session(['overallSentiment', 'cxRepOverall', 'reliability']));

    t.check('the note is written', typeof out.text === 'string' && out.text === out.shown);
    t.check('it names the real wins',
        /I recognized Zed for their strong performance in (Average Handle Time and Schedule Adherence|Schedule Adherence and Average Handle Time)\./.test(out.text));
    t.check('the old no-wins line is gone', out.text.indexOf('acknowledged their efforts to improve') === -1);
    t.check('the focus is what the session coached',
        /development opportunities in Overall Sentiment and Rep Satisfaction\./.test(out.text));
    t.check('and the hours are neither a win nor a focus', out.text.indexOf('Reliability') === -1);
    t.check('the action items follow the focus', /• Focus on improving Overall Sentiment\n• Focus on improving Rep Satisfaction/.test(out.text));
    t.check('no em dash', !/[–—]/.test(out.text));
});

suite('praise verint: with nothing on target it names the best true thing', (t) => {
    const api = loadVerint(t, weeks(
        { aht: 480, scheduleAdherence: 90, overallSentiment: 80, cxRepOverall: 70 },
        { aht: 450, scheduleAdherence: 89, overallSentiment: 80, cxRepOverall: 70 }
    ));
    const out = verintFor(api, session(['aht', 'scheduleAdherence']));
    t.check('a real move, in words',
        /I recognized Zed for moving Average Handle Time the right way, down 30 seconds from the week before\. Encouraged them to keep building on it\./.test(out.text));
    t.check('never the empty acknowledgment', out.text.indexOf('acknowledged their efforts to improve') === -1);
    t.check('focus areas still named', /development opportunities in Average Handle Time and Schedule Adherence/.test(out.text));
    t.check('no signed percent', !/[+-]\d+(\.\d+)?%/.test(out.text));

    // Nothing better than the week before: the center average is next.
    global.calculateCenterAveragesFromEmployees = () => ({ adherence: 85, aht: 470, sentiment: 90, repSatisfaction: 88 });
    const apiFlat = loadVerint(t, weeks(
        { aht: 440, scheduleAdherence: 90, overallSentiment: 81, cxRepOverall: 72 },
        { aht: 450, scheduleAdherence: 89, overallSentiment: 80, cxRepOverall: 70 }
    ));
    const flat = verintFor(apiFlat, session(['aht']));
    delete global.calculateCenterAveragesFromEmployees;
    t.check('better than the center, with both numbers',
        /I recognized Zed for (Schedule Adherence of 89%, better than the center average of 85%|Average Handle Time of 450s, better than the center average of 470s)\./.test(flat.text));
});

suite('praise verint: no calls is the effort, never a 0 second win', (t) => {
    const api = loadVerint(t, weeks(
        { aht: 480, scheduleAdherence: 90 },
        { aht: 0, totalCalls: 0, scheduleAdherence: 95, overallSentiment: 0, cxRepOverall: 0, surveyTotal: 0, repSurveyTotal: 0 }
    ));
    const out = verintFor(api, session(['cxRepOverall', 'aht']));
    t.check('the effort is recognized', /I recognized Zed for the effort they are putting in\. Encouraged them to keep building on it\./.test(out.text));
    t.check('a 0s handle time is never praised', !/Average Handle Time on target|strong performance/.test(out.text));
    t.check('a survey nobody answered is not a focus', out.text.indexOf('Rep Satisfaction') === -1);
});

suite('praise verint: a session logged with a label finds its week by the day it was logged', (t) => {
    const api = loadVerint(t, weeks(
        { aht: 480, scheduleAdherence: 90 },
        { aht: 410, scheduleAdherence: 90, overallSentiment: 80, cxRepOverall: 70 }
    ));
    const out = verintFor(api, session(['scheduleAdherence'], 'Week ending 08/09/2026'));
    t.check('the newest week on or before the session is read',
        /I recognized Zed for their strong performance in Average Handle Time\./.test(out.text));
});
