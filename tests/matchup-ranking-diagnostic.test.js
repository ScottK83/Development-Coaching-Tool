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

function member(name, ratingAverage, measuredCount, rank) {
    return { name, ratingAverage, measuredCount, rank, totalCalls: 400, surveyTotal: 6 };
}

// Sarah's team wins on Avg Score while holding the two worst centre ranks in it,
// which is the whole shape of the complaint.
const SARAH = [
    member('Thin One', 3.00, 2, 60),
    member('Thin Two', 3.00, 2, 58),
    member('Solid One', 1.60, 5, 55)
];
const KATHY = [
    member('Full One', 2.60, 5, 3),
    member('Full Two', 2.40, 5, 8)
];
const ORPHANS = [member('Dropped Rep', 1.20, 5, 61)];

function avg(list) {
    return list.reduce((a, r) => a + r.ratingAverage, 0) / list.length;
}

const DATA = {
    teamNames: ['Sarah Gregory', 'Kathy Cruz', 'Unassigned'],
    teams: { 'Sarah Gregory': SARAH, 'Kathy Cruz': KATHY, Unassigned: ORPHANS },
    teamStats: {
        'Sarah Gregory': { name: 'Sarah Gregory', avgRating: avg(SARAH) },
        'Kathy Cruz': { name: 'Kathy Cruz', avgRating: avg(KATHY) },
        Unassigned: { name: 'Unassigned', avgRating: avg(ORPHANS) }
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
    t.check('Sarah carries two thin perfect scores', sarahRow.includes('>2</span>'));
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
