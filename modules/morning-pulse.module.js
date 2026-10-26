(function() {
    'use strict';

    // ============================================
    // MORNING PULSE MODULE
    // Team-wide weekly trajectory briefing with
    // per-person quick check-in generation.
    //
    // Compares across recent uploads (e.g. Mon-Wed)
    // to show who improved, who dipped, and by how
    // much — so you can say "You made the biggest
    // jump in FCR this week."
    // ============================================

    // Volume-only metrics excluded from pulse messages (no target to coach against)
    const PULSE_EXCLUDED_METRICS = ['totalCalls', 'reliability', 'transfersCount'];
    const PULSE_SELECTION_STORAGE_KEY = (window.DevCoachConstants?.STORAGE_PREFIX || 'devCoachingTool_') + 'morningPulseSelection';

    // --- Phrase pools (randomized to avoid sounding templated) ---
    function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
    function getCurrentWeekdayName() {
        return new Date().toLocaleDateString('en-US', { weekday: 'long' });
    }

    // A time word that may be left out. The check-in names the period once in
    // its opening line, and every pool after it used to name it again, so one
    // message said "last week" three times in two sentences (Scott,
    // 2026-10-14). Passing '' drops it without leaving a double space behind.
    function at(when) { return when ? ' ' + when : ''; }
    function capFirst(s) { const t = String(s || ''); return t.charAt(0).toUpperCase() + t.slice(1); }

    // Openers live in message-voice.module.js so every tab that greets an
    // associate sounds like the same person wrote it.
    const GREETINGS = (window.DevCoachModules?.messageVoice?.greetingPool('neutral')) || [
        name => `Hey ${name}!`
    ];
    // The line that says the numbers are in. It used to say "the week of
    // <date>" in every line, so a month or a year to date was announced as a
    // week, and "The week of 10/06 is all wrapped up" went out over a week in
    // progress. `when` is describeWeekRecency's name for the stretch (last
    // week, in September, the week ending 9/26), and a period still running
    // draws from DATA_IN_ONGOING instead.
    const DATA_IN = [
        (date, when) => `Here's how you did ${when}.`,
        (date, when) => `Took a look at how things went ${when}.`,
        (date, when) => `Got your numbers. Here's where you finished ${when}.`,
        (date, when) => `Here's what you put up ${when}.`,
        (date, when) => `Wanted to share how things shook out ${when}.`,
        (date, when) => `Pulled your report. Here's how it all landed ${when}.`,
        (date, when) => `Here's the recap of how you did ${when}.`,
        (date, when) => `Here's the rundown on how you did ${when}.`,
        (date, when) => `Went through your numbers. Here's how you did ${when}.`,
        (date, when) => `Got the final numbers on how you did ${when}.`,
    ];
    // `when` is describeWeekRecency's word for the stretch the numbers cover:
    // this week, last week, in September, this year. It used to be "this week"
    // in every line, so a Last month round said "Hold Time this week, -24s"
    // over a September against August comparison.
    //
    // `delta` is a move in words ("down 40 seconds", "up 1.4 points") and
    // `range` the two numbers it went between ("146s to 106s"). Scott,
    // 2026-10-14: "Hold Time at -40s" read as though hold time was minus forty
    // seconds. Every line here says the move the way a person would.
    //
    // The range rides inside the sentence, "down 202 seconds, from 617 to
    // 415", where it used to trail in brackets, "(617s to 415s)", which reads
    // as a footnote nobody says out loud (Scott, 2026-10-26).
    const JUMP_INTROS = [
        (label, delta, range, when) => `Huge improvement in ${label}${at(when)}, ${delta}, from ${range}!`,
        (label, delta, range, when) => `Big move in ${label}${at(when)}, ${delta}, from ${range}!`,
        (label, delta, range, when) => `Love seeing ${label} move like that${at(when)}, ${delta}, from ${range}!`,
        (label, delta, range, when) => `${label} really stood out${at(when)}, ${delta}, from ${range}!`,
        (label, delta, range, when) => `You crushed it on ${label}${at(when)}, ${delta}, from ${range}!`,
        (label, delta, range, when) => `That swing in ${label} caught my eye${at(when)}, ${delta}, from ${range}.`,
        (label, delta, range, when) => `${label} moved in a serious way${at(when)}, ${delta}, from ${range}.`,
        (label, delta, range, when) => `Not gonna lie, ${label} coming ${delta}${at(when)}, from ${range}, made me do a double take.`,
        (label, delta, range, when) => `Okay, ${label}! ${capFirst(delta)}${at(when)}, from ${range}.`,
        (label, delta, range, when) => `Your ${label} went the right direction${at(when)}, ${delta}, from ${range}.`,
        (label, delta, range, when) => `Seriously though, ${label} moving ${delta}${at(when)}, from ${range}, is no joke.`,
        (label, delta, range, when) => `Look at ${label} go${at(when)}, ${delta}, from ${range}!`,
        (label, delta, range, when) => `${label} took a real shift${at(when)}, ${delta}, from ${range}.`,
        (label, delta, range, when) => `Gotta call out your ${label}${at(when)}, ${delta}, from ${range}.`,
    ];
    const PLUS_SOLID = [
        (label, val) => `Plus you're solid on ${label} at ${val}.`,
        (label, val) => `And ${label} sitting at ${val} is great too.`,
        (label, val) => `${label} at ${val} is right where it needs to be.`,
        (label, val) => `Also, ${label} at ${val}? Nice.`,
        (label, val) => `${label} is cruising along at ${val} too, no complaints there.`,
        (label, val) => `Can't forget ${label} at ${val}, that's looking clean.`,
        (label, val) => `${label} holding steady at ${val} too. Solid.`,
        (label, val) => `Meanwhile ${label} is sitting pretty at ${val}.`,
        (label, val) => `Your ${label} at ${val} doesn't need much commentary, it speaks for itself.`,
        (label, val) => `And hey, ${label} at ${val} is right on the money.`,
        (label, val) => `Worth mentioning that ${label} at ${val} is looking good too.`,
        (label, val) => `${label} at ${val}? Yeah, that works.`,
    ];
    const TWO_WINS = [
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2}? That's solid.`,
        (l1, v1, l2, v2) => `Loving ${l1} at ${v1} and ${l2} at ${v2}!`,
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2} are looking great!`,
        (l1, v1, l2, v2) => `Really strong showing on ${l1} (${v1}) and ${l2} (${v2}).`,
        (l1, v1, l2, v2) => `Two things that jumped out: ${l1} at ${v1} and ${l2} at ${v2}.`,
        (l1, v1, l2, v2) => `Your ${l1} (${v1}) and ${l2} (${v2}) are both in great shape.`,
        (l1, v1, l2, v2) => `${l1} at ${v1}, ${l2} at ${v2}. Can't argue with those.`,
        (l1, v1, l2, v2) => `Honestly, ${l1} at ${v1} and ${l2} at ${v2} speak for themselves.`,
        (l1, v1, l2, v2) => `Love seeing ${l1} (${v1}) and ${l2} (${v2}) both clicking.`,
        (l1, v1, l2, v2) => `Between ${l1} at ${v1} and ${l2} at ${v2}, you've got a lot working for you.`,
        (l1, v1, l2, v2) => `You nailed it on ${l1} (${v1}) and ${l2} (${v2}).`,
    ];
    const SURVEY_METRIC_KEYS = new Set(['fcr', 'overallExperience', 'overallExperienceTop3', 'cxRepOverall']);

    /* Which response count stands behind each survey rate.
     *
     * The same table period-compare weights by, for the same reason. A rate and
     * its denominator have to travel together or a week where nobody answered
     * the rep-sat question cannot be told from a week that scored 0%: both
     * arrive as the number 0. Falls back to the overall count when the export
     * did not carry the rate's own column, which is what every caller did
     * before these were parsed at all.
     */
    const SURVEY_COUNT_FIELD = {
        cxRepOverall: 'repSurveyTotal',
        fcr: 'fcrSurveyTotal',
        overallExperience: 'surveyTotal',
        overallExperienceTop3: 'surveyTotal'
    };

    function surveyResponsesFor(emp, metricKey) {
        const field = SURVEY_COUNT_FIELD[metricKey];
        if (!field) return null;
        const own = emp ? emp[field] : undefined;
        // Null, undefined and blank all mean "column absent", not "nobody
        // answered", so they fall through to the overall count rather than
        // being read as a zero.
        if (own !== null && own !== undefined && own !== '') {
            const n = parseInt(own, 10);
            if (Number.isInteger(n)) return n;
        }
        const total = parseInt(emp?.surveyTotal, 10);
        return Number.isInteger(total) ? total : 0;
    }

    /* Did anybody actually answer?
     *
     * A rep satisfaction of 0 on a week with no surveys returned is not a score
     * of nought, it is an empty column, and every surface downstream reads it as
     * a detractor. That gets the week wrong twice over: it prints "Rep
     * Satisfaction at 0.0%" as the thing to work on, and it suppresses the real
     * survey wins as coming from the same unhappy customer. Nobody was asked, so
     * nothing is said — no win, no opportunity, no placing, no zero.
     *
     * Only the survey metrics are gated. Everything else is measured off calls
     * the person actually took and stands on its own.
     */
    function hasSurveyBehind(emp, metricKey) {
        if (!SURVEY_METRIC_KEYS.has(metricKey)) return true;
        return surveyResponsesFor(emp, metricKey) > 0;
    }

    /* No handle time is no calls.
     *
     * Scott, 2026-10-14: "If they have 0 AHT, then they couldn't have taken
     * calls." A 0s handle time is not a fast week. It sits under the 426s goal,
     * so read as a number it was a win, and someone who was out all week got a
     * message praising it. The weekly parser already blanks a 0, but dailies,
     * month rebuilds and year rows can still carry one. With no handle time at
     * all, a calls count of 0 says the same thing. Nothing about either period
     * is written; the round sets the person aside and says why.
     */
    function tookNoCalls(emp) {
        if (!emp) return true;
        const aht = parseFloat(emp.aht);
        if (Number.isFinite(aht)) return aht <= 0;
        const calls = parseInt(emp.totalCalls, 10);
        return Number.isFinite(calls) && calls <= 0;
    }

    // The metrics a pulse message is allowed to talk about for one person: the
    // fixed exclusions, then the survey metrics nobody answered.
    function speakableMetrics(emp, analysis) {
        return (analysis?.allMetrics || [])
            .filter(m => !PULSE_EXCLUDED_METRICS.includes(m.metricKey))
            .filter(m => hasSurveyBehind(emp, m.metricKey));
    }

    // Below this many responses a survey rate is one or two customers' moods:
    // it can be named once, but it is not a move and not a run of wins. The
    // same three the perfect-surveys line has always needed.
    const MIN_SURVEYS_TO_PRAISE = 3;

    const PERFECT_SURVEYS_SOLO = [
        (surveys) => `${surveys}, every one of them perfect. Can't do better than that.`,
        (surveys) => `${surveys}. Every single one a perfect score. That's special.`,
        (surveys) => `Flawless on all ${surveys}. Huge.`,
        (surveys) => `${surveys} and not one off the mark. Beautiful.`,
        (surveys) => `All ${surveys} perfect. That doesn't happen by accident.`,
    ];
    const PERFECT_SURVEYS_PLUS = [
        (surveys, label, val) => `${surveys}. Every one perfect. And ${label} at ${val} on top of it? Unreal.`,
        (surveys, label, val) => `Flawless on ${surveys} plus ${label} at ${val}. That makes a statement.`,
        (surveys, label, val) => `All ${surveys} perfect, and ${label} sitting at ${val}. Wow.`,
        (surveys, label, val) => `${surveys} without a single miss, and ${label} at ${val} to go with it. Love it.`,
        (surveys, label, val) => `${surveys} all perfect scores, and ${label} (${val}) right there with them.`,
    ];
    const ONE_WIN = [
        (label, val) => `${label} at ${val} is looking great!`,
        (label, val) => `Solid work on ${label} at ${val}!`,
        (label, val) => `${label} at ${val}? Love to see it.`,
        (label, val) => `Nice job keeping ${label} at ${val}.`,
        (label, val) => `Your ${label} at ${val} caught my attention in a good way.`,
        (label, val) => `${label} coming in at ${val} is a win.`,
        (label, val) => `Gotta give you credit for ${label} at ${val}.`,
        (label, val) => `${label} at ${val}, that's exactly what we want.`,
        (label, val) => `Really like what I'm seeing on ${label} (${val}).`,
        (label, val) => `The work on ${label} is showing, ${val} is proof.`,
        (label, val) => `${label} at ${val}? That tells me you're locked in.`,
    ];
    /* Said only when nothing on target, no real move and no true positive
     * in the numbers was found (see truePositiveFor). Every line is praise of
     * the effort, never sympathy: "Not every week is going to be a highlight
     * reel" and "Rough stretch" told somebody the week was bad and called it
     * kindness (Scott, 2026-10-14: positive feedback in every message). No
     * line names the period in hand or takes a tense, because the opener
     * already has, and the Monday kickoff draws from here over a month or a
     * year too.
     */
    const NO_WINS = [
        'I see you putting in the effort, and I appreciate it!',
        'Appreciate you showing up and putting in the work every day.',
        'The effort you bring every day matters, and I see it.',
        'I see the work you\'re putting in, and I appreciate it.',
        'Thank you for the way you show up for our customers. It doesn\'t go unnoticed.',
        'I appreciate how you keep showing up and giving it your best.',
        'Your work ethic is something I really value on this team.',
        'I value how hard you work on every call.',
        'Thanks for the steady effort. It makes a difference to the team.',
        'Some weeks the numbers get all the attention, so I want to say it plainly: I see your effort and I appreciate it.',
        'Thank you for showing up and taking care of our customers.',
        'I appreciate the consistency in your effort. That counts for a lot.',
    ];
    /* The best true thing in the numbers, said first when nothing is on
     * target (see truePositiveFor). One pool per kind, each with its twin in
     * the present for a period still running. No line names the period: the
     * opener in front of it already has. `gap` is a move in words ("4
     * points", "14 seconds").
     */
    const TRUE_POSITIVE = {
        atGoal: [
            (label, val) => `Your ${label} was on target at ${val}. Nice work there.`,
            (label, val) => `${label} at ${val} was right where it needs to be. Good stuff.`,
        ],
        aboveCenter: [
            (label, val, center) => `Your ${label} at ${val} came in better than the center average of ${center}. That's a real strength.`,
            (label, val, center) => `${label} at ${val} beat the center average of ${center}. Nice work there.`,
        ],
        // Still a miss, so it is named as close, never as good news
        // (Scott, 2026-10-26).
        closest: [
            (label, val, target, gap) => `${label} was your closest to goal, ${val} with ${withArticle(target)} goal, ${gap} short.`,
            (label, val, target, gap) => `Your ${label} at ${val} came within ${gap} of the ${target} goal, the closest of all your numbers.`,
        ]
    };
    const TRUE_POSITIVE_ONGOING = {
        atGoal: [
            (label, val) => `Your ${label} is on target at ${val}. Nice work there.`,
            (label, val) => `${label} at ${val} is right where it needs to be. Good stuff.`,
        ],
        aboveCenter: [
            (label, val, center) => `Your ${label} at ${val} is better than the center average of ${center}. That's a real strength.`,
            (label, val, center) => `${label} at ${val} is beating the center average of ${center}. Nice work there.`,
        ],
        closest: [
            (label, val, target, gap) => `${label} is your closest to goal, ${val} with ${withArticle(target)} goal, so ${gap} to go.`,
            (label, val, target, gap) => `Your ${label} at ${val} is within ${gap} of the ${target} goal, the closest of all your numbers, and you can get there.`,
        ]
    };
    // --- Focus framing pools, keyed by how the period vs YTD look together ---
    //
    // "persistent" — both the period AND YTD are missing target (real trend)
    // "ytd_only"    — YTD is behind target but the period was fine (reverse the slide)
    // "week_only"   — the period dipped but YTD is solid (a blip)
    // "fallback"    — no YTD context available at all
    //
    // `when` names the period the value is from (last week, in September,
    // this year), from describeWeekRecency. Every line used to say "last week",
    // so a month's number went out labelled as a week's.
    //
    // Said as encouragement, the way Scott would say it across the desk
    // (2026-10-26): "This one needs real attention", "It's been a pattern, not
    // a blip" and "We need to turn this around" read as a scolding, and "628s
    // last week, YTD at 626s, target 426s" stacked three numbers in a row. Two
    // numbers to a sentence at most now, the goal always named, and the year
    // said in words.
    const FOCUS_PERSISTENT = [
        (label, val, ytdVal, target, when) => `${label} is the one I'd love us to work on together. You came in at ${val}${at(when)} with the goal at ${target}, so let's chip away at it.`,
        (label, val, ytdVal, target, when) => `Let's work on ${label} together. You landed at ${val}${at(when)}, and the year is at ${ytdVal}. The goal is ${target}, and I think we can get there a little at a time.`,
        (label, val, ytdVal, target) => `If there's one thing to go after, it's ${label}. You're at ${ytdVal} for the year with ${withArticle(target)} goal, and every call is a chance to bring it closer.`,
        (label, val, ytdVal, target, when) => `${label} is where I'd put our energy. You came in at ${val}${at(when)}, and ${target} is the goal. Small steps add up, and I'm right here with you.`,
    ];
    // "Pull the YTD back up" was said about handle time too, where up is the
    // wrong way. These name the target instead of a direction.
    const FOCUS_YTD_ONLY = [
        (label, val, ytdVal, target, when) => `Nice work on ${label}${at(when)} at ${val}. The year is still at ${ytdVal} with ${withArticle(target)} goal, so more stretches like that are how we get it there.`,
        (label, val, ytdVal, target, when) => `You had ${label} at ${val}${at(when)}, which is great. Keep that going, and that's how the year, at ${ytdVal} right now, gets to ${target}.`,
        (label, val, ytdVal, target, when) => `${label} is the one to keep pushing on. Hitting ${val}${at(when)} shows you can do it, and doing it again is what brings the year to ${target}.`,
    ];
    const FOCUS_WEEK_DIP = [
        (label, val, ytdVal, target, when) => `Quick note on ${label}: it dipped to ${val}${at(when)} with the goal at ${target}, but your year is solid at ${ytdVal}. Nothing to worry about, let's just get it back where it usually is.`,
        (label, val, ytdVal, target, when) => `${label} slipped to ${val}${at(when)}, but the year is still on target at ${ytdVal}. You know how to do this, so let's get back to normal.`,
        (label, val, ytdVal, target, when) => `${label} came in at ${val}${at(when)}, a little off your usual and the ${target} goal. Your year at ${ytdVal} says you've got this.`,
    ];
    const FOCUS_FALLBACK = [
        (label, val, target, when) => `${label} is the one I'd love us to work on. You came in at ${val}${at(when)} with the goal at ${target}, and I think you can get there.`,
        (label, val, target, when) => `Let's work on getting ${label} closer to ${target}. You came in at ${val}${at(when)}, and every call is a chance to move it.`,
        (label, val, target, when) => `If I had to pick one thing, it'd be ${label}. You landed at ${val}${at(when)}, with ${withArticle(target)} goal to aim for.`,
        (label, val, target, when) => `${label} is where I'd focus next. You came in at ${val}${at(when)}, and ${target} is the goal. Let's close that together.`,
    ];
    /* The focus metric is the one the praise just credited.
     *
     * The check-in led with "Average Handle Time, -41s!" and followed it with
     * "This one needs real attention. We need to turn this around." about the
     * same number. Scott, 2026-10-14: credit the move and set the next stop.
     * `val` is where it is now and `target` the stop after it.
     */
    const FOCUS_IMPROVING = [
        (label, val, target) => `${label} is heading the right way, nice. You're at ${val} now, and the next stop is ${target}.`,
        (label, val, target) => `Keep doing what you did on ${label}. ${val} is real progress, and ${target} is the next stop.`,
        (label, val, target) => `That ${label} move is exactly what we want. Next stop is ${target}, and you're already at ${val}.`,
        (label, val, target) => `${label} is moving in the right direction. Let's keep it going from ${val}, next stop ${target}.`,
    ];
    /* Sign-offs, chosen by how the message went.
     *
     * "Good stuff. Let's keep the momentum going." used to close a message
     * whose focus line had just said a metric keeps missing. The warm ones
     * stay warm; the support ones are for a message that is asking for work.
     */
    const CLOSERS = [
        'Keep it up! Let me know if you need anything.',
        'Solid work. I\'m here if you want to chat about anything.',
        'Keep doing your thing. Reach out if you need me.',
        'Good stuff. Let\'s keep the momentum going.',
        'Nice work. My door\'s always open.',
        'Appreciate you. Let\'s have a good one.',
        'Keep at it. Rooting for you.',
        'That\'s all I got. Go have a great one.',
        'Onward. I\'m always just a message away.',
    ];
    const CLOSERS_SUPPORT = [
        'I\'m in your corner on this one. Let me know what would help.',
        'We\'ll get there together. Reach out anytime.',
        'Let me know if you want to dig into any of this together.',
        'Catch me anytime if you want to talk through anything.',
        'Rooting for you. My door\'s always open.',
        'Appreciate the effort. Holler if anything comes up.',
        'You\'ve got this, and I\'ve got you. Talk soon.',
    ];
    // Said when every metric the message can talk about is on target, because
    // naming two of twelve made a clean sweep sound like an ordinary week.
    const FULL_SWEEP = [
        (count) => `And every one of your ${count} goals is at or above target. That's a clean sweep.`,
        (count) => `On target on all ${count} of your goals, too. That's as good as it gets.`,
        (count) => `Every goal on the board, all ${count} of them, is where it needs to be. Love it.`,
    ];
    const FULL_SWEEP_ONGOING = [
        (count) => `And every one of your ${count} goals is at or above target so far. That's a clean sweep.`,
        (count) => `On target on all ${count} of your goals so far, too. That's as good as it gets.`,
        (count) => `Every goal on the board, all ${count} of them, is where it needs to be. Love it.`,
    ];
    /*
     * KICKOFF OPENERS
     *
     * Three plans start from this generator: Monday, the Tuesday follow-up and
     * the weekend recap. Ten of the twelve openers named Monday outright, so
     * running a Tuesday follow-up the day after a holiday Monday greeted
     * everybody with "Monday's here Destiny!". A message that opens by naming
     * a day the associate did not work is one she stops trusting on the first
     * line, before any of the numbers underneath get read.
     *
     * Two pools now. One for the day that actually opens the week, which takes
     * the day word rather than assuming it, so a week that starts on Tuesday
     * says Tuesday. One for a day that picks up an already running week, which
     * makes no claim about a new week at all.
     *
     * Which pool is a question for the caller. A Tuesday with Monday's numbers
     * in hand is a follow-up; a Tuesday with no Monday at all, because nobody
     * worked it, is the start of the week.
     */
    const MK_OPENERS_WEEK_START = [
        (name, day) => `Happy ${day} ${name}! 🌟 New week, let's talk about where you stand and where we're headed.`,
        (name) => `Hey ${name}! ☀️ Kicking off the week with your numbers and a game plan.`,
        (name) => `Morning ${name}! 🚀 Start of a new week. Here's your snapshot and what to focus on.`,
        (name, day) => `${name}! ${day} check-in time. 📊 Let's celebrate what's working and lock in a plan.`,
        (name, day) => `Good morning ${name}! 💪 Quick ${day} rundown on your wins and where we can push.`,
        (name) => `Hey ${name}, let's get this week started right. Here's where things landed. ☕`,
        (name) => `${name}! Fresh week ahead. Let's look at what's going well and set a target. 🎯`,
        (name) => `Top of the week ${name}! Here's your latest numbers and our focus for the days ahead.`,
        (name) => `Rise and shine ${name}! 🌅 Let me share your numbers and set us up for a strong week.`,
        (name, day) => `${day}'s here ${name}! Quick peek at your results and what to aim for this week.`,
        (name) => `${name}! Let's take a look at where you are and where we're headed this week. 📈`,
        (name) => `Hey ${name}! Starting the week off by looking at your wins and setting a focus. Let's go!`,
    ];

    // The week is already running. Nothing here calls it new, and nothing
    // names a day the caller has not confirmed happened.
    const MK_OPENERS_MIDWEEK = [
        (name) => `Morning ${name}! 📊 Picking up where we left off. Here's where things stand.`,
        (name, day) => `Hey ${name}! Quick ${day} look at your numbers and what to keep pushing on.`,
        (name) => `${name}! Checking back in. 📈 Here's the read and where I want us focused.`,
        (name) => `Good morning ${name}! Following up with your latest numbers and the plan from here.`,
        (name, day) => `Hey ${name}, ${day} catch up. Let's look at what has landed and where to push. ☕`,
        (name) => `${name}! Here's your latest snapshot and the one thing I want us on. 🎯`,
        (name) => `Morning ${name}! 🌅 Rounding up where your numbers sit and where we go next.`,
        (name) => `Hey ${name}! Circling back on your results and where I want us focused.`,
    ];

    /*
     * WHICH STRETCH, AGAINST WHICH
     *
     * Under a month or a year window every tone writes through the kickoff,
     * and its openers were written for weeks. "Following up with your latest
     * numbers" over October so far never said what the numbers were, or what
     * they were being held up against. Scott, 2026-10-14, on a month to date
     * round: it should say this is where your month is, and this is how it
     * compares to last month.
     *
     * So under those windows the opener names both sides, and a short line
     * under the praise shows what moved since the baseline, in the baseline's
     * own name. A week window keeps the openers above; the week progress text
     * it writes through already says "next to last week".
     */
    const FRAME_GREETINGS = [
        (name) => `Hey ${name}!`,
        (name) => `Morning ${name}!`,
        (name) => `${name}!`,
        (name, day) => `Happy ${day} ${name}!`,
    ];
    const FRAME_OPENERS = {
        ongoing: [
            (now, prior) => `Here's where ${now} stands so far, next to ${prior}.`,
            (now, prior) => `Checking in on ${now} so far and how it compares to ${prior}.`,
            (now, prior) => `Here's ${now} so far, side by side with ${prior}.`,
            (now, prior) => `Quick look at how ${now} is going so far against ${prior}.`,
        ],
        done: [
            (now, prior) => `Here's how ${now} finished, next to ${prior}.`,
            (now, prior) => `Looking back at ${now} and how it compares to ${prior}.`,
            (now, prior) => `Here's ${now}, side by side with ${prior}.`,
            (now, prior) => `Quick look at how ${now} went against ${prior}.`,
        ],
        // Nothing to hold it against. The opener still names the stretch and
        // says nothing about why there is no comparison.
        ongoingAlone: [
            (now) => `Here's where ${now} stands so far.`,
            (now) => `Quick look at how ${now} is going so far.`,
        ],
        doneAlone: [
            (now) => `Here's how ${now} finished.`,
            (now) => `Quick look at how ${now} went.`,
        ],
    };

    // Lines that lean on wins just said. "With those wins in mind" used to
    // follow a message with no wins in it, or a "Behind September" list
    // (Scott, 2026-10-14), so these are only drawn when praise really is the
    // last thing the reader saw.
    const MK_TRANSITION = [
        'Love the wins. Now here\'s the game plan for this week.',
        'Let\'s build on that momentum with a focus area.',
        'Great foundation. Here\'s where I want us to focus.',
        'With those wins in mind, here\'s where I think you can grow next.',
    ];
    // True after anything: wins, a slide, or an effort line.
    const MK_TRANSITION_NEUTRAL = [
        'Now let\'s talk about where we can push this week.',
        'Here\'s where I think we can make a move.',
        'There\'s a spot where I think you can really level up.',
        'Now let\'s zero in on where we can improve.',
        'Alright, here\'s the play for this week.',
        'Here\'s the one thing I want us to be intentional about.',
    ];
    // --- Kickoff focus pools, keyed by period vs YTD combo ---
    //
    // Two time words, because the focus line looks both ways. `when` is the
    // period the number is from (last week, in September). `ahead` is the
    // stretch the focus is for: this week, or next week when the tone is
    // Friday's, which is the day the week in front of us is the next one.
    const MK_FOCUS_PERSISTENT = [
        (label, val, ytdVal, target, when, ahead) => `Let's go after ${label} ${ahead}. You came in at ${val}${at(when)}, and the goal is ${target}. I think we can chip away at it together.`,
        (label, val, ytdVal, target, when, ahead) => `${label} is the one I'd love us to work on ${ahead}. The year is at ${ytdVal} with ${withArticle(target)} goal, and small improvements add up.`,
        (label, val, ytdVal, target, when, ahead) => `I think you can move ${label} ${ahead}. You came in at ${val}${at(when)} with the goal at ${target}, and I'll help however you need.`,
        (label, val, ytdVal, target, when, ahead) => `My one ask ${ahead} is to be intentional about ${label}. You came in at ${val}${at(when)}, and ${target} is the goal.`,
    ];
    const MK_FOCUS_YTD_ONLY = [
        (label, val, ytdVal, target, when) => `Love that ${label} came in at ${val}${at(when)}. Let's make that the norm, because that's how the year, at ${ytdVal} now, gets to ${target}.`,
        (label, val, ytdVal, target, when) => `Let's keep doing what you did on ${label}${at(when)}. More stretches like ${val} are what bring the year to ${target}.`,
        (label, val, ytdVal, target, when, ahead) => `${label} is the one to keep pushing ${ahead}. Hitting ${val}${at(when)} was the right direction, and the year is still working its way to ${target}.`,
    ];
    const MK_FOCUS_WEEK_DIP = [
        (label, val, ytdVal, target, when) => `Just one small thing: ${label} dipped to ${val}${at(when)} with the goal at ${target}. Your year is solid at ${ytdVal}, so it's a one-off. Let's get it back.`,
        (label, val, ytdVal, target, when, ahead) => `Let's reset on ${label} ${ahead}. You landed at ${val}${at(when)}, but your year at ${ytdVal} says you know how to do this.`,
        (label, val, ytdVal, target, when) => `${label} slipped to ${val}${at(when)}, a little off your usual. The year is still on target at ${ytdVal}, so you're in good shape.`,
    ];
    const MK_FOCUS_FALLBACK = [
        (label, val, target, when, ahead) => `Let's go after ${label} ${ahead}. You came in at ${val}${at(when)}, and the goal is ${target}.`,
        (label, val, target, when, ahead) => `${label} is the one I'd love us to work on ${ahead}. You came in at ${val}${at(when)} with ${withArticle(target)} goal to aim for, and I think you can get there.`,
        (label, val, target, when, ahead) => `I think you can move ${label} ${ahead}. You landed at ${val}${at(when)}, and ${target} is the goal.`,
        (label, val, target, when, ahead) => `My one ask ${ahead} is to be intentional about ${label}. You came in at ${val}${at(when)}, aiming for ${target}.`,
    ];
    const MK_ALL_GOOD = [
        'You\'re hitting target across the board. Incredible work. Let\'s keep that going this week!',
        'All metrics on target. That\'s rare and it\'s impressive. Keep doing what you\'re doing.',
        'Everything is clicking right now. The goal this week is simple: maintain.',
        'You\'re on target everywhere. That level of consistency is hard to achieve. Nice work.',
    ];
    const MK_CLOSERS = [
        'Let\'s have a great week. I\'m here if you need anything! 💪',
        'That\'s the plan. Let me know if you want to talk through anything.',
        'Excited for this week. Reach out anytime.',
        'You\'ve got this. Let\'s go make it happen. 🔥',
        'Go crush it this week. My door\'s open.',
        'Ready when you are. Let\'s have a strong week.',
        'Looking forward to seeing you attack this. Let me know how I can help.',
        'Go get it. I\'m in your corner. 🙌',
        'Simple plan, big results. Let\'s do it.',
        'That\'s the game plan. Now let\'s execute. 🚀',
    ];

    // --- Midweek Check-In phrase pools ---
    const MW_OPENERS = [
        name => `Hey ${name}! Celebratory midweek check-in. 📊`,
        name => `${name}! Halfway through the week and you're doing great. Quick pulse check.`,
        name => `Midweek pulse check, ${name}. Love the momentum so far.`,
        name => `Hey ${name}, quick midweek update with some wins to celebrate.`,
        name => `${name}! We're halfway there and building strong. Quick look at the numbers. ⏱️`,
        name => `Checking in ${name}, the week is taking shape and you're in it.`,
        name => `Hey ${name}, quick ${getCurrentWeekdayName()} update. Plenty to be proud of already. 📈`,
        name => `${name}, midweek check. You're giving yourself a real shot this week.`,
        name => `Halfway through the week ${name}! Quick status update and some encouragement.`,
        name => `${name}! Real quick midweek look at the progress you've made.`,
        name => `Quick midweek nudge, ${name}. You're moving in the right direction.`,
        name => `Hey ${name}, touching base midweek with a little extra encouragement.`,
        name => `${name}, taking a quick pulse on the week.`,
        name => `Hey ${name}, wanted to check in real quick. 📊`,
        name => `${name}! Pulled up the numbers midweek and wanted to share what I'm seeing.`,
        name => `${getCurrentWeekdayName()} check-in, ${name}. You've been putting in work.`,
        name => `${name}, dropping in midweek with a quick look at where you stand.`,
        name => `Had to reach out, ${name}. This week is shaping up.`,
        name => `${name}, wanted to pop in with a midweek update.`,
        name => `Quick check-in, ${name}. Let's see how the week is landing.`,
        name => `${name}! Midweek and I'm liking what I see. 👀`,
        name => `Hey ${name}, pausing to give you some midweek feedback.`,
        name => `${name}, just ran the midweek numbers and wanted to share.`,
        name => `Been watching your week, ${name}. Quick note midweek.`,
        name => `${name}, real quick. Wanted you to see where you're tracking.`,
        name => `${name}! Stealing a minute of your ${getCurrentWeekdayName()} to talk numbers.`,
        name => `Hey ${name}, sliding in with a midweek read.`,
        name => `${name}, three days in and I've got thoughts. 📊`,
        name => `Appreciate you, ${name}. Quick midweek note.`,
        name => `${name}, don't want to interrupt. Just a quick midweek status.`,
        name => `Before you get deep into the afternoon, ${name}, a quick check-in.`,
        name => `${name}, stepped away from the dashboard to send you this midweek note.`,
    ];
    // Nothing in here names the day the focus was set. Three lines used to say
    // Monday, and a week that opens on a Tuesday because Monday was a holiday
    // makes those a claim about a conversation that never happened. "This
    // week" and "to start the week" are true whichever day the week started.
    const MW_FOCUS_RECALL = [
        (label) => `Earlier this week we said ${label} was the focus.`,
        (label) => `We set ${label} as your target this week.`,
        (label) => `Remember, our game plan was to push on ${label}.`,
        (label) => `Our focus area this week has been ${label}.`,
        (label) => `We talked about zeroing in on ${label} this week.`,
        (label) => `The plan was to attack ${label} this week.`,
        (label) => `${label} was the metric we wanted to own this week.`,
        (label) => `You've been working on ${label} this week.`,
        (label) => `${label} is the one we picked to work on this week.`,
        (label) => `This week's focus has been ${label}.`,
        (label) => `We zeroed in on ${label} as the metric to move.`,
        (label) => `The one we locked in on this week: ${label}.`,
        (label) => `You've had ${label} in your sights all week.`,
        (label) => `${label} was the priority we landed on to start the week.`,
        (label) => `We picked ${label} to work on together this week.`,
        (label) => `The number you've been hunting this week is ${label}.`,
        (label) => `${label} is where we pointed the attention this week.`,
        (label) => `Our commitment this week was to lean into ${label}.`,
        (label) => `Coming into the week, the call was to move ${label}.`,
        (label) => `${label} is the one we put on the board to start the week.`,
    ];
    const MW_ON_TRACK = [
        (label, val, target) => `You're crushing it. ${label} at ${val} is already past the ${target} target!`,
        (label, val, target) => `Great news: ${label} is at ${val}, beating the ${target} target. Proud of this.`,
        (label, val, target) => `${label} at ${val} is on target (${target}) and that's a real midweek win.`,
        (label, val, target) => `Look at that. ${label} at ${val} is hitting the mark (${target}). Love it.`,
        (label, val, target) => `You're doing it! ${label} at ${val} is right where we want it (${target}). Strong work.`,
        (label, val, target) => `${label} at ${val} is at or above ${target}. The focus is clearly paying off!`,
        (label, val, target) => `${label} at ${val} vs ${target} target? That's a win worth celebrating.`,
        (label, val, target) => `The work on ${label} is showing. ${val} against ${withArticle(target)} target is legit progress.`,
        (label, val, target) => `${label} at ${val} is through the ${target} bar. That's what showing up looks like.`,
        (label, val, target) => `Already hitting it on ${label}. ${val} vs ${target} target. Fantastic.`,
        (label, val, target) => `This is the stuff. ${label} at ${val}, target is ${target}. Nailing it.`,
        (label, val, target) => `Goal met. ${label} sitting at ${val} (target ${target}). Keep it rolling.`,
        (label, val, target) => `You're there. ${label} at ${val} is clearing ${target}. That's the formula.`,
        (label, val, target) => `${label} at ${val} is right on track for the ${target} goal.`,
        (label, val, target) => `The ${label} number (${val}) is past ${target}. Don't let up, but take a second to feel good about that.`,
        (label, val, target) => `Over the line already. ${label} at ${val}, target ${target}. Big deal.`,
        (label, val, target) => `${label} at ${val} is a real midweek statement. ${target} is the ask and you're past it.`,
    ];
    const MW_CLOSE = [
        (label, val, target, gap) => `You're close. ${label} at ${val}, just ${gap} from ${target}. That's exciting momentum.`,
        (label, val, target, gap) => `${label} is at ${val}, only ${gap} from ${target}. You are right there.`,
        (label, val, target, gap) => `Almost there on ${label}! At ${val}, you're ${gap} from ${target}. Great position midweek.`,
        (label, val, target, gap) => `${label} at ${val} is so close to ${target} (just ${gap} away). This is very doable.`,
        (label, val, target, gap) => `Getting there! ${label} at ${val}, ${gap} to go before ${target}. Love the progress.`,
        (label, val, target, gap) => `The gap on ${label} is shrinking. ${val} vs ${target}, just ${gap} to go. Keep building.`,
        (label, val, target, gap) => `${label} is at ${val}, ${gap} from ${target}. That's absolutely closeable this week.`,
        (label, val, target, gap) => `You're in striking distance on ${label}. ${val} now, ${target} goal, ${gap} to go.`,
        (label, val, target, gap) => `${label} is within reach. ${val} now, ${target} target, only ${gap} between.`,
        (label, val, target, gap) => `You can see the finish line on ${label}. ${val} today, ${gap} from ${target}.`,
        (label, val, target, gap) => `${label} is knocking on the door. ${val} vs ${target}, just ${gap}. One good stretch closes it.`,
        (label, val, target, gap) => `Super close on ${label}. ${val} vs ${target}, ${gap} off. A couple intentional calls gets you there.`,
        (label, val, target, gap) => `${label} at ${val} is a whisper away from ${target}. Only ${gap} separates you.`,
        (label, val, target, gap) => `You're on the doorstep with ${label}, ${val} now and ${gap} from ${target}.`,
        (label, val, target, gap) => `Almost. ${label} at ${val}, ${gap} shy of ${target}. That's a finish-the-week problem, nothing bigger.`,
        (label, val, target, gap) => `${label} is trending right where we want it. ${val} now, ${gap} from ${target}. Stay on it.`,
        (label, val, target, gap) => `You're setting up ${label} to land. ${val} vs ${target}, ${gap} left on the table.`,
    ];
    const MW_BEHIND = [
        (label, val, target, gap) => `${label} is at ${val}, still ${gap} from the ${target} target. But we've got time. Let's be intentional about it.`,
        (label, val, target, gap) => `We've got some ground to cover on ${label}, ${val} with ${gap} to go to ${target}. Let's go get it.`,
        (label, val, target, gap) => `${label} at ${val} is a stretch from ${target}, ${gap} away, but every call is a chance to move it.`,
        (label, val, target, gap) => `${label} is at ${val}, ${gap} from ${target}. Let's make these last few days count.`,
        (label, val, target, gap) => `${label} is sitting at ${val}, ${gap} short of ${target}. Not where we want it yet, but the week isn't over.`,
        (label, val, target, gap) => `${label} is at ${val} with ${gap} to go to ${target}. Let's focus on what we can control.`,
        (label, val, target, gap) => `${label} is at ${val} with ${withArticle(target)} goal. That's ${gap} to make up, and I've seen you close bigger ones.`,
        (label, val, target, gap) => `${label} is at ${val}, ${gap} from ${target}, and there's still time to move it.`,
        (label, val, target, gap) => `I'd love to see ${label} move before the week is out. You're at ${val}, ${gap} from ${target}.`,
        (label, val, target, gap) => `${label} at ${val} has ${gap} to go to ${target}, and we can turn it this week.`,
        (label, val, target, gap) => `${label} could use a push. You're at ${val} with ${gap} to go to ${target}, and two days can still move it.`,
        (label, val, target, gap) => `${label} isn't quite where we want it yet, ${val} and ${gap} shy of ${target}. A few intentional calls will help.`,
        (label, val, target, gap) => `${label} is at ${val}, ${gap} from ${target}. Let's refocus on it together.`,
        (label, val, target, gap) => `On ${label}, you're at ${val} with ${gap} to climb to ${target}, and that's very fixable.`,
        (label, val, target, gap) => `${label} at ${val} is the one to work on, ${gap} from ${target}. Let's go get it together.`,
        (label, val, target, gap) => `${label} is the one that could use some love right now, ${val} and ${gap} from ${target}. Very doable.`,
        (label, val, target, gap) => `Let's finish the week pushing on ${label}. You're at ${val}, ${gap} from ${target}.`,
    ];
    const MW_NO_FOCUS_SET = [
        'Here\'s a quick look at how the week is going so far.',
        'Wanted to check in on how things are trending this week.',
        'Quick midweek snapshot of where you\'re at.',
        'Pulling the curtain back on where you stand this week.',
        'Wanted to send over a quick read on the week so far.',
        'Here\'s the midweek picture as I see it.',
        'Dropping in with a snapshot of how the week is shaping up.',
        'A quick look at the week before you close it out.',
        'Wanted to get eyes on where the week sits right now.',
        'Here\'s where things stand with a couple days to go.',
        'Scanned the numbers and wanted to share what I\'m seeing.',
        'Quick read on the week before it gets away from us.',
    ];
    const MW_NO_DATA_YET = [
        (label) => ` No updated data for ${label} yet, but keep being intentional about it.`,
        (label) => ` No fresh numbers on ${label} yet. Stay locked in on it.`,
        (label) => ` ${label} hasn't refreshed yet, but keep treating it like it's the one.`,
        (label) => ` Haven't seen the ${label} numbers update, but don't take your foot off it.`,
        (label) => ` We don't have new ${label} data yet, but the work still matters.`,
        (label) => ` ${label} isn't showing fresh yet. Keep pushing like it is.`,
    ];
    const MW_FALLBACK_FOCUS = [
        (label, cur, tgt) => `\n\nThe one I'd focus on for the rest of the week is ${label}, at ${cur} with ${withArticle(tgt)} goal.`,
        (label, cur, tgt) => `\n\nIf you ask me what to lean into the rest of the week, it's ${label}. You're at ${cur}, and the goal is ${tgt}.`,
        (label, cur, tgt) => `\n\nThe one I'd chase down is ${label}, ${cur} now with the goal at ${tgt}.`,
        (label, cur, tgt) => `\n\nIf there's one thing to work on the rest of this week, it's ${label}. You're at ${cur}, aiming for ${tgt}.`,
        (label, cur, tgt) => `\n\nFor the next couple of days, I'd focus on ${label}, sitting at ${cur} against ${withArticle(tgt)} target.`,
        (label, cur, tgt) => `\n\nI'd spend the attention on ${label}. You're at ${cur} right now, and ${tgt} is the goal.`,
    ];
    const MW_BRIGHT_SIDE = [
        (label, val) => ` On the bright side, ${label} at ${val} is looking good.`,
        (label, val) => ` The good news: ${label} at ${val} is right where we want it.`,
        (label, val) => ` Want to point out that ${label} at ${val} is a bright spot.`,
        (label, val) => ` One thing to feel good about: ${label} at ${val}.`,
        (label, val) => ` Worth mentioning that ${label} at ${val} is holding strong.`,
        (label, val) => ` And don't miss it. ${label} at ${val} is a win.`,
    ];
    const MW_CLOSERS = [
        'Proud of you. Let me know how I can help.',
        'Proud of you. Let me know how I can help as you finish the week.',
        'Proud of you. Let me know how I can help keep this momentum going.',
        'Proud of you. Let me know how I can help you close strong.',
        'Proud of the work you\'re putting in. Holler if I can do anything to support.',
        'You know where to find me if anything comes up. Finish strong.',
        'Keep at it. I\'m in your corner if you need something.',
        'You\'re doing the work. Let me know what would help from my end.',
        'Hit me up if anything gets in the way. Love what you\'re doing.',
        'Backing you the rest of the week. Shout if you need something.',
        'If there\'s anything I can take off your plate, say the word.',
        'Grateful to have you on the team. Reach out if you need a hand.',
        'Whatever you need from me, just ask. Close it out strong.',
        'I see the effort. Tell me how I can make this easier for you.',
        'Keep being you. Let me know if I can help in any way.',
        'You\'ve got this. Ping me if something needs unblocking.',
        'Finish the week the way you\'ve started it. I\'m here if you need me.',
        'Appreciate what you\'re bringing. Let me know how I can support.',
        'In your corner the rest of the week. Hit me up if you need anything.',
        'Keep building. Door\'s open if you want to talk it through.',
        'Thanks for the effort. Tell me what would help from here.',
        'Go close it out. Message me anytime.',
    ];

    // A high five goes out whenever the week backs one, which is often not a
    // Friday. These openers say nothing about what day it is. One emoji each:
    // the opener's and the sign-off's are the two a message keeps.
    const HF_OPENERS = [
        name => `Hey ${name}! 🎉`,
        name => `${name}! 🙌`,
        name => `Yo ${name}! 🎉`,
        name => `What a run, ${name}! 🎉`,
        name => `${name}! Gotta give credit where it's due. 🎉`,
        name => `${name}, you need to see these numbers. 🎉`,
        name => `Hey ${name}, just wanted to highlight your numbers real quick. 🎉`,
        name => `${name}, dropping in with something worth celebrating. 🎉`,
        name => `Had to stop what I was doing and send this, ${name}! 🎉`,
        name => `Big props coming your way, ${name}! 🎉`,
        name => `${name}! Pulled your numbers up and had to say something. 🎉`,
        name => `Hey ${name}, this one deserves a callout. 🎉`,
    ];
    // Only drawn from when the weekend is actually in reach. Telling someone on
    // a Tuesday to enjoy their weekend is how a real shout-out starts reading
    // like a template.
    const HF_OPENERS_WEEKEND = [
        name => `${name}, had to send you this before the weekend! 🎉`,
        name => `Real quick, ${name}, before you head out for the weekend. 🎉`,
        name => `Couldn't let the week end without saying something, ${name}! 🎉`,
        name => `${name}! Wrapping up the week and had to share this. 🎉`,
        name => `Quick shoutout before the weekend, ${name}! 🎉`,
    ];
    /* A high five with nothing on target to name.
     *
     * "Lupe, you need to see these numbers. 🎉" over a message with no numbers
     * in it, signed off "Hard to top a showing like that" (Scott, 2026-10-14).
     * Nothing here promises numbers, and nothing assumes the week went well:
     * it thanks them for the work and names one goal, gently.
     */
    const HF_OPENERS_EFFORT = [
        name => `Hey ${name}! 👋`,
        name => `${name}, quick note for you. 👋`,
        name => `Hey ${name}, wanted to take a second for you.`,
        name => `${name}! Just a quick one from me.`,
    ];
    // `when` names the week the upload actually covers, which is usually not
    // the one in flight. See describeWeekRecency. `delta` is the move in words
    // ("down 40 seconds") and `range` the two numbers ("66s to 26s"): "When I
    // saw Hold Time at -40s" read as though hold time was minus forty seconds.
    const HF_JUMP = [
        (label, delta, range, when) => `Incredible move in ${label}${at(when)}, ${delta}, from ${range}! That kind of progress stands out.`,
        (label, delta, range, when) => `You moved ${label} in a big way${at(when)}, ${delta}, from ${range}! That's impressive.`,
        (label, delta, range, when) => `${label} took a real swing${at(when)}, ${delta}, from ${range}! Love to see it.`,
        (label, delta, range, when) => `The progress on ${label}${at(when)} is awesome, ${delta}, from ${range}! Keep that energy.`,
        (label, delta, range, when) => `Your ${label} moved ${delta}${at(when)}, from ${range}, and honestly it's one of the best improvements I've seen.`,
        (label, delta, range, when) => `Moving ${label} ${delta}${at(when)}, from ${range}, is worth celebrating. That took real effort.`,
        (label, delta, range, when) => `${label} took a big step${at(when)}, ${delta}, from ${range}. You should feel good about that.`,
        (label, delta, range, when) => `I have to point out that ${label} swing${at(when)}, ${delta}, from ${range}. That's not easy to do.`,
        (label, delta, range, when) => `When I saw ${label} come ${delta}${at(when)}, from ${range}, I knew I had to say something.`,
        (label, delta, range, when) => `The kind of improvement you showed on ${label}${at(when)}, ${delta}, from ${range}, doesn't happen by accident.`,
    ];
    const HF_TWO_WINS = [
        (l1, v1, l2, v2, when) => `Your ${l1} at ${v1} and ${l2} at ${v2} were outstanding!`,
        (l1, v1, l2, v2, when) => `${l1} at ${v1} and ${l2} at ${v2}? Absolutely killing it!`,
        (l1, v1, l2, v2, when) => `Crushed it on ${l1} (${v1}) and ${l2} (${v2})${at(when)}!`,
        (l1, v1, l2, v2, when) => `${l1} at ${v1} and ${l2} at ${v2} are both legit impressive.`,
        (l1, v1, l2, v2, when) => `Between ${l1} at ${v1} and ${l2} at ${v2}, you had one heck of a run.`,
        (l1, v1, l2, v2, when) => `I mean, ${l1} at ${v1} AND ${l2} at ${v2}? Come on now.`,
        (l1, v1, l2, v2, when) => `Your ${l1} (${v1}) and ${l2} (${v2}) were both standout numbers${at(when)}.`,
        (l1, v1, l2, v2, when) => `Two words: ${l1} at ${v1}. Two more: ${l2} at ${v2}. Just great.`,
        (l1, v1, l2, v2, when) => `${l1} at ${v1}, ${l2} at ${v2}. That's the kind of stretch you want to have.`,
        (l1, v1, l2, v2, when) => `Can we talk about ${l1} at ${v1} and ${l2} at ${v2}? Because those are excellent.`,
    ];
    const HF_ONE_WIN = [
        (label, val, when) => `Your ${label} at ${val} was outstanding!`,
        (label, val, when) => `${label} at ${val}? That's what I'm talking about!`,
        (label, val, when) => `Killed it on ${label} at ${val}${at(when)}!`,
        (label, val, when) => `Your ${label} coming in at ${val} is seriously impressive.`,
        (label, val, when) => `${label} at ${val} was the highlight and it deserves a callout.`,
        (label, val, when) => `I saw your ${label} at ${val} and honestly just wanted to say great job.`,
        (label, val, when) => `That ${label} number at ${val}? Chef's kiss.`,
        (label, val, when) => `${label} at ${val} tells me everything about how you showed up${at(when)}.`,
        (label, val, when) => `Huge props on ${label} at ${val}. That's no small thing.`,
        (label, val, when) => `Let's be real, ${label} at ${val} is just flat out good.`,
    ];
    const HF_NO_WINS = [
        when => `I wanted to recognize your effort${at(when)}. You showed up and put in the work, and that matters.`,
        when => 'Just want you to know I see the grind. Keep at it.',
        when => `Appreciate the effort you put in${at(when)}. It doesn't go unnoticed.`,
        when => 'The numbers are one thing, but showing up every day is the foundation. You did that.',
        when => `I wanted to take a sec to acknowledge your work${at(when)}. It matters more than you think.`,
        when => 'Not every stretch is going to be flashy, but the work ethic you bring is what builds a great track record.',
        when => 'I see you out there putting in the work. That consistency is going to pay off.',
        when => 'Wanted to make sure you know that the effort hasn\'t gone unnoticed. Keep going.',
    ];
    // One goal, named gently, under an effort high five. `close` is how far
    // one good stretch gets them, worded for the size of the gap.
    const HF_GOAL_NUDGE = [
        (label, val, target, gap, close) => `${label} is at ${val}, about ${gap} from the ${target} goal. ${close}, and I'm in your corner.`,
        (label, val, target, gap, close) => `The one I'd love to see move next is ${label}: ${val} now, with the goal at ${target}. ${close}, and I'm right here with you.`,
        (label, val, target, gap, close) => `If you want something to aim at, ${label} is ${gap} from the ${target} goal. ${close}, and I've got your back.`,
    ];
    // At most two wins are named, then a count, so a strong week reads as a
    // strong week instead of a list of nine numbers (Scott, 2026-10-14).
    const HF_EXTRAS = [
        extras => `On top of that, ${extras}. You're on a roll!`,
        extras => `And ${extras} too? You're firing on all cylinders.`,
        extras => `Plus ${extras}. Just an all-around great showing.`,
        extras => `Not to mention ${extras}. Seriously impressive.`,
        extras => `${capFirst(extras)} too, and that's a lot to be proud of.`,
        extras => `And to top it all off, ${extras}. Love it.`,
        extras => `Then there's ${extras} on top of everything else. ${hypeYou(false)}.`,
        extras => `Can't forget about ${extras} either. Just stacking wins.`,
    ];
    // Only when every goal the message can speak to is on target. "You've
    // basically had the perfect run" went to someone over the AHT target.
    // `extras` can end "and every other goal too", so the sentence stops
    // there rather than adding a second "and".
    //
    // "There's nothing left to ask for" and "basically the perfect run" were
    // the only two, so they went out about 390 times each in one audit, and
    // "run" landed twice in 42 messages that opened "What a run" (10/25).
    const HF_EXTRAS_SWEEP = [
        extras => `On top of that: ${extras}. That's about as complete as it gets.`,
        extras => `Plus ${extras}. There's nothing left to ask for.`,
        extras => `And ${extras}. Every box checked.`,
        extras => `${capFirst(extras)}, too. Honestly, that's everything.`,
    ];
    const HF_CONSISTENCY = [
        (on, total) => `${on} out of ${total} goals hitting target, that's consistency right there.`,
        (on, total) => `${on} of ${total} goals on target. That's not luck, that's discipline.`,
        (on, total) => `Hitting target on ${on} out of ${total} goals. Consistency is your thing.`,
        (on, total) => `${on} of ${total} at or above target. You're dialed in across the board.`,
        (on, total) => `When ${on} out of ${total} goals are hitting, that tells me you're doing things right.`,
        (on, total) => `${on} of ${total} on target? That's what we call well-rounded performance.`,
        (on, total) => `Landing ${on} out of ${total} goals shows real balance. That's hard to do.`,
        (on, total) => `${on} of ${total} on target. You're putting in the work everywhere.`,
    ];
    // Sign-offs that work on any day of the week, for a high five with wins.
    const HF_CLOSERS = [
        'Awesome job. Have a good one!',
        'Nothing left to say except well done. Have a great one.',
        'You earned this one. Go enjoy it.',
        'Credit where it\'s due. Really nice work.',
        'Keep that going. Proud of you.',
        'Just wanted you to hear it from me. Great work.',
        'Well done. Keep stacking numbers like this.',
        'Proud to have you on this team.',
        'Take the win, then keep rolling.',
        'That is the standard now. Love it.',
        'Great stuff. Keep doing what you\'re doing.',
        'Hard to top a showing like that. Well done.',
    ];
    // Held back until the weekend is actually in reach.
    const HF_CLOSERS_WEEKEND = [
        'Proud of you. Enjoy your weekend!',
        'Have a great weekend. You earned it!',
        'Enjoy the weekend, you deserve it!',
        'Great week. Go relax, you\'ve earned it!',
        'Seriously, great work. Now go enjoy your days off.',
        'Take this good energy into the weekend. You crushed it.',
        'That\'s a wrap on a great week. Rest up and recharge.',
        'Way to finish the week strong. See you Monday.',
        'Go do something fun this weekend, you earned it.',
        'I love ending the week on a high note like this. Enjoy!',
        'Couldn\'t be happier with how this week went. Relax and come back refreshed.',
    ];
    // A high five carried by one real move and nothing yet on target. The
    // praise is true, but "What a run" and "Hard to top a showing like that"
    // oversell one number to somebody still short on the rest.
    const HF_OVERSELL = /What a run|need to see these numbers|Hard to top|That is the standard now|Heck of a run|Nothing left to say|great week|crushed it|Couldn't be happier|high note|finish the week strong/i;
    // For the effort high five. Warm, and true whatever the numbers said.
    const HF_CLOSERS_EFFORT = [
        'Proud to have you on this team.',
        'Keep showing up like this. I see it.',
        'Thanks for everything you put in. Talk soon.',
        'Appreciate you. Let\'s keep building.',
        'Rooting for you, always.',
    ];
    const HF_CLOSERS_EFFORT_WEEKEND = [
        'Thanks for the work this week. Enjoy your weekend!',
        'Appreciate you. Rest up this weekend.',
    ];

    /* Monthly review phrases.
     *
     * Read on 14 October about September, the old pools said "this month's
     * 96.2%", "Big month..." and "Heading into next month" (Scott,
     * 2026-10-14). Every line now takes the month by name or by `when`
     * (describeWeekRecency's "in September" / "this month"), and a month
     * still running has its own greetings and no-wins lines, because "That
     * wraps up the month" is false on the fourteenth.
     */
    const MO_GREETINGS = [
        (name, month) => `Hey ${name}! Here's your ${month} recap.`,
        (name, month) => `${name}! Let's look at how ${month} went.`,
        (name, month) => `Hey ${name}, wrapping up ${month} for you.`,
        (name, month) => `${name}, your ${month} numbers are in. Let's talk about it.`,
        (name, month) => `${name}, ${month} is in the books. Here's the summary.`,
        (name, month) => `Alright ${name}, let's break down your ${month}.`,
        (name, month) => `Hey ${name}, wanted to walk you through your ${month} numbers.`,
        (name, month) => `${name}, here's how ${month} played out for you.`,
        (name, month) => `Quick ${month} recap for you, ${name}.`,
    ];
    const MO_GREETINGS_ONGOING = [
        (name, month) => `Hey ${name}! Here's how your ${month} is going so far.`,
        (name, month) => `${name}! Quick look at your ${month} so far.`,
        (name, month) => `Hey ${name}, checking in on your ${month} so far.`,
        (name, month) => `${name}, here's where ${month} stands so far.`,
    ];
    const MO_JUMP = [
        (label, delta, range, when) => `Big move in ${label}${at(when)}, ${delta}, from ${range}!`,
        (label, delta, range, when) => `${label} was a standout improvement${at(when)}, ${delta}, from ${range}.`,
        (label, delta, range, when) => `Love watching ${label} head the right way${at(when)}, ${delta}, from ${range}.`,
        (label, delta, range, when) => `The progress on ${label}${at(when)} speaks for itself, ${delta}, from ${range}.`,
        (label, delta, range, when) => `${label} is the big story${at(when)}, ${delta}, from ${range}.`,
        (label, delta, range, when) => `Gotta call out ${label}${at(when)}, ${delta}, from ${range}.`,
    ];
    const MO_TWO_WINS = [
        (l1, v1, l2, v2, when) => `${l1} at ${v1} and ${l2} at ${v2}, both strong${at(when)}.`,
        (l1, v1, l2, v2) => `Consistently solid on ${l1} (${v1}) and ${l2} (${v2}).`,
        (l1, v1, l2, v2, when) => `Two highlights${at(when)}: ${l1} at ${v1} and ${l2} at ${v2}.`,
        (l1, v1, l2, v2) => `${l1} at ${v1} paired with ${l2} at ${v2} is a really strong combo.`,
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2}? Those are wins right there.`,
        (l1, v1, l2, v2) => `Love seeing ${l1} (${v1}) and ${l2} (${v2}) both holding strong.`,
    ];
    const MO_ONE_WIN = [
        (label, val, when) => `${label} at ${val} is a highlight${at(when)}.`,
        (label, val, when) => `Got to hand it to you on ${label} at ${val}${at(when)}.`,
        (label, val) => `${label} coming in at ${val} is a win.`,
        (label, val) => `The work on ${label} is paying off, ${val} is great.`,
        (label, val, when) => `${label} at ${val} is one of the best numbers I saw${at(when)}.`,
    ];
    // Only when the month has no win, no real move and no true positive in it
    // (see truePositiveFor). Thanks for the effort, never sympathy: "Tough
    // month" and "Not the month we wanted" were how these used to read.
    const MO_NO_WINS = [
        (month) => `Thank you for the work you put in during ${month}. I saw the effort, and it matters.`,
        () => 'I appreciate how you kept showing up and giving it your best. That effort counts.',
        (month) => `I saw how hard you worked in ${month}, and I appreciate it.`,
        () => 'Thank you for the effort you brought to every call. It doesn\'t go unnoticed.',
    ];
    const MO_NO_WINS_ONGOING = [
        (month) => `Thank you for the work you're putting in during ${month}. I see the effort, and it matters.`,
        () => 'I appreciate how you keep showing up and giving it your best. That effort counts.',
        (month) => `I see how hard you're working in ${month}, and I appreciate it.`,
        () => 'Thank you for the effort you bring to every call. It doesn\'t go unnoticed.',
    ];
    // `ahead` is the stretch the focus is for: the month after a finished one
    // ("October"), or what is left of a running one ("the rest of October").
    const MO_FOCUS = [
        (label, val, target, ahead) => `Heading into ${ahead}, let's target ${label} (${val} against the ${target} goal).`,
        (label, val, target, ahead) => `For ${ahead}, the priority is ${label} (sitting at ${val}, target ${target}).`,
        (label, val, target) => `Going forward, I'd love us to work on ${label}. You're at ${val}, with ${withArticle(target)} goal to aim for.`,
        (label, val, target, ahead) => `If we nail one thing in ${ahead}, let it be ${label} (${val} vs ${target}).`,
        (label, val, target, ahead) => `I want us to put real energy into ${label} in ${ahead}. At ${val}, shooting for ${target}.`,
        (label, val, target) => `The biggest opportunity I see? ${label} at ${val}. Target is ${target} and I know you can close that gap.`,
    ];
    // The four scorecard numbers only, so "You hit target on 0 of 12 metrics"
    // cannot happen: a count of nought is not said, and all four is a sweep.
    const MO_CONSISTENCY = [
        (on, total, when, be) => `${on} of your ${total} scorecard numbers ${be} at or above target${at(when)}.`,
        (on, total, when, be) => `You ${be === 'are' ? 'are hitting' : 'hit'} target on ${on} of your ${total} scorecard numbers${at(when)}.`,
        (on, total, when, be) => `Across your ${total} scorecard numbers, ${on} ${be} on target${at(when)}.`,
    ];
    const MO_SWEEP = [
        (when) => `Every scorecard number at goal${at(when)}. That's a clean sweep.`,
        (when, total) => `All ${total} scorecard numbers at or above target${at(when)}. Doesn't get better than that.`,
    ];
    const MO_CLOSERS = [
        'Let\'s carry this forward. I\'m here if you want to go over anything.',
        'Good work. Let\'s keep building.',
        'Appreciate the work. Let me know how I can help going forward.',
        'Keep it rolling. My door is always open.',
    ];
    // Only after a good month that is over.
    const MO_CLOSERS_DONE_GOOD = [
        'Solid month overall. Let me know if you want to sit down and talk through it.',
        'Here\'s to an even better month ahead. I\'m in your corner.',
    ];
    const MO_CLOSERS_TOUGH = [
        'Thanks for the effort. Let\'s keep the conversation going.',
        'I\'m in your corner. Let me know what would help.',
        'We\'ll get there together. My door is always open.',
    ];
    // "On to the next one" says the month is over, so a month still running
    // never hears it.
    const MO_CLOSERS_TOUGH_DONE = [
        'On to the next one. Reach out if you need anything.',
    ];

    /* ── Tense ──
     *
     * The pools above say a period has ended: "You crushed it on AHT last
     * week", "landed at 92%", "Your numbers for the week are in". Over a week,
     * month or year still running that is false, and it read that way: a
     * week in progress came out as "went absolutely off" (Scott, 2026-10-07).
     *
     * Each pool that makes such a claim has a twin here in the present, with
     * the same arguments. tensed() hands back the twin when describeWeekRecency
     * says the period is still running, and the pool itself otherwise. Lines
     * that are true either way are carried over unchanged, so a running week
     * keeps as much variety as a finished one.
     */
    function hypeYou(ongoing) {
        const voice = window.DevCoachModules?.messageVoice;
        if (voice?.hype) return voice.hype('You', ongoing);
        return ongoing ? 'You\'re on FIRE' : 'You caught FIRE';
    }

    const DATA_IN_ONGOING = [
        (date, when) => `Here's how ${when} is shaping up so far.`,
        (date, when) => `Quick look at how ${when} is going.`,
        (date, when) => `Wanted to share where you're at ${when} so far.`,
        (date, when) => `Here's where things stand ${when}, with more still to come.`,
        (date, when) => `Checking in on how ${when} is coming along.`,
        (date, when) => `Here's your progress ${when} so far.`,
        (date, when) => `Pulled up your numbers ${when} to date.`,
        (date, when) => `Here's how you're tracking ${when}.`,
        (date, when) => `Peeked at your numbers ${when} so far.`,
        (date, when) => `Here's the story ${when} so far.`,
    ];
    const JUMP_INTROS_ONGOING = [
        (label, delta, range, when) => `Huge improvement in ${label}${at(when)}, ${delta}, from ${range}!`,
        (label, delta, range, when) => `Big move in ${label}${at(when)}, ${delta}, from ${range}!`,
        (label, delta, range, when) => `Love seeing ${label} move like that${at(when)}, ${delta}, from ${range}!`,
        (label, delta, range, when) => `${label} is really standing out${at(when)}, ${delta}, from ${range}!`,
        (label, delta, range, when) => `You're crushing it on ${label}${at(when)}, ${delta}, from ${range}!`,
        (label, delta, range, when) => `That swing in ${label}${at(when)} is catching my eye, ${delta}, from ${range}.`,
        (label, delta, range, when) => `${label} is moving in a serious way${at(when)}, ${delta}, from ${range}.`,
        (label, delta, range, when) => `Not gonna lie, ${label} coming ${delta}${at(when)}, from ${range}, has me doing a double take.`,
        (label, delta, range, when) => `Okay, ${label}! ${capFirst(delta)}${at(when)}, from ${range}.`,
        (label, delta, range, when) => `Your ${label} is heading the right direction${at(when)}, ${delta}, from ${range}.`,
        (label, delta, range, when) => `Seriously though, ${label} moving ${delta}${at(when)}, from ${range}, is no joke.`,
        (label, delta, range, when) => `Look at ${label} go${at(when)}, ${delta}, from ${range}!`,
        (label, delta, range, when) => `${label} is taking a real shift${at(when)}, ${delta}, from ${range}.`,
        (label, delta, range, when) => `Gotta call out your ${label}${at(when)}, ${delta}, from ${range}.`,
    ];
    const TWO_WINS_ONGOING = TWO_WINS.map((fn) => (/nailed it/i.test(fn('a', 'b', 'c', 'd'))
        ? (l1, v1, l2, v2) => `You're nailing it on ${l1} (${v1}) and ${l2} (${v2}).`
        : fn));
    const FOCUS_PERSISTENT_ONGOING = [
        (label, val, ytdVal, target, when) => `${label} is the one I'd love us to work on together. You're at ${val}${at(when)} so far with the goal at ${target}, so let's chip away at it.`,
        (label, val, ytdVal, target, when) => `Let's work on ${label} together. You're at ${val}${at(when)} so far, and the year is at ${ytdVal}. The goal is ${target}, and I think we can get there a little at a time.`,
        (label, val, ytdVal, target) => `If there's one thing to go after, it's ${label}. You're at ${ytdVal} for the year with ${withArticle(target)} goal, and every call is a chance to bring it closer.`,
        (label, val, ytdVal, target, when) => `${label} is where I'd put our energy. You're at ${val}${at(when)} so far, and ${target} is the goal. Small steps add up, and I'm right here with you.`,
    ];
    const FOCUS_YTD_ONLY_ONGOING = [
        (label, val, ytdVal, target, when) => `Nice work on ${label}${at(when)}, ${val} so far. The year is still at ${ytdVal} with ${withArticle(target)} goal, so more stretches like this are how we get it there.`,
        (label, val, ytdVal, target, when) => `You've got ${label} at ${val}${at(when)}, which is great. Keep that going, and that's how the year, at ${ytdVal} right now, gets to ${target}.`,
        (label, val, ytdVal, target, when) => `${label} is the one to keep pushing on. Hitting ${val}${at(when)} shows you can do it, and keeping it up is what brings the year to ${target}.`,
    ];
    const FOCUS_WEEK_DIP_ONGOING = [
        (label, val, ytdVal, target, when) => `Quick note on ${label}: it's dipped to ${val}${at(when)} so far with the goal at ${target}, but your year is solid at ${ytdVal}. Plenty of time to get it back where it usually is.`,
        (label, val, ytdVal, target, when) => `${label} has slipped to ${val}${at(when)}, but the year is still on target at ${ytdVal}. Plenty of time to get back to normal.`,
        (label, val, ytdVal, target, when) => `${label} is at ${val}${at(when)} so far, a little off your usual and the ${target} goal. Your year at ${ytdVal} says you've got this.`,
    ];
    const FOCUS_FALLBACK_ONGOING = [
        (label, val, target, when) => `${label} is the one I'd love us to work on. You're at ${val}${at(when)} so far with the goal at ${target}, and I think you can get there.`,
        (label, val, target, when) => `Let's work on getting ${label} closer to ${target}. You're at ${val}${at(when)} so far, and every call is a chance to move it.`,
        (label, val, target, when) => `If I had to pick one thing, it'd be ${label}. You're at ${val}${at(when)}, with ${withArticle(target)} goal to aim for.`,
        (label, val, target, when) => `${label} is where I'd focus next. You're at ${val}${at(when)} so far, and ${target} is the goal. Let's close that together.`,
    ];
    const MK_FOCUS_PERSISTENT_ONGOING = [
        (label, val, ytdVal, target, when, ahead) => `Let's go after ${label} ${ahead}. You're at ${val}${at(when)} so far, and the goal is ${target}. I think we can chip away at it together.`,
        (label, val, ytdVal, target, when, ahead) => `${label} is the one I'd love us to work on ${ahead}. The year is at ${ytdVal} with ${withArticle(target)} goal, and small improvements add up.`,
        (label, val, ytdVal, target, when, ahead) => `I think you can move ${label} ${ahead}. You're at ${val}${at(when)} so far with the goal at ${target}, and I'll help however you need.`,
        (label, val, ytdVal, target, when, ahead) => `My one ask ${ahead} is to be intentional about ${label}. You're at ${val}${at(when)} so far, and ${target} is the goal.`,
    ];
    const MK_FOCUS_YTD_ONLY_ONGOING = [
        (label, val, ytdVal, target, when) => `Love that ${label} is at ${val}${at(when)}. Let's make that the norm, because that's how the year, at ${ytdVal} now, gets to ${target}.`,
        (label, val, ytdVal, target, when) => `Let's keep doing what you're doing on ${label}${at(when)}. More stretches like ${val} are what bring the year to ${target}.`,
        (label, val, ytdVal, target, when, ahead) => `${label} is the one to keep pushing ${ahead}. Hitting ${val}${at(when)} is the right direction, and the year is still working its way to ${target}.`,
    ];
    const MK_FOCUS_WEEK_DIP_ONGOING = [
        (label, val, ytdVal, target, when) => `Just one small thing: ${label} has dipped to ${val}${at(when)} with the goal at ${target}. Your year is solid at ${ytdVal}, so it's a one-off. Let's get it back.`,
        (label, val, ytdVal, target, when, ahead) => `Let's reset on ${label} ${ahead}. You're at ${val}${at(when)} so far, but your year at ${ytdVal} says you know how to do this.`,
        (label, val, ytdVal, target, when) => `${label} has slipped to ${val}${at(when)}, a little off your usual. The year is still on target at ${ytdVal}, so you're in good shape.`,
    ];
    const MK_FOCUS_FALLBACK_ONGOING = [
        (label, val, target, when, ahead) => `Let's go after ${label} ${ahead}. You're at ${val}${at(when)} so far, and the goal is ${target}.`,
        (label, val, target, when, ahead) => `${label} is the one I'd love us to work on ${ahead}. You're at ${val}${at(when)} with ${withArticle(target)} goal to aim for, and I think you can get there.`,
        (label, val, target, when, ahead) => `I think you can move ${label} ${ahead}. You're at ${val}${at(when)} so far, and ${target} is the goal.`,
        (label, val, target, when, ahead) => `My one ask ${ahead} is to be intentional about ${label}. You're at ${val}${at(when)}, aiming for ${target}.`,
    ];
    const HF_JUMP_ONGOING = [
        (label, delta, range, when) => `Incredible move in ${label}${at(when)}, ${delta}, from ${range}! That kind of progress stands out.`,
        (label, delta, range, when) => `You're moving ${label} in a big way${at(when)}, ${delta}, from ${range}! That's impressive.`,
        (label, delta, range, when) => `${label} is taking a real swing${at(when)}, ${delta}, from ${range}! Love to see it.`,
        (label, delta, range, when) => `The progress on ${label}${at(when)} is awesome, ${delta}, from ${range}! Keep that energy.`,
        (label, delta, range, when) => `Your ${label} has moved ${delta}${at(when)}, from ${range}, and honestly it's one of the best improvements I've seen.`,
        (label, delta, range, when) => `Moving ${label} ${delta}${at(when)}, from ${range}, is worth celebrating. That takes real effort.`,
        (label, delta, range, when) => `${label} is taking a big step${at(when)}, ${delta}, from ${range}. You should feel good about that.`,
        (label, delta, range, when) => `I have to point out that ${label} swing${at(when)}, ${delta}, from ${range}. That's not easy to do.`,
        (label, delta, range, when) => `When I saw ${label} come ${delta}${at(when)}, from ${range}, I knew I had to say something.`,
        (label, delta, range, when) => `The kind of improvement you're showing on ${label}${at(when)}, ${delta}, from ${range}, doesn't happen by accident.`,
    ];
    const HF_TWO_WINS_ONGOING = [
        (l1, v1, l2, v2, when) => `Your ${l1} at ${v1} and ${l2} at ${v2} are outstanding!`,
        (l1, v1, l2, v2, when) => `${l1} at ${v1} and ${l2} at ${v2}? Absolutely killing it!`,
        (l1, v1, l2, v2, when) => `Crushing it on ${l1} (${v1}) and ${l2} (${v2})${at(when)}!`,
        (l1, v1, l2, v2, when) => `${l1} at ${v1} and ${l2} at ${v2} are both legit impressive.`,
        (l1, v1, l2, v2, when) => `Between ${l1} at ${v1} and ${l2} at ${v2}, you're having one heck of a run.`,
        (l1, v1, l2, v2, when) => `I mean, ${l1} at ${v1} AND ${l2} at ${v2}? Come on now.`,
        (l1, v1, l2, v2, when) => `Your ${l1} (${v1}) and ${l2} (${v2}) are both standout numbers${at(when)}.`,
        (l1, v1, l2, v2, when) => `Two words: ${l1} at ${v1}. Two more: ${l2} at ${v2}. Just great.`,
        (l1, v1, l2, v2, when) => `${l1} at ${v1}, ${l2} at ${v2}. That's the kind of stretch you want to have.`,
        (l1, v1, l2, v2, when) => `Can we talk about ${l1} at ${v1} and ${l2} at ${v2}? Because those are excellent.`,
    ];
    const HF_ONE_WIN_ONGOING = [
        (label, val, when) => `Your ${label} at ${val} is outstanding!`,
        (label, val, when) => `${label} at ${val}? That's what I'm talking about!`,
        (label, val, when) => `Killing it on ${label} at ${val}${at(when)}!`,
        (label, val, when) => `Your ${label} coming in at ${val} is seriously impressive.`,
        (label, val, when) => `${label} at ${val} is the highlight and it deserves a callout.`,
        (label, val, when) => `I saw your ${label} at ${val} and honestly just wanted to say great job.`,
        (label, val, when) => `That ${label} number at ${val}? Chef's kiss.`,
        (label, val, when) => `${label} at ${val} tells me everything about how you're showing up${at(when)}.`,
        (label, val, when) => `Huge props on ${label} at ${val}. That's no small thing.`,
        (label, val, when) => `Let's be real, ${label} at ${val} is just flat out good.`,
    ];
    const HF_NO_WINS_ONGOING = [
        when => `I wanted to recognize your effort${at(when)}. You're showing up and putting in the work, and that matters.`,
        when => 'Just want you to know I see the grind. Keep at it.',
        when => `Appreciate the effort you're putting in${at(when)}. It doesn't go unnoticed.`,
        when => 'The numbers are one thing, but showing up every day is the foundation. You\'re doing that.',
        when => `I wanted to take a sec to acknowledge your work${at(when)}. It matters more than you think.`,
        when => 'Not every stretch is going to be flashy, but the work ethic you bring is what builds a great track record.',
        when => 'I see you out there putting in the work. That consistency is going to pay off.',
        when => 'Wanted to make sure you know that the effort hasn\'t gone unnoticed. Keep going.',
    ];
    const HF_EXTRAS_ONGOING = [
        extras => `On top of that, ${extras}. You're on a roll!`,
        extras => `And ${extras} too? You're firing on all cylinders.`,
        extras => `Plus ${extras}. Just an all-around great showing.`,
        extras => `Not to mention ${extras}. Seriously impressive.`,
        extras => `${capFirst(extras)} too, and that's a lot to be proud of.`,
        extras => `And to top it all off, ${extras}. Love it.`,
        extras => `Then there's ${extras} on top of everything else. ${hypeYou(true)}.`,
        extras => `Can't forget about ${extras} either. Just stacking wins.`,
    ];
    const HF_EXTRAS_SWEEP_ONGOING = [
        extras => `On top of that: ${extras}. That's about as complete as it gets.`,
        extras => `Plus ${extras}. There's nothing left to ask for.`,
        extras => `And ${extras}. Every box checked so far.`,
        extras => `${capFirst(extras)}, too. Honestly, that's everything.`,
    ];

    const ONGOING_TWIN = new Map([
        [DATA_IN, DATA_IN_ONGOING],
        [JUMP_INTROS, JUMP_INTROS_ONGOING],
        [TWO_WINS, TWO_WINS_ONGOING],
        [FOCUS_PERSISTENT, FOCUS_PERSISTENT_ONGOING],
        [FOCUS_YTD_ONLY, FOCUS_YTD_ONLY_ONGOING],
        [FOCUS_WEEK_DIP, FOCUS_WEEK_DIP_ONGOING],
        [FOCUS_FALLBACK, FOCUS_FALLBACK_ONGOING],
        [MK_FOCUS_PERSISTENT, MK_FOCUS_PERSISTENT_ONGOING],
        [MK_FOCUS_YTD_ONLY, MK_FOCUS_YTD_ONLY_ONGOING],
        [MK_FOCUS_WEEK_DIP, MK_FOCUS_WEEK_DIP_ONGOING],
        [MK_FOCUS_FALLBACK, MK_FOCUS_FALLBACK_ONGOING],
        [HF_JUMP, HF_JUMP_ONGOING],
        [HF_TWO_WINS, HF_TWO_WINS_ONGOING],
        [HF_ONE_WIN, HF_ONE_WIN_ONGOING],
        [HF_NO_WINS, HF_NO_WINS_ONGOING],
        [HF_EXTRAS, HF_EXTRAS_ONGOING],
        [HF_EXTRAS_SWEEP, HF_EXTRAS_SWEEP_ONGOING],
        [FULL_SWEEP, FULL_SWEEP_ONGOING]
    ]);

    // The pool to draw from for this period: its present-tense twin while the
    // period is still running, the pool itself once it has ended.
    function tensed(pool, recency) {
        return (recency && recency.ongoing && ONGOING_TWIN.get(pool)) || pool;
    }

    // The four focus pools of a set, each in the period's tense.
    function tensedFocus(set, recency) {
        return {
            persistent: tensed(set.persistent, recency),
            ytdOnly: tensed(set.ytdOnly, recency),
            weekDip: tensed(set.weekDip, recency),
            fallback: tensed(set.fallback, recency)
        };
    }
    // --- Data helpers ---

    // Which uploads are week-shaped is a question period-index owns. This used
    // to be one of three spellings of it.
    function getAllSortedKeys() {
        const index = window.DevCoachModules?.periodIndex;
        if (!index) return [];
        return index.weekLikeKeys(index.currentIndex());
    }

    /**
     * The period behind a key, whatever shape the key is.
     *
     * This read the weekly store and nothing else, which was fine while the only
     * thing that ever named a period here was resolveCheckinPeriods handing back
     * two week keys. Now that the "Covering" chips choose the comparison, a
     * caller can legitimately name a day file, a year-to-date report or a month
     * rebuilt from its weeks, and every one of those came back null: the
     * generator found no employee row, returned nothing, and the page showed an
     * empty message with no reason on it.
     *
     * One chokepoint rather than a branch at each of the eighteen call sites
     * below, and periodComparison owns the resolution because it is the module
     * that hands the keys out.
     */
    function getPeriodData(periodKey) {
        const weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        if (weekly[periodKey]) return weekly[periodKey];
        return window.DevCoachModules?.periodComparison?.periodFor?.(periodKey) || null;
    }

    /**
     * What the rest of the call center did over the same stretch.
     *
     * Stored averages only exist for uploads that came through the wizard, so a
     * month rebuilt from its weeks has none, and so does a day file on the
     * morning it lands. The nine call sites that wanted this all wrote the same
     * three lines and all fell back to an empty object, which quietly dropped
     * every "ahead of the center" sentence out of the message rather than saying
     * anything was missing.
     *
     * Computing it from the period's own rows is the same arithmetic the wizard
     * runs, over the same people. Nothing is written back: a derived average is
     * right for this render and has no business becoming a stored one.
     */
    function centerAveragesFor(periodKey) {
        if (typeof getCallCenterAverageForPeriod === 'function') {
            const stored = getCallCenterAverageForPeriod(periodKey);
            if (stored) return stored;
        }
        if (typeof calculateCenterAveragesFromEmployees === 'function') {
            const period = getPeriodData(periodKey);
            if (period?.employees?.length) {
                return calculateCenterAveragesFromEmployees(period.employees) || {};
            }
        }
        return {};
    }

    function getPeriodKeys(periodType) {
        if (periodType === 'week') return getAllSortedKeys();
        const index = window.DevCoachModules?.periodIndex;
        if (!index) return [];
        return index.keysOfType(index.currentIndex(), periodType);
    }

    // The two week keys a check-in compares. Exported so callers outside this
    // tab — the Coaching tab's check-in button — reuse the same selection
    // instead of rebuilding it and drifting from what Pulse shows.
    function resolveCheckinPeriods() {
        const keys = getPeriodKeys('week');
        if (!keys.length) return null;
        return {
            latestKey: keys[keys.length - 1],
            baselineKey: keys.length > 1 ? keys[keys.length - 2] : null
        };
    }

    // Returns { mondayIso, todayIso, yesterdayIso, dailyKeysThisWeek[] }.
    // Daily keys are sorted ascending by end date. Empty array if no daily
    // rows fall inside the current Monday..today window.
    function getThisWeekDailyWindow() {
        const daily = typeof dailyData !== 'undefined' ? dailyData : {};
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const dow = now.getDay();
        const daysBackToMon = dow === 0 ? 6 : dow - 1;
        const monday = new Date(now);
        monday.setDate(monday.getDate() - daysBackToMon);
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const iso = d => {
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        };
        const mondayIso = iso(monday);
        const todayIso = iso(now);
        const yesterdayIso = iso(yesterday);
        const dailyKeysThisWeek = Object.keys(daily).filter(k => {
            const end = daily[k]?.metadata?.endDate || (k.includes('|') ? k.split('|')[1] : '');
            return end && end >= mondayIso && end <= todayIso;
        }).sort();
        return { mondayIso, todayIso, yesterdayIso, dailyKeysThisWeek };
    }

    function loadPulseSelection() {
        try {
            const raw = localStorage.getItem(PULSE_SELECTION_STORAGE_KEY);
            if (!raw) return { periodType: 'week', periodKey: null };
            const parsed = JSON.parse(raw);
            return {
                periodType: ['week', 'month', 'quarter'].includes(parsed?.periodType) ? parsed.periodType : 'week',
                periodKey: parsed?.periodKey || null
            };
        } catch (e) {
            return { periodType: 'week', periodKey: null };
        }
    }

    function getMonthName(weekKey) {
        const period = getPeriodData(weekKey);
        const meta = period?.metadata?.endDate;
        const d = meta ? new Date(meta + 'T00:00:00') : getPeriodEndDate(weekKey);
        return d.toLocaleString('default', { month: 'long', year: 'numeric' });
    }

    function getQuarterName(weekKey) {
        const period = getPeriodData(weekKey);
        if (period?.metadata?.label) return period.metadata.label;
        const meta = period?.metadata?.endDate;
        const d = meta ? new Date(meta + 'T00:00:00') : getPeriodEndDate(weekKey);
        const quarter = Math.floor(d.getMonth() / 3) + 1;
        return `Q${quarter} ${d.getFullYear()}`;
    }

    function getPeriodDisplayLabel(periodType, periodKey) {
        if (!periodKey) return '';
        if (periodType === 'month') return getMonthName(periodKey);
        if (periodType === 'quarter') return getQuarterName(periodKey);
        return getEndDateLabel(periodKey, getPeriodData(periodKey));
    }

    function getPeriodEndDate(weekKey) {
        const period = getPeriodData(weekKey);
        const meta = period?.metadata?.endDate;
        if (meta) return new Date(meta + 'T00:00:00');
        const parts = weekKey.split('|');
        return new Date((parts[1] || parts[0]) + 'T00:00:00');
    }

    /* A date the way a person says it: "Oct 13", or "Tuesday, Oct 13" with
     * the weekday. Scott, 2026-10-14: "10/13/2026" in a message to an
     * associate reads like a form. Built from the parts rather than parsed,
     * because new Date('2026-10-13') is UTC midnight and lands on the 12th
     * anywhere west of Greenwich. Anything that is not an ISO date comes back
     * as it was.
     */
    function shortDate(iso, withWeekday) {
        const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
        if (!m) return String(iso || '');
        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
        if (Number.isNaN(d.getTime())) return String(iso || '');
        const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        return withWeekday ? `${d.toLocaleDateString('en-US', { weekday: 'long' })}, ${day}` : day;
    }

    function getEndDateLabel(weekKey, period) {
        const meta = period?.metadata?.endDate;
        if (meta) return shortDate(meta);
        const parts = String(weekKey || '').split('|');
        return shortDate(parts[1] || parts[0]);
    }

    // The first day a period covers, for "the week of Sep 28". The growth
    // view used to name a week by its last day, which is not how anybody
    // says "the week of".
    function getStartDateLabel(periodKey, period) {
        const meta = period?.metadata?.startDate;
        if (meta) return shortDate(meta);
        const parts = String(periodKey || '').split('|');
        return shortDate(parts[0]);
    }

    // A month for a message: "September", not "September 2026". The year is
    // only said when it is not this one, which in October it never is.
    function monthWord(periodKey) {
        const period = getPeriodData(periodKey);
        const meta = period?.metadata?.endDate;
        const d = meta ? new Date(meta + 'T12:00:00') : getPeriodEndDate(periodKey);
        if (!d || Number.isNaN(d.getTime())) return 'the month';
        const sameYear = d.getFullYear() === new Date().getFullYear();
        return d.toLocaleString('en-US', sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
    }

    function getFilteredEmployees(period) {
        if (!period?.employees) return [];
        const ctx = typeof getTeamSelectionContext === 'function' ? getTeamSelectionContext() : null;
        return period.employees
            .filter(emp => emp?.name)
            .filter(emp => typeof isAssociateIncludedByTeamFilter === 'function'
                ? isAssociateIncludedByTeamFilter(emp.name, ctx)
                : true)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }

    // Find the recent window of uploads: latest key + the earliest key
    // within the trailing 7 calendar days (the "work week" window).
    // Returns { latestKey, baselineKey, allRecentKeys }
    function getWeekWindow(selectedLatestKey) {
        const allKeys = getAllSortedKeys();
        if (!allKeys.length) return null;

        const latestKey = selectedLatestKey && allKeys.includes(selectedLatestKey)
            ? selectedLatestKey
            : allKeys[allKeys.length - 1];
        const latestDate = getPeriodEndDate(latestKey);

        // Look back up to 7 calendar days for the baseline
        const cutoff = new Date(latestDate);
        cutoff.setDate(cutoff.getDate() - 7);

        const recentKeys = allKeys.filter(k => {
            const d = getPeriodEndDate(k);
            return d >= cutoff && d <= latestDate;
        });

        // Baseline = earliest in the window
        const baselineKey = recentKeys.length > 1 ? recentKeys[0] : null;

        return { latestKey, baselineKey, allRecentKeys: recentKeys };
    }

    function getPeriodWindow(periodType, selectedLatestKey) {
        if (periodType === 'week') return getWeekWindow(selectedLatestKey);

        const keys = getPeriodKeys(periodType);
        if (!keys.length) return null;

        const latestKey = selectedLatestKey && keys.includes(selectedLatestKey)
            ? selectedLatestKey
            : keys[keys.length - 1];
        const idx = keys.indexOf(latestKey);
        const baselineKey = idx > 0 ? keys[idx - 1] : null;
        return { latestKey, baselineKey, allRecentKeys: baselineKey ? [baselineKey, latestKey] : [latestKey] };
    }

    // Calculate per-metric deltas between baseline and latest for one employee
    // Skip comparison if baseline had too few calls (employee was likely absent)
    const MIN_BASELINE_CALLS = 20;

    function calcWeekDeltas(empName, baselineKey, latestKey) {
        const basePeriod = getPeriodData(baselineKey);
        const latestPeriod = getPeriodData(latestKey);
        const baseEmp = withRealCalls(basePeriod).find(e => e.name === empName);
        const latestEmp = latestPeriod?.employees?.find(e => e.name === empName);
        if (!baseEmp || !latestEmp) return [];

        // If baseline had barely any calls, the data is noise
        const baseCalls = parseInt(baseEmp.totalCalls, 10);
        if (!Number.isFinite(baseCalls) || baseCalls < MIN_BASELINE_CALLS) return [];

        // And the same on the latest side. A high five fired on a rate jump
        // for somebody with fourteen calls in the period (Scott, 2026-10-14):
        // fourteen calls is not a week anybody can be congratulated on moving.
        // Read through withRealCalls, because a year-to-date row carries its
        // survey count where the calls go.
        const latestRow = withRealCalls(latestPeriod).find(e => e.name === empName) || latestEmp;
        const latestCalls = parseInt(latestRow.totalCalls, 10);
        if (Number.isFinite(latestCalls) && latestCalls < MIN_BASELINE_CALLS) return [];

        const registry = typeof METRICS_REGISTRY !== 'undefined' ? METRICS_REGISTRY : {};
        const deltas = [];

        Object.keys(registry).filter(k => !PULSE_EXCLUDED_METRICS.includes(k)).forEach(metricKey => {
            const baseVal = parseFloat(baseEmp[metricKey]);
            const latestVal = parseFloat(latestEmp[metricKey]);
            if (!Number.isFinite(baseVal) || !Number.isFinite(latestVal)) return;
            // A survey rate only moves when there are surveys on both sides,
            // and enough of them to be a trend rather than one customer's
            // mood. "0% to 100%" off an empty week is a missing week, and
            // "75% to 100%" off one survey is that one survey.
            if (SURVEY_METRIC_KEYS.has(metricKey)
                && !(surveyResponsesFor(baseEmp, metricKey) >= MIN_SURVEYS_TO_PRAISE
                    && surveyResponsesFor(latestEmp, metricKey) >= MIN_SURVEYS_TO_PRAISE)) return;

            const delta = typeof metricDelta === 'function'
                ? metricDelta(metricKey, latestVal, baseVal)
                : latestVal - baseVal;

            deltas.push({
                metricKey,
                label: registry[metricKey]?.label || metricKey,
                baseValue: baseVal,
                latestValue: latestVal,
                delta,
                absDelta: Math.abs(delta)
            });
        });

        return deltas;
    }

    // Find the single biggest positive jump for an employee
    // How far a move is in that metric's own noise units. Raw deltas are in
    // different units, so fifteen seconds off AHT "beat" ten points of rep
    // satisfaction and handle time was named the biggest jump almost every time.
    function jumpSize(d) {
        const noise = getGrowthNoiseThreshold(d.metricKey);
        return d.delta / (Number.isFinite(noise) && noise > 0 ? noise : 1);
    }

    function getBiggestJump(deltas) {
        const improvements = deltas.filter(d => d.delta > 0 && jumpSize(d) >= 1);
        if (!improvements.length) return null;
        return improvements.reduce((best, d) => jumpSize(d) > jumpSize(best) ? d : best);
    }
    // A jump has to clear its metric's own noise floor before it is praised:
    // jumpSize(d) >= 1 is exactly that. "You crushed it on Managing Emotions
    // last week, +0.3%!" went to somebody below target (Scott, 2026-10-14).
    // With no real jump the message leads with a true win or an effort line.

    /**
     * The line that holds a month (or a year) up against its baseline.
     *
     * Only metrics the message may already speak about, only moves past the
     * registry's noise floor, and a survey metric only when the baseline had
     * an answer behind it too: a month with no surveys reads as 0%, and
     * "0.0% to 100.0%" is a missing month, not an improvement.
     *
     * `alreadySaid` is the jump the praise led with. It carries its own
     * before and after, so it is not said twice. When that jump is the only
     * thing that moved there is nothing to add, which is different from
     * nothing moving at all.
     */
    // `missKeys`, when given, is the metrics still short of target. Only those
    // are listed as behind: a slide on a number comfortably on target is not
    // something to hand somebody as a worry (Scott, 2026-10-14).
    function buildFrameComparison(frame, deltas, speakableKeys, baseEmp, alreadySaid, missKeys) {
        if (!frame?.prior || !deltas.length) return '';
        const moved = deltas.filter(d => speakableKeys.has(d.metricKey)
            && (!SURVEY_METRIC_KEYS.has(d.metricKey) || hasSurveyBehind(baseEmp, d.metricKey))
            && d.absDelta >= getGrowthNoiseThreshold(d.metricKey));
        const bySize = (a, b) => Math.abs(jumpSize(b)) - Math.abs(jumpSize(a));
        // "up from 93% to 95.1%" rather than an arrow: the words say which way
        // the number went, which an arrow on a reverse metric never did.
        const show = d => `${d.label} ${d.latestValue < d.baseValue ? 'down' : 'up'} from ${fmtVal(d.metricKey, d.baseValue)} to ${fmtVal(d.metricKey, d.latestValue)}`;
        const better = moved.filter(d => d.delta > 0 && d.metricKey !== alreadySaid).sort(bySize).slice(0, 3);
        const behind = moved.filter(d => d.delta < 0 && (!missKeys || missKeys.has(d.metricKey))).sort(bySize).slice(0, 2);

        const lines = [];
        if (better.length) lines.push(`${frame.better}: ${better.map(show).join(', ')}.`);
        if (behind.length) lines.push(`${frame.behind}: ${behind.map(show).join(', ')}.`);
        if (!lines.length && !moved.length) lines.push(frame.steady);
        return lines.join('\n');
    }

    // --- Analysis (reuses existing analyzeTrendMetrics for current snapshot) ---

    function analyzeCurrentSnapshot(emp, centerAvgs, weekKey) {
        const analyzeFn = window.DevCoachModules?.metricTrends?.analyzeTrendMetrics
            || window.analyzeTrendMetrics;
        if (!analyzeFn) return null;

        // Get previous period for trend direction
        let prevEmp = null;
        const keys = typeof getWeeklyKeysSorted === 'function' ? getWeeklyKeysSorted() : [];
        const idx = keys.indexOf(weekKey);
        if (idx > 0) {
            const prevPeriod = getPeriodData(keys[idx - 1]);
            prevEmp = prevPeriod?.employees?.find(e => e.name === emp.name) || null;
        }

        return analyzeFn(emp, centerAvgs, null, prevEmp, {
            employeeName: emp.name,
            weekKey: weekKey,
            periodType: 'week'
        });
    }

    /* Is this metric actually short of its target?
     *
     * "Watch Area" is two things: a miss that is improving, and a metric on
     * target that dipped. Counting the second as a miss made "Rep
     * Satisfaction slipped to 88.5%" the focus for somebody 6 points over an
     * 82% target with a 93% year (Scott, 2026-10-14). A focus is something
     * to fix, so only a number really short of target can be one.
     */
    function missesTarget(m) {
        if (!m) return false;
        if (typeof m.meetsTarget === 'boolean') return !m.meetsTarget;
        return m.classification === 'Needs Focus';
    }

    function pickFocalPoint(allMetrics) {
        const needsFocus = allMetrics
            .filter(m => m.classification === 'Needs Focus' && missesTarget(m))
            .sort((a, b) => {
                const riskA = (a.gapFromTarget || 0) + (a.trendDirection === 'declining' ? 2 : 0);
                const riskB = (b.gapFromTarget || 0) + (b.trendDirection === 'declining' ? 2 : 0);
                return riskB - riskA;
            });
        if (needsFocus.length) return needsFocus[0];

        const watchArea = allMetrics
            .filter(m => m.classification === 'Watch Area' && missesTarget(m))
            .sort((a, b) => (b.gapFromTarget || 0) - (a.gapFromTarget || 0));
        if (watchArea.length) return watchArea[0];

        return null;
    }

    // Prefer the most recently-ending YTD period (real uploads sort alongside
    // auto-generated ones; latest end date wins either way). Split out because
    // the pace arithmetic below needs the raw row from the same period the YTD
    // numbers came from, and two spellings of "the latest YTD upload" would
    // eventually pick two different uploads.
    //
    // The closing date rides along with the key for the same reason. The pace
    // arithmetic needs to know how much of the year that upload covers, and a
    // second walk of ytdData to go and find that date is the near-copy this
    // comment is already warning about.
    function latestYtdPeriod() {
        const ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        return Object.keys(ytd)
            .map(k => {
                const endText = ytd[k]?.metadata?.endDate || (k.includes('|') ? k.split('|')[1] : '');
                return { key: k, endText: String(endText || ''), end: new Date(endText) };
            })
            .filter(x => !isNaN(x.end))
            .sort((a, b) => b.end - a.end)[0] || null;
    }

    function latestYtdKey() {
        return latestYtdPeriod()?.key || null;
    }

    // The raw YTD row rather than the analysed metrics. Analysis keeps the
    // values and drops the volume columns, and a volume-weighted projection
    // without totalCalls or surveyTotal is a straight average wearing a
    // disguise.
    function getYtdEmployeeRow(employeeName) {
        const key = latestYtdKey();
        if (!key) return null;
        const ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        return withRealCalls(ytd[key]).find(e => e.name === employeeName) || null;
    }

    // A year-to-date file's rows carry the survey count where calls go, and
    // the call floors here read it as calls: 15 surveys for the year was a
    // person too thin to pace or compare. futures.withYtdCalls hands back
    // calls that mean calls; any other period comes back as it is.
    function withRealCalls(period) {
        const withCalls = window.DevCoachModules?.futures?.withYtdCalls;
        if (period && typeof withCalls === 'function') return withCalls(period) || [];
        return period?.employees || [];
    }

    // Fetch YTD-level metric analysis for a single employee, for cross-checking
    // weekly numbers against longer-run performance. Returns a Map keyed by
    // metricKey. Returns null if no YTD data is available.
    function getYtdMetricsMapForEmployee(employeeName) {
        const latestKey = latestYtdKey();
        if (!latestKey) return null;

        const emp = getYtdEmployeeRow(employeeName);
        if (!emp) return null;

        const analyzeFn = window.DevCoachModules?.metricTrends?.analyzeTrendMetrics
            || window.analyzeTrendMetrics;
        if (!analyzeFn) return null;

        const centerAvgs = centerAveragesFor(latestKey);

        const analysis = analyzeFn(emp, centerAvgs, null, null, {
            employeeName: employeeName,
            weekKey: latestKey,
            periodType: 'ytd'
        });
        if (!analysis?.allMetrics) return null;

        // The same gate the week's metrics go through, so a year with no
        // rep-sat surveys behind it cannot hand a focus line "YTD 0%".
        const map = new Map();
        speakableMetrics(emp, analysis).forEach(m => map.set(m.metricKey, m));
        return map;
    }

    // Smart focal-point picker that weighs YTD context alongside the week.
    // Returns the chosen focal point enriched with:
    //   - ytdValue       (null if no YTD)
    //   - ytdContext     'persistent' | 'ytd_only' | 'week_only' | 'fallback'
    // Priority: persistent > ytd_only > week_only, so a real multi-week
    // problem always outranks a single-week dip.
    function pickFocalPointSmart(weekMetrics, ytdMap) {
        if (!ytdMap) {
            const fallback = pickFocalPoint(weekMetrics);
            if (!fallback) return null;
            return { ...fallback, ytdValue: null, ytdContext: 'fallback' };
        }

        // A miss is a number short of target, on either side. See
        // missesTarget: an on-target metric that dipped is not a focus.
        const candidates = weekMetrics.map(m => {
            const ytd = ytdMap.get(m.metricKey);
            const ytdMiss = ytd ? missesTarget(ytd) : false;
            const weekMiss = missesTarget(m);
            let context = null;
            if (weekMiss && ytdMiss) context = 'persistent';
            else if (ytdMiss && !weekMiss) context = 'ytd_only';
            else if (weekMiss && !ytdMiss) context = 'week_only';
            if (!context) return null;
            return {
                metric: m,
                ytd,
                context,
                // Priority score: persistent worst, then ytd_only, then week_only
                priority: context === 'persistent' ? 0 : context === 'ytd_only' ? 1 : 2,
                // Secondary: risk = YTD gap (for the YTD-driven contexts) or
                // week gap (for week-only dips)
                risk: context === 'week_only'
                    ? (m.gapFromTarget || 0)
                    : (ytd?.gapFromTarget || 0)
            };
        }).filter(Boolean);

        if (!candidates.length) return null;

        candidates.sort((a, b) => {
            if (a.priority !== b.priority) return a.priority - b.priority;
            return b.risk - a.risk;
        });

        const chosen = candidates[0];
        return {
            ...chosen.metric,
            ytdValue: chosen.ytd?.employeeValue ?? null,
            ytdContext: chosen.context
        };
    }

    // Build the focal-text section of a Monday kickoff or weekly check-in
    // based on the chosen smart focal point. Picks the right randomized
    // template pool for the context.
    // when: the period the value is from. ahead: the stretch the focus is for.
    // Both default to the words every line used to hardcode.
    function buildFocalText(focal, pools, when, ahead) {
        if (!focal) return '';
        const label = focal.label;
        const target = fmtTarget(focal);
        const val = fmtVal(focal);
        const ytdVal = focal.ytdValue !== null && focal.ytdValue !== undefined
            ? fmtVal(focal.metricKey, focal.ytdValue)
            : null;
        const said = when === undefined || when === null ? 'last week' : when;
        const next = ahead || 'this week';
        // Under a year-to-date window the period IS the year, and the line
        // read "604s this year so far, 604s YTD" (Scott, 2026-10-14). The
        // same number twice says nothing the first one did not.
        if (ytdVal !== null && ytdVal === val) {
            return pick(pools.fallback)(label, val, target, said, next);
        }
        if (focal.ytdContext === 'persistent' && ytdVal !== null) {
            return pick(pools.persistent)(label, val, ytdVal, target, said, next);
        }
        if (focal.ytdContext === 'ytd_only' && ytdVal !== null) {
            return pick(pools.ytdOnly)(label, val, ytdVal, target, said, next);
        }
        if (focal.ytdContext === 'week_only' && ytdVal !== null) {
            return pick(pools.weekDip)(label, val, ytdVal, target, said, next);
        }
        return pick(pools.fallback)(label, val, target, said, next);
    }

    /* A plain-string pool, pointed at the stretch the message is looking ahead
     * to. On a Friday that is next week, so "here's the play for this week"
     * becomes "for next week", and a line that wishes somebody a great week as
     * the week ends is left out rather than reworded.
     */
    function lookingAhead(pool, ahead) {
        if (!ahead || ahead === 'this week') return pool;
        return pool
            .filter(line => !/\bweek\b/i.test(line.replace(/\bthis week\b/gi, '')))
            .map(line => line.replace(/\bthis week\b/g, ahead));
    }

    // The scorecard metrics a status badge is judged on. Reliability is the
    // fifth on the scorecard and stays off these cards on purpose.
    const BADGE_SCORECARD_KEYS = ['aht', 'scheduleAdherence', 'overallSentiment', 'cxRepOverall'];

    /**
     * A scorecard metric counts when it is on target, or when it is level
     * with or ahead of the center that period.
     *
     * The targets sit past where the floor runs: in the week of Oct 5, 14 of
     * 18 on the team were over the 426s Handle Time target with the team at
     * 517s, so judged on targets alone nearly everybody "missed" it. Somebody
     * doing what the center does is not a miss worth a red badge. A metric
     * with no center figure behind it is judged on its target alone.
     */
    function scorecardMet(m) {
        if (m.meetsTarget) return true;
        return Number(m.centerValue) > 0 && m.isBelowCenter === false;
    }

    /**
     * How someone is doing, by how much of their scorecard they are meeting.
     *
     * It used to go red at three misses across every metric on the card. With
     * thirteen metrics nearly everybody has three, so 17 of 18 on the team were
     * "Needs Support" and the badge said nothing. Scott, 2026-10-09: meeting 3
     * of 5 may still need coaching, but that is doing good. So it is a share of
     * the scorecard, and 3 of 4 reads the same as 3 of 5.
     *
     * Red is kept for the few who need you: nothing met, or one of four or
     * more. One of three is Watch, because most weeks only a handful have
     * surveys, so most people are judged on three. Crushing It means every
     * one of them on its actual target, not just ahead of the center.
     */
    function getStatusBadge(allMetrics) {
        const scorecard = (allMetrics || []).filter(m =>
            BADGE_SCORECARD_KEYS.includes(m.metricKey) && typeof m.meetsTarget === 'boolean');
        const measured = scorecard.length;
        const met = scorecard.filter(scorecardMet).length;
        const onTarget = scorecard.filter(m => m.meetsTarget).length;
        const tally = { met, measured, onTarget };

        // pill is the kit class that colours the badge: green on target, the
        // accent for doing good, amber to watch, red for support.
        // One number is not a scorecard.
        if (measured < 2) return { ...tally, label: 'Steady', pill: 'pill', icon: '\u26AA' };
        if (onTarget === measured) return { ...tally, label: 'Crushing It', pill: 'pill pill-good', icon: '\uD83D\uDFE2' };
        if (met === 0 || (met === 1 && measured >= 4)) return { ...tally, label: 'Needs Support', pill: 'pill pill-bad', icon: '\uD83D\uDD34' };
        if (met / measured >= 0.6) return { ...tally, label: 'Doing Good', pill: 'pill pill-info', icon: '\uD83D\uDD35' };
        return { ...tally, label: 'Watch', pill: 'pill pill-warn', icon: '\uD83D\uDFE1' };
    }

    // --- Formatting helpers ---

    function fmtVal(metricKeyOrObj, value) {
        const key = typeof metricKeyOrObj === 'object' ? metricKeyOrObj.metricKey : metricKeyOrObj;
        const val = value !== undefined ? value : (typeof metricKeyOrObj === 'object' ? metricKeyOrObj.employeeValue : 0);
        if (typeof formatMetricDisplay === 'function') return formatMetricDisplay(key, val);
        // The same rule formatMetricDisplay keeps: a whole number reads
        // without its ".0" (Scott, 2026-10-14), so "93%" here as well.
        const unit = window.METRICS_REGISTRY?.[key]?.unit || '';
        if (unit === '#') return Math.round(val).toString();
        if (unit === 'sec') return Math.round(val) + 's';
        if (unit === 'hrs') return val.toFixed(1).replace(/\.0$/, '') + ' hrs';
        return val.toFixed(1).replace(/\.0$/, '') + '%';
    }

    function fmtTarget(metric) {
        if (typeof formatMetricDisplay === 'function') return formatMetricDisplay(metric.metricKey, metric.target);
        return fmtVal(metric.metricKey, metric.target);
    }

    // "an 82% target", "a 93% target". Scott, 2026-10-14: "a 82.0% target"
    // and "a 88.0% target" read like nobody proofread them. Eight, eleven and
    // eighteen are the numbers said with a vowel sound up front.
    function withArticle(text) {
        const s = String(text || '').trim();
        return (/^(8|11(?!\d)|18(?!\d))/.test(s) ? 'an ' : 'a ') + s;
    }

    // A whole number without its ".0", the way formatMetricDisplay prints.
    function trimZero(text) {
        return String(text).replace(/\.0$/, '');
    }

    function isReverseKey(metricKey) {
        return typeof isReverseMetric === 'function' && !!isReverseMetric(metricKey);
    }

    /* How far a number moved, in the words a person says it in.
     *
     * "+0.9%" was a rate change written as a percentage, and "-19s" was an
     * improvement written with a minus sign (Scott, 2026-10-14). Seconds are
     * seconds and a rate moves in points.
     */
    function fmtAmount(metricKey, amount) {
        const unit = window.METRICS_REGISTRY?.[metricKey]?.unit || '';
        const n = Math.abs(Number(amount) || 0);
        if (unit === 'sec') {
            const s = Math.round(n);
            return s + (s === 1 ? ' second' : ' seconds');
        }
        if (unit === 'hrs') {
            const h = trimZero(n.toFixed(1));
            return h + (h === '1' ? ' hour' : ' hours');
        }
        if (unit === '#') return String(Math.round(n));
        const p = trimZero(n.toFixed(1));
        return p + (p === '1' ? ' point' : ' points');
    }

    // The move in words, by which way the number itself went: "down 19
    // seconds", "up 1.4 points". `delta` is the improvement-normalised move
    // calcWeekDeltas hands out, so a reverse metric is flipped back first.
    function fmtDelta(metricKey, delta) {
        const raw = isReverseKey(metricKey) ? -delta : delta;
        const amount = fmtAmount(metricKey, raw);
        if (/^0( |$)/.test(amount)) return 'about the same';
        return (raw < 0 ? 'down ' : 'up ') + amount;
    }

    // The two numbers a move went between, the way a person says them: "617
    // to 415" after "down 202 seconds", which already said the unit. A rate
    // keeps its "%". The period words live in the sentence around it, once.
    function fmtRange(metricKey, baseVal, latestVal) {
        const bare = (v) => String(fmtVal(metricKey, v)).replace(/^(-?\d+(?:\.\d+)?)s$/, '$1');
        return `${bare(baseVal)} to ${bare(latestVal)}`;
    }

    // Turn a list of wins into readable prose: "Adherence at 98.2%",
    // "A at x and B at y", "A at x, B at y, and C at z".
    function joinWinPhrases(list) {
        const parts = (list || []).map(w => `${w.label} at ${fmtVal(w)}`);
        if (parts.length <= 1) return parts[0] || '';
        if (parts.length === 2) return parts.join(' and ');
        return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
    }

    /* The extra wins after the lead line, two at most.
     *
     * A strong week used to have every remaining win named in one sentence,
     * nine numbers deep (Scott, 2026-10-14). Two are named and the rest are
     * counted. When everything else the message can speak to is on target the
     * count becomes "every other goal", which is the bigger compliment.
     */
    function extrasPhrase(extraWins, everyOtherGoal) {
        const named = extraWins.slice(0, 2);
        const rest = extraWins.length - named.length;
        if (!rest) return joinWinPhrases(named);
        const tail = everyOtherGoal
            ? 'every other goal too'
            : `${rest} more ${rest === 1 ? 'goal' : 'goals'} on target`;
        return `${named.map(w => `${w.label} at ${fmtVal(w)}`).join(', ')}, and ${tail}`;
    }

    // The scorecard four lead. A message that opened on Hold Time while
    // Schedule Adherence sat on target underneath it was leading with the
    // number nobody is graded on.
    const WIN_ORDER = ['aht', 'scheduleAdherence', 'overallSentiment', 'cxRepOverall'];

    // How far past target, in the metric's own noise units, so five seconds
    // of hold time no longer outranks 0.8 points of adherence just because
    // seconds are bigger numbers than points (Scott, 2026-10-14).
    function winMargin(m) {
        const raw = m.targetType === 'min' ? m.employeeValue - m.target : m.target - m.employeeValue;
        const noise = getGrowthNoiseThreshold(m.metricKey);
        return raw / (Number.isFinite(noise) && noise > 0 ? noise : 1);
    }

    function sortWins(list) {
        return list.slice().sort((a, b) => {
            const sa = WIN_ORDER.indexOf(a.metricKey) > -1 ? 0 : 1;
            const sb = WIN_ORDER.indexOf(b.metricKey) > -1 ? 0 : 1;
            if (sa !== sb) return sa - sb;
            return winMargin(b) - winMargin(a);
        });
    }

    /* The survey metrics one person's handful of surveys can speak for.
     *
     * One survey answered 100% on FCR, Overall Experience and Rep Sat is one
     * customer's good day, and it was being counted as three wins, which is
     * how "9 of 12 at or above target" got inflated (Scott, 2026-10-14). Under
     * three responses the survey metrics are one item at most: Rep
     * Satisfaction when it is there, since that is the one people are asked
     * about, otherwise the first. Three or more and each stands on its own.
     */
    function collapseThinSurveys(emp, metrics) {
        let kept = null;
        const thin = (metrics || []).filter(m => SURVEY_METRIC_KEYS.has(m.metricKey)
            && surveyResponsesFor(emp, m.metricKey) < MIN_SURVEYS_TO_PRAISE);
        if (thin.length > 1) kept = thin.find(m => m.metricKey === 'cxRepOverall') || thin[0];
        return (metrics || []).filter(m => thin.length < 2 || thin.indexOf(m) === -1 || m === kept);
    }

    // What counts as a win: on target, and spoken about only once per thin
    // survey sample. Sorted scorecard first, then by how far past target.
    // A survey rate on one or two surveys is named after everything else: it
    // is true, and it is one customer, so it does not lead the praise.
    function winsFrom(emp, metrics) {
        const sorted = sortWins(collapseThinSurveys(emp, metrics).filter(m => m.meetsTarget === true
            || (m.meetsTarget === undefined && (m.classification === 'Exceeding Expectation' || m.classification === 'On Track'))));
        const thin = m => SURVEY_METRIC_KEYS.has(m.metricKey) && surveyResponsesFor(emp, m.metricKey) < MIN_SURVEYS_TO_PRAISE;
        return sorted.filter(m => !thin(m)).concat(sorted.filter(thin));
    }

    /* A tip, as a sentence.
     *
     * Tips arrive as fragments ("Use hold only when you need to look something
     * up") and were pasted after a lightbulb with no full stop, so the message
     * ran straight on into the next line. They now read "Tip: ...", which
     * says what it is in a word instead of an emoji, and end like a sentence.
     */
    function tipSentence(tip) {
        let clean = String(tip || '').replace(/^(Practice this|Try this|Tip|Focus on this)\s*:\s*/i, '').trim();
        if (!clean) return '';
        clean = clean.charAt(0).toUpperCase() + clean.slice(1);
        if (!/[.!?]["')]*$/.test(clean)) clean += '.';
        return `Tip: ${clean}`;
    }

    // The registry's name for a metric wherever another module's wording
    // reaches a message. The near-miss line comes from celebrations, which
    // says "Avoiding Negative Words", under a message that said "Avoid
    // Negative Words" two lines up.
    function unifyLabels(text) {
        const label = window.METRICS_REGISTRY?.negativeWord?.label;
        if (!label || label === 'Avoiding Negative Words') return text;
        return String(text).replace(/Avoiding Negative Words/g, label);
    }

    /* The last thing every associate-facing message goes through.
     *
     * Two emojis a message, everywhere (Scott, 2026-10-13): the opener's and
     * the sign-off's, which is what messageVoice.limitEmojis keeps. The pools
     * already carry no more than that; this is the floor under them for
     * whatever a later edit adds.
     */
    function polish(text) {
        if (!text) return text;
        let out = unifyLabels(text);
        const limit = window.DevCoachModules?.messageVoice?.limitEmojis;
        if (typeof limit === 'function') out = limit(out, 2);
        return out;
    }

    /* Puts a paragraph just above the sign-off.
     *
     * The standings, the near-miss line and the team note were all appended
     * after the sign-off, so a message ended "Let me know if you need
     * anything." and then kept going for three more paragraphs (Scott,
     * 2026-10-14). Every generator ends on its sign-off paragraph, so the
     * last paragraph break is where anything added afterwards belongs. A
     * one-paragraph message has no sign-off to keep last and is appended to.
     */
    function beforeSignOff(message, block) {
        const body = String(message || '').replace(/\s+$/, '');
        const add = String(block || '').trim();
        if (!add) return body;
        if (!body) return add;
        const cut = body.lastIndexOf('\n\n');
        if (cut === -1) return body + '\n\n' + add;
        return body.slice(0, cut) + '\n\n' + add + body.slice(cut);
    }

    // --- Card rendering ---

    function buildEmployeeCard(emp, analysis, weekDeltas, biggestJump, options = {}) {
        const allMetrics = speakableMetrics(emp, analysis);
        const badge = getStatusBadge(allMetrics);
        const focalPoint = pickFocalPoint(allMetrics);
        const deltaContextLabel = options.deltaContextLabel || 'this week';
        const periodType = options.periodType || 'week';

        // Survey metrics all share the same underlying sample. If any survey
        // metric came back as a detractor (0), we can't honestly celebrate the
        // other survey metrics from that same sample — e.g. FCR=100 with OE=0
        // on a single survey is a detractor who happened to answer yes to FCR.
        const rawOpportunities = allMetrics
            .filter(m => m.classification === 'Needs Focus' || m.classification === 'Watch Area')
            .sort((a, b) => (b.gapFromTarget || 0) - (a.gapFromTarget || 0));
        const zeroSurveyOpps = rawOpportunities.filter(m =>
            SURVEY_METRIC_KEYS.has(m.metricKey)
            && Number.isFinite(m.employeeValue)
            && m.employeeValue === 0
        );
        const hasDetractorSurveys = zeroSurveyOpps.length >= 1;

        const rawWins = allMetrics
            .filter(m => m.classification === 'Exceeding Expectation' || m.classification === 'On Track')
            .filter(m => !(hasDetractorSurveys && SURVEY_METRIC_KEYS.has(m.metricKey)))
            .sort((a, b) => {
                if (a.classification !== b.classification) return a.classification === 'Exceeding Expectation' ? -1 : 1;
                const mA = a.targetType === 'min' ? a.employeeValue - a.target : a.target - a.employeeValue;
                const mB = b.targetType === 'min' ? b.employeeValue - b.target : b.target - b.employeeValue;
                return mB - mA;
            });

        // If 2+ survey metrics came back perfect, collapse them to one
        // "X perfect surveys" row so the other slot can highlight a real
        // non-survey win.
        const perfectSurveyWins = rawWins.filter(m =>
            SURVEY_METRIC_KEYS.has(m.metricKey)
            && Number.isFinite(m.employeeValue)
            && m.employeeValue >= 100
        );
        const surveyCountForWins = parseInt(emp?.surveyTotal, 10);
        const shouldCollapsePerfect = perfectSurveyWins.length >= 2
            && Number.isFinite(surveyCountForWins)
            && surveyCountForWins >= 3;
        const perfectKeySet = shouldCollapsePerfect
            ? new Set(perfectSurveyWins.map(m => m.metricKey))
            : null;
        const wins = (shouldCollapsePerfect
            ? [
                {
                    ...perfectSurveyWins[0],
                    label: 'Surveys',
                    displayOverride: `${surveyCountForWins} perfect survey${surveyCountForWins === 1 ? '' : 's'} this week`
                },
                ...rawWins.filter(m => !perfectKeySet.has(m.metricKey))
              ]
            : rawWins
        );
        const surveyCountForOpps = parseInt(emp?.surveyTotal, 10);
        const shouldCollapseSurveys = zeroSurveyOpps.length >= 2;
        const collapsedSurveyKey = shouldCollapseSurveys ? zeroSurveyOpps[0].metricKey : null;
        const opportunities = rawOpportunities
            .filter(m => !shouldCollapseSurveys
                || !SURVEY_METRIC_KEYS.has(m.metricKey)
                || m.metricKey === collapsedSurveyKey)
            .map(m => {
                if (m.metricKey !== collapsedSurveyKey) return m;
                const count = Number.isFinite(surveyCountForOpps) ? surveyCountForOpps : 0;
                const override = count > 0
                    ? `${count} low-score survey${count === 1 ? '' : 's'} this week`
                    : 'No surveys this week';
                return {
                    ...m,
                    label: 'Surveys',
                    displayOverride: override
                };
            })
            .slice(0, 2);

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(emp.name)
            : emp.name.split(/[\s,]+/)[0];

        const escapeHtml = window.DevCoachModules?.sharedUtils?.escapeHtml || ((s) => String(s));

        // Arrow direction, colour and tooltip all come from metric-movement,
        // so a reverse metric can't end up with an arrow that contradicts the
        // number printed beside it.
        const movement = window.DevCoachModules?.metricMovement;
        const trendArrow = (metric) => {
            if (!movement) return '';
            return movement.arrowHtml(metric?.metricKey, metric?.trendDirection, {
                // Still above target: amber rather than red, since it's a
                // drift to watch and not a miss.
                badColor: metric?.meetsTarget ? 'var(--yellow-text)' : 'var(--red-text)',
                stillOnTarget: !!metric?.meetsTarget
            });
        };

        // Wins section
        let winsHtml = '';
        if (wins.length) {
            winsHtml = wins.map(m => {
                if (m.displayOverride) {
                    return `<div style="font-size:0.85em; color:var(--green-text); padding:2px 0;">` +
                        `<span style="color:var(--text-tertiary);">\u2022</span> ${escapeHtml(m.label)}: <strong>${escapeHtml(m.displayOverride)}</strong></div>`;
                }
                // Find this metric's week delta if available. Show "+X" for
                // genuine improvements, "maintained" when the delta rounds to
                // zero (still a win worth recognizing), nothing for declines.
                const wd = weekDeltas.find(d => d.metricKey === m.metricKey);
                let deltaTag = '';
                if (wd) {
                    const unit = window.METRICS_REGISTRY?.[m.metricKey]?.unit || '%';
                    const zeroBand = (unit === 'sec' || unit === '#') ? 0.5 : 0.05;
                    if (wd.delta > zeroBand) {
                        deltaTag = ` <span style="color:var(--green-text); font-size:0.85em;">(${fmtDelta(m.metricKey, wd.delta)} ${deltaContextLabel})</span>`;
                    } else if (Math.abs(wd.delta) <= zeroBand) {
                        deltaTag = ` <span style="color:var(--green-text); font-size:0.85em;">(maintained ${deltaContextLabel})</span>`;
                    }
                }
                return `<div style="font-size:0.85em; color:var(--green-text); padding:2px 0;">` +
                    `${trendArrow(m)} ${escapeHtml(m.label)}: <strong>${fmtVal(m)}</strong>${deltaTag}</div>`;
            }).join('');
        } else {
            winsHtml = '<div style="font-size:0.85em; color:var(--text-tertiary);">No metrics at target yet</div>';
        }

        // Opportunities section
        let oppsHtml = '';
        if (opportunities.length) {
            oppsHtml = opportunities.map(m => {
                if (m.displayOverride) {
                    return `<div style="font-size:0.85em; color:var(--red-text); padding:2px 0;">` +
                        `<span style="color:var(--text-tertiary);">\u2022</span> ${escapeHtml(m.label)}: <strong>${escapeHtml(m.displayOverride)}</strong></div>`;
                }
                const wd = weekDeltas.find(d => d.metricKey === m.metricKey);
                const deltaTag = wd && wd.delta !== 0
                    ? ` <span class="${wd.delta > 0 ? 'tone-good' : (m.meetsTarget ? 'tone-warn' : 'tone-bad')}" style="font-size:0.85em;">(${fmtDelta(m.metricKey, wd.delta)})</span>`
                    : '';
                return `<div style="font-size:0.85em; color:var(--red-text); padding:2px 0;">` +
                    `${trendArrow(m)} ${escapeHtml(m.label)}: <strong>${fmtVal(m)}</strong> ` +
                    `<span style="color:var(--text-tertiary);">(target: ${fmtTarget(m)})</span>${deltaTag}</div>`;
            }).join('');
        } else {
            oppsHtml = '<div style="font-size:0.85em; color:var(--text-tertiary);">All metrics on track!</div>';
        }

        // Biggest improvement callout (only if we have multi-day data)
        let jumpHtml = '';
        if (biggestJump && biggestJump.delta > 0) {
            jumpHtml = `<div class="callout callout-good" style="padding:6px 10px; font-size:0.83em;">` +
                `\uD83D\uDE80 <strong>Biggest improvement:</strong> ${escapeHtml(biggestJump.label)} ${fmtDelta(biggestJump.metricKey, biggestJump.delta)} ${deltaContextLabel} ` +
                `(${fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue, periodType, options.rangeLabels)})</div>`;
        }

        // Focal point
        let focalHtml = '';
        if (focalPoint) {
            // "and declining" reads as the number coming down, which on
            // Handle Time is the outcome you want — the opposite of what the
            // flag means. Name the way the number actually moved.
            const focalMove = movement
                && movement.describe(focalPoint.metricKey, focalPoint.trendDirection, null);
            const dirLabel = focalMove && focalMove.direction === 'declining'
                ? (focalMove.numberRose ? ' and still climbing' : ' and still slipping')
                : '';
            focalHtml = `<div class="callout callout-warn" style="padding:8px; font-size:0.85em;">` +
                `<strong>\uD83C\uDFAF Focus:</strong> ${escapeHtml(focalPoint.label)}, ${escapeHtml(options.whenLabel || 'last week')} ${fmtVal(focalPoint)} vs target ${fmtTarget(focalPoint)}${dirLabel}</div>`;
        } else {
            focalHtml = `<div class="callout callout-good" style="padding:8px; font-size:0.85em;">` +
                `<strong>\u2705 On track!</strong> Keep up the consistency.</div>`;
        }

        return `<div class="pulse-card" data-employee="${escapeHtml(emp.name)}" style="background:var(--bg-surface); border-radius:8px; border:1px solid var(--border); padding:16px; display:flex; flex-direction:column; gap:10px; transition: box-shadow 0.2s;">` +
            `<div style="display:flex; justify-content:space-between; align-items:center;">` +
                `<div style="font-weight:700; font-size:1.05em; color:var(--text-primary);">${escapeHtml(firstName)}</div>` +
                `<div class="${badge.pill}" style="font-size:0.8em; padding:3px 10px;">${badge.icon} ${badge.label}</div>` +
            `</div>` +
            jumpHtml +
            `<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">` +
                `<div><div style="font-weight:600; font-size:0.8em; color:var(--text-secondary); margin-bottom:4px;">Wins</div>${winsHtml}</div>` +
                `<div><div style="font-weight:600; font-size:0.8em; color:var(--text-secondary); margin-bottom:4px;">Opportunities</div>${oppsHtml}</div>` +
            `</div>` +
            focalHtml +
            (options.actionHtml
                ? `<div style="margin-top:auto;">${options.actionHtml}</div>`
                : '') +
        `</div>`;
    }

    // --- Check-in message generation ---

    // The tip for one metric as a sentence ("Tip: ..."), or '' when there is
    // none. Five generators fetched it the same way, each with its own copy of
    // the prefix clean-up, and none of them ended it with a full stop.
    async function tipFor(employeeName, metricKey, severity) {
        try {
            const allTips = typeof loadServerTips === 'function' ? await loadServerTips() : {};
            const metricTips = allTips[metricKey] || [];
            if (!metricTips.length) return '';
            const tip = typeof selectSmartTip === 'function'
                ? selectSmartTip({ employeeId: employeeName, metricKey, severity: severity || 'medium', tips: metricTips })
                : metricTips[Math.floor(Math.random() * metricTips.length)];
            return tip ? tipSentence(tip) : '';
        } catch (e) {
            return '';
        }
    }

    /* Every survey metric at 100, on three or more surveys: said once as
     * "5 surveys, every one of them perfect" rather than as three wins. Under
     * three it is not said at all (see MIN_SURVEYS_TO_PRAISE).
     */
    function perfectSurveysFor(emp, wins) {
        const perfect = (wins || []).filter(w => SURVEY_METRIC_KEYS.has(w.metricKey)
            && Number.isFinite(w.employeeValue) && w.employeeValue >= 100);
        const count = parseInt(emp?.surveyTotal, 10);
        if (perfect.length < 2 || !Number.isFinite(count) || count < MIN_SURVEYS_TO_PRAISE) return null;
        return { text: `${count} survey${count === 1 ? '' : 's'}`, keys: new Set(perfect.map(w => w.metricKey)) };
    }

    /* THE BEST TRUE THING, WHEN NOTHING IS ON TARGET
     *
     * Scott, 2026-10-14: "Make sure to, in every piece of feedback ... make
     * sure to provide positive feedback." With no win and no real move, the
     * check-in, the Monday kickoff, the monthly review and the growth note
     * all fell back on a line of sympathy ("Not every week is going to be a
     * highlight reel", "Tough month", "Let's regroup"). There is nearly always
     * something real to say, and messageVoice.truePositive finds it: on
     * target, then better than the center average, then closest to goal.
     *
     * Moves are not handed over. getBiggestJump has already looked for one,
     * past the metric's own noise floor and on enough calls, and found none,
     * so a smaller move is not one to praise.
     *
     * Not the focus metric when another will do. Praising a number and then
     * calling it the thing that needs real attention is what FOCUS_IMPROVING
     * was written to stop. "Closest to goal" is only said when it is the
     * closest of everything and near enough to read as close: five of its
     * noise units, the gap goalNudge calls one strong week. A thin survey
     * sample is left out, as it is from every win, and reliability never
     * comes in (PULSE_EXCLUDED_METRICS).
     *
     * Returns { kind, row } or null, which means thank the effort instead.
     */
    function praiseRows(emp, metrics) {
        return (metrics || [])
            .filter(m => m && !PULSE_EXCLUDED_METRICS.includes(m.metricKey))
            .filter(m => hasSurveyBehind(emp, m.metricKey))
            .filter(m => !SURVEY_METRIC_KEYS.has(m.metricKey) || surveyResponsesFor(emp, m.metricKey) >= MIN_SURVEYS_TO_PRAISE)
            .filter(m => Number.isFinite(m.employeeValue) && Number.isFinite(m.target))
            .map(m => ({
                key: m.metricKey,
                label: m.label,
                value: m.employeeValue,
                target: m.target,
                center: Number(m.centerValue) > 0 ? Number(m.centerValue) : undefined,
                metric: m
            }));
    }

    // `avoidKeys` are never praised: a metric the same message lists as
    // slipped would be praised and scolded in one breath, the whiplash the
    // 10/14 voice pass took out. "Closest" is still judged against every
    // metric, so an avoided one can block the claim but never fake it.
    function truePositiveFor(emp, metrics, focalKey, ongoing, avoidKeys) {
        const avoid = new Set([focalKey].concat(avoidKeys || []).filter(Boolean));
        const best = window.DevCoachModules?.messageVoice?.truePositive;
        if (typeof best !== 'function' || tookNoCalls(emp)) return null;
        const rows = praiseRows(emp, metrics);
        const opts = { ongoing: !!ongoing };
        // The nearest to goal of everything, as a share of its goal, the way
        // truePositive measures it.
        const margin = r => (isReverseKey(r.key) ? r.target - r.value : r.value - r.target) / (Math.abs(r.target) || 1);
        const closestKey = rows.length ? rows.slice().sort((a, b) => margin(b) - margin(a))[0].key : null;
        const accept = (found, pool) => {
            if (!found || !found.key || !TRUE_POSITIVE[found.kind]) return null;
            const row = pool.find(r => r.key === found.key);
            if (!row) return null;
            if (found.kind === 'closest') {
                if (rows.length < 2 || avoid.has(row.key) || row.key !== closestKey) return null;
                const noise = getGrowthNoiseThreshold(row.key);
                const units = Math.abs(row.value - row.target) / (Number.isFinite(noise) && noise > 0 ? noise : 1);
                if (units > 5) return null;
            }
            return { kind: found.kind, row };
        };
        const overall = best(rows, opts);
        if (overall && !avoid.has(overall.key)) {
            const got = accept(overall, rows);
            if (got) return got;
        }
        if (!avoid.size) return null;
        const rest = rows.filter(r => !avoid.has(r.key));
        return accept(best(rest, opts), rest);
    }

    // The sentence for what truePositiveFor found, or '' for none.
    function truePositiveLine(found, ongoing) {
        if (!found) return '';
        const pools = ongoing ? TRUE_POSITIVE_ONGOING : TRUE_POSITIVE;
        const row = found.row;
        const val = fmtVal(row.key, row.value);
        if (found.kind === 'aboveCenter') return pick(pools.aboveCenter)(row.label, val, fmtVal(row.key, row.center));
        if (found.kind === 'closest') {
            const unit = window.METRICS_REGISTRY?.[row.key]?.unit || '';
            const rawGap = Math.abs(row.value - row.target);
            const gap = fmtAmount(row.key, unit === '%' && rawGap >= 2 ? Math.round(rawGap) : rawGap);
            // "within 0 points" is not a sentence: under the rounding it is
            // right at the edge of the goal, and said so.
            if (/^0( |$)/.test(gap)) {
                return ongoing
                    ? `${row.label} is right at the edge of the ${fmtTarget(row.metric)} goal, at ${val}.`
                    : `${row.label} finished right at the edge of the ${fmtTarget(row.metric)} goal, at ${val}.`;
            }
            return pick(pools.closest)(row.label, val, fmtTarget(row.metric), gap);
        }
        return pick(pools.atGoal)(row.label, val);
    }

    // The words a jump is measured over. Under a year-to-date window the
    // baseline is an earlier report from the same year, and the jump used to
    // say "86.4% last year to 89.5% this year" under an opener that said
    // "through Sep 30" (Scott, 2026-10-14). It is "since Sep 30" now.
    function moveWhenFor(recency, latestKey, baselineKey) {
        const ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        const latest = getPeriodData(latestKey) || ytd[latestKey] || null;
        if (latest?.metadata?.periodType === 'ytd' && baselineKey) {
            const base = getPeriodData(baselineKey) || ytd[baselineKey] || null;
            const end = String(base?.metadata?.endDate || (String(baselineKey).split('|')[1] || '')).slice(0, 10);
            const latestEnd = String(latest.metadata.endDate || (String(latestKey).split('|')[1] || ''));
            if (/^\d{4}-\d{2}-\d{2}$/.test(end) && end.slice(0, 4) === latestEnd.slice(0, 4)) return `since ${shortDate(end)}`;
        }
        return recency.when;
    }

    // options.now pins the day the copy is written for, the same way the high
    // five takes it. It reaches describeWeekRecency, which is what decides
    // whether the numbers get called this week, this month or that day.
    async function generateCheckinMessage(employeeName, latestKey, baselineKey, options) {
        const period = getPeriodData(latestKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp || tookNoCalls(emp)) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const endDate = getEndDateLabel(latestKey, period);

        const centerAvgs = centerAveragesFor(latestKey);

        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
        if (!analysis) return null;

        const allMetrics = speakableMetrics(emp, analysis);
        // What the numbers are called: this week, last week, in September.
        const recency = describeWeekRecency(latestKey, period, options?.now);

        // Week trajectory
        const weekDeltas = baselineKey ? calcWeekDeltas(employeeName, baselineKey, latestKey) : [];
        const biggestJump = getBiggestJump(weekDeltas);

        // Every win, not the top two: a clean sweep has to be countable.
        const countable = collapseThinSurveys(emp, allMetrics);
        const allWins = winsFrom(emp, allMetrics);
        const perfect = perfectSurveysFor(emp, allWins);
        const wins = (perfect ? allWins.filter(w => !perfect.keys.has(w.metricKey)) : allWins).slice(0, 2);
        const sweep = countable.length > 3 && allWins.length === countable.length;

        const ytdMap = getYtdMetricsMapForEmployee(employeeName);
        const focalPoint = pickFocalPointSmart(allMetrics, ytdMap);

        // The opening line already names the period, so nothing after it
        // does: "last week" three times in two sentences was the complaint.
        let praiseText = '';
        if (biggestJump && biggestJump.delta > 0) {
            praiseText = pick(tensed(JUMP_INTROS, recency))(biggestJump.label, fmtDelta(biggestJump.metricKey, biggestJump.delta), fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue), '');
            const other = wins.find(w => w.metricKey !== biggestJump.metricKey);
            if (other) praiseText += ` ${pick(PLUS_SOLID)(other.label, fmtVal(other))}`;
        } else if (wins.length >= 2) {
            praiseText = pick(tensed(TWO_WINS, recency))(wins[0].label, fmtVal(wins[0]), wins[1].label, fmtVal(wins[1]));
        } else if (wins.length === 1) {
            praiseText = pick(ONE_WIN)(wins[0].label, fmtVal(wins[0]));
        } else if (!perfect) {
            // Nothing on target and nothing that really moved: the best true
            // thing in the numbers, and the effort when there is none.
            praiseText = truePositiveLine(truePositiveFor(emp, allMetrics, focalPoint?.metricKey, recency.ongoing), recency.ongoing)
                || pick(NO_WINS);
        }
        // The two lines the kickoff always had and the check-in never did.
        if (perfect) praiseText = `${praiseText} ${pick(PERFECT_SURVEYS_SOLO)(perfect.text)}`.trim();
        if (sweep) praiseText += ` ${pick(tensed(FULL_SWEEP, recency))(countable.length)}`;

        // Build focus with tip. When the focus is the metric the praise just
        // credited, it gets the next stop rather than a scolding.
        let focusText = '';
        if (focalPoint) {
            const tipText = await tipFor(employeeName, focalPoint.metricKey, 'medium');
            focusText = biggestJump && biggestJump.metricKey === focalPoint.metricKey
                ? pick(FOCUS_IMPROVING)(focalPoint.label, fmtVal(focalPoint), fmtTarget(focalPoint))
                : buildFocalText(focalPoint, tensedFocus({ persistent: FOCUS_PERSISTENT, ytdOnly: FOCUS_YTD_ONLY, weekDip: FOCUS_WEEK_DIP, fallback: FOCUS_FALLBACK }, recency), '');
            if (tipText) focusText += ` ${tipText}`;
        }

        // A message asking for work on a miss that keeps missing, or one with
        // nothing to praise, is not signed off "Good stuff, keep the momentum
        // going".
        const tough = !allWins.length || focalPoint?.ytdContext === 'persistent';
        let message = `${pick(GREETINGS)(firstName)} 👋 ${pick(tensed(DATA_IN, recency))(endDate, recency.when)} ${praiseText}`;
        if (focusText) message += `\n\n${focusText}`;
        message += `\n\n${pick(tough ? CLOSERS_SUPPORT : CLOSERS)}`;

        return polish(message);
    }

    // --- High-Five message generation ---

    // True Friday through Sunday, when "enjoy your weekend" is something a
    // person would actually say. Any other day the weekend copy stays parked.
    function weekendIsInReach(when) {
        const dow = (when instanceof Date ? when : new Date()).getDay();
        return dow === 5 || dow === 6 || dow === 0;
    }

    // Which week the numbers actually describe. A weekly upload lands after the
    // week closes, so on a Thursday the latest week is normally the one that
    // ended the previous Friday. Calling that "this week" reads like the
    // numbers are still live, and dates the message wrong by seven days.
    function describeWeekRecency(latestKey, period, when) {
        const named = describeWeekRecencyWords(latestKey, period, when);
        named.ongoing = periodStillRunning(latestKey, period, when);
        return named;
    }

    // Is the stretch these numbers cover still running today? The kind of
    // upload decides (message-voice isOngoingPeriod), and the date keeps a
    // stale partial honest: last week's week-in-progress file, or a month to
    // date from a month that has since ended, is talked about as finished.
    function periodStillRunning(latestKey, period, when) {
        const today = when instanceof Date ? new Date(when.getTime()) : new Date();
        today.setHours(12, 0, 0, 0);
        const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const todayIso = iso(today);
        const monday = new Date(today);
        monday.setDate(monday.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1));
        const endIso = String(period?.metadata?.endDate
            || (latestKey && latestKey.indexOf('|') > -1 ? latestKey.split('|')[1] : latestKey)
            || '');
        const periodType = period?.metadata?.periodType;
        const voice = window.DevCoachModules?.messageVoice;
        const byType = voice?.isOngoingPeriod ? voice.isOngoingPeriod(periodType, endIso) : periodType === 'week-in-progress';
        if (!byType) return false;
        if (periodType === 'month-to-date') return endIso.slice(0, 7) === todayIso.slice(0, 7);
        if (periodType === 'ytd') return endIso.slice(0, 4) === todayIso.slice(0, 4);
        // A week in progress, or an upload of unknown kind: running only if it
        // reaches into the current week.
        return !endIso || endIso >= iso(monday);
    }

    function describeWeekRecencyWords(latestKey, period, when) {
        const today = when instanceof Date ? new Date(when.getTime()) : new Date();
        today.setHours(12, 0, 0, 0);
        const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const monday = new Date(today);
        monday.setDate(monday.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1));
        const priorMonday = new Date(monday);
        priorMonday.setDate(priorMonday.getDate() - 7);

        // A month, a quarter or the year is not a week, and week words on top
        // of one are simply wrong. The shape of the upload decides first; only
        // a week-shaped one gets this week / last week / the week ending.
        const NOT_A_WEEK = {
            'month': { when: 'this month', prior: 'last month' },
            'month-to-date': { when: 'this month', prior: 'last month' },
            'month-agg': { when: 'this month', prior: 'last month' },
            'quarter': { when: 'this quarter', prior: 'last quarter' },
            'ytd': { when: 'this year', prior: 'last year' },
            'daily': { when: 'that day', prior: 'the day before' }
        };
        const endIso = period?.metadata?.endDate
            || (latestKey && latestKey.indexOf('|') > -1 ? latestKey.split('|')[1] : latestKey)
            || '';

        // A whole month that is already over is named. On the second of
        // October, "this month" is October, so a September round that said "87s
        // last month to 63s this month" put both numbers a month late. A month
        // still running keeps this month / last month below.
        const periodType = period?.metadata?.periodType;
        if (periodType === 'month' || periodType === 'month-agg') {
            const ym = (String(endIso).match(/\d{4}-\d{2}/) || [])[0];
            if (ym && ym < iso(today).slice(0, 7)) {
                const month = parseInt(ym.slice(5, 7), 10) - 1;
                const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
                const name = m => NAMES[(m + 12) % 12];
                return { when: `in ${name(month)}`, prior: `in ${name(month - 1)}` };
            }
        }

        const shape = NOT_A_WEEK[periodType];
        if (shape) return shape;

        // No end date to judge by means no claim worth making — the in-flight
        // wording is what the message has always used, so fall back to it.
        if (!endIso || endIso >= iso(monday)) return { when: 'this week', prior: 'last week' };
        if (endIso >= iso(priorMonday)) return { when: 'last week', prior: 'two weeks ago' };
        return { when: `the week ending ${getEndDateLabel(latestKey, period)}`, prior: 'the week before' };
    }

    /* The one goal an effort high five names, gently.
     *
     * The closest miss rather than the worst, scorecard first: a high five is
     * not the place for the biggest problem, and "about 5 points from the 93%
     * goal" is a thing somebody can picture closing. `close` is worded for the
     * size of the gap, so a 178 second handle time gap is not promised to one
     * strong week.
     */
    function goalNudge(metrics, period) {
        const misses = (metrics || []).filter(m => m.meetsTarget === false
            && Number.isFinite(m.employeeValue) && Number.isFinite(m.target));
        if (!misses.length) return '';
        const noiseUnits = m => {
            const noise = getGrowthNoiseThreshold(m.metricKey);
            return Math.abs(m.employeeValue - m.target) / (Number.isFinite(noise) && noise > 0 ? noise : 1);
        };
        const rank = m => (WIN_ORDER.indexOf(m.metricKey) > -1 ? 0 : 1);
        const m = misses.slice().sort((a, b) => (rank(a) - rank(b)) || (noiseUnits(a) - noiseUnits(b)))[0];

        const unit = window.METRICS_REGISTRY?.[m.metricKey]?.unit || '';
        const rawGap = Math.abs(m.employeeValue - m.target);
        // "about 5 points", not "about 4.8 points": it is an about.
        const gap = fmtAmount(m.metricKey, unit === '%' && rawGap >= 2 ? Math.round(rawGap) : rawGap);
        const type = period?.metadata?.periodType || 'week';
        const weekShaped = type === 'week' || type === 'week-in-progress' || type === 'custom';
        const close = weekShaped && noiseUnits(m) <= 5
            ? 'One strong week closes most of that'
            : 'Every call is a chance to chip away at that';
        return pick(HF_GOAL_NUDGE)(m.label, fmtVal(m), fmtTarget(m), gap, close);
    }

    // options.now lets a caller (and the tests) pin the day the copy is written
    // for instead of whatever day the machine happens to be on.
    async function generateHighFiveMessage(employeeName, latestKey, baselineKey, options) {
        const period = getPeriodData(latestKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp || tookNoCalls(emp)) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const centerAvgs = centerAveragesFor(latestKey);

        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
        if (!analysis) return null;

        const allMetrics = speakableMetrics(emp, analysis);
        const weekDeltas = baselineKey ? calcWeekDeltas(employeeName, baselineKey, latestKey) : [];
        const biggestJump = getBiggestJump(weekDeltas);

        // Every win, scorecard first, with a thin survey sample counted once.
        // `countable` is the same list the "N of M" line is counted over, so
        // one customer's survey cannot add three to both sides of it.
        const countable = collapseThinSurveys(emp, allMetrics);
        const wins = winsFrom(emp, allMetrics);
        const allOnTarget = countable.length > 0 && wins.length === countable.length;

        // Build the celebration: no coaching, no focus areas, pure praise
        const weekendClose = weekendIsInReach(options?.now);
        const recency = describeWeekRecency(latestKey, period, options?.now);
        const moveWhen = moveWhenFor(recency, latestKey, baselineKey);
        const hasJump = !!(biggestJump && biggestJump.delta > 0);

        // Nothing on target and nothing that really moved. The effort high
        // five promises no numbers and assumes no strong week; it names one
        // goal and says it is in their corner.
        if (!hasJump && !wins.length) {
            let effort = `${pick(HF_OPENERS_EFFORT)(firstName)} ${pick(tensed(HF_NO_WINS, recency))(recency.when)}`;
            const nudge = goalNudge(countable, period);
            if (nudge) effort += ` ${nudge}`;
            const closers = weekendClose ? HF_CLOSERS_EFFORT.concat(HF_CLOSERS_EFFORT_WEEKEND) : HF_CLOSERS_EFFORT;
            effort += `\n\n${pick(closers)} 💪`;
            return polish(effort);
        }

        // One real move and nothing on target yet: still a high five, but
        // the lines that call it a great run are left out (see HF_OVERSELL).
        const jumpOnly = !wins.length;
        const openers = (weekendClose ? HF_OPENERS.concat(HF_OPENERS_WEEKEND) : HF_OPENERS)
            .filter(fn => !jumpOnly || !HF_OVERSELL.test(fn('x')));
        let message = pick(openers)(firstName);
        const namedWins = new Set();

        if (hasJump) {
            const range = fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue);
            message += ` ${pick(tensed(HF_JUMP, recency))(biggestJump.label, fmtDelta(biggestJump.metricKey, biggestJump.delta), range, moveWhen)}`;
            namedWins.add(biggestJump.metricKey);
        } else if (wins.length >= 2) {
            message += ` ${pick(tensed(HF_TWO_WINS, recency))(wins[0].label, fmtVal(wins[0]), wins[1].label, fmtVal(wins[1]), recency.when)}`;
            namedWins.add(wins[0].metricKey);
            namedWins.add(wins[1].metricKey);
        } else {
            message += ` ${pick(tensed(HF_ONE_WIN, recency))(wins[0].label, fmtVal(wins[0]), recency.when)}`;
            namedWins.add(wins[0].metricKey);
        }

        // Two more wins by name at most, then a count. See extrasPhrase.
        const extraWins = wins.filter(w => !namedWins.has(w.metricKey));
        if (extraWins.length > 0) {
            const pool = allOnTarget ? HF_EXTRAS_SWEEP : HF_EXTRAS;
            message += ` ${pick(tensed(pool, recency))(extrasPhrase(extraWins, allOnTarget))}`;
        }

        // How many goals are on target, counted over the same list. Left off
        // when the line above already said "every other goal too".
        const saidEverything = allOnTarget && extraWins.length > 2;
        if (!saidEverything && countable.length > 3 && wins.length >= countable.length * 0.7) {
            message += `\n\n${pick(HF_CONSISTENCY)(wins.length, countable.length)}`;
        }

        // No near-miss line here, ever. It attached "#17 in the Call Center"
        // to more than a third of high fives (Scott, 2026-10-14), and a high
        // five never carries a placing. The private messages keep it.
        const closers = (weekendClose ? HF_CLOSERS.concat(HF_CLOSERS_WEEKEND) : HF_CLOSERS)
            .filter(line => !jumpOnly || !HF_OVERSELL.test(line));
        message += `\n\n${pick(closers)} 🚀`;

        return polish(message);
    }

    // --- Focal point persistence ---
    const FOCAL_STORAGE_KEY = (window.DevCoachConstants?.STORAGE_PREFIX || 'devCoachingTool_') + 'weeklyFocalPoints';

    // Reads through the storage module so this store follows its backend. A raw
    // localStorage read goes permanently stale the moment the store moves.
    function readViaStorage(name, fallbackKey, empty) {
        var read = window.DevCoachModules?.storage?.readStore;
        if (typeof read === 'function') {
            var value = read(name);
            if (value !== undefined && value !== null) return value;
            return empty;
        }
        try {
            var raw = localStorage.getItem(fallbackKey);
            return raw ? JSON.parse(raw) : empty;
        } catch (e) { return empty; }
    }

    function saveFocalPoint(employeeName, weekKey, focalMetricKey, focalLabel, focalValue, focalTarget) {
        try {
            const all = readViaStorage('weeklyFocalPoints', FOCAL_STORAGE_KEY, {});
            if (!all[weekKey]) all[weekKey] = {};
            all[weekKey][employeeName] = {
                metricKey: focalMetricKey,
                label: focalLabel,
                value: focalValue,
                target: focalTarget,
                setDate: window.DevCoachModules?.sharedUtils?.formatLocalDate?.() || new Date().toISOString().slice(0, 10)
            };
            const save = window.DevCoachModules?.storage?.saveWithSizeCheck;
            if (save) save('weeklyFocalPoints', all);
            else localStorage.setItem(FOCAL_STORAGE_KEY, JSON.stringify(all));
        } catch (e) { /* storage full or unavailable */ }
    }

    function loadFocalPoint(employeeName, weekKey) {
        try {
            const all = readViaStorage('weeklyFocalPoints', FOCAL_STORAGE_KEY, null);
            if (!all) return null;
            return all[weekKey]?.[employeeName] || null;
        } catch (e) { return null; }
    }

    // --- Monday Kickoff message generation ---

    /**
     * @param {{dayWord?: string, startsTheWeek?: boolean}} [options] which day
     *   this message is actually for, and whether that day opens the week.
     *   Defaults to Monday opening the week, which is what the standalone
     *   kickoff button means and what every caller meant before the Tuesday
     *   follow-up started sharing this generator.
     */
    /**
     * The weekday a plan speaks for, capitalised for use in a sentence.
     *
     * Read off the plan rather than off the clock, because a supervisor can
     * pick any day's plan on any day, which is exactly what happens when a
     * holiday moves the week and the Tuesday plan gets run on a Wednesday.
     */
    function dayWordFor(plan) {
        const WORDS = {
            monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
            thursday: 'Thursday', friday: 'Friday'
        };
        // The weekend recap deliberately has no word. It is read on a Saturday
        // or a Sunday about the week that finished, and naming any weekday in
        // it would be naming one it is not about.
        return WORDS[String(plan?.id || '').toLowerCase()] || '';
    }

    async function generateMondayKickoffMessage(employeeName, latestKey, baselineKey, options) {
        const period = getPeriodData(latestKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp || tookNoCalls(emp)) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const centerAvgs = centerAveragesFor(latestKey);

        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
        if (!analysis) return null;

        const allMetrics = speakableMetrics(emp, analysis);
        const weekDeltas = baselineKey ? calcWeekDeltas(employeeName, baselineKey, latestKey) : [];
        // Two time words. recency.when is what the numbers are called (last
        // week, in September), and ahead is the stretch the plan is for: this
        // week, or next week when it is Friday's tone doing the asking.
        const recency = describeWeekRecency(latestKey, period, options?.now);
        const ahead = String(options?.ahead || '').trim() || 'this week';
        const moveWhen = moveWhenFor(recency, latestKey, baselineKey);

        // If any survey metric came back as a detractor (0), suppress the rest
        // of the survey wins from the same sample: FCR=100 with OE=0 is still
        // a detractor, not a win worth celebrating.
        const kickoffHasDetractorSurveys = allMetrics.some(m =>
            SURVEY_METRIC_KEYS.has(m.metricKey)
            && Number.isFinite(m.employeeValue)
            && m.employeeValue === 0
        );

        // Only when Overall Sentiment is *exceptional* (Exceeding Expectation,
        // not merely On Track) do we suppress the individual sentiment drivers
        // so the kickoff leads with the headline metric. If Overall Sentiment
        // is just on track, let positiveWord/negativeWord/managingEmotions
        // surface normally so we can still celebrate the specific drivers.
        const KICKOFF_INDIVIDUAL_SENTIMENT = new Set(['positiveWord', 'negativeWord', 'managingEmotions']);
        const kickoffHasExceptionalOverallSentiment = allMetrics.some(m =>
            m.metricKey === 'overallSentiment' && m.classification === 'Exceeding Expectation'
        );
        // Scorecard first, then by how far past target in each metric's own
        // noise units, with a thin survey sample counted once. See winsFrom.
        const countable = collapseThinSurveys(emp, allMetrics);
        const allWinsSorted = winsFrom(emp, allMetrics)
            .filter(m => !(kickoffHasDetractorSurveys && SURVEY_METRIC_KEYS.has(m.metricKey)))
            .filter(m => !(kickoffHasExceptionalOverallSentiment && KICKOFF_INDIVIDUAL_SENTIMENT.has(m.metricKey)));
        const wins = allWinsSorted.slice(0, 3);
        const allOnTarget = countable.length > 0 && countable.every(m => m.meetsTarget === true);

        // Keep the biggest jump unfiltered: celebrating a real move in
        // Positive Words is a great improvement story that Scott wants to see
        // even when Overall Sentiment is exceptional. getBiggestJump only
        // hands back a move past the metric's own noise floor.
        const biggestJump = getBiggestJump(weekDeltas);

        const ytdMap = getYtdMetricsMapForEmployee(employeeName);
        const focalPoint = pickFocalPointSmart(allMetrics, ytdMap);

        // When two or more survey metrics are at 100% on three or more
        // surveys, call it out as "X perfect surveys" instead of listing each
        // survey metric individually.
        const perfect = perfectSurveysFor(emp, allWinsSorted);
        const nonPerfectSurveyWins = perfect
            ? allWinsSorted.filter(w => !perfect.keys.has(w.metricKey))
            : wins;

        // CELEBRATION section: lead with wins
        let praiseText = '';
        const namedWins = new Set();
        const hasJump = !!(biggestJump && biggestJump.delta > 0);
        if (perfect) {
            // The perfect-surveys line speaks for every survey metric at 100.
            perfect.keys.forEach(k => namedWins.add(k));
            const secondWin = nonPerfectSurveyWins[0];
            if (secondWin) {
                praiseText = pick(PERFECT_SURVEYS_PLUS)(perfect.text, secondWin.label, fmtVal(secondWin));
                namedWins.add(secondWin.metricKey);
            } else {
                praiseText = pick(PERFECT_SURVEYS_SOLO)(perfect.text);
            }
        } else if (hasJump) {
            praiseText = pick(tensed(JUMP_INTROS, recency))(biggestJump.label, fmtDelta(biggestJump.metricKey, biggestJump.delta), fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue), moveWhen);
            namedWins.add(biggestJump.metricKey);
            const otherWins = wins.filter(w => w.metricKey !== biggestJump.metricKey).slice(0, 1);
            if (otherWins.length > 0) {
                praiseText += ` ${pick(PLUS_SOLID)(otherWins[0].label, fmtVal(otherWins[0]))}`;
                namedWins.add(otherWins[0].metricKey);
            }
        } else if (wins.length >= 2) {
            praiseText = pick(tensed(TWO_WINS, recency))(wins[0].label, fmtVal(wins[0]), wins[1].label, fmtVal(wins[1]));
            namedWins.add(wins[0].metricKey);
            namedWins.add(wins[1].metricKey);
        } else if (wins.length === 1) {
            praiseText = pick(ONE_WIN)(wins[0].label, fmtVal(wins[0]));
            namedWins.add(wins[0].metricKey);
        } else {
            // Nothing on target and nothing that really moved: the best true
            // thing in the numbers, and the effort when there is none. Not a
            // win, so hadPraise below stays false and "With those wins in
            // mind" is not said after it. A survey sample with a detractor in
            // it is kept out here for the same reason it is kept out of wins.
            const praisable = allMetrics.filter(m => !(kickoffHasDetractorSurveys && SURVEY_METRIC_KEYS.has(m.metricKey)));
            praiseText = truePositiveLine(truePositiveFor(emp, praisable, focalPoint?.metricKey, recency.ongoing), recency.ongoing)
                || pick(NO_WINS);
        }
        const hadPraise = !!(perfect || hasJump || wins.length);

        // Credit the rest of the wins too, two by name and the rest as a
        // count (see extrasPhrase). Nine numbers in one sentence was a wall.
        const remainingWins = allWinsSorted.filter(w => !namedWins.has(w.metricKey));
        if (remainingWins.length > 0) {
            const pool = allOnTarget ? HF_EXTRAS_SWEEP : HF_EXTRAS;
            praiseText += ` ${pick(tensed(pool, recency))(extrasPhrase(remainingWins, allOnTarget))}`;
        }

        // ytdMap is already built for the focal point; handing it over saves a
        // second full YTD analysis pass per associate on a bulk generate. The
        // block is told whether a focus is already set, because one "losing
        // ground" line is plenty under a focus that is asking for work.
        const yearBlock = buildYearStandingBlock(employeeName, allMetrics, ytdMap, { hasFocus: !!focalPoint });
        // No options at all is the standalone kickoff button, which is Monday
        // and does open the week. An explicit empty day word is a caller
        // saying there is no day to name, which is different from not saying.
        const dayWord = options ? String(options.dayWord || '').trim() : 'Monday';
        const startsTheWeek = options?.startsTheWeek !== false;

        // With no day to name, the openers that name one are not in the pool.
        // A greeting that has to invent a weekday would be back where this
        // started.
        const pool = startsTheWeek ? MK_OPENERS_WEEK_START : MK_OPENERS_MIDWEEK;
        const openers = dayWord ? pool : pool.filter(line => line.length < 2);

        // A month or year window says which stretch this is and what it is
        // held against, then shows the moves since. The comparison is only
        // promised when there is one to show.
        const frame = options?.frame?.now ? options.frame : null;
        let opener;
        let compareText = '';
        if (frame) {
            const compared = !!frame.prior && weekDeltas.length > 0;
            const tense = recency.ongoing ? 'ongoing' : 'done';
            const greetings = dayWord ? FRAME_GREETINGS : FRAME_GREETINGS.filter(line => line.length < 2);
            const line = compared
                ? pick(FRAME_OPENERS[tense])(frame.now, frame.prior)
                : pick(FRAME_OPENERS[`${tense}Alone`])(frame.now);
            opener = `${pick(greetings)(firstName, dayWord)} ${line}`;
            if (compared) {
                const baseEmp = getPeriodData(baselineKey)?.employees?.find(e => e.name === employeeName) || null;
                const jumpSaid = !perfect && hasJump ? biggestJump.metricKey : null;
                const missKeys = new Set(allMetrics.filter(missesTarget).map(m => m.metricKey));
                const block = buildFrameComparison(frame, weekDeltas, new Set(allMetrics.map(m => m.metricKey)), baseEmp, jumpSaid, missKeys);
                if (block) compareText = `\n\n${block}`;
            }
        } else {
            opener = pick(openers)(firstName, dayWord);
        }

        // FOCUS section: set the weekly focal point
        let focusText = '';
        if (focalPoint) {
            // When the focus is the metric the praise just credited, it gets
            // the next stop rather than "it's been a pattern".
            const focalPhrase = hasJump && biggestJump.metricKey === focalPoint.metricKey
                ? pick(FOCUS_IMPROVING)(focalPoint.label, fmtVal(focalPoint), fmtTarget(focalPoint))
                : buildFocalText(focalPoint, tensedFocus({ persistent: MK_FOCUS_PERSISTENT, ytdOnly: MK_FOCUS_YTD_ONLY, weekDip: MK_FOCUS_WEEK_DIP, fallback: MK_FOCUS_FALLBACK }, recency), recency.when, ahead);
            // "With those wins in mind" only follows wins, and never a
            // "Behind September" line (Scott, 2026-10-14).
            const praiseLast = hadPraise && !/\n(Behind|Slipped since) /.test(compareText);
            const transitions = praiseLast ? MK_TRANSITION.concat(MK_TRANSITION_NEUTRAL) : MK_TRANSITION_NEUTRAL;
            focusText = `\n\n${pick(lookingAhead(transitions, ahead))}\n\n${focalPhrase}`;

            const tip = await tipFor(employeeName, focalPoint.metricKey, 'medium');
            if (tip) focusText += ` ${tip}`;

            // Persist the focal point for midweek recall
            saveFocalPoint(employeeName, latestKey, focalPoint.metricKey, focalPoint.label, focalPoint.employeeValue, focalPoint.target);
        } else {
            focusText = `\n\n${pick(lookingAhead(MK_ALL_GOOD, ahead))}`;
        }

        let message = `${opener} ${praiseText}${compareText}${focusText}`;
        if (yearBlock) message += `\n\n${yearBlock}`;
        message += `\n\n${pick(lookingAhead(MK_CLOSERS, ahead))}`;
        return polish(message);
    }

    // Three bullets is as much of a standings block as a Monday message can
    // carry before it stops being read, and two pace sentences under them is
    // as much arithmetic as still reads like coaching.
    const YEAR_STANDING_LIMIT = 3;
    const YEAR_PACE_LINES = 2;

    // The near-term stretch a pace sentence describes first. Four weeks is a
    // month, which is a length of time somebody can picture themselves holding
    // a number for.
    const YEAR_PACE_STRETCH = 4;

    /**
     * The best full week they have actually posted this year for one metric.
     *
     * This is the ceiling on what a pace sentence is allowed to ask for, and it
     * exists because the required average has no ceiling of its own. Late in a
     * year with most of the volume banked, "what the rest of the year has to
     * average" comes back at 343 seconds against a 426 second target: the
     * arithmetic is really saying "not this year", but it says it in a voice
     * that sounds like a plan. Nobody reading that believes it, and once they
     * have been handed one number they know is impossible they stop believing
     * the next one too. Their own best week is a bar somebody in the room has
     * actually cleared, so an ask above it is one we do not make at all.
     *
     * Thin weeks are skipped on the same floor calcWeekDeltas puts on its
     * baseline: a six call week at 100% is not a week anybody can repeat.
     */
    function bestWeekValue(employeeName, metricKey, yearKeys) {
        const weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        const reverse = typeof isReverseMetric === 'function' && isReverseMetric(metricKey);
        let best = null;
        (yearKeys || []).forEach(key => {
            const emp = weekly[key]?.employees?.find(e => e.name === employeeName);
            if (!emp) return;
            const calls = parseInt(emp.totalCalls, 10);
            if (Number.isFinite(calls) && calls < MIN_BASELINE_CALLS) return;
            const value = parseFloat(emp[metricKey]);
            if (!Number.isFinite(value)) return;
            if (best === null || (reverse ? value < best : value > best)) best = value;
        });
        return best;
    }

    // A required average of 104% is arithmetic, not an ask. futures.isAchievable
    // makes the same judgement for the Futures table but is not exported, so its
    // two live conditions are restated here rather than reached for.
    function askIsPossible(metricKey, value) {
        if (!Number.isFinite(value) || value <= 0) return false;
        const unit = window.METRICS_REGISTRY?.[metricKey]?.unit || '';
        return !(unit === '%' && value > 100);
    }

    /**
     * The pace sentence for one slipping metric, or nothing.
     *
     * The number it asks for is the number the Futures tab asks for: what the
     * rest of the year has to average for the year figure to land on target,
     * weighted by the volume that actually carries it. Two surfaces quoting two
     * different answers to the same question is how a coaching conversation
     * gets argued instead of had, so this borrows futures' arithmetic whole
     * rather than keeping a second copy of it here.
     *
     * The stretch it describes starts at a month and widens to the rest of the
     * year when a month does not move the figure far enough to be worth
     * printing. That is not a presentational choice. Four weeks of good work
     * against a year with forty thousand calls already banked in it moves the
     * YTD number by a tenth of a point, and "brings the year to 91.3%" printed
     * under a bullet that just said 91.2% reads as a rounding error, which is
     * exactly what moveIsNoise is there to catch.
     */
    function buildYearPaceText(entry, context) {
        const rp = window.DevCoachModules?.rankProjection;
        const futures = window.DevCoachModules?.futures;
        if (!rp?.buildPaceClause || !futures?.calculateRequiredAverage) return '';

        const rankKey = entry.rankKey;
        const metricKey = entry.metricKey;
        const ytdMetric = context.ytdMap.get(metricKey);
        if (!ytdMetric) return '';
        if (!rp.isProjectable(rankKey, context.ytdRow)) return '';

        const current = Number(ytdMetric.employeeValue);
        const target = Number(ytdMetric.target);
        if (!Number.isFinite(current) || !Number.isFinite(target)) return '';

        const weekInfo = context.weekInfo;
        const weeksLeft = weekInfo.weeksRemaining;
        const volume = futures.projectedVolume(context.ytdRow, context.rates, metricKey, weekInfo);
        // With no volume columns to weight by, week counting is what is left.
        // It is what futures falls back to and it is honest enough as long as
        // nothing downstream dresses it up as more than a guess.
        const banked = volume ? volume.done : weekInfo.weeksCompleted;
        const perWeek = volume ? volume.perWeek : 1;
        if (!(perWeek > 0) || !(banked >= 0)) return '';

        const ask = futures.calculateRequiredAverage(current, weekInfo.weeksCompleted, weeksLeft, target, volume);
        if (!askIsPossible(metricKey, ask)) return '';

        // No weekly uploads to read is no evidence either way, and that gets the
        // same answer as an ask above their best week does: nothing.
        const reverse = typeof isReverseMetric === 'function' && isReverseMetric(metricKey);
        const ceiling = bestWeekValue(context.employeeName, metricKey, weekInfo.yearKeys);
        if (ceiling === null || (reverse ? ask < ceiling : ask > ceiling)) return '';

        const stretches = weeksLeft > YEAR_PACE_STRETCH ? [YEAR_PACE_STRETCH, weeksLeft] : [weeksLeft];
        let clause = '';
        stretches.some(periods => {
            const projected = rp.projectValue(current, banked, ask, periods * perWeek);
            if (projected === null) return false;
            if (rp.moveIsNoise(rankKey, projected - current)) return false;
            clause = rp.buildPaceClause({
                rankKey,
                currentValue: current,
                target,
                assumedValue: ask,
                projectedValue: projected,
                periods,
                // The real volumes are in hand here, so the period count that
                // crosses the target is walked rather than recovered from the
                // projection, which is the better of the two answers wherever
                // it is available.
                periodsToTarget: rp.periodsToReach({
                    currentValue: current,
                    volumeSoFar: banked,
                    volumePerPeriod: perWeek,
                    assumedValue: ask,
                    goalValue: target,
                    isReverse: reverse,
                    maxPeriods: weeksLeft
                }),
                maxPeriods: weeksLeft
            });
            return !!clause;
        });
        return clause;
    }

    /**
     * How much of the year is behind this associate, and how much is ahead.
     *
     * futures.estimateWeekCounts answers a different question than the one this
     * arithmetic asks. It counts weekly upload FILES for the year, and the
     * ordinary state of the folder is a dozen weekly files sitting beside a YTD
     * file that closed in July, because people upload the YTD file and stop
     * bothering with the weeks. Read off the file count, a message written in
     * late August told an associate there were forty weeks of the year left to
     * fix things in, and worked out the average it asked them to hold against
     * forty weeks of call volume the calendar does not contain.
     *
     * That error only ever runs one way, which is what makes it worse than a
     * wrong number. Inflating the volume still to come drags the required
     * average toward the target, so the ask always comes out softer than the
     * truth, and the ceiling below refuses to print any ask better than the
     * associate's best posted week. An ask that has been quietly softened
     * clears that gate. The bug did not just misstate a figure, it manufactured
     * the sentence the gate exists to withhold.
     *
     * So the weeks come off the closing date of the YTD upload the values
     * themselves came from. That is the rule buildFuturesData settled on, and
     * the reason futures exports weeksCompletedThroughDate at all: same upload,
     * same denominator, same required average on both surfaces. The alternative
     * of asking futures for a corrected count wholesale means running
     * buildFuturesData, which builds the entire team table, once per associate
     * inside a loop that already runs once per associate.
     *
     * Nothing is printed when the count cannot be established, or when the
     * newest YTD upload belongs to a year that is already over. Last year's
     * values measured against this year's calendar is not a pace, and the
     * failure mode here has to stay "say nothing" rather than "say something
     * gentler than the truth".
     */
    function yearPaceWeekInfo() {
        const futures = window.DevCoachModules?.futures;
        if (!futures?.estimateWeekCounts || typeof futures.weeksCompletedThroughDate !== 'function') return null;

        // The same upload getYtdEmployeeRow reads the values out of, on purpose:
        // values and denominator have to describe the same stretch of the year.
        const ytdPeriod = latestYtdPeriod();
        if (!ytdPeriod) return null;

        const weekInfo = futures.estimateWeekCounts();
        if (!weekInfo) return null;

        // The four-digit prefix rather than the parsed Date. "2026-01-01" is UTC
        // midnight, and every local getter west of Greenwich reads it back as
        // December 31 of the year before, which is the one day where being an
        // hour out moves the answer into a different year.
        const stamped = /^(\d{4})-/.exec(ytdPeriod.endText);
        const year = stamped ? parseInt(stamped[1], 10) : ytdPeriod.end.getFullYear();
        if (year !== weekInfo.currentYear) return null;

        const weeksDone = futures.weeksCompletedThroughDate(ytdPeriod.endText, ytdPeriod.end);
        if (!(weeksDone > 0)) return null;

        return {
            currentYear: weekInfo.currentYear,
            totalWeeks: weekInfo.totalWeeks,
            weeksCompleted: weeksDone,
            weeksRemaining: Math.max(0, weekInfo.totalWeeks - weeksDone),
            // The weekly keys are left exactly as they came. Two things read
            // them, the forward run rate and the best-week ceiling, and both are
            // asking what is on file rather than what the calendar says.
            yearKeys: weekInfo.yearKeys
        };
    }

    /**
     * Fill in the pace sentences, on the lines that need one.
     *
     * Slipping lines only. Somebody gaining ground can already see that what
     * they are doing is working, and a second paragraph of arithmetic under
     * good news reads as a lecture. The slipping lines are also the ones with
     * months left to act on, which is why the block leads with them in the
     * first place.
     *
     * Every piece of this is optional at call time. rank-projection absent,
     * futures absent, no YTD upload, an upload left over from a year already
     * finished, no weeks left in the year: the block renders exactly as it did
     * before any of it existed.
     */
    function attachYearPace(entries, employeeName, ytdMap) {
        const futures = window.DevCoachModules?.futures;
        if (!futures?.estimateWeekCounts) return;

        const slipping = entries.filter(e => e.movement === 'slipping' && e.rankKey);
        if (!slipping.length) return;

        const ytdRow = getYtdEmployeeRow(employeeName);
        const map = ytdMap || getYtdMetricsMapForEmployee(employeeName);
        if (!ytdRow || !map || typeof map.get !== 'function') return;

        const weekInfo = yearPaceWeekInfo();
        if (!weekInfo || !(weekInfo.weeksRemaining > 0)) return;

        const rates = futures.weeklyVolumeRates
            ? (futures.weeklyVolumeRates(weekInfo.yearKeys) || {})[employeeName] || null
            : null;

        const context = { employeeName, ytdMap: map, ytdRow, weekInfo, rates };
        let written = 0;
        slipping.forEach(entry => {
            if (written >= YEAR_PACE_LINES) return;
            const pace = buildYearPaceText(entry, context);
            if (!pace) return;
            entry.paceText = pace;
            written += 1;
        });
    }

    /**
     * Whether they are gaining or losing ground on the floor this year.
     *
     * Ranks decide the direction and are then discarded — associates see which
     * way they are moving, never where they sit. A number would have them
     * comparing themselves to a colleague; a direction has them moving.
     *
     * The direction alone was half a message, so the lines that are going the
     * wrong way also carry what holding a particular number would do to the
     * year figure. That sentence never mentions a position either; see
     * buildYearPaceText, and yearStanding.safePaceText, which refuses one that
     * does.
     */
    /* Three things changed here on 2026-10-14, all from Scott's read of the
     * round:
     *
     *  - The value on each bullet is the year's, from the YTD upload. It used
     *    to be the window's number, so under a week window "Rep Satisfaction
     *    100%" sat under a heading that says the year.
     *  - A metric still in the top third of the floor is not called slipping.
     *    "The floor has been passing you here" printed above "2nd in the Call
     *    Center" for the same number reads as the app contradicting itself.
     *  - Good news leads, and when the message already has a focus asking for
     *    work, one "losing ground" line is enough (options.hasFocus).
     */
    function buildYearStandingBlock(employeeName, allMetrics, ytdMap, options) {
        const opts = options || {};
        const standing = window.DevCoachModules?.yearStanding;
        if (!standing?.gatherYearMovement) return '';

        const movement = standing.gatherYearMovement(employeeName);
        if (!movement) return '';

        // Rank keys differ from registry keys, so map back to the metric name
        // the associate would actually recognise. Reliability has no row here
        // and must not gain one: it is hours missed against an annual budget
        // rather than an average, so there is no pace to hold and no honest way
        // to project it, quite apart from what mailing somebody a projection of
        // their attendance would amount to.
        const RANK_TO_METRIC = {
            aht: 'aht',
            adherence: 'scheduleAdherence',
            sentiment: 'overallSentiment',
            associateOverall: 'cxRepOverall',
            fcr: 'fcr',
            overallExperience: 'overallExperience',
            positiveWord: 'positiveWord',
            negativeWord: 'negativeWord',
            managingEmotions: 'managingEmotions'
        };

        // The year's own numbers. The YTD map has already been through the
        // survey gate, so a year with no rep-sat surveys has no row to print.
        const yearMap = ytdMap || getYtdMetricsMapForEmployee(employeeName);
        const yearOf = (metricKey) => (yearMap && typeof yearMap.get === 'function' ? yearMap.get(metricKey) : null) || null;

        const entries = [];
        Object.keys(RANK_TO_METRIC).forEach(rankKey => {
            const metricKey = RANK_TO_METRIC[rankKey];
            const move = standing.classifyMovement(movement.earlier[rankKey], movement.current[rankKey], movement.fieldSize);
            if (!move || move === 'holding') return;

            const year = yearOf(metricKey);
            if (!year && SURVEY_METRIC_KEYS.has(metricKey)) return;

            // Still in the top third of the floor is not a slide worth a
            // worry, whatever a few places of drift say.
            const nowRank = Number(movement.current[rankKey]);
            const field = Number(movement.fieldSize) || 0;
            if (move === 'slipping' && field > 0 && Number.isFinite(nowRank) && nowRank <= field / 3) return;

            entries.push({
                // Both keys ride along so the pace pass can find its way back
                // to the metric after the sort has moved the rows around.
                rankKey,
                metricKey,
                label: window.METRICS_REGISTRY?.[metricKey]?.label || metricKey,
                valueText: year ? fmtVal(year) : '',
                targetText: year ? fmtTarget(year) : '',
                movement: move
            });
        });

        // Gains first, then what slipped. Under a focus, one slip at most.
        const gaining = entries.filter(e => e.movement === 'gaining');
        const slipping = entries.filter(e => e.movement === 'slipping').slice(0, opts.hasFocus ? 1 : YEAR_STANDING_LIMIT);
        // A slide still gets its line: the gains leave a slot for it.
        const ordered = gaining.slice(0, slipping.length ? YEAR_STANDING_LIMIT - 1 : YEAR_STANDING_LIMIT).concat(slipping);
        if (!ordered.length) return '';
        entries.length = 0;
        ordered.forEach(e => entries.push(e));

        // Only the lines that will actually be printed are worth the work.
        attachYearPace(entries.slice(0, YEAR_STANDING_LIMIT), employeeName, ytdMap);

        return standing.buildYearStandingText(entries, {
            limit: YEAR_STANDING_LIMIT,
            pick,
            closer: standing.urgencyLine(new Date())
        });
    }

    /* --- Where they stood, and what one step would have moved ---------------

       This is the block the year standing block above deliberately is not, and
       the two have to stay apart.

       yearStanding refuses to hand an associate a position at all, and the
       refusal is structural rather than editorial: safePaceText drops any
       sentence carrying an ordinal or an "N of M" before it can reach a bullet,
       and four regexes in the test suite hold it to that. None of that moves.
       What follows is a second block, built and gated on its own, which says
       the thing out loud for a named period: where they finished in the call
       center, where they finished on the team, and what one honest step off
       their current number would have been worth in places.

       The standing objection to a placing is that the field is not frozen, and
       nothing here pretends it is. What this does instead is refuse every
       version of the claim that would be a guess:

         - The placings are facts about a period that has already closed, and
           the header names that period. A placing off last week and a placing
           off the year are different claims about the same person, and a block
           that does not say which one it is making invites the reader to assume
           the bigger one.
         - The gain is never estimated from a gap, a percentile or a spacing.
           The improved value goes back through rankProjection.projectRank,
           which re-ranks the real field under the real tie rule, and the number
           printed is the difference between two placings on the same board.
         - A gain of nought or one is not printed. On a field of a hundred, one
           place is somebody else having an ordinary week, and a milestone that
           promises nothing teaches the reader that none of these numbers mean
           anything.
         - The step is a round amount in the metric's own unit and never below
           the metric's noise threshold, so "take five seconds off your handle
           time" cannot appear beside a fifteen second floor that says five
           seconds is not a move at all.
         - The frozen field is stated once, in plain words, at the bottom.

       Reliability is absent and has to stay absent. It is attendance: hours
       missed against an annual budget rather than an average, so there is no
       step to take and no honest re-rank to do, and mailing somebody a placing
       on their attendance is the single line in this app most likely to become
       a real problem for a real person. It has no row in RANK_TO_REGISTRY, so
       it cannot be mapped to a label or a noise floor and drops out of the loop
       below on its own. STANDINGS_NEVER says it a second time anyway, because
       "drops out on its own" is exactly the kind of property a later edit
       removes without noticing it was load bearing. */

    // Three metrics is a standings block. Six is a spreadsheet, and a
    // spreadsheet in a direct message does not get read.
    const STANDINGS_LIMIT = 3;

    // Below this a "gain" is noise in somebody else's week rather than movement
    // in this one. Two places is the smallest move worth putting a name to.
    const STANDINGS_MIN_GAIN = 2;

    // A placing out of four people is a true fact about a very small room, and
    // it reads like one. Nothing is said about a metric that few were scored on.
    const STANDINGS_MIN_FIELD = 5;
    const STANDINGS_MIN_TEAM = 3;

    /* Every placing in the private block is said as a placing.
     *
     * Scott, 2026-10-14, asked for the Call Center placing only inside the
     * top 15, with "34 people ahead of you and 3 behind you" past it. Reading
     * the private round on 2026-10-21 he changed that: "I don't want to say
     * ... fifty-two people ahead of you and 58 behind you. I wouldn't mind
     * saying like 52nd in the call center, 7th on the team." So each bullet
     * gives the Call Center placing and the team placing, wherever they fall.
     * The field minimums below still decide whether a placing is said at all.
     */

    // Never, whatever a caller or a later edit puts into PROJECTABLE_RANK_KEYS.
    const STANDINGS_NEVER = new Set(['reliability']);

    /* The one metric that keeps its slot when the block is full.
     *
     * Four metrics qualify and three get printed, so one is always dropped, and
     * the rule that decides which used to be "whichever a step would move
     * least". That is a sensible rule for a coaching line and the wrong one
     * here: rep satisfaction is the number an associate is asked about by name,
     * and a survey week that went well or badly is the week they already know
     * about. Leaving it out to make room for a larger projected gain answers a
     * question nobody asked.
     *
     * This pins a slot, it does not lower a bar. Rep satisfaction still has to
     * become a candidate on its own — isProjectable withholds it under three
     * surveys and the field and agreement gates below apply to it unchanged, so
     * a thin survey week prints nothing here exactly as before.
     */
    const STANDINGS_PINNED = 'associateOverall';

    /* The four metrics this block is allowed to talk about.
     *
     * rank-projection will happily project six: it also ranks First Call
     * Resolution and Overall Experience, and an earlier cut of this block
     * walked that whole list. But the five KPIs an associate is actually scored
     * on at year end are adherence, sentiment, rep satisfaction, handle time
     * and reliability, and reliability is attendance, which this block does not
     * report. Four is what is left, and four is what was asked for.
     *
     * The wider list is not wrong, it is a different question. Ranking somebody
     * on a metric nobody grades them on invites "so what happens if I am 40th
     * at this", and the honest answer is nothing, which is not a sentence worth
     * sending. Kept as its own list rather than as a filter over
     * PROJECTABLE_RANK_KEYS so that adding a projectable metric for the manager
     * ladder cannot quietly widen what lands in somebody's inbox.
     */
    const STANDINGS_METRICS = ['adherence', 'sentiment', 'associateOverall', 'aht'];

    // Round amounts a person can picture, keyed by the unit the metric is
    // measured in rather than by the metric itself, so a metric added later
    // arrives with a sensible ladder instead of inheriting somebody else's
    // fifteen seconds. Rungs below the metric's own noise threshold are dropped
    // where the ladder is walked, which is what keeps a one point step off a
    // survey metric that only moves two points at a time.
    const STANDINGS_STEPS_BY_UNIT = {
        sec: [5, 10, 15, 20, 30, 45, 60],
        '%': [1, 2, 3, 5, 10],
        hrs: [0.5, 1, 2, 4]
    };

    function standingsOrdinal(n) {
        const tens = n % 100;
        if (tens >= 11 && tens <= 13) return n + 'th';
        return n + ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
    }

    /**
     * The period the placings came from, said the way a person would say it.
     *
     * Not decoration on the header. It is the scope of every number underneath,
     * and the one thing that stops "12th" being read as a claim about the
     * whole year when it is a claim about five days.
     *
     * Returns { open, scope, header }: whether the stretch is still running,
     * the word a milestone uses for it ("this week", "this month"), and the
     * whole header. Scott, 2026-10-14: September read "Where you stood for the
     * week so far, through Wednesday 09/30/2026" because a month had no branch
     * of its own, and October so far was spoken of in the past. A month now
     * reads "Where you stand in October so far" or "Where you finished in
     * September", and dates read "Oct 13".
     */
    function standingsPeriod(periodKey) {
        const key = String(periodKey || '');
        const ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        const period = getPeriodData(key) || ytd[key] || null;
        const type = key.indexOf('month:') === 0
            ? 'month-agg'
            : (period?.metadata?.periodType || (ytd[key] ? 'ytd' : 'week'));
        const open = standingsPeriodIsOpen(periodKey);
        const stood = (phrase, scope) => ({ open, scope: scope || '', header: (open ? 'Where you stand ' : 'Where you stood ') + phrase });

        if (type === 'month' || type === 'month-agg' || type === 'month-to-date') {
            let month = '';
            if (key.indexOf('month:') === 0) {
                const parts = key.slice(6).split('-');
                const when = new Date(Number(parts[0]), Number(parts[1]) - 1, 1, 12);
                month = Number.isNaN(when.getTime()) ? '' : when.toLocaleString('en-US', { month: 'long' });
            } else {
                month = monthWord(key);
            }
            if (!month) return stood('for this period');
            return open
                ? { open, scope: 'this month', header: `Where you stand in ${month} so far` }
                : { open, scope: '', header: `Where you finished in ${month}` };
        }
        if (type === 'ytd') {
            return open
                ? { open, scope: 'this year', header: 'Where you stand for the year so far' }
                : { open, scope: '', header: 'Where you finished the year' };
        }
        if (type === 'quarter') {
            return open
                ? { open, scope: 'this quarter', header: `Where you stand in ${getQuarterName(key)} so far` }
                : { open, scope: '', header: `Where you finished in ${getQuarterName(key)}` };
        }

        const ending = String(period?.metadata?.endDate || (key.indexOf('|') > -1 ? key.split('|')[1] : '')).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(ending)) return stood('for this period');
        const endsOn = new Date(ending + 'T12:00:00');
        const dayAndDate = shortDate(ending, true);

        // A day is a day, not a week that ended after one of them.
        if (type === 'daily') return stood('on ' + dayAndDate);

        /* A four-day file is not a week that ended.
         *
         * "the week ending Sep 3" on a Monday-through-Thursday upload says
         * the week finished on Thursday. It did not: nobody's week ends
         * mid-week, and on the Friday message the reader is still standing
         * in it. So a period that stops on a Monday through Thursday is named
         * for how far it got rather than for an ending it does not have.
         *
         * Friday keeps "the week ending", because Friday is where this team's
         * week actually stops. The calendar runs to Sunday and one person works
         * into it, but a Friday-ending file is the whole week for everybody
         * else, and calling that "the week so far" would understate a week that
         * is done.
         */
        const dow = Number.isNaN(endsOn.getTime()) ? null : endsOn.getDay();
        if (dow !== null && dow >= 1 && dow <= 4) {
            return open
                ? stood('this week so far, through ' + dayAndDate, 'this week')
                : stood('for the week through ' + dayAndDate);
        }
        return stood('for the week ending ' + shortDate(ending));
    }

    // The step in the words the metric is actually measured in. An empty string
    // for a unit with no natural step word, which stops the milestone rather
    // than inventing one: "add 3" is not an instruction anybody can follow.
    function standingsStepText(registryKey, step) {
        const unit = window.METRICS_REGISTRY?.[registryKey]?.unit || '';
        if (unit === 'sec') return step + (step === 1 ? ' second' : ' seconds');
        if (unit === 'hrs') return step + (step === 1 ? ' hour' : ' hours');
        if (unit === '%') return step + (step === 1 ? ' point' : ' points');
        return '';
    }

    /**
     * Where the step lands them, or null when it lands somewhere the metric
     * cannot go. A percentage over a hundred and a handle time of zero are both
     * arithmetic the units forbid, and asking for either would tell the reader
     * that nobody checked.
     */
    function standingsImprovedValue(registryKey, current, step, reverse) {
        const improved = reverse ? current - step : current + step;
        if (!Number.isFinite(improved)) return null;
        if (reverse && improved <= 0) return null;
        const unit = window.METRICS_REGISTRY?.[registryKey]?.unit || '';
        if (unit === '%' && (improved > 100 || improved < 0)) return null;
        return improved;
    }

    /**
     * Is the week this block describes still being worked?
     *
     * It decides the tense of everything below. A file that stops on a Monday
     * through Thursday inside the current week is a week with days left in it,
     * so "you would have finished two places higher" is the wrong sentence: it
     * hands back a result on a week the reader can still change, which is the
     * opposite of what a Friday message is for.
     *
     * Both halves are required. Thursday alone is not enough, because a
     * four-day file from three weeks ago is every bit as finished as a full
     * one, and telling someone they can still move up in it would be a plain
     * falsehood. Friday on is a week that stopped whatever the date, since
     * Friday is where this team's week ends.
     */
    function standingsPeriodIsOpen(periodKey) {
        const key = String(periodKey || '');
        const ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        const period = getPeriodData(key) || ytd[key] || null;
        const type = key.indexOf('month:') === 0
            ? 'month-agg'
            : (period?.metadata?.periodType || (ytd[key] ? 'ytd' : 'week'));

        /* A month to date, or the year to date, is still being worked while
         * the calendar is inside it. "Where you stood" and "you would have
         * finished about 5 places higher" went out over October on the
         * fourteenth (Scott, 2026-10-14): those places are still there to
         * take, so the block asks for them instead.
         */
        if (type === 'month-to-date' || type === 'month-agg' || type === 'ytd') {
            const now = new Date();
            const thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
            const end = String(period?.metadata?.endDate
                || (key.indexOf('month:') === 0 ? key.slice(6) : (key.indexOf('|') > -1 ? key.split('|')[1] : ''))).slice(0, 10);
            if (type === 'ytd') return end.slice(0, 4) === String(now.getFullYear()) && !/-12-31$/.test(end);
            return end.slice(0, 7) === thisMonth;
        }
        if (type !== 'week' && type !== 'week-in-progress') return false;

        const ending = String(period?.metadata?.endDate
            || (key.indexOf('|') > -1 ? key.split('|')[1] : '')).slice(0, 10);
        const endsOn = new Date(ending + 'T12:00:00');
        if (Number.isNaN(endsOn.getTime())) return false;
        const dow = endsOn.getDay();
        if (dow < 1 || dow > 4) return false;

        const today = new Date();
        today.setHours(12, 0, 0, 0);
        const monday = new Date(today);
        monday.setDate(monday.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1));
        const mondayIso = monday.getFullYear() + '-'
            + String(monday.getMonth() + 1).padStart(2, '0') + '-'
            + String(monday.getDate()).padStart(2, '0');
        return ending >= mondayIso;
    }

    /**
     * One step off their number, and what it would have been worth in places.
     *
     * Walks the ladder from the smallest rung upward and takes the first one
     * worth saying, so the ask is always the smallest honest ask. Three gates
     * can end the walk with nothing, and every one of them is meant to:
     *
     *   - a rung under the metric's noise threshold is skipped, because a move
     *     the app itself calls churn everywhere else cannot be sold as a
     *     milestone here;
     *   - a rung that would put them past the best number anybody in the field
     *     posted ends the walk outright rather than skipping it, since every
     *     larger rung is further past it. That is not a step, it is the whole
     *     ladder, and if the smallest rung already clears the field then the
     *     field is too tight for a milestone to mean anything;
     *   - a gain under two places is skipped, and if no rung ever reaches two
     *     the answer is nothing at all rather than a promise of nothing.
     */
    function standingsMilestone(options) {
        const rp = options.rp;
        const registryKey = options.registryKey;
        const ladder = STANDINGS_STEPS_BY_UNIT[window.METRICS_REGISTRY?.[registryKey]?.unit || ''];
        if (!ladder) return null;

        for (let i = 0; i < ladder.length; i++) {
            const step = ladder[i];
            if (rp.moveIsNoise(options.rankKey, step)) continue;

            const stepText = standingsStepText(registryKey, step);
            if (!stepText) return null;

            const improved = standingsImprovedValue(registryKey, options.current, step, options.reverse);
            if (improved === null) continue;
            if (options.fieldBest !== null
                && (options.reverse ? improved < options.fieldBest : improved > options.fieldBest)) return null;

            const newRank = rp.projectRank(options.rows, options.rankKey, options.employeeName, improved);
            if (!(newRank >= 1)) continue;

            const gain = options.baseRank - newRank;
            if (gain < STANDINGS_MIN_GAIN) continue;

            // Both numbers, not just the step. "Take 15 seconds off" is an
            // instruction with no destination in it, and the reader has to do
            // the subtraction themselves to find out what they are being asked
            // for. Naming the number they would land on turns it into a target
            // they can hold in their head on a call.
            const verb = options.reverse ? 'Take ' + stepText + ' off' : 'Add ' + stepText;
            // A week with days left in it gets an ask, not a post mortem. Same
            // arithmetic either way; the difference is whether the reader is
            // being told what they missed or what is still there to take.
            // The scope is the stretch still running: this week, this month,
            // this year. A month to date used to get the post mortem.
            const scope = options.scope ? ' ' + options.scope : '';
            const outcome = options.open
                ? ' you could still move up about ' + gain + ' places' + scope + '.'
                : ' you would have finished about ' + gain + ' places higher.';
            return {
                step,
                gain,
                text: verb + '. At ' + fmtVal(registryKey, improved) + outcome
            };
        }
        return null;
    }

    /**
     * The standings block for one associate, for one period.
     *
     * Private messages only. Every caller is one person writing to one other
     * person; nothing public gets a placing out of here, for the same reason a
     * channel shout-out names a placing and never a beaten count.
     *
     * Degrades to an empty string at every step rather than throwing or
     * guessing: no ranking module, no row for this person, a period that will
     * not build, a metric they are too thin on to be judged on at all. An
     * associate who gets no block gets the message exactly as it read before
     * any of this existed, which is the failure everybody can live with.
     */
    function buildStandingsBlock(employeeName, periodKey, spokenFor) {
        const ranking = window.DevCoachModules?.centerRanking;
        const rp = window.DevCoachModules?.rankProjection;
        if (!ranking?.buildRankingsForPeriod || !rp?.projectRank || !rp?.isProjectable) return '';

        let data = null;
        try { data = ranking.buildRankingsForPeriod(periodKey); } catch (e) { return ''; }
        const rows = data && Array.isArray(data.rankings) ? data.rankings : [];
        if (!rows.length) return '';
        const row = rows.find(r => r && r.name === employeeName);
        if (!row) return '';

        // teamMembers is the supervisor's roster for the period. Ranking only
        // those rows is the team placing, and it has to be computed rather than
        // read off the center rank: "3rd of 18" is a different question from
        // "12th of 118" and the center number cannot answer it.
        const teamSet = data.teamMembers instanceof Set ? data.teamMembers : null;
        const teamRows = teamSet && teamSet.has(employeeName)
            ? rows.filter(r => r && teamSet.has(r.name))
            : [];

        const candidates = [];
        // Asked once for the whole block, because every milestone in it has to
        // be in the same tense, and the header with them.
        const named = standingsPeriod(periodKey);
        const periodIsOpen = named.open;
        // The scorecard four, not everything rank-projection can project. See
        // STANDINGS_METRICS for why the two lists are deliberately different.
        STANDINGS_METRICS.forEach(rankKey => {
            if (STANDINGS_NEVER.has(rankKey)) return;
            if (!(rp.PROJECTABLE_RANK_KEYS || []).includes(rankKey)) return;
            const registryKey = rp.registryKeyFor(rankKey);
            if (!registryKey || STANDINGS_NEVER.has(registryKey)) return;

            // Thin volume, or too few surveys to be judged on at all. A placing
            // built on four calls is a placing built on nothing, and the gate
            // that already decides that for the pace sentences decides it here.
            if (!rp.isProjectable(rankKey, row)) return;

            // Nobody answered, so there is nothing to place them on. The value
            // that reaches this point for a survey metric with no responses
            // behind it is 0, which sorts as the worst week in the building, and
            // the pin above would then print it every time. isProjectable does
            // not catch this on its own: it lets an unknown count through so a
            // missing column cannot silence a whole board at once, which is the
            // right call for a call volume and the wrong one for a survey.
            if (SURVEY_METRIC_KEYS.has(registryKey) && !(parseFloat(row.surveyTotal) > 0)) return;

            /* The number under this label is not always this metric.
             *
             * When rep sat comes back blank or zero the scorer substitutes
             * Overall Experience and marks the row, and every surface
             * downstream prints the result under the rep-sat label. Center
             * ranking flags it for the manager with an orange OE beside the
             * cell, because a manager is comparing it against a rep-sat figure
             * they have open in another window and silence costs them the
             * comparison. The same silence costs an associate more.
             *
             * A placing off a substituted row is wrong twice. It answers a
             * different question from the one the label asks, and it answers it
             * against a column where some rows are rep sat and some are Overall
             * Experience, which is not a field anybody actually finished in.
             * Relabelling the bullet would fix the first and leave the second.
             *
             * So it is dropped rather than dressed up, and the pinned slot goes
             * back to a metric that was measured. That is Scott's call, and it
             * is the one consistent with the rest of this block: every gate here
             * ends in saying nothing rather than in saying something smaller.
             */
            if (rankKey === 'associateOverall' && row.associateOverallSource === 'overallExperience') return;

            // Number(null) is 0 and Number('') is 0, and a zero is a perfect
            // score on a reverse metric. Every value on every row enters through
            // here so a blank can never be counted as one of the places.
            const valueOf = (r) => {
                const raw = rp.rankedValueFor(r, rankKey);
                if (raw === null || raw === undefined || raw === '') return null;
                const n = Number(raw);
                return Number.isFinite(n) ? n : null;
            };

            const current = valueOf(row);
            if (current === null) return;

            // The denominator is who was scored on THIS metric, not how many
            // rows the period has. Center ranking leaves a missing metric
            // unranked and it takes no place, so "12th of 127" against a column
            // only a hundred people filled in is a bigger field than the one the
            // placing was won in.
            const measured = rows.filter(r => valueOf(r) !== null);
            if (measured.length < STANDINGS_MIN_FIELD) return;

            const centerRank = rp.projectRank(rows, rankKey, employeeName, current);
            if (!(centerRank >= 1)) return;

            // The rankings table already carries a number for this metric,
            // computed the same way over the same field, so the two agree or one
            // of them is wrong. Nobody is served by picking a winner inside a
            // message the associate can hold up next to the table, so a
            // disagreement is a reason to say nothing about this metric at all.
            const tableRank = (row.metricRanks || {})[rankKey];
            if (Number.isFinite(tableRank) && tableRank !== centerRank) return;

            const reverse = typeof isReverseMetric === 'function'
                ? !!isReverseMetric(registryKey)
                : !!window.METRICS_REGISTRY?.[registryKey]?.isReverse;

            const teamMeasured = teamRows.filter(r => valueOf(r) !== null);
            const teamRank = teamMeasured.length >= STANDINGS_MIN_TEAM
                ? rp.projectRank(teamRows, rankKey, employeeName, current)
                : null;

            // Last means nobody in the field has a worse number; a tie at the
            // bottom is still last. A last place is never said (Scott,
            // 2026-10-21: "Let's hide it"), so these decide whether each half
            // of the placing line is printed.
            const worse = v => (reverse ? v > current : v < current);
            const isLast = list => !list.some(r => r !== row && r.name !== employeeName && worse(valueOf(r)));

            let fieldBest = null;
            measured.forEach(r => {
                const v = valueOf(r);
                if (fieldBest === null) { fieldBest = v; return; }
                fieldBest = reverse ? Math.min(fieldBest, v) : Math.max(fieldBest, v);
            });

            candidates.push({
                rankKey,
                registryKey,
                current,
                label: window.METRICS_REGISTRY?.[registryKey]?.label || registryKey,
                centerRank,
                centerField: measured.length,
                centerLast: isLast(measured),
                teamRank: teamRank >= 1 ? teamRank : null,
                teamLast: isLast(teamMeasured),
                teamField: teamMeasured.length,
                milestone: standingsMilestone({
                    rp, rows, rankKey, registryKey, employeeName,
                    current, reverse, fieldBest, baseRank: centerRank, open: periodIsOpen, scope: named.scope
                })
            });
        });

        if (!candidates.length) return '';

        // Their best placing leads, because it is the line they will actually
        // want to read and a block that opens on their worst number gets closed.
        // After that come the metrics a step would genuinely move, biggest move
        // first, since those are the ones there is anything to do about. Any
        // slot still empty is filled in placing order.
        const byPlacing = candidates.slice().sort((a, b) => a.centerRank - b.centerRank);
        const chosen = [byPlacing[0]];
        // Rep satisfaction takes the next slot whenever it qualified at all.
        // See STANDINGS_PINNED: it is the line they will be asked about, and it
        // does not lose its place to somebody else's bigger projected gain.
        const pinned = byPlacing.find(c => c.rankKey === STANDINGS_PINNED);
        if (pinned && chosen.indexOf(pinned) === -1) chosen.push(pinned);
        byPlacing
            .filter(c => chosen.indexOf(c) === -1 && c.milestone)
            .sort((a, b) => b.milestone.gain - a.milestone.gain)
            .forEach(c => { if (chosen.length < STANDINGS_LIMIT) chosen.push(c); });
        byPlacing.forEach(c => {
            if (chosen.length < STANDINGS_LIMIT && chosen.indexOf(c) === -1) chosen.push(c);
        });

        /* One bullet per metric, over three lines rather than one and a half.
         *
         * The old shape ran the label and both placings into a single line and
         * hung the milestone off it, which read as a wall in the preview pane
         * and worse in a chat client that wraps at an unknown width. Split by
         * what each line answers, it survives any wrap: what the number was,
         * where it finished, what one step would have been worth.
         *
         * Their own value leads, because a placing without the number behind it
         * is a position in a league table they cannot check. It is also the
         * number the milestone line then asks them to move, so the two sit
         * together instead of a paragraph apart.
         */
        const lines = chosen.map(c => {
            // The placing without the size of the field behind it. Both fields
            // are still what the rank was counted over, and the minimums above
            // still decide whether a placing is worth stating at all, but "28th
            // of 111" reads as a headcount the reader then has to interpret,
            // and the place they finished is the part they asked for.
            //
            // "Call Center" capitalised, the way every other placing in the
            // app writes it. Both placings, wherever they fall (Scott,
            // 2026-10-21: "52nd in the call center, 7th on the team"), except
            // a last place, which is left off. The number and its next step
            // still stand when both halves are.
            const center = c.centerLast ? '' : standingsOrdinal(c.centerRank) + ' in the Call Center';
            const team = c.teamRank && !c.teamLast ? standingsOrdinal(c.teamRank) + ' on our team' : '';
            const where = [center, team].filter(Boolean).join(', ');
            const bullet = '  • ' + c.label + ': ' + fmtVal(c.registryKey, c.current)
                + (where ? '\n      ' + where.charAt(0).toUpperCase() + where.slice(1) + '.' : '');
            return c.milestone ? bullet + '\n      ' + c.milestone.text : bullet;
        });

        // No caveat under the milestones. Each one is already worded as a
        // what-if about this person's own number ("you would have finished"),
        // and a note on associate-facing copy is exactly what Scott has ruled
        // out: resolve it in the wording, never in a disclaimer.
        const caveat = '';

        // Which metrics this block spoke for, so the near-miss tail after it can
        // avoid naming one of them a second time with a placing counted over a
        // different field. An out-parameter rather than a changed return type
        // because the block itself is a string everywhere it is used, and a
        // caller that does not care about the overlap should not have to unpack
        // a wrapper to get at it.
        if (spokenFor instanceof Set) chosen.forEach(c => spokenFor.add(c.rankKey));

        // A heading in words rather than a chart emoji: the message keeps its
        // two emojis for the opener and the sign-off.
        return named.header + '\n\n'
            + lines.join('\n\n') + caveat;
    }

    // Appended to a one-to-one message and nowhere else. The seam is here on
    // purpose: one function decides the block is private, and a channel post or
    // a shout-out stays clear of it by not calling this.
    function withStandings(message, employeeName, periodKey, spokenFor) {
        if (!message) return message;
        const block = buildStandingsBlock(employeeName, periodKey, spokenFor);
        // Above the sign-off, so the message still ends on it.
        return block ? beforeSignOff(message, block) : message;
    }

    // --- Week-progress message (Wed/Thu midweek, Fri closing) ---

    /**
     * Where this week stands against last week, in numbers.
     *
     * calcWeekDeltas already normalises direction (a positive delta is an
     * improvement whether the metric wants to go up or down), so this is
     * mostly a matter of deciding what cleared the noise and saying it.
     *
     * Scott, 2026-10-14, on the Wednesday round: the person sitting #1 in the
     * center got nothing but numbers, a zero-survey associate was told "Rep
     * Satisfaction is 0.0% against a 82.0% target", After Call Work coming
     * down 19 seconds was listed as "-19s" under "Up from last week", and Hold
     * Time at 11s against a 30s target was flagged as a slide. So: only the
     * metrics the message may speak about, their wins handed over so the text
     * can lead with praise, moves in words, and a slide named only when the
     * metric is short of target.
     */
    async function generateWeekProgressMessage(employeeName, latestKey, baselineKey, options = {}) {
        const outreach = window.DevCoachModules?.dailyOutreach;
        if (!outreach?.buildWeekProgressText) return null;

        const period = getPeriodData(latestKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp || tookNoCalls(emp)) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const centerAvgs = centerAveragesFor(latestKey);
        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
        const allMetrics = speakableMetrics(emp, analysis);
        const byKey = new Map(allMetrics.map(m => [m.metricKey, m]));

        // The same gate for the moves as for the numbers: nothing about a
        // metric the message is not allowed to name.
        const deltas = (baselineKey ? calcWeekDeltas(employeeName, baselineKey, latestKey) : [])
            .filter(d => byKey.has(d.metricKey));
        const hasBaseline = deltas.length > 0;

        // Same noise floor the growth view uses, so "improved" means the same
        // thing wherever it is claimed.
        const clears = (d) => d.absDelta >= getGrowthNoiseThreshold(d.metricKey);

        // Scorecard moves first, then by size in each metric's noise units.
        const scorecardFirst = (a, b) => (WIN_ORDER.indexOf(a.metricKey) > -1 ? 0 : 1) - (WIN_ORDER.indexOf(b.metricKey) > -1 ? 0 : 1);
        const improved = deltas.filter(d => d.delta > 0 && clears(d))
            .sort((a, b) => scorecardFirst(a, b) || (jumpSize(b) - jumpSize(a)))
            .slice(0, 3)
            .map(d => ({ label: d.label, deltaText: fmtDelta(d.metricKey, d.delta) }));

        // A slide on a number still comfortably on target is not a worry
        // worth handing anybody.
        const slipped = deltas.filter(d => d.delta < 0 && clears(d) && missesTarget(byKey.get(d.metricKey)))
            .sort((a, b) => scorecardFirst(a, b) || (jumpSize(a) - jumpSize(b)))
            .slice(0, 2)
            .map(d => ({ label: d.label, deltaText: fmtDelta(d.metricKey, d.delta) }));

        // Where they are: the scorecard numbers, current values only. The
        // moves underneath carry the comparison, so each number is said once.
        const scorecard = WIN_ORDER.map(k => byKey.get(k)).filter(Boolean);
        const standingsFrom = scorecard.length ? scorecard : allMetrics.slice(0, 3);
        const standings = standingsFrom.map(m => {
            const d = deltas.find(x => x.metricKey === m.metricKey);
            return {
                label: m.label,
                latestText: fmtVal(m),
                baseText: d ? fmtVal(d.metricKey, d.baseValue) : ''
            };
        });

        // The praise the text leads with: every win, sorted, a thin survey
        // sample counted once.
        const countable = collapseThinSurveys(emp, allMetrics);
        const wins = winsFrom(emp, allMetrics);
        const allOnTarget = countable.length > 1 && wins.length === countable.length;

        const ytdMap = getYtdMetricsMapForEmployee(employeeName);
        const focal = pickFocalPointSmart(allMetrics, ytdMap);
        const yearText = focal && focal.ytdValue !== null && focal.ytdValue !== undefined
            ? fmtVal(focal.metricKey, focal.ytdValue)
            : '';

        // What the two weeks are called. "This week" only when the file
        // really is this week's; otherwise the week is named plainly, with no
        // remark about what has or has not been uploaded.
        const thisWeek = options.latestIsThisWeek !== false;
        const recency = describeWeekRecency(latestKey, period, options.now);
        const nowName = thisWeek ? 'this week' : recency.when;
        const priorName = thisWeek ? 'last week' : recency.prior;

        return polish(outreach.buildWeekProgressText({
            firstName,
            tone: options.tone === 'closing' ? 'closing' : 'midweek',
            daysIn: Number.isFinite(options.daysIn) ? options.daysIn : 0,
            hasBaseline,
            thisWeek,
            nowName,
            priorName,
            // The same fact the standings block reads, so the message and the
            // block under it cannot end up one in each tense.
            weekOpen: options.weekOpen === true,
            standings,
            improved,
            slipped,
            wins: wins.map(m => ({ label: m.label, valueText: fmtVal(m) })),
            goalCount: countable.length,
            allOnTarget,
            focus: focal ? {
                label: focal.label,
                valueText: fmtVal(focal),
                targetText: fmtTarget(focal),
                // A focus the week is on target for is about the year, and
                // says so rather than calling an on-target number a push.
                yearText: focal.ytdContext === 'ytd_only' && yearText !== fmtVal(focal) ? yearText : ''
            } : null
        }));
    }

    // --- Midweek Check-In message generation ---

    async function generateMidweekCheckinMessage(employeeName, latestKey, baselineKey) {
        const period = getPeriodData(latestKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp || tookNoCalls(emp)) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const centerAvgs = centerAveragesFor(latestKey);

        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
        if (!analysis) return null;

        const allMetrics = speakableMetrics(emp, analysis);

        // Try to recall the focal point set on Monday
        const savedFocal = loadFocalPoint(employeeName, latestKey);

        let message = pick(MW_OPENERS)(firstName);

        if (savedFocal) {
            const focalMetric = allMetrics.find(m => m.metricKey === savedFocal.metricKey);
            message += ` ${pick(MW_FOCUS_RECALL)(savedFocal.label)}`;

            if (focalMetric) {
                const currentVal = fmtVal(focalMetric);
                const targetVal = fmtTarget(focalMetric);
                const meetsTarget = focalMetric.meetsTarget;
                const gap = Math.abs(focalMetric.employeeValue - focalMetric.target);
                // "4.8 points" and "38 seconds": a gap in a rate is points,
                // and "just 4.8% from 93%" read as a percentage of something.
                const gapStr = fmtAmount(focalMetric.metricKey, gap);

                // Determine if close (within 20% of target)
                const closeThreshold = focalMetric.target * 0.2;
                const isClose = gap <= closeThreshold && !meetsTarget;

                if (meetsTarget) {
                    message += ` ${pick(MW_ON_TRACK)(savedFocal.label, currentVal, targetVal)}`;
                } else if (isClose) {
                    message += ` ${pick(MW_CLOSE)(savedFocal.label, currentVal, targetVal, gapStr)}`;
                } else {
                    message += `\n\n${pick(MW_BEHIND)(savedFocal.label, currentVal, targetVal, gapStr)}`;

                    // Add a tip for the struggling metric, as "Tip: ..." rather
                    // than behind a lightbulb or a pointing finger.
                    const tip = await tipFor(employeeName, focalMetric.metricKey, 'high');
                    if (tip) message += ` ${tip}`;
                }
            } else {
                // Focal metric data not available in current period — encourage anyway
                message += pick(MW_NO_DATA_YET)(savedFocal.label);
            }
        } else {
            // No focal point was set Monday — give a general midweek snapshot
            message += ` ${pick(MW_NO_FOCUS_SET)}`;

            const focalPoint = pickFocalPoint(allMetrics);
            if (focalPoint) {
                const currentVal = fmtVal(focalPoint);
                const targetVal = fmtTarget(focalPoint);
                message += pick(MW_FALLBACK_FOCUS)(focalPoint.label, currentVal, targetVal);
            }

            // Mention a win if there is one: the best of them, scorecard first.
            const wins = winsFrom(emp, allMetrics);
            if (wins.length > 0) {
                const topWin = wins[0];
                message += pick(MW_BRIGHT_SIDE)(topWin.label, fmtVal(topWin));
            }
        }

        message += `\n\n${pick(MW_CLOSERS)}`;
        return polish(message);
    }

    // --- Monthly check-in message generation ---

    async function generateMonthlyCheckinMessage(employeeName, monthKey, prevMonthKey) {
        return generatePeriodReviewMessage(employeeName, monthKey, prevMonthKey, 'month');
    }

    async function generatePeriodReviewMessage(employeeName, periodKey, prevPeriodKey, periodType) {
        const period = getPeriodData(periodKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp || tookNoCalls(emp)) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        /* Monthly only. The quarter is Review Prep's, which writes it from the
         * whole quarter rather than from one upload against the one before.
         *
         * Said in the month's own name. On 14 October a September review said
         * "this month's 96.2%", "Big month..." and "Heading into next month"
         * (Scott, 2026-10-14); describeWeekRecency already knew September is
         * "in September" by then, so every line takes its words from there, and
         * "September 2026" is just "September" in a message.
         */
        const recency = describeWeekRecency(periodKey, period);
        const ongoing = !!recency.ongoing;
        const when = recency.when;
        const month = monthWord(periodKey);
        const thisMonth = new Date().toLocaleString('en-US', { month: 'long' });
        // The stretch the focus is for: what is left of a running month, or
        // the month we are in now after a finished one.
        const ahead = ongoing ? `the rest of ${month}` : (month !== thisMonth ? thisMonth : 'the month ahead');

        const centerAvgs = centerAveragesFor(periodKey);

        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, periodKey);
        if (!analysis) return null;

        const allMetrics = speakableMetrics(emp, analysis);
        const periodDeltas = prevPeriodKey ? calcWeekDeltas(employeeName, prevPeriodKey, periodKey) : [];
        const biggestJump = getBiggestJump(periodDeltas);

        const wins = winsFrom(emp, allMetrics).slice(0, 3);
        const focalPoint = pickFocalPoint(allMetrics);

        let praiseText = '';
        if (biggestJump && biggestJump.delta > 0) {
            praiseText = pick(MO_JUMP)(biggestJump.label, fmtDelta(biggestJump.metricKey, biggestJump.delta), fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue), when);
            const other = wins.find(w => w.metricKey !== biggestJump.metricKey);
            if (other) praiseText += ` ${pick(PLUS_SOLID)(other.label, fmtVal(other))}`;
        } else if (wins.length >= 2) {
            praiseText = pick(MO_TWO_WINS)(wins[0].label, fmtVal(wins[0]), wins[1].label, fmtVal(wins[1]), when);
        } else if (wins.length === 1) {
            praiseText = pick(MO_ONE_WIN)(wins[0].label, fmtVal(wins[0]), when);
        } else {
            // No win and no real move: lead with the best true thing in the
            // month (better than the center, closest to goal), and thank the
            // effort only when there is nothing true to name.
            praiseText = truePositiveLine(truePositiveFor(emp, allMetrics, focalPoint?.metricKey, ongoing), ongoing)
                || pick(ongoing ? MO_NO_WINS_ONGOING : MO_NO_WINS)(month);
        }

        // The scorecard numbers only. "You hit target on 0 of 12 metrics" is
        // not said at all, and every one of them at goal is a sweep.
        const core = allMetrics.filter(m => WIN_ORDER.indexOf(m.metricKey) > -1 && typeof m.meetsTarget === 'boolean');
        const coreMet = core.filter(m => m.meetsTarget).length;
        let consistencyText = '';
        if (core.length >= 2 && coreMet === core.length) {
            consistencyText = pick(MO_SWEEP)(when, core.length);
        } else if (core.length >= 2 && coreMet > 0) {
            consistencyText = pick(MO_CONSISTENCY)(coreMet, core.length, when, ongoing ? 'are' : 'were');
        }

        let focusText = '';
        if (focalPoint) {
            focusText = pick(MO_FOCUS)(focalPoint.label, fmtVal(focalPoint), fmtTarget(focalPoint), ahead);
            const tip = await tipFor(employeeName, focalPoint.metricKey, 'medium');
            if (tip) focusText += ` ${tip}`;
        }

        // "Solid month overall" is for a month that was one. A tough month,
        // or one still running, gets a sign-off that is true either way.
        const tough = !wins.length || (core.length >= 2 && coreMet / core.length < 0.5);
        const closers = tough
            ? (ongoing ? MO_CLOSERS_TOUGH : MO_CLOSERS_TOUGH.concat(MO_CLOSERS_TOUGH_DONE))
            : (ongoing ? MO_CLOSERS : MO_CLOSERS.concat(MO_CLOSERS_DONE_GOOD));

        let message = `${pick(ongoing ? MO_GREETINGS_ONGOING : MO_GREETINGS)(firstName, month)} ${praiseText}`;
        if (consistencyText) message += `\n\n${consistencyText}`;
        if (focusText) message += `\n\n${focusText}`;
        message += `\n\n${pick(closers)}`;

        return polish(message);
    }

    // --- Growth message generation (WoW / MoM / QoQ / YTD) ---

    const GROWTH_COMPARISON_TYPES = ['wow', 'mom', 'qoq', 'ytd'];

    const GROWTH_LABELS = {
        wow: { short: 'WoW', long: 'week over week', currentNoun: 'this week', priorNoun: 'last week' },
        mom: { short: 'MoM', long: 'month over month', currentNoun: 'this month', priorNoun: 'last month' },
        qoq: { short: 'QoQ', long: 'quarter over quarter', currentNoun: 'this quarter', priorNoun: 'last quarter' },
        ytd: { short: 'YTD', long: 'year to date', currentNoun: 'this YTD snapshot', priorNoun: 'your prior YTD snapshot' }
    };

    // The rising-chart opener only goes on a message with something rising in
    // it. An all-decline message opened with 📈 (Scott, 2026-10-14).
    const GROWTH_GREETINGS = [
        (name, longLabel) => `Hey ${name}! 📈 Pulled your ${longLabel} growth. Wanted to share what stood out.`,
        (name, longLabel) => `${name}! Got your ${longLabel} numbers in front of me, here's how you're trending.`,
        (name, longLabel) => `Morning ${name}! Quick ${longLabel} growth check for you.`,
        (name, longLabel) => `${name}, taking a look at ${longLabel} for you. Here's the rundown.`,
        (name, longLabel) => `Hey ${name}! Wanted to share your ${longLabel} trajectory.`,
        (name, longLabel) => `${name}! Sat down with your ${longLabel} numbers, here's what I saw.`
    ];
    const GROWTH_GREETINGS_PLAIN = [
        (name, longLabel) => `${name}, taking a look at ${longLabel} for you. Here's the rundown.`,
        (name, longLabel) => `Hey ${name}! Sat down with your ${longLabel} numbers, here's what I saw.`,
        (name, longLabel) => `Morning ${name}! Quick ${longLabel} check-in for you.`
    ];

    // A sentence, not a heading: "Side by side:" and "Comparing X to Y:" led
    // into bullet lists that read like a dashboard (Scott, 2026-10-26).
    const GROWTH_RANGE_LINE = [
        (currentLabel, priorLabel) => `Here's ${currentLabel} next to ${priorLabel}.`,
        (currentLabel, priorLabel) => `I lined up ${currentLabel} with ${priorLabel}.`,
        (currentLabel, priorLabel) => `Here's how ${currentLabel} compares to ${priorLabel}.`
    ];
    // Said after the moves the right way, never after a slip.
    const GROWTH_MOVE_PRAISE = [
        `That's real progress.`,
        `Love seeing that.`,
        `Really nice work there.`
    ];
    const GROWTH_FOCUS = [
        (label, val, target) => `${label} is the one I'd love us to work on next. You're at ${val}, with ${withArticle(target)} goal.`,
        (label, val, target) => `If there's one thing to go after next, it's ${label}, at ${val} with the goal at ${target}.`,
        (label, val, target) => `Next up, let's work on ${label} together. You're at ${val}, and ${target} is the goal.`
    ];

    const GROWTH_NO_MOVE = [
        `Your numbers held pretty steady. No big swings either direction.`,
        `Things have been holding flat. Nothing major moved.`,
        `Numbers stayed mostly level. No big movement to call out.`
    ];

    const GROWTH_CLOSERS = [
        `Keep climbing! 🚀`,
        `Proud of the trajectory. Let's keep it going.`,
        `Great direction. Keep stacking the wins.`,
        `Solid effort showing up in the numbers.`,
        `Excited to see where you take it next.`
    ];

    // Used when nothing improved. "Keep climbing!" under a wall of red reads
    // like nobody actually looked at the numbers.
    const GROWTH_REGROUP_CLOSERS = [
        `One stretch doesn't define you. Let's pick one thing and go after it together.`,
        `Everybody has a period like this. Let's talk through what got in the way.`,
        `I'm not worried. Let's focus on one metric and build from there.`,
        `Let's regroup on this one. Pick the focus area above and we'll work it together.`
    ];

    // Nothing moved either way. "Keep climbing! 🚀" after "Nothing major
    // moved" was the complaint; steady gets its own words.
    const GROWTH_STEADY_CLOSERS = [
        `Steady is a good place to build from. Let's pick one thing to push on next.`,
        `Consistency counts. Let's find the one number to move next.`,
        `Holding steady is real work. Let me know if you want to pick a focus together.`
    ];

    const GROWTH_HOLDING_INTRO = [
        (held) => `You held ${held}, still on target.`,
        (held) => `${capFirst(held)} held strong, still on target.`,
        (held) => `And you kept ${held}, right where it needs to be.`
    ];

    function getGrowthComparisonContext(comparisonType) {
        if (comparisonType === 'wow') {
            const keys = getPeriodKeys('week');
            if (keys.length < 2) return null;
            const latestKey = keys[keys.length - 1];
            const baselineKey = keys[keys.length - 2];
            // "The week of" is the week's first day. It used to be the last.
            return {
                comparisonType,
                latestKey,
                baselineKey,
                currentLabel: `the week of ${getStartDateLabel(latestKey, getPeriodData(latestKey))}`,
                priorLabel: `the week of ${getStartDateLabel(baselineKey, getPeriodData(baselineKey))}`,
                periodForFmt: 'week',
                analysisPeriodType: 'week'
            };
        }
        if (comparisonType === 'mom') {
            const keys = getPeriodKeys('month');
            if (keys.length < 2) return null;
            const latestKey = keys[keys.length - 1];
            const baselineKey = keys[keys.length - 2];
            return {
                comparisonType,
                latestKey,
                baselineKey,
                currentLabel: monthWord(latestKey),
                priorLabel: monthWord(baselineKey),
                periodForFmt: 'month',
                analysisPeriodType: 'month'
            };
        }
        if (comparisonType === 'qoq') {
            const keys = getPeriodKeys('quarter');
            if (keys.length < 2) return null;
            const latestKey = keys[keys.length - 1];
            const baselineKey = keys[keys.length - 2];
            return {
                comparisonType,
                latestKey,
                baselineKey,
                currentLabel: getQuarterName(latestKey),
                priorLabel: getQuarterName(baselineKey),
                periodForFmt: 'quarter',
                analysisPeriodType: 'quarter'
            };
        }
        if (comparisonType === 'ytd') {
            const ytd = typeof ytdData !== 'undefined' ? ytdData : {};
            const sorted = Object.keys(ytd)
                .map(k => {
                    const endText = ytd[k]?.metadata?.endDate || (k.includes('|') ? k.split('|')[1] : '');
                    return { k, end: new Date(endText) };
                })
                .filter(x => !isNaN(x.end))
                .sort((a, b) => a.end - b.end)
                .map(x => x.k);
            if (sorted.length < 2) return null;
            const latestKey = sorted[sorted.length - 1];
            const baselineKey = sorted[sorted.length - 2];
            // "your year through Oct 13" against "your year through Sep 30".
            // "prior YTD snapshot (09/05/2026)" was report jargon.
            const through = (key) => {
                const end = ytd[key]?.metadata?.endDate || (key.includes('|') ? key.split('|')[1] : key);
                return `your year through ${shortDate(end)}`;
            };
            return {
                comparisonType,
                latestKey,
                baselineKey,
                currentLabel: through(latestKey),
                priorLabel: through(baselineKey),
                periodForFmt: 'week',
                analysisPeriodType: 'ytd'
            };
        }
        return null;
    }

    function getEmployeeFromAnyPeriod(periodKey, employeeName) {
        if (!periodKey) return null;
        const weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        const ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        const period = weekly[periodKey] || ytd[periodKey];
        return period?.employees?.find(e => e.name === employeeName) || null;
    }

    // The registry owns this now. It used to answer differently here than in
    // Highlights and meeting prep, so the same five second AHT move was an
    // improvement in one view and noise in another.
    function getGrowthNoiseThreshold(metricKey) {
        return typeof window.getMetricNoiseThreshold === 'function'
            ? window.getMetricNoiseThreshold(metricKey)
            : 1;
    }

    // A survey rate is only compared when both sides have enough surveys
    // behind them to be a rate rather than one customer.
    function surveysBehindBoth(metricKey, a, b) {
        if (!SURVEY_METRIC_KEYS.has(metricKey)) return true;
        return surveyResponsesFor(a, metricKey) >= MIN_SURVEYS_TO_PRAISE
            && surveyResponsesFor(b, metricKey) >= MIN_SURVEYS_TO_PRAISE;
    }

    function computeGrowthDeltas(latestEmp, baselineEmp) {
        const registry = typeof METRICS_REGISTRY !== 'undefined' ? METRICS_REGISTRY : {};
        const out = [];
        Object.keys(registry).filter(k => !PULSE_EXCLUDED_METRICS.includes(k)).forEach(metricKey => {
            const baseVal = parseFloat(baselineEmp[metricKey]);
            const latestVal = parseFloat(latestEmp[metricKey]);
            if (!Number.isFinite(baseVal) || !Number.isFinite(latestVal)) return;
            if (!surveysBehindBoth(metricKey, latestEmp, baselineEmp)) return;
            const delta = typeof metricDelta === 'function'
                ? metricDelta(metricKey, latestVal, baseVal)
                : latestVal - baseVal;
            if (Math.abs(delta) < getGrowthNoiseThreshold(metricKey)) return;
            out.push({
                metricKey,
                label: registry[metricKey]?.label || metricKey,
                baseValue: baseVal,
                latestValue: latestVal,
                delta,
                absDelta: Math.abs(delta)
            });
        });
        return out;
    }

    // Metrics that barely moved but are still sitting at or above target. When
    // nothing improved these are the only honest positive we have, and they are
    // a real one: holding target through a rough stretch is worth naming.
    function computeSteadyAtTarget(latestEmp, baselineEmp) {
        const registry = typeof METRICS_REGISTRY !== 'undefined' ? METRICS_REGISTRY : {};
        const meetsTarget = typeof metricMeetsTarget === 'function' ? metricMeetsTarget : null;
        if (!meetsTarget) return [];
        const out = [];
        Object.keys(registry).filter(k => !PULSE_EXCLUDED_METRICS.includes(k)).forEach(metricKey => {
            const baseVal = parseFloat(baselineEmp[metricKey]);
            const latestVal = parseFloat(latestEmp[metricKey]);
            if (!Number.isFinite(baseVal) || !Number.isFinite(latestVal)) return;
            if (!surveysBehindBoth(metricKey, latestEmp, baselineEmp)) return;
            const delta = typeof metricDelta === 'function'
                ? metricDelta(metricKey, latestVal, baseVal)
                : latestVal - baseVal;
            if (Math.abs(delta) >= getGrowthNoiseThreshold(metricKey)) return;
            if (!meetsTarget(metricKey, latestVal)) return;
            out.push({
                metricKey,
                label: registry[metricKey]?.label || metricKey,
                latestValue: latestVal
            });
        });
        return out;
    }

    // Through the same survey gate as every other focus: "Focus area: Rep
    // Satisfaction sitting at 0.0% vs target 82.0%" went to somebody nobody
    // had surveyed (Scott, 2026-10-14).
    function growthMetrics(latestEmp, analysisPeriodType, latestKey) {
        const analyzeFn = window.DevCoachModules?.metricTrends?.analyzeTrendMetrics
            || window.analyzeTrendMetrics;
        if (!analyzeFn) return [];
        const centerAvgs = centerAveragesFor(latestKey);
        const analysis = analyzeFn(latestEmp, centerAvgs, null, null, {
            employeeName: latestEmp.name,
            weekKey: latestKey,
            periodType: analysisPeriodType
        });
        return speakableMetrics(latestEmp, analysis);
    }

    // When nothing improved and nothing held at target, the growth note leads
    // with this instead (Scott, 2026-10-14: positive feedback in every
    // message). Thanks for the effort, in the period's tense.
    const GROWTH_EFFORT = [
        `I saw the effort you put in, and it matters.`,
        `Thank you for the work you put in. It doesn't go unnoticed.`
    ];
    const GROWTH_EFFORT_ONGOING = [
        `I see the effort you're putting in, and it matters.`,
        `Thank you for the work you're putting in. It doesn't go unnoticed.`
    ];

    async function generateGrowthMessage(employeeName, comparisonType) {
        const ctx = getGrowthComparisonContext(comparisonType);
        if (!ctx) return null;

        const latestEmp = getEmployeeFromAnyPeriod(ctx.latestKey, employeeName);
        const baselineEmp = getEmployeeFromAnyPeriod(ctx.baselineKey, employeeName);
        if (!latestEmp || !baselineEmp) return null;
        if (tookNoCalls(latestEmp)) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const labelInfo = GROWTH_LABELS[comparisonType];
        const deltas = computeGrowthDeltas(latestEmp, baselineEmp);
        const improvements = deltas.filter(d => d.delta > 0).sort((a, b) => jumpSize(b) - jumpSize(a)).slice(0, 3);
        // A slip on a number still on target is not listed: Hold Time going
        // from 5s to 11s against a 30s target is not a worry (Scott,
        // 2026-10-14). Without a target check to ask, every slip is listed.
        const meets = typeof metricMeetsTarget === 'function' ? metricMeetsTarget : null;
        const declines = deltas
            .filter(d => d.delta < 0 && !(meets && meets(d.metricKey, d.latestValue)))
            .sort((a, b) => jumpSize(a) - jumpSize(b)).slice(0, 2);

        // What they held at target, and the metrics the focus is picked from.
        const steady = improvements.length === 0 ? computeSteadyAtTarget(latestEmp, baselineEmp).slice(0, 3) : [];
        const metrics = growthMetrics(latestEmp, ctx.analysisPeriodType, ctx.latestKey);
        const focalPoint = pickFocalPoint(metrics);

        const greetings = improvements.length ? GROWTH_GREETINGS : GROWTH_GREETINGS_PLAIN;
        let message = `${pick(greetings)(firstName, labelInfo.long)}\n\n`;

        const ytdAll = typeof ytdData !== 'undefined' ? ytdData : {};
        const latestPeriod = getPeriodData(ctx.latestKey) || ytdAll[ctx.latestKey] || null;
        const ongoing = !!describeWeekRecency(ctx.latestKey, latestPeriod).ongoing;

        // Nothing grew and nothing held at target. Everything slipping used
        // to end on "Let's regroup" with no praise anywhere in it (Scott,
        // 2026-10-14), so the best true thing comes first, kudos before the
        // slips: on target, better than the center, closest to goal, and the
        // effort when the numbers have none of those.
        if (improvements.length === 0 && steady.length === 0) {
            const brightSpot = truePositiveLine(truePositiveFor(latestEmp, metrics, focalPoint?.metricKey, ongoing, declines.map(d => d.metricKey)), ongoing)
                || pick(ongoing ? GROWTH_EFFORT_ONGOING : GROWTH_EFFORT);
            message += `${brightSpot}\n\n`;
        }

        // Each move in words, with the two numbers it went between, said as
        // sentences: "Average Handle Time went down 40 seconds, from 480 to
        // 440." The "Growing:" and "Slipped a bit:" bullet lists read like a
        // dashboard (Scott, 2026-10-26). Two moves to a sentence at most.
        const range = d => fmtRange(d.metricKey, d.baseValue, d.latestValue);
        const grew = d => `${d.label} ${ongoing ? 'is' : 'went'} ${fmtDelta(d.metricKey, d.delta)}, from ${range(d)}`;
        const grewToo = d => `${d.label} ${ongoing ? 'is' : 'went'} ${fmtDelta(d.metricKey, d.delta)} too, from ${range(d)}`;
        const slipped = d => `${d.label} ${ongoing ? 'has slipped' : 'slipped'} ${fmtAmount(d.metricKey, d.delta)}, from ${range(d)}`;
        const two = parts => parts.join(', and ');

        let story = pick(GROWTH_RANGE_LINE)(ctx.currentLabel, ctx.priorLabel);
        if (improvements.length === 0 && declines.length === 0) {
            story += ` ${pick(GROWTH_NO_MOVE)}`;
        } else {
            if (improvements.length) {
                story += ` ${two(improvements.slice(0, 2).map(grew))}.`;
                if (improvements[2]) story += ` ${grewToo(improvements[2])}.`;
                story += ` ${pick(GROWTH_MOVE_PRAISE)}`;
            }
            if (declines.length) story += ` ${two(declines.map(slipped))}.`;
        }
        message += story;

        // Nothing improved. Don't send an all-red message with no positive in
        // it: say what they held at target so the note is honest but fair.
        if (steady.length) {
            const held = joinWinPhrases(steady.map(s => ({ label: s.label, metricKey: s.metricKey, employeeValue: s.latestValue })));
            message += `\n\n${pick(GROWTH_HOLDING_INTRO)(held)}`;
        }

        if (focalPoint) {
            // A metric the note just praised for moving gets its next stop,
            // never a second ask as though it had not moved.
            const moved = improvements.some(d => d.metricKey === focalPoint.metricKey);
            message += `\n\n${pick(moved ? FOCUS_IMPROVING : GROWTH_FOCUS)(focalPoint.label, fmtVal(focalPoint), fmtTarget(focalPoint))}`;
            const tip = await tipFor(employeeName, focalPoint.metricKey, 'medium');
            if (tip) message += ` ${tip}`;
        }

        // Only swap to the regroup tone when things actually went backwards.
        // A flat period is not a "let's regroup" conversation, and it is not a
        // "keep climbing" one either.
        const wentBackwards = improvements.length === 0 && declines.length > 0;
        const flat = improvements.length === 0 && declines.length === 0;
        const closers = wentBackwards ? GROWTH_REGROUP_CLOSERS : (flat ? GROWTH_STEADY_CLOSERS : GROWTH_CLOSERS);
        message += `\n\n${pick(closers)}`;
        return polish(message);
    }

    function getAvailableGrowthComparisons() {
        return GROWTH_COMPARISON_TYPES.filter(type => getGrowthComparisonContext(type) !== null);
    }

    async function showGrowthModal(employeeName, defaultComparison) {
        const existing = document.getElementById('pulseGrowthModal');
        if (existing) existing.remove();

        const available = getAvailableGrowthComparisons();
        if (!available.length) {
            if (typeof showToast === 'function') showToast('Need at least two periods of data to compare growth.', 3000);
            return;
        }
        const initial = available.includes(defaultComparison) ? defaultComparison : available[0];

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];
        const escapeHtml = window.DevCoachModules?.sharedUtils?.escapeHtml || ((s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

        const overlay = document.createElement('div');
        overlay.id = 'pulseGrowthModal';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';

        const periodBtns = GROWTH_COMPARISON_TYPES.map(type => {
            const enabled = available.includes(type);
            const isActive = type === initial;
            // The row is a sub-nav: the chosen period is its raised pill.
            const on = isActive && enabled;
            const classes = 'growth-period-btn' + (on ? ' is-active' : '') + (enabled ? '' : ' text-faint');
            const attrs = (enabled ? '' : ' disabled style="cursor:not-allowed;"') + (on ? ' aria-selected="true"' : '');
            return `<button type="button" class="${classes}" data-comparison="${type}"${attrs}>${GROWTH_LABELS[type].short}</button>`;
        }).join('');

        overlay.innerHTML = `<div style="background:var(--bg-surface); border:1px solid var(--border); border-radius:12px; max-width:600px; width:100%; max-height:85vh; overflow-y:auto; padding:24px; box-shadow:var(--shadow-lg);">` +
            `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">` +
                `<h3 style="margin:0;">Growth check for ${escapeHtml(firstName)}</h3>` +
                `<button id="pulseGrowthClose" class="btn-ghost" aria-label="Close" style="font-size:1.4em; padding:4px 8px;">✕</button>` +
            `</div>` +
            `<div style="font-size:0.85em; color:var(--text-secondary); margin-bottom:8px;">Pick a comparison period:</div>` +
            `<div id="pulseGrowthPeriods" class="sub-nav" style="margin-bottom:14px;">${periodBtns}</div>` +
            `<textarea id="pulseGrowthText" style="width:100%; height:240px; padding:14px; border:1px solid var(--border); border-radius:6px; font-size:0.95em; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">⏳ Generating…</textarea>` +
            `<div style="display:flex; gap:10px; margin-top:14px;">` +
                `<button id="pulseGrowthCopy" class="btn-primary" style="flex:1; padding:10px 16px;">Copy to Clipboard</button>` +
                `<button id="pulseGrowthRegenerate" class="btn-secondary" style="flex:1; padding:10px 16px;">Regenerate</button>` +
            `</div>` +
        `</div>`;

        document.body.appendChild(overlay);

        let currentComparison = initial;
        const textarea = overlay.querySelector('#pulseGrowthText');

        async function regenerate(autoCopy) {
            textarea.value = '⏳ Generating…';
            try {
                const msg = await generateGrowthMessage(employeeName, currentComparison);
                if (msg) {
                    textarea.value = msg;
                    if (autoCopy) {
                        await copyToClipboard(msg, { message: 'Growth message copied!' });
                    }
                } else {
                    textarea.value = 'Not enough data for that comparison yet.';
                }
            } catch (e) {
                textarea.value = 'Could not build a growth message. Check console for details.';
                console.error('growth message error', e);
            }
        }

        function updatePeriodHighlight() {
            overlay.querySelectorAll('.growth-period-btn').forEach(btn => {
                if (btn.disabled) return;
                const isActive = btn.dataset.comparison === currentComparison;
                btn.classList.toggle('is-active', isActive);
                if (isActive) btn.setAttribute('aria-selected', 'true');
                else btn.removeAttribute('aria-selected');
            });
        }

        overlay.querySelectorAll('.growth-period-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.disabled) return;
                currentComparison = btn.dataset.comparison;
                updatePeriodHighlight();
                regenerate(false);
            });
        });

        overlay.querySelector('#pulseGrowthClose').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        overlay.querySelector('#pulseGrowthCopy').addEventListener('click', async () => {
            await copyToClipboard(textarea.value, { message: 'Copied!' });
        });

        overlay.querySelector('#pulseGrowthRegenerate').addEventListener('click', () => regenerate(true));

        regenerate(true);
    }

    // --- Summary bar ---

    // Per-rep daily check-in block: yesterday's six operational metrics and
    // the week-to-date weighted rollup, computed from dailyData rows between
    // this past Monday and today. Returns '' when there's no daily data
    // for the current week (so Weekly Pulse hides the whole section).
    //
    // Metrics are scoped to what's meaningful at single-day granularity:
    // volume, AHT, adherence, and the three sentiment scores. Survey-based
    // metrics (RepSat/FCR/OE) are intentionally left out. They need days
    // of surveys to stabilize.
    const DAILY_CHECKIN_METRICS = [
        { key: 'totalCalls',        label: 'Volume',     reverse: false, weight: null },
        { key: 'aht',               label: 'AHT',        reverse: true,  weight: 'totalCalls' },
        { key: 'scheduleAdherence', label: 'Adherence',  reverse: false, weight: 'totalCalls' },
        { key: 'positiveWord',      label: '+Word',      reverse: false, weight: 'totalCalls' },
        { key: 'negativeWord',      label: 'Avoid Neg',  reverse: false, weight: 'totalCalls' },
        { key: 'managingEmotions',  label: 'Emotions',   reverse: false, weight: 'totalCalls' }
    ];

    /* The daily numbers as a message says them. The table above keeps its
     * short column labels; a message to an associate read "Volume 88, AHT
     * 471s, +Word 84.8%, Avoid Neg 83.6%, Emotions 95.3%" (Scott,
     * 2026-10-14). Three numbers in plain words is the recap: calls, handle
     * time and adherence, the ones a day can actually move.
     */
    const DAILY_RECAP_METRICS = [
        { key: 'totalCalls', label: 'Calls', say: v => `${v} calls` },
        { key: 'aht', label: 'Handle time', say: v => `handle time ${v}` },
        { key: 'scheduleAdherence', label: 'Adherence', say: v => `adherence ${v}` }
    ];

    function formatDailyCell(metricKey, value) {
        if (value === null || value === undefined || Number.isNaN(value)) return '<span class="text-faint">-</span>';
        if (metricKey === 'totalCalls') return Math.round(value).toString();
        return fmtVal(metricKey, value);
    }

    // Per-rep weighted rollup across a list of daily rows. Returns an object
    // keyed by metric with the weighted mean (or simple sum for totalCalls).
    function computeRepWtdFromDailies(dailyRows) {
        const out = {};
        DAILY_CHECKIN_METRICS.forEach(m => { out[m.key] = null; });
        if (!dailyRows.length) return out;

        DAILY_CHECKIN_METRICS.forEach(m => {
            if (m.key === 'totalCalls') {
                let sum = 0, found = false;
                dailyRows.forEach(r => {
                    const v = parseFloat(r[m.key]);
                    if (Number.isFinite(v)) { sum += v; found = true; }
                });
                out[m.key] = found ? sum : null;
                return;
            }
            let weighted = 0, totalWeight = 0;
            dailyRows.forEach(r => {
                const v = parseFloat(r[m.key]);
                if (!Number.isFinite(v)) return;
                let w = 1;
                if (m.weight) {
                    const wv = parseInt(r[m.weight], 10);
                    w = Number.isInteger(wv) && wv > 0 ? wv : 0;
                }
                if (w <= 0) return;
                weighted += v * w;
                totalWeight += w;
            });
            out[m.key] = totalWeight > 0 ? weighted / totalWeight : null;
        });
        return out;
    }

    function buildDailyCheckinSection() {
        const daily = typeof dailyData !== 'undefined' ? dailyData : {};
        const { yesterdayIso, dailyKeysThisWeek } = getThisWeekDailyWindow();
        if (!dailyKeysThisWeek.length) return '';

        // Build per-rep map: name -> { yesterday: emp|null, weekRows: emp[] }.
        const repMap = new Map();
        dailyKeysThisWeek.forEach(k => {
            const end = daily[k]?.metadata?.endDate || (k.includes('|') ? k.split('|')[1] : '');
            (daily[k]?.employees || []).forEach(emp => {
                if (!emp?.name) return;
                if (!repMap.has(emp.name)) repMap.set(emp.name, { yesterday: null, weekRows: [] });
                const entry = repMap.get(emp.name);
                entry.weekRows.push(emp);
                if (end === yesterdayIso) entry.yesterday = emp;
            });
        });

        // Filter by current team selection.
        const ctx = typeof getTeamSelectionContext === 'function' ? getTeamSelectionContext() : null;
        const reps = Array.from(repMap.keys())
            .filter(name => typeof isAssociateIncludedByTeamFilter === 'function'
                ? isAssociateIncludedByTeamFilter(name, ctx)
                : true)
            .sort((a, b) => a.localeCompare(b));
        if (!reps.length) return '';

        // Build the section header.
        // Built from its parts: new Date('YYYY-MM-DD') is UTC midnight, which is
        // the previous evening in Phoenix, so Monday's data was headed "Sun".
        const [yY, yM, yD] = String(yesterdayIso).split('-').map(Number);
        const yesterdayLabel = new Date(yY, yM - 1, yD).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        const uploadedCount = dailyKeysThisWeek.length;
        const header = `<div style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap;">` +
            `<div>` +
                `<h4 style="margin:0; font-size:1.05em;">Daily Check-in</h4>` +
                `<div style="font-size:0.85em; color:var(--text-secondary); margin-top:2px;">Yesterday (${yesterdayLabel}) + week-to-date weighted rollup · ${uploadedCount} day${uploadedCount === 1 ? '' : 's'} uploaded this week · ${reps.length} rep${reps.length === 1 ? '' : 's'}</div>` +
            `</div>` +
        `</div>`;

        // Build the metric-column header row.
        const metricHeaders = DAILY_CHECKIN_METRICS.map(m =>
            `<th colspan="2" style="padding:6px 8px; font-size:0.78em; color:var(--text-secondary); text-align:center; border-bottom:1px solid var(--border);">${m.label}</th>`
        ).join('');
        const subHeaders = DAILY_CHECKIN_METRICS.map(() =>
            `<th style="padding:4px 8px; font-size:0.72em; color:var(--text-tertiary); font-weight:500; text-align:right; border-bottom:1px solid var(--border);">yest</th>` +
            `<th style="padding:4px 8px; font-size:0.72em; color:var(--text-tertiary); font-weight:500; text-align:right; border-bottom:1px solid var(--border);">WTD</th>`
        ).join('');

        // Build per-rep rows.
        const rows = reps.map(name => {
            const entry = repMap.get(name);
            const wtd = computeRepWtdFromDailies(entry.weekRows);
            const yest = entry.yesterday || {};
            const cells = DAILY_CHECKIN_METRICS.map(m => {
                const yVal = parseFloat(yest[m.key]);
                const wVal = wtd[m.key];
                const yCell = formatDailyCell(m.key, Number.isFinite(yVal) ? yVal : null);
                const wCell = formatDailyCell(m.key, wVal);
                return `<td style="padding:6px 8px; text-align:right; font-size:0.88em;">${yCell}</td>` +
                       `<td style="padding:6px 8px; text-align:right; font-size:0.88em; font-weight:600; color:var(--text-primary);">${wCell}</td>`;
            }).join('');
            const safeName = typeof escapeHtml === 'function' ? escapeHtml(name) : name;
            return `<tr><td style="padding:6px 10px; font-weight:600; border-bottom:1px solid var(--border); white-space:nowrap;">${safeName}</td>${cells}</tr>`;
        }).join('');

        return `<div class="card" style="margin-bottom:20px; padding:14px 16px;">` +
            header +
            `<div style="overflow-x:auto;">` +
                `<table style="width:100%; border-collapse:collapse; min-width:640px;">` +
                    `<thead>` +
                        `<tr><th style="padding:6px 10px;"></th>${metricHeaders}</tr>` +
                        `<tr><th></th>${subHeaders}</tr>` +
                    `</thead>` +
                    `<tbody>${rows}</tbody>` +
                `</table>` +
            `</div>` +
        `</div>`;
    }

    function buildSummaryBar(cardData, comparison) {
        const counts = { red: 0, yellow: 0, green: 0, blue: 0, gray: 0 };
        cardData.forEach(d => {
            // The card's own metrics. Counting off the full list here while
            // the card counted the speakable ones let the bar and the cards
            // disagree about the same person.
            const badge = getStatusBadge(speakableMetrics(d.emp, d.analysis));
            if (badge.icon.includes('🔴')) counts.red++;
            else if (badge.icon.includes('🟡')) counts.yellow++;
            else if (badge.icon.includes('🟢')) counts.green++;
            else if (badge.icon.includes('🔵')) counts.blue++;
            else counts.gray++;
        });

        const escapeHtml = window.DevCoachModules?.sharedUtils?.escapeHtml || ((v) => String(v));
        const compareNote = comparison?.baselineKey
            ? `<span class="text-primary" style="font-weight:600;">Moves are against ${escapeHtml(comparison.baselineLabel || 'the period before')}</span>`
            : '<span style="color:var(--text-tertiary);">Nothing to compare against yet</span>';

        // Theme colours: the fixed light grey this used to sit on was a pale
        // slab in the middle of the dark theme.
        return `<div style="display:flex; gap:16px; flex-wrap:wrap; padding:12px 16px; background:var(--bg-surface-raised); border:1px solid var(--border); border-radius:8px; margin-bottom:12px; align-items:center;">` +
            `<div style="display:flex; gap:12px; flex-wrap:wrap; font-size:0.9em;">` +
                (counts.green > 0 ? `<span class="tone-good" style="font-weight:600;">🟢 ${counts.green} Crushing It</span>` : '') +
                (counts.blue > 0 ? `<span class="tone-info" style="font-weight:600;">🔵 ${counts.blue} Doing Good</span>` : '') +
                (counts.yellow > 0 ? `<span class="tone-warn" style="font-weight:600;">🟡 ${counts.yellow} Watch</span>` : '') +
                (counts.red > 0 ? `<span class="tone-bad" style="font-weight:600;">🔴 ${counts.red} Needs Support</span>` : '') +
                (counts.gray > 0 ? `<span class="text-faint" style="font-weight:600;">⚪ ${counts.gray} Steady</span>` : '') +
            `</div>` +
            `<div style="margin-left:auto; font-size:0.85em; color:var(--text-secondary);">${cardData.length} associates • ${compareNote}</div>` +
        `</div>`;
    }

    /**
     * One line for one person, opening to their full card.
     *
     * Eighteen full cards ran to about 3,300px, which buried everything else
     * on the day page. The line carries what a scan needs: the badge, how much
     * of the scorecard is on target, and the one thing to look at. The card is
     * still there behind it. The button sits in the line so it is not repeated
     * inside the card.
     */
    function buildPulseRow(d, cardOptions, actionHtml) {
        const escapeHtml = window.DevCoachModules?.sharedUtils?.escapeHtml || ((s) => String(s));
        const metrics = speakableMetrics(d.emp, d.analysis);
        const badge = getStatusBadge(metrics);
        const focal = pickFocalPoint(metrics);
        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(d.emp.name)
            : d.emp.name.split(/[\s,]+/)[0];

        const tally = badge.measured >= 2
            ? `${badge.met} of ${badge.measured} scorecard on target or ahead of the center`
            : 'Too little scored to judge';
        const focus = focal
            ? `Focus: ${escapeHtml(focal.label)} ${fmtVal(focal)} vs ${fmtTarget(focal)}`
            : 'Nothing below target';

        return `<details class="pulse-row" data-employee="${escapeHtml(d.emp.name)}" style="border-bottom:1px solid var(--border);">` +
            `<summary style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:8px 4px; cursor:pointer;">` +
                `<span style="font-weight:700; color:var(--text-primary); min-width:96px;">${escapeHtml(firstName)}</span>` +
                `<span class="${badge.pill}" style="font-size:0.78em; padding:2px 9px;">${badge.icon} ${badge.label}</span>` +
                `<span style="font-size:0.84em; color:var(--text-secondary);">${tally}</span>` +
                `<span style="font-size:0.84em; color:var(--text-tertiary); flex:1; min-width:180px;">${focus}</span>` +
                (actionHtml || '') +
            `</summary>` +
            `<div style="padding:4px 0 12px;">${buildEmployeeCard(d.emp, d.analysis, d.weekDeltas, d.biggestJump, cardOptions)}</div>` +
        `</details>`;
    }

    /**
     * The status cards, over the window My Team is showing.
     *
     * This was the Weekly Pulse tab, which kept its own Week/Month/Quarter
     * picker and its own idea of "the week before" (the earliest upload in the
     * seven days prior), so it could describe a different fortnight from the
     * page that linked to it. The cards read the page's comparison now, and
     * carry one action instead of six message buttons: the messages live in
     * the tone row above, where the window already applies to them.
     *
     * options.person narrows it to one card. options.actionFor(name) supplies
     * that card's button. options.compact draws a line per person instead,
     * each opening to the card.
     */
    function buildTeamPulseHtml(comparison, options = {}) {
        const latestKey = comparison?.latestKey;
        if (!latestKey) return '';
        const period = getPeriodData(latestKey);
        if (!period) return '';

        const baselineKey = comparison.baselineKey || null;
        const only = options.person || null;
        const employees = getFilteredEmployees(period).filter(emp => !only || emp.name === only);
        if (!employees.length) return '';

        const centerAvgs = centerAveragesFor(latestKey);
        const cardData = [];
        employees.forEach(emp => {
            const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
            if (!analysis || !analysis.allMetrics?.length) return;
            const weekDeltas = baselineKey ? calcWeekDeltas(emp.name, baselineKey, latestKey) : [];
            cardData.push({ emp, analysis, weekDeltas, biggestJump: getBiggestJump(weekDeltas) });
        });
        if (!cardData.length) return '';

        // Alphabetical, the same as every picker.
        cardData.sort((a, b) => a.emp.name.localeCompare(b.emp.name));

        const when = comparison.latestLabel || 'this period';
        const rangeLabels = baselineKey && comparison.baselineLabel
            ? { when, prior: comparison.baselineLabel }
            : null;
        const cardOptions = {
            periodType: comparison.unit === 'month' ? 'month' : 'week',
            deltaContextLabel: when,
            whenLabel: when,
            rangeLabels
        };
        const actionFor = (name) => (typeof options.actionFor === 'function' ? options.actionFor(name) : '');

        // options.compact: a line each, opening to the card (the whole-team view).
        if (options.compact && !only) {
            return buildSummaryBar(cardData, comparison) +
                `<div>${cardData.map(d => buildPulseRow(d, cardOptions, actionFor(d.emp.name))).join('')}</div>`;
        }

        const cards = cardData.map(d => buildEmployeeCard(d.emp, d.analysis, d.weekDeltas, d.biggestJump, {
            ...cardOptions,
            actionHtml: actionFor(d.emp.name)
        })).join('');

        return (only ? '' : buildSummaryBar(cardData, comparison)) +
            `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:14px;">${cards}</div>`;
    }

    // --- Modal ---

    function formatDailyPlain(metricKey, value) {
        if (!Number.isFinite(value)) return '';
        if (metricKey === 'totalCalls') return Math.round(value).toString();
        return fmtVal(metricKey, value);
    }

    // Per-associate daily rows for the current Monday..today window, keyed by
    // name. Built once per sweep rather than once per rep.
    function collectDailyRowsThisWeek() {
        const daily = typeof dailyData !== 'undefined' ? dailyData : {};
        const { mondayIso, dailyKeysThisWeek } = getThisWeekDailyWindow();
        const byName = new Map();

        dailyKeysThisWeek.forEach(key => {
            const end = daily[key]?.metadata?.endDate || (key.includes('|') ? key.split('|')[1] : '');
            (daily[key]?.employees || []).forEach(emp => {
                if (!emp?.name) return;
                if (!byName.has(emp.name)) byName.set(emp.name, { rows: [], mondayRow: null, dates: new Set() });
                const entry = byName.get(emp.name);
                entry.rows.push(emp);
                if (end) entry.dates.add(end);
                if (end && end === mondayIso) entry.mondayRow = emp;
            });
        });

        return { byName, mondayIso, dayCount: dailyKeysThisWeek.length };
    }

    // The base message for the day, plus. When the plan calls for it. The
    // daily numbers slotted in after the opening.
    function latestKeyCoversThisWeek(outreach, latestKey) {
        // Asked once per message now, including on the paths that never look at
        // the answer, so a caller that hands over a bare outreach object gets a
        // plain false rather than a throw.
        if (typeof outreach?.mondayOf !== 'function' || !latestKey) return false;
        const period = getPeriodData(latestKey);
        const end = period?.metadata?.endDate || (latestKey.indexOf('|') > -1 ? latestKey.split('|')[1] : latestKey);
        return Boolean(end) && String(end).slice(0, 10) >= outreach.mondayOf(new Date());
    }

    /**
     * The day count that belongs on this week's standings.
     *
     * It comes from the weekly file's own range rather than from how many
     * dailies are still sitting in the working set, because that file is where
     * the standings numbers came from. The two used to disagree by exactly the
     * days the file had already absorbed: uploading Monday through Thursday as
     * one week-in-progress archives those dailies, and the message then said
     * "2 days in" about four days of work.
     */
    function daysOfThisWeekInPeriod(outreach, latestKey) {
        if (!outreach?.daysCoveredThisWeek || !latestKey) return 0;
        const period = getPeriodData(latestKey);
        const meta = period?.metadata || {};
        const parts = latestKey.indexOf('|') > -1 ? latestKey.split('|') : [];
        return outreach.daysCoveredThisWeek({
            startDate: meta.startDate || parts[0] || '',
            endDate: meta.endDate || parts[1] || '',
            todayIso: outreach.isoDate(new Date())
        });
    }

    /**
     * The placing that just missed the bar, for one person.
     *
     * Private messages only. The rule against putting near misses anywhere
     * public still holds: under a list of winners, "3 away from top 10" reads
     * as naming somebody for not making it. Addressed to one person it reads as
     * what it is, which is how close they are.
     */
    function nearMissLine(employeeName, latestKey) {
        const cel = window.DevCoachModules?.celebrations;
        if (!cel?.nearMissFor || !cel?.describeNearMiss) return '';
        try {
            return cel.describeNearMiss(cel.nearMissFor(employeeName, latestKey)) || '';
        } catch (e) {
            return '';
        }
    }

    /* The near-miss line, unless the standings block already spoke for that
     * metric.
     *
     * Both tails name a placing and both are welcome in a one-to-one, but they
     * count different fields. The standings block ranks over the people scored
     * on that metric, so it says "10th of 30". The near-miss line comes from
     * celebrations, which ranks over its own display ranks for the period, so
     * it says "#12 in the Call Center". Neither is wrong and they are answers
     * to slightly different questions, but arriving two paragraphs apart in one
     * message about one metric they read as the app contradicting itself, and
     * the reader has no way to tell which number to believe.
     *
     * So the block wins where they overlap, because it is the one that also
     * says what to do about it, and the near-miss line is kept for the metrics
     * the block did not reach: it caps at three, and "you are two spots off the
     * top ten" on a fourth metric is still worth sending.
     */
    function withNearMiss(message, employeeName, latestKey, spokenFor) {
        if (!message) return message;
        const cel = window.DevCoachModules?.celebrations;
        const already = spokenFor instanceof Set ? spokenFor : null;
        if (already && already.size && cel?.nearMissFor) {
            try {
                const miss = cel.nearMissFor(employeeName, latestKey);
                // METRIC_RANK_LABELS keys are center-ranking's rank keys, which
                // is what the block records, so the two can be compared without
                // a translation table in between.
                if (miss && already.has(miss.metricKey)) return message;
            } catch (e) { /* fall through and let the line be written */ }
        }
        // Above the sign-off, and never opening "One more thing:". The team
        // note below it opens that way too, and two of them in one message
        // read as a message that kept forgetting things (Scott, 2026-10-14).
        const line = nearMissLine(employeeName, latestKey).replace(/^One more thing:\s*/, 'Worth knowing: ');
        return line ? beforeSignOff(message, line) : message;
    }

    /* The team note: one paragraph written once and carried on the private
     * messages until it is cleared.
     *
     * Some asks are not about one person's week. Service level at risk for the
     * year is a whole-center problem, and the two levers an associate holds on
     * it are being on the phones when scheduled and not keeping a caller longer
     * than the call needs. Pasted into eighteen cards by hand every round, that
     * paragraph stops getting sent, so it is stored once and added by
     * buildOutreachMessage, the door both private surfaces already go through.
     *
     * 'missing' adds it only for whoever is missing Schedule Adherence or AHT in
     * the window being read, judged by the same analysis the card's badge
     * reads, so it never lands on someone whose card says both are fine.
     */
    const TEAM_NOTE_STORAGE_KEY = (window.DevCoachConstants?.STORAGE_PREFIX || 'devCoachingTool_') + 'teamNote';
    const TEAM_NOTE_METRICS = ['scheduleAdherence', 'aht'];

    /* No note goes out until one is written and saved.
     *
     * There was a built-in service level note here (93% at risk for 2026,
     * bonus could be under half), on by default for October to December.
     * Scott, 2026-10-21, reading the private round: "it looks like it's doom
     * and gloom. So maybe just get rid of that whole thing." It is gone, and
     * the editor stays for a note he chooses to write.
     */
    function loadTeamNote() {
        try {
            const raw = localStorage.getItem(TEAM_NOTE_STORAGE_KEY);
            if (raw === null || raw === undefined) return { text: '', who: 'missing' };
            const parsed = JSON.parse(raw);
            return {
                text: String(parsed?.text || '').trim(),
                who: parsed?.who === 'everyone' ? 'everyone' : 'missing'
            };
        } catch (e) {
            return { text: '', who: 'missing' };
        }
    }

    // Written even when cleared, rather than removed, so the cleared note is
    // what syncs and a restore cannot bring the old paragraph back.
    function saveTeamNote(note) {
        const clean = {
            text: String(note?.text || '').trim(),
            who: note?.who === 'everyone' ? 'everyone' : 'missing',
            updatedAt: new Date().toISOString()
        };
        try {
            localStorage.setItem(TEAM_NOTE_STORAGE_KEY, JSON.stringify(clean));
        } catch (e) { /* storage full or blocked; the messages still write without it */ }
        return { text: clean.text, who: clean.who };
    }

    // A failure in here leaves the note off rather than costing the message.
    function teamNoteMisses(employeeName, latestKey) {
        try {
            const emp = getPeriodData(latestKey)?.employees?.find(e => e?.name === employeeName);
            if (!emp) return [];
            const analysis = analyzeCurrentSnapshot(emp, centerAveragesFor(latestKey), latestKey);
            return speakableMetrics(emp, analysis)
                .filter(m => TEAM_NOTE_METRICS.includes(m.metricKey) && m.meetsTarget === false)
                .map(m => m.metricKey);
        } catch (e) {
            return [];
        }
    }

    // The paragraph this person's message carries, or '' when it carries none.
    function teamNoteFor(employeeName, latestKey, note) {
        const current = note || loadTeamNote();
        if (!current.text) return '';
        if (current.who === 'everyone') return current.text;
        return teamNoteMisses(employeeName, latestKey).length ? current.text : '';
    }

    // Just above the sign-off, so the message still ends on the sign-off
    // (Scott, 2026-10-14). The note's words and who gets it are unchanged.
    function withTeamNote(message, employeeName, latestKey) {
        if (!message) return message;
        const note = teamNoteFor(employeeName, latestKey);
        return note ? beforeSignOff(message, note) : message;
    }

    /* Moves a message that is already on screen from one note to the next
     * without writing the rest of it again, so a fresh draw of phrases and any
     * edit made in the box both survive a change to the note. The note sits
     * above the sign-off now, so it is found where it is rather than at the
     * end. A message whose note was edited by hand no longer contains it and
     * is left exactly as it is, because adding the new note beside the edited
     * one sends both.
     */
    function swapTeamNote(message, oldNote, newNote) {
        const original = String(message || '');
        const text = original.replace(/\s+$/, '');
        const oldText = String(oldNote || '').trim();
        const newText = String(newNote || '').trim();
        if (!text) return original;
        if (oldText) {
            const at = text.lastIndexOf(oldText);
            if (at === -1) return original;
            const before = text.slice(0, at).replace(/\s+$/, '');
            const after = text.slice(at + oldText.length).replace(/^\s+/, '');
            return [before, newText, after].filter(Boolean).join('\n\n');
        }
        return newText ? beforeSignOff(text, newText) : text;
    }

    const TEAM_NOTE_PLACEHOLDER = 'Something for the whole team, added to each private message until you clear it.';

    function teamNoteEditorHtml(idPrefix) {
        const note = loadTeamNote();
        const esc = window.DevCoachModules?.sharedUtils?.escapeHtml || ((s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
        return `<details id="${idPrefix}TeamNote" style="border:1px solid var(--border); border-radius:10px; padding:10px 14px; background:var(--bg-surface);">` +
            `<summary style="cursor:pointer; font-weight:600; color:var(--text-primary);">Team note <span id="${idPrefix}TeamNoteStatus" style="font-weight:400; color:var(--text-secondary);"></span></summary>` +
            `<div style="margin-top:8px; font-size:0.85em; color:var(--text-secondary);">Written once and added to the end of the private messages until you clear it.</div>` +
            `<textarea id="${idPrefix}TeamNoteText" placeholder="${esc(TEAM_NOTE_PLACEHOLDER)}" style="width:100%; min-height:110px; margin-top:8px; padding:10px; border:1px solid var(--border); border-radius:6px; font-size:0.9em; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">${esc(note.text)}</textarea>` +
            `<div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:8px; font-size:0.88em;">` +
                `<label for="${idPrefix}TeamNoteWho" style="color:var(--text-secondary);">Add it for</label>` +
                `<select id="${idPrefix}TeamNoteWho" style="padding:6px 8px; border:1px solid var(--border); border-radius:6px; background:var(--bg-surface-raised); color:var(--text-primary);">` +
                    `<option value="missing"${note.who === 'missing' ? ' selected' : ''}>anyone missing Schedule Adherence or AHT</option>` +
                    `<option value="everyone"${note.who === 'everyone' ? ' selected' : ''}>everyone</option>` +
                `</select>` +
                `<button type="button" id="${idPrefix}TeamNoteSave" class="btn-secondary" style="padding:7px 14px;">Save note</button>` +
                `<button type="button" id="${idPrefix}TeamNoteClear" class="btn-ghost" style="padding:7px 14px;">Clear</button>` +
            `</div>` +
        `</details>`;
    }

    // onSaved(note) runs after every save or clear, so the surface can move
    // the messages it is showing onto the new note.
    function wireTeamNoteEditor(idPrefix, onSaved) {
        const el = (id) => document.getElementById(idPrefix + id);
        const save = (text) => {
            const next = saveTeamNote({ text, who: el('TeamNoteWho')?.value });
            if (typeof onSaved === 'function') onSaved(next);
            if (typeof showToast === 'function') showToast(next.text ? 'Team note saved' : 'Team note cleared', 2500);
        };
        el('TeamNoteSave')?.addEventListener('click', () => save(el('TeamNoteText')?.value || ''));
        el('TeamNoteClear')?.addEventListener('click', () => {
            const box = el('TeamNoteText');
            if (box) box.value = '';
            save('');
        });
    }

    function setTeamNoteStatus(idPrefix, text) {
        const status = document.getElementById(idPrefix + 'TeamNoteStatus');
        if (status) status.textContent = text ? `(${text})` : '';
    }

    /**
     * What the kickoff calls the window's two sides, or null to keep its own
     * openers. The names come off the labels the page header already shows
     * ("October 2026 so far against September 2026"), less the year, which a
     * message to one person does not need.
     */
    function windowFrame(comparison) {
        if (!comparison?.latestKey) return null;
        const id = comparison.windowId;
        // A label with no letters in it is a raw "2026-10", which nobody says.
        const bare = s => {
            const name = String(s || '').replace(/\s+so far$/i, '').replace(/\s+\d{4}$/, '').trim();
            return /[a-z]/i.test(name) ? name : '';
        };
        const hasBaseline = !!comparison.baselineKey;

        if (id === 'mtd' || id === 'lastMonth') {
            const month = bare(comparison.latestLabel);
            if (!month) return null;
            const prior = hasBaseline ? bare(comparison.baselineLabel) : '';
            return {
                now: `your ${month}`,
                prior,
                better: `Better than ${prior}`,
                behind: `Behind ${prior}`,
                steady: `Right in line with ${prior}, nothing moved much.`
            };
        }
        if (id === 'ytd') {
            const through = hasBaseline
                ? String(comparison.baselineLabel || '').replace(/^the report through\s+/i, '').trim()
                : '';
            return {
                now: 'your year',
                prior: through ? `where it stood through ${through}` : '',
                better: `Better since ${through}`,
                behind: `Slipped since ${through}`,
                steady: `Holding level since ${through}, nothing moved much.`
            };
        }
        return null;
    }

    // The one-to-one message as both private surfaces get it. The team note
    // goes in after the standings and near-miss tails: it is the manager's
    // own paragraph, and those are about this person's numbers. All three sit
    // above the sign-off, which is the last thing the message says, and the
    // whole of it goes through polish() for the two-emoji budget.
    async function buildOutreachMessage(outreach, plan, employeeName, latestKey, baselineKey, dailyEntry, comparison) {
        const message = await writeOutreachMessage(outreach, plan, employeeName, latestKey, baselineKey, dailyEntry, comparison);
        return polish(withTeamNote(message, employeeName, latestKey));
    }

    /**
     * comparison is the window My Team is showing, when it is showing one. Two
     * things depend on it, and both of them used to be assumed:
     *
     *   The week-progress generator only makes sense over a week. Run it over a
     *   month and it writes "how this week is going" about September, so a
     *   non-week window falls through to the kickoff recap, which is shape
     *   agnostic and gets its own nouns from describeWeekRecency.
     *
     *   The daily recap appends "Week to date: ...". Under a month or a
     *   year-to-date window that is a different stretch of time bolted onto the
     *   bottom of the message, so it is left off.
     */
    async function writeOutreachMessage(outreach, plan, employeeName, latestKey, baselineKey, dailyEntry, comparison) {
        // Every exit from here goes through finish(), which is what makes the
        // standings block a property of the one-to-one message rather than of
        // whichever generator happened to write the body. A fifth exit added
        // later gets both tails by using the same door.
        // One set, filled by the block and read by the near-miss line after it,
        // so the two tails cannot both name the same metric with placings
        // counted over different fields.
        const spokenFor = new Set();
        const finish = (text) =>
            withNearMiss(withStandings(text, employeeName, latestKey, spokenFor), employeeName, latestKey, spokenFor);

        const latestIsThisWeek = latestKeyCoversThisWeek(outreach, latestKey);

        // A window with no unit on it is the old behaviour: two weekly uploads.
        const unit = comparison?.unit || 'week';
        const weekShaped = unit === 'week';

        let base;
        if (weekShaped && (plan.base === 'weekProgress' || plan.base === 'weekClosing')) {
            base = await generateWeekProgressMessage(employeeName, latestKey, baselineKey, {
                tone: plan.base === 'weekClosing' ? 'closing' : 'midweek',
                // Only the this-week file can say how far into the week the
                // standings reach. When the newest file is a completed week the
                // block already calls itself "most recent full week", and a day
                // count borrowed from the dailies would be counting a different
                // period than the numbers above it.
                daysIn: latestIsThisWeek
                    ? (daysOfThisWeekInPeriod(outreach, latestKey) || dailyEntry?.dates?.size || 0)
                    : 0,
                latestIsThisWeek,
                weekOpen: latestIsThisWeek && standingsPeriodIsOpen(latestKey)
            });
            // If the week-vs-week read came back empty, the older nudge is
            // still better than sending nothing at all.
            if (!base) base = await generateMidweekCheckinMessage(employeeName, latestKey, baselineKey);
        } else if (plan.base === 'midweek') {
            base = await generateMidweekCheckinMessage(employeeName, latestKey, baselineKey);
        } else {
            // A Tuesday holding Monday's numbers is a follow-up. A Tuesday with
            // no Monday at all, because nobody worked it, is the start of the
            // week and should open like one.
            const startsTheWeek = plan.id === 'monday'
                || (plan.id === 'tuesday' && !dailyEntry?.mondayRow);
            base = await generateMondayKickoffMessage(employeeName, latestKey, baselineKey, {
                dayWord: dayWordFor(plan),
                startsTheWeek,
                // Friday under a month or a year window lands here too, and on a
                // Friday the week the plan is for is the next one.
                ahead: plan.id === 'friday' ? 'next week' : 'this week',
                frame: windowFrame(comparison)
            });
        }

        // When the weekly file already is this week, the recap would be the
        // same numbers a second time.
        if (plan.dailyMode === 'none' || !dailyEntry) return finish(base || '');
        if (plan.dailyMode === 'wtd' && latestIsThisWeek) return finish(base || '');
        // And under a month or a year, the week to date is not a smaller view of
        // the numbers above it, it is a different period entirely.
        if (!weekShaped) return finish(base || '');
        // Nor under Last week: this week's dailies went out under a message
        // about last week (Scott, 2026-10-14). Only a window that is the
        // current week gets them; a caller with no window keeps the old rule.
        if (comparison?.windowId && comparison.windowId !== 'thisWeek') return finish(base || '');

        const rows = plan.dailyMode === 'monday'
            ? (dailyEntry.mondayRow ? [dailyEntry.mondayRow] : [])
            : dailyEntry.rows;
        if (!rows.length) return finish(base || '');

        const recap = outreach.buildDailyRecap(plan, computeRepWtdFromDailies(rows), {
            metrics: DAILY_RECAP_METRICS,
            formatValue: formatDailyPlain,
            dayCount: dailyEntry.dates.size
        });

        return finish(outreach.insertRecap(base || '', recap));
    }

    /**
     * options.comparison is the window My Team is showing, and options.plan the
     * weekday tab it has lit.
     *
     * This was the third control on that page claiming to own time. It read its
     * own remembered period selection and the REAL calendar weekday, so pressing
     * "Private round" under a Month to date header swept last week's file with
     * today's weekday tone, disagreeing with both the chips above it and the tab
     * beside it. Left out, it still does exactly that. The Pulse tab's button
     * that relied on it went with the tab, and the fallback stays only so a
     * caller that forgets the window still gets a round rather than nothing.
     */
    async function showRunMyDayModal(container, options) {
        const outreach = window.DevCoachModules?.dailyOutreach;
        if (!outreach) {
            if (typeof showToast === 'function') showToast('Daily outreach module failed to load.', 3000);
            return;
        }

        const comparison = options?.comparison?.latestKey ? options.comparison : null;
        let latestKey, baselineKey;
        if (comparison) {
            latestKey = comparison.latestKey;
            baselineKey = comparison.baselineKey;
        } else {
            const selection = loadPulseSelection();
            const window_ = getPeriodWindow('week', selection.periodKey);
            if (!window_) {
                if (typeof showToast === 'function') showToast('No weekly data available yet.', 3000);
                return;
            }
            latestKey = window_.latestKey;
            baselineKey = window_.baselineKey;
        }

        const period = getPeriodData(latestKey);
        if (!period) {
            if (typeof showToast === 'function') showToast('Could not load the selected period.', 3000);
            return;
        }

        const employees = getFilteredEmployees(period);
        if (!employees.length) {
            if (typeof showToast === 'function') showToast('No team members in the selected week.', 3000);
            return;
        }

        const now = new Date();
        const todayIso = outreach.isoDate(now);
        // The tab the manager is looking at, when there is one. Sweeping with
        // today's real weekday while a different tab is lit writes a tone
        // nobody asked for.
        const plan = (options?.plan && outreach.planById(options.plan.id)) || outreach.planForDate(now);
        const stamp = outreach.stampFor(plan, { weeklyKey: latestKey, todayIso });

        // Trim the log on the way in so it never grows without bound.
        outreach.saveSentLog(outreach.pruneSentLog(outreach.loadSentLog(), todayIso));
        const sentLog = outreach.loadSentLog();

        const dailyThisWeek = collectDailyRowsThisWeek();

        // Asked once for the whole sweep: does the tool even hold the period
        // this day's message claims to describe?
        const latestWeekEndIso = period?.metadata?.endDate || (latestKey.indexOf('|') > -1 ? latestKey.split('|')[1] : latestKey);
        const weeklyCoversThisWeek = Boolean(latestWeekEndIso) && latestWeekEndIso >= outreach.mondayOf(now);
        // A window the manager picked has already been checked by the page that
        // picked it, and it is not necessarily week shaped, so the weekday's own
        // period question does not apply to it.
        const periodCheck = comparison
            ? { ok: true, reason: '', detail: `Using ${comparison.latestLabel || 'the selected period'}.` }
            : outreach.checkPeriodData(plan, {
                todayIso,
                latestWeekEndIso,
                dailyDayCount: dailyThisWeek.dayCount
            });

        const centerAvgs = centerAveragesFor(latestKey);

        // Build card data, and set aside anyone the day's data can't actually
        // back a message for.
        const cardData = [];
        const blocked = [];
        employees.forEach(emp => {
            const dailyEntry = dailyThisWeek.byName.get(emp.name) || null;
            const coverage = (comparison && comparison.unit !== 'week')
                ? { ok: true, reason: '', warning: '' }
                : outreach.checkCoverage(plan, {
                    inWeekly: true,
                    dailyRowCount: dailyEntry ? dailyEntry.rows.length : 0,
                    hasMondayRow: Boolean(dailyEntry && dailyEntry.mondayRow),
                    weeklyCoversThisWeek
                });

            if (tookNoCalls(emp)) {
                blocked.push({ name: emp.name, reason: 'No calls in this period (no handle time), so there is nothing to coach yet.' });
                return;
            }
            const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
            if (!analysis || !analysis.allMetrics?.length) {
                blocked.push({ name: emp.name, reason: 'No scoreable metrics in this upload.' });
                return;
            }
            if (!coverage.ok) {
                blocked.push({ name: emp.name, reason: coverage.reason });
                return;
            }

            // The same metrics the card judges, so the round and the card
            // never give one person two different badges.
            const badge = getStatusBadge(speakableMetrics(emp, analysis));
            const sentEntry = outreach.getSentEntry(sentLog, plan.id, stamp, emp.name);
            cardData.push({ emp, analysis, badge, dailyEntry, coverage, sentEntry });
        });

        // Anyone with daily rows but no weekly row would otherwise vanish from
        // the sweep entirely. Name them, so "everyone got a message" is a
        // claim you can check rather than one you have to trust.
        const weeklyNames = new Set(employees.map(e => e.name));
        const teamCtx = typeof getTeamSelectionContext === 'function' ? getTeamSelectionContext() : null;
        dailyThisWeek.byName.forEach((_entry, name) => {
            if (weeklyNames.has(name)) return;
            const included = typeof isAssociateIncludedByTeamFilter === 'function'
                ? isAssociateIncludedByTeamFilter(name, teamCtx)
                : true;
            if (!included) return;
            blocked.push({ name, reason: 'Daily uploads only. No weekly numbers to coach against.' });
        });

        // Alphabetical, the same as every picker. Worst-first put the same
        // person at the top of the round every week, and the badge on each
        // card already says who needs the most.
        cardData.sort((a, b) => a.emp.name.localeCompare(b.emp.name));
        blocked.sort((a, b) => a.name.localeCompare(b.name));

        const pending = cardData.filter(c => !c.sentEntry);
        const alreadySent = cardData.filter(c => c.sentEntry);

        // Named as a week on purpose. This read an undeclared `periodType` after
        // the window change took its declaration away, and the ReferenceError
        // stopped the round before its modal ever opened.
        const endDate = getPeriodDisplayLabel('week', latestKey);
        const escapeHtml = window.DevCoachModules?.sharedUtils?.escapeHtml || ((s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
        const weekdayName = getCurrentWeekdayName();

        // Remove any existing modal
        const existing = document.getElementById('runMyDayModal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'runMyDayModal';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.55); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';

        // Same rule as the messages themselves: when a this-week file is what
        // the cards are reading, the header counts the days that file covers.
        // Counting daily uploads there undercounts by however many of them the
        // weekly upload already absorbed.
        const weekDaysCovered = weeklyCoversThisWeek ? daysOfThisWeekInPeriod(outreach, latestKey) : 0;
        const coversText = plan.covers === 'thisWeek'
            ? (weekDaysCovered > 0
                ? `${weekDaysCovered} day${weekDaysCovered === 1 ? '' : 's'} of this week uploaded`
                : `${dailyThisWeek.dayCount} daily upload${dailyThisWeek.dayCount === 1 ? '' : 's'} so far`)
            : `week ending ${escapeHtml(endDate)}`;
        // A window picked on My Team owns the period, so the header says what
        // that window compares rather than what the weekday would have covered.
        // It used to open on today's real weekday as well, so a Monday tab
        // pressed on a Friday read "Monday Kickoff" over "Friday", and nothing
        // said which of the two the numbers came from. Numbers and tone are
        // named separately now, because they come from separate controls.
        const coversLine = comparison
            ? `Numbers: ${escapeHtml(comparison.headline || comparison.latestLabel || '')} • Tone: ${escapeHtml(plan.label)}`
            : `${escapeHtml(weekdayName)} • covers ${escapeHtml(plan.coverageLabel)} • ${coversText}`;

        overlay.innerHTML = `<div style="background:var(--bg-surface); border:1px solid var(--border); border-radius:14px; max-width:780px; width:100%; max-height:90vh; display:flex; flex-direction:column; box-shadow:var(--shadow-lg);">` +
            `<div style="padding:20px 24px; border-bottom:1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">` +
                `<div>` +
                    `<h2 style="margin:0; font-size:1.3em;">${comparison ? 'Private round' : `Run My Day. ${escapeHtml(plan.label)}`}</h2>` +
                    `<div class="text-secondary" style="margin-top:6px; font-size:0.88em;">` +
                        coversLine +
                    `</div>` +
                    `<div class="text-secondary" style="margin-top:4px; font-size:0.88em;">` +
                        `<span style="font-weight:600;">${pending.length} to send</span> • ` +
                        `<span style="color:var(--green-text); font-weight:600;">${alreadySent.length} already sent</span> • ` +
                        `<span style="color:var(--text-tertiary); font-weight:600;">${blocked.length} without data</span>` +
                    `</div>` +
                `</div>` +
                `<button id="runMyDayClose" class="btn-ghost" aria-label="Close" style="font-size:1.6em;">✕</button>` +
            `</div>` +
            (periodCheck.ok
                ? ''
                : `<div class="tone-warn" style="padding:12px 24px; background:var(--yellow-soft); border-bottom:1px solid var(--border); font-size:0.88em;">` +
                    `<strong>${escapeHtml(periodCheck.reason)}</strong> ${escapeHtml(periodCheck.detail)}` +
                  `</div>`) +
            `<div class="text-secondary" style="padding:12px 24px; background:var(--bg-surface-raised); border-bottom:1px solid var(--border); font-size:0.85em;">` +
                `In alphabetical order. Copy each message and send it, then click <strong>Sent</strong>. That flag sticks, so re-running skips them.` +
            `</div>` +
            `<div style="padding:10px 24px; border-bottom:1px solid var(--border);">` +
                teamNoteEditorHtml('rmm') +
            `</div>` +
            `<div id="runMyDayList" style="padding:16px 24px; overflow-y:auto; flex:1;">` +
                `<div style="text-align:center; color:var(--text-tertiary); padding:30px;">⏳ Generating messages…</div>` +
            `</div>` +
            `<div style="padding:14px 24px; border-top:1px solid var(--border); display:flex; justify-content:space-between; align-items:center; gap:12px;">` +
                `<div id="runMyDayProgress" class="text-secondary" style="font-size:0.9em;">0 / ${pending.length} sent</div>` +
                `<div style="display:flex; gap:8px;">` +
                    (alreadySent.length
                        ? `<button id="runMyDayReset" class="btn-ghost" style="padding:10px 14px;">Clear sent flags</button>`
                        : '') +
                    `<button id="runMyDayDoneAll" class="btn-secondary" style="padding:10px 18px;">Close</button>` +
                `</div>` +
            `</div>` +
        `</div>`;

        document.body.appendChild(overlay);
        document.getElementById('runMyDayClose').addEventListener('click', () => overlay.remove());
        document.getElementById('runMyDayDoneAll').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        const resetBtn = document.getElementById('runMyDayReset');
        if (resetBtn) {
            resetBtn.addEventListener('click', async () => {
                outreach.clearAllSentForStamp(plan.id, stamp);
                overlay.remove();
                // Reopened with what it was opened with. Without the options a
                // round started from My Team came back on the Pulse period and
                // today's real weekday, which is also a different sent log.
                await showRunMyDayModal(container, options);
            });
        }

        // Generate sequentially to avoid tip-loader thrash, then render
        const listEl = document.getElementById('runMyDayList');
        const progressEl = document.getElementById('runMyDayProgress');
        const sentSet = new Set();

        const rendered = [];
        for (const entry of pending) {
            let message = '';
            try {
                message = await buildOutreachMessage(outreach, plan, entry.emp.name, latestKey, baselineKey, entry.dailyEntry, comparison) || '';
            } catch (e) { message = ''; }
            // Which note the message went out with, so a change to the note
            // can be moved onto the card without writing the message again.
            const appliedNote = message ? teamNoteFor(entry.emp.name, latestKey) : '';
            rendered.push({ ...entry, message, appliedNote });
        }

        const cardsHtml = rendered.map((r, idx) => {
            const safeName = escapeHtml(r.emp.name);
            const warning = r.coverage.warning
                ? `<div class="tone-warn" style="margin-bottom:8px; font-size:0.8em;">⚠️ ${escapeHtml(r.coverage.warning)}</div>`
                : '';
            return `<div class="rmm-rep-card" data-rep-index="${idx}" data-rep-name="${safeName}" style="border:1px solid var(--border); border-radius:10px; padding:14px; margin-bottom:12px; background:var(--bg-surface);">` +
                `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">` +
                    `<div style="font-weight:700;">${safeName}</div>` +
                    `<div style="display:flex; gap:6px; align-items:center;">` +
                        `<span class="rmm-note-chip pill pill-info" style="display:${r.appliedNote ? 'inline-block' : 'none'}; font-size:0.78em; padding:3px 10px;">📌 Team note</span>` +
                        `<div class="${r.badge.pill}" style="font-size:0.78em; padding:3px 10px;">${r.badge.icon} ${escapeHtml(r.badge.label)}</div>` +
                    `</div>` +
                `</div>` +
                warning +
                `<textarea class="rmm-rep-text" style="width:100%; min-height:120px; padding:10px; border:1px solid var(--border); border-radius:6px; font-size:0.9em; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">${escapeHtml(r.message)}</textarea>` +
                `<div style="display:flex; gap:8px; margin-top:10px;">` +
                    `<button class="rmm-copy btn-secondary" style="flex:1; padding:9px 14px;">Copy</button>` +
                    `<button class="rmm-regen btn-ghost" style="padding:9px 14px;">Regenerate</button>` +
                    `<button class="rmm-sent btn-secondary" style="padding:9px 14px;">✓ Sent</button>` +
                `</div>` +
            `</div>`;
        }).join('');

        const emptyHtml = rendered.length
            ? ''
            : `<div style="text-align:center; padding:30px; color:var(--text-secondary);">` +
                `<div style="font-size:2.4em; margin-bottom:8px;">✅</div>` +
                `<div style="font-weight:600;">Nothing left to send for ${escapeHtml(plan.label)}.</div>` +
                (alreadySent.length ? `<div style="font-size:0.9em; margin-top:6px;">${alreadySent.length} already went out.</div>` : '') +
            `</div>`;

        // Already-sent reps come out of the working list rather than being
        // deleted. The flag is what stops a double-send, so it has to be
        // visible and undoable.
        const sentHtml = alreadySent.length
            ? `<details style="margin-top:8px; border:1px solid var(--border); border-radius:10px; padding:10px 14px; background:var(--bg-surface-raised);">` +
                `<summary style="cursor:pointer; font-weight:600; color:var(--green-text);">✅ Already sent (${alreadySent.length})</summary>` +
                `<div style="margin-top:10px;">` +
                    alreadySent.map(c => {
                        const when = c.sentEntry.at ? new Date(c.sentEntry.at).toLocaleString() : '';
                        return `<div style="display:flex; justify-content:space-between; align-items:center; gap:10px; padding:6px 0; font-size:0.9em; border-bottom:1px solid var(--border);">` +
                            `<span style="color:var(--text-primary);">${escapeHtml(c.emp.name)}</span>` +
                            `<span style="color:var(--text-tertiary); font-size:0.85em; margin-left:auto;">${escapeHtml(when)}</span>` +
                            `<button class="rmm-unsend btn-ghost" data-rep-name="${escapeHtml(c.emp.name)}" style="min-height:0; padding:4px 10px;">Undo</button>` +
                        `</div>`;
                    }).join('') +
                `</div>` +
            `</details>`
            : '';

        const blockedHtml = blocked.length
            ? `<details style="margin-top:10px; border:1px solid var(--border); border-radius:10px; padding:10px 14px; background:var(--bg-surface-raised);">` +
                `<summary style="cursor:pointer; font-weight:600; color:var(--text-secondary);">🚫 No data to back a message (${blocked.length})</summary>` +
                `<div style="margin-top:10px;">` +
                    blocked.map(b => `<div style="display:flex; justify-content:space-between; gap:10px; padding:5px 0; font-size:0.88em; border-bottom:1px solid var(--border);">` +
                        `<span style="color:var(--text-primary);">${escapeHtml(b.name)}</span>` +
                        `<span style="color:var(--text-tertiary);">${escapeHtml(b.reason)}</span>` +
                    `</div>`).join('') +
                `</div>` +
            `</details>`
            : '';

        listEl.innerHTML = cardsHtml + emptyHtml + sentHtml + blockedHtml;

        const updateProgress = () => {
            progressEl.textContent = `${sentSet.size} / ${rendered.length} sent`;
        };
        updateProgress();

        listEl.querySelectorAll('.rmm-unsend').forEach(btn => {
            btn.addEventListener('click', async () => {
                outreach.clearSent(plan.id, stamp, btn.dataset.repName);
                overlay.remove();
                await showRunMyDayModal(container, options);
            });
        });

        listEl.querySelectorAll('.rmm-rep-card').forEach(card => {
            const idx = parseInt(card.dataset.repIndex, 10);
            const repName = card.dataset.repName;
            const textarea = card.querySelector('.rmm-rep-text');
            const entry = rendered[idx];

            card.querySelector('.rmm-copy').addEventListener('click', async () => {
                await copyToClipboard(textarea.value, { message: `Copied ${repName}` });
            });

            card.querySelector('.rmm-regen').addEventListener('click', async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                const originalText = btn.textContent;
                btn.textContent = '⏳';
                try {
                    const msg = await buildOutreachMessage(outreach, plan, repName, latestKey, baselineKey, entry?.dailyEntry, comparison);
                    if (msg) {
                        textarea.value = msg;
                        if (entry) entry.appliedNote = teamNoteFor(repName, latestKey);
                        const chip = card.querySelector('.rmm-note-chip');
                        if (chip) chip.style.display = entry?.appliedNote ? 'inline-block' : 'none';
                    }
                } catch (error) {
                    // Said on screen: there is no console to read, and a button that
                    // silently does nothing reads as broken.
                    console.error('[pulse] A button action failed:', error);
                    if (typeof showToast === 'function') showToast('⚠️ Could not finish that: ' + (error?.message || error), 5000);
                } finally {
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            });

            card.querySelector('.rmm-sent').addEventListener('click', (e) => {
                const btn = e.currentTarget;
                if (sentSet.has(idx)) {
                    sentSet.delete(idx);
                    outreach.clearSent(plan.id, stamp, repName);
                    card.style.opacity = '1';
                    card.style.background = 'var(--bg-surface)';
                    btn.textContent = '✓ Sent';
                } else {
                    sentSet.add(idx);
                    outreach.markSent(plan.id, stamp, repName, new Date().toISOString());
                    card.style.opacity = '0.55';
                    card.style.background = 'var(--green-soft)';
                    btn.textContent = 'Undo';
                }
                updateProgress();
            });
        });

        const noteStatus = () => {
            if (!loadTeamNote().text) return 'none written';
            if (!rendered.length) return 'saved';
            const on = rendered.filter(r => r.appliedNote).length;
            return `added to ${on} of ${rendered.length} message${rendered.length === 1 ? '' : 's'}`;
        };
        setTeamNoteStatus('rmm', noteStatus());

        // A card already marked sent keeps the words that went out.
        wireTeamNoteEditor('rmm', (next) => {
            listEl.querySelectorAll('.rmm-rep-card').forEach(card => {
                const idx = parseInt(card.dataset.repIndex, 10);
                const entry = rendered[idx];
                if (!entry || sentSet.has(idx)) return;
                const textarea = card.querySelector('.rmm-rep-text');
                const nextNote = textarea?.value ? teamNoteFor(entry.emp.name, latestKey, next) : '';
                if (textarea) textarea.value = swapTeamNote(textarea.value, entry.appliedNote, nextNote);
                entry.appliedNote = nextNote;
                const chip = card.querySelector('.rmm-note-chip');
                if (chip) chip.style.display = nextNote ? 'inline-block' : 'none';
            });
            setTeamNoteStatus('rmm', noteStatus());
        });
    }

    // --- Main render ---

    // Export
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.morningPulse = {
        resolveCheckinPeriods,
        // The status cards and the day-file table, drawn on My Team over the
        // window the page is showing.
        buildTeamPulseHtml,
        buildDailyCheckinSection,
        // Any period key, resolved the one way. day-posts needs to look
        // inside whichever period the window picked, and reaching into
        // weeklyData directly is exactly how it came to be blind to
        // months, day files and year-to-date reports.
        getPeriodDataForKey: getPeriodData,
        centerAveragesFor,
        generateCheckinMessage,
        generateHighFiveMessage,
        weekendIsInReach,
        describeWeekRecency,
        generateMondayKickoffMessage,
        generateMidweekCheckinMessage,
        generateWeekProgressMessage,
        DAILY_CHECKIN_METRICS,
        showRunMyDayModal,
        buildOutreachMessage,
        // No handle time is no calls; both private surfaces set them aside.
        tookNoCalls,
        // What a month or year window is called in the message's opener.
        windowFrame,
        // Exported for the standings tests rather than for any caller. What it
        // prints is a position, which is the one thing the rest of this file
        // spends its length withholding, so it has to be reachable without a
        // DOM or a clipboard in the way and held to its gates directly.
        buildStandingsBlock,
        // Exported so the rule that the two tails never name the same metric
        // twice can be asserted rather than reasoned about.
        withNearMiss,
        // The team note, shared by the private round and the one-person
        // post, which both write through buildOutreachMessage.
        loadTeamNote,
        saveTeamNote,
        teamNoteFor,
        swapTeamNote,
        teamNoteEditorHtml,
        wireTeamNoteEditor,
        setTeamNoteStatus,
        collectDailyRowsThisWeek,
        generateMonthlyCheckinMessage,
        generateGrowthMessage,
        showGrowthModal,
        // Exported for the pace tests rather than for any caller. These two
        // decide what an associate is told the rest of their year has to look
        // like, and the last defect in them was invisible from the message: a
        // required average that has been softened reads exactly like one that
        // has not. Reachable without a DOM, a rendered block or a clipboard in
        // the way, they can be held to the Futures table directly.
        yearPaceWeekInfo,
        attachYearPace
    };
})();


