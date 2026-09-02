'use strict';

/**
 * Raffle entries for the September contest.
 *
 * Three ways to earn one: every perfect survey, every day at or above the
 * adherence target, and a week or the month averaging it. Weekly and monthly
 * stack, so a clean month pays out several times.
 *
 * The rule that matters most: entries are a pure function of the days that were
 * typed in. Re-entering a date has to correct it, never award twice, because
 * this decides who gets a gift card and a double entry is unfair in a way
 * nobody would notice.
 */

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/contest.module.js').contest;
}

// A month of typed-in days: { days: { date: { name: { adherence, perfectSurveys } } } }
function month(days) {
    return { days };
}

suite('contest: every perfect survey is its own entry', (t) => {
    const contest = load(t);

    const board = contest.buildLeaderboard(month({
        '2026-09-01': { 'Alyssa Dimes': { perfectSurveys: 3, adherence: 80 } },
        '2026-09-02': { 'Alyssa Dimes': { perfectSurveys: 1, adherence: 80 } }
    }));

    t.equal('four surveys, four entries', board[0].perfectSurvey, 4);
    // Adherence was below target on both days, so nothing else was earned.
    t.equal('and nothing else was awarded', board[0].total, 4);
});

suite('contest: a day at the target earns one entry, below it earns none', (t) => {
    const contest = load(t);
    t.equal('the target comes from the app, not a second copy', contest.adherenceTarget(), 93);

    const board = contest.buildLeaderboard(month({
        '2026-09-01': { 'Chris Vale': { adherence: 95 } },
        '2026-09-02': { 'Chris Vale': { adherence: 93 } },   // exactly on target
        '2026-09-03': { 'Chris Vale': { adherence: 92.9 } }  // just under
    }));

    t.equal('two qualifying days', board[0].dailyAdherence, 2);
});

suite('contest: the week and the month both pay, and they stack', (t) => {
    const contest = load(t);

    // A clean Monday to Friday: five daily entries, one weekly, one monthly.
    const days = {};
    ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].forEach((d) => {
        days[d] = { 'Dana Roe': { adherence: 96 } };
    });

    const board = contest.buildLeaderboard(month(days));
    const row = board[0];

    t.equal('five days', row.dailyAdherence, 5);
    t.equal('one week', row.weeklyAdherence, 1);
    t.equal('one month', row.monthlyAdherence, 1);
    t.equal('seven entries in total', row.total, 7);
});

suite('contest: a bad day can be carried by the rest of the week', (t) => {
    const contest = load(t);

    // Average is 93.4, so the week pays even though Wednesday did not.
    const board = contest.buildLeaderboard(month({
        '2026-09-07': { 'Sam Reed': { adherence: 97 } },
        '2026-09-08': { 'Sam Reed': { adherence: 97 } },
        '2026-09-09': { 'Sam Reed': { adherence: 82 } },
        '2026-09-10': { 'Sam Reed': { adherence: 96 } },
        '2026-09-11': { 'Sam Reed': { adherence: 95 } }
    }));

    t.equal('four days qualified on their own', board[0].dailyAdherence, 4);
    t.equal('and the week still pays', board[0].weeklyAdherence, 1);
});

suite('contest: weeks are Monday to Sunday and do not bleed into each other', (t) => {
    const contest = load(t);

    t.equal('a Monday is its own week start', contest.weekStartOf('2026-09-07'), '2026-09-07');
    t.equal('so is the Sunday that closes it', contest.weekStartOf('2026-09-13'), '2026-09-07');
    t.equal('and the next Monday starts a new one', contest.weekStartOf('2026-09-14'), '2026-09-14');

    // Two separate good weeks must pay twice, not once.
    const days = {};
    ['2026-09-07', '2026-09-08', '2026-09-14', '2026-09-15'].forEach((d) => {
        days[d] = { 'Jo Park': { adherence: 98 } };
    });
    t.equal('two weeks, two weekly entries',
        contest.buildLeaderboard(month(days))[0].weeklyAdherence, 2);
});

suite('contest: re-entering a day corrects it rather than awarding twice', (t) => {
    const contest = load(t);

    const data = month({ '2026-09-01': { 'Alyssa Dimes': { adherence: 95, perfectSurveys: 2 } } });
    const before = contest.buildLeaderboard(data)[0].total;

    // The same day typed again, this time with the real numbers. Because the
    // standings are computed from what is stored rather than accumulated as
    // they are earned, the correction simply replaces the day.
    data.days['2026-09-01'] = { 'Alyssa Dimes': { adherence: 88, perfectSurveys: 1 } };
    const after = contest.buildLeaderboard(data)[0];

    t.check('the first version left nothing behind', before !== after.total);
    t.equal('one perfect survey now', after.perfectSurvey, 1);
    t.equal('and the day no longer qualifies', after.dailyAdherence, 0);
});

