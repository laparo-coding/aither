# 007 — Dashboard Design

## Overview

The dashboard is the initial page loaded when Aither starts. It applies the Hemera design system's page size settings to ensure visual coherence between both applications.

### Page Size Settings (from Hemera)

The dashboard MUST adopt the following layout constraints used by Hemera:

- **Container max-width**: MUI `Container` with `maxWidth='lg'` (resolved to `1200px` at the `lg` breakpoint via Hemera's theme override).
- **Breakpoints**: `xs: 0`, `sm: 600`, `md: 900`, `lg: 1200`, `xl: 1536` (standard MUI, matching Hemera).
- **Vertical section padding**: `py: { xs: 6, md: 10 }` (design token `spacing.sectionPy`) for standard sections; `{ xs: 4, md: 6 }` (`spacing.sectionPyCompact`) for compact sections.
- **Viewport defaults**: `max-width: 100vw` and `overflow-x: hidden` on `html, body` to prevent horizontal scroll.
- **No body-level container wrap**: Page sizing is delegated to component-level `Container` elements, not a global wrapper.

### Dashboard Composition

The dashboard is composed of four horizontal sections (A, B, C, D) stacked vertically. Each section contains side-by-side cards or lists within a responsive grid.

#### Section A — Course & Material Overview (top row)

Two cards displayed side-by-side (`gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }`):

1. **Course Information Card** (left) — A `Paper`-based card displaying the next upcoming course details:
   - Course title
   - Level (Basic / Advanced / Masterclass)
   - Start date, end date
   - Participant count
   - Data source: `ServiceCourseDetail` from Hemera API (`fetchNextCourseDetail()`)
   - **Empty state**: When `fetchNextCourseDetail()` returns no course, render the `Paper` card with a centered `No upcoming courses` message. No CTA is included in this iteration (deferred to a future spec). ARIA `role="status"` on the empty message.
   - **Error state**: When `fetchNextCourseDetail()` throws or returns an HTTP error, `CourseCard` does **not** catch or render the error itself. Instead, errors propagate to the page level (`page.tsx`), which renders an `Alert` with the message `Course data could not be loaded`. The page-level error boundary (`error.tsx`) provides the retry button via `router.refresh()`. All error events are logged centrally via `reportError` with status code and message for monitoring.
   - **Tie-breaking**: If multiple courses share the same start date, break the tie by selecting the course with the lexicographically smallest `id` (ascending string comparison). This guarantees a fully deterministic selection without requiring fields beyond what the Hemera API provides. Test example: two courses starting 2026-04-01 — course with `id: "abc"` is selected over `id: "def"`.

2. **Course Material Card** (right) — A `Paper`-based card displaying the slide/material generation status:
   - Generation status chip (Generated / Not generated)
   - Last updated date
   - Slide count
   - Slide thumbnails (existing `SlideThumbnails` component)
   - Generate button (existing `SlideGenerateButton` component)
   - Data source: `fetchSlideStatus()` from local filesystem
   - **Loading state**: While `fetchSlideStatus()` is pending, display a `Skeleton` placeholder matching the card layout (chip skeleton, text skeleton lines, thumbnail placeholder area).
   - **Error state**: When filesystem access fails (e.g., `ENOENT`, `EACCES` or other I/O errors), render an error message (`Slide status could not be loaded`) with a retry button. **Retry mechanism**: The retry button calls `router.refresh()` (Next.js App Router) to re-run the server component data fetch. Log the error via `reportError`.
   - **Empty state**: When `fetchSlideStatus()` returns zero slides, render a `No slides available` message with the `SlideGenerateButton` as CTA.
   - `SlideThumbnails` expects `{ files: string[] }` (array of file paths). `SlideGenerateButton` is self-contained and requires no additional props from `fetchSlideStatus()`.

#### Section B — Participants & Slides (middle row)

Two lists displayed side-by-side (`gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }`):

1. **Participant Preparations List** (left) — A `Paper`-based list of all course participants with their preparation status:
   - Compact card layout: each participant rendered as a card showing:
     - **Avatar** (MUI `Avatar` component with the participant's initials as fallback)
     - **Name**
   - **Completion status** (Yes / –)
   - **Expansion mechanism**: Each `ParticipantCard` within `ParticipantsList` uses an inline Accordion-style expand/collapse (MUI `Collapse` component). Clicking/tapping the card row toggles `aria-expanded` and reveals:
     - Preparation intent
     - Desired results
     - Line manager profile
   - **Avatar fallbacks**: When name is null, empty, or contains only whitespace/special characters such that no letter-based initials can be extracted, the `Avatar` displays the glyph `"?"` with `AVATAR_COLORS[0]` as the background color and the label `Unknown`. `AVATAR_COLORS` is defined in `src/app/components/dashboard/section-b-participants-list.tsx` as an array of hex color strings (e.g. `["#884143", "#926A49", ...]`); `AVATAR_COLORS[0]` (`"#884143"` / marsala) is the fallback background.
   - **Empty state**: When no participants exist, the `Paper` renders `No participants available` with explanatory text and no CTA (participants are managed in Hemera).
   - **Sorting**: `ParticipantsList` sorts participants alphabetically by `name` (ascending), with normalization (`trim()` + `toLowerCase()`) applied before comparison. Participants whose `name` is null, undefined, or empty string are always sorted **to the end** of the list (after all participants with a non-empty `name`). If two names are identical after normalization, their relative order is preserved (stable sort). The sorting is deterministic. Applied client-side within the `ParticipantsList` component (prop `participants` is the unsorted server response).
   - Data source: `ServiceCourseDetail.participants` from Hemera API

2. **Course Slides List** (right) — A `Paper`-based list of all generated slide files:
   - Slide filename
   - Clickable link to preview the slide: clicking opens a preview Modal (not a new tab) displaying the slide content. The Modal includes a close button and the slide filename as title.
   - **Error fallback for files**: If a file from `fetchSlideStatus().files` is missing or corrupted (HTTP 404/500 or read error when accessed), the Modal shows an error state (`File could not be loaded`) with a retry button. The retry button calls `router.refresh()` to re-run the server component data fetch (consistent with the page-level retry mechanism). The button shows a loading state while the refresh is pending. The faulty file path is logged via `reportError` on both initial failure and retry failure.
   - **Empty state**: When `fetchSlideStatus().files` is empty, render the `Paper` with `No slides generated.` message, a centered `DescriptionIcon` (MUI, 48 px, `color='text.disabled'`) as visual placeholder, and a hint to generate slides.
   - **State mapping**: `fetchSlideStatus().files` maps to UI states as follows: pending fetch → loading skeleton, successful response with files → file list (ready), successful response with empty array → empty state, I/O error / exception → error state with retry.
   - Data source: `fetchSlideStatus().files` from local filesystem

#### Section C — Controls (bottom row)

1. **Controls (Endpoints & Controls)** — A list of `Paper`-based cards under the heading `Controls`, each representing a monitored endpoint or control:
   - Existing `EndpointStatus` component content, restructured as individual cards
   - Each card shows: endpoint path, configured HTTP method, connectivity status chip
   - **Shared endpoint config**: Endpoint definitions are sourced from `src/app/components/endpoint-config.ts` as `EndpointDef { label: string, path: string, method: 'GET' | 'POST', group: string, probeMethod?: 'HEAD' | 'GET', fallbackToGetOnHeadUnsupported?: boolean }`
   - **Runtime probe result**: Health checks resolve to `EndpointResult { status: 'checking' | 'reachable' | 'error', code?: number, probeMethod?: 'HEAD' | 'GET' }`
   - **Displayed fields**: `path`, `method`, and the connectivity result; HTTP status code and the effective probe method MAY be surfaced as supporting detail when available
   - **Status rendering**: `status === 'checking'` → neutral `Chip` label `Loading…`; `status === 'reachable'` → green `Chip` label `OK`; `status === 'error'` → red `Chip` label `Error` with HTTP code or network context available via tooltip text
   - **Shared logic rule**: `ControlsCards` and the legacy `EndpointStatus` table MUST import the same `MONITORED_ENDPOINTS` source of truth
   - Data source: existing endpoint health check logic from `EndpointStatus` component

#### Section D — Camera (bottom)

1. **Camera Card** — A dedicated `Paper`-based card displaying the live camera snapshot:
   - Existing `CameraSnapshot` component embedded
   - Section heading: `Camera`
   - Data source: existing camera snapshot API (`/api/recording/snapshot`)
   - **Ownership rule**: `CameraSection` is a visual wrapper only; loading, retry, reconnect, polling, and backoff behavior remain owned by `CameraSnapshot`
   - **Loading state**: On initial mount, render a `Skeleton` placeholder (matching the `CameraSnapshot` aspect ratio) until the first snapshot response arrives.
   - **Error state**: When `/api/recording/snapshot` returns an error or is unreachable, display a fallback placeholder image with the message `Camera unavailable` and a retry button. Log the error.
   - **Auto-refresh**: The `CameraSnapshot` component polls `/api/recording/snapshot` every **10 seconds** (configurable via prop `refreshIntervalMs`, default `10000`). On successful fetch, the interval resets to the base value (`refreshIntervalMs`). On error, the component uses **incremental (additive) backoff**: the interval increases by `refreshIntervalMs` each failure (10s → 20s → 30s), capped at **30 seconds**. Retries continue **indefinitely** at the capped interval until a successful response resets the interval. Polling pauses when the browser tab is not visible (`document.hidden`) and resumes immediately on tab focus (triggering one fetch, then resuming the normal interval).

### Section Layout Rules

- All sections use MUI `Container` with `maxWidth='lg'`.
- Inter-section spacing: `mb: { xs: 4, md: 6 }` between sections.
- Cards within a section use equal height via CSS Grid `align-items: stretch`.
- On mobile (`xs`), all grids collapse to single-column layout.

## Acceptance Criteria

- All four sections (A–D) render without errors on desktop (≥1200 px) and mobile (375 px) viewports, with all `data-testid` attributes present.

### Required `data-testid` Attributes

| Section | `data-testid` | Component |
|---------|---------------|-----------|
| A | `course-card` | CourseCard |
| A | `material-card` | MaterialCard |
| B | `participants-list` | ParticipantsList |
| B | `slides-list` | SlidesList |
| B | `participant-card-{index}` | Individual participant row (0-based) |
| B | `slide-item-{index}` | Individual slide row (0-based) |
| C | `steuerung-cards` | ControlsCards container |
| C | `endpoint-card-{index}` | Individual endpoint card (0-based) |
| D | `camera-card` | CameraSection |
| D | `camera-snapshot` | CameraSnapshot image element |
| B | `slide-preview-modal` | SlidesList preview Dialog |

### Performance Goals

- Initial dashboard load (SSR) ≤ 2 s on desktop (measured as Time to First Contentful Paint)
- Visible sections (A–B) interactive within ≤ 100 ms after hydration
- No Cumulative Layout Shift from card rendering (CLS < 0.1)

### Accessibility Requirements

- All interactive elements (expandable participant cards, retry buttons, generate button, slide preview links) MUST be keyboard-navigable (Tab + Enter/Space)
- Expandable participant cards MUST have `aria-expanded` reflecting current state
- Status chips in Section C MUST have descriptive `aria-label` values (endpoint path + method + status)
- All color combinations MUST meet WCAG 2.1 AA contrast ratio (≥ 4.5:1 for text, ≥ 3:1 for UI components)

## Clarifications

### Session 2026-03-25

- Q: What should happen to the existing CameraSnapshot section not referenced in the new layout? → A: Add a new Section D below Controls dedicated to the camera.
- Q: How should the participant data be displayed in the half-width card (6 columns are very dense)? → A: Compact card per participant showing name + avatar + completion status; expandable for detail fields (preparation intent, desired results, line manager profile).
- Q: How should slide type information be displayed in the Course Slides List? → A: Show filenames only — omit type information for now.
- Q: Does this dashboard design include a top navigation bar (current layout has none, but spec references toolbar clearance)? → A: No navigation bar yet — toolbar clearance requirement removed from spec.
- Q: What is the primary measurable acceptance criterion for this dashboard redesign? → A: All four sections (A–D) render without errors on desktop (≥1200 px) and mobile (375 px) viewports, with all data-testid attributes present.

<!-- To be filled during clarification sessions -->
