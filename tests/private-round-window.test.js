'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * THE PRIVATE ROUND SAYS WHAT THE WINDOW SAYS
 *
 * Friday 2 October 2026. Scott had Last month picked, the page read "Comparing
 * September 2026 against August 2026", and the Private round opened as a
 * Monday Kickoff with this in it:
 *
 *   "Fresh week ahead. ... Your Hold Time is trending the right direction this
 *    week, -24s. (down from 87s last month to 63s this month)"
 *
 * Every number was right: 87s was August, 63s was September. Every word
 * around them was wrong. "This week" was a month, "this month" was last
 * month, the focus line called September's handle time "last week", and the
 * Monday tab was lit on a Friday because a tab clicked days earlier was
 * remembered for good. Read together it looked like week over week, so the
 * round looked like it was ignoring the window entirely.
 */

const SEPT = '2026-09-01|2026-09-30';
const AUG = '2026-08-01|2026-08-31';
const FRIDAY = new Date(2026, 9, 2, 9);

const REGISTRY = {
    scheduleAdherence: { label: 'Schedule Adherence', unit: '%', isReverse: false, target: { type: 'min', value: 93 } },
    aht: { label: 'Average Handle Time', unit: 'sec', isReverse: true, target: { type: 'max', value: 426 } },
    holdTime: { label: 'Hold Time', unit: 'sec', isReverse: true, target: { type: 'max', value: 30 } },
    overallSentiment: { label: 'Overall Sentiment', unit: '%', isReverse: false, target: { type: 'min', value: 88 } }
};

const METRICS = [
    { metricKey: 'scheduleAdherence', label: 'Schedule Adherence', employeeValue: 95.1, target: 93, targetType: 'min', classification: 'Exceeding Expectation', meetsTarget: true, gapFromTarget: 0 },
    { metricKey: 'overallSentiment', label: 'Overall Sentiment', employeeValue: 92.7, target: 88, targetType: 'min', classification: 'On Track', meetsTarget: true, gapFromTarget: 0 },
    { metricKey: 'aht', label: 'Average Handle Time', employeeValue: 564, target: 426, targetType: 'max', classification: 'Needs Focus', meetsTarget: false, gapFromTarget: 138 },
    { metricKey: 'holdTime', label: 'Hold Time', employeeValue: 63, target: 30, targetType: 'max', classification: 'Needs Focus', meetsTarget: false, gapFromTarget: 33 }
];

function loadPulse(t) {
    t.installFakeBrowser();
    const emp = { name: 'Alyssa Dimes', totalCalls: 900, surveyTotal: 0, scheduleAdherence: 95.1, aht: 564, holdTime: 63, overallSentiment: 92.7 };
    global.weeklyData = {
        [AUG]: {
            metadata: { periodType: 'month', startDate: '2026-08-01', endDate: '2026-08-31' },
            employees: [Object.assign({}, emp, { holdTime: 87, aht: 540 })]
        },
        [SEPT]: {
            metadata: { periodType: 'month', startDate: '2026-09-01', endDate: '2026-09-30' },
            employees: [emp]
        }
    };
    global.ytdData = {};
    global.dailyData = {};
    global.METRICS_REGISTRY = REGISTRY;
    global.window.METRICS_REGISTRY = REGISTRY;
    global.isReverseMetric = key => Boolean(REGISTRY[key] && REGISTRY[key].isReverse);
    global.metricDelta = (key, latest, base) => (REGISTRY[key] && REGISTRY[key].isReverse ? base - latest : latest - base);
    global.formatDateMMDDYYYY = (s) => {
        const [year, month, day] = String(s || '').split('-');
        return year && month && day ? `${month}/${day}/${year}` : '';
    };
    global.window.analyzeTrendMetrics = () => ({ allMetrics: METRICS });
    return t.loadModule('modules/morning-pulse.module.js').morningPulse;
}

// The pools are random. Draw enough that a wrong line would have to show up.
async function draw(pulse, options, times) {
    const out = [];
    for (let i = 0; i < (times || 200); i++) {
        out.push(await pulse.generateMondayKickoffMessage('Alyssa Dimes', SEPT, AUG, Object.assign({ now: FRIDAY }, options)));
    }
    return out;
}

function sentences(messages) {
    const all = new Set();
    messages.forEach(m => m.split(/(?<=[.!?])\s+|\n+/).forEach(s => all.add(s.trim())));
    return [...all];
}

