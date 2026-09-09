'use strict';

/**
 * A survey score needs enough responses to be a score.
 *
 * center-ranking already blanks the RANKED extras below three responses
 * (buildExtraRankValues, MIN_SURVEYS_FOR_RANK). The SCORED one had no floor
 * anywhere, and it is the one that matters: associateOverall drives the KPI
 * score, kpisMet, the metric rank and the tiebreaker, and it reaches the year
 * card that gets emailed to the associate.
 *
 * Measured, with every other metric held identical: one response at 100% scored
 * a 3 and took first place from someone on 88% across forty. The projection
 * ladder underneath already refused to project that number below three surveys,
 * so the table was ranking a figure the ladder would not touch.
 *
 * Null rather than a low score, because a survey nobody answered is not a bad
 * survey result. Every consumer already treats null as unmeasured and scales the
 * average over what was measured: "A KPI with no data for the period is not a
 * failed KPI".
 *
 * Which survey backs the number matters too. The scorer falls back from rep sat
 * to Overall Experience, and those are counted by different columns, so the
 * floor has to count the one that was actually used.
 */

const { suite } = require('./harness');

function loadTracker(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;

    // script.js declares this at top level and on-off-tracker reads it as a bare
    // global. It delegates straight to metric-profiles, so the stub does too.
    const profiles = global.window.DevCoachModules.metricProfiles;
    global.getMetricRatingScore = (key, value, year) => profiles.getRatingScore(key, value, year);
    global.window.getMetricRatingScore = global.getMetricRatingScore;

    return t.loadModule('modules/on-off-tracker.module.js').onOffTracker;
}

function person(extra) {
    return Object.assign({
        name: 'Sample', totalCalls: 200,
        scheduleAdherence: 96, overallSentiment: 93, aht: 400, reliability: 1
    }, extra);
}

suite('survey floor: a score needs three responses behind it', (t) => {
    const tracker = loadTracker(t);

    const one = tracker.calculateYearEndOnOffMirror(
        person({ cxRepOverall: 100, repSurveyTotal: 1, surveyTotal: 1 }), 2026);
    t.equal('one response does not score', one.scores.associateOverall, null);
    t.equal('though the figure is still reported', one.values.associateOverall, 100);
    t.equal('and the count is named', one.surveyCount, 1);

    const two = tracker.calculateYearEndOnOffMirror(
        person({ cxRepOverall: 100, repSurveyTotal: 2, surveyTotal: 2 }), 2026);
    t.equal('nor do two', two.scores.associateOverall, null);

    const three = tracker.calculateYearEndOnOffMirror(
        person({ cxRepOverall: 100, repSurveyTotal: 3, surveyTotal: 3 }), 2026);
    t.equal('three do', three.scores.associateOverall, 3);

    const forty = tracker.calculateYearEndOnOffMirror(
        person({ cxRepOverall: 88, repSurveyTotal: 40, surveyTotal: 40 }), 2026);
    t.equal('and a full sample scores on its merits', forty.scores.associateOverall, 3);

    // The floor must not turn a genuinely poor score into an unmeasured one.
    const poor = tracker.calculateYearEndOnOffMirror(
        person({ cxRepOverall: 60, repSurveyTotal: 40, surveyTotal: 40 }), 2026);
    t.equal('a bad number with a real sample still scores badly', poor.scores.associateOverall, 1);
});

suite('survey floor: it counts the survey that was actually used', (t) => {
    const tracker = loadTracker(t);

    // Rep sat blank, so the scorer falls back to Overall Experience -- which is
    // counted by surveyTotal, not repSurveyTotal.
    const viaOe = tracker.calculateYearEndOnOffMirror(
        person({ cxRepOverall: 0, overallExperience: 90, repSurveyTotal: 0, surveyTotal: 40 }), 2026);
    t.equal('the fallback source is named', viaOe.associateOverallSource, 'overallExperience');
    t.equal('and it is counted by its own column', viaOe.surveyCount, 40);
    t.check('so a full Overall Experience sample scores', viaOe.scores.associateOverall !== null);

    // The mirror image: rep sat is used, so repSurveyTotal is the count even
    // though surveyTotal is large.
    const viaRep = tracker.calculateYearEndOnOffMirror(
        person({ cxRepOverall: 100, repSurveyTotal: 1, surveyTotal: 40 }), 2026);
    t.equal('rep sat is the source', viaRep.associateOverallSource, 'cxRepOverall');
    t.equal('counted by the rep-sat column', viaRep.surveyCount, 1);
    t.equal('so one rep-sat response does not score', viaRep.scores.associateOverall, null);
});

suite('survey floor: the emailed year card does not place a single response', (t) => {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    const cr = t.loadModule('modules/center-ranking.module.js').centerRanking;

    const holder = (surveys, value) => ({
        values: { associateOverall: value, aht: 400 },
        surveyTotal: surveys, repSurveyTotal: surveys, totalCalls: 200
    });
    const holders = [
        { name: 'One Survey', holder: holder(1, 100) },
        { name: 'Three Surveys', holder: holder(3, 95) },
        { name: 'Forty Surveys', holder: holder(40, 88) }
    ];

    const cx = cr.rankWithinMetric(holders, { label: 'CX Adv', registry: 'cxRepOverall', scoreKey: 'associateOverall' });
    t.check('the single response is not placed at all', cx['One Survey'] === undefined);
    t.equal('the field is the two who qualify', cx['Three Surveys'].total, 2);
    t.equal('and the best of them leads', cx['Three Surveys'].rank, 1);
    t.equal('with the larger sample behind', cx['Forty Surveys'].rank, 2);

    // A metric that is not survey-backed must be untouched by the floor.
    const aht = cr.rankWithinMetric(holders, { label: 'AHT', registry: 'aht', scoreKey: 'aht' });
    t.equal('everyone is still ranked on AHT', Object.keys(aht).length, 3);
});
