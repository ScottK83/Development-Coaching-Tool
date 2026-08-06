'use strict';

const { suite } = require('./harness');

// A minimal stand-in for centerRanking: two people on my team, each holding a
// rank-1 metric, so both would be celebrated if nothing narrowed the list.
function fakeRankings() {
    return {
        periodKey: '2026-07-27|2026-08-02',
        totalEmployees: 126,
        teamMembers: new Set(['Oceane Ingram', 'Alyssa Dimes']),
        rankings: [
            { name: 'Oceane Ingram', rank: 1, metricRanks: { adherence: 1 }, values: { adherence: 99.1 } },
            { name: 'Alyssa Dimes', rank: 2, metricRanks: { fcr: 2 }, values: { fcr: 88 } }
        ]
    };
}

function load(t, activeMember) {
    t.installFakeBrowser();
    global.window.DevCoachModules.centerRanking = {
        buildCenterRankings: fakeRankings,
        buildRankingsForPeriod: fakeRankings
    };
    global.window.DevCoachModules.teamScope = {
        isInScope: (name) => !activeMember || name === activeMember
    };
    return t.loadModule('modules/celebrations.module.js').celebrations;
}

suite('celebrations: follow the My Team picker', (t) => {
    const everyone = load(t, null).detectCelebrations('2026-07-27|2026-08-02');
    const names = everyone.celebrations.map(c => c.name);

    t.check('with everyone picked, the whole team is eligible', names.length >= 2);
    t.check('including Oceane', names.indexOf('Oceane Ingram') > -1);
    t.check('and Alyssa', names.indexOf('Alyssa Dimes') > -1);
});

suite('celebrations: picking one person shows only their wins', (t) => {
    const justOceane = load(t, 'Oceane Ingram').detectCelebrations('2026-07-27|2026-08-02');
    const names = justOceane.celebrations.map(c => c.name);

    t.equal('only the picked person is celebrated', names.length, 1);
    t.equal('and it is the right one', names[0], 'Oceane Ingram');
    t.check('the teammate is left out', names.indexOf('Alyssa Dimes') === -1);
});

suite('celebrations: never celebrates a number someone is failing', (t) => {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.window.DevCoachModules.centerRanking = { buildCenterRankings: fakeRankings, buildRankingsForPeriod: fakeRankings };
    const celebrations = t.loadModule('modules/celebrations.module.js').celebrations;

    // Avoid Negative Words is a "min 83" metric: higher is better, 83 is the
    // bar. Ranking sixth on the floor at 73.1% is still a failing number, and
    // calling it a win teaches the wrong number.
    t.check('73.1% is not a win', celebrations.meetsCelebrationTarget('negativeWord', 73.1, 2026) === false);
    t.check('80% is still short', celebrations.meetsCelebrationTarget('negativeWord', 80, 2026) === false);
    t.check('83% clears the bar', celebrations.meetsCelebrationTarget('negativeWord', 83, 2026) === true);
    t.check('and 91% clearly does', celebrations.meetsCelebrationTarget('negativeWord', 91, 2026) === true);

    // AHT runs the other way: lower is better.
    t.check('an AHT under target is a win', celebrations.meetsCelebrationTarget('aht', 380, 2026) === true);
    t.check('an AHT over target is not', celebrations.meetsCelebrationTarget('aht', 520, 2026) === false);

    // A metric with no configured target must not be silently suppressed.
    t.check('an unjudgeable metric is left alone', celebrations.meetsCelebrationTarget('notAMetric', 5, 2026) === true);
    t.check('and so is a missing value', celebrations.meetsCelebrationTarget('negativeWord', null, 2026) === true);

    t.equal('the year comes off the period key', celebrations.celebrationYear('2026-07-27|2026-08-02'), 2026);
    t.equal('a bare key still yields a year', celebrations.celebrationYear('2025-08-02'), 2025);
});

