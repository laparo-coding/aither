# API Contract: Chapters in Video Endpoints

**Spec Reference**: [spec.md](../spec.md)  
**Data Model**: [data-model.md](../data-model.md)  
**OpenAPI**: [chapters-endpoint.openapi.yaml](chapters-endpoint.openapi.yaml)  
**Research**: [research.md](../research.md)

---

## Overview

This contract defines the API behavior for chapter regeneration, chapter listing, playback with chapter seeking, and chapter boundary SSE events. All endpoints enforce authentication (service token or admin session) and return canonical error envelopes.

---

## Endpoint 1: Regenerate Chaptered Video

### Signature

```
POST /api/recording/chapters/{id}
Content-Type: application/json
Authorization: Bearer <token>
```

### Path Parameters

- `id` (string, required) — Asset ID (recording session id, e.g., `rec_2026-07-13T10-30-00Z`).

### Request Body

Empty (`{}`). All input is derived from the path parameter and stored artifacts.

### Response 200 — Success

**Status Code**: `200 OK`

**Content-Type**: `application/json`

**Body**:
```json
{
  "assetId": "rec_2026-07-13T10-30-00Z",
  "muxAssetId": "mux_chapters_rec_2026-07-13T10-30-00Z",
  "chapterCount": 5
}
```

**Invariants**:
- `chapterCount` MUST equal the ffmetadata JSON `chapters[]` length (cross-check).
- `muxAssetId` MUST be a non-empty MUX asset identifier (canonical reference for the chaptered video).
- `assetId` MUST echo the path parameter.
- The local transient chaptered MP4 MUST be deleted after a successful MUX upload (Constitution Principle VIII).

### Response 400 — Bad Request

**Status Code**: `400 Bad Request`

**Trigger**: Invalid `assetId` format (does not match expected recording session id pattern).

**Body**:
```json
{
  "success": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Invalid assetId format. Expected rec_YYYY-MM-DDTHH-mm-ssZ"
  }
}
```

### Response 401 — Unauthorized

**Status Code**: `401 Unauthorized`

**Trigger**: Missing Authorization header OR bearer token is invalid/expired OR no admin Clerk session present.

**Body**:
```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Missing or invalid authentication credentials"
  }
}
```

**Security Note**: Bearer token is validated timing-safely (constant-time comparison via `timingSafeEqualString()`). No token is echoed in response.

### Response 403 — Forbidden

**Status Code**: `403 Forbidden`

**Trigger**: Request is authenticated (token or session present) BUT sender is not authorized (e.g., authenticated user without admin role or matching service token).

**Body**:
```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Insufficient permissions to regenerate chapters"
  }
}
```

### Response 404 — Not Found

**Status Code**: `404 Not Found`

**Trigger 1 — Recording Not Found**: No raw MP4 exists at `/output/recordings/{id}.mp4`.

**Body**:
```json
{
  "success": false,
  "error": {
    "code": "RECORDING_NOT_FOUND",
    "message": "No recording found for assetId: rec_2026-07-13T10-30-00Z"
  }
}
```

**Trigger 2 — ffmetadata Blob Not Found**: Vercel Blob Storage read returns 404 (blob at `ffmetadata/{id}.json` does not exist).

**Body**:
```json
{
  "success": false,
  "error": {
    "code": "FFMETADATA_NOT_FOUND",
    "message": "No ffmetadata JSON blob found for assetId. Call POST /api/recording/timestamp first."
  }
}
```

### Response 409 — Conflict

**Status Code**: `409 Conflict`

**Trigger**: Recording is still active (session status = `recording` or `starting`). Cannot regenerate while recording is in progress.

**Body**:
```json
{
  "success": false,
  "error": {
    "code": "RECORDING_IN_PROGRESS",
    "message": "Cannot regenerate chaptered video while recording is still active. Stop recording first."
  }
}
```

### Response 422 — Unprocessable Entity

**Status Code**: `422 Unprocessable Entity`

**Trigger**: ffmetadata JSON blob fails schema validation (e.g., missing required fields, invalid chapter offsets).

**Body**:
```json
{
  "success": false,
  "error": {
    "code": "FFMETADATA_INVALID",
    "message": "ffmetadata JSON failed schema validation",
    "details": {
      "validationErrors": [
        "chapters array is required",
        "chapters[0].offset.micros must be >= 0"
      ]
    }
  }
}
```

