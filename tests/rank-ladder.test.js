'use strict';

const { suite } = require('./harness');

/**
 * The what-if ladder inside the rank trajectory modal.
 *
 * The ladder is the one place in this app that prints a projected PLACING, and
 * it is only defensible because of what surrounds it: the frozen-field caveat,
 * the noise rule that refuses to report churn as progress, and the floors that
 * say out loud why a metric has no pace rather than dropping it off the list.
 * Strip any of those away and what is left is a confident, flattering number
 * that somebody will eventually paste into an email. So the guards are what is
 * asserted here, not just the arithmetic.
 */

/* ── Enough DOM to render into ──
   A trimmed copy of the shell in rankings-view.test.js: the ladder only needs
   the container to accept innerHTML and the theme attribute to resolve, so the
   sort-header and table-wrapper plumbing that file carries is left out. */
function installDom(t) {
    const fake = t.installFakeBrowser();
    const els = {};

    function makeEl(id) {
        return {
            id: id || '', style: {}, dataset: {}, _html: '', _appended: [], _listeners: {},
            get innerHTML() { return this._html; },
            set innerHTML(v) { this._html = String(v); this._appended = []; },
            get firstChild() { return { outerHTML: this._html }; },
            querySelector() { return null; },
            querySelectorAll() { return []; },
            appendChild(n) { this._appended.push(n); },
            addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
            setAttribute() {}, getAttribute() { return null; }
        };
    }

    els.centerRankingContent = makeEl('centerRankingContent');
    els.centerRankingTableWrapper = makeEl('centerRankingTableWrapper');
    els.rankingPeriodSelect = makeEl('rankingPeriodSelect');

    global.CSS = { escape: (s) => String(s) };
    global.document = {
        documentElement: { getAttribute: () => null },
        getElementById: (id) => els[id] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        createElement: () => makeEl(''),
        body: { appendChild() {}, removeChild() {} },
        head: { appendChild() {} }
    };

    return { els, store: fake.store };
}

/* The shell the current suite is rendering into. Held here because two of the
   suites below drive the period picker rather than taking whatever the view
   auto-selects, and the change handler is only reachable through the select
   element the render bound it to. */
let DOM = null;

function loadRankings(t, weekly, ytd) {
    DOM = installDom(t);
    global.weeklyData = weekly || {};
    global.ytdData = ytd || {};
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/on-off-tracker.module.js');
    t.loadModule('modules/rank-projection.module.js');
    t.loadModule('modules/center-ranking.module.js');
    t.loadModule('modules/period-compare.module.js');
    const M = global.window.DevCoachModules;
    global.window.getMetricRatingScore = M.metricProfiles.getRatingScore;
    // The live formatter is metric-trends.module.js:3263. This mirrors its
    // rules rather than borrowing the orphan metrics.module, which formatted
    // seconds and hours differently. See AUDIT.md 2.10.
    global.window.formatMetricDisplay = function (key, value) {
        const metric = global.window.METRICS_REGISTRY[key];
        if (!metric) return String(value);
        if (metric.unit === 'sec') return Math.round(value) + 's';
        if (metric.unit === '%') return Number(value).toFixed(1) + '%';
        if (metric.unit === 'hrs') return Number(value).toFixed(1) + ' hrs';
        return String(Math.round(value));
    };
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.window.getTeamMembersForWeek = () => [];
    global.window.getLatestWeeklyKey = () => null;
    M.centerRanking.resetPeriodSelection();
    return M.centerRanking;
}

/* Picking a period the way the page does it: put the key on the select and fire
   the handler the render attached. Assigning the module's private key directly
   would skip _onRankingPeriodChange and the re-render that follows it, which is
   where the selected period becomes the data the ladder reads. */
function pickPeriod(key) {
    const select = DOM.els.rankingPeriodSelect;
    select.value = key;
    const handlers = select._listeners.change || [];
    if (!handlers.length) throw new Error('the period select was rendered without a change handler');
    handlers[0]();
}

