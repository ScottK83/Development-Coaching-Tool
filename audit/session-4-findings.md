# Session 4 — Trends flow

Scope: Trends nav + 5 subtabs (Intelligence, Metric Charts, Rankings, Futures, Sentiment).
Modules: trend-intelligence (603 lines), metric-trends (4,149), center-ranking (765), futures (890), sentiment (1,518), trend-coaching-email (358).

Verified each finding against code before writing. Last session had a 27% false-positive rate from the explore agent — this pass is direct.

Severity: 🔴 real bug / risk · 🟠 rot / tech debt · 🟡 minor cleanup · 🟢 cosmetic

---

## 🔴 Real bugs / risks

### TR-1 · `initializeMetricTrends` is called 3× and stacks listeners on persistent buttons
- [script.js:381](../script.js#L381), [:1635](../script.js#L1635), [:1872](../script.js#L1872) all call `initializeMetricTrends()`.
- The module binds 17+ click/change listeners on STATIC index.html elements (`generateTrendBtn`, `coachingFollowupBtn`, `generateAllTrendBtn`, `saveAvgBtn`, `avgWeekMonday`, etc. at [modules/metric-trends.module.js:65-707](../modules/metric-trends.module.js#L65-L707)) with no `removeEventListener` or `dataset.bound` guards.
- **Impact:** every visit to Metric Trends adds another listener set. After the second visit, clicking "Send Metrics" fires `generateTrendEmail()` twice. After the third visit, three times — likely opens 3 mailto windows or sends 3 emails. Real user-facing risk.
- **Recommendation:** add `dataset.metricTrendsBound = '1'` guard at the top of `initializeMetricTrends` so it short-circuits on subsequent calls. Or change the bindings to use `dataset.bound` per-element.
- Decision: `[ ]`

### TR-2 · UTC date drift in metric-trends week-Sunday calculation
- [modules/metric-trends.module.js:76](../modules/metric-trends.module.js#L76) — `avgWeekSunday.value = sunday.toISOString().split('T')[0];` writes a date input value using UTC.
- In timezones behind UTC, after-noon picks roll into the next UTC date, so the displayed Sunday is one day off.
- **Recommendation:** use the `formatLocalDate()` helper added to shared-utils in Session 3.
- Decision: `[ ]`

### TR-3 · Five ungated `console.log` calls in production
- [metric-trends.module.js:1103](../modules/metric-trends.module.js#L1103) — `'📊 Using selected sentiment snapshot:'`
- [:1391](../modules/metric-trends.module.js#L1391) — `'Mailto link clicked'`
- [:2878](../modules/metric-trends.module.js#L2878) — `'HTML email with embedded image copied to clipboard'`
- [:2886](../modules/metric-trends.module.js#L2886) — `'Image copied to clipboard (HTML failed)'`
- [:2896](../modules/metric-trends.module.js#L2896) — `'Clipboard API not available, downloading instead'`
- Most other `console.log` calls in this file are properly gated by `if (DEBUG)`. These five slipped through.
- **Recommendation:** wrap each in `if (DEBUG)` or remove. Console gets noisy on every email-with-image generate.
- Decision: `[ ]`

---

## 🟠 Rot / duplication

### TR-4 · Hardcoded "core metrics" arrays scattered across trend modules
- [modules/trend-intelligence.module.js:207](../modules/trend-intelligence.module.js#L207), [:246](../modules/trend-intelligence.module.js#L246), [:255](../modules/trend-intelligence.module.js#L255), [:285](../modules/trend-intelligence.module.js#L285), [:409](../modules/trend-intelligence.module.js#L409), [:433](../modules/trend-intelligence.module.js#L433), [:444](../modules/trend-intelligence.module.js#L444) — 7 different sub-lists of core metrics, each subtly different (some include `aht` and `transfers`, some don't).
- [modules/futures.module.js:28](../modules/futures.module.js#L28), [:98](../modules/futures.module.js#L98) — 2 more variants
- [modules/metric-trends.module.js:3314](../modules/metric-trends.module.js#L3314) — another variant
- **Impact:** if the team's "core 6" changes, you have to update 10+ places. Drift is guaranteed over time.
- **Recommendation:** add `CORE_PERFORMANCE_METRICS` (the 6 score-card metrics) and `CORE_SURVEY_METRICS` (the 4 survey metrics) constants to `metrics-registry.module.js`. Replace the inline arrays.
- Decision: `[ ]`

### TR-5 · Direct `localStorage` reads with hardcoded `'devCoachingTool_'` prefix
- [modules/metric-trends.module.js:294](../modules/metric-trends.module.js#L294), [:304](../modules/metric-trends.module.js#L304) — `'devCoachingTool_lastTrendPeriod'`
- [modules/center-ranking.module.js:18](../modules/center-ranking.module.js#L18), [:30](../modules/center-ranking.module.js#L30) — `'devCoachingTool_employeeSupervisors'`
- Bypasses the `STORAGE_PREFIX` constant. Same drift risk as the Session 1 cleanup we already did for 11 other declarations.
- **Recommendation:** import `STORAGE_PREFIX` from `window.DevCoachConstants` (or use the storage module helpers).
- Decision: `[ ]`

---

## 🟡 Minor cleanup

### TR-6 · Sentiment parsing has one ungated `console.warn`
- [modules/sentiment.module.js:720](../modules/sentiment.module.js#L720) — `console.warn(\`⚠️ Found "${label} date" line but couldn't parse: "${line}"\`)`. Fires every time sentiment file parsing hits a malformed date row.
- The module has a `SENTIMENT_DEBUG` flag and a `debugLog` helper used elsewhere — this one slipped through.
- **Recommendation:** route through `debugLog` or remove (silent ignore is fine — the row is already skipped).
- Decision: `[ ]`

### TR-7 · `trend-intelligence` has zero event-listener bindings — no risk to cite
- Verified read-only.
- Decision: `[KEEP — no fix]`

---

## Summary

| Severity | Count | IDs |
|---|---|---|
| 🔴 Real bugs / risks | 3 | TR-1, TR-2, TR-3 |
| 🟠 Rot / duplication | 2 | TR-4, TR-5 |
| 🟡 Minor cleanup | 2 | TR-6, TR-7 (no-op) |

**Most impactful:** **TR-1** is the worst finding so far in the audit — a real production bug that triples your trend emails after navigating around. **TR-2** is the same UTC-drift class as Session 3's T-2.

Mark `[KEEP]` or `[FIX]` per item, or say "fix all".
