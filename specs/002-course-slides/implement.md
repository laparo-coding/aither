# Implementation Guide: Course Slides

## Overview

This guide documents the step-by-step implementation of the Course Slides feature. It generates static HTML slides (1920×1080) for the next upcoming course from the Hemera API: an intro slide with course name and dates, curriculum slides per lesson, and material slides per content item (text, image, video). Slides are triggered via `POST /api/slides` and output to `output/slides/{courseId}/`.

---

## Part 1: Setup — Types and Layout

### Step 1: Slide Types

Create `src/lib/slides/types.ts`:

```typescript
export type SlideType = "intro" | "curriculum" | "material";

export interface SlideJob {
  jobId: string;
  startTime: string;
  endTime: string | null;
  status: "running" | "success" | "failed";
  slidesGenerated: number;
  errors: { slide: string; message: string; timestamp: string }[];
}

export interface SlideError {
  slide: string;
  message: string;
  timestamp: string;
}

export interface GeneratedSlide {
  filename: string;
  type: SlideType;
  title: string;
}

export interface SlideGenerationResult {
  slidesGenerated: number;
  courseTitle: string;
  courseId: string;
  slides: GeneratedSlide[];
}
```

### Step 2: HTML Layout (1920×1080)

Create `src/lib/slides/html-layout.ts`:

```typescript
export function wrapInLayout(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=1920">
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --primary-color: #1a1a2e;
      --text-color: #ffffff;
      --font-family: system-ui, -apple-system, sans-serif;
      --bg-color: #16213e;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 1920px;
      height: 1080px;
      font-family: var(--font-family);
      background: var(--bg-color);
      color: var(--text-color);
    }
    .slide-content {
      text-align: center;
      max-width: 80%;
    }
  </style>
</head>
<body>
  <div class="slide-content">
    ${content}
  </div>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

### Step 3: Layout Unit Test

Create `tests/unit/html-layout.spec.ts` — test `wrapInLayout()`:
- Produces valid HTML with 1920×1080 dimensions
- CSS custom properties present (`--primary-color`, `--bg-color`, etc.)
- Content injected correctly within `.slide-content`
- Title is properly escaped

### Step 4: Verify .gitignore

Ensure `output/slides/` is covered by the existing `output/` rule in `.gitignore`.

---

## Part 2: User Story 1 — Intro Slide (P1 MVP)

### Step 5: Course Resolver Tests (write FIRST — TDD)

Create `tests/unit/course-resolver.spec.ts`:
- Picks the nearest future seminar from multiple
- Returns error when no future seminars exist
- Handles empty API response
- Ignores seminars with no dates

### Step 6: Intro Slide Builder Tests (write FIRST — TDD)

Add to `tests/unit/slide-builder.spec.ts`:
- Course name centered in `<h1>`
- Start date formatted in de-CH locale (for example `15.03.2026`)
- End date shown only when different from start date (YYYY-MM-DD comparison)
- End date hidden when same day
- HTML properly escaped

### Step 7: Course Resolver

Create `src/lib/slides/course-resolver.ts`:

```typescript
import type { HemeraClient } from "@/lib/hemera/client";
import { SeminarsResponseSchema } from "@/lib/hemera/schemas";
import type { Seminar } from "@/lib/hemera/types";

export async function getNextCourse(client: HemeraClient): Promise<Seminar> {
  const seminars = await client.get("/seminars", SeminarsResponseSchema);
  const now = new Date();

  const futureSeminars = seminars
    .filter((s) => s.dates.length > 0)
    .filter((s) => new Date(s.dates[0].start) > now)
    .sort((a, b) =>
      new Date(a.dates[0].start).getTime() - new Date(b.dates[0].start).getTime()
    );

  if (futureSeminars.length === 0) {
    throw new Error("No upcoming course found. All seminars are in the past or have no dates.");
  }

  return futureSeminars[0];
}
```

### Step 8: Intro Slide Builder

Add to `src/lib/slides/slide-builder.ts`:

```typescript
import type { Seminar } from "@/lib/hemera/types";
import { wrapInLayout } from "./html-layout";

