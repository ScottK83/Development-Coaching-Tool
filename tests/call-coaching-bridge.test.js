'use strict';

const { suite } = require('./harness');

// A small tip pool so the selector's choices are checkable rather than
// dependent on which of 44 real tips happened to match.
const POOL = {
    aht: [
        'Learn keyboard shortcuts for your main programs',
        'Tell the customer what you are checking instead of asking them to keep waiting',
        'Type account notes WHILE talking, not in silence after',
        'Memorize the top 5 customer questions'
    ],
    negativeWord: [
        "Replace 'unfortunately' with 'what I can do is' to focus on solutions",
        "Avoid 'but' - use 'and' to sound less contradictory",
        'Stop using filler sounds, a silent pause is better'
    ],
    holdTime: [
        'Check back with the customer every 45 seconds on a hold',
        'Bookmark the pages you look up most'
    ]
};

function load(t, extra) {
    t.installFakeBrowser();
    global.getMetricTips = (key) => (POOL[key] || []).slice();
    global.window.METRICS_REGISTRY = {
        aht: { label: 'Average Handle Time' },
        negativeWord: { label: 'Negative Word Usage' },
        holdTime: { label: 'Hold Time' },
        fcr: { label: 'First Call Resolution' }
    };
    global.window.formatMetricDisplay = (key, value) => String(value);
    Object.assign(global.window, extra || {});
    t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-word-choice.module.js');
    t.loadModule('modules/call-coaching-bridge.module.js');
    return global.window.DevCoachModules;
}

const SLOW_CALL = [
    'Agent: Thank you for calling, my name is Jamie.',
    'Customer: My bill is wrong again.',
    'Agent: Unfortunately that is our policy.',
    'Agent: One moment. Just a second. Bear with me. Still checking.',
    'Agent: Hold on please.',
    'Agent: Okay the balance is two hundred.'
].join('\n');

const SECOND_CALL = [
    'Agent: Thanks for calling, this is Jamie.',
    'Customer: I was charged twice this month.',
    'Agent: Unfortunately I cannot see anything wrong on my end.',
    'Agent: One moment. Still loading. Bear with me. Just a second.',
    'Agent: The charge posted on the 14th.'
].join('\n');

const THIRD_CALL = [
    'Agent: Good afternoon, Jamie speaking.',
    'Customer: I need my due date moved.',
    'Agent: Unfortunately that is not something I can change today.',
    'Agent: Bear with me. One moment. Still checking. Just a second.',
    'Agent: Your balance is ninety dollars.'
].join('\n');

function metric(key, label, employeeValue, target, targetType, classification) {
    return {
        metricKey: key,
        label,
        employeeValue,
        target,
        targetType,
        meetsTarget: targetType === 'min' ? employeeValue >= target : employeeValue <= target,
        gapFromTarget: targetType === 'min'
            ? Math.max(0, target - employeeValue)
            : Math.max(0, employeeValue - target),
        classification
    };
}

suite('coaching bridge: suggestion ids', (t) => {
    const { callCoachingBridge: bridge } = load(t);

    const a = bridge.suggestionId('Type account notes WHILE talking, not in silence after');
    t.equal('the same text gives the same id', a, bridge.suggestionId('Type account notes WHILE talking, not in silence after'));
    t.check('punctuation and case do not change it', a === bridge.suggestionId('type account notes while talking  not in silence after'));
    t.check('different advice gets a different id', a !== bridge.suggestionId('Learn keyboard shortcuts'));
    t.check('an id is a short stable token', /^t[a-z0-9]+$/.test(a));
});

