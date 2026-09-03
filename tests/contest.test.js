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

    // Read from October, so the week and the month have both closed.
    const board = contest.buildLeaderboard(month(days), { asOf: '2026-10-01' });
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
    }), { asOf: '2026-09-14' });

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
    // Read once both weeks have closed, since a running week pays nothing.
    t.equal('two weeks, two weekly entries',
        contest.buildLeaderboard(month(days), { asOf: '2026-09-21' })[0].weeklyAdherence, 2);
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

suite('contest: an unfinished week or month pays nothing yet', (t) => {
    const contest = load(t);

    // One good Monday used to read as three tickets: the day, plus a week whose
    // average was that one day, plus a month whose average was the same day
    // again. Nobody has held a week at target until the week has actually run.
    const oneDay = month({ '2026-09-07': { 'Chris Vale': { adherence: 99 } } });

    const midWeek = contest.buildLeaderboard(oneDay, { asOf: '2026-09-08' })[0];
    t.equal('the day itself pays', midWeek.dailyAdherence, 1);
    t.equal('the running week does not', midWeek.weeklyAdherence, 0);
    t.equal('nor the running month', midWeek.monthlyAdherence, 0);
    t.equal('so one good day is one ticket', midWeek.total, 1);

    // The week closes on Sunday the 13th, so from the 14th it can pay. The
    // month has still not finished.
    const afterWeek = contest.buildLeaderboard(oneDay, { asOf: '2026-09-14' })[0];
    t.equal('the closed week pays', afterWeek.weeklyAdherence, 1);
    t.equal('the month still does not', afterWeek.monthlyAdherence, 0);

    const afterMonth = contest.buildLeaderboard(oneDay, { asOf: '2026-10-01' })[0];
    t.equal('and once the month is over it pays too', afterMonth.monthlyAdherence, 1);

    // A thin week is still visible as thin, which is what makes it checkable.
    const weekly = contest.computeEntries(oneDay, { asOf: '2026-09-14' })
        .find((e) => e.reason === 'weekly-adherence');
    t.check('and it says how few days carried it', /across 1 day/.test(weekly.detail));
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

    const post = contest.buildStandingsPost(month(days), 'September', { asOf: '2026-10-01' });

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

// ============================================
// THE GRAPHIC
// ============================================

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
    t.check('and the people on zero are told so plainly', /No tickets yet\./.test(html));

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
    t.check('and it says what puts the first name in', /puts the first name on the board/.test(open));

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

suite('contest: the card reads correctly in the panel, not just in the export', (t) => {
    const contest = load(t);
    const html = graphicFor(contest, [row('Ann Zeta', 6), row('Bob Young', 2)]);

    // The card is previewed live inside the running app, and styles-v2.css
    // forces color:#e2e8f0 !important onto bare div, span, p and td whenever
    // dark mode is on. That rule is typed on the element, so it reaches every
    // cell of the card and washes the whole thing out on screen. An inline
    // declaration marked important outranks an important one from a stylesheet,
    // which is what keeps the preview honest.
    const colours = html.match(/color:\s*rgb\([^)]*\)( !important)?/g) || [];
    t.check('the card sets colours at all', colours.length > 20);
    t.equal('and every one of them is pinned',
        colours.filter((c) => c.indexOf('!important') === -1).length, 0);

    // The background half needs no pinning, and must not acquire any: every
    // background override in that stylesheet matches on the literal hex text in
    // the style attribute, so rgb() is already out of their reach.
    t.check('no hex backgrounds for the dark rules to match', !/background:\s*#/.test(html));

    // Two and three word labels in a flex row shrink below their content by
    // default, which broke "Perfect surveys" across two lines on a machine
    // whose font ran wider than the one this was designed against.
    t.check('the legend labels cannot break mid phrase',
        /white-space: nowrap;[^"]*">Perfect surveys</.test(html)
        || /Perfect surveys/.test(html) && (html.match(/white-space: nowrap/g) || []).length >= 3);
});

// ============================================
// IMPORTING WHAT WAS ALREADY UPLOADED
// ============================================

function upload(date, employees) {
    const stores = { dailyData: {} };
    stores.dailyData[date + '|' + date] = { metadata: { startDate: date, endDate: date }, employees };
    return stores;
}

suite('contest: adherence comes straight off the daily upload', (t) => {
    const contest = load(t);

    const preview = contest.buildImportPreview(upload('2026-09-01', [
        { name: 'Alyssa Dimes', scheduleAdherence: 95.2 },
        { name: 'Betty Yanez', scheduleAdherence: 88 }
    ]), { monthKey: '2026-09' });

    t.equal('Alyssa came through', preview.days['2026-09-01']['Alyssa Dimes'].adherence, 95.2);
    t.equal('so did Betty', preview.days['2026-09-01']['Betty Yanez'].adherence, 88);
    t.equal('two values found', preview.counts.adherenceValues, 2);
});

suite('contest: a perfect survey count is only taken when it is certain', (t) => {
    const contest = load(t);

    // Every rate at 100 means every response was flawless, so the count is the
    // number of responses and nothing is being assumed.
    const clean = contest.buildImportPreview(upload('2026-09-01', [
        { name: 'Alyssa Dimes', surveyTotal: 3, cxRepOverall: 100, fcr: 100, overallExperience: 100 }
    ]), { monthKey: '2026-09' });
    t.equal('three responses, three perfect surveys',
        clean.days['2026-09-01']['Alyssa Dimes'].perfectSurveys, 3);

    // A rate below 100 says some response was not perfect, but not which or how
    // many, because the questions carry different denominators. Guessing here
    // would hand somebody raffle tickets they did not earn.
    const mixed = contest.buildImportPreview(upload('2026-09-01', [
        { name: 'Betty Yanez', surveyTotal: 5, cxRepOverall: 80, fcr: 100, overallExperience: 100 }
    ]), { monthKey: '2026-09' });
    t.check('no count is invented', !mixed.days['2026-09-01']);
    t.equal('and it is reported for a person to type', mixed.needsSurveyCheck.length, 1);
    t.check('naming who and when',
        mixed.needsSurveyCheck[0].name === 'Betty Yanez' && mixed.needsSurveyCheck[0].date === '2026-09-01');
});

suite('contest: an upload spanning several days is left out', (t) => {
    const contest = load(t);

    // A week of adherence cannot be pinned to a day, and spreading it across
    // the days would award entries nobody earned on any of them.
    const stores = { dailyData: {
        '2026-09-07|2026-09-11': {
            metadata: { startDate: '2026-09-07', endDate: '2026-09-11' },
            employees: [{ name: 'Alyssa Dimes', scheduleAdherence: 96 }]
        }
    } };

    const preview = contest.buildImportPreview(stores, { monthKey: '2026-09' });
    t.equal('nothing was imported from it', preview.counts.days, 0);
    t.check('and it says why', /more than one day/.test(preview.notes.join(' ')));
});

suite('contest: the import respects the month and the team', (t) => {
    const contest = load(t);

    const stores = { dailyData: {} };
    stores.dailyData['2026-08-31|2026-08-31'] = { metadata: { startDate: '2026-08-31', endDate: '2026-08-31' },
        employees: [{ name: 'Alyssa Dimes', scheduleAdherence: 99 }] };
    stores.dailyData['2026-09-01|2026-09-01'] = { metadata: { startDate: '2026-09-01', endDate: '2026-09-01' },
        employees: [{ name: 'Alyssa Dimes', scheduleAdherence: 95 }, { name: 'Someone Else', scheduleAdherence: 91 }] };

    const preview = contest.buildImportPreview(stores, { monthKey: '2026-09', names: ['Alyssa Dimes'] });

    t.check('last month is left alone', !preview.days['2026-08-31']);
    t.check('the other team is not imported', !preview.days['2026-09-01']['Someone Else']);
    t.equal('only the picked person came through', preview.counts.people, 1);
});

suite('contest: importing never overwrites what was typed, and never deletes', (t) => {
    const contest = load(t);

    const existing = { days: {
        '2026-09-01': { 'Alyssa Dimes': { adherence: 91, perfectSurveys: 2 } },
        '2026-09-02': { 'Betty Yanez': { adherence: 97 } }
    } };

    const preview = contest.buildImportPreview(upload('2026-09-01', [
        { name: 'Alyssa Dimes', scheduleAdherence: 95 },
        { name: 'Kamella Dash', scheduleAdherence: 94 }
    ]), { monthKey: '2026-09' });

    const merged = contest.mergeImportIntoMonth(existing, preview);

    t.equal('the typed number wins', merged.month.days['2026-09-01']['Alyssa Dimes'].adherence, 91);
    t.equal('and is reported as kept', merged.kept, 1);
    t.equal('a person who had nothing is filled in', merged.month.days['2026-09-01']['Kamella Dash'].adherence, 94);
    t.equal('a day the import never touched survives', merged.month.days['2026-09-02']['Betty Yanez'].adherence, 97);
    t.equal("and so does the typed survey count", merged.month.days['2026-09-01']['Alyssa Dimes'].perfectSurveys, 2);

    // The caller still holds the month it passed in, so a failed save leaves
    // the screen showing what is actually stored.
    t.equal('the original was not mutated', existing.days['2026-09-01']['Alyssa Dimes'].adherence, 91);
    t.check('and gained nobody', !existing.days['2026-09-01']['Kamella Dash']);

    // With the flag, the import is allowed to win.
    const forced = contest.mergeImportIntoMonth(existing, preview, { overwrite: true });
    t.equal('overwrite replaces it', forced.month.days['2026-09-01']['Alyssa Dimes'].adherence, 95);
});

suite('contest: the import survives junk without inventing anything', (t) => {
    const contest = load(t);

    t.equal('no stores at all', contest.buildImportPreview(null, {}).counts.days, 0);
    t.equal('empty stores', contest.buildImportPreview({ dailyData: {} }, {}).counts.days, 0);

    const messy = contest.buildImportPreview(upload('2026-09-01', [
        { name: '  Alyssa Dimes  ', scheduleAdherence: '95' },
        { name: 'No Adherence', scheduleAdherence: '' },
        { name: 'Null Adherence', scheduleAdherence: null },
        { name: 'Zero Adherence', scheduleAdherence: 0 },
        { scheduleAdherence: 90 }
    ]), { monthKey: '2026-09' });

    const day = messy.days['2026-09-01'];
    t.equal('a padded name is trimmed to the roster spelling', day['Alyssa Dimes'].adherence, 95);
    t.check('a blank adherence is not stored', !day['No Adherence']);
    t.check('nor a null one', !day['Null Adherence']);
    t.equal('but a real zero is kept, because it is a number', day['Zero Adherence'].adherence, 0);
    t.check('a row with no name is skipped', Object.keys(day).length === 2);
});

suite('contest: one day into the month is one ticket, not three', (t) => {
    const contest = load(t);

    // Exactly what Scott saw: September 1 entered, read on September 2, and
    // everybody showing 3 tickets off a single day. The day pays. The week and
    // the month have not happened yet.
    const board = contest.buildLeaderboard(month({
        '2026-09-01': { 'Alyssa Dimes': { adherence: 95 }, 'Betty Yanez': { adherence: 94 } }
    }), { asOf: '2026-09-02' });

    t.equal('one ticket each', board[0].total, 1);
    t.equal('and it is the day', board[0].dailyAdherence, 1);
    t.equal('no week bonus', board[0].weeklyAdherence, 0);
    t.equal('no month bonus', board[0].monthlyAdherence, 0);
    t.equal('two tickets in the whole bowl', board[0].total + board[1].total, 2);
});

suite('contest: the card shows where adherence actually stands', (t) => {
    const contest = load(t);

    const data = month({
        '2026-09-01': { 'Alyssa Dimes': { adherence: 95 }, 'Betty Yanez': { adherence: 80 } },
        '2026-09-02': { 'Alyssa Dimes': { adherence: 97 } }
    });

    const summary = contest.buildAdherenceSummary(data);
    t.equal('averaged over the days logged', summary['Alyssa Dimes'].average, 96);
    t.equal('and says how many there were', summary['Alyssa Dimes'].days, 2);
    t.check('a run at target is marked as meeting it', summary['Alyssa Dimes'].meets === true);
    t.check('and one below it is not', summary['Betty Yanez'].meets === false);

    // The tickets say what is banked. This says how the month is going, which
    // is what tells somebody whether the week bonus is still reachable.
    const html = contest.buildStandingsGraphicHtml(
        contest.buildLeaderboard(data, { asOf: '2026-09-02' }),
        { monthLabel: '2026-09', target: 93, adherence: summary,
          names: ['Alyssa Dimes', 'Betty Yanez'] });

    t.check('the card carries the live number', /96\.0% adherence/.test(html));
    t.check('and the one that is behind', /80\.0% adherence/.test(html));
});


// ============================================
// THE TEAMS POST
// ============================================

suite('contest: the Teams post says what it covers and how to earn', (t) => {
    const contest = load(t);

    const post = contest.buildCheckinPost(month({
        '2026-09-01': { 'Alyssa Dimes': { perfectSurveys: 2 }, 'Betty Yanez': { adherence: 95 } },
        '2026-09-02': { 'Alyssa Dimes': { adherence: 94 } }
    }), { target: 93, names: ['Alyssa Dimes', 'Betty Yanez', 'Esther Ramos'], asOf: '2026-09-03' });

    // The span comes from the days that were entered, never the calendar, so it
    // cannot claim to cover a day nobody has uploaded.
    t.check('it names the days it covers', /So for the days 9\/1 to 9\/2,/.test(post));
    t.check('and says what the list is', /earned a raffle ticket\./.test(post));

    t.check('everyone who earned one is listed', /@Alyssa, 3 tickets/.test(post)
        && /@Betty, 1 ticket/.test(post));
    t.check('and nobody who earned none is', post.indexOf('Esther Ramos') === -1);

    t.check('the rule is restated', /Remember, you get a raffle ticket for a day above 93% adherence, and for a perfect survey\./.test(post));

    // Nothing else. It is read on a phone.
    t.check('no leaderboard numbering', !/^1\. /m.test(post));
    t.check('no em dashes', post.indexOf('\u2014') === -1);
    t.check('and no beaten counts', !/better than \d+ of \d+/.test(post));
});

suite('contest: a single day reads as one day, and a bonus is only named once earned', (t) => {
    const contest = load(t);

    const oneDay = contest.buildCheckinPost(month({
        '2026-09-01': { 'Alyssa Dimes': { adherence: 95 } }
    }), { target: 93, asOf: '2026-09-02' });
    t.check('one day is not a range', /So for the days 9\/1, /.test(oneDay));
    // Naming a bonus nobody has earned yet reads as a rule somebody missed.
    t.check('the bonus is not mentioned', oneDay.indexOf('bonus ticket') === -1);

    // A closed week pays, and only then is it worth explaining.
    const days = {};
    ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].forEach((d) => {
        days[d] = { 'Dana Roe': { adherence: 96 } };
    });
    const withBonus = contest.buildCheckinPost(month(days), { target: 93, asOf: '2026-09-16' });
    t.check('once a bonus is earned it is explained', /A full week at 93% adds a bonus ticket/.test(withBonus));

    t.equal('an empty month has nothing to post', contest.buildCheckinPost(month({}), {}), '');
});

suite('contest: the panel offers one way to do each thing', (t) => {
    const fs = require('fs');
    const path = require('path');
    const { ROOT } = require('./harness');
    const ui = fs.readFileSync(path.join(ROOT, 'modules/contest-ui.module.js'), 'utf8');

    // Five buttons for three actions was two too many. The words, the picture,
    // and the draw.
    const buttons = (ui.match(/<button type="button" id="contest\w+Btn"/g) || []);
    t.equal('three buttons in the standings row and two in the day entry',
        buttons.length, 5);
    t.check('the post button says where it goes', ui.indexOf('📣 Post to Teams') > -1);
    t.check('there is no second post button', ui.indexOf('Copy a check in') === -1);

    // Downloading is a fallback, not a button somebody has to read past. Scott's
    // work machine cannot download at all, so it earns its place only on the
    // failure path.
    t.check('download is not in the toolbar',
        ui.indexOf('id="contestDownloadGraphicBtn"') === -1);
    t.check('but it still appears when the clipboard refuses',
        ui.indexOf('Download it instead') > -1);
});

suite('contest: the post says what each ticket was for', (t) => {
    const contest = load(t);

    // A bare count tells somebody the score and not the rule. The person on one
    // ticket needs to see which lever gave it to them, and which one they have
    // not touched.
    const post = contest.buildCheckinPost(month({
        '2026-09-07': { 'Alyssa Dimes': { adherence: 96, perfectSurveys: 2 },
                        'Betty Yanez': { adherence: 95 },
                        'Kamella Dash': { perfectSurveys: 1 } }
    }), { target: 93, asOf: '2026-09-08' });

    t.check('a survey only earner says so', /@Kamella, 1 ticket, for 1 perfect survey/.test(post));
    t.check('an adherence only earner says so', /@Betty, 1 ticket, for 1 day at 93%/.test(post));
    t.check('and both reasons are joined readably',
        /@Alyssa, 3 tickets, for 2 perfect surveys and 1 day at 93%/.test(post));

    t.check('no em dashes', post.indexOf('\u2014') === -1);
});

suite('contest: a bonus is counted in the reason once it is earned', (t) => {
    const contest = load(t);

    const days = {};
    ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11'].forEach((d) => {
        days[d] = { 'Dana Roe': { adherence: 96 } };
    });

    // Read after the week closed, so the week bonus has actually paid.
    const post = contest.buildCheckinPost(month(days), { target: 93, asOf: '2026-09-16' });
    t.check('the reason names the bonus',
        /@Dana, 6 tickets, for 5 days at 93% and 1 bonus ticket/.test(post));

    // Mid week the same data pays only the days, so the reason must not claim
    // a bonus that has not happened.
    const midWeek = contest.buildCheckinPost(month(days), { target: 93, asOf: '2026-09-11' });
    t.check('and never before it has', midWeek.indexOf('bonus ticket') === -1);
});

