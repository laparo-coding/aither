# Research: 006 — Participant Slides

**Date**: 2026-02-27 | **Spec**: `specs/006-participant-slides/spec.md`

## R1: Template Engine Design — `{}` Syntax vs Alternatives

### Decision: Custom lightweight regex-based engine with `{}`-syntax

### Rationale
- The existing `populateTemplate()` in `lib/html/populator.ts` uses **Handlebars** (`{{}}` syntax) for data-sync HTML output. Using the same library for slide templates would create ambiguity when both systems process the same HTML.
- The slide template engine requires **two distinct behaviors** that Handlebars doesn't natively support:
  1. **Section-based iteration** (Mode A): Iterate `<section class="slide">` blocks per collection record.
  2. **Instance-based distribution** (Mode B): Distribute collection records across multiple curriculum-linked instances of the same template.
- A simple regex (`/{([a-zA-Z][a-zA-Z0-9]*(?::[a-zA-Z][a-zA-Z0-9]*)?)}/g`) covers all required placeholder patterns.
- No external dependency needed — pure TypeScript string manipulation.

### Alternatives Considered
1. **Handlebars with different delimiters**: Handlebars doesn't support Mode A section extraction or Mode B distribution natively. Would require custom helpers that replicate 90% of the engine logic anyway.
2. **Mustache/EJS**: Same delimiter collision risk. Adds dependency for minimal benefit.
3. **Tagged template literals**: TypeScript-native but doesn't process HTML strings from external sources.

---

## R2: Section Parser — Regex vs DOM Parser

### Decision: Regex-based `<section class="slide">` extraction

### Rationale
- Slide templates are well-structured HTML documents authored in the hemera admin. The `<section class="slide">` pattern is controlled and consistent.
- A regex approach (`/<section\s+class="slide">([\s\S]*?)<\/section>/g`) is sufficient for the defined use case.
- Adding a DOM parser dependency (e.g., `cheerio`, `jsdom`) would violate the lightweight principle and add ~2MB to the bundle for a single regex-solvable task.
- The spec explicitly excludes nested sections (`<section class="slide">` inside another section) — no tree traversal needed.

### Alternatives Considered
1. **cheerio**: Full jQuery-like DOM parsing. Overkill for extracting top-level sections from known HTML structure. Adds significant dependency.
2. **jsdom**: Complete DOM implementation. Even heavier. No benefit for this use case.
3. **node-html-parser**: Lighter than jsdom but still unnecessary given the constrained HTML structure.

### Edge Case Handling
- Sections with additional attributes (`<section class="slide" data-topic="1">`) — regex captures `class="slide"` with optional other attrs.
- Whitespace variations — regex uses `\s+` for flexible matching.
- Empty sections — extracted and treated as static (no placeholders, 1 slide output).

---

## R3: Mode Detection Strategy

### Decision: Three-step detection based on HTML structure + identifier grouping + placeholder analysis

### Rationale
The mode detection follows the decision tree from the spec:

1. **Check for `<section class="slide">` tags** → if present, Mode A.
2. **Check if same `materialId` appears multiple times in curriculum links** → if yes and collection placeholders exist, Mode B.
3. **Otherwise** → treat entire body as implicit section (Mode A fallback) or scalar-only.

This is a pure function with no side effects — easily testable and deterministic.

### Detection Function Signature
```typescript
function detectMode(
  htmlContent: string,
  curriculumLinkCount: number,
  hasCollectionPlaceholders: boolean
): 'section-iteration' | 'identifier-distribution' | 'scalar-only'
```

### Decision Table

| `<section>` tags | Link count > 1 | Collection placeholders | Result |
|---|---|---|---|
| Yes | Any | Any | `section-iteration` (Mode A) |
| No | Yes | Yes | `identifier-distribution` (Mode B) |
| No | Yes | No | `scalar-only` |
| No | No | Yes | `section-iteration` (implicit section) |
| No | No | No | `scalar-only` |

---

## R4: Materials API Response Schema for Aither

### Decision: New Zod schema `ServiceMaterialsResponseSchema` in `src/lib/hemera/schemas.ts`

