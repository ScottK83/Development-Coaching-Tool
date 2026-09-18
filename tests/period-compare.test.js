'use strict';

const { suite } = require('./harness');

/**
 * Month-over-month rank movement.
 *
 * Three ways this feature can look right and be wrong, so each gets a test:
 *
 *  - Simple-averaging a rate across weeks. A quiet week and a busy week do not
 *    count equally, and averaging them says they do.
 *  - Carrying cumulative reliability into a monthly rank. Reliability is
 *    year-to-date hours, so August always looks worse than June no matter how
 *    anyone behaved.
 *  - Ranking two different populations against each other. If ten reps had no
 *    data last month, everyone's rank moves for reasons that are not
 *    performance, and every one of those moves looks like a real result.
 */

function loadPure(t, weekly, ytd) {
    t.installFakeBrowser();
    global.weeklyData = weekly;
    // Reset explicitly. These globals outlive installFakeBrowser, so a suite that
    // sets ytdData leaks it into every suite after it.
    global.ytdData = ytd || {};
    t.loadModule('modules/period-compare.module.js');
    return global.window.DevCoachModules.periodCompare;
}

function loadWithRanking(t, weekly, ytd) {
    t.installFakeBrowser();
    global.weeklyData = weekly;
    global.ytdData = ytd || {};
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/on-off-tracker.module.js');
    t.loadModule('modules/center-ranking.module.js');
    t.loadModule('modules/period-compare.module.js');
    // on-off-tracker reaches for the global that script.js:228 defines as a thin
    // bridge onto metric-profiles. Same bridge here, so the test scores through
    // the real rating bands rather than a stub.
    global.window.getMetricRatingScore = global.window.DevCoachModules.metricProfiles.getRatingScore;
    return global.window.DevCoachModules.periodCompare;
}

function week(start, end, employees) {
    return {
        [`${start}|${end}`]: {
            employees,
            metadata: { startDate: start, endDate: end, periodType: 'week' }
        }
    };
}

function emp(name, over) {
    return Object.assign({
        name,
        totalCalls: 100,
        surveyTotal: 10,
        reliability: 0,
        scheduleAdherence: 95,
        cxRepOverall: 90,
        overallSentiment: 92,
        aht: 500
    }, over || {});
}

/* ── Bucketing ── */

suite('period compare: what counts as a month', (t) => {
    const weekly = Object.assign({},
        week('2026-06-01', '2026-06-07', [emp('A')]),
        week('2026-06-08', '2026-06-14', [emp('A')]),
        week('2026-07-06', '2026-07-12', [emp('A')])
    );
    const pc = loadPure(t, weekly);
    const buckets = pc.getMonthBuckets(2026);

    t.check('weeks bucket by the month they end in', buckets.monthsMap['2026-06'].length === 2);
    t.check('June has enough weeks to be a month', buckets.usable.includes('2026-06'));
    t.check('a month standing on one week is not usable', !buckets.usable.includes('2026-07'));
});

suite('period compare: a real monthly upload beats the weekly rebuild', (t) => {
    const weekly = Object.assign({},
        week('2026-06-01', '2026-06-07', [emp('A')]),
        week('2026-06-08', '2026-06-14', [emp('A')]),
        {
            '2026-06-01|2026-06-30': {
                employees: [emp('A', { scheduleAdherence: 88 })],
                metadata: { startDate: '2026-06-01', endDate: '2026-06-30', periodType: 'month' }
            }
        }
    );
    const pc = loadPure(t, weekly);
    const buckets = pc.getMonthBuckets(2026);

    t.check('the upload replaces the reconstruction', buckets.monthsMap['2026-06'].length === 1);
    t.check('and is flagged as coming from an upload', buckets.fromUpload['2026-06'] === true);

    const agg = pc.buildMonthAggregate('2026-06', 2026);
    t.check('the uploaded number is what gets used', agg.employees[0].scheduleAdherence === 88);
    t.check('a single uploaded month is still usable', buckets.usable.includes('2026-06'));
});

/* ── Weighting ── */

suite('period compare: rates are weighted by volume, never simple-averaged', (t) => {
    const weekly = Object.assign({},
        week('2026-06-01', '2026-06-07', [emp('A', { scheduleAdherence: 90, totalCalls: 100 })]),
        week('2026-06-08', '2026-06-14', [emp('A', { scheduleAdherence: 100, totalCalls: 300 })])
    );
    const pc = loadPure(t, weekly);
    const agg = pc.buildMonthAggregate('2026-06', 2026);
    const a = agg.employees[0];

    t.check('adherence is call-weighted (97.5, not the 95 a flat average gives)', Math.abs(a.scheduleAdherence - 97.5) < 1e-9);
    t.check('calls total across the month', a.totalCalls === 400);
});

suite('period compare: survey metrics weight by survey count', (t) => {
    const weekly = Object.assign({},
        week('2026-06-01', '2026-06-07', [emp('A', { cxRepOverall: 80, surveyTotal: 1 })]),
        week('2026-06-08', '2026-06-14', [emp('A', { cxRepOverall: 100, surveyTotal: 9 })])
    );
    const pc = loadPure(t, weekly);
    const a = pc.buildMonthAggregate('2026-06', 2026).employees[0];

    t.check('one bad survey cannot outweigh nine good ones (98, not 90)', Math.abs(a.cxRepOverall - 98) < 1e-9);
    t.check('surveys total across the month', a.surveyTotal === 10);
});

/* ── Reliability ── */

suite('period compare: weekly reliability hours add up, they are not a running total', (t) => {
    // A real sequence looks like 0, 0, 8.5, 0 — one bad week among zeroes. Taking
    // the highest value seen keeps the worst week and discards every other absence.
    const weekly = Object.assign({},
        week('2026-06-01', '2026-06-07', [emp('A', { reliability: 3 })]),
        week('2026-06-08', '2026-06-14', [emp('A', { reliability: 5 })]),
        week('2026-07-06', '2026-07-12', [emp('A', { reliability: 0 })]),
        week('2026-07-13', '2026-07-19', [emp('A', { reliability: 8.5 })])
    );
    const pc = loadPure(t, weekly);

    const june = pc.buildMonthAggregate('2026-06', 2026).employees[0];
    const july = pc.buildMonthAggregate('2026-07', 2026).employees[0];

    t.check('June sums its weeks to 8, not the worst week of 5', june.reliabilityAccrued === 8);
    t.check('July sums to 8.5 across a zero week and a bad one', july.reliabilityAccrued === 8.5);
});

