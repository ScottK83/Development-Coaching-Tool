'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * A year-to-date upload is a reading of a cumulative series, not a snapshot
 * that the next one replaces.
 *
 * Startup used to keep exactly one real YTD per year and delete the rest, on
 * the reasoning that older ones were stale duplicates cluttering the period
 * dropdown. That ran on every page load, before anybody saw it, so uploading a
 * fresh YTD silently destroyed the only file it could ever have been compared
 * against. It was also why the Matchup movement panel could never answer about
 * YTD and always fell back to months: the second point on the series had been
 * deleted at boot.
 *
 * Nothing needed there to be one. Every surface that wants "the" YTD scans for
 * the newest itself, which is pinned at the bottom of this file.
 *
 * Week-in-progress uploads are a different case and are still pruned: a part
 * week is re-uploaded over itself as the week fills in, so the older copies of
 * one Monday really are superseded.
 */

// The function lives in script.js, which is too large to load whole. Slicing it
// out and running it is the only way to assert what it does rather than how it
// is written, so the brace match is done properly rather than by regex.
function loadCleanup() {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const start = src.indexOf('function cleanupStaleDuplicatePeriods()');
    if (start === -1) throw new Error('cleanupStaleDuplicatePeriods not found in script.js');

    let depth = 0;
    let end = -1;
    for (let i = src.indexOf('{', start); i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') {
            depth -= 1;
            if (depth === 0) { end = i + 1; break; }
        }
    }
    if (end === -1) throw new Error('could not find the end of cleanupStaleDuplicatePeriods');

    global.saveWeeklyData = () => {};
    global.saveTeamMembers = () => {};
    global.saveYtdData = () => {};
    (0, eval)(src.slice(start, end));
    return global.cleanupStaleDuplicatePeriods;
}

function ytdFile(end, uploadedAt) {
    return {
        metadata: { periodType: 'ytd', endDate: end, label: 'YTD through ' + end, uploadedAt },
        employees: [{ name: 'Person A' }, { name: 'Person B' }]
    };
}

suite('startup: every year-to-date upload is kept', (t) => {
    const cleanup = loadCleanup();

    global.ytdData = {
        'ytd|2026-06-28': ytdFile('2026-06-28', '2026-06-29T10:00:00Z'),
        'ytd|2026-07-26': ytdFile('2026-07-26', '2026-07-27T10:00:00Z'),
        'ytd|2026-09-13': ytdFile('2026-09-13', '2026-09-14T10:00:00Z')
    };
    global.weeklyData = {};
    global.myTeamMembers = {};

    cleanup();

    const kept = Object.keys(global.ytdData).sort();
    t.equal('all three survive a startup', kept.length, 3);
    // The one that used to be deleted, and the reason the movement panel had
    // nothing to compare: with only the newest left there is no earlier point.
    t.check('including the oldest', kept.indexOf('ytd|2026-06-28') > -1);
    t.check('and the one in the middle', kept.indexOf('ytd|2026-07-26') > -1);
    t.check('and the newest', kept.indexOf('ytd|2026-09-13') > -1);

    // Two points on the series is the whole requirement for a comparison.
    t.check('so a year-to-date comparison has two sides to it', kept.length >= 2);
});

suite('startup: an unfinished week is still replaced by its own newer copy', (t) => {
    const cleanup = loadCleanup();

    const wip = (start, end, uploadedAt) => ({
        metadata: { periodType: 'week-in-progress', startDate: start, endDate: end, uploadedAt },
        employees: [{ name: 'Person A' }]
    });

    global.ytdData = {};
    global.myTeamMembers = { '2026-09-07|2026-09-09': ['Person A'] };
    global.weeklyData = {
        // The same Monday, uploaded twice as the week filled in.
        '2026-09-07|2026-09-09': wip('2026-09-07', '2026-09-09', '2026-09-09T10:00:00Z'),
        '2026-09-07|2026-09-11': wip('2026-09-07', '2026-09-11', '2026-09-11T10:00:00Z'),
        // A different Monday, and a completed week, both of which stay.
        '2026-08-31|2026-09-02': wip('2026-08-31', '2026-09-02', '2026-09-02T10:00:00Z'),
        '2026-08-24|2026-08-30': {
            metadata: { periodType: 'week', startDate: '2026-08-24', endDate: '2026-08-30' },
            employees: [{ name: 'Person A' }]
        }
    };

    cleanup();

    const kept = Object.keys(global.weeklyData).sort();
    t.check('the fuller copy of that Monday stays', kept.indexOf('2026-09-07|2026-09-11') > -1);
    t.check('the earlier copy of the same Monday goes', kept.indexOf('2026-09-07|2026-09-09') === -1);
    t.check('a different Monday is untouched', kept.indexOf('2026-08-31|2026-09-02') > -1);
    t.check('and a completed week is never pruned', kept.indexOf('2026-08-24|2026-08-30') > -1);

    // The roster attached to a deleted period would otherwise be orphaned.
    t.check('the team list for the dropped copy goes with it',
        !global.myTeamMembers['2026-09-07|2026-09-09']);
});

/**
 * Keeping several YTDs is only safe because nothing treats "the YTD" as a
 * singleton. Each of these picks the newest for itself, and if one ever stopped
 * doing that it would start reading a months-old file as the current year.
 */
suite('startup: nothing assumes there is only one year-to-date file', (t) => {
    const reads = [
        ['modules/center-ranking.module.js', '_latestYtdKeyForYear'],
        ['modules/morning-pulse.module.js', 'latestYtdPeriod'],
        ['modules/period-compare.module.js', '_latestYtdReliability']
    ];

    // q1-review used to be on this list and was deleted when the Quarterly tab
    // was rewritten. Its replacement reads no year-to-date row of its own: the
    // quarter aggregate refuses that period type outright, and the one figure
    // that does come from a year-to-date file, missed hours, is fetched through
    // period-compare's picker, which is already checked above.
    const quarterTrend = fs.readFileSync(path.join(ROOT, 'modules/quarter-trend.module.js'), 'utf8');
    t.check('the quarter aggregate refuses year-to-date rows',
        /periodType === 'ytd'/.test(quarterTrend));

    reads.forEach(([file, fn]) => {
        const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
        t.check(`${file} selects the newest through ${fn}`,
            src.indexOf('function ' + fn) > -1);
    });

    // And the prune itself must not come back.
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    t.check('startup no longer keeps one real YTD per year',
        script.indexOf('bestYtdByYear') === -1);
});
