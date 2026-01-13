# 📋 SharePoint Deployment Guide
## Reliability Tracker - Multi-User SharePoint Integration

**Last Updated:** January 13, 2026

---

## 🎯 Overview

This guide walks you through deploying the Reliability Tracker to SharePoint with full multi-user support. Supervisors will manage their team's data, and associates will view their own attendance records.

### **What You'll Get:**
✅ Centralized data storage in SharePoint Lists  
✅ Multi-user access (supervisors and associates)  
✅ Data persists across devices and browsers  
✅ Automatic audit trail and backup  
✅ Works offline when SharePoint is synced  
✅ No external hosting or database needed  

---

## 📦 Step 1: Create SharePoint Lists

You need to create **6 SharePoint Lists** on your site. Use these exact names and columns:

### **List 1: ReliabilityEmployees**
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| Title | Single line of text | Yes | Employee name |
| Email | Single line of text | No | Employee email |
| HireDate | Date | No | Hire date |
| Supervisor | Single line of text | No | Supervisor name |
| IsActive | Yes/No | No | Default: Yes |

### **List 2: ReliabilityLeaveEntries**
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

### **List 3: ReliabilitySchedules**
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| EmployeeName | Single line of text | Yes | Employee name |
| ShiftStart | Single line of text | Yes | e.g., "08:00" |
| ShiftEnd | Single line of text | Yes | e.g., "17:00" |
| LunchDuration | Number | Yes | Minutes (e.g., 30) |
| WorkDays | Multiple lines of text | No | Comma-separated (e.g., "Monday,Tuesday") |
| InitialPTOST | Number | Yes | Starting PTOST hours (e.g., 40) |

### **List 4: ReliabilitySupervisorTeams**
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| SupervisorName | Single line of text | Yes | Supervisor's name |
| EmployeeName | Single line of text | Yes | Team member's name |

### **List 5: ReliabilityEmailLog**
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| EmployeeName | Single line of text | Yes | Recipient |
| Subject | Single line of text | Yes | Email subject |
| Body | Multiple lines of text | Yes | Email body |
| EmailType | Choice | Yes | Choices: PTOST Offer, Balance Warning, Reliability Concern, Custom |
| RelatedEntryIds | Multiple lines of text | No | Comma-separated IDs |

### **List 6: ReliabilityAuditLog**
| Column Name | Type | Required | Notes |
|------------|------|----------|-------|
| Action | Single line of text | Yes | Action performed |
| Details | Multiple lines of text | Yes | JSON details |
| Timestamp | Date and Time | Yes | When it happened |

---

## 📁 Step 2: Upload Files to SharePoint

1. **Create a Document Library** (or use an existing one like "Site Assets")
   
2. **Upload these files:**
   ```
   ├── homepage.html
   ├── homepage-styles.css
   ├── index.html (Development Coaching Tool)
   ├── script.js
   ├── styles.css
   ├── supervisor-reliability.html
   ├── supervisor-reliability.js
   ├── associate-reliability.html
   ├── associate-reliability.js
   ├── reliability-services.js
   ├── reliability-data.js (OLD - will be replaced)
   ├── sharepoint-data-service.js (NEW)
   ├── reliability-styles.css
   ├── pto-tracker.html
   ├── pto-tracker.js
   ├── pto-tracker-styles.css
   └── tips.csv
   ```

3. **Note the library URL:**  
   Example: `https://yourcompany.sharepoint.com/sites/YourSite/SiteAssets/`

---

## 🔧 Step 3: Update HTML Files

You need to update the HTML files to use `sharepoint-data-service.js` instead of `reliability-data.js`.

### **Update supervisor-reliability.html:**
Find this line:
```html
<script src="reliability-data.js"></script>
```

Replace with:
```html
<script src="sharepoint-data-service.js"></script>
```

### **Update associate-reliability.html:**
Find this line:
```html
<script src="reliability-data.js"></script>
```

