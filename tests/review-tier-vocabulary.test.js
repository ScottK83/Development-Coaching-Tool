/**
 * Associates do not know about the 1/2/3 tier system, and the review documents
 * they read must not teach them.
 *
 * The tiers are a manager-facing, year-end-internal scale. Two prompts write
 * text that goes into an associate's review, and both used to hand the model
 * the vocabulary: Year-End stated "Performance classification: Off Track." and
 * then, in so many words, asked it to "mention whether performance is on track
 * or off track naturally". Mid-Year's manual override said "I am marking them
 * as OFF TRACK". A model given those will paraphrase them into the first line.
 *
 * The standing still sets the tone. It just no longer arrives as a grade.
 */
const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

// Words that name the internal scale. "on track" is included because the
// Year-End prompt used to request it by name.
const TIER_WORDS = [/off[- ]track/i, /on[- ]track/i, /\bexceptional\b/i,
    /performance classification/i, /\bsuccessful\b/i, /\btier\b/i, /score\s*[123]\b/i];

function offending(text) {
    return TIER_WORDS.filter((re) => re.test(String(text))).map(String);
}

suite('year-end prompt: standing arrives as tone, not as a grade', (t) => {
    t.installFakeBrowser();
    const ye = t.loadModule('modules/year-end.module.js').yearEnd;

    const inputData = {
        employeeName: 'Dana Example', reviewYear: 2026,
        positivesText: '- Steady on adherence.', improvementsText: '- Handle time needs work.',
        managerContext: ''
    };
    const support = { fallbackPositives: '', fallbackImprovements: '', annualMetText: '', annualNotMetText: '' };

    ['Off Track', 'On Track/Successful', 'On Track/Exceptional'].forEach((label) => {
        const prompt = ye.buildCopilotPrompt(inputData, support, {
            preferredName: 'Dana', trackLabel: label,
            periodLabel: 'p', sourceLabel: 's', targetProfileLabel: 't'
        });
        t.equal('no tier vocabulary for ' + label, offending(prompt).join(', ') || '(none)', '(none)');
        t.check('but the tone is still set for ' + label, /Tone for this review:/.test(prompt));
    });

    // The three standings must not all produce the same letter.
    const p = (label) => ye.buildCopilotPrompt(inputData, support,
        { preferredName: 'Dana', trackLabel: label, periodLabel: 'p', sourceLabel: 's', targetProfileLabel: 't' });
    t.check('off track reads differently from exceptional',
        p('Off Track') !== p('On Track/Exceptional'));
    t.check('off track is the direct one', /fell short/.test(p('Off Track')));
    t.check('exceptional is the recognising one', /strong year/.test(p('On Track/Exceptional')));
});

suite('mid-year and check-in prompts carry no tier vocabulary', (t) => {
    // Source-level, because both builders read live DOM and stores that a unit
    // test cannot stand up honestly. What is checked is the literal text the
    // prompts are assembled from.
    const src = fs.readFileSync(path.join(ROOT, 'modules/on-off-tracker.module.js'), 'utf8')
        .replace(/\r\n/g, '\n');

    // Only lines that append to a prompt. UI text is manager-facing and fine.
    const promptLines = src.split('\n').filter((l) => l.indexOf('prompt +=') !== -1);
    t.check('there are prompt lines to check', promptLines.length > 10);

    const bad = promptLines.filter((l) => /OFF TRACK|ON TRACK|away from exceptional/.test(l));
    t.equal('no prompt line names the tier scale', bad.join(' | ') || '(none)', '(none)');

    // The phrasing that broke a standing rule is not built anywhere any more,
    // so no caller has to remember to suppress it. Comments are excluded:
    // explaining why a phrase is banned should not itself trip the check.
    const codeOnly = src.split('\n')
        .filter((l) => {
            const t2 = l.trim();
            return t2.indexOf('//') !== 0 && t2.indexOf('*') !== 0;
        })
        .join('\n');
    t.check('the "away from exceptional" sentence is not constructed',
        codeOnly.indexOf('away from exceptional') === -1);
});
