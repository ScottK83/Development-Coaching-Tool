'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-word-choice.module.js');
    return global.window.DevCoachModules;
}

function tokens(text) {
    return String(text)
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean);
}

suite('call word choice: Verint phrase syntax', (t) => {
    const { callWordChoice } = load(t);

    const plain = callWordChoice.compilePhrase('unfortunately');
    t.check('plain phrase matches', plain.test(tokens('Unfortunately, that is not available.')));
    t.check('plain phrase does not match absent text', !plain.test(tokens('Let me see what I can do.')));

    // Whole-token matching, so a phrase cannot match inside a longer word.
    const anError = callWordChoice.compilePhrase('an error');
    t.check('"an error" matches the phrase', anError.test(tokens('I am seeing an error on the account.')));
    t.check('"an error" does not match inside "man errors"', !anError.test(tokens('The man errors on the side of caution.')));

    // Punctuation is flattened on both sides, so the apostrophe forms agree.
    const cant = callWordChoice.compilePhrase("we can't");
    t.check('apostrophes normalize on both sides', cant.test(tokens("Sorry, we can't do that today.")));

    const near = callWordChoice.compilePhrase('wasting NEAR "my time"');
    t.check('NEAR matches inside the window', near.test(tokens('You are wasting my time here.')));
    t.check('NEAR matches with words between', near.test(tokens('This is wasting a whole lot of my time.')));
    t.check(
        'NEAR does not match when the terms are far apart',
        !near.test(tokens('wasting one two three four five six seven eight nine my time'))
    );
    t.check('NEAR needs both terms', !near.test(tokens('You are wasting everything.')));
    t.equal('NEAR display drops the operator', near.display, 'wasting ... "my time"');

    // The one that matters most: an unguarded match here coaches an associate
    // for the customer saying "that is not your fault".
    const notin = callWordChoice.compilePhrase('your fault NOTIN "not your fault"');
    t.check('NOTIN matches the bare phrase', notin.test(tokens('This is your fault and you know it.')));
    t.check('NOTIN suppresses the excluded context', !notin.test(tokens('I know it is not your fault.')));
    t.equal('NOTIN display drops the exclusion', notin.display, 'your fault');

    t.equal('an empty phrase compiles to nothing', callWordChoice.compilePhrase('   '), null);
});

suite('call word choice: scoring a call', (t) => {
    const { callWordChoice } = load(t);

    const CALL = [
        'Agent: Thank you for calling, my name is Jamie. How can I help you today?',
        'Customer: My bill doubled and this is ridiculous, I am really upset about it.',
        'Agent: Unfortunately that is our policy on the rate change.',
        'Customer: You people never explain anything.',
        'Agent: I completely understand how frustrating that is. Let me see what I can do for you.',
        'Agent: I have taken care of the credit, of course.',
        'Customer: You have been very helpful, I really appreciate it.'
    ].join('\n');

    const scan = callWordChoice.scanTranscript(CALL, { associateName: 'Jamie' });

    t.check('scan succeeds', scan.ok === true);
    t.equal('labelled transcript is reported as labelled', scan.attribution, 'labeled');

    const negatives = scan.negativeA.map(hit => hit.phrase);
    t.check('picks up "unfortunately" on the agent side', negatives.includes('unfortunately'));
    t.check('picks up "our policy" on the agent side', negatives.includes('our policy'));

    const positives = scan.positiveA.map(hit => hit.phrase);
    t.check('picks up "of course" on the agent side', positives.includes('of course'));
    t.check('picks up "taken care" on the agent side', positives.includes('taken care'));
    t.check('picks up "what I can do" on the agent side', positives.includes('what I can do'));

    // The customer's praise belongs to the customer, and must not be counted
    // as something the associate said.
    t.check('customer praise lands on the customer side', scan.positiveC.some(hit => hit.phrase === 'very helpful'));
    t.check('customer praise is not credited to the agent', !positives.includes('very helpful'));

    t.check('every negative hit carries the line that triggered it', scan.negativeA.every(hit => hit.quote.length > 0));

    // "ridiculous" and "really upset" are both emotion cues in the same turn,
    // and empathy arrives two turns later, so that one is acknowledged.
    t.check('finds the customer emotion cues', scan.totals.emotionCues >= 2);
    t.check('the acknowledged cue is marked acknowledged', scan.emotions.cues.some(cue => cue.answered));
});

suite('call word choice: managing emotions', (t) => {
    const { callWordChoice } = load(t);

    const IGNORED = [
        'Agent: Thank you for calling, my name is Jamie.',
        'Customer: This is totally unacceptable and I am very unhappy.',
        'Agent: Can I have your account number.',
        'Agent: Right, the balance is two hundred dollars.',
        'Agent: Is there anything else.'
    ].join('\n');

    const ignored = callWordChoice.scanTranscript(IGNORED, { associateName: 'Jamie' });
    t.check('an unacknowledged cue is flagged', ignored.totals.emotionCuesUnanswered >= 1);
    t.check('the unanswered cue quotes the customer', ignored.emotions.unanswered[0].quote.length > 0);

    const ANSWERED = [
        'Agent: Thank you for calling, my name is Jamie.',
        'Customer: This is totally unacceptable and I am very unhappy.',
        'Agent: I am so sorry about that, I completely understand how frustrating this is.',
        'Agent: Let me take care of it for you now.'
    ].join('\n');

    const answered = callWordChoice.scanTranscript(ANSWERED, { associateName: 'Jamie' });
    t.equal('an acknowledged cue is not flagged', answered.totals.emotionCuesUnanswered, 0);
    t.check('the acknowledgement is quoted back', answered.emotions.cues[0].response.length > 0);
});

