# Tasks: Timestamps in Video

**Input**: Design documents from `/specs/011-timestamps-in-video/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/playback-play-startatfirst.contract.md, quickstart.md
**Tests**: TDD mandatory per Constitution Principle I — contract/unit tests first, then implementation.

**Organization**: Tasks grouped by user story (US1: Initial Seek, US2: Next Timestamp Button, US3: Server-Side Consistency) with shared foundational phase. Each story can be implemented and tested independently.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story this task belongs to (US1, US2, US3, SHARED)
- File paths are relative to repository root (`/Users/Andreas/GitHub/aither/`)

## Path Conventions

- Single Next.js project: `src/`, `tests/` at repository root
- Source: `src/lib/recording/`, `src/app/api/recording/`, `src/app/recording/player/[id]/`
- Tests: `tests/unit/`, `tests/contract/`, `tests/e2e/`

---

## Phase 1: Foundational (Shared Infrastructure)

**Purpose**: Pure `nextTimestamp` function + schema extension reused by all user stories.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests (write first, must fail)

- [ ] T001 [P] [SHARED] Unit test for `nextTimestamp` pure function in `tests/unit/lib/recording/chapter-seek-logic.spec.ts`: mid-chapter returns next chapter; at boundary returns next chapter; in last chapter returns null; past last chapter returns null; empty chapters returns null; single chapter returns null; position before first chapter returns first chapter. Mirror Gaia's `ChapterSeekLogicTests` (7 test cases).
- [ ] T002 [P] [SHARED] Unit test for extended `ChapterPlaybackRequestSchema` with `startAtFirst` field in `tests/unit/lib/recording/schemas-startatfirst.spec.ts`: validates `startAtFirst: true` accepted; `startAtFirst: false` accepted; `startAtFirst` omitted defaults to `false`; non-boolean value rejected; `chapterId` + `startAtFirst` both present accepted (chapterId takes precedence at route level).

### Implementation

- [ ] T003 [SHARED] Create `src/lib/recording/chapter-seek-logic.ts` with pure `nextTimestamp(chapters: ChapterSummary[], currentPosition: number): ChapterSummary | null` function: returns first chapter whose `start` is strictly greater than `currentPosition`, or `null` if none. Direct port of Gaia's `ChapterSeekLogic.nextChapter`. No side effects, no dependencies (depends on T001).
- [ ] T004 [SHARED] Extend `ChapterPlaybackRequestSchema` in `src/lib/recording/schemas.ts`: add `startAtFirst: z.boolean().optional().default(false)` field. Existing `recordingId` (required) and `chapterId` (optional) fields remain unchanged. No changes to `ChapterPlaybackResultSchema` (already a union handling both shapes) (depends on T002).

**Checkpoint**: Pure seek logic + schema extension ready — user story implementation can begin.

---

## Phase 2: User Story 1 — Web Player Starts at First Timestamp (Priority: P1) 🎯 MVP

**Goal**: Web player fetches chapters on mount (cookie-based Clerk auth) and seeks to `chapters[0].start` on the first `play` command (exclusively client-side).

**Independent Test**: Open web player for a chaptered recording, trigger play, verify `video.currentTime` is set to `chapters[0].start` before playback begins.

### Tests for User Story 1 (write first, must fail)

- [ ] T010 [P] [US1] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: web player loads chapters on mount via `GET /api/recording/chapters/[id]` (cookie-based auth, no explicit Authorization header), seeks to `chapters[0].start` on first `play` SSE command, playback begins from that position.
- [ ] T011 [P] [US1] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: web player falls back to position 0 when chapters not generated (404 CHAPTERS_NOT_GENERATED), backward compatible — no seek, play from 0.
- [ ] T012 [P] [US1] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: web player falls back silently to headless behavior when chapter fetch fails with 401 (expired Clerk session) — no chapters loaded, no button, no error UI, playback continues.

### Implementation for User Story 1

- [ ] T013 [US1] Extend `src/app/recording/player/[id]/page.tsx`: add `chapters: ChapterSummary[]`, `chaptersLoaded: boolean`, `chaptersNotGenerated: boolean`, `hasPlayedOnce: boolean` state (all initialized false/empty); fetch `GET /api/recording/chapters/[id]` on mount in parallel to video source load (NFR-002 — do not block video); use `fetch` without explicit Authorization header (cookie-based Same-Origin auth); on 200 set `chapters` + `chaptersLoaded=true`; on 404 set `chaptersNotGenerated=true` + `chaptersLoaded=true`; on 401/other set `chaptersLoaded=true` (silent fallback); in the SSE `command` event handler, on `play` action: if `!hasPlayedOnce && chapters.length > 0` then `video.currentTime = chapters[0].start` before `video.play()`, set `hasPlayedOnce = true`; subsequent `play` commands skip the seek. Do NOT call `POST /api/recording/playback/play` and do NOT send `startAtFirst` (depends on T010, T011, T012).

**Checkpoint**: User Story 1 fully functional — web player starts at first timestamp.

---

## Phase 3: User Story 2 — Next Timestamp Button (Priority: P1) 🎯 MVP

**Goal**: Web player exposes a "Next Timestamp" button activatable via keyboard shortcut "N" and a minimal overlay icon, performing a client-side seek to the next chapter.

**Independent Test**: Load chaptered recording in web player, click "Next Timestamp" icon or press "N", verify `video.currentTime` is set to the start of the next chapter (first chapter with `start > currentTime`).

### Tests for User Story 2 (write first, must fail)

- [ ] T020 [P] [US2] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: "Next Timestamp" overlay icon (click) seeks to next chapter start — first chapter with `start > currentTime`; works mid-chapter and when paused.
- [ ] T021 [P] [US2] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: keyboard shortcut "N" seeks to next chapter start; works regardless of overlay visibility (icon hidden or visible).
- [ ] T022 [P] [US2] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: button is disabled (not clickable, greyed out) when in/past last chapter — no chapter with `start > currentTime` exists; pressing "N" does nothing.
- [ ] T023 [P] [US2] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: button is disabled with hint text "Kapitel noch nicht generiert. Bitte zuerst regenerieren." when `chaptersNotGenerated === true` (404 CHAPTERS_NOT_GENERATED).

### Implementation for User Story 2

- [ ] T024 [US2] Extend `src/app/recording/player/[id]/page.tsx`: add "Next Timestamp" button as a minimal overlay icon positioned bottom-right (absolute, semi-transparent, visible on `mousemove`/`mouseenter` or key press, hidden after ~3s inactivity via `setTimeout`); add `keydown` event listener for key "N" (case-insensitive) that triggers the same seek action regardless of overlay visibility (briefly show icon as feedback); on click or "N" key, call `nextTimestamp(chapters, video.currentTime)` from `src/lib/recording/chapter-seek-logic.ts` and set `video.currentTime = next.start` if non-null; button `disabled` attribute bound to `!(chaptersLoaded && nextTimestamp(chapters, video.currentTime) !== null)`; when `chaptersNotGenerated`, show hint text below icon. Use inline styles consistent with existing player (no MUI import — player is headless) (depends on T003, T020, T021, T022, T023).

**Checkpoint**: User Story 2 fully functional — web player has working Next Timestamp button + "N" shortcut.

---

## Phase 4: User Story 3 — Server-Side Initial Seek Consistency (Priority: P2)

**Goal**: `POST /api/recording/playback/play` with `startAtFirst: true` (no `chapterId`) seeks to `chapters[0].start` when chapters exist, ensuring consistency for clients without local seek logic (dashboard, programmatic callers).

**Independent Test**: Call `POST /api/recording/playback/play` with `{ startAtFirst: true }` for a chaptered recording, verify `seek` to `chapters[0].start` is dispatched before `play`, response includes `{ chapterId: 0, start, end }`.

### Tests for User Story 3 (write first, must fail)

- [ ] T030 [P] [US3] Contract test in `tests/contract/recording/playback-play-initial-seek.spec.ts`: `POST /api/recording/playback/play` with `{ recordingId, startAtFirst: true }` (no `chapterId`) for chaptered recording returns 200 with `{ accepted: true, chapterId: 0, start, end }` and dispatches `seek` to `chapters[0].start` before `play` (assert `dispatchCommand` call order: seek then play).
- [ ] T031 [P] [US3] Contract test in `tests/contract/recording/playback-play-initial-seek.spec.ts`: `POST /api/recording/playback/play` with `{ recordingId, startAtFirst: true }` (no `chapterId`) for non-chaptered recording (no mapping) returns 200 with `{ accepted: true }` (backward compatible, Spec 004 behavior — play only, no chapter fields).
- [ ] T032 [P] [US3] Contract test in `tests/contract/recording/playback-play-initial-seek.spec.ts`: `POST /api/recording/playback/play` with `{ recordingId }` (no `startAtFirst`, no `chapterId`) returns 200 with `{ accepted: true }` (Spec 004 resume behavior preserved, even if chapters exist — no seek dispatched).
- [ ] T032a [P] [US3] Contract test in `tests/contract/recording/playback-play-initial-seek.spec.ts`: `POST /api/recording/playback/play` with `{ recordingId, chapterId: 1, startAtFirst: true }` preserves existing Spec 010 behavior (seek to chapter 1 start, play, return `{ chapterId: 1, start, end }` — `startAtFirst` ignored when `chapterId` provided).

### Implementation for User Story 3

- [ ] T033 [US3] Extend `src/app/api/recording/playback/play/route.ts`: in the existing `chapterId === undefined` branch, read `startAtFirst` from `parsed.data`; if `startAtFirst === true`, attempt `getChapteredAssetMapping(recordingId)` — if mapping exists, call `extractChapters(recordingId, mapping.muxPlaybackUrl)`, dispatch `seek` to `chapters[0].start` then `play` via `dispatchCommand`, return 200 with `{ accepted: true, chapterId: 0, start: chapters[0].start, end: chapters[0].end }`; if mapping is null or `extractChapters` throws, fall back to existing behavior (dispatch `play` only, return `{ accepted: true }`). When `startAtFirst` is omitted/false, preserve Spec 004 behavior (dispatch `play` only). Wrap mapping/extraction in try/catch with existing Rollbar `reportError` logging to ensure backward compatibility. No changes to the `chapterId !== undefined` branch (Spec 010 behavior unchanged) (depends on T004, T030, T031, T032, T032a).

**Checkpoint**: User Story 3 fully functional — server-side initial seek consistent for non-web-player clients.

---

## Phase 5: Integration & Cross-Cutting Concerns

**Purpose**: End-to-end validation and documentation.

### Integration Tests

- [ ] T040 [P] [INTEG] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: full workflow — load chaptered recording, verify initial seek on first play, click Next Timestamp multiple times, verify button disables at last chapter, verify "N" key works at each step.
- [ ] T041 [P] [INTEG] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: chapter-boundary SSE event still fires at chapter end (Spec 010 behavior unchanged); Next Timestamp button works independently of boundary pause (can skip ahead before boundary fires).

### Documentation

- [ ] T050 [P] [DOCS] Update `specs/011-timestamps-in-video/spec.md` Status field from "Draft" to "Implemented" after all tasks complete.

**Checkpoint**: Feature complete — all user stories validated end-to-end.

---

## Parallel Execution Guidance

The following task groups can be executed in parallel (different files, no shared dependencies):

**Phase 1 (parallel)**:
- T001 (`tests/unit/lib/recording/chapter-seek-logic.spec.ts`) + T002 (`tests/unit/lib/recording/schemas-startatfirst.spec.ts`) — different test files.

**Phase 2+3 tests (parallel, after Phase 1)**:
- T010, T011, T012 (US1 E2E) + T020, T021, T022, T023 (US2 E2E) + T030, T031, T032, T032a (US3 contract) — all different test files.

**Phase 2+3 implementation (sequential within file, parallel across files)**:
- T013 (US1, `page.tsx`) and T033 (US3, `route.ts`) touch different files but T013 must complete before T024 (same file). T033 can run in parallel with T013.
- T024 (US2, `page.tsx`) depends on T013 (same file, sequential).

**Phase 5 (parallel)**:
- T040, T041, T050 — different files.
