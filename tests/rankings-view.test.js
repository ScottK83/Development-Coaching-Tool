'use strict';

const { suite } = require('./harness');

/**
 * The Rankings view itself — the part the logic tests could not see.
 *
 * Every case here was a defect found by rendering the real view rather than
 * calling into it:
 *
 *  - A rebuilt month is offered in the period dropdown but is stored under no
 *    key, so the guard that drops stale selections threw it away the instant it
 *    was made and the view snapped silently back to the auto-picked YTD.
 *  - The movement column always answered about months, whatever period was
 *    selected. Picking a week changed the header and the table and left the
 *    column alone, which reads as a stuck panel rather than a deliberate one.
 *  - Movement measured into the NEWEST period rather than the selected one, so
 *    a week from three weeks ago was shown beside this week's movement.
 *  - A one-team upload filed as a month sits in the Monthly group above the full
 *    months, indistinguishable from them until it is opened.
 */

/* ── Enough DOM to render into ──
   Only what center-ranking touches. The container publishes the table wrapper
   the way a real document would, because renderRankingTable looks it up by id
   after the container's markup is written. */
function installDom(t, theme) {
    const fake = t.installFakeBrowser();
    const els = {};

    function makeEl(id) {
        return {
            id: id || '', style: {}, dataset: {}, _html: '', _appended: [], _listeners: {},
            get innerHTML() { return this._html; },
            set innerHTML(v) { this._html = String(v); this._appended = []; },
            get firstChild() { return { outerHTML: this._html }; },
            querySelector(sel) {
                const m = this._html.match(new RegExp('<' + sel + '[^>]*>[\\s\\S]*?</' + sel + '>'));
                return m ? { __outer: m[0] } : null;
            },
            querySelectorAll(sel) {
                if (sel !== '.rank-sort-header') return [];
                return [...this.rendered.matchAll(/<th class="rank-sort-header" data-sort="([^"]+)"/g)]
                    .map((m) => { const th = makeEl(''); th.dataset.sort = m[1]; return th; });
            },
            appendChild(n) { this._appended.push(n); },
            addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); },
            fire(type) { (this._listeners[type] || []).forEach((fn) => fn.call(this)); },
            setAttribute() {}, getAttribute() { return null; },
            get rendered() {
                return this._appended.length
                    ? this._appended.map((n) => n.__outer || n.outerHTML || '').join('\n')
                    : this._html;
            }
        };
    }

    const container = makeEl('centerRankingContent');
    els.centerRankingContent = container;
    els.centerRankingTableWrapper = makeEl('centerRankingTableWrapper');
    els.rankingPeriodSelect = makeEl('rankingPeriodSelect');

    let containerHtml = '';
    Object.defineProperty(container, 'innerHTML', {
        get() { return containerHtml; },
        set(v) {
            containerHtml = String(v);
            const m = containerHtml.match(/<div id="centerRankingTableWrapper"[\s\S]*$/);
            els.centerRankingTableWrapper._html = m ? m[0] : '';
            els.centerRankingTableWrapper._appended = [];
            els.centerRankingTableWrapper._listeners = {};
        }
    });

    global.CSS = { escape: (s) => String(s) };
    global.document = {
        documentElement: { getAttribute: (a) => (a === 'data-theme' ? (theme || null) : null) },
        getElementById: (id) => els[id] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        addEventListener() {},
        createElement: () => makeEl(''),
        body: { appendChild() {}, removeChild() {} },
        head: { appendChild() {} }
    };

    return { els, store: fake.store, shell: () => containerHtml, table: () => els.centerRankingTableWrapper.rendered };
}

function loadRankings(t, weekly, ytd, theme) {
    const dom = installDom(t, theme);
    global.weeklyData = weekly || {};
    global.ytdData = ytd || {};
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/metrics.module.js');
    t.loadModule('modules/on-off-tracker.module.js');
    t.loadModule('modules/center-ranking.module.js');
    t.loadModule('modules/period-compare.module.js');
    const M = global.window.DevCoachModules;
    global.window.getMetricRatingScore = M.metrics.getMetricRatingScore;
    global.window.formatMetricDisplay = M.metrics.formatMetricDisplay;
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;
    global.window.getTeamMembersForWeek = () => [];
    global.window.getLatestWeeklyKey = () => null;
    M.centerRanking.resetPeriodSelection();
    return { dom, cr: M.centerRanking, pc: M.periodCompare };
}

/* ── Fixtures ──
   Enough people to clear the 30-employee floor buildCenterRankings applies, and
   spread across scores so ranks actually move. */
function emp(name, over) {
    return Object.assign({
        name,
        totalCalls: 100,
        surveyTotal: 10,
        reliability: 0,
        scheduleAdherence: 95,
        cxRepOverall: 90,
        overallSentiment: 92,
        aht: 500
    }, over || {});
}
function roster(n, shift) {
    return Array.from({ length: n }, (_, i) => emp('P' + i, {
        scheduleAdherence: 78 + ((i + (shift || 0)) % 22),
        cxRepOverall: 70 + ((i * 3 + (shift || 0)) % 30),
        aht: 400 + ((i * 7 + (shift || 0)) % 200)
    }));
}
function period(start, end, type, employees, label) {
    return {
        [`${start}|${end}`]: {
            employees,
            metadata: { startDate: start, endDate: end, periodType: type, label: label || end }
        }
    };
}

/* Four weeks in June, four in July — enough for both months to rebuild, and for
   week-over-week to have a pair to work with. */
const WEEKS = Object.assign({},
    period('2026-06-01', '2026-06-07', 'week', roster(40, 0), 'Week ending Jun 7'),
    period('2026-06-08', '2026-06-14', 'week', roster(40, 1), 'Week ending Jun 14'),
    period('2026-06-15', '2026-06-21', 'week', roster(40, 2), 'Week ending Jun 21'),
    period('2026-06-22', '2026-06-28', 'week', roster(40, 3), 'Week ending Jun 28'),
    period('2026-07-06', '2026-07-12', 'week', roster(40, 5), 'Week ending Jul 12'),
    period('2026-07-13', '2026-07-19', 'week', roster(40, 8), 'Week ending Jul 19'),
    period('2026-07-20', '2026-07-26', 'week', roster(40, 11), 'Week ending Jul 26')
);

const YTD = period('2026-01-01', '2026-07-31', 'ytd', roster(40, 4), 'YTD through Jul 31');

/* ── The selection that used to vanish ── */

suite('rankings view: a rebuilt month can actually be selected', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();

    t.check('the rebuilt month is offered', /value="month:2026-07"/.test(dom.shell()));

    dom.els.rankingPeriodSelect.value = 'month:2026-07';
    dom.els.rankingPeriodSelect.fire('change');

    // The bug: 'month:' keys live in neither store, so the guard that drops
    // deleted periods dropped this one too and the view fell back to auto.
    t.check('and it stays selected after the re-render',
        /value="month:2026-07"[^>]*selected/.test(dom.shell()));
    t.check('the table is built from that month, not the fallback',
        /Source: July 2026 \(rebuilt from 3 weeks\)/.test(dom.shell()));
});

