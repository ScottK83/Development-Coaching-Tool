'use strict';

const { suite } = require('./harness');

/**
 * The whole-team high five.
 *
 * One at a time was the only way to run these, which for eighteen people meant
 * eighteen trips through the Who dropdown. The round writes them in one pass;
 * copying stays one at a time because that is how they get sent.
 */

function loadMyTeam(t, opts) {
    t.installFakeBrowser();
    global.window.DevCoachModules.periodIndex = { mondayOf: () => '2026-08-10' };
    if (opts.outreach !== false) t.loadModule('modules/daily-outreach.module.js');
    const mods = t.loadModule('modules/my-team.module.js');
    const M = global.window.DevCoachModules;

    if (opts.roster) M.teamScope = { getMyTeamRoster: () => opts.roster };
    if (opts.generate) {
        M.morningPulse = {
            resolveCheckinPeriods: () => ({ latestKey: 'wk', baselineKey: 'prev' }),
            generateHighFiveMessage: opts.generate
        };
    }
    return mods.myTeam;
}

suite('high five round: everybody at once, copied one at a time', async (t) => {
    const asked = [];
    const myTeam = loadMyTeam(t, {
        roster: ['Alyssa Dimes', 'Betty Yanez', 'Christi Reyes'],
        generate: async (name, latestKey, baselineKey) => {
            asked.push([name, latestKey, baselineKey].join('|'));
            // Betty had a week nothing can be said about.
            return name === 'Betty Yanez' ? '' : `Nice work this week, ${name}!`;
        }
    });

    const progress = [];
    const round = await myTeam.buildHighFiveRound((done, total, name) => progress.push(`${done}/${total} ${name}`));

    t.equal('everyone the week backs is ready', round.ready.length, 2);
    t.equal('and the message is theirs', round.ready[0].message, 'Nice work this week, Alyssa Dimes!');

    // A round of two against a roster of three looks like a bug unless the
    // third is named, so nobody is dropped silently.
    t.equal('the empty week is listed, not dropped', round.skipped.length, 1);
    t.equal('by name', round.skipped[0].name, 'Betty Yanez');

    t.equal('the whole roster was asked', asked.length, 3);
    t.equal('with the periods the pulse resolved', asked[0], 'Alyssa Dimes|wk|prev');

    // Eighteen of these is long enough that a still panel reads as a broken one.
    t.equal('progress is reported per person', progress.length, 3);
    t.equal('counting up to the roster size', progress[2], '3/3 Christi Reyes');
});

suite('high five round: one bad row does not take the rest with it', async (t) => {
    const myTeam = loadMyTeam(t, {
        roster: ['Alyssa Dimes', 'Betty Yanez', 'Christi Reyes'],
        generate: async (name) => {
            if (name === 'Betty Yanez') throw new Error('no data for Betty');
            return `Great week, ${name}!`;
        }
    });

    const round = await myTeam.buildHighFiveRound();

    t.equal('the other two still get theirs', round.ready.length, 2);
    t.equal('and the one that threw is skipped like any thin week', round.skipped.length, 1);
    t.equal('named so it can be chased', round.skipped[0].name, 'Betty Yanez');
});

suite('high five round: says which thing is missing', async (t) => {
    // No generator at all is a loading problem, not a data problem, and the two
    // call for completely different responses.
    const noModule = loadMyTeam(t, { roster: ['Alyssa Dimes'] });
    const a = await noModule.buildHighFiveRound();
    t.equal('a missing generator is named as one', a.blocked, 'noModule');
    t.equal('and nothing is claimed to be ready', a.ready.length, 0);

    const noRoster = loadMyTeam(t, { roster: [], generate: async () => 'hi' });
    const b = await noRoster.buildHighFiveRound();
    t.equal('an empty roster is its own answer', b.blocked, 'noRoster');

    const working = loadMyTeam(t, { roster: ['Alyssa Dimes'], generate: async () => 'Great week!' });
    const c = await working.buildHighFiveRound();
    t.equal('and a working round is blocked by nothing', c.blocked, null);
    t.equal('with the one person in it', c.ready.length, 1);
});

suite('high five round: the ticks survive a reload', async (t) => {
    const roster = ['Alyssa Dimes', 'Betty Yanez', 'Christi Reyes'];
    const myTeam = loadMyTeam(t, { roster, generate: async (name) => `Great week, ${name}!` });
    const outreach = global.window.DevCoachModules.dailyOutreach;
    const stamp = outreach.stampFor(outreach.PLANS.monday, { todayIso: outreach.isoDate(new Date()) });

    const first = await myTeam.buildHighFiveRound();
    t.check('nothing is ticked before anything is sent', first.ready.every((e) => !e.sent));

    // Copying is the send — there is no other button between the clipboard and
    // the chat window, so that is what gets logged.
    outreach.markSent('highfive', stamp, 'Betty Yanez', new Date().toISOString());

    // Rebuilding is what a reload does.
    const second = await myTeam.buildHighFiveRound();
    const byName = {};
    second.ready.forEach((e) => { byName[e.name] = e; });

    t.check('the one already sent comes back ticked', byName['Betty Yanez'].sent === true);
    t.check('and the others do not', byName['Alyssa Dimes'].sent === false);
    t.check('nor the third', byName['Christi Reyes'].sent === false);

    // Undoing one has to leave the rest alone.
    outreach.clearSent('highfive', stamp, 'Betty Yanez');
    const third = await myTeam.buildHighFiveRound();
    t.check('clearing one clears only that one', third.ready.every((e) => !e.sent));

    // The high five shares the log with the day posts but not the plan id, so
    // a Tuesday post must never tick a high five.
    outreach.markSent('tuesday', stamp, 'Alyssa Dimes', new Date().toISOString());
    const fourth = await myTeam.buildHighFiveRound();
    t.check('a day post does not tick the high five',
        fourth.ready.find((e) => e.name === 'Alyssa Dimes').sent === false);
});

suite('high five round: works without the send log, it just forgets', async (t) => {
    // The log is a convenience. Losing it must not cost you the round itself.
    const myTeam = loadMyTeam(t, {
        outreach: false,
        roster: ['Alyssa Dimes'],
        generate: async (name) => `Great week, ${name}!`
    });

    const round = await myTeam.buildHighFiveRound();
    t.equal('the message is still written', round.ready.length, 1);
    t.check('it just cannot remember being sent', round.ready[0].sent === false);
    t.equal('and nothing is reported as blocked', round.blocked, null);
});
