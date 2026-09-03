'use strict';

/**
 * Placings on the year card, and the one thing that makes them safe to send.
 *
 * This card goes to the associate, and it deliberately carries no overall
 * placing. A composite rank is a management number and it turns a coaching
 * picture into a league table. A placing inside a SINGLE metric is a different
 * claim and a useful one, because it names the thing to work on. It stays
 * honest only while it is unmistakably per metric, so the footer has to say so.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    global.window.METRICS_REGISTRY = { aht: { isReverse: true }, scheduleAdherence: {} };
    global.window.isReverseMetric = (key) => !!(global.window.METRICS_REGISTRY[key] || {}).isReverse;
    return t.loadModule('modules/center-ranking.module.js').centerRanking;
}

function field(name, values, reliability) {
    return { name, holder: { values, reliability: reliability === undefined ? null : reliability } };
}

suite('year card: a placing is worked out inside one metric', (t) => {
    const ranking = load(t);

    // Adherence is higher-is-better, so the biggest number places first.
    const adherence = ranking.rankWithinMetric([
        field('Low', { adherence: 88 }),
        field('High', { adherence: 97 }),
        field('Mid', { adherence: 93 })
    ], { label: 'Adherence', scoreKey: 'adherence', registry: 'scheduleAdherence' });

    t.equal('the best number is first', adherence.High.rank, 1);
    t.equal('then the middle', adherence.Mid.rank, 2);
    t.equal('then the lowest', adherence.Low.rank, 3);
    t.equal('and the field size travels with it', adherence.High.total, 3);

    // AHT is lower-is-better. Ranking it the same way round would tell the
    // slowest handler they were leading the centre.
    const aht = ranking.rankWithinMetric([
        field('Slow', { aht: 500 }),
        field('Fast', { aht: 300 })
    ], { label: 'AHT', scoreKey: 'aht', registry: 'aht' });

    t.equal('the lowest handle time leads', aht.Fast.rank, 1);
    t.equal('and the highest does not', aht.Slow.rank, 2);
});

suite('year card: ties share a placing and blanks are not ranked', (t) => {
    const ranking = load(t);

    const map = ranking.rankWithinMetric([
        field('A', { adherence: 95 }),
        field('B', { adherence: 95 }),
        field('C', { adherence: 90 }),
        field('D', { adherence: null }),
        field('E', {})
    ], { label: 'Adherence', scoreKey: 'adherence', registry: 'scheduleAdherence' });

    t.equal('the tie shares first', map.A.rank, 1);
    t.equal('both of them', map.B.rank, 1);
    // Competition ranking: the next placing is third, not second.
    t.equal('and the next is third', map.C.rank, 3);

    // Somebody the metric never measured is not last, they are absent. Ranking
    // a blank as worst is how a person gets told they are 127th on a month
    // nobody scored them in.
    t.check('an unmeasured person is left out', !map.D && !map.E);
    t.equal('so the field is only the measured ones', map.A.total, 3);
});

suite('year card: placings say what they are', (t) => {
    const ranking = load(t);

    t.equal('1st', ranking.ordinal(1), '1st');
    t.equal('2nd', ranking.ordinal(2), '2nd');
    t.equal('3rd', ranking.ordinal(3), '3rd');
    t.equal('4th', ranking.ordinal(4), '4th');
    t.equal('11th, not 11st', ranking.ordinal(11), '11th');
    t.equal('12th, not 12nd', ranking.ordinal(12), '12th');
    t.equal('13th, not 13rd', ranking.ordinal(13), '13th');
    t.equal('21st', ranking.ordinal(21), '21st');
    t.equal('101st', ranking.ordinal(101), '101st');
    t.equal('111th', ranking.ordinal(111), '111th');

    // The disclaimer is the whole reason these are safe to put in an inbox.
    const src = fs.readFileSync(path.join(ROOT, 'modules/center-ranking.module.js'), 'utf8');
    t.check('the card says the placings are per metric',
        src.indexOf('within that one metric') > -1);
    t.check('and that they are not an overall ranking',
        src.indexOf('not an overall ranking') > -1);
});

suite('year card: the verdict is the cell colour, not a pill inside it', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'modules/center-ranking.module.js'), 'utf8');

    // A shaded cell already says meets or below. The pill was saying it twice
    // and spending the row height to do it.
    t.check('the pills are gone', src.indexOf("m.meets ? 'meets' : 'below'") === -1);
    t.check('the cell is shaded instead', /function shade/.test(src) || src.indexOf('var shade = function') > -1);
    t.check('and the footer explains the colours',
        src.indexOf('Green meets the target, red is below it.') > -1);

    // A placing with no field size on it has to be explained once, in the
    // footer, or it reads as an overall placing.
    t.check('the placing is just the ordinal', src.indexOf('_ordinal(m.rank) + " of "') === -1);
    t.check('and the footer says what it is measured against',
        src.indexOf('against everyone measured in that column') > -1);
});

suite('year card: the centre average is weighted, never a flat mean', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'modules/center-ranking.module.js'), 'utf8');
    const start = src.indexOf('function _centerAverageForMetric');
    t.check('there is a centre average', start > -1);

    const fn = src.slice(start, start + 1600);

    // A flat mean of per person rates counts a twelve call week the same as a
    // two hundred call one. Everywhere else in this app aggregates by volume,
    // and a number printed beside somebody's name is no place to stop.
    t.check('rate metrics are weighted', /wSum \+= Number\(value\) \* weight/.test(fn));
    t.check('surveys weight by survey count', /surveyTotal/.test(fn));
    t.check('everything else by calls', /totalCalls/.test(fn));

    // Hours missed is the exception. The centre TOTAL is a five figure number
    // nobody can place themselves against, so that one is a mean per person.
    t.check('reliability is a per person mean', /reliability/.test(fn) && /values\.length/.test(fn));
});