suite('celebrations: a failing number is dropped, and explained', (t) => {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');

    const data = () => ({
        periodKey: '2026-07-27|2026-08-02',
        totalEmployees: 126,
        teamMembers: new Set(['Kristin Villela', 'Betty Yanez']),
        rankings: [
            // Sixth on the floor, but ten points under the 83% bar.
            { name: 'Kristin Villela', rank: 6, metricRanks: { negativeWord: 6 }, extraValues: { negativeWord: 73.1 } },
            // Genuinely good, and ranked.
            { name: 'Betty Yanez', rank: 3, metricRanks: { negativeWord: 3 }, extraValues: { negativeWord: 91.4 } }
        ]
    });
    global.window.DevCoachModules.centerRanking = { buildCenterRankings: data, buildRankingsForPeriod: data };
    const celebrations = t.loadModule('modules/celebrations.module.js').celebrations;

    const result = celebrations.detectCelebrations('2026-07-27|2026-08-02');
    const names = result.celebrations.map(c => c.name);

    t.check('the failing number is not celebrated', names.indexOf('Kristin Villela') === -1);
    t.check('the genuinely good one still is', names.indexOf('Betty Yanez') > -1);

    // Dropping it silently would read as an oversight, so it has to say why.
    const missed = result.missed.find(m => m.name === 'Kristin Villela');
    t.check('the drop is explained', Boolean(missed));
    t.equal('as being short of target, not a near miss on rank', missed.reason, 'belowTarget');
    const text = celebrations.describeNoCelebration(missed);
    t.check('the wording names the rank', text.indexOf('#6') > -1);
    t.check('and says the number is short', text.indexOf('short of target') > -1);
    t.check('and does not call it a bar miss', text.indexOf('off the top') === -1);
});

suite('celebrations: a shared top spot says how many share it', (t) => {
    const celebrations = load(t, null);

    // Fifteen people at 100% all get rank 1 under standard competition
    // ranking. Telling each of them they are "#1 in Center" overstates it.
    t.equal('a shared top spot names the group', celebrations.describeTie({ tiedCount: 15, key: 'positiveWord', value: 100 }, '100%'),
        'one of 15 associates at 100%');
    t.equal('a genuinely solo spot says nothing', celebrations.describeTie({ tiedCount: 1, key: 'positiveWord', value: 100 }, '100%'), '');
    t.equal('a missing count is treated as solo', celebrations.describeTie({ key: 'positiveWord' }, '100%'), '');
    t.check('with no value it still counts the group', celebrations.describeTie({ tiedCount: 4 }, '').indexOf('4 associates at the top') > -1);

    // The clause has to disappear cleanly, punctuation and all, when there is
    // no tie — otherwise every solo win trails a stray dash.
    t.equal('no tie leaves no punctuation behind', celebrations.tieClause('', ' — ', '.'), '');
    t.equal('a tie is wrapped for its sentence', celebrations.tieClause('one of 15 associates at 100%', ' (', ')'), ' (one of 15 associates at 100%)');
});

suite('celebrations: tie counts come off the real rankings', (t) => {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');

    // Three people tied at 100% on positive word, one alone at the top of
    // managing emotions.
    const data = () => ({
        periodKey: '2026-07-27|2026-08-02',
        totalEmployees: 126,
        teamMembers: new Set(['Alyssa Dimes', 'Oceane Ingram', 'James Garcia']),
        rankings: [
            { name: 'Alyssa Dimes', rank: 1, metricRanks: { positiveWord: 1 }, extraValues: { positiveWord: 100 } },
            { name: 'Oceane Ingram', rank: 1, metricRanks: { positiveWord: 1 }, extraValues: { positiveWord: 100 } },
            { name: 'Someone Else', rank: 1, metricRanks: { positiveWord: 1 }, extraValues: { positiveWord: 100 } },
            { name: 'James Garcia', rank: 1, metricRanks: { managingEmotions: 1 }, extraValues: { managingEmotions: 100 } }
        ]
    });
    global.window.DevCoachModules.centerRanking = { buildCenterRankings: data, buildRankingsForPeriod: data };
    const celebrations = t.loadModule('modules/celebrations.module.js').celebrations;

    const result = celebrations.detectCelebrations('2026-07-27|2026-08-02');
    const alyssa = result.celebrations.find(c => c.name === 'Alyssa Dimes');
    const james = result.celebrations.find(c => c.name === 'James Garcia');

    t.equal('everyone tied at the top is counted', alyssa.achievements[0].tiedCount, 3);
    t.check('and a shared spot is not called solo', alyssa.achievements[0].soloRank1 === false);

    t.equal('a genuinely solo top spot counts one', james.achievements[0].tiedCount, 1);
    t.check('and is still marked solo', james.achievements[0].soloRank1 === true);

    // The public post is where this was overstating things.
    const post = celebrations.generateAllShoutOuts(result.celebrations, '');
    t.check('the post names the tie', post.indexOf('one of 3 associates at') > -1);
    t.check('and still calls the solo win out as unmatched', post.indexOf('nobody else matched it') > -1);
});

