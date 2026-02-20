# 🧪 Smoke Test - v2026.02.20.44

## Test Execution Checklist

### 1. APP LOAD & CONSOLE CHECK ✅
- [ ] Open app (refresh to get v2026.02.20.44)
- [ ] Open DevTools (F12 → Console)
- [ ] Look for red errors
- [ ] Should see version: `v2026.02.20.44`

---

### 2. DATA UPLOAD - METRICS 🔼
- [ ] Click "Upload Metrics"
- [ ] Paste or select a week of data
- [ ] Select week ending date
- [ ] Click "Load Data"
- [ ] Verify success message
- [ ] Check employee count matches

---

### 3. DATA UPLOAD - SENTIMENT 🎤
**Critical for testing the bugfix!**
- [ ] Click "Upload Sentiment" 
- [ ] Select Negative Words file
- [ ] Click "Parse & Import"
- [ ] **Check Console** for logs:
  ```
  📊 PARSE START - fileType=Negative
  📊 PARSE COMPLETE - All Interactions matches found: [...]
  ✅ SET METRICS (in keywords section): XXX% ...sentiment
  ```
- [ ] Verify percentage shows in keywords section

---

### 4. COACHING EMAIL - METRIC SELECTION
- [ ] Go to "Generate Coaching Email"
- [ ] Select period (week)
- [ ] Select employee
- [ ] Verify metrics populate
- [ ] Check for green (meets target) vs yellow (needs coaching)

---

### 5. COACHING EMAIL - COPILOT PROMPT 🤖
- [ ] Click "Generate CoPilot Prompt"
- [ ] Verify email output shows metrics and tips
- [ ] **CRITICAL**: Check sentiment section:
  - Should show: "Avoiding Negative Words: XX%"
  - Not: "15%" (the bug we fixed)
  - Should match your uploaded sentiment data

---

### 6. METRIC TRENDS 📈
- [ ] Go to "Metric Trends"  
- [ ] Select period
- [ ] Select employee
- [ ] Click "Generate Trend Email"
- [ ] Verify metrics comparison vs center average
- [ ] Check console for trend calculation logs

---

### 7. SENTIMENT SECTION 💬
- [ ] Go to "Sentiment"
- [ ] View sentiment summary
- [ ] Check all three categories (Positive, Negative, Emotions)
- [ ] Verify percentages match uploaded data

---

### 8. TEAM MANAGEMENT 👥
- [ ] Go to "Manage Data" → "Team Data"
- [ ] Select a week
- [ ] Check/uncheck team members
- [ ] Verify filtering works in coaching section

---

### 9. YEAR-END REVIEW 📋
- [ ] Go to "Year End Comments"
- [ ] Select employee and year
- [ ] Fill in annual goals
- [ ] Verify save works
- [ ] Go back and verify data persisted

---

### 10. TIPS MANAGEMENT 💡
- [ ] Go to "Coaching Tips"
- [ ] Select a metric category
- [ ] View tips
- [ ] Try adding/editing/deleting a tip
- [ ] Verify changes save

---

### 11. DATA MANAGEMENT 🗂️
- [ ] Export data to JSON
- [ ] Try deleting a week
- [ ] Verify it's gone from dropdown
- [ ] Import the backup JSON
- [ ] Verify data restored

---

### 12. RED FLAGS & PTO 🚩
- [ ] Click "Red Flags"
- [ ] Verify section loads
- [ ] Click "PTO Tracker"
- [ ] Verify section loads
- [ ] Add a PTO entry
- [ ] Generate PTO email

---

### 13. KEYBOARD SHORTCUTS ⌨️
- [ ] Press `Escape` (should clear form)
- [ ] Press `Ctrl+S` (should export)
- [ ] Press `Ctrl+G` (should generate)

---

### CONSOLE LOG VERIFICATION 🔍

**After uploading sentiment data, verify these logs appear:**

```javascript
📊 PARSE START - fileType=Negative, total lines=XXX
📊 PARSE COMPLETE [fileType=Negative] - All Interactions matches found: [
  {lineIndex: N, percentage: 15, inKeywordsSection: false},    // Wrong (summary)
  {lineIndex: M, percentage: 80, inKeywordsSection: true}      // Correct (keywords)
]
⚠️ IGNORING pre-keywords Interactions line (15%)
✅ SET METRICS (in keywords section): XXX detected, XXX total, 80%
📊 FORMAT DEBUG - Output formatted.scores.negativeWord: 80
📊 BUILD DEBUG - negativeWord score: 80, target: 83
```

**Key indicator:** Lines should show `inKeywordsSection: true` for the correct metric (80.5%), not `false` (15%).

---

## PASS/FAIL CRITERIA

### ✅ PASS
- [ ] No red console errors
- [ ] All sections load without crashing
- [ ] Sentiment percentage matches reality (80.5%, not 15%)
- [ ] Tips randomize correctly (not same tips every time)
- [ ] Data persists after refresh
- [ ] Copilot prompts show realistic coaching text

### ❌ FAIL
- [ ] Red errors in console
- [ ] App doesn't load or crashes
- [ ] Sentiment shows wrong percentage (15% instead of actual)
- [ ] Same 2 tips appear every time
- [ ] Data lost on refresh
- [ ] Missing sentiment integration

---

## NOTES

- **Sentiment Bug**: The fix changes parsing to ONLY read Interactions from keywords section
- **Console Logging**: Comprehensive logs added to track data flow
- **14-day vs 7-day**: Sentiment spans 14 days, metrics are 7 days (overlapping lookup)
- **Multiple Interactions**: Files have summary stats + keyword detection stats

---

## QUICK TEST (5 minutes)

If limited on time:
1. Load app ✅
2. Upload metrics ✅
3. Upload sentiment ✅
4. Generate Copilot prompt ✅
5. Verify sentiment percentage is correct (not 15%) ✅
6. Check console for parse logs ✅
