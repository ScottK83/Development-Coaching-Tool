'use strict';

const fs = require('fs');
const path = require('path');
const { suite } = require('./harness');

const VERINT_EXPORT = fs.readFileSync(path.join(__dirname, 'fixtures', 'verint-export.txt'), 'utf8');

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
    const found = keys(analysis.allStrengths);

    t.check('analysis succeeds', analysis.ok === true);
    t.check('credits the branded greeting', found.includes('greeting'));
    t.check('credits empathy', found.includes('empathy'));
    t.check('credits ownership', found.includes('ownership'));
    t.check('credits verification', found.includes('verification'));
    t.check('credits hold etiquette', found.includes('holdEtiquette'));
    t.check('caps the list so the email stays short', analysis.strengths.length <= 6);

    // The customer's own words are the best praise there is, so they lead.
    t.equal('customer reaction ranks first', analysis.strengths[0].key, 'customerReaction');
    t.check('the greeting is not what crowds out the recap', keys(analysis.strengths).includes('recap'));

    const draft = callTranscript.buildStrengthsDraft(analysis);
    t.check('draft is bulleted', draft.includes('\n- '));
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

// The real input: a pasted Verint Interaction Review email.
suite('call transcript: Verint export metadata', (t) => {
    const { callTranscript } = load(t);
    const meta = callTranscript.extractMetadata(VERINT_EXPORT);

    t.equal('reads the call date', meta.callDate, '2026-08-04');
    t.equal('reads the call time', meta.callTime, '12:38:26 PM');
    t.equal('reads the advisor as the dropdown spells it', meta.advisorDisplayName, 'Alyssa Dimes');
    t.equal('keeps the export spelling too', meta.advisorName, 'Dimes, Alyssa');
    t.equal('reads the call length', meta.durationLabel, '18:24');
    t.check('flags it as an export', meta.isVerintExport === true);
    t.check('reads the speech categories', meta.categories.length >= 10);
    t.check('strips the truncation ellipsis from a category name',
        meta.categories.some((c) => c.name === 'Advisor Positive Exp' && c.count === 2));

    t.equal('matches the advisor to a dropdown option',
        callTranscript.matchAssociateOption(['Bob Smith', 'Alyssa Dimes'], meta.advisorDisplayName), 'Alyssa Dimes');
    t.equal('does not invent a match',
        callTranscript.matchAssociateOption(['Bob Smith'], meta.advisorDisplayName), '');

    // A plain transcript has no header to read, and must not pretend otherwise.
    const plain = callTranscript.extractMetadata('Agent: Hello.\nCustomer: Hi.');
    t.equal('plain transcript reports no date', plain.callDate, '');
    t.check('plain transcript is not flagged as an export', plain.isVerintExport === false);
});

suite('call transcript: Verint export is stripped to the call', (t) => {
    const { callTranscript } = load(t);
    const body = callTranscript.stripBoilerplate(VERINT_EXPORT);

    t.check('drops the email header', !/Interaction Review/.test(body));
    t.check('drops the category legend', !/Categories:/.test(body));
    t.check('drops the blank QA form', !/Did advisor verify caller/.test(body));
    t.check('drops the kudos checklist', !/Kudos from Evaluator/.test(body));
    t.check('drops the legal footer', !/designated recipient/.test(body));
    t.check('drops the evaluator signature', !/Knight, Scott/.test(body));
    t.check('keeps the first thing said', /thank you for being a valued customer/.test(body));
    t.check('keeps the last thing said', /you too bye now/.test(body));

    // Stripping an already-clean transcript must not eat it.
    const clean = 'Agent: Hello there.\nCustomer: Hi.';
    t.equal('a plain transcript survives untouched', callTranscript.stripBoilerplate(clean), clean);
});

suite('call transcript: timestamped turns with no speaker labels', (t) => {
    const { callTranscript } = load(t);
    const parsed = callTranscript.parseTranscript(VERINT_EXPORT, { associateName: 'Alyssa Dimes' });

    t.check('reads every turn', parsed.turns.length > 100);
    t.check('records timestamps', parsed.timed === true);
    t.check('knows it had no speaker labels', parsed.labeled === false);
    t.check('cue-attributes the customer', /very helpful thank you/.test(parsed.customerText));
    t.check('does not credit the customer line to the advisor', !/very helpful thank you/.test(parsed.agentText));
    t.check('advisor process language stays on the advisor side', /thank you for being a valued customer/.test(parsed.agentText));

    // Talk share is meaningless without real labels, so it is not reported.
    const analysis = callTranscript.analyzeTranscript(VERINT_EXPORT, { associateName: 'Alyssa Dimes' });
    t.equal('no talk share is claimed', analysis.stats.agentTalkShare, null);
    t.check('and no airtime coaching is invented', !keys(analysis.allImprovements).includes('airtime'));
});

