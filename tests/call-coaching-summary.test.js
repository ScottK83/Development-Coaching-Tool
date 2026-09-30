'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * "THANK YOU FOR CALLING AT&T"
 *
 * Verint's speech to text does not know the company's name. Scott had Copilot
 * write feedback on the first real call and it quoted the greeting as "thank
 * you for calling at&t", because the transcript always says that and the
 * prompt called the transcript verbatim. The sample export does the same thing
 * in another shape: "your a t s account number".
 *
 * And the page it came from had too much on it. What Scott wants is paste,
 * good and bad, a Copilot button that writes the summary, and a summary for
 * Verint. The second half of this file is that Copilot button's prompt.
 */

const VERINT_EXPORT = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'verint-export.txt'), 'utf8');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-verification.module.js');
    t.loadModule('modules/call-explanation.module.js');
    t.loadModule('modules/call-red-flags.module.js');
    t.loadModule('modules/call-summary.module.js');
    t.loadModule('modules/call-listening.module.js');
    return global.window.DevCoachModules;
}

const ATT_CALL = [
    '00:03', 'Agent: thank you for calling at&t my name is jamie how can i help you today',
    '00:09', 'Customer: hi i need to know my balance',
    '00:14', 'Agent: sure for verification can i have the last four of the social',
    '00:19', 'Customer: it is four four one two',
    '00:24', 'Agent: thank you your balance is two hundred dollars due on the fifth and you can see it on a t s dot com',
    '00:40', 'Customer: great thank you so much'
].join('\n');

suite('mishearing: what Verint writes for APS', (t) => {
    const { callTranscript: T } = load(t);
    const fix = T.correctMishearings;

    [
        ['thank you for calling at&t my name is jamie', 'thank you for calling APS my name is jamie'],
        ['thank you for calling at and t', 'thank you for calling APS'],
        ['thank you for calling a t and t', 'thank you for calling APS'],
        ['thank you for calling a t & t how can i help', 'thank you for calling APS how can i help'],
        ['Thank you for calling AT&T.', 'Thank you for calling APS.'],
        ['can i have your a t s account number', 'can i have your APS account number'],
        ['three energy plans available at a t s change your plan', 'three energy plans available at APS change your plan'],
        ['go to a p s dot com', 'go to APS dot com']
    ].forEach(([heard, meant]) => t.equal(`"${heard}"`, fix(heard), meant));
});

suite('mishearing: what it leaves alone', (t) => {
    const { callTranscript: T } = load(t);
    const fix = T.correctMishearings;

    // Letters in a row are how names get spelled out on these calls.
    ['w a t s o n', 'm a t t h e w', 'k a t s'].forEach((spelled) => t.equal(`a spelled name: "${spelled}"`, fix(spelled), spelled));

    // AT&T is a phone company customers really do mention.
    ['my at&t phone bill came today', 'at&t wireless', 'at&t\'s internet is down'].forEach((line) => t.equal(`the phone company: "${line}"`, fix(line), line));

    ['that and then i said', 'look at and to be honest', 'apps on your phone'].forEach((line) => t.equal(`ordinary words: "${line}"`, fix(line), line));
    t.equal('running it twice changes nothing more', fix(fix('thank you for calling at&t')), 'thank you for calling APS');
});

