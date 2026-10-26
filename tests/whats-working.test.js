'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * WHAT'S WORKING
 *
 * Scott, 2026-10-25: "tracking trends, seeing what's working, what's not,
 * where we may need to pivot." One page: the team against the center over
 * weeks (never one week), whether the coaching that went out moved anything,
 * which tips land, and what the scored calls show.
 */

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/coaching-outcomes.module.js');
    t.loadModule('modules/call-scorecard.module.js');
    t.loadModule('modules/whats-working.module.js');
    const m = global.window.DevCoachModules;
    const deps = {
        helpers: m.metricsRegistryHelpers,
        meets: (key, value, year) => m.metricProfiles.meetsYearTarget(key, value, year)
    };
    return { W: m.whatsWorking, m, deps };
}

const TEAM = ['T1', 'T2', 'T3', 'T4'];
const OTHERS = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'];

// Twelve weeks. The team's adherence is at goal for the first eight and
// falls off for the last four; the rest of the center holds. Handle time is
// at goal for everybody throughout.
function weeks() {
    const data = {};
    for (let i = 0; i < 12; i++) {
        const end = new Date(Date.UTC(2026, 7, 2 + i * 7)).toISOString().slice(0, 10);
        const late = i >= 8;
        const person = (name, adherence) => ({
            name, totalCalls: 100, aht: 400, scheduleAdherence: adherence,
            cxRepOverall: 85, repSurveyTotal: 4, fcr: 80, fcrSurveyTotal: 4, overallExperience: 0, surveyTotal: 0
        });
        data[`w${i}`] = {
            metadata: { periodType: 'week', endDate: end },
            employees: [
                ...TEAM.map(name => person(name, late ? 90 : 95)),
                ...OTHERS.map(name => person(name, 95))
            ]
        };
    }
    return data;
}

const row = (trend, key) => trend.rows.find(item => item.metricKey === key);

suite('what\'s working: the team against the center, over weeks', (t) => {
    const { W, deps } = load(t);
    const trend = W.buildTeamTrend(weeks(), TEAM, deps);

    t.equal('the last four uploads', trend.recentWeeks, 4);
    const page = W.buildPageHtml({ trend, coaching: W.buildCoachingResults([], null), calls: W.buildCallTrends({}, TEAM, []) }, (v) => String(v));
    t.check('the date is said "Oct 18", not 2026-10-18', /through Oct 18\)/.test(page));
    t.equal('against the eight before', trend.earlierWeeks, 8);

    const adherence = row(trend, 'scheduleAdherence');
    t.equal('the team is at goal 0% of the last 4 weeks', adherence.teamRecent, 0);
    t.equal('it was 100% the 8 before', adherence.teamEarlier, 1);
    t.check('the center is well ahead', adherence.centerRecent > 0.5);
    t.equal('so adherence is a pivot', adherence.read, 'pivot');
    t.equal('and it is listed first', trend.rows[0].metricKey, 'scheduleAdherence');
    t.check('said in a sentence with both numbers',
        /^0% of the team at goal over the last 4 weeks, against \d+% across the center\. Down from 100% the 8 weeks before\.$/.test(W.rowSentence(adherence, true)));

    t.equal('handle time at goal throughout is working', row(trend, 'aht').read, 'working');
    t.equal('a survey metric nobody answered is not a 0%', row(trend, 'overallExperience').read, 'unknown');
    t.equal('the latest week says how many', JSON.stringify({ met: row(trend, 'aht').latest.met, measured: row(trend, 'aht').latest.measured }), JSON.stringify({ met: 4, measured: 4 }));
});

suite('what\'s working: a week with no calls or no surveys is not counted', (t) => {
    const { W, deps } = load(t);
    const data = weeks();
    Object.values(data).forEach(week => {
        week.employees.forEach(emp => {
            if (emp.name === 'T1') { emp.totalCalls = 0; emp.aht = 0; emp.cxRepOverall = 0; emp.repSurveyTotal = 0; }
        });
    });
    const trend = W.buildTeamTrend(data, TEAM, deps);
    t.equal('three of the four measured on handle time', row(trend, 'aht').latest.measured, 3);
    t.equal('and on rep satisfaction', row(trend, 'cxRepOverall').latest.measured, 3);
});

