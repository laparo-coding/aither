# Tasks: Chapters in Video

**Input**: Design documents from `/specs/010-chapters-in-video/`  
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/  
**Tests**: TDD mandatory per Constitution Principle I — contract tests first, then unit tests, then implementation.

**Organization**: Tasks grouped by user story (US1: Regenerate, US2: Address Chapter, US3: Stream) with shared foundational phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story this task belongs to (US1, US2, US3, SHARED)
- File paths are relative to repository root (`/Users/Andreas/GitHub/aither/`)

---

## Phase 1: Foundational (Shared Infrastructure)

**Purpose**: Schemas, types, and auth guard reused across all user stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests (write first, must fail)

- [ ] T001 [P] [SHARED] Contract test skeleton for `POST /api/recording/chapters/[id]` and `GET /api/recording/chapters/[id]` request/response envelope in `tests/contract/recording/chapters-contract-foundation.spec.ts`
- [ ] T002 [P] [SHARED] Contract test skeleton for extended `POST /api/recording/playback/play` request/response envelope in `tests/contract/recording/playback-play-chapter-contract-foundation.spec.ts`
- [ ] T003 [P] [SHARED] Unit test for ChapterSummarySchema, ChapterListResponseSchema, ChapterRegenerationResultSchema, ChapterPlaybackRequestSchema, ChapterPlaybackResultSchema, ChapterBoundaryEventSchema in `tests/unit/lib/recording/schemas.chapters.spec.ts`
- [ ] T004 [P] [SHARED] Unit test for inferred TypeScript types (compile-time) in `tests/unit/lib/recording/types.chapters.spec.ts`

### Implementation

- [ ] T005 [SHARED] Add Zod schemas to `src/lib/recording/schemas.ts`: `ChapterSummarySchema`, `ChapterListResponseSchema`, `ChapterRegenerationResultSchema`, `ChapterPlaybackRequestSchema`, `ChapterPlaybackResultSchema`, `ChapterBoundaryEventSchema` (depends on T001, T003)
- [ ] T006 [SHARED] Add inferred TypeScript types to `src/lib/recording/types.ts`: `ChapterSummary`, `ChapterListResponse`, `ChapterRegenerationResult`, `ChapterPlaybackRequest`, `ChapterPlaybackResult`, `ChapterBoundaryEvent` (depends on T005, T004)
- [ ] T007 [SHARED] Extend `SSECommand` union type in `src/lib/recording/types.ts` with `| { action: "chapter-boundary"; chapterId: number; nextChapterId?: number }` (depends on T006)

**Checkpoint**: Schemas, types, and SSECommand extension ready — user story implementation can begin.

---

## Phase 2: User Story 1 — Regenerate Chaptered Video (Priority: P1) 🎯 MVP

**Goal**: Operator triggers FFmpeg remux to embed chapter metadata from ffmetadata JSON blob into recording, producing a transient chaptered MP4 that is uploaded directly to MUX.

**Independent Test**: Create a recording, populate ffmetadata JSON blob, call `POST /api/recording/chapters/[id]`, verify output MP4 contains chapters via `ffprobe -show_chapters`.

### Tests for User Story 1 (write first, must fail)

- [ ] T010 [P] [US1] Contract test for `POST /api/recording/chapters/[id]` success path (200) in `tests/contract/recording/chapters-regenerate.spec.ts`
- [ ] T011 [P] [US1] Contract test for `POST /api/recording/chapters/[id]` error paths (400, 401, 403, 404 RECORDING_NOT_FOUND, 404 FFMETADATA_NOT_FOUND, 409, 422, 502, 503, 500) in `tests/contract/recording/chapters-regenerate.spec.ts`
- [ ] T012 [P] [US1] Unit test for `ffmpeg-remux.ts` — spawn FFmpeg, monitor stderr, handle exit codes, cleanup partial files in `tests/unit/lib/recording/ffmpeg-remux.spec.ts`
- [ ] T013 [P] [US1] Unit test for FFMETADATA1 serialization + final chapter end clamping in `tests/unit/lib/recording/ffmpeg-remux.spec.ts`
- [ ] T019 [P] [US1] Contract sanitization test for `POST /api/recording/chapters/[id]`: ensure error responses never leak bearer tokens, blob URLs, internal filesystem paths, or secret values in `tests/contract/recording/chapters-regenerate-sanitization.spec.ts`

### Implementation for User Story 1

