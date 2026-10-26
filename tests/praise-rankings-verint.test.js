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
    // Said out loud (Scott, 2026-10-26): no report rows, no column headings,
    // no "better by", no bad news sandwich, two emojis at most.
    t.check(label + ': no label: value rows', !/^- [^:\n]+: /m.test(body));
    t.check(label + ': no "Met." verdicts', !/\bMet\.|Not there yet/.test(body));
    t.check(label + ': no column headings', !/\bAHT\b|CX Adv/.test(body));
    t.check(label + ': no "better by" or "off by"', !/better by|off by/.test(body));
    t.check(label + ': no "First, the good news"', body.indexOf('good news') === -1);
    t.check(label + ': two emojis at most', global.window.DevCoachModules.messageVoice.countEmojis(body) <= 2);
}

function firstLines(body, n) {
    return body.split('\n').filter((l) => l.trim()).slice(0, n).join('\n');
}

/* ── Month over month ── */

suite('praise rankings: a harder month still opens on something true', (t) => {
    // Every goal missed in July, and every one worse than June. Adherence
    // still beat the center average, but it slipped, and a metric the same
    // message says slipped is never the praise: the effort is.
    const cr = loadRankings(t, months(
        { aht: 480, scheduleAdherence: 92, overallSentiment: 86, cxRepOverall: 80, reliability: 4 },
        { aht: 500, scheduleAdherence: 91, overallSentiment: 85, cxRepOverall: 78, reliability: 4 }
    ), {});
    const mail = cr.buildMonthOverMonthEmail('Zed Red', MONTH);
    t.check('there is a draft', !!mail);
    if (!mail) return;
    const body = mail.body;

    t.check('it is the July story', /In July, /.test(body) && /from June\./.test(body));
    t.check('nothing moved the right way', !/came down|went up/.test(body));
    t.check('the praise comes before any number is read',
        /^Hi Zed,\n\nI saw the effort you put in, and it matters\.\n/.test(body));
    t.check('the slips are named together, not as a wall',
        /In July, handle time, adherence, sentiment, and rep satisfaction each slipped from June\./.test(body));
    t.check('and the close is goal focused, not a verdict',
        /July was a tougher month than June, and that happens\.\n\nAdherence is the closest, only 2 points from goal, and I think you can get there in August\./.test(body));
    t.check('the hours are never the praise', !/^Hi Zed,\n\n[^\n]*reliability/i.test(body));
    t.check('the hours are the year\'s total', /reliability budget for the year, at 8 hours so far|hours missed for the year are at 8 hours so far/.test(body));
    t.check('still a message, not a report', body.length < 700);
    voiceRules(t, 'month over month', body);
});

suite('praise rankings: no hours added is not the praise in an all-red month', (t) => {
    // Reliability held at 0, which is good to say, but hours are never
    // praise material: the opener is still added, and it is not the hours.
    const cr = loadRankings(t, months(
        { aht: 480, scheduleAdherence: 92, overallSentiment: 86, cxRepOverall: 80 },
        { aht: 500, scheduleAdherence: 91, overallSentiment: 85, cxRepOverall: 78 }
    ), {});
    const body = cr.buildMonthOverMonthEmail('Zed Red', MONTH).body;
    t.check('the opener is not the hours',
        firstLines(body, 2) === 'Hi Zed,\nI saw the effort you put in, and it matters.');
    t.check('the hours are said further down', /No hours missed this year so far/.test(body));
    voiceRules(t, 'mixed month', body);
});

suite('praise rankings: a month with a win in it is left as it was', (t) => {
    const cr = loadRankings(t, months(
        { aht: 480, scheduleAdherence: 92, overallSentiment: 86, cxRepOverall: 80 },
        { aht: 420, scheduleAdherence: 91, overallSentiment: 85, cxRepOverall: 78 }
    ), {});
    const body = cr.buildMonthOverMonthEmail('Zed Red', MONTH).body;
    t.check('an AHT on target is praise already',
        /In July, handle time came down 60 seconds, from 480 to 420\. That put it on target\./.test(body));
    t.check('so no extra opener is added',
        firstLines(body, 2) === 'Hi Zed,\nHere\'s your year so far, month by month against your goals.');
    t.check('the win is never also the focus', !/handle time is the closest|go after handle time/i.test(body));
    voiceRules(t, 'with a win', body);
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
        firstLines(body, 2) === 'Hi Zed,\nHandle time came down 40 seconds in July, from 520 to 480, and that\'s real progress.');
    t.check('no tally of goals met', !/goals met/.test(body));
    t.check('no wall of "Not there yet."', body.indexOf('Not there yet.') === -1);
    t.check('the praised one says how far it still has to go, once',
        /Handle time has 54 seconds to go to reach its goal of 426\./.test(body)
        && (body.match(/480/g) || []).length === 1);
    t.check('each other miss is said with its goal',
        /Adherence finished at 91% with a 93% goal and sentiment at 85% with an 88% goal\./.test(body)
        && /Rep satisfaction came in at 78% with an 82% goal\./.test(body));
    t.check('one thing to go after, never the one praised',
        /Adherence is the closest, only 2 points from goal, and I think you can get there in August\./.test(body));
    t.check('the hours still read as a total, never as praise', !/^Hi Zed,\n[^\n]*reliability/i.test(firstLines(body, 2)));
    voiceRules(t, 'one month', body);
});

