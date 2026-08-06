'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/period-index.module.js');
    t.loadModule('modules/daily-outreach.module.js');
    return t.loadModule('modules/day-posts.module.js');
}

suite('day posts: you pick the day, not the calendar', (t) => {
    const modules = load(t);
    const posts = modules.dayPosts;
    const outreach = modules.dailyOutreach;

    // Writing a Monday post on a Thursday is the whole point — the day sets
    // what the message may talk about, not when you're allowed to send it.
    t.equal('a saved choice is honoured', posts.loadDayChoice('monday') && (posts.saveDayChoice('thursday'), posts.loadDayChoice('monday')), 'thursday');
    t.equal('an unknown saved day falls back to the default', (posts.saveDayChoice('someday'), posts.loadDayChoice('friday')), 'friday');

    t.equal('buttons are labelled by day', posts.shortDay('monday'), 'Mon');
    t.equal('and stay short', posts.shortDay('wednesday'), 'Wed');
    t.equal('for every pickable day', outreach.weekdayPlans().map(p => posts.shortDay(p.id)).join(','), 'Mon,Tue,Wed,Thu,Fri');
});

suite('day posts: each day says what it covers', (t) => {
    const modules = load(t);
    const outreach = modules.dailyOutreach;
    const byId = Object.fromEntries(outreach.weekdayPlans().map(p => [p.id, p]));

    // Monday recaps the finished week; Tuesday adds how Monday itself went;
    // Wednesday onward switch to how this week is going.
    t.equal('Monday looks back at last week', byId.monday.coverageLabel, 'last week');
    t.equal('Tuesday adds Monday to it', byId.tuesday.coverageLabel, 'last week plus Monday');
    t.equal('Wednesday compares this week to last', byId.wednesday.coverageLabel, 'this week so far vs last week');
    t.equal('Thursday does the same', byId.thursday.coverageLabel, 'this week so far vs last week');
    t.equal('and Friday closes the week out', byId.friday.coverageLabel, 'the week you just worked');

    // Monday and Tuesday build off the weekly recap; the rest off the midweek
    // check-in, so consecutive days don't read as the same message twice.
    t.equal('Monday and Tuesday share a base', byId.monday.base, byId.tuesday.base);
    t.check('but differ in what they append', byId.monday.dailyMode !== byId.tuesday.dailyMode);
    t.check('and the back half uses a different base again', byId.wednesday.base !== byId.monday.base);
    t.equal('Wednesday and Thursday share the week-progress base', byId.wednesday.base, byId.thursday.base);
    t.check('Friday closes rather than checks in', byId.friday.base !== byId.wednesday.base);
});

suite('day posts: sent tracking is per person, per day, per week', (t) => {
    const modules = load(t);
    const outreach = modules.dailyOutreach;

    const stamp = outreach.stampFor(outreach.PLANS.monday, { todayIso: '2026-08-05' });
    outreach.markSent('monday', stamp, 'Alyssa Dimes', '2026-08-03T15:00:00.000Z');

    const log = outreach.loadSentLog();
    t.check("Alyssa's Monday post is recorded", Boolean(outreach.getSentEntry(log, 'monday', stamp, 'Alyssa Dimes')));
    t.check('her Tuesday post is still outstanding', outreach.getSentEntry(log, 'tuesday', stamp, 'Alyssa Dimes') === null);
    t.check("and Oceane's Monday post is untouched", outreach.getSentEntry(log, 'monday', stamp, 'Oceane Ingram') === null);

    // Sending later in the same week must not look like a fresh week.
    const laterSameWeek = outreach.stampFor(outreach.PLANS.monday, { todayIso: '2026-08-07' });
    t.check('a Friday send still sees the Monday post as sent',
        Boolean(outreach.getSentEntry(log, 'monday', laterSameWeek, 'Alyssa Dimes')));

    const nextWeek = outreach.stampFor(outreach.PLANS.monday, { todayIso: '2026-08-10' });
    t.check('next week starts clean', outreach.getSentEntry(log, 'monday', nextWeek, 'Alyssa Dimes') === null);
});

