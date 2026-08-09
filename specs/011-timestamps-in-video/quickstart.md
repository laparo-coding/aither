# Quickstart: Timestamps in Video

**Phase**: 1 | **Date**: 2026-08-01 | **Spec**: [spec.md](spec.md)

## Prerequisites

- Aither running on `localhost:3000` (`npm run dev`)
- A chaptered recording exists (regenerated via `POST /api/recording/chapters/[id]`, Spec 010)
- Admin-authenticated session (Clerk) or Bearer token for API calls

## Validation 1: nextTimestamp Pure Function (Unit Test)

```bash
# Run the unit test for the pure nextTimestamp function
npx vitest run tests/unit/lib/recording/chapter-seek-logic.spec.ts
```

**Expected**: All tests pass (mid-chapter, at boundary, in last chapter, past last chapter, empty chapters, single chapter, position before first chapter).

## Validation 2: Server-Side startAtFirst (Contract Test)

```bash
# Run the contract test for the extended POST /api/recording/playback/play
npx vitest run tests/contract/recording/playback-play-initial-seek.spec.ts
```

**Expected**: All tests pass:
- `startAtFirst: true` + chaptered recording → 200 with `{ accepted, chapterId: 0, start, end }`
- `startAtFirst: true` + non-chaptered recording → 200 with `{ accepted: true }`
- `startAtFirst` omitted + chaptered recording → 200 with `{ accepted: true }` (Spec 004 resume)
- Explicit `chapterId` → Spec 010 behavior preserved

## Validation 3: Web Player Initial Seek + Next Timestamp Button (E2E)

```bash
# Run the Playwright E2E test for the web player
npx playwright test tests/e2e/recording/timestamps-player.spec.ts
```

**Expected**: All tests pass:
- Web player loads chapters on mount
- First `play` command seeks to `chapters[0].start` before playback
- "Next Timestamp" button (and "N" key) seeks to next chapter start
- Button disabled at last chapter
- Button disabled with hint when chapters not generated
- Fallback to headless when chapter fetch fails (404/401)

## Validation 4: Manual Browser Test

1. Open `http://localhost:3000/recording/player/<chaptered-recording-id>` in a browser.
2. Verify the video loads (headless, full-screen, no controls).
3. Trigger a `play` command (via SSE or dashboard).
4. Verify playback starts at `chapters[0].start` (not 0:00).
5. Press "N" or hover the bottom-right corner and click the "Next Timestamp" icon.
6. Verify the video seeks to the next chapter's start.
7. Press "N" repeatedly until the last chapter — verify the button disables.
8. Open a non-chaptered recording — verify the button is disabled with a hint.

## Validation 5: API Curl Test

```bash
# startAtFirst: true with chaptered recording
curl -X POST http://localhost:3000/api/recording/playback/play \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"recordingId":"rec_2026-07-13T10-30-00Z","startAtFirst":true}'

# Expected: {"success":true,"data":{"accepted":true,"chapterId":0,"start":5.0,"end":20.0}}

# startAtFirst omitted (Spec 004 resume)
curl -X POST http://localhost:3000/api/recording/playback/play \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"recordingId":"rec_2026-07-13T10-30-00Z"}'

# Expected: {"success":true,"data":{"accepted":true}}
```