suite('celebrations: says why someone came up empty', (t) => {
    const celebrations = load(t, null);
    const tiers = [1, 5, 10];

    const data = {
        totalEmployees: 126,
        teamMembers: new Set(['Near Miss', 'Withheld', 'Off The Board']),
        rankings: [
            // 4 off the top-10 bar — the most common case, and the one a blank
            // screen misrepresents worst.
            { name: 'Near Miss', metricRanks: { adherence: 14, fcr: 40 }, values: { adherence: 91 }, extraValues: { fcr: 70 } },
            // Ranks well but the number never made it through the survey floor.
            { name: 'Withheld', metricRanks: { fcr: 3 }, values: {}, extraValues: { fcr: null } }
        ]
    };

    const nearMiss = celebrations.explainNoCelebration(data, 'Near Miss', tiers);
    t.equal('a near miss is reported as below the bar', nearMiss.reason, 'belowBar');
    t.equal('with their best rank, not their worst', nearMiss.best.rank, 14);
    t.equal('named by metric', nearMiss.best.label, 'Schedule Adherence');
    t.equal('and how far off the bar they were', nearMiss.shortBy, 4);
    t.check('the wording says the number out loud', describeHas(celebrations, nearMiss, '#14'));
    t.check('and names the bar', describeHas(celebrations, nearMiss, 'top 10'));

    const withheld = celebrations.explainNoCelebration(data, 'Withheld', tiers);
    t.equal('a qualifying rank with no value is called out separately', withheld.reason, 'valueWithheld');
    t.check('and explains the survey floor', describeHas(celebrations, withheld, 'surveys'));

    const missing = celebrations.explainNoCelebration(data, 'Off The Board', tiers);
    t.equal('someone absent from the rankings is its own reason', missing.reason, 'notRanked');
    t.check('and says nothing was scoreable', describeHas(celebrations, missing, 'scoreable'));

    // The three used to render as one identical blank screen.
    const reasons = new Set([nearMiss.reason, withheld.reason, missing.reason]);
    t.equal('three distinct silences, three distinct answers', reasons.size, 3);
});

function describeHas(celebrations, info, needle) {
    return celebrations.describeNoCelebration(info).indexOf(needle) > -1;
}

suite('celebrations: the miss list rides along with the result', (t) => {
    const celebrations = load(t, 'Alyssa Dimes');
    const result = celebrations.detectCelebrations('2026-07-27|2026-08-02');

    t.check('a result always carries a miss list', Array.isArray(result.missed));
    // Alyssa is celebrated in the fixture, and Oceane is out of scope, so
    // nobody should be listed as having missed.
    t.equal('someone who was celebrated is not also listed as missing', result.missed.length, 0);

    const wholeTeam = load(t, null).detectCelebrations('2026-07-27|2026-08-02');
    t.check('with everyone in scope, celebrated people stay off the miss list',
        wholeTeam.missed.every(info => info.name !== 'Oceane Ingram' && info.name !== 'Alyssa Dimes'));
});

