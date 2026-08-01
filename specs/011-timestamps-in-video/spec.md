# Feature Specification: Timestamps in Video

**Feature Branch**: `011-timestamps-in-video`
**Created**: 2026-08-01
**Status**: Draft
**Input**: User description: "In Gaia ist eine Player-Erweiterung verfügbar, sodass der Player nun beim Abspielen eines Videos mit dem ersten Timestamp beginnt. Ein Button zum Vorspulen auf den nächsten Timestamp ist ebenfalls verfügbar. Welche Anpassungen sind am Aither-Player erforderlich, damit dieser genauso reagiert."

## Clarifications

### Session 2026-08-01

- Q: Soll der Aither-Web-Player beim Start eines Videos automatisch auf den ersten Timestamp (Kapitel 0) springen, oder nur auf expliziten Request (z. B. `chapterId`)? → A: **Automatisch auf den ersten Timestamp.** Wenn Kapitel verfügbar sind, springt der Player beim ersten `play`-Kommando auf `chapters[0].start`, bevor die Wiedergabe beginnt. So entspricht das Verhalten dem Gaia-Controller, der beim Abspielen mit dem ersten Timestamp beginnt. Wenn keine Kapitel vorhanden sind, bleibt das bestehende Verhalten (Play ab Position 0) erhalten (Rückwärtskompatibilität mit Spec 004).
- Q: Soll der „Nächster Timestamp"-Button clientseitig (direkter Seek im `<video>`-Element) oder serverseitig (Round-Trip über `POST /api/recording/playback/play` mit `chapterId`) funktionieren? → A: **Clientseitig.** Der Button sucht direkt im `<video>`-Element auf den Start des nächsten Kapitels, analog zu Gaia's `ChapterSeekLogic` (Spec 010, FR-002, Option B). Kein Aither-Round-Trip nötig; die Kapitel-Liste wird beim Laden der Player-Seite über `GET /api/recording/chapters/[id]` geholt und lokal gehalten. Die serverseitige `chapterId`-basierte Wiedergabe bleibt für programmatische/automatisierte Adressierung verfügbar.
- Q: Wie wird der „nächste Timestamp" bestimmt — relativ zur aktuellen Abspielposition oder nur nach Erreichen des Kapitelendes? → A: **Positionsrelativ (Option A).** Der Button findet das erste Kapitel, dessen `start` größer als die aktuelle Abspielposition ist, und springt dorthin. Funktioniert mitten im Kapitel (Vorspulen) und an pausierten Kapitelgrenzen. Entspricht exakt Gaia's `ChapterSeekLogic.nextChapter(chapters:currentPosition:)`.
- Q: Was passiert, wenn der Player im oder nach dem letzten Kapitel ist (kein nächstes Kapitel mehr)? → A: **Button deaktivieren.** Wenn kein Kapitel mit `start > currentPosition` existiert, ist der Button deaktiviert (graue Darstellung, nicht klickbar). Entspricht Gaia FR-004.
- Q: Was passiert, wenn die Kapitel noch nicht generiert wurden (`404 CHAPTERS_NOT_GENERATED`)? → A: **Button deaktivieren + Hinweis.** Der Button bleibt deaktiviert und die UI zeigt einen Hinweis, dass die Kapitel zuerst regeneriert werden müssen. Entspricht Gaia FR-004a.
- Q: Soll der Aither-Player beim Erreichen eines Kapitelendes pausieren (wie in Spec 010 implementiert) oder weiterlaufen? → A: **Bestehendes Verhalten beibehalten.** Spec 010 (FR-015) definiert, dass der Player am Kapitelende pausiert und ein `chapter-boundary` SSE-Event auslöst. Dieses Verhalten bleibt unverändert. Der neue „Nächster Timestamp"-Button ergänzt lediglich die manuelle Steuerung und zwingt den Nutzer nicht, bis zum Kapitelende zu warten.
- Q: Soll die initiale Position (Start bei erstem Timestamp) serverseitig im `POST /api/recording/playback/play`-Endpoint erzwungen werden, oder nur clientseitig im Web-Player? → A: **Beide.** Serverseitig wird der `POST /api/recording/playback/play`-Endpoint so erweitert, dass bei fehlendem `chapterId` automatisch auf Kapitel 0 gesprungen wird (falls Kapitel verfügbar). Clientseitig ergänzt der Web-Player die gleiche Logik beim ersten `play`-Kommando. So ist das Verhalten konsistent, unabhängig davon, welcher Client (Gaia, Web-Player, Dashboard) die Wiedergabe startet.

