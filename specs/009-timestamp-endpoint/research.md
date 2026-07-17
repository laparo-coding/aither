# Research: 009 — Uranos Timestamp Endpoint

**Date**: 2026-07-13 | **Spec**: `specs/009-timestamp-endpoint/spec.md`

This document resolves the technical unknowns for the Uranos timestamp
ingestion endpoint before planning. All decisions are grounded in the existing
Aither codebase conventions and verified against the current environment.

---

## R1: Endpoint Shape & Placement

### Decision
Expose a single endpoint `POST /api/recording/timestamp` under the existing
recording route group (`src/app/api/recording/`).

### Rationale
- The feature operates on the **active recording session**, which is owned by
  the recording module (`src/lib/recording/session-manager.ts`). Co-locating
  the route keeps recording concerns together (consistent with `start`,
  `stop`, `status`, `upload/[id]`).
- A `POST` verb is correct: each request mutates persisted state (appends a
  chapter and upserts a blob).
- App Router `route.ts` handler pattern is already established across
  `src/app/api/recording/*` — no new architectural pattern is introduced.

### Alternatives considered
- `POST /api/uranos/timestamp` (project-scoped route group): rejected — the
  data domain is *recording*, not *uranos*; the service identity is an auth
  concern, not a routing concern.

---

## R2: Active-Recording Detection & Asset ID

### Decision
Use `isRecording()` and `getSessionState()` from
`src/lib/recording/session-manager.ts`. The **asset id** is the session's
`sessionId` (pattern `rec_YYYY-MM-DDTHH-MM-SSZ`).

### Findings (from code)
- `isRecording()` returns `true` only when `status` is `"recording"` or
  `"starting"`.
- `getSessionState()` returns the full `RecordingSession | null`, exposing
  `sessionId`, `startedAt` (ISO string), `status`, and `filename`.
- The session is in-memory and single-session (mutex-guarded), so at most one
  asset id is active at any time.

### Rationale
- No new "asset id" concept is needed — `sessionId` is already unique,
  filename-safe, and stable for the recording's lifetime.
- `startedAt` provides the reference epoch for computing chapter offsets
  (see R4).

### Consequence for FR-004 / FR-005
- If `isRecording()` is `false` → return `404 NO_ACTIVE_RECORDING`, no blob
  write. This satisfies the hard requirement "Do not write a JSON record if no
  video recording is active."

---

## R3: ffmetadata Chapter Format

### Decision
Persist a JSON document with a top-level `metadata` object and a `chapters[]`
array, each chapter carrying `id`, `start`, `end`, `title`. Times are in
**microseconds** relative to recording start.

### Rationale
- ffmpeg's chapter metadata (the `[CHAPTER]` blocks in an FFMETADATA1 file)
  uses `TIMEBASE=1/1000000` by default; representing `start`/`end` directly in
  microseconds keeps the JSON trivially convertible to the FFMETADATA1 text
  format at write-time downstream (`-i meta -map_metadata 1 -codec copy`).
- Storing structured JSON (rather than the raw FFMETADATA1 text) keeps the
  document machine-readable for appends and validation with Zod, and defers the
  text serialization to the consumer.

### Chapter linking rule
- First chapter: `start = first timestamp offset` (0 only when the first timestamp coincides with recording start), `id = 0`, `title = "Chapter 1"`.
- On each new timestamp: previous chapter's `end` is set to the new chapter's
  `start`; the new chapter's `end` provisionally equals its own `start` until
  the following timestamp (or recording stop) advances it.

### Open note (deferred, out of scope)
- Converting the JSON to the FFMETADATA1 `.txt` format and muxing it into the
  MP4 is a downstream concern (explicitly Out of Scope in the spec).

---

## R4: Timestamp → Offset Conversion

### Decision
`offsetMicros = (receivedUnixSeconds - recordingStartUnixSeconds) * 1_000_000`,
where `recordingStartUnixSeconds = Math.floor(Date.parse(session.startedAt) / 1000)`.

### Rules
- Input `timestamp` is unix **seconds** (positive integer).
- If `receivedUnixSeconds < recordingStartUnixSeconds` → `400 INVALID_TIMESTAMP`
  (FR-012).
- If `timestamp` is not a positive integer → `400 INVALID_REQUEST` (Zod
  validation).

### Rationale
- ffmpeg chapter times are relative to media start, not absolute epoch, so the
  recording's `startedAt` is the natural zero-point.
