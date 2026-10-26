'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * THE YEAR-END OPENING IS SCOTT'S TO WRITE
 *
 * The verbal summary opened with fixed text about one particular year: "not
 * as successful as years past. JD Power changed the way they do their awards"
 * was read to every associate, the best on the team included. Scott,
 * 2026-10-14: "let's edit year end." The opening is now saved per review
 * year, {name} and {year} fill in per person, and the old text is only the
 * default until he writes his own.
 */
suite('year-end opening: the speech opens with the year\'s own words', (t) => {
    t.installFakeBrowser();
    const yearEnd = t.loadModule('modules/year-end.module.js').yearEnd;

    const custom = '{name}, {year} was a year we can be proud of. Thank you for everything you put in.';
    const speech = yearEnd.buildVerbalSummary('Alyssa', '2026', 'Successful', '3% to $58,760', '$1,250', custom);
    t.check('the saved opening leads', speech.startsWith('Alyssa, 2026 was a year we can be proud of.'));
    t.check('the old fixed text is not in it', speech.indexOf('JD Power') === -1);
    t.check('the rating still follows', speech.indexOf('Your overall performance rating for 2026 is Successful.') > -1);

    const fallback = yearEnd.buildVerbalSummary('Alyssa', '2026', 'Successful', '', '', '   ');
    t.check('a blank opening falls back to the default', fallback.startsWith('Alyssa, as we close out 2026,'));
    t.check('and leaves no token unfilled', !/\{(name|year)\}/i.test(fallback));
    t.equal('the default is the old text, so nothing changes until he edits it',
        yearEnd.fillOpening('', 'Sam', '2025').split('\n')[0],
        'Sam, as we close out 2025, we had a successful year, not as successful as years past. JD Power changed the way they do their awards, and it bumped us down, but we clawed up a bit.');
});

suite('year-end opening: saved per review year', (t) => {
    t.installFakeBrowser();
    t.loadModule('modules/year-end.module.js');
    const comments = t.loadModule('modules/year-end-comments.module.js').yearEndComments;

    comments.saveYearEndOpening('2026', '{name}, thank you for {year}.');
    t.equal('the year reads back what was saved', comments.loadYearEndOpening('2026'), '{name}, thank you for {year}.');
    t.check('another year still reads the default', comments.loadYearEndOpening('2025').indexOf('as we close out {year}') > -1);

    comments.saveYearEndOpening('2026', '');
    t.check('saving it blank goes back to the default', comments.loadYearEndOpening('2026').indexOf('as we close out {year}') > -1);
    const stored = JSON.parse(localStorage.getItem('devCoachingTool_yearEndOpening') || '{}');
    t.check('and forgets the year rather than pinning a copy', !Object.prototype.hasOwnProperty.call(stored, '2026'));
});

suite('year-end opening: the page has the box, and it syncs', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    t.check('the opening box is on the page', html.indexOf('id="yearEndOpeningInput"') > -1);
    t.check('with a way back to the default', html.indexOf('id="yearEndOpeningResetBtn"') > -1);
    const sync = fs.readFileSync(path.join(ROOT, 'modules/repo-sync.module.js'), 'utf8');
    t.check('the store syncs like the other hand-typed ones', sync.indexOf("STORAGE_PREFIX + 'yearEndOpening'") > -1);
});
