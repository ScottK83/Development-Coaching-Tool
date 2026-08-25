'use strict';

const { suite } = require('./harness');

/**
 * What the upload page says is missing.
 *
 * The defect: the trajectory showed January through April with no data at all,
 * while the upload banner said "1 week never uploaded". Both were reading the
 * same store. The gap scan started at the earliest upload on file, on the
 * reasoning that weeks before it "aren't gaps, they're just before the user
 * started" — right in week two of a new install, wrong in August, when the
 * trajectory, the month rebuilds and every year-to-date comparison all run from
 * January and four blank months at the front of the year are missing data by
 * every definition the rest of the app uses.
 */

function loadWizard(t) {
    t.installFakeBrowser();
    global.document = {
        getElementById: () => null,
        createElement: () => ({ style: {}, dataset: {}, appendChild() {}, set textContent(v) { this._t = v; } }),
        querySelector: () => null,
        querySelectorAll: () => []
    };
    t.loadModule('modules/upload-wizard.module.js');
    return global.window.DevCoachModules.uploadWizard;
}

// A week keyed the way the store keys them, Monday to Sunday.
function week(mondayISO) {
    const mon = new Date(mondayISO + 'T00:00:00');
    const sun = new Date(mon.getTime() + 6 * 86400000);
    const iso = (d) => d.toISOString().slice(0, 10);
    return {
        [`${iso(mon)}|${iso(sun)}`]: {
            employees: [{ name: 'A' }],
            metadata: { startDate: iso(mon), endDate: iso(sun), periodType: 'week' }
        }
    };
}

/* Scott's store, in shape: weeklies running from May, one hole in August, and
   nothing at all before May. Today is fixed so the suite does not drift. */
const TODAY = new Date(2026, 7, 18);      // 18 August 2026, a Tuesday
const STORE = Object.assign({},
    week('2026-05-04'), week('2026-05-11'), week('2026-05-18'), week('2026-05-25'),
    week('2026-06-01'), week('2026-06-08'), week('2026-06-15'), week('2026-06-22'),
    week('2026-06-29'), week('2026-07-06'), week('2026-07-13'), week('2026-07-20'),
    week('2026-07-27'), week('2026-08-03'),
    /* 2026-08-10 deliberately absent — the one real gap */
    week('2026-08-17')
);

suite('upload gaps: a hole between uploads is still reported on its own', (t) => {
    const wiz = loadWizard(t);
    const gaps = wiz.computeMissingWeeks(STORE, TODAY);

    t.equal('the one interior hole is found', gaps.totalMissing, 1);
    t.equal('and it is the week nobody uploaded', gaps.weeks[0].startDate, '2026-08-10');
});

suite('upload gaps: the blank start of the year is reported too', (t) => {
    const wiz = loadWizard(t);
    const gaps = wiz.computeMissingWeeks(STORE, TODAY);

    // This is the whole point: four months of nothing used to be invisible here
    // because the scan began at the first upload.
    t.check('the months with no weekly upload are named',
        JSON.stringify(gaps.emptyMonths) === JSON.stringify(['January', 'February', 'March', 'April']));
    t.equal('and the first date actually covered is stated', gaps.firstCoveredDate, '2026-05-04');
    t.check('the weeks before it are counted', gaps.priorCount >= 17);

    // Counted separately, so eighteen weeks of never-had-it cannot drown the one
    // week that is genuinely an oversight.
    t.equal('without inflating the gap count', gaps.totalMissing, 1);
    t.check('and none of the prior weeks is in the gap list',
        gaps.weeks.every((w) => w.startDate >= '2026-05-04'));
});