suite('what\'s working: with no team ticked, the center alone', (t) => {
    const { W, deps } = load(t);
    const trend = W.buildTeamTrend(weeks(), null, deps);
    t.check('says there is no team', !trend.hasTeam);
    const html = W.buildPageHtml({ trend, coaching: W.buildCoachingResults([], null), calls: W.buildCallTrends({}, null, []) }, (v) => String(v));
    t.check('and how to set one', /Tick your team in Settings/.test(html));
});

suite('what\'s working: the read thresholds', (t) => {
    const { W } = load(t);
    t.equal('ten points behind the center is a pivot', W.readOf({ teamRecent: 0.60, teamEarlier: 0.60, centerRecent: 0.70 }, true), 'pivot');
    t.equal('ten points down on the weeks before is a pivot', W.readOf({ teamRecent: 0.70, teamEarlier: 0.80, centerRecent: 0.65 }, true), 'pivot');
    t.equal('at or ahead of the center and holding is working', W.readOf({ teamRecent: 0.75, teamEarlier: 0.74, centerRecent: 0.70 }, true), 'working');
    t.equal('ahead but slipping is watch', W.readOf({ teamRecent: 0.75, teamEarlier: 0.82, centerRecent: 0.70 }, true), 'watch');
    t.equal('a little behind is watch', W.readOf({ teamRecent: 0.65, teamEarlier: 0.65, centerRecent: 0.70 }, true), 'watch');
});

suite('what\'s working: the scored calls add up by line and by person', (t) => {
    const { W, m } = load(t);
    const card = (verdicts) => ({
        lines: Object.keys(verdicts).map(key => ({ key, verdict: verdicts[key] })),
        numbers: { lengthSeconds: 500, goalSeconds: 426 }
    });
    const logs = {
        T1: [
            { listenedOn: '2026-10-01', scorecard: card({ recap: 'missed', greeting: 'yes', nextSteps: 'missed' }) },
            { listenedOn: '2026-10-08', scorecard: card({ recap: 'missed', greeting: 'yes', nextSteps: 'yes' }) }
        ],
        T2: [{ listenedOn: '2026-10-02', scorecard: card({ recap: 'yes', greeting: 'yes', nextSteps: 'na' }) }],
        C1: [{ listenedOn: '2026-10-02', scorecard: card({ recap: 'missed', greeting: 'missed' }) }],
        T3: [{ listenedOn: '2026-01-02', scorecard: card({ recap: 'missed' }) }],
        T4: [{ listenedOn: '2026-10-03', transcript: 'no card on this one' }]
    };
    const calls = W.buildCallTrends(logs, TEAM, m.callScorecard.LINES, { sinceIso: '2026-07-28' });
    t.equal('three of the team\'s calls in the window', calls.scored, 3);
    t.check('enough to show', calls.enough);
    t.equal('the recap is missed most', calls.lines[0].key, 'recap');
    t.equal('on two of three', `${calls.lines[0].missed} of ${calls.lines[0].applied}`, '2 of 3');
    t.check('a Didn\'t apply is not counted against the line', calls.lines.find(l => l.key === 'nextSteps').applied === 2);
    t.equal('T1 first: the fewest lines met', calls.people[0].name, 'T1');
    t.equal('and the line T1 misses most', calls.people[0].topMiss.key, 'recap');
    t.equal('over the handle time goal, counted', calls.overGoal, 3);
    t.check('someone off the team is left out', !calls.people.some(p => p.name === 'C1'));
});

