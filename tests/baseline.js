/**
 * Behaviour baseline.
 *
 *   node tests/baseline.js            regenerate baseline/outputs.txt
 *   node tests/baseline.js --check    regenerate and fail if it changed
 *
 * This file calls the real generators, scorers and email builders against a
 * fixed dataset and writes everything they return to baseline/outputs.txt.
 * That file is the contract: after a refactoring pass, an empty `git diff` on
 * it means the pass was safe.
 *
 * Two rules this harness holds to:
 *
 *   1. It never modifies application logic. Anything that cannot be called in
 *      isolation is recorded in baseline/NOT-COVERED.md, not refactored to
 *      make it reachable.
 *   2. It is deterministic. The clock is frozen, the timezone is pinned, and
 *      Math.random is replaced with a seeded generator that is re-seeded
 *      before every entry point. Without that, this file diffs against
 *      itself and the contract is worthless.
 */
'use strict';

// Pinned before anything reads the clock. Phoenix has no daylight saving, so
// the same instant renders identically whatever machine regenerates this.
process.env.TZ = 'America/Phoenix';

// script.js silences console.log outside debug mode, so the harness keeps its
// own handle on the real one. Taken before any application code runs.
const say = console.log.bind(console);

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'baseline');
const OUT_FILE = path.join(OUT_DIR, 'outputs.txt');

const fixture = require(path.join(OUT_DIR, 'fixture.js'));

/* ---------- determinism ---------- */

// Thursday 25 June 2026, 09:00 Phoenix. Chosen to sit a few days after the
// fixture's most recent complete week (ending Sun 21 June) so that "last
// week", "this week so far", month-to-date, quarter and year-to-date all have
// real data behind them, and mid-year review paths have something to say.
const RealDate = Date;
const FROZEN_MS = RealDate.UTC(2026, 5, 25, 16, 0, 0);

class FrozenDate extends RealDate {
    constructor(...args) {
        if (args.length === 0) super(FROZEN_MS);
        else super(...args);
    }
    static now() { return FROZEN_MS; }
}

