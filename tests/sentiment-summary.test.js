'use strict';

/**
 * The sentiment summary, which had never been generated.
 *
 * generateSentimentSummary and generateSentimentCoPilotPrompt call
 * buildSentimentSummaryText and buildSentimentCopilotPrompt through their own
 * namespace. Neither existed anywhere in the codebase, so both buttons had only
 * ever produced their failure alert.
 *
 * They were broken twice over. CURSE_WORDS was referenced by
 * containsCurseWords and censorCurseWords and defined nowhere, so every call to
 * either threw a ReferenceError -- and all three section builders call them on
 * every phrase. Even with a composer, the sections could not have run.
 *
 * Two things this pins hardest, because both would be humiliating in front of
 * an associate:
 *
 *   POLARITY. On Positive Language a phrase used on 28 calls is a habit worth
 *   keeping. On Avoiding Negative Words the same shape is "unfortunately, 28
 *   times" -- a habit to break. Calling that "already landing" congratulates
 *   somebody for the exact thing the metric is docking them for.
 *
 *   SPEAKER. These reports carry the CUSTOMER's phrases alongside the
 *   associate's, tagged 'C' and 'A'. Quoting a customer's words back at the
 *   associate as though they said them is the worst thing this summary could do.
 */

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/metrics-registry.module.js');
    t.loadModule('modules/metric-profiles.module.js');
    global.METRICS_REGISTRY = global.window.METRICS_REGISTRY;

    // script.js declares these at top level and the sentiment module reads them
    // as bare globals. In the browser the two share one lexical scope, so this
    // is the architecture rather than a defect; loaded on its own the module
    // needs them supplied. Values copied from script.js.
    Object.assign(global, {
        TOP_PHRASES_COUNT: 5,
        MIN_PHRASE_VALUE: 0,
        SENTIMENT_IMPROVEMENT_THRESHOLD: 3,
        SENTIMENT_TOP_WINS_COUNT: 5,
        SENTIMENT_BOTTOM_COUNT: 5,
        SENTIMENT_UNUSED_SUGGESTIONS: 3,
        SENTIMENT_MIN_PHRASES_FOR_BOTTOM: 5,
        SENTIMENT_CUSTOMER_CONTEXT_COUNT: 3,
        SENTIMENT_EMOTION_LOW_THRESHOLD: 5,
        // The section builders reach for this one too.
        escapeHtml: (v) => String(v == null ? '' : v)
    });

    return t.loadModule('modules/sentiment.module.js').sentiment;
}

function report(pct, phrases) {
    return {
        associateName: 'Angelina Fierro',
        startDate: '2026-08-01', endDate: '2026-08-31',
        totalCalls: 212, callsDetected: 190, percentage: pct,
        phrases: phrases || []
    };
}

function helpers(s) {
    return {
        escapeHtml: (v) => String(v == null ? '' : v),
        buildPositiveLanguageSentimentSection: s.buildPositiveLanguageSentimentSection,
        buildNegativeLanguageSentimentSection: s.buildNegativeLanguageSentimentSection,
        buildManagingEmotionsSentimentSection: s.buildManagingEmotionsSentimentSection
    };
}

suite('sentiment summary: the profanity filter exists at all', (t) => {
    const s = load(t);

    // Both of these threw a ReferenceError on every call before CURSE_WORDS was
    // defined, which is what took the section builders down with them.
    let threw = false;
    try { s.containsCurseWords('happy to help'); } catch (e) { threw = true; }
    t.check('containsCurseWords runs', !threw);

    t.check('a clean phrase is clean', s.containsCurseWords('happy to help') === false);
    t.check('and a foul one is caught', s.containsCurseWords('this is bullshit') === true);
    t.check('case does not matter', s.containsCurseWords('This Is BULLSHIT') === true);
    t.check('censoring masks it', s.censorCurseWords('this is bullshit').indexOf('bullshit') === -1);
    t.check('and leaves the rest alone', s.censorCurseWords('this is bullshit').indexOf('this is') > -1);
    t.equal('a clean phrase is returned untouched',
        s.censorCurseWords('happy to help'), 'happy to help');
});

suite('sentiment summary: it says where all three stand', (t) => {
    const s = load(t);
    const built = s.buildSentimentSummaryText({
        positive: report(88.4, [{ phrase: 'happy to help', value: 41, speaker: 'A' }]),
        negative: report(74.2, [{ phrase: 'unfortunately', value: 28, speaker: 'A' }]),
        emotions: report(96.1, [{ phrase: 'i understand', value: 55, speaker: 'A' }])
    }, helpers(s));

    const text = built.summary;
    t.check('a summary was built at all', !!text);
    t.check('the associate is named', text.indexOf('Angelina Fierro') > -1);
    t.check('the period is stated', text.indexOf('2026-08-01 to 2026-08-31') > -1);
    t.check('and the volume behind it', text.indexOf('212 calls reviewed') > -1);

    // Each line carries figure, goal and verdict, so it cannot be read two ways.
    t.check('positive language, met', text.indexOf('Positive Language: 88.4% against a 86% goal, met') > -1);
    t.check('managing emotions, met', text.indexOf('Managing Emotions: 96.1% against a 95% goal, met') > -1);
    t.check('and the one that is short says how short',
        text.indexOf('Avoiding Negative Words: 74.2% against a 83% goal, 8.8 points under') > -1);

    // One focus, not three.
    t.check('the focus is the widest gap', text.indexOf('WHAT TO WORK ON') > -1
        && text.indexOf('Avoiding Negative Words. It is the widest gap') > -1);

    // The detailed sections still follow.
    t.check('the detail is attached', text.indexOf('POSITIVE LANGUAGE') > -1);
});

