# 📋 Complete SharePoint Deployment Guide
## Development Coaching Tool + Reliability Tracker

**Last Updated:** January 13, 2026

---

## 🎯 Overview

This guide covers deploying **BOTH** tools to SharePoint:
1. **Development Coaching Tool** - PowerBI data analysis and coaching emails
2. **Reliability Tracker** - PTOST and attendance management

### **What You'll Get:**
✅ All data in SharePoint Lists (no localStorage)  
✅ Multi-user access with proper permissions  
✅ Data persists across devices  
✅ Works offline when SharePoint synced  
✅ Integrated with Microsoft 365 ecosystem  
✅ Ready for Power BI/Power Automate integration  

---

## 📦 PART 1: Create SharePoint Lists

### **Development Coaching Tool Lists** (5 lists)

#### **List 1: CoachingWeeklyData**
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| WeekKey | Single line of text | Yes | Format: "2025-12-29\|2026-01-04" |
| EmployeesData | Multiple lines of text | Yes | JSON array of employee data |
| StartDate | Date and Time | Yes | Week start date |
| EndDate | Date and Time | Yes | Week end date |
| Label | Single line of text | No | Display label (e.g., "Week ending Jan 4, 2026") |
| PeriodType | Choice | Yes | Choices: week, month, quarter |
| UploadedAt | Date and Time | No | When data was uploaded |

#### **List 2: CoachingLogYTD**
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| EmployeeName | Single line of text | Yes | Employee name |
| CoachingDate | Date and Time | Yes | Date coached |
| Period | Single line of text | No | Period label |
| MetricsData | Multiple lines of text | Yes | JSON of metrics |
| EmailSent | Yes/No | No | Was email sent? |
| Notes | Multiple lines of text | No | Additional notes |

#### **List 3: CoachingEmployeeNicknames**
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| EmployeeName | Single line of text | Yes | Full employee name |
| Nickname | Single line of text | Yes | Preferred nickname/shortened name |

#### **List 4: CoachingTips**
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| MetricKey | Single line of text | Yes | e.g., "scheduleAdherence", "cxRepOverall" |
| Condition | Choice | Yes | Choices: below, above, default |
| TipText | Multiple lines of text | Yes | The coaching tip text |

#### **List 5: CoachingEmployees** (Optional - for employee management)
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| Title | Single line of text | Yes | Employee name |
| Email | Single line of text | No | Employee email |
| Team | Single line of text | No | Team name |
| IsActive | Yes/No | No | Default: Yes |

---

### **Reliability Tracker Lists** (6 lists)

#### **List 6: ReliabilityEmployees**
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| Title | Single line of text | Yes | Employee name |
| Email | Single line of text | No | Employee email |
| HireDate | Date | No | Hire date |
| Supervisor | Single line of text | No | Supervisor name |
| IsActive | Yes/No | No | Default: Yes |

#### **List 7: ReliabilityLeaveEntries**
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| EmployeeName | Single line of text | Yes | Employee name |
| LeaveDate | Date and Time | Yes | Date of absence |
| LeaveType | Choice | Yes | Choices: Unplanned, Planned |
| MinutesMissed | Number | Yes | Minutes missed (decimals allowed) |
| PTOSTApplied | Yes/No | No | Was PTOST applied? |
| Reason | Multiple lines of text | No | Employee's reason |
| SupervisorNotes | Multiple lines of text | No | Supervisor notes |
| IsDeleted | Yes/No | No | Default: No |
| DeletedReason | Multiple lines of text | No | Why was it deleted? |

#### **List 8: ReliabilitySchedules**
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| EmployeeName | Single line of text | Yes | Employee name |
| ShiftStart | Single line of text | Yes | e.g., "08:00" |
| ShiftEnd | Single line of text | Yes | e.g., "17:00" |
| LunchDuration | Number | Yes | Minutes (e.g., 30) |
| WorkDays | Multiple lines of text | No | Comma-separated |
| InitialPTOST | Number | Yes | Starting PTOST hours |

#### **List 9: ReliabilitySupervisorTeams**
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| SupervisorName | Single line of text | Yes | Supervisor's name |
| EmployeeName | Single line of text | Yes | Team member's name |

