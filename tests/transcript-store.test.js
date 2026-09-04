'use strict';

/**
 * Transcripts live in their own store, joined to their logs in memory.
 *
 * A sync shard is a whole store, so with transcripts inline a one-word edit to
 * a note re-uploaded every transcript in the log: 19MB at six hundred calls,
 * on every edit. Separated, that edit ships the metadata alone.
 *
 * The split is confined to loadCallListeningLogs and saveCallListeningLogs.
 * Thirty-nine places read `entry.transcript` and all of them still can. A bug
 * in that seam loses the record of what was said on a call, which is why the
 * round trip below is the first test in the file.
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

suite('transcript store: what goes in comes back out', (t) => {
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
    t.equal('and so is everything else',
        loaded['Esther Ramos'][0].whatWentWell, 'Clean open');
    t.equal('the entry keeps its id', loaded['Esther Ramos'][0].id, 'call-1');

    // The transcript is not in the log store any more, which is the point.
    const rawLogs = storage.readStore('callListeningLogs');
    t.check('the log store holds no transcript text',
        !JSON.stringify(rawLogs).includes('grab the keys'));
    t.check('it holds a reference instead', rawLogs['Esther Ramos'][0].transcriptId === 'call-1');

    const rawTranscripts = storage.readStore('callTranscripts');
    t.equal('and the transcript store holds the text', rawTranscripts['call-1'], TRANSCRIPT);
});

suite('transcript store: editing a note leaves the transcripts alone', (t) => {
    const storage = load(t);

    const entry = {
        id: 'call-1', listenedOn: '2026-09-03', employeeName: 'Esther Ramos',
        transcript: TRANSCRIPT, whatWentWell: 'Clean open'
    };
    storage.saveCallListeningLogs(logsWith([entry]));
    storage.clearDirtyStores();

    // The reason the split exists: a note edit must not touch the transcripts,
    // because a dirty store is a store the next sync uploads.
    const edited = storage.loadCallListeningLogs();
    edited['Esther Ramos'][0].whatWentWell = 'Clean open, laid out all three plans';
    storage.saveCallListeningLogs(edited);

    t.check('the logs are marked for sync', storage.isStoreDirty('callListeningLogs') === true);
    t.check('the transcripts are not', storage.isStoreDirty('callTranscripts') === false);

    // And a new transcript does mark them.
    storage.clearDirtyStores();
    const withNewCall = storage.loadCallListeningLogs();
    withNewCall['Esther Ramos'].push({
        id: 'call-2', listenedOn: '2026-09-04', employeeName: 'Esther Ramos',
        transcript: 'Agent: A different call entirely.'
    });
    storage.saveCallListeningLogs(withNewCall);
    t.check('a new transcript does mark them', storage.isStoreDirty('callTranscripts') === true);

    const loaded = storage.loadCallListeningLogs();
    t.equal('both transcripts survive', loaded['Esther Ramos'].length, 2);
    t.equal('the first is untouched', loaded['Esther Ramos'][0].transcript, TRANSCRIPT);
    t.equal('and the second is there', loaded['Esther Ramos'][1].transcript, 'Agent: A different call entirely.');
});

suite('transcript store: logs saved before the split still read', (t) => {
    const storage = load(t);

    // Written the old way, transcript inline, no reference. Nothing migrates
    // on a schedule, so this has to keep working indefinitely.
    storage.saveWithSizeCheck('callListeningLogs', logsWith([{
        id: 'legacy-1', listenedOn: '2026-08-01', employeeName: 'Esther Ramos',
        transcript: 'Agent: An old call, stored inline.'
    }]));

    const loaded = storage.loadCallListeningLogs();
    t.equal('the inline transcript is returned', loaded['Esther Ramos'][0].transcript, 'Agent: An old call, stored inline.');

    // Saving it moves it into the new shape without being asked to migrate.
    storage.saveCallListeningLogs(loaded);
    const rawLogs = storage.readStore('callListeningLogs');
    t.check('it is lifted out on the next save', !JSON.stringify(rawLogs).includes('stored inline'));
    t.equal('and still reads back', storage.loadCallListeningLogs()['Esther Ramos'][0].transcript,
        'Agent: An old call, stored inline.');
});

suite('transcript store: a missing transcript is reported, not hidden', (t) => {
    const storage = load(t);

    // A log pointing at a transcript that is not there. Silently returning an
    // entry with no transcript would look like a call nobody recorded.
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
    t.check('and the gap is reported', warnings.some(line => /transcript call-9, which is not in the store/.test(line)));
});

suite('transcript store: an entry with no transcript is left alone', (t) => {
    const storage = load(t);

    // Logs typed by hand before transcripts existed at all.
    const original = logsWith([{
        id: 'notes-only', listenedOn: '2026-07-01', employeeName: 'Esther Ramos',
        whatWentWell: 'typed by hand'
    }]);

    storage.saveCallListeningLogs(original);
    const loaded = storage.loadCallListeningLogs();

    t.equal('the notes survive', loaded['Esther Ramos'][0].whatWentWell, 'typed by hand');
    t.check('no reference is invented', !loaded['Esther Ramos'][0].transcriptId);
    t.check('and no empty transcript store is written',
        Object.keys(storage.readStore('callTranscripts') || {}).length === 0);
});

suite('transcript store: wiring', (t) => {
    const registry = fs.readFileSync(path.join(ROOT, 'modules/store-registry.module.js'), 'utf8');
    const constants = fs.readFileSync(path.join(ROOT, 'modules/constants.module.js'), 'utf8');
    const sync = fs.readFileSync(path.join(ROOT, 'modules/repo-sync.module.js'), 'utf8');

    // Registered as data, so syncedNames() picks it up and the v2 push ships
    // it as its own shard with no sync code changes.
    t.check('the store is registered', /name: 'callTranscripts', tier: 'data'/.test(registry));

    // A map of id to transcript merges key by key under this strategy, so every
    // transcript either machine holds survives. Losing one is losing the record
    // of what was said on a call.
    t.check('it merges by union, never last writer wins',
        /name: 'callTranscripts'[^}]*merge: 'unionByEntryHash'/.test(registry));
    t.check('it is routed through IndexedDB', constants.includes("'callTranscripts'"));

    // A backup with the logs but not the transcripts restores a set of calls
    // with nothing in them.
    t.check('the backup carries it', sync.includes("callTranscripts: safeLoadJson('callTranscripts')"));

    // Absent has to mean leave alone. Coercing it to {} would erase every
    // transcript on this machine while restoring the logs that point at them.
    t.check('restoring treats absent as leave alone',
        sync.includes('callTranscripts: coerceNullableObject(payload?.callTranscripts)'));
    t.check('and it is not double carried by the verbatim sweep',
        /EXPLICITLY_SYNCED_STORES[\s\S]{0,300}'callTranscripts'/.test(sync));
});
