(function () {
    'use strict';

    // ============================================
    // SELECTED ASSOCIATE MODULE
    //
    // One selected person, shared by every tab.
    //
    // The app grew twelve independent employee dropdowns — Coaching, Call
    // Listening, Mid-Year, Year-End, On/Off Tracker, Trends, PTO, 1-on-1,
    // Attendance, and the rest. Each read its own DOM element, so working a
    // single associate meant re-picking them in every tab you visited. The
    // app was organised by tool; the job is organised by person.
    //
    // This module holds the selection once. Registered pickers stay in sync
    // in both directions: choosing someone anywhere sets the global, and any
    // picker that later gains that person as an option adopts it.
    //
    // Pickers are populated lazily, when their tab first initialises. Rather
    // than patch twelve population sites (and rely on the thirteenth
    // remembering to call us), each registered <select> is watched for option
    // changes and re-syncs itself. Registration is therefore safe before the
    // element exists or before it has any options.
    // ============================================

    var STORAGE_PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
    var STORAGE_KEY = STORAGE_PREFIX + 'selectedAssociate';

    // Every employee picker in the app. Adding one here is all it takes to
    // join the shared selection.
    var PICKER_IDS = [
        'coachingEmployeeSelect',
        'yearEndEmployeeSelect',
        'onOffTrackerEmployeeSelect',
        'midYearEmployeeSelect',
        'callListeningEmployeeSelect',
        'trendEmployeeSelect',
        'trendEmployeeSelector',
        'ptoAssociateSelect',
        'summaryAssociateSelect',
        'oneOnOneAssociateSelect',
        'relEmployeeSelect',
        'sentimentUploadAssociate'
    ];

    var selected = '';
    var subscribers = [];
    var observed = {};       // id -> MutationObserver
    var bound = {};          // id -> true once the change handler is attached
    // Guards the write-back loop: setting .value on a picker to mirror the
    // global must not be read as the user choosing someone.
    var syncing = false;

    function load() {
        try { return localStorage.getItem(STORAGE_KEY) || ''; }
        catch (e) { return ''; }
    }
    function persist(name) {
        try {
            if (name) localStorage.setItem(STORAGE_KEY, name);
            else localStorage.removeItem(STORAGE_KEY);
        } catch (e) { /* private mode / quota — selection is still live in memory */ }
    }

    function hasOption(select, name) {
        if (!select || !name) return false;
        for (var i = 0; i < select.options.length; i++) {
            if (select.options[i].value === name) return true;
        }
        return false;
    }

    // Push the current selection into one picker, if that picker knows the
    // person. A picker that doesn't list them is left alone rather than
    // blanked — a roster gap shouldn't erase what you picked elsewhere.
    function applyTo(select) {
        if (!select || !selected) return false;
        if (select.value === selected) return false;
        if (!hasOption(select, selected)) return false;
        syncing = true;
        try {
            select.value = selected;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        } finally {
            syncing = false;
        }
        return true;
    }

    function applyToAll() {
        PICKER_IDS.forEach(function (id) {
            applyTo(document.getElementById(id));
        });
    }

    function get() {
        return selected;
    }

    function set(name, options) {
        var next = String(name == null ? '' : name).trim();
        if (next === selected) return;
        selected = next;
        persist(selected);
        if (!(options && options.silent)) applyToAll();
        renderChip();
        subscribers.forEach(function (fn) {
            try { fn(selected); } catch (e) { console.error('selectedAssociate subscriber failed:', e); }
        });
    }

    function clear() {
        set('');
    }

    function subscribe(fn) {
        if (typeof fn === 'function') subscribers.push(fn);
        return function () {
            var i = subscribers.indexOf(fn);
            if (i !== -1) subscribers.splice(i, 1);
        };
    }

    // Watch a picker so that (a) user choices flow out to the global and
    // (b) a repopulated picker adopts the current selection.
    function attach(id) {
        var select = document.getElementById(id);
        if (!select) return;

        if (!bound[id]) {
            select.addEventListener('change', function () {
                if (syncing) return;
                // A picker cleared to "all"/"none" shouldn't wipe the person
                // you're working; only a real name updates the global.
                if (select.value) set(select.value);
            });
            bound[id] = true;
        }

        if (!observed[id]) {
            var observer = new MutationObserver(function () {
                applyTo(select);
            });
            observer.observe(select, { childList: true });
            observed[id] = observer;
        }

        applyTo(select);
    }

    function attachAll() {
        PICKER_IDS.forEach(attach);
    }

    /* ── Header chip ── */

    // Without a visible marker, a dropdown that pre-fills itself looks like a
    // bug. The chip says who is carried between tabs, and lets you drop them.
    function renderChip() {
        var host = document.getElementById('selectedAssociateChip');
        if (!host) return;
        if (!selected) {
            host.style.display = 'none';
            host.innerHTML = '';
            return;
        }
        var esc = (window.DevCoachModules && window.DevCoachModules.sharedUtils
            && window.DevCoachModules.sharedUtils.escapeHtml) || function (s) { return String(s); };
        host.style.display = '';
        host.innerHTML =
            '<span class="chip-label">Working</span>' +
            '<span class="chip-name">' + esc(selected) + '</span>' +
            '<button type="button" class="chip-clear" aria-label="Clear selected associate">&#10005;</button>';
        var btn = host.querySelector('.chip-clear');
        if (btn) btn.addEventListener('click', clear);
    }

    function initialize() {
        selected = load();
        attachAll();
        renderChip();

        // Tabs mount their pickers on first visit, so re-attach whenever the
        // user navigates rather than assuming everything exists at boot.
        document.addEventListener('click', function (e) {
            if (!e.target.closest) return;
            if (e.target.closest('.top-nav-btn, [id^="subNav"], [id^="innerNav"]')) {
                setTimeout(attachAll, 60);
            }
        }, true);
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.selectedAssociate = {
        initialize: initialize,
        attachAll: attachAll,
        get: get,
        set: set,
        clear: clear,
        subscribe: subscribe,
        PICKER_IDS: PICKER_IDS
    };
})();
