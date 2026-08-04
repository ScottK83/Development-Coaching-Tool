'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-listening.module.js');
    return global.window.DevCoachModules;
}

const GOOD_CALL = [
    'Agent: Thank you for calling, my name is Jamie. How can I help you today?',
    'Customer: My bill doubled this month and I have no idea why.',
    'Agent: I completely understand how frustrating that is. Let me take care of this for you.',
    'Agent: Before I pull it up, can you confirm your date of birth for verification?',
    'Customer: Sure, it is May 4th 1983.',
    'Agent: Perfect. May I place you on a brief hold while I check the billing detail?',
    'Customer: That is fine.',
    'Agent: Thank you for holding. I found a duplicate charge and I have credited it back.',
    'Agent: To recap, the duplicate charge is reversed and you will see it within 3 business days.',
    'Agent: For future reference you can also check charges on the app before they post.',
    'Agent: Does that make sense? Is there anything else I can help with?',
    'Customer: No, thank you so much, you have been so helpful.'
].join('\n');

const ROUGH_CALL = [
    'Agent: Yeah, what do you need?',
    'Customer: This is the third time I have called about this and it is ridiculous.',
    'Agent: Um, I think that is just our policy, there is nothing I can do about it.',
    'Customer: Like I said, I already explained this to the last person.',
    'Agent: Hold on. One moment. Bear with me. Just a second.',
    'Agent: I am going to transfer you to the billing department.',
    'Customer: Can I speak to a supervisor?'
].join('\n');

function keys(items) {
    return items.map((item) => item.key);
}

suite('call transcript: speaker parsing', (t) => {
    const { callTranscript } = load(t);

    const parsed = callTranscript.parseTranscript(GOOD_CALL, { associateName: 'Jamie Rivera' });
    t.check('detects speaker labels', parsed.labeled === true);
    t.equal('counts every turn', parsed.turns.length, 12);
    t.check('agent lines routed to the agent side', /my name is Jamie/.test(parsed.agentText));
    t.check('customer lines routed to the customer side', /bill doubled/.test(parsed.customerText));
    t.check('agent word count is populated', parsed.agentWords > 0);

    // Named speakers with no Agent/Customer keyword: the greeter is the agent.
    const named = callTranscript.parseTranscript([
        'Jamie: Thank you for calling, how can I help?',
        'Pat: My internet is down again.'
    ].join('\n'));
    t.equal('greeter is treated as the agent', named.turns[0].role, 'agent');
    t.equal('the other speaker is the customer', named.turns[1].role, 'customer');

    // Wrapped lines belong to the speaker above them, not to a new turn.
    const wrapped = callTranscript.parseTranscript([
        'Agent: I can look into that for you',
        'and it should only take a moment.',
        'Customer: Thanks.'
    ].join('\n'));
    t.equal('wrapped text folds into the previous turn', wrapped.turns.length, 2);
    t.check('wrapped text is kept', /only take a moment/.test(wrapped.turns[0].text));

    // Pasted notes with no labels still get analyzed rather than rejected.
    const unlabeled = callTranscript.parseTranscript('Handled the billing question and set a callback.');
    t.check('unlabeled paste is flagged', unlabeled.labeled === false);
    t.check('unlabeled paste is read as the associate', unlabeled.agentText.length > 0);
});

suite('call transcript: strengths', (t) => {
    const { callTranscript } = load(t);
    const analysis = callTranscript.analyzeTranscript(GOOD_CALL, { associateName: 'Jamie Rivera' });
    const found = keys(analysis.strengths);

    t.check('analysis succeeds', analysis.ok === true);
    t.check('credits the branded greeting', found.includes('greeting'));
    t.check('credits empathy', found.includes('empathy'));
    t.check('credits ownership', found.includes('ownership'));
    t.check('credits verification', found.includes('verification'));
    t.check('credits hold etiquette', found.includes('holdEtiquette'));
    t.check('caps the list so the email stays short', analysis.strengths.length <= 5);

    const draft = callTranscript.buildStrengthsDraft(analysis);
    t.check('draft is bulleted', draft.startsWith('- '));
    t.check('draft quotes the line that earned it', draft.includes('"'));
    t.check('draft avoids em dashes', !draft.includes('—'));

    // A clean call should not manufacture coaching points from missing behaviours.
    const gaps = keys(analysis.improvements);
    t.check('no recap gap flagged', !gaps.includes('recap'));
    t.check('no next steps gap flagged', !gaps.includes('nextSteps'));
    t.check('no close gap flagged', !gaps.includes('courtesyClose'));
});

suite('call transcript: coaching points', (t) => {
    const { callTranscript } = load(t);
    const analysis = callTranscript.analyzeTranscript(ROUGH_CALL, { associateName: 'Jamie Rivera' });
    const found = keys(analysis.allImprovements);

    t.check('flags dead end policy language', found.includes('deflection'));
    t.check('flags the customer repeating themselves', found.includes('repeatCustomer'));
    t.check('flags the supervisor request', found.includes('supervisorRequest'));
    t.check('flags the cold transfer', found.includes('coldTransfer'));
    t.check('ranks the heaviest issue first', analysis.improvements[0].weight >= 8);
    t.check('caps the draft list', analysis.improvements.length <= 5);
    t.check('keeps the trimmed items on the result', analysis.allImprovements.length > analysis.improvements.length);
    t.check('summary admits what it held back', /held back/.test(callTranscript.buildAnalysisSummary(analysis)));

    const draft = callTranscript.buildImprovementsDraft(analysis);
    t.check('draft is bulleted', draft.startsWith('- '));
    t.check('draft avoids em dashes', !draft.includes('—'));
});

