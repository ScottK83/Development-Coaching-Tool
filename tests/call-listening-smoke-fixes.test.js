'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * WHAT THE 10/14 SMOKE TEST CAUGHT ON THE CALLS PAGE
 *
 * Scott asked for a smoke test of "me uploading calls and providing
 * feedback", run in his browser on his real data. Each suite here is one
 * thing it found, run against the real code rather than matched as text
 * wherever the code can be run.
 */

const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

// One top-level function out of script.js, by name.
function sliceFunction(name) {
    const start = script.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`${name} not found in script.js`);
    return script.slice(start, script.indexOf('\n}\n', start) + 3);
}

// From the first marker to the end of the function named by the second.
function sliceBetween(fromMarker, lastFunction) {
    const start = script.indexOf(fromMarker);
    const fnStart = script.indexOf(`function ${lastFunction}(`, start);
    if (start < 0 || fnStart < 0) throw new Error(`${fromMarker} .. ${lastFunction} not found`);
    return script.slice(start, script.indexOf('\n}\n', fnStart) + 3);
}

function loadCallModules(t) {
    t.installFakeBrowser();
    global.getMetricTips = () => [];
    global.window.METRICS_REGISTRY = {};
    t.loadModule('modules/message-voice.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-verification.module.js');
    t.loadModule('modules/call-explanation.module.js');
    t.loadModule('modules/call-red-flags.module.js');
    t.loadModule('modules/call-summary.module.js');
    t.loadModule('modules/call-coaching-bridge.module.js');
    t.loadModule('modules/call-listening.module.js');
    t.loadModule('modules/verint-paste.module.js');
    return global.window.DevCoachModules;
}

// The balance given out on the caller's name alone.
const NAME_ONLY_TURNS = [
    ['00:03', 'thank you for calling APS my name is alyssa how can i help you'],
    ['00:08', 'hi i wanted to know how much i owe on my bill'],
    ['00:12', 'sure can i get the address on the account'],
    ['00:16', 'it is on main street'],
    ['00:25', 'and can i have your name'],
    ['00:28', 'john smith'],
    ['00:35', 'okay thank you john your current balance is two hundred and twelve dollars and seventeen cents due on the twentieth'],
    ['00:45', 'okay thanks'],
    ['00:47', 'is there anything else i can help with'],
    ['00:50', 'no thanks bye']
];

function nameOnlyCall(stamp) {
    return NAME_ONLY_TURNS.map(([at, said]) => `${stamp(at)}\n${said}`).join('\n');
}

suite('call smoke fixes: every change handler on the associate dropdown is attached', (t) => {
    const src = sliceBetween('const boundElementHandlers', 'bindElementOnce');
    const bindElementOnce = new Function(`${src}; return bindElementOnce;`)();

    const attached = [];
    const select = { dataset: {}, addEventListener: (type, fn) => attached.push(type + ':' + (fn.name || 'inline')) };
    function renderHistory() {}
    function refreshRecipient() {}
    function reread() {}

    bindElementOnce(select, 'change', renderHistory);
    bindElementOnce(select, 'change', refreshRecipient);
    bindElementOnce(select, 'change', reread);
    t.equal('all three handlers attach, not only the first', attached.length, 3);

    // The section binder runs every time the tab opens, so a second pass must
    // add nothing, inline arrows included.
    bindElementOnce(select, 'change', renderHistory);
    const button = { dataset: {}, addEventListener: (type) => attached.push(type + ':inline') };
    bindElementOnce(button, 'click', () => 'save');
    bindElementOnce(button, 'click', () => 'save');
    t.equal('a second pass binds nothing twice', attached.length, 4);
    t.check('a missing element is ignored', bindElementOnce(null, 'click', renderHistory) === undefined);
});

suite('call smoke fixes: a pick from the dropdown is not undone by the header', (t) => {
    // With the re-read attached at last, picking somebody re-read the call on
    // screen and its Verint header put the dropdown straight back.
    t.check('the re-read keeps the pick',
        /analyzeCallListeningTranscript\(\{ auto: true, quiet: true, keepAssociate: true \}\)/.test(sliceFunction('rereadCallForSelectedAssociate')));
    t.check('the read passes it on',
        /applyCallListeningTranscriptMetadata\(meta, \{ keepAssociate: options\?\.keepAssociate === true \}\)/.test(script));

    const apply = new Function('document', 'window', 'Event',
        `${sliceFunction('applyCallListeningTranscriptMetadata')}; return applyCallListeningTranscriptMetadata;`);
    const select = { value: 'Christi Martinez-Sharp', options: [{ value: 'Alyssa Dimes' }, { value: 'Christi Martinez-Sharp' }], dispatchEvent() {} };
    const run = apply({ getElementById: (id) => (id === 'callListeningEmployeeSelect' ? select : null) },
        { DevCoachModules: { callTranscript: { matchAssociateOption: (options, name) => options.find((o) => o === name) || '' } } },
        class { constructor(type) { this.type = type; } });

    run({ advisorDisplayName: 'Alyssa Dimes' }, { keepAssociate: true });
    t.equal('a re-read after a pick leaves it', select.value, 'Christi Martinez-Sharp');
    run({ advisorDisplayName: 'Alyssa Dimes' });
    t.equal('a paste still follows the header', select.value, 'Alyssa Dimes');
});