suite('rankings view: a period that really is gone is still dropped', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();

    dom.els.rankingPeriodSelect.value = '2026-01-01|2026-01-07';
    dom.els.rankingPeriodSelect.fire('change');

    t.check('an unresolvable key falls back rather than rendering nothing',
        /Full Center Rankings/.test(dom.shell()));
    t.check('and is not left selected', !/value="2026-01-01\|2026-01-07"[^>]*selected/.test(dom.shell()));
});

/* ── Movement follows the period selector ── */

suite('rankings view: movement follows the selected period, not always months', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();

    dom.els.rankingPeriodSelect.value = '2026-07-20|2026-07-26';
    dom.els.rankingPeriodSelect.fire('change');

    t.check('a weekly period gets week-over-week movement',
        /data-sort="mom"[^>]*>WoW/.test(dom.table()));
    t.check('and the caption names the two weeks',
        /Movement: <strong>Week ending Jul 19<\/strong> &rarr; <strong>Week ending Jul 26<\/strong>/.test(dom.shell()));

    dom.els.rankingPeriodSelect.value = 'month:2026-07';
    dom.els.rankingPeriodSelect.fire('change');

    t.check('a monthly period goes back to month-over-month',
        /data-sort="mom"[^>]*>MoM/.test(dom.table()));
    t.check('and the caption names the two months',
        /Movement: <strong>June 2026<\/strong> &rarr; <strong>July 2026<\/strong>/.test(dom.shell()));
});

suite('rankings view: movement measures into the selected period', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();

    // Jul 26 is the newest completed week. Picking an older one must not show
    // the newest week's movement beside an older week's ranks.
    dom.els.rankingPeriodSelect.value = '2026-07-06|2026-07-12';
    dom.els.rankingPeriodSelect.fire('change');

    const caption = (dom.shell().match(/Movement:[\s\S]*?<\/span>/) || [''])[0];
    t.check('the selected week is the one measured into',
        /Movement: <strong>Week ending Jun 28<\/strong> &rarr; <strong>Week ending Jul 12<\/strong>/.test(caption));
    t.check('the newest week is nowhere in the caption', !/Week ending Jul 26/.test(caption));
});

suite('rankings view: one period of a kind falls back to months, and says so', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();

    dom.els.rankingPeriodSelect.value = '2026-01-01|2026-07-31';
    dom.els.rankingPeriodSelect.fire('change');

    t.check('a lone year-to-date file cannot be compared against itself',
        /Only one year-to-date file is available/.test(dom.shell()));
    t.check('so months are shown instead',
        /Movement: <strong>June 2026<\/strong> &rarr; <strong>July 2026<\/strong>/.test(dom.shell()));
});

/* ── The two rank scales ── */

suite('rankings view: the two rank scales are reconciled out loud', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();
    dom.els.rankingPeriodSelect.value = 'month:2026-07';
    dom.els.rankingPeriodSelect.fire('change');

    // The table ranks everyone in the period; movement ranks only the people in
    // both periods, over a different window. The head counts agree here, which is
    // exactly when the window difference has to be said anyway — a reader told the
    // only difference is a count concludes the ranks are broken.
    const shell = dom.shell();
    const shared = (shell.match(/ranked across the (\d+) scored in both/) || [])[1];
    const scored = (shell.match(/(\d+) employees scored/) || [])[1];
    t.check('the shared population is stated', !!shared);
    t.check('the counts agree in this fixture', shared === scored);
    t.check('and the window is still named, because that is the half that gets missed',
        /Rank in the table is <strong>in July 2026<\/strong>/.test(shell));
    t.check('said as a window, not as a head count',
        /a different window from the movement column/.test(shell));
});

/* ── Tie shuffles stay distinguishable ── */

suite('rankings view: a move with no score behind it is greyed and starred', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();
    dom.els.rankingPeriodSelect.value = 'month:2026-07';
    dom.els.rankingPeriodSelect.fire('change');

    const table = dom.table();
    const cells = [...table.matchAll(/<tr class="ranking-row"[\s\S]*?<\/tr>/g)]
        .map((r) => [...r[0].matchAll(/<td[\s\S]*?<\/td>/g)].map((m) => m[0])[1] || '');

    const starred = cells.filter((c) => /opacity:0\.7/.test(c));
    t.check('some rows moved on tiebreakers alone', starred.length > 0);
    t.check('every one of them is greyed, never green or red',
        starred.every((c) => /color: var\(--text-tertiary\)/.test(c)));
    t.check('and says why on hover',
        starred.every((c) => /position shifted among tied people/.test(c)));

    const real = cells.filter((c) => /font-weight: bold/.test(c) && /&#96[56]0;/.test(c));
    t.check('a real move is coloured and unstarred',
        real.length > 0 && real.every((c) => !/opacity:0\.7/.test(c)));
});

suite('rankings view: a move with no score change sinks in a biggest-movers sort', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();
    dom.els.rankingPeriodSelect.value = 'month:2026-07';
    dom.els.rankingPeriodSelect.fire('change');

    function momCells() {
        return [...dom.table().matchAll(/<tr class="ranking-row"[\s\S]*?<\/tr>/g)]
            .map((r) => [...r[0].matchAll(/<td[\s\S]*?<\/td>/g)].map((m) => m[0])[1] || '');
    }
    // Sorted on real movement only. A tie shuffle (starred) and a person absent
    // from one side (dotted) have nothing to sort on, so both must land below
    // every actual move. A held rank renders as a dash and sorts as the zero it
    // is, which is why dashes are not in this set.
    const isUnearned = (cell) => /opacity:0\.7/.test(cell) || /&middot;/.test(cell);
    const isMove = (cell) => /&#9650;|&#9660;/.test(cell) && !/opacity:0\.7/.test(cell);
    function unearnedAboveAnyMove(cells) {
        const lastMove = cells.map(isMove).lastIndexOf(true);
        return cells.slice(0, lastMove + 1).some(isUnearned);
    }

    // The module attaches its handlers to the elements its own querySelectorAll
    // returned, so capture them on the way past.
    const wrapper = dom.els.centerRankingTableWrapper;
    const origQsa = wrapper.querySelectorAll.bind(wrapper);
    let headers = [];
    wrapper.querySelectorAll = function (sel) { const r = origQsa(sel); headers = r; return r; };
    cr.renderCenterRanking();
    wrapper.querySelectorAll = origQsa;

    const momHeader = headers.find((h) => h.dataset.sort === 'mom');
    t.check('the movement column is sortable', !!momHeader);
    if (!momHeader) return;

    momHeader.fire('click');           // biggest risers first
    const desc = momCells();
    t.check('some rows have nothing to sort on', desc.some(isUnearned));
    t.check('sorted by biggest movers, none of them outranks a real move',
        !unearnedAboveAnyMove(desc));

    momHeader.fire('click');           // biggest fallers first
    t.check('and reversing the sort does not float them to the top either',
        !unearnedAboveAnyMove(momCells()));
});

