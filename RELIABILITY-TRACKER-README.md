# 🎯 Reliability Tracker - Complete System Documentation

**Status:** ✅ COMPLETE & READY TO DEPLOY

**Last Updated:** January 13, 2026

---

## 📋 System Overview

The **Reliability Tracker** is a dual-interface system for managing associate attendance and PTOST (Protected Time Off-Site/Time) usage. It integrates into your existing Development Coaching Tool ecosystem while operating as a standalone module.

### Key Features:
- ✅ Smart time calculation (departure time → automatic hour calculation with lunch deduction)
- ✅ PTOST balance tracking (40 hours/year, resets first pay period of following year)
- ✅ Reliability hours calculation (unplanned time not covered by PTOST)
- ✅ Supervisor team management and oversight
- ✅ Associate personal tracking and visibility
- ✅ Email communication logging
- ✅ Complete audit trail
- ✅ Backup/restore functionality
- ✅ localStorage-based persistence (no backend required)

---

## 📁 File Structure

```
Development-Coaching-Tool/
├── CORE APPLICATION FILES
│   ├── homepage.html (Updated with new navigation)
│   ├── homepage-styles.css (Updated with new button styles)
│   ├── index.html (Development Coaching Tool - unchanged)
│   └── pto-tracker.html (Original PTO tool - archived)
│
├── RELIABILITY TRACKER - SHARED LAYER
│   ├── reliability-services.js (Core business logic)
│   │   ├── LeaveCalculationService
│   │   ├── PTOSTService
│   │   ├── ReliabilityAnalysisService
│   │   ├── ValidationService
│   │   └── ReliabilityUtils
│   │
│   ├── reliability-data.js (Data persistence layer)
│   │   ├── ReliabilityDataService (localStorage wrapper)
│   │   └── STORAGE_KEYS (all storage keys)
│   │
│   └── reliability-styles.css (Shared styling)
│
├── RELIABILITY TRACKER - SUPERVISOR INTERFACE
│   ├── supervisor-reliability.html
│   └── supervisor-reliability.js
│
└── RELIABILITY TRACKER - ASSOCIATE INTERFACE
    ├── associate-reliability.html
    └── associate-reliability.js
```

---

## 🚀 Quick Start

### For Supervisors:
1. Navigate to **[supervisor-reliability.html](supervisor-reliability.html)**
2. Select your name from dropdown
3. Select a team member
4. View/manage their leave entries and PTOST balance
5. Send emails to employees about PTOST usage

### For Associates:
1. Navigate to **[associate-reliability.html](associate-reliability.html)**
2. Select your name from dropdown
3. View your PTOST balance
4. See your leave history
5. Understand your reliability hours

### From Homepage:
All tools are accessible via [homepage.html](homepage.html) with clear navigation buttons.

---

## 🔧 Core Services Architecture

### LeaveCalculationService
**Handles all time-based calculations**

```javascript
calculateMinutesMissed(departureTime, scheduledEndTime, lunchMinutes, lunchStartTime)
// Smartly calculates hours missed, accounting for lunch breaks

getTotalMinutes(entries, filters)
// Aggregate minutes based on filters

getMinutesBreakdown(entries, employeeName, startDate, endDate)
// Returns: { totalMissed, planned, unplanned, ptostUsed, reliabilityMinutes }
```

### PTOSTService
**Manages 40-hour PTOST balance**

```javascript
getCurrentBalance(employeeName, entries, year)
// Returns: { year, threshold, used, remaining, isExhausted, resetDate, percentUsed }

canApplyPTOST(employeeName, minutesToApply, entries)
// Validates if sufficient PTOST exists

generateWarningFlags(balance)
// Creates warning alerts at 75%, 90%, 100%
```

### ReliabilityAnalysisService
**Calculates reliability metrics**

```javascript
calculateReliabilityHours(employeeName, entries, startDate, endDate)
// Returns reliability hours (unplanned - PTOST)

generateReliabilityFlags(reliabilityHours, threshold)
// Creates severity-based flags
```

---

## 💾 Data Model

