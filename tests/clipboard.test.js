'use strict';

const { suite } = require('./harness');

// Builds a fake browser whose clipboard can be made to fail on either path.
function setup(t) {
    t.installFakeBrowser();

    const state = { toasts: [], value: null, failAsync: false, failExec: false, made: [] };
    global.window.showToast = (m) => state.toasts.push(m);
    // Node ships a read-only global `navigator`, so it has to be redefined
    // rather than assigned.
    Object.defineProperty(global, 'navigator', {
        configurable: true,
        writable: true,
        value: {
            clipboard: {
                writeText: async (v) => {
                    if (state.failAsync) throw new Error('denied');
                    state.value = v;
                }
            }
        }
    });
    global.document.createElement = () => {
        const el = { value: '', style: {}, setAttribute() {}, select() {} };
        state.made.push(el);
        return el;
    };
    global.document.execCommand = () => {
        if (state.failExec) return false;
        state.value = state.made[state.made.length - 1].value;
        return true;
    };
    global.setTimeout = () => 0;
    global.clearTimeout = () => {};

    const api = t.loadModule('modules/ui-utils.module.js').uiUtils;
    return { api, state };
}

suite('copyToClipboard — the happy path', async (t) => {
    const { api, state } = setup(t);

    const ok = await api.copyToClipboard('hello world');
    t.equal('reports success', ok, true);
    t.equal('text reaches the clipboard', state.value, 'hello world');
    t.check('a default toast is shown', state.toasts.length === 1 && /Copied to clipboard/.test(state.toasts[0]));

    state.toasts.length = 0;
    await api.copyToClipboard('x', { message: 'Custom!' });
    t.equal('a custom message is used verbatim', state.toasts[0], 'Custom!');

    state.toasts.length = 0;
    await api.copyToClipboard('x', { silent: true });
    t.equal('silent suppresses the toast', state.toasts.length, 0);
});

suite('copyToClipboard — failure is reported, never silent', async (t) => {
    const { api, state } = setup(t);

    state.toasts.length = 0;
    const empty = await api.copyToClipboard('');
    t.equal('empty text refuses', empty, false);
    t.check('  and says why', /Nothing to copy/.test(state.toasts[0]));

    // Blocked async API (non-secure context) must fall back, not fail.
    state.failAsync = true; state.failExec = false; state.value = null;
    const viaFallback = await api.copyToClipboard('fallback text');
    t.equal('falls back to execCommand when the async API is denied', viaFallback, true);
    t.equal('  and the text still lands', state.value, 'fallback text');

    // Both paths gone: the user must be told. This is the case that used to
    // look identical to success in q1-review and futures.
    state.failAsync = true; state.failExec = true; state.toasts.length = 0;
    const dead = await api.copyToClipboard('nope');
    t.equal('total failure reports false', dead, false);
    t.check('  and warns the user', /Could not reach the clipboard/.test(state.toasts[0]));

    let threw = false;
    try { await api.copyToClipboard('x'); } catch (e) { threw = true; }
    t.equal('never rejects, so callers need no guard', threw, false);
});

suite('copyToClipboard — button flash', async (t) => {
    const { api } = setup(t);

    const btn = { textContent: 'Copy Q1 Prompt', dataset: {} };
    await api.copyToClipboard('a', { button: btn });
    await api.copyToClipboard('b', { button: btn });
    t.equal('a double-click keeps the true original label', btn.dataset.flashRestore, 'Copy Q1 Prompt');
    t.equal('  and shows the copied state', btn.textContent, '✓ Copied');
});
