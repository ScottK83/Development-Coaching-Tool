'use strict';

/**
 * HOW A CALL EMAIL READS ON THE OTHER END
 *
 * Scott, 2026-10-14: "Think of the way they would receive the info. Think of
 * how it comes off. Offer lots of kudos and praise." A read of the call
 * emails turned up four things that land badly:
 *
 *   Notes meant for Scott went to the associate. With nothing found, Analyze
 *   wrote "Nothing stood out clearly in the transcript. Add the one thing you
 *   would want repeated on the next call." into the notes, and the email
 *   counted it as a point: "Here is what stood out: - Nothing stood out".
 *
 *   It contradicted itself. A strong call with nothing to fix read "there are
 *   a couple of things worth tightening... For next time: - Nothing here
 *   needs fixing".
 *
 *   It sounded British to a team in Phoenix ("have a think", "come and find
 *   me", "behaviour", "a proper listen", "centre"), and opened with "you all"
 *   in an email to one person.
 *
 *   The metric message never said anything that went well.
 */

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    global.getMetricTips = () => [];
    global.window.METRICS_REGISTRY = { aht: { label: 'Average Handle Time' } };
    global.window.formatMetricDisplay = (key, value) => String(value);
    t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-verification.module.js');
    t.loadModule('modules/call-summary.module.js');
    t.loadModule('modules/call-word-choice.module.js');
    t.loadModule('modules/call-coaching-bridge.module.js');
    t.loadModule('modules/call-listening.module.js');
    return global.window.DevCoachModules;
}

function entry(extra) {
    return Object.assign({
        employeeName: 'Alyssa Dimes',
        listenedOn: '2026-09-04',
        callTime: '11:26 AM',
        callReference: 'INT-4471',
        transcript: '',
        whatWentWell: '',
        improvementAreas: '',
        oscarUrl: '',
        relevantInfo: '',
        managerNotes: ''
    }, extra || {});
}

const OLD_STRENGTH_HINT = '- Nothing stood out clearly in the transcript. Add the one thing you would want repeated on the next call.';
const OLD_WORK_HINT = '- Nothing here needs fixing, so keep doing what you did and we will pick one thing to push on next call.';
const BRITISH = /\b(behaviour|centre|colour|apologis|organis|recognis|realis|prioritis|summaris|favour|have a think|come and find|proper listen|give (?:those|it|that) a go|sorted)\b/i;

suite('email voice, call: an empty read writes nothing', (t) => {
    const { callTranscript: T } = load(t);

    t.equal('no strengths, no draft', T.buildStrengthsDraft({ ok: true, strengths: [], improvements: [] }), '');
    t.equal('nothing to work on, no draft', T.buildImprovementsDraft({ ok: true, strengths: [], improvements: [] }), '');
    // The hint still exists, for the page to show where only Scott sees it.
    t.check('the hint is kept for a placeholder', /Add the one thing/.test(T.DRAFT_HINTS.strengths));
    t.check('and old notes can be cleaned of it',
        T.stripDraftHints(`- Great ownership.\n${OLD_STRENGTH_HINT}`) === '- Great ownership.');
});

suite('email voice, call: hint lines in saved notes never reach her', (t) => {
    const { callListening: api } = load(t);

    // A strong call whose notes were saved with the old fallback in the
    // "work on" box. That one line made the email say there were things to
    // tighten, then list nothing.
    const strong = api.buildCallFeedbackMessage(entry({
        whatWentWell: '- Great ownership.\n- Clear recap.\n- Warm close.',
        improvementAreas: OLD_WORK_HINT
    }));
    t.check('the hint is not in the email', !/Nothing here needs fixing/.test(strong));
    t.check('no "couple of things" when there are none', !/couple of things|worth tightening/.test(strong));
    t.check('no empty "For next time"', !/For next time/.test(strong));
    t.check('it reads as a clean call', /nothing I need you to change/.test(strong));

    const empty = api.buildCallFeedbackMessage(entry({
        whatWentWell: OLD_STRENGTH_HINT,
        improvementAreas: '- Slow down before you transfer.'
    }));
    t.check('the strengths hint is not in the email', !/Nothing stood out clearly|Add the one thing/.test(empty));
    t.check('and no empty "what stood out" heading', !/Here is what stood out/.test(empty));
    t.check('the real point is still there', /Slow down before you transfer/.test(empty));

    // The prompts read the same notes.
    const prompt = api.buildPrompt(entry({ whatWentWell: OLD_STRENGTH_HINT, improvementAreas: OLD_WORK_HINT }), 'Alyssa');
    t.check('the Copilot prompt does not carry the hints either', !/Nothing stood out clearly|Nothing here needs fixing/.test(prompt));
});

