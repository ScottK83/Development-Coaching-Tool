'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * ONE PAGE FOR THE TEAM, NOT FOUR
 *
 * Celebrations, Weekly Pulse and Cheerleader were three tabs under one link,
 * and Highlights was a fourth. Each had its own period control, and each wrote
 * messages the My Team day page could already write, off a different stretch
 * of time from the one the day page was showing. Scott's words: they "all do
 * the exact same thing".
 *
 * They are one page now. What each of them had that nothing else did moved
 * onto it and reads the Covering window:
 *
 *   Celebrations   the placing message and the one-person shout-out became
 *                  tones; History and the ranking bar went into the shout-out
 *                  card, and the log is written from the post.
 *   Weekly Pulse   the status cards and the day-file table are the evidence
 *                  under the message; Check-in and the monthly review became
 *                  tones. The monthly review needs a finished month, so a
 *                  Last month window was added for it.
 *   Cheerleader    became the Cheer tone, and compares the window's two weeks.
 *   Highlights     became the "Beat a target" style of the shout-out.
 */

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

// --- Last month ---------------------------------------------------------

const TODAY = '2026-09-22';

function team(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ name: 'Person' + i, totalCalls: 100, aht: 320 });
    return out;
}

function loadWindows(t, weekly) {
    t.pinClock(TODAY);
    t.installFakeBrowser();
    global.weeklyData = weekly;
    global.ytdData = {};
    global.dailyData = {};
    global.window.DevCoachModules.storage = {
        loadWeeklyData: () => weekly,
        loadYtdData: () => ({}),
        loadDailyData: () => ({})
    };
    global.window.DevCoachModules.centerRanking = {
        buildCenterRankings: () => ({ rankings: [], totalEmployees: 0, teamMembers: new Set(), periodKey: '' }),
        buildRankingsForPeriod: () => null
    };
    t.loadModule('modules/period-index.module.js');
    t.loadModule('modules/period-compare.module.js');
    const celebrations = t.loadModule('modules/celebrations.module.js').celebrations;
    const compare = t.loadModule('modules/period-comparison.module.js').periodComparison;
    compare.resetCache();
    return {
        celebrations,
        forId: (id) => compare.resolve(celebrations.resolveShoutOutWindow(id, TODAY), TODAY)
    };
}

function monthUpload(start, end, count) {
    return { metadata: { periodType: 'month', startDate: start, endDate: end }, employees: team(count) };
}

suite('consolidation: Last month is August, measured against July', (t) => {
    const { forId } = loadWindows(t, {
        '2026-07-01|2026-07-31': monthUpload('2026-07-01', '2026-07-31', 126),
        '2026-08-01|2026-08-31': monthUpload('2026-08-01', '2026-08-31', 126)
    });
    const cmp = forId('lastMonth');

    t.equal('the near side is the August upload', cmp.latestKey, '2026-08-01|2026-08-31');
    t.equal('the far side is July', cmp.baselineKey, 'month:2026-07');
    t.equal('the prose is told it is a month', cmp.unit, 'month');
    t.equal('and it reads as two months', cmp.headline, 'August 2026 against July 2026');
});

suite('consolidation: no August upload means no Last month, and it says why', (t) => {
    const { celebrations } = loadWindows(t, {
        // Month to date is not a finished month, so it cannot stand in.
        '2026-09-01|2026-09-21': { metadata: { periodType: 'month-to-date', startDate: '2026-09-01', endDate: '2026-09-21' }, employees: team(126) }
    });
    const lastMonth = celebrations.listShoutOutWindows(TODAY).filter((w) => w.id === 'lastMonth')[0];

    t.check('the window is still on offer, greyed out', Boolean(lastMonth) && lastMonth.available === false);
    t.check('and names the upload that would fix it', /last completed month/.test(lastMonth.reason));
});

// --- Cheer follows the window --------------------------------------------

function cheerWeek(start, end, transfers, type) {
    return {
        metadata: { startDate: start, endDate: end, periodType: type || 'week' },
        employees: [{ name: 'Christi Test', transfers, totalCalls: 500, surveyTotal: 40 }]
    };
}

