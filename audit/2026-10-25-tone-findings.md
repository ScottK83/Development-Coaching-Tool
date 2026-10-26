# Message tone audit, every finding

Audited 2026-10-25. Sources: a fresh run of tests/baseline.js (the committed baseline/outputs.txt is from Sep 22, before the Oct 14 voice work) and every exported generator wrapped while all 193 test files ran (9,260 passed): 17,173 distinct outputs. Fixture stub formatters were traced to real code; test-only artifacts were thrown out (".0" in quarter outputs, "AHT 7:41", "Adherence +3.1", "Hold Time at 1", "#17 in the Call Center" near miss, the repeated tip, Monday kickoff "0% this week"). Line numbers are as of 2026-10-25, version 2026.10.22.1.

## Verdict by family
- Natural: call drafts (strengths and improvements), call feedback and call metric messages (mostly), celebration DMs (mostly), high fives (mostly), the quick check-in prompt.
- Partly: Today private round, Monday kickoff, check-ins and monthly (openers and closers vary, but the body is always praise, a standalone bridge line, "Focus: X. N, YTD N, target N.", then "Tip:"); team shout-outs; quarter check-in notes.
- Not yet: rankings emails (monthly, month over month, YTD), quarter recap email, Friday week progress, growth message, midweek check-in, follow-up email (one fixed text), sentiment summary, Verint note.

## Top problems
1. Rankings monthly email reads as a report. "Here is where June 2026 stands so far against target: - Average Handle Time: 405s (goal: 426s or lower). Met. ... That is 5 of 5 goals met so far. Happy to walk through any of it." `center-ranking.module.js` buildMonthlyStatsEmail, about 2721 to 2795. Five "label: value. Met." lines, no warm word even for a perfect month, "0 of 5 goals met" for someone missing everything. Rewrite idea: "June is shaping up really well, every goal is on target so far: handle time 405 seconds, adherence 95.2%..."
2. "First, the good news" praises a miss: "your Schedule Adherence is the closest to goal so far in June, at 92.5% against the 93% goal, and that is a strong base to build on." `center-ranking.module.js` 2308 to 2325; same pool `morning-pulse.module.js` 254, 255, 268, 269 and `message-voice.module.js` about 386 to 390. Rewrite idea: "Adherence is right at the edge, 92.5% with a 93% goal. Half a point, and you can get that this week."
3. Harsh focus lines: "Let's close that gap for real this time.", "This one needs real attention.", "It's been a pattern, not a blip.", "We need to turn this around." `morning-pulse.module.js` FOCUS_PERSISTENT 282 to 288, plus 477 and 1053. Rewrite idea: "Handle time is the one I'd love us to work on. 520 now, goal 426, let's knock off the first 30 together."
4. Year standing tells people they are being passed: "others have been moving ahead of you on this", "the floor has been passing you here". `year-standing.module.js` 37 to 41. Close to the banned "N people ahead of you".
5. Stacked numbers: "628s last week, YTD at 626s, target 426s.", "YTD 626s vs target 426s.", "down 202 seconds. (617s to 415s)" (the bracket range is in 2,217 of 4,086 morning pulse messages). `morning-pulse.module.js` FOCUS pools and fmtRange (1881) used in the jump intros 2395, 2612, 2800. Rewrite idea: "came down 202 seconds, from 617 to 415."
6. Stitched fragments: "Oh and Overall Sentiment is cruising along... Oh and did I mention Schedule Adherence at 95.1%? Because yeah, that happened too." (`morning-pulse.module.js` 85 plus 803 and 1126); "One thing worth trying: ... Try those out" (`call-coaching-bridge.module.js` 1469 to 1472); "keep up the great work in these areas" about one metric (`copilot-prompt.module.js` 333).
7. Friday week progress and growth messages read like dashboards: "Where you landed:", "Better than two weeks ago:", "Worth a push next week:", "Side by side:", "Slipped a bit:" bullets, "Focus area:". `daily-outreach.module.js` 406 to 470; `morning-pulse.module.js` 4178, 4458, 4473.
8. Corporate lines: "We identified Average Handle Time as the one to move this week.", "We chose ... as the lever to pull", "new week, new opportunity", "let's talk opportunity", "Main focus going forward:". `morning-pulse.module.js` 566, 572, 387, 941.
9. Team post placings: "Average Handle Time at 405s. #1 in the Call Center. They set the bar and stood there alone!", "Tied for 4th best in the Call Center. Top 5!", about 20 bullets in one baseline post ending "Tied for #1 in the Call Center." `celebrations.module.js` 1484 to 1493, 1910, 1911; tier tail 1323 to 1326. "#1" is written, not said; "Top 5" after "4th best" says it twice; "they" about @Ada reads as someone else.
10. Copilot prompts that push stiffness: `metric-trends.module.js` buildTrendCoachingPrompt (about 2355) opens "You are the AI Intelligence Layer..." with "STRENGTHS TO LEVERAGE", "LEADERSHIP COMPETENCY CONNECTION" and a canned line per row ("demonstrates building momentum and coachability", "requires focused coaching to prevent broader impact", about 2311). The weekly coaching prompt (`coaching-email.module.js` 584, 585) asks for "clean bullets" and "write each number the way it is given", which returns "• Hold Time: 25s, goal 30s or lower"; `trend-coaching-email.module.js` 303 the same. The mid-year prompt (`on-off-tracker.module.js` 1081) carries the "disciplinary action" paragraph and "areas of opportunity". Model to copy: the quick check-in prompt (893 to 899), "like a real person typing in a Teams chat", with example numbers said out loud.

