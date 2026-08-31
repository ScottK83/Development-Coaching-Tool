'use strict';

/**
 * The loaders used to write back mid-read with a raw setItem. On a full origin
 * that write throws, the function-level catch swallowed it, and the loader
 * returned {} even though the read had succeeded. The global was then assigned
 * that empty object and beforeunload persisted it over the real store: a full
 * disk turned into a silent wipe of the entire year.
 *
 * These tests pin the rule: a failed write-back never costs you the read.
 */

const { suite } = require('./harness');

function quotaError() {
    const err = new Error('The quota has been exceeded.');
    err.name = 'QuotaExceededError';
    return err;
}

// Three rows all reading 0 transfers trip the phantom-zero rule, which is what
// makes normalizeStoredDataSet return a fresh object and fire the write-back.
// Without a normalization change there is no write to fail, and no bug to hit.
function periodThatNormalizes() {
    const row = (name) => ({
        name, firstName: name.split(' ')[0],
        transfers: 0, transfersCount: 0, totalCalls: 100,
        aht: 400, surveyTotal: 10
    });
    return {
        '2026-08-17|2026-08-23': {
            employees: [row('Alyssa Dimes'), row('Chris Vale'), row('Dana Roe')],
            metadata: { startDate: '2026-08-17', endDate: '2026-08-23', periodType: 'week' }
        }
    };
}

function load(t, seedKey) {
    const browser = t.installFakeBrowser();
    const modules = t.loadModule('modules/storage.module.js');
    const raw = JSON.stringify(periodThatNormalizes());
    browser.store['devCoachingTool_' + seedKey] = raw;
    return { storage: modules.storage, store: browser.store, raw };
}

// Makes every write throw, and counts the attempts, while capturing the console
// noise so a passing run stays readable.
function failAllWrites(fn) {
    const realSet = global.localStorage.setItem;
    const realWarn = console.warn;
    const realError = console.error;
    const logged = [];
    let attempts = 0;
    global.localStorage.setItem = () => { attempts++; throw quotaError(); };
    console.warn = (...a) => logged.push(String(a[0]));
    console.error = (...a) => logged.push(String(a[0]));
    try {
        return { value: fn(), attempts, logged };
    } finally {
        global.localStorage.setItem = realSet;
        console.warn = realWarn;
        console.error = realError;
    }
}

suite('storage: a failed write-back never costs you the read', (t) => {
    [
        ['weeklyData', 'loadWeeklyData'],
        ['dailyData', 'loadDailyData'],
        ['ytdData', 'loadYtdData']
    ].forEach(([key, loader]) => {
        const { storage, store, raw } = load(t, key);
        const { value, attempts, logged } = failAllWrites(() => storage[loader]());
        const weeks = Object.keys(value || {});

        t.check(`${key}: the write-back was actually attempted`, attempts === 1);
        t.equal(`${key}: the period survives a quota failure`, weeks.length, 1);
        t.equal(`${key}: its rows come back intact`,
            (value['2026-08-17|2026-08-23'].employees || []).length, 3);
        t.check(`${key}: the stored copy is left untouched`,
            store['devCoachingTool_' + key] === raw);
        t.check(`${key}: and the failure is not silent`,
            logged.some(line => line.indexOf(key) > -1));
    });
});

suite('storage: the normalization still writes back when there is room', (t) => {
    const { storage, store } = load(t, 'weeklyData');
    const result = storage.loadWeeklyData();

    t.equal('the phantom zero is blanked in the returned data',
        result['2026-08-17|2026-08-23'].employees[0].transfers, '');
    t.check('and the normalized form is persisted',
        JSON.parse(store['devCoachingTool_weeklyData'])['2026-08-17|2026-08-23'].employees[0].transfers === '');
});

suite('storage: a quota failure on save is reported, not swallowed', (t) => {
    const browser = t.installFakeBrowser();
    const modules = t.loadModule('modules/storage.module.js');
    void browser;

    const { value, logged } = failAllWrites(() =>
        modules.storage.saveWithSizeCheck('weeklyData', periodThatNormalizes()));

    t.equal('the caller is told the write did not happen', value, false);
    t.check('and it leaves a trace for the ones that ignore the return value',
        logged.some(line => line.indexOf('QUOTA EXCEEDED') > -1));
});
