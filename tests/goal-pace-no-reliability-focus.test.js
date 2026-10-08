'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * Reliability never goes in the areas to work on.
 *
 * Scott, 2026-10-05: "I also do not want areas of focus to reference
 * reliability." The quarterly surfaces were fixed then. The Mid-Year prompt
 * and Score Card's Goal-Pace prompt share one builder,
 * _buildOnOffMetricContext, which still pushed hours over the allowance into
 * focusAreas ("currently 6.0 hours over target..."), and both prompts printed
 * that list. Found in the 2026-10-07 overlap audit.
 *
 * The builder reads its inputs off the page, so this pins the shape: within
 * it, reliability is handled, and returns, before anything is added to
 * focusAreas. Hours inside the allowance can still be a strength.
 */
suite('goal pace and mid-year: reliability is never an area of focus', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'modules', 'on-off-tracker.module.js'), 'utf8');
    const start = src.indexOf('function _buildOnOffMetricContext(');
    t.check('the shared builder is still there', start > -1);
    const body = src.slice(start, src.indexOf('\n    function ', start + 10));

    const guard = body.indexOf("if (k === 'reliability')");
    const firstPush = body.indexOf('focusAreas.push(');
    t.check('reliability is handled before any focus area is added', guard > -1 && firstPush > -1 && guard < firstPush);

    const guardBlock = body.slice(guard, body.indexOf('}', body.indexOf('return;', guard)) + 1);
    t.check('and it leaves the loop there', /return;/.test(guardBlock));
    t.check('reaching the strengths only when inside the allowance', /if \(isMet\) strengths\.push/.test(guardBlock));
    t.check('and never focusAreas', guardBlock.indexOf('focusAreas') === -1);

    t.check('the old "hours over target" focus wording is gone',
        src.indexOf('over target. This is about Verint coding') === -1);
});
