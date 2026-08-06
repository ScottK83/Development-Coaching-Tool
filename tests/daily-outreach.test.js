'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/daily-outreach.module.js').dailyOutreach;
}

// Local noon avoids the date sliding a day either way on a timezone boundary.
function on(iso) {
    return new Date(iso + 'T12:00:00');
}

suite('daily outreach: the weekday decides what the message covers', (t) => {
    const outreach = load(t);

    // 2026-08-03 is a Monday.
    t.equal('Monday leads with the completed week', outreach.planForDate(on('2026-08-03')).covers, 'lastWeek');
    t.equal('Tuesday adds Monday to last week', outreach.planForDate(on('2026-08-04')).covers, 'lastWeekPlusMonday');
    t.equal('Wednesday switches to the current week', outreach.planForDate(on('2026-08-05')).covers, 'thisWeek');
    t.equal('Thursday stays on the current week', outreach.planForDate(on('2026-08-06')).covers, 'thisWeek');
    t.equal('Friday stays on the current week', outreach.planForDate(on('2026-08-07')).covers, 'thisWeek');

    // Saturday and Sunday aren't in the rotation, so they fall back rather
    // than leaving the sweep with no plan at all.
    t.equal('Saturday falls back to the completed week', outreach.planForDate(on('2026-08-08')).covers, 'lastWeek');
    t.equal('Sunday falls back to the completed week', outreach.planForDate(on('2026-08-09')).covers, 'lastWeek');

    t.equal('Tuesday pulls in the Monday daily row', outreach.planForDate(on('2026-08-04')).dailyMode, 'monday');
    t.equal('Wednesday rolls up the whole week to date', outreach.planForDate(on('2026-08-05')).dailyMode, 'wtd');

    // The day picker offers Monday through Friday, in order. You choose the
    // day, so writing a Monday post on a Thursday is allowed.
    t.equal('five days are pickable', outreach.weekdayPlans().length, 5);
    t.equal('and they read in order', outreach.weekdayPlans().map(p => p.id).join(','), 'monday,tuesday,wednesday,thursday,friday');
    t.check('the weekend recap is not one of them', outreach.weekdayPlans().every(p => p.id !== 'weekend'));
    t.equal('a day can be looked up by name', outreach.planById('thursday').label, 'Thursday Check-in');
    t.check('an unknown day is not invented', outreach.planById('funday') === null);
    t.equal('Monday needs no daily rows', outreach.planForDate(on('2026-08-03')).dailyMode, 'none');

    t.equal('the week starts on Monday', outreach.mondayOf(on('2026-08-07')), '2026-08-03');
    t.equal('Sunday belongs to the week that just ended', outreach.mondayOf(on('2026-08-09')), '2026-08-03');
});

suite('daily outreach: refuses to write what the data cannot back', (t) => {
    const outreach = load(t);

    const monday = outreach.PLANS.monday;
    const tuesday = outreach.PLANS.tuesday;
    const wednesday = outreach.PLANS.wednesday;

    const notInWeekly = outreach.checkCoverage(monday, { inWeekly: false, dailyRowCount: 4 });
    t.check('an associate missing from the weekly upload is blocked', notInWeekly.ok === false);
    t.equal('and the reason says why', notInWeekly.reason, 'Not in the selected weekly upload.');

    const noDailies = outreach.checkCoverage(wednesday, { inWeekly: true, dailyRowCount: 0 });
    t.check('a midweek message with no daily uploads is blocked', noDailies.ok === false);
    t.equal('and names the missing uploads', noDailies.reason, 'No uploads covering this week yet.');

    const withDailies = outreach.checkCoverage(wednesday, { inWeekly: true, dailyRowCount: 2 });
    t.check('two daily rows are enough for midweek', withDailies.ok === true);

    // Tuesday can still recap last week without Monday's numbers, so this is a
    // note on a message that goes out, not a block.
    const noMonday = outreach.checkCoverage(tuesday, { inWeekly: true, dailyRowCount: 0, hasMondayRow: false });
    t.check('Tuesday without a Monday upload still sends', noMonday.ok === true);
    t.check('but says the message is thinner than intended', /Monday/.test(noMonday.warning));

    const fullTuesday = outreach.checkCoverage(tuesday, { inWeekly: true, dailyRowCount: 1, hasMondayRow: true });
    t.check('Tuesday with a Monday upload has nothing to warn about', !fullTuesday.warning);

    t.check('Monday never asks for daily rows', outreach.checkCoverage(monday, { inWeekly: true, dailyRowCount: 0 }).ok === true);
});

suite('daily outreach: the daily recap reads like a sentence', (t) => {
    const outreach = load(t);

    const metrics = [
        { key: 'totalCalls', label: 'Volume' },
        { key: 'aht', label: 'AHT' },
        { key: 'scheduleAdherence', label: 'Adherence' }
    ];
    const formatValue = (key, value) => (key === 'totalCalls' ? String(Math.round(value)) : value.toFixed(1));

    const monday = outreach.buildDailyRecap(
        outreach.PLANS.tuesday,
        { totalCalls: 41, aht: 512.4, scheduleAdherence: 96.25 },
        { metrics, formatValue }
    );
    t.check('Tuesday names Monday explicitly', monday.indexOf('Monday looked like this') > -1);
    t.check('and lists the numbers', monday.indexOf('Volume 41, AHT 512.4, Adherence 96.3') > -1);

    const wtd = outreach.buildDailyRecap(
        outreach.PLANS.wednesday,
        { totalCalls: 118, aht: 498.0, scheduleAdherence: null },
        { metrics, formatValue, dayCount: 3 }
    );
    t.check('midweek says week to date', wtd.indexOf('Week to date (3 days in)') > -1);
    t.check('and drops the metric with no value', wtd.indexOf('Adherence') === -1);

    t.equal('one day reads singular', outreach.buildDailyRecap(
        outreach.PLANS.wednesday, { totalCalls: 40 }, { metrics, formatValue, dayCount: 1 }
    ), '📊 Week to date (1 day in): Volume 40.');

    t.equal('a plan with no daily half returns nothing', outreach.buildDailyRecap(
        outreach.PLANS.monday, { totalCalls: 40 }, { metrics, formatValue }
    ), '');

    t.equal('a rollup with nothing in it returns nothing', outreach.buildDailyRecap(
        outreach.PLANS.wednesday, { totalCalls: null, aht: null }, { metrics, formatValue, dayCount: 2 }
    ), '');
});

