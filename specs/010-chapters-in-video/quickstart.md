# Quickstart: Chapters in Video

**Spec Reference**: [spec.md](spec.md)  
**Plan Reference**: [plan.md](plan.md)  
**Contracts**: [contracts/](contracts/)

---

## Prerequisites

### 1. FFmpeg & ffprobe Installed

Both CLI tools are required (FFmpeg for remux, ffprobe for chapter extraction and duration lookup).

```bash
# Check installation
ffmpeg -version
ffprobe -version

# macOS (Homebrew)
brew install ffmpeg

# Linux (Debian/Ubuntu)
sudo apt-get install ffmpeg
```

**Minimum Version**: FFmpeg 4.4+ (for stable FFMETADATA1 support and `-movflags +faststart`).

### 2. Environment Variables

Ensure the following are set in `.env` (or your environment):

```bash
# Vercel Blob Storage (for ffmetadata JSON read)
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_xxxxxxxxxxxxx

# MUX credentials (required for chaptered MP4 upload)
MUX_TOKEN_ID=your_mux_token_id
MUX_TOKEN_SECRET=your_mux_token_secret

# Service token (Gaia sync token, min 32 chars)
URANOS_SYNC_TOKEN=your_secure_token_min_32_characters_long

# Rollbar (error monitoring)
ROLLBAR_SERVER_ACCESS_TOKEN=your_rollbar_token
```

### 3. Recording & ffmetadata Prerequisites

Before regenerating chapters, you need:

1. **A finalized recording** at `/output/recordings/<assetId>.mp4` (from Spec 004 recording module).
2. **An ffmetadata JSON blob** at `ffmetadata/<assetId>.json` in Vercel Blob Storage (from Spec 009 timestamp endpoint).

**Verify recording exists**:
```bash
ls -lh /output/recordings/rec_2026-07-13T10-30-00Z.mp4
# -rw-r--r--  1 user  staff  1.5G  rec_2026-07-13T10-30-00Z.mp4
```

**Verify ffmetadata blob exists** (via Aither API or Vercel dashboard):
```bash
# Via Vercel CLI
vercel blob ls | grep ffmetadata/rec_2026-07-13T10-30-00Z.json
```

---

## Quickstart Examples

### Example 1: Regenerate a Chaptered Video

Trigger FFmpeg remux to embed chapter metadata into the recording.

```bash
curl -X POST 'http://localhost:3000/api/recording/chapters/rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_secure_token_min_32_characters_long' \
  -H 'Content-Type: application/json' \
  -d '{}'
```

**Expected Response (200)**:
```json
{
  "assetId": "rec_2026-07-13T10-30-00Z",
  "muxAssetId": "mux_chapters_rec_2026-07-13T10-30-00Z",
  "chapterCount": 5
}
```

**Verify the MUX chaptered asset was created**:
```bash
# The local transient file is deleted after upload; verify via MUX API or ffprobe on the MUX playback URL.
# Example (requires MUX playback URL resolved from muxAssetId):
ffprobe -show_chapters -of json 'https://stream.mux.com/<playback-id>.mp4' | jq '.chapters | length'
# 5
```

### Example 2: List Chapters for a Recording

Retrieve the chapter list (sourced from the MUX chaptered asset via ffprobe on the MUX playback URL).

```bash
curl -X GET 'http://localhost:3000/api/recording/chapters/rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_secure_token_min_32_characters_long'
```

**Expected Response (200)**:
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

### Example 3: Play a Specific Chapter

Seek to a chapter's start offset and begin playback (Gaia controller use case).

```bash
curl -X POST 'http://localhost:3000/api/recording/playback/play' \
  -H 'Authorization: Bearer your_secure_token_min_32_characters_long' \
  -H 'Content-Type: application/json' \
  -d '{
    "recordingId": "rec_2026-07-13T10-30-00Z",
    "chapterId": 1
  }'
```

**Expected Response (200)**:
```json
{
  "accepted": true,
  "chapterId": 1,
  "start": 20.0,
  "end": 45.0
}
```

The player will:
1. Seek to position 20.0 seconds (chapter 1 start).
2. Begin playback.
3. Pause automatically at 45.0 seconds (chapter 1 end).
4. Emit a `chapter-boundary` SSE event when end is reached.

