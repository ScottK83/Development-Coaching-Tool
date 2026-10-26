'use strict';

const { suite } = require('./harness');

/**
 * HOW THE CELEBRATIONS READ
 *
 * Scott, 2026-10-14: "Think about the wording. See if it comes off natural,
 * celebratory, goal focused if not meeting, etc. Think of the way they would
 * receive the info. Offer lots of kudos and praise. Make sure the numbers are
 * simplified, and easy to read as well."
 *
 * A smoke test of 1,126 generated messages found the team post carrying a
 * median of thirty emojis, one person on eleven lines, a #1 shrunk by its own
 * tie count, one survey celebrated as two wins, "hit" over windows still
 * running and "All 2 of them". The pools are random, so every check here draws
 * many messages rather than trusting one.
 */

const RUNNING_WEEK = '2026-10-12|2026-10-14';
const DONE_WEEK = '2026-10-05|2026-10-11';
const MONTH_SO_FAR = '2026-10-01|2026-10-13';
const DONE_MONTH = '2026-09-01|2026-09-30';
const RUNNING = [RUNNING_WEEK, MONTH_SO_FAR];
const FINISHED = [DONE_WEEK, DONE_MONTH];
const DRAWS = 60;

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/highlights.module.js');
    t.loadModule('modules/message-voice.module.js');
    const meta = (key, periodType) => ({
        metadata: { periodType, startDate: key.split('|')[0], endDate: key.split('|')[1] }, employees: []
    });
    global.weeklyData = {};
    global.weeklyData[RUNNING_WEEK] = meta(RUNNING_WEEK, 'week-in-progress');
    global.weeklyData[DONE_WEEK] = meta(DONE_WEEK, 'week');
    global.weeklyData[MONTH_SO_FAR] = meta(MONTH_SO_FAR, 'month-to-date');
    global.weeklyData[DONE_MONTH] = meta(DONE_MONTH, 'month');
    global.ytdData = {};
    global.dailyData = {};
    const mods = t.loadModule('modules/celebrations.module.js');
    return { cel: mods.celebrations, voice: mods.messageVoice };
}

function win(key, label, value, rank, tied, extra) {
    const tiedCount = tied || 1;
    return Object.assign({
        key, label, value, rank, tiedCount, rankedCount: 124,
        soloRank1: rank === 1 && tiedCount === 1,
        betterThan: Math.max(0, 124 - (rank - 1) - tiedCount)
    }, extra || {});
}

// The shapes the smoke test tripped on, in one team.
function team() {
    return [
        { name: 'Kristin Villela', firstName: 'Kristin', perfectSurveys: { count: 1, periodNoun: 'this month' }, achievements: [
            // One survey, tied for #1 with sixteen others, under the CX floor.
            win('associateOverall', 'Rep Satisfaction', 100, 1, 17, { thin: true, surveys: 1 }),
            win('negativeWord', 'Avoid Negative Words', 99.3, 1, 1),
            win('transfers', 'Transfers', 4.5, 4, 1),
            win('aht', 'Average Handle Time', 409, 6, 1),
            win('managingEmotions', 'Managing Emotions', 100, 10, 2),
            win('positiveWord', 'Positive Word Usage', 95.8, 12, 1)
        ] },
        { name: 'Marcus Lee', firstName: 'Marcus', perfectSurveys: { count: 2, periodNoun: 'this month' }, achievements: [
            win('adherence', 'Schedule Adherence', 98, 3, 1)
        ] },
        { name: 'Esperanza Ruiz', firstName: 'Esperanza', perfectSurveys: null, achievements: [
            win('sentiment', 'Overall Sentiment', 93, 1, 1),
            win('fcr', 'First Call Resolution', 88.2, 9, 1)
        ] },
        // A thin Rep Sat win with no perfect-survey line to carry it.
        { name: 'Dana Roe', firstName: 'Dana', perfectSurveys: null, achievements: [
            win('associateOverall', 'Rep Satisfaction', 100, 1, 17, { thin: true, surveys: 1 }),
            win('negativeWord', 'Avoiding Negative Words', 99.3, 1, 1)
        ] }
    ];
}

function everything(cel, keys, draws) {
    const out = { team: [], single: [], dm: [] };
    keys.forEach((key) => {
        for (let i = 0; i < (draws || DRAWS); i++) {
            out.team.push(cel.generateAllShoutOuts(team(), 'Oct 5, 2026 - Oct 11, 2026', key));
            team().forEach((p) => {
                out.single.push(cel.generateShoutOut(p, 'Oct 5, 2026 - Oct 11, 2026', key));
                out.dm.push(cel.generateDirectMessage(p, 'Oct 5, 2026 - Oct 11, 2026', key));
            });
        }
    });
    return out;
}

