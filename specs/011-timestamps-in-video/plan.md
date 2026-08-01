# Implementation Plan: Timestamps in Video

**Branch**: `011-timestamps-in-video` | **Date**: 2026-08-01 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/011-timestamps-in-video/spec.md`

## Summary

Bring the Aither web player (`/recording/player/[id]`) to behavioral parity with the Gaia controller's timestamp playback (Gaia Spec 010). The web player fetches the chapter list via the existing `GET /api/recording/chapters/[id]` endpoint (Spec 010) on mount, seeks to `chapters[0].start` on the first `play` command, and exposes a **"Next Timestamp" button** that performs a client-side seek to the next chapter (first chapter with `start > currentPosition`). The `POST /api/recording/playback/play` endpoint is extended so that when no `chapterId` is provided and a chaptered asset exists, it auto-seeks to `chapters[0].start` before playing — ensuring consistency across all clients (Gaia, web player, dashboard). No new data models, no new endpoints; reuses Spec 010's chapter infrastructure.

## Technical Context

**Language/Version**: TypeScript 5.9, Next.js 16 App Router, React 19
**Primary Dependencies**: Existing `GET /api/recording/chapters/[id]` (Spec 010), existing `POST /api/recording/playback/play` (Spec 004 + Spec 010), HTML5 `<video>` seek semantics, EventSource (SSE)
**Storage**: No new storage. Chapter list held in client-side React state (fetched on mount). Server-side playback state remains in-memory (Spec 010).
**Testing**: vitest (unit + contract tests), Playwright (e2e)
**Target Platform**: Node.js server (Next.js 16 API routes) + browser (web player client component)
**Project Type**: Web application (existing Next.js Aither monorepo)
**Performance Goals**: "Next Timestamp" seek ≤ 200 ms from button press to position change (NFR-001, client-side seek, no network round-trip)
**Constraints**: Headless player surface (no native video controls, NFR-003); backward compatibility with Spec 004 (non-chaptered recordings); no changes to Spec 010's `chapter-boundary` SSE semantics
**Scale/Scope**: ~150–250 lines new/modified code (1 route extension, 1 client component extension, 1 new pure lib function)

## Constitution Check

**GATE RESULT: PASS** — All 10 principles satisfied. No violations require justification.

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Test-First Development | ✅ PASS | New `nextTimestamp` pure function + route extension require unit + contract tests. TDD cycle enforced. E2E for web player button behavior. |
| II. Code Quality & Formatting | ✅ PASS | All new code MUST pass Biome formatting/linting. TypeScript strict mode enforced. |
| III. Feature Development Workflow | ✅ PASS | Specification written (spec.md); this plan; tasks.md to follow. |
| IV. Authentication & Security | ✅ PASS | No new auth surfaces. Reuses existing `requireAdmin` on `POST /api/recording/playback/play`. Web player chapter fetch uses existing auth on `GET /api/recording/chapters/[id]`. |
| V. Component Architecture | ✅ PASS | Web player is an existing client component; extension is localized. New `nextTimestamp` pure function is framework-agnostic and testable. |
| VI. Holistic Error Handling & Observability | ✅ PASS | Graceful degradation: if chapter fetch fails (`404 CHAPTERS_NOT_GENERATED`), player falls back to existing headless behavior. No new error paths on the server; route extension reuses existing error codes. |
| VII. Stateless Architecture | ✅ PASS | No new persistent state. Chapter list is client-side only (fetched per page load). Server-side playback state remains in-memory (Spec 010). |
| VIII. HTML Playback & Video Recording | ✅ PASS | Feature extends existing web player HTML5 `<video>` playback. No new recording pipeline. MUX remains single source of truth for video. |
| IX. Aither Control API | ✅ PASS | Extends existing `POST /api/recording/playback/play` API (contract-first). No new control-system API. |
| X. Deployment & Linux Service | ✅ PASS | Feature integrates with existing Next.js deployment. No new deployment concerns. |

## Project Structure

### Documentation (this feature)

```text
specs/011-timestamps-in-video/
├── spec.md              # Feature specification
├── plan.md              # This file
└── tasks.md             # Task breakdown
```

### Source Code (repository root)

```text
src/
├── lib/recording/
│   ├── chapter-seek-logic.ts       # NEW: Pure nextTimestamp function (mirrors Gaia ChapterSeekLogic)
│   ├── playback-controller.ts       # EXISTING: Unchanged
│   ├── chapter-extractor.ts        # EXISTING: Reused for route extension
│   ├── chaptered-asset-mapping.ts  # EXISTING: Reused for route extension
│   ├── schemas.ts                   # EXISTING: Unchanged (ChapterPlaybackRequestSchema already optional chapterId)
│   └── types.ts                     # EXISTING: Unchanged
├── app/api/recording/
│   ├── playback/play/route.ts       # EXTENDED: Auto-seek to chapters[0].start when chapterId omitted + chapters exist
│   └── ...
├── app/recording/player/[id]/
│   └── page.tsx                      # EXTENDED: Fetch chapters on mount, initial-seek-on-first-play, Next Timestamp button
└── ...

tests/
├── unit/
│   └── lib/recording/chapter-seek-logic.spec.ts   # NEW: nextTimestamp pure function tests
├── contract/
│   └── recording/playback-play-initial-seek.spec.ts # NEW: Auto-seek-to-chapter-0 contract tests
└── e2e/
    └── recording/timestamps-player.spec.ts          # NEW: Web player initial seek + Next Timestamp button
```

**Structure Decision**: Single Next.js project (Aither monorepo). New `chapter-seek-logic.ts` pure function mirrors Gaia's `ChapterSeekLogic` and is fully testable without a player or UI. Route extension localized to `playback/play/route.ts`. Web player extension localized to `page.tsx`. No new routes, no new schemas, no new types.

## Complexity Tracking

> **No Constitution Check violations. Complexity tracking N/A.**

---

## Execution Plan: Phases 0–2

### Phase 0: Outline & Research

**Deliverable**: This plan + spec.md. No research.md needed — all technical unknowns resolved by reusing existing Spec 010 infrastructure (chapter list endpoint, chapter extractor, chaptered asset mapping). The `nextTimestamp` logic is a direct port of Gaia's `ChapterSeekLogic.nextChapter` (already validated in `Tests/GaiaCoreTests/Playback/ChapterSeekLogicTests.swift`).

### Phase 1: Design & Contracts

**Deliverables**: `tasks.md` (this feature is small enough that data-model.md and contracts/ are not needed — no new data models, no new endpoints).

1. **Pure function** `nextTimestamp(chapters, currentPosition)` — direct port of Gaia's `ChapterSeekLogic.nextChapter`.
2. **Route extension** — `POST /api/recording/playback/play` without `chapterId` auto-seeks to `chapters[0].start` when chapters exist.
3. **Client component extension** — fetch chapters on mount, initial-seek-on-first-play, Next Timestamp button overlay.

### Phase 2: Implementation

See `tasks.md`.
