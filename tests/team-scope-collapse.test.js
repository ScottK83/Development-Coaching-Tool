'use strict';

/**
 * Picking one person must never widen the filter.
 *
 * team-filter-scope.test.js already pins the rule on the narrowing function
 * itself: "Someone off the ticked list must come back empty rather than quietly
 * falling back to the whole team", and applyTeamScope returns [] for that case.
 *
 * getTeamSelectionContext then turned that [] into isFiltering:false, and
 * isAssociateIncludedByTeamFilter reads "not filtering" as "admit everyone". So
 * the exact fallback the rule forbids happened one function later, and the
 * suite could not see it because it stopped at applyTeamScope.
 *
 * It is reachable by ordinary use. The Who dropdown offers the SUPERVISOR
 * ROSTER, which team-scope's own comment says wins because it is re-read from
 * the source system and re-applies on every load. The Settings tick list is
 * per-week and set by hand. Pick somebody the roster says is yours who was
 * never ticked for that week and every filtered view widened to everyone --
 * including other supervisors' reps -- while the header still named one person.
 *
 * So these tests run the whole chain, from the stored roster and tick list
 * through to the names a view would actually render.
 */

const { suite } = require('./harness');

const PREFIX = 'devCoachingTool_';
const WEEK = '2026-08-17|2026-08-23';

const EVERYONE = ['Ada Stretch', 'Ben Ongoal', 'Cara Floor', 'Dan Under', 'Eve Rounding'];

function load(t, opts) {
    const browser = t.installFakeBrowser();
    const o = opts || {};

    // The week on file.
    global.window.weeklyData = {
        [WEEK]: {
            metadata: { periodType: 'week', startDate: '2026-08-17', endDate: '2026-08-23' },
            employees: EVERYONE.map((name) => ({ name }))
        }
    };
    global.window.ytdData = {};
    global.weeklyData = global.window.weeklyData;
    global.ytdData = global.window.ytdData;

    browser.store[PREFIX + 'myTeamMembers'] = JSON.stringify({ [WEEK]: o.ticked || [] });
    browser.store[PREFIX + 'employeeSupervisors'] = JSON.stringify(o.supervisors || {});
    browser.store[PREFIX + 'mySupervisorLabel'] = o.myLabel || '';
    browser.store[PREFIX + 'activeTeamMember'] = o.who || '__all__';

    // A storage module thin enough for both to read through.
    global.window.DevCoachModules.storage = {
        readStore(key) {
            const raw = browser.store[PREFIX + key];
            return raw === undefined ? undefined : JSON.parse(raw);
        },
        loadWeeklyData() { return global.window.weeklyData; },
        loadTeamMembers() { return JSON.parse(browser.store[PREFIX + 'myTeamMembers'] || '{}'); },
        saveWithSizeCheck(key, value) { browser.store[PREFIX + key] = JSON.stringify(value); return true; }
    };

    t.loadModule('modules/team-scope.module.js');
    const modules = t.loadModule('modules/team-filter.module.js');
    return { filter: modules.teamFilter, scope: modules.teamScope, store: browser.store };
}

// The roster says three people are mine. The tick list, set weeks ago, has two.
const SUPERVISORS = {
    'Ada Stretch': 'Scott', 'Ben Ongoal': 'Scott', 'Cara Floor': 'Scott',
    'Dan Under': 'Other Supe', 'Eve Rounding': 'Other Supe'
};

