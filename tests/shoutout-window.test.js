'use strict';

const { suite } = require('./harness');

/**
 * WHICH STRETCH OF TIME A SHOUT-OUT COVERS
 *
 * The post used to be built from whichever upload happened to be newest, so
 * "6th best in the call center" silently meant a different window every week.
 * These are the rules for the four windows worth posting about — and, just as
 * importantly, for refusing to post a window that has nothing honest behind it.
 */

const TODAY = '2026-08-18'; // a Tuesday

function bigTeam(n) {
    const out = [];
    for (let i = 0; i < n; i++) out.push({ name: 'Person' + i });
    return out;
}

function stores() {
    return {
        weeklyData: {
            // Two finished weeks, the later one being "last week".
            '2026-08-03|2026-08-09': { metadata: { periodType: 'week', endDate: '2026-08-09' }, employees: bigTeam(120) },
            '2026-08-10|2026-08-16': { metadata: { periodType: 'week', endDate: '2026-08-16' }, employees: bigTeam(124) },
            // This week, two days in.
            '2026-08-17|2026-08-18': { metadata: { periodType: 'week-in-progress', endDate: '2026-08-18' }, employees: bigTeam(118) },
            // The month so far, straight from the source.
            '2026-08-01|2026-08-17': { metadata: { periodType: 'month-to-date', endDate: '2026-08-17' }, employees: bigTeam(126) }
        },
        ytdData: {
            '2026-01-01|2026-08-16': { metadata: { periodType: 'ytd', endDate: '2026-08-16' }, employees: bigTeam(127) }
        },
        dailyData: {}
    };
}

function load(t, overrides) {
    t.installFakeBrowser();
    const data = Object.assign(stores(), overrides || {});

    // celebrations reads the bare globals; periodIndex reads them off window.
    // Both point at the same objects, the way script.js has them.
    global.weeklyData = data.weeklyData;
    global.ytdData = data.ytdData;
    global.dailyData = data.dailyData;
    global.window.weeklyData = data.weeklyData;
    global.window.ytdData = data.ytdData;
    global.window.dailyData = data.dailyData;

    global.window.DevCoachModules.centerRanking = {
        buildCenterRankings: () => ({ rankings: [], totalEmployees: 0, teamMembers: new Set(), periodKey: '' }),
        buildRankingsForPeriod: () => null
    };

    t.loadModule('modules/period-index.module.js');
    return t.loadModule('modules/celebrations.module.js').celebrations;
}

function byId(windows, id) {
    return windows.filter((w) => w.id === id)[0];
}

suite('shout-out window: each window resolves to the upload that actually covers it', (t) => {
    const celebrations = load(t);
    const windows = celebrations.listShoutOutWindows(TODAY);

    t.equal('all four windows plus the old behaviour are offered', windows.length, 5);
    t.equal('the latest upload stays available as itself', byId(windows, 'latest').key, null);

    t.equal('this week is the week in progress, not the finished one',
        byId(windows, 'thisWeek').key, '2026-08-17|2026-08-18');
    t.equal('last week is the week that ended before this one started',
        byId(windows, 'lastWeek').key, '2026-08-10|2026-08-16');
    t.equal('month to date is the month-to-date upload',
        byId(windows, 'mtd').key, '2026-08-01|2026-08-17');
    t.equal('year to date is the YTD report',
        byId(windows, 'ytd').key, '2026-01-01|2026-08-16');

    // A rank is unreadable without the range it was earned over, so every
    // window carries its own dates rather than borrowing the page header's.
    t.check('and each one knows its own date range',
        windows.filter((w) => w.id !== 'latest').every((w) => w.dateRange));
    t.equal('with the size of the field behind it', byId(windows, 'mtd').count, 126);
});

suite('shout-out window: a window with nothing behind it says so', (t) => {
    const celebrations = load(t, { ytdData: {}, weeklyData: {
        '2026-08-10|2026-08-16': { metadata: { periodType: 'week', endDate: '2026-08-16' }, employees: bigTeam(124) }
    } });
    const windows = celebrations.listShoutOutWindows(TODAY);

    const ytd = byId(windows, 'ytd');
    t.check('no YTD report means no year-to-date window', ytd.available === false);
    t.check('and it says which upload is missing', ytd.reason.indexOf('year-to-date') > -1);

    const thisWeek = byId(windows, 'thisWeek');
    t.check('nothing for this week yet is the same story', thisWeek.available === false);
    t.check('named as this week rather than as an error', thisWeek.reason.indexOf('this week') > -1);

    // Refusing is the point. Quietly ranking last week under the name "this
    // week" is how a post ends up describing the wrong seven days.
    t.equal('and no key is handed back to build from', thisWeek.key, null);
    t.check('last week still works', byId(windows, 'lastWeek').available === true);
});

