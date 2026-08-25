'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * The placings that do reach an associate, and everything they are not allowed
 * to be.
 *
 * Every other associate-facing surface in this app withholds a position on
 * purpose, and year-standing enforces that structurally. This block is the one
 * deliberate exception, asked for and argued out, and the price of the
 * exception is that each honesty gate is held here by a test rather than by
 * whoever remembers the argument:
 *
 *   - a gain is a re-rank of the real field, never an estimate off a gap;
 *   - a gain of nought or one is silence, because a milestone that promises
 *     nothing teaches the reader that none of these numbers mean anything;
 *   - a step under the metric's own noise threshold is churn and prints
 *     nothing, whatever the ladder offers;
 *   - thin volume is skipped rather than ranked, and the pinned slot below
 *     does not buy rep satisfaction past that gate;
 *   - rep satisfaction keeps its slot once it qualifies, whatever a larger
 *     projected gain elsewhere would otherwise have taken it;
 *   - the frozen field is admitted once, in plain words;
 *   - reliability is attendance and never appears, whatever a caller does to
 *     the rank keys on the way in.
 *
 * The last of those is checked by actively sabotaging rank-projection, because
 * "it falls out of the loop on its own" is exactly the kind of property a
 * later edit removes without noticing it was load bearing.
 */

const WEEK_KEY = '2026-08-17|2026-08-21';

// Twenty-nine peers on straight lines, so every placing and every re-rank in
// here is arithmetic anybody can redo on paper. Nothing ties: each of Dana's
// numbers sits between two peers rather than on one, because a tie shares a
// place and would make an assertion about a gain depend on sort stability
// rather than on the rule being tested.
function peerRow(i) {
    return {
        name: 'Peer ' + String(i).padStart(2, '0'),
        totalCalls: 240,
        surveyTotal: 40,
        reliability: 4 + i * 0.5,
        metricRanks: {},
        values: {
            aht: 401 + i * 2,
            adherence: 96 - i * 0.25,
            sentiment: 95 - i * 0.2,
            associateOverall: 92 - i * 0.3
        },
        extraValues: {
            fcr: 85 - i * 0.4,
            overallExperience: 88 - i * 0.35
        }
    };
}

function danaRow(overrides) {
    return Object.assign({
        name: 'Dana Reed',
        totalCalls: 250,
        surveyTotal: 40,
        reliability: 9,
        metricRanks: {},
        values: { aht: 422, adherence: 93.9, sentiment: 90.1, associateOverall: 88 },
        extraValues: { fcr: 80, overallExperience: 84 }
    }, overrides || {});
}

// Dana plus twenty-nine peers, with seven of them on Dana's team.
const TEAM_PEERS = [2, 6, 10, 15, 19, 23, 27];

function field(dana) {
    const rows = [];
    for (let i = 0; i < 29; i++) rows.push(peerRow(i));
    rows.push(dana || danaRow());
    return rows;
}

function teamNames() {
    return ['Dana Reed'].concat(TEAM_PEERS.map(i => 'Peer ' + String(i).padStart(2, '0')));
}

function rankingStub(rows, names) {
    return {
        buildRankingsForPeriod: () => ({
            rankings: rows,
            totalEmployees: rows.length,
            source: WEEK_KEY,
            periodKey: WEEK_KEY,
            teamMembers: new Set(names === undefined ? teamNames() : names)
        })
    };
}

// The weekly file the message itself is written from. Separate from the ranking
// rows on purpose: the block reads placings off center-ranking and the period
// name off the upload, and they have to agree about which week this is.
function weeklyFile() {
    return {
        [WEEK_KEY]: {
            metadata: { periodType: 'week', startDate: '2026-08-17', endDate: '2026-08-21' },
            employees: [{ name: 'Dana Reed', totalCalls: 250, surveyTotal: 40, aht: 422, scheduleAdherence: 93.9, fcr: 80 }]
        }
    };
}

const WEEK_METRICS = [
    { metricKey: 'scheduleAdherence', label: 'Schedule Adherence', employeeValue: 93.9, target: 93, targetType: 'min', classification: 'On Track', meetsTarget: true },
    { metricKey: 'aht', label: 'Average Handle Time', employeeValue: 422, target: 426, targetType: 'max', classification: 'On Track', meetsTarget: true },
    { metricKey: 'fcr', label: 'First Call Resolution', employeeValue: 80, target: 73, targetType: 'min', classification: 'Exceeding Expectation', meetsTarget: true }
];

