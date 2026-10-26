'use strict';

/**
 * EDITING OR DELETING A BUILT-IN TIP CHANGES THAT ONE TIP, ONCE
 *
 * Settings > Coaching Tips lets Scott edit or delete a tip that ships in the
 * CSV. Three faults sat behind that screen (audit 2026-10-25, section 12):
 *
 *   1. The edits and deletions were applied when the pool loaded, that result
 *      was saved, and getMetricTips applied them again by position to the
 *      already-edited list. Deleting one tip removed two, and an edit after a
 *      deletion landed on the wrong tip as well as the right one.
 *   2. The two handlers read the stores from localStorage, but the stores live
 *      in IndexedDB, so every new edit or deletion started from an empty copy
 *      and wiped the ones before it.
 *   3. Both were keyed by a tip's position in its metric, so any change to the
 *      CSV's order re-pointed every saved edit at a different tip.
 *
 * Neither had hit real data yet: the backup holds no edits or deletions.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const CSV_PATTERN = /const EMBEDDED_TIPS_CSV = `([\s\S]*?)`;/;

/**
 * Loads tips.module.js the way the browser runs it, against a storage module
 * that keeps these stores out of localStorage, as the IndexedDB backend does.
 * `mem` can be shared between loads to stand for the same saved data on a
 * later version of the app.
 */
function loadTips(t, options = {}) {
    const { els } = t.installFakeBrowser();
    const mem = options.mem || {};
    global.window.DevCoachModules.storage = {
        readStore: (key) => mem[key],
        saveWithSizeCheck: (key, value) => { mem[key] = JSON.parse(JSON.stringify(value)); return true; }
    };
    global.STORAGE_PREFIX = 'devCoachingTool_';
    global.showToast = () => {};
    global.confirm = () => true;
    global.alert = () => {};

    let src = fs.readFileSync(path.join(ROOT, 'modules/tips.module.js'), 'utf8');
    if (options.csv) {
        src = src.replace(CSV_PATTERN, (whole, csv) => 'const EMBEDDED_TIPS_CSV = `' + options.csv(csv) + '`;');
    }
    // A function body rather than a global eval, so the module's top-level
    // const can be declared again by the next load.
    const api = new Function(src + '\n;return { loadServerTips, getMetricTips, initializeDefaultTips };')();
    return { api, mem, els, win: global.window };
}

