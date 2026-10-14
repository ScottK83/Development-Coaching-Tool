'use strict';

const { suite } = require('./harness');

/**
 * THE OTHER CELEBRATING POSTS
 *
 * Beat a target, the raffle post and the cheer, read against the same ask as
 * the shout-outs (Scott, 2026-10-14): natural, full of praise, numbers simple
 * enough to read at a glance, two emojis a message.
 */

// The real display rule (metric-trends formatMetricDisplay), restated so these
// suites do not lean on a module other work is changing: the unit always, and
// no trailing ".0".
function displayLikeTheApp(key, value) {
    const unit = global.window.METRICS_REGISTRY?.[key]?.unit;
    const n = Number(value);
    if (unit === 'sec') return `${Math.round(n)}s`;
    const fixed = n.toFixed(1).replace(/\.0$/, '');
    if (unit === '%') return `${fixed}%`;
    if (unit === 'hrs') return `${fixed} hrs`;
    return String(Math.round(n));
}

function loadHub(t, periods) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/highlights.module.js');
    t.loadModule('modules/message-voice.module.js');
    global.weeklyData = {};
    global.ytdData = {};
    global.dailyData = {};
    t.loadModule('modules/celebrations.module.js');
    global.window.formatMetricDisplay = displayLikeTheApp;
    global.window.DevCoachModules.periodComparison = { periodFor: (key) => periods[key] || null };
    global.window.DevCoachModules.teamScope = {
        getMyTeamRoster: () => ['Marcus Lee', 'Jo Park', 'Al Gomez', 'Behind Everywhere'],
        getScopeMembers: () => null
    };
    return t.loadModule('modules/team-hub.module.js');
}

function week(start, end, employees) {
    return { metadata: { periodType: 'week', startDate: start, endDate: end }, employees };
}

suite('celebrate voice: Beat a target names the number with its unit, then praises it', (t) => {
    const periods = {
        W: week('2026-10-05', '2026-10-11', [
            { name: 'Marcus Lee', totalCalls: 140, aht: 409, negativeWord: 99.3, positiveWord: 95.8 },
            // One survey that cleared all three survey targets.
            { name: 'Jo Park', totalCalls: 120, surveyTotal: 1, fcr: 100, cxRepOverall: 100, overallExperience: 100, scheduleAdherence: 97 },
            { name: 'Al Gomez', totalCalls: 120, positiveWord: 84 },
            { name: 'Behind Everywhere', totalCalls: 120, scheduleAdherence: 85 }
        ]),
        P: week('2026-09-28', '2026-10-04', [
            { name: 'Al Gomez', totalCalls: 120, positiveWord: 80 }
        ])
    };
    const mods = loadHub(t, periods);
    const voice = mods.messageVoice;
    const built = mods.teamHub.buildHighlightsForComparison({
        windowId: 'lastWeek', latestKey: 'W', baselineKey: 'P', latestLabel: 'last week'
    });
    const post = built.post;
    const lines = post.split('\n');

    t.equal('the title names the window and its days', lines[0], '✨ Highlights, Last week (Oct 5 to 11)');
    // "• Marcus, Average Handle Time 409, Avoid Negative Words 99.3, and
    // Positive Word 95.8" dropped every unit and read like a spreadsheet.
    t.check('a line puts the number first, with its unit',
        lines.indexOf('• Marcus: 409s Handle Time, 99.3% Avoiding Negative Words, and 95.8% Positive Word Usage.') > -1);
    // FCR, OE and Rep Sat off one survey were three wins.
    t.check('one survey is one win, and says it was one survey',
        lines.indexOf('• Jo: 100% First Call Resolution on 1 survey and 97% Schedule Adherence.') > -1);
    t.check('the survey questions are not each counted', !/Rep Satisfaction|Overall Experience/.test(post));
    // A move is said in points, in one range form.
    t.check('an improvement says how far, from where, to where',
        lines.indexOf('• Al: Positive Word Usage up 4 points from 80% to 84%.') > -1);
    t.check('somebody behind on everything is not named', post.indexOf('Behind') === -1);

    t.check('it closes with kudos', lines[lines.length - 2] === '' && /(Great work|Proud of|This is what|Love seeing|Every one of you)/.test(lines[lines.length - 1]));
    t.check('two emojis at most', voice.countEmojis(post) <= 2);
    t.check('no placings, no counts of who was beaten', !/\b(#\d|rank|better than)\b/i.test(post));

    t.equal('a percent move is points', mods.teamHub.formatDelta('scheduleAdherence', 14.8), '14.8 points');
    t.equal('one point is a point', mods.teamHub.formatDelta('scheduleAdherence', 1), '1 point');
    t.equal('a seconds move is seconds', mods.teamHub.formatDelta('aht', 40.2), '40 seconds');
});

suite('celebrate voice: the raffle post is a heading, a list and a cheer', (t) => {
    t.installFakeBrowser();
    const voice = t.loadModule('modules/message-voice.module.js').messageVoice;
    const contest = t.loadModule('modules/contest.module.js').contest;

    const days = {};
    ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09'].forEach((d) => {
        days[d] = { 'Dana Roe': { adherence: 96 }, 'Betty Yanez': { adherence: 93, perfectSurveys: 1 } };
    });
    days['2026-10-01'] = { 'Dana Roe': { adherence: 94 } };
    days['2026-10-13'] = { 'Betty Yanez': { adherence: 95 } };
    const post = contest.buildCheckinPost({ days }, { target: 93, asOf: '2026-10-14' });

    t.check('the heading says what and when in one line', post.split('\n')[0] === '🎟️ Raffle tickets so far, Oct 1 to 13:');
    // A day at exactly 93% pays a ticket, so the rule says "or better".
    t.check('a day at the target itself earns a ticket', /@Betty, \d+ tickets/.test(post));
    t.check('and the rule says so', post.indexOf('every day at 93% adherence or better') > -1);
    t.check('the bonus is explained once earned, in the same terms', post.indexOf('A full week at 93% or better adds a bonus ticket') > -1);
    t.check('two emojis, with the bonus line in', voice.countEmojis(post) <= 2);
    t.check('the cheer is not "Cracking"', post.indexOf('Cracking') === -1 && post.indexOf('Great run on adherence') > -1);
});

