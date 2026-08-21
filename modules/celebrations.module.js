(function() {
    'use strict';

    // ============================================
    // CELEBRATIONS MODULE
    // Detects team members who rank in the top N
    // across the center on individual metrics or
    // composite score, and generates emoji-filled
    // Teams shout-out messages.
    //
    // Features:
    //  - Period selector (pick any uploaded period)
    //  - Celebration history log (persisted)
    //  - History view with per-person year stats
    // ============================================

    var STORAGE_PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
    var THRESHOLD_STORAGE_KEY = STORAGE_PREFIX + 'celebrationsThreshold';
    var HISTORY_STORAGE_KEY = STORAGE_PREFIX + 'celebrationsHistory';
    var SELECTION_STORAGE_KEY = STORAGE_PREFIX + 'celebrationsSelection';
    var DEFAULT_TIERS = [1, 5, 10];

    // Largest share of a scored field that can share a placing and still have it
    // count as a win. Above this the "achievement" is just where the metric tops
    // out, not something the person did.
    var MAX_TIED_SHARE_FOR_WIN = 0.2;

    // Below this many scored, a share is too noisy to judge saturation by.
    var MIN_FIELD_FOR_TIE_SHARE = 10;

    // Metric rank keys from center-ranking module -> friendly labels.
    // The first four are the scorecard KPIs; the rest are ranked purely so
    // wins on them get recognized (they carry no weight in center ranking).
    var METRIC_RANK_LABELS = {
        aht: { label: 'Average Handle Time', icon: '\u23F1\uFE0F', registry: 'aht' },
        adherence: { label: 'Schedule Adherence', icon: '\uD83D\uDCC5', registry: 'scheduleAdherence' },
        sentiment: { label: 'Overall Sentiment', icon: '\uD83D\uDCAD', registry: 'overallSentiment' },
        associateOverall: { label: 'Rep Satisfaction', icon: '\uD83D\uDE0A', registry: 'cxRepOverall' },
        fcr: { label: 'First Call Resolution', icon: '\u2705', registry: 'fcr' },
        overallExperience: { label: 'Overall Experience', icon: '\uD83C\uDF08', registry: 'overallExperience' },
        transfers: { label: 'Transfers', icon: '\uD83D\uDD00', registry: 'transfers' },
        positiveWord: { label: 'Positive Word Usage', icon: '\uD83D\uDCAC', registry: 'positiveWord' },
        negativeWord: { label: 'Negative Word Usage', icon: '\uD83D\uDEAB', registry: 'negativeWord' },
        managingEmotions: { label: 'Managing Emotions', icon: '\uD83E\uDDD8', registry: 'managingEmotions' },
        reliability: { label: 'Reliability', icon: '\uD83D\uDEE1\uFE0F', registry: 'reliability' }
    };

    // Ranked, but never shouted about. Reliability is a "did you miss hours"
    // measure, so everyone who worked their week clears it and the same names
    // turn up every single time. That makes the shout-out list read as noise
    // and devalues the callouts sitting next to it. It still counts everywhere
    // else — rankings, Attendance, meeting prep.
    var SHOUTOUT_EXCLUDED_METRICS = { reliability: true };

    // Metrics the meets-target gate is switched off for.
    //
    // The gate exists so nobody is congratulated for a number they are failing.
    // That holds where the target is a bar each associate is individually
    // expected to clear. Transfers is not that: 6% assumes a call mix the floor
    // does not get, the whole center sits above it, and so the gate was quietly
    // throwing out every transfers win on the board — a 4th-in-center placing
    // among them. Best transfer discipline on the floor is a real thing to say.
    var TARGET_EXEMPT_METRICS = { transfers: true };

    // The survey metrics a "perfect week" covers. Across the board means across
    // the board: every one of them that came back has to be at 100.
    var SURVEY_METRIC_KEYS = ['cxRepOverall', 'fcr', 'overallExperience'];

    // How many surveys it takes before the phrase is allowed.
    //
    // Three, until Scott asked for any amount on 2026-08-12. The check-in
    // windows this runs over are two days long and almost nobody clears three
    // surveys in two days, so the callout never fired. One flawless survey is a
    // smaller thing than six flawless surveys and the copy says which it was —
    // the count is always named, so nobody reads one as the other.
    var MIN_SURVEYS_FOR_PERFECT = 1;

    // Metrics a light call week says nothing about.
    //
    // Schedule adherence is measured against the schedule, not the phone. Twelve
    // calls and a hundred calls are equally good evidence that somebody worked
    // the hours they were rostered for, so a thin week is no reason to throw the
    // number out. Everything else here is call-driven and stays behind the guard.
    var VOLUME_INDEPENDENT_METRICS = { adherence: true, reliability: true };

    /**
     * Was this associate actually here, and enough to judge?
     *
     * Somebody out all week shows 0% transfers. On a lower-is-better metric
     * that reads as a flawless score, ties them with everyone else at zero, and
     * puts them top of the shout-outs for a week they did not work. The number
     * is not a performance, it is an absence.
     */
    function volumeVerdict(row) {
        var raw = row ? row.totalCalls : undefined;
        var floor = Number.isFinite(window.MIN_CALLS_TO_JUDGE) ? window.MIN_CALLS_TO_JUDGE : 20;

        // No call count at all is not the same as a count of zero. An upload
        // without the column would otherwise suppress every celebration on the
        // board, silently, which is far worse than the problem being fixed.
        if (raw === undefined || raw === null || raw === '') return { ok: true, calls: null, known: false };

        var calls = parseInt(raw, 10);
        if (!Number.isFinite(calls)) return { ok: true, calls: null, known: false };

        if (calls <= 0) return { ok: false, reason: 'absent', calls: 0 };
        if (calls < floor) return { ok: false, reason: 'thin', calls: calls, floor: floor };
        return { ok: true, calls: calls, known: true };
    }

    // Where each rank key's display value lives on a ranking row.
    function getRankedValue(row, metricKey) {
        if (metricKey === 'reliability') return row?.reliability ?? null;
        var scorecard = row?.values?.[metricKey];
        if (scorecard !== undefined && scorecard !== null) return scorecard;
        return row?.extraValues?.[metricKey] ?? null;
    }

    /**
     * A week of surveys with nothing off the mark.
     *
     * The rule lives in the highlights engine and is borrowed rather than
     * copied: at least three surveys, at least two survey metrics scored, and
     * every one of them at 100. Without that module loaded the callout simply
     * does not appear, which is the right failure — a claim this strong should
     * never be made on a guess.
     */
    function perfectSurveyWeek(row) {
        var engine = window.DevCoachModules?.highlights;
        if (!engine?.findPerfectSurveys || !row) return null;

        // Read the raw survey scores, not the ranking ones. Center ranking
        // blanks a survey metric below three surveys so it cannot win a
        // placing, which is right — but this callout is not a placing, and
        // reading the blanked values meant a flawless two-survey week looked
        // like a week with no surveys in it at all.
        var raw = row.surveyValues || {};
        var pick = function(surveyKey, rankKey) {
            var val = raw[surveyKey];
            return (val === null || val === undefined) ? getRankedValue(row, rankKey) : val;
        };

        var found = engine.findPerfectSurveys({
            surveyTotal: row.surveyTotal,
            cxRepOverall: pick('cxRepOverall', 'associateOverall'),
            fcr: pick('fcr', 'fcr'),
            overallExperience: pick('overallExperience', 'overallExperience')
        }, { surveyMetricKeys: SURVEY_METRIC_KEYS, minSurveys: MIN_SURVEYS_FOR_PERFECT });

        return found ? { count: found.value } : null;
    }

    function celebrationYear(periodKey) {
        var endStr = String(periodKey || '');
        if (endStr.indexOf('|') > -1) endStr = endStr.split('|')[1];
        var year = parseInt(String(endStr).split('-')[0], 10);
        return Number.isInteger(year) ? year : new Date().getFullYear();
    }

    /**
     * Is this number actually any good, never mind how it ranks?
     *
     * Celebrations rank against the whole centre, which says how someone
     * compares but nothing about whether the figure is good. On a metric the
     * whole floor struggles with, that celebrated people for numbers they were
     * failing — "Avoid Negative Words 73.1%" against an 83% target. Telling
     * someone that is a win teaches them the wrong number.
     *
     * Unjudgeable values pass: a missing target is a reason to stay quiet, not
     * to suppress a real achievement.
     */
    function meetsCelebrationTarget(metricKey, value, year) {
        var meta = METRIC_RANK_LABELS[metricKey];
        if (!meta) return true;

        var profiles = window.DevCoachModules?.metricProfiles;
        var target = profiles?.getYearTarget?.(meta.registry, year)
            || window.METRICS_REGISTRY?.[meta.registry]?.target;
        if (!target) return true;

        var limit = parseFloat(target.value);
        var actual = parseFloat(value);
        if (!Number.isFinite(limit) || !Number.isFinite(actual)) return true;

        return target.type === 'max' ? actual <= limit : actual >= limit;
    }

    function _escapeHtml(str) {
        var mod = window.DevCoachModules?.sharedUtils;
        if (mod?.escapeHtml) return mod.escapeHtml(str);
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function _getFirstName(fullName) {
        if (typeof getEmployeeNickname === 'function') return getEmployeeNickname(fullName);
        return String(fullName).split(/[\s,]+/)[0];
    }

    // =====================
    // Settings / Threshold
    // =====================

    function getCustomThreshold() {
        try {
            var raw = localStorage.getItem(THRESHOLD_STORAGE_KEY);
            if (!raw) return null;
            var val = parseInt(raw, 10);
            return val > 0 ? val : null;
        } catch (e) { return null; }
    }

    function saveCustomThreshold(val) {
        try {
            if (val && parseInt(val, 10) > 0) {
                localStorage.setItem(THRESHOLD_STORAGE_KEY, String(parseInt(val, 10)));
            } else {
                localStorage.removeItem(THRESHOLD_STORAGE_KEY);
            }
        } catch (e) { /* ok */ }
    }

    function getActiveTiers() {
        var tiers = DEFAULT_TIERS.slice();
        var custom = getCustomThreshold();
        if (custom && !tiers.includes(custom)) {
            tiers.push(custom);
            tiers.sort(function(a, b) { return a - b; });
        }
        return tiers;
    }

    // ==========================
    // Period selection / helpers
    // ==========================

    function getAllPeriodKeys() {
        var weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        var ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        var keys = [];
        // weekly keys with enough employees to rank against (30+)
        Object.keys(weekly).forEach(function(k) {
            var emps = weekly[k]?.employees;
            if (emps && emps.length >= 30) keys.push(k);
        });
        // ytd keys
        Object.keys(ytd).forEach(function(k) {
            var emps = ytd[k]?.employees;
            if (emps && emps.length >= 30 && keys.indexOf(k) === -1) keys.push(k);
        });
        keys.sort();
        return keys;
    }

    function getPeriodLabel(key) {
        var weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        var ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        var period = weekly[key] || ytd[key];
        if (period?.metadata?.label) return period.metadata.label;
        if (key.includes('|')) {
            var parts = key.split('|');
            return formatDateFriendly(parts[0]) + ' - ' + formatDateFriendly(parts[1]);
        }
        return key;
    }

    function getPeriodEmployeeCount(key) {
        var weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        var ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        var period = weekly[key] || ytd[key];
        return period?.employees?.length || 0;
    }

    function loadCelebrationSelection() {
        try {
            var raw = localStorage.getItem(SELECTION_STORAGE_KEY);
            if (!raw) return { periodKey: null, view: 'current' };
            var parsed = JSON.parse(raw);
            return {
                periodKey: parsed?.periodKey || null,
                view: parsed?.view === 'history' ? 'history' : 'current'
            };
        } catch (e) { return { periodKey: null, view: 'current' }; }
    }

    function saveCelebrationSelection(sel) {
        var save = window.DevCoachModules?.storage?.saveWithSizeCheck;
        if (save) {
            save('celebrationsSelection', sel);
            return;
        }
        try { localStorage.setItem(SELECTION_STORAGE_KEY, JSON.stringify(sel)); } catch (e) { /* ok */ }
    }

    function formatDateFriendly(dateStr) {
        try {
            var d = new Date(dateStr + 'T00:00:00');
            return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (e) { return dateStr; }
    }

    function getDateRangeForKey(periodKey) {
        if (!periodKey) return '';
        if (periodKey.includes('|')) {
            var parts = periodKey.split('|');
            return formatDateFriendly(parts[0]) + ' - ' + formatDateFriendly(parts[1]);
        }
        return getPeriodLabel(periodKey);
    }

    // ==========================
    // Which stretch of time a shout-out covers
    // ==========================

    /**
     * A placing is only true of the window it was measured over. "6th best in
     * the call center" off a year-to-date file and off three days of this week
     * are two different sentences, and until now the post always used whichever
     * upload happened to be newest — so the window was whatever file you
     * dragged in last.
     *
     * These are the windows worth posting about, each resolved to whatever
     * upload actually covers it rather than to a date range we wish existed.
     * Nothing is invented: a window with no upload behind it is offered as
     * unavailable, with the reason, instead of quietly standing a different
     * stretch of time up under the same name.
     */
    var SHOUTOUT_WINDOW_SPECS = [
        { id: 'latest', label: 'Latest upload' },
        { id: 'thisWeek', label: 'This week' },
        { id: 'lastWeek', label: 'Last week' },
        { id: 'mtd', label: 'Month to date' },
        { id: 'ytd', label: 'Year to date' }
    ];

    // The same field floor the automatic pick uses. Ranking eighteen people and
    // calling it the center is the one way this post can lie outright, so a
    // window whose upload is thinner than this is offered greyed out rather
    // than silently ranked.
    var MIN_FIELD_FOR_CENTER_RANK = 30;

    var NO_UPLOAD_REASON = {
        thisWeek: 'Nothing uploaded for this week yet.',
        lastWeek: 'No finished week on file yet.',
        mtd: 'No month-to-date upload for this month yet.',
        ytd: 'No year-to-date report uploaded yet.'
    };

    function _periodIndex() {
        return window.DevCoachModules && window.DevCoachModules.periodIndex;
    }

    function _rawPeriodFor(entry) {
        if (!entry) return null;
        var weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        var ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        var daily = typeof dailyData !== 'undefined' ? dailyData : {};
        return weekly[entry.key] || ytd[entry.key] || daily[entry.key] || null;
    }

    /**
     * The week so far, and only if something week-shaped says so.
     *
     * A day file is canonical for its day and nothing else — that is the whole
     * reason dailies never roll up. Letting one stand in here is how "this
     * week" came to read Aug 17 to Aug 17, with eighteen people tied at 100%
     * on a metric that needs a week of calls to separate anybody. Five day
     * files would be no better: only the newest is ever ranked, so the answer
     * would still be one day wearing the name of the week.
     */
    function _windowEntryThisWeek(pi, index, todayIso) {
        var covering = pi.thisWeekSoFar(index, todayIso);
        if (!covering || covering.source === 'daily') return null;
        return covering.primary;
    }

    // Day files are a different miss from nothing at all, and they have a
    // different fix, so the greyed-out chip says which one this is.
    function _thisWeekReason(pi, index, todayIso) {
        var dailies = [];
        try { dailies = pi.dailiesThisWeek(index, todayIso) || []; } catch (e) { dailies = []; }
        if (!dailies.length) return NO_UPLOAD_REASON.thisWeek;
        return 'Only day files for this week (' + dailies.length + ' so far). ' +
            'A single day cannot rank a week — upload week to date on the Upload tab.';
    }

    // A month-to-date upload is the month so far straight from the source. An
    // uploaded month whose range ends inside the current month is the same
    // thing filed under a different type, so it stands in.
    function _windowEntryMonthToDate(pi, index, todayIso) {
        var month = String(todayIso).slice(0, 7);
        var inThisMonth = function (list) {
            var hits = list.filter(function (e) { return String(e.end).slice(0, 7) === month; });
            return hits.length ? hits[hits.length - 1] : null;
        };
        return inThisMonth(pi.ofTypes(index, 'month-to-date')) || inThisMonth(pi.ofTypes(index, 'month'));
    }

    // An auto-generated YTD is weekly uploads added up, so it only knows about
    // whoever appeared in those weeks. That is a fine trend line and a bad
    // field to rank a center against, so it is not offered as "year to date".
    function _windowEntryYearToDate(pi, index) {
        var real = pi.ofTypes(index, 'ytd').filter(function (e) {
            var raw = _rawPeriodFor(e);
            return !(raw && raw.metadata && raw.metadata.autoGeneratedYtd);
        });
        return real.length ? real[real.length - 1] : null;
    }

    /**
     * Every window, whether it can be used, and why not when it cannot.
     * "Latest upload" is the old behaviour kept under a name — it resolves to
     * no key at all, which is what tells detection to pick for itself.
     */
    function listShoutOutWindows(todayIso) {
        var pi = _periodIndex();
        var today = todayIso || (pi ? pi.isoOf(new Date()) : '');
        var index = pi ? pi.currentIndex() : null;

        return SHOUTOUT_WINDOW_SPECS.map(function (spec) {
            if (spec.id === 'latest') {
                return { id: spec.id, label: spec.label, key: null, dateRange: '', count: 0, available: true, reason: '' };
            }
            if (!pi || !index) {
                return { id: spec.id, label: spec.label, key: null, dateRange: '', count: 0,
                    available: false, reason: 'The period index is not loaded, so only the latest upload can be used.' };
            }

            var entry = spec.id === 'thisWeek' ? _windowEntryThisWeek(pi, index, today)
                : spec.id === 'lastWeek' ? pi.lastCompletedWeek(index, today)
                : spec.id === 'mtd' ? _windowEntryMonthToDate(pi, index, today)
                : _windowEntryYearToDate(pi, index);

            if (!entry) {
                var missing = spec.id === 'thisWeek'
                    ? _thisWeekReason(pi, index, today)
                    : (NO_UPLOAD_REASON[spec.id] || 'Nothing uploaded for that stretch yet.');
                return { id: spec.id, label: spec.label, key: null, dateRange: '', count: 0,
                    available: false, reason: missing };
            }

            var count = entry.employeeCount || 0;
            var enough = count >= MIN_FIELD_FOR_CENTER_RANK;
            return {
                id: spec.id,
                label: spec.label,
                key: entry.key,
                dateRange: getDateRangeForKey(entry.key),
                count: count,
                available: enough,
                reason: enough ? '' : 'That upload only covers ' + count + ' associates, too small a field to say where anybody placed in the center.'
            };
        });
    }

    /**
     * The window to actually build from. An unusable pick falls back to the
     * latest upload rather than to nothing, because a saved choice goes stale
     * on its own — last week's file is next week's old news.
     */
    function resolveShoutOutWindow(windowId, todayIso) {
        var windows = listShoutOutWindows(todayIso);
        var match = windows.filter(function (w) { return w.id === windowId && w.available; })[0];
        return match || windows[0];
    }

    // =====================
    // Detection
    // =====================

    /**
     * Where everybody placed, per metric, at the precision people read.
     *
     * Lifted out of detectCelebrations so the near-miss line and the miss
     * list work off the same ranks the shout-out gate does. Two functions
     * deriving placings separately is how an explanation ends up quoting a
     * different rank from the decision it is explaining.
     */
    function buildDisplayRanks(data) {
            // Count rank-1 holders per metric across the full center. Standard
            // competition ranking gives every tied leader rank 1, so "only one to
            // hit this" should only fire when exactly one person sits at rank 1.
            var rank1CountsByMetric = {};
            // How many people sit on each rank, per metric. Standard competition
            // ranking gives every tied associate the same number, so a metric where
            // fifteen people all hit 100% hands all fifteen rank 1. Telling each of
            // them they are "#1 in Center" overstates it; "one of fifteen at 100%"
            // is both true and a nicer thing to read.
            var rankCountsByMetric = {};
            // The field an achievement was actually won against. Not every scored
            // associate holds a rank on every metric — surveys get withheld, some
            // numbers never land — so "out of 126" would overstate a metric only
            // 84 people were ranked on.
            var rankedCountByMetric = {};
            // Placings are re-derived at the precision people actually read. Center
            // ranking splits ties at 1e-9, so 99.96% and 100% land on separate ranks
            // while both print as "100.0%" — and the higher one gets told nobody
            // else matched a number three other names are visibly sitting on. Two
            // associates whose scores display identically are tied, full stop.
            var displayRankByMetric = {};
            Object.keys(METRIC_RANK_LABELS).forEach(function(metricKey) {
                var rows = [];
                data.rankings.forEach(function(r) {
                    var rank = r.metricRanks?.[metricKey];
                    if (!rank) return;
                    var val = getRankedValue(r, metricKey);
                    rows.push({
                        name: r.name,
                        rank: rank,
                        // No display value means nothing to compare, so it never ties.
                        display: (val === null || val === undefined) ? null : formatMetricValue(metricKey, val)
                    });
                });
                rows.sort(function(a, b) { return a.rank - b.rank; });

                var ranksByName = {};
                var counts = {};
                var lastRank = 0, lastDisplay = null;
                rows.forEach(function(row, idx) {
                    // Standard competition ranking (1-1-3) over the displayed value.
                    var tiedWithPrev = idx > 0 && row.display !== null && row.display === lastDisplay;
                    var rank = tiedWithPrev ? lastRank : idx + 1;
                    ranksByName[row.name] = rank;
                    counts[rank] = (counts[rank] || 0) + 1;
                    lastRank = rank;
                    lastDisplay = row.display;
                });

                displayRankByMetric[metricKey] = ranksByName;
                rankCountsByMetric[metricKey] = counts;
                rankedCountByMetric[metricKey] = rows.length;
                rank1CountsByMetric[metricKey] = counts[1] || 0;
            });
        return {
            displayRankByMetric: displayRankByMetric,
            rankCountsByMetric: rankCountsByMetric,
            rankedCountByMetric: rankedCountByMetric,
            rank1CountsByMetric: rank1CountsByMetric
        };
    }

    /**
     * Scans rankings for team members who hit notable thresholds.
     * If periodKey is provided, ranks that specific period.
     * Otherwise uses the merged best-data approach.
     */
    function detectCelebrations(periodKey) {
        var centerRanking = window.DevCoachModules?.centerRanking;
        if (!centerRanking) return { celebrations: [], missed: [], dateRange: '', periodKey: '' };

        var data;
        if (periodKey) {
            data = centerRanking.buildRankingsForPeriod?.(periodKey) || null;
        }
        if (!data) {
            data = centerRanking.buildCenterRankings?.() || null;
        }
        if (!data || !data.rankings.length) return { celebrations: [], missed: [], dateRange: getDateRangeForKey(periodKey), periodKey: data?.periodKey || periodKey || '' };

        var tiers = getActiveTiers();
        var maxTier = tiers[tiers.length - 1];
        var results = [];

        var ranked = buildDisplayRanks(data);
        var rank1CountsByMetric = ranked.rank1CountsByMetric;
        var rankCountsByMetric = ranked.rankCountsByMetric;
        var rankedCountByMetric = ranked.rankedCountByMetric;
        var displayRankByMetric = ranked.displayRankByMetric;

        // Ranks are still worked out across the whole center — that's what makes
        // an achievement mean something — but who gets celebrated follows the
        // My Team picker, so choosing one person shows only their wins.
        var scope = window.DevCoachModules?.teamScope;

        var thinVolume = {};

        data.rankings.forEach(function(r) {
            if (!data.teamMembers.has(r.name)) return;
            if (scope?.isInScope && !scope.isInScope(r.name)) return;

            // A week they did not work produces numbers that look like wins.
            //
            // A week they worked lightly is a different thing. Taking eleven
            // calls does not stop schedule adherence from being real — you were
            // still where you were meant to be — so a thin week only takes the
            // call-driven metrics down with it. No calls at all still takes
            // everything, because then there is no evidence of the week at all.
            var volume = volumeVerdict(r);
            if (!volume.ok) {
                thinVolume[r.name] = volume;
                if (volume.reason !== 'thin') return;
            }

            var achievements = [];

            // Check each individual metric rank
            Object.keys(METRIC_RANK_LABELS).forEach(function(metricKey) {
                if (SHOUTOUT_EXCLUDED_METRICS[metricKey]) return;
                if (!volume.ok && !VOLUME_INDEPENDENT_METRICS[metricKey]) return;
                var metricRank = displayRankByMetric[metricKey]?.[r.name] || r.metricRanks?.[metricKey];
                if (!metricRank || metricRank > maxTier) return;

                var meta = METRIC_RANK_LABELS[metricKey];
                var tier = getTierForRank(metricRank, tiers);
                var metricValue = getRankedValue(r, metricKey);
                if (metricValue === null || metricValue === undefined) return;
                // Ranking well on a number you are failing is not a win.
                if (!TARGET_EXEMPT_METRICS[metricKey]
                    && !meetsCelebrationTarget(metricKey, metricValue, celebrationYear(data.periodKey || periodKey))) return;

                var tiedCount = rankCountsByMetric[metricKey]?.[metricRank] || 1;
                var rankedCount = rankedCountByMetric[metricKey] || 0;

                // A placing shared with a large slice of the centre is not a placing.
                // Over a two-day window Rep Satisfaction put 16 of the 19 associates
                // scored on it at 100%, and every one of them was being told they
                // were top of the centre. Eighty-four percent of a field cannot all
                // be standing out, and saying so to sixteen people devalues it for
                // the one week somebody genuinely does.
                //
                // Ceiling-bound percentage metrics saturate like this constantly —
                // the shorter the window, the worse it gets. A win has to leave most
                // of the field behind it to be worth saying out loud.
                // Only ever applies to a SHARED placing. Someone alone at the top of
                // a field of three holds a third of it by arithmetic, and that is
                // still a win — they beat everyone they were measured against.
                // Needs a real field before a share means anything: three people
                // scored and two tied is 67%, but it is also just three people.
                if (tiedCount > 1 && rankedCount >= MIN_FIELD_FOR_TIE_SHARE
                    && (tiedCount / rankedCount) > MAX_TIED_SHARE_FOR_WIN) return;

                achievements.push({
                    type: 'metric',
                    key: metricKey,
                    label: meta.label,
                    icon: meta.icon,
                    rank: metricRank,
                    tiedCount: tiedCount,
                    soloRank1: metricRank === 1 && rank1CountsByMetric[metricKey] === 1,
                    tier: tier.value,
                    tierLabel: tier.label,
                    totalEmployees: data.totalEmployees,
                    rankedCount: rankedCount,
                    // Everyone the achievement genuinely beat. Ties are excluded
                    // rather than counted as wins, so fifteen people at 100% are
                    // each "better than" the 109 below them, not each other.
                    betterThan: Math.max(0, rankedCount - (metricRank - 1) - tiedCount),
                    value: metricValue
                });
            });

            // A perfect survey week is target-based, not a placing, so the
            // saturation rules above have nothing to say about it — and it is
            // worth the post on its own. Someone whose only win is a flawless
            // set of surveys was previously left out entirely, because a top
            // spot shared with half the floor is the exact case that gets
            // suppressed. A thin week still gets no claim about "the week".
            var perfect = volume.ok ? perfectSurveyWeek(r) : null;
            // Stamped here because this is the only place that knows which
            // window the reader asked for.
            if (perfect) perfect.periodNoun = periodNoun(data.periodKey || periodKey);

            if (achievements.length > 0 || perfect) {
                achievements.sort(function(a, b) {
                    return a.rank - b.rank;
                });
                results.push({
                    name: r.name,
                    firstName: _getFirstName(r.name),
                    perfectSurveys: perfect,
                    achievements: achievements,
                    // A win on one metric and a near miss on another are both
                    // true, and the private message is the place to say so.
                    nearMiss: volume.ok
                        ? findNearMiss(r, r.name, tiers, celebrationYear(data.periodKey || periodKey), ranked)
                        : null
                });
            }
        });

        // Best placing first. Someone carried by a perfect survey week holds no
        // placing at all, so they sort to the end rather than comparing two
        // infinities against each other and handing the engine a NaN.
        var bestRank = function(entry) {
            if (!entry.achievements.length) return Infinity;
            return Math.min.apply(null, entry.achievements.map(function(x) { return x.rank; }));
        };
        results.sort(function(a, b) {
            var bestA = bestRank(a), bestB = bestRank(b);
            if (bestA === bestB) return 0;
            return bestA - bestB;
        });

        // Everyone in scope who didn't make it, and why. Worked out here rather
        // than in the renderer so the reason travels with the result.
        var celebrated = {};
        results.forEach(function(r) { celebrated[r.name] = true; });

        var missed = [];
        Array.from(data.teamMembers).forEach(function(name) {
            if (celebrated[name]) return;
            if (scope?.isInScope && !scope.isInScope(name)) return;
            if (thinVolume[name]) {
                missed.push({
                    name: name,
                    reason: thinVolume[name].reason === 'absent' ? 'notPresent' : 'thinVolume',
                    calls: thinVolume[name].calls,
                    floor: thinVolume[name].floor,
                    maxTier: tiers[tiers.length - 1]
                });
                return;
            }
            var info = explainNoCelebration(data, name, tiers, ranked);
            info.nearMiss = findNearMiss(_rowFor(data, name), name, tiers,
                celebrationYear(data.periodKey || periodKey), ranked);
            missed.push(info);
        });
        missed.sort(function(a, b) {
            var ra = a.best ? a.best.rank : Infinity;
            var rb = b.best ? b.best.rank : Infinity;
            return ra - rb || String(a.name).localeCompare(String(b.name));
        });

        return {
            celebrations: results,
            missed: missed,
            dateRange: getDateRangeForKey(data.periodKey || periodKey),
            periodKey: data.periodKey || periodKey || '',
            totalEmployees: data.totalEmployees || 0
        };
    }

    // How far past the bar still counts as knocking on the door. Against the
    // standard top-10 bar this is ranks 11 through 15.
    var NEAR_MISS_WINDOW = 5;

    /**
     * The best placing that just missed the bar, if there is one.
     *
     * Only ever a number they are actually passing. Telling somebody they are
     * three off the top ten on a metric they are behind on rewards the rank and
     * ignores the number, which is the same mistake the shout-out target gate
     * exists to prevent: it would have Kristin, sixth on the floor at 73.1%
     * against an 83% bar, reading that she is nearly there.
     */
    function findNearMiss(row, name, tiers, year, ctx) {
        if (!row) return null;
        var maxTier = tiers[tiers.length - 1];
        var context = ctx || {};
        var best = null;

        Object.keys(METRIC_RANK_LABELS).forEach(function(metricKey) {
            if (SHOUTOUT_EXCLUDED_METRICS[metricKey]) return;
            var rank = context.displayRankByMetric?.[metricKey]?.[name] || row.metricRanks?.[metricKey];
            if (!rank || rank <= maxTier || rank > maxTier + NEAR_MISS_WINDOW) return;

            var value = getRankedValue(row, metricKey);
            if (value === null || value === undefined) return;
            if (!TARGET_EXEMPT_METRICS[metricKey] && !meetsCelebrationTarget(metricKey, value, year)) return;

            if (!best || rank < best.rank) {
                best = {
                    metricKey: metricKey,
                    label: METRIC_RANK_LABELS[metricKey].label,
                    rank: rank,
                    away: rank - maxTier,
                    bar: maxTier,
                    value: value
                };
            }
        });

        return best;
    }

    /**
     * The near miss for one person on one period, for callers holding a name
     * and nothing else.
     *
     * Deliberately not scope-filtered: the private message this feeds is
     * already addressed to somebody, and making it depend on who happens to be
     * selected in the team picker would have a sweep write different messages
     * depending on a dropdown.
     */
    function nearMissFor(name, periodKey) {
        var centerRanking = window.DevCoachModules?.centerRanking;
        if (!centerRanking || !name) return null;

        var data = periodKey ? centerRanking.buildRankingsForPeriod?.(periodKey) : null;
        if (!data) data = centerRanking.buildCenterRankings?.() || null;
        if (!data || !data.rankings || !data.rankings.length) return null;

        var row = null;
        for (var i = 0; i < data.rankings.length; i++) {
            if (data.rankings[i] && data.rankings[i].name === name) { row = data.rankings[i]; break; }
        }
        if (!row) return null;
        // A period they did not work produces numbers that look like placings.
        if (!volumeVerdict(row).ok) return null;

        return findNearMiss(row, name, getActiveTiers(),
            celebrationYear(data.periodKey || periodKey), buildDisplayRanks(data));
    }

    // Said more than one way, because a sweep sends eighteen of these at once
    // and the same sentence eighteen times is a form letter.
    var NEAR_MISS_LINES = [
        function(m, v, rank, away, spots, bar) {
            return 'One more thing: you are ' + away + ' ' + spots + ' away from top ' + bar
                + ' in ' + m + '. ' + v + ' has you at #' + rank + ' in the Call Center.';
        },
        function(m, v, rank, away, spots, bar) {
            return 'Worth knowing: ' + m + ' at ' + v + ' has you #' + rank
                + ' in the Call Center, ' + away + ' ' + spots + ' away from top ' + bar + '.';
        },
        function(m, v, rank, away, spots, bar) {
            return m + ' is close. ' + v + ' puts you #' + rank + ' in the Call Center, '
                + away + ' ' + spots + ' off the top ' + bar + '.';
        },
        function(m, v, rank, away, spots, bar) {
            return 'You are knocking on the door in ' + m + ': #' + rank
                + ' in the Call Center at ' + v + ', ' + away + ' ' + spots + ' away from top ' + bar + '.';
        },
        function(m, v, rank, away, spots, bar) {
            return 'Keep an eye on ' + m + '. ' + v + ' has you #' + rank + ' in the Call Center, '
                + away + ' ' + spots + ' away from top ' + bar + '.';
        },
        function(m, v, rank, away, spots, bar) {
            return 'Almost there on ' + m + '. ' + v + ' is #' + rank + ' in the Call Center, and top '
                + bar + ' is ' + away + ' ' + spots + ' up.';
        }
    ];

    function describeNearMiss(info) {
        if (!info || !info.rank) return '';
        var value = formatMetricValue(info.metricKey, info.value);
        var spots = info.away === 1 ? 'spot' : 'spots';
        return pick(NEAR_MISS_LINES)(info.label, value, info.rank, info.away, spots, info.bar);
    }

    /**
     * Why someone got no celebration.
     *
     * "No celebrations" had three completely different causes and one blank
     * screen, which reads as "they did nothing" when the truth is usually
     * "they were #14 and the bar is top 10". Each of these is worth saying
     * out loud, because they call for different responses.
     */
    function _rowFor(data, name) {
        var rankings = (data && data.rankings) || [];
        for (var i = 0; i < rankings.length; i++) {
            if (rankings[i] && rankings[i].name === name) return rankings[i];
        }
        return null;
    }

    function explainNoCelebration(data, name, tiers, context) {
        var maxTier = tiers[tiers.length - 1];
        var rankings = (data && data.rankings) || [];
        var ctx = context || {};

        var row = null;
        for (var i = 0; i < rankings.length; i++) {
            if (rankings[i] && rankings[i].name === name) { row = rankings[i]; break; }
        }
        if (!row) return { name: name, reason: 'notRanked', maxTier: maxTier };

        var best = null;
        var withheld = null;
        var belowTarget = null;
        var shared = null;
        var year = celebrationYear(data && data.periodKey);

        Object.keys(METRIC_RANK_LABELS).forEach(function(metricKey) {
            // Excluded from shout-outs, so it must not explain a missing one either.
            if (SHOUTOUT_EXCLUDED_METRICS[metricKey]) return;
            // The rank people can see, the same one detection gated on. Reading
            // the raw rank here is how the explanation came to disagree with the
            // decision it was explaining.
            var rank = ctx.displayRankByMetric?.[metricKey]?.[name] || row.metricRanks?.[metricKey];
            if (!rank) return;

            var value = getRankedValue(row, metricKey);
            var hasValue = value !== null && value !== undefined;
            var tiedCount = ctx.rankCountsByMetric?.[metricKey]?.[rank] || 1;
            var rankedCount = ctx.rankedCountByMetric?.[metricKey] || 0;
            var entry = { metricKey: metricKey, label: METRIC_RANK_LABELS[metricKey].label, rank: rank, hasValue: hasValue, value: value,
                tiedCount: tiedCount, rankedCount: rankedCount };

            if (!best || rank < best.rank) best = entry;
            // A qualifying rank whose value never made it through is the most
            // misleading case, so it wins the explanation.
            if (rank <= maxTier && !hasValue && (!withheld || rank < withheld.rank)) withheld = entry;
            // Ranked well but failing the number: worth saying out loud, because
            // it reads as an oversight otherwise. Metrics the gate is off for
            // are skipped here too — explaining a suppression that no longer
            // happens is worse than saying nothing.
            if (rank <= maxTier && hasValue && !TARGET_EXEMPT_METRICS[metricKey]
                && !meetsCelebrationTarget(metricKey, value, year)
                && (!belowTarget || rank < belowTarget.rank)) belowTarget = entry;
            // Top of a field most of which is sitting on the same number. The
            // placing is real and detection still suppresses it, so "#1 and no
            // shout-out" needs saying rather than falling through to a near-miss
            // line that reported being #1 as nought off the top ten bar.
            if (rank <= maxTier && hasValue
                && tiedCount > 1 && rankedCount >= MIN_FIELD_FOR_TIE_SHARE
                && (tiedCount / rankedCount) > MAX_TIED_SHARE_FOR_WIN
                && (TARGET_EXEMPT_METRICS[metricKey] || meetsCelebrationTarget(metricKey, value, year))
                && (!shared || rank < shared.rank)) shared = entry;
        });

        if (withheld) return { name: name, reason: 'valueWithheld', best: withheld, maxTier: maxTier };
        if (belowTarget) return { name: name, reason: 'belowTarget', best: belowTarget, maxTier: maxTier };
        if (shared) return { name: name, reason: 'sharedPlacing', best: shared, maxTier: maxTier };
        if (!best) return { name: name, reason: 'noMetricRanks', maxTier: maxTier };
        // A rank inside the bar that none of the above explains is a gap between
        // detection and this function, not a near miss. Say so plainly instead
        // of printing "0 off the top 10 bar" and calling it an answer.
        if (best.rank <= maxTier) return { name: name, reason: 'unexplained', best: best, maxTier: maxTier };
        return { name: name, reason: 'belowBar', best: best, maxTier: maxTier, shortBy: best.rank - maxTier };
    }

    function describeNoCelebration(info) {
        var who = _getFirstName(info.name);
        if (info.reason === 'notPresent') {
            return who + ' took no calls this period, so there is nothing to celebrate or coach yet.';
        }
        if (info.reason === 'thinVolume') {
            return who + ' only took ' + info.calls + ' call' + (info.calls === 1 ? '' : 's')
                + ' this period, too few for the numbers to mean much.';
        }
        if (info.reason === 'notRanked') {
            return who + " isn't in this period's rankings at all — nothing scoreable on that upload.";
        }
        if (info.reason === 'noMetricRanks') {
            return who + ' is ranked this period but holds no metric rank yet.';
        }
        if (info.reason === 'sharedPlacing') {
            return who + ' is #' + info.best.rank + ' in ' + info.best.label
                + ', but ' + info.best.tiedCount + ' of the ' + info.best.rankedCount
                + ' scored on it are on the same number, so nobody stands out on it this period.';
        }
        if (info.reason === 'unexplained') {
            return who + ' is #' + info.best.rank + ' in ' + info.best.label
                + ', which clears the bar — worth a look, because nothing in the numbers says why that is not a shout-out.';
        }
        if (info.reason === 'belowTarget') {
            return who + ' ranks #' + info.best.rank + ' in ' + info.best.label
                + ', but ' + info.best.value + ' is still short of target, so it is not a shout-out.';
        }
        if (info.reason === 'valueWithheld') {
            return who + ' ranks #' + info.best.rank + ' in ' + info.best.label
                + ", but the number is withheld — too few surveys behind it to count.";
        }
        return who + "'s best is #" + info.best.rank + ' in ' + info.best.label
            + ', ' + info.shortBy + ' off the top ' + info.maxTier + ' bar.';
    }

    function getTierForRank(rank, tiers) {
        if (rank === 1) return { value: 1, label: '#1 in Center' };
        for (var i = 0; i < tiers.length; i++) {
            if (rank <= tiers[i]) {
                return { value: tiers[i], label: 'Top ' + tiers[i] };
            }
        }
        return { value: rank, label: 'Top ' + rank };
    }

    // =====================
    // History log
    // =====================

    function loadHistory() {
        try {
            var raw = localStorage.getItem(HISTORY_STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch (e) { return []; }
    }

    function saveHistory(history) {
        var save = window.DevCoachModules?.storage?.saveWithSizeCheck;
        if (save) {
            save('celebrationsHistory', history);
            return;
        }
        try { localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(history)); } catch (e) { /* ok */ }
    }

    /**
     * Log celebrations for a period. Deduplicates by periodKey.
     * Each entry: { periodKey, dateRange, loggedAt, entries[] }
     * Each entry in entries: { name, achievements[] }
     */
    function logCelebrations(periodKey, dateRange, celebrations) {
        if (!celebrations.length || !periodKey) return;

        var history = loadHistory();

        // Remove existing entry for this period (re-log with latest data)
        history = history.filter(function(h) { return h.periodKey !== periodKey; });

        var entries = celebrations.map(function(person) {
            return {
                name: person.name,
                firstName: person.firstName,
                achievements: person.achievements.map(function(a) {
                    return { type: a.type, key: a.key, label: a.label, rank: a.rank, tiedCount: a.tiedCount || 1, soloRank1: !!a.soloRank1, tier: a.tier, totalEmployees: a.totalEmployees, rankedCount: a.rankedCount, betterThan: a.betterThan, value: a.value };
                })
            };
        });

        history.push({
            periodKey: periodKey,
            dateRange: dateRange,
            loggedAt: new Date().toISOString(),
            entries: entries
        });

        // Sort newest first
        history.sort(function(a, b) { return b.periodKey.localeCompare(a.periodKey); });

        saveHistory(history);
    }

    /**
     * Build per-person aggregate stats from history for the year.
     * Returns { name -> { totalAppearances, numberOneCount, top5Count, top10Count, metricBreakdown: { key -> count } } }
     */
    function buildYearStats() {
        var history = loadHistory();
        var currentYear = String(new Date().getFullYear());
        var stats = {};

        history.forEach(function(entry) {
            // Only count current year entries
            if (!entry.periodKey.includes(currentYear)) return;

            entry.entries.forEach(function(person) {
                if (!stats[person.name]) {
                    stats[person.name] = {
                        name: person.name,
                        firstName: person.firstName || _getFirstName(person.name),
                        totalAppearances: 0,
                        numberOneCount: 0,
                        top5Count: 0,
                        top10Count: 0,
                        metricBreakdown: {},
                        periods: []
                    };
                }
                var s = stats[person.name];
                s.totalAppearances++;
                s.periods.push(entry.dateRange || entry.periodKey);

                person.achievements.forEach(function(a) {
                    if (a.soloRank1) s.numberOneCount++;
                    if (a.rank <= 5) s.top5Count++;
                    if (a.rank <= 10) s.top10Count++;
                    if (!s.metricBreakdown[a.key]) s.metricBreakdown[a.key] = 0;
                    s.metricBreakdown[a.key]++;
                });
            });
        });

        // Sort by totalAppearances desc
        return Object.values(stats).sort(function(a, b) {
            return b.totalAppearances - a.totalAppearances;
        });
    }

    // =====================
    // Shout-out messages
    // =====================

    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

    /**
     * A picker that will not repeat itself until it has to.
     *
     * Someone with four solo top spots got the same closing sentence four times
     * running, which reads as a form letter and takes the shine off all four.
     * Hands back a function that walks a shuffled copy of the pool and only
     * starts over once every line has been used.
     */
    function rotator(pool) {
        var order = pool.slice();
        for (var i = order.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var swap = order[i]; order[i] = order[j]; order[j] = swap;
        }
        var next = 0;
        return function() {
            var value = order[next % order.length];
            next++;
            return value;
        };
    }

    // Tails for a top spot nobody else reached, in the batch post. The placing
    // itself is stated every time — that is the fact — and only the way it is
    // said out loud changes.
    var SOLO_TOP_TAILS = [
        '#1 in the Call Center — nobody else got there!',
        '#1 in the Call Center, and not one other person matched it!',
        '#1 in the Call Center. Untouched by anybody else!',
        '#1 in the Call Center — that number belongs to them alone!',
        '#1 in the Call Center, and nobody else came close!',
        '#1 in the Call Center. One name on that number, and it is theirs!',
        '#1 in the Call Center — they set the bar and stood there alone!',
        '#1 in the Call Center, matched by nobody on the floor!'
    ];

    var SHOUTOUT_OPENERS = [
        function(name) { return '\uD83C\uDF89\uD83C\uDF89\uD83C\uDF89 HUGE shout-out to ' + name + '! \uD83C\uDF89\uD83C\uDF89\uD83C\uDF89'; },
        function(name) { return '\uD83D\uDE80\uD83C\uDF1F ' + name + ' is CRUSHING it! \uD83C\uDF1F\uD83D\uDE80'; },
        function(name) { return '\uD83D\uDCA5 Everyone give it up for ' + name + '! \uD83D\uDCA5'; },
        function(name) { return '\uD83C\uDFC6\u2B50 Let\'s hear it for ' + name + '! \u2B50\uD83C\uDFC6'; },
        function(name) { return '\uD83D\uDD25\uD83D\uDD25 ' + name + ' is on FIRE! \uD83D\uDD25\uD83D\uDD25'; },
        function(name) { return '\uD83D\uDCA5\uD83D\uDE80 Can we talk about ' + name + ' for a second?! INCREDIBLE! \uD83D\uDE80\uD83D\uDCA5'; },
        function(name) { return '\u2B50\u2B50\u2B50 ' + name + ' just put on a CLINIC! \u2B50\u2B50\u2B50'; },
        function(name) { return '\uD83D\uDCE3 ATTENTION TEAM! ' + name + ' showed up and showed OUT! \uD83D\uDD25'; },
        function(name) { return '\uD83C\uDFC6 BIG TIME performance from ' + name + '! \uD83C\uDFC6'; },
        function(name) { return '\uD83C\uDF1F\uD83C\uDF1F Y\'all need to see what ' + name + ' just did! \uD83C\uDF1F\uD83C\uDF1F'; },
        function(name) { return '\uD83D\uDCAA\uD83D\uDD25 ' + name + ' came to WORK! Let\'s GO! \uD83D\uDD25\uD83D\uDCAA'; },
        function(name) { return '\uD83C\uDF89 Stop what you\'re doing and give ' + name + ' some love! \uD83C\uDF89'; },
        function(name) { return '\uD83D\uDE80\uD83D\uDE80 ' + name + ' is absolutely FLYING right now! \uD83D\uDE80\uD83D\uDE80'; },
        function(name) { return '\uD83D\uDCA5\uD83C\uDFC6 THIS is what greatness looks like! ' + name + ' take a bow! \uD83C\uDFC6\uD83D\uDCA5'; },
        function(name) { return '\uD83D\uDD25 I gotta brag on ' + name + ' for a minute! \uD83D\uDD25'; },
        function(name) { return '\u2B50\uD83C\uDF89 The spotlight is on ' + name + ' today! Look at this! \uD83C\uDF89\u2B50'; }
    ];

    // The uniqueness here is the NUMBER, not the metric \u2014 other associates
    // can (and do) get recognized for the same metric at other values. Copy
    // that says "the only one for AHT" reads as a contradiction the moment a
    // second AHT card shows up, so every line points at the value itself.
    // Standing alone in the whole building is the rarest thing this tool can
    // find, so it gets said at full volume: not "nobody else matched it", but
    // nobody else in the Call Center.
    var ONLY_ONE_LINES = [
        function(label, val) { return '\uD83E\uDD47 ' + label + ' at ' + val + '. Nobody else in the Call Center achieved this!'; },
        function(label, val) { return '\uD83D\uDC51 ' + val + ' on ' + label + '. Not one other person in the Call Center got there!'; },
        function(label, val) { return '\uD83C\uDFC6 ' + label + ' at ' + val + '. Nobody else in the entire Call Center put up that number!'; },
        function(label, val) { return '\uD83D\uDCA5 One person in the whole Call Center hit ' + val + ' on ' + label + '. ONE. And it was them!'; },
        function(label, val) { return '\uD83D\uDD25 ' + val + ' on ' + label + '. Untouched by anyone else in the Call Center!'; },
        function(label, val) { return '\uD83C\uDF1F ' + label + ' at ' + val + ', and that number belongs to them alone in this Call Center!'; },
        function(label, val) { return '\uD83E\uDD47 Solo mission. ' + val + ' on ' + label + ', matched by nobody in the Call Center!'; },
        function(label, val) { return '\uD83D\uDC51 ' + label + ' at ' + val + '. Nobody else in the Call Center could match it!'; },
        function(label, val) { return '\uD83D\uDCA5 ' + val + ' on ' + label + '. Nobody in the Call Center came close!'; },
        function(label, val) { return '\uD83C\uDFC6 Set the bar at ' + val + ' on ' + label + ' and stood there alone in the whole Call Center!'; },
        function(label, val) { return '\uD83D\uDD25 ' + val + ' on ' + label + '. One name in the Call Center on that number, and it\'s theirs!'; }
    ];
    // Fallback when a value is somehow missing \u2014 never claim uniqueness of
    // the metric itself, only of the performance.
    var ONLY_ONE_NO_VALUE_LINES = [
        function(label) { return '\uD83E\uDD47 Nobody else in the Call Center matched this ' + label + ' performance!'; },
        function(label) { return '\uD83D\uDC51 No one else in the Call Center put up a ' + label + ' number like this!'; },
        function(label) { return '\uD83C\uDFC6 This ' + label + ' performance went unmatched across the whole Call Center!'; }
    ];

    var STANDOUT_LINES = [
        function(label) { return '\uD83C\uDFC5 Absolutely crushed it in ' + label + '!'; },
        function(label) { return '\u2B50 Outstanding ' + label + ' performance!'; },
        function(label) { return '\uD83D\uDCAA Elite-level ' + label + '! That\'s impressive!'; },
        function(label) { return '\uD83D\uDD25 Brought the heat in ' + label + '!'; },
        function(label) { return '\uD83D\uDE80 ' + label + ' was next level!'; },
        function(label) { return '\uD83C\uDFC6 Put up a monster ' + label + ' number!'; },
        function(label) { return '\uD83C\uDF1F Seriously impressive work in ' + label + '!'; },
        function(label) { return '\uD83D\uDCA5 Went OFF in ' + label + '! Love to see it!'; },
        function(label) { return '\uD83D\uDCAA Threw down a huge ' + label + ' performance!'; },
        function(label) { return '\u2B50 Made ' + label + ' look easy!'; },
        function(label) { return '\uD83D\uDD25 ' + label + ' was absolutely on point!'; }
    ];

    var SHOUTOUT_CLOSERS = [
        '\uD83D\uDE4C Keep up the amazing work!',
        '\uD83D\uDCAF That\'s the kind of excellence we love to see!',
        '\uD83C\uDF1F You\'re setting the standard!',
        '\uD83D\uDE80 Sky\'s the limit! Keep pushing!',
        '\uD83D\uDD25 Absolutely incredible work!',
        '\uD83C\uDFC6 We see you and we appreciate you!',
        '\u2B50 The whole team is better because of you!',
        '\uD83D\uDCAA This kind of effort doesn\'t go unnoticed. Keep doing your thing!',
        '\uD83C\uDF89 You make this team better every single day!',
        '\uD83D\uDE80 Can\'t wait to see what you do next!',
        '\uD83D\uDD25 That work ethic is contagious. Thank you!',
        '\uD83D\uDCAF You should be really proud of that. We are!',
        '\u2B50 Performances like this are what make this team special!',
        '\uD83C\uDFC6 You brought your A-game and it shows!',
        '\uD83D\uDE4C Take a moment and be proud of what you accomplished!',
        '\uD83C\uDF1F Consistent excellence \u2014 that\'s what we\'re seeing from you!'
    ];

    var BATCH_INTRO = [
        '\uD83C\uDF89\uD83C\uDF89\uD83C\uDF89 SHOUT-OUT TIME! \uD83C\uDF89\uD83C\uDF89\uD83C\uDF89\n\nSome AMAZING performances from the team! Let\'s celebrate these wins:\n\n',
        '\uD83D\uDD25 TEAM WINS ALERT \uD83D\uDD25\n\nI\'ve got some incredible achievements to share. These folks are KILLING it:\n\n',
        '\u2B50 CELEBRATION TIME \u2B50\n\nLook at what this team is doing! So proud of these performers:\n\n',
        '\uD83C\uDFC6 TEAM SPOTLIGHT \uD83C\uDFC6\n\nLet me brag about some of our people for a minute:\n\n',
        '\uD83D\uDE80 WINS WORTH SHARING \uD83D\uDE80\n\nYou want to see excellence? Here it is. These folks showed up BIG:\n\n',
        '\uD83D\uDCA5\uD83D\uDCA5 DROP EVERYTHING \u2014 WE\'RE CELEBRATING! \uD83D\uDCA5\uD83D\uDCA5\n\nThese performances deserve the spotlight:\n\n',
        '\uD83C\uDF1F ROLL CALL OF GREATNESS \uD83C\uDF1F\n\nSome of our people went absolutely OFF. Check this out:\n\n',
        '\uD83D\uDCAA TEAM FLEXES \uD83D\uDCAA\n\nI love getting to share wins like these. Look what our team is doing:\n\n',
        '\uD83C\uDF89 WHO\'S POPPING OFF?! \uD83C\uDF89\n\nSpoiler: these amazing people right here:\n\n',
        '\uD83D\uDD25\uD83C\uDFC6 VICTORY LAP TIME \uD83C\uDFC6\uD83D\uDD25\n\nLet\'s give some well-deserved recognition to these standout performers:\n\n'
    ];

    var BATCH_CLOSERS = [
        '\n\uD83D\uDE4C Amazing work everyone! Let\'s keep this energy going!',
        '\n\uD83D\uDCAF This team is something special. Proud of each and every one of you!',
        '\n\uD83D\uDE80 The bar keeps rising and you all keep clearing it. Incredible!',
        '\n\uD83D\uDD25 This is what happens when a great team shows up and shows out!',
        '\n\u2B50 Every single one of these people made a difference here. Thank you!',
        '\n\uD83C\uDFC6 I could brag about this team all day. Outstanding work across the board!',
        '\n\uD83D\uDCAA When you see your name up here, know that it means something. We see you!',
        '\n\uD83C\uDF89 THIS is the energy! Let\'s carry this momentum forward!',
        '\n\uD83D\uDE80 Proud doesn\'t even begin to cover it. This team is BUILT DIFFERENT!',
        '\n\uD83D\uDD25 Keep bringing this fire! You all are incredible!'
    ];

    /**
     * The body of the batch post, which never used to move.
     *
     * The intro and the closer were drawn from pools and everything between
     * them was one template stamped out per achievement, so regenerating a post
     * changed two lines out of twenty and read as the same post. The facts are
     * not negotiable: the metric, the number and the placing are stated every
     * time. What varies is the frame built around them.
     *
     * Every stem closes on its own punctuation, because the placing, the tier
     * badge and the tie clause are appended after it and the block endings have
     * to stay uniform whichever stem comes up.
     */
    var BATCH_METRIC_STEMS = [
        function(label, val) { return label + ': ' + val + '!'; },
        function(label, val) { return val + ' on ' + label + '!'; },
        function(label, val) { return label + ' came in at ' + val + '!'; },
        function(label, val) { return 'Put up ' + val + ' on ' + label + '!'; },
        function(label, val) { return 'Look at ' + label + ': ' + val + '!'; },
        function(label, val) { return 'Finished the period at ' + val + ' on ' + label + '!'; },
        function(label, val) { return label + ' landed on ' + val + '!'; },
        function(label, val) { return 'Took ' + label + ' to ' + val + '!'; },
        function(label, val) { return val + ' on ' + label + ', and it holds up!'; }
    ];

    var BATCH_NO_VALUE_STEMS = [
        function(label) { return 'Outstanding ' + label + '!'; },
        function(label) { return 'Big ' + label + ' period!'; },
        function(label) { return label + ' was a standout!'; },
        function(label) { return 'Strong showing on ' + label + '!'; },
        function(label) { return label + ' was the story here!'; }
    ];

    // The solo lines close with a tail out of SOLO_TOP_TAILS, so these stop on
    // a full stop and hand over.
    var BATCH_SOLO_STEMS = [
        function(label, val) { return val ? label + ': ' + val + '.' : label + '.'; },
        function(label, val) { return val ? val + ' on ' + label + '.' : label + '.'; },
        function(label, val) { return val ? label + ' at ' + val + '.' : label + '.'; },
        function(label, val) { return val ? 'Put up ' + val + ' on ' + label + '.' : label + '.'; },
        function(label, val) { return val ? label + ' finished on ' + val + '.' : label + '.'; }
    ];

    // Kept off the emoji that already carry a meaning here: \uD83E\uDD47 is a solo top
    // spot, \uD83D\uDCAF a flawless survey week, \uD83D\uDC51 and \uD83C\uDFC5 head a name.
    var BATCH_LINE_ICONS = [
        '\uD83C\uDF1F', '\u2B50', '\u2728', '\uD83D\uDCAB', '\uD83D\uDD25', '\uD83D\uDCAA', '\uD83D\uDCC8'
    ];

    // Walked rather than drawn fresh each time, so regenerating twice in a row
    // cannot land on the same opening. A random pick out of ten repeats about
    // one time in ten, which is often enough to look like nothing changed.
    var nextBatchIntro = rotator(BATCH_INTRO);
    var nextBatchCloser = rotator(BATCH_CLOSERS);

    function formatMetricValue(key, value) {
        if (value === null || value === undefined) return '';
        var registryKey = METRIC_RANK_LABELS[key]?.registry || key;
        var reg = window.METRICS_REGISTRY?.[registryKey];
        if (!reg) return String(value);
        if (reg.unit === 'sec') return Math.round(value) + 's';
        if (reg.unit === 'hrs') return parseFloat(value).toFixed(1) + ' hrs';
        if (reg.unit === '%') return parseFloat(value).toFixed(1) + '%';
        return String(value);
    }

    /**
     * How to word a top spot that several people share.
     *
     * Deliberately about the value rather than the placing: "one of 15 at 100%"
     * says what they did, where "#1 in Center" would tell them where they sit
     * against their peers. Returns a ready-to-append clause, or '' when the
     * spot is not actually shared.
     */
    function describeTie(achievement, valueText) {
        var count = (achievement && achievement.tiedCount) || 1;
        if (count < 2) return '';
        var value = valueText || (achievement.value !== null && achievement.value !== undefined
            ? formatMetricValue(achievement.key, achievement.value) : '');
        return value
            ? 'one of ' + count + ' associates at ' + value
            : 'one of ' + count + ' associates at the top';
    }

    // Wraps a tie note in whatever punctuation the surrounding line wants,
    // and disappears entirely when there is no tie.
    function tieClause(note, before, after) {
        return note ? before + note + after : '';
    }

    /**
     * How big the field was and how much of it they beat.
     *
     * Returns null rather than zeroes when the numbers would be misleading: a
     * three-person pool is not a field worth naming, and "better than 0" is a
     * demotion dressed up as praise. This is relative positioning, so it belongs
     * in the private message and the manager's own view — never the channel post.
     */
    function fieldCounts(achievement) {
        var pool = achievement && achievement.rankedCount;
        var beat = achievement && achievement.betterThan;
        if (typeof pool !== 'number' || !isFinite(pool) || pool < 10) return null;
        if (typeof beat !== 'number' || !isFinite(beat) || beat < 1) return null;
        return { beat: beat, pool: pool };
    }

    // "better than 117 of 124 associates", or '' when the field is too thin to
    // say anything honest about.
    function describeField(achievement) {
        var c = fieldCounts(achievement);
        return c ? 'better than ' + c.beat + ' of ' + c.pool + ' associates' : '';
    }

    function ordinal(n) {
        var tens = n % 100;
        if (tens >= 11 && tens <= 13) return n + 'th';
        return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
    }

    /**
     * The whole placing in one plain sentence, for the manager's own view.
     *
     * "#1 in Center · better than 3 of 19 associates" was two true facts that
     * read as a contradiction, because the thing standing between them — a
     * sixteen-way tie at 100% — was never said out loud. So the tie goes in the
     * sentence.
     *
     * The pool used to be spelled out too — "6th of 109 scored on it" — and it
     * was accurate but nobody reads a placing that way. "6th in call center" is
     * how the placing gets said out loud, so that is how it is written. The tie
     * still carries the caveat, which was the half that actually mattered.
     */
    function describePlacement(achievement) {
        if (!achievement) return '';
        var rank = achievement.rank;
        var tied = achievement.tiedCount || 1;
        var pool = achievement.rankedCount;
        var value = achievement.value !== null && achievement.value !== undefined
            ? formatMetricValue(achievement.key, achievement.value) : '';

        var place;
        if (!rank || !isFinite(rank)) place = '';
        else if (rank === 1) place = tied > 1 ? 'one of ' + tied + ' tied for first' : 'best';
        else place = tied > 1 ? 'tied for ' + ordinal(rank) : ordinal(rank);

        // A field of one is not a center, so it stays a bare placing rather than
        // claiming a win over nobody.
        var field = (place && pool !== 1) ? ' in call center' : '';

        var placing = place + field;
        if (!placing) return value;
        return value ? value + ' — ' + placing : placing;
    }

    /**
     * Where the placing sits in the building, said out loud.
     *
     * The shout-out used to name the number and stop there, on the reasoning
     * that a rank is a comparison and comparisons belong in private. The floor
     * reads it the other way round: "6th best in the Call Center" is the part
     * that makes the number mean something, and it is what gets said when
     * people talk about it anyway.
     */
    function centerPlacement(achievement) {
        var rank = achievement && achievement.rank;
        if (!rank || !isFinite(rank)) return '';
        var shared = (achievement.tiedCount || 1) > 1;
        if (rank === 1) return shared ? 'tied for #1 in the Call Center' : '#1 in the Call Center';
        return (shared ? 'tied for ' : '') + ordinal(rank) + ' best in the Call Center';
    }

    // The placing as a sentence of its own, ready to append to a line that has
    // already closed. Empty when there is no rank worth naming.
    function sentencePlacement(achievement) {
        var placing = centerPlacement(achievement);
        if (!placing) return '';
        return ' ' + placing.charAt(0).toUpperCase() + placing.slice(1) + '.';
    }

    /**
     * The tier badge that goes with a placing.
     *
     * Everything that reaches a shout-out is inside the top ten already, so the
     * badge exists to say which half of it. #1 gets nothing — the placing has
     * said it more strongly than a tier ever could, and "Top 5!" under "#1 in
     * the Call Center" reads as a downgrade.
     */
    function tierBadge(achievement) {
        var rank = achievement && achievement.rank;
        if (!rank || !isFinite(rank) || rank === 1) return '';
        if (rank <= 5) return 'Top 5!';
        if (rank <= 10) return 'Top 10!';
        return '';
    }

    // A flawless set of surveys, and how many were behind it.
    //
    // The count is the whole proof and is never left out: one perfect survey
    // reads very differently from eleven, and with no floor on the sample any
    // more the reader has to be able to tell which one they are looking at.
    /**
     * What to call the stretch of time in copy, since the reader picks the
     * window. "All 6 of them this week" printed under a month-to-date
     * shout-out is simply wrong, and it was wrong on every window but one.
     *
     * Metadata first. A key whose upload has since gone still carries its span,
     * and the span alone is enough to name the shape of the period.
     */
    function periodNoun(periodKey) {
        var weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        var ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        var daily = typeof dailyData !== 'undefined' ? dailyData : {};
        var meta = (weekly[periodKey] || ytd[periodKey] || daily[periodKey] || {}).metadata || {};

        var byType = {
            daily: 'that day',
            week: 'this week',
            'week-in-progress': 'this week',
            month: 'this month',
            'month-to-date': 'this month',
            'month-agg': 'this month',
            quarter: 'this quarter',
            ytd: 'this year'
        };
        if (byType[meta.periodType]) return byType[meta.periodType];

        var parts = String(periodKey || '').split('|');
        if (parts.length < 2) return 'this period';
        var start = new Date(parts[0] + 'T00:00:00');
        var end = new Date(parts[1] + 'T00:00:00');
        if (isNaN(start.getTime()) || isNaN(end.getTime())) return 'this period';

        var days = Math.round((end.getTime() - start.getTime()) / 86400000) + 1;
        if (days <= 1) return 'that day';
        if (days <= 8) return 'this week';
        if (days <= 31) return 'this month';
        if (days <= 95) return 'this quarter';
        return 'this year';
    }

    function perfectSurveyLine(perfect) {
        var n = perfect && perfect.count;
        if (!n) return '';
        // Carried on the object rather than passed in, because this line is
        // rendered from four places and only detection knows the period.
        var when = (perfect && perfect.periodNoun) || 'this period';
        if (n === 1) return 'PERFECT survey — the one that came in ' + when + ' was flawless!';
        return 'PERFECT surveys — all ' + n + ' of them ' + when + ', not one off the mark!';
    }

    // The same fact as its own sentence, for lines that already close with
    // their own punctuation.
    function fieldSentence(achievement) {
        var c = fieldCounts(achievement);
        return c ? ' Better than ' + c.beat + ' of ' + c.pool + ' associates.' : '';
    }

    function generateShoutOut(person, dateRange) {
        var lines = [];
        // Same reason as the batch post: this goes in the channel, so the name
        // is written the way a mention is written.
        lines.push(pick(SHOUTOUT_OPENERS)('@' + person.firstName));
        if (dateRange) lines.push('📅 ' + dateRange);
        lines.push('');
        if (person.perfectSurveys) {
            lines.push('\uD83D\uDCAF ' + perfectSurveyLine(person.perfectSurveys));
        }
        person.achievements.forEach(function(a) {
            var valStr = a.value !== null && a.value !== undefined ? ' ' + formatMetricValue(a.key, a.value) : '';
            var placing = sentencePlacement(a);
            var badge = tierBadge(a);
            if (a.soloRank1) {
                lines.push(valStr
                    ? pick(ONLY_ONE_LINES)(a.label, valStr.trim())
                    : pick(ONLY_ONE_NO_VALUE_LINES)(a.label));
            } else {
                // Lead with the fact/value, then say where in the building it
                // put them \u2014 that is the half people repeat to each other.
                if (valStr) {
                    lines.push('\uD83C\uDF1F ' + a.label + ' hit ' + valStr.trim() + '!' + placing
                        + (badge ? ' ' + badge : '')
                        + tieClause(describeTie(a, valStr.trim()), ' (', ')'));
                } else {
                    lines.push(pick(STANDOUT_LINES)(a.label) + placing);
                }
            }
        });
        lines.push('');
        lines.push(pick(SHOUTOUT_CLOSERS));
        return lines.join('\n');
    }

    function generateAllShoutOuts(celebrations, dateRange) {
        if (!celebrations.length) return 'No celebrations to report right now.';
        var msg = nextBatchIntro();
        // Fresh per post, so the lines inside one post read as separate
        // sentences rather than one sentence with the nouns swapped.
        var metricStem = rotator(BATCH_METRIC_STEMS);
        var noValueStem = rotator(BATCH_NO_VALUE_STEMS);
        var soloStem = rotator(BATCH_SOLO_STEMS);
        var lineIcon = rotator(BATCH_LINE_ICONS);
        // At the foot of a nine-person post nobody ever reached it, so people
        // were reading a week-old shout-out as if it were today's.
        if (dateRange) msg += '\uD83D\uDCC5 ' + dateRange + '\n\n';
        celebrations.forEach(function(person, idx) {
            // One blank line either side of the rule. Every block already ends
            // in a newline, so the old separator opened with two more and left
            // a double gap above the rule and a single one below it.
            if (idx > 0) msg += '\n---\n\n';
            // \uD83D\uDCAF as a header emoji only ever sat above a \uD83D\uDCAF line, which read as
            // a stutter. The header says whether they took a top spot; the
            // lines underneath say what for.
            var emoji = person.achievements.some(function(a) { return a.soloRank1; }) ? '\uD83D\uDC51' : '\uD83C\uDFC5';
            // Named with an @ so the post can go up as written and each name is
            // picked up as a real mention instead of being retyped.
            msg += emoji + ' @' + person.firstName + '\n';
            // Leads, because there is no better thing on the board than a week
            // where every customer who was asked came back with a top score.
            if (person.perfectSurveys) {
                msg += '\uD83D\uDCAF ' + perfectSurveyLine(person.perfectSurveys) + '\n';
            }
            // Fresh per person, so four top spots read as four wins rather than
            // one sentence stamped four times.
            var soloTail = rotator(SOLO_TOP_TAILS);
            person.achievements.forEach(function(a) {
                var valStr = a.value !== null && a.value !== undefined ? formatMetricValue(a.key, a.value) : '';
                var placing = sentencePlacement(a);
                var badge = tierBadge(a);
                if (a.soloRank1) {
                    msg += '\uD83E\uDD47 ' + soloStem()(a.label, valStr) + ' ' + soloTail() + '\n';
                } else {
                    if (valStr) {
                        msg += lineIcon() + ' ' + metricStem()(a.label, valStr) + placing
                            + (badge ? ' ' + badge : '')
                            + tieClause(describeTie(a, valStr), ' (', ')') + '\n';
                    } else {
                        msg += lineIcon() + ' ' + noValueStem()(a.label) + placing
                            + (badge ? ' ' + badge : '') + '\n';
                    }
                }
            });
        });
        msg += nextBatchCloser();
        return msg;
    }

    // --- Direct message ---

    var DM_OPENERS = [
        function(name) { return 'Hey ' + name + '! \uD83C\uDF1F'; },
        function(name) { return name + '! \uD83C\uDF89'; },
        function(name) { return 'Hey ' + name + ', wanted to reach out real quick! \u2B50'; },
        function(name) { return name + '! Got something great to share with you! \uD83D\uDE0A'; },
        function(name) { return 'Hey ' + name + '! Hope your day is going well \uD83D\uDE4C'; },
        function(name) { return name + ', I\'ve been wanting to send you this! \uD83C\uDF1F'; },
        function(name) { return 'Hey ' + name + '! Got a sec? I have some good news for you \uD83D\uDE0A'; },
        function(name) { return name + '! Quick message because I couldn\'t let this go unrecognized \uD83C\uDFC6'; },
        function(name) { return 'Hi ' + name + '! Just had to drop you a note \u2B50'; },
        function(name) { return name + '! You\'re going to like this one \uD83D\uDE04'; },
        function(name) { return 'Hey ' + name + '! Something caught my eye and I had to tell you about it \uD83D\uDC40'; },
        function(name) { return name + ', just dropping in with some well-deserved recognition! \uD83C\uDF89'; },
        function(name) { return 'Hey ' + name + '! Glad I caught you \u2014 I\'ve got something great to share \uD83C\uDF1F'; },
        function(name) { return name + '! Real talk, I had to reach out about this \uD83D\uDCAA'; }
    ];

    var DM_CLOSERS = [
        'Seriously, great work. I wanted to make sure you knew how much I appreciate what you\'re doing. \uD83D\uDE4F',
        'Just wanted you to know I see the effort and the results. Keep being awesome! \uD83D\uDCAA',
        'You should be really proud of this. I know I am! \uD83D\uDE0A',
        'This is the kind of performance that stands out. Keep it up! \uD83D\uDE80',
        'Wanted to make sure you heard this from me directly. Outstanding work! \uD83C\uDFC6',
        'I don\'t take performances like this for granted. Thank you for what you do every day. \uD83D\uDE4F',
        'Just genuinely proud of you. Keep doing exactly what you\'re doing. \uD83D\uDE0A',
        'You earned every bit of this recognition. Enjoy the moment! \uD83C\uDF89',
        'This is the stuff that makes my job easy \u2014 watching people like you succeed. \uD83D\uDCAA',
        'Keep bringing this energy. It makes a bigger difference than you probably realize. \uD83C\uDF1F',
        'I love getting to send messages like this. You made it easy! \u2B50',
        'Your hard work is paying off in a real way. Don\'t stop now! \uD83D\uDE80',
        'Moments like this are why I love this team. Great job, seriously. \uD83D\uDE4C'
    ];

    var DM_INTROS = [
        'I was looking at the numbers and I had to reach out because you are doing incredible things:',
        'I just pulled up the results and your name jumped right off the page:',
        'So I was going through the metrics and honestly, I had to stop and send you this because WOW:',
        'I don\'t always send these messages, but when I see performance like this I have to say something:',
        'Your numbers caught my attention and I wanted to make sure you knew about it:',
        'I was going through the numbers and couldn\'t let this slide without reaching out to you:',
        'Real quick \u2014 I saw your results and just had to give you your flowers:',
        'I noticed something really impressive when I was looking at the data:',
        'I keep an eye on the numbers and yours are standing out in a big way:',
        'Had to send this because what you\'re doing right now deserves to be recognized:',
        'Just went through the results and I\'m genuinely impressed by what I\'m seeing from you:',
        'You probably already know you had a great run, but I wanted to tell you just how great:'
    ];

    /**
     * The one-to-one version. This is the only celebration message that names
     * how many people they beat: it goes to one person, so it cannot turn into
     * a podium the way a channel post naming nine people would.
     */
    function generateDirectMessage(person, dateRange) {
        var lines = [];
        lines.push(pick(DM_OPENERS)(person.firstName));
        lines.push('');
        lines.push(pick(DM_INTROS));
        // What "this" covers, said before the numbers rather than after them.
        if (dateRange) lines.push('\uD83D\uDCC5 ' + dateRange);
        lines.push('');
        if (person.perfectSurveys) {
            lines.push('\uD83D\uDCAF ' + perfectSurveyLine(person.perfectSurveys));
        }
        person.achievements.forEach(function(a) {
            var valStr = a.value !== null && a.value !== undefined ? formatMetricValue(a.key, a.value) : '';
            var placing = sentencePlacement(a);
            if (a.soloRank1) {
                lines.push('\uD83E\uDD47 You\'re the only associate in the Call Center to hit this for ' + a.label + '!' + (valStr ? ' (' + valStr + ')' : '')
                    + fieldSentence(a));
            } else {
                if (valStr) {
                    lines.push('\uD83C\uDF1F Your ' + a.label + ' hit ' + valStr + '!' + placing
                        + tieClause(describeTie(a, valStr), ' You are ', ', great company to be in.')
                        + fieldSentence(a));
                } else {
                    lines.push('\uD83C\uDFC5 Your ' + a.label + ' is outstanding!' + placing + fieldSentence(a));
                }
            }
        });
        // The one just outside the bar, said only here. It is encouragement
        // addressed to one person; in a channel post naming the winners it
        // would read as marking somebody for not making it.
        var nearMiss = describeNearMiss(person.nearMiss);
        if (nearMiss) {
            lines.push('');
            lines.push(nearMiss);
        }
        lines.push('');
        lines.push(pick(DM_CLOSERS));
        return lines.join('\n');
    }

    // =====================
    // UI - Badge helpers
    // =====================

    function getTierBadge(tier) {
        if (tier === 1) return { bg: '#ffd700', color: '#7c5c00', text: '#1', glow: '0 0 8px rgba(255,215,0,0.6)' };
        if (tier <= 5) return { bg: '#c0c0c0', color: '#444', text: 'Top 5', glow: '0 0 6px rgba(192,192,192,0.5)' };
        if (tier <= 10) return { bg: '#cd7f32', color: '#fff', text: 'Top 10', glow: '0 0 6px rgba(205,127,50,0.4)' };
        return { bg: '#667eea', color: '#fff', text: 'Top ' + tier, glow: 'none' };
    }

    // =====================
    // UI - Current View
    // =====================

    function renderCelebrations(container) {
        if (!container) return;

        var selection = loadCelebrationSelection();
        var allKeys = getAllPeriodKeys();
        var selectedKey = selection.periodKey;
        // Default to latest key if none selected or saved key no longer exists
        if (!selectedKey || allKeys.indexOf(selectedKey) === -1) {
            selectedKey = allKeys.length ? allKeys[allKeys.length - 1] : null;
        }

        var result = detectCelebrations(selectedKey);
        var celebrations = result.celebrations;
        var dateRange = result.dateRange;
        var effectiveKey = result.periodKey;

        // Auto-log to history
        if (celebrations.length && effectiveKey) {
            logCelebrations(effectiveKey, dateRange, celebrations);
        }

        var customThreshold = getCustomThreshold();
        var tiers = getActiveTiers();

        var html = '';

        // View toggle (Current | History)
        html += renderViewToggle('current');

        // Period selector
        html += '<div style="margin-bottom:12px; padding:12px 16px; background:var(--bg-surface); border:1px solid #e0e7ff; border-radius:10px; display:grid; grid-template-columns:1fr auto; gap:12px; align-items:end;">';
        html += '<div>';
        html += '<label for="celebrationPeriodSelect" style="display:block; font-size:0.85em; font-weight:600; color:var(--text-secondary); margin-bottom:6px;">Data Period</label>';
        html += '<select id="celebrationPeriodSelect" style="width:100%; padding:10px 12px; border:1px solid var(--border-strong); border-radius:8px; font-size:0.95em;"' + (allKeys.length ? '' : ' disabled') + '>';
        if (!allKeys.length) {
            html += '<option value="">No periods with 30+ employees</option>';
        } else {
            allKeys.slice().reverse().forEach(function(key) {
                var sel = key === selectedKey ? ' selected' : '';
                html += '<option value="' + _escapeHtml(key) + '"' + sel + '>' + _escapeHtml(getPeriodLabel(key)) + ' (' + getPeriodEmployeeCount(key) + ' employees)</option>';
            });
        }
        html += '</select></div>';
        // Threshold controls
        html += '<div style="display:flex; align-items:end; gap:8px;">';
        html += '<div>';
        html += '<label for="celebrationCustomThreshold" style="display:block; font-size:0.85em; font-weight:600; color:var(--text-secondary); margin-bottom:6px;">Custom Top N</label>';
        html += '<input type="number" id="celebrationCustomThreshold" min="1" max="999" placeholder="e.g. 15" value="' + (customThreshold || '') + '" style="width:80px; padding:10px 8px; border:1px solid var(--border-strong); border-radius:8px; font-size:0.95em;">';
        html += '</div>';
        html += '<button type="button" id="celebrationSaveThreshold" style="padding:10px 14px; background:#4338ca; color:#fff; border:none; border-radius:8px; font-size:0.9em; cursor:pointer; font-weight:600;">Set</button>';
        html += '</div>';
        html += '</div>';

        // Tiers indicator
        html += '<div style="margin-bottom:16px; display:flex; gap:6px; align-items:center; flex-wrap:wrap;">';
        html += '<span style="font-size:0.85em; color:var(--text-secondary); font-weight:600;">Active tiers:</span>';
        tiers.forEach(function(t) {
            var badge = getTierBadge(t);
            html += '<span style="padding:3px 10px; background:' + badge.bg + '; color:' + badge.color + '; border-radius:12px; font-size:0.8em; font-weight:700;">' + (t === 1 ? '#1' : 'Top ' + t) + '</span>';
        });
        if (dateRange) {
            html += '<span style="margin-left:auto; font-size:0.85em; color:var(--text-secondary);">\uD83D\uDCC5 ' + _escapeHtml(dateRange) + '</span>';
        }
        html += '</div>';

        if (!celebrations.length) {
            html += '<div style="text-align:center; padding:40px 20px 20px; color:var(--text-tertiary);">';
            html += '<div style="font-size:3em; margin-bottom:16px;">\uD83C\uDFC6</div>';
            html += '<h3 style="color:var(--text-secondary); margin:0 0 8px 0;">Nobody cleared the bar this period</h3>';
            html += '<p style="margin:0;">Celebrations fire on a <strong>top ' + tiers[tiers.length - 1] + '</strong> rank across the whole center, so a strong period can still come up empty here.</p>';
            html += '</div>';
            html += renderMissedList(result.missed);
            container.innerHTML = html;
            bindCurrentViewControls(container);
            return;
        }

        // Generate All button
        html += '<div style="margin-bottom:16px; display:flex; gap:12px; flex-wrap:wrap;">';
        html += '<button type="button" id="celebrationGenerateAll" style="padding:12px 24px; background:linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color:#fff; border:none; border-radius:8px; font-weight:bold; font-size:1em; cursor:pointer; box-shadow:0 2px 8px rgba(234,88,12,0.3);">';
        html += '\uD83C\uDF89 Generate All Shout-Outs</button>';
        html += '<div style="display:flex; align-items:center; gap:8px; color:var(--text-secondary); font-size:0.9em;">';
        html += '\uD83C\uDFC5 ' + celebrations.length + ' team member' + (celebrations.length !== 1 ? 's' : '') + ' with achievements';
        html += '</div></div>';

        // Cards
        html += renderCelebrationCards(celebrations, dateRange);
        html += renderMissedList(result.missed);

        container.innerHTML = html;
        bindCurrentViewControls(container);
        bindCelebrationButtons(container, celebrations, dateRange);
    }

    // A blank screen reads as "they did nothing". This says how close they
    // actually were, so a near miss looks like a near miss.
    function renderMissedList(missed) {
        var list = missed || [];
        if (!list.length) return '';

        var open = list.length <= 3 ? ' open' : '';
        var html = '<details' + open + ' style="margin-top:18px; border:1px solid var(--border); border-radius:10px; padding:12px 16px; background:var(--bg-surface-raised);">';
        html += '<summary style="cursor:pointer; font-weight:700; color:var(--text-secondary);">Not this time (' + list.length + ') — how close they were</summary>';
        html += '<div style="margin-top:10px;">';
        list.forEach(function(info) {
            html += '<div style="padding:6px 0; border-bottom:1px solid var(--border); font-size:0.9em; color:var(--text-primary);">'
                + _escapeHtml(describeNoCelebration(info)) + '</div>';
        });
        html += '</div></details>';
        return html;
    }

    function renderCelebrationCards(celebrations, dateRange) {
        var html = '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(340px, 1fr)); gap:16px;">';

        celebrations.forEach(function(person) {
            var hasOnlyOne = person.achievements.some(function(a) { return a.soloRank1; });
            var cardBorder = hasOnlyOne ? '#ffd700' : '#667eea';
            var cardGlow = hasOnlyOne ? '0 0 8px rgba(255,215,0,0.6)' : 'none';

            html += '<div class="celebration-card" style="background:var(--bg-surface); border-radius:10px; border:2px solid ' + cardBorder + '; padding:16px; display:flex; flex-direction:column; gap:10px; box-shadow:' + cardGlow + ';">';

            // Header
            html += '<div style="display:flex; justify-content:space-between; align-items:center;">';
            html += '<div style="font-weight:700; font-size:1.1em; color:var(--text-primary);">' + _escapeHtml(person.firstName) + '</div>';
            html += '<div style="display:flex; gap:4px;">';
            if (hasOnlyOne) {
                html += '<span style="padding:3px 10px; background:#ffd700; color:#7c5c00; border-radius:12px; font-size:0.8em; font-weight:700;">\uD83C\uDFC6 Only One!</span>';
            } else {
                html += '<span style="padding:3px 10px; background:#667eea; color:#fff; border-radius:12px; font-size:0.8em; font-weight:700;">\u2B50 Standout</span>';
            }
            html += '</div></div>';

            // Date range
            if (dateRange) {
                html += '<div style="font-size:0.8em; color:var(--text-secondary);">\uD83D\uDCC5 ' + _escapeHtml(dateRange) + '</div>';
            }

            // Achievement list — fact-based, no ranking numbers
            html += '<div style="display:flex; flex-direction:column; gap:6px;">';
            if (person.perfectSurveys) {
                html += '<div style="padding:8px 12px; background:#f0fdf4; border-left:3px solid #22c55e; border-radius:4px; font-size:0.9em;">' +
                    '\uD83D\uDCAF ' + _escapeHtml(perfectSurveyLine(person.perfectSurveys)) + '</div>';
            }
            person.achievements.forEach(function(a) {
                var valStr = a.value !== null && a.value !== undefined ? _escapeHtml(formatMetricValue(a.key, a.value)) : '';
                var emoji = a.soloRank1 ? '\uD83E\uDD47' : '\uD83C\uDF1F';
                var bg = a.soloRank1 ? '#fffbeb' : '#f0f9ff';
                var border = a.soloRank1 ? '#fbbf24' : '#93c5fd';
                var placing = centerPlacement(a);
                html += '<div style="padding:8px 12px; background:' + bg + '; border-left:3px solid ' + border + '; border-radius:4px; font-size:0.9em;">';
                if (a.soloRank1) {
                    // "Only one" is about the number, not the metric — other
                    // cards can show the same metric at a different value.
                    html += emoji + ' <strong>' + _escapeHtml(a.label) + '</strong>' + (valStr ? ': ' + valStr : '') +
                        ' <span style="color:var(--text-secondary);">— #1 in the Call Center, nobody else got there</span>';
                } else {
                    if (valStr) {
                        html += emoji + ' <strong>' + _escapeHtml(a.label) + '</strong>: ' + valStr + '!';
                    } else {
                        html += emoji + ' Outstanding <strong>' + _escapeHtml(a.label) + '</strong>!';
                    }
                    // The placing, said on the card the same way the post says it.
                    if (placing) {
                        html += ' <span style="color:var(--text-secondary);">' +
                            _escapeHtml(placing.charAt(0).toUpperCase() + placing.slice(1)) + '.</span>';
                    }
                }
                html += '</div>';
            });
            html += '</div>';

            // Action buttons
            html += '<div style="display:flex; gap:8px; margin-top:auto;">';
            html += '<button type="button" class="celebration-shoutout-btn" data-employee="' + _escapeHtml(person.name) + '" ' +
                'style="flex:1; background:linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color:#fff; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold; font-size:0.9em;">' +
                '\uD83C\uDF89 Shout-Out</button>';
            html += '<button type="button" class="celebration-dm-btn" data-employee="' + _escapeHtml(person.name) + '" ' +
                'style="flex:1; background:linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%); color:#fff; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold; font-size:0.9em;">' +
                '\uD83D\uDCAC Message</button>';
            html += '</div>';

            html += '</div>';
        });

        html += '</div>';
        return html;
    }

    // =====================
    // UI - History View
    // =====================

    function renderHistoryView(container) {
        if (!container) return;

        var history = loadHistory();
        var yearStats = buildYearStats();

        var html = '';
        html += renderViewToggle('history');

        // Year-at-a-glance stats
        if (yearStats.length) {
            html += '<div style="margin-bottom:20px;">';
            html += '<h3 style="color:var(--text-primary); margin:0 0 12px 0;">\uD83C\uDFC6 ' + new Date().getFullYear() + ' Year-to-Date Stats</h3>';
            html += '<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:12px;">';

            yearStats.forEach(function(s) {
                html += '<div style="background:var(--bg-surface); border-radius:10px; border:1px solid #e0e7ff; padding:14px; display:flex; flex-direction:column; gap:8px;">';
                html += '<div style="font-weight:700; font-size:1.05em; color:var(--text-primary);">' + _escapeHtml(s.firstName) + '</div>';

                // Summary stats
                html += '<div style="display:flex; gap:12px; flex-wrap:wrap; font-size:0.85em;">';
                html += '<span style="color:var(--text-secondary);"><strong>' + s.totalAppearances + '</strong> period' + (s.totalAppearances !== 1 ? 's' : '') + ' recognized</span>';
                if (s.numberOneCount) html += '<span style="color:#b8860b;">\uD83E\uDD47 Only one x' + s.numberOneCount + '</span>';
                html += '</div>';

                // Metric breakdown
                var metricKeys = Object.keys(s.metricBreakdown).filter(function(mk) {
                    return mk !== 'composite' && mk !== 'reliability';
                });
                if (metricKeys.length) {
                    html += '<div style="display:flex; flex-wrap:wrap; gap:4px;">';
                    metricKeys.forEach(function(mk) {
                        var meta = METRIC_RANK_LABELS[mk];
                        var label = meta ? meta.label : mk;
                        html += '<span style="padding:2px 8px; background:#f0f9ff; border:1px solid #bfdbfe; border-radius:8px; font-size:0.8em; color:#1e40af;">' + _escapeHtml(label) + ' x' + s.metricBreakdown[mk] + '</span>';
                    });
                    html += '</div>';
                }

                html += '</div>';
            });

            html += '</div></div>';
        }

        // Period-by-period history
        html += '<h3 style="color:var(--text-primary); margin:0 0 12px 0;">\uD83D\uDCC5 Celebration History</h3>';

        if (!history.length) {
            html += '<div style="text-align:center; padding:40px 20px; color:var(--text-tertiary);">';
            html += '<p style="margin:0;">No celebration history yet. View the Current tab with uploaded data to start logging.</p>';
            html += '</div>';
        } else {
            history.forEach(function(entry) {
                html += '<div style="margin-bottom:16px; background:var(--bg-surface); border:1px solid var(--border); border-radius:10px; overflow:hidden;">';
                // Period header
                html += '<div style="padding:12px 16px; background:var(--bg-surface-raised); border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">';
                html += '<div style="font-weight:700; color:var(--text-primary);">\uD83D\uDCC5 ' + _escapeHtml(entry.dateRange || entry.periodKey) + '</div>';
                html += '<div style="font-size:0.8em; color:var(--text-tertiary);">' + entry.entries.length + ' celebrated</div>';
                html += '</div>';
                // People in this period
                html += '<div style="padding:12px 16px; display:flex; flex-wrap:wrap; gap:8px;">';
                entry.entries.forEach(function(person) {
                    var hasOnlyOne = person.achievements.some(function(a) { return a.soloRank1; });
                    html += '<div style="padding:8px 12px; background:var(--bg-surface-raised); border:1px solid #e0e7ff; border-radius:8px; display:flex; align-items:center; gap:6px;">';
                    html += '<span style="font-weight:600; font-size:0.9em;">' + _escapeHtml(person.firstName || _getFirstName(person.name)) + '</span>';
                    person.achievements.forEach(function(a) {
                        if (a.key === 'composite' || a.key === 'reliability') return;
                        var metaLabel = METRIC_RANK_LABELS[a.key]?.label || a.key;
                        var emoji = a.soloRank1 ? '\uD83E\uDD47' : '\uD83C\uDF1F';
                        var bg = a.soloRank1 ? '#ffd700' : '#667eea';
                        var color = a.soloRank1 ? '#7c5c00' : '#fff';
                        html += '<span style="font-size:0.75em; padding:2px 6px; background:' + bg + '; color:' + color + '; border-radius:8px;" title="' + _escapeHtml(metaLabel) + '">' + emoji + ' ' + _escapeHtml(metaLabel) + '</span>';
                    });
                    html += '</div>';
                });
                html += '</div></div>';
            });
        }

        container.innerHTML = html;
        bindHistoryViewControls(container);
    }

    // =====================
    // UI - View toggle
    // =====================

    function renderViewToggle(activeView) {
        var currentActive = activeView === 'current';
        var historyActive = activeView === 'history';
        var html = '<div style="display:flex; gap:0; margin-bottom:16px; border:2px solid #e0e7ff; border-radius:10px; overflow:hidden;">';
        html += '<button type="button" id="celebViewCurrent" style="flex:1; padding:10px 20px; border:none; font-weight:700; font-size:0.95em; cursor:pointer; ' +
            (currentActive ? 'background:linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color:#fff;' : 'background:#fff; color:var(--text-secondary);') + '">\uD83C\uDFC6 Current</button>';
        html += '<button type="button" id="celebViewHistory" style="flex:1; padding:10px 20px; border:none; font-weight:700; font-size:0.95em; cursor:pointer; ' +
            (historyActive ? 'background:linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); color:#fff;' : 'background:#fff; color:var(--text-secondary);') + '">\uD83D\uDCCA History</button>';
        html += '</div>';
        return html;
    }

    // =====================
    // UI - Control binding
    // =====================

    function bindCurrentViewControls(container) {
        // View toggle
        var histBtn = container.querySelector('#celebViewHistory');
        if (histBtn) {
            histBtn.addEventListener('click', function() {
                var sel = loadCelebrationSelection();
                sel.view = 'history';
                saveCelebrationSelection(sel);
                renderHistoryView(container);
            });
        }

        // Period selector
        var periodSelect = container.querySelector('#celebrationPeriodSelect');
        if (periodSelect) {
            periodSelect.addEventListener('change', function() {
                var sel = loadCelebrationSelection();
                sel.periodKey = this.value || null;
                saveCelebrationSelection(sel);
                renderCelebrations(container);
            });
        }

        // Threshold
        var saveBtn = container.querySelector('#celebrationSaveThreshold');
        var input = container.querySelector('#celebrationCustomThreshold');
        if (saveBtn && input) {
            saveBtn.addEventListener('click', function() {
                saveCustomThreshold(input.value);
                renderCelebrations(container);
                if (typeof showToast === 'function') showToast('Threshold saved!', 2000);
            });
            input.addEventListener('keydown', function(e) {
                if (e.key === 'Enter') {
                    saveCustomThreshold(input.value);
                    renderCelebrations(container);
                    if (typeof showToast === 'function') showToast('Threshold saved!', 2000);
                }
            });
        }
    }

    function bindHistoryViewControls(container) {
        var curBtn = container.querySelector('#celebViewCurrent');
        if (curBtn) {
            curBtn.addEventListener('click', function() {
                var sel = loadCelebrationSelection();
                sel.view = 'current';
                saveCelebrationSelection(sel);
                renderCelebrations(container);
            });
        }
    }

    function bindCelebrationButtons(container, celebrations, dateRange) {
        // Generate All
        var genAllBtn = container.querySelector('#celebrationGenerateAll');
        if (genAllBtn) {
            genAllBtn.addEventListener('click', function() {
                var msg = generateAllShoutOuts(celebrations, dateRange);
                showShoutOutModal('Team Shout-Outs', msg, function() {
                    return generateAllShoutOuts(celebrations, dateRange);
                });
            });
        }

        // Individual shout-out buttons
        container.querySelectorAll('.celebration-shoutout-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var empName = this.dataset.employee;
                var person = celebrations.find(function(c) { return c.name === empName; });
                if (!person) return;
                var msg = generateShoutOut(person, dateRange);
                showShoutOutModal(person.firstName + ' - Shout-Out', msg, function() {
                    return generateShoutOut(person, dateRange);
                });
            });
        });

        // Individual DM buttons
        container.querySelectorAll('.celebration-dm-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var empName = this.dataset.employee;
                var person = celebrations.find(function(c) { return c.name === empName; });
                if (!person) return;
                var msg = generateDirectMessage(person, dateRange);
                showShoutOutModal(person.firstName + ' - Direct Message', msg, function() {
                    return generateDirectMessage(person, dateRange);
                });
            });
        });
    }

    // =====================
    // Modal
    // =====================

    function showShoutOutModal(title, message, regenerateFn) {
        copyToClipboard(message, { message: 'Copied to clipboard!' });

        var overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.5); display:flex; align-items:center; justify-content:center; z-index:10000; padding:20px;';

        overlay.innerHTML =
            '<div style="background:var(--bg-surface); border-radius:12px; max-width:600px; width:100%; max-height:80vh; display:flex; flex-direction:column; box-shadow:0 20px 60px rgba(0,0,0,0.3);">' +
                '<div style="padding:16px 20px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">' +
                    '<h3 style="margin:0; color:var(--text-primary);">\uD83C\uDF89 ' + _escapeHtml(title) + '</h3>' +
                    '<button type="button" id="shoutOutModalClose" style="background:none; border:none; font-size:1.5em; cursor:pointer; color:var(--text-tertiary);">\u2715</button>' +
                '</div>' +
                '<div style="padding:20px; overflow-y:auto; flex:1;">' +
                    '<textarea id="shoutOutModalText" style="width:100%; min-height:250px; border:1px solid var(--border); border-radius:8px; padding:12px; font-size:0.95em; font-family:inherit; resize:vertical; line-height:1.5;">' + _escapeHtml(message) + '</textarea>' +
                '</div>' +
                '<div style="padding:12px 20px; border-top:1px solid var(--border); display:flex; gap:8px; justify-content:flex-end;">' +
                    '<button type="button" id="shoutOutModalRegenerate" style="padding:10px 16px; background:var(--bg-surface-sunken); border:1px solid var(--border-strong); border-radius:8px; cursor:pointer; font-weight:600;">\uD83D\uDD04 Regenerate</button>' +
                    '<button type="button" id="shoutOutModalCopy" style="padding:10px 16px; background:linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%); color:#fff; border:none; border-radius:8px; cursor:pointer; font-weight:600;">\uD83D\uDCCB Copy</button>' +
                '</div>' +
            '</div>';

        document.body.appendChild(overlay);

        overlay.querySelector('#shoutOutModalClose').addEventListener('click', function() { overlay.remove(); });
        overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });

        overlay.querySelector('#shoutOutModalCopy').addEventListener('click', function() {
            var textarea = overlay.querySelector('#shoutOutModalText');
            copyToClipboard(textarea.value, { message: 'Copied!' });
        });

        overlay.querySelector('#shoutOutModalRegenerate').addEventListener('click', function() {
            if (!regenerateFn) return;
            var newMessage = regenerateFn();
            var textarea = overlay.querySelector('#shoutOutModalText');
            if (textarea && newMessage) {
                textarea.value = newMessage;
                copyToClipboard(newMessage, { message: 'Regenerated & copied!' });
            }
        });
    }

    // =====================
    // Inner tab toggle
    // =====================

    var INNER_TAB_STORAGE_KEY = STORAGE_PREFIX + 'celebrationsInnerTab';

    // All inner tabs in the Celebrations sub-section.
    var INNER_TABS = {
        celebrations: { container: 'celebrationsContainer', btn: 'innerNavCelebrations', activeBg: 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)', activeBorder: '#ea580c' },
        morningPulse: { container: 'morningPulseContainer', btn: 'innerNavMorningPulse', activeBg: 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)', activeBorder: '#2563eb' },
        cheerleader:  { container: 'cheerleaderContainer', btn: 'innerNavCheerleader', activeBg: 'linear-gradient(135deg, #10b981 0%, #059669 100%)', activeBorder: '#059669' }
    };

    function getActiveInnerTab() {
        try {
            var val = localStorage.getItem(INNER_TAB_STORAGE_KEY);
            return INNER_TABS[val] ? val : 'celebrations';
        } catch (e) { return 'celebrations'; }
    }

    function saveActiveInnerTab(tab) {
        try { localStorage.setItem(INNER_TAB_STORAGE_KEY, tab); } catch (e) { /* ok */ }
    }

    function switchInnerTab(tab) {
        if (!INNER_TABS[tab]) tab = 'celebrations';

        // Toggle container visibility and button styling for every tab.
        Object.keys(INNER_TABS).forEach(function(key) {
            var cfg = INNER_TABS[key];
            var cont = document.getElementById(cfg.container);
            var btn = document.getElementById(cfg.btn);
            var isActive = key === tab;
            if (cont) cont.style.display = isActive ? 'block' : 'none';
            if (btn) {
                btn.style.background = isActive ? cfg.activeBg : '#e2e8f0';
                btn.style.color = isActive ? '#fff' : '#64748b';
                btn.style.borderBottom = '3px solid ' + (isActive ? cfg.activeBorder : 'transparent');
            }
        });

        // Render the active tab's content.
        if (tab === 'morningPulse') {
            var pulse = window.DevCoachModules?.morningPulse;
            if (pulse?.renderMorningPulse) {
                pulse.renderMorningPulse(document.getElementById('morningPulseContainer'));
            }
        } else if (tab === 'cheerleader') {
            var cheer = window.DevCoachModules?.cheerleading;
            if (cheer?.renderCheerleading) {
                cheer.renderCheerleading(document.getElementById('cheerleaderContainer'));
            }
        } else {
            var celebrationsContainer = document.getElementById('celebrationsContainer');
            var sel = loadCelebrationSelection();
            if (sel.view === 'history') {
                renderHistoryView(celebrationsContainer);
            } else {
                renderCelebrations(celebrationsContainer);
            }
        }
        saveActiveInnerTab(tab);
    }

    function bindInnerNav() {
        Object.keys(INNER_TABS).forEach(function(tab) {
            var btn = document.getElementById(INNER_TABS[tab].btn);
            if (btn && !btn._celebBound) {
                btn._celebBound = true;
                btn.addEventListener('click', function() { switchInnerTab(tab); });
            }
        });
    }

    // =====================
    // Initialization
    // =====================

    function initializeCelebrations() {
        bindInnerNav();
        var activeTab = getActiveInnerTab();
        switchInnerTab(activeTab);
    }

    // Export
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.celebrations = {
        initializeCelebrations: initializeCelebrations,
        renderCelebrations: renderCelebrations,
        renderHistoryView: renderHistoryView,
        listShoutOutWindows: listShoutOutWindows,
        resolveShoutOutWindow: resolveShoutOutWindow,
        detectCelebrations: detectCelebrations,
        SHOUTOUT_EXCLUDED_METRICS: SHOUTOUT_EXCLUDED_METRICS,
        volumeVerdict: volumeVerdict,
        describeTie: describeTie,
        tieClause: tieClause,
        describeField: describeField,
        describePlacement: describePlacement,
        centerPlacement: centerPlacement,
        tierBadge: tierBadge,
        rotator: rotator,
        perfectSurveyWeek: perfectSurveyWeek,
        perfectSurveyLine: perfectSurveyLine,
        periodNoun: periodNoun,
        fieldSentence: fieldSentence,
        explainNoCelebration: explainNoCelebration,
        findNearMiss: findNearMiss,
        nearMissFor: nearMissFor,
        describeNearMiss: describeNearMiss,
        buildDisplayRanks: buildDisplayRanks,
        meetsCelebrationTarget: meetsCelebrationTarget,
        celebrationYear: celebrationYear,
        describeNoCelebration: describeNoCelebration,
        generateShoutOut: generateShoutOut,
        generateAllShoutOuts: generateAllShoutOuts,
        generateDirectMessage: generateDirectMessage,
        getCustomThreshold: getCustomThreshold,
        saveCustomThreshold: saveCustomThreshold,
        loadHistory: loadHistory,
        buildYearStats: buildYearStats
    };
})();
