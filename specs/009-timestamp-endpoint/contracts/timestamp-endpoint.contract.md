# Contract: Uranos Timestamp Endpoint

**Feature**: 009-timestamp-endpoint

## POST /api/recording/timestamp

Ingest a unix timestamp and append an ffmpeg chapter to the active recording's
ffmetadata JSON blob.

### Request

- Method: `POST`
- Auth: `Authorization: Bearer <URANOS_SYNC_TOKEN>` (admin Clerk session accepted as fallback)
- Headers: `Content-Type: application/json`; optional `X-Request-ID`
- Body:

```json
{ "timestamp": 1720866600 }
```

- `timestamp`: unix epoch in **seconds**, positive integer.

### Success Response (200)

```json
{
  "success": true,
  "data": {
    "assetId": "rec_2026-07-13T10-30-00Z",
    "chapterId": 1,
    "blobKey": "ffmetadata/rec_2026-07-13T10-30-00Z.json"
  },
  "meta": {
    "requestId": "req_abc_123",
    "timestamp": "2026-07-13T10:30:15.000Z",
    "version": "1.0"
  }
}
```

### Resulting Blob Document (`ffmetadata/<assetId>.json`)

```json
{
  "metadata": {
    "title": "rec_2026-07-13T10-30-00Z",
    "encoder": "aither-ffmetadata"
  },
  "chapters": [
    { "id": 0, "start": 5000000, "end": 20000000, "title": "Chapter 1" },
    { "id": 1, "start": 20000000, "end": 20000000, "title": "Chapter 2" }
  ]
}
```

- Times in **microseconds** relative to recording start.
- The last chapter's `end == start` (placeholder) until the next timestamp.
- First chapter `start` = first timestamp offset (footage before it is un-chaptered).

### Error Responses

| Status | Code | When |
|--------|------|------|
| `400` | `INVALID_REQUEST` | Missing/malformed body, non-integer or non-positive `timestamp`. |
| `400` | `INVALID_TIMESTAMP` | `timestamp` predates recording start, or offset `<` last chapter `start` (non-monotonic; equal offsets are idempotent per FR-022). |
| `401` | `UNAUTHORIZED` | Missing `Authorization` header, or bearer token does not match `URANOS_SYNC_TOKEN` (and no session). When `URANOS_SYNC_TOKEN` is unset/empty, all non-admin requests are rejected with `401` (admin-session fallback remains available per FR-018a). |
| `403` | `FORBIDDEN` | Authenticated Clerk session that is not `admin` and no valid service token. |
| `404` | `NO_ACTIVE_RECORDING` | No recording session with status `recording`/`starting`. No blob write. |
| `429` | `TOO_MANY_REQUESTS` | >60 requests/minute per authenticated identity (service token or Clerk `userId` for admin sessions). Includes `Retry-After` header. |
| `503` | `BLOB_STORAGE_UNAVAILABLE` | `BLOB_READ_WRITE_TOKEN` missing, or blob read/write failed. |
| `500` | `INTERNAL_ERROR` | Unexpected failure. Reported to Rollbar. |

### Error Envelope

```json
{
  "success": false,
  "error": {
    "code": "NO_ACTIVE_RECORDING",
    "message": "No active recording session.",
    "details": {}
  },
  "meta": { "requestId": "req_abc_123", "timestamp": "…", "version": "1.0" }
}
```

### Invariants (contract-testable)

1. No blob write occurs on any `4xx` response.
2. `data.chapterId` equals the `id` of the newly appended chapter.
3. `data.blobKey` is the deterministic blob path (`ffmetadata/<assetId>.json`); no direct URL is returned.
3. Chapters remain strictly increasing by `start` after every accepted request.
4. Responses never contain bearer tokens, `URANOS_SYNC_TOKEN`, `BLOB_READ_WRITE_TOKEN`, or absolute filesystem paths.
5. Concurrent requests for the same `assetId` do not drop chapters (serialized).
