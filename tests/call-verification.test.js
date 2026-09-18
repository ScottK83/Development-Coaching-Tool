'use strict';

const fs = require('fs');
const path = require('path');
const { suite } = require('./harness');

/**
 * WAS THE CALLER VERIFIED, AND AUTHORIZED, BEFORE THE ACCOUNT WENT OUT
 *
 * The first version of this answered Yes on the calls it most needed to
 * catch. An advisor who asked for "your account number or the address on the
 * account" and then read out the balance was marked verified and praised for
 * it in the draft. "Let me verify that for you" counted as an identity check.
 * A caller who could not give the last four, followed by the balance, read as
 * verified because the question had been asked. And "it looks like you have a
 * balance of", "i see a past due amount" and "i'm calling about my mom's
 * account" were not recognised at all.
 *
 * Every call below is written the way a Verint export arrives: lower case, no
 * punctuation, a timestamp above each line and no speaker labels, which is
 * the hard case. A handful are repeated with labels.
 */

const VERINT_EXPORT = fs.readFileSync(path.join(__dirname, 'fixtures', 'verint-export.txt'), 'utf8');
const STORED_CALL = fs.readFileSync(path.join(__dirname, 'fixtures', 'stored-call.txt'), 'utf8');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-verification.module.js');
    return global.window.DevCoachModules;
}

// Verint's shape: a timestamp on its own line, the speech under it.
function verint(pairs) {
    return pairs.map(([at, line]) => `${at}\n${line}`).join('\n');
}

function read(modules, transcript) {
    return modules.callVerification.readVerificationFromText(transcript);
}

const GREETING = ['00:02', 'thank you for calling a p s my name is oceane how can i help you'];

/* ── The calls it has to catch ── */