suite('upload gaps: the missing weeks are offered, not just announced', (t) => {
    const wiz = loadWizard(t);
    const gaps = wiz.computeMissingWeeks(STORE, TODAY);

    t.check('prior weeks come back as pickable options',
        gaps.priorWeeks.length > 0 && gaps.priorWeeks.every((w) =>
            w.periodType === 'week' && w.isMissingWeek && w.id && w.startDate && w.endDate));
    t.check('nearest to the data you have comes first',
        gaps.priorWeeks[0].startDate > gaps.priorWeeks[gaps.priorWeeks.length - 1].startDate);
    t.check('they say what they are', /before your first upload/.test(gaps.priorWeeks[0].label));
    t.check('the list is capped so the dropdown stays usable',
        gaps.priorWeeks.length <= 12 && gaps.priorShownCount === gaps.priorWeeks.length);
});

suite('upload gaps: the banner says both things, separately', (t) => {
    const wiz = loadWizard(t);
    const gaps = wiz.computeMissingWeeks(STORE, TODAY);
    const el = { style: {}, innerHTML: '' };
    wiz.renderGapBanner(el, gaps);

    t.check('the banner is shown', el.style.display === 'block');
    t.check('the one real gap keeps its own heading', /1 week never uploaded/.test(el.innerHTML));
    t.check('and the blank start of the year gets its own', /Nothing uploaded before/.test(el.innerHTML));
    t.check('the empty months are named in plain English',
        /January, February, March and April have no data at all/.test(el.innerHTML));
    // Monthly first: one file per month against four or five weeklies, and the
    // rankings cannot tell the two apart.
    t.check('the cheap fix is offered first', /You do not need the weeks/.test(el.innerHTML));
    t.check('and the weeks are still there for anyone who wants the detail',
        /week-over-week detail inside those months/.test(el.innerHTML));
});

suite('upload gaps: a month can be uploaded instead of its weeks', (t) => {
    const wiz = loadWizard(t);
    const gaps = wiz.computeMissingWeeks(STORE, TODAY);
    const ids = gaps.monthOptions.map((o) => o.id);

    // The wizard only ever offered "last completed month", so someone told four
    // months were blank had no way to fill them but seventeen weekly uploads.
    t.check('every uncovered month is offered', gaps.monthOptions.length === 4);
    t.check('as real monthly periods',
        gaps.monthOptions.every((o) => o.periodType === 'month' && o.isMissingPeriod));
    t.check('January is one of them', ids.indexOf('month-2026-01-01') !== -1);
    t.check('and April is the other end', ids.indexOf('month-2026-04-01') !== -1);
    t.check('each spans its whole calendar month',
        gaps.monthOptions.every((o) => /-01$/.test(o.startDate)) &&
        gaps.monthOptions.some((o) => o.endDate === '2026-01-31'));
    t.check('nearest first, like the weeks', gaps.monthOptions[0].startDate > gaps.monthOptions[3].startDate);

    // The month in progress cannot be uploaded as a finished month.
    t.check('August is not offered', ids.indexOf('month-2026-08-01') === -1);
    // May onward is covered by weeklies, so it is not offered either.
    t.check('covered months are left alone', ids.indexOf('month-2026-05-01') === -1);
});

suite('upload gaps: a monthly upload counts as covering its month', (t) => {
    const wiz = loadWizard(t);
    const withJan = Object.assign({
        '2026-01-01|2026-01-31': {
            employees: [{ name: 'A' }],
            metadata: { startDate: '2026-01-01', endDate: '2026-01-31', periodType: 'month' }
        }
    }, STORE);
    const gaps = wiz.computeMissingWeeks(withJan, TODAY);

    // The rankings rebuild a month from weeklies only when no monthly upload
    // exists for it, so a monthly file is coverage, not a partial substitute.
    t.check('January drops off the empty list', gaps.emptyMonths.indexOf('January') === -1);
    t.check('and off the offer list',
        gaps.monthOptions.every((o) => o.id !== 'month-2026-01-01'));
    t.check('the rest are untouched',
        JSON.stringify(gaps.emptyMonths) === JSON.stringify(['February', 'March', 'April']));

    const cov = wiz.monthCoverage(withJan, TODAY);
    t.equal('January reads as uploaded', cov[0].status, 'uploaded');
    t.equal('May reads as rebuilt from weeks', cov[4].status, 'rebuilt');
    t.equal('February reads as nothing', cov[1].status, 'none');
});

