'use strict';

/**
 * The loader must not serialize the network.
 *
 * index.html appends ~72 script tags to boot the app. It used to append them
 * one at a time, each waiting for the previous file to finish downloading and
 * executing. Nothing was ever in flight alongside anything else, so the boot
 * cost was 72 sequential round trips: a few seconds on a fast connection, and
 * minutes on a connection where a round trip is slow.
 *
 * The tags are inserted together now, and `async = false` is the only thing
 * keeping execution in manifest order. Both halves are pinned here, because
 * the parallel version is worthless if the order guarantee is dropped, and a
 * future tidy-up that reintroduces the chain would look perfectly reasonable
 * in a diff.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

// Pull the two loader functions straight out of index.html and run them, so
// this tests the shipped code rather than a copy that can drift from it.
function extractLoader() {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const start = html.indexOf('function loadRequiredScript');
    const end = html.indexOf('// script.js reads three bulk stores');
    if (start < 0 || end < 0) throw new Error('loader functions not found in index.html');
    return html.slice(start, end);
}

/**
 * A document whose scripts never load on their own. Tests decide when each
 * one resolves, which is what makes "were they all requested first?"
 * answerable at all.
 */
function fakeDocument() {
    const appended = [];
    return {
        appended,
        createElement: () => ({ src: '', async: true, onload: null, onerror: null }),
        body: { appendChild: (el) => appended.push(el) },
        // Resolves scripts in whatever order the caller asks for.
        finish: (order) => order.forEach((i) => appended[i].onload())
    };
}

function buildLoader(doc) {
    const src = extractLoader() + '; return { loadRequiredScript: loadRequiredScript, loadInOrder: loadInOrder };';
    return new Function('document', 'bust', src)(doc, 'testbuild');
}

suite('loader: every script is requested before any of them resolves', (t) => {
    const doc = fakeDocument();
    const { loadInOrder } = buildLoader(doc);
    const list = ['a.js', 'b.js', 'c.js', 'd.js'];

    loadInOrder(list);

    // The chained version appended exactly one tag here and would not request
    // the second until the first had loaded.
    t.equal('all four are in flight at once', doc.appended.length, 4);
    t.equal('and each carries the cache-busting build', doc.appended[2].src, 'c.js?v=testbuild');
});

suite('loader: execution order survives parallel fetching', (t) => {
    const doc = fakeDocument();
    const { loadInOrder } = buildLoader(doc);

    loadInOrder(['first.js', 'second.js', 'third.js']);

    // Insertion order is the manifest order, and async=false is what makes the
    // browser honour it no matter which download finishes first.
    t.equal('tags are inserted in manifest order', doc.appended[0].src, 'first.js?v=testbuild');
    t.equal('...and the last is last', doc.appended[2].src, 'third.js?v=testbuild');
    t.check('every tag opts out of force-async', doc.appended.every((el) => el.async === false));
});

suite('loader: a completed batch resolves, a failed one rejects', async (t) => {
    const doc = fakeDocument();
    const { loadInOrder } = buildLoader(doc);

    let settled = false;
    const done = loadInOrder(['a.js', 'b.js']).then(() => { settled = true; });

    // Out of order on purpose: the batch is done when every file is done, not
    // when they finish in the order they were listed.
    doc.finish([1, 0]);
    await done;
    t.check('resolves once all scripts have loaded', settled);

    const doc2 = fakeDocument();
    const loader2 = buildLoader(doc2);
    const failing = loader2.loadInOrder(['ok.js', 'broken.js']);
    doc2.appended[1].onerror();

    let message = '';
    await failing.catch((err) => { message = err.message; });
    // showLoadFailure parses this string to name the file, so the shape matters.
    t.equal('a failure names the script that failed', message, 'Failed to load broken.js');
});
