'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/highlights.module.js').highlights;
}

// Adherence is "higher is better", AHT is "lower is better" — the engine has to
// get the direction right or it praises the wrong people.
const METRICS = [
    { key: 'scheduleAdherence', label: 'Adherence', target: 93, targetType: 'min', noise: 1 },
    { key: 'aht', label: 'AHT', target: 414, targetType: 'max', noise: 15 },
    { key: 'fcr', label: 'FCR', target: 73, targetType: 'min', noise: 2 }
];

function rep(name, extra) {
    return Object.assign({ name, totalCalls: 120 }, extra);
}

suite('highlights: direction is respected for both kinds of metric', (t) => {
    const engine = load(t);

    t.equal('clearing a min target is a positive margin', engine.marginPastTarget(METRICS[0], 96), 3);
    t.equal('missing a min target is a negative margin', engine.marginPastTarget(METRICS[0], 90), -3);
    t.equal('coming in under a max target is a positive margin', engine.marginPastTarget(METRICS[1], 390), 24);
    t.equal('going over a max target is a negative margin', engine.marginPastTarget(METRICS[1], 450), -36);

    t.equal('a rising min metric improved', engine.improvement(METRICS[0], 88, 91), 3);
    t.equal('a falling max metric improved', engine.improvement(METRICS[1], 450, 430), 20);
    t.equal('a rising max metric got worse', engine.improvement(METRICS[1], 400, 430), -30);
});

suite('highlights: only calls out what clears the target by enough', (t) => {
    const engine = load(t);

    const entries = engine.findHighlights([
        rep('Clear Winner', { scheduleAdherence: 98, aht: 380 }),
        rep('Bare Squeak', { scheduleAdherence: 93.4 }),
        rep('Behind', { scheduleAdherence: 88, aht: 500 })
    ], { metrics: METRICS });

    const names = entries.map(e => e.name);
    t.check('the clear winner is named', names.indexOf('Clear Winner') > -1);
    t.check('clearing target by a hair is not a shoutout', names.indexOf('Bare Squeak') === -1);
    t.check('someone behind on everything is not named', names.indexOf('Behind') === -1);

    const winner = entries.find(e => e.name === 'Clear Winner');
    t.equal('both wins are recorded', winner.items.length, 2);
    t.equal('the bigger margin leads', winner.items[0].key, 'aht');
    t.equal('and it is marked as beating target', winner.items[0].kind, 'beatTarget');
});

suite('highlights: a thin sample is not praised', (t) => {
    const engine = load(t);

    const entries = engine.findHighlights([
        { name: 'Two Calls', totalCalls: 2, scheduleAdherence: 100 },
        { name: 'Full Day', totalCalls: 90, scheduleAdherence: 100 }
    ], { metrics: METRICS, minCalls: 20 });

    t.equal('only the real sample survives', entries.length, 1);
    t.equal('and it is the one with volume', entries[0].name, 'Full Day');

    const noFloor = engine.findHighlights([{ name: 'Two Calls', totalCalls: 2, scheduleAdherence: 100 }], { metrics: METRICS });
    t.equal('with no floor set, nothing is filtered', noFloor.length, 1);
});

suite('highlights: improvement counts even short of target', (t) => {
    const engine = load(t);

    const entries = engine.findHighlights(
        [rep('Climbing', { scheduleAdherence: 91 })],
        { metrics: METRICS, previousByName: { Climbing: rep('Climbing', { scheduleAdherence: 85 }) } }
    );

    t.equal('the climber is named', entries.length, 1);
    t.equal('and it reads as an improvement, not a target hit', entries[0].items[0].kind, 'improved');
    t.equal('with the gain recorded', entries[0].items[0].gain, 6);

    const flat = engine.findHighlights(
        [rep('Flat', { scheduleAdherence: 91 })],
        { metrics: METRICS, previousByName: { Flat: rep('Flat', { scheduleAdherence: 90.5 }) } }
    );
    t.equal('a move inside the noise band is not an improvement', flat.length, 0);
});

