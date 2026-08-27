# AUDIT — Development Coaching Tool

**Pinned to commit `4123ce11`** (`chore: bump app version to 2026.08.24.1`).
Read-only pass. No application code was changed to produce this document.

## How to read this

Every claim below is cited as `file:line`. Claims are marked:

- **[V]** — I verified this myself, by reading the code and, where the claim is
  behavioural, by executing it. Numbers quoted under [V] are copied from source.
- **[S]** — Surfaced by a search sweep and cited, but not independently re-executed.
  Treat the line number as reliable and the *interpretation* as needing a second look
  before anything is changed on the strength of it.

Where I believe something is a bug, it is reported and **not fixed**, per the ground rules.
Where two copies disagree, the disagreement is written up and the decision is left to you —
see [§6 Open questions](#6-open-questions--i-need-your-answers-before-phase-3).

## ⚠ A caveat about line numbers

This audit is pinned to committed `HEAD`. At the time of writing, the working tree carried
**uncommitted changes from a concurrent session** in these files:

```
 M index.html                        M script.js
 M modules/morning-pulse.module.js   M modules/pto.module.js
 M modules/reliability.module.js     M modules/repo-sync.module.js
 M modules/sentiment.module.js       M modules/team-snapshot.module.js
 M modules/upload-wizard.module.js   M tests/upload-gaps.test.js
?? modules/action-registry.module.js
?? modules/asset-loader.module.js
?? modules/logger.module.js
```

Line numbers cited in those ten files are correct **as of `4123ce11`** and may have shifted.
Line numbers in every other file are also true of the current working tree. The three new
untracked modules are **not** covered by this audit and are **not** in the loader at
`index.html:1728-1809` — they are that session's work in progress, not orphans.

---

# 1. Feature inventory

Seven top-level sections, wired at `index.html:26-32`, switched by
`modules/navigation.module.js:10-18` (`SECTION_TO_TOP_NAV_BTN`).

| Nav | Section id | Subsections | Primary implementation |
|---|---|---|---|
| 📋 Dashboard | `dashboardSection` (`index.html:41`) | — | `modules/dashboard.module.js` (456 ln) |
| 📤 Upload | `uploadSection` (`index.html:48`) | — | `modules/upload-wizard.module.js` (1171 ln) + `script.js` save path |
| ☀️ My Team | `coachingEmailSection` (`index.html:219`) | 14, listed at `navigation.module.js:90` | see below |
| 📈 Trends | `trendsAnalysisSection` (`index.html:770`) | 8, at `navigation.module.js:117` | see below |
| 📋 Review Prep | `reviewPrepSection` (`index.html:795`) | 5, at `navigation.module.js:139` | see below |
| 📌 Follow Up | `redFlagSection` (`index.html:1513`) | — | `modules/red-flag.module.js` (926 ln) |
| ⚙️ Settings | `manageDataSection` (`index.html:1092`) | 4, at `navigation.module.js:158` | `modules/tips.module.js`, `modules/repo-sync.module.js`, `script.js` |

### My Team — `MY_TEAM_SUB_SECTIONS`, `navigation.module.js:90`

| Subsection | Implementation |
|---|---|
| `subSectionMyTeamDay` | `modules/my-team.module.js` (812 ln) |
| `subSectionHighlights` | `modules/highlights.module.js` (242) + `modules/team-hub.module.js` (388) |
| `subSectionMorningPulse` | `modules/morning-pulse.module.js` (4200) |
| `subSectionMondayPost` | `modules/monday-morning-post.module.js` (559) |
| `subSectionCoachingEmail` | `modules/coaching-email.module.js` (747) + `modules/coaching.module.js` (139) |
| `subSectionTeamSnapshot` | `modules/team-snapshot.module.js` (1261) |
| `subSectionCallListening` | `modules/call-listening.module.js` (179), `call-transcript` (919), `call-qa` (416), `call-trends` (198) |
| `subSectionReliability` | `modules/reliability.module.js` (2586) |
| `subSectionOnOffTracker`, `subSectionYearEnd`, `subSectionQ1Review`, `subSectionMidYear`, `subSectionCenterRanking`, `subSectionFutures` | shared with Review Prep / Trends — same DOM node, reached from two navs |

**Note:** `MY_TEAM_SUB_SECTIONS` lists 14 ids but `MY_TEAM_NAV_BUTTONS`
(`navigation.module.js:91`) lists only 7. The other seven are reachable only from
Review Prep or Trends. That is by design (one DOM node, two entry points), but it means
"which tab am I on" is not answerable from the subsection id alone.

### Trends — `TRENDS_SUB_SECTIONS`, `navigation.module.js:117`

`subSectionTaTrendIntelligence` (`trend-intelligence.module.js`, 612) ·
`subSectionTaMetricTrends` (`metric-trends.module.js`, 4200) ·
`subSectionTaCenterRanking` (`center-ranking.module.js`, 2908) ·
`subSectionTaFutures` (`futures.module.js`, 1226) ·
`subSectionTaSentiment` (`sentiment.module.js`, 1516 + ~1300 ln still in `script.js`) ·
`subSectionTaMatchup` (`matchup.module.js`, 852) ·
`subSectionTaYoY` (`yoy-comparison.module.js`, 748) ·
`subSectionTaPatterns` (`pattern-memory.module.js`, 365)

### Review Prep — `REVIEW_SUB_SECTIONS`, `navigation.module.js:139`

`subSectionMeetings` (`one-on-one.module.js` 289 + `one-on-one-ui.module.js` 300) ·
`subSectionOnOffTracker` · `subSectionQ1Review` (`q1-review.module.js`, 804) ·
`subSectionMidYear` · `subSectionYearEnd` (`year-end-comments.module.js` 752 + `year-end.module.js` 109)

**Mid-Year has no module of its own.** It lives inside `modules/on-off-tracker.module.js`
(61 mentions; prompt builder at `:844-962`). **[V]**

### Supporting sections not on the nav

`verintSummarySection` (`index.html:306`), `coachingOutlookSection` (`:312`),
`callListeningOutlookSection` (`:715`), `tipsManagementSection` (`:819`),
`metricTrendsSection` (`:847`), `metricsPreviewSection` (`:1014`), `debugSection` (`:1037`),
`sentimentSection` (`:1067`), `ptoSection` (`:1319`), `executiveSummarySection` (`:1346`),
`followUpEmailPreviewSection` (`:1559`), `surveyExtractedSection` (`:1580`),
`surveyPromptSection` (`:1585`).

---

# 2. Logic implemented more than once

## 2.1 Metric targets and thresholds — two systems, eight files using both

There are two target systems, and they are not layered the way the comments claim.

**Year-aware** — `modules/metric-profiles.module.js`:
`TARGETS_BY_YEAR` (`:4-37`), `RATING_BANDS_BY_YEAR` (`:45-100`),
`getYearTarget` (`:102-106`), `meetsYearTarget` (`:132-137`), `getRatingScore` (`:139-160`).
Both comparison functions call `roundToDisplayPrecision` (`:120-128`) **before** comparing:
`sec` and `#` to whole numbers, `hrs` to 2 decimals, everything else to 1 decimal. The comment
at `:108-119` explains why — so a cell can always be read as written. **[V]**

**Year-less** — `modules/metrics-registry.module.js:12-197`: a `target` on each entry,
documented at `:9-11` as "a year-less convenience fallback (currently 2026 values)". **[V]**

### The drift has already happened once, and the source records it

`modules/metrics-registry.module.js:186-189`:

    // 2026 value, matching metric-profiles. This was left at the 2025
    // figure of 16, so any path taking the fallback instead of the
    // year-aware target judged reliability two points too harshly.
    target: { type: 'max', value: 18 },

That is precisely this failure mode, already shipped once and since patched. **[V]**

### Side by side: the two years and the fallback

| metric | 2025 (`metric-profiles:6-17`) | 2026 (`:20-35`) | registry fallback | reference CSV |
|---|---|---|---|---|
| scheduleAdherence | min 93 | min 93 | min 93 (`:17`) | min 93 |
| cxRepOverall | **min 80** | **min 82** | min 82 (`:29`) | min 82 |
| fcr | **min 70** | **min 73** | min 73 (`:41`) | min 73 |
| overallExperience | **absent** | min 75 | min 75 (`:53`) | min 75 |
| transfers | max 6 | max 6 | max 6 (`:65`) | max 6 |
| overallSentiment | min 88 | min 88 | min 88 (`:101`) | min 88 |
| positiveWord | min 86 | min 86 | min 86 (`:113`) | min 86 |
| negativeWord | min 83 | min 83 | min 83 (`:125`) | min 83 |
| managingEmotions | min 95 | min 95 | min 95 (`:137`) | min 95 |
| aht | **max 440** | **max 426** | max 426 (`:150`) | max 426 |
| acw | max 60 | max 60 | max 60 (`:162`) | max 60 |
| holdTime | max 30 | max 30 | max 30 (`:174`) | **absent** |
| reliability | **max 16** | **max 18** | max 18 (`:189`) | max 18 |
| transfersCount | **absent** | **absent** | **max 20** (`:89`) | absent |
| totalCalls | absent | absent | `null` (`:77`) | absent |
| overallExperienceTop3 | absent | absent | **absent from registry** | **min 84** |

Every value read directly from source. **[V]**

Rating bands (`metric-profiles:45-100`) cover **five** metrics only: scheduleAdherence,
cxRepOverall, overallSentiment, reliability, aht. Three differ between the years —
cxRepOverall `>=82/>=79.5` becomes `>=84/>=81.5`; reliability `<=16/<=22` becomes
`<=18/<=24`; aht `<=428/<=448` becomes `<=414/<=434`. **[V]**

### Which surfaces are year-blind

Roughly 40 references to the year-aware path across 11 files, against roughly 100 `.target`
reads across 23 files. **Eight files use both**, so one file can judge the same metric two
ways. **[V]**

Consequence: load 2025 data and Metric Trends, Morning Pulse, Dashboard coaching priorities,
Monday Post, Team Snapshot and the coaching-email metric evaluation all judge it against
**2026** goals — AHT 426 not 440, reliability 18 not 16, rep sat 82 not 80, FCR 73 not 70.
Year-End, On/Off Tracker, Mid-Year, per-period Rankings, Celebrations and the Dashboard KPI
scorecard read 2025 correctly. **[S]**

The single clearest instance: `modules/metric-trends.module.js:981` `analyzeTrendMetrics`
**accepts a `reviewYear` argument and never references it**. Its targets come from
`getMetricTrendTarget` (`:3232-3238`), which takes no year at all. **[S]**

## 2.2 On/Off Track KPI scoring — four notions, one file holding two

`script.js:8164-8290` is **pure delegation** into `DevCoachModules.onOffTracker`; every
function there is a three-line forwarder. So Year-End, Mid-Year and the On/Off Tracker tab
already share one scorer. The divergence is elsewhere. **[V]**

### The intended model (confirmed by Scott, 2026-08-25)

Two systems coexist **by design**, and an earlier draft of this audit wrongly treated their
difference as a defect. Stated properly:

- **The goals.** Five company-and-individual numbers — 93% adherence, 426 AHT, 18 reliability,
  88 sentiment, 82 rep satisfaction. These live in `TARGETS_BY_YEAR`
  (`metric-profiles.module.js:4-37`). "Did they hit their goal?" is answered here.
- **The bands.** Goal and stretch, producing a 1/2/3 score per metric, whose mean gives the
  year-end rating: Off Track, On Track/Successful, On Track/Exceptional. These live in
  `RATING_BANDS_BY_YEAR` (`:45-100`) and cover exactly those same five metrics.

`metric-profiles.module.js:29-31` already states this for AHT: *"426 is the goal. 414 is the
stretch, and lives in the rating band below as the mark that earns a 3 — it is not the bar
everyone is judged against day to day."*

**How the two line up.** Computed by calling `getRatingScore` on each goal value:

| metric | goal | stretch (3) | floor (2) | hitting the goal exactly scores |
|---|---|---|---|---|
| scheduleAdherence | 93 | 94.5 | 92.5 | **2** |
| cxRepOverall | 82 | 84 | 81.5 | **2** |
| overallSentiment | 88 | 90 | 87.5 | **2** |
| aht | 426 | 414 | 434 | **2** |
| reliability | 18 | 18 | 24 | **3** |

(2025 has the same shape: goals 93 / 80 / 88 / 440 / 16.) **[V]**

Two consequences follow, and they drive Q7a and Q7b:

1. **Score 2 does not mean "met the goal."** For four of five metrics the goal sits above the
   score-2 floor, so score 2 means "not off track". Any label equating the two is wrong.
2. **Reliability is the exception** — its goal *is* its stretch, so meeting it scores 3.

So consolidation here is **not** about picking one definition. It is about making each of the
two definitions internally consistent and labelling them so a reader can tell which question
is being answered.


| Where | Rule | Labels emitted |
|---|---|---|
| `on-off-tracker.module.js:115-123` | mean of 5: `<=1.79` / `<=2.79` / else | `Off Track` / **`On Track/Successful`** / **`On Track/Exceptional`** |
| `center-ranking.module.js:497-503` | mean over *measured*: `>=2.8` / `>=1.8` / else | **`Exceptional`** / **`Successful`** / `Off Track` |
| `dashboard.module.js:96-100` | **counts**, no mean: `score>=2` on-track, `===3` exceptional | `N of 5 on-track` |
| `metric-trends.module.js:955-975` | four classes, not three | `Needs Focus` / `Watch Area` / `On Track` / `Exceeding Expectation` |

All four read from source. **[V]**

### A. The denominator

`on-off-tracker.module.js:136-137` requires **all five** scores non-null, else it refuses a
verdict and returns `Insufficient KPI data to calculate On/Off Track` (`:144`).
`center-ranking.module.js:476` needs only **one** measured KPI and divides by `measuredCount`
(`:491`). So Rankings can print "Exceptional" for someone Year-End declines to score, and can
produce averages (`11/4 = 2.75`, `8/3 = 2.667`) the five-of-five path can never generate. **[V]**

### B. Boundary style, and a legend stating the other rule

`on-off-tracker` uses `<=1.79` / `<=2.79`; `center-ranking` uses `>=1.8` / `>=2.8`.
On the five-of-five path the mean is a multiple of 0.2, so the two agree — I could construct
no reachable value inside the `(1.79, 1.8)` gap. It **becomes reachable** through
`center-ranking`'s variable denominator.

Independently, `on-off-tracker` disagrees with **itself**: `:458` publishes
`On Track/Exceptional >= 2.80` and `:328` publishes `Goal: 2.80+`, while `:119` is `<= 2.79`.
The legend states center-ranking's rule, not its own. **[V]**

### C. "Met" means two different things, both on screen at once

| Counter | Basis |
|---|---|
| Mid-Year `metCount` — `on-off-tracker.module.js:660-672` | **target**, raw |
| Team Summary `metCount` — `on-off-tracker.module.js:990-997` | **band** (`score >= 2`) |
| Rankings `kpisMet` — `center-ranking.module.js:480-483` | **band** (`score >= 2`) |
| Rankings `meetsCount` — `center-ranking.module.js:2011-2013` | **target**, rounded |

Worked example, 2026, five values inside the score-2 band but short of target — AHT 430
(target <=426, band <=434), adherence 92.8 (>=93, >=92.5), sentiment 87.9 (>=88, >=87.5),
rep sat 81.8 (>=82, >=81.5), reliability 20 (<=18, <=24):

- Mid-Year prints *"currently meeting 0 of 5 key metrics"* and, because `notMetCount >= 3`
  (`on-off-tracker.module.js:904-909`), escalates to the **`strong`** tone — which injects a
  disciplinary-action paragraph at `:924`.
- The Team Summary puts the same person in the **"All 5 metrics"** bucket (`:1068`, `:1075`).
- Rating Average is 2.00, so the verdict reads **"On Track/Successful"**.
- The Rankings year card prints `kpisMet = 5` and `meetsCount = 0` **side by side**.

Same person, same day, four numbers — and under the model above **three of them are correct**.
"0 of 5 goals" is right, "score 2 on all five" is right, and "On Track/Successful" is right.
The wrong one is the **label**: `:1068` calls the band-based count "Metrics Meeting Goal",
when score 2 is the floor and the goal sits above it (see Q7a). Call sites verified; the
arithmetic is mine and is worth re-deriving against real data before anyone acts on it. **[S]**

### D. Morning Pulse uses two definitions in one file

`modules/morning-pulse.module.js:1143` counts `m.classification === 'On Track'`; `:1608`
counts `m.meetsTarget`. Both then test `>= allMetrics.length * 0.7`. Because
`classifyTrendMetric` (`metric-trends.module.js:963-966`) can label a metric that **does**
meet target as `Watch Area`, the two counts can differ for the same person on the same data.
`:1148` partly compensates by adding `exceeding`, but `Watch Area` is excluded from both
terms. **[V]**

### E. Rounded versus raw

`on-off-tracker`, `dashboard` and Rankings `meetsCount` round to display precision before
comparing. `futures` (both scorers), `q1-review`, Mid-Year `metCount` and `script.js:8115` do
not. Adherence `92.46` scores **2** in Year-End and **1** in the Futures check-in. **[S]**

`on-off-tracker.module.js:84-100` compounds this. When a year has no rating profile it falls
back to **hardcoded 2026 band values** — aht 414/434, adherence 94.5/92.5, sentiment 90/87.5,
cxRepOverall 84/81.5, reliability 18/24 — and compares them **raw**, while the legend beneath
prints *"No rating bands configured for selected year."* (`:417`). For a 2024 or 2027 review
the table shows real 3/2/1 digits and a track verdict while the legend says the year is
unconfigured, and the Stretch Goal and Gap-to-Next columns come back blank. **[V]**

## 2.3 The "Select Associate" dropdown — a shared module that shares the wrong half

`modules/selected-associate.module.js` exists and works, but it only **synchronises a
selection**. It contains no population code at all (`PICKER_IDS` registry at `:31-44`,
`attach` at `:126-149`, `applyTo` at `:76-88`). It was added on top of the duplication rather
than in place of it. **[S]**

So 12 registered pickers still have **11 independently written population functions**, and
four more pickers are not registered at all: `deleteEmployeeYearSelect` (`script.js:4366`),
`followUpPersonName` (`red-flag.module.js:294`), `oneOnOneWho` (`one-on-one-ui.module.js:158`),
and the dead `employeeSelect` (see §3.2).

### Eight different definitions of "the roster"

| Roster source | Used by |
|---|---|
| Latest period only | Coaching (`coaching-email.module.js:617`) |
| All weekly + all YTD | Year-End, On/Off, Mid-Year, Delete Year (`script.js:8002-8021`) |
| All weekly + all YTD + call logs | Call Listening (`script.js:7445-7449`) |
| Weekly only | 1:1 Prep x2, Sentiment, Follow-Up, `trendEmployeeSelector` |
| Weekly + YTD + PTO store | PTO (`pto.module.js:144-166`) |
| Single selected period | `trendEmployeeSelect` (`metric-trends.module.js:353`) |
| `teamScope.getMyTeamRoster()` | `oneOnOneWho` (`one-on-one-ui.module.js:177`) |
| Reliability store | `relEmployeeSelect` (`reliability.module.js:1496`) |

**[S]** for the table; the shape of the problem is confirmed.

### The other axes of disagreement

- **Team filtering** — three techniques (`filterAssociateNamesByTeamSelection` on the list;
  per-employee `isAssociateIncludedByTeamFilter` inside the loop; `getReliabilityNamesByTeamFilter`)
  plus **one picker with no team filter at all**: Follow-Up, `red-flag.module.js:294-324`,
  which also reads storage directly rather than the in-memory global. **[S]**
- **Sort** — default `.sort()` in most; `localeCompare` in PTO (`:165`) and Follow-Up (`:314`);
  review-priority descending in Reliability (`:1500-1503`). Identical for ASCII names, not for
  diacritics or lowercase particles.
- **Dedupe** — `Set`-based in most; **absent** in Coaching (`coaching-email.module.js:619-623`)
  and `trendEmployeeSelect` (`metric-trends.module.js:361-364`).
- **Placeholder text** — six variants: `-- Choose an associate --`, `-- Select an associate --`
  (`sentiment.module.js:1210`), `-- Select Associate --` (`red-flag.module.js:299`),
  `Select Employee...` (`metric-trends.module.js:367`), `Select employee...`
  (`reliability.module.js:1515`), `Pick an associate…` (`one-on-one-ui.module.js:154`).
  `trendEmployeeSelect` shows **two different placeholders depending on which code path ran**
  (`index.html:995` vs `metric-trends.module.js:367`).
- **Persistence** — four models coexist: the shared global; a local
  capture-and-restore around repopulation; nothing at all; and feature-specific side stores
  keyed by name (`devCoachingTool_midYearMeta`, `on-off-tracker.module.js:1250`).
- **Escaping** — `createElement` + `textContent` or `escapeHtml` everywhere **except**
  `modules/metric-trends.module.js:370`, which interpolates the name straight into an
  `<option>` string. **[V]** — see §3.5.

## 2.4 The Copilot loop — not one loop

Only **two** of the seven places implement all four steps (prompt, paste-back, Outlook, copy).

| Tab | Prompt | Paste-back | Outlook | Copy |
|---|---|---|---|---|
| Coaching | yes | raw pass-through | `mailto:` | yes |
| Call Listening | yes | raw pass-through | `mailto:` | yes |
| Year-End | yes | **parsed** (Box 1/2) | none | yes, x4 |
| Mid-Year | yes | **none** | none | yes |
| Trends | yes, x3 | none | subject-only + image on clipboard | yes |
| Sentiment | yes | none | none | yes |
| Survey Feedback | yes | **parsed on the input side** | none | yes |
| Red Flag | no AI | none | bare `mailto:` | yes |

**[S]** for the matrix.

- **Four prompt idioms** — composed section functions joined by `\n\n`
  (`coaching-email.module.js:412-421`); one template literal (Call Listening, Year-End, Trends);
  `prompt += ...` concatenation across ~70 statements (Mid-Year, `on-off-tracker.module.js:859-950`);
  a single un-sectioned paragraph (Survey, `red-flag.module.js:897`).
- **Three paste-back contracts, no two sharing a parser** — raw non-empty trim; heading-regex
  extraction with silent lossy fallback (`year-end.module.js:53-91`, where finding neither
  header returns the whole response as Box 1 and `''` as Box 2); label-alias scanning on the
  input (`red-flag.module.js:723-852`, where every unmatched field silently becomes `''` and
  the prompt then ships literal `[Supervisor Name]` placeholders).
- **Mid-Year specifies an output format nothing consumes.** `on-off-tracker.module.js:949-950`
  instructs `Progress & Strengths:` / `Areas of Focus:` and explicitly forbids "Box 1"/"Box 2".
  Grepping those two headings returns only the prompt itself. Year-End's parser would reject
  the format by design (`year-end.module.js:60-67` matches `box|section|question`). **[S]**
- **Five email-construction variants**, including a hardcoded CC address at
  `metric-trends.module.js:1393-1408` versus a `localStorage`-sourced CC in
  `shared-utils.module.js:79-90` — and see §3.6, the localStorage one is never populated.
- **Five copy/open-Copilot orderings**, three of which flash "Copied" *before or regardless of*
  the copy result (`coaching-email.module.js:481-488`, `call-listening.module.js:86-93`,
  `year-end-comments.module.js:494-501`), at 1200/1500/1500 ms against the shared helper's
  1800 ms.
- **`COPILOT_URL` was only half-consolidated.** `audit/session-7-findings.md:75` records this
  as fixed; five sites still hardcode it — `metric-trends.module.js:1748` and `:3866`,
  `red-flag.module.js:911`, `sentiment.module.js:1431`, `trend-coaching-email.module.js:352`. **[S]**

## 2.5 Period selection — nine mechanisms, four using the shared picker

Shared machinery already exists in three layers: `modules/period-index.module.js` (date math
and a normalised index), `celebrations.listShoutOutWindows` (`:414-453`, the canonical named
windows), and `modules/period-picker.module.js` (chip rendering, two mount styles). Four of the
nine surfaces use it. **[S]**

| # | Surface | Option set | Uses shared picker? |
|---|---|---|---|
| 1 | Upload wizard (`upload-wizard.module.js:96-215`) | Daily, week-in-progress, last week, MTD, last month, last quarter, YTD | no |
| 2 | Center Averages / Metric Charts (`index.html:864-884`) | daily, week, month, ytd | partly (`metric-trends:308-311`) |
| 3 | Trends cadence (`index.html:1420-1425`) | dod, wow, mom, ytd | no |
| 4 | Team Snapshot (`index.html:1657-1673`) | all, daily, week, month, ytd | yes (`team-snapshot:1131`) |
| 5 | Monday Post (`index.html:569-586`) | week, month, quarter | **no** |
| 6 | Rankings (`center-ranking.module.js:297-375`) | 8 grouped types | yes |
| 7 | Matchup (`matchup.module.js:471-542`) | 7 grouped types | yes |
| 8 | My Team day page (`my-team.module.js:671-701`) | the 5 named windows | yes |
| 9 | Morning Pulse (`morning-pulse.module.js:781-801`) | week, month, quarter | no |

### What actually differs

- **Week start is consistent** — Monday everywhere. But there are **six private copies** of
  `mondayOf` (`period-index:61`, `upload-wizard:85` and `:102` and `:928`, `cheerleading:188`,
  `morning-pulse:758` and `:1518`) against the one shared implementation.
  `daily-outreach.module.js:106-110` is the only caller that delegates, with a comment noting
  it "was one of three copies". It is now one of six. **[S]**
- **Four timezone techniques for one problem** — noon-anchoring (`period-index:64-66`),
  split-and-construct (`upload-wizard:77-82`), midnight-anchoring
  (`period-compare:111`), and **raw `Date.parse(iso)`, which is UTC and drifts a day west of
  GMT** at `script.js:4892` and `:4901`. That last one feeds `getWeeklyKeysSorted` and the
  year bucketing at `script.js:5060-5062`. **[S]**
- **Quarter availability is inconsistent** — offered on Upload and Monday Post, listed but
  unselectable on Rankings/Matchup, entirely absent from Center Averages, Team Snapshot, the
  Trends cadence, My Team and the celebrations window set.
- **Six label schemes for the same week.** A week ending 2026-08-16 renders as
  `Weekly ending 2026-08-16` (`center-ranking:289`), `Week ending 2026-08-16`
  (`team-snapshot:150`), `Week ending 08/16/2026` (`monday-morning-post:157`), `Weekly`
  (`metric-trends:1413`), or `This week` / `Last week` (`celebrations:329-330`). A **daily**
  upload is labelled `Week ending ...` by `monday-morning-post.module.js:156-161`. **[S]**
- **Four option orderings** — newest-window-first (`celebrations:327`), largest-first
  (`center-ranking:300`), a variant largest-first missing `month-to-date` (`matchup:474`), and
  smallest-first (`index.html:868`).
- **Two option-value encodings** — single pipe `key|source` (`team-snapshot:973`) versus
  double pipe `key||source` (`matchup:514`).

### "Daily" is offered on two surfaces that cannot read daily data — verified

`getPeriodDataStore` (`script.js:4922-4927`) routes `'daily'` to the `dailyData` store, and
`script.js:2901` uses it as the write target. Daily uploads therefore live **only** in
`dailyData`. But:

- `modules/metric-trends.module.js:276`, `:401`, `:506` all read
  `selectedPeriodType === 'ytd' ? ytdData : weeklyData` — the file contains **zero**
  references to `dailyData`. It then filters `periodType === selectedPeriodType`
  (`:284-289`). Selecting "Daily" (`index.html:868`) filters `weeklyData` for a period type
  the write path never puts there, so it always falls to
  `No daily data available` (`:292`, `:522`).
- `modules/team-snapshot.module.js:110-143` `getAvailablePeriods` reads only weekly + YTD;
  the file has **zero** `dailyData` references. Its "Daily" pill (`index.html:1662`) is
  likewise always empty.

Both **[V]**. Reported, not fixed.

## 2.6 Copy to clipboard — a good shared helper, and six bypasses

`modules/ui-utils.module.js:31-74` is the canonical helper: empty-refusal, `writeText` then a
hidden-textarea `execCommand` fallback, toast plus `flashButton` on both outcomes, never
rejects. It is covered by `tests/clipboard.test.js:42-93` and has ~55 call sites. **[S]**

Six implementations bypass it: `copilot-prompt.module.js:76-81` (no fallback chain at all),
`email.module.js:53-70`, `metric-trends.module.js:2896-2930` (the only `text/html` writer),
`team-snapshot.module.js:908-947` (no fallback, uses `alert()` not toasts),
`center-ranking.module.js:2233-2259` (the best-engineered — preserves user activation by
passing the blob promise), and `year-end-comments.module.js:561-602` (clipboard *read*, for
which no shared helper exists). **[S]**

Two of them **degrade silently** — `metric-trends.module.js:2919` and `email.module.js:61-64`
fall back to a download or a new tab with no message, so a failed copy is indistinguishable
from a success. That is the exact regression `tests/clipboard.test.js:74-78` was written to
prevent; the image-copy paths simply never adopted the helper. **[S]**

Call-site handling of the return value is also inconsistent: ignored at the majority of sites,
`.then(ok => ...)` at ten, `await` at twelve, and only eight pass `options.button` so that
`flashButton` runs at all.

## 2.7 localStorage — 54 keys, 203 raw calls, ~14 through the storage module

`modules/storage.module.js` exists and enforces a 4 MB per-key cap via `saveWithSizeCheck`
(`:21-39`), but most of the app writes `localStorage` directly. Counts across `script.js`,
`modules/` and `bootstrap.js`: **111 `getItem`, 81 `setItem`, 11 `removeItem`**, against ~14
references to the storage module. `index.html` contains **zero** localStorage calls. **[V]**

The `devCoachingTool_` prefix is defined once at `modules/constants.module.js:9` and
re-derived with a literal fallback in roughly 20 modules.

One structural fact to know before touching any of this:
`modules/repo-sync.module.js:198-231` **monkey-patches `Storage.prototype.setItem`,
`removeItem` and `clear`**. Every raw `localStorage.setItem` in the app therefore implicitly
queues a repo sync when the key is in `SYNCABLE_STORAGE_KEYS` (`:175-192`). That is why so
many modules bypass the storage helpers without obvious breakage, and it means the sync
trigger is invisible at every call site. Any consolidation here must preserve it. **[S]**

### Shape and lifecycle problems

- **`myTeamMembers` is read with the wrong shape.** Documented as `{ weekKey: [names] }`
  (`script.js:97`); `storage.module.js:406-415` returns `{}`; `script.js:771` writes
  `myTeamMembers[weekKey] = memberNames`. But `script.js:1340` reads it as
  `JSON.parse(... || '[]')` and gates on `Array.isArray(members)`. With the real object value
  that guard is **always false**, so `purgeNonRosteredEmployees` silently never cleans
  `myTeamMembers` — and if it ever did fire, `:1343` would overwrite the object store with a
  flat array. Currently a guarded no-op rather than a crash. **[V]**
- **Two functions with the same name writing different keys.** `storage.module.js:470-489`
  defines `loadUserTips`/`saveUserTips` against `devCoachingTool_coachingTips`.
  `tips.module.js:574-590` defines its own pair against `devCoachingTool_userCustomTips`, and
  every internal caller resolves to the tips-module version. The storage-module pair has zero
  callers, so `coachingTips` is never written and never read. **[S]**
- **Written but never read** — `devCoachingTool_lastError` (`error-monitor:187`),
  `devCoachingTool_supervisorSeeded_v4_migration` (`script.js:1429`), plus
  `hotTipHistory` and `attendanceTracker` residue (see 3.4). **[S]**
- **Read but never written** — `devCoachingTool_ccEmail` is read at
  `shared-utils.module.js:68` and written nowhere, so `getCoachingCcEmail()` always returns
  the empty string and `openMailtoDraft` never sets a CC. Every coaching and call-listening
  email is therefore built with no CC, silently. **[S]**
- **Four unguarded `JSON.parse` calls on stored values** — `script.js:6411`,
  `tips.module.js:925`, `:944`, and `:1113` (the last sits just outside the `try` opening at
  `:1117`). A corrupted value throws rather than degrading. **[S]**
- **Two storage budgets** — `script.js:2462` measures against **5 MB** total while
  `constants.module.js:12` caps each key at **4 MB**. **[S]**

## 2.8 Metric labels — one registry, at least nine competing label maps

`METRICS_REGISTRY[key].label` is the nominal source. Shadowing it: `metric-trends:762-776`,
`celebrations:34-46`, `cheerleading:56-64`, `upload-drift:33-45`, `script.js:2600-2616`,
`script.js:6013-6022`, `dashboard:70-76`, `center-ranking:1171-1177`, `matchup:207-212`,
`on-off-tracker:468-474` and `:978`, `email:124-128`, plus the reference CSV. **[S]**

Two metrics are spelled the most ways:

- **`negativeWord`** — `Avoid Negative Words` (registry), `Avoiding Negative Words`,
  `Negative Word Usage`, `-Word`, `Avoid negative words`, and `Avoiding Negative Words` again
  in the CSV. Hardcoded once more at `script.js:1596`.
- **`cxRepOverall`** — `Rep Satisfaction`, `RepSat`, `CX Adv`, `Assoc Overall`,
  `Associate Overall (Surveys)`, `CX Rep Overall`.

## 2.9 "Is lower better?" — 34 askers, three answering independently

The canonical answer is `isReverseMetric` (`metrics-registry.module.js:247-249`, exported at
`:274`) reading the registry `isReverse` flag. Around 34 sites derive it; most call the global
or read the registry field, which is fine. Three derive it another way:

1. **`coaching-analysis.module.js:258`** — hardcoded
   `['transfers','aht','holdTime','acw','reliability']`, omitting `transfersCount`.
   Moot in practice: the whole module is dead (3.1). **[V]**
2. **`cheerleading.module.js:101-104`** — derives from
   `TARGETS_BY_YEAR[currentYear][key].type === 'max'`, returning false when the metric is
   absent from the year profile. So `transfersCount` (which is `isReverse: true` but absent
   from both year profiles), `totalCalls`, `overallExperienceTop3`, and on a 2025 profile
   `overallExperience`, would all read as "higher is better". Whether that currently bites
   depends on which keys reach `_isImprovement` (`:374`, `:385`), which I did **not** trace to
   a conclusion. Divergence confirmed, reachability open. **[V] / open**
3. **`rank-projection.module.js:114-122`** — routes through `RANK_TO_REGISTRY` (`:47-58`),
   which has **no `reliability` entry**, so `isReverseRank('reliability')` returns false —
   while `rankedValueFor` (`:167`) explicitly handles reliability and
   `center-ranking.module.js:401` declares it `reverse: true`. Latent, not live:
   `LADDER_ROWS` (`center-ranking:1261-1268`) deliberately excludes reliability. **[S]**

`tests/metric-direction.test.js` guards registry/target-type agreement and bans
`metric.lowerIsBetter`, but catches none of these three.

## 2.10 `formatMetricDisplay` — one live implementation, one orphan, two shims

Worth correcting a plausible-looking claim: there are four definitions, but not four
implementations.

| Site | What it actually is |
|---|---|
| `metric-trends.module.js:3263` | **the** implementation; exported as `window.formatMetricDisplay` at `:4180` |
| `executive-summary.module.js:66` | delegating shim to the global |
| `monday-morning-post.module.js:106` | delegating shim to the global |
| `metrics.module.js:59` | a genuine **second** implementation, reachable only via `DevCoachModules.metrics` — which nothing reads (3.1) |

All **[V]**. The two real implementations disagree on units: `sec` renders `426s` versus
`426 sec`; `hrs` renders `18.0 hrs` (`toFixed(1)`) versus `18.00 hrs` (`toFixed(2)`).

**The hours case defeats `roundToDisplayPrecision`.** `metric-profiles.module.js:126` judges
`hrs` at **2** decimals; the live printer shows **1**. Reliability `18.04` against an 18
target prints **"18.0 hrs"** and is judged **below** — exactly the unreadable cell the comment
at `metric-profiles.module.js:108-119` says the rounding exists to prevent. It is correct for
`%` and `sec`; it is broken for `hrs`. **[V]**

Two more hours formats exist inline: `on-off-tracker.module.js:1118` (`toFixed(1) + 'h'`) and
`team-snapshot.module.js:604` (`target.value + 'h'`). **[S]**

## 2.11 Coaching tips — three copies of the pool, and a keying mismatch

- `tips.csv` (505 rows) and `EMBEDDED_TIPS_CSV` (`tips.module.js:5-509`) are **byte-identical
  today** — I diffed them: 505 rows each, zero lines differing in either direction. In sync,
  but requiring a dual edit forever. **[V]**
- `DEFAULT_METRIC_TIPS` (`tips.module.js:992-1084`) is a **third** copy, keyed by **display
  label** (`"Schedule Adherence"`) while the CSV is keyed by **metric key**
  (`scheduleAdherence`). **[V]**
- `metrics-registry` carries a fourth, one-tip-per-metric copy in `defaultTip`. **[V]**

The keying mismatch is live. `getMetricTips(metricName)` (`tips.module.js:1111`) does a single
flat lookup. It is called with a **label** from `coaching-email.module.js:219`
(`metricConfig.label`) and with a **key** from `metric-trends.module.js:1087` (`metricKey`).
The stored `metricCoachingTips` is key-shaped, built from the CSV. So Coaching finds tips only
on the un-seeded fallback path, Trends only on the seeded path, and `overallExperience` —
which has tips only in the label-keyed map and none in the CSV — has none, ever. **[V]**
Reported, not fixed.

---

# 3. Dead code

Two facts make this analysis unusually safe to trust:

- **`index.html` contains zero inline event handlers.** `grep -c "onclick" index.html` returns
  `0`, and no other `on*=` attribute exists. Every handler is bound with `addEventListener`,
  so there is no false-positive risk from HTML attributes. **[V]**
- **There is no dynamic function dispatch.** No `eval`, no `new Function`, and the three
  `window[name]`-style lookups that exist are store-name lookups, not function dispatch. **[S]**

Nothing below is proposed for deletion. Each item is listed so you can account for it.

## 3.1 Three entire modules are unreachable — 649 lines

| Module | Lines | Evidence |
|---|---|---|
| `modules/coaching-analysis.module.js` | 326 | grep for `coachingAnalysis` across `script.js`, `modules/`, `index.html`, `tests/` returns **exactly one hit — its own export at `:320`**. It is an IIFE and assigns no other global. |
| `modules/email.module.js` | 166 | grep for `emailFormatter` returns **only its own export at `:155`**. Its two `window.X = window.X \|\| X` guards at `:164-165` always lose, because `metric-trends` loads first (`index.html:1766` vs `:1771`) and assigns `window.createTrendEmailImage` / `window.drawEmailCard` unconditionally at `:4153` / `:4173`. |
| `modules/metrics.module.js` | 157 | assigns only `window.DevCoachModules.metrics` at `:141`; grep for consumers returns **only that assignment**. |

All three **[V]**, each confirmed by grep across the whole repo including `tests/`.

`coaching-analysis` is self-aware about it: `:144-145` and `:237-238` check
`trendModule.X !== X` and delegate to `metric-trends`. It is a no-op wrapper with no entry
point. All three are still loaded on every page load (`index.html:1768`, `:1771`, `:1772`).

**Before deleting any of these, confirm with me** — `metrics.module.js` in particular is the
only other implementation of `formatMetricDisplay` and of the rating-band colours, so removing
it removes a reference point as well as dead weight.

## 3.2 The removed "classic period selector" subsystem

`.period-type-btn` appears **0 times in `index.html` and 0 times in `styles-v2.css`**, but is
still queried at four sites in `script.js` (`:2205`, `:2421`, `:2426`, `:3340`). **[V]**
The whole dependent chain is therefore unreachable:

| Item | Location | Why dead |
|---|---|---|
| period-type binding | `script.js:2205-2207` | empty NodeList; `handlePeriodTypeButtonClick` never fires |
| `handlePeriodTypeButtonClick` | `script.js:3339-3358` | only caller is the dead binding |
| `updatePeriodDropdown` | `script.js:1684-1685` | early-returns, `#specificPeriod` does not exist |
| `updateEmployeeDropdown` | `script.js:1654-1656` | early-returns, `#employeeSelect` does not exist |
| `getEmployeeDataForPeriod` | `script.js:1678-1682` | zero references |
| `getActivePeriodContext` | `script.js:1525-1546` | zero references |
| `populateMetricInputs` | `script.js:1728` | zero references; targets `#totalCalls`, `#surveyTotal`, neither exists |
| `currentPeriodType` / `currentPeriod` | `script.js:90-91` | mutated only from the dead paths, so `getPeriodDataStore(currentPeriodType)` is permanently `'week'` |
| `populateTeamMemberSelector` | `script.js:4511-4515` | called from ten places but returns immediately; `#teamMemberSelector` does not exist |

**[S]** for the chain, **[V]** for the `.period-type-btn` and `#employeeSelect` absences.

Related: `script.js:2213-2215` iterates `METRICS_REGISTRY` keys as element ids. **None of the
15 exists as an id in `index.html`**, so `applyMetricHighlights` is never bound. **[S]**

## 3.3 A user-visible button that can never work

`#employeeSelect` **does not exist anywhere in `index.html`** — verified by grep against both
`HEAD` and the working tree. Four live code paths still target it:
`script.js:352`, `script.js:1655`, `script.js:3399`, and
**`modules/copilot-prompt.module.js:11`**. **[V]**

That last one is not merely dead — it is wired to a visible control. The
**"📝 Copy Verint Summary" button** at `index.html:302` calls `generateVerintSummary`, which
reads `#employeeSelect` at `copilot-prompt.module.js:11`, finds nothing, and always takes the
"please select an employee first" branch. **The button cannot produce a summary.** **[V]**

This is a behaviour change to fix, so it is reported here rather than repaired.

## 3.4 Listeners bound to a removed sentiment upload form

`script.js:2325-2347` binds eight listeners to ids that no longer exist. The sentiment upload
moved to a modal using `sentimentUpload*` ids (`index.html:174-212`):

| Dead binding | Missing id | Replacement |
|---|---|---|
| `script.js:2336` | `sentimentPositiveFile` | `index.html:192` `sentimentUploadPositiveFile` |
| `script.js:2337` | `sentimentNegativeFile` | `index.html:198` `sentimentUploadNegativeFile` |
| `script.js:2338` | `sentimentEmotionsFile` | `index.html:204` `sentimentUploadEmotionsFile` |
| `script.js:2339-2341` | `sentiment{Positive,Negative,Emotions}PasteBtn` | none, the paste path was dropped |
| `script.js:2344` | `saveAssociateSentimentSnapshotBtn` | none |

Also dead: `sentiment.module.js:202`, `:265-266`, `:294-295`. **[S]**
Note `sentiment.module.js` and `script.js` both carry uncommitted changes; re-check before acting.

## 3.5 Residue from deleted features

| Removed in | Residue |
|---|---|
| `0db17a78` (deleted `modules/hot-tip.module.js`) | `hotTipHistory` plumbing at `storage.module.js:541-561`, `repo-sync.module.js:969`, `:1267-1268`, and `cloudflare-sync-worker/index.js:129`, `:285`, `:343`; `hotTipSection` redirect at `navigation.module.js:268` |
| `8b592fed` (deleted `modules/attendance-tracker.module.js`) | `attendanceTracker` key at `repo-sync.module.js:948`, `:950`, `:967`, `:1213` and `cloudflare-sync-worker/index.js:126-127`, `:285`, `:343` |
| untracked UI removals | the `.period-type-btn` bar (3.2) and the pre-modal sentiment form (3.4) |
| `0bf00487`, `55d1224d` | no residue found |

Also `OLD_SUB_MIGRATION` at `navigation.module.js:217-236` maps 19 retired subsection ids to
current ones. That one is **deliberate and live** — it keeps a saved nav state from an older
build working. Listed so it is not mistaken for rot. **[V]**

## 3.6 Never-called functions

A frequency analysis over every identifier in `script.js`, `bootstrap.js`, `modules/*.js` and
`index.html`, cross-checked against `tests/`, found **24 functions whose name appears exactly
once in the entire corpus — their own definition**. Given 3.1's two supporting facts (no
inline handlers, no dynamic dispatch), these are high-confidence. **[S]**

