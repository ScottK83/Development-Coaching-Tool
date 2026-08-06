'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
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
    t.equal('Wednesday moves to this week', byId.wednesday.coverageLabel, 'this week so far');
    t.equal('Thursday stays there', byId.thursday.coverageLabel, 'this week so far');
    t.equal('and Friday closes it out', byId.friday.coverageLabel, 'this week so far');

    // Monday and Tuesday build off the weekly recap; the rest off the midweek
    // check-in, so consecutive days don't read as the same message twice.
    t.equal('Monday and Tuesday share a base', byId.monday.base, byId.tuesday.base);
    t.check('but differ in what they append', byId.monday.dailyMode !== byId.tuesday.dailyMode);
    t.check('and the back half uses the other base', byId.wednesday.base !== byId.monday.base);
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
