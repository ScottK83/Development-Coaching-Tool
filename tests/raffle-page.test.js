'use strict';

/**
 * raffle.html, the draw on its own for a shared screen.
 *
 * The page is only the show. Who wins has to come from contest.drawWinner,
 * the same draw the Contest panel runs, or the two could disagree about the
 * odds or let somebody win twice. And it must never write anything: it reads
 * the month from cloud storage and the sync settings from this browser.
 */

const fs = require('fs');
const path = require('path');
const { suite } = require('./harness');

const ROOT = path.join(__dirname, '..');

function page() {
    return fs.readFileSync(path.join(ROOT, 'raffle.html'), 'utf8');
}

suite('raffle page: the winner comes from the contest module', (t) => {
    const html = page();

    t.check('it loads the contest module', /modules\/contest\.module\.js/.test(html));
    t.check('it draws with drawWinner', /contest\(\)\.drawWinner\(/.test(html));
    t.check('and skips anyone already drawn', /drawWinner\([^)]*exclude:\s*drawn/.test(html));
    t.check('it has no draw of its own: crypto stays in the module', !/getRandomValues/.test(html));
    t.check('the winning ticket is worded by the module', /result\.wonWith/.test(html) && !/perfect survey'/.test(html));
});

suite('raffle page: the Contest panel links to it', (t) => {
    const ui = fs.readFileSync(path.join(ROOT, 'modules/contest-ui.module.js'), 'utf8');

    t.check('there is a link to the raffle screen', /id="contestRaffleLink" href="raffle"/.test(ui));
    t.check('it opens in its own tab', /id="contestRaffleLink"[^>]*target="_blank"/.test(ui));
    t.check('and carries the month on screen when it has tickets', /'raffle\?month=' \+ monthKey/.test(ui));
});

suite('raffle page: the sound is resumed, not left paused', (t) => {
    const html = page();

    // A browser can start page audio paused, and a paused context plays
    // nothing without saying why. That was the "no sound" on 2026-09-30.
    t.check('it resumes a suspended context', /state === 'suspended'[^\n]*resume\(\)/.test(html));
});

suite('raffle page: it reads the saved month and writes nothing', (t) => {
    const html = page();

    t.check('it asks the worker for the month', /mode:\s*'contestGet'/.test(html));
    t.check('never for a save', !/contestSave/.test(html));
    t.check('it reads the same sync settings the app keeps',
        html.indexOf("'devCoachingTool_callListeningSyncConfig'") > -1);
    t.check('nothing is written to the browser', !/setItem\(|sessionStorage|indexedDB/.test(html));
    t.check('nothing is saved to the computer', !/\.download\s*=|createObjectURL/.test(html));
});

// ---------- running the page ----------
// Just enough of a browser to run raffle.html's script: elements that hold
// children, a fetch that hands back one month, and timers flushed by hand.

const vm = require('vm');

function fakeElement(tag, id) {
    const listeners = {};
    const classes = new Set();
    const attrs = {};
    const e = {
        tagName: tag, id, children: [], parentNode: null, style: {}, textContent: '', className: '',
        disabled: false, clientWidth: 600, scrollWidth: 100, offsetWidth: 0,
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c)
        },
        appendChild(child) { child.parentNode = e; e.children.push(child); if (e.onAppend) e.onAppend(child); return child; },
        insertBefore(child, ref) {
            child.parentNode = e;
            const at = ref ? e.children.indexOf(ref) : -1;
            if (at < 0) e.children.push(child); else e.children.splice(at, 0, child);
            return child;
        },
        removeChild(child) { e.children.splice(e.children.indexOf(child), 1); child.parentNode = null; return child; },
        contains(other) { for (let n = other; n; n = n.parentNode) if (n === e) return true; return false; },
        get firstChild() { return e.children[0] || null; },
        get nextSibling() {
            if (!e.parentNode) return null;
            const list = e.parentNode.children;
            return list[list.indexOf(e) + 1] || null;
        },
        setAttribute(k, v) { attrs[k] = String(v); },
        getAttribute(k) { return k in attrs ? attrs[k] : null; },
        removeAttribute(k) { delete attrs[k]; },
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        fire(type, event) { (listeners[type] || []).forEach((fn) => fn(Object.assign({ target: e, preventDefault() {} }, event))); },
        click() { e.fire('click'); },
        focus() {},
        closest(sel) {
            for (let n = e; n; n = n.parentNode) if (sel === 'button' && n.tagName === 'button') return n;
            return null;
        },
        querySelector(sel) {
            const want = sel.replace(/^\./, '');
            for (const child of e.children) {
                if (child.className === want || child.classList.contains(want)) return child;
                const deeper = child.querySelector(sel);
                if (deeper) return deeper;
            }
            return null;
        },
        getContext: () => new Proxy({}, { get: () => () => {} })
    };
    return e;
}

function openRaffle(monthData, search, draws) {
    const html = page();
    const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
    const byId = {};
    const timers = [];
    const document = {
        body: fakeElement('body'),
        head: fakeElement('head'),
        getElementById: (id) => (byId[id] = byId[id] || fakeElement(id === 'go' || id === 'sound' ? 'button' : 'div', id)),
        createElement: (tag) => fakeElement(tag),
        addEventListener: (type, fn) => document.body.addEventListener(type, fn)
    };
    const location = { pathname: '/raffle', search: search || '' };
    const sandbox = {
        document, location, URLSearchParams, Promise, Math, Date, String, Number, Array, Object, JSON, Error, atob, btoa,
        innerWidth: 1200, innerHeight: 800, devicePixelRatio: 1,
        matchMedia: () => ({ matches: false }),
        addEventListener() {},
        requestAnimationFrame() {},
        setTimeout: (fn) => timers.push(fn),
        localStorage: { getItem: () => null },
        history: { replaceState(state, title, url) { location.search = url.slice(url.indexOf('?')); } },
        crypto: { getRandomValues(buffer) { buffer[0] = draws.shift() || 0; return buffer; } },
        fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, data: monthData }) })
    };
    sandbox.window = sandbox;
    // The page loads the contest module with a script tag: run it in the same window.
    document.head.onAppend = (tag) => {
        vm.runInContext(fs.readFileSync(path.join(ROOT, 'modules/contest.module.js'), 'utf8'), sandbox);
        tag.onload();
    };
    vm.createContext(sandbox);
    vm.runInContext(script, sandbox);
    const settle = () => new Promise((resolve) => setImmediate(resolve));
    const flush = () => { while (timers.length) timers.shift()(); };
    const chips = () => byId.winners.children.map((chip) => ({
        name: chip.getAttribute('data-name'),
        out: chip.classList.contains('skipped'),
        hasX: !!chip.querySelector('.skip')
    }));
    // The x, then one of the two ways out it offers.
    const takeOut = (index, choice) => {
        const chip = byId.winners.children[index];
        chip.querySelector('.skip').click();
        const menu = chip.querySelector('.choice');
        const button = menu && menu.children.find((b) => b.textContent === choice);
        if (button) button.click();
        return { menu, button };
    };
    return { byId, settle, flush, chips, location, takeOut };
}

