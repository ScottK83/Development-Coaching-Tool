'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-verification.module.js');
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
    t.check('picks up "taken care" on the agent side', positives.includes('taken ... care'));
    t.check('picks up "what I can do" on the agent side', positives.includes('what I can do'));
    // Natural speech against a NEAR query, which the flattened list missed.
    t.check('picks up "How can I help you today?" as how NEAR help', positives.includes('how ... help'));

    // The customer's praise belongs to the customer, and must not be counted
    // as something the associate said.
    t.check('customer praise lands on the customer side', scan.positiveC.some(hit => hit.phrase === 'very ... helpful'));
    t.check('customer praise is not credited to the agent', !positives.includes('very ... helpful'));

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

suite('call word choice: a close she made is not a close she missed', (t) => {
    const { callWordChoice } = load(t);

    // She said "anything else". Its relatives on the list ("anything else
    // help", "anything else you") used to be reported as never said, and the
    // metric message told her so.
    const CLOSED = [
        'Agent: Thank you for calling, my name is Jamie, how can I help?',
        'Customer: I need to change my due date.',
        'Agent: That is updated for the 20th.',
        'Customer: Great, thanks.',
        'Agent: You are welcome, is there anything else I can help you with today?',
        'Customer: No, that is it.'
    ].join('\n');

    const scan = callWordChoice.scanTranscript(CLOSED, { associateName: 'Jamie' });
    t.check('she is credited with the close', scan.positiveA.some(hit => /anything else/i.test(hit.phrase)));
    t.equal('no phrase from the anything-else family is suggested',
        scan.unusedPositives.filter(item => /anything else/i.test(item.phrase)).map(item => item.phrase).join(', ') || '(none)', '(none)');
    t.check('nothing is suggested for the close she already made',
        !scan.unusedPositives.some(item => item.zone === 'closing the call'));
});

suite('call word choice: the positive list is Verint\'s queries, operators kept', (t) => {
    const { sentiment, callWordChoice } = load(t);
    const db = sentiment.getPhraseDatabase();
    const compiled = db.positive.A.map(phrase => callWordChoice.compilePhrase(phrase));
    const scores = (text) => compiled.filter(phrase => phrase.test(tokens(text))).map(phrase => phrase.raw);

    // Stored flattened, "how NEAR help" was the literal "how help" and the
    // most common sentence on any call never scored.
    t.check('"How can I help you today?" scores', scores('How can I help you today?').includes('how NEAR help'));
    t.check('"Have a wonderful day" scores', scores('Have a wonderful day').includes('have NEAR wonderful'));
    t.check('"I\'d be happy to help" scores as happy NEAR help', scores("I'd be happy to help").includes('happy NEAR help'));
    t.check('"Thank you for being a part of APS" scores', scores('Thank you for being a part of APS').includes('"thank you" NEAR part'));
    t.check('"I\'ll take care of that for you" scores', scores("I'll take care of that for you").includes('"take care" NEAR "for you"'));
    t.check('nothing scores off unrelated speech', scores('The meter was read on the fourth.').length === 0);

    t.equal('44 associate phrases, as exported', db.positive.A.length, 44);
    t.equal('3 customer phrases, as exported', db.positive.C.length, 3);
    t.check('the customer phrases carry the closing rule', db.positive.C.every(phrase => /^\[END:100\]/.test(phrase)));
    t.check('"lovely" carries the closing rule', db.positive.A.includes('[END:100] lovely'));
});

suite('call word choice: [END:100] only counts in the last 100 seconds', (t) => {
    const { callWordChoice } = load(t);

    const lovely = callWordChoice.compilePhrase('[END:100] lovely');
    t.equal('the rule is read', lovely.endWithin, 100);
    t.equal('and kept out of the display', lovely.display, 'lovely');
    t.check('counts inside the window', lovely.test(tokens('Have a lovely day'), { secondsFromEnd: 20 }));
    t.check('not outside it', !lovely.test(tokens('What a lovely morning'), { secondsFromEnd: 300 }));
    t.check('applied only when there is a time to measure', lovely.test(tokens('Have a lovely day')));

    const CALL = [
        '0:05', 'Agent: Thank you for calling APS, my name is Jamie.',
        '0:20', 'Customer: Lovely weather today, I need to move my service.',
        '2:10', 'Agent: That is set for the 20th.',
        '6:00', 'Customer: You have been very helpful, I really appreciate it.',
        '6:05', 'Agent: Have a lovely day.'
    ].join('\n');
    const scan = callWordChoice.scanTranscript(CALL, { associateName: 'Jamie' });
    t.check('the associate\'s closing "lovely" scores', scan.positiveA.some(hit => hit.raw === '[END:100] lovely'));
    t.check('the customer\'s thanks at the close scores', scan.positiveC.some(hit => /really appreciate/.test(hit.raw)));

    const EARLY = [
        '0:05', 'Agent: Thank you for calling APS, my name is Jamie. Lovely to talk to you.',
        '0:20', 'Customer: I need to move my service.',
        '2:10', 'Agent: That is set for the 20th.',
        '6:00', 'Customer: Okay.',
        '6:05', 'Agent: Bye now.'
    ].join('\n');
    const early = callWordChoice.scanTranscript(EARLY, { associateName: 'Jamie' });
    t.check('"lovely" six minutes from the end does not score', !early.positiveA.some(hit => hit.raw === '[END:100] lovely'));
});

