'use strict';

const fs = require('fs');
const path = require('path');
const { suite } = require('./harness');

const VERINT_EXPORT = fs.readFileSync(path.join(__dirname, 'fixtures', 'verint-export.txt'), 'utf8');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/call-transcript.module.js');
    t.loadModule('modules/call-qa.module.js');
    return t.loadModule('modules/call-trends.module.js');
}

// A call that closes badly: no recap, no next steps, nothing offered at the end.
function weakCall(date) {
    return {
        employeeName: 'Alyssa Dimes',
        listenedOn: date,
        transcript: [
            'Agent: What is the account number?',
            'Customer: My bill doubled and I was charged twice.',
            'Agent: That is just our policy, you will have to call the billing team.'
        ].join('\n')
    };
}

function strongCall(date) {
    return { employeeName: 'Alyssa Dimes', listenedOn: date, transcript: VERINT_EXPORT };
}

suite('call trends: reads history as a set', (t) => {
    const { callTrends } = load(t);

    const summary = callTrends.summarizeHistory([weakCall('2026-07-01'), weakCall('2026-07-08'), weakCall('2026-07-15')]);

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
    const single = callTrends.summarizeHistory([weakCall('2026-07-01'), strongCall('2026-07-08')]);
    t.check('does not call a single occurrence a trend',
        single.repeatCoaching.every((item) => item.count >= 2));
});

suite('call trends: consistency is reported too', (t) => {
    const { callTrends } = load(t);
    const summary = callTrends.summarizeHistory([strongCall('2026-07-01'), strongCall('2026-07-08')]);

    const strengths = summary.consistentStrengths.map((item) => item.label);
    t.check('spots the consistent recap', strengths.includes('recap'));
    t.check('spots the consistent verification', strengths.includes('verification'));

    const text = callTrends.buildTrendText(summary, 'Alyssa');
    t.check('names the associate', /Across Alyssa's recent calls/.test(text));
    t.check('says it is a habit, not a one off', /habit, not a one off/.test(text));
    t.check('avoids em dashes', !text.includes('—'));
});

suite('call trends: window and missing transcripts', (t) => {
    const { callTrends } = load(t);

    const many = Array.from({ length: 12 }, (_, i) => weakCall(`2026-07-${String(i + 1).padStart(2, '0')}`));
    const summary = callTrends.summarizeHistory(many, { windowSize: 5 });
    t.equal('respects the window', summary.callsReviewed, 5);
    t.check('counts against the window, not all history',
        summary.repeatCoaching[0].count <= 5);

    // Storage order must not decide which calls count as recent.
    const oldest = weakCall('2026-01-01');
    const newest = strongCall('2026-07-31');
    const newestFirst = callTrends.summarizeHistory([newest, oldest], { windowSize: 1 });
    const oldestFirst = callTrends.summarizeHistory([oldest, newest], { windowSize: 1 });
    t.equal('same result whichever order the caller passes',
        JSON.stringify(newestFirst.consistentStrengths),
        JSON.stringify(oldestFirst.consistentStrengths));
    t.check('and it picked the newest call', newestFirst.callsReviewed === 1);

    // Logs saved before transcripts existed are reported, not silently dropped.
    const mixed = callTrends.summarizeHistory([
        weakCall('2026-07-01'),
        weakCall('2026-07-08'),
        { employeeName: 'Alyssa Dimes', listenedOn: '2026-06-01', whatWentWell: 'typed by hand' }
    ]);
    t.equal('counts what it could score', mixed.callsReviewed, 2);
    t.equal('and says what it could not', mixed.callsWithoutTranscript, 1);

    const empty = callTrends.summarizeHistory([]);
    t.check('no history is not a trend', empty.ok === false);
    t.equal('and produces no text', callTrends.buildTrendText(empty, 'Alyssa'), '');
});

suite('call trends: rendering', (t) => {
    const { callTrends } = load(t);
    const summary = callTrends.summarizeHistory([weakCall('2026-07-01'), weakCall('2026-07-08')]);
    const html = callTrends.buildTrendHtml(summary, (value) => String(value || '').replace(/</g, '&lt;'));

    t.check('groups repeat themes', /call-trend-warn/.test(html));
    t.check('reads in plain language, not rule keys', /dead end language/.test(html));
    t.check('shows the dates it happened', /2026-07-01/.test(html));
    t.check('styles from theme tokens, not hex', !/#[0-9a-fA-F]{6}/.test(html));

    const injected = callTrends.summarizeHistory([
        { employeeName: 'A', listenedOn: '<img src=x>', transcript: weakCall('x').transcript },
        { employeeName: 'A', listenedOn: '<img src=y>', transcript: weakCall('y').transcript }
    ]);
    const escaped = callTrends.buildTrendHtml(injected, (value) => String(value || '').replace(/</g, '&lt;'));
    t.check('passes dates through the escaper', !/<img/.test(escaped));
});
