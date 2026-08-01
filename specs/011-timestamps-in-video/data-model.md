# Data Model: Timestamps in Video

**Phase**: 1 | **Date**: 2026-08-01 | **Spec**: [spec.md](spec.md)

No new data models. This feature reuses `ChapterListResponse`, `ChapterSummary`, and `ChapterPlaybackRequest` from Spec 010, with one schema extension (`startAtFirst`).

## Extended Entities

### ChapterPlaybackRequest (Extended)

**Purpose**: Extended request to `POST /api/recording/playback/play` to support optional `startAtFirst` for server-side initial seek.

**Fields** (extends Spec 010 schema):

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `recordingId` | string | yes | — | Recording session id (existing, Spec 004) |
| `chapterId` | integer ≥ 0 | no | — | Zero-based chapter id to play (existing, Spec 010). If provided, seeks to that chapter's start. |
| `startAtFirst` | boolean | no | `false` | **NEW**: When `true` AND no `chapterId` AND chapters exist, seeks to `chapters[0].start` before playing. When `false`/omitted, preserves Spec 004 resume behavior. |

**Validation Rules**:
- `recordingId` MUST identify an existing recording (Spec 004).
- `chapterId` (if provided) MUST be in range [0, chapterCount - 1] (Spec 010).
- `startAtFirst` is ignored if `chapterId` is provided (explicit chapter takes precedence).
- If `startAtFirst: true` and no chaptered asset exists, falls back to Spec 004 behavior (play only).

**Zod Schema Extension** (in `src/lib/recording/schemas.ts`):

```typescript
export const ChapterPlaybackRequestSchema = z.object({
  recordingId: z.string().min(1),
  chapterId: z.number().int().min(0).optional(),
  startAtFirst: z.boolean().optional().default(false),  // NEW
});
```

### ChapterPlaybackResult (Extended)

**Purpose**: Response from `POST /api/recording/playback/play` — extended to include chapter fields when `startAtFirst: true` triggers a seek.

**Fields** (extends Spec 010 schema):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `accepted` | boolean (literal `true`) | yes | Always `true` on 200 response. |
| `chapterId` | integer ≥ 0 | no | Echo of resolved chapter id (0 when `startAtFirst: true` triggered the seek, or the explicit `chapterId`). |
| `start` | number ≥ 0 | no | Chapter start time in seconds (when chapter fields are present). |
| `end` | number | no | Chapter end time in seconds (when chapter fields are present). |

**Rules**:
- When `startAtFirst: true` AND chapters exist: returns `{ accepted: true, chapterId: 0, start, end }`.
- When `startAtFirst: true` AND no chapters: returns `{ accepted: true }` (backward compatible).
- When `startAtFirst` omitted/false AND no `chapterId`: returns `{ accepted: true }` (Spec 004 behavior).
- When `chapterId` provided: returns `{ accepted: true, chapterId, start, end }` (Spec 010 behavior).

## Client-Side State (Web Player)

**Purpose**: Local React state for the web player's timestamp navigation.

```typescript
interface TimestampPlayerState {
  chapters: ChapterSummary[];       // from GET /api/recording/chapters/[id]
  chaptersLoaded: boolean;           // true after successful fetch
  chaptersNotGenerated: boolean;     // true if 404 CHAPTERS_NOT_GENERATED
  hasPlayedOnce: boolean;            // tracks initial-seek-on-first-play (client-side only)
}
```

**Lifecycle**:
1. On mount: `chaptersLoaded = false`, `chaptersNotGenerated = false`, `hasPlayedOnce = false`.
2. Fetch `GET /api/recording/chapters/[id]` (cookie-based auth, parallel to video source load).
3. On 200: `chapters = response.chapters`, `chaptersLoaded = true`.
4. On 404: `chaptersNotGenerated = true`, `chaptersLoaded = true` (silent fallback to headless).
5. On 401/other: `chaptersLoaded = true` (silent fallback to headless, no error UI).
6. On first `play` SSE command: if `chapters.length > 0`, seek `video.currentTime = chapters[0].start`, set `hasPlayedOnce = true`.
7. On subsequent `play` commands: no re-seek (`hasPlayedOnce` guard).

## Pure Function: nextTimestamp

**Purpose**: Position-relative next-chapter resolution, mirroring Gaia's `ChapterSeekLogic.nextChapter`.

```typescript
/**
 * Returns the first chapter whose `start` is strictly greater than
 * `currentPosition`, or `null` if no such chapter exists.
 */
export function nextTimestamp(
  chapters: ChapterSummary[],
  currentPosition: number
): ChapterSummary | null {
  return chapters.find(c => c.start > currentPosition) ?? null;
}
```

**Properties**:
- Pure, side-effect-free, fully deterministic.
- No dependencies on player, UI, or network.
- O(n) time complexity (n = chapter count, typically < 20).
- Returns `null` for empty chapters, single chapter, or position in/past last chapter.

## Reused Entities (No Changes)

- `ChapterSummary` (Spec 010): `{ id: number, start: number, end: number, title: string }`
- `ChapterListResponse` (Spec 010): `{ assetId: string, chapters: ChapterSummary[] }`
- `ChapteredAssetMapping` (Spec 010): `{ assetId, muxAssetId, muxPlaybackUrl, chapterCount, generatedAt }`
- `SSECommand` (Spec 010): unchanged — `play | stop | seek | chapter-boundary`
