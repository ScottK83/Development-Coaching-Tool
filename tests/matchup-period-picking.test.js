'use strict';

const { suite } = require('./harness');

/**
 * Picking which month, not just the newest one.
 *
 * The scope buttons jump to the newest period of a kind, which answers "how is
 * this month going" and never "how did June go". Getting to June meant opening a
 * dropdown holding every upload on file, which is the thing the period chips
 * were built to replace everywhere else.
 *
 * This row lists the periods inside the active scope. What is pinned here is
 * that it offers the whole scope, that it does not offer a choice of one, and
 * that fifty-odd weeks arrive collapsed rather than as four lines of chips.
 */

function names(n) {
    return Array.from({ length: n }, (_, i) => ({ name: 'Person ' + i }));
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// Twelve completed months rebuilt from weekly uploads, the way period-compare
// hands them over. Two more than a collapsed row shows.
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

// Fifteen weeks, also past the ten a row shows before it asks.
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

// The chip carries the month name alone. The provenance lives on hover, so
// asserting on the chip text means asserting between the tags.
function chipText(html, label) {
    return html.includes('>' + label + '<');
}
function chipCount(html) {
    return (html.match(/class="mu-scope-period"/g) || []).length;
}

suite('matchup periods: the months in the scope are one click each', (t) => {
    const matchup = load(t);
    matchup.setSelectedPeriodForTest('month-agg:2026-06', 'computed');
    const html = matchup.renderScopePeriods();

    t.check('the row is labelled for what it picks', html.includes('Month:'));
    t.check('the newest month is offered', chipText(html, 'December'));
    t.check('so is the one selected', chipText(html, 'June'));

    // "June (rebuilt from 4 weeks)" is what the dropdown is for. The chip is
    // the name of the month and the rest is on hover.
    t.check('the parenthetical is not chip text', !chipText(html, 'June (rebuilt from 4 weeks)'));
    t.check('but it is on hover', html.includes('June (rebuilt from 4 weeks), 120 associates'));
});

suite('matchup periods: the chosen one is marked', (t) => {
    const matchup = load(t);
    matchup.setSelectedPeriodForTest('month-agg:2026-06', 'computed');
    const html = matchup.renderScopePeriods();

    const june = html.slice(html.indexOf('month-agg:2026-06'), html.indexOf('>June<'));
    const july = html.slice(html.indexOf('month-agg:2026-07'), html.indexOf('>July<'));

    t.check('the selected month is accented', june.includes('#e65100'));
    t.check('an unselected one is not', !july.includes('#e65100'));
});

suite('matchup periods: a year of months arrives collapsed', (t) => {
    const matchup = load(t);
    matchup.setSelectedPeriodForTest('month-agg:2026-06', 'computed');
    const html = matchup.renderScopePeriods();

    t.equal('only the recent ones are shown', chipCount(html), 10);
    t.check('the oldest are held back', !chipText(html, 'January'));
    t.check('and offered rather than dropped', html.includes('Show 2 more'));

    matchup.expandScopeChipsForTest();
    const all = matchup.renderScopePeriods();
    t.equal('expanding shows the year', chipCount(all), 12);
    t.check('including the oldest', chipText(all, 'January'));
    t.check('and offers to collapse again', all.includes('Show fewer'));
});

suite('matchup periods: fifty weeks do not arrive all at once', (t) => {
    const matchup = load(t);
    // Selecting a week puts the row in the weekly scope, where there are 15.
    matchup.setSelectedPeriodForTest('2026-06-01|2026-06-15', 'weekly');
    const html = matchup.renderScopePeriods();

    t.check('the row is labelled for weeks', html.includes('Week:'));
    t.equal('only the recent ones are shown', chipCount(html), 10);
    t.check('and the rest are offered', html.includes('Show 5 more'));

    matchup.expandScopeChipsForTest();
    t.equal('expanding shows all of them', chipCount(matchup.renderScopePeriods()), 15);
});

suite('matchup periods: switching scope collapses the row again', (t) => {
    const matchup = load(t);
    matchup.setSelectedPeriodForTest('2026-06-01|2026-06-15', 'weekly');
    matchup.expandScopeChipsForTest();
    t.equal('it is open', chipCount(matchup.renderScopePeriods()), 15);

    // Otherwise switching to Weekly drops four lines of chips on someone who
    // wanted the newest week.
    matchup.setSelectedPeriodForTest('month-agg:2026-06', 'computed');
    t.equal('and closed again on the next scope', chipCount(matchup.renderScopePeriods()), 10);
});

suite('matchup periods: a scope with one period offers no choice', (t) => {
    // There is exactly one YTD file on Scott's machine. A row holding a single
    // chip reads like something failed to load rather than like a choice.
    const matchup = load(t);
    matchup.setSelectedPeriodForTest('ytd|2026-09-03', 'ytd');

    t.equal('nothing is rendered', matchup.renderScopePeriods(), '');
});

suite('matchup periods: two YTD files are a choice', (t) => {
    // The guard has to be about how many there are, not about YTD being YTD.
    const matchup = load(t, {
        ytdData: Object.assign({
            'ytd|2026-06-30': {
                metadata: { periodType: 'ytd', endDate: '2026-06-30', label: 'YTD through 2026-06-30' },
                employees: names(125)
            }
        }, YTD_ONE)
    });
    matchup.setSelectedPeriodForTest('ytd|2026-09-03', 'ytd');
    const html = matchup.renderScopePeriods();

    t.check('the row appears', html.includes('File:'));
    t.equal('with both files', chipCount(html), 2);
});

suite('matchup periods: no selection means no row', (t) => {
    const matchup = load(t);
    matchup.setSelectedPeriodForTest(null, '');

    // The scope buttons still work with nothing selected. This row cannot know
    // which scope to list, and guessing one would move the selection silently.
    t.equal('it stays out of the way', matchup.renderScopePeriods(), '');
});

suite('matchup periods: a period too small for a matchup is not offered', (t) => {
    // A single supervisor's report filed as a month is a real period with nobody
    // to match against, so it must not appear as a pickable one.
    const small = MONTHS.slice(0, 3).concat([{
        key: 'month-agg:2026-04', label: 'April (rebuilt from 1 week)',
        type: 'month-agg', source: 'computed', count: 14, endDate: '2026-04-30'
    }]);
    const matchup = load(t, { months: small });
    matchup.setSelectedPeriodForTest('month-agg:2026-01', 'computed');
    const html = matchup.renderScopePeriods();

    t.check('the full months are offered', chipText(html, 'January') && chipText(html, 'March'));
    t.check('the one-team month is not', !chipText(html, 'April'));
});
