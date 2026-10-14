(function () {
    'use strict';

    /**
     * ONE-ON-ONE MEETING PREP
     *
     * Walk into a monthly one-to-one with the numbers already argued.
     *
     * Four horizons, because "how are you doing" means something different at
     * each: the year so far, last month, the last few weeks, and — the one that
     * makes this worth keeping — since the last time you sat down together.
     *
     * That last one is why every saved meeting stores a snapshot of the metrics
     * as they stood that day. Diffing against a stored snapshot is honest in a
     * way that re-deriving "the month around that date" is not: it compares
     * against exactly what you told them, not against a period you reconstructed
     * afterwards.
     */

    const PREFIX = (window.DevCoachConstants && window.DevCoachConstants.STORAGE_PREFIX) || 'devCoachingTool_';
    const MEETINGS_KEY = PREFIX + 'oneOnOneMeetings';

    // Volume has no target to talk against, so it is context rather than a
    // talking point.
    const SKIP_METRICS = new Set(['totalCalls', 'transfersCount', 'surveyTotal']);

    // Not a better or worse. A period's own hours set side by side read
    // "Reliability: 4 -> 2" under Better, which is a month's hours shown as
    // the associate's reliability and an hours figure praised for going
    // down, when hours are a running total for the year that only ever goes
    // up (Scott, 2026-09-18 and 2026-10-13). The year's total still shows,
    // once, in the year so far.
    const NOT_A_CHANGE = new Set(['reliability']);

    // The four a review is about, listed first in the year so far.
    const CORE_ORDER = ['aht', 'scheduleAdherence', 'overallSentiment', 'cxRepOverall'];

    // A survey score on fewer responses than this is not a score. The floor
    // the check-in document and the year-end review use.
    const MIN_SURVEYS = 3;

    // How far a metric has to move before it is worth raising in a meeting.
    // The registry owns the floor so "improved" means the same thing here as
    // it does in a check-in message.
    function noiseThreshold(metricKey) {
        return typeof window.getMetricNoiseThreshold === 'function'
            ? window.getMetricNoiseThreshold(metricKey)
            : 1;
    }

    function registry() {
        return window.METRICS_REGISTRY || {};
    }

    function isReverse(metricKey) {
        return registry()[metricKey]?.isReverse === true;
    }

    function labelFor(metricKey) {
        return registry()[metricKey]?.label || metricKey;
    }

    // With units: "96.2%", "430s", "11 hrs". The bare value formatter put
    // "96.2 against a 93.0 target" on the sheet (Scott, 2026-10-14).
    function formatValue(metricKey, value) {
        if (typeof window.formatMetricDisplay === 'function') return window.formatMetricDisplay(metricKey, value);
        if (typeof window.formatMetricValue === 'function') return window.formatMetricValue(metricKey, value);
        return String(value);
    }

    // "10/14/2026", the way the business writes a date.
    function formatDate(dateText) {
        const parts = String(dateText || '').split('-');
        if (parts.length === 3 && parts[0].length === 4) return `${parts[1]}/${parts[2]}/${parts[0]}`;
        return dateText || '';
    }

    // "a 93% goal", "an 88% goal", "an 18 hr allowance": the article follows
    // how the number is said, and eight, eleven and eighteen open on a vowel.
    function articleFor(shown) {
        return /^8|^1[18](\D|$)/.test(String(shown || '')) ? 'an' : 'a';
    }

    /* Which metrics the year so far lists, in what order.
     *
     * The four KPIs first, then the rest in registry order. A survey metric
     * with fewer than three responses behind it is left out: somebody nobody
     * surveyed is not at 0% first call resolution. */
    function yearToDateEntries(row, targetFor) {
        if (!row) return [];
        const out = [];
        talkableMetricKeys().forEach(key => {
            const value = toNumber(row[key]);
            if (value === null) return;
            const surveyed = typeof window.isSurveyWeightedMetric === 'function'
                ? window.isSurveyWeightedMetric(key)
                : !!(window.SURVEY_WEIGHT_FIELD || {})[key];
            if (surveyed) {
                const responses = typeof window.getSurveyWeight === 'function'
                    ? window.getSurveyWeight(key, row)
                    : parseInt(row.surveyTotal, 10);
                if (!(Number.isFinite(responses) && responses >= MIN_SURVEYS)) return;
            }
            // No handle time is no calls, not a fast year.
            if (registry()[key]?.unit === 'sec' && value <= 0) return;
            const target = typeof targetFor === 'function' ? targetFor(key) : null;
            out.push({
                key,
                label: labelFor(key),
                value,
                target: target && Number.isFinite(parseFloat(target.value)) ? parseFloat(target.value) : null
            });
        });
        const rank = (key) => {
            const i = CORE_ORDER.indexOf(key);
            return i < 0 ? CORE_ORDER.length : i;
        };
        return out.map((e, i) => ({ e, i }))
            .sort((a, b) => (rank(a.e.key) - rank(b.e.key)) || (a.i - b.i))
            .map(x => x.e);
    }

    function toNumber(value) {
        if (value === '' || value === null || value === undefined) return null;
        const n = parseFloat(value);
        return Number.isFinite(n) ? n : null;
    }

    function talkableMetricKeys() {
        return Object.keys(registry()).filter(key => !SKIP_METRICS.has(key));
    }

    // --- Snapshots ---

    /**
     * The metric values as they stand right now, keyed by metric. Stored with
     * the meeting so the next one has something firm to measure against.
     */
    function snapshotFromRow(row) {
        const out = {};
        if (!row) return out;
        talkableMetricKeys().forEach(key => {
            const value = toNumber(row[key]);
            if (value !== null) out[key] = value;
        });
        return out;
    }

    /**
     * What changed between two snapshots, in the direction that counts as good.
     *
     * Returns { improved, slipped, steady }. A metric present in only one of
     * the two snapshots lands in `unmeasured` rather than being reported as a
     * change from zero.
     */
    function compareSnapshots(previous, current, options) {
        const opts = options || {};
        const prev = previous || {};
        const now = current || {};
        const noiseFor = (key) => {
            if (opts.noise && Number.isFinite(opts.noise[key])) return opts.noise[key];
            return noiseThreshold(key);
        };

        const improved = [];
        const slipped = [];
        const steady = [];
        const unmeasured = [];

        const keys = Array.isArray(opts.keys)
            ? opts.keys
            : talkableMetricKeys().filter(key => !NOT_A_CHANGE.has(key));
        keys.forEach(key => {
            const before = toNumber(prev[key]);
            const after = toNumber(now[key]);

            if (before === null || after === null) {
                if (before !== null || after !== null) unmeasured.push({ key, label: labelFor(key), before, after });
                return;
            }

            // Normalise so a positive gain always means "better", whichever way
            // the metric runs.
            const gain = isReverse(key) ? before - after : after - before;
            const entry = {
                key,
                label: labelFor(key),
                before,
                after,
                gain,
                absChange: Math.abs(after - before)
            };

            if (Math.abs(gain) < noiseFor(key)) steady.push(entry);
            else if (gain > 0) improved.push(entry);
            else slipped.push(entry);
        });

        const byMove = (a, b) => Math.abs(b.gain) - Math.abs(a.gain);
        improved.sort(byMove);
        slipped.sort(byMove);

        return { improved, slipped, steady, unmeasured };
    }

    // --- Meeting history ---

    function loadAllMeetings() {
        try {
            const parsed = readViaStorage('oneOnOneMeetings', MEETINGS_KEY, null);
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
    }

    // Reads through the storage module so this store follows its backend. A raw
    // localStorage read goes permanently stale the moment the store moves.
    function readViaStorage(name, fallbackKey, empty) {
        var read = window.DevCoachModules?.storage?.readStore;
        if (typeof read === 'function') {
            var value = read(name);
            if (value !== undefined && value !== null) return value;
            return empty;
        }
        try {
            var raw = localStorage.getItem(fallbackKey);
            return raw ? JSON.parse(raw) : empty;
        } catch (e) { return empty; }
    }

    function saveAllMeetings(all) {
        const storage = window.DevCoachModules?.storage;
        if (storage?.saveWithSizeCheck) return storage.saveWithSizeCheck('oneOnOneMeetings', all);
        try {
            localStorage.setItem(MEETINGS_KEY, JSON.stringify(all || {}));
            return true;
        } catch (e) {
            return false;
        }
    }

    function meetingsFor(employeeName) {
        const list = loadAllMeetings()[employeeName] || [];
        return list.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }

    /**
     * The meeting this one should measure against: the latest one strictly
     * before the given date.
     *
     * Strictly before matters. Re-opening a meeting you already saved should
     * compare against the one before it, not against itself, or every re-visit
     * would report no change at all.
     */
    function previousMeeting(meetings, beforeDate) {
        const list = (meetings || []).slice()
            .filter(m => m && m.date && String(m.date) < String(beforeDate))
            .sort((a, b) => String(a.date).localeCompare(String(b.date)));
        return list.length ? list[list.length - 1] : null;
    }

    function saveMeeting(employeeName, meeting) {
        if (!employeeName || !meeting?.date) return false;
        const all = loadAllMeetings();
        const list = (all[employeeName] || []).filter(m => m.date !== meeting.date);
        list.push(Object.assign({}, meeting, { employeeName }));
        list.sort((a, b) => String(a.date).localeCompare(String(b.date)));
        all[employeeName] = list;
        return saveAllMeetings(all);
    }

    function deleteMeeting(employeeName, date) {
        const all = loadAllMeetings();
        if (!all[employeeName]) return false;
        all[employeeName] = all[employeeName].filter(m => m.date !== date);
        if (!all[employeeName].length) delete all[employeeName];
        return saveAllMeetings(all);
    }

    // --- Talking points ---

    // No direction word here. AHT going 480 to 430 is an improvement while the
    // number falls, so "up" would be plainly wrong and "better" only repeats
    // the heading the line already sits under.
    function describeChange(entry) {
        return `${entry.label}: ${formatValue(entry.key, entry.before)} → ${formatValue(entry.key, entry.after)}`;
    }

    // "Schedule Adherence: 96.2% against a 93% goal". Hours are the year's
    // running total against its allowance, said as one.
    function describeStanding(entry) {
        const hasTarget = entry.target !== null && entry.target !== undefined;
        const target = hasTarget ? formatValue(entry.key, entry.target) : '';
        if (entry.key === 'reliability') {
            const allowance = target.replace(/ hrs$/, ' hr');
            return `${entry.label}: ${formatValue(entry.key, entry.value)} missed this year`
                + (hasTarget ? `, against ${articleFor(allowance)} ${allowance} allowance` : '');
        }
        return `${entry.label}: ${formatValue(entry.key, entry.value)}`
            + (hasTarget ? ` against ${articleFor(target)} ${target} goal` : '');
    }

    // At its goal, judged on the number as printed, so "93% against a 93%
    // goal" is never read as a miss because the value behind it was 92.96.
    // null when there is no goal to judge against.
    function meetsGoal(entry) {
        if (!entry || entry.target === null || entry.target === undefined) return null;
        const value = toNumber(entry.value);
        const target = toNumber(entry.target);
        if (value === null || target === null) return null;
        const shown = parseFloat(String(formatValue(entry.key, value)).replace(/[^0-9.]/g, ''));
        const judged = Number.isFinite(shown) ? shown : value;
        return isReverse(entry.key) ? judged <= target : judged >= target;
    }

    /**
     * What to open the meeting on, always something true.
     *
     * Scott, 2026-10-14: "Make sure to, in every piece of feedback ... make
     * sure to provide positive feedback." A sheet for someone with nothing
     * at goal and nothing better opened on a list of misses and "Slipped".
     * In order: at goal for the year, better on the nearest horizon, the
     * measure closest to its goal, what held since the last meeting. Hours
     * are never praise here (see NOT_A_CHANGE), and an empty sheet stays
     * empty rather than praising numbers it does not have.
     */
    function workingLines(d, changes) {
        // No handle time is no calls, never a handle time at goal.
        const year = (d.yearToDate || []).filter(e => e && !NOT_A_CHANGE.has(e.key)
            && !(registry()[e.key]?.unit === 'sec' && !(toNumber(e.value) > 0)));
        const atGoal = year.filter(e => meetsGoal(e) === true);
        if (atGoal.length) return atGoal.slice(0, 3).map(e => `At goal: ${describeStanding(e)}`);

        const horizons = [
            [d.sinceLast, 'since we last met'],
            [d.lastMonth, 'last month'],
            [d.recentWeeks, 'over the last few weeks']
        ];
        for (const [horizon, when] of horizons) {
            const better = changes(horizon?.improved);
            if (better.length) return [`Better ${when}: ${describeChange(better[0])}`];
        }

        const closest = year
            .filter(e => meetsGoal(e) === false && toNumber(e.target))
            .map(e => ({ e, share: Math.abs(e.value - e.target) / Math.abs(e.target) }))
            .sort((a, b) => a.share - b.share)[0];
        if (closest) return [`Closest to goal: ${describeStanding(closest.e)}, a good place to build from`];

        const held = changes(d.sinceLast?.steady);
        if (held.length) return [`Held steady since we last met: ${held.slice(0, 3).map(e => e.label).join(', ')}`];
        return [];
    }

    /**
     * The sheet you walk in with.
     *
     * Every section is optional — a horizon with no data is left out entirely
     * rather than printed as an empty heading, because a page of "no data"
     * headings is worse than a shorter page.
     */
    function buildTalkingPoints(data) {
        const d = data || {};
        const blocks = [];
        const name = d.preferredName || d.employeeName || 'them';

        blocks.push(`One-to-one. ${d.employeeName || name}${d.date ? ` · ${formatDate(d.date)}` : ''}`);

        // Hours are never a better or a slipped (see NOT_A_CHANGE), whatever
        // a caller hands in, including a meeting saved before that rule.
        const changes = list => (list || []).filter(e => !NOT_A_CHANGE.has(e?.key));

        const working = workingLines(d, changes);
        if (working.length) {
            blocks.push('START WITH WHAT IS WORKING\n' + working.map(line => `  • ${line}`).join('\n'));
        }

        if (d.yearToDate?.length) {
            blocks.push('THE YEAR SO FAR\n' + d.yearToDate.map(e => `  • ${describeStanding(e)}`).join('\n'));
        }

        // One word for a move the wrong way, everywhere on the sheet. It was
        // "Slipped" in one section and "Worse" in the next, and "Worse" is
        // the harder of the two to hear across a desk (Scott, 2026-10-14).
        if (d.sinceLast) {
            const since = d.sinceLast;
            const heading = `SINCE WE LAST MET${since.date ? ` (${formatDate(since.date)})` : ''}`;
            const lines = [];
            if (changes(since.improved).length) {
                lines.push('  Better:');
                changes(since.improved).slice(0, 5).forEach(e => lines.push(`    • ${describeChange(e)}`));
            }
            if (changes(since.slipped).length) {
                lines.push('  Slipped:');
                changes(since.slipped).slice(0, 5).forEach(e => lines.push(`    • ${describeChange(e)}`));
            }
            if (!lines.length) lines.push('  Holding roughly where they were.');
            blocks.push(`${heading}\n${lines.join('\n')}`);
        }

        const movedSection = (title, horizon) => {
            const better = changes(horizon?.improved);
            const slipped = changes(horizon?.slipped);
            if (!better.length && !slipped.length) return;
            const lines = [];
            better.slice(0, 4).forEach(e => lines.push(`  • Better: ${describeChange(e)}`));
            slipped.slice(0, 4).forEach(e => lines.push(`  • Slipped: ${describeChange(e)}`));
            blocks.push(`${title}\n${lines.join('\n')}`);
        };
        movedSection('LAST MONTH', d.lastMonth);
        movedSection('THE LAST FEW WEEKS', d.recentWeeks);

        if (d.previousNotes) {
            blocks.push(`WHAT WE SAID LAST TIME\n${indent(d.previousNotes)}`);
        }

        if (d.notes) {
            blocks.push(`MY NOTES FOR THIS ONE\n${indent(d.notes)}`);
        }

        return blocks.join('\n\n');
    }

    // The opener on its own, for a screen that draws the sheet itself.
    function openingLines(data) {
        return workingLines(data || {}, list => (list || []).filter(e => !NOT_A_CHANGE.has(e?.key)));
    }

    function indent(text) {
        return String(text || '').split('\n').map(line => `  ${line}`).join('\n');
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.oneOnOne = {
        MEETINGS_KEY,
        noiseThreshold,
        talkableMetricKeys,
        snapshotFromRow,
        compareSnapshots,
        loadAllMeetings,
        saveAllMeetings,
        meetingsFor,
        previousMeeting,
        saveMeeting,
        deleteMeeting,
        buildTalkingPoints,
        openingLines,
        describeChange,
        describeStanding,
        yearToDateEntries,
        formatValue,
        formatDate
    };
})();
