# Overlap and trim audit, 2026-10-07

Scott asked: "There may be some stuff that overlaps. Especially in the review prep, quarterly, and trends section with graphics. I love all the data, but feel some sections do the same. Do a full comprehensive look at every section, and see where we can trim off some code and clicks."

**How it was done.** This is a read-only audit at commit `b6a7fe05`. Eight analysts each took one suspected overlap cluster and were told to disprove it first and to name everything unique on each screen. An earlier reader inventoried Follow Up and Contest. The claims that matter most were then re-checked by hand: the Focus Mode nesting, the hub's only initialiser, the Sentiment tab's undeclared reports, Generate All's ignored arguments, reliability in the Mid-Year and Goal-Pace focus lists, the auto-download fallbacks, and the Quick Check-in generator. Nothing here has been changed. Per the standing rule, nothing is deleted without Scott's sign-off. Metric targets, bands and scoring stay out of scope (2026-08-25), so every proposal leaves every number on screen exactly as it is.

## The short answer

Sections overlap less at the screen level than it feels. Most tabs that look alike answer different questions (section 5 lists them). The real duplication is in five places:

1. **Review Prep.** Score Card, Mid-Year and Year-End repeat one setup: an associate picker, a year and the same On/Off table. Year-End's "On/Off Track Mirror" is the Score Card table, drawn by the same functions.
2. **Messages to one associate.** There are about a dozen generators. A few produce the same message: the Coaching tab's Quick Check-in is the My Team Check-in tone, the same function with a different period. Intelligence's three Copilot buttons are subsets of the Metric Charts prompt.
3. **The Dashboard.** It repeats Score Card's team summary, and it is a second "who needs me" landing page beside the My Team day page.
4. **Plumbing.** Code is copied across modules: five image-copy pipelines, two Chart.js bar-chart configs, Matchup's copy of the Rankings period list, and more.
5. **Dead code.** About 550 lines are provably unreachable, and none of them is pinned by a test.

**Graphics specifically.** Duplication sits in the plumbing more than in what gets drawn. The quarter tiles, the year card and the trend email image each draw different content and should stay. The real graphic duplicates are three. Intelligence draws two bar-chart sets for one associate, with two associate pickers. Snapshot's two graphics are one grid coloured two ways. And all five picture-copy paths are separate code.

**Size of the prize.** About 2,200 lines (roughly 2.6% of the app). Review Prep goes from 5 tabs to 3, Trends from 8 to 7 (or 6), and the top nav optionally from 8 to 7. One or two clicks come off the common jobs: every metrics upload, every associate in a quarterly check-in session, and the trend and goal-pace lookups. Another roughly 900 lines could go if the Intelligence hub turns out to be unused (item 1.1).

## 1. Broken right now (found on the way, worth fixing whatever else happens)

| # | What | Evidence | Fix |
|---|---|---|---|
| 1.1 | **The Trend Intelligence & Coaching Hub on Trends > Intelligence is set up by nothing on open and hidden by Focus Mode when it is.** The tab's setup call goes to `window.renderSupervisorIntelligence`, which nothing defines. The only call to `initializeTrendIntelligence` is in the team-filter change handler. Focus Mode starts on. `setTrendFocusMode` hides `trendVisualizationsContainer.closest('div[style*="border: 1px solid #cfe1ff"]')`, and the nearest such ancestor is the whole hub card. That card holds the Focus Mode button itself, so there is no way to turn it back off. | `executive-summary.module.js:106-108,524`; `script.js:863`, `:6093`, `:6103-6116`; `index.html:1464-1531` (hub card), `:1510` (button), `:1527` (container) | Worth a 10-second look in the app first. If Scott uses the hub: point the setup at `initializeTrendIntelligence` and hide only the chart card (a few lines). If he doesn't: it is about 900 lines that could go. |
| 1.2 | **The Trends > Sentiment tab cannot run.** Both buttons destructure `sentimentReports`, which is never declared, and the live upload modal never sets it. | `sentiment.module.js:1171,1816`; it is assigned only in the parked flow at `:1881,1924,2024`; the live modal saves at `:1649-1659` | See 4-I. |
| 1.3 | **Metric Charts "Generate All" has never produced anything.** It calls `generateTrendEmail(name, weekKey)`, but `generateTrendEmail()` takes no arguments and re-reads the picker, which still says ALL. | `metric-trends.module.js:1277`, `:4049-4079` | Delete it (about 40 lines) or thread the arguments through (about 5 lines). |
| 1.4 | **Reliability reaches "Areas of Focus" in two prompts,** against the 10/05 rule. `_buildOnOffMetricContext` pushes reliability into `focusAreas` ("currently X hours over target..."). The Goal-Pace prompt and the Mid-Year prompt both print that list unfiltered. | `on-off-tracker.module.js:730-750` (push), `:843` (Goal-Pace), `:898,926` (Mid-Year) | Leave reliability out of `focusAreas` in the shared builder. Hours inside the allowance can stay a strength. |
| 1.5 | **Two picture copies download a file when the clipboard refuses,** against the never-download rule. User-clicked Download buttons are allowed; these are automatic. | `center-ranking.module.js:3447,3472,3478,3483,3646`; `metric-trends.module.js:2961,2968,3128` | Report the failure instead of downloading. Folds into 2-B. |
| 1.6 | **Snapshot and Contest copies fail more often than they should.** They build the ClipboardItem only after html2canvas resolves, by which time the click's permission has lapsed. | `team-snapshot.module.js:1014-1022`; `contest-ui.module.js:906-909` | Hand ClipboardItem a promise inside the click. Folds into 2-B. |
| 1.7 | **Destructive deletes don't push to the cloud first.** Reset Metric Data, Delete All, Delete Period and Delete Year skip `ensureCloudCopyIsCurrent()`, and the Reset prompt says "Back up first via Download Backup", which the work PC can't do. | `script.js:3947-3986`, `:3988-`, `:3964`; the guard is used only at `:2445,3113` | Call the guard before each one, and reword the prompt. |
| 1.8 | **Stale copy.** The upload success subtitle points to "Metric Trends", and the Sentiment help text says "Home page". | `index.html:122`, `:1081` | Reword. |

**Numbers that disagree.** These are reported only; changing them is a scoring decision.
- The Full Center Rankings "CX Adv #" has no survey floor, but the year card and the Quarterly placings use `MIN_SURVEYS_FOR_RANK = 3`. One person can therefore show two CX ranks for the same YTD file (`center-ranking.module.js:786-813` vs `:2476-2529`).
- "Improving / declining" uses three different thresholds across the Trends surfaces. `metric-movement.resolveDirection` is the designed single home.
- The Dashboard's Year-End KPI Scorecard can disagree with Score Card's team summary. It reads a different source period, and Score Card substitutes OE when Rep Sat is blank.

## 2. Phase 1: trims with no visible change (no decisions needed)

| Item | Lines | Notes |
|---|---|---|
| **A. Dead code, no test changes:** ui-utils `showSpinner/hideSpinner/switchSection/showDialog/hideDialog` (143); the seven never-called reliability functions from AUDIT 3.6 (205); contest `POST_CLOSERS`/`pickLine` (32); `navigation.initializeSection` (24); the legacy `showSubSection` router (19, plus a one-line edit at `dashboard.module.js:453`); eight exported functions with no caller (68); 13 private helpers never called (54); the script.js `buildOnOffScoreTableHtml` forwarder (4) | ~549 | Call-graph pass, each item re-grepped. List in the appendix, cluster G. |
| **B. One picture-copy pipeline:** `ui-utils.copyCanvasImage` + `renderElementToCanvas` replace five copies (contest, snapshot, year card, trend email, quarterly recap) | ~140 | Fixes 1.5 and 1.6. Keeps the light-theme pin and the Outlook text/html attempt. `tests/image-export.test.js:67-87` needs its call-site count lowered. |
| **C. One Chart.js metric bar-chart config** | ~35 | `script.js:6905-6950` and `executive-summary.module.js:975-1011` |
| **D. One worker POST** | ~20 | `contest-ui.module.js:50-61` becomes a delegate to `repoSync.postToWorker`. manifest-sync keeps its non-throwing contract. |
| **E. Date helpers** | ~25 | Four copies of `formatLocalDate` and eight month-name arrays |
| **F. Copilot hand-off** | ~38 | Four `handOffToCopilot` wrappers call `sharedUtils.copyPromptAndOpenCopilot` directly. `window.openCopilotWithPrompt` becomes a delegate. `tests/quarter-review-ui.test.js:232-243` needs updating. |
| **G. Year-End mirror wrapper** | ~13 | `renderYearEndOnOffMirror` is a copy of `renderOnOffMirrorForElementIds` (`on-off-tracker.module.js:228-244`). Same numbers. |
| **H. Matchup's copy of the Rankings period list and selector** | ~90 | `matchup._getAvailablePeriods` / `_renderPeriodSelector` are line-for-line copies of center-ranking's. This is part of open AUDIT 2.5. |
| **I. Pulse's copy of `futures.bestPeriodValue`** | ~20 | `morning-pulse.module.js:1957-1977` |
| **J. Score Card's two gap-to-next-band calculations** | ~8 | `buildGapToNextText` and `buildGapHint`. Each keeps its own formatting. |
| **K. Snapshot's two generate handlers and renderers** | ~90 | One renderer with `colourBy: 'target' \| 'center'`. Both pictures stay. |
| **L. Verint and payroll upload loops** | ~22 | One `loadFilesThrough` helper |
| **Total** | **~1,050** | |

## 3. Phase 2: click trims (small visible changes, low risk)

| Item | Clicks | Lines |
|---|---|---|
| The Upload page opens with the paste box showing, and the "Upload Metrics" button goes. | -1 on every metrics upload | -8 |
| Quarterly's associate picker joins the shared selection, as Meetings, Score Card, Mid-Year and Year-End already do. | -2 per associate when moving between review tabs | ~0 |
| One associate picker on Trends > Intelligence fills the table, insights and charts together. | -1 | -60 |
| Year-End's "Calculate On/Off Tracker" button goes; picking the associate already calculates. Optionally the same for Score Card's Calculate. | -1 | -21 |
| Simple View and the Weekly Priority Queue print the same names on the same screen; fold them into one list. | reading | -35 |
| A "Goal pace" button in the Rankings trajectory modal opens Futures with that associate picked. | about -2 | +20 |
| Settings: drop "Backup Metric Data" (a subset of "Backup Data (JSON)"), the never-filled "Associate Sentiment Snapshots" panel, and the hidden third Sync Now. Rename the two near-identical "Cloud Sync" / "Cloud sync" headings. | | -61 |

## 4. Phase 3: merges that need Scott's call

| | Proposal | Kept | Lines | Clicks and tabs | Conflict |
|---|---|---|---|---|---|
| **A** | **One "Reviews" tab** for Score Card, Mid-Year and Year-End. Associate, year, legend, On/Off table and team summary sit at the top once, with a Check-in / Mid-Year / Year-End switch below. | Every panel. Notes stores and keys unchanged. | ~-60 | Review Prep 5 tabs to 3. No bouncing to Score Card to see the KPIs while writing a review. | Memory says Mid-Year was given its own tab on purpose. |
| **B** | **Dashboard.** (i) Drop its Year-End KPI Scorecard, a 1-click copy of Score Card's team summary; or (ii) also fold the rest (YTD under-target priorities with Coach Now, Meeting All Targets, Tip of the Day) into the My Team day page when the window is Year to date, and make My Team the landing page. | Everything except the duplicate scorecard | (i) -106; (ii) about -40 more | (ii) top nav 8 to 7, and one click less every session | (ii) window-owns-time: it may show only under the YTD window. |
| **C** | **Coaching tab Quick Check-in.** It calls the same `morningPulse.generateCheckinMessage` as the My Team Check-in tone. Delete the panel and link to the day page. | Auto-copy behaviour | -58 | Same clicks | None. `resolveCheckinPeriods` stays because day-posts uses it. |
| **D** | **Intelligence's three individual Copilot buttons** (coaching email, AI Explain, AI 30-Day Goal) become one button built on the Metric Charts trend prompt. | The "conversation opener" ask; the team email | -175 | 3 buttons to 1 | `tests/baseline.js:1056-1057` needs re-recording. |
| **E** | **Goal pace.** Futures' Check-In Summary and Score Card's Goal-Pace prompt are the same deliverable; keep one. | The pace numbers stay on the Futures table either way | -235 (drop Futures modal) or -79 (drop Score Card prompt) | One place | Fix 1.4 regardless. |
| **F** | **"Did coaching work".** Replace Intelligence's Coaching Impact Tracker with the coaching-outcomes panel from the Coaching tab, the system of record. | The priority queue keeps `calculateCoachingImpact` unchanged | -90 | One answer instead of three that disagree | None |
| **G** | **Two different features are both called "Patterns".** My Team's button opens pattern-memory; Trends' tab runs metric-stability. Make one Patterns view showing both. Optionally make it a section of Intelligence. | Streaks, cliff drops and sustained runs | -15 | Optionally Trends 7 to 6 | Check against the My Team fold. |
| **H** | **Matchup roster tables** repeat Full Center Rankings rows. Add a team filter to Rankings and link to it from Matchup. | Within-team position; rival team side by side | -40 | +1 click to see a team's members | None |
| **I** | **Sentiment.** Build the summary inside the sentiment upload modal, the only place full reports exist, and remove the broken tab (fixes 1.2). | Summary composer, Copy Summary, Copilot email. The parked pre-modal code Scott asked to keep is separate and stays. | -95 | Trends 8 to 7; -2 clicks | None, as long as the parked flow stays |
| **J** | **Generate All** (1.3): delete or fix | | -40 or +5 | | |
| **K** | **Associate email addresses.** Three private `first.last@aps.com` builders bypass the Settings pattern and saved overrides; route them through `sharedUtils.resolveAssociateEmail`. | CC defaults; each flow's ordering | -50 | | Changes the To: for anyone with an override or middle name |

## 5. Looked alike, verified different, keep

- **Quarterly** is the only quarter home. Nothing else duplicates it. Its two boxes are written locally from one quarter's facts. Mid-Year asks Copilot in present tense with a status override. Year-End writes different boxes (Significant Accomplishments / Future Improvement Areas) and carries goals, merit and a verbal summary.
- **Meetings vs Quarterly:** different horizons. Meetings shows since the last 1:1, last month, the last 4 weeks and the last meeting's notes.
- **Rankings vs Matchup vs Futures:** one person against the center, team against team, and the pace to goal. Rank is computed once (`_scoreAndRank`), and every placing surface consumes it. The "what you need" figures agree because Pulse calls futures directly.
- **The My Team tones** (High five / Placings / Shout-out, Check-in / Growth / Monthly review / Cheer) are deliberate splits per the 09-24 consolidation.
- **Metric Charts' Intelligence Snapshot, email image and Sentiment Focus** are built for the trend email and the prompt, not as a second trends screen.
- **Year-over-Year** is the only prior-year comparison.
- **Calls** stays minimal by design. **Contest's two draws** are kept equal on purpose. **Attendance** pickers already share one selection. Settings' **four delete scopes** are four different "how much".
- The legacy section markup in index.html is the parts bin the tabs mount from. It is not dead.

## 6. Suggested order

1. Section 1 fixes and Phase 1 (about 1,050 lines). No product decisions, all behind the test suite.
2. Phase 2 click trims.
3. Phase 3, item by item, as Scott decides.

---

# Appendix: every finding, by cluster

Generated from the analysts' structured results. Line numbers are at `b6a7fe05`. Each overlap carries its evidence and the tests that pin it.

## A. Review Prep review writers (verdict: partial-overlap)

| Surface | Path | Clicks | Lines | Shows |
|---|---|---|---|---|
| Review Prep > Score Card (On/Off Tracker) | Review Prep (opens here, script.js:1924-1929) > pick associate (auto-calculates on change, on-off-tracker:538-543) | 3 | 330 | Band legend; facts line (period, source, end date); On/Off Track Result table Metric|Actual|Annual Goal|Stretch Goal|Score|Gap to Next with Rating Average + Overall Status; optional Team On/Off Summary table; Goal-Pace Check-in prompt |
| Review Prep > Mid-Year | Review Prep > Mid-Year tab > pick associate (skipped if carried) > Generate (copies + opens Copilot) > [Posted checkbox] | 5 | 290 | Associate, review year, Status override, development notes; the generated prompt text. No KPI table on screen. |
| Review Prep > Year-End | Review Prep > Year-End tab > pick associate (snapshot auto-renders, year-end-comments:151) > Generate prompt > Paste from Clipboard > Copy Box 1 > Copy Box 2 (+ optional Calculate On/Off Tracker, Verbal Summary Generate/Copy) | 8 | 1020 | Setup (associate, year, Year-End Status auto-filled from the mirror), facts line, On/Off Track Mirror table, Positive Highlights / Improvement Areas lists (all metrics vs target), Annual APS Goals, notes, verbal summary inputs, prompt, Final Notes paste-back |
| Review Prep > Quarterly | Review Prep > Quarterly tab > pick associate (does NOT carry) > [quarter button, defaults] > Copy strengths > Copy focus | 6 | 1282 | Q1/Q2/Q3 progression table per metric, reliability as running total, placings panel with YTD column, talking points, recap email, check-in document with header + your notes + Progress & Strengths / Areas of Focus boxes |
| Review Prep > Meetings (1:1) | Review Prep > Meetings tab > pick associate (reads/sets the shared selection by hand, one-on-one-ui:157,173) > Save / Copy talking points | 4 | 609 | Year so far from the newest real YTD upload vs target (up to 8 metrics), since last meeting delta, last month, last few weeks, what we said last time, notes, past meetings |
| Dashboard > Year-End KPI Scorecard | Dashboard (renders on load) | 1 | 90 | Team bucketed by count of the 5 KPIs scoring 2+, a coloured dot per KPI |

### A1. Year-End's On/Off Track Mirror is the Score Card result table, through the same function

Risk low, confidence high, about 13 lines. Clicks: 0 extra (the mirror renders on pick) to 0.

- **Same:** Both tables come from calculateYearEndOnOffMirror then applyOnOffMirrorResultToElements then buildOnOffScoreTableHtml with goalSource 'onoff'. Year-End goes through renderYearEndOnOffMirror and Score Card through renderOnOffMirrorForElementIds. They are two 8-line copies of one function. The only difference is that Year-End passes periodMetadata. getYearEndTargetConfig ignores that argument whenever reviewYear parses as an integer, and it always does because it comes from a number input. Both read the same latestPeriod (getLatestYearPeriodForEmployee). So every number on screen matches.
- **Must keep:** The Year-End Status auto-fill from the mirror's trackStatusValue (year-end-comments:388-390). The writer must still see the five KPI scores while writing the year-end boxes. Score Card's legend, facts line, team summary and check-in prompt all stay.
- **Proposal:** Code-only fix with no UI change: drop renderYearEndOnOffMirror and its script.js wrapper. Year-End then calls renderOnOffMirrorForElementIds(rec,'yearEndOnOffSummary','yearEndOnOffDetails',year), which returns the same result object. Surface-level fix: render the table once in the merged review tab (next item), so Year-End no longer has its own copy.
- **Memory / scope:** None. The scoring stays untouched (AUDIT 2.2: one scorer already, out of scope).
- **Tests:** tests/baseline.js (calculateYearEndOnOffMirror, unchanged); tests/survey-floor.test.js (calculateYearEndOnOffMirror, unchanged); no test references renderYearEndOnOffMirror or renderOnOffMirrorForElementIds
- **Evidence:**
  - modules/on-off-tracker.module.js:228-235 renderYearEndOnOffMirror and :237-244 renderOnOffMirrorForElementIds have the same body apart from element ids and periodMetadata
  - modules/on-off-tracker.module.js:213-226 is the shared apply function and :395-435 the shared table builder
  - script.js:4695-4704 profileYear = parsedYear when the year is an integer, so metadataProfile is never read
  - modules/year-end-comments.module.js:383-390 renders the mirror and uses trackStatusValue to auto-fill Year-End Status
  - modules/on-off-tracker.module.js:653 is the Score Card render; index.html:350-352 is the mirror markup and :483-486 is the Score Card markup
  - script.js:10091-10093 is a wrapper that only exists for the Year-End path