function loadCheer(t) {
    t.pinClock('2026-09-24');
    t.installFakeBrowser();
    global.weeklyData = {
        '2026-08-31|2026-09-06': cheerWeek('2026-08-31', '2026-09-06', 9.0),
        '2026-09-07|2026-09-13': cheerWeek('2026-09-07', '2026-09-13', 8.0),
        '2026-09-14|2026-09-20': cheerWeek('2026-09-14', '2026-09-20', 7.0),
        '2026-09-21|2026-09-23': cheerWeek('2026-09-21', '2026-09-23', 5.0, 'week-in-progress')
    };
    global.window.METRICS_REGISTRY = { transfers: { key: 'transfers', label: 'Transfers', isReverse: true } };
    global.window.formatMetricDisplay = (k, v) => v.toFixed(1) + '%';
    global.window.DevCoachModules.metricProfiles = { TARGETS_BY_YEAR: { 2026: { transfers: { type: 'max', meet: 6 } } } };
    global.window.DevCoachModules.futures = {
        buildFuturesData: () => ({
            employees: [{ name: 'Christi Test', metrics: {}, dataSource: 'test' }],
            weekInfo: { currentYear: 2026, weeksCompleted: 38, weeksRemaining: 14 }
        })
    };
    global.getEmployeeNickname = (n) => n.split(' ')[0];
    return t.loadModule('modules/cheerleading.module.js').cheerleading;
}

suite('consolidation: Cheer compares the two weeks the window names', (t) => {
    const cheer = loadCheer(t);
    const cmp = {
        unit: 'week',
        latestKey: '2026-09-14|2026-09-20',
        baselineKey: '2026-09-07|2026-09-13',
        latestLabel: 'last week',
        baselineLabel: 'the week before'
    };
    const data = cheer.buildCheerData({ comparison: cmp });

    t.equal('the near week is the window\'s', data.periods.wowCur, cmp.latestKey);
    t.equal('and so is the far one, not the newest upload', data.periods.wowPrev, cmp.baselineKey);
    t.equal('it uses the page\'s words for them', data.periods.wowCurLabel, 'last week');

    const message = cheer.cheerMessageFor('Christi Test', cmp);
    t.check('a cheer is written', message.length > 0);
    t.check('quoting the window\'s two weeks', message.includes('8.0%') && message.includes('7.0%'));
    t.check('and not the week in progress it was not asked about', !message.includes('5.0%'));
});

suite('consolidation: under a month, Cheer drops the week-over-week line', (t) => {
    const cheer = loadCheer(t);
    const data = cheer.buildCheerData({
        comparison: { unit: 'month', latestKey: '2026-09-01|2026-09-23', baselineKey: 'month:2026-08', latestLabel: 'September 2026 so far', baselineLabel: 'August 2026' }
    });
    t.equal('no week is compared', data.periods.wowCur, null);
    t.check('so no week-over-week cheer is made',
        data.people.every((p) => p.cheers.every((c) => c.kind !== 'wow')));
});

suite('consolidation: with no window, Cheer still reads the newest two weeks', (t) => {
    const cheer = loadCheer(t);
    const data = cheer.buildCheerData();
    t.equal('the week in progress is the near side', data.periods.wowCur, '2026-09-21|2026-09-23');
    t.equal('last week is the far side', data.periods.wowPrev, '2026-09-14|2026-09-20');
});

// --- Tones -----------------------------------------------------------------

function loadMyTeam(t, windowId) {
    t.installFakeBrowser();
    const win = { id: windowId, label: windowId, key: 'K', dateRange: 'Sep 14 - Sep 20', count: 126, available: true, reason: '' };
    global.window.DevCoachModules.celebrations = {
        listShoutOutWindows: () => [win],
        resolveShoutOutWindow: () => win,
        detectCelebrations: () => ({
            celebrations: [{ name: 'Alyssa Dimes', firstName: 'Alyssa', achievements: [{ key: 'aht', label: 'Handle Time', rank: 3 }] }],
            missed: [],
            dateRange: 'Sep 14 - Sep 20',
            periodKey: 'K'
        })
    };
    t.loadModule('modules/period-index.module.js');
    t.loadModule('modules/daily-outreach.module.js');
    t.loadModule('modules/day-posts.module.js');
    return t.loadModule('modules/my-team.module.js').myTeam;
}