Grouped: `reliability.module.js` — `bindAllEmployeesLedgerFilters:1458`, `bindRowClicks:2492`,
`buildAllEmployeesDayTable:1311`, `summarizeDateList:1275`, `buildPtostDesignationEmail:1063`,
`buildWfmCorrectionEmail:1077`, `buildPcIssueEmail:1091`.
`pto.module.js` — `importPtoBalanceExcel:261`, `importPayrollExcel:549` (both target ids that
do not exist).
`script.js` — `buildConfidenceInsight:5687`, `buildTodaysFocusData:6854`,
`detectComplianceFlags:5654`, `logComplianceFlag:5677`, `getCoachingContext:5623`,
`embedPtoTracker:1962`, plus the four from 3.2, and the two self-labelled "legacy stubs" at
`:2285` and `:2290`.
Others — `q1-review:17 _isReverseMetric`, `center-ranking:1833 _padEnd`, `:1838 _padStart`,
`period-compare:126 _prevMonthKey`.

One consequence worth calling out: **`logComplianceFlag` (`script.js:5677`) is the only writer
of `complianceLog`**, so `renderComplianceAlerts` (`:6408`) always renders "No compliance flags
logged". **[S]**

Dead constants: `reliability.module.js:8 STORAGE_KEY` and
`script.js:2560 UPLOAD_HEADER_FINGERPRINT_KEY` (zero other references anywhere). **[S]**