/* ── Fixtures ──
   Forty people spread evenly enough that the top-10 door and the middle of the
   field are both real numbers. SUBJECT sits at 91.2% adherence with the door at
   96.0%, which is roughly the gap the live board shows. */
const SUBJECT = 'P18';

function emp(name, over) {
    return Object.assign({
        name,
        totalCalls: 3000,
        surveyTotal: 40,
        reliability: 0,
        scheduleAdherence: 91.2,
        cxRepOverall: 88,
        overallSentiment: 90,
        aht: 520,
        fcr: 74,
        overallExperience: 78
    }, over || {});
}

function roster(subjectOverrides) {
    return Array.from({ length: 40 }, (_, i) => {
        const person = emp('P' + i, {
            scheduleAdherence: 84 + i * 0.4,
            cxRepOverall: 70 + i * 0.7,
            overallSentiment: 80 + i * 0.45,
            aht: 620 - i * 3,
            fcr: 60 + i * 0.9,
            overallExperience: 62 + i * 0.85
        });
        return person.name === SUBJECT ? Object.assign(person, subjectOverrides || {}) : person;
    });
}

function period(start, end, type, employees, label) {
    return {
        [`${start}|${end}`]: {
            employees,
            metadata: { startDate: start, endDate: end, periodType: type, label: label || end }
        }
    };
}

/* Two months of weeks so the trajectory itself exists — without a month series
   buildTrajectoryHtml returns its "no history yet" note and never reaches the
   ladder. The ladder reads the selected period, which is the year-to-date file. */
const WEEKS = Object.assign({},
    period('2026-06-01', '2026-06-07', 'week', roster(), 'Week ending Jun 7'),
    period('2026-06-08', '2026-06-14', 'week', roster(), 'Week ending Jun 14'),
    period('2026-07-06', '2026-07-12', 'week', roster(), 'Week ending Jul 12'),
    period('2026-07-13', '2026-07-19', 'week', roster(), 'Week ending Jul 19')
);

function ytdWith(subjectOverrides) {
    return period('2026-01-01', '2026-07-31', 'ytd', roster(subjectOverrides), 'YTD through Jul 31');
}

/* Two rebuilt months, one either side of four weeks.

   Weeks bucket into a month by the date they END on, so January 2026 holds five
   of them and opens on 28 December; February here holds only two. Neither is the
   calendar month, and both are ordinary things to find on the board: a five-week
   month happens three or four times a year, and a two-week one is what the
   current month looks like on the second Monday. */
const MONTH_WEEKS = Object.assign({},
    period('2025-12-28', '2026-01-03', 'week', roster(), 'Week ending Jan 3'),
    period('2026-01-04', '2026-01-10', 'week', roster(), 'Week ending Jan 10'),
    period('2026-01-11', '2026-01-17', 'week', roster(), 'Week ending Jan 17'),
    period('2026-01-18', '2026-01-24', 'week', roster(), 'Week ending Jan 24'),
    period('2026-01-25', '2026-01-31', 'week', roster(), 'Week ending Jan 31'),
    period('2026-02-01', '2026-02-07', 'week', roster(), 'Week ending Feb 7'),
    period('2026-02-08', '2026-02-14', 'week', roster(), 'Week ending Feb 14')
);

// The ladder block and nothing else. Bounded at both ends on purpose: the year
// table above it lists Reliability and prints ranks of its own, and the
// sideways-scroll note sits below it, so a slice open at either end would let
// these assertions pass on markup the ladder never wrote.
const LADDER_END = '</tbody></table></div>';
function ladderOf(html) {
    const at = html.indexOf('<div id="rankLadderBlock"');
    if (at === -1) return '';
    const end = html.indexOf(LADDER_END, at);
    return end === -1 ? html.slice(at) : html.slice(at, end + LADDER_END.length);
}

function rowsOf(ladder) {
    return [...ladder.matchAll(/<tr>[\s\S]*?<\/tr>/g)].map((m) => m[0]);
}

