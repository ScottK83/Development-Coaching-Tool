'use strict';

/**
 * raffle.html, the draw on its own for a shared screen.
 *
 * The page is only the show. Who wins has to come from contest.drawWinner,
 * the same draw the Contest panel runs, or the two could disagree about the
 * odds or let somebody win twice. And it must never write anything: it reads
 * the month from cloud storage and the sync settings from this browser.
 */

const fs = require('fs');
const path = require('path');
const { suite } = require('./harness');

const ROOT = path.join(__dirname, '..');

function page() {
    return fs.readFileSync(path.join(ROOT, 'raffle.html'), 'utf8');
}

suite('raffle page: the winner comes from the contest module', (t) => {
    const html = page();

    t.check('it loads the contest module', /modules\/contest\.module\.js/.test(html));
    t.check('it draws with drawWinner', /contest\(\)\.drawWinner\(/.test(html));
    t.check('and skips anyone already drawn', /drawWinner\([^)]*exclude:\s*drawn/.test(html));
    t.check('it has no draw of its own: crypto stays in the module', !/getRandomValues/.test(html));
});

suite('raffle page: it reads the saved month and writes nothing', (t) => {
    const html = page();

    t.check('it asks the worker for the month', /mode:\s*'contestGet'/.test(html));
    t.check('never for a save', !/contestSave/.test(html));
    t.check('it reads the same sync settings the app keeps',
        html.indexOf("'devCoachingTool_callListeningSyncConfig'") > -1);
    t.check('nothing is written to the browser', !/setItem\(|sessionStorage|indexedDB/.test(html));
    t.check('nothing is saved to the computer', !/\.download\s*=|createObjectURL/.test(html));
});