suite('contest: the standings come before the day entry', (t) => {
    const fs = require('fs');
    const path = require('path');
    const { ROOT } = require('./harness');
    const ui = fs.readFileSync(path.join(ROOT, 'modules/contest-ui.module.js'), 'utf8');

    // The board is what the panel is for. Entering a day is the chore that
    // produced it, and eighteen rows of inputs were pushing the answer below
    // the fold on every visit.
    t.check('standings is the first panel',
        ui.indexOf('>Standings</h3>') < ui.indexOf('>Enter a day</h3>'));
});

suite('contest: the post carries emoji that mean something', (t) => {
    const contest = load(t);

    const post = contest.buildCheckinPost(month({
        '2026-09-07': { 'Alyssa Dimes': { adherence: 96, perfectSurveys: 2 },
                        'Betty Yanez': { adherence: 95 } }
    }), { target: 93, asOf: '2026-09-08' });

    t.check('the header is a ticket', /^🎟️ So for the days/.test(post));
    t.check('the rules read as a note', /💡 Remember,/.test(post));
    t.check('and it closes warmly', /(👏|💪)/.test(post));

    /* No badge on a standings row. A star sat on perfect surveys for a while on
       the theory they were the harder lever. They are not: there are simply
       fewer of them, because adherence has thirty chances in a month and a
       survey arrives when it arrives. Marking the rarer lever rewards luck. */
    const rows = post.split(String.fromCharCode(10))
        .filter((l) => /^@(Alyssa|Betty)/.test(l));
    t.equal('both people are listed', rows.length, 2);
    t.check('and neither row is badged', rows.every((l) => !/🌟/.test(l)));

    t.check('no em dashes', post.indexOf(String.fromCharCode(8212)) === -1);
});

