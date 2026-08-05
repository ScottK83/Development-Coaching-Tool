'use strict';

const fs = require('fs');
const path = require('path');
const { suite } = require('./harness');

const VERINT_EXPORT = fs.readFileSync(path.join(__dirname, 'fixtures', 'verint-export.txt'), 'utf8');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-qa.module.js');
    t.loadModule('modules/call-listening.module.js');
    return global.window.DevCoachModules;
}

function score(modules, transcript, associateName) {
    const analysis = modules.callTranscript.analyzeTranscript(transcript, { associateName });
    return modules.callQa.scoreCall(transcript, {
        associateName,
        context: { silenceGaps: analysis.silenceGaps }
    });
}

function verdictFor(qa, id) {
    return (qa.checks.find((item) => item.id === id) || {}).verdict;
}

function labels(items) {
    return items.map((item) => item.label);
}

suite('call QA: scores the real call', (t) => {
    const modules = load(t);
    const qa = score(modules, VERINT_EXPORT, 'Alyssa Dimes');

    t.check('scoring succeeds', qa.ok === true);
    t.equal('answers all five form questions', qa.checks.length, 5);

    t.equal('verified before sharing account detail', verdictFor(qa, 'verification'), 'met');
    t.equal('disclosures covered', verdictFor(qa, 'disclosures'), 'met');
    t.equal('process explained', verdictFor(qa, 'process'), 'met');
    t.equal('inquiry resolved', verdictFor(qa, 'resolved'), 'met');

    // The one a transcript genuinely cannot answer.
    t.equal('notation is not guessed at', verdictFor(qa, 'notation'), 'unknown');
    t.check('and says where to actually look',
        /account notes/.test(qa.checks.find((item) => item.id === 'notation').detail));

    t.equal('every answered question carries a quote', qa.checks
        .filter((item) => item.verdict === 'met')
        .filter((item) => !item.evidence).length, 0);
});

suite('call QA: checklists come off the call', (t) => {
    const modules = load(t);
    const qa = score(modules, VERINT_EXPORT, 'Alyssa Dimes');

    t.check('catches the compliment from the caller', labels(qa.kudos).includes('Compliment from Caller'));
    t.check('quotes the compliment', /very helpful/.test(qa.kudos[0].evidence));

    t.check('flags the long hold', labels(qa.callOpportunities).includes('Long Hold'));
    t.check('says how long and when', /2m21s of silence at 4:30/.test(
        qa.callOpportunities.find((item) => item.label === 'Long Hold').evidence));

    // She offered all three plans and asked if there was anything else, so
    // neither of these is an opportunity on this call.
    t.check('does not claim the offering was missed',
        !labels(qa.callOpportunities).includes('Solution/Program Offering Missed'));
    t.check('does not claim assistance went unoffered',
        !labels(qa.callOpportunities).includes('Offering Assistance'));
    t.check('does not invent a payment negotiation miss',
        !labels(qa.callOpportunities).includes('Did not Negotiate Payment'));

    t.check('catches the system lag as a tech opportunity',
        labels(qa.techOpportunities).includes('System Errors'));
    t.check('does not invent audio issues', !labels(qa.techOpportunities).includes('Audio Issues'));
});

suite('call QA: catches what the advisor missed', (t) => {
    const modules = load(t);

    // Account detail read out with no verification anywhere.
    const unverified = score(modules, [
        'Agent: Hi there.',
        'Customer: What do I owe?',
        'Agent: Your balance is two hundred dollars and your account number is 8568.'
    ].join('\n'));
    t.equal('flags account detail with no verification', verdictFor(unverified, 'verification'), 'opportunity');

    // Verified, but only after the detail went out.
    const outOfOrder = score(modules, [
        'Agent: Your account number is 8568 and your balance is two hundred dollars.',
        'Customer: Ok.',
        'Agent: Can I verify your date of birth?'
    ].join('\n'));
    t.equal('flags verifying after the fact', verdictFor(outOfOrder, 'verification'), 'opportunity');
    t.check('and quotes what went out early',
        /account number is 8568/.test(outOfOrder.checks.find((item) => item.id === 'verification').evidence));

    // Nothing sensitive discussed at all: not a pass, not a fail.
    const nothingShared = score(modules, 'Agent: We are closed on Sundays.\nCustomer: Ok thanks.');
    t.equal('no verdict when there was nothing to protect', verdictFor(nothingShared, 'verification'), 'unknown');
});

suite('call QA: disclosures are judged only when they apply', (t) => {
    const modules = load(t);

    // A plan was discussed but no rate was ever quoted.
    const noRate = score(modules, [
        'Agent: Thank you for calling, my name is Sam. Can I verify your date of birth?',
        'Customer: Sure.',
        'Agent: We can move you to the time of use plan.',
        'Customer: Ok.'
    ].join('\n'));
    const disclosures = noRate.checks.find((item) => item.id === 'disclosures');
    t.equal('flags the gap', disclosures.verdict, 'opportunity');
    t.check('names what was not heard', /rates quoted/i.test(disclosures.detail));
    t.check('and credits what was', disclosures.heard.includes('Identity verification'));

    // No plan discussed at all: the plan scripts must not be held against it.
    const noPlan = score(modules, [
        'Agent: Thank you for calling, my name is Sam. Can I verify your date of birth?',
        'Customer: Yes it is May 4th.',
        'Agent: Your service is set up.'
    ].join('\n'));
    const short = noPlan.checks.find((item) => item.id === 'disclosures');
    t.check('does not demand the rate script on a call with no plans',
        !short.missed.some((label) => /rate/i.test(label)));
    t.equal('so a short call can still pass', short.verdict, 'met');
});

