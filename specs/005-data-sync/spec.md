# Feature Specification: Data Synchronization

**Feature Branch**: `005-data-sync`  
**Created**: 2026-02-21  
**Status**: Draft  
**Input**: Aither fetches course data from the Hemera Academy Service API and displays it on its homepage. This spec defines the full data sync pipeline: scheduled fetching, incremental updates, content-hash-based change detection, and HTML generation from templates.

> **Core rule**: Aither only pulls data for the **next upcoming course** (by start date) and the **participants plus their preparations** for that course. Past courses and courses farther in the future are ignored so the sync stays focused and the generated output remains easy to review.

## Pre-Requisites

- **Hemera endpoint extension**: `GET /api/service/courses/[id]` must be extended to include `preparationIntent`, `desiredResults`, `lineManagerProfile`, `preparationCompletedAt`, and `user.name` in its response. This is tracked as a separate Hemera task and must be available before the data-sync pipeline can fetch participant preparation data. The original assumption of a dedicated `GET /api/service/courses/[id]/participations` endpoint was dropped in favor of embedding participant data directly in the course detail response (see research.md §2).

## Out of Scope

- Local database storage (Constitution VII — Aither is stateless; no Prisma, no SQLite).
- Video/audio recording or MUX upload (covered by 004-recording-module).
- Clerk user synchronization between Aither and Hemera.
- Admin dashboard UI for sync management (future spec).
- Real-time push notifications from Hemera (pull-only architecture).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — On-Demand Sync Trigger (Priority: P1)

As a system operator, I want to trigger a data sync via API, so that Aither fetches the next upcoming course — including all participants and their individual preparations — from Hemera and regenerates the corresponding HTML output.

**Why this priority**: The core sync pipeline must work before scheduling or change detection can be layered on top.

**Independent Test**: Call `POST /api/sync` and verify that `output/` contains a freshly generated HTML file for the next upcoming course, including participant names and preparation data.

**Acceptance Scenarios**:

1. **Given** the Hemera API is reachable and returns multiple courses, **When** `POST /api/sync` is called, **Then** Aither identifies the next course by `startDate` (earliest future date), fetches its participants with their preparations, and writes populated HTML files to `output/`.
2. **Given** the Hemera API returns valid data, **When** sync completes, **Then** a JSON response includes sync status, duration, and counts of generated files and participants fetched.
3. **Given** the Hemera API is unreachable, **When** sync is triggered, **Then** the error is logged and the API returns a structured error response (no crash).
4. **Given** a course has 5 participants with preparations, **When** sync runs, **Then** all 5 participant preparations are included in the generated output.
5. **Given** no future courses exist in Hemera (all courses are in the past or list is empty), **When** `POST /api/sync` is called, **Then** sync completes successfully with 0 files generated, the response status includes `"noUpcomingCourse": true`, and previously generated output files from earlier syncs are preserved as-is (no deletion or archival). Operators who wish to clear stale output must do so manually.

---

### User Story 2 — Incremental Sync with Content Hashing (Priority: P1)

As a system operator, I want Aither to detect which data has changed since the last sync, so that only affected HTML files are regenerated (saving time and I/O).

**Why this priority**: Without change detection, every sync regenerates all files — wasteful for hundreds of entities.

**Independent Test**: Run sync twice with no data changes; verify zero files are rewritten on the second run.

**Acceptance Scenarios**:

1. **Given** a previous sync completed successfully, **When** a new sync runs and the next course's data (including participants and preparations) is unchanged, **Then** the HTML files are not overwritten and the sync reports 0 changes.
2. **Given** the next course's title changed in Hemera, **When** the next sync runs, **Then** the HTML is regenerated.
3. **Given** a participant's preparation data changed (e.g., `preparationIntent` updated), **When** the next sync runs, **Then** the affected output is regenerated.
4. **Given** the content-hash manifest is missing or corrupted, **When** sync runs, **Then** a full regeneration is performed and a new manifest is written.
5. **Given** the next course changes (e.g., old next course is now in the past), **When** sync runs, **Then** the output is replaced with the new next course's HTML and its participants.

---

### User Story 3 — Scheduled Automatic Sync (Priority: P2)

As a system operator, I want sync to run on a configurable schedule (e.g., daily via system cron), so that Aither data stays current without manual intervention.

**Why this priority**: Automation is valuable but depends on the sync pipeline (P1) working correctly first.

**Independent Test**: Configure a cron job, wait for the scheduled time, and verify new data appears in `output/`.

**Acceptance Scenarios**:

