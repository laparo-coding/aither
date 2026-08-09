# Data Model: Chapters in Video

**Phase**: 1 — Design & Contracts  
**Spec Reference**: [spec.md](spec.md)  
**Research Reference**: [research.md](research.md)

---

## Entity Definitions

### ChapterRegenerationRequest

**Purpose**: Input to `POST /api/recording/chapters/[id]` to trigger chaptered video generation.

**Fields**:
- `assetId` (string, path parameter) — Recording session id (e.g., `rec_2026-07-13T10-30-00Z`). Identifies the raw MP4 (`<assetId>.mp4`) and ffmetadata JSON blob (`ffmetadata/<assetId>.json`).

**Validation Rules**:
- `assetId` MUST match the path parameter in the route.
- `assetId` format: `rec_<ISO8601-datetime>` (must be parseable as a recording session id by Spec 004).

**Example**:
```json
POST /api/recording/chapters/rec_2026-07-13T10-30-00Z
```

---

### ChapterRegenerationResult

**Purpose**: Output from `POST /api/recording/chapters/[id]` on success (HTTP 200).

**Fields**:
- `assetId` (string) — Recording session id (echoed from request).
- `muxAssetId` (string) — MUX asset id of the uploaded chaptered MP4 (e.g., `mux_chapters_rec_2026-07-13T10-30-00Z`). Canonical reference for the chaptered video; the local transient file is deleted after upload.
- `chapterCount` (integer, ≥ 1) — Number of chapters embedded in the MUX chaptered asset (should match ffmetadata JSON `chapters[]` length).

**Validation Rules**:
- `chapterCount` MUST be > 0 (at least one chapter required).
- `chapterCount` MUST equal ffmetadata JSON `chapters[]` length (cross-check for consistency).
- `muxAssetId` MUST be a non-empty string (MUX asset identifier).

**Example**:
```json
{
  "assetId": "rec_2026-07-13T10-30-00Z",
  "muxAssetId": "mux_chapters_rec_2026-07-13T10-30-00Z",
  "chapterCount": 5
}
```

---

### ChapterListResponse

**Purpose**: Output from `GET /api/recording/chapters/[id]` on success (HTTP 200). Contains the chapter list sourced from the MUX chaptered asset's embedded chapters (via ffprobe on the MUX playback URL).

**Fields**:
- `assetId` (string) — Recording session id (echoed from request).
- `chapters` (array of ChapterSummary) — Ordered list of chapters.

**Validation Rules**:
- `chapters` array MUST contain at least one element (guaranteed by regeneration step).
- Chapter order MUST be monotonic (chapter[i].id < chapter[i+1].id).
- `chapters[i].start` < `chapters[i].end` for all chapters.
- Chapters MUST NOT overlap: `chapters[i].end` ≤ `chapters[i+1].start`.
- Final chapter's `end` MUST equal (or be very close to) the video duration.

**Example**:
```json
{
  "assetId": "rec_2026-07-13T10-30-00Z",
  "chapters": [
    {
      "id": 0,
      "start": 5.0,
      "end": 20.0,
      "title": "Chapter 1: Introduction"
    },
    {
      "id": 1,
      "start": 20.0,
      "end": 45.0,
      "title": "Chapter 2: Key Topics"
    },
    {
      "id": 2,
      "start": 45.0,
      "end": 7200.0,
      "title": "Chapter 3: Conclusion"
    }
  ]
}
```

---

### ChapterSummary

**Purpose**: Individual chapter metadata extracted from the MUX chaptered asset.

**Fields**:
- `id` (integer, ≥ 0) — Zero-based chapter index (unique within the recording).
- `start` (number, ≥ 0) — Chapter start time in **seconds** (decimal, e.g., `5.0`). Converted from ffprobe microseconds (divide by 1,000,000).
- `end` (number, > start) — Chapter end time in **seconds** (decimal). Final chapter's `end` is clamped to video duration.
- `title` (string, non-empty) — Chapter name / title from ffmetadata. May contain Unicode characters (UTF-8).

**Validation Rules**:
- `id` values MUST be consecutive (0, 1, 2, ..., N-1) for N chapters.
- `start` ≥ 0 (always positive or zero).
- `end` > `start` (non-zero-length chapter).
- `title` MUST NOT be empty; MUST be <= 255 characters.
- `start` and `end` MUST be finite numbers (not NaN, not Infinity).

