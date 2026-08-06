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

suite('rankings view: the two rank counts are reconciled out loud', (t) => {
    const { dom, cr } = loadRankings(t, WEEKS, YTD);
    cr.renderCenterRanking();
    dom.els.rankingPeriodSelect.value = 'month:2026-07';
    dom.els.rankingPeriodSelect.fire('change');

    // The table ranks everyone in the period; movement ranks only the people in
    // both periods. Same roster here, so the counts agree and no note is needed.
    const shell = dom.shell();
    const shared = (shell.match(/ranked across the (\d+) scored in both/) || [])[1];
    const scored = (shell.match(/(\d+) employees scored/) || [])[1];
    t.check('the shared population is stated', !!shared);
    t.check('when the two agree, no reconciliation is bolted on',
        shared === scored ? !/differ on purpose/.test(shell) : /differ on purpose/.test(shell));
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
