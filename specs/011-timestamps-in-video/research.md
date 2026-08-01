# Research: Timestamps in Video

**Phase**: 0 | **Date**: 2026-08-01 | **Spec**: [spec.md](spec.md)

All technical unknowns are resolved by reusing existing Spec 010 infrastructure. No new external dependencies, no new protocols, no new storage. The `nextTimestamp` logic is a direct port of Gaia's validated `ChapterSeekLogic`.

## Research Tasks

### 1. nextTimestamp Pure Function — Gaia ChapterSeekLogic Port

**Decision**: Direct port of Gaia's `ChapterSeekLogic.nextChapter(chapters:currentPosition:)` to TypeScript.

**Rationale**: Gaia's `ChapterSeekLogic` is already fully validated in `Tests/GaiaCoreTests/Playback/ChapterSeekLogicTests.swift` with 7 test cases covering all edge cases (mid-chapter, at boundary, in last chapter, past last chapter, empty chapters, single chapter, position before first chapter). Porting the exact same logic ensures behavioral parity without re-designing.

**Alternatives Rejected**:
- Server-side next-chapter resolution: Rejected because the web player holds the chapter list locally (fetched on mount); a server round-trip per button press would violate NFR-001 (≤ 200 ms).
- SSE-based next-chapter command: Rejected because it would require extending the SSE protocol and the `SSECommand` type for a purely client-side concern.

**Implementation**:
```typescript
export function nextTimestamp(
  chapters: ChapterSummary[],
  currentPosition: number
): ChapterSummary | null {
  return chapters.find(c => c.start > currentPosition) ?? null;
}
```

### 2. startAtFirst Parameter — Stateless Server-Side Initial Seek

**Decision**: New optional `startAtFirst` boolean parameter (default `false`) on `POST /api/recording/playback/play`.

**Rationale**: The parameter is stateless — no in-memory first-play tracking needed (Constitution VII). When `startAtFirst: true` is provided AND no `chapterId` is provided AND a chaptered asset exists, the endpoint seeks to `chapters[0].start` before playing. Without the parameter, Spec 004 resume behavior is fully preserved. The web player does NOT use this parameter — it performs its initial seek client-side (FR-002). The parameter is reserved for clients without local seek logic (dashboard, programmatic callers).

**Alternatives Rejected**:
- Always seek to chapter 0 when no `chapterId` (Option A): Breaks Spec 004 resume for all clients.
- In-memory first-play tracking (Option B): Violates Constitution VII (stateless).
- Client-side only (Option D): No server-side consistency for non-web-player clients.

**Schema Extension**: Add `startAtFirst: z.boolean().optional().default(false)` to `ChapterPlaybackRequestSchema` in `src/lib/recording/schemas.ts`.

### 3. Web Player Chapter Fetch — Cookie-Based Auth

**Decision**: The web player fetches `GET /api/recording/chapters/[id]` using the existing Clerk session cookie (Same-Origin, automatic).

**Rationale**: The web player already calls `/api/recording/events` (SSE) and `/api/recording/playback/state` (POST) without explicit Authorization headers — the `requireAdmin` guard reads the session from the cookie. The chapter fetch behaves identically. No Bearer token in client code (security), no new proxy route (simplicity).

**Alternatives Rejected**:
- Bearer token via `NEXT_PUBLIC_*` env vars: Token visible in client code (security risk).
- Server proxy route: Duplicates auth flow, adds unnecessary route.

### 4. Next Timestamp Button UX — Keyboard Shortcut + Minimal Overlay

**Decision**: Button activatable via keyboard shortcut "N" and a minimal overlay icon (bottom-right, visible on hover/mouse movement or key press, hidden after ~3s inactivity).

**Rationale**: Preserves the headless full-screen design while supporting both keyboard (seminar operator at control desk) and touch/mouse. Consistent with the existing minimal overlay pattern ("Connecting…" indicator top-right). The icon briefly appears as feedback when "N" is pressed, even if the overlay was hidden.

**Alternatives Rejected**:
- Permanent overlay: Breaks headless design.
- Hover-only: Not usable on touch devices.
- Error overlay on auth failure: Overreacts; SSE already provides connection feedback.

### 5. 401 Auth Failure — Silent Fallback

**Decision**: If the chapter fetch fails with `401 Unauthorized` (expired Clerk session), the player falls back silently to headless behavior (no chapters, no button).

**Rationale**: Consistent with the `404 CHAPTERS_NOT_GENERATED` fallback. The SSE `onerror` handler already shows "Connecting…" when the session expires — a separate auth warning for the chapter fetch would be redundant and break the headless design. Playback continues (the video stream has its own auth flow).

### 6. Existing Infrastructure Reuse — No New Dependencies

**Decision**: Reuse all existing Spec 010 infrastructure: `GET /api/recording/chapters/[id]`, `extractChapters`, `getChapteredAssetMapping`, `dispatchCommand`, `ChapterPlaybackRequestSchema`, `ChapterSummary` type.

**Rationale**: Spec 010 is fully implemented on branch `010-chapters-in-video`. This feature extends the existing route and web player; it does not duplicate or modify the chapter pipeline. No new npm dependencies, no new CLI tools, no new external services.

**Verification**: Confirmed by reading the existing implementation:
- `src/app/api/recording/playback/play/route.ts` — already handles optional `chapterId`, dispatches seek+play
- `src/lib/recording/chapter-extractor.ts` — `extractChapters(assetId, muxPlaybackUrl)` returns `ChapterListResponse`
- `src/lib/recording/chaptered-asset-mapping.ts` — `getChapteredAssetMapping(assetId)` returns mapping or null
- `src/lib/recording/schemas.ts` — `ChapterPlaybackRequestSchema` already has optional `chapterId`; `startAtFirst` is a simple addition
- `src/app/recording/player/[id]/page.tsx` — existing SSE EventSource and `<video>` element; extension is localized