### Rationale
The hemera `GET /api/service/courses/{id}/materials` endpoint returns:
```json
{
  "success": true,
  "data": {
    "courseId": "clxyz...",
    "topics": [
      {
        "topicId": "topic-uuid",
        "topicTitle": "Videoanalyse",
        "materials": [
          {
            "materialId": "clxyz...",
            "identifier": "video-analysis",
            "title": "Video Analysis Worksheet",
            "sortOrder": 1,
            "htmlContent": "<div>...</div>"
          }
        ]
      }
    ]
  },
  "meta": { "requestId": "...", "timestamp": "...", "version": "..." }
}
```

Key observations for Mode B detection:
- The same `materialId` + `identifier` can appear in **multiple topics** (same template linked N times in curriculum).
- To detect Mode B, Aither must group the flat topic→material list by `materialId` and count occurrences.
- `htmlContent` can be `null` if blob fetch failed — skip gracefully.

### Schema Design
```typescript
const ServiceMaterialSchema = z.object({
  materialId: z.string(),
  identifier: z.string(),
  title: z.string(),
  sortOrder: z.number(),
  htmlContent: z.string().nullable(),
});

const ServiceMaterialTopicSchema = z.object({
  topicId: z.string(),
  topicTitle: z.string(),
  materials: z.array(ServiceMaterialSchema),
});

const ServiceMaterialsResponseSchema = z.object({
  success: z.boolean(),
  data: z.object({
    courseId: z.string(),
    topics: z.array(ServiceMaterialTopicSchema),
  }),
  meta: z.object({
    requestId: z.string().optional(),
    timestamp: z.string().optional(),
    version: z.string().optional(),
  }).optional(),
});
```

---

## R5: Identifier-Group Detection from API Response

### Decision: Group materials by `materialId` across all topics, count occurrences

### Rationale
The materials API returns data grouped by `topicId`. For Mode B, we need to detect when the **same `materialId`** appears across multiple topic groups (same template linked N times in curriculum).

Algorithm:
1. Flatten all materials from all topics.
2. Group by `materialId` → `Map<string, { identifier: string, htmlContent: string, count: number }>`.
3. Any `materialId` with `count > 1` is a potential Mode B candidate.
4. Verify: template has collection placeholders AND no `<section>` tags → Mode B confirmed.

### Key Insight
The `CurriculumTopicMaterial` join table in hemera links materials to topics. When the same material is linked to N different topic slots, it appears N times in the response. The `identifier` field on the material is the same for all N occurrences (since they reference the same `CourseMaterial` record).

---

## R6: Rollbar Error Logging Pattern

### Decision: Use existing `serverInstance` from `@/lib/monitoring/rollbar-official`

### Rationale
Aither already has Rollbar integration via `src/lib/monitoring/rollbar-official.ts`. The `serverInstance` provides:
- `serverInstance.error(message, error, context)` for errors
- `serverInstance.info(message, context)` for structured events

For the `slides.generated` structured event:
```typescript
serverInstance.info('slides.generated', {
  courseId,
  totalSlides,
  materialSlides,
  skippedSections,
  modeACount,
  modeBCount,
  durationMs,
  errors,
});
```

For Materials-API errors:
```typescript
serverInstance.error('slides.materials.fetchError', error, {
  courseId,
  endpoint: `/api/service/courses/${courseId}/materials`,
});
```

### Alternatives Considered
- **console.log**: Violates Constitution Principle VI (mandatory Rollbar).
- **Custom logger**: Unnecessary abstraction over existing Rollbar setup.

---

## R7: Clean + Regenerate Strategy

### Decision: `fs.rm(dir, { recursive: true, force: true })` before each generation run

### Rationale
The existing `SlideGenerator.clearDir()` method already implements this pattern:
```typescript
private async clearDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}
```
This is called at the start of `generate()` with the course-specific output directory. No changes needed to the cleanup strategy — just ensure it runs before the new template-based generation begins.

---

## R8: File Naming Convention

### Decision: Dual naming scheme based on mode

### Rationale

**Mode A** (unified naming):
- `{NN}_{identifier}[_{firstName}].html`
- Example: `005_preparation-sheet_anna.html` (sequence 5, identifier, participant)
- Global sequence number ensures unique sort order across all slide types

**Mode B** (unified naming):
- `{NN}_{identifier}_{firstName}.html`
- Example: `006_video-analysis_anna.html`, `007_video-analysis_ben.html`
- Same format as Mode A — global sequence replaces old `{identifier}-{nn}` pattern

