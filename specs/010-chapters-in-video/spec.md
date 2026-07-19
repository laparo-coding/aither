# Feature Specification: Chapters in Video

**Feature Branch**: `010-chapters-in-video`  
**Created**: 2026-07-17  
**Status**: Implemented (validated 2026-07-19 via T060–T064)  
**Input**: User description: "Enhance the procedure for playing back a video that was recorded in a seminar session. The video play must now consider the chapters from the ffmetadata JSON stored in the Vercel blob storage. To achieve this, the video must be regenerated with chapter information in such a way that the video controller implemented in gaia can directly access the individual chapter for playback. The video asset id is the key to join the video and the ffmetadata information."

## Clarifications

### Session 2026-07-17

- Q: How is the chaptered video regeneration triggered — automatically (event-driven on recording stop + ffmetadata blob readiness) or manually (operator/Gaia calls the endpoint explicitly)? → A: **Manual trigger only** (pull-based). Operator or Gaia explicitly calls `POST /api/recording/chapters/[id]` once both prerequisites (finalized recording + complete ffmetadata JSON blob) are confirmed. Rationale: Spec 009 explicitly decouples the timestamp endpoint from the stop lifecycle (the last chapter's `end` is a zero-length placeholder clamped only at mux time), so there is no reliable "blob is complete" signal for an automatic trigger. The existing error codes (`404 RECORDING_NOT_FOUND`, `404 FFMETADATA_NOT_FOUND`, `409 RECORDING_IN_PROGRESS`) already support a pull-based model, and FR-010 makes regeneration idempotent so repeat calls are safe. Aither does NOT poll for blob readiness or chain regeneration off `POST /api/recording/stop`.
- Q: What should the player do when a chapter's `end` is reached during playback? → A: **Stop at chapter end.** The player pauses at the chapter's `end` offset; Gaia must explicitly request the next chapter via `POST /api/recording/playback/play` with the next `chapterId`. This gives Gaia full control over chapter transitions and prevents unintended overshoot into the next chapter. The player emits a chapter-boundary event (via the existing SSE channel at `/api/recording/events`) when the `end` is reached so Gaia can react.
- Q: Which blob store and token should the regeneration step use to read the ffmetadata JSON? → A: **Same dedicated Aither Blob store and `BLOB_READ_WRITE_TOKEN` as Spec 009.** No separate read-only store or token is introduced; the regeneration endpoint reads from the same private blob store that the timestamp endpoint writes to, using the same `BLOB_READ_WRITE_TOKEN` environment variable.
- Q: Where should `GET /api/recording/chapters/[id]` source the chapter list from — the ffmetadata JSON blob or the embedded chapters in the remuxed MP4? → A: **From the embedded chapters in the MUX chaptered asset via `ffprobe -show_chapters` on the MUX playback URL.** The MUX chaptered asset is the single source of truth at query time; this guarantees the returned list matches what the player actually plays. Reading from the blob would risk divergence if the blob was updated after regeneration (the spec explicitly does NOT auto-regenerate on blob updates). The chapters are converted from microseconds to seconds in the response.
- Q: Should regeneration be synchronous (block until FFmpeg completes) or asynchronous (return 202 Accepted with a job-status endpoint)? → A: **Synchronous.** The endpoint blocks until the FFmpeg remux completes and returns the final `200`/`502` response. Rationale: `-codec copy` remux is fast (no re-encoding); typical seminar recordings (1–2 h, 1–3 GB) remux in seconds. A job-status tracking system would add complexity without meaningful benefit at this scale. If future recordings grow significantly, an async model can be revisited.

## Overview

This feature enhances the existing video playback procedure (Spec 004 — Recording Module) so that a recording captured during a seminar session is played back with chapter awareness. Chapter information is sourced from the ffmetadata JSON blob stored in Vercel Blob Storage by the Uranos timestamp endpoint (Spec 009). The video asset id (the recording session id, e.g. `rec_2026-07-13T10-30-00Z`) is the join key between the recorded video file in `output/recordings/` and the ffmetadata JSON blob at `ffmetadata/<assetId>.json`.

To make chapters directly addressable by the Gaia video controller, the recorded MP4 is **regenerated** (remuxed) with embedded chapter metadata using FFmpeg's `-map_metadata 1 -codec copy` flow, producing a chaptered video asset. The Gaia video controller can then seek to and play individual chapters by their `start`/`end` offsets without parsing the ffmetadata JSON at playback time.

### Relationship to Existing Specs

- **Spec 004 (Recording Module)** — owns the recording lifecycle, the local MP4 file in `output/recordings/`, the playback API (`/api/recording/playback/*`), and the web player at `/recording/player/[id]`. This feature extends the playback procedure; it does not change capture or storage of the raw recording.
- **Spec 009 (Uranos Timestamp Endpoint)** — owns the ffmetadata JSON blob in Vercel Blob Storage at `ffmetadata/<assetId>.json`. This feature consumes that blob as read-only input; it does not modify the timestamp ingestion pipeline.
- **Gaia video controller** — external consumer (project `gaia`) that drives playback. This feature ensures the chaptered video asset produced by Aither can be addressed chapter-by-chapter by Gaia without Gaia needing to parse ffmetadata JSON.

## Out of Scope

- Modifying the Uranos timestamp ingestion pipeline (Spec 009) — the ffmetadata JSON blob is consumed read-only.
- Changing the recording capture pipeline (FFmpeg spawn, webcam stream handling) — the raw MP4 in `output/recordings/` remains the capture output.
- Re-encoding the video stream (transcoding) — chapter embedding uses `-codec copy` (stream copy / remux), not re-encoding.
- Authoring or editing chapter metadata — chapters are taken as-is from the ffmetadata JSON blob; no chapter editing UI is provided.
- Browser-side rendering of chapter lists or chapter pickers in the web player — the player remains a headless surface; chapter addressing is driven by the Gaia controller via the playback API.
- Lifecycle management (deletion, pruning) of chaptered video assets — handled by existing recording lifecycle endpoints.

## Architecture Overview

### Chaptered Video Regeneration Pipeline

```
ffmetadata/<assetId>.json (Vercel Blob) ─┐
                                          ├─→ FFmpeg (-map_metadata 1 -codec copy) ─→ transient <assetId>.chapters.mp4 ─→ MUX upload ─→ MUX chaptered asset
output/recordings/<assetId>.mp4 (raw) ────┘
```

1. **Trigger** — A chaptered regeneration is requested for a given `assetId` (recording session id). The trigger is exposed via a new endpoint (see API Reference) and is invoked once the recording is finalized and the ffmetadata JSON blob is complete.
2. **Fetch ffmetadata JSON** — Aither reads the private blob `ffmetadata/<assetId>.json` from Vercel Blob Storage using `BLOB_READ_WRITE_TOKEN` (same dedicated Aither Blob store as Spec 009).
3. **Serialize to FFMETADATA1** — The ffmetadata JSON is converted to the FFMETADATA1 text format (`;FFMETADATA1` header + `[CHAPTER]` blocks with `TIMEBASE`/`START`/`END`/`title`) by the existing serializer introduced in Spec 009. The final chapter's `end` is clamped to the video duration at mux time (the placeholder zero-length `end` from Spec 009 is replaced with the actual video duration).
4. **Remux with chapter metadata** — FFmpeg is spawned with the raw MP4 as input `0` and the FFMETADATA1 file as input `1`, using `-map_metadata 1 -codec copy` to embed chapters without re-encoding. The remuxed output is written to a transient local file (`<assetId>.chapters.mp4`) only for the duration of the MUX upload, then deleted (Constitution Principle VIII — Direct MUX Upload; no permanent local storage).
5. **Upload to MUX** — The remuxed chaptered MP4 is uploaded directly to MUX; the resulting MUX asset ID is the canonical reference for the chaptered video. The local transient file is removed after a successful upload.
6. **Expose chaptered asset** — The chaptered video is served to the Gaia controller via the MUX CDN playback URL (exposed through the existing streaming endpoint as a redirect/proxy) so the Gaia video controller can address chapters by their `start`/`end` offsets using standard HTML5 `<video>` seek semantics.
7. **Join key** — The `assetId` (recording session id) is the single join key: it identifies the raw MP4 (`<assetId>.mp4`), the ffmetadata JSON blob (`ffmetadata/<assetId>.json`), and the MUX chaptered asset (referenced by a MUX asset ID derived from / linked to `assetId`).

### Chapter Addressing by the Gaia Video Controller

The Gaia video controller addresses an individual chapter by issuing a seek to the chapter's `start` offset (in seconds) and playing until the chapter's `end` offset. The chapter offsets are obtained from the embedded chapter metadata in the MUX chaptered asset (single source of truth at query time; the ffmetadata JSON blob is only the input at regeneration time). The controller does not need to parse the FFMETADATA1 text format — it consumes either:

- the JSON chapter list (via a new Aither endpoint that returns the chapters for an `assetId`, sourced from the MUX chaptered asset), or
- the embedded chapters in the MUX chaptered asset (via the player's native chapter support).

Both representations are derived from the same source of truth (the ffmetadata JSON blob) and are kept consistent by the regeneration step.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Regenerate a Chaptered Video from ffmetadata JSON (Priority: P1)

As a system operator, I want to trigger regeneration of a finalized recording with chapter metadata from the ffmetadata JSON blob, so that the resulting video asset has embedded chapters addressable by the Gaia video controller.

**Why this priority**: Without regeneration, the raw MP4 has no embedded chapters and the Gaia controller cannot address individual chapters directly.

**Independent Test**: Can be fully tested by creating a recording, populating an ffmetadata JSON blob for its `assetId` in Vercel Blob Storage, calling the regeneration endpoint, and verifying the resulting MUX chaptered asset contains chapter tracks matching the ffmetadata JSON (via `ffprobe -show_chapters` on the MUX URL).

**Acceptance Scenarios**:

1. **Given** a finalized recording exists at `output/recordings/<assetId>.mp4` and an ffmetadata JSON blob exists at `ffmetadata/<assetId>.json`, **When** `POST /api/recording/chapters/[id]` is called with the `assetId`, **Then** the system fetches the ffmetadata JSON, serializes it to FFMETADATA1, remuxes the MP4 with `-map_metadata 1 -codec copy`, uploads the chaptered MP4 directly to MUX, deletes the transient local file, and returns `200` with `{ assetId, muxAssetId, chapterCount }`.
2. **Given** no ffmetadata JSON blob exists for the `assetId`, **When** `POST /api/recording/chapters/[id]` is called, **Then** the system returns `404 FFMETADATA_NOT_FOUND` and does not produce a chaptered file.
3. **Given** no raw recording exists for the `assetId`, **When** `POST /api/recording/chapters/[id]` is called, **Then** the system returns `404 RECORDING_NOT_FOUND`.
4. **Given** the recording is still active (not finalized), **When** `POST /api/recording/chapters/[id]` is called, **Then** the system returns `409 RECORDING_IN_PROGRESS`.
5. **Given** the ffmetadata JSON blob fails schema validation (corrupt), **When** `POST /api/recording/chapters/[id]` is called, **Then** the system returns `422 FFMETADATA_INVALID` and does not produce a chaptered file.
6. **Given** the FFmpeg remux step fails, **When** `POST /api/recording/chapters/[id]` is called, **Then** the system returns `502 REMUX_FAILED` with error details logged server-side via Rollbar server logging (`serverInstance.error()`), and no partial transient chaptered file is left on the local filesystem.

---

### User Story 2 — Gaia Controller Addresses an Individual Chapter (Priority: P1)

As the Gaia video controller, I want to retrieve the chapter list for a chaptered video and seek to an individual chapter's start offset, so that I can play back a specific chapter of a seminar recording on demand.

**Why this priority**: Chapter-level addressing is the core value of this feature — it is what enables Gaia to play individual seminar chapters directly.

**Independent Test**: Can be fully tested by regenerating a chaptered video, calling `GET /api/recording/chapters/[id]` to obtain the chapter list, and issuing a playback seek command to a chapter's `start` offset, then verifying the player position matches the chapter start.

**Acceptance Scenarios**:

1. **Given** a chaptered MUX asset exists for `assetId`, **When** `GET /api/recording/chapters/[id]` is called, **Then** the system returns `200` with `{ assetId, chapters: [{ id, start, end, title }, ...] }` where `start`/`end` are in **seconds** (converted from the ffmetadata microseconds), matching the embedded chapters in the MUX chaptered asset.
2. **Given** a chaptered video exists, **When** the Gaia controller sends `POST /api/recording/playback/play` with `{ recordingId, chapterId }`, **Then** the player seeks to the chapter's `start` offset and begins playback, stopping at the chapter's `end` offset (the player emits an `ended`-equivalent event or a chapter-boundary event when the `end` is reached).
3. **Given** no chaptered MUX asset exists for the `assetId` (only the raw MUX asset), **When** `GET /api/recording/chapters/[id]` is called, **Then** the system returns `404 CHAPTERS_NOT_GENERATED` instructing the caller to trigger regeneration first.
4. **Given** the `chapterId` does not match any chapter in the chapter list, **When** `POST /api/recording/playback/play` is called with that `chapterId`, **Then** the system returns `404 CHAPTER_NOT_FOUND`.

---

### User Story 3 — Stream the Chaptered Video to the Player (Priority: P1)

As a system operator, I want the chaptered MP4 to be served via HTTP with Range support, so that the web player (driven by the Gaia controller) can stream and seek within the chaptered video.

**Why this priority**: The player needs an HTTP source with Range support for the chaptered asset; without it, the Gaia controller cannot play chapters.

**Independent Test**: Can be fully tested by requesting `GET /api/recording/stream/[id]` (or a chaptered variant) and verifying the response carries the chaptered MP4 with `video/mp4` content type and 206 Partial Content on Range requests.

**Acceptance Scenarios**:

1. **Given** a chaptered MUX asset exists for `assetId`, **When** `GET /api/recording/stream/[id]` is called, **Then** the server responds with the chaptered video via the MUX CDN URL (redirect or proxy), `Content-Type: video/mp4`, and `Content-Length`.
2. **Given** a chaptered video exists, **When** `GET /api/recording/stream/[id]` is called with a `Range` header, **Then** the server responds with `206 Partial Content` for the requested byte range.
3. **Given** only a raw MUX asset exists (no chaptered variant), **When** `GET /api/recording/stream/[id]` is called, **Then** the server serves the raw MUX asset (existing Spec 004 behavior, unchanged).

---

### Edge Cases

- What happens if the ffmetadata JSON blob's last chapter has a zero-length `end` (placeholder from Spec 009)? The regeneration step MUST clamp the final chapter's `end` to the actual video duration (obtained via `ffprobe` on the raw MP4) before serializing to FFMETADATA1.
- What happens if the ffmetadata JSON contains a single chapter (only one timestamp was ingested)? The chaptered video has one chapter spanning from the timestamp offset to the video duration; this is valid.
- What happens if the video duration is shorter than the last chapter's `start` (clock skew between Uranos and the recording start)? The regeneration step MUST reject the metadata as invalid (to preserve the `end > start` invariant), return `422 FFMETADATA_INVALID`, and log a warning via Rollbar server logging (`serverInstance.error()` with warning severity).
- What happens if regeneration is requested twice for the same `assetId`? The second request overwrites the existing MUX chaptered asset (idempotent re-upload); the response is identical to the first successful regeneration.
- What happens if the ffmetadata JSON blob is updated after a chaptered MUX asset has already been generated? The chaptered MUX asset is NOT automatically regenerated; the operator must re-trigger regeneration explicitly (the ffmetadata JSON is the source of truth at regeneration time only).
- What happens if the Vercel Blob Storage read fails during regeneration? The endpoint returns `503 BLOB_STORAGE_UNAVAILABLE` and does not produce a chaptered file.

### Adjacent API Boundaries

- `POST /api/recording/timestamp` (Spec 009) remains the sole writer of the ffmetadata JSON blob; this feature only reads it.
- `POST /api/recording/start` / `POST /api/recording/stop` (Spec 004) remain the sole controllers of the recording lifecycle; regeneration requires a finalized recording.
- The web player at `/recording/player/[id]` (Spec 004) is reused unchanged; chapter addressing is driven by the Gaia controller via the playback API, not by new player UI.

## API Reference

### Chapter Regeneration & Lookup

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/recording/chapters/[id]` | POST | Regenerate the chaptered video for `assetId` from the ffmetadata JSON blob |
| `/api/recording/chapters/[id]` | GET | Retrieve the chapter list for `assetId` (seconds-based) |

### Playback (extended)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/recording/playback/play` | POST | Play/resume; accepts optional `{ chapterId }` to seek to a chapter's `start` |

### Streaming (extended)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/recording/stream/[id]` | GET | Stream the chaptered MP4 if present, else the raw MP4 (supports Range) |

## Request/Response Schemas

### POST /api/recording/chapters/[id]

**Response 200**:
```json
{
  "assetId": "rec_2026-07-13T10-30-00Z",
  "muxAssetId": "mux_chapters_rec_2026-07-13T10-30-00Z",
  "chapterCount": 5
}
```

**Response 404** (`FFMETADATA_NOT_FOUND` | `RECORDING_NOT_FOUND`):
```json
{ "success": false, "error": { "code": "FFMETADATA_NOT_FOUND", "message": "..." } }
```

**Response 409** (`RECORDING_IN_PROGRESS`):
```json
{ "success": false, "error": { "code": "RECORDING_IN_PROGRESS", "message": "..." } }
```

**Response 422** (`FFMETADATA_INVALID`):
```json
{ "success": false, "error": { "code": "FFMETADATA_INVALID", "message": "..." } }
```

**Response 502** (`REMUX_FAILED`):
```json
{ "success": false, "error": { "code": "REMUX_FAILED", "message": "..." } }
```

### GET /api/recording/chapters/[id]

**Response 200**:
```json
{
  "assetId": "rec_2026-07-13T10-30-00Z",
  "chapters": [
    { "id": 0, "start": 5.0, "end": 20.0, "title": "Chapter 1" },
    { "id": 1, "start": 20.0, "end": 45.0, "title": "Chapter 2" }
  ]
}
```

**Response 404** (`CHAPTERS_NOT_GENERATED`):
```json
{ "success": false, "error": { "code": "CHAPTERS_NOT_GENERATED", "message": "..." } }
```

### POST /api/recording/playback/play (extended)

**Request** (optional `chapterId`):
```json
{ "recordingId": "rec_2026-07-13T10-30-00Z", "chapterId": 1 }
```

**Response 200**:
```json
{ "accepted": true, "chapterId": 1, "start": 20.0, "end": 45.0 }
```

**Response 404** (`CHAPTER_NOT_FOUND`):
```json
{ "success": false, "error": { "code": "CHAPTER_NOT_FOUND", "message": "..." } }
```

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose `POST /api/recording/chapters/[id]` to regenerate a chaptered video for a given `assetId` (recording session id). The endpoint MUST execute **synchronously** — it blocks until the FFmpeg remux completes and returns the final `200` or `502` response (no `202 Accepted` / async job-status model).
- **FR-002**: The `assetId` MUST be the join key between the raw MP4 (`output/recordings/<assetId>.mp4`), the ffmetadata JSON blob (`ffmetadata/<assetId>.json`), and the MUX chaptered asset (referenced by a MUX asset ID linked to `assetId`).
- **FR-003**: The regeneration endpoint MUST read the ffmetadata JSON blob from Vercel Blob Storage at `ffmetadata/<assetId>.json` using `BLOB_READ_WRITE_TOKEN` (same dedicated Aither Blob store as Spec 009). On read failure it MUST return `503 BLOB_STORAGE_UNAVAILABLE`.
- **FR-004**: The regeneration endpoint MUST validate the ffmetadata JSON against `FFMetadataJSONSchema` (Spec 009). On validation failure it MUST return `422 FFMETADATA_INVALID` and MUST NOT produce a chaptered file.
- **FR-005**: The regeneration endpoint MUST reject requests when the recording is still active (status `recording` or `starting`) with `409 RECORDING_IN_PROGRESS`.
- **FR-006**: The regeneration endpoint MUST return `404 RECORDING_NOT_FOUND` when no raw MP4 exists for the `assetId`, and `404 FFMETADATA_NOT_FOUND` when no ffmetadata JSON blob exists.
- **FR-007**: The regeneration step MUST serialize the ffmetadata JSON to the FFMETADATA1 text format (`;FFMETADATA1` header + `[CHAPTER]` blocks) using the existing serializer from Spec 009. The endpoint MUST NOT pass raw JSON to FFmpeg.
- **FR-008**: The regeneration step MUST clamp the final chapter's `end` to the actual video duration (obtained via `ffprobe` on the raw MP4) before serializing to FFMETADATA1, replacing the zero-length placeholder from Spec 009.
- **FR-009**: The regeneration step MUST invoke FFmpeg with `-map_metadata 1 -codec copy` (stream copy, no re-encoding) using the raw MP4 as input `0` and the FFMETADATA1 file as input `1`, writing the output to a transient local file `<assetId>.chapters.mp4`. The transient file MUST be uploaded directly to MUX immediately after remux and MUST be deleted from the local filesystem after a successful MUX upload (Constitution Principle VIII — Direct MUX Upload; no permanent local storage).
- **FR-010**: The regeneration step MUST be idempotent: re-invoking `POST /api/recording/chapters/[id]` for the same `assetId` overwrites the existing MUX chaptered asset (re-upload to MUX) and returns the same response shape.
- **FR-011**: On FFmpeg remux failure, the endpoint MUST return `502 REMUX_FAILED`, log the error via Rollbar server logging (`serverInstance.error()`), and MUST NOT leave a partial transient `<assetId>.chapters.mp4` on the local filesystem.
- **FR-012**: System MUST expose `GET /api/recording/chapters/[id]` to return the chapter list for a chaptered `assetId`. The chapter list MUST be sourced from the embedded chapters in the MUX chaptered asset via `ffprobe -show_chapters` on the MUX playback URL (single source of truth = the MUX chaptered asset, NOT the ffmetadata JSON blob). The response MUST contain `{ assetId, chapters: [{ id, start, end, title }] }` with `start`/`end` in **seconds**, derived from ffprobe chapter timing using either each chapter's rational `time_base` (`seconds = value * numerator / denominator`) or ffprobe `start_time` / `end_time` fields.
- **FR-013**: `GET /api/recording/chapters/[id]` MUST return `404 CHAPTERS_NOT_GENERATED` when no MUX chaptered asset exists for the `assetId` (only the raw MUX asset exists).
- **FR-014**: The chapter list returned by `GET /api/recording/chapters/[id]` MUST be consistent with the chapters embedded in the MUX chaptered asset (both derived from the same ffmetadata JSON blob at regeneration time).
- **FR-015**: The playback endpoint `POST /api/recording/playback/play` MUST accept an optional `chapterId` field. When provided, the player MUST seek to the chapter's `start` offset (in seconds) and begin playback. The response MUST include `{ accepted, chapterId, start, end }`. When the chapter's `end` offset is reached during playback, the player MUST pause at `end` (NOT continue into the next chapter automatically) and emit a `chapter-boundary` event via the existing SSE channel at `/api/recording/events` so Gaia can decide whether to request the next chapter explicitly. The chapter-boundary detection MUST use the player position updates from the existing SSE/HTTP playback state channel at a tick cadence ≤ 500 ms, MUST emit exactly one `chapter-boundary` event per crossed boundary (dedupe key `recordingId:chapterId`), and MUST pause the player within ±500 ms of `chapter.end`.
- **FR-016**: When a `chapterId` is provided and does not match any chapter in the chapter list, the playback endpoint MUST return `404 CHAPTER_NOT_FOUND`.
- **FR-017**: The streaming endpoint `GET /api/recording/stream/[id]` MUST serve the MUX chaptered asset (via MUX CDN URL redirect or proxy) when it exists, and fall back to the raw MUX asset otherwise. It MUST support `Range` requests (206 Partial Content) for seeking (delegated to MUX CDN where applicable). Default transport is HTTP 302 redirect to MUX CDN; proxy mode is only allowed when explicit header control, compliance, or observability requirements make redirect insufficient.
- **FR-018**: All error responses MUST follow the canonical Aither error envelope (`{ success: false, error: { code, message, details? } }`) and MUST NOT leak bearer tokens, internal paths, blob URLs, or secret values. Redaction policy is mandatory: responses and logs MUST exclude bearer tokens, auth cookies, internal filesystem paths, blob storage URLs, and any secret/env-derived values.
- **FR-019**: The regeneration and chapter-lookup endpoints MUST require authentication. The auth model mirrors Spec 009's `requireSyncAccess` guard: a valid service token (Gaia's `URANOS_SYNC_TOKEN`) OR an `admin` Clerk session is authorized; a missing/non-matching token with no session returns `401 UNAUTHORIZED`; an authenticated non-admin session without a valid service token returns `403 FORBIDDEN`.
- **FR-020**: Additionally, the chaptered MP4 MUST be validated post-remux via `ffprobe` to confirm the embedded chapter count matches the ffmetadata JSON `chapters[]` length. On count mismatch, the endpoint MUST return `502 REMUX_FAILED` (per FR-011 cleanup semantics) and delete the partial transient output.

### Chapter Error Code Matrix

| Condition | HTTP Status | Error Code |
|-----------|-------------|------------|
| Invalid `assetId` in path | `400` | `INVALID_REQUEST` |
| No raw recording for `assetId` | `404` | `RECORDING_NOT_FOUND` |
| No ffmetadata JSON blob for `assetId` | `404` | `FFMETADATA_NOT_FOUND` |
| No chaptered MP4 generated yet | `404` | `CHAPTERS_NOT_GENERATED` |
| `chapterId` not in chapter list | `404` | `CHAPTER_NOT_FOUND` |
| Recording still active | `409` | `RECORDING_IN_PROGRESS` |
| ffmetadata JSON fails schema validation | `422` | `FFMETADATA_INVALID` |
| Unauthorized (missing/invalid token, no session) | `401` | `UNAUTHORIZED` |
| Authenticated non-admin session without service token | `403` | `FORBIDDEN` |
| FFmpeg remux failure or chapter-count mismatch | `502` | `REMUX_FAILED` |
| Vercel Blob Storage read failure | `503` | `BLOB_STORAGE_UNAVAILABLE` |
| Internal error | `500` | `INTERNAL_ERROR` |

### Key Entities *(include if feature involves data)*

- **ChapterRegenerationRequest**: Path parameter `assetId` (recording session id).
- **ChapterRegenerationResult**: `{ assetId: string, muxAssetId: string, chapterCount: number }`.
- **ChapterListResponse**: `{ assetId: string, chapters: ChapterSummary[] }`.
- **ChapterSummary**: `{ id: number, start: number, end: number, title: string }` with `start`/`end` in seconds.
- **ChapterPlaybackRequest**: `{ recordingId: string, chapterId?: number }` (extension of Spec 004's playback play request).
- **ChapterPlaybackResult**: `{ accepted: boolean, chapterId?: number, start?: number, end?: number }`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `POST /api/recording/chapters/[id]` with a finalized recording and a valid ffmetadata JSON blob produces a MUX chaptered asset whose embedded chapter count matches the ffmetadata `chapters[]` length in 100% of integration test runs.
- **SC-002**: The MUX chaptered asset produced is a valid MP4 with embedded chapters consumable by `ffprobe -show_chapters` (on the MUX URL) and playable by a standard HTML5 `<video>` element without re-encoding artifacts.
- **SC-003**: `GET /api/recording/chapters/[id]` returns a chapter list whose `start`/`end` (in seconds) match the embedded chapters in the MUX chaptered asset in 100% of tests.
- **SC-004**: `POST /api/recording/playback/play` with a valid `chapterId` seeks the player to the chapter's `start` offset (within ±500 ms) in 100% of playback tests.
- **SC-005**: Regeneration is idempotent — re-invoking the endpoint for the same `assetId` overwrites the chaptered MP4 and returns the same response shape in 100% of tests.
- **SC-006**: Requests without a valid Gaia service token (and no admin session) return `401 UNAUTHORIZED` in 100% of auth tests; authenticated non-admin sessions without a token return `403 FORBIDDEN`.
- **SC-007**: The final chapter's `end` is clamped to the actual video duration (not the zero-length placeholder) in 100% of cases where the ffmetadata JSON's last chapter has a placeholder `end`.
- **SC-008**: No bearer tokens, internal filesystem paths, blob URLs, or secret values appear in any error or success response.
- **SC-009**: On FFmpeg remux failure or chapter-count mismatch, no transient local `<assetId>.chapters.mp4` is left on the local filesystem in 100% of failure-path tests.
