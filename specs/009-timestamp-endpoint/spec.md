# Feature Specification: Uranos Timestamp Endpoint

**Feature Branch**: `009-timestamp-endpoint`  
**Created**: 2026-07-13  
**Status**: Draft  
**Input**: User description: "Create an API endpoint that allows the app in project 'uranos' to pass on timestamp information in unix time format periodically. Whenever a record is received, add the timestamp record to the ffmetadata JSON file of the active recording. If no ffmetadata JSON file is available for the active video recording, create one. The ffmetadata JSON file must be named after the asset id of the active video recording. The JSON file needs to comply with the format of chapter metadata that can be used to write a video file with '-map_metadata 1 -codec'. Do not write a JSON record if no video recording is active. Save each JSON file to a Vercel Blob Storage entity. Create a service user for uranos as done for gaia and secure the access to the API endpoint."

## Clarifications

### Session 2026-07-13

- Q: How should concurrent timestamp writes be serialized given serverless/multi-instance runtime? → A: In-process mutex only — the single active recording (FFmpeg capture) lives on one instance, so timestamp requests for that recording land on the same instance; no distributed lock needed.
- Q: Should the endpoint enforce a rate limit, and what policy? → A: 60 requests/minute per token; on exceed return `429 TOO_MANY_REQUESTS` with a `Retry-After` header.
- Q: How is the final chapter's `end` set when recording stops (no successor timestamp)? → A: The last chapter's `end` equals its own `start` (zero-length placeholder); a downstream consumer clamps the final `end` to the video duration at mux time. The timestamp endpoint is NOT coupled to the stop lifecycle.
- Q: Should the first chapter start at 0 or at the first timestamp offset? → A: The first chapter starts with the first timestamp (its `start` = first timestamp offset). Footage before the first timestamp is intentionally un-chaptered.
- Q: Token-or-admin guard only, or also add a `write:ffmetadata` RBAC permission? → A: Token-or-admin only (mirror Gaia's `requireSyncAccess`); do NOT add a `write:ffmetadata` permission. Uranos authenticates via shared token, not a Clerk role.
- Q: (analyze remediation) What does an authenticated non-admin session without a valid token return? → A: `403 FORBIDDEN`. Added to FR-003 and the error matrix for spec/contract consistency.
- Q: (analyze remediation) How is the rate limit keyed for the admin fallback (no token)? → A: Key by service token for token callers, by Clerk `userId` for admin sessions (FR-019).
- Q: (concurrency checklist) On partial failure (blob read ok, write fails), is the in-memory chapter state advanced or rolled back? → A: State advances **only after successful blob write** (write-then-advance). On failure the state is unchanged, so the next request re-attempts the same timestamp idempotently.
- Q: (concurrency checklist) How is a caller retry of the SAME timestamp (after a 503) handled? → A: Idempotent — a timestamp equal to the last accepted offset is accepted without creating a new chapter and returns the existing `chapterId`. This is the only exception to strict monotonicity.
- Q: (concurrency checklist) What happens when the blob read succeeds but the stored JSON fails schema validation (corrupt)? → A: Discard the corrupt blob and create a fresh document starting with the current timestamp as Chapter 1 (resilient; no 503).
- Q: (concurrency checklist) In what order are the rate-limit and active-recording checks performed? → A: Rate limit **before** active-recording check (429 before 404; cheapest-rejection-first after auth).
- Q: (concurrency checklist) What is the scope of the per-asset-id mutex, and is there a lock-hold timeout? → A: Lock wraps only the blob read-modify-write; released on settle (try/finally); no explicit timeout (rely on Vercel Blob network timeout).
- Q: What p95 latency target should serve as an acceptance gate? → A: p95 < 500 ms (accommodates the two Vercel Blob network round-trips: read + write).
- Q: How to handle a timestamp <= the current last chapter's start (duplicate/out-of-order) but >= recording start? → A: Reject with `400 INVALID_TIMESTAMP` — timestamps must be strictly increasing relative to the last chapter's start.
- Q: Should ffmetadata blobs be public or private in Vercel Blob Storage? → A: Private (`access: "private"`, `addRandomSuffix: false`). The response returns the blob key (not a direct URL) to prevent metadata exposure if the URL leaks. Authenticated callers obtain signed URLs via a separate endpoint or server-side proxy.

## Out of Scope

- Modifying the recording capture pipeline (FFmpeg spawn, webcam stream handling) — this feature only reads active recording state and writes metadata sidecar files.
- Uploading or MUX-processing the ffmetadata JSON — the JSON is stored in Vercel Blob Storage only; combining it with the video file via `-map_metadata 1 -codec` is a downstream concern outside Aither.
- Receiving or processing non-timestamp payloads from Uranos (e.g., chapter titles, slide indices) — only unix timestamps are accepted in phase 1.
- Deleting or pruning ffmetadata JSON files from Vercel Blob Storage — lifecycle management is handled separately.
- Browser- or client-side rendering of chapter metadata.

## Architecture Overview

### Timestamp Ingestion Pipeline

```
Uranos App → Aither API (POST /api/recording/timestamp) → Active Recording Check
  → ffmetadata JSON (chapter format) → Vercel Blob Storage
```

1. **Uranos** periodically sends a POST request with a unix timestamp to Aither.
2. **Aither** validates the request via a dedicated Uranos service token (bearer auth, same pattern as Gaia's `AITHER_SYNC_TOKEN`).
3. Aither checks whether a recording session is currently active (`session-manager`).
4. If a recording is active, Aither resolves the recording's **asset id** (the active recording session ID, e.g. `rec_2026-07-13T10-30-00Z`) and either loads or creates the corresponding ffmetadata JSON file named `<assetId>.json`.
5. The timestamp is appended as a new chapter entry to the `chapters[]` array in the ffmetadata JSON.
6. The updated ffmetadata JSON is written to **Vercel Blob Storage** under a deterministic path keyed by the asset id.
7. If no recording is active, Aither returns `404 NO_ACTIVE_RECORDING` and does **not** write any JSON record.

### ffmetadata JSON Format

The ffmetadata JSON file complies with the ffmpeg chapter metadata format usable with `-map_metadata 1 -codec`. Each timestamp record becomes a chapter with `start` (the timestamp converted to microseconds relative to recording start) and `end` (the next chapter's `start`, or a zero-length placeholder for the current last chapter). The JSON structure:

```json
{
  "metadata": {
    "title": "rec_2026-07-13T10-30-00Z",
    "encoder": "aither-ffmetadata"
  },
  "chapters": [
    {
      "id": 0,
      "start": 5000000,
      "end": 20000000,
      "title": "Chapter 1"
    },
    {
      "id": 1,
      "start": 20000000,
      "end": 20000000,
      "title": "Chapter 2"
    }
  ]
}
```

- `start` and `end` are in **microseconds** (ffmpeg's default timebase for ffmetadata chapters).
- The first chapter's `start` is the offset of the **first received timestamp** (relative to recording start). Footage before the first timestamp is intentionally un-chaptered.
- Each subsequent chapter's `start` is the previous chapter's `end`.
- The **last** chapter's `end` equals its own `start` (a zero-length placeholder). It is advanced to the next chapter's `start` when the following timestamp arrives. The timestamp endpoint does NOT finalize the last chapter on recording stop — a downstream consumer clamps the final `end` to the actual video duration at mux time.
- `title` is auto-generated as `Chapter N` (1-indexed) unless a title is provided in the request (future extension).

### Vercel Blob Storage

Each ffmetadata JSON file is stored as a single Vercel Blob Storage entity:

```
ffmetadata/<assetId>.json
```

- The blob path is `ffmetadata/<assetId>.json` where `<assetId>` is the active recording session ID.
- On each timestamp ingestion, the existing blob is overwritten with the updated JSON (upsert semantics via `allowOverwrite: true`, `addRandomSuffix: false`).
- The blob content type is `application/json`.
- The blob is stored with `access: "private"` to prevent unauthorized access even if the blob key leaks (logs, proxies, browser history). The response returns the blob key (`ffmetadata/<assetId>.json`) instead of a direct URL. Authenticated callers who need to read the blob MUST obtain a signed URL via a separate endpoint or server-side proxy.
- Writes require `BLOB_READ_WRITE_TOKEN` (Vercel Blob environment variable), using a **dedicated Aither Blob store** (separate from Hemera's).
- **Atomicity assumption**: Vercel Blob `put` with `allowOverwrite: true` is assumed to be atomic (last-writer-wins, no torn writes). This is an external SDK guarantee relied upon by the in-process mutex design (FR-016).

### Service User for Uranos

Following the same pattern as the Gaia service user (`AITHER_SYNC_TOKEN`), a dedicated service credential is created for Uranos:

- **Service name**: `uranos`
- **Auth mechanism**: Bearer token validated via timing-safe comparison against `URANOS_SYNC_TOKEN` environment variable, with an `admin`-session fallback — mirroring Gaia's `requireSyncAccess` guard exactly.
- **Authorization model**: Token-or-admin gate only. No new RBAC `Permission` is added; the guard does NOT consult `permissions.ts` (Uranos authenticates by shared token, not a Clerk role).
- The token is provisioned via a secrets manager and never committed to the repository.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Ingest a Timestamp During Active Recording (Priority: P1)

As the Uranos application, I need to send a unix timestamp to Aither periodically so that chapter metadata is accumulated for the active video recording and stored in Vercel Blob Storage.

**Why this priority**: Without timestamp ingestion during an active recording, no ffmetadata JSON is produced and the feature has no output.

**Independent Test**: Can be fully tested by starting a recording session, sending a `POST /api/recording/timestamp` with a valid unix timestamp and Uranos bearer token, and verifying that a ffmetadata JSON blob exists in Vercel Blob Storage with a chapter entry corresponding to the timestamp.

**Acceptance Scenarios**:

1. **Given** a recording session is active and no ffmetadata JSON blob exists for the asset id, **When** `POST /api/recording/timestamp` is called with `{ "timestamp": 1720866600 }` and a valid Uranos bearer token, **Then** the API returns `200` with `{ success: true, data: { assetId, chapterId, blobUrl } }` and a new ffmetadata JSON blob is created in Vercel Blob Storage at `ffmetadata/<assetId>.json` containing one chapter whose `start` equals the first timestamp's offset (relative to recording start).
2. **Given** a recording session is active and a ffmetadata JSON blob already exists for the asset id, **When** `POST /api/recording/timestamp` is called with a subsequent unix timestamp, **Then** the API returns `200` and the existing blob is overwritten with an updated `chapters[]` array containing the new chapter appended.
3. **Given** a recording session is active, **When** `POST /api/recording/timestamp` is called with a timestamp that predates the recording start, **Then** the API returns `400 INVALID_TIMESTAMP` and does not modify the blob.

---

### User Story 2 — Reject Timestamp When No Recording Is Active (Priority: P1)

As a system operator, I need Aither to silently reject timestamp ingestion when no video recording is active so that orphaned ffmetadata files are never created.

**Why this priority**: Preventing orphaned metadata is a hard requirement from the user description ("Do not write a JSON record if no video recording is active").

**Independent Test**: Can be fully tested by ensuring no recording is active, sending `POST /api/recording/timestamp`, and verifying a `404` response and no blob write.

**Acceptance Scenarios**:

1. **Given** no recording session is active, **When** `POST /api/recording/timestamp` is called with any timestamp, **Then** the API returns `404 NO_ACTIVE_RECORDING` and no ffmetadata JSON is written to Vercel Blob Storage.
2. **Given** a recording session has just been stopped (status `completed`), **When** `POST /api/recording/timestamp` is called, **Then** the API returns `404 NO_ACTIVE_RECORDING` and no new blob write occurs.

---

### User Story 3 — Secure the Endpoint with a Uranos Service User (Priority: P1)

As a platform owner, I need the timestamp endpoint to require a dedicated Uranos service token so that only the Uranos application can ingest timestamps.

**Why this priority**: The endpoint accepts external input and writes to Vercel Blob Storage; without authentication it is open to abuse.

**Independent Test**: Can be fully tested by sending requests with missing, invalid, or valid bearer tokens and verifying `401`, `403`, and `200` responses respectively.

**Acceptance Scenarios**:

1. **Given** a request without an `Authorization` header, **When** `POST /api/recording/timestamp` is called, **Then** the API returns `401 UNAUTHORIZED`.
2. **Given** a request with a bearer token that does not match `URANOS_SYNC_TOKEN`, **When** `POST /api/recording/timestamp` is called, **Then** the API returns `401 UNAUTHORIZED`.
3. **Given** a request with the correct `URANOS_SYNC_TOKEN` bearer token and an active recording, **When** `POST /api/recording/timestamp` is called with a valid timestamp, **Then** the API returns `200` and processes the timestamp.
4. **Given** a request from an admin-authenticated session (Clerk `admin` role), **When** `POST /api/recording/timestamp` is called with a valid timestamp and an active recording, **Then** the API returns `200` and processes the timestamp (admin fallback, same pattern as `requireSyncAccess`).

---

### Edge Cases

- What happens when two timestamp requests arrive concurrently for the same active recording? (The implementation MUST serialize blob writes per asset id to avoid lost updates.)
- What happens when the Vercel Blob Storage write fails (network error, token expired)? The API returns `503 BLOB_STORAGE_UNAVAILABLE` and the timestamp is not lost from the in-memory chapter state (retry on next request).
- What happens when the unix timestamp is not a positive integer? The API returns `400 INVALID_REQUEST` (Zod validation).
- What happens when a timestamp equals or is earlier than the current last chapter's start (duplicate or out-of-order clock)? If it is **equal** to the last chapter's start, it is treated as an idempotent retry (`200`, no new chapter). If it is **earlier**, the API returns `400 INVALID_TIMESTAMP` and does not modify the blob.
- What happens when the recording session transitions from `recording` to `stopping` during timestamp processing? The timestamp is accepted if the session was still `recording` when the check was performed; the final blob write includes the chapter.
- What happens when the first timestamp arrives significantly after recording start? The first chapter's `start` is the first timestamp's offset (not `0`); footage before it is intentionally un-chaptered. The chapter's `end` is a zero-length placeholder until the next timestamp arrives.

### Adjacent API Boundaries

- `GET /api/recording/status` and `POST /api/recording/start` / `POST /api/recording/stop` are adjacent endpoints and remain out of functional scope for this feature.
- The timestamp endpoint MUST NOT start or stop recordings; it only reads active session state.
- The ffmetadata JSON blob in Vercel Blob Storage is independent of the local recording file in `output/recordings/`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose `POST /api/recording/timestamp` for timestamp ingestion from Uranos.
- **FR-002**: Request body MUST include a single `timestamp` field (unix time, positive integer, seconds since epoch).
- **FR-003**: The endpoint MUST enforce authentication via a bearer token validated against `URANOS_SYNC_TOKEN` (timing-safe comparison), with an admin-session fallback following the `requireSyncAccess` pattern. Specifically: a valid service token OR an `admin` Clerk session → authorized (`200` path); a missing or non-matching token with no session → `401 UNAUTHORIZED`; an authenticated Clerk session that is **not** `admin` and carries no valid service token → `403 FORBIDDEN`.
- **FR-004**: The endpoint MUST check whether a recording session is currently active via `session-manager`. If no recording is active (status is not `recording` or `starting`), the endpoint MUST return `404 NO_ACTIVE_RECORDING` and MUST NOT write any ffmetadata JSON.
- **FR-005**: The **asset id** of the active recording is the recording session ID (e.g. `rec_2026-07-13T10-30-00Z`).
- **FR-006**: The ffmetadata JSON file MUST be named `<assetId>.json` and stored in Vercel Blob Storage at path `ffmetadata/<assetId>.json`.
- **FR-007**: If no ffmetadata JSON blob exists for the active asset id, the endpoint MUST create one with an initial `chapters[]` array containing one chapter with `start=<timestampOffset>` (the offset of the first received timestamp), `end=<timestampOffset>` (zero-length placeholder), `id=0`, and `title="Chapter 1"`. The first chapter's `start` equals the first timestamp offset; it is `0` if and only if the first timestamp coincides with recording start.
- **FR-008**: If a ffmetadata JSON blob already exists, the endpoint MUST load it, set the current last chapter's `end` to the new timestamp offset, append a new chapter whose `start` equals that offset and whose `end` equals its own `start` (zero-length placeholder), and overwrite the blob.
- **FR-009**: The ffmetadata JSON MUST comply with the ffmpeg chapter metadata format: a top-level `metadata` object and a `chapters[]` array where each chapter has `id` (integer), `start` (microseconds), `end` (microseconds), and `title` (string). This JSON is an **intermediate representation** only; a downstream serializer MUST convert it to the FFMETADATA1 text format (with the `;FFMETADATA1` header and `[CHAPTER]` blocks) before passing it to FFmpeg for muxing. The endpoint MUST NOT attempt to pass raw JSON directly to FFmpeg via `-map_metadata`.
- **FR-010**: `start` and `end` values in chapters MUST be in **microseconds** (relative to recording start, not absolute epoch time).
- **FR-011**: The timestamp offset MUST be computed as `(receivedUnixTimestamp - recordingStartUnixTimestamp) * 1_000_000` (seconds to microseconds).
- **FR-012**: The endpoint MUST NOT accept timestamps that predate the recording start; such requests MUST return `400 INVALID_TIMESTAMP`.
- **FR-012a**: Timestamps MUST be **strictly increasing** relative to the current last chapter's `start`. A timestamp whose computed offset is less than or equal to the last chapter's `start` (duplicate or out-of-order) MUST be rejected with `400 INVALID_TIMESTAMP` and MUST NOT modify the blob. (For the first timestamp, only the FR-012 recording-start bound applies.)
- **FR-013**: Each successful ingestion MUST overwrite (upsert) the ffmetadata JSON blob in Vercel Blob Storage with the updated content.
- **FR-014**: The blob content type MUST be `application/json`.
- **FR-014a**: The blob MUST be stored with `access: "private"` and `addRandomSuffix: false` (deterministic, stable path). The response MUST return the blob key (`ffmetadata/<assetId>.json`) instead of a direct URL, so that the metadata is not publicly accessible even if the key leaks. Authenticated callers who need to read the blob MUST obtain a signed URL via a separate endpoint or server-side proxy.
- **FR-015**: If any Vercel Blob Storage operation fails (read via `head()`/`fetch()` or write via `put()`), the endpoint MUST return `503 BLOB_STORAGE_UNAVAILABLE` with a structured error payload. The original error details MUST be logged server-side via `reportError` but MUST NOT be exposed to the client.
- **FR-016**: Concurrent timestamp requests for the same asset id MUST be serialized via an **in-process async mutex** (per-asset-id lock) to prevent lost updates. A distributed/external lock is explicitly NOT required because the active recording (FFmpeg capture) runs on a single instance and timestamp requests for that recording land on the same instance.
- **FR-017**: Error responses MUST follow the canonical Aither error envelope (`{ success: false, error: { code, message, details? } }`) and MUST NOT leak bearer tokens, internal paths, or secret values.
- **FR-018**: The endpoint MUST require `BLOB_READ_WRITE_TOKEN` to be configured; if missing, it returns `503 BLOB_STORAGE_UNAVAILABLE`.
- **FR-018a**: If `URANOS_SYNC_TOKEN` is not configured (unset/empty), all non-admin requests MUST be rejected with `401 UNAUTHORIZED` (the timing-safe comparison fails vacuously). Admin-session fallback remains available. The endpoint MUST NOT crash or return `500` when `URANOS_SYNC_TOKEN` is unset.
- **FR-019**: The endpoint MUST enforce a rate limit of **60 requests/minute per authenticated identity**. The limiter key is the **service token** for token-authenticated callers, and the **Clerk `userId`** for the admin-session fallback. On exceeding the limit it MUST return `429 TOO_MANY_REQUESTS` and include a `Retry-After` header (seconds until the window resets). Clients should apply exponential backoff on `429`. The rate limiter uses a **fixed-window** counter (per-instance, in-memory). A rejected request (`429`) MUST NOT consume quota from the next window.
- **FR-020**: The endpoint's end-to-end latency MUST meet a **p95 < 500 ms** target under representative load (auth → session check → blob read → append → blob write). This is an acceptance gate validated with a dedicated measurement task before implementation sign-off.
- **FR-021**: The in-memory chapter state MUST advance **only after a successful blob write** (write-then-advance). On blob write failure (`503`), the state MUST remain unchanged so the caller can retry the same timestamp idempotently.
- **FR-022**: A timestamp whose offset equals the last accepted chapter's `start` (a retry after a transient `503`) MUST be treated as **idempotent**: accepted with `200`, no new chapter created, and the existing `chapterId` returned. This is the only exception to the strict-monotonicity rule (FR-012a).
- **FR-023**: If the blob read succeeds but the stored JSON fails `FFMetadataJSONSchema` validation (corrupt or manually edited), the endpoint MUST discard the corrupt document and create a fresh ffmetadata JSON starting with the current timestamp as Chapter 1. The endpoint MUST NOT return `503` for this condition.
- **FR-024**: The rate-limit check MUST be performed **before** the active-recording check (cheapest-rejection-first after auth). A rate-limited caller receives `429` even if no recording is active.
- **FR-025**: The per-asset-id mutex MUST wrap only the blob read-modify-write section (read → append → write). The lock MUST be released on settle (resolve or reject) via a `try/finally` guard. No explicit lock-hold timeout is required; the implementation relies on Vercel Blob's network timeout.

### Timestamp Error Code Matrix

| Condition | HTTP Status | Error Code |
|-----------|-------------|------------|
| Invalid/missing timestamp in body | `400` | `INVALID_REQUEST` |
| Timestamp predates recording start, or is not strictly increasing vs. last chapter | `400` | `INVALID_TIMESTAMP` |
| Unauthorized (missing/invalid token, no session) | `401` | `UNAUTHORIZED` |
| Authenticated non-admin session without a valid service token | `403` | `FORBIDDEN` |
| No active recording | `404` | `NO_ACTIVE_RECORDING` |
| Rate limit exceeded (>60/min per token) | `429` | `TOO_MANY_REQUESTS` |
| Vercel Blob Storage write failure | `503` | `BLOB_STORAGE_UNAVAILABLE` |
| Internal error | `500` | `INTERNAL_ERROR` |

### Key Entities *(include if feature involves data)*

- **TimestampRequest**: Inbound payload `{ timestamp: number }` where `timestamp` is a unix epoch in seconds.
- **FFMetadataJSON**: The chapter metadata file stored in Vercel Blob Storage, containing `metadata` and `chapters[]`.
- **FFMetadataChapter**: A single chapter entry: `{ id: number, start: number, end: number, title: string }` with times in microseconds.
- **TimestampIngestionResult**: Response payload `{ assetId: string, chapterId: number, blobKey: string }` where `blobKey` is the Vercel Blob Storage path (e.g. `ffmetadata/<assetId>.json`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `POST /api/recording/timestamp` with a valid timestamp and active recording creates/updates a ffmetadata JSON blob in Vercel Blob Storage in 100% of integration test runs.
- **SC-002**: Requests with no active recording return `404 NO_ACTIVE_RECORDING` and produce no blob writes in 100% of negative-path tests.
- **SC-003**: Requests without a valid Uranos bearer token (and no admin session) return `401 UNAUTHORIZED` in 100% of auth tests.
- **SC-004**: The ffmetadata JSON produced is valid against the ffmpeg chapter metadata schema and can be consumed by `ffmpeg -map_metadata 1 -codec copy` without errors.
- **SC-005**: Concurrent timestamp requests for the same asset id do not result in lost chapters (serialization verified via concurrency test).
- **SC-006**: No bearer tokens, internal filesystem paths, secret values, or direct blob URLs appear in any error or success response. The response returns only the blob key, not a publicly accessible URL.
- **SC-007**: Endpoint latency meets **p95 < 500 ms** across a representative sample run (e.g., 30 requests, warm-up discarded), verified by a dedicated performance measurement task.
- **SC-008**: Non-monotonic timestamps (<= last chapter start) are rejected with `400 INVALID_TIMESTAMP` in 100% of ordering tests, with no blob mutation.
