'use strict';

const fs = require('fs');
const path = require('path');
const { suite } = require('./harness');

/**
 * DID THE EXPLANATION LAND
 *
 * A customer rings about budget billing, the associate explains it, and the
 * customer says "wait, so I still have to pay the whole thing?". This read
 * finds that moment, looks at how it was explained just before, and offers
 * ways to say it that land.
 *
 * The rule these tests hold hardest: the associate is only coached on strong
 * evidence. A customer lost twice, or lost after our own vocabulary or a long
 * unbroken stretch, and never saying it landed. One "what do you mean" that
 * the next line cleared up is a conversation, not a coaching point.
 */

const VERINT_EXPORT = fs.readFileSync(path.join(__dirname, 'fixtures', 'verint-export.txt'), 'utf8');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-verification.module.js');
    t.loadModule('modules/call-explanation.module.js');
    t.loadModule('modules/call-red-flags.module.js');
    return global.window.DevCoachModules;
}

// Verint's shape with the colour-coded labels the paste handler writes.
function verint(pairs) {
    return pairs.map(([at, line]) => `${at}\n${line}`).join('\n');
}

const BUDGET_LOST_TWICE = verint([
    ['00:03', 'Agent: thank you for calling aps my name is jamie how can i help you today'],
    ['00:09', 'Customer: hi i signed up for budget billing and my bill still changed this month'],
    ['00:20', 'Agent: okay so with budget billing the amount is levelized based on your twelve month history and then there is a true up where the deferred balance gets reconciled against your actual usage'],
    ['00:41', 'Customer: wait so i still have to pay the whole thing'],
    ['00:45', 'Agent: so the levelized amount gets recalculated and the deferred balance is reconciled so the true up happens'],
    ['00:58', 'Customer: i don\'t understand what that means'],
    ['01:05', 'Agent: okay is there anything else i can help you with'],
    ['01:09', 'Customer: no that\'s it']
]);

const BUDGET_LANDED = verint([
    ['00:03', 'Agent: thank you for calling aps my name is jamie how can i help you today'],
    ['00:09', 'Customer: i want to know about budget billing'],
    ['00:14', 'Agent: budget billing averages your bill based on your usage history over the last year'],
    ['00:24', 'Customer: i\'m confused what does that mean'],
    ['00:28', 'Agent: let\'s say your summer bills are three hundred and your winter bills are one hundred so instead of jumping around you pay about the same amount every month all year'],
    ['00:44', 'Customer: oh okay that makes sense'],
    ['00:47', 'Agent: great is there anything else']
]);

const ONE_QUICK_QUESTION = verint([
    ['00:03', 'Agent: thank you for calling aps my name is jamie'],
    ['00:08', 'Customer: my deposit was on my bill'],
    ['00:12', 'Agent: yes the deposit is on your first bill'],
    ['00:16', 'Customer: what do you mean'],
    ['00:18', 'Agent: it was added to the first bill you got'],
    ['00:22', 'Customer: okay']
]);

const NEVER_LOST = verint([
    ['00:03', 'Agent: thank you for calling aps my name is jamie how can i help'],
    ['00:08', 'Customer: can you tell me about budget billing'],
    ['00:12', 'Agent: budget billing spreads the year out so you pay about the same every month'],
    ['00:20', 'Customer: great sign me up'],
    ['00:24', 'Agent: all done is there anything else']
]);

suite('call explanation: finds where the customer got lost', (t) => {
    const { callExplanation: X } = load(t);

    const read = X.readExplanationsFromText(BUDGET_LOST_TWICE);
    t.check('it reads', read.ok);
    t.equal('one moment, not two', read.moments.length, 1);

    const moment = read.moments[0];
    t.equal('it is about budget billing', moment.topicKey, 'budgetBilling');
    t.equal('the customer was lost twice', moment.tries, 2);
    t.equal('at the first time they said so', moment.time, '0:41');
    t.check('it quotes the customer', /still have to pay the whole thing/.test(moment.customerQuote));
    t.check('it quotes how it was explained', /levelized/.test(moment.beforeQuote));
    t.check('our words are named', moment.jargon.includes('true up') && moment.jargon.includes('levelized'));
    t.check('the second try was the same words again', moment.sameWords);
    t.check('it never landed', !moment.landed);
    t.equal('it is worth coaching', read.coachable.length, 1);
});