### A2. Year-End's 'Calculate On/Off Tracker' button repeats what the associate pick already did

Risk low, confidence high, about 21 lines. Clicks: Year-End: 9 for someone who presses the button the UI invites to Year-End: 8.

- **Same:** The button runs updateYearEndSnapshotDisplay(), then scrolls and shows a toast. That same function is already bound to the associate change and the year input, so the mirror is on screen before the button can be pressed. Score Card's Calculate button is redundant the same way: change and input already call updateOnOffTrackerDisplay.
- **Must keep:** Nothing unique: the snapshot still renders on pick and on year change.
- **Proposal:** Remove the Year-End button (markup, lookup and handler). Optionally remove Score Card's Calculate as well. Keep it if Scott wants a manual 'recalculate after upload' poke, though leaving the tab and coming back already repopulates and re-applies the selection.
- **Tests:** none (no test references calculateYearEndOnOffBtn or onOffTrackerCalculateBtn)
- **Evidence:**
  - modules/year-end-comments.module.js:151-152 binds updateYearEndSnapshotDisplay to employee change and year input
  - modules/year-end-comments.module.js:160-170 is the button handler: it runs the same updateYearEndSnapshotDisplay, then scrolls and toasts
  - modules/year-end-comments.module.js:59 is the element lookup; the button is not in the required guard (:70-92)
  - index.html:341-343 is the button markup
  - modules/on-off-tracker.module.js:538-543 binds Score Card's calculate to change, input and click alike; index.html:461-463

### A3. Score Card, Mid-Year and Year-End repeat the same setup and could be one tab with a review-type switch

Risk medium, confidence medium, about 60 lines. Clicks: Cold Mid-Year: 5, plus 2 to bounce to Score Card and back to see the numbers. Cold Year-End: 8, or 9 with Calculate. A past review year has to be typed on each tab (3x). to Cold Mid-Year: 4 (Review Prep, pick, Mid-Year switch, Generate), with the numbers already on screen. Cold Year-End: 7. The year is typed once..

- **Same:** All three repeat the same setup. Each has its own associate picker, filled by the same one-liner: picker.populateSelect(getYearEndEmployees()) appears twice, and Mid-Year reuses Score Card's copy. Each has its own Review Year input, three in all, which default independently and are NOT synced. Picking 2025 on Score Card leaves Year-End on 2026. All three run on the same on/off result. Mid-Year computes it (_buildOnOffMetricContext, on-off-tracker:662-798) but shows NO table, so writing a mid-year means switching to Score Card to see the numbers. Year-End shows the same table a second time.
- **Must keep:** Every panel: Score Card legend, facts line, result table, team summary toggle, Goal-Pace check-in prompt. Mid-Year Status override, notes (midYearMeta keyed name|year, unchanged), Generate, Posted checkbox. Year-End Status, snapshot lists, Annual APS Goals, three notes boxes, verbal summary, prompt, Box 1/2 paste-back and the draft persistence. Storage keys stay unchanged.
- **Proposal:** One 'Reviews' tab. Associate, year, legend, result table and team summary sit at the top, once. Below them a three-way switch, 'Check-in | Mid-Year | Year-End', reveals today's panels unchanged. Mid-Year and Year-End read the shared associate and year ids. Year-End's own mirror block and setup row go. Two subnav buttons and their handlers go. The switch could open on Mid-Year from June to August and Year-End from November to January, but keep it manual if Scott prefers.
- **Memory / scope:** CONFLICT: project_midyear_review_generator.md records 'Review Prep has a dedicated Mid-Year tab (between Quarterly and Year-End)'. Merging needs Scott's sign-off. Scoring is untouched: the table, the scorer and both prompts compute exactly what they do today.
- **Tests:** tests/baseline.js:1319,1323 (yearEndEmployeeSelect, onOffTrackerEmployeeSelect option baselines, which would collapse to one picker); tests/baseline.js (populateOnOffTrackerEmployeeSelect, populateYearEndEmployeeSelect, generateTeamOnOffSummary, generateQuickCheckinPrompt); tests/selected-associate.test.js:67-72 (uses midYearEmployeeSelect as its fixture id)
- **Evidence:**
  - modules/on-off-tracker.module.js:527-529 and modules/year-end-comments.module.js:143-145 are the same population; on-off-tracker:1378 has Mid-Year reusing it
  - index.html:322-329 (Year-End picker+year), :454-459 (Score Card picker+year), :504-511 (Mid-Year picker+year)
  - on-off-tracker:565-567, :1374-1376 and year-end-comments:137-141 each default their own year
  - on-off-tracker:883-891: Mid-Year reads midYearEmployeeSelect/midYearReviewYear and renders only the prompt (index.html:539-550)
  - script.js:1935-1962 has three separate subnav handlers; navigation.module.js:143-150

### A4. Quarterly's associate picker does not join the shared selection (stale registry entry)

Risk low, confidence high, about 0 lines. Clicks: Quarterly after any other review tab: 6 (Review Prep, Quarterly, pick 2, copy 2) to 4.

- **Same:** Score Card, Mid-Year and Year-End are registered in selectedAssociate (PICKER_IDS), so the associate carries between them. Meetings carries it by hand. Quarterly's #quarterReviewEmployee is not registered, and quarter-review-ui never reads or sets selectedAssociate. So moving from Meetings or Score Card to Quarterly always means picking the associate again. Separately, PICKER_IDS still lists 'oneOnOneAssociateSelect', which no markup creates; Meetings renders #oneOnOneWho.
- **Must keep:** Quarterly's own state (year, quarter, notes keyed name|year|Qn), the recap roster walk (_openRecapFor, _nextRecapName) and the team filter in _namesWithData.
- **Proposal:** Copy Meetings' hand-wired pattern. Registering by id would not work because Quarterly rebuilds the select with innerHTML on every render. In render(), when state.employee is empty and selectedAssociate.get() is in names, use it. In the change handler and _openRecapFor, call selectedAssociate.set(name). Drop the stale 'oneOnOneAssociateSelect' entry. The fix adds about 4 lines and removes 1.
- **Memory / scope:** None. Note that walking the recap roster would then move the selection on other tabs too, which is the intended behaviour of the shared selection.
- **Tests:** tests/quarter-review-ui.test.js (quarterReviewEmployee); tests/selected-associate.test.js; tests/baseline.js:1372 (fakes oneOnOneAssociateSelect itself, so it is unaffected)
- **Evidence:**
  - modules/selected-associate.module.js:31-44 (PICKER_IDS: no quarterReviewEmployee; oneOnOneAssociateSelect is listed)
  - modules/quarter-review-ui.module.js:979-982 and :1006: state.employee is set only locally
  - modules/one-on-one-ui.module.js:157,172-174 is Meetings' manual get/set
  - grep finds 'oneOnOneAssociateSelect' only in selected-associate.module.js and tests/baseline.js:1372

### A5. Mid-Year and Quarterly keep the same 'what they're working on' note in two stores

Risk low, confidence low, about 0 lines. Clicks: Notes typed twice to Typed once (Q2), edited if needed.

- **Same:** Mid-Year's notes box (midYearMeta, key name|year) and Quarterly's 'Your own notes' (key name|year|Qn) both take free text on the associate's development work and weave it into the Progress & Strengths copy. They even use near-identical placeholders (offline documents project, Percipio). At mid-year Scott types it twice. Mid-Year's prompt already pulls Quarterly's buildProgressionBlock.
- **Must keep:** Both stores and keys as they are. The Mid-Year Status override and Posted flag.
- **Proposal:** Do not merge the writers. If Scott wants it, prefill an empty Mid-Year notes box from that associate's Q2 quarterly note. That is a read only; nothing is written across stores. A small add, no removal.
- **Memory / scope:** Mid-Year is a deliberate separate generator (project_midyear_review_generator.md), so this only links the notes.
- **Tests:** tests/quarter-review.test.js; tests/store-registry.test.js (midYearMeta)
- **Evidence:**
  - index.html (midYearNotes placeholder 'offline res docs ... Percipio') vs modules/quarter-review-ui.module.js:924 ('offline documents project ... APS Percipio track')
  - modules/on-off-tracker.module.js:1291-1360 (midYearMeta) vs modules/quarter-review-ui.module.js:135-153 (quarter notes)
  - modules/on-off-tracker.module.js:785-786 calls quarterReview.buildProgressionBlock

**Looked alike, kept:**

- **Mid-Year two boxes vs Quarterly check-in document two boxes:** Both write 'Progress & Strengths / Areas of Focus' for Success Factors, but they make different decisions. Quarterly writes deterministic prose locally from one quarter's facts and says the same thing every time (quarter-review:1088-1165). Mid-Year has Copilot write from the year-to-date standing, with a Status override and tone escalation up to a disciplinary-action line (on-off-tracker:959-995). That is Scott's recorded design. Mid-Year's missing paste-back is already logged as open in AUDIT 2.4/'Still open', so it is not re-reported here.
- **Year-End two boxes vs Mid-Year/Quarterly two boxes:** Year-End writes different boxes: Significant Accomplishments and Future Improvement Areas, in the past tense. It carries data no other tab has: Annual APS Goals met/not met, merit, bonus and a verbal summary, plus self-review blending (year-end.module.js:47-93).
- **Year-End Positive Highlights / Improvement Areas lists vs the mirror table:** The lists cover every metric in getMetricOrder against its target (script.js:10054-10085), including ones outside the 5 KPIs. The table covers only the 5 band-scored KPIs. Keep both.
- **Meetings vs Quarterly per-associate numbers:** They answer different questions over different horizons. Meetings shows the change since the last 1:1 snapshot, last month, the last 4 weeks and the prior meeting's notes (one-on-one-ui:67-124). Quarterly shows quarter-by-quarter movement, placings and the running reliability total. Meetings' 'year so far' reads only the newest real YTD upload for up to 8 metrics with no bands (:74-90). Score Card reads getLatestYearPeriodForEmployee, which can fall back to weekly or auto data, so even that line is not guaranteed identical.
- **Dashboard Year-End KPI Scorecard vs Score Card Team On/Off Summary:** Both count the 5 KPIs scoring 2+ across the team, but from different source periods. The Dashboard scores the latest weekly-store period row (dashboard:436-440, getMetricRatingScore). Team Summary uses each associate's latest year period, real YTD first (on-off-tracker:1045-1047, script.js:10008-10022). Their counts can differ, so merging would change what a surface computes. One is a glance and the other a drill-down with values and gaps.
- **Score Card Goal-Pace Check-in prompt vs Mid-Year prompt:** They already share the KPI context (_buildOnOffMetricContext, on-off-tracker:662-798). The outputs differ: a casual Teams check-in vs a formal SF review, with different audiences and tone. No duplicated code beyond what is already shared.

**Analyst notes:**

I edited nothing. About 27 tool calls.

1. **Mirror vs Score Card:** yes. The Year-End 'On/Off Track Mirror' is the Score Card table, built by the same calculateYearEndOnOffMirror, applyOnOffMirrorResultToElements and buildOnOffScoreTableHtml chain. The two render wrappers (on-off-tracker:228 and :237) are copies of each other. The periodMetadata argument has no effect (script.js:4699-4704), so the numbers are identical.

2. **Associate carry-over:** the associate carries between Score Card, Mid-Year, Year-End (PICKER_IDS) and Meetings (by hand). It does NOT carry to Quarterly. The review YEAR carries nowhere: there are three independent inputs.

3. **Redundant buttons:** Year-End's 'Calculate On/Off Tracker' button and Score Card's 'Calculate' repeat what the associate pick and year input already trigger.

4. **One tab:** Score Card, Mid-Year and Year-End can be one tab with a type switch and no lost panel. It also fixes Mid-Year having no numbers on screen. It contradicts the recorded 'dedicated Mid-Year tab' decision, so ask Scott first.

5. **Line counts:** they are net of new switch code and approximate for the merge (about 95 gross, about 35 new).

6. **Click counting:** a dropdown pick counts as 2 clicks (open, choose), and a top-nav or tab press as 1.

7. **Not re-reported:** the AUDIT items already marked open or done (Mid-Year paste-back, prompt idioms, picker population). q1-review.module.js is already gone; Quarterly is the quarter-review-ui module mounted in #subSectionQ1Review.

8. **Small dead bits:** the stale PICKER_IDS entry 'oneOnOneAssociateSelect' (selected-associate:41). _saveMidYearMeta's else branch (on-off-tracker:1331-1335) calls the same saveWithSizeCheck it just failed to find, so it is a no-op.

## B. Messages to one associate (verdict: partial-overlap)

| Surface | Path | Clicks | Lines | Shows |
|---|---|---|---|---|
| Coaching tab: Quick Check-in | My Team > Coaching link > Select Associate > Generate Quick Check-in (auto-copies) | 4 | 61 | Teams message with praise and one focus point |
| My Team day page: Check-in tone | My Team > pick person > Check-in tone > Copy | 4 | 2 | Wins and the one thing to work on, over the Covering window |
| My Team day page: Monthly review tone | My Team > Last month window > person > Monthly review > Copy | 5 | 2 | Month in review message, finished month only |
| My Team day page: Cheer tone | My Team > person > Cheer > Copy | 4 | 30 | Close to a YTD target (Futures pace), week/month improvements; praise only |
| My Team day page: Growth tone | My Team > person > Growth > pick comparison in modal > Copy | 5 | 140 | How far they have come over a longer stretch, own comparison picker |
| My Team day page: High five / Placings / Shout-out | My Team > person > tone > Copy | 4 | 10 | Praise; placing DM; public post |
| Coaching tab: CoPilot Prompt > paste-back > Outlook | My Team > Coaching > Select Associate > Generate CoPilot Prompt > (Copilot) > paste > Generate Outlook Email | 6 | 330 | Weekly coaching email prompt: all ordered metrics vs registry target, reliability as YTD total, one tip per opportunity, long voice/flow rules; logs a coaching event |
| Coaching tab: Copy Verint Summary | My Team > Coaching > Select Associate > Copy Verint Summary | 4 | 94 | Summary of saved coaching history for Verint notes |
| Metric Charts: Send Metrics | Trends > Metric Charts > period > associate > Send Metrics | 5 | 18 | Metrics image for one associate |
| Metric Charts: Coaching Follow-up (app email + Copilot prompt panel) | Trends > Metric Charts > period > associate > Coaching Follow-up (opens mailto and the panel) > Copy prompt | 6 | 400 | App-written email (strengths, up to 3 focus areas with tip) and a deep prompt: every metric current/goal/previous/team avg/movement/volatility/class, sentiment snapshot, manager notes, pattern insights, action plan, 30-day goal, email draft |
| Metric Charts: Generate All | Trends > Metric Charts > period > associate = ALL > Generate All | 5 | 40 | Intended: Send Metrics for every associate |
| Intelligence: Generate coaching email (individual) | Trends > Intelligence > associate > Generate coaching email | 4 | 135 | Brief Copilot email: 6 metrics, wins, opportunities with polarity and movement, random tip; newest two weekly keys |
| Intelligence: AI Explain Insight / AI 30-Day Goal | Trends > Intelligence > associate > button | 4 | 83 | Supervisor interpretation prompt (patterns, 2 risks, 2 strengths, opener); one 30-day goal prompt; newest two weekly keys |
| Futures: Check-In Summary | Trends > Futures > Check-In Summary (row) > Copy | 4 | 234 | Doing great / areas to focus: next rating level and required average to Oct 31; skips reliability |
| Score Card: Goal-Pace Check-in Prompt | Review Prep > Score Card > associate > Goal-Pace Check-in Prompt | 4 | 79 | Copilot Teams-message prompt: strengths, focus areas vs company target with gap, stretch band, tips; can include reliability |
| Meetings: Copy talking points | Review Prep > Meetings > associate > Copy talking points | 4 | 51 | Supervisor sheet: year so far, since last meeting (stored snapshot), last month, last few weeks, notes |
| Quarterly: Talking points / Copilot | Review Prep > Quarterly > associate > Talking points | 4 | 120 | Quarter wins and what to work on next quarter, same split as the file note |
| Follow Up: Survey Feedback Coaching prompt | Follow Up > Survey Feedback > paste survey > generate > Copy and open Copilot | 4 | 32 | Coaching email for one survey |
| Trends: Sentiment prompt | Trends > Sentiment > reports > CoPilot prompt | 4 | 160 | Short coaching note on phrase reports vs sentiment goals |
| Calls: Copilot summary / Verint / Copilot email | My Team > Calls > paste > Write The Summary > paste back > Write The Email | 5 | 400 | One call transcript |

### B1. Coaching tab Quick Check-in duplicates the My Team Check-in tone

Risk low, confidence high, about 58 lines. Clicks: 4 (My Team, Coaching, associate, Generate) to 4 (My Team, person, Check-in, Copy). No clicks are saved. What you gain is one generator path and one rule for the period..

- **Same:** Both call the same generator, morningPulse.generateCheckinMessage(person, latestKey, baselineKey), with no options. The deliverable (praise plus one focus point, as a Teams message) and the wording rules are the same. The only difference is the period. The Coaching tab gets it from resolveCheckinPeriods (the newest two weekly keys). The day page gets it from the Covering window. Per project_window_owns_time, that two-weekly-key rule is the bug the window was built to remove.
- **Must keep:** The auto-copy on generate (script.js:7421). A quiet link from the Coaching tab to the day page with that associate selected, so the path still starts from Coaching. resolveCheckinPeriods itself must stay because day-posts.module.js:69 still uses it.
- **Proposal:** Delete the Quick Check-in panel (index.html:276-284), generateQuickCheckin and bindQuickCheckinHandlers (script.js:7386-7436) and the call at coaching-email.module.js:718. Optionally add a two-line 'Write a check-in on My Team' link that calls teamHub.selectMember. Update the comment at on-off-tracker.module.js:800-805, which names this button.
- **Memory / scope:** MEMORY project_window_owns_time says resolveCheckinPeriods 'survives only for the Coaching tab's quick check-in'. That is stale: day-posts.module.js:69 also falls back to it for Run My Day. Removing this panel therefore leaves resolveCheckinPeriods with one caller, not zero. The note should be corrected if this ships.
- **Tests:** tests/window-owns-time.test.js:50-51 (asserts my-team never calls resolveCheckinPeriods; unaffected); tests/window-owns-time.test.js:131 (stubs resolveCheckinPeriods for day-posts; unaffected); No test names generateQuickCheckin or quickCheckinOutput
- **Evidence:**
  - script.js:7404-7411 pulse.resolveCheckinPeriods() then pulse.generateCheckinMessage(employeeName, periods.latestKey, periods.baselineKey)
  - modules/my-team.module.js:562 checkin: () => pulse?.generateCheckinMessage?.(person, cmp?.latestKey, cmp?.baselineKey)
  - modules/my-team.module.js:516 tone hint 'Their wins and the one thing to work on' vs index.html:278 'praise and a focus point'
  - modules/morning-pulse.module.js:808-815 resolveCheckinPeriods = newest two keys of getAllSortedKeys()
  - modules/day-posts.module.js:69 is a second caller of resolveCheckinPeriods (Run My Day fallback)

### B2. Intelligence's three individual Copilot buttons are subsets of the Metric Charts trend prompt

Risk medium, confidence medium, about 175 lines. Clicks: 4 per prompt, 3 separate buttons; the Metric Charts route is 6 and forces a mailto draft first to 4 with one button.

