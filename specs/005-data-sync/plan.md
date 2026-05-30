# Implementation Plan: Data Synchronization

**Branch**: `005-data-sync` | **Date**: 2026-02-21 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/005-data-sync/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Aither fetches **only the next upcoming course** (earliest future `startDate`) from the Hemera Academy Service API, including all participants and their individual preparation data (`preparationIntent`, `desiredResults`, `lineManagerProfile`, `preparationCompletedAt`). Two rendering paths:

1. **Sync Pipeline** (`POST /api/sync`): Fetch courses → select next → fetch course detail with participants → content-hash comparison → generate HTML to `output/` for the fullscreen player. Incremental: unchanged data is skipped.
2. **Homepage SSR** (`/`): Server-renders the next course + participant tables **live at request time** via `HemeraClient` (not from `output/` files). Two tables: Course Details (key-value) + Participants & Preparations (columnar).

Both paths share the `HemeraClient` and next-course selection logic but produce different outputs (static HTML vs. React SSR).

### Two Rendering Paths

| Aspect | Sync Pipeline (POST /api/sync) | Homepage SSR (/) |
|--------|--------------------------------|-------------------|
| **Trigger** | API call (manual or cron) | Page request |
| **Output** | Static HTML in output/ | React server-rendered HTML |
| **Template** | Handlebars (local .hbs file) | React JSX (page.tsx) |
| **Consumer** | Fullscreen HTML player | Operators viewing the site |
| **Freshness** | Snapshot at sync time | Always live from Hemera |
| **Change detection** | SHA-256 content hash manifest | N/A (always fetches) |

### Cross-Repository Dependency

The Hemera `GET /api/service/courses/[id]` endpoint currently returns participations with only `id, status, createdAt`. It **must be extended** to include:
- `preparationIntent`, `desiredResults`, `lineManagerProfile`, `preparationCompletedAt` from CourseParticipation
- `user.name` via `booking.user` join

This is a Hemera change tracked separately but required before participant data flows through.

### API Fallback and Graceful Degradation

If the extended `GET /api/service/courses/[id]` response does not include the expected preparation fields (e.g., Hemera has not yet been updated), the sync pipeline applies graceful degradation:

- **Detection**: After Zod validation, check whether `participants[].preparationIntent` is present. If the response shape matches the pre-extension format (participations without preparation fields), log a `schema.incompatible` Rollbar warning.
- **Degradation rules**: Missing `preparationIntent`, `desiredResults`, `lineManagerProfile` → default to `null`. Missing `user.name` → default to `"Unknown"`. Missing `preparationCompletedAt` → default to `null`.
- **Monitoring**: A `hemera.schema_mismatch` Rollbar warning event is emitted with the endpoint URL and missing fields. This alerts operators that the Hemera extension is not yet deployed.
- **Feature flag**: The environment variable `HEMERA_EXTENDED_PARTICIPATION=true|false` (default `true`) controls whether the sync expects preparation fields. When set to `false`, the sync skips preparation-specific rendering and uses simplified participant rows (name + status only). This allows controlled deployment before/after the Hemera change.
- **Version header**: The `HemeraClient` checks for `X-Hemera-API-Version` in responses (if present) and logs it for debugging. No hard version gating — the fallback logic handles shape mismatches gracefully.

### Edge Cases (from Clarifications)

- **No upcoming course**: Sync succeeds with 0 files generated, existing output preserved, response includes `"noUpcomingCourse": true`. Previously generated HTML files remain as-is — they represent the last valid sync snapshot. The Fullscreen-Player continues to render the most recent output. No stale-data banner or deletion is performed; an explicit `"noUpcomingCourse": true` flag in the sync response is the sole indicator for operators. If operators need to clear stale output, they must do so manually or via a future admin endpoint.
- **Sync metrics**: Every completed sync emits a structured Rollbar info-level log event with a mandatory `status` field (`"success"` | `"partial_failure"` | `"failure"`), plus: duration (ms), files generated, files skipped, participant count, selected course ID, and an `errors` array (empty on success, contains `SyncError[]` on partial or full failure). `partial_failure` indicates that the sync completed but some non-fatal errors occurred (e.g., template rendering warning). `failure` indicates a fatal error that aborted the sync. Existing fields (`durationMs`, `filesGenerated`, `filesSkipped`, `participantCount`, `courseId`) remain unchanged.