/* ── Partial uploads in the picker ── */

suite('rankings view: a one-team upload filed as a month is labelled', (t) => {
    const weekly = Object.assign({}, WEEKS,
        period('2026-07-01', '2026-07-31', 'month', roster(6, 0), 'July 2026'),
        period('2026-06-01', '2026-06-30', 'month', roster(40, 0), 'June 2026'));

    const { dom, cr } = loadRankings(t, weekly, YTD);
    cr.renderCenterRanking();
    const shell = dom.shell();

    t.check('the thin month is still offered', /July 2026 \(6 employees/.test(shell));
    t.check('but it says what it is', /July 2026 \(6 employees &mdash; partial upload\)/.test(shell));
    t.check('a full month carries no such mark', /June 2026 \(40 employees\)/.test(shell));
});

/* ── Dark theme ── */

suite('rankings view: nothing is left on a light background in dark mode', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD, 'dark');
    global.window.getTeamMembersForWeek = () => ['P0', 'P1', 'P2'];
    cr.renderCenterRanking();
    const shell = dom.shell();

    // The text on these panels is var(--text-primary) / var(--text-secondary),
    // which is near-white in dark mode. A pale hard-coded panel behind it is
    // unreadable, and this view had three of them.
    const PALE = /background: #(e3f2fd|e8f5e9|f1f8e9|fbe9e7|bbdefb)/;
    t.check('the header banner is not pale blue', !PALE.test(shell));
    t.check('the team cards are rendered at all', /ranking-card-name/.test(shell));
    t.check('and none of them is on a pale panel',
        !PALE.test(shell.slice(shell.indexOf('Your Team'))));

    const light = loadRankings(t, WEEKS, YTD);
    global.window.getTeamMembersForWeek = () => ['P0', 'P1', 'P2'];
    light.cr.renderCenterRanking();
    t.check('while light mode keeps the pale panels it was designed with',
        PALE.test(light.dom.shell()));
});

/* ── Survey values ── */

suite('rankings view: a thin survey sample is hidden from ranking, not erased', (t) => {
    const { cr } = loadRankings(t, WEEKS, YTD);

    // Two surveys is below the ranking floor, so the survey metrics are blanked
    // for placing purposes — 100% off two responses must not out-rank a real
    // week. The scores themselves are still true, and callouts that judge
    // against 100 rather than against the floor read them from surveyValues.
    const rows = cr.scoreAndRankEmployees([
        { name: 'Thin Sample', aht: 400, scheduleAdherence: 96, overallSentiment: 92,
          cxRepOverall: 100, fcr: 100, overallExperience: 100, surveyTotal: 2, totalCalls: 80 },
        { name: 'Full Sample', aht: 410, scheduleAdherence: 95, overallSentiment: 91,
          cxRepOverall: 100, fcr: 100, overallExperience: 100, surveyTotal: 9, totalCalls: 90 }
    ], 2026);

    const thin = rows.find((r) => r.name === 'Thin Sample');
    const full = rows.find((r) => r.name === 'Full Sample');

    t.equal('the thin sample is withheld from the ranking values', thin.extraValues.fcr, null);
    t.equal('and so is its overall experience', thin.extraValues.overallExperience, null);
    t.equal('but the score itself survives', thin.surveyValues.fcr, 100);
    t.equal('all of them do', thin.surveyValues.overallExperience, 100);
    t.equal('rep satisfaction included', thin.surveyValues.cxRepOverall, 100);
    t.equal('and the sample size travels with them', thin.surveyTotal, 2);

    t.equal('a real sample is not withheld anywhere', full.extraValues.fcr, 100);
    t.equal('and reads the same either way', full.surveyValues.fcr, 100);

    // A metric that was never uploaded stays absent rather than turning into a
    // zero somebody could be congratulated for.
    const missing = cr.scoreAndRankEmployees([
        { name: 'No Surveys', aht: 400, scheduleAdherence: 96, overallSentiment: 92,
          surveyTotal: 0, totalCalls: 80 }
    ], 2026)[0];
    t.equal('an unscored survey metric is null, not zero', missing.surveyValues.fcr, null);
});

/* ── The two scales, on the cards themselves ──
   The complaint that produced all of this: a card reading "#9 of 126" directly
   above "#21 in July 2026, #29 in August 2026". Three ranks in a column, two of
   them stamped with a month and one bare, so they read as a sequence and the
   sequence is impossible. */

suite('rankings view: a team card says which window its rank is from', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    global.window.getTeamMembersForWeek = () => ['P0', 'P1', 'P2'];
    cr.renderCenterRanking();          // auto-picks the year-to-date file
    const shell = dom.shell();
    const team = shell.slice(shell.indexOf('Your Team'));

    // Three rounds of the same misread said a trailing "year to date" after
    // "of 126" was not enough: the eye stops at the big number and moves on to
    // the movement line, which names its months. The window is now a badge hard
    // against the number, before anything else can be read instead.
    t.check('the window is a badge on the number itself',
        /#\d+<\/span><span[^>]*text-transform: uppercase[^>]*>Year to date<\/span>/.test(team));
    t.check('every card carries it', (team.match(/>Year to date<\/span>/g) || []).length === 3);
    t.check('the caption names that window too',
        /ranks <strong>year to date<\/strong>/.test(team));
    t.check('and names the movement window separately',
        /separate <strong>June 2026<\/strong> &rarr; <strong>July 2026<\/strong> comparison/.test(team));
    t.check('and says outright that the two do not line up',
        /not on the same scale/.test(team));
});