- **Same:** For one associate, Intelligence offers three Copilot prompts: Generate coaching email (wins, opportunities with polarity, movement and tip), AI Explain Insight (patterns, 2 risks, 2 strengths, opener) and AI 30-Day Goal (one measurable goal). buildTrendCoachingPrompt already asks for an executive summary, strengths, priority areas, pattern insights, an action plan with a 30-day measurable goal, and a coaching email draft. It also feeds more facts per metric: previous value, team average, movement verdict, volatility and class, plus sentiment and manager notes. The Intelligence builders also drift from the screen they sit on. They ignore the Intelligence period selector and always read the newest two weekly keys.
- **Must keep:** The team-level group coaching email (trend-coaching-email.module.js:135-365) stays, because it has a different audience. Explain's 'one direct coaching conversation opener' is the only ask the Metric Charts prompt lacks. Whether to add it is Scott's wording call. If he says no, it goes away. The Intelligence analysis view itself (renderIndividualTrendAnalysis) is untouched.
- **Proposal:** Keep one Copilot button on Intelligence for an individual. Point it at a new exported metricTrends.buildTrendCoachingPromptFor(employeeName, weekKey), about 20 lines that wrap the existing buildTrendEmailAnalysisBundle, getSelectedTrendSentimentSnapshot and buildTrendCoachingPrompt, and pass the Intelligence period selector's key. Then delete generateIndividualCoachingEmail, buildTrendAiExplainPrompt, buildTrendAiGoalPrompt, the two buttons (index.html:1508-1509) and their handlers (script.js:6756-6761). The Metric Charts prompt's numbers are unchanged.
- **Memory / scope:** None. No metric target, band or scorer changes. The surviving prompt computes the same as today.
- **Tests:** tests/baseline.js:1056-1057 records generateIndividualCoachingEmail (baseline must be re-recorded); tests/metric-direction.test.js:122-135 scans source for metric.higherIsBetter (unaffected)
- **Evidence:**
  - modules/trend-coaching-email.module.js:22-133 (newest two keys at :30-31, 6 metrics at :49, random tip at :72)
  - script.js:6526-6557 buildTrendAiExplainPrompt and 6559-6592 buildTrendAiGoalPrompt, both read keys[length-1]/[length-2] (:6528-6530, :6561-6563)
  - script.js:6739 trendPeriodSelector exists but is not read by any of the three
  - modules/metric-trends.module.js:2075-2125 output contract: EXECUTIVE PERFORMANCE SUMMARY, STRENGTHS, PRIORITY DEVELOPMENT AREAS, PATTERN INSIGHTS, ACTION PLAN incl. '30-day measurable improvement goal' (:2063), COACHING MESSAGE DRAFT
  - modules/metric-trends.module.js:2011-2019 per-metric table line (current, goal, previous, team avg, movement, volatility, class)
  - Wording drift: trend-coaching-email.module.js:107 produces 'Target X to rose vs last period'

### B3. Two goal-pace check-ins to one associate: Futures Check-In Summary and the Score Card Goal-Pace prompt

Risk medium, confidence medium, about 235 lines. Clicks: Two separate places, 4 clicks each to One place, 4 clicks.

- **Same:** Both are a year-to-date goal-pace check-in sent to the associate: what's going great, what to focus on, and how far to go. Futures writes it directly. It uses RATING_BANDS_BY_YEAR levels and the required average to Oct 31, and it skips reliability. Score Card builds a Copilot prompt. It uses on/off-track scores and company targets with a gap, stretch band and tips, and it can list reliability as a focus area. The two use different scorers (AUDIT already records adherence 92.46 as 2 in Year-End vs 1 in Futures), so on the same day they can tell the same person different things about the same metric.
- **Must keep:** The required-average-to-next-level figure. It also appears in the Futures table itself (calculateRequiredAverage), so retiring the Futures modal loses no data. The scorers may not be unified. Whichever surface survives keeps its own numbers.
- **Proposal:** Scott chooses one goal-pace check-in. Option A: retire the Futures check-in button and modal (futures.module.js:956, 1127-1132, 1143-1369 plus 2 export lines), about 235 lines, with the pace numbers staying on the Futures table. Option B: retire the Score Card prompt (on-off-tracker.module.js:800-878, about 79 lines; _buildOnOffMetricContext stays for Mid-Year). The recommendation leans to A for code saved, but if A ships, the reliability-in-focus question below must be answered for the survivor.
- **Memory / scope:** feedback_no_reliability_in_focus (10/05) says every 'what to work on' surface must never reference reliability. The Goal-Pace prompt puts reliability over target in 'Areas I want to gently encourage them to build on' (on-off-tracker.module.js:731-732, 750), and that context is shared with the Mid-Year prompt. The Coaching tab CoPilot prompt does the same: it puts the reliability YTD total under Focus Areas with a tip (coaching-email.module.js:104-106, 285-290). Scott's note names the quarterly surfaces explicitly. Whether it covers these needs his answer. Flagged, not changed. Scoring is out of scope, so only a surface can be removed.
- **Tests:** tests/baseline.js:644-649 futures / buildCheckInSummary per associate; tests/futures-projection.test.js:314 (calculateDailyTarget arguments); tests/baseline.js:1035-1038 mid-year / generateQuickCheckinPrompt
- **Evidence:**
  - modules/futures.module.js:1195-1329 buildCheckInSummary (bands at :1204-1242, reliability skipped at :1216)
  - modules/on-off-tracker.module.js:800-878 generateQuickCheckinPrompt; focusAreas.push incl. reliability at :731-732, :750
  - modules/on-off-tracker.module.js:800-805 comment positions this as the goal-pace check-in
  - modules/on-off-tracker.module.js:872 copyToClipboard then :876 openCopilotWithPrompt copies again (two toasts)
  - Wording drift: futures.module.js:1293 '... to Top level! Keep it up.' reads like an em-dash replacement artifact

### B4. Two Copilot hand-off helpers, plus four pass-through wrappers

Risk low, confidence high, about 38 lines. Clicks: Same to Same. One fewer duplicate toast on Goal-Pace..

- **Same:** sharedUtils.copyPromptAndOpenCopilot (opens Copilot inside the click, then copies, then reports) is wrapped verbatim by four local handOffToCopilot functions. A second live helper, window.openCopilotWithPrompt in executive-summary, does it the other way round: it copies, then opens, with its own blocked-popup modal. It serves 11 call sites, so the copy-then-open ordering AUDIT pass 3 set out to remove is still the majority path. trend-coaching-email's wrapper is reachable only when context.openCopilotWithPrompt is missing, and script.js:6974 always passes it.
- **Must keep:** The global name window.openCopilotWithPrompt, so its 11 callers do not change. Each site's own toast wording, passed as options.message. The blocked-popup recovery: sharedUtils already toasts 'Copied, but the Copilot tab was blocked'. The exec-summary textarea modal would go, which is a visible change.
- **Proposal:** Make openCopilotWithPrompt a 3-line delegate to sharedUtils.copyPromptAndOpenCopilot. Replace the four handOffToCopilot wrappers with direct sharedUtils calls at their 5 call sites. Drop the redundant copyToClipboard at on-off-tracker.module.js:872. No prompt text changes.
- **Memory / scope:** AUDIT 5 item 3 is 'PARTLY DONE', not DONE. The record of five orderings collapsing into one helper misses the executive-summary helper, so this is a remainder rather than a re-report.
- **Tests:** tests/quarter-review-ui.test.js:232-243 (regex requires 'function openCopilotWithPrompt ... copyToClipboard(prompt'; must be updated); tests/call-summary-prompt.test.js:147; tests/copilot-url.test.js
- **Evidence:**
  - modules/shared-utils.module.js:328-368 copyPromptAndOpenCopilot
  - Wrappers: red-flag.module.js:133-137, metric-trends.module.js:905-909, sentiment.module.js:1525-1529, trend-coaching-email.module.js:368-372
  - Direct sharedUtils callers: coaching-email.module.js:546, year-end-comments.module.js:526; call-listening.module.js:398-418 is a real wrapper (builds the prompt), keep
  - modules/executive-summary.module.js:660-681 openCopilotWithPrompt, exported to window at :1156
  - openCopilotWithPrompt callers: script.js:6599, 8565, 8865; executive-summary:653; on-off-tracker:876, 1023; quarter-review-ui:1169; trend-coaching-email:132, 358; year-end-comments:24/532
  - trend-coaching-email.module.js:357-364 fallback only; script.js:6974 always supplies openCopilotWithPrompt

### B5. Metric Charts 'Generate All' never produces anything (duplicate of Send Metrics, broken)

Risk low, confidence high, about 40 lines. Clicks: 5 (does nothing) to 5 per associate via Send Metrics.

- **Same:** Generate All is meant to run Send Metrics for every associate. The button only shows when the associate picker is 'ALL'. The loop calls generateTrendEmail(name, weekKey), but generateTrendEmail takes no parameters and re-reads #trendEmployeeSelect, which still says 'ALL'. resolveTrendEmailContext then finds no employee named 'ALL', so each person produces an 'Employee not found' toast and no draft.
- **Must keep:** The per-associate metrics image still comes from Send Metrics. Nothing unique is lost.
- **Proposal:** Scott chooses: delete Generate All (4049-4079, the button line in index.html near :1034, bind 739-743, three visibility lines), about 40 lines, or fix it in about 5 lines by threading name/weekKey through generateTrendEmail. Deleting it matches the trim goal, since it has never worked.
- **Tests:** None found in tests/ for generateAllTrendEmails or generateAllTrendBtn
- **Evidence:**
  - modules/metric-trends.module.js:636-640 button visible only for selectedValue === 'ALL'
  - modules/metric-trends.module.js:4075-4078 generateTrendEmail(name, weekKey)
  - modules/metric-trends.module.js:1277-1280 generateTrendEmail() reads getTrendEmailSelection()
  - modules/metric-trends.module.js:1256-1267 reads #trendEmployeeSelect
  - modules/metric-trends.module.js:1170-1173 'Employee not found in selected period'

**Looked alike, kept:**

- **Coaching tab CoPilot Prompt vs Metric Charts Coaching Follow-up prompt:** Both produce a Copilot coaching email, but for different decisions. The Coaching tab is the weekly email on the latest week. It records a coaching event (coaching-email.module.js:496), which feeds Coaching History, the Verint Summary and the outcomes panels, and it has the paste-back to Outlook loop. Metric Charts is a deep dive on any uploaded period, with team average, volatility, sentiment snapshot, manager notes and a supervisor-facing analysis. They differ in record-keeping and depth. Drift to note, not cut: different target sources (registry fallback vs trend target) and metric sets. Targets are out of scope.
- **My Team Check-in vs Monthly review tone:** Monthly review needs a finished month ('in the books') and shows only under the Last month window (my-team.module.js:511, 518), per project_my_team_consolidation.
- **My Team Check-in vs Growth tone:** Growth covers a longer stretch than the window offers. It deliberately opens its own comparison picker (my-team.module.js:441-445). It reports how far someone has come, not this period's wins and focus.
- **Cheer tone vs Futures Check-In Summary:** Cheer is praise only (knocking on the door, week and month gains). Futures is a pace plan that includes focus areas. They already share one data source, futures.buildFuturesData (cheerleading.module.js header), so there is no duplicated computation.
- **High five vs Placings vs Shout-out:** These are deliberate splits per project_my_team_consolidation and feedback_no_rankings_in_celebrations. The high five must never carry a placing, Placings is a private DM, and the shout-out is public.
- **Meetings 'Copy talking points' vs Quarterly 'Talking points' vs My Team Monthly review:** They serve different audiences and periods. Meetings is the supervisor's monthly one-to-one sheet, with four horizons including a diff against a stored 'since we last met' snapshot (one-on-one.module.js:230-280). Quarterly is the quarter's file-note split, read in the room, with the no-reliability-in-focus rule (quarter-review.module.js:1269-1300). Monthly review is a message sent to the associate.
- **Survey Feedback prompt vs Calls Copilot email vs Sentiment prompt:** Each comes from a different source event: one customer survey (red-flag.module.js:883-914), one call transcript (call-listening; kept minimal per feedback_calls_page_minimal), and Verint phrase reports (sentiment.module.js:1131). None can be rebuilt from another's inputs.
- **Coaching tab Copy Verint Summary vs Calls Copy For Verint:** Both write Verint notes from different sources: saved coaching history vs one call's pasted Copilot summary.
- **Metric Charts Send Metrics vs Coaching Follow-up:** An image of the numbers vs coaching words. They are different deliverables for the same person.
- **Intelligence group coaching email:** It's addressed to the team, so it belongs to a team-message cluster rather than this one. It is kept in proposal 2.

**Analyst notes:**

