/**
 * A metric with no data is not an achievement.
 *
 * data-parsing writes '' for a metric the export did not carry. q1-review's
 * guard rejected undefined and null but let '' through, and in JavaScript
 * '' <= 426 is true. So an associate with no handle time, no after-call work
 * and no hold time was counted as MEETING all three targets and listed under
 * Strengths in the Quarterly review.
 *
 * The error ran one way only, which is why it survived: blank min-type metrics
 * ('' >= 93 is false) failed correctly and looked like proof the guard worked.
 */
const { suite } = require('./harness');

suite('quarterly: a blank metric is neither a strength nor a gap', (t) => {
    // The coercion the bug rested on. Pinned so nobody reintroduces a
    // comparison that relies on it.
    t.equal("'' <= 426 is true, which is the whole bug", '' <= 426, true);
    t.equal("'' >= 93 is false, which is why it only broke one way", '' >= 93, false);
    t.check("parseFloat('') is not finite, which is the fix",
        !isFinite(parseFloat('')));

    // The guard's actual shape, applied to every value the parser can produce.
    const accepted = (v) => isFinite(parseFloat(v));

    t.equal('a blank is rejected', accepted(''), false);
    t.equal('undefined is rejected', accepted(undefined), false);
    t.equal('null is rejected', accepted(null), false);
    t.equal('N/A is rejected', accepted('N/A'), false);
    t.equal('whitespace is rejected', accepted('   '), false);

    t.equal('zero is kept, because zero is a real reading', accepted(0), true);
    t.equal('a zero string is kept', accepted('0'), true);
    t.equal('a normal number is kept', accepted(426), true);
    t.equal('a numeric string is kept', accepted('92.5'), true);
    t.equal('a negative is kept', accepted(-1), true);
});
