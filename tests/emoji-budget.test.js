'use strict';

const { suite } = require('./harness');

/**
 * TWO EMOJIS A MESSAGE
 *
 * Scott, 2026-10-13: "2 emojis." Per message, everywhere, the team post
 * included. The 10/14 smoke test counted a median of 30 in the team post and
 * 4 or 5 in a private message. messageVoice.limitEmojis is the floor under
 * every pool: the opener's emoji and the sign-off's stay, the rest go, and
 * the text around them still reads.
 */
suite('emoji budget: the limiter keeps the opener and the sign-off', (t) => {
    t.installFakeBrowser();
    const voice = t.loadModule('modules/message-voice.module.js').messageVoice;

    const post = '🔥🏆 VICTORY LAP TIME 🏆🔥\n📅 Oct 5 to 11\n🏅 @Kristin\n  • 📈 Managing Emotions came in at 100%!\n  • 🌟 Took Transfers to 4.5%!\nProud of you all. 👏';
    const out = voice.limitEmojis(post, 2);
    t.equal('nine become two', voice.countEmojis(out), 2);
    t.check('the first stays', out.startsWith('🔥 VICTORY LAP TIME'));
    t.check('and the last', out.endsWith('Proud of you all. 👏'));
    t.check('a stripped bullet keeps its indent and loses the gap',
        out.indexOf('\n  • Managing Emotions came in at 100%!') > -1);
    t.check('a stripped line marker leaves no leading space', out.indexOf('\nOct 5 to 11') > -1);

    const inline = voice.limitEmojis('Hey Sam! ☕ Nice week. 🎯 Focus here. 💡 Try this. Go get it. 🚀', 2);
    t.equal('mid-sentence ones go cleanly', inline, 'Hey Sam! ☕ Nice week. Focus here. Try this. Go get it. 🚀');

    t.equal('two or fewer is left alone', voice.limitEmojis('Nice work 🎉 keep going 💪', 2), 'Nice work 🎉 keep going 💪');
    t.equal('symbols that are not emojis are not counted', voice.countEmojis('© 2026 ™ → ✓ •'), 0);
    t.equal('a joined emoji counts once', voice.countEmojis('👨‍👩‍👧 and 👍🏽'), 2);
});
