# Handoff

Last updated 2026-10-27, version 2026.10.27.1, suite at 9990 passing.

## Where things stand
- **QA Coaching tab (Scott, 2026-10-27), under People > Follow Up** (`modules/qa-coaching.module.js`). You paste a Verint "Manage Coaching Session" page (one or several), or type the associate, reason and QA notes. It gives:
  - The email, in the call email's voice: praise first, what QA noticed, steps for next time, and a "Got it" reply request. Scott said no score.
  - A Copilot prompt.
  - Copy For Verint, which fills the Meeting Summary box.
  - Read tracking: each coaching is one record in `followUpHistory` (`kind: 'qa'`, keyed by session id). It shows as Sent until Scott marks it Read, and it is flagged once it is past its Verint due date. Those records stay out of the To-Do history list.
  - Read receipts: a mailto link can't turn one on, so the panel says to tick Request a Read Receipt in Outlook.
  - Tests: `tests/qa-coaching.test.js` on a made-up `tests/fixtures/qa-coaching-sessions.txt`. Checked in headless Chrome as well.
  - Scott's own paste of 5 real sessions read correctly. It was not kept.
- **Real QA notes were committed to the public repo (Scott, 2026-10-27).** He added them as a file, `QA coaching`, and the file was removed in `ab58f773`. Still open, see TASKS.md:
  - The commit is still in the Git history.
  - The old Cloudflare deploy `5944fe50` still serves the file.
  - Cloudflare's Phoenix cache may still serve the file at `/QA%20coaching` for up to 7 days.
- **Deep dive plan done (Scott, 2026-10-26: "Go ahead with the plan").** All six phases are live. The audit is `audit/2026-10-25-deep-dive.md`, and its full lists are `audit/2026-10-25-tone-findings.md` and `audit/2026-10-25-tips-findings.md`.
  - **Calls**
    - The reader misreads fixed (`tests/call-reader-accuracy.test.js`). The made-up test call is `tests/fixtures/arrangement-call.txt`; real transcripts are never committed.
    - A scorecard on every call (`modules/call-scorecard.module.js`). It has ten lines, each Yes, Missed, Didn't apply or Check, with times and numbers. It sits under the flag strip, on the main path.
    - A click corrects a line and the notes follow. The corrected card is saved as `entry.scorecard`.
    - Copy For Verint carries the score; the associate email never does.
  - **Coaching log, written when coaching goes out**
    - `recordCallCoaching` runs on Verint, the Copilot email and Outlook (not the summary step).
    - `recordTodayCoaching` runs on the Today page's "✓ Sent", and Undo removes the record.
    - The Coach page and the trend email write one record per period.
    - Each is a single record, keyed by `dedupeKey`. Records carry `source`, `behaviors` and the tips.
    - Today redrafts no longer pile up in `tipUsageHistory`.
  - **Ranking:** metrics are ranked in their own noise steps (`getMetricNoiseThreshold`), not raw gaps. A survey metric nobody answered is never "weakest" (`measured: false`).
  - **Center > Trends > What's working** (`modules/whats-working.module.js`) has four parts:
    - The team against the center over 4 and 8 weeks, read as Working, Watch or Pivot.
    - Coaching outcomes at 1 and 3 weeks, judged against the team. coaching-outcomes uses `buildEmployeeAggregateForPeriod` for the 3 weeks.
    - Which tips land, with nothing called on fewer than 5 results.
    - The scored calls, by line and by associate.
    The Patterns tab's tip table now points to it. Each associate's call history opens with their last 8 scorecards.
  - **Tone and tips:** merged from two agent worktrees after review.
  - **Checked in the real page:**
    - Headless Chrome on the seeded real backup: What's working matches the offline numbers.
    - A call sent to Verint twice logged once.
    - A Today Sent logged the tip that was in the message, and Undo removed it.
- **Defaults while Scott's questions 2 to 6 are unanswered:**
  - The call score is for Scott and the Verint note only.
  - Tips that assume dial-out, own-call access or daily numbers work either way.
  - "Test Upload 2" is left alone.
  - The deep dive goes before data pipeline Phase 2.
  - See TASKS.md for what is still owed.
- **Data pipeline plan, approved 2026-10-22:** `audit/2026-10-21-data-pipeline-plan.md`. Phase 1 is done. **Next: Phase 2** (upload checks, and let a saved week or month be replaced).
- Restyle (2026-10-21, dark only, sidebar nav): build new UI with the KIT classes and never hard-code colours. Scott has not reviewed it yet.
- Scott is working through the Today page's private round on real data and sending notes.

## Next
- See TASKS.md.