suite('coaching bridge: collecting evidence across calls', (t) => {
    const { callTranscript, callWordChoice, callCoachingBridge: bridge } = load(t);

    const analysis = callTranscript.analyzeTranscript(SLOW_CALL, { associateName: 'Jamie' });
    const wordChoice = callWordChoice.scanTranscript(SLOW_CALL, { associateName: 'Jamie', analysis });

    const single = bridge.collectFindings({ analysis, wordChoice, associateName: 'Jamie' });
    t.equal('one call reviewed', single.callsReviewed, 1);
    t.check('behaviour findings are collected', single.findings.some(f => f.kind === 'behaviour'));
    t.check('negative phrases become findings', single.findings.some(f => f.key === 'negativePhrase'));
    t.check('a single call reads as "on this call"', single.findings.every(f => f.appearsOn === 'on this call'));

    // The same problem on three calls should count three times, not appear
    // three times. Three genuinely different calls: the same transcript three
    // times is one call, and is deduplicated by callFingerprint.
    const history = [
        { listenedOn: '2026-08-20', employeeName: 'Jamie', transcript: SECOND_CALL },
        { listenedOn: '2026-08-21', employeeName: 'Jamie', transcript: THIRD_CALL }
    ];
    const across = bridge.collectFindings({ analysis, wordChoice, associateName: 'Jamie', history });
    t.equal('all three calls reviewed', across.callsReviewed, 3);

    const unfortunately = across.findings.find(f => f.key === 'negativePhrase' && /unfortunately/i.test(f.phrase));
    t.check('a repeated phrase is one finding', Boolean(unfortunately));
    t.equal('counted once per call', unfortunately.count, 3);
    t.check('and says so in words', /on all 3 calls/.test(unfortunately.appearsOn));

    // The open call must not be double counted when its saved copy is in the
    // history under the same date.
    const dupe = bridge.collectFindings({
        analysis, wordChoice, transcript: SLOW_CALL, associateName: 'Jamie', callDate: '2026-08-20',
        history: [{ listenedOn: '2026-08-20', employeeName: 'Jamie', transcript: SLOW_CALL }]
    });
    t.equal('the saved copy of the open call is skipped', dupe.callsReviewed, 1);
});

suite('coaching bridge: which metrics get a button', (t) => {
    const { callTranscript, callWordChoice, callCoachingBridge: bridge } = load(t);

    const analysis = callTranscript.analyzeTranscript(SLOW_CALL, { associateName: 'Jamie' });
    const wordChoice = callWordChoice.scanTranscript(SLOW_CALL, { associateName: 'Jamie', analysis });
    const { findings } = bridge.collectFindings({ analysis, wordChoice, associateName: 'Jamie' });

    const allMetrics = [
        metric('aht', 'Average Handle Time', 512, 426, 'max', 'Needs Focus'),
        metric('negativeWord', 'Negative Word Usage', 74, 83, 'min', 'Watch Area'),
        metric('holdTime', 'Hold Time', 20, 30, 'max', 'On Track'),
        metric('fcr', 'First Call Resolution', 60, 73, 'min', 'Needs Focus')
    ];

    const focus = bridge.metricsInFocus(allMetrics, findings);
    const keys = focus.map(item => item.metricKey);

    t.check('a missed metric with evidence is included', keys.includes('aht'));
    t.check('a met metric is excluded even with evidence', !keys.includes('holdTime'));
    t.check('Needs Focus outranks Watch Area', keys.indexOf('aht') < keys.indexOf('negativeWord'));
    t.check('every included metric carries its evidence', focus.every(item => item.evidence.length > 0));

    // A metric nothing in the calls speaks to must not get an empty button.
    const noEvidence = bridge.metricsInFocus(
        [metric('holdTime', 'Hold Time', 55, 30, 'max', 'Needs Focus')],
        [{ key: 'coldTransfer', count: 1, weight: 7, phrase: '', appearsOn: 'on this call' }]
    );
    t.equal('a metric with no evidence gets no button', noEvidence.length, 0);
});

suite('coaching bridge: tips follow the evidence', (t) => {
    const { callCoachingBridge: bridge } = load(t);

    const stalling = [{ key: 'stalling', count: 3, weight: 5, phrase: '', appearsOn: 'on 3 of the last 3 calls' }];
    const picked = bridge.selectTips('aht', stalling);

    t.check('the relevant tip is first', /keep waiting|in silence after/.test(picked[0].text));
    t.check('the irrelevant tip is not first', !/keyboard shortcuts|Memorize/.test(picked[0].text));
    t.check('matched tips are flagged as matched', picked[0].matchedEvidence === true);
    t.check('every tip carries an id and its metric', picked.every(tip => tip.id && tip.metricKey === 'aht'));

    // A phrase finding is the strongest signal available, because the tips are
    // written as swaps and contain the phrase itself.
    const phrase = [{ key: 'negativePhrase', count: 4, weight: 6, phrase: 'unfortunately', appearsOn: 'on 4 of the last 6 calls' }];
    const swap = bridge.selectTips('negativeWord', phrase);
    t.check('the swap for the exact phrase is first', /unfortunately/i.test(swap[0].text));

    t.equal('a metric with no pool returns nothing', bridge.selectTips('nonexistent', stalling).length, 0);
});