suite('consolidation: every message the three tabs wrote is a tone', (t) => {
    const myTeam = loadMyTeam(t, 'lastWeek');
    const row = myTeam.renderToneRow('Alyssa Dimes');

    ['highfive', 'celebrate', 'cheer', 'checkin', 'growth', 'shoutout'].forEach((id) => {
        t.check(`${id} is offered`, row.indexOf(`data-tone="${id}"`) > -1);
    });
    t.check('the one-person shout-out is set apart as public', row.indexOf('For the channel:') > -1
        && row.indexOf('For the channel:') < row.indexOf('data-tone="shoutout"'));
    t.check('the monthly review waits for a finished month', row.indexOf('data-tone="monthly"') === -1);
    t.check('the quarterly review is gone: Review Prep owns the quarter', !/quarter/i.test(row));
});

suite('consolidation: the placing tones need them in this window\'s shout-out', (t) => {
    const myTeam = loadMyTeam(t, 'lastWeek');
    const row = myTeam.renderToneRow('Betty Yanez');

    t.check('no placing message for someone who did not place', row.indexOf('data-tone="celebrate"') === -1);
    t.check('and no shout-out naming them', row.indexOf('data-tone="shoutout"') === -1);
    t.check('the rest are still there', row.indexOf('data-tone="cheer"') > -1 && row.indexOf('data-tone="highfive"') > -1);
});

suite('consolidation: Last month brings the monthly review', (t) => {
    const myTeam = loadMyTeam(t, 'lastMonth');
    t.check('it is offered', myTeam.renderToneRow('Alyssa Dimes').indexOf('data-tone="monthly"') > -1);
});

// --- The history log ------------------------------------------------------

suite('consolidation: the shout-out writes the history, but only a whole finished week', (t) => {
    const { celebrations } = loadWindows(t, {});
    const result = {
        periodKey: '2026-09-14|2026-09-20',
        dateRange: 'Sep 14 - Sep 20',
        celebrations: [{ name: 'Alyssa Dimes', firstName: 'Alyssa', achievements: [{ key: 'aht', label: 'Handle Time', rank: 3 }] }]
    };

    t.check('a day is not logged', celebrations.logShoutOut('day', result, true) === false);
    t.check('nor a month so far', celebrations.logShoutOut('mtd', result, true) === false);
    // Each period's entry is replaced when it is logged again, so one person's
    // view would erase the rest of the team from that week.
    t.check('nor last week with one person picked', celebrations.logShoutOut('lastWeek', result, false) === false);
    t.equal('so nothing is in the log yet', celebrations.loadHistory().length, 0);

    t.check('last week for the whole team is', celebrations.logShoutOut('lastWeek', result, true) === true);
    t.equal('and lands in the log', celebrations.loadHistory()[0].periodKey, '2026-09-14|2026-09-20');
    t.check('which the shout-out card can show', celebrations.buildHistoryHtml().indexOf('Alyssa') > -1);
});

// --- Status cards -----------------------------------------------------------

suite('consolidation: the status cards read the window and lead to the person', (t) => {
    t.installFakeBrowser();
    const rows = () => ['Oceane Ingram', 'Alyssa Dimes', 'Betty Yanez'].map((name) => ({
        name, totalCalls: 200, aht: 420, scheduleAdherence: 94, overallSentiment: 90,
        positiveWord: 85, negativeWord: 88, managingEmotions: 95
    }));
    global.weeklyData = {
        '2026-09-07|2026-09-13': { metadata: { periodType: 'week', startDate: '2026-09-07', endDate: '2026-09-13' }, employees: rows() },
        '2026-09-14|2026-09-20': { metadata: { periodType: 'week', startDate: '2026-09-14', endDate: '2026-09-20' }, employees: rows() }
    };
    global.ytdData = {};
    global.dailyData = {};
    const registry = t.loadModule('modules/metrics-registry.module.js');
    global.isReverseMetric = registry.metricsRegistryHelpers.isReverseMetric;
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    // The per-metric classification is metric-trends' job, and not what is
    // under test here.
    global.window.analyzeTrendMetrics = () => ({
        allMetrics: [
            { metricKey: 'scheduleAdherence', label: 'Schedule Adherence', employeeValue: 94, target: 93, targetType: 'min', classification: 'On Track', meetsTarget: true },
            { metricKey: 'aht', label: 'Average Handle Time', employeeValue: 420, target: 426, targetType: 'max', classification: 'On Track', meetsTarget: true }
        ]
    });
    const pulse = t.loadModule('modules/morning-pulse.module.js').morningPulse;

    const html = pulse.buildTeamPulseHtml({
        latestKey: '2026-09-14|2026-09-20', baselineKey: '2026-09-07|2026-09-13',
        latestLabel: 'last week', baselineLabel: 'the week before', unit: 'week'
    }, { actionFor: (name) => `<button class="open" data-name="${name}">Write</button>` });

    t.check('a card is drawn for each person', (html.match(/class="pulse-card"/g) || []).length === 3);
    const order = ['Alyssa', 'Betty', 'Oceane'].map((n) => html.indexOf(`data-employee="${n}`));
    t.check('in alphabetical order', order[0] > -1 && order[0] < order[1] && order[1] < order[2]);
    t.check('each with the one action it was handed', (html.match(/class="open"/g) || []).length === 3);
    t.check('and none of the six message buttons the Pulse tab carried',
        !/pulse-(checkin|kickoff|midweek|highfive|growth|review)-btn/.test(html));
    t.check('the summary names what the moves are against', html.indexOf('against the week before') > -1);

    const one = pulse.buildTeamPulseHtml({ latestKey: '2026-09-14|2026-09-20', latestLabel: 'last week', unit: 'week' },
        { person: 'Betty Yanez' });
    t.equal('narrowed to one person, one card', (one.match(/class="pulse-card"/g) || []).length, 1);
});

