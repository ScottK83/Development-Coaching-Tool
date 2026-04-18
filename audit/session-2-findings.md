# Session 2 — Upload flow

Scope: Every upload surface — PowerBI metric paste, sentiment upload, Verint Excel, payroll Excel, PTO PDF, upload wizard + YTD/daily pickers, year-end profile selector, legacy hidden period controls (F-17/F-18 from Session 1).

Severity: 🔴 real bug / risk · 🟠 rot / tech debt · 🟡 minor cleanup · 🟢 cosmetic

---

## 🔴 Real bugs / risks

### U-1 · Timezone-off-by-one in sentiment date math
- [modules/sentiment.module.js:1221-1223](../modules/sentiment.module.js#L1221-L1223) — computes the lookback window with `new Date(pullDate)` + `setDate(-14)` then calls `.toISOString().split('T')[0]`. `<input type="date">` returns `YYYY-MM-DD` in **local** time; `toISOString()` converts to UTC. In any timezone behind UTC the saved "start" date lands a day early.
- **Recommendation:** parse the YYYY-MM-DD manually via `split('-').map(Number)` and construct the date with explicit Y/M/D. Consistent with the pattern in script.js:2085.
- Decision: `[ ]`

### U-2 · Console.error spam in sentiment upload (not DEBUG-gated)
- [modules/sentiment.module.js:814-818](../modules/sentiment.module.js#L814-L818) — four `console.error` calls fire every time a percentage comes back 0 (expected for many reps). Also [modules/sentiment.module.js:1104-1105](../modules/sentiment.module.js#L1104-L1105) has an ungated `🎭 MANAGING EMOTIONS ERROR:` log.
- The module already has a `SENTIMENT_DEBUG` flag that other logs respect.
- **Recommendation:** gate behind `SENTIMENT_DEBUG` or remove. Matches the `window.DEBUG` gate I added to data-parsing in Session 1.
- Decision: `[ ]`

### U-3 · "Selected upload period" detection reads CSS color
- [script.js:2074-2075](../script.js#L2074-L2075) — `resolveSelectedUploadPeriodType()` identifies the active button by comparing `getComputedStyle().backgroundColor` to two hardcoded color strings. Browser color normalization can differ (rgb vs hex vs oklch after a CSS swap); a theme change would silently break period detection.
- **Recommendation:** use `[data-period-active="true"]` or `.active` class on the button. Set by the click handler.
- Decision: `[ ]`

### U-4 · "Check console" in user-facing upload error toasts
- [script.js:1526](../script.js#L1526) (Verint), [script.js:1560](../script.js#L1560) (Payroll) — toasts literally say "Check console". Unusable for non-technical users.
- **Recommendation:** surface the actual error (file name + short reason) in the toast. Keep full stack in debug log only.
- Decision: `[ ]`

### U-5 · Orphaned element ID lookup in PTO PDF upload binding
- [modules/pto.module.js:1220-1233](../modules/pto.module.js#L1220-L1233) — checks `getElementById('ptoPdfBtn')` first, falls back to `'showUploadPtoPdfBtn'`. `'ptoPdfBtn'` doesn't exist anywhere in the codebase.
- **Recommendation:** remove the dead first-choice ID. One less footgun if we ever add a `ptoPdfBtn` for something unrelated.
- Decision: `[ ]`

### U-6 · Verint and Payroll upload error paths don't stop the loop
- [script.js:1520](../script.js#L1520) (Verint) — per-file errors get a toast but the loop continues silently on subsequent successes. Users can't tell which files failed without opening the console.
- **Recommendation:** accumulate failures into an array and show a single end-of-batch toast like "2 of 5 files failed: payroll-01.xlsx, payroll-03.xlsx".
- Decision: `[ ]`

---

## 🟠 Dead code / rot

### U-7 · `uploadModeEmployee` button has no click handler
- [index.html:68](../index.html#L68) — declares `<button id="uploadModeEmployee">👥 Employee Data</button>` styled as selected, but nothing binds to it. Looks like the first of a planned multi-mode selector (employee vs. something) that was abandoned.
- **Recommendation:** delete the button and its wrapper div, or wire it if the feature is planned. Current state is misleading.
- Decision: `[ ]`

### U-8 · Legacy hidden period controls (F-17/F-18 from Session 1)
- [index.html:104-116](../index.html#L104-L116) (`legacyPeriodControls`) + [index.html:128-139](../index.html#L128-L139) (`legacyDateRow`) — 7 hidden buttons + 2 hidden date inputs. Surfaced via the wizard's "Need custom dates?" link at [index.html:100](../index.html#L100).
- Click handler at [script.js:1441-1486](../script.js#L1441-L1486) still binds to these buttons. Marks `uploadPeriodManuallySelected = true` even when uploaded via the wizard, creating state confusion.
- **Recommendation:** verify "Need custom dates?" still has a valid use case. If yes, the handler should detect wizard-vs-legacy mode. If no, delete the legacy block + the custom-dates toggle entirely.
- Decision: `[ ]` (needs your call — is "custom dates" still a path you use?)

### U-9 · Duplicated date-range logic between "Load Data" and "Test Upload"
- [script.js:2715-2765](../script.js#L2715-L2765) (`handleTestPastedDataClick`) duplicates ~50 lines from [script.js:2501-2562](../script.js#L2501-L2562) (`handleLoadPastedDataClick`) — same period detection, date math, validation.
- **Recommendation:** extract `resolveUploadDateRange(weekEndingDate, startDate, isDailyMode)` used by both handlers.
- Decision: `[ ]`

### U-10 · Three separate hardcoded metric lists in upload validation
- [script.js:2601](../script.js#L2601), [script.js:2774](../script.js#L2774), [script.js:5826](../script.js#L5826) — three different arrays of metric keys in upload validation / test upload / AI prompt generation. Adding a metric to the registry requires updating three lists.
- **Recommendation:** define `const UPLOAD_REQUIRED_METRICS` once (near the top) and reuse. Or derive from `METRICS_REGISTRY` by filtering `target !== null`.
- Decision: `[ ]`

### U-11 · Possible redundant save call on non-daily uploads
- [script.js:2673-2674](../script.js#L2673-L2674) — calls `saveWeeklyData()` and `saveYtdData()` back-to-back after a non-daily upload. Each triggers a separate `localStorage.setItem` and therefore two repo-sync queue entries.
- **Recommendation:** verify both saves are needed (YTD may be rebuilt from weekly). If both are needed, they'll debounce via repo-sync's SYNC_DEBOUNCE_MS — acceptable. If only one is needed, drop the other.
- Decision: `[ ]`

---

## 🟠 Tech debt

### U-12 · Sentiment upload split between two entry points
- [modules/sentiment.module.js:1191-1320](../modules/sentiment.module.js#L1191-L1320) — `handleSentimentUploadSubmit` orchestrates UI + file processing; `processUploadedSentimentFile` is the parser. The boundary between "UI" and "parse" leaks — parse errors currently bubble into UI error display via `alert()`.
- **Recommendation:** clear split: `parseSentimentFile(file) → {data, errors}`; UI handler awaits all files, displays aggregate. Similar treatment to the Verint/Payroll batch-error proposal in U-6.
- Decision: `[ ]`

### U-13 · Year-end profile selector on upload form doesn't sync with year-end review page
- [index.html](../index.html) — `#uploadYearEndProfile` (Upload form) and `#yearEndReviewYear` (Review Prep form) are unrelated inputs.
- If a user sets profile = 2025 at upload, then opens Year-End review, the review form may default to 2026. Possibly intentional (upload vs review are different tasks), but worth confirming the separation is explicit.
- **Recommendation:** add inline comment on both inputs explaining they're independent. No code change unless you want them linked.
- Decision: `[ ]`

---

## 🟡 Minor cleanup

### U-14 · Upload wizard YTD summary parses date via `new Date(day)`
- [modules/upload-wizard.module.js:317](../modules/upload-wizard.module.js#L317) — `const d = new Date(day)` where `day` is a `YYYY-MM-DD` string from `<input type="date">`. UTC-at-midnight interpretation; in negative-UTC timezones displays as the prior day.
- **Recommendation:** parse with `.split('-').map(Number)` like script.js:2085.
- Decision: `[ ]`

### U-15 · Test upload `catch` leaves stale validation preview
- [script.js:2818-2820](../script.js#L2818-L2820) — catch block logs but doesn't hide `dataValidationPreview`. User sees the previous success/failure banner alongside the new error toast.
- **Recommendation:** hide the preview element in the catch branch.
- Decision: `[ ]`

### U-16 · Sentiment upload validates after file select
- [modules/sentiment.module.js:1200-1203](../modules/sentiment.module.js#L1200-L1203) — `alert()` if associate/date missing AFTER user picked files. Submit button should be disabled until required fields are populated.
- **Recommendation:** disable submit on init; enable via input listeners once both associate and date are set.
- Decision: `[ ]`

### U-17 · Upload wizard doesn't focus date pickers when revealed
- [modules/upload-wizard.module.js:470-472](../modules/upload-wizard.module.js#L470-L472), [:495-501](../modules/upload-wizard.module.js#L495-L501) — YTD/daily date input becomes visible but isn't focused. Easy to miss that a date is required.
- **Recommendation:** `.focus()` after `style.display = 'block'`.
- Decision: `[ ]`

### U-18 · `setDate` mutates the Date inline in sentiment
- [modules/sentiment.module.js:1221-1222](../modules/sentiment.module.js#L1221-L1222) — `pullDateObj.setDate(pullDateObj.getDate() - 14)` mutates. upload-wizard.module.js has a cleaner `addDays()` helper at :40-44.
- **Recommendation:** use the non-mutating helper for consistency.
- Decision: `[ ]`

### U-19 · PTO showToast fallback is console-only
- [modules/pto.module.js:44](../modules/pto.module.js#L44) — `console.log('[PTO]', msg)` if `showToast` not defined. In practice `showToast` is always defined by load order, but the fallback would silently hide a user-facing message.
- **Recommendation:** remove the fallback and let it fail loudly if invariant is broken, or add `console.warn('[PTO] showToast unavailable, falling back')` so failures are visible.
- Decision: `[ ]`

---

## Summary

## Summary — Session 2 closed

Operator decisions:
- **U-8** — delete the legacy block (uploads happen day-by-day via wizard)
- **U-13** — sync the two year-end selectors

Executed in batches:

| Batch | Findings | Commit |
|---|---|---|
| A | U-3, U-8 (legacy period controls deleted, period-type now reads hidden input) | `78f23a19` |
| B | U-1, U-2, U-4, U-5, U-6, U-7, U-14, U-15, U-17, U-19 | `fdc543d0` |
| C | U-10 (partial), U-13, U-16, U-18 | this commit |

**Verified, no fix needed:**
- **U-11** — `saveWeeklyData()` + `saveYtdData()` after a non-daily upload are both required; `upsertAutoYtdForYear` may have mutated `ytdData` independently of weekly. The two `localStorage.setItem` calls debounce to a single repo-sync request via SYNC_DEBOUNCE_MS.

**Deferred to later sessions:**
- **U-9** — extracting the shared date-range logic between `handleLoadPastedDataClick` and `handleTestPastedDataClick` would be a real refactor (different validation rules, different defaults). Risk of regression exceeds value at this point.
- **U-10 (rest)** — script.js has 14+ different metric arrays across the file, not just 3 in upload code. Consolidating beyond DRIFT_METRIC_KEYS would be a cross-cutting refactor — left for Session 7.
- **U-12** — splitting the sentiment upload UI/parse layer is a meaningful refactor of a working flow. Deferred to Session 7.

Ready for Session 3 (My Team — Morning Pulse, Coaching, Snapshot, Call Listening, Attendance) when you are.