### Consideration
All slides (intro, curriculum, material) now share the same `{NN}_{identifier}[_{firstName}].html` convention.

**`{NN}` padding rule**: `{NN}` is a zero-padded three-digit decimal (`000`–`999`), supporting up to 1000 slides per generation run. Implementations MUST use `String(n).padStart(3, '0')`. Example: slide 5 → `005`, slide 42 → `042`.

The `{identifier}` portion is slugified (lowercase, diacritics stripped, non-alphanumeric → hyphens). In participant-specific slides (Mode A with collection data, Mode B), `_{firstName}` is always appended. In non-participant slides (intro, curriculum, scalar-only), `_{firstName}` is omitted. Alphabetical sort by filename equals presentation order.

**`{firstName}` normalization rules** (`normalizeFirstName`): When `_{firstName}` is appended, the raw first name MUST be normalized as follows:
1. Apply Unicode NFKD decomposition and strip combining diacritical marks from accented characters.
2. Map locale-specific sharp-s characters to `ss`.
3. Transliterate remaining non-Latin characters to ASCII where possible. Characters that cannot be transliterated to `[A-Za-z0-9 ]` after this step are **dropped** (not replaced with a placeholder).
4. Convert to lowercase.
5. Replace any remaining non-alphanumeric characters and whitespace with a single hyphen (`-`).
6. Collapse consecutive hyphens into one and trim leading/trailing hyphens.
7. Truncate to a maximum of **20 characters** (`MAX_FIRST_NAME_LENGTH = 20`). First, attempt to cut at the last word boundary (hyphen or whitespace) within the first 20 characters. If no word boundary exists, hard-truncate at exactly 20 characters. Trim any trailing hyphen after truncation.
8. **Empty-result fallback**: If the normalized result is an empty string after all preceding steps (e.g., a name consisting entirely of non-transliterable characters), use the deterministic fallback `FALLBACK_FIRST_NAME = "unnamed"`. Collision handling (step 9) applies to the fallback as well.
9. **Collision handling**: If the resulting normalized filename already exists in the output directory, append a numeric suffix `_1`, `_2`, etc. directly after the `{firstName}` portion and before the file extension — format: `{NN}_{identifier}_{firstName}{_n}.html` (e.g., `005_preparation-sheet_anna_1.html`). Check sequentially (`_1`, `_2`, …) until a unique filename is found.

Example: an accented first name such as `Anna-Maria` normalizes to `anna-maria`, and a compound surname such as `Miller Street` normalizes to `miller-street`.

---

## R9: HTML Escaping Strategy

### Decision: Extract shared `escapeHtml()` utility to `src/lib/slides/utils.ts`

### Rationale
The `escapeHtml()` function in `src/lib/slides/html-layout.ts` already handles the standard XSS escaping:
```typescript
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
```

However, it's currently a private function in `html-layout.ts`. Options:
1. **Extract to shared utility** — export from `html-layout.ts` or a new `utils.ts` in `slides/`.
2. **Duplicate** — copy to `template-engine.ts`.

Decision: **Extract to shared utility** (`src/lib/slides/utils.ts`) to avoid duplication. The `html-layout.ts` and `slide-builder.ts` modules also have their own private copies — consolidate all three.

---

## R10: Integration with Existing Generator Pipeline

### Decision: Extend `SlideGenerator.generate()` with a new step between curriculum and material generation

### Rationale
The current pipeline in `generator.ts`:
1. Resolve next course
2. Clear output directory
3. Generate intro slide
4. Fetch lessons → curriculum slides
5. Fetch texts/media → material slides

The new pipeline:
1. Resolve next course **with participants** (new `getNextCourseWithParticipants()`)
2. Clear output directory (existing)
3. Generate intro slide (existing)
4. Fetch lessons → curriculum slides (existing)
5. **NEW**: Fetch materials from Service API → template-based material slides
6. Fetch texts/media → legacy material slides (existing, kept for backward compatibility)
7. **NEW**: Emit `slides.generated` structured event

Step 5 operates alongside step 6. In phase 1, step 6 remains for non-template materials. The template engine processes materials that come from the hemera materials endpoint (HTML from Vercel Blob), while step 6 processes raw text/media assets from the legacy API.

### Error Isolation
Step 5 (materials API) failures do NOT block steps 3, 4, or 6. The `try/catch` wraps only the materials fetch and template processing.