suite('celebrate voice: two emojis a message, the channel post included', (t) => {
    const { cel, voice } = load(t);
    const all = everything(cel, RUNNING.concat(FINISHED));

    const worst = (list) => Math.max.apply(null, list.map((m) => voice.countEmojis(m)));
    t.check('the team post never carries more than two (worst ' + worst(all.team) + ')', worst(all.team) <= 2);
    t.check('nor the one-person shout-out (worst ' + worst(all.single) + ')', worst(all.single) <= 2);
    t.check('nor the private message (worst ' + worst(all.dm) + ')', worst(all.dm) <= 2);

    // Trimmed at the source, not only by the limiter: with message-voice gone
    // the pools still hold the line.
    delete global.window.DevCoachModules.messageVoice;
    const bare = cel.generateAllShoutOuts(team(), '', DONE_WEEK);
    t.check('the pools themselves hold to two', voice.countEmojis(bare) <= 2);
    t.check('and the post still writes without the limiter', bare.indexOf('@Kristin') > -1);

    // Every bullet is plain, and no name wears a crown or a medal.
    const lines = all.team.join('\n').split('\n');
    t.check('no bullet opens on an emoji', lines.filter((l) => l.indexOf('• ') === 0)
        .every((l) => voice.countEmojis(l.slice(0, 4)) === 0));
    const nameLines = lines.filter((l) => /@[A-Z][a-z]+$/.test(l) && l.indexOf('•') === -1);
    t.check('name lines were found', nameLines.length > 0);
    t.check('no name is decorated', nameLines.every((l) => l.charAt(0) === '@'));
});

suite('celebrate voice: the channel post is short enough to read', (t) => {
    const { cel } = load(t);
    for (let i = 0; i < DRAWS; i++) {
        const post = cel.generateAllShoutOuts(team(), 'Oct 5, 2026 - Oct 11, 2026', i % 2 ? DONE_WEEK : MONTH_SO_FAR);
        const blocks = post.split('\n@').slice(1);
        const tooLong = blocks.find((b) => (b.match(/^• /gm) || []).length > 3);
        if (tooLong) { t.check('nobody gets more than three lines, but: ' + tooLong, false); return; }
    }
    t.check('nobody gets more than three lines', true);

    const post = cel.generateAllShoutOuts(team(), '', DONE_WEEK);
    const kristin = post.split('\n@').find((b) => b.indexOf('Kristin') === 0);
    // Six wins: the perfect survey, two placings, the rest counted in one line.
    // Her lowest left off is 12th, so the line claims Top 15 and no more.
    t.check('what is left over is counted, not dropped', /\nPlus 3 more Top 15 finishes!/.test(kristin));
    t.equal('one more is a finish, not finishes', cel.moreLine([{ rank: 7 }]), 'Plus 1 more Top 10 finish!');
    t.equal('and leftover top spots stay top spots', cel.moreLine([{ rank: 1 }, { rank: 1 }]),
        'Plus 2 more that are the best in the Call Center!');
    t.equal('nothing left over says nothing', cel.moreLine([]), '');

    const single = cel.generateShoutOut(team()[0], '', DONE_WEEK);
    t.check('the one-person shout-out is capped the same way', (single.match(/^• /gm) || []).length === 3
        && single.indexOf('Plus 3 more Top 15 finishes!') > -1);
});

suite('celebrate voice: the public post names placings, never counts', (t) => {
    const { cel } = load(t);
    const all = everything(cel, RUNNING.concat(FINISHED), 20);
    const publicText = all.team.concat(all.single).join('\n');

    t.check('no beaten-count in public', !/better than \d+ of \d+/i.test(publicText));
    // "Tied for #1 in the Call Center. (one of 17 associates at 100.0%)" shrank
    // a #1 in front of the team, and "Top 10! (one of 2...)" said a tie twice.
    t.check('no tie count in public', !/one of \d+ associates/.test(publicText));
    t.check('a shared spot still says it is shared', publicText.indexOf('Tied for the best in the Call Center') > -1);
    t.check('and the placings are there', publicText.indexOf('the best in the Call Center') > -1
        && publicText.indexOf('4th best in the Call Center') > -1);
    t.check('numbers drop a trailing .0', publicText.indexOf('100.0%') === -1 && publicText.indexOf('93%') > -1);
});

