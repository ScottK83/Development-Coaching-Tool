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
    t.loadModule('modules/call-verification.module.js');
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

    // The panel says why calls appear that were never saved by hand. In the
    // past tense since 2026-09-30: nothing saves on the way past any more (see
    // "nothing is saved without being asked" below), and the present tense
    // told Scott something the page no longer does.
    t.check('the panel explains the silent saves', html.includes('saved a log automatically'));

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

    // Clicking a call means "work on this call", so one click loads the form
    // and every panel with it. It used to only expand a read-only view with a
    // Load button underneath, which was two clicks and a hunt for the second.
    t.check('clicking a row loads it',
        /function handleAllSavedCallsClick[\s\S]{0,1400}loadSavedCallIntoForm\(employeeName, entryId\)/.test(script));
    t.check('and the separate button is gone', !script.includes('data-saved-load-id'));

    // The confirm is the only reason the two steps existed, and losing a draft
    // is not undoable.
    t.check('it asks before overwriting work',
        /function loadSavedCallIntoForm[\s\S]{0,900}hasWork && !confirm\(/.test(script));
    t.check('a declined confirm does not expand the row either',
        /hasWork && !confirm\([^)]*\)\) return false/.test(script));
    t.check('loading switches to that associate',
        /function loadSavedCallIntoForm[\s\S]{0,1200}select\.value = employeeName/.test(script));

    // Closing an open row is just closing it, and must not reload anything.
    t.check('collapsing an open row only collapses it',
        /expandedSavedCalls\.has\(savedCallKey\(employeeName, entryId\)\)[\s\S]{0,200}toggleSavedCall\(employeeName, entryId\);\s*return;/.test(script));

    t.check('the panel says a call can be opened', html.includes('Click a call to read the transcript'));
    t.check('the transcript box scrolls rather than stretching the page',
        /\.saved-call-transcript[\s\S]{0,200}overflow: auto/.test(css));
});

/**
 * A call is kept when it goes somewhere, once, and the toast says so.
 *
 * Copying a Verint note and generating a prompt both used to write a log on
 * the way past. Nothing said so, and each save appended a fresh entry, which
 * is how one call ended up stored twice under different dates and Scott could
 * not account for what was in memory. The fix then was to save only from the
 * Save button.
 *
 * On 2026-09-30 Scott asked for fewer buttons ("really still too many
 * buttons"), and the Save button was one of them. So the three buttons that
 * send a call somewhere (Copilot, Verint, the associate) keep it again, with
 * both halves of the old problem fixed at the root: every one of them says in
 * its toast that the call was saved, and a save finds the call it belongs to
 * and updates it in place rather than appending.
 */
suite('saved calls: kept when it goes somewhere, once, and said out loud', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    t.check('there is one way on to the log',
        /function keepCallOnTheWayOut\(\) \{\s*return Boolean\(upsertCallListeningEntryFromForm\(false\)\);/.test(script));
    t.check('the Save button under More still uses the same saver',
        /bindElementOnce\(saveBtn, 'click', \(\) => upsertCallListeningEntryFromForm\(true\)\)/.test(script));

    const body = (name) => {
        const start = script.indexOf(`function ${name}(`);
        const next = script.indexOf('\nfunction ', start + 10);
        return start < 0 ? '' : script.slice(start, next < 0 ? undefined : next);
    };
    [
        ['copyCallListeningVerintSummary', /and the call saved/],
        ['writeCallSummaryInCopilot', /and the call saved/],
        ['writeCallEmailInCopilot', /and the call saved/]
    ].forEach(([name, says]) => {
        const text = body(name);
        t.check(`${name} keeps the call`, /keepCallOnTheWayOut\(\)/.test(text));
        t.check(`and says so`, says.test(text));
    });

    // A call copied out of the history is already saved.
    t.check('a call copied from the history is not saved again',
        /if \(!entry\) \{\s*entry = buildUnsavedCallListeningEntry\(\);\s*if \(!entry\) return;\s*saved = keepCallOnTheWayOut\(\);/.test(body('copyCallListeningVerintSummary')));

    // Updated in place, never appended twice.
    const saver = body('upsertCallListeningEntryFromForm');
    t.check('a save looks for the same call first', /findSameCall/.test(saver));
    t.check('by the transcript fingerprint', /callFingerprint/.test(saver));
    t.check('and updates it in place', /Object\.assign\(entry, draft/.test(saver));
    // A new call pasted over a saved one clears the boxes without asking,
    // Copilot's pasted summary included, because they are in the history.
    t.check('it remembers what it kept', /lastKeptCallDraft = draft;/.test(saver));
    t.check('and a new call checks the boxes against it',
        /function startFreshCallFeedback[\s\S]{0,900}lastKeptCallDraft\?\.\[key\]/.test(script));
    t.check('Copilot\'s summary is one of those boxes',
        /callListeningCopilotSummary: 'copilotSummary'/.test(script));
    t.check('appending only when it is a new call', /entry = createCallListeningEntry\(draft\);\s*appendCallListeningEntry/.test(saver));
});

suite('saved calls: which saved entry is the same call', (t) => {
    t.installFakeBrowser();
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-listening.module.js');
    t.loadModule('modules/call-coaching-bridge.module.js');
    const { callListening: L, callTranscript: T, callCoachingBridge: bridge } = global.window.DevCoachModules;
    const print = bridge.callFingerprint;

    const verint = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'verint-export.txt'), 'utf8');
    const stored = { id: 'a', listenedOn: '2026-08-04', callTime: '12:38 PM', transcript: T.prepareForStorage(verint) };
    const other = { id: 'b', listenedOn: '2026-08-04', callTime: '12:38 PM', transcript: T.prepareForStorage('Agent: Thank you for calling.\nCustomer: My power is out.') };

    t.equal('the same conversation is the same call', L.findSameCall([other, stored], { transcript: verint }, print)?.id, 'a');
    t.equal('even with the date changed', L.findSameCall([stored], { listenedOn: '2026-09-30', transcript: verint }, print)?.id, 'a');
    t.equal('a different conversation is not', L.findSameCall([stored], { transcript: 'Agent: Hello.\nCustomer: Starting service.' }, print), null);

    // With no transcript, the date, time and reference have to agree.
    const noteOnly = { id: 'c', listenedOn: '2026-09-29', callTime: '10:14 AM', callReference: '', transcript: '' };
    t.equal('a notes only call matches on when it was', L.findSameCall([noteOnly], { listenedOn: '2026-09-29', callTime: '10:14 AM', callReference: '', transcript: '' }, print)?.id, 'c');
    t.equal('but not at another time', L.findSameCall([noteOnly], { listenedOn: '2026-09-29', callTime: '2:00 PM', callReference: '', transcript: '' }, print), null);
    t.equal('and a transcript call never matches a notes only one', L.findSameCall([noteOnly], { listenedOn: '2026-09-29', callTime: '10:14 AM', transcript: verint }, print), null);
    t.equal('nothing to match against', L.findSameCall([], { transcript: verint }, print), null);
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

suite('saved calls: a transcript the old cap cut short says so', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'styles-v2.css'), 'utf8');

    // A call saved under the old 8000 character cap lost its ending
    // permanently. Raising the cap does not bring it back, so a 39 minute call
    // that stops at 15:46 needs to say why rather than look like a bug.
    t.check('the trimming is detected', /\[transcript truncated/.test(script));
    t.check('it says the end cannot be recovered',
        script.includes('cannot be recovered'));
    t.check('and what to do about it',
        script.includes('Paste the original into the form and save it again'));
    t.check('the note has a style to render in', css.includes('.call-note-warn'));
});

