# Research: Chapters in Video (Phase 0)

**Phase**: 0 — Outline & Research  
**Spec Reference**: [spec.md](spec.md)  
**Plan Reference**: [plan.md](plan.md)

---

## Task 1: FFmpeg Remux Command Format

### Research Question
How to invoke FFmpeg with `-map_metadata 1 -codec copy` to embed chapter metadata from an FFMETADATA1 file into an MP4, ensuring compatibility with various input codecs (H.264, MJPEG, raw, etc.)?

### Decision
Use the following FFmpeg command template:

```bash
ffmpeg -i <raw.mp4> -i <ffmetadata.txt> -map_metadata 1 -codec copy -movflags +faststart <output.chapters.mp4>
```

**Exact Arguments Explained**:
- `-i <raw.mp4>` — Input 0: raw MP4 file (any codec stream).
- `-i <ffmetadata.txt>` — Input 1: FFMETADATA1 text file (from Spec 009 serializer).
- `-map_metadata 1` — Copy metadata from input 1 (the FFMETADATA1 file) into output.
- `-codec copy` — Stream copy: all codec streams pass unchanged (H.264, MJPEG, raw, etc.). **No re-encoding**.
- `-movflags +faststart` — Optimize MP4 moov atom placement for web playback (internet-friendly).
- `<output.chapters.mp4>` — Transient output file path (e.g., `/output/recordings/<assetId>.chapters.mp4`); deleted after successful MUX upload per Constitution Principle VIII.

**Codec Compatibility**:
- `-codec copy` is codec-agnostic: works with H.264, MJPEG, H.265, VP8, AV1, raw video, PCM, AAC, opus, etc.
- No transcoding occurs; remux completes in seconds regardless of input codec or video duration (1–3 GB typical).

**Child Process Spawning** (Node.js):
```typescript
spawn("ffmpeg", [
  "-i", rawMp4Path,
  "-i", ffmetadata1Path,
  "-map_metadata", "1",
  "-codec", "copy",
  "-movflags", "+faststart",
  chaptersOutputPath
])
```

**Stderr Monitoring**:
- Monitor stderr for error keywords: `error`, `invalid`, `not found`, `permission denied`, `file too short`, `unknown encoder`.
- Parse final frame count / duration from stderr summary line (`frame=... fps=...`).
- On exit code ≠ 0: capture stderr and return `502 REMUX_FAILED`.

### Rationale

- **Stream Copy** (`-codec copy`): Eliminates re-encoding overhead. Typical 1–2 h seminar recording remuxes in seconds (~2–5 GB/min effective throughput on modern hardware).
- **`-movflags +faststart`**: Web playback benefit; ensures moov atom appears early in file for fast streaming / seeking.
- **Input 1 Precedence** (`-map_metadata 1`): When multiple metadata sources exist, input 1 (FFMETADATA1) takes precedence; ensures chapter embedding.
- **Codec Independence**: The `-codec copy` argument works for all video/audio codecs; no need to detect or specify codec type at spawn time.

### Alternatives Considered

1. **Re-encode with `-c:v libx264 -c:a aac`** — Rejected: adds 1–5 min overhead per recording; defeats the synchronous execution goal. Unnecessary for chapter embedding (metadata is orthogonal to codec).
2. **Use `mp4box` (ISO Base Media File Format tool)** — Rejected: requires additional tool installation; FFmpeg is already a dependency and widely available.
3. **Parse and directly manipulate MP4 structure (Python `mp4-python` lib)** — Rejected: binary format manipulation is fragile; FFmpeg is battle-tested and handles edge cases (codec-specific nuances, moov placement, compatibility).

---

## Task 1b: MUX Upload API Integration

### Research Question
How to upload the transient chaptered MP4 directly to MUX using `@mux/mux-node`, resolve the resulting `muxAssetId`, and ensure idempotent re-upload semantics (Constitution Principle VIII — Direct MUX Upload; MUX as single source of truth for video)?

### Decision

**Library**: `@mux/mux-node` (official MUX Node SDK), configured with `MUX_TOKEN_ID` and `MUX_TOKEN_SECRET` from environment.

**Upload Flow** (direct upload — recommended by MUX for files already on the server):

