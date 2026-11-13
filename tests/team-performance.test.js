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
    const weeks = [['2025-12-29', '2026-01-04'], ['2026-01-05', '2026-01-11'], ['2026-01-12', '2026-01-18'], ['2026-01-19', '2026-01-25'], ['2026-01-26', '2026-02-01']];
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
    global.dailyData = o.daily || {};
    global.getDailyArchive = () => o.archive || {};
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
    t.equal('January from weekly reports is the five weeks with most of their days in it', jan.periods.length, 5);
    t.equal('and says the dates the figures really cover', tp.fmtRange(jan.spanStart, jan.spanEnd), 'Dec 29, 2025 to Feb 1, 2026');
    t.equal('the days outside January are listed, one stretch at each end',
        jan.spill.map((x) => tp.fmtRange(x.start, x.end)).join(';'), 'Dec 29 to Dec 31, 2025;Feb 1 to Feb 1, 2026');
    t.equal('so it is approximate, never called complete', jan.tier, 'approximate');

    const oct = tp.resolveRange(...OCT);
    t.equal('a monthly report covering the month is used alone', oct.periods.map((p) => p.type).join(','), 'month');
    t.equal('and is described as one', tp.describeSource(oct), '1 monthly report');
    t.equal('and is exact', oct.tier, 'exact');

    const feb = tp.resolveRange(...FEB);
    t.equal('missing weeks are reported as gaps, the week that ran into February left with January',
        feb.gaps.map((g) => tp.fmtRange(g.start, g.end)).join(';'), 'Feb 9 to Feb 15, 2026;Feb 23 to Feb 28, 2026');
    t.equal('Feb 1 sits in a week that is mostly January, so it is named as not counted, not as a gap',
        feb.leftOut.map((x) => `${x.start} ${x.from.startDate}`).join(';'), '2026-02-01 2026-01-26');

    // The last two days of a month in a week that is mostly next month are
    // in a report, just not one that belongs to this month. Not a gap.
    const marTail = load(t, { weekly: Object.assign(fixture(),
        week('2026-03-16', '2026-03-22', [row('Pat Rivers')]), week('2026-03-23', '2026-03-29', [row('Pat Rivers')]),
        week('2026-03-30', '2026-04-05', [row('Pat Rivers')])) }).resolveRange('2026-03-16', '2026-03-31');
    t.equal('days only in a report that is mostly outside are not counted, and say which report',
        marTail.leftOut.map((x) => `${x.start} ${x.end} ${x.reason}`).join(';'), '2026-03-30 2026-03-31 outside');
    t.check('and are not called a gap', marTail.gaps.length === 0 && marTail.tier === 'approximate');
    t.equal('and the month has gaps', feb.tier, 'gaps');

    // A coaching start on a Wednesday. The week it falls in has five of its
    // seven days inside the dates, so it is used, and its two days before
    // the start are named.
    const custom = tp.resolveRange('2026-01-14', '2026-01-31');
    t.equal('custom dates take each edge week with most of its days inside', tp.fmtRange(custom.spanStart, custom.spanEnd), 'Jan 12 to Feb 1, 2026');
    t.equal('and name the days outside', custom.spill.map((x) => tp.fmtRange(x.start, x.end)).join(';'), 'Jan 12 to Jan 13, 2026;Feb 1 to Feb 1, 2026');

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
    t.equal('only October is exact, so the earliest approximate month is the baseline', `${d.baseline.start} ${d.baseline.end}`, '2026-01-01 2026-01-31');
    t.equal('against the latest finished month (November is still running)', `${d.comparison.start} ${d.comparison.end}`, '2026-10-01 2026-10-31');
    t.equal('and it says the comparison is approximate', d.reason, 'approximate');

    const months = tp.monthOptions(2026, team);
    t.equal('each month is graded', [0, 1, 9, 10].map((i) => months[i].tier).join(','), 'approximate,gaps,exact,progress');
    t.check('November is not finished', months[10].hasData && !months[10].ended);
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
    t.check('it gives the selected dates and the dates the figures really cover',
        text.includes('Baseline: January 2026, selected Jan 1 to Jan 31, 2026.\n  Figures cover Dec 29, 2025 to Feb 1, 2026, from 5 weekly reports. Coverage: approximate.')
        && text.includes('Comparison: October 2026, selected Oct 1 to Oct 31, 2026.\n  Figures cover Oct 1 to Oct 31, 2026, from 1 monthly report. Coverage: exact.'));
    t.check('it names the days outside the selection and the report each came from',
        text.includes('  Outside the selected dates: Dec 29 to Dec 31, 2025 (from the Dec 29, 2025 to Jan 4, 2026 report); Feb 1, 2026 (from the Jan 26 to Feb 1, 2026 report).'));
    t.check('the results carry the actual dates', text.includes('Figures compare Dec 29, 2025 to Feb 1, 2026 with Oct 1 to Oct 31, 2026.'));
    t.check('it says who was counted', text.includes('2 had numbers in January 2026 and 3 in October 2026') && text.includes('1 appears only in October 2026'));

    const from = lines.indexOf('Results (strongest improvements first)') + 1;
    const results = lines.slice(from, lines.indexOf('', from)).filter((l) => l.startsWith('- '));
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
        draft.startsWith('Comparing January 2026 (figures cover Dec 29, 2025 to Feb 1, 2026) with October 2026, my team improved on 4 of the 5 scorecard KPIs we can compare. Rep Satisfaction moved from 80.0% to 86.4%, up 6.4 points, and it meets the goal of 82% or higher.'));
    t.check('it names what is still being worked on', draft.includes('We are still working on Schedule Adherence (92.8% against a goal of 93% or higher)'));
    t.check('the coaching sentence states what was logged, not what it did',
        draft.includes('I documented 3 coaching conversations in our coaching tool, most often on average handle time and schedule adherence.')
        && !/because|led to|resulted|thanks to|drove/i.test(draft));
    t.check('no em or en dashes', !/[—–]/.test(text));
    t.check('no emoji', !/\p{Extended_Pictographic}/u.test(text));

    const missing = tp.buildSummaryText(tp.buildModel(view('mine', FEB, OCT)));
    t.check('a missing baseline is said plainly',
        missing.includes('- Rep Satisfaction: no data for February 2026, so there is no change to report. October 2026: 86.4%.'));
    t.check('and the gaps in the reports are named', missing.includes('  No report covers: Feb 9 to Feb 15, 2026; Feb 23 to Feb 28, 2026.'));

    const noCoaching = load(t, { coaching: {} });
    const plain = noCoaching.buildSummaryText(noCoaching.buildModel(view('mine', JAN, OCT)));
    t.check('with nothing logged, coaching is left out entirely', !plain.includes('coaching'));
});