suite('contest: the closing line points at the lever you can choose', (t) => {
    const contest = load(t);

    /* Adherence, never surveys. There are thirty chances at adherence in a
       month and only as many surveys as happen to arrive, so a nudge about
       surveys is a nudge about luck. */
    const surveysOnly = contest.buildCheckinPost(month({
        '2026-09-07': { 'Alyssa Dimes': { adherence: 88, perfectSurveys: 3 } }
    }), { target: 93, asOf: '2026-09-08' });
    t.check('a board with no clean days nudges at adherence',
        /One clean day on adherence is a ticket/.test(surveysOnly));
    t.check('and says how many chances are left', /thirty of them in a month/.test(surveysOnly));

    const some = contest.buildCheckinPost(month({
        '2026-09-07': { 'Betty Yanez': { adherence: 95 } }
    }), { target: 93, asOf: '2026-09-08' });
    t.check('some clean days is encouraged', /Good days on adherence/.test(some));

    const days = {};
    ['2026-09-07', '2026-09-08', '2026-09-09'].forEach((d) => {
        days[d] = { 'Dana Roe': { adherence: 96 } };
    });
    t.check('a strong run gets applause',
        /Cracking run on adherence/.test(contest.buildCheckinPost(month(days), { target: 93, asOf: '2026-09-10' })));
});

