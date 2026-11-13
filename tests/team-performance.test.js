'use strict';

const { suite } = require('./harness');

/**
 * TEAM PERFORMANCE (Scott, 2026-11-13)
 *
 * The team's five scorecard KPIs, one period against another, for the
 * year-end self-review. What these pin:
 *
 *  - the team figure is the Teams page's: rates weighted by calls, Rep Sat by
 *    its responses, reliability a plain average per associate;
 *  - a rate's change is in points, and lower-is-better reads a drop as better;
 *  - improved and met goal are separate answers;
 *  - missing stays missing (no surveys is never 0%);
 *  - who joined or had no numbers is said, not hidden;
 *  - the copied text has the dates, the strongest improvement first, the
 *    misses, and coaching kept apart from cause.
 *
 * Every name and number here is made up.
 */

function week(start, end, employees, type) {
    return { [`${start}|${end}`]: { employees, metadata: { startDate: start, endDate: end, periodType: type || 'week' } } };
}

function row(name, over) {
    return Object.assign({ name, totalCalls: 100, surveyTotal: 0, repSurveyTotal: 0, reliability: 0,
        scheduleAdherence: 95, overallSentiment: 90, aht: 500, cxRepOverall: '' }, over || {});
}

// January: Pat and Dana (Lee has not joined). Pat misses 2 hours in one week.
function januaryWeeks() {
    const weeks = [['2025-12-29', '2026-01-04'], ['2026-01-05', '2026-01-11'], ['2026-01-12', '2026-01-18'], ['2026-01-19', '2026-01-25']];
    return Object.assign({}, ...weeks.map(([s, e], i) => week(s, e, [
        row('Pat Rivers', { totalCalls: 100, aht: 500, scheduleAdherence: 95, overallSentiment: 90, cxRepOverall: 80, repSurveyTotal: 5, surveyTotal: 5, reliability: i === 1 ? 2 : 0 }),
        row('Dana Cole', { totalCalls: 300, aht: 460, scheduleAdherence: 91, overallSentiment: 86, cxRepOverall: '', repSurveyTotal: 0, surveyTotal: 0 }),
        row('Sam Ortiz', { totalCalls: 200, aht: 400, scheduleAdherence: 97, overallSentiment: 95, cxRepOverall: 95, repSurveyTotal: 8, surveyTotal: 8 })
    ])));
}

function fixture() {
    return Object.assign({},
        januaryWeeks(),
        // February has a missing week (Feb 9 to 15) and nobody answered a survey.
        week('2026-02-02', '2026-02-08', [row('Pat Rivers', { aht: 480 }), row('Dana Cole', { aht: 450 })]),
        week('2026-02-16', '2026-02-22', [row('Pat Rivers', { aht: 470 }), row('Dana Cole', { aht: 440 })]),
        // Two October weeks with different numbers. The monthly upload covers
        // more of October, so it is the one used.
        week('2026-10-05', '2026-10-11', [row('Pat Rivers', { aht: 999 })]),
        week('2026-10-12', '2026-10-18', [row('Pat Rivers', { aht: 999 })]),
        week('2026-10-01', '2026-10-31', [
            row('Pat Rivers', { totalCalls: 400, aht: 440, scheduleAdherence: 93, overallSentiment: 91, cxRepOverall: 90, repSurveyTotal: 10, surveyTotal: 10, reliability: 0 }),
            row('Dana Cole', { totalCalls: 1200, aht: 430, scheduleAdherence: 92, overallSentiment: 89, cxRepOverall: 84, repSurveyTotal: 15, surveyTotal: 15, reliability: 3 }),
            row('Lee Moss', { totalCalls: 400, aht: 470, scheduleAdherence: 95, overallSentiment: 88, cxRepOverall: '', repSurveyTotal: 0, surveyTotal: 0, reliability: 1.5 }),
            row('Sam Ortiz', { totalCalls: 800, aht: 390, scheduleAdherence: 98, overallSentiment: 96, cxRepOverall: 96, repSurveyTotal: 20, surveyTotal: 20, reliability: 0 })
        ], 'month'),
        // November is under way.
        week('2026-11-02', '2026-11-08', [row('Pat Rivers'), row('Dana Cole'), row('Lee Moss')])
    );
}

