'use strict';

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

/**
 * WHO A COACHING DRAFT GOES TO, AND WHO IS COPIED ON IT
 *
 * Neither had a default, so a fresh install opened every draft with an empty
 * To and no CC, and the panel said "No address pattern set yet" until somebody
 * went and set one. Nothing about that was a decision. The coaching mailbox was
 * written out as a literal in three other modules and asserted in a test, and
 * the pattern is that same address read backwards.
 *
 * The distinction that matters is between never set and turned off. Never set
 * gets the default. Cleared stays cleared, because somebody who wants to type
 * addresses by hand should not have the setting grow back under them.
 */

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/shared-utils.module.js').sharedUtils;
}

suite('coaching drafts: a fresh install already knows the addresses', (t) => {
    const utils = load(t);

    t.equal('the associate address resolves with nothing set',
        utils.resolveAssociateEmail('Alyssa Dimes'), 'alyssa.dimes@aps.com');
    t.equal('and the coaching mailbox is copied',
        utils.getCoachingCcEmail(), 'Brandywine.Lockhart@aps.com');

    // The default is that address because three modules carried it as a
    // literal, not because it was picked here.
    t.equal('the default pattern builds the default CC',
        utils.DEFAULT_EMAIL_PATTERN, '{first}.{last}@aps.com');
});

suite('coaching drafts: never set and turned off are different things', (t) => {
    const utils = load(t);

    // Turning the copy off has to stick. Removing the key would read as never
    // set on the next draft and put the default back, so the setting would
    // quietly undo itself.
    utils.setCoachingCcEmail('');
    t.equal('a cleared CC stays cleared', utils.getCoachingCcEmail(), '');

    utils.setCoachingCcEmail('someone.else@aps.com');
    t.equal('and a different one is kept', utils.getCoachingCcEmail(), 'someone.else@aps.com');

    utils.setAssociateEmailPattern('');
    t.equal('a cleared pattern resolves to nothing',
        utils.resolveAssociateEmail('Alyssa Dimes'), '');

    // An override still works with no pattern, which is the whole point of
    // clearing it: address people by hand.
    utils.setAssociateEmailOverride('Alyssa Dimes', 'a.dimes@aps.com');
    t.equal('an override still resolves', utils.resolveAssociateEmail('Alyssa Dimes'), 'a.dimes@aps.com');
});

suite('coaching drafts: the mailto carries both', (t) => {
    const utils = load(t);

    let href = '';
    const doc = global.document;
    const realCreate = doc.createElement;
    doc.createElement = function (tag) {
        const el = realCreate.call(doc, tag);
        if (tag === 'a') {
            Object.defineProperty(el, 'href', {
                set(value) { href = value; },
                get() { return href; },
                configurable: true
            });
            el.click = () => {};
        }
        return el;
    };

    utils.openMailtoDraft('Call feedback', 'Hi Alyssa,', { to: 'alyssa.dimes@aps.com' });
    doc.createElement = realCreate;

    t.check('it opens a mailto', href.startsWith('mailto:'));
    t.check('addressed to the associate', href.indexOf(encodeURIComponent('alyssa.dimes@aps.com')) > -1);
    t.check('copying the coaching mailbox',
        href.indexOf(`cc=${encodeURIComponent('Brandywine.Lockhart@aps.com')}`) > -1);
    t.check('with a subject', href.indexOf('subject=') > -1);
    t.check('and the body', href.indexOf(encodeURIComponent('Hi Alyssa,')) > -1);
});

suite('coaching drafts: the CC lives in one place now', (t) => {
    // Three modules carried the address as a literal, so changing the coaching
    // mailbox in Settings changed nothing anywhere it was actually used.
    ['modules/metric-trends.module.js', 'modules/red-flag.module.js', 'modules/center-ranking.module.js']
        .forEach((file) => {
            const text = fs.readFileSync(path.join(ROOT, file), 'utf8');
            const literals = (text.match(/'Brandywine\.Lockhart@aps\.com'/g) || []).length;
            const reads = (text.match(/getCoachingCcEmail\?\.\(\)/g) || []).length;
            t.check(`${file} reads the setting`, reads > 0);
            t.check(`${file} keeps the literal only as a fallback`, literals <= reads);
        });
});
