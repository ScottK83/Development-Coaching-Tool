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
    t.check('every number is paired with last week', msg.indexOf('Adherence 96.2%, was 93.1%') > -1);
    t.check('improvements are called out by name', msg.indexOf('Up from last week') > -1);
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

    const nothing = outreach.buildWeekProgressText({
        firstName: 'Sam', tone: 'midweek', daysIn: 0, hasBaseline: false,
        standings: [], improved: [], slipped: [], focus: null
    });
    t.check('with no numbers at all it says so', nothing.indexOf('Not enough in yet') > -1);
    t.check('and does not pretend to be a scorecard', nothing.indexOf('rather than a scorecard') > -1);
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
    t.check('it says this week has not landed yet', stale.indexOf('has not landed in a file yet') > -1);
    t.check('and calls the numbers a full week, not this week', stale.indexOf('Most recent full week') > -1);
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
    t.check('Friday is honest about it too', staleFriday.indexOf('newest full week is still the one before') > -1);
});

suite('week progress: list wording holds up at every length', (t) => {
    const outreach = load(t);

    t.equal('one item stands alone', outreach.joinList(['a']), 'a');
    t.equal('two items get an "and"', outreach.joinList(['a', 'b']), 'a and b');
    t.equal('three items get commas and an "and"', outreach.joinList(['a', 'b', 'c']), 'a, b, and c');
    t.equal('nothing yields nothing', outreach.joinList([]), '');
});