```typescript
import Mux from "@mux/mux-node";
const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID!,
  tokenSecret: process.env.MUX_TOKEN_SECRET!,
});

// 1. Create a direct upload (one-time use URL)
const upload = await mux.video.uploads.create({
  cors_origin: process.env.PUBLIC_BASE_URL ?? "http://localhost:3001",
  new_asset_settings: {
    playback_policies: ["public"],
    mp4_support: "standard", // enables MP4 playback URL for ffprobe + HTML5 <video>
  },
});

// 2. Stream the transient chaptered MP4 to the upload URL
await fetch(upload.url, {
  method: "PUT",
  body: fs.createReadStream(transientChaptersPath),
  headers: { "Content-Type": "video/mp4" },
  duplex: "half",
});

// 3. Wait for the asset to be ready (poll or webhook)
let uploadState = upload;
while (uploadState.status !== "asset_created") {
  await new Promise((resolve) => setTimeout(resolve, 1000));
  uploadState = await mux.video.uploads.retrieve(upload.id);
}

const muxAssetId = uploadState.asset_id;
const asset = await mux.video.assets.retrieve(muxAssetId!);
```

**Asset ID Resolution**:
- `muxAssetId` = `upload.asset_id` (stable, returned immediately after upload creation).
- Playback URL: `https://stream.mux.com/<playback-id>.mp4` (resolved once asset is ready; `mp4_support: "standard"` ensures MP4 derivative exists).
- ffprobe target: the MP4 playback URL (enables `ffprobe -show_chapters -of json <mux-mp4-url>`).

**Idempotent Re-upload**:
- MUX does not support in-place overwrite of an existing asset. Idempotence is achieved by:
  1. Looking up an existing chaptered asset for `assetId` (via a mapping `assetId → muxAssetId`, stored as a Vercel Blob metadata entry at `ffmetadata/<assetId>.chapters.json` or derived from MUX asset tags).
  2. If present: create a new upload, upload the new chaptered MP4, update the mapping to the new `muxAssetId`, and (optionally) delete the old MUX asset via `Video.Assets.delete(oldMuxAssetId)`.
  3. If absent: create a new upload + asset, store the mapping.
- Response shape is identical across re-invocations (`{ assetId, muxAssetId, chapterCount }`); only `muxAssetId` may differ if a new asset was created.

**Transient File Cleanup**:
- After a successful MUX upload (HTTP 200 from the PUT), delete the local transient file via `fs.promises.unlink(transientChaptersPath)`.
- On upload failure: return `502 REMUX_FAILED` (or a dedicated `503 MUX_UPLOAD_FAILED`), log via Rollbar, and delete the transient file to avoid local accumulation.

**Environment Variables**:
- `MUX_TOKEN_ID` — MUX API token ID (server-side only, never exposed to client).
- `MUX_TOKEN_SECRET` — MUX API token secret (server-side only).
- `BLOB_READ_WRITE_TOKEN` — Vercel Blob token (for the `assetId → muxAssetId` mapping, same store as Spec 009).

### Rationale

- **Direct Upload (not URL-based ingest)**: The chaptered MP4 exists only as a transient local file; MUX direct upload streams it without requiring a public URL. Avoids exposing the file publicly.
- **`mp4_support: "standard"`**: Ensures a downloadable MP4 derivative exists — required for `ffprobe -show_chapters` on the MUX URL and for HTML5 `<video>` chapter addressing.
- **Mapping via Vercel Blob**: Keeps Aither stateless (no local DB); the mapping is a small JSON blob, consistent with Spec 009's blob usage.
- **Delete old asset on re-upload**: Prevents orphaned MUX assets; keeps MUX billing lean.

### Alternatives Considered

1. **URL-based ingest (MUX pulls from a public URL)** — Rejected: would require exposing the transient file via a public HTTP endpoint; violates the transient, non-public nature of the file and adds exposure risk.
2. **Store chaptered MP4 permanently on local disk (no MUX)** — Rejected: violates Constitution Principle VIII (Direct MUX Upload; MUX as single source of truth) and Principle VII (no local persistent storage).
3. **Use MUX webhooks instead of polling for asset readiness** — Rejected for synchronous flow: webhooks require an async endpoint and complicate the synchronous execution model (FR-001). Polling with a short timeout (e.g., 30 s) is acceptable since MP4 derivative creation is fast for standard support.

