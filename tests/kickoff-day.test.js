'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * A MESSAGE MUST NOT NAME A DAY THAT DID NOT HAPPEN
 *
 * Labor Day fell on Monday 7 September 2026, so the team came back on the
 * Tuesday. Scott ran the Tuesday follow-up and every associate was greeted
 * with "Monday's here Destiny!".
 *
 * Three plans share the kickoff generator: Monday, the Tuesday follow-up and
 * the weekend recap. Ten of its twelve openers named Monday outright, and it
 * had no way to be told otherwise. A message that opens by naming a day the
 * associate did not work is one she stops trusting on the first line, before
 * any of the numbers underneath get read.
 *
 * These read the pools out of the source rather than running the generator,
 * which needs a full period of uploaded metrics to say anything at all. What
 * is being pinned is the copy, and the copy is right here.
 */

const SOURCE = fs.readFileSync(path.join(ROOT, 'modules/morning-pulse.module.js'), 'utf8');

function poolBetween(startMarker, endMarker) {
    const start = SOURCE.indexOf(startMarker);
    const end = SOURCE.indexOf(endMarker, start);
    return SOURCE.slice(start, end);
}

suite('kickoff day: no opener hardcodes a weekday', (t) => {
    const weekStart = poolBetween('const MK_OPENERS_WEEK_START = [', '];');
    const midweek = poolBetween('const MK_OPENERS_MIDWEEK = [', '];');

    t.check('both pools were found', weekStart.length > 200 && midweek.length > 200);

    const DAYS = /\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/g;
    [['week start', weekStart], ['midweek', midweek]].forEach(([name, pool]) => {
        const named = (pool.match(DAYS) || []);
        t.equal(`the ${name} pool names no day literally (${named.join(', ') || 'clean'})`,
            named.length, 0);
    });

    // The day arrives as a value instead, so a week that opens on a Tuesday
    // says Tuesday.
    t.check('the week start pool takes the day', /\$\{day\}/.test(weekStart));
    t.check('and so does the midweek pool', /\$\{day\}/.test(midweek));
});

suite('kickoff day: the generator is told which day it is for', (t) => {
    t.check('it takes options',
        /async function generateMondayKickoffMessage\(employeeName, latestKey, baselineKey, options\)/.test(SOURCE));
    t.check('it reads the day word', /options\.dayWord/.test(SOURCE));
    t.check('and whether that day opens the week',
        /options\?\.startsTheWeek !== false/.test(SOURCE));

    // No options at all is the standalone kickoff button, which is genuinely
    // Monday and genuinely opens the week. That path must not change.
    t.check('no options still means Monday opening the week',
        /options \? String\(options\.dayWord \|\| ''\)\.trim\(\) : 'Monday'/.test(SOURCE));

    t.check('the pool is chosen from it',
        /startsTheWeek \? MK_OPENERS_WEEK_START : MK_OPENERS_MIDWEEK/.test(SOURCE));
});

suite('kickoff day: a Tuesday with no Monday is the start of the week', (t) => {
    // The case that produced the bug. A Tuesday holding Monday's numbers is a
    // follow-up. A Tuesday with no Monday at all, because nobody worked it, is
    // where the week actually starts and should open like it.
    t.check('the call site decides it from the Monday row',
        /plan\.id === 'monday'\s*\|\|\s*\(plan\.id === 'tuesday' && !dailyEntry\?\.mondayRow\)/.test(SOURCE));

    t.check('and hands the day word over with it',
        /dayWord: dayWordFor\(plan\)/.test(SOURCE));
});

suite('kickoff day: the weekend recap names no day at all', (t) => {
    const helper = poolBetween('function dayWordFor(plan)', '\n    }');

    t.check('the helper was found', helper.length > 50);
    t.check('weekend is not given a weekday', !/weekend: '\w+day'/.test(helper));
    t.check('an unknown plan gets no word', /\|\| ''/.test(helper));

    // With no day to name, the openers that name one drop out of the pool
    // rather than inventing one, which is where this started.
    t.check('a missing day filters the pool',
        /dayWord \? pool : pool\.filter\(line => line\.length < 2\)/.test(SOURCE));
});

suite('kickoff day: the midweek recall does not claim a Monday conversation', (t) => {
    const recall = poolBetween('const MW_FOCUS_RECALL = [', '];');

    t.check('the pool was found', recall.length > 200);

    // Three lines said the focus was set on Monday. On a week that opened on a
    // Tuesday that is a claim about a conversation that never happened.
    const named = (recall.match(/\b(Monday|Tuesday|Wednesday|Thursday|Friday)\b/g) || []);
    t.equal(`no line names the day the focus was set (${named.join(', ') || 'clean'})`,
        named.length, 0);

    // The pool still has to be big enough to be worth picking from.
    t.check('and there are still plenty of ways to say it',
        (recall.match(/\(label\) =>/g) || []).length >= 15);
});

suite('kickoff day: the house rules still hold on the new copy', (t) => {
    const pools = poolBetween('const MK_OPENERS_WEEK_START = [', 'const MK_TRANSITION');

    const dashed = pools.split('\n').filter((line) => /[—–]/.test(line));
    t.equal(`no em dashes (${dashed.join(' | ') || 'clean'})`, dashed.length, 0);

    const patronising = pools.split('\n').filter((line) =>
        /if you'?re new|as you learn|remember to always/i.test(line));
    t.equal('nothing talks down to her', patronising.length, 0);
});
