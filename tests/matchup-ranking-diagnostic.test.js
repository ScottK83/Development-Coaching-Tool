'use strict';

const { suite } = require('./harness');

/**
 * The diagnostic exists to answer one question out loud: why is this team top?
 *
 * Avg Score is a plain average of per-member KPI scores, and a member's KPI
 * score is their point total over the KPIs they were actually measured on. A
 * member measured on two KPIs, both Exceeds, scores 3.00, exactly like a member
 * who hit all five. So a team can lead on Avg Score by having less data rather
 * than better numbers, and nothing in the table above says so.
 *
 * What is asserted here is that the panel actually surfaces the three things
 * that move the sort and are otherwise invisible: thin records scoring at the
 * ceiling, scored associates carrying no supervisor label, and rostered people
 * whose name never matched the uploads.
 */

const ROSTER = [
    { supervisor: 'Sarah Gregory', agents: ['Thin One', 'Thin Two', 'Solid One', 'Never Matched'] },
    { supervisor: 'Kathy Cruz', agents: ['Full One', 'Full Two'] }
];

const SUPERVISORS = {
    'Thin One': 'Sarah Gregory',
    'Thin Two': 'Sarah Gregory',
    'Solid One': 'Sarah Gregory',
    'Full One': 'Kathy Cruz',
    'Full Two': 'Kathy Cruz'
};

function member(name, ratingAverage, measuredCount, rank, totalCalls) {
    return { name, ratingAverage, measuredCount, rank, totalCalls, surveyTotal: 6 };
}

/* Sarah's team wins on Avg Score while holding the three worst centre ranks in
   it, and its two perfect scores are both on two measured KPIs and almost no
   calls. That is the whole shape of the complaint, built small enough to do the
   arithmetic by hand: her Avg Score is 2.533 against Kathy's 2.500, and once the
   same members are weighted by the calls they actually took she is at 1.68. */
const SARAH = [
    member('Thin One', 3.00, 2, 60, 120),
    member('Thin Two', 3.00, 2, 58, 150),
    member('Solid One', 1.60, 5, 55, 4200)
];
const KATHY = [
    member('Full One', 2.60, 5, 3, 2000),
    member('Full Two', 2.40, 5, 8, 2200)
];
const ORPHANS = [member('Dropped Rep', 1.20, 5, 61, 3100)];

function avg(list) {
    return list.reduce((a, r) => a + r.ratingAverage, 0) / list.length;
}
function avgRank(list) {
    return list.reduce((a, r) => a + r.rank, 0) / list.length;
}

const DATA = {
    teamNames: ['Sarah Gregory', 'Kathy Cruz', 'Unassigned'],
    teams: { 'Sarah Gregory': SARAH, 'Kathy Cruz': KATHY, Unassigned: ORPHANS },
    teamStats: {
        'Sarah Gregory': { name: 'Sarah Gregory', avgRating: avg(SARAH), totalComposite: avgRank(SARAH) },
        'Kathy Cruz': { name: 'Kathy Cruz', avgRating: avg(KATHY), totalComposite: avgRank(KATHY) },
        Unassigned: { name: 'Unassigned', avgRating: avg(ORPHANS), totalComposite: avgRank(ORPHANS) }
    },
    totalEmployees: 61
};

function load(t, data) {
    t.installFakeBrowser({ SUPERVISOR_ROSTER: ROSTER });
    global.window.DevCoachModules.storage = {
        readStore: (key) => (key === 'employeeSupervisors' ? SUPERVISORS : {})
    };
    const matchup = t.loadModule('modules/matchup.module.js').matchup;
    return matchup.renderRankingDiagnostic(data || DATA);
}

suite('matchup diagnostic: the thin records that carry the top team are named', (t) => {
    const html = load(t);

    // The premise. If Sarah were not top of the Avg Score order the panel would
    // be explaining the wrong team and every assertion below would be hollow.
    t.check('Sarah is the team being explained', html.includes('Sarah Gregory, member by member'));

    t.check('Kathy is not the team being explained', !html.includes('Kathy Cruz, member by member'));
    t.check('the thin members are listed', html.includes('Thin One') && html.includes('Thin Two'));
    t.check('their measured count is spelled out', html.includes('2 of 5'));
    t.check('the fully measured member is there too', html.includes('Solid One'));
    t.check('and their centre rank travels with them', html.includes('#60 of 61'));
});