suite('call smoke fixes: the email goes to the associate on the form', (t) => {
    const src = sliceFunction('currentCallRecipient');
    const els = {
        callListeningRecipient: { value: 'alyssa.dimes@aps.com', dataset: { autofilledFor: 'Alyssa Dimes' } },
        callListeningEmployeeSelect: { value: 'Christi Martinez-Sharp' }
    };
    let refreshed = 0;
    const refresh = () => {
        refreshed++;
        els.callListeningRecipient.value = 'christi.martinez-sharp@aps.com';
        els.callListeningRecipient.dataset.autofilledFor = 'Christi Martinez-Sharp';
    };
    const currentCallRecipient = new Function('document', 'refreshCallListeningRecipient',
        `${src}; return currentCallRecipient;`)({ getElementById: (id) => els[id] || null }, refresh);

    // The case the smoke test hit: Christi on screen, Alyssa's address in To.
    t.equal('an address filled for somebody else is refilled first', currentCallRecipient(), 'christi.martinez-sharp@aps.com');
    t.equal('by the refresh', refreshed, 1);

    els.callListeningRecipient.value = 'c.sharp@aps.com';
    t.equal('a correction typed for this associate is left alone', currentCallRecipient(), 'c.sharp@aps.com');
    t.equal('without another refresh', refreshed, 1);

    const send = sliceFunction('generateCallListeningOutlookEmail');
    t.check('the send reads the address through it', /const to = currentCallRecipient\(\);/.test(send));
    t.check('and only remembers one that differs from what would be filled in',
        /const remember = Boolean\(to\) && to\.toLowerCase\(\) !== resolved\.toLowerCase\(\);/.test(send));
    t.check('the Copilot email toast reads it the same way',
        /function writeCallEmailInCopilot[\s\S]{0,900}const to = currentCallRecipient\(\);/.test(script));
    t.check('loading a saved call always refills To',
        /function loadSavedCallIntoForm[\s\S]{0,1400}\n {4}refreshCallListeningRecipient\(\);\n/.test(script));
});

suite('call smoke fixes: an autofilled address is never saved as a correction', (t) => {
    const mods = loadCallModules(t);
    const saved = [];
    mods.sharedUtils = {
        openMailtoDraft() {},
        setAssociateEmailOverride: (name, email) => saved.push([name, email])
    };
    const draft = (remember) => mods.callListening.generateOutlookDraft({
        employeeName: 'Christi Martinez-Sharp',
        callDate: '2026-09-29',
        bodyText: 'Hey Christi, thanks for the call.',
        to: 'alyssa.dimes@aps.com',
        remember
    });

    t.check('the draft still opens', draft(false).ok);
    t.equal('and nothing is remembered without the flag', saved.length, 0);
    draft(undefined);
    t.equal('or with it missing', saved.length, 0);
    draft(true);
    t.equal('a typed correction is remembered', saved.length, 1);
});

suite('call smoke fixes: emptying the box before the next call is a new call', (t) => {
    const src = sliceFunction('handleTranscriptPaste') + sliceFunction('looksLikeWholeCall');
    const WHOLE_CALL = 'Date/Time:\n10/13/2026 09:15:02 AM\nDimes, Alyssa\n00:03\nthank you for calling\n00:08\nhi\n00:12\nokay';

    function paste({ boxText = '', plain = WHOLE_CALL, onForm = true, holdsWork = true }) {
        let fresh = 0;
        const field = { value: boxText, selectionStart: boxText.length, selectionEnd: boxText.length };
        const handle = new Function('document', 'window', 'resetCallListeningReadPanels', 'startFreshCallFeedback',
            'callFormHoldsWork', 'analyzeCallListeningTranscript', 'setTimeout', 'onForm',
            `let lastTranscriptPasteHtml = ''; let sawTranscriptPaste = false; let callOnFormSinceLoad = onForm;\n${src}; return handleTranscriptPaste;`)(
            { getElementById: () => ({ value: '' }) },
            { DevCoachModules: {} },
            () => {},
            () => { fresh++; },
            () => holdsWork,
            () => {},
            () => {},
            onForm
        );
        handle({
            target: field,
            clipboardData: { getData: (type) => (type === 'text/plain' ? plain : '') },
            preventDefault() {}
        });
        return fresh;
    }

    t.equal('Ctrl+A, Delete, then the next call clears the last one', paste({}), 1);
    t.equal('pasting over the old call still does', paste({ boxText: 'old call text' }), 1);
    t.equal('notes typed before the first call of the day are kept', paste({ onForm: false }), 0);
    t.equal('a few words into an empty box are not a new call', paste({ plain: 'budget billing' }), 0);
    t.equal('an empty form has nothing to clear', paste({ holdsWork: false }), 0);
});

