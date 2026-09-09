'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * No em dashes. Anywhere a person can read one.
 *
 * Scott's rule, and it is about voice rather than typography: the spaced em
 * dash is the punctuation mark that makes a sentence read as though a machine
 * wrote it, and every one of these messages goes out with a supervisor's name
 * on it. A rule enforced by remembering is a rule that lasts until the next
 * phrase pool gets a new line, so it is enforced here instead.
 *
 * Only string literals are checked. Comments are not copy and are left to read
 * however their author wanted them to read; nothing in a comment reaches a
 * screen. What is checked is everything that can: the phrase pools, the HTML,
 * the labels, the prompts, the titles, the empty states.
 *
 * The lookalikes are checked with it. An em dash written as &mdash; renders as
 * an em dash, and so does HORIZONTAL BAR, which is what a "no change" cell used
 * before this. Banning the character and leaving the entity would have moved
 * the problem rather than fixed it.
 *
 * The replacement is never another dash. A dash swapped for a hyphen is the
 * same sentence with the same tell in it, so these become commas, colons and
 * full stops, chosen per sentence. The one place a hyphen is right is a table
 * cell standing in for a value that is not there, which is not a sentence.
 */

const BANNED = [
    { name: 'em dash', find: '—' },
    { name: 'en dash', find: '–' },
    { name: 'horizontal bar', find: '―' },
    { name: '&mdash;', find: '&mdash;' },
    { name: '&ndash;', find: '&ndash;' },
    { name: 'numeric em dash entity', find: '&#8212;' },
    { name: 'numeric horizontal bar entity', find: '&#8213;' }
];

/**
 * Everything in a file that is not a comment.
 *
 * The check is "does a person read this", and the honest split is code versus
 * comment rather than string versus everything else. Em dashes do not appear
 * in JavaScript syntax, so anything left after the comments are taken out and
 * still carrying one is copy.
 *
 * This used to track quote state across the whole file, and that is the part
 * that failed. One line in almost every module ends
 * `.replace(/"/g, '&quot;').replace(/'/g, '&#39;')`, and read as ordinary code
 * those two quotes open strings nothing closes. From there the scanner was a
 * quote out of step for the rest of the file: comments read as copy, copy read
 * as comment. It had been quietly doing that in every file with an escapeHtml
 * in it, which is nearly all of them, and the rule was only ever enforced
 * above that line. Six real em dashes were sitting under it.
 *
 * Resynchronising every line is what stops that being possible. A line can
 * confuse this scanner; it cannot confuse the next one.
 */
function stringRanges(src) {
    const ranges = [];
    const lines = src.split('\n');
    let offset = 0;
    let inBlock = false;

    lines.forEach((line) => {
        let segStart = inBlock ? -1 : 0;
        let i = 0;

        const keep = (from, to) => {
            if (from < 0 || to <= from) return;
            if (line.slice(from, to).trim()) ranges.push([offset + from, offset + to]);
        };

        while (i < line.length) {
            if (inBlock) {
                if (line[i] === '*' && line[i + 1] === '/') { inBlock = false; i += 2; segStart = i; continue; }
                i++;
                continue;
            }
            if (line[i] === '/' && line[i + 1] === '*') { keep(segStart, i); inBlock = true; i += 2; continue; }
            // A line comment, but not the // inside a URL. Template literals
            // carry hrefs, and cutting one at the slashes would hide the copy
            // sitting after it.
            if (line[i] === '/' && line[i + 1] === '/' && line[i - 1] !== ':') { keep(segStart, i); segStart = -1; break; }
            i++;
        }

        if (!inBlock) keep(segStart, line.length);
        offset += line.length + 1;
    });

    return ranges;
}

function lineOf(src, index) {
    return src.slice(0, index).split('\n').length;
}

/**
 * A dash inside a regex character class is a pattern that matches the
 * character, not a character anybody reads. Two places normalise pasted dashes
 * and have to name them to do it.
 */
function isRegexCharacterClass(src, at) {
    const lineStart = src.lastIndexOf('\n', at) + 1;
    let lineEnd = src.indexOf('\n', at);
    if (lineEnd === -1) lineEnd = src.length;
    const before = src.slice(lineStart, at);
    const after = src.slice(at, lineEnd);
    const open = before.lastIndexOf('[');
    if (open === -1) return false;
    if (before.indexOf(']', open) > -1) return false;
    if (before.lastIndexOf('/', open) === -1) return false;
    const close = after.indexOf(']');
    return close > -1 && after.indexOf('/', close) > -1;
}

function offences(file) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const ranges = stringRanges(src);
    const found = [];
    ranges.forEach(([a, b]) => {
        const text = src.slice(a, b);
        BANNED.forEach(({ name, find }) => {
            let at = text.indexOf(find);
            while (at !== -1) {
                if (!isRegexCharacterClass(src, a + at)) {
                    found.push({ file, line: lineOf(src, a + at), what: name, text: text.slice(0, 90) });
                }
                at = text.indexOf(find, at + find.length);
            }
        });
    });
    return found;
}

