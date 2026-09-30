'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * WHAT IS ON THE CALLS PAGE
 *
 * Paste, good and bad, Copilot, Verint. That is the job in Scott's words
 * (2026-09-30), and "there's too much here" was his verdict on the page that
 * did more: an email flow, a Copilot email prompt, three folded reads, a
 * verification box, a red flag box, an explanation box and a recap, all on
 * the way from the paste to the thing he came to do.
 *
 * Everything else sits in one closed fold at the bottom. Nothing was removed:
 * the history, the saved calls, the QA form and the email all still have
 * their uses. They are just not in the way.
 *
 * The version of this file before it pinned the email to the associate as the
 * main job. It stopped being the main job, so these pin the new order.
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

// The outermost folds, whole, so what is inside one can be told apart from
// what is on the page at rest.
function outermostFolds(section) {
    const blocks = [];
    const open = /<details class="call-fold[^"]*"[^>]*>/g;
    let match;
    let consumedTo = 0;
    while ((match = open.exec(section))) {
        if (match.index < consumedTo) continue;
        let depth = 0;
        const tag = /<(\/?)details\b[^>]*>/g;
        tag.lastIndex = match.index;
        let inner;
        while ((inner = tag.exec(section))) {
            depth += inner[1] ? -1 : 1;
            if (depth === 0) {
                blocks.push(section.slice(match.index, tag.lastIndex));
                consumedTo = tag.lastIndex;
                break;
            }
        }
    }
    return blocks;
}

function visiblePart(section) {
    let visible = section;
    outermostFolds(section).forEach((block) => { visible = visible.replace(block, ''); });
    return visible;
}

suite('call listening layout: paste, good and bad, then Copilot and Verint', (t) => {
    const section = callListeningSection();
    const at = (needle) => section.indexOf(needle);

    const transcript = at('id="callListeningTranscript"');
    const flags = at('id="callFlagStrip"');
    const good = at('id="callListeningStrengths"');
    const bad = at('id="callListeningImprovements"');
    const copilot = at('id="callCopilotSummaryBtn"');
    const verint = at('id="copyCallListeningVerintBtn"');
    const more = at('<details class="call-fold call-more"');

    t.check('everything was found', [transcript, flags, good, bad, copilot, verint, more].every((index) => index > -1));
    t.check('the paste box comes first', transcript < flags && transcript < good);
    t.check('the flags sit under the paste box, before the notes', flags < good);
    const grid = section.lastIndexOf('class="grid-2col"', good);
    t.check('good and bad sit side by side in one grid',
        grid > transcript && good < bad && !section.slice(grid, bad).includes('class="call-panel"'));
    t.check('Copilot and Verint come straight after the notes', bad < copilot && bad < verint);
    t.check('and everything else comes after them', copilot < more && verint < more);
});

suite('call listening layout: everything else is in one closed fold', (t) => {
    const section = callListeningSection();
    const folds = outermostFolds(section);
    const more = folds.find((block) => block.startsWith('<details class="call-fold call-more"')) || '';

    t.check('there is a More fold', Boolean(more));
    t.check('and it starts closed', !/<details class="call-fold call-more"[^>]*\sopen/.test(section));

    [
        'callTranscriptAnalysisSummary', 'callVerificationAlert', 'callRedFlagsAlert', 'callExplanationPanel',
        'callSummaryPanel', 'callQaPanel', 'callMetricCoachPanel', 'callWordChoicePanel',
        'writeCallFeedbackEmailBtn', 'generateCallListeningPromptBtn', 'callListeningOutlookBody',
        'generateCallListeningOutlookBtn', 'callListeningHistoryList', 'showAllSavedCallsBtn',
        'summarizeCallInCopilotBtn', 'checkTranscriptPasteBtn', 'callListeningReference'
    ].forEach((id) => t.check(`${id} is under More`, more.includes(`id="${id}"`)));
});

suite('call listening layout: little in the way at rest', (t) => {
    const section = callListeningSection();
    const visible = visiblePart(section);

    const buttons = (visible.match(/<button\b/g) || []).length;
    const total = (section.match(/<button\b/g) || []).length;
    t.check(`five buttons or so at rest (${buttons} of ${total})`, buttons <= 6 && buttons < total);

    [
        'callListeningTranscript', 'callListeningEmployeeSelect', 'callListeningDate', 'callFlagStrip',
        'callListeningStrengths', 'callListeningImprovements',
        'callCopilotSummaryBtn', 'copyCallListeningVerintBtn', 'saveCallListeningBtn'
    ].forEach((id) => t.check(`${id} is on the page at rest`, visible.includes(`id="${id}"`)));

    ['writeCallFeedbackEmailBtn', 'callListeningOutlookBody', 'generateCallListeningPromptBtn',
        'callVerificationAlert', 'callExplanationPanel'
    ].forEach((id) => t.check(`${id} is not`, !visible.includes(`id="${id}"`)));
});

suite('call listening layout: what inflates on a read is folded', (t) => {
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

suite('call listening layout: the buttons do what they say', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    t.check('the Copilot button is bound',
        /bindElementOnce\(document\.getElementById\('callCopilotSummaryBtn'\), 'click', writeCallSummaryInCopilot\)/.test(script));
    t.check('it builds the coaching summary prompt',
        /function writeCallSummaryInCopilot[\s\S]{0,400}buildCoachingSummaryPrompt/.test(script));
    // Reading the form is not a decision to keep it.
    t.check('and saves nothing',
        /function writeCallSummaryInCopilot\(\) \{\s*const entry = buildUnsavedCallListeningEntry\(\);/.test(script));

    t.check('Copy For Verint is still the Verint copy',
        /bindElementOnce\(copyVerintBtn, 'click', \(\) => copyCallListeningVerintSummary\(\)\)/.test(script));

    // Short enough to paste: no QA checklist, no language read, no "N/A"
    // under every empty field, no private notes on tone.
    const verint = script.slice(script.indexOf('function buildCallListeningVerintSummary'),
        script.indexOf('function copyCallListeningVerintSummary'));
    t.check('the Verint summary was found', verint.length > 100);
    t.check('it carries no QA checklist', !/buildQaText|scoreCallListeningQa/.test(verint));
    t.check('nor the language read', !/buildWordChoiceText|scanCallListeningWordChoice/.test(verint));
    t.check('nor the manager notes', !/managerNotes/.test(verint));
    t.check('nor N/A filler', !/'N\/A'/.test(verint));
    t.check('it leads with the red flags', /buildCallListeningRedFlagLines\(entry\)/.test(verint));

    t.check('the flag strip is drawn on every read', /renderCallFlagStrip\(analysis\)/.test(script));
    t.check('and taken down with the rest', /'callTranscriptAnalysisSummary', 'callFlagStrip'/.test(script));
});