/* ── Coverage: the selected dates against the dates the figures cover ── */

function aprilMayWeeks() {
    const out = {};
    for (let s = '2026-04-13'; s <= '2026-05-25';) {
        const d = new Date(s + 'T00:00:00Z');
        const e = new Date(d); e.setUTCDate(e.getUTCDate() + 6);
        const end = e.toISOString().slice(0, 10);
        Object.assign(out, week(s, end, [
            row('Pat Rivers', { totalCalls: 100, aht: 450 }),
            row('Dana Cole', { totalCalls: 300, aht: 430 })
        ]));
        const n = new Date(d); n.setUTCDate(n.getUTCDate() + 7);
        s = n.toISOString().slice(0, 10);
    }
    return out;
}

function day(date, employees) {
    return { [`${date}|${date}`]: { employees, metadata: { startDate: date, endDate: date, periodType: 'daily', uploadedAt: `${date}T22:00:00Z` } } };
}

function dailies(dates) {
    return Object.assign({}, ...dates.map((d) => day(d, [
        row('Pat Rivers', { totalCalls: 20, aht: 300 }),
        row('Dana Cole', { totalCalls: 60, aht: 300 })
    ])));
}

const INITIATIVE = ['2026-04-15', '2026-05-31'];

suite('team performance coverage: a weekly report past the selected dates is used and named', (t) => {
    const tp = load(t, { weekly: Object.assign(fixture(), aprilMayWeeks()) });
    const r = tp.resolveRange(...INITIATIVE);
    t.equal('the week the start falls in has five of its days inside, so it is used', r.periods[0].startDate, '2026-04-13');
    t.equal('its two days before the start are named', r.spill.map((x) => `${x.start} ${x.end}`).join(';'), '2026-04-13 2026-04-14');
    t.equal('so the dates are approximate', r.tier, 'approximate');
    const model = tp.buildModel(view('mine', INITIATIVE, OCT));
    t.equal('the figure uses all seven weeks: (450x700 + 430x2100) / 2800', rowOf(model, 'aht').baselineValue, 435);
    const text = tp.buildSummaryText(model);
    t.check('the clipboard names the days outside and the report they came from',
        text.includes('  Outside the selected dates: Apr 13 to Apr 14, 2026 (from the Apr 13 to Apr 19, 2026 report).'));
    t.check('and the period as the selection, with what the figures really cover',
        text.includes('Baseline: Apr 15 to May 31, 2026, selected Apr 15 to May 31, 2026.\n  Figures cover Apr 13 to May 31, 2026, from 7 weekly reports. Coverage: approximate.'));
});