suite('call smoke fixes: a new call clears the email and the Oscar steps too', (t) => {
    const src = sliceBetween('const lastCallDrafts', 'callFormHoldsWork');
    const els = {};
    ['callListeningStrengths', 'callListeningImprovements', 'callListeningCopilotSummary', 'callListeningRelevantInfo',
        'callListeningManagerNotes', 'callListeningReference', 'callListeningOscarUrl', 'callListeningOutlookBody',
        'generateCallListeningOutlookBtn'].forEach((id) => { els[id] = { value: '' }; });
    const asked = [];
    let answer = true;
    const api = new Function('document', 'confirm', 'updateCallListeningOutlookButtonState',
        `${src}; return { startFreshCallFeedback, callFormHoldsWork, rememberCallDrafts,
            kept: (draft) => { lastKeptCallDraft = draft; }, sent: (text) => { lastSentCallEmail = text; } };`)(
        { getElementById: (id) => els[id] || null },
        (message) => { asked.push(message); return answer; },
        () => {}
    );

    t.check('an empty form holds no work', !api.callFormHoldsWork());
    els.callListeningOutlookBody.value = 'Hey Christi,';
    t.check('an email in the box is work', api.callFormHoldsWork());

    // What the smoke test saw: the last call's summary saved, its email sent,
    // its Oscar steps still in the box.
    els.callListeningCopilotSummary.value = 'Summary for Christi';
    els.callListeningRelevantInfo.value = 'Oscar: payment arrangements';
    api.kept({ copilotSummary: 'Summary for Christi', relevantInfo: 'Oscar: payment arrangements' });
    api.sent('Hey Christi,');
    api.startFreshCallFeedback();
    t.equal('saved and sent work is cleared without asking', asked.length, 0);
    t.equal('the summary goes', els.callListeningCopilotSummary.value, '');
    t.equal('the Oscar steps go', els.callListeningRelevantInfo.value, '');
    t.equal('and the email goes', els.callListeningOutlookBody.value, '');

    els.callListeningOutlookBody.value = 'An email I pasted and never opened';
    answer = false;
    api.startFreshCallFeedback();
    t.equal('an unsent email is asked about', asked.length, 1);
    t.check('naming the email in the question', /notes, summary and email/.test(asked[0]));
    t.equal('and kept on Cancel', els.callListeningOutlookBody.value, 'An email I pasted and never opened');
});

suite('call smoke fixes: numbers read out in groups are masked', (t) => {
    const { callTranscript } = loadCallModules(t);
    const mask = callTranscript.maskIdentifiers;

    t.check('an account number read in threes',
        !/eight five six|eight seven eight/.test(mask('account number is eight five six')) && !/eight seven eight/.test(mask('eight seven eight')));
    t.check('a phone prefix', !/six zero one/.test(mask("it's six zero one i'm sorry")));
    t.check('a house number said in words',
        mask('seventeen five hundred north sixty seventh avenue').startsWith('[number] north'));
    t.check('or in front of the street', /^\[number\] main street$/.test(mask('twenty four ten main street')));

    // What says what happened has to survive.
    t.equal('a rate read with a point is kept', mask('fourteen point zero five two cents per kilowatt hour'),
        'fourteen point zero five two cents per kilowatt hour');
    t.equal('so is a longer one', mask('twelve point three four five cents'), 'twelve point three four five cents');
    t.equal('and an ordinary amount', mask('it went up by five dollars last month'), 'it went up by five dollars last month');
    t.equal('and a count', mask('we have three energy plans'), 'we have three energy plans');
    t.equal('and a pair', mask('so we can do one or two days'), 'so we can do one or two days');
});