suite('period compare: reliability is scored on the period, not on the year', (t) => {
    const weekly = Object.assign({},
        week('2026-07-06', '2026-07-12', [emp('A', { reliability: 2 }), emp('B', { reliability: 0 })]),
        week('2026-07-13', '2026-07-19', [emp('A', { reliability: 1 }), emp('B', { reliability: 0 })])
    );
    // The authoritative running total: A has spent 30 hours this year, B has spent 1.
    const ytd = {
        '2026-01-01|2026-07-31': {
            employees: [emp('A', { reliability: 30 }), emp('B', { reliability: 1 })],
            metadata: { startDate: '2026-01-01', endDate: '2026-07-31', periodType: 'ytd' }
        }
    };

    t.installFakeBrowser();
    global.weeklyData = weekly;
    global.ytdData = ytd;
    t.loadModule('modules/period-compare.module.js');
    const pc = global.window.DevCoachModules.periodCompare;

    const july = pc.buildMonthAggregate('2026-07', 2026);
    const a = july.employees.find((e) => e.name === 'A');
    const b = july.employees.find((e) => e.name === 'B');

    // Operator's call, 2026-09-08: a period view has to describe its period.
    // This used to score the running year-to-date total in every window, so a
    // week or month showed the year -- somebody who missed nothing in July was
    // scored on hours missed in March, and a clean period could rank behind a
    // worse one because kpisMet is the first sort key.
    t.check('the scored value is the month, not the year to date', a.reliability === 3);
    t.check('and it is the sum of the weeks in that month', a.reliabilityAccrued === 3);
    t.check('someone who missed nothing in the month scores nothing missed', b.reliability === 0);

    // The running total is still computed and still on the row, so the surfaces
    // that genuinely want the year -- the year-end mirror, coaching copy -- can
    // read it without this deciding for them.
    t.check('the year to date is still carried alongside', a.reliabilityCumulative === 30);
    t.check('for everyone', b.reliabilityCumulative === 1);

    // The trade this makes, asserted so it is a decision and not a surprise:
    // against an 18-hour annual budget a single month rarely breaches, so
    // reliability separates people less on a month than on a year.
    const profiles = global.window.DevCoachModules.metricProfiles;
    if (profiles) {
        t.equal('a 3-hour month scores a 3 against the annual budget',
            profiles.getRatingScore('reliability', 3, 2026), 3);
        t.equal('while the same year to date scores a 1',
            profiles.getRatingScore('reliability', 30, 2026), 1);
    }
});

suite('period compare: a month stands on its own with no year-to-date upload', (t) => {
    const weekly = Object.assign({},
        week('2026-07-06', '2026-07-12', [emp('A', { reliability: 2 })]),
        week('2026-07-13', '2026-07-19', [emp('A', { reliability: 1 })])
    );
    const pc = loadPure(t, weekly);
    const a = pc.buildMonthAggregate('2026-07', 2026).employees[0];

    // Scoring the period means a missing year-to-date file no longer leaves the
    // month unmeasured. The month's own hours are a real reading either way.
    t.check('the month is scored on its own hours', a.reliability === 3);
    t.check('which is the sum of its weeks', a.reliabilityAccrued === 3);
    t.check('and the year to date is simply absent', a.reliabilityCumulative === null);
});

/* ── Movement ── */

suite('period compare: rank movement only counts people in both months', (t) => {
    const june = [
        emp('Steady', { scheduleAdherence: 95 }),
        emp('Riser', { scheduleAdherence: 80 }),
        emp('Faller', { scheduleAdherence: 99 }),
        emp('Gone', { scheduleAdherence: 97 }),
        emp('Also', { scheduleAdherence: 93 }),
        emp('Extra', { scheduleAdherence: 91 })
    ];
    const july = [
        emp('Steady', { scheduleAdherence: 95 }),
        emp('Riser', { scheduleAdherence: 99 }),
        emp('Faller', { scheduleAdherence: 80 }),
        emp('NewHire', { scheduleAdherence: 96 }),
        emp('Also', { scheduleAdherence: 93 }),
        emp('Extra', { scheduleAdherence: 91 })
    ];

    const pc = loadWithRanking(t, {});
    const result = pc.compareRankings(june, july, 2026, { minShared: 3 });

    t.check('a comparison is produced', !!result);
    if (!result) return;

    t.check('only the shared five are ranked', result.total === 5);
    t.check('the new hire is reported, not silently folded in', result.onlyCurrent.includes('NewHire'));
    t.check('and the departed rep is reported too', result.onlyPrevious.includes('Gone'));
    t.check('nobody ranked is from outside the shared set',
        result.movements.every((m) => !['Gone', 'NewHire'].includes(m.name)));

    const riser = result.movements.find((m) => m.name === 'Riser');
    const faller = result.movements.find((m) => m.name === 'Faller');

    t.check('improving gives a positive delta', riser && riser.delta > 0);
    t.check('declining gives a negative delta', faller && faller.delta < 0);
    t.check('the riser really did move toward 1st', riser && riser.curRank < riser.prevRank);
    t.check('every movement carries both ranks',
        result.movements.every((m) => Number.isFinite(m.curRank) && Number.isFinite(m.prevRank)));
});

/* ── Upload vs weekly rebuild ── */

suite('period compare: an uploaded month wins on roster drift, loses on coverage', (t) => {
    const many = (n, prefix) => Array.from({ length: n }, (_, i) => emp(`${prefix}${i}`));
    const monthUpload = (start, end, employees) => ({
        [`${start}|${end}`]: { employees, metadata: { startDate: start, endDate: end, periodType: 'month' } }
    });

    // June: upload covers 24 where the weeks cover 25. People joined and left
    // mid-month; the published report is still the month.
    // July: upload covers 4 where the weeks cover 25 — one team filed as a month.
    const weekly = Object.assign({},
        week('2026-06-01', '2026-06-07', many(25, 'P')),
        week('2026-06-08', '2026-06-14', many(25, 'P')),
        monthUpload('2026-06-01', '2026-06-30', many(24, 'P')),
        week('2026-07-06', '2026-07-12', many(25, 'P')),
        week('2026-07-13', '2026-07-19', many(25, 'P')),
        monthUpload('2026-07-01', '2026-07-31', many(4, 'P'))
    );

    const pc = loadPure(t, weekly);
    const b = pc.getMonthBuckets(2026);

    t.check('a slightly smaller upload still owns its month', b.fromUpload['2026-06'] === true);
    t.check('a fraction-of-the-centre upload does not', !b.fromUpload['2026-07']);
    t.check('and that month falls back to its weekly uploads', b.monthsMap['2026-07'].length === 2);
    t.check('so the rebuilt month carries everyone, not just the uploaded slice',
        pc.buildMonthAggregate('2026-07', 2026).employees.length === 25);
});

