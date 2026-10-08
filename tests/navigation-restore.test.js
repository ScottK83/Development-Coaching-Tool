'use strict';

const { suite } = require('./harness');

/**
 * What a refresh puts back on screen.
 *
 * Clicking a tab and reloading onto it have to land in the same place. They
 * did not once: the click handler showed the day hub directly, while the
 * restore path looked the saved sub-section up in a button map and clicked
 * the button it found. The day hub had no button, so the lookup fell through
 * to a Celebrations default and a refresh landed on Weekly Pulse.
 *
 * Since 2026-10-07 the nav is Today / People / Center / Upload / Settings,
 * and every tab has a button of its own, so a restore always goes through
 * the same handler a click does. The second suite below pins the other half
 * of that change: a place saved under the old eight-item nav still comes back.
 */

const TOP_SECTIONS = [
    'coachingEmailSection', 'peopleSection', 'trendsAnalysisSection', 'uploadSection', 'manageDataSection'
];
const TODAY = {
    subNavTdDay: 'subSectionMyTeamDay',
    subNavTdYear: 'subSectionTodayYear',
    subNavTdSnapshot: 'subSectionTeamSnapshot',
    subNavTdContest: 'subSectionTodayContest'
};
const PEOPLE = {
    subNavPeNumbers: 'subSectionOnOffTracker',
    subNavPeCoach: 'subSectionCoachingEmail',
    subNavPeCalls: 'subSectionCallListening',
    subNavPeAttendance: 'subSectionReliability',
    subNavPeFollowUp: 'subSectionFollowUp',
    subNavPeReviews: 'subSectionReviews'
};
const REVIEWS = {
    subNavRpMeetings: 'subSectionMeetings',
    subNavRpQuarterly: 'subSectionQ1Review',
    subNavRpMidYear: 'subSectionMidYear',
    subNavRpYearEnd: 'subSectionYearEnd'
};
const CENTER = {
    subNavTaRankings: 'subSectionTaCenterRanking',
    subNavTaMatchup: 'subSectionTaMatchup',
    subNavTaFutures: 'subSectionTaFutures',
    subNavTaMetricCharts: 'subSectionTaTrendsGroup',
    subNavTaIntelligence: 'subSectionTaTrendIntelligence'
};
const TRENDS_INNER = {
    innerNavTrReports: 'subSectionTaMetricTrends',
    innerNavTrYoY: 'subSectionTaYoY',
    innerNavTrPatterns: 'subSectionTaPatterns'
};
const SETTINGS_BUTTONS = ['subNavTeamMembers', 'subNavCoachingTips', 'subNavSyncBackup', 'subNavDeleteData'];

const ALL_SUBS = [].concat(
    Object.values(TODAY), Object.values(PEOPLE), Object.values(REVIEWS),
    Object.values(CENTER), Object.values(TRENDS_INNER),
    SETTINGS_BUTTONS.map((b) => 'subSection' + b.slice('subNav'.length))
);

// The buttons are wired the way script.js wires them: each shows its own
// panel, and the tabs that hold tabs reopen the inner one you left.
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
    [].concat(TOP_SECTIONS, ALL_SUBS, Object.keys(TODAY), Object.keys(PEOPLE), Object.keys(REVIEWS),
        Object.keys(CENTER), Object.keys(TRENDS_INNER), SETTINGS_BUTTONS, ['peopleBtn', 'coachingEmailBtn'])
        .forEach((id) => { els[id] = makeEl(id); });

    if (savedState) store['devCoachingTool_uiNavState'] = JSON.stringify(savedState);

    const nav = t.loadModule('modules/navigation.module.js').navigation;

    const rendered = [];
    global.window.DevCoachModules.myTeam = {
        renderDayPage: () => rendered.push('day'),
        initializeMyTeam: () => rendered.push('init')
    };

    Object.keys(TODAY).forEach((btn) => els[btn].addEventListener('click', () => {
        nav.showMyTeamSubSection(TODAY[btn], btn);
        if (btn === 'subNavTdDay') global.window.DevCoachModules.myTeam.initializeMyTeam();
    }));
    els.coachingEmailBtn.addEventListener('click', () => {
        nav.showOnlySection('coachingEmailSection');
        nav.showMyTeamSubSection('subSectionMyTeamDay', 'subNavTdDay');
        global.window.DevCoachModules.myTeam.initializeMyTeam();
    });
    els.peopleBtn.addEventListener('click', () => {
        nav.showOnlySection('peopleSection');
        nav.restorePeopleTab();
    });
    Object.keys(PEOPLE).forEach((btn) => els[btn].addEventListener('click', () => {
        nav.showPeopleSubSection(PEOPLE[btn], btn);
        if (btn === 'subNavPeReviews') nav.restoreReviewsTab();
    }));
    Object.keys(REVIEWS).forEach((btn) => els[btn].addEventListener('click', () => nav.showReviewPrepSubSection(REVIEWS[btn], btn)));
    Object.keys(CENTER).forEach((btn) => els[btn].addEventListener('click', () => {
        nav.showTrendsSubSection(CENTER[btn], btn);
        if (btn === 'subNavTaMetricCharts') nav.restoreTrendsInnerTab();
    }));
    Object.keys(TRENDS_INNER).forEach((btn) => els[btn].addEventListener('click', () => nav.showTrendsInnerSubSection(TRENDS_INNER[btn], btn)));
    SETTINGS_BUTTONS.forEach((btn) => els[btn].addEventListener('click', () => nav.showManageDataSubSection('subSection' + btn.slice('subNav'.length))));

    const visible = (group) => Object.values(group).filter((id) => els[id].style.display === 'block');
    const saved = () => JSON.parse(store['devCoachingTool_uiNavState'] || '{}');
    return { nav, els, store, clicked, rendered, visible, saved };
}

