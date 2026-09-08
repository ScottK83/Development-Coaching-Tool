'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * THE DEBUG PANEL
 *
 * It exists for one moment: something went wrong, a toast said to look here,
 * and somebody looks. If the pane reads "No errors captured yet" in that
 * moment it is worse than having no panel at all, because now the report and
 * the tool disagree and there is no way to tell which one is lying.
 *
 * That is exactly what happened. Two logs are kept. This module has its own,
 * and error-monitor keeps a fuller one with the stack and the context on it.
 * The panel rendered only the first while the toast telling somebody to open
 * it is raised by the second.
 */

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/debug.module.js').debug;
}

const PREFIX = 'devCoachingTool_';

suite('debug panel: it shows what the error monitor caught', (t) => {
    const debug = load(t);

    // An error the monitor logged and this module never saw. Before the merge
    // this was invisible, which is the whole complaint.
    global.localStorage.setItem(PREFIX + 'errorLog', JSON.stringify([{
        timestamp: '2026-09-08T14:00:00.000Z',
        type: 'error',
        message: 'safeEscapeHtml is not defined',
        stack: 'at showTranscriptPasteDiagnosis',
        context: { source: 'global_error_handler' }
    }]));

    const found = debug.collectAllErrors();
    t.equal('the monitor entry is rendered', found.length, 1);
    t.equal('with its message intact', found[0].message, 'safeEscapeHtml is not defined');
    t.equal('and it says where it came from', found[0].source, 'monitor');
    t.check('the stack survives, which is the point of reading that log',
        found[0].stack.indexOf('showTranscriptPasteDiagnosis') > -1);
});

suite('debug panel: one error seen by both listeners is shown once', (t) => {
    const debug = load(t);

    // A window error genuinely reaches both listeners. Showing it twice reads
    // as two faults and sends somebody looking for a second cause.
    const stamp = '2026-09-08T14:00:00.000Z';
    debug.addDebugEntry('error', 'Boom', { lineno: 12 });
    const entries = JSON.parse(global.localStorage.getItem(PREFIX + 'debugLog') || '{}').entries || [];
    const mine = entries[entries.length - 1];

    global.localStorage.setItem(PREFIX + 'errorLog', JSON.stringify([
        { timestamp: mine.timestamp, type: 'error', message: 'Boom', stack: 'somewhere' },
        { timestamp: stamp, type: 'error', message: 'A different fault', stack: 'elsewhere' }
    ]));

    const found = debug.collectAllErrors();
    t.equal('the shared error appears once', found.filter((e) => e.message === 'Boom').length, 1);
    t.equal('and the other one is still there', found.filter((e) => e.message === 'A different fault').length, 1);

    // Newest first, so the fault somebody just hit is at the top rather than
    // under ninety nine older ones.
    const stamps = found.map((e) => e.timestamp);
    t.check('newest first', stamps.slice().sort().reverse().join('|') === stamps.join('|'));
});

suite('debug panel: a broken log is reported, not fatal', (t) => {
    const debug = load(t);

    // This pane is for diagnosing faults. Throwing on one is the one thing it
    // must never do.
    global.localStorage.setItem(PREFIX + 'errorLog', '{not json');
    const found = debug.collectAllErrors();

    t.check('it still returns', Array.isArray(found));
    t.check('and says the log could not be read',
        found.some((e) => /could not be read/.test(e.message || '')));
});

suite('debug panel: clearing clears both logs', (t) => {
    const debug = load(t);

    debug.addDebugEntry('error', 'Mine', {});
    global.localStorage.setItem(PREFIX + 'errorLog', JSON.stringify([
        { timestamp: '2026-09-08T14:00:00.000Z', type: 'error', message: 'Theirs' }
    ]));
    global.localStorage.setItem(PREFIX + 'lastError', JSON.stringify({
        timestamp: '2026-09-08T14:00:00.000Z', message: 'Theirs'
    }));

    t.check('both are showing first', debug.collectAllErrors().length >= 2);

    debug.clearDebugEntries({ removeStorage: true });
    t.equal('and clearing empties the pane', debug.collectAllErrors().length, 0);

    // A day rollover is housekeeping on this module's own log and has no
    // business dropping somebody else's.
    global.localStorage.setItem(PREFIX + 'errorLog', JSON.stringify([
        { timestamp: '2026-09-08T14:00:00.000Z', type: 'error', message: 'Theirs' }
    ]));
    debug.clearDebugEntries();
    t.equal('a rollover leaves the monitor log alone', debug.collectAllErrors().length, 1);
});

suite('debug panel: script.js only calls helpers script.js has', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    // safeEscapeHtml is declared inside call-listening.module.js and nowhere
    // else. Calling it from script.js threw a ReferenceError the moment the
    // button was pressed, which is how this whole panel got looked at.
    t.check('safeEscapeHtml is not reached for from script.js',
        script.indexOf('safeEscapeHtml') === -1);
    t.check('and the escaping helper it does have is used',
        /function escapeHtml\(/.test(script));
});
