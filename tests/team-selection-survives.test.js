'use strict';

/**
 * A team selection survives normalisation whichever period it was made against.
 *
 * getTeamSelectionWeekKey resolves through the Delete Data dropdown or
 * getLatestTeamSelectionWeekKey, and both consider weeklyData AND ytdData. So
 * ticking people while a year-to-date period is the active one stores the
 * selection under a YTD key.
 *
 * normalizeTeamMembersForExistingWeeks dropped every entry whose key was not in
 * weeklyData. Dropping it was only half the damage: the auto-seed then refilled
 * the week keys from DEFAULT_TEAM_MEMBERS, so a hand-picked team was replaced by
 * the built-in roster with nothing said. It runs on delete, on upload and on
 * restore, so nothing unusual had to happen.
 *
 * The two halves have to hold together: a selection against a period that still
 * exists is kept, and one against a period that is genuinely gone is dropped.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function bodyOf(src, fnName) {
    const at = src.indexOf('function ' + fnName + '(');
    if (at === -1) return null;
    const end = src.indexOf('\n}\n', at);
    return end === -1 ? src.slice(at) : src.slice(at, end);
}

suite('team selection: normalisation looks in both stores', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const body = bodyOf(src, 'normalizeTeamMembersForExistingWeeks');
    t.check('the function is still there', !!body);
    if (!body) return;

    t.check('valid keys come from weeklyData AND ytdData',
        /validWeekKeys = new Set\(\[\.\.\.weeklyKeys, \.\.\.Object\.keys\(ytdData/.test(body));
    t.check('and the employee lookup falls through to ytdData',
        /weeklyData\[key\] \|\| ytdData\[key\]/.test(body));

    // The seeding pass must stay weekly-only: seeding a year-to-date file with a
    // default roster is not something anyone asked for.
    t.check('but the auto-seed still only seeds weekly keys',
        /weeklyKeys\.forEach\(function\(weekKey\)/.test(body));
});

suite('team selection: the rule keeps what exists and drops what does not', (t) => {
    // The two stores, and the three kinds of key a selection can carry.
    const weekly = { '2026-06-15|2026-06-21': { employees: [{ name: 'Ada' }, { name: 'Ben' }] } };
    const ytd = { '2026-01-01|2026-06-21': { employees: [{ name: 'Ada' }, { name: 'Ben' }] } };

    const validKeys = new Set([...Object.keys(weekly), ...Object.keys(ytd)]);

    t.check('a weekly key is valid', validKeys.has('2026-06-15|2026-06-21'));
    t.check('a year-to-date key is valid too', validKeys.has('2026-01-01|2026-06-21'));
    t.check('and a period that was deleted is not', !validKeys.has('2099-01-01|2099-01-07'));

    // The old rule, for contrast, so the assertion above is not vacuous.
    const weeklyOnly = new Set(Object.keys(weekly));
    t.check('the old weekly-only rule would have dropped the year-to-date key',
        !weeklyOnly.has('2026-01-01|2026-06-21'));
});