suite('rankings view: the card percentile points the way it reads', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    global.window.getTeamMembersForWeek = () => ['P0', 'P1', 'P2'];
    cr.renderCenterRanking();
    const team = dom.shell().slice(dom.shell().indexOf('Your Team'));

    // The old line printed a percentile-RANK under a "top N%" label, so #9 of 126
    // read "top 94%" and the worst performer on the panel read "top 9%".
    t.check('nothing claims to be top anything', !/\(top \d+%\)/.test(team));

    const cards = [...team.matchAll(/#(\d+)<\/span><span[^>]*>[^<]*<\/span><span[^>]*>of (\d+) &mdash; better than (\d+)%/g)]
        .map((m) => ({ rank: +m[1], total: +m[2], ahead: +m[3] }));
    t.equal('every card carries the figure', cards.length, 3);
    t.check('it is the share of the centre they finished ahead of',
        cards.every((c) => c.ahead === Math.round(((c.total - c.rank) / (c.total - 1)) * 100)));
    t.check('so a better rank number beats more people, not fewer',
        cards.slice().sort((a, b) => a.rank - b.rank)[0].ahead === Math.max(...cards.map((c) => c.ahead)));
});

/* ── A month still being lived in ── */

// Weeks ending in the last `count` calendar months, current month last. Returns
// null when that span would cross into last year, which the month bucketing
// filters out by year — there is nothing to assert in that case.
function monthsEndingNow(count) {
    const now = new Date();
    const out = [];
    for (let back = count - 1; back >= 0; back--) {
        const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
        if (d.getFullYear() !== now.getFullYear()) return null;
        out.push(String(d.getFullYear()) + '-' + String(d.getMonth() + 1).padStart(2, '0'));
    }
    return out;
}

function weeksIn(monthKeys, perMonth) {
    let weeks = {};
    monthKeys.forEach((mo, i) => {
        for (let w = 0; w < (perMonth || 2); w++) {
            const end = mo + '-' + String(7 * (w + 1)).padStart(2, '0');
            weeks = Object.assign(weeks, period(mo + '-01', end, 'week', roster(40, i * 3 + w), 'Week ending ' + end));
        }
    });
    return weeks;
}

suite('period compare: a month still being lived in is not compared as a finished one', (t) => {
    const months = monthsEndingNow(3);
    if (!months) {
        // January and February have no two complete months behind them in-year.
        t.check('skipped — the current month has no complete pair behind it this year', true);
        return;
    }
    const { pc } = loadRankings(t, weeksIn(months), null);
    const mv = pc.buildMovementForScope('month');

    t.check('a comparison is still produced', !!mv);
    // Two weeks of this month against four of last month moves people tens of
    // ranks on sample size alone, and the head-count guard never catches it
    // because the roster barely changes.
    t.equal('the unfinished month is not the current side', mv.current.key, months[1]);
    t.equal('the two complete months are what is compared', mv.previous.key, months[0]);
    t.check('and the one that was set aside is named',
        mv.skippedInProgress && mv.skippedInProgress.key === months[2]);
    t.check('the comparison is not flagged as unfinished', !mv.comparingInProgress);
});

suite('period compare: an unfinished month is kept when it is the only comparison there is', (t) => {
    const months = monthsEndingNow(2);
    if (!months) {
        t.check('skipped — January has no complete month behind it this year', true);
        return;
    }
    const { pc } = loadRankings(t, weeksIn(months), null);
    const mv = pc.buildMovementForScope('month');

    // Stepping over it here would leave nothing at all, and a blank column is
    // worse than a flagged one.
    t.check('the comparison survives', !!mv);
    t.equal('the unfinished month is used', mv.current.key, months[1]);
    t.check('nothing was stepped over', !mv.skippedInProgress);
    t.check('but the caller is told it is unfinished', mv.comparingInProgress === true);
});

suite('rankings view: setting a month aside says so on screen', (t) => {
    const months = monthsEndingNow(3);
    if (!months) {
        t.check('skipped — the current month has no complete pair behind it this year', true);
        return;
    }
    // A lone year-to-date file is the setup that reaches month scope: it has
    // nothing to compare itself against, so the panel falls back to months.
    const ytd = period(months[0].slice(0, 4) + '-01-01', months[2] + '-07', 'ytd',
        roster(40, 4), 'YTD so far');
    const { dom, cr } = loadRankings(t, weeksIn(months), ytd);
    cr.renderCenterRanking();

    // Without this a comparison that stops short of today just looks like uploads
    // went missing.
    t.check('the header explains why the comparison stops short of today',
        /is still in progress[\s\S]{0,120}so it is set aside/.test(dom.shell()));
});

/* ── A KPI with no data is not a failed KPI ── */

suite('rankings: a missing KPI neither pads nor drags the sort', (t) => {
    const { cr } = loadRankings(t, WEEKS, YTD);

    // Identical records but for the survey column, which one of them has no data
    // for at all. Raw counts put the complete sweep (5 met, 15) above the thin
    // sweep (4 met, 12) — a whole tier of separation for missing data, while the
    // band printed beside it is already normalised and calls both Exceptional.
    const rows = cr.scoreAndRankEmployees([
        { name: 'Thin Sweep', aht: 380, scheduleAdherence: 99, overallSentiment: 97,
          reliability: 0, surveyTotal: 0, totalCalls: 100 },
        { name: 'Full Sweep', aht: 380, scheduleAdherence: 99, overallSentiment: 97,
          reliability: 0, cxRepOverall: 99, surveyTotal: 20, totalCalls: 100 }
    ], 2026);
    const thin = rows.find((r) => r.name === 'Thin Sweep');
    const full = rows.find((r) => r.name === 'Full Sweep');

    t.equal('the thin record is measured on four KPIs', thin.measuredCount, 4);
    t.equal('the full one on five', full.measuredCount, 5);
    t.check('both swept everything they were measured on',
        thin.kpisMet === thin.measuredCount && full.kpisMet === full.measuredCount);
    t.check('raw counts alone would have separated them', thin.kpisMet < full.kpisMet);
    t.check('scaled to a five-KPI basis they are level',
        Math.abs(thin.rankKpisMet - full.rankKpisMet) < 1e-9 &&
        Math.abs(thin.rankScoreSum - full.rankScoreSum) < 1e-9);
    t.check('a fully measured record is left exactly as it was',
        full.rankKpisMet === full.kpisMet && full.rankScoreSum === full.scoreSum);
    // Level on the first two priorities, so the rank total decides — and a blank
    // metric takes the worst rank there, which is what breaks the tie.
    t.check('and the fully measured record still wins the tie', full.rank < thin.rank);
});

suite('rankings: too little measured to stand in for a scorecard is not scaled up', (t) => {
    const { cr } = loadRankings(t, WEEKS, YTD);

    // Two KPIs at 3 is not an exceptional year. Pro-rating it to 15 would crown
    // somebody the centre has almost no data on.
    const rows = cr.scoreAndRankEmployees([
        { name: 'Two KPIs', aht: 380, scheduleAdherence: 99, surveyTotal: 0, totalCalls: 100 },
        { name: 'Full Sweep', aht: 380, scheduleAdherence: 99, overallSentiment: 97,
          reliability: 0, cxRepOverall: 99, surveyTotal: 20, totalCalls: 100 }
    ], 2026);
    const two = rows.find((r) => r.name === 'Two KPIs');
    const full = rows.find((r) => r.name === 'Full Sweep');

    t.equal('only two KPIs were measured', two.measuredCount, 2);
    t.equal('so the raw count is what ranks it', two.rankKpisMet, two.kpisMet);
    t.equal('and the raw score sum too', two.rankScoreSum, two.scoreSum);
    t.check('which puts it behind a full scorecard', full.rank < two.rank);
});

suite('rankings view: the KPI count prints the denominator it actually has', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    global.window.getTeamMembersForWeek = () => ['P0', 'P1', 'P2'];
    cr.renderCenterRanking();
    const team = dom.shell().slice(dom.shell().indexOf('Your Team'));

    // "4/5 KPIs met" beside "Score: 12/12" states the same record two
    // incompatible ways. The denominator follows measuredCount on both.
    const pairs = [...team.matchAll(/Score: (\d+)\/(\d+) \(KPI: [\d.]+\)[\s\S]*?(\d+)\/(\d+) KPIs met/g)];
    t.equal('every card was read', pairs.length, 3);
    t.check('the score denominator and the KPI denominator agree',
        pairs.every((m) => Number(m[2]) === Number(m[4]) * 3));
});

