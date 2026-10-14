'use strict';

const { suite } = require('./harness');

/**
 * NO HANDLE TIME IS NO CALLS
 *
 * Scott, 2026-10-14: "If they have 0 AHT, then they couldn't have taken
 * calls." A 0s handle time sits under the 426s goal, so read as a number it
 * was a win, and somebody who was out all week could be praised for it. The
 * private messages now write nothing about a period with no calls behind it.
 */
const OCT = '2026-10-05|2026-10-11';
const SEPT = '2026-09-28|2026-10-04';

const REGISTRY = {
    scheduleAdherence: { label: 'Schedule Adherence', unit: '%', isReverse: false, target: { type: 'min', value: 93 } },
    aht: { label: 'Average Handle Time', unit: 'sec', isReverse: true, target: { type: 'max', value: 426 } }
};

function load(t, latestRow) {
    t.installFakeBrowser();
    const base = { name: 'Lupe Garcia', totalCalls: 240, aht: 450, scheduleAdherence: 94 };
    global.weeklyData = {
        [SEPT]: { metadata: { periodType: 'week', startDate: '2026-09-28', endDate: '2026-10-04' }, employees: [base] },
        [OCT]: { metadata: { periodType: 'week', startDate: '2026-10-05', endDate: '2026-10-11' }, employees: [Object.assign({ name: 'Lupe Garcia' }, latestRow)] }
    };
    global.ytdData = {};
    global.dailyData = {};
    global.METRICS_REGISTRY = REGISTRY;
    global.window.METRICS_REGISTRY = REGISTRY;
    global.isReverseMetric = key => Boolean(REGISTRY[key] && REGISTRY[key].isReverse);
    global.window.analyzeTrendMetrics = (emp) => ({
        allMetrics: [
            { metricKey: 'aht', label: 'Average Handle Time', employeeValue: parseFloat(emp.aht) || 0, target: 426, targetType: 'max', classification: 'Exceeding Expectation', meetsTarget: true },
            { metricKey: 'scheduleAdherence', label: 'Schedule Adherence', employeeValue: 94, target: 93, targetType: 'min', classification: 'On Track', meetsTarget: true }
        ]
    });
    return t.loadModule('modules/morning-pulse.module.js').morningPulse;
}

suite('no calls: what counts as no calls', (t) => {
    const pulse = load(t, { totalCalls: 0, aht: 0, scheduleAdherence: 94 });
    t.check('a 0s handle time is no calls', pulse.tookNoCalls({ aht: 0, totalCalls: 12 }));
    t.check('so is a 0 written as text', pulse.tookNoCalls({ aht: '0' }));
    t.check('no handle time and 0 calls is no calls', pulse.tookNoCalls({ aht: '', totalCalls: 0 }));
    t.check('a real handle time is calls', !pulse.tookNoCalls({ aht: 410, totalCalls: 0 }));
    t.check('nothing to go on is not a verdict', !pulse.tookNoCalls({ aht: '', totalCalls: '' }));
});

suite('no calls: the private messages write nothing', async (t) => {
    const pulse = load(t, { totalCalls: 0, aht: 0, scheduleAdherence: 94 });
    const opts = { now: new Date(2026, 9, 14, 9), dayWord: 'Wednesday', startsTheWeek: false };
    t.equal('no kickoff', await pulse.generateMondayKickoffMessage('Lupe Garcia', OCT, SEPT, opts), null);
    t.equal('no high five', await pulse.generateHighFiveMessage('Lupe Garcia', OCT, SEPT, opts), null);
    t.equal('no check-in', await pulse.generateCheckinMessage('Lupe Garcia', OCT, SEPT, opts), null);
});

suite('no calls: a real week still gets its message', async (t) => {
    const pulse = load(t, { totalCalls: 230, aht: 420, scheduleAdherence: 94 });
    const msg = await pulse.generateMondayKickoffMessage('Lupe Garcia', OCT, SEPT, { now: new Date(2026, 9, 14, 9), dayWord: 'Wednesday', startsTheWeek: false });
    t.check('the kickoff is written', typeof msg === 'string' && msg.length > 0);
});
