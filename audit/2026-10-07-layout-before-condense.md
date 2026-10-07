# The app's layout before the condense, 2026-10-07

This records how the app looked before it was reorganized into Today / People / Center. It is here in case anything needs to come back.

## Getting the old version back

- **Git tag:** `backup-pre-condense-20261007`, on commit `55814d94` (app version `2026.10.07.4`). It is the last version with this layout.
- **See the old code:** `git show backup-pre-condense-20261007:index.html`, or check out the tag in a separate worktree.
- **Restore one file:** `git checkout backup-pre-condense-20261007 -- <path>`
- **Restore everything:** revert the condense commits, or reset a branch to the tag and push. Data is untouched either way, because the condense moves screens, not stores.

## Top nav (8 items)

Dashboard (the landing page), Upload, My Team, Trends, Review Prep, Follow Up, Contest, Settings, plus the dark-mode and keyboard-shortcut buttons. Markup is in `index.html:24-33`. The section switcher is `modules/navigation.module.js`, and the tab click handlers are in `script.js` `bindNavigationHandlers` (~1859-1962). Several tabs are written inside My Team's markup and moved into Trends or Review Prep on first use (`script.js` ~1965-2024).

## Every screen

Clicks count from app load, and the top-nav click is 1.

### Dashboard (landing page, 1 click)
`modules/dashboard.module.js`. It reads only the newest YTD file.
- **Summary bar:** Team Members, Meeting All Targets, Need Coaching.
- **Year-End KPI Scorecard:** reps grouped 5 to 0 by how many of Adh, AHT, Sent, Rep Sat and Rel score 2 or more, with a coloured dot per KPI.
- **Top Coaching Priorities:** every rep under target, sorted by gap, with "x of y targets met", the worst 3 as pills, and a **Coach Now** button that opens My Team > Coaching with the associate picked.
- **Meeting All Targets:** pills naming the associates who meet every target.
- **Tip of the Day:** a random coaching tip.

### Upload (1 click)
`index.html:47-218`, `modules/upload-wizard.module.js`, `script.js` ~1686-1787 and ~3195-3915.
- **Buttons:** Upload Metrics (it only reveals the paste box), Upload Sentiment (modal), Upload Employee Verint, Upload Payroll Excel, Upload PTO PDF.
- **Paste path:** paste box, period dropdown, year-end profile, Load or Test, then the success column inspector, data health scan, storage bar and undo banner.
- **Where each upload goes:** Verint and payroll go to Attendance, the PTO PDF to the PTO tracker, and sentiment to the saved snapshots that Metric Charts reads.

### My Team
`modules/my-team.module.js`, `team-hub`, `team-scope`, `day-posts`, `daily-outreach` and `highlights`, plus the morning-pulse, celebrations and cheerleading engines.
- **Day page (1 click):**
  - Team scope bar ("Who"), weekday tone tabs (Mon to Fri) and Covering window chips (Yesterday, This week, Last week, Month to date, Last month, Year to date) with a comparison line.
  - Cards: Team shout-out (Placings or Beat a target, Top N, History), Private round and High five round.
  - Per-person tones: High five, Placings, Cheer, Check-in, Growth (its own comparison picker), Monthly review (Last month window only) and Shout-out.
  - "What's behind it" panel: Team Pulse status cards with "Write to", the day-file table, and a Patterns button that opens the pattern-memory modal.
- **Quiet links:**
  - **Coaching (about 4 clicks):** Select Associate, then the Latest Performance Snapshot (wins and focus areas), Coaching History with outcomes, Quick Check-in, CoPilot Prompt with Outlook paste-back, and Copy Verint Summary. `modules/coaching-email`, `coaching`, `copilot-prompt`, `coaching-outcomes`; `script.js` ~7369-7438.
  - **Snapshot (about 5 clicks):** period, then Generate Team Snapshot or Generate Scorecard (two PNGs of the rep-by-metric grid, coloured against target or against the center), then Copy or Download. `modules/team-snapshot.module.js`.
  - **Calls (2 clicks):** paste, flags, what went well and what to work on, Copilot: Write The Summary, paste-back, Copy For Verint, Copilot: Write The Email. The More fold holds the full read, QA, metric read, language, Outlook send, history and saved calls. Code is in the `modules/call-*` modules and `script.js` ~7438-9925.
  - **Attendance (about 3 clicks):** the reliability tracker (review queue, per-employee breakdown, PTOST ledger, WFM update list, discrepancies, Export CSV) above the payroll PTO tracker (balance, carryover, allotment, entries). `modules/reliability.module.js`, `pto.module.js`.