suite('upload gaps: a fortnight is the floor for calling something a month', (t) => {
    const wiz = loadWizard(t);
    // The month rebuild throws out a "month" covering less than two weeks, so
    // it must not read as coverage here either.
    const stub = Object.assign({
        '2026-03-01|2026-03-06': {
            employees: [{ name: 'A' }],
            metadata: { startDate: '2026-03-01', endDate: '2026-03-06', periodType: 'month' }
        }
    }, STORE);
    const gaps = wiz.computeMissingWeeks(stub, TODAY);
    t.check('a six-day "month" does not cover March', gaps.emptyMonths.indexOf('March') !== -1);
});

suite('upload gaps: a complete year says nothing', (t) => {
    const wiz = loadWizard(t);
    // Every completed week of the year, from the first week ending in January.
    let full = {};
    for (let d = new Date(2025, 11, 29); d < TODAY; d = new Date(d.getTime() + 7 * 86400000)) {
        full = Object.assign(full, week(d.toISOString().slice(0, 10)));
    }
    const gaps = wiz.computeMissingWeeks(full, TODAY);

    t.equal('no holes', gaps.totalMissing, 0);
    t.equal('nothing missing at the front', gaps.priorCount, 0);
    t.equal('and no month is blank', gaps.emptyMonths.length, 0);

    const el = { style: {}, innerHTML: '' };
    wiz.renderGapBanner(el, gaps);
    t.check('so the banner stays out of the way', el.style.display === 'none');
});

suite('upload gaps: a brand new install is not scolded for the year so far', (t) => {
    const wiz = loadWizard(t);
    const gaps = wiz.computeMissingWeeks({}, TODAY);

    // Nothing uploaded at all is week one of using the tool, not a data problem.
    t.equal('no gaps are invented', gaps.totalMissing, 0);
    t.equal('and no backfill is demanded', gaps.priorCount, 0);
});


/* ── Month to date ──
   A rebuilt month runs on whole weeks, so "August" starts in July and stops at
   the last finished week. A month-to-date upload is the real month so far,
   straight from the source, and replaces itself every time it is uploaded. */

suite('upload options: month to date is offered for the current month', (t) => {
    const wiz = loadWizard(t);
    const opts = wiz.computeUploadOptions(TODAY);          // 18 Aug 2026
    const mtd = opts.find((o) => o.id === 'month-to-date');

    t.check('the option exists', !!mtd);
    t.equal('it is its own kind of period', mtd.periodType, 'month-to-date');
    t.equal('it starts on the first of the month', mtd.startDate, '2026-08-01');
    // PowerBI publishes the prior day, the same reason the week-in-progress
    // option stops at yesterday.
    t.equal('and ends yesterday, not today', mtd.endDate, '2026-08-17');
    t.check('it names the month', /August 2026 to date/.test(mtd.label));
    t.check('it sits between last week and last completed month',
        mtd.priority > opts.find((o) => o.id.startsWith('week-')).priority &&
        mtd.priority < opts.find((o) => o.id.startsWith('month-2')).priority);
});

suite('upload options: on the first of the month there is nothing to date yet', (t) => {
    const wiz = loadWizard(t);
    const opts = wiz.computeUploadOptions(new Date(2026, 7, 1));
    t.check('no month-to-date option', !opts.some((o) => o.id === 'month-to-date'));
});