/* ── Partial uploads ── */

suite('period compare: a one-team upload filed as a month cannot anchor a comparison', (t) => {
    // Real shape of the bug this guards: May and June carry the whole centre,
    // July carries one supervisor's team. Comparing June to July ranks 18 people
    // and prints ranks 1-18 beside a table ranking 122.
    const many = (n, prefix) => Array.from({ length: n }, (_, i) => emp(`${prefix}${i}`));
    const monthUpload = (start, end, employees) => ({
        [`${start}|${end}`]: { employees, metadata: { startDate: start, endDate: end, periodType: 'month' } }
    });

    const weekly = Object.assign({},
        monthUpload('2026-05-01', '2026-05-31', many(60, 'P')),
        monthUpload('2026-06-01', '2026-06-30', many(60, 'P')),
        monthUpload('2026-07-01', '2026-07-31', many(9, 'P'))
    );

    const pc = loadPure(t, weekly);
    const b = pc.getMonthBuckets(2026);

    t.check('the thin month is still a usable period in its own right', b.usable.includes('2026-07'));
    t.check('but it is marked partial', b.partial['2026-07'] === true);
    t.check('and the full months are not', !b.partial['2026-06'] && !b.partial['2026-05']);
    t.check('so only the full months are comparable', b.comparable.join(',') === '2026-05,2026-06');
});

suite('period compare: the comparison steps back to the last full pair', (t) => {
    const many = (n, prefix) => Array.from({ length: n }, (_, i) => emp(`${prefix}${i}`, { scheduleAdherence: 90 + (i % 9) }));
    const monthUpload = (start, end, employees) => ({
        [`${start}|${end}`]: { employees, metadata: { startDate: start, endDate: end, periodType: 'month' } }
    });

    const weekly = Object.assign({},
        monthUpload('2026-05-01', '2026-05-31', many(40, 'P')),
        monthUpload('2026-06-01', '2026-06-30', many(40, 'P')),
        monthUpload('2026-07-01', '2026-07-31', many(6, 'P'))
    );

    const pc = loadWithRanking(t, weekly);
    const mom = pc.buildMonthOverMonthRanks(2026);

    t.check('a comparison is still produced', !!mom);
    if (!mom) return;
    t.check('it compares May to June, stepping over July', mom.previous.key === '2026-05' && mom.current.key === '2026-06');
    t.check('and says which month it skipped, and how thin it was',
        mom.skippedPartial.length === 1 && mom.skippedPartial[0].key === '2026-07' && mom.skippedPartial[0].count === 6);
});

/* ── Real movement vs tiebreaker shuffle ── */

suite('period compare: movement carries whether the score actually changed', (t) => {
    const before = [
        emp('Improver', { scheduleAdherence: 80, cxRepOverall: 70 }),
        emp('Flat1', { scheduleAdherence: 95 }),
        emp('Flat2', { scheduleAdherence: 95 }),
        emp('Flat3', { scheduleAdherence: 95 }),
        emp('Decliner', { scheduleAdherence: 99, cxRepOverall: 99 })
    ];
    const after = [
        emp('Improver', { scheduleAdherence: 99, cxRepOverall: 99 }),
        emp('Flat1', { scheduleAdherence: 95 }),
        emp('Flat2', { scheduleAdherence: 95 }),
        emp('Flat3', { scheduleAdherence: 95 }),
        emp('Decliner', { scheduleAdherence: 80, cxRepOverall: 70 })
    ];

    const pc = loadWithRanking(t, {});
    const res = pc.compareRankings(before, after, 2026, { minShared: 3 });
    t.check('a comparison is produced', !!res);
    if (!res) return;

    const imp = res.movements.find((m) => m.name === 'Improver');
    const dec = res.movements.find((m) => m.name === 'Decliner');

    t.check('a real improvement is flagged as a score change', imp && imp.scoreChanged === true);
    t.check('and carries the before and after score', imp && imp.prevScoreSum !== null && imp.curScoreSum !== null);
    t.check('a real decline is flagged too', dec && dec.scoreChanged === true);
    t.check('the improver gained score', imp && imp.scoreSumDelta > 0);
    t.check('the decliner lost score', dec && dec.scoreSumDelta < 0);

    // Identical inputs both months: whatever the rank does, the score did not move.
    const flats = res.movements.filter((m) => m.name.startsWith('Flat'));
    t.check('people whose inputs never changed are never flagged as a score change',
        flats.length === 3 && flats.every((m) => m.scoreChanged === false));
    t.check('and their score delta is exactly zero',
        flats.every((m) => m.scoreSumDelta === 0 && m.kpisMetDelta === 0));
});

/* ── Team movement ── */

