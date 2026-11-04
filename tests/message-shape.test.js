'use strict';

const { suite } = require('./harness');

/**
 * THE MONDAY AND TUESDAY MESSAGE SHAPE (many hats review, 2026-11-03)
 *
 * Praise, one focus, two standings bullets, and "Where the year stands" in
 * the first Monday or Tuesday message of the month only. The month rule reads
 * the send log, so it holds across computers and reloads.
 */

function load(t) {
    t.installFakeBrowser();
    const outreach = t.loadModule('modules/daily-outreach.module.js').dailyOutreach;
    const pulse = t.loadModule('modules/morning-pulse.module.js').morningPulse;
    return { outreach, pulse };
}

suite('message shape: the year block once a month', (t) => {
    const { outreach, pulse } = load(t);
    const nov4 = new Date(2026, 10, 4, 9);

    t.check('nothing sent yet this month, so the block goes in',
        !pulse.yearBlockSentThisMonth(outreach, 'Kai Moss', nov4));

    outreach.markSent('tuesday', '2026-10-26', 'Kai Moss', new Date(2026, 9, 27, 9).toISOString());
    t.check('a message last month does not count', !pulse.yearBlockSentThisMonth(outreach, 'Kai Moss', nov4));

    outreach.markSent('wednesday', '2026-11-02', 'Kai Moss', new Date(2026, 10, 4, 8).toISOString());
    t.check('nor does a Wednesday message, which never carries it',
        !pulse.yearBlockSentThisMonth(outreach, 'Kai Moss', nov4));

    outreach.markSent('highfive', '2026-11-02', 'Kai Moss', new Date(2026, 10, 3, 8).toISOString());
    t.check('nor a high five', !pulse.yearBlockSentThisMonth(outreach, 'Kai Moss', nov4));

    outreach.markSent('monday', '2026-11-02', 'Kai Moss', new Date(2026, 10, 2, 8).toISOString());
    t.check('a Monday message this month does', pulse.yearBlockSentThisMonth(outreach, 'Kai Moss', nov4));
    t.check('for that person only', !pulse.yearBlockSentThisMonth(outreach, 'Lee Park', nov4));
    t.check('and December starts over', !pulse.yearBlockSentThisMonth(outreach, 'Kai Moss', new Date(2026, 11, 1, 9)));
    t.check('with no send log there is no way to know, so it goes in', !pulse.yearBlockSentThisMonth(null, 'Kai Moss', nov4));
});

suite('message shape: the kickoff leaves the year block out when told', (t) => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'morning-pulse.module.js'), 'utf8');
    t.check('the kickoff skips the block on yearBlock false',
        /options\?\.yearBlock === false\s*\?\s*''/.test(src));
    t.check('and the private round asks the send log',
        /yearBlock: !yearBlockSentThisMonth\(outreach, employeeName\)/.test(src));
});
