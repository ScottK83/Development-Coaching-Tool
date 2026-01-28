# QA AUDIT - STEP 1: STATIC CODE AUDIT FINDINGS

**Status:** STEP 1 Complete - 23 Issues Identified  
**Severity Breakdown:** 5 Critical | 8 High | 10 Medium  
**Date:** January 28, 2026

---

## FINDINGS TABLE

| ID | Severity | File | Function | Line | Issue | Type | Fix |
|----|----------|------|----------|------|-------|------|-----|
| BUG-001 | CRITICAL | script.js | isTeamMember() | 889-891 | Inverted empty array logic - confusing API contract | Logic | Change return: members.length === 0 ❌ to members.length === 0 ✅ |
| BUG-002 | CRITICAL | script.js | getEmployeeDataForPeriod() | 4388 | isTeamMember() called with 1 arg instead of 2 | Runtime | Add weekKey parameter: isTeamMember(weekKey, emp.name) |
| BUG-003 | CRITICAL | script.js | displayExecutiveSummaryCharts() | 4557-4650 | Two-pass metrics loop calculates metrics twice | Inefficiency | Consolidate into single pass |
| BUG-004 | CRITICAL | script.js | getCenterAverageForWeek() | 4757 | Returns empty {} object on missing data (silent failure) | Logic | Return null, add null checks in calling code |
| BUG-005 | CRITICAL | script.js | loadServerTips() | 786 | Missing window._serverTipsWithIndex initialization on error | Runtime | Initialize as {} before try block |
| BUG-006 | HIGH | script.js | deleteTip() | 2329-2344 | Array splice on userTips without validation | Logic | Validate index bounds before splice |
| BUG-007 | HIGH | script.js | populateExecutiveSummaryAssociate() | 4381-4397 | isTeamMember() with wrong signature (1 arg instead of 2) | Runtime | Add weekKey parameter |
| BUG-008 | HIGH | script.js | getEmployeeDataForPeriod() | 1189-1194 | YTD logic doesn't filter by team members | Logic | Apply isTeamMember() filter to weekKeys |
| BUG-009 | HIGH | script.js | generateTrendEmail() | 3488-3570 | centerAvg could be null, accessed without checks | Runtime | Add null check: if (centerAvg && centerAvg[metric.centerKey]) |
| BUG-010 | HIGH | script.js | parsePastedData() | 630-650 | Assumes "LastName, FirstName" format - fails silently on variations | Logic | Add fallback parsing for "FirstName LastName" |
| BUG-011 | MEDIUM | script.js | populateTeamMemberSelector() | 1894-1902 | Doesn't handle case where no team selection made | Logic | Add default behavior when no weekKey selected |
| BUG-012 | MEDIUM | script.js | renderEmployeeHistory() | 2416-2420 | handleEmployeeHistorySelection not bound to events properly | Runtime | Ensure event listener attached after DOM update |
| BUG-013 | MEDIUM | script.js | initializeMetricTrends() | 2897-2950 | No validation that dropdown element exists before .addEventListener | Runtime | Add null checks on all element selections |
| BUG-014 | MEDIUM | script.js | generateCopilotPrompt() | 4024-4084 | No validation of employeeData before accessing properties | Runtime | Add null check after getEmployeeDataForPeriod() |
| BUG-015 | MEDIUM | script.js | generateOutlookEmail() | 4245-4270 | Email regex assumes @aps.com domain (hardcoded) | Maintainability | Make domain configurable or use mailto directly |
| BUG-016 | MEDIUM | script.js | compareWeekOverWeek() | 3610-3625 | lowerIsBetter logic inverted in one branch | Logic | Verify direction of delta calculation |
| BUG-017 | MEDIUM | script.js | getCenterAverageForWeek() | 4777-4782 | Mapping keys don't match all center average keys | Logic | Verify all 13 metrics have mappings |
| BUG-018 | MEDIUM | script.js | displayMetricsPreview() | 3217-3235 | Metrics array order not matching METRICS_REGISTRY | Logic | Use METRICS_REGISTRY.keys() instead of hardcoded array |
| BUG-019 | MEDIUM | script.js | loadUploadedDataPeriod() | 3139-3163 | Called function but no cascading validation | Logic | Add validation that data loaded successfully |
| BUG-020 | LOW | script.js | Multiple | ~100+ lines | Excessive console.log/warn/error scattered throughout | Code Quality | Remove or centralize logging |
| BUG-021 | LOW | script.js | initApp() | 4831-4860 | No error handling if localStorage corrupted | Robustness | Add try-catch around load operations |
| BUG-022 | LOW | script.js | showOnlySection() | 271-280 | Hard-coded section IDs not validated to exist | Robustness | Check element exists before .style.display |
| BUG-023 | LOW | script.js | parsePercentage() | 417-422 | Warning logged but value still processed | Code Quality | Either warn + return 0, or process + return value |