const CALLS = {
    addressThenBalance: verint([
        GREETING,
        ['00:07', 'hi yeah i just wanted to know how much i owe on my bill'],
        ['00:11', 'sure can i have your account number or the address on the account'],
        ['00:15', 'it is two four one five west camelback road'],
        ['00:22', 'okay one moment let me pull that up'],
        ['00:31', 'okay so your balance is one hundred eighty seven dollars and that is due on the fifteenth']
    ]),
    softPhrasing: verint([
        GREETING,
        ['00:07', 'hi i just wanted to know how much i owe'],
        ['00:11', 'sure can i have the address on the account'],
        ['00:15', 'it is two four one five west camelback road'],
        ['00:31', 'okay so it looks like you have a balance of one hundred eighty seven dollars']
    ]),
    momsAccount: verint([
        GREETING,
        ['00:06', 'hi i am calling about my mom\'s account she got a shut off notice'],
        ['00:12', 'okay can i have the address on the account'],
        ['00:16', 'it is three three zero one north seventh street'],
        ['00:24', 'alright and what is the name on the account'],
        ['00:27', 'maria lopez'],
        ['00:31', 'okay so i do see a past due amount of two hundred forty dollars and the disconnect is scheduled for friday']
    ]),
    verifiedAfter: verint([
        GREETING,
        ['00:06', 'what is my balance'],
        ['00:09', 'can i have the address'],
        ['00:13', 'one two three main street'],
        ['00:20', 'your balance is two hundred dollars due on the twentieth'],
        ['00:28', 'okay can i make a payment'],
        ['00:31', 'sure for security purposes can you verify the last four of your social'],
        ['00:36', 'one two three four']
    ]),
    failedThenShared: verint([
        GREETING,
        ['00:06', 'hi i need to know when my power is getting shut off'],
        ['00:10', 'okay can i have the address on the account'],
        ['00:14', 'nine nine one east main street'],
        ['00:22', 'and for verification can you give me the last four of the social on the account'],
        ['00:27', 'oh i do not know it it is my husband\'s account'],
        ['00:31', 'okay that is fine so the disconnect is scheduled for tomorrow and the amount due is three hundred ten dollars']
    ]),
    verifyThat: verint([
        GREETING,
        ['00:06', 'i made a payment yesterday and want to make sure it went through'],
        ['00:10', 'sure let me verify that for you what is the address'],
        ['00:15', 'four four north central'],
        ['00:22', 'okay yes i see your payment of one fifty posted yesterday and your balance is zero']
    ]),
    phoneOnFile: verint([
        GREETING,
        ['00:06', 'i need to update my phone number'],
        ['00:10', 'okay can i get the address'],
        ['00:14', 'two two west adams'],
        ['00:20', 'okay and the phone number we have on file is six zero two five five five one two one two is that still good']
    ]),
    nameOnly: verint([
        GREETING,
        ['00:06', 'hi i want to know my balance'],
        ['00:10', 'sure can i have the address and the name on the account'],
        ['00:15', 'john smith one two three main street'],
        ['00:22', 'thank you so your current balance is sixty four dollars']
    ]),
    saidNoThenShared: verint([
        GREETING,
        ['00:06', 'i need the balance on the account'],
        ['00:09', 'are you the account holder'],
        ['00:12', 'no it is my mom\'s account'],
        ['00:15', 'okay can you verify the last four of her social'],
        ['00:19', 'one two three four'],
        ['00:24', 'thank you the balance is two hundred']
    ]),
    readsTheScreen: verint([
        GREETING,
        ['00:06', 'what is my balance'],
        ['00:09', 'can i have the address'],
        ['00:12', 'one two three main'],
        ['00:18', 'okay it says here your balance is two hundred']
    ]),
    // The most natural way to give a balance away names no balance at all.
    bareAmount: verint([
        GREETING,
        ['00:06', 'hi what do i owe right now'],
        ['00:09', 'can i have the address on the account'],
        ['00:13', 'one two three main street'],
        ['00:18', 'one moment'],
        ['00:25', 'okay it is one hundred eighty seven dollars and twenty two cents']
    ]),
    // "The last four months" is usage talk. Read as the identity question it
    // would have passed this call as verified.
    lastFourMonths: verint([
        GREETING,
        ['00:06', 'why is my bill so high'],
        ['00:10', 'can i have the address on the account'],
        ['00:14', 'one two three main street'],
        ['00:20', 'okay looking at your usage over the last four months it has gone up'],
        ['00:26', 'okay'],
        ['00:30', 'so your bill this month is two hundred dollars']
    ])
};

/* ── The calls it must leave alone ── */