`reliability.module.js` and `pto.module.js` both carry uncommitted changes — re-verify those
nine before acting.

## 3.7 Latent hazard: recursion in the ui-utils toast shim

`modules/ui-utils.module.js:11-13` defines `showToast` as a delegator to `window.showToast`,
and `:295` sets `window.showToast = window.showToast || showToast`. At ui-utils load time
(`index.html:1745`) `window.showToast` is undefined, so `:295` assigns ui-utils' own function
to it. Any call to `DevCoachModules.uiUtils.showToast` **before `script.js` loads**
(`index.html:1808`) recurses until the stack overflows. In normal operation
`script.js:432`'s declaration overwrites it in time. It only bites if `script.js` fails to
load — precisely when you would want a toast. **[S]**

## 3.8 Clean

No commented-out code blocks of any size. Zero `TODO`, `FIXME`, `HACK`, `XXX` or `DEPRECATED`
markers in any source file. All 21 `legacy` mentions are documented backward-compatibility
paths, except the two stubs at `script.js:2284-2290`. **[S]**

---

# 4. Hardcoded metric names, targets and thresholds

The two canonical stores are `metric-profiles.module.js:4-100` and
`metrics-registry.module.js:12-197`. Everything below carries metric knowledge **outside**
them.

## 4.1 Hardcoded target and band values

