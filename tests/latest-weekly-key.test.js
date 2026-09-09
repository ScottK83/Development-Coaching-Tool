'use strict';

/**
 * "The latest weekly key" has to be a key that is in weeklyData.
 *
 * getWeeklyKeysSorted merges weeklyData and ytdData on purpose; several callers
 * want every period there is. getLatestWeeklyKey and getPreviousWeeklyKey are
 * not those callers. Every consumer of them immediately does
 * `weeklyData[latestKey]`, so a key that lives only in ytdData reads back as
 * undefined and the feature reports no data.
 *
 * That is the NORMAL state after uploading the year-to-date report, because a
 * YTD file ends later than the last completed week. Six features went quiet at
 * once -- 1:1 Prep, Today's Focus, recognition signals, the coaching-impact
 * panel, and the two ranking modules reading the same key -- each one saying
 * there was no weekly data, on an account holding six weekly uploads. Nothing
 * errored, so nothing surfaced.
 *
 * The suite does not load script.js as a program, so this pins the rule at
 * source and demonstrates, on a real store, that the two key sources genuinely
 * disagree. Without the second half the first would be asserting nothing.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function bodyOf(src, fnName) {
    const at = src.indexOf('function ' + fnName + '(');
    if (at === -1) return null;
    const end = src.indexOf('\n}\n', at);
    return end === -1 ? src.slice(at) : src.slice(at, end);
}

suite('latest weekly key: the helper reads the weekly store', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');

    const filter = bodyOf(src, 'getWeeklyStoreKeysSorted');
    t.check('there is one place that filters to the weekly store', !!filter);
    t.check('and it filters on membership of weeklyData',
        /hasOwnProperty\.call\(weeklyData, key\)/.test(filter || ''));

    // getPreviousWeeklyKey went with the duplicate 1:1 prep panel that was its
    // last caller. The rule it was guarded for is the same rule, so the guard
    // follows whichever helpers survive rather than naming one that does not.
    ['getLatestWeeklyKey'].forEach((fn) => {
        const body = bodyOf(src, fn);
        t.check(`${fn} is still there`, !!body);
        if (!body) return;
        t.check(`${fn} uses the weekly-store list`, /getWeeklyStoreKeysSorted\(\)/.test(body));
        t.check(`${fn} does not use the merged all-stores list`,
            !/getWeeklyKeysSorted\(\)/.test(body));
    });

    // The merged helper must keep merging: other callers depend on it.
    const merged = bodyOf(src, 'getWeeklyKeysSorted');
    t.check('getWeeklyKeysSorted still merges both stores',
        /Object\.assign\(\{\}, weeklyData, ytdData\)/.test(merged || ''));
});

suite('latest weekly key: a year-to-date upload is newer than the last week', (t) => {
    // The state that triggered it, built here so the guard above is not vacuous.
    const weekly = {
        '2026-06-08|2026-06-14': { metadata: { endDate: '2026-06-14' }, employees: [] },
        '2026-06-15|2026-06-21': { metadata: { endDate: '2026-06-21' }, employees: [] }
    };
    const ytd = {
        '2026-01-01|2026-06-28': { metadata: { endDate: '2026-06-28', periodType: 'ytd' }, employees: [] }
    };

    const byEnd = (a, b) => a.split('|')[1].localeCompare(b.split('|')[1]);
    const mergedKeys = Object.keys(Object.assign({}, weekly, ytd)).sort(byEnd);
    const weeklyKeys = mergedKeys.filter((k) => Object.prototype.hasOwnProperty.call(weekly, k));

    t.equal('the merged list ends on the year-to-date file',
        mergedKeys[mergedKeys.length - 1], '2026-01-01|2026-06-28');
    t.check('which is not in weeklyData at all',
        !Object.prototype.hasOwnProperty.call(weekly, mergedKeys[mergedKeys.length - 1]));
    t.check('so weeklyData[latestKey] would be undefined',
        weekly[mergedKeys[mergedKeys.length - 1]] === undefined);

    t.equal('while the weekly-store list ends on a real week',
        weeklyKeys[weeklyKeys.length - 1], '2026-06-15|2026-06-21');
    t.check('which does resolve', !!weekly[weeklyKeys[weeklyKeys.length - 1]]);
    t.equal('and the week before it is also a real week',
        weeklyKeys[weeklyKeys.length - 2], '2026-06-08|2026-06-14');
});
