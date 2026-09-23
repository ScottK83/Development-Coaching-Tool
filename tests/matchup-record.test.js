'use strict';

const { suite } = require('./harness');

/**
 * The Record column is a round robin, not a spoke.
 *
 * It used to compare My Team against each rival and nothing else, so My Team's
 * record ran over every rival while every rival's record ran over My Team
 * alone. Seven rivals and five metrics gave My Team up to thirty five
 * comparisons and each rival at most five, and the two were printed in the same
 * column of the same table as though they meant the same thing.
 *
 * That column reads like evidence. A supervisor comparing their 22W-13L to a
 * rival's 3W-2L is reading two different denominators as one scale.
 */

const MY_TEAM = 'My Team';

// Three teams, all fully measured so all of them place, ranked plainly by each
// metric: A beats B beats C on every one.
const TEAMS = {
    'My Team': { aht: 400, adherence: 96, sentiment: 92, associateOverall: 88 },
    'Rival One': { aht: 420, adherence: 94, sentiment: 90, associateOverall: 85 },
    'Rival Two': { aht: 440, adherence: 92, sentiment: 88, associateOverall: 82 }
};

function rec(name, values) {
    return {
        name,
        ratingAverage: 2.5,
        measuredCount: 5,
        rank: 10,
        compositeScore: 10,
        totalCalls: 1200,
        surveyTotal: 20,
        reliability: 4,
        values
    };
}

const RANKINGS = [];
const SUPERVISORS = {};
Object.keys(TEAMS).forEach((team) => {
    // Ten members apiece, comfortably over the floor that withholds a placing.
    for (let i = 0; i < 10; i++) {
        const name = team + ' ' + i;
        RANKINGS.push(rec(name, TEAMS[team]));
        SUPERVISORS[name] = team;
    }
});

function load(t, rankings, supervisors) {
    t.installFakeBrowser();
    global.window.DevCoachModules.storage = {
        readStore: (key) => (key === 'employeeSupervisors' ? (supervisors || SUPERVISORS) : {})
    };
    global.window.DevCoachModules.centerRanking = {
        buildCenterRankings: () => ({
            rankings: (rankings || RANKINGS).slice(),
            totalEmployees: (rankings || RANKINGS).length,
            source: 'test period'
        })
    };
    return t.loadModule('modules/matchup.module.js').matchup;
}

suite('matchup: every team plays every other team', (t) => {
    const data = load(t).buildMatchupData(null);
    const stats = data.teamStats;

    const mine = stats[MY_TEAM];
    const one = stats['Rival One'];
    const two = stats['Rival Two'];
    t.check('all three teams are built', !!mine && !!one && !!two);
    if (!mine || !one || !two) return;

    // Five metrics, two opponents each, so every team plays exactly ten
    // comparisons. That equality IS the fix.
    const played = (s) => s.wins + s.losses + s.ties;
    t.equal('my team played ten', played(mine), 10);
    t.equal('and so did the first rival', played(one), 10);
    t.equal('and the second', played(two), 10);

    t.equal('each team is told how many opponents stood behind it', mine.opponents, 2);
    t.equal('the same number for everyone', one.opponents, 2);

    // Reliability is summed per team and every member carries the same four
    // hours, so that metric ties for everybody and the other four decide it.
    t.equal('the tied metric ties for all three', mine.ties, 2);
    t.equal('the strongest team wins the rest', mine.wins, 8);
    t.equal('and loses none', mine.losses, 0);
    // Middle team: beats the weakest on four, loses to the strongest on four.
    t.equal('the middle team splits', one.wins, 4);
    t.equal('evenly', one.losses, 4);
    t.equal('and the weakest wins nothing', two.wins, 0);
    t.equal('losing every decided one', two.losses, 8);

    // The whole point: totals reconcile. Every win is somebody's loss.
    const wins = mine.wins + one.wins + two.wins;
    const losses = mine.losses + one.losses + two.losses;
    t.equal('wins and losses balance across the field', wins, losses);
});

suite('matchup: a rival is not measured against my team alone', (t) => {
    const data = load(t).buildMatchupData(null);
    const one = data.teamStats['Rival One'];

    // Against My Team only, Rival One loses all four and wins nothing. Its
    // real record is 4-4, because it beats Rival Two on all four. A record
    // that only ever counted My Team would read 0W-4L.
    t.check('the rival has wins of its own', one.wins > 0);
    t.equal('four of them, from the team below it', one.wins, 4);
    t.equal('and it lost four to the team above', one.losses, 4);
});

suite('matchup: a team too thin to place carries no record', (t) => {
    // Two solid teams and one where nobody has a complete scorecard.
    const rankings = RANKINGS.filter((r) => !r.name.startsWith('Rival Two'));
    const supervisors = {};
    rankings.forEach((r) => { supervisors[r.name] = SUPERVISORS[r.name]; });

    for (let i = 0; i < 3; i++) {
        const name = 'Thin Team ' + i;
        // Two measured KPIs apiece, which is what the placing floor refuses.
        rankings.push(Object.assign(rec(name, TEAMS['My Team']), { measuredCount: 2 }));
        supervisors[name] = 'Thin Team';
    }

    const data = load(t, rankings, supervisors).buildMatchupData(null);
    const thin = data.teamStats['Thin Team'];
    t.check('the thin team exists', !!thin);
    if (!thin) return;

    t.equal('it is not rankable', thin.rankable, false);
    // It sits the round robin out rather than being beaten by everybody on the
    // strength of two measured KPIs, which is the same refusal the placing
    // already makes.
    t.equal('so it played nothing', thin.wins + thin.losses + thin.ties, 0);
    t.equal('and no opponents are claimed for it', thin.opponents, 0);

    // And the teams that did play still only played each other.
    const mine = data.teamStats[MY_TEAM];
    t.equal('the placed teams have one opponent each', mine.opponents, 1);
    t.equal('so five comparisons apiece', mine.wins + mine.losses + mine.ties, 5);
});
