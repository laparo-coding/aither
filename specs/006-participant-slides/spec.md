# 006 — Participant Slides

## Overview

Extension of the existing slide pipeline (`src/lib/slides/`) with a **template engine supporting placeholder variables**. The engine supports **two replacement modes**:

- **Mode A — Section Iteration**: An HTML page contains `<section class="slide">` blocks. Each section is an independent slide template. Collection placeholders (e.g., `{participant:name}`) trigger iteration: with 6 participants, one section produces 6 slides.
- **Mode B — Identifier Distribution**: A template (e.g., `video-analysis`) is **linked multiple times** in the curriculum (via `CurriculumTopicMaterial`). The number of links = number of participants (1:1). Each instance is assigned one participant sequentially — Instance 1 → Participant A, Instance 2 → Participant B, etc. Output: `{NN}_video-analysis_{firstName}.html` (e.g., `005_video-analysis_anna.html`, `006_video-analysis_ben.html`).

Participant data (name, preparation intent, desired results, line manager profile) is loaded from the hemera Service API. The existing Handlebars-based `populateTemplate()` in `lib/html/populator.ts` uses `{{}}` for data-sync output — the slide pipeline gets its own **lightweight template engine** with `{}`-syntax that natively supports both section-based iteration and identifier-based distribution.

## Clarifications

### Session 2026-02-24

- Q: What should be used as the grouping key for material distribution (slug, topicId, identifier-prefix)? → A: **topicId** — all materials of the same curriculum topic form a group (natural mechanism via the `CurriculumTopicMaterial` join table in hemera). *(Partially superseded: Mode B uses `identifier`-based grouping instead of topicId — see Session 2026-02-27 and US6.)*
- Q: How should the slide pipeline access material data (HTML body + topic assignment)? → A: **New dedicated endpoint** `GET /api/service/courses/{id}/materials` in hemera. Returns materials incl. HTML content grouped by topic. Implemented in `hemera/app/api/service/courses/[id]/materials/route.ts`.

### Session 2026-02-27

- Q: How should collection multiplication work — at page level or section level? → A: **Two modes**. **Mode A (Section Iteration)**: `<section class="slide">` blocks in an HTML page serve as template units. The parser extracts sections, recognizes collection placeholders, and iterates over the collection — each iteration produces a new slide. **Mode B (Identifier Distribution)**: A template is linked multiple times in the curriculum (via `CurriculumTopicMaterial`). Each instance is assigned one participant sequentially (Instance 1 → Record 1, Instance 2 → Record 2). *(Originally described as "Slug Distribution", updated to identifier-based approach after later clarification.)*
- Q: How should the pipeline react to Materials API errors (abort, skip, retry)? → A: **Skip + Log** — skip material slides, generate intro/curriculum slides normally, log error via Rollbar.
- Q: What information should the slide generation output via structured log? → A: **`slides.generated`** event with: `courseId`, `totalSlides`, `materialSlides`, `skippedSections`, `modeACount`, `modeBCount`, `durationMs`, `errors` — analogous to `sync.completed` from 005.
- Q: What should happen during re-generation with existing files in `output/slides/{courseId}/`? → A: **Clean + Regenerate** — delete all existing slides in the course folder before each generation, then regenerate completely. Prevents orphaned slides when participant count changes.
- Q: How should material grouping work for Mode B — topicId, identifier prefix, or dedicated slug field? → A: **Identifier via curriculum links**. A template (e.g., `video-analysis`) is linked multiple times in the curriculum (via `CurriculumTopicMaterial`). The number of links always equals the participant count (1:1). All instances with the same `identifier` form a group. Each instance is assigned one participant sequentially. Output: `{NN}_video-analysis_{firstName}.html` (e.g., `005_video-analysis_anna.html`, `006_video-analysis_ben.html`).

## Two Replacement Modes

The template engine supports two distinct modes for replacing collection placeholders. Mode detection is **automatic** based on the HTML structure and topic grouping:

