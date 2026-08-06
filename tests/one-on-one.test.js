'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    return t.loadModule('modules/one-on-one.module.js').oneOnOne;
}

suite('one-on-one: change is judged in the direction that counts as good', (t) => {
    const ooo = load(t);

    // AHT falling is an improvement; adherence falling is not. Getting this
    // backwards would have you congratulating someone for sliding.
    const result = ooo.compareSnapshots(
        { aht: 480, scheduleAdherence: 90, fcr: 80 },
        { aht: 430, scheduleAdherence: 96, fcr: 72 }
    );

    const improved = result.improved.map(e => e.key);
    const slipped = result.slipped.map(e => e.key);

    t.check('a falling AHT is an improvement', improved.indexOf('aht') > -1);
    t.check('a rising adherence is an improvement', improved.indexOf('scheduleAdherence') > -1);
    t.check('a falling FCR is a slip', slipped.indexOf('fcr') > -1);
    t.check('and nothing lands in both', improved.every(k => slipped.indexOf(k) === -1));

    // Biggest mover first — that is the one worth the meeting slot.
    t.equal('the biggest move leads', result.improved[0].key, 'aht');
});

suite('one-on-one: a wobble is not a talking point', (t) => {
    const ooo = load(t);

    // Adherence moving 0.3 of a point is noise. Raising it either way in a
    // monthly meeting wastes the slot.
    const quiet = ooo.compareSnapshots({ scheduleAdherence: 93.0 }, { scheduleAdherence: 93.3 });
    t.equal('a small move is steady, not improved', quiet.improved.length, 0);
    t.equal('and not slipped either', quiet.slipped.length, 0);
    t.equal('it is recorded as holding', quiet.steady.length, 1);

    const real = ooo.compareSnapshots({ scheduleAdherence: 90 }, { scheduleAdherence: 95 });
    t.equal('a real move does count', real.improved.length, 1);

    // Seconds and percentage points need different floors, or AHT drowns out
    // everything else.
    const ahtWobble = ooo.compareSnapshots({ aht: 430 }, { aht: 425 });
    t.equal('five seconds of AHT is noise', ahtWobble.steady.length, 1);
});

suite('one-on-one: a metric measured only once is not a change', (t) => {
    const ooo = load(t);

    const result = ooo.compareSnapshots({ fcr: 80 }, { fcr: null, scheduleAdherence: 95 });
    t.equal('nothing is reported as moving', result.improved.length + result.slipped.length, 0);
    t.equal('both one-sided metrics are set aside', result.unmeasured.length, 2);
    t.check('rather than being counted from zero', result.unmeasured.every(e => e.before === null || e.after === null));

    const empty = ooo.compareSnapshots(null, null);
    t.equal('two empty snapshots produce nothing', empty.improved.length + empty.slipped.length + empty.unmeasured.length, 0);
});

suite('one-on-one: the meeting you measure against is the one before', (t) => {
    const ooo = load(t);

    const meetings = [
        { date: '2026-05-15', notes: 'may' },
        { date: '2026-06-15', notes: 'june' },
        { date: '2026-07-15', notes: 'july' }
    ];

    t.equal('the latest before the date wins', ooo.previousMeeting(meetings, '2026-08-15').date, '2026-07-15');
    t.equal('and it is genuinely the one before', ooo.previousMeeting(meetings, '2026-07-01').date, '2026-06-15');

    // Re-opening a saved meeting must compare against the one before it, not
    // against itself, or every revisit reports no change at all.
    t.equal('a saved meeting does not compare to itself', ooo.previousMeeting(meetings, '2026-07-15').date, '2026-06-15');

    t.check('the first ever meeting has nothing to compare to', ooo.previousMeeting(meetings, '2026-01-01') === null);
    t.check('and no history is survivable', ooo.previousMeeting([], '2026-08-15') === null);
});

