'use strict';

const { suite } = require('./harness');

/**
 * RANKINGS FOR A SINGLE DAY
 *
 * The period dropdown had a Daily group and a slot for it in the type order,
 * and nothing ever went into either, because the list was built from the
 * weekly and year-to-date stores only. Day files live in their own store, so
 * "where did everyone place yesterday" had no way to be asked.
 *
 * Two other places said no to a day key as well. Ranking a named period looked
 * in the same two stores, so a day key resolved to nothing and fell through to
 * the automatic pick, which is why picking yesterday looked like picking last
 * week. And the stale-key guard dropped anything it could not find in those
 * two stores, so a day selection was thrown away on the render right after it
 * was made, and the chip read as dead.
 */

function team(n) {
    const out = [];
    for (let i = 0; i < n; i++) {
        out.push({
            name: 'Person' + i,
            firstName: 'P' + i,
            scheduleAdherence: 90 + (i % 9),
            cxRepOverall: 80,
            fcr: 70,
            overallExperience: 75,
            transfers: 4,
            aht: 400,
            totalCalls: 40,
            reliability: 5
        });
    }
    return out;
}

function load(t) {
    t.installFakeBrowser();
    global.weeklyData = {
        '2026-08-31|2026-09-06': { metadata: { periodType: 'week', endDate: '2026-09-06' }, employees: team(126) }
    };
    global.ytdData = {
        '2026-01-01|2026-09-06': { metadata: { periodType: 'ytd', endDate: '2026-09-06' }, employees: team(127) }
    };
    global.dailyData = {
        '2026-09-08|2026-09-08': { metadata: { periodType: 'daily', endDate: '2026-09-08', label: 'Daily: Sep 8, 2026' }, employees: team(120) }
    };
    global.window.getTeamMembersForWeek = () => ['Person1', 'Person2'];
    global.window.getLatestWeeklyKey = () => '2026-08-31|2026-09-06';

    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/on-off-tracker.module.js');
    t.loadModule('modules/period-index.module.js');
    const M = t.loadModule('modules/center-ranking.module.js');

    // The same two bridges the running app puts in place: script.js hands the
    // rating score to metric-profiles, and metric-trends owns the display
    // formatter.
    global.window.getMetricRatingScore = M.metricProfiles.getRatingScore;
    global.window.formatMetricDisplay = (key, value) => String(value);
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;

    M.centerRanking.resetPeriodSelection();
    return M.centerRanking;
}

suite('rankings: yesterday is a period you can pick', (t) => {
    const ranking = load(t);

    const data = ranking.buildRankingsForPeriod('2026-09-08|2026-09-08');
    t.check('a day key resolves to real rankings', Boolean(data) && data.rankings.length > 0);
    t.equal('and it is the day that was asked for', data.periodKey, '2026-09-08|2026-09-08');
    t.equal('over everybody in the day file', data.rankings.length, 120);

    // The week is untouched by any of this.
    const week = ranking.buildRankingsForPeriod('2026-08-31|2026-09-06');
    t.equal('a week still resolves to its own week', week.periodKey, '2026-08-31|2026-09-06');
    t.equal('over its own roster', week.rankings.length, 126);

    // A key in no store at all is still nothing, so the fallback to the
    // automatic pick keeps working.
    t.equal('a key from no store resolves to nothing',
        ranking.buildRankingsForPeriod('2026-01-01|2026-01-01'), null);
});