function sourceFiles() {
    const mods = fs.readdirSync(path.join(ROOT, 'modules'))
        .filter(f => f.endsWith('.js'))
        .map(f => 'modules/' + f);
    return mods.concat(['script.js']);
}

suite('copy: no em dash reaches a screen', (t) => {
    const files = sourceFiles();
    t.check('there is something to check', files.length > 40);

    const all = files.flatMap(offences);
    if (all.length) {
        all.slice(0, 25).forEach(o => {
            console.log(`    ${o.file}:${o.line} carries an ${o.what}: ${o.text}`);
        });
        if (all.length > 25) console.log(`    ...and ${all.length - 25} more`);
    }
    t.equal('no string literal carries one', all.length, 0);
});

suite('copy: the scanner reads strings and not comments', (t) => {
    /*
     * The test above passes trivially if the scanner never finds anything, so
     * the scanner is checked against a fixture that puts the character on both
     * sides of the line: in copy, where it must be caught, and in a comment,
     * where it must not be.
     */
    const fixture = [
        '// a comment with — in it',
        '/* a block comment with — in it */',
        "const a = 'clean copy';",
        "const b = 'copy with — in it';",
        'const c = `a template with — in it`;'
    ].join('\n');

    const ranges = stringRanges(fixture);
    const hits = ranges
        .map(([a, b]) => fixture.slice(a, b))
        .filter(s => s.indexOf('—') > -1);

    t.equal('both strings are caught', hits.length, 2);
    t.check('and the comments are not', hits.every(s => s.indexOf('comment') === -1));

    // An apostrophe inside a double-quoted string used to end it early on a
    // naive scan, which silently shifted every range after it.
    const tricky = `const d = "it's fine"; const e = 'and — this is not';`;
    const trickyHits = stringRanges(tricky)
        .map(([a, b]) => tricky.slice(a, b))
        .filter(s => s.indexOf('—') > -1);
    t.equal('an apostrophe does not throw the scanner off', trickyHits.length, 1);
});

/**
 * No control characters in anything we author.
 *
 * The fold triangles on Call Listening were written as a CSS escape, the
 * escape was built by a script that read \25 as octal, and the file ended up
 * carrying a NAK byte where the arrow should have been. Every fold on the
 * screen opened with a tofu box.
 *
 * The reason it needs a test rather than care is that it is invisible. It
 * survived a diff, a review and a full green suite, because nothing about
 * `content: '<NAK>B8'` looks different from `content: '\25B8'` in a terminal
 * or a pull request. A byte nobody can see has to be caught by something that
 * is not looking with its eyes.
 *
 * Vendored libraries are skipped. lib-pdf.worker.js is minified upstream code
 * with real control bytes in its string tables, and it is not ours to clean.
 */

// Everything below 0x20 except tab, newline and carriage return, plus DEL.
const CONTROL_BYTES = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

function authoredFiles() {
    const roots = ['.', 'modules', 'tests'];
    const found = [];
    roots.forEach((dir) => {
        fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
            .filter((item) => item.isFile())
            .map((item) => item.name)
            .filter((name) => /\.(js|css|html)$/.test(name))
            // Vendored, minified, not ours.
            .filter((name) => !name.startsWith('lib-'))
            .forEach((name) => found.push(dir === '.' ? name : `${dir}/${name}`));
    });
    return found;
}

suite('copy: no invisible byte rides along in a file we wrote', (t) => {
    const files = authoredFiles();
    t.check('there is something to check', files.length > 50);

    const offences = [];
    files.forEach((file) => {
        const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
        text.split('\n').forEach((line, index) => {
            let match;
            CONTROL_BYTES.lastIndex = 0;
            while ((match = CONTROL_BYTES.exec(line))) {
                offences.push({
                    file,
                    line: index + 1,
                    code: match[0].charCodeAt(0),
                    text: line.trim().slice(0, 60)
                });
            }
        });
    });

    offences.slice(0, 20).forEach((o) => {
        console.log(`    ${o.file}:${o.line} carries U+${o.code.toString(16).padStart(4, '0').toUpperCase()}: ${o.text}`);
    });
    t.equal('nothing carries a control byte', offences.length, 0);

    // The arrow that started this. It is drawn from borders now, so no font
    // and no encoding can take it away.
    const css = fs.readFileSync(path.join(ROOT, 'styles-v2.css'), 'utf8');
    const marker = css.slice(css.indexOf('.panel-section .call-fold > summary::before'));
    t.check('the fold marker needs no glyph',
        /content: '';/.test(marker.slice(0, 400)));
    t.check('and is drawn instead',
        /border-left: \d+px solid currentColor/.test(marker.slice(0, 400)));
});