1. **Given** a cron schedule is configured, **When** the scheduled time arrives, **Then** `POST /api/sync` is called automatically and HTML files are updated.
2. **Given** a scheduled sync fails, **When** the failure threshold is exceeded, **Then** an email notification is sent to the operator.
3. **Given** a sync is already running, **When** another sync is triggered, **Then** the second request is rejected with HTTP 409 Conflict.
4. **Given** an unauthenticated request is made to `POST /api/sync` (no valid admin token or API key), **When** the request is processed, **Then** it is rejected with HTTP 401 Unauthorized. Scheduled cron triggers must include valid authentication credentials (e.g., `Authorization: Bearer <admin-token>`).

---

### User Story 4 — Participant Preparations Sync (Priority: P1)

As a system operator, I want Aither to pull all participants and their individual preparations for the next course, so that the generated HTML output contains personalized preparation data per participant.

**Why this priority**: Preparation data is the core content of the generated output — without it, the HTML files are incomplete.

**Independent Test**: Trigger sync for a course with 3 participants who have filled in their preparations. Verify that the output includes all 3 participants' `preparationIntent`, `desiredResults`, and `lineManagerProfile`.

**Acceptance Scenarios**:

1. **Given** the next course has 3 participants with preparation data, **When** sync runs, **Then** the generated output contains all 3 participants with `preparationIntent`, `desiredResults`, and `lineManagerProfile`.
2. **Given** a participant has not yet completed their preparation (`preparationCompletedAt` is null), **When** sync runs, **Then** the participant is still included, with empty/null preparation fields shown as placeholders.
3. **Given** a participant updates their `preparationIntent` in Hemera, **When** the next sync runs, **Then** the change is reflected in the regenerated output.
4. **Given** a new participant is added to the course in Hemera, **When** sync runs, **Then** the new participant and their preparation data appear in the output.

---

### User Story 5 — Display Synced Data on Homepage (Priority: P1)

As a visitor, I want to see the next upcoming Hemera Academy course and its participants on the Aither homepage — displayed in well-formatted HTML tables — so that all synced data is clearly readable at a glance.

**Why this priority**: Provides immediate visual feedback that the data pipeline works end-to-end. Tables ensure consistent, scannable presentation.

**Independent Test**: Load `http://localhost:3500` and verify that the page shows (1) a course details table and (2) a participants table with preparation columns, both properly formatted.

**Acceptance Scenarios**:

1. **Given** the next course is synced, **When** the Aither homepage loads, **Then** a **Course Details** table is displayed with rows for: Course (title), Level, Start Date, End Date, and Participant Count.
2. **Given** the next course has participants with preparations, **When** the homepage loads, **Then** a **Participants & Preparations** table is displayed with columns: Name, Preparation Intent, Desired Results, Line Manager Profile, and Preparation Completed.
3. **Given** a participant has not completed their preparation, **When** the table renders, **Then** empty fields show a dash ("–") placeholder instead of blank cells.
4. **Given** the Hemera API is unreachable, **When** the homepage loads, **Then** a fallback message is shown instead of an error page.
5. **Given** the next course changes in Hemera, **When** the page is reloaded after sync, **Then** both tables update to reflect the new course and its participants.

---

## Requirements *(mandatory)*

### Functional Requirements

1. **Sync API** — `POST /api/sync` triggers a full or incremental sync cycle.
2. **Next-Course Selection** — Fetch all courses from Hemera, then select only the next upcoming course (earliest `startDate` in the future). All other courses are discarded.
3. **Participant & Preparation Fetching** — For the selected course, fetch all participants (via `CourseParticipation`) including their preparation fields: `preparationIntent`, `desiredResults`, `lineManagerProfile`, and `preparationCompletedAt`.
4. **Data Fetching** — Fetch course detail data (including participants) for the selected next course from Hemera's `/api/service/*` endpoints using the existing `HemeraClient`.
5. **Content Hashing** — Compute SHA-256 hash of the selected course's data plus participant/preparation data; store as JSON manifest in `output/.sync-manifest.json`.
6. **HTML Generation** — Populate HTML template with the next course's data and participant preparations, then write to `output/`.
6a. **Table-Based Display** — All synced data (course details and participant preparations) must be rendered in well-formatted HTML tables with clear column headers, consistent alignment, and readable styling (borders, padding, zebra-striping or equivalent).
7. **Sync Status** — `GET /api/sync` returns last sync time, result, the selected course, and participant count.
8. **Concurrent Sync Guard** — Only one sync may run at a time; reject duplicates with 409.
9. **Homepage Display** — Server-render the next upcoming course on the Aither homepage via `HemeraClient` **live at request time** (SSR, not from `output/` files). The `output/` directory serves the fullscreen HTML player only. The page must contain:
  - **Course details table**: Title, Level, Start Date, End Date, Participant Count.
  - **Participants table**: Name, Preparation Intent (`preparationIntent`), Desired Results (`desiredResults`), Line Manager Profile (`lineManagerProfile`), Preparation Completed (`preparationCompletedAt`).
   - Empty/null fields are displayed as "–" (dash).

