'use strict';

const { suite } = require('./harness');

/**
 * What a refresh puts back on screen.
 *
 * Clicking My Team and reloading My Team have to land in the same place. They
 * did not: the click handler shows the day hub directly, while the restore path
 * looked the saved sub-section up in a button map and clicked the button it
 * found. The day hub has no button — it replaced that row, and the row it
 * replaced is hidden in the DOM — so the lookup fell through to a Celebrations
 * default and a refresh landed on Weekly Pulse.
 */

const MY_TEAM_SECTIONS = [
    'subSectionMyTeamDay', 'subSectionHighlights', 'subSectionMorningPulse', 'subSectionMondayPost',
    'subSectionCoachingEmail', 'subSectionTeamSnapshot', 'subSectionCallListening', 'subSectionReliability'
];
const MY_TEAM_BUTTONS = [
    'subNavHighlights', 'subNavMorningPulse', 'subNavMondayPost', 'subNavCoachingEmail',
    'subNavTeamSnapshot', 'subNavCallListening', 'subNavReliability'
];
const TOP_SECTIONS = [
    'dashboardSection', 'uploadSection', 'coachingEmailSection', 'trendsAnalysisSection',
    'reviewPrepSection', 'followUpSection', 'manageDataSection'
];

// The hidden legacy sub-nav is wired the way script.js wires it: each button
// shows its own sub-section. That is the behaviour the restore path was
// leaning on, so the test has to reproduce it to catch the fall-through.
function loadNav(t, savedState) {
    const { store, els } = t.installFakeBrowser();
    const clicked = [];

    function makeEl(id) {
        return {
            id, style: {}, dataset: {}, _listeners: [],
            addEventListener(type, fn) { if (type === 'click') this._listeners.push(fn); },
            click() { clicked.push(this.id); this._listeners.forEach((fn) => fn()); }
        };
    }
    [].concat(TOP_SECTIONS, MY_TEAM_SECTIONS, MY_TEAM_BUTTONS).forEach((id) => { els[id] = makeEl(id); });

    if (savedState) store['devCoachingTool_uiNavState'] = JSON.stringify(savedState);

    const nav = t.loadModule('modules/navigation.module.js').navigation;

    MY_TEAM_BUTTONS.forEach((btnId) => {
        const subId = 'subSection' + btnId.slice('subNav'.length);
        els[btnId].addEventListener('click', () => nav.showMyTeamSubSection(subId, btnId));
    });

    const rendered = [];
    global.window.DevCoachModules.myTeam = {
        renderDayPage: () => rendered.push('day'),
        initializeMyTeam: () => rendered.push('init')
    };

    const visible = () => MY_TEAM_SECTIONS.filter((id) => els[id].style.display === 'block');
    return { nav, els, store, clicked, rendered, visible };
}

suite('navigation: a refresh lands where clicking My Team lands', (t) => {
    // Clicking My Team saves the day hub. Reloading has to bring it back.
    const day = loadNav(t, { sectionId: 'coachingEmailSection', myTeamSubSectionId: 'subSectionMyTeamDay' });
    day.nav.restoreLastViewedSection();

    t.equal('the day hub is what comes back', day.visible().join(','), 'subSectionMyTeamDay');
    t.check('and it is rendered, not just revealed', day.rendered.indexOf('day') > -1);
    t.check('My Team is initialized the way the click does it', day.rendered.indexOf('init') > -1);
    t.check('no hidden legacy button was clicked on the way', day.clicked.length === 0);

    // A sub-section that does have a button still restores through it.
    const snapshot = loadNav(t, { sectionId: 'coachingEmailSection', myTeamSubSectionId: 'subSectionTeamSnapshot' });
    snapshot.nav.restoreLastViewedSection();
    t.equal('a real tab still comes back as itself', snapshot.visible().join(','), 'subSectionTeamSnapshot');
    t.equal('through its own button', snapshot.clicked.join(','), 'subNavTeamSnapshot');

    // State written before the day hub existed, or by a build that is gone.
    const stale = loadNav(t, { sectionId: 'coachingEmailSection', myTeamSubSectionId: 'subSectionSomethingRemoved' });
    stale.nav.restoreLastViewedSection();
    t.equal('an id nobody recognizes falls back to the day hub, not to Celebrations',
        stale.visible().join(','), 'subSectionMyTeamDay');

    // No saved state at all is the same case as a first visit.
    const fresh = loadNav(t, { sectionId: 'coachingEmailSection' });
    fresh.nav.restoreLastViewedSection();
    t.equal('and so does no saved sub-section', fresh.visible().join(','), 'subSectionMyTeamDay');

    t.equal('the default state agrees with all of it',
        fresh.nav.getDefaultUiNavState().myTeamSubSectionId, 'subSectionMyTeamDay');
});

