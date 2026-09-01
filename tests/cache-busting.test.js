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
