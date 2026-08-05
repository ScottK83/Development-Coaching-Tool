'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/highlights.module.js');
    return t.loadModule('modules/team-hub.module.js');
}

suite('team hub: metric specs come from the registry, not hand-typed numbers', (t) => {
    const modules = load(t);
    const hub = modules.teamHub;

    const specs = hub.buildMetricSpecs(['scheduleAdherence', 'aht', 'fcr', 'totalCalls']);
    const byKey = Object.fromEntries(specs.map(s => [s.key, s]));

    t.check('volume has no target so it is not eligible', !('totalCalls' in byKey));
    t.equal('adherence is a "clear the bar" metric', byKey.scheduleAdherence.targetType, 'min');
    t.equal('AHT is a "stay under" metric', byKey.aht.targetType, 'max');
    t.check('targets are real numbers', Number.isFinite(byKey.aht.target) && byKey.aht.target > 0);
    t.check('labels come from the registry', byKey.fcr.label === window.METRICS_REGISTRY.fcr.label);

    // The noise band is what stops a rep who cleared target by 0.1 reading the
    // same as one who cleared it by six points.
    t.check('every spec carries a noise band', specs.every(s => Number.isFinite(s.noise)));
    t.check('AHT needs a bigger move than adherence, since it is measured in seconds',
        byKey.aht.noise > byKey.scheduleAdherence.noise);

    t.equal('an unknown metric is skipped rather than guessed at', hub.buildMetricSpecs(['notAMetric']).length, 0);
});

suite('team hub: the daily window drops metrics a single day cannot settle', (t) => {
    const modules = load(t);
    const hub = modules.teamHub;

    // Survey-based metrics need days of surveys to mean anything, so they are
    // deliberately absent from the "yesterday" scope.
    hub.SURVEY_METRIC_KEYS.forEach(key => {
        t.check(`${key} is not a yesterday metric`, hub.DAILY_METRIC_KEYS.indexOf(key) === -1);
    });

    t.check('adherence is', hub.DAILY_METRIC_KEYS.indexOf('scheduleAdherence') > -1);
    t.check('and so is AHT', hub.DAILY_METRIC_KEYS.indexOf('aht') > -1);

    const specs = hub.buildMetricSpecs(hub.DAILY_METRIC_KEYS);
    t.equal('every daily metric resolves to a spec', specs.length, hub.DAILY_METRIC_KEYS.length);
});

suite('team hub: initializing without its markup is a no-op, not a crash', (t) => {
    const modules = load(t);
    const hub = modules.teamHub;

    // Navigation calls initializeTeamHub on every My Team tab switch. If it
    // threw when the markup wasn't there, switching tabs would break.
    let threw = null;
    try {
        hub.initializeTeamHub();
        hub.initializeHighlights();
        hub.renderHighlights();
        hub.renderTeamSelector(null);
        hub.refreshVisibleMyTeamSection();
    } catch (err) {
        threw = err;
    }

    t.check('nothing throws with no DOM to draw into', threw === null);
});

suite('team hub: highlights read end to end from a real registry', (t) => {
    const modules = load(t);
    const hub = modules.teamHub;
    const engine = modules.highlights;

    const specs = hub.buildMetricSpecs(hub.DAILY_METRIC_KEYS);
    const entries = engine.findHighlights([
        { name: 'Alyssa Dimes', totalCalls: 80, scheduleAdherence: 99, aht: 360 },
        { name: 'Michelle Castro', totalCalls: 75, scheduleAdherence: 88, aht: 520 }
    ], { metrics: specs, minCalls: 10 });

    t.equal('only the rep who beat the real targets is named', entries.length, 1);
    t.equal('and it is the right one', entries[0].name, 'Alyssa Dimes');

    const line = engine.buildHighlightLine(entries[0], { preferredName: (n) => n.split(' ')[0] });
    t.check('the line names them', line.indexOf('Alyssa') === 0);
    t.check('and never mentions a rank', !/\b(rank|tier|#\d|top \d)\b/i.test(line));
});
