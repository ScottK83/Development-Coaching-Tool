'use strict';

const { suite } = require('./harness');

/**
 * A DAY-SCOPED SHOUT-OUT
 *
 * A day file is canonical for its own day and for nothing else, which is why
 * it is not allowed to stand in for the week. Ranking the day it does cover is
 * a different question, and the answer is yes: it is the freshest evidence
 * there is, and it had no way of being picked.
 *
 * What a day cannot carry is the survey scores. They land days after the calls
 * and arrive a handful at a time, so one day's file has three responses in it
 * where it has three hundred calls, and first place goes to whoever got the
 * one good survey back. The daily check-in leaves them out for the same
 * reason.
 */

const DAY_KEY = '2026-09-08|2026-09-08';

function rankingsFor(periodKey) {
    return {
        periodKey: periodKey,
        totalEmployees: 126,
        teamMembers: new Set(['Oceane Ingram']),
        rankings: [
            {
                name: 'Oceane Ingram',
                rank: 1,
                // Top of the floor on a day metric and on a survey metric at once.
                metricRanks: { adherence: 1, fcr: 1 },
                values: { adherence: 99.1, fcr: 100 }
            }
        ]
    };
}

function load(t, dailyData) {
    t.installFakeBrowser();
    global.dailyData = dailyData || {};
    global.window.DevCoachModules.centerRanking = {
        buildCenterRankings: () => rankingsFor(DAY_KEY),
        buildRankingsForPeriod: (key) => rankingsFor(key)
    };
    return t.loadModule('modules/celebrations.module.js').celebrations;
}

function metricsCelebrated(result) {
    return result.celebrations.flatMap((c) => (c.achievements || []).map((a) => a.key));
}

suite('day shout-out: a day can be celebrated on what a day measures', (t) => {
    const celebrations = load(t, {
        [DAY_KEY]: { metadata: { periodType: 'daily', endDate: '2026-09-08' }, employees: [] }
    });
    const result = celebrations.detectCelebrations(DAY_KEY);
    const metrics = metricsCelebrated(result);

    t.check('the day still produces a shout-out', result.celebrations.length > 0);
    t.check('adherence is fair game on a single day', metrics.indexOf('adherence') > -1);
    t.check('first call resolution is not', metrics.indexOf('fcr') === -1);
});

suite('day shout-out: a week is unaffected', (t) => {
    const celebrations = load(t, {});
    const week = celebrations.detectCelebrations('2026-08-31|2026-09-06');
    const metrics = metricsCelebrated(week);

    t.check('a week still celebrates adherence', metrics.indexOf('adherence') > -1);
    t.check('and still celebrates the survey metrics', metrics.indexOf('fcr') > -1);
});
