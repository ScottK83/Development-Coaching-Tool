(function () {
    'use strict';

    /**
     * PERIOD COMPARISON
     *
     * What the chosen window is measured against.
     *
     * My Team had two controls that both claimed to own time and never spoke to
     * each other. The "Covering" chips picked which upload the shout-out and the
     * evidence panel were ranked over, and the weekday tabs picked which upload
     * every private message was written from. The second one never asked the
     * first anything: resolveCheckinPeriods took the newest two week-shaped
     * uploads and handed those to every generator, whatever the chips said.
     *
     * So picking "Month to date" re-ranked the celebrations over September and
     * left the header above them reading "Covers last week" and the messages
     * below them comparing two weeks. One screen, three stretches of time, and
     * nothing on it admitting the disagreement.
     *
     * This is the one answer. Hand it the window a person picked and it says
     * which two periods that window compares, what unit they are in, and what to
     * call them. Every surface on the page reads it, so they cannot drift.
     *
     * The pairs, which are the rules Scott stated:
     *
     *   Month to date   this month so far against the WHOLE of last month.
     *                   Not the same stretch of last month: the metrics are
     *                   rates, so the uneven length does not distort them, and
     *                   the whole month is the number people already know as
     *                   their August result. A like-for-like cut would be a
     *                   figure nobody has ever seen on a report.
     *   This week       the week so far against the last completed week.
     *   Last week       that week against the one before it.
     *   Last month      that month's upload against the month before it,
     *                   uploaded or rebuilt, by the same rule as month to date.
     *   Yesterday       that day file against the day file before it.
     *   Year to date    against the previous year-to-date report on file.
     *
     * A window with nothing to compare against still resolves. It comes back
     * with a baseline of null and the reason, because "September so far, and
     * August was never uploaded" is a different fact from "no data" and has a
     * different fix.
     *
     * Everything is derived at call time from period-index and period-compare,
     * so nothing here holds a second opinion about what a week is.
     */

    // How the prose should read about this window. fmtRange already speaks
    // day/week/month/quarter, so this is the word it gets told.
    var UNIT_BY_WINDOW = {
        day: 'day',
        thisWeek: 'week',
        lastWeek: 'week',
        mtd: 'month',
        lastMonth: 'month',
        ytd: 'year',
        latest: 'week'
    };

    function _mods() { return window.DevCoachModules || {}; }
    function _periodIndex() { return _mods().periodIndex; }
    function _periodCompare() { return _mods().periodCompare; }

    function _monthPrefix() {
        var pc = _periodCompare();
        return (pc && pc.MONTH_KEY_PREFIX) || 'month:';
    }

    function _friendly(dateStr) {
        try {
            var d = new Date(String(dateStr) + 'T00:00:00');
            if (isNaN(d.getTime())) return String(dateStr || '');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        } catch (e) { return String(dateStr || ''); }
    }

    function _monthLabel(month) {
        var pc = _periodCompare();
        if (pc && pc.monthLabel) return pc.monthLabel(month);
        return String(month);
    }

    // The month a month string sits before. Written here rather than borrowed
    // because period-compare keeps its copy private, and crossing December is
    // the whole reason this exists: January month-to-date compares against last
    // December, which lives in the previous year's buckets.
    function _prevMonth(month) {
        var parts = String(month).split('-');
        var y = parseInt(parts[0], 10);
        var m = parseInt(parts[1], 10);
        if (!y || !m) return null;
        m -= 1;
        if (m === 0) { m = 12; y -= 1; }
        return y + '-' + String(m).padStart(2, '0');
    }

    // ==========================
    // Reading a period, whatever shape its key is
    // ==========================

    /**
     * A month rebuilt from its weeks, cached for the render.
     *
     * The private round and the high five round both walk the whole roster, and
     * every name asks for the same two periods. Rebuilding August eighteen times
     * to write eighteen messages is the difference between a page that paints
     * and a page that hangs. resetCache is called when the page redraws, the
     * same way center-ranking drops its timeline cache per render, so an upload
     * between renders can never leave a stale month on screen.
     */
    var _monthCache = {};

    function resetCache() {
        _monthCache = {};
    }

    function _monthPeriod(month) {
        if (Object.prototype.hasOwnProperty.call(_monthCache, month)) return _monthCache[month];

        var pc = _periodCompare();
        var built = null;
        try {
            built = (pc && pc.buildMonthAggregate)
                ? pc.buildMonthAggregate(month, parseInt(String(month).slice(0, 4), 10))
                : null;
        } catch (e) { built = null; }

        // Shaped like a stored period on purpose. Everything downstream reads
        // period.employees and period.metadata, and a rebuilt month that needed
        // its own accessor would be a second code path through every generator.
        var period = built ? {
            employees: built.employees,
            metadata: {
                startDate: built.spanStart || (month + '-01'),
                endDate: built.spanEnd || '',
                periodType: 'month-agg',
                label: built.label
            }
        } : null;

        _monthCache[month] = period;
        return period;
    }

    /**
     * The period behind any key this module can hand out.
     *
     * Weekly, year-to-date and day files are all stored; a rebuilt month is not,
     * and never will be, because it is derived. Callers should not have to know
     * which is which, and until now the message generators only knew how to read
     * the weekly store, which is why naming any other period at them produced
     * nothing rather than an error.
     */
    function periodFor(key) {
        if (!key) return null;

        var prefix = _monthPrefix();
        if (String(key).indexOf(prefix) === 0) return _monthPeriod(String(key).slice(prefix.length));

        var weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        var ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        var daily = typeof dailyData !== 'undefined' ? dailyData : {};
        return weekly[key] || ytd[key] || daily[key] || null;
    }

    // ==========================
    // Finding the other side
    // ==========================

    function _entryFor(index, key) {
        if (!index || !key) return null;
        var hits = (index.all || []).filter(function (e) { return e.key === key; });
        return hits.length ? hits[hits.length - 1] : null;
    }

    function _newestWeekLike(index) {
        var pi = _periodIndex();
        if (!pi || !index) return null;
        var keys = pi.weekLikeKeys(index);
        return keys.length ? _entryFor(index, keys[keys.length - 1]) : null;
    }

    // The entry of the same type immediately before this one. The fallback for
    // "Latest upload", which carries no promise about what it is, so the only
    // honest baseline is the previous one of whatever it turned out to be.
    function _previousOfSameType(index, entry) {
        if (!index || !entry) return null;
        var earlier = (index.all || []).filter(function (e) {
            return e.type === entry.type && e.end < entry.end;
        });
        return earlier.length ? earlier[earlier.length - 1] : null;
    }

    function _dayBaseline(index, entry) {
        var pi = _periodIndex();
        if (!pi || !entry) return { key: null, label: '', reason: 'No day file to compare against.' };
        var earlier = pi.ofTypes(index, 'daily').filter(function (e) { return e.end < entry.end; });
        if (!earlier.length) {
            return { key: null, label: '', reason: 'Only one day file on file, so there is no day before it to compare against.' };
        }
        var prev = earlier[earlier.length - 1];
        return { key: prev.key, label: _friendly(prev.end), reason: '' };
    }

    /**
     * The whole of last month.
     *
     * An uploaded month wins over a rebuild for its own month, which is already
     * how getMonthBuckets resolves it, so asking the buckets rather than the
     * stores gets that precedence for free. `comparable` rather than `usable` is
     * the right list: a month covering a fraction of the centre stays selectable
     * as a period in its own right and still cannot anchor a comparison, because
     * an 18-person month against a 127-person one is not a like-for-like move.
     */
    function _monthBaseline(entry) {
        var pc = _periodCompare();
        if (!pc || !pc.getMonthBuckets) {
            return { key: null, label: '', reason: 'The month rebuild is not loaded, so last month cannot be assembled.' };
        }
        if (!entry || !entry.end) {
            return { key: null, label: '', reason: 'This month has no end date on it, so last month cannot be placed.' };
        }

        var prev = _prevMonth(String(entry.end).slice(0, 7));
        if (!prev) return { key: null, label: '', reason: 'Last month could not be worked out from this one.' };

        var buckets;
        try {
            buckets = pc.getMonthBuckets(parseInt(prev.slice(0, 4), 10));
        } catch (e) {
            return { key: null, label: '', reason: 'Last month could not be assembled from what is uploaded.' };
        }

        var label = _monthLabel(prev);
        if ((buckets.comparable || []).indexOf(prev) > -1) {
            return { key: _monthPrefix() + prev, label: label, reason: '' };
        }

        // Three different misses with three different fixes, so the panel says
        // which one it is rather than "no comparison available".
        if ((buckets.usable || []).indexOf(prev) > -1) {
            return {
                key: null, label: '',
                reason: label + ' only covers part of the call center, so it cannot anchor a comparison.'
            };
        }
        if ((buckets.monthsMap || {})[prev]) {
            return {
                key: null, label: '',
                reason: label + ' has too few weeks uploaded to stand as a month yet.'
            };
        }
        return { key: null, label: '', reason: 'Nothing uploaded covers ' + label + ' yet.' };
    }

    function _ytdBaseline(index, entry) {
        var pi = _periodIndex();
        if (!pi || !entry) return { key: null, label: '', reason: 'No year-to-date report to compare against.' };
        var earlier = pi.ofTypes(index, 'ytd').filter(function (e) { return e.end < entry.end; });
        if (!earlier.length) {
            return { key: null, label: '', reason: 'This is the only year-to-date report on file, so there is nothing before it.' };
        }
        var prev = earlier[earlier.length - 1];
        return { key: prev.key, label: 'the report through ' + _friendly(prev.end), reason: '' };
    }

    function _weekBaseline(index, entry, skipEntry) {
        var pi = _periodIndex();
        if (!pi || !entry) return { key: null, label: '', reason: 'No finished week to compare against.' };

        // "This week so far" compares against the last completed week, which is
        // a different entry from itself. "Last week" compares against the week
        // before it, which means stepping past the entry it already is.
        var target = skipEntry
            ? pi.weekBefore(index, entry)
            : pi.lastCompletedWeek(index, pi.isoOf(new Date()));

        if (!target) {
            return {
                key: null, label: '',
                reason: skipEntry
                    ? 'Only one finished week on file, so there is no week before it.'
                    : 'No finished week on file to compare this one against.'
            };
        }
        return { key: target.key, label: skipEntry ? 'the week before' : 'last week', reason: '' };
    }

    function _baselineFor(windowId, index, entry) {
        if (windowId === 'day') return _dayBaseline(index, entry);
        if (windowId === 'mtd' || windowId === 'lastMonth') return _monthBaseline(entry);
        if (windowId === 'ytd') return _ytdBaseline(index, entry);
        if (windowId === 'thisWeek') return _weekBaseline(index, entry, false);
        if (windowId === 'lastWeek') return _weekBaseline(index, entry, true);

        var prev = _previousOfSameType(index, entry);
        if (!prev) return { key: null, label: '', reason: 'Nothing earlier of the same shape to compare against.' };
        return { key: prev.key, label: 'the upload before it', reason: '' };
    }

    // ==========================
    // What to call the side you are looking at
    // ==========================

    function _latestLabel(windowId, entry, todayIso) {
        if (!entry) return '';
        var pi = _periodIndex();

        if (windowId === 'day') {
            if (entry.end === todayIso) return 'today';
            var yesterday = pi && pi.shiftDays ? pi.shiftDays(todayIso, -1) : null;
            if (entry.end === yesterday) return 'yesterday';
            return _friendly(entry.end);
        }
        if (windowId === 'mtd') return _monthLabel(String(entry.end).slice(0, 7)) + ' so far';
        if (windowId === 'lastMonth') return _monthLabel(String(entry.end).slice(0, 7));
        if (windowId === 'thisWeek') return 'this week so far';
        if (windowId === 'lastWeek') return 'last week';
        if (windowId === 'ytd') return 'the year so far';
        return 'the latest upload';
    }

    /**
     * The sentence the page puts under its own heading.
     *
     * One line, lower case where it reads as prose, because it sits after a
     * label rather than starting a sentence of its own.
     */
    function describe(comparison) {
        if (!comparison || !comparison.latestKey) return '';
        if (!comparison.baselineKey) return comparison.latestLabel + ', on its own';
        return comparison.latestLabel + ' against ' + comparison.baselineLabel;
    }

    /**
     * The whole answer for one window.
     *
     * Takes the window object celebrations already resolved rather than an id,
     * so the current side is the exact upload the shout-out is being ranked
     * over. Deriving it a second time here is how the two would come to
     * disagree about which file "month to date" means.
     */
    function resolve(chosenWindow, todayIso) {
        var pi = _periodIndex();
        var win = chosenWindow || { id: 'latest', label: 'Latest upload', key: null };
        var today = todayIso || (pi ? pi.isoOf(new Date()) : '');
        var index = pi ? pi.currentIndex() : null;

        var unit = UNIT_BY_WINDOW[win.id] || 'week';

        // "Latest upload" carries no key on purpose: it means "let the page
        // decide", which is the newest week-shaped file.
        var entry = win.key ? _entryFor(index, win.key) : _newestWeekLike(index);
        if (!entry) {
            return {
                windowId: win.id,
                windowLabel: win.label || '',
                unit: unit,
                latestKey: null,
                baselineKey: null,
                latestLabel: '',
                baselineLabel: '',
                headline: '',
                reason: win.reason || 'Nothing uploaded covers that stretch of time yet.'
            };
        }

        var baseline = _baselineFor(win.id, index, entry);
        var out = {
            windowId: win.id,
            windowLabel: win.label || '',
            unit: unit,
            latestKey: entry.key,
            baselineKey: baseline.key,
            latestLabel: _latestLabel(win.id, entry, today),
            baselineLabel: baseline.label,
            latestEnd: entry.end,
            latestStart: entry.start,
            headline: '',
            reason: baseline.reason
        };
        out.headline = describe(out);
        return out;
    }

    function resolveById(windowId, todayIso) {
        var cel = _mods().celebrations;
        var win = null;
        try {
            win = cel && cel.resolveShoutOutWindow ? cel.resolveShoutOutWindow(windowId, todayIso) : null;
        } catch (e) { win = null; }
        return resolve(win, todayIso);
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.periodComparison = {
        UNIT_BY_WINDOW: UNIT_BY_WINDOW,
        resolve: resolve,
        resolveById: resolveById,
        describe: describe,
        periodFor: periodFor,
        resetCache: resetCache
    };
})();
