# Handoff

Last updated 2026-10-21, version 2026.10.21.8, suite at 9222 passing.

## Where things stand
- **Data pipeline plan, approved 2026-10-22:** `audit/2026-10-21-data-pipeline-plan.md` (Scott's four answers are at its top). **Phase 1 is done** (2026-10-22): the Snapshot and the Year to date tab use the real helpers (`metricProfiles.valueMeetsTarget` with the year's target, `window.isReverseMetric`, `window.formatMetricDisplay`) instead of the never-registered `DevCoachModules.metrics`; the Snapshot always covers the whole team (`ignoreTeamScope`), has no Rel column, leaves Calls unshaded, and merges center averages instead of replacing them; Pace shows "96.5%/wk, Stretch: best so far 96.4%" and keeps "Not possible" for over 100% or under zero. Tests: `tests/snapshot-pace-truth.test.js`. Checked on the real October data. **Next: Phase 2** (upload checks, and let a saved week or month be replaced so Scott can re-pull Feb 23, Mar 2, May, May 18 and Jun 1).
- Done: restyle to match the Downloader Bot (Scott, 2026-10-21: "Dark only. Sidebar nav."). Dark-only tokens, `modules/sidebar.module.js`, the KIT classes in styles-v2.css, every page swept off hard-coded colours, the old forced dark layer removed, Teams cards shown light on screen. Build new UI with the KIT; never hard-code colours. Scott has not reviewed it yet.
- Scott is working through the Today page's private round on real data and sending notes.
- Latest change: the private standings block names both placings for every metric ("93rd in the Call Center, 11th on our team"), with no "N people ahead of you" counts and no top 15 bar. A last place (Call Center or team) is left off. The team note no longer has a built-in default; nothing is added unless Scott writes and saves one.
- Before that (10/14): every associate message, call or metric, carries real praise. Calls use a praise floor in `call-transcript` (`addFloorPraise`); metric messages use `messageVoice.truePositive`.

## Next
- See TASKS.md.