const YTD = {
    '2026-01-01|2026-10-26': {
        metadata: { startDate: '2026-01-01', endDate: '2026-10-26', periodType: 'ytd' },
        employees: [
            { name: 'Pat Rivers', reliability: 6 }, { name: 'Dana Cole', reliability: 20 },
            { name: 'Lee Moss', reliability: 4.5 }, { name: 'Sam Ortiz', reliability: 10 }
        ]
    }
};

const COACHING = {
    'Pat Rivers': [
        { employeeId: 'Pat Rivers', generatedAt: '2025-12-15T15:00:00Z', metricsCoached: ['aht'] },
        { employeeId: 'Pat Rivers', generatedAt: '2026-03-04T15:00:00Z', metricsCoached: ['aht'] },
        { employeeId: 'Pat Rivers', generatedAt: '2026-06-10T15:00:00Z', metricsCoached: ['scheduleAdherence'] }
    ],
    'Dana Cole': [{ employeeId: 'Dana Cole', generatedAt: '2026-08-20T15:00:00Z', metricsCoached: ['aht'] }],
    'Sam Ortiz': [{ employeeId: 'Sam Ortiz', generatedAt: '2026-05-01T15:00:00Z', metricsCoached: ['cxRepOverall'] }]
};

function load(t, opts) {
    const o = opts || {};
    t.pinClock(o.today || '2026-11-13');
    t.installFakeBrowser();
    global.weeklyData = o.weekly || fixture();
    global.ytdData = o.ytd === undefined ? YTD : o.ytd;
    global.coachingHistory = o.coaching === undefined ? COACHING : o.coaching;
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/period-compare.module.js');
    t.loadModule('modules/quarter-trend.module.js');
    const supervisors = { 'Pat Rivers': 'Knight', 'Dana Cole': 'Knight', 'Lee Moss': 'Knight', 'Sam Ortiz': 'Vale' };
    global.window.DevCoachModules.teamScope = {
        getSupervisorMap: () => supervisors,
        getMyLabel: () => 'Knight',
        getMyTeamNames: () => ['Pat Rivers', 'Dana Cole', 'Lee Moss']
    };
    const tp = t.loadModule('modules/team-performance.module.js').teamPerformance;
    tp.resetView();
    return tp;
}

function view(teamId, base, comp) {
    return { teamId, baseline: { start: base[0], end: base[1] }, comparison: { start: comp[0], end: comp[1] } };
}

const JAN = ['2026-01-01', '2026-01-31'];
const FEB = ['2026-02-01', '2026-02-28'];
const OCT = ['2026-10-01', '2026-10-31'];

function rowOf(model, key) { return model.rows.filter((r) => r.key === key)[0]; }

suite('team performance: the five KPIs are the year-end scorecard', (t) => {
    const tp = load(t);
    t.equal('AHT, Adherence, Sentiment, Rep Sat, Reliability',
        tp.KPIS.map((k) => k.key).join(','), 'aht,scheduleAdherence,overallSentiment,cxRepOverall,reliability');
    const teams = tp.listTeams();
    t.equal('my team comes first and is named for its supervisor', teams[0].label, 'My team (Knight)');
    t.check('other supervisors\' teams and the whole center follow',
        teams.some((x) => x.id === 'sup:Vale') && teams[teams.length - 1].id === 'center');
});

suite('team performance: which uploads make up a period', (t) => {
    const tp = load(t);
    const jan = tp.resolveRange(...JAN);
    t.equal('January is the weeks ending in January, the way the rest of the app counts it', jan.periods.length, 4);
    t.equal('and says the dates it really covers', tp.fmtRange(jan.spanStart, jan.spanEnd), 'Dec 29, 2025 to Jan 25, 2026');
    t.equal('the six days that belong to a week ending in February are not a gap', jan.gaps.length, 0);

    const oct = tp.resolveRange(...OCT);
    t.equal('a monthly upload covering the month beats two weeks of it', oct.granularity, 'month');
    t.equal('and is described as one', tp.describeSource(oct), '1 monthly upload');

    const feb = tp.resolveRange(...FEB);
    t.equal('a missing week is reported as a gap', feb.gaps.map((g) => tp.fmtRange(g.start, g.end)).join(';'), 'Feb 9 to Feb 15, 2026');

    // A coaching start on a Wednesday: the week it falls in ends inside the
    // dates, so it counts, the same way a month takes its first week.
    const custom = tp.resolveRange('2026-01-14', '2026-01-31');
    t.equal('custom dates take the uploads that end inside them', tp.fmtRange(custom.spanStart, custom.spanEnd), 'Jan 12 to Jan 25, 2026');

    const none = tp.resolveRange('2026-05-01', '2026-05-31');
    t.check('no upload at all is said, not filled', !none.ok && none.periods.length === 0);
});

