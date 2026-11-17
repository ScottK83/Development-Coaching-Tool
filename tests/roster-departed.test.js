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
    const src = sliceThrough('const SUPERVISOR_ROSTER = [', 'dropExcludedFromTeamStores');
    const api = new Function('window', 'console',
        src + '\nreturn { SUPERVISOR_ROSTER, rosterEntryFor, dropExcludedFromTeamStores };'
    )(fakeWindow, { warn() {}, info() {}, log() {} });
    return { api, saved };
}

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

suite('Departed: the cleanup runs on every load, before the team seeding', (t) => {
    const call = script.indexOf('\ndropExcludedFromTeamStores();');
    const seed = script.indexOf('(function seedSupervisorTeams()');
    t.check('called at top level', call > -1);
    t.check('before seedSupervisorTeams reads the map', call > -1 && call < seed);
    const lineStart = script.lastIndexOf('\n', call - 1);
    t.check('not behind a one-shot flag', script.slice(lineStart, call).indexOf('localStorage') === -1);
});
