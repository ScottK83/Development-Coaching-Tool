(function () {
    'use strict';

    // ============================================
    // MESSAGE VOICE MODULE
    // The app's opening lines, in one place.
    //
    // Four separate greeting pools had grown up across the codebase — one in
    // script.js, one in morning-pulse, one in cheerleading, one implied by
    // on-off-tracker's prompt. They overlapped almost word for word ("Hey
    // ${name}!", "What's up ${name}!") but drifted independently, so the same
    // associate could hear a different voice depending on which tab the
    // message happened to be generated from.
    //
    // They are pooled here by TONE rather than flattened into one list. A
    // celebration and a Monday check-in genuinely should not open the same
    // way; what they should share is a single file you edit when you want to
    // change how this app sounds.
    // ============================================

    // Neutral, conversational. For routine check-ins and weekly notes — the
    // message arrives on a schedule, so the opener stays low-key.
    var NEUTRAL = [
        function (n) { return 'Hey ' + n + '!'; },
        function (n) { return 'Hi ' + n + '!'; },
        function (n) { return 'What\'s up ' + n + '!'; },
        function (n) { return 'Hey there ' + n + '!'; },
        function (n) { return n + '!'; },
        function (n) { return 'Morning ' + n + '!'; },
        function (n) { return 'Good to catch up with you, ' + n + '.'; },
        function (n) { return n + ', got a sec?'; },
        function (n) { return 'Wanted to touch base, ' + n + '.'; },
        function (n) { return n + ', quick update for you.'; },
        function (n) { return 'Hey hey ' + n + '!'; },
        function (n) { return 'Alright ' + n + ', let\'s get into it.'; },
        function (n) { return n + '! Perfect timing.'; },
        function (n) { return 'Happy to share this with you, ' + n + '.'; }
    ];

    // Warmer, with an emoji. For messages that exist because something good
    // happened — cheers, shout-outs, high-fives.
    var CELEBRATORY = [
        function (n) { return 'Hey ' + n + '! 🎉'; },
        function (n) { return n + ', quick one for you 🌟'; },
        function (n) { return 'Hey ' + n + ' 👋'; },
        function (n) { return n + '! Wanted to share some good news 😊'; },
        function (n) { return 'Hi ' + n + '! 💪'; },
        function (n) { return n + ', take a look at this 👀'; },
        function (n) { return 'Hey ' + n + ', this one\'s worth a look 👀'; },
        function (n) { return n + '! Good stuff in your numbers 🙌'; },
        function (n) { return 'Hey ' + n + ', got something good to share 😊'; }
    ];

    var POOLS = { neutral: NEUTRAL, celebratory: CELEBRATORY };

    function pick(arr) {
        return arr[Math.floor(Math.random() * arr.length)];
    }

    // greeting('celebratory', 'Christi') -> "Hey Christi! 🎉"
    // Unknown tones fall back to neutral rather than throwing — a bad tone
    // string should cost you an emoji, not the whole message.
    function greeting(tone, firstName) {
        var pool = POOLS[tone] || NEUTRAL;
        return pick(pool)(firstName);
    }

    function greetingPool(tone) {
        return (POOLS[tone] || NEUTRAL).slice();
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.messageVoice = {
        greeting: greeting,
        greetingPool: greetingPool,
        TONES: Object.keys(POOLS)
    };
})();