| Location | What is hardcoded |
|---|---|
| `on-off-tracker.module.js:84-100` | the **entire 2026 rating band set** as a fallback: aht 414/434, adherence 94.5/92.5, sentiment 90/87.5, cxRepOverall 84/81.5, reliability 18/24 **[V]** |
| `metric-trends.module.js:3229` | `return 90; // Safe fallback` — any metric with no target reports a 90% goal. Reached by `totalCalls` and `overallExperienceTop3` **[S]** |
| `reliability.module.js:1267-1274` | discipline ladder `<=0 Clean`, `<=16 Verbal`, `<=24 Written`, `<=32 Final`, else Termination. The **16 is the 2025 reliability target**; the 2026 target is 18. So `18.0h`, exactly on the 2026 goal and a score 3, renders as **"Written"** in Attendance **[V]** |
| `sentiment.module.js:410-412` | `METRICS_REGISTRY.negativeWord?.target?.value \|\| 83` and siblings — literal fallbacks **[S]** |
| `q1-review.module.js:568` | track colour bands at `>=2.5` / `>=1.5` against labels drawn at 2.79/1.79, so `2.60` renders "On Track/Successful" on a **green** chip and `1.60` renders "Off Track" on an **amber** one **[S]** |
| `center-ranking.module.js:425-430` | KPI-met colour thresholds `>=0.8` / `>=0.6` **[S]** |
| `metric-trends.module.js:879-885`, `:899`, `:934`, `:945` | trend classification bands by unit — near `{2, 20, 1}`, exceed `{4, 35, 2}`, watch-drop `{2, 15, 1}`, direction `{1, 8, 0.5}`, volatility `{2.5, 18, 1.1}` **[S]** |
| `q1-review.module.js:217` | trend threshold `Math.abs(firstAvg) * 0.02` — a **relative 2%** rule unrelated to `METRIC_NOISE`. On AHT (~426) that is ±8.5s; `METRIC_NOISE.aht` is 15 **[S]** |
| `pto.module.js:8` | `var PTO_TRACKING_YEAR = 2026;` **[S]** |
| `reliability.module.js:1160-1163` | `y >= 2026` gate on correction rows **[S]** |
| `yoy-comparison.module.js:13-15` | `BASELINE_YEAR = 2025`, `BASELINE_START/END`, plus ~20 hardcoded `'2025'` strings in copy **[S]** |
| `repo-sync.module.js:718-722` | filename `performance-intelligence-metrics-2026.csv`, sheet `Metrics 2026` **[S]** |
| `script.js:6032` | heading text `🎯 2026 Goals Snapshot` above a year-blind target table **[S]** |

