'use strict';

/**
 * Scripts are cached between deploys, and only between deploys.
 *
 * index.html used to stamp Date.now() onto all 70 script URLs, so every URL was
 * unique on every load and nothing could ever be cached: roughly 5MB was
 * re-downloaded every single time the page opened.
 *
 * Keying on the app version instead means the browser reuses what it has until
 * a deploy actually changes something. The two failure modes that creates are
 * both worse than the slowness, so both are pinned here: a version that never
 * changes serves stale code forever, and a cached index.html pins the browser
 * to an old build with no way out.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

suite('cache: script URLs are keyed to the build, not to the clock', (t) => {
    const html = read('index.html');
    const loader = html.slice(html.indexOf('function loadAllScriptsWithCacheBust'));

    t.check('there is an APP_BUILD marker for the hook to rewrite',
        /var APP_BUILD = '[\d.]+'; \/\/ APP_BUILD/.test(loader));
    t.check('the cache key comes from it', /var bust = /.test(loader) && loader.indexOf('APP_BUILD') > -1);

    // A build that shipped with the marker unreplaced would pin every browser
    // to one cache key forever, which is worse than the problem being solved.
    t.check('an unreplaced marker falls back to a per-load key',
        /test\(APP_BUILD\) \? APP_BUILD : Date\.now\(\)/.test(loader));

    // The old behaviour, which must not come back.
    t.check('the bust is not the clock', !/var bust = Date\.now\(\);/.test(loader));
});

suite('cache: the two versions cannot drift apart', (t) => {
    const html = read('index.html');
    const script = read('script.js');

    const build = (html.match(/var APP_BUILD = '([\d.]+)'/) || [])[1];
    const version = (script.match(/const APP_VERSION = '([\d.]+)'/) || [])[1];

    t.check('index.html declares a build', !!build);
    t.check('script.js declares a version', !!version);
    // Drift means the browser serves modules cached from an older deploy against
    // a newer script.js, which is the hardest class of bug to reproduce.
    t.equal('and they are the same', build, version);
});

suite('cache: the release hook rewrites both files', (t) => {
    const hook = read('.githooks/pre-push.ps1');

    t.check('it still writes APP_VERSION into script.js',
        hook.indexOf("const APP_VERSION = '$nextVersion'") > -1);
    // The loader reads the build before script.js exists, so it cannot take the
    // value at runtime. The hook has to write it in both places.
    t.check('and APP_BUILD into index.html',
        hook.indexOf("var APP_BUILD = '$nextVersion'") > -1);
    t.check('it stages index.html so the bump is committed',
        hook.indexOf('git add index.html') > -1);
    t.check('and says so when the marker is missing rather than failing silently',
        /APP_BUILD marker not found/.test(hook));
});

suite('cache: headers match how each file is actually requested', (t) => {
    const headers = read('_headers');
    const html = read('index.html');

    // index.html carries the build value that keys every other URL. Cached, it
    // would pin the browser to an old build and no deploy would ever land.
    const indexBlock = headers.slice(headers.indexOf('/index.html'), headers.indexOf('/modules/*'));
    t.check('index.html is not cached', /no-cache/.test(indexBlock));

    // Only files requested with ?v= may be cached hard.
    const modulesBlock = headers.slice(headers.indexOf('/modules/*'), headers.indexOf('/script.js'));
    t.check('modules are cached hard', /immutable/.test(modulesBlock));

    // Anything loaded from a plain tag has no version in its URL, so caching it
    // hard would mean a change never reaches the browser.
    ['styles-v2.css', 'bootstrap.js', 'lib-chart.js'].forEach((file) => {
        t.check(`${file} is loaded from a plain tag`,
            new RegExp('(src|href)="' + file.replace('.', '\\.') + '"').test(html));
        const block = headers.slice(headers.indexOf('/' + file));
        const entry = block.slice(0, block.indexOf('\n\n') > -1 ? block.indexOf('\n\n') : 200);
        t.check(`${file} revalidates rather than caching hard`,
            /no-cache/.test(entry) && !/immutable/.test(entry));
    });
});

/**
 * The release hook rewrites index.html and script.js to stamp the version in.
 * It must change the version line and nothing else.
 *
 * It did not. Set-Content picks both a line ending and an encoding by
 * heuristic, and neither is the same when git invokes a hook as it is in an
 * interactive shell:
 *
 *   line endings  every line came back CRLF, inflating index.html by 1,934
 *                 bytes past the 175 KB budget on Windows checkouts only.
 *   encoding      every emoji in the nav came back as mojibake -- a one-line
 *                 version bump produced a 252-line diff and grew the file by
 *                 1,381 bytes. "📋 Dashboard" became "ðŸ“‹ Dashboard".
 *
 * Both are invisible in a hook whose output nobody reads, and both ship.
 */
suite('cache: the release hook rewrites files without reformatting them', (t) => {
    const hook = read('.githooks/pre-push.ps1');

    // Set-Content and Get-Content are the two heuristics. Neither may touch
    // these files again.
    const versionWrites = hook.split('\n').filter((l) =>
        /Set-Content|Get-Content/.test(l) && /scriptJsPath|indexHtmlPath/.test(l));
    t.equal('neither file is read or written through an encoding heuristic',
        versionWrites.length, 0);

    t.check('an explicit UTF-8 encoder is declared',
        /\$Utf8NoBom = \[System\.Text\.UTF8Encoding\]::new\(\$false\)/.test(hook));

    // Both reads and both writes must pass it. Plain substring checks: the
    // strings being matched are full of $ and (), and a regex here is more
    // likely to be wrong than the thing it is checking.
    ['scriptJsPath', 'indexHtmlPath'].forEach((pathVar) => {
        t.check(`${pathVar} is read with the explicit encoder`,
            hook.indexOf('ReadAllLines($' + pathVar + ', $Utf8NoBom)') > -1);

        const writeAt = hook.indexOf('WriteAllText($' + pathVar);
        t.check(`${pathVar} is written at all`, writeAt > -1);
        t.check(`${pathVar} is written with the explicit encoder`,
            writeAt > -1 && hook.slice(writeAt, writeAt + 120).indexOf('$Utf8NoBom') > -1);
    });

    // LF, explicitly, not whatever the platform prefers.
    t.equal('both writes join on LF', (hook.match(/-join "`n"/g) || []).length, 2);
});

suite('cache: the files the hook rewrites are LF and UTF-8 to begin with', (t) => {
    // If these ever drift, the hook's one-line edit becomes a whole-file diff
    // again and the budget test starts failing for a reason unrelated to size.
    ['index.html', 'script.js'].forEach((file) => {
        const raw = fs.readFileSync(path.join(ROOT, file));
        t.equal(`${file} has no CR bytes`, raw.indexOf(0x0d), -1);
        // A BOM would be re-emitted as content by a non-BOM encoder.
        t.check(`${file} has no UTF-8 BOM`,
            !(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf));
    });

    // The characters that actually broke. If index.html can hold an emoji and
    // survive a round trip, the encoding is right.
    const html = read('index.html');
    t.check('the nav emoji are intact', html.indexOf('📋 Dashboard') > -1);
    t.check('and not mojibake', html.indexOf('ðŸ“‹') === -1);
});