## Repetition hot spots
- "Happy to walk through any of it." is the only closer on all four email types (50 of 50 captured).
- Call feedback opener is fixed in all 22 captured ("I was doing some call listening for coaching... I wanted to share my feedback with you.", `call-listening.module.js` 522). It is Scott's own wording, so changing it is optional.
- Follow-up email is one fixed text (`metric-trends.module.js` about 1548 to 1575). Quarter recap: one opener, three closers.
- Quarter notes: "held steady" 83 times in 42 documents (three times in 22 of them); "every quarter of it inside the ... goal" 50 times.
- "Closest to goal" praise: 439 messages from 13 generators.
- DMs: "better than N of N associates!" 1,672 times; "That's #1 out of N associates." 1,666 times; the same idea twice in one DM ("hear it from me" 32, "reach out" 30).
- Team post: median 7 "in the Call Center" and 14 "!" a post.
- High fives: "There's nothing left to ask for." 394; "basically the perfect run" 377; "run" twice in one message 42.
- Monday kickoff: "I think you can get there." 283.

## Rule breaks
- More than 2 emojis: month over month and YTD rankings emails put one on every line, 5 to 6 an email, limitEmojis never called (`center-ranking.module.js` 2102 to 2145, 2470 to 2482). Sentiment summary has 6 or more.
- Moves not in words: "better by 60s", "off by 7s" (`center-ranking.module.js` 2141). Column jargon "CX Adv", "AHT" in associate emails.
- ".0" and a/an: "95.0% against a 86% goal" (`sentiment.module.js` 956).
- Spaced hyphens as dashes: "DOING WELL - You used...", "Great news - here's what we can do" (`sentiment.module.js` 808, 832); "human - not robotic" (`year-end.module.js` 146); Verint note "Coaching Session with Zed - 8/11/2026".
- Placing style "#1 in the Call Center" instead of the ordinal.
- Reliability (borderline): monthly email says "Reliability: 18 hrs (goal: 17.9 hrs or lower). Not there yet." and counts it in "4 of 5 goals met", and reads as June's hours though the figure is the year's running total.
- 0 second handle time (likely live, verify): the trend prompt input can say "Average Handle Time ... current 0s ... fell by 600 seconds vs previous, which is better". coachableTrendMetrics (`metric-trends.module.js` 1123) has no no-calls check.
- Zero-survey rows as 0% in the same prompt: not confirmed live.

## Grammar slips
- "All 1 disclosures that applied..." (`call-qa.module.js` 184); "used 1 times" (`sentiment.module.js` 808); `opened with: "...this month.".` doubled stop (`call-summary.module.js` 374).
- "...2 calls reviewed, on average handle time, rep satisfaction" no "and" (`quarter-review.module.js` 1931), feeds the year-end prompt.
- Hard-coded "she": "decide what she should improve" (`call-listening.module.js` 197).
- "move from 604s to at least 533s": "at least" is wrong for a lower-is-better metric (`metric-trends.module.js` 2282).
- "...the week of Oct 5, and first, nice work." awkward join; a date line dangling after a colon in DMs ("...I have to say something:\nOct 5 to 11").
- Year-end verbal script reads form labels aloud: "Your overall performance rating is: On Track/Successful. Your merit increase details are: 3% effective 1 March." (`year-end.module.js` 239 to 241).

## Other
- Verint note is HR boilerplate and claims "Zed acknowledged the feedback and committed to implementing..." (`copilot-prompt.module.js` 329 to 345). Supervisor only, lower stakes.
- Sentiment summary hands associates stiff scripts: "I appreciate the opportunity to assist you today", "We've accomplished great things together today" (`sentiment.module.js` 776 to 786).
- Fallback tips (empty pool) are corporate and double the label ("Tip: Average Handle Time: Focus on..."). How often live: not confirmed.
- Unsure: "Met goals: undefined" in the year-end prompt (probably a harness gap); the Verint summary prompt says write to the associate as "you" though the log is supervisor only.
- Not checked: the Today page renderers (they return HTML; only what they call was read).