suite('contest: names go out as Teams mentions', (t) => {
    const contest = load(t);

    // @First so the cursor landing after one turns it into a real mention.
    const post = contest.buildCheckinPost(month({
        '2026-09-01': { 'Alyssa Dimes': { adherence: 95 }, 'Matrece Muldrow': { adherence: 96 } }
    }), { target: 93, asOf: '2026-09-02' });

    t.check('the first name is used', /@Alyssa, 1 ticket/.test(post));
    t.check('and the surname is dropped', post.indexOf('Alyssa Dimes') === -1);
    t.check('for everybody', /@Matrece, 1 ticket/.test(post));

    // Two people sharing a first name keep their surnames. An @ that resolves
    // to the wrong person is worse than one that does not resolve at all, and
    // on the Everyone board there are several.
    const shared = contest.buildCheckinPost(month({
        '2026-09-01': { 'Sarah Gregory': { adherence: 95 }, 'Sarah Jordan': { adherence: 96 },
                        'Betty Yanez': { adherence: 94 } }
    }), { target: 93, asOf: '2026-09-02' });

    t.check('a shared first name keeps its surname', /@Sarah Gregory, 1 ticket/.test(shared)
        && /@Sarah Jordan, 1 ticket/.test(shared));
    t.check('and nobody is left as a bare ambiguous Sarah', !/@Sarah,/.test(shared));
    t.check('while an unshared name is still short', /@Betty, 1 ticket/.test(shared));
});