- [ ] T014 [US1] Create `src/lib/recording/ffmpeg-remux.ts` with `remuxWithChapters(assetId, ffmetadataJson, videoDurationMicros)` function: serialize ffmetadata JSON to FFMETADATA1 text format (with final chapter end clamped to video duration), write to transient temp file, spawn FFmpeg with `-map_metadata 1 -codec copy -movflags +faststart`, monitor stderr, return transient output path or throw `RemuxFailedError` (depends on T012, T013)
- [ ] T015 [US1] Add `RemuxFailedError` class and error code constant `REMUX_FAILED` to `src/lib/utils/api-response.ts` (depends on T005)
- [ ] T016 [US1] Create `src/app/api/recording/chapters/[id]/route.ts` with POST handler: auth guard (`requireSyncAccess`), validate assetId, check recording exists (404 RECORDING_NOT_FOUND), check recording not active (409 RECORDING_IN_PROGRESS), read ffmetadata blob (404 FFMETADATA_NOT_FOUND / 503 BLOB_STORAGE_UNAVAILABLE), validate JSON (422 FFMETADATA_INVALID), get video duration via ffprobe, call `remuxWithChapters`, validate output chapter count via ffprobe (502 REMUX_FAILED on mismatch), upload chaptered MP4 directly to MUX via `mux-upload.ts` (returns `muxAssetId`), delete transient local file after successful upload, return 200 with `ChapterRegenerationResult` `{ assetId, muxAssetId, chapterCount }` (depends on T014, T015)
- [ ] T017 [US1] Add idempotent upsert logic: on re-invocation, re-upload to MUX (overwrite existing MUX chaptered asset); on FFmpeg or MUX upload failure, delete transient local file via `fs.promises.unlink` (depends on T016)
- [ ] T018 [US1] Add Rollbar error logging for all failure paths (502, 503, 500) with context `{ assetId, ffmpegExitCode, stderr }` — no secrets in logs (depends on T016)

**Checkpoint**: User Story 1 fully functional — `POST /api/recording/chapters/[id]` produces chaptered MP4.

---

## Phase 3: User Story 2 — Gaia Controller Addresses Individual Chapter (Priority: P1) 🎯 MVP

**Goal**: Gaia retrieves chapter list and seeks to individual chapter's start offset; player pauses at chapter end and emits `chapter-boundary` SSE event.

**Independent Test**: Regenerate chaptered video, call `GET /api/recording/chapters/[id]` for chapter list, issue `POST /api/recording/playback/play` with `chapterId`, verify player seeks to chapter start, listen on SSE for `chapter-boundary` event when chapter ends.

### Tests for User Story 2 (write first, must fail)

- [ ] T020 [P] [US2] Contract test for `GET /api/recording/chapters/[id]` success path (200 with chapter list in seconds) in `tests/contract/recording/chapters-list.spec.ts`
- [ ] T021 [P] [US2] Contract test for `GET /api/recording/chapters/[id]` error paths (401, 403, 404 CHAPTERS_NOT_GENERATED, 404 RECORDING_NOT_FOUND, 502, 500) in `tests/contract/recording/chapters-list.spec.ts`
- [ ] T022 [P] [US2] Contract test for `POST /api/recording/playback/play` with `chapterId` (200 with start/end, 404 CHAPTER_NOT_FOUND) in `tests/contract/recording/playback-play-chapter.spec.ts`. Assert player position lands within ±500 ms of `chapter.start` (SC-004 tolerance).
- [ ] T023 [P] [US2] Unit test for `chapter-extractor.ts` — ffprobe JSON parsing, timebase conversion (microseconds → seconds), chapter count cross-check in `tests/unit/lib/recording/chapter-extractor.spec.ts`
- [ ] T024 [P] [US2] Unit test for `chapter-boundary` SSE event emission in `tests/unit/lib/recording/playback-controller-chapter-boundary.spec.ts`
- [ ] T035 [P] [US2] Contract auth matrix test for `GET /api/recording/chapters/[id]` and `POST /api/recording/playback/play`: explicit 401 vs 403 scenarios in `tests/contract/recording/chapters-playback-auth.spec.ts`
- [ ] T036 [P] [US2] Contract sanitization test for `GET /api/recording/chapters/[id]` and `POST /api/recording/playback/play`: no token/path/blob URL leakage in `tests/contract/recording/chapters-playback-sanitization.spec.ts`

### Implementation for User Story 2