suite('mishearing: corrected everywhere the call is read', (t) => {
    const { callTranscript: T } = load(t);

    const analysis = T.analyzeTranscript(ATT_CALL, { associateName: 'Jamie' });
    const greeting = analysis.allStrengths.find((item) => item.key === 'greeting');
    t.check('the greeting is praised', Boolean(greeting));
    t.check('quoting APS', /calling APS/.test(greeting.quote));
    t.check('never at&t', !/at&t/i.test(T.buildStrengthsDraft(analysis)));

    t.check('the turns are corrected', T.parseTranscript(ATT_CALL).turns.every((turn) => !/at&t|a t s/i.test(turn.text)));
    t.check('the Copilot transcript is corrected', /calling APS/.test(T.prepareForPrompt(ATT_CALL)) && !/at&t/i.test(T.prepareForPrompt(ATT_CALL)));
    t.check('the saved transcript is corrected', /calling APS/.test(T.prepareForStorage(ATT_CALL)) && !/at&t/i.test(T.prepareForStorage(ATT_CALL)));
    t.check('the summary prompt is corrected', !/at&t/i.test(T.buildCallSummaryPrompt(ATT_CALL)));

    // The sample export's own mishearing.
    const turns = T.parseTranscript(VERINT_EXPORT).turns.map((turn) => turn.text).join(' ');
    t.check('the sample export\'s "a t s account number" reads as APS', /APS account number/.test(turns) && !/\ba t s\b/.test(turns));
});

suite('coaching summary prompt: what Copilot is asked for', (t) => {
    const { callListening: L, callTranscript: T } = load(t);

    const entry = {
        employeeName: 'Jamie Rivera',
        listenedOn: '2026-09-29',
        callTime: '10:14 AM',
        transcript: T.prepareForStorage(ATT_CALL),
        whatWentWell: '- Clean open. You named APS and gave your own name straight away. ("thank you for calling at&t my name is jamie")',
        improvementAreas: '- Tell the customer exactly what happens next and by when.'
    };
    const prompt = L.buildCoachingSummaryPrompt(entry);

    t.check('there is a prompt', prompt.length > 400);
    t.check('it says the review is done', /the review is done/.test(prompt));
    t.check('and asks for wording only', /I need the wording/.test(prompt) && /not asking you to assess anybody/.test(prompt));
    t.check('shaped for Verint', /paste into our coaching log in Verint/.test(prompt) && /Plain text only, ready to paste into Verint/.test(prompt));
    t.check('good and bad kept apart', /"What went well:"/.test(prompt) && /"What to work on:"/.test(prompt));
    t.check('it carries both note boxes', /Clean open/.test(prompt) && /what happens next/.test(prompt));
    t.check('it names the call', /Tuesday, September 29 at 10:14 AM/.test(prompt));

    // The complaint itself.
    t.check('no at&t anywhere, notes included', !/at&t/i.test(prompt));
    t.check('and it is told the company is APS', /Our company is APS/.test(prompt));

    t.check('the associate is not named', !/Jamie Rivera/.test(prompt) && !/\bRivera\b/.test(prompt));
    t.check('the customer\'s numbers are masked', !/four four one two/.test(prompt) && /\[number\]/.test(prompt));
    // Caught driving the page: masked as one block, "[number]" swallowed the
    // line break and the next timestamp landed on the customer's line.
    t.check('every timestamp keeps its own line', /\[number\]\n00:24\n/.test(prompt));
    t.check('and none is eaten', ['00:03', '00:09', '00:14', '00:19', '00:24', '00:40'].every((stamp) => prompt.includes(`\n${stamp}\n`)));
    t.check('no em dashes', !/[—–]/.test(prompt));
    t.equal('nothing without an entry', L.buildCoachingSummaryPrompt(null), '');
});

suite('coaching summary prompt: where the customer got lost, Copilot finds a better way', (t) => {
    const { callListening: L, callTranscript: T } = load(t);

    const lost = [
        '00:03', 'Agent: thank you for calling at&t my name is jamie how can i help',
        '00:09', 'Customer: my budget billing amount changed',
        '00:15', 'Agent: the levelized amount had a true up against the deferred balance',
        '00:30', 'Customer: wait so i still have to pay the whole thing',
        '00:34', 'Agent: the levelized amount had a true up against the deferred balance so it changed',
        '00:44', 'Customer: i\'m still confused'
    ].join('\n');

    const prompt = L.buildCoachingSummaryPrompt({
        employeeName: 'Jamie Rivera',
        listenedOn: '2026-09-29',
        transcript: T.prepareForStorage(lost),
        whatWentWell: '- Clean open.',
        improvementAreas: '- The customer got lost on budget billing.'
    });

    t.check('the moment goes over', /Where the customer got lost: budget billing at 0:30/.test(prompt));
    t.check('with what was said and what the customer said back', /levelized/.test(prompt) && /still have to pay the whole thing/.test(prompt));
    t.check('asking for one plainer way to say it', /one plainer way to explain budget billing/.test(prompt));
    t.check('without inventing amounts or policy', /placeholder in square brackets/.test(prompt) && /do not state APS policy/.test(prompt));
});