suite('team performance: the team figure is weighted the Teams page way', (t) => {
    const tp = load(t);
    const model = tp.buildModel(view('mine', JAN, OCT));
    const aht = rowOf(model, 'aht');
    // (500 x 400 calls + 460 x 1200) / 1600 = 470; (440x400 + 430x1200 + 470x400) / 2000 = 440
    t.equal('January AHT is weighted by calls', aht.baselineValue, 470);
    t.equal('October AHT is weighted by calls', aht.comparisonValue, 440);
    t.equal('and counts the associates behind it', aht.comparison.n, 3);
    t.equal('Adherence by calls: (95x400 + 91x1200) / 1600', rowOf(model, 'scheduleAdherence').baselineValue, 92);
    t.equal('Rep Sat by responses: (90x10 + 84x15) / 25', rowOf(model, 'cxRepOverall').comparisonValue, 86.4);
    t.equal('someone with no surveys is left out of Rep Sat, not counted as 0%', rowOf(model, 'cxRepOverall').comparison.n, 2);
    t.equal('reliability is the plain average per associate: (2 + 0) / 2', rowOf(model, 'reliability').baselineValue, 1);
    t.equal('and labelled as such', rowOf(model, 'reliability').baseline.method, 'person');
    t.equal('another team\'s people are not in my team', model.roster.comparisonCount, 3);

    const center = tp.buildModel(view('center', JAN, OCT));
    t.equal('the whole center counts everyone', center.roster.comparisonCount, 4);
});

suite('team performance: change, direction and goal are separate answers', (t) => {
    const tp = load(t);
    const model = tp.buildModel(view('mine', JAN, OCT));

    const aht = rowOf(model, 'aht');
    t.equal('AHT went down 30 seconds', aht.change, -30);
    t.equal('lower is better, so that is an improvement', aht.status, 'improved');
    t.equal('and still misses the 426 second goal', aht.met, false);
    t.equal('shown in seconds', tp.fmtChange('aht', aht.change), '-30 sec');

    const rep = rowOf(model, 'cxRepOverall');
    t.equal('a rate gains points, not percent', tp.fmtChange('cxRepOverall', rep.change), '+6.4 pts');
    t.equal('said as points', tp.changeInWords('cxRepOverall', rep.change), 'up 6.4 points');
    t.check('Rep Sat improved and met its goal, and was not met before', rep.status === 'improved' && rep.met === true && rep.baselineMet === false);

    const adh = rowOf(model, 'scheduleAdherence');
    t.check('Adherence improved to 92.8% and still did not meet 93%', adh.status === 'improved' && adh.comparisonValue === 92.8 && adh.met === false);

    const rel = rowOf(model, 'reliability');
    t.equal('more hours missed is a decline', rel.status, 'declined');
    t.equal('a month is not judged against the year\'s hours', rel.met, null);
    t.equal('the year to date answer comes from the newest YTD upload', model.reliabilityYtd.average, 10.2);
    t.equal('with how many are within the goal', `${model.reliabilityYtd.under} of ${model.reliabilityYtd.n}`, '2 of 3');

    t.equal('level is level', tp.compareKpi(tp.KPIS[0], { value: 450 }, { value: 450.2 }, { comparisonYear: 2026, baselineYear: 2026 }).status, 'level');
});

