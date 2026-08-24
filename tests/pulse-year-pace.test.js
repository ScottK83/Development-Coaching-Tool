'use strict';

const { suite } = require('./harness');

/**
 * The Monday message and the Futures table answer the same question about the
 * same person on the same morning, and one of the two gets copied into a DM.
 * When they disagree, the associate is the one left holding two numbers.
 *
 * They disagreed on the week count. futures.estimateWeekCounts answers "how
 * many weekly files are on disk for this year", the Futures table stopped
 * asking it that and started reading the weeks off the YTD upload's closing
 * date, and the Monday pace sentence carried on calling the raw helper. Twelve
 * weekly files beside a YTD file that closed in late July had the message
 * offering forty more weeks of a year with twenty-two left in it, and computing
 * the average it asked the associate to hold against forty weeks of call volume
 * the calendar does not contain.
 *
 * The direction of that error is the reason this file exists rather than a
 * single assertion on a number. Inflating the volume still to come always drags
 * the required average toward the target, so the ask always came out softer
 * than the truth, and the gate that refuses to print an ask better than the
 * associate's best posted week waves a softened ask straight through. The bug
 * did not only misstate a figure. It manufactured the sentence that gate exists
 * to withhold.
 */

const YEAR = new Date().getFullYear();

// Dates built from a day of the year rather than a month and a day, so the
// fixtures land on the same week number in a leap year as in an ordinary one.
function isoDay(dayOfYear) {
    const d = new Date(Date.UTC(YEAR, 0, 1) + (dayOfYear - 1) * 86400000);
    return d.toISOString().slice(0, 10);
}

// Pinned here rather than read out of metric-profiles, so a target change in a
// later plan year cannot quietly rewrite what these assertions mean.
const PROFILES = {
    TARGETS_BY_YEAR: {
        [YEAR]: {
            aht: { type: 'max', value: 426 },
            scheduleAdherence: { type: 'min', value: 93 }
        }
    },
    RATING_BANDS_BY_YEAR: { [YEAR]: {} }
};

/**
 * Twelve finished weeks at the front of the year, all the same size, with one
 * week posted better than the rest.
 *
 * The best week is load bearing rather than decorative: it is the ceiling the
 * pace sentence is checked against, and both defects below turn on where the
 * ask falls relative to it.
 */
function twelveWeeks(name, opts) {
    const weekly = {};
    for (let i = 0; i < 12; i++) {
        const start = isoDay(5 + i * 7);
        const end = isoDay(11 + i * 7);
        const best = i === 11;
        weekly[start + '|' + end] = {
            metadata: { periodType: 'week', startDate: start, endDate: end },
            employees: [{
                name,
                totalCalls: opts.calls,
                surveyTotal: 12,
                aht: best && opts.bestAht ? opts.bestAht : 470,
                scheduleAdherence: best && opts.bestAdherence ? opts.bestAdherence : 90
            }]
        };
    }
    return weekly;
}

// A real YTD upload closing on a given day of a given year.
function ytdThrough(dayOfYear, employee, year) {
    const end = year
        ? new Date(Date.UTC(year, 0, 1) + (dayOfYear - 1) * 86400000).toISOString().slice(0, 10)
        : isoDay(dayOfYear);
    const start = (year || YEAR) + '-01-01';
    const store = {};
    store[start + '|' + end] = {
        metadata: { periodType: 'ytd', startDate: start, endDate: end, label: 'YTD through ' + end },
        employees: [employee]
    };
    return store;
}

// Seconds read as seconds and points as points, so an assertion on the printed
// sentence is an assertion about what the associate sees.
function display(key, value) {
    return key === 'aht' ? Math.round(Number(value)) + ' sec' : Number(value).toFixed(1) + '%';
}

function load(t, weekly, ytd) {
    t.installFakeBrowser();
    global.weeklyData = weekly || {};
    global.ytdData = ytd || {};

    const registry = t.loadModule('modules/metrics-registry.module.js');
    // morning-pulse reads isReverseMetric as a bare global, which a fake window
    // object cannot supply the way a real browser does.
    global.isReverseMetric = registry.metricsRegistryHelpers.isReverseMetric;
    global.window.getWeeklyKeysSorted = () => Object.keys(global.weeklyData).sort();
    global.window.getTeamMembersForWeek = () => [];
    global.window.formatMetricDisplay = display;
    global.window.analyzeTrendMetrics = () => ({ allMetrics: [] });

    const mods = t.loadModule('modules/futures.module.js');
    mods.metricProfiles = PROFILES;
    t.loadModule('modules/rank-projection.module.js');
    t.loadModule('modules/morning-pulse.module.js');
    return { futures: mods.futures, pulse: mods.morningPulse };
}