suite('matchup diagnostic: thin-and-perfect is counted per team', (t) => {
    const html = load(t);

    // Two members at 3.00 on two KPIs each. The count has to appear against
    // Sarah and not against a team that earned its number on full scorecards.
    const sarahRow = html.slice(html.indexOf('Sarah Gregory'), html.indexOf('Kathy Cruz'));
    t.check('Sarah carries two thin perfect scores', sarahRow.includes('font-weight: bold;">2</span>'));
    t.check('the column is explained rather than left as a number',
        html.includes('Thin and perfect') && html.includes('partial evidence'));
    t.check('the floor it uses is stated', html.includes('fewer than 4'));
});

suite('matchup diagnostic: associates in nobody average are surfaced', (t) => {
    const html = load(t);

    t.check('the orphan is named', html.includes('Dropped Rep'));
    t.check('the count is stated', html.includes('1 scored associate'));
    t.check('and it reads singular for one', !html.includes('1 scored associates'));

    // The point of the section, said plainly: a team can look good because the
    // people dragging it are not being counted against it.
    t.check('it says what that does to the averages',
        html.includes('sit in nobody') && html.includes('members that did match'));
});

suite('matchup diagnostic: a clean roster says so instead of showing an empty table', (t) => {
    const clean = JSON.parse(JSON.stringify(DATA));
    delete clean.teams.Unassigned;
    clean.teamNames = ['Sarah Gregory', 'Kathy Cruz'];
    const html = load(t, clean);

    t.check('the empty case is stated', html.includes('Every scored associate carries a supervisor label'));
    t.check('no orphan is invented', !html.includes('Dropped Rep'));
});

suite('matchup diagnostic: the roster gap is reported per supervisor', (t) => {
    const html = load(t);

    // Never Matched is on Sarah's roster and in no upload, so she is short one.
    // Kathy's roster is fully matched and must not be flagged.
    t.check('the unmatched count shows', html.includes('1 unmatched'));
    t.check('it is explained', html.includes('never matched'));

    const kathyRow = html.slice(html.lastIndexOf('Kathy Cruz'));
    t.check('a fully matched supervisor is not flagged', !kathyRow.includes('unmatched'));
});

suite('matchup diagnostic: names are escaped', (t) => {
    const nasty = JSON.parse(JSON.stringify(DATA));
    nasty.teams['Sarah Gregory'][0].name = '<img src=x onerror=alert(1)>';
    const html = load(t, nasty);

    t.check('the tag does not survive', !html.includes('<img src=x'));
    t.check('it is escaped instead', html.includes('&lt;img src=x'));
});

suite('matchup diagnostic: the call-weighted score is shown beside the headcount one', (t) => {
    const html = load(t);
    const sarahRow = html.slice(html.indexOf('Sarah Gregory'), html.indexOf('Kathy Cruz'));
    const kathyRow = html.slice(html.indexOf('Kathy Cruz'));

    // Sarah's two perfect scores came off 270 calls between them while her one
    // weak member took 4,200. Weighted by the work her customers actually met,
    // the team is at 1.685 rather than 2.533.
    t.check('the headcount score is there', sarahRow.includes('2.533'));
    t.check('and the call-weighted one beside it', sarahRow.includes('1.685'));
    t.check('the gap is stated rather than left to be subtracted', sarahRow.includes('(0.85 lower)'));

    // Kathy's volume is spread evenly, so hers barely moves and must not be
    // flagged. A warning on every row is a warning on none.
    t.check('an evenly loaded team is not flagged', !kathyRow.includes('lower)'));
    t.check('the column is explained', html.includes('By call volume') && html.includes('the calls they actually took'));
});

suite('matchup diagnostic: the two bases are shown disagreeing', (t) => {
    const html = load(t);
    const sarahRow = html.slice(html.indexOf('Sarah Gregory'), html.indexOf('Kathy Cruz'));

    // Top of the table on Avg Score, bottom of the centre on Avg Rank. Avg Rank
    // is built on the guarded basis that already discounts thin records, so the
    // two ordering the teams differently is the defect visible on screen.
    t.check('Sarah leads on Avg Score', html.indexOf('Sarah Gregory') < html.indexOf('Kathy Cruz'));
    t.check('while her Avg Rank is the worse of the two', sarahRow.includes('57.7'));
    t.check('the disagreement is spelled out', html.includes('the two bases disagreeing out loud'));
});