### Employees
```javascript
{
  fullName: string,
  email: string,
  supervisorName: string,
  hireDate: date,
  isActive: boolean,
  createdAt: timestamp
}
```

### Leave Entries
```javascript
{
  entryId: string (unique),
  employeeName: string,
  leaveDate: date,
  departureTime: time | null,
  scheduledEndTime: time | null,
  minutesMissed: number (calculated),
  leaveType: 'Planned' | 'Unplanned',
  ptostApplied: boolean,
  reason: string,
  supervisorNotes: string,
  createdBy: string,
  createdAt: timestamp,
  lastModifiedBy: string,
  lastModifiedAt: timestamp,
  isDeleted: boolean (soft delete)
}
```

### PTOST Balance
```javascript
{
  balanceId: string,
  employeeName: string,
  calendarYear: number,
  thresholdMinutes: 2400 (40 hours),
  usedMinutes: number (computed),
  remainingMinutes: number (computed),
  isExhausted: boolean,
  lastCalculatedAt: timestamp
}
```

### Storage Keys
- `reliability_employees` - Employee records
- `reliability_leaveEntries` - All leave entries
- `reliability_schedules` - Employee schedules (start/end times, lunch)
- `reliability_emailLog` - Sent emails and responses
- `reliability_auditLog` - Complete action history
- `reliability_supervisorTeams` - Supervisor → Employee mappings

---

## 🎯 Key Calculations

### Example: Smart Time Calculation
**Supervisor enters:**
- Departure: 12:06 PM
- Scheduled end: 5:00 PM
- Lunch: 30 minutes (12:00-12:30)

**System calculates:**
```
Raw time missed: 5:00 PM - 12:06 PM = 4 hours 54 minutes
Lunch deduction: 30 minutes (falls within window)
Actual minutes missed: 4:54 - 0:30 = 4:24 = 264 minutes = 4.4 hours
```

### Example: Reliability Calculation
**Monthly breakdown:**
- Planned leave: 8 hours (approved in advance)
- Unplanned leave: 12 hours (called out sick, emergency)
- PTOST applied: 8 hours
- **Reliability hours: 12 - 8 = 4 hours** ← This is tracked!

---

## 🔐 Security & Privacy Notes

### Data Storage
- All data stored in browser's localStorage
- No server/cloud transmission
- Data persists across browser sessions
- Can be manually backed up/restored as JSON

### Offline First
- Works completely offline
- No internet connection required
- No external API calls

### Honor System
- Employee selection is dropdown-based (no login)
- Supervisor selection is dropdown-based
- Designed for trusted internal use only
- Not suitable for public or untrusted environments

---

## 🧪 Testing the System

### Sample Data
System initializes with sample data on first load:
- **Jane Manager** (supervisor)
- **John Doe, Jane Smith, Bob Johnson** (employees)

### Test Workflow
1. Open [supervisor-reliability.html](supervisor-reliability.html)
2. Select "Jane Manager"
3. Select "John Doe"
4. Add a leave entry:
   - Date: Today
   - Left at: 12:06 PM
   - Scheduled end: 5:00 PM
   - Type: Unplanned
5. Toggle PTOST checkbox
6. Check PTOST balance updates
7. View leave history table
8. Open [associate-reliability.html](associate-reliability.html)
9. Select "John Doe"
10. See personal view with reliability summary

---

## 📊 Feature Breakdown

### Supervisor Dashboard
- ✅ Team overview with statistics
- ✅ Employee selection and management
- ✅ Add leave entries with smart time calculation
- ✅ Real-time PTOST balance display
- ✅ Reliability summary with color-coded alerts
- ✅ Leave history table with sortable data
- ✅ PTOST retroactive toggle on any entry
- ✅ Email composition with templates
- ✅ Email history log
- ✅ Period filtering (week/month/YTD/custom)
- ✅ Add new team members
- ✅ Data backup/restore
- ✅ Complete audit trail

