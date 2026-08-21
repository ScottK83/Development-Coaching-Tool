'use strict';

const { suite, ROOT } = require('./harness');

/**
 * When the high five is written, and which week it claims to be about.
 *
 * It used to sign off with "had to send you this before the weekend" and "go
 * relax, you've earned it" no matter the day, so a Thursday shout-out read
 * like a copy-paste of somebody else's Friday. It also called the numbers
 * "this week" when a weekly upload only lands after the week closes, dating
 * the message a week early.
 */

const WINS = [
    { metricKey: 'adherence', label: 'Schedule Adherence', employeeValue: 95.1, target: 92, targetType: 'min', classification: 'Exceeding Expectation', meetsTarget: true },
    { metricKey: 'holdTime', label: 'Hold Time', employeeValue: 1, target: 30, targetType: 'max', classification: 'Exceeding Expectation', meetsTarget: true },
    { metricKey: 'positiveWord', label: 'Positive Word', employeeValue: 100, target: 90, targetType: 'min', classification: 'On Track', meetsTarget: true },
    { metricKey: 'overallSentiment', label: 'Overall Sentiment', employeeValue: 95.5, target: 90, targetType: 'min', classification: 'On Track', meetsTarget: true }
];

const REGISTRY = {
    averageHandleTime: { label: 'Average Handle Time', unit: 'sec', isReverse: true, target: { type: 'max', value: 480 } }
};

// A week that closed on Friday 2026-08-14, and the one before it.
function loadPulse(t, endDate) {
    t.installFakeBrowser();
    global.weeklyData = {
        prev: { employees: [{ name: 'Christi Reyes', totalCalls: 240, averageHandleTime: 617 }], metadata: { endDate: '2026-08-07' } },
        wk: { employees: [{ name: 'Christi Reyes', totalCalls: 250, averageHandleTime: 415 }], metadata: { endDate: endDate || '2026-08-14' } }
    };
    global.METRICS_REGISTRY = REGISTRY;
    global.window.METRICS_REGISTRY = REGISTRY;
    global.isReverseMetric = key => Boolean(REGISTRY[key] && REGISTRY[key].isReverse);
    global.metricDelta = (key, latest, base) => (REGISTRY[key] && REGISTRY[key].isReverse ? base - latest : latest - base);
    global.window.analyzeTrendMetrics = () => ({ allMetrics: WINS });
    return t.loadModule('modules/morning-pulse.module.js').morningPulse;
}

// Thursday 2026-08-20 and Friday 2026-08-21.
const THURSDAY = new Date(2026, 7, 20);
const FRIDAY = new Date(2026, 7, 21);

const WEEKEND_TALK = /weekend|days off|go relax|rest up|see you monday|head out|let the week end|ending the week/i;

async function draw(pulse, now, times) {
    const out = [];
    for (let i = 0; i < times; i++) {
        out.push(await pulse.generateHighFiveMessage('Christi Reyes', 'wk', 'prev', { now }));
    }
    return out;
}

suite('high five: a Thursday shout-out does not sign off for the weekend', async (t) => {
    const pulse = loadPulse(t);

    // The pools are random, so one draw proves nothing. Draw enough that a
    // weekend line would have to show up if it were still reachable.
    const drawn = await draw(pulse, THURSDAY, 200);

    t.equal('no draw mentions the weekend', drawn.filter(m => WEEKEND_TALK.test(m)).length, 0);
    t.check('and something was actually written', drawn[0].indexOf('Christi') > -1);

    // Losing the weekend lines must not leave two openers on rotation.
    const openers = new Set(drawn.map(m => m.split('\n')[0].split('!')[0]));
    t.check('the weekday pool still has variety', openers.size >= 6);
});

