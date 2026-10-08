'use strict';

const { suite } = require('./harness');

/**
 * Messages speak in the tense of the period they describe.
 *
 * Scott, 2026-10-07: a week in progress went out as "went absolutely off".
 * A stretch that is still running is talked about in the present ("is going
 * absolutely OFF"), one that has ended in the past. And the hype sayings are
 * a shared library of fifty, each written both ways, so the posts stay varied
 * without ever picking up the wrong tense.
 */

function loadVoice(t) {
    t.installFakeBrowser();
    t.loadModule('modules/message-voice.module.js');
    return global.window.DevCoachModules.messageVoice;
}

suite('message tense: fifty sayings, each written both ways', (t) => {
    const voice = loadVoice(t);
    const HYPE = voice.HYPE;

    t.check('there are at least fifty', HYPE.length >= 50);
    t.equal('and no two say the same thing', new Set(HYPE.map((h) => h.done)).size, HYPE.length);
    t.equal('in either tense', new Set(HYPE.map((h) => h.ing)).size, HYPE.length);

    HYPE.forEach((h) => {
        t.check(`"${h.done}" has both forms`, Boolean(h.done && h.ing));
        // Words tied to one subject would break after a name, "You" or "Some
        // of our people".
        t.check(`"${h.done}" / "${h.ing}" fits any subject`,
            !/\b(was|were|their|his|her|your)\b/i.test(h.done + ' ' + h.ing));
        // Safe for the high five, which must never carry a placing.
        t.check(`"${h.done}" names no placing`, !/#\d|\brank|\bbest in\b|\bbetter than\b/i.test(h.done + ' ' + h.ing));
        t.check(`"${h.done}" has no em dash`, !/[–—]/.test(h.done + h.ing));
    });

    const first = HYPE[0];
    t.equal('a finished period, after a name', voice.hype('@Ada', false, { entry: first }), '@Ada went absolutely OFF');
    t.equal('a running one', voice.hype('@Ada', true, { entry: first }), '@Ada is going absolutely OFF');
    t.equal('after You', voice.hype('You', true, { entry: first }), 'You\'re going absolutely OFF');
    t.equal('after a group', voice.hype('Some of our people', true, { entry: first, plural: true }),
        'Some of our people are going absolutely OFF');

    const walk = voice.hypeRotator();
    const seen = new Set();
    for (let i = 0; i < HYPE.length; i++) seen.add(walk('@Ada', false));
    t.equal('the rotator uses every saying before repeating one', seen.size, HYPE.length);
});

suite('message tense: which periods are still running', (t) => {
    const voice = loadVoice(t);
    t.check('a week in progress is running', voice.isOngoingPeriod('week-in-progress', '2026-08-17'));
    t.check('a month to date is running', voice.isOngoingPeriod('month-to-date', '2026-08-17'));
    t.check('a year to date is running', voice.isOngoingPeriod('ytd', '2026-08-16'));
    t.check('until it reaches December 31', !voice.isOngoingPeriod('ytd', '2025-12-31'));
    ['week', 'month', 'month-agg', 'quarter', 'daily'].forEach((type) => {
        t.check(`a ${type} upload is finished`, !voice.isOngoingPeriod(type, '2026-08-14'));
    });
});

suite('message tense: the check-in knows when the numbers are still coming in', (t) => {
    loadVoice(t);
    const pulse = t.loadModule('modules/morning-pulse.module.js').morningPulse;
    const now = new Date(2026, 7, 18, 12); // Tuesday 18 August 2026
    const recency = (periodType, endDate) =>
        pulse.describeWeekRecency(`x|${endDate}`, { metadata: { periodType, endDate } }, now);

    t.check('this week\'s week in progress is running', recency('week-in-progress', '2026-08-17').ongoing === true);
    t.check('last week\'s finished week is not', recency('week', '2026-08-14').ongoing === false);
    t.check('a week in progress from two weeks back is talked about as finished',
        recency('week-in-progress', '2026-08-07').ongoing === false);
    t.check('this month\'s month to date is running', recency('month-to-date', '2026-08-17').ongoing === true);
    t.check('last month\'s month to date is not', recency('month-to-date', '2026-07-31').ongoing === false);
    t.check('this year\'s year to date is running', recency('ytd', '2026-08-16').ongoing === true);
    t.check('a finished month is not', recency('month', '2026-07-31').ongoing === false);
    t.equal('and the words still come with it', recency('week-in-progress', '2026-08-17').when, 'this week');
});

suite('message tense: a shout-out for a running week never says it is over', (t) => {
    loadVoice(t);
    global.weeklyData = {
        'wip|2026-08-17': { metadata: { periodType: 'week-in-progress', endDate: '2026-08-17' }, employees: [] },
        'wk|2026-08-14': { metadata: { periodType: 'week', endDate: '2026-08-14' }, employees: [] }
    };
    global.ytdData = {};
    const cel = t.loadModule('modules/celebrations.module.js').celebrations;
    const voice = global.window.DevCoachModules.messageVoice;
    const person = () => ({ firstName: 'Ada', achievements: [{ key: 'aht', label: 'AHT', value: 300 }] });

    const doneOnly = /went absolutely OFF|showed up BIG|made a difference here|Put up |Posted |Took AHT|Hit 300|Finished the period|came in at|landed on|Closed out|just put on a CLINIC|showed up and showed OUT|came to WORK|Went OFF in|crushed it in| hit 300/;
    const ongoingOnly = /is going absolutely OFF|are showing up BIG|is making a difference here|Running at|Sitting at|Tracking at|is putting on a CLINIC|is bringing the WORK|Going OFF in/;
    const doneHype = voice.HYPE.map((h) => ' ' + h.done);
    const ingHype = voice.HYPE.map((h) => ' ' + h.ing);

    let open = '';
    let closed = '';
    for (let i = 0; i < 80; i++) {
        open += cel.generateAllShoutOuts([person()], '', 'wip|2026-08-17') + '\n';
        open += cel.generateShoutOut(person(), '', 'wip|2026-08-17') + '\n';
        closed += cel.generateAllShoutOuts([person()], '', 'wk|2026-08-14') + '\n';
        closed += cel.generateShoutOut(person(), '', 'wk|2026-08-14') + '\n';
    }

    t.check('the running week says nothing is over', !doneOnly.test(open));
    t.check('and uses none of the finished sayings', !doneHype.some((d) => open.includes(d + '.') || open.includes(d + '!')));
    t.check('the finished week never talks as though it is running', !ongoingOnly.test(closed));
    // Present-tense hype about a person ("is on FIRE!") is timeless and reads
    // fine after a finished week; the claims checked above are the ones that
    // describe the period itself.
    t.check('and its hype intro speaks in the past',
        !/ROLL CALL OF GREATNESS[^\n]*\n\nSome of our people are /.test(closed));
    t.check('the running week does speak in the present', ongoingOnly.test(open) || ingHype.some((d) => open.includes(d)));
});