// Without speaker labels the customer's short replies used to be read as the
// advisor's, which starved every customer-side rule on exactly the calls that
// needed them.
suite('call transcript: attributing an unlabelled export', (t) => {
    const { callTranscript } = load(t);

    const rough = [
        'No visual indicators selected',
        '00:03', 'thank you for calling my name is sam',
        '00:08', 'this is ridiculous i have called three times',
        '00:14', 'let me pull up the account for you',
        '00:20', 'like i said before nobody fixed it',
        '00:30', 'i want to speak to a supervisor',
        '00:36', 'the charge posted on the fourth'
    ].join('\n');

    const parsed = callTranscript.parseTranscript(rough);
    t.check('frustration lands on the customer', /this is ridiculous/.test(parsed.customerText));
    t.check('repeating themselves lands on the customer', /like i said/.test(parsed.customerText));
    t.check('the escalation request lands on the customer', /speak to a supervisor/.test(parsed.customerText));
    t.check('advisor process language stays with the advisor', /let me pull up/.test(parsed.agentText));

    // An inferred guess counts towards the customer without being taken away
    // from the advisor, so a wrong guess cannot hide an advisor line.
    t.check('inferred turns still count as advisor speech', /the charge posted on the fourth/.test(parsed.agentText));

    const analysis = callTranscript.analyzeTranscript(rough);
    const flags = keys(analysis.allImprovements);
    t.check('so the repeat-yourself rule fires', flags.includes('repeatCustomer'));
    t.check('and the escalation rule fires', flags.includes('supervisorRequest'));
    t.equal('and empathy is escalated to the top',
        analysis.allImprovements.find((item) => item.key === 'empathy').weight, 12);

    // The good call must not be damaged by the same inference.
    const good = callTranscript.parseTranscript(VERINT_EXPORT, { associateName: 'Alyssa Dimes' });
    t.check('recovers far more of the customer side', good.customerWords > 200);
    t.check('advisor greeting still attributed correctly', /valued customer/.test(good.agentText));
    t.check('system lag still attributed to the advisor', /just loading/.test(good.agentText));
    t.check('the compliment is still the customer', /very helpful/.test(good.customerText));
});

suite('call transcript: silence measured from timestamps', (t) => {
    const { callTranscript } = load(t);
    const analysis = callTranscript.analyzeTranscript(VERINT_EXPORT, { associateName: 'Alyssa Dimes' });
    const found = keys(analysis.allImprovements);

    const hold = analysis.allImprovements.find((item) => item.key === 'longHold');
    t.check('flags the long hold', Boolean(hold));
    t.check('says how long it ran', /2m 21s/.test(hold.text));
    t.check('says when it started', /at 4:30/.test(hold.text));
    // Second person, like every other line here: it is her own action.
    // Named rather than pronouned: the message strips the "Long hold:" label
    // that was supplying the antecedent, so "you did announce it" arrived
    // referring to nothing.
    t.check('credits that she announced the hold', /You did announce the hold/.test(hold.text));

    const deadAir = analysis.allImprovements.find((item) => item.key === 'deadAirGap');
    t.check('flags the unannounced gap', Boolean(deadAir));
    t.check('says when it happened', /at 7:56/.test(deadAir.text));

    t.check('short pauses are not flagged', found.filter((k) => k === 'deadAirGap').length === 1);

    // The measured silence and the "one moment" filler count describe the same
    // event, so only the one carrying a number and a time survives.
    t.check('does not also report the vaguer filler bullet', !found.includes('stalling'));

    // With no timestamps there is nothing to measure, so the filler count is
    // the only signal available and must still be reported.
    const untimed = callTranscript.analyzeTranscript([
        'Agent: One moment please.',
        'Customer: Ok.',
        'Agent: Just a second, bear with me.',
        'Customer: Sure.',
        'Agent: Still checking, give me a moment.'
    ].join('\n'));
    t.check('filler count survives when silence cannot be measured',
        keys(untimed.allImprovements).includes('stalling'));
});

