# Implementation Plan: 009 — Uranos Timestamp Endpoint

**Branch**: `009-timestamp-endpoint` | **Date**: 2026-07-13 | **Spec**: `specs/009-timestamp-endpoint/spec.md`
**Input**: Feature specification from `/specs/009-timestamp-endpoint/spec.md`

## Summary

Implement a single authenticated server endpoint `POST /api/recording/timestamp`
that lets the Uranos application push unix-time timestamps while a video
recording is active. Each accepted timestamp is appended as an ffmpeg-compatible
chapter (microsecond timebase) to a per-recording ffmetadata JSON document that
is upserted to a **dedicated Aither Vercel Blob store** at
`ffmetadata/<assetId>.json`. When no recording is active, the endpoint returns
`404 NO_ACTIVE_RECORDING` and writes nothing. Access is secured with a dedicated
Uranos service token (`URANOS_SYNC_TOKEN`) via a Gaia-style token-or-admin guard.
The implementation reuses the existing recording `session-manager`, Zod schema
conventions, the canonical API error envelope, and Rollbar observability.

## Technical Context

**Language/Version**: TypeScript 5.9, Next.js 16 App Router (server route handlers)  
**Primary Dependencies**: Next.js route handlers, `@vercel/blob` (NEW), Zod, existing recording `session-manager`, `timingSafeEqualString`, Vitest  
**Storage**: Vercel Blob Storage (dedicated Aither store) for ffmetadata JSON sidecars; no local database (Constitution VII); in-memory recording session state (transient)  
**Testing**: Vitest (unit + contract), `@vercel/blob` and `session-manager` mocked; optional integration for auth + concurrency  
**Target Platform**: Self-hosted Node.js service on Linux (production), macOS (dev). Dev port 3001.  
**Project Type**: Single web application (Next.js `src/app` + `src/lib` + `tests/`)  
**Performance Goals**: Endpoint p95 < 500 ms (auth → session check → blob read → append → blob write), validated with a dedicated measurement task (FR-020, SC-007)  
**Constraints**: Deterministic blob path, strictly-increasing timestamps, in-process per-asset-id serialization, rate limit 60 req/min per token, no secret/path leakage in responses or logs  
**Scale/Scope**: 1 new route, 1 new lib module group (ffmetadata), 1 new auth guard, schema + config additions, unit/contract tests, contracts + quickstart docs

### Operational Definitions

- **Asset id**: the active recording `sessionId` (pattern `rec_YYYY-MM-DDTHH-MM-SSZ`) from `session-manager`.
- **Timestamp offset (µs)**: `(receivedUnixSeconds - floor(Date.parse(session.startedAt)/1000)) * 1_000_000`.
- **Strictly increasing**: a new timestamp's offset MUST be `>` the current last chapter's `start`; otherwise `400 INVALID_TIMESTAMP`.
- **Upsert**: `put(path, json, { access: "public", contentType: "application/json", allowOverwrite: true, addRandomSuffix: false })`.
- **Representative load**: one active recording, a ffmetadata document that has grown to ≥ 50 chapters.

### Performance Validation Protocol

- Run 30 request samples against `POST /api/recording/timestamp` with an active recording and a warm blob (≥ 50 existing chapters).
- Compute p95 latency from captured durations (discard warm-up sample 1).
- Pass criterion: p95 < 500 ms (FR-020 / SC-007).
- Persist validation evidence to `specs/009-timestamp-endpoint/performance-validation.md` (raw durations, p95 method, fixture identity, pass/fail).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against Aither Constitution v2.7.0.

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Test-First Development | ✅ PASS | Failing contract tests first, then unit tests for ffmetadata logic; ≥ 80 % coverage on new code. |
| II. Code Quality & Formatting | ✅ PASS | Biome-only, TypeScript strict; no new tooling. |
| III. Feature Development Workflow | ✅ PASS | Spec + clarify complete; OpenAPI contract produced in Phase 1 before implementation. |
| IV. Authentication & Security | ✅ PASS | Token-or-admin guard, timing-safe comparison, no PII/secret/path in responses or logs, Rollbar for 5xx. |
| V. Component Architecture | ✅ N/A | No UI surface (server-to-server endpoint only). MUI/Hemera design system not applicable. |
| VI. Holistic Error Handling & Observability | ✅ PASS | Canonical error envelope, Rollbar on 5xx, Zod validation, graceful `503` on blob failure. |
| VII. Stateless Architecture (NON-NEGOTIABLE) | ⚠️ NEEDS JUSTIFICATION | Writing ffmetadata JSON to Vercel Blob is a persistent external write. See Complexity Tracking + note below. |
| VIII. HTML Playback & Video Recording | ⚠️ REVIEW | Principle VIII names MUX as the single video store; ffmetadata is *sidecar metadata*, not video, and lives in Blob (not local disk). Consistent in spirit; see note. |
| IX. Aither Control API | ✅ PASS | New endpoint is authenticated and contract-first; controls no persisted state beyond the blob sidecar. |
| X. Language Policy | ✅ PASS | All code/docs in English; no user-facing German text (no UI). |