suite('contest: a thin week shows the day count rather than hiding it', (t) => {
    const contest = load(t);

    // One logged day averages itself, so the week pays on a single day. That is
    // what an average with no minimum means, and the fix is to make it visible
    // rather than to invent a rule that was not asked for.
    const entries = contest.computeEntries(month({
        '2026-09-07': { 'Chris Vale': { adherence: 99 } }
    }));
    const weekly = entries.find((e) => e.reason === 'weekly-adherence');

    t.check('the week paid on one day', !!weekly);
    t.check('and says so', /across 1 day/.test(weekly.detail));
});

suite('contest: the draw is weighted by entries and can be checked', (t) => {
    const contest = load(t);

    const data = month({
        '2026-09-01': {
            'Alyssa Dimes': { perfectSurveys: 9, adherence: 50 },
            'Chris Vale': { perfectSurveys: 1, adherence: 50 }
        }
    });

    const pool = contest.computeEntries(data).length;
    t.equal('ten entries in the pool', pool, 10);

    // A fixed ticket makes the draw replayable, which is what lets anyone check
    // it rather than take it on trust.
    const first = contest.drawWinner(data, 0);
    t.equal('ticket zero is a real winner', first.associate, 'Alyssa Dimes');
    t.equal('and the pool size is reported', first.poolSize, 10);
    t.equal('with the odds held', first.odds, '9 of 10');

    const last = contest.drawWinner(data, 9);
    t.equal('the last ticket belongs to the other entrant', last.associate, 'Chris Vale');
    t.equal('holding one', last.entriesHeld, 1);

    t.equal('an empty contest has no winner', contest.drawWinner(month({}), 0), null);
});

suite('contest: the standings post names the reasons, not just the totals', (t) => {
    const contest = load(t);

    const days = {};
    ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].forEach((d) => {
        days[d] = { 'Dana Roe': { adherence: 96, perfectSurveys: 1 } };
    });

    const post = contest.buildStandingsPost(month(days), 'September');

    t.check('it names the person', post.indexOf('Dana Roe') > -1);
    t.check('it counts the perfect surveys', /5 perfect surveys/.test(post));
    t.check('it counts the days', /5 days on adherence/.test(post));
    t.check('and the week and month', /1 week/.test(post) && /the month/.test(post));
    t.check('it gives the pool size', /12 entries in the draw/.test(post));
    // House style: no em dashes anywhere in generated copy.
    t.check('and uses no em dashes', post.indexOf('—') === -1);
});

suite('contest: the feature is wired and self-contained', (t) => {
    const fs = require('fs');
    const path = require('path');
    const { ROOT } = require('./harness');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/\r\n/g, '\n');
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');
    const nav = fs.readFileSync(path.join(ROOT, 'modules/navigation.module.js'), 'utf8');

    t.check('there is a Contest button', html.indexOf('id="contestBtn"') > -1);
    t.check('and a section for it', html.indexOf('id="contestSection"') > -1);
    t.check('the button is wired', src.indexOf("getElementById('contestBtn')") > -1);
    t.check('and navigation knows the section', nav.indexOf('contestSection') > -1);

    // Both modules load, logic before panel.
    const logic = html.indexOf("'modules/contest.module.js'");
    const panel = html.indexOf("'modules/contest-ui.module.js'");
    t.check('both are in the manifest', logic > -1 && panel > -1);
    t.check('and the logic loads before its panel', logic < panel);

    // The panel is built in JS, so the shell stays small and the whole feature
    // is three files that lift out together when the month ends.
    const section = html.slice(html.indexOf('id="contestSection"'));
    t.check('the section ships empty', section.slice(0, 80).indexOf('</section>') > -1);

    // The contest keeps its own daily numbers. dailyData is purged the moment a
    // weekly upload covers those dates, which would delete entries already
    // earned.
    const registry = fs.readFileSync(path.join(ROOT, 'modules/store-registry.module.js'), 'utf8');
    t.check('it has its own store', registry.indexOf("name: 'contestData'") > -1);
    t.check('on the backend with no ceiling', /contestData', tier: 'data', backend: 'idb'/.test(registry));
});