const bowl = { days: { '2026-09-08': { 'Ann Zeta': { perfectSurveys: 3 }, 'Bo Yu': { perfectSurveys: 2 }, 'Cy Vale': { perfectSurveys: 1 } } } };

// What the address remembers, unscrambled.
function sittingIn(search) {
    const packed = new URLSearchParams(search).get('sitting');
    return packed ? JSON.parse(Buffer.from(packed, 'base64url').toString('utf8')) : null;
}

suite('raffle page: out of the raffle takes them off the screen and draws again', async (t) => {
    // Chances are tickets squared: Ann 9 (0-8), Bo 4, Cy 1. Draw 0 is the
    // first person still in the bowl.
    const r = openRaffle(bowl, '?month=2026-09', [0, 0, 0, 0]);
    await r.settle();

    r.byId.go.click();
    r.flush();
    r.byId.go.click();
    r.flush();
    t.equal('Ann then Bo are drawn', r.chips().map((c) => c.name).join(','), 'Ann Zeta,Bo Yu');
    t.check('each name has an x next to it', r.chips().every((c) => c.hasX));

    const asked = r.takeOut(0, 'Out of the raffle');
    t.check('the x asks which way out', !!asked.menu && asked.menu.children.length === 2);
    r.flush();
    t.equal('she is gone from the screen, and the new winner goes on the end', r.chips().map((c) => c.name).join(','), 'Bo Yu,Cy Vale');
    t.check('the address does not spell out her name', !/Ann/i.test(r.location.search));
    t.equal('but it still knows she is out', JSON.stringify(sittingIn(r.location.search)),
        JSON.stringify({ won: ['Bo Yu', 'Cy Vale'], out: ['Ann Zeta'] }));
    t.equal('and she cannot come up again', r.byId.go.textContent, 'Everyone has been drawn');
    t.check('nothing on the ticket says it was a redraw', !/again/i.test(r.byId.label.textContent));
});