### Response 502 — Bad Gateway

**Status Code**: `502 Bad Gateway`

**Trigger 1 — FFmpeg Remux Failed**: FFmpeg process exited with code ≠ 0, or chapter count in embedded MP4 does not match ffmetadata JSON length.

**Body**:
```json
{
  "success": false,
  "error": {
    "code": "REMUX_FAILED",
    "message": "FFmpeg remux failed or chapter validation failed",
    "details": {
      "ffmpegExitCode": 1,
      "reason": "Invalid input format"
    }
  }
}
```

**Side Effects**: On failure, any partial output file at `/output/recordings/{id}.chapters.mp4` is deleted (atomic cleanup).

### Response 503 — Service Unavailable

**Status Code**: `503 Service Unavailable`

**Trigger**: Vercel Blob Storage read fails (timeout, 5xx, or network error).

**Body**:
```json
{
  "success": false,
  "error": {
    "code": "BLOB_STORAGE_UNAVAILABLE",
    "message": "Vercel Blob Storage temporarily unavailable. Retry after a few seconds."
  }
}
```

### Response 500 — Internal Server Error

**Status Code**: `500 Internal Server Error`

**Trigger**: Unexpected error (e.g., file system permission error, disk full, uncaught exception).

**Body**:
```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Internal server error. Error details logged via Rollbar."
  }
}
```

**Monitoring**: All 500 errors logged via Rollbar with full context (stack trace, request id, user context).

### Contract-Level Invariants

1. **Idempotent Re-upload**: Re-invoking with the same `assetId` re-uploads to MUX by creating a new asset and atomically switching the persisted mapping to the new `muxAssetId`. Deleting the previous MUX asset is optional. The success response shape remains unchanged (safe to retry).
2. **No Partial Files**: On failure, no transient local chaptered file is left on disk.
3. **No Secret Leakage**: Bearer tokens, internal paths, blob URLs, MUX tokens not included in any response.
4. **Synchronous Execution**: Request blocks until FFmpeg remux + MUX upload completes. No 202 Accepted / async job-status.
5. **Cross-Check Validation**: Chapter count in the MUX chaptered asset MUST match ffmetadata JSON length. Mismatch → 502.
6. **MUX as Single Source of Truth**: Chaptered video is stored in MUX; local file is transient only (Constitution Principle VIII).

### Example Workflow

```
1. POST /api/recording/chapters/rec_2026-07-13T10-30-00Z
   Authorization: Bearer <token>
   
   Response 200:
   {
     "assetId": "rec_2026-07-13T10-30-00Z",
     "muxAssetId": "mux_chapters_rec_2026-07-13T10-30-00Z",
     "chapterCount": 5
   }

2. Chaptered MP4 uploaded to MUX (muxAssetId = mux_chapters_rec_2026-07-13T10-30-00Z) with 5 embedded chapters; local transient file deleted.

3. Gaia controller can now:
   - Call GET /api/recording/chapters/{id} to fetch chapter list (sourced from MUX chaptered asset via ffprobe)
   - Call POST /api/recording/playback/play with chapterId to address chapters
   - Call GET /api/recording/stream/{id} to stream the MUX chaptered asset (CDN redirect/proxy)
```

---

## Endpoint 2: List Chapters

### Signature

```
GET /api/recording/chapters/{id}
Authorization: Bearer <token>
```

### Path Parameters

- `id` (string, required) — Asset ID.

### Response 200 — Success

**Status Code**: `200 OK`

**Content-Type**: `application/json`

**Body**:
```json
{
  "assetId": "rec_2026-07-13T10-30-00Z",
  "chapters": [
    {
      "id": 0,
      "start": 5.0,
      "end": 20.0,
      "title": "Chapter 1: Introduction"
    },
    {
      "id": 1,
      "start": 20.0,
      "end": 45.0,
      "title": "Chapter 2: Key Topics"
    },
    {
      "id": 2,
      "start": 45.0,
      "end": 7200.0,
      "title": "Chapter 3: Conclusion"
    }
  ]
}
```

**Invariants**:
- Chapters MUST be ordered by `id` (0, 1, 2, ...).
- `start` < `end` for all chapters.
- No chapter overlap: `chapters[i].end <= chapters[i+1].start`.
- `start` and `end` in **seconds** (converted from ffprobe microseconds).
- Final chapter's `end` MUST equal (or be very close to) the video duration.

