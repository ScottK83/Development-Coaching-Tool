'use strict';

/**
 * THE SIDEBAR
 *
 * Scott, 2026-10-21: "Dark only. Sidebar nav." to match the Downloader Bot.
 * The sidebar drives the nav buttons that were already in the page; the
 * stylesheet hides the old top row and the Today / People / Center tab rows.
 * The one thing that must never happen is a tab that loses its row and has
 * no sidebar item, because then it cannot be reached at all.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const INDEX = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'styles-v2.css'), 'utf8');

function load(t) {
    const { els } = t.installFakeBrowser();
    return { els, sidebar: t.loadModule('modules/sidebar.module.js').sidebar };
}

function fakeButton(id, onClick) {
    const classes = new Set();
    return {
        id, style: {},
        classList: {
            toggle(name, on) { if (on) classes.add(name); else classes.delete(name); return on; },
            contains: (name) => classes.has(name),
            add: (name) => classes.add(name)
        },
        setAttribute() {}, removeAttribute() {},
        click() { if (onClick) onClick(); }
    };
}

// The buttons in a section's own tab row, read from the page.
function rowButtons(sectionId) {
    const start = INDEX.indexOf(`<section id="${sectionId}"`);
    const rowAt = INDEX.indexOf('<div class="sub-nav"', start);
    const rowEnd = INDEX.indexOf('</div>', rowAt);
    return [...INDEX.slice(rowAt, rowEnd).matchAll(/id="(subNav\w+)"/g)].map((m) => m[1]);
}

suite('sidebar: every page under its group, Upload and Settings at the foot', (t) => {
    const { sidebar } = load(t);
    t.equal('the three groups, in order', sidebar.NAV_GROUPS.map((g) => g.label).join(','), 'Today,People,Center');
    t.equal('Today\'s pages', sidebar.NAV_GROUPS[0].items.map((i) => i.label).join(','), 'Day,Year to date,Snapshot,Contest');
    t.equal('People\'s pages', sidebar.NAV_GROUPS[1].items.map((i) => i.label).join(','), 'Numbers,Coach,Calls,Attendance,Follow Up,Reviews');
    t.equal('Center\'s pages', sidebar.NAV_GROUPS[2].items.map((i) => i.label).join(','), 'Rankings,Teams,Pace,Trends,Intelligence');
    t.equal('the foot', sidebar.FOOT_ITEMS.map((i) => i.label).join(','), 'Upload,Settings,Shortcuts');

    const html = sidebar.buildSidebarHtml();
    t.check('the markup names every page', ['Day', 'Calls', 'Rankings', 'Upload', 'Settings'].every((l) => html.includes(`>${l}</span>`)));
    t.check('with a line icon on each', (html.match(/<svg class="sidebar-icon"/g) || []).length === 19);
    t.check('no emoji in it', !/\p{Extended_Pictographic}/u.test(html));
    t.check('no em dash in it', !/[—–]/.test(html));
});

suite('sidebar: no tab is left without a way in', (t) => {
    const { sidebar } = load(t);
    const subs = new Set(sidebar.NAV_GROUPS.flatMap((g) => g.items.map((i) => i.sub)));
    [['coachingEmailSection', 'Today'], ['peopleSection', 'People'], ['trendsAnalysisSection', 'Center']].forEach(([section, name]) => {
        const row = rowButtons(section);
        t.check(`${name}'s row was read from the page`, row.length >= 4);
        const missing = row.filter((id) => !subs.has(id));
        t.equal(`every ${name} tab has a sidebar item (${missing.join(', ') || 'none missing'})`, missing.length, 0);
    });

    // And everything the sidebar points at is really in the page.
    const ids = [...subs, ...sidebar.FOOT_ITEMS.map((i) => i.top),
        ...sidebar.NAV_GROUPS.map((g) => g.section), 'uploadSection', 'manageDataSection'];
    const absent = ids.filter((id) => !INDEX.includes(`id="${id}"`));
    t.equal(`every id it uses exists (${absent.join(', ') || 'all present'})`, absent.length, 0);
});

suite('sidebar: the page loads it, and hides only the rows it replaces', (t) => {
    const nav = INDEX.indexOf("'modules/navigation.module.js'");
    const side = INDEX.indexOf("'modules/sidebar.module.js'");
    t.check('index.html loads the sidebar', side > -1);
    t.check('after navigation', side > nav);
    t.check('the Today, People and Center rows are hidden',
        ['#coachingEmailSection', '#peopleSection', '#trendsAnalysisSection'].every((s) => CSS.includes(`.app-shell ${s} > .form-section > .sub-nav`)));
    t.check('the inner rows (Reviews, Trends) are not: they are not direct children', !/\.app-shell #(subSectionReviews|subSectionTaTrendsGroup)[^{]*\.sub-nav/.test(CSS));
    t.check('Settings keeps its own row', !CSS.includes('.app-shell #manageDataSection > .form-section > .sub-nav'));
});

suite('sidebar: an item opens its page through the page\'s own buttons', (t) => {
    const { els, sidebar } = load(t);
    const calls = [];
    global.window.DevCoachModules.navigation = { showOnlySection: (id) => calls.push('show:' + id) };
    global.window.populatePeoplePicker = () => calls.push('picker');
    els.subNavPeCalls = fakeButton('subNavPeCalls', () => calls.push('click:subNavPeCalls'));
    els.homeBtn = fakeButton('homeBtn', () => calls.push('click:homeBtn'));

    t.check('a People tab opens', sidebar.openItem('subNavPeCalls'));
    t.equal('section, then the picker, then the tab\'s own button', calls.join(' > '), 'show:peopleSection > picker > click:subNavPeCalls');

    calls.length = 0;
    t.check('a foot item opens', sidebar.openItem('homeBtn'));
    t.equal('through its own button only', calls.join(' > '), 'click:homeBtn');
    t.equal('an unknown key opens nothing', sidebar.openItem('subNavGone'), false);
    delete global.window.populatePeoplePicker;
});

suite('sidebar: the item marked is the page on screen', (t) => {
    const { els, sidebar } = load(t);
    els.peopleSection = { style: { display: 'block' } };
    els.coachingEmailSection = { style: { display: 'none' } };
    els.subNavPeNumbers = fakeButton('subNavPeNumbers');
    els.subNavPeCalls = fakeButton('subNavPeCalls');
    els.subNavPeCalls.classList.add('is-active');
    els.subNavTdDay = fakeButton('subNavTdDay');
    els.subNavTdDay.classList.add('is-active');

    const active = sidebar.activeItem();
    t.equal('People > Calls', active && active.item.label, 'Calls');
    t.equal('under People', active && active.group.label, 'People');

    els.peopleSection.style.display = 'none';
    els.uploadSection = { style: { display: 'block' } };
    t.equal('a hidden section\'s chosen tab is not it', sidebar.activeItem()?.item.label, 'Upload');
});