### Principle VII / VIII Justification (blocking gate — requires team acknowledgement)

Principle VII states "Data MUST NOT be replicated into local storage" and frames
Aither as a stateless transform layer where **the Hemera API is the single source
of truth**; Principle VIII names **MUX** as the single video store.

The feature deliberately introduces a **persistent write to Vercel Blob Storage**,
a new persistence surface. It is justified because:

1. **Not a local database / not local disk**: Vercel Blob is an external object
   store — it does not reintroduce the DB maintenance/migration/consistency
   concerns Principle VII guards against.
2. **Transform-and-forward semantics preserved**: The ffmetadata JSON is a
   derived output artifact (chapter markers), analogous to the HTML output
   artifacts Principle VII already permits ("HTML as Output Artifact"). It is
   generated from transient timestamps + transient session state; Aither holds
   no long-lived local copy.
3. **Downstream, not source of truth**: The blob is consumed downstream (mux
   step, Out of Scope here). Hemera/MUX remain authoritative; the blob does not
   duplicate Hemera-owned data.

**Explicit deviation record (per Governance › Exception Process)**: This plan
records a deliberate deviation from the strict reading of Principle VII/VIII
(introducing Vercel Blob as an output store).

**Deviation APPROVED (2026-07-13)**: The maintainer accepted Option 1 — use
Vercel Blob Storage (dedicated Aither store) for the ffmetadata sidecar. Fallback
Alternative A (local sidecar under `output/`) is NOT taken. Follow-up (non-blocking):
consider a MINOR constitution amendment that explicitly permits external
object-stores for derived output artifacts, to formalize this and future usage.

**Result**: ✅ PASS. Deviation approved and recorded. All other principles pass.
No unjustified violations.

## Project Structure

### Documentation (this feature)

```text
specs/009-timestamp-endpoint/
├── plan.md              # This file (/speckit.plan output)
├── research.md          # Phase 0 output (present)
├── spec.md              # Feature spec (with Clarifications)
├── data-model.md        # Phase 1 output (this command)
├── quickstart.md        # Phase 1 output (this command)
├── contracts/           # Phase 1 output (this command)
│   ├── timestamp-endpoint.openapi.yaml
│   └── timestamp-endpoint.contract.md
├── performance-validation.md  # Populated during implementation (perf gate)
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── app/
│   └── api/
│       └── recording/
│           └── timestamp/
│               └── route.ts           # NEW — POST handler
├── lib/
│   ├── auth/
│   │   ├── uranos-service-auth.ts      # NEW — requireUranosAccess (mirrors Gaia)
│   │   ├── sync-service-auth.ts        # reference pattern (unchanged)
│   │   └── timing-safe.ts              # reused (unchanged)
│   ├── recording/
│   │   ├── ffmetadata.ts               # NEW — chapter build/append + offset math
│   │   ├── ffmetadata-blob.ts          # NEW — Vercel Blob read/upsert wrapper
│   │   ├── ffmetadata-lock.ts          # NEW — per-asset-id in-process async mutex
│   │   ├── schemas.ts                  # CHANGE — TimestampRequest + ffmetadata schemas
│   │   ├── types.ts                    # CHANGE — inferred types
│   │   └── session-manager.ts          # reused (isRecording/getSessionState)
│   └── config.ts                       # CHANGE — BLOB_READ_WRITE_TOKEN, URANOS_SYNC_TOKEN
└── ...

tests/
├── contract/
│   └── timestamp-api.contract.spec.ts  # NEW — I/O + status codes (blob/session mocked)
└── unit/
    ├── ffmetadata.spec.ts              # NEW — offset math, chapter linking, monotonicity
    ├── ffmetadata-blob.spec.ts         # NEW — upsert/read wrapper (blob mocked)
    ├── ffmetadata-lock.spec.ts         # NEW — serialization / no lost updates
    └── uranos-service-auth.spec.ts     # NEW — token/admin/anon paths

.env.example                            # CHANGE — document new env vars
package.json                            # CHANGE — add @vercel/blob (+ Trivy scan)
```

