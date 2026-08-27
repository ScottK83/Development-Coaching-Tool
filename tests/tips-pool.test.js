/**
 * The tip pool lives in more than one place, and for a long time nothing read
 * the second one.
 *
 * getMetricTips looks up by metric key. Coaching passed the display label, so
 * every lookup missed, every coaching email fell through to the registry's
 * single defaultTip, and the whole pool went unused without a single error.
 * These pin the key shape and the two things that would bring it back.
 */
const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function readEmbeddedCsv() {
    const src = fs.readFileSync(path.join(ROOT, 'modules/tips.module.js'), 'utf8');
    const m = src.match(/const EMBEDDED_TIPS_CSV = `([\s\S]*?)`;/);
    return m ? m[1] : '';
}

function rows(csv) {
    return String(csv).replace(/^﻿/, '').trim().split(/\r?\n/);
}

function defaultMapKeys() {
    const src = fs.readFileSync(path.join(ROOT, 'modules/tips.module.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('const DEFAULT_METRIC_TIPS = {');
    const block = src.slice(start, src.indexOf('\n};', start));
    return (block.match(/^    ([A-Za-z"][^:]*):\s*\[/gm) || [])
        .map((line) => line.trim().replace(/:\s*\[$/, ''));
}

function registryKeys() {
    const src = fs.readFileSync(path.join(ROOT, 'modules/metrics-registry.module.js'), 'utf8');
    return (src.match(/key: '([a-zA-Z]+)',/g) || [])
        .map((l) => l.replace(/.*'([a-zA-Z]+)'.*/, '$1'));
}

suite('tips pool: one shape, two copies in step', (t) => {
    const embedded = rows(readEmbeddedCsv());
    const file = rows(fs.readFileSync(path.join(ROOT, 'tips.csv'), 'utf8'));

    // tips.csv is the editable copy and the module embeds a mirror of it. They
    // have to be edited together; this is what says so out loud.
    t.equal('both copies have the same number of rows', embedded.length, file.length);
    const inFile = new Set(file);
    const inEmbedded = new Set(embedded);
    t.equal('no row is only in the embedded copy', embedded.filter((l) => !inFile.has(l)).length, 0);
    t.equal('no row is only in tips.csv', file.filter((l) => !inEmbedded.has(l)).length, 0);

    // The lookup is by metric key. A display label here would miss silently.
    const keys = new Set(registryKeys());
    const csvKeys = Array.from(new Set(file.slice(1).map((l) => l.split(',')[0].trim())));
    const strayCsv = csvKeys.filter((k) => !keys.has(k));
    t.equal('every CSV metric is a real registry key', strayCsv.join(',') || '(none)', '(none)');

    const mapKeys = defaultMapKeys();
    const strayMap = mapKeys.filter((k) => !keys.has(k));
    t.equal('the fallback map is keyed by metric key, not display label',
        strayMap.join(',') || '(none)', '(none)');
    t.check('the fallback map is not empty', mapKeys.length > 0);

    // Every metric the fallback map covers should also exist in the CSV, or the
    // seeded path and the un-seeded path answer differently for that metric.
    const csvKeySet = new Set(csvKeys);
    const onlyInMap = mapKeys.filter((k) => !csvKeySet.has(k));
    t.equal('no metric has tips only on the fallback path', onlyInMap.join(',') || '(none)', '(none)');
});

suite('tips pool: hold time never offers a callback', (t) => {
    // A standing rule about what we ask associates to say. It matters here
    // because the fallback map was unreachable for a long time, so a tip that
    // broke the rule could sit in it unnoticed until the keying was fixed.
    const src = fs.readFileSync(path.join(ROOT, 'modules/tips.module.js'), 'utf8').replace(/\r\n/g, '\n');
    const csvFile = fs.readFileSync(path.join(ROOT, 'tips.csv'), 'utf8').replace(/\r\n/g, '\n');

    const holdBlockMatch = src.match(/\n    holdTime: \[([\s\S]*?)\n    \],/);
    const holdBlock = holdBlockMatch ? holdBlockMatch[1] : '';
    const csvHold = csvFile.split('\n').filter((l) => l.indexOf('holdTime,') === 0).join('\n');

    const offersCallback = /offer a callback|call you back|callback:/i;
    t.check('the fallback hold-time tips do not offer a callback', !offersCallback.test(holdBlock));
    t.check('the hold-time tips in tips.csv do not offer a callback', !offersCallback.test(csvHold));
});
