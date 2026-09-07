'use strict';

const { suite } = require('./harness');

/**
 * The diagnostics summary is what gets pasted into a bug report, so a line that
 * cannot ever be true is worse than no line at all: it reads as a fault in the
 * app and sends whoever is reading it after the wrong thing.
 *
 * Two ways that happened. APP_VERSION is a top-level const and const is not a
 * window property, so every reader of window.APP_VERSION recorded 'unknown',
 * the diagnostics line included. And two lines reported globals that had been
 * removed, so they printed 'unknown' and 'none' in every report ever pasted.
 */

function load(t, extra) {
    t.installFakeBrowser(Object.assign({
        APP_VERSION: '2026.09.07.3',
        getLatestWeeklyKey: () => '2026-08-31|2026-09-03',
        getTeamSelectionContext: () => ({
            weekKey: '2026-08-31|2026-09-03',
            isFiltering: true,
            selectedMembers: ['Someone']
        })
    }, extra || {}));

    global.window.DevCoachModules.storage = Object.assign({
        getBackendMode: () => 'idb',
        loadWeeklyData: () => ({ a: {}, b: {} }),
        loadYtdData: () => ({ y: {} }),
        readStore: () => ({})
    }, (extra || {}).storage || {});

    return t.loadModule('modules/repo-sync.module.js').repoSync;
}

suite('diagnostics: the version is reported, not swallowed', (t) => {
    const out = load(t).buildDiagnosticsSummary();

    // The bug in one line. script.js has to hand the const to window or every
    // reader of it, this one and the crash reports, records 'unknown'.
    t.check('the real version shows', out.includes('Version: 2026.09.07.3'));
    t.check('and not the placeholder', !out.includes('Version: unknown'));
});

suite('diagnostics: a missing version still says so rather than lying', (t) => {
    // Nothing is asserted about how it degrades except that it degrades
    // honestly. A blank line here would be read as "no version problem".
    t.installFakeBrowser({ getTeamSelectionContext: () => ({}) });
    global.window.DevCoachModules.storage = { loadWeeklyData: () => ({}), loadYtdData: () => ({}) };
    const out = t.loadModule('modules/repo-sync.module.js').repoSync.buildDiagnosticsSummary();

    t.check('an absent version is named as absent', out.includes('Version: unknown'));
});

suite('diagnostics: every line reports something that exists', (t) => {
    const out = load(t);
    const summary = out.buildDiagnosticsSummary();

    // The two dead lines are gone. They named globals that no longer exist, so
    // they could only ever print their fallback.
    t.check('the removed period type line is gone', !summary.includes('Current Period Type'));
    t.check('the removed period line is gone', !summary.includes('Current Period:'));

    // What replaced them has to be real, or this is the same bug renamed.
    t.check('the storage backend is reported', summary.includes('Storage Backend: idb'));
    t.check('the latest weekly is reported', summary.includes('Latest Weekly: 2026-08-31|2026-09-03'));

    t.check('the counts still come through',
        summary.includes('Weekly Periods Loaded: 2') && summary.includes('YTD Periods Loaded: 1'));
    t.check('the team filter still comes through',
        summary.includes('Team Filter Mode: 1 selected'));
});

suite('diagnostics: Deploy is the deployed build, not a sync artefact', (t) => {
    // Deploy meant the deployed commit in the version label and a sync commit
    // here, and the sync one came from GitHub-era response fields the R2 worker
    // stopped returning. One name, one meaning, and it has to be the live one.
    const repoSync = load(t, { APP_DEPLOY_COMMIT: '115a6a2' });
    const summary = repoSync.buildDiagnosticsSummary();

    t.check('the deployed commit shows', summary.includes('Deploy: 115a6a2'));
    t.check('and not the placeholder', !summary.includes('Deploy: n/a'));
});

suite('diagnostics: an unresolved deploy commit says n/a rather than guessing', (t) => {
    const summary = load(t).buildDiagnosticsSummary();

    // The commit is fetched asynchronously and the fetch can fail. Saying so is
    // right; borrowing the version number to fill the gap is not.
    t.check('it degrades honestly', summary.includes('Deploy: n/a'));
    t.check('and does not substitute the version', !summary.includes('Deploy: 2026.09.07.4'));
});

suite('diagnostics: what sync last wrote gets its own line', (t) => {
    const repoSync = load(t);

    repoSync.saveRepoSyncLastSuccess({
        syncedAt: '2026-09-07T21:15:16.000Z',
        reason: 'upload',
        direction: 'upload',
        snapshot: 'state/snapshots/2026-09-07.json'
    });
    const summary = repoSync.buildDiagnosticsSummary();

    t.check('the snapshot is reported', summary.includes('Last Snapshot: state/snapshots/2026-09-07.json'));
    t.check('it is not conflated with Deploy', !summary.includes('Deploy: state/snapshots'));
});

suite('diagnostics: a sync that recorded no snapshot says none', (t) => {
    const repoSync = load(t);
    repoSync.saveRepoSyncLastSuccess({ syncedAt: '2026-09-07T21:15:16.000Z', reason: 'upload', direction: 'upload' });

    t.check('it reads none', repoSync.buildDiagnosticsSummary().includes('Last Snapshot: none'));
});

suite('diagnostics: no weekly upload is a fact, not a crash', (t) => {
    const summary = load(t, { getLatestWeeklyKey: () => null }).buildDiagnosticsSummary();

    t.check('it degrades to none', summary.includes('Latest Weekly: none'));
    t.check('and the rest of the summary survives', summary.includes('Version: 2026.09.07.3'));
});

suite('diagnostics: a missing helper does not take the summary down', (t) => {
    // Diagnostics get pasted when something is already broken, so the one thing
    // this must never do is throw on the way to describing the breakage.
    t.installFakeBrowser({ getTeamSelectionContext: () => ({}) });
    global.window.DevCoachModules.storage = {};

    const repoSync = t.loadModule('modules/repo-sync.module.js').repoSync;
    let summary = null;
    try { summary = repoSync.buildDiagnosticsSummary(); } catch (_e) { summary = null; }

    t.check('it still returns a summary', typeof summary === 'string' && summary.length > 0);
    t.check('with the backend named as unknown', summary.includes('Storage Backend: unknown'));
    t.check('and the counts at zero', summary.includes('Weekly Periods Loaded: 0'));
});
