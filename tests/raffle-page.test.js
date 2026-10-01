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

suite('raffle page: the Contest panel links to it', (t) => {
    const ui = fs.readFileSync(path.join(ROOT, 'modules/contest-ui.module.js'), 'utf8');

    t.check('there is a link to the raffle screen', /id="contestRaffleLink" href="raffle"/.test(ui));
    t.check('it opens in its own tab', /id="contestRaffleLink"[^>]*target="_blank"/.test(ui));
    t.check('and carries the month on screen when it has tickets', /'raffle\?month=' \+ monthKey/.test(ui));
});

suite('raffle page: the sound is resumed, not left paused', (t) => {
    const html = page();

    // A browser can start page audio paused, and a paused context plays
    // nothing without saying why. That was the "no sound" on 2026-09-30.
    t.check('it resumes a suspended context', /state === 'suspended'[^\n]*resume\(\)/.test(html));
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