The groups by moment:
- **Weekly check-in, quick message:** Coaching Quick Check-in and the My Team Check-in tone run the same generator. This is a confirmed duplicate.
- **Weekly coaching email via Copilot:** the Coaching tab, Intelligence individual and Metric Charts. Intelligence is a subset and should fold in. Coaching tab vs Metric Charts is a kept split.
- **Monthly:** My Team Monthly review (to the associate) and Meetings (the supervisor's sheet). This is a kept split.
- **Quarterly:** Review Prep Quarterly only. The quarterly message was already dropped per memory.
- **Goal pace:** Futures Check-In and Score Card Goal-Pace. One should go, which is Scott's call. Cheer is distinct.
- **Call, survey and sentiment coaching:** each has its own source, so all stay.

If Scott approves everything, about 546 lines can be removed: 58 + 175 + 235 + 38 + 40. This is net of the roughly 20-line shared prompt entry point and a 3-line delegate. Taking Option B for goal pace instead gives about 390.

**Memory conflicts to raise with Scott:**
1. project_window_owns_time says resolveCheckinPeriods survives only for the Coaching tab quick check-in. day-posts.module.js:69 also uses it as the Run My Day fallback.
2. feedback_no_reliability_in_focus: two places put reliability over target into a focus list.
   - The Goal-Pace and Mid-Year shared context (on-off-tracker.module.js:731-750).
   - The Coaching tab weekly Copilot prompt (coaching-email.module.js:104-106, 285-290).
   The rule's examples are quarterly surfaces, so the scope needs Scott's answer. No change was made.

**Drift found while reading, separate from the overlaps:**
- trend-coaching-email.module.js:107 produces the grammar 'Target X to rose vs last period'.
- futures.module.js:1293 produces '... to Top level!', which looks like an em-dash replacement artifact.
- on-off-tracker.module.js:872 and :876 copy twice, which shows two toasts.
- Metric Charts Coaching Follow-up does two things on one click: it opens an app-written mailto email (buildCoachingEmailBody, metric-trends.module.js:1296-1352) and shows a Copilot prompt that also drafts an email. Two emails from one click is a content decision for Scott, not proposed as a cut.
- metric-trends.module.js:1358 still carries a hardcoded CC fallback. AUDIT 2.4 and 2.7 already record this, so it is not re-reported.

The Verint Summary selector bug (AUDIT 1086) is already fixed at copilot-prompt.module.js:14. Nothing was edited, staged or committed.

## C. Trends analysis tabs (verdict: partial-overlap)

| Surface | Path | Clicks | Lines | Shows |
|---|---|---|---|---|
| Trends > Intelligence: Yearly Individual Summary + Weekly Metric Trends charts | Trends (opens on Intelligence) > pick associate in summaryAssociateSelect | 2 | 160 | YTD table (Adherence, Experience, FCR, Transfers, Red Flags, Phishing notes) and 13 orange Chart.js bar charts, one per metric, across every upload |
| Trends > Intelligence: Trend Intelligence & Coaching Hub (Simple View, Multi-Period Tracker, individual/group insights, blue Metric Trends charts) | Trends > pick associate in trendEmployeeSelector (inside the hub card) | 2 | 900 | Top 3 coach / top 2 recognize, DoD/WoW/MoM tracker, Quick Summary improving/getting worse, warnings/wins, Coaching Impact Score x/100, 6 core-metric bar charts (last 8 periods of the selected type) |
| Trends > Intelligence: Coaching Impact Tracker card | Trends (visible below the hub when Focus Mode is off) | 1 | 92 | Per associate Momentum %, Consistency %, Goal Progress % over the metrics coached in the last 3 sessions |
| Trends > Intelligence: Weekly Priority Queue | Trends | 1 | 275 | Coach Now / Recognize Now / Watchlist with weighted scores and legend |
| Trends > Metric Charts: Call Center Averages + Generate Trend Email (Intelligence Snapshot, Sentiment Focus, Positive Highlights/Improvement Areas, Team Metric Trend Summary) | Trends > Metric Charts > period > associate > Generate | 5 | 2300 | Modal: summary boxes, focus areas + tips, Sentiment Focus, Intelligence Snapshot table Metric|Class|Current|Goal|Prev|Team|Momentum|Volatility; PNG email image of one period vs previous vs center |
| Trends > Patterns (metric-stability) | Trends > Patterns | 2 | 680 | Consistency table (population std dev, CV, min/max over all full-week uploads), Streaks vs target, Tip effectiveness (3 weeks before vs 3 weeks after, from tipUsageHistory) |
| My Team > Patterns button (pattern-memory modal, NOT metric-stability) | My Team > Patterns | 2 | 361 | Sustained decline/improvement (3+ straight moves), cliff drop (2 SD), volatile (sample SD, CV >= 0.10 or 0.20, trend excluded), last 12 complete weeks with 20+ calls |
| Trends > Year-over-Year | Trends > Year-over-Year | 2 | 804 | Per-associate current year vs prior-year baseline, single metric or all-KPI table, sortable |
| Coaching tab outcomes panel (coaching-outcomes) | My Team > Coaching > associate | 3 | 513 | Per coaching event: baseline week vs next week, band-aware moved/held flat/went backwards, beat team median, reached target; suggestion effectiveness |

### C1. Two Chart.js bar-chart sets for one associate on the same Intelligence tab, with two associate pickers

Risk low, confidence high, about 60 lines. Clicks: Trends, pick associate in Yearly Summary picker, then pick again in the hub picker = 3 to see both chart sets and insights to Trends, pick associate once = 2.

- **Same:** Both draw one bar chart per metric of the associate's per-period value, same Chart.js config (type bar, legend top, title '<label> Trend', y beginAtZero for %, max-height 250px canvas card). Only colour, metric list, range and a data-label plugin differ.
- **Must keep:** All 13 metrics (incl. cxRepOverall, acw, holdTime, positiveWord, negativeWord, managingEmotions, reliability), full-history range, the data labels, the YTD table and Red Flag/Phishing notes in the Yearly Individual Summary
- **Proposal:** One shared buildMetricBarChart(canvas, metricKey, series, {color, dataLabels}) in executive-summary (or a small chart helper); renderTrendVisualizations calls it. Drive both from one associate picker (summaryAssociateSelect follows trendEmployeeSelector, or vice versa) so picking once fills table + insights + charts. Optionally collapse to one chart grid with a 'last 8 / whole year' toggle and the 13-metric list. Separately (a bug fix Scott should approve, since it changes the bars): give renderYearlySummaryTrendCharts week-type keys.
- **Memory / scope:** Reliability is a total (feedback_reliability_is_a_total.md): the orange charts plot weekly reliability bars (executive-summary.module.js:925). Supervisor-only surface, so not a conflict, but don't carry weekly reliability bars into any associate-facing export. Nothing in scope for targets/scoring.
- **Tests:** tests/trend-period-keys.test.js:43-53 (renderTrendVisualizations must call getTrendKeysForPeriodType and keep its name)
- **Evidence:**
  - modules/executive-summary.module.js:950-1012 card + chart builder (orange, 13 metrics from :924-926)
  - modules/executive-summary.module.js:1014-1046 renderYearlySummaryTrendCharts driven by summaryAssociateSelect (index.html:1424)
  - script.js:6836-6951 renderTrendVisualizations (blue, 6 core metrics, last 8 periods via buildTrendSeriesData script.js:5966-5977) driven by trendEmployeeSelector (index.html:1495)
  - executive-summary.module.js:1025 uses getWeeklyKeysSorted(), which merges weeklyData+ytdData and every period type (script.js:5128-5134); the bars titled 'Weekly Metric Trends' (:951) can interleave week-in-progress, month and quarter rows. This is the exact bug fixed for the queue (script.js:5710-5725) and tests/trend-period-keys.test.js:43 guards three functions but not this one.
  - modules/metric-trends.module.js:2384 canvas is the PNG email table (one period vs previous vs center), NOT a time series; not a third copy

### C2. Coaching Impact Tracker card duplicates the Coaching Impact Score on the same tab and the Coaching tab's outcomes panel, and disagrees with both

Risk medium, confidence high, about 90 lines. Clicks: Two impact readings on Trends > Intelligence plus a third under My Team > Coaching (3 clicks) to One reading, the same one shown on both tabs.

- **Same:** Three panels answer 'did coaching on these metrics work' from the same coachingHistory.metricsCoached, with three different windows and thresholds
- **Must keep:** calculateCoachingImpact must keep feeding the priority queue's points, unchanged. coaching-outcomes stays as the system of record. The Goal Progress idea (share of coached metrics now at target) is already covered by outcomes' reachedTarget.
- **Proposal:** Retire the Coaching Impact Tracker card (script.js:6602-6689, index.html:1533-1536, the 4 call sites at 6511, 6522, 6748, 6833 and the id in setTrendFocusMode :6103-6116). Put coachingOutcomes.renderTeamSummary (or renderForEmployee when an associate is picked) in the same slot, so Intelligence and the Coaching tab show one set of coaching verdicts. Keep the in-card Coaching Impact Score as is, because the queue scores from it. Ask Scott before removing the three % numbers.
- **Memory / scope:** None. No target or rating band is touched. The queue's scoring input is left exactly as is.
- **Tests:** none pin computeCoachingImpactForEmployee or renderCoachingImpactTracker; tests/coaching-outcomes.test.js:267-293 and tests/call-coaching-bridge.test.js:346-383 pin coachingOutcomes.buildOutcomes/summarizeBySuggestion/suggestionEffectiveness (unchanged by this)
- **Evidence:**
  - script.js:6602-6652 computeCoachingImpactForEmployee: ignores when coaching happened; compares the last two entries of getWeeklyKeysSorted() (merged weekly+YTD, all types) and counts improved if raw delta > 0 with no noise band (:6631); Consistency % reuses metric-trends getMetricVolatilityDetails (:6635)
  - script.js:6654-6689 renders the card into coachingImpactTrackerOutput (index.html:1533-1536)
  - script.js:6609-6615: if the newest key is a YTD file, weeklyData[latestKey] is undefined, so every associate returns null and the card reads 'No coaching impact data yet'. Same merged-list bug class as the queue fix.
  - script.js:5632-5689 calculateCoachingImpact: baseline = the week coached vs the current comparison window, normalised by 4/20/2 (getTrendDeltaThreshold script.js:5606-5611), shown as 'Coaching Impact Score x/100' inside the individual insights (trend-intelligence.module.js:338-354, 388) and used as +12/+10 points in the priority queue (script.js:5891, legend :5806-5807)
  - modules/coaching-outcomes.module.js:157-234: coached week vs next uploaded week, metric-movement band 1/8/0.5, beat-team median, reached target; already the source for the tip selector (script.js:8118, 8226)

### C3. 'Improving / declining' is decided by three different thresholds on the trend surfaces

Risk medium, confidence high, about 0 lines. Clicks: n/a to n/a.

- **Same:** The same associate, metric and periods get a direction label from three rules
- **Must keep:** All existing numbers. Per the scope rule these bands are left alone.
- **Proposal:** No code merge proposed, since unifying would change what a surface computes. Report to Scott as a decision: if he wants one rule, metric-movement.resolveDirection is the designed single home (its header :23-29 says so). The Quick Summary is the easiest case: it could pass its strongest/weakest through resolveDirection and say 'no clear movement' inside the band.
- **Memory / scope:** Borderline with the scope rule: these are trend noise bands, not KPI targets or rating bands, but AUDIT.md:764 lists them as [S] (Scott-owned). Needs Scott's call.
- **Tests:** none found for buildIndividualTrendBriefSummaryHtml
- **Evidence:**
  - Raw delta > 0, no band: trend-intelligence.module.js:300-316 Quick Summary 'X is improving by n'; script.js:6631 impact tracker momentum; pattern-memory.module.js:70-75 isWorse/isBetter
  - metric-movement band {percent 1, sec 8, hrs 0.5}: metric-movement.module.js:32, 66-73, used by metric-trends resolveMetricTrendDirection :925-940 (Snapshot 'Momentum' column :1567-1594) and coaching-outcomes :211, 223-225
  - getTrendDeltaThreshold {4%, 20s, 2h}: script.js:5606-5611, used by the Intelligence warnings and impact normalisation (script.js:5653, trend-intelligence context :1008)
  - Example: AHT 5s better week over week. Intelligence Quick Summary says 'Handle Time is improving by 5.0', Metric Charts Snapshot says 'Stable', coaching outcomes says 'held flat'.

### C4. Volatility / consistency computed three ways, and two different features both called 'Patterns'

Risk medium, confidence medium, about 15 lines. Clicks: Two places named Patterns (My Team 2 clicks, Trends 2 clicks) with different content to One Patterns view, reachable from both.

- **Same:** 'Is this associate steady on this metric' is answered by three algorithms. Trends > Patterns and My Team > Patterns share a name but run different modules.
- **Must keep:** Streaks vs target (metric-stability :223-529), cliff drop and sustained runs (pattern-memory :79-146) are unique. Keep them. Keep each algorithm's numbers.
- **Proposal:** Give the two 'Patterns' one home: Trends > Patterns renders the pattern-memory scan (the per-person flags) above the stability tables, and My Team's Patterns button opens Trends > Patterns filtered to the team/person, instead of a separate modal. Share one mean/stdDev helper (metric-stability :171-179 and pattern-memory :31-41; note one is population, one sample, so pass a flag so numbers stay identical). Label each column with what it measures ('swing over last 4' vs 'CV, all weeks') so the disagreement reads as two questions, not a contradiction.
- **Memory / scope:** project_my_team_consolidation.md folded four tabs into the day page. A Patterns button that navigates away from My Team should be checked with Scott against that design. Otherwise none.
- **Tests:** tests/metric-stability.test.js:17-47 (computeTipEffectiveness via public API; keep the export); no tests reference patternMemory
- **Evidence:**
  - metric-trends.module.js:942-992 getMetricVolatilityDetails: last 4 periods of the selected type, Volatile if avg swing >= 2.5%/18s/1.1h or >= 2 sign flips. Feeds the Snapshot Volatility column (:1586, 1623), the Copilot prompt (:1975-1977, 2018) and the Intelligence impact tracker Consistency % (script.js:6635)
  - metric-stability.module.js:171-213 computeVolatility: all full-week uploads, population SD, CV, min 4 samples, no verdict (Trends > Patterns table :442-476, 654-655)
  - pattern-memory.module.js:36-41, 148-175 detectVolatility: last 12 complete weeks with 20+ calls, sample SD, volatile if CV >= 0.10 (0.20 for aht/acw/holdTime/reliability), skipped when a trend explains it (My Team Patterns modal, my-team.module.js:657-660, 688)
  - These can disagree: AHT swinging about 20s around 420s is 'Volatile' in the Snapshot (>= 18s) but about 5% CV, so not volatile in pattern-memory and mid-table in Patterns

### C5. Simple View repeats the top of the Weekly Priority Queue on the same screen

Risk low, confidence medium, about 35 lines. Clicks: Same names read twice to Once.

- **Same:** Simple View reads the same trendPrioritySnapshot and prints the first 3 coachNow and 2 recognizeNow with the same reasons the queue lists below it
- **Must keep:** buildTrendGoalsSummaryHtml (script.js:6394-6418) that Simple View hosts; Copy This Week Plan (script.js:6420-6470) reads the snapshot, not the DOM
- **Proposal:** Fold Simple View into the queue panel: put the goals summary at the top of the queue, then the full queue. Or keep Simple View and collapse the queue under a 'Show full queue' summary. Either way one list of names.
- **Memory / scope:** None; queue scoring untouched.
- **Tests:** none for renderTrendSimpleView
- **Evidence:**
  - script.js:6125-6167 renderTrendSimpleView (topCoach slice(0,3), topRecognize slice(0,2))
  - script.js:5691-5965 renderCoachingPriorityQueue renders the full buckets into index.html:1538-1541
  - setTrendFocusMode (script.js:6119-6122) always shows Simple View, so both are on screen together

**Looked alike, kept:**

- **Metric Charts' Intelligence Snapshot vs Intelligence hub insights:** The Snapshot is one period against the previous period and the center average, built for the email and Copilot prompt (metric-trends.module.js:1545-1688, 1839-1909), and it is the only table with Class|Momentum|Volatility per metric. The hub compares multi-period windows (DoD/WoW/MoM buckets) to pick who to coach. Different period and decision. Keep both.
- **Metric Charts email PNG canvas vs the Chart.js trend charts:** metric-trends.module.js:2368-3250 draws a table image of one period (value, target, center, previous, YTD) for Outlook. It is not a time series and doesn't repeat either bar-chart set.
- **Metric Charts Sentiment Focus vs Trends > Sentiment:** Sentiment Focus (metric-trends.module.js:1497-1518) is a read-only paragraph in the email modal. It already calls the Sentiment module's own builder buildSentimentFocusAreasForPrompt (sentiment.module.js:619, pinned by tests/call-word-choice.test.js:438). Trends > Sentiment is where sentiment files are uploaded and the summary is generated. One builder, two consumers. No duplicate code.
- **Patterns tip effectiveness vs coaching-outcomes suggestion effectiveness:** Different data and windows: tipUsageHistory free-text tips, 3-week averages before vs after, raw delta, 3+ uses (metric-stability.module.js:280-400, 531-618) vs coachingHistory suggestion ids, coached week vs next week, band-aware, beat-team (coaching-outcomes.module.js:157-234, 332-406). Outcomes drives the tip selector (script.js:8118). The Patterns table is a longer-window view of the tip library. Merging would change the numbers. At most, show them side by side with a label for each window.
- **Patterns Streaks vs pattern-memory sustained improvement/decline:** Streaks count consecutive weeks meeting or missing TARGET (metric-stability.module.js:223-266). Sustained runs count consecutive week-over-week moves regardless of target (pattern-memory.module.js:79-125). Different questions.
- **Trends > Year-over-Year:** Only surface comparing against a prior-year baseline, including a pasted baseline (yoy-comparison.module.js:98-160, 205-253, 531-660). Nothing else covers that period.
- **Team Metric Trend Summary vs Intelligence group analysis:** Team summary (metric-trends.module.js:3749-4047) aggregates one period for a team email and prompt. Group analysis (trend-intelligence.module.js:451-600) sorts people into consistent/declining groups across windows. Different audience and output.
- **Weekly Priority Queue vs coaching impact:** The queue is the who-to-coach scorer and consumes calculateCoachingImpact as one input (script.js:5891). It has to stay as is under the scoring rule.

**Analyst notes:**

Things to verify before any trim (read-only audit, nothing edited):

1) PLAUSIBLE: Focus Mode may be hiding the whole Intelligence hub. trendIntelligenceFocusMode starts true (script.js:6093), and initializeTrendIntelligence applies it (script.js:6777). setTrendFocusMode hides trendVisualizationsContainer.closest('div[style*="border: 1px solid #cfe1ff"]') (script.js:6111-6116). The nearest such ancestor is the whole 'Trend Intelligence & Coaching Hub' card (index.html:1464), not a chart card, because the cfe1ff div at 1515 is a sibling, not an ancestor. If that holds, the hub's pickers, action bar (including the Focus Mode button itself, index.html:1510), Simple View, tracker, insights and charts are hidden, and the button to turn it off is inside what was hidden. Only the Yearly Summary, executive cards and Weekly Priority Queue would show. This needs a look in the live app (no console access per memory). If confirmed, it explains why the duplicates on this tab went unnoticed.

2) Dead delegation: executive-summary.module.js:106-108 calls window.renderSupervisorIntelligence, which nothing defines (grep found no assignment). So opening Intelligence never initialises the hub. initializeTrendIntelligence runs only on devcoach:teamFilterChanged (script.js:862-864). That is 3 removable lines plus the call at :524. Not in AUDIT.md section 3.

3) Same merged-key bug class as the fixed queue: computeCoachingImpactForEmployee (script.js:6606) and renderYearlySummaryTrendCharts (executive-summary.module.js:1025) both use getWeeklyKeysSorted(). tests/trend-period-keys.test.js:43 guards only three functions.

4) Two associate coaching-email generators start from Trends: Intelligence 'Generate Individual Coaching Email' (trend-coaching-email via script.js:6954-6977) and Metric Charts 'Generate Trend Email' (metric-trends.module.js:1277). That overlap belongs to the email cluster; flagged, not counted here.

5) Task premise correction: My Team's Patterns button opens pattern-memory's modal (my-team.module.js:657-660, 688), not metric-stability. Trends > Patterns runs metric-stability (script.js:1916-1921).

Clicks for 'see how one associate is trending': today, Trends (1), pick in the Yearly Summary picker (2), pick again in the hub picker (3), if the hub is visible at all. The Snapshot view (momentum/volatility) takes Trends > Metric Charts > period > associate > Generate (5). Patterns has no person filter (the teamFilter arg is passed as null, metric-stability.module.js:655, 660), so it means scrolling a 127-rep table. After: Trends > one associate pick (2) fills the YTD table, insights, one chart grid, coaching outcomes and the stability rows for that person. Metric Charts stays the email path.

Tab merges: no Trends tab can be removed without losing a panel. Patterns could become a section of Intelligence filtered by the picked associate (saves one tab and one click), but that is optional. Total net lines removable from the confirmed proposals: about 200 (60 + 90 + 15 + 35), plus about 4 for the dead delegation.

AUDIT.md items marked DONE (picker population 2.3, tip lookup 2.11) were not re-reported. The trend bands at AUDIT.md:764 remain Scott's call.

## D. Rankings, Matchup, Futures (verdict: partial-overlap)