const CLEAN = {
    lastFourFirst: verint([
        ['00:01', 'thank you for calling a p s this is robert speaking how can i help you'],
        ['00:05', 'hi robert this is sheryl ross and i am calling about my bill'],
        ['00:16', 'alright and for security purposes can you please verify the last four digits of your social'],
        ['00:27', 'four six four five'],
        ['00:29', 'thank you very much for verifying that and how may i help you'],
        ['00:34', 'well i got my bill and i do not understand why it is so high'],
        ['00:43', 'okay let me pull up your account so your balance is one hundred twelve dollars']
    ]),
    thirdPartyDoneRight: verint([
        GREETING,
        ['00:06', 'hi i am calling for my dad he got a really high bill'],
        ['00:11', 'okay are you listed on the account as an authorized user'],
        ['00:15', 'no i am not'],
        ['00:18', 'okay i am not able to discuss the account unless the account holder gives verbal authorization is he there with you'],
        ['00:25', 'yeah hold on'],
        ['00:40', 'hi this is frank'],
        ['00:43', 'hi frank for security purposes can you verify the last four digits of your social'],
        ['00:49', 'five five six seven'],
        ['00:52', 'thank you for verifying and do you give permission for your son to discuss the account'],
        ['00:57', 'yes'],
        ['01:00', 'okay so your balance is three hundred twenty dollars']
    ]),
    outage: verint([
        GREETING,
        ['00:06', 'my lights went out'],
        ['00:09', 'what is the zip code'],
        ['00:12', 'eight five zero one three'],
        ['00:18', 'okay yes the power was shut off in your area due to the storm and crews are out now']
    ]),
    laterIDontKnow: verint([
        GREETING,
        ['00:06', 'hi i have a question about my bill'],
        ['00:10', 'sure for security purposes can you verify your date of birth'],
        ['00:15', 'march fifth nineteen eighty'],
        ['00:19', 'thank you and what can i help with'],
        ['00:23', 'i do not know why my bill is so high this month it doubled'],
        ['00:31', 'okay let me look your usage went up in july because of the heat']
    ]),
    paymentByCard: verint([
        GREETING,
        ['00:06', 'i want to make a payment'],
        ['00:09', 'sure can i have the address on the account'],
        ['00:13', 'one two three main street'],
        ['00:20', 'and what card would you like to use'],
        ['00:24', 'visa four one one one one one one one'],
        ['00:40', 'okay your payment of fifty dollars went through on the card ending in one one one one']
    ]),
    onBehalfNo: verint([
        GREETING,
        ['00:06', 'i need my balance'],
        ['00:09', 'are you calling on behalf of the account holder'],
        ['00:12', 'no it is my account'],
        ['00:15', 'okay can you verify your date of birth'],
        ['00:19', 'june second'],
        ['00:24', 'thank you your balance is eighty dollars']
    ]),
    jointHolder: verint([
        GREETING,
        ['00:06', 'hi my wife\'s name is on the bill too but i want to check the balance'],
        ['00:12', 'sure for verification can i have the last four of your social'],
        ['00:17', 'two two three three'],
        ['00:22', 'thank you your balance is ninety dollars']
    ]),
    relayed: verint([
        GREETING,
        ['00:06', 'hi they told me the balance is two hundred and i wanted to check'],
        ['00:12', 'okay for security purposes can you verify your date of birth'],
        ['00:16', 'march fifth'],
        ['00:20', 'thank you so your balance is two hundred']
    ]),
    phoneSystem: verint([
        ['00:02', 'thank you for calling a p s my name is oceane i see you have already been verified through the phone system how can i help'],
        ['00:08', 'what do i owe'],
        ['00:11', 'your balance is sixty dollars']
    ]),
    volunteered: verint([
        GREETING,
        ['00:06', 'hi this is john and the last four of my social is one two three four'],
        ['00:12', 'thank you john your balance is forty dollars']
    ]),
    generalPolicy: verint([
        GREETING,
        ['00:06', 'what options do you have if money is tight'],
        ['00:10', 'if you are past due we have payment arrangements and if you owe more than you can pay we can extend it']
    ]),
    refused: verint([
        GREETING,
        ['00:06', 'hi i am calling about my son\'s account what does he owe'],
        ['00:10', 'are you listed on the account'],
        ['00:13', 'no'],
        ['00:16', 'i am sorry i am not able to discuss the account unless he is on the line with us'],
        ['00:22', 'okay i will have him call']
    ]),
    bareAmountVerified: verint([
        GREETING,
        ['00:06', 'hi what do i owe right now'],
        ['00:09', 'okay and your date of birth'],
        ['00:13', 'april ninth'],
        ['00:18', 'thank you it is one hundred eighty seven dollars']
    ]),
    feeNotBalance: verint([
        GREETING,
        ['00:06', 'what do i owe if i pay by card'],
        ['00:10', 'there is a two dollar convenience fee for card payments']
    ]),
    gonnaNeed: verint([
        GREETING,
        ['00:06', 'i need to check my balance'],
        ['00:10', 'sure i am gonna need the last four of your social'],
        ['00:14', 'eight eight one two'],
        ['00:19', 'perfect your balance is thirty dollars']
    ])
};

