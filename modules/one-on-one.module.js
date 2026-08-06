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

    // How far a metric has to move before it is worth raising in a meeting.
    // Below this it is noise, and calling it out either way wastes the slot.
    const NOISE = {
        scheduleAdherence: 1,
        cxRepOverall: 2,
        fcr: 2,
        overallExperience: 2,
        overallSentiment: 1,
        positiveWord: 1,
        negativeWord: 1,
        managingEmotions: 1,
        aht: 15,
        acw: 5,
        holdTime: 3,
        transfers: 0.5,
        reliability: 2
    };

    function registry() {
        return window.METRICS_REGISTRY || {};
    }

    function isReverse(metricKey) {
        return registry()[metricKey]?.isReverse === true;
    }

    function labelFor(metricKey) {
        return registry()[metricKey]?.label || metricKey;
    }

    function formatValue(metricKey, value) {
        if (typeof window.formatMetricValue === 'function') return window.formatMetricValue(metricKey, value);
        return String(value);
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
            return Number.isFinite(NOISE[key]) ? NOISE[key] : 0;
        };

        const improved = [];
        const slipped = [];
        const steady = [];
        const unmeasured = [];

        const keys = Array.isArray(opts.keys) ? opts.keys : talkableMetricKeys();
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
            const raw = localStorage.getItem(MEETINGS_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            return parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            return {};
        }
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

    function describeStanding(entry) {
        return `${entry.label}: ${formatValue(entry.key, entry.value)}${entry.target !== null && entry.target !== undefined
            ? ` against a ${formatValue(entry.key, entry.target)} target` : ''}`;
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

        blocks.push(`One-to-one — ${d.employeeName || name}${d.date ? ` · ${d.date}` : ''}`);

        if (d.yearToDate?.length) {
            blocks.push('THE YEAR SO FAR\n' + d.yearToDate.map(e => `  • ${describeStanding(e)}`).join('\n'));
        }

        if (d.sinceLast) {
            const since = d.sinceLast;
            const heading = `SINCE WE LAST MET${since.date ? ` (${since.date})` : ''}`;
            const lines = [];
            if (since.improved?.length) {
                lines.push('  Better:');
                since.improved.slice(0, 5).forEach(e => lines.push(`    • ${describeChange(e)}`));
            }
            if (since.slipped?.length) {
                lines.push('  Slipped:');
                since.slipped.slice(0, 5).forEach(e => lines.push(`    • ${describeChange(e)}`));
            }
            if (!lines.length) lines.push('  Holding roughly where they were.');
            blocks.push(`${heading}\n${lines.join('\n')}`);
        }

        if (d.lastMonth?.improved?.length || d.lastMonth?.slipped?.length) {
            const lines = [];
            (d.lastMonth.improved || []).slice(0, 4).forEach(e => lines.push(`  • Better: ${describeChange(e)}`));
            (d.lastMonth.slipped || []).slice(0, 4).forEach(e => lines.push(`  • Worse: ${describeChange(e)}`));
            blocks.push(`LAST MONTH\n${lines.join('\n')}`);
        }

        if (d.recentWeeks?.improved?.length || d.recentWeeks?.slipped?.length) {
            const lines = [];
            (d.recentWeeks.improved || []).slice(0, 4).forEach(e => lines.push(`  • Better: ${describeChange(e)}`));
            (d.recentWeeks.slipped || []).slice(0, 4).forEach(e => lines.push(`  • Worse: ${describeChange(e)}`));
            blocks.push(`THE LAST FEW WEEKS\n${lines.join('\n')}`);
        }

        if (d.previousNotes) {
            blocks.push(`WHAT WE SAID LAST TIME\n${indent(d.previousNotes)}`);
        }

        if (d.notes) {
            blocks.push(`MY NOTES FOR THIS ONE\n${indent(d.notes)}`);
        }

        return blocks.join('\n\n');
    }

    function indent(text) {
        return String(text || '').split('\n').map(line => `  ${line}`).join('\n');
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.oneOnOne = {
        MEETINGS_KEY,
        NOISE,
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
        describeChange,
        describeStanding
    };
})();