**Conversion from ffprobe JSON**:
```typescript
// ffprobe output: { start: 5000000, timebase: "1/1000000", ... } (microseconds)
const startSeconds = ffprobeChapter.start / 1_000_000;
const endSeconds = ffprobeChapter.end / 1_000_000;
```

---

### ChapterPlaybackRequest

**Purpose**: Extended request to `POST /api/recording/playback/play` to seek to a specific chapter and begin playback.

**Fields** (extends existing PlaybackCommand from Spec 004):
- `recordingId` (string) — Recording session id (existing Spec 004 field).
- `chapterId` (integer, optional) — Zero-based chapter id to play. If omitted, defaults to chapter 0 (or continues from current position in Spec 004).

**Validation Rules**:
- `recordingId` MUST identify an existing recording (Spec 004).
- `chapterId` (if provided) MUST be in range [0, chapterCount - 1] for the chaptered recording.
- If `chapterId` is provided, the player MUST seek to `chapters[chapterId].start` (in seconds) before playing.

**Example**:
```json
POST /api/recording/playback/play
{
  "recordingId": "rec_2026-07-13T10-30-00Z",
  "chapterId": 1
}
```

---

### ChapterPlaybackResult

**Purpose**: Output from extended `POST /api/recording/playback/play` on success (HTTP 200).

**Fields**:
- `accepted` (boolean) — Always `true` on 200 response (command accepted by playback controller).
- `chapterId` (integer, optional) — Echo of requested `chapterId` (if provided in request).
- `start` (number, optional) — Chapter start time in seconds (if `chapterId` was provided).
- `end` (number, optional) — Chapter end time in seconds (if `chapterId` was provided).

**Validation Rules**:
- `start` < `end` (when both provided).
- Omit `chapterId`, `start`, `end` fields if no `chapterId` was provided in request (backward compatible with Spec 004).

**Example**:
```json
{
  "accepted": true,
  "chapterId": 1,
  "start": 20.0,
  "end": 45.0
}
```

---

### ChapterBoundaryEvent

**Purpose**: SSE event emitted when player reaches the end of a chapter (via `/api/recording/events` SSE channel).

**Fields**:
- `event` (string literal) — Always `"chapter-boundary"`.
- `chapterId` (integer, ≥ 0) — Id of the chapter that just ended.
- `nextChapterId` (integer, optional) — Id of the next chapter (if one exists).
- `timestamp` (integer, optional) — Server-side timestamp in milliseconds (Unix epoch).

**Validation Rules**:
- `event` value MUST be exactly `"chapter-boundary"`.
- `chapterId` MUST be a valid chapter id (in range [0, chapterCount - 1]).
- `nextChapterId` MUST be `chapterId + 1` (if present). Omitted for final chapter.
- Emitted when player position reaches or exceeds `chapters[chapterId].end` (within ±500 ms tolerance for buffering).

**Example** (SSE format):
```
event: chapter-boundary
data: {"chapterId": 1, "nextChapterId": 2}

```

**Timing**:
- Emitted **before** player pauses (gives Gaia opportunity to prepare for next chapter).
- One event per chapter boundary crossed (no duplicates for same boundary).

---

## Entity State Transitions

### Chaptered Video Lifecycle

```
Raw MP4 (no chapters)
    ↓
    POST /api/recording/chapters/[id] (regenerate)
    ↓
    FFmpeg remux (with embedded chapters)
    ↓
Chaptered MP4 (chapters embedded)
    ↓
    GET /api/recording/chapters/[id] (query chapters)
    ↓
ChapterListResponse (chapters available)
    ↓
    POST /api/recording/playback/play (seek to chapter)
    ↓
    Player seeks + plays chapter
    ↓
    SSE: chapter-boundary event (when end reached)
    ↓
    Player pauses (manual Gaia action)
```

**Key Invariants**:
- Chaptered MP4 is produced exactly once (idempotent upsert).
- Chapter list MUST be queried from the MUX chaptered asset (via ffprobe on the MUX playback URL), not the ffmetadata JSON blob.
- Playback can only target chapters that exist in the MUX chaptered asset.
- Each chapter-boundary event corresponds to exactly one chapter ending (no duplicates).

---

## Schema Definitions (Zod)

**Location**: `src/lib/recording/schemas.ts`