function load(t, options) {
    const opts = options || {};
    t.installFakeBrowser();
    global.weeklyData = weeklyFile();
    global.ytdData = {};
    global.dailyData = {};

    const registry = t.loadModule('modules/metrics-registry.module.js');
    // morning-pulse reads these as bare globals, which a fake window object
    // cannot supply the way a real browser does.
    global.isReverseMetric = registry.metricsRegistryHelpers.isReverseMetric;
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.formatDateMMDDYYYY = (s) => {
        const [year, month, day] = String(s || '').split('-');
        return year && month && day ? `${month}/${day}/${year}` : '';
    };
    global.window.analyzeTrendMetrics = () => ({ allMetrics: WEEK_METRICS });

    if (opts.noise !== undefined) global.window.getMetricNoiseThreshold = () => opts.noise;

    t.loadModule('modules/rank-projection.module.js');
    global.window.DevCoachModules.centerRanking = rankingStub(
        opts.rows || field(opts.dana),
        opts.teamNames
    );
    return t.loadModule('modules/morning-pulse.module.js').morningPulse;
}

// The block as it lands, spelled out rather than regenerated. Every number in
// it is checked separately below; this is here so a change to a single word of
// copy has to be made on purpose.
const EXPECTED =
    '📊 Where you stood for the week ending 08/21/2026\n'
    + '  • Schedule Adherence: 10th of 30 in the call center, 3rd of 8 on our team.\n'
    + '    Add 1 point and you would have finished about 4 places higher.\n'
    + '  • Rep Satisfaction: 15th of 30 in the call center, 4th of 8 on our team.\n'
    + '    Add 2 points and you would have finished about 7 places higher.\n'
    + '  • Average Handle Time: 12th of 30 in the call center, 4th of 8 on our team.\n'
    + '    Take 15 seconds off and you would have finished about 8 places higher.\n'
    + '  Those position gains assume everybody else stays exactly where they finished.';

suite('pulse standings: both placings and a milestone, for a named period', (t) => {
    const pulse = load(t);
    const block = pulse.buildStandingsBlock('Dana Reed', WEEK_KEY);

    t.check('something was written', block.length > 0);
    t.check('the period is named rather than assumed', block.indexOf('the week ending 08/21/2026') > -1);

    // Dana sits eleven peers back on handle time and four back inside the team,
    // and both halves have to be said: "12th of 30" and "4th of 8" are answers
    // to two different questions and neither stands in for the other.
    t.check('the call center placing is there', block.indexOf('12th of 30 in the call center') > -1);
    t.check('and the team placing beside it', block.indexOf('4th of 8 on our team') > -1);

    // Fifteen seconds off 422 is 407, which clears the peers at 401, 403 and
    // 405 and nobody else, so the re-rank is 4th and the gain is eight places.
    t.check('the milestone names a real step in the metric\'s own unit',
        block.indexOf('Take 15 seconds off') > -1);
    t.check('and the gain is the one a re-rank actually gives',
        block.indexOf('Take 15 seconds off and you would have finished about 8 places higher.') > -1);

    // A percentage metric asks in points, not in seconds.
    t.check('a rate metric steps in points', block.indexOf('Add 2 points') > -1);
    t.check('and one point stays singular', block.indexOf('Add 1 point ') > -1);

    t.equal('the block as it lands', block, EXPECTED);
});

suite('pulse standings: the block is a block, not a spreadsheet', (t) => {
    const pulse = load(t);
    const block = pulse.buildStandingsBlock('Dana Reed', WEEK_KEY);
    const bullets = block.split('\n').filter(line => line.indexOf('  • ') === 0);

    t.equal('three metrics, no more', bullets.length, 3);

    // Dana is measured on six projectable metrics and placed best on adherence,
    // so that is the line the message opens on. Somebody whose block opens on
    // their worst number closes the message.
    // The bullet prefix is four characters, so the label starting at index 4
    // is the label leading the block.
    t.check('the best placing leads', bullets[0].indexOf('Schedule Adherence') === 4);
    t.check('and it is the tenth place one', bullets[0].indexOf('10th of 30') > -1);

    // Sentiment is Dana's worst placing by a distance and is the line left out,
    // because the two slots after the lead go to the metrics a step moves most.
    t.check('the crowded-out metric really was a candidate',
        block.indexOf('Overall Sentiment') === -1 && block.indexOf('First Call Resolution') === -1);
});