function rungsUnder(ladder, label) {
    const rows = rowsOf(ladder);
    const start = rows.findIndex((r) => r.includes('class="rank-ladder-metric">' + label + '<'));
    if (start === -1) return [];
    const out = [];
    for (let i = start + 1; i < rows.length; i++) {
        if (/class="rank-ladder-metric"/.test(rows[i])) break;
        out.push(rows[i]);
    }
    return out;
}


suite('rank ladder: the modal carries a what-if, and it is built from real blends', (t) => {
    const cr = loadRankings(t, WEEKS, ytdWith());
    cr.renderCenterRanking();
    const ladder = ladderOf(cr.buildTrajectoryHtml(SUBJECT));

    t.check('the ladder is in the trajectory modal', ladder !== '');
    t.check('and it is named for the person it is about',
        new RegExp('What a stretch would do for ' + SUBJECT).test(ladder));

    // The current figure and its placing, so the rungs have something to be
    // read against rather than floating on their own.
    t.check('adherence appears with the figure it is standing on', /91\.2%/.test(ladder));
    t.check('and with the placing that figure holds today', /#22 of 40/.test(ladder));

    const rungs = rungsUnder(ladder, 'Adherence');
    t.equal('three rungs: a week, a month, and the rest of the year', rungs.length, 3);
    t.check('every rung names the number being held', rungs.every((r) => /hold 96\.0% for/.test(r)));
    t.check('the week rung is a week', /for 1 week/.test(rungs[0]));
    t.check('the month rung is a month', /for 1 month/.test(rungs[1]));
    t.check('and the last one counts the weeks left in the year',
        /for the rest of the year/.test(rungs[2]) && /\(22 weeks\)/.test(rungs[2]));

    // The whole point of the volume weighting. Four weeks at 96% against thirty
    // weeks already banked at 91.2% is 91.8%, not the 93.6% a straight average
    // of the two numbers would promise.
    t.check('a month at the held number lands where the weighted blend puts it', /91\.8%/.test(rungs[1]));
    t.check('and nowhere near the equal-weight answer', !/93\.6%/.test(rungs[1]));
});

suite('rank ladder: a projected placing says what it is standing on', (t) => {
    const cr = loadRankings(t, WEEKS, ytdWith());
    cr.renderCenterRanking();
    const ladder = ladderOf(cr.buildTrajectoryHtml(SUBJECT));

    // The caveat is the reason this section is allowed to exist. If it ever
    // goes missing the ladder is a promise rather than a sketch.
    t.check('the frozen field is stated plainly',
        /assume every other person in the centre finishes the year exactly where they stand today/.test(ladder));
    t.check('and so is the reason it stays in this modal',
        /go into nobody&rsquo;s inbox/.test(ladder));
    t.check('the held number is justified rather than asserted',
        /standing at #10 in the centre/.test(ladder));
    t.check('and someone already inside that door is not held to it',
        /already inside that door is held to the figure at the top of the field/.test(ladder));

    // Nothing an associate reads, but the modal's own house style still holds.
    t.check('no em dashes are typed raw into the copy', !/—/.test(ladder));
});

suite('rank ladder: reliability is left off, and the ladder says why', (t) => {
    const cr = loadRankings(t, WEEKS, ytdWith());
    cr.renderCenterRanking();
    const html = cr.buildTrajectoryHtml(SUBJECT);
    const ladder = ladderOf(html);

    t.check('the year table above still carries reliability', />Reliability<\/td>/.test(html));
    t.check('but the ladder has no reliability row',
        !/class="rank-ladder-metric">Reliability</.test(ladder));
    t.check('and it is an exclusion, not an omission', /Reliability is not on the ladder/.test(ladder));
    t.check('with the reason given', /hours missed against a budget for the whole year rather than an average/.test(ladder));

    // The five that can be paced are all there, including the two survey
    // metrics that rank but sit outside the scorecard.
    ['AHT', 'Adherence', 'Sentiment', 'CX Adv', 'FCR', 'Overall Experience'].forEach((label) => {
        t.check('the ' + label + ' row is on the ladder',
            new RegExp('class="rank-ladder-metric">' + label + '<').test(ladder));
    });
});

suite('rank ladder: a move inside the noise gets no placing', (t) => {
    const cr = loadRankings(t, WEEKS, ytdWith());
    cr.renderCenterRanking();
    const ladder = ladderOf(cr.buildTrajectoryHtml(SUBJECT));
    const rungs = rungsUnder(ladder, 'Adherence');

    // One week at 96% against thirty already banked moves adherence by about a
    // sixth of a point. The field is dense enough that a sixth of a point is
    // several places, which is churn dressed as progress.
    t.check('a week barely moves the number', /91\.4%/.test(rungs[0]));
    t.check('so the rank move is refused rather than printed', /inside the noise/.test(rungs[0]));
    t.check('and no placing is smuggled in beside it', !/approx #/.test(rungs[0]));
    t.check('the month rung is still inside the noise too', /inside the noise/.test(rungs[1]));

    // The rest of the year clears the threshold, so the placing is allowed.
    t.check('a stretch that clears the threshold does get a placing', /approx #\d+/.test(rungs[2]));
    t.check('and it is the placing the frozen field actually gives', /approx #17/.test(rungs[2]));
});

suite('rank ladder: a thin row names the floor that stopped it', (t) => {
    const cr = loadRankings(t, WEEKS, ytdWith({ totalCalls: 5 }));
    cr.renderCenterRanking();
    const ladder = ladderOf(cr.buildTrajectoryHtml(SUBJECT));

    t.check('the metric is still listed rather than quietly dropped',
        /class="rank-ladder-metric">Adherence</.test(ladder));
    t.check('and the call floor is named with the number that failed it',
        /5 calls in this period, under the 20/.test(ladder));
    t.check('nothing is paced off five calls', !/hold /.test(ladder.split('<tbody>')[1] || ''));
});

suite('rank ladder: too few surveys stops the survey metrics only', (t) => {
    const cr = loadRankings(t, WEEKS, ytdWith({ surveyTotal: 1 }));
    cr.renderCenterRanking();
    const ladder = ladderOf(cr.buildTrajectoryHtml(SUBJECT));

    t.check('the survey floor is named, in surveys', /1 survey returned, under the 3/.test(ladder));
    t.check('and it stops every survey-weighted metric',
        rungsUnder(ladder, 'FCR').length === 0 &&
        rungsUnder(ladder, 'Overall Experience').length === 0 &&
        rungsUnder(ladder, 'CX Adv').length === 0);
    t.check('while the call-weighted metrics still get their rungs',
        rungsUnder(ladder, 'Adherence').length === 3 && rungsUnder(ladder, 'AHT').length === 3);
});

suite('rank ladder: a name with no place in the field gets no ladder', (t) => {
    const cr = loadRankings(t, WEEKS, ytdWith());
    cr.renderCenterRanking();

    // Nobody's ladder is better than a ladder built on a row that is not there.
    t.check('an unknown name renders no ladder block',
        ladderOf(cr.buildTrajectoryHtml('Nobody At All')) === '');
});

/* ── The pace a month is measured at ──

   Every rung is the banked volume plus so many weeks of it at a better number,
   so the per-week figure is the hinge the whole ladder swings on. Getting it
   from the calendar month rather than from the weeks the month was rebuilt out
   of moved every value and every placing, always in the flattering direction on
   a long month, and there was nothing on the page to give it away. */

suite('rank ladder: a five-week month is paced over five weeks, not four', (t) => {
    const cr = loadRankings(t, MONTH_WEEKS, ytdWith());
    cr.renderCenterRanking();
    pickPeriod('month:2026-01');

    t.check('the period being read is the five-week rebuild',
        /rebuilt from 5 weeks/.test(DOM.els.centerRankingContent.innerHTML));

    const rungs = rungsUnder(ladderOf(cr.buildTrajectoryHtml(SUBJECT)), 'Adherence');
    t.equal('the ladder is built for it', rungs.length, 3);

    // 15,000 calls banked over five weeks is 3,000 a week. One more week of them
    // at the 96.0% door takes 91.2% to exactly 92.0%. Read as a 31-day calendar
    // month the same volume paces at 3,750 and the rung claims 92.2%.
    t.check('a week ahead is a week of this month\'s real volume', /92\.0%/.test(rungs[0]));
    t.check('and not the quarter-bigger week the calendar gives', !/92\.2%/.test(rungs[0]));

    // The rung a supervisor actually reads out. 93.3% and 93.6% are a place
    // apart in a field this dense, which is the whole cost of the error.
    t.check('a month ahead lands on the blend five weeks of banked calls give', /93\.3%/.test(rungs[1]));
    t.check('rather than the flattering answer', !/93\.6%/.test(rungs[1]));
    t.check('and the placing printed beside it is the one that blend earns', /approx #17/.test(rungs[1]));
    t.check('not the one the inflated pace bought', !/approx #16/.test(rungs[1]));
});

suite('rank ladder: a two-week month is not read as a full one either', (t) => {
    const cr = loadRankings(t, MONTH_WEEKS, ytdWith());
    cr.renderCenterRanking();
    pickPeriod('month:2026-02');

    t.check('the period being read is the two-week rebuild',
        /rebuilt from 2 weeks/.test(DOM.els.centerRankingContent.innerHTML));

    const rungs = rungsUnder(ladderOf(cr.buildTrajectoryHtml(SUBJECT)), 'Adherence');

    // The error runs both ways. Six thousand calls over two weeks paces at
    // 3,000, so a month ahead is 12,000 more and the blend is 94.4%. Spread the
    // same six thousand over a 28-day February and the pace halves, the month
    // ahead shrinks with it, and the rung understates the stretch as 93.6%.
    t.check('a thin month paces on the weeks it has', /94\.4%/.test(rungs[1]));
    t.check('and is not flattened out over a calendar month it never covered', !/93\.6%/.test(rungs[1]));
});

/* ── Running out of year ── */

suite('rank ladder: the last week of the year is a week, not weeks', (t) => {
    // A year-to-date file ending on Sunday 27 December leaves four days, which
    // rounds to the one week the ladder has left to offer. Every year has
    // exactly one week that ends in this window, and the view lands on it with
    // no interaction at all: the most recent year-to-date upload is what
    // renderCenterRanking auto-picks.
    const cr = loadRankings(t, WEEKS, period('2026-01-01', '2026-12-27', 'ytd', roster(), 'YTD through Dec 27'));
    cr.renderCenterRanking();
    const ladder = ladderOf(cr.buildTrajectoryHtml(SUBJECT));

    t.check('nothing in the block counts one week as weeks', !/1 weeks/.test(ladder));

    const rungs = rungsUnder(ladder, 'Adherence');
    t.equal('the week left in the year is not printed twice', rungs.length, 2);
    t.check('the week rung is the one carrying the year end',
        /for 1 week <span[^>]*>\(the rest of the year\)<\/span>/.test(rungs[0]));
    t.check('and no second rung repeats it', !/for the rest of the year/.test(ladder));
});

suite('rank ladder: a year with weeks left in it still counts them plainly', (t) => {
    const cr = loadRankings(t, WEEKS, ytdWith());
    cr.renderCenterRanking();
    const rungs = rungsUnder(ladderOf(cr.buildTrajectoryHtml(SUBJECT)), 'Adherence');

    // The ordinary case, guarded so the December handling above cannot quietly
    // swallow the rung the rest of the year normally gets.
    t.check('the rest of the year is its own rung', /for the rest of the year/.test(rungs[2]));
    t.check('and it counts the weeks left', /\(22 weeks\)/.test(rungs[2]));
    t.check('with the standing rungs left alone',
        /for 1 week</.test(rungs[0]) && /for 1 month</.test(rungs[1]));
});
