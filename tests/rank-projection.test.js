'use strict';

const { suite } = require('./harness');

const REGISTRY = {
    scheduleAdherence: { unit: '%',   isReverse: false, label: 'Schedule Adherence' },
    cxRepOverall:      { unit: '%',   isReverse: false, label: 'Rep Satisfaction' },
    fcr:               { unit: '%',   isReverse: false, label: 'First Call Resolution' },
    overallExperience: { unit: '%',   isReverse: false, label: 'Overall Experience' },
    overallSentiment:  { unit: '%',   isReverse: false, label: 'Overall Sentiment' },
    transfers:         { unit: '%',   isReverse: true,  label: 'Transfers' },
    aht:               { unit: 'sec', isReverse: true,  label: 'Average Handle Time' },
    reliability:       { unit: 'hrs', isReverse: true,  label: 'Reliability' }
};

// The real noise table, for the keys this module can reach.
const NOISE = { scheduleAdherence: 1, overallSentiment: 1, cxRepOverall: 2, fcr: 2, overallExperience: 2, aht: 15 };

function load(t) {
    t.installFakeBrowser();
    global.window.METRICS_REGISTRY = REGISTRY;
    global.window.MIN_CALLS_TO_JUDGE = 20;
    global.window.getMetricNoiseThreshold = (k) => (NOISE[k] === undefined ? 1 : NOISE[k]);
    global.window.formatMetricDisplay = (k, v) => {
        const unit = (REGISTRY[k] || {}).unit || '%';
        if (unit === 'sec') return `${Math.round(v)} sec`;
        if (unit === 'hrs') return `${Number(v).toFixed(2)} hrs`;
        return `${Number(v).toFixed(1)}%`;
    };
    return t.loadModule('modules/rank-projection.module.js').rankProjection;
}

// A field big enough to have a middle. Eve has no adherence figure at all,
// which is not the same as a bad one and must not take up a place.
function buildField() {
    const row = (name, adherence, aht, totalCalls, surveyTotal) => ({
        name,
        values: { adherence, aht, sentiment: 90, associateOverall: 88 },
        extraValues: { fcr: 74, overallExperience: 76 },
        reliability: 4,
        totalCalls,
        surveyTotal
    });
    return [
        row('Ada', 97.0, 500, 900, 12),
        row('Ben', 95.5, 540, 880, 11),
        row('Cara', 94.6, 560, 910, 9),
        row('Dev', 92.1, 610, 870, 14),
        row('Eve', null, 700, 840, 10)
    ];
}

suite('rank projection: the blend is weighted, and the weight is the point', (t) => {
    const rp = load(t);

    // A light month against a heavy year. Straight-averaging these two gives
    // 93.6%, which reads like one good month nearly closing the gap. It is not
    // what happens, and people were sent after it.
    const blended = rp.projectValue(91.2, 4000, 96.0, 400);
    t.equal('four thousand calls of 91.2 barely move for four hundred at 96',
        Math.round(blended * 100) / 100, 91.64);
    t.check('and nowhere near the equal-weight answer', Math.abs(blended - 93.6) > 1.5);

    // Weight the other way and the same two numbers land somewhere else
    // entirely, which is the whole reason the volumes have to be carried.
    const flipped = rp.projectValue(91.2, 400, 96.0, 4000);
    t.equal('reverse the volumes and the new value dominates',
        Math.round(flipped * 100) / 100, 95.56);

    t.equal('no volume behind the year leaves only the assumption',
        rp.projectValue(91.2, 0, 96.0, 400), 96.0);
});

suite('rank projection: the blend refuses nonsense rather than guessing', (t) => {
    const rp = load(t);

    // A projection built on a made-up input looks exactly like a real one, so
    // there is nothing safe to return here except nothing.
    t.check('a missing current value yields nothing', rp.projectValue(null, 4000, 96, 400) === null);
    t.check('a missing assumption yields nothing', rp.projectValue(91.2, 4000, undefined, 400) === null);
    t.check('an empty string is not a zero', rp.projectValue('', 4000, 96, 400) === null);
    t.check('infinity yields nothing', rp.projectValue(91.2, 4000, Infinity, 400) === null);
    t.check('a negative volume yields nothing', rp.projectValue(91.2, -100, 96, 400) === null);
    t.check('a negative assumed volume yields nothing', rp.projectValue(91.2, 4000, 96, -400) === null);
    t.check('no volume anywhere yields nothing', rp.projectValue(91.2, 0, 96, 0) === null);
});