suite('sentiment summary: negative words are not praised', (t) => {
    const s = load(t);
    const built = s.buildSentimentSummaryText({
        positive: report(95, [{ phrase: 'happy to help', value: 41, speaker: 'A' }]),
        negative: report(60, [
            { phrase: 'unfortunately', value: 28, speaker: 'A' },
            { phrase: 'you have to', value: 16, speaker: 'A' }
        ]),
        emotions: report(99, [{ phrase: 'i understand', value: 55, speaker: 'A' }])
    }, helpers(s));
    const text = built.summary;

    t.check('the focus is the negative one', text.indexOf('Avoiding Negative Words. It is the widest gap') > -1);
    t.check('and the phrases are framed as something to replace',
        text.indexOf('Coming out in your calls, and worth replacing:') > -1);
    t.check('never as something landing well',
        text.indexOf('Already landing:\n    • "unfortunately"') === -1);
    t.check('the phrase is still named so it can be worked on',
        text.indexOf('"unfortunately" on 28 calls') > -1);
});

suite('sentiment summary: a positive focus IS praised', (t) => {
    const s = load(t);
    const built = s.buildSentimentSummaryText({
        positive: report(60, [
            { phrase: 'happy to help', value: 41, speaker: 'A' },
            { phrase: 'my pleasure', value: 0, speaker: 'A' }
        ]),
        negative: report(95, [{ phrase: 'unfortunately', value: 2, speaker: 'A' }]),
        emotions: report(99, [{ phrase: 'i understand', value: 55, speaker: 'A' }])
    }, helpers(s));
    const text = built.summary;

    t.check('the focus is positive language', text.indexOf('Positive Language. It is the widest gap') > -1);
    t.check('what is used is credited', text.indexOf('Already landing:') > -1);
    t.check('by name', text.indexOf('"happy to help" on 41 calls') > -1);
    t.check('and what is unused is offered', text.indexOf('Not showing up yet, and worth trying:') > -1);
    t.check('by name too', text.indexOf('"my pleasure"') > -1);
});

suite('sentiment summary: the customer is never quoted back at the associate', (t) => {
    const s = load(t);
    const built = s.buildSentimentSummaryText({
        positive: report(95, [{ phrase: 'happy to help', value: 41, speaker: 'A' }]),
        negative: report(60, [
            { phrase: 'unfortunately', value: 5, speaker: 'A' },
            { phrase: 'this is ridiculous', value: 30, speaker: 'C' }
        ]),
        emotions: report(99, [{ phrase: 'i understand', value: 55, speaker: 'A' }])
    }, helpers(s));
    const focusBlock = built.summary.split('WHAT TO WORK ON')[1].split('═══')[0];

    t.check('what the customer said is left out', focusBlock.indexOf('this is ridiculous') === -1);
    t.check('while what the associate said is kept', focusBlock.indexOf('"unfortunately"') > -1);
});

suite('sentiment summary: everything at goal says so plainly', (t) => {
    const s = load(t);
    const built = s.buildSentimentSummaryText({
        positive: report(95, [{ phrase: 'happy to help', value: 41, speaker: 'A' }]),
        negative: report(95, [{ phrase: 'unfortunately', value: 1, speaker: 'A' }]),
        emotions: report(99, [{ phrase: 'i understand', value: 55, speaker: 'A' }])
    }, helpers(s));

    t.check('no focus is manufactured',
        built.summary.indexOf('All three are at goal for this period') > -1);
    t.check('and nothing is called a gap',
        built.summary.indexOf('widest gap') === -1);
});

suite('sentiment summary: it holds to the house rules', (t) => {
    const s = load(t);
    const reports = {
        positive: report(88.4, [{ phrase: 'happy to help', value: 41, speaker: 'A' }]),
        negative: report(74.2, [{ phrase: 'unfortunately', value: 28, speaker: 'A' }]),
        emotions: report(96.1, [{ phrase: 'i understand', value: 55, speaker: 'A' }])
    };
    const text = s.buildSentimentSummaryText(reports, helpers(s)).summary;
    const prompt = s.buildSentimentCopilotPrompt(reports, { associateName: 'Angelina Fierro' });

    [['summary', text], ['prompt', prompt]].forEach(([label, body]) => {
        t.check(label + ': no em dash', body.indexOf('—') === -1);
        t.check(label + ': no en dash', body.indexOf('–') === -1);
        t.check(label + ': nothing is promised', !/exception cod|we can waive|will be excused/i.test(body));
        t.check(label + ': nobody is treated as new', !/if you.{0,6}re new|since you are new/i.test(body));
        t.check(label + ': no "away from exceptional"', !/away from exceptional/i.test(body));
    });

    // The prompt has to carry the facts AND the rules, or the model writes
    // whatever it likes.
    t.check('the prompt states the three figures',
        prompt.indexOf('88.4%') > -1 && prompt.indexOf('74.2%') > -1 && prompt.indexOf('96.1%') > -1);
    t.check('names the focus', prompt.indexOf('Focus on Avoiding Negative Words') > -1);
    t.check('and constrains the answer',
        prompt.indexOf('Name one thing to try, not a list.') > -1);
});

suite('sentiment summary: a missing file produces nothing rather than half a summary', (t) => {
    const s = load(t);
    const one = report(88, []);
    t.equal('no negative file', s.buildSentimentSummaryText({ positive: one, emotions: one }, helpers(s)).summary, '');
    t.equal('no reports at all', s.buildSentimentSummaryText({}, helpers(s)).summary, '');
    t.equal('and the prompt agrees', s.buildSentimentCopilotPrompt({ positive: one }, {}), '');
});