suite('highlights: perfect surveys are one callout, and need a real sample', (t) => {
    const engine = load(t);

    const options = {
        metrics: [{ key: 'fcr', label: 'FCR', target: 73, targetType: 'min', noise: 2 },
                  { key: 'cxRepOverall', label: 'RepSat', target: 82, targetType: 'min', noise: 2 }],
        surveyMetricKeys: ['fcr', 'cxRepOverall'],
        minSurveys: 3
    };

    const perfect = engine.findHighlights([rep('Flawless', { fcr: 100, cxRepOverall: 100, surveyTotal: 6 })], options);
    t.equal('the survey metrics collapse into one line', perfect[0].items.length, 1);
    t.equal('and it is the perfect-surveys callout', perfect[0].items[0].kind, 'perfectSurveys');
    t.check('which says how many surveys', perfect[0].items[0].detail.indexOf('6 surveys') > -1);

    // One perfect survey is not a perfect week.
    const thin = engine.findHighlights([rep('One Survey', { fcr: 100, cxRepOverall: 100, surveyTotal: 1 })], options);
    t.check('two surveys or fewer does not qualify as perfect', thin[0].items.every(item => item.kind !== 'perfectSurveys'));
    t.check('but the individual metrics still count', thin[0].items.length === 2);

    const mixed = engine.findHighlights([rep('Mixed', { fcr: 100, cxRepOverall: 60, surveyTotal: 8 })], options);
    t.check('one survey metric short of 100 means no perfect callout', mixed[0].items.every(item => item.kind !== 'perfectSurveys'));
});

suite('highlights: the wording names the number, never a rank', (t) => {
    const engine = load(t);

    const format = (key, value) => (key === 'aht' ? `${Math.round(value)}s` : `${value}%`);

    const entry = engine.findHighlights([rep('Alyssa Dimes', { scheduleAdherence: 98, aht: 380 })], { metrics: METRICS })[0];
    const line = engine.buildHighlightLine(entry, { formatValue: format, preferredName: (n) => n.split(' ')[0] });

    t.equal('the line leads with the person', line.indexOf('Alyssa,'), 0);
    t.check('and lists both wins', line.indexOf('AHT 380s') > -1 && line.indexOf('Adherence 98%') > -1);
    t.check('with no rank or tier language', !/\b(#\d|rank|tier|top \d|best|1st|2nd|3rd)\b/i.test(line));

    const three = engine.findHighlights([rep('Triple', { scheduleAdherence: 98, aht: 380, fcr: 90 })], { metrics: METRICS })[0];
    const threeLine = engine.buildHighlightLine(three, { formatValue: format });
    t.check('three wins read as a list with an "and"', /, and /.test(threeLine));
});

suite('highlights: grouped by team for the post', (t) => {
    const engine = load(t);

    const entries = engine.findHighlights([
        rep('Alyssa Dimes', { scheduleAdherence: 98 }),
        rep('Michelle Castro', { scheduleAdherence: 97 }),
        rep('Jordan New', { scheduleAdherence: 99 })
    ], { metrics: METRICS });

    const groups = engine.groupByTeam(entries, { 'Alyssa Dimes': 'Scott', 'Michelle Castro': 'Kathy' });

    t.equal('three people across three buckets', engine.countPeople(groups), 3);
    t.equal('teams sort alphabetically', groups[0].team, 'Kathy');
    t.equal('with unassigned last', groups[groups.length - 1].team, 'Unassigned');

    const post = engine.buildHighlightPost(groups, {
        title: '✨ Yesterday’s Highlights, 08/04/2026',
        formatValue: (key, value) => `${value}%`
    });
    t.check('the post keeps its title', post.indexOf('✨ Yesterday’s Highlights') === 0);
    t.check('and carries team headers when more than one team is in play', post.indexOf('\nKathy\n') > -1);
    t.check('every person gets a bullet', (post.match(/^• /gm) || []).length === 3);

    // With one team the headers are noise.
    const single = engine.groupByTeam(entries.slice(0, 1), { 'Alyssa Dimes': 'Scott' });
    const singlePost = engine.buildHighlightPost(single, { title: 'T', formatValue: (k, v) => `${v}%` });
    t.check('a single team drops the header', singlePost.indexOf('Scott') === -1);

    t.equal('no groups means no post', engine.buildHighlightPost([], { title: 'T' }), '');
});