## Overview

This feature extends the Aither web player (`/recording/player/[id]`) and the playback API so that video playback starts at the first timestamp (chapter 0) and exposes a **"Next Timestamp" button** that jumps to the start of the next chapter relative to the current playback position. This mirrors the behavior already implemented in the Gaia controller (Spec 010 — Timestamp Playback, `ChapterSeekLogic`).

Chapter information is sourced from the existing `GET /api/recording/chapters/[id]` endpoint (Spec 010), which reads the embedded chapters from the MUX chaptered asset via `ffprobe`. The web player fetches the chapter list on mount and holds it in local state; the "Next Timestamp" button performs a client-side seek on the `<video>` element using the already-loaded chapter list (no Aither round-trip per button press).

### Relationship to Existing Specs

- **Spec 004 (Recording Module)** — owns the recording lifecycle, the local MP4 file, the playback API (`/api/recording/playback/*`), and the web player at `/recording/player/[id]`. This feature extends the web player UI and the `POST /api/recording/playback/play` endpoint.
- **Spec 009 (Uranos Timestamp Endpoint)** — owns the ffmetadata JSON blob in Vercel Blob Storage. This feature consumes the chapter list derived from that blob (via the MUX chaptered asset) as read-only input.
- **Spec 010 (Chapters in Video)** — owns the chaptered video regeneration pipeline, the `GET /api/recording/chapters/[id]` endpoint, the `chapterId`-based playback extension, and the `chapter-boundary` SSE event. This feature reuses the chapter list endpoint and the `chapterId`-based playback; it adds the client-side "Next Timestamp" button and the initial-seek-to-first-chapter behavior.
- **Gaia Spec 010 (Timestamp Playback)** — external consumer (project `gaia`) that already implements the initial-seek-to-first-chapter and the "Next Chapter" button via `ChapterSeekLogic`. This feature brings the Aither web player to behavioral parity with Gaia.

## Out of Scope

- Modifying the Uranos timestamp ingestion pipeline (Spec 009) — the ffmetadata JSON blob is consumed read-only.
- Changing the chaptered video regeneration pipeline (Spec 010) — the regeneration endpoint and MUX upload flow remain unchanged.
- Re-encoding the video stream (transcoding) — not involved.
- Authoring or editing chapter metadata — chapters are taken as-is from the MUX chaptered asset.
- Changing the `chapter-boundary` SSE event semantics (Spec 010, FR-015) — the player still pauses at chapter end and emits the boundary event; this feature only adds manual navigation.
- Lifecycle management (deletion, pruning) of chaptered video assets — handled by existing recording lifecycle endpoints.
- Mobile/native player clients — only the Aither web player (`/recording/player/[id]`) is in scope. Gaia's native AVPlayer is out of scope (already implemented).

## Architecture Overview

### Web Player Timestamp Navigation

```
GET /api/recording/chapters/[id] ─→ ChapterListResponse (chapters[] in seconds)
                                     │
                                     ▼
/recording/player/[id] (React) ──→ local state: chapters[]
                                     │
              ┌──────────────────────┼──────────────────────┐
              ▼                      ▼                      ▼
   Initial play (first play)   Next Timestamp button    chapter-boundary SSE
   seek to chapters[0].start  seek to next.start       (existing, unchanged)
   then video.play()           (client-side, no RT)    pause at chapter.end
```