suite('call verification: every way the account went out is a red flag', (t) => {
    const modules = load(t);

    const expect = {
        addressThenBalance: ['unverified'],
        softPhrasing: ['unverified'],
        momsAccount: ['unverified', 'unauthorized'],
        verifiedAfter: ['late'],
        failedThenShared: ['failed', 'unauthorized'],
        verifyThat: ['unverified'],
        phoneOnFile: ['unverified'],
        nameOnly: ['unverified'],
        saidNoThenShared: ['denied'],
        readsTheScreen: ['unverified'],
        bareAmount: ['unverified'],
        lastFourMonths: ['unverified']
    };

    Object.entries(expect).forEach(([name, types]) => {
        const result = read(modules, CALLS[name]);
        t.equal(`${name}: is a red flag`, result.status, 'breach');
        t.equal(`${name}: for the right reason`, (result.breach?.types || []).join(','), types.join(','));
        t.equal(`${name}: answers the form question No`, result.verdict, 'opportunity');
    });
});

suite('call verification: the calls that did it right are left alone', (t) => {
    const modules = load(t);

    const expect = {
        lastFourFirst: 'verified',
        thirdPartyDoneRight: 'verified',
        outage: 'nothing-shared',
        laterIDontKnow: 'verified',
        paymentByCard: 'nothing-shared',
        onBehalfNo: 'verified',
        jointHolder: 'verified',
        relayed: 'verified',
        phoneSystem: 'verified',
        volunteered: 'verified',
        generalPolicy: 'nothing-shared',
        refused: 'held-back',
        bareAmountVerified: 'verified',
        feeNotBalance: 'nothing-shared',
        gonnaNeed: 'verified'
    };

    Object.entries(expect).forEach(([name, status]) => {
        const result = read(modules, CLEAN[name]);
        t.equal(`${name}: ${status}`, result.status, status);
        t.check(`${name}: no red flag`, result.redFlag === false);
    });

    // The two real calls in the fixtures, neither of which gave anything away.
    t.equal('the real start service call is verified', read(modules, VERINT_EXPORT).status, 'verified');
    t.equal('the real stored call is verified', read(modules, STORED_CALL).status, 'verified');
});

suite('call verification: finding the account is not proving who is calling', (t) => {
    const modules = load(t);
    const ask = modules.callVerification.IDENTITY_ASK;

    // Proof of identity.
    [
        'for security purposes can you please verify the last four digits of your social',
        'can i get the last four of the social on the account',
        'and to verify can i have your date of birth',
        'what is the pin on the account',
        'can you answer your security question for me',
        'we do need security number for you and a good email address',
        'i am gonna need the last four of your social',
        "i'm going to need your date of birth",
        'okay and your date of birth',
        'and the last four of the social please'
    ].forEach((line) => t.check(`identity: "${line}"`, ask.test(line)));

    // Lookups, and "verify" used about something else.
    [
        'can i have your account number or the address on the account',
        'can i have the address and the name on the account',
        'can you verify the phone number on the account',
        'let me verify that for you what is the address',
        'for security purposes can i get the address on the account',
        'can you give me the last four of the account number',
        'looking at your usage over the last four months it has gone up',
        'are you getting your social security benefits right now'
    ].forEach((line) => t.check(`not identity: "${line}"`, !ask.test(line)));
});

suite('call verification: what counts as account detail going out', (t) => {
    const modules = load(t);
    const shares = (line) => modules.callVerification.DISCLOSURES.some((item) => item.pattern.test(line));

    [
        'okay so your balance is one hundred eighty seven dollars',
        'it looks like you have a balance of two hundred',
        'i do see a past due amount of two hundred forty dollars',
        'the disconnect is scheduled for friday',
        'your last payment was ninety dollars on august third',
        'the phone number we have on file is six zero two',
        'you are currently on the time of use plan',
        'your account is past due',
        'the account number is eight five six eight',
        'is your date of birth march fifth',
        'so your bill this month is two hundred dollars',
        'the last bill was one hundred fifty dollars'
    ].forEach((line) => t.check(`shares: "${line}"`, shares(line)));

    [
        'can i have the address on the account',
        'the power was shut off in your area due to the storm',
        'your payment of fifty dollars went through on the card ending in one one one one',
        'if you are past due we have payment arrangements',
        'your bill is based on your usage',
        'you used to be on the fixed plan',
        'what is your date of birth'
    ].forEach((line) => t.check(`does not share: "${line}"`, !shares(line)));
});

