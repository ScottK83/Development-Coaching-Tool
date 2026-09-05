'use strict';

/**
 * The associate reads this. It has to sound like her supervisor wrote it.
 *
 * Scott read a generated message and asked "wtf you mean by hedging language",
 * which was fair: the line said "Confidence: hedging language showed up
 * several times". That is QA vocabulary. She has never used the phrase and
 * would not know what it referred to, and a message she has to decode is a
 * message she stops reading.
 *
 * Every string in this file's scope ends up in an email from a supervisor to
 * someone she works with every day. These tests are what stops the next rule
 * arriving with a report field in front of it.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/call-transcript.module.js');
    return global.window.DevCoachModules.callTranscript;
}

/**
 * Every line the rules engine can put in front of the associate.
 *
 * Collected by running the engine over calls built to trip each rule, rather
 * than by reading the source, so a rule added later is covered without anyone
 * remembering to add it here.
 */
function coachingLines(T) {
    const CALLS = [
        // A call that does almost everything right.
        [
            'Agent: Thank you for calling APS, my name is Jamie. How can I help you today?',
            'Customer: My bill doubled this month and I have no idea why.',
            'Agent: I completely understand how frustrating that is. Let me take care of this for you.',
            'Agent: Before I pull it up, can you confirm your date of birth for verification?',
            'Customer: Sure, it is May 4th 1983.',
            'Agent: May I place you on a brief hold while I check the billing detail?',
            'Customer: That is fine.',
            'Agent: Thank you for holding. I found a duplicate charge and I have credited it back.',
            'Agent: We have three plans available. Based on your usage I would recommend the time of use plan.',
            'Agent: To recap, the duplicate charge is reversed and you will see it within 3 business days.',
            'Agent: For future reference you can also check charges on the app before they post.',
            'Agent: Does that make sense? Is there anything else I can help with?',
            'Customer: No, thank you so much, you have been so helpful.'
        ].join('\n'),
        // A call that does almost everything wrong.
        [
            'Agent: Yeah, what do you need?',
            'Customer: This is the third time I have called about this and it is ridiculous.',
            'Agent: Um, I think that is just our policy, there is nothing I can do about it.',
            'Customer: Like I said, I already explained this to the last person.',
            'Agent: Hold on. One moment. Bear with me. Just a second. Still checking.',
            'Agent: I am sorry. I am so sorry. I am really sorry about that. I apologise. I am sorry.',
            'Agent: Um, uh, erm, I guess it should be fine, hopefully.',
            'Agent: I am going to transfer you to the billing department.',
            'Customer: Can I speak to a supervisor?'
        ].join('\n')
    ];

    const lines = [];
    CALLS.forEach((transcript) => {
        const analysis = T.analyzeTranscript(transcript, { associateName: 'Jamie' });
        if (!analysis.ok) return;
        (analysis.allStrengths || []).forEach((item) => lines.push(item.text));
        (analysis.allImprovements || []).forEach((item) => lines.push(item.text));
        if (analysis.headline) lines.push(analysis.headline);
        lines.push(T.buildStrengthsDraft(analysis));
        lines.push(T.buildImprovementsDraft(analysis));
    });

    // The empty-state drafts, which are copy too.
    lines.push(T.buildStrengthsDraft({ ok: true, strengths: [], improvements: [] }));
    lines.push(T.buildImprovementsDraft({ ok: true, strengths: [], improvements: [] }));

    return lines.filter(Boolean);
}

suite('coaching voice: no QA vocabulary reaches the associate', (t) => {
    const T = load(t);
    const lines = coachingLines(T);

    t.check('the engine produced lines to check', lines.length > 15);

    // Words and phrases an associate would never use about her own call. Each
    // one was in this file's output at some point.
    const JARGON = [
        'hedging language', 'dead air', 'active listening', 'dead end language',
        'escalation request', 'filler words', 'silence fillers', 'hold process',
        'airtime', 'call control', 'over apologising', 'over-apologising',
        'branded greeting', 'branded the call', 'QA form', 'disclosures',
        'soft skills', 'compliance'
    ];

    const found = [];
    JARGON.forEach((phrase) => {
        lines.filter((line) => line.toLowerCase().includes(phrase.toLowerCase()))
            .forEach((line) => found.push(`"${phrase}" in: ${line.slice(0, 60)}`));
    });
    t.equal(`no QA vocabulary (${found.join(' | ') || 'clean'})`, found.length, 0);

    // "Confidence:", "Next steps:", "Hold process:" and friends. A label in
    // front of a sentence is a report field, and the message strips them,
    // which is how "you did announce it" ended up referring to nothing.
    const labelled = lines
        .filter((line) => /^[A-Z][A-Za-z]*(?: [a-z]+){0,2}:\s/.test(line))
        .map((line) => line.slice(0, 50));
    t.equal(`no line opens with a report label (${labelled.join(' | ') || 'clean'})`, labelled.length, 0);
});

suite('coaching voice: a finding does not assume one call', (t) => {
    const T = load(t);
    const lines = coachingLines(T);

    // The message prefixes a finding with "On all 4 calls, " when it spans the
    // set, so a finding that also says "on this one" contradicts its own
    // prefix: "On all 4 calls, you sounded unsure a few times on this one."
    //
    // The three judges that reviewed these rewrites could not catch this. They
    // were shown each string alone, never assembled into the sentence it ends
    // up in.
    const DEIXIS = [
        'on this one', 'on this call', ' here.', ' here,', 'this time'
    ];

    const found = [];
    DEIXIS.forEach((phrase) => {
        lines.filter((line) => line.toLowerCase().includes(phrase))
            .forEach((line) => found.push(`"${phrase.trim()}" in: ${line.slice(0, 60)}`));
    });
    t.equal(`no finding claims a single call (${found.join(' | ') || 'clean'})`, found.length, 0);
});

suite('coaching voice: it reads like a person, not a form', (t) => {
    const T = load(t);
    const lines = coachingLines(T);

    // Second person throughout. A line about her in the third person reads as
    // a note to somebody else about her.
    const thirdPerson = lines
        .filter((line) => /\b(the associate|the advisor|the agent|the rep|she should|he should)\b/i.test(line))
        .map((line) => line.slice(0, 60));
    t.equal(`nothing is about her rather than to her (${thirdPerson.join(' | ') || 'clean'})`, thirdPerson.length, 0);

    // The house rule, and it is enforced elsewhere too, but these are the
    // lines that go in an email with a supervisor's name on them.
    const dashed = lines.filter((line) => /[—–]/.test(line)).map((line) => line.slice(0, 60));
    t.equal(`no em dashes (${dashed.join(' | ') || 'clean'})`, dashed.length, 0);

    // The team is tenured. Nothing should read as if she is learning the job.
    const patronising = lines
        .filter((line) => /if you'?re new|as you learn|remember to always|don'?t forget to always/i.test(line))
        .map((line) => line.slice(0, 60));
    t.equal(`nothing talks down to her (${patronising.join(' | ') || 'clean'})`, patronising.length, 0);
});

suite('coaching voice: the sweep that found these', (t) => {
    const transcript = fs.readFileSync(path.join(ROOT, 'modules/call-transcript.module.js'), 'utf8');

    // Spot checks on the specific lines Scott's reading turned up, so a
    // revert is visible rather than silent.
    t.check('the hedging line is plain now',
        transcript.includes('You sounded unsure a few times. Go check'));
    t.check('the QA form is not cited as a reason to do the right thing',
        !transcript.includes('QA form looks for'));
    t.check('and the praise names the customer instead',
        transcript.includes('that is exactly what we want customers to hear'));
});