1. **Load chapters** — On mount, the web player fetches `GET /api/recording/chapters/[id]` and stores the chapter list in local state. If the request fails with `404 CHAPTERS_NOT_GENERATED`, the player falls back to the existing headless behavior (no timestamp navigation).
2. **Initial play** — When the first `play` SSE command arrives (or the user presses play), the player seeks to `chapters[0].start` before calling `video.play()`, if chapters are available. This matches Gaia's behavior of starting playback at the first timestamp.
3. **Next Timestamp button** — A new UI control in the player seeks the `<video>` element directly to the start of the next chapter (first chapter with `start > currentTime`). No Aither round-trip is required; the seek is performed client-side using the already-loaded chapter list.
4. **Button state** — The button is enabled only when a next chapter exists (position is before the last chapter) and chapters are loaded. It is disabled when in/past the last chapter or when chapters are not generated.
5. **Chapter boundary** — The existing `chapter-boundary` SSE event (Spec 010, FR-015) remains unchanged. When the player reaches a chapter's `end`, it pauses and emits the event. The "Next Timestamp" button provides manual navigation independent of the boundary pause.

### Server-Side Initial Seek (Consistency Guarantee)

```
POST /api/recording/playback/play (no chapterId)
                                     │
                                     ▼
   if chapters available → dispatch seek to chapters[0].start, then play
   if no chapters        → dispatch play only (backward compatible, Spec 004)
```

The `POST /api/recording/playback/play` endpoint is extended so that when no `chapterId` is provided AND a chaptered asset exists for the recording, the endpoint automatically seeks to `chapters[0].start` before dispatching `play`. This ensures the initial-seek-to-first-timestamp behavior is consistent across all clients (Gaia, web player, dashboard triggers), not just the web player.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Web Player Starts at First Timestamp (Priority: P1)

As a seminar operator viewing a recording in the Aither web player, I want the video to start playing at the first timestamp (chapter 0) when I press play, so that I skip any pre-roll footage and begin at the first marked moment.

**Why this priority**: Without the initial seek, the web player starts at position 0, which may be before the first timestamp. This is inconsistent with the Gaia controller, which starts at the first timestamp.

**Independent Test**: Can be fully tested by opening the web player for a chaptered recording, pressing play, and verifying that `video.currentTime` is set to `chapters[0].start` before playback begins.

**Acceptance Scenarios**:

1. **Given** a chaptered recording exists (chapters available via `GET /api/recording/chapters/[id]`), **When** the web player receives the first `play` command, **Then** the player seeks to `chapters[0].start` and then begins playback from that position.
2. **Given** a recording without chapters (`404 CHAPTERS_NOT_GENERATED`), **When** the web player receives the first `play` command, **Then** the player begins playback from position 0 (existing behavior, backward compatible).
3. **Given** a chaptered recording with `chapters[0].start = 0`, **When** the web player receives the first `play` command, **Then** the player begins playback from position 0 (seek is a no-op but still performed).

### User Story 2 — Next Timestamp Button Jumps to Next Chapter (Priority: P1)

As a seminar operator viewing a recording in the Aither web player, I want a "Next Timestamp" button that jumps playback to the start of the next timestamp (chapter), so that I can skip ahead to the next marked moment without waiting for the current chapter to finish.

**Why this priority**: This is the core interactive feature that brings the Aither web player to parity with the Gaia controller's "Next Chapter" button.

**Independent Test**: Can be fully tested by loading a chaptered recording in the web player, clicking the "Next Timestamp" button, and verifying that `video.currentTime` is set to the start of the next chapter (first chapter with `start > previous currentTime`).

**Acceptance Scenarios**:

1. **Given** the player is playing at position 12.0s with chapters `[{start:5},{start:20},{start:45}]`, **When** the operator clicks "Next Timestamp", **Then** the player seeks to 20.0s (the first chapter with `start > 12.0`).
2. **Given** the player is paused at position 30.0s inside the last chapter `[{start:5,end:20},{start:20,end:45}]`, **When** the operator clicks "Next Timestamp", **Then** the button is disabled (no chapter with `start > 30.0`) and no seek occurs.
3. **Given** the player is at position 0.0s before the first chapter `[{start:5},{start:20}]`, **When** the operator clicks "Next Timestamp", **Then** the player seeks to 5.0s (the first chapter with `start > 0.0`).
4. **Given** no chapters are available (`404 CHAPTERS_NOT_GENERATED`), **When** the player loads, **Then** the "Next Timestamp" button is disabled and a hint is shown prompting the operator to regenerate chapters first.