suite('email prompt: Copilot turns the pasted summary into the email', (t) => {
    const { callListening: L } = load(t);

    const summary = [
        'A 2 minute call about budget billing that ended with the customer still unsure.',
        '',
        'What went well:',
        '- You verified the caller before anything on the account came up.',
        '',
        'What to work on:',
        '- When the customer got lost on budget billing, try: "It spreads your year out so every month is about the same."'
    ].join('\n');

    const prompt = L.buildEmailFromSummaryPrompt({
        employeeName: 'Alyssa Dimes',
        listenedOn: '2026-09-29',
        callTime: '10:14 AM',
        transcript: 'Agent: thank you for calling at&t my name is alyssa',
        copilotSummary: summary,
        whatWentWell: '- a note that should not be used when there is a summary',
        improvementAreas: ''
    }, 'Alyssa');

    t.check('it says the review is done and asks for wording', /already reviewed/.test(prompt) && /I need the wording/.test(prompt));
    t.check('addressed to the associate by first name', /short email to Alyssa that I can send/.test(prompt));
    t.check('built from the summary', /My coaching write-up:\n"""\nA 2 minute call about budget billing/.test(prompt));
    t.check('not the notes, when there is a summary', !/a note that should not be used/.test(prompt));
    t.check('the transcript does not go over again', !/my name is alyssa/.test(prompt));
    t.check('it names the call', /Tuesday, September 29 at 10:14 AM/.test(prompt));
    t.check('good first, then the work', /Say what went well, specifically/.test(prompt) && /Then what to do better/.test(prompt));
    t.check('with the words or steps to use for each point', /give the words or the steps to use/.test(prompt));
    // "Want more so in the form of what can do better. Tips. Tricks. Etc."
    t.check('and a list of tips and tricks', /"A few things to try:" with three to five practical tips or tricks/.test(prompt));
    t.check('nothing added', /Do not add findings of your own/.test(prompt));
    t.check('just the body back', /Return only the email body/.test(prompt));
    t.check('no em dashes asked for or used', /Do not use em dashes/.test(prompt) && !/[—–]/.test(prompt));
});

suite('email prompt: with no summary pasted, the notes stand in', (t) => {
    const { callListening: L } = load(t);

    const prompt = L.buildEmailFromSummaryPrompt({
        employeeName: 'Alyssa Dimes',
        listenedOn: '2026-09-29',
        copilotSummary: '',
        whatWentWell: '- Clean open. ("thank you for calling at&t my name is alyssa")',
        improvementAreas: '- Tell the customer what happens next.'
    }, 'Alyssa');

    t.check('the good notes go over', /What went well:\n- Clean open/.test(prompt));
    t.check('and the work', /What to work on:\n- Tell the customer what happens next/.test(prompt));
    t.check('with Verint\'s "at&t" corrected on the way', /calling APS/.test(prompt) && !/at&t/i.test(prompt));
    t.equal('nothing without an entry', L.buildEmailFromSummaryPrompt(null, 'Alyssa'), '');

    const summaryWithMishearing = L.buildEmailFromSummaryPrompt({ copilotSummary: 'You greeted with "thank you for calling at&t".' }, 'Alyssa');
    t.check('a pasted summary is corrected too', /calling APS/.test(summaryWithMishearing) && !/at&t/i.test(summaryWithMishearing));
});
