'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * Reliability never goes in the areas to work on, and since 2026-10-13 it is
 * not in the Mid-Year context at all.
 *
 * Scott, 2026-10-05: "I also do not want areas of focus to reference
 * reliability." The Mid-Year prompt and Score Card's Goal-Pace prompt share
 * one builder, _buildOnOffMetricContext. That was fixed to keep hours out of
 * focusAreas, but they still counted toward the met tally that sets the
 * Mid-Year tone, so 25 hours turned two misses into three and handed a solid
 * associate the disciplinary paragraph. Scott, 2026-10-13: hours stay out of
 * Mid-Year and Year-End tone and focus.
 *
 * The builder reads its inputs off the page, so this pins the shape.
 */
suite('goal pace and mid-year: reliability is never an area of focus', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'modules', 'on-off-tracker.module.js'), 'utf8');
    const start = src.indexOf('function _buildOnOffMetricContext(');
    t.check('the shared builder is still there', start > -1);
    const body = src.slice(start, src.indexOf('\n    function ', start + 10));

    const mapStart = body.indexOf('var metricMap = {');
    const mapBody = body.slice(mapStart, body.indexOf('};', mapStart));
    t.check('the metric map has no reliability entry', mapStart > -1 && !/reliability\s*:/.test(mapBody));
    t.check('the progression block is built without hours',
        /buildProgressionBlock\?\.\(employeeName, reviewYear, \{ reliability: false \}\)/.test(body));
    t.check('and the prompt tells Copilot to leave hours out',
        /Keep reliability, attendance and hours missed out of the review entirely/.test(src));

    t.check('the old "hours over target" focus wording is gone',
        src.indexOf('over target. This is about Verint coding') === -1);
});

suite('goal pace and mid-year: a metric at goal is a strength', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'modules', 'on-off-tracker.module.js'), 'utf8');
    const start = src.indexOf('function _buildOnOffMetricContext(');
    const body = src.slice(start, src.indexOf('\n    function ', start + 10));
    const metAt = body.indexOf('if (isMet) {');
    const firstFocus = body.indexOf('focusAreas.push(');
    t.check('met goes to strengths before any focus is built', metAt > -1 && firstFocus > -1 && metAt < firstFocus);
    t.check('and returns there', /if \(isMet\) \{\s*strengths\.push\([^;]*;\s*return;/.test(body));
    t.check('no rating-band cutoff is offered as a first milestone', body.indexOf('band.score2') === -1);
    t.check('nobody is "meeting only 0"', src.indexOf('is not yet meeting any of the') > -1);
});
