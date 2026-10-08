'use strict';

const { suite } = require('./harness');

/**
 * Teams: reliability scaled to time in seat, and CX needing 3 surveys.
 *
 * Reliability is hours missed against one allowance for the whole year (18 for
 * a 3, 24 for a 2). Someone hired in June has had a third of the year to miss
 * hours in, so a pace that costs a full-year associate the KPI left a new hire
 * on a 3 and lifted their team's Avg Score. Scott approved scaling it on
 * 2026-10-08, for the team standings only: hours x days in the period / days
 * in seat, and under four weeks in seat reliability is left out.
 *
 * The person's own score from the shared scorer must not move, because every
 * other screen reads it. CX under three surveys needed no change: the shared
 * scorer already leaves it out, and that is pinned here so Teams keeps it.
 */

function emp(name, over) {
    return Object.assign({
        name,
        totalCalls: 900,
        surveyTotal: 10,
        reliability: 10,
        scheduleAdherence: 95,
        cxRepOverall: 90,
        overallSentiment: 92,
        aht: 400
    }, over || {});
}

function week(start, end, people) {
    return {
        [start + '|' + end]: {
            employees: people.map((n) => ({ name: n })),
            metadata: { startDate: start, endDate: end, periodType: 'week' }
        }
    };
}

// The year's uploads start the week of January 5. Early Eve misses week one
// but is there in week two; June Hire first appears on June 1; Late Hire on
// August 17.
const WEEKLY = Object.assign({},
    week('2026-01-05', '2026-01-11', ['Full Year']),
    week('2026-01-12', '2026-01-18', ['Full Year', 'Early Eve']),
    week('2026-06-01', '2026-06-07', ['Full Year', 'Early Eve', 'June Hire']),
    week('2026-08-17', '2026-08-23', ['Full Year', 'Early Eve', 'June Hire', 'Late Hire']),
    // A quarter-long upload starting in January seats nobody from January.
    { '2026-01-01|2026-03-31': { employees: [{ name: 'Late Hire' }], metadata: { startDate: '2026-01-01', endDate: '2026-03-31', periodType: 'quarter' } } }
);

const YTD_WINDOW = { start: '2026-01-01', end: '2026-08-31' };

function load(t, opts) {
    const o = opts || {};
    t.installFakeBrowser();
    global.weeklyData = o.weekly || WEEKLY;
    global.ytdData = o.ytd || {};
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/on-off-tracker.module.js');
    t.loadModule('modules/center-ranking.module.js');
    t.loadModule('modules/period-compare.module.js');
    // The bridge script.js defines onto metric-profiles, so scoring goes
    // through the real 2026 bands.
    global.window.getMetricRatingScore = global.window.DevCoachModules.metricProfiles.getRatingScore;
    global.window.DevCoachModules.storage = {
        readStore: (key) => (key === 'employeeSupervisors' ? (o.supervisors || {}) : {})
    };
    return global.window.DevCoachModules;
}

function rowsFor(m, people) {
    const rows = m.centerRanking.scoreAndRankEmployees(people, 2026);
    const byName = {};
    rows.forEach((r) => { byName[r.name] = r; });
    return byName;
}

suite('team standing: a full-year associate is scored exactly as the shared scorer has it', (t) => {
    const m = load(t);
    const rows = rowsFor(m, [emp('Full Year', { reliability: 16 })]);
    const ctx = m.centerRanking.buildSeatContext(YTD_WINDOW, 2026);
    const st = m.centerRanking.teamStandingScore(rows['Full Year'], ctx);

    t.check('there is a context to score against', !!ctx);
    t.equal('the same score', st.ratingAverage, rows['Full Year'].ratingAverage);
    t.equal('the same KPIs counted', st.measuredCount, rows['Full Year'].measuredCount);
    t.equal('and nothing is marked as scaled', st.seat, null);
});