suite('call verification: labels make it certain', (t) => {
    const modules = load(t);

    // With labels, a caller reading their own account is never the advisor
    // sharing it, however it is worded.
    const callerSaysIt = read(modules, [
        'Agent: Thank you for calling APS, my name is Oceane.',
        'Customer: The balance is two hundred and the disconnect is scheduled for Friday, can I pay?',
        'Agent: I can take a payment. What card would you like to use?'
    ].join('\n'));
    t.equal('the caller saying it is not a disclosure', callerSaysIt.status, 'nothing-shared');

    const labelled = read(modules, [
        'Agent: Thank you for calling APS, my name is Oceane.',
        'Customer: What do I owe?',
        'Agent: Can I have the address on the account?',
        'Customer: 12 Main Street.',
        'Agent: Your balance is two hundred dollars.'
    ].join('\n'));
    t.equal('the advisor saying it still is', labelled.status, 'breach');
    t.check('and a labelled call carries no listen-first caveat',
        !/worked out from the flow/.test(modules.callVerification.buildAlertText(labelled)));
});

suite('call verification: what the supervisor is told', (t) => {
    const modules = load(t);
    const cv = modules.callVerification;

    const leaked = read(modules, CALLS.addressThenBalance);
    const said = cv.describe(leaked);
    t.check('headline says what happened', /shared before the caller was verified/.test(said.headline));
    t.check('detail names what went out and when', /The balance was shared at 0:31/.test(said.detail));
    t.check('and why the address was not enough', /finds the account but does not verify the caller/.test(said.detail));
    t.check('evidence is the line that shared it', /your balance is one hundred eighty seven/.test(said.evidence));

    const timeline = cv.buildTimeline(leaked).map((row) => row.text).join(' | ');
    t.check('timeline starts with the lookup', /^Asked for the account number and the address/.test(timeline));
    t.check('then the disclosure', /Shared the balance/.test(timeline));
    t.check('and says no check came at all', /No identity check anywhere on the call/.test(timeline));

    const html = cv.buildAlertHtml(leaked, (value) => String(value || '').replace(/</g, '&lt;'));
    t.check('the box is red', /call-alert-red/.test(html));
    t.check('it says the speakers were inferred, with the time to listen at',
        /worked out from the flow of the call.*Listen at 0:31/.test(html));
    t.check('it states the rule it judged by', /Counted as verification: the last four of the social/.test(html));
    t.check('no em dashes', !/[—–]/.test(html));

    const late = cv.describe(read(modules, CALLS.verifiedAfter));
    t.check('a late check says when it came', /verification did not come until 0:31/.test(late.detail));

    const party = cv.describe(read(modules, CALLS.momsAccount));
    t.check('a third party is named', /said it was not their account at 0:06/.test(party.detail));

    const clean = cv.buildAlertHtml(read(modules, CLEAN.lastFourFirst));
    t.check('a clean call is one quiet line, not a red box', /call-alert-ok/.test(clean) && !/call-alert-red/.test(clean));
    t.check('and says how and when', /Verified at 0:16 with the last four of the social/.test(clean));

    const text = cv.buildAlertText(leaked);
    t.check('the text version leads with the flag', text.startsWith('RED FLAG: '));
    t.equal('nothing to copy for a clean call', cv.buildAlertText(read(modules, CLEAN.lastFourFirst)), '');

    // Untrusted transcript text reaches the DOM.
    const injected = read(modules, verint([
        GREETING,
        ['00:06', 'what do i owe'],
        ['00:09', '<img src=x onerror=alert(1)> your balance is two hundred']
    ]));
    const escaped = cv.buildAlertHtml(injected, (value) => String(value || '').replace(/</g, '&lt;'));
    t.check('quotes are escaped', !/<img/.test(escaped));
});

