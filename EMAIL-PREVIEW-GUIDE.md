# 📧 Email Template Guide - Using the Email Preview

## The Problem with Outlook

Outlook is notoriously incompatible with HTML email formatting. When you paste rich HTML text into Outlook, it converts it to plain text or RTF, stripping all styling (colors, fonts, borders, etc.).

## The Solution We Implemented

We've created a **preview window** that shows you exactly what the styled email will look like, and provides instructions for properly pasting it into Outlook.

---

## How to Use the Email Preview Feature

### Step 1: Generate the Email
1. Open the app and go to **📈 Metric Trends** tab
2. Select a period (week/month/year)
3. Select an employee
4. Click **Generate Trend Email** button

### Step 2: Preview Window Opens
- A new window will open showing your styled email
- You'll see the colorful summary cards and formatted metrics table
- This is what the styling CAN look like if pasted correctly

### Step 3: Copy the Formatted Email
The best way to get the styling into Outlook:

**Option A: Copy from Preview Window (RECOMMENDED)**
1. In the preview window that opened, select all text: `Ctrl+A`
2. Copy it: `Ctrl+C`
3. In Outlook, click in the message body
4. Use **Paste Special** > **Unformatted Text** (NOT regular paste)
5. The HTML will be rendered with full styling!

**Option B: Use Clipboard (If Option A doesn't work)**
1. The app automatically copies to your clipboard when you generate the email
2. Go to Outlook and create a new email
3. Paste as HTML format (some email clients support this)
4. Subject line is ready for you to use

---

## What Styling You'll Get

The email includes:

✅ **Professional Header**
- Purple gradient background
- White text
- Clear title and date

✅ **Three Summary Cards** (Colored boxes)
- Green box: "Meeting Target Goals" (e.g., "6/8 metrics")
- Blue box: "Outpacing Your Peers" (e.g., "5/8 metrics above center")
- Yellow box: "Improved Metrics" (e.g., "3 improved this week")

✅ **Detailed Metrics Table**
- Color-coded rows (green for good, yellow for watch)
- Employee value, center average, target, vs center, and trend
- Professional borders and spacing

✅ **Highlights & Focus Areas**
- Green highlight box for improvements
- Yellow highlight box for areas needing focus
- Clear, readable text

✅ **Professional Footer**
- Legend explaining all symbols
- Closing message
- Disclaimer

---

## Troubleshooting

### Q: The email looks plain when pasted into Outlook
**A:** Outlook strips HTML styling in many cases. Try using **Paste Special > HTML Format** instead of regular paste.

### Q: The colors don't show up
**A:** This is normal for some Outlook versions. The data is still there and readable, just without the background colors.

### Q: The layout looks broken
**A:** We've made the tables Outlook-safe, but if you see broken layout, try:
1. Paste into Notepad first
2. Copy from Notepad
3. Paste into Outlook as Plain Text
4. The HTML markup will render the colors

### Q: I don't see the preview window
**A:** Check if a pop-up was blocked. Enable pop-ups for this site, or use a browser that allows pop-ups.

---

## Pro Tips

1. **For Best Results**: Copy directly from the preview window using Ctrl+A, Ctrl+C
2. **Backup**: The HTML is also saved in your browser's clipboard (shown in toast message)
3. **Share**: You can also select and copy from the preview to share via email or messaging
4. **Print**: The preview window can be printed if you need a PDF version!

---

## Browser Compatibility

The preview feature works in:
- ✅ Chrome/Chromium
- ✅ Firefox
- ✅ Safari
- ✅ Edge
- ✅ Any modern browser with pop-up support

---

## Next Steps

When the email opens in Outlook:
1. Add employee recipient(s)
2. Adjust any text as needed
3. Send!

The colored cards and professional formatting should display in most modern email clients. If Outlook strips some styling, the core data and table structure remain intact and readable.