suite('high five: Friday can still send them into the weekend', async (t) => {
    const pulse = loadPulse(t);
    const drawn = await draw(pulse, FRIDAY, 200);

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

suite('high five: names the week the upload is actually about', (t) => {
    const pulse = loadPulse(t);
    const period = end => ({ metadata: { endDate: end } });

    // Read on Thursday 8/20, so the current week started Monday 8/17.
    const closed = pulse.describeWeekRecency('wk', period('2026-08-14'), THURSDAY);
    t.equal('a week that already closed is last week', closed.when, 'last week');
    t.equal('and its baseline is two weeks ago', closed.prior, 'two weeks ago');

    const live = pulse.describeWeekRecency('wk', period('2026-08-19'), THURSDAY);
    t.equal('a week still in flight is this week', live.when, 'this week');
    t.equal('and its baseline is last week', live.prior, 'last week');

    const stale = pulse.describeWeekRecency('wk', period('2026-07-24'), THURSDAY);
    t.check('anything older gets dated outright', stale.when.indexOf('the week ending') === 0);
    t.equal('against the week before it', stale.prior, 'the week before');

    // No end date to judge by is not a licence to guess.
    const blind = pulse.describeWeekRecency('wk', null, THURSDAY);
    t.equal('an undatable upload keeps the old wording', blind.when, 'this week');
});

suite('high five: the numbers are not called this week when they are last week', async (t) => {
    const pulse = loadPulse(t);
    const drawn = await draw(pulse, THURSDAY, 200);

    t.equal('nothing claims to be this week', drawn.filter(m => /this week/i.test(m)).length, 0);
    t.check('the week is named instead', drawn.some(m => /last week/i.test(m)));

    // The jump line is where the two weeks sit next to each other, so it is
    // the one that read wrong: "last week's 617s to this week's 415s".
    const jump = drawn.find(m => m.indexOf('down from') > -1);
    t.check('the comparison is written', Boolean(jump));
    t.check('it dates the older number', jump.indexOf('617s two weeks ago') > -1);
    t.check('and the newer one', jump.indexOf('415s last week') > -1);
    t.check('the improvement is still the headline', jump.indexOf('-202s') > -1);
});

suite('high five: an in-flight week still reads as this week', async (t) => {
    const pulse = loadPulse(t, '2026-08-19');
    const drawn = await draw(pulse, THURSDAY, 60);

    const jump = drawn.find(m => m.indexOf('down from') > -1);
    t.check('the comparison is written', Boolean(jump));
    t.check('the older number is last week', jump.indexOf('617s last week') > -1);
    t.check('and the live one is this week', jump.indexOf('415s this week') > -1);
});

/**
 * A month is not a week.
 *
 * The recency label is what every message calls the stretch of time it just
 * described, and it only ever spoke in weeks. Point the period picker at a
 * month to date and the high five said "this week" over an Aug 1 to Aug 17
 * range, which is the same defect the shout-out post had.
 */
suite('high five: names the period by its own shape', (t) => {
    const pulse = loadPulse(t);
    const of = (type, end) => ({ metadata: { periodType: type, endDate: end } });

    const mtd = pulse.describeWeekRecency('k', of('month-to-date', '2026-08-17'), THURSDAY);
    t.equal('a month to date is a month', mtd.when, 'this month');
    t.equal('and it compares against last month', mtd.prior, 'last month');

    t.equal('a finished month is too',
        pulse.describeWeekRecency('k', of('month', '2026-07-31'), THURSDAY).when, 'this month');
    t.equal('a rebuilt month as well',
        pulse.describeWeekRecency('k', of('month-agg', '2026-07-31'), THURSDAY).when, 'this month');
    t.equal('a quarter is a quarter',
        pulse.describeWeekRecency('k', of('quarter', '2026-06-30'), THURSDAY).when, 'this quarter');
    t.equal('year to date is the year',
        pulse.describeWeekRecency('k', of('ytd', '2026-08-16'), THURSDAY).when, 'this year');
    t.equal('and a day file is a day',
        pulse.describeWeekRecency('k', of('daily', '2026-08-17'), THURSDAY).when, 'that day');

    // The week rules are untouched, including the dating of an older one.
    t.equal('a week in flight still reads as this week',
        pulse.describeWeekRecency('k', of('week-in-progress', '2026-08-19'), THURSDAY).when, 'this week');
    t.equal('and a finished one as last week',
        pulse.describeWeekRecency('k', of('week', '2026-08-14'), THURSDAY).when, 'last week');
    t.check('an older week is still dated outright',
        pulse.describeWeekRecency('k', of('week', '2026-07-24'), THURSDAY).when.indexOf('the week ending') === 0);
});

suite('high five: the praise does not claim a week it cannot see', (t) => {
    // Read as text, because the point is what is in the pools rather than which
    // one a given run happens to draw. A phrase asserting the stretch just
    // described was a week is wrong on a month, a quarter or the year.
    const fs = require('fs');
    const path = require('path');
    const source = fs.readFileSync(path.join(ROOT, 'modules', 'morning-pulse.module.js'), 'utf8');

    [
        'What a week',
        'highlight your week',
        'Pulled your week up',
        'heck of a week',
        'kind of week you want',
        'highlight of your week',
        'all-around great week',
        'the perfect week',
        'Heck of a week',
        'stacking weeks',
        'top a week like that',
        'grinding this week',
        'Solid week',
        'Nice work this week',
        'good one this week',
        'Go have a great week'
    ].forEach(phrase => {
        t.check('no pool still says "' + phrase + '"', source.indexOf(phrase) === -1);
    });

    // What stays: a turn of phrase that claims nothing about the period in
    // hand, and anything gated on the weekend actually being in reach, which is
    // a fact about the calendar rather than about the upload.
    t.check('a general turn of phrase is left alone', source.indexOf('Some weeks the numbers') > -1);
    t.check('and the weekend sign-offs are untouched', source.indexOf('Have a great weekend') > -1);
});
