# COMPREHENSIVE QA AUDIT - STEP 0: CODEBASE INVENTORY

**Audit Date:** January 2025  
**Auditor Role:** Senior QA Engineer + Software Architect  
**Methodology:** 5-Step Rigorous QA Framework  
**Status:** STEP 0 - Codebase Inventory (In Progress)

---

## EXECUTIVE SUMMARY

### Project Scope
- **Application:** Development Coaching Tool (v1.0)
- **Architecture:** Client-side Single-Page Application (SPA)
- **Tech Stack:** Vanilla JavaScript (ES6+), HTML5, CSS3, Chart.js, SheetJS, localStorage
- **Codebase Size:** 5,028 lines in script.js (main logic)
- **Data Model:** In-memory weeklyData object (keyed by "startDate|endDate"), localStorage persistence
- **Entry Point:** index.html → script.js (DOMContentLoaded event)
- **Backend:** None (no API, no database, pure client-side)

### Key Characteristics
- **No Framework:** Pure JavaScript, no React/Vue/Angular abstractions
- **No Build Step:** Direct browser execution, no compilation
- **Global State:** 5 major global variables manage all application state
- **Event-Driven:** jQuery-style event handler pattern for UI interactions
- **Storage:** localStorage exclusively (no backup, no undo, no versioning)

### Recent Bug History (Last 4 Commits)
| Bug | Severity | Status |
|-----|----------|--------|
| Missing transfers mapping in center average | Critical | ✅ Fixed (commit 3a96ccd) |
| Email generation filtered by wrong period type | Critical | ✅ Fixed (commit 96fc823) |
| Missing null check for period.employee | Critical | ✅ Fixed (commit 4100338) |
| Missing empty string check for centerAverage | High | ✅ Fixed (commit 91544a4) |
| Misleading period label in email header | Medium | ✅ Fixed (commit 91544a4) |
| Residual debug logging | Low | ✅ Fixed (commit 91544a4) |

---

## FILE STRUCTURE & INVENTORY

### Core Application Files

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| **script.js** | 5,028 | All business logic, event handlers, calculations | ✅ Loaded |
| **index.html** | 520 | 7 major sections (tabs), form fields, containers | ✅ Loaded |
| **styles.css** | ~500 | Global styling, grid layout, color scheme | Not yet read |
| **package.json** | ~20 | Dependencies (terser, xlsjs), build tools | ✅ Loaded |
| **tips.csv** | Variable | Seed data for coaching tips database | Not yet read |
| **homepage.html** | Variable | Static home/onboarding page | Not yet analyzed |
| **reliability-*.html** | 3 files | Separate reliability tracking features | Not yet analyzed |
| **.md files** | 6 files | Documentation from previous sessions | ✅ Reviewed |

**Total Codebase:** ~6,000+ lines (script.js + HTML + CSS + docs)

---

## GLOBAL STATE VARIABLES

### Critical State Objects

```javascript
let weeklyData = {};           // PRIMARY DATA STORE
let coachingLogYTD = [];        // Coaching history/events
let currentPeriodType = 'week'; // Active filter (week/month/quarter/ytd)
let currentPeriod = null;       // Currently selected period (weekKey or year)
let myTeamMembers = {};         // Team member selections by weekKey
```

### Data Structure: weeklyData

```javascript
{
  "2025-01-20|2025-01-26": {
    employees: [
      {
        name: "John Doe",
        firstName: "John",
        scheduleAdherence: 95.2,
        cxRepOverall: 88,
        fcr: 75.5,
        // ... 10 more metrics
        surveyTotal: 42,
        totalCalls: 150
      },
      // ... more employees
    ],
    metadata: {
      startDate: "2025-01-20",
      endDate: "2025-01-26",
      label: "Week ending Jan 26, 2025",
      periodType: "week", // or "month", "quarter"
      uploadedAt: "2025-01-20T14:30:00Z"
    }
  },
  // ... more weekKeys
}
```

### Global Constants

**METRICS_REGISTRY** (52 lines)
- Centralized definition of 13 metrics
- Each metric has: key, label, icon, target (min/max/value), unit, columnIndex, chartType, chartColor, defaultTip
- Single source of truth for metric configuration

**POWERBI_COLUMNS** (22 columns)
- Fixed schema mapping from PowerBI export
- Order-dependent parsing (no dynamic column detection)

---

## ENTRY POINTS & INITIALIZATION FLOW

### Application Startup

1. **Page Load:** `index.html` loaded by browser
2. **Script Load:** `script.js` executed (global scope)
   - METRICS_REGISTRY defined (lines 1-200)
   - Global variables initialized to defaults
