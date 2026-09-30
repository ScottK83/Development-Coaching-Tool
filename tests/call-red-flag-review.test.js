'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * LISTEN FIRST, THEN DOCUMENT IT IN FULL
 *
 * Scott: "if there are major red flags, like didn't authenticate or verify,
 * I need to know. Like if they launch into explaining the account without
 * verifying, or if the person says something like, I'm not on the account...
 * Flag me to actually listen to the call and in the email summary, if it's
 * valid, it needs to be heavily documented."
 *
 * And, the same day, on the email: "want more so in the form of what can do
 * better. Tips. Tricks. Etc. Also, I want to be able to post relevant Oscar
 * steps, and have that generated in the summary for the email."
 */

function load(t, tips) {
    t.installFakeBrowser();
    global.getMetricTips = (metricKey) => (tips && tips[metricKey]) || [];
    global.window.METRICS_REGISTRY = {};
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-verification.module.js');
    t.loadModule('modules/call-explanation.module.js');
    t.loadModule('modules/call-red-flags.module.js');
    t.loadModule('modules/call-summary.module.js');
    t.loadModule('modules/call-coaching-bridge.module.js');
    t.loadModule('modules/call-listening.module.js');
    return global.window.DevCoachModules;
}

// Account details to somebody who said it was not their account, never
// verified: the case Scott named.
const NOT_ON_THE_ACCOUNT = [
    '00:03', 'Agent: thank you for calling aps my name is jamie how can i help',
    '00:09', 'Customer: hi i am calling about my mom\'s account she got a shut off notice',
    '00:15', 'Agent: okay can i have the address on the account',
    '00:20', 'Customer: it is twelve main street',
    '00:26', 'Agent: okay i do see a past due amount of two hundred dollars on the account',
    '00:40', 'Customer: okay thank you',
    '00:44', 'Agent: is there anything else i can help with'
].join('\n');

const CLEAN = [
    '00:03', 'Agent: thank you for calling aps my name is jamie how can i help',
    '00:09', 'Customer: my power is out',
    '00:14', 'Agent: i am sorry to hear that a crew is already on it and it should be back by three',
    '00:30', 'Customer: great thank you'
].join('\n');

function entryFor(transcript, extra) {
    return Object.assign({
        employeeName: 'Jamie Rivera',
        listenedOn: '2026-09-29',
        callTime: '10:14 AM',
        transcript,
        whatWentWell: '- Clean open.',
        improvementAreas: '- Verify first.',
        copilotSummary: '',
        relevantInfo: '',
        oscarUrl: '',
        redFlagReview: ''
    }, extra || {});
}

suite('red flag review: what the listen box is built from', (t) => {
    const { callTranscript: T, callListening: L } = load(t);

    const record = L.redFlagRecord(T.analyzeTranscript(NOT_ON_THE_ACCOUNT, { associateName: 'Jamie' }));
    t.check('the call has a red flag record', Boolean(record) && record.items.length >= 1);

    const item = record.items[0];
    t.check('headed the way the verification read says it', /shared/.test(item.headline));
    t.check('with the time to listen at', /^\d+:\d{2}$/.test(item.time));
    t.check('and every moment, in order, with what was said', item.timeline.length >= 2 && item.timeline.every(row => row.text));
    t.check('the rule is the plain one, never the unconfirmed list of identifiers',
        /nothing on it is shared unless they are authorized|Verify the caller before anything/.test(item.rule)
        && !/last four|date of birth|PIN|passcode/i.test(item.rule));

    const lines = L.redFlagLines(record);
    t.check('it writes out as lines for the note', lines.some(line => /^- \d+:\d{2} /.test(line)) && lines.some(line => /^The rule: /.test(line)));

    t.equal('a clean call has none', L.redFlagRecord(T.analyzeTranscript(CLEAN, { associateName: 'Jamie' })), null);
});