### Associate Dashboard
- ✅ Personal PTOST balance display
- ✅ Visual gauge showing usage
- ✅ Leave history (read-only)
- ✅ Reliability hours summary
- ✅ Educational content about PTOST
- ✅ Monthly PTOST breakdown
- ✅ Message history from supervisor
- ✅ Period filtering for history
- ✅ Privacy notice

---

## 🔄 Workflow Examples

### Scenario 1: Employee Calls Out Sick
1. Supervisor receives call from "John Doe" - he's sick
2. Supervisor opens Supervisor Dashboard
3. Selects John Doe
4. Clicks "Add Leave Entry"
5. Enters today's date, left at 7:00 AM (right at start)
6. Checks "Apply PTOST" ✓
7. Saves entry
8. PTOST balance updates: 40h → 32h
9. Reliability hours: 0h (covered by PTOST)

### Scenario 2: Multiple Unplanned Absences
1. John has been calling out frequently
2. Supervisor checks team overview → "John Doe - 16h Reliability Hours ⚠️"
3. Clicks to view John's details
4. Sees reliability has 16h unplanned, unprotected time
5. Clicks "Email Employee"
6. Selects template "Attendance Discussion"
7. Sends email suggesting conversation
8. Email is logged in system
9. John can see message in his personal dashboard

### Scenario 3: PTOST Balance Low
1. John's PTOST balance is now 5h remaining
2. He calls out again (8 hours needed)
3. Supervisor tries to apply PTOST
4. System shows warning: "Only 5h available"
5. Supervisor either:
   - Applies partial PTOST (5h)
   - Creates entry without PTOST (3h becomes reliability)
6. Either way, it's logged and tracked

---

## 🛠️ Maintenance

### Backup Data
1. Open Supervisor Dashboard → Manage Data
2. Click "Backup Data"
3. JSON file downloads with all data
4. Keep multiple backups

### Restore Data
1. Open Supervisor Dashboard → Manage Data
2. Click "Restore Data"
3. Select backed-up JSON file
4. Confirm import

### Clear All Data
1. Open Supervisor Dashboard → Manage Data
2. Click "Delete All Data"
3. Confirm twice (this is destructive!)
4. All data permanently deleted

---

## 📱 Browser Compatibility

- ✅ Chrome/Chromium (recommended)
- ✅ Firefox
- ✅ Safari
- ✅ Edge
- ✅ Mobile browsers (responsive design)

---

## 🚀 Deployment

### No Backend Required
- Just copy all files to your web server
- No database needed
- No API setup required
- Works on local file system or any web host

### Deployment Options
1. **Local machine:** Open HTML files directly in browser
2. **Network share:** Place on shared drive, open via file path
3. **Web server:** Upload to any HTTP/HTTPS server
4. **Intranet:** Host internally within organization

---

## 📞 Support & Questions

For issues or questions about:
- **Calculations:** See LeaveCalculationService in reliability-services.js
- **PTOST rules:** See PTOSTService in reliability-services.js
- **Data flow:** See ReliabilityDataService in reliability-data.js
- **UI issues:** Check reliability-styles.css

---

## 🎓 Training Users

### For Supervisors
1. Show how to select themselves and team members
2. Demo adding a leave entry with smart time calculation
3. Show PTOST balance display and what the numbers mean
4. Demonstrate email templates
5. Show data backup workflow
6. Explain reliability hours concept

### For Associates
1. Show how to view personal dashboard
2. Explain PTOST balance and what percentage means
3. Show leave history
4. Educate on reliability hours (click "Learn About PTOST" tab)
5. Show how to view supervisor messages

---

## ✅ Verification Checklist

- [x] All files created and in correct locations
- [x] Services layer implements all calculations correctly
- [x] Data layer persists to localStorage
- [x] Supervisor dashboard fully functional
- [x] Associate dashboard fully functional
- [x] CSS styling matches existing tool design
- [x] Homepage updated with navigation
- [x] Sample data initializes correctly
- [x] All buttons and forms working
- [x] Responsive design implemented
- [x] Ready for production use

---

**System Status:** 🟢 PRODUCTION READY

All files are deployed and functional. The system is ready for immediate use!