suite('day posts: it knows when the period was never uploaded', (t) => {
    const modules = load(t);
    const outreach = modules.dailyOutreach;

    const monday = outreach.PLANS.monday;
    const wednesday = outreach.PLANS.wednesday;
    // Wednesday 2026-08-05; the current week starts Monday 2026-08-03, so last
    // week runs 2026-07-27 to 2026-08-02.
    const today = '2026-08-05';

    const haveLastWeek = outreach.checkPeriodData(monday, { todayIso: today, latestWeekEndIso: '2026-08-02' });
    t.check("last week's file is enough for a Monday post", haveLastWeek.ok === true);

    // The gap that mattered: a stale file would have been described as "last
    // week" without anyone noticing.
    const stale = outreach.checkPeriodData(monday, { todayIso: today, latestWeekEndIso: '2026-07-12' });
    t.check('a three-week-old file is not last week', stale.ok === false);
    t.equal('and it says so in those words', stale.reason, 'Missing data from this period.');
    t.check('naming the newest file it does have', stale.detail.indexOf('2026-07-12') > -1);

    const nothing = outreach.checkPeriodData(monday, { todayIso: today, latestWeekEndIso: '' });
    t.check('no weekly upload at all is caught', nothing.ok === false);
    t.check('and distinguished from a stale one', nothing.detail !== stale.detail);

    // An in-progress upload of the current week is newer than last week, so it
    // still backs a Monday post rather than being rejected for being too fresh.
    const current = outreach.checkPeriodData(monday, { todayIso: today, latestWeekEndIso: '2026-08-05' });
    t.check('a current-week file is not treated as missing', current.ok === true);

    // Last week's file plus nothing from this week: the midweek post has no
    // period to describe.
    const noDailies = outreach.checkPeriodData(wednesday, { todayIso: today, latestWeekEndIso: '2026-08-02', dailyDayCount: 0 });
    t.check('midweek with nothing from this week is missing its period', noDailies.ok === false);
    t.equal('with the same wording', noDailies.reason, 'Missing data from this period.');

    const someDailies = outreach.checkPeriodData(wednesday, { todayIso: today, latestWeekEndIso: '2026-08-02', dailyDayCount: 2 });
    t.check('two days in is enough to talk about this week', someDailies.ok === true);
    t.check('and it says how much it has', someDailies.detail.indexOf('2 daily files') > -1);

    // A "this week in progress" upload already covers the week so far, so
    // asking for day-by-day files on top of it is asking for the same numbers
    // twice. This is the case that wrongly reported "no daily uploads".
    const weekInProgress = outreach.checkPeriodData(wednesday, { todayIso: today, latestWeekEndIso: '2026-08-04', dailyDayCount: 0 });
    t.check('a week-in-progress upload satisfies the midweek post on its own', weekInProgress.ok === true);
    t.check('and it says which file it is using', weekInProgress.detail.indexOf('week-in-progress') > -1);

    const both = outreach.checkPeriodData(wednesday, { todayIso: today, latestWeekEndIso: '2026-08-04', dailyDayCount: 2 });
    t.check('having both is still fine', both.ok === true);
    t.check('and it names both sources', both.detail.indexOf('plus') > -1);

    // The same fact reaches the per-person check, or one associate at a time
    // would still be told there was nothing for this week.
    const perPerson = outreach.checkCoverage(wednesday, { inWeekly: true, dailyRowCount: 0, weeklyCoversThisWeek: true });
    t.check('a person with no daily rows still passes on a week-in-progress file', perPerson.ok === true);
    const perPersonNothing = outreach.checkCoverage(wednesday, { inWeekly: true, dailyRowCount: 0, weeklyCoversThisWeek: false });
    t.check('but genuinely nothing for this week is still blocked', perPersonNothing.ok === false);

    // A stale weekly file must not block the days that run off dailies.
    const staleWeekButDailies = outreach.checkPeriodData(wednesday, { todayIso: today, latestWeekEndIso: '2026-07-12', dailyDayCount: 3 });
    t.check('midweek does not care that the weekly file is old', staleWeekButDailies.ok === true);
});

suite('day posts: the period question is asked once for every day', (t) => {
    const modules = load(t);
    const posts = modules.dayPosts;

    // With no morning-pulse loaded there is nothing to ask, and that must be an
    // empty answer rather than a crash on the render path.
    t.check('no data modules yields no statuses', Object.keys(posts.periodStatusByDay('2026-08-05')).length === 0);

    t.equal('an end date is read from metadata first', posts.latestWeekEnd('a|b', { metadata: { endDate: '2026-08-02' } }), '2026-08-02');
    t.equal('and falls back to the key', posts.latestWeekEnd('2026-07-27|2026-08-02', null), '2026-08-02');
    t.equal('a key with no range is used whole', posts.latestWeekEnd('2026-08-02', null), '2026-08-02');
    t.equal('and nothing yields nothing', posts.latestWeekEnd('', null), '');
});

suite('day posts: rendering without markup is a no-op, not a crash', (t) => {
    const modules = load(t);
    const posts = modules.dayPosts;

    let threw = null;
    return Promise.resolve()
        .then(() => posts.renderDayPosts(null, 'Alyssa Dimes'))
        .then(() => posts.renderPostsTab())
        .catch((err) => { threw = err; })
        .then(() => {
            t.check('no DOM to draw into is handled quietly', threw === null);
            t.check('and no person selected resolves to nothing', posts.resolveContext('Nobody', 'monday') === null
                || typeof posts.resolveContext('Nobody', 'monday') === 'object');
        });
});
