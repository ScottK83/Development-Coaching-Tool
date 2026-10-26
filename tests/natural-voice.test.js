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

// The source with its comments taken out, so a phrase quoted in a comment
// explaining why it went is not mistaken for one still in a pool. (Pulling
// out the string literals alone lost its place at nested template literals
// and could pass without having read the pools at all.)
function literals(code) {
    return String(code)
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/([;,{}()\]])\s*\/\/.*$/gm, '$1');
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
    t.check('no "(target X)" or "X vs Y" stacked in a pool line',
        !/=> `[^`]*(\(target \$\{|\$\{val\} vs \$\{target\}|\$\{cur\} vs \$\{tgt\})/.test(text));
});

suite('natural voice: the Copilot email prompts ask for numbers said out loud', (t) => {
    // The weekly coaching prompt asked for "clean bullets" and "each number
    // the way it is given", and Copilot sent back "Hold Time: 25s, goal 30s
    // or lower" (tone audit, 2026-10-25).
    ['modules/coaching-email.module.js', 'modules/trend-coaching-email.module.js', 'modules/metric-trends.module.js'].forEach((rel) => {
        const text = literals(src(rel));
        t.check(rel + ': no "clean bullets"', !/clean bullets|clean, simple bullet/.test(text));
        t.check(rel + ': no "numbers exactly as given"', !/exactly as given|the way it is given/.test(text));
        t.check(rel + ': asks for numbers out loud', /says (it|them) out loud/.test(text));
        t.check(rel + ': no AI persona', !/AI Intelligence Layer/.test(text));
    });
});

suite('natural voice: a default tip never repeats its metric as a label', (t) => {
    // Under "Tip:" the registry's fallback read "Tip: Average Handle Time:
    // Focus on efficiency..." (tone audit, 2026-10-25).
    const text = src('modules/metrics-registry.module.js');
    const doubled = (text.match(/defaultTip: "[A-Z][A-Za-z ]+: /g) || []);
    t.equal('no default tip opens "Label: "', doubled.join(' | '), '');
});

suite('natural voice: the year-end prompt and speech carry no dash or form label', (t) => {
    const text = literals(src('modules/year-end.module.js'));
    t.check('no "human - not robotic"', !/human - not/.test(text));
    t.check('no form label read aloud', !/details are: |amount is: |rating is: /.test(text));
});

suite('natural voice: the Friday week progress is sentences, not a dashboard', (t) => {
    const text = literals(src('modules/daily-outreach.module.js'));
    ['Where you landed', 'Where you stand', 'Better than ${priorName}:', 'Slid a little:', 'Worth a push']
        .forEach((p) => t.check('no heading: "' + p + '"', text.indexOf(p) === -1));
});