### User Story 3 — Server-Side Initial Seek Consistency (Priority: P2)

As a platform consumer (Gaia, dashboard, or other client) calling `POST /api/recording/playback/play` without a `chapterId`, I want the playback to start at the first timestamp automatically, so that the initial-seek behavior is consistent regardless of which client initiates playback.

**Why this priority**: Ensures the behavior is not dependent on client-side logic alone; the server enforces the initial seek for all clients.

**Independent Test**: Can be fully tested by calling `POST /api/recording/playback/play` without `chapterId` for a chaptered recording and verifying that a `seek` command to `chapters[0].start` is dispatched before the `play` command.

**Acceptance Scenarios**:

1. **Given** a chaptered recording exists, **When** `POST /api/recording/playback/play` is called without `chapterId`, **Then** the endpoint dispatches a `seek` to `chapters[0].start` followed by `play`, and returns `200` with `{ accepted: true, chapterId: 0, start, end }`.
2. **Given** a recording without chapters (`404 CHAPTERS_NOT_GENERATED`), **When** `POST /api/recording/playback/play` is called without `chapterId`, **Then** the endpoint dispatches `play` only (existing behavior, backward compatible) and returns `200` with `{ accepted: true }`.
3. **Given** a chaptered recording exists, **When** `POST /api/recording/playback/play` is called with an explicit `chapterId`, **Then** the existing behavior (Spec 010, T027) is preserved — seek to that chapter's start, then play.

### Edge Cases