suite('period compare: teams are placed on KPI score, not average rank', (t) => {
    // Average rank is a function of who else is in the pool. Team B does nothing
    // differently between the two months; only Team A improves. Team B's average
    // RANK must therefore worsen while its KPI score holds — and placing must
    // follow the score, not the rank.
    const teamA = ['A1', 'A2', 'A3'];
    const teamB = ['B1', 'B2', 'B3'];
    const sups = {};
    teamA.forEach((n) => { sups[n] = 'Alpha'; });
    teamB.forEach((n) => { sups[n] = 'Beta'; });

    const before = [
        ...teamA.map((n) => emp(n, { scheduleAdherence: 80, cxRepOverall: 70 })),
        ...teamB.map((n) => emp(n, { scheduleAdherence: 95, cxRepOverall: 90 }))
    ];
    const after = [
        ...teamA.map((n) => emp(n, { scheduleAdherence: 99, cxRepOverall: 99 })),
        ...teamB.map((n) => emp(n, { scheduleAdherence: 95, cxRepOverall: 90 }))
    ];

    const pc = loadWithRanking(t, {});
    const res = pc.compareTeams(before, after, sups, 2026, { minShared: 3, minTeamSize: 3 });
    t.check('a team comparison is produced', !!res);
    if (!res) return;

    const alpha = res.teams.find((x) => x.name === 'Alpha');
    const beta = res.teams.find((x) => x.name === 'Beta');

    t.check('both teams are included', !!alpha && !!beta);
    t.check('the improving team gains KPI score', alpha && alpha.ratingDelta > 0);
    t.check('the untouched team holds its KPI score', beta && Math.abs(beta.ratingDelta) < 1e-9);
    t.check('and is not credited with a decline it did not have', beta && beta.curAvgRating === beta.prevAvgRating);
    t.check('the improving team ends ahead', alpha && alpha.curPlace === 1);
});

suite('period compare: teams level on score share a place', (t) => {
    const sups = { A1: 'Alpha', A2: 'Alpha', A3: 'Alpha', B1: 'Beta', B2: 'Beta', B3: 'Beta' };
    const same = () => [
        emp('A1'), emp('A2'), emp('A3'),
        emp('B1'), emp('B2'), emp('B3')
    ];

    const pc = loadWithRanking(t, {});
    const res = pc.compareTeams(same(), same(), sups, 2026, { minShared: 3, minTeamSize: 3 });
    t.check('a comparison is produced', !!res);
    if (!res) return;

    t.check('identical teams share first place', res.teams.every((x) => x.curPlace === 1));
    t.check('so neither is shown as having moved', res.teams.every((x) => x.placeDelta === 0));
    t.check('and neither gained or lost score', res.teams.every((x) => Math.abs(x.ratingDelta) < 1e-9));
});

/**
 * A table cannot show one number against two places.
 *
 * The tie test was arithmetic, 1e-9, while every surface renders the average to
 * two decimals. Two teams a thousandth apart therefore both printed 2.37 and
 * were placed first and second, which is what got reported: "how is Sarah
 * first?" is the only possible reaction to that table.
 *
 * It is also the failure the place-sharing rule was written to prevent. A gap
 * that small changes sign on its own, so the next period the same two teams
 * swap and both are credited with a move nobody made. That is the half this
 * pins hardest, because a wrong arrow is read as news.
 */

// The placing rules are what is under test, not the scorer, so the ranker is
// stubbed and each person carries the KPI score the case needs. Deriving a
// thousandth of a gap through the real rating bands is not possible in any
// case: band scores are whole numbers over a measured count, so two teams land
// either level or a long way apart, and the near-tie that actually shows up on
// a floor of 126 comes from averaging different team sizes.
function loadWithStubRanking(t, weekly) {
    t.installFakeBrowser();
    global.weeklyData = weekly || {};
    global.ytdData = {};
    t.loadModule('modules/period-compare.module.js');
    global.window.DevCoachModules.centerRanking = {
        scoreAndRankEmployees: (employees) => (employees || []).map((e, i) => ({
            name: e.name,
            ratingAverage: e.ratingAverage,
            measuredCount: e.measuredCount === undefined ? 5 : e.measuredCount,
            rank: i + 1
        }))
    };
    return global.window.DevCoachModules.periodCompare;
}

const TIE_SUPS = {
    A1: 'Alpha', A2: 'Alpha', A3: 'Alpha', A4: 'Alpha',
    B1: 'Beta', B2: 'Beta', B3: 'Beta', B4: 'Beta', B5: 'Beta',
    G1: 'Gamma', G2: 'Gamma', G3: 'Gamma'
};

// Alpha and Beta are a five-thousandth apart, which no surface can render.
// Gamma is genuinely behind. `swap` hands the invisible lead to the other team,
// which is what a gap this size does on its own between two periods.
function tieRoster(swap) {
    const alpha = swap ? 2.512 : 2.514;
    const beta = swap ? 2.514 : 2.512;
    const at = (names, rating) => names.map((name) => ({ name, ratingAverage: rating, measuredCount: 5 }));
    return [
        ...at(['A1', 'A2', 'A3', 'A4'], alpha),
        ...at(['B1', 'B2', 'B3', 'B4', 'B5'], beta),
        ...at(['G1', 'G2', 'G3'], 2.20)
    ];
}

suite('period compare: places are decided at the precision the table shows', (t) => {
    const pc = loadWithStubRanking(t);
    const res = pc.compareTeams(tieRoster(false), tieRoster(false), TIE_SUPS, 2026,
        { minShared: 3, minTeamSize: 3 });
    t.check('a comparison is produced', !!res);
    if (!res) return;

    const team = (n) => res.teams.find((x) => x.name === n);
    const shown = (n) => team(n).curAvgRating.toFixed(2);

    // The premise. If these ever print differently the fixture stopped testing
    // what it was built for and everything below would pass on nothing.
    t.equal('the two leaders print the same average', shown('Alpha'), shown('Beta'));
    t.check('but they are not actually level',
        team('Alpha').curAvgRating !== team('Beta').curAvgRating);
    t.check('and Gamma prints a different average', shown('Gamma') !== shown('Alpha'));

    t.equal('so the two leaders share a place', team('Alpha').curPlace, team('Beta').curPlace);
    t.equal('and it is first', team('Alpha').curPlace, 1);
    // Standard competition placing: two teams sharing 1st puts the next at 3rd.
    t.equal('the team genuinely behind them takes third', team('Gamma').curPlace, 3);
});

suite('period compare: an invisible lead changing hands is not movement', (t) => {
    // The same two teams, the same 2.51 on screen in both periods, and the
    // thousandth between them falling the other way. Nobody moved.
    const pc = loadWithStubRanking(t);
    const res = pc.compareTeams(tieRoster(false), tieRoster(true), TIE_SUPS, 2026,
        { minShared: 3, minTeamSize: 3 });
    t.check('a comparison is produced', !!res);
    if (!res) return;

    const team = (n) => res.teams.find((x) => x.name === n);
    t.equal('the leaders still print the same average',
        team('Alpha').curAvgRating.toFixed(2), team('Beta').curAvgRating.toFixed(2));

    t.equal('neither leader is credited with a move', team('Alpha').placeDelta, 0);
    t.equal('nor the other one', team('Beta').placeDelta, 0);
    t.equal('and the team that did nothing is not shuffled either', team('Gamma').placeDelta, 0);
});