suite('upload gaps: a month-to-date upload covers its month', (t) => {
    const wiz = loadWizard(t);
    const withMtd = Object.assign({
        '2026-08-01|2026-08-17': {
            employees: [{ name: 'A' }],
            metadata: { startDate: '2026-08-01', endDate: '2026-08-17', periodType: 'month-to-date' }
        }
    }, STORE);
    const cov = wiz.monthCoverage(withMtd, TODAY);
    t.equal('August reads as uploaded', cov[7].status, 'uploaded');

    // It is the current month, so it was never on the backfill list anyway —
    // but it must not start appearing there either.
    const gaps = wiz.computeMissingWeeks(withMtd, TODAY);
    t.check('and is not offered for backfill',
        gaps.monthOptions.every((o) => o.id !== 'month-2026-08-01'));
});


/* ── Quarters ──
   A quarter was the one period the scan never looked at, so a year with no Q1
   file and no January, February or March either was reported as three missing
   months and nothing else. */

function monthRow(startISO, endISO) {
    return {
        [`${startISO}|${endISO}`]: {
            employees: [{ name: 'A' }],
            metadata: { startDate: startISO, endDate: endISO, periodType: 'month' }
        }
    };
}

suite('upload gaps: a completed quarter nothing covers is a gap', (t) => {
    const wiz = loadWizard(t);
    const gaps = wiz.computeMissingWeeks(STORE, TODAY);
    const ids = gaps.quarterOptions.map((o) => o.id);

    t.check('Q1 is missing, nothing in the year covers it', ids.indexOf('quarter-2026-q1') !== -1);
    t.check('and Q2, because April never landed', ids.indexOf('quarter-2026-q2') !== -1);
    t.check('the quarter still running is not demanded', ids.indexOf('quarter-2026-q3') === -1);
    t.check('they come back as real quarter periods',
        gaps.quarterOptions.every((o) => o.periodType === 'quarter' && o.isMissingPeriod));
    t.check('spanning the whole quarter',
        gaps.quarterOptions.some((o) => o.startDate === '2026-01-01' && o.endDate === '2026-03-31'));
    t.check('nearest first, like the weeks and the months',
        gaps.quarterOptions[0].id === 'quarter-2026-q2');
    t.equal('and the tally agrees with the list', gaps.quarterCount, gaps.quarterOptions.length);

    // The id has to be the shape the dropdown already builds, or the chip is
    // pointing at an option that does not exist.
    t.check('the id matches the one computeUploadOptions uses',
        wiz.computeUploadOptions(TODAY).some((o) => o.id === 'quarter-2026-q2'));
});

suite('upload gaps: a quarter covered by its three months is not a gap', (t) => {
    const wiz = loadWizard(t);
    const withQ1Months = Object.assign({}, STORE,
        monthRow('2026-01-01', '2026-01-31'),
        monthRow('2026-02-01', '2026-02-28'),
        monthRow('2026-03-01', '2026-03-31'));
    const gaps = wiz.computeMissingWeeks(withQ1Months, TODAY);

    t.check('Q1 drops off the offer list',
        gaps.quarterOptions.every((o) => o.id !== 'quarter-2026-q1'));

    const cov = wiz.quarterCoverage(withQ1Months, TODAY);
    t.equal('it reads as rebuilt from its months', cov[0].status, 'rebuilt');
    t.equal('Q2 does not, April is still blank', cov[1].status, 'partial');
    t.check('and April is named as the reason', cov[1].monthsMissing.indexOf('April') !== -1);
    t.check('Q3 is not judged at all, it has not finished', cov[2].complete === false);
});

suite('upload gaps: a quarterly upload covers its quarter and nothing inside it', (t) => {
    const wiz = loadWizard(t);
    const withQ2 = Object.assign({}, STORE, {
        '2026-04-01|2026-06-30': {
            employees: [{ name: 'A' }],
            metadata: { startDate: '2026-04-01', endDate: '2026-06-30', periodType: 'quarter' }
        }
    });
    const cov = wiz.quarterCoverage(withQ2, TODAY);
    t.equal('the quarter reads as uploaded', cov[1].status, 'uploaded');

    // Nothing in the app splits a quarter row back into three months, so the
    // months inside it must not go quiet just because the quarter did.
    const gaps = wiz.computeMissingWeeks(withQ2, TODAY);
    t.check('April is still an empty month', gaps.emptyMonths.indexOf('April') !== -1);
    t.check('and still offered as a month to upload',
        gaps.monthOptions.some((o) => o.id === 'month-2026-04-01'));
});

