'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * ROBERT BERRELLEZA MOVED DEPARTMENTS (Scott, 2026-11-17)
 *
 * "Can you completely drop robert berrelleza from my team?? He has since
 * moved departments."
 *
 * Taking him off SUPERVISOR_ROSTER is not enough on its own. "My team" is read
 * from the stored employeeSupervisors map, and seedSupervisorTeams only writes
 * the people still on the roster, so his stored "Scott" would have kept him on
 * the team forever. The Settings tick list (myTeamMembers) held him too.
 */

const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');

// From the first marker to the end of the top-level function named second.
function sliceThrough(fromMarker, lastFunction) {
    const start = script.indexOf(fromMarker);
    const fnStart = script.indexOf(`function ${lastFunction}(`, start);
    if (start < 0 || fnStart < 0) throw new Error(`${fromMarker} .. ${lastFunction} not found in script.js`);
    return script.slice(start, script.indexOf('\n}\n', fnStart) + 3);
}

function defaultTeam() {
    const start = script.indexOf('var DEFAULT_TEAM_MEMBERS = [');
    const src = script.slice(start, script.indexOf('];', start) + 2);
    return new Function(src + '\nreturn DEFAULT_TEAM_MEMBERS;')();
}

// The real roster code, run against an in-memory storage module.
function loadRoster(stores) {
    const saved = {};
    const fakeWindow = {
        DevCoachModules: {
            storage: {
                readStore: (name) => stores[name],
                saveWithSizeCheck: (name, value) => {
                    saved[name] = JSON.parse(JSON.stringify(value));
                    stores[name] = value;
                    return true;
                }
            }
        }
    };
    const src = sliceThrough('const SUPERVISOR_ROSTER = [', 'dropDepartedFromUploads');
    const api = new Function('window', 'console',
        src + '\nreturn { SUPERVISOR_ROSTER, EXCLUDED_ASSOCIATES, DEPARTED_SINCE, rosterEntryFor,' +
        ' isDepartedOn, dropExcludedFromTeamStores, dropDepartedFromUploads };'
    )(fakeWindow, { warn() {}, info() {}, log() {} });
    return { api, saved, window: fakeWindow };
}

// One stored upload, the way handleLoadPastedDataClick saves it.
function period(start, end, names) {
    return {
        metadata: { startDate: start, endDate: end },
        employees: names.map((name) => ({ name, totalCalls: 100 }))
    };
}
const namesIn = (p) => JSON.stringify(p.employees.map((e) => e.name));

suite('Departed: Robert Berrelleza is off the roster', (t) => {
    const { api } = loadRoster({});
    const everyone = api.SUPERVISOR_ROSTER.reduce((all, team) => all.concat(team.agents), []);
    const scott = api.SUPERVISOR_ROSTER.find((team) => team.supervisor === 'Scott');

    t.check('no team lists him', everyone.indexOf('Robert Berrelleza') === -1);
    t.equal('Scott has 17 associates', scott.agents.length, 17);
    t.equal('an upload spelling of him matches nobody', api.rosterEntryFor('Berrelleza, Robert'), null);
    t.equal('nor in capitals, as payroll writes it', api.rosterEntryFor('ROBERT BERRELLEZA'), null);
    t.equal('a teammate still matches', api.rosterEntryFor('Fierro, Angelina'), 'Angelina Fierro');
});

suite('Departed: Robert Berrelleza is off the default team', (t) => {
    const team = defaultTeam();
    t.check('not on the built-in default team', team.indexOf('Robert Berrelleza') === -1);
    t.equal('17 on the default team', team.length, 17);
});

suite('Departed: his stored supervisor and team ticks come off', (t) => {
    const stores = {
        employeeSupervisors: {
            'Berrelleza, Robert': 'Scott',
            'Angelina Fierro': 'Scott',
            'Jacob Head': 'Angela Allison'
        },
        myTeamMembers: {
            '2026-11-01|2026-11-07': ['Robert Berrelleza', 'Angelina Fierro'],
            '2026-11-08|2026-11-14': ['Angelina Fierro']
        }
    };
    const { api, saved } = loadRoster(stores);
    const removed = api.dropExcludedFromTeamStores();

    t.check('his supervisor entry is gone', !('Berrelleza, Robert' in saved.employeeSupervisors));
    t.equal('his teammate keeps Scott', saved.employeeSupervisors['Angelina Fierro'], 'Scott');
    t.equal('other teams are untouched', saved.employeeSupervisors['Jacob Head'], 'Angela Allison');
    t.equal('his tick is gone from the week he was in',
        JSON.stringify(saved.myTeamMembers['2026-11-01|2026-11-07']), JSON.stringify(['Angelina Fierro']));
    t.equal('a week without him is unchanged',
        JSON.stringify(saved.myTeamMembers['2026-11-08|2026-11-14']), JSON.stringify(['Angelina Fierro']));
    t.equal('it reports both spellings it removed',
        JSON.stringify(removed), JSON.stringify(['Berrelleza, Robert', 'Robert Berrelleza']));
});

