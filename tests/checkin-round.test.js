'use strict';

const { suite } = require('./harness');

/**
 * THE MENTAL HEALTH CHECK-IN (Scott, 2026-11-04)
 *
 * One message written once, handed over one associate at a time with their
 * own first name in it. No numbers. The words survive a reload and sync; the
 * ticks live in the outreach send log under their own plan id and round.
 *
 * Names here are made up.
 */

function load(t, opts) {
    const o = opts || {};
    t.installFakeBrowser();
    t.loadModule('modules/daily-outreach.module.js');
    const mods = t.loadModule('modules/checkin-round.module.js');
    if (o.nicknames) {
        global.window.getEmployeeNickname = (full) => o.nicknames[full] || String(full).split(' ')[0];
    }
    return mods.checkinRound;
}

suite('check-in round: each copy carries the first name', async (t) => {
    const round = load(t);

    t.equal('{first} becomes the first name',
        round.personalize('Hi {first}, how are you?', 'Jordan Pike'), 'Hi Jordan, how are you?');
    t.equal('{name} means the first name too, any case',
        round.personalize('Hey {Name}!', 'Jordan Pike'), 'Hey Jordan!');
    t.equal('an export name the wrong way round is turned right',
        round.firstNameFor('Pike, Jordan'), 'Jordan');
    t.equal('no name at all reads "there", not a blank',
        round.personalize('Hi {first},', ''), 'Hi there,');
    t.equal('every placeholder in the message is filled',
        round.personalize('{first}, {first}', 'Mara Lind'), 'Mara, Mara');
    t.check('a message with no placeholder is left as written',
        round.personalize('Hi team', 'Mara Lind') === 'Hi team');
    t.check('and is spotted, so the screen can say so', !round.hasPlaceholder('Hi team') && round.hasPlaceholder('Hi {first}'));
});

suite('check-in round: a preferred name from Settings wins', async (t) => {
    const round = load(t, { nicknames: { 'Robert Vance': 'Bobby' } });
    t.equal('the preferred name is used', round.personalize('Hi {first}', 'Robert Vance'), 'Hi Bobby');
    t.equal('everyone else gets their first name', round.personalize('Hi {first}', 'Mara Lind'), 'Hi Mara');
    // getEmployeeNickname splits on a space, so it would hand back "Pike,".
    t.equal('a comma name is not trusted from the nickname helper', round.firstNameFor('Pike, Jordan'), 'Jordan');
});

suite('check-in round: the roster becomes a list to work down', async (t) => {
    const round = load(t);
    const rows = round.buildRound('Hi {first}', ['Zed Ames', 'Ann Cole', 'Ann Cole', ' ', 'Mara Lind'], { isSent: (n) => n === 'Mara Lind' });

    t.equal('blanks and repeats are dropped', rows.length, 3);
    t.equal('in first-name order, how the Teams chat list reads', rows.map(r => r.first).join(','), 'Ann,Mara,Zed');
    t.equal('each message is their own', rows[2].message, 'Hi Zed');
    t.check('a tick already in the log shows as sent', rows[1].sent === true && rows[0].sent === false);
});

suite('check-in round: the words and the round are saved', async (t) => {
    t.pinClock('2026-11-04');
    const round = load(t);

    const first = round.currentRound();
    t.check('opening it the first time puts a starter in the box', first.text === round.STARTERS[0].text);
    t.equal('and starts a round on today', first.roundId, '2026-11-04');

    round.saveState({ text: 'Hi {first}, checking in.' });
    t.equal('typed words survive a reload', round.currentRound().text, 'Hi {first}, checking in.');

    const sent = round.sentState(first.roundId);
    sent.mark('Mara Lind');
    t.check('a copy ticks the person off', round.sentState(first.roundId).isSent('Mara Lind'));

    const next = round.startNewRound();
    t.check('a new round has its own id', next.roundId && next.roundId !== first.roundId);
    t.equal('and keeps the words', next.text, 'Hi {first}, checking in.');
    t.check('the new list starts clear', !round.sentState(next.roundId).isSent('Mara Lind'));
    t.check('the old round keeps its record', round.sentState(first.roundId).isSent('Mara Lind'));

    const log = JSON.parse(global.localStorage.getItem('devCoachingTool_dailyOutreachSent') || '{}');
    const keys = Object.keys(log);
    t.check('ticks sit under their own plan id, apart from the private round and the high fives',
        keys.length === 1 && keys[0].indexOf(round.PLAN_ID + '|') === 0);
});

suite('check-in round: the starters follow the message rules', async (t) => {
    const round = load(t);
    const emojiPattern = /\p{Extended_Pictographic}/gu;
    round.STARTERS.forEach(s => {
        t.check(`"${s.label}" has the {first} placeholder`, round.hasPlaceholder(s.text));
        t.check(`"${s.label}" has no em or en dash`, !/[–—]/.test(s.text));
        t.check(`"${s.label}" has at most 2 emojis`, (s.text.match(emojiPattern) || []).length <= 2);
        t.check(`"${s.label}" has no numbers about their work`, !/%|\bAHT\b|adherence|survey|calls? per|target/i.test(s.text));
        // Nothing the app can't keep: no promise of secrecy, no time off.
        t.check(`"${s.label}" promises nothing it cannot keep`, !/between us|confidential|day off|time off/i.test(s.text));
    });
});

suite('check-in round: the screen lists everyone with their own copy', async (t) => {
    t.pinClock('2026-11-04');
    const round = load(t);

    // No DOM in the harness: a slot whose lookups hand back inert elements,
    // so render can wire itself and the HTML it wrote can be read.
    const stub = () => ({ value: '', style: {}, dataset: {}, textContent: '', addEventListener() {} });
    const makeSlot = () => ({ innerHTML: '', querySelector: () => stub(), querySelectorAll: () => [] });

    const slot = makeSlot();
    round.render(slot, { getRoster: () => ['Mara Lind', 'Pike, Jordan'] });
    t.check('the message box is there', slot.innerHTML.indexOf('id="checkinRoundText"') !== -1);
    t.equal('one card per person', (slot.innerHTML.match(/class="cir-row"/g) || []).length, 2);
    t.check('each card already reads with their name', slot.innerHTML.indexOf('Hi Jordan, no numbers today') !== -1 && slot.innerHTML.indexOf('Hi Mara, no numbers today') !== -1);
    t.check('every starter is offered', round.STARTERS.every(s => slot.innerHTML.indexOf(s.label) !== -1));

    round.sentState(round.currentRound().roundId).mark('Mara Lind');
    const again = makeSlot();
    round.render(again, { getRoster: () => ['Mara Lind', 'Pike, Jordan'] });
    t.check('a tick survives the panel being reopened', again.innerHTML.indexOf('✓ Sent') !== -1);

    const empty = makeSlot();
    round.render(empty, { getRoster: () => [] });
    t.check('an empty roster says where to add the team', /Settings/.test(empty.innerHTML));
});