---

## Task 2: ffprobe JSON Output Schema

### Research Question
What is the exact JSON structure returned by `ffprobe -show_chapters -of json`? Which fields are present, and how are chapter times represented (seconds, microseconds)?

### Decision

**Command**:
```bash
ffprobe -show_chapters -of json <mux-playback-url>
```

**Output JSON Structure**:
```json
{
  "chapters": [
    {
      "id": 0,
      "time_base": "1/1000",
      "start": 5000,
      "start_time": "5.000000",
      "end": 20000,
      "end_time": "20.000000",
      "tags": {
        "title": "Chapter 1"
      }
    },
    {
      "id": 1,
      "time_base": "1/1000",
      "start": 20000,
      "start_time": "20.000000",
      "end": 45000,
      "end_time": "45.000000",
      "tags": {
        "title": "Chapter 2"
      }
    }
  ]
}
```

**Field Breakdown**:
- `id` (number) — Zero-based chapter index.
- `time_base` (string, e.g., `"1/1000"`) — Timebase denominator. Represents the divisor to convert `start`/`end` integers to seconds. Common values: `1/1000` (milliseconds), `1/1000000` (microseconds).
- `start` (number) — Chapter start time in timebase units.
- `start_time` (string, e.g., `"5.000000"`) — Human-readable start time in seconds (already converted).
- `end` (number) — Chapter end time in timebase units.
- `end_time` (string) — Human-readable end time in seconds.
- `tags` (object) — Metadata tags. `title` is the chapter name (string, required for this feature).

**Conversion Logic** (to seconds for API response):
```typescript
const [numerator, denominator] = timeBase.split('/').map(Number); // e.g., "1/1000" → [1, 1000]
const startSeconds = start / denominator; // e.g., 5000 / 1000 = 5.0
const endSeconds = end / denominator;    // e.g., 20000 / 1000 = 20.0
```

Alternatively, use the pre-converted `start_time`/`end_time` strings and parse to float (simpler, less error-prone).

**Validation Rules** (from Spec 010):
- Chapter count MUST match ffmetadata JSON's `chapters[]` length (cross-check for consistency).
- `start` < `end` for all chapters (monotonic ordering).
- No chapter overlap.
- Final chapter `end` MUST equal video duration (clamped during remux in Task 1).

**Error Handling**:
- If ffprobe exits with code ≠ 0: return `502 REMUX_FAILED`.
- If JSON parse fails: return `502 REMUX_FAILED`.
- If `chapters` array is empty: return `502 REMUX_FAILED` (no chapters embedded).

### Rationale

- **Timebase Representation**: FFmpeg uses a rational timebase (`start`/denominator) for precise timing across variable frame rates. The `time_base` field tells us the conversion factor.
- **Dual Representation** (numeric + string): The `start_time`/`end_time` string fields are pre-computed for convenience; we use them directly for API responses (simpler parsing).
- **Cross-Check Validation**: Comparing ffprobe output chapter count with ffmetadata JSON ensures no chapters were lost or added during remux — a safeguard against FFmpeg bugs or file corruption.

### Alternatives Considered

1. **Extract chapters using `ffmpeg -dump_attachment:t ""` and manual parsing** — Rejected: more complex and error-prone than ffprobe. ffprobe is designed for metadata inspection.
2. **Store chapter metadata separately (JSON file) instead of querying ffprobe each time** — Rejected: introduces stale data risk if MUX asset updated post-remux. Spec 010 explicitly mandates ffprobe query at lookup time (single source of truth = MUX chaptered asset).

---

## Task 3: FFMETADATA1 Serialization

### Research Question
How to convert ffmetadata JSON (Spec 009 format) to FFMETADATA1 text format, and how to handle the final chapter's placeholder `end` offset clamping?

### Decision

**FFMETADATA1 Text Format** (from FFmpeg metadata documentation):
```
;FFMETADATA1
[CHAPTER]
TIMEBASE=1/1000
START=5000
END=20000
title=Chapter 1
[CHAPTER]
TIMEBASE=1/1000
START=20000
END=45000
title=Chapter 2
```

