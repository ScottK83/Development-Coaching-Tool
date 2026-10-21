(function () {
    'use strict';

    /*
     * THE SIDEBAR
     *
     * Scott, 2026-10-21: make the app look like the Downloader Bot's redesign,
     * "Dark only. Sidebar nav." Every page is one click away from here, under
     * the question it answers: Today, People, Center, with Upload and Settings
     * at the foot.
     *
     * It drives the buttons that were already there instead of replacing
     * them. The old top row and the tab rows for these three sections are
     * hidden by the stylesheet but still in the page, still wired by script.js,
     * and still what restoreLastViewedSection clicks on a reload. So each tab's
     * initializer runs from exactly one place, and nothing that looks a button
     * up by id has to change. The bot did the same with its hidden tab bar.
     *
     * Tabs that hold tabs of their own (People > Reviews, Center > Trends)
     * keep their inner row in the page; the sidebar names the outer tab.
     */

    var NAV_GROUPS = [
        {
            label: 'Today',
            section: 'coachingEmailSection',
            items: [
                { label: 'Day', sub: 'subNavTdDay', icon: 'sun' },
                { label: 'Year to date', sub: 'subNavTdYear', icon: 'calendar' },
                { label: 'Snapshot', sub: 'subNavTdSnapshot', icon: 'grid' },
                { label: 'Contest', sub: 'subNavTdContest', icon: 'trophy' }
            ]
        },
        {
            label: 'People',
            section: 'peopleSection',
            // What the People button does before it opens a tab.
            prepare: function () {
                if (typeof window.populatePeoplePicker === 'function') window.populatePeoplePicker();
            },
            items: [
                { label: 'Numbers', sub: 'subNavPeNumbers', icon: 'chart' },
                { label: 'Coach', sub: 'subNavPeCoach', icon: 'message' },
                { label: 'Calls', sub: 'subNavPeCalls', icon: 'headset' },
                { label: 'Attendance', sub: 'subNavPeAttendance', icon: 'clock' },
                { label: 'Follow Up', sub: 'subNavPeFollowUp', icon: 'flag' },
                { label: 'Reviews', sub: 'subNavPeReviews', icon: 'clipboard' }
            ]
        },
        {
            label: 'Center',
            section: 'trendsAnalysisSection',
            items: [
                { label: 'Rankings', sub: 'subNavTaRankings', icon: 'medal' },
                { label: 'Teams', sub: 'subNavTaMatchup', icon: 'users' },
                { label: 'Pace', sub: 'subNavTaFutures', icon: 'gauge' },
                { label: 'Trends', sub: 'subNavTaMetricCharts', icon: 'trend' },
                { label: 'Intelligence', sub: 'subNavTaIntelligence', icon: 'bulb' }
            ]
        }
    ];

    // At the foot, as the bot keeps Settings apart from the pages.
    var FOOT_ITEMS = [
        { label: 'Upload', top: 'homeBtn', section: 'uploadSection', icon: 'upload' },
        { label: 'Settings', top: 'manageDataBtn', section: 'manageDataSection', icon: 'settings' },
        { label: 'Shortcuts', top: 'shortcutHelpBtn', icon: 'keyboard', quiet: true }
    ];

    /* Line icons, drawn here so there is nothing to load. 24px grid, stroked
     * in the text colour, the way the bot's monochrome glyphs sit in its
     * sidebar. */
    var ICON_PATHS = {
        sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
        calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
        grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
        trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
        chart: '<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="M8 17v-4M13 17V8M18 17v-7"/>',
        message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
        headset: '<path d="M3 14v-2a9 9 0 0 1 18 0v2"/><rect x="3" y="14" width="4" height="6" rx="1"/><rect x="17" y="14" width="4" height="6" rx="1"/>',
        clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
        flag: '<path d="M4 22V4M4 4h12l-2 4 2 4H4"/>',
        clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 12h6M9 16h4"/>',
        medal: '<circle cx="12" cy="8" r="6"/><path d="M15.5 13.5 17 22l-5-3-5 3 1.5-8.5"/>',
        users: '<circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85"/>',
        gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
        trend: '<path d="M22 7 13.5 15.5l-5-5L2 17"/><path d="M16 7h6v6"/>',
        bulb: '<path d="M9 18h6M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.74V16h8v-1.26A7 7 0 0 0 12 2z"/>',
        upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5M12 3v12"/>',
        settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
        keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
        target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>'
    };

    function icon(name) {
        return '<svg class="sidebar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
            + (ICON_PATHS[name] || '') + '</svg>';
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    // Every item, with the section it opens and the group it sits under.
    function allItems() {
        var out = [];
        NAV_GROUPS.forEach(function (group) {
            group.items.forEach(function (item) {
                out.push({ group: group, item: item, section: group.section, key: item.sub });
            });
        });
        FOOT_ITEMS.forEach(function (item) {
            out.push({ group: null, item: item, section: item.section || '', key: item.top });
        });
        return out;
    }

    function itemHtml(entry) {
        var item = entry.item;
        return '<button type="button" class="sidebar-item' + (item.quiet ? ' sidebar-item-quiet' : '') + '"'
            + ' id="sidebar-' + escapeHtml(entry.key) + '" data-key="' + escapeHtml(entry.key) + '"'
            + ' title="' + escapeHtml(entry.group ? entry.group.label + ': ' + item.label : item.label) + '">'
            + icon(item.icon) + '<span class="sidebar-label">' + escapeHtml(item.label) + '</span></button>';
    }

    // The markup, as a string, so it can be read and tested without a page.
    function buildSidebarHtml() {
        var entries = allItems();
        var groups = NAV_GROUPS.map(function (group) {
            var items = entries.filter(function (e) { return e.group === group; }).map(itemHtml).join('');
            return '<div class="sidebar-group" role="group" aria-label="' + escapeHtml(group.label) + '">'
                + '<div class="sidebar-group-label">' + escapeHtml(group.label) + '</div>' + items + '</div>';
        }).join('');
        var foot = entries.filter(function (e) { return !e.group; }).map(itemHtml).join('');
        return '<div class="sidebar-brand" title="Development Coaching Tool">'
            + '<span class="sidebar-brand-tile">' + icon('target') + '</span>'
            + '<span class="sidebar-brand-name">Coaching Tool</span></div>'
            + '<nav class="sidebar-nav" aria-label="Pages">' + groups + '</nav>'
            + '<div class="sidebar-foot">' + foot + '</div>';
    }

    function byKey(key) {
        return allItems().filter(function (e) { return e.key === key; })[0] || null;
    }

    // Opens an item through the page's own buttons.
    function openItem(key) {
        var entry = byKey(key);
        if (!entry) return false;
        if (entry.item.top) {
            var top = document.getElementById(entry.item.top);
            if (top) top.click();
            return Boolean(top);
        }
        var nav = window.DevCoachModules && window.DevCoachModules.navigation;
        if (nav && typeof nav.showOnlySection === 'function') nav.showOnlySection(entry.section);
        if (typeof entry.group.prepare === 'function') entry.group.prepare();
        var sub = document.getElementById(entry.item.sub);
        if (sub) sub.click();
        return Boolean(sub);
    }

    function isShown(id) {
        var el = id && document.getElementById(id);
        return Boolean(el && el.style && el.style.display === 'block');
    }

    function isActive(id) {
        var el = id && document.getElementById(id);
        return Boolean(el && el.classList && el.classList.contains('is-active'));
    }

    // The item for what is on screen: its section showing and, for a tab,
    // its tab chosen. Read off the page, so it can never disagree with it.
    function activeItem() {
        var entries = allItems();
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            if (!e.section || !isShown(e.section)) continue;
            if (e.item.sub && !isActive(e.item.sub)) continue;
            return e;
        }
        return null;
    }

    // Marks the active item and names the page above its content, the way the
    // bot titles each page: the group in small type, the page beneath it.
    function sync() {
        var root = document.getElementById('appSidebar');
        if (!root) return null;
        var active = activeItem();
        allItems().forEach(function (e) {
            var el = document.getElementById('sidebar-' + e.key);
            if (!el) return;
            var on = Boolean(active && active.key === e.key);
            el.classList.toggle('is-active', on);
            if (on) el.setAttribute('aria-current', 'page');
            else el.removeAttribute('aria-current');
        });
        var eyebrow = document.getElementById('pageEyebrow');
        var title = document.getElementById('pageTitle');
        if (title) title.textContent = active ? active.item.label : (isShown('debugSection') ? 'Debug' : '');
        if (eyebrow) {
            eyebrow.textContent = active && active.group ? active.group.label : '';
            eyebrow.style.display = active && active.group ? '' : 'none';
        }
        return active;
    }

    function mount() {
        if (document.getElementById('appSidebar')) return;
        var container = document.querySelector('.container');
        if (!container || !container.parentNode) return;

        var shell = document.createElement('div');
        shell.className = 'app-shell';
        container.parentNode.insertBefore(shell, container);

        var aside = document.createElement('aside');
        aside.id = 'appSidebar';
        aside.className = 'app-sidebar';
        aside.setAttribute('aria-label', 'Main');
        aside.innerHTML = buildSidebarHtml();
        shell.appendChild(aside);
        shell.appendChild(container);

        // The page title sits where the old app title was.
        var header = container.querySelector('header');
        if (header && !document.getElementById('pageTitle')) {
            var heading = document.createElement('div');
            heading.className = 'page-heading';
            heading.innerHTML = '<div id="pageEyebrow" class="page-eyebrow"></div><h1 id="pageTitle" class="page-title"></h1>';
            header.insertBefore(heading, header.firstChild);
        }

        aside.addEventListener('click', function (event) {
            var btn = event.target && event.target.closest ? event.target.closest('.sidebar-item') : null;
            if (!btn) return;
            openItem(btn.getAttribute('data-key'));
            sync();
        });
        sync();
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.sidebar = {
        NAV_GROUPS: NAV_GROUPS,
        FOOT_ITEMS: FOOT_ITEMS,
        buildSidebarHtml: buildSidebarHtml,
        openItem: openItem,
        activeItem: activeItem,
        sync: sync,
        mount: mount
    };
})();