## Technical Context

**Language/Version**: TypeScript 5.9.3
**Primary Dependencies**: Next.js 16.1.6, React 19.2.4, Zod 3.24, Handlebars 4.7.8, p-throttle 6.2, p-retry 6.2, MUI 6.4

### Retry and Rate-Limiting Policy

| Concern | Library | Configuration |
|---------|---------|---------------|
| Retries | p-retry 6.2 | 3 attempts, exponential backoff with jitter (base 1s, factor 2). Retry on HTTP 5xx and network timeouts (`ECONNREFUSED`, `ETIMEDOUT`). Fail immediately on 4xx (client errors are not transient). |
| Rate limiting | p-throttle 6.2 | Max 2 requests/second to Hemera API, burst of 3. If throttled, requests queue transparently. |
| Fallback | — | After retry exhaustion, abort sync with `status: "failure"` and log via Rollbar `error` level. No partial output is committed (atomic: either all files or none). |
| Monitoring | Rollbar | `sync.retry` info-level event per retry attempt (includes attempt number, HTTP status, endpoint). `sync.rate_limited` warning if throttle queue exceeds 5s wait. |

This policy applies to all `HemeraClient.get()` calls within the sync pipeline and homepage SSR. The `HemeraClient` constructor already accepts `rateLimit` and `maxRetries` options — these values are the defaults for the data-sync feature.
**Storage**: Flat files only (output/ directory + .sync-manifest.json). No database (Constitution VII).
**Testing**: Vitest 3.0 (unit + contract), Playwright 1.52 (E2E)
**Target Platform**: Linux service (self-hosted), development on macOS port 3500
**Project Type**: single
**Performance Goals**: Sync completes within 30 seconds (single course scope per NFR-1)

### Timeout and Error Handling Strategy

- **Hard timeout**: 30 seconds from sync start. If exceeded, the sync job is aborted and marked `status: "failure"` with a `SYNC_TIMEOUT` error.
- **Abort mechanism**: The `AbortController` signal is passed to all `HemeraClient.get()` calls. On timeout, pending HTTP requests are cancelled via `signal.abort()`.
- **Partial completion**: Sync uses an atomic commit pattern — HTML files are written to `.tmp` first and renamed only after all steps succeed. If a timeout occurs mid-write, no partial output is committed. The previous sync's output and manifest remain untouched.
- **Retry after timeout**: No automatic retry. Operators must re-trigger `POST /api/sync`. Concurrent guard (409) prevents overlap.
- **Monitoring**: `sync.timeout` Rollbar error-level event with `durationMs`, `courseId`, and the step where timeout occurred. A `timeout_count` metric is tracked in the sync response `errors` array.
- **NFR-1 SLA**: The 30s target is validated by contract tests that mock slow Hemera responses. If real-world syncs regularly approach 30s, the threshold should be reviewed.
**Constraints**: Stateless (no local DB, Constitution VII NON-NEGOTIABLE). All data from Hemera API.

### PII and Logging Policy

**PII definition for this feature**: Full name (`user.name`), email address, national ID, birth date. Participant IDs (`participationId`, `userId`) are pseudonymous identifiers and are NOT considered PII.

- **Logs**: Sync metrics and Rollbar events must never contain participant names or other PII fields. Allowed in logs: `participationId`, `userId`, `courseId`, participant count (aggregate), sync duration, file counts.
- **Hemera response handling**: The `user.name` field is fetched from Hemera solely for rendering in output HTML and homepage tables. It is never written to logs, metrics, or error messages.
- **Monitoring events**: The `sync.completed` Rollbar event uses `courseId` and `participantCount` (integer) — not participant names. If participant-level detail is needed for debugging, use `participationId` only.
- **Confirmation**: Participant names (`user.name`) must not appear in any log output, Rollbar event payload, or console message. This is enforced by code review and contract test assertions on log output.

