'use strict';

/**
 * Saying what happened on the call.
 *
 * Written for the associate to read, so it sits at the top of a coaching
 * message and they know which conversation is being discussed before they
 * reach the feedback.
 *
 * There is no model in this app, so nothing may be invented. Every sentence
 * has to come from the transcript or the Verint header, and anything that
 * cannot be established is left out rather than guessed at.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const VERINT_EXPORT = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'verint-export.txt'), 'utf8');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-summary.module.js');
    return global.window.DevCoachModules;
}

const NEW_SERVICE = [
    'Agent: Thank you for calling, my name is Jamie.',
    'Customer: Hi, I just moved into a new apartment and I need to set up service in my name.',
    'Agent: Happy to help. Can you confirm your date of birth for verification?',
    'Customer: Sure, it is May 4th 1983.',
    'Agent: We have three plans available. The first plan is the standard rate.',
    'Agent: Based on your usage I would recommend the time of use plan.',
    'Customer: That sounds good to me.',
    'Agent: Your service is set up. You can also check usage on the app.',
    'Customer: You have been very helpful, thank you so much.'
].join('\n');

const UNRESOLVED = [
    'Agent: Thanks for calling, Jamie speaking.',
    'Customer: My power has been out since this morning and nobody has told me anything.',
    'Customer: This is ridiculous, I want to speak to a supervisor.',
    'Agent: Someone will call you back about that.'
].join('\n');

suite('call summary: what the call was about', (t) => {
    const { callSummary } = load(t);

    const newService = callSummary.summarizeCall(NEW_SERVICE, { associateName: 'Jamie' });
    t.equal('a new service call is recognised', newService.topic, 'starting new service');

    const outage = callSummary.summarizeCall(UNRESOLVED, { associateName: 'Jamie' });
    t.equal('an outage is recognised', outage.topic, 'an outage');

    // The real export was the case that got this wrong. Verint fires Bill
    // Inquiries, High Bill, Payment Options, Rate Migration and Service Plans
    // on it all at once, but the customer's first line is about a new
    // apartment. The categories are every subject raised, not the reason.
    const verint = callSummary.summarizeCall(VERINT_EXPORT, { associateName: 'Alyssa Dimes' });
    t.equal('the reason for the call beats the category list', verint.topic, 'starting new service');

    // A call about nothing recognisable says nothing about the subject rather
    // than picking the nearest guess.
    const vague = callSummary.summarizeCall([
        'Agent: Thank you for calling, my name is Jamie.',
        'Customer: I had a question about something on my account here.',
        'Agent: Let me take a look for you.'
    ].join('\n'), { associateName: 'Jamie' });
    t.equal('an unrecognised subject is left blank', vague.topic, '');
    // Checked on the opening sentence only: the quoted customer line happens
    // to contain the word "about", which is not the same as claiming a subject.
    const firstSentence = callSummary.buildSummaryText(vague).split('.')[0];
    t.check('and the recap simply omits it', !/ about /.test(firstSentence));
    t.check('while still describing the call', /call$/.test(firstSentence));
});

suite('call summary: what was said and done', (t) => {
    const { callSummary } = load(t);
    const summary = callSummary.summarizeCall(NEW_SERVICE, { associateName: 'Jamie' });

    t.check('the customer opening is quoted', /just moved into a new apartment/.test(summary.openingAsk));

    const keys = summary.actions.map(action => action.key);
    t.check('verification is spotted', keys.includes('verified'));
    t.check('offering the options is spotted', keys.includes('options'));
    t.check('the recommendation is spotted', keys.includes('recommended'));
    t.check('setting up the service is spotted', keys.includes('setUpService'));
    t.check('actions follow the order of the call', keys.indexOf('verified') < keys.indexOf('setUpService'));

    t.check('the call reads as resolved', summary.resolved === true);
    t.check('and not left open', summary.leftOpen === false);
    t.check('the customer thank you is captured', /very helpful/.test(summary.appreciation));

    const rough = callSummary.summarizeCall(UNRESOLVED, { associateName: 'Jamie' });
    t.check('an escalation request is captured', rough.escalated === true);
    t.check('and it reads as left open', rough.leftOpen === true);
    t.check('with no invented thank you', rough.appreciation === '');
});

suite('call summary: how it reads', (t) => {
    const { callSummary } = load(t);
    const summary = callSummary.summarizeCall(VERINT_EXPORT, { associateName: 'Alyssa Dimes' });
    const agentVoice = callSummary.buildSummaryText(summary);

    t.check('it speaks to the associate', /\bYou \w/.test(agentVoice));
    t.check('it names the length', /18 minute call/.test(agentVoice));
    t.check('and gets the article right', agentVoice.startsWith('An 18 minute call'));
    t.check('it names when the call was', /Tuesday, August 4 at 12:38 PM/.test(agentVoice));
    t.check('it quotes the customer', /The customer opened with: "/.test(agentVoice));
    t.check('no em dashes', !/[—–]/.test(agentVoice));
    t.check('no double spaces', !/ {2}/.test(agentVoice));
    t.check('no leftover template tokens', !/\{|\}/.test(agentVoice));

    // The supervisor reads the same recap about somebody else, and the roster
    // is people whose pronouns this app has never been told.
    const supervisorVoice = callSummary.buildSummaryText(summary, { voice: 'supervisor' });
    t.check('the supervisor view is third person', /\bThey \w/.test(supervisorVoice));
    t.check('with no gendered pronouns', !/\b(she|her|hers|he|him|his)\b/i.test(supervisorVoice));
    t.check('and it is not second person', !/\bYou \w/.test(supervisorVoice));

    // An unlabelled transcript is scanned on inferred roles, and says so.
    // Supervisor only: telling the associate their recap might have
    // misattributed a line undermines the message and gives them nothing to do.
    t.check('the agent is not told how the parsing went', !/sides were worked out/.test(agentVoice));
    t.check('but the supervisor is', /sides were worked out from the flow/.test(supervisorVoice));

    const labelled = callSummary.summarizeCall(NEW_SERVICE, { associateName: 'Jamie' });
    t.equal('a labelled transcript needs no caveat', labelled.attribution, 'labeled');
    t.check('so none is added', !/sides were worked out/.test(callSummary.buildSummaryText(labelled)));
});

suite('call summary: grammar that would give it away', (t) => {
    const { callSummary } = load(t);

    // "a 18 minute call" is the kind of thing that tells the reader a machine
    // wrote it. Eight, eleven, eighteen and the eighties take "an".
    const article = (minutes) => callSummary.buildSummaryText({
        ok: true, attribution: 'labeled', moment: '', durationLabel: '',
        lengthPhrase: `${minutes} minute`, topic: '', openingAsk: '', actions: [],
        silence: { holdCount: 0, deadAirCount: 0, longestHold: null, longestDeadAir: null },
        resolved: false, leftOpen: false, escalated: false, appreciation: '', turns: 0
    }).split(' ')[0];

    t.equal('5 takes a', article(5), 'A');
    t.equal('8 takes an', article(8), 'An');
    t.equal('11 takes an', article(11), 'An');
    t.equal('18 takes an', article(18), 'An');
    t.equal('12 takes a', article(12), 'A');
    t.equal('80 takes an', article(80), 'An');
    t.equal('21 takes a', article(21), 'A');
});

suite('call summary: nothing to summarize', (t) => {
    const { callSummary } = load(t);

    t.equal('an empty transcript reports why', callSummary.summarizeCall('').reason, 'empty');
    t.equal('and produces no text', callSummary.buildSummaryText({ ok: false }), '');
    t.equal('and no html', callSummary.buildSummaryHtml({ ok: false }, (v) => v), '');
    t.equal('a missing summary is handled', callSummary.buildSummaryText(null), '');
});

suite('call summary: wiring', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const listening = fs.readFileSync(path.join(ROOT, 'modules/call-listening.module.js'), 'utf8');
    const bridge = fs.readFileSync(path.join(ROOT, 'modules/call-coaching-bridge.module.js'), 'utf8');

    t.check('the module is in the loader', html.includes('modules/call-summary.module.js'));
    t.check('it loads after the transcript parser it reads',
        html.indexOf('modules/call-summary.module.js') > html.indexOf('modules/call-transcript.module.js'));

    t.check('there is a panel for it', html.includes('id="callSummaryPanel"'));
    t.check('it renders when a transcript is analyzed', script.includes('renderCallSummaryPanel(transcript'));
    t.check('the panel speaks to the agent',
        /function renderCallSummaryPanel[\s\S]{0,900}buildSummaryHtml\?\.\(summary, escapeHtml\)/.test(script));

    // The supervisor reading a saved call is reading about somebody else.
    t.check('the saved call view uses the supervisor voice',
        /function buildSavedCallDetailHtml[\s\S]{0,3000}voice: 'supervisor'/.test(script));

    t.check('the recap opens the written message', bridge.includes('options.summaryText'));
    t.check('and the message puts it before the feedback',
        /recap \? \[recap, ''\] : \[\]/.test(bridge));
    t.check('the written message is given the recap', script.includes('summaryText'));
    // Saying "there was one hold" and then coaching that hold in detail is one
    // fact twice in a message of eight lines.
    t.check('the recap drops silence the findings already cover',
        /coachingSilence[\s\S]{0,300}omitSilence: coachingSilence/.test(script));

    t.check('the Copilot prompt carries a recap', listening.includes('My recap of the call:'));
    t.check('the Verint note carries one too', script.includes("'Call summary:'"));
});

suite('call summary: not saying the same thing twice', (t) => {
    const { callSummary } = load(t);
    const summary = callSummary.summarizeCall(VERINT_EXPORT, { associateName: 'Alyssa Dimes' });

    const full = callSummary.buildSummaryText(summary);
    t.check('the recap normally mentions the hold', /There was one hold/.test(full));

    const trimmed = callSummary.buildSummaryText(summary, { omitSilence: true });
    t.check('and drops it on request', !/There was one hold/.test(trimmed));
    t.check('along with the dead air', !/stretch of quiet/.test(trimmed));

    // Everything else has to survive, or the recap stops being a recap.
    t.check('the length survives', /18 minute call/.test(trimmed));
    t.check('the subject survives', /starting new service/.test(trimmed));
    t.check('the customer opening survives', /The customer opened with/.test(trimmed));
    t.check('the outcome survives', /It ended sorted/.test(trimmed));
});
