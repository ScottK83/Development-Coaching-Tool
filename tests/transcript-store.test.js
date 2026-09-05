'use strict';

/**
 * A transcript travels with the entry that references it.
 *
 * They were split into their own store to save sync bandwidth: a shard is a
 * whole store, so with transcripts inline a one-word edit to a note
 * re-uploaded every transcript in the log.
 *
 * That was the wrong trade, and it showed up the first time Scott used two
 * machines. He saved a call at work and opened it at home to find the notes
 * there and the transcript gone. The entry crossed; the transcript store did
 * not; the reference dangled. Two stores are two independent shards, and the
 * write ordering I had put in guarded the wrong failure. Both writes had
 * succeeded. Only one of them travelled.
 *
 * Bandwidth on a note edit is worth nothing next to a transcript. A note can
 * be retyped. A call from three weeks ago cannot be re-listened to.
 *
 * `callTranscripts` stays registered and still syncs, so anything already
 * stranded in it is pulled back onto its entry and written inline from then
 * on. These tests pin the repair as much as the round trip.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/constants.module.js');
    t.loadModule('modules/store-registry.module.js');
    return t.loadModule('modules/storage.module.js').storage;
}

const TRANSCRIPT = [
    '00:03',
    'thank you for calling, my name is esther, how may i help you tonight',
    '00:10',
    'i got an apartment and i need to set up service before i grab the keys'
].join('\n');

function logsWith(entries) {
    return { 'Esther Ramos': entries };
}

suite('transcript storage: what goes in comes back out', (t) => {
    const storage = load(t);

    const original = logsWith([{
        id: 'call-1',
        listenedOn: '2026-09-03',
        callTime: '6:35 PM',
        employeeName: 'Esther Ramos',
        transcript: TRANSCRIPT,
        whatWentWell: 'Clean open',
        improvementAreas: 'Long hold'
    }]);

    t.check('the save reports success', storage.saveCallListeningLogs(original) !== false);

    const loaded = storage.loadCallListeningLogs();
    t.equal('the round trip is identical',
        JSON.stringify(loaded['Esther Ramos'][0].transcript), JSON.stringify(TRANSCRIPT));
    t.equal('and so is everything else', loaded['Esther Ramos'][0].whatWentWell, 'Clean open');
    t.equal('the entry keeps its id', loaded['Esther Ramos'][0].id, 'call-1');
});

suite('transcript storage: the transcript is in the entry, not beside it', (t) => {
    const storage = load(t);

    storage.saveCallListeningLogs(logsWith([{
        id: 'call-1', listenedOn: '2026-09-03', employeeName: 'Esther Ramos',
        transcript: TRANSCRIPT
    }]));

    // The whole point of the revert: one store, so there is nothing that can
    // arrive out of step with the entry pointing at it.
    const rawLogs = storage.readStore('callListeningLogs');
    t.check('the log store holds the transcript text',
        JSON.stringify(rawLogs).includes('grab the keys'));
    t.check('and no pointer to a second copy', !('transcriptId' in rawLogs['Esther Ramos'][0]));
    t.check('nothing is written to the transcript store',
        Object.keys(storage.readStore('callTranscripts') || {}).length === 0);
    t.check('so a note edit cannot separate them', storage.isStoreDirty('callTranscripts') === false);
});

suite('transcript storage: a stranded transcript is repaired', (t) => {
    const storage = load(t);

    // Exactly the state Scott's home PC was in: the entry arrived, the
    // transcript store did not, and the reference dangled. Except here the
    // store has since caught up, which is what the rejoin is for.
    storage.saveWithSizeCheck('callListeningLogs', logsWith([{
        id: 'call-1', listenedOn: '2026-09-03', employeeName: 'Esther Ramos',
        transcriptId: 'call-1'
    }]));
    storage.saveWithSizeCheck('callTranscripts', { 'call-1': TRANSCRIPT });

    const loaded = storage.loadCallListeningLogs();
    t.equal('the stranded transcript is pulled back onto its entry',
        loaded['Esther Ramos'][0].transcript, TRANSCRIPT);

    // And the next save puts it where it cannot be separated again.
    storage.saveCallListeningLogs(loaded);
    const rawLogs = storage.readStore('callListeningLogs');
    t.check('it is written inline', JSON.stringify(rawLogs).includes('grab the keys'));
    t.check('and the pointer is dropped', !('transcriptId' in rawLogs['Esther Ramos'][0]));
});

suite('transcript storage: a pointer with nothing behind it is kept', (t) => {
    const storage = load(t);

    // The transcript store has not arrived yet. Dropping the pointer here
    // would make the transcript unrecoverable even once it does.
    storage.saveWithSizeCheck('callListeningLogs', logsWith([{
        id: 'call-9', listenedOn: '2026-09-03', employeeName: 'Esther Ramos',
        transcriptId: 'call-9'
    }]));

    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    const loaded = storage.loadCallListeningLogs();
    console.warn = realWarn;

    t.check('the entry still comes back', Boolean(loaded['Esther Ramos'][0]));
    t.check('with no invented transcript', !loaded['Esther Ramos'][0].transcript);
    t.check('and the gap is reported rather than hidden',
        warnings.some(line => /transcript call-9, which is not in the store/.test(line)));

    storage.saveCallListeningLogs(loaded);
    t.check('the pointer survives so it can still be recovered',
        'transcriptId' in storage.readStore('callListeningLogs')['Esther Ramos'][0]);
});

suite('transcript storage: an entry with no transcript is left alone', (t) => {
    const storage = load(t);

    // Logs typed by hand before transcripts existed at all.
    storage.saveCallListeningLogs(logsWith([{
        id: 'notes-only', listenedOn: '2026-07-01', employeeName: 'Esther Ramos',
        whatWentWell: 'typed by hand'
    }]));

    const loaded = storage.loadCallListeningLogs();
    t.equal('the notes survive', loaded['Esther Ramos'][0].whatWentWell, 'typed by hand');
    t.check('no pointer is invented', !loaded['Esther Ramos'][0].transcriptId);
});

suite('transcript storage: wiring', (t) => {
    const registry = fs.readFileSync(path.join(ROOT, 'modules/store-registry.module.js'), 'utf8');
    const sync = fs.readFileSync(path.join(ROOT, 'modules/repo-sync.module.js'), 'utf8');
    const storage = fs.readFileSync(path.join(ROOT, 'modules/storage.module.js'), 'utf8');

    // Nothing writes to it any more.
    t.check('the save path does not split transcripts out',
        !/saveWithSizeCheck\('callTranscripts'/.test(storage));
    t.check('but the load path still repairs from it',
        /function readTranscriptStore[\s\S]{0,400}readStore\('callTranscripts'\)/.test(storage));

    // It has to keep syncing, or a transcript stranded on the other machine
    // never arrives to be repaired.
    t.check('the store is still registered', /name: 'callTranscripts', tier: 'data'/.test(registry));
    t.check('it merges by union, never last writer wins',
        /name: 'callTranscripts'[^}]*merge: 'unionByEntryHash'/.test(registry));
    t.check('the backup still carries it', sync.includes("callTranscripts: safeLoadJson('callTranscripts')"));
    t.check('and restoring treats absent as leave alone',
        sync.includes('callTranscripts: coerceNullableObject(payload?.callTranscripts)'));
});

suite('transcript storage: it repairs itself', (t) => {
    const storage = load(t);

    // Exactly the state Scott's home PC was in once the transcript store had
    // caught up: the entry references a transcript, the text is there, and
    // nothing had ever persisted the join.
    storage.saveWithSizeCheck('callListeningLogs', logsWith([{
        id: 'call-1', listenedOn: '2026-09-03', employeeName: 'Esther Ramos',
        transcriptId: 'call-1'
    }]));
    storage.saveWithSizeCheck('callTranscripts', { 'call-1': TRANSCRIPT });
    storage.clearDirtyStores();

    const result = storage.repairInlineTranscripts();
    t.equal('it repairs the stranded transcript', result.repaired, 1);
    t.equal('and nothing is left waiting', result.pending, 0);

    const raw = storage.readStore('callListeningLogs');
    t.equal('the transcript is inline', raw['Esther Ramos'][0].transcript, TRANSCRIPT);
    t.check('the pointer is dropped', !('transcriptId' in raw['Esther Ramos'][0]));

    // Marking the store dirty is what carries the repair to the other machine
    // on the next push. Without it the fix is local only and he does the
    // three step dance by hand.
    t.check('and it is queued for the next sync', storage.isStoreDirty('callListeningLogs') === true);
});

suite('transcript storage: a clean load writes nothing', (t) => {
    const storage = load(t);

    storage.saveCallListeningLogs(logsWith([{
        id: 'call-1', listenedOn: '2026-09-03', employeeName: 'Esther Ramos',
        transcript: TRANSCRIPT
    }]));
    storage.clearDirtyStores();

    const result = storage.repairInlineTranscripts();
    t.equal('nothing to repair', result.repaired, 0);

    // This is the part that matters. An unconditional save at boot marks the
    // store dirty every load, and a store that is always dirty pushes over
    // the other machine's work every time a tab is opened.
    t.check('so the store is left clean', storage.isStoreDirty('callListeningLogs') === false);
    t.equal('and the transcript is untouched',
        storage.loadCallListeningLogs()['Esther Ramos'][0].transcript, TRANSCRIPT);
});

suite('transcript storage: a transcript that has not arrived yet waits', (t) => {
    const storage = load(t);

    storage.saveWithSizeCheck('callListeningLogs', logsWith([{
        id: 'call-9', listenedOn: '2026-09-03', employeeName: 'Esther Ramos',
        transcriptId: 'call-9'
    }]));
    storage.clearDirtyStores();

    const warnings = [];
    const realWarn = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    const result = storage.repairInlineTranscripts();
    console.warn = realWarn;

    t.equal('there is nothing to repair yet', result.repaired, 0);
    t.equal('but it is counted as waiting', result.pending, 1);
    t.check('and said out loud', warnings.some(line => /repaired once it syncs/.test(line)));

    // Nothing is written, so the pointer survives for the next attempt and
    // the store is not pushed in a half-repaired state.
    t.check('the store is left clean', storage.isStoreDirty('callListeningLogs') === false);
    t.check('and the pointer survives',
        'transcriptId' in storage.readStore('callListeningLogs')['Esther Ramos'][0]);
});

suite('transcript storage: the repair actually runs', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    // At boot, and again after a sync pull, because the pull is what may have
    // just delivered the store this machine was missing.
    const calls = script.match(/repairInlineTranscriptsIfNeeded\(\)/g) || [];
    t.check('it is called at least twice', calls.length >= 2);
    t.check('once at boot',
        /callListeningLogs = loadCallListeningLogs\(\);\n    \/\/[\s\S]{0,300}repairInlineTranscriptsIfNeeded\(\)/.test(script));
    t.check('and once after a restore',
        /callListeningLogs = loadCallListeningLogs\(\);\n        \/\/[\s\S]{0,300}repairInlineTranscriptsIfNeeded\(\)/.test(script));

    // The in-memory copy has to be refreshed, or the transcript reads as
    // missing until the next reload despite being repaired on disk.
    t.check('the in-memory copy is refreshed after a repair',
        /function repairInlineTranscriptsIfNeeded[\s\S]{0,500}callListeningLogs = loadCallListeningLogs\(\)/.test(script));
    t.check('and the sync is queued',
        /function repairInlineTranscriptsIfNeeded[\s\S]{0,600}queueCallListeningRepoSync\(/.test(script));
});