suite('pulse standings: rep satisfaction keeps its slot', (t) => {
    /*
     * Four metrics qualify and three get printed, so one is always dropped.
     * Rep satisfaction is not the one, ever. It is the number an associate is
     * asked about by name, and a block that trades it away for a bigger
     * projected gain somewhere else is answering a question nobody asked.
     *
     * Dana is put last in the field on it, far enough back that no rung on the
     * ladder is worth a sentence. That is the worst case the old rule had: no
     * milestone and the worst placing of the four, so it lost both sorts and
     * fell out. Sentiment is what it displaces, and the second half of this
     * checks sentiment really did have a slot to be displaced from rather than
     * being absent for reasons of its own.
     */
    const rows = [];
    for (let i = 0; i < 29; i++) rows.push(peerRow(i));
    rows.push(danaRow({ values: { aht: 422, adherence: 93.9, sentiment: 90.1, associateOverall: 70 } }));

    const block = load(t, { rows }).buildStandingsBlock('Dana Reed', WEEK_KEY);
    const bullets = block.split('\n').filter(line => line.indexOf('  • ') === 0);

    t.check('rep satisfaction is placed', block.indexOf('Rep Satisfaction: 30th of 30 in the call center') > -1);
    t.check('and it takes the slot straight after the lead', bullets[1].indexOf('Rep Satisfaction') === 4);

    // Nothing was invented to justify the slot. Bottom of a field that tight
    // has no step worth naming, and the placing stands without one.
    t.check('with no milestone attached to it', bullets[1].indexOf('places higher') === -1);
    t.check('the metric it displaced is gone', block.indexOf('Overall Sentiment') === -1);
    t.equal('and the block is still three metrics', bullets.length, 3);

    // The proof it was displaced rather than missing: with rep satisfaction
    // withheld for thin surveys, sentiment takes that same slot and prints a
    // five place milestone.
    const withoutSurveys = load(t, {
        rows: rows.slice(0, 29).concat([danaRow({
            surveyTotal: 2,
            values: { aht: 422, adherence: 93.9, sentiment: 90.1, associateOverall: 70 }
        })])
    }).buildStandingsBlock('Dana Reed', WEEK_KEY);
    t.check('it really did have a milestone to lose',
        withoutSurveys.indexOf('Overall Sentiment: 26th of 30') > -1
        && withoutSurveys.indexOf('Add 1 point and you would have finished about 5 places higher.') > -1);

    // The pin is a slot, not a lower bar. Three surveys is still the floor, and
    // a week under it hands the slot back to the metric that earned it.
    t.check('the pin does not carry a thin survey week past the floor',
        withoutSurveys.indexOf('Rep Satisfaction') === -1);
});

suite('pulse standings: the frozen field is admitted once', (t) => {
    const pulse = load(t);
    const block = pulse.buildStandingsBlock('Dana Reed', WEEK_KEY);

    const caveat = 'assume everybody else stays exactly where they finished';
    t.equal('the caveat is there exactly once', block.split(caveat).length - 1, 1);

    // Under every bullet it stops being read by the second one, and a milestone
    // block that never says it is selling a frozen field as a forecast.
    t.check('it is one short sentence, not a paragraph',
        block.split('\n').filter(line => line.indexOf('assume everybody else') > -1).length === 1);

    // A block with nothing to promise has nothing to caveat.
    const flat = load(t, { noise: 999 }).buildStandingsBlock('Dana Reed', WEEK_KEY);
    t.check('and it is absent when no milestone was printed', flat.indexOf('assume everybody else') === -1);
    t.check('though the placings themselves still stand', flat.indexOf('12th of 30 in the call center') > -1);
});

suite('pulse standings: a step the app calls churn is not a milestone', (t) => {
    // Every rung on every ladder tops out well under this, so moveIsNoise
    // refuses all of them. The placings are facts and survive; the promise
    // built on a move the rest of the app would not report does not.
    const pulse = load(t, { noise: 999 });
    const block = pulse.buildStandingsBlock('Dana Reed', WEEK_KEY);

    t.check('the placings are still printed', block.indexOf('in the call center') > -1);
    t.check('and no milestone is', block.indexOf('places higher') === -1);
    t.check('nothing offers a step at all',
        block.indexOf('Take ') === -1 && block.indexOf('Add ') === -1);

    // The real threshold for handle time is fifteen seconds, so the ladder's
    // five and ten second rungs must never be the ask. A five second milestone
    // beside a fifteen second noise floor is the app disagreeing with itself in
    // front of the person it is coaching.
    const normal = load(t).buildStandingsBlock('Dana Reed', WEEK_KEY);
    t.check('and normally the sub-threshold rungs are skipped',
        normal.indexOf('Take 5 seconds off') === -1 && normal.indexOf('Take 10 seconds off') === -1);
});

