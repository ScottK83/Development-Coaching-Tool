'use strict';

/**
 * THE BEST TRUE THING TO SAY
 *
 * Scott, 2026-10-14: "Make sure to, in every piece of feedback ... make sure
 * to provide positive feedback." messageVoice.truePositive is the one place
 * a message asks "what can I honestly praise" when nothing is on target.
 */

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    global.window.METRICS_REGISTRY = {
        aht: { label: 'Average Handle Time', unit: 'sec', isReverse: true },
        scheduleAdherence: { label: 'Schedule Adherence', unit: '%' },
        overallExperience: { label: 'Overall Experience', unit: '%' },
        reliability: { label: 'Reliability', unit: 'hrs', isReverse: true }
    };
    global.window.formatMetricDisplay = (key, value) => {
        const unit = global.window.METRICS_REGISTRY[key]?.unit;
        if (unit === 'sec') return `${Math.round(value)}s`;
        if (unit === '%') return `${String(Math.round(value * 10) / 10)}%`;
        return `${value} hrs`;
    };
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/message-voice.module.js');
    return global.window.DevCoachModules.messageVoice;
}

suite('true positive: best first, and always something', (t) => {
    const voice = load(t);

    const onTarget = voice.truePositive([
        { key: 'aht', value: 400, target: 420 },
        { key: 'scheduleAdherence', value: 90, target: 93 }
    ]);
    t.equal('a goal on target leads', onTarget.kind, 'atGoal');
    t.check('named with its number', /Average Handle Time is on target at 400s/.test(onTarget.text));

    const moved = voice.truePositive([
        { key: 'aht', value: 450, target: 420, prior: 480 },
        { key: 'scheduleAdherence', value: 90, target: 93, prior: 90.2 }
    ]);
    t.equal('then a real move the right way', moved.kind, 'improved');
    t.check('said in words, the right way round for a reverse metric', /moving the right way, down 30 seconds/.test(moved.text));

    const noise = voice.truePositive([
        { key: 'scheduleAdherence', value: 90.3, target: 93, prior: 90 }
    ]);
    t.check('a move inside the noise is not praised as one', noise.kind !== 'improved');

    const center = voice.truePositive([
        { key: 'overallExperience', value: 78, target: 82, center: 74 }
    ], { ongoing: false });
    t.equal('then better than the center', center.kind, 'aboveCenter');
    t.check('in the past tense for a finished period', /was better than the center average of 74%/.test(center.text));

    const closest = voice.truePositive([
        { key: 'aht', value: 520, target: 420 },
        { key: 'scheduleAdherence', value: 91, target: 93 }
    ]);
    t.equal('then the closest to goal', closest.kind, 'closest');
    // Still a miss, so it is named as close, never as good news or "a good
    // place to build from" (Scott, 2026-10-26).
    t.equal('the nearer one, as a share of its goal, said as close', closest.text,
        'Your Schedule Adherence is the closest to goal, 91% with a 93% goal, so only 2 points to go.');
    const far = voice.truePositive([
        { key: 'aht', value: 620, target: 420 },
        { key: 'scheduleAdherence', value: 80, target: 93 }
    ], { ongoing: false });
    t.equal('"only" is said only when it is true, and a finished stretch is past tense', far.text,
        'Your Schedule Adherence was the closest to goal, 80% with a 93% goal, 13 points short.');

    const nothing = voice.truePositive([]);
    t.equal('with nothing at all, the effort', nothing.kind, 'effort');
    t.check('and it still says something kind', /effort/.test(nothing.text));
});

suite('true positive: never false praise', (t) => {
    const voice = load(t);

    t.equal('no calls is effort only', voice.truePositive([
        { key: 'aht', value: 0, target: 420 }
    ], { tookNoCalls: true }).kind, 'effort');
    t.check('a 0 second handle time is never a win', voice.truePositive([
        { key: 'aht', value: 0, target: 420 }
    ]).kind !== 'atGoal');
    t.check('hours are never praise material', voice.truePositive([
        { key: 'reliability', value: 2, target: 18 }
    ]).kind === 'effort');

    const lines = [
        voice.truePositive([{ key: 'aht', value: 450, target: 420, prior: 480 }]).text,
        voice.truePositive([{ key: 'overallExperience', value: 78, target: 82, center: 74 }]).text,
        voice.truePositive([{ key: 'aht', value: 520, target: 420 }, { key: 'scheduleAdherence', value: 91, target: 93 }]).text,
        voice.truePositive([]).text,
        voice.truePositive([], { ongoing: false }).text
    ];
    t.check('no em dashes', !lines.some(line => /[—–]/.test(line)));
    t.check('no .0 or + signs on a move', !lines.some(line => /\.0\b|\+\d/.test(line)));
});