suite('team standing: a June hire\'s hours are scaled to the whole year', (t) => {
    const m = load(t);
    const rows = rowsFor(m, [emp('June Hire', { reliability: 10 })]);
    const row = rows['June Hire'];
    const st = m.centerRanking.teamStandingScore(row, m.centerRanking.buildSeatContext(YTD_WINDOW, 2026));

    // January 1 to August 31 is 243 days; June 1 to August 31 is 92 in seat.
    // 10 hours x 243 / 92 = 26.41, past the 24 hours a 2 allows.
    t.check('their own reliability score is untouched', row.scores.reliability === 3);
    t.check('the hours are scaled', st.seat && Math.abs(st.seat.scaledHours - 26.41) < 0.01);
    t.equal('from the hours they actually missed', st.seat && st.seat.hours, 10);
    t.equal('and reliability now counts as a 1 in the team score',
        st.ratingAverage, (row.scoreSum - 3 + 1) / row.measuredCount);
    t.equal('still five KPIs counted', st.measuredCount, row.measuredCount);
});

suite('team standing: under four weeks in seat, reliability is left out', (t) => {
    const m = load(t);
    const rows = rowsFor(m, [emp('Late Hire', { reliability: 1 })]);
    const row = rows['Late Hire'];
    const st = m.centerRanking.teamStandingScore(row, m.centerRanking.buildSeatContext(YTD_WINDOW, 2026));

    t.check('marked as too new', st.seat && st.seat.tooNew === true);
    t.equal('one KPI fewer counted', st.measuredCount, row.measuredCount - 1);
    t.equal('and the score is over the rest',
        st.ratingAverage, (row.scoreSum - row.scores.reliability) / (row.measuredCount - 1));
});

suite('team standing: a late first week is not a new hire', (t) => {
    // Early Eve's first upload is a week after the year's first. That is a week
    // off, not a hire date.
    const m = load(t);
    const rows = rowsFor(m, [emp('Early Eve', { reliability: 17 })]);
    const st = m.centerRanking.teamStandingScore(rows['Early Eve'], m.centerRanking.buildSeatContext(YTD_WINDOW, 2026));
    t.equal('nothing is scaled', st.seat, null);
    t.equal('and the score is the shared one', st.ratingAverage, rows['Early Eve'].ratingAverage);
});

suite('team standing: someone in seat before the period starts is not scaled', (t) => {
    // A June hire looked at on August alone was there for all of August.
    const m = load(t);
    const rows = rowsFor(m, [emp('June Hire', { reliability: 2 })]);
    const ctx = m.centerRanking.buildSeatContext({ start: '2026-08-01', end: '2026-08-31' }, 2026);
    t.equal('nothing is scaled', m.centerRanking.teamStandingScore(rows['June Hire'], ctx).seat, null);
});

suite('team standing: without the period\'s dates, nothing changes', (t) => {
    const m = load(t);
    const rows = rowsFor(m, [emp('June Hire', { reliability: 10 })]);
    const st = m.centerRanking.teamStandingScore(rows['June Hire'], null);
    t.equal('the shared score stands', st.ratingAverage, rows['June Hire'].ratingAverage);
    t.equal('the context refuses a missing window', m.centerRanking.buildSeatContext(null, 2026), null);
});

suite('team standing: CX under three surveys is not part of anyone\'s team score', (t) => {
    // The shared scorer has left it out since 2026-09-08 (MIN_SURVEYS_TO_SCORE).
    // Pinned here because the Teams standing reads that score.
    const m = load(t);
    const rows = rowsFor(m, [
        emp('Two Surveys', { surveyTotal: 2, cxRepOverall: 100 }),
        emp('Three Surveys', { surveyTotal: 3, cxRepOverall: 100 })
    ]);
    const ctx = m.centerRanking.buildSeatContext(YTD_WINDOW, 2026);
    const two = m.centerRanking.teamStandingScore(rows['Two Surveys'], ctx);
    const three = m.centerRanking.teamStandingScore(rows['Three Surveys'], ctx);

    t.equal('two surveys: CX has no score', rows['Two Surveys'].scores.associateOverall, null);
    t.equal('so four KPIs count', two.measuredCount, 4);
    t.equal('three surveys: CX is scored', rows['Three Surveys'].scores.associateOverall, 3);
    t.equal('so all five count', three.measuredCount, 5);
});

