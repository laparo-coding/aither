# Cron Job Setup — Scheduled Automatic Sync

## Overview

Aither runs as a self-hosted Next.js application on Linux. Scheduled syncs are triggered via external cron jobs that call the sync API endpoint.

## Prerequisites

- Aither running on `http://localhost:3000` (or your configured host/port)
- A valid authentication token for the sync API (recommended: the dedicated `AITHER_SYNC_TOKEN` service token)
- `curl` installed on the host system

## Cron Configuration

### Daily Sync at 02:00 (recommended)

```bash
# Edit crontab
crontab -e

# Add this line:
0 2 * * * curl -sf -X POST http://localhost:3000/api/sync -H "Authorization: Bearer $AITHER_SYNC_TOKEN" -H "Content-Type: application/json" >> /var/log/aither-sync.log 2>&1
```

### Every 6 Hours

```bash
0 */6 * * * curl -sf -X POST http://localhost:3000/api/sync -H "Authorization: Bearer $AITHER_SYNC_TOKEN" -H "Content-Type: application/json" >> /var/log/aither-sync.log 2>&1
```

### Manual Trigger (for testing)

```bash
curl -X POST http://localhost:3000/api/sync \
  -H "Authorization: Bearer $AITHER_SYNC_TOKEN" \
  -H "Content-Type: application/json"
```

## Response Codes

| Status | Meaning |
|--------|---------|
| 202    | Sync started successfully. Response includes `jobId`. |
| 409    | A sync is already running. Wait for completion or check status. |
| 401    | Authentication required. Check your token. |
| 403    | Insufficient permissions. Requires admin role. |

## Monitoring

### Check Sync Status

```bash
curl -s http://localhost:3000/api/sync \
  -H "Authorization: Bearer $AITHER_SYNC_TOKEN" | jq .
```

### Check Last Sync in Logs

```bash
tail -20 /var/log/aither-sync.log
```

## Systemd Timer (Alternative to Cron)

For systems using systemd, create a timer unit:

### `/etc/systemd/system/aither-sync.service`

```ini
[Unit]
Description=Aither Sync Trigger
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/bin/curl -sf -X POST http://localhost:3000/api/sync -H "Authorization: Bearer %I" -H "Content-Type: application/json"
Environment=AITHER_SYNC_TOKEN=your-token-here
```

### `/etc/systemd/system/aither-sync.timer`

```ini
[Unit]
Description=Run Aither Sync daily at 02:00

[Timer]
OnCalendar=*-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

### Enable Timer

```bash
sudo systemctl enable --now aither-sync.timer
```

## Safety Features

- **Automatic lock release**: If a sync job crashes or times out, the mutex auto-releases after 30 minutes (configurable via `SYNC_TIMEOUT_MS` env var).
- **Concurrent rejection**: Only one sync runs at a time. Overlapping triggers receive HTTP 409.
- **Incremental sync**: Only changed entities are regenerated (SHA-256 hash comparison).

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AITHER_SYNC_TOKEN` | Exact bearer token accepted by `/api/sync` for cron/service auth | — (required) |
| `SYNC_TIMEOUT_MS` | Maximum sync duration before auto-release | `1800000` (30 min) |
