(function () {
    'use strict';

    /**
     * HIGHLIGHTS
     *
     * "Give a shoutout to everyone who earned one" across the whole center,
     * for yesterday or for last week. Every other message generator in the tool
     * starts from one associate; this one starts from a period and finds the
     * people in it worth naming.
     *
     * Deliberately target-based, never rank-based. Nobody gets told they were
     * third — they get told they beat the number.
     */

    // Highest-signal first: a perfect survey set is a better lead than a metric
    // that cleared target by a hair.
    const KIND_ORDER = { perfectSurveys: 0, beatTarget: 1, improved: 2 };

    function toNumber(value) {
        if (value === '' || value === null || value === undefined) return null;
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : null;
    }

    // How far past target a value sits, in the direction that counts as good.
    function marginPastTarget(spec, value) {
        if (!Number.isFinite(value) || !Number.isFinite(spec.target)) return null;
        return spec.targetType === 'max' ? spec.target - value : value - spec.target;
    }

    // How much a value improved, in the direction that counts as good.
    function improvement(spec, previous, current) {
        if (!Number.isFinite(previous) || !Number.isFinite(current)) return null;
        return spec.targetType === 'max' ? previous - current : current - previous;
    }

    /**
     * Every survey metric at 100 is only worth saying out loud once, and only
     * when there were enough surveys for it to mean something — a single
     * perfect survey is not a perfect week.
     */
    function findPerfectSurveys(row, options) {
        const surveyKeys = options.surveyMetricKeys || [];
        if (!surveyKeys.length) return null;

        const surveyCount = toNumber(row.surveyTotal);
        const minSurveys = Number.isFinite(options.minSurveys) ? options.minSurveys : 3;
        if (!Number.isFinite(surveyCount) || surveyCount < minSurveys) return null;

        const scored = surveyKeys.map(key => toNumber(row[key])).filter(v => v !== null);
        if (scored.length < 2 || !scored.every(v => v >= 100)) return null;

        return {
            kind: 'perfectSurveys',
            key: 'perfectSurveys',
            label: 'Perfect surveys',
            value: surveyCount,
            detail: `${surveyCount} survey${surveyCount === 1 ? '' : 's'}, all perfect`
        };
    }

    /**
     * The people in this period worth naming, and why.
     *
     * options:
     *   metrics           [{ key, label, target, targetType, noise }]
     *   previousByName    { name: row } for the comparison period, optional
     *   surveyMetricKeys  which metrics a "perfect surveys" callout covers
     *   minSurveys        surveys needed before perfect counts (default 3)
     *   minCalls          call volume needed before a row is trusted (default 0)
     *   maxPerPerson      most callouts to keep per associate (default 3)
     */
    function findHighlights(employees, options) {
        const opts = options || {};
        const metrics = Array.isArray(opts.metrics) ? opts.metrics : [];
        const previous = opts.previousByName || {};
        const minCalls = Number.isFinite(opts.minCalls) ? opts.minCalls : 0;
        const maxPerPerson = Number.isFinite(opts.maxPerPerson) ? opts.maxPerPerson : 3;

        const entries = [];

        (employees || []).forEach(row => {
            const name = String(row?.name || '').trim();
            if (!name) return;

            // A rep with barely any volume can post a flattering number that
            // says nothing about how they worked. Skip rather than praise it.
            const calls = toNumber(row.totalCalls);
            if (minCalls > 0 && (!Number.isFinite(calls) || calls < minCalls)) return;

            const items = [];
            const perfect = findPerfectSurveys(row, opts);
            const coveredBySurveys = perfect ? new Set(opts.surveyMetricKeys || []) : new Set();
            if (perfect) items.push(perfect);

            metrics.forEach(spec => {
                if (coveredBySurveys.has(spec.key)) return;

                const value = toNumber(row[spec.key]);
                if (value === null) return;

                const noise = Number.isFinite(spec.noise) ? spec.noise : 0;
                const margin = marginPastTarget(spec, value);
                if (margin !== null && margin >= noise) {
                    items.push({
                        kind: 'beatTarget',
                        key: spec.key,
                        label: spec.label,
                        value,
                        target: spec.target,
                        margin
                    });
                    return;
                }

                // Not at target yet, but moving — that still earns a mention,
                // and it's often the one people most want to hear.
                const priorRow = previous[name];
                const gain = priorRow ? improvement(spec, toNumber(priorRow[spec.key]), value) : null;
                if (gain !== null && noise > 0 && gain >= noise) {
                    items.push({
                        kind: 'improved',
                        key: spec.key,
                        label: spec.label,
                        value,
                        previous: toNumber(priorRow[spec.key]),
                        gain
                    });
                }
            });

            if (!items.length) return;

            items.sort((a, b) => {
                const order = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
                if (order !== 0) return order;
                return (b.margin ?? b.gain ?? 0) - (a.margin ?? a.gain ?? 0);
            });

            entries.push({ name, items: items.slice(0, maxPerPerson), totalItems: items.length });
        });

        entries.sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
        return entries;
    }

    // --- Wording ---

    function describeItem(item, formatValue) {
        const format = typeof formatValue === 'function' ? formatValue : ((key, value) => String(value));
        if (item.kind === 'perfectSurveys') return item.detail;
        if (item.kind === 'improved') {
            return `${item.label} ${format(item.key, item.value)}, up from ${format(item.key, item.previous)}`;
        }
        return `${item.label} ${format(item.key, item.value)}`;
    }

    function joinPhrases(list) {
        if (list.length <= 1) return list[0] || '';
        if (list.length === 2) return `${list[0]} and ${list[1]}`;
        return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
    }

    /**
     * One associate's line. Kept to a single sentence — this gets read in a
     * list of forty, not on its own.
     */
    function buildHighlightLine(entry, options) {
        const opts = options || {};
        const phrases = entry.items.map(item => describeItem(item, opts.formatValue));
        if (!phrases.length) return '';

        const firstName = typeof opts.preferredName === 'function'
            ? opts.preferredName(entry.name)
            : entry.name;

        return `${firstName}, ${joinPhrases(phrases)}`;
    }

    function groupByTeam(entries, byEmployee, options) {
        const opts = options || {};
        const unassignedLabel = opts.unassignedLabel || 'Unassigned';
        const map = byEmployee || {};

        const groups = new Map();
        (entries || []).forEach(entry => {
            const team = String(map[entry.name] || '').trim() || unassignedLabel;
            if (!groups.has(team)) groups.set(team, []);
            groups.get(team).push(entry);
        });

        return Array.from(groups.entries())
            .map(([team, list]) => ({ team, entries: list }))
            // Unassigned trails the real teams rather than sorting into them.
            .sort((a, b) => {
                if (a.team === unassignedLabel) return 1;
                if (b.team === unassignedLabel) return -1;
                return a.team.localeCompare(b.team);
            });
    }

    /**
     * The whole post, grouped by team. When only one team is in play the group
     * headers are noise, so they're dropped.
     */
    function buildHighlightPost(groups, options) {
        const opts = options || {};
        const list = groups || [];
        if (!list.length) return '';

        const header = opts.title ? `${opts.title}\n` : '';
        const showTeamHeaders = list.length > 1;

        const body = list.map(group => {
            const lines = group.entries
                .map(entry => `• ${buildHighlightLine(entry, opts)}`)
                .filter(line => line !== '• ')
                .join('\n');
            return showTeamHeaders ? `${group.team}\n${lines}` : lines;
        }).join('\n\n');

        return `${header}\n${body}`.trim();
    }

    function countPeople(groups) {
        return (groups || []).reduce((sum, group) => sum + group.entries.length, 0);
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.highlights = {
        findHighlights,
        findPerfectSurveys,
        marginPastTarget,
        improvement,
        describeItem,
        buildHighlightLine,
        groupByTeam,
        buildHighlightPost,
        countPeople
    };
})();