## 4.2 Ranking floors and minimums, each declared independently

`MIN_CALLS_TO_JUDGE = 20` (`metrics-registry:245`) · `MIN_SURVEYS_FOR_RANK = 3`
(`center-ranking:403`) · `FULL_KPI_COUNT = 5` / `MIN_MEASURED_FOR_SCALED = 4`
(`center-ranking:420-421`) · `LADDER_DOOR_RANK = 10` (`center-ranking:1246`) ·
`MIN_FIELD_FOR_CENTER_RANK = 30` (`celebrations:339`) · `MIN_MATCHUP_EMPLOYEES = 30`
(`matchup:145`, declared separately from the identical celebrations value) ·
`MIN_PLACES = 3` / `MIN_SHARE_OF_FIELD = 0.03` (`year-standing:28-29`). **[S]**

## 4.3 The reference CSV is a fourth copy of the numbers

`data/performance-intelligence-metrics-2026.csv` is checked in and shipped into an Excel export
by `repo-sync.module.js:718-722`. It agrees with the 2026 profile except in three places,
each of which is a real disagreement with the code **[V]**:

- **`transfers` has a rating band in the CSV** (`<=4` / `<=6` / `>6`) and **no band in code**.
  `futures.module.js:656-658` and `q1-review.module.js:342-345` therefore fall back to
  `exceedTarget = meetTarget` (6) for transfers, while the document published to management
  says the stretch is 4%.