suite('praise rankings: nothing better than before or the center, so closest to goal', (t) => {
    const cr = loadRankings(t, months(
        { aht: 530, scheduleAdherence: 87, overallSentiment: 86, cxRepOverall: 80 },
        { aht: 540, scheduleAdherence: 86, overallSentiment: 85, cxRepOverall: 78 }
    ), {});
    const body = cr.buildMonthlyStatsEmail('Zed Red').body;
    // Still a miss, so it is named as close, never as good news.
    t.check('the nearest goal, as a share of the goal, leads, named as close',
        /^Hi Zed,\n\nSentiment came closest to goal in July, 85% with an 88% goal, only 3 points short\./.test(body));
    t.check('never "a strong base" for a miss', !/strong base|good place to build/.test(body));
    t.check('and no second "closest" contradicts it', (body.match(/closest/g) || []).length === 1);
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
    const opener = body.split('\n')[2] || '';
    t.check('an opener is still added', /closest to goal|better than the center|came down|went up/.test(opener));
    t.check('and it does not lead on the thin survey', !/^Rep satisfaction/.test(opener));
    voiceRules(t, 'thin survey', body);
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
    t.check('the 0s handle time is not on the list', !/handle time/i.test(mail.body));
    t.check('a lone miss is not named twice in a row',
        /Adherence finished at 86% with a 93% goal\. That's 7 points from goal, and I think you can get there in August\./.test(mail.body));
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
        /^Hi Zed,\n\nAdherence is 91% this year, better than the center average of \d+(\.\d)?%\.\n/.test(body));
    t.check('the misses are still said against their goals',
        /Adherence has 2 points to go to reach its goal of 93%\./.test(body)
        && (body.match(/ with an? \d+%? goal/g) || []).length === 3);
    t.check('the hours on target are not called "already there"', body.indexOf('already there') === -1);
    t.check('the close looks forward', /there is plenty of year left to get there\./.test(body));
    t.check('the old close is gone', body.indexOf('Worth picking one to go at') === -1);
    t.check('the hours are the year\'s total, never a goal met',
        /(reliability budget for the year, at 6 hours so far|hours missed for the year are at 6 hours so far)/.test(body));
    voiceRules(t, 'year to date', body);
});

suite('praise rankings: a draft built twice reads the same, and closers rotate across people', (t) => {
    const cr = loadRankings(t, months(
        { aht: 430, scheduleAdherence: 95, overallSentiment: 86, cxRepOverall: 85 },
        { aht: 410, scheduleAdherence: 94, overallSentiment: 85.5, cxRepOverall: 80 }
    ), {});
    const a = cr.buildMonthlyStatsEmail('Zed Red').body;
    const b = cr.buildMonthlyStatsEmail('Zed Red').body;
    t.equal('the same person and month get the same words', a, b);
    const closers = global.window.DevCoachModules.messageVoice.EMAIL_CLOSERS;
    t.check('it ends on one of the closers', closers.some((c) => a.endsWith(c)));
    const seen = new Set();
    ['Zed Red', 'Ada Lovelace', 'Bo Diddley', 'Cy Young', 'Di Prince', 'Ed Norton', 'Flo Jo', 'Gus Grissom'].forEach((n) => {
        seen.add(global.window.DevCoachModules.messageVoice.emailCloser(n + '|2026-07'));
    });
    t.check('different people do not all get the same closer', seen.size >= 3);
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
    // One metric is not "these areas", and the header carries no spaced
    // hyphen standing in for a dash (tone audit, 2026-10-25).
    t.check('one win is "there", not "these areas"',
        /keep up the great work there\./.test(out.text) && !/these areas/.test(out.text));
    t.check('no spaced hyphen in the header', !/^Coaching [Ss]ession with Zed - /.test(out.text) && /^Coaching session with Zed on /.test(out.text));
});
