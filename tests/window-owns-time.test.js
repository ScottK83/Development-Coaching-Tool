'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * ONE CONTROL OWNS TIME ON MY TEAM
 *
 * There were three, and none of them spoke to the others.
 *
 *   The "Covering" chips ranked the shout-out and the evidence panel.
 *   The weekday tabs, through resolveCheckinPeriods, wrote every private
 *     message off the newest two weekly uploads.
 *   The private-round sweep read its own remembered week and the REAL calendar
 *     weekday, so it could disagree with both of the above at once.
 *
 * Pick "Month to date" and the celebrations were ranked over September while
 * the header said "Covers last week" and the messages underneath compared two
 * weeks. The numbers were each individually right and the screen as a whole was
 * a lie.
 *
 * The chips own time now. The weekday owns tone. These pin that, because the
 * failure mode is silent: every surface keeps rendering, it just renders a
 * different fortnight than the one above it.
 */

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

suite('window owns time: every message surface is handed the window', (t) => {
    const myTeam = read('modules/my-team.module.js');

    t.check('there is one place the page asks what it is comparing',
        /function currentComparison\(\)/.test(myTeam));

    // Each of these used to reach for resolveCheckinPeriods, or for nothing at
    // all, and each of them is a message a person receives.
    t.check('the private round is written from it',
        /renderDayPosts\?\.\(messageEl, person, currentComparison\(\)\)/.test(myTeam));
    t.check('the one-person high five is written from it',
        /const periods = currentComparison\(\);/.test(myTeam));
    t.check('the sweep is handed it along with the lit tab',
        /showRunMyDayModal\([\s\S]{0,200}comparison: currentComparison\(\),[\s\S]{0,60}plan: plan/.test(myTeam));

    // The old resolver still exists for Run My Day off the Pulse tab, where no
    // window has been picked. It must not be what this page reaches for.
    t.check('and the page itself no longer resolves two weeks on its own',
        myTeam.indexOf('pulse.resolveCheckinPeriods') === -1
        && myTeam.indexOf('pulse?.resolveCheckinPeriods') === -1);
});

suite('window owns time: the weekday no longer picks a period', (t) => {
    const myTeam = read('modules/my-team.module.js');
    const dayPosts = read('modules/day-posts.module.js');

    // The default window was derived from the weekday's `covers` field, which
    // is what made the tab a second time control.
    t.check('the starting window is not read off the day plan',
        !/DEFAULT_WINDOW_BY_COVERAGE/.test(myTeam));
    t.check('it is a property of the page instead',
        /DEFAULT_WINDOW_ORDER\s*=\s*\['lastWeek'/.test(myTeam));

    // A tab marked unusable because ITS week has no upload, while the window
    // above it shows a month that does, is the disagreement made visible.
    t.check('no tab is greyed out for a period it no longer claims',
        !/const blocked = status\[plan\.id\]/.test(myTeam));
    t.check('and the same on the per-person row',
        !/const blocked = dayStatus\[plan\.id\]/.test(dayPosts));

    // What a tab does say is what it sounds like.
    t.check('the tabs describe a tone', /plan\.styleLabel/.test(myTeam));
    t.check('and so do the per-person buttons', /plan\.styleLabel/.test(dayPosts));
});

suite('window owns time: the generators take the unit from the period', (t) => {
    const pulse = read('modules/morning-pulse.module.js');

    // Three generators formatted every movement as "last week's X to this
    // week's X" whatever period they had been handed. Under a month window that
    // sentence is simply false.
    t.equal('no generator hardcodes a week any more',
        (pulse.match(/latestValue, 'week'/g) || []).length, 0);
    t.check('they read the shape of the period instead',
        (pulse.match(/describeWeekRecency\(latestKey, period, options\?\.now\)/g) || []).length >= 2);

    // The week-progress body says "how this week is going" in its own copy, so
    // it cannot be run over a month at all.
    t.check('the week-progress body is only used for a week',
        /weekShaped && \(plan\.base === 'weekProgress'/.test(pulse));
    t.check('and the week-to-date recap is left off a month',
        /if \(!weekShaped\) return finish\(base \|\| ''\);/.test(pulse));
});

suite('window owns time: any period key can be read', (t) => {
    const pulse = read('modules/morning-pulse.module.js');
    const dayPosts = read('modules/day-posts.module.js');

    // getPeriodData read weeklyData and nothing else, so naming a day file, a
    // year-to-date report or a rebuilt month at a generator produced an empty
    // message with no reason attached.
    t.check('the period reader delegates the shapes it does not store',
        /periodComparison\?\.periodFor\?\.\(periodKey\)/.test(pulse));
    t.check('and day posts goes through it rather than into the store',
        /pulse\.getPeriodDataForKey\?\.\(periods\.latestKey\)/.test(dayPosts));
    t.check('nothing on the day-post path reaches weeklyData directly',
        dayPosts.indexOf('weeklyData[') === -1);

    // The centre average had the same gap: stored only for uploads that came
    // through the wizard, so a rebuilt month silently dropped every
    // "ahead of the centre" sentence out of the message.
    t.check('the centre average is computed when none was stored',
        /function centerAveragesFor\(periodKey\)/.test(pulse));
    t.equal('and no call site keeps its own copy of that fallback',
        (pulse.match(/\? getCallCenterAverageForPeriod\(/g) || []).length, 0);
});

/* ── What the private round actually reads ── */

function loadPosts(t, comparison) {
    t.installFakeBrowser();
    t.loadModule('modules/period-index.module.js');
    t.loadModule('modules/daily-outreach.module.js');
    const posts = t.loadModule('modules/day-posts.module.js').dayPosts;

    const asked = [];
    global.window.DevCoachModules.morningPulse = {
        buildOutreachMessage: () => '',
        collectDailyRowsThisWeek: () => ({ byName: new Map(), dayCount: 0 }),
        resolveCheckinPeriods: () => ({ latestKey: 'newest|week', baselineKey: 'week|before' }),
        getPeriodDataForKey: (key) => {
            asked.push(key);
            return { metadata: { endDate: '2026-09-17' }, employees: [{ name: 'Alyssa Dimes' }] };
        }
    };
    return { posts, asked, ctx: posts.resolveContext('Alyssa Dimes', 'monday', comparison) };
}

suite('window owns time: a post is written from the window, not from the newest week', (t) => {
    const month = {
        windowId: 'mtd', unit: 'month',
        latestKey: '2026-09-01|2026-09-17', baselineKey: 'month:2026-08',
        latestLabel: 'September 2026 so far', baselineLabel: 'August 2026'
    };
    const { asked, ctx } = loadPosts(t, month);

    t.equal('the near side is the window', ctx.periods.latestKey, '2026-09-01|2026-09-17');
    t.equal('the far side is last month', ctx.periods.baselineKey, 'month:2026-08');
    t.equal('and that is the period it looked the person up in', asked[0], '2026-09-01|2026-09-17');

    // A Monday post over a month is a Monday-toned message about September. It
    // must not be refused for a reason about weeks.
    t.check('a month backs a Monday post', ctx.periodCheck.ok === true);
    t.check('and the person is covered by it', ctx.coverage.ok === true);
});

suite('window owns time: no window falls back to what it always did', (t) => {
    const { ctx } = loadPosts(t, null);

    // Run My Day off the Pulse tab passes no window, and must keep working.
    t.equal('the newest two weekly uploads', ctx.periods.latestKey, 'newest|week');
    t.equal('exactly as before', ctx.periods.baselineKey, 'week|before');
});

suite('window owns time: a window with no other side still sends, and says so', (t) => {
    const lonely = {
        windowId: 'mtd', unit: 'month',
        latestKey: '2026-09-01|2026-09-17', baselineKey: null,
        latestLabel: 'September 2026 so far', baselineLabel: '',
        reason: 'Nothing uploaded covers August 2026 yet.'
    };
    const { ctx } = loadPosts(t, lonely);

    t.check('the message is not blocked', ctx.periodCheck.ok === true);
    t.check('it is warned instead', ctx.coverage.warning.length > 0);
    t.check('and the warning carries the reason',
        ctx.coverage.warning.indexOf('August 2026') > -1);
});

suite('window owns time: a window nothing backs is refused by name', (t) => {
    const empty = {
        windowId: 'mtd', unit: 'month',
        latestKey: null, baselineKey: null,
        latestLabel: '', baselineLabel: '',
        reason: 'No month-to-date upload for this month yet.'
    };
    const { ctx } = loadPosts(t, empty);

    t.check('there is no period to write from', ctx.periodCheck.ok === false);
    t.check('and the window says which upload is missing',
        ctx.periodCheck.detail.indexOf('month-to-date') > -1);
});