- **`holdTime` is absent from the CSV entirely.** Code carries `max 30` for both years, so
  every trend surface shows a hold-time target the reference document does not document.
- **`overallExperienceTop3` is in the CSV (`min 84`) and in parsed data**
  (`data-parsing.module.js:441`, `:572`; read at `script.js:3118`, `morning-pulse:89`)
  **but is not in `METRICS_REGISTRY` at all** — so it has no label, no unit, no `isReverse`,
  and its target resolves through the `return 90` fallback above.

And in the other direction, **`transfersCount` has `max 20` in the registry
(`metrics-registry:89`) and appears in neither year profile nor the CSV** — a number that
appears in no goal document. **[V]**

## 4.4 Dead metric metadata

`metrics-registry.module.js` carries a `columnIndex` on all 15 entries (`:20`, `:32`, `:44`,
`:56`, `:68`, `:80`, `:92`, `:104`, `:116`, `:128`, `:140`, `:153`, `:165`, `:177`, `:192`).
**Nothing reads them** — `data-parsing.module.js` builds its column map from header text
(`:441`) and never consults them. Dead, and actively misleading to anyone editing the export
format. **[S]**

---

# 5. Ranked consolidation targets

> **Scope decision (Scott, 2026-08-25): metrics and rating bands are out.**
> Target values, band values and the KPI scoring logic are **not** to be changed. The findings
> about them stay in this document as a record, and they are covered by the Phase 2 baseline
> as a **tripwire** — since we are deliberately not touching them, any diff there is an
> accident, not an intended change. Everything under "Out of scope" below is documentation
> only.

Remaining work, ranked by risk of the copies drifting apart.

### 1. Associate picker population — 2.3  ✅ DONE (pass 1)
Eight roster definitions, three filtering techniques plus one picker with none, two sort
orders, six placeholder strings. The shared module synchronises the selection but owns no
population code, so the duplication sits underneath it untouched.
**If this is wrong:** someone is missing from a picker, or Follow-Up shows associates outside
your team (`red-flag.module.js:294-324` applies no team filter at all). Also folds in the one
unescaped picker, `metric-trends.module.js:370`.

**Outcome.** `modules/associate-picker.module.js` now owns team filtering, sort, dedupe,
escaping, placeholder and empty-state for all fourteen pickers. All eight roster sources kept.
Verified against the original code with identical baseline coverage: **no associate name was
added, removed or reordered anywhere**. Four placeholder strings changed, as agreed. Two
deliberate exceptions are now explicit at their call sites rather than merely absent:
Follow-Up passes `teamFilter: false`, and Reliability passes `sort: false` because its order
is review priority, not the alphabet.

### 2. Tip lookup keying — 2.11  ✅ DONE (pass 2)
Label-keyed and key-keyed copies of the same pool, plus `tips.csv` and `EMBEDDED_TIPS_CSV`
as 505 duplicated rows needing a dual edit forever.
**If this is wrong:** coaching emails ship with no tips and nobody notices, because an empty
tip list renders as an absent section rather than an error. This is a live bug today.
*Flag: this is about tip lookup, not metric values — tell me if you want it out too.*

**Outcome.** `DEFAULT_METRIC_TIPS` re-keyed from display labels to metric keys;
`chooseCoachingTip` now passes `metricConfig.key`; `getMetricTips` resolves a label to a key
so the next caller to get it wrong is merely inefficient rather than silently wrong. Five
`overallExperience` tips moved into the pool, which previously had none. **No storage
migration was needed** — all four tip keys in localStorage were already metric-key shaped;
the fallback map was the only label-shaped thing in the system.

**The two pools are not duplicates.** 60 of the 65 tips in `DEFAULT_METRIC_TIPS` appear
nowhere in the CSV, so it is a second body of content, not stale copy. Merging them is a
content decision and is left open.

**One tip removed.** Fixing the keying made 65 previously-unreachable tips live, and one of
them offered a callback on Hold Time, against a standing rule. It is gone, and
`tests/tips-pool.test.js` now fails if it comes back.

### 3. Copilot loop — 2.4  ◐ PARTLY DONE (pass 3)
Four prompt idioms, three paste-back contracts, five email builders, five copy/open orderings.
**If this is wrong:** a prompt loses a data block, or an email is built with the wrong CC.
The CC is already silently empty everywhere (2.7).

**Outcome so far.** The Copilot address went from twelve copies to two (constants plus one
fallback in `sharedUtils`), guarded by `tests/copilot-url.test.js`. The five copy-then-open
orderings became one `sharedUtils.copyPromptAndOpenCopilot`, which opens the tab inside the
click to keep user activation, copies, and reports what actually happened. Three sites that
flashed "Copied" before the copy resolved now flash after it, with their own wording kept.
A blocked popup is now reported instead of leaving the user with a clipboard and no tab.

**Still open in this area, deliberately:** the four prompt-construction idioms and the three
paste-back contracts. Those are not drift. Year-End parses `Box 1 / Box 2`, Survey Feedback
parses on the input side, and Mid-Year specifies a format nothing consumes; consolidating them
would change what the AI is asked for and what is accepted back, which is a content decision.

**Newly dead, created by this pass, not deleted:** `showCoachingPromptCopiedState` and
`openCopilotForCoachingPrompt` (coaching-email, plus their `script.js` wrappers),
`setYearEndPromptButtonFeedback` and `copyYearEndPromptWithFallbacks` (year-end-comments).
Each existed only to serve the flow this pass replaced. Listed rather than removed, per the
rule that nothing gets deleted without sign-off.

### 4. Copy to clipboard and button flash — 2.6
Six bypasses of a well-tested shared helper, two degrading silently, three button flashes
reporting success before the copy has happened.
**If this is wrong:** a failed copy is indistinguishable from a successful one.

### 5. Period selection — 2.5
Nine mechanisms, six private `mondayOf` copies, four timezone techniques, six label schemes,
four option orderings, two option-value encodings.
**If this is wrong:** every aggregate shifts by a period. Ranked below the above only because
a period error is loud in the baseline where a wording error is quiet.

### 6. localStorage access routing — 2.7
54 keys, 203 raw calls, ~14 going through the storage module.
**If this is wrong:** data loss. This pass changes **no** key and **no** shape, and must
preserve the `Storage.prototype` monkey-patch at `repo-sync.module.js:198-231` that makes repo
sync fire at all.

### 7. Dead code — 3
649 lines of unreachable modules plus two dead subsystems.
**If this is wrong:** something reachable by a path this audit missed gets deleted. Nothing
here is removed without item-by-item sign-off.

---

### Out of scope — documented, not to be changed

| Was | Item | Where it is written up |
|---|---|---|
| 1 | Metric targets and thresholds | 2.1, 4.1, 4.3 |
| 2 | On/Off Track KPI scoring | 2.2 |
| 3 | Metric classification and on-track wording | 2.2 D |
| 4 | Display precision versus judging precision (`hrs`) | 2.10 |

One item from this group is **not** a metrics question and stays open: **Q16**, the tier
vocabulary leaking into the Mid-Year and Year-End prompts (7.2). That is about what an
associate reads, which you raised as a rule. Say the word if you want it dropped as well.

---

# 6. Questions and answers

> **Most of these are now closed as out of scope** (Scott, 2026-08-25: metrics and bands are
> not being changed). **Q1–Q13 and Q17 are documentation only** — they record real
> disagreements in the metric and band layer, kept in case they matter later. Do not act on
> them.
>
> **Q14, Q15 and Q16 are now ANSWERED** (see each below). No open questions remain; Phase 1 is
> closed.

These are the places two copies disagree. Answers are recorded inline against each question.

## Metric targets — out of scope, reference only

**Q1.** `overallExperience` has a 2026 target (75) but **no 2025 entry**
(`metric-profiles:5-18`). A 2025 year-end review currently falls back to the registry and
prints "vs target 75.0%" — the 2026 number. Was there a 2025 Overall Experience goal? If so,
what was it? If there genuinely wasn't one, should 2025 show no target rather than borrow 2026's?