### Non-Functional Requirements

1. Sync completes within 30 seconds (single course scope).
2. No local database (stateless architecture per Constitution VII).
3. All API responses include structured error objects with request IDs.
4. Sync failures are logged via Rollbar (when enabled). Additionally, every completed sync (success or failure) emits a structured Rollbar `info`-level log event containing: duration (ms), files generated, files skipped, participant count, selected course ID, and errors (if any).
5. **Presentation**: All data is rendered in clean HTML tables. Tables must remain readable with clear column headers, borders/padding, and no layout breakage for long text such as `preparationIntent`. Long text fields (>200 characters) use `word-break: break-word` in the table.
6. **Gitignore**: The sync manifest file (`output/.sync-manifest.json`) and all generated HTML files in `output/` are gitignored.

## Clarifications

### Session 2026-02-21

- Q: What happens when no future course exists? → A: Sync succeeds with 0 files, existing output files remain in place, and the status includes the note `no upcoming course`.
- Q: Does the homepage load participants live via SSR or from `output/`? → A: Live via SSR through `HemeraClient` so the data stays current without requiring sync. Files in the `output/` directory are used only by the fullscreen player.
- Q: Should the sync capture metrics beyond the API response? → A: Yes, emit one structured Rollbar info-level log event per sync including duration, files, participant count, and errors.

### Baseline

- **Only the next course**: Aither synchronizes only the chronologically next course (earliest future `startDate`). Past courses and more distant future courses are neither stored nor shown.
- **Participants + preparations**: For the next course, fetch all participants (`CourseParticipation`) together with their preparation fields. The relevant Hemera fields are:
  - `preparationIntent` — participant preparation intent (max. 2000 characters)
  - `desiredResults` — desired results (max. 2000 characters)
  - `lineManagerProfile` — line manager profile (max. 2000 characters)
  - `preparationCompletedAt` — timestamp of completed preparation (nullable)
- **No database**: Aither stores only generated HTML files and a sync manifest (JSON). All source data is fetched from Hemera on every sync.
- **Cron is external**: Scheduling is handled by system cron (`crontab`) calling the sync API, not by an in-process scheduler.
- **Templates**: HTML generation uses a local Handlebars template (`src/templates/course-detail.hbs`). Templates apply only to the sync pipeline (`output/`), not to the homepage (which uses React SSR).
- **Table layout**: The HTML page shows two tables: (1) **Course Details** with metadata for the next course as key-value rows, and (2) **Participants & Preparations** as a column-based table with one row per participant. Empty fields render as `–`. Long text wraps within its table cell.

## Assumptions

- The Hemera Service API at `/api/service/courses` returns all courses with participant counts and `startDate` (confirmed working). Aither filters client-side to select only the next upcoming course.
- `GET /api/service/participations/[id]` returns preparation fields (`preparationIntent`, `desiredResults`, `resultOutcome`, etc.) per Teilnahme-ID (confirmed in Hemera codebase).
- **Missing endpoint assumption resolved**: The originally assumed `GET /api/service/courses/[id]/participations` endpoint is not required. Instead, the existing `GET /api/service/courses/[id]` endpoint in Hemera is extended to embed participant data, including preparation fields, directly in the course detail response (see Pre-Requisites and research.md §2).
- The `HemeraClient` with API key authentication is functional (confirmed in 003-service-user).
- The `output/` directory is writable and gitignored.
- FFmpeg or media processing is NOT part of this spec (see 004-recording-module).

## Success Criteria *(mandatory)*

1. `POST /api/sync` fetches courses from Hemera, selects the next upcoming one, pulls all participants with their preparations, and generates HTML files in `output/`.
2. Participant preparation data (`preparationIntent`, `desiredResults`, `lineManagerProfile`) is included in the generated output.
3. Incremental sync skips regeneration when the next course's data (including participant preparations) is unchanged (verified by content hash comparison).
4. Homepage at `/` displays the next upcoming course and its participants in well-formatted HTML tables (Course Details + Participants & Preparations).
5. Concurrent sync requests are rejected with 409.
6. All sync operations are covered by unit and contract tests.
7. When the next course changes (e.g., time passes), the output is updated accordingly on the next sync.