suite('Departed: a clean install writes nothing', (t) => {
    const { api, saved } = loadRoster({
        employeeSupervisors: { 'Angelina Fierro': 'Scott' },
        myTeamMembers: { '2026-11-08|2026-11-14': ['Angelina Fierro'] }
    });
    const removed = api.dropExcludedFromTeamStores();
    t.equal('nothing removed', removed.length, 0);
    t.equal('no store rewritten, so no needless sync', Object.keys(saved).length, 0);
});

/**
 * "Can't erase him for November going forward?" (Scott, 2026-11-17)
 *
 * Any upload that ends on or after the day he left loses his row: weeks go by
 * the day they end (the app's own "Week ending" label), and a YTD file that
 * runs into November is November's standings. Earlier uploads keep him, since
 * he worked those days. New uploads already skip him, so this lines up.
 */
suite('Departed: his numbers from November 1 on come out of the uploads', (t) => {
    const R = 'Robert Berrelleza', A = 'Angelina Fierro';
    const stores = {
        weeklyData: {
            '2026-10-19|2026-10-25': period('2026-10-19', '2026-10-25', [R, A]),
            '2026-10-26|2026-11-01': period('2026-10-26', '2026-11-01', [R, A]),
            '2026-11-02|2026-11-08': period('2026-11-02', '2026-11-08', ['Berrelleza, Robert', A]),
            '2026-10-01|2026-10-31': period('2026-10-01', '2026-10-31', [R, A]),
            '2026-11-01|2026-11-15': period('2026-11-01', '2026-11-15', [R, A])
        },
        ytdData: {
            '2026-01-01|2026-10-31': period('2026-01-01', '2026-10-31', [R, A]),
            '2026-01-01|2026-11-15': period('2026-01-01', '2026-11-15', [R, A])
        },
        dailyData: {
            '2026-11-16|2026-11-16': period('2026-11-16', '2026-11-16', ['ROBERT BERRELLEZA', A])
        },
        dailyArchive: {
            '2026-10-30|2026-10-30': period('2026-10-30', '2026-10-30', [R, A]),
            '2026-11-03|2026-11-03': period('2026-11-03', '2026-11-03', [R, A])
        }
    };
    const { api, saved } = loadRoster(stores);

    t.equal('he left on November 1', api.DEPARTED_SINCE[R], '2026-11-01');
    t.check('every departed name is also excluded, so uploads skip them',
        Object.keys(api.DEPARTED_SINCE).every((n) => api.EXCLUDED_ASSOCIATES.indexOf(n) > -1));
    t.check('departed from November 1', api.isDepartedOn('Berrelleza, Robert', '2026-11-01'));
    t.check('not on October 31', !api.isDepartedOn(R, '2026-10-31'));
    t.check('a teammate is never departed', !api.isDepartedOn(A, '2026-11-20'));

    const removed = api.dropDepartedFromUploads();
    const w = saved.weeklyData, y = saved.ytdData;

    t.equal('a week in October keeps him', namesIn(w['2026-10-19|2026-10-25']), JSON.stringify([R, A]));
    t.equal('October as a month keeps him', namesIn(w['2026-10-01|2026-10-31']), JSON.stringify([R, A]));
    t.equal('the week ending November 1 loses him', namesIn(w['2026-10-26|2026-11-01']), JSON.stringify([A]));
    t.equal('a November week loses him, however the file spells him', namesIn(w['2026-11-02|2026-11-08']), JSON.stringify([A]));
    t.equal('November to date loses him', namesIn(w['2026-11-01|2026-11-15']), JSON.stringify([A]));
    t.equal('YTD through October keeps him', namesIn(y['2026-01-01|2026-10-31']), JSON.stringify([R, A]));
    t.equal('YTD through November 15 loses him', namesIn(y['2026-01-01|2026-11-15']), JSON.stringify([A]));
    t.equal('a November daily loses him', namesIn(saved.dailyData['2026-11-16|2026-11-16']), JSON.stringify([A]));
    t.equal('an archived October daily keeps him', namesIn(saved.dailyArchive['2026-10-30|2026-10-30']), JSON.stringify([R, A]));
    t.equal('an archived November daily loses him', namesIn(saved.dailyArchive['2026-11-03|2026-11-03']), JSON.stringify([A]));
    t.equal('six rows removed in all', removed, 6);
    t.equal('the rest of the row is untouched', w['2026-11-02|2026-11-08'].employees[0].totalCalls, 100);
});

suite('Departed: uploads with nothing to remove are not rewritten', (t) => {
    const { api, saved } = loadRoster({
        weeklyData: { '2026-10-19|2026-10-25': period('2026-10-19', '2026-10-25', ['Robert Berrelleza']) },
        ytdData: { '2026-01-01|2026-11-15': period('2026-01-01', '2026-11-15', ['Angelina Fierro']) },
        dailyData: {},
        dailyArchive: undefined
    });
    t.equal('nothing removed', api.dropDepartedFromUploads(), 0);
    t.equal('no store rewritten', Object.keys(saved).length, 0);
});