/* ── Reliability is a year, not a slice ── */

suite('rankings view: a week is scored on the year\'s missed hours, not the week\'s', (t) => {
    const REL_WEEKS = period('2026-07-20', '2026-07-26', 'week',
        roster(40, 11).map((e) => Object.assign({}, e, { reliability: 0 })), 'Week ending Jul 26');
    const REL_YTD = period('2026-01-01', '2026-07-31', 'ytd',
        roster(40, 4).map((e, i) => Object.assign({}, e, { reliability: i === 0 ? 30 : 2 })),
        'YTD through Jul 31');

    const { cr } = loadRankings(t, REL_WEEKS, REL_YTD);

    // A weekly upload carries hours missed IN THAT WEEK; the budget it is scored
    // against is 18 for the whole year. Scoring 0 against 18 hands the entire
    // centre a free KPI, and the movement column beside it — built the other way
    // — then disagrees about the same person in the same period.
    const week = cr.buildRankingsForPeriod('2026-07-20|2026-07-26');
    const p0 = week.rankings.find((r) => r.name === 'P0');
    t.equal('the running year-to-date total is what gets scored', p0.reliability, 30);
    t.equal('so a blown budget still scores a 1', p0.scores.reliability, 1);
    t.equal('the week figure is kept for coaching', p0.reliabilityAccrued, 0);

    const p1 = week.rankings.find((r) => r.name === 'P1');
    t.equal('and someone inside budget keeps their 3', p1.scores.reliability, 3);

    // A year-to-date file already carries the running total in that column.
    const ytd = cr.buildRankingsForPeriod('2026-01-01|2026-07-31');
    t.equal('a year-to-date file is left exactly as uploaded',
        ytd.rankings.find((r) => r.name === 'P0').reliability, 30);
});

/* ── The movement column, beside a rank column counting something else ── */

