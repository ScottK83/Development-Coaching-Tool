'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/team-scope.module.js').teamScope;
}

const SUPERVISORS = {
    'Alyssa Dimes': 'Scott',
    'Betty Yanez': 'Scott',
    'Michelle Castro': 'Kathy',
    'Diane Ruiz': 'Kathy',
    'Scarlett Reyes': 'Miranda'
};

suite('team scope: turns the supervisor map into teams', (t) => {
    const scope = load(t);

    const index = scope.buildTeamIndex(SUPERVISORS, [
        'Alyssa Dimes', 'Betty Yanez', 'Michelle Castro', 'Diane Ruiz', 'Scarlett Reyes'
    ]);

    t.equal('one team per supervisor', index.teams.length, 3);
    t.equal('teams read alphabetically', index.teams.map(team => team.label).join(','), 'Kathy,Miranda,Scott');
    t.equal('members land on the right supervisor', index.teams.find(x => x.label === 'Scott').members.join(','), 'Alyssa Dimes,Betty Yanez');
    t.equal('members are sorted within a team', index.teams.find(x => x.label === 'Kathy').members.join(','), 'Diane Ruiz,Michelle Castro');
    t.equal('the reverse lookup knows who reports where', index.byEmployee['Scarlett Reyes'], 'Miranda');
    t.equal('nobody is unassigned here', index.unassignedCount, 0);

    // The dropdown is built from who is actually in the data, so a supervisor
    // whose whole team has left the uploads should not still be offered.
    const shrunk = scope.buildTeamIndex(SUPERVISORS, ['Alyssa Dimes', 'Betty Yanez']);
    t.equal('a team with nobody left in the data drops out', shrunk.teams.length, 1);
    t.equal('and the surviving team is the right one', shrunk.teams[0].label, 'Scott');
});

suite('team scope: people with no supervisor are named, not dropped', (t) => {
    const scope = load(t);

    const index = scope.buildTeamIndex(SUPERVISORS, ['Alyssa Dimes', 'Jordan New', 'Pat Fresh']);

    t.equal('two people have nowhere to sit', index.unassignedCount, 2);
    t.equal('they get their own bucket', index.teams[index.teams.length - 1].label, 'Unassigned');
    t.check('and the bucket sorts last, after the real teams', index.teams[0].label === 'Scott');
    t.equal('the bucket holds both of them', index.teams[index.teams.length - 1].members.join(','), 'Jordan New,Pat Fresh');
    t.check('an unassigned person has no supervisor recorded', !('Jordan New' in index.byEmployee));

    const clean = scope.buildTeamIndex(SUPERVISORS, ['Alyssa Dimes']);
    t.check('no bucket appears when everyone is assigned', clean.teams.every(team => team.label !== 'Unassigned'));
});

suite('team scope: the active team survives, and fails safe', (t) => {
    const scope = load(t);
    const index = scope.buildTeamIndex(SUPERVISORS, Object.keys(SUPERVISORS));

    t.check('nothing selected means no scope', scope.resolveActiveTeam(index, null) === null);
    t.check('"all" means no scope', scope.resolveActiveTeam(index, scope.ALL_TEAMS_ID) === null);
    t.equal('a real id resolves to its team', scope.resolveActiveTeam(index, 'kathy').label, 'Kathy');

    // A saved id whose team is gone must not scope the app to an empty roster —
    // that reads as "no data" everywhere downstream, which hides the real cause.
    t.check('a stale id falls back to everyone', scope.resolveActiveTeam(index, 'someone-who-left') === null);

    t.equal('the default selection is everyone', scope.getActiveTeamId(), scope.ALL_TEAMS_ID);
    scope.setActiveTeamId('miranda');
    t.equal('a pick is remembered', scope.getActiveTeamId(), 'miranda');
});

suite('team scope: ids are stable and safe to put in markup', (t) => {
    const scope = load(t);

    t.equal('spaces become dashes', scope.slugify('Angela Allison'), 'angela-allison');
    t.equal('punctuation is stripped', scope.slugify("Kathy O'Brien"), 'kathy-o-brien');
    t.equal('case does not matter', scope.slugify('MIRANDA'), 'miranda');
    t.equal('an empty label still yields an id', scope.slugify('   '), 'team');
});