suite('Departed: November contest entries come out, and the saved month is cleaned', async (t) => {
    const R = 'Robert Berrelleza', A = 'Angelina Fierro';
    const els = {};
    const el = (id) => els[id] || (els[id] = { id, value: '', textContent: '', innerHTML: '', style: {}, dataset: {},
        addEventListener() {}, setAttribute() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [] });
    global.localStorage = { getItem: () => null, setItem() {}, removeItem() {}, key: () => null, length: 0 };
    global.document = { getElementById: el, querySelectorAll: () => [], querySelector: () => null, addEventListener() {},
        createElement: () => el('_tmp' + Math.random()), body: { appendChild() {}, removeChild() {} }, head: { appendChild() {} } };
    global.CSS = { escape: (s) => s };

    const { api } = loadRoster({});
    global.window = { DevCoachModules: {}, DevCoachConstants: { STORAGE_PREFIX: 'devCoachingTool_' },
        isDepartedOn: api.isDepartedOn, SUPERVISOR_ROSTER: api.SUPERVISOR_ROSTER, confirm: () => true };
    global.window.DevCoachModules.repoSync = { loadCallListeningSyncConfig: () => ({ endpoint: 'https://worker.test', sharedSecret: 'x' }) };

    const cloud = {
        '2026-10': { days: { '2026-10-30': { [R]: { perfectSurveys: 2, adherence: 95 }, [A]: { perfectSurveys: 1 } } } },
        '2026-11': { days: {
            '2026-11-03': { [R]: { perfectSurveys: 3, adherence: 96 }, [A]: { perfectSurveys: 1, adherence: 94 } },
            '2026-11-04': { [R]: { perfectSurveys: 1 } }
        } }
    };
    const saves = [];
    global.fetch = async (url, opts) => {
        const body = JSON.parse(opts.body);
        if (body.mode === 'contestGet') return { ok: true, json: async () => ({ ok: true, data: JSON.parse(JSON.stringify(cloud[body.month] || { days: {} })) }) };
        if (body.mode === 'contestSave') {
            saves.push(body.month);
            cloud[body.month] = JSON.parse(JSON.stringify(body.data));
            return { ok: true, json: async () => ({ ok: true }) };
        }
        throw new Error('unexpected ' + body.mode);
    };
    const load = (p) => (0, eval)(fs.readFileSync(path.join(ROOT, p), 'utf8'));
    load('modules/contest.module.js');
    load('modules/contest-ui.module.js');
    const contest = window.DevCoachModules.contest;
    const ui = window.DevCoachModules.contestUi;
    el('contestTeam').value = 'Scott';

    try {
        el('contestDate').value = '2026-11-10';
        await ui.loadMonthAndRender();
        const nov = cloud['2026-11'];
        t.check('his November rows are gone from the saved month', !(R in nov.days['2026-11-03']) && !(R in (nov.days['2026-11-04'] || {})));
        t.equal('his teammate keeps her day', nov.days['2026-11-03'][A].perfectSurveys, 1);
        t.equal('the month was saved once', JSON.stringify(saves), JSON.stringify(['2026-11']));
        const board = contest.buildLeaderboard(nov, { asOf: '2026-11-10' });
        t.check('so he has no November tickets, here or on /raffle', !board.some((row) => row.associate === R));

        await ui.loadMonthAndRender();
        t.equal('loading again saves nothing more', saves.length, 1);

        el('contestDate').value = '2026-10-15';
        await ui.loadMonthAndRender();
        t.equal('October keeps his entries', cloud['2026-10'].days['2026-10-30'][R].perfectSurveys, 2);
        t.equal('and October is not rewritten', saves.length, 1);
    } finally {
        ['fetch', 'CSS'].forEach((k) => { delete global[k]; });
    }
});

suite('Departed: the cleanup runs on every load, before the team seeding', (t) => {
    const call = script.indexOf('\ndropExcludedFromTeamStores();');
    const seed = script.indexOf('(function seedSupervisorTeams()');
    t.check('called at top level', call > -1);
    t.check('before seedSupervisorTeams reads the map', call > -1 && call < seed);
    const lineStart = script.lastIndexOf('\n', call - 1);
    t.check('not behind a one-shot flag', script.slice(lineStart, call).indexOf('localStorage') === -1);

    // The stores are read into script.js's own variables at startup (init),
    // so a top-level call here cleans them before anything reads them.
    const uploads = script.indexOf('\ndropDepartedFromUploads();');
    const init = script.indexOf('weeklyData = loadWeeklyData();');
    t.check('the upload cleanup is called at top level too', uploads > -1);
    t.check('before startup loads the stores', uploads > -1 && uploads < init);
});