// One slipping year-standing line, shaped the way buildYearStandingBlock shapes
// it before handing it to the pace pass.
function slippingLine(rankKey, metricKey) {
    return { rankKey, metricKey, movement: 'slipping' };
}

function ytdMapOf(metricKey, employeeValue, target) {
    return new Map([[metricKey, { metricKey, employeeValue, target }]]);
}

suite('pulse year pace: the weeks come off the upload, not off the folder', (t) => {
    const emp = { name: 'Dana Reed', totalCalls: 6000, surveyTotal: 300, aht: 470, scheduleAdherence: 91.2 };
    const { futures, pulse } = load(t, twelveWeeks('Dana Reed', { calls: 200 }), ytdThrough(206, emp));

    const table = futures.buildFuturesData().weekInfo;
    const message = pulse.yearPaceWeekInfo();

    t.equal('the YTD file settles the week count for the message too', message.weeksCompleted, 30);
    t.equal('and what is left of the year', message.weeksRemaining, 22);
    t.equal('which is the count the futures table is using', message.weeksCompleted, table.weeksCompleted);
    t.equal('down to the weeks it has left', message.weeksRemaining, table.weeksRemaining);

    // The old answer, spelled out, because it is the one that reached an
    // associate: twelve files on disk read as twelve weeks of the year gone.
    t.check('rather than the twelve files on disk', message.weeksCompleted !== 12);
    t.check('and never the forty weeks that implies', message.weeksRemaining !== 40);

    // The weekly keys are still the weekly keys. Two things downstream read
    // them, the forward run rate and the best-week ceiling, and both are asking
    // what is actually on file rather than what the calendar says.
    t.equal('the weekly uploads still travel with the count', message.yearKeys.length, 12);

    // Deleting half the weekly folder changes what is known about the run rate
    // and nothing at all about how much of the year is gone.
    const keys = Object.keys(global.weeklyData);
    keys.slice(0, 6).forEach(k => { delete global.weeklyData[k]; });
    const thinner = pulse.yearPaceWeekInfo();
    t.equal('six fewer files is not six fewer weeks of the year', thinner.weeksCompleted, 30);
    t.equal('nor six more weeks left to fix things in', thinner.weeksRemaining, 22);
});

suite('pulse year pace: the message quotes the number on the table', (t) => {
    // Dana is slipping on adherence, is on 200 calls a week, and has one 96%
    // week on file, which is what makes a sentence printable at all.
    const emp = { name: 'Dana Reed', totalCalls: 6000, surveyTotal: 300, aht: 470, scheduleAdherence: 91.2 };
    const { futures, pulse } = load(
        t,
        twelveWeeks('Dana Reed', { calls: 200, bestAdherence: 96 }),
        ytdThrough(206, emp)
    );

    const entries = [slippingLine('adherence', 'scheduleAdherence')];
    pulse.attachYearPace(entries, 'Dana Reed', ytdMapOf('scheduleAdherence', 91.2, 93));
    const pace = entries[0].paceText || '';

    const table = futures.buildFuturesData();
    const required = table.employees[0].metrics.scheduleAdherence.requiredToMeet;
    t.equal('the table asks for 95.5%', Math.round(required * 100) / 100, 95.45);

    t.check('the message says something', pace.length > 0);
    t.check('and it is the table\'s number, formatted the same way',
        pace.indexOf(display('scheduleAdherence', required)) > -1);
    t.check('over the weeks the year actually has left', pace.indexOf('22 weeks') > -1);

    // What the file count would have printed instead. Both halves are wrong and
    // both halves are wrong in the associate's favour, which is why neither was
    // ever questioned: a softer ask over a longer run reads like good news.
    const fileCountAsk = futures.calculateRequiredAverage(91.2, 12, 40, 93, { done: 6000, remaining: 200 * 40 });
    t.equal('the twelve-file answer would have been 94.4%', Math.round(fileCountAsk * 100) / 100, 94.35);
    t.check('and the message does not carry it', pace.indexOf(display('scheduleAdherence', fileCountAsk)) === -1);
    t.check('nor the forty-week stretch it came with', pace.indexOf('40 weeks') === -1);

    // The whole sentence, so that a change to the copy has to be made on purpose.
    t.equal('the line as it lands',
        pace,
        '22 weeks at 95.5% brings the year to 93.0%. That is over the line, and holding it keeps it there.');
});