**Q2.** `transfersCount` carries `max 20` in the registry (`:89`) and appears in **no** goal
document. Is 20 a real goal, or an invented placeholder? If invented, it should become `null`
like `totalCalls`.

**Q3.** `transfers` has a rating band in the published CSV (`<=4` / `<=6`) and **no band in
code**. Which is right — does transfers have a stretch goal of 4%, or not?

**Q4.** `holdTime` is `max 30` in code and **absent from the CSV**. Is 30 a real goal that the
CSV should gain, or a stale number the code should lose?

**Q5.** `overallExperienceTop3` is in the CSV (`min 84`) and in parsed data but **not in the
registry**, so its target resolves via `metric-trends:3229`'s `return 90`. Should it become a
real registry entry, or is it reference-only and should stop being parsed?

**Q6.** The `reliability.module.js:1267-1274` discipline ladder uses **16**, the 2025
reliability target, while 2026 is 18. Is the ladder deliberately pinned to 16 as a policy
threshold independent of the goal, or did it miss the 2026 update? Today `18.0h` — exactly on
goal, a score 3 — renders as "Written".

## KPI scoring — out of scope, reference only

**Q7. — ANSWERED by Scott, and my question was wrong.** I asked which of "band score >= 2" and
"meets target" is *the* definition of meeting a KPI. That was the wrong question: they are two
legitimately different things.

- The **goal** is the company/individual number — 93% adherence, 426 AHT, 18 reliability, and
  so on. It lives in `TARGETS_BY_YEAR`.
- The **bands** are goal-and-stretch, and they produce the 1/2/3 score that rolls up into the
  year-end rating — Off Track, On Track/Successful, On Track/Exceptional. They live in
  `RATING_BANDS_BY_YEAR`.

So a target-based count and a band-based count are both valid, and consolidation must keep
both rather than pick one. **What must be fixed is the wording**, and one label is wrong —
see Q7a.

**Q7a. The Team Summary label is wrong under your own model — this is the real bug.**
`on-off-tracker.module.js:1068` heads the band-based count **"Metrics Meeting Goal (score 2+)"**.
But score 2 is the *floor*, not the goal. For four of the five metrics the goal sits **above**
the floor, so these values score 2 while missing the goal (2026):

| metric | goal | scores 2 but misses the goal |
|---|---|---|
| scheduleAdherence | 93 | 92.5 – 92.9 |
| cxRepOverall | 82 | 81.5 – 81.9 |
| overallSentiment | 88 | 87.5 – 87.9 |
| aht | 426 | 427 – 434 |
| reliability | 18 | **18.1 – 24** (widest by far) |

So somebody can score 2 on all five, have met **zero** goals, and the Team Summary reports
**"5 metrics meeting goal"**. Mid-Year, for the same person, correctly says "meeting 0 of 5".
Both counts are right; only the word "Goal" on the band-based one is wrong.

Should `:1068` be reworded (something like "Metrics Not Off Track (score 2+)"), or should that
count switch to a target basis? Reword is the smaller change and keeps the year-end meaning
intact.

**Q7b. Reliability is scored on a different shape from the other four.** Its goal equals its
stretch — `<=18` is both the 2026 goal and the score-3 threshold, and `<=16` was both in 2025.
So hitting the reliability goal earns a **3**, while hitting any other goal earns a **2**.
Consistent across both years, so it looks deliberate — please confirm. If it is deliberate,
it needs a comment in `metric-profiles.module.js`, because it is the one metric where "met
goal" and "exceptional" are the same event.

**Q7c. Mid-Year can send a disciplinary letter to someone who is On Track/Successful.**
The tone tier keys off `notMetCount` (`:747`, `:904-909`), which is **goal**-based. Someone at
score 2 on all five metrics has a rating average of 2.00 — **On Track/Successful** for
year-end — but has missed all five goals, so `notMetCount = 5`, which trips `>= 3` and injects
the disciplinary-action paragraph at `:924`. Is that intended? Under your model it is
arguably correct, since they did miss every goal. But the two documents will read as though
they disagree, and the associate sees both.

**Q8.** With only 3 or 4 of 5 KPIs measured, should there be a verdict at all? `on-off-tracker`
refuses (`:136-144`); `center-ranking` averages over what it has (`:476`, `:491`).

**Q9.** Boundary style: `<= 1.79 / <= 2.79` (on-off-tracker) or `>= 1.8 / >= 2.8`
(center-ranking)? Your published legend (`on-off-tracker:458`, `:328`) states the
center-ranking rule. Which is correct, and should the legend or the code move?

**Q10.** Labels: `On Track/Successful` and `On Track/Exceptional`, or `Successful` and
`Exceptional`? Both are on screen today in different tabs. Mid-Year's override dropdown
(`index.html:527-528`) offers only two values, collapsing the three-tier model — deliberate?

**Q11.** When a review year has **no** rating profile, should the score table print digits at
all? Today it prints 2026-derived scores while the legend says no bands are configured
(`on-off-tracker:84-100` vs `:417`).

**Q12.** Should comparisons round to display precision before judging?
`metric-profiles` does; `futures`, `q1-review` and Mid-Year's `metCount` do not. Adherence
`92.46` scores 2 in Year-End and 1 in the Futures check-in.

## Later passes — Q13 out of scope, Q14 and Q15 live

**Q13.** `hrs` — judged at 2 decimals (`metric-profiles:126`), printed at 1
(`metric-trends`). Which moves?

**Q14. — ANSWERED: consolidate the copies and fix the keying.**

One key-shaped pool. `coaching-email.module.js:219` changes from passing
`metricConfig.label` to passing the metric key, and the label-keyed `DEFAULT_METRIC_TIPS`
(`tips.module.js:992-1084`) is re-keyed. **Coaching emails will start including tips again**,
so this pass has an intended, non-empty baseline diff.

Two things I checked before accepting the job, both of which affect whether the fix is
actually complete:

1. **The re-key is unambiguous.** All 13 labels in `DEFAULT_METRIC_TIPS` map onto exactly one
   registry label each, so every one resolves to a single metric key. No collisions, no
   guesswork. **[V]**
2. **`overallExperience` has tips *only* in the label-keyed map.** `tips.csv` carries 12 keys —
   `acw, aht, cxRepOverall, fcr, holdTime, managingEmotions, negativeWord, overallSentiment,
   positiveWord, reliability, scheduleAdherence, transfers` — and `overallExperience` is not
   among them. So a naive re-key would leave Overall Experience with **no tips at all**, which
   is its status quo and would look like the fix had worked. Its tips must be carried across
   from `DEFAULT_METRIC_TIPS` into the single pool as part of this pass. **[V]**

Still to confirm when the pass starts: whether `tips.csv` stays a hand-edited second copy of
`EMBEDDED_TIPS_CSV`, or the embedded block becomes generated from the file. Either removes the
dual edit; the second is tidier but adds a build-ish step, which cuts against the no-build-step
rule. My inclination is to keep `tips.csv` as the editable source and make the embedded copy a
verbatim mirror with a test asserting they match — no build step, and drift becomes a test
failure instead of a silent bug.

**Q15. — ANSWERED: unify the mechanics, keep the roster sources.**

One shared builder will own **team filtering, sort order, dedupe, HTML escaping, placeholder
text and empty-state behaviour**. Each surface keeps passing its own roster, so **exactly the
same people appear in every picker as today**. Pure structural change, no behaviour change.

Consequences to hold to during the pass:

- The eight roster sources in 2.3 all **stay**. They are not the duplication being removed.
- **Follow-Up's missing team filter stays as-is** (`red-flag.module.js:294-324`), documented as
  a bug rather than fixed. It is the one picker that will not gain team scoping from this pass,
  and that is deliberate — flag it again before pass 1 is committed so the choice is conscious.
- The six placeholder strings collapse to one, the two sort orders to one, and
  `metric-trends.module.js:370`'s unescaped interpolation goes through the shared escaping
  path. Those are the visible outputs to watch in the baseline diff — a placeholder or sort
  change **is** a behaviour change, so the diff will not be empty here, and every line of it
  needs sign-off.
- `reliability`'s priority-ordered sort and PTO's `name (count)` option labels are
  surface-specific outputs, not mechanics. They stay.

## Bugs found — reported, not fixed

1. **"Copy Verint Summary" cannot work** — `index.html:302` → `copilot-prompt.module.js:11`
   reads `#employeeSelect`, which does not exist. **[V]**
2. **Blank max-type metrics count as met in Quarterly** — `q1-review.module.js:330` guards
   `undefined`/`null` but not `''`, and `data-parsing` writes `''` for missing values
   (`:248`, `:273`). `'' <= 426` is `true` in JavaScript, so a blank AHT, ACW or Hold Time is
   counted as a **Strength**. Blank min-type metrics correctly fail, so the error is
   one-directional. I confirmed the coercion by running it. **[V]**
3. **"Daily" is offered on two tabs that cannot read daily data** — Center Averages and Team
   Snapshot, neither of which references `dailyData`. **[V]**
4. **The coaching CC is always empty** — `devCoachingTool_ccEmail` is read and never
   written. **[S]**
5. **Tips never reach coaching emails on the normal path** — the label/key mismatch. **[V]**
6. **`purgeNonRosteredEmployees` never cleans `myTeamMembers`** — array guard on an object
   store. **[V]**
7. **`renderComplianceAlerts` always renders empty** — its only writer is never called. **[S]**

---

# 7. Decisions and constraints (from Scott, 2026-08-25)

## 7.1 The reliability band — confirmed as 18 / 24, and it lives in three places

**Decision: keep the existing values.** In discussion the band was first described as
"sub 18 is a 3, 19–26 is a 2, 27+ is a 1", then revised to **18 / 24 / above**, which is what
the code already has. **No value change.** This is not a defect.

Recording it because it very nearly was one, and because the shape of the near-miss is the
argument for pass 1.

**The band is written down three times, independently:**

