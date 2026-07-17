# Quickstart: 009 — Uranos Timestamp Endpoint

**Feature**: 009-timestamp-endpoint | **Spec**: `spec.md` | **Plan**: `plan.md`

This guide covers the one-time setup and a local smoke test for the Uranos
timestamp endpoint.

## Prerequisites

- Node.js + npm (repo already bootstrapped).
- A **dedicated Aither Vercel Blob store** (separate from Hemera's).
- A shared secret token for Uranos → Aither auth.
- An active recording session (or a mocked one) to exercise the happy path.

## 1. Install the Vercel Blob SDK

```bash
npm install @vercel/blob
```

> Per repo Codacy rules: immediately after install, run a Trivy scan
> (`codacy_cli_analyze` with `tool: trivy`) and resolve any new vulnerabilities
> before continuing.

## 2. Create the dedicated Aither Blob store & token

1. In the Vercel dashboard, under the **Aither** project, create a new Blob
   store (do NOT reuse Hemera's store).
2. Generate a read/write token (format `vercel_blob_rw_…`).
3. Add it to Aither's environment.

## 3. Provision the Uranos service token

Generate a strong shared secret (min 32 chars) and configure it in **both**
Aither and the Uranos app:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## 4. Environment variables

Add to Aither `.env.local` (dev) and the Linux host `.env` (prod). Never commit.

```bash
# Vercel Blob (dedicated Aither store)
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_XXXXXXXXXXXX"

# Uranos service token (shared secret with the Uranos app)
URANOS_SYNC_TOKEN="<generated-48-byte-base64url-secret>"
```

Both are surfaced through `src/lib/config.ts`:
- `BLOB_READ_WRITE_TOKEN` — optional at boot, required at request time
  (missing → `503 BLOB_STORAGE_UNAVAILABLE`).
- `URANOS_SYNC_TOKEN` — required for token-based auth (admin session is the
  only fallback).

## 5. Run the dev server

```bash
npm run dev -- -p 3001
```

## 6. Smoke test

### 6a. No active recording → 404 (no blob write)

```bash
curl -i -X POST 'http://localhost:3001/api/recording/timestamp' \
  -H "Authorization: Bearer $URANOS_SYNC_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"timestamp": 1720866600}'
# → HTTP/1.1 404  { "success": false, "error": { "code": "NO_ACTIVE_RECORDING" } }
```

### 6b. Missing token → 401

```bash
curl -i -X POST 'http://localhost:3001/api/recording/timestamp' \
  -H 'Content-Type: application/json' \
  -d '{"timestamp": 1720866600}'
# → HTTP/1.1 401  { "success": false, "error": { "code": "UNAUTHORIZED" } }
```

### 6c. Active recording → 200 (blob created)

Start a recording first (requires a reachable webcam stream, or mock
`session-manager` in tests):

```bash
curl -s -X POST 'http://localhost:3001/api/recording/start' \
  -H "Authorization: Bearer <admin-or-service-token>"
```

Then ingest a timestamp (capture the current time after recording starts):

```bash
TS=$(date +%s)
curl -i -X POST 'http://localhost:3001/api/recording/timestamp' \
  -H "Authorization: Bearer $URANOS_SYNC_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"timestamp\": $TS}"
# → HTTP/1.1 200
#   { "success": true, "data": { "assetId": "rec_…Z", "chapterId": 0, "blobKey": "ffmetadata/rec_…Z.json" } }
```

Send a second, later timestamp to append and close the first chapter:

```bash
curl -s -X POST 'http://localhost:3001/api/recording/timestamp' \
  -H "Authorization: Bearer $URANOS_SYNC_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"timestamp\": $((TS + 15))}"
```

### 6d. Idempotent retry (equal timestamp) → 200

```bash
curl -i -X POST 'http://localhost:3001/api/recording/timestamp' \
  -H "Authorization: Bearer $URANOS_SYNC_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"timestamp\": $((TS + 15))}"   # == last chapter start → idempotent (FR-022)
# → HTTP/1.1 200  { "success": true, "data": { "chapterId": 1, … } }
```

### 6e. Non-monotonic timestamp (strictly before last chapter start) → 400

```bash
curl -i -X POST 'http://localhost:3001/api/recording/timestamp' \
  -H "Authorization: Bearer $URANOS_SYNC_TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"timestamp\": $((TS + 5))}"    # < last chapter start (strictly before)
# → HTTP/1.1 400  { "success": false, "error": { "code": "INVALID_TIMESTAMP" } }
```

## 7. Verify the blob

The blob is stored as **private** in Vercel Blob Storage. To verify, use the Vercel Blob API or a server-side proxy with the `blobKey` returned in the response:

```bash
# Example: fetch via server-side proxy (requires auth)
curl -s 'http://localhost:3001/api/blob?path=ffmetadata/rec_…Z.json' \
  -H "Authorization: Bearer $URANOS_SYNC_TOKEN" | jq .
# {
#   "metadata": { "title": "rec_…Z", "encoder": "aither-ffmetadata" },
#   "chapters": [ { "id": 0, "start": …, "end": …, "title": "Chapter 1" }, … ]
# }
```

## 8. Run tests

```bash
npm run test:unit -- ffmetadata
npm run test:contract -- timestamp
```

## Validation Checklist

- [ ] `@vercel/blob` installed; Trivy scan clean.
- [ ] Dedicated Aither `BLOB_READ_WRITE_TOKEN` set (not Hemera's).
- [ ] `URANOS_SYNC_TOKEN` set in Aither and Uranos.
- [ ] 404 when no recording is active (no blob write).
- [ ] 401 without token; 200 with token + active recording.
- [ ] Non-monotonic / pre-start timestamps rejected with 400.
- [ ] Blob at `ffmetadata/<assetId>.json` is valid ffmetadata JSON.
- [ ] p95 < 500 ms recorded in `performance-validation.md`.