3. **DOMContentLoaded Event:** Calls `initApp()`
4. **initApp() Sequence:**
   - Load weeklyData from localStorage
   - Load coachingLogYTD from localStorage
   - Load myTeamMembers from localStorage
   - Register all event handlers
   - Register keyboard shortcuts
   - Restore active section from localStorage
   - Initialize data for active section

### Critical Event Handlers (initializeEventHandlers)

| Trigger | Handler | Effect |
|---------|---------|--------|
| `.period-type-btn` click | Updates currentPeriodType | Cascades updatePeriodDropdown() |
| `#specificPeriod` change | Sets currentPeriod | Cascades updateEmployeeDropdown() |
| `#employeeSelect` change | Loads employee data | populateMetricInputs() |
| `#loadPastedDataBtn` click | Parses PowerBI data | Creates weekKey, saves to localStorage |
| Tab buttons (.tab-btn) | showOnlySection() + initializeSection() | Switches UI, initializes tab-specific state |

---

## MAJOR FUNCTIONAL SECTIONS

### SECTION 1: Data Upload (lines 1-900)

**Functions:**
- `parsePowerBIRow(row)` - Extract name and 21 metrics from a single row
- `parsePercentage(value)` - Normalize percentage values (handles "83%", 0.83, null)
- `parseSurveyPercentage(value)` - Same as above but allows empty strings
- `parseSeconds(value)` - Parse time values
- `parseHours(value)` - Parse reliability hours
- `mapHeadersToSchema(headers)` - Validate 22-column format
- `parsePastedData(pastedText, startDate, endDate)` - Main upload entry point

**Data Validation:**
- Validates exactly 22 columns from PowerBI
- Skips rows without numeric totalCalls
- Data integrity check: surveyTotal > totalCalls → warning + invalidate totalCalls
- Column index checks: if value > 100% → logs warning, treats as 0

**Persistence:**
- Stores in `weeklyData[weekKey]` where `weekKey = "startDate|endDate"`
- Metadata includes periodType, label, uploadedAt
- Calls `saveWeeklyData()` after parsing

**RISKS IDENTIFIED:**
- ⚠️ Positional parsing assumes exact column order (no dynamic detection)
- ⚠️ Name parsing assumes "LastName, FirstName" format (fails on "FirstName LastName")
- ⚠️ No import validation for malformed CSV (silently skips bad rows)
- ⚠️ surveyTotal validation only warns, doesn't prevent storage

### SECTION 2: Tips Management (lines 750-1100)

**Functions:**
- `loadServerTips()` - Fetch and parse tips.csv
- `loadUserTips()` / `saveUserTips()` - Custom user tips storage
- `renderTipsManagement()` - Full tips UI with edit/delete capabilities
- Window.addTip(), updateTip(), deleteTip() - CRUD operations (global scope!)

**Data Model:**
```javascript
// Server tips (read-only, but can be edited/deleted)
window._serverTipsWithIndex = {
  "scheduleAdherence": [
    { tip: "Be on time", originalIndex: 0 },
    { tip: "Check schedule", originalIndex: 1 }
  ]
}

// User tips (custom)
userTips = {
  "scheduleAdherence": ["My tip 1", "My tip 2"],
  "customMetric_name": ["Tip 1"]
}

// Deletions tracking
deletedServerTips = {
  "scheduleAdherence": [0, 2] // originalIndex values
}
```

**RISKS IDENTIFIED:**
- ⚠️ CRUD functions exposed in global scope (window.addTip, window.updateTip, window.deleteTip)
- ⚠️ originalIndex tracking fragile (could break if server tips reordered)
- ⚠️ No validation that custom metric keys are unique
- ⚠️ Async loading of tips.csv with no error UI (silent failure if file missing)

### SECTION 3: Team Member Management (lines 880-975)

**Functions:**
- `loadTeamMembers()` / `saveTeamMembers()` - Persist team selections
- `setTeamMembersForWeek(weekKey, memberNames)`
- `getTeamMembersForWeek(weekKey)`
- `isTeamMember(weekKey, employeeName)` - Check if employee is on team
- `populateTeamMemberSelector()` - Render checkboxes for week
- `updateTeamSelection()` - Save checkbox changes

**Data Model:**
```javascript
myTeamMembers = {
  "2025-01-20|2025-01-26": ["John Doe", "Jane Smith"], // Selected members
  "2025-01-13|2025-01-19": [] // Empty = all members selected
}
```

