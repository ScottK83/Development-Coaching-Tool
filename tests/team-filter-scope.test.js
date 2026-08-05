'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/team-filter.module.js').teamFilter;
}

suite('team filter: the team dropdown narrows the existing filter', (t) => {
    const filter = load(t);

    const checked = ['Alyssa Dimes', 'Betty Yanez', 'Michelle Castro'];
    const kathysTeam = ['Michelle Castro', 'Diane Ruiz'];

    // No team picked: whatever was already selected stands untouched.
    t.equal('no team scope leaves the selection alone', filter.applyTeamScope(checked, null).join(','), checked.join(','));
    t.equal('and an undefined scope behaves the same', filter.applyTeamScope(checked, undefined).join(','), checked.join(','));

    t.equal('a team narrows to the overlap', filter.applyTeamScope(checked, kathysTeam).join(','), 'Michelle Castro');

    // The two empty cases mean opposite things. No checkboxes ticked has always
    // meant "everyone", so a team scope with nothing to narrow becomes the team
    // itself — not an empty list that would read as "no data".
    t.equal('an empty selection adopts the whole team', filter.applyTeamScope([], kathysTeam).join(','), 'Michelle Castro,Diane Ruiz');

    // A team that shares nobody with the ticked list must come back empty
    // rather than quietly falling back to everyone.
    t.equal('no overlap means no one', filter.applyTeamScope(['Alyssa Dimes'], kathysTeam).length, 0);

    t.equal('blank names are dropped from either side', filter.applyTeamScope(['  ', 'Alyssa Dimes'], ['Alyssa Dimes', '']).join(','), 'Alyssa Dimes');
    t.equal('surrounding whitespace still matches', filter.applyTeamScope([' Alyssa Dimes '], ['Alyssa Dimes']).join(','), 'Alyssa Dimes');
});

suite('team filter: center-wide views can opt out of the team scope', (t) => {
    const filter = load(t);

    // teamScope reports Kathy's team as active.
    global.window.DevCoachModules.teamScope = {
        getActiveTeamMembers: () => ['Michelle Castro'],
        getActiveTeam: () => ({ id: 'kathy', label: 'Kathy' })
    };

    const scoped = filter.getTeamSelectionContext();
    t.equal('the context reports which team is active', scoped.teamLabel, 'Kathy');
    t.check('and it is filtering', scoped.isFiltering === true);
    t.equal('down to the team members', scoped.selectedMembers.join(','), 'Michelle Castro');

    const centerWide = filter.getTeamSelectionContext({ ignoreTeamScope: true });
    t.check('opting out drops the team narrowing', centerWide.selectedMembers.indexOf('Michelle Castro') === -1
        || centerWide.selectedMembers.length !== 1);

    global.window.DevCoachModules.teamScope = {
        getActiveTeamMembers: () => null,
        getActiveTeam: () => null
    };
    const unscoped = filter.getTeamSelectionContext();
    t.check('with no team picked the context says so', unscoped.teamLabel === null && unscoped.teamId === null);
});
