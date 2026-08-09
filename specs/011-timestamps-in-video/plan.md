# Implementation Plan: Timestamps in Video

**Branch**: `011-timestamps-in-video` | **Date**: 2026-08-01 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/011-timestamps-in-video/spec.md`

## Summary

Bring the Aither web player (`/recording/player/[id]`) to behavioral parity with the Gaia controller's timestamp playback (Gaia Spec 010). The web player fetches the chapter list via the existing `GET /api/recording/chapters/[id]` endpoint (Spec 010) on mount using cookie-based Clerk session auth, seeks to `chapters[0].start` on the first `play` command (exclusively client-side), and exposes a **"Next Timestamp" button** activatable via keyboard shortcut "N" and a minimal hover overlay icon. The button performs a client-side seek to the next chapter (first chapter with `start > currentPosition`). The `POST /api/recording/playback/play` endpoint is extended with a new optional `startAtFirst` boolean parameter (default `false`): when `startAtFirst: true` is provided and a chaptered asset exists, the endpoint seeks to `chapters[0].start` before playing — reserved for clients without local seek logic (dashboard, programmatic callers). Without `startAtFirst`, the existing Spec 004 behavior (play from current position / resume) is fully preserved. No new data models, no new endpoints; reuses Spec 010's chapter infrastructure.

## Technical Context

**Language/Version**: TypeScript 5.9, Next.js 16 App Router, React 19
**Primary Dependencies**: Existing `GET /api/recording/chapters/[id]` (Spec 010), existing `POST /api/recording/playback/play` (Spec 004 + Spec 010), HTML5 `<video>` seek semantics, EventSource (SSE), Clerk session cookie (Same-Origin auth), Zod (schema validation)
**Storage**: No new storage. Chapter list held in client-side React state (fetched on mount). Server-side playback state remains in-memory (Spec 010). Vercel Blob Storage (chaptered asset mapping, read-only). MUX (chaptered asset, read-only).
**Testing**: vitest (unit + contract tests), Playwright (e2e)
**Target Platform**: Node.js server (Next.js 16 API routes) + browser (web player client component)
**Project Type**: Web application (existing Next.js Aither monorepo)
**Performance Goals**: "Next Timestamp" seek ≤ 200 ms from button press to position change (NFR-001, client-side seek, no network round-trip)
**Constraints**: Headless player surface (no native video controls, NFR-003); backward compatibility with Spec 004 (non-chaptered recordings); no changes to Spec 010's `chapter-boundary` SSE semantics; stateless (Constitution VII — no in-memory first-play tracking); cookie-based auth (no Bearer token in client code)
**Scale/Scope**: ~200–300 lines new/modified code (1 route extension, 1 client component extension, 1 new pure lib function, 1 schema extension)

## Constitution Check

**GATE RESULT: PASS** — All principles satisfied. No violations require justification.

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Test-First Development | ✅ PASS | New `nextTimestamp` pure function + route extension + web player extension require unit, contract, and E2E tests. TDD cycle enforced. 80% coverage on new code. |
| II. Code Quality & Formatting | ✅ PASS | All new code MUST pass Biome formatting/linting. TypeScript strict mode enforced. |
| III. Feature Development Workflow | ✅ PASS | Specification written (spec.md); clarifications resolved (12 Q&As); this plan; contracts and tasks to follow. Rollbar error tracking reused from existing routes. |
| IV. Authentication & Security | ✅ PASS | No new auth surfaces. Reuses existing `requireAdmin` on `POST /api/recording/playback/play`. Web player chapter fetch uses existing Clerk session cookie (Same-Origin). No Bearer tokens in client code. No PII in logs. |
| V. Component Architecture | ✅ PASS | Web player is an existing client component; extension is localized. New `nextTimestamp` pure function is framework-agnostic and testable. Minimal overlay icon follows existing headless design pattern (consistent with "Connecting…" indicator). |
| VI. Holistic Error Handling & Observability | ✅ PASS | Graceful degradation: if chapter fetch fails (404 or 401), player falls back silently to existing headless behavior. No new error paths on the server; route extension reuses existing error codes and Rollbar logging. SSE `onerror` already provides connection feedback. |
| VII. Stateless Architecture | ✅ PASS | No new persistent state. Chapter list is client-side only (fetched per page load, held in React state). Server-side playback state remains in-memory (Spec 010). `startAtFirst` parameter is stateless — no in-memory first-play tracking needed (Constitution VII). |
| VIII. HTML Playback & Video Recording | ✅ PASS | Feature extends existing web player HTML5 `<video>` playback. No new recording pipeline. MUX remains single source of truth for video. Player remains headless full-screen surface. |
| IX. Aither Control API | ✅ PASS | Extends existing `POST /api/recording/playback/play` API (contract-first). No new control-system API. `startAtFirst` parameter is a backward-compatible extension. |
| X. Deployment & Linux Service | ✅ PASS | Feature integrates with existing Next.js deployment (`npm run build && npm start`). No new deployment concerns. |

## Project Structure

### Documentation (this feature)

```text
specs/011-timestamps-in-video/
├── spec.md              # Feature specification (with 12 clarifications)
├── plan.md              # This file
├── research.md          # Phase 0 output — technical unknowns resolved
├── data-model.md        # Phase 1 output — extended request schema, client state
├── quickstart.md        # Phase 1 output — validation steps
├── contracts/
│   └── playback-play-startatfirst.contract.md  # Phase 1 output — extended API contract
└── tasks.md             # Phase 2 output — task breakdown
```

### Source Code (repository root)

```text
src/
├── lib/recording/
│   ├── chapter-seek-logic.ts       # NEW: Pure nextTimestamp function (mirrors Gaia ChapterSeekLogic)
│   ├── playback-controller.ts       # EXISTING: Unchanged
│   ├── chapter-extractor.ts        # EXISTING: Reused for route extension
│   ├── chaptered-asset-mapping.ts  # EXISTING: Reused for route extension
│   ├── schemas.ts                   # EXTENDED: Add startAtFirst to ChapterPlaybackRequestSchema
│   └── types.ts                     # EXISTING: Unchanged
├── app/api/recording/
│   ├── playback/play/route.ts       # EXTENDED: Auto-seek to chapters[0].start when startAtFirst=true + no chapterId + chapters exist
│   └── ...
├── app/recording/player/[id]/
│   └── page.tsx                      # EXTENDED: Fetch chapters on mount, initial-seek-on-first-play, Next Timestamp button + keyboard shortcut "N"
└── ...

tests/
├── unit/
│   └── lib/recording/chapter-seek-logic.spec.ts   # NEW: nextTimestamp pure function tests
├── contract/
│   └── recording/playback-play-initial-seek.spec.ts # NEW: startAtFirst contract tests
└── e2e/
    └── recording/timestamps-player.spec.ts          # NEW: Web player initial seek + Next Timestamp button
```

**Structure Decision**: Single Next.js project (Aither monorepo). New `chapter-seek-logic.ts` pure function mirrors Gaia's `ChapterSeekLogic` and is fully testable without a player or UI. Route extension localized to `playback/play/route.ts`. Web player extension localized to `page.tsx`. Schema extension localized to `schemas.ts`. No new routes, no new types.

## Complexity Tracking

> **No Constitution Check violations. Complexity tracking N/A.**