suite('raffle page: out of this round puts their tickets back for the next prize', async (t) => {
    const r = openRaffle(bowl, '?month=2026-09', [0, 0, 0, 0]);
    await r.settle();

    r.byId.go.click();
    r.flush();
    r.byId.go.click();
    r.flush();
    t.equal('Ann then Bo are drawn', r.chips().map((c) => c.name).join(','), 'Ann Zeta,Bo Yu');

    // Watch every name that flashes past while the next prize is drawn.
    const shown = [];
    let current = r.byId.name.textContent;
    Object.defineProperty(r.byId.name, 'textContent', { get: () => current, set: (v) => { current = v; shown.push(v); } });

    r.takeOut(0, 'Out of this round');
    r.flush();
    t.equal('she is gone from the screen, and the new winner goes on the end', r.chips().map((c) => c.name).join(','), 'Bo Yu,Cy Vale');
    t.check('she does not even flash past on that draw', shown.length > 1 && !shown.includes('Ann Zeta'));
    t.equal('the address does not hold her as out', JSON.stringify(sittingIn(r.location.search)),
        JSON.stringify({ won: ['Bo Yu', 'Cy Vale'], out: [] }));
    t.equal('her tickets are back in the bowl', r.byId.pool.textContent, '3 tickets left in the bowl');

    r.byId.go.click();
    r.flush();
    t.equal('and she can win the next prize', r.chips().map((c) => c.name).join(','), 'Bo Yu,Cy Vale,Ann Zeta');
});

suite('raffle page: the x only shows with the mouse on the chip', (t) => {
    const html = page();
    t.check('it starts hidden', /\.winners \.skip \{[^}]*opacity: 0;/.test(html));
    t.check('and shows on hover', /\.winners li:hover \.skip/.test(html));
    t.check('or when it has keyboard focus', /\.winners \.skip:focus-visible/.test(html));
    t.check('nothing is ever crossed out on screen', !/line-through/.test(html));
});

suite('raffle page: a link or a refresh picks the sitting back up', async (t) => {
    // The plain names a hand-made link uses still work.
    const r = openRaffle(bowl, '?month=2026-09&won=ann+zeta&out=Bo%20Yu&out=Nobody%20Here', [0]);
    await r.settle();

    t.equal('only the winner is back on screen', r.chips().map((c) => c.name).join(','), 'Ann Zeta');
    t.check('the names in the address are scrambled straight away', !/Ann|Bo|Nobody/i.test(r.location.search));
    t.equal('a name with no tickets is passed over', JSON.stringify(sittingIn(r.location.search)),
        JSON.stringify({ won: ['Ann Zeta'], out: ['Bo Yu'] }));
    t.equal('the button carries on the draw', r.byId.go.textContent, '🎲 Draw another');

    r.byId.go.click();
    r.flush();
    t.equal('and nobody out can come up again', r.chips().map((c) => c.name).join(','), 'Ann Zeta,Cy Vale');

    // Refresh: the scrambled address brings back exactly this.
    const again = openRaffle(bowl, r.location.search, []);
    await again.settle();
    t.equal('a refresh shows the same winners in the same order', again.chips().map((c) => c.name).join(','), 'Ann Zeta,Cy Vale');
    t.equal('and still keeps Bo out', again.byId.go.textContent, 'Everyone has been drawn');
});

suite('raffle page: Enter on an x is one strike-off, not a draw as well', (t) => {
    const html = page();
    t.check('keys pressed on any button are left to the button', /event\.target\.closest\('button'\)\) return;/.test(html));
});

suite('raffle page: the Contest panel draw has the same x', (t) => {
    const ui = fs.readFileSync(path.join(ROOT, 'modules/contest-ui.module.js'), 'utf8');

    t.check('there is an x next to the winner', /id="contestDrawStrike"/.test(ui));
    t.check('it only shows with the mouse on the name', /class="contest-draw-name"/.test(ui)
        && /\.contest-draw-name:hover \.contest-draw-x/.test(fs.readFileSync(path.join(ROOT, 'styles-v2.css'), 'utf8')));
    t.check('out of the raffle strikes them off and draws again', /struck\.push\(result\.associate\);\s*draw\(\);/.test(ui));
    t.check('out of this round puts them back and draws without them',
        /drawn = drawn\.filter\(\(name\) => name !== result\.associate\);\s*draw\(result\.associate\);/.test(ui));
    t.check('the draw leaves them out of that one prize', /exclude: drawn\.concat\(away \? \[away\] : \[\]\)/.test(ui));
    t.check('anybody taken out is left off the list', /earlier\.filter\(\(name\) => !struck\.includes\(name\)\)/.test(ui) && !/<s>/.test(ui));
    t.check('Start the draw over clears them too', /drawn = \[\];\s*struck = \[\];/.test(ui));
});
