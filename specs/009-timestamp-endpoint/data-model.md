# Data Model: 009 — Uranos Timestamp Endpoint

**Date**: 2026-07-13 | **Spec**: `specs/009-timestamp-endpoint/spec.md`

This feature introduces no database (Constitution VII). All entities are either
transient request/response DTOs or the ffmetadata JSON document persisted to
Vercel Blob Storage. Zod schemas are the source of truth; TypeScript types are
inferred.

## Entities

### TimestampRequest (inbound DTO)

The request body sent periodically by Uranos.

| Field | Type | Rules |
|-------|------|-------|
| `timestamp` | `number` | Unix epoch in **seconds**. MUST be a positive integer (`z.number().int().positive()`). |

**Validation**:
- Non-integer / non-positive → `400 INVALID_REQUEST` (Zod).
- Predates recording start (`< recordingStartUnixSeconds`) → `400 INVALID_TIMESTAMP` (FR-012).
- Offset `<=` current last chapter `start` (non-monotonic) → `400 INVALID_TIMESTAMP` (FR-012a).

### FFMetadataChapter (persisted, element of `chapters[]`)

A single ffmpeg-compatible chapter marker. Times are in **microseconds** relative
to recording start.

| Field | Type | Rules |
|-------|------|-------|
| `id` | `number` | Integer, `>= 0`, sequential (0-based). |
| `start` | `number` | Integer µs, `>= 0`. Equals the timestamp offset that created the chapter. |
| `end` | `number` | Integer µs, `>= start`. Next chapter's `start`, or `== start` for the last (placeholder) chapter. |
| `title` | `string` | Non-empty. Auto-generated `Chapter N` (1-indexed) in phase 1. |

**Validation**:
- `end >= start` always.
- `chapters` MUST be strictly increasing by `start` (`chapters[i].start > chapters[i-1].start`).
- `chapters[i].start == chapters[i-1].end` after linking (each append closes the previous chapter).

### FFMetadataJSON (persisted document, one blob per asset id)

The full ffmetadata document stored at `ffmetadata/<assetId>.json`.

| Field | Type | Rules |
|-------|------|-------|
| `metadata` | `object` | `{ title: string; encoder: string }`. `title` = asset id; `encoder` = `"aither-ffmetadata"`. |
| `chapters` | `FFMetadataChapter[]` | Ordered, strictly increasing by `start`. May be empty only transiently (never persisted empty — the first write always contains ≥ 1 chapter). |

**FFMETADATA1 compatibility**: The structure maps 1:1 to ffmpeg chapter blocks
with `TIMEBASE=1/1000000`; a downstream serializer converts it to the
`.txt` FFMETADATA1 format for `-i meta -map_metadata 1 -codec copy` (Out of Scope
here).

### TimestampIngestionResult (outbound DTO, success payload)

Returned in the `data` field of the success envelope.

| Field | Type | Description |
|-------|------|-------------|
| `assetId` | `string` | Active recording session id (`rec_…Z`). |
| `chapterId` | `number` | `id` of the chapter created by this request. |
| `blobKey` | `string` | Deterministic blob storage key (`ffmetadata/<assetId>.json`). |

## Chapter State Transitions

```
                 ┌─────────────────────────────────────────────┐
   no blob  ──►  │ CREATE: chapters = [ { id:0,                 │
   (first TS)    │                       start: offset,         │
                 │                       end:   offset,  <─ placeholder
                 │                       title: "Chapter 1" } ] │
                 └─────────────────────────────────────────────┘
                                     │
        next valid TS (offset > last.start)
                                     ▼
                 ┌─────────────────────────────────────────────┐
   blob exists ► │ APPEND: last.end   = offset                 │
                 │         push { id: last.id+1,                │
                 │                start: offset,                │
                 │                end:   offset,   <─ placeholder│
                 │                title: "Chapter N+1" }        │
                 └─────────────────────────────────────────────┘
```

- The **last** chapter always has `end == start` (zero-length placeholder) until
  the next timestamp advances it. A downstream consumer clamps the final `end`
  to the video duration at mux time (spec Clarification 2026-07-13).
- Footage before the first timestamp is intentionally un-chaptered (first
  chapter `start` = first timestamp offset, not `0`).

## Offset Computation

```
recordingStartUnixSeconds = Math.floor(Date.parse(session.startedAt) / 1000)
offsetMicros              = (timestamp - recordingStartUnixSeconds) * 1_000_000
```

- `timestamp` and `recordingStartUnixSeconds` are integer seconds.
- `offsetMicros` is a non-negative integer (guarded by FR-012).

## Relationships

```
RecordingSession (in-memory, session-manager)
    │ 1  ──owns──►  1  FFMetadataJSON (blob: ffmetadata/<sessionId>.json)
    │                     │ 1 ──contains──► N FFMetadataChapter
TimestampRequest ──produces──► 1 FFMetadataChapter ──yields──► 1 TimestampIngestionResult
```

## Zod Schema Plan (source of truth — `src/lib/recording/schemas.ts`)

```ts
export const TimestampRequestSchema = z.object({
  timestamp: z.number().int().positive(),
});

export const FFMetadataChapterSchema = z.object({
  id: z.number().int().min(0),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  title: z.string().min(1),
}).refine((c) => c.end >= c.start, { message: "end must be >= start" });

export const FFMetadataJSONSchema = z.object({
  metadata: z.object({
    title: z.string().min(1),
    encoder: z.literal("aither-ffmetadata"),
  }),
  chapters: z.array(FFMetadataChapterSchema).min(1, "chapters must contain at least one entry"),
}).refine((doc) => {
  const ch = doc.chapters;
  if (ch.length === 0) return true; // empty handled by .min(1) on chapters
  // IDs must start at 0 and be contiguous
  for (let i = 0; i < ch.length; i++) {
    if (ch[i].id !== i) return false;
  }
  // start values must be strictly increasing
  for (let i = 1; i < ch.length; i++) {
    if (ch[i].start <= ch[i - 1].start) return false;
  }
  // Each chapter's end must equal the next chapter's start (except last placeholder)
  for (let i = 0; i < ch.length - 1; i++) {
    if (ch[i].end !== ch[i + 1].start) return false;
  }
  return true;
}, { message: "chapters must have contiguous IDs starting at 0, strictly increasing starts, and linked end→start" });

export const TimestampIngestionResultSchema = z.object({
  assetId: z.string().min(1),
  chapterId: z.number().int().min(0),
  blobKey: z.string().min(1),
});
```

Types are inferred in `src/lib/recording/types.ts` (`z.infer<...>`), consistent
with the existing recording module.