const dateFormatter = new Intl.DateTimeFormat("de-CH", {
  day: "numeric",
  month: "long",
  year: "numeric",
});

export function buildIntroSlide(seminar: Seminar): string {
  const startDate = new Date(seminar.dates[0].start);
  const endDate = new Date(seminar.dates[0].end);
  const startFormatted = dateFormatter.format(startDate);
  const isSameDay = toDateOnly(seminar.dates[0].start) === toDateOnly(seminar.dates[0].end);

  let dateHtml: string;
  if (isSameDay) {
    dateHtml = `<p style="font-size: 2rem; margin-top: 1rem;">${startFormatted}</p>`;
  } else {
    const endFormatted = dateFormatter.format(endDate);
    dateHtml = `<p style="font-size: 2rem; margin-top: 1rem;">${startFormatted} – ${endFormatted}</p>`;
  }

  const content = `<h1 style="font-size: 4rem;">${escapeHtml(seminar.title)}</h1>\n    ${dateHtml}`;
  return wrapInLayout(seminar.title, content);
}

function toDateOnly(isoDate: string): string {
  return new Date(isoDate).toISOString().slice(0, 10);
}
```

### Step 9: Slide File Writer

Implement in `src/lib/slides/generator.ts`:

```typescript
private async clearDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

private async writeSlide(dir: string, filename: string, html: string): Promise<void> {
  await fs.writeFile(path.join(dir, filename), html, "utf-8");
}
```

**Checkpoint**: Can determine next course and generate intro slide. Minimal viable output.

---

## Part 3: User Story 2 — Curriculum Slides (P1 MVP)

### Step 10: Curriculum Slide Tests (write FIRST — TDD)

Add to `tests/unit/slide-builder.spec.ts`:
- Lesson title centered in `<h1>`
- Correct filename pattern: `{NN}_{slugifiedTitleOrFallback}.html` (FR-003) — e.g., `002_grundlagen.html`
- Slugify fallback: when `slugify(lessonTitle)` yields empty, use `lesson-{lessonIndex}` (1-based, zero-padded two digits)
- Lessons filtered by `seminarId` (only matching course)
- Sorted by `sequence` field (not API response order)
- Global sequence counter `{NN}` (FR-004b) continues from intro slide

### Step 11: Lesson Fetching & Filtering

Implement in `src/lib/slides/generator.ts`:

```typescript
// Fetch all lessons, filter by seminarId, sort by sequence
const allLessons = await this.client.get("/lessons", LessonsResponseSchema);
const courseLessons = allLessons
  .filter((l) => l.seminarId === seminar.sourceId)
  .sort((a, b) => a.sequence - b.sequence);
```

### Step 12: Curriculum Slide Builder

Add to `src/lib/slides/slide-builder.ts`:

```typescript
export function buildCurriculumSlide(lesson: Lesson): string {
  const content = `<h1 style="font-size: 3.5rem;">${escapeHtml(lesson.title)}</h1>`;
  return wrapInLayout(lesson.title, content);
}
```

**Checkpoint**: Intro + curriculum slides generated. Course structure visible as presentation.

---

## Part 4: User Story 3 — Material Slides (P2)

### Step 13: Material Slide Tests (write FIRST — TDD)

Add to `tests/unit/slide-builder.spec.ts`:
- Text content slide: HTML body centered in `<div>`
- Image slide: `<img>` with `src` and `alt` text
- Video slide: `<video>` with `controls` attribute
- Correct filename pattern: `{NN}_{slugifiedDescriptor}.html` (FR-004a) with global `{NN}` counter (FR-004b)
- Descriptor patterns: text → `{slug}-text-{idx}`, image → `{slugifiedImageTitle}` or fallback `{slug}-image-{idx}`, video → `{slugifiedVideoTitle}` or fallback `{slug}-video-{idx}`
- Global sequence counter continues from last curriculum slide

### Step 14: Text & Media Fetching

Extend `src/lib/slides/generator.ts` (the `slugify` helper is defined as a module-level function in this file — see `src/lib/slides/generator.ts` line ~46):

```typescript
const allTexts = await this.client.get("/texts", TextContentsResponseSchema);
const allMedia = await this.client.get("/media", MediaAssetsResponseSchema);