suite('navigation: a refresh lands where clicking Today lands', (t) => {
    // Today opens on the day hub. Reloading has to bring it back.
    const day = loadNav(t, { sectionId: 'coachingEmailSection', myTeamSubSectionId: 'subSectionMyTeamDay' });
    day.nav.restoreLastViewedSection();

    t.equal('the day hub is what comes back', day.visible(TODAY).join(','), 'subSectionMyTeamDay');
    t.check('and it is rendered, not just revealed', day.rendered.indexOf('day') > -1);
    t.check('Today is initialized the way the click does it', day.rendered.indexOf('init') > -1);
    t.equal('through its own button', day.clicked.join(','), 'subNavTdDay');

    const snapshot = loadNav(t, { sectionId: 'coachingEmailSection', myTeamSubSectionId: 'subSectionTeamSnapshot' });
    snapshot.nav.restoreLastViewedSection();
    t.equal('another Today tab comes back as itself', snapshot.visible(TODAY).join(','), 'subSectionTeamSnapshot');
    t.equal('through its own button', snapshot.clicked.join(','), 'subNavTdSnapshot');

    // State written by a build that is gone.
    const stale = loadNav(t, { sectionId: 'coachingEmailSection', myTeamSubSectionId: 'subSectionSomethingRemoved' });
    stale.nav.restoreLastViewedSection();
    t.equal('an id nobody recognizes falls back to the day hub', stale.visible(TODAY).join(','), 'subSectionMyTeamDay');
    t.equal('by the day hub\'s own button, not somebody else\'s', stale.clicked.join(','), 'subNavTdDay');

    const fresh = loadNav(t, null);
    fresh.nav.restoreLastViewedSection();
    t.equal('a first visit lands on Today', fresh.visible(TODAY).join(','), 'subSectionMyTeamDay');
    t.equal('the default state agrees', fresh.nav.getDefaultUiNavState().sectionId, 'coachingEmailSection');
    t.equal('and so does its tab', fresh.nav.getDefaultUiNavState().myTeamSubSectionId, 'subSectionMyTeamDay');
});

suite('navigation: People and Center reopen the tab, and the tab inside it, that you left', (t) => {
    const quarterly = loadNav(t, { sectionId: 'peopleSection', peopleSubSectionId: 'subSectionReviews', reviewPrepSubSectionId: 'subSectionMidYear' });
    quarterly.nav.restoreLastViewedSection();
    t.equal('People comes back on Reviews', quarterly.visible(PEOPLE).join(','), 'subSectionReviews');
    t.equal('on the review you had open', quarterly.visible(REVIEWS).join(','), 'subSectionMidYear');
    t.equal('through the same buttons a click uses', quarterly.clicked.join(','), 'peopleBtn,subNavPeReviews,subNavRpMidYear');

    const calls = loadNav(t, { sectionId: 'peopleSection', peopleSubSectionId: 'subSectionCallListening' });
    calls.nav.restoreLastViewedSection();
    t.equal('a plain People tab comes back as itself', calls.visible(PEOPLE).join(','), 'subSectionCallListening');

    const yoy = loadNav(t, { sectionId: 'trendsAnalysisSection', trendsSubSectionId: 'subSectionTaTrendsGroup', trendsInnerSubSectionId: 'subSectionTaYoY' });
    yoy.nav.restoreLastViewedSection();
    t.equal('Center comes back on Trends', yoy.visible(CENTER).join(','), 'subSectionTaTrendsGroup');
    t.equal('on the view you had open', yoy.visible(TRENDS_INNER).join(','), 'subSectionTaYoY');

    const gone = loadNav(t, { sectionId: 'trendsAnalysisSection', trendsSubSectionId: 'subSectionTaRetired' });
    gone.nav.restoreLastViewedSection();
    t.equal('a retired Center tab falls back to Rankings', gone.visible(CENTER).join(','), 'subSectionTaCenterRanking');
    t.equal('by Rankings\' own button, not somebody else\'s', gone.clicked.join(','), 'subNavTaRankings');

    const settings = loadNav(t, { sectionId: 'manageDataSection', settingsSubSectionId: 'subSectionSyncBackup' });
    settings.nav.restoreLastViewedSection();
    t.check('settings pairs its buttons by name and still works', settings.els.subSectionSyncBackup.style.display === 'block');

    const settingsGone = loadNav(t, { sectionId: 'manageDataSection', settingsSubSectionId: 'subSectionOldThing' });
    settingsGone.nav.restoreLastViewedSection();
    t.check('and falls back to its own default too', settingsGone.els.subSectionTeamMembers.style.display === 'block');
});

