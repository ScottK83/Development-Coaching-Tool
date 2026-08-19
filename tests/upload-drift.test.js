'use strict';

const { suite } = require('./harness');

/**
 * THE UPLOAD GATE
 *
 * It exists to catch one thing: a paste whose columns have shifted, which
 * would overwrite a good week with numbers read out of the wrong column.
 * Everything it blocks that is not that is a manager stuck on the Upload tab
 * with a report that is perfectly fine.
 *
 * Two of those. A week-so-far upload was judged against whatever came before
 * it — usually a fuller period — and blocked for being smaller. And the three
 * survey metrics, which land days after the calls they describe, were read as
 * three columns going missing at once.
 */

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/upload-drift.module.js').uploadDrift;
}

const OPERATIONAL = { scheduleAdherence: 95, transfers: 3, aht: 400, overallSentiment: 90, positiveWord: 88, negativeWord: 92, managingEmotions: 96, reliability: 99 };
const SURVEYS = { cxRepOverall: 92, fcr: 80, overallExperience: 88 };

// A roster where every listed metric has a number for everybody.
function roster(n, shape) {
    const out = [];
    for (let i = 0; i < n; i++) out.push(Object.assign({ name: 'Person' + i }, shape));
    return out;
}

function fullWeek(n) { return roster(n || 120, Object.assign({}, OPERATIONAL, SURVEYS)); }
function weekSoFar(n) { return roster(n || 118, OPERATIONAL); }

suite('upload gate: surveys that have not landed yet are not column drift', (t) => {
    const drift = load(t);

    // Last Friday's week-so-far had surveys in it; this Tuesday's does not.
    const baselines = { 'week-in-progress': drift.computeMetricCoverage(fullWeek()) };
    const verdict = drift.judgeUpload({ employees: weekSoFar(), periodType: 'week-in-progress', baselines });

    t.equal('a report with blank surveys is not blocked', verdict.errors.length, 0);
    t.equal('it asks once instead', verdict.warnings.length, 1);
    t.check('naming the three in the words the app uses elsewhere',
        verdict.warnings[0].indexOf('RepSat, FCR, OE') > -1);
    t.check('and saying why blank is expected', verdict.warnings[0].indexOf('land days after the calls') > -1);
});

suite('upload gate: a shifted paste still stops dead', (t) => {
    const drift = load(t);
    const baselines = { week: drift.computeMetricCoverage(fullWeek()) };

    // The operational block goes missing — nothing about a report lagging
    // explains adherence, AHT and sentiment all emptying at once.
    const shifted = roster(120, Object.assign({ transfers: 3, reliability: 99 }, SURVEYS));
    const verdict = drift.judgeUpload({ employees: shifted, periodType: 'week', baselines });

    t.check('the upload is refused', verdict.errors.length > 0);
    t.check('the missing columns are named', verdict.errors[0].indexOf('Adherence') > -1);
    t.check('against the kind of upload it was compared with', verdict.errors[0].indexOf('weekly') > -1);
    t.check('and the likely cause is offered', verdict.errors[0].indexOf('header changed') > -1);

    // Surveys dropping alongside a real drift is still a real drift.
    const everythingButTwo = roster(120, { transfers: 3, reliability: 99 });
    t.check('surveys among a wider drop do not soften it',
        drift.judgeUpload({ employees: everythingButTwo, periodType: 'week', baselines }).errors.length > 0);
});

suite('upload gate: each kind of upload is judged against its own kind', (t) => {
    const drift = load(t);

    // The only baseline on file is a full month. A Tuesday week-so-far must
    // not be measured against it — that is the block that started all this.
    const baselines = { 'month-to-date': drift.computeMetricCoverage(fullWeek(126)) };
    const verdict = drift.judgeUpload({ employees: weekSoFar(), periodType: 'week-in-progress', baselines });

    t.equal('a kind with no baseline of its own is not blocked', verdict.errors.length, 0);
    t.equal('and nothing is invented to warn about', verdict.warnings.length, 0);

    // The month-to-date upload is still guarded by its own baseline.
    const brokenMtd = roster(126, { transfers: 3, reliability: 99 });
    t.check('while its own kind still gets checked',
        drift.judgeUpload({ employees: brokenMtd, periodType: 'month-to-date', baselines }).errors.length > 0);
});

suite('upload gate: a paste that is not a report at all', (t) => {
    const drift = load(t);
    const twoColumns = roster(40, { aht: 400, transfers: 3 });
    const verdict = drift.judgeUpload({ employees: twoColumns, periodType: 'week', baselines: {} });

    t.check('too few columns is a block on its own', verdict.errors.length > 0);
    t.check('with the count said out loud', verdict.errors[0].indexOf('2 metric column') > -1);

    // No rows at all is the caller's problem, not something to accuse them of.
    const empty = drift.judgeUpload({ employees: [], periodType: 'week', baselines: {} });
    t.equal('an empty paste raises nothing here', empty.errors.length, 0);
});

suite('upload gate: baselines survive the shape they used to be stored in', (t) => {
    const drift = load(t);

    // Older installs kept one flat map, written by whatever went in last —
    // which was the weekly paste nearly every time.
    const legacy = JSON.stringify(drift.computeMetricCoverage(fullWeek()));
    const migrated = drift.readBaselines(legacy);

    t.check('a flat map becomes the weekly baseline', migrated.week && migrated.week.fcr === 1);
    t.check('and guards the weekly upload immediately',
        drift.judgeUpload({ employees: roster(120, { transfers: 3, reliability: 99 }), periodType: 'week', baselines: legacy }).errors.length > 0);

    // Anything unreadable is treated as no baseline rather than as a reason
    // to block — a broken key must not lock somebody out of uploading.
    t.equal('junk reads as no baseline', Object.keys(drift.readBaselines('{not json')).length, 0);
    t.equal('and so does nothing at all', Object.keys(drift.readBaselines(null)).length, 0);

    const written = drift.writeBaseline({ week: { aht: 1 } }, 'week-in-progress', { aht: 1 });
    t.check('writing one kind leaves the others alone', written.week && written['week-in-progress']);
});
