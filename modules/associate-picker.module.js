/**
 * Associate Picker Module
 *
 * One place that knows how to turn a list of associate names into <option>
 * elements, and nothing else.
 *
 * What this owns: team filtering, sort order, dedupe, HTML escaping,
 * placeholder text, and what an empty list looks like.
 *
 * What this deliberately does NOT own: where the names come from. There are
 * eight different definitions of "the roster" in this app -- Coaching reads the
 * latest period only, Call Listening includes anyone with a saved call log,
 * Trends is scoped to one period, Reliability comes out of its own store -- and
 * those differences are real. Each caller still passes its own list. See
 * AUDIT.md 2.3 for the full table.
 *
 * The duplication being removed here is the eleven near-identical copies of
 * "wipe the select, loop, createElement, set value and textContent, append",
 * each of which had drifted into its own placeholder string and its own sort.
 */
(function () {
    'use strict';

    // The majority spelling before consolidation (nine of the fourteen pickers),
    // and "associate" rather than "employee" because that is the word the rest
    // of the app uses.
    var DEFAULT_PLACEHOLDER = '-- Choose an associate --';

    function escapeHtml(value) {
        var su = window.DevCoachModules && window.DevCoachModules.sharedUtils;
        if (su && typeof su.escapeHtml === 'function') return su.escapeHtml(value);
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /**
     * The team-selection context, built once for a whole list.
     *
     * isAssociateIncludedByTeamFilter takes an optional context and rebuilds it
     * when the argument is missing. This used to call it per name without one,
     * so filling a 127-name picker rebuilt the entire context 127 times, and
     * each rebuild loads weekly, YTD and daily data and walks every employee
     * row in all three. One dropdown cost about 1.3 seconds; hoisting the build
     * out of the loop takes the same dropdown to roughly 13 milliseconds.
     */
    function teamFilterContext() {
        var tf = window.DevCoachModules && window.DevCoachModules.teamFilter;
        if (!tf || typeof tf.getTeamSelectionContext !== 'function') return null;
        return tf.getTeamSelectionContext();
    }

    function includedByTeamFilter(name, context) {
        var tf = window.DevCoachModules && window.DevCoachModules.teamFilter;
        if (!tf || typeof tf.isAssociateIncludedByTeamFilter !== 'function') return true;
        return tf.isAssociateIncludedByTeamFilter(name, context);
    }

    /**
     * Trim, drop blanks, dedupe, optionally apply the team filter, then sort.
     *
     * Sorting is localeCompare rather than a bare .sort(). Two pickers already
     * did it that way and the rest did not; for plain ASCII names the two agree,
     * and where they disagree -- accents, a lowercase particle in a surname --
     * localeCompare is the one that orders people's names correctly.
     *
     * The team filter defaults ON. One picker opts out (Follow-Up), and it has
     * to say so out loud at the call site, which is the point: an exception you
     * can see beats an exception that is merely absent.
     */
    function normalizeNames(names, options) {
        var opts = options || {};
        var applyTeamFilter = opts.teamFilter !== false;
        var seen = Object.create(null);
        var out = [];

        // Built once here rather than once per name. Nothing about it changes
        // while this loop runs.
        var filterContext = applyTeamFilter ? teamFilterContext() : null;

        (Array.isArray(names) ? names : []).forEach(function (raw) {
            var name = String(raw == null ? '' : raw).trim();
            if (!name) return;
            if (seen[name]) return;
            if (applyTeamFilter && !includedByTeamFilter(name, filterContext)) return;
            seen[name] = true;
            out.push(name);
        });

        // sort: false keeps the order the caller handed over. That exists for
        // orderings which mean something -- Reliability lists by review priority,
        // worst first, and alphabetising it would destroy the feature rather
        // than tidy it. Alphabetical stays the default everywhere else.
        if (opts.sort === false) return out;
        return out.sort(function (a, b) { return a.localeCompare(b); });
    }

    function labelFor(name, options) {
        var opts = options || {};
        return typeof opts.label === 'function' ? String(opts.label(name)) : name;
    }

    /**
     * Fill a <select> with associate options.
     *
     * An empty roster leaves the placeholder standing on its own rather than
     * inventing a disabled "no data" row. Whether the surrounding panel then
     * hides itself, shows a status line or does nothing is the feature's
     * business, not the picker's, and is left exactly as it was.
     *
     * Returns the normalized names so callers can keep using the list.
     */
    function populateSelect(select, names, options) {
        if (!select) return [];
        var opts = options || {};
        var normalized = normalizeNames(names, opts);
        var previous = opts.preserveSelection ? select.value : '';

        select.innerHTML = '';

        var placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = opts.placeholder != null ? String(opts.placeholder) : DEFAULT_PLACEHOLDER;
        select.appendChild(placeholder);

        // Options that carry meaning rather than naming a person, such as the
        // "All Associates" entry on the Trends picker.
        (opts.extraOptions || []).forEach(function (extra) {
            var option = document.createElement('option');
            option.value = String(extra.value);
            option.textContent = String(extra.label);
            select.appendChild(option);
        });

        normalized.forEach(function (name) {
            var option = document.createElement('option');
            option.value = name;
            option.textContent = labelFor(name, opts);
            select.appendChild(option);
        });

        var wanted = opts.selected != null ? String(opts.selected) : previous;
        if (wanted && normalized.indexOf(wanted) !== -1) select.value = wanted;

        return normalized;
    }

    /**
     * The same options as a string, for the two pickers that are built inside a
     * larger innerHTML rather than appended to an existing element. Escaped, so
     * a name containing a quote or an angle bracket cannot break out.
     */
    function optionsHtml(names, options) {
        var opts = options || {};
        var normalized = normalizeNames(names, opts);
        var selected = opts.selected != null ? String(opts.selected) : '';
        var placeholder = opts.placeholder != null ? String(opts.placeholder) : DEFAULT_PLACEHOLDER;

        var html = ['<option value="">' + escapeHtml(placeholder) + '</option>'];

        (opts.extraOptions || []).forEach(function (extra) {
            html.push('<option value="' + escapeHtml(extra.value) + '">' + escapeHtml(extra.label) + '</option>');
        });

        normalized.forEach(function (name) {
            html.push('<option value="' + escapeHtml(name) + '"'
                + (name === selected ? ' selected' : '') + '>'
                + escapeHtml(labelFor(name, opts)) + '</option>');
        });

        return html.join('');
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.associatePicker = {
        DEFAULT_PLACEHOLDER: DEFAULT_PLACEHOLDER,
        normalizeNames: normalizeNames,
        populateSelect: populateSelect,
        optionsHtml: optionsHtml
    };
})();
