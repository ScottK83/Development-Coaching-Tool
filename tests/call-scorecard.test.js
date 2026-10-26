'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * THE SCORECARD
 *
 * Scott, 2026-10-25: "real actual measurable feedback". The same ten lines on
 * every call, each Yes, Missed, Didn't apply or Check with the time to listen
 * at, the numbers under them, and a click to correct any line. The corrected
 * card is what is saved, so whatever adds calls up reads what Scott confirmed.
 */

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
    t.loadModule('modules/call-scorecard.module.js');
    return global.window.DevCoachModules;
}

const verdictOf = (card, key) => (card.lines.find(item => item.key === key) || {}).verdict;
const lineOf = (card, key) => card.lines.find(item => item.key === key) || {};

suite('call scorecard: the same ten lines on every call', (t) => {
    const { callScorecard: S } = load(t);
    const expected = ['greeting', 'verified', 'empathy', 'hold', 'silence', 'explained', 'offered', 'nextSteps', 'recap', 'anythingElse'];
    [ARRANGEMENT_CALL, VERINT_EXPORT].forEach((call, index) => {
        const card = S.buildScorecard(call, {});
        t.check(`call ${index + 1} reads`, card.ok);
        t.equal(`call ${index + 1} has the ten lines in order`, card.lines.map(item => item.key).join(','), expected.join(','));
        t.check(`call ${index + 1}: every verdict is one of four`,
            card.lines.every(item => ['yes', 'missed', 'na', 'check'].includes(item.verdict)));
    });
    t.check('an empty paste is no card', !S.buildScorecard('   ', {}).ok);
});

suite('call scorecard: the payment arrangement call', (t) => {
    const { callScorecard: S } = load(t);
    const card = S.buildScorecard(ARRANGEMENT_CALL, { associateName: 'Dana Lopez' });

    t.equal('greeting: yes', verdictOf(card, 'greeting'), 'yes');
    t.equal('said at 0:04', lineOf(card, 'greeting').at, '0:04');
    t.equal('verified: yes', verdictOf(card, 'verified'), 'yes');
    t.equal('verified at 0:37', lineOf(card, 'verified').at, '0:37');
    t.equal('the customer got lost: explained is missed', verdictOf(card, 'explained'), 'missed');
    t.equal('at 5:33', lineOf(card, 'explained').at, '5:33');
    t.equal('next steps: yes, the amount and the due date', verdictOf(card, 'nextSteps'), 'yes');
    t.equal('recap: missed', verdictOf(card, 'recap'), 'missed');
    t.equal('anything else: missed', verdictOf(card, 'anythingElse'), 'missed');
    t.equal('no hold on the call: did not apply', verdictOf(card, 'hold'), 'na');
    t.equal('no option owed on an arrangement explained: did not apply', verdictOf(card, 'offered'), 'na');
    t.equal('the score counts only what applied', S.scoreText(card), '4 of the 7 that applied');
    t.equal('the call is about eight minutes', card.numbers.lengthSeconds, 439);
    t.equal('against the year\'s handle time goal', card.numbers.goalSeconds, 426);
});

suite('call scorecard: the long sample call', (t) => {
    const { callScorecard: S } = load(t);
    const card = S.buildScorecard(VERINT_EXPORT, {});

    t.equal('the long hold is a missed hold', verdictOf(card, 'hold'), 'missed');
    t.equal('at 4:30', lineOf(card, 'hold').at, '4:30');
    t.equal('the minute of quiet is missed', verdictOf(card, 'silence'), 'missed');
    t.equal('at 7:56', lineOf(card, 'silence').at, '7:56');
    t.equal('options laid out: offered is yes', verdictOf(card, 'offered'), 'yes');
    t.equal('recap: yes', verdictOf(card, 'recap'), 'yes');
    t.equal('one hold', card.numbers.holdCount, 1);
    t.equal('the call length', card.numbers.lengthSeconds, 1104);
    t.check('positive phrases counted', card.numbers.positivePhrases > 0);
    t.equal('no talk share without speaker labels', card.numbers.talkShare, null);
    t.check('a call far over goal names handle time among what to work on', S.missedMetrics(card).includes('aht'));
});

suite('call scorecard: what a transcript cannot show is Check, never Missed', (t) => {
    const { callScorecard: S } = load(t);
    const cut = [
        '00:04', 'thank you for calling APS my name is dana how can i help you',
        '00:09', 'hi i have a question about my bill',
        '00:20', 'sure your bill is ninety dollars and it is due on the fifth',
        '[transcript truncated for storage]'
    ].join('\n');
    const card = S.buildScorecard(cut, {});
    t.equal('a recap cut off the end is Check', verdictOf(card, 'recap'), 'check');
    t.equal('so is "anything else"', verdictOf(card, 'anythingElse'), 'check');
    t.equal('and quiet, with the end of the call gone', verdictOf(card, 'silence'), 'check');

    const untimed = S.buildScorecard([
        'Agent: thank you for calling APS my name is dana how can i help you',
        'Customer: hi what is my balance',
        'Agent: can i get your name and the last four of your social',
        'Customer: maria lopez four four one two',
        'Agent: thank you your balance is ninety dollars due on the fifth. is there anything else?'
    ].join('\n'), {});
    t.equal('no timestamps: quiet is Check', verdictOf(untimed, 'silence'), 'check');
});

