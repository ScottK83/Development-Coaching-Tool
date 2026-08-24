'use strict';

const { suite } = require('./harness');

/**
 * The Futures screen answers one question: what does the rest of the year have
 * to look like. Two things it got wrong were invisible from the screen itself,
 * because a wrong required average looks exactly like a right one.
 *
 *  - It blended the year by week count. YTD values in this app are volume
 *    weighted, so week counting is only correct when every week carries the same
 *    number of calls, and the error is largest on the metric people are coached
 *    on hardest.
 *  - It counted weeks by counting weekly files. A YTD upload closing in July
 *    beside a dozen weekly files reported the year as barely started, and with no
 *    YTD file at all it counted uploads instead, so six monthly files reported six
 *    weeks done on the last day of June.
 *  - It weighted the call metrics by calls and left the three survey metrics
 *    weighted by week counts, because the aggregate row it built carried a call
 *    count and dropped the survey count. Two denominators, one table.
 */

const YEAR = new Date().getFullYear();

// Dates built from a day of the year rather than from a month and a day, so the
// fixtures land on the same week number in a leap year as in an ordinary one.
function isoDay(dayOfYear) {
    const d = new Date(Date.UTC(YEAR, 0, 1) + (dayOfYear - 1) * 86400000);
    return d.toISOString().slice(0, 10);
}

// The real 2026 numbers, pinned here rather than read out of metric-profiles, so
// that a target change in a later plan year cannot quietly rewrite what these
// assertions mean.
const PROFILES = {
    TARGETS_BY_YEAR: {
        [YEAR]: {
            aht: { type: 'max', value: 426 },
            scheduleAdherence: { type: 'min', value: 93 },
            fcr: { type: 'min', value: 73 }
        }
    },
    RATING_BANDS_BY_YEAR: {
        [YEAR]: {
            aht: { type: 'max', score3: { max: 414 }, score2: { max: 440 } }
        }
    }
};

function load(t, weekly, ytd) {
    t.installFakeBrowser();
    global.weeklyData = weekly || {};
    global.ytdData = ytd || {};
    t.loadModule('modules/metrics-registry.module.js');
    const M = t.loadModule('modules/futures.module.js');
    M.metricProfiles = PROFILES;
    global.window.getWeeklyKeysSorted = () => Object.keys(global.weeklyData).sort();
    global.window.getTeamMembersForWeek = () => [];
    global.window.formatMetricDisplay = (key, value) => String(value);
    return M.futures;
}

// Twelve finished weeks at the front of the year, each one a light 90-call week.
function twelveLightWeeks(name) {
    const weekly = {};
    for (let i = 0; i < 12; i++) {
        const start = isoDay(5 + i * 7);
        const end = isoDay(11 + i * 7);
        weekly[start + '|' + end] = {
            metadata: { periodType: 'week', startDate: start, endDate: end },
            employees: [{ name, totalCalls: 90, surveyTotal: 5, aht: 470, scheduleAdherence: 90 }]
        };
    }
    return weekly;
}

// A real YTD upload closing on the given day of the year.
function ytdThrough(dayOfYear, employee) {
    const end = isoDay(dayOfYear);
    const key = isoDay(1) + '|' + end;
    const store = {};
    store[key] = {
        metadata: { periodType: 'ytd', startDate: isoDay(1), endDate: end, label: 'YTD through ' + end },
        employees: [employee]
    };
    return store;
}

// Month boundaries read off the calendar rather than typed out, so February is
// the right length in a leap year and the fixture does not change shape every
// fourth year.
function monthStart(monthIndex) {
    return new Date(Date.UTC(YEAR, monthIndex, 1)).toISOString().slice(0, 10);
}
function monthEnd(monthIndex) {
    return new Date(Date.UTC(YEAR, monthIndex + 1, 0)).toISOString().slice(0, 10);
}

// Monthly uploads, first month through last inclusive, and no YTD file. This is
// not a corner of the app: the upload wizard offers a month upload and pitches it
// as a replacement for four or five weekly ones, and the auto-generated YTD the
// app writes for itself is deliberately skipped by findRealYtdUpload, so a folder
// of monthly files lands squarely on the weekly-aggregate branch.
function monthlyUploads(firstMonth, lastMonth) {
    const weekly = {};
    for (let m = firstMonth; m <= lastMonth; m++) {
        const start = monthStart(m);
        const end = monthEnd(m);
        const employees = [{ name: 'Dana Reed', totalCalls: 500, surveyTotal: 50, fcr: 70, scheduleAdherence: 90 }];
        // Nadia started in May, so most of these files do not mention her. The
        // year is twenty-six weeks old for her as well, but only nine of those
        // weeks are hers, and that is where volume weighting and week counting
        // stop agreeing with each other.
        if (m >= 4) {
            employees.push({ name: 'Nadia Ortiz', totalCalls: 500, surveyTotal: 50, fcr: 70, scheduleAdherence: 90 });
        }
        weekly[start + '|' + end] = {
            metadata: { periodType: 'month', startDate: start, endDate: end },
            employees
        };
    }
    return weekly;
}