**Structure Decision**: Single Next.js web application (Option 1). The endpoint
lives in the existing `src/app/api/recording/` route group; reusable logic is
split into small, independently testable `src/lib/recording/` modules
(`ffmetadata`, `ffmetadata-blob`, `ffmetadata-lock`) plus a new auth guard under
`src/lib/auth/`. This matches the established recording-module layout and keeps
the blob and locking concerns isolated for hermetic unit tests.

## Complexity Tracking

> Filled because the Constitution Check has a NON-NEGOTIABLE (VII) deviation
> that must be justified and team-approved.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Persistent write to Vercel Blob (vs. strict Principle VII "no replicated storage") | User explicitly requires ffmetadata JSON stored in Vercel Blob so a downstream mux step can attach chapters to the video. Blob is durable across the stateless, restart-prone service. | **Alt A — local sidecar under `output/`**: rejected — ephemeral/self-hosted disk is not a reliable handoff surface and the requirement names Vercel Blob explicitly. **Alt B — transmit chapters to Hemera API** (pure pass-through): rejected — Hemera exposes no chapter-ingest contract and the artifact is video-scoped, not course-data-scoped. |
| New `@vercel/blob` dependency | First-party SDK for the mandated store; handles auth, upsert, content-type. | Hand-rolled HTTP against the Blob REST API: rejected — more code, more security surface, no benefit. |
| In-process per-asset-id mutex (new concurrency primitive) | Prevents lost-update on read-modify-write of the same blob (FR-016). | Distributed lock (Redis): rejected per clarification — single active recording lives on one instance, so an in-process lock suffices. |

## Phase 0 — Research

**Status**: ✅ Complete. See `specs/009-timestamp-endpoint/research.md` (R1–R9).
All NEEDS CLARIFICATION items were resolved via two `/speckit.clarify` sessions
(concurrency model, rate limit, chapter-end semantics, first-chapter start, auth
model, performance target, monotonicity, blob access).

## Phase 1 — Design & Contracts

**Outputs produced by this command**:

1. `data-model.md` — entities (`TimestampRequest`, `FFMetadataChapter`,
   `FFMetadataJSON`, `TimestampIngestionResult`), validation rules, chapter
   state transitions, and the Zod schema plan.
2. `contracts/timestamp-endpoint.openapi.yaml` + `contracts/timestamp-endpoint.contract.md`
   — the `POST /api/recording/timestamp` contract with all status codes
   (200/400/401/403/404/429/503/500) and request/response shapes.
3. `quickstart.md` — setup (dedicated Aither Blob store token, `URANOS_SYNC_TOKEN`),
   `@vercel/blob` install + Trivy scan, curl examples, and validation steps.
4. Agent context update via `.specify/scripts/bash/update-agent-context.sh copilot`.

**Post-Design Constitution Re-check**: No new violations introduced by the
design. The single conditional item (Principle VII/VIII deviation) is unchanged
and documented above; all other gates remain PASS.

## Phase 2 — Task Planning (NOT executed here)

`/speckit.tasks` will derive dependency-ordered tasks from the contracts and
data model, in TDD order: contract tests → schemas/types → ffmetadata pure logic
→ blob wrapper → lock → auth guard → route wiring → integration → performance
validation. A dedicated performance-validation task will produce
`performance-validation.md` (FR-020 / SC-007) before sign-off.
