'use strict';

const { suite } = require('./harness');

// A minimal stand-in for centerRanking: two people on my team, each holding a
// rank-1 metric, so both would be celebrated if nothing narrowed the list.
function fakeRankings() {
    return {
        periodKey: '2026-07-27|2026-08-02',
        totalEmployees: 126,
        teamMembers: new Set(['Oceane Ingram', 'Alyssa Dimes']),
        rankings: [
            { name: 'Oceane Ingram', rank: 1, metricRanks: { adherence: 1 }, values: { adherence: 99.1 } },
            { name: 'Alyssa Dimes', rank: 2, metricRanks: { fcr: 2 }, values: { fcr: 88 } }
        ]
    };
}

function load(t, activeMember) {
    t.installFakeBrowser();
    global.window.DevCoachModules.centerRanking = {
        buildCenterRankings: fakeRankings,
        buildRankingsForPeriod: fakeRankings
    };
    global.window.DevCoachModules.teamScope = {
        isInScope: (name) => !activeMember || name === activeMember
    };
    return t.loadModule('modules/celebrations.module.js').celebrations;
}

suite('celebrations: follow the My Team picker', (t) => {
    const everyone = load(t, null).detectCelebrations('2026-07-27|2026-08-02');
    const names = everyone.celebrations.map(c => c.name);

    t.check('with everyone picked, the whole team is eligible', names.length >= 2);
    t.check('including Oceane', names.indexOf('Oceane Ingram') > -1);
    t.check('and Alyssa', names.indexOf('Alyssa Dimes') > -1);
});

suite('celebrations: picking one person shows only their wins', (t) => {
    const justOceane = load(t, 'Oceane Ingram').detectCelebrations('2026-07-27|2026-08-02');
    const names = justOceane.celebrations.map(c => c.name);

    t.equal('only the picked person is celebrated', names.length, 1);
    t.equal('and it is the right one', names[0], 'Oceane Ingram');
    t.check('the teammate is left out', names.indexOf('Alyssa Dimes') === -1);
});

suite('celebrations: says why someone came up empty', (t) => {
    const celebrations = load(t, null);
    const tiers = [1, 5, 10];

    const data = {
        totalEmployees: 126,
        teamMembers: new Set(['Near Miss', 'Withheld', 'Off The Board']),
        rankings: [
            // 4 off the top-10 bar — the most common case, and the one a blank
            // screen misrepresents worst.
            { name: 'Near Miss', metricRanks: { adherence: 14, fcr: 40 }, values: { adherence: 91 }, extraValues: { fcr: 70 } },
            // Ranks well but the number never made it through the survey floor.
            { name: 'Withheld', metricRanks: { fcr: 3 }, values: {}, extraValues: { fcr: null } }
        ]
    };

    const nearMiss = celebrations.explainNoCelebration(data, 'Near Miss', tiers);
    t.equal('a near miss is reported as below the bar', nearMiss.reason, 'belowBar');
    t.equal('with their best rank, not their worst', nearMiss.best.rank, 14);
    t.equal('named by metric', nearMiss.best.label, 'Schedule Adherence');
    t.equal('and how far off the bar they were', nearMiss.shortBy, 4);
    t.check('the wording says the number out loud', describeHas(celebrations, nearMiss, '#14'));
    t.check('and names the bar', describeHas(celebrations, nearMiss, 'top 10'));

    const withheld = celebrations.explainNoCelebration(data, 'Withheld', tiers);
    t.equal('a qualifying rank with no value is called out separately', withheld.reason, 'valueWithheld');
    t.check('and explains the survey floor', describeHas(celebrations, withheld, 'surveys'));

    const missing = celebrations.explainNoCelebration(data, 'Off The Board', tiers);
    t.equal('someone absent from the rankings is its own reason', missing.reason, 'notRanked');
    t.check('and says nothing was scoreable', describeHas(celebrations, missing, 'scoreable'));

    // The three used to render as one identical blank screen.
    const reasons = new Set([nearMiss.reason, withheld.reason, missing.reason]);
    t.equal('three distinct silences, three distinct answers', reasons.size, 3);
});

function describeHas(celebrations, info, needle) {
    return celebrations.describeNoCelebration(info).indexOf(needle) > -1;
}

suite('celebrations: the miss list rides along with the result', (t) => {
    const celebrations = load(t, 'Alyssa Dimes');
    const result = celebrations.detectCelebrations('2026-07-27|2026-08-02');

    t.check('a result always carries a miss list', Array.isArray(result.missed));
    // Alyssa is celebrated in the fixture, and Oceane is out of scope, so
    // nobody should be listed as having missed.
    t.equal('someone who was celebrated is not also listed as missing', result.missed.length, 0);

    const wholeTeam = load(t, null).detectCelebrations('2026-07-27|2026-08-02');
    t.check('with everyone in scope, celebrated people stay off the miss list',
        wholeTeam.missed.every(info => info.name !== 'Oceane Ingram' && info.name !== 'Alyssa Dimes'));
});

suite('celebrations: still works when nothing has set a scope', (t) => {
    t.installFakeBrowser();
    global.window.DevCoachModules.centerRanking = {
        buildCenterRankings: fakeRankings,
        buildRankingsForPeriod: fakeRankings
    };
    // No teamScope module at all — an older saved page, or a load-order slip.
    const celebrations = t.loadModule('modules/celebrations.module.js').celebrations;
    const result = celebrations.detectCelebrations('2026-07-27|2026-08-02');

    t.check('no scope module means no narrowing, not a crash', result.celebrations.length >= 2);
});