### Example 4: Stream the Chaptered Video

Stream the MUX chaptered asset via the streaming endpoint (MUX CDN redirect/proxy) with HTTP Range support (for web player).

```bash
# Full stream
curl -I 'http://localhost:3000/api/recording/stream/rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_secure_token_min_32_characters_long'

# Expected headers:
# HTTP/1.1 200 OK
# Content-Type: video/mp4
# Content-Length: 1500000000
# Accept-Ranges: bytes

# Range request (first 1KB)
curl -I 'http://localhost:3000/api/recording/stream/rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_secure_token_min_32_characters_long' \
  -H 'Range: bytes=0-1023'

# Expected headers:
# HTTP/1.1 206 Partial Content
# Content-Type: video/mp4
# Content-Length: 1024
# Content-Range: bytes 0-1023/1500000000
```

### Example 5: Listen for Chapter Boundary Events (SSE)

Connect to the SSE stream to receive `chapter-boundary` events when chapters end.

```bash
curl -N 'http://localhost:3000/api/recording/events?recordingId=rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_secure_token_min_32_characters_long'

# Output (when chapter 1 ends during playback):
# event: chapter-boundary
# data: {"chapterId": 1, "nextChapterId": 2}
#
```

---

## Common Error Scenarios

### Error 1: Recording Not Found (404)

```bash
curl -X POST 'http://localhost:3000/api/recording/chapters/rec_nonexistent' \
  -H 'Authorization: Bearer your_secure_token_min_32_characters_long' \
  -d '{}'

# Response:
# {
#   "success": false,
#   "error": {
#     "code": "RECORDING_NOT_FOUND",
#     "message": "No recording found for assetId: rec_nonexistent"
#   }
# }
```

**Recovery**: Verify the recording exists at `/output/recordings/<assetId>.mp4`. If not, record a session first (Spec 004).

### Error 2: ffmetadata Blob Not Found (404)

```bash
curl -X POST 'http://localhost:3000/api/recording/chapters/rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_secure_token_min_32_characters_long' \
  -d '{}'

# Response:
# {
#   "success": false,
#   "error": {
#     "code": "FFMETADATA_NOT_FOUND",
#     "message": "No ffmetadata JSON blob found for assetId. Call POST /api/recording/timestamp first."
#   }
# }
```

**Recovery**: Call `POST /api/recording/timestamp` (Spec 009) to populate the ffmetadata JSON blob, then retry regeneration.

### Error 3: Recording Still Active (409)

```bash
curl -X POST 'http://localhost:3000/api/recording/chapters/rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_secure_token_min_32_characters_long' \
  -d '{}'

# Response:
# {
#   "success": false,
#   "error": {
#     "code": "RECORDING_IN_PROGRESS",
#     "message": "Cannot regenerate chaptered video while recording is still active. Stop recording first."
#   }
# }
```

**Recovery**: Call `POST /api/recording/stop` (Spec 004) to finalize the recording, then retry regeneration.

### Error 4: Invalid ffmetadata JSON (422)

```bash
curl -X POST 'http://localhost:3000/api/recording/chapters/rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_secure_token_min_32_characters_long' \
  -d '{}'

# Response:
# {
#   "success": false,
#   "error": {
#     "code": "FFMETADATA_INVALID",
#     "message": "ffmetadata JSON failed schema validation",
#     "details": {
#       "validationErrors": [
#         "chapters array is required",
#         "chapters[0].offset.micros must be >= 0"
#       ]
#     }
#   }
# }
```

**Recovery**: Inspect the ffmetadata JSON blob in Vercel Blob Storage. Fix the schema violations (likely a corrupt timestamp ingestion from Spec 009). Re-upload the corrected blob, then retry regeneration.

### Error 5: FFmpeg Remux Failed (502)

```bash
curl -X POST 'http://localhost:3000/api/recording/chapters/rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_secure_token_min_32_characters_long' \
  -d '{}'

# Response:
# {
#   "success": false,
#   "error": {
#     "code": "REMUX_FAILED",
#     "message": "FFmpeg remux failed or chapter validation failed",
#     "details": {
#       "ffmpegExitCode": 1,
#       "reason": "Invalid input format"
#     }
#   }
# }
```