**LOGIC:**
- Empty array means "all members included" (default behavior)
- Populated array means "only these members included"
- Used to filter dropdowns and coaching scope

**RISKS IDENTIFIED:**
- ⚠️ Logic: empty array = include all. Non-intuitive and error-prone.
- ⚠️ No validation that selected members exist in week data
- ⚠️ Deletions don't clean up myTeamMembers entries

### SECTION 4: Coaching Email Generation (lines 1300-1700)

**Functions:**
- `generateCopilotPrompt()` - Create prompt for Microsoft Copilot
- `generateVerintSummary()` - Create Verint-specific summary
- `generateOutlookEmail()` - Open Outlook draft with email
- `evaluateMetricsForCoaching(employeeData)` - Determine celebrate/coaching metrics
- `recordCoachingEvent()` - Log coaching to history

**Flow:**
1. User selects employee and modifies metrics in form
2. Clicks "Generate Copilot Prompt"
3. Prompt copied to clipboard, Copilot tab opened
4. User pastes prompt, gets AI-generated email
5. User pastes result back into app
6. Click "Generate Outlook Email" to open draft

**Data Model:**
```javascript
coachingLogYTD = [
  {
    employeeId: "John Doe",
    weekEnding: "Week ending Jan 26, 2025",
    metricsCoached: ["transfers", "aht"],
    aiAssisted: true,
    generatedAt: "2025-01-20T14:30:00Z",
    timestamp: 1705770600000
  }
]
```

**RISKS IDENTIFIED:**
- ⚠️ Copilot integration is manual cut-paste (error-prone, no API)
- ⚠️ No validation of metric inputs before Copilot prompt
- ⚠️ Promise-based .then() chains could fail silently
- ⚠️ recordCoachingEvent not called consistently (missing from some paths)

### SECTION 5: Employee History & Trends (lines 2400-3400)

**Functions:**
- `renderEmployeeHistory()` - Load employee selector and chart container
- `handleEmployeeHistorySelection(e)` - Render charts for selected employee
- `renderEmployeeCharts(employeeData, employeeName)` - Create Chart.js instances
- `initializeMetricTrends()` - Set up metric trends form
- `generateTrendEmail()` - Generate email with WoW/MoM comparison
- `getYearlyAverageForEmployee()` - Calculate YTD average
- `getPreviousPeriodData()` - Find previous week/month/quarter
- `compareWeekOverWeek()` - Calculate delta and direction

**Chart Rendering:**
- Uses Chart.js with valueLabelPlugin (custom inline)
- Only renders metrics with chartType !== null (9 metrics)
- Supports line and bar chart types
- Shows goal line as dashed reference

**RISKS IDENTIFIED:**
- ⚠️ Date math for getPreviousPeriodData() assumes specific format (unsafe)
- ⚠️ compareWeekOverWeek() has lowerIsBetter logic that could be inverted
- ⚠️ Chart.js plugin not registered early (could fail on first render)
- ⚠️ No error handling if Chart.js library missing

### SECTION 6: Executive Summary (lines 4000-4750)

**Functions:**
- `renderExecutiveSummary()` - Display overview cards
- `initializeYearlyIndividualSummary()` - Initialize YTD review
- `populateExecutiveSummaryAssociate()` - Load employee dropdown
- `loadExecutiveSummaryData()` - Fetch all periods for employee (YTD)
- `populateExecutiveSummaryTable()` - Show aggregated metrics row
- `displayExecutiveSummaryCharts()` - Show metric comparison bars
- `getCenterAverageForWeek(weekKey)` - Get peer averages
- `generateExecutiveSummaryEmail()` - Generate YTD review email

**YTD Logic:**
- Collects ALL periods regardless of metadata.periodType
- Calculates averages across all weeks in year
- Compares to center average (call center peer metrics)
- Generates email with highlights and focus areas

**BUGS FIXED (Recent Session):**
1. ✅ Missing transfers mapping in getCenterAverageForWeek() (line 4757)
2. ✅ Email filtered by periodType === 'ytd' (wrong filter, fixed)
3. ✅ Missing period.employee null check (line 4954)
4. ✅ Missing centerAverage empty string check (line 4958)

**RISKS IDENTIFIED:**
- ⚠️ CRITICAL: Two-pass metrics loop in displayExecutiveSummaryCharts() (inefficient, calculates metrics twice)
- ⚠️ getCenterAverageForWeek() returns empty {} if no data (silent failure)
- ⚠️ email generation loops through metrics with no break on error
- ⚠️ Period label logic simplified but could be confusing to user