function cheerWeek(start, end, values) {
    return {
        metadata: { startDate: start, endDate: end, periodType: 'week' },
        employees: [Object.assign({ name: 'Christi Test', totalCalls: 500, surveyTotal: 40 }, values)]
    };
}

function loadCheer(t) {
    t.pinClock('2026-10-14');
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/message-voice.module.js');
    const sep = { positiveWord: 88.2, acw: 65, scheduleAdherence: 90 };
    global.weeklyData = {
        '2026-09-07|2026-09-13': cheerWeek('2026-09-07', '2026-09-13', sep),
        '2026-09-14|2026-09-20': cheerWeek('2026-09-14', '2026-09-20', sep),
        '2026-09-21|2026-09-27': cheerWeek('2026-09-21', '2026-09-27', sep),
        '2026-09-28|2026-10-04': cheerWeek('2026-09-28', '2026-10-04', { positiveWord: 92.9, acw: 65, scheduleAdherence: 90 }),
        '2026-10-05|2026-10-11': cheerWeek('2026-10-05', '2026-10-11', { positiveWord: 92.9, acw: 64, scheduleAdherence: 94 })
    };
    global.window.formatMetricDisplay = displayLikeTheApp;
    global.window.DevCoachModules.metricProfiles = { TARGETS_BY_YEAR: { 2026: {
        positiveWord: { type: 'min', meet: 86 }, acw: { type: 'max', meet: 60 }, scheduleAdherence: { type: 'min', meet: 93 }
    } } };
    global.window.DevCoachModules.futures = {
        buildFuturesData: () => ({
            employees: [{ name: 'Christi Test', metrics: {}, dataSource: 'test' }],
            weekInfo: { currentYear: 2026, weeksCompleted: 41, weeksRemaining: 11 }
        })
    };
    global.getEmployeeNickname = (n) => n.split(' ')[0];
    return t.loadModule('modules/cheerleading.module.js');
}

suite('celebrate voice: a cheer stays inside its window and only cheers real moves', (t) => {
    const mods = loadCheer(t);
    const cheer = mods.cheerleading;
    const voice = mods.messageVoice;

    // No window: the newest two weeks and the newest two months, as before.
    // This is what proves the fixture has a monthly move to leave out.
    const open = cheer.buildCheerData();
    const openText = open.people[0].cheers.map((c) => c.text).join(' ');
    t.check('with no window the month is compared', /in September/.test(openText));

    // A "last week" cheer quoted "88.2% in September to 92.9% so far in
    // October", a stretch of time the page never named.
    const lastWeek = { unit: 'week', latestKey: '2026-10-05|2026-10-11', baselineKey: '2026-09-28|2026-10-04',
        latestLabel: 'last week', baselineLabel: 'the week before' };
    const message = cheer.cheerMessageFor('Christi Test', lastWeek);
    t.check('a week window writes a cheer', message.length > 0);
    t.check('and never reaches for a month', !/September|October/.test(message));
    t.check('the move is said in points, from where to where',
        /up 4 points,? from 90% the week before to 94% last week/.test(message));
    // 65s to 64s was cheered as a "nice move".
    t.check('a one-second move is not a move', message.indexOf('After Call Work') === -1);
    t.check('two emojis at most', voice.countEmojis(message) <= 2);

    // A month window gets its own month against the one before, or nothing.
    const mtd = { unit: 'month', latestKey: '2026-10-01|2026-10-13', baselineKey: 'month:2026-09',
        latestLabel: 'October so far', baselineLabel: 'September' };
    const monthData = cheer.buildCheerData({ comparison: mtd });
    t.equal('a month window compares its own month', monthData.periods.monCur, '2026-10');
    t.equal('against the one before', monthData.periods.monPrev, '2026-09');
    const lastMonth = cheer.buildCheerData({ comparison: { unit: 'month', latestKey: '2026-08-01|2026-08-31' } });
    t.equal('and a month with nothing before it compares nothing', lastMonth.periods.monCur, null);
});
