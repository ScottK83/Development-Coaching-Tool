'use strict';

/**
 * A blank Hold column stays blank rather than borrowing somebody else's numbers.
 *
 * autoCorrectHoldTimeColumn repairs an export whose hold column has moved. It
 * used to score every UNRESERVED column by how many numbers it held and take
 * the winner, with a bonus for a header containing "hold".
 *
 * On a standard export the unmapped columns are TotalIn-OfficeShrink%,
 * TotalOOOShrink% and TotalShrinkage% -- all full of numbers, none of them hold
 * time. So a genuinely blank Hold column handed hold time an office-shrink
 * PERCENTAGE, rounded and stored as seconds: nine associates at 4, 4, 4, 4, 4,
 * 5, 5, 5, 5 seconds of hold, against a 30-second target.
 *
 * Worse than the wrong figure. The substitution FILLED the column, so
 * buildMetricsUploadQualityWarnings saw coverage and stayed quiet: the warning
 * written to catch a blank hold column was silenced by the code meant to rescue
 * it.
 *
 * A candidate now has to be a hold column, not merely the fullest one left over.
 */

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/data-parsing.module.js').dataParsing;
}

// The real export's shape, trimmed to what matters here. Hold sits at 6 and the
// shrink columns at the end are unmapped.
const HEADERS = [
    'Name (Last, First)', 'TotalCallsAnswered', 'Transfers%', 'Number of Transfers',
    'AHT', 'Talk', 'Hold', 'ACW', 'Adherence%',
    'TotalIn-OfficeShrink%', 'TotalOOOShrink%', 'TotalShrinkage%'
];

// Everything the parser maps, so only the shrink columns are unreserved.
const MAPPED = {
    name: 0, totalCalls: 1, transfers: 2, transfersCount: 3,
    aht: 4, talkTime: 5, holdTime: 6, acw: 7, scheduleAdherence: 8
};

function rowsWithHold(holdValues) {
    return holdValues.map((hold, i) => ([
        'Person ' + i, '200', '5.5%', '11', '400', '300', hold, '55', '95.2%',
        '4.0%', '2.1%', '6.1%'
    ]));
}

suite('hold column: a blank Hold is not filled from an unrelated column', (t) => {
    const dp = load(t);
    t.check('the repair is reachable', typeof dp.autoCorrectHoldTimeColumn === 'function');

    // Hold genuinely blank for everyone. The shrink columns beside it are full.
    const colMap = Object.assign({}, MAPPED);
    const rows = rowsWithHold(['', '', '', '', '', '', '', '', '']);
    dp.autoCorrectHoldTimeColumn(colMap, HEADERS, rows);

    t.equal('hold time still points at the Hold column', colMap.holdTime, 6);
    t.check('and not at TotalIn-OfficeShrink%', colMap.holdTime !== HEADERS.indexOf('TotalIn-OfficeShrink%'));
    t.check('nor at either of the other shrink columns',
        colMap.holdTime !== HEADERS.indexOf('TotalOOOShrink%')
        && colMap.holdTime !== HEADERS.indexOf('TotalShrinkage%'));
});

suite('hold column: the repair still moves to a real hold column', (t) => {
    const dp = load(t);

    // The case the repair exists for: the mapped column is empty and a
    // differently-named hold column carries the data.
    const headers = HEADERS.concat(['Avg Hold Seconds']);
    const colMap = Object.assign({}, MAPPED);
    const rows = rowsWithHold(['', '', '', '', '', '', '', '', ''])
        .map((r) => r.concat(['22']));

    dp.autoCorrectHoldTimeColumn(colMap, headers, rows);
    t.equal('it moves to the column that says hold', colMap.holdTime, headers.indexOf('Avg Hold Seconds'));
});

suite('hold column: a healthy Hold column is left alone', (t) => {
    const dp = load(t);

    const headers = HEADERS.concat(['Avg Hold Seconds']);
    const colMap = Object.assign({}, MAPPED);
    const rows = rowsWithHold(['20', '21', '22', '23', '24', '25', '26', '27', '28'])
        .map((r) => r.concat(['99']));

    dp.autoCorrectHoldTimeColumn(colMap, headers, rows);
    t.equal('a column with real coverage is not second-guessed', colMap.holdTime, 6);
});

suite('hold column: a partly-filled Hold column is not traded for a fuller stranger', (t) => {
    const dp = load(t);

    // Two of nine filled: below the coverage bar, so the repair runs. It must
    // still find nothing to move to, because no other header says hold.
    const colMap = Object.assign({}, MAPPED);
    const rows = rowsWithHold(['20', '21', '', '', '', '', '', '', '']);

    dp.autoCorrectHoldTimeColumn(colMap, HEADERS, rows);
    t.equal('the thin Hold column is kept', colMap.holdTime, 6);
});
