'use strict';

/**
 * The whole September, replayed end to end.
 *
 * Built from a real survey trace: dailies pulled the morning after (so late
 * surveys are missing from them), weeks, week-in-progress files, a stale month
 * to date, a 9/1 to 9/5 report filed as the day 9/5, dailies the weekly uploads
 * moved to the archive, and a contest month already holding counts from
 * earlier pulls. Then every day is re-uploaded fresh, exactly as the paste
 * upload stores a daily, and the real Pull from uploads button runs with
 * every confirm answered OK.
 *
 * It caught two things the unit tests did not: a week's total an earlier pull
 * filed on the Sunday was added on top of the same surveys read off the fresh
 * dailies, and a count typed on a flagged day has to survive the next pull.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

// ---------- truth ----------
// survey: [rep, fcr, oe] each 1 (top), 0 (miss) or null (skipped); lag = days until it lands
const P = [1, 1, 1];
const S = (scores, lag) => ({ scores, lag: lag || 0 });
const truth = {
    'Angelina Fierro': { '2026-09-09': [S(P, 6)], '2026-09-17': [S(P, 2)], '2026-09-21': [S(P, 1)] },
    'Christi Martinez-Sharp': { '2026-09-02': [S(P)], '2026-09-17': [S([0, 0, 1])] },
    'Alyssa Dimes': { '2026-09-02': [S(P)], '2026-09-05': [S(P)], '2026-09-10': [S([0, 0, 0])] },
    'Betty Yanez': { '2026-09-17': [S(P)] },
    'Destiny Cervantez': { '2026-09-01': [S([0, 1, 1])], '2026-09-02': [S([0, 0, 0])], '2026-09-10': [S(P, 3)] },
    'Erica Kallestewa': { '2026-09-08': [S([1, 0, 1])] },
    'Esperanza Palomera': { '2026-09-08': [S([1, 0, 1])], '2026-09-10': [S([0, 0, 0])], '2026-09-15': [S([1, 0, 1])] },
    'Esther Ramos': { '2026-09-03': [S([1, 1, 0])], '2026-09-04': [S(P)], '2026-09-08': [S([1, 1, 0])], '2026-09-14': [S(P)] },
    'Jadyn Flowers': { '2026-09-09': [S([1, 0, 1])] },
    'James Garcia': { '2026-09-01': [S([0, 0, 0])], '2026-09-16': [S(P), S(P, 4)] },
    'Johnathan Padilla': { '2026-09-08': [S(P)] },
    'Kamella Dash': { '2026-09-03': [S([0, 0, 0])], '2026-09-15': [S(P), S([0, 0, 0])], '2026-09-17': [S(P)] },
    'Kristin Villela': { '2026-09-11': [S([0, 0, 0])] },
    'Matrece Muldrow': { '2026-09-01': [S(P), S([1, 0, 0])], '2026-09-10': [S(P, 2)] },
    'Oceane Ingram': { '2026-09-01': [S(P)], '2026-09-04': [S([1, 1, null])], '2026-09-10': [S([0, 0, 0])], '2026-09-16': [S(P)], '2026-09-17': [S(P, 3)] },
    'Robert Berrelleza': { '2026-09-09': [S([1, 0, 1])], '2026-09-10': [S(P), S([0, 0, 0])], '2026-09-14': [S(P)] }
};
const names = Object.keys(truth);
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const businessDays = [];
for (let d = '2026-09-01'; d <= '2026-09-22'; d = addDays(d, 1)) {
    const dow = new Date(d + 'T12:00:00Z').getUTCDay();
    if (dow !== 0 && dow !== 6) businessDays.push(d);
}
// deterministic adherence
const adherenceOf = (name, day) => {
    let h = 0; for (const c of name + day) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return 86 + (h % 130) / 10; // 86.0 .. 98.9
};

// ---------- building an upload row from surveys that had landed by `asOf` ----------
function row(name, from, to, asOf, adherence) {
    const got = [];
    Object.keys(truth[name]).forEach((day) => {
        if (day < from || day > to) return;
        truth[name][day].forEach((s) => { if (addDays(day, s.lag) <= asOf) got.push(s.scores); });
    });
    const q = (i) => {
        const answered = got.filter((sc) => sc[i] !== null);
        if (!answered.length) return { n: 0, rate: 0 };
        return { n: answered.length, rate: Math.round(answered.filter((sc) => sc[i] === 1).length / answered.length * 10000) / 100 };
    };
    const rep = q(0), fcr = q(1), oe = q(2);
    const r = { name, repSurveyTotal: rep.n, fcrSurveyTotal: fcr.n, surveyTotal: oe.n,
        cxRepOverall: rep.rate, fcr: fcr.rate, overallExperience: oe.rate, totalCalls: 50 };
    r.scheduleAdherence = adherence === undefined ? '' : adherence;
    return r;
}
function period(from, to, periodType, uploadedDay, rowFn) {
    return { metadata: { startDate: from, endDate: to, periodType, uploadedAt: uploadedDay + 'T15:00:00.000Z' },
        employees: names.map(rowFn) };
}

// ---------- the stores as they stand today ----------
const dailyArchive = {};
const dailyData = {};
const weeklyData = {};
businessDays.forEach((day) => {
    const up = addDays(day, 1);
    const p = period(day, day, 'daily', up, (n) => row(n, day, day, up, Math.round(adherenceOf(n, day) * 10) / 10));
    (day <= '2026-09-20' ? dailyArchive : dailyData)[day + '|' + day] = p;
});
// The bad 9/5: the 9/1 to 9/5 report filed as the day 9/5.
dailyArchive['2026-09-05|2026-09-05'] = period('2026-09-05', '2026-09-05', 'daily', '2026-09-08',
    (n) => row(n, '2026-09-01', '2026-09-05', '2026-09-08', 91.2));
weeklyData['2026-09-07|2026-09-13'] = period('2026-09-07', '2026-09-13', 'week', '2026-09-14', (n) => row(n, '2026-09-07', '2026-09-13', '2026-09-14', 93));
weeklyData['2026-09-14|2026-09-20'] = period('2026-09-14', '2026-09-20', 'week', '2026-09-21', (n) => row(n, '2026-09-14', '2026-09-20', '2026-09-21', 93));
weeklyData['2026-09-07|2026-09-09'] = period('2026-09-07', '2026-09-09', 'week-in-progress', '2026-09-10', (n) => row(n, '2026-09-07', '2026-09-09', '2026-09-10', 93));
weeklyData['2026-09-14|2026-09-17'] = period('2026-09-14', '2026-09-17', 'week-in-progress', '2026-09-18', (n) => row(n, '2026-09-14', '2026-09-17', '2026-09-18', 93));
weeklyData['2026-09-01|2026-09-17'] = period('2026-09-01', '2026-09-17', 'month-to-date', '2026-09-18', (n) => row(n, '2026-09-01', '2026-09-17', '2026-09-18', 93));
// A YTD and an August week crossing into September, which must be ignored.
const ytdData = { '2026-01-01|2026-09-20': period('2026-01-01', '2026-09-20', 'ytd', '2026-09-21', (n) => row(n, '2026-09-01', '2026-09-20', '2026-09-21', 92)) };
weeklyData['2026-08-31|2026-09-06'] = period('2026-08-31', '2026-09-06', 'week', '2026-09-08', (n) => row(n, '2026-09-01', '2026-09-06', '2026-09-08', 93));

// What the contest month holds right now, per the trace, plus a typed value.
const storedMonth = { days: {} };
const put = (d, n, v) => { (storedMonth.days[d] = storedMonth.days[d] || {})[n] = Object.assign((storedMonth.days[d] || {})[n] || {}, v); };
put('2026-09-02', 'Alyssa Dimes', { perfectSurveys: 1 }); put('2026-09-05', 'Alyssa Dimes', { perfectSurveys: 1 });
['Angelina Fierro', 'Betty Yanez', 'Christi Martinez-Sharp', 'Esther Ramos', 'Johnathan Padilla', 'Kamella Dash'].forEach((n) => put('2026-09-17', n, { perfectSurveys: n === 'Esther Ramos' ? 2 : 1 }));
put('2026-09-13', 'Destiny Cervantez', { perfectSurveys: 1 }); put('2026-09-13', 'Matrece Muldrow', { perfectSurveys: 1 });
put('2026-09-20', 'James Garcia', { perfectSurveys: 2 }); put('2026-09-20', 'Robert Berrelleza', { perfectSurveys: 1 });
put('2026-09-01', 'Oceane Ingram', { perfectSurveys: 1 }); put('2026-09-05', 'Oceane Ingram', { perfectSurveys: 2 }); put('2026-09-20', 'Oceane Ingram', { perfectSurveys: 2 });
businessDays.forEach((d) => names.forEach((n) => put(d, n, { adherence: d === '2026-09-05' ? 91.2 : Math.round(adherenceOf(n, d) * 10) / 10 })));

suite('contest replay: re-upload every daily, pull once, and September comes out right', async (t) => {
    const check = (label, cond) => t.check(label, !!cond);
    // Minimal browser, built by hand so the real UI module can run.
    const els = {};
    const el = (id) => els[id] || (els[id] = { id, value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
        addEventListener() {}, setAttribute() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [] });
    global.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
    global.document = { getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
        createElement: () => el('_tmp' + Math.random()), body: { appendChild() {}, removeChild() {} }, head: { appendChild() {} } };
    const confirms = [];
    global.window = { DevCoachModules: {}, DevCoachConstants: { STORAGE_PREFIX: 'devCoachingTool_' },
        confirm: (msg) => { confirms.push(msg); return true; } };
    global.CSS = { escape: (s) => s };
    global.SUPERVISOR_ROSTER = [{ supervisor: 'Scott', agents: names.slice() }];
    window.SUPERVISOR_ROSTER = global.SUPERVISOR_ROSTER;
    window.DevCoachModules.repoSync = { loadCallListeningSyncConfig: () => ({ endpoint: 'https://worker.test', sharedSecret: 'x' }) };
    let cloud = JSON.parse(JSON.stringify(storedMonth));
    global.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        if (body.mode === 'contestGet') return { ok: true, json: async () => ({ ok: true, data: JSON.parse(JSON.stringify(cloud)) }) };
        if (body.mode === 'contestSave') { cloud = JSON.parse(JSON.stringify(body.data)); return { ok: true, json: async () => ({ ok: true }) }; }
        throw new Error('unexpected ' + body.mode);
    };
    const load = (p) => (0, eval)(fs.readFileSync(path.join(ROOT, p), 'utf8'));
    load('modules/contest.module.js');
    load('modules/contest-ui.module.js');
    const api = window.DevCoachModules.contest;
    const ui = window.DevCoachModules.contestUi;

    // Globals the UI reads, as script.js declares them.
    global.dailyData = dailyData; global.weeklyData = weeklyData; global.ytdData = ytdData;
    global.getDailyArchive = () => dailyArchive;

    el('contestDate').value = '2026-09-23';
    el('contestTeam').value = 'Scott';

    // ---- BEFORE: pull on today's stores, to show the problem is real ----
    await ui.loadMonthAndRender?.();
    if (!ui.loadMonthAndRender) { cloud = cloud; }
    const beforeBoard = api.buildLeaderboard(cloud);
    const bAng = beforeBoard.find((r) => r.associate === 'Angelina Fierro');

    // ---- the re-upload: every business day, pulled fresh on 9/23 ----
    // Exactly what handleLoadPastedDataClick does for a daily: targetStore[key] = { employees, metadata }, no purge.
    const reupDays = businessDays.concat(['2026-09-05']).sort();
    reupDays.forEach((day, i) => {
        const up = '2026-09-23T15:' + String(i).padStart(2, '0') + ':00.000Z';
        dailyData[day + '|' + day] = { metadata: { startDate: day, endDate: day, periodType: 'daily', uploadedAt: up },
            employees: names.map((n) => row(n, day, day, '2026-09-23', Math.round(adherenceOf(n, day) * 10) / 10)) };
    });

    // ---- the pull, twice (idempotence) ----
    await ui.loadMonthAndRender();
    await ui.importFromUploads();
    const afterFirst = JSON.stringify(cloud);
    const status1 = el('contestDayStatus').textContent;
    await ui.loadMonthAndRender();
    await ui.importFromUploads();
    check('a second pull changes nothing', JSON.stringify(cloud) === afterFirst);

    // ---- expected ----
    const board = api.buildLeaderboard(cloud, { asOf: '2026-09-23' });
    const preview = api.buildImportPreview({ dailyData, weeklyData, ytdData, dailyArchive }, { monthKey: '2026-09', names });
    const flagged = preview.needsSurveyCheck.map((f) => f.name + ' ' + f.date);
    names.forEach((n) => {
        let certain = 0; const open = [];
        Object.keys(truth[n]).forEach((day) => {
            const r = row(n, day, day, '2026-09-23');
            const res = (function () {
                const p = api.buildImportPreview({ dailyData: { [day + '|' + day]: { metadata: { startDate: day, endDate: day }, employees: [r] } } }, { monthKey: '2026-09' });
                return p;
            })();
            if (res.needsSurveyCheck.length) open.push(day);
            else certain += truth[n][day].filter((s) => s.scores[2] === 1 && s.scores.every((v) => v === 1 || v === null)).length;
        });
        const got = board.find((r) => r.associate === n);
        check(n + ' perfect surveys', (got ? got.perfectSurvey : 0) === certain);
        open.forEach((d) => check(n + ' ' + d + ' is flagged to type in', flagged.includes(n + ' ' + d), flagged));
        const wantDays = businessDays.concat(['2026-09-05']).filter((d) => Math.round(adherenceOf(n, d) * 10) / 10 >= 93).length;
        check(n + ' adherence days', (got ? got.dailyAdherence : 0) === wantDays);
        // The bad 9/5 adherence is gone.
        check(n + ' 9/5 adherence is the real day', cloud.days['2026-09-05'][n].adherence === Math.round(adherenceOf(n, '2026-09-05') * 10) / 10);
        // Every stored survey count sits on a day that really had surveys.
        Object.keys(cloud.days).forEach((d) => {
            const v = (cloud.days[d][n] || {}).perfectSurveys;
            if (v) check(n + ' survey stored on ' + d + ' is a real survey day', !!truth[n][d], v);
        });
        // Trace says every daily with surveys was used or flagged, never "counted there".
        (preview.surveyTrace[n] || []).filter((it) => it.kind === 'daily').forEach((it) =>
            check(n + ' trace daily ' + it.start + ' used or open', it.used || !it.certain, it.why));
    });
    check('the pull reported flagged days', /still need perfect surveys typed in/.test(el('contestDayStatus').textContent) || flagged.length === 0, el('contestDayStatus').textContent);
    const ang = board.find((r) => r.associate === 'Angelina Fierro');
    const christi = board.find((r) => r.associate === 'Christi Martinez-Sharp');

    // ---- typing a flagged day in, then pulling again, keeps it ----
    const typedDay = '2026-09-15';
    // Typed through the real Save this day: the grid shows Kamella with her
    // adherence already filled and Scott types 1 in the survey box.
    el('contestDate').value = typedDay;
    const adhInput = { value: String(cloud.days[typedDay]['Kamella Dash'].adherence), getAttribute: () => 'Kamella Dash' };
    const perfInput = { value: '1' };
    document.querySelectorAll = (sel) => sel === '[data-contest-adherence]' ? [adhInput] : [];
    document.querySelector = (sel) => sel.indexOf('data-contest-perfect') > -1 ? perfInput : null;
    await ui.saveDay();
    document.querySelectorAll = () => []; document.querySelector = () => null;
    check('the typed count was saved', cloud.days[typedDay]['Kamella Dash'].perfectSurveys === 1);
    await ui.importFromUploads();
    check('a typed count on a flagged day survives the next pull', cloud.days[typedDay]['Kamella Dash'].perfectSurveys === 1);
    const kam = api.buildLeaderboard(cloud, { asOf: '2026-09-23' }).find((r) => r.associate === 'Kamella Dash');
    check('and is counted', kam.perfectSurvey === 2, kam.perfectSurvey);

    // Starting the month over and pulling again lands in the same place,
    // less the typed number, which is back to being flagged.
    await ui.clearMonth();
    check('start over empties the month', Object.keys(cloud.days).length === 0);
    await ui.importFromUploads();
    const clean = api.buildLeaderboard(cloud, { asOf: '2026-09-23' });
    check('a clean pull gives Ang her 3', clean.find((r) => r.associate === 'Angelina Fierro').perfectSurvey === 3);
    check('and Christi her 1', clean.find((r) => r.associate === 'Christi Martinez-Sharp').perfectSurvey === 1);
    check('and Kamella her 2: 9/15 lined up to one perfect survey, plus 9/17',
        clean.find((r) => r.associate === 'Kamella Dash').perfectSurvey === 2);

    // Leave nothing behind for the suites that follow.
    ['fetch', 'CSS', 'SUPERVISOR_ROSTER', 'dailyData', 'weeklyData', 'ytdData', 'getDailyArchive'].forEach((k) => { delete global[k]; });
});
