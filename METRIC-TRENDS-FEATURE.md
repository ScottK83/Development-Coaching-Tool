# Metric Trend Email Generator - Feature Documentation

## Overview
The **Metric Trend Email Generator** allows supervisors to create personalized performance trend emails for their associates by comparing individual metrics against call center averages and week-over-week performance.

---

## Features

### 1. Call Center Averages Management
Store and manage call center averages for each reporting period to provide meaningful comparisons.

**Supported Metrics:**
- Schedule Adherence (%)
- CX Rep Overall FCR (%)
- Overall Experience (%)
- Transfers (%)
- Sentiment Score (%)
- Positive Word Usage (%)
- Avoiding Negative Words (%)
- Managing Emotions (%)
- Average Handle Time (seconds)
- After Call Work (seconds)
- Hold Time (seconds)
- Reliability (%)

**How to Use:**
1. Navigate to **📈 Metric Trends** tab
2. Select a period from the dropdown
3. Enter call center average values for available metrics
4. Click **💾 Save Averages**
5. Values are stored in localStorage and persist across sessions

**Note:** If a period already has saved averages, they will auto-populate when you select that period.

---

### 2. Trend Email Generation
Generate a comprehensive email summarizing an associate's performance with contextual comparisons.

**Email Includes:**
- **Subject Line:** `Metric Trend Summary – [Employee Name] – Week of [Date]`
- **Greeting:** Uses employee nickname if set, otherwise first name
- **Metrics Breakdown:** Each metric shows:
  - Current value
  - Center average (if available)
  - Comparison icon vs center average
  - Week-over-Week (WoW) comparison (if previous week exists)
  - WoW delta (±change)
- **Highlights Section:** Auto-generated list of metrics meeting/exceeding targets or showing improvement
- **Watch Areas Section:** Auto-generated list of metrics below center average
- **Closing:** Professional sign-off

**How to Use:**
1. Ensure call center averages are saved for the target period
2. Select an employee from the dropdown
3. Select the period to analyze
4. Click **📈 Generate Trend Email**
5. Review the email preview
6. Click **📋 Copy Email** to copy to clipboard

---

## Comparison Logic

### Icon System
- **✅** Meets or exceeds center average
- **🔻** Below center average (needs attention)
- **🔺** Improved Week-over-Week
- **❌** Declined Week-over-Week
- **➖** No change OR no previous data (Baseline Week)

### Metric Direction Rules
- **Lower is Better:** AHT, ACW, Hold Time, Transfers
  - Employee value ≤ Center average = ✅
  - Decrease WoW = 🔺 (improvement)
  - Increase WoW = ❌ (decline)

- **Higher is Better:** Schedule Adherence, FCR, Overall Experience, Sentiment, Positive Word, Avoiding Negative Words, Managing Emotions, Reliability
  - Employee value ≥ Center average = ✅
  - Increase WoW = 🔺 (improvement)
  - Decrease WoW = ❌ (decline)

### Baseline Week
If no previous week data exists for an employee, WoW comparisons show **➖ (Baseline Week)** instead of a trend icon.

---

## Data Storage

### localStorage Keys
- **`callCenterAverages`**: Object storing center averages by week_key
  ```json
  {
    "2024-01-01": {
      "adherence": 95.5,
      "fcr": 85.0,
      "overallExperience": 90.0,
      "transfers": 8.5,
      "sentiment": 85.0,
      "positiveWord": 78.0,
      "negativeWord": 12.0,
      "managingEmotions": 88.0,
      "aht": 450,
      "acw": 120,
      "holdTime": 45,
      "reliability": 92.0
    }
  }
  ```

### Persistence
- All averages are saved to localStorage
- Data persists across sessions
- No automatic reset or expiration
- Can be overwritten by saving new values for the same period

---

## Example Email Output