function cleanUp() {
    delete global.STORAGE_PREFIX;
    delete global.showToast;
    delete global.confirm;
    delete global.alert;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function typeInto(els, metric, index, text) {
    els[`editServerTip_${metric}_${index}`] = { value: text };
}

/** The CSV with one metric's rows in reverse order, everything else as is. */
function reverseMetric(metric) {
    return (csv) => {
        const lines = csv.split('\n');
        const positions = [];
        lines.forEach((line, i) => { if (line.indexOf(metric + ',') === 0) positions.push(i); });
        const reversed = positions.map((i) => lines[i]).reverse();
        positions.forEach((i, n) => { lines[i] = reversed[n]; });
        return lines.join('\n');
    };
}

suite('tips edits: deleting one tip removes one tip', async (t) => {
    const { api, win } = loadTips(t);
    const before = (await api.loadServerTips()).fcr.slice();
    api.initializeDefaultTips();
    await tick();

    await win.deleteServerTip('fcr', 3);
    // A reload, which is when the saved pool is rebuilt.
    api.initializeDefaultTips();
    await tick();

    const after = api.getMetricTips('fcr');
    t.equal('the pool is one shorter', after.length, before.length - 1);
    t.check('the deleted tip is gone', !after.includes(before[3]));
    t.check('and the tip after it is still there', after.includes(before[4]));
    cleanUp();
});

suite('tips edits: a second change keeps the first', async (t) => {
    const { api, win, els } = loadTips(t);
    const before = (await api.loadServerTips()).fcr.slice();

    await win.deleteServerTip('fcr', 3);
    await win.deleteServerTip('fcr', 6);
    let pool = (await api.loadServerTips()).fcr;
    t.check('the first deletion survives the second', !pool.includes(before[3]));
    t.check('and the second one holds', !pool.includes(before[6]));
    t.equal('two deletions, two tips fewer', pool.length, before.length - 2);

    typeInto(els, 'fcr', 1, 'First edit, written by Scott.');
    await win.updateServerTip('fcr', 1);
    typeInto(els, 'fcr', 4, 'Second edit, written by Scott.');
    await win.updateServerTip('fcr', 4);
    pool = api.getMetricTips('fcr');
    t.check('the first edit survives the second', pool.includes('First edit, written by Scott.'));
    t.check('and the second one holds', pool.includes('Second edit, written by Scott.'));
    t.check('neither original is left', !pool.includes(before[1]) && !pool.includes(before[4]));
    cleanUp();
});

suite('tips edits: an edit after a deletion lands once, on its own tip', async (t) => {
    const { api, win, els } = loadTips(t);
    const before = (await api.loadServerTips()).fcr.slice();
    api.initializeDefaultTips();
    await tick();

    await win.deleteServerTip('fcr', 2);
    typeInto(els, 'fcr', 5, 'Edited by Scott.');
    await win.updateServerTip('fcr', 5);

    // Straight away, before any reload, and again after one.
    let pool = api.getMetricTips('fcr');
    t.equal('straight away: the edit shows once', pool.filter((tip) => tip === 'Edited by Scott.').length, 1);
    api.initializeDefaultTips();
    await tick();
    pool = api.getMetricTips('fcr');
    t.equal('after a reload: the edit shows once', pool.filter((tip) => tip === 'Edited by Scott.').length, 1);
    t.check('the tip it replaced is gone', !pool.includes(before[5]));
    t.check('the next tip is untouched', pool.includes(before[6]));
    t.check('the deleted tip stays deleted', !pool.includes(before[2]));
    t.check('and the one after the deleted tip is still there', pool.includes(before[3]));
    t.equal('one fewer tip in all', pool.length, before.length - 1);

    // The tips manager and everything that reads tips see the same list.
    const managed = (await api.loadServerTips()).fcr;
    t.equal('the tips manager shows the same pool', JSON.stringify(managed), JSON.stringify(pool));
    cleanUp();
});

suite('tips edits: a change follows its tip when the CSV is reordered', async (t) => {
    const first = loadTips(t);
    const before = (await first.api.loadServerTips()).fcr.slice();
    await first.win.deleteServerTip('fcr', 3);
    typeInto(first.els, 'fcr', 5, 'Edited by Scott.');
    await first.win.updateServerTip('fcr', 5);

    // The next release ships the same tips in a different order, over the
    // same saved data.
    const later = loadTips(t, { mem: first.mem, csv: reverseMetric('fcr') });
    const pool = later.api.getMetricTips('fcr');
    t.check('the deleted tip is still the one that is gone', !pool.includes(before[3]));
    t.check('the edit still replaces its own tip', pool.includes('Edited by Scott.') && !pool.includes(before[5]));
    t.equal('and nothing else moved', pool.length, before.length - 1);
    t.check('every other tip is still there',
        before.filter((tip, i) => i !== 3 && i !== 5).every((tip) => pool.includes(tip)));
    cleanUp();
});

suite('tips edits: old position-keyed entries are read without harm', async (t) => {
    const mem = {
        modifiedServerTips: { fcr: { 3: 'An edit saved by position.' }, aht: 'not an object' },
        deletedServerTips: { fcr: [1, 2], transfers: 'not a list' }
    };
    const { api, win } = loadTips(t, { mem });
    const csvFcr = (fs.readFileSync(path.join(ROOT, 'tips.csv'), 'utf8').split(/\r?\n/)
        .filter((line) => line.indexOf('fcr,') === 0)).length;

    let pool;
    let threw = null;
    try { pool = api.getMetricTips('fcr'); } catch (e) { threw = e; }
    t.check('getMetricTips does not throw on them', threw === null);
    // A position no longer says which tip it meant, so it is not applied to
    // whatever happens to sit there now.
    t.equal('they are not applied to whichever tip now sits there', pool.length, csvFcr);
    t.check('a malformed metric entry is shrugged off', api.getMetricTips('aht').length > 0 && api.getMetricTips('transfers').length > 0);

    await win.deleteServerTip('fcr', 4);
    t.check('a new deletion keeps the old entries in the store', [1, 2].every((n) => mem.deletedServerTips.fcr.includes(n)));
    t.equal('and is itself applied', api.getMetricTips('fcr').length, csvFcr - 1);
    cleanUp();
});

suite('tips edits: an edited tip follows the dash rule too', async (t) => {
    const { api, win, els } = loadTips(t);
    typeInto(els, 'fcr', 0, 'Say the date — then stop.');
    await win.updateServerTip('fcr', 0);
    const pool = api.getMetricTips('fcr');
    t.check('the dash is gone from what is stored', pool.includes('Say the date, then stop.'));
    cleanUp();
});