### Trends (8 tabs; it opens on Intelligence)
- **Intelligence (1 click):**
  - Yearly Individual Summary: a YTD table plus 13 Chart.js bar charts, one per metric across every upload, for one associate.
  - The Trend Intelligence & Coaching Hub, with its own associate picker: Simple View, the multi-period tracker, Quick Summary, warnings and wins, the Coaching Impact Score, and 6 bar charts. Its buttons are coaching email, Copy This Week Plan, AI Explain and AI 30-Day Goal.
  - Coaching Impact Tracker card.
  - Weekly Priority Queue: Coach Now, Recognize Now and Watchlist.
  - Note: the hub is only set up after a team-filter change, and Focus Mode then hides it. See the overlap audit, item 1.1.
  - Code: `modules/executive-summary`, `trend-intelligence`, `trend-coaching-email`; `script.js` ~5124-7032.
- **Metric Charts (about 5 clicks):**
  - Call Center Averages editor.
  - Generate Trend Email: period and associate, then Send Metrics (PNG) or Coaching Follow-up (app email plus a deep Copilot prompt with an Intelligence Snapshot table and Sentiment Focus), Generate All (it has never worked), and Generate Team Summary.
  - Code: `modules/metric-trends.module.js`; `index.html:853-1042`.
- **Rankings (2 clicks):**
  - Your Team cards (movement sentence, timeline strip, "better than X%").
  - Full Center Rankings: rank #N of total, KPIs met, Score Sum, KPI Score, Status, each KPI's value and rank, and month-over-month.
  - Period chips and a dropdown.
  - Trajectory modal per person, with the ladder, "Where that lands" and the year card PNG.
  - Month-over-month and monthly-stats emails.
  - Code: `modules/center-ranking.module.js`, `rank-projection.module.js`.
- **Futures (2 to 3 clicks):** for each My Team associate, the YTD value, target, status, and the average needed to Meet or Exceed by day, week or month, plus the hours budget left. Check-In Summary modal. `modules/futures.module.js`.
- **Sentiment (3 clicks):** Generate Summary, Copy Summary, Generate CoPilot Email. It cannot run (overlap audit, item 1.2). `modules/sentiment.module.js`.
- **Matchup (2 clicks):** Team Movement, head-to-head, Team Power Rankings (Avg Score, Avg Rank, Record), the ranking diagnostic, and a roster table per team. `modules/matchup.module.js`.
- **Year-over-Year (2 clicks):** each associate's current year against a prior-year baseline (which can be pasted), as a single metric or every KPI, sortable, with "Summarize for my leader". `modules/yoy-comparison.module.js`.
- **Patterns (2 clicks):** Consistency (std dev, CV, range), Streaks against target, and Tip effectiveness. `modules/metric-stability.module.js`.

### Review Prep (5 tabs; it opens on Score Card)
- **Meetings (about 4 clicks):** associate, then the year so far from the newest YTD against target, change since the last meeting, last month, the last few weeks, last time's notes, your notes, Save, Copy talking points, and past meetings. `modules/one-on-one`, `one-on-one-ui`, `year-standing`.
- **Score Card (about 3 clicks):** associate and year, the band legend and facts line, then the On/Off Track Result table (Metric, Actual, Annual Goal, Stretch Goal, Score, Gap to Next, rating average and status), Calculate, the Team On/Off Summary, and the Goal-Pace Check-in Prompt. `modules/on-off-tracker.module.js`.
- **Quarterly (about 6 clicks):**
  - Associate (its picker does not follow the shared selection) and quarter.
  - The Q1/Q2/Q3 progression table, with reliability as a running total.
  - "What each quarter is built from".
  - The placings panel, with a YTD column.
  - Talking points and the Copilot reword.
  - The check-in document: header, your notes, and the Progress & Strengths and Areas of Focus boxes.
  - Q3 recap emails, with the "x of N sent" log.
  - Code: `modules/quarter-review-ui`, `quarter-review`, `quarter-trend`, `quarter-recap`.
