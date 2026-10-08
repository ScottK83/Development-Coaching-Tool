'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * Pictures go on the clipboard one way, and never land in Downloads on their own.
 *
 * Five copies of the copy-a-picture code had grown up (overlap audit,
 * 2026-10-07). Two of them waited for the picture before building the
 * clipboard item, which loses the click, so Snapshot and Contest copies failed
 * more often than the rest. Two others, the Rankings year card and the trend
 * email picture, downloaded a file whenever the clipboard refused, which the
 * work PC does not allow (feedback-never-download-to-pc).
 *
 * All five now go through uiUtils.copyImage. Download buttons the user clicks
 * (Save image, Download, Download it instead) are allowed and stay.
 */
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
function body(src, signature) {
    const start = src.indexOf(signature);
    if (start === -1) return '';
    return src.slice(start, src.indexOf('\n    }\n', start) > -1 ? src.indexOf('\n    }\n', start) : start + 3000);
}

suite('image copy: one shared way, started inside the click', (t) => {
    const ui = read('modules/ui-utils.module.js');
    t.check('ui-utils has the shared copy', /function copyImage\(source, options\)/.test(ui));
    t.check('and exports it', /copyImage,/.test(ui));

    t.check('Snapshot hands over while html2canvas is still drawing',
        /copyImage\(window\.html2canvas\(el, snapshotCanvasOptions\(\)\)\)/.test(read('modules/team-snapshot.module.js')));
    t.check('Contest hands over while its graphic is still drawing',
        /copyImage\(renderGraphicToCanvas\(\)\)/.test(read('modules/contest-ui.module.js')));
    t.check('the quarterly recap uses it', /ui\.copyImage\(canvas/.test(read('modules/quarter-recap.module.js')));

    const ranking = read('modules/center-ranking.module.js');
    const yearCopy = body(ranking, 'function _copyYearImage(');
    t.check('the year card uses it', /ui\.copyImage\(canvas\)/.test(yearCopy));
    t.check('and no longer downloads when the clipboard refuses', yearCopy.indexOf('_downloadCanvas') === -1);
});

suite('image copy: the trend email picture never downloads on its own', (t) => {
    const trends = read('modules/metric-trends.module.js');
    t.check('the download fallback is gone', trends.indexOf('downloadImageFallback') === -1);
    const copy = trends.slice(trends.indexOf('function copyTrendImageToClipboard('), trends.indexOf('function copyTrendImageToClipboard(') + 2500);
    t.check('the copy function was found', copy.length > 100);
    t.check('it saves nothing to the computer', !/\.download\s*=/.test(copy) && !/createObjectURL/.test(copy));
});
