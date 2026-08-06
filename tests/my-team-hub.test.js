'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/period-index.module.js');
    t.loadModule('modules/daily-outreach.module.js');
    t.loadModule('modules/day-posts.module.js');
    return t.loadModule('modules/my-team.module.js');
}

suite('my team: the day is the hub', (t) => {
    const modules = load(t);
    const myTeam = modules.myTeam;
    const outreach = modules.dailyOutreach;

    // Landing on My Team should open on a real weekday, never on the weekend
    // recap — you can't send a Saturday check-in.
    const day = myTeam.activeDayId();
    t.check('the default day is one of the five', outreach.WEEKDAY_IDS.indexOf(day) > -1);

    myTeam.setActiveDay('thursday');
    t.equal('a chosen day is remembered', myTeam.activeDayId(), 'thursday');

    myTeam.setActiveDay('weekend');
    t.check('a day outside the five is refused', outreach.WEEKDAY_IDS.indexOf(myTeam.activeDayId()) > -1);
    myTeam.setActiveDay('nonsense');
    t.check('and so is a day that does not exist', outreach.WEEKDAY_IDS.indexOf(myTeam.activeDayId()) > -1);
});

suite('my team: the tab strip carries the whole week at a glance', (t) => {
    const modules = load(t);
    const myTeam = modules.myTeam;

    const html = myTeam.renderDayTabs('wednesday', null);

    ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'].forEach(name => {
        t.check(`${name} has a tab`, html.indexOf('>' + name + '<') > -1 || html.indexOf(name + '</button>') > -1);
    });
    t.check('the weekend recap is not offered', html.indexOf('Weekend') === -1);

    // The quieter second group is still reachable — the point was to stop it
    // competing with the days, not to delete working features.
    ['Coaching', 'Snapshot', 'Calls', 'Attendance'].forEach(label => {
        t.check(`${label} is still one click away`, html.indexOf('>' + label + '</button>') > -1);
    });

    t.check('the selected day is marked', html.indexOf('data-day="wednesday"') > -1);
});

suite('my team: sent ticks are a per-person idea', (t) => {
    const modules = load(t);
    const myTeam = modules.myTeam;
    const outreach = modules.dailyOutreach;

    const stamp = outreach.stampFor(outreach.PLANS.monday, { todayIso: outreach.isoDate(new Date()) });
    outreach.markSent('monday', stamp, 'Alyssa Dimes', new Date().toISOString());

    const forAlyssa = myTeam.renderDayTabs('monday', 'Alyssa Dimes');
    t.check("Alyssa's Monday tab is ticked", forAlyssa.indexOf('✓ Monday') > -1);

    // A team sweep tracks sends per rep, so one tick across the whole team
    // would be a lie either way it fell.
    const forTeam = myTeam.renderDayTabs('monday', null);
    t.check('the team view claims nothing about who was sent', forTeam.indexOf('✓ Monday') === -1);
});

suite('my team: two things — one public, one private', (t) => {
    const modules = load(t);
    const myTeam = modules.myTeam;

    // The whole-team view offers exactly the two jobs a team day has: a post
    // for the channel that names people, and the private per-person round.
    const tabs = myTeam.renderDayTabs('monday', null);
    t.check('the team view is not cluttered with tone options', tabs.indexOf('mt-tone-btn') === -1);

    // Those two extra private messages only make sense for one person.
    const toneRow = myTeam.renderToneRow();
    t.check('high five is offered', toneRow.indexOf('High five') > -1);
    t.check('growth is offered', toneRow.indexOf('Growth') > -1);
    t.check('and they are framed as sending, not browsing', toneRow.indexOf('Also send') > -1);
    t.check('growth is wired to its own picker', toneRow.indexOf('data-tone="growth"') > -1);
});

suite('my team: the shout-out never invents people to praise', (t) => {
    const modules = load(t);

    // No celebrations module at all — the public post must refuse rather than
    // emit an empty channel message.
    let threw = null;
    try { modules.myTeam.renderShoutOut(); } catch (e) { threw = e; }
    t.check('a missing celebrations source is survivable', threw === null);

    // A source that returns nobody must not produce a post either.
    global.window.DevCoachModules.celebrations = {
        detectCelebrations: () => ({ celebrations: [], missed: [], dateRange: '' }),
        generateAllShoutOuts: () => 'SHOULD NOT BE USED'
    };
    let threw2 = null;
    try { modules.myTeam.renderShoutOut(); } catch (e) { threw2 = e; }
    t.check('an empty celebration list is survivable too', threw2 === null);
});

suite('my team: context degrades quietly rather than blocking the message', (t) => {
    const modules = load(t);
    const myTeam = modules.myTeam;

    // No celebrations module wired up at all.
    const html = myTeam.buildContextHtml(null);
    t.check('missing context still renders something', typeof html === 'string' && html.length > 0);
    t.check('and says so plainly', html.indexOf('Nothing standing out') > -1);

    // A celebrations module that throws must not take the day page with it.
    global.window.DevCoachModules.celebrations = {
        detectCelebrations() { throw new Error('boom'); },
        describeNoCelebration: () => 'x'
    };
    let threw = null;
    try { myTeam.buildContextHtml('Alyssa Dimes'); } catch (e) { threw = e; }
    t.check('a throwing context source is swallowed', threw === null);
});

suite('my team: rendering with no markup is a no-op', (t) => {
    const modules = load(t);
    let threw = null;
    return Promise.resolve()
        .then(() => modules.myTeam.renderDayPage())
        .then(() => modules.myTeam.initializeMyTeam())
        .catch((e) => { threw = e; })
        .then(() => t.check('no DOM to draw into is handled quietly', threw === null));
});
