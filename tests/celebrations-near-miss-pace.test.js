'use strict';

const { suite } = require('./harness');

/**
 * The door clause has to reach the person it was written for.
 *
 * A near miss is built in three places and read in one: the direct message. For
 * a while it was built two different ways depending on where the manager asked
 * from. detectCelebrations built one near miss for the people it celebrated and
 * another for the people it did not, and only the second one was handed the
 * rankings the pace needs, so somebody who won on FCR and sat two spots outside
 * the top 10 in Schedule Adherence got "you are #12, 2 spots away" with nothing
 * after it, while the exact same near miss pulled through nearMissFor came back
 * with "Top 10 sits at 94.6%. One week at 95.6% gets you there." Same person,
 * same week, two messages.
 *
 * So these suites check the message, not the plumbing, and they check the two
 * paths against each other rather than against a hand-written string. A pace
 * that goes missing on one side and not the other is the failure that actually
 * happened, and comparing the sides is the only thing that catches it.
 */

// The center as a field, not as one row. The door is the value standing at
// position 10, so there have to be ten real adherence figures above the subject
// or thresholdValueForRank has nothing to name.
const ADHERENCE_ABOVE = [99.0, 98.5, 98.0, 97.5, 97.0, 96.5, 96.0, 95.5, 95.0, 94.6, 94.3];
const DOOR_ADHERENCE = 94.6;   // 10th best, the top-10 door
const ERICA_ADHERENCE = 94.1;  // 12th, two spots outside, and past the 93% target

function centerField() {
    const rows = [];

    ADHERENCE_ABOVE.forEach((value, i) => {
        rows.push({
            name: 'Ahead ' + i,
            rank: i + 1,
            // Erica takes third in FCR, so everyone from index 2 down shifts a
            // place to leave it for her.
            metricRanks: { adherence: i + 1, fcr: i < 2 ? i + 1 : i + 2 },
            values: { adherence: value },
            extraValues: { fcr: Number((98 - i * 0.7).toFixed(1)) },
            totalCalls: 300,
            surveyTotal: 10
        });
    });

    rows.push({
        name: 'Erica Mora',
        rank: 12,
        metricRanks: { adherence: 12, fcr: 3 },
        values: { adherence: ERICA_ADHERENCE },
        extraValues: { fcr: 96.9 },
        totalCalls: 250,
        surveyTotal: 12
    });

    [93.5, 93.0].forEach((value, i) => {
        rows.push({
            name: 'Behind ' + i,
            rank: 13 + i,
            metricRanks: { adherence: 13 + i, fcr: 13 + i },
            values: { adherence: value },
            extraValues: { fcr: Number((90 - i * 0.5).toFixed(1)) },
            totalCalls: 280,
            surveyTotal: 9
        });
    });

    return rows;
}

const PERIOD = '2026-08-17|2026-08-21';

function store(rows, teamMembers) {
    return () => ({
        periodKey: PERIOD,
        totalEmployees: 126,
        teamMembers: new Set(teamMembers),
        rankings: rows
    });
}

function load(t, teamMembers) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/rank-projection.module.js');
    // Lives in script.js in the app, so the pace copy would print bare numbers
    // without it and the test would be checking a string nobody ever sees.
    global.window.formatMetricDisplay = (key, value) => {
        const unit = (global.window.METRICS_REGISTRY[key] || {}).unit || '%';
        if (unit === 'sec') return Math.round(value) + ' sec';
        return Number(value).toFixed(1) + '%';
    };
    const data = store(centerField(), teamMembers || ['Erica Mora']);
    global.window.DevCoachModules.centerRanking = {
        buildCenterRankings: data,
        buildRankingsForPeriod: data
    };
    return t.loadModule('modules/celebrations.module.js').celebrations;
}

const DOOR_SENTENCE = 'Top 10 sits at 94.6%. One week at 95.6% gets you there, and holding it keeps you there.';

