'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

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

// `pool` overrides the shared POOL for suites that need to control exactly
// what the selector had to choose from.
function load(t, extra, pool) {
    t.installFakeBrowser();
    const tips = pool || POOL;
    global.getMetricTips = (key) => (tips[key] || []).slice();
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


// The QA scorer has to be loaded for the QA findings to exist at all.
function loadWithQa(t) {
    t.installFakeBrowser();
    global.getMetricTips = (key) => (POOL[key] || []).slice();
    global.window.METRICS_REGISTRY = {
        aht: { label: 'Average Handle Time' },
        cxRepOverall: { label: 'Rep Satisfaction' },
        fcr: { label: 'First Call Resolution' },
        positiveWord: { label: 'Positive Word Usage' },
        holdTime: { label: 'Hold Time' }
    };
    global.window.formatMetricDisplay = (key, value) => String(value);
    t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-qa.module.js');
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

    // The pool now widens to whatever the evidence maps to, so an unknown
    // metric key still finds tips when the finding itself points somewhere.
    t.check('an unknown metric still serves the evidence',
        bridge.selectTips('nonexistent', stalling).length > 0);
    // Genuinely nothing to search: no metric, and a finding mapped nowhere.
    t.equal('nothing anywhere returns nothing',
        bridge.selectTips('nonexistent', [{ key: 'notAFinding', count: 1, weight: 5, phrase: '', appearsOn: 'on this call' }]).length, 0);
});

suite('coaching bridge: learning from what landed', (t) => {
    // Two tips of identical relevance to the evidence, so nothing but the
    // track record can separate them. An irrelevant tip is no longer returned
    // at all, so effectiveness can only ever reorder tips that already fit.
    const { callCoachingBridge: bridge } = load(t, null, {
        aht: [
            'Fill the silence by saying what you are checking',
            'Silence is fine as long as you tell them why it is there',
            'Learn keyboard shortcuts for your main programs'
        ]
    });

    const evidence = [{ key: 'deadAirGap', count: 2, weight: 6, phrase: '', appearsOn: 'on 2 of the last 4 calls' }];
    const fillId = bridge.suggestionId('Fill the silence by saying what you are checking');
    const tellId = bridge.suggestionId('Silence is fine as long as you tell them why it is there');
    const shortcutsId = bridge.suggestionId('Learn keyboard shortcuts for your main programs');

    const tied = bridge.selectTips('aht', evidence, {
        effectiveness: {
            [tellId]: { id: tellId, rate: 0.9, rateBasis: 'beat the team', rateSample: 8, given: 8 },
            [fillId]: { id: fillId, rate: 0.1, rateBasis: 'beat the team', rateSample: 8, given: 8 }
        }
    });
    const order = tied.map(tip => tip.id);

    t.check('the better record leads among equally relevant tips', order[0] === tellId);
    t.check('the weaker one is still offered', order.includes(fillId));
    t.check(
        'the track record travels with the tip',
        tied.find(tip => tip.id === tellId).effectiveness.rateSample === 8
    );

    // A perfect record cannot buy a place for advice that does not fit.
    const notHijacked = bridge.selectTips('aht', evidence, {
        effectiveness: {
            [shortcutsId]: { id: shortcutsId, rate: 1, rateBasis: 'beat the team', rateSample: 20, given: 20 }
        }
    });
    t.check('an unrelated tip stays out however well it has done',
        !notHijacked.some(tip => tip.id === shortcutsId));

    // Advice this person has already had did not need repeating.
    const repeat = bridge.selectTips('aht', evidence, { alreadyGiven: [tellId] });
    t.check('a tip already sent is not offered first again', repeat[0].id !== tellId);
    t.check('and the other relevant one takes its place', repeat[0].id === fillId);
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

    // An older entry with no suggestions must not break the join. It is the
    // same metric in the same week, so it merges into the outcome above rather
    // than becoming a second result: the measurement is week over week, and
    // two rows with the same before and after are one result counted twice.
    global.coachingHistory.Esther.push({
        employeeId: 'Esther', weekEnding: '2026-08-14',
        generatedAt: '2026-08-15T13:00:00.000Z', metricsCoached: ['aht']
    });
    const mixed = coachingOutcomes.buildOutcomes('Esther');
    t.equal('a legacy entry merges rather than duplicating', mixed.length, 1);
    t.check('and does not wipe the suggestions it had no record of',
        mixed[0].suggestions.length === 2);

    // A legacy entry on its own still yields an outcome, with nothing to
    // attribute it to.
    global.coachingHistory.Legacy = [{
        employeeId: 'Legacy', weekEnding: '2026-08-14',
        generatedAt: '2026-08-15T12:00:00.000Z', metricsCoached: ['aht']
    }];
    const legacyOnly = coachingOutcomes.buildOutcomes('Legacy');
    t.equal('a legacy only history still produces an outcome', legacyOnly.length, 1);
    t.equal('with an empty suggestion list', legacyOnly[0].suggestions.length, 0);
});