for (const [lessonIdx, lesson] of courseLessons.entries()) {
  const lessonSlug = slugify(lesson.title) || `lesson-${String(lessonIdx + 1).padStart(2, "0")}`;

  const lessonTexts = allTexts.filter(
    (t) => t.entityRef.type === "lesson" && t.entityRef.id === lesson.sourceId
  );
  const lessonMedia = allMedia.filter(
    (m) => m.entityRef.type === "lesson" && m.entityRef.id === lesson.sourceId
  );

  let textIdx = 1;
  for (const text of lessonTexts) {
    const html = buildTextSlide(text);
    const descriptor = `${lessonSlug}-text-${textIdx}`;
    const filename = `${String(globalSeq++).padStart(3, "0")}_${descriptor}.html`;
    await this.writeSlide(courseOutputDir, filename, html);
    slides.push({ filename, type: "material", title: "Text Content" });
    textIdx++;
  }
  // Independent per-type counters (FR-004a: each type resets to 1 per lesson)
  let imageIdx = 1;
  let videoIdx = 1;
  for (const media of lessonMedia) {
    const html = media.mediaType === "image" ? buildImageSlide(media) : buildVideoSlide(media);
    const idx = media.mediaType === "image" ? imageIdx++ : videoIdx++;
    const descriptor = this.buildMediaDescriptor(media, lessonSlug, idx);
    const filename = `${String(globalSeq++).padStart(3, "0")}_${descriptor}.html`;
    await this.writeSlide(courseOutputDir, filename, html);
    slides.push({ filename, type: "material", title: media.altText ?? media.mediaType });
  }
}

// Helper: build descriptor per FR-004a
private buildMediaDescriptor(media: MediaAsset, lessonSlug: string, index: number): string {
  if (media.title) {
    const slugged = slugify(media.title);
    if (slugged) return slugged;
  }
  const type = media.mediaType === "image" ? "image" : "video";
  return `${lessonSlug}-${type}-${index}`;
}
```

### Step 15: Material Slide Builders

Add to `src/lib/slides/slide-builder.ts`:

```typescript
export function buildTextSlide(text: TextContent): string {
  const content = `<div style="font-size: 1.5rem; line-height: 1.6;">${text.body}</div>`;
  return wrapInLayout("Text Content", content);
}

export function buildImageSlide(media: MediaAsset): string {
  const alt = escapeHtml(media.altText ?? "");
  const content = `<img src="${escapeHtml(media.sourceUrl)}" alt="${alt}" style="max-width: 100%; max-height: 900px; object-fit: contain;" />`;
  return wrapInLayout(media.altText ?? "Image", content);
}

export function buildVideoSlide(media: MediaAsset): string {
  const content = `<video src="${escapeHtml(media.sourceUrl)}" controls style="max-width: 100%; max-height: 900px;"></video>`;
  return wrapInLayout(media.altText ?? "Video", content);
}
```

**Checkpoint**: Full slide set generated — intro, curriculum, and all course materials.

---

## Part 5: User Story 4 — API Endpoint (P2)

### Step 16: Contract Tests (write FIRST — TDD)

Create `tests/contract/slides-api.contract.spec.ts`:
- POST /api/slides returns 200 with slide count on success
- Returns 401 for unauthenticated requests
- Returns 403 for non-admin users
- Returns 409 when generation already in progress

### Step 17: Generator Orchestrator Tests (write FIRST — TDD)

Create `tests/unit/slide-generator.spec.ts`:
- Calls course resolver, generates intro, curriculum, and material slides
- Clears output dir before generation
- Returns correct slide count
- Edge case: course with no lessons → only intro slide, warning logged

### Step 18: Generator Orchestrator

Create `src/lib/slides/generator.ts`:

```typescript
export class SlideGenerator {
  constructor(private readonly options: SlideGeneratorOptions) {}

