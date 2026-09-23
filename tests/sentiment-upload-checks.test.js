'use strict';

/**
 * A sentiment upload is checked against the form before it is saved.
 *
 * The report's associate name and dates were parsed and never used. A file for
 * Jane saved while John was selected was stored under John; one file dropped
 * into two slots was stored twice; a file the parser could not read was saved
 * empty behind a success message.
 */

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/sentiment.module.js').sentiment;
}

const report = (over) => Object.assign({
    associateName: '', startDate: '9/1/2026', endDate: '9/14/2026',
    totalCalls: 40, callsDetected: 30, phrases: [{ phrase: 'happy to help', value: 12, speaker: 'A' }]
}, over);

suite('sentiment upload: the files must match the form and each other', (t) => {
    const api = load(t);
    const check = api.checkSentimentUploads;

    t.equal('a clean set passes', check([
        { type: 'Positive', report: report({ associateName: 'Martinez Sharp, Christi' }) },
        { type: 'Negative', report: report({ callsDetected: 5, phrases: [{ phrase: 'no', value: 2, speaker: 'A' }] }) }
    ], 'Christi Martinez-Sharp').length, 0);

    t.check('a file for someone else is refused',
        check([{ type: 'Positive', report: report({ associateName: 'Jane Doe' }) }], 'John Smith').length === 1);
    t.check('a nickname is not a different person', api.sameSentimentAssociate('Chris Vale', 'Christopher Vale'));
    t.check('an unreadable file is refused',
        check([{ type: 'Emotions', report: report({ totalCalls: 0, phrases: [] }) }], 'John Smith').length === 1);
    t.check('the same file in two slots is refused', check([
        { type: 'Positive', report: report() },
        { type: 'Negative', report: report() }
    ], 'John Smith').some((p) => p.indexOf('same file') > -1));
    t.check('files covering different dates are refused', check([
        { type: 'Positive', report: report() },
        { type: 'Negative', report: report({ startDate: '8/1/2026', endDate: '8/14/2026', callsDetected: 3 }) }
    ], 'John Smith').some((p) => p.indexOf('different dates') > -1));
});