suite('email voice, call: the framing matches what is there', (t) => {
    const { callListening: api } = load(t);

    const one = api.buildCallFeedbackMessage(entry({
        whatWentWell: '- Great ownership.\n- Clear recap.\n- Warm close.',
        improvementAreas: '- Slow down on discovery.'
    }));
    t.check('one point is one thing', /there is one thing worth tightening/.test(one));

    const two = api.buildCallFeedbackMessage(entry({
        whatWentWell: '- Great ownership.\n- Clear recap.\n- Warm close.',
        improvementAreas: '- Slow down on discovery.\n- Recap the dates.'
    }));
    t.check('two points are a couple', /a couple of things worth tightening/.test(two));

    const work = api.buildCallFeedbackMessage(entry({ improvementAreas: '- Slow down on discovery.' }));
    t.check('a single point with no praise notes is still one thing', /There is one thing I want to go through with you/.test(work));
});

suite('email voice, call: American, and written to one person', (t) => {
    const { callListening: api, callTranscript: T, callCoachingBridge: bridge } = load(t);

    const messages = [
        api.buildCallFeedbackMessage(entry({ whatWentWell: '- Great ownership.' })),
        api.buildCallFeedbackMessage(entry({ whatWentWell: '- Good greeting.', improvementAreas: '- Slow down.\n- Recap.' })),
        api.buildCallFeedbackMessage(entry({ whatWentWell: '- Good greeting.', improvementAreas: '- Slow down.' })),
        api.buildCallFeedbackMessage(entry({ improvementAreas: '- Slow down.\n- Recap.\n- Close.' })),
        bridge.buildMetricMessage({ metricKey: 'fcr', label: 'First Call Resolution', evidence: [], tips: [] }, {}),
        bridge.buildMetricMessage({ metricKey: 'aht', label: 'Average Handle Time', evidence: [], tips: [{ text: 'Type notes while talking.' }] }, { preferredName: 'Esther' }),
        bridge.describePriorCoaching({ verdict: 'moved', beatTeam: true, beforeLabel: '8:32', afterLabel: '7:40' }, 'how long your calls are running')
    ];

    // Every rule's own wording, through the engine, the way the drafts get it.
    const call = [
        'Agent: Thank you for calling APS, my name is Jamie. How can I help you today?',
        'Customer: My bill doubled and this is ridiculous.',
        'Agent: I am sorry. I am so sorry. I am really sorry about that. I apologize. I am sorry.',
        'Agent: To recap, I credited the charge and you will see it in three days.',
        'Customer: Thank you so much, you have been so helpful.'
    ].join('\n');
    const analysis = T.analyzeTranscript(call, { associateName: 'Jamie' });
    (analysis.allStrengths || []).concat(analysis.allImprovements || []).forEach((item) => messages.push(item.text));
    messages.push(T.buildStrengthsDraft(analysis), T.buildImprovementsDraft(analysis));

    const british = messages.filter((text) => BRITISH.test(text)).map((text) => text.match(BRITISH)[0]);
    t.equal(`no British spellings or phrasing (${british.join(', ') || 'clean'})`, british.length, 0);
    t.check('no "you all" in a one-to-one email', messages.every((text) => !/\byou all\b/i.test(text)));
    t.check('the opening still names the call', /I reviewed a call you took on/.test(messages[0]));
    t.check('the source has no British headline left', !/behaviour we coach/.test(T.analyzeTranscript.toString()));
});