  async generate(): Promise<SlideGenerationResult> {
    const slides: GeneratedSlide[] = [];

    // 1. Resolve next course
    const seminar = await getNextCourse(this.client);

    // 2. Clear and prepare course-specific output directory
    const courseOutputDir = path.join(this.outputDir, seminar.sourceId);
    await this.clearDir(courseOutputDir);

    // 3. Global sequence counter (FR-004b) — shared across all slide types
    let globalSeq = 1;

    // 4. Generate intro slide
    const introFilename = `${String(globalSeq++).padStart(3, "0")}_intro.html`;
    const introHtml = buildIntroSlide(seminar);
    await this.writeSlide(courseOutputDir, introFilename, introHtml);
    slides.push({ filename: introFilename, type: "intro", title: seminar.title });

    // 5. Fetch lessons, filter by seminarId, sort by sequence (Step 11)
    const allLessons = await this.client.get("/lessons", LessonsResponseSchema);
    const courseLessons = allLessons
      .filter((l) => l.seminarId === seminar.sourceId)
      .sort((a, b) => a.sequence - b.sequence);

    // 6. Generate curriculum slides — {NN}_{slugifiedTitleOrFallback}.html (FR-003)
    for (const [lessonIdx, lesson] of courseLessons.entries()) {
      const titleSlug = slugify(lesson.title) || `lesson-${String(lessonIdx + 1).padStart(2, "0")}`;
      const curriculumHtml = buildCurriculumSlide(lesson);
      const filename = `${String(globalSeq++).padStart(3, "0")}_${titleSlug}.html`;
      await this.writeSlide(courseOutputDir, filename, curriculumHtml);
      slides.push({ filename, type: "curriculum", title: lesson.title });
    }

    // 7. Fetch texts + media, generate material slides — {NN}_{descriptor}.html (FR-004a)
    const allTexts = await this.client.get("/texts", TextContentsResponseSchema);
    const allMedia = await this.client.get("/media", MediaAssetsResponseSchema);

    for (const [lessonIdx, lesson] of courseLessons.entries()) {
      const lessonSlug = slugify(lesson.title) || `lesson-${String(lessonIdx + 1).padStart(2, "0")}`;

      const lessonTexts = allTexts.filter(
        (t) => t.entityRef.type === "lesson" && t.entityRef.id === lesson.sourceId
      );
      const lessonMedia = allMedia.filter(
        (m) => m.entityRef.type === "lesson" && m.entityRef.id === lesson.sourceId
      );

      let textIdx = 1;
      for (const text of lessonTexts) {
        const html = buildTextSlide(text);
        const descriptor = `${lessonSlug}-text-${textIdx}`;
        const filename = `${String(globalSeq++).padStart(3, "0")}_${descriptor}.html`;
        await this.writeSlide(courseOutputDir, filename, html);
        slides.push({ filename, type: "material", title: "Text Content" });
        textIdx++;
      }
      // Independent per-type counters (FR-004a: each type resets to 1 per lesson)
      let imageIdx = 1;
      let videoIdx = 1;
      for (const media of lessonMedia) {
        const html = media.mediaType === "image" ? buildImageSlide(media) : buildVideoSlide(media);
        const idx = media.mediaType === "image" ? imageIdx++ : videoIdx++;
        const descriptor = this.buildMediaDescriptor(media, lessonSlug, idx);
        const filename = `${String(globalSeq++).padStart(3, "0")}_${descriptor}.html`;
        await this.writeSlide(courseOutputDir, filename, html);
        slides.push({ filename, type: "material", title: media.altText ?? media.mediaType });
      }
    }

    return {
      slidesGenerated: slides.length,
      courseTitle: seminar.title,
      courseId: seminar.sourceId,
      slides,
    };
  }
}
```

### Step 19: API Route

Create `src/app/api/slides/route.ts`:

```typescript
let isGenerating = false;

