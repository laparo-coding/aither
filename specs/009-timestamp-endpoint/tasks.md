# Tasks: 009 — Uranos Timestamp Endpoint

**Input**: Design documents from `/specs/009-timestamp-endpoint/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included — contract and unit tests are written before implementation
(Constitution I: Test-First, NON-NEGOTIABLE).

**Organization**: Tasks are grouped by user story (US1–US3) to support
independent delivery and validation. `[P]` = parallelizable (different files, no
ordering dependency). `[USn]` = belongs to that user story.

**Constitution note**: The Principle VII/VIII deviation (Vercel Blob as output
store) was **approved 2026-07-13** — see `plan.md`. No blocking gate remains.

---

## Phase 1: Contract Test-First Gate (Required)

- [X] T001 Write failing contract tests for `POST /api/recording/timestamp` covering the happy path plus core error codes (400 INVALID_REQUEST, 400 INVALID_TIMESTAMP, 401, 404 NO_ACTIVE_RECORDING, 503) in `tests/contract/timestamp-api.contract.spec.ts`, mocking `@vercel/blob`, `@/lib/recording/session-manager`, `@/lib/auth/route-auth`, and `@/lib/monitoring/rollbar-official`.

---

## Phase 2: Setup (Shared Infrastructure)

- [X] T002 Install `@vercel/blob` dependency (`npm install @vercel/blob`), then run the Codacy Trivy scan (`codacy_cli_analyze` with `tool: trivy`) and resolve any new vulnerabilities before proceeding.
- [X] T003 [P] Create the route directory `src/app/api/recording/timestamp/`.
- [X] T004 [P] Add new env vars `BLOB_READ_WRITE_TOKEN` (optional at boot) and `URANOS_SYNC_TOKEN` to `EnvSchema` in `src/lib/config.ts`.
- [X] T005 [P] Document `BLOB_READ_WRITE_TOKEN` and `URANOS_SYNC_TOKEN` in `.env.example`.

---

## Phase 3: Foundational Test-First (Blocking Prerequisites)

- [X] T006 [P] Add unit tests for ffmetadata pure logic (offset computation, first-chapter creation, append/link, strictly-increasing/monotonicity guard, pre-start rejection) in `tests/unit/ffmetadata.spec.ts`.
- [X] T007 [P] Add unit tests for the blob read/upsert wrapper (create-when-missing, overwrite-when-present, 503 on missing token / write failure) with `@vercel/blob` mocked in `tests/unit/ffmetadata-blob.spec.ts`.
- [X] T008 [P] Add unit tests for the per-asset-id in-process mutex (serialized read-modify-write, no lost updates under concurrency) in `tests/unit/ffmetadata-lock.spec.ts`.
- [X] T009 [P] Add unit tests for `requireUranosAccess` (valid token → 200, invalid/missing token → 401, admin session fallback → 200, non-admin → 403; no secret leakage) in `tests/unit/uranos-service-auth.spec.ts`.

---

## Phase 4: Foundational Implementation (Blocking Prerequisites)

- [X] T010 [P] Add Zod schemas `TimestampRequestSchema`, `FFMetadataChapterSchema`, `FFMetadataJSONSchema`, `TimestampIngestionResultSchema` to `src/lib/recording/schemas.ts` (per data-model.md).
- [X] T011 [P] Add inferred types for the new schemas to `src/lib/recording/types.ts`.
- [X] T012 Implement ffmetadata pure logic in `src/lib/recording/ffmetadata.ts`: `computeOffsetMicros(startedAt, timestamp)`, `createDocument(assetId, offset)`, `appendChapter(doc, offset)`, and monotonicity/pre-start validation returning typed errors. Include idempotent-retry handling: a timestamp equal to the last accepted offset returns the existing chapter without appending (FR-022).
- [X] T013 [P] Implement the Vercel Blob wrapper in `src/lib/recording/ffmetadata-blob.ts`: `readFFMetadata(assetId)` (returns null when absent; validates JSON against `FFMetadataJSONSchema` and returns `{ doc: null, corrupt: true }` on validation failure per FR-023) and `writeFFMetadata(assetId, doc)` (`put` with `access:"public"`, `contentType:"application/json"`, `allowOverwrite:true`, `addRandomSuffix:false`); throw a typed `BLOB_STORAGE_UNAVAILABLE` error when token missing or on failure.
- [X] T014 [P] Implement the per-asset-id async mutex in `src/lib/recording/ffmetadata-lock.ts` (`withAssetLock(assetId, fn)`), backed by a `Map<string, Promise>` chain. The lock wraps only the blob read-modify-write section and releases on settle via try/finally (FR-025).
- [X] T015 Implement `requireUranosAccess(request, auth)` in `src/lib/auth/uranos-service-auth.ts`, mirroring `requireSyncAccess`: extract bearer, `timingSafeEqualString` vs `URANOS_SYNC_TOKEN`, admin fallback via `requireAdmin`; return `{ status, body }`.

**Checkpoint**: All domain helpers, schemas, and the auth guard exist and pass
their unit tests in isolation.

---

## Phase 5: User Story 1 — Ingest a Timestamp During Active Recording (Priority: P1)

**Goal**: Accept a valid timestamp during an active recording, create/append the
chapter, and upsert the blob.

**Independent Test**: With a mocked active session and mocked blob, `POST /api/recording/timestamp`
returns 200 and produces a valid ffmetadata document with the expected chapter.

### Tests for User Story 1

- [X] T016 [P] [US1] Extend contract tests: first timestamp creates a one-chapter document (`start` = first offset, blob path == `ffmetadata/<sessionId>.json` per FR-005); subsequent timestamp appends and closes the previous chapter; a non-monotonic timestamp (`<` last chapter start, strictly before) returns `400 INVALID_TIMESTAMP` with no blob write (SC-008); an equal-to-last timestamp returns `200` with the existing `chapterId` (idempotent retry, FR-022) in `tests/contract/timestamp-api.contract.spec.ts`.
- [X] T017 [P] [US1] Extend unit tests: chapter linking across ≥ 3 timestamps and last-chapter placeholder `end == start` in `tests/unit/ffmetadata.spec.ts`.

### Implementation for User Story 1

- [X] T018 [US1] Implement the `POST` handler skeleton in `src/app/api/recording/timestamp/route.ts`: parse+validate body (`TimestampRequestSchema`), read session via `getSessionState()`/`isRecording()`, compute offset.
- [X] T019 [US1] Wire read-modify-write inside `withAssetLock`: `readFFMetadata` → (if corrupt, discard per FR-023) → `createDocument`/`appendChapter` → `writeFFMetadata` → advance in-memory state only after successful write (FR-021); return 200 with `TimestampIngestionResult` (`assetId`, `chapterId`, `blobUrl`). Handle idempotent retry: equal-to-last timestamp returns existing chapterId without appending (FR-022).

**Checkpoint**: Happy path works end-to-end (with mocks) and passes contract tests.

---

## Phase 6: User Story 2 — Reject When No Recording Is Active (Priority: P1)

**Goal**: Never create orphaned metadata; return 404 with no blob write when
inactive.

**Independent Test**: With no active session, `POST /api/recording/timestamp`
returns 404 and performs zero blob writes.

### Tests for User Story 2

- [X] T020 [P] [US2] Contract tests: no active session → 404 NO_ACTIVE_RECORDING and assert `@vercel/blob.put` is never called; just-stopped (`completed`) session → 404 in `tests/contract/timestamp-api.contract.spec.ts`.

### Implementation for User Story 2

- [X] T021 [US2] In `src/app/api/recording/timestamp/route.ts`, short-circuit with 404 NO_ACTIVE_RECORDING before any blob access when `isRecording()` is false.

**Checkpoint**: Inactive-recording path returns 404 with guaranteed no blob write.

---

## Phase 7: User Story 3 — Secure the Endpoint with a Uranos Service User (Priority: P1)

**Goal**: Only the Uranos app (token) or an admin session may ingest timestamps.

**Independent Test**: Missing/invalid token → 401; admin session → 200; non-admin
session → 403.

### Tests for User Story 3

- [X] T022 [P] [US3] Contract tests: missing `Authorization` → 401; wrong bearer → 401; valid `URANOS_SYNC_TOKEN` + active recording → 200; admin session fallback → 200; authenticated **non-admin** session without a valid token → 403 FORBIDDEN (FR-003); assert responses contain no token/secret/path in `tests/contract/timestamp-api.contract.spec.ts`.

### Implementation for User Story 3

- [X] T023 [US3] In `src/app/api/recording/timestamp/route.ts`, gate the handler with `requireUranosAccess(req, await getRouteAuth())` before body parsing; return the guard's status/body on non-200.

**Checkpoint**: All three P1 user stories pass their contract tests independently.

---

## Phase 8: Cross-Cutting Requirements

- [X] T024 Enforce the rate limit (60 req/min per identity — keyed by service token, or by Clerk `userId` for the admin fallback) returning `429 TOO_MANY_REQUESTS` with a `Retry-After` header (FR-019) **before** the active-recording check (FR-024) in `src/app/api/recording/timestamp/route.ts`; add contract test in `tests/contract/timestamp-api.contract.spec.ts`.
- [X] T025 [P] Ensure the canonical error envelope + Rollbar reporting for 5xx (via `reportError`) and confirm no secret/path leakage across all paths (FR-017, SC-006) in `src/app/api/recording/timestamp/route.ts`.
- [X] T026 [P] Add the `500 INTERNAL_ERROR` catch-all and `503 BLOB_STORAGE_UNAVAILABLE` mapping (missing token + write failure) in `src/app/api/recording/timestamp/route.ts`.

---

## Phase 9: Validation & Polish

- [X] T027 Add a concurrency integration test proving no lost chapters when multiple timestamps race for the same asset id (SC-005) in `tests/contract/timestamp-api.contract.spec.ts` (or `tests/unit/ffmetadata-lock.spec.ts`).
- [ ] T028 Performance validation: run the protocol from `plan.md` (30 samples, warm blob ≥ 50 chapters), compute p95, assert < 500 ms (FR-020/SC-007), and record evidence in `specs/009-timestamp-endpoint/performance-validation.md`.
- [X] T029 [P] Validate the produced ffmetadata JSON against the ffmpeg chapter format (SC-004): serialize to FFMETADATA1 and dry-run `ffmpeg -i meta -map_metadata 1 -codec copy` (or a schema-level assertion) in `tests/unit/ffmetadata.spec.ts`.
- [X] T030 Run full quality gates: `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:contract`, `npm run build`; then run `codacy_cli_analyze` on every edited file and fix reported issues.

---

## Dependencies & Execution Order

- **Phase 1 (T001)** must be written first and must fail (Red).
- **Phase 2 (T002–T005)** setup; T002 (install + Trivy) blocks anything importing `@vercel/blob`.
- **Phase 3 (T006–T009)** foundational tests before their implementations.
- **Phase 4 (T010–T015)** foundational implementation; T010/T011 before T012; T012–T015 can proceed in parallel where files differ (`[P]`).
- **Phases 5–7 (US1/US2/US3)** depend on Phase 4; each user story is independently testable. Route file `route.ts` edits (T018/T019/T021/T023/T024/T025/T026) are sequential (same file).
- **Phase 8** cross-cutting, after the core route exists.
- **Phase 9** validation last; T028 (perf) and T030 (gates) gate sign-off.

## Parallelization Guidance

Safe to run in parallel (different files):
- T006, T007, T008, T009 (separate unit test files).
- T010/T011 (schemas/types) with T013/T014 (blob/lock) once T012's interface is defined.
- T016/T017, T020, T022 test authoring for different concerns.

Sequential (same file `src/app/api/recording/timestamp/route.ts`):
- T018 → T019 → T021 → T023 → T024 → T025 → T026.

## Task Summary

- **Total tasks**: 30
- **Test tasks (TDD-first)**: T001, T006–T009, T016–T017, T020, T022, T024, T027, T029
- **Implementation tasks**: T012–T015, T018–T019, T021, T023, T025–T026
- **Setup/validation**: T002–T005, T028, T030
- **Independent MVP**: Phases 1–5 (US1) deliver a working, testable happy path;
  US2 and US3 harden it for production.
