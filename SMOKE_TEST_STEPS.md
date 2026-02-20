# 🧪 Metric Trends Redesign - Smoke Test Guide

## ✅ Code Validation Complete
- ✓ **JavaScript Syntax**: Passed (node -c check)
- ✓ **Function Signatures**: All updated with new parameters
- ✓ **Data Flow**: allMetrics passed through call chain
- ✓ **UI Elements**: All new modal elements in place

---

## 📋 Test Execution Steps

### Setup Phase
1. Open the app in browser: `http://localhost:8000`
2. Ensure app loads without console errors (F12 to open DevTools)
3. Navigate to **Coaching & Analysis** tab

### Data Preparation
4. **Upload Sample Data**:
   - Go to **Home (Upload Data)** tab
   - Paste sample PowerBI data with employees and metrics
   - Select period type and dates
   - Upload data

5. **Upload Sentiment Data**:
   - Go to **Manage Data** → **Sentiment Database** 
   - Upload 3 sentiment CSV files:
     - Positive Word Usage
     - Negative Word Usage  
     - Managing Emotions
   - Save sentiment snapshot with date range and associate name

### Test Execution
6. **Navigate to Metric Trends**:
   - Click **Coaching & Analysis** tab
   - Scroll to **Metric Trends** section
   - Verify it's visible

7. **Select Data**:
   - **Period Dropdown**: Select a week/month that has data
   - **Employee Dropdown**: Select the employee you uploaded
   - **Optional**: Enter a nickname for the employee

8. **Generate Email**:
   - Click **Generate Trend Email** button
   - Wait ~2 seconds for email image to be created
   - A modal should appear

---

## 🎯 Verification Checklist

### Modal Appearance
- [ ] Modal appears with coaching summary
- [ ] Modal title shows employee name: "📊 Coaching Summary for [Name]"
- [ ] Period info displayed (Week ending [Date])
- [ ] Existing coaching sections visible:
  - [ ] Praise section (if metric is above 75% of target)
  - [ ] Focus Area section (metric below center)
  - [ ] Coaching Tips for [Metric] section
  - [ ] Sentiment Focus section (if snapshot exists)
  - [ ] Additional Notes textarea

### **NEW** - Copilot Prompt Section
- [ ] **Section Header**: "🤖 CoPilot Prompt"
- [ ] **Description**: "Copy this prompt and paste it into Microsoft CoPilot..."
- [ ] **Textarea**: Large read-only textarea containing the prompt
  - Should show 200px height
  - Should have monospace font
  - Should be scrollable if content is long
