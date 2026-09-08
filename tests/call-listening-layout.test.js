'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * WHAT IS IN THE WAY ON THE CALL LISTENING SCREEN
 *
 * The screen carried 28 controls and 5 of them were on the path to the thing
 * it exists for, which is emailing an associate about a call.
 *
 * The worst of it was the ordering. Three panels sat between the transcript
 * and the feedback boxes, and all three inflate on Analyze, so pressing the
 * main button pushed the send box three panels further down the page at the
 * exact moment it was wanted. The most important click moved furthest away
 * the moment you were ready to make it.
 *
 * They are below the email now, folded shut, with a count in the summary so a
 * closed panel still says whether it is worth opening.
 */

function callListeningSection() {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const start = html.indexOf('<div id="subSectionCallListening"');
    let depth = 0;
    let end = html.length;
    const tag = /<(\/?)div\b[^>]*>/g;
    tag.lastIndex = start;
    let match;
    while ((match = tag.exec(html))) {
        depth += match[1] ? -1 : 1;
        if (depth === 0) { end = tag.lastIndex; break; }
    }
    return html.slice(start, end);
}

suite('call listening layout: the email comes before the reading', (t) => {
    const section = callListeningSection();

    const at = (needle) => section.indexOf(needle);
    const transcript = at('id="callListeningTranscript"');
    const feedback = at('id="callListeningStrengths"');
    const writeBtn = at('id="writeCallFeedbackEmailBtn"');
    const sendBox = at('id="callListeningOutlookBody"');
    const qa = at('id="callQaPanel"');
    const metric = at('id="callMetricCoachPanel"');
    const language = at('id="callWordChoicePanel"');

    t.check('everything was found', [transcript, feedback, writeBtn, sendBox, qa, metric, language]
        .every((index) => index > -1));

    t.check('transcript comes before the feedback boxes', transcript < feedback);
    t.check('the feedback boxes come before the write button', feedback < writeBtn);
    t.check('and the write button comes before the send box', writeBtn < sendBox);

    // The three that inflate on Analyze. All of them below the send box now.
    t.check('the QA read is below the email', qa > sendBox);
    t.check('the metric read is below the email', metric > sendBox);
    t.check('the language read is below the email', language > sendBox);
});

suite('call listening layout: what inflates on Analyze is folded', (t) => {
    const section = callListeningSection();

    ['callQaPanel', 'callMetricCoachPanel', 'callWordChoicePanel'].forEach((id) => {
        const start = section.indexOf(`id="${id}"`);
        const body = section.slice(start, start + 900);
        t.check(`${id} is folded shut`, /<details class="call-fold">/.test(body));
        t.check(`${id} does not open itself`, !/<details class="call-fold" open/.test(body));
    });

    // A fold that does not say what is inside is a fold nobody opens, so each
    // summary has somewhere for the count to land.
    ['callQaCount', 'callMetricCount', 'callWordChoiceCount'].forEach((id) => {
        t.check(`${id} has a place in the summary`, section.includes(`id="${id}"`));
    });

    // The JS toggles display on the outer div. Wrapping the content rather
    // than replacing the div is what keeps that working untouched.
    ['callQaPanel', 'callMetricCoachPanel', 'callWordChoicePanel'].forEach((id) => {
        t.check(`${id} is still a div the render can show and hide`,
            new RegExp(`<div id="${id}"[^>]*style="display: none;"`).test(section));
    });
});

suite('call listening layout: the counts are filled in', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    t.check('there is one helper for it', /function setCallFoldCount\(/.test(script));
    ['callQaCount', 'callMetricCount', 'callWordChoiceCount'].forEach((id) => {
        t.check(`${id} is written`, script.includes(`setCallFoldCount('${id}'`));
    });

    // A panel that hides itself has to clear its count too, or a fold that is
    // not showing leaves a number behind from the previous call.
    t.check('the QA count is cleared when the panel hides',
        /setCallFoldCount\('callQaCount', ''\)/.test(script));
    t.check('and so is the language count',
        /setCallFoldCount\('callWordChoiceCount', ''\)/.test(script));
    t.check('and the metric count',
        /setCallFoldCount\('callMetricCount', ''\)/.test(script));
});

suite('call listening layout: fewer controls in the way at rest', (t) => {
    const section = callListeningSection();

    // What is behind a fold is not in the way. Counting what a supervisor
    // actually sees on arrival is the number that matters.
    const folded = [];
    const foldRe = /<details class="call-fold"[^>]*>/g;
    let match;
    while ((match = foldRe.exec(section))) {
        let depth = 0;
        const tag = /<(\/?)details\b[^>]*>/g;
        tag.lastIndex = match.index;
        let inner;
        while ((inner = tag.exec(section))) {
            depth += inner[1] ? -1 : 1;
            if (depth === 0) { folded.push(section.slice(match.index, tag.lastIndex)); break; }
        }
    }
    t.check('there are folds', folded.length >= 5);

    let visible = section;
    folded.forEach((block) => { visible = visible.replace(block, ''); });

    const count = (text, pattern) => (text.match(pattern) || []).length;
    const visibleButtons = count(visible, /<button\b/g);
    const totalButtons = count(section, /<button\b/g);

    t.check(`buttons in the way dropped (${visibleButtons} of ${totalButtons})`,
        visibleButtons <= 8 && visibleButtons < totalButtons);

    // The five that are actually on the path have to be among the visible ones.
    ['callListeningEmployeeSelect', 'callListeningDate', 'callListeningTranscript',
        'analyzeCallTranscriptBtn', 'writeCallFeedbackEmailBtn',
        'callListeningOutlookBody', 'generateCallListeningOutlookBtn'
    ].forEach((id) => {
        t.check(`${id} is not hidden behind a fold`, visible.includes(`id="${id}"`));
    });

    // And the Copilot round trip is opt in now rather than the default path.
    t.check('the Copilot prompt is behind a fold',
        !visible.includes('id="generateCallListeningPromptBtn"'));
});
