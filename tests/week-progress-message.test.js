'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/period-index.module.js');
    return t.loadModule('modules/daily-outreach.module.js').dailyOutreach;
}

const STANDINGS = [
    { label: 'Adherence', latestText: '96.2%', baseText: '93.1%' },
    { label: 'AHT', latestText: '7:41', baseText: '8:12' }
];

suite('week progress: leads with this week against last week', (t) => {
    const outreach = load(t);

    const msg = outreach.buildWeekProgressText({
        firstName: 'Alyssa',
        tone: 'midweek',
        daysIn: 3,
        hasBaseline: true,
        standings: STANDINGS,
        improved: [{ label: 'Adherence', deltaText: '+3.1' }, { label: 'AHT', deltaText: '31s faster' }],
        slipped: [],
        focus: { label: 'FCR', valueText: '68.0%', targetText: '73.0%' }
    });

    t.check('it opens by naming the comparison', msg.indexOf('where this week stands next to last week') > -1);
    t.check('it says how far into the week it is', msg.indexOf('(3 days in)') > -1);
    // Each number is said once (Scott, 2026-10-14, on walls of numbers):
    // where they are now, then what moved, in words, underneath.
    t.check('where they are now, each number once', msg.indexOf('Where you are (3 days in): Adherence 96.2% and AHT 7:41.') > -1);
    t.check('improvements are called out by name', msg.indexOf('Better than last week:') > -1);
    t.check('and listed with an "and"', msg.indexOf('Adherence +3.1 and AHT 31s faster') > -1);
    t.check('the growth area names the target', msg.indexOf('FCR is 68.0% against a 73.0% target') > -1);

    // The old midweek note was a nudge with no numbers in it. That was the
    // complaint, so the wording it used must not survive here.
    t.check('no generic midweek filler', !/quick midweek nudge/i.test(msg));
    t.check('and it never claims a rank', !/\b(rank|tier|#\d|top \d)\b/i.test(msg));
});

suite('week progress: Friday closes the week out', (t) => {
    const outreach = load(t);

    const friday = outreach.buildWeekProgressText({
        firstName: 'Alyssa', tone: 'closing', daysIn: 5, hasBaseline: true,
        standings: STANDINGS, improved: [{ label: 'AHT', deltaText: '31s faster' }], slipped: [],
        focus: { label: 'FCR', valueText: '68.0%', targetText: '73.0%' }
    });

    t.check('Friday says it is closing the week', friday.indexOf('Closing out the week') > -1);
    t.check('and reads as landed, not in flight', friday.indexOf('Where you landed') > -1);
    t.check('the growth note points at next week', friday.indexOf('Worth a push next week') > -1);
    t.check('and it signs off for the weekend', friday.indexOf('Have a good weekend') > -1);

    // The Friday message is usually written off a file that stops on Thursday,
    // so the week it describes still has a day in it. Every finished-week claim
    // in the copy has to give way, or the message contradicts the standings
    // block under it, which by then is offering places that are still there to
    // take.
    const stillOpen = outreach.buildWeekProgressText({
        firstName: 'Alyssa', tone: 'closing', daysIn: 4, hasBaseline: true, weekOpen: true,
        standings: STANDINGS, improved: [{ label: 'AHT', deltaText: '31s faster' }], slipped: [],
        focus: { label: 'FCR', valueText: '68.0%', targetText: '73.0%' }
    });

    t.check('an open week is not something that went', stillOpen.indexOf('how it is going') > -1);
    t.check('and nothing in it already went', stillOpen.indexOf('how it went') === -1);
    t.check('nobody has landed yet', stillOpen.indexOf('Where you landed') === -1);
    t.check('they are standing in it', stillOpen.indexOf('Where you stand (4 days in)') > -1);
    t.check('and the push is for the day that is left', stillOpen.indexOf('Worth a push:') > -1);
    t.check('rather than for next week', stillOpen.indexOf('Worth a push next week') === -1);
    t.check('it still closes the week out', stillOpen.indexOf('Closing out the week') > -1);
    t.check('and still sends them into the weekend', stillOpen.indexOf('Have a good weekend') > -1);

    // A week with no days left in it keeps the finished wording, which is the
    // half of the rule a later edit is most likely to drop.
    t.check('the flag is what moved it, not the tone',
        outreach.buildWeekProgressText({
            firstName: 'Alyssa', tone: 'closing', daysIn: 5, hasBaseline: true, weekOpen: false,
            standings: STANDINGS, improved: [], slipped: [], focus: null
        }).indexOf('Where you landed') > -1);

    const midweek = outreach.buildWeekProgressText({
        firstName: 'Alyssa', tone: 'midweek', daysIn: 3, hasBaseline: true,
        standings: STANDINGS, improved: [], slipped: [], focus: null
    });
    t.check('midweek does not sign off for the weekend', midweek.indexOf('Have a good weekend') === -1);
    t.check('it promises another check instead', midweek.indexOf('check back before the week is out') > -1);
});

suite('week progress: honest when nothing moved, or nothing is comparable', (t) => {
    const outreach = load(t);

    const steady = outreach.buildWeekProgressText({
        firstName: 'Sam', tone: 'midweek', daysIn: 2, hasBaseline: true,
        standings: STANDINGS, improved: [], slipped: [], focus: null
    });
    t.check('a flat week is called steady rather than dressed up', steady.indexOf('Holding steady') > -1);

    const slid = outreach.buildWeekProgressText({
        firstName: 'Sam', tone: 'midweek', daysIn: 2, hasBaseline: true,
        standings: STANDINGS, improved: [], slipped: [{ label: 'FCR', deltaText: '-4.0' }], focus: null
    });
    t.check('a dip is named, not hidden', slid.indexOf('Slid a little: FCR -4.0') > -1);
    t.check('and a week with a dip is not also called steady', slid.indexOf('Holding steady') === -1);

    // No last week to compare against: report position, drop the comparison.
    const noBaseline = outreach.buildWeekProgressText({
        firstName: 'Sam', tone: 'midweek', daysIn: 1, hasBaseline: false,
        standings: [{ label: 'Adherence', latestText: '96.2%', baseText: '' }], improved: [], slipped: [], focus: null
    });
    t.check('it still reports where they are', noBaseline.indexOf('Adherence 96.2%') > -1);
    t.check('without inventing a last week', noBaseline.indexOf('was ') === -1);

    // No numbers at all is still a message: an opener, the effort, and the
    // sign-off. What it no longer does is explain the data to the associate
    // ("Not enough in yet to put numbers on this week"), which is a
    // disclaimer, and those stay out of associate copy.
    const nothing = outreach.buildWeekProgressText({
        firstName: 'Sam', tone: 'midweek', daysIn: 0, hasBaseline: false,
        standings: [], improved: [], slipped: [], focus: null
    });
    t.check('with no numbers at all it still writes to them', nothing.indexOf('Hey Sam!') === 0);
    t.check('and thanks them for the effort', /effort|showing up/.test(nothing));
    t.check('with no remark about the data', !/Not enough in yet|scorecard|file|upload/i.test(nothing));
});

suite('week progress: never calls last week "this week"', (t) => {
    const outreach = load(t);

    // With no week-in-progress file the newest weekly upload is last week's.
    // Labelling that "this week" would be a plain misstatement, so the framing
    // has to change rather than the numbers being quietly relabelled.
    const stale = outreach.buildWeekProgressText({
        firstName: 'Alyssa', tone: 'midweek', daysIn: 0, hasBaseline: true, thisWeek: false,
        standings: STANDINGS, improved: [], slipped: [], focus: null
    });
    // Named plainly, with no remark about what has or has not been
    // uploaded: that is a disclaimer, and associate copy carries none.
    t.check('it names the week it is about', stale.indexOf('Here\'s how last week went, next to the week before.') > -1);
    t.check('with no remark about files', !/file|landed in|uploaded/i.test(stale));
    t.check('and calls the numbers last week\'s, not this week\'s', stale.indexOf('Last week: Adherence 96.2%') > -1);
    t.check('so it never claims to be where you are now', stale.indexOf('Where you are') === -1);

    const fresh = outreach.buildWeekProgressText({
        firstName: 'Alyssa', tone: 'midweek', daysIn: 3, hasBaseline: true, thisWeek: true,
        standings: STANDINGS, improved: [], slipped: [], focus: null
    });
    t.check('with a current file it does say this week', fresh.indexOf('where this week stands') > -1);
    t.check('and reports where you are', fresh.indexOf('Where you are') > -1);

    // Omitting the flag entirely must mean "this week", so the common path
    // does not need to remember to pass it.
    const defaulted = outreach.buildWeekProgressText({
        firstName: 'Alyssa', tone: 'midweek', daysIn: 3, hasBaseline: true,
        standings: STANDINGS, improved: [], slipped: [], focus: null
    });
    t.check('the default framing is this week', defaulted.indexOf('where this week stands') > -1);

    const staleFriday = outreach.buildWeekProgressText({
        firstName: 'Alyssa', tone: 'closing', daysIn: 0, hasBaseline: true, thisWeek: false,
        standings: STANDINGS, improved: [], slipped: [], focus: null
    });
    t.check('Friday names it plainly too', staleFriday.indexOf('Closing out the week with a look at how last week went, next to the week before.') > -1);
    t.check('with no remark about files either', !/file|newest full week/i.test(staleFriday));
});

suite('week progress: list wording holds up at every length', (t) => {
    const outreach = load(t);

    t.equal('one item stands alone', outreach.joinList(['a']), 'a');
    t.equal('two items get an "and"', outreach.joinList(['a', 'b']), 'a and b');
    t.equal('three items get commas and an "and"', outreach.joinList(['a', 'b', 'c']), 'a, b, and c');
    t.equal('nothing yields nothing', outreach.joinList([]), '');
});

/**
 * PRAISE FIRST, MOVES IN WORDS, SLIDES ONLY WHERE THEY MATTER
 *
 * Scott, 2026-10-14, on the Wednesday round: the #1 person in the center got
 * nothing but numbers, "Up from last week: After Call Work -19s" read as a
 * drop, and "Slid a little: Hold Time +6s" went to somebody at 11s against a
 * 30s target.
 */
suite('week progress: praise leads, before any numbers', (t) => {
    const outreach = load(t);
    const sweep = outreach.buildWeekProgressText({
        firstName: 'Kristin', tone: 'midweek', daysIn: 2, hasBaseline: true,
        standings: STANDINGS, improved: [], slipped: [], focus: null,
        wins: [{ label: 'Average Handle Time', valueText: '398s' }, { label: 'Schedule Adherence', valueText: '97.4%' }],
        goalCount: 2, allOnTarget: true
    });
    const blocks = sweep.split('\n\n');
    t.check('the line after the opener is praise', /clean sweep|as good as it gets/.test(blocks[1]));
    t.check('and the numbers come after it', blocks.findIndex(b => b.indexOf('Where you are') === 0) > 1);

    const some = outreach.buildWeekProgressText({
        firstName: 'Ana', tone: 'midweek', daysIn: 2, hasBaseline: true,
        standings: STANDINGS, improved: [], slipped: [], focus: null,
        wins: ['A', 'B', 'C', 'D', 'E'].map(l => ({ label: l, valueText: '1%' })), goalCount: 9, allOnTarget: false
    });
    t.check('two wins are named', some.indexOf('A at 1%, B at 1%') > -1);
    t.check('and the rest are counted, not listed', some.indexOf('and 3 more goals on target') > -1 && some.indexOf('C at') === -1);
});

suite('week progress: the focus reads with the right article', (t) => {
    const outreach = load(t);
    const msg = outreach.buildWeekProgressText({
        firstName: 'Sam', tone: 'midweek', daysIn: 2, hasBaseline: true,
        standings: STANDINGS, improved: [], slipped: [],
        focus: { label: 'Rep Satisfaction', valueText: '75%', targetText: '82%' }
    });
    t.check('an 82% target', msg.indexOf('against an 82% target') > -1);
    t.check('never "a 82%"', msg.indexOf('a 82%') === -1);
});

function pulseFor(t, empLatest, empBase, metrics) {
    t.installFakeBrowser();
    t.pinClock('2026-10-14');
    global.weeklyData = {
        '2026-10-05|2026-10-09': { metadata: { periodType: 'week', startDate: '2026-10-05', endDate: '2026-10-09' }, employees: [empBase] },
        '2026-10-12|2026-10-13': { metadata: { periodType: 'week-in-progress', startDate: '2026-10-12', endDate: '2026-10-13' }, employees: [empLatest] }
    };
    global.ytdData = {};
    global.dailyData = {};
    const registry = t.loadModule('modules/metrics-registry.module.js');
    global.isReverseMetric = registry.metricsRegistryHelpers.isReverseMetric;
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.metricDelta = (key, latest, base) => (global.isReverseMetric(key) ? base - latest : latest - base);
    global.window.analyzeTrendMetrics = () => ({ allMetrics: metrics });
    t.loadModule('modules/period-index.module.js');
    t.loadModule('modules/message-voice.module.js');
    t.loadModule('modules/daily-outreach.module.js');
    return t.loadModule('modules/morning-pulse.module.js').morningPulse;
}

const M = (metricKey, label, value, target, type, meets) => ({
    metricKey, label, employeeValue: value, target, targetType: type, meetsTarget: meets,
    classification: meets ? 'On Track' : 'Needs Focus', gapFromTarget: meets ? 0 : Math.abs(value - target)
});

suite('week progress: zero surveys, moves in words, slides only under target', async (t) => {
    const base = { name: 'Lupe Garcia', totalCalls: 200, surveyTotal: 0, aht: 628, acw: 49, holdTime: 5, scheduleAdherence: 87.1, cxRepOverall: 0 };
    const latest = { name: 'Lupe Garcia', totalCalls: 180, surveyTotal: 0, aht: 604, acw: 30, holdTime: 11, scheduleAdherence: 88.2, cxRepOverall: 0 };
    const pulse = pulseFor(t, latest, base, [
        M('aht', 'Average Handle Time', 604, 426, 'max', false),
        M('acw', 'After Call Work', 30, 60, 'max', true),
        M('holdTime', 'Hold Time', 11, 30, 'max', true),
        M('scheduleAdherence', 'Schedule Adherence', 88.2, 93, 'min', false),
        M('cxRepOverall', 'Rep Satisfaction', 0, 82, 'min', false)
    ]);
    const out = [];
    for (let i = 0; i < 40; i++) {
        out.push(await pulse.generateWeekProgressMessage('Lupe Garcia', '2026-10-12|2026-10-13', '2026-10-05|2026-10-09',
            { tone: 'midweek', daysIn: 2, latestIsThisWeek: true }));
    }
    t.equal('nobody surveyed, so rep satisfaction is never named', out.filter(m => /Rep Satisfaction/.test(m)).length, 0);
    t.equal('and no zero goes out', out.filter(m => /\b0(\.0)?%/.test(m)).length, 0);
    t.check('an improvement is said in words', out.every(m => m.indexOf('After Call Work down 19 seconds') > -1));
    t.equal('never with a minus sign', out.filter(m => /-\d+s\b/.test(m)).length, 0);
    t.equal('hold time at 11s against 30s is not called a slide', out.filter(m => /Slid a little[^\n]*Hold Time/.test(m)).length, 0);
    t.check('the focus is a metric short of target', out.every(m => /Worth a push: (Average Handle Time|Schedule Adherence)/.test(m)));
    t.check('two emojis at most', out.every(m => (m.match(/\p{Extended_Pictographic}/gu) || []).length <= 2));
});
