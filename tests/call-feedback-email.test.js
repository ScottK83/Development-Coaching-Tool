'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * WRITING THE EMAIL WITHOUT LEAVING THE APP
 *
 * Emailing an associate about a call meant: generate a prompt, copy it, switch
 * to Copilot, paste, wait, copy the answer, switch back, paste again. Four
 * clipboard operations and an app switch to send words that were already typed
 * into the form.
 *
 * Nothing in that needed a model. The supervisor did the listening and wrote
 * the notes; what was outstanding was an opening line, an order and a close.
 *
 * The associate reads what comes out of here, so it is held to the same voice
 * rules as the rules engine: no QA vocabulary, no report labels, second
 * person, no em dashes, and it names the call it is about.
 */

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-summary.module.js');
    return t.loadModule('modules/call-listening.module.js').callListening;
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

suite('call feedback email: it writes from the notes and nothing else', (t) => {
    const api = load(t);

    const message = api.buildCallFeedbackMessage(entry({
        whatWentWell: 'Outstanding call.\n- You owned the billing question straight away.\n- The recap at the end was clear.',
        improvementAreas: '- Slow down before you transfer.'
    }), { getEmployeeNickname: () => 'Alyssa' });

    t.check('it greets her by name', message.startsWith('Hi Alyssa,'));
    t.check('every point she wrote is in it', message.indexOf('owned the billing question') > -1
        && message.indexOf('recap at the end was clear') > -1
        && message.indexOf('Slow down before you transfer') > -1);
    t.check('the points are bulleted', /\n- /.test(message));

    // It has no findings of its own. Anything it added would be a claim about
    // a call the supervisor listened to and did not make.
    const words = message.toLowerCase();
    t.check('nothing about hold time was invented', words.indexOf('hold') === -1);
    t.check('nor about empathy', words.indexOf('empath') === -1);
});

suite('call feedback email: it says which call', (t) => {
    const api = load(t);

    // She takes dozens of calls a week. Feedback that does not say which one
    // is feedback she cannot check.
    const message = api.buildCallFeedbackMessage(entry({
        whatWentWell: '- Good ownership.'
    }));
    t.check('the opening names the day', /September/.test(message) || /2026-09-04/.test(message));
    t.check('and it is in the first paragraph', message.split('\n\n')[1].indexOf('listened back') > -1);

    // With no date on the entry it says less rather than saying something
    // wrong.
    const undated = api.buildCallFeedbackMessage(entry({
        listenedOn: '', callTime: '', whatWentWell: '- Good ownership.'
    }));
    t.check('an undated call does not invent a date', /one of your recent calls/.test(undated));
});

suite('call feedback email: the tone follows the balance of the notes', (t) => {
    const api = load(t);

    // A call where the strengths outnumber the coaching has to read as a well
    // earned pat on the back with a couple of refinements, not as a correction
    // with praise stapled to the front.
    const good = api.buildCallFeedbackMessage(entry({
        whatWentWell: '- Great ownership.\n- Clear recap.\n- Warm close.',
        improvementAreas: '- Slow down on discovery.'
    }));
    t.check('a strong call reads as a strong call', /strong call/.test(good));
    t.check('and closes without a warning', /Nothing here is a concern/.test(good));

    const clean = api.buildCallFeedbackMessage(entry({
        whatWentWell: '- Great ownership.\n- Clear recap.'
    }));
    t.check('nothing to work on says so', /nothing I need you to change/.test(clean));

    const heavy = api.buildCallFeedbackMessage(entry({
        whatWentWell: '- Good greeting.',
        improvementAreas: '- Slow down.\n- Confirm the root cause.\n- Recap before closing.'
    }));
    t.check('a heavier call does not claim it was strong', !/strong call/.test(heavy));
    t.check('and it still opens with what went well',
        heavy.indexOf('Good greeting') < heavy.indexOf('Slow down'));
});

suite('call feedback email: manager notes are not put in front of her', (t) => {
    const api = load(t);

    // That field asks for tone and context notes for how the message should be
    // communicated. It is guidance to whoever writes it, not something the
    // associate should read.
    const notes = entry({
        whatWentWell: '- Good ownership.',
        managerNotes: 'Go easy on her, she has had a rough week at home.'
    });
    const message = api.buildCallFeedbackMessage(notes);

    t.check('the manager note is not in the email', message.indexOf('rough week') === -1);

    // And the caller is told, rather than finding out by reading the draft.
    const said = api.describeCallFeedbackMessage(notes);
    t.check('the caller is told it was left out', /not in the draft/.test(said));
    t.check('and the counts are said out loud', /1 thing that went well/.test(said));
});

suite('call feedback email: the optional extras land where they belong', (t) => {
    const api = load(t);

    const message = api.buildCallFeedbackMessage(entry({
        whatWentWell: '- Good ownership.',
        relevantInfo: 'The billing adjustment window moved to 5 days in August',
        oscarUrl: 'https://oscar.example/billing-adjustments'
    }));

    t.check('relevant information is included', /billing adjustment window/.test(message));
    t.check('and the link is offered as a resource',
        /more on this here if you want it: https:\/\/oscar\.example/.test(message));
    t.check('the link comes after the coaching, not before',
        message.indexOf('oscar.example') > message.indexOf('Good ownership'));
});