/* ── Through the Teams page ── */

function teamYtd() {
    // Two teams of eight with identical numbers. Beta's four June hires have
    // missed the same 10 hours as everyone else, in a third of the time.
    const people = [];
    const sups = {};
    const weeks = [];
    for (let i = 0; i < 8; i += 1) {
        people.push(emp('Alpha ' + i)); sups['Alpha ' + i] = 'Alpha';
        people.push(emp('Beta ' + i)); sups['Beta ' + i] = 'Beta';
    }
    const early = people.map((p) => p.name).filter((n) => !/^Beta [4-7]$/.test(n));
    weeks.push(week('2026-01-05', '2026-01-11', early));
    weeks.push(week('2026-06-01', '2026-06-07', people.map((p) => p.name)));
    return {
        weekly: Object.assign({}, ...weeks),
        ytd: {
            '2026-01-01|2026-08-31': {
                employees: people,
                metadata: { startDate: '2026-01-01', endDate: '2026-08-31', periodType: 'ytd', label: 'YTD through Aug 31' }
            }
        },
        supervisors: sups
    };
}

suite('teams page: new hires no longer lift their team on reliability', (t) => {
    const fx = teamYtd();
    const m = load(t, fx);
    const matchup = t.loadModule('modules/matchup.module.js').matchup;
    const data = matchup.buildMatchupData('2026-01-01|2026-08-31');

    t.check('the matchup is built', !!data);
    if (!data) return;
    const alpha = data.teamStats.Alpha;
    const beta = data.teamStats.Beta;
    t.check('both teams are there', !!alpha && !!beta);
    t.check('the team with the June hires now scores lower', beta.avgRating < alpha.avgRating);
    t.equal('four people were scaled', beta.seatScaled, 4);
    t.equal('nobody on the full-year team was', alpha.seatScaled, 0);

    // Their own rows, which the center table reads, are untouched.
    const hire = data.rankings.find((r) => r.name === 'Beta 5');
    t.equal('the hire\'s own reliability score is unchanged', hire.scores.reliability, 3);
    t.check('the standing carries the scaled one', data.standing['Beta 5'].seat && data.standing['Beta 5'].seat.scaledHours > 24);

    const table = matchup.renderTeamRankings(data);
    t.check('the standings say who was scaled and why',
        table.includes('4 associates joined partway through this period') &&
        table.includes('scaled to the whole period'));
    t.check('and that scorecards are unchanged', table.includes('Each person\'s own scorecard is unchanged.'));
});

suite('team movement: scaled the same way as the Teams standings', (t) => {
    const fx = teamYtd();
    const m = load(t, fx);
    const pc = m.periodCompare;
    const people = fx.ytd['2026-01-01|2026-08-31'].employees;

    const plain = pc.compareTeams(people, people, fx.supervisors, 2026, { minShared: 3, minTeamSize: 3 });
    const seated = pc.compareTeams(people, people, fx.supervisors, 2026, {
        minShared: 3, minTeamSize: 3,
        prevWindow: { start: '2026-01-01', end: '2026-07-31' },
        curWindow: YTD_WINDOW
    });
    const score = (res, name) => res.teams.find((x) => x.name === name).curAvgRating;

    t.check('without dates the two teams are level', Math.abs(score(plain, 'Alpha') - score(plain, 'Beta')) < 1e-9);
    t.check('with them the June hires count against Beta', score(seated, 'Beta') < score(seated, 'Alpha'));
});