### Response 404 — Not Found

**Trigger 1 — Chaptered MP4 Not Generated**: No persisted chaptered MUX mapping exists for `{id}`.

**Body**:
```json
{
  "success": false,
  "error": {
    "code": "CHAPTERS_NOT_GENERATED",
    "message": "Chaptered video has not been generated yet. Call POST /api/recording/chapters/{id} to regenerate."
  }
}
```

**Trigger 2 — Recording Not Found**: No recording exists (raw or chaptered).

**Body**:
```json
{
  "success": false,
  "error": {
    "code": "RECORDING_NOT_FOUND",
    "message": "No recording found for assetId"
  }
}
```

### Response 502 — Bad Gateway

**Trigger**: ffprobe extraction or JSON parsing fails.

**Body**:
```json
{
  "success": false,
  "error": {
    "code": "REMUX_FAILED",
    "message": "Failed to extract chapters from MP4"
  }
}
```

---

## Endpoint 3: Play with Chapter Seeking

### Signature

```
POST /api/recording/playback/play
Content-Type: application/json
Authorization: Bearer <token>
```

### Request Body

```json
{
  "recordingId": "rec_2026-07-13T10-30-00Z",
  "chapterId": 1
}
```

**Fields**:
- `recordingId` (string, required) — Recording session id.
- `chapterId` (integer, optional) — Chapter to play (0-based). If omitted, play from start.

### Response 200 — Success

**Status Code**: `200 OK`

**Body** (when `chapterId` provided):
```json
{
  "accepted": true,
  "chapterId": 1,
  "start": 20.0,
  "end": 45.0
}
```

**Body** (when `chapterId` omitted):
```json
{
  "accepted": true
}
```

**Behavior**:
- If `chapterId` is provided, the player MUST seek to `chapters[chapterId].start` (in seconds) before playing.
- Player pauses automatically when reaching the chapter's `end` offset (no auto-advance to next chapter).
- SSE event `chapter-boundary` is emitted when `end` is reached.

### Response 404 — Not Found

**Trigger**: `chapterId` does not match any chapter in the chapter list.

**Body**:
```json
{
  "success": false,
  "error": {
    "code": "CHAPTER_NOT_FOUND",
    "message": "Chapter ID does not exist for this recording"
  }
}
```

---

## Endpoint 4: Stream Recording (Extended)

### Signature

```
GET /api/recording/stream/{id}
Range: bytes=0-1023  (optional)
```

### Behavior

- Default transport (FR-017): if a MUX chaptered asset exists for `{id}`, return `302 Found` with `Location: <muxPlaybackUrl>`.
- Proxy mode is optional and only used when explicit header control/compliance/observability requirements make redirect insufficient.
- Else, serve the raw MUX asset (Spec 004 behavior unchanged).
- Support HTTP Range requests (206 Partial Content), delegated to MUX CDN where applicable.

### Response 302 — Redirect (Default)

**Status Code**: `302 Found`

**Headers**:
```
Location: https://stream.mux.com/<playback-id>.mp4
```

**Body**: empty

### Response 200 — Full Stream

**Status Code**: `200 OK`

**Headers**:
```
Content-Type: video/mp4
Content-Length: 1500000000
Accept-Ranges: bytes
```

**Body**: MP4 file (binary, when proxy mode is used).

### Response 206 — Partial Content (Range Request)

**Status Code**: `206 Partial Content`

**Headers**:
```
Content-Type: video/mp4
Content-Length: 1024
Content-Range: bytes 0-1023/1500000000
```

### Response 416 — Range Not Satisfiable

**Trigger**: Range header specifies invalid byte range (beyond file size).

**Status Code**: `416 Range Not Satisfiable`

---

## Endpoint 5: SSE Stream (Extended)

### Signature

```
GET /api/recording/events?recordingId={id}
```

### Response 200 — SSE Stream

**Content-Type**: `text/event-stream`

**Event: chapter-boundary** (new)

Emitted when player reaches the end of a chapter.

```
event: chapter-boundary
data: {"chapterId": 1, "nextChapterId": 2}

```

**Timing**: Emitted **before** player pauses (proactive notification).

**Payload**:
- `chapterId` (integer) — Chapter that just ended.
- `nextChapterId` (integer, optional) — Next chapter id (omitted for final chapter).