suite('pulse standings: a gain of one place is not worth a sentence', (t) => {
    /*
     * Five peers well clear of Dana, one peer a whisker ahead, and everybody
     * else behind. Every rung on the handle time ladder passes that one peer
     * and nobody else, so the honest answer to "what would this be worth" is
     * one place, at every size of step, and one place on a field of thirty is
     * somebody else having an ordinary week rather than anything Dana did.
     */
    const rows = [];
    [300, 305, 310, 315, 320, 495].forEach((aht, i) => {
        rows.push({ name: 'Ahead ' + i, totalCalls: 240, surveyTotal: 40, values: { aht }, extraValues: {} });
    });
    for (let i = 0; i < 23; i++) {
        rows.push({ name: 'Behind ' + i, totalCalls: 240, surveyTotal: 40, values: { aht: 505 + i * 5 }, extraValues: {} });
    }
    const dana = { name: 'Dana Reed', totalCalls: 250, surveyTotal: 40, values: { aht: 500 }, extraValues: {} };
    rows.push(dana);

    const pulse = load(t, { rows, teamNames: [] });
    const block = pulse.buildStandingsBlock('Dana Reed', WEEK_KEY);

    t.check('the placing is still stated', block.indexOf('7th of 30 in the call center') > -1);
    t.check('and no milestone is offered', block.indexOf('places higher') === -1);

    // Sixty seconds is the largest rung there is, and it still only clears the
    // one peer, so silence is the whole ladder's answer rather than one rung's.
    t.check('not even at the top of the ladder', block.indexOf('Take 60 seconds off') === -1);
});

suite('pulse standings: thin volume is skipped, not ranked', (t) => {
    // Two surveys back. Center ranking already withholds a survey metric under
    // three responses so one flawless survey cannot win a placing, and a block
    // that prints a placing off two would be quoting a number the rankings
    // table refuses to stand behind.
    const thinSurveys = load(t, { dana: danaRow({ surveyTotal: 2 }) })
        .buildStandingsBlock('Dana Reed', WEEK_KEY);
    t.check('no survey metric is placed', thinSurveys.indexOf('Rep Satisfaction') === -1
        && thinSurveys.indexOf('First Call Resolution') === -1
        && thinSurveys.indexOf('Overall Experience') === -1);
    t.check('but the call-volume metrics still are', thinSurveys.indexOf('Average Handle Time') > -1);

    // Eight calls is not a week anybody can be placed on, and every metric goes
    // with it rather than some of them.
    const thinCalls = load(t, { dana: danaRow({ totalCalls: 8 }) })
        .buildStandingsBlock('Dana Reed', WEEK_KEY);
    t.equal('a thin week gets no block at all', thinCalls, '');

    // A field of four is a true fact about a very small room and reads like one.
    const tiny = [];
    for (let i = 0; i < 3; i++) tiny.push(peerRow(i));
    tiny.push(danaRow());
    t.equal('and neither does a field of four',
        load(t, { rows: tiny, teamNames: [] }).buildStandingsBlock('Dana Reed', WEEK_KEY), '');
});

suite('pulse standings: reliability never appears, however it is smuggled in', (t) => {
    const pulse = load(t);

    // Untouched first: attendance is not in the projectable list, so it cannot
    // reach a label or a noise floor and drops out on its own.
    const clean = pulse.buildStandingsBlock('Dana Reed', WEEK_KEY);
    t.check('nothing mentions reliability', clean.indexOf('Reliability') === -1);
    t.check('and nothing is measured in hours', clean.indexOf(' hours') === -1 && clean.indexOf(' hour ') === -1);

    // Now the sabotage. Both of the things that keep attendance out of here are
    // plain mutable objects on an exported module, and a well-meaning edit that
    // "completes" either of them is all it would take. Mailing somebody a
    // placing on their attendance is the single line in this app most likely to
    // become a real problem for a real person, so it has to survive this.
    const rp = global.window.DevCoachModules.rankProjection;
    rp.RANK_TO_REGISTRY.reliability = 'reliability';
    rp.PROJECTABLE_RANK_KEYS.push('reliability');

    t.equal('the sabotage really did open the door',
        rp.registryKeyFor('reliability'), 'reliability');
    t.check('and the gate would otherwise have passed it',
        rp.isProjectable('reliability', danaRow()) === true);

    const sabotaged = pulse.buildStandingsBlock('Dana Reed', WEEK_KEY);
    t.check('the block still refuses it', sabotaged.indexOf('Reliability') === -1);
    t.check('no attendance step is offered', sabotaged.indexOf(' hours off') === -1);
    t.equal('and nothing else about the block changed', sabotaged, clean);
});

