# Implementation Plan: Chapters in Video

**Branch**: `010-chapters-in-video` | **Date**: 2026-07-19 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/010-chapters-in-video/spec.md`

## Summary

Enhance video playback with chapter awareness by regenerating recordings with embedded chapter metadata from ffmetadata JSON (Spec 009). FFmpeg remux with `-map_metadata 1 -codec copy` produces a transient chaptered MP4 that is uploaded directly to MUX (Constitution Principle VIII — Direct MUX Upload), enabling direct chapter addressing by the Gaia controller via new endpoints: `POST /api/recording/chapters/[id]` (regenerate), `GET /api/recording/chapters/[id]` (list chapters), extended `POST /api/recording/playback/play` (seek to chapter), and existing `GET /api/recording/stream/[id]` (stream MUX chaptered asset via CDN redirect/proxy). Synchronous execution; typical remux completes in seconds. The local transient file is deleted after a successful MUX upload — no permanent local storage.

## Technical Context

**Language/Version**: TypeScript 5.9, Next.js 16 App Router  
**Primary Dependencies**: ffmpeg, ffprobe (CLI spawning), @mux/mux-node (MUX upload + asset management), @vercel/blob (Vercel Blob Storage), zod (schema validation)  
**Storage**: MUX (chaptered asset — canonical video store per Constitution Principle VIII); transient local `/output/recordings/` file only during remux + upload, deleted after successful MUX upload. Vercel Blob Storage (ffmetadata JSON read-only), in-memory SSE registry for chapter-boundary events  
**Testing**: vitest (unit + contract tests), Playwright (e2e)  
**Target Platform**: Node.js server (Next.js 16 API routes)  
**Project Type**: Web application (existing Next.js Aither monorepo)  
**Performance Goals**: p95 < 5s for FFmpeg remux (typical 1–2 h, 1–3 GB seminar recordings); p95 < 500ms for ffprobe chapter extraction (on MUX URL)  
**Constraints**: Synchronous execution only (no async job-status polling); stateless design — no local persistent storage (Constitution Principle VII); MUX is single source of truth for video (Principle VIII)  
**Scale/Scope**: Single recording feature (extends Spec 004 Recording Module); ~600–700 lines new/modified code (2 new routes, 4–5 new lib modules incl. MUX upload, 2–3 route extensions)

## Constitution Check

**GATE RESULT: PASS** — All 10 principles satisfied. No violations require justification.

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Test-First Development | ✅ PASS | All new modules (ffmpeg-remux, mux-upload, chapter-extractor, route handlers, extended playback-controller) require contract + unit tests. TDD cycle enforced. 90% coverage on auth-related code, 80% on remaining new code. |
| II. Code Quality & Formatting | ✅ PASS | All new code MUST pass Biome formatting/linting. TypeScript strict mode enforced. |
| III. Feature Development Workflow | ✅ PASS | Specification written (spec.md); contract definition (Phase 1 deliverables); error monitoring via Rollbar (FR-011, FR-018). |
| IV. Authentication & Security | ✅ PASS | Auth model: token-or-admin guard (mirrors Spec 009 `requireSyncAccess`). No bearer tokens, paths, or secrets in responses. Rollbar error logging enforced. |
| V. Component Architecture | ✅ PASS | N/A — This feature is backend-only (API routes, lib modules). No UI components added. Existing playback controller extended (not new component). |
| VI. Holistic Error Handling & Observability | ✅ PASS | Comprehensive error matrix (11 error conditions). Rollbar integration mandatory for all errors. Graceful degradation (transient file cleanup on failure). |
| VII. Stateless Architecture | ✅ PASS | Feature DOES NOT violate Principle VII. Aither reads ffmetadata JSON from Vercel Blob Storage (read-only, external source of truth). The remuxed chaptered MP4 is uploaded directly to MUX (Constitution Principle VIII — Direct MUX Upload); the local `<assetId>.chapters.mp4` is a transient artifact that is deleted after a successful MUX upload. No data is replicated or persisted locally. Consistent with Spec 009 (ffmetadata JSON sourced from external blob) and Spec 004 (MUX as video store). |
| VIII. HTML Playback & Video Recording | ✅ PASS | Feature extends existing video playback (existing web player at `/recording/player/[id]` remains unchanged). Gaia controller drives chapter-addressing via extended playback API (`POST /api/recording/playback/play` with `chapterId`). No new recording pipeline — only remux of existing MP4 followed by direct MUX upload. MUX remains the single source of truth for all video recordings (chaptered and raw). Consistent with Spec 009 (timestamp ingestion) and Spec 004 (recording lifecycle). |
| IX. Aither Control API | ✅ PASS | This feature extends existing Aither recording/playback APIs (contract-first, Phase 1 deliverable). No new control-system API added. |
| X. Deployment & Linux Service | ✅ PASS | Feature integrates with existing Next.js API routes deployed via standard `npm run build && npm start` flow on Linux host. No new deployment concerns. |

## Project Structure

### Documentation (this feature)

```text
specs/010-chapters-in-video/
├── plan.md              # This file (/speckit.plan output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── chapters-endpoint.openapi.yaml
│   └── chapters-endpoint.contract.md
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── lib/recording/
│   ├── ffmpeg-remux.ts              # NEW: Orchestrate FFmpeg remux + transient file
│   ├── chaptered-asset-mapping.ts   # NEW: Persist assetId → { muxAssetId, muxPlaybackUrl } mapping
│   ├── chapter-extractor.ts         # NEW: Extract chapters via ffprobe (MUX URL)
│   ├── ffmetadata.ts                # EXISTING: Reused for JSON serialization
│   ├── ffmetadata-blob.ts           # EXISTING: Reused for blob read
│   ├── file-manager.ts              # EXISTING: Reused for ffprobe invocation
│   ├── playback-controller.ts       # EXTENDED: Add chapter-boundary SSE event
│   ├── schemas.ts                   # EXTENDED: Add chapter-related schemas
│   ├── types.ts                     # EXTENDED: Add inferred chapter types
│   └── ...
├── lib/auth/
│   └── uranos-service-auth.ts       # EXISTING: Reused for token-or-admin guard
├── app/api/recording/
│   ├── chapters/[id]/route.ts       # NEW: GET list chapters, POST regenerate
│   ├── playback/play/route.ts       # EXTENDED: Accept optional chapterId
│   ├── events/route.ts              # EXTENDED: Emit chapter-boundary SSE
│   ├── stream/[id]/route.ts        # EXTENDED: Serve MUX chaptered asset (redirect/proxy)
│   └── ...
└── ...

