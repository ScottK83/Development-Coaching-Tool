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
    const pasted = at('id="callListeningCopilotSummary"');
    const verint = at('id="copyCallListeningVerintBtn"');
    const email = at('id="callCopilotEmailBtn"');
    const more = at('<details class="call-fold call-more"');

    t.check('everything was found', [transcript, flags, good, bad, copilot, pasted, verint, email, more].every((index) => index > -1));
    t.check('the paste box comes first', transcript < flags && transcript < good);
    t.check('the flags sit under the paste box, before the notes', flags < good);
    const grid = section.lastIndexOf('class="grid-2col"', good);
    t.check('good and bad sit side by side in one grid',
        grid > transcript && good < bad && !section.slice(grid, bad).includes('class="call-panel"'));
    // The order Scott works in: Copilot writes the summary, it is pasted back,
    // and both ways out work from it.
    t.check('the summary button comes straight after the notes', bad < copilot);
    t.check('then the box Copilot\'s summary is pasted into', copilot < pasted);
    t.check('then Verint and the email, which both use it', pasted < verint && pasted < email);
    t.check('and everything else comes after them', verint < more && email < more);
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
        'writeCallFeedbackEmailBtn', 'callListeningOutlookBody',
        'generateCallListeningOutlookBtn', 'callListeningHistoryList', 'showAllSavedCallsBtn',
        'summarizeCallInCopilotBtn', 'checkTranscriptPasteBtn', 'callListeningReference',
        'analyzeCallTranscriptBtn', 'clearCallTranscriptBtn', 'saveCallListeningBtn'
    ].forEach((id) => t.check(`${id} is under More`, more.includes(`id="${id}"`)));
});

suite('call listening layout: one way for Copilot to write the email', (t) => {
    const section = callListeningSection();
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    t.check('the old notes-based email prompt button is gone', !section.includes('id="generateCallListeningPromptBtn"'));
    t.check('and its box', !section.includes('id="callListeningPromptArea"'));
    t.check('and nothing binds it', !/generateCallListeningPromptAndCopy/.test(script));
    t.check('so the page does not wait for it before starting',
        !/!generatePromptBtn/.test(script));
});

suite('call listening layout: three buttons at rest', (t) => {
    const section = callListeningSection();
    const visible = visiblePart(section);

    // "Really still too many buttons" (2026-09-30), with five on the page.
    // Pasting reads the call and a new paste replaces the old one, so Read
    // Again and Clear went under More; the three that send a call somewhere
    // save it, so Save went too. The third is Copilot writing the email from
    // the summary, which replaced the app writing it ("I want copilot to
    // draft the email for me to send").
    const buttons = (visible.match(/<button\b/g) || []).length;
    const total = (section.match(/<button\b/g) || []).length;
    t.equal(`three buttons at rest (${buttons} of ${total})`, buttons, 3);

    [
        'callListeningTranscript', 'callListeningEmployeeSelect', 'callListeningDate', 'callFlagStrip',
        'callListeningStrengths', 'callListeningImprovements',
        'callCopilotSummaryBtn', 'callListeningCopilotSummary', 'copyCallListeningVerintBtn', 'callCopilotEmailBtn'
    ].forEach((id) => t.check(`${id} is on the page at rest`, visible.includes(`id="${id}"`)));

    ['writeCallFeedbackEmailBtn', 'callListeningOutlookBody',
        'callVerificationAlert', 'callExplanationPanel', 'analyzeCallTranscriptBtn',
        'clearCallTranscriptBtn', 'saveCallListeningBtn'
    ].forEach((id) => t.check(`${id} is not`, !visible.includes(`id="${id}"`)));
});

suite('call listening layout: no Clear needed to paste the next call', (t) => {
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');

    // A whole call pasted anywhere in a box that already holds one replaces
    // it. Otherwise, with Clear gone, the next call would land in the middle of
    // the last one.
    t.check('a paste is checked for being a whole call',
        /const replacesAll = !hadCall\s*\|\| \(field\.selectionStart === 0 && field\.selectionEnd === field\.value\.length\)\s*\|\| looksLikeWholeCall\(plain\);/.test(script));
    t.check('and the box is written with the new call alone',
        /else if \(replacesAll && plain\) \{[\s\S]{0,300}field\.value = correct\(plain\);/.test(script));

    // The test the paste handler uses, run for real.
    const start = script.indexOf('function looksLikeWholeCall(');
    const source = script.slice(start, script.indexOf('\n}\n', start) + 2);
    const looksLikeWholeCall = new Function(`${source}; return looksLikeWholeCall;`)();
    t.check('a Verint export is a whole call', looksLikeWholeCall('Date/Time:\n09/29/2026 10:14:05 AM\nDimes, Alyssa'));
    t.check('so are a few timestamped lines', looksLikeWholeCall('00:03\nthank you\n00:09\nhi\n00:14\nokay'));
    t.check('and a few labelled lines', looksLikeWholeCall('Agent: hi\nCustomer: hello\nAgent: how can i help'));
    t.check('a few words are an edit', !looksLikeWholeCall('budget billing'));
    t.check('and so is one line with a time in it', !looksLikeWholeCall('01:21\ni guarantee your bill'));
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
    // There is no Save button on the page, so a call is kept when it goes
    // somewhere, and the toast says so. See saved-calls for the once only rule.
    t.check('and keeps the call, saying so',
        /function writeCallSummaryInCopilot[\s\S]{0,900}keepCallOnTheWayOut\(\)[\s\S]{0,400}and the call saved/.test(script));

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