suite('contest: a survey counts whichever question it answered', (t) => {
    const contest = load(t);

    function survey(extra) {
        const stores = { dailyData: {} };
        stores.dailyData['2026-09-01|2026-09-01'] = {
            metadata: { startDate: '2026-09-01', endDate: '2026-09-01' },
            employees: [Object.assign({ name: 'Oceane Ingram', scheduleAdherence: 91 }, extra)]
        };
        const preview = contest.buildImportPreview(stores, { monthKey: '2026-09' });
        const row = (preview.days['2026-09-01'] || {})['Oceane Ingram'] || {};
        return { tickets: row.perfectSurveys || 0, flagged: preview.needsSurveyCheck.length > 0 };
    }

    // Each question keeps its own response count and they differ: somebody can
    // answer the rep question and skip FCR. Reading only the OE total threw
    // away a survey that arrived as rep sat, and threw it away silently.
    t.equal('a rep sat survey with no OE response still counts',
        survey({ surveyTotal: 0, repSurveyTotal: 1, cxRepOverall: 100 }).tickets, 1);
    t.equal('and an FCR only survey does too',
        survey({ surveyTotal: 0, fcrSurveyTotal: 1, fcr: 100 }).tickets, 1);
    t.equal('an OE survey still counts as it always did',
        survey({ surveyTotal: 1, cxRepOverall: 100, fcr: 100, overallExperience: 100 }).tickets, 1);

    // Three people answered the rep question and two of them also answered FCR.
    // Every rate is 100, so three responses were flawless, not two.
    t.equal('the count is the question everybody answered',
        survey({ surveyTotal: 3, repSurveyTotal: 3, fcrSurveyTotal: 2,
                 cxRepOverall: 100, fcr: 100, overallExperience: 100 }).tickets, 3);

    // A rate below 100 means some response was not perfect, and the upload
    // cannot say which. No ticket, and it is handed back for a person to judge.
    const mixed = survey({ surveyTotal: 1, repSurveyTotal: 1, fcrSurveyTotal: 1,
                           cxRepOverall: 100, fcr: 0, overallExperience: 100 });
    t.equal('a zero on one question earns nothing', mixed.tickets, 0);
    t.check('and is flagged rather than dropped', mixed.flagged);

    // Responses with nothing scoring them is odd data, not a ruling either way.
    t.check('responses with no rates are flagged',
        survey({ surveyTotal: 2 }).flagged);

    t.equal('and a person with genuinely no surveys is not flagged',
        survey({ surveyTotal: 0 }).flagged, false);
});