suite('rank projection: the door is the value standing in that place', (t) => {
    const rp = load(t);
    const field = buildField();

    t.equal('third place on adherence is holding 94.6', rp.thresholdValueForRank(field, 'adherence', 3), 94.6);
    t.equal('and first is the best of them', rp.thresholdValueForRank(field, 'adherence', 1), 97.0);

    // Lower is better, so the door is at the bottom of the sort.
    t.equal('second place on handle time is the second fastest', rp.thresholdValueForRank(field, 'aht', 2), 540);

    // Eve has no adherence value, so there are four scored people and no fifth
    // place to ask about. A blank is not a bad score.
    t.check('a place deeper than the scored field has no value', rp.thresholdValueForRank(field, 'adherence', 5) === null);
    t.check('but handle time has five scored, so five exists', rp.thresholdValueForRank(field, 'aht', 5) === 700);
    t.check('a place of zero is not a place', rp.thresholdValueForRank(field, 'adherence', 0) === null);
    t.check('nor is half a place', rp.thresholdValueForRank(field, 'adherence', 2.5) === null);
});

suite('rank projection: a projected placing freezes the field', (t) => {
    const rp = load(t);
    const field = buildField();

    // Dev is last of the scored on adherence at 92.1.
    t.equal('Dev today would be fourth', rp.projectRank(field, 'adherence', 'Dev', 92.1), 4);
    t.equal('at 96.0 he is second', rp.projectRank(field, 'adherence', 'Dev', 96.0), 2);
    t.equal('and past everyone at 99.0', rp.projectRank(field, 'adherence', 'Dev', 99.0), 1);

    // Handle time runs the other way, and getting this backwards would put the
    // slowest person on the floor at the top of the board.
    t.equal('a lower handle time climbs', rp.projectRank(field, 'aht', 'Dev', 480), 1);
    t.equal('and a higher one does not', rp.projectRank(field, 'aht', 'Dev', 610), 4);

    // 1-2-2-4, the same rule the rankings table uses, so the manager view and
    // the table cannot disagree about whether a move happened.
    t.equal('tying into second shares second', rp.projectRank(field, 'adherence', 'Dev', 95.5), 2);

    t.check('somebody not in the field has no place', rp.projectRank(field, 'adherence', 'Nobody', 99) === null);
    t.check('a value that is not a number has no place', rp.projectRank(field, 'adherence', 'Dev', null) === null);
    t.check('an empty field has no places in it', rp.projectRank([], 'adherence', 'Dev', 99) === null);
});

suite('rank projection: polarity survives a missing resolver', (t) => {
    const rp = load(t);
    const field = buildField();

    // Modules load in an order that has bitten this app before, so a resolver
    // that is absent or angry must fall through to the registry flag rather
    // than quietly deciding that slower is better.
    global.window.isReverseMetric = () => { throw new Error('not loaded yet'); };
    t.equal('a throwing resolver still sorts handle time low-first',
        rp.projectRank(field, 'aht', 'Dev', 480), 1);

    global.window.isReverseMetric = (k) => (REGISTRY[k] || {}).isReverse === true;
    t.equal('and a working one agrees', rp.projectRank(field, 'aht', 'Dev', 480), 1);
});

