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
