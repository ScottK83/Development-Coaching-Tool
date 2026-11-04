'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * Many hats review, Phase 1 (audit/2026-11-03-many-hats.md).
 *
 * The small wording slips and one-line bugs found on the real data. Most are
 * pinned where they are built; these are the ones easiest to read straight
 * from the source.
 */

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

function between(source, start, end) {
    const from = source.indexOf(start);
    if (from === -1) return '';
    const to = source.indexOf(end, from + start.length);
    return source.slice(from, to === -1 ? undefined : to);
}

suite('many hats A5: praise lines that misfired are gone', (t) => {
    const pulse = read('modules/morning-pulse.module.js');
    // "Okay, Avoid Negative Words!" read like an order.
    t.check('no "Okay, label!" opener', pulse.indexOf('`Okay, ${label}!') === -1);
    // "Seriously though" opened with nothing before it.
    t.check('no "Seriously though"', pulse.indexOf('Seriously though') === -1);
    // "Can't forget about X, and 1 more goal on target either."
    t.check('no "either" after a counted list', pulse.indexOf("Can't forget about ${extras} either") === -1);
    t.check('the extra goals are counted in words', /COUNT\[rest\] \|\| rest\} more/.test(pulse));
});

suite('many hats S4: the trend email follows the associate on People', (t) => {
    const trends = read('modules/metric-trends.module.js');
    const init = between(trends, 'populateUploadedDataDropdown();', 'metricTrendsListenersBound = true');
    const blank = init.indexOf('initializeEmployeeDropdown();');
    const fill = init.indexOf('populateTrendPeriodDropdown();');
    t.check('both calls were found', blank > -1 && fill > -1);
    // The other way round wiped the list the period dropdown had just built.
    t.check('the list is blanked before it is filled, never after', blank < fill);

    const coaching = read('modules/coaching-email.module.js');
    const status = between(coaching, 'function setCoachingLatestPeriodStatus', '\n    }\n');
    t.check('the status no longer calls the end date "Week of"', status.indexOf('Week of ${endDate}') === -1);
    t.check('it gives the start and the end', /\$\{start\} to \$\{end\}/.test(status));
});

suite('many hats X2: restoring a saved day survives the reload', (t) => {
    const script = read('script.js');
    const body = between(script, 'async function handleRestoreSnapshotClick', '\n}\n');
    t.check('the handler was found', body.length > 500);
    const skip = body.indexOf('window.__skipBeforeunloadSave = true');
    const apply = body.indexOf('applyRepoBackupPayload');
    const push = body.indexOf("sync.push(names, 'restored a saved day')");
    const reload = body.lastIndexOf('location.reload()');
    t.check('the leave-page save is off before the restore is written', skip > -1 && skip < apply);
    t.check('the restored copy is sent to the cloud', push > apply);
    t.check('before the page reloads', push > -1 && push < reload);
    t.check('and nothing tells Scott to keep a downloaded file', body.indexOf('backup that just downloaded') === -1);
});

suite('many hats: Copilot is spelled one way', (t) => {
    // 31 "CoPilot" against 293 "Copilot". Function names keep theirs.
    const word = /(^|[^A-Za-z])CoPilot([^A-Za-z]|$)/;
    const files = ['index.html', 'script.js'].concat(
        fs.readdirSync(path.join(ROOT, 'modules')).filter(f => f.endsWith('.js')).map(f => 'modules/' + f));
    const offenders = files.filter(f => word.test(read(f)));
    t.equal(`no file spells it CoPilot (${offenders.join(', ') || 'clean'})`, offenders.length, 0);
});

suite('many hats: a missed FCR is not shown with a check mark', (t) => {
    const registry = read('modules/metrics-registry.module.js');
    const fcr = between(registry, "key: 'fcr'", '},');
    t.check('the FCR entry was found', fcr.indexOf('First Call Resolution') > -1);
    t.check('its icon is not a tick', fcr.indexOf('✅') === -1);
});
