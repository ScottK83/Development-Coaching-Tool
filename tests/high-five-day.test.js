'use strict';

const { suite } = require('./harness');

/**
 * The high five is written whenever the week backs one, which is usually not a
 * Friday. It used to sign off with "had to send you this before the weekend"
 * and "go relax, you've earned it" no matter the day, so a Thursday shout-out
 * read like a copy-paste of somebody else's Friday.
 */

const WINS = [
    { metricKey: 'adherence', label: 'Schedule Adherence', employeeValue: 95.1, target: 92, targetType: 'min', classification: 'Exceeding Expectation', meetsTarget: true },
    { metricKey: 'holdTime', label: 'Hold Time', employeeValue: 1, target: 30, targetType: 'max', classification: 'Exceeding Expectation', meetsTarget: true },
    { metricKey: 'positiveWord', label: 'Positive Word', employeeValue: 100, target: 90, targetType: 'min', classification: 'On Track', meetsTarget: true },
    { metricKey: 'overallSentiment', label: 'Overall Sentiment', employeeValue: 95.5, target: 90, targetType: 'min', classification: 'On Track', meetsTarget: true }
];

function loadPulse(t) {
    t.installFakeBrowser();
    global.weeklyData = { wk: { employees: [{ name: 'Christi Reyes' }], metadata: { endDate: '2026-08-15' } } };
    global.window.analyzeTrendMetrics = () => ({ allMetrics: WINS });
    return t.loadModule('modules/morning-pulse.module.js').morningPulse;
}

// Thursday 2026-08-20 and Friday 2026-08-21.
const THURSDAY = new Date(2026, 7, 20);
const FRIDAY = new Date(2026, 7, 21);

const WEEKEND_TALK = /weekend|days off|go relax|rest up|see you monday|head out|week end|wrapping up the week|ending the week/i;

suite('high five: a Thursday shout-out does not sign off for the weekend', async (t) => {
    const pulse = loadPulse(t);

    // The pools are random, so one draw proves nothing. Draw enough that a
    // weekend line would have to show up if it were still reachable.
    const drawn = [];
    for (let i = 0; i < 200; i++) {
        drawn.push(await pulse.generateHighFiveMessage('Christi Reyes', 'wk', null, { now: THURSDAY }));
    }

    const leaked = drawn.filter(m => WEEKEND_TALK.test(m));
    t.equal('no draw mentions the weekend', leaked.length, 0);
    t.check('and something was actually written', drawn[0].indexOf('Christi') > -1);

    // Losing the weekend lines must not leave two openers on rotation.
    const openers = new Set(drawn.map(m => m.split('\n')[0].split('!')[0]));
    t.check('the weekday pool still has variety', openers.size >= 6);
});

suite('high five: Friday can still send them into the weekend', async (t) => {
    const pulse = loadPulse(t);

    const drawn = [];
    for (let i = 0; i < 200; i++) {
        drawn.push(await pulse.generateHighFiveMessage('Christi Reyes', 'wk', null, { now: FRIDAY }));
    }

    t.check('the weekend wording is back in rotation', drawn.some(m => WEEKEND_TALK.test(m)));
});

suite('high five: which days count as the weekend being in reach', (t) => {
    const pulse = loadPulse(t);

    t.check('Monday is not', pulse.weekendIsInReach(new Date(2026, 7, 17)) === false);
    t.check('Wednesday is not', pulse.weekendIsInReach(new Date(2026, 7, 19)) === false);
    t.check('Thursday is not', pulse.weekendIsInReach(THURSDAY) === false);
    t.check('Friday is', pulse.weekendIsInReach(FRIDAY) === true);
    t.check('Saturday is', pulse.weekendIsInReach(new Date(2026, 7, 22)) === true);
    t.check('Sunday is', pulse.weekendIsInReach(new Date(2026, 7, 23)) === true);
});