suite('call explanation: the coaching line', (t) => {
    const { callExplanation: X } = load(t);

    const coaching = X.coachingFor(X.readExplanationsFromText(BUDGET_LOST_TWICE));
    t.check('there is one', Boolean(coaching));
    t.equal('under its own key', coaching.key, 'explanation');
    t.equal('weighted up for being lost twice', coaching.weight, 9);
    t.check('it names the topic and the time', /budget billing at 0:41/.test(coaching.text));
    t.check('it names our words', /"true up"|"levelized"/.test(coaching.text));
    t.check('it says not to repeat it the same way', /same way/.test(coaching.text));
    t.check('it gives a line to try, in quotes', /Try it in their terms: "Budget billing doesn't change/.test(coaching.text));
    t.check('and a check in the customer\'s terms', /ask what they would pay in August/.test(coaching.text));
    t.check('the quote is the customer, not the associate', /still have to pay/.test(coaching.quote));
    t.check('no em dashes', !/[—–]/.test(coaching.text));
    t.check('no placeholder reaches the associate', !/\[/.test(coaching.text));
});

suite('call explanation: a second try that landed is praised, not coached', (t) => {
    const { callExplanation: X } = load(t);

    const read = X.readExplanationsFromText(BUDGET_LANDED);
    t.equal('one moment', read.moments.length, 1);
    t.check('it landed', read.moments[0].landed);
    t.check('with an example', read.moments[0].usedExample);
    t.equal('nothing to coach', X.coachingFor(read), null);

    const praise = X.praiseFor(read);
    t.check('it is praised', Boolean(praise));
    t.check('for reaching for an example', /reached for an example/.test(praise.text));
    t.check('quoting the customer getting it', /makes sense/.test(praise.quote));
});

suite('call explanation: one quick question is a conversation, not coaching', (t) => {
    const { callExplanation: X } = load(t);

    const read = X.readExplanationsFromText(ONE_QUICK_QUESTION);
    t.equal('the moment is still shown to the supervisor', read.moments.length, 1);
    t.equal('but nothing reaches the associate', X.coachingFor(read), null);
    t.check('and the panel still renders it', /The customer got lost on the (?:deposit|first bill)/.test(X.buildPanelHtml(read)));
});

suite('call explanation: a call where nobody got lost', (t) => {
    const { callExplanation: X } = load(t);

    const read = X.readExplanationsFromText(NEVER_LOST);
    t.equal('no moments', read.moments.length, 0);
    t.check('it says what was explained', read.explained.includes('budget billing'));
    const html = X.buildPanelHtml(read);
    t.check('one quiet line', /never sounded lost/.test(html) && /budget billing/.test(html));
    t.equal('nothing coached', X.coachingFor(read), null);
    t.equal('nothing praised', X.praiseFor(read), null);
});

suite('call explanation: what counts as lost', (t) => {
    const { callExplanation: X } = load(t);

    [
        'i don\'t understand',
        'i\'m so confused',
        'what does that mean',
        'wait so i still owe that',
        'that doesn\'t make sense',
        'can you explain that again',
        'but why is it still so high',
        'i thought it was supposed to stay the same'
    ].forEach(line => t.check(`lost: "${line}"`, X.isConfused(line)));

    // On a phone line these are about hearing, and a customer asking to be
    // told is not one who was told and did not follow.
    [
        'can you say that again',
        'sorry can you repeat that',
        'how does that work',
        'i understand',
        'okay that makes sense',
        'one more time'
    ].forEach(line => t.check(`not lost: "${line}"`, !X.isConfused(line)));

    t.check('"I don\'t understand" never reads as landed', !X.isLanded('i don\'t understand'));
    t.check('"oh okay that makes sense" does', X.isLanded('oh okay that makes sense'));
    t.check('"got it" does', X.isLanded('got it thank you'));
});

suite('call explanation: the associate saying it is not the customer being lost', (t) => {
    const { callExplanation: X } = load(t);

    const read = X.readExplanationsFromText(verint([
        ['00:03', 'Agent: thank you for calling aps my name is jamie'],
        ['00:08', 'Customer: my bill doubled this month'],
        ['00:12', 'Agent: i don\'t understand why that happened either let me look'],
        ['00:20', 'Customer: okay thanks']
    ]));
    t.equal('no moment', read.moments.length, 0);
});

suite('call explanation: the reason for the call is not a reaction to an explanation', (t) => {
    const { callExplanation: X } = load(t);

    // Caught on the first run of the sweep: the opening line was read as the
    // customer getting lost, before the associate had said anything but hello.
    const read = X.readExplanationsFromText(verint([
        ['00:03', 'Agent: thank you for calling aps my name is jamie how can i help'],
        ['00:09', 'Customer: my budget billing amount changed and i don\'t get why'],
        ['00:15', 'Agent: let me pull that up for you one moment'],
        ['00:30', 'Customer: okay'],
        ['00:34', 'Agent: so budget billing takes your whole year and spreads it out so every month is about the same'],
        ['00:44', 'Customer: oh okay that makes sense']
    ]));
    t.equal('no moment from the opening line', read.moments.length, 0);

    // Caught driving the page: "so what is your question" invites the
    // reason for the call, and the reason was read as the customer lost.
    const afterVerifying = X.readExplanationsFromText(verint([
        ['00:03', 'Agent: thank you for calling aps my name is jamie'],
        ['00:14', 'Agent: okay can i have the last four of the social on the account for verification'],
        ['00:19', 'Customer: yes it is four four one two'],
        ['00:24', 'Agent: thank you for verifying so what is your question'],
        ['00:28', 'Customer: my budget billing amount changed and i thought it was supposed to stay the same'],
        ['00:36', 'Agent: budget billing is levelized with a true up against the deferred balance every so often'],
        ['00:58', 'Customer: wait so i still have to pay the whole thing']
    ]));
    t.equal('one moment, from the reaction not the question', afterVerifying.moments.length, 1);
    t.equal('at the reaction', afterVerifying.moments[0].time, '0:58');
    t.check('quoting the explanation it reacted to', /levelized/.test(afterVerifying.moments[0].beforeQuote));

    // The same words after something was explained are a moment.
    const later = X.readExplanationsFromText(verint([
        ['00:03', 'Agent: thank you for calling aps my name is jamie how can i help'],
        ['00:09', 'Customer: my budget billing amount changed'],
        ['00:15', 'Agent: the levelized amount had a true up against the deferred balance'],
        ['00:30', 'Customer: i don\'t get why']
    ]));
    t.equal('but the same words after an explanation are', later.moments.length, 1);
    t.equal('timed at the reaction', later.moments[0].time, '0:30');
});

suite('call explanation: a term explained in the same breath is not jargon', (t) => {
    const { callExplanation: X } = load(t);

    t.equal('explained on the spot', X.unexplainedJargon('on peak which means four to seven on weekdays').length, 0);
    t.equal('explained as a range', X.unexplainedJargon('the on peak hours from four to seven').length, 0);
    t.check('left hanging', X.unexplainedJargon('your on peak usage drove the demand charge').includes('on peak'));
    t.check('and the demand charge too', X.unexplainedJargon('your on peak usage drove the demand charge').includes('demand charge'));
});

suite('call explanation: the Copilot prompt asks for wording only', (t) => {
    const { callExplanation: X } = load(t);

    const read = X.readExplanationsFromText(BUDGET_LOST_TWICE.replace('twelve month history', 'account four six four five one two'));
    const prompt = X.buildCopilotPrompt(read.moments[0]);

    t.check('it says the review is done', /already reviewed this call/.test(prompt));
    t.check('it asks for wording, not an assessment', /only want help with wording/.test(prompt) && /Do not name, rate or assess/.test(prompt));
    t.check('it names the topic', /budget billing/.test(prompt));
    t.check('it carries the excerpt with sides', /Agent: .*levelized/.test(prompt) && /Customer: wait so/.test(prompt));
    t.check('numbers read out are masked', !/four six four five/.test(prompt) && /\[number\]/.test(prompt));
    t.check('it asks for placeholders rather than invented amounts', /placeholder in square brackets/.test(prompt));
    t.check('no em dashes in the prompt', !/[—–]/.test(prompt));
    t.equal('nothing to send without a moment', X.buildCopilotPrompt(null), '');
});

suite('call explanation: the analyzer carries it into the drafts', (t) => {
    const { callTranscript: T } = load(t);

    const analysis = T.analyzeTranscript(BUDGET_LOST_TWICE, { associateName: 'Jamie' });
    t.check('the read rides on the analysis', analysis.explanation?.ok);
    t.check('the coaching is in the improvements', analysis.allImprovements.some(item => item.key === 'explanation'));
    t.check('and in the draft', /got lost on budget billing/.test(T.buildImprovementsDraft(analysis)));

    const landed = T.analyzeTranscript(BUDGET_LANDED, { associateName: 'Jamie' });
    t.check('the praise is in the strengths', landed.allStrengths.some(item => item.key === 'explanationLanded'));
});

suite('call explanation: the real Verint export reads without inventing a moment', (t) => {
    const { callExplanation: X } = load(t);

    const read = X.readExplanationsFromText(VERINT_EXPORT);
    t.check('it reads', read.ok);
    t.equal('nothing coached on a call where nobody said they were lost', X.coachingFor(read), null);
});

suite('call explanation: every playbook line follows the house rules', (t) => {
    const { callExplanation: X } = load(t);

    const all = [X.GENERAL].concat(X.PLAYBOOKS);
    const lines = [];
    all.forEach(book => {
        (book.say || []).forEach(line => lines.push(line));
        (book.how || []).forEach(line => lines.push(line));
        lines.push(book.check);
    });

    t.check('there are lines to check', lines.length > 40);
    t.equal('no em dashes', lines.filter(line => /[—–]/.test(line)).length, 0);
    // The utility floor: nothing a rep here does not have.
    t.equal('no follow-up emails, texts, CRM or knowledge base',
        lines.filter(line => /\bemail\b|\btext (?:you|them)\b|\bCRM\b|knowledge base/i.test(line)).length, 0);
    t.equal('no exceptions promised', lines.filter(line => /\bexception\b|\bwaive\b/i.test(line)).length, 0);
    t.check('every topic has a check in the customer\'s terms', all.every(book => book.check && !/does that make sense/i.test(book.check)));
    t.check('every topic has a way to try it', all.every(book => (book.say || []).length || (book.how || []).length));
});
