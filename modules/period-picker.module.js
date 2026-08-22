(function () {
    'use strict';

    /**
     * PERIOD PICKER — one row of chips, everywhere a page asks "over what?"
     *
     * Four pages asked the same question four different ways: My Team with a
     * row of chips, Rankings and Matchup with a 260px dropdown of every upload
     * on file grouped by type, Snapshot with a third thing. The dropdowns were
     * accurate and unreadable — "Weekly ending 2026-05-31" nine times over,
     * with month to date buried between them — and none of them looked like the
     * others, so knowing one told you nothing about the next.
     *
     * The chips answer the question people actually ask: this week, last week,
     * the month so far, the year. Anything more specific than that is a real
     * need but a rarer one, so it lives behind one more click rather than in
     * front of the common case.
     *
     * The windows themselves come from celebrations.listShoutOutWindows, which
     * already resolves each one against what has been uploaded and says why
     * when it cannot. Two modules deriving "what is this week" separately is
     * how they end up disagreeing.
     */

    var ACCENT = '#e65100';
    var ACCENT_BG = '#fff3e0';

    function _escapeHtml(str) {
        var mod = window.DevCoachModules && window.DevCoachModules.sharedUtils;
        if (mod && mod.escapeHtml) return mod.escapeHtml(str);
        return String(str === null || str === undefined ? '' : str)
            .replace(/[&<>"']/g, function (c) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
            });
    }

    /**
     * The windows a page can offer, in the order they are shown.
     *
     * Borrowed rather than rebuilt. An unavailable window still comes back,
     * carrying the reason, because a chip that vanishes leaves "why can't I
     * look at this week" unanswerable without opening the Upload tab.
     */
    function windows(todayIso) {
        var cel = window.DevCoachModules && window.DevCoachModules.celebrations;
        if (!cel || !cel.listShoutOutWindows) return [];
        try {
            return cel.listShoutOutWindows(todayIso) || [];
        } catch (e) {
            return [];
        }
    }

    // What a chip says on hover: the range and the field it was measured
    // against, or the reason it cannot be used.
    function chipTitle(item) {
        if (item.title) return item.title;
        if (!item.available) return item.reason || '';
        if (item.dateRange && item.count) return item.dateRange + ' · ' + item.count + ' associates';
        if (item.dateRange) return item.dateRange;
        return 'Whichever upload is newest';
    }

    function chip(item, chosenId, chipClass) {
        var on = item.id === chosenId;
        var usable = item.available !== false;
        return '<button type="button" class="' + chipClass + '" data-period-id="' + _escapeHtml(item.id) + '"' +
            (usable ? '' : ' disabled') +
            ' title="' + _escapeHtml(chipTitle(item)) + '"' +
            ' style="padding:5px 12px; border:1px solid ' + (on ? ACCENT : 'var(--border)') + '; border-radius:999px;' +
            ' font-size:0.82em; font-weight:600;' +
            ' cursor:' + (usable ? 'pointer' : 'not-allowed') + '; opacity:' + (usable ? '1' : '0.45') + ';' +
            ' background:' + (on ? ACCENT_BG : 'var(--bg-surface-raised)') + ';' +
            ' color:' + (on ? ACCENT : 'var(--text-secondary)') + ';">' +
            _escapeHtml(item.label) + '</button>';
    }

    /**
     * The chips on their own, with no wrapper, so a caller repainting the row
     * can replace its contents rather than nest a second row inside the first.
     */
    function renderChips(items, chosenId, options) {
        var opts = options || {};
        var list = items || [];
        if (list.length < 2) return '';
        var chipClass = opts.chipClass || 'period-chip';
        var label = opts.label === undefined ? 'Covering:' : opts.label;
        var lead = label
            ? '<span style="font-size:0.82em; color:var(--text-tertiary);">' + _escapeHtml(label) + '</span>'
            : '';
        return lead + list.map(function (item) { return chip(item, chosenId, chipClass); }).join('');
    }

    /**
     * The row as it sits on a page: one element, one id, so it can be found
     * and repainted in place.
     */
    function renderRow(items, chosenId, options) {
        var opts = options || {};
        var chips = renderChips(items, chosenId, opts);
        if (!chips) return '';
        var trailing = opts.trailing || '';
        return '<div' + (opts.id ? ' id="' + _escapeHtml(opts.id) + '"' : '') +
            ' style="display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:' +
            (opts.marginBottom || '12px') + ';">' + chips + trailing + '</div>';
    }

    /**
     * Wire the chips in a container. onPick is handed the chip's id.
     */
    function bindRow(root, onPick, options) {
        if (!root || typeof onPick !== 'function') return;
        var chipClass = (options && options.chipClass) || 'period-chip';
        root.querySelectorAll('.' + chipClass).forEach(function (btn) {
            btn.addEventListener('click', function () {
                if (btn.disabled) return;
                onPick(btn.dataset.periodId);
            });
        });
    }

    /**
     * Which chip is lit for a page that stores a period key rather than a
     * window id. A key that is none of the windows is a deliberate pick out of
     * the full list, so nothing is lit and the caller shows that instead.
     */
    function idForKey(items, periodKey) {
        if (!periodKey) return 'latest';
        var match = (items || []).filter(function (w) { return w.key === periodKey; })[0];
        return match ? match.id : null;
    }

    function keyForId(items, id) {
        if (!id || id === 'latest') return null;
        var match = (items || []).filter(function (w) { return w.id === id; })[0];
        return match ? match.key : null;
    }

    // The option in a page's own dropdown that covers a given period. Some
    // pages key their options as "start|end" and some as "start|end|source",
    // so a prefix match catches both without the page having to say which.
    function optionForKey(selectEl, key) {
        if (!selectEl || !key) return null;
        var opts = selectEl.options || [];
        for (var i = 0; i < opts.length; i++) {
            var value = opts[i].value || '';
            if (value === key || value.indexOf(key + '|') === 0) return opts[i];
        }
        return null;
    }

    function chosenIdForSelect(items, selectEl) {
        var value = (selectEl && selectEl.value) || '';
        if (!value) return null;
        var match = (items || []).filter(function (item) {
            return item.key && (value === item.key || value.indexOf(item.key + '|') === 0);
        })[0];
        return match ? match.id : null;
    }

    /**
     * Put the same row of chips above a dropdown a page already relies on.
     *
     * Snapshot and Metric Charts read their select from several places and
     * write back to it from several more. Replacing the control would mean
     * rewriting all of that to gain a row of chips; driving it instead gains
     * the same row for the cost of a click handler, and the page carries on
     * working the way it already does.
     *
     * "Latest upload" is left out here, because it means "let the page decide"
     * and these dropdowns have no such option to select.
     */
    function mountAboveSelect(selectEl, options) {
        if (!selectEl || !selectEl.parentNode || !document) return;
        var opts = options || {};
        var rowId = opts.id || ((selectEl.id || 'period') + 'Chips');
        var chipClass = opts.chipClass || (rowId + '-chip');

        var row = document.getElementById(rowId);
        if (!row) {
            row = document.createElement('div');
            row.id = rowId;
            selectEl.parentNode.insertBefore(row, selectEl);
        }

        var items = windows().filter(function (w) { return w.key; }).map(function (w) {
            // A window whose upload is not in this dropdown cannot be picked
            // from here, whatever the stores say.
            var option = optionForKey(selectEl, w.key);
            return {
                id: w.id,
                key: w.key,
                label: w.label,
                dateRange: w.dateRange,
                count: w.count,
                available: w.available !== false && Boolean(option),
                reason: w.available === false ? w.reason : 'That period is not in this list.'
            };
        });

        if (items.length < 2) {
            row.innerHTML = '';
            row.style.display = 'none';
            return;
        }

        function paint() {
            row.style.cssText = 'display:flex; align-items:center; gap:6px; flex-wrap:wrap; margin-bottom:10px;';
            row.innerHTML = renderChips(items, chosenIdForSelect(items, selectEl), {
                chipClass: chipClass,
                label: opts.label
            });
            bindRow(row, function (id) {
                var item = items.filter(function (x) { return x.id === id; })[0];
                var option = item && optionForKey(selectEl, item.key);
                if (!option) return;
                selectEl.value = option.value;
                selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                paint();
            }, { chipClass: chipClass });
        }

        paint();

        // Picking from the dropdown lights the matching chip, so the two
        // controls never show different answers.
        if (!selectEl.dataset.periodChipsBound) {
            selectEl.dataset.periodChipsBound = '1';
            selectEl.addEventListener('change', paint);
        }
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.periodPicker = {
        optionForKey: optionForKey,
        chosenIdForSelect: chosenIdForSelect,
        mountAboveSelect: mountAboveSelect,
        windows: windows,
        renderChips: renderChips,
        renderRow: renderRow,
        bindRow: bindRow,
        idForKey: idForKey,
        keyForId: keyForId,
        chipTitle: chipTitle
    };
})();
