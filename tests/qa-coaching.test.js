'use strict';

/**
 * QA COACHING (People > Follow Up > QA Coaching)
 *
 * Scott, 2026-10-27: paste the Verint coaching session QA sent, or type the
 * associate, reason and notes, and get the email, a Copilot prompt and the
 * Verint Meeting Summary. He wants to know whether they read it, so each
 * coaching is kept as Sent until he marks it Read. The QA score never goes in
 * the email ("No, don't show the score").
 *
 * The sessions are made up (tests/fixtures/qa-coaching-sessions.txt). Real
 * coaching sessions are never committed.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const PASTE = fs.readFileSync(path.join(ROOT, 'tests/fixtures/qa-coaching-sessions.txt'), 'utf8');

function load(t) {
    t.installFakeBrowser();
    let saved = { entries: [] };
    t.loadModule('modules/message-voice.module.js');
    const qa = t.loadModule('modules/qa-coaching.module.js').qaCoaching;
    global.window.DevCoachModules.storage = {
        loadFollowUpHistory: () => JSON.parse(JSON.stringify(saved)),
        saveFollowUpHistory: (data) => { saved = JSON.parse(JSON.stringify(data)); }
    };
    return { qa, history: () => saved };
}

function stepsFor(qa, key) {
    return qa.REASONS.find(reason => reason.key === key).steps;
}

suite('QA coaching: a pasted Verint page reads itself', async (t) => {
    const { qa } = load(t);
    const sessions = qa.parseSessions(PASTE);

    t.equal('two sessions in the paste, the intro line skipped', sessions.length, 2);
    const [first, second] = sessions;
    t.equal('session id', first.sessionId, '10001');
    t.equal('the name flipped to how the pickers hold it', first.associateName, 'Jamie Doe');
    t.equal('the due date', first.dueDate, '2026-10-09');
    t.equal('the evaluation date, not the session clock', first.evalDate, '2026-10-05');
    t.equal('the form', first.formName, 'APS Process Accuracy Evaluation');
    t.equal('the category', first.category, 'Process Accuracy');
    t.equal('a wrong plan reads as the wrong plan', first.reasonKey, 'rate-plan-wrong');
    t.check('the category prefix is off the note', /^Incorrect rate plan/.test(first.qaNote));
    t.check('"w/" is spelled out', /go with TOU plan/.test(first.qaNote));
    t.check('no score anywhere in what was read', !JSON.stringify(sessions).includes('60.00'));

    t.equal('a missed fix on a payment arrangement', second.reasonKey, 'fcr-payment-arrangement');
    t.equal('second associate', second.associateName, 'Sam Rivera');
    t.check('its dashes are commas', /opportunity for FCR, customer stated/.test(second.qaNote) && !/ - /.test(second.qaNote));
    t.equal('its due date', second.dueDate, '2026-10-30');
});

suite('QA coaching: plain notes and reasons', async (t) => {
    const { qa } = load(t);
    t.equal('text that is not a Verint page is no session', qa.parseSessions('Rate plan was not discussed with the customer.').length, 0);
    t.equal('a sentence with a dash keeps its start',
        qa.cleanQaNote('There was an opportunity for FCR - customer could not pay'),
        'There was an opportunity for FCR, customer could not pay');
    t.equal('rate plan not discussed', qa.classifyReason('Rate plans were not discussed with a new customer'), 'rate-plan-review');
    t.equal('wrong plan', qa.classifyReason('Incorrect rate plan was selected'), 'rate-plan-wrong');
    t.equal('FCR alone', qa.classifyReason('Missed an FCR opportunity on the move'), 'fcr');
    t.equal('anything else', qa.classifyReason('Did not verify the caller'), 'other');
    t.equal('Verint names flip', qa.toDisplayName('Rivera, Sam'), 'Sam Rivera');
    t.equal('and match the picker either way', qa.matchAssociate(['Jamie Doe', 'Sam Rivera'], 'Rivera, Sam'), 'Sam Rivera');
});

suite('QA coaching: the email is praise first, no score, and asks for a reply', async (t) => {
    const { qa } = load(t);
    const session = qa.parseSessions(PASTE)[0];
    const email = qa.buildEmail(Object.assign({}, session, { steps: stepsFor(qa, session.reasonKey) }));
    const lines = email.body.split('\n');

    t.equal('greets by first name', lines[0], 'Hey Jamie,');
    t.equal('praise comes first', lines[2], 'Thank you for the care you put into your calls.');
    t.check('then says which review', lines[4].startsWith('QA reviewed one of your calls on Oct 5'));
    t.check('carries what QA noticed', email.body.includes('What QA noticed:\nIncorrect rate plan was selected'));
    t.check('and the steps as bullets', email.body.includes('For next time:\n- Before you submit a start service order'));
    t.check('asks them to reply once read', email.body.includes('reply with a quick "Got it"'));
    t.check('no score', !/score|60|80/i.test(email.body));
    t.check('no em or en dashes', !/[–—]/.test(email.body + email.subject));
    t.equal('subject', email.subject, 'QA feedback: Confirming the rate plan');

    const own = qa.buildEmail({ associateName: 'Jamie Doe', greetingName: 'Jay', reasonKey: 'other', qaNote: 'Missed the recap', praise: 'Your greeting was warm and quick' });
    t.check('a preferred name wins', own.body.startsWith('Hey Jay,'));
    t.check('Scott\'s own praise replaces the default', own.body.includes('Your greeting was warm and quick.') && !own.body.includes('Thank you for the care'));
    t.check('no steps, no "For next time"', !own.body.includes('For next time'));
});

suite('QA coaching: the Copilot prompt hands over the praise and the rules', async (t) => {
    const { qa } = load(t);
    const session = qa.parseSessions(PASTE)[1];
    const prompt = qa.buildCopilotPrompt(Object.assign({}, session, { steps: stepsFor(qa, session.reasonKey), praise: 'You stayed calm with a frustrated customer' }));
    t.check('names the associate', prompt.includes('to Sam Rivera about a QA review'));
    t.check('carries the praise itself', prompt.includes('You stayed calm with a frustrated customer.'));
    t.check('keeps the score out', prompt.includes('Do not include the QA score.') && !prompt.includes('80'));
    t.check('asks for the reply', prompt.includes('"Got it"'));
});

suite('QA coaching: Copy For Verint says what was coached and when it was read', async (t) => {
    t.pinClock('2026-10-27');
    const { qa } = load(t);
    const session = qa.parseSessions(PASTE)[0];
    const input = Object.assign({}, session, { steps: stepsFor(qa, session.reasonKey) });

    const before = qa.buildVerintSummary(input, null);
    t.check('headed with the associate', before.startsWith('QA coaching: Jamie Doe'));
    t.check('names the session and form', before.includes('Session 10001, APS Process Accuracy Evaluation from Oct 5'));
    t.check('the opportunity', before.includes('Opportunity: Incorrect rate plan'));
    t.check('what was coached', before.includes('Coached on:\n- Before you submit'));
    t.check('never says it was emailed when it was not', !before.includes('by email'));

    const record = qa.recordQaCoaching(input, 'email');
    const sent = qa.buildVerintSummary(input, record);
    t.check('says when it was emailed', sent.includes('Sent to Jamie by email on Oct 27, with a request to reply once read.'));

    const read = qa.setRead(record.id, true);
    t.check('and when it was read', qa.buildVerintSummary(input, read).includes('Read: confirmed on Oct 27.'));
});

// Scott, 2026-11-16: three Priority Coachings on payment arrangements, copied
// as rows of Verint's Coaching Sessions list plus one session page. The
// fixture is made up in the same shape (tests/fixtures/qa-coaching-list.txt).
const LIST = fs.readFileSync(path.join(ROOT, 'tests/fixtures/qa-coaching-list.txt'), 'utf8');

suite('QA coaching: rows of the Coaching Sessions list read, and merge with a session page', async (t) => {
    const { qa } = load(t);
    const sessions = qa.parseSessions(LIST);
    t.equal('three sessions, the page and its row counted once', sessions.length, 3);
    t.equal('in list order', sessions.map(s => s.associateName).join(', '), 'Jamie Doe, Sam Rivera, Morgan Lee');

    const [jamie, sam, morgan] = sessions;
    t.equal('a row with no action cell still reads', jamie.sessionId, '10011');
    t.equal('the page fills in the evaluation date', jamie.evalDate, '2026-11-02');
    t.equal('and the form', jamie.formName, 'APS Process Accuracy Evaluation');
    t.equal('the list keeps the meeting time', jamie.meetingAt, '11/02/2026 4:30 PM');
    t.check('the page\'s two reason lines joined', /down payment\. Reminder to include/.test(jamie.qaNote));

    t.equal('a list row\'s session id', sam.sessionId, '10012');
    t.equal('its due date is the date-only cell', sam.dueDate, '2026-11-07');
    t.equal('the session type', sam.sessionType, 'Process Accuracy QA (Priority Coaching)');
    t.equal('assigned by is the name after the coach', sam.assignedBy, 'Evaluator, Pat');
    t.equal('no evaluation date in the list', sam.evalDate, '');
    t.equal('the category comes off', sam.category, 'Process Accuracy');
    t.check('no score anywhere in what was read', !JSON.stringify(sessions).includes('60.00'));

    t.equal('the list alone reads all three', qa.parseSessions(LIST.split('Manage Coaching Session')[0]).length, 3);
    t.equal('the page alone reads one', qa.parseSessions('Manage Coaching Session' + LIST.split('Manage Coaching Session')[1]).length, 1);
    t.equal('the old pages still read two', qa.parseSessions(PASTE).length, 2);
    t.equal('an id and a name with no reason is no row', qa.parseSessions('\t10011\tDoe, Jamie\tCoach, Casey\tCoach').length, 0);
    t.equal('other tab lines are no row', qa.parseSessions('Score: 60.00 \t \tView\tDelete\nCoach\tCoach, Casey').length, 0);
});

suite('QA coaching: payment arrangement reasons and the points after them', async (t) => {
    const { qa } = load(t);
    const [jamie, sam, morgan] = qa.parseSessions(LIST);

    t.equal('a payment they could make now, sent to call back', jamie.reasonKey, 'pa-payment-as-down');
    t.equal('paying later the same day', morgan.reasonKey, 'pa-payment-as-down');
    t.equal('a credit in place of the down payment', sam.reasonKey, 'pa-credit-down-payment');
    t.equal('the October one stays a PA that would break',
        qa.parseSessions(PASTE)[1].reasonKey, 'fcr-payment-arrangement');

    const jamieSteps = qa.stepsFor(jamie.reasonKey, jamie.qaNote);
    t.check('sets the arrangement on the call', /use that payment as the down payment/.test(jamieSteps[0]));
    t.check('the notes reminder becomes a step', jamieSteps.some(step => /balances, amounts and dates/.test(step)));
    t.check('nothing about approval she was not coached on', !jamieSteps.some(step => /Team Lead/.test(step)));

    const samSteps = qa.stepsFor(sam.reasonKey, sam.qaNote);
    t.equal('credit, contact type, then $0 down approval', samSteps.length, 3);
    t.check('the credit step leads', /does not take the place of the down payment/.test(samSteps[0]));
    t.check('the 1X PA Exception contact type', /1X PA Exception contact type/.test(samSteps[1]));
    t.check('$0 down needs Team Lead approval', /Team Lead approval/.test(samSteps[2]));

    const morganSteps = qa.stepsFor(morgan.reasonKey, morgan.qaNote);
    t.check('TONP explained', morganSteps.some(step => /TONP goes through once their payment is made/.test(step)));
    t.equal('approval once, though the note says TL and $0 down',
        morganSteps.filter(step => /Team Lead approval/.test(step)).length, 1);

    t.check('a contact type with no PA gets the plain step',
        qa.stepsFor('other', 'Incorrect contact type on the move').includes('Pick the contact type that matches what you did on the call.'));
    t.equal('a note with no points keeps the reason\'s steps',
        qa.stepsFor('rate-plan-wrong', 'Incorrect rate plan').join('|'), stepsFor(qa, 'rate-plan-wrong').join('|'));
});

suite('QA coaching: QA\'s shorthand and typos tidied for the associate', async (t) => {
    const { qa } = load(t);
    t.equal('a dash after a full stop goes',
        qa.cleanQaNote('Set it as the down payment. - Reminder to include balances'),
        'Set it as the down payment. Reminder to include balances');
    t.equal('a dash before a new capitalised point is a full stop',
        qa.cleanQaNote('to set longer installments - Did not receive TL approval'),
        'To set longer installments. Did not receive TL approval');
    t.equal('pymt spelled out', qa.cleanQaNote('after making $60 pymt'), 'After making $60 payment');
    t.equal('advise to callback', qa.cleanQaNote('customer was advise to callback later'), 'Customer was advised to call back later');
    t.equal('suppose to', qa.cleanQaNote('The credit is not suppose to be used'), 'The credit is not supposed to be used');
});

suite('QA coaching: a list-only session\'s email', async (t) => {
    const { qa } = load(t);
    const sam = qa.parseSessions(LIST)[1];
    const email = qa.buildEmail(Object.assign({}, sam, { steps: qa.stepsFor(sam.reasonKey, sam.qaNote) }));
    t.check('greets by first name', email.body.startsWith('Hey Sam,'));
    t.check('praise first', email.body.split('\n')[2] === 'Thank you for the care you put into your calls.');
    t.check('no evaluation date, so a recent call', email.body.includes('QA reviewed one of your recent calls,'));
    t.check('QA\'s note, tidied', email.body.includes('What QA noticed:\nThe $50 credit is not supposed to be used as a substitute for down payment. Incorrect contact type.'));
    t.check('the steps', email.body.includes('For next time:\n- A credit on the account'));
    t.equal('subject', email.subject, 'QA feedback: Down payments on payment arrangements');
    t.check('no em or en dashes', !/[–—]/.test(email.body + email.subject));
    t.check('no score', !/score|60\.00/i.test(email.body));
});

suite('QA coaching: one record per coaching, Sent until marked Read', async (t) => {
    t.pinClock('2026-10-27');
    const { qa, history } = load(t);
    const [first, second] = qa.parseSessions(PASTE);
    const input = Object.assign({}, first, { steps: stepsFor(qa, first.reasonKey) });

    qa.recordQaCoaching(input, 'email');
    qa.recordQaCoaching(input, 'email');
    qa.recordQaCoaching(input, 'verint');
    t.equal('the same session logged three ways is one record', history().entries.length, 1);

    const entry = history().entries[0];
    t.equal('kept in the follow-up history as QA', entry.kind, 'qa');
    t.equal('starts as Sent, not read', entry.status, 'pending');
    t.check('with when it was emailed and logged', Boolean(entry.emailedAt && entry.verintAt));
    t.equal('and the due date from Verint', entry.dueDate, '2026-10-09');
    t.check('past its due date and unread is flagged', qa.isOverdue(entry));

    qa.setRead(entry.id, true);
    const read = history().entries[0];
    t.equal('marked Read', read.status, 'resolved');
    t.check('with the day', Boolean(read.readAt));
    t.check('a read one is never flagged', !qa.isOverdue(read));
    qa.setRead(entry.id, false);
    t.equal('and back again', history().entries[0].status, 'pending');

    qa.recordQaCoaching(Object.assign({}, second, { steps: [] }), 'email');
    t.equal('another session is another record', history().entries.length, 2);
    t.check('not due yet is not flagged', !qa.isOverdue(history().entries[0]));

    qa.recordQaCoaching({ associateName: 'Jamie Doe', reasonKey: 'other', qaNote: 'Typed in' }, 'email');
    qa.recordQaCoaching({ associateName: 'Jamie Doe', reasonKey: 'other', qaNote: 'Typed in again' }, 'email');
    t.equal('a typed one is one per associate, reason and day', history().entries.length, 3);
    t.check('the score is never stored', !JSON.stringify(history()).includes('60.00'));
});
