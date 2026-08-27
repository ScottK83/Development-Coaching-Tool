/**
 * Handing a prompt to Copilot.
 *
 * Two things here are easy to get wrong and impossible to notice:
 *
 * The ordering. A popup opened after an awaited clipboard write has usually
 * lost its user activation and gets blocked. Five call sites used to do
 * copyToClipboard(...).then(ok => window.open(...)), which is exactly that
 * shape. The window has to be opened inside the click.
 *
 * The claim. Three call sites flashed "Copied" on the button before the copy
 * had run, and one discarded the copy's result entirely, so a blocked clipboard
 * looked exactly like a successful one.
 */
const { suite } = require('./harness');

function load(t, clipboardResult) {
    t.installFakeBrowser();
    const events = [];
    global.window.showToast = (m) => events.push('toast:' + m);
    global.window.copyToClipboard = function (text, opts) {
        events.push('copy-start');
        return Promise.resolve().then(() => {
            events.push('copy-end');
            if (opts && opts.button) {
                events.push('flash:' + (clipboardResult ? (opts.successLabel || '✓ Copied') : 'Copy failed'));
            }
            return clipboardResult;
        });
    };
    const su = t.loadModule('modules/shared-utils.module.js').sharedUtils;
    return { su, events };
}

suite('copilot handoff: the window opens inside the click', async (t) => {
    const { su, events } = load(t, true);
    const opened = [];

    const result = await su.copyPromptAndOpenCopilot('a prompt', {
        openWindow: (url) => { events.push('open'); opened.push(url); return { closed: false }; }
    });

    t.equal('the window opens before the copy even starts', events[0], 'open');
    t.check('and it opens exactly once', opened.length === 1);
    t.equal('at the shared Copilot address', opened[0], 'https://copilot.microsoft.com');
    t.check('the copy still happens', events.indexOf('copy-end') !== -1);
    t.equal('and the result is reported', result.ok, true);
    t.equal('no popup block reported', result.popupBlocked, false);
});

suite('copilot handoff: it reports what actually happened', async (t) => {
    const { su, events } = load(t, false);
    let recovered = false;

    const result = await su.copyPromptAndOpenCopilot('a prompt', {
        button: { textContent: 'Generate' },
        successLabel: '✅ Copied to CoPilot',
        openWindow: () => ({ closed: false }),
        onCopyFailed: () => { recovered = true; }
    });

    t.equal('a failed copy is reported as failed', result.ok, false);
    t.check('the button says so rather than claiming success',
        events.indexOf('flash:Copy failed') !== -1);
    t.check('the success label is never shown on failure',
        events.indexOf('flash:✅ Copied to CoPilot') === -1);
    t.check('the caller gets its recovery path', recovered);
});

suite('copilot handoff: a blocked popup is not silent', async (t) => {
    const { su, events } = load(t, true);

    const result = await su.copyPromptAndOpenCopilot('a prompt', {
        openWindow: () => null
    });

    t.equal('the copy still succeeded', result.ok, true);
    t.equal('and the block is reported', result.popupBlocked, true);
    t.check('the user is told rather than left with a clipboard and no tab',
        events.some((e) => e.indexOf('Copilot tab was blocked') !== -1));
});

suite('copilot handoff: refusals and safety', async (t) => {
    const { su, events } = load(t, true);

    const empty = await su.copyPromptAndOpenCopilot('   ', { openWindow: () => ({}) });
    t.equal('an empty prompt copies nothing', empty.ok, false);
    t.check('and does not open a tab for it', events.indexOf('open') === -1);
    t.check('but does say why', events.some((e) => e.indexOf('Nothing to copy') !== -1));

    // A recovery path that throws must not take the handoff down with it.
    const { su: su2 } = load(t, false);
    const survived = await su2.copyPromptAndOpenCopilot('x', {
        openWindow: () => ({}),
        onCopyFailed: () => { throw new Error('recovery blew up'); }
    });
    t.equal('a throwing recovery path is contained', survived.ok, false);

    // An opener that throws (some blockers do) must not reject either.
    const { su: su3 } = load(t, true);
    const blocked = await su3.copyPromptAndOpenCopilot('x', {
        openWindow: () => { throw new Error('blocked'); }
    });
    t.equal('a throwing opener is treated as a block', blocked.popupBlocked, true);
    t.equal('and the copy still runs', blocked.ok, true);
});
