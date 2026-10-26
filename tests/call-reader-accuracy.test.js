'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * WHAT THE READER GOT WRONG ON A REAL CALL
 *
 * The 2026-10-25 deep dive ran the reader over the one real call in the
 * backup, a payment arrangement call. It caught the real problem (the
 * customer lost the arrangement after one long run of numbers) and got four
 * other things wrong, each of which went on into the notes, the Copilot
 * summary or the QA form:
 *
 *   - "Nice add. You showed them a faster way to handle this themselves"
 *     because she said the arrangement had been set up through self service.
 *   - The recap said she "set up a payment arrangement". It already existed.
 *   - The QA form scored "Heard 1 of 6" disclosures, because "payment plan"
 *     read as a rate plan call, and said the branded greeting was missing
 *     while the reader praised the same greeting.
 *   - "Tell the customer exactly what happens next" on a call that ended
 *     with the amount and the date it is due.
 *
 * The call below is written for this file to the same shape. No real
 * transcript is kept in the repo.
 */

// Written for these tests, not a real call. Shared with call-scorecard.test.js.
const ARRANGEMENT_CALL = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'arrangement-call.txt'), 'utf8');

const VERINT_EXPORT = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'verint-export.txt'), 'utf8');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metric-profiles.module.js');
    t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-verification.module.js');
    t.loadModule('modules/call-explanation.module.js');
    t.loadModule('modules/call-red-flags.module.js');
    t.loadModule('modules/call-qa.module.js');
    t.loadModule('modules/call-word-choice.module.js');
    t.loadModule('modules/call-summary.module.js');
    t.loadModule('modules/call-time-ledger.module.js');
    t.loadModule('modules/call-coaching-bridge.module.js');
    t.loadModule('modules/call-listening.module.js');
    return global.window.DevCoachModules;
}

const keys = (items) => (items || []).map(item => item.key);

suite('reader accuracy: self service is praised only when she points the customer to it', (t) => {
    const { callTranscript: T } = load(t);
    const analysis = T.analyzeTranscript(ARRANGEMENT_CALL, { associateName: 'Dana Lopez' });
    t.check('saying how the arrangement was set up is not teaching self service',
        !keys(analysis.allStrengths).includes('education'));

    const taught = T.analyzeTranscript([
        '00:04', 'thank you for calling APS my name is dana how can i help you',
        '00:09', 'hi i want to pay my bill',
        '00:20', 'sure and next time you can pay it on the app in about a minute',
        '00:30', 'oh great thank you'
    ].join('\n'), { associateName: 'Dana Lopez' });
    t.check('pointing the customer to the app still is', keys(taught.allStrengths).includes('education'));
});

suite('reader accuracy: an amount and the date it is due are next steps', (t) => {
    const { callTranscript: T, callQa: Q } = load(t);
    const analysis = T.analyzeTranscript(ARRANGEMENT_CALL, { associateName: 'Dana Lopez' });
    t.check('no "tell the customer what happens next" on a call that gave the due date',
        !keys(analysis.allImprovements).includes('nextSteps'));
    t.check('and it is praised instead', keys(analysis.allStrengths).includes('nextSteps'));

    const qa = Q.scoreCall(ARRANGEMENT_CALL, { associateName: 'Dana Lopez' });
    const process = qa.checks.find(item => item.id === 'process');
    t.check('the QA form does not say no next step was heard',
        !/No clear "here is what happens next"/.test(process.detail));
    t.equal('"so what happened was..." is the reasoning, so the process row is met', process.verdict, 'met');
});