suite('pulse year pace: an ask nobody has ever posted stays unsaid', (t) => {
    /*
     * The case that made this more than a wrong number.
     *
     * Dana has 6,000 calls banked at 470 seconds and is now on 90-call weeks, so
     * the twenty-two weeks left are worth 1,980 calls against the 6,000 already
     * on the books, and the honest ask is 293 seconds. Dana's best week all year
     * is 340. There is no sentence to write here: the year is out of reach on
     * this metric and the ceiling check exists to say nothing rather than ask
     * for something nobody has ever done.
     *
     * Counting files instead put forty weeks and 3,600 calls in front of Dana,
     * which softens the ask to 353 seconds, and 353 is worse than the 340 week
     * Dana has actually posted, so the ceiling let it through. The associate got
     * "40 weeks at 353 sec brings the year to 426 sec. That is over the line,
     * and holding it keeps it there." in a Monday DM, in a year with twenty-two
     * weeks left in it.
     */
    const emp = { name: 'Dana Reed', totalCalls: 6000, surveyTotal: 300, aht: 470, scheduleAdherence: 91.2 };
    const { futures, pulse } = load(
        t,
        twelveWeeks('Dana Reed', { calls: 90, bestAht: 340 }),
        ytdThrough(206, emp)
    );

    const entries = [slippingLine('aht', 'aht')];
    pulse.attachYearPace(entries, 'Dana Reed', ytdMapOf('aht', 470, 426));
    t.check('no pace sentence is written at all', !entries[0].paceText);

    // Both asks, so the inversion is on the record rather than inferred.
    const honest = futures.calculateRequiredAverage(470, 30, 22, 426, { done: 6000, remaining: 90 * 22 });
    const fileCount = futures.calculateRequiredAverage(470, 12, 40, 426, { done: 6000, remaining: 90 * 40 });
    t.equal('the honest ask is 292.67 seconds', Math.round(honest * 100) / 100, 292.67);
    t.equal('the file-counted ask is 352.67', Math.round(fileCount * 100) / 100, 352.67);
    t.check('which is the softer of the two', fileCount > honest);
    t.check('the honest ask is better than the best week on file', honest < 340);
    t.check('and the softened one is not, so it cleared the ceiling', fileCount > 340);

    // The table lands on the same honest number, which is the point: the two
    // surfaces agree, and it is the message that then declines to ask for it.
    // A manager reading 293 seconds off a table can weigh it against everything
    // else they know about Dana's schedule. A DM saying "hold 293" cannot.
    const aht = futures.buildFuturesData().employees[0].metrics.aht;
    t.equal('the table asks for the honest number', Math.round(aht.requiredToMeet * 100) / 100, 292.67);
    t.check('which is better than any week Dana has posted', aht.requiredToMeet < 340);
});

suite('pulse year pace: no week count, no sentence', (t) => {
    const emp = { name: 'Dana Reed', totalCalls: 6000, surveyTotal: 300, aht: 470, scheduleAdherence: 91.2 };

    // Nothing to date the year against. The failure mode has to be silence, not
    // a fallback to whatever the upload folder happens to hold.
    const bare = load(t, twelveWeeks('Dana Reed', { calls: 200, bestAdherence: 96 }), {});
    t.equal('no YTD upload yields no week count', bare.pulse.yearPaceWeekInfo(), null);
    const noYtd = [slippingLine('adherence', 'scheduleAdherence')];
    bare.pulse.attachYearPace(noYtd, 'Dana Reed', ytdMapOf('scheduleAdherence', 91.2, 93));
    t.check('and no pace sentence', !noYtd[0].paceText);

    // Last year's upload against this year's calendar is not a pace. It would
    // otherwise report a year half spent and offer twenty-six weeks that have
    // already been and gone.
    const stale = load(
        t,
        twelveWeeks('Dana Reed', { calls: 200, bestAdherence: 96 }),
        ytdThrough(180, emp, YEAR - 1)
    );
    t.equal('a YTD file from a year already over yields nothing', stale.pulse.yearPaceWeekInfo(), null);

    // December leaves nothing to project into, and the count says so rather than
    // going negative and flipping the sign on the ask.
    const december = load(t, twelveWeeks('Dana Reed', { calls: 200, bestAdherence: 96 }), ytdThrough(363, emp));
    const spent = december.pulse.yearPaceWeekInfo();
    t.equal('late December is a full year of weeks', spent.weeksCompleted, 52);
    t.equal('with nothing left', spent.weeksRemaining, 0);
    const tooLate = [slippingLine('adherence', 'scheduleAdherence')];
    december.pulse.attachYearPace(tooLate, 'Dana Reed', ytdMapOf('scheduleAdherence', 91.2, 93));
    t.check('and a year with no weeks left gets no pace sentence', !tooLate[0].paceText);
});