#### **List 10: ReliabilityEmailLog**
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| EmployeeName | Single line of text | Yes | Recipient |
| Subject | Single line of text | Yes | Email subject |
| Body | Multiple lines of text | Yes | Email body |
| EmailType | Choice | Yes | Choices: PTOST Offer, Balance Warning, Reliability Concern, Custom |
| RelatedEntryIds | Multiple lines of text | No | Comma-separated IDs |

#### **List 11: ReliabilityAuditLog**
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| Action | Single line of text | Yes | Action performed |
| Details | Multiple lines of text | Yes | JSON details |
| Timestamp | Date and Time | Yes | When it happened |

---

## 📁 PART 2: Upload Files to SharePoint

1. **Create/Use Document Library** (e.g., "Site Assets" or "Coaching Tools")

2. **Upload ALL files:**
   ```
   ├── homepage.html
   ├── homepage-styles.css
   ├── index.html
   ├── script.js
   ├── styles.css
   ├── supervisor-reliability.html
   ├── supervisor-reliability.js
   ├── associate-reliability.html
   ├── associate-reliability.js
   ├── reliability-services.js
   ├── reliability-styles.css
   ├── pto-tracker.html
   ├── pto-tracker.js
   ├── pto-tracker-styles.css
   ├── tips.csv
   ├── coaching-sharepoint-service.js (NEW)
   ├── sharepoint-data-service.js (NEW)
   ```

---

## 🔧 PART 3: Update HTML Files

### **For Development Coaching Tool (index.html):**

Add this script tag **before** `script.js`:
```html
<script src="coaching-sharepoint-service.js"></script>
```

Then modify `script.js` to use SharePoint instead of localStorage:

**Find this code near the top:**
```javascript
function loadWeeklyData() {
    const stored = localStorage.getItem('weeklyData');
    return stored ? JSON.parse(stored) : {};
}

function saveWeeklyData() {
    localStorage.setItem('weeklyData', JSON.stringify(weeklyData));
}
```

**Replace with:**
```javascript
async function loadWeeklyData() {
    if (typeof CoachingSharePointService !== 'undefined') {
        return await CoachingSharePointService.loadWeeklyData();
    }
    const stored = localStorage.getItem('weeklyData');
    return stored ? JSON.parse(stored) : {};
}

async function saveWeeklyData() {
    if (typeof CoachingSharePointService !== 'undefined') {
        await CoachingSharePointService.saveWeeklyData(weeklyData);
    } else {
        localStorage.setItem('weeklyData', JSON.stringify(weeklyData));
    }
}
```

**Do the same for coaching log functions:**
```javascript
async function loadCoachingLog() {
    if (typeof CoachingSharePointService !== 'undefined') {
        return await CoachingSharePointService.loadCoachingLog();
    }
    const stored = localStorage.getItem('coachingLogYTD');
    return stored ? JSON.parse(stored) : [];
}

async function saveCoachingLog() {
    if (typeof CoachingSharePointService !== 'undefined') {
        await CoachingSharePointService.saveCoachingLog(coachingLogYTD);
    } else {
        localStorage.setItem('coachingLogYTD', JSON.stringify(coachingLogYTD));
    }
}
```

### **For Reliability Tracker:**

**supervisor-reliability.html:**
Replace:
```html
<script src="reliability-data.js"></script>
```
With:
```html
<script src="sharepoint-data-service.js"></script>
```

**associate-reliability.html:**
Replace:
```html
<script src="reliability-data.js"></script>
```
With:
```html
<script src="sharepoint-data-service.js"></script>
```

---

## 🔐 PART 4: Set Permissions

### **For Supervisors/Managers:**
- **Contribute** to all 11 lists
- **Read** to document library

### **For Employees (Coaching data):**
- **Read only** to:
  - CoachingWeeklyData
  - CoachingTips
- **No access** to:
  - CoachingLogYTD (manager use only)
  - Employee nicknames (privacy)

### **For Associates (Reliability data):**
- **Read only** to:
  - ReliabilityEmployees
  - ReliabilityLeaveEntries (their own only - see Item-Level Security below)
  - ReliabilitySchedules
  - ReliabilityEmailLog (their own only)

### **Item-Level Security:**
1. **ReliabilityLeaveEntries** → Advanced Settings → "Read items created by user"
2. **ReliabilityEmailLog** → Advanced Settings → "Read items created by user"

