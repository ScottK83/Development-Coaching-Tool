/**
 * Minimal test harness. No npm, no dependencies, no build step — the same
 * constraints the app runs under.
 *
 *   node tests/run.js            run everything
 *   node tests/run.js movement   run suites whose name matches "movement"
 *
 * Modules under test are browser IIFEs that hang themselves off `window`, so
 * loadModule() fakes just enough of a browser for them to load, then hands
 * back window.DevCoachModules.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

/* ── The clock ──
 *
 * Every fixture in this suite is written in 2026, and the modules under test
 * ask the real calendar what year and month it is right now. So the suite's
 * result depended on the day you ran it, and it changed underneath us twice:
 *
 *   from 2026-09-01   8 assertions in period-compare failed, because a
 *                     month-to-date row only takes over the CURRENT month and
 *                     August had stopped being it.
 *   from 2027-01-01   143 assertions fail across ~40 suites — rankings, rank
 *                     ladder, cheers, period compare — because the helpers
 *                     default to the current year and there is no 2027 data.
 *
 * The first one went unnoticed for a day and quietly disabled the pre-push
 * gate, which is the real cost: a suite that fails for calendar reasons stops
 * being a signal and starts being something people bypass.
 *
 * A test whose result depends on when it runs is not a test, so the clock is
 * fixed here. Any date in August 2026 makes the whole suite green; the 18th is
 * the day the month-to-date feature landed, which is the behaviour most
 * sensitive to it.
 *
 * TEST_CLOCK overrides it, and that is the point rather than an escape hatch:
 *
 *   TEST_CLOCK=2027-01-01 node tests/run.js    probe the year rollover
 *   TEST_CLOCK=real       node tests/run.js    run against the wall clock
 *
 * Note what fixing the clock does NOT tell you. It makes the suite reproducible;
 * it does not prove the app behaves correctly on 1 January. Use TEST_CLOCK to
 * ask that question deliberately.
 */
const FIXTURE_CLOCK = '2026-08-18';
const clockSetting = process.env.TEST_CLOCK || FIXTURE_CLOCK;
// Captured before anything below reassigns global.Date, so pinClock always
// builds on the genuine Date rather than on another pin.
const REAL_DATE = Date;

if (clockSetting !== 'real') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(clockSetting)) {
        throw new Error(`TEST_CLOCK must be YYYY-MM-DD or "real", got "${clockSetting}"`);
    }
    const fixedMs = new REAL_DATE(`${clockSetting}T12:00:00Z`).getTime();
    if (Number.isNaN(fixedMs)) throw new Error(`TEST_CLOCK is not a real date: "${clockSetting}"`);

    // Only an argument-less `new Date()` is redirected. Every other form has to
    // keep working exactly as before, because the fixtures are built from
    // explicit date strings and the modules parse them.
    global.Date = makePinnedDate(fixedMs);
}

/**
 * A Date whose argument-less constructor is fixed. Every other form is
 * untouched: fixtures are built from explicit date strings and the modules
 * parse them.
 */
function makePinnedDate(fixedMs) {
    return class PinnedDate extends REAL_DATE {
        constructor(...args) {
            if (args.length === 0) super(fixedMs);
            else super(...args);
        }
        static now() { return fixedMs; }
    };
}


const suites = [];

function suite(name, fn) {
    suites.push({ name, fn });
}

/* ── Fake browser ── */

// Enough DOM for modules that touch document/localStorage at load time.
// Deliberately small: a test needing more should build what it needs rather
// than growing a shared pseudo-browser nobody understands.
// Real timers, captured before any suite runs. Suites are free to stub these
// for their own purposes, but leaving a stub in place silently changes timing
// for every suite loaded afterwards, and the symptom shows up somewhere else
// entirely. Restoring on each installFakeBrowser keeps a stub scoped to the
// suite that wanted it.
const realTimers = {
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
    setInterval: global.setInterval,
    clearInterval: global.clearInterval
};