/* ── Year to date ──
   Not a hole in a trend line: a switch. morning-pulse's attachYearPace reads
   the newest YTD, compares its year to this one, and writes nothing at all if
   they differ, so a missing or stale YTD reaches the user as a sentence that
   quietly stopped appearing. */

function ytdRow(endISO) {
    const startISO = `${endISO.slice(0, 4)}-01-01`;
    return {
        [`${startISO}|${endISO}`]: {
            employees: [{ name: 'A' }],
            metadata: { startDate: startISO, endDate: endISO, periodType: 'ytd' }
        }
    };
}

suite('upload gaps: no YTD upload at all is reported', (t) => {
    const wiz = loadWizard(t);
    const gaps = wiz.computeMissingWeeks(STORE, TODAY, 12, {});

    t.check('the store was checked', !!gaps.ytd);
    t.check('and reported as missing', gaps.ytd.isMissing === true && gaps.ytd.latestEnd === null);

    const el = { style: {}, innerHTML: '' };
    wiz.renderGapBanner(el, gaps);
    t.check('the banner says so in those words', /No YTD on file for 2026/.test(el.innerHTML));
    t.check('and says what goes quiet without one',
        /morning pulse refuses to say anything about year pace/.test(el.innerHTML));
    t.check('and that this one cannot be a chip', /needs the end date it covers/.test(el.innerHTML));
});

suite('upload gaps: last year YTD is not this year YTD', (t) => {
    const wiz = loadWizard(t);
    const gaps = wiz.computeMissingWeeks(STORE, TODAY, 12, ytdRow('2025-12-31'));

    t.check('it still counts as missing for 2026', gaps.ytd.isMissing === true);
    t.equal('but the one on file is named', gaps.ytd.latestYear, 2025);

    const el = { style: {}, innerHTML: '' };
    wiz.renderGapBanner(el, gaps);
    t.check('the banner says which year it belongs to', /which is last year/.test(el.innerHTML));
});

suite('upload gaps: a stale YTD is reported with its date', (t) => {
    const wiz = loadWizard(t);
    const gaps = wiz.computeMissingWeeks(STORE, TODAY, 12, ytdRow('2026-04-30'));

    t.check('it is on file for this year', gaps.ytd.hasCurrentYear === true && gaps.ytd.isMissing === false);
    t.check('but months behind', gaps.ytd.isStale === true && gaps.ytd.daysBehind > 100);
    t.equal('and the month it stopped in is named', gaps.ytd.closedMonth, 'April');

    const el = { style: {}, innerHTML: '' };
    wiz.renderGapBanner(el, gaps);
    t.check('the banner says it the way the owner said it', /Your YTD closed in April/.test(el.innerHTML));
    t.check('with the actual end date, not just the month', /Apr 30, 2026/.test(el.innerHTML));
});

suite('upload gaps: a current YTD is left alone', (t) => {
    const wiz = loadWizard(t);
    const gaps = wiz.computeMissingWeeks(STORE, TODAY, 12, ytdRow('2026-08-16'));

    t.check('nothing to report', gaps.ytd.isMissing === false && gaps.ytd.isStale === false);

    const el = { style: {}, innerHTML: '' };
    wiz.renderGapBanner(el, gaps);      // the weeks and months are still missing
    t.check('the banner does not mention YTD at all',
        !/No YTD on file/.test(el.innerHTML) && !/YTD closed/.test(el.innerHTML));

    // A caller holding only the weekly store has not said "there is no YTD",
    // it has said nothing about YTD, and the banner must not invent a warning
    // out of an argument nobody passed.
    const unasked = wiz.computeMissingWeeks(STORE, TODAY);
    t.equal('and an unasked question gets no answer', unasked.ytd, null);
});

