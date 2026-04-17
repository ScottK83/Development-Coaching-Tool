# Session 1 — Foundation + script.js core

Scope: bootstrap.js, script.js (globals/init/core utilities), index.html (head + script loader), foundation modules (metrics-registry, storage, data-parsing, metric-profiles, error-monitor, shared-utils, data-integrity, pattern-memory), CSS files, orphan check.

Each finding: **ID**, file:line, description, severity, recommendation. Mark `[KEEP]` or `[FIX]` next to each before we proceed to fixes.

Severity legend: 🔴 real bug / risk · 🟠 rot / tech debt · 🟡 minor cleanup · 🟢 cosmetic

---

## 🔴 Real bugs / risks

### F-1 · STORAGE_PREFIX duplicated 11 times across the codebase
- [script.js:42](../script.js#L42) has an explicit self-documenting NOTE about the problem
- Also in: `storage.module.js:12`, `repo-sync.module.js:13`, `debug.module.js:13`, `dashboard.module.js:10`, `executive-summary.module.js:14`, `matchup.module.js:4`, `monday-morning-post.module.js:10`, `navigation.module.js:4`, `pto.module.js:9`, `team-snapshot.module.js:10`
- **Risk:** If we ever change the prefix, we have to edit 11 places. Guaranteed future drift.
- **Recommendation:** create `modules/constants.module.js` (or add to shared-utils) exporting `STORAGE_PREFIX`. Load it first. Replace all 11 local declarations with reads from that export.
- Decision: `[ ]`

### F-2 · error-monitor uses a storage key outside the `devCoachingTool_` namespace
- [error-monitor.module.js:8](../modules/error-monitor.module.js#L8): `ERROR_LOG_KEY = 'devCoachErrorLog'` (no underscore, no "ing")
- Every other key uses `devCoachingTool_*`. This one would be missed by any bulk export/delete that iterates keys by prefix.
- **Recommendation:** rename to `devCoachingTool_errorLog`. One-shot migration: on load, copy from old key if new key missing.
- Decision: `[ ]`

### F-3 · Three separate layers of console.warn/error overrides that can fight each other
- [bootstrap.js:15-25](../bootstrap.js#L15-L25) — wraps console.warn/error to filter source-map noise, runs FIRST
- [script.js:97-121](../script.js#L97-L121) — wraps console.warn/error AGAIN (silences everything in prod, filters in DEBUG)
- [error-monitor.module.js:242-255](../modules/error-monitor.module.js#L242-L255) — wraps console.error AGAIN to capture errors into the log
- They compose, but this is load-order-sensitive: error-monitor wraps the script.js wrapper which wraps the bootstrap wrapper. If any of them stops forwarding, messages disappear.
- **Recommendation:** consolidate into one wrapper in bootstrap.js that knows about all three concerns (suppress patterns, debug toggle, error-monitor capture). Delete the other two.
- Decision: `[ ]`

### F-4 · Three separate `window.addEventListener('error'...)` handlers
- [bootstrap.js:38](../bootstrap.js#L38), [script.js:124](../script.js#L124), [error-monitor.module.js:221](../modules/error-monitor.module.js#L221)
- All fire; no deduplication. A single runtime error lands in 3 handlers and may write `lastError` to localStorage from script.js while error-monitor also logs it.
- **Recommendation:** centralize in error-monitor (keep it the one handler). Delete the bootstrap.js and script.js versions.
- Decision: `[ ]`

### F-5 · Metric targets duplicated between metrics-registry and metric-profiles
- [metrics-registry.module.js:14](../modules/metrics-registry.module.js#L14) — each metric has a `target: { type: 'min', value: 93 }` — **hardcoded to 2026 values**
- [metric-profiles.module.js:4-34](../modules/metric-profiles.module.js#L4-L34) — `TARGETS_BY_YEAR.2025` and `.2026`
- Registry comment claims to be source of truth (`SINGLE SOURCE OF TRUTH` on script.js:327), but it conflicts with the year-aware profile. If a user views 2025 data, registry returns 2026 targets.
- **Recommendation:** strip `target` out of registry entries; make all target lookups go through `metric-profiles.getYearTarget`. Keeps year-aware behavior; kills the duplication.
- Decision: `[ ]`

### F-6 · Rating bands only cover 6 of 14 metrics
- [metric-profiles.module.js:36-101](../modules/metric-profiles.module.js#L36-L101) — `RATING_BANDS_BY_YEAR` has bands for adherence, cxRepOverall, sentiment, reliability, aht, transfers only
- [metric-profiles.module.js:109](../modules/metric-profiles.module.js#L109) `getRatingScore` returns `null` for fcr, overallExperience, positiveWord, negativeWord, managingEmotions, acw, holdTime, totalCalls
- May be intentional (only score-card metrics get ratings) but callers should know. No caller-side comment makes this clear.
- **Recommendation:** verify intent with you. If intentional, add a comment and a `hasRatingBand(metricKey, year)` helper. If not, fill the gaps.
- Decision: `[ ]`

### F-7 · TRACKED_METRICS defined twice with different content
- [data-integrity.module.js:9](../modules/data-integrity.module.js#L9) — 13 metrics including `acw`, `holdTime`
- [pattern-memory.module.js:9](../modules/pattern-memory.module.js#L9) — 11 metrics, no `acw`, no `holdTime`
- Same name, different list — guaranteed confusion. Pattern memory silently ignores ACW/hold time swings.
- **Recommendation:** expose the canonical list from metrics-registry (e.g., `getTrackedMetricKeys()`) and have both modules use it. Decide together whether ACW/holdTime belong.
- Decision: `[ ]`

### F-8 · `parsePastedData` is ~250 lines with an explicit REFACTOR comment
- [data-parsing.module.js:338-596](../modules/data-parsing.module.js#L338-L596) — 258-line function handling column detection, positional fallback, row parsing, hold-time auto-correct, and employee object building
- The author left a REFACTOR comment at line 338 describing the exact break-up they wanted: `detectColumnMapping`, `parseEmployeeRow`, `validateEmployeeData`
- **Recommendation:** follow the author's plan. Split as described. No logic change.
- Decision: `[ ]`

### F-9 · `normalizeTransferPercentageValue` duplicated between storage and data-parsing
- [storage.module.js:41-60](../modules/storage.module.js#L41-L60) — storage has its own copy
- [data-parsing.module.js:223-242](../modules/data-parsing.module.js#L223-L242) — called `normalizeTransfersPercentage` (plural), identical logic
- Two functions, same job, nearly identical. Risk of drift.
- **Recommendation:** keep one (data-parsing.module.js), delete storage's copy. Storage calls the data-parsing export.
- Decision: `[ ]`

### F-10 · Debug `console.log` runs on every paste parse
- [data-parsing.module.js:469-474](../modules/data-parsing.module.js#L469-L474) — 4 `console.log` calls logging the full header and column mapping on every `parsePastedData` invocation
- Not guarded by DEBUG. Noise in prod if user opens devtools.
- **Recommendation:** gate behind `window.DEBUG` check.
- Decision: `[ ]`

---

## 🟠 Dead code / orphans

### F-11 · `styles.css` is orphaned
- [index.html:12](../index.html#L12) loads `styles-v2.css` only; the old `styles.css` (14k) is only referenced in an HTML comment ("Swap between styles.css (original) and styles-v2.css (redesign)") and two stale code comments in script.js:487-488
- **Recommendation:** delete `styles.css` and the "swap between" comment. Update script.js comments that reference styles.css to reference styles-v2.css (or remove since they're REFACTOR markers, not active docs).
- Decision: `[ ]`

### F-12 · `smoke-test.html` (16k) is orphaned
- No references anywhere in the codebase
- **Recommendation:** either delete it, or add a top-of-file comment explaining when/how it's used (manual smoke test before release?). If you never run it, delete.
- Decision: `[ ]`

### F-13 · `modules/year-end.module.js` is a 109-line stub
- Line count from earlier scan (109 lines)
- Possibly partial. Should inspect during Session 5.
- **Recommendation:** flag for Session 5 (Review Prep).
- Decision: Deferred to Session 5.

---

## 🟠 Tech debt / rot

### F-14 · "Backward compatibility" wrappers in script.js add side effects the module-level functions lack
- [script.js:197-242](../script.js#L197-L242) — `saveWeeklyData()`, `saveYtdData()`, `saveCoachingHistory()`, `saveSentimentPhraseDatabase()`, `saveAssociateSentimentSnapshots()` all add `queueRepoSync(...)` after calling the module version
- **Problem:** any module that imports `window.DevCoachModules.storage.saveWeeklyData` directly bypasses the repo sync. No comment warns about this.
- **Recommendation:** either (a) move the `queueRepoSync` call into the storage module (simpler, one call site), or (b) add a comment to each wrapper explaining the invariant. Prefer (a).
- Decision: `[ ]`

### F-15 · `saveDailyData` deliberately skips repo sync (documented), making save-function behavior inconsistent
- [script.js:213-218](../script.js#L213-L218) — inline comment explains daily data is ephemeral so skip repo sync
- Fine as-is, but if we move sync into storage module per F-14, we need to preserve this behavior.
- **Recommendation:** keep the behavior; document as a flag on the storage API rather than a wrapper-level branch.
- Decision: `[ ]`

### F-16 · `storage.module.js` save functions return inconsistent types — self-documented
- [storage.module.js:139-140](../modules/storage.module.js#L139-L140) — explicit NOTE: "Some save functions return boolean (saveReliabilityTracker), others return void. Future: standardize all save functions to return boolean from saveWithSizeCheck."
- **Recommendation:** make them all return boolean. Low risk; fixes the self-documented inconsistency.
- Decision: `[ ]`

### F-17 · Massive legacy period-control block kept "for save-path compatibility, hidden by default"
- [index.html:104-116](../index.html#L104-L116) — `id="legacyPeriodControls"` with 7 hidden buttons (daily/week/week-in-progress/month/quarter/ytd/custom)
- Claimed used as escape hatch for the wizard's "custom dates" button
- **Recommendation:** verify in Session 2 (Upload flow) whether the escape hatch still fires. If yes, keep; if no, delete block and the custom toggle.
- Decision: Deferred to Session 2.

### F-18 · `legacyDateRow` and `customStartDateContainer` — same pattern
- [index.html:128-139](../index.html#L128-L139) — hidden "From (optional)" and "Through" inputs for legacy custom-date path
- **Recommendation:** audit in Session 2 alongside F-17.
- Decision: Deferred to Session 2.

### F-19 · Design-intent comment block at top of script.js has encoding damage
- [script.js:6-33](../script.js#L6-L33) — many `?` characters where emoji/bullets should be (`?? DESIGN INTENT`, `? Do not add...`)
- Likely `⚠️` and `❌`/`•` that got mangled in a past save
- **Recommendation:** rewrite the block with clean ASCII bullets (`-`) or proper UTF-8 emoji. Matches `init: Initialize` skill's "no-emoji" default.
- Decision: `[ ]`

### F-20 · `SENTIMENT_PHRASE_DB_STORAGE_KEY` and `ASSOCIATE_SENTIMENT_SNAPSHOTS_STORAGE_KEY` duplicated
- [script.js:319-320](../script.js#L319-L320) and [storage.module.js:13-14](../modules/storage.module.js#L13-L14)
- Same values, two places.
- **Recommendation:** delete from script.js; import from storage module when needed.
- Decision: `[ ]`

### F-21 · `LOCALSTORAGE_MAX_SIZE_MB` duplicated
- [script.js:256](../script.js#L256) and [storage.module.js:15](../modules/storage.module.js#L15)
- **Recommendation:** same fix — delete from script.js, export from storage.
- Decision: `[ ]`

---

## 🟡 Minor cleanup

### F-22 · `APP_VERSION` is manually set in script.js:38
- [script.js:38](../script.js#L38) — `const APP_VERSION = '2026.04.17.4';`
- Memory says pre-push hook handles versioning. This is expected to be bumped automatically.
- **Recommendation:** none — this is the mechanism. Just confirming memory is accurate.
- Decision: `[KEEP — AS DESIGNED]`

### F-23 · `DEBUG` auto-enables on localhost OR `?debug` query param
- [script.js:39](../script.js#L39)
- Works fine; just documenting behavior.
- Decision: `[KEEP — AS DESIGNED]`

### F-24 · Several CSS inline patterns with REFACTOR comments
- [script.js:487-488](../script.js#L487-L488) — `showToast` has REFACTOR note ("migrate to CSS class .toast in styles.css") — but styles.css is orphaned (F-11). Should point to styles-v2.css.
- **Recommendation:** either do the CSS migration or update the comment. Cosmetic.
- Decision: `[ ]`

### F-25 · Orphan global `window.showDataIntegrityModal` and `window.showPatternMemoryModal`
- [data-integrity.module.js:369](../modules/data-integrity.module.js#L369), [pattern-memory.module.js:360](../modules/pattern-memory.module.js#L360)
- These modules register both the namespaced `DevCoachModules.*` export AND a bare `window.*` global for the modal opener. Probably for inline `onclick=` handlers in index.html.
- **Recommendation:** verify callers in Session 5/6; if all callers use `DevCoachModules.*`, drop the bare globals.
- Decision: Deferred to Session 6.

### F-26 · `isReverseKey` in pattern-memory falls back to inline list if `window.isReverseMetric` missing
- [pattern-memory.module.js:20-23](../modules/pattern-memory.module.js#L20-L23) — hardcoded `['aht', 'acw', 'holdTime', 'transfers', 'reliability']` as fallback
- If the canonical `isReverseMetric` ever diverges, this fallback silently disagrees.
- **Recommendation:** load pattern-memory after whichever module defines `isReverseMetric`, and assert its presence. Or move `isReverseMetric` into metrics-registry.
- Decision: `[ ]`

### F-27 · script.js stale memory note — memory claims 31 modules and a `state` module
- MEMORY.md line: "Module System (31 modules in modules/ directory)" and lists "state" as foundation
- Actual: 44 modules, no `state.module.js`. Memory is ~13 modules behind.
- **Recommendation:** update MEMORY.md module count and foundation list after this session.
- Decision: `[ ]`

---

## 🟢 Cosmetic

### F-28 · CSP allows `unsafe-inline` for script-src — noted in HTML comment
- [index.html:6-9](../index.html#L6-L9) — self-documented
- **Recommendation:** out of scope for audit. Keep.
- Decision: `[KEEP]`

### F-29 · Form inputs lack labels/aria-labels
- [index.html:18-19](../index.html#L18-L19) — self-documented A11Y note
- **Recommendation:** out of scope for audit. Flag for future.
- Decision: `[KEEP]`

### F-30 · Bootstrap error listeners use `{capture: true}` (third arg `true`)
- [bootstrap.js:44](../bootstrap.js#L44), [bootstrap.js:51](../bootstrap.js#L51)
- Intentional — runs before other listeners. Fine.
- Decision: `[KEEP]`

---

## Summary

| Severity | Count | Decision needed |
|---|---|---|
| 🔴 Real bugs / risks | 10 | F-1 through F-10 |
| 🟠 Dead code / orphans | 3 | F-11, F-12; F-13 deferred |
| 🟠 Tech debt / rot | 8 | F-14 through F-21 (F-17, F-18 deferred) |
| 🟡 Minor cleanup | 6 | F-22 through F-27 (F-25 deferred) |
| 🟢 Cosmetic / no-op | 3 | F-28 through F-30 (all keep) |

**Your move:** mark `[KEEP]` or `[FIX]` (and any notes) next to each decision line above. When you come back, I'll apply every `[FIX]` in dependency order, commit + push after each logical batch, then queue Session 2 (Upload flow).

**Most impactful starter batch (if you want a quick win):** F-1 (STORAGE_PREFIX), F-5 (target duplication), F-11 (orphan CSS), F-12 (orphan smoke-test), F-20/F-21 (dupe constants). Each is low-risk and cleans up measurable chunks.
