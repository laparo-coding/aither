# Tasks: Timestamps in Video

**Input**: Design documents from `/specs/011-timestamps-in-video/`
**Prerequisites**: plan.md (required), spec.md (required)
**Tests**: TDD mandatory per Constitution Principle I — contract/unit tests first, then implementation.

**Organization**: Tasks grouped by user story (US1: Initial Seek, US2: Next Timestamp Button, US3: Server-Side Consistency) with shared foundational phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story this task belongs to (US1, US2, US3, SHARED)
- File paths are relative to repository root (`/Users/Andreas/GitHub/aither/`)

---

## Phase 1: Foundational (Shared Infrastructure)

**Purpose**: Pure `nextTimestamp` function reused by web player and tests.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Tests (write first, must fail)

- [ ] T001 [P] [SHARED] Unit test for `nextTimestamp` pure function in `tests/unit/lib/recording/chapter-seek-logic.spec.ts`: mid-chapter returns next chapter; at boundary returns next chapter; in last chapter returns null; past last chapter returns null; empty chapters returns null; single chapter returns null; position before first chapter returns first chapter. Mirror Gaia's `ChapterSeekLogicTests`.

### Implementation

- [ ] T002 [SHARED] Create `src/lib/recording/chapter-seek-logic.ts` with pure `nextTimestamp(chapters: ChapterSummary[], currentPosition: number): ChapterSummary | null` function: returns first chapter whose `start` is strictly greater than `currentPosition`, or `null` if none. Direct port of Gaia's `ChapterSeekLogic.nextChapter` (depends on T001)

**Checkpoint**: Pure seek logic ready — user story implementation can begin.

---

## Phase 2: User Story 1 — Web Player Starts at First Timestamp (Priority: P1) 🎯 MVP

**Goal**: Web player fetches chapters on mount and seeks to `chapters[0].start` on the first `play` command.

**Independent Test**: Open web player for a chaptered recording, press play, verify `video.currentTime` is set to `chapters[0].start` before playback begins.

### Tests for User Story 1 (write first, must fail)

- [ ] T010 [P] [US1] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: web player loads chapters on mount, seeks to `chapters[0].start` on first play command, playback begins from that position
- [ ] T011 [P] [US1] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: web player falls back to position 0 when chapters not generated (404), backward compatible

### Implementation for User Story 1

- [ ] T012 [US1] Extend `src/app/recording/player/[id]/page.tsx`: add `chapters`, `chaptersLoaded`, `chaptersNotGenerated`, `hasPlayedOnce` state; fetch `GET /api/recording/chapters/[id]` on mount (parallel to video source load, NFR-002); on first `play` SSE command, if `chapters.length > 0` seek `video.currentTime = chapters[0].start` before `video.play()`; set `hasPlayedOnce = true` to prevent re-seek on subsequent play commands. The initial seek is exclusively client-side — do NOT call `POST /api/recording/playback/play` additionally and do NOT send `startAtFirst` (depends on T010, T011)

**Checkpoint**: User Story 1 fully functional — web player starts at first timestamp.

---

## Phase 3: User Story 2 — Next Timestamp Button (Priority: P1) 🎯 MVP

**Goal**: Web player exposes a "Next Timestamp" button that seeks to the next chapter client-side.

**Independent Test**: Load chaptered recording in web player, click "Next Timestamp", verify `video.currentTime` is set to the start of the next chapter.

### Tests for User Story 2 (write first, must fail)

- [ ] T020 [P] [US2] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: "Next Timestamp" button seeks to next chapter start (first chapter with `start > currentTime`); works mid-chapter and when paused
- [ ] T021 [P] [US2] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: button is disabled when in/past last chapter (no next chapter exists)
- [ ] T022 [P] [US2] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: button is disabled with hint when chapters not generated (404 CHAPTERS_NOT_GENERATED)

### Implementation for User Story 2

