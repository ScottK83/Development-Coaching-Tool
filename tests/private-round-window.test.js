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
    const messages = await draw(pulse, { dayWord: 'Monday', startsTheWeek: true });
    const lines = sentences(messages);

    const numbered = lines.filter(s => /\d+(\.\d+)?(s|%)/.test(s));
    const weekNumbers = numbered.filter(s => /\bweek\b/i.test(s));
    t.equal(`no number is called a week's (${weekNumbers.slice(0, 2).join(' | ') || 'clean'})`, weekNumbers.length, 0);

    const lateMonths = lines.filter(s => /\b(this|last) month\b/i.test(s));
    t.equal(`September is not "this month" in October (${lateMonths[0] || 'clean'})`, lateMonths.length, 0);

    // The move in words and the two numbers it went between, with the
    // month named once (Scott, 2026-10-14: "-24s" read as a number of its
    // own, and "87s last month to 63s this month" said the month twice).
    t.check('the comparison carries both months\' numbers',
        messages.some(m => m.indexOf('(87s to 63s)') > -1));
    t.check('the jump is September\'s, said in words',
        messages.some(m => /Hold Time[^\n]*in September/.test(m) && /down 24 seconds/i.test(m)));
    t.equal('no move is written with a minus sign',
        messages.filter(m => /-\d+s\b/.test(m)).length, 0);
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

/**
 * A MONTH WINDOW SAYS WHICH MONTH, AND AGAINST WHICH
 *
 * Wednesday 14 October 2026. Scott picked Month to date, the header read
 * "October 2026 so far against September 2026", and the round opened with
 * "Here's your latest snapshot" and "Following up with your latest numbers".
 * Nothing said this was October so far, and nothing held it up against
 * September unless a big jump happened to lead the praise.
 */
const OCT_MTD = '2026-10-01|2026-10-13';
const WEDNESDAY = new Date(2026, 9, 14, 9);

function loadMonthToDate(t) {
    const pulse = loadPulse(t);
    // The rule for whether a stretch is still running lives in message-voice.
    t.loadModule('modules/message-voice.module.js');
    const sept = global.weeklyData[SEPT].employees[0];
    global.weeklyData = {
        [SEPT]: {
            metadata: { periodType: 'month', startDate: '2026-09-01', endDate: '2026-09-30' },
            employees: [Object.assign({}, sept, { holdTime: 87, aht: 540, scheduleAdherence: 93.0 })]
        },
        [OCT_MTD]: {
            metadata: { periodType: 'month-to-date', startDate: '2026-10-01', endDate: '2026-10-13' },
            employees: [Object.assign({}, sept)]
        }
    };
    return pulse;
}

const MTD_WINDOW = {
    windowId: 'mtd', unit: 'month', latestKey: OCT_MTD, baselineKey: SEPT,
    latestLabel: 'October 2026 so far', baselineLabel: 'September 2026'
};

async function drawWith(pulse, latestKey, baselineKey, options, times) {
    const out = [];
    for (let i = 0; i < (times || 120); i++) {
        out.push(await pulse.generateMondayKickoffMessage('Alyssa Dimes', latestKey, baselineKey, Object.assign({ now: WEDNESDAY }, options)));
    }
    return out;
}