// Quarterly uploads covering the same ground, because the wizard offers those too
// and they were counted the same way.
function quarterlyUploads(count) {
    const weekly = {};
    for (let q = 0; q < count; q++) {
        const start = monthStart(q * 3);
        const end = monthEnd(q * 3 + 2);
        weekly[start + '|' + end] = {
            metadata: { periodType: 'quarter', startDate: start, endDate: end },
            employees: [{ name: 'Dana Reed', totalCalls: 1500, surveyTotal: 150, fcr: 70, scheduleAdherence: 90 }]
        };
    }
    return weekly;
}

// Weekly uploads running from January 1, which is the shape the fallback branch
// was written for and the one it has to keep answering the same way.
function weeksFromNewYear(count) {
    const weekly = {};
    for (let i = 0; i < count; i++) {
        const start = isoDay(1 + i * 7);
        const end = isoDay(7 + i * 7);
        weekly[start + '|' + end] = {
            metadata: { periodType: 'week', startDate: start, endDate: end },
            employees: [{ name: 'Dana Reed', totalCalls: 90, surveyTotal: 5, fcr: 70, scheduleAdherence: 90 }]
        };
    }
    return weekly;
}

// What renderFutures actually writes into the page, so the year header can be read
// back as the sentence a person sees rather than inferred from the numbers behind
// it. Only the outer container exists, which is enough: the table renders into a
// second element and bows out when it is not there.
function renderedHtml(f) {
    global.document._els.futuresContent = { innerHTML: '' };
    f.renderFutures();
    return global.document._els.futuresContent.innerHTML;
}

function metricsFor(data, name) {
    return data.employees.filter((e) => e.name === name)[0].metrics;
}

suite('futures: the year is weighted by calls, not by weeks', (t) => {
    const f = load(t);

    // Dana has banked 6,000 calls at 470 seconds over thirty weeks and is now on
    // a 90-call week, so the twenty-two weeks left are worth 1,980 calls against
    // 6,000 already on the books.
    const weighted = f.calculateRequiredAverage(470, 30, 22, 426, { done: 6000, remaining: 1980 });
    const flat = f.calculateRequiredAverage(470, 30, 22, 426, null);

    t.equal('week counting asks for 366 seconds', Math.round(flat * 100) / 100, 366);
    t.equal('the calls actually ask for 292.67', Math.round(weighted * 100) / 100, 292.67);
    t.check('which is a different conversation entirely', Math.abs(weighted - flat) > 70);

    // And the week-counted answer is not merely different, it is wrong: run the
    // rest of the year at exactly the number it asks for and the year still
    // misses, because the aggregate Dana is judged by is weighted by calls.
    const yearEndOnFlat = (470 * 6000 + flat * 1980) / (6000 + 1980);
    t.equal('hitting the week-counted number still lands at 444.2', Math.round(yearEndOnFlat * 10) / 10, 444.2);
    t.check('which is over the 426 target, not on it', yearEndOnFlat > 426);

    // The weighted answer, run for the rest of the year, lands on the target.
    const yearEndOnWeighted = (470 * 6000 + weighted * 1980) / (6000 + 1980);
    t.equal('the weighted number lands on 426', Math.round(yearEndOnWeighted * 1000) / 1000, 426);

    // Equal weights are not wrong in themselves, they are a special case: when
    // the weeks ahead carry the same volume as the weeks behind, both agree.
    const evenVolume = f.calculateRequiredAverage(470, 30, 22, 426, { done: 6000, remaining: 6000 / 30 * 22 });
    t.equal('identical volume every week collapses to the old answer', Math.round(evenVolume * 100) / 100, 366);

    // Survey metrics are weighted by surveys and not by calls, and the survey
    // stream is thin: 110 more surveys against the 300 already in only moves the
    // year so far. Week counting quietly assumed 220 of them were coming.
    const surveyWeighted = f.calculateRequiredAverage(70, 30, 22, 73, { done: 300, remaining: 110 });
    t.equal('a thin survey stream makes the climb steeper', Math.round(surveyWeighted * 100) / 100, 81.18);
    t.check('steeper than week counting admitted',
        surveyWeighted > f.calculateRequiredAverage(70, 30, 22, 73, null));

    // It errs in both directions, which is why the fix is weights rather than a
    // fudge factor. Somebody back from leave into a heavy second half has more
    // volume ahead than behind, and week counting overstates that climb and talks
    // them out of a target still well within reach.
    const heavyFinish = f.calculateRequiredAverage(88, 30, 22, 93, { done: 1000, remaining: 4000 });
    t.equal('a heavy finish asks for 94.25', Math.round(heavyFinish * 100) / 100, 94.25);
    t.check('gentler than week counting claimed',
        heavyFinish < f.calculateRequiredAverage(88, 30, 22, 93, null));
});

