'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/team-scope.module.js').teamScope;
}

const MY_TEAM = ['Oceane Ingram', 'Alyssa Dimes', 'Betty Yanez', 'James Garcia'];

suite('team scope: the roster is my team, narrowed to who is in the data', (t) => {
    const scope = load(t);

    const roster = scope.buildRoster(MY_TEAM, ['Alyssa Dimes', 'Betty Yanez', 'Oceane Ingram', 'Someone Else']);

    t.equal('only my team, never the wider floor', roster.length, 3);
    t.check('a rep from another team is not offered', roster.indexOf('Someone Else') === -1);
    t.equal('and the list reads alphabetically', roster.join(','), 'Alyssa Dimes,Betty Yanez,Oceane Ingram');
    t.check('a team member with no data yet is left out', roster.indexOf('James Garcia') === -1);

    // A fresh install has nothing to narrow against, and an empty dropdown
    // would look broken rather than empty.
    t.equal('with nothing uploaded the team list stands on its own', scope.buildRoster(MY_TEAM, []).length, 4);

    t.equal('duplicates collapse', scope.buildRoster(['Oceane Ingram', 'Oceane Ingram'], []).length, 1);
    t.equal('blank entries are dropped', scope.buildRoster(['', '  ', 'Oceane Ingram'], []).join(','), 'Oceane Ingram');
    t.equal('no team means no roster', scope.buildRoster([], ['Alyssa Dimes']).length, 0);
});

suite('team scope: picking one person, or everyone', (t) => {
    const scope = load(t);
    const roster = scope.buildRoster(MY_TEAM, []);

    t.check('nothing picked means the whole team', scope.resolveActiveMember(roster, null) === null);
    t.check('"all" means the whole team', scope.resolveActiveMember(roster, scope.ALL_MEMBERS_ID) === null);
    t.equal('a name on the roster resolves to that person', scope.resolveActiveMember(roster, 'Oceane Ingram'), 'Oceane Ingram');

    // Someone who has left the team must not scope the app to a person who
    // isn't there — that reads as "no data" everywhere at once.
    t.check('someone off the team falls back to everyone', scope.resolveActiveMember(roster, 'Departed Rep') === null);

    t.equal('the default is everyone', scope.getActiveMemberId(), scope.ALL_MEMBERS_ID);
    scope.setActiveMemberId('Oceane Ingram');
    t.equal('a pick is remembered', scope.getActiveMemberId(), 'Oceane Ingram');
    scope.setActiveMemberId(scope.ALL_MEMBERS_ID);
    t.equal('and can be handed back to everyone', scope.getActiveMemberId(), scope.ALL_MEMBERS_ID);
});

suite('team scope: what the rest of the app is told', (t) => {
    const scope = load(t);

    // With no team data wired up, the roster is empty and nothing resolves —
    // which must read as "everyone", not as "one person who doesn't exist".
    scope.setActiveMemberId('Oceane Ingram');
    t.check('an unresolvable pick scopes to nobody in particular', scope.getScopeMembers() === null);
    t.check('so everyone is in scope', scope.isInScope('Anyone At All') === true);
    t.check('and the scope describes itself as all', scope.describeScope().isAll === true);
    t.check('with no active scope object', scope.getActiveScope() === null);
});

suite('team scope: null scope and an empty scope mean different things', (t) => {
    const scope = load(t);

    // team-filter leans on this distinction: null leaves the existing selection
    // alone, while a list narrows it. Collapsing the two would silently widen
    // a one-person view back to the whole team.
    t.check('no pick yields null, not an empty array', scope.getScopeMembers() === null);
    t.check('null is not an array', !Array.isArray(scope.getScopeMembers()));
});
