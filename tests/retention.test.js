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
    // Asserted by running the function, below, rather than by matching source
    // text -- the regex that used to stand here matched the rollback's shape
    // without noticing it rolled back the WRONG ROWS.
    t.check('a failed archive write is handled at all', body.indexOf('Could not archive') > -1);
    t.check('and reports nothing was moved', /return 0;/.test(body.slice(body.indexOf('Could not archive'))));
});

/**
 * The rollback restores the rows this call moved, and nothing else.
 *
 * It used to walk every key in the archive, so a failed write poured the whole
 * accumulated year back into the working set. On a browser in the localStorage
 * fallback -- IndexedDB blocked, a private window, the open timeout -- that is
 * reachable: the archive passes the 4 MB cap after roughly four months, and
 * from that upload on dailyData jumped from a handful of keys to the entire
 * archive and grew every week after. Eventually dailyData itself exceeded the
 * cap, at which point daily check-in uploads stopped persisting and the upload
 * UI still reported success.
 *
 * Run against the real function, lifted out of script.js, because the source
 * regex this replaces matched the broken version perfectly.
 */
function extractFn(script, name) {
    const start = script.indexOf('function ' + name);
    if (start < 0) throw new Error('not found in script.js: ' + name);
    const end = script.indexOf(String.fromCharCode(10) + '/**', start + 10);
    return script.slice(start, end > -1 ? end : undefined);
}

function loadPurge(t, opts) {
    const script = read('script.js');
    const src = extractFn(script, 'makeRoomInDailyArchive')
        + String.fromCharCode(10) + extractFn(script, 'purgeDailiesCoveredBy');

    const calls = { saved: [], notified: [] };
    const storage = {
        readStore: () => opts.archive,
        // Mirrors the real one: a store over the cap refuses the write. maxKeys
        // stands in for the 4 MB ceiling, so a test can be about behaviour
        // rather than about megabytes.
        saveWithSizeCheck: (key, data) => {
            calls.saved.push(key);
            if (opts.failWrite) return false;
            if (opts.maxKeys && Object.keys(data).length > opts.maxKeys) return false;
            opts.archive = data;
            return true;
        },
        isBackedByIdb: () => !!opts.onIdb
    };
    const scope = {
        window: { DevCoachModules: { storage } },
        dailyData: opts.dailyData,
        notifyStorageSaveFailed: (label) => calls.notified.push(label)
    };
    const fn = new Function('window', 'dailyData', 'notifyStorageSaveFailed',
        src + '; return purgeDailiesCoveredBy;')(scope.window, scope.dailyData, scope.notifyStorageSaveFailed);
    return { fn, calls, opts };
}

function day(date) {
    return { [`${date}|${date}`]: { employees: [{ name: 'A' }], metadata: { startDate: date, endDate: date } } };
}

suite('retention: a failed archive write restores only the rows it moved', (t) => {
    // A year already archived, plus this week's five days in the working set.
    const archive = {};
    for (let i = 1; i <= 80; i++) {
        const d = `2026-0${i < 10 ? '1' : '2'}-${String((i % 28) + 1).padStart(2, '0')}`;
        Object.assign(archive, day(d));
    }
    const archivedBefore = Object.keys(archive).length;
    const dailyData = Object.assign({}, day('2026-08-10'), day('2026-08-11'), day('2026-08-12'));

    const { fn, calls } = loadPurge(t, { archive, dailyData, failWrite: true });
    const moved = fn('2026-08-10', '2026-08-12');

    t.equal('nothing is reported as moved', moved, 0);
    // The bug: this was 3 + 80.
    t.equal('the working set gets back exactly its own three days',
        Object.keys(dailyData).length, 3);
    t.check('and they are the right three',
        ['2026-08-10', '2026-08-11', '2026-08-12'].every((d) => !!dailyData[`${d}|${d}`]));
    t.check('no archived history leaks into the working set',
        !Object.keys(dailyData).some((k) => k.startsWith('2026-01') || k.startsWith('2026-02')));

    // readStore hands back the live cache by reference in IndexedDB mode, so a
    // failed write leaves the rows in it unless they are taken back out.
    t.equal('the archive is left exactly as it was', Object.keys(archive).length, archivedBefore);

    // Silence was the real damage: the rows survive, but the archive is full and
    // stays full, and every later upload fails the same way.
    t.equal('the failure is surfaced rather than swallowed', calls.notified.length, 1);
});

