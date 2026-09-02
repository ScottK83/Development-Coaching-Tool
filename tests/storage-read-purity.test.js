'use strict';

/**
 * Reading data must not write it back.
 *
 * loadWeeklyData normalizes what it reads, and persists the result when
 * normalization changed something. Two of those normalizations disagreed with
 * each other:
 *
 *   findPhantomZeroMetrics blanks a column that reads 0 for every employee,
 *   because that means "the column was missing from the upload", not "nobody
 *   transferred a call all week".
 *
 *   normalizeTransfersPercentage returns 0 for any value it cannot parse, and
 *   parseFloat('') is NaN — so it turned the blank straight back into 0.
 *
 * Neither ever won. Every read saw a change, rewrote the entire store, and
 * marked it dirty; a dirty store schedules a cloud push. So merely reading
 * pushed data, and filling one 127-name dropdown did it hundreds of times. On a
 * second machine that is the lost-update path this module works hardest to
 * avoid: a tab that only ever read could still overwrite what another machine
 * wrote.
 *
 * The normalization itself is still right and still runs once. What is pinned
 * here is that it settles.
 */

const { suite } = require('./harness');

const PREFIX = 'devCoachingTool_';

function load(t) {
    t.installFakeBrowser();
    ['modules/store-registry.module.js', 'modules/constants.module.js',
     'modules/metrics-registry.module.js', 'modules/data-parsing.module.js',
     'modules/storage.module.js'].forEach((m) => t.loadModule(m));
    return global.window.DevCoachModules.storage;
}

// A period whose transfers column was absent from the upload: every row reads 0.
function periodWithMissingColumn(rows) {
    return {
        '2026-08-03|2026-08-09': {
            employees: Array.from({ length: rows }, (_, i) => ({
                name: 'Associate ' + i, totalCalls: 100, aht: 500,
                transfers: 0, scheduleAdherence: 95, reliability: 5
            })),
            metadata: { startDate: '2026-08-03', endDate: '2026-08-09', periodType: 'week' }
        }
    };
}

function countWrites(fn) {
    let writes = 0;
    const real = global.localStorage.setItem.bind(global.localStorage);
    global.localStorage.setItem = (k, v) => {
        if (k === PREFIX + 'weeklyData') writes++;
        return real(k, v);
    };
    try { fn(); } finally { global.localStorage.setItem = real; }
    return writes;
}

suite('storage: normalization settles instead of oscillating', (t) => {
    const storage = load(t);
    localStorage.setItem(PREFIX + 'weeklyData', JSON.stringify(periodWithMissingColumn(5)));

    // The first read is allowed to persist: it is the one that decides the
    // column was missing and blanks it.
    const firstReadWrites = countWrites(() => storage.loadWeeklyData());
    t.equal('the first read normalizes and saves once', firstReadWrites, 1);

    const blanked = storage.loadWeeklyData()['2026-08-03|2026-08-09'].employees[0].transfers;
    t.equal('the absent column is blank, not a phantom zero', blanked, '');

    // The bug: this was 20.
    const laterWrites = countWrites(() => {
        for (let i = 0; i < 20; i++) storage.loadWeeklyData();
    });
    t.equal('twenty more reads write nothing at all', laterWrites, 0);
});

suite('storage: a read does not mark the store dirty', (t) => {
    const storage = load(t);
    localStorage.setItem(PREFIX + 'weeklyData', JSON.stringify(periodWithMissingColumn(5)));

    storage.loadWeeklyData();      // the one legitimate normalizing read
    storage.clearDirtyStores();    // as boot does, before the sync comes up

    for (let i = 0; i < 10; i++) storage.loadWeeklyData();

    // A dirty store schedules a cloud push. Reading is not a change.
    t.check('ten reads leave the store clean', !storage.isStoreDirty('weeklyData'));
});

suite('storage: a real transfers value is still normalized', (t) => {
    const storage = load(t);
    // Not an absent column — a genuine value that needs rounding.
    localStorage.setItem(PREFIX + 'weeklyData', JSON.stringify({
        '2026-08-03|2026-08-09': {
            employees: [
                { name: 'A', totalCalls: 100, transfers: 3.14159, scheduleAdherence: 95 },
                { name: 'B', totalCalls: 100, transfers: 7.5, scheduleAdherence: 91 },
                { name: 'C', totalCalls: 100, transfers: 2.25, scheduleAdherence: 88 }
            ],
            metadata: { startDate: '2026-08-03', endDate: '2026-08-09', periodType: 'week' }
        }
    }));

    const emps = storage.loadWeeklyData()['2026-08-03|2026-08-09'].employees;
    t.equal('a long decimal is still rounded to two places', emps[0].transfers, 3.14);
    t.equal('a clean value is left alone', emps[1].transfers, 7.5);
    t.check('and a real column is never blanked',
        emps.every((e) => e.transfers !== ''));

    // And that settles too.
    const writes = countWrites(() => { for (let i = 0; i < 5; i++) storage.loadWeeklyData(); });
    t.equal('repeated reads of a normalized store write nothing', writes, 0);
});

suite('storage: a genuine all-zero column in a tiny period is left alone', (t) => {
    const storage = load(t);
    // Two rows is under PHANTOM_ZERO_MIN_ROWS, so this is not read as an absent
    // column — a small period must not be wiped.
    localStorage.setItem(PREFIX + 'weeklyData', JSON.stringify(periodWithMissingColumn(2)));

    const emps = storage.loadWeeklyData()['2026-08-03|2026-08-09'].employees;
    t.equal('a two-row period keeps its zeros', emps[0].transfers, 0);

    const writes = countWrites(() => { for (let i = 0; i < 5; i++) storage.loadWeeklyData(); });
    t.equal('and reading it repeatedly still writes nothing', writes, 0);
});
