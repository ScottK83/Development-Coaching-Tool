'use strict';

const { suite } = require('./harness');

function load(t) {
    t.installFakeBrowser();
    return t.loadModule('modules/year-standing.module.js').yearStanding;
}

suite('year standing: direction, never a position', (t) => {
    const ys = load(t);

    // Ranks count upward from the best, so a falling rank number is a climb.
    t.equal('moving up the floor is gaining', ys.classifyMovement(40, 12, 127), 'gaining');
    t.equal('being passed is slipping', ys.classifyMovement(12, 40, 127), 'slipping');

    // The whole point of the rule: nothing that reaches an associate may carry
    // a position or a peer count.
    const text = ys.buildYearStandingText([
        { label: 'First Call Resolution', valueText: '78.4%', targetText: '73%', movement: 'gaining' },
        { label: 'Schedule Adherence', valueText: '91.2%', targetText: '93%', movement: 'slipping' }
    ]);

    t.check('their own number is fine', text.indexOf('78.4%') > -1);
    t.check('and so is their target', text.indexOf('73%') > -1);
    t.check('no rank position appears', !/\b\d+(st|nd|rd|th)\b/.test(text));
    t.check('no peer count appears', !/\b\d+\s+(of|out of)\s+\d+/.test(text));
    t.check('nobody is called top anything', !/top \d/i.test(text));
    t.check('the word rank never appears', !/\brank(ed|ing)?\b/i.test(text));

    t.check('but the direction is unmistakable', text.indexOf('gaining ground') > -1);
    t.check('and so is the wrong direction', /lost (a little|a bit of) ground|losing ground/.test(text));
});

suite('year standing: a slip never says anybody is passing them', (t) => {
    const ys = load(t);
    // Scott, 2026-10-21: no "N people ahead of you". The 10/25 audit found its
    // cousins in this pool: "the floor has been passing you here", "others
    // have been moving ahead of you". Every slipping line, every draw.
    const lines = [0, 1, 2].map((i) => ys.buildYearStandingText(
        [{ label: 'Schedule Adherence', valueText: '91.2%', targetText: '93%', movement: 'slipping' }],
        { pick: (pool) => pool[i % pool.length] }));
    lines.forEach((text, i) => {
        t.check('line ' + i + ': no one passing them', !/passing you|ahead of you|moving ahead|passed you|behind (them|others)/i.test(text));
        t.check('line ' + i + ': said as winnable', /win(nable)? (it )?back|turn it around/.test(text));
    });
});

suite('year standing: churn is not movement', (t) => {
    const ys = load(t);

    // One good week from somebody else can shuffle a mid-table rank. Calling
    // that "you are slipping" would be alarming and wrong.
    t.equal('a two place drift is holding', ys.classifyMovement(20, 22, 127), 'holding');
    t.equal('and so is a two place gain', ys.classifyMovement(22, 20, 127), 'holding');
    t.equal('no movement at all is holding', ys.classifyMovement(20, 20, 127), 'holding');

    // On a big floor the bar scales with the field.
    // On 127 the bar works out at four places, so three is churn and four counts.
    t.equal('three places on a big floor is churn', ys.classifyMovement(20, 23, 127), 'holding');
    t.equal('four places clears the bar', ys.classifyMovement(20, 24, 127), 'slipping');
    t.equal('and eight is plainly real', ys.classifyMovement(20, 28, 127), 'slipping');

    // A rank of zero does not exist. Treating a missing one as zero would tell
    // somebody they had rocketed to the front of the floor.
    t.check('a zero rank is not the top of the floor', ys.classifyMovement(0, 40, 127) === null);

    // On a small team three places genuinely means something.
    t.equal('three places on a small team counts', ys.classifyMovement(10, 7, 12), 'gaining');
});

suite('year standing: refuses to guess a direction', (t) => {
    const ys = load(t);

    // A single point in time is a position, not a direction, and a position is
    // the one thing that must not reach them.
    t.check('a missing earlier rank yields nothing', ys.classifyMovement(null, 12, 127) === null);
    t.check('a missing current rank yields nothing', ys.classifyMovement(12, null, 127) === null);
    t.check('neither rank yields nothing', ys.classifyMovement(undefined, undefined, 127) === null);
    t.check('nonsense yields nothing', ys.classifyMovement('x', 'y', 127) === null);

    // Only one YTD upload means there is no earlier point to compare against.
    // Through the storage module, which is where year-standing reads it.
    const oneUpload = { 'a|2026-06-30': { employees: [] } };
    global.window.DevCoachModules.storage = { loadYtdData: () => oneUpload };
    t.check('one upload is not a direction', ys.gatherYearMovement('Anyone') === null);
});

suite('year standing: a line with no movement is not worth writing', (t) => {
    const ys = load(t);

    t.equal('nothing to say produces nothing', ys.buildYearStandingText([]), '');
    t.equal('entries with no movement produce nothing',
        ys.buildYearStandingText([{ label: 'FCR', valueText: '78%', movement: null }]), '');

    // Holding steady is real, but it is not news five months into a year.
    const held = ys.buildYearStandingText([{ label: 'FCR', valueText: '78%', movement: 'holding' }]);
    t.check('holding still renders when asked for', held.indexOf('held your place') > -1);

    const capped = ys.buildYearStandingText(
        ['a', 'b', 'c', 'd', 'e'].map(l => ({ label: l, valueText: '1%', movement: 'gaining' })),
        { limit: 3 });
    t.equal('the block stays short enough to read', (capped.match(/^  • /gm) || []).length, 3);
});

suite('year standing: the urgency is real, not invented', (t) => {
    const ys = load(t);

    // August is month 7, so four months remain after it.
    t.equal('August leaves four months', ys.monthsLeftInYear(new Date(2026, 7, 15)), 4);
    t.equal('November leaves one', ys.monthsLeftInYear(new Date(2026, 10, 1)), 1);
    t.equal('December leaves none', ys.monthsLeftInYear(new Date(2026, 11, 31)), 0);

    t.check('mid-year says there is time', ys.urgencyLine(new Date(2026, 7, 15)).indexOf('time to move this') > -1);

    // Scott, 2026-10-14: "2 months left in the year. This is the stretch that
    // decides it." went out on October 14, with eleven weeks still to work.
    // The run-in counts the weeks that are really there, and says they are
    // enough, which they are.
    t.equal('October 14 has eleven weeks left', ys.weeksLeftInYear(new Date(2026, 9, 14)), 11);
    t.check('and says so', ys.urgencyLine(new Date(2026, 9, 14)).indexOf('About 11 weeks left in the year') === 0);
    t.check('October 1 is thirteen', ys.urgencyLine(new Date(2026, 9, 1)).indexOf('About 13 weeks left') === 0);
    t.check('November 1 is nine', ys.urgencyLine(new Date(2026, 10, 1)).indexOf('About 9 weeks left') === 0);
    t.check('nothing ominous in the run-in', !/decides it|stretch that decides/i.test(ys.urgencyLine(new Date(2026, 9, 14))));
    t.check('it is encouraging instead', /real time to move/.test(ys.urgencyLine(new Date(2026, 9, 14))));
    t.check('and December does not promise time that is gone', ys.urgencyLine(new Date(2026, 11, 20)).indexOf('left') === -1);

    // The article: "against a 82% target" read like nobody proofread it.
    const an = ys.buildYearStandingText([{ label: 'Rep Satisfaction', valueText: '88.5%', targetText: '82%', movement: 'gaining' }]);
    t.check('an 82% target', an.indexOf('against an 82% target') > -1);
    t.check('no emoji on the heading', an.indexOf('Where the year stands') === 0);
});