| Copy | Value |
|---|---|
| `metric-profiles.module.js:89-93` (2026 bands) | `score3: { max: 18 }`, `score2: { max: 24 }` |
| `on-off-tracker.module.js:99` (hardcoded fallback) | `value <= 18 ? 3 : (value <= 24 ? 2 : 1)` |
| `data/performance-intelligence-metrics-2026.csv` | `<=18`, `<=24`, `>24` |

All three agree today. **[V]**

**Why keeping them in sync matters.** Had the score-2 ceiling moved from 24 to 26, reliability
of 25 or 26 hours would flip from score 1 to score 2. Reliability is one of five KPIs, so that
shifts the rating average by 0.2 — enough to cross the Off Track boundary. Scores of
`2,2,2,1,1` average **1.6 → Off Track**; the same person with reliability at 2 is `2,2,2,1,2`
= **1.8 → On Track/Successful**. A two-hour edit to one threshold flips a year-end verdict,
and it would have to land in three files to be applied consistently. **[V]**

**A consistency check that supports the current values.** Both years follow the same shape —
score 3 is the goal itself, score 2 is the goal plus 6:

| year | goal | score 3 | score 2 |
|---|---|---|---|
| 2025 | 16 | 16 (goal) | 22 (goal + 6) |
| 2026 | 18 | 18 (goal) | 24 (goal + 6) |

So 2025 needs no corresponding change, and reliability's "goal equals stretch" property
(Q7b) is deliberate and consistent rather than an oversight. **[V]**

### Still open on this

**Q17. The discipline ladder is a fourth copy of the band (extends Q6).**
`reliability.module.js:1267-1274` uses `<=0 Clean`, `<=16 Verbal`, `<=24 Written`,
`<=32 Final`, else Termination. Its **24** matches the current score-2 ceiling, but its
**16** is the *2025* goal while the 2026 goal is 18 — so `17.0h` and `18.0h`, both a score 3
and at or inside the 2026 goal, both render as **"Written"** in Attendance. Is the ladder
tied to the score bands at all, or is it separate attendance policy that legitimately uses
its own numbers? If it is tied, the 16 needs to become year-aware; if it is separate, it
needs a comment saying so, or someone will "fix" it later. **[V]**

## 7.2 Associates must never see the 3-tier system

**Scott's constraint:** associates should never really know about the 3-tier system.

The 1/2/3 scores and the Off Track / On Track-Successful / On Track-Exceptional labels are
**manager-facing and year-end-internal**. They must not appear in anything an associate reads.

### The good news — the channel and email surfaces are clean

I scanned every associate-facing generator for tier language (`Off Track`, `On Track/`,
`Exceptional`, `Successful`, `trackLabel`, `ratingAverage`, `score 2/3`):
`coaching-email`, `monday-morning-post`, `celebrations`, `trend-coaching-email`, `day-posts`,
`cheerleading` — **zero hits in all six**. `q1-review`'s tier text is inside `html +=`
(`:565-570`), a rendered manager view, not a prompt. **[V]**

### Two leaks, both in prompts that generate documents the associate receives

1. **Mid-Year — `on-off-tracker.module.js:912`.** When the manual status override is set to
   `off`, the prompt literally instructs:
   *"Supervisor assessment: I am marking {firstName} as OFF TRACK for this review period."*
   The `on` branch at `:914` says *"I consider {firstName} ON TRACK overall"*. Both are tier
   vocabulary handed straight to the AI that writes the associate's letter. **[V]**
2. **Year-End — `year-end.module.js:8`.** The prompt carries
   *"Performance classification: {trackLabel}."*, where `trackLabel` is one of the three tier
   strings (`year-end-comments.module.js:469-473`). The output goes into the SuccessFactors
   boxes the associate reads. **[V]**

Neither is a certainty of leakage — both are *context* given to Copilot rather than text
copied verbatim into the letter, so whether the phrase surfaces depends on what the model does
with it. But "Performance classification: Off Track." is the kind of line an AI paraphrases
straight back into the opening sentence. **This is a live risk, and it is exactly the sort of
thing that shows up in a performance review.**

**Q16. — ANSWERED and DONE: tier phrases replaced with tone instructions.**

Good news on the shape of this: **Mid-Year already has exactly that mechanism.** A
`TONE FOR THIS REVIEW (important):` block (`on-off-tracker.module.js:918-925`) already speaks
in tone rather than tier — "this review needs to be direct and carry real urgency while
staying professional and respectful". The tier vocabulary is a separate, older layer sitting
on top of it. So this pass mostly deletes, it does not invent.

**Three spots in Mid-Year, not two** — I missed one on the first pass:

| Line | Text | Fires when |
|---|---|---|
| `:912` | "I am marking {name} as **OFF TRACK** for this review period." | manual override = `off` |
| `:914` | "I consider {name} **ON TRACK** overall for this review period." | manual override = `on` |
| `:920` | "{name} is **off track** for this review period, so this review needs to be direct…" | `strong` tier *and* override = `off` |

Note `:921`, the non-override `strongIntro`, says "is meeting only N of M key metrics" — that
is **goal** language, not tier language, and it stays. **[V]**

**One spot in Year-End** — `year-end.module.js:8`, `Performance classification: {trackLabel}.`
Year-End has **no tone block at all**, so here the replacement has to introduce one, mapping
the three tier values onto tone phrasing. Mid-Year's block at `:918-925` is the template.
**[V]**

Expect a **non-empty baseline diff** on both prompt builders — that is the point of the
change. The check is that only the tier vocabulary moves and the tone escalation behaviour
(which tier fires when, and the disciplinary paragraph at `:924`) is bit-for-bit unchanged.
---

# Appendix A — Reconciliation with the April 2026 audit

`audit/session-1-findings.md` through `session-7-findings.md` covered some of this ground in
April. Most entries still carry an unfilled `Decision: [ ]`. I re-verified each rather than
trusting the record, because at least one finding is marked done and is not.

| Prior finding | Status now | Evidence |
|---|---|---|
| **F-1** `STORAGE_PREFIX` duplicated 11x | **FIXED** | 19 files declare it, but all via `DevCoachConstants.STORAGE_PREFIX \|\| '...'`. The only bare literal is `constants.module.js:9` itself, which is correct. **[V]** |
| **F-2** error-monitor key outside the namespace | **FIXED** | `error-monitor.module.js:12` is now `STORAGE_PREFIX + 'errorLog'`, with `LEGACY_ERROR_LOG_KEY` at `:13` for migration. **[V]** |
| **F-3** three console wrappers that can fight | **STILL OPEN** | `bootstrap.js:15`, `:21`; `script.js:74`; `error-monitor.module.js:296`. Still three layers. **[V]** |
| **F-4** three `window` error listeners | **PARTIALLY FIXED** | Down to two: `bootstrap.js:38` and `error-monitor.module.js:266`. The `script.js` one is gone. **[V]** |
| **F-5** targets duplicated between registry and profiles | **STILL OPEN — now pass 1** | See 2.1. This is the largest item in this audit. **[V]** |
| **F-6** rating bands cover only some metrics | **STILL OPEN, and the note was already stale** | Bands cover **5** of 15 metrics, not 6 of 14, and session-1's claim that `transfers` has a band is **wrong** — it does not (see Q3). **[V]** |
| **X-1** `COPILOT_URL` hardcoded in 4 modules | **NOT FIXED, despite being recorded as fixed** | Four live `window.open` sites remain: `metric-trends.module.js:3866`, `red-flag.module.js:911`, `sentiment.module.js:1433`, `trend-coaching-email.module.js:352`, plus two in display HTML at `executive-summary.module.js:654` and `metric-trends.module.js:1748`. **[V]** |
| **X-2** seven inline core-metric arrays in `script.js` | **PARTIALLY FIXED** | Most now read `window.CORE_PERFORMANCE_METRICS \|\| [...]`, the accepted idiom. Two bare arrays remain with no canonical read: `script.js:3118` and `:6160`. **[V]** |
| **X-3** dead `window.show*Modal` fallback | **FIXED** | No `window.showDataIntegrityModal` or `window.showPatternMemoryModal` anywhere. **[V]** |
| **X-4** `ccEmail` hardcoded prefix | **FIXED (but see 2.7)** | `shared-utils.module.js:67` uses the constant now. The key is still never written by anything, so the CC is always empty — a different bug. **[V]** |
| **X-5** five hardcoded prefix strings in supervisor seeding | **FIXED** | Only two `'devCoachingTool_` literals remain in `script.js`: the constants fallback at `:36` and a theme key at `:7173`. **[V]** |
| **X-6** shared date-range helper, deferred | **still deferred** | Marked `[KEEP — intentional divergence]`. No change. |
| **X-7** sentiment UI/parse split, deferred | **still deferred** | Still ~1300 lines of sentiment logic in `script.js`. |
| **X-8** call-listening "thin shell" | **was a misdiagnosis, correctly closed** | Confirmed: the module holds the real logic. |

**The lesson from X-1:** a consolidation recorded as complete was 60% complete, and nothing
caught it for four months. Every pass in Phase 3 gets its remaining call sites enumerated and
counted down to zero in the commit message, so "done" is checkable rather than asserted.

---

# Appendix B — What this audit did not cover

- The three untracked modules from the concurrent session (`action-registry`, `asset-loader`,
  `logger`) and the uncommitted changes in ten files. Not in the loader; not audited.
- `cloudflare-sync-worker/` beyond the two residual storage keys noted in 3.5.
- CSS. `styles-v2.css` is 2,048 lines and was only searched for specific selectors.
- The `lib-*.js` vendored libraries.
- Whether `cheerleading._isImprovement` is reached with a metric absent from the year profile
  (Q-open in 2.9, item 2) — I traced the divergence but not the reachability.
- Reachability of the `(1.79, 1.8)` boundary gap through `center-ranking`'s variable
  denominator. I showed it is unreachable on the five-of-five path and reachable in principle
  on the partial path, but did not enumerate the actual denominators in your data.

