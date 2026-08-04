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
const suites = [];

function suite(name, fn) {
    suites.push({ name, fn });
}

/* ── Fake browser ── */

// Enough DOM for modules that touch document/localStorage at load time.
// Deliberately small: a test needing more should build what it needs rather
// than growing a shared pseudo-browser nobody understands.
function installFakeBrowser(extra) {
    const store = {};
    const els = {};

    global.localStorage = {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
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
            loadModule
        };
        try {
            await s.fn(ctx);
        } catch (err) {
            failures.push(`${s.name} → threw: ${err && err.message}`);
            console.log(`  ✗ threw: ${err && err.stack ? err.stack.split('\n')[0] : err}`);
        }
    }

    return { pass, fail: failures.length, failures };
}

module.exports = { suite, run, installFakeBrowser, loadModule, ROOT };
