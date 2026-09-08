'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * HANDING THE CALL TO COPILOT
 *
 * The rules in call-transcript are good at what was said and poor at what the
 * call was about. There is no model in this app and there does not need to be
 * one, because Copilot is already open on the same desk.
 *
 * Two things this prompt has to get right or it is worse than nothing. It has
 * to read as a request to summarise a conversation rather than to score a
 * named employee, because the second one is refused outright. And it has to
 * leave the customer's numbers behind, because a customer reads her social,
 * her account and her phone number aloud on these calls and this prompt goes
 * off the page.
 */

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/sentiment.module.js');
    return t.loadModule('modules/call-transcript.module.js').callTranscript;
}

const CALL = [
    '00:01',
    'well make s is robert speaking how can i help you',
    '00:05',
    'hi robert this is sheryl ross and i am calling about my bill',
    '00:16',
    'alright and for security purposes can you please verify the last four digits of your social',
    '00:27',
    'four six four five',
    '00:29',
    'thank you very much for verifying that and how may i help you',
    '00:34',
    'well i got my bill the august statement and i really do not understand it if you look at my usage',
    '00:43',
    'okay let me pull up your account',
    '01:56',
    'my email is sheryl dot ross at gmail dot com and my number is 602 555 0134'
].join('\n');

suite('call summary prompt: the numbers do not leave with it', (t) => {
    const callTranscript = load(t);
    const prompt = callTranscript.buildCallSummaryPrompt(CALL);

    // Said aloud, which is how a transcript records it. This is the last four
    // of a social security number and it must not go off the page.
    t.check('spelled out digits are masked', prompt.indexOf('four six four five') === -1);
    t.check('and replaced with something readable', prompt.indexOf('[number]') > -1);
    t.check('digits as digits are masked too', prompt.indexOf('602 555 0134') === -1);
    t.check('an email is masked', prompt.indexOf('gmail.com') === -1 && prompt.indexOf('[email]') > -1);

    // Masking must not eat the call. Everything that says what happened stays.
    t.check('the reason for the call survives', /do not understand/.test(prompt));
    t.check('and so does what was done about it', /pull up your account/.test(prompt));

    // Ordinary numbers in speech are not identifiers.
    const plain = callTranscript.maskIdentifiers('it went up by five dollars last month');
    t.equal('a number in a sentence is left alone', plain, 'it went up by five dollars last month');
});

suite('call summary prompt: it asks for a summary, not a verdict', (t) => {
    const callTranscript = load(t);
    const prompt = callTranscript.buildCallSummaryPrompt(CALL, { associateName: 'Robert Berrelleza' });

    // A prompt that reads as scoring a named employee is refused outright, and
    // a refusal in front of somebody is worse than never offering the button.
    t.check('it says the review is already done', /review itself is already done/.test(prompt));
    t.check('it says no assessment is wanted',
        /not asking you to assess, score or rate anybody/.test(prompt));
    t.check('it says so again in the instructions',
        /do not name the agent and do not\s+comment on how well they did/i.test(prompt.replace(/\n/g, ' ')));

    // The associate is passed in and still never appears. Naming her buys the
    // summary nothing.
    t.check('the associate is never named', prompt.indexOf('Berrelleza') === -1);
    t.check('nor her first name', prompt.indexOf('Robert Berrelleza') === -1);
});

suite('call summary prompt: it is honest about the labels', (t) => {
    const callTranscript = load(t);

    // Roles on an unlabelled call are worked out, and a summary built on a
    // wrong side is confidently wrong. Copilot is told which it is holding.
    const inferred = callTranscript.buildCallSummaryPrompt(CALL);
    t.check('an inferred call says the labels were worked out',
        /worked out from the conversation/.test(inferred));
    t.check('and invites a correction rather than a build on top',
        /say so rather than building on it/.test(inferred));

    const labelled = callTranscript.buildCallSummaryPrompt([
        'Agent: thank you for calling how can i help',
        'Customer: my bill went up and i do not understand it',
        'Agent: let me take a look at that for you'
    ].join('\n'));
    t.check('a labelled call says who said what is known',
        /who said what is known/.test(labelled));
    t.check('and does not hedge', !/worked out from the conversation/.test(labelled));
});

suite('call summary prompt: the transcript goes with the roles applied', (t) => {
    const callTranscript = load(t);
    const prompt = callTranscript.buildCallSummaryPrompt(CALL);

    t.check('every line carries a side', /\nAgent: /.test(prompt) && /\nCustomer: /.test(prompt));
    t.check('the greeting is the agent', /Agent: well make s is robert speaking/.test(prompt));
    t.check('and the caller is the customer', /Customer: hi robert this is sheryl/.test(prompt));

    // A summary of a call where nobody knows who was talking is worth little,
    // so the roles this file worked out have to travel with the text.
    t.check('the bill complaint sits on the customer',
        /Customer: well i got my bill/.test(prompt));
});

suite('call summary prompt: nothing in, nothing out', (t) => {
    const callTranscript = load(t);

    t.equal('an empty transcript gives no prompt', callTranscript.buildCallSummaryPrompt(''), '');
    t.equal('and neither does whitespace', callTranscript.buildCallSummaryPrompt('   \n  '), '');
});

suite('call summary prompt: wiring', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    t.check('the panel has the button', html.includes('id="summarizeCallInCopilotBtn"'));
    t.check('it is bound',
        /bindElementOnce\(document\.getElementById\('summarizeCallInCopilotBtn'\), 'click', summarizeCallInCopilot\)/.test(script));

    // It reads the box directly, so it works without running Analyze first.
    t.check('it works straight off the transcript box',
        /function summarizeCallInCopilot\(\)[\s\S]{0,300}callListeningTranscript/.test(script));

    // The associate is deliberately not passed through.
    t.check('the associate name is not sent',
        !/summarizeCallInCopilot\(\)[\s\S]{0,900}callListeningEmployeeSelect/.test(script));

    // Copying and opening Copilot already exists and is the same gesture
    // everywhere else in the app. A second way to do it would be a third
    // behaviour to keep in step.
    t.check('it reuses the existing Copilot opener',
        /summarizeCallInCopilot\(\)[\s\S]{0,900}openCopilotWithPrompt/.test(script));
    t.check('and falls back to a plain copy if it is missing',
        /summarizeCallInCopilot\(\)[\s\S]{0,1100}copyToClipboard/.test(script));
});
