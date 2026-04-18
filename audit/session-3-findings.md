# Session 3 — My Team flow

Scope: My Team navigation + 5 subtabs (Morning Pulse, Coaching, Snapshot, Call Listening, Attendance). Modules: morning-pulse (2,509 lines), coaching-email (733), coaching (139), coaching-analysis (326), team-snapshot (1,264), call-listening (143), reliability (2,594), on-off-tracker (1,100), celebrations (1,095).

Severity: 🔴 real bug / risk · 🟠 rot / tech debt · 🟡 minor cleanup · 🟢 cosmetic

---

## 🔴 Real bugs / risks

### T-1 · Reliability detail panel re-binds event listeners without cleanup
- [modules/reliability.module.js:2179-2267](../modules/reliability.module.js#L2179-L2267) — `renderEmployeeDetail()` is called from `bindReliabilityControls()` at [:2495](../modules/reliability.module.js#L2495) and [:2508](../modules/reliability.module.js#L2508) each time an employee is selected. Every render adds listeners to persistent DOM elements (`relTabDisc`, `relTabClassic`, `relEmailCorrections`, etc.) without `removeEventListener` or a `dataset.bound` guard.
- **Impact:** clicking the email button after viewing 3 employees fires the handler 3× → potential duplicate emails or stale closures over old employee names.
- **Recommendation:** adopt the `dataset.gateBound` pattern used elsewhere (e.g. team-snapshot.module.js:1129-1166), or call `removeEventListener` with the same handler reference before each `addEventListener`.
- Decision: `[ ]`

### T-2 · "Today" timestamps use UTC instead of local time (drift across midnight)
- [modules/reliability.module.js:477](../modules/reliability.module.js#L477), [modules/morning-pulse.module.js:1384](../modules/morning-pulse.module.js#L1384), [modules/pto.module.js:1083](../modules/pto.module.js#L1083), [modules/sentiment.module.js:162](../modules/sentiment.module.js#L162) — all use `new Date().toISOString().slice(0, 10)` (or split on `T`) to format today as `YYYY-MM-DD`.
- **Impact:** in any timezone behind UTC, between local-midnight and UTC-midnight (5-8 hours depending on DST/zone), this returns *tomorrow's* date. Same bug class as the sentiment U-1 fix from Session 2.
- **Recommendation:** add a shared `formatLocalDate(date = new Date())` helper to shared-utils and replace all four usages.
- Decision: `[ ]`

### T-3 · Morning Pulse has 19 click bindings and zero rebind guards
- [modules/morning-pulse.module.js](../modules/morning-pulse.module.js) — 19 `addEventListener` calls, 0 `removeEventListener`, 0 `dataset.bound` guards.
- Most bindings are inside modal overlays that get recreated and removed wholesale (so listeners die with the element — safe). But some bindings on *persistent* DOM (the main pulse container, focal-point inputs) likely stack across re-renders.
- **Recommendation:** spot-check `renderMorningPulse` and the focal-point UI for accumulated handlers. Add `dataset.bound` guards on persistent-element bindings.
- Decision: `[ ]` (needs verification — flagging for awareness)

### T-4 · `initializeCelebrations()` called twice
- [script.js:1594](../script.js#L1594) (My Team button click) and [script.js:1598](../script.js#L1598) (Morning Pulse subtab click).
- Module's `bindInnerNav()` is guarded by an internal flag, but `switchInnerTab()` runs both times.
- **Recommendation:** call once from a single canonical entry (the My Team button is sufficient since Morning Pulse is the default subtab).
- Decision: `[ ]`

---

## 🟠 Rot / duplication

### T-5 · `initializeCoachingEmail` has a fallback path that duplicates module logic
- [script.js:7112-7145](../script.js#L7112-L7145) — script.js defines a fallback that runs if `coachingEmail` module isn't available, duplicating UI state reset and data population.
- The module loads as part of the standard module chain — the fallback is dead in practice.
- **Recommendation:** delete the fallback. Keep the delegating wrapper that just calls `window.DevCoachModules?.coachingEmail?.initializeCoachingEmail?.()`.
- Decision: `[ ]`

### T-6 · `team-snapshot` reads `weeklyData` / `ytdData` / `myTeamMembers` directly from localStorage
- [modules/team-snapshot.module.js:91](../modules/team-snapshot.module.js#L91), [:100](../modules/team-snapshot.module.js#L100), [:107](../modules/team-snapshot.module.js#L107), [:201](../modules/team-snapshot.module.js#L201) — bypasses both the in-memory globals (script.js `let weeklyData = {}`) and the storage module load helpers.
- **Risk:** if the user uploads new data and immediately opens Snapshot, the module reads the freshly-saved localStorage value (which works), but if anything ever holds the in-memory globals out-of-sync with localStorage, snapshot would diverge from the rest of the app.
- **Recommendation:** read from `window.weeklyData` / `window.ytdData` / `window.myTeamMembers` directly (the in-memory canonical) with a fallback to `storage.loadWeeklyData()`. Consistent with how other modules access these.
- Decision: `[ ]`

### T-7 · `reliability` module bypasses storage module if storage hasn't loaded — but always could
- [modules/reliability.module.js:14-27](../modules/reliability.module.js#L14-L27) — `loadStore` and `saveStore` try the storage module first, then fall back to direct `localStorage` access.
- Storage module is foundation-tier and loads before reliability, so the fallback never fires in practice. Dead branch + extra string concatenation hardcoding the prefix.
- **Recommendation:** delete the fallbacks; rely on storage module being available (or add a single `console.warn` if it isn't, so the invariant break is visible — same fix style as PTO U-19).
- Decision: `[ ]`

---

## 🟡 Minor cleanup

### T-8 · Morning Pulse + Celebrations write directly to localStorage with their own keys
- [modules/morning-pulse.module.js:653-668](../modules/morning-pulse.module.js#L653-L668) (PULSE_SELECTION_STORAGE_KEY), [:1376-1392](../modules/morning-pulse.module.js#L1376-L1392) (FOCAL_STORAGE_KEY)
- [modules/celebrations.module.js:47-129](../modules/celebrations.module.js#L47-L129) (4 keys: threshold, history, selection, inner-tab)
- Bypasses `saveWithSizeCheck`, so a runaway focal-points list could exceed 4MB silently. Less risk here than for weeklyData (small payloads), but inconsistent with the storage-module pattern.
- **Recommendation:** route through `storage.saveWithSizeCheck(key, data)` for size enforcement. Alternatively, document the bypass.
- Decision: `[ ]`

### T-9 · `restoreLastViewedSection` simulates clicks instead of calling display fns directly
- [modules/navigation.module.js:256-293](../modules/navigation.module.js#L256-L293) — uses `button.click()` to restore navigation state. Couples the navigation module to the button-handler internals; if a sub-nav button is renamed or its handler is moved, restoration silently breaks.
- **Recommendation:** call `showMyTeamSubSection`, `showTrendsSubSection`, etc. directly instead.
- Decision: `[ ]`

### T-10 · Reliability tab state isn't persisted across re-renders
- [modules/reliability.module.js:2164-2178](../modules/reliability.module.js#L2164-L2178) — `setTab()` uses a local closure variable; switching off and back to the panel resets the tab.
- Minor UX issue.
- **Recommendation:** persist to `container.dataset.activeTab` or a small in-memory flag.
- Decision: `[ ]`

### T-11 · `call-listening.module.js` is 143 lines that mostly delegate to script.js
- [modules/call-listening.module.js](../modules/call-listening.module.js) — thin wrapper. The actual `initializeCallListeningSection` is in script.js:7733.
- Architecturally inconsistent vs. coaching-email / reliability which are full modules.
- **Recommendation:** out of Session 3 scope; flag for Session 7 (cross-cutting cleanup) — either move call-listening fully into the module or delete the module shell.
- Decision: Deferred to Session 7

---

## Summary

| Severity | Count | IDs |
|---|---|---|
| 🔴 Real bugs / risks | 4 | T-1 through T-4 |
| 🟠 Rot / duplication | 3 | T-5, T-6, T-7 |
| 🟡 Minor cleanup | 4 | T-8, T-9, T-10, T-11 (deferred) |

**Most impactful:** T-1 (reliability double-binding — real risk of duplicate sends), T-2 (UTC date drift in 4 modules — affects "today" logic across timezone boundaries).

Mark `[KEEP]` or `[FIX]` next to each decision line when ready. Or just say "fix all" — same workflow as Sessions 1 & 2.