suite('call transcript: a good call reads as a good call', (t) => {
    const { callTranscript } = load(t);
    const analysis = callTranscript.analyzeTranscript(VERINT_EXPORT, { associateName: 'Alyssa Dimes' });
    const strengths = keys(analysis.allStrengths);

    t.check('credits the recap', strengths.includes('recap'));
    t.check('credits laying out every plan', strengths.includes('optionsOffered'));
    t.check('credits the recommendation, not just the recital', strengths.includes('recommendation'));
    t.check('credits the hold being announced', strengths.includes('holdEtiquette'));
    t.check('credits the customer thanking them', strengths.includes('customerReaction'));
    t.check('credits the Verint positive experience category', strengths.includes('positiveExperience'));

    t.check('no heavy coaching points on a call this clean', analysis.stats.heavyIssues === 0);
    t.check('leads with praise', /Outstanding call/.test(analysis.headline));
    t.check('praise names the call length', /18:24/.test(analysis.headline));

    const draft = callTranscript.buildStrengthsDraft(analysis);
    t.check('the headline opens the draft', draft.startsWith('Outstanding call'));
    t.check('bullets follow the headline', draft.includes('\n- '));
    t.check('praise avoids em dashes', !draft.includes('—'));

    // A weak call must not get the same headline.
    const weak = callTranscript.analyzeTranscript('Agent: Yeah what.\nCustomer: My bill is wrong again.');
    t.equal('no headline when it is not earned', weak.headline, '');
});

suite('call transcript: empathy is only coached when it was needed', (t) => {
    const { callTranscript } = load(t);

    // Routine setup call, nothing went wrong: silence on empathy is correct.
    const routine = callTranscript.analyzeTranscript(VERINT_EXPORT, { associateName: 'Alyssa Dimes' });
    t.check('no empathy gap on a routine call', !keys(routine.allImprovements).includes('empathy'));

    // Something went wrong, even politely: now it counts.
    const trouble = callTranscript.analyzeTranscript([
        'Agent: What is the account number?',
        'Customer: I was charged twice this month and my bill doubled.',
        'Agent: The charge posted on the 4th.'
    ].join('\n'));
    t.check('empathy gap on a problem call', keys(trouble.allImprovements).includes('empathy'));

    // A self-correction is not empathy.
    const selfCorrection = callTranscript.analyzeTranscript([
        'Agent: The number is six zero one, i\'m sorry, six zero two.',
        'Customer: Got it.'
    ].join('\n'));
    t.check('bare "I\'m sorry" mid-sentence is not credited as empathy',
        !keys(selfCorrection.allStrengths).includes('empathy'));

    const genuine = callTranscript.analyzeTranscript([
        'Agent: I am so sorry about the wait you have had.',
        'Customer: Thanks.'
    ].join('\n'));
    t.check('a real apology is credited', keys(genuine.allStrengths).includes('empathy'));
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

    // A Verint paste carries facts the prompt should state outright.
    const fromExport = callListening.buildPrompt({
        employeeName: 'Alyssa Dimes',
        listenedOn: '2026-08-04',
        transcript: VERINT_EXPORT,
        whatWentWell: '- Strong recap',
        improvementAreas: '- Long hold'
    }, 'Alyssa');

    t.check('prompt states the call length', /Call length: 18:24/.test(fromExport));
    t.check('prompt states the call time', /Call time: 12:38:26 PM/.test(fromExport));
    t.check('prompt passes the speech categories as context', /Verint speech categories detected: .*Verification/.test(fromExport));
    t.check('prompt carries the spoken transcript', /thank you for being a valued customer/.test(fromExport));
    t.check('prompt drops the QA form', !/Did advisor verify caller/.test(fromExport));
    t.check('prompt drops the legal footer', !/designated recipient/.test(fromExport));
    t.check('prompt asks for genuine praise, not just a nod', /genuine, specific recognition/.test(fromExport));
    t.check('prompt tells Copilot to match the tone to the call', /well earned pat on the back/.test(fromExport));
});

suite('call transcript: what gets stored', (t) => {
    const { callTranscript } = load(t);
    const stored = callTranscript.prepareForStorage(VERINT_EXPORT);

    // The header now also carries Verint's speech categories, because one
    // strength rule reads them and the block they arrive in is stripped as
    // boilerplate. Checked by parts so adding a fact does not break this.
    t.check('keeps a one line header of the facts',
        stored.startsWith('[Call 2026-08-04 • 12:38:26 PM • Alyssa Dimes • length 18:24'));
    t.check('the header closes on its own line', /^\[[^\]]*\]/.test(stored));
    t.check('and carries the speech categories', /• cats:[^\]]*Advisor Positive Exp=2/.test(stored));
    t.check('stores what was said', /thank you for being a valued customer/.test(stored));
    t.check('does not store the QA form', !/Did advisor verify caller/.test(stored));
    t.check('does not store the legal footer', !/designated recipient/.test(stored));
    t.check('comes in under the storage cap', stored.length <= callTranscript.MAX_STORED_TRANSCRIPT_CHARS + 40);
    t.check('is smaller than the raw paste', stored.length < VERINT_EXPORT.length);
});