/**
 * The panel has to describe the period the rest of the page is showing.
 *
 * It always compared the newest two, so picking June showed July against
 * August, and the movement block sat under a June table describing months that
 * were not on screen. The individual view took an anchorKey for exactly this
 * reason and the team view never did.
 */

// Three weeks over the same twelve people. Alpha climbs unevenly so the pair
// that was compared can be read straight off the numbers; Beta holds still.
function anchorWeeks() {
    const at = (names, rating) => names.map((name) => ({ name, ratingAverage: rating, measuredCount: 5 }));
    const roster = (alphaRating) => [
        ...at(['A1', 'A2', 'A3'], alphaRating),
        ...at(['B1', 'B2', 'B3'], 2.0)
    ];
    const week = (end, alphaRating) => [
        '2026-06-01|' + end,
        { metadata: { periodType: 'week', endDate: end, label: 'Week ending ' + end }, employees: roster(alphaRating) }
    ];
    return Object.fromEntries([
        week('2026-06-07', 2.0),
        week('2026-06-14', 2.2),
        week('2026-06-21', 3.0)
    ]);
}

const ANCHOR_SUPS = { A1: 'Alpha', A2: 'Alpha', A3: 'Alpha', B1: 'Beta', B2: 'Beta', B3: 'Beta' };

suite('period compare: team movement measures to the period that was picked', (t) => {
    const pc = loadWithStubRanking(t, anchorWeeks());

    const newest = pc.buildTeamMovementForScope('week', ANCHOR_SUPS, 2026);
    t.check('an unanchored call still answers about the newest pair', !!newest);
    if (!newest) return;
    t.equal('ending at the newest week', newest.current.key, '2026-06-01|2026-06-21');
    t.equal('against the one before it', newest.previous.key, '2026-06-01|2026-06-14');
    t.equal('and Alpha is shown where it now stands',
        newest.teams.find((x) => x.name === 'Alpha').curAvgRating, 3.0);

    const anchored = pc.buildTeamMovementForScope('week', ANCHOR_SUPS, 2026,
        { anchorKey: '2026-06-01|2026-06-14' });
    t.check('anchoring produces a comparison', !!anchored);
    if (!anchored) return;
    t.equal('measured to the week that was picked', anchored.current.key, '2026-06-01|2026-06-14');
    t.equal('from the week before that one', anchored.previous.key, '2026-06-01|2026-06-07');

    // The substance, not just the labels: a different pair means different
    // numbers, and 3.0 appearing here would mean the anchor moved the caption
    // and nothing else.
    const alpha = anchored.teams.find((x) => x.name === 'Alpha');
    t.equal('and the numbers are the ones from that week', alpha.curAvgRating, 2.2);
    t.check('with the move it actually made', Math.abs(alpha.ratingDelta - 0.2) < 1e-9);
});

/**
 * The matchup page names a month "month:2026-07"; this module names it
 * "2026-07". They were compared as they came, so picking a month never
 * matched, and Team Movement showed August against an unfinished September
 * whichever month was picked.
 */
function anchorMonths() {
    // Carried as AHT, because a month is rolled up from its rows and the
    // roll-up keeps metrics, not a rating. The stub below reads it back.
    const at = (names, rating) => names.map((name) => ({ name, aht: rating * 100, totalCalls: 100, measuredCount: 5 }));
    const month = (start, end, alphaRating) => [
        start + '|' + end,
        { metadata: { startDate: start, endDate: end, periodType: 'month' },
          employees: [...at(['A1', 'A2', 'A3'], alphaRating), ...at(['B1', 'B2', 'B3'], 2.0)] }
    ];
    // The suite clock sits in August, so August is the month still running.
    return Object.fromEntries([
        month('2026-05-01', '2026-05-31', 2.0),
        month('2026-06-01', '2026-06-30', 2.2),
        month('2026-07-01', '2026-07-31', 2.5),
        month('2026-08-01', '2026-08-17', 3.0)
    ]);
}

suite('period compare: team movement follows a month picked on the matchup page', (t) => {
    const pc = loadWithStubRanking(t, anchorMonths());
    global.window.DevCoachModules.centerRanking.scoreAndRankEmployees = (employees) =>
        (employees || []).map((e, i) => ({ name: e.name, ratingAverage: Number(e.aht) / 100, measuredCount: 5, rank: i + 1 }));

    const june = pc.buildTeamMovementForScope('month', ANCHOR_SUPS, 2026, { anchorKey: 'month:2026-06' });
    t.check('a comparison is produced', !!june);
    if (!june) return;
    t.equal('measured to the month that was picked', june.current.key, '2026-06');
    t.equal('from the month before it', june.previous.key, '2026-05');
    t.equal('with that month\'s numbers', june.teams.find((x) => x.name === 'Alpha').curAvgRating, 2.2);

    const july = pc.buildTeamMovementForScope('month', ANCHOR_SUPS, 2026, { anchorKey: 'month:2026-07' });
    t.equal('picking July measures to July', july && july.current.key, '2026-07');

    // A pick that names nothing in the list must still step over the month
    // that is not over, rather than comparing against it.
    const stray = pc.buildTeamMovementForScope('month', ANCHOR_SUPS, 2026, { anchorKey: 'no-such-period' });
    t.equal('an unmatched pick does not land on the unfinished month', stray && stray.current.key, '2026-07');

    // The months Scott actually has are uploaded files, picked by store key.
    // Reported as "Scott is still 2.06 in every month" after the first fix,
    // which only read the rebuilt-month spelling.
    const uploaded = pc.buildTeamMovementForScope('month', ANCHOR_SUPS, 2026, { anchorKey: '2026-06-01|2026-06-30' });
    t.equal('an uploaded month picked by its store key is followed', uploaded && uploaded.current.key, '2026-06');
    t.equal('with its own numbers', uploaded && uploaded.teams.find((x) => x.name === 'Alpha').curAvgRating, 2.2);

    const people = pc.buildMovementForScope('month', { year: 2026, anchorKey: 'month:2026-06' });
    t.equal('the individual view reads the same spelling', people && people.current && people.current.key, '2026-06');
});