suite('call verification: what the associate is told', (t) => {
    const modules = load(t);
    const cv = modules.callVerification;

    Object.keys(CALLS).forEach((name) => {
        const coaching = cv.coachingFor(read(modules, CALLS[name]));
        t.check(`${name}: coached`, Boolean(coaching));
        t.check(`${name}: weighted above everything else`, coaching.weight >= 20 && coaching.severity === 'red');
        t.check(`${name}: second person`, /\byou\b/i.test(coaching.text));
        t.check(`${name}: no form vocabulary`, !/red flag|opportunity|compliance|disclosure/i.test(coaching.text));
        t.check(`${name}: no em dashes`, !/[—–]/.test(coaching.text));
    });

    const both = cv.coachingFor(read(modules, CALLS.momsAccount)).text;
    t.check('somebody else\'s account is named', /somebody calls about another person's account/.test(both));
    t.check('and the missing verification is not dropped', /Verification comes first as well/.test(both));

    t.equal('nothing coached on a clean call', cv.coachingFor(read(modules, CLEAN.lastFourFirst)), null);
    t.check('the refusal is praised', /kept its details back/.test(cv.praiseFor(read(modules, CLEAN.refused)).text));
    t.equal('nothing praised on an outage call', cv.praiseFor(read(modules, CLEAN.outage)), null);
});

suite('call verification: a trimmed call is not judged past the cut', (t) => {
    const modules = load(t);

    // The check may be exactly what the trim removed.
    const trimmed = read(modules, [
        'Agent: Thank you for calling APS, my name is Oceane.',
        'Customer: What do I owe?',
        '[transcript truncated for storage]',
        'Agent: So your balance is two hundred dollars.'
    ].join('\n'));
    t.check('no red flag from what survived the cut', trimmed.redFlag === false);
});

suite('call verification: it reaches every place the call is read', (t) => {
    const modules = load(t);
    t.loadModule('modules/call-qa.module.js');
    t.loadModule('modules/call-summary.module.js');
    t.loadModule('modules/call-listening.module.js');
    const { callTranscript, callQa, callSummary, callListening } = global.window.DevCoachModules;

    // The QA form.
    const qa = callQa.scoreCall(CALLS.addressThenBalance, {});
    const row = qa.checks.find((item) => item.id === 'verification');
    t.equal('the form row is flagged red', row.severity, 'red');
    t.check('the result says so', qa.redFlag === true && qa.counts.redFlags === 1);
    t.check('the text answers No, not Opportunity', /account information\? No, red flag\./.test(callQa.buildQaText(qa)));
    t.check('the chip is red', /var\(--red-soft\)/.test(callQa.buildQaHtml(qa)));

    // An outage report owes nobody a date of birth.
    const outageQa = callQa.scoreCall(CLEAN.outage, {});
    const scripts = outageQa.checks.find((item) => item.id === 'disclosures');
    t.check('identity verification is not demanded when the account never came up',
        !scripts.missed.includes('Identity verification'));

    // The drafts.
    const analysis = callTranscript.analyzeTranscript(CALLS.addressThenBalance, {});
    t.equal('the draft leads with it', analysis.improvements[0].key, 'verification');
    t.check('and does not praise verifying', !analysis.allStrengths.some((item) => item.key === 'verification'));
    t.equal('no "solid call" headline', analysis.headline, '');
    t.check('the analysis carries the read', analysis.verification?.redFlag === true);

    // The recap only says verification happened when it did.
    const leakedRecap = callSummary.summarizeCall(CALLS.addressThenBalance, { analysis });
    t.check('asking for the address is not recapped as verification',
        !leakedRecap.actions.some((action) => action.key === 'verified'));
    const cleanRecap = callSummary.summarizeCall(CLEAN.lastFourFirst, {});
    t.check('the last four is', cleanRecap.actions.some((action) => action.key === 'verified'));
    const disconnectRecap = callSummary.summarizeCall(CALLS.momsAccount, {});
    t.check('a scheduled disconnect is not an appointment being booked',
        !disconnectRecap.actions.some((action) => action.key === 'scheduled'));
    t.check('and the advisor reading the balance is not the customer opening',
        !/your balance is/.test(callSummary.summarizeCall(CALLS.verifiedAfter, {}).openingAsk));

    // Her saved calls, scannable without opening one.
    const flaggedRow = callListening.buildHistoryItemHtml({
        id: 'a', employeeName: 'Oceane Test', listenedOn: '2026-09-02', transcript: CALLS.addressThenBalance
    });
    const cleanRow = callListening.buildHistoryItemHtml({
        id: 'b', employeeName: 'Oceane Test', listenedOn: '2026-09-09', transcript: CLEAN.lastFourFirst
    });
    t.check('a flagged call is marked in her history', /🚩/.test(flaggedRow) && /shared before verifying/.test(flaggedRow));
    t.check('a clean one is not', !/🚩/.test(cleanRow));
    t.check('a call with no transcript is not guessed at',
        !callListening.hasVerificationRedFlag({ id: 'c', listenedOn: '2026-09-10' }));

    // The email written from the notes.
    const message = callListening.buildCallFeedbackMessage({
        employeeName: 'Oceane Test',
        whatWentWell: '- Friendly open\n- Clear recap\n- Offered more help',
        improvementAreas: '- You shared the balance before verifying who you were talking to.'
    });
    t.check('four strengths do not make a verification miss "nothing to worry about"',
        !/Nothing here is a concern/.test(message));
});

/*
 * An adversarial review ran 107 calls at the first version of this and found
 * it wrong on phrasings as ordinary as "okay no problem" after a caller who
 * could not give the last four (read as verified, and praised), "thank you
 * for holding i appreciate your patience so your balance is" (the whole turn
 * cued as the caller, so nothing was shared), and "we have payment
 * arrangements where you can pay what you owe" (a red flag for policy talk).
 * Every call it wrote is kept here, with what it should read as, so none of
 * those comes back.
 *
 * Six are known limits, listed in the fixture and checked below so a change
 * in them is noticed either way. No wording rule separates them: a caller
 * saying "this month's bill is three hundred forty dollars" uses the same
 * words an advisor does, and a bare "it is one eighty seven twenty two" is
 * also how a caller reads out digits.
 */
const PROBES = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'verification-probes.json'), 'utf8'));

