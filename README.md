# Development Coaching Tool

A personalized employee development coaching application that identifies performance gaps and provides targeted coaching scripts and learning resources.

## Features
- Input employee metrics and identify struggling areas
- Generate personalized coaching scripts
- Metric-specific best practices and development resources
- Responsive design with APS blue color scheme
- Clean, professional interface
- Optional cloud sync across browsers/computers (single-user via private GitHub Gist)

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

## Cloud Sync Across Browsers/Computers (Single User)

You can sync all app data across your own browsers/computers using the **Cloud Sync** panel in **Manage Data**.

One-time setup:

1. Create a GitHub Personal Access Token with Gist access.
2. In the app, go to **Manage Data → Cloud Sync**.
3. Paste token into **GitHub Token**.
4. Click **Save to Cloud**.
   - On first save, the app auto-creates a private gist and fills in **Gist ID**.

Daily use:

- On device A: click **Save to Cloud** after updates.
- On device B: paste same token + gist ID, then click **Load from Cloud**.

Notes:

- Sync replaces local app data on load (you’ll be prompted first).
- Token and gist ID are saved locally in your browser.

## One-Command Publish (Git + Cloudflare)

Use the included script to commit, push, and deploy in one step.

PowerShell:

```powershell
cd "c:\Users\Scott\Development-Coaching-Tool"
.\deploy-and-publish.ps1 -Message "your commit message"
```

Batch launcher:

```powershell
cd "c:\Users\Scott\Development-Coaching-Tool"
.\deploy-and-publish.bat -Message "your commit message"
```

Notes:
- Default Cloudflare Pages project is `development-coaching-tool`.
- Publish now auto-runs smoke checks before commit/push/deploy.
- If smoke checks fail, deploy is blocked.
- By default, only tracked file changes are committed.
- To include new files too, use `-IncludeUntracked`.
- To bypass smoke checks intentionally, use `-SkipSmokeChecks`.
- Every run auto-bumps `APP_VERSION` in `script.js` using `YYYY.MM.DD.N` (N = push number for that day).

## Post-Deploy Smoke Test

Use this checklist after each deploy:

- [SMOKE_TEST_CHECKLIST.md](SMOKE_TEST_CHECKLIST.md)

It covers app load, upload flow, coaching generation, metric trends, backup/restore, and executive/dashboard sanity checks.

## One-Command Rollback Deploy

If you need to redeploy an older version quickly:

PowerShell:

```powershell
cd "c:\Users\Scott\Development-Coaching-Tool"
.\rollback-and-deploy.ps1 -Ref "backup-pre-cleanup-20260217-093927"
```

Batch launcher:

```powershell
cd "c:\Users\Scott\Development-Coaching-Tool"
.\rollback-and-deploy.bat -Ref "backup-pre-cleanup-20260217-093927"
```

Notes:
- `-Ref` accepts a tag, branch, or commit SHA.
- The script creates a rollback branch from that ref and deploys it to Cloudflare.
- Working tree must be clean before running rollback.

## Git Hook Enforcement (Manual Pushes)

To enforce version bumping on regular `git push` too, this repo includes a managed pre-push hook in `.githooks`.

One-time setup:

```powershell
cd "c:\Users\Scott\Development-Coaching-Tool"
git config core.hooksPath .githooks
```

Behavior:
- On every `git push`, the hook updates `APP_VERSION` to `YYYY.MM.DD.N`.
- It amends the latest commit automatically before push so the pushed commit carries the new version.