- Using integer seconds on the wire matches the user requirement ("unix time
  format") and avoids float precision issues; conversion to microseconds is a
  single multiplication.

---

## R5: Vercel Blob Storage Integration

### Decision
Add the `@vercel/blob` dependency and use `put()` to upsert the JSON blob at
path `ffmetadata/<assetId>.json`. Reads use `head()` to obtain the blob URL and
ETag, then `fetch(url, { cache: "no-store" })` with the ETag as a cache-busting
query parameter to avoid stale cached responses. Conditional writes use the
ETag via `ifMatch` to prevent lost updates from concurrent overwrites.

### Verified environment findings
- **Hemera already uses Vercel Blob** with the standard variable
  `BLOB_READ_WRITE_TOKEN` (format `vercel_blob_rw_…`), confirmed in
  `~/GitHub/hemera/.env.local`.
- Aither will use its **own dedicated Blob store / token** (decision:
  independent store, independent rotation, no cross-project access). The token
  is still surfaced as the standard `BLOB_READ_WRITE_TOKEN` env var so the SDK
  picks it up automatically.
- `@vercel/blob` is **not yet a dependency** in Aither's `package.json` — it
  must be added (`npm install @vercel/blob`). Per repo Codacy rules, run a
  Trivy scan (`codacy_cli_analyze` with `tool: trivy`) immediately after
  install.

### `put()` usage (confirmed via clarification 2026-07-13)
```ts
import { put } from "@vercel/blob";

const { url } = await put(
  `ffmetadata/${assetId}.json`,
  JSON.stringify(doc),
  {
    access: "public",           // clarified: public, non-sensitive content
    contentType: "application/json",
    allowOverwrite: true,        // upsert semantics (FR-013)
    addRandomSuffix: false,      // deterministic, stable path (FR-006 / FR-014a)
    token: config.BLOB_READ_WRITE_TOKEN,
  },
);
```

### Config change
- Add `BLOB_READ_WRITE_TOKEN` to `EnvSchema` in `src/lib/config.ts`. Because
  the recording feature is optional at boot (like `WEBCAM_STREAM_URL`), make it
  **optional** in the schema and enforce presence at request time — return
  `503 BLOB_STORAGE_UNAVAILABLE` when missing (FR-018).

### Rationale
- The standard SDK variable name means zero custom wiring for token discovery.
- `allowOverwrite: true` + `addRandomSuffix: false` gives the required
  deterministic upsert on a fixed path keyed by asset id.
- Optional-at-boot mirrors the existing recording/MUX pattern so unrelated
  environments (CI, unit tests) don't fail to load config.

### Alternatives considered
- Local filesystem sidecar next to `output/recordings/`: rejected — the user
  explicitly requires Vercel Blob Storage, and blobs survive ephemeral compute.
- Vercel KV (already wrapped in `token-store-vercel.ts`): rejected — KV is for
  small key/value token caching, not JSON document blobs.

---

## R6: Authentication — Uranos Service User

### Decision
Add a `requireUranosAccess(request, auth)` guard modeled directly on
`requireSyncAccess` in `src/lib/auth/sync-service-auth.ts`. Validate a bearer
token against `URANOS_SYNC_TOKEN` using `timingSafeEqualString`, with an
`admin`-session fallback via `requireAdmin`.

### Findings (from code)
- Gaia's pattern: `requireSyncAccess` extracts the bearer token, compares it
  timing-safely to `process.env.AITHER_SYNC_TOKEN`, returns
  `{ status: 200, body: { authMethod: "service-token", service: "gaia" } }` on
  success, `401 { error: "UNAUTHENTICATED" }` on mismatch, else falls back to
  `requireAdmin(auth)`.
- `timingSafeEqualString` (in `src/lib/auth/timing-safe.ts`) is already the
  project-standard constant-time comparison.
- Keychain scan confirmed `com.uranos.*` service entries already exist
  (codacy/context7) but **no** blob or sync token yet — the Uranos sync token
  must be provisioned.

### Decision on token source
- Introduce `URANOS_SYNC_TOKEN` as the env var (symmetric with
  `AITHER_SYNC_TOKEN` for Gaia). Provision via secrets manager / `.env.local`;
  never commit.

### RBAC note (clarified 2026-07-13)
- The existing `requireSyncAccess` pattern does **not** consult
  `permissions.ts`; it is a token-or-admin gate. `requireUranosAccess` follows
  the same shape and does **not** add a new `Permission`. The previously
  considered `write:ffmetadata` permission is **dropped** — Uranos
  authenticates by shared token (with admin fallback), not a Clerk role.

### Rationale
- Reusing the proven Gaia guard minimizes new security surface and keeps a
  single, auditable auth idiom for server-to-server callers.
- Timing-safe comparison prevents token-oracle timing attacks.
- Never returning token values / internal paths satisfies FR-017 and SC-006.

---

## R7: Concurrency & Lost-Update Prevention

### Decision
Serialize blob read-modify-write per asset id using an in-process async mutex
(a `Map<assetId, Promise>` chain), since the recording session is single-instance
and in-memory.

### Rationale
- Vercel Blob `put` is last-writer-wins; two concurrent appends that both read
  the same base document would drop one chapter.
- The recording module is already single-session and in-memory
  (Constitution: transient in-memory state), so an in-process lock is
  sufficient and consistent with existing design — no distributed lock needed.

### Consequence
- Satisfies FR-016 and SC-005 (no lost chapters under concurrency).

---

## R8: Error Handling & Observability

### Decision
Return the canonical Aither error envelope
(`{ success: false, error: { code, message, details? } }`) and report `5xx`
failures via `reportError` from `src/lib/monitoring/rollbar-official`.

### Mapping (from spec error matrix)
| Condition | Status | Code |
|-----------|--------|------|
| Invalid/missing timestamp | 400 | `INVALID_REQUEST` |
| Timestamp before recording start | 400 | `INVALID_TIMESTAMP` |
| Missing/invalid token (no admin) | 401 | `UNAUTHORIZED` |
| No active recording | 404 | `NO_ACTIVE_RECORDING` |
| Blob write failure / token missing | 503 | `BLOB_STORAGE_UNAVAILABLE` |
| Unexpected | 500 | `INTERNAL_ERROR` |

### Rationale
- Matches existing route conventions (`api-response.ts`,
  controller/sync routes) and keeps Gaia/Uranos error shapes uniform.
- Reporting only `5xx` (not `4xx` client errors) mirrors the controller route's
  Rollbar policy to avoid alert noise.

---

## R9: Testing Strategy

### Decision
Three layers, mirroring the recording module's existing tests:
- **Unit** — chapter-append logic, offset conversion, first-vs-subsequent
  chapter linking, invalid-timestamp guard (pure functions in a new
  `src/lib/recording/ffmetadata.ts`).
- **Contract** — `POST /api/recording/timestamp` I/O shapes and status codes
  (200/400/401/404/503), with `@vercel/blob` and `session-manager` mocked
  (pattern from `tests/contract/recording-api.contract.spec.ts`).
- **Integration (optional)** — auth wiring (token vs admin vs anonymous) and
  serialized concurrency.

### Rationale
- Pure chapter logic is deterministic and cheaply unit-tested.
- Contract tests lock the Uranos-facing API surface.
- Mocking Blob keeps tests hermetic (no network, no real token).

---

## Summary of New/Changed Artifacts (for planning)

| Artifact | Type | Note |
|----------|------|------|
| `src/app/api/recording/timestamp/route.ts` | New | POST handler |
| `src/lib/recording/ffmetadata.ts` | New | chapter build/append + blob upsert |
| `src/lib/recording/schemas.ts` | Change | add `TimestampRequestSchema`, ffmetadata schemas |
| `src/lib/auth/uranos-service-auth.ts` | New | `requireUranosAccess` (mirrors Gaia) |
| `src/lib/config.ts` | Change | add optional `BLOB_READ_WRITE_TOKEN`, `URANOS_SYNC_TOKEN` |
| `package.json` | Change | add `@vercel/blob` (+ Trivy scan per Codacy rule) |
| `.env.example` | Change | document `BLOB_READ_WRITE_TOKEN`, `URANOS_SYNC_TOKEN` |
| tests (unit + contract) | New | per R9 |

## Open Setup Steps (non-code, for quickstart)

1. Create a **dedicated Vercel Blob store** for the Aither project and generate
   its `BLOB_READ_WRITE_TOKEN` (`vercel_blob_rw_…`); add to Aither
   `.env.local` and the Vercel project env.
2. Provision `URANOS_SYNC_TOKEN` (shared secret with the Uranos app); add to
   both Aither and Uranos environments via secrets manager.