suite('period compare: anchoring to the oldest period falls back rather than half-answering', (t) => {
    // Nothing sits behind the oldest week, so there is no pair to build. The
    // newest one is a real answer; a comparison with one side missing is not.
    const pc = loadWithStubRanking(t, anchorWeeks());
    const mv = pc.buildTeamMovementForScope('week', ANCHOR_SUPS, 2026,
        { anchorKey: '2026-06-01|2026-06-07' });

    t.check('a comparison is still produced', !!mv);
    if (!mv) return;
    t.equal('and it is the newest pair', mv.current.key, '2026-06-01|2026-06-21');
});

suite('period compare: a team too small to judge is left out', (t) => {
    const sups = {
        A1: 'Alpha', A2: 'Alpha', A3: 'Alpha',
        B1: 'Beta', B2: 'Beta', B3: 'Beta',
        C1: 'Gamma', C2: 'Gamma',
        D1: null
    };
    const roster = () => [
        emp('A1'), emp('A2'), emp('A3'),
        emp('B1'), emp('B2'), emp('B3'),
        emp('C1'), emp('C2'), emp('D1')
    ];

    const pc = loadWithRanking(t, {});
    const res = pc.compareTeams(roster(), roster(), sups, 2026, { minShared: 3, minTeamSize: 3 });
    t.check('a comparison is produced', !!res);
    if (!res) return;
    t.check('the two full-size teams are placed', res.teams.length === 2);
    t.check('the two-person team is not', !res.teams.some((x) => x.name === 'Gamma'));
    t.check('and an unassigned person pulls no team down',
        res.teams.every((x) => x.count === 3));
});

/**
 * A KPI score is scoreSum / measuredCount, so it RISES as KPIs go missing: two
 * measured at the top of the band is a perfect 3.00, better than anyone scored
 * on all five can realistically reach. Averaging those into a team places the
 * team on how little was measured.
 *
 * The Team Rankings table on the Matchup screen has gated this since September.
 * The Team Movement panel directly above it did not, so the two placed the same
 * teams over the same people and disagreed about the answer.
 */
suite('period compare: a thin scorecard cannot carry a team', (t) => {
    const sups = {
        A1: 'Alpha', A2: 'Alpha', A3: 'Alpha',
        B1: 'Beta', B2: 'Beta', B3: 'Beta', B4: 'Beta'
    };
    // Measured on two KPIs and perfect on both. Nothing else is populated, so
    // there is no fifth of a scorecard here to place anybody on.
    const thinAndPerfect = () => ({
        name: 'B4', totalCalls: 100, surveyTotal: 10,
        scheduleAdherence: 100, cxRepOverall: 100
    });
    const roster = () => [
        emp('A1'), emp('A2'), emp('A3'),
        emp('B1'), emp('B2'), emp('B3'), thinAndPerfect()
    ];

    const pc = loadWithRanking(t, {});
    const res = pc.compareTeams(roster(), roster(), sups, 2026, { minShared: 3, minTeamSize: 3 });
    t.check('a comparison is produced', !!res);
    if (!res) return;

    const alpha = res.teams.find((x) => x.name === 'Alpha');
    const beta = res.teams.find((x) => x.name === 'Beta');
    t.check('both teams are placed', !!alpha && !!beta);

    t.equal('the thin record is left out of its team', beta && beta.count, 3);
    t.equal('the full team is untouched', alpha && alpha.count, 3);
    // The whole point: two identical teams, one of which happens to have a
    // half-measured person on it, must not be separated by that person.
    t.check('so the two identical teams are level', alpha && beta &&
        Math.abs(alpha.curAvgRating - beta.curAvgRating) < 1e-9);
    t.check('and share a place', alpha && beta && alpha.curPlace === beta.curPlace);

    // The caption prints these, so they have to be the real populations.
    t.equal('the overlap is still reported whole', res.total, 7);
    t.equal('the placed population is what the averages used', res.placed, 6);
    t.equal('and the difference is accounted for', res.thin, 1);
});

suite('period compare: one team alone is not a comparison', (t) => {
    const sups = { A1: 'Alpha', A2: 'Alpha', A3: 'Alpha', B1: 'Beta' };
    const roster = () => [emp('A1'), emp('A2'), emp('A3'), emp('B1')];

    const pc = loadWithRanking(t, {});
    t.check('nothing is produced when only one team qualifies',
        pc.compareTeams(roster(), roster(), sups, 2026, { minShared: 3, minTeamSize: 3 }) === null);
});

/* ── Selector wiring ── */

suite('period compare: rebuilt months are offered as periods', (t) => {
    const weekly = Object.assign({},
        week('2026-06-01', '2026-06-07', [emp('A'), emp('B')]),
        week('2026-06-08', '2026-06-14', [emp('A'), emp('C')]),
        // One week only — not a month, must not be offered.
        week('2026-07-06', '2026-07-12', [emp('A')])
    );
    const pc = loadPure(t, weekly);
    const opts = pc.getMonthPeriodOptions(2026);

    t.check('only the month with enough weeks is offered', opts.length === 1);
    t.check('keyed with the prefix that marks it as assembled, not stored', opts[0].key === 'month:2026-06');
    t.check('counts distinct people across the month, not row totals', opts[0].count === 3);
    t.check('the label says it was rebuilt', /rebuilt from 2 weeks/.test(opts[0].label));
    t.check('sorts by the month end date', opts[0].endDate === '2026-06-30');
});

suite('period compare: a month carried by its own upload is not offered twice', (t) => {
    const weekly = Object.assign({},
        week('2026-06-01', '2026-06-07', [emp('A')]),
        week('2026-06-08', '2026-06-14', [emp('A')]),
        {
            '2026-06-01|2026-06-30': {
                employees: [emp('A')],
                metadata: { startDate: '2026-06-01', endDate: '2026-06-30', periodType: 'month' }
            }
        }
    );
    const pc = loadPure(t, weekly);

    t.check('the uploaded month is already a stored period, so no rebuild is listed',
        pc.getMonthPeriodOptions(2026).length === 0);
});

