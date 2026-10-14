'use strict';

/**
 * EVERY PIECE OF FEEDBACK HAS PRAISE IN IT
 *
 * Scott, 2026-10-14: "Make sure to, in every piece of feedback. From the
 * calls, to the metrics, but focus on calls too. Make sure to provide
 * positive feedback."
 *
 * What was wrong on the call side: the transcript rules praise only the
 * behaviours they recognise, so a hard call read with five things to work on
 * and an empty "what went well". The Copilot prompts then sent "- None" next
 * to "use only my notes", and the email the app writes opened "There are a
 * few things I want to go through with you" with nothing kind in it.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function load(t, options = {}) {
    t.installFakeBrowser();
    global.getMetricTips = () => [];
    global.window.METRICS_REGISTRY = { aht: { label: 'Average Handle Time' } };
    global.window.formatMetricDisplay = (key, value) => String(value);
    if (options.wordChoice) t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-verification.module.js');
    t.loadModule('modules/call-explanation.module.js');
    t.loadModule('modules/call-red-flags.module.js');
    t.loadModule('modules/call-summary.module.js');
    if (options.wordChoice) t.loadModule('modules/call-word-choice.module.js');
    t.loadModule('modules/call-coaching-bridge.module.js');
    t.loadModule('modules/call-trends.module.js');
    t.loadModule('modules/call-listening.module.js');
    return global.window.DevCoachModules;
}

function entry(extra) {
    return Object.assign({
        employeeName: 'Alyssa Dimes',
        listenedOn: '2026-09-04',
        callTime: '11:26 AM',
        callReference: 'INT-4471',
        transcript: '',
        whatWentWell: '',
        improvementAreas: '',
        oscarUrl: '',
        relevantInfo: '',
        managerNotes: ''
    }, extra || {});
}

// Nothing the rules praise: no greeting, a flat no, nothing resolved.
const ROUGH_CALL = [
    'Agent: Yeah, what do you need?',
    'Customer: My bill is too high this month.',
    'Agent: That is just our policy, there is nothing I can do about it.',
    'Customer: Okay.'
].join('\n');

// A branded open and nothing else the rules name, but the job got done.
const DONE_CALL = [
    'Agent: Thank you for calling APS, my name is Jamie.',
    'Customer: I need to change my mailing address.',
    'Agent: Sure, what is the new address?',
    'Customer: It is the one on Main Street.',
    'Agent: Okay, you are all set, that has been updated.'
].join('\n');

// Polite the whole way through, and nothing else the rules name.
const POLITE_CALL = [
    'Agent: Hi there.',
    'Customer: I have a question about the app.',
    'Agent: Of course, please go ahead.',
    'Customer: Where do I see my usage?',
    'Agent: It is under the usage tab. Thank you for asking.',
    'Customer: Got it.',
    'Agent: You are welcome.'
].join('\n');

const keys = (items) => (items || []).map(item => item.key);

suite('praise floor: a hard call still has something good in it', (t) => {
    const { callTranscript: T } = load(t);

    const rough = T.analyzeTranscript(ROUGH_CALL);
    t.check('the rules found nothing to praise, so the floor did', rough.allStrengths.length >= 1);
    t.check('and with nothing true to point at, it says thank you', keys(rough.allStrengths).includes('thanks'));
    t.equal('in the words that claim nothing', rough.allStrengths[0].text, T.GENERIC_PRAISE);
    t.check('the draft is never empty', T.buildStrengthsDraft(rough).length > 0);
    t.check('a flat no is not praised as keeping the customer calm',
        !keys(rough.allStrengths).includes('calmCustomer'));
    t.check('the coaching is still all there', keys(rough.allImprovements).includes('deflection'));
});

suite('praise floor: what it says is true of the call', (t) => {
    const { callTranscript: T } = load(t);

    const done = T.analyzeTranscript(DONE_CALL);
    t.check('the open is earned', keys(done.allStrengths).includes('greeting'));
    t.check('and getting it done is named', keys(done.allStrengths).includes('resolved'));
    t.check('quoting the moment', /all set/i.test(done.allStrengths.find(item => item.key === 'resolved').quote));
    t.check('a real strength leads', done.allStrengths[0].key === 'greeting');
    t.check('no thank you when there is something real to say', !keys(done.allStrengths).includes('thanks'));

    const polite = T.analyzeTranscript(POLITE_CALL);
    t.check('courtesy beyond the greeting is named', keys(polite.allStrengths).includes('courtesy'));

    // The greeting's own "thank you for calling" is on every call and is
    // not courtesy worth naming on its own.
    const greetingOnly = T.analyzeTranscript([
        'Agent: Thank you for calling APS.',
        'Customer: What is my due date?',
        'Agent: The twelfth.'
    ].join('\n'));
    t.check('a greeting alone is not counted as courtesy', !keys(greetingOnly.allStrengths).includes('courtesy'));
});

suite('praise floor: it tops up, it never inflates', (t) => {
    const { callTranscript: T } = load(t);

    const done = T.analyzeTranscript(DONE_CALL);
    t.check('two strengths at most from the floor', done.allStrengths.filter(item => item.floor).length <= 1);
    t.equal('a floor strength never earns a headline', done.headline, '');

    // A call the rules already praise twice is left alone.
    const strong = T.analyzeTranscript([
        'Agent: Thank you for calling APS, my name is Jamie.',
        'Customer: My bill doubled and I do not know why.',
        'Agent: I completely understand, let me take care of that for you.',
        'Agent: You are all set.'
    ].join('\n'));
    t.check('earned strengths are not topped up', !strong.allStrengths.some(item => item.floor));
});

suite('praise floor: a timed call with no long quiet says so', (t) => {
    const { callTranscript: T } = load(t);
    const fixture = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'verint-export.txt'), 'utf8');
    const analysis = T.analyzeTranscript(fixture, { associateName: 'Alyssa Dimes' });
    t.check('the real export still has strengths', analysis.allStrengths.length >= 2);
    t.check('and every one has words in it', analysis.allStrengths.every(item => String(item.text || '').trim()));
});

suite('praise floor: a phrase off the Verint list is praised in her words', (t) => {
    const { callTranscript: T } = load(t, { wordChoice: true });
    const analysis = T.analyzeTranscript([
        'Agent: Hey.',
        'Customer: I want to set up autopay.',
        'Agent: I would be happy to help you with that.',
        'Customer: Thanks.'
    ].join('\n'));
    const phrase = analysis.allStrengths.find(item => item.key === 'scoredPhrase');
    t.check('the scored phrase is named', Boolean(phrase));
    t.check('as she said it', phrase && /"[^"]*happy to help[^"]*"/i.test(phrase.text));
});

suite('praise floor: the copy reads like a person', (t) => {
    const { callTranscript: T } = load(t, { wordChoice: true });
    const lines = [];
    [ROUGH_CALL, DONE_CALL, POLITE_CALL].forEach((call) => {
        T.analyzeTranscript(call).allStrengths.filter(item => item.floor).forEach(item => lines.push(item.text));
    });
    lines.push(T.GENERIC_PRAISE);

    t.check('there are floor lines to check', lines.length >= 3);
    t.check('no em dashes', !lines.some(line => /[—–]/.test(line)));
    t.check('nothing claims one call of several', !lines.some(line => /on this (?:one|call)| here[.,]|this time/i.test(line)));
    t.check('to her, not about her', !lines.some(line => /\b(the associate|the advisor|the agent|the rep)\b/i.test(line)));
    t.check('no report labels', !lines.some(line => /^[A-Z][A-Za-z]*(?: [a-z]+){0,2}:\s/.test(line)));
});

suite('praise floor: a thank you is not a habit', (t) => {
    const { callCoachingBridge: bridge, callTrends: trends, callTranscript: T } = load(t);
    const history = [1, 2, 3].map((n) => ({
        employeeName: 'Alyssa Dimes',
        listenedOn: `2026-09-0${n}`,
        callTime: '10:00 AM',
        transcript: `${ROUGH_CALL}
Customer: That was call number ${['one', 'two', 'three'][n - 1]}.`
    }));
    t.check('three calls were read', bridge.collectFindings({ history }).callsReviewed === 3);
    const summary = bridge.collectFindings({ history, associateName: 'Alyssa Dimes' });
    t.check('the generic thank you is not a consistent strength',
        !(summary.consistentStrengths || []).some(row => row.label === 'thanks'));
    t.check('or a praise line in the metric message', !(summary.praise || []).includes(T.GENERIC_PRAISE));

    ['scoredPhrase', 'resolved', 'calmCustomer', 'keptMoving', 'courtesy'].forEach((key) => {
        t.check(`the trends panel has words for ${key}`, Boolean(trends.STRENGTH_LABELS[key]));
    });
});

suite('call prompts: praise is required, never "- None"', (t) => {
    const { callListening: api } = load(t);
    const bare = entry({ transcript: ROUGH_CALL, improvementAreas: '- Tell them what you can do.' });

    const summary = api.buildCoachingSummaryPrompt(bare);
    t.check('summary: an empty what went well is not sent as None',
        !/My notes on what went well:\n- None/.test(summary));
    t.check('summary: "What went well:" is never left empty', /"What went well:" is never left empty/.test(summary));
    t.check('summary: and Copilot is pointed at the call for it', /did well that the transcript shows/.test(summary));

    const email = api.buildEmailFromSummaryPrompt(bare, 'Alyssa');
    t.check('email: an empty what went well is not sent as None', !/What went well:\n- None/.test(email));
    t.check('email: praise is required', /The email always has praise in it/.test(email));
    t.check('email: the email prompt has no transcript, so it is not pointed at one',
        !/transcript shows/.test(email));

    const fromSummary = api.buildEmailFromSummaryPrompt(entry({
        copilotSummary: 'What to work on: tell them what you can do.'
    }), 'Alyssa');
    t.check('email from a write-up: a write-up with no praise still gets some',
        /If my write-up names nothing that went well, thank them sincerely/.test(fromSummary));

    const legacy = api.buildPrompt(bare, 'Alyssa');
    t.check('legacy prompt: not "None provided"', !/What went well:\n- None provided/.test(legacy));
    t.check('legacy prompt: praise is required', /The message always has praise in it/.test(legacy));

    const noCall = api.buildCoachingSummaryPrompt(entry({ improvementAreas: '- Slow down.' }));
    t.check('with no transcript, the fallback is a thank you', /thank them sincerely for the effort/.test(noCall)
        && !/transcript shows/.test(noCall));
});

suite('call email: the app\'s own email always says something kind', (t) => {
    const { callListening: api } = load(t);

    const work = api.buildCallFeedbackMessage(entry({ improvementAreas: '- Slow down on discovery.' }));
    t.check('notes with only work points still thank her', /Thank you for the effort you put in with this customer\./.test(work));
    t.check('before the coaching', work.indexOf('Thank you for the effort') < work.indexOf('Slow down'));
    t.check('and the count still reads right', /There is one thing I want to go through with you/.test(work));

    const mixed = api.buildCallFeedbackMessage(entry({
        whatWentWell: '- Great ownership.',
        improvementAreas: '- Slow down on discovery.'
    }));
    t.check('praise notes are used as written, with no extra thank you', !/Thank you for the effort/.test(mixed)
        && /Great ownership/.test(mixed));
});
