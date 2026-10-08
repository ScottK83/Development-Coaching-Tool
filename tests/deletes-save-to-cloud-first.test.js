'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * A delete saves to the cloud first, or does not happen.
 *
 * feedback-never-download-to-pc: before any destructive step, push to the cloud
 * and confirm a copy exists. Only the localStorage reclaim and the snapshot
 * restore did. Reset Metric Data told Scott to "Back up first via Download
 * Backup", which his work PC cannot do, and the three single deletes did
 * nothing at all. Found in the 2026-10-07 overlap audit.
 *
 * Delete All is left out on purpose: wiping the cloud copy is part of what it
 * is for, and it says so in its own confirmation.
 */
suite('deletes: each one saves to the cloud before it removes anything', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    t.check('there is one guard for it', /async function cloudCopyBeforeDeleting\(\)/.test(src));
    t.check('and it is built on the confirmed cloud copy', /cloudCopyBeforeDeleting[\s\S]{0,200}ensureCloudCopyIsCurrent\(\)/.test(src));

    [
        ['handleResetMetricDataClick', /weeklyData = \{\}/],
        ['handleDeleteSelectedWeekClick', /delete (weeklyData|ytdData|dailyData)\[/],
        ['handleDeleteEmployeeYearClick', /deleteEmployeeDataByYear|delete /],
        ['handleDeleteSelectedSentimentClick', /delete |splice|filter\(/]
    ].forEach(([name, removal]) => {
        const start = src.indexOf(`async function ${name}(`);
        t.check(`${name} can wait for the cloud`, start > -1);
        const body = src.slice(start, src.indexOf('\n}\n', start));
        const guard = body.indexOf('await cloudCopyBeforeDeleting()');
        const confirmAt = Math.max(body.indexOf('confirm('), body.indexOf('prompt('));
        const removeAt = body.search(removal);
        t.check(`${name} asks first, then saves to the cloud`, guard > confirmAt && confirmAt > -1);
        t.check(`${name} saves to the cloud before it removes anything`, guard > -1 && (removeAt === -1 || guard < removeAt));
    });

    t.check('nobody is told to download a backup first', src.indexOf('Back up first via "Download Backup"') === -1);
});
