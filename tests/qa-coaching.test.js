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