**Serialization Algorithm**:

1. **Read ffmetadata JSON blob** from Vercel Blob Storage (`FFMetadataJSONSchema` validated).
   ```typescript
   interface FFMetadataJSON {
     assetId: string;
     recordingStartedAt: string; // ISO8601
     chapters: { 
       id: number; 
       title: string; 
       offset: { micros: number }; 
       end?: { micros: number }; // placeholder may be 0
     }[];
   }
   ```

2. **Fetch video duration** via ffprobe on raw MP4:
   ```bash
   ffprobe -show_format -of json <raw.mp4> | jq '.format.duration' # seconds as float
   ```

3. **Build FFMETADATA1 lines**:
   ```typescript
   const lines = [";FFMETADATA1"];
   const videoDurationMicros = videoDuration * 1_000_000; // convert to microseconds
   
   chapters.forEach((chapter, idx) => {
     const startMicros = chapter.offset.micros;
     const isFinalChapter = (idx === chapters.length - 1);
     
     // Clamp final chapter's end to video duration
     const endMicros = isFinalChapter
       ? videoDurationMicros
       : (chapter.end?.micros || startMicros); // fallback if no end provided
     
     lines.push("[CHAPTER]");
     lines.push("TIMEBASE=1/1000000"); // microeconds
     lines.push(`START=${startMicros}`);
     lines.push(`END=${endMicros}`);
     lines.push(`title=${chapter.title}`);
   });
   
   return lines.join("\n");
   ```

4. **Write FFMETADATA1 to temporary file** (e.g., `/tmp/ffmetadata_<assetId>.txt`).

5. **Pass to FFmpeg** (from Task 1):
   ```bash
   ffmpeg -i <raw.mp4> -i <ffmetadata1.txt> -map_metadata 1 -codec copy <chapters.mp4>
   ```

**Clamping Rationale** (from Spec 009 & 010):
- Spec 009 stores the final chapter's `end` as zero-length placeholder (set at recording stop, before knowing the true duration).
- Spec 010 requires clamping the final chapter's `end` to the actual video duration at remux time (ensures no overshoot).
- Example: If final chapter starts at 1 h 50 min (6900 s) and video is 2 h (7200 s), clamp to 7200 s.

**Timebase Normalization**:
- Always use `TIMEBASE=1/1000000` (microseconds) for consistency across all chapters.
- Spec 009 may have chapters with varying timebases; normalize during serialization.

### Rationale

- **Microecond Precision**: Highest common resolution for audio/video timing; no loss of precision from Spec 009's offset storage.
- **Temporary File**: FFmpeg expects a file path for the `-i` metadata input; avoids pipe complexity.
- **Clamping at Remux Time**: Ensures the final chapter doesn't exceed the video's actual playback duration, preventing player edge cases.

### Alternatives Considered

1. **Pass chapter metadata as a JSON blob to FFmpeg directly** — Rejected: FFmpeg does not accept JSON metadata natively. FFMETADATA1 text format is the standard.
2. **Clamp the final chapter's `end` during Spec 009's timestamp ingestion** — Rejected: Spec 009 decouples timestamp endpoint from recording stop lifecycle; the timestamp doesn't know the final video duration. Clamping must occur at remux time (Spec 010) when duration is known.
3. **Skip clamping and store final chapter as zero-length** — Rejected: Spec 010 explicitly requires clamping (FR-008); zero-length chapter would confuse players and APIs.

---

## Task 4: SSE chapter-boundary Event Format

### Research Question
How to define the `chapter-boundary` event that the player emits when reaching a chapter's `end` offset? What is the exact event structure and when should it be emitted?

### Decision

**SSE Event Format**:

From the existing `/api/recording/events` SSE channel, emit:

```
event: chapter-boundary
data: {"chapterId": 1, "nextChapterId": 2}

```

**Event Structure** (as JSON payload):
```typescript
interface ChapterBoundaryEvent {
  event: "chapter-boundary";
  chapterId: number;           // ID of the chapter that just ended
  nextChapterId?: number;      // ID of the next chapter (if any)
  timestamp?: number;          // (optional) server-side timestamp in ms
}
```