suite('call scorecard: lost once on thin evidence is Check, not Yes', (t) => {
    const { callScorecard: S } = load(t);
    const card = S.buildScorecard([
        '00:04', 'thank you for calling APS my name is dana how can i help you',
        '00:09', 'hi why is my bill higher this month',
        '00:20', 'your budget billing amount was adjusted at your annual review',
        '00:31', 'what does that mean',
        '00:40', 'okay well is there anything else i can help you with today',
        '00:46', 'no thank you'
    ].join('\n'), {});
    t.equal('one "what does that mean" with no sign it landed: listen to it', verdictOf(card, 'explained'), 'check');
    t.equal('and when', lineOf(card, 'explained').at, '0:31');
});

suite('call scorecard: an account given away is a missed verification', (t) => {
    const { callScorecard: S } = load(t);
    const card = S.buildScorecard([
        '00:02', 'thank you for calling APS my name is dana how can i help you',
        '00:06', 'hi i need to know how much i owe',
        '00:10', 'sure can i have the address on the account',
        '00:15', 'four five six main street',
        '00:22', 'okay your balance is two hundred and twenty dollars due on the fifth'
    ].join('\n'), {});
    t.equal('verified: missed', verdictOf(card, 'verified'), 'missed');
    t.check('with the APS standard in the coaching',
        /last four of the social|driver'?s license|password/i.test(lineOf(card, 'verified').coachText));
});

suite('call scorecard: a click corrects a line, and the corrected card is what counts', (t) => {
    const { callScorecard: S } = load(t);
    const card = S.buildScorecard(ARRANGEMENT_CALL, {});

    t.equal('a click on Missed makes it Didn\'t apply', S.nextVerdict('missed'), 'na');
    t.equal('then Yes', S.nextVerdict('na'), 'yes');
    t.equal('then Missed', S.nextVerdict('yes'), 'missed');
    t.equal('and Check becomes Yes once listened to', S.nextVerdict('check'), 'yes');

    const fixed = S.applyCorrections(card, { recap: 'yes' });
    t.equal('the corrected line says what Scott said', verdictOf(fixed, 'recap'), 'yes');
    t.check('and says it was corrected', lineOf(fixed, 'recap').corrected === true);
    t.equal('the reader\'s answer is kept beside it', lineOf(fixed, 'recap').auto, 'missed');
    t.equal('the score moves with it', S.scoreText(fixed), '5 of the 7 that applied');
    t.equal('the corrections come back out to save', JSON.stringify(S.correctionsOf(fixed)), JSON.stringify({ recap: 'yes' }));

    const undone = S.applyCorrections(fixed, { recap: 'missed' });
    t.check('a correction back to the reader\'s answer is no correction', !lineOf(undone, 'recap').corrected);
    t.equal('and nothing is saved for it', JSON.stringify(S.correctionsOf(undone)), '{}');
});

suite('call scorecard: a correction writes the same words Analyze would', (t) => {
    const { callScorecard: S, callTranscript: T } = load(t);
    const card = S.buildScorecard(ARRANGEMENT_CALL, {});
    const recap = S.noteTextFor(lineOf(card, 'recap'));
    t.equal('the recap coaching is the reader\'s own line', recap.coach, T.ruleText('recap').missing);
    t.equal('and its praise', recap.praise, T.ruleText('recap').made);

    const verified = S.noteTextFor(lineOf(card, 'verified'));
    t.check('a line with no reader rule still has words both ways', Boolean(verified.coach && verified.praise));
});

suite('call scorecard: the Verint note and the card on screen', (t) => {
    const { callScorecard: S } = load(t);
    const card = S.buildScorecard(ARRANGEMENT_CALL, {});
    const text = S.buildScorecardText(card);
    t.check('the score leads', /^Scorecard: 4 of the 7 that applied\./.test(text));
    t.check('the misses are named with their times', /Missed: Explained so the customer followed \(5:33\)/.test(text));
    t.check('the numbers follow', /Call 7:19, goal 7:06/.test(text));
    t.check('no em or en dashes', !/[–—]/.test(text));

    // A saved card keeps keys and verdicts only; the labels come back.
    const saved = { lines: card.lines.map(item => ({ key: item.key, verdict: item.verdict, auto: item.auto, at: item.at })), numbers: card.numbers };
    t.check('a saved card still names its misses', /Missed: Explained so the customer followed/.test(S.buildScorecardText(saved)));

    const html = S.buildScorecardHtml(card, (value) => String(value).replace(/</g, '&lt;').replace(/"/g, '&quot;'));
    t.equal('one mark to click per line', (html.match(/class="call-score-chip/g) || []).length, 10);
    t.check('each says which line it is', /data-score-key="recap"/.test(html));
    t.check('the score is on the card', html.includes('4 of the 7 that applied'));
    t.check('built from the kit, not inline colours', !/color:\s*#|background:\s*#/i.test(html));
    t.check('says the sides were worked out when they were', /Speakers were worked out/.test(html));
});
