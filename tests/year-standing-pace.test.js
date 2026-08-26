'use strict';

const { suite } = require('./harness');

/**
 * The other half of the placing gate.
 *
 * Somebody within reach of a tier gets the placing and the door that goes with
 * it. Everybody else gets the same arithmetic with the placing withheld, and
 * that is what lands under a year standing bullet. So the line has to do two
 * things at once: say what would actually move the number, and give away
 * nothing about where the person stands. The four patterns at the bottom of
 * every suite here are the same four the year-standing guardrail file runs, on
 * purpose, because the new line is copy that reaches an associate exactly like
 * the bullet above it.
 */

const REGISTRY = {
    scheduleAdherence: { unit: '%', isReverse: false, label: 'Schedule Adherence' },
    fcr: { unit: '%', isReverse: false, label: 'First Call Resolution' }
};

// The rendering of an entry with nothing extra on it, spelled out rather than
// regenerated, so a change to the bullet has to be made here on purpose.
const PLAIN =
    '📅 Where the year stands\n'
    + '  • Schedule Adherence 91.2% against a 93% target: the floor has been passing you here.';

function load(t, withProjection) {
    t.installFakeBrowser();
    global.window.METRICS_REGISTRY = REGISTRY;
    global.window.MIN_CALLS_TO_JUDGE = 20;
    global.window.getMetricNoiseThreshold = () => 1;
    global.window.formatMetricDisplay = (k, v) => `${Number(v).toFixed(1)}%`;
    const mods = t.loadModule('modules/year-standing.module.js');
    if (withProjection) t.loadModule('modules/rank-projection.module.js');
    return mods.yearStanding;
}

function entry(extra) {
    return Object.assign({
        label: 'Schedule Adherence',
        valueText: '91.2%',
        targetText: '93%',
        movement: 'slipping'
    }, extra || {});
}

// The rule the whole file exists to hold: nothing that reaches an associate
// carries a position, a peer count, or the word itself.
function checkPlacingFree(t, where, text) {
    t.check(`${where}: no rank position appears`, !/\b\d+(st|nd|rd|th)\b/.test(text));
    t.check(`${where}: no peer count appears`, !/\b\d+\s+(of|out of)\s+\d+/.test(text));
    t.check(`${where}: nobody is called top anything`, !/top \d/i.test(text));
    t.check(`${where}: the word rank never appears`, !/\brank(ed|ing)?\b/i.test(text));
}

suite('year standing pace: the answer a direction cannot give', (t) => {
    const ys = load(t, true);
    const rp = global.window.DevCoachModules.rankProjection;

    // 91.2% banked over four thousand calls, with 2,124 calls left in the year
    // and 96.4% the average the rest of it has to hold for the year to land on
    // the 93% target. These are the numbers the pulse hands over.
    const projected = rp.projectValue(91.2, 4000, 96.4, 2124);
    const pace = rp.buildPaceClause({
        rankKey: 'adherence',
        currentValue: 91.2,
        target: 93,
        assumedValue: 96.4,
        projectedValue: projected,
        periods: 18,
        maxPeriods: 18
    });
    t.check('the projection module has something to say here', pace.length > 0);

    const text = ys.buildYearStandingText([entry({ paceText: pace })]);

    t.check('the direction still leads', text.indexOf('passing you') > -1);
    t.check('and the number they know is still there', text.indexOf('91.2%') > -1);
    t.check('the pace line follows it', text.indexOf(pace) > -1);
    t.check('indented under the bullet, not beside it', text.indexOf(`.\n    ${pace}`) > -1);
    t.equal('and it is not a second bullet', (text.match(/^  • /gm) || []).length, 1);

    // The pace sentence is the one part of this block that names a number
    // nobody has hit yet, so it has to name what buys it.
    t.check('it says what holding the number does to the year', text.indexOf('brings the year to') > -1);

    checkPlacingFree(t, 'a rendered pace line', text);
});

suite('year standing pace: a month of work, and the whole year of it', (t) => {
    const ys = load(t, true);
    const rp = global.window.DevCoachModules.rankProjection;

    // The near-term form: four weeks of the same volume, and the honest count
    // of how many it really takes. Both shapes go into the same bullet, so
    // both get held to the same rule.
    const monthOut = rp.projectValue(91.2, 4000, 96.4, 4 * 118);
    const pace = rp.buildPaceClause({
        rankKey: 'adherence',
        currentValue: 91.2,
        target: 93,
        assumedValue: 96.4,
        projectedValue: monthOut,
        periods: 4,
        periodsToTarget: 18,
        maxPeriods: 18
    });

    t.check('four weeks is spelled as a word', pace.indexOf('Four weeks') === 0);
    t.check('and the real count is named', pace.indexOf('over the line') > -1);

    const text = ys.buildYearStandingText([entry({ paceText: pace })]);
    checkPlacingFree(t, 'the near-term pace line', text);

    // An em dash in the bullet is old and stays; a new one would not.
    const paceLine = text.split('\n').filter(line => line.indexOf('    ') === 0)[0] || '';
    t.check('no em dash arrives with the new line', paceLine.indexOf('—') === -1);
});

suite('year standing pace: an entry without one renders as it always did', (t) => {
    const ys = load(t, true);

    t.equal('no pace field at all', ys.buildYearStandingText([entry()]), PLAIN);
    t.equal('an empty pace is the same as none', ys.buildYearStandingText([entry({ paceText: '' })]), PLAIN);
    t.equal('and so is a missing one', ys.buildYearStandingText([entry({ paceText: null })]), PLAIN);
    t.equal('and so is whitespace', ys.buildYearStandingText([entry({ paceText: '   ' })]), PLAIN);
});

suite('year standing pace: no projection module, no change', (t) => {
    // Nothing on the page has loaded rank-projection. The pulse cannot build a
    // pace sentence, so nothing fills the field in, and the block has to come
    // out byte for byte what it was before any of this was added.
    const ys = load(t, false);

    t.check('the projection module really is absent', !global.window.DevCoachModules.rankProjection);
    t.equal('the block is untouched', ys.buildYearStandingText([entry({ paceText: '' })]), PLAIN);

    const text = ys.buildYearStandingText([
        entry(),
        { label: 'First Call Resolution', valueText: '78.4%', targetText: '73%', movement: 'gaining' }
    ]);
    t.equal('both lines are still bullets', (text.match(/^  • /gm) || []).length, 2);
    checkPlacingFree(t, 'the unchanged block', text);
});

suite('year standing pace: a placing in the field is refused, not printed', (t) => {
    const ys = load(t, false);

    // buildPaceClause cannot produce any of these. A future caller writing its
    // own sentence can, and this module is the last thing between that sentence
    // and an associate, so it drops it whole rather than trusting the source.
    const smuggled = [
        'Four weeks at 96.4% and you would be 18th.',
        'Four weeks at 96.4% puts you 14 of 127.',
        'Four weeks at 96.4% gets you into the top 25.',
        'Four weeks at 96.4% moves your rank.'
    ];

    smuggled.forEach(pace => {
        const text = ys.buildYearStandingText([entry({ paceText: pace })]);
        t.equal(`refused: ${pace}`, text, PLAIN);
        checkPlacingFree(t, 'a refused pace line', text);
    });

    // The honest sentence still gets through the same gate.
    t.equal('and a clean sentence is kept',
        ys.safePaceText('Four weeks at 96.4% brings the year to 91.6%.'),
        'Four weeks at 96.4% brings the year to 91.6%.');
});