/* ── The chips ──
   The dates were inert text. Every one of them names a period that is already
   an <option> in the dropdown six inches below it, so the whole feature was a
   lookup by id away. */

suite('upload gaps: every chip is a button carrying a real dropdown id', (t) => {
    const wiz = loadWizard(t);
    const gaps = wiz.computeMissingWeeks(STORE, TODAY, 12, {});
    const el = { style: {}, innerHTML: '' };
    wiz.renderGapBanner(el, gaps);

    const PREFIX = 'data-upload-option="';
    const chipIds = (el.innerHTML.match(/data-upload-option="[^"]*"/g) || [])
        .map((m) => m.slice(PREFIX.length, -1));

    // Built the way refresh() builds the dropdown: the standard options, plus
    // the gap options folded in beside them.
    const dropdownIds = new Set(wiz.computeUploadOptions(TODAY).map((o) => o.id)
        .concat(gaps.weeks.map((o) => o.id))
        .concat(gaps.quarterOptions.map((o) => o.id))
        .concat(gaps.monthOptions.map((o) => o.id))
        .concat(gaps.priorWeeks.map((o) => o.id)));

    t.check('there are chips', chipIds.length > 0);
    t.check('they are buttons, keyboard reachable, not spans with handlers',
        /<button type="button" class="upload-gap-chip"/.test(el.innerHTML));
    t.check('every chip points at an option the dropdown really has',
        chipIds.every((id) => dropdownIds.has(id)));
    t.check('each kind of period got one',
        chipIds.indexOf('week-2026-08-10') !== -1 &&
        chipIds.indexOf('month-2026-04-01') !== -1 &&
        chipIds.indexOf('quarter-2026-q1') !== -1);
    // YTD needs an end date only the user knows, so a one-click chip for it
    // would be a chip that cannot finish the job.
    t.check('YTD is not offered as a chip', chipIds.indexOf('ytd') === -1);
});

suite('upload gaps: clicking a chip fills the picker, and says so', (t) => {
    const wiz = loadWizard(t);
    const status = { style: {}, textContent: '' };
    const select = {
        value: '',
        dispatched: [],
        options: [
            { value: 'week-2026-08-10', textContent: 'Aug 10 - Aug 16, 2026', disabled: false },
            { value: 'week-2026-08-03', textContent: 'Aug 3 - Aug 9, 2026', disabled: true }
        ],
        dispatchEvent(ev) { this.dispatched.push(ev.type); return true; },
        scrollIntoView() { this.scrolled = true; },
        focus() { this.focused = true; }
    };
    global.document.getElementById = (id) =>
        id === 'uploadWizardSelect' ? select : (id === 'uploadWizardGapStatus' ? status : null);

    const ok = wiz.selectPeriodFromChip('week-2026-08-10', null);
    t.check('the option is selected', ok.ok === true && select.value === 'week-2026-08-10');
    // Assigning .value fires nothing, and the YTD and daily date pickers both
    // hang off this select's change event.
    t.check('a real change event is dispatched', select.dispatched.indexOf('change') !== -1);
    t.check('the dropdown is brought into view', select.scrolled === true);
    t.check('and the click is confirmed on screen', /Loaded into the picker/.test(status.textContent));

    const gone = wiz.selectPeriodFromChip('week-2020-01-06', null);
    t.check('a chip whose option is absent fails rather than doing nothing',
        gone.ok === false && gone.reason === 'no-option');
    t.check('and fails visibly, naming what it could not find',
        /not in the list any more/.test(status.textContent) && /week-2020-01-06/.test(status.textContent));

    const done = wiz.selectPeriodFromChip('week-2026-08-03', null);
    t.check('an already-uploaded period is refused with a reason',
        done.ok === false && done.reason === 'disabled' && /already uploaded/.test(status.textContent));
});