```typescript
import { z } from "zod";

// ChapterSummary schema
export const ChapterSummarySchema = z.object({
  id: z.number().int().min(0),
  start: z.number().min(0).finite(),
  end: z.number().finite(),
  title: z.string().min(1).max(255),
}).refine(data => data.end > data.start, {
  message: "end must be greater than start",
  path: ["end"],
});

// ChapterListResponse schema
export const ChapterListResponseSchema = z.object({
  assetId: z.string().min(1),
  chapters: z.array(ChapterSummarySchema).min(1),
});

// ChapterRegenerationResult schema
export const ChapterRegenerationResultSchema = z.object({
  assetId: z.string().min(1),
  muxAssetId: z.string().min(1),
  chapterCount: z.number().int().min(1),
});

// ChapterPlaybackRequest schema (extends existing PlaybackCommand)
export const ChapterPlaybackRequestSchema = z.object({
  recordingId: z.string().min(1),
  chapterId: z.number().int().min(0).optional(),
});

// ChapterPlaybackResult schema
export const ChapterPlaybackResultSchema = z.object({
  accepted: z.literal(true),
  chapterId: z.number().int().min(0).optional(),
  start: z.number().min(0).finite().optional(),
  end: z.number().finite().optional(),
}).refine((data) => {
  if (data.start !== undefined && data.end !== undefined) {
    return data.end > data.start;
  }
  return true;
}, {
  message: "end must be greater than start",
  path: ["end"],
});

// ChapterBoundaryEvent schema
export const ChapterBoundaryEventSchema = z.object({
  event: z.literal("chapter-boundary"),
  chapterId: z.number().int().min(0),
  nextChapterId: z.number().int().min(0).optional(),
  timestamp: z.number().int().optional(),
});

// Export inferred TypeScript types
export type ChapterSummary = z.infer<typeof ChapterSummarySchema>;
export type ChapterListResponse = z.infer<typeof ChapterListResponseSchema>;
export type ChapterRegenerationResult = z.infer<typeof ChapterRegenerationResultSchema>;
export type ChapterPlaybackRequest = z.infer<typeof ChapterPlaybackRequestSchema>;
export type ChapterPlaybackResult = z.infer<typeof ChapterPlaybackResultSchema>;
export type ChapterBoundaryEvent = z.infer<typeof ChapterBoundaryEventSchema>;
```

---

## Related Entities (from Spec 009 & 004)

**FFMetadataJSON** (Spec 009, read-only source):
```typescript
interface FFMetadataJSON {
  assetId: string;
  recordingStartedAt: string; // ISO8601
  chapters: Array<{
    id: number;
    title: string;
    offset: { micros: number };
    end?: { micros: number }; // placeholder = 0 for final chapter
  }>;
}
```

**RecordingSession** (Spec 004, status check):
```typescript
interface RecordingSession {
  sessionId: string;
  status: "idle" | "starting" | "recording" | "stopping" | "stopped";
  startedAt?: Date;
  stoppedAt?: Date;
  filename: string;
  duration?: number;
  fileSize?: number;
}
```

**SSECommand** (Spec 004, extended for chapter-boundary):
```typescript
type SSECommand = 
  | { action: "play" }
  | { action: "stop" }
  | { action: "seek"; position: number }
  | { action: "chapter-boundary"; chapterId: number; nextChapterId?: number }; // NEW
```

---

## Validation Rules Summary

| Entity | Key Validation |
|--------|---|
| ChapterSummary | `end > start`; `id` consecutive from 0; `title` non-empty |
| ChapterListResponse | ≥ 1 chapter; chapters ordered by id; no overlap; final `end` ≈ duration |
| ChapterRegenerationResult | `chapterCount` matches ffmetadata JSON length; `muxAssetId` is a non-empty MUX asset identifier |
| ChapterPlaybackRequest | `chapterId` (if provided) in range [0, chapterCount - 1] |
| ChapterPlaybackResult | `end > start` (if both provided); `chapterId` matches request |
| ChapterBoundaryEvent | `event` = `"chapter-boundary"`; `nextChapterId` = `chapterId + 1` or omitted; emitted at chapter boundary |

---

## Next Steps

- Phase 1 continues: Generate OpenAPI contract (`contracts/chapters-endpoint.openapi.yaml`), markdown contract (`contracts/chapters-endpoint.contract.md`), and quickstart guide.
- Phase 2: Generate `tasks.md` with TDD-ordered implementation tasks.