suite('celebrate voice: one survey is one win', (t) => {
    const { cel } = load(t);
    const people = team();

    for (let i = 0; i < DRAWS; i++) {
        const post = cel.generateAllShoutOuts(people, '', DONE_WEEK);
        const kristin = post.split('\n@').find((b) => b.indexOf('Kristin') === 0);
        if (kristin.indexOf('Rep Satisfaction') > -1) {
            t.check('a perfect survey line carries a thin Rep Sat win alone, but: ' + kristin, false);
            return;
        }
        const dana = post.split('\n@').find((b) => b.indexOf('Dana') === 0);
        if (!/Rep Satisfaction at 100% on 1 survey!/.test(dana)) {
            t.check('without one, the Rep Sat line names its survey count, but: ' + dana, false);
            return;
        }
    }
    t.check('the perfect-survey line carries the thin Rep Sat win on its own', true);
    t.check('and a thin Rep Sat win standing alone names its one survey', true);

    const dm = cel.generateDirectMessage(people[3], '', DONE_WEEK);
    const repSat = dm.split('\n').find((l) => l.indexOf('Rep Satisfaction') > -1);
    t.check('the private line names the survey count', /on 1 survey\./.test(repSat));
    t.check('and makes no beaten-count claim off one survey', !/better than/.test(repSat));
});

