'use strict';

/**
 * The app keeps a full year of everybody's history.
 *
 * Six places used to throw data away, and every one of them existed for the 5MB
 * localStorage ceiling: call logs past 500, compliance past 200, tip usage past
 * 50, follow-ups past 200, sentiment snapshots past 200, and every daily row
 * once a weekly upload covered it.
 *
 * That ceiling is gone. The data is on a backend measured in hundreds of
 * megabytes, and the question these records exist to answer is "how has this
 * person been trending", which a truncated history cannot answer at all.
 *
 * These tests fail if a cap comes back.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

suite('retention: nothing truncates a history store any more', (t) => {
    const script = read('script.js');
    const redFlag = read('modules/red-flag.module.js');
    const sentiment = read('modules/sentiment.module.js');

    t.check('call listening logs are not capped at 500',
        script.indexOf('callListeningLogs[employeeName].slice(-500)') === -1);
    t.check('the compliance log is not capped at 200',
        script.indexOf("'complianceLog', log.slice(-200)") === -1);
    t.check('tip usage is not capped at 50',
        !/usedAt: new Date\(\)\.toISOString\(\) \}\]\)\.slice\(-50\)/.test(script));
    t.check('follow-up history is not capped at 200',
        redFlag.indexOf('history.entries.slice(0, 200)') === -1);
    t.check('sentiment snapshots are not capped at 200',
        !/\.sort\(\(a, b\) => new Date\(b\.savedAt\)[\s\S]{0,80}\.slice\(0, 200\)/.test(sentiment));

    // Sorting is still wanted; only the truncation went.
    t.check('sentiment snapshots are still sorted newest first',
        sentiment.indexOf('new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()') > -1);
});

suite('retention: superseded dailies are archived, not destroyed', (t) => {
    const script = read('script.js');
    const start = script.indexOf('function purgeDailiesCoveredBy');
    const body = script.slice(start, script.indexOf('\n/**', start + 10));

    t.check('the function is still there', start > -1);
    // Day-level detail is the only thing that answers a trend question at finer
    // resolution than a week. It moves out of the working set rather than being
    // deleted, so nothing on screen changes and the rows still exist.
    t.check('rows are written to an archive', body.indexOf("'dailyArchive'") > -1);
    t.check('and still leave the working set, so displays are unchanged',
        body.indexOf('delete dailyData[key]') > -1);

    // Losing them to a failed write would be the same outcome as deleting them.
    t.check('a failed archive write puts them back',
        /Could not archive[\s\S]{0,300}dailyData\[key\] = archive\[key\]/.test(body));
    t.check('and reports nothing was moved', /return 0;/.test(body.slice(body.indexOf('Could not archive'))));
});

suite('retention: the archive is a real store on the uncapped backend', (t) => {
    t.installFakeBrowser();
    const registry = t.loadModule('modules/store-registry.module.js').storeRegistry;

    t.equal('dailyArchive is data, not scratch', registry.tierOf('dailyArchive'), 'data');
    t.equal('and lives where there is no ceiling', registry.get('dailyArchive').backend, 'idb');
    t.check('so it is synced to cloud storage like everything else',
        registry.syncedNames().indexOf('dailyArchive') > -1);
});

suite('retention: a year of history is what the stores are sized for', (t) => {
    t.installFakeBrowser();
    const registry = t.loadModule('modules/store-registry.module.js').storeRegistry;

    // The stores that accumulate over a year all have to be on the backend, or
    // the 5MB ceiling comes back through whichever one was left behind.
    ['weeklyData', 'ytdData', 'dailyData', 'dailyArchive', 'coachingHistory',
        'callListeningLogs', 'associateSentimentSnapshots', 'tipUsageHistory',
        'followUpHistory', 'complianceLog', 'celebrationsHistory',
        'oneOnOneMeetings'].forEach((name) => {
        const entry = registry.get(name);
        t.check(`${name} is on the uncapped backend`, entry && entry.backend === 'idb');
    });
});