suite('shout-out window: too small a field cannot be called the center', (t) => {
    // A team-only export: eighteen people, uploaded as this week.
    const celebrations = load(t, {
        weeklyData: {
            '2026-08-17|2026-08-18': { metadata: { periodType: 'week-in-progress', endDate: '2026-08-18' }, employees: bigTeam(18) },
            '2026-08-10|2026-08-16': { metadata: { periodType: 'week', endDate: '2026-08-16' }, employees: bigTeam(124) }
        }
    });
    const windows = celebrations.listShoutOutWindows(TODAY);
    const thisWeek = byId(windows, 'thisWeek');

    t.check('an eighteen-person file is not a center ranking', thisWeek.available === false);
    t.check('and the head count is the reason given', thisWeek.reason.indexOf('18') > -1);
    t.check('the file is still named, not hidden', thisWeek.key === '2026-08-17|2026-08-18');
});

suite('shout-out window: an added-up YTD is not a year-to-date report', (t) => {
    const celebrations = load(t, {
        ytdData: {
            '2026-01-01|2026-08-16': {
                metadata: { periodType: 'ytd', endDate: '2026-08-16', autoGeneratedYtd: true },
                employees: bigTeam(127)
            }
        }
    });
    const ytd = byId(celebrations.listShoutOutWindows(TODAY), 'ytd');

    // It only knows whoever turned up in the weekly files it was built from,
    // which is a fine trend line and a bad field to rank a center against.
    t.check('a rolled-up YTD does not stand in for the report', ytd.available === false);
    t.equal('and nothing is offered to build from', ytd.key, null);
});

suite('shout-out window: a stale pick falls back rather than breaking', (t) => {
    const celebrations = load(t, { ytdData: {} });

    t.equal('an available pick is honoured',
        celebrations.resolveShoutOutWindow('mtd', TODAY).key, '2026-08-01|2026-08-17');

    // Saved last week, opened it this week, the file is gone: the post still
    // gets built, from the latest upload, the way it always used to be.
    const stale = celebrations.resolveShoutOutWindow('ytd', TODAY);
    t.equal('a window that has gone away falls back to the latest upload', stale.id, 'latest');
    t.equal('which means no key, which means detection picks', stale.key, null);

    const nonsense = celebrations.resolveShoutOutWindow('whenever', TODAY);
    t.equal('and an unknown window does the same', nonsense.id, 'latest');
});

/**
 * The picker on the day page. Same window drives the post and the evidence
 * panel under it, because the panel is there to back the post up.
 */

function loadMyTeam(t, windows, capture) {
    t.installFakeBrowser();
    const myTeam = t.loadModule('modules/my-team.module.js').myTeam;
    global.window.DevCoachModules.celebrations = {
        listShoutOutWindows: () => windows,
        resolveShoutOutWindow: (id) => windows.filter((w) => w.id === id && w.available)[0] || windows[0],
        detectCelebrations: (key) => {
            if (capture) capture.key = key;
            return { celebrations: [], missed: [], dateRange: 'Aug 1, 2026 - Aug 17, 2026', totalEmployees: 126 };
        },
        describePlacement: () => '',
        describeNoCelebration: () => '',
        perfectSurveyLine: () => ''
    };
    return myTeam;
}

function windowSet() {
    return [
        { id: 'latest', label: 'Latest upload', key: null, dateRange: '', count: 0, available: true, reason: '' },
        { id: 'thisWeek', label: 'This week', key: null, dateRange: '', count: 0, available: false, reason: 'Nothing uploaded for this week yet.' },
        { id: 'lastWeek', label: 'Last week', key: '2026-08-10|2026-08-16', dateRange: 'Aug 10 - Aug 16', count: 124, available: true, reason: '' },
        { id: 'mtd', label: 'Month to date', key: '2026-08-01|2026-08-17', dateRange: 'Aug 1 - Aug 17', count: 126, available: true, reason: '' },
        { id: 'ytd', label: 'Year to date', key: '2026-01-01|2026-08-16', dateRange: 'Jan 1 - Aug 16', count: 127, available: true, reason: '' }
    ];
}

suite('shout-out picker: every window is on screen, usable or not', (t) => {
    const myTeam = loadMyTeam(t, windowSet());
    const html = myTeam.renderWindowPicker('mtd');

    t.check('all four windows are offered', ['This week', 'Last week', 'Month to date', 'Year to date']
        .every((label) => html.indexOf(label) > -1));
    t.check('along with the old behaviour', html.indexOf('Latest upload') > -1);
    t.check('the chosen one is marked', html.indexOf('data-window="mtd"') > -1 && html.indexOf('#e65100') > -1);

    // Greyed out rather than dropped: a missing window that simply vanishes
    // leaves "why can't I post this week" unanswerable without counting rows
    // on the Upload tab.
    t.check('a window with no upload is disabled, not hidden', html.indexOf('data-window="thisWeek" disabled') > -1);
    t.check('and the reason rides along on hover', html.indexOf('Nothing uploaded for this week yet.') > -1);
    t.check('a usable window shows its range and field size', html.indexOf('Aug 1 - Aug 17 · 126 associates') > -1);
});