export async function POST(req: NextRequest) {
  // 1. requireAdmin() auth check
  const authResult = requireAdmin((req as any).auth ?? null);
  if (authResult.status !== 200) {
    return NextResponse.json(authResult.body, { status: authResult.status });
  }

  // 2. Mutex: reject concurrent generation → 409
  if (isGenerating) {
    return NextResponse.json(
      { error: "SLIDES_ALREADY_RUNNING", message: "Slide generation is already in progress" },
      { status: 409 }
    );
  }

  isGenerating = true;
  try {
    const cfg = loadConfig();
    const client = createHemeraClient();
    const generator = new SlideGenerator({ client, outputDir: cfg.SLIDES_OUTPUT_DIR });
    const result = await generator.generate();

    return NextResponse.json({
      status: "success",
      slidesGenerated: result.slidesGenerated,
      courseTitle: result.courseTitle,
      courseId: result.courseId,
    }, { status: 200 });
  } catch (err) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      route: "/api/slides",
      method: "POST",
      additionalData: { feature: "slide-generation" },
    });
    return NextResponse.json(
      { status: "failed", error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  } finally {
    isGenerating = false;
  }
}
```

**Checkpoint**: Slide generation fully operational via API endpoint.

---

## Part 6: Polish

### Step 20: JSDoc Documentation

Add JSDoc to all public functions in `src/lib/slides/`:
- `getNextCourse()`, `buildIntroSlide()`, `buildCurriculumSlide()`, `buildTextSlide()`, `buildImageSlide()`, `buildVideoSlide()`, `wrapInLayout()`, `SlideGenerator.generate()`

### Step 21: Rollbar Error Logging

Integrate `reportError()` from `src/lib/monitoring/rollbar-official.ts` into the slides API route for error reporting.

### Step 22: Biome Check

Run Biome formatting and linting check across all new files.

### Step 23: Update Spec Status

Update `specs/002-course-slides/spec.md` status from Draft to Complete.

---

## Data Flow

```
1. POST /api/slides → authenticate (Clerk admin) → check mutex
2. GET /seminars → filter for future start dates → pick nearest
3. Seminar data → generate output/slides/{courseId}/01_intro.html
4. GET /lessons → filter by seminarId → sort by sequence
5. Per lesson → generate output/slides/{courseId}/02_curriculum_{n}.html
6. Per lesson:
   a. GET /texts → filter by entityRef (type=lesson, id=lessonSourceId)
   b. GET /media → filter by entityRef (type=lesson, id=lessonSourceId)
   c. Per material → generate output/slides/{courseId}/03_material_{seq}_{idx}.html
7. Return { status: "success", slidesGenerated, courseTitle, courseId }
```

## Output File Structure

```
output/
  slides/
    {courseId}/
      01_intro.html
      02_curriculum_1.html
      02_curriculum_2.html
      02_curriculum_3.html
      03_material_1_1.html
      03_material_1_2.html
      03_material_2_1.html
      ...
```

---

## Troubleshooting

### "No upcoming course found"

**Solution**: The Hemera API contains no seminars with a future start date. Verify seminar data in hemera.academy.

### Slides not appearing in output directory

**Solution**: Check `SLIDES_OUTPUT_DIR` in `.env.local`. Default is `output/slides`. Slides are written to a subdirectory named after the course `sourceId`.

### 409 "Slide generation already in progress"

**Solution**: A previous generation is still running. The mutex is released in the `finally` block, so it should auto-resolve. If stuck, restart the server.

### Date formatting incorrect

**Solution**: `Intl.DateTimeFormat("de-CH")` requires a Node.js build with full ICU data. Verify with: `node -e "console.log(new Intl.DateTimeFormat('de-CH', {month:'long'}).format(new Date()))"`.

---

## Implementation Status

| Phase | User Story | Status |
|-------|-----------|--------|
| 1 — Setup | Types, layout | ✅ Complete |
| 2 — US1 | Intro slide (P1 MVP) | ✅ Complete |
| 3 — US2 | Curriculum slides (P1 MVP) | ✅ Complete |
| 4 — US3 | Material slides (P2) | ✅ Complete |
| 5 — US4 | API endpoint (P2) | ✅ Complete |
| 6 — Polish | JSDoc, Rollbar, Biome | ✅ Complete |
