'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * Many hats review, Phase 3: data safety (audit/2026-11-03-many-hats.md).
 */

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

function between(source, start, end) {
    const from = source.indexOf(start);
    if (from === -1) return '';
    const to = source.indexOf(end, from + start.length);
    return source.slice(from, to === -1 ? undefined : to);
}

function loadStorage(t) {
    t.installFakeBrowser();
    ['modules/store-registry.module.js', 'modules/constants.module.js',
     'modules/metrics-registry.module.js', 'modules/data-parsing.module.js',
     'modules/storage.module.js'].forEach((m) => t.loadModule(m));
    return global.window.DevCoachModules.storage;
}

suite('many hats X7: a button press never sends with the guard off', (t) => {
    const repoSync = read('modules/repo-sync.module.js');
    const script = read('script.js');
    // Sync Now on a computer that had not pulled replaced the newer cloud
    // copy without a word.
    t.check('Sync Now keeps the guard',
        repoSync.indexOf("syncRepoData('manual sync now', { force: true, allowDataRegression: true })") === -1);
    t.check('so does the upload button',
        repoSync.indexOf("syncRepoData('upload to git', { force: true, allowDataRegression: true })") === -1);
    t.check('and the footer button', script.indexOf("'manual footer sync', { force: true, allowDataRegression: true }") === -1);

    const conflict = between(repoSync, 'async function maybeHandleRepoSyncConflict', '\n    }\n');
    const restore = conflict.indexOf('Press OK to load the cloud copy');
    const anyway = conflict.indexOf('allowDataRegression: true');
    t.check('the safe answer is offered first', restore > -1 && anyway > restore);
    t.check('going backwards needs its own yes', /const sendAnyway = confirm\(/.test(conflict));
});

suite('many hats X8: a refused save says why', (t) => {
    const storage = loadStorage(t);

    t.equal('a normal save leaves no refusal', storage.saveWithSizeCheck('dailyData', { a: {} }) && storage.getLastSaveRefusal('dailyData'), null);

    // Another computer's copy arrives; the page still holds the old one.
    storage.applyRemoteStore('dailyData', { b: {} });
    t.equal('the save from the old copy is refused', storage.saveWithSizeCheck('dailyData', { a: {} }), false);
    t.equal('and the reason is that it changed elsewhere', storage.getLastSaveRefusal('dailyData').reason, 'stale');

    // The words follow the reason. "Storage is full" sent Scott to back up
    // when the fix was a reload.
    const script = read('script.js');
    const words = new Function(between(script, 'function storageSaveFailureText', '\nfunction notifyStorageSaveFailed') + '\nreturn storageSaveFailureText;')();
    const stale = words('weekly performance data', 'stale');
    t.check('a stale save says to reload', /Reload/.test(stale.toast) && !/full/i.test(stale.toast));
    t.check('and names another tab or computer', /another tab or on another computer/.test(stale.alert));
    t.equal('a full disk keeps the old message', words('weekly performance data', 'full'), null);
    t.check('each save passes its store name', /notifyStorageSaveFailed\('weekly performance data', 'weeklyData'\)/.test(script));
});

suite('many hats X8: a failed check for the other computer is not swallowed', (t) => {
    const script = read('script.js');
    const boot = between(script, 'function startCloudSyncBackground()', 'document.addEventListener(\'visibilitychange\'');
    t.check('the boot pull reports a failure', /\.catch\(notePullProblem\)/.test(boot));
    t.check('so does the timed check', /catch \(error\) \{ notePullProblem\(error\); \}/.test(script));
    const note = between(script, 'function notePullProblem', '\n}\n');
    t.check('offline stays quiet', /navigator\.onLine === false\) return/.test(note));
    t.check('and the footer shows the problem', /showCloudProblemInFooter\(\)/.test(note));
});

suite('many hats X1: both computers\' uploads survive a clash', (t) => {
    t.installFakeBrowser();
    t.loadModule('modules/store-registry.module.js');
    const sync = t.loadModule('modules/manifest-sync.module.js').manifestSync;
    const registry = global.window.DevCoachModules.storeRegistry;
    ['weeklyData', 'ytdData', 'dailyData'].forEach((name) => {
        t.equal(`${name} merges by period`, registry.mergeStrategyOf(name), 'unionByPeriod');
    });

    // The home PC uploaded Nov 2 to 8 overnight. This one had not pulled it,
    // and added a correction to Oct 26 to Nov 1.
    const row = (n) => ({ employees: [{ name: 'A', totalCalls: n }] });
    const theirs = { 'w1': row(10), 'w2': row(20) };
    const ours = { 'w1': row(11), 'w0': row(5) };
    const { merged, collided } = sync.unionPeriods(ours, theirs);
    t.check('the other computer\'s new week is kept', !!merged.w2);
    t.check('and this one\'s too', !!merged.w0);
    t.equal('a week both changed is ours', merged.w1.employees[0].totalCalls, 11);
    t.equal('and no row is doubled', merged.w1.employees.length, 1);
    t.check('a clash on the same week is flagged, so theirs is kept as a copy', collided === true);
    t.check('no clash when the shared week matches',
        sync.unionPeriods({ w1: row(10) }, { w1: row(10), w2: row(2) }).collided === false);

    const source = read('modules/manifest-sync.module.js');
    t.check('reconcile uses it', /strategy === 'unionByPeriod'/.test(source));
});

suite('many hats X1: a pull warns the app\'s other tabs', (t) => {
    const storage = read('modules/storage.module.js');
    const apply = between(storage, 'function applyRemoteStore(key, value)', 'function isStoreStale');
    t.check('a pulled store is announced like a local save', /announceWriteToOtherTabs\(key\)/.test(apply));
});

suite('many hats X10: a contest save changes its own day on the latest month', (t) => {
    const ui = read('modules/contest-ui.module.js');
    const save = between(ui, 'async function saveDay', '\n    }\n');
    const fetchAt = save.indexOf('month = await fetchMonth(monthKey)');
    const dayAt = save.indexOf('const day = Object.assign({}, month.days[date] || {})');
    const pushAt = save.indexOf('await pushMonth(monthKey, month)');
    // Two panels each sent back the month as they had loaded it, and the
    // second wiped the first one's days.
    t.check('the month is read fresh before the day is built', fetchAt > -1 && fetchAt < dayAt);
    t.check('and that fresh month is what is sent', pushAt > dayAt);
    t.check('a failed read saves nothing', /could not read the latest copy first/.test(save));

    const importer = between(ui, 'async function importFromUploads', '\n    }\n');
    t.check('the importer merges onto a fresh read too',
        importer.indexOf('await fetchMonth(monthKey)') > -1
        && importer.indexOf('await fetchMonth(monthKey)') < importer.indexOf('api.mergeImportIntoMonth(currentMonthData(), preview)'));
});

suite('many hats X1: an emptying is only sent when it was done here', (t) => {
    const sync = read('modules/manifest-sync.module.js');
    t.check('the commit names the stores emptied on purpose', /allowEmpty: deliberatelyEmptied\(changed\)/.test(sync));
    const helper = between(sync, 'function deliberatelyEmptied', 'async function commitWithRebase');
    t.check('only stores this computer has synced before count', /if \(!applied\[name\]\) return false;/.test(helper));
});

suite('many hats X11: a browser without its database is told so up front', (t) => {
    const script = read('script.js');
    const boot = between(script, 'function startCloudSyncBackground()', 'storage?.onBackendProblem');
    t.check('the small storage fallback gets a banner', /getBackendMode\(\) !== 'idb'/.test(boot) && /no longer fits/.test(boot));
});