suite('shout-out picker: the evidence panel follows the same window', (t) => {
    const capture = {};
    const myTeam = loadMyTeam(t, windowSet(), capture);

    myTeam.setActiveWindow('ytd');
    t.equal('the pick is remembered', myTeam.activeWindowId(), 'ytd');
    t.equal('and resolves to that upload', myTeam.currentWindow().key, '2026-01-01|2026-08-16');

    const html = myTeam.buildContextHtml(null);
    t.equal('the panel is built from the chosen window, not the newest upload',
        capture.key, '2026-01-01|2026-08-16');
    t.check('and says which window it is', html.indexOf('Year to date') > -1);
    t.check('next to the dates it covers', html.indexOf('Aug 1, 2026 - Aug 17, 2026') > -1);

    // The old behaviour is a window too, and it needs no label — the date
    // range already says everything a "latest upload" tag would.
    myTeam.setActiveWindow('latest');
    const plain = myTeam.buildContextHtml(null);
    t.equal('the latest upload hands detection no key', capture.key, null);
    t.check('and is not labelled as a window', plain.indexOf('Latest upload') === -1);
});

suite('shout-out picker: a picker needs no module to survive', (t) => {
    t.installFakeBrowser();
    const myTeam = t.loadModule('modules/my-team.module.js').myTeam;

    t.equal('with no celebrations module there is nothing to pick from', myTeam.renderWindowPicker('latest'), '');
    t.equal('and the window in force is the latest upload', myTeam.currentWindow().id, 'latest');

    global.window.DevCoachModules.celebrations = {
        resolveShoutOutWindow() { throw new Error('boom'); }
    };
    t.equal('a resolver that throws does not take the day page with it', myTeam.currentWindow().id, 'latest');
});

/**
 * The picker's home, and where it starts.
 *
 * It rendered only inside the shout-out card, so the one control that answers
 * "can this be the week instead of the month" was behind a click on a button
 * that already assumed the answer. And it opened on the newest upload whatever
 * that was, which is how a page headed "the week you just worked" came to show
 * a month-to-date field underneath.
 */

function outreachStub() {
    const covers = {
        monday: 'lastWeek',
        tuesday: 'lastWeekPlusMonday',
        wednesday: 'thisWeek',
        thursday: 'thisWeek',
        friday: 'thisWeek'
    };
    return {
        WEEKDAY_IDS: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        planForDate: () => ({ id: 'monday' }),
        planById: (id) => ({ id, covers: covers[id] })
    };
}

function loadDayPage(t, dayId) {
    const myTeam = loadMyTeam(t, windowSet());
    global.window.DevCoachModules.dailyOutreach = outreachStub();
    myTeam.setActiveDay(dayId);
    return myTeam;
}

suite('shout-out picker: it lives on the day page', (t) => {
    const myTeam = loadMyTeam(t, windowSet());
    const html = myTeam.renderWindowPicker('mtd');

    t.check('the row has an id so it can be repainted in place',
        html.indexOf('id="myTeamWindowPicker"') > -1);
    t.check('and is labelled for what it does', html.indexOf('Covering:') > -1);

    // The chips render on their own so a repaint replaces the contents of the
    // row rather than nesting a second row inside the first.
    const chips = myTeam.renderWindowPickerChips('mtd');
    t.check('the chips alone carry no wrapper', chips.indexOf('myTeamWindowPicker') === -1);
    t.check('but are still the same buttons', chips.indexOf('data-window="mtd"') > -1);
});

suite('shout-out picker: the day decides where it starts', (t) => {
    t.equal('Friday opens on the week it says it covers',
        loadDayPage(t, 'friday').defaultWindowId(), 'thisWeek');
    t.equal('and so does a midweek check-in',
        loadDayPage(t, 'wednesday').defaultWindowId(), 'thisWeek');
    t.equal('Monday opens on the week it is about',
        loadDayPage(t, 'monday').defaultWindowId(), 'lastWeek');
    t.equal('and Tuesday, which is last week plus a day',
        loadDayPage(t, 'tuesday').defaultWindowId(), 'lastWeek');
});

suite('shout-out picker: a pick outranks the day', (t) => {
    const myTeam = loadDayPage(t, 'friday');
    t.equal('untouched, it follows the day', myTeam.activeWindowId(), 'thisWeek');

    myTeam.setActiveWindow('mtd');
    t.equal('picked, it stays picked', myTeam.activeWindowId(), 'mtd');
    t.equal('and that is the window in force', myTeam.currentWindow().id, 'mtd');
});

suite('shout-out picker: no day module, no guessing', (t) => {
    const myTeam = loadMyTeam(t, windowSet());
    t.equal('without the day plans it opens on the latest upload', myTeam.defaultWindowId(), 'latest');
    t.equal('which is what the page did before any of this', myTeam.activeWindowId(), 'latest');
});
