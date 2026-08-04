'use strict';

const { suite } = require('./harness');

const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

suite('messageVoice — tone pools', (t) => {
    t.installFakeBrowser();
    const mv = t.loadModule('modules/message-voice.module.js').messageVoice;

    t.check('exposes both tones', JSON.stringify(mv.TONES) === '["neutral","celebratory"]');

    const neutral = mv.greetingPool('neutral');
    const celeb = mv.greetingPool('celebratory');
    t.check('neutral pool is populated', neutral.length > 5);
    t.check('celebratory pool is populated', celeb.length > 5);

    t.check('every neutral opener uses the name', neutral.every((f) => f('Christi').includes('Christi')));
    t.check('every celebratory opener uses the name', celeb.every((f) => f('Christi').includes('Christi')));

    // The tones are kept apart on purpose: a shout-out and a Monday check-in
    // should not open the same way.
    t.check('celebratory openers all carry an emoji', celeb.every((f) => EMOJI.test(f('X'))));
    t.check('neutral openers stay emoji-free', neutral.every((f) => !EMOJI.test(f('X'))));
});

suite('messageVoice — safety', (t) => {
    t.installFakeBrowser();
    const mv = t.loadModule('modules/message-voice.module.js').messageVoice;

    t.equal('greeting returns a string', typeof mv.greeting('neutral', 'Christi'), 'string');
    t.check('an unknown tone falls back to neutral rather than throwing',
        typeof mv.greeting('nonsense', 'X') === 'string' && !EMOJI.test(mv.greeting('nonsense', 'X')));

    // A caller mutating the pool must not poison every other tab.
    const size = mv.greetingPool('neutral').length;
    mv.greetingPool('neutral').push(() => 'INJECTED');
    t.equal('greetingPool hands back a copy', mv.greetingPool('neutral').length, size);
});

suite('messageVoice — consumers bind at load time', (t) => {
    t.installFakeBrowser();
    global.weeklyData = {};
    global.dailyData = {};
    t.loadModule('modules/message-voice.module.js');

    let loaded = true;
    try {
        t.loadModule('modules/cheerleading.module.js');
    } catch (e) {
        loaded = false;
    }
    t.check('cheerleading loads against the shared pool', loaded);
    t.check('  and picked up the celebratory tone',
        !!global.window.DevCoachModules.cheerleading);
});
