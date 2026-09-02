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

    // Nothing is stored in the browser. The panel reads and writes R2 directly,
    // so the numbers live in one place and the machine that typed them stops
    // mattering.
    const registry = fs.readFileSync(path.join(ROOT, 'modules/store-registry.module.js'), 'utf8');
    t.check('it has no browser store', registry.indexOf("name: 'contestData'") === -1);

    const ui = fs.readFileSync(path.join(ROOT, 'modules/contest-ui.module.js'), 'utf8');
    t.check('it reads from cloud storage', ui.indexOf("mode: 'contestGet'") > -1);
    t.check('and writes to it', ui.indexOf("mode: 'contestSave'") > -1);
    t.check('it never touches the storage module', ui.indexOf('saveWithSizeCheck') === -1 && ui.indexOf('readStore') === -1);
    t.check('and never touches localStorage', ui.indexOf('localStorage') === -1);
});

suite('contest: a late survey added to an earlier day just adds entries', (t) => {
    const contest = load(t);

    // Monday as it was known on Monday: adherence in, no surveys yet.
    const data = month({
        '2026-09-07': { 'Alyssa Dimes': { adherence: 96 } },
        '2026-09-08': { 'Alyssa Dimes': { adherence: 95 } }
    });
    const before = contest.buildLeaderboard(data)[0];
    t.equal('two days on adherence', before.dailyAdherence, 2);
    t.equal('and no survey entries yet', before.perfectSurvey, 0);

    // Thursday: the survey for Monday's call finally lands, and gets recorded
    // against Monday because that is the day it was sent out.
    data.days['2026-09-07']['Alyssa Dimes'].perfectSurveys = 2;
    const after = contest.buildLeaderboard(data)[0];

    t.equal('the surveys now count', after.perfectSurvey, 2);
    // Backfilling must not disturb what was already earned. Adherence is known
    // on the day and never changes, so the day, week and month awards are
    // untouched by a survey arriving late.
    t.equal('the adherence days are unchanged', after.dailyAdherence, before.dailyAdherence);
    t.equal('and so is the week', after.weeklyAdherence, before.weeklyAdherence);
    t.equal('total went up by exactly the surveys', after.total, before.total + 2);
});