- What happens when the first chapter's `start` is 0? The initial seek is a no-op (seek to 0), playback begins at 0. No error.
- What happens when the chapter list is empty (but the endpoint returned 200)? Treat as "no chapters" — button disabled, initial play from position 0.
- What happens when the player is already past the first chapter when the first `play` command arrives (e.g., user manually seeked)? The initial seek to `chapters[0].start` still occurs on the first `play` command — this is intentional to match Gaia's deterministic start behavior. Subsequent `play` commands (after pause/resume) do NOT re-seek.
- What happens when the "Next Timestamp" button is pressed while playback is paused? The seek occurs and playback remains paused at the new position. The operator can press play to resume.
- What happens when the chapter list changes during playback (e.g., regeneration)? The web player does NOT auto-refresh the chapter list. The operator must reload the page to pick up new chapters. (Consistent with Spec 010's explicit-trigger model.)
- What happens when the SSE connection drops and reconnects? The chapter list is held in local state (fetched on mount, not via SSE), so it survives SSE reconnects. The "Next Timestamp" button remains functional.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The Aither web player (`/recording/player/[id]`) MUST fetch the chapter list via `GET /api/recording/chapters/[id]` on mount and hold it in local state.
- **FR-002**: When the web player receives the first `play` command AND chapters are available, the player MUST seek to `chapters[0].start` before calling `video.play()`. Subsequent `play` commands (after pause/resume) MUST NOT re-seek.
- **FR-003**: The web player MUST expose a **"Next Timestamp" button**. Pressing the button MUST seek the `<video>` element to the start of the next chapter — the first chapter whose `start` is greater than the current playback position. The seek MUST be performed client-side using the already-loaded chapter list; no Aither round-trip is required.
- **FR-004**: The "Next Timestamp" button MUST be disabled when no next chapter exists (position is within or past the last chapter) or when chapters are not available.
- **FR-004a**: When chapters are not generated (`404 CHAPTERS_NOT_GENERATED`), the "Next Timestamp" button MUST be disabled and the UI MUST show a hint prompting the operator to regenerate chapters first.
- **FR-005**: The `POST /api/recording/playback/play` endpoint MUST, when no `chapterId` is provided AND a chaptered asset exists, dispatch a `seek` to `chapters[0].start` followed by `play`, and return `200` with `{ accepted: true, chapterId: 0, start, end }`.
- **FR-006**: The `POST /api/recording/playback/play` endpoint MUST preserve backward compatibility: when no chaptered asset exists and no `chapterId` is provided, it dispatches `play` only and returns `200` with `{ accepted: true }` (Spec 004 behavior).
- **FR-007**: The existing `chapterId`-based playback (Spec 010, T027) MUST remain unchanged — an explicit `chapterId` seeks to that chapter's start and plays.
- **FR-008**: The existing `chapter-boundary` SSE event (Spec 010, FR-015) MUST remain unchanged — the player still pauses at chapter end and emits the boundary event.
- **FR-009**: The "Next Timestamp" button's seek logic MUST be position-relative: the next chapter is the first chapter whose `start` is strictly greater than the current playback position. This MUST work mid-chapter (skip ahead) and when paused at a chapter boundary.

### Non-Functional Requirements

- **NFR-001**: The "Next Timestamp" seek MUST complete within 200 ms from button press to playback position change (client-side seek, no network round-trip).
- **NFR-002**: The chapter list fetch on mount MUST NOT block the video element from loading — the video source is set immediately, the chapter fetch runs in parallel.
- **NFR-003**: The web player MUST remain a headless surface (no native video controls) — the "Next Timestamp" button is an overlay control, consistent with the existing player design (T030).
- **NFR-004**: All new and modified code MUST be covered by unit and/or contract tests per the existing Aither testing convention (Vitest for unit/contract, Playwright for E2E).

## API Reference

### Extended: `POST /api/recording/playback/play`

**Behavior change**: When `chapterId` is omitted and a chaptered asset exists, the endpoint now seeks to `chapters[0].start` before playing.

**Request** (unchanged schema):
```json
{
  "recordingId": "rec_2026-07-13T10-30-00Z",
  "chapterId": 0
}
```
`chapterId` remains optional. When omitted, the endpoint now defaults to chapter 0 (if chapters exist).

**Response 200** (when chapters exist, `chapterId` omitted or provided):
```json
{
  "accepted": true,
  "chapterId": 0,
  "start": 5.0,
  "end": 20.0
}
```

**Response 200** (when no chapters exist, `chapterId` omitted — backward compatible):
```json
{
  "accepted": true
}
```

**Error responses**: unchanged (404 CHAPTERS_NOT_GENERATED, 404 CHAPTER_NOT_FOUND, 502 CHAPTER_EXTRACTION_FAILED, etc.).

### Reused: `GET /api/recording/chapters/[id]`

Unchanged. The web player calls this on mount to load the chapter list.

## Data Model

No new data models. Reuses `ChapterListResponse` and `ChapterSummary` from Spec 010.

### Client-Side State (Web Player)

```typescript
interface TimestampPlayerState {
  chapters: ChapterSummary[];      // from GET /api/recording/chapters/[id]
  chaptersLoaded: boolean;          // true after successful fetch
  chaptersNotGenerated: boolean;    // true if 404 CHAPTERS_NOT_GENERATED
  hasPlayedOnce: boolean;           // tracks initial-seek-on-first-play
}
```

### Next Timestamp Logic (Client-Side)

Pure function, mirroring Gaia's `ChapterSeekLogic.nextChapter`:

```typescript
function nextTimestamp(
  chapters: ChapterSummary[],
  currentPosition: number
): ChapterSummary | null {
  return chapters.find(c => c.start > currentPosition) ?? null;
}
```

## Testing Strategy

- **Unit tests** (Vitest):
  - `nextTimestamp` pure function (mirrors Gaia's `ChapterSeekLogicTests`): mid-chapter, at boundary, in last chapter, past last chapter, empty chapters, single chapter, position before first chapter.
  - `POST /api/recording/playback/play` route: initial-seek-to-chapter-0 when `chapterId` omitted and chapters exist; backward-compatible play when no chapters; explicit `chapterId` unchanged.
- **Contract tests** (Vitest):
  - `POST /api/recording/playback/play` without `chapterId` returns `{ accepted, chapterId: 0, start, end }` for chaptered recordings.
  - `POST /api/recording/playback/play` without `chapterId` returns `{ accepted: true }` for non-chaptered recordings.
- **E2E tests** (Playwright):
  - Web player loads chapters on mount, seeks to `chapters[0].start` on first play.
  - "Next Timestamp" button seeks to next chapter start; disabled at last chapter.
  - Button disabled with hint when chapters not generated.

## Open Questions

- None currently. All clarifications resolved in Session 2026-08-01.
