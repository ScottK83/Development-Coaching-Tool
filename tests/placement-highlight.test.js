/**
 * Colour on the shout-out.
 *
 * The rule that matters most here is that this is display only. The post goes
 * into a channel as plain text, so anything that leaks markup into the copied
 * string is a bug the reader would see as literal angle brackets in front of
 * the whole team.
 */
const { suite } = require('./harness');

suite('placement highlighting', (t) => {
    t.installFakeBrowser();
    const celebrations = t.loadModule('modules/celebrations.module.js').celebrations;

    // One definition of the boundaries, shared with the badge on the
    // Celebrations tab.
    t.equal('first is its own band', celebrations.placementTier(1), 'first');
    t.equal('second is a top five', celebrations.placementTier(2), 'top5');
    t.equal('fifth is the last top five', celebrations.placementTier(5), 'top5');
    t.equal('sixth is a top ten', celebrations.placementTier(6), 'top10');
    t.equal('tenth is the last top ten', celebrations.placementTier(10), 'top10');
    t.equal('eleventh is a top twenty five', celebrations.placementTier(11), 'top25');
    t.equal('twenty fifth is the last band', celebrations.placementTier(25), 'top25');
    t.equal('twenty sixth gets no colour', celebrations.placementTier(26), null);
    t.equal('a missing rank gets no colour', celebrations.placementTier(null), null);
    t.equal('a nonsense rank gets no colour', celebrations.placementTier('abc'), null);

    // The text badge in the post and the colour band must not disagree about
    // the same rank: "Top 5!" printed inside a bronze highlight would be two
    // answers to one question.
    [2, 5].forEach(function (r) {
        t.equal('rank ' + r + ' says Top 5 and colours as top5',
            celebrations.tierBadge({ rank: r }) + '|' + celebrations.placementTier(r), 'Top 5!|top5');
    });
    [6, 10].forEach(function (r) {
        t.equal('rank ' + r + ' says Top 10 and colours as top10',
            celebrations.tierBadge({ rank: r }) + '|' + celebrations.placementTier(r), 'Top 10!|top10');
    });
    t.equal('rank 1 needs no badge and colours as first',
        celebrations.tierBadge({ rank: 1 }) + '|' + celebrations.placementTier(1), '|first');

    const hash = celebrations.highlightPlacements('Ada put up 91.0%. #1 in the Call Center, matched by nobody.');
    t.check('a hash placing is wrapped', hash.indexOf('placement-tier-first') !== -1);
    t.check('the wording itself survives', hash.indexOf('#1 in the Call Center') !== -1);

    const ordinal = celebrations.highlightPlacements('Schedule Adherence is at 95.2%! 2nd best in the Call Center. Top 5!');
    t.check('an ordinal placing is wrapped as top five', ordinal.indexOf('placement-tier-top5') !== -1);

    const tied = celebrations.highlightPlacements('Tied for 4th best in the Call Center.');
    t.check('a tie is wrapped', tied.indexOf('placement-tier-top5') !== -1);
    t.check('the "Tied for" is inside the highlight', tied.indexOf('>Tied for 4th best in the Call Center<') !== -1);

    const deep = celebrations.highlightPlacements('12th best in the Call Center.');
    t.check('twelfth is a top twenty five', deep.indexOf('placement-tier-top25') !== -1);

    const past = celebrations.highlightPlacements('40th best in the Call Center.');
    t.check('past twenty five nothing is wrapped', past.indexOf('placement-tier') === -1);

    // Nothing else in the sentence may be touched.
    const plain = celebrations.highlightPlacements('No placings here at all.');
    t.equal('text with no placing is returned unchanged', plain, 'No placings here at all.');

    // The post is user-facing text built from names, so escaping still applies.
    const nasty = celebrations.highlightPlacements('<script>bad()</script> #1 in the Call Center');
    t.check('markup in the source is escaped', nasty.indexOf('&lt;script&gt;') !== -1);
    t.check('no raw script tag survives', nasty.indexOf('<script>') === -1);
    t.check('and the placing is still highlighted', nasty.indexOf('placement-tier-first') !== -1);

    // Every span opened is closed, or the preview swallows the rest of the post.
    const many = celebrations.highlightPlacements(
        '#1 in the Call Center and 3rd best in the Call Center and 20th best in the Call Center');
    t.equal('one span per placing, all closed',
        (many.match(/<span/g) || []).length, (many.match(/<\/span>/g) || []).length);
    t.equal('three placings, three spans', (many.match(/<span/g) || []).length, 3);
});