| Surface | Path | Clicks | Lines | Shows |
|---|---|---|---|---|
| Trends > Rankings (Your Team cards, Full Center Rankings table, movement, trajectory modal with the 'Where that lands' ladder, year card) | Trends (always opens on Intelligence, script.js:1875-1879) > Rankings | 2 | 4719 | Each associate's center rank #N of total for the chosen period (defaults to the newest YTD with 30+ people). Also KPIs met, Score Sum, KPI Score, Status, each KPI's value and #rank, Rank Total, Tiebreaker and month-over-month movement. Clicking a name opens that person's year plus a what-if ladder: hold the #10 value for N weeks, and where that lands. |
| Trends > Matchup (Team Movement, head-to-head, Team Power Rankings, diagnostics, per-team roster) | Trends > Matchup | 2 | 1367 | Team standings (Avg Score, Avg Rank, W-L record) and team movement. Below them, a roster table for every team: # within the team, Name, Score (ratingAverage, which is the same value as KPI Score), Center Rank #N of total, and the five KPIs with value and #rank. |
| Trends > Futures | Trends > Futures > (optional) pick the associate from the 'All Team Members' dropdown | 3 | 1401 | For each My Team associate: YTD value, Target, Status, and the average the rest of the year needs to Meet (the goal from TARGETS_BY_YEAR) and to Exceed (the band's score-3 mark), per day, week or month. Reliability shows the hours budget left. No rank of any kind. |
| Review Prep > Score Card: 'Gap to Next' column and Team On/Off Track Summary hints | Review Prep > Score Card > pick associate | 3 | 35 | How far the current value sits from the score-2 floor ('to next level') and from score 3 ('to top level'). The team grid shows the same gaps as 'to 2' and 'to 3' under each score cell. |
| Dashboard 'Meeting All Targets' | Dashboard | 1 | 10 | Pills naming the associates meeting every target. No rank and no field size. |
| My Team shout-out and Placings tone | My Team > tone chip | 2 | 2232 | '#1 in the Call Center' / '6th best in the Call Center' with Top 5/Top 10 badges, and near-miss lines |
| Morning Pulse standings and year pace | My Team day page / Morning Pulse message | 2 | 4284 | Placing within the team ('3rd of 18'), computed from center rows, plus a year-pace sentence giving the rest-of-year average needed to land the goal |
| Review Prep > Quarterly placings panel | Review Prep > Quarterly > associate | 3 | 0 | Per-metric placings for each quarter and for YTD |
| Contest standings | Contest | 1 | 0 | Survey-count standings for the contest month |

### D1. Matchup keeps its own copy of the Rankings period list and period selector

Risk medium, confidence high, about 90 lines. Clicks: After picking a non-default period on Rankings, Matchup needs it picked again: chip, or 'Pick a period' plus a dropdown choice (1-2 clicks) to 0 with shared selection state.

- **Same:** matchup._getAvailablePeriods is a line-for-line copy of center-ranking._getAvailableRankingPeriods. It only drops the daily store and the partial-upload flag. matchup._renderPeriodSelector is the same chip row, optgroup dropdown, typeOrder and typeLabels as center-ranking._renderRankingPeriodSelector. It differs only in the '||source' option encoding, the absence of month-to-date, and a disabled 'day' chip. _formatPeriodLabel duplicates _fmtPeriodLabel, and both just delegate to periodIndex.periodLabel. Both tabs auto-pick the same default: the newest YTD with 30+ people (matchup:749-757, center-ranking:3700-3707). They still hold separate selection state, so a period picked on Rankings is lost on the way to Matchup, and the two tabs can show different periods for the same people.
- **Must keep:** Matchup's scope buttons (YTD/Monthly/Weekly with the 30-person floor, matchup:145-160). The disabled 'day' chip and its reason. Daily periods kept out of Matchup's dropdown (filter on type !== 'daily'). The '||source' value encoding, or migrate it and tests/matchup-period-picking.test.js together. Rankings' 'partial upload' marking, which Matchup would gain.
- **Proposal:** Export _getAvailableRankingPeriods and a parameterised period select (idPrefix, excludeTypes, encodeValue, chip overrides) from center-ranking, or move them into period-picker. Matchup calls them. Optionally share one selected-period key between the two tabs so they always show the same window. This sits inside the open AUDIT 2.5 'Period selection' item (section 5, item 5, not DONE). That item cites matchup:471-542, the old line numbers for this same selector.
- **Memory / scope:** None. It touches no scorer or target. Overlaps AUDIT 2.5, which is open, so this is not a re-report of a DONE item.
- **Tests:** tests/matchup-period-picking.test.js; tests/rankings-view.test.js; tests/baseline.js (scope period checks)
- **Evidence:**
  - modules/matchup.module.js:74-119 vs modules/center-ranking.module.js:221-297
  - modules/matchup.module.js:121-124 vs modules/center-ranking.module.js:299-302
  - modules/matchup.module.js:645-709 vs modules/center-ranking.module.js:307-362
  - modules/matchup.module.js:749-757 vs modules/center-ranking.module.js:3700-3707
  - Both feed centerRanking.buildRankingsForPeriod (matchup.module.js:315-318)

### D2. Matchup per-team roster tables repeat the Full Center Rankings rows

Risk medium, confidence medium, about 40 lines. Clicks: Matchup: 0 clicks, scroll to the roster. Rankings: 0, but no team filter, so one team's members have to be picked out by row tint. to Matchup to that team's members: 1 click. Rankings gains a team filter (1 click)..

- **Same:** _renderTeamRoster prints Name, Score (r.ratingAverage, which is r.kpiScore per center-ranking:524-525), Center Rank #r.rank of totalEmployees, and each KPI's value with r.metricRanks #. It sorts by compositeScore, which is r.rank (center-ranking:895). Every number comes from the same buildRankingsForPeriod rows that Rankings' Full Center table renders (center-ranking:4093 uses the same metricRanks). That table already tints rows by supervisor (_getSupervisorColor, renderRankingTable ~:4017). For 'My Team', the roster also repeats the Rankings 'Your Team' cards for the same default period.
- **Must keep:** The within-team position (#1..n per team), which Rankings never shows. Seeing a rival team's members side by side. The 'Unassigned' exclusion. Team assignment through matchup's supervisor mapping (resolveMyTeamLabel), which has to match what Rankings' supervisor tint uses.
- **Proposal:** Add a supervisor filter to the Full Center Rankings table: one select over the supervisors list. With the rows in rank order, the visible order is the within-team position, and the Rank column keeps the center rank. Replace each Matchup roster with a 'See <team> in Rankings' link that opens Rankings filtered to that team, in the same period (needs the shared period state above). Net lines are roughly -68 removed, +25 for the filter and link. This is a real trade-off: the drill-down moves from a scroll to one click. Alternatively, keep the rival rosters and drop only the 'My Team' roster, which Rankings > Your Team already covers in full.
- **Memory / scope:** project_matchup_ranking_fix.md says to fix team aggregation in buildMatchupData/compareTeams. This proposal changes neither and leaves Power Rankings, Record and Team Movement as they are.
- **Tests:** None found. _renderTeamRoster is not exported and no test greps its headers (checked tests/ for renderMatchup, 'Center Rank', 'agents)')
- **Evidence:**
  - modules/matchup.module.js:1287-1349
  - modules/matchup.module.js:815-819 (caller loop)
  - modules/center-ranking.module.js:524-525, :892-895
  - modules/center-ranking.module.js:3798-3905 (Your Team cards), :3966-4153 (table)

### D3. Morning Pulse restates futures' best-period ceiling

Risk low, confidence high, about 20 lines. Clicks: n/a to n/a.

- **Same:** morning-pulse bestWeekValue and futures.bestPeriodValue have the same body. Both read the weeklyData global, skip weeks under 20 calls (MIN_BASELINE_CALLS=20 at morning-pulse:953, MIN_CALLS_TO_JUDGE=20 in futures), use the same reverse rule (isReverseMetric is METRICS_REGISTRY[k].isReverse === true, metrics-registry:291-293), and take the best value over yearKeys. futures already exports bestPeriodValue (futures:1373-1386), and pulse already pulls calculateRequiredAverage and projectedVolume from futures. Pulse's comment at :1978-1979 says futures does not export this check, but futures exports bestPeriodValue and isWithinReach.
- **Must keep:** Pulse's rule that no weekly evidence (ceiling === null) means no sentence. That is the opposite of isWithinReach, which treats null as reachable, so call bestPeriodValue, not isWithinReach. Keep askIsPossible as it is: it rejects value <= 0 where futures.isAchievable rejects only < 0, and merging the two would change output at exactly 0.
- **Proposal:** Replace bestWeekValue with futures.bestPeriodValue at morning-pulse:2035 and delete :1957-1977. Numbers stay identical.
- **Tests:** tests/pulse-year-pace.test.js; tests/ytd-call-volume.test.js:108 (bestPeriodValue)
- **Evidence:**
  - modules/morning-pulse.module.js:1961-1977 vs modules/futures.module.js:625-640
  - modules/morning-pulse.module.js:2004-2036 (buildYearPaceText already borrows futures' arithmetic)
  - modules/futures.module.js:1373-1386 exports

### D4. Score Card computes 'gap to next band' twice in the same file

Risk low, confidence high, about 8 lines. Clicks: n/a to n/a.

- **Same:** buildGapToNextText (per-associate table) and buildGapHint (Team On/Off Track Summary grid) do the same arithmetic against RATING_BANDS_BY_YEAR: if score is 1, the distance to score2 (min or max); if score is 2 or less, the distance to score3. Only the formatting differs: toFixed(1) with 'to next level/top level' versus unit-aware rounding with 'to 2/to 3'.
- **Must keep:** Both text formats exactly as rendered today. AHT shows '-12.3' in one place and '-12s' in the other, and the rule is that numbers on screen stay identical.
- **Proposal:** One bandGaps(score, val, band) returning {toTwo, toThree}, with each caller keeping its own formatter. Small, and only worth doing when this file is already open.
- **Memory / scope:** This sits next to KPI scoring (out of scope). It moves only the display arithmetic. getRatingScore and the bands stay as they are.
- **Tests:** None found for gapText/buildGapHint strings
- **Evidence:**
  - modules/on-off-tracker.module.js:287-298
  - modules/on-off-tracker.module.js:1190-1212

### D5. 'Where does my associate rank, and what do they need' is split across two tabs

Risk low, confidence medium, about 0 lines. Clicks: Trends, Rankings, click card (rank + ladder), close modal, Futures, open dropdown, pick name = 6-7 to Trends, Rankings, click card, Goal pace = 4 (3 if embedded).

- **Same:** This is a split, not a duplicate. The rank, and the rank-door ask ('Where that lands', which rides on rankProjection), are in the Rankings trajectory modal. The goal and band ask (Meet/Exceed) is only on Futures. Both are for the same My Team associate. Today the reader closes the modal, switches tab and picks the name again.
- **Must keep:** Futures stays the home of the full table and the Check-In Summary. The modal reuses buildFuturesData; it adds no second required-average calculation.
- **Proposal:** In the trajectory modal, add a 'Goal pace' button that switches to Futures with that associate preselected, or render that associate's Futures rows inside the modal. The second option needs renderFuturesTable to take a container argument. This adds about 15-25 lines and removes none, so it is a click trim only.
- **Memory / scope:** rank-projection's header (rank-projection:24-28) says projectRank output is manager-only. The modal is manager-only, so this is fine. Don't carry it into associate copy.
- **Tests:** tests/rankings-view.test.js; tests/futures-projection.test.js; tests/rank-ladder.test.js
- **Evidence:**
  - modules/center-ranking.module.js:3554-3652 _openTrajectory, :1478-1653 ladder
  - modules/futures.module.js:865-935 renderFutures (defaults to All Team Members), :936 renderFuturesTable writes to the fixed id #futuresTableContainer

**Looked alike, kept:**

- **Merging Rankings, Matchup and Futures into one tab with a view switch:** The Trends tab bar already is the view switch, and merging would remove no rendering code. The three answer different questions at different grains. Rankings: one person against the center. Matchup: supervisor team against team, with its own floors (MIN_MEASURED_FOR_STANDING and MIN_SCORED_FOR_RANK, from project_matchup_ranking_fix.md). Futures: one person against their own goal, with no field at all. The real shared parts are the period chrome and the roster (overlaps 1-2). Fixing those gets most of the benefit.
- **Is rank among N implemented more than once?:** Center rank is computed once (_scoreAndRank, center-ranking:728-910). Matchup, celebrations, morning-pulse, year-standing and Quarterly all consume buildRankingsForPeriod/buildQuarterPlacings, and rank projection is already one shared module. The extra rankers are each deliberate. celebrations buildDisplayRanks re-ranks at display precision so two identical printed values are tied (celebrations:505-560). morning-pulse ranks within the team ('3rd of 18', :2581-2588). rankProjection.projectRank is the manager's what-if. _metricRankMap applies the survey floor for the year card and quarterly placings. Merging any of them would change numbers on screen.
- **Do the 'what you need' calculations agree?:** Yes, by construction. Morning Pulse year pace calls futures.calculateRequiredAverage and futures.projectedVolume directly (morning-pulse:2006-2026), so its ask matches Futures' Meet column. Futures Exceed and Score Card 'to top level' both read RATING_BANDS_BY_YEAR score3. The ladder answers a different question, a rank door, not a goal. Score Card's gap is today's distance to a band, and Futures' figure is the rest-of-year average needed. Both are valid under Scott's goal-versus-band model (AUDIT 2.2).
- **Matchup Team Power Rankings, Record and Team Movement versus Rankings movement:** These are team aggregates, not people. The memory note records that compareTeams and buildMovementForScope are deliberately separate paths, and that the team floors fix a team-only defect.
- **Matchup ranking diagnostic (matchup:1115-1285):** feedback_no_console_access.md says diagnostics must ship as in-app buttons. It is pinned by tests/matchup-ranking-diagnostic.test.js.
- **Rankings Your Team cards versus that team's rows in the Full Center table:** Same rows on the same screen, but the cards add the spelled-out movement sentence, the year timeline strip and 'better than X%', which is the line read before a one-on-one (center-ranking:3857-3888). The only repeated line is 'Rank Total | TB' (:3900), which isn't worth trimming.
- **My Team shout-out and Placings tone versus Rankings:** The audience is the public channel and the DM. The placing is re-derived at display precision on purpose. feedback_no_rankings_in_celebrations.md keeps the placing and keeps beaten-counts out. A different decision and audience.
- **Morning Pulse standings:** A team placing ('3rd of 18') that the center rank can't answer, gated for associate copy (survey substitution, thin volume). The code itself says it must be computed, not read off the center rank (:2581-2585).
- **Quarterly placings panel:** It already delegates to centerRanking.buildQuarterPlacings, and quarters can't be chosen in Rankings (AUDIT 2.5). This is the only home for per-quarter placings.
- **Dashboard 'Meeting All Targets':** A goal-met name list with no rank or field (dashboard:371-380). It answers 'who is clean this week' at a glance.
- **Contest standings:** Contest survey-count standings from the contest's own store (contest-ui:314). They don't use center scoring at all, and project_contest_survey_counting.md governs them.

**Analyst notes:**

I found one disagreement where the same person and period can show two different ranks. I'm reporting it, not proposing a fix, because unifying it would change a number on screen. The Full Center Rankings 'CX Adv #' comes from _scoreAndRank metricRanks (center-ranking:786-813), which has no survey floor. The year card and Quarterly placings use _metricRankMap (center-ranking:2476-2529), which applies MIN_SURVEYS_FOR_RANK = 3 and puts thin holders outside the field. So on the same YTD file, an associate with 1-2 surveys can show one CX rank in the table and a different one on the year card or Quarterly panel. This is the same root as the open item in project_matchup_ranking_fix.md (the survey floor isn't applied to associateOverall), so it's Scott's call.

Smaller duplicates outside this cluster: center-ranking has two identical isReverse helpers (_ladderIsReverse at :1343 and _metricIsReverse at :2444). Those belong to AUDIT 2.9, so I'm not re-reporting them. MIN_MATCHUP_EMPLOYEES restating the 30-person floor is already in AUDIT 4.2.

Total trimmable code: about 158 lines net (90 + 40 + 20 + 8). The overlap is mostly the chrome around the period choice and one roster table. The data and the scorers are already single-sourced (rank-projection, buildRankingsForPeriod and futures' required-average are each shared by 3-4 surfaces). Answering 'where do they rank and what do they need' goes from 6-7 clicks today to 3-4.

I made no edits and ran about 30 tool calls. I didn't open the Score Card associate-selection flow or the morning-pulse placement, so their click counts (3 and 2) are estimates.

## E. Landing pages (Dashboard, day page, Snapshot) (verdict: partial-overlap)

| Surface | Path | Clicks | Lines | Shows |
|---|---|---|---|---|
| Dashboard (top-nav landing) | Top nav > Dashboard. It is also the first-visit landing and the fallback for an unknown saved section (navigation.module.js:334, 415-417). Otherwise the app reopens the last section used. | 1 | 464 | Uses only the newest YTD file (dashboard.module.js:394-396). Shows: a summary bar with Team Members / Meeting All Targets / Need Coaching (284-295); the Year-End KPI Scorecard, with reps grouped 5..0 by count of score>=2 on Adh/AHT/Sent/RepSat/Rel and a coloured dot per KPI (219-274, scorer at 96-118); Top Coaching Priorities, which lists every rep under target sorted by normalized gap, shows x/y targets met and the worst 3 metrics against their target, with a Coach Now button (276-332, evaluateEmployee 120-189); a Meeting All Targets name list (371-380); and Tip of the Day (343-369). With no data it shows a Welcome screen with an Upload button (398-407). |
| My Team day page (whole-team view) | Top nav > My Team (script.js:1868-1872) | 1 | 2663 | Weekday tabs, the Covering window chips and the comparison line (my-team.module.js:424-436). Three cards: Team shout-out, Private round and High five round (697-740). An open 'What's behind it' panel (433-436, buildBehindHtml 633-673) holds the Team Pulse summary bar and per-person status cards over the window (morning-pulse buildTeamPulseHtml 3632-3670, summary bar 3590-3617, badges 1211-1221) with a 'Write to X' button. It also holds the daily check-in table on Day/This week, Patterns, and shout-out context. |
| My Team > Snapshot | My Team > Snapshot quiet link > pick period > Generate Team Snapshot or Generate Scorecard > Copy/Download | 5 | 1289 | A rep-by-metric grid for any weekly or YTD period (team-snapshot:359-444). The Snapshot graphic colours each cell against target, shows a +/- delta to the center average, and adds a team-average row and a Focus metric of the day (504-734, focus 450-498). The Scorecard graphic colours each cell against the center average, adds Team Avg and Center Avg rows, and says 'N of M metrics above center average' (755-966). It also has a manual center-average entry row and an exclude-absent checkbox. |
| Trends > Intelligence coaching priority queue | Top nav > Trends (opens on Intelligence, script.js:1875-1879) | 1 | 210 | Three buckets, Coach Now / Recognize Now / Watchlist, from current-vs-previous period deltas on 6 core metrics, driven by trendPeriodSelector (wow etc.). The score is built from 'below target', severity, and drops past a per-unit threshold (script.js:5691-5769, buildCoachingPriorityEntry 5828+). |
| Review Prep > Score Card team summary (comparison surface for the Dashboard KPI scorecard) | Review Prep > Score Card > Team summary button | 3 | 170 | Counts for Exceptional / Successful / Off Track, an Off Track who-and-why list, a 'Metrics Not Off Track (score 2+)' breakdown grouped 5..0, and a full table of AHT/Adh/Sent/Assoc/Rel scores with average and status (on-off-tracker.module.js:1029-1180+) |

### E1. Fold the Dashboard into the My Team day page and make My Team the landing page

Risk medium, confidence medium, about 40 lines. Clicks: Who needs me today: 0 on a first visit (Dashboard, YTD view), or 1 (My Team) for the window-driven pulse cards Scott uses daily. Most sessions restore the last section, so it is 0 or 1. The team post: My Team (1) + Team shout-out card (2) = 2 clicks. to Who needs me today: 0 (the day page is the landing, 'What's behind it' is open by default at my-team:433). The team post: 1 click (Team shout-out). The top nav drops from 8 buttons to 7..

- **Same:** Both are team-level 'who needs me' landings. The Dashboard summary bar (dashboard:284-295) and the Team Pulse summary bar (morning-pulse:3590-3617) both answer 'how many need help'. The Dashboard priorities list and the pulse status cards both list the team with what is off. With Covering = Year to date, both read a YTD file. They are different functions with different rules: the Dashboard ranks by gap to the registry target, the pulse classifies against the center average. So the overlap is the surface, not the computation. Memory project_my_team_consolidation.md:24 says 'new team-level surfaces belong on the day page, not a new tab'.
- **Must keep:** Top Coaching Priorities exactly as computed: YTD, every rep under target, gap-sorted, x/y targets met, worst-3 pills with targets. The Meeting All Targets name list and the meetingAll/needCoaching counts. The Coach Now deep link, which opens Coaching with the associate set. This is a different destination from 'Write to X', which stays on the day page. Tip of the Day, the only renderer of a random tip. The Welcome/Upload empty state. Keep evaluateEmployee unchanged, because targets and scoring are out of scope.
- **Proposal:** Move renderDashboard's priorities, stars and tip (dashboard:300-338, 343-380) into a 'Year to date: who is under target' block inside buildBehindHtml (my-team:665-672). Show it only when the whole team is selected and currentWindow().id === 'ytd'. Alternatively show it always with the YTD label, but that breaks window-owns-time (see conflicts). Change navigation.module.js:334 and 416-417 so the default and fallback landing is coachingEmailSection, the day page. Remove dashboardBtn (index.html:24), dashboardSection (index.html:39-44), script.js:1825-1827 and 1861-1864, and navigation:409-413. Keep a saved 'dashboardSection' id mapping to the day page so restore does not break. Drop the Dashboard header and summary bar (276-295) because the pulse summary bar sits right there. Fold the Meeting All/Need Coaching counts into the block heading.
- **Memory / scope:** project_window_owns_time.md:29: 'Any new surface on this page gets its periods from myTeam.currentComparison()'. The Dashboard is hard-wired to the newest YTD file (dashboard:394-396). Placing it on the day page unconditionally would add a second time owner, which the rule forbids. Gate it to the 'Year to date' window and feed it cmp.latestKey. Before shipping, verify that period-comparison's ytd window (period-comparison.module.js:57, 257-293) resolves to the same key as dashboard getLatestWeekKey (dashboard:50-59, newest ytdData key by end date), including how auto-generated YTD is treated. Otherwise the list's numbers change, which breaks the 'every number identical' rule and feedback_ytd_source_of_truth. Year-blind registry targets (AUDIT 2.1 line 169) are out of scope and stay as they are. No conflict with feedback_no_reliability_in_focus: the Dashboard already skips reliability in priorities (dashboard:76) and the surface is supervisor-only.
- **Tests:** tests/navigation-restore.test.js:25 (lists dashboardSection); tests/subsection-mounting.test.js:176-189 (every top-nav button maps to a restored section; buttons.length >= 7 still holds at 7); tests/cache-busting.test.js:156 (checks the literal '📋 Dashboard' for emoji integrity; must retarget to '📋 Review Prep'); tests/baseline.js:654-655 (cannotCover note for dashboard evaluateYearEndKpis); tests/my-team-consolidation.test.js:264-277, 372 (buildTeamPulseHtml shape; unaffected if the block is appended); tests/window-owns-time.test.js (any new day-page block must read currentComparison)
- **Evidence:**
  - modules/dashboard.module.js:390-444 initializeDashboard is YTD-only and ranks needCoaching by totalGap
  - modules/dashboard.module.js:120-189 evaluateEmployee is a separate scorer used nowhere else (not shared with the pulse or the queue)
  - modules/my-team.module.js:633-673 buildBehindHtml already hosts team status panels under 'What's behind it'
  - modules/morning-pulse.module.js:3632-3670 buildTeamPulseHtml sorts alphabetically, classifies against the center average, runs over the window
  - modules/navigation.module.js:332-334 and 415-417: Dashboard is the default and fallback landing
  - script.js:2083-2097 bindQuickActionHandlers wires only the Follow Up and Contest nav buttons and debug buttons; the Dashboard has no quick-action links, only Coach Now (dashboard:317-320) and Upload Data in the empty state (dashboard:403)

### E2. Dashboard Year-End KPI Scorecard duplicates Review Prep > Score Card's team summary

Risk medium, confidence high, about 106 lines. Clicks: 1 (Dashboard) to 3 (Review Prep > Score Card > Team summary button at on-off-tracker:586-597), or 2 if Score Card is the Review Prep default (navigation:154 falls back to subNavRpScoreCard).

- **Same:** Both group the team into buckets 5..0 by how many of the same five year-end KPIs (Adh, AHT, Sent, RepSat/Assoc Overall, Rel) score 2 or more on getMetricRatingScore. The Score Card team summary is a superset: Exceptional/Successful/Off Track counts, an off-track who-and-why list, the same 5..0 grouping, and a per-KPI score table with average and status.
- **Must keep:** Per-KPI colour per rep (Score Card's table has per-KPI scores) and the 5..0 grouping (Score Card has it). Two things Score Card lacks: the in-bucket sort by exceptional count, and the source being the newest YTD file. The numbers are NOT guaranteed identical. The Dashboard reads raw cxRepOverall with no fallback (dashboard:83) and the newest YTD file. Score Card falls back to overallExperience (on-off-tracker:47-66), uses hard-coded fallback bands when none are configured (78-105), and reads each rep's latest period in the review year (1045). Removing the Dashboard surface is allowed. Score Card's computation must not change.
- **Proposal:** Delete renderKpiScorecard and evaluateYearEndKpis with their call (dashboard:78-118, 208-274, 297-298, 435-440, about 106 lines). Score Card's team summary becomes the one home for the year-end KPI grouping. Tell Scott that RepSat counts there can differ when cxRepOverall is blank or 0, because Score Card substitutes OE. That is the existing Score Card rule, not a change.
- **Memory / scope:** KPI scoring is out of scope (AUDIT section 5 and 7). This removes a surface only and touches neither scorer. Ask Scott first: he may use the 1-click glance, and the counts can differ from Score Card for the reasons above.
- **Tests:** tests/baseline.js:654-655 (cannotCover dashboard/evaluateYearEndKpis; remove the note)
- **Evidence:**
  - modules/dashboard.module.js:79-85 YEAR_END_KPIS, 96-118 evaluateYearEndKpis (count score>=2), 219-274 renderKpiScorecard buckets 5..0
  - modules/on-off-tracker.module.js:1029-1091 generateTeamOnOffSummary counts score>=2 into groups 5..0; 1136-1150 renders 'Metrics Not Off Track (score 2+)' by count; 1154-1180 per-KPI table
  - AUDIT.md:228 already lists dashboard:96-100 as a separate 'counts, no mean' notion (documented, not marked DONE, no surface removal proposed)

### E3. Snapshot's two graphics are one grid coloured two ways

Risk low, confidence medium, about 90 lines. Clicks: My Team > Snapshot > period > Generate (or Scorecard) > Copy = 5 to 5 (unchanged).

- **Same:** Both graphics are built from the same assembleSnapshotData rows (team-snapshot:359-444) and the same period select (generateSnapshot 1181-1199 vs generateScorecard 735-753, which are line-for-line copies apart from the renderer). Both show each cell's value with the +/- delta to the center average. The unit-formatting delta block is written three times (560-574, 811-822, 853-860). The Snapshot graphic colours by target; the Scorecard colours by center average and adds a Center Avg row and an 'N of M above center' summary.
- **Must keep:** Both pasteable PNG looks (they go to Teams). The Focus metric of the day. The Center Avg row and the above-center summary. The center-avg-only metric filter (775-786). The 'enter center averages first' message (768-771). html2canvas must stay pinned to light theme (967-976, project_html2canvas_dark_mode.md).
- **Proposal:** Make one renderer that takes a colourBy option ('target' | 'center'). Share the delta formatter, header, row and team-average builders. Keep two buttons, or use one button and a toggle; either way the click count is unchanged. Merge the two generate handlers into one with a parameter.
- **Memory / scope:** None found. Target colouring uses isMetricMeetingTarget and must stay as is.
- **Tests:** tests/measured-zero.test.js:31; tests/reliability-and-survey-weights.test.js:23; tests/ytd-call-volume.test.js:241; tests/baseline.js:1407-1412 (periods only)
- **Evidence:**
  - modules/team-snapshot.module.js:545-590 per-cell target colour + center delta
  - modules/team-snapshot.module.js:800-835 per-cell center-avg colour + delta
  - modules/team-snapshot.module.js:735-753 vs 1181-1199 duplicate generate handlers

**Looked alike, kept:**

- **Dashboard 'Top Coaching Priorities' vs the Trends > Intelligence priority queue:** Different function and different question. The Dashboard (dashboard:120-189, 419-426) ranks every rep under a registry target on the YTD file by normalized gap. The queue (script.js:5691-5769, buildCoachingPriorityEntry 5828+) scores period-over-period movement on 6 core metrics and sorts into Coach Now / Recognize / Watchlist for the selected trend period. One asks 'where does the year stand', the other 'what moved this period'. Keep both. Only the Dashboard's location is in question.
- **Dashboard priorities vs the day page pulse status cards:** Not the same list or function. The pulse cards (morning-pulse:3632-3670) are alphabetical, classified against the center average with Needs Support/Watch/Solid/Crushing badges (1211-1221), driven by the Covering window, and carry period deltas. The Dashboard is gap-to-target on YTD. They overlap as surfaces (both are a landing view of who needs help), which is handled by the fold proposal, not by merging scorers.
- **Snapshot vs the day page:** Different output and audience. Snapshot produces a pasteable PNG of the full rep-by-metric grid with manually entered center averages and a focus metric (team-snapshot:504-1039) for the Teams channel. The day page produces text messages (the shout-out, the private round, high fives) and on-screen status cards. Nothing on the day page renders the full metric grid or an image. Keep Snapshot as is (aside from the internal two-graphic merge).
- **Coach Now (Dashboard) vs 'Write to X' (day page):** Different destinations. Coach Now opens My Team > Coaching with the associate set (dashboard:446-455). Write to X selects the member on the day page to show their message tones (my-team:680-686). Both must survive any fold.
- **Dashboard 'quick actions':** There are none on the Dashboard itself. bindQuickActionHandlers (script.js:2083-2097) binds the Follow Up and Contest top-nav buttons and the debug-panel buttons. So no duplicate link set exists to trim.
- **Tip of the Day:** Only the Dashboard renders a random tip (dashboard:343-369). No other module matches 'Tip of the Day'. It is unique, so it must move with any fold, not be dropped.

**Analyst notes:**

I stayed read-only: nothing was edited, staged or committed. About 33 tool calls.

Answers to the questions:
(1) Does the Dashboard show anything the day page, Snapshot or Intelligence does not? Yes, three things. The gap-to-target YTD priorities list with worst-3 pills and the Coach Now deep link. The Meeting All Targets name list. Tip of the Day. Its Year-End KPI Scorecard is only a 1-click copy of Score Card's team summary, which is a superset (the numbers can differ: RepSat falls back to OE in Score Card, and the source period differs).
(2) Is Top Coaching Priorities the same list as the Intelligence queue or the pulse cards? No. Each is a separate function with a separate rule (dashboard evaluateEmployee 120-189; script.js buildCoachingPriorityEntry 5828; morning-pulse analyzeCurrentSnapshot/getStatusBadge). None is a copy of another, and merging them would change what is computed, which is out of scope.
(3) Can the Dashboard fold into the day page? Yes, as a 'Year to date' block in What's behind it, gated to the ytd window to honour project_window_owns_time. My Team then becomes the landing page and saves a top-nav item. The catch: verify that the ytd window's latestKey equals the Dashboard's newest-YTD key before shipping.
(4) What does Snapshot show that the day page does not? The full rep-by-metric grid as a PNG for Teams, with manual center averages, a focus metric and an exclude-absent option.

Clicks: today, a first visit lands on the Dashboard. Later loads restore the last section (navigation:332-334). Who-needs-me is 0-1 clicks; the team post is 2 (My Team, Team shout-out). After the fold: 0 and 1.

Line totals for the three proposals: about 40 (the fold, net of a ~15-line new block), about 106 (the KPI scorecard), about 90 (the Snapshot renderer merge). Roughly 236 in all.

Memory checks:
- feedback_never_download_to_pc permits Snapshot's user-clicked Download (team-snapshot:979-1000). No conflict.
- project_my_team_consolidation supports putting team-level panels on the day page.
- project_window_owns_time is the binding constraint on the fold.
- AUDIT 2.2 already documents the Dashboard's 'counts' notion (line 228) without proposing removal, so the KPI-scorecard item is not a re-report of a DONE item.
- AUDIT 2.5 (Snapshot period picker) is open but belongs to another cluster and is not re-reported.

Key files: C:\Users\Scott\Development-Coaching-Tool\modules\dashboard.module.js, C:\Users\Scott\Development-Coaching-Tool\modules\my-team.module.js, C:\Users\Scott\Development-Coaching-Tool\modules\morning-pulse.module.js, C:\Users\Scott\Development-Coaching-Tool\modules\team-snapshot.module.js, C:\Users\Scott\Development-Coaching-Tool\modules\on-off-tracker.module.js, C:\Users\Scott\Development-Coaching-Tool\modules\navigation.module.js, C:\Users\Scott\Development-Coaching-Tool\script.js.

## F. Shared plumbing (verdict: overlap-confirmed)

| Surface | Path | Clicks | Lines | Shows |
|---|---|---|---|---|
| Image export: contest raffle graphic | Contest > Copy graphic (Download it instead appears only after a failed copy) | 2 | 66 | Raffle standings card rasterised by html2canvas |
| Image export: team snapshot | My Team > Snapshot > Copy / Download | 3 | 72 | Snapshot export area rasterised by html2canvas |
| Image export: rankings year card | Trends > Rankings > associate > Email month over month | 3 | 59 | Year card drawn by hand on a canvas |
| Image export: trend email image | Trends > Metric Charts > trend email | 3 | 66 | Trend email card drawn by hand on a canvas |
| Image export: quarterly recap card | Review Prep > Quarterly > recap email | 3 | 51 | Recap card drawn by drawRecapCard |
| Worker POST wrappers | n/a (plumbing) | 0 | 38 | n/a |
| escapeHtml wrappers | n/a | 0 | 130 | n/a |
| Associate address and mailto builders | Follow Up > build draft; Rankings > email; Trends > trend email; Quarterly > recap email; Attendance > coding email | 2 | 120 | n/a |
| Month-name arrays and ISO date formatters | n/a | 0 | 45 | n/a |
| Chart.js metric bar chart config | Trends > Metric Charts; Review Prep > Year-End yearly summary | 2 | 110 | One bar chart per core metric |

### F1. Five image-copy pipelines become one shared copyCanvasImage plus one renderElementToCanvas

Risk medium, confidence high, about 140 lines. Clicks: Same clicks to Same clicks. Copy now succeeds more often on Snapshot and Contest because the user activation is kept.

- **Same:** Every copy turns a canvas into a PNG blob and writes a ClipboardItem. Two also run html2canvas with the same pinned options: scale 2, white background, onclone setting data-theme light (contest-ui:884-892 and team-snapshot:966-977, the same object written twice).
- **Must keep:** The light-theme pin (it must SET light, not remove the attribute). The metric-trends text/html-with-embedded-image first attempt (2939-2946); only that path pastes into Outlook as a body image. The user-clicked Download buttons on Snapshot (979-998) and Contest (929-942), which the memory rule allows. The per-surface toast wording. Hand-drawn canvases (center-ranking, metric-trends, quarter-recap) must stay free of theme checks.
- **Proposal:** Move quarter-recap copyCardImage (795-845) unchanged into ui-utils as copyCanvasImage(canvas, {timeoutMs}) -> {state, reason}, and add ui-utils renderElementToCanvas(el), the one html2canvas call with the light pin and the ensureHtml2Canvas await. contest-ui and team-snapshot call renderElementToCanvas; copyGraphic and copySnapshotToClipboard become about 8 lines each over copyCanvasImage. center-ranking _copyYearImage maps copyCanvasImage's states to _reportImageResult and drops _downloadCanvas. metric-trends keeps its text/html attempt and falls back to copyCanvasImage instead of downloadImageFallback. Keep one downloadCanvas(canvas, name) helper for the two user-clicked Download buttons.
- **Memory / scope:** CONFLICT with feedback_never_download_to_pc.md: center-ranking.module.js:3471-3486 (_copyYearImage falls back to _downloadCanvas) and metric-trends.module.js:2964-2970 plus 2967-2969 (downloadImageFallback, also used when there is no clipboard API) write a file to disk that Scott did not ask for. On the work PC that fails, and the toast still says it was saved. tests/no-auto-download.test.js:26-30 lists only three destructive flows, so it does not catch these. The contest 'Download it instead' button (contest-ui:916-923) is user-clicked, so it is fine. project_html2canvas_dark_mode.md is still accurate: only contest-ui and team-snapshot call html2canvas.
- **Tests:** tests/image-export.test.js:67-87 ('every call site was actually inspected', checked >= 3). After consolidation there is one html2canvas call site, so the threshold must change; tests/image-export.test.js:90-102 expects exactly 2 'html2canvas(el, snapshotCanvasOptions())' and 1 'function snapshotCanvasOptions'; it must be rewritten to pin the shared helper; tests/image-export.test.js:104-125 anchors on 'function _drawYearCard' to 'function _canvasBlob' in center-ranking (keep a marker or move the anchor) and greps metric-trends and quarter-recap for isDark/data-theme. A shared helper containing data-theme must not live in those files; tests/quarter-recap.test.js:809-828 call env.recap.copyCardImage (keep a re-export) and :1228 checks that the handler calls copyCardImage('
- **Evidence:**
  - contest-ui.module.js:884-892 and team-snapshot.module.js:966-977 hold identical html2canvas option objects
  - contest-ui.module.js:906-909 and team-snapshot.module.js:1014-1022 wait for html2canvas and toBlob before building the ClipboardItem. quarter-recap.module.js:804-806 and center-ranking.module.js:3463-3466 explain that this loses the user activation and the clipboard refuses the write. Behaviour difference: snapshot and contest can fail where recap and rankings succeed
  - center-ranking.module.js:3439-3449 _canvasBlob and quarter-recap.module.js:822-824 both build the blob promise, the same code twice
  - center-ranking.module.js:3470-3486 and metric-trends.module.js:2958-2970 download a file ON THEIR OWN when the clipboard refuses, with the toast 'saved to your downloads'. quarter-recap.module.js:806-807 says 'Nothing is ever saved to the computer as a fallback: the work PC does not allow it'
  - Error reporting differs: snapshot uses alert() (1004-1035), contest writes status text, rankings uses a toast, recap returns {state, reason}, trends uses a toast

### F2. contest-ui callWorker is a copy of repoSync.postToWorker

Risk low, confidence high, about 20 lines. Clicks: n/a to n/a.

- **Same:** contest-ui.module.js:50-61 and repo-sync.module.js:1415-1428 do the same thing: the same config lookup, the same x-sync-secret header, the same POST, the same parse, and the same throw when !ok. Only the error strings differ: 'No sync endpoint is configured.' against '...(Settings, Sync and Backup).', and 'The service returned HTTP' against 'The sync service returned HTTP'.
- **Must keep:** manifest-sync's non-throwing {status, data} contract. Contest's 'No sync endpoint' message appears in the panel; the repo-sync wording is better and adding the Settings hint is harmless.
- **Proposal:** In repo-sync, split postToWorker into rawPostToWorker(body) -> {status, data} with postToWorker throwing on top of it, and export both. contest-ui callWorker becomes a one-line delegate to repoSync.postToWorker. manifest-sync callWorker delegates to repoSync.rawPostToWorker only if the manifest-sync test stub gains that function; otherwise leave it alone. Optionally route the retrieve path (1377-1390) through rawPostToWorker.
- **Memory / scope:** None. project_worker_auth_deploy.md (the secret is required on every request) is satisfied by every copy.
- **Tests:** tests/manifest-sync.test.js:15-26 stubs global fetch per machine and loads manifest-sync on its own (t.loadModule at :57). Delegating to repoSync means the test's repoSync stub must provide rawPostToWorker; tests/worker-auth.test.js (no wrapper name pinned, by grep); tests/contest.test.js reads contest-ui source at :323, :360, :970, :1035, :1458, :1513, but none of those matches callWorker
- **Evidence:**
  - contest-ui.module.js:50-61
  - repo-sync.module.js:1415-1428 (private; used at 1437 and 1442)
  - manifest-sync.module.js:80-91 has the same header and fetch code but a DIFFERENT contract: it returns {status, data} and never throws on an HTTP error, which its manifest conflict and retry logic reads (171-449)
  - repo-sync.module.js:1377-1390 (retrieve) and 1667-1675 (deleteAll, through buildRepoSyncHeaders at ~1065, which sends 'X-Sync-Secret' capitalised) are inline copies too

### F3. Three private APS address builders and five hand-built mailto strings bypass shared-utils

Risk medium, confidence high, about 50 lines. Clicks: Same to Same.

- **Same:** red-flag.module.js:332-341 buildApsEmailFromName and center-ranking.module.js:1893-1899 _apsEmailFor are the same code. metric-trends.module.js:1409-1429 buildEmployeeEmail is a third variant. All three guess first.last@aps.com without the Settings pattern or the saved overrides that shared-utils resolveAssociateEmail (264-273) honours. The mailto strings at red-flag:415, metric-trends:1358 and 1438, center-ranking:3509-3512 and 3538-3541, quarter-recap:450-455 and reliability:1368 repeat the encodeURIComponent work in openMailtoDraft (shared-utils:283-297).
- **Must keep:** Red-flag's preview-then-open flow (it needs the href string). Center-ranking's copy-the-image-then-open ordering (3517-3527). Reliability's no-CC draft. The coaching CC default.
- **Proposal:** Add sharedUtils.buildMailtoHref(to, subject, body, {cc}) and have openMailtoDraft call it. quarter-recap _href, red-flag:415, center-ranking:3509/3538 and metric-trends:1358/1438 call buildMailtoHref. Replace the three address builders with resolveAssociateEmail. NEEDS SCOTT'S SIGN-OFF: this changes the To: for associates with middle names, apostrophes, hyphens or saved overrides. That is arguably a fix, but the To: line is visible.
- **Memory / scope:** None found in memory. AUDIT 2.4 and 2.7 covered the CC; it is fixed now (DEFAULT_CC_EMAIL at shared-utils:114), so the inline fallbacks are leftovers.
- **Tests:** tests/coaching-draft-defaults.test.js:92-103 requires metric-trends, red-flag and center-ranking to contain 'getCoachingCcEmail?.()' and allows at most as many CC literals as reads. Moving to buildMailtoHref removes the reads, so the test must be retargeted; tests/draft-recipient.test.js:162-177 pins only coaching and call-listening; tests/quarter-recap.test.js:583 and tests/rankings-view.test.js:1001 assert mail.cc equals the coaching address
- **Evidence:**
  - red-flag:332-341 and center-ranking:1893-1899 join EVERY name part ('Mary Ann Smith' -> mary.ann.smith@aps.com) and keep apostrophes and hyphens
  - metric-trends:1409-1429 keeps only the first word of first and last and handles 'Last, First'
  - shared buildAssociateEmail (221-261) strips every non-alphanumeric ('O'Brien' -> obrien) and uses the pattern
  - so the To: line differs between pages for the same associate, and an override typed on Calls is ignored on Follow Up, Rankings and Trends
  - red-flag:415, metric-trends:1358,1438 and center-ranking:1889 add a '|| Brandywine.Lockhart@aps.com' fallback, which is dead because getCoachingCcEmail already defaults (shared-utils:114)
  - red-flag builds the href early for a preview and opens it later with window.location.href (552-559); center-ranking opens with target=_blank; reliability:1365-1369 deliberately has no To and no CC

### F4. Two Chart.js metric bar-chart configs

Risk low, confidence medium, about 35 lines. Clicks: n/a to n/a.

- **Same:** script.js:6905-6950 and executive-summary.module.js:975-1011 build the same bar chart config: label, borderWidth 2, legend top, the title '<label> Trend' in bold 14, beginAtZero for %, and the y title from the unit. They also share the destroy-existing step (script.js:6903-6904, executive-summary:973-974).
- **Must keep:** Each surface's colour, data labels, minimum-points rule and data series.
- **Proposal:** Add one renderMetricBarChart(canvas, metric, metricKey, data, {color, dataLabels}) in metric-trends or ui-utils; both callers pass their own colour and plugin flag. Only the config moves; the data-gathering code stays where it is.
- **Memory / scope:** None. No metric math changes.
- **Tests:** tests/trend-period-keys.test.js references renderTrendVisualizations (data keys, not config)
- **Evidence:**
  - Differences: the colour (blue rgba(60,120,200) in script.js against orange rgba(255,152,0) in executive-summary); script.js adds the barDataLabels plugin (6880-6900) and top padding 16; script.js needs at least 2 points and executive-summary at least 1
  - the data sources differ too (getTrendKeysForPeriodType against weekly keys only), so the surfaces themselves stay

### F5. Date to YYYY-MM-DD copies of shared formatLocalDate, and eight month-name arrays

Risk low, confidence high, about 25 lines. Clicks: n/a to n/a.

- **Same:** associate-activity:42-45, daily-outreach:106-111, quarter-trend:68-70 and upload-wizard:55-60 each rebuild formatLocalDate (shared-utils:53-60) from local date parts and return the same output for a valid Date. Eight modules declare the same January..December array.
- **Must keep:** Local-midnight semantics (no UTC parse). The test harness loads modules with an empty DevCoachModules (contest.module.js:509-511), so the contest graphic path needs a fallback.
- **Proposal:** Have the four copies call sharedUtils.formatLocalDate. Put MONTH_NAMES on the constants module and read it from the seven non-harness-sensitive modules; contest.module keeps its own copy for the harness.
- **Memory / scope:** None. reference_test_clock.md: the suite runs at 2026-08-18, so any date edit should be probed with TEST_CLOCK.
- **Tests:** tests/baseline.js:1245-1248 pins formatLocalDate output; tests/matchup-period-picking.test.js:22 has its own MONTH_NAMES (a fixture, unaffected)
- **Evidence:**
  - shared formatLocalDate also accepts strings and returns '' for an invalid date; the copies would print NaN. That only differs for invalid input
  - month arrays: center-ranking:2438, cheerleading:40, contest-ui:822, contest:463, morning-pulse:1606, period-compare:75, quarter-recap:39, upload-wizard:300

### F6. 33 escapeHtml wrappers with five different fallbacks

Risk medium, confidence medium, about 60 lines. Clicks: n/a to n/a.

- **Same:** Every wrapper forwards to sharedUtils.escapeHtml. shared-utils loads first in the app (index.html:1790), so in production all 33 give the same result.
- **Must keep:** Escaping inside the harness for anything a test renders (contest gfxEsc at least).
- **Proposal:** Low value. Either leave as is, or have tests/harness.js preload shared-utils and then reduce each wrapper to one line forwarding to sharedUtils. Do not remove the fallbacks without a harness change, because module tests load single modules.
- **Tests:** tests/contest.test.js:470-485 (gfxEsc fallback); any module test that loads a module through t.loadModule without shared-utils
- **Evidence:**
  - They differ only when sharedUtils is missing, which happens in the test harness: contest-ui:32, coaching:6, trend-intelligence:6, coaching-outcomes:48, executive-summary:51, morning-pulse:1365,3601, sentiment:1065 and employee-list:33 do NOT escape at all; dashboard:15, futures:23 and metric-stability:40 skip quotes; celebrations, center-ranking, matchup, futures and yoy return 'null' for null
  - team-snapshot.module.js:104-107 is a full independent implementation that never calls shared
  - contest.module.js:505-514 gfxEsc is pinned by tests/contest.test.js:470 ('hostile names') because it must escape inside the harness

**Looked alike, kept:**

- **Quarter recap canvas against the Quarterly tables against quarter-trend:** The data layer is already shared: quarter-recap reads _mod('quarterReview') 5 times and quarter-review-ui reads quarterReview, quarterTrend and quarterRecap. drawRecapCard (quarter-recap:682-795) makes a light PNG for an associate's inbox; quarter-review-ui makes the on-screen check-in tables. Different output and audience. The only drawing primitive involved (_roundRect at quarter-recap:664-675) has no copy elsewhere.
- **Hand-drawn canvas cards (center-ranking _drawYearCard 3021-3437, metric-trends trend email 2384-3260, quarter-recap drawRecapCard):** Each draws different content (year trajectory, trend summary boxes, quarter tiles). They share no copied primitive, and tests/image-export.test.js:104-125 pins each as theme-free on its own. Merging them would be a redesign, not a trim.
- **M/D date formatters with different outputs:** contest.module:1338 gives '7/1' unpadded for the contest span; quarter-review-ui:638 gives '07/01'; quarter-recap:965 formats a timestamp (sent-log 'at') in local time; script.js:1542, quarter-review:136 and associate-activity:165 give MM/DD/YYYY but differ on empty input ('' against the raw text against 'none on file'). They are visibly different strings, so merging changes what is on screen. Only the MM/DD/YYYY trio could share code, and the gain is about 6 lines.
- **manifest-sync callWorker against repoSync.postToWorker:** The plumbing is the same but the contract is not: manifest-sync needs the HTTP status without a throw for its manifest compare-and-swap (manifest-sync:171-449). It can share a raw layer but must not be swapped for the throwing postToWorker.
- **User-clicked Download buttons (Snapshot 979-998, Contest 929-942):** feedback_never_download_to_pc.md explicitly allows export buttons the user clicks. They stay. Only the automatic fallbacks in center-ranking and metric-trends break the rule.
- **executive-summary and on-off-tracker formatDateMMDDYYYY wrappers:** These are thin delegates to the script.js global (executive-summary:58-60, on-off-tracker:27-29, year-end-comments:19), not copies. Removing them saves about 9 lines and adds churn.

**Analyst notes:**

I read AUDIT.md section 2.6 (image clipboard bypasses) and section 5 item 4: they are listed but NOT marked DONE, so the image-pipeline finding builds on them rather than repeating a closed item. Two rule conflicts need attention. (1) center-ranking.module.js:3470-3486 and metric-trends.module.js:2964-2970 automatically download a PNG when the clipboard refuses, which breaks feedback_never_download_to_pc. tests/no-auto-download.test.js:26-30 checks only three destructive flows, so it misses them. (2) team-snapshot:1014-1022 and contest-ui:906-909 build the ClipboardItem only after html2canvas and toBlob have finished, which loses the user activation; quarter-recap:804-806 documents that bug. Moving both onto quarter-recap's copyCardImage fixes both problems. The address-builder merge changes the To: line for some associates, so ask Scott before shipping it. Biggest wins in order: the image pipeline (~140 net), the mailto and address builders (~50), Chart config (~35), escape wrappers (~60, only after a harness change), the worker wrapper (~20), dates and months (~25). Line counts are net of the new shared helpers (about 70 lines for the image helpers, about 8 for buildMailtoHref, about 30 for the chart helper). No metric targets, bands or scoring are touched. Files: C:\Users\Scott\Development-Coaching-Tool\modules\quarter-recap.module.js, contest-ui.module.js, team-snapshot.module.js, center-ranking.module.js, metric-trends.module.js, repo-sync.module.js, manifest-sync.module.js, red-flag.module.js, shared-utils.module.js, executive-summary.module.js, script.js; tests\image-export.test.js, coaching-draft-defaults.test.js, quarter-recap.test.js, manifest-sync.test.js, no-auto-download.test.js.

## G. Dead code (verdict: overlap-confirmed)

| Surface | Path | Clicks | Lines | Shows |
|---|---|---|---|---|
| Legacy section hosts in index.html (tipsManagementSection 839, metricTrendsSection 853, debugSection 1043, sentimentSection 1073, ptoSection 1385, executiveSummarySection 1412, teamSnapshotSection 1679) | n/a. Their children are moved into the live sub-tabs on first use | 0 | 0 | Nothing on their own. Each is a parts bin that script.js moves into a tab: script.js:1831 (snapshot), :1852 (pto), :1997 (exec summary), :2005 (metric trends), :2044-2054 (tips), :2222-2225 (sentiment). debugSection is shown directly (script.js:2078, navigation.module.js:384-387) |
| Navigation legacy helpers | n/a | 0 | 85 | showSubSection router (navigation.module.js:196-210), OLD_SUB_MIGRATION and old-id migrations (:224-277), initializeSection (:420-442) |
| script.js one-line forwarders | n/a | 0 | 4 | 61 functions whose body is a single window.DevCoachModules call. 60 still have a caller; only buildOnOffScoreTableHtml (script.js:10095-10097) has none |
| morning-pulse and celebrations after the 2026-09-24 fold | My Team > day page | 1 | 4 | A call-graph check rooted at every external caller finds all 89 morning-pulse functions reachable, and 70 of 71 celebrations functions (only describeField, test-only, is not) |

### G1. ui-utils spinner, dialog and switchSection: never called

Risk low, confidence high, about 143 lines. Clicks: n/a to n/a.

- **Same:** showSpinner, hideSpinner, switchSection, showDialog and hideDialog are defined, exported and copied onto window, but no file in script.js, index.html, bootstrap.js, raffle.html, modules/ or tests/ names them. The app's own spinners and modals are built elsewhere.
- **Must keep:** showToast, copyToClipboard, flashButton, injectUIAnimations and the window.copyToClipboard/flashButton/showToast lines
- **Proposal:** Delete the five functions, their five export keys and the three window.* lines. Dead, no test pin.
- **Memory / scope:** None. Not listed in AUDIT.md.
- **Evidence:**
  - modules/ui-utils.module.js:105-145 showSpinner, :150-155 hideSpinner, :160-175 switchSection, :180-247 showDialog, :252-255 hideDialog
  - modules/ui-utils.module.js:295-299 exports, :307-309 window.showSpinner/hideSpinner/switchSection
  - Grep for each name across script.js, index.html, bootstrap.js, modules/*.js and tests/*.js matches only modules/ui-utils.module.js
  - The other uiUtils consumers use only showToast and copyToClipboard (script.js:182, contest-ui:675/692/901, debug:378, on-off-tracker:1394, quarter-review-ui:30-46, team-snapshot:1023)

### G2. reliability.module.js: seven never-called functions (AUDIT 3.6, still present)

Risk low, confidence high, about 205 lines. Clicks: n/a to n/a.

- **Same:** AUDIT.md:708-710 listed these as never called and section 8 does not mark them DONE. They are still in the file and still have no callers: the old ledger table and its filters, row-click binder, three standalone email builders (the live path is buildVerintCorrectionsDraft at :1215, called from :2386) and summarizeDateList.
- **Must keep:** buildVerintCorrectionsDraft (:1215) and everything reachable from initialize / handleVerintUpload / handlePayrollUpload
- **Proposal:** Delete the seven functions and the unused STORAGE_KEY constant. AUDIT.md:727 says to re-check before acting because the file had uncommitted changes then. The tree is clean now and the grep was re-run today.
- **Memory / scope:** None. Attendance is payroll-driven per project_payroll_attendance_rebuild.md, and none of these feed the payroll path.
- **Evidence:**
  - modules/reliability.module.js:1171-1183 buildPtostDesignationEmail, :1185-1197 buildWfmCorrectionEmail, :1199-1213 buildPcIssueEmail, :1383-1388 summarizeDateList, :1419-1527 buildAllEmployeesDayTable, :1566-1599 bindAllEmployeesLedgerFilters, :2605-2618 bindRowClicks
  - Grep of each name across all app files and tests matches only its own definition line in reliability.module.js
  - modules/reliability.module.js:8 var STORAGE_KEY = 'reliabilityTracker' has no other reference (AUDIT.md:724)

### G3. contest.module.js: POST_CLOSERS and pickLine are unreferenced

Risk low, confidence high, about 32 lines. Clicks: n/a to n/a.

- **Same:** The rotating closer pool and its picker were written for a text standings post. No code reads either, including buildStandingsPost.
- **Must keep:** The standings graphic (buildStandingsGraphicHtml :1220) and buildCheckinPost (:1354), which are the live postables
- **Proposal:** Delete lines 396-427.
- **Memory / scope:** None. Raffle and survey-count rules (project_contest_raffle_draw.md, project_contest_survey_counting.md) are untouched.
- **Evidence:**
  - modules/contest.module.js:396-427 (comment banner, POST_CLOSERS array :407-416, pickLine :422-427)
  - Grep for POST_CLOSERS and pickLine finds only :407 and :422; neither is exported; tests/ does not name them

### G4. contest.buildStandingsPost: test-only

Risk low, confidence high, about 24 lines. Clicks: n/a to n/a.

- **Same:** Exported and tested, but no app code calls it. The live post is the graphic plus buildCheckinPost.
- **Must keep:** buildLeaderboard (:232), which the live code also uses
- **Proposal:** Delete the function, its export and the test suite tests/contest.test.js:274-292. This is a test-only deletion, so the test has to change with it.
- **Tests:** tests/contest.test.js:274-292
- **Evidence:**
  - modules/contest.module.js:371-393 (banner and function), export :2262
  - Only other reference: tests/contest.test.js:282 inside suite :274-292

### G5. navigation.initializeSection: never called

Risk low, confidence high, about 24 lines. Clicks: n/a to n/a.

- **Same:** This is an exported switch over the old standalone section ids (tipsManagementSection, metricTrendsSection, executiveSummarySection, debugSection). Nothing calls it, and two code comments already say so.
- **Must keep:** restoreLastViewedSection's own debugSection branch (:384-387)
- **Proposal:** Delete the function and its export key.
- **Evidence:**
  - modules/navigation.module.js:420-442, export :456
  - Grep 'initializeSection(' across app and tests: only the definition
  - script.js:2017 and tests/draft-recipient.test.js:148 comments: 'initializeSection, which nothing called'

### G6. Legacy showSubSection router has one caller left

Risk low, confidence high, about 19 lines. Clicks: n/a to n/a.

- **Same:** navigation.showSubSection only dispatches to the My Team, Trends or Review Prep router. The single remaining caller passes a My Team sub, so it can call showMyTeamSubSection directly.
- **Must keep:** The dashboard button must still open My Team > Coaching
- **Proposal:** Change dashboard.module.js:453 to showMyTeamSubSection(...). Then delete navigation.module.js:196-210, the export key and script.js:300-302.
- **Evidence:**
  - modules/navigation.module.js:196-210 and export :447
  - script.js:300-302 global wrapper
  - Only caller: modules/dashboard.module.js:453 showSubSection('subSectionCoachingEmail', 'subNavCoachingEmail')

### G7. Exported functions with no caller (no test)

Risk low, confidence high, about 68 lines. Clicks: n/a to n/a.

- **Same:** Each is exported from its module, but no app file or test names it outside its own definition and export line.
- **Must keep:** script.js:800 setTeamMembersForWeek, which is the live one
- **Proposal:** Delete the eight functions and their eight export keys.
- **Evidence:**
  - modules/period-compare.module.js:1204-1207 getTimelineFor, :1419-1425 getMovementFor (exports :1451, :1454)
  - modules/period-comparison.module.js:387-394 resolveById (export :400)
  - modules/trend-intelligence.module.js:180-197 buildTodaysFocusCopilotPrompt (export :595)
  - modules/call-explanation.module.js:728-737 buildPanelText (export :783)
  - modules/manifest-sync.module.js:605-607 getLocalSyncVersion (export :618)
  - modules/team-filter.module.js:60-65 setTeamMembersForWeek (script.js:800 has its own live global of the same name, called at script.js:7077), :91-94 isTeamMember (exports :277, :279)

### G8. Private helpers never called

Risk low, confidence high, about 54 lines. Clicks: n/a to n/a.

- **Same:** These are module-private functions with zero call sites. Several are leftover shims from before the shared helpers existed.
- **Must keep:** Nothing. None of these is reached.
- **Proposal:** Delete all 13 helpers.
- **Evidence:**
  - modules/center-ranking.module.js:1901-1905 _padEnd, :1906-1910 _padStart (AUDIT.md:717, still present)
  - modules/period-compare.module.js:168-174 _prevMonthKey (AUDIT.md:718, still present)
  - modules/coaching-email.module.js:629-631 _copilotUrl; modules/year-end-comments.module.js:9-11 _copilotUrl
  - modules/dashboard.module.js:30-32 getWeeklyData; modules/team-snapshot.module.js:129-131 getMyTeamMembers
  - modules/call-coaching-bridge.module.js:210-212 qaMetricsFor; modules/call-listening.module.js:614-620 lowerFirst; modules/call-summary.module.js:189-195 openingCustomerTurns
  - modules/executive-summary.module.js:44-48 filterAssociateNamesByTeamSelection, :90-92 getYearEndOnOffScoreOrFallback. The test hits for these names are on the teamFilter and on-off-tracker versions, not these shims.
  - Grep of each name in its own file shows only the definition line

### G9. script.js forwarder buildOnOffScoreTableHtml has no caller

Risk low, confidence high, about 4 lines. Clicks: n/a to n/a.

- **Same:** This is the only one of 61 script.js forwarders that nothing calls. on-off-tracker calls its own internal copy (on-off-tracker.module.js:214).
- **Must keep:** The other 60 forwarders, which all have callers (e.g. initializeMidYearTab at script.js:1956, renderYearEndOnOffMirror via year-end-comments.module.js:20)
- **Proposal:** Delete the three-line wrapper and its blank line.
- **Evidence:**
  - script.js:10095-10097
  - No window.buildOnOffScoreTableHtml or bare call outside on-off-tracker.module.js

### G10. storage.module.js duplicate copies the app never routes through (test-pinned)

Risk medium, confidence medium, about 86 lines. Clicks: n/a to n/a.

- **Same:** The storage module exports its own saveNickname, getSavedNickname, appendCoachingLogEntry, saveCallCenterAverages, loadUserTips, saveUserTips, saveTipUsageHistory, isStoreStale and saveHotTipHistory. The app calls the script.js or tips.module.js versions instead (script.js:470/480 nicknames, :549 coaching log, :903 averages, :6032 tip usage, tips.module.js:595/621 user tips). saveHotTipHistory is residue of the deleted hot-tip module (AUDIT.md:692).
- **Must keep:** The live behaviour, which runs through the script.js and tips.module.js versions. Do not touch the sync keys for hotTipHistory or complianceLog in repo-sync or the worker. Removing those is a separate data question.
- **Proposal:** Pick one home for each function, preferably storage per the chokepoint tests, and delete the other. In the dead-only version, delete the nine storage copies and update the chokepoint tests to point at the live functions. Medium risk: the tests suggest storage was meant to become the home, so deleting the storage copies may run against that plan.
- **Memory / scope:** The chokepoint tests point toward storage being the intended home. Better to flip the callers to storage than to delete storage's copies.
- **Tests:** tests/read-chokepoint-storage-module.test.js; tests/backend-switch-prereqs.test.js
- **Evidence:**
  - modules/storage.module.js:209-211, :908-919, :1061-1068, :1070-1080, :1082-1090, :1092-1099, :1101-1108, :1118-1125, :1164-1173; export lines in :1440-1460
  - script.js:470, :480, :549, :903, :6032 and tips.module.js:595, :621 are the live implementations
  - Tests name several: tests/backend-switch-prereqs.test.js, tests/read-chokepoint-storage-module.test.js (saveTipUsageHistory and others)

**Looked alike, kept:**

- **AUDIT 'newly dead' functions: showCoachingPromptCopiedState, openCopilotForCoachingPrompt, setYearEndPromptButtonFeedback, copyYearEndPromptWithFallbacks:** Already deleted. Grep across app and tests finds no match. Nothing to do.
- **Other AUDIT 3.6 entries (buildConfidenceInsight, buildTodaysFocusData, detectComplianceFlags, logComplianceFlag, getCoachingContext, importPtoBalanceExcel, importPayrollExcel, q1-review _isReverseMetric, UPLOAD_HEADER_FINGERPRINT_KEY, renderComplianceAlerts):** Already gone (zero grep hits). embedPtoTracker is live (script.js:1850, called from my-team.module.js:268, pinned by tests/subsection-mounting.test.js). Only the reliability seven, the center-ranking pads and _prevMonthKey remain, and they are reported above.
- **Sentiment pre-modal upload flow (sentiment.module.js:1874-2138: handleSentimentFileChange, openSentimentPasteModal, saveAssociateSentimentSnapshotFromCurrentReports, 263 lines):** Zero callers, but the banner at sentiment.module.js:1850-1872 says 'KEPT ON PURPOSE. NOT WIRED UP ... Kept, not deleted, at Scott's request' because the sentiment work is coming back. It is a recorded decision, so do not delete it without asking Scott.
- **Legacy section markup (metricTrendsSection, executiveSummarySection, sentimentSection, ptoSection, teamSnapshotSection, tipsManagementSection, debugSection):** Not dead. Each is the parts bin that script.js moves into a live tab (script.js:1831, :1852, :1997, :2005, :2044-2054, :2222-2225), and debugSection is shown directly (script.js:2078). tests/app-flow.test.js:98 and tests/subsection-mounting.test.js:170-172 pin the tips and pto hosts. Writing the markup straight into the sub-tabs would remove the move code, but that is a refactor that relocates markup, not a deletion.
- **OLD_SUB_MIGRATION and old-id migrations (navigation.module.js:224-277):** AUDIT.md:697-699 records this as 'deliberate and live', kept so a saved nav state from an older build still opens. It is very likely inert by now, because the first save rewrites the state without coachingSubSectionId. Still, it is a recorded keep, about 45 lines, and no test pins it. Delete only if Scott agrees.
- **morning-pulse.module.js and celebrations.module.js after the four-tab fold:** The fold left no dead code. A call graph rooted at external callers reaches all 89 morning-pulse functions and 70 of 71 celebrations functions. tests/my-team-consolidation.test.js:315-327 already guarantees the removed renderers are gone. The one unreached function, celebrations describeField (:1678-1681), is a 4-line test-only export pinned by tests/celebrations-scope.test.js.
- **script.js one-line forwarders (61 of them):** 60 of 61 still have callers in script.js, other modules or tests (e.g. navigation wrappers: 51 call sites; installDebugListeners script.js:7112; enforceRepoAutoSyncEnabled :7201; deleteAllRemoteData :4008). They are live globals that modules reach through shared lexical scope. Only buildOnOffScoreTableHtml is dead.
- **Test-only exports that serve as deliberate test seams:** idb-backend archivePut/Get/Keys/pendingWriteCount/_reset, period-index isFreshFor/previousYearToDate/previousOfType, selected-associate subscribe, quarter-trend quarterOfDate, associate-activity getInactiveAssociates, call-verification and call-red-flags buildAlertText, call-trends buildTrendText, highlights groupByTeam, period-compare buildMonthOverMonthRanks. Each is named only by tests (about 130 lines in all). Most are small API surfaces or pure helpers kept for testing. Deleting them deletes coverage and gains little.
- **metric-profiles getRatingBandColor / hasRatingBand:** Test-only, but they sit in the metric-band layer, which is out of scope (AUDIT.md section 5, Scott 2026-08-25). Leave them alone.
- **complianceLog store plumbing (constants.module.js:60, repo-sync.module.js:217, store-registry.module.js:92):** Its only writer was deleted, so the store is now an orphan. It still syncs existing data and three tests pin it (retention, store-registry, write-chokepoint). Retiring it is a data-retirement decision, not dead-code removal.

**Analyst notes:**

Method: a call graph over every top-level function in every module, rooted at code outside any function, at window.X assignments, and at exports referenced as .name or 'name' in script.js, index.html, bootstrap.js, raffle.html or other modules. Every candidate was then confirmed with Grep. The check found nothing unreached in morning-pulse, futures, matchup, quarter-review or metric-trends.

Clean deletions, with no test change: ui-utils 143 + reliability 205 + contest closers 32 + initializeSection 24 + showSubSection 19 net (one-line edit at dashboard.module.js:453) + exported-no-caller 68 + private helpers 54 + script.js wrapper 4 = 549 lines.

Test-pinned deletions: buildStandingsPost 24, plus 19 test lines in contest.test.js; storage duplicate copies 86 (medium risk, and the chokepoint tests suggest storage was meant to be their home). That adds 110 app lines.

Total: about 659 lines of app code. Kept on purpose: the parked sentiment flow (263 lines, Scott's request in the banner at sentiment.module.js:1850-1872) and OLD_SUB_MIGRATION (about 45 lines, AUDIT.md:697-699 calls it deliberate). Together those would be about 308 more if Scott releases them.

No conflicts with MEMORY.md or the linked notes. The four AUDIT 'newly dead' functions and most of AUDIT 3.6 are already deleted. Still present from 3.6: the reliability seven, center-ranking _padEnd/_padStart and period-compare _prevMonthKey.

Analysis script (scratch only): (scratch file, not kept)

## H. Upload, Settings, Attendance, Calls, Sentiment (verdict: partial-overlap)

| Surface | Path | Clicks | Lines | Shows |
|---|---|---|---|---|
| Upload page (metrics paste plus four file uploads) | Upload > Upload Metrics (reveals the paste box) > paste > pick period > Load Data | 3 | 330 | Paste box, upload wizard period dropdown, year-end profile, Load or Test, success column inspector, data health scan, storage bar, undo banner |
| Settings > Sync & Backup | Settings > Sync & Backup | 2 | 330 | Two sync panels: legacy whole-payload 'Cloud Sync' (Send Data, Receive Data, hidden syncNowBtn, Excel and file access) and per-store 'Cloud sync' (Pull, Re-download everything, Push, Test, Health). Also JSON backup, coaching CSV, Restore, and point-in-time restore |
| Settings > Delete Data | Settings > Delete Data | 2 | 110 | Delete one period, delete sentiment, delete associate-year, Backup Metric Data download, clear drift baseline, reset metric data, delete all |
| Settings > Team Members | Settings > Team Members > Show Team Members & Employees | 3 | 40 | Roster checkboxes (who is on my team), inactive associates with Reinstate, CC address, associate address pattern |
| Settings > Scored Phrases | Settings > Scored Phrases | 2 | 110 | Five phrase-bank textareas, Save; an 'Associate Sentiment Snapshots' panel that JS never fills |
| My Team > Attendance | My Team > Attendance > pick associate | 3 | 700 | Reliability tracker (review queue, per-employee breakdown, PTOST ledger, WFM update list) above the payroll PTO tracker (balance, carryover and allotment, entries, Clear All) |
| My Team > Calls | My Team > Calls > paste | 2 | 200 | Main path: paste, flags, good and bad, Copilot summary, paste-back, Copy For Verint, Copilot email. More fold: full read, QA, metric read, language, Outlook send, history, memory |
| Trends > Sentiment | Trends > Sentiment > Generate Summary | 3 | 130 | Generate Summary button; summary text; Copy Summary; Generate CoPilot Email |
| Contest draw (in-app) and /raffle | Contest > draw, or open /raffle | 2 | 110 | The same draw rules on two screens: the panel and the meeting full-screen |
| Follow Up | Follow Up | 1 | 60 | Follow-up email panel, survey feedback, history |

### H1. Trends > Sentiment tab cannot run; its summary belongs at the sentiment upload, the only place the full reports exist

Risk medium, confidence high, about 95 lines. Clicks: Upload > Upload Sentiment > fill > Save, then Trends > Sentiment > Generate Summary (fails): 7 to Upload > Upload Sentiment > fill > Save > Copy Summary: 5.

- **Same:** There are two sentiment consumers. Metric Charts already reads the saved snapshots (trendSentimentSelect) into the trend email. The Sentiment tab is meant to build its own summary from in-memory reports, but nothing fills those reports any more and the variable is not declared, so both of its buttons throw a ReferenceError.
- **Must keep:** The summary composer (buildSentimentSummaryText, buildSentimentCopilotPrompt and the three section builders), which tests/sentiment-summary.test.js pins for polarity and speaker. Copy Summary and the Copilot email output. The Metric Charts sentiment dropdown.
- **Proposal:** Run the summary where full parsed reports exist: in handleSentimentUploadSubmit, after the save (sentiment.module.js:1672-1681), build the summary from `results` and show Copy Summary and Copilot Email in the modal instead of auto-closing. Then delete the Trends > Sentiment tab: index.html:798, 807, 1073-1095, script.js:2222-2229, the navigation.module.js:121/128/234 entries, generateSentimentSummary (1170-1204), copySentimentSummary (1801-1813) and generateSentimentCoPilotPrompt (1815-~1873). Trends drops from 8 tabs to 7. The other option is to keep the tab and fix it, but a saved snapshot keeps phrases only (no percentage or call counts), so the composer cannot run from storage without changing what is saved.
- **Memory / scope:** None with memory. No metric scoring is touched: the composer reads sentimentGoal through metric-profiles unchanged. Related to AUDIT 3.4 (dead listeners) but not reported there: AUDIT 3.4 lists the listeners, not the consequence that the summary tab can never run.
- **Tests:** tests/sentiment-summary.test.js (composer only, not the tab; composer is kept)
- **Evidence:**
  - modules/sentiment.module.js:1171 and :1816 destructure `sentimentReports`. A repo-wide grep finds it only at sentiment.module.js:537,1171,1816,1881,1924,2024,2052, so it is never declared
  - It is assigned only at sentiment.module.js:1881/1924 (handleSentimentFileChange) and :2024 (openSentimentPasteModal). Those are bound to the removed form ids listed in AUDIT 3.4
  - The live upload modal saves phrases only, into associateSentimentSnapshots (sentiment.module.js:1649-1659, comment at :1652), and never sets sentimentReports
  - Saved snapshots already feed Metric Charts: metric-trends.module.js:403 populateTrendSentimentDropdown, :1143-1157 getSelectedTrendSentimentSnapshot, :2070 SENTIMENT CONTEXT in the prompt
  - The tab's help text still says 'button on the Home page' (index.html:1081)
  - Its markup is moved into Trends on first use: script.js:2222-2229

### H2. 'Upload Metrics' button only reveals the paste box: one extra click on the most frequent action

Risk low, confidence high, about 8 lines. Clicks: Upload > Upload Metrics > paste: 2 clicks before pasting to Upload > paste: 1 click.

- **Same:** The Upload page opens with the paste container hidden by CSS. The only thing the first button does is show it.
- **Must keep:** The other four upload buttons (sentiment, Verint, payroll, PTO PDF), the wizard and the Load and Test buttons
- **Proposal:** Show the paste container by default (drop the display:none for #pasteDataContainer or the class) and remove the Upload Metrics button: index.html:54, script.js:1690-1695, and the .btn-upload-metrics selectors at styles-v2.css:1507/1526/1532
- **Evidence:**
  - styles-v2.css:1541-1542 `.upload-container { display: none; }`
  - index.html:65 pasteDataContainer has class upload-container
  - script.js:1690-1695 is the only handler, and it sets display block
  - Grep finds nothing else that shows or hides pasteDataContainer, and no test references showUploadMetricsBtn or upload-container

### H3. 'Backup Metric Data' download is a strict subset of 'Backup Data (JSON)'

Risk low, confidence high, about 37 lines. Clicks: Two backup buttons on two Settings tabs to One.

- **Same:** Both write a JSON download. The Delete Data one holds weeklyData and ytdData only. The Sync & Backup one holds those same two top-level keys plus every store.
- **Must keep:** The exportDataBtn button and its wiring (tests/no-auto-download.test.js:82-83). Restore compatibility: the full file keeps top-level weeklyData and ytdData.
- **Proposal:** Delete the Backup Metric Data card and handler: index.html:1313-1317, script.js:2156 and 3915-3945. Repoint the Reset prompt text at script.js:3964 to the cloud copy (see notes) or to 'Backup Data (JSON)'.
- **Memory / scope:** feedback_never_download_to_pc allows download buttons the user clicks, so keeping one is fine
- **Evidence:**
  - script.js:3923-3929: backup = {version, exportedAt, appVersion, weeklyData, ytdData}
  - script.js:752-764: exportToExcel writes weeklyData, ytdData, callListeningLogs, phrase DB, snapshots and allStores
  - index.html:1313-1317 vs index.html:1179
  - script.js:3964: the Reset prompt points to 'Download Backup'

### H4. Settings > Scored Phrases 'Associate Sentiment Snapshots' panel is never rendered

Risk low, confidence high, about 9 lines. Clicks: n/a (misleading text) to n/a.

- **Same:** A static placeholder that always says 'No sentiment snapshots saved yet', even when snapshots exist. The real snapshot list is already in the Metric Charts sentiment dropdown and the Delete Sentiment dropdown.
- **Must keep:** Nothing. It shows no data. The phrase bank editor stays.
- **Proposal:** Remove index.html:1371-1377 and the dead associateSnapshotStatus lookup at sentiment.module.js:470 (and its null-guarded use)
- **Evidence:**
  - index.html:1371-1377 sentimentSnapshotsView
  - A repo-wide grep finds sentimentSnapshotsView only at index.html:1374. No JS writes to it
  - sentiment.module.js:470 also looks up associateSnapshotStatus, which does not exist in index.html
  - The real lists: metric-trends.module.js:403 and script.js:4742 populateDeleteSentimentDropdown

### H5. Verint and payroll upload handlers are the same loop copied twice

Risk low, confidence high, about 22 lines. Clicks: unchanged to unchanged.

- **Same:** Both loop over the files, await a reliability handler, log failures and toast the count with 'View in My Team > Attendance'
- **Must keep:** Payroll's missing-module guard (1740-1744). The distinct logAppError sources 'upload.verint' and 'upload.payroll', and the toast nouns.
- **Proposal:** Write one helper, loadFilesThrough(input, handler, noun, source), and bind both inputs to it. Both buttons stay.
- **Evidence:**
  - script.js:1704-1731 (Verint)
  - script.js:1737-1769 (payroll)

### H6. Hidden syncNowBtn is a third copy of the force push

Risk low, confidence medium, about 15 lines. Clicks: n/a (invisible) to n/a.

- **Same:** The footer Sync Now (script.js:7205-7226), Send Data (repo-sync.module.js:553-600) and the hidden syncNowBtn (repo-sync.module.js:436-449) all call syncRepoData with force:true. The hidden one has no visible way to be clicked.
- **Must keep:** The footer Sync Now and Send Data (with its preview confirm). The rest of initializeRepoSyncControls, which needs the guard at 425 relaxed.
- **Proposal:** Delete index.html:1149-1150 and repo-sync.module.js:436-449, and drop `!syncNowBtn` from the guard at :425
- **Evidence:**
  - index.html:1149-1150 `<button id="syncNowBtn" style="display: none;">` with the comment 'for auto-sync compatibility'
  - Grep finds syncNowBtn only at repo-sync.module.js:418 (lookup) and :436-449 (listener). Nothing calls .click() on it. No tests
  - repo-sync.module.js:425 returns early when the button is missing, so the guard has to change with it

**Looked alike, kept:**

- **Five upload buttons on Upload vs uploads from Attendance or Sentiment:** No duplicate entry points exist. type=file inputs live only on Upload (index.html:59-61, 195-207), Settings restore (1182) and Settings 'Upload Files to Repo' (1165, raw source files to R2, a different job). Attendance and PTO point back to Upload (reliability.module.js:1617, index.html:1388). Each of the five buttons takes a different file type into a different store.
- **Settings > Team Members vs My Team 'Who' scope bar:** Different decisions. Settings sets who is on the team (roster). The Who bar picks one member out of that roster for the current view (team-hub.module.js:56-103). Its empty state points to Settings (:70). Keep both.
- **Attendance: reliability picker vs PTO picker:** Already one pick. Both relEmployeeSelect and ptoAssociateSelect are in selectedAssociate PICKER_IDS (selected-associate.module.js:31-42), which sets the value and dispatches change (:82-83). The Who bar also sets selectedAssociate (team-hub.module.js:119). tests/selected-associate.test.js:29-97 pins it. The PTO picker label carries entry counts (pto.module.js:402-414), which is its own information.
- **PTO tracker vs reliability tracker on Attendance:** Different data and decisions. PTO is the balance, carryover, allotment and editable payroll entries (pto.module.js:422-475). Reliability is Verint-vs-payroll reconciliation, the PTOST 40h buffer and WFM recode actions (reliability.module.js:1007-1121, 1671-1790).
- **PTO 'Clear All Entries' vs Settings > Delete Data:** Different scope. It clears only the ptoTracker store from where you look at it (index.html:1392, pto.module.js:880-888). Delete Data has no PTO-only control.
- **Legacy 'Cloud Sync' (Send or Receive) vs 'Cloud sync' (Pull, Push, Re-download):** Two different backends: a whole-payload overwrite through repo-sync (state/latest.json, which Claude's R2 access reads) and per-store manifest sync, which ensureCloudCopyIsCurrent uses (script.js:2401-2422). Merging them means retiring one mechanism, which is an architecture decision and not a UI trim. At most, rename the two near-identical headings (index.html:1121 and 1190) so they are told apart. Retiring legacy needs Scott's call.
- **Delete Period / Delete Year / Reset Metric / Delete All:** Four scopes (one period, one associate-year, all metrics with coaching kept, everything). Each answers a different 'how much'. Not duplicates.
- **Calls: 'Summarize the call in Copilot' (More) vs 'Copilot: Write The Summary' (main):** Different prompts. summarizeCallInCopilot (script.js:8843-8869) is an anonymous transcript summary, deliberately without the associate. writeCallSummaryInCopilot (9143-9163) is the coaching summary from notes, and it saves the call. The page is protected by feedback_calls_page_minimal and tests/call-listening-layout.test.js:78-150.
- **Calls: 'Write The Email Here' vs 'Copilot: Write The Email':** App-written vs Copilot-written. The first is kept under More by design (call-listening-layout.test.js:109-150, call-feedback-email.test.js:231-296).
- **Contest panel draw vs /raffle:** Kept equal on purpose: /raffle is the meeting screen and writes nothing (memory project_contest_raffle_draw). tests/raffle-page.test.js:295-309 enforces the same strike-off behavior in contest-ui.
- **Follow Up panels' own copy and clear functions:** red-flag.module.js:561/573 (follow-up email) and :906/:916 (survey feedback) are each tied to their own panel's fields. Folding the copy halves into the shared helper is AUDIT 2.6 or 2.4 work already tracked, so it is not re-reported. The third panel was not re-verified here.

**Analyst notes:**

Memory conflict (not a trim, but it is in this cluster): feedback_never_download_to_pc says call ensureCloudCopyIsCurrent() before any destructive step. Only two callers do (script.js:2445 reclaim, 3113 snapshot restore). Reset Metric Data (script.js:3947-3986), Delete All (3988-), Delete Period and Delete Year do not. The Reset prompt tells Scott to 'Back up first via Download Backup' (3964), which his work PC cannot do. Adding the cloud guard also removes that manual backup step.

Stale copy found on the way: the upload success subtitle points to "📈 Metric Trends" (index.html:122), and the Sentiment tab says "Home page" (index.html:1081).

Settings > Sync & Backup has two panels whose headings are nearly the same ("🔄 Cloud Sync" at index.html:1121, "☁️ Cloud sync" at 1190) but which run different backends. Renaming them is cheap. Consolidating them needs a decision.

Totals across the six proposals: about 186 lines removable net, 2 clicks saved on the sentiment path, 1 click per metrics upload, and Trends goes from 8 tabs to 7.

All metric targets, bands and scorers are untouched. Nothing was edited.