**Recovery**:
1. Check server logs (Rollbar) for FFmpeg stderr output.
2. Verify the raw MP4 is not corrupted: `ffprobe /output/recordings/<assetId>.mp4`.
3. Verify FFmpeg is installed and on PATH: `which ffmpeg`.
4. Retry regeneration (idempotent upsert; safe to retry).

### Error 6: Blob Storage Unavailable (503)

```bash
curl -X POST 'http://localhost:3000/api/recording/chapters/rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_secure_token_min_32_characters_long' \
  -d '{}'

# Response:
# {
#   "success": false,
#   "error": {
#     "code": "BLOB_STORAGE_UNAVAILABLE",
#     "message": "Vercel Blob Storage temporarily unavailable. Retry after a few seconds."
#   }
# }
```

**Recovery**: Wait a few seconds and retry. If persistent, check Vercel Blob Storage status page.

### Error 7: Chaptered Video Not Generated (404 on GET)

```bash
curl -X GET 'http://localhost:3000/api/recording/chapters/rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_secure_token_min_32_characters_long'

# Response:
# {
#   "success": false,
#   "error": {
#     "code": "CHAPTERS_NOT_GENERATED",
#     "message": "Chaptered video has not been generated yet. Call POST /api/recording/chapters/{id} to regenerate."
#   }
# }
```

**Recovery**: Call `POST /api/recording/chapters/{id}` first to regenerate the chaptered video, then retry the GET request.

### Error 8: Chapter Not Found (404 on Play)

```bash
curl -X POST 'http://localhost:3000/api/recording/playback/play' \
  -H 'Authorization: Bearer your_secure_token_min_32_characters_long' \
  -H 'Content-Type: application/json' \
  -d '{
    "recordingId": "rec_2026-07-13T10-30-00Z",
    "chapterId": 99
  }'

# Response:
# {
#   "success": false,
#   "error": {
#     "code": "CHAPTER_NOT_FOUND",
#     "message": "Chapter ID does not exist for this recording"
#   }
# }
```

**Recovery**: Call `GET /api/recording/chapters/{id}` to fetch the valid chapter list. Use a `chapterId` in range [0, chapterCount - 1].

### Error 9: Unauthorized (401)

```bash
curl -X POST 'http://localhost:3000/api/recording/chapters/rec_2026-07-13T10-30-00Z' \
  -H 'Content-Type: application/json' \
  -d '{}'

# Response:
# {
#   "success": false,
#   "error": {
#     "code": "UNAUTHORIZED",
#     "message": "Missing or invalid authentication credentials"
#   }
# }
```

**Recovery**: Provide a valid `Authorization: Bearer <token>` header where `<token>` matches `URANOS_SYNC_TOKEN`, OR ensure an admin Clerk session cookie is present.

---

## End-to-End Workflow

A complete workflow from recording to chapter playback:

```bash
# 1. Start recording (Spec 004)
curl -X POST 'http://localhost:3000/api/recording/start' \
  -H 'Authorization: Bearer your_token' \
  -d '{"outputFilename": "rec_2026-07-13T10-30-00Z.mp4"}'

# 2. Ingest timestamps during recording (Spec 009)
curl -X POST 'http://localhost:3000/api/recording/timestamp' \
  -H 'Authorization: Bearer your_token' \
  -d '{"assetId": "rec_2026-07-13T10-30-00Z", "chapterTitle": "Chapter 1: Introduction"}'

# 3. Stop recording (Spec 004)
curl -X POST 'http://localhost:3000/api/recording/stop' \
  -H 'Authorization: Bearer your_token'

# 4. Regenerate chaptered video (Spec 010)
curl -X POST 'http://localhost:3000/api/recording/chapters/rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_token' \
  -d '{}'

# 5. List chapters (Spec 010)
curl -X GET 'http://localhost:3000/api/recording/chapters/rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_token'

# 6. Play chapter 1 (Spec 010)
curl -X POST 'http://localhost:3000/api/recording/playback/play' \
  -H 'Authorization: Bearer your_token' \
  -H 'Content-Type: application/json' \
  -d '{"recordingId": "rec_2026-07-13T10-30-00Z", "chapterId": 1}'

# 7. Stream chaptered video to player (Spec 010)
curl 'http://localhost:3000/api/recording/stream/rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_token'

# 8. Listen for chapter-boundary events (Spec 010)
curl -N 'http://localhost:3000/api/recording/events?recordingId=rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_token'
```

