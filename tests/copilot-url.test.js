/**
 * Where Copilot lives, and why it is worth a test.
 *
 * This expression was written out twelve times across eight modules. A cleanup
 * in April replaced some of them, was recorded in audit/session-7-findings.md
 * as finished, and had missed five. Nobody noticed for four months, because a
 * stale URL in a module you do not happen to open that day looks exactly like a
 * working one.
 *
 * So the rule is pinned rather than trusted: one definition, one fallback, and
 * nothing else in the app carries the address.
 */
const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const LITERAL = 'https://copilot.microsoft.com';

suite('copilot url: one definition, one fallback', (t) => {
    const files = fs.readdirSync(path.join(ROOT, 'modules'))
        .filter((f) => f.endsWith('.js'))
        .concat(['../script.js']);

    const carriers = [];
    files.forEach((f) => {
        const rel = f.startsWith('..') ? f.replace('../', '') : 'modules/' + f;
        const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
        src.split(/\r?\n/).forEach((line, i) => {
            // A mention inside a comment is prose, not a second source of truth.
            // Stripping "//" would eat the one inside https://, so whole-line
            // comments are skipped instead.
            const trimmed = line.trim();
            if (trimmed.indexOf('//') === 0 || trimmed.indexOf('*') === 0) return;
            if (line.indexOf(LITERAL) !== -1) carriers.push(rel + ':' + (i + 1));
        });
    });

    t.equal('exactly two files carry the address',
        carriers.map((c) => c.split(':')[0]).filter((v, i, a) => a.indexOf(v) === i).sort().join(', '),
        'modules/constants.module.js, modules/shared-utils.module.js');

    t.equal('and only twice in total', carriers.length, 2);

    // The one that matters: no feature module may hold its own copy again.
    const featureCarriers = carriers.filter((c) =>
        c.indexOf('constants.module') === -1 && c.indexOf('shared-utils.module') === -1);
    t.equal('no feature module carries the address', featureCarriers.join(', ') || '(none)', '(none)');
});

suite('copilot url: the shared helper answers', (t) => {
    t.installFakeBrowser();
    const su = t.loadModule('modules/shared-utils.module.js').sharedUtils;

    t.check('shared-utils exposes copilotUrl', typeof su.copilotUrl === 'function');
    t.equal('it reads the constant', su.copilotUrl(), LITERAL);

    // Change the constant and every caller follows, which is the whole point.
    global.window.DevCoachConstants.COPILOT_URL = 'https://example.invalid/copilot';
    t.equal('changing the constant changes the answer',
        su.copilotUrl(), 'https://example.invalid/copilot');

    delete global.window.DevCoachConstants.COPILOT_URL;
    t.equal('and it still has a floor to stand on', su.copilotUrl(), LITERAL);
});
