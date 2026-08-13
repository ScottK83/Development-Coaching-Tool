'use strict';

const { suite } = require('./harness');

/**
 * "What's behind it" — the evidence panel under the day's message.
 *
 * Two things it used to get wrong. It stopped at four names without saying so,
 * which reads as "these four are all there were". And it had no answer at all
 * to "why isn't she in here", even though detectCelebrations works that out
 * every time and nothing ever rendered it.
 */

function loadPanel(t, result) {
    t.installFakeBrowser();
    const mods = t.loadModule('modules/my-team.module.js');
    global.window.DevCoachModules.celebrations = {
        detectCelebrations: () => result,
        describePlacement: (a) => `${a.value} — ${a.rank === 1 ? 'best' : a.rank + 'th'} in call center`,
        describeNoCelebration: (info) => info.sentence,
        perfectSurveyLine: (p) => `PERFECT surveys — all ${p.count} of them this week`
    };
    return mods.myTeam;
}

function winner(name, label, rank) {
    return { name, firstName: name, achievements: [{ key: 'fcr', label, rank, value: 90 }] };
}

suite('my team context: a list that stops early says so', (t) => {
    const many = [];
    for (let i = 0; i < 11; i++) many.push(winner('Person' + i, 'First Call Resolution', i + 1));

    const myTeam = loadPanel(t, {
        celebrations: many, missed: [], dateRange: 'Aug 10 - Aug 11', totalEmployees: 126
    });
    const html = myTeam.buildContextHtml(null);

    t.check('the period and the field are named', html.indexOf('126 associates scored in the center') > -1);
    t.check('the first name is listed', html.indexOf('Person0') > -1);
    t.check('the sixth is too', html.indexOf('Person5') > -1);
    t.check('the seventh is cut', html.indexOf('Person6') === -1);

    // Silently stopping is the bug. Stopping and saying so is fine.
    t.check('and the ones cut are counted out loud', html.indexOf('+ 5 more not shown') > -1);
    t.check('pointing at where all of them are', html.indexOf('has all 11') > -1);

    // A short list has nothing to say about a remainder that does not exist.
    const few = loadPanel(t, { celebrations: many.slice(0, 3), missed: [], totalEmployees: 126 });
    t.check('a list that fits says nothing about cuts',
        few.buildContextHtml(null).indexOf('more not shown') === -1);
});

suite('my team context: why somebody is not in here', (t) => {
    const myTeam = loadPanel(t, {
        celebrations: [winner('Oceane', 'Overall Sentiment', 1)],
        missed: [
            { name: 'Sabrina Ochoa', reason: 'thinVolume', sentence: 'Sabrina only took 11 calls this period.' },
            { name: 'Esther Salas', reason: 'belowTarget', sentence: 'Esther ranks #4 in Transfers, but 8.1 is short of target.' }
        ],
        totalEmployees: 126
    });
    const html = myTeam.buildContextHtml(null);

    // Folded shut on purpose. Listing near-misses inline under a row of winners
    // reads as calling somebody out for not making it.
    t.check('the reasons are behind a fold', html.indexOf('<details') > -1);
    t.check('labelled with how many there are', html.indexOf("Who didn't make it, and why (2)") > -1);
    t.check('each one saying which kind of miss it was', html.indexOf('only took 11 calls') > -1);
    t.check('including the one that is a coaching conversation', html.indexOf('short of target') > -1);

    // Nothing to explain means no empty fold to open.
    const clean = loadPanel(t, { celebrations: [winner('Oceane', 'Overall Sentiment', 1)], missed: [], totalEmployees: 126 });
    t.check('no misses means no fold', clean.buildContextHtml(null).indexOf('<details') === -1);
});

suite('my team context: a flawless survey week still gets a line', (t) => {
    // Carried by surveys alone, so there is no placing to print — the row was
    // being skipped outright rather than saying what earned it.
    const myTeam = loadPanel(t, {
        celebrations: [{ name: 'Matrece Bell', firstName: 'Matrece', achievements: [], perfectSurveys: { count: 3 } }],
        missed: [],
        totalEmployees: 126
    });
    const html = myTeam.buildContextHtml(null);

    t.check('they are named', html.indexOf('Matrece') > -1);
    t.check('and what earned it is said', html.indexOf('PERFECT surveys') > -1);
    t.check('rather than the panel claiming there is nothing to show',
        html.indexOf('Nothing standing out') === -1);
});
