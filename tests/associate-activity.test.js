'use strict';

/**
 * Inactive associates: no numbers in the 30 days before the newest upload.
 *
 * Set aside, never deleted. They return on their own when an upload has them,
 * or with Reinstate (FMLA, leave), which keeps them active for another 30 days
 * of uploads without numbers.
 */

const { suite } = require('./harness');

const ROSTER = [
    { supervisor: 'Angela Allison', agents: ['Jacob Head', 'Kayte Heese', 'Robert Sullivan'] },
    { supervisor: 'Kathy Cruz', agents: ['Sandra Paz-Rodriguez'] }
];

function week(end, names) {
    return { metadata: { periodType: 'week', endDate: end }, employees: names.map((name) => ({ name })) };
}

function load(t, weekly, reinstated) {
    t.installFakeBrowser();
    const store = { associateReinstated: reinstated || {} };
    global.weeklyData = weekly;
    global.dailyData = {};
    global.window.SUPERVISOR_ROSTER = ROSTER;
    // The same idea as script.js's matcher, enough for spelling drift here.
    global.window.rosterEntryFor = (name) => {
        const key = (n) => String(n).toLowerCase().replace(/[^a-z]/g, '');
        const hit = ROSTER.flatMap((team) => team.agents).find((agent) => key(agent) === key(name));
        return hit || null;
    };
    global.window.DevCoachModules.storage = {
        readStore: (k) => store[k],
        saveWithSizeCheck: (k, v) => { store[k] = v; return true; }
    };
    const api = t.loadModule('modules/associate-activity.module.js').associateActivity;
    return { api, store };
}

suite('inactive: no numbers in the 30 days before the newest upload', (t) => {
    const { api } = load(t, {
        'a': week('2026-07-26', ['Jacob Head', 'Kayte Heese', 'Robert Sullivan', 'Sandra Paz Rodriguez']),
        'b': week('2026-09-20', ['Jacob Head', 'Sandra Paz Rodriguez'])
    });
    const names = api.getInactiveAssociates().map((r) => r.name);
    t.check('someone last seen in July is inactive', names.indexOf('Kayte Heese') > -1);
    t.check('someone in the newest upload is not', names.indexOf('Jacob Head') === -1);
    t.check('an upload spelling still counts for the roster name', names.indexOf('Sandra Paz-Rodriguez') === -1);
    t.check('the check works from an upload spelling too', api.isInactive('Kayte Heese') && !api.isInactive('Sandra Paz Rodriguez'));
    const row = api.getInactiveAssociates().find((r) => r.name === 'Kayte Heese');
    t.equal('and says when they last had numbers', row.lastSeen, '2026-07-26');
});

suite('inactive: counted from the newest upload, not today', (t) => {
    t.pinClock('2026-12-01');
    const { api } = load(t, { 'b': week('2026-09-20', ['Jacob Head', 'Kayte Heese', 'Robert Sullivan', 'Sandra Paz-Rodriguez']) });
    t.equal('a gap in uploading sets nobody aside', api.getInactiveAssociates().length, 0);
});

suite('inactive: reinstating keeps someone on leave listed', (t) => {
    t.pinClock('2026-09-23');
    const { api, store } = load(t, {
        'a': week('2026-07-26', ['Kayte Heese']),
        'b': week('2026-09-20', ['Jacob Head'])
    });
    t.check('Kayte starts inactive', api.isInactive('Kayte Heese'));
    api.reinstate('Kayte Heese');
    t.equal('reinstating records the day', store.associateReinstated['Kayte Heese'], '2026-09-23');
    t.check('and she is active again with no new numbers', !api.isInactive('Kayte Heese'));
    api.undoReinstate('Kayte Heese');
    t.check('set aside again on request', api.isInactive('Kayte Heese'));
});

suite('inactive: nothing uploaded means nobody is judged', (t) => {
    const { api } = load(t, {});
    t.equal('no one is set aside', api.getInactiveAssociates().length, 0);
});

suite('inactive: pickers list them last, the contest grid leaves them out', (t) => {
    const fs = require('fs');
    const path = require('path');
    const root = path.join(__dirname, '..');
    const picker = fs.readFileSync(path.join(root, 'modules/associate-picker.module.js'), 'utf8');
    t.check('pickers group them under their own heading', picker.indexOf("'Inactive (no numbers in 30 days)'") > -1);
    const contest = fs.readFileSync(path.join(root, 'modules/contest-ui.module.js'), 'utf8');
    t.check('the contest grid filters them', /function namesForTeam[\s\S]{0,400}activeOnly\(/.test(contest));
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    t.check('the settings panel is on the page', html.indexOf('id="inactiveAssociatesPanel"') > -1);
    t.check('and the module is loaded', html.indexOf("'modules/associate-activity.module.js'") > -1);
});