Replace with:
```html
<script src="sharepoint-data-service.js"></script>
```

---

## 🔐 Step 4: Set Permissions

### **For Supervisors:**
- **Contribute** permission to all 6 lists
- **Read** access to document library

### **For Associates (Read-Only View):**
- **Read** permission to:
  - ReliabilityEmployees
  - ReliabilityLeaveEntries
  - ReliabilitySchedules
  - ReliabilityEmailLog
- **No access** to:
  - ReliabilitySupervisorTeams (sensitive)
  - ReliabilityAuditLog (sensitive)

### **Advanced: Item-Level Security**
To restrict associates to seeing only their own data:

1. Go to **List Settings** → **Advanced Settings**
2. Set **Read access** to: "Read items that were created by the user"
3. Apply to: ReliabilityLeaveEntries, ReliabilityEmailLog

---

## 🚀 Step 5: Test the Deployment

### **Test as Supervisor:**
1. Navigate to `https://yourcompany.sharepoint.com/sites/YourSite/SiteAssets/supervisor-reliability.html`
2. Select your name as supervisor
3. Add a team member
4. Add a leave entry
5. Check SharePoint lists to verify data was saved

### **Test as Associate:**
1. Navigate to `https://yourcompany.sharepoint.com/sites/YourSite/SiteAssets/associate-reliability.html`
2. Select your name
3. View your PTOST balance and leave history
4. Verify you can't see other employees' data

---

## 🔄 Step 6: Make it User-Friendly

### **Option A: SharePoint Page with Links**
Create a modern SharePoint page with buttons linking to the tools:

```html
<a href="/sites/YourSite/SiteAssets/homepage.html" class="button">🏠 Coaching Tools Home</a>
<a href="/sites/YourSite/SiteAssets/supervisor-reliability.html" class="button">📊 Supervisor Dashboard</a>
<a href="/sites/YourSite/SiteAssets/associate-reliability.html" class="button">📅 My Attendance</a>
```

### **Option B: Add to Site Navigation**
1. Go to **Site Settings** → **Navigation**
2. Add custom links to the top navigation bar

---

## 📊 Step 7: Data Migration (If Coming from localStorage)

If you have existing data in localStorage, export it first:

1. Open the **current** supervisor-reliability.html
2. Click **Manage Data** → **Backup Data**
3. Save the JSON file

Then manually add the data to SharePoint lists, or create a migration script.

---

## ⚠️ Troubleshooting

### **"Cannot read property 'formDigestValue'"**
- **Cause:** Page not loaded in SharePoint context
- **Fix:** Make sure files are accessed via SharePoint URLs, not localhost

### **"403 Forbidden" errors**
- **Cause:** Insufficient permissions
- **Fix:** Verify user has Contribute access to lists

### **Data not appearing**
- **Cause:** Wrong list names or column names
- **Fix:** Verify exact spelling and capitalization in Step 1

### **Mixed Content Warnings**
- **Cause:** Accessing HTTP resources from HTTPS SharePoint
- **Fix:** Ensure all resources use relative paths or HTTPS

---

## 🎓 Training Users

### **For Supervisors:**
1. How to add team members
2. How to log leave entries
3. How to apply PTOST retroactively
4. How to generate emails
5. How to back up data

### **For Associates:**
1. How to access their dashboard
2. How to view their PTOST balance
3. How to check leave history
4. Understanding reliability hours

---

## 📈 Next Steps

Once deployed, consider:
- **Power Automate flows** for automatic email notifications
- **Power BI reports** for executive dashboards
- **Mobile app** using PowerApps connected to same lists
- **Integration with Outlook** for calendar sync

---

## 🆘 Support

For issues or questions:
1. Check SharePoint list permissions
2. Verify column names match exactly
3. Test with browser console open (F12) to see errors
4. Review SharePoint ULS logs for server-side errors

---

**Deployment Complete!** 🎉

Your Reliability Tracker is now running on SharePoint with multi-user support and centralized data storage.