**Emission Timing**:
- **Trigger**: When the player's current playback position reaches or exceeds a chapter's `end` offset (within ±500 ms tolerance for buffering jitter).
- **Payload**: Include the chapter ID that is ending and optionally the next chapter ID (so Gaia can decide whether to auto-play the next chapter or require explicit request).
- **Before Pause**: Emit the event **before** the player pauses. This gives Gaia the opportunity to react immediately (e.g., fetch next chapter metadata, decide on auto-advance).

**Emission Implementation** (in `src/app/api/recording/events/route.ts`):
```typescript
// When player state update arrives (e.g., "position": 45.2)
const reachedChapter = [...chapters]
  .reverse()
  .find(ch => position >= ch.end);
if (reachedChapter) {
  const nextChapter = chapters[reachedChapter.id + 1];
  dispatchSSE(recordingId, {
    action: "chapter-boundary",
    chapterId: reachedChapter.id,
    nextChapterId: nextChapter?.id
  });
  // Then pause the player (separate command or auto-pause in Gaia)
}
```

**Error Scenarios**:
- If `chapterId` is out of range (corrupted player state), do NOT emit. Log via Rollbar.
- If player position skips past multiple chapters (seek to end), emit event for the final chapter reached.

**Coexistence with Existing SSE Commands**:
- Existing commands: `play`, `stop`, `seek` (from Spec 004 playback-controller).
- New command: `chapter-boundary` (added to SSECommand union type).
- No breaking changes to existing command handling.

### Rationale

- **Event Name**: `chapter-boundary` is self-descriptive (clear semantic meaning).
- **Next Chapter ID**: Allows Gaia to pre-fetch or validate the next chapter without a separate query; improves UX responsiveness.
- **Tolerance Window** (±500 ms): Accounts for audio buffering, network jitter, and player timing precision. Prevents duplicate events from buffering artifacts.
- **SSE Over REST Polling**: Real-time push (SSE) is more efficient than Gaia polling playback status. Aligns with existing Spec 004 playback-controller architecture.

### Alternatives Considered

1. **Emit event only after player pauses (no proactive emit)** — Rejected: Gaia may need to prepare the next chapter before pause completes; proactive emit enables smoother transitions.
2. **Use WebSocket instead of SSE** — Rejected: Existing architecture uses SSE (established in Spec 004). WebSocket would require new infrastructure.
3. **Include full next chapter metadata in the event** — Rejected: Bloats the event payload; Gaia can query `GET /api/recording/chapters/[id]` for full chapter list on demand.

---

## Task 5: Error Recovery & Cleanup

### Research Question
How to handle remux failures gracefully, clean up partial files, and ensure idempotent upserts (safe re-runs)?

### Decision

**Failure Scenarios and Recovery**:

| Scenario | Trigger | Recovery Action | HTTP Status |
|----------|---------|-----------------|-------------|
| Recording not found | No `/output/recordings/<assetId>.mp4` | Return early; no cleanup needed | 404 RECORDING_NOT_FOUND |
| ffmetadata blob not found | Blob read fails (404) | Return early; no cleanup needed | 404 FFMETADATA_NOT_FOUND |
| Recording still active | Session status = `recording` or `starting` | Return early; no cleanup needed | 409 RECORDING_IN_PROGRESS |
| ffmetadata JSON invalid | Schema validation fails | Return early; no cleanup needed | 422 FFMETADATA_INVALID |
| Blob storage unavailable | Network error / timeout | Return early; no cleanup needed | 503 BLOB_STORAGE_UNAVAILABLE |
| FFmpeg process fails | Exit code ≠ 0 | Delete partial output file; return error | 502 REMUX_FAILED |
| ffprobe validation fails | Chapter count mismatch | Delete partial output file; return error | 502 REMUX_FAILED |

**Cleanup Procedure for FFmpeg Failure**:
```typescript
const chaptersOutputPath = `/output/recordings/${assetId}.chapters.mp4`;
try {
  await spawnFFmpeg([/* args */]);
} catch (error) {
  // Delete partial file if it exists
  try {
    await fs.promises.unlink(chaptersOutputPath);
  } catch (cleanupErr) {
    // Log cleanup failure but don't propagate (file may not exist)
    reportError("cleanup_failed", { assetId, error: cleanupErr });
  }
  throw new RemuxFailedError(error);
}
```

