'use strict';

/**
 * The storage module is the one place that knows where a store actually lives.
 * That property is what makes swapping the backing store possible at all, so
 * these tests guard the chokepoint itself rather than any one store's shape.
 *
 * Prior to this, callListeningLogs read localStorage directly from script.js
 * and was absent from the module's exports, so it would have been left behind
 * by a backend swap that moved everything the module owned.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const PREFIX = 'devCoachingTool_';

function load(t, seed) {
    const browser = t.installFakeBrowser();
    Object.assign(browser.store, seed || {});
    const modules = t.loadModule('modules/storage.module.js');
    return { storage: modules.storage, store: browser.store };
}

suite('storage: every bulk store is reachable through the module', (t) => {
    const { storage } = load(t, {});

    // A store the module cannot load or save is a store a backend swap leaves
    // behind in localStorage.
    [
        'WeeklyData', 'DailyData', 'YtdData', 'CoachingHistory',
        'CallListeningLogs', 'AssociateSentimentSnapshots'
    ].forEach((name) => {
        t.check(`load${name} is exported`, typeof storage['load' + name] === 'function');
        t.check(`save${name} is exported`, typeof storage['save' + name] === 'function');
    });
});

suite('storage: call listening logs round trip through the module', (t) => {
    const seeded = { 'Alyssa Dimes': [{ id: 'a1', transcript: 'kept verbatim' }] };
    const { storage, store } = load(t, {
        [PREFIX + 'callListeningLogs']: JSON.stringify(seeded)
    });

    const loaded = storage.loadCallListeningLogs();
    t.equal('the seeded associate comes back', Object.keys(loaded).length, 1);
    t.equal('with the entry intact', loaded['Alyssa Dimes'][0].transcript, 'kept verbatim');

    const next = { 'Chris Vale': [{ id: 'b1', transcript: 'written back' }] };
    t.equal('saving reports success', storage.saveCallListeningLogs(next), true);
    t.check('and it lands under the same key it always used',
        JSON.parse(store[PREFIX + 'callListeningLogs'])['Chris Vale'][0].id === 'b1');

    t.check('a missing store reads as empty rather than throwing',
        Object.keys(load(t, {}).storage.loadCallListeningLogs()).length === 0);
});

suite('storage: script.js does not reach past the module for bulk stores', (t) => {
    const src = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8').replace(/\r\n/g, '\n');

    // The relocated store must not regrow a direct reader in script.js. This is
    // the regression that would silently strand it on the old backend.
    t.check('no CALL_LISTENING_LOGS_STORAGE_KEY constant is reintroduced',
        src.indexOf('const CALL_LISTENING_LOGS_STORAGE_KEY') === -1);
    t.check('and nothing reads that key from localStorage directly',
        src.indexOf("localStorage.getItem(CALL_LISTENING_LOGS_STORAGE_KEY)") === -1);
});