suite('retention: a successful archive write moves the rows out', (t) => {
    const archive = Object.assign({}, day('2026-01-05'));
    const dailyData = Object.assign({}, day('2026-08-10'), day('2026-08-11'), day('2026-09-01'));

    const { fn, calls } = loadPurge(t, { archive, dailyData, failWrite: false });
    const moved = fn('2026-08-10', '2026-08-11');

    t.equal('the covered days are reported', moved, 2);
    t.equal('they leave the working set', Object.keys(dailyData).length, 1);
    t.check('the day outside the range stays', !!dailyData['2026-09-01|2026-09-01']);
    t.check('the archive was written', calls.saved.indexOf('dailyArchive') > -1);
    t.equal('nothing is reported as failed', calls.notified.length, 0);
});

suite('retention: a purge that moves nothing writes nothing', (t) => {
    const archive = Object.assign({}, day('2026-01-05'));
    const dailyData = Object.assign({}, day('2026-09-01'));

    const { fn, calls } = loadPurge(t, { archive, dailyData, failWrite: false });
    // No daily falls inside the range.
    t.equal('nothing moved', fn('2026-08-10', '2026-08-11'), 0);
    t.equal('the working set is untouched', Object.keys(dailyData).length, 1);
    t.equal('and the archive is not rewritten for nothing', calls.saved.length, 0);
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

/**
 * A full archive gives up its oldest days rather than wedging.
 *
 * dailyArchive is uncapped on the IndexedDB backend, but a browser in the
 * localStorage fallback meets the 4 MB ceiling after roughly four months of
 * check-ins. Before this, that wedged permanently: the archive write failed on
 * every upload from then on, so dailies never left the working set, dailyData
 * grew every week, and once IT passed the ceiling the daily upload itself
 * stopped persisting while the UI still reported success. Keeping every old day
 * was costing new days.
 */
suite('retention: a full archive drops its oldest days rather than wedging', (t) => {
    const archive = {};
    for (let m = 1; m <= 4; m++) {
        for (let d = 1; d <= 28; d++) {
            Object.assign(archive, day(`2026-0${m}-${String(d).padStart(2, '0')}`));
        }
    }
    const before = Object.keys(archive).length;
    const dailyData = Object.assign({}, day('2026-08-10'), day('2026-08-11'));

    // localStorage fallback, already at the ceiling.
    const { fn, calls, opts } = loadPurge(t, {
        archive, dailyData, onIdb: false, maxKeys: before
    });
    const moved = fn('2026-08-10', '2026-08-11');

    t.equal('the new days are archived, not rolled back', moved, 2);
    t.equal('and they leave the working set', Object.keys(dailyData).length, 0);
    t.check('the days this call moved are in the archive',
        !!opts.archive['2026-08-10|2026-08-10'] && !!opts.archive['2026-08-11|2026-08-11']);
    t.check('the oldest day was given up', !opts.archive['2026-01-01|2026-01-01']);
    t.check('recent history survived', Object.keys(opts.archive).some((k) => k.startsWith('2026-04')));
    t.check('and the archive is back under the ceiling', Object.keys(opts.archive).length <= before);
    t.equal('nothing needed reporting to the user', calls.notified.length, 0);
});

suite('retention: eviction never drops the rows it is archiving', (t) => {
    const archive = {};
    for (let d = 1; d <= 10; d++) Object.assign(archive, day(`2026-01-${String(d).padStart(2, '0')}`));
    const dailyData = Object.assign({}, day('2026-08-10'));

    // Room for one key only: everything evictable has to go, and the row being
    // archived still has to survive.
    const { fn, opts } = loadPurge(t, { archive, dailyData, onIdb: false, maxKeys: 1 });
    fn('2026-08-10', '2026-08-10');

    t.check('the row being archived survived', !!opts.archive['2026-08-10|2026-08-10']);
    t.equal('everything older was given up', Object.keys(opts.archive).length, 1);
});

suite('retention: on the backend a failure is never paid for with history', (t) => {
    const archive = Object.assign({}, day('2026-01-05'), day('2026-01-06'));
    const dailyData = Object.assign({}, day('2026-08-10'));

    // IndexedDB has no ceiling, so a failure there means something else is
    // wrong. Dropping history would not fix it and would cost real data.
    const { fn, calls } = loadPurge(t, { archive, dailyData, onIdb: true, failWrite: true });
    const moved = fn('2026-08-10', '2026-08-10');

    t.equal('nothing is reported as moved', moved, 0);
    t.equal('the day comes back to the working set', Object.keys(dailyData).length, 1);
    t.equal('and no archived history was dropped', Object.keys(archive).length, 2);
    t.equal('the failure is surfaced instead', calls.notified.length, 1);
});
