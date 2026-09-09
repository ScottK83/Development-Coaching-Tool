'use strict';

/**
 * Every panel on the Trends screen compares periods of the type you selected.
 *
 * getTrendComparisonBuckets only consults getTrendKeysForPeriodType when its
 * `keys` argument is empty. Hand it a list and it takes the last entries of
 * whatever it was given, type filter and all.
 *
 * renderCoachingPriorityQueue handed it getWeeklyKeysSorted(), which merges
 * weeklyData AND ytdData and returns every period type there is -- weeks, a
 * week-in-progress, months, quarters, year-to-date files -- sorted by end date.
 * So "Week over Week" took the last two entries of that merged list. On the
 * fixture that is a three-day week-in-progress against a full year-to-date
 * file, while the trend panels directly above it compared the two newest
 * completed weeks.
 *
 * The queue is what says who to coach. Its deltas were the difference between
 * three days and half a year, labelled Week over Week.
 *
 * Nothing else on the screen had the bug: renderTrendVisualizations and
 * buildTrendCadenceSummary both take getTrendKeysForPeriodType. The queue was
 * the odd one out, which is what makes a source check the right guard here --
 * the suite does not load script.js as a program, and the two key sources
 * differ only when more than one period type is on file.
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

suite('trend periods: every panel takes keys of the selected type', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');

    // The three callers that build comparison buckets from a key list.
    ['renderCoachingPriorityQueue', 'buildTrendCadenceSummary', 'renderTrendVisualizations']
        .forEach((fn) => {
            const body = bodyOf(src, fn);
            t.check(`${fn} is still there`, !!body);
            if (!body) return;

            t.check(`${fn} takes keys of the selected type`,
                /getTrendKeysForPeriodType\(/.test(body));
            t.check(`${fn} does not use the merged all-types list`,
                !/const keys = getWeeklyKeysSorted\(\)/.test(body));
        });

    // And the reason it matters: the merged list is genuinely a different set.
    const merged = bodyOf(src, 'getWeeklyKeysSorted');
    t.check('getWeeklyKeysSorted really does merge weekly and ytd',
        /Object\.assign\(\{\}, weeklyData, ytdData\)/.test(merged || ''));

    const buckets = bodyOf(src, 'getTrendComparisonBuckets');
    t.check('and the bucket builder only type-filters when handed nothing',
        /Array\.isArray\(keys\) && keys\.length \? keys : getTrendKeysForPeriodType/.test(buckets || ''));
});

suite('trend periods: the type filter actually separates the two lists', (t) => {
    // A guard that reads source is only worth having if the thing it guards
    // against is real. This builds the stores the fixture has and checks that
    // the two key sources disagree, so the assertions above are not vacuous.
    const browser = t.installFakeBrowser();
    const PREFIX = 'devCoachingTool_';

    const weekly = {
        '2026-06-08|2026-06-14': { metadata: { periodType: 'week', endDate: '2026-06-14' }, employees: [] },
        '2026-06-15|2026-06-21': { metadata: { periodType: 'week', endDate: '2026-06-21' }, employees: [] },
        '2026-06-22|2026-06-24': { metadata: { periodType: 'week-in-progress', endDate: '2026-06-24' }, employees: [] },
        '2026-05-01|2026-05-31': { metadata: { periodType: 'month', endDate: '2026-05-31' }, employees: [] }
    };
    const ytd = {
        '2026-01-01|2026-06-21': { metadata: { periodType: 'ytd', endDate: '2026-06-21' }, employees: [] }
    };
    browser.store[PREFIX + 'weeklyData'] = JSON.stringify(weekly);
    browser.store[PREFIX + 'ytdData'] = JSON.stringify(ytd);

    // The two rules, applied here rather than reached for, because the real
    // implementations live in script.js.
    const mergedKeys = Object.keys(Object.assign({}, weekly, ytd))
        .sort((a, b) => a.split('|')[1].localeCompare(b.split('|')[1]));
    const weekKeys = Object.keys(weekly).filter((k) => weekly[k].metadata.periodType === 'week');

    t.equal('the merged list ends on the week-in-progress',
        mergedKeys[mergedKeys.length - 1], '2026-06-22|2026-06-24');
    t.equal('with a year-to-date file right behind it',
        mergedKeys[mergedKeys.length - 2], '2026-01-01|2026-06-21');

    t.equal('while the week list ends on a completed week',
        weekKeys[weekKeys.length - 1], '2026-06-15|2026-06-21');
    t.equal('with another completed week behind it',
        weekKeys[weekKeys.length - 2], '2026-06-08|2026-06-14');

    t.check('so the two sources really do disagree',
        mergedKeys[mergedKeys.length - 1] !== weekKeys[weekKeys.length - 1]);
});