suite('call QA: resolution and opportunities', (t) => {
    const modules = load(t);

    const handedOff = score(modules, [
        'Agent: Thank you for calling. I can verify your date of birth?',
        'Customer: Sure.',
        'Agent: You will have to call the billing team about that, there is nothing I can do.'
    ].join('\n'));
    t.equal('flags a call left open', verdictFor(handedOff, 'resolved'), 'opportunity');
    t.check('flags that no assistance was offered at close',
        labels(handedOff.callOpportunities).includes('Offering Assistance'));

    const noOffering = score(modules, [
        'Agent: Your rate plan is the fixed plan.',
        'Customer: Ok, is there anything cheaper?',
        'Agent: That is what you are on.'
    ].join('\n'));
    t.check('flags a missed offering when plans came up but nothing was offered',
        labels(noOffering.callOpportunities).includes('Solution/Program Offering Missed'));

    const paymentTrouble = score(modules, [
        'Agent: Thank you for calling.',
        'Customer: I am past due and I cannot afford this bill right now.',
        'Agent: The balance is due Friday. Is there anything else I can help with?'
    ].join('\n'));
    t.check('flags payment difficulty with no arrangement offered',
        labels(paymentTrouble.callOpportunities).includes('Did not Negotiate Payment'));

    const negotiated = score(modules, [
        'Agent: Thank you for calling.',
        'Customer: I am past due and I cannot afford this bill right now.',
        'Agent: We can set up a payment arrangement and look at budget billing. Anything else I can help with?'
    ].join('\n'));
    t.check('does not flag it when an arrangement was offered',
        !labels(negotiated.callOpportunities).includes('Did not Negotiate Payment'));
});

suite('call QA: output', (t) => {
    const modules = load(t);
    const qa = score(modules, VERINT_EXPORT, 'Alyssa Dimes');
    const text = modules.callQa.buildQaText(qa);

    t.check('leads with what it is', text.startsWith('QA read from the transcript'));
    t.check('tells the supervisor to verify it', /verify before you submit/.test(text));
    t.check('answers the verification question', /Did advisor verify caller.*Yes/.test(text));
    t.check('is honest about notation', /Did advisor notate properly\? Cannot tell from transcript/.test(text));
    t.check('lists the checklists', /Call Opportunities: Long Hold/.test(text));
    t.check('says None rather than omitting an empty checklist', /Tech Opportunities: /.test(text));
    t.check('avoids em dashes', !text.includes('—'));

    const html = modules.callQa.buildQaHtml(qa, (value) => String(value || ''));
    t.check('renders a row per question', (html.match(/call-qa-row/g) || []).length === 5);
    t.check('renders verdict chips', /call-qa-chip/.test(html));
    t.check('styles from theme tokens, not hex', !/#[0-9a-fA-F]{6}/.test(html));

    // Untrusted transcript text reaches the DOM, so it must be escaped.
    const injected = score(modules, 'Agent: <img src=x onerror=alert(1)> can I verify your date of birth?\nCustomer: Your balance is 5.');
    const escaped = modules.callQa.buildQaHtml(injected, (value) => String(value || '').replace(/</g, '&lt;'));
    t.check('passes evidence through the escaper', !/<img/.test(escaped));

    const empty = modules.callQa.scoreCall('   ');
    t.check('empty transcript is rejected', empty.ok === false);
    t.equal('empty transcript produces no text', modules.callQa.buildQaText(empty), '');
});

suite('call QA: reaches the prompt and the note', (t) => {
    const modules = load(t);

    const prompt = modules.callListening.buildPrompt({
        employeeName: 'Alyssa Dimes',
        listenedOn: '2026-08-04',
        transcript: VERINT_EXPORT,
        whatWentWell: '- Strong recap',
        improvementAreas: '- Long hold'
    }, 'Alyssa');

    t.check('prompt carries the QA read', /QA read from the transcript/.test(prompt));
    t.check('prompt carries the verdicts', /Did advisor verify caller.*Yes/.test(prompt));
    t.check('prompt tells Copilot not to paste the checklist at the associate',
        /background for you, not content for the associate/.test(prompt));

    const noTranscript = modules.callListening.buildPrompt({
        employeeName: 'Alyssa Dimes',
        listenedOn: '2026-08-04',
        whatWentWell: '- Strong recap',
        improvementAreas: '- Long hold'
    }, 'Alyssa');
    t.check('no transcript means no QA block', !/QA read from the transcript/.test(noTranscript));
});