suite('what\'s working: one associate\'s scorecards, on their call history', (t) => {
    const { W, m } = load(t);
    const card = (verdicts, length) => ({
        lines: Object.keys(verdicts).map(key => ({ key, verdict: verdicts[key] })),
        numbers: { lengthSeconds: length, goalSeconds: 426 }
    });
    const entries = [
        { listenedOn: '2026-10-01', scorecard: card({ recap: 'missed', greeting: 'yes', nextSteps: 'yes' }, 500) },
        { listenedOn: '2026-10-08', scorecard: card({ recap: 'missed', greeting: 'yes', nextSteps: 'missed' }, 400) },
        { listenedOn: '2026-10-09', transcript: 'not scored' }
    ];
    const html = W.buildAssociateCallsHtml('T1', entries, m.callScorecard.LINES, (v) => String(v));
    t.check('says how many calls and lines', /Over the last 2 scored calls, 3 of the 6 lines that applied were met\./.test(html));
    t.check('names the misses, most first', /Missed most: Recap before the close on 2 of 2; Next steps, with the when and the amount on 1 of 2\./.test(html));
    t.check('and the handle time goal', /1 of 2 ran over the handle time goal\./.test(html));
    t.equal('one scored call is not a pattern', W.buildAssociateCallsHtml('T1', entries.slice(0, 1), m.callScorecard.LINES, (v) => String(v)), '');
});

suite('what\'s working: coaching results never call a winner on a handful', (t) => {
    const { W, m } = load(t);
    const outcomes = [
        { employee: 'T1', metricKey: 'aht', label: 'Average Handle Time', verdict: 'moved', beatTeam: true, verdict3: 'pending', source: 'call', suggestions: [{ id: 'x', text: 'Say it once', metricKey: 'aht' }] },
        { employee: 'T2', metricKey: 'aht', label: 'Average Handle Time', verdict: 'held flat', beatTeam: false, verdict3: 'pending', source: 'today', suggestions: [] },
        { employee: 'T3', metricKey: 'aht', label: 'Average Handle Time', verdict: 'pending', source: 'coach', suggestions: [] }
    ];
    const results = W.buildCoachingResults(outcomes, m.coachingOutcomes);
    t.equal('three pieces of coaching', results.total, 3);
    t.equal('two settled', results.settled, 2);
    t.equal('one waiting', results.waiting, 1);
    t.equal('counted by where it came from', JSON.stringify(results.bySource), JSON.stringify({ call: 1, today: 1, coach: 1 }));
    t.check('two results is too few to call', results.metrics[0].enough === false);
    t.equal('no tip has a rate on one result', results.tipsWithRate.length, 0);
    t.equal('it is waiting', results.tipsWaiting, 1);

    const html = W.buildPageHtml({ trend: W.buildTeamTrend({}, TEAM, { meets: () => null }), coaching: results, calls: W.buildCallTrends({}, TEAM, []) }, (v) => String(v));
    t.check('says too few to call', /Too few to call/.test(html));
    t.check('names where the coaching came from', /3 pieces of coaching on the team \(1 from calls, 1 from Today, 1 from the Coach page\)/.test(html));

    const old = W.buildCoachingResults([{ employee: 'T1', metricKey: 'aht', label: 'AHT', verdict: 'moved' }], m.coachingOutcomes);
    const oldHtml = W.buildPageHtml({ trend: W.buildTeamTrend({}, TEAM, { meets: () => null }), coaching: old, calls: W.buildCallTrends({}, TEAM, []) }, (v) => String(v));
    t.check('records from before the channel was kept are not called "other", and one is one piece',
        /1 piece of coaching on the team\. 1 has the week after uploaded; 0 are waiting\./.test(oldHtml));
    t.check('says why beating the team is the test', /a week where everyone improved is not evidence/.test(html));
    t.check('no em or en dashes', !/[–—]/.test(html));
});

suite('what\'s working: a tab on Center, Trends', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const nav = fs.readFileSync(path.join(ROOT, 'modules', 'navigation.module.js'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    t.check('the tab is there', /id="innerNavTrWorking"[^>]*>What's working</.test(html));
    t.check('with its panel', /<div id="subSectionTaWorking" style="display: none;"><\/div>/.test(html));
    t.check('the module loads', html.includes("'modules/whats-working.module.js'"));
    t.check('navigation knows it', nav.includes("'subSectionTaWorking'") && nav.includes("'innerNavTrWorking'"));
    t.check('a click draws it', /whatsWorking\?\.render\?\.\(container\)/.test(script));
});