> ⚠️ **Explicit guarantee**: No participant name (`user.name`) appears in logs, metrics, or error payloads. Only pseudonymous identifiers (`participationId`, `userId`) and aggregate counts are logged.
**Scale/Scope**: Single next course + ~20 participants max. No pagination needed.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | Test-First Development (NON-NEGOTIABLE) | PASS | Contract tests for sync API + unit tests for course selector, hash manifest, orchestrator. Vitest. |
| II | Code Quality and Formatting | PASS | Biome enforced via pre-commit hooks. Strict TypeScript. |
| III | Feature Development Workflow | PASS | Spec-first workflow followed. OpenAPI contract in contracts/sync-api.yaml. |
| IV | Authentication and Security | PASS | Sync API uses admin auth (requireAdmin()). API key for Hemera. No PII in logs. |
| V | Component Architecture | PASS | MUI tables on homepage. Accessible column headers. |
| VI | Holistic Error Handling and Observability | PASS | Rollbar errors + structured info-level log per sync (NFR-4). Graceful degradation. |
| VII | Stateless Architecture (NON-NEGOTIABLE) | PASS | No database. output/ files + transient in-memory sync state. Manifest = flat JSON. |
| VIII | HTML Playback and Video Recording | PASS | Generated HTML served via fullscreen player. No video in this spec. |
| IX | Aither Control API | N/A | No player control changes in this feature. |
| X | Language Policy | PASS | Code/docs in English. Frontend table headers are documented in English (Course Details, Participants). |

**Gate Result**: ALL PASS. No violations. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/005-data-sync/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   └── sync-api.yaml    # OpenAPI 3.1 contract
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── page.tsx                          # MODIFY: add next-course + participant tables (SSR)
│   └── api/
│       └── sync/
│           └── route.ts                  # MODIFY: update orchestrator call for next-course pipeline
├── lib/
│   ├── hemera/
│   │   ├── client.ts                     # EXISTING: HemeraClient — compatible with ServiceCourseDetailSchema;
│   │   │                                  #   get() accepts any Zod schema and validates responses.
│   │   │                                  #   ServiceCourseDetailResponseSchema is passed at call site;
│   │   │                                  #   no client.ts code changes needed.
│   │   ├── schemas.ts                    # MODIFY: add ServiceCourseDetailSchema with participants
│   │   └── types.ts                      # MODIFY: add ServiceCourseDetail, ServiceParticipant types
│   ├── sync/
│   │   ├── orchestrator.ts               # MODIFY: refactor for next-course-only pipeline
│   │   ├── course-selector.ts            # NEW: selectNextCourse() pure function
│   │   ├── hash-manifest.ts              # EXISTING: reuse as-is
│   │   ├── types.ts                      # MODIFY: add NextCourseSyncData, DataSyncJob types
│   │   └── schemas.ts                    # EXISTING: reuse as-is
│   ├── html/
│   │   ├── populator.ts                  # EXISTING: Handlebars engine (reuse as-is)
│   │   └── writer.ts                     # EXISTING: atomic file writes (reuse as-is)
│   └── monitoring/
│       └── rollbar-official.ts           # EXISTING: structured logging
├── templates/
│   └── course-detail.hbs                 # NEW: Handlebars template for sync output HTML
└── types/                                # EXISTING: shared type definitions

tests/
├── unit/
│   ├── course-selector.spec.ts           # NEW: next-course selection logic
│   ├── orchestrator.spec.ts              # NEW/MODIFY: refactored orchestrator tests
│   └── sync-manifest.spec.ts             # EXISTING: hash manifest tests
├── contract/
│   ├── sync-api.spec.ts                  # NEW: POST/GET /api/sync contract tests
│   └── hemera-courses.spec.ts            # NEW: Hemera course detail response contract
└── e2e/
    └── sync-homepage.spec.ts             # NEW: full pipeline E2E (sync + homepage render)

output/                                    # EXISTING: gitignored, generated HTML files
├── .sync-manifest.json                   # Sync state manifest
└── courses/                              # NEW subdirectory for course HTML
    └── <slug>.html                       # Generated course+participant HTML
```

**Structure Decision**: Single project. Aither is a monolithic Next.js app. New files are added to existing src/lib/sync/ and src/lib/hemera/ directories. The only new top-level directory is src/templates/ for Handlebars templates.

## Complexity Tracking

> No violations detected. All Constitution principles pass. No justifications needed.
