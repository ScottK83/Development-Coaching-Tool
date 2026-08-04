'use strict';

const { suite } = require('./harness');

// Regression cover for the bug that started all this: the monthly cheer
// rebuilt "July" from weekly uploads bucketed by END date — roughly Jun 29
// through Jul 26 — and ignored a real July monthly upload entirely. Christi's
// transfer rate was quoted at 4.8% when the uploaded July report said 5.90%.

function period(start, end, transfers, calls, type) {
    return {
        metadata: { startDate: start, endDate: end, periodType: type || 'week' },
        employees: [{ name: 'Christi Test', transfers, totalCalls: calls, surveyTotal: 40 }]
    };
}

function baseWeeks() {
    return {
        '2026-06-01|2026-06-07': period('2026-06-01', '2026-06-07', 8.4, 500),
        '2026-06-08|2026-06-14': period('2026-06-08', '2026-06-14', 8.4, 500),
        '2026-06-15|2026-06-21': period('2026-06-15', '2026-06-21', 8.4, 500),
        '2026-06-22|2026-06-28': period('2026-06-22', '2026-06-28', 8.4, 500),
        // Ends in July but is mostly June — the bucketing quirk.
        '2026-06-29|2026-07-05': period('2026-06-29', '2026-07-05', 4.8, 500),
        '2026-07-06|2026-07-12': period('2026-07-06', '2026-07-12', 4.8, 500),
        '2026-07-13|2026-07-19': period('2026-07-13', '2026-07-19', 4.8, 500),
        '2026-07-20|2026-07-26': period('2026-07-20', '2026-07-26', 4.8, 500),
        // Ends in August, so the rebuild drops it out of July entirely.
        '2026-07-27|2026-08-02': period('2026-07-27', '2026-08-02', 12.0, 500)
    };
}

function setup(t, weekly) {
    t.installFakeBrowser();
    global.weeklyData = weekly;
    global.window.METRICS_REGISTRY = {
        transfers: { key: 'transfers', label: 'Transfers', icon: '🔄', isReverse: true }
    };
    global.window.formatMetricDisplay = (k, v) => v.toFixed(1) + '%';
    global.window.DevCoachModules.metricProfiles = {
        TARGETS_BY_YEAR: { 2026: { transfers: { type: 'max', meet: 6 } } }
    };
    global.window.DevCoachModules.futures = {
        buildFuturesData: () => ({
            employees: [{ name: 'Christi Test', metrics: {}, dataSource: 'test' }],
            weekInfo: { currentYear: 2026, weeksCompleted: 31, weeksRemaining: 21 }
        })
    };
    global.getEmployeeNickname = (n) => n.split(' ')[0];
    return t.loadModule('modules/cheerleading.module.js').cheerleading;
}

suite('cheers — a real monthly upload outranks the weekly rebuild', (t) => {
    const weekly = baseWeeks();
    weekly['2026-06-01|2026-06-30'] = period('2026-06-01', '2026-06-30', 8.4, 2200, 'month');
    weekly['2026-07-01|2026-07-31'] = period('2026-07-01', '2026-07-31', 5.9, 2300, 'month');

    const data = setup(t, weekly).buildCheerData();
    const p = data.periods;

    t.equal('compares June to July', `${p.monPrev} -> ${p.monCur}`, '2026-06 -> 2026-07');
    t.equal('July comes from the upload', p.monFromUpload['2026-07'], true);
    t.equal('  and uses exactly that one period', p.monthsMap[p.monCur].join(), '2026-07-01|2026-07-31');

    const text = data.people[0].cheers.map((c) => c.text).join(' ');
    t.check('quotes 5.9%, the figure on the uploaded report', text.includes('5.9%'));
    t.check('does not quote the rebuilt 4.8%', !text.includes('4.8%'));
});

suite('cheers — falls back to the rebuild when no month was uploaded', (t) => {
    const data = setup(t, baseWeeks()).buildCheerData();
    const p = data.periods;

    t.equal('still compares June to July', `${p.monPrev} -> ${p.monCur}`, '2026-06 -> 2026-07');
    t.equal('nothing is marked as upload-backed', Object.keys(p.monFromUpload).length, 0);
    // Documents the quirk rather than pretending it away: "July" here means
    // the weeks ENDING in July.
    t.equal('the July bucket is the four weeks ending in July', p.monthsMap['2026-07'].length, 4);
    t.check('the week ending Aug 2 is excluded', !p.monthsMap['2026-07'].includes('2026-07-27|2026-08-02'));
});

suite('cheers — a thin month-to-date upload cannot stand in for the month', (t) => {
    const weekly = baseWeeks();
    weekly['2026-06-01|2026-06-30'] = period('2026-06-01', '2026-06-30', 8.4, 2200, 'month');
    weekly['2026-07-01|2026-07-31'] = period('2026-07-01', '2026-07-31', 5.9, 2300, 'month');
    // Three days of August must not become "so far in August".
    weekly['2026-08-01|2026-08-03'] = period('2026-08-01', '2026-08-03', 1.1, 90, 'month');

    const p = setup(t, weekly).buildCheerData().periods;
    t.equal('July is still the current month', p.monCur, '2026-07');
    t.check('the 3-day August upload is ignored', !p.monFromUpload['2026-08']);
});