suite('team performance: missing stays missing', (t) => {
    const tp = load(t);
    const model = tp.buildModel(view('mine', FEB, OCT));
    const rep = rowOf(model, 'cxRepOverall');
    t.equal('February had no surveys, so no Rep Sat', rep.baselineValue, null);
    t.equal('and no change is claimed', rep.status, 'missing');
    t.check('the comparison side still judges its own goal', rep.met === true);

    const empty = tp.buildModel(view('mine', ['2026-05-01', '2026-05-31'], OCT));
    t.check('a month with no uploads has nothing in any row',
        empty.rows.every((r) => r.baselineValue === null && r.status === 'missing'));
    t.equal('and names nobody', empty.roster.baselineCount, 0);

    // A 0 second handle time means no calls.
    const zero = load(t, { weekly: week('2026-03-02', '2026-03-08', [row('Pat Rivers', { aht: 0, totalCalls: 0 }), row('Dana Cole', { aht: 450, totalCalls: 100 })]) });
    const range = zero.resolveRange('2026-03-01', '2026-03-31');
    const result = zero.buildTeamResult(range, zero.listTeams()[0]);
    t.equal('a 0 second handle time is left out, never a win', result.kpis.aht.value, 450);
    t.equal('so only one associate stands behind it', result.kpis.aht.n, 1);
});

suite('team performance: a roster change is shown', (t) => {
    const tp = load(t);
    const model = tp.buildModel(view('mine', JAN, OCT));
    t.equal('Lee is only in October', model.roster.onlyComparison.join(','), 'Lee Moss');
    t.equal('nobody is only in January', model.roster.onlyBaseline.length, 0);
    t.check('and the change is flagged', model.roster.changed);
    t.equal('January counts two, October three', `${model.roster.baselineCount}/${model.roster.comparisonCount}`, '2/3');
});

suite('team performance: the default periods', (t) => {
    const tp = load(t);
    const team = tp.listTeams()[0];
    const d = tp.defaultPeriods(2026, team);
    t.equal('first complete month of the year', `${d.baseline.start} ${d.baseline.end}`, '2026-01-01 2026-01-31');
    t.equal('against the latest complete month (November is still running)', `${d.comparison.start} ${d.comparison.end}`, '2026-10-01 2026-10-31');
    t.equal('and says why', d.reason, 'complete');

    const months = tp.monthOptions(2026, team);
    t.check('February has numbers but a missing week, so it is not complete',
        months[1].hasData && !months[1].complete);
    t.check('November is in progress', months[10].hasData && !months[10].ended);
    t.equal('the review year is the newest with uploads', tp.defaultYear(), 2026);

    const bare = load(t, { weekly: {} });
    const none = bare.defaultPeriods(2026, bare.listTeams()[0]);
    t.check('with nothing uploaded it still offers January against the last month that ended',
        none.reason === 'none' && none.baseline.start === '2026-01-01' && none.comparison.start === '2026-10-01');
});

suite('team performance: official figures typed in stand in', (t) => {
    const tp = load(t);
    t.equal('AHT takes m:ss', tp.parseEnteredValue('aht', '7:36').value, 456);
    t.equal('and plain seconds', tp.parseEnteredValue('aht', '456 sec').value, 456);
    t.equal('a rate takes a percent sign', tp.parseEnteredValue('cxRepOverall', '87.5%').value, 87.5);
    t.check('blank is no figure, not zero', tp.parseEnteredValue('cxRepOverall', '  ').value === null && !tp.parseEnteredValue('cxRepOverall', '').error);
    t.check('a rate over 100 is refused', !!tp.parseEnteredValue('scheduleAdherence', '120').error);
    t.check('words are refused', !!tp.parseEnteredValue('reliability', 'lots').error);

    const MAY = ['2026-05-01', '2026-05-31'];
    tp.saveFigures('mine', MAY[0], MAY[1], { aht: 480, cxRepOverall: 81, scheduleAdherence: null });
    const model = tp.buildModel(view('mine', MAY, OCT));
    const aht = rowOf(model, 'aht');
    t.equal('a typed figure fills a period no upload covers', aht.baselineValue, 480);
    t.equal('and is marked official', aht.baseline.method, 'official');
    t.equal('the comparison math runs on it', aht.change, -40);
    t.equal('a box left blank stays missing', rowOf(model, 'scheduleAdherence').baselineValue, null);

    const other = tp.buildModel(view('sup:Vale', MAY, OCT));
    t.equal('figures belong to the team they were typed for', rowOf(other, 'aht').baselineValue, null);

    tp.saveFigures('mine', MAY[0], MAY[1], {});
    t.equal('clearing them removes them', tp.figuresFor('mine', MAY[0], MAY[1]), null);
});