suite('celebrations: a winner with a near miss still gets told where the door is', (t) => {
    const celebrations = load(t);
    const result = celebrations.detectCelebrations(PERIOD);
    const erica = result.celebrations.find(c => c.name === 'Erica Mora');

    t.check('she is celebrated for the metric she won', Boolean(erica));
    t.equal('on First Call Resolution', erica.achievements[0].label, 'First Call Resolution');

    t.check('and the near miss rides along with the win', Boolean(erica.nearMiss));
    t.equal('named by metric', erica.nearMiss.label, 'Schedule Adherence');
    t.equal('two spots outside the bar', erica.nearMiss.away, 2);

    // The whole point of the sixth argument. Without the rankings the near miss
    // still exists, still says #12, and quietly has no pace hanging off it.
    // Read through a placeholder so a missing pace fails these four and still
    // lets the message assertions below run: the message is the symptom anybody
    // would report, and a suite that dies before reaching it hides that.
    const pace = erica.nearMiss.pace || {};
    t.check('the pace was worked out, not skipped', Boolean(erica.nearMiss.pace));
    t.equal('against the value standing in the doorway', pace.doorValue, DOOR_ADHERENCE);
    t.equal('asking for one week of work', pace.periods, 1);
    t.equal('at a number a week is measured in', pace.periodNoun, 'week');

    const dm = celebrations.generateDirectMessage(erica, result.dateRange);
    t.check('the direct message names the placing', dm.indexOf('#12') > -1);
    t.check('and finishes the thought with the door', dm.indexOf(DOOR_SENTENCE) > -1);
});

suite('celebrations: the same near miss reads the same way whichever button was pressed', (t) => {
    const celebrations = load(t);
    const fromDetect = celebrations.detectCelebrations(PERIOD)
        .celebrations.find(c => c.name === 'Erica Mora').nearMiss;
    const fromLookup = celebrations.nearMissFor('Erica Mora', PERIOD);

    t.check('both paths find a near miss', Boolean(fromDetect) && Boolean(fromLookup));
    t.equal('on the same metric', fromDetect.metricKey, fromLookup.metricKey);
    t.equal('at the same placing', fromDetect.rank, fromLookup.rank);

    // The bug was invisible everywhere except here: two objects that agree on
    // every fact the sentence opens with, and disagree about the sentence that
    // closes it.
    t.check('and both know where the door is', Boolean(fromDetect.pace) && Boolean(fromLookup.pace));
    const detected = fromDetect.pace || {};
    const looked = fromLookup.pace || {};
    t.equal('at the same value', detected.doorValue, looked.doorValue);
    t.equal('over the same number of weeks', detected.periods, looked.periods);
    t.equal('asking for the same number', detected.assumedValue, looked.assumedValue);

    t.equal('so the tail is word for word the same',
        celebrations.nearMissDoorClause(fromDetect),
        celebrations.nearMissDoorClause(fromLookup));
    t.equal('and it is the sentence the associate was meant to read',
        celebrations.nearMissDoorClause(fromDetect), DOOR_SENTENCE);
});

suite('celebrations: a near miss on the miss list carries the door too', (t) => {
    // Erica off the roster and a teammate on it who won nothing, so the same
    // period exercises the branch that builds the miss list. Both branches now
    // go through one bound helper, and this holds them there.
    const celebrations = load(t, ['Ahead 10']);
    const result = celebrations.detectCelebrations(PERIOD);
    const missed = result.missed.find(m => m.name === 'Ahead 10');

    t.check('the teammate is on the miss list', Boolean(missed));
    t.equal('eleventh in adherence, one off the bar', missed.nearMiss.away, 1);
    t.check('and the door came with it', Boolean(missed.nearMiss.pace));
    t.equal('naming the same doorway', missed.nearMiss.pace.doorValue, DOOR_ADHERENCE);
});

suite('celebrations: no rankings means no pace, not a made-up one', (t) => {
    // findNearMiss keeps `data` optional so a caller holding a row and nothing
    // else still gets the placing. What it must never do is invent the tail.
    const celebrations = load(t);
    const rows = centerField();
    const erica = rows.find(r => r.name === 'Erica Mora');
    const bare = celebrations.findNearMiss(erica, 'Erica Mora', [1, 5, 10], 2026, {});

    t.check('the placing survives without rankings', Boolean(bare));
    t.equal('and it is the same placing', bare.rank, 12);
    t.equal('but there is no pace to hang off it', bare.pace, null);
    t.equal('so the sentence stops where it stopped before', celebrations.nearMissDoorClause(bare), '');
});
