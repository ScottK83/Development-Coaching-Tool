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

run(process.argv[2]).then(({ pass, fail, failures }) => {
    console.log('\n' + '-'.repeat(58));
    if (fail === 0) {
        console.log(`${pass} passed`);
    } else {
        console.log(`${pass} passed, ${fail} FAILED`);
        failures.forEach((f) => console.log(`  ✗ ${f}`));
    }
    process.exit(fail === 0 ? 0 : 1);
});
