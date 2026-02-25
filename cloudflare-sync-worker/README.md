# Call Listening Repo Sync Worker

This Worker receives app data from the browser and commits synced files to this GitHub repo.

## Files Updated in Repo

- `data/call-listening-logs.json`
- `data/call-listening-logs.csv`
- `data/coaching-tool-sync-backup.json` (full app backup)

A GitHub Action then regenerates:

- `data/call-listening-logs.xlsx`
- `data/Development-Coaching-Tool.xlsx`

## 1) Configure Worker

From repo root:

```powershell
Push-Location cloudflare-sync-worker
npx wrangler secret put GH_TOKEN
# Paste a GitHub token with repo contents write access
npx wrangler deploy
Pop-Location
```

The default owner/repo/branch are already set in `wrangler.toml`.

## 2) Enable Auto-Sync in App

1. Open `Coaching & Analysis` -> `🎧 Call Listening`
2. Paste your deployed Worker URL into `Auto-Sync Worker URL`
3. Keep `Auto-sync on save` checked

Every save/update/delete in the app that writes tracked data now syncs to repo.

## Notes

- If Worker URL is blank, the app continues local-only storage.
- If sync fails, the app shows the failure in the `callListeningSyncStatus` line but still keeps local data.
