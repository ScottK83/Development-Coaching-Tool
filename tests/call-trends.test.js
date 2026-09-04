'use strict';

const fs = require('fs');
const path = require('path');
const { suite } = require('./harness');

// The counting lives in callCoachingBridge now, which scores this history once
// for the metric chips and the trends panel together. call-trends keeps the
// wording. `summarize` stands in for the old callTrends.summarizeHistory so
// these tests still say what they always said.
function load(t) {
    t.installFakeBrowser();
    global.window.METRICS_REGISTRY = {};
    global.getMetricTips = () => [];
    t.loadModule('modules/sentiment.module.js');
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-qa.module.js');
    t.loadModule('modules/call-word-choice.module.js');
    t.loadModule('modules/call-coaching-bridge.module.js');
    const mods = t.loadModule('modules/call-trends.module.js');

    return {
        callTrends: mods.callTrends,
        summarize: (history, options) => mods.callCoachingBridge.collectFindings({
            associateName: 'Alyssa Dimes',
            history,
            ...(options || {})
        })
    };
}

/**
 * Every fixture call has to be a different call.
 *
 * The bridge identifies a call by what was said on it, because the same
 * transcript saved twice under two dates is one conversation and counting it
 * as two made the coaching claim a pattern that was not there. So these carry
 * a line naming the date: three copies of one transcript would collapse to a
 * single call, which is correct behaviour and useless as a fixture.
 */

// A call that closes badly: no recap, no next steps, nothing offered at the end.
function weakCall(date) {
    return {
        employeeName: 'Alyssa Dimes',
        listenedOn: date,
        transcript: [
            `Agent: What is the account number, this is the call from ${date}.`,
            'Customer: My bill doubled and I was charged twice.',
            'Agent: That is just our policy, you will have to call the billing team.'
        ].join('\n')
    };
}

// A call that closes properly: verified, recapped, next steps, offer of more.
function strongCall(date) {
    return {
        employeeName: 'Alyssa Dimes',
        listenedOn: date,
        transcript: [
            `Agent: Thank you for calling, my name is Alyssa, this is the call from ${date}.`,
            'Customer: My bill doubled this month and I do not understand why.',
            'Agent: I completely understand how frustrating that is.',
            'Agent: Before I pull it up, can you confirm your date of birth for verification?',
            'Customer: Sure, it is May 4th 1983.',
            'Agent: I found a duplicate charge and I have credited it back.',
            'Agent: To recap, the duplicate charge is reversed and you will see it within 3 business days.',
            'Agent: Is there anything else I can help with?',
            'Customer: No, thank you so much, you have been very helpful.'
        ].join('\n')
    };
}

suite('call trends: reads history as a set', (t) => {
    const { callTrends, summarize } = load(t);

    const summary = summarize([weakCall('2026-07-01'), weakCall('2026-07-08'), weakCall('2026-07-15')]);

    t.check('scores every call with a transcript', summary.ok === true);
    t.equal('counts the calls reviewed', summary.callsReviewed, 3);

    const themes = summary.repeatCoaching.map((item) => item.label);
    t.check('spots the repeated dead end language', themes.includes('deflection'));
    t.check('spots the repeated missing recap', themes.includes('recap'));
    t.check('records which calls it happened on',
        summary.repeatCoaching[0].dates.length === 3);

    const qaThemes = summary.repeatOpportunities.map((item) => item.label);
    t.check('spots the repeat QA opportunity', qaThemes.includes('Offering Assistance'));

    // One occurrence is a call, not a pattern.
    const single = summarize([weakCall('2026-07-01'), strongCall('2026-07-08')]);
    t.check('does not call a single occurrence a trend',
        single.repeatCoaching.every((item) => item.count >= 2));
});

suite('call trends: consistency is reported too', (t) => {
    const { callTrends, summarize } = load(t);
    const summary = summarize([strongCall('2026-07-01'), strongCall('2026-07-08')]);

    const strengths = summary.consistentStrengths.map((item) => item.label);
    t.check('spots the consistent recap', strengths.includes('recap'));
    t.check('spots the consistent verification', strengths.includes('verification'));

    const text = callTrends.buildTrendText(summary, 'Alyssa');
    t.check('names the associate', /Across Alyssa's recent calls/.test(text));
    t.check('says it is a habit, not a one off', /habit, not a one off/.test(text));
    t.check('avoids em dashes', !text.includes('—'));
});

suite('call trends: window and missing transcripts', (t) => {
    const { callTrends, summarize } = load(t);

    // Twelve distinct calls, so nothing is deduplicated as the same call, and
    // the window still caps how many are read.
    const many = Array.from({ length: 12 }, (_, i) => ({
        employeeName: 'Alyssa Dimes',
        listenedOn: `2026-07-${String(i + 1).padStart(2, '0')}`,
        transcript: `${weakCall('x').transcript}\nAgent: Reference number ${i} for this one.`
    }));
    const summary = summarize(many);
    t.equal('respects the window', summary.callsReviewed, 8);
    t.check('counts against the window, not all history',
        summary.repeatCoaching[0].count <= 8);

    // Storage order must not decide which calls count as recent.
    const oldest = weakCall('2026-01-01');
    const newest = strongCall('2026-07-31');
    const newestFirst = summarize([newest, oldest]);
    const oldestFirst = summarize([oldest, newest]);
    t.equal('same result whichever order the caller passes',
        JSON.stringify(newestFirst.consistentStrengths),
        JSON.stringify(oldestFirst.consistentStrengths));

    // Logs saved before transcripts existed are reported, not silently dropped.
    const mixed = summarize([
        weakCall('2026-07-01'),
        weakCall('2026-07-08'),
        { employeeName: 'Alyssa Dimes', listenedOn: '2026-06-01', whatWentWell: 'typed by hand' }
    ]);
    t.equal('counts what it could score', mixed.callsReviewed, 2);
    t.equal('and says what it could not', mixed.callsWithoutTranscript, 1);

    const empty = summarize([]);
    t.check('no history is not a trend', empty.ok === false);
    t.equal('and produces no text', callTrends.buildTrendText(empty, 'Alyssa'), '');
});

suite('call trends: rendering', (t) => {
    const { callTrends, summarize } = load(t);
    const summary = summarize([weakCall('2026-07-01'), weakCall('2026-07-08')]);
    const html = callTrends.buildTrendHtml(summary, (value) => String(value || '').replace(/</g, '&lt;'));

    t.check('groups repeat themes', /call-trend-warn/.test(html));
    t.check('reads in plain language, not rule keys', /dead end language/.test(html));
    t.check('shows the dates it happened', /2026-07-01/.test(html));
    t.check('styles from theme tokens, not hex', !/#[0-9a-fA-F]{6}/.test(html));

    const injected = summarize([
        { employeeName: 'A', listenedOn: '<img src=x>', transcript: weakCall('x').transcript },
        { employeeName: 'A', listenedOn: '<img src=y>', transcript: weakCall('y').transcript }
    ]);
    const escaped = callTrends.buildTrendHtml(injected, (value) => String(value || '').replace(/</g, '&lt;'));
    t.check('passes dates through the escaper', !/<img/.test(escaped));
});