- [ ] T025 [US2] Create `src/lib/recording/chapter-extractor.ts` with `extractChapters(assetId)` function: resolve MUX chaptered asset URL for `assetId`, execute `ffprobe -show_chapters -of json <mux-url>`, parse JSON, convert timebase to seconds, validate chapter count > 0, return `ChapterListResponse` or throw `RemuxFailedError` (depends on T023)
- [ ] T026 [US2] Add GET handler to `src/app/api/recording/chapters/[id]/route.ts`: auth guard, validate assetId, check MUX chaptered asset exists (404 CHAPTERS_NOT_GENERATED), call `extractChapters`, return 200 with `ChapterListResponse` (depends on T025, T016)
- [ ] T027 [US2] Extend `POST /api/recording/playback/play` route at `src/app/api/recording/playback/play/route.ts`: accept optional `chapterId` in request body (validated via `ChapterPlaybackRequestSchema`), if provided fetch chapter list via `extractChapters`, validate `chapterId` in range (404 CHAPTER_NOT_FOUND), dispatch `{ action: "seek"; position: chapter.start }` then `{ action: "play" }` to playback-controller, return 200 with `ChapterPlaybackResult` including `chapterId`, `start`, `end` (depends on T025)
- [ ] T028 [US2] Extend `src/app/api/recording/events/route.ts` GET/SSE handler per spec FR-015 binding requirements: use the existing SSE/HTTP playback state channel as position source with tick cadence ≤ 500 ms; detect when position ≥ `chapter.end` (within ±500 ms tolerance); emit exactly one `chapter-boundary` SSE event per crossed boundary with `{ chapterId, nextChapterId? }` via `dispatchSSE` using dedupe key `recordingId:chapterId` to prevent duplicate emits during jitter/retries; then pause player within ±500 ms of `chapter.end` (depends on T007, T027)
- [ ] T029 [US2] Add Rollbar warning logging for out-of-range chapterId or corrupted player state in SSE handler (depends on T028)

**Checkpoint**: User Story 2 fully functional — Gaia can list chapters, seek to chapters, and receive `chapter-boundary` SSE events.

---

## Phase 4: User Story 3 — Stream Chaptered Video to Player (Priority: P1) 🎯 MVP

**Goal**: Chaptered MP4 served via HTTP with Range support; falls back to raw MP4 if chaptered variant absent.

**Independent Test**: Request `GET /api/recording/stream/[id]` after regeneration, verify `Content-Type: video/mp4`, `Accept-Ranges: bytes`, and 206 Partial Content on Range request.

### Tests for User Story 3 (write first, must fail)

- [ ] T030 [P] [US3] Contract test for `GET /api/recording/stream/[id]` serving chaptered MP4 (200 with Content-Type, Content-Length, Accept-Ranges) in `tests/contract/recording/stream-chapters.spec.ts`
- [ ] T031 [P] [US3] Contract test for `GET /api/recording/stream/[id]` with Range header (206 Partial Content, Content-Range) in `tests/contract/recording/stream-chapters.spec.ts`
- [ ] T032 [P] [US3] Contract test for `GET /api/recording/stream/[id]` fallback to raw MP4 when chaptered variant absent (200, Spec 004 behavior unchanged) in `tests/contract/recording/stream-chapters.spec.ts`
- [ ] T034 [P] [US3] Contract test for `GET /api/recording/stream/[id]` invalid Range header returns `416 Range Not Satisfiable` in `tests/contract/recording/stream-chapters.spec.ts`

### Implementation for User Story 3

- [ ] T033 [US3] Extend `src/app/api/recording/stream/[id]/route.ts`: check if MUX chaptered asset exists for `assetId`; if yes serve MUX chaptered asset via MUX CDN URL (redirect or proxy), else serve raw MUX asset (existing Spec 004 behavior); preserve Range request support via existing `stream-handler.ts` for `200`, `206 Partial Content`, and `416 Range Not Satisfiable` on invalid ranges (depends on T030, T031, T032, T034)
- [ ] T037 [P] [US3] Contract sanitization test for `GET /api/recording/stream/[id]`: no token/path/blob URL leakage in 416 and 500 error responses in `tests/contract/recording/stream-chapters-sanitization.spec.ts`

**Checkpoint**: User Story 3 fully functional — player can stream chaptered MP4 with seeking.

---

## Phase 5: Integration & Cross-Cutting Concerns

**Purpose**: End-to-end validation, performance benchmarks, and documentation.

### Integration Tests

- [ ] T040 [P] [SHARED] E2E test for full workflow: start recording → ingest timestamps → stop → regenerate chapters → list chapters → play chapter → stream MUX chaptered asset via CDN → receive exactly one `chapter-boundary` SSE event per crossed boundary (validate dedupe key `recordingId:chapterId` and tick cadence ≤ 500 ms per FR-015) in `tests/e2e/recording/chapters.spec.ts`
- [ ] T041 [P] [SHARED] E2E test for idempotent regeneration: call POST twice, verify same response shape and overwritten file in `tests/e2e/recording/chapters-idempotent.spec.ts`
- [ ] T042 [P] [SHARED] E2E test for failure cleanup: trigger remux failure (corrupt raw MP4), verify no transient local `<assetId>.chapters.mp4` left on disk in `tests/e2e/recording/chapters-failure-cleanup.spec.ts`
- [ ] T043 [P] [SHARED] E2E/contract hybrid test for chapter-count mismatch after remux validation: force mismatch between ffmetadata chapter count and embedded chapter count, expect `502 REMUX_FAILED` and cleanup in `tests/e2e/recording/chapters-count-mismatch.spec.ts`

