'use strict';

const { suite } = require('./harness');

/**
 * Teams: year to date, a month or a week, each on its newest upload.
 *
 * On 2026-10-07 Scott asked whether he needed to see the file at all ("it
 * should ALWAYS be YTD"), so the file chips and the Covering list went and
 * Teams was pinned to the newest year-to-date file. On 2026-10-08 he asked for
 * month and week as well. What came back is the choice of kind, not the file
 * list: each button lands on the newest upload of its kind and names it.
 *
 * Pinned here: the three buttons, that each kind lands on its newest upload,
 * that it opens on year to date, that a kind with nothing covering the centre
 * is greyed and never chosen, and that no list of files returns.
 */

function names(n) {
    return Array.from({ length: n }, (_, i) => ({ name: 'Person ' + i }));
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// Twelve months rebuilt from weekly uploads, the way period-compare hands them over.
const MONTHS = MONTH_NAMES.map((name, i) => {
    const mo = String(i + 1).padStart(2, '0');
    return {
        key: 'month-agg:2026-' + mo,
        label: name + ' (rebuilt from 4 weeks)',
        type: 'month-agg',
        source: 'computed',
        count: 120,
        endDate: '2026-' + mo + '-28'
    };
});

const WEEKS = {};
for (let i = 1; i <= 15; i += 1) {
    const d = '2026-06-' + String(i).padStart(2, '0');
    WEEKS['2026-06-01|' + d] = {
        metadata: { periodType: 'week', endDate: d, label: 'Week ending ' + d },
        employees: names(120)
    };
}

const YTD_ONE = {
    'ytd|2026-09-03': {
        metadata: { periodType: 'ytd', endDate: '2026-09-03', label: 'YTD through 2026-09-03' },
        employees: names(127)
    }
};

function load(t, opts) {
    const o = opts || {};
    t.installFakeBrowser();

    // The module reads these as bare globals, not off window. loadModule uses an
    // indirect eval into global scope, so this is where they have to live or
    // every period list comes back empty and the assertions pass on nothing.
    global.weeklyData = o.weekly === undefined ? WEEKS : o.weekly;
    global.ytdData = o.ytdData === undefined ? YTD_ONE : o.ytdData;

    global.window.DevCoachModules.periodIndex = { periodLabel: (key) => 'Period ' + key };
    global.window.DevCoachModules.periodCompare = {
        getMonthPeriodOptions: () => (o.months === undefined ? MONTHS : o.months)
    };
    return t.loadModule('modules/matchup.module.js').matchup;
}

// One button's markup, from its data-scope to its closing tag.
function button(html, scope) {
    const at = html.indexOf('data-scope="' + scope + '"');
    return at === -1 ? '' : html.slice(at, html.indexOf('</button>', at));
}
const isActive = (btn) => btn.includes('background: #e65100');

suite('teams periods: YTD, Monthly and Weekly, opening on year to date', (t) => {
    const matchup = load(t);
    const html = matchup.renderPeriodControls();

    t.check('there is a YTD button', !!button(html, 'ytd'));
    t.check('a Monthly one', !!button(html, 'month'));
    t.check('and a Weekly one', !!button(html, 'week'));
    t.check('year to date is the one in use', isActive(button(html, 'ytd')));
    t.check('the others are not', !isActive(button(html, 'month')) && !isActive(button(html, 'week')));
    t.check('and the upload in use is named',
        html.includes('Year to date, from the newest upload: <strong>YTD through 2026-09-03</strong>'));
});

suite('teams periods: each kind lands on its newest upload', (t) => {
    const matchup = load(t, {
        ytdData: Object.assign({
            'ytd|2026-06-30': {
                metadata: { periodType: 'ytd', endDate: '2026-06-30', label: 'YTD through 2026-06-30' },
                employees: names(125)
            }
        }, YTD_ONE)
    });

    t.equal('the newest year-to-date file', matchup.periodForScope('ytd'), 'ytd|2026-09-03');
    t.equal('the newest month', matchup.periodForScope('month'), 'month-agg:2026-12');
    t.equal('the newest week', matchup.periodForScope('week'), '2026-06-01|2026-06-15');

    matchup.pickScopeForTest('month');
    const html = matchup.renderPeriodControls();
    t.check('Monthly is the one in use', isActive(button(html, 'month')));
    t.check('and the month is named',
        html.includes('Month, from the newest upload: <strong>December (rebuilt from 4 weeks)</strong>'));

    matchup.pickScopeForTest('week');
    t.check('Weekly names its week',
        matchup.renderPeriodControls().includes('Week, from the newest upload: <strong>Week ending 2026-06-15</strong>'));
});

suite('teams periods: no list of files comes back', (t) => {
    // Scott, 2026-10-07: "Do I need it to show the file?"
    const matchup = load(t);
    ['ytd', 'month', 'week'].forEach((scope) => {
        matchup.pickScopeForTest(scope);
        const html = matchup.renderPeriodControls();
        t.check(scope + ': no file chips', !html.includes('mu-scope-period'));
        t.check(scope + ': no Covering chips', !html.includes('matchupPeriodChips'));
        t.check(scope + ': no dropdown of uploads', !html.includes('matchupPeriodSelect') && !html.includes('<select'));
        t.check(scope + ': no File, Month or Week row label', !/>(File|Month|Week):</.test(html));
    });
    t.check('and the old chip row is not exported', typeof matchup.renderScopePeriods === 'undefined');
});

suite('teams periods: a kind with nothing covering the centre is greyed and never chosen', (t) => {
    const matchup = load(t, { weekly: {} });
    let html = matchup.renderPeriodControls();
    t.check('Weekly is disabled', button(html, 'week').includes(' disabled'));
    t.check('and says why', button(html, 'week').includes('No weekly upload covers enough of the centre'));

    // A stale pick must not leave the page on nothing.
    matchup.pickScopeForTest('week');
    html = matchup.renderPeriodControls();
    t.check('a pick with nothing behind it falls back to year to date', isActive(button(html, 'ytd')));
    t.equal('and there is no week to land on', matchup.periodForScope('week'), null);
});

suite('teams periods: one supervisor\'s upload is never the newest month', (t) => {
    // A single supervisor's report filed as a month is a real period with nobody
    // to match against.
    const small = MONTHS.slice(0, 3).concat([{
        key: 'month-agg:2026-04', label: 'April (rebuilt from 1 week)',
        type: 'month-agg', source: 'computed', count: 14, endDate: '2026-04-30'
    }]);
    const matchup = load(t, { months: small });
    t.equal('the newest full month is used instead', matchup.periodForScope('month'), 'month-agg:2026-03');
});

suite('teams periods: with no year-to-date file it opens on the next kind', (t) => {
    const matchup = load(t, { ytdData: {} });
    const html = matchup.renderPeriodControls();
    t.check('YTD is greyed', button(html, 'ytd').includes(' disabled'));
    t.check('and Monthly is in use', isActive(button(html, 'month')));
});