suite('coaching bridge: learning from what landed', (t) => {
    const { callCoachingBridge: bridge } = load(t);

    const evidence = [{ key: 'stalling', count: 2, weight: 5, phrase: '', appearsOn: 'on 2 of the last 4 calls' }];
    const relevantId = bridge.suggestionId('Tell the customer what you are checking instead of asking them to keep waiting');

    // Relevance is the primary sort, so a track record can only reorder tips
    // the evidence rates equally. These two both match the evidence not at all.
    const shortcutsId = bridge.suggestionId('Learn keyboard shortcuts for your main programs');
    const memorizeId = bridge.suggestionId('Memorize the top 5 customer questions');
    const tied = bridge.selectTips('aht', evidence, {
        effectiveness: {
            [memorizeId]: { id: memorizeId, rate: 0.9, rateBasis: 'beat the team', rateSample: 8, given: 8 },
            [shortcutsId]: { id: shortcutsId, rate: 0.1, rateBasis: 'beat the team', rateSample: 8, given: 8 }
        }
    });
    const order = tied.map(tip => tip.id);
    t.check('the relevant tip still leads', order[0] === relevantId);
    t.check('among equally irrelevant tips, the proven one makes the cut', order.includes(memorizeId));
    t.check('and the unproven one does not', !order.includes(shortcutsId));
    t.check(
        'the track record travels with the tip',
        tied.find(tip => tip.id === memorizeId).effectiveness.rateSample === 8
    );

    // But it must not promote an irrelevant tip over a relevant one.
    const notHijacked = bridge.selectTips('aht', evidence, {
        effectiveness: {
            [shortcutsId]: { id: shortcutsId, rate: 1, rateBasis: 'beat the team', rateSample: 20, given: 20 }
        }
    });
    t.check('relevance still beats a perfect record on an unrelated tip', notHijacked[0].id !== shortcutsId);

    // Advice already given to this person drops down the list.
    const repeat = bridge.selectTips('aht', evidence, { alreadyGiven: [relevantId] });
    t.check('a tip already sent is not offered first again', repeat[0].id !== relevantId);
});

suite('coaching bridge: the brief and the prompt', (t) => {
    const { callTranscript, callWordChoice, callCoachingBridge: bridge } = load(t);

    const analysis = callTranscript.analyzeTranscript(SLOW_CALL, { associateName: 'Esther' });
    const wordChoice = callWordChoice.scanTranscript(SLOW_CALL, { associateName: 'Esther', analysis });
    const { findings } = bridge.collectFindings({ analysis, wordChoice, associateName: 'Esther' });

    const focus = bridge.metricsInFocus([metric('aht', 'Average Handle Time', 512, 426, 'max', 'Needs Focus')], findings);
    const brief = bridge.buildMetricBrief(focus[0]);

    t.check('the headline names the metric and both numbers', /Average Handle Time.*512.*426/.test(brief.headline));
    t.check('the brief carries evidence', brief.evidence.length > 0);
    t.check('the brief carries tips', brief.tips.length > 0);
    t.check('tips are capped', brief.tips.length <= bridge.MAX_TIPS_PER_METRIC);

    const prompt = bridge.buildMetricPrompt(brief, { associateName: 'Esther Smith', preferredName: 'Esther' });
    t.check('the prompt names her', /Esther/.test(prompt));
    t.check('the prompt names the subject in plain language', /how long their calls are running/.test(prompt));
    t.check('the prompt carries the evidence', /Came up on this call/.test(prompt));
    t.check('the prompt forbids em dashes', /Do NOT use em dashes/.test(prompt));
    t.check('the prompt itself has none', !/[—–]/.test(prompt));

    const asked = bridge.buildMetricPrompt(brief, {
        preferredName: 'Esther',
        askedQuestion: 'How do I lower my AHT?'
    });
    t.check('her own question is quoted into the prompt', /How do I lower my AHT\?/.test(asked));

    // A track record is supervisor context, never something to tell her.
    const withRecord = {
        ...brief,
        tips: [{ id: 'x', metricKey: 'aht', text: 'Narrate what you are checking', effectiveness: { rate: 0.75, rateBasis: 'beat the team', rateSample: 8 } }]
    };
    const noted = bridge.buildMetricPrompt(withRecord, { preferredName: 'Esther' });
    t.check('the record is marked as reference only', /leave it out of the message/.test(noted));

    const html = bridge.briefHtml(brief, (value) => String(value || ''));
    t.check('the brief renders', /call-trend-group/.test(html));
    const chips = bridge.buttonsHtml([brief], (value) => String(value || ''));
    t.check('the chip carries its metric key', /data-metric-key="aht"/.test(chips));
    t.check('the first chip is the default', /data-default="1"/.test(chips));
});

