# Development Coaching Tool

A personalized employee development coaching application that identifies performance gaps and provides targeted coaching scripts and learning resources.

## Features
- Input employee metrics and identify struggling areas
- Generate personalized coaching scripts
- Metric-specific best practices and development resources
- Responsive design with APS blue color scheme
- Clean, professional interface

## Metrics Tracked
- Schedule Adherence
- Customer Experience (CX Rep Overall)
- First Call Resolution (FCR)
- Transfers
- Overall Sentiment
- Positive Word Choice
- Negative Word Usage
- Managing Emotions
- Average Handle Time (AHT)
- After-Call Work (ACW)
- Hold Time
- Reliability Hours

## Tech Stack
- HTML5
- CSS3
- JavaScript (Vanilla)

## Build / Minify
To generate a minified JavaScript for production:

PowerShell (may require execution policy allowing npm):

```powershell
Push-Location "c:\Users\Scott\OneDrive\Desktop\Development-Coaching-Tool";
npm init -y;
npm install terser --save-dev;
npx terser script.js -o script.min.js --compress --mangle;
Pop-Location
```

If PowerShell blocks `npm.ps1`, run via CMD fallback:

```powershell
Push-Location "c:\Users\Scott\OneDrive\Desktop\Development-Coaching-Tool";
cmd /c "npm init -y";
cmd /c "npm install terser --save-dev";
cmd /c "npx terser script.js -o script.min.js --compress --mangle";
Pop-Location
```

The app loads `script.min.js` in `index.html` when present.