suite('team scope: one person off the tick list does not open the filter to everyone', (t) => {
    const { filter, scope, store } = load(t, {
        ticked: ['Ada Stretch', 'Ben Ongoal'],
        supervisors: SUPERVISORS,
        myLabel: 'Scott',
        who: 'Cara Floor'
    });

    // The setup has to be the reachable one, or this passes for the wrong
    // reason. Read it off the store this suite is actually using — calling
    // load() again would reinstall the fake browser and reset the very
    // selection under test.
    t.check('the Who dropdown really does offer Cara Floor',
        scope.getMyTeamRoster().indexOf('Cara Floor') > -1);
    t.check('and she really is not on the tick list',
        JSON.parse(store[PREFIX + 'myTeamMembers'])[WEEK].indexOf('Cara Floor') === -1);
    t.check('and she really is the one picked',
        store[PREFIX + 'activeTeamMember'] === 'Cara Floor');

    const ctx = filter.getTeamSelectionContext();

    t.equal('the scope narrowed to nobody', ctx.selectedMembers.length, 0);
    t.check('but the filter is still ON', ctx.isFiltering === true);
    t.check('and it says why it is empty', ctx.scopeExcludesAll === true);

    // The half that actually mattered.
    t.check("another supervisor's rep is not admitted",
        filter.isAssociateIncludedByTeamFilter('Dan Under', ctx) === false);
    t.check('nor a second one',
        filter.isAssociateIncludedByTeamFilter('Eve Rounding', ctx) === false);
    t.check('nor is one of my own who was not picked',
        filter.isAssociateIncludedByTeamFilter('Ada Stretch', ctx) === false);

    t.equal('so a view renders nobody, not the whole call centre',
        filter.filterAssociateNamesByTeamSelection(EVERYONE).length, 0);
});

suite('team scope: the ordinary selections still behave', (t) => {
    // All of my team: the tick list stands, and nobody else gets in.
    const all = load(t, {
        ticked: ['Ada Stretch', 'Ben Ongoal'], supervisors: SUPERVISORS, myLabel: 'Scott', who: '__all__'
    });
    const allCtx = all.filter.getTeamSelectionContext();
    t.equal('all of my team is the tick list', allCtx.selectedMembers.join(','), 'Ada Stretch,Ben Ongoal');
    t.check('it is filtering', allCtx.isFiltering === true);
    t.check('and it is not the empty-scope case', !allCtx.scopeExcludesAll);
    t.equal('and it renders exactly those two',
        all.filter.filterAssociateNamesByTeamSelection(EVERYONE).join(','), 'Ada Stretch,Ben Ongoal');

    // One of my own, who IS ticked: narrows to them.
    const one = load(t, {
        ticked: ['Ada Stretch', 'Ben Ongoal'], supervisors: SUPERVISORS, myLabel: 'Scott', who: 'Ada Stretch'
    });
    const oneCtx = one.filter.getTeamSelectionContext();
    t.equal('one of my own narrows to just them', oneCtx.selectedMembers.join(','), 'Ada Stretch');
    t.check('and it is not the empty-scope case', !oneCtx.scopeExcludesAll);
    t.equal('and renders just them',
        one.filter.filterAssociateNamesByTeamSelection(EVERYONE).join(','), 'Ada Stretch');

    // Nothing ticked at all and no scope: the long-standing "no filter" state,
    // which must keep meaning everyone. This is the empty case that is NOT the bug.
    const none = load(t, { ticked: [], who: '__all__' });
    const noneCtx = none.filter.getTeamSelectionContext();
    t.check('nothing configured is not filtering', noneCtx.isFiltering === false);
    t.check('and does not claim an empty scope', !noneCtx.scopeExcludesAll);
    t.equal('so everyone is shown',
        none.filter.filterAssociateNamesByTeamSelection(EVERYONE).length, EVERYONE.length);

    // Nothing ticked, but a person picked: applyTeamScope adopts the scope, so
    // this narrows to them rather than to nobody.
    const adopt = load(t, {
        ticked: [], supervisors: SUPERVISORS, myLabel: 'Scott', who: 'Cara Floor'
    });
    const adoptCtx = adopt.filter.getTeamSelectionContext();
    t.equal('an empty tick list adopts the scope', adoptCtx.selectedMembers.join(','), 'Cara Floor');
    t.check('and that is not the empty-scope case', !adoptCtx.scopeExcludesAll);
});

suite('team scope: a centre-wide view can still opt out', (t) => {
    // ignoreTeamScope is what the centre-wide surfaces use, and it must keep
    // ignoring the scope even in the case above.
    const { filter } = load(t, {
        ticked: ['Ada Stretch', 'Ben Ongoal'], supervisors: SUPERVISORS, myLabel: 'Scott', who: 'Cara Floor'
    });
    const wide = filter.getTeamSelectionContext({ ignoreTeamScope: true });
    t.equal('the scope is ignored, leaving the tick list',
        wide.selectedMembers.join(','), 'Ada Stretch,Ben Ongoal');
    t.check('and no empty-scope flag is raised', !wide.scopeExcludesAll);
});