suite('private round: a finished month is called by its name', (t) => {
    const pulse = loadPulse(t);
    const month = (type, end) => ({ metadata: { periodType: type, endDate: end } });

    const sept = pulse.describeWeekRecency(SEPT, month('month', '2026-09-30'), FRIDAY);
    t.equal('September read in October is September', sept.when, 'in September');
    t.equal('and its baseline is August', sept.prior, 'in August');

    t.equal('a rebuilt month as well',
        pulse.describeWeekRecency('month:2026-09', month('month-agg', '2026-09-25'), FRIDAY).when, 'in September');
    t.equal('a rebuilt month with no end date reads its key',
        pulse.describeWeekRecency('month:2026-09', month('month-agg', ''), FRIDAY).when, 'in September');
    t.equal('January looks back across the year',
        pulse.describeWeekRecency('k', month('month', '2026-01-31'), FRIDAY).prior, 'in December');

    // A month still running is this month, and so is a month to date.
    t.equal('the month in progress is this month',
        pulse.describeWeekRecency('k', month('month-agg', '2026-10-02'), FRIDAY).when, 'this month');
    t.equal('a month to date is this month',
        pulse.describeWeekRecency('k', month('month-to-date', '2026-10-02'), FRIDAY).when, 'this month');
});

suite('private round: last month under the Monday tone', async (t) => {
    const pulse = loadPulse(t);
    const lines = sentences(await draw(pulse, { dayWord: 'Monday', startsTheWeek: true }));

    const numbered = lines.filter(s => /\d+(\.\d+)?(s|%)/.test(s));
    const weekNumbers = numbered.filter(s => /\bweek\b/i.test(s));
    t.equal(`no number is called a week's (${weekNumbers.slice(0, 2).join(' | ') || 'clean'})`, weekNumbers.length, 0);

    const lateMonths = lines.filter(s => /\b(this|last) month\b/i.test(s));
    t.equal(`September is not "this month" in October (${lateMonths[0] || 'clean'})`, lateMonths.length, 0);

    t.check('the comparison names both months',
        lines.some(s => s.indexOf('down from 87s in August to 63s in September') > -1));
    t.check('the jump is September\'s',
        lines.some(s => /Hold Time.*in September, -24s/.test(s)));
    t.check('the focus number is September\'s',
        lines.some(s => /564s in September/.test(s)));

    // Monday still sounds like Monday. The tone is the tab's to set.
    t.check('the week ahead is still this week', lines.some(s => /\bthis week\b/.test(s)));
});

suite('private round: last month under the Friday tone', async (t) => {
    const pulse = loadPulse(t);
    const lines = sentences(await draw(pulse, { dayWord: 'Friday', startsTheWeek: false, ahead: 'next week' }));

    const thisWeek = lines.filter(s => /\bthis week\b/i.test(s));
    t.equal(`a Friday plans for next week, not this one (${thisWeek[0] || 'clean'})`, thisWeek.length, 0);
    t.check('and says so', lines.some(s => /\bnext week\b/.test(s)));

    const wishes = lines.filter(s => /\b(great|strong) week\b|rest of the week|new week|Fresh week/i.test(s));
    t.equal(`nothing opens a week that is ending (${wishes[0] || 'clean'})`, wishes.length, 0);
});

suite('private round: the round hands Friday its week ahead', (t) => {
    const source = fs.readFileSync(path.join(ROOT, 'modules/morning-pulse.module.js'), 'utf8');
    t.check('the kickoff is told which week the plan is for',
        /ahead: plan\.id === 'friday' \? 'next week' : 'this week'/.test(source));
    t.check('and the header names numbers and tone apart',
        /Numbers: \$\{escapeHtml\(comparison\.headline/.test(source) && /Tone: \$\{escapeHtml\(plan\.label\)\}/.test(source));
});

suite('private round: the lit tab is today\'s unless picked today', (t) => {
    t.installFakeBrowser();
    t.loadModule('modules/period-index.module.js');
    t.loadModule('modules/daily-outreach.module.js');
    t.loadModule('modules/day-posts.module.js');
    const modules = t.loadModule('modules/my-team.module.js');
    const myTeam = modules.myTeam;
    const outreach = modules.dailyOutreach;
    const KEY = 'devCoachingTool_myTeamDay';
    const today = outreach.planForDate(new Date()).id;
    const expected = outreach.WEEKDAY_IDS.indexOf(today) > -1 ? today : 'monday';

    const other = outreach.WEEKDAY_IDS.find(d => d !== expected);
    myTeam.setActiveDay(other);
    t.equal('a tab picked today stays lit today', myTeam.activeDayId(), other);

    localStorage.setItem(KEY, JSON.stringify({ day: other, on: '2000-01-03' }));
    t.equal('a tab picked another day gives way to today', myTeam.activeDayId(), expected);

    localStorage.setItem(KEY, other);
    t.equal('and so does one saved before the date was kept', myTeam.activeDayId(), expected);
});
