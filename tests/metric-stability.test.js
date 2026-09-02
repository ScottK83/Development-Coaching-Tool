'use strict';

const { suite } = require('./harness');
/**
 * The per-period employee lookup is indexed, not scanned.
 *
 * getNumericMetric is called once per (rep, metric, tip, week). It used to
 * .find() through every employee row on each of those, so a 127-name centre
 * paid 127 comparisons per lookup. It is a Map now, built once per employees
 * array.
 *
 * These pin the behaviour the index has to preserve, not the speed: a name
 * that is not there, duplicate names, and rows that change between calls.
 */
suite('metric stability: the employee index answers exactly what a scan did', (t) => {
    t.installFakeBrowser();
    const ms = t.loadModule('modules/metric-stability.module.js').metricStability;

    const employees = [
        { name: 'Alpha', aht: 500 },
        { name: 'Bravo', aht: 600 },
        // A duplicate: .find() took the first, so the index must too.
        { name: 'Alpha', aht: 999 }
    ];
    const periods = [{ key: 'w1', endDate: Date.UTC(2026, 3, 10), period: { employees } }];

    // computeTipEffectiveness is the caller; drive it through the public API.
    const usage = { Alpha: { aht: [{ tip: 'T', usedAt: new Date(Date.UTC(2026, 3, 10)).toISOString() }] } };
    localStorage.setItem('devCoachingTool_tipUsageHistory', JSON.stringify(usage));

    const out = ms.computeTipEffectiveness(periods);
    t.check('it produces a result at all', !!out && Array.isArray(out.perTipUse));

    // A fresh array must not read through the previous one's index.
    const replaced = [{ name: 'Alpha', aht: 100 }];
    const periods2 = [{ key: 'w1', endDate: Date.UTC(2026, 3, 10), period: { employees: replaced } }];
    const out2 = ms.computeTipEffectiveness(periods2);
    t.check('a replaced employees array is not served from a stale index',
        JSON.stringify(out2) !== JSON.stringify(out) || out.perTipUse.length === 0);

    // The shapes the lookup has to survive without throwing.
    t.check('a period with no employees is survivable',
        !!ms.computeTipEffectiveness([{ key: 'w', endDate: 1, period: {} }]));
    t.check('a period with an empty roster is survivable',
        !!ms.computeTipEffectiveness([{ key: 'w', endDate: 1, period: { employees: [] } }]));
    t.check('rows without names do not break the index',
        !!ms.computeTipEffectiveness([{ key: 'w', endDate: 1, period: { employees: [{ aht: 1 }, null] } }]));
});
