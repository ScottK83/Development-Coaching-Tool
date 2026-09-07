'use strict';

const { suite } = require('./harness');

/**
 * What a team's placing is allowed to be built on.
 *
 * A member's KPI score is their point total over the KPIs they were actually
 * measured on, so a member measured on two KPIs, both Exceeds, scores 3.00,
 * exactly like a member who hit all five. The scale floor is 1, so losing a KPI
 * you were about to fail raises your score. Averaged by head, that handed the
 * Team Power Rankings to whichever supervisor had the least data, which is how
 * the weakest team on the floor came to be printed first.
 *
 * center-ranking already refuses to let a thin record set an individual placing.
 * These pin the same refusal at team level, and the two things that follow from
 * it: a team with too few complete scorecards is shown without a place rather
 * than competing for first, and anybody who matched no supervisor is named
 * instead of quietly leaving their team's average.
 */

// 4 thin records at the 3.00 ceiling on two measured KPIs each, over 8 genuinely
// weak but fully measured members. Unfiltered this averages 2.333 and takes
// first place. On complete scorecards only it is 2.000, which is the truth.
const THIN_TEAM = 'Thin Team';
// Every member fully measured and mediocre. Loses on the old maths, wins on the new.
const SOLID_TEAM = 'Solid Team';
// The best Avg Score of the three and far too few members to place on it.
const SMALL_TEAM = 'Small Team';

function rec(name, ratingAverage, measuredCount, rank) {
    return {
        name,
        ratingAverage,
        measuredCount,
        rank,
        compositeScore: rank,
        totalCalls: 1200,
        surveyTotal: 8,
        reliability: 4,
        values: { aht: 400, adherence: 94, sentiment: 88, associateOverall: 84 }
    };
}

const RANKINGS = [];
const SUPERVISORS = {};

function push(team, list) {
    list.forEach((r) => { RANKINGS.push(r); SUPERVISORS[r.name] = team; });
}

push(THIN_TEAM, [
    rec('Thin A', 3.00, 2, 51), rec('Thin B', 3.00, 2, 52),
    rec('Thin C', 3.00, 2, 53), rec('Thin D', 3.00, 2, 54),
    rec('Weak A', 2.00, 5, 40), rec('Weak B', 2.00, 5, 41),
    rec('Weak C', 2.00, 5, 42), rec('Weak D', 2.00, 5, 43),
    rec('Weak E', 2.00, 5, 44), rec('Weak F', 2.00, 5, 45),
    rec('Weak G', 2.00, 5, 46), rec('Weak H', 2.00, 5, 47)
]);
push(SOLID_TEAM, Array.from({ length: 10 }, (_, i) => rec('Solid ' + i, 2.20, 5, 10 + i)));
push(SMALL_TEAM, Array.from({ length: 5 }, (_, i) => rec('Small ' + i, 2.90, 5, 1 + i)));

// Two people the name matcher never placed. They carry no supervisor, so they
// belong to no team and cannot be seen in any average.
const ORPHANS = [rec('Orphan One', 1.10, 5, 60), rec('Orphan Two', 1.20, 5, 59)];
ORPHANS.forEach((r) => RANKINGS.push(r));

function load(t) {
    t.installFakeBrowser();
    global.window.DevCoachModules.storage = {
        readStore: (key) => (key === 'employeeSupervisors' ? SUPERVISORS : {})
    };
    global.window.DevCoachModules.centerRanking = {
        buildCenterRankings: () => ({
            rankings: RANKINGS.slice(),
            totalEmployees: RANKINGS.length,
            source: 'test period'
        })
    };
    return t.loadModule('modules/matchup.module.js').matchup;
}

suite('matchup rankings: a thin record cannot carry a team', (t) => {
    const data = load(t).buildMatchupData(null);
    const thin = data.teamStats[THIN_TEAM];

    // Unfiltered this team averages (4*3.00 + 8*2.00)/12 = 2.333. On complete
    // scorecards only it is 16/8 = 2.000. The gap is the whole bug.
    t.equal('the standing is built on complete scorecards only', thin.avgRating.toFixed(3), '2.000');
    t.equal('the members that carried it are counted', thin.thinCount, 4);
    t.equal('and the ones that count are counted', thin.scoredCount, 8);
    t.equal('the headcount is still the headcount', thin.count, 12);

    // Avg Rank is on the same footing, or the two columns would describe
    // different groups of people in the same row.
    t.equal('avg rank uses the same members', thin.totalComposite.toFixed(1), '43.5');
});