suite('consolidation: the badge is the share of the scorecard met, and the team view is a line each', (t) => {
    t.installFakeBrowser();
    // kpis: how many scorecard metrics were scored. onTarget: how many hit
    // their target. ahead: how many more missed it but were level with or
    // ahead of the center. center: false means no center figure at all.
    const plan = {
        'Ann Four': { kpis: 4, onTarget: 4 },
        'Bea Three': { kpis: 4, onTarget: 3 },
        'Cal Two': { kpis: 4, onTarget: 2 },
        'Dee One': { kpis: 4, onTarget: 1 },
        'Eve Third': { kpis: 3, onTarget: 1 },
        'Fay None': { kpis: 3, onTarget: 0 },
        'Gus Center': { kpis: 4, onTarget: 1, ahead: 2 },
        'Hal Level': { kpis: 4, onTarget: 0, ahead: 4 },
        'Ivy Nocenter': { kpis: 4, onTarget: 1, center: false }
    };
    const names = Object.keys(plan);
    const rows = () => names.map((name) => ({ name, totalCalls: 200, surveyTotal: 4, repSurveyTotal: 4 }));
    global.weeklyData = {
        '2026-09-07|2026-09-13': { metadata: { periodType: 'week', startDate: '2026-09-07', endDate: '2026-09-13' }, employees: rows() },
        '2026-09-14|2026-09-20': { metadata: { periodType: 'week', startDate: '2026-09-14', endDate: '2026-09-20' }, employees: rows() }
    };
    global.ytdData = {};
    global.dailyData = {};
    const registry = t.loadModule('modules/metrics-registry.module.js');
    global.isReverseMetric = registry.metricsRegistryHelpers.isReverseMetric;
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;

    // Every off-scorecard metric is missed, which under the old rule (red at
    // three misses of any kind) made every one of them "Needs Support".
    const scorecard = [
        ['scheduleAdherence', 'Schedule Adherence'], ['aht', 'Average Handle Time'],
        ['overallSentiment', 'Overall Sentiment'], ['cxRepOverall', 'Rep Satisfaction']
    ];
    global.window.analyzeTrendMetrics = (emp) => {
        const p = plan[emp.name];
        const hasCenter = p.center !== false;
        return {
            allMetrics: scorecard.slice(0, p.kpis).map(([metricKey, label], i) => {
                const meets = i < p.onTarget;
                const ahead = !meets && i < p.onTarget + (p.ahead || 0);
                return { metricKey, label, employeeValue: 1, target: 2, targetType: 'min',
                    classification: meets ? 'On Track' : 'Needs Focus', meetsTarget: meets, gapFromTarget: meets ? 0 : 1,
                    centerValue: hasCenter ? 5 : 0, isBelowCenter: hasCenter ? !(meets || ahead) : false };
            }).concat(['transfers', 'holdTime', 'acw'].map((metricKey) => ({
                metricKey, label: metricKey, employeeValue: 1, target: 2, targetType: 'min',
                classification: 'Needs Focus', meetsTarget: false, gapFromTarget: 1, centerValue: 5, isBelowCenter: true
            })))
        };
    };
    const pulse = t.loadModule('modules/morning-pulse.module.js').morningPulse;

    const cmp = { latestKey: '2026-09-14|2026-09-20', baselineKey: '2026-09-07|2026-09-13',
        latestLabel: 'last week', baselineLabel: 'the week before', unit: 'week' };
    const html = pulse.buildTeamPulseHtml(cmp, {
        compact: true,
        actionFor: (name) => `<button class="open" data-name="${name}">Write</button>`
    });
    const rowFor = (name) => {
        const start = html.indexOf(`data-employee="${name}"`);
        return html.slice(start, html.indexOf('</summary>', start));
    };
    const badgeOf = (name) => (rowFor(name).match(/(Crushing It|Doing Good|Watch|Needs Support|Steady)/) || [])[1];

    t.equal('every one on target is Crushing It', badgeOf('Ann Four'), 'Crushing It');
    t.equal('three of four is Doing Good, not Needs Support', badgeOf('Bea Three'), 'Doing Good');
    t.equal('two of four is Watch', badgeOf('Cal Two'), 'Watch');
    t.equal('one of four is Needs Support', badgeOf('Dee One'), 'Needs Support');
    t.equal('one of three is Watch', badgeOf('Eve Third'), 'Watch');
    t.equal('none of three is Needs Support', badgeOf('Fay None'), 'Needs Support');
    t.equal('ahead of the center counts: one on target and two ahead is Doing Good', badgeOf('Gus Center'), 'Doing Good');
    t.equal('ahead of the center everywhere is Doing Good, not Crushing It', badgeOf('Hal Level'), 'Doing Good');
    t.equal('with no center figure it is the target alone', badgeOf('Ivy Nocenter'), 'Needs Support');

    t.check('the line says how much of the scorecard is met, and how', rowFor('Gus Center').indexOf('3 of 4 scorecard on target or ahead of the center') > -1);
    t.check('and the one thing to look at', rowFor('Bea Three').indexOf('Focus:') > -1);

    t.equal('a line each', (html.match(/class="pulse-row"/g) || []).length, names.length);
    t.check('opening to the full card', (html.match(/class="pulse-card"/g) || []).length === names.length);
    t.equal('the button is on the line, not repeated in the card', (html.match(/class="open"/g) || []).length, names.length);
    t.check('the count bar agrees with the lines',
        html.indexOf('1 Crushing It') > -1 && html.indexOf('3 Doing Good') > -1
        && html.indexOf('2 Watch') > -1 && html.indexOf('3 Needs Support') > -1);
    t.check('and is drawn in theme colours, not a fixed light grey', html.indexOf('#f5f7fa') === -1);
});