```
Subject: Metric Trend Summary – John Smith – Week of 2024-01-08

Hi John,

Here's your performance summary for the week of 2024-01-08.

📊 Your Metrics:

• Schedule Adherence: 97% | Center Avg: 95.5% ✅ | WoW: 🔺 (+2%)
• CX Rep Overall FCR: 87% | Center Avg: 85% ✅ | WoW: 🔺 (+2%)
• Overall Experience: 92% | Center Avg: 90% ✅ | WoW: 🔺 (+2%)
• Transfers: 7% | Center Avg: 8.5% ✅ | WoW: 🔺 (-1.5%)
• Sentiment Score: 88% | Center Avg: 85% ✅ | WoW: 🔺 (+3%)
• Positive Word Usage: 82% | Center Avg: 78% ✅ | WoW: ➖ (+0%)
• Avoiding Negative Words: 90% | Center Avg: 88% ✅ | WoW: 🔺 (+2%)
• Managing Emotions: 90% | Center Avg: 88% ✅ | WoW: 🔺 (+5%)
• Average Handle Time: 430s | Center Avg: 450s ✅ | WoW: 🔺 (-15s)
• After Call Work: 135s | Center Avg: 120s 🔻 | WoW: ❌ (+10s)
• Hold Time: 42s | Center Avg: 45s ✅ | WoW: 🔺 (-3s)
• Reliability: 94% | Center Avg: 92% ✅ | WoW: 🔺 (+2%)

✨ Highlights:
• Schedule Adherence ✅
• Average Handle Time ✅
• Sentiment Score ✅
• Positive Word Usage ✅
• Negative Word Usage ✅
• Managing Emotions ✅
• Schedule Adherence improved WoW 🔺
• Average Handle Time improved WoW 🔺
• Sentiment Score improved WoW 🔺
• Negative Word Usage improved WoW 🔺
• Managing Emotions improved WoW 🔺

⚠️ Watch Areas:
• After Call Work 🔻

Let me know if you have any questions or want to discuss these results.

Best,
[Your Name]
```

---

## UI Components