suite('celebrations: still works when nothing has set a scope', (t) => {
    t.installFakeBrowser();
    global.window.DevCoachModules.centerRanking = {
        buildCenterRankings: fakeRankings,
        buildRankingsForPeriod: fakeRankings
    };
    // No teamScope module at all — an older saved page, or a load-order slip.
    const celebrations = t.loadModule('modules/celebrations.module.js').celebrations;
    const result = celebrations.detectCelebrations('2026-07-27|2026-08-02');

    t.check('no scope module means no narrowing, not a crash', result.celebrations.length >= 2);
});

suite('celebrations: reliability is never a shout-out', (t) => {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');

    // Reliability is a "did you miss hours" measure, so everyone who worked
    // their week clears it. Left in, the same names shout every single week
    // and drown out the callouts worth reading.
    const data = () => ({
        periodKey: '2026-07-27|2026-08-02',
        totalEmployees: 126,
        teamMembers: new Set(['Perfect Attendance', 'Real Win']),
        rankings: [
            { name: 'Perfect Attendance', rank: 1, metricRanks: { reliability: 1 }, reliability: 0 },
            { name: 'Real Win', rank: 2, metricRanks: { managingEmotions: 2 }, extraValues: { managingEmotions: 99 } }
        ]
    });
    global.window.DevCoachModules.centerRanking = { buildCenterRankings: data, buildRankingsForPeriod: data };
    const celebrations = t.loadModule('modules/celebrations.module.js').celebrations;

    const result = celebrations.detectCelebrations('2026-07-27|2026-08-02');
    const names = result.celebrations.map(c => c.name);

    t.check('a clean attendance week is not a shout-out', names.indexOf('Perfect Attendance') === -1);
    t.check('a real metric win still is', names.indexOf('Real Win') > -1);
    t.check('no achievement anywhere is reliability',
        result.celebrations.every(c => c.achievements.every(a => a.key !== 'reliability')));

    // Excluded from shout-outs means excluded from explaining a missing one
    // too — otherwise it just moves the noise into the miss list.
    const missed = result.missed.find(m => m.name === 'Perfect Attendance');
    t.check('and it does not explain a missing shout-out either',
        !missed || !missed.best || missed.best.key !== 'reliability');
});

// A field big enough to be worth naming: seven people tied at 100% on managing
// emotions, then a long tail of ranks below them.
function wideField() {
    const rankings = [];
    for (let i = 0; i < 7; i++) {
        rankings.push({ name: 'Tied ' + i, rank: 1, metricRanks: { managingEmotions: 1 }, extraValues: { managingEmotions: 100 } });
    }
    for (let i = 0; i < 43; i++) {
        rankings.push({ name: 'Below ' + i, rank: 8 + i, metricRanks: { managingEmotions: 8 + i }, extraValues: { managingEmotions: 90 } });
    }
    // Ranked in the center but holding no managing-emotions rank at all, so the
    // pool for that metric must not count them.
    rankings.push({ name: 'Unranked Here', rank: 60, metricRanks: { adherence: 4 }, values: { adherence: 99 } });
    return {
        periodKey: '2026-07-27|2026-08-02',
        totalEmployees: rankings.length,
        teamMembers: new Set(['Tied 0']),
        rankings: rankings
    };
}

suite('celebrations: how big the field was, and how much of it they beat', (t) => {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.window.DevCoachModules.centerRanking = { buildCenterRankings: wideField, buildRankingsForPeriod: wideField };
    const celebrations = t.loadModule('modules/celebrations.module.js').celebrations;

    const result = celebrations.detectCelebrations('2026-07-27|2026-08-02');
    const win = result.celebrations.find(c => c.name === 'Tied 0').achievements[0];

    // 50 people hold a managing-emotions rank; the 51st holds none, so counting
    // them would inflate every claim made off this number.
    t.equal('the pool is who was ranked on that metric', win.rankedCount, 50);
    t.equal('and the whole center still travels alongside it', win.totalEmployees, 51);

    // Seven share rank 1, so each of them beat the 43 below and none of the six
    // beside them.
    t.equal('ties count as beaten by nobody', win.betterThan, 43);
    t.equal('the wording puts both numbers in', celebrations.describeField(win),
        'better than 43 of 50 associates');

    // The period is what makes any of it mean something.
    t.check('a result carries the size of the center', result.totalEmployees === 51);
    t.check('and the period it was earned in', result.dateRange.indexOf('2026') > -1);
});