---

## 🚀 PART 5: Testing

### **Test Development Coaching Tool:**
1. Navigate to `https://yoursite.sharepoint.com/sites/YourSite/SiteAssets/index.html`
2. Upload PowerBI data (paste into textbox)
3. Generate coaching email
4. Check CoachingWeeklyData list to verify data saved

### **Test Reliability Tracker (Supervisor):**
1. Navigate to `/SiteAssets/supervisor-reliability.html`
2. Select your name
3. Add team member
4. Add leave entry
5. Verify data in SharePoint lists

### **Test Reliability Tracker (Associate):**
1. Navigate to `/SiteAssets/associate-reliability.html`
2. Select your name
3. View PTOST balance and history
4. Verify you can't see others' data

---

## 🏠 PART 6: Create Homepage

Update `homepage.html` or create a SharePoint page with links:

```html
<div class="button-grid">
    <a href="/sites/YourSite/SiteAssets/index.html" class="nav-button">
        📈 Development Coaching Tool
    </a>
    
    <a href="/sites/YourSite/SiteAssets/supervisor-reliability.html" class="nav-button">
        📊 Reliability Tracker (Supervisor)
    </a>
    
    <a href="/sites/YourSite/SiteAssets/associate-reliability.html" class="nav-button">
        📅 My Reliability & Attendance
    </a>
    
    <a href="/sites/YourSite/SiteAssets/pto-tracker.html" class="nav-button">
        🗓️ PTO Tracker
    </a>
</div>
```

---

## 📊 PART 7: Power BI Integration (Optional)

Connect Power BI to SharePoint lists for executive dashboards:

1. Open Power BI Desktop
2. Get Data → SharePoint Online List
3. Enter your site URL
4. Select lists:
   - CoachingWeeklyData
   - CoachingLogYTD
   - ReliabilityLeaveEntries
5. Create visualizations
6. Publish to Power BI Service
7. Embed in SharePoint page

---

## ⚡ PART 8: Power Automate Flows (Optional)

### **Auto-notify when PTOST exhausted:**
1. Trigger: When item created in ReliabilityLeaveEntries
2. Condition: PTOSTApplied = Yes
3. Get PTOST balance
4. If balance < 5h → Send email to supervisor

### **Weekly coaching reminder:**
1. Trigger: Recurrence (every Monday)
2. Get employees without coaching this week
3. Send reminder email to manager

---

## ⚠️ Troubleshooting

### **"Cannot read formDigestValue"**
- Files must be accessed via SharePoint URLs
- Cannot test with localhost or file://

### **"403 Forbidden"**
- Check user has Contribute permissions
- Verify list names match exactly (case-sensitive)

### **Data not saving**
- Open browser console (F12)
- Look for JavaScript errors
- Verify `_spPageContextInfo` is defined

### **Async/Await issues**
- Ensure all `save` and `load` functions are marked `async`
- Use `await` when calling SharePoint functions

---

## 📋 Quick Reference: List Names

**Development Coaching Tool:**
- CoachingWeeklyData
- CoachingLogYTD
- CoachingEmployeeNicknames
- CoachingTips
- CoachingEmployees

**Reliability Tracker:**
- ReliabilityEmployees
- ReliabilityLeaveEntries
- ReliabilitySchedules
- ReliabilitySupervisorTeams
- ReliabilityEmailLog
- ReliabilityAuditLog

---

## ✅ Deployment Checklist

- [ ] 11 SharePoint Lists created with correct columns
- [ ] All files uploaded to Site Assets
- [ ] index.html updated to load coaching-sharepoint-service.js
- [ ] script.js modified to use async SharePoint functions
- [ ] supervisor-reliability.html updated to use sharepoint-data-service.js
- [ ] associate-reliability.html updated to use sharepoint-data-service.js
- [ ] Permissions set (Supervisors: Contribute, Employees: Read)
- [ ] Item-level security configured
- [ ] Homepage/navigation created
- [ ] Tested as supervisor
- [ ] Tested as associate
- [ ] Tested Development Coaching Tool

---

**🎉 Deployment Complete!**

Both tools are now running on SharePoint with centralized data storage and multi-user support.
