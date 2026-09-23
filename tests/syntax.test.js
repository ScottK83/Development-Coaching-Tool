'use strict';

/**
 * Every script the page loads parses.
 *
 * Most suites slice a function out of script.js or load one module, so a
 * syntax error elsewhere in a file (a stray line break inside a string, say)
 * passes the whole suite and blanks the app in the browser. This parses every
 * file the loader serves, whole.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { suite, ROOT } = require('./harness');

suite('syntax: every script the page loads parses', (t) => {
    const files = ['script.js', 'bootstrap.js'].concat(
        fs.readdirSync(path.join(ROOT, 'modules')).filter((f) => f.endsWith('.js')).map((f) => 'modules/' + f)
    ).filter((f) => fs.existsSync(path.join(ROOT, f)));
    t.check('there is something to check', files.length > 40);

    const broken = [];
    files.forEach((file) => {
        try {
            new vm.Script(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
        } catch (error) {
            broken.push(file + ': ' + error.message);
        }
    });
    broken.forEach((b) => console.log('    ' + b));
    t.equal('none has a syntax error', broken.length, 0);

    // The worker is an ES module, so it is checked with its export unwrapped.
    const worker = fs.readFileSync(path.join(ROOT, 'cloudflare-sync-worker/index.js'), 'utf8')
        .replace('export default', 'const __worker =');
    let workerError = '';
    try { new vm.Script(worker, { filename: 'cloudflare-sync-worker/index.js' }); } catch (error) { workerError = error.message; }
    t.equal('and neither has the sync worker', workerError, '');
});