suite('reader accuracy: one greeting rule for the reader and the QA form', (t) => {
    const { callTranscript: T, callQa: Q } = load(t);
    const analysis = T.analyzeTranscript(ARRANGEMENT_CALL, { associateName: 'Dana Lopez' });
    t.check('the reader praises "thank you for being a part of APS, this is Dana"',
        keys(analysis.allStrengths).includes('greeting'));

    const qa = Q.scoreCall(ARRANGEMENT_CALL, { associateName: 'Dana Lopez' });
    const disclosures = qa.checks.find(item => item.id === 'disclosures');
    t.check('the QA form hears the same greeting', !(disclosures.missed || []).some(label => /greeting/i.test(label)));
    t.check('a rival company greeting is no greeting',
        !T.GREETING_PATTERN.test('hi there how are you doing today'));
    t.check('"how can i assist" counts', T.GREETING_PATTERN.test('this is sam how can i assist you'));
});

suite('reader accuracy: a payment plan is not a rate plan', (t) => {
    const { callQa: Q } = load(t);
    const qa = Q.scoreCall(ARRANGEMENT_CALL, { associateName: 'Dana Lopez' });
    const disclosures = qa.checks.find(item => item.id === 'disclosures');
    const asked = (disclosures.heard || []).concat(disclosures.missed || []);
    t.check('no rate plan disclosures asked for on a payment arrangement call',
        !asked.some(label => /rate|plan can be changed|plan takes effect|review it themselves/i.test(label)));
    t.check('so the disclosures row is met', disclosures.verdict === 'met');
    t.check('and talking an arrangement through is not "no plan or program offered"',
        !qa.callOpportunities.some(item => /Offering Missed/.test(item.label)));

    const ratePlanCall = [
        '00:04', 'thank you for calling APS my name is dana how can i help you',
        '00:09', 'hi i want to change my rate plan',
        '00:30', 'sure we have three energy plans available and the time of use plan has a lower rate at night',
        '01:10', 'okay i will take that one'
    ].join('\n');
    const rate = Q.scoreCall(ratePlanCall, { associateName: 'Dana Lopez' }).checks.find(item => item.id === 'disclosures');
    t.check('a rate plan call still asks for the rate plan disclosures',
        (rate.missed || []).concat(rate.heard || []).some(label => /rates quoted/i.test(label)));
});

suite('reader accuracy: the recap says she went over an arrangement she did not set up', (t) => {
    const { callSummary: S } = load(t);
    const summary = S.summarizeCall(ARRANGEMENT_CALL, { associateName: 'Dana Lopez' });
    const labels = summary.actions.map(action => action.label);
    t.check('not "set up a payment arrangement"', !labels.includes('set up a payment arrangement'));
    t.check('"went over the payment arrangement" instead', labels.includes('went over the payment arrangement'));

    const setUp = S.summarizeCall([
        '00:04', 'thank you for calling APS my name is dana how can i help you',
        '00:09', 'hi i cannot afford my whole bill this month',
        '00:30', 'okay i can set up a payment arrangement for you so you pay half now and half next month',
        '01:10', 'okay thank you'
    ].join('\n'), { associateName: 'Dana Lopez' });
    t.check('one she set up is still "set up a payment arrangement"',
        setUp.actions.map(action => action.label).includes('set up a payment arrangement'));
});

suite('reader accuracy: the Verint page footer is not part of the call', (t) => {
    const { callTranscript: T } = load(t);
    const body = T.prepareForPrompt(ARRANGEMENT_CALL);
    t.check('"1:1 Meeting Template" is dropped', !/Meeting Template/.test(body));
    t.check('the hyphenated name under it is dropped', !/Lopez-Garcia/.test(body));
    t.check('the last line of the call is kept', /it is my pleasure/.test(body));
});