suite('celebrate voice: the private message speaks in the window\'s tense', (t) => {
    const { cel } = load(t);
    let running = '';
    let finished = '';
    const dms = [];
    for (let i = 0; i < DRAWS; i++) {
        team().forEach((p) => {
            RUNNING.forEach((k) => { const m = cel.generateDirectMessage(p, '', k); dms.push(m); running += m + '\n'; });
            FINISHED.forEach((k) => { const m = cel.generateDirectMessage(p, '', k); dms.push(m); finished += m + '\n'; });
        });
    }

    // 120 of 132 messages over running windows said "hit".
    t.check('a running window never says "hit"', !/\bhit\b/.test(running));
    t.check('nor that it is over', !/came in at|landed at|You finished the|matched your|had a great run|stood out in a big way/.test(running));
    t.check('it speaks in the present', /is at |You're at |is sitting at |is matching your/.test(running));
    t.check('a finished window never talks as though it is running',
        !/ is at | is sitting at |You're at |is matching your|you're on a great run|right now/.test(finished));
    t.check('and does say it is over', /came in at|landed at|You finished the (week|month) at|matched your/.test(finished));

    // "Your Avoiding Negative Words hit 96.4%" is gone in either tense.
    t.check('no "Your <metric> hit"', !/Your [A-Z][A-Za-z ]+ hit /.test(running + finished));
    t.check('the solo line puts the number in the sentence',
        running.indexOf('Nobody else in the Call Center is matching your 99.3% on Avoiding Negative Words!') > -1);

    // One count per line: the tie count and the beaten-count used to share one.
    const lines = (running + finished).split('\n');
    t.check('no line carries a tie count and a beaten-count',
        !lines.some((l) => /one of \d+ associates/.test(l) && /better than/.test(l)));
    t.check('the beaten-count is still said', lines.some((l) => /, better than \d+ of 124 associates!$/.test(l)));

    // The opener and the intro both said "had to" in 21 of 288 messages.
    t.check('no opener says "had to"', dms.every((m) => m.split('\n')[0].indexOf('had to') === -1));
    t.check('so an opener and an intro never both do',
        !dms.some((m) => (m.split('\n\n')[0] + m.split('\n\n')[1]).split('had to').length > 2));
});

suite('celebrate voice: no robotic stems', (t) => {
    const { cel } = load(t);
    let finished = '';
    let running = '';
    for (let i = 0; i < DRAWS; i++) {
        finished += cel.generateAllShoutOuts(team(), '', DONE_WEEK) + '\n' + cel.generateShoutOut(team()[0], '', DONE_WEEK) + '\n';
        running += cel.generateAllShoutOuts(team(), '', MONTH_SO_FAR) + '\n' + cel.generateShoutOut(team()[0], '', MONTH_SO_FAR) + '\n';
    }
    const all = finished + running;

    t.check('no "and it holds up"', all.indexOf('holds up') === -1);
    t.check('no "All 2 of them"', all.indexOf('All 2 of them') === -1);
    t.check('two surveys are "Both of them"', all.indexOf('PERFECT surveys. Both of them this month') > -1);
    // Transfers is lower-is-better: "Took Transfers to 4.5%" read as a rise.
    t.check('a lower-is-better metric is never "taken to" a number', !/Took (Transfers|Average Handle Time) to/.test(all));
    t.check('nobody says "the period"', all.indexOf('the period') === -1);
    t.check('a finished week is named as a week when a stem names it',
        !/Finished the (month|period) at/.test(finished));
    t.check('one name per metric', all.indexOf('Avoid Negative Words') === -1);
    t.check('VICTORY LAP never opens a running window', running.indexOf('VICTORY LAP') === -1);

    // Every line of the one-person shout-out was "🌟 X hit Y!".
    const shapes = new Set();
    for (let i = 0; i < DRAWS; i++) {
        const single = cel.generateShoutOut(team()[0], '', DONE_WEEK);
        const line = single.split('\n').find((l) => l.indexOf('4.5%') > -1);
        if (line) shapes.add(line);
    }
    t.check('the one-person shout-out words a win more than one way', shapes.size >= 4);
    t.check('and none of them is "X hit Y!"', Array.from(shapes).every((l) => !/[a-z] hit \d/.test(l)));
});

suite('celebrate voice: one post never hands two people the same tail', (t) => {
    const { cel } = load(t);
    const tail = /The best in the Call Center[.,]? ?(.*)$/;
    for (let i = 0; i < DRAWS; i++) {
        const post = cel.generateAllShoutOuts(team(), '', i % 2 ? DONE_WEEK : RUNNING_WEEK);
        const tails = post.split('\n').filter((l) => /^• .*The best in the Call Center/.test(l) && !/Tied for/.test(l))
            .map((l) => (tail.exec(l) || [])[1]);
        if (new Set(tails).size !== tails.length) {
            t.check('every solo tail in a post is different, but got ' + JSON.stringify(tails), false);
            return;
        }
    }
    t.check('every solo tail in a post is different', true);
});

suite('celebrate voice: the date is said the way a person says it', (t) => {
    const { cel } = load(t);

    t.equal('a week', cel.friendlyRange('Oct 5, 2026 - Oct 11, 2026', ''), 'Oct 5 to 11');
    t.equal('read off the key when there is one', cel.friendlyRange('', '2026-10-05|2026-10-11'), 'Oct 5 to 11');
    t.equal('a week across two months', cel.friendlyRange('', '2026-09-28|2026-10-04'), 'Sep 28 to Oct 4');
    t.equal('a whole month is its name', cel.friendlyRange('Sep 1, 2026 - Sep 30, 2026', '2026-09-01|2026-09-30'), 'September');
    t.equal('a month so far is its days', cel.friendlyRange('', '2026-10-01|2026-10-13'), 'Oct 1 to 13');
    t.equal('a single day', cel.friendlyRange('', '2026-10-13|2026-10-13'), 'Oct 13');
    t.equal('the short range form too', cel.friendlyRange('Jul 27 - Aug 2, 2026', ''), 'Jul 27 to Aug 2');
    t.equal('and anything else keeps its words, without the hyphen', cel.friendlyRange('Week 41 - so far', ''), 'Week 41 to so far');

    const post = cel.generateAllShoutOuts(team(), 'Oct 5, 2026 - Oct 11, 2026', DONE_WEEK);
    const top = post.split('\n');
    t.equal('the date sits straight under the heading', top[1], 'Oct 5 to 11');
    t.check('with no calendar emoji', post.indexOf('📅') === -1);
});

/* Scott, 2026-10-26: "Any time I send a message, I want to make sure it has a
   natural speaking tone." "#1" is written, not said; "4th best in the Call
   Center. Top 5!" says the placing twice; "They set the bar" under @Ada reads
   as somebody else; "That's #1 out of 124 associates" closed 1,666 DMs. */
suite('celebrate voice: placings are said, once, and never as "#1"', (t) => {
    const { cel } = load(t);
    for (let i = 0; i < DRAWS; i++) {
        const week = i % 2 ? DONE_WEEK : RUNNING_WEEK;
        const post = cel.generateAllShoutOuts(team(), '', week);
        if (/#\d/.test(post)) { t.check('no "#" placing in the team post: ' + post, false); return; }
        if (/(best in the Call Center|the best in the Call Center)[.!]? Top \d+!/.test(post)) {
            t.check('no badge repeating the placing: ' + post, false); return;
        }
        const solo = post.split('\n').filter((l) => /The best in the Call Center/.test(l));
        if (solo.some((l) => /\b(they|them|their|theirs)\b/i.test(l))) {
            t.check('no "they" about an @name: ' + solo.join(' | '), false); return;
        }
        const one = cel.generateShoutOut(team()[0], '', week);
        if (/#\d/.test(one)) { t.check('no "#" placing in the single shout-out: ' + one, false); return; }
        const dm = cel.generateDirectMessage(team()[0], '', week);
        if (/#\d/.test(dm)) { t.check('no "#" placing in the DM: ' + dm, false); return; }
    }
    t.check('the post, the shout-out and the DM say placings out loud', true);
});

suite('celebrate voice: a DM does not say the same idea twice', (t) => {
    const { cel } = load(t);
    let doubled = '';
    for (let i = 0; i < 200 && !doubled; i++) {
        const dm = cel.generateDirectMessage(team()[0], '', i % 2 ? DONE_WEEK : RUNNING_WEEK);
        if ((dm.match(/hear(d)? (it|this) from me/gi) || []).length > 1) doubled = dm;
        if ((dm.match(/reach(ing)? out/gi) || []).length > 1) doubled = dm;
    }
    t.check('"hear it from me" and "reach out" once at most' + (doubled ? ': ' + doubled : ''), !doubled);
});