---

## ffprobe JSON Format Reference

The `ffprobe -show_chapters -of json` output structure (used internally by Aither):

```json
{
  "chapters": [
    {
      "id": 0,
      "time_base": "1/1000000",
      "start": 5000000,
      "start_time": "5.000000",
      "end": 20000000,
      "end_time": "20.000000",
      "tags": {
        "title": "Chapter 1: Introduction"
      }
    }
  ]
}
```

**Field Conversion**:
- `start` (microseconds) → `start` (seconds) = `start / 1_000_000`
- `end` (microseconds) → `end` (seconds) = `end / 1_000_000`
- Or use `start_time` / `end_time` strings directly (already in seconds).

---

## Testing the Implementation

### Unit Tests

```bash
# Run all unit tests
npm run test:unit

# Run only chapter-related tests
npm run test:unit -- --grep "chapters"
```

### Contract Tests

```bash
# Run contract tests for chapters endpoints
npm run test:contract -- --grep "chapters"
```

### E2E Tests

```bash
# Run E2E tests (requires running server)
npm run test:e2e -- --grep "chapters"
```

### Performance Tests

```bash
# Run performance benchmarks (requires test recordings)
npm run test:perf -- --grep "chapters"
```

**Expected Performance**:
- Remux p95: < 5 seconds (1–2 h recording, 1–3 GB).
- ffprobe extraction p95: < 500 milliseconds.

---

## Troubleshooting

### FFmpeg Not Found

```bash
# Check PATH
which ffmpeg
# /opt/homebrew/bin/ffmpeg  (macOS Homebrew)
# /usr/bin/ffmpeg            (Linux apt)

# If not found, install:
brew install ffmpeg          # macOS
sudo apt-get install ffmpeg  # Linux
```

### Permission Denied on /output/recordings/

```bash
# Check directory permissions
ls -ld /output/recordings/
# drwxr-xr-x  2 user  staff  4096  /output/recordings/

# Fix permissions (if needed)
chmod 755 /output/recordings/
chown $(whoami) /output/recordings/
```

### ffmetadata JSON Blob Corrupt

```bash
# Download the blob for inspection
vercel blob download ffmetadata/rec_2026-07-13T10-30-00Z.json

# Validate JSON structure
cat rec_2026-07-13T10-30-00Z.json | jq .

# If invalid, fix and re-upload:
echo '{"assetId":"rec_2026-07-13T10-30-00Z","chapters":[]}' | vercel blob put ffmetadata/rec_2026-07-13T10-30-00Z.json
```

### Chaptered MP4 Has No Chapters

```bash
# Resolve the MUX playback URL from persisted mapping, then verify chapters on that URL
# (local transient <assetId>.chapters.mp4 is deleted after successful upload)
MAPPING_JSON=$(vercel blob get ffmetadata/rec_2026-07-13T10-30-00Z.chapters.json)
MUX_URL=$(echo "$MAPPING_JSON" | jq -r '.muxPlaybackUrl')
ffprobe -show_chapters -of json "$MUX_URL" | jq '.chapters | length'
# 0  ← Problem!

# Check ffmetadata JSON blob has chapters
vercel blob get ffmetadata/rec_2026-07-13T10-30-00Z.json | jq '.chapters | length'
# 5  ← Source is correct

# Re-run regeneration (idempotent)
curl -X POST 'http://localhost:3000/api/recording/chapters/rec_2026-07-13T10-30-00Z' \
  -H 'Authorization: Bearer your_token' \
  -d '{}'
```

---

## Next Steps

- **Phase 2**: Generate `tasks.md` with TDD-ordered implementation tasks (run `/speckit.tasks`).
- **Implementation**: Follow the task list to build the feature module-by-module.
- **Testing**: Validate each module with unit, contract, and E2E tests.