function verdictOf(result) {
    const types = (result.breach?.types || []).join(',');
    return result.status + (types ? `(${types})` : '');
}

suite('call verification: the review\'s calls read as they should', (t) => {
    const modules = load(t);

    PROBES.probes.forEach((probe) => {
        const result = read(modules, probe.transcript);
        const got = verdictOf(result);
        const accepted = String(probe.expected).split('|');
        t.check(`${probe.name}: ${got}`, accepted.includes(got) || accepted.includes(result.status));
    });

    t.check('the corpus is all there', PROBES.probes.length >= 90);
});

suite('call verification: the known limits are still the known limits', (t) => {
    const modules = load(t);

    // If one of these starts reading correctly, move it into the probes. If
    // it starts reading some third way, look at why before anything else.
    const now = {};
    PROBES.knownLimits.forEach((probe) => {
        now[probe.name.split(' ')[0]] = read(modules, probe.transcript);
    });
    t.equal('a caller reading out their bill is indistinguishable from an advisor', now.P4c.status, 'breach');
    t.equal('a bare amount with no "dollars" is not caught', now.N1.status, 'nothing-shared');
    t.equal('a transcript that is one block cannot be read', now.PL1.reason, 'unsegmented');
    t.check('and says so, rather than going quiet',
        /one block/.test(modules.callVerification.describe(now.PL1).detail)
        && /call-alert-quiet/.test(modules.callVerification.buildAlertHtml(now.PL1)));
});