### SECTION 7: App Initialization (lines 4700-4900)

**initApp() Sequence:**
1. Load weeklyData from localStorage
2. Load coachingLogYTD from localStorage
3. Load myTeamMembers from localStorage
4. Call initializeEventHandlers()
5. Call initializeKeyboardShortcuts()
6. Restore activeSection from localStorage
7. Call initializeSection(activeSection) for tab-specific setup
8. Register beforeunload listener for auto-save
9. Log "Application initialized successfully!"

**Keyboard Shortcuts:**
- Ctrl+G: Generate email
- Ctrl+S: Export data
- Ctrl+H: Employee history
- Ctrl+T: Tips management
- Escape: Clear form

**RISKS IDENTIFIED:**
- ⚠️ No error handling if localStorage keys corrupted (could throw JSON.parse error)
- ⚠️ initializeSection() not called on page refresh if activeSection changed
- ⚠️ beforeunload listener might not fire in all browsers
- ⚠️ No fallback if initializeEventHandlers() fails

---

## CRITICAL DATA FLOWS

### Flow 1: Upload Data → Store → Display

```
User Input (CSV) 
  ↓ parsePastedData()
  ↓ For each row: parsePowerBIRow()
  ↓ Validate 22 columns, parse metrics
  ↓ weeklyData[weekKey] = { employees: [...], metadata: {...} }
  ↓ saveWeeklyData() → localStorage
  ↓ updatePeriodDropdown()
  ↓ User selects period → updateEmployeeDropdown()
  ↓ User selects employee → populateMetricInputs()
  ↓ applyMetricHighlights() → Show green/yellow backgrounds
```

### Flow 2: Generate Coaching Email

```
User selects employee
  ↓ evaluateMetricsForCoaching()
  ↓ Split metrics into celebrate[] and needsCoaching[]
  ↓ generateCopilotPrompt()
  ↓ Copy prompt, open Copilot
  ↓ User pastes result back
  ↓ generateOutlookEmail()
  ↓ recordCoachingEvent() → coachingLogYTD
  ↓ Open Outlook with mailto link
```

### Flow 3: Metric Trends Email

```
User selects period and employee
  ↓ displayMetricsPreview() (optional editing)
  ↓ generateTrendEmail()
  ↓ Collect employee metrics
  ↓ Get centerAvg for period
  ↓ getPreviousPeriodData() (WoW comparison)
  ↓ Build email with comparisons
  ↓ Auto-copy to clipboard
  ↓ Auto-open Outlook
```

### Flow 4: Executive Summary (YTD Review)

```
User selects associate
  ↓ loadExecutiveSummaryData()
  ↓ Collect ALL periods with matching employee
  ↓ populateExecutiveSummaryTable() → Show YTD aggregates
  ↓ displayExecutiveSummaryCharts() → Show metric comparisons
  ↓ generateExecutiveSummaryEmail()
  ↓ Aggregate metrics, compare to center average
  ↓ Open Outlook
```

---

## IDENTIFIED VULNERABILITIES & FRAGILE CODE

### CRITICAL ISSUES (Must Fix)

| ID | Location | Issue | Risk | Fix Priority |
|----|-----------|----|------|---|
| C1 | displayExecutiveSummaryCharts() | Two-pass metrics loop | Inefficiency, hard to maintain | HIGH |
| C2 | parsePowerBIRow() | Positional parsing, no header validation | Silently fails on wrong format | MEDIUM |
| C3 | isTeamMember() | Empty array logic inverted | Confusing API contract | MEDIUM |
| C4 | generateTrendEmail() | No validation before email generation | Could generate invalid emails | MEDIUM |

### HIGH-RISK PATTERNS

| Pattern | Locations | Risk | Impact |
|---------|-----------|------|--------|
| Global functions in window scope | window.addTip, window.updateTip, etc. | Namespace pollution | Hard to test, conflicts possible |
| Promise .then() chains | generateCopilotPrompt, generateOutlookEmail | Silent failures if copy fails | User confusion, lost data |
| localStorage key hardcoding | 'weeklyData', 'coachingLogYTD', etc. | No key validation | Data loss if key changes |
| Direct DOM access | getElementById() everywhere | Brittle selectors | UI changes break logic |
| No try-catch JSON.parse | Multiple locations | Runtime errors on corrupt data | Crashes on corrupted localStorage |
| Magic numbers | 22 columns, 13 metrics, specific array indices | Maintenance nightmare | Easy to introduce bugs |

### LOW-RISK PATTERNS (But Still Worth Fixing)

