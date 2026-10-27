# Development Coaching Tool

Supervisor coaching app for the APS call center. Live at https://development-coaching-tool.pages.dev (Cloudflare Pages, deploys from `main`).

## Architecture
- Vanilla JS single page app, no framework, no build step.
- `index.html` loads `modules/*.module.js` (IIFEs that export on `window.DevCoachModules.<name>`), then `script.js`.
- App state is global `let`s in `script.js`; storage is localStorage with the `devCoachingTool_` prefix, synced to Cloudflare R2 by the worker in `cloudflare-sync-worker/`.

## Commands
- Tests: `node tests/run.js` (all) or `node tests/run.js "<suite name prefix>"`.
- Push: the pre-push hook runs the suite, bumps `APP_VERSION` and commits, then refuses the push. Run `git push` a second time.

## Constraints
- Never edit `APP_VERSION` by hand.
- Parallel Claude sessions edit this repo: stage only your own files, never `git add -A`.
- Associate-facing text: praise first, no em or en dashes (tests/no-em-dash.test.js), no disclaimers, at most 2 emojis (plus the team post's 🥇🥈🥉 on top 3 placings), moves in words ("down 24 seconds"), no reliability or hours in focus areas.
- Code never writes a file to the PC; backups go to R2.

## Pitfalls
- The test clock is pinned (2026-08-18); use `t.pinClock(date)` in a suite to test dates.
- A 0 second handle time means no calls, never a win.
- Survey metrics with no surveys must never show as 0%.
- Some files are CRLF; exact-string edits must handle both line endings.
