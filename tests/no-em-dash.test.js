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
 * Every offset inside a string literal, so a comment can say what it likes.
 *
 * A hand-rolled scanner rather than a parser, because the alternative is a
 * dependency and this file has one job. It tracks the four states that matter:
 * outside, in a line comment, in a block comment, and in a string of any of the
 * three quote flavours. Escapes are skipped as pairs so a quote inside a string
 * cannot end it early.
 */
function stringRanges(src) {
    const ranges = [];
    let i = 0;
    let state = null;
    let quote = null;
    let start = 0;
    while (i < src.length) {
        const c = src[i];
        if (state === null) {
            if (c === '/' && src[i + 1] === '/') { state = 'line'; i += 2; continue; }
            if (c === '/' && src[i + 1] === '*') { state = 'block'; i += 2; continue; }
            if (c === '"' || c === "'" || c === '`') { state = 'str'; quote = c; start = i; i++; continue; }
            i++;
            continue;
        }
        if (state === 'line') {
            if (c === '\n') state = null;
            i++;
            continue;
        }
        if (state === 'block') {
            if (c === '*' && src[i + 1] === '/') { state = null; i += 2; continue; }
            i++;
            continue;
        }
        if (c === '\\') { i += 2; continue; }
        if (c === quote) { ranges.push([start, i]); state = null; quote = null; i++; continue; }
        i++;
    }
    // An unterminated string means the scanner lost its place, which would make
    // every result after it a guess. Report the whole tail so a real problem
    // shows up as a failure rather than as silence.
    if (state === 'str') ranges.push([start, src.length]);
    return ranges;
}

function lineOf(src, index) {
    return src.slice(0, index).split('\n').length;
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
                found.push({ file, line: lineOf(src, a + at), what: name, text: text.slice(0, 90) });
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
