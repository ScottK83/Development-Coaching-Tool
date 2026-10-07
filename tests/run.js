/**
 * Test entry point.  node tests/run.js [filter]
 *
 * Exits non-zero on failure so a git hook or CI step can gate on it.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { run } = require('./harness');

const dir = __dirname;
fs.readdirSync(dir)
    .filter((f) => f.endsWith('.test.js'))
    .sort()
    .forEach((f) => require(path.join(dir, f)));

// A suite awaiting something that never settles does not fail: the event loop
// simply runs dry, node exits 0 part way through, and the pre-push hook (which
// reads the exit code and the last three lines) lets the push through with
// every later file unrun. So a run that ends without reaching its summary is a
// failure. once, because on a Windows console the log below is an async write
// and a plain listener can fire again.
let finished = false;
process.once('beforeExit', () => {
    if (finished) return;
    console.log('\n' + '-'.repeat(58));
    console.log('A suite never settled, so the run stopped part way. FAILED');
    process.exitCode = 1;
});

run(process.argv[2]).then(({ pass, fail, failures }) => {
    finished = true;
    console.log('\n' + '-'.repeat(58));
    if (fail === 0) {
        console.log(`${pass} passed`);
    } else {
        console.log(`${pass} passed, ${fail} FAILED`);
        failures.forEach((f) => console.log(`  ✗ ${f}`));
    }
    process.exit(fail === 0 ? 0 : 1);
});
