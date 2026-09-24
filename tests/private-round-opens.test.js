'use strict';

const { suite } = require('./harness');

/**
 * THE PRIVATE ROUND HAS TO OPEN
 *
 * The window change on 22 September took `const periodType = 'week'` out of
 * showRunMyDayModal and left one read of it behind. Every press of Private
 * round then threw a ReferenceError before the modal was built, and because it
 * threw inside an async click handler, the button simply did nothing. Every
 * other test still passed: they read the copy out of the source, and none of
 * them ever ran the round.
 *
 * So this one runs it, both ways: from My Team, which hands over the window,
 * and with nothing handed over, which falls back to the newest weeks. The
 * Pulse tab that used to open it that second way is gone, folded into My Team,
 * but the fallback is kept so a caller that forgets the window still opens.
 */

const LAST_WEEK = '2026-09-14|2026-09-20';
const THIS_WEEK = '2026-09-21|2026-09-23';

function rows() {
    return ['Alyssa Dimes', 'Oceane Ingram', 'Betty Yanez'].map((name) => ({
        name,
        totalCalls: 200,
        aht: 420,
        adherence: 94,
        overallSentiment: 90,
        positiveWord: 85,
        negativeWord: 88,
        managingEmotions: 95
    }));
}

function load(t) {
    t.installFakeBrowser();

    global.weeklyData = {
        [LAST_WEEK]: { metadata: { periodType: 'week', startDate: '2026-09-14', endDate: '2026-09-20' }, employees: rows() },
        [THIS_WEEK]: { metadata: { periodType: 'week-in-progress', startDate: '2026-09-21', endDate: '2026-09-23' }, employees: rows() }
    };
    global.ytdData = {};
    global.dailyData = {};

    // Every element the modal asks for by id exists once it has been added, so
    // the wiring after appendChild runs rather than stopping on a null.
    const added = [];
    const stub = () => ({
        style: {}, dataset: {}, value: '', textContent: '', innerHTML: '',
        setAttribute() {}, select() {}, addEventListener() {}, remove() {},
        appendChild() {}, querySelector: () => null, querySelectorAll: () => []
    });
    const stubs = {};
    global.document.createElement = stub;
    global.document.body.appendChild = (el) => { added.push(el); };
    global.document.getElementById = (id) => {
        if (!added.length) return null;
        if (!stubs[id]) stubs[id] = stub();
        return stubs[id];
    };

    global.window.DevCoachModules.storage = {
        loadWeeklyData: () => global.weeklyData,
        loadYtdData: () => global.ytdData,
        loadDailyData: () => global.dailyData
    };

    const registry = t.loadModule('modules/metrics-registry.module.js');
    global.isReverseMetric = registry.metricsRegistryHelpers.isReverseMetric;
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    t.loadModule('modules/period-index.module.js');
    t.loadModule('modules/daily-outreach.module.js');
    const pulse = t.loadModule('modules/morning-pulse.module.js').morningPulse;
    return { pulse, added };
}

function modalIn(added) {
    return added.filter((el) => el && el.id === 'runMyDayModal')[0] || null;
}

suite('private round: opens from My Team with the window handed over', async (t) => {
    const { pulse, added } = load(t);
    const comparison = {
        windowId: 'thisWeek',
        unit: 'week',
        latestKey: THIS_WEEK,
        baselineKey: LAST_WEEK,
        latestLabel: 'this week so far',
        baselineLabel: 'last week',
        headline: 'this week so far against last week'
    };

    let error = null;
    try {
        await pulse.showRunMyDayModal(null, { comparison, plan: { id: 'thursday' } });
    } catch (e) { error = e; }

    t.equal('it does not throw', error && error.message, null);
    const modal = modalIn(added);
    t.check('the modal is built', Boolean(modal));
    t.check('and its header names the window, not the weekday\'s own period',
        Boolean(modal) && modal.innerHTML.indexOf('this week so far against last week') > -1);
});

suite('private round: still opens with no window handed over', async (t) => {
    const { pulse, added } = load(t);

    let error = null;
    try {
        await pulse.showRunMyDayModal(null);
    } catch (e) { error = e; }

    t.equal('it does not throw', error && error.message, null);
    t.check('the modal is built', Boolean(modalIn(added)));
});

suite('private round: reopening keeps the window and the weekday it opened with', (t) => {
    const src = require('fs').readFileSync(require('path').join(require('./harness').ROOT, 'modules/morning-pulse.module.js'), 'utf8');
    const start = src.indexOf('async function showRunMyDayModal(container, options)');
    // Up to the next function at the same depth, whichever kind it is, so a
    // call from anywhere else in the file is not read as a reopen.
    const ends = [src.indexOf('\n    async function ', start + 10), src.indexOf('\n    function ', start + 10)]
        .filter((i) => i > -1);
    const body = src.slice(start, ends.length ? Math.min(...ends) : undefined);

    const reopens = body.match(/await showRunMyDayModal\([^)]*\)/g) || [];
    t.check('clear sent flags and undo both reopen the round', reopens.length >= 2);
    t.check('and every reopen hands the options back',
        reopens.every((call) => call === 'await showRunMyDayModal(container, options)'));
});