suite('navigation: a place saved under the old eight-item nav lands in its new home', (t) => {
    // Each case is a state the old nav really wrote. A refresh after the
    // change has to land on the same panel, now under its new parent.
    const cases = [
        { was: { sectionId: 'dashboardSection' }, group: TODAY, want: 'subSectionMyTeamDay', label: 'the Dashboard opens Today' },
        { was: { sectionId: 'contestSection' }, group: TODAY, want: 'subSectionTodayContest', label: 'Contest is a tab of Today' },
        { was: { sectionId: 'reviewPrepSection', reviewPrepSubSectionId: 'subSectionOnOffTracker' }, group: PEOPLE, want: 'subSectionOnOffTracker', label: 'Score Card is People > Numbers' },
        { was: { sectionId: 'reviewPrepSection', reviewPrepSubSectionId: 'subSectionQ1Review' }, group: REVIEWS, want: 'subSectionQ1Review', label: 'Quarterly is People > Reviews > Quarterly' },
        { was: { sectionId: 'reviewPrepSection', reviewPrepSubSectionId: 'subSectionYearEnd' }, group: REVIEWS, want: 'subSectionYearEnd', label: 'Year-End is People > Reviews > Year-End' },
        { was: { sectionId: 'redFlagSection' }, group: PEOPLE, want: 'subSectionFollowUp', label: 'Follow Up is a tab of People' },
        { was: { sectionId: 'coachingEmailSection', myTeamSubSectionId: 'subSectionCoachingEmail' }, group: PEOPLE, want: 'subSectionCoachingEmail', label: 'Coaching is People > Coach' },
        { was: { sectionId: 'coachingEmailSection', myTeamSubSectionId: 'subSectionCallListening' }, group: PEOPLE, want: 'subSectionCallListening', label: 'Calls is a tab of People' },
        { was: { sectionId: 'coachingEmailSection', myTeamSubSectionId: 'subSectionReliability' }, group: PEOPLE, want: 'subSectionReliability', label: 'Attendance is a tab of People' },
        { was: { sectionId: 'trendsAnalysisSection', trendsSubSectionId: 'subSectionTaMetricTrends' }, group: TRENDS_INNER, want: 'subSectionTaMetricTrends', label: 'Metric Charts is Center > Trends > Trend reports' },
        { was: { sectionId: 'trendsAnalysisSection', trendsSubSectionId: 'subSectionTaPatterns' }, group: TRENDS_INNER, want: 'subSectionTaPatterns', label: 'Patterns is Center > Trends > Patterns' },
        { was: { sectionId: 'trendsAnalysisSection', trendsSubSectionId: 'subSectionTaTrendIntelligence' }, group: CENTER, want: 'subSectionTaTrendIntelligence', label: 'Intelligence is still a tab of Center' },
        // The 2026-04 shape, which an old browser can still hold.
        { was: { coachingSubSectionId: 'subSectionQ1Review' }, group: REVIEWS, want: 'subSectionQ1Review', label: 'a pre-April state still finds Quarterly' }
    ];
    cases.forEach((c) => {
        const run = loadNav(t, c.was);
        run.nav.restoreLastViewedSection();
        t.equal(c.label, run.visible(c.group).join(','), c.want);
    });

    // Once carried over, a state is stable: loading it again changes nothing.
    const once = loadNav(t, { sectionId: 'reviewPrepSection', reviewPrepSubSectionId: 'subSectionMidYear' });
    const first = once.nav.loadUiNavState();
    once.store['devCoachingTool_uiNavState'] = JSON.stringify(first);
    const second = once.nav.loadUiNavState();
    t.equal('a migrated state migrates to itself', JSON.stringify(second), JSON.stringify(first));
    t.equal('and it names People', first.sectionId, 'peopleSection');
});
