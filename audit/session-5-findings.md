# Session 5 — Review Prep flow

Scope: Review Prep nav + 3 subtabs (Score Card / On-Off Tracker, Quarterly, Year-End).
Modules: on-off-tracker (1,100 lines), q1-review (784), year-end-comments (766), year-end (109).

Verified each finding against code before writing.

Severity: 🔴 real bug / risk · 🟠 rot / tech debt · 🟡 minor cleanup · 🟢 cosmetic

---

## 🟠 Rot / dead code

### R-1 · Two-tier dead fallback in on-off-tracker legend bands
- [modules/on-off-tracker.module.js:394-426](../modules/on-off-tracker.module.js#L394-L426) — `getOnOffTrackerLegendBandsByYear()` has three tiers:
  1. Read from `metric-profiles` module (always loaded, foundation-tier)
  2. Read `window.METRIC_RATING_BANDS_BY_YEAR` — **never set anywhere**. Only `const METRIC_RATING_BANDS_BY_YEAR` exists in script.js:194 but it's `const`, not on window.
  3. Hardcoded fallback bands (5 metrics, stale values — e.g. `overallSentiment` score3 is `{ min: 90.1 }` here but `{ min: 90 }` in metric-profiles; `aht` score3 is `{ max: 419 }` here but `{ max: 414 }` in canonical 2026 profile)
- **Impact:** tier-2 is dead. Tier-3 would only fire if metric-profiles failed to load — in which case it'd display the wrong numbers.
- **Recommendation:** delete tiers 2 and 3. Keep only the metric-profiles read. If metric-profiles isn't loaded, that's a bug worth surfacing, not papering over with stale fallback.
- Decision: `[ ]`

### R-2 · Orphan `yearEndDraftContext` global in script.js
- [script.js:100](../script.js#L100) — `let yearEndDraftContext = null;` declared globally.
- [script.js:2871](../script.js#L2871) — reset to `null` during data reset.
- Never read anywhere in script.js.
- The real `yearEndDraftContext` is module-scoped in [modules/year-end-comments.module.js:24](../modules/year-end-comments.module.js#L24) and is an entirely separate variable.
- **Recommendation:** delete the global from script.js. The reset at line 2871 is also dead — remove it too. (Or: if the reset is needed during "clear all data" to nuke the module's local state, expose a `resetYearEndDraftContext()` method on the module and call that.)
- Decision: `[ ]`

### R-3 · Copilot URL hardcoded in 3 places
- [modules/q1-review.module.js:769](../modules/q1-review.module.js#L769), [modules/year-end-comments.module.js:509](../modules/year-end-comments.module.js#L509), [:546](../modules/year-end-comments.module.js#L546) — `https://copilot.microsoft.com`.
- Low risk of change, but still a duplication.
- **Recommendation:** add `COPILOT_URL` to `DevCoachConstants`. Small win, only worth doing if you're touching those files anyway.
- Decision: `[ ]`

---

## 🟢 Verified — no findings

### R-4 · `year-end.module.js` is NOT a stub (reverses Session 1 F-13)
- Flagged in Session 1 findings as a 109-line "stub — possibly partial." Verified: it's a clean, focused module exporting 3 functions (`buildCopilotPrompt`, `extractBoxText`, `buildVerbalSummary`) used by year-end-comments.module.js. No fix needed.

### R-5 · `initializeOnOffTracker` called from 2 places, but bindings are guarded
- Called from script.js:1662 (Review Prep button) + :1667 (Score Card subnav). Uses `_bindElementOnce` which delegates to `window.bindElementOnce` (script.js:7945) and respects `element.dataset.bound`. No stacking. (Same pattern TR-1 fixed for metric-trends; Review Prep was already safe.)

### R-6 · `year-end-comments` module uses `bindOnce` helper on every listener
- All bindings in the 766-line module go through the guarded helper at [modules/year-end-comments.module.js:29-33](../modules/year-end-comments.module.js#L29-L33). Only 1 `addEventListener` call exists — inside the helper.

### R-7 · `q1-review` rebuilds DOM via `innerHTML =` before every listener binding
- Listeners die with their parent elements on re-render, so no stacking.

---

## Summary

| Severity | Count | IDs |
|---|---|---|
| 🟠 Rot / dead code | 3 | R-1, R-2, R-3 |
| 🟢 Verified clean | 4 | R-4 through R-7 (no-op) |

No real bugs found in Review Prep. Modules are the cleanest subsystem of the app so far — bindOnce helper + innerHTML-rebuild patterns are used consistently.

**Most impactful:** R-1 (delete the dead fallback tiers before they become a silent failure mode).

Mark `[KEEP]` or `[FIX]` per item, or say "fix all".