/* ── The same shape, in the other three sections ── */

// Trends does not pair button to section by name — subNavTaRankings shows
// subSectionTaCenterRanking — so the wiring is spelled out rather than derived,
// the same way navigation.module.js has to spell it out.
const TRENDS_PAIRS = {
    subNavTaIntelligence: 'subSectionTaTrendIntelligence',
    subNavTaMetricCharts: 'subSectionTaMetricTrends',
    subNavTaRankings: 'subSectionTaCenterRanking'
};
const TRENDS_BUTTONS = Object.keys(TRENDS_PAIRS);
const TRENDS_SECTIONS = Object.keys(TRENDS_PAIRS).map((b) => TRENDS_PAIRS[b]);
const SETTINGS_BUTTONS = ['subNavTeamMembers', 'subNavCoachingTips', 'subNavSyncBackup', 'subNavDeleteData'];
const SETTINGS_SECTIONS = ['subSectionTeamMembers', 'subSectionCoachingTips', 'subSectionSyncBackup', 'subSectionDeleteData'];

function loadOther(t, savedState, buttons, sections, wire) {
    const { store, els } = t.installFakeBrowser();
    const clicked = [];

    function makeEl(id) {
        return {
            id, style: {}, dataset: {}, _listeners: [],
            addEventListener(type, fn) { if (type === 'click') this._listeners.push(fn); },
            click() { clicked.push(this.id); this._listeners.forEach((fn) => fn()); }
        };
    }
    [].concat(TOP_SECTIONS, sections, buttons).forEach((id) => { els[id] = makeEl(id); });
    if (savedState) store['devCoachingTool_uiNavState'] = JSON.stringify(savedState);

    const nav = t.loadModule('modules/navigation.module.js').navigation;
    buttons.forEach((btnId) => {
        els[btnId].addEventListener('click', () => wire(nav, btnId));
    });

    const visible = () => sections.filter((id) => els[id].style.display === 'block');
    return { nav, els, clicked, visible };
}

suite('navigation: an id from a build that is gone lands on the section default', (t) => {
    // My Team broke because an unmapped id fell through to a default that
    // clicked a button belonging to a different tab. Every section restored
    // that way; these are the ones that had not been bitten yet.
    const wireTrends = (nav, btnId) => nav.showTrendsSubSection(TRENDS_PAIRS[btnId], btnId);

    const known = loadOther(t, { sectionId: 'trendsAnalysisSection', trendsSubSectionId: 'subSectionTaCenterRanking' },
        TRENDS_BUTTONS, TRENDS_SECTIONS, wireTrends);
    known.nav.restoreLastViewedSection();
    t.equal('a known trends tab comes back as itself', known.visible().join(','), 'subSectionTaCenterRanking');
    t.equal('through its own button', known.clicked.join(','), 'subNavTaRankings');

    const gone = loadOther(t, { sectionId: 'trendsAnalysisSection', trendsSubSectionId: 'subSectionTaRetired' },
        TRENDS_BUTTONS, TRENDS_SECTIONS, wireTrends);
    gone.nav.restoreLastViewedSection();
    t.equal('a retired one falls back to the section default',
        gone.visible().join(','), 'subSectionTaTrendIntelligence');
    t.check('without clicking somebody else\'s button', gone.clicked.length === 0);

    const wireSettings = (nav, btnId) => nav.showManageDataSubSection('subSection' + btnId.slice('subNav'.length));

    const settings = loadOther(t, { sectionId: 'manageDataSection', settingsSubSectionId: 'subSectionSyncBackup' },
        SETTINGS_BUTTONS, SETTINGS_SECTIONS, wireSettings);
    settings.nav.restoreLastViewedSection();
    t.equal('settings pairs its buttons by name and still works',
        settings.visible().join(','), 'subSectionSyncBackup');

    const settingsGone = loadOther(t, { sectionId: 'manageDataSection', settingsSubSectionId: 'subSectionOldThing' },
        SETTINGS_BUTTONS, SETTINGS_SECTIONS, wireSettings);
    settingsGone.nav.restoreLastViewedSection();
    t.equal('and falls back to its own default too',
        settingsGone.visible().join(','), 'subSectionTeamMembers');
});