function installFakeBrowser(extra) {
    const store = {};
    const els = {};

    Object.assign(global, realTimers);

    // length, key() and clear() are part of the real Storage interface and the
    // app depends on them: every backup sweep, the quota meter and delete-all
    // enumerate the store. Without them here, code that iterates localStorage
    // silently sees an empty store and its test passes for the wrong reason.
    global.localStorage = {
        get length() { return Object.keys(store).length; },
        key: (i) => Object.keys(store)[i] ?? null,
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { Object.keys(store).forEach((k) => { delete store[k]; }); },
        _store: store
    };

    global.Event = class { constructor(type) { this.type = type; } };
    global.MutationObserver = class {
        constructor(cb) { this.cb = cb; }
        observe(target) { this.target = target; target._observer = this; }
        disconnect() {}
    };

    global.document = {
        _els: els,
        getElementById: (id) => els[id] || null,
        querySelectorAll: () => [],
        addEventListener() {},
        createElement: () => ({
            style: {}, dataset: {}, value: '', textContent: '',
            setAttribute() {}, select() {}, addEventListener() {},
            appendChild() {}, querySelector: () => null
        }),
        body: { appendChild() {}, removeChild() {} },
        head: { appendChild() {} },
        execCommand: () => true
    };

    global.window = Object.assign({
        DevCoachModules: {},
        DevCoachConstants: { STORAGE_PREFIX: 'devCoachingTool_', COPILOT_URL: 'https://copilot.microsoft.com' }
    }, extra || {});

    return { store, els };
}

// Load a browser module by path relative to the repo root.
function loadModule(relPath) {
    const src = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    (0, eval)(src); // indirect eval → global scope, so `window` resolves
    return global.window.DevCoachModules;
}

/* ── Runner ── */

async function run(filter) {
    let pass = 0;
    const failures = [];

    const selected = filter
        ? suites.filter((s) => s.name.toLowerCase().includes(filter.toLowerCase()))
        : suites;

    if (!selected.length) {
        console.log(filter ? `No suites match "${filter}".` : 'No suites registered.');
        return { pass: 0, fail: 0, failures };
    }

    for (const s of selected) {
        console.log(`\n${s.name}`);
        const ctx = {
            check(label, cond) {
                if (cond) {
                    pass++;
                    console.log(`  ✓ ${label}`);
                } else {
                    failures.push(`${s.name} → ${label}`);
                    console.log(`  ✗ ${label}`);
                }
            },
            equal(label, actual, expected) {
                const ok = Object.is(actual, expected);
                ctx.check(ok ? label : `${label}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`, ok);
            },
            installFakeBrowser,
            loadModule,
            /**
             * Pin this suite's clock to a specific day.
             *
             * For fixtures inherently tied to a date: a month-to-date row only
             * ever takes over the CURRENT month, so a suite testing one has to
             * agree with the calendar about which month that is. Declaring the
             * date makes a suite say what it depends on, and keeps
             * TEST_CLOCK=2027-01-01 a signal about the application rather than
             * about fixture dates.
             *
             * Restored after the suite, so it never leaks into the next one.
             */
            pinClock(date) {
                const ms = new REAL_DATE(`${date}T12:00:00Z`).getTime();
                if (Number.isNaN(ms)) throw new Error(`pinClock needs YYYY-MM-DD, got "${date}"`);
                global.Date = makePinnedDate(ms);
            }
        };
        const clockBeforeSuite = global.Date;
        try {
            await s.fn(ctx);
        } catch (err) {
            failures.push(`${s.name} → threw: ${err && err.message}`);
            console.log(`  ✗ threw: ${err && err.stack ? err.stack.split('\n')[0] : err}`);
        } finally {
            global.Date = clockBeforeSuite;
        }
    }

    return { pass, fail: failures.length, failures };
}

module.exports = { suite, run, installFakeBrowser, loadModule, ROOT };