suite('futures: an upload with no volume column still gets an answer', (t) => {
    const f = load(t);

    // A spreadsheet without a call-count column must not blank the screen, and
    // must not hand back NaN dressed up as a target. Equal weights is the honest
    // guess when nothing better is on file.
    const flat = 366;
    t.equal('no volume at all falls back to week counts', f.calculateRequiredAverage(470, 30, 22, 426, null), flat);
    t.equal('an empty volume object does too', f.calculateRequiredAverage(470, 30, 22, 426, {}), flat);
    t.equal('and unparseable volume does too',
        f.calculateRequiredAverage(470, 30, 22, 426, { done: 'n/a', remaining: 'n/a' }), flat);
    t.equal('as does a zero call count', f.calculateRequiredAverage(470, 30, 22, 426, { done: 0, remaining: 0 }), flat);

    // projectedVolume is the thing that decides, and it says so by returning null
    // rather than by inventing a weight of one.
    const weekInfo = { weeksCompleted: 30, weeksRemaining: 22 };
    t.equal('a row with no call count yields no weights',
        f.projectedVolume({ name: 'Dana Reed', aht: 470 }, null, 'aht', weekInfo), null);
    t.check('a row with a call count does yield weights',
        f.projectedVolume({ name: 'Dana Reed', totalCalls: 6000 }, null, 'aht', weekInfo) !== null);

    // End to end: a YTD file with no totalCalls anywhere still prints a number.
    const bare = load(t, {}, ytdThrough(206, { name: 'Dana Reed', aht: 470 }));
    const data = bare.buildFuturesData();
    const aht = data.employees[0].metrics.aht;
    t.check('the screen still has something to say', Number.isFinite(aht.requiredToMeet));
    t.equal('and it is the equal-weight answer', Math.round(aht.requiredToMeet * 100) / 100, 366);
});

suite('futures: weeks come off the YTD file, not off the file count', (t) => {
    // Twelve weekly uploads sitting beside a YTD file that closes at week 30.
    // The two disagree on purpose: that is the ordinary state of the folder,
    // because people upload the YTD file and stop bothering with the weeks.
    const emp = { name: 'Dana Reed', totalCalls: 6000, surveyTotal: 300, aht: 470, scheduleAdherence: 90 };
    const f = load(t, twelveLightWeeks('Dana Reed'), ytdThrough(206, emp));
    const data = f.buildFuturesData();

    t.equal('the YTD file settles the week count', data.weekInfo.weeksCompleted, 30);
    t.equal('and what is left of the year', data.weekInfo.weeksRemaining, 22);
    t.check('rather than the twelve files on disk', data.weekInfo.weeksCompleted !== 12);

    // The whole point of getting the count right. Read off twelve files, the
    // screen said 412.8 seconds, which is a stretch somebody could believe in.
    // The truth is 292.67, which is not reachable and needs a different plan.
    const aht = data.employees[0].metrics.aht;
    t.equal('the required average is the weighted one', Math.round(aht.requiredToMeet * 100) / 100, 292.67);
    t.equal('the twelve-file answer would have been 412.8',
        Math.round(f.calculateRequiredAverage(470, 12, 40, 426, null) * 100) / 100, 412.8);

    // The forward run rate is read from the weekly files, which is the only place
    // that knows Dana is on 90 calls a week now rather than the 200 a week the
    // YTD file averages out to.
    const rates = f.weeklyVolumeRates(data.weekInfo.yearKeys);
    t.equal('ninety calls a week is what the weeks say', Math.round(rates['Dana Reed'].callsPerWeek), 90);
    t.equal('so the rest of the year is worth 1980 calls', Math.round(aht.volume.remaining), 1980);
    t.equal('against 6000 already banked', aht.volume.done, 6000);

    // The date-to-week rule itself: whole weeks elapsed since January 1.
    t.equal('day 206 of the year is thirty weeks in', f.weeksCompletedThroughDate(isoDay(206)), 30);
    t.equal('the first day of the year is one week in', f.weeksCompletedThroughDate(isoDay(1)), 1);
    t.equal('an unreadable date yields no count', f.weeksCompletedThroughDate('sometime in July'), null);
});

