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
        /January, February, March and April have no weekly data/.test(el.innerHTML));
    t.check('and the reader is told they can be filled',
        /in the dropdown if you have the reports/.test(el.innerHTML));
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