suite('coaching bridge: wiring', (t) => {
    const fs = require('fs');
    const path = require('path');
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
    t.check('it says how many it read', message.includes('I have listened to 2 of your calls over the past few days'));
    t.check('it quotes her own words back', message.includes('I heard you say "One moment. Just a second"'));
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
    // "I had a look at X, so I listened back to Y" runs the causality the
    // wrong way. Without a question the listening comes first.
    t.check('an unprompted note opens differently', /and had a look at/.test(unprompted));
    t.check('and does not put the cart first', !/^I had a look at/m.test(unprompted));
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

suite('coaching bridge: the message reads like a person wrote it', (t) => {
    const { callCoachingBridge: bridge } = load(t);

    // Report fields with a colon prefix and a stopwatch reading are what made
    // the sent version look machine written.
    const h = bridge.humanizeFinding;
    t.equal('a label prefix is dropped',
        h('Long hold: about 4m 05s of silence starting at 5:54.'),
        'About four minutes of silence starting at 5:54.');
    t.equal('a two word label goes too',
        h('Hold process: ask permission before the hold.'),
        'Ask permission before the hold.');
    t.equal('seconds round up to the minute',
        h('Dead air: about 1m 40s with nothing said.'),
        'About two minutes with nothing said.');
    t.equal('one minute stays singular',
        h('Dead air: about 1m 04s with nothing said.'),
        'About one minute with nothing said.');
    t.equal('bare seconds are spelled out', h('About 45s of silence.'), 'About 45 seconds of silence.');
    t.check('text with no label is left alone',
        h('Tell the customer what you are checking.') === 'Tell the customer what you are checking.');
    t.equal('nothing in, nothing out', h(''), '');

    const brief = {
        metricKey: 'aht',
        label: 'Average Handle Time',
        headline: 'Average Handle Time: 512 against a target of 426',
        evidence: [{
            key: 'longHold',
            text: 'Long hold: about 4m 05s of silence starting at 5:54.',
            quote: 'i do need to place you on hold',
            appearsOn: 'on this call',
            count: 1, weight: 7, phrase: '',
            moments: ['Thursday, September 3 at 6:35 PM']
        }],
        tips: [{ id: 'a', metricKey: 'aht', text: 'Type notes while talking', effectiveness: null }]
    };

    const message = bridge.buildMetricMessage(brief, {
        preferredName: 'Esther',
        callMoments: ['Thursday, September 3 at 6:35 PM'],
        callLabel: '39 minute call',
        askedQuestion: 'How do I lower my AHT?'
    });

    // She was on the call. She does not need it recapped, her own actions
    // recited, or the customer's opening line quoted back from raw
    // speech-to-text.
    t.check('the call is identified in the opening', /the 39 minute call you took on Thursday, September 3 at 6:35 PM/.test(message));
    t.equal('and the date is said once', (message.match(/September 3/g) || []).length, 1);
    t.check('no recap paragraph', !/The customer opened with/.test(message));
    t.check('no recital of her own actions', !/You took the customer through verification/.test(message));

    // One finding is not "a couple of things".
    t.check('one finding says so', /Here is the one thing that stood out/.test(message));
    const two = bridge.buildMetricMessage(
        { ...brief, evidence: [brief.evidence[0], { key: 'filler', text: 'Filler words.', quote: '', appearsOn: 'on this call', count: 1, weight: 3, phrase: '' }] },
        { preferredName: 'Esther', callMoments: ['Thursday, September 3 at 6:35 PM'], callLabel: '39 minute call' }
    );
    t.check('two findings do not', !/the one thing/.test(two));

    t.check('the stopwatch reading is gone', !/4m 05s/.test(message));
    t.check('and reads as speech', /About four minutes of silence/.test(message));

    // On a single call the quote adds nothing she does not know, and on an
    // unlabelled transcript it is a line the parser guessed at.
    t.check('no quote for a single call', !/I heard you say/.test(message));
    const across = bridge.buildMetricMessage(brief, {
        preferredName: 'Esther',
        callMoments: ['Thursday, September 3 at 6:35 PM', 'Friday, August 28 at 9:15 AM'],
        callLabel: '39 minute call'
    });
    t.check('but a pattern across calls quotes the moment', /I heard you say/.test(across));
    // Attributed to the call it happened on rather than counted in a
    // trailing clause, which is what makes it checkable.
    t.check('and says which call', /On the September 3 call,/.test(across));

    t.check('no em dashes', !/[—–]/.test(message));
    t.check('no double spaces', !/ {2}/.test(message.replace(/\n */g, '\n')));
});

suite('coaching bridge: weak matches are dropped, not padded', (t) => {
    const { callCoachingBridge: bridge } = load(t, null, {
        aht: [
            // Only "wait", a word that turns up all over a pool about calls.
            "Avoid over-apologizing - one genuine 'I'm sorry for the wait' is enough",
            // "silence" and "talking" are distinctive to the finding.
            'Type account notes WHILE talking, not in silence after',
            'Learn keyboard shortcuts for your main programs',
            'Memorize the top 5 customer questions'
        ]
    });

    const deadAir = [{ key: 'deadAirGap', count: 1, weight: 6, phrase: '', appearsOn: 'on this call' }];
    const picked = bridge.selectTips('aht', deadAir);

    t.check('the distinctive match is kept', picked.some(tip => /in silence after/.test(tip.text)));
    t.check('the one common word match is dropped', !picked.some(tip => /sorry for the wait/.test(tip.text)));
    t.check('and the list is short rather than padded', picked.length < bridge.MAX_TIPS_PER_METRIC);
    t.check('everything returned is marked as matched', picked.every(tip => tip.matchedEvidence === true));

    // A phrase finding is always specific, because the tips are written as
    // swaps and contain the phrase itself.
    const phrase = [{ key: 'negativePhrase', count: 3, weight: 6, phrase: 'wait', appearsOn: 'on 3 of the last 4 calls' }];
    const swap = bridge.selectTips('aht', phrase);
    t.check('a scored phrase counts as specific even when short',
        swap.some(tip => /sorry for the wait/.test(tip.text)));
});

suite('coaching bridge: nothing fits, and it says so', (t) => {
    const { callCoachingBridge: bridge } = load(t, null, {
        aht: [
            'Learn keyboard shortcuts for your main programs',
            'Memorize the top 5 customer questions',
            'Keep your reference sheet where you can see it'
        ]
    });

    const coldTransfer = [{ key: 'coldTransfer', count: 2, weight: 7, phrase: '', appearsOn: 'on both calls' }];
    const picked = bridge.selectTips('aht', coldTransfer);

    // An empty list leaves the supervisor with nothing to send, so general
    // advice is offered, flagged, and given less room than a real match.
    t.check('something is still offered', picked.length > 0);
    t.check('but less of it', picked.length <= 2);
    t.check('and it is flagged as unmatched', picked.every(tip => tip.matchedEvidence === false));

    // The gap is in the tip pool, and the person reading can close it.
    const html = bridge.briefHtml(
        { metricKey: 'aht', label: 'Average Handle Time', headline: 'AHT', evidence: coldTransfer, tips: picked },
        (value) => String(value || '')
    );
    t.check('the panel says the pool has a gap', /Nothing in this metric's tips speaks to what the calls showed/.test(html));

    // And it must not say that when the tips did match.
    const matched = bridge.briefHtml(
        { metricKey: 'aht', label: 'AHT', headline: 'AHT', evidence: coldTransfer, tips: [{ id: 'x', metricKey: 'aht', text: 'Brief the receiving team', matchedEvidence: true, effectiveness: null }] },
        (value) => String(value || '')
    );
    t.check('and stays quiet when they did', !/speaks to what the calls showed/.test(matched));
});

suite('coaching bridge: every mapped finding can find a tip', (t) => {
    const { callCoachingBridge: bridge } = load(t);

    // A finding mapped to a metric but with no keywords can only ever return
    // generic advice, which looks like the tip pool is thin when the real
    // problem is that nothing was told how to search it. `verification` sat
    // like that. The two synthetic keys are exempt: they carry the phrase
    // itself, which is a stronger keyword than any list.
    const carriesItsOwnPhrase = ['negativePhrase', 'positiveUnused'];
    const unsearchable = Object.keys(bridge.EVIDENCE_MAP)
        .filter(key => !carriesItsOwnPhrase.includes(key))
        .filter(key => !(bridge.FINDING_KEYWORDS[key] || []).length);

    t.equal(`every mapped finding has keywords (${unsearchable.join(', ') || 'all do'})`, unsearchable.length, 0);

    // And nothing in the keyword list is for a finding no metric maps, which
    // would be a rule quietly doing nothing.
    const orphaned = Object.keys(bridge.FINDING_KEYWORDS)
        .filter(key => !bridge.EVIDENCE_MAP[key]);
    t.equal(`no keywords for an unmapped finding (${orphaned.join(', ') || 'none'})`, orphaned.length, 0);

    // The keywords are stems, so they have to match any ending, and must not
    // match a word that merely contains them. Plain substring matching gave
    // the first and cost the second: "um" was inside customer and number,
    // "umm" inside summary, "app" inside happy, "end" inside recommend.
    const stem = bridge.matchesStem;

    t.check('a stem matches its own endings', stem('narrate what you are doing', 'narrat'));
    t.check('and a longer ending', stem('verification is required', 'verif'));
    t.check('and a recap tip via summary', stem('to summarize what we did', 'summar'));

    t.check('but not hidden inside customer', !stem('ask the customer politely', 'um'));
    t.check('nor inside summary', !stem('to summarize what we did', 'umm'));
    t.check('nor inside happy', !stem('happy to help with that', 'app'));
    t.check('nor inside recommend', !stem('i would recommend the plan', 'end'));
    t.check('nor inside task', !stem('finish the task first', 'ask'));
    t.check('nor inside known', !stem('a known issue on the account', 'own'));

    t.check('multi word keywords still work', stem('type notes while talking', 'while talking'));
    t.check('and do not match out of order', !stem('talking while you type', 'while talking'));
    t.equal('an empty keyword matches nothing', stem('anything', ''), false);

    // Now the sweep is meaningful: no keyword may fire on a word that only
    // contains it.
    const hiddenIn = ['customer', 'number', 'account', 'happy', 'balance', 'summary', 'recommend', 'task', 'known'];
    const risky = [];
    Object.entries(bridge.FINDING_KEYWORDS).forEach(([key, words]) => {
        words.forEach(word => {
            hiddenIn
                .filter(common => common.includes(word) && !common.startsWith(word))
                .filter(common => stem(common, word))
                .forEach(common => risky.push(`${key}:"${word}" fired inside "${common}"`));
        });
    });
    t.equal(`no keyword fires inside a common call word (${risky.join(', ') || 'none'})`, risky.length, 0);
});

suite('coaching bridge: the message names the calls and the pattern', (t) => {
    const { callCoachingBridge: bridge } = load(t, null, { aht: ['Type notes while talking'] });

    const moments = [
        'Thursday, September 3 at 6:35 PM',
        'Tuesday, September 1 at 2:04 PM',
        'Friday, August 28 at 9:15 AM'
    ];

    const brief = {
        metricKey: 'aht',
        label: 'Average Handle Time',
        headline: 'Average Handle Time',
        evidence: [
            // Deliberately first and NOT part of the silence pattern, to prove
            // the ordering puts the pattern's own findings up front.
            { key: 'uncertainty', text: 'Confidence: hedging language showed up.', quote: 'i think', appearsOn: 'on all 3 calls', count: 3, weight: 6, phrase: '', moments },
            { key: 'stalling', text: 'Silence fillers came up repeatedly.', quote: 'one moment', appearsOn: 'on all 3 calls', count: 3, weight: 5, phrase: '', moments },
            { key: 'deadAirGap', text: 'Dead air: about 2m 10s at 4:30.', quote: '', appearsOn: 'on 1 of the last 3 calls', count: 1, weight: 6, phrase: '', moments: [moments[1]] }
        ],
        tips: [{ id: 'a', metricKey: 'aht', text: 'Type notes while talking', effectiveness: null }]
    };

    const message = bridge.buildMetricMessage(brief, {
        preferredName: 'Esther', callMoments: moments, callLabel: '8 minute call',
        askedQuestion: 'How do I lower my AHT?'
    });

    // How many, and which ones, so everything after it is evidence.
    t.check('it says how many calls were listened to', /I have listened to 3 of your calls over the past few days/.test(message));
    moments.forEach((moment) => {
        t.check('it lists ' + moment.split(',')[0], message.includes('  ' + moment));
    });

    // The thing a list of findings cannot say for itself.
    t.check('it names the pattern', /The pattern I keep seeing is silence/.test(message));
    t.check('and how many calls it was on', /It came up on all 3 of them/.test(message));

    // Announcing a pattern of silence and then leading with hedging reads as
    // two paragraphs by different authors.
    const silenceAt = message.indexOf('silence fillers came up');
    const hedgingAt = message.indexOf('hedging language showed up');
    t.check('the pattern findings lead', silenceAt > 0 && silenceAt < hedgingAt);

    // Every point attributed to a call they can remember.
    t.check('a finding on every call says so', /On all 3 calls, silence fillers/.test(message));
    t.check('a finding on one call names it', /On the September 1 call, about two minutes at 4:30/.test(message));
    t.check('and quotes the moment', /I heard you say "one moment"/.test(message));

    t.check('no repeated ands in a list', !/ and .* and .* calls,/.test(message));
    t.check('no em dashes', !/[—–]/.test(message));
    t.check('no leftover tokens', !/\{|\}/.test(message));

    // A finding on two of three calls lists both rather than claiming all.
    const two = bridge.buildMetricMessage({
        ...brief,
        evidence: [{ key: 'stalling', text: 'Silence fillers came up.', quote: '', appearsOn: 'on 2 of the last 3 calls', count: 2, weight: 5, phrase: '', moments: [moments[0], moments[2]] }]
    }, { preferredName: 'Esther', callMoments: moments, callLabel: '8 minute call' });
    t.check('two of three names both', /On the September 3 and August 28 calls,/.test(two));
    t.check('and does not claim all of them', !/On all 3 calls/.test(two));
});

suite('coaching bridge: naming a pattern only when there is one', (t) => {
    const { callCoachingBridge: bridge } = load(t);
    const moments = ['Thursday, September 3 at 6:35 PM', 'Friday, August 28 at 9:15 AM'];

    // One finding, one call, is an incident. Calling it a pattern is the kind
    // of overstatement that costs a message its credibility.
    const single = bridge.describePattern([{ key: 'stalling', moments: [moments[0]] }], 2);
    t.equal('one finding on one call is not a pattern', single, null);

    // Two findings from the same family is.
    const family = bridge.describePattern([
        { key: 'stalling', moments: [moments[0]] },
        { key: 'deadAirGap', moments: [moments[0]] }
    ], 2);
    t.check('two findings from one family is', Boolean(family));
    t.equal('and it is named', family.key, 'silence');

    // So is one finding across two calls.
    const across = bridge.describePattern([{ key: 'stalling', moments }], 2);
    t.check('one finding on two calls is', Boolean(across));
    t.equal('counted by calls, not findings', across.calls, 2);

    // The family with the widest reach wins, not the one with most rules.
    const competing = bridge.describePattern([
        { key: 'recap', moments: [moments[0]] },
        { key: 'nextSteps', moments: [moments[0]] },
        { key: 'stalling', moments }
    ], 2);
    t.equal('the family on the most calls wins', competing.key, 'silence');

    t.equal('no evidence is no pattern', bridge.describePattern([], 2), null);
    t.equal('and neither is a finding in no family',
        bridge.describePattern([{ key: 'somethingElse', moments }], 2), null);

    t.equal('a short moment drops the weekday and time',
        bridge.shortMoment('Thursday, September 3 at 6:35 PM'), 'September 3');
    t.equal('and copes with a bare value', bridge.shortMoment('2026-09-03'), '2026-09-03');
});

suite('coaching bridge: saying whether the last coaching worked', (t) => {
    const { callCoachingBridge: bridge } = load(t);
    const topic = 'how long your calls are running';

    const moved = bridge.describePriorCoaching(
        { verdict: 'moved', beatTeam: true, beforeLabel: '8:32', afterLabel: '7:40' }, topic);
    t.check('a win is credited', /moved the right way the following week/.test(moved));
    t.check('with the numbers', /from 8:32 to 7:40/.test(moved));
    t.check('and the team comparison when there is one',
        /better than the centre managed over the same week/.test(moved));
    t.check('and it tells them the effort registered', /the change you made registered/.test(moved));

    // A week where the whole centre improved is not evidence they did anything.
    const movedWithTeam = bridge.describePriorCoaching(
        { verdict: 'moved', beatTeam: false, beforeLabel: '8:32', afterLabel: '7:40' }, topic);
    t.check('no team claim when the team did better', !/better than the centre/.test(movedWithTeam));

    const backwards = bridge.describePriorCoaching(
        { verdict: 'went backwards', beatTeam: null, beforeLabel: '7:40', afterLabel: '8:10' }, topic);
    t.check('a loss is said plainly', /went the other way the following week/.test(backwards));
    t.check('and blames the advice, not the person',
        /the advice did not fit the problem/.test(backwards));

    const flat = bridge.describePriorCoaching(
        { verdict: 'held flat', beatTeam: null, beforeLabel: '7:40', afterLabel: '7:38' }, topic);
    t.check('no change says so', /held about where it was/.test(flat));
    t.check('and promises a different angle', /a different angle/.test(flat));

    // Waiting on the next upload is a sentence for the supervisor, not the
    // associate.
    t.equal('a pending verdict says nothing',
        bridge.describePriorCoaching({ verdict: 'pending' }, topic), '');
    t.equal('and neither does no history', bridge.describePriorCoaching(null, topic), '');

    // Missing values must not leave a dangling sentence.
    const noNumbers = bridge.describePriorCoaching({ verdict: 'moved', beatTeam: null }, topic);
    t.check('it reads without the numbers', /moved the right way/.test(noNumbers));
    t.check('with no empty movement clause', !/It went from  to /.test(noNumbers));
});

suite('coaching bridge: the prior result reaches the message', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    t.check('the last settled outcome is looked up',
        /function findPriorCoachingOutcome[\s\S]{0,900}buildOutcomes\?\.\(employeeName\)/.test(script));
    t.check('pending verdicts are skipped',
        /findPriorCoachingOutcome[\s\S]{0,900}verdict !== 'pending'/.test(script));
    t.check('the most recent one wins',
        /findPriorCoachingOutcome[\s\S]{0,1100}coachedAt.*localeCompare/.test(script));
    t.check('the values are formatted for a person',
        /findPriorCoachingOutcome[\s\S]{0,1400}formatMetricDisplay\(metricKey, value\)/.test(script));
    t.check('and it is handed to the message', script.includes('priorOutcome: findPriorCoachingOutcome('));
});

suite('coaching bridge: one call reads properly too', (t) => {
    const { callCoachingBridge: bridge } = load(t, null, { aht: ['Type notes while talking'] });

    const one = 'Thursday, September 3 at 6:35 PM';
    const finding = (key, text) => ({
        key, text, quote: 'one moment', appearsOn: 'on this call',
        count: 1, weight: 5, phrase: '', moments: [one]
    });
    const build = (evidence, options) => bridge.buildMetricMessage(
        {
            metricKey: 'aht', label: 'Average Handle Time', headline: 'Average Handle Time',
            evidence,
            tips: [{ id: 'a', metricKey: 'aht', text: 'Type notes while talking', effectiveness: null }]
        },
        Object.assign({
            preferredName: 'Esther', callMoments: [one], callLabel: '8 minute call',
            askedQuestion: 'How do I lower my AHT?'
        }, options || {})
    );

    // "The pattern I keep seeing" claims repetition across calls. On one call
    // it read "It came up on 1 of them", which is a history that does not
    // exist. Two findings from one family on one call is still worth naming,
    // as a theme rather than a pattern.
    const themed = build([
        finding('stalling', 'Silence fillers came up repeatedly.'),
        finding('deadAirGap', 'Dead air: about 2m 10s at 4:30.')
    ]);
    t.check('no pattern is claimed across one call', !/pattern I keep seeing/.test(themed));
    t.check('but the theme is still named', /It all comes back to silence/.test(themed));
    t.check('and it does not say 1 of them', !/of them/.test(themed));

    // The phrases carry their own colon, so the sentence cannot add another.
    t.check('no double colon', !/thing: silence:/.test(themed));
    t.check('exactly one colon in the theme line',
        (themed.split('\n').find((l) => l.indexOf('It all comes back') === 0) || '').split(':').length === 2);

    const single = build([finding('stalling', 'Silence fillers came up repeatedly.')]);
    t.check('one finding says so', /Here is the one thing that stood out/.test(single));
    t.check('the call is named once', (single.match(/September 3/g) || []).length === 1);
    t.check('and findings are not prefixed with it', !/On the September 3 call/.test(single));

    // Whether the last round worked matters just as much off one call.
    const withPrior = build([finding('stalling', 'Silence fillers came up repeatedly.')], {
        priorOutcome: { verdict: 'moved', beatTeam: true, beforeLabel: '8:32', afterLabel: '7:40' }
    });
    t.check('the prior result still appears', /moved the right way the following week/.test(withPrior));

    // No date entered on the form, so the count is unknown. "A few of your
    // calls" would be a guess about how many.
    const noDate = bridge.buildMetricMessage(
        {
            metricKey: 'aht', label: 'Average Handle Time', headline: 'Average Handle Time',
            evidence: [finding('stalling', 'Silence fillers came up repeatedly.')],
            tips: []
        },
        { preferredName: 'Esther', callMoments: [], callLabel: 'call' }
    );
    t.check('an unknown count is not guessed at', !/a few of your calls/.test(noDate));
    t.check('and it still reads', /listen to your recent calls/.test(noDate));

    // Reachable only by calling this directly, since a metric with no evidence
    // never gets a chip. It must not introduce a list that is not there.
    const nothing = build([]);
    t.check('nothing found introduces nothing', !/Here is what stood out/.test(nothing));
    t.check('and leaves no double blank line', !/\n\n\n/.test(nothing));
    t.check('but still greets and closes', /^Hi Esther,/.test(nothing) && /Come find me/.test(nothing));

    [themed, single, withPrior, noDate, nothing].forEach((message, index) => {
        t.check('no em dashes in case ' + index, !/[—–]/.test(message));
        t.check('no leftover tokens in case ' + index, !/\{|\}/.test(message));
        t.check('no dangling colon in case ' + index, !/:\s*\n\n/.test(message));
    });
});

suite('coaching bridge: a hold finding reaches the hold tips', (t) => {
    // The hold tips live in the hold time pool. A long hold is handle time AND
    // hold time, so a hold finding shown under the handle time chip could not
    // reach them and fell through to generic advice about slow tasks and
    // rambling customers.
    const { callCoachingBridge: bridge } = load(t, null, {
        aht: ['Identify your 2 slowest tasks and find a faster way', 'If the customer is rambling, gently redirect'],
        holdTime: ['Ask for everything you need before the hold starts', 'Check back every 45 seconds on a hold']
    });

    const evidence = [{
        key: 'longHold',
        text: 'Long hold: about 4m 05s of silence starting at 5:54.',
        quote: '', appearsOn: 'on this call', count: 1, weight: 7, phrase: '',
        moments: ['Thursday, September 3 at 6:35 PM']
    }];

    const picked = bridge.selectTips('aht', evidence);
    t.check('it reaches the other pool', picked.some(tip => /before the hold starts/.test(tip.text)));
    t.check('and the unrelated tips stay out', !picked.some(tip => /slowest tasks|rambling/.test(tip.text)));
    t.check('everything returned is a real match', picked.every(tip => tip.matchedEvidence === true));

    // Widening the pool is only safe because relevance still decides. A
    // finding nothing addresses must not start pulling in another metric's
    // tips wholesale.
    const unrelated = bridge.selectTips('aht', [{
        key: 'coldTransfer', text: 'Transfers: brief the receiving team.',
        quote: '', appearsOn: 'on this call', count: 1, weight: 7, phrase: '', moments: []
    }]);
    t.check('an unmatched finding still falls back rather than flooding',
        unrelated.every(tip => tip.matchedEvidence === false));
    t.check('and only two of them', unrelated.length <= 2);

    // Duplicated tips across pools are not offered twice.
    const overlapping = load(t, null, {
        aht: ['Check back every 45 seconds on a hold'],
        holdTime: ['Check back every 45 seconds on a hold']
    }).callCoachingBridge.selectTips('aht', evidence);
    t.equal('a tip in both pools appears once', overlapping.length, 1);
});

suite('coaching bridge: short words that are specific anyway', (t) => {
    const { callCoachingBridge: bridge } = load(t);

    // Specificity is judged by length, which works for "narrat" and fails for
    // domain nouns. "hold" is four characters and is the most on-topic word a
    // hold tip can contain.
    t.check('hold counts as specific', bridge.SPECIFIC_SHORT_WORDS.has('hold'));

    // The exception must stay an exception. Every entry has to be a word the
    // length rule would otherwise have called weak, or this becomes a way to
    // promote vague long words.
    const notShort = [...bridge.SPECIFIC_SHORT_WORDS].filter(word => word.length >= 5 || word.includes(' '));
    t.equal(`the override only holds short words (${notShort.join(', ') || 'it does'})`, notShort.length, 0);

    // And small enough to read. A long list means the length rule is wrong
    // rather than incomplete.
    t.check('and stays small', bridge.SPECIFIC_SHORT_WORDS.size <= 6);

    // Every override has to be a keyword something actually uses, or it is
    // dead configuration.
    const allKeywords = new Set();
    Object.values(bridge.FINDING_KEYWORDS).forEach(words => words.forEach(word => allKeywords.add(word)));
    const orphaned = [...bridge.SPECIFIC_SHORT_WORDS].filter(word => !allKeywords.has(word));
    t.equal(`no override is dead configuration (${orphaned.join(', ') || 'none'})`, orphaned.length, 0);
});

suite('coaching bridge: pronouns have something to refer to', (t) => {
    const fs = require('fs');
    const path = require('path');
    const { ROOT } = require('./harness');
    const transcript = fs.readFileSync(path.join(ROOT, 'modules/call-transcript.module.js'), 'utf8');

    // The message strips a leading "Long hold:" label, and that label was
    // supplying the antecedent, so "you did announce it" arrived referring to
    // nothing at all.
    t.check('the hold is named, not pronouned', /You did announce the hold/.test(transcript));
    t.check('and the bare pronoun is gone', !/You did announce it/.test(transcript));
});

suite('coaching bridge: the QA findings reach the message', (t) => {
    const { callTranscript, callWordChoice, callCoachingBridge: bridge } = loadWithQa(t);

    // A new service call that skips most of the required disclosures, does not
    // verify, and closes without offering more help. All of it was on the QA
    // panel and none of it reached her.
    const CALL = [
        'Agent: Thank you for calling APS, my name is Esther.',
        'Customer: I just moved into a new apartment and I need to set up service.',
        'Agent: We have three plans available. The first plan is the fixed energy charge plan.',
        'Agent: On this plan your energy rate is the same no matter the time of day.',
        'Agent: You will receive an email to set up your account.',
        'Agent: Okay, that is done.'
    ].join('\n');

    const analysis = callTranscript.analyzeTranscript(CALL, { associateName: 'Esther Ramos' });
    const wordChoice = callWordChoice.scanTranscript(CALL, { associateName: 'Esther Ramos', analysis });
    const { findings } = bridge.collectFindings({
        analysis, wordChoice, transcript: CALL,
        associateName: 'Esther Ramos', callDate: '2026-09-03', callTime: '6:35 PM'
    });

    const qaFindings = findings.filter((f) => f.kind === 'qa');
    t.check('QA findings are in the set at all', qaFindings.length > 0);

    // The open call is the one the supervisor is looking at. It used to be
    // pushed into the set without its QA read, so every QA finding on it was
    // dropped and only saved history could contribute any.
    const disclosures = qaFindings.find((f) => f.key === 'qaDisclosures');
    t.check('the missed disclosures are reported', Boolean(disclosures));
    t.check('and named, not counted', /rates quoted for the plans discussed/.test(disclosures.text));
    t.check('with a plain count', /of the \w+ things we have to cover/.test(disclosures.text));

    // "Four of the Six things" was the first attempt.
    t.check('the count is not capitalised mid sentence', !/of the [A-Z]/.test(disclosures.text));
    // One label carries its own comma, so a comma list reads as two items.
    t.check('labels with commas are separated by semicolons', disclosures.text.includes('; '));

    // No QA vocabulary survived into her copy.
    qaFindings.forEach((f, i) => {
        t.check('QA finding ' + i + ' has no form label', !/^[A-Z][A-Za-z]*(?: [a-z]+){0,2}:\s/.test(f.text));
        t.check('QA finding ' + i + ' says nothing about disclosures', !/disclosure/i.test(f.text));
        t.check('QA finding ' + i + ' has no verdict word', !/opportunity|cannot tell|not heard/i.test(f.text));
    });
});

suite('coaching bridge: what the QA form does NOT say to her', (t) => {
    const { callTranscript, callWordChoice, callCoachingBridge: bridge } = loadWithQa(t);

    // A system error is on the QA form because it explains the call, not
    // because she did anything. Telling her to fix one is feedback she cannot
    // act on, attached to something that was not her fault.
    const CALL = [
        'Agent: Thank you for calling APS, my name is Esther.',
        'Customer: My bill doubled and I want to know why.',
        'Agent: My system is being slow, it is not letting me in, bear with me.',
        'Agent: Sorry, it kicked me out again.',
        'Agent: Okay, you are all set. Is there anything else I can help with?'
    ].join('\n');

    const analysis = callTranscript.analyzeTranscript(CALL, { associateName: 'Esther Ramos' });
    const wordChoice = callWordChoice.scanTranscript(CALL, { associateName: 'Esther Ramos', analysis });
    const { findings } = bridge.collectFindings({
        analysis, wordChoice, transcript: CALL,
        associateName: 'Esther Ramos', callDate: '2026-09-03'
    });

    const text = findings.map((f) => f.text).join(' ');
    t.check('a system error is not coached to her', !/system error/i.test(text));
    t.check('nor an audio problem', !/audio issue/i.test(text));
    t.check('nor a dropped call', !/call dropped/i.test(text));

    // It is still counted for the supervisor, which is where it belongs.
    const withHistory = bridge.collectFindings({
        analysis, wordChoice, transcript: CALL, associateName: 'Esther Ramos',
        history: [{ listenedOn: '2026-08-01', employeeName: 'Esther Ramos', transcript: CALL + '\nAgent: reference two.' }]
    });
    t.check('but the supervisor still sees it',
        withHistory.repeatOpportunities.some((row) => /System Errors/.test(row.label)));
});

suite('coaching bridge: one long hold, not two', (t) => {
    const { callTranscript, callWordChoice, callCoachingBridge: bridge } = loadWithQa(t);

    // The transcript engine measures the hold and the QA form flags it. Both
    // are right, and saying it twice from two sources reads as two problems.
    const CALL = [
        '00:05',
        'thank you for calling APS my name is esther',
        '00:20',
        'let me place you on a brief hold while i look at that',
        '04:30',
        'thank you for holding, you are all set, anything else i can help with'
    ].join('\n');

    const analysis = callTranscript.analyzeTranscript(CALL, { associateName: 'Esther Ramos' });
    const wordChoice = callWordChoice.scanTranscript(CALL, { associateName: 'Esther Ramos', analysis });
    const { findings } = bridge.collectFindings({
        analysis, wordChoice, transcript: CALL, associateName: 'Esther Ramos', callDate: '2026-09-03'
    });

    const holdFindings = findings.filter((f) => f.key === 'longHold');
    t.check('the hold is reported once at most', holdFindings.length <= 1);
    t.check('and the QA copy did not add a second',
        findings.filter((f) => /long hold/i.test(f.text)).length <= 1);
});