suite('daily outreach: the recap lands after the opening, not after the sign-off', (t) => {
    const outreach = load(t);

    const message = 'Hey Sam! Great week.\n\n🎯 Focus on hold time.\n\nLet me know how it goes.';
    const merged = outreach.insertRecap(message, '📊 Week to date: Volume 118.');
    const blocks = merged.split('\n\n');

    t.equal('the greeting still opens the message', blocks[0], 'Hey Sam! Great week.');
    t.equal('the numbers come second', blocks[1], '📊 Week to date: Volume 118.');
    t.equal('the focus keeps its place', blocks[2], '🎯 Focus on hold time.');
    t.equal('the closer stays last', blocks[3], 'Let me know how it goes.');

    t.equal('no recap leaves the message alone', outreach.insertRecap(message, ''), message);
    t.equal('no message leaves just the recap', outreach.insertRecap('', '📊 Volume 4.'), '📊 Volume 4.');
});

suite('daily outreach: a sent message stays sent', (t) => {
    const outreach = load(t);

    const monday = outreach.PLANS.monday;
    const wednesday = outreach.PLANS.wednesday;
    const ctx = { todayIso: '2026-08-05' };

    // "Have I sent Alyssa her Tuesday post this week" is the question, so every
    // day's post shares one stamp: the calendar week it went out in.
    t.equal('the Monday post is stamped with the current week', outreach.stampFor(monday, ctx), '2026-08-03');
    t.equal('and so is the Wednesday one', outreach.stampFor(wednesday, ctx), '2026-08-03');
    t.equal('a send on Friday still lands in the same week', outreach.stampFor(monday, { todayIso: '2026-08-07' }), '2026-08-03');
    t.equal('next week gets its own stamp', outreach.stampFor(monday, { todayIso: '2026-08-10' }), '2026-08-10');

    const stamp = outreach.stampFor(monday, ctx);
    t.check('nothing is sent to begin with', outreach.getSentEntry(outreach.loadSentLog(), 'monday', stamp, 'Alyssa Dimes') === null);

    outreach.markSent('monday', stamp, 'Alyssa Dimes', '2026-08-03T14:00:00.000Z');
    const entry = outreach.getSentEntry(outreach.loadSentLog(), 'monday', stamp, 'Alyssa Dimes');
    t.check('marking one records it', Boolean(entry));
    t.equal('with the time it went out', entry.at, '2026-08-03T14:00:00.000Z');

    t.check('a different associate is untouched', outreach.getSentEntry(outreach.loadSentLog(), 'monday', stamp, 'Chris Vale') === null);
    t.check('and so is the same associate next week', outreach.getSentEntry(outreach.loadSentLog(), 'monday', '2026-08-10', 'Alyssa Dimes') === null);
    t.check('a different day of the same week is tracked separately', outreach.getSentEntry(outreach.loadSentLog(), 'tuesday', stamp, 'Alyssa Dimes') === null);

    outreach.clearSent('monday', stamp, 'Alyssa Dimes');
    t.check('undo puts them back in the queue', outreach.getSentEntry(outreach.loadSentLog(), 'monday', stamp, 'Alyssa Dimes') === null);

    outreach.markSent('monday', stamp, 'Alyssa Dimes', '2026-08-03T14:00:00.000Z');
    outreach.markSent('monday', stamp, 'Chris Vale', '2026-08-03T14:05:00.000Z');
    outreach.markSent('wednesday', stamp, 'Chris Vale', '2026-08-05T14:05:00.000Z');
    outreach.clearAllSentForStamp('monday', stamp);
    const afterReset = outreach.loadSentLog();
    t.check('clearing the batch clears both reps', !outreach.getSentEntry(afterReset, 'monday', stamp, 'Alyssa Dimes')
        && !outreach.getSentEntry(afterReset, 'monday', stamp, 'Chris Vale'));
    t.check('and leaves another day alone', Boolean(outreach.getSentEntry(afterReset, 'wednesday', stamp, 'Chris Vale')));
});

suite('daily outreach: the send log does not grow forever', (t) => {
    const outreach = load(t);

    const log = {
        'monday|old|Alyssa Dimes': { at: '2026-01-05T14:00:00.000Z' },
        'monday|recent|Chris Vale': { at: '2026-07-30T14:00:00.000Z' },
        'monday|undated|Jo Park': {}
    };
    const pruned = outreach.pruneSentLog(log, '2026-08-05');

    t.check('a send from seven months back is dropped', !('monday|old|Alyssa Dimes' in pruned));
    t.check('last week survives', 'monday|recent|Chris Vale' in pruned);
    t.check('an entry with no date is kept rather than guessed at', 'monday|undated|Jo Park' in pruned);
    t.check('a nonsense cutoff leaves the log alone', Object.keys(outreach.pruneSentLog(log, 'not-a-date')).length === 3);
});
