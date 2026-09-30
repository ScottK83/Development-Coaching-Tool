'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * THE OTHER RED FLAGS
 *
 * Verification has its own read. These are the rest a supervisor needs to see
 * without looking: a safety hazard, a promise, a blame line, a supervisor
 * request left hanging, medical equipment on a shut off call, a complaint
 * threat.
 *
 * Narrow on purpose. A flag that fires on ordinary phrasing teaches everybody
 * to scroll past the box, and then the one that matters gets scrolled past
 * too. So every flag here is paired with the everyday line it must not fire
 * on.
 */

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-verification.module.js');
    t.loadModule('modules/call-explanation.module.js');
    t.loadModule('modules/call-red-flags.module.js');
    return global.window.DevCoachModules;
}

function call(lines) {
    return ['Agent: Thank you for calling APS, my name is Jamie. How can I help you today?'].concat(lines).join('\n');
}

function flagsOf(F, lines) {
    return F.readRedFlagsFromText(call(lines)).flags;
}

suite('red flags: a promise about the outcome', (t) => {
    const { callRedFlags: F } = load(t);

    const promised = flagsOf(F, [
        'Customer: Will switching plans fix my bill?',
        'Agent: Yes, I guarantee your bill will be lower next month.'
    ]);
    t.equal('it is flagged', promised.length, 1);
    t.equal('as a promise', promised[0].key, 'promise');
    t.equal('worth a look, not red', promised[0].level, 'warn');
    t.check('and coached', promised[0].coach?.key === 'promise');

    t.equal('"your bill will be lower" alone counts', flagsOf(F, ['Agent: Your bill will be lower on this plan.']).length, 1);

    // The right thing to say, and accurate conditional statements.
    t.equal('not "I can\'t guarantee"', flagsOf(F, ['Agent: I can\'t guarantee it will be lower, but it should help.']).length, 0);
    t.equal('not "there is no guarantee"', flagsOf(F, ['Agent: There is no guarantee on that.']).length, 0);
    t.equal('not a conditional', flagsOf(F, ['Agent: As long as the payment posts, you won\'t be disconnected.']).length, 0);
    t.equal('not "if you pay by Friday"', flagsOf(F, ['Agent: If you pay by Friday you won\'t be disconnected.']).length, 0);
    t.equal('not the customer asking for one', flagsOf(F, ['Customer: Can you promise me that?']).length, 0);
});

suite('red flags: a line that puts it on the customer', (t) => {
    const { callRedFlags: F } = load(t);

    [
        'Agent: Ma\'am, you need to calm down.',
        'Agent: That\'s not my problem, you should have called sooner.',
        'Agent: I don\'t know what to tell you.',
        'Agent: You\'re not listening to me.'
    ].forEach(line => {
        const flags = flagsOf(F, [line]);
        t.check(`flagged: ${line}`, flags.length === 1 && flags[0].key === 'blame' && flags[0].coach?.key === 'blame');
    });

    t.equal('not the customer saying it', flagsOf(F, ['Customer: I need to calm down, sorry, it has been a day.']).length, 0);
    t.equal('not ordinary empathy', flagsOf(F, ['Agent: I understand, that is frustrating, let me help.']).length, 0);
});

suite('red flags: a supervisor request left hanging', (t) => {
    const { callRedFlags: F } = load(t);

    const left = flagsOf(F, [
        'Customer: I want to speak to a supervisor right now.',
        'Agent: I understand. Let me look at the account again.',
        'Customer: Fine.'
    ]);
    t.equal('flagged', left.length, 1);
    t.equal('as the supervisor flag', left[0].key, 'supervisor');
    t.check('context only, never coached: the existing supervisor rule already coaches it', !left[0].coach);

    t.equal('not when one is fetched', flagsOf(F, [
        'Customer: Can I talk to your manager?',
        'Agent: Absolutely, let me get my supervisor on the line.'
    ]).length, 0);
    t.equal('not when a callback is booked', flagsOf(F, [
        'Customer: I want to speak to a supervisor.',
        'Agent: A supervisor will call you back within the hour.'
    ]).length, 0);
});

