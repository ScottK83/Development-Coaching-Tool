# Tests

No npm, no dependencies, no build step — same constraints as the app.

```
node tests/run.js              # everything
node tests/run.js movement     # only suites whose name matches "movement"
```

Exits non-zero on failure. The pre-push hook runs it and aborts the push if
anything fails; `SKIP_TESTS_ON_PUSH=1` bypasses it for a work-in-progress push.

## Writing a test

The modules under test are browser IIFEs that hang themselves off `window`, so
`harness.js` fakes just enough of a browser to load them.

```js
const { suite } = require('./harness');

suite('what this covers', (t) => {
    t.installFakeBrowser();                       // window, document, localStorage
    const api = t.loadModule('modules/thing.module.js').thing;

    t.equal('label', api.doThing(), 'expected');  // prints a diff on failure
    t.check('label', someBoolean);
});
```

`suite` accepts an async function if you need to await.

The fake browser is deliberately thin. A test that needs more should build it
locally rather than growing a shared pseudo-browser nobody fully understands.

## What's covered, and why

Each suite exists because something broke, or because something is easy to
break silently and expensive when it does.

| Suite | Why it exists |
|---|---|
| `metric-movement` | Trend direction is normalized to **performance**, so on Handle Time "improving" means the number went *down*. Four modules re-derived that independently and two got it backwards — Q1 Review printed "(trending up)" for a handle time that fell, in text that goes into review copy. |
| `trend-wording-consistency` | Guards the bug *class*, not the two bugs. Scans every module for hand-rolled trend arrows and raw direction words. This is what caught the third offender. |
| `cheer-monthly-source` | A real monthly upload must outrank the weekly rebuild. Weeks bucket by *end* date, so a rebuilt "July" is really Jun 29–Jul 26 — Christi's transfer rate read 4.8% when the uploaded report said 5.90%. |
| `clipboard` | Copy is the last step of nearly every feature. Several call sites had no error path, so a blocked clipboard looked exactly like success. Also pins that chained actions (open Outlook, open Copilot) wait on the copy actually landing. |
| `selected-associate` | Cross-tab selection sync, including the loop-guard and the two deliberate refusals: a picker missing that person keeps its own value, and blanking one picker doesn't clear the shared person. |
| `message-voice` | Greeting tones stay distinct — celebratory keeps its emoji, neutral stays plain — and the pool is handed out as a copy so one caller can't poison the rest. |

## The rule worth keeping

The arrow follows the **number**. The colour and the words follow the
**verdict**. A green ▼ on Handle Time is correct; a green ▲ contradicts the
figure printed beside it.

Anything deriving that itself is a bug waiting to happen — call
`DevCoachModules.metricMovement` instead.

## The behaviour baseline

```
node tests/baseline.js            # regenerate baseline/outputs.txt
node tests/baseline.js --check    # regenerate and exit non-zero if it changed
node tests/baseline.js --surface  # print what loaded and what is callable
```

`baseline/outputs.txt` is a golden file: it records what every text generator,
calculator, KPI scorer and email builder returns for the fixed dataset in
`baseline/fixture.js`. After a refactoring pass, an empty `git diff` on it means
the pass changed no behaviour. A non-empty diff is either an intended change
that needs explaining line by line, or a bug.

It is not a test suite and it asserts nothing. `node tests/run.js` is still the
thing that says whether the app is correct; the baseline only says whether it
changed.

### Why it is built the way it is

Three things had to be true, and each forced a decision:

**It has to be deterministic**, or it diffs against itself. The app has 27
`Math.random()` sites and over a hundred bare `new Date()` calls. So the harness
freezes the clock at 2026-06-25T09:00, pins `TZ` to `America/Phoenix` (no
daylight saving, so the same instant renders identically anywhere), and replaces
`Math.random` with a seeded generator — seeded once before load, because modules
shuffle their phrase pools at load time, and re-seeded per entry from a hash of
the entry's own label, so adding an entry never shifts the ones around it.

**It must not change application code.** Anything that cannot be called in
isolation is written to `baseline/NOT-COVERED.md` with the reason, never
refactored to make it reachable.

**It has to load the app the way a browser does.** Two details matter:

- `window` is set to the real `global`. In a browser they are the same object,
  so `window.METRICS_REGISTRY = x` also creates a bare global. Modules rely on
  that constantly.
- Every module and `script.js` are evaluated as **one concatenated program**.
  Separate `eval` calls each get their own lexical environment, which hides
  top-level `let`/`const` from every other file — so `script.js`'s stores and
  `STORAGE_PREFIX` read as "not defined" from anywhere else. Browsers share one
  global lexical environment across classic scripts; concatenating restores
  that. It is safe because duplicate top-level declarations would already be a
  SyntaxError in the browser.

The fixture's nine associates sit deliberately on the boundaries — at the goal,
at the score-2 floor, a hair under it, and on a value that rounds across the
line — because a threshold that moves by a tenth only shows up in a diff if
somebody is standing on the line when it moves.