suite('team performance coverage: daily files give the exact dates when they cover the weekdays', (t) => {
    const archive = dailies(['2026-04-15', '2026-04-16', '2026-04-17']);
    const tp = load(t, { weekly: Object.assign(fixture(), aprilMayWeeks()), archive });
    const r = tp.resolveRange(...INITIATIVE);
    t.equal('the three weekday files replace the week that ran past the start', tp.describeSource(r), '6 weekly reports and 3 daily reports');
    t.equal('so nothing outside the dates is counted', r.spill.length, 0);
    t.equal('the weekend, only in the week the dailies replaced, is named as not counted',
        r.leftOut.map((x) => `${x.start} ${x.end} ${x.reason}`).join(';'), '2026-04-18 2026-04-19 overlap');
    t.equal('and keeps it approximate rather than exact', r.tier, 'approximate');
    const model = tp.buildModel(view('mine', INITIATIVE, OCT));
    t.equal('the figure uses the dailies, not the week as well: (450x600 + 300x60 + 430x1800 + 300x180) / 2640',
        rowOf(model, 'aht').baselineValue, 423);

    const weekend = load(t, { weekly: Object.assign(fixture(), aprilMayWeeks()), archive: dailies(['2026-04-15', '2026-04-16', '2026-04-17', '2026-04-18', '2026-04-19']) });
    t.equal('with the weekend files too, the dates are exact', weekend.resolveRange(...INITIATIVE).tier, 'exact');

    const thin = load(t, { weekly: Object.assign(fixture(), aprilMayWeeks()), daily: dailies(['2026-04-15', '2026-04-16']) });
    const t2 = thin.resolveRange(...INITIATIVE);
    t.equal('with a weekday missing from the dailies, the whole week is used instead', t2.periods[0].startDate, '2026-04-13');
    t.equal('and its days outside are named', t2.spill.length, 1);
});

suite('team performance coverage: weekly and monthly reports never count the same day twice', (t) => {
    const tp = load(t);
    const oct = tp.buildModel(view('mine', OCT, OCT));
    // The two October weeks carry 999 second handle times. Counted beside
    // the month, they would pull the figure far off 440.
    t.equal('the month alone stands for October', rowOf(oct, 'aht').comparisonValue, 440);

    const mid = tp.resolveRange('2026-10-05', '2026-10-18');
    t.equal('dates inside the month take the weeks, not the month that runs past them', mid.periods.map((p) => p.type).join(','), 'week,week');
    t.equal('and are exact', mid.tier, 'exact');

    const again = Object.assign(fixture(),
        week('2026-10-06', '2026-10-11', [row('Pat Rivers', { aht: 100 })]),
        week('2026-10-05', '2026-10-11', [row('Pat Rivers', { aht: 999 })]));
    const twice = load(t, { weekly: again }).resolveRange('2026-10-05', '2026-10-18');
    t.equal('a week uploaded twice with different dates is used once', twice.periods.length, 2);
});

suite('team performance coverage: two exactly covered months make the default', (t) => {
    const weekly = Object.assign(fixture(), week('2026-09-01', '2026-09-30', [
        row('Pat Rivers', { aht: 450 }), row('Dana Cole', { aht: 445 })
    ], 'month'));
    const tp = load(t, { weekly });
    const d = tp.defaultPeriods(2026, tp.listTeams()[0]);
    t.equal('the earliest and latest exact months', `${d.baseline.start} ${d.comparison.start}`, '2026-09-01 2026-10-01');
    t.equal('said as exact', d.reason, 'exact');
    t.check('and the earlier, approximate January is pointed out rather than hidden',
        d.note.startsWith('January 2026 has numbers too, covered only approximately.'));
});

suite('team performance coverage: weekend days no report covers are listed, not called gaps', (t) => {
    const tp = load(t, { archive: dailies(['2026-04-15', '2026-04-16', '2026-04-17']) });
    const r = tp.resolveRange('2026-04-15', '2026-04-19');
    t.equal('three daily files', tp.describeSource(r), '3 daily reports');
    t.equal('the weekend is listed apart', r.weekendHoles.map((x) => `${x.start} ${x.end}`).join(';'), '2026-04-18 2026-04-19');
    t.check('not as a gap, and the dates are approximate', r.gaps.length === 0 && r.tier === 'approximate');
});
