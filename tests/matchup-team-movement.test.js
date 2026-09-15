'use strict';

const { suite } = require('./harness');

/**
 * The Team Movement panel, and what it says when it cannot honour the period
 * that is selected above it.
 *
 * A year-to-date file is cumulative and there is normally one of them, so
 * "YTD against the previous YTD" has nothing on the other side. The panel falls
 * back to the last two full months, which is the useful answer. What it must
 * not do is present those months as though they were the selection: a block
 * headed "July 2026 -> August 2026" sitting under a YTD selection reads as a
 * period selector that does nothing at all, which is how it was reported.
 *
 * So what is pinned here is that the panel follows the selection when it can,
 * that the fallback is named in the heading rather than only in the small print
 * below it, and that the notice says the rest of the page did follow the pick.
 */

function names(n) {
    return Array.from({ length: n }, (_, i) => ({ name: 'Person ' + i }));
}

const YTD_ONE = {
    'ytd|2026-09-13': {
        metadata: { periodType: 'ytd', endDate: '2026-09-13', label: 'YTD through 2026-09-13' },
        employees: names(126)
    }
};

const WEEKS = {};
for (let i = 1; i <= 4; i += 1) {
    const d = '2026-09-' + String(i * 7).padStart(2, '0');
    WEEKS['2026-09-01|' + d] = {
        metadata: { periodType: 'week', endDate: d, label: 'Week ending ' + d },
        employees: names(120)
    };
}

// What period-compare hands back for a scope it can answer. The panel does no
// arithmetic of its own, so a stub is the whole input.
function movement(previousLabel, currentLabel) {
    return {
        current: { key: 'cur', label: currentLabel },
        previous: { key: 'prev', label: previousLabel },
        total: 126,
        teamCount: 2,
        teams: [
            { name: 'Sarah Gregory', curPlace: 1, placeDelta: 0, curAvgRating: 2.37, ratingDelta: -0.12, count: 17 },
            { name: 'Scott', curPlace: 2, placeDelta: -1, curAvgRating: 2.06, ratingDelta: -0.14, count: 18 }
        ]
    };
}

/**
 * @param answers scope -> movement, or null for a scope with nothing to compare.
 */
function load(t, answers) {
    t.installFakeBrowser();
    global.weeklyData = WEEKS;
    global.ytdData = YTD_ONE;

    const asked = [];
    global.window.DevCoachModules.periodIndex = { periodLabel: (key) => 'Period ' + key };
    global.window.DevCoachModules.periodCompare = {
        getMonthPeriodOptions: () => [],
        buildMonthOverMonthTeams: () => null,
        buildTeamMovementForScope: (scope) => {
            asked.push(scope);
            return answers[scope] || null;
        }
    };
    const matchup = t.loadModule('modules/matchup.module.js').matchup;
    return { matchup, asked };
}

suite('matchup movement: one YTD file cannot be compared, and the panel says which period it used', (t) => {
    const { matchup, asked } = load(t, { month: movement('July 2026', 'August 2026') });
    matchup.setSelectedPeriodForTest('ytd|2026-09-13', 'ytd');
    const html = matchup.renderTeamMovement({ myLabel: 'Scott' });

    t.equal('the selected scope is asked for first', asked[0], 'ytd');
    t.equal('and months are the fallback it asks for next', asked[1], 'month');

    t.check('the months it settled on are named', html.includes('July 2026 &rarr; August 2026'));
    // The heading is the part somebody reads before deciding the selector is
    // broken, so the fallback has to be visible there and not only below.
    t.check('the heading says these are months, not the pick', html.includes('(months, not YTD)'));

    t.check('the reason is given', html.includes('there is only one year-to-date file on record'));
    t.check('and it names what was selected', html.includes('YTD is selected above'));
    // The actual complaint: the period selector looked inert.
    t.check('and says the rest of the page did follow the pick',
        html.includes('Everything else on this page is built from the period you picked'));
});

suite('matchup movement: a scope it can answer gets no fallback notice', (t) => {
    const { matchup, asked } = load(t, { week: movement('Week ending 2026-09-07', 'Week ending 2026-09-14') });
    matchup.setSelectedPeriodForTest('2026-09-01|2026-09-07', 'weekly');
    const html = matchup.renderTeamMovement({ myLabel: 'Scott' });

    t.equal('only the selected scope is asked for', asked.length, 1);
    t.equal('and it is the weekly one', asked[0], 'week');

    t.check('the weeks it compared are named',
        html.includes('Week ending 2026-09-07 &rarr; Week ending 2026-09-14'));
    t.check('nothing claims it fell back', !html.includes('(months, not'));
    t.check('and there is no notice to explain', !html.includes('is selected above'));
});

suite('matchup movement: nothing to compare at all renders nothing', (t) => {
    // Neither the selection nor the fallback can be answered. An empty panel is
    // right here; a heading over an empty table is not.
    const { matchup } = load(t, {});
    matchup.setSelectedPeriodForTest('ytd|2026-09-13', 'ytd');
    t.equal('the panel is left out', matchup.renderTeamMovement({ myLabel: 'Scott' }), '');
});