suite('call feedback email: notes arrive in whatever shape they were typed', (t) => {
    const api = load(t);

    // Analyze writes a headline then dashed bullets. A supervisor typing over
    // the top writes whatever they like. Both have to come out the same way.
    const dashed = api.splitNote('Outstanding call.\n- One.\n- Two.');
    t.equal('a headline is kept apart from the bullets', dashed.lead, 'Outstanding call.');
    t.equal('and the bullets are counted', dashed.bullets.length, 2);

    const numbered = api.splitNote('1. One thing\n2) Another thing');
    t.equal('numbered notes are bullets too', numbered.bullets.length, 2);

    // A wrapped line under a bullet belongs to that bullet rather than
    // starting a new one.
    const wrapped = api.splitNote('- She owned the billing question\n  straight away without being asked');
    t.equal('a wrapped line stays with its bullet', wrapped.bullets.length, 1);
    t.check('and keeps the whole sentence',
        wrapped.bullets[0].indexOf('without being asked') > -1);

    // Plain prose with no dashes anywhere is still points, and dropping it
    // would lose the entire note.
    const prose = api.splitNote('Good call overall.\nShe handled the escalation well.');
    t.equal('prose keeps its opening line', prose.lead, 'Good call overall.');
    t.equal('and the rest becomes a point', prose.bullets.length, 1);

    t.equal('an empty note gives nothing', api.splitNote('').bullets.length, 0);
    t.equal('and no notes at all give no message',
        api.buildCallFeedbackMessage(entry()), '');
});

suite('call feedback email: it sounds like her supervisor wrote it', (t) => {
    const api = load(t);

    const message = api.buildCallFeedbackMessage(entry({
        whatWentWell: '- Good ownership.\n- Clear recap.',
        improvementAreas: '- Slow down on discovery.'
    }), { getEmployeeNickname: () => 'Alyssa' });

    const lines = message.split('\n').filter(Boolean);

    // The same rules the engine's own copy is held to.
    const JARGON = ['hedging language', 'dead air', 'active listening', 'call control',
        'QA form', 'soft skills', 'compliance', 'disclosures', 'filler words'];
    const jargon = lines.filter((line) =>
        JARGON.some((word) => line.toLowerCase().includes(word)));
    t.equal(`no QA vocabulary (${jargon.join(' | ') || 'clean'})`, jargon.length, 0);

    const dashed = lines.filter((line) => /[—–]/.test(line));
    t.equal(`no em dashes (${dashed.join(' | ') || 'clean'})`, dashed.length, 0);

    const thirdPerson = lines.filter((line) =>
        /\b(the associate|the advisor|the agent|she should|he should)\b/i.test(line));
    t.equal(`it is written to her, not about her (${thirdPerson.join(' | ') || 'clean'})`,
        thirdPerson.length, 0);

    const patronising = lines.filter((line) =>
        /if you'?re new|as you learn|remember to always/i.test(line));
    t.equal('nothing talks down to her', patronising.length, 0);

    // A report label in front of a sentence is what made the old output read
    // as a form. Bullets and the greeting are exempt.
    const labelled = lines.filter((line) =>
        !line.startsWith('- ') && !line.startsWith('Hi ')
        && /^[A-Z][A-Za-z]*(?: [a-z]+){0,2}:\s/.test(line));
    t.equal(`no line opens with a report label (${labelled.join(' | ') || 'clean'})`,
        labelled.length, 0);

    t.check('it closes rather than stopping mid thought',
        /come and find me|Keep going|Keep doing/i.test(lines[lines.length - 1]));
});

suite('call feedback email: wiring', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    t.check('the button exists', html.includes('id="writeCallFeedbackEmailBtn"'));
    t.check('it is the primary action on the feedback panel',
        /id="writeCallFeedbackEmailBtn" class="btn-primary"/.test(html));
    t.check('it is bound',
        /bindElementOnce\(document\.getElementById\('writeCallFeedbackEmailBtn'\), 'click', writeCallFeedbackEmail\)/.test(script));

    // Same destination as the metric composer, so there is one send box.
    t.check('it writes into the send box',
        /function writeCallFeedbackEmail\(\)[\s\S]{0,1600}callListeningOutlookBody/.test(script));
    t.check('and enables the send button',
        /function writeCallFeedbackEmail\(\)[\s\S]{0,1800}updateCallListeningOutlookButtonState/.test(script));

    // Never over the top of an edited draft without asking.
    t.check('it asks before replacing existing work',
        /function writeCallFeedbackEmail\(\)[\s\S]{0,1400}window\.confirm/.test(script));

    // The page no longer tells anybody that Copilot is the way in.
    t.check('the send box placeholder does not demand Copilot',
        !/placeholder="Paste the Copilot-generated call feedback email here/.test(html));
    t.check('nor does the empty body warning',
        !fs.readFileSync(path.join(ROOT, 'modules/call-listening.module.js'), 'utf8')
            .includes('Paste the Copilot-generated email content first'));
});