suite('pulse standings: private message only', async (t) => {
    const pulse = load(t);

    // The one-to-one sweep. dailyMode 'none' is the plainest path through
    // buildOutreachMessage and the one every other path shares an exit with.
    const dm = await pulse.buildOutreachMessage(
        {}, { base: 'kickoff', dailyMode: 'none' }, 'Dana Reed', WEEK_KEY, null, null
    );

    t.check('the private message carries the block', dm.indexOf('📊 Where you stood for') > -1);
    t.check('with the placings in it', dm.indexOf('12th of 30 in the call center') > -1);
    t.check('and the caveat with them', dm.indexOf('assume everybody else') > -1);
    t.check('the message it was appended to is still there', dm.indexOf('Dana') > -1);

    // The shout-out is the same numbers about the same person on the same day,
    // and it is the one that gets pasted somewhere other people can read it.
    const highFive = await pulse.generateHighFiveMessage('Dana Reed', WEEK_KEY, null, { now: new Date(2026, 7, 24) });
    t.check('a high five was written', typeof highFive === 'string' && highFive.length > 0);
    t.check('and it carries no placing', highFive.indexOf('of 30 in the call center') === -1);
    t.check('nor the block header', highFive.indexOf('Where you stood for') === -1);
    t.check('nor a milestone', highFive.indexOf('places higher') === -1);
});

suite('pulse standings: the seam that keeps it private', (t) => {
    /*
     * Behaviour proves today's callers are clean; this proves the shape that
     * keeps tomorrow's clean too. One function appends the block, one function
     * calls that, and everything public reaches neither. A channel post or a
     * shout-out picking up a placing would show up here as a third caller long
     * before it showed up in somebody's Teams channel.
     */
    const src = fs.readFileSync(path.join(ROOT, 'modules', 'morning-pulse.module.js'), 'utf8');

    const buildCalls = src.split('buildStandingsBlock').length - 1;
    t.equal('buildStandingsBlock is declared, appended and exported, and nothing else', buildCalls, 3);

    const withCalls = src.split('withStandings').length - 1;
    t.equal('withStandings is declared and used exactly once', withCalls, 2);
    // Whitespace-tolerant: what matters is that the one use is finish(), with
    // the block inside the near-miss tail, not whether it fits on one line.
    t.check('and the one use is the one-to-one assembly point',
        /const finish = \(text\) =>\s*withNearMiss\(\s*withStandings\(/.test(src));

    // No module other than this one may reach the block, however tempting.
    const others = fs.readdirSync(path.join(ROOT, 'modules'))
        .filter(f => f.endsWith('.module.js') && f !== 'morning-pulse.module.js')
        .filter(f => fs.readFileSync(path.join(ROOT, 'modules', f), 'utf8').indexOf('buildStandingsBlock') > -1);
    t.equal('nothing else in the app calls it', others.length, 0);
});

suite('pulse standings: the copy an associate reads', (t) => {
    const pulse = load(t);
    const block = pulse.buildStandingsBlock('Dana Reed', WEEK_KEY);

    t.check('no em dash', block.indexOf('—') === -1);
    t.check('no en dash either', block.indexOf('–') === -1);

    // The block is quoting the rankings table back at somebody who can go and
    // look at it, so a disagreement between the two is a reason to say nothing
    // about that metric rather than to pick a winner.
    const disagreeing = danaRow({ metricRanks: { aht: 3 } });
    const skewed = load(t, { dana: disagreeing }).buildStandingsBlock('Dana Reed', WEEK_KEY);
    t.check('a metric the table ranks differently is dropped', skewed.indexOf('Average Handle Time') === -1);
    t.check('and the rest of the block survives it', skewed.indexOf('Schedule Adherence') > -1);
});