- **Mid-Year (about 5 clicks):** associate and year, the Status override (Auto, On Track, Off Track), development notes, Generate (copies and opens Copilot), and a Posted checkbox. The Copilot prompt asks for the Progress & Strengths and Areas of Focus boxes. `modules/on-off-tracker.module.js` ~883-1406.
- **Year-End (about 8 clicks):**
  - Setup: associate, year, and Year-End Status auto-filled from the mirror, plus a Calculate On/Off Tracker button.
  - The On/Off Track Mirror (the same table as Score Card).
  - Positive Highlights and Improvement Areas (every metric against target).
  - Annual APS Goals.
  - Notes, and the Verbal Review Summary (Generate and Copy).
  - The Year-End Copilot prompt, the Final Notes paste-back, and Copy Box 1 / Box 2.
  - Code: `modules/year-end-comments`, `year-end`; `script.js` ~4188-4712, ~9925-10121.

### Follow Up (1 click)
`modules/red-flag.module.js`. It has three modes:
- **To-Do Follow Up:** type, associate and account, then Build Follow Up Draft, the preview, Open Email Draft or Copy, and a history list.
- **Survey Feedback Coaching:** paste a survey ticket, parse it, then Copy & Open Copilot.
- **Red Flag Coaching:** the Experian verification email.

### Contest (1 click)
`modules/contest.module.js`, `contest-ui.module.js`, and `raffle.html` (the /raffle meeting screen).
- **Setup:** date and team bar, and the Enter a day grid.
- **Uploads:** Pull from uploads, Start the month over, the board check strip, and "Where surveys came from".
- **Standings:** the standings table, the standings graphic (Copy the graphic) and Post to Teams.
- **Draws:** Draw a winner, and Open the raffle screen.

### Settings (5 tabs)
- **Team Members:** roster checkboxes, inactive associates with Reinstate, the CC address and the associate address pattern.
- **Coaching Tips:** the tip editor.
- **Scored Phrases:** five phrase banks, and an "Associate Sentiment Snapshots" panel that never fills.
- **Sync & Backup:**
  - Legacy "Cloud Sync": Send Data, Receive Data, and the Excel and file access.
  - Per-store "Cloud sync": Pull, Re-download everything, Push, Test and Health.
  - JSON backup, coaching CSV, Restore, and point-in-time restore.
- **Delete Data:** delete one period, delete sentiment, delete an associate-year, Backup Metric Data, clear the drift baseline, reset metric data, and delete all.
- **Debug panel:** reached from its own button, not the nav.

## Associate pickers in this layout

There are fourteen associate pickers. Most share one selection through `modules/selected-associate.module.js`: Score Card, Mid-Year, Year-End and Attendance do, and Meetings does by hand. Quarterly, Trends > Intelligence (two pickers), Metric Charts, Futures and Follow Up keep their own.

## What replaces it (decided 2026-10-07)

```
Today (landing)          People                              Center            Upload   Settings
├ Day page               [ pick the associate once ]         ├ Rankings
│  + who to coach        ├ Numbers                           ├ Teams
│  + YTD under target    ├ Coach                             ├ Pace
├ Snapshot               ├ Calls                             ├ Trends
└ Contest                ├ Attendance                        └ Intelligence
                         ├ Follow Up
                         └ Reviews: 1:1 | Quarterly | Mid-Year | Year-End
```

Scott's decisions:
1. Reviews lives inside People, not as its own top-nav item.
2. Intelligence is kept for now. It moves under Center as a whole and gets fixed so it loads, rather than being split up.
3. Mid-Year is fine as a switch inside Reviews, reversing its own-tab decision.
4. The duplicates go: the Dashboard's Year-End KPI Scorecard, the Coaching tab's Quick Check-in, one of the two goal-pace check-ins, and the duplicate coaching-impact panel. With Intelligence kept whole, the changes inside it (its three Copilot buttons, the impact tracker) wait until Scott has tried it.

The detail on each duplicate and fix is in `audit/2026-10-07-overlap-audit.md`.
