'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

// Guards the bug CLASS, not just the two bugs. Trend direction is normalized
// to performance, so any module that re-derives the wording from it can get a
// reverse metric backwards. These checks fail if a module starts doing its own
// polarity reasoning again.

const RENDERERS = [
    'modules/metric-trends.module.js',
    'modules/q1-review.module.js',
    'modules/morning-pulse.module.js'
];

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Scanning every module, not just the ones known to render trends. The third
// offender (trend-intelligence) was found by widening this check, not by
// remembering it existed.
function allSources() {
    const dir = path.join(ROOT, 'modules');
    return fs.readdirSync(dir)
        .filter((f) => f.endsWith('.module.js'))
        .map((f) => ({ name: f, src: fs.readFileSync(path.join(dir, f), 'utf8') }))
        .concat([{ name: 'script.js', src: read('script.js') }]);
}

// Comments explain the trap on purpose; only live code is checked.
function stripComments(src) {
    return src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

suite('trend wording — no module re-derives polarity', (t) => {
    allSources().forEach(({ name, src }) => {
        const live = stripComments(src);
        if (name === 'metric-movement.module.js') return; // the owner may

        // The exact shape both shipped bugs had: branching on the direction
        // string to pick a glyph, without asking which way the metric runs.
        const handRolledArrow = /'improving'\s*\?\s*['"`][^'"`]*(&#96[56]0|▲|▼)/.test(live);
        if (handRolledArrow) t.check(`${name}: no hand-rolled trend arrow`, false);

        // A direction word is only safe if the metric's polarity is known.
        const directionWord = /(trending up|trending down)/i.test(live);
        if (directionWord) t.check(`${name}: no "trending up/down" in live code`, false);
    });
    t.check('no module states a raw trend direction without polarity',
        allSources().every(({ name, src }) => {
            if (name === 'metric-movement.module.js') return true;
            const live = stripComments(src);
            return !/'improving'\s*\?\s*['"`][^'"`]*(&#96[56]0|▲|▼)/.test(live)
                && !/(trending up|trending down)/i.test(live);
        }));
});

suite('trend wording — renderers go through metricMovement', (t) => {
    RENDERERS.forEach((rel) => {
        const src = read(rel);
        t.check(`${path.basename(rel)}: references metricMovement`, src.includes('metricMovement'));
    });
});

suite('trend wording — the shared owner is loaded before its consumers', (t) => {
    const html = read('index.html');
    const pos = (f) => html.indexOf(f);
    const owner = pos('modules/metric-movement.module.js');
    t.check('metric-movement is in the loader', owner > -1);
    RENDERERS.forEach((rel) => {
        const consumer = pos(rel);
        t.check(`${path.basename(rel)} loads after metric-movement`, consumer > owner);
    });
});

suite('trend wording — renderers agree with the owner', (t) => {
    // Load the owner and confirm the wording each module now emits is the
    // wording the owner produces, for a metric that runs each way.
    t.installFakeBrowser();
    global.window.METRICS_REGISTRY = {
        aht: { unit: 'sec', isReverse: true, label: 'Average Handle Time' },
        fcr: { unit: '%', isReverse: false, label: 'First Call Resolution' }
    };
    global.window.formatMetricDisplay = (k, v) => (k === 'aht' ? `${Math.round(v)}s` : `${v}%`);
    const mm = t.loadModule('modules/metric-movement.module.js').metricMovement;

    // Q1 Review's phrase, as the module now calls it.
    t.equal('reverse metric declining phrases as "getting worse"', mm.phrase('aht', 'declining'), ' (getting worse)');
    t.equal('reverse metric improving phrases as "improving"', mm.phrase('aht', 'improving'), ' (improving)');

    // The arrow both Q1 Review and the Pulse cards now render.
    t.check('improving AHT gets a DOWN arrow', mm.arrowHtml('aht', 'improving').includes('▼'));
    t.check('declining AHT gets an UP arrow', mm.arrowHtml('aht', 'declining').includes('▲'));
    t.check('improving FCR gets an UP arrow', mm.arrowHtml('fcr', 'improving').includes('▲'));
    t.check('declining FCR gets a DOWN arrow', mm.arrowHtml('fcr', 'declining').includes('▼'));

    // The Pulse focus suffix.
    t.equal('a worsening AHT is "climbing"', mm.describe('aht', 'declining', null).numberRose, true);
    t.equal('a worsening FCR is "slipping"', mm.describe('fcr', 'declining', null).numberRose, false);
});
