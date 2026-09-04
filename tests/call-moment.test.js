'use strict';

/**
 * Feedback has to say which call it is about.
 *
 * An associate takes dozens of calls a week, so "your handle time was long"
 * is an opinion they cannot check, while "the call you took at 12:38 on
 * Tuesday" is something they can go and remember.
 *
 * The time was being lost. prepareForStorage rewrites the Verint header into a
 * bracketed summary that extractMetadata cannot read back, so the moment a log
 * was saved its call time and length were gone, and every prompt built from a
 * saved entry had only a bare ISO date.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const VERINT_EXPORT = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'verint-export.txt'), 'utf8');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-qa.module.js');
    t.loadModule('modules/call-listening.module.js');
    return global.window.DevCoachModules;
}

suite('call moment: tidying a Verint time', (t) => {
    const { callTranscript } = load(t);
    const tidy = callTranscript.tidyCallTime;

    t.equal('seconds are dropped', tidy('12:38:26 PM'), '12:38 PM');
    t.equal('a leading zero is dropped', tidy('09:05:00 AM'), '9:05 AM');
    t.equal('dotted meridiems are cleaned', tidy('1:07 p.m.'), '1:07 PM');
    t.equal('an already clean time is untouched', tidy('12:38 PM'), '12:38 PM');
    t.equal('a 24 hour time survives', tidy('14:20'), '14:20');
    t.equal('nothing in, nothing out', tidy(''), '');
    // Anything unrecognised is passed through rather than mangled into a lie.
    t.equal('an odd value is left alone', tidy('midday'), 'MIDDAY');
});

suite('call moment: saying when the call was', (t) => {
    const { callTranscript } = load(t);
    const format = callTranscript.formatCallMoment;

    t.equal('day and time read naturally', format('2026-08-04', '12:38:26 PM'), 'Tuesday, August 4 at 12:38 PM');
    t.equal('a date alone still names the day', format('2026-08-04', ''), 'Tuesday, August 4');
    t.equal('a time alone is better than nothing', format('', '12:38 PM'), '12:38 PM');
    t.equal('neither yields nothing', format('', ''), '');

    // "2026-08-04" handed to Date() alone is parsed as UTC and renders as the
    // 3rd for anybody west of Greenwich, which is everybody here.
    t.check('the date does not slip a day', !format('2026-08-04', '').includes('August 3'));
    t.check('and neither does the weekday', format('2026-08-04', '').startsWith('Tuesday'));

    // A non-ISO date is shown as given rather than guessed at.
    t.equal('an unparseable date passes through', format('Week of 8/4', ''), 'Week of 8/4');
});

suite('call moment: it survives being saved', (t) => {
    const { callTranscript, callListening } = load(t);

    const meta = callTranscript.extractMetadata(VERINT_EXPORT);
    t.equal('the export carries a time', meta.callTime, '12:38:26 PM');

    // The regression: after prepareForStorage the header no longer parses, so
    // nothing downstream can recover the time from the transcript.
    const stored = callTranscript.prepareForStorage(VERINT_EXPORT);
    t.equal('a stored transcript no longer carries it', callTranscript.extractMetadata(stored).callTime, '');

    // Which is why the entry has to hold it as a field of its own.
    const entry = {
        listenedOn: '2026-08-04',
        callTime: callTranscript.tidyCallTime(meta.callTime),
        transcript: stored,
        employeeName: 'Alyssa Dimes'
    };
    t.equal('the entry still knows when the call was',
        callListening.describeCallMoment(entry), 'Tuesday, August 4 at 12:38 PM');

    // An older log saved before the field existed must still say something.
    t.equal('a legacy entry falls back to the date',
        callListening.describeCallMoment({ listenedOn: '2026-08-04' }), 'Tuesday, August 4');
    t.equal('an entry with nothing does not throw',
        callListening.describeCallMoment({}), '');
});

suite('call moment: the message is told to say it', (t) => {
    const { callListening } = load(t);

    const entry = {
        employeeName: 'Alyssa Dimes',
        listenedOn: '2026-08-04',
        callTime: '12:38 PM',
        callReference: 'INT-4471',
        transcript: 'Agent: Thank you for calling, my name is Alyssa.',
        whatWentWell: '- Clean open',
        improvementAreas: '- Long hold'
    };

    const prompt = callListening.buildPrompt(entry, 'Alyssa');

    t.check('the call is named in the details', prompt.includes('Call taken: Tuesday, August 4 at 12:38 PM'));
    t.check('and stating it is a requirement, not a suggestion',
        /Say which call this is about in the opening line, by day and time: Tuesday, August 4 at 12:38 PM/.test(prompt));
    t.check('with wording guidance so it lands naturally', prompt.includes('the call you took on Tuesday, August 4 at 12:38 PM'));
    t.check('no em dashes in the prompt', !/[—–]/.test(prompt));

    // With no time known it must still name the day rather than say nothing.
    const dateOnly = callListening.buildPrompt({ ...entry, callTime: '' }, 'Alyssa');
    t.check('a date only call is still named', /by day and time: Tuesday, August 4/.test(dateOnly));

    // And with neither, the requirement is dropped rather than left dangling.
    const noMoment = callListening.buildPrompt({ ...entry, listenedOn: '', callTime: '' }, 'Alyssa');
    t.check('no date means no dangling instruction', !noMoment.includes('Say which call this is about'));
});

suite('call moment: the metric prompt names its calls', (t) => {
    t.installFakeBrowser();
    global.getMetricTips = () => ['Narrate what you are checking'];
    global.window.METRICS_REGISTRY = { aht: { label: 'Average Handle Time' } };
    global.window.formatMetricDisplay = (key, value) => String(value);
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-word-choice.module.js');
    t.loadModule('modules/call-coaching-bridge.module.js');
    const bridge = global.window.DevCoachModules.callCoachingBridge;

    const brief = {
        metricKey: 'aht',
        label: 'Average Handle Time',
        headline: 'Average Handle Time: 512 against a target of 426',
        evidence: [{ key: 'stalling', text: 'Silence fillers.', quote: 'One moment', appearsOn: 'on 2 of the last 3 calls', count: 2, weight: 5, phrase: '' }],
        tips: []
    };

    const moments = ['Tuesday, August 4 at 12:38 PM', 'Friday, July 31 at 9:15 AM', 'Monday, July 27 at 2:04 PM'];
    const prompt = bridge.buildMetricPrompt(brief, { preferredName: 'Esther', callMoments: moments });

    t.check('every call is listed', moments.every(moment => prompt.includes(`- ${moment}`)));
    t.check('the list says which order it is in', prompt.includes('most recent first'));
    t.check('naming them is a requirement', prompt.includes('Name the calls this comes from by day and time'));
    t.check('the most recent leads', prompt.includes('Lead with the most recent, Tuesday, August 4 at 12:38 PM'));
    t.check('and it says how many were reviewed', prompt.includes('went back over 3 of her calls'));

    // One call should not claim a pattern across several.
    const single = bridge.buildMetricPrompt(brief, { preferredName: 'Esther', callMoments: [moments[0]] });
    t.check('a single call is still named', single.includes('Lead with the most recent, Tuesday, August 4 at 12:38 PM'));
    t.check('but no plural claim is made', !single.includes('went back over'));

    const none = bridge.buildMetricPrompt(brief, { preferredName: 'Esther' });
    t.check('no moments means no dangling instruction', !none.includes('Name the calls this comes from'));
});

suite('call moment: wiring', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    t.check('there is a call time field', html.includes('id="callListeningTime"'));
    t.check('it is captured on the draft', /callTime: \(document\.getElementById\('callListeningTime'\)/.test(script));
    t.check('it is filled from a Verint paste', /callListeningTime[\s\S]{0,300}tidyCallTime/.test(script));
    t.check('it is restored when a log is loaded', script.includes("setValue('callListeningTime', entry.callTime)"));
    t.check('a changed time counts as a different call',
        /existingEntry\.callTime \|\| ''\) === draft\.callTime/.test(script));
    t.check('the Verint note carries it', script.includes('Call Taken: ${moment}'));
    t.check('the metric prompt is given the moments', script.includes('callMoments: callMetricCallMoments'));
});
