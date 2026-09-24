'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * TEAM LISTS ARE ALPHABETICAL
 *
 * The private round and the pulse grid sorted worst-first, so whoever had the
 * most Needs Focus metrics sat at the top every week. Scott asked for names in
 * alphabetical order, the same as every picker. The status badge on each card
 * still says who needs support.
 */

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

suite('team lists: the private round and the pulse grid are alphabetical', (t) => {
    const pulse = read('modules/morning-pulse.module.js');

    const cardSorts = pulse.match(/cardData\.sort\([^\n]*/g) || [];
    t.check('both team lists still sort their cards', cardSorts.length >= 2);
    t.check('and every one of them sorts by name alone',
        cardSorts.every((line) => line === 'cardData.sort((a, b) => a.emp.name.localeCompare(b.emp.name));'));

    t.check('the worst-first score is gone',
        pulse.indexOf('needsFocus * 10 + watch * 3') === -1 && pulse.indexOf('badgePriority') === -1);
    t.check('and the round no longer tells you it is sorted by priority',
        pulse.indexOf('Sorted by priority') === -1);
});