suite('red flags: a safety hazard', (t) => {
    const { callRedFlags: F, callTranscript: T } = load(t);

    const ignored = [
        'Customer: There are sparks coming out of the meter box.',
        'Agent: Okay, can I have the address on the account?'
    ];
    const flags = flagsOf(F, ignored);
    t.equal('flagged', flags.length, 1);
    t.equal('red when no emergency steps were heard', flags[0].level, 'red');
    t.check('and coached as red, so it leads the draft', flags[0].coach?.severity === 'red');

    const analysis = T.analyzeTranscript(call(ignored), { associateName: 'Jamie' });
    t.check('the analysis counts it as a red flag', analysis.stats.redFlag);
    t.equal('which takes the positive headline off', analysis.headline, '');
    t.equal('and leads the improvements', analysis.improvements[0].key, 'safety');

    const handled = flagsOf(F, [
        'Customer: A power line is down in my yard and it is sparking.',
        'Agent: Please stay away from it. I am putting this in as an emergency and sending a crew out now.'
    ]);
    t.equal('still shown when it was handled', handled.length, 1);
    t.equal('but only as context', handled[0].level, 'info');
    t.check('and not coached', !handled[0].coach);

    // "Shocked at my bill" is on every other high bill call.
    t.equal('not "shocked at my bill"', flagsOf(F, ['Customer: I was shocked when I opened my bill.']).length, 0);
    t.equal('not the associate giving safety advice', flagsOf(F, ['Agent: If you ever see a line down, stay away from it and call 911.']).length, 0);
});

suite('red flags: medical need on a shut off call', (t) => {
    const { callRedFlags: F } = load(t);

    const flags = flagsOf(F, [
        'Customer: I got a disconnect notice and my husband is on oxygen.',
        'Agent: Let me look at the past due amount.'
    ]);
    t.equal('flagged', flags.length, 1);
    t.equal('as context for the supervisor', flags[0].level, 'info');
    t.check('never coached', !flags[0].coach);
    t.check('it says nothing came back to it', /Nothing after it comes back to it/.test(flags[0].detail));

    t.equal('not on a call with no shut off in it', flagsOf(F, [
        'Customer: I am on oxygen so I am home all day, is time of use right for me?'
    ]).length, 0);
});

suite('red flags: talk of taking it further', (t) => {
    const { callRedFlags: F } = load(t);

    [
        'Customer: I am going to file a complaint with the corporation commission.',
        'Customer: My lawyer is going to hear about this.',
        'Customer: I will call the news.'
    ].forEach(line => {
        const flags = flagsOf(F, [line]);
        t.check(`flagged: ${line}`, flags.length === 1 && flags[0].key === 'complaint' && !flags[0].coach);
    });

    // Power of attorney is a third party authorization, on every other
    // account call about a parent.
    t.equal('not power of attorney', flagsOf(F, ['Customer: I have power of attorney for my mom.']).length, 0);
    t.equal('not somebody called Sue', flagsOf(F, ['Customer: Hi, my name is Sue.']).length, 0);
    t.equal('not good news', flagsOf(F, ['Customer: That is good news, thank you.']).length, 0);
});

suite('red flags: the box', (t) => {
    const { callRedFlags: F } = load(t);

    const clean = F.readRedFlagsFromText(call(['Customer: I need to start service.', 'Agent: Happy to help with that.']));
    const quiet = F.buildAlertHtml(clean);
    t.check('a clean call gets one quiet line', /Nothing else flagged/.test(quiet) && /call-alert-ok/.test(quiet));
    t.check('that says what was checked', /safety hazards/.test(quiet));

    const red = F.buildAlertHtml(F.readRedFlagsFromText(call([
        'Customer: I smell something burning by the meter.',
        'Agent: Okay, what is the address?'
    ])));
    t.check('a red flag is the red box', /call-alert-red/.test(red) && /role="alert"/.test(red));

    const warn = F.buildAlertHtml(F.readRedFlagsFromText(call(['Agent: I promise it will be fixed.'])));
    t.check('a warning is the yellow box', /call-alert-warn/.test(warn) && !/call-alert-red/.test(warn));

    const text = F.buildAlertText(F.readRedFlagsFromText(call(['Agent: Calm down, please.'])));
    t.check('the Verint note gets a plain text version', /^Also flagged:/.test(text) && /Calm down/.test(text));
});