### Navigation
- **Button:** 📈 Metric Trends (purple theme #9c27b0)
- Located in main navigation bar

### Section Layout
1. **Call Center Averages Panel** (left column)
   - Period selector
   - 7 metric input fields
   - Save button

2. **Generate Trend Email Panel** (right column)
   - Employee selector
   - Period selector
   - Generate button
   - Email preview container (hidden until email generated)
   - Copy to clipboard button

---

## Code Structure

### Key Functions

**Data Management:**
- `loadCallCenterAverages()`: Load averages from localStorage
- `saveCallCenterAverages()`: Save averages to localStorage
- `getCallCenterAverageForPeriod(weekKey)`: Get averages for specific period
- `setCallCenterAverageForPeriod(weekKey, averages)`: Set averages for specific period

**Initialization:**
- `initializeMetricTrends()`: Main initialization function called when tab opens
- `populatePeriodDropdowns()`: Populate both period selectors with available weeks
- `populateEmployeeDropdown()`: Populate employee selector with all unique employees
- `loadExistingAverages()`: Set up listener to auto-load saved averages when period selected
- `setupMetricTrendsListeners()`: Attach event listeners to buttons

**Email Generation:**
- `generateTrendEmail()`: Main function to build email content
- `compareToCenter(employeeValue, centerValue, lowerIsBetter)`: Compare vs center average
- `compareWeekOverWeek(currentValue, previousValue, lowerIsBetter)`: Compare WoW performance

### Files Modified
- **script.js**: Lines ~2650-2950 (300+ lines of new code)
- **index.html**: Lines 23 (nav button), 281-370 (UI section)

---

## Integration Points

### With Existing Features
- **Weekly Data Upload:** Automatically populates period/employee dropdowns when data exists
- **Employee Nicknames:** Uses stored nicknames in email greeting
- **Toast Notifications:** Shows success/error messages for all actions
- **Tab Navigation:** Integrates with existing tab system and initialization logic

### With Copilot (Future Enhancement)
The email preview can optionally be copied into Microsoft Copilot for:
- Tone refinement
- Additional context/personalization
- Action item suggestions
- Follow-up recommendations

---

## Error Handling

### Validation Checks
- ✅ Period selected before saving averages
- ✅ At least one metric value entered before saving
- ✅ Employee and period selected before generating email
- ✅ Employee data exists in selected period
- ✅ Center averages exist before comparison (gracefully skips if missing)
- ✅ Previous week data exists before WoW comparison (shows "Baseline Week" if missing)

### User Feedback
- Toast notifications for all actions (success/error)
- Clear error messages explaining what's missing
- Auto-show preview panel when email generated
- Disable copy button until email generated

---

## Testing Checklist

### Basic Functionality
- [ ] Navigate to Metric Trends tab
- [ ] Period dropdowns populate with uploaded weeks
- [ ] Employee dropdown populates with all unique names
- [ ] Can save call center averages
- [ ] Saved averages reload when period re-selected
- [ ] Can generate email with all comparisons
- [ ] Email preview displays correctly
- [ ] Can copy email to clipboard

### Edge Cases
- [ ] Generate email for first week (no previous week) - should show "Baseline Week"
- [ ] Generate email without center averages saved - should skip center comparison
- [ ] Generate email with partial center averages - should only compare available metrics
- [ ] Employee missing certain metrics - should skip those metrics entirely
- [ ] Save averages with only some fields filled - should save only entered values
- [ ] Refresh page and verify averages persist

### Comparison Logic
- [ ] AHT: Lower value gets ✅ vs center, decrease gets 🔺 WoW
- [ ] ACW: Lower value gets ✅ vs center, decrease gets 🔺 WoW
- [ ] All others: Higher value gets ✅ vs center, increase gets 🔺 WoW
- [ ] No change WoW shows ➖
- [ ] Highlights section only shows positive indicators
- [ ] Watch areas section only shows negative indicators

---

## Future Enhancements (Not Implemented)

### Potential Additions
1. **Bulk Email Generation**: Generate emails for all employees in a period
2. **Email Templates**: Allow customization of email format/tone
3. **Historical Trend Charts**: Visualize metric trends over multiple weeks
4. **Goal Tracking**: Set individual goals and track progress
5. **Automatic Insights**: AI-generated observations about trends
6. **Export to PDF**: Generate printable performance reports
7. **Center Average Auto-Calculation**: Calculate center averages from uploaded data
8. **Comparison Periods**: Allow comparing to arbitrary past periods (not just previous week)

---

## Troubleshooting

### Email Not Generating
- **Check:** Did you upload weekly data?
- **Check:** Does the employee exist in the selected period?
- **Solution:** Upload data first, then ensure employee appears in dropdown

### No WoW Comparison
- **Cause:** This is the first week of data for this employee
- **Expected Behavior:** Shows "➖ (Baseline Week)"
- **Solution:** Upload previous week's data to enable WoW comparisons

### Center Average Not Showing
- **Cause:** No center averages saved for this period
- **Solution:** Save center averages for the period first
- **Note:** Email will still generate without center averages, but won't show those comparisons

### Copy Button Not Working
- **Check:** Did you generate an email first?
- **Check:** Is your browser blocking clipboard access?
- **Solution:** Generate email, ensure browser permissions allow clipboard access

---

## Security & Privacy

### Data Storage
- All data stored locally in browser localStorage
- No external transmission of performance data
- No backend server or database
- No cross-device synchronization

### Limitations
- Data only available on device where entered
- Clearing browser data will delete all saved information
- No user authentication or access control
- No audit trail of who viewed/generated emails

---

## Deployment Notes

### Cloudflare Pages
- Feature fully client-side, no backend changes needed
- Auto-deploys with git push to main branch
- No additional dependencies or libraries required
- Works offline after initial page load (localStorage only)

### Browser Compatibility
- Requires modern browser with ES6+ support
- Tested in Chrome, Edge, Firefox
- Requires localStorage support
- Requires clipboard API for copy functionality

---

## Maintenance

### Regular Tasks
None required - feature is fully self-contained

### Data Cleanup
Users must manually manage their own data:
- Delete old weeks via Manage Data tab (affects all features)
- Clear localStorage to reset all data (nuclear option)

### Updates
Future updates to metric list require changes in 3 places:
1. HTML input fields (index.html)
2. metricsToAnalyze array (script.js)
3. averages object keys (script.js)

---

## Questions?

This feature is designed to save supervisors time by automating the creation of personalized, data-driven performance emails. The comparison logic ensures that feedback is contextual (vs peers) and trend-focused (vs past performance), making conversations more objective and actionable.

For issues or feature requests, contact the development team or update this documentation with new learnings!
