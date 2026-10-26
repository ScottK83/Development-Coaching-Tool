'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * A NATURAL SPEAKING TONE IN EVERY MESSAGE
 *
 * Scott, 2026-10-26: "Any time I send a message, I want to make sure it has
 * a natural speaking tone." The 10/25 audit (audit/2026-10-25-tone-findings.md)
 * found focus lines that scolded ("This one needs real attention", "We need
 * to turn this around"), corporate lines ("We identified X as the one to
 * move", "the lever to pull", "let's talk opportunity"), stitched fragments
 * ("Oh and did I mention X? Because yeah, that happened too"), report rows
 * ("Verdict: right on track") and ranges said in brackets ("(617s to 415s)").
 *
 * These read the module source, so a line that comes back in any pool fails
 * here whether or not a random draw happens to pick it.
 */

function src(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

// Only the text a person can read: template and quoted string literals, not
// comments. Good enough for a phrase scan.
function literals(code) {
    const bare = String(code)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/([;,{}()\]])\s*\/\/.*$/gm, '$1');
    const out = [];
    const re = /`(?:\\[\s\S]|\$\{[^}]*\}|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g;
    let m;
    while ((m = re.exec(bare)) !== null) out.push(m[0]);
    return out.join('\n');
}

const HARSH = [
    'needs real attention', 'turn this around', 'pattern, not a blip', 'keeps missing',
    'for real this time', 'pattern and I want us to break it', 'Not gonna sugarcoat',
    'I won\'t dress it up', 'Real talk:', 'Gonna call it', 'Want to be straight with you',
    'Let\'s tighten up', 'off the pace', 'of daylight', 'Just don\'t let it turn into a trend'
];
const CORPORATE = [
    'We identified', 'the lever to pull', 'lever worth pulling', 'new week, new opportunity',
    'let\'s talk opportunity', 'Main focus going forward', 'repeatability is the play',
    'move the needle', 'Game plan: get', 'The mission '
];
const STITCHED = ['Because yeah', 'Oh and did I mention', 'Oh and '];
const REPORT_ROWS = ['Verdict:', 'Gap: ${', 'Target: ${', '}: ${val}. We need'];

suite('natural voice: morning pulse pools never scold, sound corporate or stitch fragments', (t) => {
    const text = literals(src('modules/morning-pulse.module.js'));
    HARSH.forEach((p) => t.check('no harsh line: "' + p + '"', text.indexOf(p) === -1));
    CORPORATE.forEach((p) => t.check('no corporate line: "' + p + '"', text.indexOf(p) === -1));
    STITCHED.forEach((p) => t.check('no stitched fragment: "' + p + '"', text.indexOf(p) === -1));
    REPORT_ROWS.forEach((p) => t.check('no report row: "' + p + '"', text.indexOf(p) === -1));
    t.check('no range in brackets after a move', !/\(\$\{range\}\)/.test(text));
    t.check('no "YTD at X, target Y" stacking', !/YTD (is )?(at|sitting at) \$\{ytdVal\}[^`]*target \$\{target\}/.test(text));
    t.check('no growth bullet list', !/Growing:|Slipped a bit:|Focus area: \$\{/.test(text));
});

suite('natural voice: the Friday week progress is sentences, not a dashboard', (t) => {
    const text = literals(src('modules/daily-outreach.module.js'));
    ['Where you landed', 'Where you stand', 'Better than ${priorName}:', 'Slid a little:', 'Worth a push']
        .forEach((p) => t.check('no heading: "' + p + '"', text.indexOf(p) === -1));
});
