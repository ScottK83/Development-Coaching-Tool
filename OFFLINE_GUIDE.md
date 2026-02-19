# Running the Development Coaching Tool Offline

The app is now **fully offline-capable** except for the optional Copilot integration. All data, trends, and analysis work completely offline using browser localStorage.

## ✅ What Works Offline

- **Upload & Manage Data**: Paste PowerBI data, import/export via CSV
- **Generate Trends**: Create metric trend emails from historical data
- **Coaching Analysis**: View individual and team performance, red flag coaching
- **PTO Tracking**: Log and track PTO usage
- **All Computations**: Trends, percentages, sentiment analysis run locally
- **Data Persistence**: All data stored in browser localStorage (survives restarts)

## 📋 How to Run Offline

### Option 1: Open index.html Directly (Easiest)

Simply double-click `index.html` to open it in your browser. The app will load and work fully offline.

**Note**: Some browsers may block the `tips.csv` fetch when opened via `file://`. This app now **embeds tips directly** in the code, so it works everywhere.

### Option 2: Local Web Server (Recommended)

This ensures maximum compatibility and features.

#### Using Python (Built-in on Windows)

```powershell
cd C:\Users\Scott\Development-Coaching-Tool
python -m http.server 8000
# Then open: http://localhost:8000
```

#### Using Node.js (if installed)

```powershell
npx http-server
```

#### Using Live Server Extension (VS Code)

Right-click `index.html` → "Open with Live Server"

## 🔌 Copilot Integration (Requires Internet)

The app can help draft emails with **Copilot** when you have internet. This feature works in three ways.

### 1. Normal Mode (Internet Required)

- Click any "Open CoPilot" button
- Browser opens `copilot.microsoft.com` with your prompt pre-filled
- Copilot generates the email draft
- Copy and use the result

### 2. Offline Fallback Mode

If you don't have internet or popup is blocked:

- Prompt automatically copies to clipboard
- You see a dialog with instructions
- Go to <https://copilot.microsoft.com> (on another device/when online)
- Paste the prompt and generate the draft

### 3. Manual Copilot Mode

If neither flow works, the app shows the full prompt in a text box:

- Copy the prompt text
- Visit <https://copilot.microsoft.com>
- Paste and generate
- Bring the result back

## 📊 Data Storage

All data is stored in **browser localStorage** (no server needed):

- Weekly performance data
- PTO records
- Custom tips and metrics
- Employee preferred names
- Coaching history

**Storage limit**: ~5 MB per domain. The app warns you when approaching capacity.

**Backup**: Export your data regularly using the `📥 Export Data` button in Manage Data.

## 🔒 Privacy & Security

✅ **No internet connection required** for core functionality  
✅ **Data never leaves your browser** (no server uploads)  
✅ **Content Security Policy** restricts external resource loading  
✅ **All third-party libraries** (Chart.js, XLSX, html2canvas) run locally

## 🚀 Quick Start (Offline)

1. Open `index.html` in your browser.
2. Paste PowerBI data into the Upload New Data box.
3. Select a date range and click Load Data.
4. View metrics in **Coaching & Analysis**.
5. Generate trends, manage data, and track PTO.
6. Export data regularly as backup.

## ⚙️ Advanced Customization

### Add Custom Coaching Tips

Go to **Manage Data** → **Manage Coaching Tips** and add your own.

### Add Custom Metrics

Add metrics with custom names and weightings for your KPIs.

### Enable Debug Mode

In `script.js`, set `const DEBUG = true;` to see console logs for troubleshooting.

## 📱 Running on Multiple Devices

Each device stores data separately in localStorage. To share data:

1. On Device A, go to **Manage Data** → `📥 Export Data` and save the file.
2. Move the file to Device B.
3. On Device B, import or paste the data and load it.

## 🆘 Troubleshooting

**Q: I see "No data available"**  
A: Upload data first, then retry the workflow.

**Q: Copilot button doesn't work**  
A: You need internet for direct open, or use the copied prompt fallback.

**Q: Storage full warning**  
A: Export old data and delete weeks you no longer need.

**Q: Tips not loading**  
A: Tips are embedded in the app. Clear browser cache and refresh if needed.

## 📝 Notes

- All dates use `MM/DD/YYYY` format.
- Trends require multiple periods for better comparisons.
- Sentiment analysis uses keyword matching (not AI inference).
- Exports can be re-imported for backup and transfer.

Enjoy your offline-first coaching tool! 🎯