suite('call word choice: unused positive phrases', (t) => {
    const { callTranscript, callWordChoice } = load(t);

    // A call that resolves but never offers further help, so the "anything
    // else" family is the gap the associate actually had room for.
    const NO_CLOSE = [
        'Agent: Thank you for calling, my name is Jamie.',
        'Customer: I need to change my due date.',
        'Agent: I can help with that. Let me pull up the account.',
        'Agent: That is updated for the 20th.',
        'Customer: Great, thanks.'
    ].join('\n');

    const analysis = callTranscript.analyzeTranscript(NO_CLOSE, { associateName: 'Jamie' });
    const scan = callWordChoice.scanTranscript(NO_CLOSE, { associateName: 'Jamie', analysis });

    t.check('suggests unused positive phrases', scan.unusedPositives.length > 0);
    t.check('the list stays short enough to act on', scan.unusedPositives.length <= 5);
    t.check(
        'a phrase the associate actually used is never suggested',
        !scan.unusedPositives.some(item => scan.positiveA.some(hit => hit.raw === item.phrase))
    );
    t.check(
        'the missed close is ranked first',
        /anything else|questions or concerns|answered questions/i.test(scan.unusedPositives[0].phrase)
    );
    t.check('the suggestion says where it fits', scan.unusedPositives[0].zone.length > 0);

    // "anything else", "anything else help" and "anything else you" are three
    // entries on Verint's list and one thing to say.
    const phrases = scan.unusedPositives.map(item => item.phrase);
    const overlapping = phrases.filter((phrase, index) => phrases.some((other, otherIndex) =>
        otherIndex !== index && ` ${other} `.includes(` ${phrase} `)
    ));
    t.equal('near duplicate phrasings collapse to one', overlapping.length, 0);
});

suite('call word choice: output and edge cases', (t) => {
    const { callWordChoice } = load(t);

    t.check('empty transcript reports why', callWordChoice.scanTranscript('').reason === 'empty');
    t.equal('empty transcript produces no text', callWordChoice.buildWordChoiceText({ ok: false }), '');

    const CALL = [
        'Agent: Unfortunately our policy is firm on that.',
        'Customer: This is ridiculous.'
    ].join('\n');

    const scan = callWordChoice.scanTranscript(CALL, { associateName: 'Jamie' });
    const text = callWordChoice.buildWordChoiceText(scan);

    t.check('text names the negative phrases', /unfortunately/.test(text));
    t.check('text quotes the line', /"/.test(text));
    t.check('no em dashes in the output', !/[—–]/.test(text));

    const html = callWordChoice.buildWordChoiceHtml(scan, (value) => String(value || ''));
    t.check('html renders groups', /call-trend-group/.test(html));

    // A duplicated phrase in a hand-edited list must not double up.
    const dupes = callWordChoice.scanTranscript('Agent: Unfortunately that is all.', {
        associateName: 'Jamie',
        phraseDatabase: {
            positive: { A: [], C: [] },
            negative: { A: ['unfortunately', 'Unfortunately'], C: [] },
            emotions: { C: [] }
        }
    });
    t.equal('a duplicated phrase is only reported once', dupes.negativeA.length, 1);

    // An unlabelled transcript still scans, but says the sides were guessed.
    const unlabelled = callWordChoice.scanTranscript(
        'Thank you for calling, my name is Jamie.\nUnfortunately our policy is firm.',
        { associateName: 'Jamie' }
    );
    t.equal('unlabelled attribution is reported', unlabelled.attribution, 'inferred');
    t.check('the caveat reaches the output', /sides were inferred/.test(callWordChoice.buildWordChoiceText(unlabelled)));
});

suite('call word choice: the phrase lists', (t) => {
    const { sentiment, callWordChoice } = load(t);

    const db = sentiment.getPhraseDatabase();
    t.check('falls back to the shipped lists', db.positive.A.length > 0);
    t.check('word choice reads the same lists', callWordChoice.getPhraseDatabase().positive.A.length === db.positive.A.length);

    // Every shipped phrase has to compile, or it is silently never scored.
    const all = [...db.positive.A, ...db.positive.C, ...db.negative.A, ...db.negative.C, ...db.emotions.C];
    const broken = all.filter(phrase => !callWordChoice.compilePhrase(phrase));
    t.equal('every shipped phrase compiles', broken.length, 0);

    // "no problem" scores in the associate's favour on Verint's positive list,
    // so no tip may coach against it.
    t.check('"no problem" is still on the positive list', db.positive.A.some(p => /^no problem$/i.test(p)));
});