suite('call verification: answers in words, and callers offering', (t) => {
    const modules = load(t);

    // A security question is answered in words. Requiring a number there
    // would flag every call verified that way.
    const secret = read(modules, verint([
        GREETING,
        ['00:06', 'hi what is my balance'],
        ['00:09', 'sure for security purposes can you answer your security question what was your first pet'],
        ['00:15', 'rex'],
        ['00:18', 'okay your balance is sixty dollars']
    ]));
    t.equal('a one word answer to a security question verifies', secret.status, 'verified');

    // But not a refusal dressed as an answer.
    const refusedAnswer = read(modules, verint([
        GREETING,
        ['00:06', 'hi what is my balance'],
        ['00:09', 'sure for security purposes can you answer your security question'],
        ['00:15', 'why do you need that'],
        ['00:18', 'okay your balance is sixty dollars']
    ]));
    t.equal('"why do you need that" is not an answer', refusedAnswer.status, 'breach');

    // The advisor saying they have the account up, then asking, is asking.
    const haveItUp = read(modules, verint([
        GREETING,
        ['00:06', 'hi what is my balance'],
        ['00:09', 'okay i have the account up now can you verify your date of birth'],
        ['00:14', 'march fifth nineteen eighty'],
        ['00:18', 'thank you your balance is sixty dollars']
    ]));
    t.equal('"i have the account up, can you verify" is the advisor asking', haveItUp.status, 'verified');

    // A website password mentioned in passing is not the identity check.
    const website = read(modules, verint([
        GREETING,
        ['00:06', 'i cannot get into the website'],
        ['00:10', 'okay you can reset your password on a p s dot com'],
        ['00:15', 'okay'],
        ['00:18', 'and your balance is sixty dollars']
    ]));
    t.equal('"you can reset your password" does not verify anybody', website.status, 'breach');
});

suite('call verification: the coaching bridge keeps it first and counts it once', (t) => {
    const modules = load(t);
    t.loadModule('modules/call-qa.module.js');
    t.loadModule('modules/call-word-choice.module.js');
    t.loadModule('modules/coaching-outcomes.module.js');
    t.loadModule('modules/call-coaching-bridge.module.js');
    t.loadModule('modules/call-trends.module.js');
    const { callTranscript, callCoachingBridge: bridge, callTrends } = global.window.DevCoachModules;

    // Ordered for somebody missing handle time, the red flag still leads.
    const ordered = bridge.prioritizeByMetrics([
        { key: 'deadAirGap', weight: 6, text: 'dead air' },
        { key: 'verification', weight: 20, severity: 'red', text: 'shared first' },
        { key: 'stalling', weight: 5, text: 'stalling' }
    ], ['aht']);
    t.equal('a red flag outranks every KPI', ordered[0].key, 'verification');

    // One call is enough to show it across her history.
    const entries = [
        { employeeName: 'Oceane Test', listenedOn: '2026-09-02', transcript: CALLS.addressThenBalance },
        { employeeName: 'Oceane Test', listenedOn: '2026-09-09', transcript: CLEAN.lastFourFirst },
        { employeeName: 'Oceane Test', listenedOn: '2026-09-15', transcript: CLEAN.outage }
    ];
    const summary = bridge.collectFindings({ associateName: 'Oceane Test', history: entries });
    t.equal('counted from a single call', summary.securityFlags[0]?.count, 1);
    t.check('with the date it happened', summary.securityFlags[0]?.dates.includes('2026-09-02'));

    const html = callTrends.buildTrendHtml(summary, (value) => String(value || ''));
    t.check('shown first, in red', html.indexOf('call-trend-red') > -1
        && html.indexOf('call-trend-red') < Math.max(0, html.indexOf('call-trend-good')) + (html.indexOf('call-trend-good') < 0 ? Infinity : 0));
    t.check('named plainly', /account information shared before the caller was verified or authorized/.test(html));

    // Two rows from one read would be the same point twice in her message.
    const analysis = callTranscript.analyzeTranscript(CALLS.addressThenBalance, {});
    const { findings } = bridge.collectFindings({
        analysis, transcript: CALLS.addressThenBalance, associateName: 'Oceane Test', callDate: '2026-09-02'
    });
    t.equal('said once, in the associate\'s words', findings.filter((f) => /verification/i.test(f.key)).length, 1);
});