// A small deterministic PRNG. Re-seeded before each entry point so that a
// generator which shuffles a tip pool still exercises the pool, but picks the
// same members every run.
function makeRandom(seed) {
    let s = seed >>> 0;
    return function random() {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

/* ---------- the fake browser ---------- */

// Deliberately thicker than tests/harness.js, because script.js and the
// feature modules touch far more of the DOM at load time than a unit test
// does. Still only enough to let the code load and be called; nothing here
// tries to simulate rendering.
function installBrowser() {
    const store = {};
    const elements = {};

    function makeElement(id) {
        const el = {
            id: id || '',
            value: '',
            textContent: '',
            innerHTML: '',
            checked: false,
            disabled: false,
            style: {},
            dataset: {},
            classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
            options: [],
            children: [],
            parentElement: null,
            setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
            addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
            appendChild(c) { this.children.push(c); return c; },
            removeChild() {}, insertBefore() {}, remove() {},
            querySelector() { return null; },
            querySelectorAll() { return []; },
            closest() { return null; },
            focus() {}, blur() {}, select() {}, click() {},
            getBoundingClientRect() { return { top: 0, left: 0, width: 0, height: 0 }; },
            getContext() { return null; }
        };
        return el;
    }

    global.localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
        key: (i) => Object.keys(store)[i] ?? null,
        get length() { return Object.keys(store).length; },
        _store: store
    };
    global.sessionStorage = { getItem: () => null, setItem() {}, removeItem() {} };

    global.Event = class { constructor(type) { this.type = type; } };
    global.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
    global.MutationObserver = class { observe() {} disconnect() {} };
    global.Node = class {};
    global.HTMLElement = class {};

    global.document = {
        _els: elements,
        documentElement: makeElement('html'),
        body: makeElement('body'),
        head: makeElement('head'),
        getElementById: (id) => elements[id] || null,
        querySelector: () => null,
        querySelectorAll: () => [],
        getElementsByClassName: () => [],
        createElement: (tag) => makeElement(tag),
        createTextNode: (t) => ({ textContent: t }),
        createDocumentFragment: () => makeElement('fragment'),
        addEventListener() {}, removeEventListener() {},
        execCommand: () => true,
        readyState: 'complete'
    };

    Object.defineProperty(global, "navigator", { configurable: true, writable: true, value: {
        clipboard: { writeText: () => Promise.resolve(), write: () => Promise.resolve() },
        userAgent: 'baseline-harness'
    } });

    // In a browser `window` IS the global object, so `window.METRICS_REGISTRY = x`
    // also creates a bare global `METRICS_REGISTRY`. Modules and script.js rely on
    // that constantly -- metrics.module.js reads bare `METRICS_REGISTRY`, script.js
    // reads bare `STORAGE_PREFIX`, and so on. Pointing `window` at `global` rather
    // than at a separate object is what makes those resolve, and it is closer to
    // the real thing than any amount of copying between two objects would be.
    global.window = global;

    Object.assign(global.window, {
        DevCoachModules: {},
        location: { hostname: 'baseline', search: '', href: 'http://baseline/', pathname: '/' },
        matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
        open: () => null,
        alert() {}, confirm: () => true, prompt: () => null,
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        scrollTo() {}, print() {}
    });

    if (typeof global.addEventListener !== 'function') global.addEventListener = function () {};
    if (typeof global.removeEventListener !== 'function') global.removeEventListener = function () {};
    if (typeof global.dispatchEvent !== 'function') global.dispatchEvent = function () { return true; };
    if (typeof global.requestAnimationFrame !== 'function') global.requestAnimationFrame = function () { return 0; };

    global.window.window = global;
    global.window.self = global;






    global.__DOM = { store: store, elements: elements, makeElement: makeElement };
    return global.__DOM;
}

/* ---------- injecting the fixture ---------- */

// script.js declares its stores with `let` at top level. Under indirect eval
// those land in the global *lexical* environment, which is shared with later
// global evals but is not reachable as `global.weeklyData`. So the only way to
// seed them is to assign from inside that same scope.
// The stores live in two places at once in the running app: script.js holds
// them in `let` bindings, and every module reads them back out of localStorage
// through the storage module. Seeding only one of the two leaves half the app
// looking at the built-in default roster of real associate names, so both get
// written here. Order matters: this runs after load, because script.js seeds
// its own defaults on the way in.
// script.js declares its stores with `let` at top level. Under indirect eval a
// lexical declaration lands in a *new* environment belonging to that eval call,
// not in the global lexical environment -- so `weeklyData` is invisible to any
// later eval, and assigning to the name from outside merely creates an unrelated
// property on the global object. The functions declared alongside it close over
// the original environment and keep reading the empty `{}`.
//
// The only way to seed them without editing script.js is to hand the assignment
// to the same eval call. Hence the epilogue below, appended to the source at
// load time. This changes nothing about the file on disk.
// Names the harness needs to reach that live in script.js's top-level lexical
// scope. Handed out to the global object from inside the same eval, because
// there is no other way to see them and editing script.js is not on the table.
const BRIDGE_NAMES = [
    'STORAGE_PREFIX', 'APP_VERSION', 'weeklyData', 'ytdData', 'dailyData',
    'myTeamMembers', 'YEAR_END_ANNUAL_GOALS', 'CORE_PERFORMANCE_METRICS',
    'CORE_SURVEY_METRICS', 'TREND_METRIC_MAPPINGS', 'SUPERVISOR_ROSTER'
];

const BRIDGE_EPILOGUE = [
    '',
    ';(function bridgeToBaselineHarness() {',
    '    globalThis.__BRIDGE = {};',
    BRIDGE_NAMES.map((n) =>
        '    try { globalThis.__BRIDGE[' + JSON.stringify(n) + '] = ' + n + '; } catch (e) {}'
    ).join('\n'),
    '})();'
].join('\n');

const SEED_EPILOGUE = [
    '',
    ';(function seedFromBaselineFixture() {',
    '    weeklyData = globalThis.__FX.weeklyData;',
    '    ytdData = globalThis.__FX.ytdData;',
    '    dailyData = globalThis.__FX.dailyData;',
    '    myTeamMembers = globalThis.__FX.myTeamMembers;',
    // Set the way initializeCoachingEmail would set it. Without this it stays
    // null and every coaching prompt path throws on .split.
    '    try { coachingLatestWeekKey = window.DevCoachModules.coachingEmail.getLatestWeekKeyForCoaching() || globalThis.__FX.LATEST_WEEK_KEY; }',
    '    catch (e) { coachingLatestWeekKey = globalThis.__FX.LATEST_WEEK_KEY; }',
    '})();'
].join('\n');

// Modules do not read those bindings at all -- they go back to localStorage
// through the storage module. Both have to be populated, or half the app reads
// the fixture and the other half falls back to the built-in default roster of
// real associate names.
function seedLocalStorage() {
    const P = 'devCoachingTool_';
    global.localStorage.setItem(P + 'weeklyData', JSON.stringify(fixture.weeklyData));
    global.localStorage.setItem(P + 'ytdData', JSON.stringify(fixture.ytdData));
    global.localStorage.setItem(P + 'dailyData', JSON.stringify(fixture.dailyData));
    global.localStorage.setItem(P + 'myTeamMembers', JSON.stringify(fixture.myTeamMembers));
}

function readStore(name) {
    try { return (0, eval)(name); } catch (err) { return '!! ' + err.message; }
}

/* ---------- loading the application ---------- */

// Module order is read from index.html rather than hardcoded, so that a module
// added or reordered there is picked up here without anyone remembering to.
function moduleOrderFromIndexHtml() {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const start = html.indexOf('loadAllScriptsWithCacheBust');
    const block = html.slice(start, html.indexOf('];', start));
    return (block.match(/modules\/[a-z0-9-]+\.module\.js/g) || []);
}

const loadNotes = [];

function loadApplication() {
    installBrowser();
    global.Date = FrozenDate;
    // Seeded before the app loads, not just before each entry: modules shuffle
    // rotator pools at load time, and an unseeded shuffle there makes every run
    // differ no matter how carefully the entry points are seeded afterwards.
    Math.random = makeRandom(20260625);
    global.__FX = fixture;

    // localStorage first: modules read the stores back out of it as they
    // initialise, and script.js seeds its own defaults on the way in.
    seedLocalStorage();

    // Everything is evaluated as ONE program rather than file by file.
    //
    // In the browser these are separate classic scripts that nevertheless share
    // a single global lexical environment, so a top-level `const STORAGE_PREFIX`
    // in script.js is visible to tips.module.js. Under indirect eval each call
    // gets its OWN lexical environment, so file-by-file loading hides every
    // top-level let/const from every other file -- which is why script.js's
    // stores and constants read as "not defined" from anywhere else.
    //
    // Concatenating restores the shared scope. It is safe precisely because the
    // app already runs in a browser: duplicate top-level lexical declarations
    // across classic scripts would be a SyntaxError there too.
    const order = moduleOrderFromIndexHtml();
    const parts = [];
    for (const rel of order) {
        parts.push('/* === ' + rel + ' === */');
        parts.push(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
        parts.push(';');
    }
    parts.push('/* === script.js === */');
    parts.push(fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8'));
    parts.push(';');
    parts.push(SEED_EPILOGUE);

    // The bridge: script.js's own top-level bindings are only reachable from
    // inside this eval, so anything the harness needs to read later has to be
    // handed out from in here.
    parts.push(BRIDGE_EPILOGUE);

    try {
        (0, eval)(parts.join('\n'));
    } catch (err) {
        loadNotes.push({ file: '(concatenated program)', error: String(err && err.message) });
    }

    // script.js may have rewritten the keys during its own init.
    seedLocalStorage();

    return { moduleCount: order.length };
}

/* ---------- recording ---------- */

const sections = [];
const skipped = [];
let entryCount = 0;

// Stable stringification: object keys sorted, so a change in property
// insertion order never shows up as a diff.
function stable(value, depth) {
    depth = depth || 0;
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    const t = typeof value;
    if (t === 'number') return Number.isFinite(value) ? String(value) : String(value);
    if (t === 'boolean' || t === 'bigint') return String(value);
    if (t === 'function') return '[function ' + (value.name || 'anonymous') + ']';
    if (t === 'string') return JSON.stringify(value);
    if (value instanceof RealDate) return '[Date ' + value.toISOString() + ']';
    if (depth > 6) return '[depth limit]';
    const pad = '  '.repeat(depth + 1);
    const close = '  '.repeat(depth);
    if (Array.isArray(value)) {
        if (value.length === 0) return '[]';
        return '[\n' + value.map((v) => pad + stable(v, depth + 1)).join(',\n') + '\n' + close + ']';
    }
    const keys = Object.keys(value).sort();
    if (keys.length === 0) return '{}';
    return '{\n' + keys.map((k) => pad + JSON.stringify(k) + ': ' + stable(value[k], depth + 1)).join(',\n') + '\n' + close + '}';
}

// Record one entry point. The seed is derived from the label, so adding an
// entry never shifts the random stream of the ones around it.
const pending = [];

function record(label, fn) {
    entryCount++;
    let seed = 0;
    for (let i = 0; i < label.length; i++) seed = (seed * 31 + label.charCodeAt(i)) >>> 0;
    Math.random = makeRandom(seed || 1);
    global.window.Math = Math;

    const slot = { label, body: '' };
    sections.push(slot);

    const settle = (value) => {
        slot.body = typeof value === 'string' ? value : stable(value);
    };
    const fail = (err) => {
        slot.body = '!! THREW: ' + (err && err.message ? err.message : String(err));
    };

    try {
        const value = fn();
        // A few entry points are genuinely async (the clipboard chain). Record
        // what they settle to rather than the promise object.
        if (value && typeof value.then === 'function') {
            pending.push(value.then(settle, fail));
        } else {
            settle(value);
        }
    } catch (err) {
        fail(err);
    }
}

// Something that cannot be called in isolation. Noted, never worked around.
function cannotCover(label, reason) {
    skipped.push({ label, reason });
}

/* ---------- surface dump ---------- */

// `node tests/baseline.js --surface` prints what actually loaded and what is
// callable. Kept because curating the entry points below is only honest if
// you can see the real API surface rather than guessing at it.
function printSurface() {
    const M = global.window.DevCoachModules;
    say('modules loaded: ' + moduleOrderFromIndexHtml().length + ' | load errors: ' + loadNotes.length);
    loadNotes.forEach((n) => say('   ERR ' + n.file + ' :: ' + String(n.error).slice(0, 110)));
    say('');
    Object.keys(M).sort().forEach((ns) => {
        const v = M[ns];
        const fns = (v && typeof v === 'object')
            ? Object.keys(v).filter((k) => typeof v[k] === 'function').sort()
            : [];
        say(ns + ' (' + fns.length + '): ' + fns.join(', '));
    });
}

/* ---------- main ---------- */

/* ---------- entry points ---------- */

// Curated, targets-first. Every generator, scorer and builder that the
// consolidation passes will touch, plus the metric and KPI layer -- which is
// explicitly out of scope for change, and is captured here precisely for that
// reason: any diff in those sections is an accident, not an intended edit.

const M = () => global.window.DevCoachModules;
const G = (name) => { try { return (0, eval)(name); } catch (err) { return undefined; } };

const KPI_KEYS = ['scheduleAdherence', 'cxRepOverall', 'overallSentiment', 'aht', 'reliability'];
// Lazy: window does not exist until loadApplication has run.
let _metricKeys = null;
const metricKeys = () => (_metricKeys || (_metricKeys = Object.keys(global.window.METRICS_REGISTRY || {}).sort()));
const YEARS = [2025, 2026];

function recordAll() {
    recordMetricLayer();
    recordKpiScoring();
    recordPeriodMath();
    recordRoster();
    recordPickers();
    recordTips();
    recordPromptsAndEmails();
    recordReviewPrompts();
    recordTextGenerators();
    recordClipboardAndMail();
}

/* --- metric layer (tripwire: out of scope for change) --- */

function recordMetricLayer() {
    const mp = M().metricProfiles;

    record('metric-profiles / getYearTarget, every metric, both years', () => {
        const out = {};
        YEARS.forEach((y) => {
            out[y] = {};
            metricKeys().forEach((k) => { out[y][k] = mp.getYearTarget(k, y); });
        });
        return out;
    });

    record('metric-profiles / rating bands, every metric, both years', () => {
        const out = {};
        YEARS.forEach((y) => {
            out[y] = {};
            metricKeys().forEach((k) => {
                out[y][k] = { hasBand: mp.hasRatingBand(k, y), band: mp.RATING_BANDS_BY_YEAR[y][k] || null };
            });
        });
        return out;
    });

    record('metric-profiles / roundToDisplayPrecision across units', () => {
        const probes = [92.46, 92.44, 92.5, 92.96, 18.004, 18.045, 426.4, 426.6, 0, -1.25];
        const out = {};
        metricKeys().forEach((k) => {
            out[k] = probes.map((p) => p + ' -> ' + mp.roundToDisplayPrecision(k, p));
        });
        return out;
    });

    record('metric-profiles / getRatingScore for every fixture associate', () => {
        const out = {};
        YEARS.forEach((y) => {
            const roster = y === 2026 ? fixture.EMPLOYEES_2026 : fixture.EMPLOYEES_2025;
            out[y] = {};
            roster.forEach((emp) => {
                out[y][emp.name] = {};
                KPI_KEYS.forEach((k) => { out[y][emp.name][k] = mp.getRatingScore(k, emp[k], y); });
            });
        });
        return out;
    });

    record('metric-profiles / meetsYearTarget for every fixture associate', () => {
        const out = {};
        YEARS.forEach((y) => {
            const roster = y === 2026 ? fixture.EMPLOYEES_2026 : fixture.EMPLOYEES_2025;
            out[y] = {};
            roster.forEach((emp) => {
                out[y][emp.name] = {};
                metricKeys().forEach((k) => { out[y][emp.name][k] = mp.meetsYearTarget(k, emp[k], y); });
            });
        });
        return out;
    });

    record('metric-profiles / getRatingBandColor', () => {
        const out = {};
        KPI_KEYS.forEach((k) => {
            out[k] = fixture.EMPLOYEES_2026.map((e) => e.name + ': ' + mp.getRatingBandColor(k, e[k], 2026));
        });
        return out;
    });

    record('metrics-registry / isReverseMetric and noise thresholds', () => {
        const h = M().metricsRegistryHelpers;
        const out = {};
        metricKeys().forEach((k) => {
            out[k] = { isReverse: h.isReverseMetric(k), noise: h.getMetricNoiseThreshold(k) };
        });
        out['__unknown_key__'] = {
            isReverse: h.isReverseMetric('__unknown_key__'),
            noise: h.getMetricNoiseThreshold('__unknown_key__')
        };
        return out;
    });

    record('metric-trends / formatMetricDisplay and formatMetricValue (the live pair)', () => {
        const fd = G('formatMetricDisplay'), fv = G('formatMetricValue');
        const probes = [0, 18, 18.04, 92.46, 93, 426, 434.4];
        const out = {};
        metricKeys().forEach((k) => {
            out[k] = probes.map((p) => p + ' -> display ' + String(fd && fd(k, p)) + ' | value ' + String(fv && fv(k, p)));
        });
        return out;
    });

    record('metrics.module / the orphan second implementation, for comparison', () => {
        const m = M().metrics;
        const probes = [0, 18, 18.04, 92.46, 93, 426, 434.4, '', null];
        const out = {};
        metricKeys().forEach((k) => {
            out[k] = probes.map((p) => JSON.stringify(p) + ' -> ' + String(m.formatMetricDisplay(k, p)));
        });
        out['__severity__'] = metricKeys().map((k) => k + ': ' + m.getMetricSeverity(k, 30));
        return out;
    });
}
/* --- KPI scoring (tripwire: out of scope for change) --- */

function recordKpiScoring() {
    const oo = M().onOffTracker;

    record('on-off-tracker / calculateYearEndOnOffMirror, every associate, both years', () => {
        const out = {};
        YEARS.forEach((y) => {
            const roster = y === 2026 ? fixture.EMPLOYEES_2026 : fixture.EMPLOYEES_2025;
            out[y] = {};
            roster.forEach((emp) => { out[y][emp.name] = oo.calculateYearEndOnOffMirror(emp, y); });
        });
        return out;
    });

    record('on-off-tracker / resolveYearEndOnOffTrackStatus across the band boundaries', () => {
        const probes = [0, 1, 1.6, 1.75, 1.79, 1.795, 1.8, 2, 2.4, 2.667, 2.75, 2.79, 2.795, 2.8, 3];
        return probes.map((p) => p + ' -> ' + JSON.stringify(oo.resolveYearEndOnOffTrackStatus(p)));
    });

    record('on-off-tracker / getYearEndOnOffScoreOrFallback, incl. an unconfigured year', () => {
        const out = {};
        [2025, 2026, 2024, 2027].forEach((y) => {
            out[y] = {};
            fixture.EMPLOYEES_2026.forEach((emp) => {
                out[y][emp.name] = {};
                KPI_KEYS.forEach((k) => {
                    const v = k === 'scheduleAdherence' ? emp.scheduleAdherence
                        : k === 'overallSentiment' ? emp.overallSentiment
                            : emp[k];
                    out[y][emp.name][k] = oo.getYearEndOnOffScoreOrFallback(k, oo.parseOnOffMirrorNumber(v), y);
                });
            });
        });
        return out;
    });

    record('on-off-tracker / buildYearEndOnOffValues and buildYearEndOnOffScores', () => {
        const out = {};
        fixture.EMPLOYEES_2026.forEach((emp) => {
            const pick = oo.pickYearEndAssociateOverallValue(emp);
            const values = oo.buildYearEndOnOffValues(emp, pick);
            out[emp.name] = { pick: pick, values: values, scores: oo.buildYearEndOnOffScores(values, 2026) };
        });
        return out;
    });

    record('on-off-tracker / parseOnOffMirrorNumber and isValidOnOffPercent', () => {
        const probes = [null, undefined, '', 'N/A', 'n/a', '0', 0, '93', 93.4, 'abc', -1, 101, 100];
        return probes.map((p) => JSON.stringify(p)
            + ' -> parse ' + JSON.stringify(oo.parseOnOffMirrorNumber(p))
            + ' | valid ' + oo.isValidOnOffPercent(oo.parseOnOffMirrorNumber(p)));
    });

    record('on-off-tracker / legend bands by year', () => {
        const out = {};
        [2024, 2025, 2026, 2027].forEach((y) => { out[y] = oo.getOnOffTrackerLegendBandsByYear(y); });
        return out;
    });

    record('on-off-tracker / score cell and status styles', () => {
        return {
            scoreCell: [null, 1, 2, 3].map((s) => String(s) + ': ' + JSON.stringify(oo.getOnOffScoreCellStyle(s))),
            status: ['Off Track', 'On Track/Successful', 'On Track/Exceptional', ''].map(
                (s) => JSON.stringify(s) + ': ' + JSON.stringify(oo.getOnOffStatusStyle(s)))
        };
    });

    record('on-off-tracker / generateTeamOnOffSummary', () => {
        return oo.generateTeamOnOffSummary ? oo.generateTeamOnOffSummary(fixture.EMPLOYEES_2026, 2026) : '(not callable)';
    });

    record('center-ranking / scoreAndRankEmployees', () => {
        const cr = M().centerRanking;
        return cr.scoreAndRankEmployees(fixture.EMPLOYEES_2026, 2026);
    });

    record('center-ranking / buildRankingsForPeriod, latest week', () => {
        return M().centerRanking.buildRankingsForPeriod(fixture.LATEST_WEEK_KEY);
    });

    record('center-ranking / buildYearImageModel', () => {
        return M().centerRanking.buildYearImageModel(2026);
    });

    record('q1-review / buildQ1ReviewData', () => {
        return M().q1Review.buildQ1ReviewData();
    });

    record('futures / buildFuturesData', () => {
        return M().futures.buildFuturesData();
    });

    record('futures / buildCheckInSummary per associate', () => {
        const f = M().futures;
        const data = f.buildFuturesData();
        const out = {};
        fixture.ALL_NAMES.forEach((n) => {
            try { out[n] = f.buildCheckInSummary(n, data); } catch (err) { out[n] = '!! ' + err.message; }
        });
        return out;
    });

    cannotCover('dashboard / evaluateYearEndKpis',
        'dashboard.module.js exports only render entry points; evaluateYearEndKpis '
        + '(:87-109) is module-private and its results reach the DOM directly. Its rule '
        + '("score >= 2 counts as on-track") is one of the four notions in AUDIT.md 2.2, '
        + 'so it matters — but reaching it would mean exporting it, which is a code change.');
}
/* --- period math (pass 5) --- */

function recordPeriodMath() {
    const pi = M().periodIndex;

    record('period-index / mondayOf across a full week and a year boundary', () => {
        const probes = ['2026-06-15', '2026-06-16', '2026-06-20', '2026-06-21', '2026-06-22',
            '2026-01-01', '2025-12-31', '2026-03-01', '2026-11-01'];
        return probes.map((d) => d + ' -> ' + pi.mondayOf(d));
    });

    record('period-index / parsePeriod over every fixture key', () => {
        const out = {};
        Object.keys(fixture.weeklyData).concat(Object.keys(fixture.ytdData), Object.keys(fixture.dailyData))
            .sort()
            .forEach((k) => { out[k] = pi.parsePeriod(k); });
        return out;
    });

    record('period-index / selectors over the fixture', () => {
        return {
            lastCompletedWeek: pi.lastCompletedWeek(),
            thisWeekSoFar: pi.thisWeekSoFar(),
            yearToDate: pi.yearToDate(),
            previousYearToDate: pi.previousYearToDate(),
            completeWeekKeys: pi.completeWeekKeys(),
            weekLikeKeys: pi.weekLikeKeys(),
            dailiesThisWeek: pi.dailiesThisWeek(),
            keysOfType_week: pi.keysOfType('week'),
            keysOfType_month: pi.keysOfType('month'),
            keysOfType_quarter: pi.keysOfType('quarter'),
            keysOfType_ytd: pi.keysOfType('ytd'),
            keysOfType_daily: pi.keysOfType('daily'),
            latestOfType_week: pi.latestOfType('week'),
            latestOfType_ytd: pi.latestOfType('ytd')
        };
    });

    record('period-index / shiftDays and isWeekLike and isCompleteWeek', () => {
        return {
            shift: [-7, -1, 0, 1, 7].map((n) => n + ' -> ' + pi.shiftDays('2026-06-21', n)),
            isWeekLike: ['week', 'week-in-progress', 'custom', 'month', 'quarter', 'ytd', 'daily']
                .map((t) => t + ': ' + pi.isWeekLike(t)),
            isCompleteWeek: Object.keys(fixture.weeklyData).sort().map((k) => k + ': ' + pi.isCompleteWeek(k))
        };
    });

    record('celebrations / listShoutOutWindows', () => M().celebrations.listShoutOutWindows());

    record('period-picker / windows, and the id/key round trip', () => {
        const pp = M().periodPicker;
        const wins = pp.windows();
        return {
            windows: wins,
            roundTrip: wins.map((w) => w.id + ' -> ' + pp.idForKey(pp.keyForId(w.id)) + ' (key ' + String(pp.keyForId(w.id)) + ')'),
            chipTitles: wins.map((w) => w.id + ': ' + pp.chipTitle(w))
        };
    });

    record('period-compare / month buckets, labels and options', () => {
        const pc = M().periodCompare;
        return {
            monthBuckets: pc.getMonthBuckets(),
            monthPeriodOptions: pc.getMonthPeriodOptions(),
            labels: ['2026-01', '2026-06', '2025-12'].map((m) => m + ' -> ' + pc.monthLabel(m))
        };
    });

    record('period-compare / buildMonthAggregate and coverage', () => {
        const pc = M().periodCompare;
        return { coverage: pc.buildMonthCoverage(), aggregate: pc.buildMonthAggregate('2026-06') };
    });

    record('upload-wizard / computeUploadOptions at the frozen clock', () => {
        const uw = M().uploadWizard;
        return uw && uw.computeUploadOptions ? uw.computeUploadOptions(new Date()) : '(not exported)';
    });

    record('upload-wizard / computeMissingWeeks against the fixture', () => {
        const uw = M().uploadWizard;
        return uw && uw.computeMissingWeeks
            ? uw.computeMissingWeeks(fixture.weeklyData, new Date(), 12, fixture.ytdData)
            : '(not exported)';
    });
}

/* --- roster and pickers (pass 1) --- */

function recordRoster() {
    record('roster / the competing definitions, side by side', () => {
        const B = global.__BRIDGE || {};
        const attempts = {
            'getYearEndEmployees (year-end, on/off, mid-year, delete-year)': () => G('getYearEndEmployees')(),
            'getCallListeningEmployeeOptions (call listening)': () => G('getCallListeningEmployeeOptions')(),
            'coachingEmail.getCoachingLatestPeriodEmployees (coaching)': () => M().coachingEmail.getCoachingLatestPeriodEmployees(),
            'teamScope.getMyTeamRoster (meeting prep)': () => M().teamScope.getMyTeamRoster(),
            'teamFilter.filterAssociateNamesByTeamSelection (shared filter)': () => M().teamFilter.filterAssociateNamesByTeamSelection(B.ALL_NAMES || fixture.ALL_NAMES)
        };
        const out = {};
        Object.keys(attempts).forEach((k) => {
            try { out[k] = attempts[k](); } catch (err) { out[k] = '!! ' + err.message; }
        });
        return out;
    });

    record('team-filter / selection context and per-name inclusion', () => {
        const tf = M().teamFilter;
        const ctx = tf.getTeamSelectionContext();
        return {
            context: { weekKey: ctx.weekKey, isFiltering: ctx.isFiltering, totalEmployeesInWeek: ctx.totalEmployeesInWeek, selectedMembers: ctx.selectedMembers },
            included: fixture.ALL_NAMES.concat(['Not On The Team']).map((n) => n + ': ' + tf.isAssociateIncludedByTeamFilter(n, ctx))
        };
    });

    record('selected-associate / set, get and clear', () => {
        const sa = M().selectedAssociate;
        const seen = [];
        sa.set('Ben Ongoal');
        seen.push('after set: ' + JSON.stringify(sa.get()));
        sa.clear();
        seen.push('after clear: ' + JSON.stringify(sa.get()));
        sa.set('Cara Floor');
        seen.push('after second set: ' + JSON.stringify(sa.get()));
        return seen;
    });

    record('shared-utils / escapeHtml against names that need it', () => {
        const su = M().sharedUtils;
        return ['Ada Stretch', 'O\'Brien', 'a<b>c', 'x"y', 'p&q', ''].map((s) => JSON.stringify(s) + ' -> ' + JSON.stringify(su.escapeHtml(s)));
    });
}
/* --- tips (pass 2) --- */

function recordTips() {
    record('tips / getMetricTips called by KEY, the way Trends calls it', () => {
        const fn = G('getMetricTips');
        if (!fn) return '(getMetricTips not reachable)';
        const out = {};
        metricKeys().forEach((k) => { out[k] = fn(k); });
        return out;
    });

    record('tips / getMetricTips called by LABEL, the way Coaching calls it', () => {
        const fn = G('getMetricTips');
        const reg = global.window.METRICS_REGISTRY || {};
        if (!fn) return '(getMetricTips not reachable)';
        const out = {};
        metricKeys().forEach((k) => { out[reg[k].label] = fn(reg[k].label); });
        return out;
    });

    record('tips / getRandomTipsForMetric, seeded', () => {
        const fn = G('getRandomTipsForMetric');
        if (!fn) return '(not reachable)';
        const out = {};
        metricKeys().forEach((k) => {
            try { out[k] = fn(k, 3); } catch (err) { out[k] = '!! ' + err.message; }
        });
        return out;
    });

    record('tips / coachingEmail.chooseCoachingTip', () => {
        // Signature is (metricConfig, usedTips): a registry entry and a Set of
        // tips already spent on this email, so the same line is not handed out
        // twice for two different metrics.
        const ce = M().coachingEmail;
        const registry = global.window.METRICS_REGISTRY || {};
        const used = new Set();
        const out = {};
        metricKeys().forEach((k) => {
            if (!registry[k]) return;
            try { out[k] = ce.chooseCoachingTip(registry[k], used); }
            catch (err) { out[k] = '!! ' + err.message; }
        });
        out['__tipsSpentOnThisEmail__'] = used.size;
        return out;
    });

    record('tips / the two pools that must stay in step', () => {
        const embedded = fs.readFileSync(path.join(ROOT, 'modules/tips.module.js'), 'utf8')
            .match(/const EMBEDDED_TIPS_CSV = `([\s\S]*?)`;/);
        const file = fs.readFileSync(path.join(ROOT, 'tips.csv'), 'utf8');
        const norm = (s) => String(s).replace(/^﻿/, '').trim().split(/\r?\n/);
        const a = embedded ? norm(embedded[1]) : [];
        const b = norm(file);
        const setB = new Set(b), setA = new Set(a);
        return {
            embeddedRows: a.length,
            csvRows: b.length,
            onlyInEmbedded: a.filter((l) => !setB.has(l)).length,
            onlyInCsv: b.filter((l) => !setA.has(l)).length,
            keysInCsv: Array.from(new Set(b.slice(1).map((l) => l.split(',')[0]))).sort()
        };
    });
}
/* --- prompts and email builders (pass 3) --- */

// Dan Under is the subject for most prompts: below the floor on every KPI, so
// the harsher branches of every tone ladder are the ones exercised.
const SUBJECT = () => fixture.EMPLOYEES_2026[3];

function recordPromptsAndEmails() {
    const ce = M().coachingEmail;
    const subject = SUBJECT();

    record('coaching / collectCoachingPromptMetricData', () => {
        return ce.collectCoachingPromptMetricData(subject);
    });

    record('coaching / buildCoachingPrompt, full', () => {
        return ce.buildCoachingPrompt(subject);
    });

    record('coaching / buildCoachingPrompt for an associate meeting everything', () => {
        return ce.buildCoachingPrompt(fixture.EMPLOYEES_2026[0]);
    });

    record('coaching / buildCoachingPromptMetricsText', () => {
        const data = ce.collectCoachingPromptMetricData(subject);
        return ce.buildCoachingPromptMetricsText(data.wins, data.opportunities);
    });

    record('coaching / prompt sections', () => {
        const data = ce.collectCoachingPromptMetricData(subject);
        const texts = ce.buildCoachingPromptMetricsText(data.wins, data.opportunities);
        return {
            role: ce.buildCoachingPromptRoleSection(subject.name),
            voiceTone: ce.buildCoachingPromptVoiceToneSection(),
            rules: ce.buildCoachingPromptRulesSection(),
            flow: ce.buildCoachingPromptFlowSection(subject.firstName),
            outputRequirements: ce.buildCoachingPromptOutputRequirementsSection(subject.firstName),
            data: ce.buildCoachingPromptDataSection('2026-06-21', texts.winsText, texts.oppText),
            dataRules: ce.buildCoachingPromptDataRulesSection(),
            finalInstruction: ce.buildCoachingPromptFinalInstructionSection(subject.firstName)
        };
    });

    record('coaching / buildOutlookSubject', () => {
        const c = M().coaching;
        return ['2026-06-21', '', null].map((d) => JSON.stringify(d) + ' -> ' + c.buildOutlookSubject(subject.firstName, d));
    });

    record('call-listening / buildPrompt, with and without a transcript', () => {
        const cl = M().callListening;
        const entry = {
            employeeName: subject.name,
            listenedOn: '2026-06-18',
            callReference: 'CR-4471',
            opening: 'Greeted well and verified the account.',
            discovery: '',
            resolution: 'Fixed the billing question on the call.',
            closing: '',
            other: ''
        };
        return {
            withoutTranscript: cl.buildPrompt(entry, subject.firstName),
            withTranscript: cl.buildPrompt(
                Object.assign({}, entry, { transcript: 'Agent: Thanks for calling.\nCustomer: My bill went up.' }),
                subject.firstName
            )
        };
    });

    record('call-listening / buildOutlookSubject', () => {
        const cl = M().callListening;
        return ['2026-06-18', ''].map((d) => JSON.stringify(d) + ' -> ' + cl.buildOutlookSubject(subject.firstName, d));
    });
}
function recordReviewPrompts() {
    const subject = SUBJECT();

    record('year-end / buildCopilotPrompt', () => {
        return M().yearEnd.buildCopilotPrompt(
            {
                employeeName: subject.name, reviewYear: 2026,
                positivesText: '- Steady on adherence.',
                improvementsText: '- Handle time needs work.',
                managerContext: ''
            },
            { fallbackPositives: '', fallbackImprovements: '' },
            {
                preferredName: subject.firstName, trackLabel: 'Off Track',
                periodLabel: '2026 year-end period', sourceLabel: 'uploaded metrics',
                targetProfileLabel: '2026 year-end goals'
            }
        );
    });

    record('year-end / buildCopilotPrompt at each track label', () => {
        const ye = M().yearEnd;
        return ['Off Track', 'On Track/Successful', 'On Track/Exceptional'].map((label) => {
            const p = ye.buildCopilotPrompt(
                { employeeName: subject.name, reviewYear: 2026, positivesText: '- x', improvementsText: '- y', managerContext: '' },
                { fallbackPositives: '', fallbackImprovements: '' },
                { preferredName: subject.firstName, trackLabel: label, periodLabel: 'p', sourceLabel: 's', targetProfileLabel: 't' }
            );
            const line = String(p).split('\n').find((l) => l.indexOf('classification') !== -1);
            return label + ' -> ' + JSON.stringify(line || '(no classification line)');
        });
    });

    record('year-end / extractBoxText against four response shapes', () => {
        const ye = M().yearEnd;
        const responses = [
            'Box 1 - Significant Accomplishments:\nDid well.\n\nBox 2 - Future Improvement Areas:\nDo better.',
            'Section 1 - Highlights:\nGood.\n\nSection 2 - Improvement:\nMore.',
            'No headings at all, just prose about the year.',
            ''
        ];
        return responses.map((r, i) => 'response ' + i
            + ' -> box1=' + JSON.stringify(ye.extractBoxText(r, 1))
            + ' box2=' + JSON.stringify(ye.extractBoxText(r, 2)));
    });

    record('year-end / buildVerbalSummary', () => {
        return M().yearEnd.buildVerbalSummary(
            subject.firstName, 2026, 'On Track/Successful', '3% effective 1 March', '$1,200'
        );
    });

    record('mid-year / generateQuickCheckinPrompt', () => {
        const oo = M().onOffTracker;
        return typeof oo.generateQuickCheckinPrompt === 'function'
            ? oo.generateQuickCheckinPrompt(subject.name)
            : '(not exported)';
    });

    record('q1-review / generateQ1CopilotPrompt', () => {
        const q = M().q1Review;
        const data = q.buildQ1ReviewData();
        const emp = data && Array.isArray(data.employees)
            ? data.employees.find((e) => e.name === subject.name) || data.employees[0]
            : null;
        if (!emp) return '(no employee rows in Q1 data)';
        return q.generateQ1CopilotPrompt(emp, data);
    });

    record('trend-coaching-email / individual', () => {
        const t = M().trendCoachingEmail;
        return typeof t.generateIndividualCoachingEmail === 'function'
            ? t.generateIndividualCoachingEmail(subject.name) : '(not exported)';
    });

    record('trend-coaching-email / group', () => {
        const t = M().trendCoachingEmail;
        return typeof t.generateGroupCoachingEmail === 'function'
            ? t.generateGroupCoachingEmail() : '(not exported)';
    });

    record('copilot-prompt / generateVerintSummary (records the #employeeSelect defect)', () => {
        const seen = [];
        M().copilotPrompt.generateVerintSummary({
            document: global.document,
            alert: (m) => seen.push('alert: ' + m),
            console: { error() {} }
        });
        return seen.length ? seen : ['(returned without alerting)'];
    });
}
/* --- text generators --- */

function recordTextGenerators() {
    record('celebrations / detectCelebrations for each named window', () => {
        const c = M().celebrations;
        const out = {};
        c.listShoutOutWindows().forEach((w) => {
            const key = c.resolveShoutOutWindow ? c.resolveShoutOutWindow(w.id) : w.key;
            try { out[w.id] = c.detectCelebrations(key && key.key ? key.key : key); }
            catch (err) { out[w.id] = '!! ' + err.message; }
        });
        return out;
    });

    record('celebrations / generateAllShoutOuts, per window', () => {
        const c = M().celebrations;
        const out = {};
        c.listShoutOutWindows().forEach((w) => {
            try {
                const resolved = c.resolveShoutOutWindow(w.id);
                const key = (resolved && resolved.key) || w.key || null;
                const detected = c.detectCelebrations(key);
                out[w.id] = c.generateAllShoutOuts(
                    detected.celebrations || [],
                    detected.dateRange || '',
                    detected.periodKey || key
                );
            } catch (err) {
                out[w.id] = '!! ' + err.message;
            }
        });
        return out;
    });

    record('celebrations / placement highlighting (display only)', () => {
        const c = M().celebrations;
        // Pick the first window that actually produces placings, so this entry
        // records real highlighting rather than an empty post.
        let post = '';
        c.listShoutOutWindows().forEach((w) => {
            if (post) return;
            try {
                const resolved = c.resolveShoutOutWindow(w.id);
                const k = (resolved && resolved.key) || w.key;
                const detected = c.detectCelebrations(k);
                const text = c.generateAllShoutOuts(detected.celebrations || [], detected.dateRange || '', k);
                if (String(text).indexOf('in the Call Center') !== -1) post = text;
            } catch (err) { /* try the next window */ }
        });
        const highlighted = c.highlightPlacements(post);
        return {
            tiers: [1, 2, 5, 6, 10, 11, 25, 26, null].map((r) => String(r) + ' -> ' + String(c.placementTier(r))),
            // The post itself must be untouched by any of this.
            postIsUnchangedByHighlighting: highlighted.replace(/<\/?span[^>]*>/g, '')
                === post.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
                    .replace(/"/g, '&quot;').replace(/'/g, '&#39;'),
            spansOpened: (highlighted.match(/<span/g) || []).length,
            spansClosed: (highlighted.match(/<\/span>/g) || []).length,
            sample: highlighted.split('\n').filter((l) => l.indexOf('placement-tier') !== -1).slice(0, 3)
        };
    });

    record('celebrations / placement and tie wording', () => {
        const c = M().celebrations;
        return {
            describePlacement: [1, 2, 3, 4, 6, 11, 21, 100].map((n) => n + ' -> ' + c.describePlacement(n)),
            describeTie: [1, 2, 3].map((n) => n + ' -> ' + c.describeTie(n)),
            tieClause: [1, 2, 3].map((n) => n + ' -> ' + c.tieClause(n)),
            periodNoun: ['week', 'month', 'quarter', 'ytd', 'daily'].map((t) => t + ' -> ' + c.periodNoun(t))
        };
    });

    cannotCover('celebrations / findNearMiss',
        'Signature is findNearMiss(row, name, tiers, year, ctx, data) — six arguments, '
        + 'four of which are internal shapes built inside renderCelebrations. Reaching it '
        + 'honestly would mean reconstructing that internal state, and constructing it wrongly '
        + 'would bake a fiction into the contract. Reached indirectly through '
        + 'generateAllShoutOuts instead.');

    record('year-standing / buildYearStandingText per associate', () => {
        const ys = M().yearStanding;
        const out = {};
        fixture.ALL_NAMES.forEach((n) => {
            try { out[n] = ys.buildYearStandingText(n); } catch (err) { out[n] = '!! ' + err.message; }
        });
        return out;
    });

    record('year-standing / classifyMovement and phrasing', () => {
        const ys = M().yearStanding;
        return {
            classify: [[1, 1], [1, 5], [5, 1], [10, 3], [3, 10], [50, 48]]
                .map((p) => p.join('->') + ' : ' + JSON.stringify(ys.classifyMovement(p[0], p[1], 100))),
            monthsLeft: ys.monthsLeftInYear(),
            urgency: ys.urgencyLine ? ys.urgencyLine() : '(n/a)'
        };
    });

    record('metric-movement / arrow, phrase, sentence for both directions', () => {
        const mm = M().metricMovement;
        const cases = [['scheduleAdherence', 92, 94], ['scheduleAdherence', 94, 92],
            ['aht', 440, 420], ['aht', 420, 440], ['reliability', 20, 10], ['transfers', 6, 4]];
        return cases.map((c) => c[0] + ' ' + c[1] + '->' + c[2] + ' : '
            + 'dir=' + mm.resolveDirection(c[0], c[1], c[2])
            + ' delta=' + mm.performanceDelta(c[0], c[1], c[2])
            + ' phrase=' + JSON.stringify(mm.phrase(c[0], c[1], c[2]))
            + ' sentence=' + JSON.stringify(mm.sentence(c[0], c[1], c[2])));
    });

    record('message-voice / greeting pools', () => {
        const mv = M().messageVoice;
        return {
            celebratory: [0, 1, 2].map(() => mv.greeting('celebratory', 'Ada')),
            neutral: [0, 1, 2].map(() => mv.greeting('neutral', 'Ada')),
            poolSizes: { celebratory: mv.greetingPool('celebratory').length, neutral: mv.greetingPool('neutral').length }
        };
    });

    record('rank-projection / projection arithmetic', () => {
        const rp = M().rankProjection;
        const rows = fixture.EMPLOYEES_2026.map((e) => ({ name: e.name, scheduleAdherence: e.scheduleAdherence }));
        return {
            registryKeyFor: ['adherence', 'aht', 'sentiment', 'reliability', 'transfers'].map((k) => k + ' -> ' + String(rp.registryKeyFor(k))),
            moveIsNoise: [['scheduleAdherence', 0.5], ['scheduleAdherence', 2], ['aht', 5], ['aht', 20]]
                .map((c) => c[0] + ' ' + c[1] + ' -> ' + rp.moveIsNoise(c[0], c[1])),
            projectRank: (() => { try { return rp.projectRank(rows, 'adherence', 'Cara Floor', 94); } catch (err) { return '!! ' + err.message; } })()
        };
    });

    cannotCover('monday-morning-post / the post text',
        'mondayPost exports only initializeMondayPost, which reads three <select> '
        + 'elements and writes into the DOM. The text assembly is not separable from '
        + 'the render without moving code, so it is left alone. Consolidating period '
        + 'selection (pass 5) touches this module — that pass will need a browser '
        + 'spot-check rather than a baseline diff.');

    cannotCover('morning-pulse / the pulse text',
        'Same shape: no pure text builder is exported. The pulse assembles and renders '
        + 'in one pass. Its metric classification is covered indirectly through '
        + 'metric-trends classifyTrendMetric.');

    record('call-qa / scoreCall and text', () => {
        const q = M().callQa;
        const scored = q.scoreCall({ transcript: 'Agent: Thank you for calling. Customer: My bill is high.' });
        return { scored: scored, text: q.buildQaText(scored) };
    });

    record('call-trends / summarizeHistory', () => {
        const ct = M().callTrends;
        return ct.summarizeHistory([
            { date: '2026-06-01', score: 3 }, { date: '2026-06-08', score: 4 }, { date: '2026-06-15', score: 2 }
        ]);
    });
}

/* --- clipboard and mail (pass 4) --- */

function recordClipboardAndMail() {
    record('ui-utils / copyToClipboard outcomes', () => {
        const ui = M().uiUtils;
        const seen = [];
        const origToast = global.window.showToast;
        global.window.showToast = (m, d) => seen.push('toast(' + JSON.stringify(m) + ', ' + d + ')');
        const results = [];
        return Promise.resolve()
            .then(() => ui.copyToClipboard('', {}))
            .then((r) => { results.push('empty -> ' + r); return ui.copyToClipboard('hello', { silent: true }); })
            .then((r) => { results.push('silent -> ' + r); return ui.copyToClipboard('hello', { message: 'Custom' }); })
            .then((r) => { results.push('custom -> ' + r); })
            .then(() => { global.window.showToast = origToast; return { results: results, toasts: seen }; });
    });

    record('shared-utils / getCoachingCcEmail (records the never-written key)', () => {
        return JSON.stringify(M().sharedUtils.getCoachingCcEmail());
    });

    record('shared-utils / formatLocalDate and joinWithConjunction', () => {
        const su = M().sharedUtils;
        return {
            dates: ['2026-06-21', '2026-01-01', '2025-12-31'].map((d) => d + ' -> ' + su.formatLocalDate(d)),
            joins: [[], ['a'], ['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd']]
                .map((l) => JSON.stringify(l) + ' -> ' + JSON.stringify(su.joinWithConjunction(l)))
        };
    });
}
/* --- associate pickers (pass 1) --- */

// A <select> that actually behaves like one for the two things the pickers do
// to it: assigning innerHTML clears its children, and appendChild adds one.
// The fake element in installBrowser treats innerHTML as an inert property,
// which would let cleared options survive and make this section a fiction.
function fakeSelect(id) {
    const el = global.__DOM.makeElement(id);
    let html = '';
    el.children = [];

    // Assigning innerHTML has to actually produce options, not just store a
    // string. Half the pickers built their entire list as HTML and the other
    // half appended elements; if this setter only cleared, the HTML-built ones
    // would read as empty and a before/after comparison would be worthless.
    // Only <option> needs parsing, which is all these selects ever contain.
    function parseOptions(source) {
        const out = [];
        const re = /<option([^>]*)>([\s\S]*?)<\/option>/g;
        let m;
        while ((m = re.exec(source)) !== null) {
            const attrs = m[1] || '';
            const valueMatch = attrs.match(/value\s*=\s*"([^"]*)"/);
            out.push({
                value: valueMatch ? unescapeHtml(valueMatch[1]) : unescapeHtml(m[2]),
                textContent: unescapeHtml(m[2]),
                selected: /\bselected\b/.test(attrs)
            });
        }
        return out;
    }

    function unescapeHtml(s) {
        return String(s)
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
            .replace(/&amp;/g, '&');
    }

    Object.defineProperty(el, 'innerHTML', {
        get() { return html; },
        // A real <select> drops its selection when its options are replaced.
        set(v) { html = String(v); el.children = parseOptions(html); el.value = ''; }
    });
    el.appendChild = function (child) { el.children.push(child); return child; };
    // The Trends group-analysis picker reads its existing blank option back to
    // keep its own label, so this has to answer for real.
    el.querySelector = function (sel) {
        if (sel === 'option[value=""]') {
            return el.children.filter(function (o) { return String(o.value) === ''; })[0] || null;
        }
        return null;
    };
    if (id) global.__DOM.elements[id] = el;
    return el;
}

function readOptions(select) {
    return (select.children || []).map((o) =>
        JSON.stringify(String(o.value)) + ' => ' + JSON.stringify(String(o.textContent)));
}

function recordPickers() {
    record('picker / year-end, on-off and mid-year share one population fn', () => {
        const out = {};
        const ye = fakeSelect('yearEndEmployeeSelect');
        M().yearEndComments.populateYearEndEmployeeSelect(ye);
        out['yearEndEmployeeSelect'] = readOptions(ye);

        const oo = fakeSelect('onOffTrackerEmployeeSelect');
        M().onOffTracker.populateOnOffTrackerEmployeeSelect(oo);
        out['onOffTrackerEmployeeSelect (also Mid-Year)'] = readOptions(oo);
        return out;
    });

    record('picker / coaching', () => {
        const sel = fakeSelect('coachingEmployeeSelect');
        const { employees } = M().coachingEmail.getCoachingLatestPeriodEmployees(fixture.LATEST_WEEK_KEY);
        M().coachingEmail.populateCoachingEmployeeSelectOptions(sel, employees);
        return readOptions(sel);
    });

    record('picker / call listening, delete-year data', () => {
        const out = {};
        const cl = fakeSelect('callListeningEmployeeSelect');
        G('populateCallListeningEmployeeSelect')(cl, G('getCallListeningEmployeeOptions')(), 'Cara Floor');
        out['callListeningEmployeeSelect (with a live selection)'] = readOptions(cl);
        out['  selection kept'] = String(cl.value);

        const dy = fakeSelect('deleteEmployeeYearSelect');
        G('populateDeleteEmployeeYearOptions')();
        out['deleteEmployeeYearSelect'] = readOptions(dy);
        return out;
    });

    record('picker / trends, sentiment, follow-up, 1:1 prep', () => {
        const out = {};
        const te = fakeSelect('trendEmployeeSelect');
        G('populateEmployeeDropdownForPeriod')(fixture.LATEST_WEEK_KEY);
        out['trendEmployeeSelect'] = readOptions(te);

        G('populateEmployeeDropdownForPeriod')('');
        out['trendEmployeeSelect (no period selected)'] = readOptions(te);

        G('populateEmployeeDropdownForPeriod')('2099-01-01|2099-01-07');
        out['trendEmployeeSelect (period with no employees)'] = readOptions(te);

        const su = fakeSelect('sentimentUploadAssociate');
        M().sentiment.populateSentimentAssociateDropdown
            ? M().sentiment.populateSentimentAssociateDropdown()
            : G('populateSentimentAssociateDropdown') && G('populateSentimentAssociateDropdown')();
        out['sentimentUploadAssociate'] = readOptions(su);

        const fu = fakeSelect('followUpPersonName');
        G('populateFollowUpAssociateDropdown') && G('populateFollowUpAssociateDropdown')();
        out['followUpPersonName (no team filter, deliberately)'] = readOptions(fu);

        const sa = fakeSelect('summaryAssociateSelect');
        const oo = fakeSelect('oneOnOneAssociateSelect');
        G('populateExecutiveSummaryAssociate') && G('populateExecutiveSummaryAssociate')();
        out['summaryAssociateSelect'] = readOptions(sa);
        out['oneOnOneAssociateSelect'] = readOptions(oo);
        return out;
    });

    record('picker / trends group-analysis selector keeps its own blank label', () => {
        // Its blank option is not a "pick someone" prompt: choosing it runs the
        // group analysis. The label has to survive repopulation, twice over,
        // because the second call reads back what the first one wrote.
        const sel = fakeSelect('trendEmployeeSelector');
        sel.innerHTML = '<option value="">🏢 All Team Members (Group Analysis)</option>';
        const out = {};
        G('initializeTrendIntelligence')();
        out['after first populate'] = readOptions(sel);
        G('initializeTrendIntelligence')();
        out['after second populate'] = readOptions(sel);
        return out;
    });

    record('picker / reliability keeps review-priority order and its own labels', () => {
        const sel = fakeSelect('relEmployeeSelect');
        const ap = M().associatePicker;
        const priority = ['Dan Under', 'Cara Floor', 'Ada Stretch'];
        const labels = { 'Dan Under': 'Dan Under (review)', 'Cara Floor': 'Cara Floor', 'Ada Stretch': 'Ada Stretch' };
        sel.innerHTML = ap.optionsHtml(priority, {
            sort: false, teamFilter: false, label: (n) => labels[n]
        });
        return readOptions(sel);
    });

    record('picker / the shared builder itself', () => {
        const ap = M().associatePicker;
        const messy = ['  Cara Floor ', 'Ada Stretch', 'Cara Floor', '', null, 'Ben Ongoal', '   '];
        return {
            defaultPlaceholder: ap.DEFAULT_PLACEHOLDER,
            normalize_dedupesTrimsSorts: ap.normalizeNames(messy),
            normalize_sortFalseKeepsOrder: ap.normalizeNames(messy, { sort: false }),
            normalize_teamFilterOff: ap.normalizeNames(['Not On The Team'].concat(fixture.ALL_NAMES), { teamFilter: false }),
            normalize_teamFilterOn: ap.normalizeNames(['Not On The Team'].concat(fixture.ALL_NAMES)),
            optionsHtml_escapesNames: ap.optionsHtml(['a<b>c', 'x"y', "O'Brien", 'p&q'], { teamFilter: false }),
            optionsHtml_marksSelected: ap.optionsHtml(fixture.ALL_NAMES, { selected: 'Cara Floor' }),
            optionsHtml_labelDiffersFromValue: ap.optionsHtml(['Ada Stretch', 'Ben Ongoal'], { label: (n) => n + ' (3)' }),
            populate_emptyRosterLeavesPlaceholder: (() => {
                const s = fakeSelect();
                ap.populateSelect(s, []);
                return readOptions(s);
            })(),
            populate_extraOptions: (() => {
                const s = fakeSelect();
                ap.populateSelect(s, ['Ada Stretch'], { extraOptions: [{ value: 'ALL', label: 'All Associates' }] });
                return readOptions(s);
            })()
        };
    });
}

/* ---------- report rendering ---------- */

function renderReport() {
    const lines = [];
    lines.push('BEHAVIOUR BASELINE');
    lines.push('='.repeat(78));
    lines.push('');
    lines.push('Generated by `node tests/baseline.js` against baseline/fixture.js.');
    lines.push('Clock frozen at 2026-06-25T09:00 America/Phoenix. Math.random seeded per entry.');
    lines.push('');
    lines.push('This file is a contract, not documentation. After a refactoring pass, an');
    lines.push('empty `git diff` here means the pass changed no behaviour. A non-empty diff');
    lines.push('is either an intended change that needs explaining line by line, or a bug.');
    lines.push('');
    lines.push('Entries: ' + sections.length + '   Not covered: ' + skipped.length);
    lines.push('');

    for (const s of sections) {
        lines.push('-'.repeat(78));
        lines.push(s.label);
        lines.push('-'.repeat(78));
        lines.push(s.body);
        lines.push('');
    }

    return lines.join('\n') + '\n';
}

function writeNotCovered() {
    const lines = [];
    lines.push('# Not covered by the baseline');
    lines.push('');
    lines.push('Generated by `node tests/baseline.js`. Do not edit by hand.');
    lines.push('');
    lines.push('Everything here is something the harness could not call in isolation.');
    lines.push('Per the ground rules for this work, these are **recorded, not refactored**:');
    lines.push('no application code was changed to make anything on this list reachable.');
    lines.push('');

    if (loadNotes.length) {
        lines.push('## Files that failed to load');
        lines.push('');
        loadNotes.forEach((n) => lines.push('- `' + n.file + '` — ' + n.error));
        lines.push('');
    } else {
        lines.push('## Files that failed to load');
        lines.push('');
        lines.push('None. All ' + moduleOrderFromIndexHtml().length + ' modules and `script.js`');
        lines.push('evaluate cleanly under the harness.');
        lines.push('');
    }

    lines.push('## Entry points not called');
    lines.push('');
    if (!skipped.length) {
        lines.push('None recorded.');
    } else {
        let group = null;
        skipped.forEach((s) => {
            const g = s.label.split(' / ')[0];
            if (g !== group) { group = g; lines.push(''); lines.push('### ' + g); lines.push(''); }
            lines.push('- **' + s.label + '** — ' + s.reason);
        });
    }
    lines.push('');

    fs.writeFileSync(path.join(OUT_DIR, 'NOT-COVERED.md'), lines.join('\n') + '\n');
}

async function main() {
    const args = process.argv.slice(2);

    // The app is chatty on the way in (roster seeding, migrations) and then
    // silences console.log itself. Quiet it for the load so the harness owns
    // stdout, using the handle taken at the top of this file.
    const realConsole = { log: console.log, warn: console.warn, error: console.error };
    const quiet = () => {};
    console.log = quiet; console.warn = quiet; console.error = quiet;
    console.info = quiet; console.debug = quiet; console.trace = quiet;
    loadApplication();
    console.warn = quiet; console.error = quiet; console.info = quiet;

    if (args.includes('--surface')) {
        console.log = realConsole.log;
        printSurface();
        return;
    }

    recordAll();
    await Promise.all(pending);

    const text = renderReport();
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const previous = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : null;
    fs.writeFileSync(OUT_FILE, text);
    writeNotCovered();

    console.log = realConsole.log;
    say('baseline: ' + entryCount + ' entries, ' + skipped.length + ' not covered');
    say('wrote ' + path.relative(ROOT, OUT_FILE));

    if (args.includes('--check')) {
        if (previous === null) { say('no previous baseline to compare against'); return; }
        if (previous === text) { say('unchanged'); return; }
        say('CHANGED -- run `git diff baseline/outputs.txt` to see what moved');
        process.exitCode = 1;
    }
}

main();