---

## Error Response Format (Canonical)

All error responses follow this envelope:

```json
{
  "success": false,
  "error": {
    "code": "<ERROR_CODE>",
    "message": "<human-readable message>",
    "details": { /* optional context */ }
  }
}
```

**Error Codes** (by endpoint):

| Code | HTTP | Endpoint | Meaning |
|------|------|----------|---------|
| INVALID_REQUEST | 400 | POST chapters | Bad assetId format |
| UNAUTHORIZED | 401 | All | Missing/invalid token or session |
| FORBIDDEN | 403 | All | Authenticated but not authorized |
| RECORDING_NOT_FOUND | 404 | POST/GET chapters | Raw MP4 not found |
| FFMETADATA_NOT_FOUND | 404 | POST chapters | Blob not found |
| CHAPTERS_NOT_GENERATED | 404 | GET chapters | Chaptered MP4 not found |
| CHAPTER_NOT_FOUND | 404 | POST playback/play | Invalid chapterId |
| RECORDING_IN_PROGRESS | 409 | POST chapters | Recording still active |
| FFMETADATA_INVALID | 422 | POST chapters | JSON schema validation failed |
| REMUX_FAILED | 502 | POST chapters / GET chapters | FFmpeg or ffprobe failed |
| BLOB_STORAGE_UNAVAILABLE | 503 | POST chapters | Vercel unavailable |
| INTERNAL_ERROR | 500 | All | Unexpected error |

**Data Privacy Rules**:
- No bearer tokens in responses.
- No file paths in responses (only filenames).
- No Blob URLs in responses.
- No secret values in error messages.

---

## Authentication & Authorization

### Token-or-Admin Model (Spec 009 pattern)

**Valid Authorization**:
1. Bearer token matching `URANOS_SYNC_TOKEN` environment variable (timing-safe comparison).
2. Clerk admin session (`__Secure-auth-token` cookie with admin role).

**Invalid Authorization**:
- No Authorization header and no Clerk session → 401 UNAUTHORIZED.
- Invalid token (non-matching or malformed) → 401 UNAUTHORIZED.
- Authenticated non-admin session without matching token → 403 FORBIDDEN.

### Implementation (Node.js):

```typescript
import { requireSyncAccess } from "@/lib/auth/uranos-service-auth";

export async function POST(request: NextRequest) {
  const authResult = await requireSyncAccess(request);
  if (authResult.status !== 200) {
    return NextResponse.json(authResult.body, { status: authResult.status });
  }
  // Proceed with regeneration...
}
```

---

## Contract Validation Checklist

- [ ] Regenerate endpoint returns 200 with correct schema (chapterCount matches ffmetadata).
- [ ] Regenerate endpoint idempotent (re-run produces same response).
- [ ] Regenerate endpoint cleans up on failure (no partial files).
- [ ] Regenerate endpoint returns 409 when recording active.
- [ ] Regenerate endpoint returns 422 on ffmetadata JSON validation error.
- [ ] List chapters endpoint returns 404 when MUX chaptered asset not found.
- [ ] List chapters endpoint returns chapters in correct order (id, start, end, title).
- [ ] List chapters endpoint converts times to seconds (microseconds ÷ 1,000,000).
- [ ] List chapters endpoint sources chapters from MUX chaptered asset (ffprobe on MUX URL), not ffmetadata blob.
- [ ] Play endpoint with chapterId seeks to chapter start.
- [ ] Play endpoint returns 404 when chapterId out of range.
- [ ] Stream endpoint serves MUX chaptered asset (CDN redirect/proxy) when available.
- [ ] Stream endpoint supports Range requests (206).
- [ ] Regenerate endpoint uploads chaptered MP4 to MUX and deletes local transient file.
- [ ] SSE endpoint emits chapter-boundary event when position ≥ chapter.end (tick ≤ 500 ms, dedupe key recordingId:chapterId).
- [ ] All endpoints enforce authentication (401/403).
- [ ] All error responses omit secrets/tokens/paths/MUX tokens.
- [ ] All 2xx responses conform to Zod schemas.

---

## Next Steps

- Phase 1 continues: Create `quickstart.md` (hands-on guide) and update agent context.
- Phase 2: Generate `tasks.md` with TDD-ordered implementation tasks.
