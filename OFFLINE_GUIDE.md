# Running the Development Coaching Tool Offline

The app is now **fully offline-capable** except for the optional Copilot integration. All data, trends, and analysis work completely offline using browser localStorage.

## ✅ What Works Offline

- **Upload & Manage Data**: Paste PowerBI data, import/export via CSV
- **Generate Trends**: Create metric trend emails from historical data
- **Coaching Analysis**: View individual & team performance, red flag coaching
- **PTO Tracking**: Log and track PTO usage
- **All Computations**: Trends, percentages, sentiment analysis run locally
- **Data Persistence**: All data stored in browser localStorage (survives restarts)

## 📋 How to Run Offline

### Option 1: Open index.html Directly (Easiest)
Simply double-click `index.html` to open it in your browser. The app will load and work fully offline.

**Note**: Some browsers may block the tips.csv fetch when opened via `file://`. This app now **embeds tips directly** in the code, so it works everywhere.

### Option 2: Local Web Server (Recommended)
This ensures maximum compatibility and features:

#### Using Python (Built-in on Windows):
```powershell
cd C:\Users\Scott\OneDrive\Desktop\Development-Coaching-Tool
python -m http.server 8000
# Then open: http://localhost:8000
```

#### Using Node.js (if installed):
```powershell
npx http-server
```

#### Using Live Server Extension (VS Code):
Right-click `index.html` → "Open with Live Server"

## 🔌 Copilot Integration (Requires Internet)

The app can help draft emails with **Copilot** when you have internet. This feature works in two ways:

### 1. **Normal Mode** (Internet Required)
- Click any "Open CoPilot" button
- Browser opens copilot.microsoft.com with your prompt pre-filled
- CoPilot generates the email draft
- Copy & use the result

### 2. **Offline Fallback Mode**
If you don't have internet or popup is blocked:
- Prompt automatically copies to clipboard
- You'll see a dialog with instructions
- Go to https://copilot.microsoft.com (on another device/when online)
- Paste the prompt and let CoPilot generate the email

### 3. **Manual Copilot Mode**
Can't use either? The app shows a text box with the full prompt:
- Copy the prompt text
- Visit copilot.microsoft.com
- Paste and generate
- Bring the result back

## 📊 Data Storage

All data is stored in **browser localStorage** (no server needed):
- Weekly performance data
- PTO records
- Custom tips & metrics
- Employee preferred names
- Coaching history

**Storage Limit**: ~5 MB per domain. The app warns you when approaching capacity.

**Backup**: Export your data regularly using "📥 Export Data" button in Manage Data section.

## 🔒 Privacy & Security

✅ **No internet connection required** for any core functionality  
✅ **Data never leaves your browser** (no server uploads)  
✅ **Content Security Policy** restricts external resource loading  
✅ **All 3rd party libraries** (Chart.js, XLSX, html2canvas) run locally  

## 🚀 Quick Start (Offline)

1. Open `index.html` in your browser
2. Paste PowerBI data into the "Upload New Data" box
3. Select a date range and click "Load Data"
4. View metrics in "Coaching & Analysis" section
5. Generate trends, manage data, and track PTO
6. Export data regularly to backup

## ⚙️ Advanced Customization

### Add Custom Coaching Tips
Go to "Manage Data" → scroll to "Manage Coaching Tips" section → add your own

### Add Custom Metrics
Add metrics with custom names and weightings for your unique KPIs

### Enable Debug Mode
In `script.js`, set `const DEBUG = true;` (line 39) to see console logs for troubleshooting

## 📱 Running on Multiple Devices

Each device stores data separately in localStorage. To share data:
1. On Device A: "Manage Data" → "📥 Export Data" → save CSV
2. Email the file or copy to Device B
3. On Device B: "Upload Data" → paste the CSV content → "Load Data"

## 🆘 Troubleshooting

**Q: I see "No data available"**  
A: Make sure you've uploaded data first. Paste PowerBI data and click "Load Data".

**Q: Copilot button doesn't work**  
A: You either need internet, or the prompt will copy to clipboard. See Copilot section above.

**Q: Storage full warning**  
A: Export old data and delete weeks you don't need. Use "Manage Data" → delete old weeks.

**Q: Tips not loading**  
A: Tips are now embedded in the app. If you see errors, clear browser cache and refresh.

## 📝 Notes

- All dates use MM/DD/YYYY format
- Trends require data from multiple weeks for accurate comparisons
- Sentiment analysis uses keyword matching, not AI
- CSV exports can be reimported for data backup/transfer

Enjoy your offline-first coaching tool! 🎯