suite('call word choice: every positive phrase has a sentence that scores', (t) => {
    const { sentiment, callWordChoice } = load(t);
    const db = sentiment.getPhraseDatabase();

    const missing = db.positive.A.filter(phrase => !sentiment.examplePhraseFor(phrase));
    t.equal(`every associate phrase has an example (${missing.join(', ') || 'all do'})`, missing.length, 0);

    // The example is what gets quoted to the associate, so it has to be
    // something that would actually score, or the coaching is wrong.
    const failing = db.positive.A.filter(phrase => {
        const example = sentiment.examplePhraseFor(phrase);
        return example && !callWordChoice.compilePhrase(phrase).test(tokens(example));
    });
    t.equal(`every example scores for its own phrase (${failing.join(', ') || 'all do'})`, failing.length, 0);

    t.check('no example carries an em dash', !db.positive.A.some(phrase => /[—–]/.test(sentiment.examplePhraseFor(phrase))));

    // The old flattened spelling finds the same example, so a list stored
    // before the fix still quotes a sentence.
    t.equal('the flattened spelling finds the same example', sentiment.examplePhraseFor('how help'), sentiment.examplePhraseFor('how NEAR help'));
});

suite('call word choice: suggestions quote a sentence, not a query', (t) => {
    const { callTranscript, callWordChoice } = load(t);

    const NO_CLOSE = [
        'Agent: Thank you for calling, my name is Jamie.',
        'Customer: I need to change my due date.',
        'Agent: That is updated for the 20th.',
        'Customer: Great, thanks.'
    ].join('\n');
    const analysis = callTranscript.analyzeTranscript(NO_CLOSE, { associateName: 'Jamie' });
    const scan = callWordChoice.scanTranscript(NO_CLOSE, { associateName: 'Jamie', analysis });

    t.check('there are suggestions', scan.unusedPositives.length > 0);
    t.check('none of them shows Verint syntax', !scan.unusedPositives.some(item => /NEAR|\.\.\.|\[END/.test(item.example)));
    const text = callWordChoice.buildWordChoiceText(scan);
    t.check('the text quotes the sentence', scan.unusedPositives.every(item => text.includes(`"${item.example}"`)));

    // Said in natural words, the scored phrase is credited and not suggested back.
    const WONDERFUL = [
        'Agent: Thank you for calling, my name is Jamie, how can I help?',
        'Customer: I need to change my due date.',
        'Agent: That is updated for the 20th. Is there anything else I can help you with?',
        'Customer: No, that is it.',
        'Agent: Have a wonderful day.'
    ].join('\n');
    const said = callWordChoice.scanTranscript(WONDERFUL, { associateName: 'Jamie' });
    t.check('"Have a wonderful day" is credited', said.positiveA.some(hit => hit.raw === 'have NEAR wonderful'));
    t.check('and never suggested back to her', !said.unusedPositives.some(item => item.phrase === 'have NEAR wonderful'));
});

suite('call word choice: every Positive Word tip uses a phrase that scores', (t) => {
    const fs = require('fs');
    const path = require('path');
    const { ROOT } = require('./harness');
    const { sentiment, callWordChoice } = load(t);
    const compiled = sentiment.getPhraseDatabase().positive.A.map(phrase => callWordChoice.compilePhrase(phrase));

    const tips = fs.readFileSync(path.join(ROOT, 'tips.csv'), 'utf8')
        .split(/\r?\n/)
        .filter(line => line.startsWith('positiveWord,'))
        .map(line => line.slice('positiveWord,'.length));

    t.check('there are Positive Word tips', tips.length >= 40);
    // A tip for this metric that names no scored phrase cannot move it.
    // "Replace 'problem' with 'situation'" was one: neither word is on the list.
    const unscored = tips.filter(tip => !compiled.some(phrase => phrase.test(tokens(tip))));
    t.equal(`every tip names a scored phrase (${unscored.join(' | ') || 'all do'})`, unscored.length, 0);
});

suite('call word choice: a stored list is brought up to date, not overwritten', (t) => {
    const { sentiment } = load(t);

    const empty = sentiment.upgradePhraseDatabase({ positive: { A: [], C: [] }, negative: { A: [], C: [] }, emotions: { C: [] } });
    t.check('an all-empty list gets the shipped lists', empty.changed && empty.db.positive.A.length === 44);

    const old = sentiment.upgradePhraseDatabase({
        positive: { A: ['how help', 'absolutely', 'my own phrase'], C: ['very helpful'] },
        negative: { A: ['unfortunately'], C: [] },
        emotions: { C: ['frustrated'] }
    });
    t.check('the upgrade reports a change', old.changed);
    t.equal('a flattened phrase becomes its query', old.db.positive.A[0], 'how NEAR help');
    t.equal('a phrase that was already right is kept', old.db.positive.A[1], 'absolutely');
    t.equal('a phrase the supervisor added is kept as is', old.db.positive.A[2], 'my own phrase');
    t.equal('the customer side is upgraded too', old.db.positive.C[0], '[END:100] very NEAR helpful');
    t.equal('nothing is added that was not there', old.db.positive.A.length, 3);

    const current = sentiment.upgradePhraseDatabase(empty.db);
    t.check('a current list is left alone, so boot never rewrites it', current.changed === false);
});

suite('call word choice: a Verint export pastes straight into Settings', (t) => {
    const { sentiment } = load(t);

    const EMAIL = [
        'Positive Words',
        'Knight, Scott<Scott.Knight@aps.com>',
        'Name',
        '+(A:"have" NEAR "wonderful")',
        '+(A:"my pleasure")',
        '+([END:100]C:"very" NEAR "helpful")',
        '+(A:"take care" NEAR "for you")',
        '+([END:100]A:lovely)',
        '+(A:don\'t NEAR worry)',
        'This message is for the designated recipient only and may contain confidential information.'
    ].join('\n');

    const parsed = sentiment.parsePhraseLines(EMAIL);
    t.equal('only the Verint lines are read', parsed.length, 6);
    t.equal('NEAR is kept', parsed[0].phrase, 'have NEAR wonderful');
    t.equal('a plain phrase loses its quotes', parsed[1].phrase, 'my pleasure');
    t.equal('the closing rule and the speaker are both read', `${parsed[2].speaker} ${parsed[2].phrase}`, 'C [END:100] very NEAR helpful');
    t.equal('a multi-word term stays quoted', parsed[3].phrase, '"take care" NEAR "for you"');
    t.equal('the rule on an associate line', `${parsed[4].speaker} ${parsed[4].phrase}`, 'A [END:100] lovely');
    t.equal('an apostrophe survives', parsed[5].phrase, "don't NEAR worry");

    // Hand-typed lists still work the way they always did.
    t.equal('hand-typed phrases still parse', sentiment.normalizePhraseList('happy to\nA: of course\n').join('|'), 'happy to|of course');

    // The Verint report upload carries the same lines.
    const report = sentiment.extractSentimentSpeakerAndPhrase('+([END:100]C:"really appreciate")');
    t.check('the report parser reads a line with a closing rule', report && report.speaker === 'C' && report.phrase === 'really appreciate');
});

suite('call word choice: the sentiment focus box suggests real phrases', (t) => {
    const { sentiment } = load(t);
    // A script.js global in the app; the builder falls back to its own
    // targets when the registry has none.
    global.METRICS_REGISTRY = global.METRICS_REGISTRY || {};

    const snapshot = {
        timeframeStart: '2026-09-01',
        timeframeEnd: '2026-09-30',
        topPhrases: { positiveA: [{ phrase: 'have" NEAR "wonderful', value: 12 }], negativeA: [{ phrase: 'unfortunately', value: 9 }], emotions: [] },
        suggestions: {}
    };
    const text = sentiment.buildSentimentFocusAreasForPrompt(snapshot, { positiveWord: 70, negativeWord: 70, managingEmotions: 99 });

    t.check('no filler in place of phrases', !/positive ownership phrases|solution-focused|collaborative phrasing/.test(text));
    t.check('positive additions are quoted sentences from the list', /Add these phrases to every call: "/.test(text));
    t.check('a phrase she already uses is not suggested again', !/Have a wonderful day/.test(text.split('Add these phrases')[1] || ''));
    t.check('negative swaps say what she CAN do', /Try saying this instead: "Let me see what I can do"/.test(text));
});
