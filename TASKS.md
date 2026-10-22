# Tasks

## Open
- Data pipeline plan, waiting for Scott's approval and his four answers: `audit/2026-10-21-data-pipeline-plan.md`. Phases: 1 fix the wrong numbers (Snapshot, Year to date, Pace label); 2 upload checks; 3 repair stored data and hide superseded periods; 4 one period control everywhere; 5 one answer for each number.
- Later, from the same read: two cloud syncs run side by side and R2 is never pruned (needs a worker deploy from home); undo after an upload leaves archived dailies, the auto YTD and center averages changed.
- Scott to review the restyle on the live site; tweak what he flags.
- Restyle leftovers, optional: the Calls page keeps three primary buttons (its three main steps); Settings Save buttons are secondary; kit wishes not built yet (row tints on table rows, a progress meter, a .chip class); baseline/outputs.txt will differ (regenerate with node tests/baseline.js if it matters).
- Rankings emails (Center > Rankings): still carry more than 2 emojis, a reliability "Met." line, and "off by 20s" instead of "20 seconds".
- 30-day goal Copilot prompt (script.js `buildTrendAiGoalPrompt`) has no praise and no zero-survey or no-calls check.
- Worker auth secret needs deploying from the home PC (see memory: project_worker_auth_deploy).

## Done recently
- 2026-10-21: restyle to match the Downloader Bot (6 steps, v2026.10.21.4 to .8).
- 2026-10-21: a last place (Call Center or team) is never said in the private standings; the number and its next step stand alone.
- 2026-10-21: private placings read "52nd in the Call Center, 7th on our team"; built-in service level team note removed.
- 2026-10-14: praise in every piece of feedback (calls praise floor, `messageVoice.truePositive` across metric messages, Verint log fix).
