# Call Listening Repo Sync Worker

This Worker receives Call Listening logs from the app and commits them to this GitHub repo.

## Files Updated in Repo

- `data/call-listening-logs.json`
- `data/call-listening-logs.csv`

A GitHub Action then regenerates:

- `data/call-listening-logs.xlsx`

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

Every add/update/delete save in Call Listening will now sync to repo.

## Notes

- If Worker URL is blank, the app continues local-only storage.
- If sync fails, the app shows the failure in the `callListeningSyncStatus` line but still keeps local data.
