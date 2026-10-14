'use strict';

/**
 * The one-to-one sheet, and the Center > Trends coaching prompt, read with
 * units and kind words.
 *
 * The 10/14 smoke test found reliability on the 1:1 sheet's Better row as a
 * period's own hours ("Reliability: 4.0 -> 2.0"), headings that said
 * "Slipped:" in one section and "Worse:" in the next, standings with no
 * units or articles ("96.2 against a 93.0 target", "a 18.0 target"), the date
 * as 2026-10-14, and the trend coaching prompt reading "Average Handle Time:
 * 398" with no unit.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    t.loadModule('modules/metric-trends.module.js');
    return t.loadModule('modules/one-on-one.module.js').oneOnOne;
}

suite('review voice: hours are never a better or a slipped on the 1:1 sheet', (t) => {
    const ooo = load(t);
    const moved = ooo.compareSnapshots({ reliability: 4, aht: 480 }, { reliability: 2, aht: 430 });
    t.check('reliability is not compared', ![...moved.improved, ...moved.slipped, ...moved.steady].some((e) => e.key === 'reliability'));
    t.check('handle time still is', moved.improved.some((e) => e.key === 'aht'));

    // Even when handed in, as a meeting saved before this rule would be.
    const sheet = ooo.buildTalkingPoints({
        employeeName: 'Esperanza Palomera', date: '2026-10-14',
        sinceLast: { date: '2026-09-15', improved: [{ key: 'reliability', label: 'Reliability', before: 4, after: 2, gain: 2 }], slipped: [] },
        lastMonth: { improved: [{ key: 'reliability', label: 'Reliability', before: 4, after: 2, gain: 2 }],
            slipped: [{ key: 'fcr', label: 'First Call Resolution', before: 80, after: 72, gain: -8 }] }
    });
    t.check('no hours in a change row', !/Reliability: 4/.test(sheet));
    t.check('one word for a slip, and it is not "Worse"', !/Worse/.test(sheet) && /• Slipped: First Call Resolution: 80% → 72%/.test(sheet));
    t.check('the date reads 10/14/2026', /One-to-one\. Esperanza Palomera · 10\/14\/2026/.test(sheet));
    t.check('and the last meeting 09/15/2026', /SINCE WE LAST MET \(09\/15\/2026\)/.test(sheet));
});

suite('review voice: the 1:1 year so far has units, articles and the KPIs first', (t) => {
    const ooo = load(t);
    t.equal('a rate against its goal', ooo.describeStanding({ key: 'scheduleAdherence', label: 'Schedule Adherence', value: 96.2, target: 93 }),
        'Schedule Adherence: 96.2% against a 93% goal');
    t.equal('an article that fits the number', ooo.describeStanding({ key: 'overallSentiment', label: 'Overall Sentiment', value: 90, target: 88 }),
        'Overall Sentiment: 90% against an 88% goal');
    t.equal('hours are the year against an allowance', ooo.describeStanding({ key: 'reliability', label: 'Reliability', value: 11, target: 18 }),
        'Reliability: 11 hrs missed this year, against an 18 hr allowance');

    const entries = ooo.yearToDateEntries({
        name: 'Eli Brooks', aht: 439, scheduleAdherence: 96.6, overallSentiment: 90, cxRepOverall: 0, fcr: 0,
        overallExperience: 0, surveyTotal: 0, repSurveyTotal: 0, fcrSurveyTotal: 0, transfers: 4, holdTime: 25, reliability: 5
    }, (key) => (global.window.METRICS_REGISTRY[key] || {}).target || null);
    t.equal('the four KPIs lead, in the review order', entries.slice(0, 3).map((e) => e.key).join(','), 'aht,scheduleAdherence,overallSentiment');
    t.check('no survey score with no surveys behind it', !entries.some((e) => ['cxRepOverall', 'fcr', 'overallExperience'].indexOf(e.key) > -1));
    const text = ooo.buildTalkingPoints({ employeeName: 'Eli Brooks', date: '2026-10-14', yearToDate: entries });
    t.check('every line has its unit', /Average Handle Time: 439s against a 426s goal/.test(text) && /Schedule Adherence: 96\.6% against a 93% goal/.test(text));
    t.check('no ".0" on a goal', !/\d\.0(%|s\b| hrs?\b)/.test(text));
});

suite('review voice: the trend coaching prompt is handed values with units', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const start = script.indexOf('async function generateTrendCoachingEmail');
    const body = script.slice(start, script.indexOf('\n}', start));
    t.check('the formatter it gets is the display one', /formatMetricValue: formatMetricDisplay/.test(body));
    t.check('not the bare value one', !/^\s*formatMetricValue,\s*$/m.test(body));
});