| Pattern | Impact |
|---------|--------|
| No input sanitization (escapeHtml used inconsistently) | XSS risk if data not trusted |
| Console.log() scattered throughout | Unprofessional, noise in logs |
| Hard-coded email domains (@aps.com) | Not flexible for different companies |
| No rate limiting on save operations | localStorage write thrashing possible |

---

## DEPENDENCY ANALYSIS

### External Libraries

| Library | Purpose | Status |
|---------|---------|--------|
| Chart.js | Visualization of trends | ✅ Loaded, working |
| SheetJS (xlsx) | Excel export | ✅ Loaded, working |
| N/A | No frontend framework | ✅ Vanilla JS only |

### Browser APIs Used

| API | Purpose | Browser Support |
|-----|---------|-----------------|
| localStorage | Data persistence | Modern browsers |
| Clipboard API | Copy to clipboard | Modern browsers (IE 11 ❌) |
| fetch() | Tips.csv loading | Modern browsers |
| FileReader | Import data | Modern browsers |
| window.location.href | Email opens | All browsers |

---

## TESTING SURFACE AREA

### Critical Test Paths

1. **Upload → Parse → Store → Display**
   - Happy path: Valid 22-column CSV
   - Edge: 21 columns, 23 columns
   - Edge: Blank rows, special characters in names
   - Edge: surveyTotal > totalCalls
   - Edge: Negative numbers, values > 100%

2. **Period Selection → Employee Dropdown → Metrics Display**
   - Happy path: Select week, employee, see metrics
   - Edge: No periods uploaded
   - Edge: Period with no employees matching team selection
   - Edge: Employee in team members but not in data

3. **Coaching Email Generation**
   - Happy path: All metrics populated, generate email
   - Edge: No metrics available (surveyTotal = 0)
   - Edge: Negative values, zero values
   - Edge: Very long employee names, special characters

4. **Executive Summary (YTD)**
   - Happy path: Select associate, see metrics
   - Edge: Associate in first period only
   - Edge: No center average entered
   - Edge: Associate with no surveys (empty OE metrics)

5. **Persistence & Refresh**
   - Happy path: Upload data, refresh page, data persists
   - Edge: Clear localStorage, refresh (should show empty state)
   - Edge: Corrupt localStorage JSON (should handle gracefully)

---

## NEXT STEPS (STEPS 1-5)

### STEP 1: Static Code Audit (Next Phase)
- [ ] Read full index.html, analyze selector usage
- [ ] Analyze styles.css for responsive design issues
- [ ] Check all function definitions for unused code
- [ ] Verify all event handler attachments
- [ ] Check for console.log/debug statements

### STEP 2: Behavioral Test Plan (After Step 1)
- [ ] Create test matrix for each major feature
- [ ] Define expected outcomes and edge cases
- [ ] Identify logging/instrumentation points needed

### STEP 3: Instrumentation Strategy (After Step 2)
- [ ] Add centralized error handler
- [ ] Add structured logging around data flows
- [ ] Create "debug mode" toggle in UI

### STEP 4: Fix Implementation (After Step 3)
- **Pass A:** Runtime/Compile errors (quick wins)
- **Pass B:** Logic bugs (identified issues)
- **Pass C:** Dead code removal (cleanup)
- **Pass D:** Refactoring (consolidation, optimization)

### STEP 5: Regression Checklist (Final)
- [ ] Clickthrough testing for each tab
- [ ] Data persistence across page refresh
- [ ] All email generation functions
- [ ] Team member filtering logic
- [ ] Chart rendering with various data sizes

---

## AUDIT NOTES

**Completion Status:** 
- ✅ STEP 0 - Inventory Complete (5,028 lines analyzed)
- 🔄 Ready for STEP 1 - Static Audit

**Files Ready for Deep Dive:**
- ✅ script.js (fully read and catalogued)
- ⏳ index.html (structure known, needs detailed analysis)
- ⏳ styles.css (needs review for responsive issues)

**Blockers:** None - Ready to proceed with STEP 1 (Static Audit)

**Estimated Effort:**
- STEP 1: 2-3 hours (detailed line-by-line review)
- STEPS 2-3: 1-2 hours (test planning + instrumentation)
- STEP 4: 2-4 hours (fix implementation + testing)
- STEP 5: 1-2 hours (regression testing)
- **Total:** 6-11 hours for comprehensive QA + fixes

---

**End of STEP 0 - Codebase Inventory**

Next action: Begin STEP 1 - Static Code Audit (detailed analysis of every function, variable, and control flow)