suite('rank projection: how long it takes is walked, not assumed', (t) => {
    const rp = load(t);

    const base = { currentValue: 91.2, volumeSoFar: 4000, volumePerPeriod: 400, assumedValue: 96, isReverse: false };

    // Six periods of four hundred calls at 96 puts the year on exactly 93.
    t.equal('six weeks at 96 crosses a 93 target', rp.periodsToReach(Object.assign({}, base, { goalValue: 93 })), 6);
    t.equal('a nearer goal comes sooner', rp.periodsToReach(Object.assign({}, base, { goalValue: 92 })), 2);

    // Already there is zero, not one. Telling somebody it takes a week to reach
    // a number they are already holding is the kind of thing that gets the
    // whole message ignored.
    t.equal('a goal already met takes no time at all',
        rp.periodsToReach(Object.assign({}, base, { goalValue: 90 })), 0);

    // The blend converges on the assumed value, so an assumption sitting on the
    // goal approaches it forever and never arrives.
    t.check('an assumption equal to the goal never gets there',
        rp.periodsToReach(Object.assign({}, base, { assumedValue: 93, goalValue: 93 })) === null);
    t.check('an assumption below the goal never gets there',
        rp.periodsToReach(Object.assign({}, base, { assumedValue: 92, goalValue: 93 })) === null);

    // "Not this year" is a real answer and must not be dressed up as a number.
    // A goal a whisker under the assumed value is technically reachable and
    // practically not, and the default cap of a year's weeks is what says so.
    t.check('unreachable inside a year is unreachable',
        rp.periodsToReach(Object.assign({}, base, { goalValue: 95.9 })) === null);
    t.equal('an absurd horizon does find it, which is why there is a cap',
        rp.periodsToReach(Object.assign({}, base, { goalValue: 95.9, maxPeriods: 500 })), 470);

    // Lower is better, so the goal is crossed from above.
    t.equal('handle time falls toward its goal', rp.periodsToReach({
        currentValue: 620, volumeSoFar: 4000, volumePerPeriod: 4000, assumedValue: 560,
        goalValue: 600, isReverse: true
    }), 1);

    t.check('no volume per period is no plan', rp.periodsToReach(Object.assign({}, base, { volumePerPeriod: 0, goalValue: 93 })) === null);
    t.check('a missing goal is no plan', rp.periodsToReach(Object.assign({}, base, { goalValue: null })) === null);
    t.check('nothing at all is no plan', rp.periodsToReach() === null);
});

suite('rank projection: reliability is never projectable', (t) => {
    const rp = load(t);
    const fat = { name: 'Ada', values: { adherence: 97 }, reliability: 0, totalCalls: 5000, surveyTotal: 200 };

    // Hours missed against an annual budget is not an average, so "keep this up
    // for a month" is a category error, and a projected attendance placing is
    // the line most likely to cause a real problem for a real person.
    t.equal('a perfect record does not make it projectable', rp.isProjectable('reliability', fat), false);
    t.equal('nor does an enormous call count', rp.isProjectable('reliability', { totalCalls: 99999 }), false);
    t.equal('nor an unknown volume', rp.isProjectable('reliability', { name: 'Ada' }), false);
    t.check('and it has no registry key to travel through', rp.RANK_TO_REGISTRY.reliability === undefined);
    t.check('it is not on the projectable list', rp.PROJECTABLE_RANK_KEYS.indexOf('reliability') === -1);

    // The other ranked extras are real numbers, but nobody is coached to a
    // Transfers pace, so they are off the list too.
    t.equal('transfers ranks but does not pace', rp.isProjectable('transfers', fat), false);
    t.equal('an unknown key is not projectable', rp.isProjectable('nonsense', fat), false);
    t.equal('and no row at all is not projectable', rp.isProjectable('adherence', null), false);
});

suite('rank projection: the volume floors are the ones already in use', (t) => {
    const rp = load(t);

    t.equal('a full week of calls is projectable',
        rp.isProjectable('adherence', { totalCalls: 900 }), true);
    t.equal('twelve calls is not', rp.isProjectable('adherence', { totalCalls: 12 }), false);
    t.equal('a week they were absent for is not', rp.isProjectable('adherence', { totalCalls: 0 }), false);
    t.equal('exactly the floor clears the floor', rp.isProjectable('adherence', { totalCalls: 20 }), true);

    // An upload without the column would otherwise silence every projection on
    // the board at once, which is far worse than the thin-week problem the
    // floor exists to catch.
    t.equal('an absent call count passes', rp.isProjectable('adherence', { name: 'Ada' }), true);
    t.equal('a null call count passes', rp.isProjectable('adherence', { totalCalls: null }), true);
    t.equal('an empty call count passes', rp.isProjectable('adherence', { totalCalls: '' }), true);

    // Survey metrics carry the extra floor center ranking already applies.
    t.check('the survey keys are the survey-weighted ones',
        rp.SURVEY_WEIGHTED_RANK_KEYS.has('fcr')
        && rp.SURVEY_WEIGHTED_RANK_KEYS.has('associateOverall')
        && rp.SURVEY_WEIGHTED_RANK_KEYS.has('overallExperience'));
    t.equal('two surveys is not enough to pace against',
        rp.isProjectable('fcr', { totalCalls: 900, surveyTotal: 2 }), false);
    t.equal('three surveys is', rp.isProjectable('fcr', { totalCalls: 900, surveyTotal: 3 }), true);
    t.equal('an unknown survey count passes', rp.isProjectable('fcr', { totalCalls: 900 }), true);
    t.equal('but the call floor still applies to a survey metric',
        rp.isProjectable('fcr', { totalCalls: 4, surveyTotal: 30 }), false);
    t.equal('adherence is not held to a survey floor',
        rp.isProjectable('adherence', { totalCalls: 900, surveyTotal: 0 }), true);
});