suite('saved calls: one gesture loads a call, in both panels', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const listening = fs.readFileSync(path.join(ROOT, 'modules/call-listening.module.js'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'styles-v2.css'), 'utf8');

    // Two mechanisms for one intention is what had Scott click a call, watch
    // it not carry everything over, and press a button to try again.
    t.check('the history row is the control', listening.includes('class="call-history-open"'));
    t.check('and carries the load action', /call-history-open[^>]*data-call-action="load"/.test(listening));
    t.check('the standalone Load button is gone',
        !/>Load<\/button>/.test(listening));
    t.check('Copy Verint stays, it is a different intention', listening.includes('Copy Verint'));
    t.check('so does Delete', listening.includes('Delete'));

    // Both panels go through the guarded loader, so neither can replace unsent
    // work without asking.
    t.check('the history load is guarded',
        /action === 'load'[\s\S]{0,400}loadSavedCallIntoForm\(employeeName, entryId\)/.test(script));
    t.check('and the memory panel uses the same function',
        /function handleAllSavedCallsClick[\s\S]{0,1400}loadSavedCallIntoForm\(employeeName, entryId\)/.test(script));

    // A row that loads on click has to look like it will.
    t.check('the row is styled as a control', css.includes('.call-history-open'));
    t.check('with a hover state', /\.call-history-open:hover/.test(css));

    // Whether a transcript came across is the thing Scott could not see, so
    // the row says either way rather than only when there is one.
    t.check('a row says when a transcript is missing', listening.includes("' • no transcript'"));
    t.check('and when one is there', listening.includes("' • transcript saved'"));
});

/**
 * The memory panel listed every associate at once.
 *
 * That is the right view for the job it was built for, clearing out calls that
 * should not be feeding the coaching, and the wrong one for every other visit.
 * A hundred and twenty seven names is not a list anybody reads to find one
 * person's calls, and it only ever grows: every prompt generated and every
 * Verint note copied saves a log automatically.
 *
 * The associate on screen is the default now. Everyone stays one click away,
 * because deleting a stray call still needs it.
 */
suite('saved calls: the panel shows the associate on screen', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    t.check('the collector can be narrowed to one person',
        /function collectAllSavedCalls\(onlyEmployee\)/.test(script));
    t.check('and it filters on the name',
        /\.filter\(employeeName => !wanted \|\| employeeName === wanted\)/.test(script));

    t.check('the scope is worked out in one place', /function savedCallsScope\(\)/.test(script));
    t.check('it defaults to the selected associate',
        /function savedCallsScope\(\)[\s\S]{0,600}callListeningEmployeeSelect/.test(script));

    // With nobody picked there is nothing to narrow to, so everything beats an
    // empty panel calling itself a filter.
    t.check('no selection falls back to everyone',
        /everyone: everyone \|\| !employeeName/.test(script));

    t.check('there is a way back to everyone', html.includes('id="savedCallsEveryoneToggle"'));
    t.check('the toggle re-renders', /savedCallsEveryoneToggle'\), 'change', refreshAllSavedCallsIfOpen/.test(script));

    // Changing associate while the panel is open has to move it too, or it
    // keeps showing the last person's calls under the new person's name.
    t.check('changing associate moves the panel',
        /callListeningEmployeeSelect'\), 'change', refreshAllSavedCallsIfOpen/.test(script));

    // "Nothing saved yet" in front of a supervisor with ninety calls stored,
    // because this one associate has none, is the panel telling them something
    // untrue about their own data.
    t.check('an empty scope does not claim the store is empty',
        /No calls saved for \$\{scope\.employeeName\} yet/.test(script));

    // The stored size is the whole store, so it belongs only on the everyone
    // view. Under one associate's four calls it would read as those four
    // weighing a megabyte.
    t.check('the stored size is only shown for everyone',
        /scope\.everyone[\s\S]{0,200}\$\{stored\}/.test(script));
});
