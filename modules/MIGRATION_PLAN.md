# Modular Migration (No Live Behavior Change)

This folder is a **parallel module path**. The app continues running from `script.js` exactly as-is.

## Purpose
- Reduce complexity risk in one large file
- Migrate in small, safe slices
- Preserve current UX/workflow during migration

## Current module
- `metric-profiles.module.js`
  - Yearly metric targets (`TARGETS_BY_YEAR`)
  - Rating bands (`RATING_BANDS_BY_YEAR`)
  - Helpers: `getYearTarget`, `getRatingScore`, `getRatingBandColor`

## Incremental migration steps
1. Keep this module file updated with canonical targets/bands.
2. Add a temporary parity test script that compares module output vs `script.js` output for sample inputs.
3. When parity is confirmed, replace one callsite at a time in `script.js`.
4. After each replacement, run syntax + smoke checks.
5. Remove duplicate logic from `script.js` only after full parity.

## Suggested next slice
- Move all year-profile/target-band logic from `script.js` into this module first.
- Then migrate On/Off scoring to consume module helpers.