suite('period compare: rankings resolve a month: key by assembling it', (t) => {
    const weekly = Object.assign({},
        week('2026-06-01', '2026-06-07', [
            emp('A', { scheduleAdherence: 99 }), emp('B', { scheduleAdherence: 80 }), emp('C', { scheduleAdherence: 90 })
        ]),
        week('2026-06-08', '2026-06-14', [
            emp('A', { scheduleAdherence: 99 }), emp('B', { scheduleAdherence: 80 }), emp('C', { scheduleAdherence: 90 })
        ])
    );
    loadWithRanking(t, weekly);
    const cr = global.window.DevCoachModules.centerRanking;

    const built = cr.buildRankingsForPeriod('month:2026-06');
    t.check('a month key produces rankings', !!built && built.rankings.length === 3);
    if (!built) return;
    t.check('the key is echoed back unchanged', built.periodKey === 'month:2026-06');
    t.check('the source names the month and how it was built', /June 2026/.test(built.source) && /rebuilt/.test(built.source));
    t.check('an unknown month yields nothing rather than an empty table', cr.buildRankingsForPeriod('month:2026-01') === null);
});

suite('period compare: too little overlap produces nothing rather than noise', (t) => {
    const pc = loadWithRanking(t, {});
    const a = [emp('One'), emp('Two')];
    const b = [emp('One'), emp('Three')];

    t.check('a single shared person is not a comparison', pc.compareRankings(a, b, 2026) === null);
    t.check('and two months are required for the headline view', pc.buildMonthOverMonthRanks(2026) === null);
});


/* ── Each survey rate carries its own denominator ──
   Reported as: a rep whose rep sat was 100% all month showed 66.7% in the
   trajectory, which flipped that KPI from a 3 to a 1. All three survey rates
   were weighted by the Overall Experience response count, because that was the
   only count the parser ever mapped — so a week where nobody answered the
   rep-sat question was indistinguishable from a week that scored 0%. */

suite('period compare: a week nobody answered is not a zero', (t) => {
    const pc = loadPure(t, {});

    const wk = (rep, repN, oe, oeN) => ({
        employees: [{
            name: 'A', totalCalls: 100,
            cxRepOverall: rep, repSurveyTotal: repN,
            overallExperience: oe, surveyTotal: oeN
        }]
    });

    // Two weeks at 100% rep sat, one week with no rep-sat responses at all. The
    // OE survey ran in all three, which is what used to hand that third week a
    // vote it had not earned.
    const agg = pc.aggregateEmployeesFrom([wk(100, 1, 90, 1), wk(100, 1, 90, 1), wk(0, 0, 90, 1)])[0];
    t.equal('rep sat averages only the weeks that had responses', Math.round(agg.cxRepOverall), 100);
    t.equal('the rep-sat responses are counted on their own', agg.repSurveyTotal, 2);
    t.equal('and the OE count is untouched', agg.surveyTotal, 3);

    // A real zero still counts, because it arrives with a response behind it.
    const real = pc.aggregateEmployeesFrom([wk(100, 1, 90, 1), wk(100, 1, 90, 1), wk(0, 1, 90, 1)])[0];
    t.equal('a zero backed by a response still drags the average',
        Math.round(real.cxRepOverall * 10) / 10, 66.7);
});

/* Reported on Johnathan's card: September CX Adv blank, while he had 100%.
   A rate with no usable count behind it weighed 0 and dropped out, so a
   month built from weeks lost it entirely. */
suite('period compare: a real score with no count behind it is kept', (t) => {
    const pc = loadPure(t, {});
    const row = (over) => ({ employees: [Object.assign({ name: 'A', totalCalls: 100 }, over)] });

    const noOe = pc.aggregateEmployeesFrom([row({ cxRepOverall: 100, repSurveyTotal: 0, surveyTotal: 0 })])[0];
    t.equal('a 100% whose counts read 0 is not lost', noOe.cxRepOverall, 100);

    const noCounts = pc.aggregateEmployeesFrom([row({ cxRepOverall: 100 })])[0];
    t.equal('a 100% with no count columns at all is not lost', noCounts.cxRepOverall, 100);
    t.equal('and stands for one response', noCounts.repSurveyTotal, 1);

    const fromFcr = pc.aggregateEmployeesFrom([row({ cxRepOverall: 100, surveyTotal: 0, fcrSurveyTotal: 2 })])[0];
    t.equal('a count from another question is borrowed before guessing', fromFcr.repSurveyTotal, 2);
});

suite('period compare: an export without the extra counts behaves as it always did', (t) => {
    const pc = loadPure(t, {});
    // Older uploads carry only the OE survey total. Falling back to it is exactly
    // the previous behaviour, so re-reading old data cannot silently change.
    const agg = pc.aggregateEmployeesFrom([
        { employees: [{ name: 'A', totalCalls: 100, cxRepOverall: 100, overallExperience: 90, surveyTotal: 2 }] },
        { employees: [{ name: 'A', totalCalls: 100, cxRepOverall: 40, overallExperience: 80, surveyTotal: 2 }] }
    ])[0];
    t.equal('weighted by the only count there is', agg.cxRepOverall, 70);
});

/* ── Reliability is the total as of that month, not as of today ── */

const REL_WEEKS = {
    '2026-02-23|2026-03-01': {
        employees: [{ name: 'A', totalCalls: 100, aht: 400, scheduleAdherence: 95, reliability: 1 }],
        metadata: { startDate: '2026-02-23', endDate: '2026-03-01', periodType: 'week' }
    },
    '2026-03-02|2026-03-08': {
        employees: [{ name: 'A', totalCalls: 100, aht: 400, scheduleAdherence: 95, reliability: 1 }],
        metadata: { startDate: '2026-03-02', endDate: '2026-03-08', periodType: 'week' }
    }
};

suite('period compare: a historical month is not scored with hours missed later', (t) => {
    // Two year-to-date files. March's rebuild must read the March one.
    const pc = loadPure(t, REL_WEEKS, {
        '2026-01-01|2026-03-31': { employees: [{ name: 'A', reliability: 2 }],
            metadata: { startDate: '2026-01-01', endDate: '2026-03-31', periodType: 'ytd' } },
        '2026-01-01|2026-08-09': { employees: [{ name: 'A', reliability: 60.1 }],
            metadata: { startDate: '2026-01-01', endDate: '2026-08-09', periodType: 'ytd' } }
    });

    const march = pc.buildMonthAggregate('2026-03', 2026);
    t.equal('March is scored on the total as of March', march.employees[0].reliability, 2);
    t.equal('and still knows what was missed in the month itself', march.employees[0].reliabilityAccrued, 2);
});

