/**
 * A period ending 1 January belongs to that January.
 *
 * Date.parse on a bare "YYYY-MM-DD" is UTC midnight by definition. Read back
 * with getFullYear anywhere west of Greenwich, that is the previous local day,
 * so in Phoenix Date.parse('2026-01-01') is 31 December 2025. Sorting did not
 * care, because every key shifted equally. Year bucketing did: a year-to-date
 * period ending 1 January was filed under the previous year.
 */
const { suite } = require('./harness');

// The rule the fix applies: anchor a bare ISO date at local noon, which is far
// enough from both midnights that no offset can move the date.
function parseLocal(value) {
    const text = String(value == null ? '' : value).trim();
    if (!text) return NaN;
    const iso = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text + 'T12:00:00' : text;
    return Date.parse(iso);
}

suite('period dates keep their own day and year', (t) => {
    const prevTZ = process.env.TZ;

    ['America/Phoenix', 'America/New_York', 'UTC', 'Europe/London'].forEach((tz) => {
        process.env.TZ = tz;
        const d = new Date(parseLocal('2026-01-01'));
        t.equal(tz + ': new year stays in the new year', d.getFullYear(), 2026);
        t.equal(tz + ': and stays on the first', d.getDate(), 1);

        const mid = new Date(parseLocal('2026-06-21'));
        t.equal(tz + ': a midsummer date does not slip', mid.getDate(), 21);
    });

    // The shape that caused it, kept as the reason this test exists. Only
    // asserted west of Greenwich, where the drift is real.
    process.env.TZ = 'America/Phoenix';
    const naive = new Date(Date.parse('2026-01-01'));
    t.equal('the old parse really did land in the previous year', naive.getFullYear(), 2025);

    process.env.TZ = prevTZ;

    // Values that are not bare ISO dates must pass through untouched.
    t.check('a full timestamp is left alone',
        Number.isFinite(parseLocal('2026-01-01T08:30:00Z')));
    t.check('a written date still parses', Number.isFinite(parseLocal('June 21, 2026')));
    t.check('an empty value is not a date', !Number.isFinite(parseLocal('')));
    t.check('nonsense is not a date', !Number.isFinite(parseLocal('not a date')));
});