suite('one-on-one: meetings persist, per person, and re-save cleanly', (t) => {
    const ooo = load(t);

    ooo.saveMeeting('Esperanza Palomera', { date: '2026-08-15', notes: 'first pass', snapshot: { fcr: 70 } });
    t.equal('the meeting is stored', ooo.meetingsFor('Esperanza Palomera').length, 1);
    t.check("and nobody else's list is touched", ooo.meetingsFor('James Garcia').length === 0);

    // Saving the same date again is an edit, not a second meeting.
    ooo.saveMeeting('Esperanza Palomera', { date: '2026-08-15', notes: 'after the meeting', snapshot: { fcr: 75 } });
    const list = ooo.meetingsFor('Esperanza Palomera');
    t.equal('re-saving the same date replaces it', list.length, 1);
    t.equal('with the newer notes', list[0].notes, 'after the meeting');

    ooo.saveMeeting('Esperanza Palomera', { date: '2026-06-15', notes: 'earlier one', snapshot: {} });
    t.equal('history reads oldest first', ooo.meetingsFor('Esperanza Palomera')[0].date, '2026-06-15');

    ooo.deleteMeeting('Esperanza Palomera', '2026-06-15');
    t.equal('deleting removes just that one', ooo.meetingsFor('Esperanza Palomera').length, 1);

    t.check('a meeting with no date is refused', ooo.saveMeeting('X', { notes: 'no date' }) === false);
});

suite('one-on-one: the sheet leaves out what it has nothing for', (t) => {
    const ooo = load(t);

    const full = ooo.buildTalkingPoints({
        employeeName: 'Esperanza Palomera',
        date: '2026-08-15',
        yearToDate: [{ key: 'fcr', label: 'First Call Resolution', value: 78, target: 73 }],
        sinceLast: { date: '2026-07-15', improved: [{ key: 'aht', label: 'AHT', before: 480, after: 430, gain: 50 }], slipped: [] },
        lastMonth: { improved: [], slipped: [{ key: 'fcr', label: 'FCR', before: 80, after: 72, gain: -8 }] },
        recentWeeks: { improved: [], slipped: [] },
        previousNotes: 'we agreed to work on holds',
        notes: 'ask about the schedule change'
    });

    t.check('it names the person and date', full.indexOf('Esperanza Palomera') > -1 && full.indexOf('2026-08-15') > -1);
    t.check('the year section is there', full.indexOf('THE YEAR SO FAR') > -1);
    t.check('and dates the last meeting', full.indexOf('SINCE WE LAST MET (2026-07-15)') > -1);
    t.check('last month appears when something moved', full.indexOf('LAST MONTH') > -1);
    t.check('the weeks section is dropped when nothing moved', full.indexOf('THE LAST FEW WEEKS') === -1);
    t.check('what was said last time carries forward', full.indexOf('we agreed to work on holds') > -1);
    t.check('and my own notes are on the sheet', full.indexOf('ask about the schedule change') > -1);

    // A first meeting has no history, and empty headings are worse than a
    // shorter page.
    const first = ooo.buildTalkingPoints({ employeeName: 'James Garcia', date: '2026-08-15', yearToDate: [] });
    t.check('a first meeting still names the person', first.indexOf('James Garcia') > -1);
    t.check('with no since-we-last-met heading', first.indexOf('SINCE WE LAST MET') === -1);
    t.check('and no empty year heading', first.indexOf('THE YEAR SO FAR') === -1);
});

suite('one-on-one: a snapshot only records what it actually has', (t) => {
    const ooo = load(t);

    const snap = ooo.snapshotFromRow({ name: 'X', fcr: '78.5', aht: '430', scheduleAdherence: '', totalCalls: '120' });
    t.equal('numbers are kept as numbers', snap.fcr, 78.5);
    t.check('blanks are left out rather than stored as zero', !('scheduleAdherence' in snap));
    t.check('volume is not a talking point', !('totalCalls' in snap));
    t.equal('an empty row yields an empty snapshot', Object.keys(ooo.snapshotFromRow(null)).length, 0);
});

suite('one-on-one: a falling number is never called "up"', (t) => {
    const ooo = load(t);

    // AHT improving means the number goes down. Any direction word attached to
    // the figures themselves is wrong half the time, so the headings carry the
    // meaning and the lines carry only the numbers.
    const line = ooo.describeChange({ key: 'aht', label: 'Average Handle Time', before: 480, after: 430, gain: 50 });
    t.check('the line shows the movement', line.indexOf('480') > -1 && line.indexOf('430') > -1);
    t.check('and never says up', line.indexOf('up') === -1);
    t.check('nor down', line.indexOf('down') === -1);

    const sheet = ooo.buildTalkingPoints({
        employeeName: 'X', date: '2026-08-15',
        lastMonth: { improved: [{ key: 'aht', label: 'AHT', before: 480, after: 430, gain: 50 }], slipped: [] }
    });
    t.check('the section labels it as better', sheet.indexOf('Better:') > -1);
    t.check('without claiming the number rose', sheet.indexOf('Up:') === -1);
});