**Idempotent Upsert Behavior**:
- If a MUX chaptered asset already exists for `assetId`, re-upload overwrites it (idempotent; no conflict).
- Return the same response shape as a fresh generation.
- Rationale: Gaia may retry the request if the first response was lost; idempotence ensures safe re-runs.
- Implementation: Write to final path directly (not temp file + rename), or use atomic rename if atomicity is critical.

**File System Guarantees**:
- Assume `/output/recordings/` exists (created by Spec 004 recording module).
- Write permissions required (validated at startup or on first use).
- Disk space check (optional): If available disk < 2× expected output size, return `503 STORAGE_UNAVAILABLE` before attempting remux.

**Logging & Monitoring**:
- All errors logged via Rollbar (`reportError`) with context: `{ assetId, recordingDuration, videoDurationMicros, ffmpegExitCode, ffmpegStderr }`.
- No bearer tokens, file paths, or blob URLs in logs.

### Rationale

- **No Partial Files**: Dangling partial files consume disk space and confuse subsequent operations. Explicit cleanup ensures clean state.
- **Idempotent Upsert**: Gaia/operators may retry failed requests; idempotence prevents conflicts or duplicate files.
- **Early Validation Gates**: Pre-check (recording exists, blob readable, recording not active) before spawning FFmpeg; avoids wasting resources on known failures.

### Alternatives Considered

1. **Use temporary file + atomic rename** — Rationale: Prevents partial files from being served during remux. Implementation: `ffmpeg ... /tmp/chapters_<assetId>.<random>.mp4` → `mv` to final path on success. Adds atomic guarantees but complexity; may not be necessary given synchronous execution.
2. **Implement job-status tracking (202 Accepted)** — Rejected: Contradicts Spec 010's synchronous execution requirement; adds state persistence complexity.
3. **Auto-cleanup on timer (e.g., delete files older than N days)** — Rationale: Lifecycle management of chaptered assets. Delegated to existing Spec 004 recording lifecycle endpoints (out of scope for Spec 010).

---

## Task 6: Performance Measurement Protocol

### Research Question
How to measure p95 latency for remux (< 5 s) and ffprobe extraction (< 500 ms) to validate Spec 010 constraints?

### Decision

**Performance Goals** (from plan.md Technical Context):
- **Remux p95**: < 5 seconds (typical 1–2 h seminar recording, 1–3 GB).
- **ffprobe Extraction p95**: < 500 milliseconds (query embedded chapters from the MUX chaptered asset via its playback URL).

**Measurement Protocol**:

### Benchmark 1: FFmpeg Remux Latency

**Setup**:
- Test recordings: 3 sizes (30 min / 500 MB, 1 h / 1.5 GB, 2 h / 3 GB).
- Each size: run 10 iterations.
- Compute p95 (95th percentile) of remux times.

**Test Code**:
```typescript
const times = [];
for (let i = 0; i < 10; i++) {
  const start = Date.now();
  await spawnFFmpeg([ /* remux args */ ]);
  const elapsed = Date.now() - start;
  times.push(elapsed);
}
const p95 = times.sort((a, b) => a - b)[Math.ceil(times.length * 0.95) - 1];
console.log(`p95 remux: ${p95} ms`);
```

**Expected Results**:
- 30 min: 1–2 s
- 1 h: 2–3 s
- 2 h: 3–5 s
- **Target**: All p95 < 5 s ✅

**Validation Gate**: If any p95 > 5 s, investigate FFmpeg settings (e.g., `-fast`, `-preset`) or hardware limitations.

### Benchmark 2: ffprobe Chapter Extraction Latency

**Setup**:
- Test file: MUX chaptered asset (5 chapters, from Benchmark 1 outputs); ffprobe runs against the MUX playback URL.
- Run 20 iterations per file size.
- Compute p95 extraction time.

**Test Code**:
```typescript
const times = [];
for (let i = 0; i < 20; i++) {
  const start = Date.now();
  const result = await execFileAsync("ffprobe", [
    "-show_chapters",
    "-of", "json",
    chaptersPath
  ]);
  const elapsed = Date.now() - start;
  times.push(elapsed);
  // Validate JSON parse + schema validation
  const parsed = JSON.parse(result);
  ChapterListResponseSchema.parse(parsed);
}
const p95 = times.sort((a, b) => a - b)[Math.ceil(times.length * 0.95) - 1];
console.log(`p95 ffprobe: ${p95} ms`);
```