suite('celebrations: the field is only named where it cannot become a podium', (t) => {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.window.DevCoachModules.centerRanking = { buildCenterRankings: wideField, buildRankingsForPeriod: wideField };
    const celebrations = t.loadModule('modules/celebrations.module.js').celebrations;

    const result = celebrations.detectCelebrations('2026-07-27|2026-08-02');
    const person = result.celebrations.find(c => c.name === 'Tied 0');

    // One-to-one, so there is nobody to be measured against in the room.
    const dm = celebrations.generateDirectMessage(person, 'Jul 27 - Aug 2, 2026');
    t.check('the private message says how many they beat', dm.indexOf('Better than 43 of 50 associates') > -1);
    t.check('and leads with the period it covers', dm.indexOf('📅 Jul 27 - Aug 2, 2026') > -1);

    // The channel post names several people at once, so the same sentence would
    // quietly rank the winners against each other.
    const post = celebrations.generateAllShoutOuts(result.celebrations, 'Jul 27 - Aug 2, 2026');
    t.check('the public post never counts who was beaten', post.indexOf('better than') === -1);
    t.check('nor capitalised at the head of a sentence', post.indexOf('Better than') === -1);
    t.check('but it does say what week it covers', post.indexOf('📅 Jul 27 - Aug 2, 2026') > -1);
    // Buried under nine names, the date may as well not be there.
    t.check('up top, not at the foot of the post', post.indexOf('📅') < post.indexOf('Managing Emotions'));
    t.equal('and said once, not once at each end', post.split('📅').length - 1, 1);

    const single = celebrations.generateShoutOut(person, 'Jul 27 - Aug 2, 2026');
    t.check('a single public shout-out stays value-only', single.indexOf('etter than') === -1);
    t.check('and still dates itself', single.indexOf('📅 Jul 27 - Aug 2, 2026') > -1);
});

suite('celebrations: a field too thin to describe says nothing', (t) => {
    const celebrations = load(t, null);

    t.equal('a nine-person pool is not a field worth naming',
        celebrations.describeField({ rankedCount: 9, betterThan: 5 }), '');
    t.equal('beating nobody is not praise',
        celebrations.describeField({ rankedCount: 60, betterThan: 0 }), '');
    t.equal('and missing counts stay silent rather than guessing',
        celebrations.describeField({}), '');
    t.equal('the sentence form disappears just as cleanly',
        celebrations.fieldSentence({ rankedCount: 4, betterThan: 2 }), '');
    t.equal('and reads as its own sentence when it does fire',
        celebrations.fieldSentence({ rankedCount: 124, betterThan: 117 }),
        ' Better than 117 of 124 associates.');
});

