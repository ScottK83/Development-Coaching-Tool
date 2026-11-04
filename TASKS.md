# Tasks

## Open
- **Many hats review (2026-11-03), approved by Scott the same day ("Do the plans. No need to lock the site yet."):** `audit/2026-11-03-many-hats.md`. Five phases:
  1. Wording and small bugs. **Done 11/03** (A1, A5, A6, A7, S1, S4, S11, FCR icon, Copilot spelling, X4, X2).
  2. The year turnover. **Done 11/03** (Y1, Y2, X3, X5, X6). Checked on the real data with the clock on Nov 3, Dec 29, Jan 5 and Jan 12. Still owed:
     - The 2027 targets and bands in `metric-profiles`, once APS publishes them. Until then, 2026's stand and the On/Off legend says so.
     - Idea: in January the Review Year box opens on the new year, but year-end reviews are about the one before. Not changed.
  3. Data safety.
  4. Message shape. Scott didn't answer question 3, so the plan's shape is the default: praise, one focus, two standings bullets, "Where the year stands" once a month.
  5. Supervisor pages. Attendance (question 4) unanswered: default is an honest empty state, never "120h remaining" with no data, and no restore.

  Still unanswered: question 5 (blank transfer rate with calls stays blank) and 6 (Copilot account, Scott's to check). The site stays public for now.
- **Idea, not started (Scott, 11/03): pull the numbers straight from Power BI instead of pasting.** Needs APS IT: an app registration in the APS Microsoft tenant, the Power BI admin setting that allows dataset queries, and Build rights on the dataset. See the 11/03 answer in HANDOFF.
- **QA notes still public, Scott to finish (2026-10-27).** The `QA coaching` file is gone from main. Checked 2026-11-03: the main URL now returns the app, but the old deploy's own address still serves the notes.
  - Delete the Cloudflare Pages deploy `5944fe50` (commit 9d9977a). Two ways:
    - In the dashboard, open the `supervisor-dashboard` project, then Deployments, then that deploy, then Delete.
    - Or run `wrangler pages deployment delete 5944fe50-87ef-460f-91a6-57c9fe812abb --project-name supervisor-dashboard`. Claude's permission check blocked this command.
  - Optional: rewrite the history to drop commit 9d9977a and force-push. Scott has not asked for this.
- QA Coaching ideas, not built:
  - Log QA coachings in the coaching log, so What's working can see them.
  - Add reasons as new QA sessions come in. Only rate plan and payment arrangement reasons exist so far.
- Deep dive follow-ups. Phases A to F are live in v2026.10.26.8 (`audit/2026-10-25-deep-dive.md`). Still needed:
  - Scott's answers to the open questions; defaults are in place until then (see HANDOFF).
  - 3 to 5 real Verint pastes, coloured copy, to test the reader on real calls and to see why the Sep 29 call came through without speaker labels.
  - Scott to confirm two changes in the Rankings emails: the "N of M goals met" tally was dropped, and the year to date email no longer lists the center average beside each number (the picture still shows it).
  - Tone work not done:
    - The quarter recap's number lines ("Average Handle Time: Q1 451s, Q2 438s") are still a list.
    - The group "rockstars" email prompt still asks for high energy and bullet points.
    - The labels on the Today page cards ("Focus: ... vs target") are unchanged.
- Stray live data: `userCustomTips.transfers` = "Test Upload 2". Delete it only once Scott says yes.
- Data pipeline plan (approved 2026-10-22): `audit/2026-10-21-data-pipeline-plan.md`. Phase 1 is done. Next:
  - Phase 2: upload checks, and let a saved week or month be replaced, so Scott can re-pull Feb 23 to Mar 1, Mar 2 to 8, May, May 18 to 24 and Jun 1 to 7.
  - Phase 3: repair the stored data and hide superseded periods.
  - Phase 4: one period control everywhere.
  - Phase 5: one answer for each number.
- Later, from the same read:
  - Two cloud syncs run side by side, and R2 is never pruned. This needs a worker deploy from home.
  - Undo after an upload leaves the archived dailies, the auto YTD and the center averages changed.
- Scott to review the restyle on the live site; tweak what he flags.
- Restyle leftovers, optional:
  - Settings Save buttons are secondary.
  - Kit wishes not built yet: row tints on table rows, a progress meter, a .chip class.
  - baseline/outputs.txt is stale. Regenerate it with `node tests/baseline.js` if it matters. The year-standing entry errors in the baseline because it passes the wrong argument shape; that predates the deep dive.
- 30-day goal Copilot prompt (script.js `buildTrendAiGoalPrompt`) has no praise and no zero-survey or no-calls check.
- Worker auth secret needs deploying from the home PC (see memory: project_worker_auth_deploy).

## Done recently
- 2026-10-27: QA Coaching tab under People > Follow Up. It reads a Verint paste and gives the email (no score), a Copilot prompt, Copy For Verint, and Sent/Read tracking. 60 new checks; the suite is at 9990.
- 2026-10-26: deep dive plan, all six phases, from v2026.10.26.2 to .8. Tests at 9918 passing.
  - A: the call reader's 8 misreads fixed.
  - B: the call scorecard.
  - C: coaching logged when it goes out (Calls, Today "Sent", Coach page, trend email), and metrics ranked in noise steps.
  - D: call trends from the saved scorecards, on What's working and in each associate's call history.
  - E: message tone, across Rankings, pulse, celebrations, year standing, prompts and grammar.
  - F: 547 tips, the edit and delete bugs, the gaps.
  - New tab: Center > Trends > What's working.
- 2026-10-25: deep dive audit (`audit/2026-10-25-deep-dive.md`).
- 2026-10-22: data plan Phase 1.
  - The Snapshot and Year to date are judged by the real target, direction and format.
  - The Snapshot always covers the whole team, has no Rel column, leaves Calls unshaded, and merges center averages.
  - Pace shows a stretch's number and the best so far.
- 2026-10-21: restyle to match the Downloader Bot (6 steps, v2026.10.21.4 to .8).
