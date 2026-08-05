'use strict';

const { suite } = require('./harness');

function load(t) {
    const browser = t.installFakeBrowser();
    const modules = t.loadModule('modules/data-integrity.module.js');
    return { integrity: modules.dataIntegrity, store: browser.store };
}

function issue(weekKey, category, message) {
    return { severity: 'medium', category, message, weekKey };
}

suite('data health: clearing what you have already seen', (t) => {
    const { integrity, store } = load(t);

    const a = issue('2026-07-27|2026-08-02', 'Big metric swing', 'Alyssa Dimes: AHT moved 480.0 → 620.0 (Δ 140.0)');
    const b = issue('2026-07-27|2026-08-02', 'Duplicate rows', 'Chris Vale appears 2 times in the same upload');

    t.check('nothing is cleared to begin with', integrity.loadReviewed().size === 0);

    integrity.markReviewed([a, b]);
    const reviewed = integrity.loadReviewed();
    t.check('clearing records both findings', reviewed.has(integrity.issueFingerprint(a)) && reviewed.has(integrity.issueFingerprint(b)));

    // The whole point of the wipe is that it survives a reload, so it has to
    // be in storage rather than in a variable the modal owns.
    t.check('and it lives in localStorage', Object.keys(store).some(k => k.indexOf('dataHealthReviewed') > -1));

    // A finding that differs in any of week, category, or wording is a
    // different finding — clearing one must not silence the other.
    const sameWeekNewProblem = issue('2026-07-27|2026-08-02', 'Big metric swing', 'Chris Vale: AHT moved 480.0 → 700.0 (Δ 220.0)');
    t.check('a new anomaly still comes through', !integrity.loadReviewed().has(integrity.issueFingerprint(sameWeekNewProblem)));

    const laterWeekSameProblem = issue('2026-08-03|2026-08-09', 'Duplicate rows', 'Chris Vale appears 2 times in the same upload');
    t.check('the same problem in a later week still comes through', !integrity.loadReviewed().has(integrity.issueFingerprint(laterWeekSameProblem)));

    // Re-clearing after the older finding disappears should not keep carrying
    // fingerprints for uploads that no longer exist.
    integrity.markReviewed([b]);
    t.check('re-clearing drops fingerprints the scan no longer produces', !integrity.loadReviewed().has(integrity.issueFingerprint(a)));

    integrity.clearReviewed();
    t.check('bringing them back empties the list', integrity.loadReviewed().size === 0);
});

suite('data health: clearing hides findings without touching uploads', (t) => {
    const { integrity } = load(t);

    const weeklyData = {
        '2026-07-27|2026-08-02': {
            metadata: { endDate: '2026-08-02', periodType: 'week' },
            employees: [
                { name: 'Alyssa Dimes', totalCalls: 120, surveyTotal: 400 },
                { name: 'Alyssa Dimes', totalCalls: 120, surveyTotal: 400 }
            ]
        }
    };

    const before = integrity.runDataIntegrityScan(weeklyData, {});
    t.check('the scan finds the seeded problems', before.issues.length > 0);

    integrity.markReviewed(before.issues);
    const after = integrity.runDataIntegrityScan(weeklyData, {});

    t.equal('the scan itself is unchanged', after.issues.length, before.issues.length);
    t.equal('the uploads are untouched', weeklyData['2026-07-27|2026-08-02'].employees.length, 2);

    const reviewed = integrity.loadReviewed();
    const stillVisible = after.issues.filter(i => !reviewed.has(integrity.issueFingerprint(i)));
    t.equal('but nothing is left to show', stillVisible.length, 0);
});