suite('reader accuracy: a call far over the handle time goal is never "outstanding"', (t) => {
    const { callTranscript: T } = load(t);
    const analysis = T.analyzeTranscript(VERINT_EXPORT, {});
    t.check('the 18 minute sample call does not open "Outstanding call"', !/^Outstanding/.test(analysis.headline || ''));
    t.check('nor "Really strong call"', !/^Really strong/.test(analysis.headline || ''));

    const length = analysis.allImprovements.find(item => item.key === 'callLength');
    t.check('the call length against the goal is a point', Boolean(length));
    t.check('said in minutes, the call and the goal', length && /about 18 minutes/.test(length.text) && /about seven minutes/.test(length.text));
    t.check('with the part that sat on hold or quiet', length && /on hold or in quiet stretches/.test(length.text));
    t.check('the goal is the year\'s handle time target, not a constant',
        (() => {
            const before = global.window.DevCoachModules.metricProfiles.getYearTarget;
            global.window.DevCoachModules.metricProfiles.getYearTarget = (key) => (key === 'aht' ? { type: 'max', value: 1200 } : null);
            const relaxed = T.analyzeTranscript(VERINT_EXPORT, {});
            global.window.DevCoachModules.metricProfiles.getYearTarget = before;
            return !relaxed.allImprovements.some(item => item.key === 'callLength');
        })());

    const short = T.analyzeTranscript(ARRANGEMENT_CALL, { associateName: 'Dana Lopez' });
    t.check('an 8 minute call is not marked down for length', !keys(short.allImprovements).includes('callLength'));
});

suite('reader accuracy: the app email says its opening once and keeps only clean quotes', (t) => {
    const { callListening: L } = load(t);
    const message = L.buildCallFeedbackMessage({
        employeeName: 'Dana Lopez',
        listenedOn: '2026-09-29',
        whatWentWell: [
            'Solid call, and there are a few things in here you should keep doing.',
            '',
            '- You confirmed who you were talking to before anything on the account came up. ("and the last four digits of your social please")',
            '- Nice add. ("thank you okay one second it looks like somebody did - self service to enroll - a payment arrangement on july...")'
        ].join('\n'),
        improvementAreas: '- Ask if there is anything else before you wrap up.'
    });
    t.check('the auto headline is not followed by a second opener saying the same',
        !/It was a strong call|There are things in there that worked|There was a lot in it I liked|It was a great listen/.test(message));
    t.check('the opening still names the call', /I reviewed a call you took on/.test(message));
    t.check('the headline still leads the praise', /Solid call, and there are a few things/.test(message));
    t.check('a short clean quote stays', /"and the last four digits of your social please"/.test(message));
    t.check('a garbled speech to text quote is left out', !/somebody did - self service/.test(message));
});

suite('reader accuracy: grammar on the call screens', (t) => {
    const { callQa: Q, callSummary: S, callListening: L, callCoachingBridge: B } = load(t);

    const one = Q.scoreCall([
        '00:04', 'thank you for calling APS my name is dana how can i help you',
        '00:09', 'hi i have a question about my bill',
        '00:20', 'sure your bill is ninety dollars',
        '00:30', 'okay thanks'
    ].join('\n'), { associateName: 'Dana Lopez' }).checks.find(item => item.id === 'disclosures');
    t.check('never "All 1 disclosures"', !/All 1 disclosures/.test(one.detail));

    const summary = S.summarizeCall([
        '00:04', 'thank you for calling APS my name is dana how can i help you',
        '00:09', 'hi i have a question about my bill this month.',
        '00:20', 'sure your bill is ninety dollars',
        '00:30', 'okay thanks'
    ].join('\n'), { associateName: 'Dana Lopez' });
    t.check('no doubled full stop after the opening quote', !/\."\./.test(S.buildSummaryText(summary)));

    const prompt = L.buildCoachingSummaryPrompt
        ? L.buildPrompt?.({ employeeName: 'Dana Lopez', whatWentWell: '- Good', improvementAreas: '- Recap' }, 'Dana')
        : '';
    t.check('the Copilot prompt does not guess a pronoun', !prompt || !/\bshe should\b/.test(prompt));

    const message = B.buildMetricMessage({
        metricKey: 'aht', label: 'Average Handle Time', headline: '', evidence: [],
        tips: [{ id: 'x', metricKey: 'aht', text: 'Say what you are doing while the system loads.' }]
    }, { preferredName: 'Dana' });
    t.check('one tip is "give that a try", not "try those out"', !/Try those out/.test(message));
});
