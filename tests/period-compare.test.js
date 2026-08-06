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

function loadPure(t, weekly) {
    t.installFakeBrowser();
    global.weeklyData = weekly;
    t.loadModule('modules/period-compare.module.js');
    return global.window.DevCoachModules.periodCompare;
}

function loadWithRanking(t, weekly) {
    t.installFakeBrowser();
    global.weeklyData = weekly;
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/metrics.module.js');
    t.loadModule('modules/on-off-tracker.module.js');
    t.loadModule('modules/center-ranking.module.js');
    t.loadModule('modules/period-compare.module.js');
    // on-off-tracker reaches for the global that script.js defines as a thin
    // bridge onto the metrics module. Same bridge here, so the test scores
    // through the real rating bands rather than a stub.
    global.window.getMetricRatingScore = global.window.DevCoachModules.metrics.getMetricRatingScore;
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

suite('period compare: reliability is hours accrued, not the running total', (t) => {
    const weekly = Object.assign({},
        week('2026-06-01', '2026-06-07', [emp('A', { reliability: 3 })]),
        week('2026-06-08', '2026-06-14', [emp('A', { reliability: 5 })]),
        week('2026-07-06', '2026-07-12', [emp('A', { reliability: 8 })]),
        week('2026-07-13', '2026-07-19', [emp('A', { reliability: 9 })])
    );
    const pc = loadPure(t, weekly);

    const june = pc.buildMonthAggregate('2026-06', 2026).employees[0];
    const july = pc.buildMonthAggregate('2026-07', 2026).employees[0];

    t.check('June accrues 5 hours', june.reliabilityAccrued === 5);
    t.check('July accrues 4, not the cumulative 9', july.reliabilityAccrued === 4);
    t.check('the cumulative figure is still available', july.reliabilityCumulative === 9);

    // The target is an annual budget, so a month's raw hours scored against it
    // passes everybody. Scoring sees the annualised rate instead.
    t.check('the scored value is the annualised run rate', july.reliability === 48);
    t.check('and June likewise', june.reliability === 60);
});

suite('period compare: a cumulative figure that drops never goes negative', (t) => {
    const weekly = Object.assign({},
        week('2026-06-01', '2026-06-07', [emp('A', { reliability: 10 })]),
        week('2026-06-08', '2026-06-14', [emp('A', { reliability: 10 })]),
        // Restated downward upstream.
        week('2026-07-06', '2026-07-12', [emp('A', { reliability: 6 })]),
        week('2026-07-13', '2026-07-19', [emp('A', { reliability: 6 })])
    );
    const pc = loadPure(t, weekly);
    const july = pc.buildMonthAggregate('2026-07', 2026).employees[0];

    t.check('negative accrual clamps to 0 rather than reading as credit', july.reliability === 0);
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
