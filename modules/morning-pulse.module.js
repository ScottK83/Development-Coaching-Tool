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

    // Openers live in message-voice.module.js so every tab that greets an
    // associate sounds like the same person wrote it.
    const GREETINGS = (window.DevCoachModules?.messageVoice?.greetingPool('neutral')) || [
        name => `Hey ${name}!`
    ];
    const DATA_IN = [
        date => `Your numbers for the week of ${date} just came in.`,
        date => `Got your data for the week of ${date}.`,
        date => `Just pulled up your week of ${date} numbers.`,
        date => `Your stats from the week of ${date} are in.`,
        date => `Took a look at your week of ${date} performance.`,
        date => `Week of ${date} data is fresh off the press.`,
        date => `Wanted to share your numbers from the week of ${date}.`,
        date => `The week of ${date} is all wrapped up, here's how it went.`,
        date => `Pulled your report for the week of ${date}.`,
        date => `Your week of ${date} recap is ready.`,
        date => `Just sat down with your week of ${date} data.`,
        date => `Here's the rundown for the week of ${date}.`,
        date => `Week of ${date} numbers landed on my desk.`,
        date => `Got the latest from the week of ${date} for you.`,
    ];
    const JUMP_INTROS = [
        (label, delta, range) => `Huge improvement in ${label} this week, ${delta}! (${range})`,
        (label, delta, range) => `Big move in ${label} this week, ${delta}! (${range})`,
        (label, delta, range) => `Love seeing ${label} move like that this week, ${delta}! (${range})`,
        (label, delta, range) => `${label} really stood out this week, ${delta}! (${range})`,
        (label, delta, range) => `You crushed it on ${label} this week, ${delta}! (${range})`,
        (label, delta, range) => `That swing in ${label} caught my eye this week, ${delta}. (${range})`,
        (label, delta, range) => `${label} moved in a serious way this week, ${delta}. (${range})`,
        (label, delta, range) => `Not gonna lie, ${label} at ${delta} this week made me do a double take. (${range})`,
        (label, delta, range) => `Okay, ${label}! That's a ${delta} swing this week. (${range})`,
        (label, delta, range) => `Your ${label} is trending the right direction this week, ${delta}. (${range})`,
        (label, delta, range) => `Seriously though, ${label} moving ${delta} this week is no joke. (${range})`,
        (label, delta, range) => `Look at ${label} go this week, ${delta}! (${range})`,
        (label, delta, range) => `${label} took a real shift this week, ${delta}. (${range})`,
        (label, delta, range) => `Gotta call out your ${label} this week, ${delta}. (${range})`,
    ];
    const PLUS_SOLID = [
        (label, val) => `Plus you're solid on ${label} at ${val}.`,
        (label, val) => `And ${label} sitting at ${val} is great too.`,
        (label, val) => `${label} at ${val} is right where it needs to be.`,
        (label, val) => `Also, ${label} at ${val}? Nice.`,
        (label, val) => `Oh and ${label} is cruising along at ${val}. No complaints there.`,
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
        (l1, v1, l2, v2) => `You nailed it on ${l1} (${v1}) and ${l2} (${v2}) this week.`,
    ];
    const SURVEY_METRIC_KEYS = new Set(['fcr', 'overallExperience', 'overallExperienceTop3', 'cxRepOverall']);
    const PERFECT_SURVEYS_SOLO = [
        (surveys) => `${surveys} perfect this week — can't do better than that.`,
        (surveys) => `${surveys} — every single one a perfect score. That's special.`,
        (surveys) => `Flawless on all ${surveys}. Huge.`,
        (surveys) => `${surveys} and not one off the mark. Beautiful.`,
        (surveys) => `All ${surveys} perfect. That doesn't happen by accident.`,
    ];
    const PERFECT_SURVEYS_PLUS = [
        (surveys, label, val) => `${surveys} — every one perfect. And ${label} at ${val} on top of it? Unreal week.`,
        (surveys, label, val) => `Flawless on ${surveys} plus ${label} at ${val}. That's a statement week.`,
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
    const NO_WINS = [
        'I see you putting in the effort and I appreciate it!',
        'Appreciate you showing up and grinding.',
        'I know the numbers don\'t always show it, but the effort matters.',
        'Keep pushing, I see the work you\'re putting in.',
        'Some weeks the numbers don\'t cooperate. Doesn\'t change how I see your effort.',
        'The grind doesn\'t always pay off immediately, but it will. Hang in there.',
        'Not every week is going to be a highlight reel, and that\'s okay.',
        'I\'d rather have someone who keeps fighting through a tough week, and that\'s you.',
        'Rough stretch, but I\'ve seen what you can do. We\'ll get there.',
        'The effort is there. The results are going to follow.',
        'Listen, not every week lands perfectly. What matters is you keep showing up.',
        'I appreciate the consistency in your effort even when the numbers are stubborn.',
    ];
    // --- Focus framing pools, keyed by how week vs YTD look together ---
    //
    // "persistent" — both last week AND YTD are missing target (real trend)
    // "ytd_only"    — YTD is behind target but last week was fine (reverse the slide)
    // "week_only"   — last week dipped but YTD is solid (one-week blip)
    // "fallback"    — no YTD context available at all
    const FOCUS_PERSISTENT = [
        (label, weekVal, ytdVal, target) => `One thing to zero in on: ${label}. Last week was ${weekVal} and YTD is sitting at ${ytdVal} (target ${target}) — this one needs real attention.`,
        (label, weekVal, ytdVal, target) => `Let's work on ${label} together. Last week at ${weekVal}, YTD at ${ytdVal}, target is ${target}. It's been a pattern, not a blip.`,
        (label, weekVal, ytdVal, target) => `The one I really want us to tackle: ${label}. ${weekVal} last week, ${ytdVal} YTD, target ${target}. We need to turn this around.`,
        (label, weekVal, ytdVal, target) => `${label} is the focus. Week landed at ${weekVal}, YTD at ${ytdVal}, target ${target} — it keeps missing and I want us to change that.`,
    ];
    const FOCUS_YTD_ONLY = [
        (label, weekVal, ytdVal, target) => `YTD ${label} is sitting at ${ytdVal} vs target ${target}. Last week was better at ${weekVal} — let's stack more weeks like that and pull the YTD back up.`,
        (label, weekVal, ytdVal, target) => `Last week you had ${label} at ${weekVal}, which is great. The YTD number is still behind at ${ytdVal} (target ${target}), so we need to keep that momentum going.`,
        (label, weekVal, ytdVal, target) => `${label} is the thing to keep pushing on. YTD ${ytdVal} (target ${target}), but last week's ${weekVal} shows you can do it — let's repeat.`,
    ];
    const FOCUS_WEEK_DIP = [
        (label, weekVal, ytdVal, target) => `Quick note on ${label}: last week dipped to ${weekVal} but your YTD is solid at ${ytdVal} (target ${target}). Not worried, just want to shake off the blip.`,
        (label, weekVal, ytdVal, target) => `${label} had an off week at ${weekVal}, but your YTD at ${ytdVal} is still above target (${target}). Let's get back to normal this week.`,
        (label, weekVal, ytdVal, target) => `Only watch-out: ${label} landed at ${weekVal} last week. YTD ${ytdVal} vs target ${target} says you're fine — just don't let two in a row slip.`,
    ];
    const FOCUS_FALLBACK = [
        (label, val, target) => `One thing to zero in on: ${label}. Last week at ${val}, target is ${target}.`,
        (label, val, target) => `Let's work on getting ${label} closer to target (last week ${val} vs ${target}).`,
        (label, val, target) => `Area to focus on: ${label} came in at ${val} last week, we want ${target}.`,
        (label, val, target) => `If I had to pick one thing, it'd be ${label}. Last week ${val}, target is ${target}.`,
    ];
    const CLOSERS = [
        'Keep it up! Let me know if you need anything.',
        'Solid work. I\'m here if you want to chat about anything.',
        'Keep doing your thing. Reach out if you need me.',
        'Good stuff. Let\'s keep the momentum going.',
        'Nice work. My door\'s always open.',
        'Talk soon. You know where to find me.',
        'That\'s the update. Holler if anything comes up.',
        'Appreciate you. Let\'s have a good one.',
        'Questions? Concerns? Random thoughts? I\'m around.',
        'Let me know if you want to dig into any of this together.',
        'Keep at it. Rooting for you.',
        'That\'s all I got. Go have a great one.',
        'Catch me anytime if you want to talk through anything.',
        'Onward. I\'m always just a message away.',
    ];
    // --- Monday Kickoff phrase pools ---
    const MK_OPENERS = [
        name => `Happy Monday ${name}! 🌟 New week, let's talk about where you stand and where we're headed.`,
        name => `Hey ${name}! ☀️ Kicking off the week with your numbers and a game plan.`,
        name => `Morning ${name}! 🚀 Start of a new week — here's your snapshot and what to focus on.`,
        name => `${name}! Monday check-in time. 📊 Let's celebrate what's working and lock in a plan.`,
        name => `Good morning ${name}! 💪 Quick Monday rundown on your wins and where we can push.`,
        name => `Hey ${name}, let's get this week started right. Here's where things landed. ☕`,
        name => `${name}! Fresh week ahead. Let's look at what's going well and set a target. 🎯`,
        name => `Top of the week ${name}! Here's your latest numbers and our focus for the days ahead.`,
        name => `Rise and shine ${name}! 🌅 Let me share your numbers and set us up for a strong week.`,
        name => `Monday's here ${name}! Quick peek at last week's results and what to aim for this week.`,
        name => `${name}, new week, new opportunity. Let's see what we're working with. 📈`,
        name => `Hey ${name}! Starting the week off by looking at your wins and setting a focus. Let's go!`,
    ];
    const MK_TRANSITION = [
        'Now let\'s talk about where we can push this week.',
        'On the flip side, here\'s where I think we can make a move.',
        'That said, there\'s a spot where I think you can really level up.',
        'Love the wins. Now here\'s the game plan for this week.',
        'Let\'s build on that momentum with a focus area.',
        'Now let\'s zero in on where we can improve.',
        'Great foundation — here\'s where I want us to focus.',
        'With those wins in mind, let\'s talk opportunity.',
        'Alright, here\'s the play for this week.',
        'Here\'s the one thing I want us to be intentional about.',
    ];
    // --- Monday kickoff focus pools, keyed by week vs YTD combo ---
    const MK_FOCUS_PERSISTENT = [
        (label, weekVal, ytdVal, target) => `This week, let's zero in on ${label}. Last week was ${weekVal} and YTD is at ${ytdVal} vs target ${target} — it's been a pattern and I want us to break it.`,
        (label, weekVal, ytdVal, target) => `The one to attack: ${label}. Week at ${weekVal}, YTD at ${ytdVal}, target ${target}. Let's close that gap for real this time.`,
        (label, weekVal, ytdVal, target) => `Game plan: get ${label} moving. Last week ${weekVal}, YTD ${ytdVal}, we need ${target}. I'll help however you need.`,
        (label, weekVal, ytdVal, target) => `This week's mission: ${label}. Last week ${weekVal}, YTD ${ytdVal} vs target ${target}. I think you can get there — let's lock in.`,
        (label, weekVal, ytdVal, target) => `My ask for you this week: be intentional about ${label}. ${weekVal} last week, ${ytdVal} YTD, target ${target}. Small improvements add up.`,
    ];
    const MK_FOCUS_YTD_ONLY = [
        (label, weekVal, ytdVal, target) => `Love that last week's ${label} was ${weekVal} — now let's make that the norm. YTD is still at ${ytdVal} (target ${target}) so the work is pulling that number up.`,
        (label, weekVal, ytdVal, target) => `Your focus: stack another week like last week's ${label} (${weekVal}). YTD ${ytdVal} vs ${target} means we need consistency to move the needle.`,
        (label, weekVal, ytdVal, target) => `${label} is the one to keep pushing. Last week at ${weekVal} was the right direction — YTD is at ${ytdVal}, target ${target}, so let's keep stringing good weeks together.`,
        (label, weekVal, ytdVal, target) => `Here's the one to own: ${label}. Last week's ${weekVal} shows you can hit it. YTD still sits at ${ytdVal} vs target ${target}, so repeatability is the play.`,
    ];
    const MK_FOCUS_WEEK_DIP = [
        (label, weekVal, ytdVal, target) => `Only thing on my radar: ${label} dipped to ${weekVal} last week. YTD is still solid at ${ytdVal} (target ${target}), so it's a one-week thing — just don't let it become two.`,
        (label, weekVal, ytdVal, target) => `Watch-out for this week: ${label}. Last week was ${weekVal}, but your YTD of ${ytdVal} vs ${target} says you know how to do this. Let's reset.`,
        (label, weekVal, ytdVal, target) => `One thing to keep in mind: ${label} had an off week at ${weekVal}. YTD at ${ytdVal}, target ${target} — you're fine, just shake off the dip.`,
    ];
    const MK_FOCUS_FALLBACK = [
        (label, val, target) => `This week, let's zero in on ${label}. Last week was ${val}, target is ${target}.`,
        (label, val, target) => `The one to attack: ${label}. Last week ${val} vs target ${target} — let's close that gap.`,
        (label, val, target) => `This week's mission: ${label}. Last week ${val}, target ${target}. I think you can get there.`,
        (label, val, target) => `My ask for you this week: be intentional about ${label}. Last week ${val}, aiming for ${target}.`,
    ];
    const MK_ALL_GOOD = [
        'You\'re hitting target across the board — incredible work. Let\'s keep that going this week!',
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
        name => `${name}! Halfway through the week and you're doing great — quick pulse check.`,
        name => `Midweek pulse check, ${name}. Love the momentum so far.`,
        name => `Hey ${name}, quick midweek update with some wins to celebrate.`,
        name => `${name}! We're halfway there and building strong. Quick look at the numbers. ⏱️`,
        name => `Checking in ${name} — the week is taking shape and you're in it.`,
        name => `Hey ${name}, quick ${getCurrentWeekdayName()} update. Plenty to be proud of already. 📈`,
        name => `${name}, midweek check — you're giving yourself a real shot this week.`,
        name => `Halfway through the week ${name}! Quick status update and some encouragement.`,
        name => `${name}! Real quick midweek look at the progress you've made.`,
        name => `Quick midweek nudge, ${name}. You're moving in the right direction.`,
        name => `Hey ${name}, touching base midweek with a little extra encouragement.`,
        name => `${name}, taking a quick pulse on the week.`,
        name => `Hey ${name} — wanted to check in real quick. 📊`,
        name => `${name}! Pulled up the numbers midweek and wanted to share what I'm seeing.`,
        name => `${getCurrentWeekdayName()} check-in, ${name}. You've been putting in work.`,
        name => `${name}, dropping in midweek with a quick look at where you stand.`,
        name => `Had to reach out, ${name} — this week is shaping up.`,
        name => `${name}, wanted to pop in with a midweek update.`,
        name => `Quick check-in, ${name}. Let's see how the week is landing.`,
        name => `${name}! Midweek and I'm liking what I see. 👀`,
        name => `Hey ${name}, pausing to give you some midweek feedback.`,
        name => `${name}, just ran the midweek numbers and wanted to share.`,
        name => `Been watching your week, ${name}. Quick note midweek.`,
        name => `${name}, real quick — wanted you to see where you're tracking.`,
        name => `${name}! Stealing a minute of your ${getCurrentWeekdayName()} to talk numbers.`,
        name => `Hey ${name}, sliding in with a midweek read.`,
        name => `${name} — three days in and I've got thoughts. 📊`,
        name => `Appreciate you, ${name}. Quick midweek note.`,
        name => `${name}, don't want to interrupt — just a quick midweek status.`,
        name => `Before you get deep into the afternoon, ${name}, a quick check-in.`,
        name => `${name}, stepped away from the dashboard to send you this midweek note.`,
    ];
    const MW_FOCUS_RECALL = [
        (label) => `Earlier this week we said ${label} was the focus.`,
        (label) => `We set ${label} as your target this week.`,
        (label) => `Remember, our game plan was to push on ${label}.`,
        (label) => `Our focus area this week has been ${label}.`,
        (label) => `We talked about zeroing in on ${label} this week.`,
        (label) => `The plan was to attack ${label} this week.`,
        (label) => `${label} was the metric we wanted to own this week.`,
        (label) => `You've been working on ${label} this week.`,
        (label) => `We identified ${label} as the one to move this week.`,
        (label) => `This week's focus has been ${label}.`,
        (label) => `Monday we zeroed in on ${label} as the metric to move.`,
        (label) => `The one we locked in on this week: ${label}.`,
        (label) => `You've had ${label} in your sights since Monday.`,
        (label) => `${label} was the priority we landed on to start the week.`,
        (label) => `We chose ${label} as the lever to pull this week.`,
        (label) => `The number you've been hunting this week is ${label}.`,
        (label) => `${label} is where we pointed the attention this week.`,
        (label) => `Our commitment this week was to lean into ${label}.`,
        (label) => `Coming into the week, the call was to move ${label}.`,
        (label) => `${label} is the one we put on the board Monday.`,
    ];
    const MW_ON_TRACK = [
        (label, val, target) => `You're crushing it — ${label} at ${val} is already above the ${target} target! 🔥`,
        (label, val, target) => `Great news: ${label} is at ${val}, beating the ${target} target. Proud of this.`,
        (label, val, target) => `${label} at ${val} is on target (${target}) and that's a real midweek win. 💪`,
        (label, val, target) => `Look at that — ${label} at ${val} is hitting the mark (${target}). Love it.`,
        (label, val, target) => `You did it! ${label} at ${val} is right where we want it (${target}). Strong work. ✅`,
        (label, val, target) => `${label} at ${val} is at or above ${target}. The focus is clearly paying off!`,
        (label, val, target) => `${label} at ${val} vs ${target} target? That's a win worth celebrating.`,
        (label, val, target) => `The work on ${label} is showing. ${val} against a ${target} target is legit progress.`,
        (label, val, target) => `${label} at ${val} is through the ${target} bar. That's what showing up looks like. 🎯`,
        (label, val, target) => `Already hitting it on ${label} — ${val} vs ${target} target. Fantastic.`,
        (label, val, target) => `This is the stuff. ${label} at ${val}, target was ${target}. Nailed it.`,
        (label, val, target) => `Goal met. ${label} sitting at ${val} (target ${target}). Keep it rolling.`,
        (label, val, target) => `You're there. ${label} at ${val} cleared ${target}. That's the formula.`,
        (label, val, target) => `${label}: ${val}. Target: ${target}. Verdict: done deal. 🔥`,
        (label, val, target) => `The ${label} number (${val}) is past ${target}. Don't let up, but take a second to feel good about that.`,
        (label, val, target) => `Over the line already — ${label} at ${val}, target ${target}. Big deal.`,
        (label, val, target) => `${label} at ${val} is a real midweek statement. ${target} was the ask and you're past it.`,
    ];
    const MW_CLOSE = [
        (label, val, target, gap) => `You're close — ${label} at ${val}, just ${gap} from ${target}. That's exciting momentum.`,
        (label, val, target, gap) => `${label} is at ${val}, only ${gap} from ${target}. You are right there. 💪`,
        (label, val, target, gap) => `Almost there on ${label}! At ${val}, you're ${gap} from ${target}. Great position midweek.`,
        (label, val, target, gap) => `${label} at ${val} is so close to ${target} (just ${gap} away). This is very doable.`,
        (label, val, target, gap) => `Getting there! ${label} at ${val}, ${gap} to go before ${target}. Love the progress.`,
        (label, val, target, gap) => `The gap on ${label} is shrinking — ${val} vs ${target}, just ${gap} to go. Keep building.`,
        (label, val, target, gap) => `${label}: ${val}. Target: ${target}. Gap: ${gap}. That's absolutely closeable this week.`,
        (label, val, target, gap) => `You're in striking distance on ${label}. ${val} now, ${target} goal, ${gap} to go. 🎯`,
        (label, val, target, gap) => `${label} is within reach — ${val} now, ${target} target, only ${gap} between. 💪`,
        (label, val, target, gap) => `You can see the finish line on ${label}. ${val} today, ${gap} from ${target}.`,
        (label, val, target, gap) => `${label} is knocking on the door — ${val} vs ${target}, just ${gap}. One good stretch closes it.`,
        (label, val, target, gap) => `Super close on ${label}. ${val} vs ${target}, ${gap} gap. A couple intentional calls gets you there.`,
        (label, val, target, gap) => `${label} at ${val} is a whisper away from ${target}. Only ${gap} separates you.`,
        (label, val, target, gap) => `You're on the doorstep of ${label}. ${val}, need ${target}, gap of ${gap}. 🎯`,
        (label, val, target, gap) => `Almost — ${label} at ${val}, ${gap} shy of ${target}. That's a finish-the-week problem, nothing bigger.`,
        (label, val, target, gap) => `${label} is trending right where we want it. ${val} now, ${gap} from ${target}. Stay on it.`,
        (label, val, target, gap) => `You're setting up ${label} to land. ${val} vs ${target}, ${gap} left on the table.`,
    ];
    const MW_BEHIND = [
        (label, val, target, gap) => `${label} is at ${val}, still ${gap} from the ${target} target. But we've got time — let's be intentional about it.`,
        (label, val, target, gap) => `We've got some ground to cover on ${label} — ${val} vs ${target} (${gap} gap). Here's what can help:`,
        (label, val, target, gap) => `${label} at ${val} is a stretch from ${target} (${gap} gap), but every call is a chance to move it.`,
        (label, val, target, gap) => `Real talk: ${label} at ${val} needs work to reach ${target} (${gap} away). Let's make these last days count.`,
        (label, val, target, gap) => `${label} is sitting at ${val} with a ${gap} gap to ${target}. Not where we want it, but the week isn't over.`,
        (label, val, target, gap) => `The ${label} number at ${val} is behind target (${target}, ${gap} gap). Let's focus on what we can control.`,
        (label, val, target, gap) => `${label}: ${val}. We need ${target}. That's a ${gap} gap, but I've seen you close bigger ones.`,
        (label, val, target, gap) => `Not gonna sugarcoat it — ${label} at ${val} vs ${target} (${gap}) needs attention. But there's still time.`,
        (label, val, target, gap) => `Want to be straight with you on ${label} — ${val} with ${gap} to go to ${target}. Let's tighten up.`,
        (label, val, target, gap) => `${label} at ${val} is off the pace (${target}, ${gap} gap). Here's where we pivot:`,
        (label, val, target, gap) => `${label} needs a push. ${val} today, ${target} goal, ${gap} between. Two days can still move it.`,
        (label, val, target, gap) => `The ${label} number (${val}) isn't where we want it yet — ${gap} shy of ${target}. Let's get intentional.`,
        (label, val, target, gap) => `${label} is trailing at ${val} vs ${target}, and that's ${gap} of daylight. Time to refocus.`,
        (label, val, target, gap) => `On ${label}, we're at ${val} with a ${gap} climb to ${target}. Not ideal, but fixable with focus.`,
        (label, val, target, gap) => `I won't dress it up — ${label} at ${val} needs real attention to hit ${target} (${gap} to go). Let's go work.`,
        (label, val, target, gap) => `${label} is the one that needs love right now. ${val} against ${target}, ${gap} gap. Doable with intention.`,
        (label, val, target, gap) => `Gonna call it — ${label} at ${val} is behind (${gap} from ${target}). Let's finish the week pushing on this.`,
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
        (label) => ` No fresh numbers on ${label} yet — stay locked in on it.`,
        (label) => ` ${label} hasn't refreshed yet, but keep treating it like it's the one.`,
        (label) => ` Haven't seen the ${label} numbers update, but don't take your foot off it.`,
        (label) => ` We don't have new ${label} data yet, but the work still matters.`,
        (label) => ` ${label} isn't showing fresh yet — keep pushing like it is.`,
    ];
    const MW_FALLBACK_FOCUS = [
        (label, cur, tgt) => `\n\n🎯 The metric I'd focus on for the rest of the week: ${label} at ${cur} (target ${tgt}).`,
        (label, cur, tgt) => `\n\n🎯 If you ask me what to lean into the rest of the week: ${label} (${cur} vs ${tgt}).`,
        (label, cur, tgt) => `\n\n🎯 Here's the one I'd chase down: ${label} at ${cur}, target ${tgt}.`,
        (label, cur, tgt) => `\n\n🎯 The lever worth pulling the rest of this week: ${label} (${cur}, target ${tgt}).`,
        (label, cur, tgt) => `\n\n🎯 My suggested focus the next couple days: ${label}, sitting at ${cur} against a ${tgt} target.`,
        (label, cur, tgt) => `\n\n🎯 Where I'd spend the attention: ${label} — ${cur} right now, ${tgt} is the goal.`,
    ];
    const MW_BRIGHT_SIDE = [
        (label, val) => ` On the bright side, ${label} at ${val} is looking good.`,
        (label, val) => ` The good news: ${label} at ${val} is right where we want it.`,
        (label, val) => ` Want to point out — ${label} at ${val} is a bright spot.`,
        (label, val) => ` One thing to feel good about: ${label} at ${val}.`,
        (label, val) => ` Worth mentioning — ${label} at ${val} is holding strong.`,
        (label, val) => ` And don't miss it — ${label} at ${val} is a win.`,
    ];
    const MW_TIP_PREFIXES = ['💡', '🛠️', '👉', '🎯', '📌'];
    const MW_CLOSERS = [
        'Proud of you. Let me know how I can help.',
        'Proud of you. Let me know how I can help as you finish the week.',
        'Proud of you. Let me know how I can help keep this momentum going.',
        'Proud of you. Let me know how I can help you close strong.',
        'Proud of the work you\'re putting in — holler if I can do anything to support.',
        'You know where to find me if anything comes up. Finish strong.',
        'Keep at it — I\'m in your corner if you need something.',
        'You\'re doing the work. Let me know what would help from my end.',
        'Hit me up if anything gets in the way. Love what you\'re doing.',
        'Backing you the rest of the week — shout if you need something.',
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
    // Friday. These openers say nothing about what day it is.
    const HF_OPENERS = [
        name => `Hey ${name}! \uD83C\uDF89`,
        name => `${name}! \uD83C\uDF89\uD83D\uDE4C`,
        name => `Yo ${name}! \uD83C\uDF89`,
        name => `What a run, ${name}! \uD83C\uDF89`,
        name => `${name}! Gotta give credit where it's due. \uD83C\uDF89`,
        name => `${name}, you need to see these numbers. \uD83C\uDF89`,
        name => `Hey ${name}, just wanted to highlight your numbers real quick. \uD83C\uDF89`,
        name => `${name}, dropping in with something worth celebrating. \uD83C\uDF89`,
        name => `Had to stop what I was doing and send this, ${name}! \uD83C\uDF89`,
        name => `Big props coming your way, ${name}! \uD83C\uDF89`,
        name => `${name}! Pulled your numbers up and had to say something. \uD83C\uDF89`,
        name => `Hey ${name}, this one deserves a callout. \uD83C\uDF89`,
    ];
    // Only drawn from when the weekend is actually in reach. Telling someone on
    // a Tuesday to enjoy their weekend is how a real shout-out starts reading
    // like a template.
    const HF_OPENERS_WEEKEND = [
        name => `${name}, had to send you this before the weekend! \uD83C\uDF89`,
        name => `Real quick, ${name}, before you head out for the weekend. \uD83C\uDF89`,
        name => `Couldn't let the week end without saying something, ${name}! \uD83C\uDF89`,
        name => `${name}! Wrapping up the week and had to share this. \uD83C\uDF89`,
        name => `Quick shoutout before the weekend, ${name}! \uD83C\uDF89`,
    ];
    // `when` names the week the upload actually covers, which is usually not
    // the one in flight. See describeWeekRecency.
    const HF_JUMP = [
        (label, delta, range, when) => `Incredible move in ${label} ${when}, ${delta}! (${range}) That kind of progress stands out.`,
        (label, delta, range, when) => `You moved ${label} in a big way ${when}, ${delta}! (${range}) That's impressive.`,
        (label, delta, range, when) => `${label} took a real swing ${when}, ${delta}! (${range}) Love to see it.`,
        (label, delta, range, when) => `The progress on ${label} ${when} is awesome, ${delta}! (${range}) Keep that energy.`,
        (label, delta, range, when) => `Your ${label} moved ${delta} ${when} and honestly it's one of the best improvements I've seen. (${range})`,
        (label, delta, range, when) => `That ${delta} move in ${label} ${when} is worth celebrating. (${range}) That took real effort.`,
        (label, delta, range, when) => `${label} went from good to great ${when}, ${delta}. (${range}) You should feel good about that.`,
        (label, delta, range, when) => `I have to point out that ${label} swing ${when}, ${delta}. (${range}) That's not easy to do.`,
        (label, delta, range, when) => `When I saw ${label} at ${delta} ${when}, I knew I had to say something. (${range}) Wow.`,
        (label, delta, range, when) => `The kind of improvement you showed on ${label} ${when}, ${delta}, doesn't happen by accident. (${range})`,
    ];
    const HF_TWO_WINS = [
        (l1, v1, l2, v2, when) => `Your ${l1} at ${v1} and ${l2} at ${v2} were outstanding!`,
        (l1, v1, l2, v2, when) => `${l1} at ${v1} and ${l2} at ${v2}? Absolutely killing it!`,
        (l1, v1, l2, v2, when) => `Crushed it on ${l1} (${v1}) and ${l2} (${v2}) ${when}!`,
        (l1, v1, l2, v2, when) => `${l1} at ${v1} and ${l2} at ${v2} are both legit impressive.`,
        (l1, v1, l2, v2, when) => `Between ${l1} at ${v1} and ${l2} at ${v2}, you had one heck of a run.`,
        (l1, v1, l2, v2, when) => `I mean, ${l1} at ${v1} AND ${l2} at ${v2}? Come on now.`,
        (l1, v1, l2, v2, when) => `Your ${l1} (${v1}) and ${l2} (${v2}) were both standout numbers ${when}.`,
        (l1, v1, l2, v2, when) => `Two words: ${l1} at ${v1}. Two more: ${l2} at ${v2}. Just great.`,
        (l1, v1, l2, v2, when) => `${l1} at ${v1}, ${l2} at ${v2}. That's the kind of stretch you want to have.`,
        (l1, v1, l2, v2, when) => `Can we talk about ${l1} at ${v1} and ${l2} at ${v2}? Because those are excellent.`,
    ];
    const HF_ONE_WIN = [
        (label, val, when) => `Your ${label} at ${val} was outstanding!`,
        (label, val, when) => `${label} at ${val}? That's what I'm talking about!`,
        (label, val, when) => `Killed it on ${label} at ${val} ${when}!`,
        (label, val, when) => `Your ${label} coming in at ${val} is seriously impressive.`,
        (label, val, when) => `${label} at ${val} was the highlight and it deserves a callout.`,
        (label, val, when) => `I saw your ${label} at ${val} and honestly just wanted to say great job.`,
        (label, val, when) => `That ${label} number at ${val}? Chef's kiss.`,
        (label, val, when) => `${label} at ${val} tells me everything about how you showed up ${when}.`,
        (label, val, when) => `Huge props on ${label} at ${val}. That's no small thing.`,
        (label, val, when) => `Let's be real, ${label} at ${val} is just flat out good.`,
    ];
    const HF_NO_WINS = [
        when => `I wanted to recognize your effort ${when}. You showed up and put in the work, and that matters.`,
        when => 'Just want you to know I see the grind. Keep at it.',
        when => `Appreciate the effort you put in ${when}. It doesn't go unnoticed.`,
        when => 'The numbers are one thing, but showing up every day is the foundation. You did that.',
        when => `I wanted to take a sec to acknowledge your work ${when}. It matters more than you think.`,
        when => 'Not every stretch is going to be flashy, but the work ethic you bring is what builds a great track record.',
        when => 'I see you out there putting in the work. That consistency is going to pay off.',
        when => 'Wanted to make sure you know that the effort hasn\'t gone unnoticed. Keep going.',
    ];
    const HF_EXTRAS = [
        extras => `On top of that, ${extras}... you're on a roll!`,
        extras => `And ${extras} too? You're firing on all cylinders.`,
        extras => `Plus ${extras}. Just an all-around great showing.`,
        extras => `Not to mention ${extras}. Seriously impressive.`,
        extras => `Oh and did I mention ${extras}? Because yeah, that happened too.`,
        extras => `Throw in ${extras} and you've basically had the perfect run.`,
        extras => `As if that wasn't enough, ${extras} also hit.`,
        extras => `And to top it all off, ${extras}. What a run.`,
        extras => `Then there's ${extras} on top of everything else. You went off.`,
        extras => `Can't forget about ${extras} either. Just stacking wins.`,
    ];
    const HF_CONSISTENCY = [
        (on, total) => `${on} out of ${total} metrics hitting target, that's consistency right there.`,
        (on, total) => `${on} of ${total} metrics on target. That's not luck, that's discipline.`,
        (on, total) => `Hitting target on ${on} out of ${total} metrics. Consistency is your thing.`,
        (on, total) => `${on} of ${total} at or above target. You're dialed in across the board.`,
        (on, total) => `When ${on} out of ${total} metrics are hitting, that tells me you're doing things right.`,
        (on, total) => `${on} of ${total} on target? That's what we call well-rounded performance.`,
        (on, total) => `Landing ${on} out of ${total} metrics shows real balance. That's hard to do.`,
        (on, total) => `${on} of ${total} on target. That doesn't happen by accident. You're putting in the work everywhere.`,
    ];
    // Sign-offs that work on any day of the week.
    const HF_CLOSERS = [
        'Awesome job. Have a good one!',
        'Nothing left to say except well done. Have a great one.',
        'Heck of a run. Go enjoy it.',
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
    // Monthly review phrases
    const MO_GREETINGS = [
        (name, month) => `Hey ${name}! Here's your ${month} recap.`,
        (name, month) => `${name}! Let's look at how ${month} went.`,
        (name, month) => `Hey ${name}, wrapping up ${month} for you.`,
        (name, month) => `${name}, your ${month} numbers are in. Let's talk about it.`,
        (name, month) => `${name}, ${month} is in the books. Here's the summary.`,
        (name, month) => `Alright ${name}, let's break down your ${month}.`,
        (name, month) => `Hey ${name}, wanted to walk you through your ${month} numbers.`,
        (name, month) => `${name}! Just finished reviewing your ${month} data.`,
        (name, month) => `${name}, here's how ${month} played out for you.`,
        (name, month) => `Quick ${month} recap for you, ${name}.`,
        (name, month) => `Hey ${name}, got your ${month} wrap-up ready.`,
    ];
    const MO_JUMP = [
        (label, delta, range) => `Big month for ${label}, ${delta}! (${range})`,
        (label, delta, range) => `${label} moved nicely this month, ${delta}. (${range})`,
        (label, delta, range) => `Standout improvement this month: ${label} at ${delta}. (${range})`,
        (label, delta, range) => `${label} really got moving this month, ${delta}. (${range})`,
        (label, delta, range) => `Loved watching ${label} trend the right way this month, ${delta}. (${range})`,
        (label, delta, range) => `Your ${label} progress this month was impressive, ${delta}. (${range})`,
        (label, delta, range) => `${label} at ${delta} was the big story of the month. (${range})`,
        (label, delta, range) => `The progress on ${label} this month speaks for itself, ${delta}. (${range})`,
    ];
    const MO_TWO_WINS = [
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2} were strong all month.`,
        (l1, v1, l2, v2) => `Consistently solid on ${l1} (${v1}) and ${l2} (${v2}).`,
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2}? Month-long wins right there.`,
        (l1, v1, l2, v2) => `You held it down on ${l1} (${v1}) and ${l2} (${v2}) all month.`,
        (l1, v1, l2, v2) => `Two highlights for the month: ${l1} at ${v1} and ${l2} at ${v2}.`,
        (l1, v1, l2, v2) => `${l1} at ${v1} paired with ${l2} at ${v2} is a really strong combo.`,
        (l1, v1, l2, v2) => `Great to see ${l1} (${v1}) and ${l2} (${v2}) both sustain all month.`,
        (l1, v1, l2, v2) => `The fact that you kept ${l1} at ${v1} and ${l2} at ${v2} for a full month is impressive.`,
    ];
    const MO_ONE_WIN = [
        (label, val) => `${label} at ${val} was a highlight for the month.`,
        (label, val) => `Really solid month on ${label} at ${val}.`,
        (label, val) => `Your ${label} at ${val} stood out this month.`,
        (label, val) => `${label} coming in at ${val} for the month is a win.`,
        (label, val) => `Got to hand it to you on ${label} at ${val} this month.`,
        (label, val) => `${label} at ${val}? That's a month well spent.`,
        (label, val) => `The work on ${label} paid off this month, ${val} is great.`,
        (label, val) => `${label} at ${val} was one of the best numbers I saw this month.`,
    ];
    const MO_NO_WINS = [
        'This month was a grind but I see the effort.',
        'Not the month we wanted, but we\'re going to build on it.',
        'Tough month, but we\'ve got a clean slate ahead.',
        'Some months are like this. What matters is how we respond next month.',
        'I know this wasn\'t the month you were hoping for. Let\'s use it as fuel.',
        'The numbers were tough this month, but I\'ve seen what you\'re capable of.',
        'Not every month is going to be a win, and that\'s reality. Let\'s regroup.',
        'We\'ll look back on this month as the one that set up the next breakthrough.',
    ];
    const MO_FOCUS = [
        (label, val, target) => `Heading into next month, let's target ${label} (${val} vs goal of ${target}).`,
        (label, val, target) => `For next month, the priority is ${label} (sitting at ${val}, target ${target}).`,
        (label, val, target) => `Main focus going forward: ${label} at ${val}, we need ${target}.`,
        (label, val, target) => `The game plan for next month starts with ${label}. Currently ${val}, goal is ${target}.`,
        (label, val, target) => `If we nail one thing next month, let it be ${label} (${val} vs ${target}).`,
        (label, val, target) => `I want us to put real energy into ${label} next month. At ${val}, shooting for ${target}.`,
        (label, val, target) => `Next month's mission: get ${label} from ${val} closer to ${target}.`,
        (label, val, target) => `The biggest opportunity I see? ${label} at ${val}. Target is ${target} and I know you can close that gap.`,
    ];
    const MO_CONSISTENCY = [
        (on, total) => `You hit target on ${on} of ${total} metrics for the month.`,
        (on, total) => `${on} out of ${total} metrics at or above target this month.`,
        (on, total) => `Landing ${on} of ${total} on target for the month shows solid consistency.`,
        (on, total) => `${on} of ${total} metrics where they need to be. That's a good month.`,
        (on, total) => `Across ${total} metrics, ${on} hit target. That's the kind of balance I like to see.`,
        (on, total) => `You were on target for ${on} out of ${total} metrics this month. Steady work.`,
    ];
    const MO_CLOSERS = [
        'Let\'s carry this into next month. I\'m here if you want to go over anything.',
        'Solid month overall. Let me know if you want to sit down and talk through it.',
        'Good work this month. Let\'s keep building.',
        'On to the next one. Reach out if you need anything.',
        'Fresh month ahead. Let\'s make it count.',
        'Appreciate the work this month. Let me know how I can help going forward.',
        'That wraps up the month. My door is always open.',
        'Here\'s to an even better month ahead. I\'m in your corner.',
        'Thanks for the effort this month. Let\'s keep the conversation going.',
        'New month, new opportunities. Let\'s go.',
    ];
    const QTR_GREETINGS = [
        (name, quarter) => `Hey ${name}! Here's your ${quarter} recap.`,
        (name, quarter) => `${name}, let's look at how ${quarter} shaped up.`,
        (name, quarter) => `Hey ${name}, wrapping up ${quarter} for you.`,
        (name, quarter) => `${name}, your ${quarter} numbers are in. Let's talk about it.`,
        (name, quarter) => `${name}! ${quarter} is officially in the books.`,
        (name, quarter) => `Alright ${name}, here's the ${quarter} breakdown.`,
        (name, quarter) => `${name}, wanted to share your ${quarter} review with you.`,
        (name, quarter) => `Hey ${name}, just put together your ${quarter} summary.`,
        (name, quarter) => `${name}, let me walk you through how ${quarter} went.`,
        (name, quarter) => `Quick ${quarter} debrief for you, ${name}.`,
        (name, quarter) => `${name}! Big picture look at your ${quarter} right here.`,
    ];
    const QTR_JUMP = [
        (label, delta, range) => `Big quarter for ${label}, ${delta}! (${range})`,
        (label, delta, range) => `${label} moved nicely this quarter, ${delta}. (${range})`,
        (label, delta, range) => `Standout improvement this quarter: ${label} at ${delta}. (${range})`,
        (label, delta, range) => `${label} really came alive this quarter, ${delta}. (${range})`,
        (label, delta, range) => `Over the quarter, ${label} moved by ${delta}. (${range}) That's real progress.`,
        (label, delta, range) => `Your ${label} improvement of ${delta} was the story of the quarter. (${range})`,
        (label, delta, range) => `The trajectory on ${label} this quarter was great, ${delta}. (${range})`,
        (label, delta, range) => `${label} at ${delta} over the quarter shows sustained effort. (${range})`,
    ];
    const QTR_TWO_WINS = [
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2} were strong all quarter.`,
        (l1, v1, l2, v2) => `Consistently solid on ${l1} (${v1}) and ${l2} (${v2}).`,
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2}? Quarter-long wins right there.`,
        (l1, v1, l2, v2) => `Sustained excellence on ${l1} (${v1}) and ${l2} (${v2}) all quarter.`,
        (l1, v1, l2, v2) => `Two metrics that really defined your quarter: ${l1} at ${v1} and ${l2} at ${v2}.`,
        (l1, v1, l2, v2) => `Keeping ${l1} at ${v1} and ${l2} at ${v2} for a full quarter is no small feat.`,
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2} over three months? That's consistency.`,
        (l1, v1, l2, v2) => `Your ${l1} (${v1}) and ${l2} (${v2}) were rock solid all quarter long.`,
    ];
    const QTR_ONE_WIN = [
        (label, val) => `${label} at ${val} was a highlight for the quarter.`,
        (label, val) => `Really solid quarter on ${label} at ${val}.`,
        (label, val) => `${label} at ${val} over the full quarter is genuinely impressive.`,
        (label, val) => `Your ${label} at ${val} was one of the standout numbers for the quarter.`,
        (label, val) => `Got to recognize ${label} at ${val}. That kind of sustained performance is hard.`,
        (label, val) => `${label} at ${val} for the quarter tells me you were locked in.`,
        (label, val) => `${label} finishing the quarter at ${val}? That's great work.`,
        (label, val) => `The consistency you showed on ${label} at ${val} this quarter was notable.`,
    ];
    const QTR_NO_WINS = [
        'This quarter was a grind but I see the effort.',
        'Not the quarter we wanted, but we\'re going to build on it.',
        'Tough quarter, but we\'ve got a clean slate ahead.',
        'Some quarters test you. This was one of those. Let\'s come back stronger.',
        'I appreciate the fight you put up this quarter even when the numbers were tough.',
        'The effort was there this quarter. Let\'s channel it into results next time.',
        'We learn the most from the hard quarters. Let\'s use this one.',
        'Not the outcome we were after, but I\'m confident the next quarter tells a different story.',
    ];
    const QTR_FOCUS = [
        (label, val, target) => `Heading into next quarter, let's target ${label} (${val} vs goal of ${target}).`,
        (label, val, target) => `For next quarter, the priority is ${label} (sitting at ${val}, target ${target}).`,
        (label, val, target) => `Main focus going forward: ${label} at ${val}, we need ${target}.`,
        (label, val, target) => `The game plan for next quarter centers on ${label}. Currently ${val}, goal is ${target}.`,
        (label, val, target) => `If there's one thing to own next quarter, it's ${label} at ${val}. Target is ${target}.`,
        (label, val, target) => `I want ${label} to be the story of next quarter. We're at ${val}, let's push for ${target}.`,
        (label, val, target) => `Next quarter starts with a focus on ${label}. Right now it's ${val}, we're aiming for ${target}.`,
        (label, val, target) => `The biggest lever I see for next quarter is ${label} (${val} today, ${target} is where we want to be).`,
    ];
    const QTR_CONSISTENCY = [
        (on, total) => `You hit target on ${on} of ${total} metrics for the quarter.`,
        (on, total) => `${on} out of ${total} metrics at or above target this quarter.`,
        (on, total) => `${on} of ${total} on target for a full quarter. That's discipline.`,
        (on, total) => `Across ${total} metrics over three months, ${on} stayed on target. Well done.`,
        (on, total) => `Finishing the quarter with ${on} of ${total} metrics on target shows real steadiness.`,
        (on, total) => `${on} out of ${total} hitting target over the quarter. That kind of consistency matters.`,
    ];
    const QTR_CLOSERS = [
        'Let\'s carry this into next quarter. I\'m here if you want to go over anything.',
        'Solid quarter overall. Let me know if you want to sit down and talk through it.',
        'Good work this quarter. Let\'s keep building.',
        'On to the next one. Reach out if you need anything.',
        'New quarter, fresh start. Let\'s make it a good one.',
        'Appreciate everything you brought this quarter. I\'m here if you want to talk.',
        'That\'s the quarter in review. Looking forward to what\'s next.',
        'Here\'s to an even stronger quarter ahead. You\'ve got this.',
        'Thanks for your work this quarter. Let\'s keep pushing forward together.',
        'Quarter\'s done. Let\'s recharge and come back swinging.',
    ];

    // --- Data helpers ---

    // Which uploads are week-shaped is a question period-index owns. This used
    // to be one of three spellings of it.
    function getAllSortedKeys() {
        const index = window.DevCoachModules?.periodIndex;
        if (!index) return [];
        return index.weekLikeKeys(index.currentIndex());
    }

    function getPeriodData(weekKey) {
        const weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        return weekly[weekKey] || null;
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

    function savePulseSelection(selection) {
        try {
            localStorage.setItem(PULSE_SELECTION_STORAGE_KEY, JSON.stringify({
                periodType: selection?.periodType || 'week',
                periodKey: selection?.periodKey || null
            }));
        } catch (e) { /* ignore storage failure */ }
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

    function getPeriodContextLabel(periodType) {
        if (periodType === 'month') return 'this month';
        if (periodType === 'quarter') return 'this quarter';
        return 'this week';
    }

    function getReviewButtonLabel(periodType) {
        if (periodType === 'quarter') return '📈 Quarterly Review';
        if (periodType === 'month') return '📅 Monthly Review';
        return '💬 Check-in';
    }

    function getReviewMessageType(periodType) {
        if (periodType === 'quarter') return 'quarterly';
        if (periodType === 'month') return 'monthly';
        return 'checkin';
    }

    function getPeriodEndDate(weekKey) {
        const period = getPeriodData(weekKey);
        const meta = period?.metadata?.endDate;
        if (meta) return new Date(meta + 'T00:00:00');
        const parts = weekKey.split('|');
        return new Date((parts[1] || parts[0]) + 'T00:00:00');
    }

    function getEndDateLabel(weekKey, period) {
        const meta = period?.metadata?.endDate;
        if (meta && typeof formatDateMMDDYYYY === 'function') return formatDateMMDDYYYY(meta);
        const parts = weekKey.split('|');
        const raw = parts[1] || parts[0];
        return typeof formatDateMMDDYYYY === 'function' ? formatDateMMDDYYYY(raw) : raw;
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
        const baseEmp = basePeriod?.employees?.find(e => e.name === empName);
        const latestEmp = latestPeriod?.employees?.find(e => e.name === empName);
        if (!baseEmp || !latestEmp) return [];

        // If baseline had barely any calls, the data is noise
        const baseCalls = parseInt(baseEmp.totalCalls, 10);
        if (!Number.isFinite(baseCalls) || baseCalls < MIN_BASELINE_CALLS) return [];

        const registry = typeof METRICS_REGISTRY !== 'undefined' ? METRICS_REGISTRY : {};
        const deltas = [];

        Object.keys(registry).filter(k => !PULSE_EXCLUDED_METRICS.includes(k)).forEach(metricKey => {
            const baseVal = parseFloat(baseEmp[metricKey]);
            const latestVal = parseFloat(latestEmp[metricKey]);
            if (!Number.isFinite(baseVal) || !Number.isFinite(latestVal)) return;

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
    function getBiggestJump(deltas) {
        const improvements = deltas.filter(d => d.delta > 0);
        if (!improvements.length) return null;
        return improvements.reduce((best, d) => d.delta > best.delta ? d : best);
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

    function pickFocalPoint(allMetrics) {
        const needsFocus = allMetrics
            .filter(m => m.classification === 'Needs Focus')
            .sort((a, b) => {
                const riskA = (a.gapFromTarget || 0) + (a.trendDirection === 'declining' ? 2 : 0);
                const riskB = (b.gapFromTarget || 0) + (b.trendDirection === 'declining' ? 2 : 0);
                return riskB - riskA;
            });
        if (needsFocus.length) return needsFocus[0];

        const watchArea = allMetrics
            .filter(m => m.classification === 'Watch Area')
            .sort((a, b) => (b.gapFromTarget || 0) - (a.gapFromTarget || 0));
        if (watchArea.length) return watchArea[0];

        return null;
    }

    // Fetch YTD-level metric analysis for a single employee, for cross-checking
    // weekly numbers against longer-run performance. Returns a Map keyed by
    // metricKey. Returns null if no YTD data is available.
    function getYtdMetricsMapForEmployee(employeeName) {
        const ytd = typeof ytdData !== 'undefined' ? ytdData : {};
        const ytdKeys = Object.keys(ytd);
        if (!ytdKeys.length) return null;

        // Prefer the most recently-ending YTD period (real uploads sort
        // alongside auto-generated ones; latest end date wins either way).
        const latestKey = ytdKeys
            .map(k => {
                const endText = ytd[k]?.metadata?.endDate || (k.includes('|') ? k.split('|')[1] : '');
                return { k, end: new Date(endText) };
            })
            .filter(x => !isNaN(x.end))
            .sort((a, b) => b.end - a.end)[0]?.k;
        if (!latestKey) return null;

        const ytdPeriod = ytd[latestKey];
        const emp = ytdPeriod?.employees?.find(e => e.name === employeeName);
        if (!emp) return null;

        const analyzeFn = window.DevCoachModules?.metricTrends?.analyzeTrendMetrics
            || window.analyzeTrendMetrics;
        if (!analyzeFn) return null;

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};

        const analysis = analyzeFn(emp, centerAvgs, null, null, {
            employeeName: employeeName,
            weekKey: latestKey,
            periodType: 'ytd'
        });
        if (!analysis?.allMetrics) return null;

        const map = new Map();
        analysis.allMetrics.forEach(m => map.set(m.metricKey, m));
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

        const candidates = weekMetrics.map(m => {
            const ytd = ytdMap.get(m.metricKey);
            const ytdMiss = ytd ? (ytd.classification === 'Needs Focus' || ytd.classification === 'Watch Area') : false;
            const weekMiss = m.classification === 'Needs Focus' || m.classification === 'Watch Area';
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
    function buildFocalText(focal, pools) {
        if (!focal) return '';
        const label = focal.label;
        const target = fmtTarget(focal);
        const weekVal = fmtVal(focal);
        const ytdVal = focal.ytdValue !== null && focal.ytdValue !== undefined
            ? fmtVal(focal.metricKey, focal.ytdValue)
            : null;
        if (focal.ytdContext === 'persistent' && ytdVal !== null) {
            return pick(pools.persistent)(label, weekVal, ytdVal, target);
        }
        if (focal.ytdContext === 'ytd_only' && ytdVal !== null) {
            return pick(pools.ytdOnly)(label, weekVal, ytdVal, target);
        }
        if (focal.ytdContext === 'week_only' && ytdVal !== null) {
            return pick(pools.weekDip)(label, weekVal, ytdVal, target);
        }
        return pick(pools.fallback)(label, weekVal, target);
    }

    function getStatusBadge(allMetrics) {
        const needsFocus = allMetrics.filter(m => m.classification === 'Needs Focus').length;
        const exceeding = allMetrics.filter(m => m.classification === 'Exceeding Expectation').length;
        const onTrack = allMetrics.filter(m => m.classification === 'On Track').length;

        if (needsFocus >= 3) return { label: 'Needs Support', color: '#e53935', bg: '#ffebee', icon: '\uD83D\uDD34' };
        if (needsFocus >= 1) return { label: 'Watch', color: '#fb8c00', bg: '#fff3e0', icon: '\uD83D\uDFE1' };
        if (exceeding >= 3) return { label: 'Crushing It', color: '#2e7d32', bg: '#e8f5e9', icon: '\uD83D\uDFE2' };
        if (onTrack + exceeding >= allMetrics.length * 0.7) return { label: 'Solid', color: '#1e88e5', bg: '#e3f2fd', icon: '\uD83D\uDD35' };
        return { label: 'Steady', color: '#78909c', bg: '#eceff1', icon: '\u26AA' };
    }

    // --- Formatting helpers ---

    function fmtVal(metricKeyOrObj, value) {
        const key = typeof metricKeyOrObj === 'object' ? metricKeyOrObj.metricKey : metricKeyOrObj;
        const val = value !== undefined ? value : (typeof metricKeyOrObj === 'object' ? metricKeyOrObj.employeeValue : 0);
        if (typeof formatMetricDisplay === 'function') return formatMetricDisplay(key, val);
        const unit = window.METRICS_REGISTRY?.[key]?.unit || '';
        if (unit === '#') return Math.round(val).toString();
        if (unit === 'sec') return Math.round(val) + 's';
        if (unit === 'hrs') return val.toFixed(1) + ' hrs';
        return val.toFixed(1) + '%';
    }

    function fmtTarget(metric) {
        if (typeof formatMetricDisplay === 'function') return formatMetricDisplay(metric.metricKey, metric.target);
        return metric.target + '';
    }

    // `labels` ({ when, prior }) overrides the possessive wording below. A
    // label like "two weeks ago" has no possessive form, so when one is passed
    // the numbers come first and the label trails them.
    function fmtRange(metricKey, baseVal, latestVal, periodType, labels) {
        const reverse = typeof isReverseMetric === 'function' && isReverseMetric(metricKey);
        if (labels) {
            const base = `${fmtVal(metricKey, baseVal)} ${labels.prior}`;
            const now = `${fmtVal(metricKey, latestVal)} ${labels.when}`;
            return reverse ? `down from ${base} to ${now}` : `${base} \u2192 ${now}`;
        }
        const priorLabel = periodType === 'quarter' ? "last quarter's"
            : periodType === 'month' ? "last month's"
            : "last week's";
        const currentLabel = periodType === 'quarter' ? "this quarter's"
            : periodType === 'month' ? "this month's"
            : "this week's";
        if (reverse) return `down from ${priorLabel} ${fmtVal(metricKey, baseVal)} to ${currentLabel} ${fmtVal(metricKey, latestVal)}`;
        return `${priorLabel} ${fmtVal(metricKey, baseVal)} \u2192 ${currentLabel} ${fmtVal(metricKey, latestVal)}`;
    }

    function fmtDelta(metricKey, delta) {
        const unit = window.METRICS_REGISTRY?.[metricKey]?.unit || '';
        const reverse = typeof isReverseMetric === 'function' && isReverseMetric(metricKey);
        const displayDelta = reverse ? -delta : delta;
        const sign = displayDelta > 0 ? '+' : '';
        if (unit === '#') return sign + Math.round(displayDelta).toString();
        if (unit === 'sec') return sign + Math.round(displayDelta) + 's';
        if (unit === 'hrs') return sign + displayDelta.toFixed(1) + ' hrs';
        return sign + displayDelta.toFixed(1) + '%';
    }

    // Turn a list of wins into readable prose: "Adherence at 98.2%",
    // "A at x and B at y", "A at x, B at y, and C at z".
    function joinWinPhrases(list) {
        const parts = (list || []).map(w => `${w.label} at ${fmtVal(w)}`);
        if (parts.length <= 1) return parts[0] || '';
        if (parts.length === 2) return parts.join(' and ');
        return parts.slice(0, -1).join(', ') + ', and ' + parts[parts.length - 1];
    }

    // --- Card rendering ---

    function buildEmployeeCard(emp, analysis, weekDeltas, biggestJump, options = {}) {
        const allMetrics = (analysis.allMetrics || []).filter(m => !PULSE_EXCLUDED_METRICS.includes(m.metricKey));
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
                badColor: metric?.meetsTarget ? '#f9a825' : '#e53935',
                stillOnTarget: !!metric?.meetsTarget
            });
        };

        // Wins section
        let winsHtml = '';
        if (wins.length) {
            winsHtml = wins.map(m => {
                if (m.displayOverride) {
                    return `<div style="font-size:0.85em; color:var(--green-text); padding:2px 0;">` +
                        `<span style="color:var(--text-tertiary);">\u2015</span> ${escapeHtml(m.label)}: <strong>${escapeHtml(m.displayOverride)}</strong></div>`;
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
                        `<span style="color:var(--text-tertiary);">\u2015</span> ${escapeHtml(m.label)}: <strong>${escapeHtml(m.displayOverride)}</strong></div>`;
                }
                const wd = weekDeltas.find(d => d.metricKey === m.metricKey);
                const deltaTag = wd && wd.delta !== 0
                    ? ` <span style="color:${wd.delta > 0 ? 'var(--green-text)' : (m.meetsTarget ? '#f9a825' : 'var(--red-text)')}; font-size:0.85em;">(${fmtDelta(m.metricKey, wd.delta)})</span>`
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
            jumpHtml = `<div style="padding:6px 10px; background:var(--green-soft); border-radius:4px; font-size:0.83em; color:var(--green-text); border-left:3px solid #4caf50;">` +
                `\uD83D\uDE80 <strong>Biggest improvement:</strong> ${escapeHtml(biggestJump.label)} ${fmtDelta(biggestJump.metricKey, biggestJump.delta)} ${deltaContextLabel} ` +
                `(${fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue, periodType)})</div>`;
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
            focalHtml = `<div style="padding:8px; background:#fff3e0; border-radius:4px; border-left:3px solid #ff9800; font-size:0.85em;">` +
                `<strong>\uD83C\uDFAF Focus:</strong> ${escapeHtml(focalPoint.label)} \u2014 last week ${fmtVal(focalPoint)} vs target ${fmtTarget(focalPoint)}${dirLabel}</div>`;
        } else {
            focalHtml = `<div style="padding:8px; background:var(--green-soft); border-radius:4px; border-left:3px solid #4caf50; font-size:0.85em;">` +
                `<strong>\u2705 On track!</strong> Keep up the consistency.</div>`;
        }

        return `<div class="pulse-card" data-employee="${escapeHtml(emp.name)}" style="background:var(--bg-surface); border-radius:8px; border:1px solid var(--border); padding:16px; display:flex; flex-direction:column; gap:10px; transition: box-shadow 0.2s;">` +
            `<div style="display:flex; justify-content:space-between; align-items:center;">` +
                `<div style="font-weight:700; font-size:1.05em; color:var(--text-primary);">${escapeHtml(firstName)}</div>` +
                `<div style="font-size:0.8em; font-weight:600; padding:3px 10px; border-radius:12px; color:${badge.color}; background:${badge.bg};">${badge.icon} ${badge.label}</div>` +
            `</div>` +
            jumpHtml +
            `<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">` +
                `<div><div style="font-weight:600; font-size:0.8em; color:var(--text-secondary); margin-bottom:4px;">Wins</div>${winsHtml}</div>` +
                `<div><div style="font-weight:600; font-size:0.8em; color:var(--text-secondary); margin-bottom:4px;">Opportunities</div>${oppsHtml}</div>` +
            `</div>` +
            focalHtml +
            `<div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-top:auto;">` +
                (periodType === 'week'
                    ? `<button type="button" class="pulse-kickoff-btn" data-employee="${escapeHtml(emp.name)}" ` +
                        `style="background:linear-gradient(135deg, #10b981 0%, #059669 100%); color:white; border:none; border-radius:6px; padding:9px 10px; cursor:pointer; font-weight:bold; font-size:0.82em;">🌟 Mon Kickoff</button>` +
                      `<button type="button" class="pulse-midweek-btn" data-employee="${escapeHtml(emp.name)}" ` +
                        `style="background:linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%); color:white; border:none; border-radius:6px; padding:9px 10px; cursor:pointer; font-weight:bold; font-size:0.82em;">📊 Midweek</button>` +
                      `<button type="button" class="pulse-checkin-btn" data-employee="${escapeHtml(emp.name)}" ` +
                        `style="background:linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%); color:white; border:none; border-radius:6px; padding:9px 10px; cursor:pointer; font-weight:bold; font-size:0.82em;">💬 Check-in</button>` +
                      `<button type="button" class="pulse-highfive-btn" data-employee="${escapeHtml(emp.name)}" ` +
                        `style="background:linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color:white; border:none; border-radius:6px; padding:9px 10px; cursor:pointer; font-weight:bold; font-size:0.82em;">🎉 High-Five</button>` +
                      `<button type="button" class="pulse-growth-btn" data-employee="${escapeHtml(emp.name)}" data-period="${periodType}" ` +
                        `style="grid-column:1/-1; background:linear-gradient(135deg, #16a34a 0%, #15803d 100%); color:white; border:none; border-radius:6px; padding:9px 10px; cursor:pointer; font-weight:bold; font-size:0.82em;">📈 Growth</button>`
                    : `<button type="button" class="pulse-review-btn" data-employee="${escapeHtml(emp.name)}" ` +
                        `style="grid-column:1/-1; background:linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); color:white; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold; font-size:0.9em;">${getReviewButtonLabel(periodType)}</button>` +
                      `<button type="button" class="pulse-growth-btn" data-employee="${escapeHtml(emp.name)}" data-period="${periodType}" ` +
                        `style="grid-column:1/-1; background:linear-gradient(135deg, #16a34a 0%, #15803d 100%); color:white; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold; font-size:0.9em;">📈 Growth Check</button>`) +
            `</div>` +
        `</div>`;
    }

    // --- Check-in message generation ---

    async function generateCheckinMessage(employeeName, latestKey, baselineKey) {
        const period = getPeriodData(latestKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const endDate = getEndDateLabel(latestKey, period);

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};

        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
        if (!analysis) return null;

        const allMetrics = (analysis.allMetrics || []).filter(m => !PULSE_EXCLUDED_METRICS.includes(m.metricKey));

        // Week trajectory
        const weekDeltas = baselineKey ? calcWeekDeltas(employeeName, baselineKey, latestKey) : [];
        const biggestJump = getBiggestJump(weekDeltas);

        const wins = allMetrics
            .filter(m => m.classification === 'Exceeding Expectation' || m.classification === 'On Track')
            .sort((a, b) => {
                if (a.classification !== b.classification) return a.classification === 'Exceeding Expectation' ? -1 : 1;
                const mA = a.targetType === 'min' ? a.employeeValue - a.target : a.target - a.employeeValue;
                const mB = b.targetType === 'min' ? b.employeeValue - b.target : b.target - b.employeeValue;
                return mB - mA;
            })
            .slice(0, 2);

        const ytdMap = getYtdMetricsMapForEmployee(employeeName);
        const focalPoint = pickFocalPointSmart(allMetrics, ytdMap);

        // Build praise — lead with biggest jump if we have trajectory data
        let praiseText = '';
        if (biggestJump && biggestJump.delta > 0) {
            praiseText = pick(JUMP_INTROS)(biggestJump.label, fmtDelta(biggestJump.metricKey, biggestJump.delta), fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue, 'week'));
            if (wins.length > 0 && wins[0].metricKey !== biggestJump.metricKey) {
                praiseText += ` ${pick(PLUS_SOLID)(wins[0].label, fmtVal(wins[0]))}`;
            }
        } else if (wins.length >= 2) {
            praiseText = pick(TWO_WINS)(wins[0].label, fmtVal(wins[0]), wins[1].label, fmtVal(wins[1]));
        } else if (wins.length === 1) {
            praiseText = pick(ONE_WIN)(wins[0].label, fmtVal(wins[0]));
        } else {
            praiseText = pick(NO_WINS);
        }

        // Build focus with tip
        let focusText = '';
        if (focalPoint) {
            const metricKey = focalPoint.metricKey;
            let tipText = '';
            try {
                const allTips = typeof loadServerTips === 'function' ? await loadServerTips() : {};
                const metricTips = allTips[metricKey] || [];
                if (metricTips.length > 0) {
                    const tip = typeof selectSmartTip === 'function'
                        ? selectSmartTip({ employeeId: employeeName, metricKey, severity: 'medium', tips: metricTips })
                        : metricTips[Math.floor(Math.random() * metricTips.length)];
                    if (tip) tipText = tip;
                }
            } catch (e) { /* no tips */ }

            focusText = `\uD83C\uDFAF ${buildFocalText(focalPoint, { persistent: FOCUS_PERSISTENT, ytdOnly: FOCUS_YTD_ONLY, weekDip: FOCUS_WEEK_DIP, fallback: FOCUS_FALLBACK })}`;
            if (tipText) {
                const cleanTip = tipText.replace(/^(Practice this|Try this|Tip|Focus on this)\s*:\s*/i, '').trim();
                focusText += ` \uD83D\uDCA1 ${cleanTip.charAt(0).toUpperCase() + cleanTip.slice(1)}`;
            }
        }

        let message = `${pick(GREETINGS)(firstName)} \uD83D\uDC4B ${pick(DATA_IN)(endDate)} ${praiseText}`;
        if (focusText) message += `\n\n${focusText}`;
        message += `\n\n${pick(CLOSERS)}`;

        return message;
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
        const shape = NOT_A_WEEK[period?.metadata?.periodType];
        if (shape) return shape;

        const endIso = period?.metadata?.endDate
            || (latestKey && latestKey.indexOf('|') > -1 ? latestKey.split('|')[1] : latestKey)
            || '';

        // No end date to judge by means no claim worth making — the in-flight
        // wording is what the message has always used, so fall back to it.
        if (!endIso || endIso >= iso(monday)) return { when: 'this week', prior: 'last week' };
        if (endIso >= iso(priorMonday)) return { when: 'last week', prior: 'two weeks ago' };
        return { when: `the week ending ${getEndDateLabel(latestKey, period)}`, prior: 'the week before' };
    }

    // options.now lets a caller (and the tests) pin the day the copy is written
    // for instead of whatever day the machine happens to be on.
    async function generateHighFiveMessage(employeeName, latestKey, baselineKey, options) {
        const period = getPeriodData(latestKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};

        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
        if (!analysis) return null;

        const allMetrics = (analysis.allMetrics || []).filter(m => !PULSE_EXCLUDED_METRICS.includes(m.metricKey));
        const weekDeltas = baselineKey ? calcWeekDeltas(employeeName, baselineKey, latestKey) : [];
        const biggestJump = getBiggestJump(weekDeltas);

        // Get all wins sorted by how far above target
        const wins = allMetrics
            .filter(m => m.classification === 'Exceeding Expectation' || m.classification === 'On Track')
            .sort((a, b) => {
                if (a.classification !== b.classification) return a.classification === 'Exceeding Expectation' ? -1 : 1;
                const mA = a.targetType === 'min' ? a.employeeValue - a.target : a.target - a.employeeValue;
                const mB = b.targetType === 'min' ? b.employeeValue - b.target : b.target - b.employeeValue;
                return mB - mA;
            });

        // Build the celebration — no coaching, no focus areas, pure praise
        const weekendClose = weekendIsInReach(options?.now);
        const recency = describeWeekRecency(latestKey, period, options?.now);
        let message = pick(weekendClose ? HF_OPENERS.concat(HF_OPENERS_WEEKEND) : HF_OPENERS)(firstName);
        const namedWins = new Set();

        if (biggestJump && biggestJump.delta > 0) {
            const range = fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue, 'week', recency);
            message += ` ${pick(HF_JUMP)(biggestJump.label, fmtDelta(biggestJump.metricKey, biggestJump.delta), range, recency.when)} \uD83D\uDD25`;
            namedWins.add(biggestJump.metricKey);
        } else if (wins.length >= 2) {
            message += ` ${pick(HF_TWO_WINS)(wins[0].label, fmtVal(wins[0]), wins[1].label, fmtVal(wins[1]), recency.when)} \uD83D\uDD25\uD83D\uDCAA`;
            namedWins.add(wins[0].metricKey);
            namedWins.add(wins[1].metricKey);
        } else if (wins.length === 1) {
            message += ` ${pick(HF_ONE_WIN)(wins[0].label, fmtVal(wins[0]), recency.when)} \uD83D\uDD25`;
            namedWins.add(wins[0].metricKey);
        } else {
            message += ` ${pick(HF_NO_WINS)(recency.when)} \uD83D\uDCAA`;
        }

        // Name every remaining win, not just the next couple \u2014 a strong
        // week should get credited in full.
        const extraWins = wins.filter(w => !namedWins.has(w.metricKey));
        if (extraWins.length > 0) {
            message += ` ${pick(HF_EXTRAS)(joinWinPhrases(extraWins))}`;
        }

        // Count how many metrics are on track
        const onTrackCount = allMetrics.filter(m => m.meetsTarget).length;
        if (onTrackCount >= allMetrics.length * 0.7 && allMetrics.length > 3) {
            message += `\n\n${pick(HF_CONSISTENCY)(onTrackCount, allMetrics.length)} \u2B50`;
        }

        // Ahead of the sign-off, so the message still closes on the praise.
        const closeBy = nearMissLine(employeeName, latestKey);
        if (closeBy) message += `\n\n${closeBy}`;

        message += `\n\n${pick(weekendClose ? HF_CLOSERS.concat(HF_CLOSERS_WEEKEND) : HF_CLOSERS)} \uD83D\uDE80`;

        return message;
    }

    // --- Focal point persistence ---
    const FOCAL_STORAGE_KEY = (window.DevCoachConstants?.STORAGE_PREFIX || 'devCoachingTool_') + 'weeklyFocalPoints';

    function saveFocalPoint(employeeName, weekKey, focalMetricKey, focalLabel, focalValue, focalTarget) {
        try {
            const raw = localStorage.getItem(FOCAL_STORAGE_KEY);
            const all = raw ? JSON.parse(raw) : {};
            if (!all[weekKey]) all[weekKey] = {};
            all[weekKey][employeeName] = {
                metricKey: focalMetricKey,
                label: focalLabel,
                value: focalValue,
                target: focalTarget,
                setDate: window.DevCoachModules?.sharedUtils?.formatLocalDate?.() || new Date().toISOString().slice(0, 10)
            };
            localStorage.setItem(FOCAL_STORAGE_KEY, JSON.stringify(all));
        } catch (e) { /* storage full or unavailable */ }
    }

    function loadFocalPoint(employeeName, weekKey) {
        try {
            const raw = localStorage.getItem(FOCAL_STORAGE_KEY);
            if (!raw) return null;
            const all = JSON.parse(raw);
            return all[weekKey]?.[employeeName] || null;
        } catch (e) { return null; }
    }

    // --- Monday Kickoff message generation ---

    async function generateMondayKickoffMessage(employeeName, latestKey, baselineKey) {
        const period = getPeriodData(latestKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};

        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
        if (!analysis) return null;

        const allMetrics = (analysis.allMetrics || []).filter(m => !PULSE_EXCLUDED_METRICS.includes(m.metricKey));
        const weekDeltas = baselineKey ? calcWeekDeltas(employeeName, baselineKey, latestKey) : [];

        // If any survey metric came back as a detractor (0), suppress the rest
        // of the survey wins from the same sample — FCR=100 with OE=0 is still
        // a detractor, not a win worth celebrating.
        const kickoffHasDetractorSurveys = allMetrics.some(m =>
            SURVEY_METRIC_KEYS.has(m.metricKey)
            && Number.isFinite(m.employeeValue)
            && m.employeeValue === 0
        );

        // Only when Overall Sentiment is *exceptional* (Exceeding Expectation —
        // not merely On Track) do we suppress the individual sentiment drivers
        // so the kickoff leads with the headline metric. If Overall Sentiment
        // is just on track, let positiveWord/negativeWord/managingEmotions
        // surface normally so we can still celebrate the specific drivers.
        const KICKOFF_INDIVIDUAL_SENTIMENT = new Set(['positiveWord', 'negativeWord', 'managingEmotions']);
        const kickoffHasExceptionalOverallSentiment = allMetrics.some(m =>
            m.metricKey === 'overallSentiment' && m.classification === 'Exceeding Expectation'
        );
        const allWinsSorted = allMetrics
            .filter(m => m.classification === 'Exceeding Expectation' || m.classification === 'On Track')
            .filter(m => !(kickoffHasDetractorSurveys && SURVEY_METRIC_KEYS.has(m.metricKey)))
            .filter(m => !(kickoffHasExceptionalOverallSentiment && KICKOFF_INDIVIDUAL_SENTIMENT.has(m.metricKey)))
            .sort((a, b) => {
                if (a.classification !== b.classification) return a.classification === 'Exceeding Expectation' ? -1 : 1;
                const mA = a.targetType === 'min' ? a.employeeValue - a.target : a.target - a.employeeValue;
                const mB = b.targetType === 'min' ? b.employeeValue - b.target : b.target - b.employeeValue;
                return mB - mA;
            });
        const wins = allWinsSorted.slice(0, 3);

        // Keep the biggest WoW jump unfiltered — celebrating "Positive Words
        // +5%" or "Managing Emotions +3%" is a great improvement story that
        // Scott wants to see even when Overall Sentiment is exceptional.
        const biggestJump = getBiggestJump(weekDeltas);

        const ytdMap = getYtdMetricsMapForEmployee(employeeName);
        const focalPoint = pickFocalPointSmart(allMetrics, ytdMap);

        // When two or more survey metrics are at 100%, call it out as
        // "X perfect surveys" instead of listing each survey metric individually.
        // Look across *all* wins (not just the top 3) so a non-survey win
        // like positive words can still be paired with perfect surveys even
        // when 3+ survey metrics would otherwise crowd out the slice.
        const allPerfectSurveyWins = allWinsSorted.filter(w =>
            SURVEY_METRIC_KEYS.has(w.metricKey)
            && Number.isFinite(w.employeeValue)
            && w.employeeValue >= 100
        );
        const surveyCount = parseInt(emp?.surveyTotal, 10);
        const hasPerfectSurveys = allPerfectSurveyWins.length >= 2 && Number.isFinite(surveyCount) && surveyCount >= 3;
        const surveysText = hasPerfectSurveys
            ? `${surveyCount} survey${surveyCount === 1 ? '' : 's'}`
            : '';
        const nonPerfectSurveyWins = hasPerfectSurveys
            ? allWinsSorted.filter(w => !allPerfectSurveyWins.includes(w))
            : wins;

        // CELEBRATION section — lead with wins
        let praiseText = '';
        const namedWins = new Set();
        if (hasPerfectSurveys) {
            // The perfect-surveys line speaks for every survey metric at 100.
            allPerfectSurveyWins.forEach(w => namedWins.add(w.metricKey));
            const secondWin = nonPerfectSurveyWins[0];
            if (secondWin) {
                praiseText = pick(PERFECT_SURVEYS_PLUS)(surveysText, secondWin.label, fmtVal(secondWin));
                namedWins.add(secondWin.metricKey);
            } else {
                praiseText = pick(PERFECT_SURVEYS_SOLO)(surveysText);
            }
        } else if (biggestJump && biggestJump.delta > 0) {
            praiseText = pick(JUMP_INTROS)(biggestJump.label, fmtDelta(biggestJump.metricKey, biggestJump.delta), fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue, 'week'));
            namedWins.add(biggestJump.metricKey);
            const otherWins = wins.filter(w => w.metricKey !== biggestJump.metricKey).slice(0, 1);
            if (otherWins.length > 0) {
                praiseText += ` ${pick(PLUS_SOLID)(otherWins[0].label, fmtVal(otherWins[0]))}`;
                namedWins.add(otherWins[0].metricKey);
            }
        } else if (wins.length >= 2) {
            praiseText = pick(TWO_WINS)(wins[0].label, fmtVal(wins[0]), wins[1].label, fmtVal(wins[1]));
            namedWins.add(wins[0].metricKey);
            namedWins.add(wins[1].metricKey);
        } else if (wins.length === 1) {
            praiseText = pick(ONE_WIN)(wins[0].label, fmtVal(wins[0]));
            namedWins.add(wins[0].metricKey);
        } else {
            praiseText = pick(NO_WINS);
        }

        // Credit the rest of the wins too. `wins` is only the top slice, so
        // work off the full sorted list — a week with five metrics at target
        // should say so instead of stopping at the lead sentence.
        const remainingWins = allWinsSorted.filter(w => !namedWins.has(w.metricKey));
        if (remainingWins.length > 0) {
            praiseText += ` ${pick(HF_EXTRAS)(joinWinPhrases(remainingWins))}`;
        }

        // FOCUS section — set the weekly focal point
        let focusText = '';
        if (focalPoint) {
            const focalPhrase = buildFocalText(focalPoint, { persistent: MK_FOCUS_PERSISTENT, ytdOnly: MK_FOCUS_YTD_ONLY, weekDip: MK_FOCUS_WEEK_DIP, fallback: MK_FOCUS_FALLBACK });
            focusText = `\n\n${pick(MK_TRANSITION)}\n\n🎯 ${focalPhrase}`;

            // Fetch a tip for the focal metric
            try {
                const allTips = typeof loadServerTips === 'function' ? await loadServerTips() : {};
                const metricTips = allTips[focalPoint.metricKey] || [];
                if (metricTips.length > 0) {
                    const tip = typeof selectSmartTip === 'function'
                        ? selectSmartTip({ employeeId: employeeName, metricKey: focalPoint.metricKey, severity: 'medium', tips: metricTips })
                        : metricTips[Math.floor(Math.random() * metricTips.length)];
                    if (tip) {
                        const cleanTip = tip.replace(/^(Practice this|Try this|Tip|Focus on this)\s*:\s*/i, '').trim();
                        focusText += ` 💡 ${cleanTip.charAt(0).toUpperCase() + cleanTip.slice(1)}`;
                    }
                }
            } catch (e) { /* no tips */ }

            // Persist the focal point for midweek recall
            saveFocalPoint(employeeName, latestKey, focalPoint.metricKey, focalPoint.label, focalPoint.employeeValue, focalPoint.target);
        } else {
            focusText = `\n\n${pick(MK_ALL_GOOD)}`;
        }

        const yearBlock = buildYearStandingBlock(employeeName, allMetrics);
        let message = `${pick(MK_OPENERS)(firstName)} ${praiseText}${focusText}`;
        if (yearBlock) message += `\n\n${yearBlock}`;
        message += `\n\n${pick(MK_CLOSERS)}`;
        return message;
    }

    /**
     * Whether they are gaining or losing ground on the floor this year.
     *
     * Ranks decide the direction and are then discarded — associates see which
     * way they are moving, never where they sit. A number would have them
     * comparing themselves to a colleague; a direction has them moving.
     */
    function buildYearStandingBlock(employeeName, allMetrics) {
        const standing = window.DevCoachModules?.yearStanding;
        if (!standing?.gatherYearMovement) return '';

        const movement = standing.gatherYearMovement(employeeName);
        if (!movement) return '';

        // Rank keys differ from registry keys, so map back to the metric name
        // the associate would actually recognise.
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

        const byKey = {};
        (allMetrics || []).forEach(m => { byKey[m.metricKey] = m; });

        const entries = [];
        Object.keys(RANK_TO_METRIC).forEach(rankKey => {
            const metricKey = RANK_TO_METRIC[rankKey];
            const move = standing.classifyMovement(movement.earlier[rankKey], movement.current[rankKey], movement.fieldSize);
            if (!move || move === 'holding') return;

            const metric = byKey[metricKey];
            entries.push({
                label: window.METRICS_REGISTRY?.[metricKey]?.label || metricKey,
                valueText: metric ? fmtVal(metric) : '',
                targetText: metric ? fmtTarget(metric) : '',
                movement: move
            });
        });

        if (!entries.length) return '';

        // Lead with what slipped — that is the part with months left to fix.
        entries.sort((a, b) => (b.movement === 'slipping' ? 1 : 0) - (a.movement === 'slipping' ? 1 : 0));

        return standing.buildYearStandingText(entries, {
            limit: 3,
            pick,
            closer: standing.urgencyLine(new Date())
        });
    }

    // --- Week-progress message (Wed/Thu midweek, Fri closing) ---

    /**
     * Where this week stands against last week, in numbers.
     *
     * calcWeekDeltas already normalises direction — a positive delta is an
     * improvement whether the metric wants to go up or down — so this is
     * mostly a matter of deciding what cleared the noise and saying it.
     */
    async function generateWeekProgressMessage(employeeName, latestKey, baselineKey, options = {}) {
        const outreach = window.DevCoachModules?.dailyOutreach;
        if (!outreach?.buildWeekProgressText) return null;

        const period = getPeriodData(latestKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const deltas = baselineKey ? calcWeekDeltas(employeeName, baselineKey, latestKey) : [];
        const hasBaseline = deltas.length > 0;

        // Same noise floor the growth view uses, so "improved" means the same
        // thing wherever it is claimed.
        const clears = (d) => {
            const floor = typeof getGrowthNoiseThreshold === 'function' ? getGrowthNoiseThreshold(d.metricKey) : 0;
            return d.absDelta >= floor;
        };

        const improved = deltas.filter(d => d.delta > 0 && clears(d))
            .sort((a, b) => b.absDelta - a.absDelta)
            .slice(0, 3)
            .map(d => ({ label: d.label, deltaText: fmtDelta(d.metricKey, d.delta) }));

        const slipped = deltas.filter(d => d.delta < 0 && clears(d))
            .sort((a, b) => b.absDelta - a.absDelta)
            .slice(0, 2)
            .map(d => ({ label: d.label, deltaText: fmtDelta(d.metricKey, d.delta) }));

        // Lead the standings with whatever moved most; that is the part worth
        // reading, and it keeps the line short enough to actually be read.
        const standings = deltas
            .slice()
            .sort((a, b) => b.absDelta - a.absDelta)
            .slice(0, 4)
            .map(d => ({
                label: d.label,
                latestText: fmtVal(d.metricKey, d.latestValue),
                baseText: fmtVal(d.metricKey, d.baseValue)
            }));

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};
        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
        const allMetrics = (analysis?.allMetrics || []).filter(m => !PULSE_EXCLUDED_METRICS.includes(m.metricKey));
        const focal = pickFocalPointSmart(allMetrics, getYtdMetricsMapForEmployee(employeeName));

        // If nothing was comparable, still report where they stand.
        const fallbackStandings = standings.length ? standings : allMetrics.slice(0, 3).map(m => ({
            label: m.label,
            latestText: fmtVal(m),
            baseText: ''
        }));

        return outreach.buildWeekProgressText({
            firstName,
            tone: options.tone === 'closing' ? 'closing' : 'midweek',
            daysIn: Number.isFinite(options.daysIn) ? options.daysIn : 0,
            hasBaseline,
            thisWeek: options.latestIsThisWeek !== false,
            standings: fallbackStandings,
            improved,
            slipped,
            focus: focal ? { label: focal.label, valueText: fmtVal(focal), targetText: fmtTarget(focal) } : null
        });
    }

    // --- Midweek Check-In message generation ---

    async function generateMidweekCheckinMessage(employeeName, latestKey, baselineKey) {
        const period = getPeriodData(latestKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};

        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
        if (!analysis) return null;

        const allMetrics = (analysis.allMetrics || []).filter(m => !PULSE_EXCLUDED_METRICS.includes(m.metricKey));

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
                const reverse = typeof isReverseMetric === 'function' && isReverseMetric(focalMetric.metricKey);
                const gap = Math.abs(focalMetric.employeeValue - focalMetric.target);
                const gapStr = fmtVal(focalMetric.metricKey, gap);

                // Determine if close (within 20% of target)
                const closeThreshold = focalMetric.target * 0.2;
                const isClose = gap <= closeThreshold && !meetsTarget;

                if (meetsTarget) {
                    message += ` ${pick(MW_ON_TRACK)(savedFocal.label, currentVal, targetVal)}`;
                } else if (isClose) {
                    message += ` ${pick(MW_CLOSE)(savedFocal.label, currentVal, targetVal, gapStr)}`;
                } else {
                    message += `\n\n${pick(MW_BEHIND)(savedFocal.label, currentVal, targetVal, gapStr)}`;

                    // Add a tip for the struggling metric
                    try {
                        const allTips = typeof loadServerTips === 'function' ? await loadServerTips() : {};
                        const metricTips = allTips[focalMetric.metricKey] || [];
                        if (metricTips.length > 0) {
                            const tip = typeof selectSmartTip === 'function'
                                ? selectSmartTip({ employeeId: employeeName, metricKey: focalMetric.metricKey, severity: 'high', tips: metricTips })
                                : metricTips[Math.floor(Math.random() * metricTips.length)];
                            if (tip) {
                                const cleanTip = tip.replace(/^(Practice this|Try this|Tip|Focus on this)\s*:\s*/i, '').trim();
                                message += ` ${pick(MW_TIP_PREFIXES)} ${cleanTip.charAt(0).toUpperCase() + cleanTip.slice(1)}`;
                            }
                        }
                    } catch (e) { /* no tips */ }
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

            // Mention a win if there is one
            const wins = allMetrics.filter(m => m.classification === 'Exceeding Expectation' || m.classification === 'On Track');
            if (wins.length > 0) {
                const topWin = wins[0];
                message += pick(MW_BRIGHT_SIDE)(topWin.label, fmtVal(topWin));
            }
        }

        message += `\n\n${pick(MW_CLOSERS)}`;
        return message;
    }

    // --- Monthly check-in message generation ---

    async function generateMonthlyCheckinMessage(employeeName, monthKey, prevMonthKey) {
        return generatePeriodReviewMessage(employeeName, monthKey, prevMonthKey, 'month');
    }

    async function generateQuarterlyCheckinMessage(employeeName, quarterKey, prevQuarterKey) {
        return generatePeriodReviewMessage(employeeName, quarterKey, prevQuarterKey, 'quarter');
    }

    async function generatePeriodReviewMessage(employeeName, periodKey, prevPeriodKey, periodType) {
        const period = getPeriodData(periodKey);
        const emp = period?.employees?.find(e => e.name === employeeName);
        if (!emp) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const periodName = periodType === 'quarter' ? getQuarterName(periodKey) : getMonthName(periodKey);
        const reviewCopy = periodType === 'quarter'
            ? {
                greetings: QTR_GREETINGS,
                jump: QTR_JUMP,
                twoWins: QTR_TWO_WINS,
                oneWin: QTR_ONE_WIN,
                noWins: QTR_NO_WINS,
                focus: QTR_FOCUS,
                consistency: QTR_CONSISTENCY,
                closers: QTR_CLOSERS
            }
            : {
                greetings: MO_GREETINGS,
                jump: MO_JUMP,
                twoWins: MO_TWO_WINS,
                oneWin: MO_ONE_WIN,
                noWins: MO_NO_WINS,
                focus: MO_FOCUS,
                consistency: MO_CONSISTENCY,
                closers: MO_CLOSERS
            };

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(periodKey) || {}
            : {};

        const analysis = analyzeCurrentSnapshot(emp, centerAvgs, periodKey);
        if (!analysis) return null;

        const allMetrics = (analysis.allMetrics || []).filter(m => !PULSE_EXCLUDED_METRICS.includes(m.metricKey));
        const periodDeltas = prevPeriodKey ? calcWeekDeltas(employeeName, prevPeriodKey, periodKey) : [];
        const biggestJump = getBiggestJump(periodDeltas);

        const wins = allMetrics
            .filter(m => m.classification === 'Exceeding Expectation' || m.classification === 'On Track')
            .sort((a, b) => {
                if (a.classification !== b.classification) return a.classification === 'Exceeding Expectation' ? -1 : 1;
                const mA = a.targetType === 'min' ? a.employeeValue - a.target : a.target - a.employeeValue;
                const mB = b.targetType === 'min' ? b.employeeValue - b.target : b.target - b.employeeValue;
                return mB - mA;
            })
            .slice(0, 3);

        const focalPoint = pickFocalPoint(allMetrics);

        let praiseText = '';
        if (biggestJump && biggestJump.delta > 0) {
            praiseText = pick(reviewCopy.jump)(biggestJump.label, fmtDelta(biggestJump.metricKey, biggestJump.delta), fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue, periodType));
            if (wins.length > 0 && wins[0].metricKey !== biggestJump.metricKey) {
                praiseText += ` ${pick(PLUS_SOLID)(wins[0].label, fmtVal(wins[0]))}`;
            }
        } else if (wins.length >= 2) {
            praiseText = pick(reviewCopy.twoWins)(wins[0].label, fmtVal(wins[0]), wins[1].label, fmtVal(wins[1]));
        } else if (wins.length === 1) {
            praiseText = pick(reviewCopy.oneWin)(wins[0].label, fmtVal(wins[0]));
        } else {
            praiseText = pick(reviewCopy.noWins);
        }

        const onTrackCount = allMetrics.filter(m => m.meetsTarget).length;
        let consistencyText = '';
        if (allMetrics.length > 3) {
            consistencyText = pick(reviewCopy.consistency)(onTrackCount, allMetrics.length);
        }

        let focusText = '';
        if (focalPoint) {
            const metricKey = focalPoint.metricKey;
            let tipText = '';
            try {
                const allTips = typeof loadServerTips === 'function' ? await loadServerTips() : {};
                const metricTips = allTips[metricKey] || [];
                if (metricTips.length > 0) {
                    const tip = typeof selectSmartTip === 'function'
                        ? selectSmartTip({ employeeId: employeeName, metricKey, severity: 'medium', tips: metricTips })
                        : metricTips[Math.floor(Math.random() * metricTips.length)];
                    if (tip) tipText = tip;
                }
            } catch (e) { /* no tips */ }

            focusText = `🎯 ${pick(reviewCopy.focus)(focalPoint.label, fmtVal(focalPoint), fmtTarget(focalPoint))}`;
            if (tipText) {
                const cleanTip = tipText.replace(/^(Practice this|Try this|Tip|Focus on this)\s*:\s*/i, '').trim();
                focusText += ` 💡 ${cleanTip.charAt(0).toUpperCase() + cleanTip.slice(1)}`;
            }
        }

        let message = `${pick(reviewCopy.greetings)(firstName, periodName)} ${praiseText}`;
        if (consistencyText) message += `\n\n${consistencyText}`;
        if (focusText) message += `\n\n${focusText}`;
        message += `\n\n${pick(reviewCopy.closers)}`;

        return message;
    }

    // --- Growth message generation (WoW / MoM / QoQ / YTD) ---

    const GROWTH_COMPARISON_TYPES = ['wow', 'mom', 'qoq', 'ytd'];

    const GROWTH_LABELS = {
        wow: { short: 'WoW', long: 'week over week', currentNoun: 'this week', priorNoun: 'last week' },
        mom: { short: 'MoM', long: 'month over month', currentNoun: 'this month', priorNoun: 'last month' },
        qoq: { short: 'QoQ', long: 'quarter over quarter', currentNoun: 'this quarter', priorNoun: 'last quarter' },
        ytd: { short: 'YTD', long: 'year to date', currentNoun: 'this YTD snapshot', priorNoun: 'your prior YTD snapshot' }
    };

    const GROWTH_GREETINGS = [
        (name, longLabel) => `Hey ${name}! 📈 Pulled your ${longLabel} growth — wanted to share what stood out.`,
        (name, longLabel) => `${name}! Got your ${longLabel} numbers in front of me, here's how you're trending.`,
        (name, longLabel) => `Morning ${name}! Quick ${longLabel} growth check for you.`,
        (name, longLabel) => `${name}, taking a look at ${longLabel} for you — here's the rundown.`,
        (name, longLabel) => `Hey ${name}! Wanted to share your ${longLabel} trajectory.`,
        (name, longLabel) => `${name}! Sat down with your ${longLabel} numbers, here's what I saw.`
    ];

    const GROWTH_RANGE_LINE = [
        (currentLabel, priorLabel) => `Comparing ${currentLabel} to ${priorLabel}:`,
        (currentLabel, priorLabel) => `Looking at ${priorLabel} → ${currentLabel}:`,
        (currentLabel, priorLabel) => `Side-by-side: ${priorLabel} vs ${currentLabel}.`
    ];

    const GROWTH_NO_MOVE = [
        `Your numbers held pretty steady — no big swings either direction.`,
        `Things have been holding flat — nothing major moved.`,
        `Numbers stayed mostly level — no big movement to call out.`
    ];

    const GROWTH_CLOSERS = [
        `Keep climbing! 🚀`,
        `Proud of the trajectory — let's keep it going.`,
        `Great direction. Keep stacking the wins.`,
        `Solid effort showing up in the numbers.`,
        `Excited to see where you take it next.`
    ];

    // Used when nothing improved. "Keep climbing!" under a wall of red reads
    // like nobody actually looked at the numbers.
    const GROWTH_REGROUP_CLOSERS = [
        `One stretch doesn't define you — let's pick one thing and go after it together.`,
        `Everybody has a period like this. Let's talk through what got in the way.`,
        `I'm not worried — let's focus on one metric and build from there.`,
        `Let's regroup on this one. Pick the focus area above and we'll work it together.`
    ];

    const GROWTH_HOLDING_INTRO = [
        `Still solid ✅`,
        `Holding strong ✅`,
        `Didn't slip ✅`
    ];

    function getGrowthComparisonContext(comparisonType) {
        if (comparisonType === 'wow') {
            const keys = getPeriodKeys('week');
            if (keys.length < 2) return null;
            const latestKey = keys[keys.length - 1];
            const baselineKey = keys[keys.length - 2];
            return {
                comparisonType,
                latestKey,
                baselineKey,
                currentLabel: `the week of ${getPeriodDisplayLabel('week', latestKey)}`,
                priorLabel: `the week of ${getPeriodDisplayLabel('week', baselineKey)}`,
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
                currentLabel: getMonthName(latestKey),
                priorLabel: getMonthName(baselineKey),
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
            const fmtYtd = (key) => {
                const meta = ytd[key]?.metadata?.endDate;
                if (meta && typeof formatDateMMDDYYYY === 'function') return formatDateMMDDYYYY(meta);
                return meta || key;
            };
            return {
                comparisonType,
                latestKey,
                baselineKey,
                currentLabel: `YTD as of ${fmtYtd(latestKey)}`,
                priorLabel: `prior YTD snapshot (${fmtYtd(baselineKey)})`,
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

    function computeGrowthDeltas(latestEmp, baselineEmp) {
        const registry = typeof METRICS_REGISTRY !== 'undefined' ? METRICS_REGISTRY : {};
        const out = [];
        Object.keys(registry).filter(k => !PULSE_EXCLUDED_METRICS.includes(k)).forEach(metricKey => {
            const baseVal = parseFloat(baselineEmp[metricKey]);
            const latestVal = parseFloat(latestEmp[metricKey]);
            if (!Number.isFinite(baseVal) || !Number.isFinite(latestVal)) return;
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

    function pickGrowthFocalPoint(latestEmp, analysisPeriodType, latestKey) {
        const analyzeFn = window.DevCoachModules?.metricTrends?.analyzeTrendMetrics
            || window.analyzeTrendMetrics;
        if (!analyzeFn) return null;
        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};
        const analysis = analyzeFn(latestEmp, centerAvgs, null, null, {
            employeeName: latestEmp.name,
            weekKey: latestKey,
            periodType: analysisPeriodType
        });
        const allMetrics = (analysis?.allMetrics || []).filter(m => !PULSE_EXCLUDED_METRICS.includes(m.metricKey));
        return pickFocalPoint(allMetrics);
    }

    async function generateGrowthMessage(employeeName, comparisonType) {
        const ctx = getGrowthComparisonContext(comparisonType);
        if (!ctx) return null;

        const latestEmp = getEmployeeFromAnyPeriod(ctx.latestKey, employeeName);
        const baselineEmp = getEmployeeFromAnyPeriod(ctx.baselineKey, employeeName);
        if (!latestEmp || !baselineEmp) return null;

        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const labelInfo = GROWTH_LABELS[comparisonType];
        const deltas = computeGrowthDeltas(latestEmp, baselineEmp);
        const improvements = deltas.filter(d => d.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
        const declines = deltas.filter(d => d.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 2);

        let message = `${pick(GROWTH_GREETINGS)(firstName, labelInfo.long)}\n\n`;
        message += `${pick(GROWTH_RANGE_LINE)(ctx.currentLabel, ctx.priorLabel)}`;

        if (improvements.length === 0 && declines.length === 0) {
            message += `\n\n${pick(GROWTH_NO_MOVE)}`;
        } else {
            if (improvements.length) {
                message += `\n\nGrowing 🚀`;
                improvements.forEach(d => {
                    message += `\n• ${d.label}: ${fmtDelta(d.metricKey, d.delta)} (${fmtVal(d.metricKey, d.baseValue)} → ${fmtVal(d.metricKey, d.latestValue)})`;
                });
            }
            if (declines.length) {
                message += `\n\nSlipped a bit 🔻`;
                declines.forEach(d => {
                    message += `\n• ${d.label}: ${fmtDelta(d.metricKey, d.delta)} (${fmtVal(d.metricKey, d.baseValue)} → ${fmtVal(d.metricKey, d.latestValue)})`;
                });
            }
        }

        // Nothing improved. Don't send an all-red message with no positive in
        // it — surface what they held at target so the note is honest but fair.
        if (improvements.length === 0) {
            const steady = computeSteadyAtTarget(latestEmp, baselineEmp).slice(0, 3);
            if (steady.length) {
                message += `\n\n${pick(GROWTH_HOLDING_INTRO)}`;
                steady.forEach(s => {
                    message += `\n• ${s.label}: still at ${fmtVal(s.metricKey, s.latestValue)}`;
                });
            }
        }

        const focalPoint = pickGrowthFocalPoint(latestEmp, ctx.analysisPeriodType, ctx.latestKey);
        if (focalPoint) {
            let tipText = '';
            try {
                const allTips = typeof loadServerTips === 'function' ? await loadServerTips() : {};
                const metricTips = allTips[focalPoint.metricKey] || [];
                if (metricTips.length > 0) {
                    const tip = typeof selectSmartTip === 'function'
                        ? selectSmartTip({ employeeId: employeeName, metricKey: focalPoint.metricKey, severity: 'medium', tips: metricTips })
                        : metricTips[Math.floor(Math.random() * metricTips.length)];
                    if (tip) tipText = tip;
                }
            } catch (e) { /* no tips */ }

            message += `\n\n🎯 Focus area: ${focalPoint.label} sitting at ${fmtVal(focalPoint)} vs target ${fmtTarget(focalPoint)}.`;
            if (tipText) {
                const cleanTip = tipText.replace(/^(Practice this|Try this|Tip|Focus on this)\s*:\s*/i, '').trim();
                message += ` 💡 ${cleanTip.charAt(0).toUpperCase() + cleanTip.slice(1)}`;
            }
        }

        // Only swap to the regroup tone when things actually went backwards —
        // a flat period is not a "let's regroup" conversation.
        const wentBackwards = improvements.length === 0 && declines.length > 0;
        message += `\n\n${pick(wentBackwards ? GROWTH_REGROUP_CLOSERS : GROWTH_CLOSERS)}`;
        return message;
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
            const baseStyle = 'border:1px solid #cbd5e1; border-radius:6px; padding:8px 14px; font-weight:bold; font-size:0.85em; cursor:pointer;';
            const activeStyle = 'background:linear-gradient(135deg,#10b981,#059669); color:#fff; border-color:transparent;';
            const inactiveStyle = 'background:#fff; color:#334155;';
            const disabledStyle = 'background:#f1f5f9; color:#94a3b8; cursor:not-allowed;';
            const style = !enabled ? `${baseStyle} ${disabledStyle}` : isActive ? `${baseStyle} ${activeStyle}` : `${baseStyle} ${inactiveStyle}`;
            const disabledAttr = enabled ? '' : ' disabled';
            return `<button type="button" class="growth-period-btn" data-comparison="${type}" style="${style}"${disabledAttr}>${GROWTH_LABELS[type].short}</button>`;
        }).join('');

        overlay.innerHTML = `<div style="background:var(--bg-surface); border-radius:12px; max-width:600px; width:100%; max-height:85vh; overflow-y:auto; padding:24px; box-shadow:0 20px 60px rgba(0,0,0,0.3);">` +
            `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">` +
                `<h3 style="margin:0; color:#1a237e;">📈 Growth check for ${escapeHtml(firstName)}</h3>` +
                `<button id="pulseGrowthClose" style="background:none; border:none; font-size:1.4em; cursor:pointer; color:var(--text-tertiary); padding:4px 8px;">✕</button>` +
            `</div>` +
            `<div style="font-size:0.85em; color:var(--text-secondary); margin-bottom:8px;">Pick a comparison period:</div>` +
            `<div id="pulseGrowthPeriods" style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:14px;">${periodBtns}</div>` +
            `<textarea id="pulseGrowthText" style="width:100%; height:240px; padding:14px; border:1px solid var(--border); border-radius:6px; font-size:0.95em; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">⏳ Generating…</textarea>` +
            `<div style="display:flex; gap:10px; margin-top:14px;">` +
                `<button id="pulseGrowthCopy" style="flex:1; background:linear-gradient(135deg,#10b981,#059669); color:white; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">📋 Copy to Clipboard</button>` +
                `<button id="pulseGrowthRegenerate" style="flex:1; background:var(--bg-surface-raised); color:var(--text-primary); border:1px solid var(--border); border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">🔄 Regenerate</button>` +
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
                textarea.value = 'Could not build a growth message — check console for details.';
                console.error('growth message error', e);
            }
        }

        function updatePeriodHighlight() {
            overlay.querySelectorAll('.growth-period-btn').forEach(btn => {
                if (btn.disabled) return;
                const isActive = btn.dataset.comparison === currentComparison;
                if (isActive) {
                    btn.style.background = 'linear-gradient(135deg,#10b981,#059669)';
                    btn.style.color = '#fff';
                    btn.style.borderColor = 'transparent';
                } else {
                    btn.style.background = '#fff';
                    btn.style.color = '#334155';
                    btn.style.borderColor = '#cbd5e1';
                }
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
    // metrics (RepSat/FCR/OE) are intentionally left out — they need days
    // of surveys to stabilize.
    const DAILY_CHECKIN_METRICS = [
        { key: 'totalCalls',        label: 'Volume',     reverse: false, weight: null },
        { key: 'aht',               label: 'AHT',        reverse: true,  weight: 'totalCalls' },
        { key: 'scheduleAdherence', label: 'Adherence',  reverse: false, weight: 'totalCalls' },
        { key: 'positiveWord',      label: '+Word',      reverse: false, weight: 'totalCalls' },
        { key: 'negativeWord',      label: 'Avoid Neg',  reverse: false, weight: 'totalCalls' },
        { key: 'managingEmotions',  label: 'Emotions',   reverse: false, weight: 'totalCalls' }
    ];

    function formatDailyCell(metricKey, value) {
        if (value === null || value === undefined || Number.isNaN(value)) return '<span style="color:#bdbdbd;">—</span>';
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
        const yesterdayLabel = new Date(yesterdayIso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        const uploadedCount = dailyKeysThisWeek.length;
        const header = `<div style="margin-bottom:10px; display:flex; justify-content:space-between; align-items:baseline; gap:12px; flex-wrap:wrap;">` +
            `<div>` +
                `<h4 style="margin:0; color:#1a237e; font-size:1.05em;">📅 Daily Check-in</h4>` +
                `<div style="font-size:0.85em; color:var(--text-secondary); margin-top:2px;">Yesterday (${yesterdayLabel}) + week-to-date weighted rollup · ${uploadedCount} day${uploadedCount === 1 ? '' : 's'} uploaded this week · ${reps.length} rep${reps.length === 1 ? '' : 's'}</div>` +
            `</div>` +
        `</div>`;

        // Build the metric-column header row.
        const metricHeaders = DAILY_CHECKIN_METRICS.map(m =>
            `<th colspan="2" style="padding:6px 8px; font-size:0.78em; color:var(--text-secondary); text-align:center; border-bottom:1px solid #e0e7ff;">${m.label}</th>`
        ).join('');
        const subHeaders = DAILY_CHECKIN_METRICS.map(() =>
            `<th style="padding:4px 8px; font-size:0.72em; color:var(--text-tertiary); font-weight:500; text-align:right; border-bottom:1px solid #f1f5f9;">yest</th>` +
            `<th style="padding:4px 8px; font-size:0.72em; color:var(--text-tertiary); font-weight:500; text-align:right; border-bottom:1px solid #f1f5f9;">WTD</th>`
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
                return `<td style="padding:6px 8px; text-align:right; font-size:0.88em; color:#334155;">${yCell}</td>` +
                       `<td style="padding:6px 8px; text-align:right; font-size:0.88em; font-weight:600; color:var(--text-primary);">${wCell}</td>`;
            }).join('');
            const safeName = typeof escapeHtml === 'function' ? escapeHtml(name) : name;
            return `<tr><td style="padding:6px 10px; font-weight:600; color:#1a237e; border-bottom:1px solid #f1f5f9; white-space:nowrap;">${safeName}</td>${cells}</tr>`;
        }).join('');

        return `<div style="margin-bottom:20px; padding:14px 16px; background:var(--bg-surface); border:1px solid #e0e7ff; border-radius:10px;">` +
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

    function buildSummaryBar(cardData, numUploads, periodType, hasComparison) {
        const counts = { red: 0, yellow: 0, green: 0, blue: 0, gray: 0 };
        cardData.forEach(d => {
            const badge = getStatusBadge(d.analysis.allMetrics || []);
            if (badge.icon.includes('\uD83D\uDD34')) counts.red++;
            else if (badge.icon.includes('\uD83D\uDFE1')) counts.yellow++;
            else if (badge.icon.includes('\uD83D\uDFE2')) counts.green++;
            else if (badge.icon.includes('\uD83D\uDD35')) counts.blue++;
            else counts.gray++;
        });

        const uploadsNote = periodType === 'week'
            ? (numUploads > 1
                ? `<span style="color:#1a237e; font-weight:600;">${numUploads} uploads in selected week</span>`
                : '<span style="color:var(--text-tertiary);">1 upload (no trajectory yet)</span>')
            : (hasComparison
                ? `<span style="color:#1a237e; font-weight:600;">Compared to previous ${periodType}</span>`
                : `<span style="color:var(--text-tertiary);">No previous ${periodType} to compare</span>`);

        return `<div style="display:flex; gap:16px; flex-wrap:wrap; padding:14px 18px; background:linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); border-radius:8px; margin-bottom:16px; align-items:center;">` +
            `<div style="font-weight:700; font-size:1em; color:var(--text-primary);">Team Pulse</div>` +
            `<div style="display:flex; gap:12px; flex-wrap:wrap; font-size:0.9em;">` +
                (counts.red > 0 ? `<span style="color:#e53935; font-weight:600;">\uD83D\uDD34 ${counts.red} Needs Support</span>` : '') +
                (counts.yellow > 0 ? `<span style="color:#fb8c00; font-weight:600;">\uD83D\uDFE1 ${counts.yellow} Watch</span>` : '') +
                (counts.blue > 0 ? `<span style="color:#1e88e5; font-weight:600;">\uD83D\uDD35 ${counts.blue} Solid</span>` : '') +
                (counts.green > 0 ? `<span style="color:var(--green-text); font-weight:600;">\uD83D\uDFE2 ${counts.green} Crushing It</span>` : '') +
                (counts.gray > 0 ? `<span style="color:#78909c; font-weight:600;">\u26AA ${counts.gray} Steady</span>` : '') +
            `</div>` +
            `<div style="margin-left:auto; font-size:0.85em; color:var(--text-secondary);">${cardData.length} associates \u2022 ${uploadsNote}</div>` +
        `</div>`;
    }

    // --- Modal ---

    function showCheckinModal(employeeName, message, latestKey, baselineKey, messageType) {
        const existing = document.getElementById('pulseCheckinModal');
        if (existing) existing.remove();

        const isKickoff = messageType === 'kickoff';
        const isMidweek = messageType === 'midweek';
        const isHighFive = messageType === 'highfive';
        const isMonthly = messageType === 'monthly';
        const isQuarterly = messageType === 'quarterly';
        const firstName = typeof getEmployeeNickname === 'function'
            ? getEmployeeNickname(employeeName)
            : employeeName.split(/[\s,]+/)[0];

        const escapeHtml = window.DevCoachModules?.sharedUtils?.escapeHtml || ((s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

        const titleIcon = isKickoff ? '🌟' : isMidweek ? '📊' : isQuarterly ? '\uD83D\uDCC8' : isMonthly ? '\uD83D\uDCC5' : isHighFive ? '\uD83C\uDF89' : '\uD83D\uDCAC';
        const titleText = isKickoff ? `Monday Kickoff for ${escapeHtml(firstName)}`
            : isMidweek ? `Midweek Check-In for ${escapeHtml(firstName)}`
            : isQuarterly ? `Quarterly Review for ${escapeHtml(firstName)}`
            : isMonthly ? `Monthly Review for ${escapeHtml(firstName)}`
            : isHighFive ? `High-Five for ${escapeHtml(firstName)}`
            : `Check-in for ${escapeHtml(firstName)}`;
        const copyGradient = isKickoff
            ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
            : isMidweek
            ? 'linear-gradient(135deg, #8b5cf6 0%, #6d28d9 100%)'
            : isQuarterly
            ? 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)'
            : isMonthly
            ? 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)'
            : isHighFive
            ? 'linear-gradient(135deg, #f59e0b 0%, #ea580c 100%)'
            : 'linear-gradient(135deg, #0ea5e9 0%, #2563eb 100%)';

        const overlay = document.createElement('div');
        overlay.id = 'pulseCheckinModal';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.5); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';

        overlay.innerHTML = `<div style="background:var(--bg-surface); border-radius:12px; max-width:560px; width:100%; max-height:80vh; overflow-y:auto; padding:24px; box-shadow:0 20px 60px rgba(0,0,0,0.3);">` +
            `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">` +
                `<h3 style="margin:0; color:#1a237e;">${titleIcon} ${titleText}</h3>` +
                `<button id="pulseCheckinClose" style="background:none; border:none; font-size:1.4em; cursor:pointer; color:var(--text-tertiary); padding:4px 8px;">\u2715</button>` +
            `</div>` +
            `<textarea id="pulseCheckinText" style="width:100%; height:180px; padding:14px; border:1px solid var(--border); border-radius:6px; font-size:0.95em; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">${escapeHtml(message)}</textarea>` +
            `<div style="display:flex; gap:10px; margin-top:14px;">` +
                `<button id="pulseCheckinCopy" style="flex:1; background:${copyGradient}; color:white; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">\uD83D\uDCCB Copy to Clipboard</button>` +
                `<button id="pulseCheckinRegenerate" style="flex:1; background:var(--bg-surface-raised); color:var(--text-primary); border:1px solid var(--border); border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">\uD83D\uDD04 Regenerate</button>` +
            `</div>` +
        `</div>`;

        document.body.appendChild(overlay);

        document.getElementById('pulseCheckinClose').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        document.getElementById('pulseCheckinCopy').addEventListener('click', async () => {
            const textarea = document.getElementById('pulseCheckinText');
            await copyToClipboard(textarea.value, { message: 'Copied!' });
        });

        const generateFn = isKickoff ? generateMondayKickoffMessage : isMidweek ? generateMidweekCheckinMessage : isQuarterly ? generateQuarterlyCheckinMessage : isMonthly ? generateMonthlyCheckinMessage : isHighFive ? generateHighFiveMessage : generateCheckinMessage;
        document.getElementById('pulseCheckinRegenerate').addEventListener('click', async () => {
            const regenBtn = document.getElementById('pulseCheckinRegenerate');
            regenBtn.textContent = '\u23F3 Regenerating...';
            regenBtn.disabled = true;
            try {
                const newMessage = await generateFn(employeeName, latestKey, baselineKey);
                if (newMessage) {
                    document.getElementById('pulseCheckinText').value = newMessage;
                    await copyToClipboard(newMessage, { message: 'New check-in copied!' });
                }
            } finally {
                regenBtn.textContent = '\uD83D\uDD04 Regenerate';
                regenBtn.disabled = false;
            }
        });
    }


    // --- Run My Day (the whole-team sweep, any weekday) ---

    // Plain-text twin of formatDailyCell — the sweep puts these numbers in a
    // message, not a table cell, so the em-dash placeholder and markup are out.
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

    // The base message for the day, plus — when the plan calls for it — the
    // daily numbers slotted in after the opening.
    function latestKeyCoversThisWeek(outreach, latestKey) {
        if (!outreach || !latestKey) return false;
        const period = getPeriodData(latestKey);
        const end = period?.metadata?.endDate || (latestKey.indexOf('|') > -1 ? latestKey.split('|')[1] : latestKey);
        return Boolean(end) && String(end).slice(0, 10) >= outreach.mondayOf(new Date());
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

    function withNearMiss(message, employeeName, latestKey) {
        if (!message) return message;
        const line = nearMissLine(employeeName, latestKey);
        return line ? message + '\n\n' + line : message;
    }

    async function buildOutreachMessage(outreach, plan, employeeName, latestKey, baselineKey, dailyEntry) {
        let base;
        if (plan.base === 'weekProgress' || plan.base === 'weekClosing') {
            base = await generateWeekProgressMessage(employeeName, latestKey, baselineKey, {
                tone: plan.base === 'weekClosing' ? 'closing' : 'midweek',
                daysIn: dailyEntry?.dates?.size || 0,
                latestIsThisWeek: latestKeyCoversThisWeek(outreach, latestKey)
            });
            // If the week-vs-week read came back empty, the older nudge is
            // still better than sending nothing at all.
            if (!base) base = await generateMidweekCheckinMessage(employeeName, latestKey, baselineKey);
        } else if (plan.base === 'midweek') {
            base = await generateMidweekCheckinMessage(employeeName, latestKey, baselineKey);
        } else {
            base = await generateMondayKickoffMessage(employeeName, latestKey, baselineKey);
        }

        // When the weekly file already is this week, the recap would be the
        // same numbers a second time.
        if (plan.dailyMode === 'none' || !dailyEntry) return withNearMiss(base || '', employeeName, latestKey);
        if (plan.dailyMode === 'wtd' && latestKeyCoversThisWeek(outreach, latestKey)) return withNearMiss(base || '', employeeName, latestKey);

        const rows = plan.dailyMode === 'monday'
            ? (dailyEntry.mondayRow ? [dailyEntry.mondayRow] : [])
            : dailyEntry.rows;
        if (!rows.length) return withNearMiss(base || '', employeeName, latestKey);

        const recap = outreach.buildDailyRecap(plan, computeRepWtdFromDailies(rows), {
            metrics: DAILY_CHECKIN_METRICS,
            formatValue: formatDailyPlain,
            dayCount: dailyEntry.dates.size
        });

        return withNearMiss(outreach.insertRecap(base || '', recap), employeeName, latestKey);
    }

    async function showRunMyDayModal(container) {
        const outreach = window.DevCoachModules?.dailyOutreach;
        if (!outreach) {
            if (typeof showToast === 'function') showToast('Daily outreach module failed to load.', 3000);
            return;
        }

        const selection = loadPulseSelection();
        const periodType = 'week';
        const window_ = getPeriodWindow(periodType, selection.periodKey);
        if (!window_) {
            if (typeof showToast === 'function') showToast('No weekly data available yet.', 3000);
            return;
        }
        const { latestKey, baselineKey } = window_;
        const period = getPeriodData(latestKey);
        if (!period) {
            if (typeof showToast === 'function') showToast('Could not load the selected week.', 3000);
            return;
        }

        const employees = getFilteredEmployees(period);
        if (!employees.length) {
            if (typeof showToast === 'function') showToast('No team members in the selected week.', 3000);
            return;
        }

        const now = new Date();
        const todayIso = outreach.isoDate(now);
        const plan = outreach.planForDate(now);
        const stamp = outreach.stampFor(plan, { weeklyKey: latestKey, todayIso });

        // Trim the log on the way in so it never grows without bound.
        outreach.saveSentLog(outreach.pruneSentLog(outreach.loadSentLog(), todayIso));
        const sentLog = outreach.loadSentLog();

        const dailyThisWeek = collectDailyRowsThisWeek();

        // Asked once for the whole sweep: does the tool even hold the period
        // this day's message claims to describe?
        const latestWeekEndIso = period?.metadata?.endDate || (latestKey.indexOf('|') > -1 ? latestKey.split('|')[1] : latestKey);
        const weeklyCoversThisWeek = Boolean(latestWeekEndIso) && latestWeekEndIso >= outreach.mondayOf(now);
        const periodCheck = outreach.checkPeriodData(plan, {
            todayIso,
            latestWeekEndIso,
            dailyDayCount: dailyThisWeek.dayCount
        });

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};

        // Build card data + priority scoring so we can sort worst-first, and
        // set aside anyone the day's data can't actually back a message for.
        const cardData = [];
        const blocked = [];
        employees.forEach(emp => {
            const dailyEntry = dailyThisWeek.byName.get(emp.name) || null;
            const coverage = outreach.checkCoverage(plan, {
                inWeekly: true,
                dailyRowCount: dailyEntry ? dailyEntry.rows.length : 0,
                hasMondayRow: Boolean(dailyEntry && dailyEntry.mondayRow),
                weeklyCoversThisWeek
            });

            const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
            if (!analysis || !analysis.allMetrics?.length) {
                blocked.push({ name: emp.name, reason: 'No scoreable metrics in this upload.' });
                return;
            }
            if (!coverage.ok) {
                blocked.push({ name: emp.name, reason: coverage.reason });
                return;
            }

            const metrics = (analysis.allMetrics || []).filter(m => !PULSE_EXCLUDED_METRICS.includes(m.metricKey));
            const badge = getStatusBadge(metrics);
            const needsFocus = metrics.filter(m => m.classification === 'Needs Focus').length;
            const watch = metrics.filter(m => m.classification === 'Watch Area').length;
            const priority = needsFocus * 10 + watch * 3;
            const sentEntry = outreach.getSentEntry(sentLog, plan.id, stamp, emp.name);
            cardData.push({ emp, analysis, badge, priority, needsFocus, watch, dailyEntry, coverage, sentEntry });
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
            blocked.push({ name, reason: 'Daily uploads only — no weekly numbers to coach against.' });
        });

        cardData.sort((a, b) => b.priority - a.priority || a.emp.name.localeCompare(b.emp.name));
        blocked.sort((a, b) => a.name.localeCompare(b.name));

        const pending = cardData.filter(c => !c.sentEntry);
        const alreadySent = cardData.filter(c => c.sentEntry);

        const endDate = getPeriodDisplayLabel(periodType, latestKey);
        const escapeHtml = window.DevCoachModules?.sharedUtils?.escapeHtml || ((s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
        const weekdayName = getCurrentWeekdayName();

        // Remove any existing modal
        const existing = document.getElementById('runMyDayModal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'runMyDayModal';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.55); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';

        const coversText = plan.covers === 'thisWeek'
            ? `${dailyThisWeek.dayCount} daily upload${dailyThisWeek.dayCount === 1 ? '' : 's'} so far`
            : `week ending ${escapeHtml(endDate)}`;

        overlay.innerHTML = `<div style="background:var(--bg-surface); border-radius:14px; max-width:780px; width:100%; max-height:90vh; display:flex; flex-direction:column; box-shadow:0 24px 60px rgba(0,0,0,0.35);">` +
            `<div style="padding:20px 24px; border-bottom:1px solid #eceff1; display:flex; justify-content:space-between; align-items:center;">` +
                `<div>` +
                    `<h2 style="margin:0; color:#1a237e; font-size:1.3em;">🚀 Run My Day — ${escapeHtml(plan.label)}</h2>` +
                    `<div style="margin-top:6px; font-size:0.88em; color:#546e7a;">` +
                        `${escapeHtml(weekdayName)} • covers ${escapeHtml(plan.coverageLabel)} • ${coversText}` +
                    `</div>` +
                    `<div style="margin-top:4px; font-size:0.88em; color:#546e7a;">` +
                        `<span style="font-weight:600;">${pending.length} to send</span> • ` +
                        `<span style="color:var(--green-text); font-weight:600;">${alreadySent.length} already sent</span> • ` +
                        `<span style="color:var(--text-tertiary); font-weight:600;">${blocked.length} without data</span>` +
                    `</div>` +
                `</div>` +
                `<button id="runMyDayClose" style="background:none; border:none; font-size:1.6em; cursor:pointer; color:var(--text-tertiary);">✕</button>` +
            `</div>` +
            (periodCheck.ok
                ? ''
                : `<div style="padding:12px 24px; background:#fff3e0; border-bottom:1px solid #ffcc80; font-size:0.88em; color:#e65100;">` +
                    `<strong>${escapeHtml(periodCheck.reason)}</strong> ${escapeHtml(periodCheck.detail)}` +
                  `</div>`) +
            `<div style="padding:12px 24px; background:#f8f9fc; border-bottom:1px solid #eceff1; font-size:0.85em; color:#546e7a;">` +
                `Sorted by priority. Copy each message and send it, then click <strong>Sent</strong> — that flag sticks, so re-running skips them.` +
            `</div>` +
            `<div id="runMyDayList" style="padding:16px 24px; overflow-y:auto; flex:1;">` +
                `<div style="text-align:center; color:var(--text-tertiary); padding:30px;">⏳ Generating messages…</div>` +
            `</div>` +
            `<div style="padding:14px 24px; border-top:1px solid #eceff1; display:flex; justify-content:space-between; align-items:center; gap:12px;">` +
                `<div id="runMyDayProgress" style="font-size:0.9em; color:#546e7a;">0 / ${pending.length} sent</div>` +
                `<div style="display:flex; gap:8px;">` +
                    (alreadySent.length
                        ? `<button id="runMyDayReset" style="background:var(--bg-surface-raised); color:var(--text-primary); border:1px solid var(--border); border-radius:6px; padding:10px 14px; cursor:pointer;">Clear sent flags</button>`
                        : '') +
                    `<button id="runMyDayDoneAll" style="background:#10b981; color:#fff; border:none; border-radius:6px; padding:10px 18px; cursor:pointer; font-weight:bold;">Close</button>` +
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
                await showRunMyDayModal(container);
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
                message = await buildOutreachMessage(outreach, plan, entry.emp.name, latestKey, baselineKey, entry.dailyEntry) || '';
            } catch (e) { message = ''; }
            rendered.push({ ...entry, message });
        }

        const cardsHtml = rendered.map((r, idx) => {
            const safeName = escapeHtml(r.emp.name);
            const warning = r.coverage.warning
                ? `<div style="margin-bottom:8px; font-size:0.8em; color:#ef6c00;">⚠️ ${escapeHtml(r.coverage.warning)}</div>`
                : '';
            return `<div class="rmm-rep-card" data-rep-index="${idx}" data-rep-name="${safeName}" style="border:1px solid var(--border); border-radius:10px; padding:14px; margin-bottom:12px; background:var(--bg-surface);">` +
                `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">` +
                    `<div style="font-weight:700; color:#1a237e;">${safeName}</div>` +
                    `<div style="font-size:0.78em; font-weight:600; padding:3px 10px; border-radius:12px; color:${r.badge.color}; background:${r.badge.bg};">${r.badge.icon} ${escapeHtml(r.badge.label)}</div>` +
                `</div>` +
                warning +
                `<textarea class="rmm-rep-text" style="width:100%; min-height:120px; padding:10px; border:1px solid var(--border); border-radius:6px; font-size:0.9em; color:var(--text-primary); background:var(--bg-surface-raised); resize:vertical; font-family:inherit;">${escapeHtml(r.message)}</textarea>` +
                `<div style="display:flex; gap:8px; margin-top:10px;">` +
                    `<button class="rmm-copy" style="flex:1; background:linear-gradient(135deg,#10b981,#059669); color:#fff; border:none; border-radius:6px; padding:9px 14px; cursor:pointer; font-weight:bold;">📋 Copy</button>` +
                    `<button class="rmm-regen" style="background:var(--bg-surface-raised); color:var(--text-primary); border:1px solid var(--border); border-radius:6px; padding:9px 14px; cursor:pointer;">🔄 Regenerate</button>` +
                    `<button class="rmm-sent" style="background:#e3f2fd; color:#1565c0; border:1px solid #90caf9; border-radius:6px; padding:9px 14px; cursor:pointer; font-weight:bold;">✓ Sent</button>` +
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
        // deleted — the flag is what stops a double-send, so it has to be
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
                            `<button class="rmm-unsend" data-rep-name="${escapeHtml(c.emp.name)}" style="background:none; border:1px solid var(--border); border-radius:6px; padding:4px 10px; cursor:pointer; color:var(--text-secondary);">Undo</button>` +
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
                await showRunMyDayModal(container);
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
                    const msg = await buildOutreachMessage(outreach, plan, repName, latestKey, baselineKey, entry?.dailyEntry);
                    if (msg) textarea.value = msg;
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
                    card.style.background = '#f1f8e9';
                    btn.textContent = '↩ Undo';
                }
                updateProgress();
            });
        });
    }

    // --- Main render ---

    function renderMorningPulse(container) {
        if (!container) return;

        const selection = loadPulseSelection();
        const periodType = selection.periodType || 'week';
        const availableKeys = getPeriodKeys(periodType);
        const window_ = getPeriodWindow(periodType, selection.periodKey);
        const selectedKey = window_?.latestKey || null;

        if (selection.periodKey !== selectedKey) {
            savePulseSelection({ periodType, periodKey: selectedKey });
        }

        const optionsHtml = availableKeys.length
            ? availableKeys.slice().reverse().map(key => {
                const selectedAttr = key === selectedKey ? ' selected' : '';
                return `<option value="${key}"${selectedAttr}>${getPeriodDisplayLabel(periodType, key)}</option>`;
            }).join('')
            : '<option value="">No periods available</option>';

        const controlsHtml = `<div style="margin-bottom:16px; padding:16px; background:var(--bg-surface); border:1px solid #e0e7ff; border-radius:10px; display:grid; grid-template-columns:180px 1fr; gap:12px; align-items:end;">` +
            `<div>` +
                `<label for="pulsePeriodTypeSelect" style="display:block; font-size:0.85em; font-weight:600; color:var(--text-secondary); margin-bottom:6px;">Period Type</label>` +
                `<select id="pulsePeriodTypeSelect" style="width:100%; padding:10px 12px; border:1px solid var(--border-strong); border-radius:8px; font-size:0.95em;">` +
                    `<option value="week"${periodType === 'week' ? ' selected' : ''}>Week</option>` +
                    `<option value="month"${periodType === 'month' ? ' selected' : ''}>Month</option>` +
                    `<option value="quarter"${periodType === 'quarter' ? ' selected' : ''}>Quarter</option>` +
                `</select>` +
            `</div>` +
            `<div>` +
                `<label for="pulsePeriodKeySelect" style="display:block; font-size:0.85em; font-weight:600; color:var(--text-secondary); margin-bottom:6px;">Selected ${periodType}</label>` +
                `<select id="pulsePeriodKeySelect" style="width:100%; padding:10px 12px; border:1px solid var(--border-strong); border-radius:8px; font-size:0.95em;"${availableKeys.length ? '' : ' disabled'}>${optionsHtml}</select>` +
            `</div>` +
        `</div>`;

        if (!window_) {
            container.innerHTML = controlsHtml + '<div style="padding:20px; color:var(--text-secondary); text-align:center;">No data available for that period type yet.</div>';
            bindPulseControls(container);
            return;
        }

        const { latestKey, baselineKey, allRecentKeys } = window_;
        const period = getPeriodData(latestKey);
        if (!period) {
            container.innerHTML = controlsHtml + '<div style="padding:20px; color:var(--text-secondary); text-align:center;">Could not load period data.</div>';
            bindPulseControls(container);
            return;
        }

        const endDate = getPeriodDisplayLabel(periodType, latestKey);
        const employees = getFilteredEmployees(period);

        if (!employees.length) {
            container.innerHTML = controlsHtml + '<div style="padding:20px; color:var(--text-secondary); text-align:center;">No team members found for the selected period.</div>';
            bindPulseControls(container);
            return;
        }

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};

        // Build card data for each employee
        const cardData = [];
        employees.forEach(emp => {
            const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
            if (!analysis || !analysis.allMetrics?.length) return;

            const weekDeltas = baselineKey ? calcWeekDeltas(emp.name, baselineKey, latestKey) : [];
            const biggestJump = getBiggestJump(weekDeltas);

            cardData.push({ emp, analysis, weekDeltas, biggestJump });
        });

        // Sort: needs support first, then watch, then others
        const badgePriority = { '\uD83D\uDD34': 0, '\uD83D\uDFE1': 1, '\u26AA': 2, '\uD83D\uDD35': 3, '\uD83D\uDFE2': 4 };
        cardData.sort((a, b) => {
            const ba = getStatusBadge(a.analysis.allMetrics || []);
            const bb = getStatusBadge(b.analysis.allMetrics || []);
            const pa = Object.entries(badgePriority).find(([k]) => ba.icon.includes(k));
            const pb = Object.entries(badgePriority).find(([k]) => bb.icon.includes(k));
            return (pa ? pa[1] : 5) - (pb ? pb[1] : 5);
        });

        let html = '';

        // Header
        const baseDate = baselineKey ? getPeriodDisplayLabel(periodType, baselineKey) : null;
        const rangeText = baseDate && baseDate !== endDate ? `${baseDate} \u2013 ${endDate}` : endDate;
        const pulseDescription = periodType === 'week'
            ? 'Your team\'s weekly trajectory at a glance. Use "Check-in" for coaching or "High-Five" for a straight shoutout.'
            : periodType === 'month'
            ? 'Your team\'s monthly snapshot. Use each card to generate an individual monthly review.'
            : 'Your team\'s quarterly snapshot. Use each card to generate an individual quarterly review.';
        const dayPlan = window.DevCoachModules?.dailyOutreach?.planForDate?.(new Date());
        const runMyDayBtnHtml = periodType === 'week'
            ? `<button type="button" id="runMyDayBtn" title="${dayPlan ? 'Covers ' + dayPlan.coverageLabel : ''}" style="background:linear-gradient(135deg,#7c3aed,#4f46e5); color:#fff; border:none; border-radius:8px; padding:10px 18px; cursor:pointer; font-weight:bold; font-size:0.95em; box-shadow:0 4px 12px rgba(124,58,237,0.3);">🚀 Run My Day${dayPlan ? ' — ' + dayPlan.label : ''}</button>`
            : '';
        const patternMemoryBtnHtml = periodType === 'week'
            ? `<button type="button" id="patternMemoryBtn" style="background:var(--bg-surface); color:#4f46e5; border:1px solid #c7d2fe; border-radius:8px; padding:10px 14px; cursor:pointer; font-weight:bold; font-size:0.9em;">🧠 Patterns</button>`
            : '';
        html += controlsHtml + `<div style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; gap:16px;">` +
            `<div>` +
                `<h3 style="color:#1a237e; margin:0 0 6px 0;">\u2600\uFE0F Weekly Pulse \u2014 ${rangeText}</h3>` +
                `<p style="color:var(--text-secondary); margin:0; font-size:0.9em;">${pulseDescription}</p>` +
            `</div>` +
            `<div style="display:flex; gap:10px; flex-shrink:0;">` +
                patternMemoryBtnHtml +
                runMyDayBtnHtml +
            `</div>` +
        `</div>`;

        // Summary bar
        html += buildSummaryBar(cardData, allRecentKeys.length, periodType, Boolean(baselineKey));

        // Daily check-in (shown only when periodType === 'week' and dailies
        // have been uploaded this week). Sits between the team summary and
        // the per-rep card grid so reps who need a "yesterday" nudge are
        // surfaced before the full weekly drill-down.
        if (periodType === 'week') {
            html += buildDailyCheckinSection();
        }

        // Card grid
        html += `<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:16px;">`;
        cardData.forEach(d => {
            html += buildEmployeeCard(d.emp, d.analysis, d.weekDeltas, d.biggestJump, {
                periodType,
                deltaContextLabel: getPeriodContextLabel(periodType)
            });
        });
        html += `</div>`;

        container.innerHTML = html;
        bindPulseControls(container);

        // Bind Run My Day button
        const runMyDayBtn = container.querySelector('#runMyDayBtn');
        if (runMyDayBtn) {
            runMyDayBtn.addEventListener('click', async () => {
                runMyDayBtn.disabled = true;
                const originalText = runMyDayBtn.textContent;
                runMyDayBtn.textContent = '\u23F3 Building\u2026';
                try {
                    await showRunMyDayModal(container);
                } finally {
                    runMyDayBtn.textContent = originalText;
                    runMyDayBtn.disabled = false;
                }
            });
        }

        // Bind Pattern Memory button
        const patternMemoryBtn = container.querySelector('#patternMemoryBtn');
        if (patternMemoryBtn) {
            patternMemoryBtn.addEventListener('click', () => {
                const fn = window.DevCoachModules?.patternMemory?.showPatternMemoryModal;
                if (typeof fn === 'function') fn();
            });
        }

        // Bind check-in buttons
        container.querySelectorAll('.pulse-checkin-btn').forEach(btn => {
            btn.addEventListener('click', async function() {
                const empName = this.dataset.employee;
                const originalText = this.textContent;
                this.textContent = '\u23F3 Generating...';
                this.disabled = true;

                try {
                    const message = await generateCheckinMessage(empName, latestKey, baselineKey);
                    if (!message) {
                        if (typeof showToast === 'function') showToast('Could not generate check-in for ' + empName, 3000);
                        return;
                    }
                    showCheckinModal(empName, message, latestKey, baselineKey, 'checkin');

                    await copyToClipboard(message, { message: 'Check-in copied to clipboard!' });
                } finally {
                    this.textContent = originalText;
                    this.disabled = false;
                }
            });
        });

        // Bind Monday Kickoff buttons
        container.querySelectorAll('.pulse-kickoff-btn').forEach(btn => {
            btn.addEventListener('click', async function() {
                const empName = this.dataset.employee;
                const originalText = this.textContent;
                this.textContent = '\u23F3 Generating...';
                this.disabled = true;

                try {
                    const message = await generateMondayKickoffMessage(empName, latestKey, baselineKey);
                    if (!message) {
                        if (typeof showToast === 'function') showToast('Could not generate kickoff for ' + empName, 3000);
                        return;
                    }
                    showCheckinModal(empName, message, latestKey, baselineKey, 'kickoff');

                    await copyToClipboard(message, { message: 'Monday Kickoff copied to clipboard!' });
                } finally {
                    this.textContent = originalText;
                    this.disabled = false;
                }
            });
        });

        // Bind Midweek Check-In buttons
        container.querySelectorAll('.pulse-midweek-btn').forEach(btn => {
            btn.addEventListener('click', async function() {
                const empName = this.dataset.employee;
                const originalText = this.textContent;
                this.textContent = '\u23F3 Generating...';
                this.disabled = true;

                try {
                    const message = await generateMidweekCheckinMessage(empName, latestKey, baselineKey);
                    if (!message) {
                        if (typeof showToast === 'function') showToast('Could not generate midweek check-in for ' + empName, 3000);
                        return;
                    }
                    showCheckinModal(empName, message, latestKey, baselineKey, 'midweek');

                    await copyToClipboard(message, { message: 'Midweek check-in copied to clipboard!' });
                } finally {
                    this.textContent = originalText;
                    this.disabled = false;
                }
            });
        });

        // Bind high-five buttons
        container.querySelectorAll('.pulse-highfive-btn').forEach(btn => {
            btn.addEventListener('click', async function() {
                const empName = this.dataset.employee;
                const originalText = this.textContent;
                this.textContent = '\u23F3 Generating...';
                this.disabled = true;

                try {
                    const message = await generateHighFiveMessage(empName, latestKey, baselineKey);
                    if (!message) {
                        if (typeof showToast === 'function') showToast('Could not generate high-five for ' + empName, 3000);
                        return;
                    }
                    showCheckinModal(empName, message, latestKey, baselineKey, 'highfive');

                    await copyToClipboard(message, { message: 'High-five copied to clipboard!' });
                } finally {
                    this.textContent = originalText;
                    this.disabled = false;
                }
            });
        });

        // Bind growth buttons (week, month, and quarter views)
        container.querySelectorAll('.pulse-growth-btn').forEach(btn => {
            btn.addEventListener('click', async function() {
                const empName = this.dataset.employee;
                const cardPeriod = this.dataset.period || 'week';
                const defaultComparison = cardPeriod === 'quarter' ? 'qoq'
                    : cardPeriod === 'month' ? 'mom'
                    : 'wow';
                const originalText = this.textContent;
                this.textContent = '⏳ Opening...';
                this.disabled = true;
                try {
                    await showGrowthModal(empName, defaultComparison);
                } finally {
                    this.textContent = originalText;
                    this.disabled = false;
                }
            });
        });

        // Bind month / quarter review buttons
        if (periodType !== 'week') {
            container.querySelectorAll('.pulse-review-btn').forEach(btn => {
                btn.addEventListener('click', async function() {
                    const empName = this.dataset.employee;
                    const originalText = this.textContent;
                    this.textContent = '\u23F3 Generating...';
                    this.disabled = true;

                    const generateFn = periodType === 'quarter' ? generateQuarterlyCheckinMessage : generateMonthlyCheckinMessage;
                    const messageType = getReviewMessageType(periodType);
                    const reviewLabel = periodType === 'quarter' ? 'quarterly review' : 'monthly review';

                    try {
                        const message = await generateFn(empName, latestKey, baselineKey);
                        if (!message) {
                            if (typeof showToast === 'function') showToast('Could not generate ' + reviewLabel + ' for ' + empName, 3000);
                            return;
                        }
                        showCheckinModal(empName, message, latestKey, baselineKey, messageType);

                        await copyToClipboard(message, { message: (periodType === 'quarter' ? 'Quarterly' : 'Monthly') + ' review copied to clipboard!' });
                    } finally {
                        this.textContent = originalText;
                        this.disabled = false;
                    }
                });
            });
        }
    }

    function bindPulseControls(container) {
        const typeSelect = container.querySelector('#pulsePeriodTypeSelect');
        const keySelect = container.querySelector('#pulsePeriodKeySelect');

        if (typeSelect) {
            typeSelect.addEventListener('change', function() {
                const nextType = this.value || 'week';
                const nextKeys = getPeriodKeys(nextType);
                savePulseSelection({
                    periodType: nextType,
                    periodKey: nextKeys.length ? nextKeys[nextKeys.length - 1] : null
                });
                renderMorningPulse(container);
            });
        }

        if (keySelect) {
            keySelect.addEventListener('change', function() {
                const current = loadPulseSelection();
                savePulseSelection({
                    periodType: current.periodType || 'week',
                    periodKey: this.value || null
                });
                renderMorningPulse(container);
            });
        }
    }

    // Initialize - called when the Weekly Pulse tab is activated.
    // Always snap to the newest available period so fresh uploads appear
    // without requiring the user to touch the dropdown.
    function initializeMorningPulse() {
        const container = document.getElementById('morningPulseContainer');
        const current = loadPulseSelection();
        const periodType = current.periodType || 'week';
        const keys = getPeriodKeys(periodType);
        if (keys.length) {
            savePulseSelection({ periodType, periodKey: keys[keys.length - 1] });
        }
        renderMorningPulse(container);
    }

    // Export
    window.DevCoachModules = window.DevCoachModules || {};
    window.DevCoachModules.morningPulse = {
        initializeMorningPulse,
        renderMorningPulse,
        resolveCheckinPeriods,
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
        collectDailyRowsThisWeek,
        generateMonthlyCheckinMessage,
        generateQuarterlyCheckinMessage,
        generateGrowthMessage,
        showGrowthModal
    };
})();