suite('rank projection: churn is not progress', (t) => {
    const rp = load(t);

    // Whether something improved is not a question that gets to have two
    // answers, so this has to agree with the registry threshold exactly.
    Object.keys(NOISE).forEach((registryKey) => {
        const rankKey = Object.keys(rp.RANK_TO_REGISTRY).filter(k => rp.RANK_TO_REGISTRY[k] === registryKey)[0];
        if (!rankKey) return;
        const bar = NOISE[registryKey];
        t.equal(`just under the ${registryKey} bar is noise`, rp.moveIsNoise(rankKey, bar - 0.01), true);
        t.equal(`just over the ${registryKey} bar is not`, rp.moveIsNoise(rankKey, bar + 0.01), false);
        t.equal(`and the direction of the move does not matter for ${registryKey}`,
            rp.moveIsNoise(rankKey, -(bar + 0.01)), false);
    });

    // Failing shut: a key with nowhere to look up a threshold must not be
    // reported as progress on the strength of a number nobody validated.
    t.equal('an unmappable key is treated as noise', rp.moveIsNoise('reliability', 50), true);
    t.equal('an unreadable delta is treated as noise', rp.moveIsNoise('adherence', null), true);
    t.equal('and so is a delta of nothing', rp.moveIsNoise('adherence', 0), true);
});

suite('rank projection: the door clause names the door, not the placing promise', (t) => {
    const rp = load(t);

    const clause = rp.buildDoorClause({
        rankKey: 'adherence', doorRank: 25, doorValue: 94.6, assumedValue: 96, periods: 4
    });
    t.equal('the door reads as written',
        clause,
        'Top 25 sits at 94.6%. Four weeks at 96.0% gets you there, and holding it keeps you there.');
    t.check('the door is a value, not a person', clause.indexOf('94.6%') > -1);
    t.check('small counts are spelled out', clause.indexOf('Four weeks') > -1);
    t.check('and holding is part of the ask', clause.indexOf('keeps you there') > -1);
    t.check('no em dash reaches an associate', clause.indexOf('—') === -1);

    const one = rp.buildDoorClause({ rankKey: 'aht', doorRank: 10, doorValue: 545, assumedValue: 520, periods: 1 });
    t.check('one period reads singular', one.indexOf('One week at') > -1);
    t.check('and a reverse metric formats in its own unit', one.indexOf('545 sec') > -1);

    const eleven = rp.buildDoorClause({ rankKey: 'adherence', doorRank: 5, doorValue: 96, assumedValue: 98, periods: 11 });
    t.check('past ten the count is a numeral again', eleven.indexOf('11 weeks') > -1);
});

suite('rank projection: the door clause stays quiet when it cannot be honest', (t) => {
    const rp = load(t);

    // Holding a number equal to the door approaches the door forever without
    // passing it, so "gets you there" would be a sentence the arithmetic
    // disagrees with.
    t.equal('an assumption level with the door says nothing',
        rp.buildDoorClause({ rankKey: 'adherence', doorRank: 25, doorValue: 96, assumedValue: 96, periods: 4 }), '');
    t.equal('an assumption below the door says nothing',
        rp.buildDoorClause({ rankKey: 'adherence', doorRank: 25, doorValue: 96, assumedValue: 94, periods: 4 }), '');
    t.equal('a slower assumed handle time says nothing',
        rp.buildDoorClause({ rankKey: 'aht', doorRank: 10, doorValue: 545, assumedValue: 580, periods: 4 }), '');

    t.equal('zero periods is not a stretch of work',
        rp.buildDoorClause({ rankKey: 'adherence', doorRank: 25, doorValue: 94.6, assumedValue: 96, periods: 0 }), '');
    t.equal('a missing door value says nothing',
        rp.buildDoorClause({ rankKey: 'adherence', doorRank: 25, doorValue: null, assumedValue: 96, periods: 4 }), '');
    t.equal('reliability never gets a door clause',
        rp.buildDoorClause({ rankKey: 'reliability', doorRank: 25, doorValue: 2, assumedValue: 0, periods: 4 }), '');
    t.equal('and nothing at all says nothing', rp.buildDoorClause(), '');
});