suite('futures: the year never has less than none of it left', (t) => {
    // A YTD file dated in late December leaves nothing to project into. Any
    // arithmetic that let this go negative would flip the sign on every required
    // average on the screen and start telling people to get worse.
    const emp = { name: 'Dana Reed', totalCalls: 9000, surveyTotal: 400, aht: 470, scheduleAdherence: 90 };
    const f = load(t, twelveLightWeeks('Dana Reed'), ytdThrough(363, emp));
    const data = f.buildFuturesData();

    t.equal('late December is a full year of weeks', data.weekInfo.weeksCompleted, 52);
    t.equal('with nothing left', data.weekInfo.weeksRemaining, 0);
    t.check('and never below nothing', data.weekInfo.weeksRemaining >= 0);

    const aht = data.employees[0].metrics.aht;
    t.equal('a year with no weeks left asks for nothing', aht.requiredToMeet, null);

    // The clamp has to survive the calendar as well as the arithmetic. December 31
    // is day 366 in a leap year, which is a fifty-third week by any honest
    // division, and 52 is the number the rest of this screen counts against.
    t.equal('a leap year December 31 still clamps to 52', f.weeksCompletedThroughDate('2024-12-31'), 52);
    t.equal('and an ordinary one does too', f.weeksCompletedThroughDate('2026-12-31'), 52);

    // Nothing left means no answer rather than a nonsense one.
    t.equal('no weeks remaining yields null, not infinity', f.calculateRequiredAverage(470, 52, 0, 426, null), null);
});

suite('futures: the table and the check-in quote the same number', (t) => {
    // These were two copies of the same formula. Either could have been edited
    // alone, and then the table and the check-in summary would have printed
    // different required averages for the same person on the same afternoon.
    const emp = { name: 'Dana Reed', totalCalls: 6000, surveyTotal: 300, aht: 470, scheduleAdherence: 90 };
    const f = load(t, twelveLightWeeks('Dana Reed'), ytdThrough(206, emp));
    const data = f.buildFuturesData();
    const wi = data.weekInfo;
    const aht = data.employees[0].metrics.aht;

    // buildCheckInSummary calls calculateDailyTarget with exactly these arguments.
    const checkInNumber = f.calculateDailyTarget(
        aht.currentAvg, wi.weeksCompleted, wi.weeksRemaining, aht.meetTarget, aht.volume);
    t.equal('the check-in reproduces the table exactly', checkInNumber, aht.requiredToMeet);

    // Including the weights, which is the part that could drift silently: the
    // metric row carries them, so the check-in cannot be handed week counts while
    // the table is handed calls.
    t.check('the weights travel with the metric', aht.volume !== null && aht.volume.done === 6000);

    // And they agree on inputs the screen never produces, so the next person to
    // touch one of them is caught.
    const cases = [
        [470, 30, 22, 426, { done: 6000, remaining: 1980 }],
        [470, 30, 22, 426, null],
        [88, 4, 48, 93, { done: 500, remaining: 6000 }],
        [88, 0, 52, 93, null],
        [88, 52, 0, 93, null]
    ];
    cases.forEach((args, i) => {
        t.equal('the two agree on case ' + (i + 1),
            f.calculateDailyTarget.apply(null, args),
            f.calculateRequiredAverage.apply(null, args));
    });
});

