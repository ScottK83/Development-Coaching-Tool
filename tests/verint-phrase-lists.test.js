'use strict';

/**
 * The three Verint phrase lists, checked against Scott's own exports
 * (10/05/2026): positive and negative pasted from email, emotions read off
 * a screenshot of the report.
 *
 * The shipped lists used to be retyped by hand with the operators stripped,
 * so "how NEAR help" was the literal "how help" and every emotion phrase was
 * filed as customer-only. These pin the lists to the export, and pin what
 * Verint's tags mean: C is the customer only, A the associate only, and no
 * tag is EITHER side.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-verification.module.js');
    t.loadModule('modules/call-word-choice.module.js');
    return global.window.DevCoachModules;
}

function tokens(text) {
    return String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
}

const POSITIVE_EXPORT = `Positive Words
Name
+(A:"have" NEAR "wonderful")
+(A:"my pleasure")
+(A:"thank you" NEAR "being")
+(A:"questions or concerns")
+(A:what NEAR can)
+(A:"thank you" NEAR "part")
+(A:do NEAR "for you")
+(A:"I can" NEAR help)
+(A:don't NEAR worry)
+(A:"what i can do")
+(A:"can" NEAR "definitely")
+(A:"what we can do")
+(A:how NEAR help)
+(A:absolutely)
+(A:"anything else")
+(A:"taken" NEAR "care")
+([END:100]C:"really appreciate")
+(A:"work" NEAR "you")
+(A:"anything else" NEAR "you")
+(A:"anything else" NEAR "help")
+(A:"you got it")
+(A:"happy to")
+([END:100]C:"very" NEAR "helpful")
+([END:100]C:"you've" NEAR "been")
+(A:"of course")
+(A:"no problem")
+(A:happy NEAR help)
+(A:take NEAR time)
+(A:enjoy)
+(A:certainly)
+(A:"here" NEAR "help")
+(A:"take care" NEAR "for you")
+(A:"took" NEAR "care")
+(A:happy NEAR assist)
+(A:"glad to")
+(A:perfectly)
+(A:"anything else" NEAR "do")
+(A:"let's make sure")
+(A:"answered" NEAR "questions")
+(A:"let's get")
+(A:"a pleasure")
+(A:congratulations)
+(A:"wish" NEAR "best")
+([END:100]A:lovely)
+(A:"being" NEAR "customer")
+(A:"you bet")
+(A:"appreciate" NEAR "business")
This message is for the designated recipient only.`;

const NEGATIVE_EXPORT = `Neg Words
+(A:"like i" NEAR "said")
+(A:"we don't have" NOTIN "we don't have to")
+(C:you NEAR understand)
+(A:"no" NEAR "way")
+(A:"we" NEAR "can't" NOTIN "what we can't")
A:"yes" NEAR "but"
+(A:"i can't" NEAR "do" NOTIN "what i can't do")
+(A:nothing NEAR do NOTIN "nothing do")
+(C:"i don't care")
A:"I understand" NEAR "but"
+(A:"don't do that")
+(A:"sorry but")
+(A:"you need to go" NOTIN "need to go over")
+(A:"no notes")
+(A:"i can't" NEAR "give")
+(A:unfortunately)
+(A:"i can't" NEAR "see")
A:"not sure"
+(A:"an error")
+(A:unable NEAR help)
+(A:trying NEAR help)
+(A:"any notes")
+(A:"i can't" NEAR "find")
+(A:"our policy")
+(A:"i can't" NEAR "tell")
+(C:"you don't care")
+(A:"can't" NEAR "provide")
+(C:not NEAR listening)
+(C:let NEAR finish)
+(A:"not my problem")
+(C:not NEAR helping)
+(C:"not helping")
+(A:sorry NEAR feel)
Tel 480.000.0000`;

// Copied out of the report spreadsheet, so each row brings its count.
const EMOTIONS_EXPORT = [
    '+(ridiculous)\t20', '+(screwed)\t13', '+(C:"your company")\t13', "+(can't NEAR believe)\t12",
    '+(fucking)\t12', '+(C:frustrated)\t11', '+("you people")\t10', '+("complaint")\t8', '+("bullshit")\t8',
    '+("i can\'t believe")\t8', '+(C:"not happy")\t7', '+(stupid)\t6', '+("not my fault")\t6',
    '+(C:frustrating)\t4', '+(what NEAR hell)\t4', 'C:seriously\t4', '+(C:"your fault" NOTIN "not your fault")\t3',
    '+(horrible)\t3', '+("our fault")\t2', '+("pissed off")\t2', '+(C:"you don\'t care")\t1',
    '+(C:"really upset")\t1', '+("fuck you")\t1', '+(cannot NEAR believe)\t1', '+("totally unacceptable")\t0',
    '+("very unhappy")\t0', '+(not NEAR "good enough")\t0', '+(C:"unacceptable")\t0', '+(wasting NEAR "my time")\t0',
    '+(C:"this" NEAR "B S")\t0', '+(C:"kill myself")\t0', '+(Monopoly)\t0', "+(i'm NEAR angry)\t0",
    '+(threatening)\t0', '+(stupidity)\t0'
].join('\n');

function bySide(parsed, fallback) {
    const out = { A: [], C: [], E: [] };
    parsed.forEach(item => out[item.speaker || fallback].push(item.phrase));
    return out;
}

suite('verint lists: the shipped lists are the exports, query for query', (t) => {
    const { sentiment } = load(t);
    const db = sentiment.getPhraseDatabase();
    const sorted = (list) => list.slice().sort().join(' | ');

    const positive = bySide(sentiment.parsePhraseLines(POSITIVE_EXPORT), 'A');
    t.equal('positive, associate', sorted(db.positive.A), sorted(positive.A));
    t.equal('positive, customer', sorted(db.positive.C), sorted(positive.C));

    const negative = bySide(sentiment.parsePhraseLines(NEGATIVE_EXPORT), 'A');
    t.equal('the three unwrapped lines are read too', negative.A.filter(p => /^(yes NEAR but|"I understand" NEAR but|not sure)$/.test(p)).length, 3);
    t.equal('negative, associate', sorted(db.negative.A), sorted(negative.A));
    t.equal('negative, customer', sorted(db.negative.C), sorted(negative.C));

    const emotions = bySide(sentiment.parsePhraseLines(EMOTIONS_EXPORT), 'E');
    t.equal('emotions, customer only', sorted(db.emotions.C), sorted(emotions.C));
    t.equal('emotions, either side', sorted(db.emotions.E), sorted(emotions.E));
    t.equal('no emotion phrase is associate-only', db.emotions.A.length, 0);
    t.equal('35 emotion phrases in all', db.emotions.C.length + db.emotions.E.length, 35);
    t.check('"bullshit" is one word, as Verint has it', db.emotions.E.includes('bullshit'));
});

suite('verint lists: NOTIN leaves the harmless version alone', (t) => {
    const { callWordChoice } = load(t);
    const hit = (query, text) => callWordChoice.compilePhrase(query).test(tokens(text));

    t.check('"we can\'t" flags', hit(`we NEAR can't NOTIN "what we can't"`, "Sorry, we can't do that today."));
    t.check('"what we can\'t" does not', !hit(`we NEAR can't NOTIN "what we can't"`, "Here's what we can't change, and here's what we can."));
    t.check('"we don\'t have" flags', hit(`we don't have NOTIN "we don't have to"`, "We don't have that plan anymore."));
    t.check('"we don\'t have to" does not', !hit(`we don't have NOTIN "we don't have to"`, "We don't have to do that today."));
    t.check('"you need to go" flags', hit('you need to go NOTIN "need to go over"', 'You need to go to the website for that.'));
    t.check('"need to go over" does not', !hit('you need to go NOTIN "need to go over"', 'You need to go over the bill with me.'));
    t.check('"there\'s nothing I can do" flags', hit('nothing NEAR do NOTIN "nothing do"', "There's nothing I can do about that."));
});

suite('verint lists: an untagged emotion phrase counts from either side', (t) => {
    const { callWordChoice } = load(t);

    const CALL = [
        'Agent: Thank you for calling APS, my name is Jamie.',
        'Customer: This is ridiculous, I am so frustrated.',
        'Agent: I know this is frustrating. I can\'t believe that happened to you.',
        'Customer: Thank you.',
        'Agent: I will file a complaint for you.'
    ].join('\n');
    const scan = callWordChoice.scanTranscript(CALL, { associateName: 'Jamie' });
    const fromAssociate = scan.emotionsA.map(hit => hit.raw);

    t.check('the customer\'s "ridiculous" is a cue', scan.emotions.cues.some(cue => cue.phrases.includes('ridiculous')));
    t.check('so is the customer-only "frustrated"', scan.emotions.cues.some(cue => cue.phrases.includes('frustrated')));
    t.check('the associate\'s "I can\'t believe" flags', fromAssociate.includes("i can't believe"));
    t.check('and "complaint" from the associate flags', fromAssociate.includes('complaint'));
    t.check('but the customer-only "frustrating" does not, from the associate', !fromAssociate.includes('frustrating'));
    t.check('the panel says so', /Emotion phrases the associate said/.test(callWordChoice.buildWordChoiceText(scan)));

    const cursing = callWordChoice.scanTranscript('Agent: What the fucking system did here is wrong.\nCustomer: Okay.', {
        associateName: 'Jamie'
    });
    t.check('profanity from the associate is masked before it is quoted', cursing.emotionsA.length > 0
        && cursing.emotionsA.every(hit => !/fuck/i.test(hit.said) && !/fuck/i.test(hit.quote)));
});

suite('verint lists: a negative hit quotes what was said, not the query', (t) => {
    const { callWordChoice } = load(t);
    const scan = callWordChoice.scanTranscript('Agent: Sorry, we really can\'t do that today.\nCustomer: Okay.', { associateName: 'Jamie' });
    const weCant = scan.negativeA.find(hit => /^we NEAR can't/.test(hit.raw));
    t.check('"we NEAR can\'t" fired', Boolean(weCant));
    t.equal('and quotes the words as spoken', weCant && weCant.said, "we really can't");
});

suite('verint lists: every Negative Word tip names a phrase on the list', (t) => {
    const { sentiment, callWordChoice } = load(t);
    const compiled = sentiment.getPhraseDatabase().negative.A.map(phrase => callWordChoice.compilePhrase(phrase));
    const tips = fs.readFileSync(path.join(ROOT, 'tips.csv'), 'utf8')
        .split(/\r?\n/)
        .filter(line => line.startsWith('negativeWord,'))
        .map(line => line.slice('negativeWord,'.length));

    t.check('there are Negative Word tips', tips.length >= 40);
    // A tip about a word Verint does not score cannot move this metric.
    // "Avoid 'actually'" and "Never say 'calm down'" were good advice under
    // the wrong metric; they live in Overall Sentiment now.
    const unscored = tips.filter(tip => !compiled.some(phrase => phrase.test(tokens(tip))));
    t.equal(`every tip names a listed phrase (${unscored.join(' | ') || 'all do'})`, unscored.length, 0);

    const overall = fs.readFileSync(path.join(ROOT, 'tips.csv'), 'utf8');
    t.check('the calm-down advice was kept, under Overall Sentiment', /\noverallSentiment,Never say 'Calm down'/.test(overall.replace(/\r\n/g, '\n')));
});

suite('verint lists: what we tell associates to say is not on the other lists', (t) => {
    const { sentiment, callWordChoice } = load(t);
    const db = sentiment.getPhraseDatabase();
    const flagged = [...db.negative.A, ...db.emotions.A, ...db.emotions.E].map(phrase => callWordChoice.compilePhrase(phrase));

    const offenders = db.positive.A
        .map(phrase => sentiment.examplePhraseFor(phrase))
        .filter(example => flagged.some(query => query.test(tokens(example))));
    t.equal(`no example sentence trips a negative or emotion phrase (${offenders.join(' | ') || 'none do'})`, offenders.length, 0);
});

suite('verint lists: stored lists are brought up to the exports', (t) => {
    const { sentiment } = load(t);

    // The emotions list exactly as it used to ship, all customer-only.
    const legacy = sentiment.upgradePhraseDatabase({
        positive: { A: ['absolutely'], C: [] },
        negative: { A: [], C: ['you understand', "i don't care", 'not helping', 'not helping', "you don't care", 'let finish', 'not listening'] },
        emotions: { C: ['frustrated', 'your company', 'frustrating', 'ridiculous', 'really upset', 'you people',
            'what NEAR hell', 'fuck you', 'not my fault', 'horrible', 'wasting NEAR "my time"', `this NEAR "B'S"`,
            'screwed', "you don't care", 'our fault', 'stupid', 'complaint', 'totally unacceptable',
            "can't NEAR believe", 'very unhappy', 'your fault NOTIN "not your fault"', 'not NEAR "good enough"',
            'cannot NEAR believe', 'not happy', 'seriously', 'pissed off', 'unacceptable', 'fucking',
            'kill myself', 'Monopoly', 'bull shit', "i'm NEAR angry"] }
    });
    t.check('the untouched old emotions list becomes the export', legacy.db.emotions.E.includes('bullshit') && legacy.db.emotions.E.includes('threatening'));
    t.check('with the either-side phrases out of the customer list', !legacy.db.emotions.C.includes('ridiculous'));
    t.equal('the old duplicate "not helping" becomes Verint\'s pair',
        legacy.db.negative.C.filter(p => /not( NEAR)? helping/.test(p)).sort().join(' | '), 'not NEAR helping | not helping');

    // An edited one keeps its edits and is split by Verint's tags.
    const edited = sentiment.upgradePhraseDatabase({
        positive: { A: ['absolutely'], C: [] },
        negative: { A: [], C: [] },
        emotions: { C: ['ridiculous', 'frustrated', 'my own cue'] }
    });
    t.equal('an either-side phrase moves to E', edited.db.emotions.E.join(','), 'ridiculous');
    t.equal('the rest stay customer-only', edited.db.emotions.C.join(','), 'frustrated,my own cue');

    const current = sentiment.upgradePhraseDatabase(legacy.db);
    t.check('and once current, nothing is rewritten at boot', current.changed === false);
});

suite('verint lists: the report upload reads untagged lines as either side', (t) => {
    const { sentiment } = load(t);
    const untagged = sentiment.extractSentimentSpeakerAndPhrase('+("you people")');
    t.check('an untagged line is either side', untagged && untagged.speaker === 'E' && untagged.phrase === 'you people');
    const bare = sentiment.extractSentimentSpeakerAndPhrase('C:seriously');
    t.check('a bare tagged line keeps its tag', bare && bare.speaker === 'C');
});

