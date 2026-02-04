# Development Coaching Tool - Standalone Download Guide

## Security & Compliance

✅ **No external web access required**  
✅ **All files run locally in your browser**  
✅ **No data sent to any server**  
✅ **No internet connection needed** (except initial download)  
✅ **HIPAA-friendly** - All data stored in browser only  

## Download Files

All required files are available on GitHub:

**Repository**: https://github.com/ScottK83/Development-Coaching-Tool

### Option 1: Download as ZIP (Easiest)
1. Go to: https://github.com/ScottK83/Development-Coaching-Tool
2. Click green **Code** button → **Download ZIP**
3. Extract the ZIP file to your desired folder
4. Double-click `index.html` to run

### Option 2: Download Individual Files
You only need these 7 files:
- `index.html` - Main app interface
- `script.js` - All application logic
- `styles.css` - Styling
- `lib-chart.js` - Chart rendering library
- `lib-html2canvas.js` - Screenshot capability
- `lib-xlsx.js` - Excel export library
- `tips.csv` - Coaching tips database (optional - embedded in app)

Download each from: https://github.com/ScottK83/Development-Coaching-Tool/tree/main

## What Each File Does

| File | Purpose | External Access | Required |
|------|---------|-----------------|----------|
| index.html | App interface | No | Yes |
| script.js | All logic & data handling | No | Yes |
| styles.css | Visual styling | No | Yes |
| lib-chart.js | Chart.js library for graphs | No | Yes |
| lib-html2canvas.js | Convert charts to images | No | Yes |
| lib-xlsx.js | Excel file export | No | Yes |
| tips.csv | Coaching tips database | No | No* |

*Tips are now embedded in script.js, so this file is optional for backup

## Running on Your PC

### Step 1: Extract Files
- Download the ZIP file
- Extract all files to a folder (e.g., `C:\Users\YourName\Desktop\CoachingTool`)

### Step 2: Open in Browser
Double-click `index.html` - that's it! The app opens and works fully offline.

### Step 3: (Optional) Use Local Server
For best compatibility, run a local web server:

**Using Python (built-in on Windows):**
```
cd C:\Users\YourName\Desktop\CoachingTool
python -m http.server 8000
```
Then open: `http://localhost:8000`

## What You Can Do Offline

✅ Upload employee performance data  
✅ View metrics and trends  
✅ Generate coaching recommendations  
✅ Track PTO and absences  
✅ Export data to CSV  
✅ Import previous data  
✅ Manage custom metrics & tips  
✅ Create performance reports  

## Data Security

- **No account needed** - Uses browser storage only
- **No cloud upload** - Data never leaves your computer
- **No tracking** - No cookies or analytics
- **No external API calls** - All processing is local
- **Encrypted by default** - Browser storage is device-encrypted
- **Persistent storage** - Data survives browser restart
- **Backup-friendly** - Export to CSV anytime

## Copilot Feature (Optional - Requires Internet)

The app can optionally help draft emails using Microsoft Copilot, but this is:
- **Optional** - All core features work without it
- **Manual** - You control when it's used
- **Disconnected** - Not integrated into the app; you manually copy/paste

If internet is blocked at work, just skip this feature. All other functionality works perfectly offline.

## Multi-PC Access

### Home PC:
1. Run locally from index.html
2. Data stored in browser
3. Export data: "Manage Data" → "📥 Export Data"

### Work PC:
1. Download the files (same as above)
2. Import home PC data: Paste CSV into upload area
3. Work with full dataset

**Note:** Each PC has separate browser storage. Use CSV export/import to sync between locations.

## File Structure

```
CoachingTool/
├── index.html           (Main file - open this)
├── script.js            (App logic)
├── styles.css           (Styling)
├── lib-chart.js         (Chart library)
├── lib-html2canvas.js   (Screenshot library)
├── lib-xlsx.js          (Excel library)
├── tips.csv             (Coaching tips - optional)
├── README.md            (Project info)
└── OFFLINE_GUIDE.md     (Offline setup guide)
```

## Troubleshooting

**Q: I get an error opening index.html**
A: Your browser might be blocking file:// access. Use a local server instead (see "Using Local Server" above).

**Q: Can I email index.html to someone?**
A: No - you need all 6+ files together. Download the full ZIP file instead.

**Q: Is this safe to use on a company computer?**
A: Yes! No data leaves your device. No external connections. No tracking. You can show this guide to your IT/security team.

**Q: Can multiple people use the same files?**
A: Yes! Each person gets their own browser storage. Data doesn't sync between users (by design - separate privacy).

## Showing Your Boss

Print or share this document. Key points:
- ✅ All files included - no external downloads needed
- ✅ No server/cloud - everything runs locally
- ✅ No data transmission - secure by default
- ✅ Open source code - full transparency (GitHub)
- ✅ Works offline - no internet required
- ✅ No license cost - completely free

## Getting Help

- All code is open source: https://github.com/ScottK83/Development-Coaching-Tool
- Documentation: See README.md and OFFLINE_GUIDE.md
- Questions? Check the files - they're fully commented

---

**Version**: 1.0  
**Last Updated**: February 4, 2026  
**License**: MIT (free to use and modify)