// --- Beat a target ----------------------------------------------------------

suite('consolidation: Beat a target is the Highlights post, over the window', (t) => {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/highlights.module.js');
    const day = {
        metadata: { periodType: 'daily', startDate: '2026-09-23', endDate: '2026-09-23' },
        employees: [
            { name: 'Alyssa Dimes', totalCalls: 80, scheduleAdherence: 99, aht: 360 },
            { name: 'Michelle Castro', totalCalls: 75, scheduleAdherence: 88, aht: 520 }
        ]
    };
    global.window.DevCoachModules.periodComparison = { periodFor: (key) => (key === 'D' ? day : null) };
    global.window.DevCoachModules.teamScope = {
        getMyTeamRoster: () => ['Alyssa Dimes', 'Michelle Castro'],
        getScopeMembers: () => null
    };
    const hub = t.loadModule('modules/team-hub.module.js').teamHub;

    const built = hub.buildHighlightsForComparison({ windowId: 'day', latestKey: 'D', baselineKey: null, latestLabel: 'yesterday' });
    t.equal('only the rep who beat a target is in it', built.people, 1);
    t.check('the post names them', built.post.indexOf('Alyssa') > -1);
    t.check('and is titled with the window', built.post.indexOf('Highlights, Yesterday') > -1);
    t.check('with no placings in it', !/\b(rank|#\d|top \d)\b/i.test(built.post));

    const none = hub.buildHighlightsForComparison({ windowId: 'lastWeek', latestKey: 'missing' });
    t.equal('a window with no upload writes nothing', none.post, '');
});

// --- Nothing points at the old screens ---------------------------------------

suite('consolidation: nothing still reaches for the old tabs', (t) => {
    const sources = fs.readdirSync(path.join(ROOT, 'modules'))
        .filter((f) => f.endsWith('.js'))
        .map((f) => read('modules/' + f))
        .concat([read('script.js'), read('index.html')])
        .join('\n');

    ['renderCelebrations', 'initializeCelebrations', 'renderMorningPulse', 'initializeMorningPulse',
        'renderCheerleading', 'initializeHighlights', 'renderHighlights', 'celebrationsInnerNav',
        'innerNavCheerleader', 'highlightsContainer', 'cheerleaderContainer'].forEach((name) => {
        t.check(`${name} is gone`, sources.indexOf(name) === -1);
    });
});

// --- The page actually draws ----------------------------------------------------

// A DOM just rich enough to run the page: elements by id, and the tone buttons
// the page writes into its own markup, so a click can be made on them.
function fakePage() {
    const els = {};
    const handlers = {};
    const el = (id) => {
        if (!els[id]) {
            els[id] = {
                id, innerHTML: '', style: {}, dataset: {},
                addEventListener() {},
                querySelector: () => null,
                querySelectorAll(sel) {
                    if (sel !== '.mt-tone-btn') return [];
                    return [...this.innerHTML.matchAll(/data-tone="(\w+)"/g)].map((m) => ({
                        dataset: { tone: m[1] },
                        addEventListener(type, fn) { handlers[m[1]] = fn; }
                    }));
                }
            };
        }
        return els[id];
    };
    global.document.getElementById = (id) => el(id);
    return { els, handlers };
}

function wireWriters() {
    const m = global.window.DevCoachModules;
    m.celebrations.generateDirectMessage = () => 'WRITTEN: placings';
    m.celebrations.generateShoutOut = () => 'WRITTEN: one-person shout-out';
    m.celebrations.generateAllShoutOuts = () => 'WRITTEN: team shout-out';
    m.celebrations.getActiveTiers = () => [1, 5, 10, 15];
    m.celebrations.getCustomThreshold = () => null;
    m.celebrations.saveCustomThreshold = () => {};
    m.celebrations.buildHistoryHtml = () => '<div>history</div>';
    m.celebrations.logShoutOut = () => false;
    m.cheerleading = { cheerMessageFor: () => 'WRITTEN: cheer' };
    m.morningPulse = {
        generateHighFiveMessage: async () => 'WRITTEN: high five',
        generateCheckinMessage: async () => 'WRITTEN: check-in',
        generateMonthlyCheckinMessage: async () => 'WRITTEN: monthly review',
        buildTeamPulseHtml: () => '<div class="pulse-card">cards</div>'
    };
}

suite('consolidation: every tone writes into the page for one person', async (t) => {
    const myTeam = loadMyTeam(t, 'lastMonth');
    const { els, handlers } = fakePage();
    wireWriters();
    global.window.DevCoachModules.teamScope = { getActiveMember: () => 'Alyssa Dimes' };

    await myTeam.renderDayPage();
    t.check('the page draws', els.myTeamDayContainer.innerHTML.indexOf('Also send:') > -1);
    t.check('with the status card underneath', els.myTeamDayContext.innerHTML.indexOf('pulse-card') > -1);

    const expected = {
        highfive: 'high five', celebrate: 'placings', cheer: 'cheer',
        checkin: 'check-in', monthly: 'monthly review', shoutout: 'one-person shout-out'
    };
    for (const tone of Object.keys(expected)) {
        let threw = null;
        try { await handlers[tone](); } catch (e) { threw = e; }
        t.equal(`${tone} does not throw`, threw && threw.message, null);
        t.check(`${tone} writes its message`, els.myTeamDayMessage.innerHTML.indexOf('WRITTEN: ' + expected[tone]) > -1);
        // Clicking the lit tone again goes back to the day post.
        await handlers[tone]();
    }
    t.check('the public one says it is public', (await (async () => {
        await handlers.shoutout();
        return els.myTeamDayMessage.innerHTML.indexOf('Public.') > -1;
    })()));
});

suite('consolidation: the team view draws both shout-out styles', async (t) => {
    const myTeam = loadMyTeam(t, 'lastWeek');
    const { els } = fakePage();
    wireWriters();
    global.window.DevCoachModules.teamScope = { getActiveMember: () => null };
    global.window.DevCoachModules.teamHub = {
        buildHighlightsForComparison: () => ({ post: 'WRITTEN: beat a target', people: 2, scanned: 18, resolved: {} })
    };

    await myTeam.renderDayPage();
    t.check('the three team jobs are offered', els.myTeamDayMessage.innerHTML.indexOf('Private round') > -1);

    let threw = null;
    try { myTeam.renderShoutOut(); } catch (e) { threw = e; }
    t.equal('the placings post draws', threw && threw.message, null);
    t.check('with the team shout-out in it', els.myTeamShoutOutSlot.innerHTML.indexOf('WRITTEN: team shout-out') > -1);
    t.check('the ranking bar is in the card', els.myTeamShoutOutSlot.innerHTML.indexOf('id="myTeamTopN"') > -1);
    t.check('and so is History', els.myTeamShoutOutSlot.innerHTML.indexOf('myTeamHistoryToggle') > -1);
    t.check('and the style switch', els.myTeamShoutOutSlot.innerHTML.indexOf('data-style="targets"') > -1);

    // The card showed the post twice (a coloured copy and a text box) under a
    // line explaining the colours. It shows it once now.
    const card = els.myTeamShoutOutSlot.innerHTML;
    const more = card.slice(card.indexOf('id="myTeamShoutOutMore"'));
    t.check('the bar and History are tucked in a More fold', more.indexOf('id="myTeamTopN"') > -1 && more.indexOf('myTeamHistoryToggle') > -1);
    t.check('which starts shut', !/id="myTeamShoutOutMore"[^>]*\sopen/.test(card));
    t.check('the text box starts hidden behind Edit', /id="myTeamShoutOutText"[^>]*display:none/.test(card) && card.indexOf('id="myTeamShoutOutEdit"') > -1);
    t.check('and there is no colour key line', card.indexOf('shoutout-legend') === -1 && card.indexOf('Colour is on screen only') === -1);
});

suite('consolidation: who did not make it is in the shout-out card, and the team panel is shut', async (t) => {
    const myTeam = loadMyTeam(t, 'lastWeek');
    const { els } = fakePage();
    wireWriters();
    const m = global.window.DevCoachModules;
    m.teamScope = { getActiveMember: () => null };
    m.celebrations.describeNoCelebration = (info) => info.sentence;
    m.celebrations.detectCelebrations = () => ({
        celebrations: [{ name: 'Alyssa Dimes', firstName: 'Alyssa', achievements: [{ key: 'aht', label: 'Handle Time', rank: 3 }] }],
        missed: [{ name: 'Sabrina Ochoa', reason: 'thinVolume', sentence: 'Sabrina only took 11 calls this period.' }],
        dateRange: 'Sep 14 - Sep 20',
        periodKey: 'K'
    });

    await myTeam.renderDayPage();
    const page = els.myTeamDayContainer.innerHTML;
    t.check('the panel under the page is shut for the whole team', /<details[^>]*>\s*<summary[^>]*>How everyone is tracking/.test(page)
        && !/<details[^>]*open>\s*<summary[^>]*>How everyone is tracking/.test(page));
    t.check('and no longer repeats the shout-out', els.myTeamDayContext.innerHTML.indexOf('The shout-out') === -1
        && els.myTeamDayContext.innerHTML.indexOf("Who didn't make it") === -1);

    myTeam.renderShoutOut();
    t.check('the shout-out card says who did not make it', els.myTeamShoutOutSlot.innerHTML.indexOf("Who didn't make it, and why (1)") > -1);
    t.check('and why', els.myTeamShoutOutSlot.innerHTML.indexOf('only took 11 calls') > -1);

    // An empty window is when "why is nobody in here" matters most.
    m.celebrations.detectCelebrations = () => ({
        celebrations: [],
        missed: [{ name: 'Sabrina Ochoa', reason: 'thinVolume', sentence: 'Sabrina only took 11 calls this period.' }],
        dateRange: 'Sep 14 - Sep 20',
        periodKey: 'K2'
    });
    await myTeam.renderDayPage(); // a fresh render forgets the last answer
    myTeam.renderShoutOut();
    t.check('an empty post still says who did not make it', els.myTeamShoutOutSlot.innerHTML.indexOf('only took 11 calls') > -1);

    m.teamScope = { getActiveMember: () => 'Alyssa Dimes' };
    await myTeam.renderDayPage();
    t.check('for one person the panel opens, as the evidence for the message',
        /<details[^>]*open>\s*<summary[^>]*>What's behind it/.test(els.myTeamDayContainer.innerHTML));
});