- [ ] T023 [US2] Extend `src/app/recording/player/[id]/page.tsx`: add "Next Timestamp" button as a minimal overlay icon (bottom-right, visible on hover/mouse movement or key press, hidden after ~3s inactivity); add keyboard shortcut listener for key "N" (works regardless of overlay visibility); on click or "N" key, call `nextTimestamp(chapters, video.currentTime)` and set `video.currentTime = next.start` if non-null; button enabled only when `chaptersLoaded && nextTimestamp(...) !== null`; when `chaptersNotGenerated`, show hint text "Kapitel noch nicht generiert. Bitte zuerst regenerieren." (depends on T002, T020, T021, T022)

**Checkpoint**: User Story 2 fully functional — web player has working Next Timestamp button.

---

## Phase 4: User Story 3 — Server-Side Initial Seek Consistency (Priority: P2)

**Goal**: `POST /api/recording/playback/play` without `chapterId` auto-seeks to `chapters[0].start` when chapters exist, ensuring consistency across all clients.

**Independent Test**: Call `POST /api/recording/playback/play` without `chapterId` for a chaptered recording, verify `seek` to `chapters[0].start` is dispatched before `play`.

### Tests for User Story 3 (write first, must fail)

- [ ] T030 [P] [US3] Contract test in `tests/contract/recording/playback-play-initial-seek.spec.ts`: `POST /api/recording/playback/play` with `{ startAtFirst: true }` and no `chapterId` for chaptered recording returns 200 with `{ accepted: true, chapterId: 0, start, end }` and dispatches seek to `chapters[0].start` before play
- [ ] T031 [P] [US3] Contract test in `tests/contract/recording/playback-play-initial-seek.spec.ts`: `POST /api/recording/playback/play` with `{ startAtFirst: true }` and no `chapterId` for non-chaptered recording returns 200 with `{ accepted: true }` (backward compatible, Spec 004 behavior)
- [ ] T032 [P] [US3] Contract test in `tests/contract/recording/playback-play-initial-seek.spec.ts`: `POST /api/recording/playback/play` without `startAtFirst` (or `false`) and no `chapterId` returns 200 with `{ accepted: true }` (Spec 004 resume behavior preserved, even if chapters exist)
- [ ] T032a [P] [US3] Contract test in `tests/contract/recording/playback-play-initial-seek.spec.ts`: `POST /api/recording/playback/play` with explicit `chapterId` preserves existing Spec 010 behavior (seek to that chapter, play, return start/end)

### Implementation for User Story 3

- [ ] T033 [US3] Extend `src/app/api/recording/playback/play/route.ts`: add optional `startAtFirst` boolean to `ChapterPlaybackRequestSchema` (default `false`); in the `chapterId === undefined && startAtFirst === true` branch, attempt `getChapteredAssetMapping(recordingId)`; if mapping exists, call `extractChapters`, dispatch `seek` to `chapters[0].start` then `play`, return 200 with `{ accepted: true, chapterId: 0, start: chapters[0].start, end: chapters[0].end }`; if mapping is null or `extractChapters` fails, fall back to existing behavior (dispatch `play` only, return `{ accepted: true }`). When `startAtFirst` is omitted/false, preserve Spec 004 behavior (dispatch `play` only). Wrap mapping/extraction errors in try/catch to ensure backward compatibility (depends on T030, T031, T032, T032a)

**Checkpoint**: User Story 3 fully functional — server-side initial seek consistent across all clients.

---

## Phase 5: Integration & Cross-Cutting Concerns

**Purpose**: End-to-end validation and documentation.

### Integration Tests

- [ ] T040 [P] [INTEG] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: full workflow — load chaptered recording, verify initial seek on play, click Next Timestamp multiple times, verify button disables at last chapter
- [ ] T041 [P] [INTEG] E2E test in `tests/e2e/recording/timestamps-player.spec.ts`: chapter-boundary SSE event still fires at chapter end (Spec 010 behavior unchanged); Next Timestamp button works independently of boundary pause

### Documentation

- [ ] T050 [P] [DOCS] Update `specs/011-timestamps-in-video/spec.md` Status field from "Draft" to "Implemented" after all tasks complete

**Checkpoint**: Feature complete — all user stories validated end-to-end.