suite('email voice, call: the metric message opens on what went well', (t) => {
    const { callCoachingBridge: bridge, callTranscript: T } = load(t);

    const brief = {
        metricKey: 'aht',
        label: 'Average Handle Time',
        evidence: [{ key: 'stalling', text: 'Silence fillers came up repeatedly.', quote: '', appearsOn: 'on this call', count: 1, weight: 5, phrase: '' }],
        tips: [{ id: 'a', metricKey: 'aht', text: 'Type notes while talking.' }],
        praise: ['Clean open. You named APS and gave your own name straight away.', 'Real empathy. You acknowledged where the customer was before moving into the fix.']
    };
    const message = bridge.buildMetricMessage(brief, { preferredName: 'Esther', callMoments: ['Thursday, September 3 at 6:35 PM'] });
    t.check('it names what went well', /First, what you did really well:\n- Clean open/.test(message));
    t.check('before any of the coaching', message.indexOf('Clean open') < message.indexOf('Silence fillers'));
    t.check('and before the suggestions', message.indexOf('Real empathy') < message.indexOf('worth trying'));

    const bare = bridge.buildMetricMessage({ ...brief, praise: [] }, { preferredName: 'Esther' });
    t.check('with nothing to name it still thanks her', /Thank you for the care you put into your calls/.test(bare));

    // The praise comes from the calls themselves, through the same path the
    // page already uses: collectFindings, then metricsInFocus, then the brief.
    const call = [
        'Agent: Thank you for calling APS, my name is Jamie. How can I help you today?',
        'Customer: My bill doubled this month and I have no idea why.',
        'Agent: I completely understand how frustrating that is. Let me take care of this for you.',
        'Agent: um so um one moment, just a second, bear with me, one moment',
        'Agent: To recap, the duplicate charge is reversed and you will see it within 3 business days.',
        'Customer: No, thank you so much, you have been so helpful.'
    ].join('\n');
    const analysis = T.analyzeTranscript(call, { associateName: 'Jamie' });
    const collected = bridge.collectFindings({ analysis, transcript: call, associateName: 'Jamie', callDate: '2026-09-03' });
    t.check('the findings carry what went well', collected.praise.length > 0 && collected.praise.length <= 2);
    t.check('on the list the page passes along', Array.isArray(collected.findings.praise) && collected.findings.praise.length > 0);
    const focus = bridge.metricsInFocus([{ metricKey: 'aht', label: 'Average Handle Time', meetsTarget: false, employeeValue: 620, target: 426 }], collected.findings);
    if (focus.length) {
        const built = bridge.buildMetricBrief(focus[0], {});
        t.check('and it reaches the brief', built.praise.length > 0);
    }

    const prompt = bridge.buildMetricPrompt(brief, { preferredName: 'Esther' });
    t.check('the Copilot prompt hands the praise over', /What they did well, in my words:\n- Clean open/.test(prompt));
    t.check('and asks for it first', /Open with one warm, specific line about what they did well/.test(prompt));
    t.check('with the emoji budget', /At most 2 emojis/.test(prompt));
});

suite('email voice, call: quotes read like speech, not a transcript', (t) => {
    const { callTranscript: T, callCoachingBridge: bridge } = load(t);

    t.equal('a break mark is not quoted across',
        T.clipQuote('i ask you i got an apartment i sign - lease today and i need the power on', /power on/),
        'Lease today and I need the power on');
    t.equal('a lone i is a capital', T.tidyQuote('okay so i can help with that'), 'Okay so I can help with that');
    t.equal('two words is a fragment, not a quote', T.clipQuote('um okay'), '');
    const long = T.clipQuote('so what happened here is that the bill covered thirty four days instead of thirty because the meter was read late and that is why it went up so much this month for you', /meter was read late/);
    t.check('a long line keeps the moment', /meter was read late/.test(long));
    t.check('and stays short', long.length <= 120);

    t.equal('the message tidies what it quotes back', bridge.tidyHeard('i do need to place you - on hold.'), 'I do need to place you, on hold');
    t.equal('and drops a single word', bridge.tidyHeard('okay'), '');
});

suite('email voice, call: subjects and prompts', (t) => {
    const { callListening: api } = load(t);

    const subject = api.buildOutlookSubject('Alyssa Dimes', '2026-10-09', () => 'Alyssa');
    t.equal('the subject reads like a person wrote it', subject, 'Call feedback for Alyssa, Oct 9');
    t.check('no hyphen separators', !/ - /.test(subject));

    const e = entry({ whatWentWell: '- Great ownership.', improvementAreas: '- Slow down.' });
    t.check('the email prompt sets the emoji budget', /At most 2 emojis/.test(api.buildPrompt(e, 'Alyssa')));
    t.check('so does the summary prompt', /at most 2 emojis/.test(api.buildCoachingSummaryPrompt(e)));
    t.check('and the email-from-summary prompt', /at most 2 emojis/.test(api.buildEmailFromSummaryPrompt(e, 'Alyssa')));
    t.check('the prompt spells it the American way', !/behaviour/.test(api.buildPrompt(e, 'Alyssa')));
});
