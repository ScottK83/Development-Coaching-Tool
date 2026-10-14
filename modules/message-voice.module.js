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

    // ============================================
    // TENSE
    //
    // A message about a stretch that is still running talks in the present
    // ("is going absolutely OFF"); one about a stretch that has ended talks in
    // the past ("went absolutely OFF"). Scott, 2026-10-07, after a week in
    // progress came out as "went absolutely off".
    //
    // Decided by the kind of upload, not by its end date: a month-to-date file
    // ends yesterday while the month is still open. A year to date is still
    // running until it reaches December 31. Anything unrecognised counts as
    // still running, the safe way round: an open period costs a sentence in
    // the present, where a closed claim on an open period is simply false.
    // ============================================
    var CLOSED_PERIOD_TYPES = { week: true, month: true, 'month-agg': true, quarter: true, daily: true };

    function isOngoingPeriod(periodType, endIso) {
        if (CLOSED_PERIOD_TYPES[periodType]) return false;
        if (periodType === 'ytd' && /-12-31$/.test(String(endIso || ''))) return false;
        return true;
    }

    // Fifty ways of saying someone is having a great stretch, each written both
    // ways. `done` follows the subject directly ("Jordan went absolutely
    // OFF"); `ing` follows is / are / 're ("Jordan is going absolutely OFF").
    // No line uses was, were, their, his, her or your, so every one reads
    // right after a name, after "You" and after "Some of our people". None
    // names a placing or compares anyone to anyone, so they are safe in the
    // high five as well as the channel.
    var HYPE = [
        { done: 'went absolutely OFF', ing: 'going absolutely OFF' },
        { done: 'put on a CLINIC', ing: 'putting on a CLINIC' },
        { done: 'showed up and showed OUT', ing: 'showing up and showing OUT' },
        { done: 'came to WORK', ing: 'bringing the WORK every single day' },
        { done: 'caught FIRE', ing: 'on FIRE' },
        { done: 'set the bar', ing: 'setting the bar' },
        { done: 'raised the bar', ing: 'raising the bar' },
        { done: 'turned it UP', ing: 'turning it UP' },
        { done: 'brought the HEAT', ing: 'bringing the HEAT' },
        { done: 'took it to another level', ing: 'taking it to another level' },
        { done: 'made it look easy', ing: 'making it look easy' },
        { done: 'stole the show', ing: 'stealing the show' },
        { done: 'ran the table', ing: 'running the table' },
        { done: 'found another gear', ing: 'finding another gear' },
        { done: 'locked in and delivered', ing: 'locked in and delivering' },
        { done: 'went on an absolute tear', ing: 'on an absolute tear' },
        { done: 'got on a serious roll', ing: 'on a serious roll' },
        { done: 'lit it UP', ing: 'lighting it UP' },
        { done: 'knocked it out of the park', ing: 'knocking it out of the park' },
        { done: 'crushed it', ing: 'crushing it' },
        { done: 'delivered BIG', ing: 'delivering BIG' },
        { done: 'owned the numbers', ing: 'owning the numbers' },
        { done: 'stacked up the wins', ing: 'stacking up the wins' },
        { done: 'hit a whole new level', ing: 'hitting a whole new level' },
        { done: 'made some NOISE', ing: 'making some NOISE' },
        { done: 'brought the A-game', ing: 'bringing the A-game' },
        { done: 'went full beast mode', ing: 'in full beast mode' },
        { done: 'turned heads', ing: 'turning heads' },
        { done: 'leveled UP', ing: 'leveling UP' },
        { done: 'put up BIG numbers', ing: 'putting up BIG numbers' },
        { done: 'kept the momentum rolling', ing: 'keeping the momentum rolling' },
        { done: 'dialed it all the way in', ing: 'dialed all the way in' },
        { done: 'played on another level', ing: 'playing on another level' },
        { done: 'made the board light up', ing: 'making the board light up' },
        { done: 'put the whole floor on notice', ing: 'putting the whole floor on notice' },
        { done: 'never missed a beat', ing: 'not missing a beat' },
        { done: 'raised the standard', ing: 'raising the standard' },
        { done: 'took over', ing: 'taking over' },
        { done: 'went full throttle', ing: 'going full throttle' },
        { done: 'served up excellence', ing: 'serving up excellence' },
        { done: 'proved unstoppable', ing: 'unstoppable right now' },
        { done: 'brought the ENERGY', ing: 'bringing the ENERGY' },
        { done: 'stayed locked in', ing: 'staying locked in' },
        { done: 'made it count', ing: 'making it count' },
        { done: 'hit the ground running', ing: 'hitting the ground running' },
        { done: 'went all in', ing: 'going all in' },
        { done: 'put on a SHOW', ing: 'putting on a SHOW' },
        { done: 'gave it everything', ing: 'giving it everything' },
        { done: 'turned in a highlight reel', ing: 'turning in a highlight reel' },
        { done: 'flat out delivered', ing: 'flat out delivering' }
    ];

    // hype('@Jordan', false) -> "@Jordan went absolutely OFF"
    // hype('@Jordan', true)  -> "@Jordan is going absolutely OFF"
    // hype('You', true)      -> "You're going absolutely OFF"
    // hype('Some of our people', true, { plural: true }) -> "... are going ..."
    // options.entry pins the saying (used by the rotator and the tests).
    function hype(subject, ongoing, options) {
        var opts = options || {};
        var entry = opts.entry || pick(HYPE);
        if (!ongoing) return subject + ' ' + entry.done;
        if (subject === 'You' || subject === 'you') return subject + '\'re ' + entry.ing;
        return subject + (opts.plural ? ' are ' : ' is ') + entry.ing;
    }

    // Walks the sayings in a shuffled order, so one post never says the same
    // thing twice and two posts in a row rarely open alike.
    function hypeRotator() {
        var order = HYPE.slice();
        for (var i = order.length - 1; i > 0; i--) {
            var j = Math.floor(Math.random() * (i + 1));
            var t = order[i]; order[i] = order[j]; order[j] = t;
        }
        var at = 0;
        return function (subject, ongoing, options) {
            var entry = order[at % order.length];
            at++;
            return hype(subject, ongoing, Object.assign({}, options || {}, { entry: entry }));
        };
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

    /*
     * THE EMOJI BUDGET
     *
     * Scott, 2026-10-13: "2 emojis." Per message, everywhere, the team post
     * included. The 10/14 smoke test counted a median of 30 in the team post
     * and 4 or 5 in a private message, because every section marker, bullet
     * and name carried its own.
     *
     * The pools are being trimmed at the source, and this is the floor under
     * them: the first emoji (the opener's) and the last (the sign-off's) stay,
     * everything between goes. ©, ® and ™ and the arrows count as pictographs
     * to Unicode but not to a reader, so they are left alone.
     */
    var EMOJI = /\p{Extended_Pictographic}️?[\u{1F3FB}-\u{1F3FF}]?(?:‍\p{Extended_Pictographic}️?[\u{1F3FB}-\u{1F3FF}]?)*/gu;
    var NOT_EMOJI = /^[©®™↔-↙↩↪]$/;

    function _emojiMatches(text) {
        var out = [];
        String(text || '').replace(EMOJI, function (m, at) {
            if (!NOT_EMOJI.test(m)) out.push({ text: m, at: at });
            return m;
        });
        return out;
    }

    function countEmojis(text) {
        return _emojiMatches(text).length;
    }

    function limitEmojis(text, max) {
        var cap = Number.isFinite(max) ? max : 2;
        var src = String(text || '');
        var found = _emojiMatches(src);
        if (found.length <= cap) return src;
        var keep = new Set();
        for (var i = 0; i < Math.max(0, cap - 1); i++) keep.add(found[i].at);
        if (cap > 0) keep.add(found[found.length - 1].at);
        var out = '';
        var last = 0;
        found.forEach(function (f) {
            out += src.slice(last, f.at);
            last = f.at + f.text.length;
            if (keep.has(f.at)) {
                out += f.text;
                return;
            }
            // Take the space the emoji was standing in, so "🎯 Let's" leaves
            // "Let's" and "here. 💡 Tip" leaves "here. Tip". Indentation in
            // front of it is kept, which keeps a bullet list lined up.
            var before = out.charAt(out.length - 1);
            if (src.charAt(last) === ' ' && (before === '' || before === ' ' || before === '\n' || before === '\t' || before === '•')) last++;
        });
        out += src.slice(last);
        return out
            .replace(/(\S) {2,}/g, '$1 ')
            .replace(/ +([.,!?:])/g, '$1')
            .replace(/[ \t]+$/gm, '');
    }

    /*
     * THE BEST TRUE THING TO SAY
     *
     * Scott, 2026-10-14: "Make sure to, in every piece of feedback. From the
     * calls, to the metrics ... make sure to provide positive feedback."
     *
     * Most messages praise the goals that are on target, and someone missing
     * all of them got nothing, a "None at goal" handed to Copilot with an
     * instruction to praise anyway, or a sympathy line. There is nearly always
     * something real to say, so this finds it, best first:
     *
     *   on target, then moved the right way past the noise, then better than
     *   the center average, then closest to goal, and only then the effort.
     *
     * rows: [{ key, label, value, target, prior, center }], numbers, any of
     *   prior / center / target may be missing. Callers leave out metrics with
     *   no surveys behind them (a 0% that is no surveys is never said).
     * options.ongoing: the period is still running (present tense).
     * options.tookNoCalls: nothing in the numbers is real, so only the effort.
     *
     * Reliability is never used: hours are not praise material outside the
     * quarterly review. A 0 second time means no calls, never a win.
     */
    var NO_PRAISE_KEYS = { reliability: true };

    function _registryDef(key) {
        return (window.METRICS_REGISTRY && window.METRICS_REGISTRY[key]) || {};
    }

    function _fmtValue(key, value) {
        if (typeof window.formatMetricDisplay === 'function') return window.formatMetricDisplay(key, value);
        if (typeof formatMetricDisplay === 'function') return formatMetricDisplay(key, value); // eslint-disable-line no-undef
        return String(value);
    }

    // A move in words: "24 seconds", "1.4 points". Never "+1.4%".
    function _amount(key, size) {
        var unit = _registryDef(key).unit;
        var n = Math.round(Math.abs(size) * 10) / 10;
        if (unit === 'sec') {
            var s = Math.round(Math.abs(size));
            return s + (s === 1 ? ' second' : ' seconds');
        }
        if (unit === '%') return n + (n === 1 ? ' point' : ' points');
        return String(n);
    }

    function _usable(row) {
        if (!row || !row.key || NO_PRAISE_KEYS[row.key]) return false;
        var value = Number(row.value);
        if (!Number.isFinite(value)) return false;
        if (_registryDef(row.key).unit === 'sec' && value === 0) return false;
        return true;
    }

    function _isReverse(key) {
        var movement = window.DevCoachModules && window.DevCoachModules.metricMovement;
        if (movement && typeof movement.isReverse === 'function') return movement.isReverse(key);
        return !!_registryDef(key).isReverse;
    }

    // Positive = better, as a share of the goal, so seconds and percentages
    // can be ranked against each other.
    function _margin(row) {
        var target = Number(row.target);
        if (!Number.isFinite(target) || !target) return null;
        var ahead = _isReverse(row.key) ? target - Number(row.value) : Number(row.value) - target;
        return ahead / Math.abs(target);
    }

    function _better(key, a, b) {
        var movement = window.DevCoachModules && window.DevCoachModules.metricMovement;
        if (movement && typeof movement.resolveDirection === 'function') {
            var read = movement.resolveDirection(key, a, b);
            return read.direction === 'improving' ? read.delta : null;
        }
        var delta = _isReverse(key) ? Number(b) - Number(a) : Number(a) - Number(b);
        return delta > 0 ? delta : null;
    }

    function truePositive(rows, options) {
        var opts = options || {};
        var ongoing = opts.ongoing !== false;
        var is = ongoing ? 'is' : 'was';
        var effort = {
            kind: 'effort',
            key: '',
            label: '',
            text: ongoing
                ? 'I see the effort you\'re putting in, and it matters.'
                : 'I saw the effort you put in, and it matters.'
        };
        if (opts.tookNoCalls) return effort;

        var pool = (Array.isArray(rows) ? rows : []).filter(_usable);
        var label = function (row) { return row.label || _registryDef(row.key).label || row.key; };

        var atGoal = pool
            .map(function (row) { return { row: row, margin: _margin(row) }; })
            .filter(function (item) { return item.margin !== null && item.margin >= 0; })
            .sort(function (a, b) { return b.margin - a.margin; })[0];
        if (atGoal) {
            return {
                kind: 'atGoal', key: atGoal.row.key, label: label(atGoal.row),
                text: 'Your ' + label(atGoal.row) + ' ' + is + ' on target at ' + _fmtValue(atGoal.row.key, Number(atGoal.row.value)) + '.'
            };
        }

        var moved = pool
            .filter(function (row) { return Number.isFinite(Number(row.prior)) && row.prior !== null && row.prior !== ''; })
            .map(function (row) {
                var delta = _better(row.key, Number(row.value), Number(row.prior));
                var goal = Math.abs(Number(row.target)) || Math.abs(Number(row.prior)) || 1;
                return { row: row, delta: delta, share: delta === null ? null : delta / goal };
            })
            .filter(function (item) { return item.delta !== null; })
            .sort(function (a, b) { return b.share - a.share; })[0];
        if (moved) {
            var rose = Number(moved.row.value) > Number(moved.row.prior);
            return {
                kind: 'improved', key: moved.row.key, label: label(moved.row),
                text: 'Your ' + label(moved.row) + (ongoing ? ' is moving' : ' moved') + ' the right way, '
                    + (rose ? 'up ' : 'down ') + _amount(moved.row.key, moved.delta) + '.'
            };
        }

        var ahead = pool
            .filter(function (row) { return Number.isFinite(Number(row.center)) && row.center !== null && row.center !== ''; })
            .map(function (row) { return { row: row, delta: _better(row.key, Number(row.value), Number(row.center)) }; })
            .filter(function (item) { return item.delta !== null; })
            .sort(function (a, b) { return b.delta - a.delta; })[0];
        if (ahead) {
            return {
                kind: 'aboveCenter', key: ahead.row.key, label: label(ahead.row),
                text: 'Your ' + label(ahead.row) + ' of ' + _fmtValue(ahead.row.key, Number(ahead.row.value)) + ' ' + is
                    + ' better than the center average of ' + _fmtValue(ahead.row.key, Number(ahead.row.center)) + '.'
            };
        }

        var closest = pool
            .map(function (row) { return { row: row, margin: _margin(row) }; })
            .filter(function (item) { return item.margin !== null; })
            .sort(function (a, b) { return b.margin - a.margin; })[0];
        if (closest) {
            return {
                kind: 'closest', key: closest.row.key, label: label(closest.row),
                text: 'Your ' + label(closest.row) + ' ' + is + (pool.length > 1 ? ' the closest to goal, at ' : ' at ')
                    + _fmtValue(closest.row.key, Number(closest.row.value)) + ' against the '
                    + _fmtValue(closest.row.key, Number(closest.row.target)) + ' goal, and that is a good place to build from.'
            };
        }

        return effort;
    }

    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.messageVoice = {
        truePositive: truePositive,
        greeting: greeting,
        greetingPool: greetingPool,
        TONES: Object.keys(POOLS),
        isOngoingPeriod: isOngoingPeriod,
        hype: hype,
        hypeRotator: hypeRotator,
        HYPE: HYPE,
        countEmojis: countEmojis,
        limitEmojis: limitEmojis
    };
})();