suite('coaching outcomes: suggestion level learning', (t) => {
    t.installFakeBrowser();
    // isReverse and unit both matter here: metric-movement reads them to know
    // that a falling AHT is an improvement, and that its stable band is in
    // seconds rather than percentage points.
    global.window.METRICS_REGISTRY = {
        aht: { label: 'Average Handle Time', isReverse: true, unit: 'sec', target: { type: 'max', value: 426 } }
    };

    // Two weeks, one rep coached with two tips, plus a team to compare against.
    global.weeklyData = {
        'w1': {
            metadata: { periodType: 'week', endDate: '2026-08-14' },
            employees: [
                { name: 'Esther', aht: 520 },
                { name: 'A', aht: 400 }, { name: 'B', aht: 410 }, { name: 'C', aht: 420 }
            ]
        },
        'w2': {
            metadata: { periodType: 'week', endDate: '2026-08-21' },
            employees: [
                { name: 'Esther', aht: 470 },
                { name: 'A', aht: 401 }, { name: 'B', aht: 409 }, { name: 'C', aht: 421 }
            ]
        }
    };
    global.coachingHistory = {
        Esther: [{
            employeeId: 'Esther',
            weekEnding: '2026-08-14',
            generatedAt: '2026-08-15T12:00:00.000Z',
            metricsCoached: ['aht'],
            suggestions: [
                { id: 'tip-narrate', metricKey: 'aht', text: 'Narrate what you are checking' },
                { id: 'tip-notes', metricKey: 'aht', text: 'Type notes while talking' }
            ]
        }]
    };

    t.loadModule('modules/metric-movement.module.js');
    t.loadModule('modules/coaching-outcomes.module.js');
    const { coachingOutcomes } = global.window.DevCoachModules;

    const outcomes = coachingOutcomes.buildOutcomes('Esther');
    t.check('an outcome was built', outcomes.length === 1);
    t.equal('the suggestions rode along', outcomes[0].suggestions.length, 2);
    t.equal('and the metric moved the right way', outcomes[0].verdict, 'moved');

    const rows = coachingOutcomes.summarizeBySuggestion(outcomes);
    t.equal('both tips get a row', rows.length, 2);
    t.equal('each was given once', rows[0].given, 1);
    t.equal('and to one person', rows[0].people, 1);

    // One event is not evidence, and the module must say so rather than
    // reporting a 100% success rate.
    t.equal('a single use yields no rate', rows[0].rate, null);
    t.check('and explains why', /not enough history/.test(rows[0].rateBasis));

    const index = coachingOutcomes.suggestionEffectiveness('Esther');
    t.check('the lookup is keyed by suggestion id', Boolean(index['tip-narrate']));

    // An older entry with no suggestions must not break the join.
    global.coachingHistory.Esther.push({
        employeeId: 'Esther', weekEnding: '2026-08-14',
        generatedAt: '2026-08-15T13:00:00.000Z', metricsCoached: ['aht']
    });
    const mixed = coachingOutcomes.buildOutcomes('Esther');
    t.check('a legacy entry still produces an outcome', mixed.length === 2);
    t.check('with an empty suggestion list', mixed.some(o => o.suggestions.length === 0));
});