suite('rankings view: the movement column names the ranks it moved between', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();          // year-to-date table, month-over-month movement

    const cells = [...dom.table().matchAll(/<tr class="ranking-row"[\s\S]*?<\/tr>/g)]
        .map((r) => [...r[0].matchAll(/<td[\s\S]*?<\/td>/g)].map((m) => m[0]));
    t.check('the table rendered', cells.length > 0);

    // The Rank column and this one count over different periods. A bare "39"
    // has nothing to be measured from except the rank sitting next to it, and
    // "21, down 39" subtracts to minus eighteen.
    const moved = cells.filter((c) => /&#96[56]0;\d/.test(c[1]));
    t.check('some rows moved', moved.length > 0);
    t.check('every one of them shows the pair it moved between',
        moved.every((c) => /#\d+&rarr;\d+/.test(c[1])));

    const pairs = moved.map((c) => ({
        rank: Number((c[0].match(/>(\d+)<\/td>/) || [])[1]),
        from: Number((c[1].match(/#(\d+)&rarr;/) || [])[1]),
        to: Number((c[1].match(/&rarr;(\d+)/) || [])[1]),
        delta: Number((c[1].match(/&#96[56]0;(\d+)/) || [])[1]),
        down: /&#9660;/.test(c[1])
    }));
    t.check('the arrow is the distance between the two ranks shown',
        pairs.every((p) => Math.abs(p.from - p.to) === p.delta));
    t.check('and it points the way they moved',
        pairs.every((p) => p.down === (p.to > p.from)));
    // The whole point: the pair is on the movement scale, not the table's.
    t.check('the pair is not the rank in the column beside it',
        pairs.some((p) => p.rank !== p.to));

    t.check('the table intro says the two do not subtract',
        /so the two do not subtract/.test(dom.shell()));
});

/* ── Trajectory ──
   The one-step arrow answered "which way", never "from where in the year".
   Reading it in isolation is what produced "down 39 to 21, so was she at minus
   eighteen" — the strip and the modal put the step back among its neighbours. */

suite('period compare: the timeline ranks each month, and measures moves pairwise', (t) => {
    const { pc } = loadRankings(t, WEEKS, YTD);
    const tl = pc.buildRankTimeline('month');

    t.check('a timeline is built', !!tl);
    t.equal('both rebuildable months are on it', tl.periods.length, 2);
    t.equal('oldest first', tl.periods[0].label, 'June 2026');
    t.equal('newest last', tl.periods[1].label, 'July 2026');

    const series = tl.byName.P0;
    t.equal('a person has a point per month', series.length, 2);
    t.equal('the first month has nothing behind it to measure against', series[0].delta, null);
    t.check('the rank is over the people scored in that month',
        series.every((pt) => pt.rank >= 1 && pt.rank <= pt.total && pt.total === 40));

    // Two scales on purpose: the rank is over the month's own population, the
    // delta over the people in both months. The delta must reconcile against the
    // shared pair it travels with, not against the ranks either side of it.
    const step = series[1];
    t.check('the move carries the shared pair it is the difference of',
        Number.isFinite(step.sharedPrevRank) && Number.isFinite(step.sharedRank));
    t.equal('and the delta is exactly that difference',
        step.delta, step.sharedPrevRank - step.sharedRank);

    // "Down 39" always raises "which metric", and answering it must not mean
    // re-ranking the year a second time.
    t.check('the five KPIs travel with each point',
        series.every((pt) => pt.scores && pt.values && pt.metricRanks));
    t.check('including reliability, which is not in values',
        series.every((pt) => 'reliability' in pt));

    t.check('one person per scored name', Object.keys(tl.byName).length === 40);
});

suite('rankings view: the card carries the year, not just the last step', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    global.window.getTeamMembersForWeek = () => ['P0', 'P1', 'P2'];
    cr.renderCenterRanking();
    const team = dom.shell().slice(dom.shell().indexOf('Your Team'));

    t.check('every card gets a strip', (team.match(/Jun <strong>/g) || []).length === 3);
    t.check('and it runs to the newest month', (team.match(/Jul <strong>/g) || []).length === 3);
    t.check('the first chip has no arrow, having nothing behind it',
        /Jun <strong>\d+<\/strong><\/span>/.test(team));
    t.check('the chips explain themselves on hover',
        /title="June 2026 &mdash; #\d+ of 40/.test(team) || /title="June 2026 — #\d+ of 40/.test(team));
});

suite('rankings view: a name opens the year behind the number', (t) => {
    const { cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();
    const html = cr.buildTrajectoryHtml('P0');

    t.check('the chart is drawn', /<svg /.test(html));
    t.check('best rank sits at the top', /Best rank sits at the top/.test(html));
    t.check('every month is a column', /<th[^>]*>Jun</.test(html) && /<th[^>]*>Jul</.test(html));
    // A rebuilt month starts at the first week ENDING in it, so "June" can begin
    // in May — the header carries the dates it really covers.
    t.check('and each says what it really covers', /title="June 2026 covers \d\d-\d\d to \d\d-\d\d"/.test(html));
    t.check('the rank row states its denominator', /of 40/.test(html));

    // The reconciliation the cards needed, in the one place someone goes when
    // the card looks wrong: the selected-period rank drawn across the months.
    t.check('the card figure is drawn across it', /the figure on the card/.test(html));
    t.check('and named as year to date', /year to date<\/strong>, the figure on the card/.test(html));

    // Scott asked for the five KPIs here too — a rank move is only actionable
    // once you know which metric moved.
    ['AHT', 'Adherence', 'Sentiment', 'CX Adv', 'Reliability'].forEach((label) => {
        t.check('the ' + label + ' row is there', new RegExp('>' + label + '</td>').test(html));
    });
    t.check('with the 3/2/1 score on each cell', /border-radius: 50%/.test(html));

    t.check('and the two scales are still explained',
        /over the people scored in both/.test(html));
});

suite('rankings view: a trajectory nobody has yet says so', (t) => {
    const { cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();
    const html = cr.buildTrajectoryHtml('Nobody At All');
    t.check('an unknown name does not throw or render an empty chart',
        /No month-by-month history/.test(html) && !/<svg /.test(html));
});

suite('rankings view: the strip marks a month that has not finished', (t) => {
    const months = monthsEndingNow(3);
    if (!months) {
        t.check('skipped — the current month has no complete pair behind it this year', true);
        return;
    }
    const ytd = period(months[0].slice(0, 4) + '-01-01', months[2] + '-07', 'ytd',
        roster(40, 4), 'YTD so far');
    const { dom, cr } = loadRankings(t, weeksIn(months), ytd);
    global.window.getTeamMembersForWeek = () => ['P0', 'P1', 'P2'];
    cr.renderCenterRanking();
    const team = dom.shell().slice(dom.shell().indexOf('Your Team'));

    // The headline move deliberately stops at the last complete month, so the
    // strip running one further has to say which one is still filling up.
    // Marked by colour, not by a star: a star already means "moved with no
    // score change" everywhere else on this view.
    t.check('the unfinished month is on the strip', (team.match(/<strong>/g) || []).length >= 9);
    t.check('and it is marked as unfinished', /<span style="color: #e65100;">[A-Z][a-z]{2}<\/span> <strong>/.test(team));
    t.check('while the complete months are not', /(^|>)[A-Z][a-z]{2} <strong>/.test(team));
});

suite('rankings view: the year scrolls sideways once it outgrows the modal', (t) => {
    const { cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();
    const html = cr.buildTrajectoryHtml('P0');

    // The table carried overflow-x from the start and it never fired: width:100%
    // makes a table shrink its columns to fit rather than overflow, so eight
    // months crushed into the space four had instead of scrolling.
    // One box scrolling both ways, not a sideways scroller nested in a vertical
    // one: with the bar at the bottom of the content you had to scroll down to
    // reach it, which is the opposite of what it is for.
    t.check('the table box scrolls both ways', /min-height: 0; overflow: auto/.test(html));
    t.check('and it is the flex child that takes the leftover height',
        /flex: 1 1 auto; min-height: 0; overflow: auto/.test(html));
    t.check('the intro above it does not scroll away', /<p style="flex: 0 0 auto;/.test(html));
    t.check('and the table has a real width to overflow with',
        /<table style="width: \d+px;[^"]*table-layout: fixed/.test(html));
    t.check('columns are pinned to that width', /<colgroup><col style="width: \d+px;"/.test(html));
    t.check('the row labels stay put while the months slide past',
        (html.match(/position: sticky; left: 0/g) || []).length >= 6);

    // Chart and table share one geometry so a plotted point sits over its column.
    const tableWidth = Number((html.match(/<table style="width: (\d+)px;/) || [])[1]);
    const svgWidth = Number((html.match(/<svg viewBox="0 0 (\d+) /) || [])[1]);
    t.equal('the chart is exactly as wide as the table', svgWidth, tableWidth);
    t.check('both sit inside the same scroller',
        new RegExp('overflow: auto;"><div style="width: ' + tableWidth + 'px;"').test(html));

    // The year runs January to now, so it outgrows the modal on its own.
    t.check('and the reader is told it scrolls', /Scroll sideways/.test(html));
});

suite('rankings view: the trajectory shows the whole year, gaps included', (t) => {
    const { cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();
    const html = cr.buildTrajectoryHtml('P0');

    // WEEKS only carries June and July. A chart that starts in June reads as a
    // year that started in June, so every month to date gets a column and the
    // empty ones say what is missing rather than not existing.
    // slice(1) drops the "Month" corner cell, which matches the same shape. The
    // optional title carries the real span a rebuilt month covers.
    const heads = [...html.matchAll(/<th style="[^"]*"(?: title="[^"]*")?>([A-Z][a-z]{2})/g)]
        .map((m) => m[1]).slice(1);
    t.check('January is on it', heads.indexOf('Jan') === 0);
    t.check('and the ranked months are in their calendar slots',
        heads.indexOf('Jun') === 5 && heads.indexOf('Jul') === 6);
    t.check('every month to date has a column', heads.length >= 8);

    t.check('the empty months say why they are empty', /No ranking for Jan \(nothing uploaded/.test(html));
    t.check('and the chart marks them rather than joining across',
        (html.match(/>no data<\/text>/g) || []).length >= 4);

    // Joining across a gap would draw a trend through months nobody measured.
    const runs = (html.match(/<polyline /g) || []).length;
    t.check('the line is drawn in runs, not one stroke over the gaps', runs >= 1);

    t.check('the rows still walk every column',
        (html.match(/<td style="[^"]*">·<\/td>|&middot;<\/span><\/td>/g) || []).length > 0);
});

suite('rankings view: the whole card opens the trajectory, not just the name', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    global.window.getTeamMembersForWeek = () => ['P0', 'P1', 'P2'];
    cr.renderCenterRanking();
    const team = dom.shell().slice(dom.shell().indexOf('Your Team'));

    const cards = [...team.matchAll(/<div class="ranking-card" data-employee="([^"]+)"[^>]*>/g)];
    t.equal('every card is a target', cards.length, 3);
    t.check('and says so', cards.every((m) => /cursor: pointer/.test(m[0])));
    t.check('the name no longer carries the binding on its own',
        !/ranking-card-name" data-employee/.test(team));
});

suite('rankings view: any name in the centre opens a year', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    global.window.getTeamMembersForWeek = () => ['P0'];
    cr.renderCenterRanking();
    const table = dom.table();

    // The card was the only way in, so checking someone else's year meant
    // scrolling the table to find the name and then having nowhere to click.
    const cells = [...table.matchAll(/<td class="ranking-name-cell" data-employee="([^"]+)"[^>]*>/g)];
    t.check('every row carries a target', cells.length === 40);
    t.check('and every target names its person', cells.every((m) => /^P\d+$/.test(m[1])));
    t.check('the cell says it can be clicked', /cursor: pointer/.test(cells[0][0]));
    t.check('and says what it opens', /title="Open P\d+&#39;s year"|title="Open P\d+’s year"/.test(cells[0][0]));

    // A dotted underline on one cell in twelve columns is easy to miss.
    t.check('the intro says the names are live',
        /Click any name for that person(&#39;|’)s month-by-month history/.test(dom.shell()));

    // Team members already had a star; that must not be swallowed by the link.
    t.check('the team marker survives', /&#9733; <\/span>/.test(table));
});

suite('rankings view: the trajectory shows whether the YEAR is moving', (t) => {
    const { cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();
    const html = cr.buildTrajectoryHtml('P0');

    // A month rank answers "how was June". It cannot answer "is the year
    // moving" — someone can have a poor month and still be climbing, because
    // the year is the sum of everything before it too.
    t.check('the year standing has its own row', />Year to date<\/td>/.test(html));
    t.check('and its own movement row', />Year to date move<\/td>/.test(html));
    t.check('the standing carries its denominator', /#\d+<\/strong><span[^>]*> of \d+<\/span>/.test(html));

    t.check('the chart draws it as a second line', /stroke="#8e6bbf"/.test(html));
    t.check('with hollow markers, so colour is not the only tell',
        /fill="var\(--bg-surface\)" stroke="#8e6bbf"/.test(html));
    t.check('and a legend naming both lines',
        /Rank that month/.test(html) && /Year to date, as of that month/.test(html));

    // Two dashed lines on one chart means neither can be "the dashed line".
    t.check('the two references are named distinctly',
        /The purple line is where they stand/.test(html) && /The flat blue line is/.test(html));
    t.check('and nothing is called just "the dashed line"', !/The dashed line is/.test(html));
});

suite('period compare: the year standing accumulates rather than resetting', (t) => {
    const { pc } = loadRankings(t, WEEKS, YTD);
    const tl = pc.buildRankTimeline('month');
    const series = tl.byName.P0;

    t.check('every scored month carries a year standing',
        series.every((pt) => Number.isFinite(pt.overallRank) && pt.overallTotal > 0));
    // The first month has nothing before it, so the year and the month agree.
    t.equal('the first month is the year so far', series[0].overallRank, series[0].rank);
    t.check('and the year is ranked over the same field', series[0].overallTotal === series[0].total);
});

suite('rankings view: the year row agrees with the number on the card', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    global.window.getTeamMembersForWeek = () => ['P0'];
    cr.renderCenterRanking();

    // Reported as: the card said #95 year to date and the modal said #111 for
    // the same person. The card ranks the uploaded year-to-date file; the modal
    // was rebuilding from the months on file, which start in June here and in
    // May in the real data. Both called themselves the year.
    const card = dom.shell().slice(dom.shell().indexOf('Your Team'));
    const cardRank = Number((card.match(/#(\d+)<\/span><span[^>]*>Year to date<\/span>/) || [])[1]);
    t.check('the card carries a year-to-date rank', Number.isFinite(cardRank));

    const html = cr.buildTrajectoryHtml('P0');
    const yearCells = [...html.matchAll(/<strong style="color: #8e6bbf;">#(\d+)<\/strong>/g)].map((m) => Number(m[1]));
    t.check('the modal carries them too', yearCells.length > 0);
    // The uploaded file closes in July, so July and August both read it.
    t.equal('and the last one is the same number the card shows',
        yearCells[yearCells.length - 1], cardRank);
});

suite('period compare: the uploaded year-to-date file outranks a rebuild of it', (t) => {
    const { pc } = loadRankings(t, WEEKS, YTD);
    const series = pc.buildRankTimeline('month').byName.P0;

    // Scott's standing rule: a real year-to-date upload takes precedence over
    // anything reassembled from weeklies.
    t.check('the months covered by the upload read it',
        series.some((pt) => pt.overallSource === 'ytd-upload'));
    t.check('and say so rather than implying a rebuild',
        series.filter((pt) => pt.overallSource === 'ytd-upload')
            .every((pt) => pt.overallCoversFrom === null));
});

suite('rankings view: a rebuilt year says which month it really starts in', (t) => {
    // No year-to-date file at all, and weeks that only start in June. Calling
    // that "year to date" without qualification is the lie being fixed.
    const { cr } = loadRankings(t, WEEKS, null);
    cr.renderCenterRanking();
    const html = cr.buildTrajectoryHtml('P0');

    t.check('the row is still year to date', />Year to date<\/td>/.test(html));
    t.check('but the cells admit where the data begins', /from Jun only/.test(html));
    t.check('and it is marked, not buried', /color: #e65100;">from Jun only/.test(html));
});

/* ── Month over month, as an email ── */

suite('rankings view: the month-over-month email is addressed and readable', (t) => {
    const { cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();
    const mail = cr.buildMonthOverMonthEmail('P0');

    t.check('there is a draft', !!mail);
    t.equal('addressed first.last at aps', mail.to, 'p0@aps.com');
    t.equal('copied to the coaching mailbox', mail.cc, 'Brandywine.Lockhart@aps.com');
    t.check('the subject names both months', /June 2026 to July 2026/.test(mail.subject));

    // Written to the associate, not about them.
    t.check('it opens to the person by first name', /^Hi P0,/.test(mail.body));
    t.check('and closes as an invitation', /Happy to walk through any of it\.$/.test(mail.body));
    t.check('nothing in it is about other people', !/better than \d+/.test(mail.body));

    // A spaced table is the only kind that survives a plain-text mail body, so
    // the arrows have to line up in one column.
    const arrows = mail.body.split(String.fromCharCode(10)).filter((l) => l.includes(' -> '));
    t.check('every row is an arrow row', arrows.length >= 5);
    t.check('and they all line up',
        new Set(arrows.map((l) => l.indexOf(' -> '))).size === 1);

    t.check('the average is spelled out rather than left to be inferred',
        /Average\s+[\d.]+ ->\s+[\d.]+\s+out of 3\.0/.test(mail.body));
    // No placing, no rank, no count of anybody else. Where someone landed
    // against the rest of the centre is a management number; this note is about
    // whether their own numbers moved.
    t.check('no rank or placing appears at all',
        !/place|rank|out of \d+ |#\d/.test(mail.body));
    t.check('but the overall direction is still named',
        /Overall that (is a better month|is a step back|holds you about where)/.test(mail.body));

    // Short enough that a mail client will not truncate the body.
    t.check('it fits in a mailto', mail.body.length < 1800);
});

suite('rankings view: the email reports the outcome, not the arithmetic', (t) => {
    const { cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();

    // AHT rising is a step backwards; adherence rising is a step forwards. A
    // bare "up 11" would read as praise on one line and a warning on the next.
    const bodies = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5'].map((n) => cr.buildMonthOverMonthEmail(n))
        .filter(Boolean).map((m) => m.body);
    t.check('some drafts were built', bodies.length > 0);

    const ahtLines = bodies.map((b) => (b.match(/ {2}AHT.*/) || [''])[0]).filter(Boolean);
    t.check('AHT is judged, not just measured',
        ahtLines.every((l) => /no change|better by|worse by/.test(l)));
    t.check('and a slower AHT is called worse',
        ahtLines.filter((l) => /worse by/.test(l)).every((l) => {
            const m = l.match(/([\d.]+) sec ->\s+([\d.]+) sec/);
            return !m || Number(m[2]) > Number(m[1]);
        }));
});

suite('rankings view: one month is not a month-over-month story', (t) => {
    const { cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();
    // Someone with no history cannot have a draft built for them, and the
    // caller has to be able to tell rather than sending an empty one.
    t.equal('an unknown person yields nothing', cr.buildMonthOverMonthEmail('Nobody At All'), null);
});

/* ── The year, as a picture ──
   A mail body is plain text, so the two-month table is all the text can carry.
   The year needs a picture. Pixels cannot be asserted; what goes into them can,
   and so can coordinates landing off the canvas. */

// A 2D context that records what it was asked to draw.
function recordingCanvas() {
    const ops = [];
    const ctx = {
        _align: 'left',
        set font(v) {}, get font() { return '400 12px x'; },
        set fillStyle(v) {}, set strokeStyle(v) {}, set lineWidth(v) {},
        set lineJoin(v) {}, set lineCap(v) {}, set textBaseline(v) {},
        set textAlign(v) { ctx._align = v; }, get textAlign() { return ctx._align; },
        scale() {}, fillRect() {}, beginPath() {}, stroke() {}, fill() {}, setLineDash() {},
        moveTo(x, y) { ops.push({ op: 'line', x, y }); },
        lineTo(x, y) { ops.push({ op: 'line', x, y }); },
        arc(x, y, r) { ops.push({ op: 'arc', x, y, r }); },
        fillText(str, x, y) { ops.push({ op: 'text', s: String(str), x, y }); },
        measureText(str) { return { width: String(str).length * 6 }; }
    };
    const canvas = { style: {}, width: 0, height: 0, getContext: () => ctx };
    return { canvas, ops };
}

function withRecordingCanvas(t, fn) {
    const rec = recordingCanvas();
    const prev = global.document.createElement;
    global.document.createElement = (tag) =>
        (tag === 'canvas' ? rec.canvas : prev.call(global.document, tag));
    try { return fn(rec); } finally { global.document.createElement = prev; }
}

suite('rankings view: the year picture covers January through the data', (t) => {
    const { cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();
    const model = cr.buildYearImageModel('P0');

    t.check('there is a model', !!model);
    t.equal('it starts in January, not at the first upload', model.columns[0].label, 'Jan');
    t.check('and runs to the newest month with data',
        model.columns[model.columns.length - 1].present ||
        model.columns.some((c) => c.present));
    t.check('the empty months are carried, not dropped',
        model.columns.some((c) => !c.present));
    t.check('the subtitle names the span', /Jan to \w{3}/.test(model.subtitle));

    // Everything the picture needs travels in the model, so drawing reads no
    // globals and can be checked without a browser.
    const scored = model.columns.filter((c) => c.present);
    t.check('each scored month carries its rank and field size',
        scored.every((c) => Number.isFinite(c.rank) && c.total > 0));
    t.check('and its five KPIs', scored.every((c) => c.metrics.length === 5));
    t.check('with a 3/2/1 score where one was earned',
        scored.some((c) => c.metrics.some((m) => m.score >= 1 && m.score <= 3)));
});

suite('rankings view: the year picture stays inside its own canvas', (t) => {
    const { cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();
    const model = cr.buildYearImageModel('P0');

    withRecordingCanvas(t, (rec) => {
        const canvas = cr.drawYearCard(model);
        t.check('a canvas comes back', !!canvas);

        // Drawn at 2x and scaled down, so a paste is not blurry on a normal
        // display and stays sharp on a high-DPI one.
        const W = canvas.width / 2, H = canvas.height / 2;
        t.check('sized for the months it has', W > 400 && H > 300);

        t.check('nothing is drawn at a NaN coordinate',
            rec.ops.every((o) => Number.isFinite(o.x) && Number.isFinite(o.y)));
        t.check('no text falls off the canvas',
            rec.ops.filter((o) => o.op === 'text')
                .every((o) => o.x >= 0 && o.x <= W && o.y >= 0 && o.y <= H));
        t.check('no marker falls off it either',
            rec.ops.filter((o) => o.op === 'arc')
                .every((o) => o.y >= 0 && o.y <= H && o.x >= 0 && o.x <= W));

        const texts = rec.ops.filter((o) => o.op === 'text').map((o) => o.s);
        t.check('the person is named', texts.indexOf('P0') !== -1);
        t.check('both lines are keyed', texts.indexOf('Rank that month') !== -1 &&
            texts.indexOf('Year to date') !== -1);
        t.check('and the score dots are explained',
            texts.some((s) => /3 exceeds\s+2 meets\s+1 below/.test(s)));
        t.check('a month with no data says so', texts.indexOf('no data') !== -1);
    });
});

suite('rankings view: best rank is drawn at the top of the year picture', (t) => {
    const { cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();
    const model = cr.buildYearImageModel('P0');
    const scored = model.columns.filter((c) => c.present);
    if (scored.length < 2 || scored[0].rank === scored[1].rank) {
        t.check('skipped - this fixture has no rank spread', true);
        return;
    }

    withRecordingCanvas(t, (rec) => {
        cr.drawYearCard(model);
        // The month markers are the filled 5.5px circles, in column order.
        const markers = rec.ops.filter((o) => o.op === 'arc' && o.r === 5.5);
        t.equal('one marker per scored month', markers.length, scored.length);

        // Up is better, the way the word reads. A smaller rank number must sit
        // higher on the canvas, which means a smaller y.
        const pairs = scored.map((c, i) => ({ rank: c.rank, y: markers[i].y }));
        const best = pairs.reduce((a, b) => (a.rank <= b.rank ? a : b));
        const worst = pairs.reduce((a, b) => (a.rank >= b.rank ? a : b));
        t.check('the best month is drawn above the worst', best.y < worst.y);
    });
});