suite('call smoke fixes: a call past the hour is read', (t) => {
    const mods = loadCallModules(t);
    const hours = (at) => `00:${at}`;
    const transcript = `Date/Time:\n10/13/2026 09:15:02 AM\nDimes, Alyssa\n00:00:00\n/\n00:00:52\n\n${nameOnlyCall(hours)}`;

    const parsed = mods.callTranscript.parseTranscript(transcript);
    t.check('it splits into turns', parsed.turns.length >= 10);
    t.check('and they are timed', parsed.timed);
    t.equal('an hour stamp counts the hour',
        mods.callTranscript.parseTranscript('1:00:05\nhello there\n1:00:09\nhi\n1:00:15\nokay').turns[0].at, 3605);

    const analysis = mods.callTranscript.analyzeTranscript(transcript, { associateName: 'Alyssa Dimes' });
    t.check('verification is read', analysis.verification?.ok === true);
    t.equal('and the name-only breach is found, as on mm:ss', analysis.verification?.status, 'breach');
    t.equal('the length is read from the player', mods.callTranscript.extractMetadata(transcript).durationSeconds, 52);

    const html = NAME_ONLY_TURNS.map(([at, said], i) => {
        const colour = i % 2 ? '#008000' : '#0000ff';
        return `<p><span style="color:${colour}">1:${at}</span></p><p><span style="color:${colour}">${said}</span></p>`;
    }).join('');
    const out = mods.verintPaste.toLabelledTranscript(html, { advisorName: 'Alyssa Dimes' });
    t.check('a coloured paste past the hour is labelled', Boolean(out?.text) && /^Agent: /m.test(out.text));

    t.check('the whole-call check counts hour stamps', /\(\?:\\d\{1,2\}:\)\?\\d\{1,3\}:\[0-5\]\\d/.test(sliceFunction('looksLikeWholeCall')));
});

suite('call smoke fixes: an unread call is not called clean', (t) => {
    const strip = sliceFunction('renderCallFlagStrip');
    t.check('verification it could not read is a line in the strip',
        /if \(analysis\.verification && !analysis\.verification\.ok\) \{\s*items\.push\(/.test(strip));
    t.check('which keeps the green all-clear off the screen', /if \(!items\.length && !box\)/.test(strip));
});

suite('call smoke fixes: Copilot text is made plain for Verint and Outlook', (t) => {
    const { callListening } = loadCallModules(t);
    const tidy = callListening.tidyPastedText;
    const EM = String.fromCharCode(0x2014);
    const EN = String.fromCharCode(0x2013);

    t.equal('bold headings lose their markers', tidy('**What went well:**'), 'What went well:');
    t.equal('a dash in a sentence becomes a comma', tidy(`You recapped the plan ${EM} the customer knew.`), 'You recapped the plan, the customer knew.');
    t.equal('so does one with no spaces', tidy(`plan${EM}the customer`), 'plan, the customer');
    t.equal('a range keeps a hyphen', tidy(`on peak is 4${EN}7 PM`), 'on peak is 4-7 PM');
    t.equal('a heading mark goes', tidy('## Tips to try'), 'Tips to try');
    t.equal('star bullets become dashes', tidy('* Ask first'), '- Ask first');
    t.equal('a dash bullet becomes a hyphen bullet', tidy(`${EM} Ask first`), '- Ask first');
    t.equal('italics lose their markers', tidy('say *exactly* what happens'), 'say exactly what happens');
    t.equal('emojis are held to two', (tidy('Great call 🎉 nice 👍 keep it up 💪 really 🌟').match(/\p{Extended_Pictographic}/gu) || []).length, 2);

    const verint = sliceFunction('buildCallListeningVerintSummary');
    t.equal('the Verint note is tidied both ways out', (verint.match(/return tidy\(\[/g) || []).length, 2);
});

suite('call smoke fixes: a confirmed red flag reads as settled', (t) => {
    const mods = loadCallModules(t);
    const labelled = NAME_ONLY_TURNS.map(([at, said], i) => `${at}\n${i % 2 ? 'Customer' : 'Agent'}: ${said}`).join('\n');
    const analysis = mods.callTranscript.analyzeTranscript(labelled, { associateName: 'Alyssa Dimes' });
    const record = mods.callListening.redFlagRecord(analysis);
    t.check('the call has a name-only red flag', Boolean(record?.items?.length));

    t.check('the listen box still asks how the call came in', /check how the call came in/.test(record.items[0].detail));
    const documented = mods.callListening.redFlagLines(record).join('\n');
    t.check('the documented note does not', !/check how the call came in/.test(documented));
    t.check('it says the call did not come in authorized', /did not come in authorized/.test(documented));
});