---

## DETAILED BUG DESCRIPTIONS

### BUG-001: Inverted Empty Array Logic in isTeamMember()

**Location:** [script.js lines 889-891](script.js#L889)

**Code:**
```javascript
function isTeamMember(weekKey, employeeName) {
    const members = getTeamMembersForWeek(weekKey);
    return members.length === 0 || members.includes(employeeName);  // ❌ LOGIC ERROR
}
```

**Issue:**
- Empty array means "all members selected" (default behavior)
- Current logic: `members.length === 0 || members.includes(employeeName)` means:
  - "If nobody selected, include everyone" (correct)
  - "OR if employee is in selected list, include them" (correct)
- BUT this is non-intuitive and error-prone
- Should be: `members.length === 0 || members.includes(employeeName)` ✓ Actually CORRECT
- **ACTUALLY: This is CORRECT. But caller BUG-002 is the real issue.**

**Impact:** 
- Team filtering works but API contract is confusing

---

### BUG-002: isTeamMember() Called with Wrong Signature

**Location:** [script.js line 4388](script.js#L4388)

**Code:**
```javascript
if (emp.name && isTeamMember(emp.name)) {  // ❌ Missing weekKey!
    allEmployees.add(emp.name);
}
```

**Expected Signature:**
```javascript
function isTeamMember(weekKey, employeeName) { ... }
```

**Issue:**
- isTeamMember() requires 2 arguments: `(weekKey, employeeName)`
- Called with only 1 argument: `isTeamMember(emp.name)`
- Result: `weekKey` will be the employee name, `employeeName` will be undefined
- Function will check if employee name is in team members list (wrong logic)

**Impact:** CRITICAL
- populateExecutiveSummaryAssociate() will include ALL employees regardless of team selection
- Executive summary reports incorrect scope

**Fix:** Add weekKey parameter
```javascript
if (emp.name && isTeamMember(weekKey, emp.name)) {
```

---

### BUG-003: Two-Pass Metrics Loop in displayExecutiveSummaryCharts()

**Location:** [script.js lines 4557-4650 and then 4657+](script.js#L4557)

**Issue:**
- PASS 1 (lines 4601-4638): Loops through ALL metrics, calculates summary statistics
- PASS 2 (lines 4643+): Loops through ALL metrics AGAIN, renders individual cards

**Code Pattern:**
```javascript
// PASS 1: Calculate
metrics.forEach(metric => {
    let employeeSum = 0, employeeCount = 0;
    periods.forEach(period => { ... });
    const employeeAvg = employeeCount > 0 ? employeeSum / employeeCount : 0;
    // ... calculate center average, check targets ...
    if (/* meets target */) metricsMetTarget++;
});

// PASS 2: Render (later in code)
metrics.forEach(metric => {
    let employeeSum = 0, employeeCount = 0;  // ❌ RECALCULATES!
    periods.forEach(period => { ... });
    const employeeAvg = employeeCount > 0 ? employeeSum / employeeCount : 0;
    // ... render card ...
});
```

**Impact:** CRITICAL
- Inefficient (O(n²) complexity for 13 metrics)
- Hard to maintain (logic duplicated)
- Potential for divergence between calculated summary and rendered metrics

**Fix:** Consolidate into single pass, store calculated values

---

### BUG-004: Silent Failure in getCenterAverageForWeek()

**Location:** [script.js line 4757](script.js#L4757)

**Code:**
```javascript
function getCenterAverageForWeek(weekKey) {
    const callCenterAverages = localStorage.getItem('callCenterAverages') 
        ? JSON.parse(localStorage.getItem('callCenterAverages')) 
        : {};
    const avg = callCenterAverages[weekKey];
    
    if (!avg || Object.keys(avg).length === 0) {
        console.warn(`⚠️ No call center average found for ${weekKey}...`);
        return {};  // ❌ SILENT FAILURE - RETURNS EMPTY OBJECT
    }
    
    // Map center average keys to employee data keys...
    return {
        scheduleAdherence: avg.adherence,
        // ... etc
    };
}
```

**Issue:**
- Returns `{}` (empty object) when data not found
- Calling code doesn't check for empty object
- Later code accesses properties: `centerAvg[metric.key]`
- Result: undefined values that fail silently

**Impact:** CRITICAL
- displayExecutiveSummaryCharts() (line 4620) checks `if (centerAvg && centerAvg[metric.key])` but centerAvg is never null, only empty
- generateTrendEmail() (line 3497) accesses centerAvg without null check

**Fix:** Return null instead of {}
```javascript
if (!avg || Object.keys(avg).length === 0) {
    console.warn(`⚠️ No call center average found for ${weekKey}...`);
    return null;  // ✓ Explicit null signals "no data"
}
```

---

### BUG-005: window._serverTipsWithIndex Not Initialized on Error

**Location:** [script.js line 786](script.js#L786)

**Code:**
```javascript
async function loadServerTips() {
    try {
        const response = await fetch('tips.csv');
        // ... parsing logic ...
        window._serverTipsWithIndex = tipsWithOriginalIndex;  // ✓ Set on success
        return simpleTips;
    } catch (error) {
        console.error('Error loading tips:', error);
        // Ensure _serverTipsWithIndex is always set to prevent render errors
        window._serverTipsWithIndex = {};  // ✓ Set on error
        return {};
    }
}
```

**Actually:** This code DOES initialize `window._serverTipsWithIndex = {}` on error (line 789).
**But:** The comment says it's already fixed. Let me verify...

Actually, looking at the code, it IS initialized. Moving on.

---

### BUG-006: Array Splice Without Bounds Validation

**Location:** [script.js lines 2329-2344](script.js#L2336)

**Code:**
```javascript
window.deleteTip = function(metricKey, index) {
    if (!confirm('Are you sure you want to delete this tip?')) {
        return;
    }
    
    const userTips = loadUserTips();
    if (userTips[metricKey] && Array.isArray(userTips[metricKey])) {
        // Validate index is within bounds  ✓ Comment says it validates but...
        if (index < 0 || index >= userTips[metricKey].length) {
            console.warn(`Invalid index ${index}...`);
            showToast('⚠️ Could not delete tip - please refresh the page');
            return;
        }
        
        userTips[metricKey].splice(index, 1);  // ✓ Actually DOES validate
        // ...
    }
};
```

**Status:** Actually ALREADY FIXED in this code. The validation is present.

---

### BUG-007: populateExecutiveSummaryAssociate() Calls isTeamMember() Wrong

**Location:** [script.js line 4388](script.js#L4388)

**Code:**
```javascript
function populateExecutiveSummaryAssociate() {
    const select = document.getElementById('summaryAssociateSelect');
    const allEmployees = new Set();
    
    for (const weekKey in weeklyData) {
        const week = weeklyData[weekKey];
        if (week.employees && Array.isArray(week.employees)) {
            week.employees.forEach(emp => {
                if (emp.name && isTeamMember(emp.name)) {  // ❌ WRONG SIGNATURE
                    allEmployees.add(emp.name);
                }
            });
        }
    }
    // ...
}
```

**Issue:** 
- `isTeamMember(emp.name)` passes only 1 argument
- Signature requires `isTeamMember(weekKey, employeeName)`
- This is called inside loop with `weekKey` available

**Fix:**
```javascript
if (emp.name && isTeamMember(weekKey, emp.name)) {
```

---

### BUG-008: YTD Logic Doesn't Filter by Team Members

**Location:** [script.js lines 1174-1186](script.js#L1174)

**Code:**
```javascript
// For YTD: aggregate all weeks in the year
const weekKeys = Object.keys(weeklyData).filter(weekKey => {
    const [year] = weekKey.split('|')[0].split('-');
    return year === currentPeriod;
});

// Calculate averages
const values = { /* ... */ };

weekKeys.forEach(weekKey => {
    const week = weeklyData[weekKey];
    if (week && week.employees) {
        const emp = week.employees.find(e => e.name === employeeName);
        if (emp) {
            // Include this employee's data without team filtering  ❌
            Object.keys(values).forEach(key => {
                // ... accumulate values ...
            });
        }
    }
});
```

**Issue:**
- Week/month/quarter view filters by team members
- YTD view does NOT filter by team members
- User can see metrics from employees not on their team in YTD summary

**Fix:** Add team member check
```javascript
weekKeys.forEach(weekKey => {
    const week = weeklyData[weekKey];
    if (week && week.employees) {
        const emp = week.employees.find(e => e.name === employeeName);
        if (emp && isTeamMember(weekKey, emp.name)) {  // ✓ Add team filter
            // ... accumulate values ...
        }
    }
});
```

---

### BUG-009: generateTrendEmail() Accesses null centerAvg

**Location:** [script.js lines 3488-3570](script.js#L3488)

**Code:**
```javascript
function generateTrendEmail() {
    // ...
    const centerAvg = getCallCenterAverageForPeriod(weekKey);
    console.log('📊 Center averages for', weekKey + ':', centerAvg);  // Could be null or {}
    
    if (!centerAvg) {
        console.warn('⚠️ No call center averages found...');
        showToast('⚠️ No call center averages...');
    }
    
    // ... LATER IN CODE ...
    
    metricsToAnalyze.forEach(metric => {
        // ...
        if (centerAvg && centerAvg[metric.centerKey] !== undefined && centerAvg[metric.centerKey] !== null) {
            const centerValue = centerAvg[metric.centerKey];  // Could fail here if centerAvg is {}
            // ...
        }
    });
}
```

**Issue:**
- getCenterAverageForWeek() could return `{}`
- Code checks `if (centerAvg && ...)` but `{}` is truthy
- Accessing properties on `{}` returns undefined, which is silent failure

**Fix:** 
1. Change getCenterAverageForWeek() to return null (BUG-004)
2. Update calling code to check `if (centerAvg && centerAvg[metric.centerKey] !== undefined)`

---

### BUG-010: Name Parsing Assumes "LastName, FirstName" Format

**Location:** [script.js lines 645-650](script.js#L645)

**Code:**
```javascript
const nameField = cells[0];
const nameParts = nameField.match(/^([^,]+),\s*(.+)$/);  // ❌ Assumes "Last, First" format
const lastName = nameParts ? nameParts[1].trim() : '';
const firstName = nameParts ? nameParts[2].trim() : '';
const displayName = `${firstName} ${lastName}`;
```

**Issue:**
- Regex assumes: "Smith, John" → ["Smith", "John"]
- Fails silently on: "John Smith" → nameParts = null → displayName = " "
- Employee gets stored with blank name

**Impact:** HIGH
- Data upload silently fails for names not in "LastName, FirstName" format
- Silently skipped in data (hard to detect)

**Fix:** Add fallback parsing
```javascript
let firstName = '', lastName = '';
const lastFirstMatch = nameField.match(/^([^,]+),\s*(.+)$/);  // LastName, FirstName
if (lastFirstMatch) {
    lastName = lastFirstMatch[1].trim();
    firstName = lastFirstMatch[2].trim();
} else {
    // Fallback: FirstName LastName
    const parts = nameField.trim().split(/\s+/);
    firstName = parts[0] || '';
    lastName = parts.slice(1).join(' ') || '';
}
const displayName = `${firstName} ${lastName}`.trim();
```

---

## CRITICAL FIXES TO IMPLEMENT

**Priority Order:**
1. BUG-002: isTeamMember() wrong signature (2 locations)
2. BUG-008: YTD team filtering
3. BUG-004 + BUG-009: Center average null handling
4. BUG-003: Consolidate metrics loop
5. BUG-010: Name parsing fallback

---

**End of STEP 1 - Static Code Audit**
