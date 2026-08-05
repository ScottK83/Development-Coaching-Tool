'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/team-filter.module.js').teamFilter;
}

suite('team filter: picking one person narrows the existing filter', (t) => {
    const filter = load(t);

    const myTeam = ['Alyssa Dimes', 'Betty Yanez', 'Oceane Ingram'];
    const justOceane = ['Oceane Ingram'];

    // "All of my team" picked: whatever was already selected stands untouched.
    t.equal('no scope leaves the selection alone', filter.applyTeamScope(myTeam, null).join(','), myTeam.join(','));
    t.equal('and an undefined scope behaves the same', filter.applyTeamScope(myTeam, undefined).join(','), myTeam.join(','));

    t.equal('one person narrows to just them', filter.applyTeamScope(myTeam, justOceane).join(','), 'Oceane Ingram');

    // The two empty cases mean opposite things. No checkboxes ticked has always
    // meant "everyone", so a scope with nothing to narrow becomes the scope
    // itself — not an empty list that would read as "no data".
    t.equal('an empty selection adopts the scope', filter.applyTeamScope([], justOceane).join(','), 'Oceane Ingram');

    // Someone off the ticked list must come back empty rather than quietly
    // falling back to the whole team.
    t.equal('no overlap means no one', filter.applyTeamScope(['Alyssa Dimes'], justOceane).length, 0);

    t.equal('blank names are dropped from either side', filter.applyTeamScope(['  ', 'Alyssa Dimes'], ['Alyssa Dimes', '']).join(','), 'Alyssa Dimes');
    t.equal('surrounding whitespace still matches', filter.applyTeamScope([' Oceane Ingram '], justOceane).join(','), 'Oceane Ingram');
});

suite('team filter: center-wide views can opt out of the scope', (t) => {
    const filter = load(t);

    // teamScope reports one person as the active scope.
    global.window.DevCoachModules.teamScope = {
        getScopeMembers: () => ['Oceane Ingram'],
        getActiveScope: () => ({ id: 'Oceane Ingram', label: 'Oceane Ingram' })
    };

    const scoped = filter.getTeamSelectionContext();
    t.equal('the context reports who is in scope', scoped.scopeLabel, 'Oceane Ingram');
    t.check('and it is filtering', scoped.isFiltering === true);
    t.equal('down to that one person', scoped.selectedMembers.join(','), 'Oceane Ingram');

    const centerWide = filter.getTeamSelectionContext({ ignoreTeamScope: true });
    t.check('opting out drops the narrowing', centerWide.selectedMembers.indexOf('Oceane Ingram') === -1
        || centerWide.selectedMembers.length !== 1);

    global.window.DevCoachModules.teamScope = {
        getScopeMembers: () => null,
        getActiveScope: () => null
    };
    const unscoped = filter.getTeamSelectionContext();
    t.check('with everyone picked the context says so', unscoped.scopeLabel === null && unscoped.scopeId === null);
});