suite('coaching bridge: wiring', (t) => {
    const fs = require('fs');
    const path = require('path');
    const { ROOT } = require('./harness');
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const css = fs.readFileSync(path.join(ROOT, 'styles-v2.css'), 'utf8');

    t.check('the module is in the loader', html.includes('modules/call-coaching-bridge.module.js'));
    t.check('it loads after the word choice scan it reads',
        html.indexOf('modules/call-coaching-bridge.module.js') > html.indexOf('modules/call-word-choice.module.js'));

    // A panel nobody can reach is the failure mode this page already had once.
    ['callMetricCoachPanel', 'callMetricChips', 'callMetricBrief', 'callMetricCoachStatus'].forEach((id) => {
        t.check(`${id} exists in the page`, html.includes(`id="${id}"`));
    });

    ['generateMetricCoachPromptBtn', 'copyMetricCoachBtn'].forEach((id) => {
        t.check(`${id} exists in the page`, html.includes(`id="${id}"`));
        t.check(`${id} is bound in script.js`, script.includes(`'${id}'`));
    });

    t.check('the panel is rendered when a transcript is analyzed',
        script.includes('renderCallMetricCoachPanel(transcript'));
    t.check('the chips are wired to a click handler',
        script.includes("bindElementOnce(document.getElementById('callMetricChips')"));
    t.check('one recorder logs the metric and the suggestions',
        /function recordSelectedCallMetricCoaching[\s\S]{0,900}suggestions: brief\.tips\.map/.test(script));
    t.check('the Copilot path records',
        /function generateCallMetricCoachPrompt[\s\S]{0,3000}recordSelectedCallMetricCoaching\(/.test(script));
    // The written path is the one a Copilot refusal falls back to, so it has
    // to log too or the learning loop quietly stops seeing half the coaching.
    t.check('the written path records as well',
        /function writeCallMetricMessage[\s\S]{0,1600}recordSelectedCallMetricCoaching\(/.test(script));
    t.check('and is marked as not AI assisted',
        /recordSelectedCallMetricCoaching\(brief, employeeName, false\)/.test(script));

    t.check('the chip styles exist', css.includes('.call-metric-chip'));
    t.check('the selected chip has a visible state', css.includes('aria-pressed="true"'));
});

suite('coaching bridge: one event is not two findings', (t) => {
    const { callTranscript, callWordChoice, callCoachingBridge: bridge } = load(t);

    // An emotional call with no acknowledgement trips the transcript engine's
    // empathy rule AND the word choice emotion scan. That is one problem.
    const UPSET = [
        'Agent: Thank you for calling, my name is Jamie.',
        'Customer: This is ridiculous, my bill doubled and I am really upset.',
        'Agent: Can I have your account number.',
        'Agent: The balance is two hundred dollars.'
    ].join('\n');

    const analysis = callTranscript.analyzeTranscript(UPSET, { associateName: 'Jamie' });
    const wordChoice = callWordChoice.scanTranscript(UPSET, { associateName: 'Jamie', analysis });
    const { findings } = bridge.collectFindings({ analysis, wordChoice, associateName: 'Jamie' });

    const keys = findings.map(f => f.key);
    t.check('the empathy gap is reported', keys.includes('empathy'));
    t.check('the raw cue row is folded into it', !keys.includes('emotionUnanswered'));

    // With no empathy rule firing, the scan row is the only signal and must
    // survive on its own.
    const scanOnly = bridge.collectFindings({
        analysis: { allImprovements: [] },
        wordChoice,
        associateName: 'Jamie'
    });
    t.check('the cue row stands alone when nothing else caught it',
        scanOnly.findings.some(f => f.key === 'emotionUnanswered'));
});

suite('coaching bridge: prompt punctuation', (t) => {
    const { callCoachingBridge: bridge } = load(t);

    const brief = {
        metricKey: 'aht',
        label: 'Average Handle Time',
        headline: 'Average Handle Time: 512 against a target of 426',
        evidence: [
            { key: 'stalling', text: 'Silence fillers came up repeatedly.', quote: 'One moment. Just a second.', appearsOn: 'on 3 of the last 3 calls', count: 3, weight: 5, phrase: '' },
            { key: 'airtime', text: 'She carried the talk time.', quote: '', appearsOn: 'on this call', count: 1, weight: 4, phrase: '' }
        ],
        tips: []
    };

    const prompt = bridge.buildMetricPrompt(brief, { preferredName: 'Esther' });
    t.check('a quote ending in a full stop does not double it', !/\.\.?"\./.test(prompt) && !prompt.includes('second."."'));
    // The borrowed full stop lands outside the quote, so the sentence still
    // ends exactly once.
    t.check('the quote still closes properly', /Just a second"\./.test(prompt));
    t.check('a finding with no quote reads cleanly', /She carried the talk time\. Came up on this call\.\n?/.test(prompt));
});

suite('coaching bridge: the app can write the message itself', (t) => {
    const { callCoachingBridge: bridge } = load(t);

    const brief = {
        metricKey: 'aht',
        label: 'Average Handle Time',
        headline: 'Average Handle Time: 512 against a target of 426',
        evidence: [
            { key: 'stalling', text: 'Silence fillers came up repeatedly.', quote: 'One moment. Just a second.', appearsOn: 'on both calls', count: 2, callsTotal: 2, weight: 5, phrase: '' }
        ],
        tips: [
            { id: 'a', metricKey: 'aht', text: 'A confident answer is shorter than a hedged one', effectiveness: null },
            { id: 'b', metricKey: 'aht', text: 'Type notes while talking', effectiveness: null }
        ]
    };

    const moments = ['Thursday, September 3 at 12:38 PM', 'Friday, August 28 at 9:15 AM'];
    const message = bridge.buildMetricMessage(brief, {
        preferredName: 'Esther',
        callMoments: moments,
        askedQuestion: 'How do I lower my AHT?'
    });

    t.check('it greets her by name', message.startsWith('Hi Esther,'));
    t.check('it answers the question she asked', /You asked me about how long your calls are running/.test(message));
    t.check('it names the most recent call', message.includes('Thursday, September 3 at 12:38 PM'));
    t.check('it says how many it read', message.includes('went back over 2 of your recent calls'));
    t.check('it quotes her own words back', message.includes('You said: "One moment. Just a second"'));
    t.check('it carries the suggestions', message.includes('A confident answer is shorter than a hedged one'));
    t.check('it closes with an offer to talk', /Come find me/.test(message));
    t.check('no em dashes', !/[—–]/.test(message));
    t.check('no leftover template tokens', !/\{|\}/.test(message));
    t.check('the topic is in second person, not third', !/their calls are running/.test(message));

    // A single call must not claim a pattern across several.
    const single = bridge.buildMetricMessage(brief, { preferredName: 'Esther', callMoments: [moments[0]] });
    t.check('one call is described as one', /listened back to the call you took on Thursday/.test(single));
    t.check('and makes no plural claim', !single.includes('went back over'));

    // With no question asked the opening still has to make sense.
    const unprompted = bridge.buildMetricMessage(brief, { preferredName: 'Esther', callMoments: moments });
    t.check('an unprompted note opens differently', /I wanted to share a couple of things/.test(unprompted));
    t.check('and still names the call', unprompted.includes('Thursday, September 3'));

    // No name and no calls must still produce something sendable.
    const bare = bridge.buildMetricMessage(brief, {});
    t.check('a nameless message still greets', bare.startsWith('Hi,'));
    t.check('and does not dangle an empty call reference', !/most recently\s*\./.test(bare));

    const oneTip = bridge.buildMetricMessage({ ...brief, tips: [brief.tips[0]] }, { preferredName: 'Esther' });
    t.check('one suggestion reads as one', oneTip.includes('One thing worth trying:'));
    const twoTips = bridge.buildMetricMessage(brief, { preferredName: 'Esther' });
    t.check('two suggestions read as two', twoTips.includes('Two things worth trying:'));
});

suite('coaching bridge: the prompt asks for wording, not judgement', (t) => {
    const { callCoachingBridge: bridge } = load(t);

    const brief = {
        metricKey: 'aht',
        label: 'Average Handle Time',
        headline: 'Average Handle Time: 512 against a target of 426',
        evidence: [{ key: 'stalling', text: 'Silence fillers.', quote: 'One moment', appearsOn: 'on both calls', count: 2, weight: 5, phrase: '' }],
        tips: []
    };

    const prompt = bridge.buildMetricPrompt(brief, { preferredName: 'Esther', callMoments: ['Thursday, September 3 at 12:38 PM'] });

    // Copilot refused the earlier version, reading it as a request to evaluate
    // a named employee. The supervisor did the review; only the wording is left.
    t.check('it says the review is already done', /I have already listened/.test(prompt));
    t.check('it asks for no assessment', /not asking you to assess them, rate them/.test(prompt));
    t.check('it asks only for wording', /What I need is the wording/.test(prompt));
    t.check('and forbids added observations', /Do not add observations of your own/.test(prompt));

    // The figure against target was the most evaluation-shaped part of it, and
    // was never meant to reach the message anyway.
    t.check('the raw figure is gone', !prompt.includes('512'));
    t.check('the target is gone', !prompt.includes('426'));
    t.check('the topic survives in plain language', /how long their calls are running/.test(prompt));

    // 127 associates whose pronouns this app has never been told.
    t.check('no gendered pronouns in the prompt', !/\b(she|her|hers|he|him|his)\b/i.test(prompt));
    t.check('no em dashes', !/[—–]/.test(prompt));
});

suite('coaching bridge: feedback ordered for this associate', (t) => {
    const { callCoachingBridge: bridge } = load(t);

    // The engine's own order: severity in general. Empathy and recap outrank
    // filler words everywhere.
    // In the engine's own order, heaviest first, because that is the order
    // prioritizeByMetrics is documented to preserve within a group.
    const drafted = [
        { key: 'empathy', text: 'Empathy went unacknowledged.', weight: 12 },
        { key: 'verification', text: 'Verification not heard.', weight: 8 },
        { key: 'deadAirGap', text: 'Dead air.', weight: 6 },
        { key: 'recap', text: 'No recap at the close.', weight: 5 },
        { key: 'filler', text: 'Filler words.', weight: 3 }
    ];

    // For somebody whose only problem is handle time, the filler words and the
    // dead air are the ones that move a number they are judged on.
    const forAht = bridge.prioritizeByMetrics(drafted, ['aht']);
    const keys = forAht.map(item => item.key);
    t.check('handle time findings lead', keys.indexOf('deadAirGap') < keys.indexOf('empathy'));
    t.check('even the small ones', keys.indexOf('filler') < keys.indexOf('empathy'));
    t.equal('nothing is dropped', forAht.length, drafted.length);

    // Severity still decides between two equally relevant findings, so dead
    // air keeps its lead over filler words.
    t.check('severity breaks the tie', keys.indexOf('deadAirGap') < keys.indexOf('filler'));

    // A different associate, a different order, from the same call.
    const forEmotions = bridge.prioritizeByMetrics(drafted, ['managingEmotions']);
    t.equal('empathy leads for a sentiment problem', forEmotions[0].key, 'empathy');

    // No weekly data to be missing anything in means no reordering at all,
    // rather than an arbitrary one.
    const untouched = bridge.prioritizeByMetrics(drafted, []);
    t.equal('with no KPIs known the engine order stands', untouched.map(i => i.key).join(','), drafted.map(i => i.key).join(','));

    // A behaviour that moves nothing measured is still worth saying, it just
    // stops going first.
    const noMetric = bridge.prioritizeByMetrics(
        [{ key: 'notAMetric', text: 'Something else.', weight: 9 }, { key: 'filler', text: 'Filler.', weight: 3 }],
        ['aht']
    );
    t.equal('an unmeasured finding survives', noMetric.length, 2);
    t.equal('behind the measured one', noMetric[0].key, 'filler');

    const covered = bridge.missedMetricsCovered(drafted, ['aht', 'transfers']);
    t.check('it reports which KPIs the feedback speaks to', covered.includes('aht'));
    t.check('and not ones it does not', !covered.includes('transfers'));
    t.equal('a finding mapping nowhere covers nothing',
        bridge.missedMetricsCovered([{ key: 'notAMetric' }], ['aht']).length, 0);
});
