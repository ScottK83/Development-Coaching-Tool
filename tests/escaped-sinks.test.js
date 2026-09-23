'use strict';

/**
 * Text people type, or that comes out of an uploaded file, is escaped before it
 * becomes page HTML. Each of these went in raw: a nickname in the coaching
 * summary heading, a Copilot prompt inside a <textarea> (a name or tip holding
 * "</textarea>" broke out of it), tip text, and custom tip category names.
 * And the escape fallback in script.js returned the text untouched, so if
 * shared-utils ever failed to load every escape in the app did nothing.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

suite('escaping: user and file text is escaped where it becomes HTML', (t) => {
    const trends = read('modules/metric-trends.module.js');
    t.check('the coaching summary heading', trends.indexOf('Coaching Summary for ${escapeHtml(displayName)}') > -1);
    t.check('the Copilot prompt box', trends.indexOf('${escapeHtml(copilotPrompt)}</textarea>') > -1);
    t.check('the team prompt box', trends.indexOf('${escapeHtml(teamPrompt)}</textarea>') > -1);
    t.check('tip text', trends.indexOf('</strong> ${escapeHtml(tip)}') > -1);

    const tips = read('modules/tips.module.js');
    t.check('category names in the picker', tips.indexOf('${escapeHtml(metricNames[metricKey])}</option>') > -1);
    t.check('and in the heading', tips.indexOf('📂 ${escapeHtml(displayMetricName)}') > -1);
});

suite('escaping: the fallback escapes too', (t) => {
    const src = read('script.js');
    const start = src.indexOf('function escapeHtml(text) {');
    const body = src.slice(start, src.indexOf('\n}\n', start) + 2);
    global.window = { DevCoachModules: {} };
    const escapeHtml = new Function(body + '\nreturn escapeHtml;')();
    t.equal('with shared-utils missing, markup is still escaped',
        escapeHtml('<img src=x onerror="a">\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&#039;');
});
