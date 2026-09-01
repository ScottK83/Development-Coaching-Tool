'use strict';

/**
 * Nothing may write a file to this computer on its own.
 *
 * The work PC does not permit it, so a safety net that depends on a file in
 * Downloads is a safety net that cannot be used on the machine that holds the
 * data. Cloudflare is the backup, and it is the better one anyway: a downloaded
 * file is one more copy on the same disk, while the cloud copy is already off
 * the machine, versioned, and provably readable.
 *
 * Export buttons are fine. Those are the user asking. What is banned is code
 * that decides to save a file by itself, which is what the reclaim and the
 * snapshot restore both used to do before doing something destructive.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function read(rel) {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
}

// Handlers that run a destructive or automatic action. None may download.
const AUTOMATIC_FLOWS = [
    'async function reclaimLocalStorageSpaceAutomatically',
    'async function handleRestoreSnapshotClick',
    'function startCloudSyncBackground'
];

suite('no downloads: destructive flows protect data via the cloud, not a file', (t) => {
    const src = read('script.js');

    AUTOMATIC_FLOWS.forEach((signature) => {
        const start = src.indexOf(signature);
        t.check(`${signature.split(' ').pop()} exists`, start > -1);
        if (start < 0) return;

        // Bounded by the next top-level function so the slice is the handler.
        const rest = src.slice(start + signature.length);
        const end = rest.search(/\n(async )?function \w+/);
        const body = rest.slice(0, end > -1 ? end : 4000);

        t.check(`${signature.split(' ').pop()} does not trigger a download`,
            body.indexOf('exportToExcel()') === -1 && body.indexOf('.click()') === -1);
    });

    // The two that used to download must now verify the cloud instead, and must
    // stop if it cannot be confirmed. Protecting data by checking a copy exists
    // is only protection if the check can refuse.
    ['reclaimLocalStorageSpaceAutomatically', 'handleRestoreSnapshotClick'].forEach((name) => {
        const start = src.indexOf('async function ' + name);
        const body = src.slice(start, start + 2200);
        t.check(`${name} confirms the cloud copy first`,
            body.indexOf('ensureCloudCopyIsCurrent()') > -1);
        t.check(`${name} aborts when it cannot be confirmed`,
            /if \(!cloud\.ok\)[\s\S]{0,400}return;/.test(body));
    });
});

suite('no downloads: the cloud check pushes what is unsent before trusting it', (t) => {
    const src = read('script.js');
    const start = src.indexOf('async function ensureCloudCopyIsCurrent');
    const body = src.slice(start, src.indexOf('\n/**', start + 10));

    t.check('it exists', start > -1);
    t.check('it sends anything not yet pushed', body.indexOf('sync.push(') > -1);
    t.check('it fails when the push fails', /if \(!pushed\.ok\) return \{ ok: false/.test(body));
    // A 200 from a request is not the same as a copy existing.
    t.check('it checks a copy actually exists rather than trusting the response',
        body.indexOf('loadSyncState()') > -1 && /!state\.version/.test(body));
    t.check('and it writes no file', body.indexOf('.click()') === -1 && body.indexOf('download') === -1);
});

suite('no downloads: user-initiated exports still exist', (t) => {
    const src = read('script.js');
    const html = read('index.html');

    // The ban is on code deciding by itself, not on the user choosing to. These
    // stay for the home machine, where downloading is fine.
    t.check('the backup button is still there', html.indexOf('id="exportDataBtn"') > -1);
    t.check('and still wired', src.indexOf("getElementById('exportDataBtn')") > -1);
    t.check('exportToExcel still exists for it', src.indexOf('function exportToExcel') > -1);
});

suite('reclaim: runs on its own, with no button and no decision to make', (t) => {
    const src = read('script.js');
    const html = read('index.html');

    // A button here would only be asking the user to approve arithmetic: the
    // reclaim deletes a duplicate the backend verifiably holds, or it does not
    // delete it. There is nothing to weigh up.
    t.check('there is no Free up space button', html.indexOf('reclaimStorageBtn') === -1);
    t.check('and nothing wires one', src.indexOf('reclaimStorageBtn') === -1);

    const start = src.indexOf('async function reclaimLocalStorageSpaceAutomatically');
    t.check('the automatic reclaim exists', start > -1);
    const body = src.slice(start, start + 2200);

    t.check('it only runs on the IndexedDB backend', /getBackendMode\?\.\(\) !== 'idb'/.test(body));
    t.check('it confirms the cloud copy before deleting anything',
        body.indexOf('ensureCloudCopyIsCurrent()') > -1);
    t.check('and does nothing at all if that fails',
        /if \(!cloud\.ok\)[\s\S]{0,300}return;/.test(body));
    t.check('it reports what it could not verify rather than forcing it',
        body.indexOf('report.skipped') > -1);

    // Boot must not wait on it, and a failure must not break boot.
    const boot = src.slice(src.indexOf('startCloudSyncBackground();'), src.indexOf('startCloudSyncBackground();') + 500);
    t.check('boot does not await it', boot.indexOf('await reclaimLocalStorageSpaceAutomatically') === -1);
    t.check('and a failure is caught', /reclaimLocalStorageSpaceAutomatically\(\)\.catch/.test(boot));
});