- [ ] **Copy Button**: "📋 Copy Prompt" button below textarea
  - Should have blue background (#1976d2)

### Prompt Content Validation
The prompt should include:
- [ ] **Conversation Starter**: One of these randomized options:
  ```
  - "I'd like to help [Name] build on their momentum..."
  - "[Name] has some great wins this period..."
  - "Here's what I'm seeing with [Name]'s performance..."
  - "[Name] is doing well in some areas..."
  ```

- [ ] **Successes Section**: 
  ```
  **ACKNOWLEDGE SUCCESSES:**
  - [Name] is [excelling/crushing it/shining] in [Metric] ...
  - Lists metrics >= 95% of target
  ```

- [ ] **Opportunities Section**: 
  ```
  **AREAS TO DEVELOP:**
  - [Intro phrase] [metric name]. Currently at X (YY% of target)
    💡 Tip: [Random coaching tip for this metric]
  ```
  Should have:
  - Random introductory phrases (5 variants)
  - Specific achievement % and gap info
  - At least one random tip per opportunity

- [ ] **Sentiment Section** (if snapshot exists):
  ```
  **SENTIMENT COACHING DATA** (dates)
  [Sentiment focus text from snapshot]
  
  [Positive phrase praise variant]:
  - "[phrase]" (used X times)
  
  [Negative phrase alternative variant]:
  - "[phrase]" (X times) → "[alternative]"
  ```
  Features:
  - Top 3 positive phrases with usage counts
  - Top 3 negative phrases with suggested alternatives
  - Randomized praise and alternative intro phrases

- [ ] **Closing**: One of these randomized options:
  ```
  - "I believe you've got this..."
  - "You've got the tools to improve..."
  - "I'm confident you'll nail these improvements..."
  - "These are achievable targets..."
  - "You're capable of great things..."
  ```

### Button Functionality
- [ ] **Copy Prompt Button**:
  - Click button
  - Toast notification appears: "✅ Prompt copied to clipboard!"
  - Can paste into CoPilot (test with Ctrl+V)

- [ ] **Log Coaching Button**:
  - Can add optional notes in "Additional Notes" textarea first
  - Click "Log Coaching"
  - Toast appears: "✅ Coaching logged"
  - If notes were added, toast shows: "💡 Updated prompt above with your notes..."
  - Prompt textarea updates with new prompt (with notes included)
  - Can re-copy the updated prompt

- [ ] **Skip Button**:
  - Closes modal without saving

### Advanced Features
- [ ] **Randomization**: 
  - Generate multiple times (close modal, select same employee, click Generate again)
  - Verify prompt text differs each time (different random phrases, tips)
  - This confirms randomChoice() is working

- [ ] **Sentiment Integration**:
  - If sentiment snapshot exists, verify positive/negative phrases appear
  - If no snapshot, verify graceful handling (no errors)

- [ ] **Notes Incorporation**:
  - Add text to "Additional Notes" textarea
  - Click "Log Coaching"
  - Verify notes appear in prompt textarea in a natural way

---

## 📊 Expected Prompt Structure (Example)

```
Write a professional but personable coaching email for John Smith.

Start with this tone: John Smith has some great wins this period, and a couple of areas to focus on.

**ACKNOWLEDGE SUCCESSES:**
- John Smith is excelling in Schedule Adherence (92.5, 99% of target).
- John Smith shows great strength in Overall Experience (82.0, 96% of target).

**AREAS TO DEVELOP:**
- There's an opportunity to strengthen First Call Resolution. Currently at 75.0 (85% of target, 15% gap).
  💡 Tip: Focus on identifying root cause before transferring...

- We can work together to boost Transfer Rate. Currently at 8.0 (160% of target, 60% above).
  💡 Tip: Monitor calls for opportunities to handle issues...

**SENTIMENT COACHING DATA** (2026-02-15 to 2026-02-20):
[Sentiment coaching text...]

Here are the positive words you're using most:
- "I can help you with that" (used 8 times)
- "happy to assist" (used 6 times)

More solution-focused alternatives:
- "that won't work" (12 times) → "here is a viable solution"
- "problem is" (9 times) → "the positive approach"

I believe you've got this. Let's make next period even stronger.
```

---

## 🐛 Troubleshooting

### Modal doesn't appear
- Check browser console (F12) for JavaScript errors
- Verify employee selected and period selected (buttons should be enabled)
- If period/employee dropdowns were empty, reload page and re-select data
- Check that uploaded data exists (use Debug panel to verify)

### Prompt textarea is empty
- Check that buildTrendCoachingPrompt function ran without errors
- Open console and check for any function call errors
- Verify allMetrics is being passed to the function

### Copy button doesn't work
- Check that document.execCommand('copy') is supported in your browser
- Try using keyboard shortcut (Ctrl+A then Ctrl+C) instead
- Check browser console for clipboard access errors

### Sentiment data doesn't show in prompt
- Go to Manage Data → Sentiment Database
- Verify you have a sentiment snapshot saved
- Check that snapshot date range overlaps with selected metric trends period
- Verify positive/negative/emotions phrases are in the database

---

## ✅ Final Checklist

After running all tests above, verify:

- [ ] Modal displays with all new elements
- [ ] Prompt textarea shows formatted content
- [ ] Copy button copies to clipboard
- [ ] Log Coaching button logs and handles notes
- [ ] Prompts vary each time (randomization works)
- [ ] Sentiment data integrates correctly
- [ ] No console errors during flow
- [ ] All buttons are responsive
- [ ] Mobile responsive (if applicable)

## 🎉 Success Criteria

**PASS**: All checkboxes ✅ and no critical console errors

**PARTIAL PASS**: Most features work, minor issues (e.g., styling)

**FAIL**: Prompt doesn't show, buttons don't work, or critical errors

---

## 🚀 Next Steps After Testing

1. If PASS: Ready for deployment ✅
2. If PARTIAL: Fix minor issues and re-test
3. If FAIL: Check console errors, verify code, debug

See `final-smoke-test.js` in browser console for automated validation.