suite('contest: editing one team does not wipe the rest of that day', (t) => {
    const fs = require('fs');
    const path = require('path');
    const { ROOT } = require('./harness');
    const ui = fs.readFileSync(path.join(ROOT, 'modules/contest-ui.module.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = ui.indexOf('async function saveDay');
    const body = ui.slice(start, start + 2400);

    // A day is revisited days later to add surveys that arrived late. If that
    // revisit happens with a different team selected, rebuilding the day from
    // the visible rows would delete everyone not on screen.
    t.check('the save starts from what is already stored for that date',
        /const day = Object\.assign\(\{\}, month\.days\[date\] \|\| \{\}\)/.test(body));
    t.check('and a visible person with both boxes empty is still removed',
        /delete day\[name\]/.test(body));
    t.check('rather than starting from an empty object',
        body.indexOf('const day = {};') === -1);
});

// ============================================
// THE POSTABLE TEXT
// ============================================
//
// The graphic carries the standings, so the post's job is to frame the pool,
// name who is out front, and give somebody sitting on zero tickets a reason to
// go earn one. These tests pin the parts that would quietly go wrong: a tie at
// the top, the team filter, and the house rules on what a public post may say.

suite('contest: the post names who is out front without counting who they beat', (t) => {
    const contest = load(t);

    const post = contest.buildTeamPost(month({
        '2026-09-01': { 'Dana Roe': { perfectSurveys: 4 }, 'Chris Vale': { perfectSurveys: 1 } }
    }), { monthLabel: 'September', openerIndex: 0, closerIndex: 0 });

    t.check('it names the leader', post.indexOf('Dana Roe') > -1);
    t.check('with their count', /out front with 4 tickets/.test(post));
    t.check('and says how many people are on the board', /2 of you have tickets/.test(post));

    // House rule: a placing may go in the channel, a beaten-count may not.
    t.check('it never says who anybody beat', !/better than \d+ of \d+/.test(post));
    t.check('and never quotes a person\'s odds', post.indexOf(' of 5') === -1);
});

suite('contest: a tie at the top is not handed to one person', (t) => {
    const contest = load(t);

    // Early in the month several people sit on one ticket each. Picking one of
    // them as "out front" is simply false, and it is the first thing the people
    // tied with them would notice.
    const post = contest.buildTeamPost(month({
        '2026-09-01': { 'A Bee': { perfectSurveys: 1 }, 'C Dee': { perfectSurveys: 1 }, 'E Eff': { perfectSurveys: 1 } }
    }), { openerIndex: 0, closerIndex: 0 });

    t.check('it says they are tied', /3 people are tied out front with 1 ticket each/.test(post));
    t.check('and does not crown one of them', post.indexOf('is out front with') === -1);
});

suite('contest: the post covers the team that was picked, not the whole center', (t) => {
    const contest = load(t);

    // buildLeaderboard is not team scoped, so a post built without the name
    // list would show all 127 people when the supervisor picked their own 18.
    const both = month({
        '2026-09-01': { 'Mine One': { perfectSurveys: 5 }, 'Theirs Two': { perfectSurveys: 99 } }
    });

    const mine = contest.buildTeamPost(both, { names: ['Mine One'], openerIndex: 0, closerIndex: 0 });

    t.check('the other team is not named', mine.indexOf('Theirs Two') === -1);
    t.check('and the pool is only this team\'s tickets', /^5 tickets in the bowl/.test(mine));
    t.equal('a name list matching nobody produces no post',
        contest.buildTeamPost(both, { names: ['Ghost Person'] }), '');
});

suite('contest: the post follows house style', (t) => {
    const contest = load(t);
    const days = { '2026-09-01': { 'Dana Roe': { perfectSurveys: 2, adherence: 96 } } };

    // Every opener and closer, not just the pair that happened to be picked.
    for (let i = 0; i < 12; i += 1) {
        const post = contest.buildTeamPost(month(days), { openerIndex: i, closerIndex: i, monthLabel: 'September' });
        t.check('no em dashes in variant ' + i, post.indexOf('\u2014') === -1);
        t.check('the three ways to earn are always spelled out in variant ' + i,
            post.indexOf('A perfect survey is one ticket') > -1);
        t.check('and the target comes from the app in variant ' + i, /93% adherence/.test(post));
    }

    t.equal('an empty month produces no post', contest.buildTeamPost(month({}), {}), '');
});

// ============================================
// THE GRAPHIC
// ============================================
//
// A 900px light card, rasterised by html2canvas and pasted into Teams. The
// tests here pin the things that would be invisible until somebody had already
// posted the picture to a hundred people: a name rendered raw, a person quietly
// left off, a colour the dark theme would repaint, or a number that was typed
// rather than counted.

function graphicFor(contest, rows, options) {
    return contest.buildStandingsGraphicHtml(rows, Object.assign({
        monthLabel: '2026-09', target: 93, teamLabel: 'Team Scott'
    }, options || {}));
}

function row(name, total, parts) {
    return Object.assign({
        associate: name, total: total, perfectSurvey: total,
        dailyAdherence: 0, weeklyAdherence: 0, monthlyAdherence: 0, reasons: []
    }, parts || {});
}

suite('contest: the graphic leaves nobody off the board', (t) => {
    const contest = load(t);

    // The people on zero are the ones the card exists to reach, and
    // buildLeaderboard only ever returns earners. The roster is what puts them
    // on the board, so a card built with a roster must show all of them.
    const roster = ['Ann Zeta', 'Bob Young', 'Cal Xu', 'Dee Wren', 'Eve Vane'];
    const html = graphicFor(contest, [row('Ann Zeta', 6), row('Cal Xu', 2)], { names: roster });

    roster.forEach((name) => {
        t.check(name + ' is on the card', html.indexOf(name) > -1);
    });
    t.check('and the people on zero are told the slot is open', /No tickets yet\. The slot is open\./.test(html));

    // A placing is public. "You are last of five" is not something this card
    // should ever say, so a person on zero gets no rank numeral at all.
    const ranks = (html.match(/>(\d+)<\/div>/g) || []).join(' ');
    t.check('nobody on zero is given a placing', ranks.indexOf('>5<') === -1);
});

suite('contest: the graphic covers the team that was picked', (t) => {
    const contest = load(t);

    const html = graphicFor(contest, [row('Mine One', 5), row('Theirs Two', 99)], { names: ['Mine One'] });

    t.check('the picked team is there', html.indexOf('Mine One') > -1);
    t.check('the rest of the center is not', html.indexOf('Theirs Two') === -1);
    t.check('and the pool counts only this team', html.indexOf('>5<') > -1);
});

suite('contest: the graphic survives the dark theme and hostile names', (t) => {
    const contest = load(t);

    const html = graphicFor(contest, [row("O'Brien-McAllister", 4), row('<script>alert(1)</script>', 2)]);

    // styles-v2.css repaints any inline `background: #f`, `#e`, `#d`, `#fff` or
    // `white` and forces light text, app-wide, when data-theme is dark. The
    // caller strips data-theme in the html2canvas clone; writing every colour
    // rgb() means the background half cannot match even if that caller changes.
    t.check('no hex colours to repaint', !/background:\s*#/.test(html));
    t.check('no theme variables', html.indexOf('var(--') === -1);

    t.check('a script tag in a name is inert', html.indexOf('<script>') === -1);
    t.check('and the name still shows', html.indexOf('&lt;script&gt;') > -1);
    t.check('an apostrophe survives', /O(&#39;|&apos;|')Brien-McAllister/.test(html));
});

suite('contest: the graphic counts rather than states', (t) => {
    const contest = load(t);

    const rows = [row('Ann Zeta', 7), row('Bob Young', 3), row('Cal Xu', 2)];
    const html = graphicFor(contest, rows);

    // 7 + 3 + 2. If the pool were ever typed rather than summed, this is where
    // a stale poster would come from.
    t.check('the pool is the sum of the rows', html.indexOf('>12<') > -1);
    t.check('and it says how many people hold tickets', /3 people have tickets/.test(html));

    t.check('no em dashes', html.indexOf('\u2014') === -1);
    t.check('nothing undefined leaked in', !/undefined|NaN|Infinity/.test(html));
});

suite('contest: the graphic marks a sole leader, never a tied field', (t) => {
    const contest = load(t);

    // Week one is everybody on one ticket. An accent on all nineteen rows means
    // nothing, and an accent on whichever name sorted first is simply wrong.
    const tied = graphicFor(contest, [row('Ann Zeta', 1), row('Bob Young', 1), row('Cal Xu', 1)]);
    const sole = graphicFor(contest, [row('Ann Zeta', 9), row('Bob Young', 1), row('Cal Xu', 1)]);

    const accent = /border-left: 3px solid/g;
    t.equal('a tied top gets no accent', (tied.match(accent) || []).length, 0);
    t.equal('a sole leader gets exactly one', (sole.match(accent) || []).length, 1);
});

suite('contest: an empty board is still worth posting', (t) => {
    const contest = load(t);

    const open = graphicFor(contest, []);
    t.check('it is a poster, not an error', /The bowl is open/.test(open));
    t.check('and it says what puts the first name in', /puts the first name in/.test(open));

    // A full roster on day one is a different case: every name belongs on the
    // board with an open slot, not collapsed into the empty-board card.
    const dayOne = graphicFor(contest, [], { names: ['Ann Zeta', 'Bob Young'] });
    t.check('day one shows the roster', dayOne.indexOf('Ann Zeta') > -1 && dayOne.indexOf('Bob Young') > -1);
    t.check('rather than the open-board card', dayOne.indexOf('The bowl is open') === -1);
});

suite('contest: the graphic holds its shape at every team size', (t) => {
    const contest = load(t);

    const build = (n) => {
        const rows = [];
        for (let i = 0; i < n; i += 1) rows.push(row('Person Number ' + i, n - i));
        return graphicFor(contest, rows);
    };

    [1, 12, 18, 19, 30, 31, 127].forEach((n) => {
        const html = build(n);
        const widths = (html.match(/width:\s*(-?\d+(?:\.\d+)?)px/g) || [])
            .map((w) => Number(w.replace(/[^0-9.-]/g, '')));

        t.check('no negative widths at ' + n, widths.filter((w) => w < 0).length === 0);
        t.check('nothing wider than the card at ' + n, widths.filter((w) => w > 900).length === 0);
        t.check('every name is present at ' + n, html.indexOf('Person Number ' + (n - 1)) > -1);
    });

    // Past thirty the board splits into columns rather than cutting the list.
    // The column gutter is the only marker unique to that layout: the rail in
    // every row is a flex child too.
    t.check('a big board splits into columns', build(60).indexOf('margin-right: 24px') > -1);
    t.check('a team-sized board does not', build(12).indexOf('margin-right: 24px') === -1);
});
