# Sync Scheduling — Cron Configuration

> **Feature:** 005-data-sync — Periodic synchronization of course and participant data from Hemera to Aither.

## Overview

The Aither sync pipeline is triggered through `POST /api/sync`. For automatic recurring synchronization, configure a cron job via `crontab`, Vercel Cron, or an external scheduler.

## Crontab Example

```bash
# Trigger sync every 30 minutes (for example on the Aither server or a scheduler)
*/30 * * * * curl -s -X POST https://aither.example.com/api/sync \
  -H "Authorization: Bearer $AITHER_SYNC_TOKEN" \
  -H "Content-Type: application/json" \
  -o /dev/null -w "%{http_code}" \
  | xargs -I{} sh -c 'if [ "{}" != "202" ] && [ "{}" != "409" ]; then echo "Sync failed: HTTP {}" >&2; fi'
```

### Explanation

| Parameter | Description |
|-----------|-------------|
| `*/30 * * * *` | Every 30 minutes (adjustable: `0 */2 * * *` for every 2 hours) |
| `Authorization: Bearer $AITHER_SYNC_TOKEN` | Dedicated service token; only an exact match against `AITHER_SYNC_TOKEN` bypasses Clerk for `/api/sync` |
| `-o /dev/null -w "%{http_code}"` | Output only the HTTP status code |

### Expected HTTP Responses

| Status | Meaning | Action |
|--------|-----------|--------|
| **202 Accepted** | Sync started. Body: `{ "success": true, "data": { "jobId": "sync-...", "status": "running", "startTime": "2026-02-22T..." }, "meta": { "requestId": "req-...", "timestamp": "2026-02-22T..." } }` | No action required |
| **409 Conflict** | A sync is already running. Body: `{ "success": false, "error": { "code": "SYNC_IN_PROGRESS", "message": "A sync operation is already running" }, "meta": { "requestId": "req-...", "timestamp": "2026-02-22T..." } }` | Normal for overlapping cron triggers — not an error |
| **401/403** | Authentication failed | Verify the exact `AITHER_SYNC_TOKEN` or admin access and expect a Rollbar alert |
| **500** | Server error | A Rollbar alert is triggered automatically |

## Overlapping Cron Triggers

The sync API uses an **in-memory mutex**. If a cron trigger arrives while a previous sync is still running, it returns `409 SYNC_IN_PROGRESS`. This is **expected behavior** and not an error.

- The mutex has an automatic timeout of 30 minutes (configurable through `SYNC_TIMEOUT_MS` in milliseconds, default: 1800000)
- After the timeout, the lock is released automatically

## Rollbar-Monitoring

After every sync, whether successful or failed, a structured log is sent to Rollbar:

```json
{
  "level": "info",
  "message": "sync.completed",
  "data": {
    "jobId": "sync-1234567890",
    "status": "success",
    "durationMs": 1520,
    "courseId": "cm5abc123",
    "participantsFetched": 8,
    "filesGenerated": 1,
    "filesSkipped": 0,
    "errorCount": 0
  }
}
```

### Recommended Rollbar Alerts

| Condition | Severity | Description |
|-----------|-------------|-------------|
| `sync.completed` with `status: "failed"` | Warning | Sync failed — API connectivity or data issue |
| `sync.manifest.corrupted` | Warning | Manifest file corrupted — full regeneration |
| HTTP 500 on `/api/sync` | Error | Server error in the sync endpoint |

## Vercel Cron (Alternative)

If deployed on Vercel, define a cron job in `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/sync",
      "schedule": "*/30 * * * *"
    }
  ]
}
```

> **Note:** Vercel Cron sends GET requests. The sync endpoint expects POST, so either the endpoint must be adapted or a dedicated cron handler must be added.

## Check Sync Status

```bash
# Query current sync status
curl -s https://aither.example.com/api/sync \
  -H "Authorization: Bearer $AITHER_ADMIN_TOKEN" \
  | jq .
```

Expected responses:

| Status | Body |
|--------|------|
| **200** | `{ "success": true, "data": { "jobId": "sync-...", "status": "success", "courseId": "cm5abc123", "filesGenerated": 1, "filesSkipped": 0 }, "meta": { "requestId": "req-...", "timestamp": "2026-02-22T..." } }` |
| **404** | `{ "success": false, "error": { "code": "NO_SYNC_JOB", "message": "No sync operation has been run" }, "meta": { "requestId": "req-...", "timestamp": "2026-02-22T..." } }` — No sync has been executed yet |