**Expected Results**:
- All sizes: 100–300 ms
- **Target**: p95 < 500 ms ✅

**Validation Gate**: If p95 > 500 ms, investigate ffprobe version or JSON parsing overhead.

### Benchmark 3: End-to-End Latency (Integration)

**Setup**:
- Full flow: POST /api/recording/chapters/[id] (regenerate) + GET /api/recording/chapters/[id] (list).
- Run 5 times for 2 h test recording.
- Measure total time.

**Expected Result**:
- Remux (~5 s) + ffprobe (~300 ms) + I/O overhead (~100 ms) ≈ 5.4 s total.
- Acceptable: <= 6 s p95 for full flow.

**Test Harness** (location):
- File: `tests/performance/chapters.perf.spec.ts`
- Runs as separate test suite (not in unit/contract tests).
- Requires real test recordings (symlinked or downloaded).
- CI/CD: Optional (performance tests may be slow; run manually or on dedicated performance machines).

### Performance Monitoring in Production

- Instrument the regenerate endpoint with latency histograms (via Rollbar or custom middleware).
- Log slow operations (> 10 s) as warnings; > 30 s as errors.
- Alert on sustained degradation (p95 trending upward).

### Rationale

- **p95 Over Average**: 95th percentile captures tail latencies (important for user experience); average can mask spikes.
- **Multiple Sizes**: Remux time is roughly linear with file size; testing multiple sizes validates the model.
- **Real Test Files**: Synthetic/empty files may behave differently; use actual 1–2 h seminar recordings.

### Alternatives Considered

1. **Analytical Performance Modeling** (e.g., estimate 500 MB/min FFmpeg throughput) — Rationale: Faster than benchmarking but less reliable. Use modeling to set initial targets, then validate with benchmarks.
2. **Continuous Performance Monitoring (real recordings)** — Rationale: Detect regressions in production. Infrastructure cost vs. value trade-off.
3. **Fractional Test Recordings** (e.g., 10 min clips) — Rejected: Doesn't reflect true production workload (1–2 h recordings); remux behavior may differ at scale.

---

## Summary: Phase 0 Complete

All research tasks resolved with concrete decisions:

| Task | Decision | Validation Gate |
|------|----------|-----------------|
| 1. FFmpeg Remux Command | `ffmpeg -i raw.mp4 -i ffmetadata.txt -map_metadata 1 -codec copy -movflags +faststart output.chapters.mp4` (transient; deleted after MUX upload) | Codec-agnostic; works for H.264, MJPEG, etc. |
| 2. MUX Upload Integration | `@mux/mux-node` direct upload; transient local file streamed to MUX; `muxAssetId` returned; local file deleted on success | Idempotent re-upload overwrites existing MUX asset |
| 3. ffprobe JSON Schema | Timebase conversion; `start_time`/`end_time` in seconds; chapter count cross-check on MUX playback URL | Parsed schema matches real ffprobe output |
| 4. FFMETADATA1 Serialization | Normalize to `TIMEBASE=1/1000000`; clamp final chapter `end` to video duration | Roundtrip: ffmetadata JSON → FFMETADATA1 → ffprobe output matches |
| 5. SSE chapter-boundary Event | `{ event: "chapter-boundary", chapterId, nextChapterId? }` emitted when position ≥ chapter.end; tick cadence ≤ 500 ms; dedupe key `recordingId:chapterId` | Event payload schema validated in tests |
| 6. Error Recovery & Cleanup | Atomic cleanup (unlink transient file on failure); idempotent re-upload to MUX; early validation gates | All failure paths tested; no orphaned local files |
| 7. Performance Measurement | Benchmark protocol: 10 iterations per size; p95 < 5s remux, p95 < 500ms ffprobe on MUX URL | Perf test suite in `tests/performance/` |

**Next Phase**: Phase 1 (Design & Contracts) — Generate `data-model.md`, OpenAPI contracts, and `quickstart.md` using these research findings.
