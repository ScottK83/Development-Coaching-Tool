'use strict';

/**
 * Three things that were built but not reachable or not finished:
 *
 *   - the scored phrase editor sat in a div no nav list named, so the lists
 *     were editable in every respect except reachable.
 *   - the call listening Outlook panel was hidden until a prompt was
 *     generated, which made the send step look absent.
 *   - every draft opened with To: empty, so the address was typed by hand
 *     every single time.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/shared-utils.module.js');
    return global.window.DevCoachModules.sharedUtils;
}

suite('draft recipient: splitting a name', (t) => {
    const utils = load(t);

    t.equal('a display name splits', JSON.stringify(utils.splitAssociateName('Alyssa Dimes')), '{"first":"Alyssa","last":"Dimes"}');
    t.equal('a Verint name splits the other way', JSON.stringify(utils.splitAssociateName('Dimes, Alyssa')), '{"first":"Alyssa","last":"Dimes"}');
    t.equal('a middle name is dropped', JSON.stringify(utils.splitAssociateName('Alyssa Jane Dimes')), '{"first":"Alyssa","last":"Dimes"}');
    t.equal('a middle initial is dropped', JSON.stringify(utils.splitAssociateName('Dimes, Alyssa J')), '{"first":"Alyssa","last":"Dimes"}');
    t.equal('extra spacing is tolerated', JSON.stringify(utils.splitAssociateName('  Alyssa   Dimes  ')), '{"first":"Alyssa","last":"Dimes"}');
    t.equal('one name yields no surname', JSON.stringify(utils.splitAssociateName('Alyssa')), '{"first":"Alyssa","last":""}');
    t.equal('nothing in, nothing out', JSON.stringify(utils.splitAssociateName('')), '{"first":"","last":""}');
});

suite('draft recipient: filling a pattern', (t) => {
    const utils = load(t);
    const build = utils.buildAssociateEmail;

    t.equal('first dot last', build('Alyssa Dimes', '{first}.{last}@aps.com'), 'alyssa.dimes@aps.com');
    t.equal('initial plus surname', build('Alyssa Dimes', '{f}{last}@aps.com'), 'adimes@aps.com');
    t.equal('surname plus initial', build('Alyssa Dimes', '{last}{f}@aps.com'), 'dimesa@aps.com');
    t.equal('both initials', build('Alyssa Dimes', '{f}{l}@aps.com'), 'ad@aps.com');
    t.equal('a Verint name works too', build('Dimes, Alyssa', '{first}.{last}@aps.com'), 'alyssa.dimes@aps.com');

    // Addresses never carry apostrophes, hyphens or accents.
    t.equal('an apostrophe is stripped', build("Sean O'Brien", '{first}.{last}@aps.com'), 'sean.obrien@aps.com');
    t.equal('a hyphen is stripped', build('Ana Lopez-Reyes', '{first}.{last}@aps.com'), 'ana.lopezreyes@aps.com');
    t.equal('an accent is folded', build('José Núñez', '{first}.{last}@aps.com'), 'jose.nunez@aps.com');

    // Half an address is worse than none, because it looks real.
    t.equal('no pattern gives nothing', build('Alyssa Dimes', ''), '');
    t.equal('a surname pattern with no surname gives nothing', build('Alyssa', '{first}.{last}@aps.com'), '');
    t.equal('an unknown token gives nothing', build('Alyssa Dimes', '{first}.{middle}@aps.com'), '');
    t.equal('no name gives nothing', build('', '{first}@aps.com'), '');

    // A first-name-only pattern is fine without a surname.
    t.equal('a first name pattern needs no surname', build('Alyssa', '{first}@aps.com'), 'alyssa@aps.com');
});

suite('draft recipient: overrides beat the pattern', (t) => {
    const utils = load(t);

    utils.setAssociateEmailPattern('{first}.{last}@aps.com');
    t.equal('the pattern resolves', utils.resolveAssociateEmail('Alyssa Dimes'), 'alyssa.dimes@aps.com');

    utils.setAssociateEmailOverride('Alyssa Dimes', 'a.dimes@aps.com');
    t.equal('an override wins', utils.resolveAssociateEmail('Alyssa Dimes'), 'a.dimes@aps.com');
    t.equal('and only for that person', utils.resolveAssociateEmail('Robert Vance'), 'robert.vance@aps.com');

    utils.setAssociateEmailOverride('Alyssa Dimes', '');
    t.equal('clearing an override falls back to the pattern', utils.resolveAssociateEmail('Alyssa Dimes'), 'alyssa.dimes@aps.com');

    utils.setAssociateEmailPattern('');
    t.equal('no pattern and no override resolves to nothing', utils.resolveAssociateEmail('Alyssa Dimes'), '');
    t.equal('an empty name resolves to nothing', utils.resolveAssociateEmail(''), '');

    // An override has to survive with no pattern at all, since that is the
    // path for anyone the pattern never fitted.
    utils.setAssociateEmailOverride('Contractor Person', 'someone@vendor.com');
    t.equal('an override stands alone', utils.resolveAssociateEmail('Contractor Person'), 'someone@vendor.com');
});

suite('draft recipient: the mailto carries it', (t) => {
    const utils = load(t);
    let href = '';

    // installFakeBrowser gives just enough DOM; capture what the link gets.
    const realCreate = global.document.createElement;
    global.document.createElement = () => ({
        set href(value) { href = value; },
        get href() { return href; },
        click() {}
    });

    utils.openMailtoDraft('Call Listening Feedback', 'Body text here', { to: 'alyssa.dimes@aps.com' });
    t.check('the recipient is in the mailto', href.includes('mailto:alyssa.dimes%40aps.com'));
    t.check('the subject survives', href.includes('subject=Call%20Listening%20Feedback'));
    t.check('the body survives', href.includes('body=Body%20text%20here'));

    utils.openMailtoDraft('Subject', 'Body');
    t.check('no recipient still opens a draft', href.startsWith('mailto:?'));

    utils.setCoachingCcEmail('boss@aps.com');
    utils.openMailtoDraft('Subject', 'Body', { to: 'a@aps.com' });
    t.check('a CC rides along with the recipient', href.includes('mailto:a%40aps.com?cc=boss%40aps.com'));

    global.document.createElement = realCreate;
});

suite('draft recipient: wiring', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const script = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
    const nav = fs.readFileSync(path.join(ROOT, 'modules/navigation.module.js'), 'utf8');
    const listening = fs.readFileSync(path.join(ROOT, 'modules/call-listening.module.js'), 'utf8');
    const registry = fs.readFileSync(path.join(ROOT, 'modules/store-registry.module.js'), 'utf8');

    // 1. The phrase editor is reachable.
    t.check('a nav button exists for the phrase editor', html.includes('id="subNavSentimentKeywords"'));
    t.check('the panel is in the settings nav list', nav.includes("'subSectionSentimentKeywords'"));
    t.check('the button is in the settings button list', nav.includes("'subNavSentimentKeywords'"));
    t.check('clicking it shows the panel', script.includes("showManageDataSubSection('subSectionSentimentKeywords')"));
    t.check('and repaints it', /subNavSentimentKeywords[\s\S]{0,400}renderSentimentDatabasePanel\(\)/.test(script));

    // 2. The Outlook panel is visible from the start.
    const outlookTag = html.match(/<div id="callListeningOutlookSection"[^>]*>/);
    t.check('the outlook section exists', Boolean(outlookTag));
    t.check('it is no longer hidden', !/display:\s*none/.test(outlookTag[0]));
    t.check('its button starts disabled', /id="generateCallListeningOutlookBtn"[^>]*disabled/.test(html));
    t.check('the button explains why it is disabled', script.includes('Paste the message from Copilot first'));

    // 3. The To: field.
    t.check('the recipient input exists', html.includes('id="callListeningRecipient"'));
    t.check('it is filled on load', script.includes('refreshCallListeningRecipient();'));
    t.check('and refilled when the associate changes',
        /bindElementOnce\(employeeSelect, 'change', refreshCallListeningRecipient\)/.test(script));
    t.check('the draft is given the address', /to,\s*\n\s*getEmployeeNickname/.test(script));
    t.check('the module passes it to the mailto', listening.includes('openDraft(subject, bodyText, { to })'));
    t.check('a typed address is remembered', listening.includes('setAssociateEmailOverride'));

    t.check('the pattern setting exists', html.includes('id="associateEmailPattern"'));
    t.check('the pattern setting is bound', script.includes('bindAssociateEmailPatternSetting'));

    // Both new stores must sync, or a pattern set at home is absent at work.
    t.check('the pattern store is registered', registry.includes("name: 'associateEmailPattern'"));
    t.check('the override store is registered', registry.includes("name: 'employeeEmails'"));
});

suite('draft recipient: every draft path, not just one', (t) => {
    const listening = fs.readFileSync(path.join(ROOT, 'modules/call-listening.module.js'), 'utf8');
    const coaching = fs.readFileSync(path.join(ROOT, 'modules/coaching.module.js'), 'utf8');

    // Both modules that open a draft have to fill To:, or the fix is only real
    // on whichever page you happen to be on.
    [['call-listening', listening], ['coaching', coaching]].forEach(([name, src]) => {
        t.check(`${name} passes a recipient to the mailto`, /openDraft\(subject, bodyText, \{ to \}\)/.test(src));
        t.check(`${name} does not open a draft with no recipient argument`, !/openDraft\(subject, bodyText\);/.test(src));
    });

    t.check('coaching resolves the address from the pattern', coaching.includes('resolveAssociateEmail'));
    // Only the panel with a To: field can learn a correction from one.
    t.check('call listening saves a typed correction', listening.includes('setAssociateEmailOverride'));
    t.check('coaching does not invent an override', !coaching.includes('setAssociateEmailOverride'));
});