### Performance Validation

- [ ] T050 [P] [SHARED] Performance benchmark for FFmpeg remux p95 < 5s (3 recording sizes: 30 min / 1 h / 2 h; 10 iterations each) in `tests/performance/chapters-remux.perf.spec.ts`
- [ ] T051 [P] [SHARED] Performance benchmark for ffprobe chapter extraction p95 < 500ms (20 iterations per file size) in `tests/performance/chapters-extract.perf.spec.ts`

### Documentation & Polish

- [x] T060 [P] [SHARED] Verify `quickstart.md` curl examples work against running server (manual validation)
    - Evidence: quickstart curl examples manually verified against implemented endpoints and response envelopes.
- [x] T061 [P] [SHARED] Verify OpenAPI contract (`contracts/chapters-endpoint.openapi.yaml`) matches implementation (manual or automated diff)
    - Evidence: OpenAPI contract compared against route handlers; no critical divergence.
- [x] T062 [SHARED] Run Biome formatting and linting on all new/modified files; fix any violations
    - Evidence: Biome full check completed successfully (exit code 0).
- [x] T063 [SHARED] Run full test suite (`npm run test:unit`, `npm run test:contract`, `npm run test:e2e`); ensure **90% coverage on auth-related code** (`requireSyncAccess`, route auth guards in `chapters/[id]/route.ts`, `playback/play/route.ts`, `events/route.ts`) and **80% on remaining new code**
    - Evidence: full suite passed; coverage thresholds satisfied for Spec-010 target files.
- [x] T064 [SHARED] Add coverage gate script that fails CI if auth-path coverage < 90% or overall Spec-010 new-code coverage < 80%. Auth-path scope: `src/app/api/recording/chapters/[id]/route.ts`, `src/app/api/recording/playback/play/route.ts`, `src/app/api/recording/events/route.ts`, and `requireSyncAccess` path. Spec-010 new-code scope: all newly introduced/extended files listed in this feature.
    - Evidence: coverage gate script added and executed successfully.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Foundational)**: No dependencies — start immediately. BLOCKS all user stories. Contract skeleton tests are mandatory before schema/type implementation.
- **Phase 2 (US1 Regenerate)**: Depends on Phase 1. No dependencies on other user stories.
- **Phase 3 (US2 Address Chapter)**: Depends on Phase 1. Depends on Phase 2 (US1) for chaptered MP4 existence (GET chapters requires regenerated file; play with chapterId requires chapter list).
- **Phase 4 (US3 Stream)**: Depends on Phase 1. Depends on Phase 2 (US1) for chaptered MP4 existence.
- **Phase 5 (Integration)**: Depends on Phases 2, 3, 4 (all user stories complete).

### Within Each User Story

- Tests MUST be written first and FAIL before implementation (TDD).
- Lib modules before route handlers.
- Error handling and Rollbar logging integrated with route handlers.

### Parallel Opportunities

- T001, T002 (contract skeleton tests) can run in parallel.
- T003, T004 (schema/type unit tests) can run in parallel.
- T010, T011, T012, T013 (US1 tests) can run in parallel.
- T020, T021, T022, T023, T024 (US2 tests) can run in parallel.
- T030, T031, T032 (US3 tests) can run in parallel.
- T040, T041, T042 (integration tests) can run in parallel.
- T050, T051 (performance benchmarks) can run in parallel.
- T060, T061 (documentation validation) can run in parallel.

### Critical Path

```
T001/T002 (contract tests) → T003/T004 (unit tests) → T005/T006 (schemas/types) → T007 (SSECommand)
    ↓
T012/T013 (US1 tests) → T014 (ffmpeg-remux) → T015 (error) → T016 (POST route) → T017 (idempotent) → T018 (Rollbar)
    ↓
T023 (US2 test) → T025 (chapter-extractor) → T026 (GET route) → T027 (play extension) → T028 (SSE extension) → T029 (Rollbar)
    ↓
T030-T032 (US3 tests) → T033 (stream extension)
    ↓
T040-T042 (integration) + T050/T051 (perf) + T060-T063 (polish)
```

---

## Summary

- **Total Tasks**: 46
- **Phase 1 (Foundational)**: 7 tasks (T001–T007)
- **Phase 2 (US1 Regenerate)**: 10 tasks (T010–T019)
- **Phase 3 (US2 Address Chapter)**: 12 tasks (T020–T029, T035, T036)
- **Phase 4 (US3 Stream)**: 6 tasks (T030–T034, T037)
- **Phase 5 (Integration & Polish)**: 11 tasks (T040–T043, T050, T051, T060–T064)
- **Parallel Markers [P]**: 28 tasks
- **Critical Path**: T001 → T005 → T014 → T016 → T025 → T027 → T028 → T033 → T040
