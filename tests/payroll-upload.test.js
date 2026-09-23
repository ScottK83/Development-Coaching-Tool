'use strict';

/**
 * The payroll file is read by its headers, and a new file adds to the year.
 *
 * Columns were fixed positions with no header check, so a different export in
 * this slot, or the right one with a column inserted, read the wrong columns
 * as TRC and Quantity without a word. And each upload replaced the person's
 * whole payroll record, so the second pay period wiped the first and the
 * PTOST running total and discipline tiers were worked out on part of the year.
 */

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    t.loadModule('modules/shared-utils.module.js');
    return t.loadModule('modules/reliability.module.js').reliability;
}

function sheet(header, rows) {
    return [['Report'], [], [], header].concat(rows);
}

const HEADER = ['Emplid', 'Name', 'x', 'x', 'x', 'x', 'Date', 'x', 'In', 'x', 'x', 'x', 'x', 'Out', 'TRC', 'Quantity', 'x', 'x', 'x', 'x', 'x', 'x', 'Task Code'];

function row(emplid, name, date, trc, qty) {
    const r = new Array(23).fill('');
    r[0] = emplid; r[1] = name; r[6] = date; r[8] = '8:00'; r[13] = '16:30'; r[14] = trc; r[15] = qty; r[22] = 'PHONE';
    return r;
}

suite('payroll: the standard layout still reads', (t) => {
    const api = load(t);
    const out = api.extractPayrollData(sheet(HEADER, [row('101', 'Vale,Chris', '2026-09-14', 'PTO', 4)]));
    const person = out[Object.keys(out)[0]];
    t.check('one person is read', Object.keys(out).length === 1);
    t.equal('the TRC comes from the TRC column', person.entries[0].trc, 'PTO');
    t.equal('and the hours from Quantity', person.entries[0].quantity, 4);
});

suite('payroll: an inserted column does not shift the read', (t) => {
    const api = load(t);
    const header = HEADER.slice(0, 2).concat(['Dept']).concat(HEADER.slice(2));
    const r = row('101', 'Vale,Chris', '2026-09-14', 'PTO', 4);
    const shifted = r.slice(0, 2).concat(['CS']).concat(r.slice(2));
    const out = api.extractPayrollData(sheet(header, [shifted]));
    const person = out[Object.keys(out)[0]];
    t.equal('TRC is still TRC', person.entries[0].trc, 'PTO');
    t.equal('Quantity is still Quantity', person.entries[0].quantity, 4);
});

suite('payroll: a file that is not the time report is refused', (t) => {
    const api = load(t);
    let message = '';
    try { api.extractPayrollData([['Emplid', 'Name', 'Balance'], ['101', 'Vale,Chris', 12]]); } catch (e) { message = e.message; }
    t.check('it says why', /payroll time report/.test(message));
});

suite('payroll: a second file keeps the first file\'s days', (t) => {
    const api = load(t);
    const jan = [{ date: new Date(2026, 0, 5), trc: 'PTO', quantity: 8 }];
    const feb = [{ date: new Date(2026, 1, 9), trc: 'UNSCHD', quantity: 4 }];
    const merged = api.mergePayrollEntries(jan, feb, new Date(2026, 1, 1).getTime(), new Date(2026, 1, 28).getTime());
    t.equal('both periods are kept', merged.length, 2);

    const corrected = [{ date: new Date(2026, 0, 5), trc: 'PTOST', quantity: 8 }];
    const again = api.mergePayrollEntries(merged, corrected, new Date(2026, 0, 1).getTime(), new Date(2026, 0, 31).getTime());
    t.equal('a re-pulled period replaces its own days', again.filter((e) => e.trc === 'PTO').length, 0);
    t.equal('with the corrected code', again.filter((e) => e.trc === 'PTOST').length, 1);
    t.equal('and leaves the other period alone', again.filter((e) => e.trc === 'UNSCHD').length, 1);
});

suite('verint: hours, categories and headers are read as written', (t) => {
    const api = load(t);
    t.equal('0:30 is half an hour', api.parseVerintHours('0:30'), 0.5);
    t.equal('4:30 is four and a half', api.parseVerintHours('4:30'), 4.5);
    t.equal('a plain number still reads', api.parseVerintHours('2.25'), 2.25);
    t.equal('and a numeric cell', api.parseVerintHours(3), 3);

    const header = ['', 'Total', 'Time Off Activity', 'From', 'To', 'Length Hours'];
    t.equal('"to" is the To column, not Total', api.findColumnIndexFromHeaderRow(header, ['to', 'end', 'enddate']), 4);
    t.equal('"from" is From', api.findColumnIndexFromHeaderRow(header, ['from', 'start', 'startdate']), 3);
    t.equal('hours still match a longer header', api.findColumnIndexFromHeaderRow(header, ['lengthhours', 'hours', 'duration']), 5);
});

suite('pto: one person however the file writes the name', (t) => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'modules/pto.module.js'), 'utf8');
    const start = src.indexOf('function ptoNameKey(');
    const body = src.slice(start, src.indexOf('\n}\n', start) + 2);
    const key = new Function(body + '\nreturn ptoNameKey;')();
    t.equal('Last, First matches First Last', key('Berrelleza, Robert'), key('Robert Berrelleza'));
    t.equal('case and spacing do not matter', key('  ROBERT   berrelleza '), key('Robert Berrelleza'));
    t.check('different people stay different', key('Robert Berrelleza') !== key('Roberta Berrelleza'));
});
