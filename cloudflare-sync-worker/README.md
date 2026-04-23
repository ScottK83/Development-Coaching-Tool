# Coaching Tool Sync Worker

Cloudflare Worker that backs the app's cloud sync. All app state is stored in
an R2 bucket (`coaching-tool-data`) — no GitHub commits, no KV.

## R2 layout

- `state/latest.json` — most recent full backup (read by `mode: 'retrieve'`)
- `state/snapshots/YYYY-MM-DD.json` — one snapshot per UTC date, written on every sync
- `state/coachingHistory.csv` — human-readable CSV (overwrites)
- `uploads/<filename>` — files uploaded via `mode: 'uploadFile'`

## Endpoints

POST `/`:

- `{mode: 'retrieve'}` — returns latest backup
- `{mode: 'deleteAll'}` — deletes `state/latest.json` and `state/coachingHistory.csv`. Snapshots remain.
- `{mode: 'uploadFile', fileName, fileContentBase64}` — writes binary to `uploads/<fileName>`
- (no mode) — full sync; payload is the JSON state blob

GET `/files/<fileName>`:

- Streams `uploads/<fileName>` from R2. Origin/Referer must match `ALLOWED_ORIGIN`.

## One-time setup

```bash
# 1. Create the bucket (one time per Cloudflare account)
npx wrangler r2 bucket create coaching-tool-data

# 2. Optional shared secret (recommended)
npx wrangler secret put SYNC_SHARED_SECRET

# 3. Deploy
npx wrangler deploy
```

`ALLOWED_ORIGIN` is set in `wrangler.toml` and applies to both POST sync and
GET file downloads.

## Notes

- KV is no longer used. The bucket is the single source of truth.
- Snapshots are append-only (one per day). Historical snapshots are not
  deleted by `deleteAll` — that's the rollback safety net.
- File uploads are limited by R2 single-PUT size (~5 GiB). Free tier: 10 GB
  storage, 1M Class A ops/month, 10M Class B ops/month.
- The worker rejects regressive sync payloads with `409 DATA_REGRESSION_GUARD`.
