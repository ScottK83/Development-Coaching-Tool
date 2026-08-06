'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/matchup.module.js').matchup;
}

const RANKINGS = [
    { name: 'Alyssa Dimes' },
    { name: 'Betty Yanez' },
    { name: 'James Garcia' },
    { name: 'Michelle Castro' },
    { name: 'Diane Cordova' }
];

// Three of my reps carry my supervisor label, two belong to Kathy.
const SUPERVISORS = {
    'Alyssa Dimes': 'Scott',
    'Betty Yanez': 'Scott',
    'James Garcia': 'Scott',
    'Michelle Castro': 'Kathy Cruz',
    'Diane Cordova': 'Kathy Cruz'
};

suite('matchup: my supervisor row and "My Team" are the same team', (t) => {
    const matchup = load(t);

    const mine = new Set(['Alyssa Dimes', 'Betty Yanez', 'James Garcia']);
    t.equal('the overlap identifies me', matchup.resolveMyTeamLabel(RANKINGS, SUPERVISORS, mine), 'Scott');

    // The symptom: half my reps had a supervisor label and half didn't, so the
    // two halves showed up as separate teams and competed against each other.
    const partial = new Set(['Alyssa Dimes', 'Betty Yanez']);
    t.equal('a partial roster still finds me', matchup.resolveMyTeamLabel(RANKINGS, SUPERVISORS, partial), 'Scott');

    // Somebody else's team must never be claimed as mine.
    const notMine = new Set(['Michelle Castro', 'Diane Cordova']);
    t.equal('the biggest overlap wins, whoever it is', matchup.resolveMyTeamLabel(RANKINGS, SUPERVISORS, notMine), 'Kathy Cruz');
});

suite('matchup: refuses to guess when there is nothing to go on', (t) => {
    const matchup = load(t);

    // No overlap at all: leaving every supervisor row alone is right. Picking
    // one arbitrarily would relabel a colleague's team as mine.
    t.check('an empty roster claims nobody', matchup.resolveMyTeamLabel(RANKINGS, SUPERVISORS, new Set()) === null);
    t.check('a roster of strangers claims nobody', matchup.resolveMyTeamLabel(RANKINGS, SUPERVISORS, new Set(['Nobody At All'])) === null);
    t.check('no supervisors assigned claims nobody', matchup.resolveMyTeamLabel(RANKINGS, {}, new Set(['Alyssa Dimes'])) === null);
    t.check('no rankings claims nobody', matchup.resolveMyTeamLabel([], SUPERVISORS, new Set(['Alyssa Dimes'])) === null);
    t.check('missing arguments are survivable', matchup.resolveMyTeamLabel(null, null, null) === null);
});

suite('matchup: the answer does not wobble between reloads', (t) => {
    const matchup = load(t);

    // One rep from each team on my roster is a genuine tie. Whatever it picks,
    // it has to pick the same one every time, or the rankings reshuffle on
    // refresh for no visible reason.
    const tied = new Set(['Alyssa Dimes', 'Michelle Castro']);
    const first = matchup.resolveMyTeamLabel(RANKINGS, SUPERVISORS, tied);
    const again = matchup.resolveMyTeamLabel(RANKINGS.slice().reverse(), SUPERVISORS, tied);

    t.check('a tie still resolves to something', first !== null);
    t.equal('and resolves the same way regardless of row order', again, first);
    t.equal('breaking the tie alphabetically', first, 'Kathy Cruz');
});