suite('matchup rankings: full scorecards beat thin ones', (t) => {
    const matchup = load(t);
    const data = matchup.buildMatchupData(null);

    // The complaint, in one assertion. Thin Team wins on the old maths at 2.333
    // against Solid Team's 2.200 while being worse at everything measured.
    t.check('the mediocre but fully measured team scores higher',
        data.teamStats[SOLID_TEAM].avgRating > data.teamStats[THIN_TEAM].avgRating);

    // Scoped to the table body: the caveat banner above it names teams too, and
    // matching there would pass regardless of how the rows are ordered.
    const body = matchup.renderTeamRankings(data).split('<tbody>')[1];
    t.check('and is printed first', body.indexOf(SOLID_TEAM) < body.indexOf(THIN_TEAM));
});

suite('matchup rankings: too few scorecards means no placing', (t) => {
    const matchup = load(t);
    const data = matchup.buildMatchupData(null);

    // Small Team has the best Avg Score of the three at 2.90 and five members to
    // support it. A mean over five swings on one person, so it is shown and not
    // placed rather than handed first.
    t.check('it has the best score', data.teamStats[SMALL_TEAM].avgRating > data.teamStats[SOLID_TEAM].avgRating);
    t.check('and is still not rankable', data.teamStats[SMALL_TEAM].rankable === false);
    t.check('a team with enough scorecards is rankable', data.teamStats[SOLID_TEAM].rankable === true);
    t.check('a team scraping the floor is rankable', data.teamStats[THIN_TEAM].rankable === true);

    const html = matchup.renderTeamRankings(data);
    const body = html.split('<tbody>')[1];
    t.check('it is not given a number', body.includes('not ranked'));
    t.check('it sorts below the placed teams', body.indexOf(SMALL_TEAM) > body.indexOf(THIN_TEAM));
    t.check('it is still shown', body.includes(SMALL_TEAM));
    t.check('the reason is given', html.includes('fewer than 8 complete scorecards'));
});

suite('matchup rankings: unmatched associates are named, not swallowed', (t) => {
    const matchup = load(t);
    const data = matchup.buildMatchupData(null);

    t.equal('they land in Unassigned', data.teams.Unassigned.length, 2);
    t.check('and in no supervisor team',
        !Object.keys(data.teamStats).some((n) => n !== 'Unassigned' && data.teams[n].some((r) => r.name.startsWith('Orphan'))));

    const html = matchup.renderTeamRankings(data);
    t.check('Unassigned is not a competing row', !html.includes('>Unassigned<'));

    // The point: they are excluded from every average, so saying who they are is
    // the difference between a number you can check and one you cannot.
    t.check('they are named above the table', html.includes('Orphan One') && html.includes('Orphan Two'));
    t.check('the count is stated', html.includes('2 scored associates matched no supervisor'));
    t.check('and where to fix it', html.includes('Settings, Team Members'));
});

suite('matchup rankings: the table says what it left out', (t) => {
    const matchup = load(t);
    const html = matchup.renderTeamRankings(matchup.buildMatchupData(null));

    t.check('the thin exclusions are counted', html.includes('4 associates were scored on fewer than 4 of the 5 KPIs'));
    t.check('why a missing KPI flatters is explained', html.includes('dropped rather than failed'));
    t.check('coverage shows in the row', html.includes('8 of 12') && html.includes('4 too thin'));

    // A team with nothing left out reads as a plain headcount. A coverage note on
    // every row is a note nobody reads.
    const solidRow = html.split('<tbody>')[1].slice(html.split('<tbody>')[1].indexOf(SOLID_TEAM));
    t.check('a clean team is not annotated', !solidRow.slice(0, 400).includes('too thin'));
});

suite('matchup rankings: nothing to caveat means no banner', (t) => {
    const matchup = load(t);
    const data = matchup.buildMatchupData(null);

    delete data.teams.Unassigned;
    data.teamNames = [SOLID_TEAM];
    const clean = matchup.renderTeamRankings(data);

    t.check('no unmatched warning', !clean.includes('matched no supervisor'));
    t.check('no thin warning', !clean.includes('too thin'));
    t.check('no unranked warning', !clean.includes('not ranked'));
    t.check('the table still renders', clean.includes('Team Power Rankings') && clean.includes(SOLID_TEAM));
});