suite('futures: a month of uploads is a month of the year', (t) => {
    // Six monthly files, the last closing on June 30, and no YTD file. The year is
    // half gone. The screen said six weeks done and forty-six to go, because it
    // counted the files it was handed instead of asking what date they ran to, and
    // a year with forty-six weeks left when twenty-six remain is not a rounding
    // error, it is a different year.
    const f = load(t, monthlyUploads(0, 5));
    const data = f.buildFuturesData();

    t.equal('half a year of monthly uploads is twenty-six weeks in', data.weekInfo.weeksCompleted, 26);
    t.equal('with twenty-six to go', data.weekInfo.weeksRemaining, 26);
    t.check('rather than the six files on disk', data.weekInfo.weeksCompleted !== 6);
    t.check('and the header a person reads says so too',
        renderedHtml(f).includes('26 weeks completed, 26 weeks remaining'));

    // The denominator is not decoration. It sets how much volume the rest of the
    // year is worth, and forty-six weeks of a hundred and sixteen calls is nearly
    // twice the year that is actually left.
    const dana = metricsFor(data, 'Dana Reed');
    t.equal('the weeks ahead are worth about what the weeks behind were',
        Math.round(dana.scheduleAdherence.volume.remaining / dana.scheduleAdherence.volume.done), 1);
    t.equal('so adherence asks for about 96', Math.round(dana.scheduleAdherence.requiredToMeet), 96);
    t.equal('where a six-week year asked for 94.7',
        Math.round(f.calculateRequiredAverage(90, 6, 46, 93,
            { done: 3000, remaining: dana.scheduleAdherence.volume.perWeek * 46 }) * 10) / 10, 94.7);

    // Quarters go through the same branch and were counted the same way.
    const quarters = load(t, quarterlyUploads(2));
    t.equal('two quarterly uploads are twenty-six weeks in',
        quarters.buildFuturesData().weekInfo.weeksCompleted, 26);

    // Weeks completed is time elapsed, not data on hand. Somebody who starts
    // uploading in April has thirteen weeks of files and half a year behind them,
    // and the half year is the honest denominator.
    const late = load(t, monthlyUploads(3, 5));
    t.equal('a late start does not rewind the calendar',
        late.buildFuturesData().weekInfo.weeksCompleted, 26);

    // The case the old code got right has to stay right: twelve weekly files from
    // January 1 are twelve weeks by the calendar as well as by the count, which is
    // exactly why counting them survived as long as it did.
    const weekly = load(t, weeksFromNewYear(12));
    const weeklyRun = weekly.buildFuturesData();
    t.equal('twelve weekly files are still twelve weeks', weeklyRun.weekInfo.weeksCompleted, 12);
    t.equal('with forty left', weeklyRun.weekInfo.weeksRemaining, 40);
});

suite('futures: the survey metrics are weighted like everything else on the row', (t) => {
    // The aggregate row carried a call count and dropped the survey count, so
    // projectedVolume found nothing where it looks for the survey weight and
    // returned null. cxRepOverall, fcr and overallExperience then fell back to
    // week counting while adherence, on the same row of the same table, was
    // blended by call volume. Nothing on screen said which row got which.
    const f = load(t, monthlyUploads(0, 5));
    const data = f.buildFuturesData();

    // Pinned at the source first, because this is the assertion that holds no
    // matter what the fixture looks like: the row shape decides whether a metric
    // gets weighted at all, and a column dropped here is invisible from every
    // surface that reads it.
    const agg = f.aggregateFromWeeklyData(data.weekInfo.yearKeys);
    const row = agg.employees.filter((e) => e.name === 'Dana Reed')[0];
    t.equal('the aggregate row carries the survey column', row.surveyTotal, 300);
    t.equal('beside the call column that was never dropped', row.totalCalls, 3000);
    t.equal('and reports the date its periods close on', agg.coverageEndText, monthEnd(5));

    const nadia = metricsFor(data, 'Nadia Ortiz');
    t.check('fcr has weights at all', nadia.fcr.volume !== null);
    t.equal('a hundred surveys are banked', nadia.fcr.volume.done, 100);
    t.equal('and the surveys ahead cover the same stretch of year the calls do',
        Math.round((nadia.fcr.volume.remaining / nadia.fcr.volume.done) * 1e6) / 1e6,
        Math.round((nadia.scheduleAdherence.volume.remaining / nadia.scheduleAdherence.volume.done) * 1e6) / 1e6);

    // Nadia started in May, so nine weeks of hers sit behind twenty-six still to
    // come and the weights look nothing like the week counts. The surveys ask for
    // 74.01. Week counting asks for 76, and the number that actually shipped was
    // 73.39, which was week counting on top of a six-week year.
    t.equal('the surveys ask for 74.01', Math.round(nadia.fcr.requiredToMeet * 100) / 100, 74.01);
    t.equal('week counting would have asked for 76',
        f.calculateRequiredAverage(70, 26, 26, 73, null), 76);
    t.check('which is a two-point difference on a metric coached in tenths',
        Math.abs(nadia.fcr.requiredToMeet - 76) > 1.9);

    // The check-in summary reads the weights off the metric row, so a survey
    // metric cannot be quoted one number in the table and another in the modal.
    const wi = data.weekInfo;
    t.equal('the check-in quotes the table exactly',
        f.calculateDailyTarget(nadia.fcr.currentAvg, wi.weeksCompleted, wi.weeksRemaining,
            nadia.fcr.meetTarget, nadia.fcr.volume),
        nadia.fcr.requiredToMeet);
});