suite('team performance: the documented coaching is a count, kept apart', (t) => {
    const tp = load(t);
    const co = tp.documentedCoaching(tp.listTeams()[0], '2026-01-01', '2026-10-31');
    t.equal('three records in the dates, the December one left out', co.records, 3);
    t.equal('for two associates, not the other team\'s', co.associates, 2);
    t.equal('most often about handle time', `${co.topics[0].label} ${co.topics[0].count}`, 'Average Handle Time 2');
});

suite('team performance: the copied year-end summary', (t) => {
    const tp = load(t);
    const model = tp.buildModel(view('mine', JAN, OCT));
    const text = tp.buildSummaryText(model);
    const lines = text.split('\n');

    t.check('it names the team', lines[0] === 'Team Performance: My team (Knight)');
    t.check('it carries the actual dates and the uploads behind each period',
        text.includes('Baseline: January 2026 (Jan 1 to Jan 31, 2026). Data used: 4 weekly uploads, Dec 29, 2025 to Jan 25, 2026.')
        && text.includes('Comparison: October 2026 (Oct 1 to Oct 31, 2026). Data used: 1 monthly upload, Oct 1 to Oct 31, 2026.'));
    t.check('it says who was counted', text.includes('2 had numbers in January 2026 and 3 in October 2026') && text.includes('1 appears only in October 2026'));

    const from = lines.indexOf('Results (strongest improvements first)') + 1;
    const results = lines.slice(from, lines.indexOf('', from));
    t.equal('strongest improvement first, measured in noise steps', results.map((l) => l.slice(2).split(':')[0]).join(','),
        'Rep Satisfaction,Overall Sentiment,Average Handle Time,Schedule Adherence,Reliability (average hours missed per associate)');
    t.check('an improvement that missed its goal says both',
        results[2].startsWith('- Average Handle Time: 470 sec to 440 sec, down 30 seconds. Improved. Did not meet the goal (426 sec or lower).'));
    t.check('a decline is kept in the results', results[4].includes('Declined.'));
    t.check('reliability gives the year to date answer',
        results[4].includes('Year to date through Oct 26, 2026, the team averages 10.2 hrs per associate, and 2 of 3 are within the goal.'));
    t.check('the method is stated, including the plain average', text.includes('Reliability is a plain average'));
    t.check('coaching is its own section and claims no cause',
        text.includes('Documented coaching (the app\'s coaching log, Jan 1 to Oct 31, 2026)') && text.includes('It does not show what caused any change above.'));

    const draft = lines[lines.length - 1];
    t.check('the draft is first person and leads with what improved',
        draft.startsWith('From January 2026 to October 2026, my team improved on 4 of the 5 scorecard KPIs we can compare. Rep Satisfaction moved from 80.0% to 86.4%, up 6.4 points, and it meets the goal of 82% or higher.'));
    t.check('it names what is still being worked on', draft.includes('We are still working on Schedule Adherence (92.8% against a goal of 93% or higher)'));
    t.check('the coaching sentence states what was logged, not what it did',
        draft.includes('I documented 3 coaching conversations in our coaching tool, most often on average handle time and schedule adherence.')
        && !/because|led to|resulted|thanks to|drove/i.test(draft));
    t.check('no em or en dashes', !/[—–]/.test(text));
    t.check('no emoji', !/\p{Extended_Pictographic}/u.test(text));

    const missing = tp.buildSummaryText(tp.buildModel(view('mine', FEB, OCT)));
    t.check('a missing baseline is said plainly',
        missing.includes('- Rep Satisfaction: no data for February 2026, so there is no change to report. October 2026: 86.4%.'));
    t.check('and the gap in the uploads is named', missing.includes('Not covered by any upload: Feb 9 to Feb 15, 2026.'));

    const noCoaching = load(t, { coaching: {} });
    const plain = noCoaching.buildSummaryText(noCoaching.buildModel(view('mine', JAN, OCT)));
    t.check('with nothing logged, coaching is left out entirely', !plain.includes('coaching'));
});
