'use strict';

/**
 * One call, counted once.
 *
 * Generating a Copilot prompt and copying a Verint note both save a log
 * without saying so, so one pasted transcript can end up stored under two
 * dates. The bridge only skipped a history entry whose date matched the open
 * call, so those duplicates were scored as separate calls and the message told
 * the associate a habit showed up "on both calls" when there had only ever
 * been one.
 *
 * Which is also why every stored call has to be visible and removable: a call
 * the supervisor does not remember saving is still feeding the coaching.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    global.getMetricTips = () => ['Narrate what you are checking'];
    global.window.METRICS_REGISTRY = { aht: { label: 'Average Handle Time' } };
    global.window.formatMetricDisplay = (key, value) => String(value);
    t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-word-choice.module.js');
    t.loadModule('modules/call-coaching-bridge.module.js');
    return global.window.DevCoachModules;
}

const CALL = [
    'Agent: Thank you for calling, my name is Esther.',
    'Customer: My bill is wrong again.',
    'Agent: Unfortunately that is our policy.',
    'Agent: One moment. Just a second. Bear with me. Still checking.'
].join('\n');

const OTHER_CALL = [
    'Agent: Thanks for calling, this is Esther.',
    'Customer: Why was I charged twice?',
    'Agent: I am not sure, one moment. Still loading.'
].join('\n');

suite('saved calls: identifying a call by what was said', (t) => {
    const { callTranscript, callCoachingBridge: bridge } = load(t);
    const print = bridge.callFingerprint;

    t.check('the same text matches itself', print(CALL) === print(CALL));
    t.check('a different call does not match', print(CALL) !== print(OTHER_CALL));

    // The case that matters: a Verint export is stored with a bracket header
    // summarising the metadata, so the pasted copy and the stored copy of one
    // call are genuinely different strings and still have to match.
    const verint = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'verint-export.txt'), 'utf8');
    const storedVerint = callTranscript.prepareForStorage(verint);
    t.check('a stored Verint export gains a header', storedVerint.startsWith('[Call '));
    t.check('so the strings differ', storedVerint !== verint);
    t.equal('but they fingerprint the same', print(storedVerint), print(verint));

    // A plain transcript is stored as-is, which must also be stable.
    const stored = callTranscript.prepareForStorage(CALL);
    t.equal('a plain transcript fingerprints the same', print(stored), print(CALL));

    // Whitespace and punctuation differences are not a different call.
    t.equal('reflowed whitespace matches', print(CALL.replace(/\n/g, '\n\n')), print(CALL));
    t.equal('nothing has no fingerprint', print(''), '');
    t.equal('and neither does undefined', print(undefined), '');
});

suite('saved calls: one call counted once', (t) => {
    const { callTranscript, callWordChoice, callCoachingBridge: bridge } = load(t);

    const analysis = callTranscript.analyzeTranscript(CALL, { associateName: 'Esther' });
    const wordChoice = callWordChoice.scanTranscript(CALL, { associateName: 'Esther', analysis });
    const stored = callTranscript.prepareForStorage(CALL);

    // The bug: the same call saved under a different date than the one in the
    // form was scored as a second call.
    const withDuplicate = bridge.collectFindings({
        analysis,
        wordChoice,
        transcript: CALL,
        associateName: 'Esther',
        callDate: '2026-09-03',
        history: [{ listenedOn: '2026-08-28', employeeName: 'Esther', transcript: stored }]
    });
    t.equal('a duplicate under another date is not a second call', withDuplicate.callsReviewed, 1);
    t.check('so nothing claims a pattern', withDuplicate.findings.every(f => f.appearsOn === 'on this call'));

    // Saved three times over, still one call.
    const thrice = bridge.collectFindings({
        analysis,
        wordChoice,
        transcript: CALL,
        associateName: 'Esther',
        callDate: '2026-09-03',
        history: [
            { listenedOn: '2026-08-28', employeeName: 'Esther', transcript: stored },
            { listenedOn: '2026-08-21', employeeName: 'Esther', transcript: CALL }
        ]
    });
    t.equal('three copies are still one call', thrice.callsReviewed, 1);
    t.equal('and it is named once', thrice.callMoments.length, 1);

    // A genuinely different call must still count.
    const genuine = bridge.collectFindings({
        analysis,
        wordChoice,
        transcript: CALL,
        associateName: 'Esther',
        callDate: '2026-09-03',
        history: [
            { listenedOn: '2026-08-28', employeeName: 'Esther', transcript: stored },
            { listenedOn: '2026-08-21', employeeName: 'Esther', transcript: OTHER_CALL }
        ]
    });
    t.equal('a real second call counts', genuine.callsReviewed, 2);

    // Two duplicates in history with no open call at all.
    const historyOnly = bridge.collectFindings({
        associateName: 'Esther',
        history: [
            { listenedOn: '2026-08-28', employeeName: 'Esther', transcript: stored },
            { listenedOn: '2026-08-21', employeeName: 'Esther', transcript: CALL },
            { listenedOn: '2026-08-14', employeeName: 'Esther', transcript: OTHER_CALL }
        ]
    });
    t.equal('duplicates collapse in history too', historyOnly.callsReviewed, 2);
});

suite('saved calls: wiring', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'styles-v2.css'), 'utf8');

    t.check('there is a panel for everything saved', html.includes('id="allSavedCalls"'));
    t.check('with a button to open it', html.includes('id="showAllSavedCallsBtn"'));
    t.check('and a summary line', html.includes('id="allSavedCallsSummary"'));
    t.check('the button is bound', script.includes("getElementById('showAllSavedCallsBtn')"));
    t.check('the list is bound for deletes', script.includes("getElementById('allSavedCalls')"));

    t.check('it reads every associate, not just the selected one',
        /function collectAllSavedCalls[\s\S]{0,600}Object\.keys\(logs\)/.test(script));
    t.check('deleting asks first', /function deleteSavedCall[\s\S]{0,900}confirm\(/.test(script));
    t.check('deleting persists', /function deleteSavedCall[\s\S]{0,1200}saveCallListeningLogs\(/.test(script));
    t.check('and repaints both views',
        /function deleteSavedCall[\s\S]{0,1400}renderCallListeningHistoryForSelectedEmployee\(\)/.test(script));

    // A duplicate is shown rather than hidden, because it is the thing that
    // was inflating the counts and the supervisor is the one who removes it.
    t.check('duplicates are flagged in the list', script.includes('looks like a duplicate'));
    t.check('and styled so they stand out', css.includes('.saved-call-duplicate'));

    // The panel says why calls appear that were never saved by hand.
    t.check('the panel explains the silent saves', html.includes('saves a log automatically'));

    t.check('the open transcript is handed to the bridge', /transcript,\s*\n\s*callDate/.test(script));
});

suite('saved calls: a truncated copy is still the same call', (t) => {
    const { callTranscript, callCoachingBridge: bridge } = load(t);
    const print = bridge.callFingerprint;

    // A call over the storage ceiling is saved as a shortened version of what
    // was pasted, which is what made a length-based fingerprint useless. The
    // ceiling is high enough now that no real call reaches it, so this needs a
    // deliberately huge one.
    const huge = ['Agent: Thank you for calling, my name is Jamie.']
        .concat(Array.from({ length: 4000 }, () => 'Agent: let me check that for you and see what the account shows'))
        .concat(['Agent: To recap, that is sorted. Anything else I can help with?'])
        .join('\n');
    const stored = callTranscript.prepareForStorage(huge);
    t.check('the call is long enough to be trimmed',
        stored.includes('[transcript truncated for storage]'));
    t.equal('and still fingerprints as the same call', print(stored), print(huge));

    // Two calls that open with the same greeting are not the same call.
    const greeting = 'Agent: Thank you for calling, my name is Jamie. How can I help you today?';
    const a = [greeting, 'Customer: My bill doubled and I want to know why.', 'Agent: Let me pull that up for you now.'].join('\n');
    const b = [greeting, 'Customer: I need to move my due date to the 20th.', 'Agent: I can get that changed today.'].join('\n');
    t.check('a shared greeting does not make two calls one', print(a) !== print(b));
});

suite('saved calls: reading an old call', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'styles-v2.css'), 'utf8');

    t.check('rows are clickable controls', script.includes('class="saved-call-open"'));
    t.check('and report their open state', script.includes('aria-expanded="${open}"'));
    t.check('expanding is tracked per associate and entry',
        /function savedCallKey[\s\S]{0,200}\$\{employeeName\}\|\$\{entryId\}/.test(script));
    t.check('clicking a row toggles it', /function handleAllSavedCallsClick[\s\S]{0,900}toggleSavedCall\(/.test(script));

    // The detail is what he asked to see: the transcript and the notes.
    t.check('the detail shows the transcript', script.includes('saved-call-transcript'));
    t.check('the transcript is escaped', /saved-call-transcript">\$\{escapeHtml\(entry\.transcript\)\}/.test(script));
    t.check('the detail shows the saved notes', script.includes("['What went well', entry.whatWentWell]"));
    t.check('a call with no transcript says so',
        /No transcript was saved with this call/.test(script));
    t.check('a call with no notes says so', /No notes were saved with this call/.test(script));

    // Built on expand, because rescoring forty transcripts to draw a list
    // nobody has opened is wasted work.
    t.check('the detail is only built when open',
        /\$\{open \? buildSavedCallDetailHtml\(group\.employeeName, entry\) : ''\}/.test(script));

    // Viewing must not quietly replace unsent work in the form.
    t.check('loading into the form is a separate action', script.includes('data-saved-load-id'));
    t.check('and asks before overwriting work',
        /function loadSavedCallIntoForm[\s\S]{0,900}hasWork && !confirm\(/.test(script));
    t.check('loading switches to that associate',
        /function loadSavedCallIntoForm[\s\S]{0,1200}select\.value = employeeName/.test(script));

    t.check('the panel says a call can be opened', html.includes('Click a call to read the transcript'));
    t.check('the transcript box scrolls rather than stretching the page',
        /\.saved-call-transcript[\s\S]{0,200}overflow: auto/.test(css));
});

suite('saved calls: nothing is saved without being asked', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    // Copying a Verint note and generating a prompt both used to write a log
    // on the way past. Nothing said so, which is how one call ended up stored
    // twice under different dates and Scott could not account for what was in
    // memory. Reading the form is not a decision to keep it.
    const saveCalls = script.match(/upsertCallListeningEntryFromForm\(/g) || [];
    t.equal('only the definition and the Save button reference the saver', saveCalls.length, 2);
    t.check('the Save button is the one that calls it',
        /bindElementOnce\(saveBtn, 'click', \(\) => upsertCallListeningEntryFromForm\(true\)\)/.test(script));

    t.check('copying a Verint note builds an unsaved entry',
        /function copyCallListeningVerintSummary[\s\S]{0,700}buildUnsavedCallListeningEntry\(\)/.test(script));
    t.check('generating a prompt builds an unsaved entry',
        /function generateCallListeningPromptAndCopy[\s\S]{0,300}buildUnsavedCallListeningEntry\(\)/.test(script));
    t.check('and the unsaved entry never reaches the log',
        /function buildUnsavedCallListeningEntry[\s\S]{0,500}return \{ id: '', \.\.\.draft/.test(script));
});

suite('saved calls: the outcome of the last coaching is on this page', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    // It was measured all along and only rendered on the Coaching page, two
    // clicks from where you decide what to say next.
    t.check('there is a panel for it', html.includes('id="callOutcomesPanel"'));
    t.check('it renders for the selected associate',
        /function renderCallListeningOutcomes[\s\S]{0,400}renderForEmployee\?\.\(/.test(script));
    t.check('and repaints when the associate changes',
        /renderCallListeningHistoryForSelectedEmployee[\s\S]{0,600}renderCallListeningOutcomes\(employeeName\)/.test(script));
});

suite('saved calls: the store says how big it is getting', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    // It only ever grows, and every sync ships the whole of it whatever
    // changed. A number on the screen is one that can be watched.
    t.check('the size is measured', script.includes('function describeSavedCallsSize'));
    t.check('measured rather than estimated',
        /describeSavedCallsSize[\s\S]{0,400}new Blob\(\[JSON\.stringify\(callListeningLogs/.test(script));
    t.check('it reads in KB below a megabyte', /KB stored/.test(script));
    t.check('and MB above one', /MB stored/.test(script));
    t.check('it survives a measuring failure',
        /describeSavedCallsSize[\s\S]{0,600}catch \(error\) \{\s*return '';/.test(script));
    t.check('and reaches the summary line', /\$\{stored \? `, \$\{stored\}` : ''\}/.test(script));
});
