# Contract: POST /api/recording/playback/play — startAtFirst Extension

**Phase**: 1 | **Date**: 2026-08-01 | **Spec**: [spec.md](spec.md)

This contract extends the existing `POST /api/recording/playback/play` endpoint (Spec 004 + Spec 010) with a new optional `startAtFirst` parameter.

## Endpoint

```
POST /api/recording/playback/play
Authorization: Bearer <token> (or Clerk session cookie for web player)
Content-Type: application/json
```

## Request Body

```json
{
  "recordingId": "rec_2026-07-13T10-30-00Z",
  "chapterId": 0,
  "startAtFirst": true
}
```

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `recordingId` | string | yes | — | Recording session id. |
| `chapterId` | integer ≥ 0 | no | — | Explicit chapter id to play (Spec 010). Takes precedence over `startAtFirst`. |
| `startAtFirst` | boolean | no | `false` | When `true` AND no `chapterId` AND chapters exist, seeks to `chapters[0].start` before playing. |

## Response 200 — Success (startAtFirst: true, chapters exist, no chapterId)

```json
{
  "accepted": true,
  "chapterId": 0,
  "start": 5.0,
  "end": 20.0
}
```

**Invariants**:
- `chapterId` is always `0` when `startAtFirst` triggered the seek.
- `start` < `end`.
- `start` and `end` are in seconds (converted from ffprobe microseconds by `extractChapters`).

## Response 200 — Success (startAtFirst: true, no chapters, no chapterId)

```json
{
  "accepted": true
}
```

**Behavior**: Dispatches `play` only (Spec 004 backward compatible). No chapter fields in response.

## Response 200 — Success (startAtFirst omitted/false, no chapterId)

```json
{
  "accepted": true
}
```

**Behavior**: Dispatches `play` only (Spec 004 resume behavior). No seek. No chapter fields in response.

## Response 200 — Success (chapterId provided, Spec 010 behavior)

```json
{
  "accepted": true,
  "chapterId": 1,
  "start": 20.0,
  "end": 45.0
}
```

**Behavior**: `startAtFirst` is ignored when `chapterId` is provided. Existing Spec 010 behavior preserved.

## Error Responses (unchanged from Spec 010)

| Status | Code | Condition |
|--------|------|-----------|
| 400 | VALIDATION_ERROR | Invalid request body (Zod validation failure). |
| 401 | UNAUTHORIZED | No valid auth (missing/invalid token or session). |
| 403 | FORBIDDEN | Authenticated but not admin. |
| 404 | NOT_FOUND | No player connected for this recording. |
| 404 | CHAPTERS_NOT_GENERATED | `startAtFirst: true` or `chapterId` provided, but no chaptered asset exists. |
| 404 | CHAPTER_NOT_FOUND | `chapterId` provided but out of range. |
| 500 | INTERNAL_ERROR | Failed to retrieve chaptered asset mapping. |
| 502 | CHAPTER_EXTRACTION_FAILED | `ffprobe` chapter extraction failed. |

## Dispatch Sequence

### startAtFirst: true, chapters exist, no chapterId

```
1. dispatchCommand(recordingId, { action: "seek", position: chapters[0].start })
2. dispatchCommand(recordingId, { action: "play" })
3. Return 200 { accepted: true, chapterId: 0, start, end }
```

### startAtFirst: true, no chapters, no chapterId

```
1. dispatchCommand(recordingId, { action: "play" })
2. Return 200 { accepted: true }
```

### startAtFirst omitted/false, no chapterId

```
1. dispatchCommand(recordingId, { action: "play" })
2. Return 200 { accepted: true }
```

### chapterId provided (Spec 010, unchanged)

```
1. getChapteredAssetMapping(recordingId) → mapping
2. extractChapters(recordingId, mapping.muxPlaybackUrl) → chapterList
3. Validate chapterId in range
4. dispatchCommand(recordingId, { action: "seek", position: chapter.start })
5. dispatchCommand(recordingId, { action: "play" })
6. Return 200 { accepted: true, chapterId, start, end }
```

## Backward Compatibility

- Requests without `startAtFirst` behave identically to Spec 004/010.
- The web player does NOT send `startAtFirst` — it performs its initial seek client-side (FR-002).
- `startAtFirst` is reserved for clients without local seek logic (dashboard, programmatic callers).
