'use strict';

/**
 * PA DOWN PAYMENT (People > Follow Up > PA Down Payment)
 *
 * Scott, 2026-11-09: paste his rows from the weekly PA Down Payment Coaching
 * sheet and get, per advisor, the email in his own words and a note for the
 * sheet's Leader Notes column. Two rules are pinned here because they are
 * easy to break quietly:
 *
 *   - the sheet's numbers are never saved or synced, and
 *   - the email has no praise opener and keeps his words.
 *
 * The rows are made up (tests/fixtures/pa-down-payment-rows.txt). The real
 * sheet is never committed.
 */

const fs = require('fs');
const path = require('path');
const { suite, ROOT } = require('./harness');

const PASTE = fs.readFileSync(path.join(ROOT, 'tests/fixtures/pa-down-payment-rows.txt'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'modules/pa-down-payment.module.js'), 'utf8');

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/pa-down-payment.module.js').paDownPayment;
}

suite('PA down payment: the pasted rows read themselves', (t) => {
    const pa = load(t);
    const rows = pa.parseRows(PASTE);

    t.equal('three advisors; the header and the outstanding table are skipped', rows.length, 3);
    const [jamie, sam, alex] = rows;
    t.equal('advisor', jamie.advisor, 'Jamie Doe');
    t.equal('leader', jamie.leader, 'Pat Leader');
    t.equal('report date, leading zero off', jamie.reportDate, '11/9/2026');
    t.equal('average accepted', jamie.avgAccepted, '41.5%');
    t.equal('accounts', jamie.accounts, '22');
    t.equal('1X PA contacts', jamie.exceptionCount, '9');
    t.equal('usage', jamie.usage, '41%');
    t.equal('$0 down', jamie.zeroDown, '3');
    t.equal('"Last, First" is flipped', sam.advisor, 'Sam Rivera');
    t.equal('a bare fraction becomes a percent', alex.avgAccepted, '32.5%');
    t.equal('and so does the usage', alex.usage, '33%');

    t.equal('without the header row it reads the same', pa.parseRows(PASTE.split('\n').slice(1).join('\n')).length, 3);
    t.equal('Windows line endings', pa.parseRows(PASTE.replace(/\n/g, '\r\n')).length, 3);
    t.equal('nothing pasted, nothing read', pa.parseRows('').length, 0);
    t.equal('prose is not a row', pa.parseRows('Hi Scott, here is this week\'s report.').length, 0);
    t.equal('one leader in the paste', pa.leadersOf(rows).join('|'), 'Pat Leader');
    t.equal('two leaders are told apart',
        pa.leadersOf(pa.parseRows(PASTE + '\n11/9/2026\tRobin Other\tCasey Park\t20.0%\t5\t2\t40%\t1')).join('|'),
        'Pat Leader|Robin Other');
});

suite('PA down payment: the email is his sample, filled in', (t) => {
    const pa = load(t);
    const [jamie] = pa.parseRows(PASTE);
    const email = pa.buildEmail(jamie);

    t.equal('subject', email.subject, 'Payment Arrangement Development Opportunity');
    const lines = email.body.split('\n');
    t.equal('opens with the first name, no praise line', lines[0], 'Hi Jamie,');
    t.equal('then straight to the report, date without the leading zero', lines[2],
        'I wanted to follow up on a development opportunity identified in the 11/9 PA Down Payment Coaching report.');
    t.check('accounts', email.body.includes('\nAccounts reviewed: 22\n'));
    t.check('average', email.body.includes('\nAverage down payment accepted: 41.5%\n'));
    t.check('1X PA contacts with the usage in brackets', email.body.includes('\n1X PA Exception contacts used: 9 (41%)\n'));
    t.check('$0 down', email.body.includes('\n$0 down arrangements: 3\n'));
    t.equal('five reminders', lines.filter(line => line.startsWith('- ')).length, 5);
    pa.REMINDERS.forEach((reminder, i) => t.check(`reminder ${i + 1} word for word`, email.body.includes(`- ${reminder}\n`)));
    t.check('the goal paragraph', email.body.includes('The goal isn\'t to avoid helping our customers. We absolutely want to work with customers experiencing hardship.'));
    t.check('the reply request', email.body.includes('Please reply acknowledging you\'ve reviewed this.'));
    t.check('ends on Thanks, for Outlook\'s signature', email.body.endsWith('\n\nThanks,'));
    t.check('no placeholder left', !/\[[^\]]*\]|undefined|null/.test(email.body));
    t.check('no em or en dash', !/[–—―]/.test(email.body));

    t.equal('a preferred name wins', pa.buildEmail(Object.assign({}, jamie, { greetingName: 'Jay' })).body.split('\n')[0], 'Hi Jay,');
});

suite('PA down payment: the leader note', (t) => {
    t.pinClock('2026-11-10');
    const pa = load(t);
    const [jamie, sam] = pa.parseRows(PASTE);

    t.equal('the day it went out, then the numbers', pa.buildLeaderNote(jamie),
        '11/10/2026 Emailed PA down payment coaching: 22 accounts, avg 41.5% accepted, 9 1X PA contacts (41%), 3 at $0 down. '
        + 'Reviewed starting from the required down payment, documenting exceptions, $0 down needs TL approval. Asked for a reply.');
    t.check('one account, one contact', pa.buildLeaderNote(sam).includes('1 account, avg 50.0% accepted, 1 1X PA contact (100%), 0 at $0 down.'));
});

suite('PA down payment: nothing is saved or synced', (t) => {
    // The only store call allowed is the read of the roster, for a preferred
    // name and an email address.
    const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    t.check('no localStorage, sessionStorage or IndexedDB', !/localStorage|sessionStorage|indexedDB/i.test(code));
    t.check('no save, write or sync call', !/\b(?:save|write|sync|persist|setItem)\w*\s*\(/i.test(code));
    t.check('no network call', !/\bfetch\s*\(|XMLHttpRequest|sendBeacon/.test(code));
    const storeCalls = code.match(/storage\?*\.\?*\w+/g) || [];
    t.equal('the roster read is the only store call', storeCalls.join('|'), 'storage?.loadWeeklyData');
});

suite('PA down payment: it is on the Follow Up tabs', (t) => {
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const redFlag = fs.readFileSync(path.join(ROOT, 'modules/red-flag.module.js'), 'utf8');
    t.check('the tab button', html.includes('id="showPaDownPaymentPanelBtn"'));
    t.check('the panel, hidden until picked', /id="paDownPaymentPanel" style="display: none;/.test(html));
    ['paDownPaymentPaste', 'paDownPaymentStatus', 'paDownPaymentLeaderWrap', 'paDownPaymentLeader', 'paDownPaymentCards', 'paDownPaymentClearBtn']
        .forEach(id => t.check(`#${id}`, html.includes(`id="${id}"`)));
    t.check('the module is loaded', html.includes("'modules/pa-down-payment.module.js'"));
    t.check('the tab switch opens it', redFlag.includes("switchRedFlagMode('pa-down-payment')") && redFlag.includes('paDownPayment?.show?.()'));
});