suite('call transcript: missing behaviours become coaching', (t) => {
    const { callTranscript } = load(t);
    const bare = callTranscript.analyzeTranscript([
        'Agent: Ok, that is done.',
        'Customer: Alright.'
    ].join('\n'));
    const found = keys(bare.allImprovements);

    t.check('missing recap is coached', found.includes('recap'));
    t.check('missing next steps is coached', found.includes('nextSteps'));
    t.check('missing verification is coached', found.includes('verification'));
    t.check('empathy outranks the courtesy close', found.indexOf('empathy') < found.indexOf('courtesyClose'));
});

suite('call transcript: frustration raises the empathy call', (t) => {
    const { callTranscript } = load(t);
    const analysis = callTranscript.analyzeTranscript([
        'Agent: What is the account number?',
        'Customer: This is unacceptable, I am fed up with being charged twice.',
        'Agent: The charge posted on the 4th.'
    ].join('\n'));

    const empathy = analysis.improvements.find((item) => item.key === 'empathy');
    t.check('empathy gap is raised to the top', analysis.improvements[0].key === 'empathy');
    t.check('wording names the unacknowledged frustration', /frustration/.test(empathy.text));
    t.check('quotes the customer, not the agent', /unacceptable|fed up/.test(empathy.quote));
    t.check('stats record the frustration', analysis.stats.customerFrustrated === true);
});

// Transcription vendors expand contractions inconsistently, so every rule has
// to read "that is" the same way it reads "that's".
suite('call transcript: contracted and expanded speech read alike', (t) => {
    const { callTranscript } = load(t);

    const expanded = callTranscript.analyzeTranscript([
        'Agent: I am sorry about that, I will take care of it.',
        'Customer: Thanks.',
        'Agent: That is just our policy though, you will have to call the other team.'
    ].join('\n'));
    const contracted = callTranscript.analyzeTranscript([
        "Agent: I'm sorry about that, I'll take care of it.",
        'Customer: Thanks.',
        "Agent: That's just our policy though, you'll have to call the other team."
    ].join('\n'));

    t.check('expanded form credits empathy', keys(expanded.allStrengths).includes('empathy'));
    t.check('expanded form credits ownership', keys(expanded.allStrengths).includes('ownership'));
    t.check('expanded form flags the dead end', keys(expanded.allImprovements).includes('deflection'));
    t.equal(
        'both forms produce the same strengths',
        keys(expanded.allStrengths).join(','),
        keys(contracted.allStrengths).join(',')
    );
    t.equal(
        'both forms produce the same coaching points',
        keys(expanded.allImprovements).join(','),
        keys(contracted.allImprovements).join(',')
    );
});

suite('call transcript: hold without permission', (t) => {
    const { callTranscript } = load(t);

    const rude = callTranscript.analyzeTranscript('Agent: Hold on.\nCustomer: Ok.');
    t.check('flags an unannounced hold', keys(rude.improvements).includes('holdProcess'));

    const polite = callTranscript.analyzeTranscript(
        'Agent: May I place you on a brief hold?\nCustomer: Sure.\nAgent: Thank you for holding.'
    );
    t.check('does not flag a proper hold', !keys(polite.improvements).includes('holdProcess'));
});

suite('call transcript: guards and summary', (t) => {
    const { callTranscript } = load(t);

    const empty = callTranscript.analyzeTranscript('   ');
    t.check('empty transcript is rejected', empty.ok === false);
    t.equal('empty transcript reports why', empty.reason, 'empty');

    const analysis = callTranscript.analyzeTranscript(GOOD_CALL, { associateName: 'Jamie Rivera' });
    const summary = callTranscript.buildAnalysisSummary(analysis);
    t.check('summary reports the turn count', /12 turns read/.test(summary));
    t.check('summary reminds the supervisor to review', /editable/i.test(summary));

    const long = 'x'.repeat(callTranscript.MAX_STORED_TRANSCRIPT_CHARS + 500);
    const stored = callTranscript.clampForStorage(long);
    t.check('storage clamp caps length', stored.length < long.length);
    t.check('storage clamp says it truncated', /truncated for storage/.test(stored));
    t.equal('short transcripts are stored whole', callTranscript.clampForStorage('short one'), 'short one');
});

suite('call transcript: feeds the Copilot prompt', (t) => {
    const { callListening } = load(t);

    const withTranscript = callListening.buildPrompt({
        employeeName: 'Jamie Rivera',
        listenedOn: '2026-08-04',
        callReference: 'INT-991',
        transcript: GOOD_CALL,
        whatWentWell: '- Strong empathy',
        improvementAreas: '- Slow down discovery'
    }, 'Jamie');

    t.check('prompt carries the transcript', withTranscript.includes('Thank you for calling, my name is Jamie'));
    t.check('prompt marks it as the source of truth', /source of truth/.test(withTranscript));
    t.check('prompt tells Copilot to quote from it', /quote a short phrase/.test(withTranscript));
    t.check('prompt keeps the no invention rule', /Do not invent details/.test(withTranscript));

    const withoutTranscript = callListening.buildPrompt({
        employeeName: 'Jamie Rivera',
        listenedOn: '2026-08-04',
        whatWentWell: '- Strong empathy',
        improvementAreas: '- Slow down discovery'
    }, 'Jamie');

    t.check('no transcript means no transcript block', !/source of truth/.test(withoutTranscript));
    t.check('no transcript means no quoting rule', !/quote a short phrase/.test(withoutTranscript));
    t.check('core requirements survive either way', /Return ONLY the final email body text/.test(withoutTranscript));
});