### Mode A — Section Iteration

**Trigger**: The HTML page contains `<section class="slide">` tags.

Each `<section class="slide">` block is an independent slide template. When a section contains collection placeholders (e.g., `{participant:name}`), the parser iterates over all records in the collection and produces **one slide per record**.

- **One page** with 1 collection section + 6 participants → **6 slides**
- A page can mix static sections, scalar sections, and collection sections
- Sections are processed independently within the same page

### Mode B — Identifier Distribution

**Trigger**: A `CourseMaterial` template (identified by its `identifier`, for example `video-analysis`) is linked **multiple times** in the curriculum via `CurriculumTopicMaterial`, AND the template contains collection placeholders, AND does **not** contain `<section class="slide">` tags.

The number of curriculum links for the same material always equals the number of participants (1:1). Each link instance receives one participant's data sequentially:

- Instance 1 → Participant A (all `{participant:*}` replaced with Participant A's data)
- Instance 2 → Participant B
- Instance 3 → Participant C
- ...

Output files are named with a global sequence number, the identifier, and the participant's first name: `{NN}_{identifier}_{firstName}.html` (e.g., `005_video-analysis_anna.html`, `006_video-analysis_ben.html`).

### Mode Detection Logic

**Priority**: Conditions are evaluated top-to-bottom. The first matching row determines the mode.

| # | Condition | Mode | Behavior |
|---|---|---|---|
| 1 | Template has `<section class="slide">` tags (regardless of placeholder types) | **Mode A** | Section-based iteration within the page. Sections with collections → N slides; sections without → 1 slide each. |
| 2 | Same `identifier` linked multiple times in curriculum, no `<section>` tags, collection placeholders present | **Mode B** | One template instanced per participant, sequential distribution |
| 3 | Single-linked template, no `<section>` tags, collection placeholders present | **Mode A (implicit)** | Entire body treated as one implicit section, iterated per record |
| 4 | No collection placeholders (with or without `<section>` tags) | **scalar-only** | Scalar replacement only (1 slide per page/section) |

**Note**: Row 1 takes precedence over Row 4. A template with `<section>` tags and only scalar placeholders is still `section-iteration` — each section simply produces 1 slide.

**Note**: Mode B grouping uses `CourseMaterial.identifier` (Kennung). When the materials endpoint returns multiple `CurriculumTopicMaterial` links pointing to the same `materialId`, these form an identifier group. The link count always equals participant count (1:1).

## Course Materials with Placeholders

A course material HTML page either contains `<section class="slide">` blocks (Mode A) or is processed as a whole (Mode B, when the same material is linked multiple times in the curriculum via `identifier`). The parser automatically detects the appropriate mode.

### Processing Flow

1. **Fetching**: The slide pipeline loads a course's HTML materials via `GET /api/service/courses/{id}/materials` (hemera Service API, returns HTML content grouped by topic)
2. **Identifier Grouping**: Materials are grouped by `identifier` — materials whose `materialId` is linked multiple times via `CurriculumTopicMaterial` form an identifier group
3. **Mode Detection**: The replacement mode is determined for each material:
   - Template contains `<section class="slide">` → **Mode A** (Section Iteration)
   - Identifier group has N > 1 curriculum links + collection placeholders → **Mode B** (Identifier Distribution, N = participant count)
   - Single-linked template without `<section>` → Implicit section (fallback to Mode A)
4. **Parsing**: Templates are scanned for `{}`-placeholders
5. **Classification**: Each found placeholder is classified as scalar (`{courseTitle}`) or collection (`{participant:name}`)
6. **Data Resolution**: Required data is loaded from the `SlideContext` (course metadata + participant data via Service API)
7. **Processing**:
   - **Mode A — Section Iteration**: Each `<section class="slide">` is processed independently. Sections with collection placeholders produce N slides (one per record).
   - **Mode B — Identifier Distribution**: The same template is instantiated N times (N = number of curriculum links = number of participants). Each instance is assigned one participant sequentially (Instance 1 → Participant 1, Instance 2 → Participant 2, ...). Number of links = number of participants (1:1, always identical).
   - **Without collection placeholders**: 1 slide per section/page — scalar replacement only
8. **Output**: Each generated slide is wrapped in the 1920×1080 HTML format via `wrapInLayout()` and written as a file

### Example: Material Page without Placeholders

```html
<section class="slide">
  <h2>Negotiation Fundamentals</h2>
  <p>In this module you will learn the most important principles...</p>
</section>
```

→ **1 slide**, output unchanged (backward compatibility).

### Example: Material Page with Scalar Placeholders

```html
<section class="slide">
  <h1>Welcome to the course: {courseTitle}</h1>
  <p>Level: {courseLevel} | Participants: {participantCount}</p>
</section>
```

→ **1 slide**, placeholders replaced with course data.

### Example: Material Page with Collection Placeholders (Iteration)

```html
<section class="slide">
  <h1>{participant:name}</h1>
  <p>Intent: {participant:preparationIntent}</p>
  <p>Goal: {participant:desiredResults}</p>
  <p>Line manager profile: {participant:lineManagerProfile}</p>
</section>
```

With 6 participants → **6 slides**. The parser recognizes the object type `participant`, iterates over all 6 records, and produces one slide per iteration with individual data.

### Example: Material Page with Mixed Sections

```html
<section class="slide">
  <h1>{courseTitle}</h1>
  <p>Course overview with {participantCount} participants</p>
</section>

<section class="slide">
  <h2>{participant:name}</h2>
  <p>Preparation: {participant:preparationIntent}</p>
  <p>Goal: {participant:desiredResults}</p>
</section>

<section class="slide">
  <h2>Agenda</h2>
  <p>Next steps after the seminar</p>
</section>
```

Result with 3 participants → **5 slides**:
1. Course overview (scalar section → 1 slide)
2. Participant Anna Miller (collection section, iteration 1)
3. Participant Ben Fisher (collection section, iteration 2)
4. Participant Clara Hoffman (collection section, iteration 3)
5. Agenda (static section → 1 slide)

### Example: Mode B — Identifier Distribution (1 Template, 3 Curriculum Links, 3 Participants)

The template `video-analysis` (a single `CourseMaterial` record) is linked **3 times** in the curriculum (via `CurriculumTopicMaterial`). It contains collection placeholders but no `<section class="slide">` tags:

**Template** (`video-analysis`):
```html
<div class="analysis-sheet">
  <h1>Video analysis: {participant:name}</h1>
  <p>Intent: {participant:preparationIntent}</p>
  <p>Goal: {participant:desiredResults}</p>
</div>
```

3 participants (Anna Miller, Ben Fisher, Clara Hoffman) →

- Instance 1 → Anna Miller's data → `005_video-analysis_anna.html`
- Instance 2 → Ben Fisher's data → `006_video-analysis_ben.html`
- Instance 3 → Clara Hoffman's data → `007_video-analysis_clara.html`

→ **3 slides**, each with the same layout but different participant data.

### Example: Mode B — Mixed Usage in Curriculum

The template `video-analysis` is linked 4 times (4 participants), the template `feedback-sheet` is also linked 4 times. Both templates contain `{participant:*}` placeholders.

Result:
- `{NN}_video-analysis_{firstName}.html` (e.g., `005_video-analysis_alice.html` through `008_video-analysis_diana.html`, one participant each)
- `{NN}_feedback-sheet_{firstName}.html` (e.g., `009_feedback-sheet_alice.html` through `012_feedback-sheet_diana.html`, one participant each)

→ **8 slides** total from 2 templates × 4 participants.

## Motivation

As a course instructor, I want slides before the seminar that are automatically populated with participant data — without having to manually create a slide for each participant. The engine supports two modes: (1) HTML templates with `<section class="slide">` blocks where the system automatically repeats sections per participant, and (2) templates that are linked multiple times in the curriculum (via identifier), where each instance automatically receives a different participant.

## Placeholder Syntax

### Simple Placeholders (Scalar)

Replaced directly with the corresponding value. Produce **one** slide.

```text
{courseTitle}          → "Mastering Salary Negotiation"
{courseLevel}          → "ADVANCED"
{courseStartDate}      → "2026-03-15T09:00:00Z"
{participantCount}    → "6"
```

### Object Placeholders (Collection)

Recognized by the `:` separator. The part before the colon is the **object type** (collection), the part after is the **field**. A section with object placeholders is **repeated for each entity in the collection** — the parser reads the first object type and iterates over all records.

```text
{participant:name}              → "Anna Miller"
{participant:preparationIntent} → "I want to appear more confident"
{participant:desiredResults}    → "A 15% salary increase"
{participant:lineManagerProfile}→ "Rather reserved, data-driven"
```

**Example:** A `<section class="slide">` template contains:

```html
<section class="slide">
  <h1>{participant:name}</h1>
  <p>Intent: {participant:preparationIntent}</p>
  <p>Goal: {participant:desiredResults}</p>
</section>
```

With 6 booked participants, the parser produces **6 slides** — each with the respective participant's data.

### Mixing Allowed

A section may contain both simple and object placeholders:

```html
<section class="slide">
  <h1>{courseTitle} — {participant:name}</h1>
  <p>{participant:preparationIntent}</p>
</section>
```

→ 6 slides, each with the same `courseTitle` but different participant data.

### Rules

- Placeholder syntax: `{identifier}` or `{object:field}`
- **Mode A — Section as template unit**: `<section class="slide">...</section>` is the atomic unit for slide generation
- **Mode B — Identifier group as distribution unit**: A template (identified by `CourseMaterial.identifier`) is linked multiple times in the curriculum (via `CurriculumTopicMaterial`). Number of links = number of participants (1:1). Each instance is assigned one participant sequentially.
- Only **one** object type per section (Mode A) or per template (Mode B) allowed (no mixing of `{participant:name}` and `{instructor:name}` in the same unit)
- The parser reads the **first** recognized object type and iterates (Mode A) or distributes (Mode B) over its collection
- **Mode A**: A material page can contain **multiple sections** — each is processed independently
- **Mode A**: HTML content outside of `<section class="slide">` blocks is ignored
- **Mode B**: The entire template is processed as body — collection placeholders are replaced per instance with the assigned participant
- **Mode B**: Participant assignment order follows the order in the `participants` array from the Service API
- **Mode B**: The number of curriculum links is always identical to the participant count (1:1 invariant, enforced by hemera)
- Material pages without `<section class="slide">` blocks and without an identifier group: The entire body is treated as one implicit section (Mode A fallback / backward compatibility)
- Unknown placeholders remain unchanged (no error)
- Empty/null values are replaced with `—` (em-dash)
- All inserted values are HTML-escaped (XSS protection)

## Available Data Contexts

### Scalar Data (Course)

| Placeholder | Source | Type |
|---|---|---|
| `{courseTitle}` | `ServiceCourseDetail.title` | string |
| `{courseSlug}` | `ServiceCourseDetail.slug` | string |
| `{courseLevel}` | `ServiceCourseDetail.level` | string |
| `{courseStartDate}` | `ServiceCourseDetail.startDate` | string \| null |
| `{courseEndDate}` | `ServiceCourseDetail.endDate` | string \| null |
| `{participantCount}` | `String(ServiceCourseDetail.participants.length)` | string |

### Collection Data (Participants)

| Placeholder | Source | Type |
|---|---|---|
| `{participant:name}` | `ServiceParticipant.name` | string \| null |
| `{participant:status}` | `ServiceParticipant.status` | string |
| `{participant:preparationIntent}` | `ServiceParticipant.preparationIntent` | string \| null |
| `{participant:desiredResults}` | `ServiceParticipant.desiredResults` | string \| null |
| `{participant:lineManagerProfile}` | `ServiceParticipant.lineManagerProfile` | string \| null |
| `{participant:preparationCompleted}` | `preparationCompletedAt !== null ? "Ja" : "—"` | string |

## User Stories

### US1: Section Extraction and Placeholder Recognition

> As a system, I want to extract all `<section class="slide">` blocks from each HTML material and recognize `{}` placeholders within them, to distinguish between simple (scalar) and object placeholders (collection).

**Acceptance Criteria:**
- Regex/parser extracts all `<section class="slide">...</section>` blocks from an HTML string
- HTML content outside of sections is ignored
- Material without `<section class="slide">` blocks: The entire body is treated as one implicit section
- Within each section: Regex extracts all `{...}` tokens
- Tokens with `:` are classified as object placeholders (e.g., `{participant:name}` → object `participant`, field `name`)
- Tokens without `:` are classified as scalar placeholders (e.g., `{courseTitle}`)
- Result per section: `{ body: string, scalars: string[], collections: Map<string, string[]> }`
- Placeholders inside HTML attributes are also recognized
- Duplicate placeholders are deduplicated

### US2: Scalar Placeholder Replacement

> As a system, I want to replace simple placeholders in an HTML string with the corresponding values from a data context.

**Acceptance Criteria:**
- `{courseTitle}` is replaced with the value of `context.courseTitle`
- Null/undefined values are replaced with `—`
- All inserted values are HTML-escaped
- Unknown placeholders (not in context) remain unchanged
- Multiple occurrences of the same placeholder are all replaced

### US3: Section-Based Collection Iteration

> As a system, I want to iterate over the collection for sections with object placeholders and produce one new slide per record, with all placeholders in each copy replaced by the respective data.

**Acceptance Criteria:**
- A section with `{participant:name}` and 6 participants yields 6 HTML strings
- The parser reads the first object type (e.g., `participant`) and iterates over its collection
- Each HTML string has all `{participant:*}` placeholders replaced with the respective participant's data
- Scalar placeholders in the same section are replaced identically in each iteration
- With 0 entities in the collection, no slide is generated from this section (empty array)
- Filename includes the global sequence and participant's first name: `{NN}_{identifier}_{firstName}.html` (e.g., `005_preparation-sheet_anna.html`)

### US4: Integration into the Generator Pipeline

> As a system, I want the `SlideGenerator` to automatically detect the correct replacement mode (Mode A or Mode B) and process material slides accordingly.

**Acceptance Criteria:**
- `SlideGenerator.generate()` detects the mode per material (section structure + identifier grouping)
- **Mode A**: Extracts `<section class="slide">` blocks, processes each section independently (scalar/collection)
- **Mode B**: Detects identifier groups with N > 1 curriculum links of the same template + collection placeholders → identifier distribution
- Sections without placeholders are output as 1 slide (backward compatibility)
- Sections with only scalar placeholders → 1 slide with replaced values
- Sections with collection placeholders → N slides (Mode A: iteration, Mode B: distribution)
- Material without `<section class="slide">` blocks and without an identifier group is treated as one implicit section
- `SlideType` remains `"material"` for template-generated slides
- `SlideGenerationResult` contains all generated slides in the `slides` list
- On Materials API error: Material slides are skipped, intro/curriculum generated normally, error logged via Rollbar
- Before each generation, `output/slides/{courseId}/` is completely deleted (clean + regenerate) to avoid orphaned slides

### US5: Course Resolver for Service API

> As a system, I need a way to resolve the next course with participant data via the Service API, so that the template engine has access to participant data.

**Acceptance Criteria:**
- New function `getNextCourseWithParticipants()` in `course-resolver.ts`
- Uses `/api/service/courses` (list) and `/api/service/courses/{id}` (detail with participants)
- Returns `ServiceCourseDetail` (incl. `participants` array)
- Selects the next course by `startDate` (analogous to `getNextCourse()`)
- Validates response with `ServiceCoursesResponseSchema` / `ServiceCourseDetailResponseSchema`
- Returns `null` when no upcoming course exists (empty course list or all courses in the past). The generator skips participant slide generation gracefully.

### US6: Build Data Context

> As a system, I want to build a data context from `ServiceCourseDetail` containing all available scalar and collection values for the template engine.

**Acceptance Criteria:**
- Function `buildSlideContext(courseDetail: ServiceCourseDetail): SlideContext`
- `SlideContext.scalars`: Flat object with `courseTitle`, `courseLevel`, `participantCount`, etc.
- `SlideContext.collections`: Map with `"participant"` → array of participant data objects
- Extensible: Additional collections (e.g., `"instructor"`) can easily be added

### US7: Identifier-Based Distribution (Mode B)

> As a system I want to detect when a `CourseMaterial` template (identified by its `identifier` / Kennung) is linked multiple times in the curriculum via `CurriculumTopicMaterial`, and distribute collection records sequentially across those instances — one participant per instance.

**Acceptance Criteria:**
- Function `detectMode(htmlContent: string, curriculumLinkCount: number, hasCollectionPlaceholders: boolean): 'section-iteration' | 'identifier-distribution' | 'scalar-only'`
- Mode B is triggered when: curriculum link count for the same `materialId` > 1 AND no `<section class="slide">` tags AND collection placeholders are present
- Function `distributeByIdentifier(template: string, identifier: string, collectionName: string, records: Record<string, string>[], scalars: Record<string, string>): DistributedSlide[]`
- Curriculum link count always equals participant count (1:1 invariant, enforced by hemera)
- Each instance receives one record from the collection in order (instance[0] → record[0], instance[1] → record[1], ...)
- Scalar placeholders in each instance are replaced identically (same course data)
- Each distributed instance produces exactly 1 slide
- File naming: `{NN}_{identifier}_{firstName}.html` (e.g., `005_video-analysis_anna.html`, `006_video-analysis_ben.html`)

## Data Sources

### Existing (002-course-slides)
- **Seminar API**: `/seminars`, `/lessons`, `/texts`, `/media` → Intro, Curriculum, Material slides
- **Types**: `Seminar`, `Lesson`, `TextContent`, `MediaAsset` from `lib/hemera/types.ts`

### New (005-data-sync → 006)
- **Service API**: `GET /api/service/courses` → Course list with `participantCount`
- **Service API**: `GET /api/service/courses/{id}` → Course detail with `participants[]`
- **Service API**: `GET /api/service/courses/{id}/materials` → Course materials incl. HTML content, grouped by topic. Response shape: `{ courseId, topics: [{ topicId, topicTitle, materials: [{ materialId, identifier, title, sortOrder, htmlContent }] }] }`
- **Participant fields**: `name`, `status`, `preparationIntent`, `desiredResults`, `lineManagerProfile`, `preparationCompletedAt`
- **Zod schemas**: `ServiceCourseDetailResponseSchema`, `ServiceParticipantSchema` from `lib/hemera/schemas.ts`

## Technical Constraints

- **Dual-Mode Engine**: Supports Mode A (Section Iteration) and Mode B (Identifier Distribution) — automatic detection per material
- **Section Syntax (Mode A)**: `<section class="slide">...</section>` is the template unit for slide generation
- **Identifier Groups (Mode B)**: A `CourseMaterial` template (identified by `identifier`) is linked multiple times in the curriculum. Number of links = number of participants (1:1). Each instance receives one participant sequentially.
- **Template Syntax**: `{placeholder}` and `{object:field}` — custom lightweight engine, **not** Handlebars
- **Distinction from Handlebars**: `populateTemplate()` in `lib/html/populator.ts` uses `{{}}` for sync output. The slide template engine uses `{}` and natively supports section-based iteration and identifier-based distribution. No Handlebars dependency.
- **Backward Compatibility**: Material HTML without `<section class="slide">` blocks and without an identifier group is treated as one implicit section (entire body = 1 slide)
- **Output Format**: HTML 1920×1080 via `wrapInLayout()` from `html-layout.ts`
- **Output Directory**: `output/slides/{courseId}/` (existing)
- **Styling**: CSS Custom Properties (`--primary-color`, `--text-color`, `--bg-color`) from existing layout
- **Filename Convention**: All slides use a unified naming scheme: `{NN}_{identifier}[_{firstName}].html`. A global sequence counter (`NN`) determines presentation order. `{NN}` is a zero-padded three-digit decimal (`001`–`999`), implemented as `String(n).padStart(3, '0')` (consistent with 002-course-slides FR-004b). The `identifier` is a slugified descriptor (title, material identifier, or media alt-text). For collection slides (Mode A/B), the participant's normalized first name is appended (see `normalizeFirstName` in research.md R8). Examples: `001_intro.html`, `002_introduction.html`, `005_video-analysis_anna.html`. Alphabetical sort by filename equals presentation order.
- **firstName Normalization**: The `{firstName}` portion is normalized via `normalizeFirstName()` as defined in research.md R8: Unicode NFKD decomposition → strip diacritics → map sharp-s to `ss` → ASCII transliteration → lowercase → non-alphanumeric to hyphens → collapse/trim hyphens → truncate to 20 characters (`MAX_FIRST_NAME_LENGTH = 20`). On filename collision, append `_1`, `_2`, etc. until unique.
- **No Browser Rendering**: Pure HTML files, no Puppeteer/Playwright for PDF
- **Escaping**: All inserted user data is HTML-escaped (XSS protection)
- **Materials API Errors**: On error (500, timeout, empty response) from `GET /api/service/courses/{id}/materials`, material slides are skipped. Intro and curriculum slides are generated independently. The error is logged via Rollbar (`slides.materials.fetchError`).
- **Materials API Timeout**: Uses the HemeraClient default timeout. On timeout, the materials fetch is treated as an error (skip + Rollbar log).
- **Null HTML Content**: Materials with `htmlContent: null` are skipped entirely (0 slides produced from that material). The `skippedSections` counter in `SlideGenerationEvent` is incremented.
- **Observability**: After slide generation completes, a `slides.generated` structured log event is emitted with: `courseId`, `totalSlides`, `materialSlides`, `skippedSections` (sections whose `htmlContent` was null/empty or that contained no usable blocks after parsing), `modeACount`, `modeBCount`, `durationMs`, `errors`. Format analogous to `sync.completed` from 005.
- **Re-Generation**: Before each slide generation, the entire course folder (`output/slides/{courseId}/`) is deleted and completely regenerated (clean + regenerate). Prevents orphaned slide files when participant count changes.

## Out of Scope

- PDF export of slides
- Slide preview in browser (UI feature)
- Customizable slide theming (may come in 007)
- Debriefing/results slides (preparation data only)
- Automatic slide generation on data change (trigger)
- Multiple object types in the same section (e.g., `{participant:name}` + `{instructor:name}`)
- Nested placeholders (e.g., `{participant:{fieldName}}`)
- Nested sections (`<section class="slide">` inside another section)

## Dependencies

| Dependency | Status | Details |
|---|---|---|
| 002-course-slides | ✅ Complete | Slide pipeline, `wrapInLayout()`, builder pattern |
| 005-data-sync | ✅ Complete | Service API, `ServiceParticipantSchema`, `HemeraClient` |
| hemera Service API | ✅ Operational | `GET /api/service/courses`, `GET /api/service/courses/{id}`, `GET /api/service/courses/{id}/materials` |