suite('rank projection: the pace clause never leaks a placing', (t) => {
    const rp = load(t);

    // Four periods of four hundred calls at 96, on top of four thousand at
    // 91.2. Six periods puts the year on exactly 93.
    const projected = rp.projectValue(91.2, 4000, 96, 1600);
    const clause = rp.buildPaceClause({
        rankKey: 'adherence', currentValue: 91.2, target: 93, assumedValue: 96,
        projectedValue: projected, periods: 4
    });

    t.check('the pace is stated', clause.indexOf('Four weeks at 96.0%') > -1);
    t.check('and where it lands', clause.indexOf('brings the year to 92.6%') > -1);
    t.check('and what it takes to clear the target', clause.indexOf('Six gets you over the line') > -1);
    t.check('and that it has to be held', clause.indexOf('stays over') > -1);

    // The same guards the year standing copy is held to. A number that invites
    // somebody to compare themselves to a colleague has no business in a
    // message about their own pace.
    t.check('no rank position appears', !/\b\d+(st|nd|rd|th)\b/.test(clause));
    t.check('no peer count appears', !/\b\d+\s+(of|out of)\s+\d+/.test(clause));
    t.check('nobody is called top anything', !/top \d/i.test(clause));
    t.check('the word rank never appears', !/\brank(ed|ing)?\b/i.test(clause));
    t.check('no em dash reaches an associate', clause.indexOf('—') === -1);

    // A caller holding the real volumes should be able to hand over the
    // authoritative count instead of having it recovered from the projection.
    const supplied = rp.buildPaceClause({
        rankKey: 'adherence', currentValue: 91.2, target: 93, assumedValue: 96,
        projectedValue: projected, periods: 4, periodsToTarget: 6
    });
    t.equal('a supplied count matches the recovered one', supplied, clause);
});

suite('rank projection: the pace clause drops what it cannot support', (t) => {
    const rp = load(t);

    // No target, so no finish line to imply. The pace on its own is still worth
    // saying and still says nothing about anybody else.
    const bare = rp.buildPaceClause({
        rankKey: 'adherence', currentValue: 91.2, assumedValue: 96, projectedValue: 92.57, periods: 4
    });
    t.equal('with no target it is one sentence',
        bare, 'Four weeks at 96.0% brings the year to 92.6%.');
    t.check('and still carries no placing', !/\b\d+(st|nd|rd|th)\b/.test(bare));

    // Crossing inside the stretch already described: no second count to name.
    const over = rp.buildPaceClause({
        rankKey: 'adherence', currentValue: 91.2, target: 93, assumedValue: 96,
        projectedValue: 93.5, periods: 8
    });
    t.check('a pace that already clears says so', over.indexOf('That is over the line') > -1);
    t.check('and still asks them to hold it', over.indexOf('keeps it there') > -1);
    t.check('no em dash reaches an associate', over.indexOf('—') === -1);

    // An assumption that never crosses the target gets the pace and no promise.
    const short = rp.buildPaceClause({
        rankKey: 'adherence', currentValue: 91.2, target: 93, assumedValue: 92.5,
        projectedValue: 91.7, periods: 4
    });
    t.check('a pace that cannot reach the target names no finish line',
        short.indexOf('over the line') === -1);
    t.check('but it still reports where the pace lands', short.indexOf('brings the year to') > -1);

    // Sideways is not progress and must not be written as though it were.
    t.equal('a projection level with today says nothing', rp.buildPaceClause({
        rankKey: 'adherence', currentValue: 91.2, target: 93, assumedValue: 96,
        projectedValue: 91.2, periods: 4
    }), '');
    t.equal('a projection worse than today says nothing', rp.buildPaceClause({
        rankKey: 'adherence', currentValue: 91.2, target: 93, assumedValue: 90,
        projectedValue: 91.0, periods: 4
    }), '');

    // Lower is better, so a falling handle time is the improvement.
    const fast = rp.buildPaceClause({
        rankKey: 'aht', currentValue: 620, target: 600, assumedValue: 560,
        projectedValue: 605, periods: 4
    });
    t.check('a falling handle time counts as progress', fast.indexOf('brings the year to 605 sec') > -1);
    t.check('and its own target is reachable from here', fast.indexOf('Six gets you over the line') > -1);

    t.equal('reliability never gets a pace clause', rp.buildPaceClause({
        rankKey: 'reliability', currentValue: 6, target: 4, assumedValue: 0,
        projectedValue: 5, periods: 4
    }), '');
    t.equal('and nothing at all says nothing', rp.buildPaceClause(), '');
});