suite('red flag review: documented in full only once Scott confirms it', (t) => {
    const { callTranscript: T, callListening: L } = load(t);
    const stored = T.prepareForStorage(NOT_ON_THE_ACCOUNT);

    const confirmed = entryFor(stored, { redFlagReview: 'valid' });
    const summary = L.buildCoachingSummaryPrompt(confirmed);
    const email = L.buildEmailFromSummaryPrompt(confirmed, 'Jamie');

    [['the summary prompt', summary], ['the email prompt', email]].forEach(([name, prompt]) => {
        t.check(`${name} says it was listened to and confirmed`, /I listened to it myself and it is confirmed/.test(prompt));
        t.check(`${name} carries the moments with their times`, /\n- 0:\d{2} /.test(prompt));
        t.check(`${name} carries the rule`, /The rule: /.test(prompt));
        t.check(`${name} does not let it be softened`, /not softened|Do not soften it/.test(prompt));
        t.check(`${name} keeps "red flag" out of what the associate reads`, /Do not use the words "red flag"/.test(prompt));
        t.check(`${name} masks the numbers read out`, !/twelve main street/.test(prompt) || /\[number\]/.test(prompt));
    });
    t.check('the summary puts it first', /Put the confirmed issue first, under "Most important:"/.test(summary));
    t.check('the email puts it straight after the opening line', /Straight after the opening line, set out the confirmed issue in full/.test(email));

    ['', 'dismissed'].forEach((review) => {
        const entry = entryFor(stored, { redFlagReview: review });
        const label = review || 'unanswered';
        t.check(`${label}: nothing about it in the summary prompt`, !/it is confirmed/.test(L.buildCoachingSummaryPrompt(entry)));
        t.check(`${label}: nor in the email prompt`, !/it is confirmed/.test(L.buildEmailFromSummaryPrompt(entry, 'Jamie')));
    });
});

suite('red flag review: the page makes Scott listen', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const body = (name) => {
        const start = script.indexOf(`function ${name}(`);
        const next = script.indexOf('\nfunction ', start + 10);
        return start < 0 ? '' : script.slice(start, next < 0 ? undefined : next);
    };

    t.check('the box asks to listen, with the time to start at', /Listen to this call before anything goes out/.test(script));
    t.check('with the two answers', /data-red-flag-review="valid"/.test(script) && /data-red-flag-review="dismissed"/.test(script));
    t.check('and a way to change the answer', /data-red-flag-review="">Change</.test(script));
    t.check('the answers are wired',
        /bindElementOnce\(document\.getElementById\('callFlagStrip'\), 'click', handleCallFlagStripClick\)/.test(script));

    // Until it is answered, nothing goes out.
    ['writeCallSummaryInCopilot', 'writeCallEmailInCopilot', 'copyCallListeningVerintSummary'].forEach((name) => {
        t.check(`${name} waits for the answer`, /if \(redFlagNeedsListening\(\)\) return;/.test(body(name)));
    });
    t.check('and says where to listen', /Listen to the call first\$\{first \? ` at \$\{first\.time\}` : ''\}/.test(body('redFlagNeedsListening')));

    // The answer is saved with the call and used everywhere.
    t.check('saved with the call', /redFlagReview: callRedFlagRecord \? callRedFlagReview : ''/.test(script));
    t.check('part of what makes two saves the same', /existingEntry\.redFlagReview \|\| ''\) === \(draft\.redFlagReview \|\| ''\)/.test(script));
    t.check('brought back when a saved call is loaded', /pendingRedFlagReview = entry\.redFlagReview \|\| '';/.test(script));
    t.check('forgotten when a new call is pasted', /\/\/ A new call's red flag is a new question\.\s*callRedFlagRecord = null;\s*callRedFlagReview = '';/.test(script));

    // Set aside: out of the notes.
    const click = body('handleCallFlagStripClick');
    t.check('setting it aside takes its line out of What to work on', /next === 'dismissed'[\s\S]{0,300}callRedFlagRemovedLines = lines\.filter/.test(click));
    t.check('and changing the answer puts it back', /callRedFlagReview === 'dismissed' && callRedFlagRemovedLines\.length/.test(click));

    // The Verint note: in full when confirmed, not at all when set aside.
    const verint = body('buildCallListeningRedFlagLines');
    t.check('the Verint note leaves out a flag set aside', /if \(entry\.redFlagReview === 'dismissed'\) return \[\];/.test(verint));
    t.check('and documents a confirmed one in full', /Red flag, confirmed after listening to the call:/.test(verint) && /redFlagLines/.test(verint));
});

suite('red flag review: a flag set aside stops counting everywhere', (t) => {
    const listening = fs.readFileSync(path.join(ROOT, 'modules/call-listening.module.js'), 'utf8');
    const bridge = fs.readFileSync(path.join(ROOT, 'modules/call-coaching-bridge.module.js'), 'utf8');

    t.check('the history row drops its red tag', /if \(entry\.redFlagReview === 'dismissed'\) return false;/.test(listening));
    t.check('the trends stop counting it', /analysis\.verification\?\.redFlag && !setAside/.test(bridge));
    t.check('and stop coaching it', /if \(setAside && item\.severity === 'red'\) return;/.test(bridge));
});