suite('red flags: the coaching lines follow the house rules', (t) => {
    const { callRedFlags: F } = load(t);

    const lines = F.coachingFor(F.readRedFlagsFromText(call([
        'Customer: There are sparks by the pole.',
        'Agent: Calm down. I guarantee your bill will be lower.'
    ]))).map(item => item.text);

    t.equal('all three coached', lines.length, 3);
    t.equal('no em dashes', lines.filter(line => /[—–]/.test(line)).length, 0);
    t.equal('no report labels', lines.filter(line => /^[A-Z][A-Za-z]*(?: [a-z]+){0,2}:\s/.test(line)).length, 0);
    t.equal('no single-call deixis', lines.filter(line => /on this call|on this one|this time| here[.,]/i.test(line)).length, 0);
    t.equal('never "red flag" to the associate', lines.filter(line => /red flag/i.test(line)).length, 0);
});

suite('red flags: wiring', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    ['call-explanation', 'call-red-flags'].forEach(name => {
        t.check(`${name} is in the loader`, html.includes(`modules/${name}.module.js`));
        t.check(`${name} loads before anybody analyzes`,
            html.indexOf(`modules/${name}.module.js`) < html.indexOf('modules/call-listening.module.js'));
    });

    // The full boxes sit in the full read under More, beside the verification
    // box. What is on the page at rest is the one line strip under the paste.
    const section = html.slice(html.indexOf('id="subSectionCallListening"'));
    const at = (needle) => section.indexOf(needle);
    t.check('the red flags box sits under verification', at('id="callVerificationAlert"') < at('id="callRedFlagsAlert"'));
    t.check('and the explanation read under that', at('id="callRedFlagsAlert"') < at('id="callExplanationPanel"'));
    t.check('the strip that sums them up is under the paste box, before the notes',
        at('id="callListeningTranscript"') < at('id="callFlagStrip"') && at('id="callFlagStrip"') < at('id="callListeningStrengths"'));

    t.check('both are rendered on a read', /renderCallRedFlagsAlert\(transcript/.test(script) && /renderCallExplanationPanel\(transcript/.test(script));
    t.check('both are cleared with the rest', /'callRedFlagsAlert', 'callExplanationPanel'/.test(script));
    t.check('the Copilot wording button is wired',
        /bindElementOnce\(document\.getElementById\('callExplanationPanel'\), 'click', handleCallExplanationClick\)/.test(script));
    t.check('the strip reads both', /function renderCallFlagStrip[\s\S]{0,1600}analysis\.redFlags[\s\S]{0,400}analysis\.explanation/.test(script));
    t.check('and the Verint note records the red ones',
        /function buildCallListeningRedFlagLines[\s\S]{0,1200}readRedFlagsFromText[\s\S]{0,200}level === 'red'/.test(script));
});

suite('call listening: the header picks the associate, and a new call starts fresh', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    // It used to fill only an empty dropdown, so pasting a second associate's
    // call filed it under the first.
    t.check('the header overrides a different associate',
        /if \(match && employeeSelect\.value !== match\)/.test(script));
    t.check('through a real change event so everything follows',
        /employeeSelect\.dispatchEvent\(new Event\('change'\)\)/.test(script));
    t.check('which cannot start a second read of the same call',
        /function rereadCallForSelectedAssociate\(\) \{\s*if \(callReadInProgress\) return;/.test(script));

    // A new call pasted over an old one does not stack its drafts under the
    // last call's, and typed notes are never cleared without asking.
    t.check('a new call over an old one starts fresh feedback', /if \(hadCall\) startFreshCallFeedback\(\)/.test(script));
    t.check('asking first when something was typed', /typedIn && !confirm\(/.test(script));
});
