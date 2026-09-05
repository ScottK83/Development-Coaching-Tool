'use strict';

/**
 * How long the call ran, and where the time went.
 *
 * The handle time coaching could say "about four minutes of silence starting
 * at 5:54" and never say the call ran 18 minutes against a seven minute
 * target. Naming a moment without naming the scale leaves the associate to
 * work out on her own whether that silence is the problem or a fraction of it,
 * which is the one thing a supervisor who listened to the call can answer and
 * she cannot.
 *
 * Every number here has to be measured. These tests care more about what the
 * ledger refuses to say than about what it says: a budget invented for a real
 * call is worse than no budget, and the first version of this shipped a
 * verification bucket that read eight minutes off three lines scattered across
 * the call and led the sentence with it.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const VERINT_EXPORT = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'verint-export.txt'), 'utf8');

// The real call in the fixture: 18:24 long, one announced hold and two
// stretches of quiet that were never announced.
const AHT_TARGET = 426;

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-time-ledger.module.js');
    return global.window.DevCoachModules;
}

function loadWithBridge(t) {
    t.installFakeBrowser();
    global.getMetricTips = (key) => ({
        aht: ['Type account notes WHILE talking, not in silence after'],
        holdTime: ['Check back with the customer every 45 seconds on a hold']
    }[key] || []).slice();
    global.window.METRICS_REGISTRY = {
        aht: { label: 'Average Handle Time' },
        holdTime: { label: 'Hold Time' }
    };
    global.window.formatMetricDisplay = (key, value) => String(value);
    t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-word-choice.module.js');
    t.loadModule('modules/call-time-ledger.module.js');
    t.loadModule('modules/call-coaching-bridge.module.js');
    return global.window.DevCoachModules;
}

suite('time ledger: saying a length out loud', (t) => {
    const { callTimeLedger } = load(t);
    const spoken = callTimeLedger.spoken;

    // Seconds while a person would still count in seconds, minutes after that.
    t.equal('a short gap stays in seconds', spoken(63), '63 seconds');
    t.equal('and so does a gap just under the line', spoken(89), '89 seconds');
    t.equal('past that it rounds to minutes', spoken(140.6), '2 minutes');
    // The shortest thing that reaches the minutes branch still rounds to two,
    // so the singular never fires at the current cutoff. Asserted so a later
    // change to that cutoff has to notice.
    t.equal('the first minute reading is already plural', spoken(90), '2 minutes');
    t.equal('a target reads as a round number', spoken(AHT_TARGET), '7 minutes');
    t.equal('a long call too', spoken(1104), '18 minutes');
    // A bucket that measured nothing says nothing, rather than "0 seconds".
    t.equal('nothing is nothing', spoken(0), '');
    t.equal('and so is rubbish', spoken('half an hour'), '');
});

suite('time ledger: a real call, measured', (t) => {
    const { callTimeLedger } = load(t);
    const ledger = callTimeLedger.buildLedger(VERINT_EXPORT, {
        associateName: 'Alyssa Dimes',
        target: AHT_TARGET
    });

    t.check('the call can be measured', ledger.ok === true);
    // Off the Verint header, not off the last timestamp, which is a floor
    // rather than a length.
    t.equal('the length comes from the header', ledger.total, 1104);
    t.check('and is reported as exact', ledger.exact === true);
    t.equal('the target came through', ledger.target, AHT_TARGET);
    t.equal('and the overage is arithmetic', Math.round(ledger.over), 1104 - AHT_TARGET);
    t.check('this one is meaningfully over', ledger.overTarget === true);

    // The announced hold and the unannounced quiet are different things and
    // the associate is only answerable for one of them.
    t.equal('the announced hold is counted once', ledger.hold.count, 1);
    t.equal('the quiet is counted separately', ledger.quiet.count, 2);
    t.check('the hold is about two minutes', Math.abs(ledger.hold.seconds - 140.6) < 1);
    t.check('the quiet is about two minutes', Math.abs(ledger.quiet.seconds - 120.6) < 1);

    // Nothing is double counted and nothing goes missing: the buckets and the
    // remainder add back up to the call.
    t.check('the parts add up to the whole',
        Math.abs((ledger.accountedFor + ledger.everythingElse) - ledger.total) < 0.01);

    // The stretch after the customer has been told it is sorted. Nothing else
    // in the app measures this.
    t.check('the tail after resolution is found', Boolean(ledger.tail));
    t.equal('and it is the time from there to the end', Math.round(ledger.tail.seconds), 72);
});

suite('time ledger: the parts a person can move', (t) => {
    const { callTimeLedger } = load(t);
    const ledger = callTimeLedger.buildLedger(VERINT_EXPORT, {
        associateName: 'Alyssa Dimes',
        target: AHT_TARGET
    });
    const parts = callTimeLedger.movableParts(ledger);

    t.equal('three things stand out', parts.length, 3);
    t.equal('biggest first', parts.map((part) => part.key).join(','), 'hold,quiet,tail');
    t.check('and they really are in order',
        parts.every((part, index) => index === 0 || parts[index - 1].seconds >= part.seconds));

    // There is no verification bucket, and there was one. It read the identity
    // check as the span from the first such question to the last, which on
    // this very call came out at eight minutes and led the sentence: the three
    // matching lines were at 0:13, 2:37 and 7:56, so the "block" was most of
    // the call, and the middle one was the customer saying they had no social
    // security number yet, attributed to the advisor by the unlabelled parser.
    t.check('nothing claims to have measured the identity check',
        !parts.some((part) => /identity|verif/i.test(part.text)));

    // The residual is never offered as something to fix. Telling somebody most
    // of a call was spent talking to the customer is not coaching.
    t.check('the remainder is not a suggestion',
        !parts.some((part) => part.key === 'everythingElse'));

    // Two wordings on purpose. The sentence strings three of these together,
    // so a timestamp on the last one trails off exactly where it should land;
    // the panel wants it, because the supervisor is about to go and listen.
    t.check('the sentence wording carries no timestamp',
        !parts.some((part) => /\d{1,3}:\d\d/.test(part.text)));
    t.check('the panel wording does', parts.some((part) => /\d{1,3}:\d\d/.test(part.detail)));
    t.check('and the detail is built on the text',
        parts.every((part) => part.detail.startsWith(part.text)));
});

suite('time ledger: the sentence for the associate', (t) => {
    const { callTimeLedger } = load(t);
    const ledger = callTimeLedger.buildLedger(VERINT_EXPORT, {
        associateName: 'Alyssa Dimes',
        target: AHT_TARGET
    });

    const sentence = callTimeLedger.buildLedgerSentence(ledger, { callName: 'the August 4 call' });

    t.check('there is a sentence', Boolean(sentence));
    t.check('it names the call', sentence.includes('the August 4 call'));
    t.check('it says how long it ran', sentence.includes('18 minutes'));
    t.check('and what we are aiming at', sentence.includes('7 minutes'));
    t.check('it names the hold', sentence.includes('2 minutes on hold'));
    t.check('and the quiet', sentence.includes('no hold announced'));
    t.check('and the tail', sentence.includes('after you told them it was sorted'));

    // It goes into a message signed by a supervisor, so it follows the same
    // rules as everything else that does.
    t.check('written to her, not about her', !/\b(she|her|they|their)\b/i.test(sentence));
    t.check('no em dash', !/[‒—―−]/.test(sentence));
    t.check('no QA vocabulary',
        !/\b(metric|kpi|target attainment|adherence|compliance|opportunity area)\b/i.test(sentence));
    // "this one" under a paragraph about four calls is a claim about four
    // calls. The call gets named or the sentence does not run.
    t.check('it never says "this one"', !/this one|this call/i.test(sentence));

    // Without a name it still reads, because the caller only omits the name
    // when there is one call and the message already said which.
    const unnamed = callTimeLedger.buildLedgerSentence(ledger);
    t.check('an unnamed call falls back to something sayable', unnamed.includes('that call'));
});

suite('time ledger: it declines rather than estimate', (t) => {
    const { callTimeLedger } = load(t);

    const untimed = [
        'Agent: thank you for calling a p s my name is alyssa how can i help',
        'Customer: i need to sort out my bill it is way too high this month',
        'Agent: let me take a look at that for you now',
        'Customer: thank you i appreciate it',
        'Agent: alright you are all set on our end have a good night'
    ].join('\n');

    // No timestamps means no gaps, and a call length worked out from word
    // counts would be a model presented as a stopwatch.
    t.equal('an untimed transcript is declined',
        callTimeLedger.buildLedger(untimed, { target: AHT_TARGET }).reason, 'not-timed');
    t.equal('and nothing at all is declined',
        callTimeLedger.buildLedger('', { target: AHT_TARGET }).reason, 'empty');
    t.equal('and so is nothing whatsoever',
        callTimeLedger.buildLedger(null, { target: AHT_TARGET }).reason, 'empty');

    const declined = callTimeLedger.buildLedger(untimed, { target: AHT_TARGET });
    t.equal('a declined ledger has no parts', callTimeLedger.movableParts(declined).length, 0);
    t.equal('and no sentence', callTimeLedger.buildLedgerSentence(declined), '');
    t.equal('and no panel', callTimeLedger.buildLedgerHtml(declined), '');
});

suite('time ledger: a call that came in on time says nothing', (t) => {
    const { callTimeLedger } = load(t);

    // The measurement still happens, because the supervisor's panel is worth
    // showing either way. What stops is the sentence: a budget on a call that
    // came in under target is a statistic, not coaching.
    const generous = callTimeLedger.buildLedger(VERINT_EXPORT, {
        associateName: 'Alyssa Dimes',
        target: 3600
    });
    t.check('it still measures the call', generous.ok === true);
    t.check('but it is not over target', generous.overTarget === false);
    t.equal('so there is no sentence', callTimeLedger.buildLedgerSentence(generous), '');
    t.check('while the panel still renders', callTimeLedger.buildLedgerHtml(generous).length > 0);

    // Over by a rounding error is not over. Twenty percent of the target is
    // about ninety seconds on handle time, which is a hold rather than noise.
    const barely = callTimeLedger.buildLedger(VERINT_EXPORT, {
        associateName: 'Alyssa Dimes',
        target: 1000
    });
    t.check('barely over does not trigger it', barely.overTarget === false);

    // With no target at all there is nothing to be over.
    const targetless = callTimeLedger.buildLedger(VERINT_EXPORT, { associateName: 'Alyssa Dimes' });
    t.check('a missing target measures but does not compare', targetless.ok === true);
    t.check('and never claims a gap', targetless.overTarget === false);
    t.equal('nor writes a sentence', callTimeLedger.buildLedgerSentence(targetless), '');
});

suite('time ledger: the supervisor panel', (t) => {
    const { callTimeLedger } = load(t);
    const ledger = callTimeLedger.buildLedger(VERINT_EXPORT, {
        associateName: 'Alyssa Dimes',
        target: AHT_TARGET
    });
    const html = callTimeLedger.buildLedgerHtml(ledger, (value) => String(value));

    t.check('it says what it is', html.includes('Where the time went'));
    t.check('with the length against the target', html.includes('18 minutes') && html.includes('7 minutes'));
    t.check('and the timestamps to go and listen to', /\d{1,3}:\d\d/.test(html));

    // Two things the number is not, both of which change how to read it.
    t.check('the remainder is called a subtraction', /subtraction rather than a measurement/.test(html));
    t.check('and wrap is named as missing', /wrap time is not in any of it/i.test(html));
});

suite('time ledger: only handle time gets one', (t) => {
    const { callCoachingBridge, callTimeLedger } = loadWithBridge(t);
    const ledger = callTimeLedger.buildLedger(VERINT_EXPORT, {
        associateName: 'Alyssa Dimes',
        target: AHT_TARGET
    });

    const evidence = [{ key: 'deadAirGap', text: 'Long stretch of quiet', count: 1, weight: 9, appearsOn: 'once' }];

    const aht = callCoachingBridge.buildMetricBrief(
        { metricKey: 'aht', label: 'Average Handle Time', employeeValue: 620, target: 426, classification: 'Needs Focus', evidence },
        { timeLedger: ledger }
    );
    t.check('handle time carries the ledger', Boolean(aht.timeLedger));

    // Wrap is measured after the customer has gone so no transcript contains
    // it, and the hold metric is a weekly average rather than one call's
    // total. A call length budget under either chip compares two different
    // quantities and calls the difference a gap.
    const hold = callCoachingBridge.buildMetricBrief(
        { metricKey: 'holdTime', label: 'Hold Time', employeeValue: 95, target: 30, classification: 'Needs Focus', evidence },
        { timeLedger: ledger }
    );
    t.equal('hold time does not', hold.timeLedger, null);

    // And a declined ledger is never carried, so nothing downstream has to
    // check whether the numbers in it are real.
    const declined = callCoachingBridge.buildMetricBrief(
        { metricKey: 'aht', label: 'Average Handle Time', employeeValue: 620, target: 426, classification: 'Needs Focus', evidence },
        { timeLedger: { ok: false, reason: 'not-timed' } }
    );
    t.equal('a declined ledger is dropped', declined.timeLedger, null);
});

suite('time ledger: it reaches the message', (t) => {
    const { callCoachingBridge, callTimeLedger } = loadWithBridge(t);
    const ledger = callTimeLedger.buildLedger(VERINT_EXPORT, {
        associateName: 'Alyssa Dimes',
        target: AHT_TARGET
    });

    const brief = callCoachingBridge.buildMetricBrief({
        metricKey: 'aht',
        label: 'Average Handle Time',
        employeeValue: 620,
        target: 426,
        classification: 'Needs Focus',
        evidence: [{ key: 'deadAirGap', text: 'Long stretch of quiet', count: 1, weight: 9, appearsOn: 'once' }]
    }, { timeLedger: ledger });

    const single = callCoachingBridge.buildMetricMessage(brief, {
        preferredName: 'Alyssa',
        callMoments: ['Tuesday, August 4 at 12:38 PM'],
        ledgerCallName: 'the August 4 call'
    });
    t.check('the size of it is in the message', single.includes('18 minutes'));
    t.check('and so is the goal', single.includes('7 minutes'));
    t.check('it lands before the findings it puts a size on',
        single.indexOf('18 minutes') < single.indexOf('Long stretch of quiet'));

    // One call's stopwatch reading, presented under a paragraph about four
    // calls, is a claim about four calls. Named, it is fine; unnamed, it goes.
    const named = callCoachingBridge.buildMetricMessage(brief, {
        preferredName: 'Alyssa',
        callMoments: ['Tuesday, August 4 at 12:38 PM', 'Wednesday, August 5 at 9:10 AM'],
        ledgerCallName: 'the August 4 call'
    });
    t.check('across several calls it says which one it measured',
        named.includes('the August 4 call ran'));

    const unnamed = callCoachingBridge.buildMetricMessage(brief, {
        preferredName: 'Alyssa',
        callMoments: ['Tuesday, August 4 at 12:38 PM', 'Wednesday, August 5 at 9:10 AM']
    });
    t.check('and where it cannot, the sentence is dropped rather than hedged',
        !unnamed.includes('18 minutes'));

    // The metric that does not get a ledger does not get the sentence either.
    const holdBrief = callCoachingBridge.buildMetricBrief({
        metricKey: 'holdTime',
        label: 'Hold Time',
        employeeValue: 95,
        target: 30,
        classification: 'Needs Focus',
        evidence: [{ key: 'longHold', text: 'A long hold', count: 1, weight: 8, appearsOn: 'once' }]
    }, { timeLedger: ledger });
    const holdMessage = callCoachingBridge.buildMetricMessage(holdBrief, {
        preferredName: 'Alyssa',
        callMoments: ['Tuesday, August 4 at 12:38 PM'],
        ledgerCallName: 'the August 4 call'
    });
    t.check('hold time gets no call length budget', !holdMessage.includes('18 minutes'));
});

suite('time ledger: the Copilot prompt hands the numbers over written', (t) => {
    const { callCoachingBridge, callTimeLedger } = loadWithBridge(t);
    const ledger = callTimeLedger.buildLedger(VERINT_EXPORT, {
        associateName: 'Alyssa Dimes',
        target: AHT_TARGET
    });

    const brief = callCoachingBridge.buildMetricBrief({
        metricKey: 'aht',
        label: 'Average Handle Time',
        employeeValue: 620,
        target: 426,
        classification: 'Needs Focus',
        evidence: [{ key: 'deadAirGap', text: 'Long stretch of quiet', count: 1, weight: 9, appearsOn: 'once' }]
    }, { timeLedger: ledger });

    const prompt = callCoachingBridge.buildMetricPrompt(brief, {
        preferredName: 'Alyssa',
        callMoments: ['Tuesday, August 4 at 12:38 PM'],
        ledgerCallName: 'the August 4 call'
    });

    // Written out in full and marked as the supervisor's own words, because a
    // model asked to summarise a figure will round it, and a rounded stopwatch
    // reading is a number nobody can check.
    t.check('the line is handed over already written', prompt.includes('word for word'));
    t.check('with the numbers in it', prompt.includes('18 minutes'));
    t.check('and told not to touch them', /Do not change the numbers/.test(prompt));

    // The prompt already bans talking about targets, which this line does on
    // purpose. Two instructions that disagree is how a model ends up dropping
    // one of them.
    t.check('the contradiction with the jargon rule is called out',
        /The call length line above is the exception/.test(prompt));
});

suite('time ledger: wiring', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    t.check('the module is in the loader', html.includes('modules/call-time-ledger.module.js'));
    t.check('it loads before the bridge that reads it',
        html.indexOf('modules/call-time-ledger.module.js') < html.indexOf('modules/call-coaching-bridge.module.js'));

    t.check('the ledger is built with the briefs', /buildCallTimeLedger\(transcript, associateName, analysis, bundle\)/.test(script));
    t.check('and handed to every brief', /buildMetricBrief\(metric, \{ effectiveness, alreadyGiven, timeLedger \}\)/.test(script));

    // The target moves year to year, so it comes off the metric bundle. A
    // budget measured against last year's goal is worse than none.
    t.check('the target is read rather than hardcoded',
        /allMetrics \|\| \[\]\)\.find\(metric => metric\.metricKey === 'aht'\)/.test(script));
    t.check('and no target means no ledger', /if \(!aht\) return null;/.test(script));

    // The analysis is passed in rather than recomputed, so the silence is
    // measured once and the panel and the ledger cannot disagree.
    t.check('the existing analysis is reused', /buildCallTimeLedger[\s\S]{0,900}analysis,\n\s+target: aht\.target/.test(script));

    t.check('both output paths name the call they measured',
        (script.match(/ledgerCallName: callMetricLedgerCallName/g) || []).length === 2);
    t.check('and it is cleared with the rest', /callMetricLedgerCallName = '';/.test(script));
});