suite('tips and tricks: from the library, fitted to the call', (t) => {
    const tips = {
        fcr: [
            'Before you explain, ask what they already know about it so you start where they are.',
            'Use their own numbers, not the rate, when you explain a change on the bill.',
            'Keep your nails trimmed.'
        ],
        cxRepOverall: [
            'Break a long explanation into two short pieces and check the first one landed before the second.',
            'Smile while you talk.'
        ]
    };
    const { callCoachingBridge: bridge, callTranscript: T, callListening: L } = load(t, tips);

    const chosen = bridge.tipsForCall([{ key: 'explanation' }], { max: 5, perFinding: 2 });
    t.check('tips come back for a point the library covers', chosen.length >= 1);
    t.check('only ones that fit the point', chosen.every(tip => !/nails|Smile/.test(tip.text)));
    t.check('no more than asked for per point', chosen.length <= 2);
    t.equal('nothing for a point the library has no fit for', bridge.tipsForCall([{ key: 'greeting' }], { max: 5 }).length, 0);
    t.equal('nothing for nothing', bridge.tipsForCall([], {}).length, 0);

    // A call where the customer got lost, so there is an explanation point.
    const lost = [
        '00:03', 'Agent: thank you for calling aps my name is jamie how can i help',
        '00:09', 'Customer: my budget billing amount changed',
        '00:15', 'Agent: the levelized amount had a true up against the deferred balance',
        '00:30', 'Customer: wait so i still have to pay the whole thing',
        '00:34', 'Agent: the levelized amount had a true up against the deferred balance so it changed',
        '00:44', 'Customer: i\'m still confused'
    ].join('\n');
    const analysis = T.analyzeTranscript(lost, { associateName: 'Jamie' });
    const entry = entryFor(T.prepareForStorage(lost), {
        improvementAreas: T.buildImprovementsDraft(analysis)
    });

    const summary = L.buildCoachingSummaryPrompt(entry);
    t.check('the summary prompt carries the library tips', /Tips from our own coaching library that fit this call/.test(summary) && /their own numbers|two short pieces|already know/.test(summary));
    t.check('and asks for a tips section', /"Tips to try:" with three to five practical tips or tricks/.test(summary));
    const email = L.buildEmailFromSummaryPrompt(entry, 'Jamie');
    t.check('the email prompt carries them too', /Tips from our own coaching library that fit this call/.test(email));
});

suite('tips and tricks: never offered for a red flag', (t) => {
    // Caught on the first run in the browser: the verification finding's
    // "verif" matched this, and it sat beside account details given to the
    // wrong caller as if it were the fix.
    const { callTranscript: T, callListening: L } = load(t, {
        cxRepOverall: ['Verify contact info at end of call. Updates prevent future miscalls']
    });
    const analysis = T.analyzeTranscript(NOT_ON_THE_ACCOUNT, { associateName: 'Jamie' });
    const entry = entryFor(T.prepareForStorage(NOT_ON_THE_ACCOUNT), {
        improvementAreas: T.buildImprovementsDraft(analysis),
        redFlagReview: 'valid'
    });

    t.check('the call does have a red point', analysis.allImprovements.some(item => item.severity === 'red'));
    t.equal('but no tip comes back for it', L.tipsForEntry(entry, analysis).length, 0);
    t.check('and none reaches the prompt', !/Verify contact info/.test(L.buildCoachingSummaryPrompt(entry)));
});

suite('Oscar steps: pasted once, in the summary and the email', (t) => {
    const { callTranscript: T, callListening: L } = load(t);
    const steps = '1. Open the budget billing tab\n2. Check the account is current\n3. Quote the new amount and the review month';
    const entry = entryFor(T.prepareForStorage(CLEAN), { relevantInfo: steps, oscarUrl: 'https://oscar.example/budget-billing' });

    const summary = L.buildCoachingSummaryPrompt(entry);
    t.check('the summary prompt carries the steps as given', summary.includes(steps));
    t.check('and asks for an Oscar section, not added to', /"Oscar steps:" with the steps that apply/.test(summary) && /do not add to them/.test(summary));
    t.check('with the link', /Link to the Oscar article: https:\/\/oscar\.example\/budget-billing/.test(summary));

    const email = L.buildEmailFromSummaryPrompt(entry, 'Jamie');
    t.check('the email prompt carries them too', email.includes(steps));
    t.check('as a short numbered list with the link', /Oscar steps as a short numbered list/.test(email) && /include the link/.test(email));

    const none = L.buildCoachingSummaryPrompt(entryFor(T.prepareForStorage(CLEAN)));
    t.check('no steps, no Oscar section asked for', !/Oscar steps/.test(none));

    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    t.check('the box is on the page, labelled for what it is', /for="callListeningRelevantInfo">📘 Oscar steps/.test(html));
    t.check('between the notes and the summary button',
        html.indexOf('id="callListeningImprovements"') < html.indexOf('id="callListeningRelevantInfo"')
        && html.indexOf('id="callListeningRelevantInfo"') < html.indexOf('id="callCopilotSummaryBtn"'));
});
