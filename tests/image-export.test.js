'use strict';

/**
 * Pictures the app exports have to survive the dark theme.
 *
 * Every export block here is styled with var(--bg-surface), var(--text-primary)
 * and var(--border). On top of that, styles-v2.css does two nuclear things in
 * dark mode, both app-wide and both with !important: it repaints every inline
 * light background to #1f2a3e, and it forces color:#e2e8f0 onto bare div, span,
 * p, li, label, small, strong, td, th, pre, code and h1 to h6, typed on the
 * element.
 *
 * html2canvas reads computed style off the LIVE DOM, so all of that lands in
 * the PNG. And the person exporting cannot see it: the card looks right on
 * screen and goes wrong only inside the picture, which is discovered after it
 * has been pasted in front of the team.
 *
 * The fix is one option, and it has to PIN the clone to light rather than just
 * strip the attribute. There are two independent dark triggers:
 *
 *     [data-theme="dark"]                        the app's own toggle
 *     @media (prefers-color-scheme: dark)        the operating system
 *         :root:not([data-theme="light"])
 *
 * Removing the attribute beats the first and leaves the second, so a supervisor
 * whose Windows is set to dark still exported dark surfaces even with the app's
 * own toggle off. Setting it to "light" beats both, because that is precisely
 * what the media query's own guard excludes. Confirmed in Chrome against the
 * real stylesheet: removeAttribute exported a navy card, setAttribute light
 * exported a white one.
 *
 * This is enforced here rather than remembered because the failure is silent,
 * and because the next export block will be written by someone who never hit it.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

// Pinned to light, not merely stripped. See the note above.
const PINS_LIGHT = /setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]light['"]\s*\)/;
const ONLY_STRIPS = /removeAttribute\(\s*['"]data-theme['"]\s*\)/;

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

function moduleSources() {
    const dir = path.join(ROOT, 'modules');
    return fs.readdirSync(dir)
        .filter((name) => name.endsWith('.js'))
        .map((name) => ({ name: 'modules/' + name, src: read('modules/' + name) }))
        .concat([{ name: 'script.js', src: read('script.js') }]);
}

/** Every `html2canvas(...)` call, with the text that follows it. */
function html2canvasCalls(src) {
    const calls = [];
    const re = /html2canvas\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
        calls.push(src.slice(m.index, m.index + 700));
    }
    return calls;
}

suite('image export: nothing rasterises the dark theme into a picture', (t) => {
    const withCalls = moduleSources().filter((f) => html2canvasCalls(f.src).length);

    // If this drops to zero the test has quietly stopped testing anything.
    t.check('there are html2canvas call sites to check', withCalls.length > 0);

    let checked = 0;
    withCalls.forEach((file) => {
        html2canvasCalls(file.src).forEach((call, index) => {
            checked += 1;
            const where = file.name + ' call ' + (index + 1);

            // The options may be written inline or come from a shared builder.
            // Either is fine, so long as the module does the pinning somewhere.
            t.check(where + ' passes an onclone', /onclone/.test(call) || /onclone/.test(file.src));
            t.check(where + ' pins the clone to the light theme', PINS_LIGHT.test(file.src));
            t.check(where + ' does not merely strip the attribute', !ONLY_STRIPS.test(file.src));
        });
    });

    t.check('every call site was actually inspected', checked >= 3);
});

suite('image export: the two snapshot exports cannot drift apart', (t) => {
    const src = read('modules/team-snapshot.module.js');

    // Downloading the picture and copying it are the same picture. They used to
    // carry two hand-written copies of the same options object, which is how one
    // of them would have kept this bug after the other was fixed.
    t.equal('both exports share one options builder',
        (src.match(/html2canvas\(el, snapshotCanvasOptions\(\)\)/g) || []).length, 2);
    t.equal('and there is exactly one place to change them',
        (src.match(/function snapshotCanvasOptions/g) || []).length, 1);
    t.check('which pins the clone to light',
        /function snapshotCanvasOptions[\s\S]{0,900}?setAttribute\(\s*['"]data-theme['"]\s*,\s*['"]light['"]\s*\)/.test(src));
});

suite('image export: hand-drawn canvases stay light on their own', (t) => {
    // center-ranking and metric-trends never call html2canvas. They draw straight
    // to a canvas with their own colours, so the stylesheet cannot reach them.
    // That holds only while their drawing code never asks what theme is on, so
    // it is worth pinning rather than assuming.
    const ranking = read('modules/center-ranking.module.js');
    const start = ranking.indexOf('function _drawYearCard');
    const end = ranking.indexOf('function _canvasBlob');
    t.check('the year card drawing code was found', start > -1 && end > start);
    t.check('the exported year card never branches on the theme',
        ranking.slice(start, end).indexOf('_isDark') === -1);

    t.check('and neither does the trend email image',
        !/isDark|data-theme/.test(read('modules/metric-trends.module.js')));
});
