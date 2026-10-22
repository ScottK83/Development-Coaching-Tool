# Data pipeline plan (parse, store, deliver)

Written 2026-10-21 from Scott's notes on the Snapshot and Pace pages, a read of the code, and the R2 backup
(`state/latest.json`, pulled 2026-10-21 23:13). Status: **waiting for Scott's approval. Nothing below is built yet.**

## What Scott saw, and why

### Snapshot: every cell red, Team Avg equals the person, arrows backwards
- `team-snapshot.module.js:97` and `dashboard.module.js:64, 134` read `window.DevCoachModules.metrics`. Nothing ever
  assigns it, so every call through it does nothing:
  - meets-target is always false, so every cell is "Below Target" (Jadyn's 96.4 Emot against a 95 goal shows red).
  - reverse is always false, so AHT, ACW, Xfer%, #Xfer and Rel count higher as better. Angelina's 11.56 transfers
    shows a green "+4.8 above ctr".
  - numbers print raw, with no units or rounding.
  - Focus of the Day sees a 100% miss everywhere and always picks Schedule Adherence, the first metric with a target.
- The Today tab Year to date (`dashboard.module.js`) falls back to a raw comparison against the registry target. It
  has no year targets and no display rounding, so "Need coaching" can disagree with Numbers and Rankings.
- Team Avg equals the person because the Who picker (`team-hub.module.js:113`) narrows every Today tab to one person,
  so the team is one row.
- The Rel column on the shared snapshot is the period's hours (October to date) graded against the year's 17.9-hour
  allowance, and it is posted to a team chat.

### Pace: "Not achievable" for Christi's adherence
Running the real `futures` module on the backup: the YTD through Oct 18 is 92.18% over 5,315 calls, with 42 weeks done
and 10 left at about 123 calls a week. Reaching 93% needs **96.54% every remaining week**. Her best period this year
is 96.38%, and only 2 of 40 full weeks reached 96%. `isWithinReach` (`futures.module.js:652`) calls anything better
than the best period "Not achievable" and hides the number. The math is right; the label is not useful.

### Too many dropdowns
- Snapshot has three controls for one choice: type pills, a 76-item list, and Covering chips. The list holds 14
  week-in-progress, 42 week, 9 month, 3 month-to-date, 2 quarter and 7 YTD periods, most of them superseded, and it
  has no default.
- The same pile-up is on Coach (a list, chips, and radios that sit on the Upload page), Rankings (chips plus an
  8-group list), Intelligence (two pill rows for one value plus a list), Teams and Team summary.
- Covering chips (`celebrations.module.js:308-502`, `period-picker`, `period-comparison`) already answer the common
  questions.

## Damage found in the stored data

| Period | Problem | Evidence |
| --- | --- | --- |
| Week in progress Oct 19-20 | Holds the October to date file (pasted twice, a minute apart) | 50,420 calls in 2 days; rows identical to `2026-10-01\|2026-10-20` |
| Auto YTD through Oct 20 | Built as YTD through Oct 18 plus that copy, so October counts twice | Christi 5,315 + 394 = 5,709 calls |
| Weeks Feb 23 and Mar 2 | Same file under both keys (uploaded together 8/31) | Identical rows, 18,372 calls each |
| May month, weeks May 18 and Jun 1, wip May 25-26 | Pasted without a calls column; calls hold the survey count | 122 of 122 rows have calls equal to surveys; 100 to 523 calls for the center |

Correction to a chat note: a week showing "1 call, 50.8%" was Christi-Ann Thompson, not Christi Martinez-Sharp.

## Root causes in the pipeline
1. Nothing checks a paste against the period it is filed under. `parsePastedData` is handed the dates and never
   reads them; the drift gate ignores calls; nothing compares the paste with what is already stored.
2. A missing calls column is filled with the survey count for every period type (`data-parsing.module.js:686`), not
   only YTD.
3. The wizard computes its dates at page load (`script.js:1780`), so a tab left open past midnight files under
   yesterday's week.
4. Week in progress and month to date are kept after the full week or month arrives (`purgeSupersededPeriods`,
   `script.js:3524`, only purges the same type with the same start). Old YTDs and auto YTDs stay in every list.
5. A saved week, month or quarter cannot be re-uploaded; the wizard disables it and it has to be deleted first.
6. Five things answer "does this meet target", "is lower better", "format this", "team average" and "center average"
   in about 20 places, and they disagree (see the delivery map below).

## Plan (each phase ships and is tested on its own; bug fixes get a failing test first)

### Phase 1. Fix the wrong numbers (small)
- Snapshot and Year to date use the real helpers: `metricProfiles.meetsYearTarget` (year targets, judged as
  printed), `window.isReverseMetric`, `formatMetricDisplay`. Fixes the red cells, backwards arrows, raw numbers and
  Focus of the Day.
- Snapshot with one person picked: see question 1.
- Rel column on the shared snapshot: see question 2.
- Pace: show the number, not a verdict. Example: "96.5% a week (best so far 96.4%)" marked as a stretch. Keep "Not
  possible" for real impossibility (above 100%, below 0, like Rep Sat needing 127%).

### Phase 2. Stop bad data at the door (upload checks)
- Before saving, compare the paste with what is stored and stop on: identical rows to another period; calls per day
  far off for the period's length; a week smaller than its own week in progress; an in-progress period bigger than
  its finished one.
- No calls column on a non-YTD paste: store calls as unknown and say so. Never use the survey count as calls.
- Recompute the wizard's dates when Load is pressed.
- Let a week, month or quarter be re-uploaded to replace it (confirm first).
- Auto YTD never extends past a period that failed the checks, and a backfill never moves its end date backwards.

### Phase 3. Repair what is stored (Scott signs off each item)
- A "Check my data" button (Upload page) lists every problem above with a fix per item: remove the Oct 19-20 copy and
  rebuild the auto YTD; mark calls unknown on the four May and June periods; flag Feb 23 and Mar 2 for a re-paste.
- Hide superseded periods (week in progress once its week lands, month to date once its month lands, older and auto
  YTDs) from every list and default. Hidden, not deleted: contest counting reads non-overlapping uploads.

### Phase 4. One period control everywhere
- One shared control: Covering chips (This week, Last week, Month to date, Last month, Quarter, Year to date) plus one
  "Older period" list showing only complete, current periods.
- Replaces: Snapshot (pills, list, chips), Coach (list plus the Upload-page radios), Rankings (chips plus the 8-group
  list), Intelligence (two pill rows plus list), Teams pills, Team summary list.
- Defaults never land on a partial period or an auto YTD. The minimum headcount for a chip is set per screen (the 30
  rule is for the center, not a team graphic).
- The Who picker refreshes every Today tab (Year to date and Contest stay stale today).
- Settings' delete list stops steering the team filter (`team-filter.module.js:109-115`).

### Phase 5. One answer for each number
- One meets-target (metric-profiles), one reverse check (registry), one formatter, one team average
  (`team-snapshot.computeTeamMetricValue`), one center-average lookup (stored for the period, else computed from that
  period's rows). Remove the copies. The ones that disagree today: trend-intelligence sums reliability and weights
  surveys by surveyTotal; on-off-tracker averages people without weights; `metric-trends:3618` returns 0 for a missing
  center average.
- Coach goes blank when the newest period is a YTD (`coaching-email.module.js:83, 670` read only weeklyData).

### Later (TASKS.md, not in this plan)
- Two cloud syncs run side by side (manifest v2 and the legacy whole-state push); R2 blobs, conflict shards and daily
  snapshots are never pruned. Needs a worker deploy from the home PC.
- Undo after an upload does not restore archived dailies, the auto YTD, center averages or the drift baseline.

## Questions for Scott
1. Snapshot with one person picked in Who: always show the whole team (recommended, it is a team post), or show the
   one person with no Team Avg row?
2. The Rel column on the team snapshot shows each person's hours to the team chat, and it is the period's hours, not
   the year's total. Take it off the shared snapshot (recommended)?
3. Superseded periods: hide them (recommended) or delete them?
4. Can you re-pull the weeks of Feb 23 and Mar 2, and the May month and the weeks of May 18 and Jun 1, with the calls
   column? If not, those periods keep calls marked unknown.

## Reference maps (from the 10/21 read)
- Upload: one paste box; the period type is always picked in `upload-wizard`; key `start|end`
  (`script.js:3784`); ytd goes to `ytdData`, daily to `dailyData`, everything else to `weeklyData`. Stores are in
  IndexedDB (`store-registry`), with no size cap; the localStorage fallback could not hold today's 5.5 MB.
- Center averages: `callCenterAverages` keyed by the exact period key; written on upload (30+ rostered rows), by
  the manual form, and by Snapshot inputs (which overwrite the entry and drop hold time).
- Pickers: Snapshot `team-snapshot:1030`; Coach `metric-trends:266` with radios at `index.html:926`; Rankings
  `center-ranking:307-385`; Teams `matchup:139-206`; Team summary `script.js:2060`; Intelligence `index.html:1499,
  1510`; Growth `morning-pulse:4513`; Upload averages `index.html:947`; Settings delete `script.js:4893`.
