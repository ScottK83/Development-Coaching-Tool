'use strict';

const { suite } = require('./harness');

/**
 * Uploading week-to-date more than once.
 *
 * The defect: the upload dropdown greys out any period whose start|end key is
 * already in the store, on the reasoning that you shouldn't upload the same
 * week twice. Right for a finished week. Wrong for "this week in progress",
 * whose whole job is to be pasted again as the week runs on: its end date is
 * pinned to yesterday, so a second paste on the same day — a corrected export,
 * a run that pulled the wrong slice — hit the exact same key and found the
 * option disabled until the calendar rolled over. Same for month to date.
 *
 * The save path never had this problem: it confirms the overwrite and purges
 * the older same-start row. Only the picker was locked.
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

// Thursday 20 August 2026. Yesterday is Wednesday the 19th, so the wizard
// offers this week in progress as Mon 17 -> Wed 19, and August to date as
// Aug 1 -> Aug 19.
const TODAY = new Date(2026, 7, 20);
const WIP_KEY = '2026-08-17|2026-08-19';
const MTD_KEY = '2026-08-01|2026-08-19';

function row(startDate, endDate, periodType, uploadedAt) {
    return {
        [`${startDate}|${endDate}`]: {
            employees: [{ name: 'A' }],
            metadata: { startDate, endDate, periodType, uploadedAt: uploadedAt || null }
        }
    };
}

function optionById(wizard, store, id) {
    const opts = wizard.annotateUploadState(
        wizard.computeUploadOptions(TODAY), store, {}, {}
    );
    return opts.find(o => o.id === id);
}

suite('week to date can be uploaded again', (t) => {
    const wizard = loadWizard(t);

    // Pasted once already today: same start, same end, same key.
    const store = row('2026-08-17', '2026-08-19', 'week-in-progress', '2026-08-20T13:00:00.000Z');
    const wip = optionById(wizard, store, 'week-in-progress');

    t.check('the option is still offered', !!wip);
    t.check('and is not locked as already uploaded', !wip.isUploaded);
    t.check('it names the copy it would replace', !!wip.priorUpload);
    t.equal('through the same day it covers now', wip.priorUpload.endDate, '2026-08-19');
    t.equal('and when that copy landed', wip.priorUpload.uploadedAt, '2026-08-20T13:00:00.000Z');
});

suite('yesterday copy of the week is the one being replaced', (t) => {
    const wizard = loadWizard(t);

    // Uploaded Wednesday, covering Mon -> Tue. Today's paste runs Mon -> Wed,
    // so the keys differ but it is still the same row of the same week.
    const store = row('2026-08-17', '2026-08-18', 'week-in-progress', '2026-08-19T13:00:00.000Z');
    const wip = optionById(wizard, store, 'week-in-progress');

    t.check('still selectable', !wip.isUploaded);
    t.equal('and points at the shorter copy on file', wip.priorUpload.endDate, '2026-08-18');
});

suite('the newest copy of the week is the one named', (t) => {
    const wizard = loadWizard(t);

    const store = Object.assign({},
        row('2026-08-17', '2026-08-18', 'week-in-progress', '2026-08-19T13:00:00.000Z'),
        row('2026-08-17', '2026-08-19', 'week-in-progress', '2026-08-20T13:00:00.000Z')
    );
    const wip = optionById(wizard, store, 'week-in-progress');

    t.equal('the longest range wins', wip.priorUpload.endDate, '2026-08-19');
});

suite('a different week is not mistaken for this one', (t) => {
    const wizard = loadWizard(t);

    // Last week's in-progress row, left behind before the week finished.
    const store = row('2026-08-10', '2026-08-12', 'week-in-progress', '2026-08-13T13:00:00.000Z');
    const wip = optionById(wizard, store, 'week-in-progress');

    t.check('nothing on file for this week', !wip.priorUpload);
    t.check('and it is offered clean', !wip.isUploaded);
});

suite('month to date can be uploaded again too', (t) => {
    const wizard = loadWizard(t);

    const store = row('2026-08-01', '2026-08-19', 'month-to-date', '2026-08-20T13:00:00.000Z');
    const mtd = optionById(wizard, store, 'month-to-date');

    t.check('the option is still offered', !!mtd);
    t.check('and is not locked', !mtd.isUploaded);
    t.equal('naming the copy on file', mtd.priorUpload.endDate, '2026-08-19');
});

suite('a finished week is still locked once uploaded', (t) => {
    const wizard = loadWizard(t);

    // Mon 10 -> Sun 16 August: the "last week" option, and a real week upload.
    const store = row('2026-08-10', '2026-08-16', 'week', '2026-08-17T13:00:00.000Z');
    const last = optionById(wizard, store, 'week-2026-08-10');

    t.check('last week is on file', !!last);
    t.check('and stays greyed out', last.isUploaded === true);
    t.check('with no re-upload note', !last.priorUpload);
});

suite('an in-progress row does not lock the finished week', (t) => {
    const wizard = loadWizard(t);

    // Someone uploaded last week in progress and never uploaded the whole week.
    // The finished week is still missing and must stay selectable.
    const store = row('2026-08-10', '2026-08-14', 'week-in-progress', '2026-08-15T13:00:00.000Z');
    const last = optionById(wizard, store, 'week-2026-08-10');

    t.check('the completed week is still pending', !last.isUploaded);
});

// The keys the wizard computes for today, spelled out so a change to the
// option list that moves them is caught here rather than in a live upload.
suite('the wizard keys the current periods as expected', (t) => {
    const wizard = loadWizard(t);
    const opts = wizard.computeUploadOptions(TODAY);
    const wip = opts.find(o => o.id === 'week-in-progress');
    const mtd = opts.find(o => o.id === 'month-to-date');

    t.equal('week in progress runs Monday to yesterday', `${wip.startDate}|${wip.endDate}`, WIP_KEY);
    t.equal('month to date runs the 1st to yesterday', `${mtd.startDate}|${mtd.endDate}`, MTD_KEY);
});
