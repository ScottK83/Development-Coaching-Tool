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

suite('PA down payment: the $0 down accounts go in the email', (t) => {
    // Scott, 2026-11-23: the email names each account, with the date of the
    // $0 down. The numbers here are made up.
    const pa = load(t);
    const [jamie] = pa.parseRows(PASTE);

    const accounts = pa.parseAccounts([
        '11/03/2026\t1000000001',
        '1000000002  11/4/2026',
        '2026-11-05, 100-000-0003',
        '11/6 1000000004',
        'Doe, Jamie\t11/7/2026 2:15:00 PM\t1000000005\t0%',
        '1000000006',
        '',
        'no account on this line 11/8/2026'
    ].join('\r\n'));
    t.equal('six accounts; the blank line and the line with no number are skipped', accounts.length, 6);
    t.equal('date then account, leading zero off', JSON.stringify(accounts[0]), '{"date":"11/3/2026","account":"1000000001"}');
    t.equal('account then date', JSON.stringify(accounts[1]), '{"date":"11/4/2026","account":"1000000002"}');
    t.equal('a year-first date, and dashes in the number are kept', JSON.stringify(accounts[2]), '{"date":"11/5/2026","account":"100-000-0003"}');
    t.equal('a date with no year stays that way', accounts[3].date, '11/6');
    t.equal('a row copied from a sheet: the date and the number are found', JSON.stringify(accounts[4]), '{"date":"11/7/2026","account":"1000000005"}');
    t.equal('no date typed: the account is kept', JSON.stringify(accounts[5]), '{"date":"","account":"1000000006"}');
    t.equal('nothing typed, no accounts', pa.parseAccounts('').length, 0);

    const email = pa.buildEmail(Object.assign({}, jamie, { zeroDownAccounts: accounts.slice(0, 2).concat(accounts[5]) }));
    t.check('the list sits between the results and the reminders', email.body.includes(
        '\n$0 down arrangements: 3\n\n'
        + '$0 down accounts on this report (date of the $0 down, account number):\n\n'
        + '- 11/3/2026, account 1000000001\n'
        + '- 11/4/2026, account 1000000002\n'
        + '- Account 1000000006\n\n'
        + 'Team Lead approval needs to be documented in the notes on every one of these accounts.\n\n'
        + 'A few reminders going forward:\n\n- '));
    t.check('still ends on Thanks,', email.body.endsWith('\n\nThanks,'));
    t.check('no placeholder left', !/\[[^\]]*\]|undefined|null/.test(email.body));
    t.check('no em or en dash', !/[\u2013\u2014\u2015]/.test(email.body));

    const plain = pa.buildEmail(jamie).body;
    t.check('with no accounts typed the email is as before', plain.includes('\n$0 down arrangements: 3\n\nA few reminders going forward:\n\n- ') && !plain.includes('account number'));
});

suite('PA down payment: the account rows read themselves', (t) => {
    // Scott, 2026-11-23: the sheet's account rows, one per account. The 0%
    // rows are the $0 down accounts, and the PA date is the date of the $0
    // down. Made-up rows (tests/fixtures/pa-down-payment-accounts.txt).
    const pa = load(t);
    const ACCOUNTS = fs.readFileSync(path.join(ROOT, 'tests/fixtures/pa-down-payment-accounts.txt'), 'utf8');
    const details = pa.parseDetailRows(ACCOUNTS);

    t.equal('six account rows', details.length, 6);
    t.equal('advisor', details[0].advisor, 'Jamie Doe');
    t.equal('leader', details[0].leader, 'Pat Leader');
    t.equal('report date, leading zero off', details[0].reportDate, '11/9/2026');
    t.equal('the account number keeps its leading zero', details[0].account, '0100000001');
    t.equal('PA date, leading zero off', details[0].paDate, '11/3/2026');
    t.equal('percent accepted', details[1].accepted, 45);
    t.equal('a bare fraction is a percent', details[4].accepted, 50);
    t.equal('no PA date while it waits on the down payment', details[2].paDate, '');
    t.equal('#N/A is not a 1X PA contact', details[0].usedException, false);
    t.equal('an ID is', details[1].usedException, true);
    t.equal('Required Coaching rows are not account rows', pa.parseDetailRows(PASTE).length, 0);
    t.equal('and account rows are not Required Coaching rows', pa.parseRows(ACCOUNTS).length, 0);
    t.equal('Windows line endings', pa.parseDetailRows(ACCOUNTS.replace(/\n/g, '\r\n')).length, 6);

    const [jamie, casey, morgan] = pa.summariseDetails(details);
    t.equal('three advisors', pa.summariseDetails(details).length, 3);
    t.equal('accounts counted', jamie.accounts, '3');
    t.equal('plain average of percent accepted', jamie.avgAccepted, '15.0%');
    t.equal('1X PA contacts counted', jamie.exceptionCount, '2');
    t.equal('usage', jamie.usage, '67%');
    t.equal('$0 down counted', jamie.zeroDown, '2');
    t.equal('the $0 down accounts, with the PA date',
        JSON.stringify(jamie.zeroDownAccounts),
        '[{"date":"11/3/2026","account":"0100000001"},{"date":"","account":"1000000003"}]');
    t.equal('an unformatted 0 is $0 down too', JSON.stringify(casey.zeroDownAccounts), '[{"date":"11/5/2026","account":"1000000004"}]');
    t.equal('nobody at 0%, no accounts listed', morgan.zeroDownAccounts.length, 0);

    const email = pa.buildEmail(jamie);
    t.check('the email lists them', email.body.includes('- 11/3/2026, account 0100000001\n- Account 1000000003\n'));
    t.check('and only them', !email.body.includes('1000000002'));
    t.check('the note takes the counted figures', pa.buildLeaderNote(jamie).includes('3 accounts, avg 15.0% accepted, 2 1X PA contacts (67%), 2 at $0 down.'));
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
