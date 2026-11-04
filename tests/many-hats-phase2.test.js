'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * Many hats review, Phase 2: turning the year (audit/2026-11-03-many-hats.md).
 *
 * The app was run with the clock on January 5, 2027. These pin the fixes
 * for what that run turned up.
 */

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

function between(source, start, end) {
    const from = source.indexOf(start);
    if (from === -1) return '';
    const to = source.indexOf(end, from + start.length);
    return source.slice(from, to === -1 ? undefined : to);
}

suite('many hats X3: the review year never sets the upload\'s target year', (t) => {
    const script = read('script.js');
    const body = between(script, 'function bindYearEndProfileSync()', '\n}\n');
    t.check('the function was found', body.length > 300);
    // Typing 2026 in Review Year set the upload select to 2026 and saved it,
    // so January's uploads were stamped as 2026.
    t.check('the review year handler leaves the upload select alone', body.indexOf('profileSelect.value = val') === -1);
    t.check('the upload select opens on Auto every time', /profileSelect\.value = 'auto'/.test(body));
    t.check('and its choice is never saved', !/profileSelect[\s\S]{0,400}localStorage\.setItem/.test(between(body, 'if (profileSelect)', 'if (!reviewYearInput)')));
    t.check('its years come from the target table', /TARGETS_BY_YEAR/.test(body));
});

suite('many hats X5: PTO counts the year\'s time off only', (t) => {
    const pto = read('modules/pto.module.js');
    const balance = between(pto, 'function calculatePtoBalance', '\n}\n');
    t.check('the balance reads this year\'s entries', /entriesThisYear\(data\.payrollEntries\)/.test(balance));
    t.check('and not every stored year', balance.indexOf('(data.payrollEntries || []).forEach') === -1);

    // The helper itself, run.
    const helper = between(pto, 'function entryYear(e)', 'function calculatePtoBalance');
    const entriesThisYear = new Function(helper + '\nreturn entriesThisYear;')();
    const entries = [{ date: '2026-12-21', hours: 8 }, { date: '2027-01-04', hours: 4 }, { date: '', hours: 2 }];
    t.equal('January sees January', entriesThisYear(entries, 2027).length, 1);
    t.equal('December sees December', entriesThisYear(entries, 2026).length, 1);
});

suite('many hats X6: last year\'s targets stand until the new year\'s are in', (t) => {
    t.installFakeBrowser();
    const profiles = t.loadModule('modules/metric-profiles.module.js').metricProfiles;
    const latest = Math.max(...Object.keys(profiles.TARGETS_BY_YEAR).map(Number));
    const next = latest + 1;
    t.check('a year with no table still has targets',
        Object.keys(profiles.getTargetsForYear(next)).length > 0);
    t.check('and rating bands', Object.keys(profiles.getRatingBandsForYear(next)).length > 0);
    t.equal('they are the newest year\'s', profiles.profileYearFor(next), latest);
    t.equal('a year on file stands for itself', profiles.profileYearFor(latest), latest);

    const futures = read('modules/futures.module.js');
    t.check('Pace asks for the year\'s targets the borrowing way',
        /getTargetsForYear\(currentYear\)/.test(futures) && /getRatingBandsForYear\(currentYear\)/.test(futures));
    const onOff = read('modules/on-off-tracker.module.js');
    t.check('the On/Off tracker no longer reads the tables by exact year',
        onOff.indexOf('RATING_BANDS_BY_YEAR') === -1 && onOff.indexOf('TARGETS_BY_YEAR') === -1);
    t.check('the trends goals card names the year it is', read('script.js').indexOf('>2026 Goals Snapshot<') === -1);
});
