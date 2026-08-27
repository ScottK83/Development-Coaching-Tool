(function () {
    'use strict';

    /**
     * PERIOD INDEX
     *
     * One answer to "what periods do I have, of what type, covering what dates".
     *
     * Uploads arrive at five granularities across three stores, and until now
     * every consumer rolled its own filter for which keys counted as what. The
     * same question — is this key a week? — was spelled three different ways,
     * and two of those spellings sat in the same file disagreeing with each
     * other. That is how a perfectly good week-in-progress upload became
     * invisible to the midweek check-in.
     *
     * The granularities do not compete. Each owns a different question: daily
     * is how today went, week-in-progress is how this week is going, week is
     * how that week ended, month and quarter are whether a trend is real, YTD
     * is where the year stands. Trouble only starts where two of them can
     * answer the same question and nothing says which wins — so the precedence
     * for those cases is declared here, once, instead of being decided afresh
     * by whoever writes the next feature.
     *
     * Everything above the storage reads is pure, so the rules are testable
     * without a browser or an upload.
     */

    // An upload with no recorded type predates the type being written, and
    // those were all weeks.
    const DEFAULT_TYPE = 'week';

    // Shaped like a week, though not necessarily a finished one. "Custom" is a
    // hand-picked range, which in practice is always a partial week.
    const WEEK_LIKE = ['week', 'week-in-progress', 'custom'];

    // A week that has actually ended, which is a different question and the
    // reason the two spellings disagreed rather than one simply being wrong.
    const COMPLETE_WEEK = ['week'];

    /**
     * When two granularities can answer the same question, this is the order
     * they get asked in. First match wins.
     */
    const PRECEDENCE = {
        thisWeekSoFar: ['week-in-progress', 'custom', 'daily'],
        lastCompletedWeek: ['week'],
        yearToDate: ['ytd'],
        month: ['month'],
        quarter: ['quarter']
    };

    function isoOf(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    // Takes an ISO string or a Date, because callers hold both. Noon avoids
    // the date sliding either way across a timezone boundary.
    function mondayOf(value) {
        const when = value instanceof Date
            ? new Date(value.getTime())
            : new Date(String(value) + 'T12:00:00');
        if (Number.isNaN(when.getTime())) return '';
        when.setHours(12, 0, 0, 0);
        const dow = when.getDay();
        when.setDate(when.getDate() - (dow === 0 ? 6 : dow - 1));
        return isoOf(when);
    }

    function shiftDays(iso, days) {
        const when = new Date(String(iso) + 'T12:00:00');
        if (Number.isNaN(when.getTime())) return iso;
        when.setDate(when.getDate() + days);
        return isoOf(when);
    }

    /**
     * One upload, normalised.
     *
     * The key carries the range as `start|end`, but metadata is more
     * trustworthy when present because a key can be re-used. Returns null for
     * anything that has no usable end date, since a period that cannot be
     * placed in time cannot answer any question.
     */
    function parsePeriod(key, period, storeName) {
        if (!key) return null;
        const meta = (period && period.metadata) || {};

        const parts = String(key).split('|');
        const keyStart = parts.length > 1 ? parts[0] : '';
        const keyEnd = parts.length > 1 ? parts[1] : parts[0];

        const end = String(meta.endDate || keyEnd || '').slice(0, 10);
        if (!end) return null;

        const start = String(meta.startDate || keyStart || end).slice(0, 10);
        const type = String(meta.periodType || DEFAULT_TYPE);

        return {
            key,
            store: storeName || '',
            type,
            start,
            end,
            label: meta.label || '',
            employeeCount: Array.isArray(period && period.employees) ? period.employees.length : 0
        };
    }

    /**
     * Every upload across every store, oldest first.
     *
     * stores: { dailyData, weeklyData, ytdData } — any may be omitted.
     */
    function buildIndex(stores) {
        const input = stores || {};
        const all = [];

        [['daily', input.dailyData], ['weekly', input.weeklyData], ['ytd', input.ytdData]].forEach(([name, store]) => {
            Object.keys(store || {}).forEach(key => {
                const entry = parsePeriod(key, store[key], name);
                if (entry) all.push(entry);
            });
        });

        all.sort((a, b) => a.end.localeCompare(b.end) || String(a.key).localeCompare(String(b.key)));

        const byType = {};
        all.forEach(entry => {
            if (!byType[entry.type]) byType[entry.type] = [];
            byType[entry.type].push(entry);
        });

        return { all, byType };
    }

    function isWeekLike(type) {
        return WEEK_LIKE.indexOf(String(type || DEFAULT_TYPE)) > -1;
    }

    function isCompleteWeek(type) {
        return COMPLETE_WEEK.indexOf(String(type || DEFAULT_TYPE)) > -1;
    }

    function ofTypes(index, types) {
        const wanted = Array.isArray(types) ? types : [types];
        return (index && index.all || []).filter(e => wanted.indexOf(e.type) > -1);
    }

    function latest(entries) {
        return entries && entries.length ? entries[entries.length - 1] : null;
    }

    /**
     * Keys only, for callers that still hand period keys around.
     *
     * Ordered by end date rather than by key. The old filters sorted the keys
     * themselves, which sorts by start date and happens to give the same answer
     * for tidy weekly uploads. It stops being the same answer once ranges
     * overlap — a custom range starting in early July but running to the 10th
     * sorts before a week that starts on the 3rd and ends on the 9th, even
     * though the week finished first. End order is what "latest period" has
     * always meant, so this is the ordering being made correct rather than
     * merely being made shared.
     */
    function weekLikeKeys(index) {
        return (index && index.all || []).filter(e => isWeekLike(e.type)).map(e => e.key);
    }

    function completeWeekKeys(index) {
        return (index && index.all || []).filter(e => isCompleteWeek(e.type)).map(e => e.key);
    }

    function keysOfType(index, type) {
        return ofTypes(index, type).map(e => e.key);
    }

    // --- The questions ---

    /**
     * Whatever covers the week currently in progress.
     *
     * A week-in-progress upload and a pile of daily uploads can both answer
     * this. The upload wins when it exists, because it is the same numbers
     * already aggregated — asking for day files on top of it is asking for the
     * same data twice.
     */
    function thisWeekSoFar(index, todayIso) {
        const weekStart = mondayOf(todayIso);
        if (!weekStart) return null;

        for (const type of PRECEDENCE.thisWeekSoFar) {
            const covering = ofTypes(index, type).filter(e => e.end >= weekStart);
            if (!covering.length) continue;
            return {
                source: type,
                entries: covering,
                primary: latest(covering)
            };
        }
        return null;
    }

    /**
     * The most recent week that has actually finished.
     *
     * Deliberately excludes anything ending inside the current week, so a
     * Monday recap describes last week rather than the two days of this one
     * that happen to be uploaded.
     */
    function lastCompletedWeek(index, todayIso) {
        const weekStart = mondayOf(todayIso);
        const finished = ofTypes(index, PRECEDENCE.lastCompletedWeek)
            .filter(e => !weekStart || e.end < weekStart);
        return latest(finished);
    }

    /**
     * Whether the newest completed week is genuinely last week, or something
     * older standing in for it. Callers that say "here is your last week"
     * need to know the difference.
     */
    function isFreshFor(entry, todayIso) {
        if (!entry) return false;
        const lastWeekStart = shiftDays(mondayOf(todayIso), -7);
        return entry.end >= lastWeekStart;
    }

    function weekBefore(index, entry) {
        if (!entry) return null;
        const earlier = ofTypes(index, PRECEDENCE.lastCompletedWeek).filter(e => e.end < entry.end);
        return latest(earlier);
    }

    function yearToDate(index) {
        return latest(ofTypes(index, PRECEDENCE.yearToDate));
    }

    function previousYearToDate(index) {
        const all = ofTypes(index, PRECEDENCE.yearToDate);
        return all.length > 1 ? all[0] : null;
    }

    function latestOfType(index, type) {
        return latest(ofTypes(index, type));
    }

    function previousOfType(index, type) {
        const all = ofTypes(index, type);
        return all.length > 1 ? all[all.length - 2] : null;
    }

    function dailiesThisWeek(index, todayIso) {
        const weekStart = mondayOf(todayIso);
        const today = String(todayIso).slice(0, 10);
        if (!weekStart) return [];
        return ofTypes(index, 'daily').filter(e => e.end >= weekStart && e.end <= today);
    }

    // --- Live wiring ---

    function currentStores() {
        const storage = window.DevCoachModules?.storage;
        const live = (name, loader) => {
            const value = typeof window[name] === 'object' && window[name] ? window[name] : null;
            return value || storage?.[loader]?.() || {};
        };
        return {
            dailyData: live('dailyData', 'loadDailyData'),
            weeklyData: live('weeklyData', 'loadWeeklyData'),
            ytdData: live('ytdData', 'loadYtdData')
        };
    }

    function currentIndex() {
        return buildIndex(currentStores());
    }


    /**
     * What to call a period on screen.
     *
     * Rankings, Matchup and Team Snapshot each had their own copy of this,
     * and they had drifted: the same week read "Weekly ending 2026-08-16" on
     * two of them and "Week ending 2026-08-16" on the third, and a
     * month-to-date period fell through to "Weekly" on Matchup because that
     * copy had no branch for it. Nouns, not adjectives: a period is a week,
     * not a weekly.
     *
     * Monday Post keeps its own labels on purpose. It writes "July 2026" and
     * "Q3 2026" in a dropdown a person reads, which is better there than an
     * end date, and that is a deliberate difference rather than drift.
     */
    var PERIOD_LABEL_NOUNS = {
        'ytd': 'YTD ending',
        'quarter': 'Quarter ending',
        'month': 'Month ending',
        'month-agg': 'Month ending',
        'month-to-date': 'Month to date ending',
        'week': 'Week ending',
        'week-in-progress': 'Week in progress through',
        'daily': 'Daily:',
        'custom': 'Period ending'
    };

    function periodLabel(key, type) {
        var parts = String(key == null ? '' : key).split('|');
        var endDate = parts[1] || parts[0] || '';
        var noun = PERIOD_LABEL_NOUNS[type] || PERIOD_LABEL_NOUNS.week;
        return endDate ? noun + ' ' + endDate : noun.replace(/[: ]*(ending|through)?:?$/, '');
    }
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.periodIndex = {
        DEFAULT_TYPE,
        WEEK_LIKE,
        COMPLETE_WEEK,
        PRECEDENCE,
        isoOf,
        mondayOf,
        periodLabel,
        PERIOD_LABEL_NOUNS,
        shiftDays,
        parsePeriod,
        buildIndex,
        isWeekLike,
        isCompleteWeek,
        ofTypes,
        weekLikeKeys,
        completeWeekKeys,
        keysOfType,
        thisWeekSoFar,
        lastCompletedWeek,
        isFreshFor,
        weekBefore,
        yearToDate,
        previousYearToDate,
        latestOfType,
        previousOfType,
        dailiesThisWeek,
        currentStores,
        currentIndex
    };
})();
