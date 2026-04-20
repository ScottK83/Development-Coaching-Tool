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

    const GREETINGS = [
        name => `Hey ${name}!`,
        name => `Hi ${name}!`,
        name => `What's up ${name}!`,
        name => `Hey there ${name}!`,
        name => `${name}!`,
        name => `Morning ${name}!`,
        name => `Good to catch up with you, ${name}.`,
        name => `${name}, got a sec?`,
        name => `Wanted to touch base, ${name}.`,
        name => `${name}, quick update for you.`,
        name => `Hey hey ${name}!`,
        name => `Alright ${name}, let's get into it.`,
        name => `${name}! Perfect timing.`,
        name => `Happy to share this with you, ${name}.`,
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
        (label, delta, range) => `Huge improvement in ${label}, ${delta}! (${range})`,
        (label, delta, range) => `Big move in ${label} this week, ${delta}! (${range})`,
        (label, delta, range) => `Love seeing ${label} move like that, ${delta}! (${range})`,
        (label, delta, range) => `${label} really stood out this week, ${delta}! (${range})`,
        (label, delta, range) => `You crushed it on ${label}, ${delta}! (${range})`,
        (label, delta, range) => `That jump in ${label} caught my eye, ${delta}. (${range})`,
        (label, delta, range) => `${label} went up in a serious way, ${delta}. (${range})`,
        (label, delta, range) => `Not gonna lie, ${label} at ${delta} made me do a double take. (${range})`,
        (label, delta, range) => `Okay, ${label}! That's a ${delta} swing. (${range})`,
        (label, delta, range) => `Your ${label} is trending the right direction, ${delta}. (${range})`,
        (label, delta, range) => `Seriously though, ${label} moving ${delta} is no joke. (${range})`,
        (label, delta, range) => `Look at ${label} go, ${delta}! (${range})`,
        (label, delta, range) => `${label} took a nice leap this week, ${delta}. (${range})`,
        (label, delta, range) => `Gotta call out your ${label}, up ${delta}. (${range})`,
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
        'Appreciate you showing up and grinding this week.',
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
        'Solid week. I\'m here if you want to chat about anything.',
        'Keep doing your thing. Reach out if you need me.',
        'Good stuff. Let\'s keep the momentum going.',
        'Nice work this week. My door\'s always open.',
        'Talk soon. You know where to find me.',
        'That\'s the update. Holler if anything comes up.',
        'Appreciate you. Let\'s have a good one this week.',
        'Questions? Concerns? Random thoughts? I\'m around.',
        'Let me know if you want to dig into any of this together.',
        'Keep at it. Rooting for you.',
        'That\'s all I got. Go have a great week.',
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
    ];
    const MW_NO_FOCUS_SET = [
        'Here\'s a quick look at how the week is going so far.',
        'Wanted to check in on how things are trending this week.',
        'Quick midweek snapshot of where you\'re at.',
    ];
    const MW_CLOSERS = [
        'Proud of you. Let me know how I can help.',
        'Proud of you. Let me know how I can help as you finish the week.',
        'Proud of you. Let me know how I can help keep this momentum going.',
        'Proud of you. Let me know how I can help you close strong.',
        'Proud of you. Let me know how I can help with the next step.',
        'Proud of you. Let me know how I can help for the rest of the week.',
        'Proud of you. Let me know how I can help you build on this.',
        'Proud of you. Let me know how I can help from here.',
        'Proud of you. Let me know how I can help you finish on a high note.',
        'Proud of you. Let me know how I can help.',
    ];

    const HF_OPENERS = [
        name => `Hey ${name}! \uD83C\uDF89`,
        name => `${name}! \uD83C\uDF89\uD83D\uDE4C`,
        name => `Yo ${name}! \uD83C\uDF89`,
        name => `What a week, ${name}! \uD83C\uDF89`,
        name => `${name}, had to send you this before the weekend! \uD83C\uDF89`,
        name => `${name}! Gotta give credit where it's due. \uD83C\uDF89`,
        name => `Real quick, ${name}, before you head out for the weekend. \uD83C\uDF89`,
        name => `Couldn't let the week end without saying something, ${name}! \uD83C\uDF89`,
        name => `${name}! Wrapping up the week and had to share this. \uD83C\uDF89`,
        name => `${name}, you need to see these numbers. \uD83C\uDF89`,
        name => `Hey ${name}, just wanted to highlight your week real quick. \uD83C\uDF89`,
        name => `Quick shoutout before the weekend, ${name}! \uD83C\uDF89`,
    ];
    const HF_JUMP = [
        (label, delta, range) => `Incredible jump in ${label}, ${delta}! (${range}) That kind of growth stands out.`,
        (label, delta, range) => `You moved ${label} in a big way this week, ${delta}! (${range}) That's impressive.`,
        (label, delta, range) => `${label} took a huge leap, ${delta}! (${range}) Love to see it.`,
        (label, delta, range) => `The progress on ${label} is awesome, ${delta}! (${range}) Keep that energy.`,
        (label, delta, range) => `Your ${label} jumped ${delta} and honestly it's one of the best improvements I've seen. (${range})`,
        (label, delta, range) => `That ${delta} move in ${label} is worth celebrating. (${range}) That took real effort.`,
        (label, delta, range) => `${label} went from good to great this week, ${delta}. (${range}) You should feel good about that.`,
        (label, delta, range) => `I have to point out that ${label} swing, ${delta}. (${range}) That's not easy to do.`,
        (label, delta, range) => `When I saw ${label} at ${delta}, I knew I had to say something. (${range}) Wow.`,
        (label, delta, range) => `The kind of improvement you showed on ${label}, ${delta}, doesn't happen by accident. (${range})`,
    ];
    const HF_TWO_WINS = [
        (l1, v1, l2, v2) => `Your ${l1} at ${v1} and ${l2} at ${v2} were outstanding!`,
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2}? Absolutely killing it!`,
        (l1, v1, l2, v2) => `Crushed it on ${l1} (${v1}) and ${l2} (${v2}) this week!`,
        (l1, v1, l2, v2) => `${l1} at ${v1} and ${l2} at ${v2} are both legit impressive.`,
        (l1, v1, l2, v2) => `Between ${l1} at ${v1} and ${l2} at ${v2}, you had one heck of a week.`,
        (l1, v1, l2, v2) => `I mean, ${l1} at ${v1} AND ${l2} at ${v2}? Come on now.`,
        (l1, v1, l2, v2) => `Your ${l1} (${v1}) and ${l2} (${v2}) were both standout numbers this week.`,
        (l1, v1, l2, v2) => `Two words: ${l1} at ${v1}. Two more: ${l2} at ${v2}. Just great.`,
        (l1, v1, l2, v2) => `${l1} at ${v1}, ${l2} at ${v2}. That's the kind of week you want to have.`,
        (l1, v1, l2, v2) => `Can we talk about ${l1} at ${v1} and ${l2} at ${v2}? Because those are excellent.`,
    ];
    const HF_ONE_WIN = [
        (label, val) => `Your ${label} at ${val} was outstanding!`,
        (label, val) => `${label} at ${val}? That's what I'm talking about!`,
        (label, val) => `Killed it on ${label} at ${val} this week!`,
        (label, val) => `Your ${label} coming in at ${val} is seriously impressive.`,
        (label, val) => `${label} at ${val} was the highlight of your week and it deserves a callout.`,
        (label, val) => `I saw your ${label} at ${val} and honestly just wanted to say great job.`,
        (label, val) => `That ${label} number at ${val}? Chef's kiss.`,
        (label, val) => `${label} at ${val} tells me everything about how you showed up this week.`,
        (label, val) => `Huge props on ${label} at ${val}. That's no small thing.`,
        (label, val) => `Let's be real, ${label} at ${val} is just flat out good.`,
    ];
    const HF_NO_WINS = [
        'I wanted to recognize your effort this week. You showed up and put in the work, and that matters.',
        'Just want you to know I see the grind. Keep at it.',
        'Appreciate the effort you put in this week. It doesn\'t go unnoticed.',
        'The numbers are one thing, but showing up every day is the foundation. You did that.',
        'I wanted to take a sec to acknowledge your work this week. It matters more than you think.',
        'Not every week is going to be flashy, but the work ethic you bring is what builds a great track record.',
        'I see you out there putting in the work. That consistency is going to pay off.',
        'Wanted to make sure you know that the effort hasn\'t gone unnoticed. Keep going.',
    ];
    const HF_EXTRAS = [
        extras => `On top of that, ${extras}... you're on a roll!`,
        extras => `And ${extras} too? You're firing on all cylinders.`,
        extras => `Plus ${extras}. Just an all-around great week.`,
        extras => `Not to mention ${extras}. Seriously impressive.`,
        extras => `Oh and did I mention ${extras}? Because yeah, that happened too.`,
        extras => `Throw in ${extras} and you've basically had the perfect week.`,
        extras => `As if that wasn't enough, ${extras} also hit.`,
        extras => `And to top it all off, ${extras}. What a week.`,
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
    const HF_CLOSERS = [
        'Proud of you. Enjoy your weekend!',
        'Have a great weekend. You earned it!',
        'Enjoy the weekend, you deserve it!',
        'Great week. Go relax, you\'ve earned it!',
        'Awesome job. Have a good one!',
        'Seriously, great work. Now go enjoy your days off.',
        'Take this good energy into the weekend. You crushed it.',
        'That\'s a wrap on a great week. Rest up and recharge.',
        'Way to finish the week strong. See you Monday.',
        'Go do something fun this weekend, you earned it.',
        'Nothing left to say except well done. Have a great one.',
        'I love ending the week on a high note like this. Enjoy!',
        'Couldn\'t be happier with how this week went. Relax and come back refreshed.',
        'Heck of a week. Go enjoy it.',
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
        (label, delta, range) => `Standout improvement: ${label} at ${delta}. (${range})`,
        (label, delta, range) => `${label} really picked up steam, ${delta}. (${range})`,
        (label, delta, range) => `Loved watching ${label} trend up this month, ${delta}. (${range})`,
        (label, delta, range) => `Your ${label} growth was impressive, ${delta}. (${range})`,
        (label, delta, range) => `${label} at ${delta} was the big story of the month. (${range})`,
        (label, delta, range) => `The progress on ${label} speaks for itself, ${delta}. (${range})`,
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
        (label, delta, range) => `Standout improvement: ${label} at ${delta}. (${range})`,
        (label, delta, range) => `${label} really came alive this quarter, ${delta}. (${range})`,
        (label, delta, range) => `Over the quarter, ${label} grew by ${delta}. (${range}) That's real progress.`,
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

    function getAllSortedKeys() {
        const weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        return Object.keys(weekly).filter(k => {
            const p = weekly[k];
            const pt = p?.metadata?.periodType;
            return !pt || pt === 'week' || pt === 'week-in-progress' || pt === 'custom';
        }).sort();
    }

    function getPeriodData(weekKey) {
        const weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        return weekly[weekKey] || null;
    }

    function getPeriodKeys(periodType) {
        const weekly = typeof weeklyData !== 'undefined' ? weeklyData : {};
        if (periodType === 'week') return getAllSortedKeys();
        return Object.keys(weekly)
            .filter(k => weekly[k]?.metadata?.periodType === periodType)
            .sort();
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

    function fmtRange(metricKey, baseVal, latestVal) {
        const reverse = typeof isReverseMetric === 'function' && isReverseMetric(metricKey);
        if (reverse) return `down from ${fmtVal(metricKey, baseVal)} to ${fmtVal(metricKey, latestVal)}`;
        return `${fmtVal(metricKey, baseVal)} \u2192 ${fmtVal(metricKey, latestVal)}`;
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
            && surveyCountForWins > 0;
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
        ).slice(0, 2);
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

        const trendArrow = (metric) => {
            const dir = metric?.trendDirection;
            const metricKey = metric?.metricKey;
            const reverse = typeof isReverseMetric === 'function' && isReverseMetric(metricKey);
            if (dir === 'improving') return `<span style="color:#2e7d32;" title="Improving">${reverse ? '\u25BC' : '\u25B2'}</span>`;
            if (dir === 'declining') {
                const declineColor = metric?.meetsTarget ? '#f9a825' : '#e53935';
                const declineTitle = metric?.meetsTarget ? 'Declining (still above target)' : 'Declining';
                return `<span style="color:${declineColor};" title="${declineTitle}">${reverse ? '\u25B2' : '\u25BC'}</span>`;
            }
            return '<span style="color:#9e9e9e;" title="Stable">\u2015</span>';
        };

        // Wins section
        let winsHtml = '';
        if (wins.length) {
            winsHtml = wins.map(m => {
                if (m.displayOverride) {
                    return `<div style="font-size:0.85em; color:#2e7d32; padding:2px 0;">` +
                        `<span style="color:#9e9e9e;">\u2015</span> ${escapeHtml(m.label)}: <strong>${escapeHtml(m.displayOverride)}</strong></div>`;
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
                        deltaTag = ` <span style="color:#1b5e20; font-size:0.85em;">(${fmtDelta(m.metricKey, wd.delta)} ${deltaContextLabel})</span>`;
                    } else if (Math.abs(wd.delta) <= zeroBand) {
                        deltaTag = ` <span style="color:#1b5e20; font-size:0.85em;">(maintained ${deltaContextLabel})</span>`;
                    }
                }
                return `<div style="font-size:0.85em; color:#2e7d32; padding:2px 0;">` +
                    `${trendArrow(m)} ${escapeHtml(m.label)}: <strong>${fmtVal(m)}</strong>${deltaTag}</div>`;
            }).join('');
        } else {
            winsHtml = '<div style="font-size:0.85em; color:#999;">No metrics at target yet</div>';
        }

        // Opportunities section
        let oppsHtml = '';
        if (opportunities.length) {
            oppsHtml = opportunities.map(m => {
                if (m.displayOverride) {
                    return `<div style="font-size:0.85em; color:#c62828; padding:2px 0;">` +
                        `<span style="color:#9e9e9e;">\u2015</span> ${escapeHtml(m.label)}: <strong>${escapeHtml(m.displayOverride)}</strong></div>`;
                }
                const wd = weekDeltas.find(d => d.metricKey === m.metricKey);
                const deltaTag = wd && wd.delta !== 0
                    ? ` <span style="color:${wd.delta > 0 ? '#1b5e20' : (m.meetsTarget ? '#f9a825' : '#b71c1c')}; font-size:0.85em;">(${fmtDelta(m.metricKey, wd.delta)})</span>`
                    : '';
                return `<div style="font-size:0.85em; color:#c62828; padding:2px 0;">` +
                    `${trendArrow(m)} ${escapeHtml(m.label)}: <strong>${fmtVal(m)}</strong> ` +
                    `<span style="color:#999;">(target: ${fmtTarget(m)})</span>${deltaTag}</div>`;
            }).join('');
        } else {
            oppsHtml = '<div style="font-size:0.85em; color:#999;">All metrics on track!</div>';
        }

        // Biggest improvement callout (only if we have multi-day data)
        let jumpHtml = '';
        if (biggestJump && biggestJump.delta > 0) {
            jumpHtml = `<div style="padding:6px 10px; background:#e8f5e9; border-radius:4px; font-size:0.83em; color:#1b5e20; border-left:3px solid #4caf50;">` +
                `\uD83D\uDE80 <strong>Biggest improvement:</strong> ${escapeHtml(biggestJump.label)} ${fmtDelta(biggestJump.metricKey, biggestJump.delta)} ${deltaContextLabel} ` +
                `(${fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue)})</div>`;
        }

        // Focal point
        let focalHtml = '';
        if (focalPoint) {
            const dirLabel = focalPoint.trendDirection === 'declining' ? ' and declining' : '';
            focalHtml = `<div style="padding:8px; background:#fff3e0; border-radius:4px; border-left:3px solid #ff9800; font-size:0.85em;">` +
                `<strong>\uD83C\uDFAF Focus:</strong> ${escapeHtml(focalPoint.label)} \u2014 last week ${fmtVal(focalPoint)} vs target ${fmtTarget(focalPoint)}${dirLabel}</div>`;
        } else {
            focalHtml = `<div style="padding:8px; background:#e8f5e9; border-radius:4px; border-left:3px solid #4caf50; font-size:0.85em;">` +
                `<strong>\u2705 On track!</strong> Keep up the consistency.</div>`;
        }

        return `<div class="pulse-card" data-employee="${escapeHtml(emp.name)}" style="background:#fff; border-radius:8px; border:1px solid #e0e0e0; padding:16px; display:flex; flex-direction:column; gap:10px; transition: box-shadow 0.2s;">` +
            `<div style="display:flex; justify-content:space-between; align-items:center;">` +
                `<div style="font-weight:700; font-size:1.05em; color:#333;">${escapeHtml(firstName)}</div>` +
                `<div style="font-size:0.8em; font-weight:600; padding:3px 10px; border-radius:12px; color:${badge.color}; background:${badge.bg};">${badge.icon} ${badge.label}</div>` +
            `</div>` +
            jumpHtml +
            `<div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">` +
                `<div><div style="font-weight:600; font-size:0.8em; color:#666; margin-bottom:4px;">Wins</div>${winsHtml}</div>` +
                `<div><div style="font-weight:600; font-size:0.8em; color:#666; margin-bottom:4px;">Opportunities</div>${oppsHtml}</div>` +
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
                        `style="background:linear-gradient(135deg, #f59e0b 0%, #ea580c 100%); color:white; border:none; border-radius:6px; padding:9px 10px; cursor:pointer; font-weight:bold; font-size:0.82em;">🎉 High-Five</button>`
                    : `<button type="button" class="pulse-review-btn" data-employee="${escapeHtml(emp.name)}" ` +
                        `style="grid-column:1/-1; background:linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%); color:white; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold; font-size:0.9em;">${getReviewButtonLabel(periodType)}</button>`) +
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
            praiseText = pick(JUMP_INTROS)(biggestJump.label, fmtDelta(biggestJump.metricKey, biggestJump.delta), fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue));
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

    // --- Weekend High-Five message generation ---

    async function generateHighFiveMessage(employeeName, latestKey, baselineKey) {
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
        let message = pick(HF_OPENERS)(firstName);

        if (biggestJump && biggestJump.delta > 0) {
            message += ` ${pick(HF_JUMP)(biggestJump.label, fmtDelta(biggestJump.metricKey, biggestJump.delta), fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue))} \uD83D\uDD25`;
        } else if (wins.length >= 2) {
            message += ` ${pick(HF_TWO_WINS)(wins[0].label, fmtVal(wins[0]), wins[1].label, fmtVal(wins[1]))} \uD83D\uDD25\uD83D\uDCAA`;
        } else if (wins.length === 1) {
            message += ` ${pick(HF_ONE_WIN)(wins[0].label, fmtVal(wins[0]))} \uD83D\uDD25`;
        } else {
            message += ` ${pick(HF_NO_WINS)} \uD83D\uDCAA`;
        }

        // Add more wins if available
        if (wins.length > 2 && biggestJump) {
            const extraWins = wins.filter(w => w.metricKey !== biggestJump.metricKey).slice(0, 2);
            if (extraWins.length > 0) {
                const extras = extraWins.map(w => `${w.label} at ${fmtVal(w)}`).join(' and ');
                message += ` ${pick(HF_EXTRAS)(extras)}`;
            }
        }

        // Count how many metrics are on track
        const onTrackCount = allMetrics.filter(m => m.meetsTarget).length;
        if (onTrackCount >= allMetrics.length * 0.7 && allMetrics.length > 3) {
            message += `\n\n${pick(HF_CONSISTENCY)(onTrackCount, allMetrics.length)} \u2B50`;
        }

        message += `\n\n${pick(HF_CLOSERS)} \uD83D\uDE80`;

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
        const hasPerfectSurveys = allPerfectSurveyWins.length >= 2 && Number.isFinite(surveyCount) && surveyCount > 0;
        const surveysText = hasPerfectSurveys
            ? `${surveyCount} survey${surveyCount === 1 ? '' : 's'}`
            : '';
        const nonPerfectSurveyWins = hasPerfectSurveys
            ? allWinsSorted.filter(w => !allPerfectSurveyWins.includes(w))
            : wins;

        // CELEBRATION section — lead with wins
        let praiseText = '';
        if (hasPerfectSurveys) {
            const secondWin = nonPerfectSurveyWins[0];
            if (secondWin) {
                praiseText = pick(PERFECT_SURVEYS_PLUS)(surveysText, secondWin.label, fmtVal(secondWin));
            } else {
                praiseText = pick(PERFECT_SURVEYS_SOLO)(surveysText);
            }
        } else if (biggestJump && biggestJump.delta > 0) {
            praiseText = pick(JUMP_INTROS)(biggestJump.label, fmtDelta(biggestJump.metricKey, biggestJump.delta), fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue));
            const otherWins = wins.filter(w => w.metricKey !== biggestJump.metricKey).slice(0, 1);
            if (otherWins.length > 0) {
                praiseText += ` ${pick(PLUS_SOLID)(otherWins[0].label, fmtVal(otherWins[0]))}`;
            }
        } else if (wins.length >= 2) {
            praiseText = pick(TWO_WINS)(wins[0].label, fmtVal(wins[0]), wins[1].label, fmtVal(wins[1]));
        } else if (wins.length === 1) {
            praiseText = pick(ONE_WIN)(wins[0].label, fmtVal(wins[0]));
        } else {
            praiseText = pick(NO_WINS);
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

        let message = `${pick(MK_OPENERS)(firstName)} ${praiseText}${focusText}\n\n${pick(MK_CLOSERS)}`;
        return message;
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
                                message += ` 💡 ${cleanTip.charAt(0).toUpperCase() + cleanTip.slice(1)}`;
                            }
                        }
                    } catch (e) { /* no tips */ }
                }
            } else {
                // Focal metric data not available in current period — encourage anyway
                message += ` No updated data for ${savedFocal.label} yet, but keep being intentional about it.`;
            }
        } else {
            // No focal point was set Monday — give a general midweek snapshot
            message += ` ${pick(MW_NO_FOCUS_SET)}`;

            const focalPoint = pickFocalPoint(allMetrics);
            if (focalPoint) {
                const currentVal = fmtVal(focalPoint);
                const targetVal = fmtTarget(focalPoint);
                message += `\n\n🎯 The metric I'd focus on for the rest of the week: ${focalPoint.label} at ${currentVal} (target ${targetVal}).`;
            }

            // Mention a win if there is one
            const wins = allMetrics.filter(m => m.classification === 'Exceeding Expectation' || m.classification === 'On Track');
            if (wins.length > 0) {
                const topWin = wins[0];
                message += ` On the bright side, ${topWin.label} at ${fmtVal(topWin)} is looking good.`;
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
            praiseText = pick(reviewCopy.jump)(biggestJump.label, fmtDelta(biggestJump.metricKey, biggestJump.delta), fmtRange(biggestJump.metricKey, biggestJump.baseValue, biggestJump.latestValue));
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

    // --- Summary bar ---

    // Per-rep daily check-in block: yesterday's six operational metrics and
    // the week-to-date weighted rollup, computed from dailyData rows between
    // this past Monday and today. Returns '' when there's no daily data
    // for the current week (so Morning Pulse hides the whole section).
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
                `<div style="font-size:0.85em; color:#666; margin-top:2px;">Yesterday (${yesterdayLabel}) + week-to-date weighted rollup · ${uploadedCount} day${uploadedCount === 1 ? '' : 's'} uploaded this week · ${reps.length} rep${reps.length === 1 ? '' : 's'}</div>` +
            `</div>` +
        `</div>`;

        // Build the metric-column header row.
        const metricHeaders = DAILY_CHECKIN_METRICS.map(m =>
            `<th colspan="2" style="padding:6px 8px; font-size:0.78em; color:#475569; text-align:center; border-bottom:1px solid #e0e7ff;">${m.label}</th>`
        ).join('');
        const subHeaders = DAILY_CHECKIN_METRICS.map(() =>
            `<th style="padding:4px 8px; font-size:0.72em; color:#94a3b8; font-weight:500; text-align:right; border-bottom:1px solid #f1f5f9;">yest</th>` +
            `<th style="padding:4px 8px; font-size:0.72em; color:#94a3b8; font-weight:500; text-align:right; border-bottom:1px solid #f1f5f9;">WTD</th>`
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
                       `<td style="padding:6px 8px; text-align:right; font-size:0.88em; font-weight:600; color:#1e293b;">${wCell}</td>`;
            }).join('');
            const safeName = typeof escapeHtml === 'function' ? escapeHtml(name) : name;
            return `<tr><td style="padding:6px 10px; font-weight:600; color:#1a237e; border-bottom:1px solid #f1f5f9; white-space:nowrap;">${safeName}</td>${cells}</tr>`;
        }).join('');

        return `<div style="margin-bottom:20px; padding:14px 16px; background:#fff; border:1px solid #e0e7ff; border-radius:10px;">` +
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
                : '<span style="color:#999;">1 upload (no trajectory yet)</span>')
            : (hasComparison
                ? `<span style="color:#1a237e; font-weight:600;">Compared to previous ${periodType}</span>`
                : `<span style="color:#999;">No previous ${periodType} to compare</span>`);

        return `<div style="display:flex; gap:16px; flex-wrap:wrap; padding:14px 18px; background:linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%); border-radius:8px; margin-bottom:16px; align-items:center;">` +
            `<div style="font-weight:700; font-size:1em; color:#333;">Team Pulse</div>` +
            `<div style="display:flex; gap:12px; flex-wrap:wrap; font-size:0.9em;">` +
                (counts.red > 0 ? `<span style="color:#e53935; font-weight:600;">\uD83D\uDD34 ${counts.red} Needs Support</span>` : '') +
                (counts.yellow > 0 ? `<span style="color:#fb8c00; font-weight:600;">\uD83D\uDFE1 ${counts.yellow} Watch</span>` : '') +
                (counts.blue > 0 ? `<span style="color:#1e88e5; font-weight:600;">\uD83D\uDD35 ${counts.blue} Solid</span>` : '') +
                (counts.green > 0 ? `<span style="color:#2e7d32; font-weight:600;">\uD83D\uDFE2 ${counts.green} Crushing It</span>` : '') +
                (counts.gray > 0 ? `<span style="color:#78909c; font-weight:600;">\u26AA ${counts.gray} Steady</span>` : '') +
            `</div>` +
            `<div style="margin-left:auto; font-size:0.85em; color:#666;">${cardData.length} associates \u2022 ${uploadsNote}</div>` +
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
            : isHighFive ? `Weekend High-Five for ${escapeHtml(firstName)}`
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

        overlay.innerHTML = `<div style="background:white; border-radius:12px; max-width:560px; width:100%; max-height:80vh; overflow-y:auto; padding:24px; box-shadow:0 20px 60px rgba(0,0,0,0.3);">` +
            `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">` +
                `<h3 style="margin:0; color:#1a237e;">${titleIcon} ${titleText}</h3>` +
                `<button id="pulseCheckinClose" style="background:none; border:none; font-size:1.4em; cursor:pointer; color:#999; padding:4px 8px;">\u2715</button>` +
            `</div>` +
            `<textarea id="pulseCheckinText" style="width:100%; height:180px; padding:14px; border:1px solid #ddd; border-radius:6px; font-size:0.95em; color:#333; background:#f9f9f9; resize:vertical; font-family:inherit;">${escapeHtml(message)}</textarea>` +
            `<div style="display:flex; gap:10px; margin-top:14px;">` +
                `<button id="pulseCheckinCopy" style="flex:1; background:${copyGradient}; color:white; border:none; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">\uD83D\uDCCB Copy to Clipboard</button>` +
                `<button id="pulseCheckinRegenerate" style="flex:1; background:#f5f5f5; color:#333; border:1px solid #ddd; border-radius:6px; padding:10px 16px; cursor:pointer; font-weight:bold;">\uD83D\uDD04 Regenerate</button>` +
            `</div>` +
        `</div>`;

        document.body.appendChild(overlay);

        document.getElementById('pulseCheckinClose').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        document.getElementById('pulseCheckinCopy').addEventListener('click', async () => {
            const textarea = document.getElementById('pulseCheckinText');
            try {
                await navigator.clipboard.writeText(textarea.value);
                if (typeof showToast === 'function') showToast('Copied!', 2000);
            } catch (e) { textarea.select(); }
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
                    try {
                        await navigator.clipboard.writeText(newMessage);
                        if (typeof showToast === 'function') showToast('New check-in copied!', 2000);
                    } catch (e) { /* ok */ }
                }
            } finally {
                regenBtn.textContent = '\uD83D\uDD04 Regenerate';
                regenBtn.disabled = false;
            }
        });
    }

    // --- Run My Monday — one-pass kickoff flow ---

    async function showRunMyMondayModal(container) {
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

        const centerAvgs = typeof getCallCenterAverageForPeriod === 'function'
            ? getCallCenterAverageForPeriod(latestKey) || {}
            : {};

        // Build card data + priority scoring so we can sort worst-first
        const cardData = [];
        employees.forEach(emp => {
            const analysis = analyzeCurrentSnapshot(emp, centerAvgs, latestKey);
            if (!analysis || !analysis.allMetrics?.length) return;
            const metrics = (analysis.allMetrics || []).filter(m => !PULSE_EXCLUDED_METRICS.includes(m.metricKey));
            const badge = getStatusBadge(metrics);
            const needsFocus = metrics.filter(m => m.classification === 'Needs Focus').length;
            const watch = metrics.filter(m => m.classification === 'Watch Area').length;
            const priority = needsFocus * 10 + watch * 3;
            cardData.push({ emp, analysis, badge, priority, needsFocus, watch });
        });

        cardData.sort((a, b) => b.priority - a.priority || a.emp.name.localeCompare(b.emp.name));

        const summary = {
            total: cardData.length,
            needsSupport: cardData.filter(c => c.badge.label === 'Needs Support').length,
            watch: cardData.filter(c => c.badge.label === 'Watch').length,
            solid: cardData.filter(c => c.badge.label === 'Solid' || c.badge.label === 'Crushing It' || c.badge.label === 'Steady').length
        };

        const endDate = getPeriodDisplayLabel(periodType, latestKey);
        const escapeHtml = window.DevCoachModules?.sharedUtils?.escapeHtml || ((s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));

        // Remove any existing modal
        const existing = document.getElementById('runMyMondayModal');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'runMyMondayModal';
        overlay.className = 'modal-overlay';
        overlay.style.cssText = 'position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.55); z-index:9999; display:flex; align-items:center; justify-content:center; padding:20px;';

        overlay.innerHTML = `<div style="background:#fff; border-radius:14px; max-width:780px; width:100%; max-height:90vh; display:flex; flex-direction:column; box-shadow:0 24px 60px rgba(0,0,0,0.35);">` +
            `<div style="padding:20px 24px; border-bottom:1px solid #eceff1; display:flex; justify-content:space-between; align-items:center;">` +
                `<div>` +
                    `<h2 style="margin:0; color:#1a237e; font-size:1.3em;">🚀 Run My Monday — ${escapeHtml(endDate)}</h2>` +
                    `<div style="margin-top:6px; font-size:0.88em; color:#546e7a;">` +
                        `${summary.total} team members \u2022 ` +
                        `<span style="color:#c62828; font-weight:600;">${summary.needsSupport} needs support</span> \u2022 ` +
                        `<span style="color:#ef6c00; font-weight:600;">${summary.watch} watch</span> \u2022 ` +
                        `<span style="color:#2e7d32; font-weight:600;">${summary.solid} on track</span>` +
                    `</div>` +
                `</div>` +
                `<button id="runMyMondayClose" style="background:none; border:none; font-size:1.6em; cursor:pointer; color:#999;">\u2715</button>` +
            `</div>` +
            `<div style="padding:12px 24px; background:#f8f9fc; border-bottom:1px solid #eceff1; font-size:0.85em; color:#546e7a;">` +
                `Sorted by priority. Copy each message and send it, then click <strong>Done</strong> to mark the rep finished.` +
            `</div>` +
            `<div id="runMyMondayList" style="padding:16px 24px; overflow-y:auto; flex:1;">` +
                `<div style="text-align:center; color:#999; padding:30px;">\u23F3 Generating kickoffs\u2026</div>` +
            `</div>` +
            `<div style="padding:14px 24px; border-top:1px solid #eceff1; display:flex; justify-content:space-between; align-items:center;">` +
                `<div id="runMyMondayProgress" style="font-size:0.9em; color:#546e7a;">0 / ${summary.total} done</div>` +
                `<button id="runMyMondayDoneAll" style="background:#10b981; color:#fff; border:none; border-radius:6px; padding:10px 18px; cursor:pointer; font-weight:bold;">Close</button>` +
            `</div>` +
        `</div>`;

        document.body.appendChild(overlay);
        document.getElementById('runMyMondayClose').addEventListener('click', () => overlay.remove());
        document.getElementById('runMyMondayDoneAll').addEventListener('click', () => overlay.remove());
        overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

        // Generate kickoffs sequentially to avoid tip-loader thrash, then render
        const listEl = document.getElementById('runMyMondayList');
        const progressEl = document.getElementById('runMyMondayProgress');
        const doneSet = new Set();

        const rendered = [];
        for (const entry of cardData) {
            let message = '';
            try {
                message = await generateMondayKickoffMessage(entry.emp.name, latestKey, baselineKey) || '';
            } catch (e) { message = ''; }
            rendered.push({ ...entry, message });
        }

        listEl.innerHTML = rendered.map((r, idx) => {
            const safeName = escapeHtml(r.emp.name);
            const badgeBg = r.badge.bg;
            const badgeColor = r.badge.color;
            const badgeLabel = escapeHtml(r.badge.label);
            const badgeIcon = r.badge.icon;
            return `<div class="rmm-rep-card" data-rep-index="${idx}" data-rep-name="${safeName}" style="border:1px solid #e0e0e0; border-radius:10px; padding:14px; margin-bottom:12px; background:#fff;">` +
                `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">` +
                    `<div style="font-weight:700; color:#1a237e;">${safeName}</div>` +
                    `<div style="font-size:0.78em; font-weight:600; padding:3px 10px; border-radius:12px; color:${badgeColor}; background:${badgeBg};">${badgeIcon} ${badgeLabel}</div>` +
                `</div>` +
                `<textarea class="rmm-rep-text" style="width:100%; min-height:120px; padding:10px; border:1px solid #ddd; border-radius:6px; font-size:0.9em; color:#333; background:#fafafa; resize:vertical; font-family:inherit;">${escapeHtml(r.message)}</textarea>` +
                `<div style="display:flex; gap:8px; margin-top:10px;">` +
                    `<button class="rmm-copy" style="flex:1; background:linear-gradient(135deg,#10b981,#059669); color:#fff; border:none; border-radius:6px; padding:9px 14px; cursor:pointer; font-weight:bold;">📋 Copy</button>` +
                    `<button class="rmm-regen" style="background:#f5f5f5; color:#333; border:1px solid #ddd; border-radius:6px; padding:9px 14px; cursor:pointer;">🔄 Regenerate</button>` +
                    `<button class="rmm-done" style="background:#e3f2fd; color:#1565c0; border:1px solid #90caf9; border-radius:6px; padding:9px 14px; cursor:pointer; font-weight:bold;">✓ Done</button>` +
                `</div>` +
            `</div>`;
        }).join('');

        const updateProgress = () => {
            progressEl.textContent = `${doneSet.size} / ${rendered.length} done`;
        };

        listEl.querySelectorAll('.rmm-rep-card').forEach(card => {
            const idx = parseInt(card.dataset.repIndex, 10);
            const repName = card.dataset.repName;
            const textarea = card.querySelector('.rmm-rep-text');

            card.querySelector('.rmm-copy').addEventListener('click', async () => {
                try {
                    await navigator.clipboard.writeText(textarea.value);
                    if (typeof showToast === 'function') showToast(`Copied ${repName}`, 1500);
                } catch (e) { textarea.select(); }
            });

            card.querySelector('.rmm-regen').addEventListener('click', async (e) => {
                const btn = e.currentTarget;
                btn.disabled = true;
                const originalText = btn.textContent;
                btn.textContent = '\u23F3';
                try {
                    const msg = await generateMondayKickoffMessage(repName, latestKey, baselineKey);
                    if (msg) textarea.value = msg;
                } finally {
                    btn.disabled = false;
                    btn.textContent = originalText;
                }
            });

            card.querySelector('.rmm-done').addEventListener('click', () => {
                if (doneSet.has(idx)) {
                    doneSet.delete(idx);
                    card.style.opacity = '1';
                    card.style.background = '#fff';
                } else {
                    doneSet.add(idx);
                    card.style.opacity = '0.55';
                    card.style.background = '#f1f8e9';
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

        const controlsHtml = `<div style="margin-bottom:16px; padding:16px; background:#fff; border:1px solid #e0e7ff; border-radius:10px; display:grid; grid-template-columns:180px 1fr; gap:12px; align-items:end;">` +
            `<div>` +
                `<label for="pulsePeriodTypeSelect" style="display:block; font-size:0.85em; font-weight:600; color:#475569; margin-bottom:6px;">Period Type</label>` +
                `<select id="pulsePeriodTypeSelect" style="width:100%; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:0.95em;">` +
                    `<option value="week"${periodType === 'week' ? ' selected' : ''}>Week</option>` +
                    `<option value="month"${periodType === 'month' ? ' selected' : ''}>Month</option>` +
                    `<option value="quarter"${periodType === 'quarter' ? ' selected' : ''}>Quarter</option>` +
                `</select>` +
            `</div>` +
            `<div>` +
                `<label for="pulsePeriodKeySelect" style="display:block; font-size:0.85em; font-weight:600; color:#475569; margin-bottom:6px;">Selected ${periodType}</label>` +
                `<select id="pulsePeriodKeySelect" style="width:100%; padding:10px 12px; border:1px solid #cbd5e1; border-radius:8px; font-size:0.95em;"${availableKeys.length ? '' : ' disabled'}>${optionsHtml}</select>` +
            `</div>` +
        `</div>`;

        if (!window_) {
            container.innerHTML = controlsHtml + '<div style="padding:20px; color:#666; text-align:center;">No data available for that period type yet.</div>';
            bindPulseControls(container);
            return;
        }

        const { latestKey, baselineKey, allRecentKeys } = window_;
        const period = getPeriodData(latestKey);
        if (!period) {
            container.innerHTML = controlsHtml + '<div style="padding:20px; color:#666; text-align:center;">Could not load period data.</div>';
            bindPulseControls(container);
            return;
        }

        const endDate = getPeriodDisplayLabel(periodType, latestKey);
        const employees = getFilteredEmployees(period);

        if (!employees.length) {
            container.innerHTML = controlsHtml + '<div style="padding:20px; color:#666; text-align:center;">No team members found for the selected period.</div>';
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
            ? 'Your team\'s weekly trajectory at a glance. Use "Check-in" for coaching or "High-Five" for a Friday shoutout.'
            : periodType === 'month'
            ? 'Your team\'s monthly snapshot. Use each card to generate an individual monthly review.'
            : 'Your team\'s quarterly snapshot. Use each card to generate an individual quarterly review.';
        const runMyMondayBtnHtml = periodType === 'week'
            ? `<button type="button" id="runMyMondayBtn" style="background:linear-gradient(135deg,#7c3aed,#4f46e5); color:#fff; border:none; border-radius:8px; padding:10px 18px; cursor:pointer; font-weight:bold; font-size:0.95em; box-shadow:0 4px 12px rgba(124,58,237,0.3);">🚀 Run My Monday</button>`
            : '';
        const patternMemoryBtnHtml = periodType === 'week'
            ? `<button type="button" id="patternMemoryBtn" style="background:#fff; color:#4f46e5; border:1px solid #c7d2fe; border-radius:8px; padding:10px 14px; cursor:pointer; font-weight:bold; font-size:0.9em;">🧠 Patterns</button>`
            : '';
        html += controlsHtml + `<div style="margin-bottom:16px; display:flex; justify-content:space-between; align-items:center; gap:16px;">` +
            `<div>` +
                `<h3 style="color:#1a237e; margin:0 0 6px 0;">\u2600\uFE0F Morning Pulse \u2014 ${rangeText}</h3>` +
                `<p style="color:#666; margin:0; font-size:0.9em;">${pulseDescription}</p>` +
            `</div>` +
            `<div style="display:flex; gap:10px; flex-shrink:0;">` +
                patternMemoryBtnHtml +
                runMyMondayBtnHtml +
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

        // Bind Run My Monday button
        const runMyMondayBtn = container.querySelector('#runMyMondayBtn');
        if (runMyMondayBtn) {
            runMyMondayBtn.addEventListener('click', async () => {
                runMyMondayBtn.disabled = true;
                const originalText = runMyMondayBtn.textContent;
                runMyMondayBtn.textContent = '\u23F3 Building\u2026';
                try {
                    await showRunMyMondayModal(container);
                } finally {
                    runMyMondayBtn.textContent = originalText;
                    runMyMondayBtn.disabled = false;
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

                    try {
                        await navigator.clipboard.writeText(message);
                        if (typeof showToast === 'function') showToast('Check-in copied to clipboard!', 3000);
                    } catch (e) { /* clipboard not available */ }
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

                    try {
                        await navigator.clipboard.writeText(message);
                        if (typeof showToast === 'function') showToast('Monday Kickoff copied to clipboard!', 3000);
                    } catch (e) { /* clipboard not available */ }
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

                    try {
                        await navigator.clipboard.writeText(message);
                        if (typeof showToast === 'function') showToast('Midweek check-in copied to clipboard!', 3000);
                    } catch (e) { /* clipboard not available */ }
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

                    try {
                        await navigator.clipboard.writeText(message);
                        if (typeof showToast === 'function') showToast('High-five copied to clipboard!', 3000);
                    } catch (e) { /* clipboard not available */ }
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

                        try {
                            await navigator.clipboard.writeText(message);
                            if (typeof showToast === 'function') showToast((periodType === 'quarter' ? 'Quarterly' : 'Monthly') + ' review copied to clipboard!', 3000);
                        } catch (e) { /* clipboard not available */ }
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

    // Initialize - called when the Morning Pulse tab is activated.
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
        generateCheckinMessage,
        generateHighFiveMessage,
        generateMondayKickoffMessage,
        generateMidweekCheckinMessage,
        generateMonthlyCheckinMessage,
        generateQuarterlyCheckinMessage
    };
})();


