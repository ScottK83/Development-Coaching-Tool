'use strict';

/**
 * Storing a call must not change what the call says.
 *
 * The 8000 character cap was set when these logs lived in localStorage under a
 * 5MB ceiling shared with everything else. They are on IndexedDB now, which
 * saveWithSizeCheck exempts from that cap, and they sync to R2, where object
 * size is not a constraint. The limit had outlived its reason.
 *
 * It was not a harmless trim. 8000 characters is roughly the first fifteen
 * minutes of speech, so on any longer call the close was deleted, and the
 * close is where the recap, the next steps, the courtesy close and the
 * customer's thank you live. On the sample export the saved copy lost four
 * strengths and invented two coaching points, because the "missing" branch of
 * those rules cannot tell "she never did it" from "the part where she did it
 * was cut off". The associate was coached for not setting next steps and not
 * closing the call, on a call where she did both.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const VERINT_EXPORT = fs.readFileSync(path.join(ROOT, 'tests', 'fixtures', 'verint-export.txt'), 'utf8');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/call-transcript.module.js');
    return global.window.DevCoachModules.callTranscript;
}

// Long enough to hit the ceiling, with a distinctive open and close.
function hugeCall() {
    const middle = Array.from({ length: 4000 }, (_, i) => {
        const stamp = `${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`;
        return `${stamp}\nokay let me check that for you and see what the account shows here`;
    }).join('\n');

    return [
        'Agent: Thank you for calling, my name is Jamie.',
        middle,
        'Agent: To recap, that is all sorted and you will receive an email within 24 hours. Is there anything else I can help with?',
        'Customer: No thank you so much, you have been very helpful.'
    ].join('\n');
}

suite('transcript storage: a real call is kept whole', (t) => {
    const T = load(t);

    const stored = T.prepareForStorage(VERINT_EXPORT);
    t.check('an 18 minute call is not trimmed at all', !/truncated/.test(stored));

    const full = T.analyzeTranscript(VERINT_EXPORT, { associateName: 'Alyssa Dimes' });
    const saved = T.analyzeTranscript(stored, { associateName: 'Alyssa Dimes' });

    const keys = (items) => (items || []).map(item => item.key).sort();
    t.equal('the saved copy finds the same strengths',
        keys(saved.allStrengths).join(','), keys(full.allStrengths).join(','));
    t.equal('and the same coaching points',
        keys(saved.allImprovements).join(','), keys(full.allImprovements).join(','));

    // positiveExperience reads Verint's speech categories, and the block they
    // arrive in is stripped as boilerplate, so they ride in the header.
    t.check('the Verint categories survive storage',
        T.extractMetadata(stored).categories.some(item => /advisor positive/i.test(item.name) && item.count > 0));
    t.check('so the category based strength survives',
        keys(saved.allStrengths).includes('positiveExperience'));
});

suite('transcript storage: the ceiling keeps both ends', (t) => {
    const T = load(t);
    const call = hugeCall();
    const stored = T.prepareForStorage(call);

    t.check('the call really was over the ceiling', call.length > stored.length);
    t.check('it is trimmed to the ceiling', stored.length <= T.MAX_STORED_TRANSCRIPT_CHARS);
    t.check('and says it was trimmed', /truncated for storage/.test(stored));

    // Cutting only the tail is what invented coaching, so both ends survive.
    t.check('the opening is kept', /Thank you for calling, my name is Jamie/.test(stored));
    t.check('the recap is kept', /To recap/.test(stored));
    t.check('the courtesy close is kept', /anything else I can help with/.test(stored));
    t.check('and the customer signing off', /you have been very helpful/.test(stored));
});

suite('transcript storage: a trimmed call claims nothing about what is missing', (t) => {
    const T = load(t);

    // The principle, independent of where the ceiling sits: absence proves
    // nothing when absence is what the trimming produced.
    const trimmed = [
        'Agent: Thank you for calling, my name is Jamie.',
        'Customer: My bill doubled and I want to know why.',
        '[transcript truncated for storage]'
    ].join('\n');

    const analysis = T.analyzeTranscript(trimmed, { associateName: 'Jamie' });
    t.check('the trimming is noticed', analysis.stats.truncated === true);

    const missingClaims = (analysis.allImprovements || [])
        .filter(item => ['recap', 'nextSteps', 'courtesyClose', 'empathy', 'verification', 'greeting'].includes(item.key));
    t.equal('nothing is reported as missing from the call', missingClaims.length, 0);

    // Talk share is a proportion of the whole call, so it cannot be measured
    // from part of one either.
    t.equal('talk share is not guessed at', analysis.stats.agentTalkShare, null);

    // And the supervisor is told why the read is quieter than usual.
    t.check('the summary says so', /trimmed, so nothing is reported as missing/.test(T.buildAnalysisSummary(analysis)));

    // What IS in the remaining text was genuinely said, so present tense
    // findings must still work.
    const stillFound = T.analyzeTranscript([
        'Agent: Thank you for calling, my name is Jamie.',
        'Agent: Unfortunately that is just our policy, there is nothing I can do.',
        '[transcript truncated for storage]'
    ].join('\n'), { associateName: 'Jamie' });
    t.check('a phrase that is present is still coached',
        (stillFound.allImprovements || []).some(item => item.key === 'deflection'));
    t.check('and a strength that is present is still credited',
        (stillFound.allStrengths || []).some(item => item.key === 'greeting'));
});

suite('transcript storage: the cut lands cleanly', (t) => {
    const T = load(t);
    const stored = T.prepareForStorage(hugeCall());

    // A bare "04:30" with nothing under it, or speech with no stamp over it,
    // reads as a turn that never happened.
    const lines = stored.split('\n').filter(Boolean);
    const markerIndex = lines.findIndex(line => /truncated for storage/.test(line));
    t.check('the marker is on its own line', markerIndex > 0);

    const before = lines[markerIndex - 1];
    const after = lines[markerIndex + 1];
    t.check('the line before the cut is complete', !/^\d{1,3}:[0-5]\d$/.test(before));
    t.check('the line after the cut is a timestamp or speech', Boolean(after && after.trim()));
});