tests/
├── unit/
│   ├── lib/recording/ffmpeg-remux.spec.ts
│   ├── lib/recording/chaptered-asset-mapping.spec.ts
│   ├── lib/recording/chapter-extractor.spec.ts
│   └── ...
├── contract/
│   ├── recording/chapters-regenerate.spec.ts
│   ├── recording/chapters-list.spec.ts
│   ├── recording/stream-chapters-sanitization.spec.ts
│   └── ...
└── e2e/
    └── recording/chapters.spec.ts
```

**Structure Decision**: Single Next.js project (Option 1 - Aither monorepo). New feature integrates as extension of existing Recording Module (Spec 004). New modules in `src/lib/recording/` follow existing patterns. New route in `src/app/api/recording/chapters/[id]/route.ts` follows Next.js App Router conventions. Extensions to existing routes (playback/play, events, stream) localized to those files. New `mux-upload.ts` module encapsulates MUX API interaction (upload + asset ID resolution).

## Complexity Tracking

> **No Constitution Check violations. Complexity tracking N/A.**

---

## Execution Plan: Phases 0–2

### Phase 0: Outline & Research (THIS PHASE)

**Deliverable**: `research.md` with all technical unknowns resolved.

**Research Tasks** (from Technical Context unknowns):

1. **FFmpeg Remux Command Format** — Capture exact command arguments for `-map_metadata 1 -codec copy` with FFMETADATA1 input file; validate for common codec combinations (H.264, MJPEG, raw video). Document transient output path handling.
2. **MUX Upload API Integration** — Document `@mux/mux-node` direct upload flow: create upload, stream transient chaptered MP4, resolve `muxAssetId`. Confirm idempotent re-upload semantics (overwrite vs. new asset).
3. **ffprobe JSON Output Schema** — Document `ffprobe -show_chapters -of json` output structure on a MUX playback URL; identify chapter field names, timebase handling, unit conversions (seconds vs. microseconds).
4. **FFMETADATA1 Serialization** — Validate existing Spec 009 serializer for completeness; confirm timebase clamping for final chapter's placeholder `end`.
5. **SSE chapter-boundary Event Format** — Define exact event structure (`{ event: "chapter-boundary", chapterId, nextChapterId?, timestamp }`), emit timing (tick cadence ≤ 500 ms), position source (existing SSE/HTTP playback state channel), and dedupe key (`recordingId:chapterId`).
6. **Error Recovery & Cleanup** — Document strategies for transient file cleanup on remux/MUX-upload failure; confirm idempotent re-upload behavior (re-run safety).
7. **Performance Measurement Protocol** — Define how to measure p95 < 5s remux time and p95 < 500ms ffprobe extraction on MUX URL (recording sizes, test harness, metrics).

**Research Approach**: Document findings in `research.md` with Decision/Rationale/Alternatives for each task.

### Phase 1: Design & Contracts

**Deliverables**: `data-model.md`, `contracts/*.openapi.yaml`, `contracts/*.contract.md`, `quickstart.md`, updated agent context.

1. **Extract Entities** → `data-model.md`:
   - ChapterRegenerationRequest, ChapterRegenerationResult (with `muxAssetId` instead of `chaptersFile`)
   - ChapterListResponse, ChapterSummary
   - ChapterPlaybackRequest (extension of PlaybackCommand)
   - ChapterBoundaryEvent (with dedupe key, tick cadence, position source — binding spec)
   - Validation rules (monotonic chapter ordering, timebase conversions, clamping)

2. **Generate API Contracts**:
   - `POST /api/recording/chapters/[id]` (regenerate — returns `muxAssetId`)
   - `GET /api/recording/chapters/[id]` (list chapters — sourced from MUX chaptered asset)
   - `POST /api/recording/playback/play` (extended with optional chapterId)
   - `GET /api/recording/stream/[id]` (MUX CDN redirect/proxy for chaptered asset)
   - Success/error responses (200, 404, 409, 422, 502, 503)
   - Output: `contracts/chapters-endpoint.openapi.yaml`, `contracts/chapters-endpoint.contract.md`

3. **Quickstart** → `quickstart.md`:
   - FFmpeg/ffprobe availability check
   - MUX environment variables check (`MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`)
   - curl examples (both endpoints, with `muxAssetId` response)
   - Common error scenarios (missing blob, active recording, invalid ffmetadata, MUX upload failure)
   - Expected chapter list format

4. **Agent Context Update**:
   - Run `.specify/scripts/bash/update-agent-context.sh copilot`
   - Adds 010-chapters-in-video tech patterns to Copilot instructions

5. **Re-evaluate Constitution Check** — Confirm all 10 principles still PASS post-Phase-1 design.

### Phase 2: Task Planning

**Deliverable**: `tasks.md` with dependency-ordered implementation tasks.

**Expected Task Sequence** (TDD-first):

1. **Schema & Type Definitions** (unit tests)
2. **Contract Tests** (API I/O validation, error codes)
3. **FFmpeg Remux Module** (`ffmpeg-remux.ts` with unit tests)
4. **MUX Upload Module** (`mux-upload.ts` with unit tests)
5. **Chapter Extractor Module** (`chapter-extractor.ts` with unit tests)
6. **Regenerate Endpoint** (`POST /api/recording/chapters/[id]` with contract + e2e tests)
7. **List Chapters Endpoint** (`GET /api/recording/chapters/[id]` with contract + e2e tests)
8. **Extended Playback Route** (`POST /api/recording/playback/play` with optional `chapterId`)
9. **Extended Events Route** (`GET /api/recording/events` for `chapter-boundary` SSE)
10. **Extended Stream Route** (`GET /api/recording/stream/[id]` to serve MUX chaptered asset)
11. **Integration Tests** (full regenerate → list → playback → stream workflow)
12. **Performance Validation** (measure p95 remux, p95 extraction on MUX URL)

---

**Note**: Phase 0 research resolves all "NEEDS CLARIFICATION" items in Technical Context. Phases 1–2 proceed sequentially after Phase 0 complete. The existing `tasks.md` already contains the MUX-aligned task breakdown (45 tasks across 5 phases).