suite('period compare: August hours are never back-applied to March', (t) => {
    // The asOfMonth cut-off still matters, because reliabilityCumulative is
    // still computed for the surfaces that read it. Absence that had not
    // happened yet must not attach to an earlier month.
    const pc = loadPure(t, REL_WEEKS, {
        '2026-01-01|2026-08-09': { employees: [{ name: 'A', reliability: 60.1 }],
            metadata: { startDate: '2026-01-01', endDate: '2026-08-09', periodType: 'ytd' } }
    });
    const march = pc.buildMonthAggregate('2026-03', 2026);
    t.equal('the running total for March is left unmeasured',
        march.employees[0].reliabilityCumulative, null);
    t.equal('and March is scored on the hours actually missed in March',
        march.employees[0].reliability, march.employees[0].reliabilityAccrued);
});

/* ── A rebuilt month says which dates it covers ── */

suite('period compare: a rebuilt month reports the span it really covers', (t) => {
    // Ends in August, starts in July. This is the whole reason an "August"
    // column can disagree with a calendar-month report held up beside it.
    const pc = loadPure(t, {
        '2026-07-27|2026-08-02': { employees: [{ name: 'A', totalCalls: 100, aht: 400, scheduleAdherence: 95 }],
            metadata: { startDate: '2026-07-27', endDate: '2026-08-02', periodType: 'week' } },
        '2026-08-03|2026-08-09': { employees: [{ name: 'A', totalCalls: 100, aht: 400, scheduleAdherence: 95 }],
            metadata: { startDate: '2026-08-03', endDate: '2026-08-09', periodType: 'week' } }
    });
    const aug = pc.buildMonthAggregate('2026-08', 2026);
    t.equal('the span starts in the month before', aug.spanStart, '2026-07-27');
    t.equal('and ends with the last completed week', aug.spanEnd, '2026-08-09');
});


/* ── Month to date beats the rebuild for its own month ── */

const MTD_WEEKS = {
    // The rebuild's August: starts 27 July, stops at the last finished week.
    '2026-07-27|2026-08-02': {
        employees: [{ name: 'A', totalCalls: 100, aht: 900, scheduleAdherence: 80, overallSentiment: 80 }],
        metadata: { startDate: '2026-07-27', endDate: '2026-08-02', periodType: 'week' }
    },
    '2026-08-03|2026-08-09': {
        employees: [{ name: 'A', totalCalls: 100, aht: 900, scheduleAdherence: 80, overallSentiment: 80 }],
        metadata: { startDate: '2026-08-03', endDate: '2026-08-09', periodType: 'week' }
    }
};

function mtdRow(endDate, aht) {
    return {
        [`2026-08-01|${endDate}`]: {
            employees: [{ name: 'A', totalCalls: 100, aht: aht, scheduleAdherence: 95, overallSentiment: 95 }],
            metadata: { startDate: '2026-08-01', endDate: endDate, periodType: 'month-to-date' }
        }
    };
}

suite('period compare: a month-to-date upload replaces the weekly rebuild', (t) => {
    // Month-bound fixtures: a month-to-date row only ever takes over the
    // CURRENT month, so this suite has to agree with the calendar about which
    // month that is. Declared rather than inherited, so it stays true under
    // TEST_CLOCK.
    t.pinClock('2026-08-18');
    const pc = loadPure(t, Object.assign({}, MTD_WEEKS, mtdRow('2026-08-17', 400)));
    const buckets = pc.getMonthBuckets(2026);

    // The rebuild would have started on 27 July. The whole point of the upload
    // is that it does not.
    t.check('August comes from the upload', buckets.fromUpload['2026-08'] === true);
    t.equal('and only from it', buckets.monthsMap['2026-08'].length, 1);
    t.equal('the one row is the month-to-date one', buckets.monthsMap['2026-08'][0], '2026-08-01|2026-08-17');

    const agg = pc.buildMonthAggregate('2026-08', 2026);
    t.equal('so the numbers are the real month, not the stitched weeks', agg.employees[0].aht, 400);
    t.equal('and the span starts on the first', agg.spanStart, '2026-08-01');
    t.equal('not in the month before', agg.spanEnd, '2026-08-17');
});

suite('period compare: a completed month is left to its own rules', (t) => {
    // Month-bound fixtures: a month-to-date row only ever takes over the
    // CURRENT month, so this suite has to agree with the calendar about which
    // month that is. Declared rather than inherited, so it stays true under
    // TEST_CLOCK.
    t.pinClock('2026-08-18');
    // Only the current month can be carried by a month-to-date row. A stale one
    // for a finished month must not out-rank four real weeks.
    const pc = loadPure(t, Object.assign({}, MTD_WEEKS, {
        '2026-07-01|2026-07-14': {
            employees: [{ name: 'A', totalCalls: 100, aht: 400, scheduleAdherence: 95 }],
            metadata: { startDate: '2026-07-01', endDate: '2026-07-14', periodType: 'month-to-date' }
        }
    }));
    const buckets = pc.getMonthBuckets(2026);
    t.check('July is not taken over by a stale month-to-date row', !buckets.fromUpload['2026-07']);
});

suite('period compare: one day into the month still beats a rebuild made of last month', (t) => {
    // Month-bound fixtures: a month-to-date row only ever takes over the
    // CURRENT month, so this suite has to agree with the calendar about which
    // month that is. Declared rather than inherited, so it stays true under
    // TEST_CLOCK.
    t.pinClock('2026-08-18');
    // No fortnight floor here, unlike a real monthly upload: on the second of
    // the month the rebuild's "August" is almost entirely July.
    const pc = loadPure(t, Object.assign({}, MTD_WEEKS, mtdRow('2026-08-01', 350)));
    const buckets = pc.getMonthBuckets(2026);
    t.check('the short month-to-date row still wins', buckets.fromUpload['2026-08'] === true);
    t.equal('and it is what gets aggregated', pc.buildMonthAggregate('2026-08', 2026).employees[0].aht, 350);
});