suite('private round: the window frame names both sides', (t) => {
    const pulse = loadMonthToDate(t);
    const mtd = pulse.windowFrame(MTD_WINDOW);
    t.equal('month to date is your October', mtd.now, 'your October');
    t.equal('held against September', mtd.prior, 'September');

    const last = pulse.windowFrame(Object.assign({}, MTD_WINDOW, {
        windowId: 'lastMonth', latestKey: SEPT, baselineKey: AUG,
        latestLabel: 'September 2026', baselineLabel: 'August 2026'
    }));
    t.equal('last month is your September', last.now, 'your September');
    t.equal('held against August', last.prior, 'August');

    const alone = pulse.windowFrame(Object.assign({}, MTD_WINDOW, { baselineKey: null, baselineLabel: '' }));
    t.equal('a month with nothing before it has no prior', alone.prior, '');

    const ytd = pulse.windowFrame({ windowId: 'ytd', latestKey: 'y2', baselineKey: 'y1', latestLabel: 'the year so far', baselineLabel: 'the report through Sep 30' });
    t.equal('the year is your year', ytd.now, 'your year');
    t.equal('held against the last report', ytd.prior, 'where it stood through Sep 30');

    t.equal('a week window keeps its own openers',
        pulse.windowFrame({ windowId: 'thisWeek', latestKey: 'w', baselineKey: 'v', latestLabel: 'this week so far', baselineLabel: 'last week' }), null);
    t.equal('a raw month key is never spoken',
        pulse.windowFrame(Object.assign({}, MTD_WINDOW, { latestLabel: '2026-10 so far' })), null);
});

suite('private round: month to date opens on October against September', async (t) => {
    const pulse = loadMonthToDate(t);
    const frame = pulse.windowFrame(MTD_WINDOW);
    const messages = await drawWith(pulse, OCT_MTD, SEPT, { dayWord: 'Wednesday', startsTheWeek: false, frame });

    const firstLines = messages.map(m => m.split('\n')[0]);
    t.check('every opener names October', firstLines.every(s => /your October/.test(s)));
    t.check('and September beside it', firstLines.every(s => /September/.test(s)));
    t.check('in the present, because October is still running', firstLines.every(s => /so far/.test(s)));
    const generic = firstLines.filter(s => /latest (numbers|snapshot)/i.test(s));
    t.equal(`no generic "latest numbers" opener (${generic[0] || 'clean'})`, generic.length, 0);

    t.check('the gain shows both months\' numbers',
        messages.every(m => m.indexOf('Better than September: Schedule Adherence up from 93% to 95.1%.') > -1));
    t.check('and so does the slide',
        messages.every(m => m.indexOf('Behind September: Average Handle Time up from 540s to 564s.') > -1));
    t.check('the jump the praise led with is not said twice',
        messages.every(m => !/Better than September:[^\n]*Hold Time/.test(m)));
});

suite('private round: last month is spoken of as finished', async (t) => {
    const pulse = loadPulse(t);
    const frame = pulse.windowFrame({
        windowId: 'lastMonth', latestKey: SEPT, baselineKey: AUG,
        latestLabel: 'September 2026', baselineLabel: 'August 2026'
    });
    const firstLines = (await drawWith(pulse, SEPT, AUG, { dayWord: 'Wednesday', startsTheWeek: false, frame }))
        .map(m => m.split('\n')[0]);
    t.check('every opener names September and August', firstLines.every(s => /your September/.test(s) && /August/.test(s)));
    const running = firstLines.filter(s => /so far|is going/.test(s));
    t.equal(`a finished month is not "so far" (${running[0] || 'clean'})`, running.length, 0);
});

suite('private round: no baseline, no promise of one', async (t) => {
    const pulse = loadMonthToDate(t);
    const frame = pulse.windowFrame(Object.assign({}, MTD_WINDOW, { baselineKey: null, baselineLabel: '' }));
    const messages = await drawWith(pulse, OCT_MTD, null, { dayWord: 'Wednesday', startsTheWeek: false, frame });
    t.check('the opener still names October', messages.every(m => /your October/.test(m.split('\n')[0])));
    const promised = messages.filter(m => /compares to|next to|side by side|against|Better than|Behind/.test(m.split('\n')[0]));
    t.equal(`nothing is compared against a month that is not there (${promised[0] ? promised[0].split('\n')[0] : 'clean'})`, promised.length, 0);
});

suite('private round: the round hands the kickoff its window frame', (t) => {
    const source = fs.readFileSync(path.join(ROOT, 'modules/morning-pulse.module.js'), 'utf8');
    t.check('writeOutreachMessage passes the frame', /frame: windowFrame\(comparison\)/.test(source));
});