suite('celebrations: a shared top spot says so instead of contradicting itself', (t) => {
    const celebrations = load(t, null);

    // The real case that made no sense on screen: sixteen associates at a
    // perfect Rep Satisfaction, only nineteen surveyed at all. "#1 in Center"
    // beside "better than 3 of 19" looked like a bug because the tie was the
    // missing half of the sentence.
    t.equal('a sixteen-way tie is named, not hidden behind the rank',
        celebrations.describePlacement({ key: 'associateOverall', rank: 1, tiedCount: 16, rankedCount: 19, value: 100 }),
        '100 — one of 16 tied at the top, out of 19 scored on it');

    t.equal('holding the top alone still reads as winning it',
        celebrations.describePlacement({ key: 'associateOverall', rank: 1, tiedCount: 1, rankedCount: 19, value: 100 }),
        '100 — best of 19 scored on it');

    t.equal('and a placing further down keeps its ordinal',
        celebrations.describePlacement({ key: 'fcr', rank: 4, tiedCount: 1, rankedCount: 111, value: 92 }),
        '92 — 4th of 111 scored on it');
    t.equal('shared, further down, too',
        celebrations.describePlacement({ key: 'fcr', rank: 3, tiedCount: 5, rankedCount: 111, value: 92 }),
        '92 — tied for 3rd, out of 111 scored on it');
    t.equal('the eleventh is not the eleven-st',
        celebrations.describePlacement({ rank: 11, tiedCount: 1, rankedCount: 60 }),
        '11th of 60 scored on it');

    // The pool is per-metric, and saying so is the whole point: it is what
    // explains a field of 19 sitting under a header that says 126.
    t.check('the pool is described as who was scored on that metric',
        celebrations.describePlacement({ rank: 1, tiedCount: 1, rankedCount: 19 }).indexOf('scored on it') > -1);
    t.equal('a missing pool drops the field rather than inventing one',
        celebrations.describePlacement({ key: 'fcr', rank: 1, tiedCount: 1, value: 92 }), '92 — best');
    t.equal('and nothing at all stays silent', celebrations.describePlacement(null), '');
});

suite('celebrations: a week you did not work is not an achievement', (t) => {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');

    // Out all week means 0% transfers. Transfers is lower-is-better, so zero
    // reads as flawless, ties with everyone else at zero, and tops the
    // shout-out list for a week that was never worked.
    const data = () => ({
        periodKey: '2026-07-27|2026-08-02',
        totalEmployees: 126,
        teamMembers: new Set(['Angelina Fierro', 'Jadyn Flowers', 'Betty Yanez']),
        rankings: [
            { name: 'Angelina Fierro', rank: 1, totalCalls: 0, metricRanks: { transfers: 1 }, extraValues: { transfers: 0 } },
            { name: 'Jadyn Flowers', rank: 1, totalCalls: 0, metricRanks: { transfers: 1 }, extraValues: { transfers: 0 } },
            { name: 'Betty Yanez', rank: 2, totalCalls: 140, metricRanks: { transfers: 2 }, extraValues: { transfers: 1.2 } }
        ]
    });
    global.window.DevCoachModules.centerRanking = { buildCenterRankings: data, buildRankingsForPeriod: data };
    const celebrations = t.loadModule('modules/celebrations.module.js').celebrations;

    const result = celebrations.detectCelebrations('2026-07-27|2026-08-02');
    const names = result.celebrations.map(c => c.name);

    t.check('someone who took no calls is not celebrated', names.indexOf('Angelina Fierro') === -1);
    t.check('nor is the other one', names.indexOf('Jadyn Flowers') === -1);
    t.check('but the person who actually worked still is', names.indexOf('Betty Yanez') > -1);

    // Vanishing without a word reads as a bug. Say which it was.
    const absent = result.missed.find(m => m.name === 'Angelina Fierro');
    t.equal('the absence is named as an absence', absent.reason, 'notPresent');
    t.check('and worded plainly', celebrations.describeNoCelebration(absent).indexOf('took no calls') > -1);

    // A handful of calls is present but not judgeable, which is a different
    // thing again and points at a different conversation.
    t.equal('no calls at all is an absence', celebrations.volumeVerdict({ totalCalls: 0 }).reason, 'absent');
    t.equal('a handful is thin, not absent', celebrations.volumeVerdict({ totalCalls: 6 }).reason, 'thin');
    t.check('a full week passes', celebrations.volumeVerdict({ totalCalls: 140 }).ok === true);
    // A file with no call-count column must not silently suppress everything.
    t.check('an unknown count does not block a celebration', celebrations.volumeVerdict({}).ok === true);
    t.check('and is marked as unknown rather than counted', celebrations.volumeVerdict({}).known === false);
});
