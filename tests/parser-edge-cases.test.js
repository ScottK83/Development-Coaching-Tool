'use strict';

/**
 * Four ways the parser turned a good reading into a bad number.
 *
 * All four share a shape: the wrong answer is plausible, so nothing downstream
 * could tell it from a real one. A six-second hold time, a 1% adherence and a
 * 0% transfer rate all look like data.
 *
 *   parseSeconds     parseFloat stops at a colon, so an AHT written "6:42" was
 *                    stored as 6 SECONDS rather than 402, and "0:06:42" as 0.
 *   parsePercentage  the fraction rescale ran on 0 < n < 1, so 0.999 became
 *                    99.9 and 1.000 became 1 -- the lowest rating band, for the
 *                    best possible result, in a column where everyone below it
 *                    converted correctly.
 *   hasMetricCell    a dash passed as "present", and parsePercentage turned it
 *                    into a real 0. An associate with no adherence reading
 *                    scored 0%, indistinguishable from one who adhered to none
 *                    of their schedule.
 *   transfersCount   fabricated a 0 when the column was absent -- a flawless
 *                    week nobody earned, on a reverse metric where 0 is the
 *                    best possible number. `transfers` beside it was already
 *                    guarded for exactly this reason.
 */

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/data-parsing.module.js').dataParsing;
}

suite('parser: a duration is read as a duration', (t) => {
    const dp = load(t);

    t.equal('mm:ss becomes seconds', dp.parseSeconds('6:42'), 402);
    t.equal('and a short one too', dp.parseSeconds('0:30'), 30);
    t.equal('hh:mm:ss becomes seconds', dp.parseSeconds('0:06:42'), 402);
    t.equal('including over an hour', dp.parseSeconds('1:02:03'), 3723);

    // The plain forms have to keep working exactly as they did.
    t.equal('a bare number is still seconds', dp.parseSeconds('402'), 402);
    t.equal('with a unit suffix too', dp.parseSeconds('402s'), 402);
    t.equal('and it still rounds', dp.parseSeconds('401.6'), 402);

    // Anything with a colon that is not a duration is unreadable, not a number
    // with a colon after it. "12:60" used to come through as 12.
    t.equal('a malformed clock is unreadable', dp.parseSeconds('12:60'), '');
    t.equal('and so is nonsense', dp.parseSeconds('abc:def'), '');

    t.equal('a blank stays blank', dp.parseSeconds(''), '');
    t.equal('and so does N/A', dp.parseSeconds('N/A'), '');
});

suite('parser: a fraction-formatted perfect score is 100 percent', (t) => {
    const dp = load(t);

    t.equal('0.999 rescales', dp.parsePercentage('0.999'), 99.9);
    t.equal('and so does 1.000', dp.parsePercentage('1.000'), 100);
    t.equal('and 1.0', dp.parsePercentage('1.0'), 100);

    // The written form is what separates the two readings, so a bare 1 stays
    // one percent -- a whole-percent export writes it that way.
    t.equal('a bare 1 is still one percent', dp.parsePercentage('1'), 1);

    // Everything else is untouched.
    t.equal('a normal percentage', dp.parsePercentage('95.2%'), 95.2);
    t.equal('a normal fraction', dp.parsePercentage('0.952'), 95.2);
    t.equal('and a plain hundred', dp.parsePercentage('100%'), 100);

    // Survey percentages follow the same rule.
    t.equal('survey 1.000 is a perfect score', dp.parseSurveyPercentage('1.000'), 100);
    t.equal('survey 0.999 rescales', dp.parseSurveyPercentage('0.999'), 99.9);
    t.equal('and a bare survey 1 is one percent', dp.parseSurveyPercentage('1'), 1);
});

suite('parser: a dash is not a reading', (t) => {
    const dp = load(t);

    // Driven through the real paste path, because the point is what lands on
    // the row rather than what one helper returns.
    const headers = ['Name (Last, First)', 'TotalCallsAnswered', 'Transfers%',
        'Number of Transfers', 'AHT', 'Talk', 'Hold', 'ACW', 'Adherence%'];
    const row = (name, adherence) =>
        [name, '200', '5.5%', '11', '400', '300', '22', '55', adherence].join('\t');

    const paste = [headers.join('\t'),
        row('Reed, Dana', '-'),
        row('Vale, Chris', '95.2%')
    ].join('\n');

    const employees = dp.parsePastedData(paste, '2026-08-17', '2026-08-23');
    t.equal('both rows parsed', employees.length, 2);

    const dana = employees.find((e) => e.name.indexOf('Dana') > -1);
    const chris = employees.find((e) => e.name.indexOf('Chris') > -1);

    t.equal('a dash reads as no data, not as zero percent', dana.scheduleAdherence, '');
    t.check('and it is certainly not a real zero', dana.scheduleAdherence !== 0);
    t.equal('while a real figure comes through', chris.scheduleAdherence, 95.2);
});

suite('parser: a missing transfer column is not a flawless week', (t) => {
    const dp = load(t);

    // The export without either transfer column, which is the case the guard
    // beside `transfers` was written for.
    const headers = ['Name (Last, First)', 'TotalCallsAnswered', 'AHT', 'Talk', 'Hold', 'ACW', 'Adherence%'];
    const paste = [
        headers.join('\t'),
        ['Reed, Dana', '200', '400', '300', '22', '55', '95.2%'].join('\t')
    ].join('\n');

    const employees = dp.parsePastedData(paste, '2026-08-17', '2026-08-23');
    t.equal('the row parsed', employees.length, 1);
    const dana = employees[0];

    t.equal('the transfer rate is unknown', dana.transfers, '');
    t.equal('and so is the count', dana.transfersCount, '');
    t.check('neither is a fabricated zero',
        dana.transfers !== 0 && dana.transfersCount !== 0);

    // And when the columns ARE there, the numbers still come through.
    const withCols = [
        ['Name (Last, First)', 'TotalCallsAnswered', 'Transfers%', 'Number of Transfers',
            'AHT', 'Talk', 'Hold', 'ACW', 'Adherence%'].join('\t'),
        ['Reed, Dana', '200', '5.5%', '11', '400', '300', '22', '55', '95.2%'].join('\t')
    ].join('\n');
    const parsed = dp.parsePastedData(withCols, '2026-08-17', '2026-08-23')[0];
    t.equal('a real transfer count is kept', parsed.transfersCount, 11);
    t.check('and a real rate too', parsed.transfers > 0);

    // A genuine zero is still a zero, which is the half that matters.
    const zeroed = [
        ['Name (Last, First)', 'TotalCallsAnswered', 'Transfers%', 'Number of Transfers',
            'AHT', 'Talk', 'Hold', 'ACW', 'Adherence%'].join('\t'),
        ['Reed, Dana', '200', '0%', '0', '400', '300', '22', '55', '95.2%'].join('\t')
    ].join('\n');
    const zero = dp.parsePastedData(zeroed, '2026-08-17', '2026-08-23')[0];
    t.equal('a measured zero count is zero', zero.transfersCount, 0);
});
