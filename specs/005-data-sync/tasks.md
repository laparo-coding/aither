# Tasks: Data Synchronization

**Input**: Design documents from `/specs/005-data-sync/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/sync-api.yaml, quickstart.md

**Tests**: Required per Constitution I (Test-First Development, NON-NEGOTIABLE) and Success Criteria #6 ("All sync operations are covered by unit and contract tests").

**Organization**: Tasks are grouped by user story. US1 and US4 are merged into one phase because participant preparation data is an integral part of the sync pipeline (US1-AS4 requires "all 5 participant preparations are included in the generated output").

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US5)
- Exact file paths included in all descriptions

## User Story Mapping

| Story | Title | Priority | Phase |
|-------|-------|----------|-------|
| US1 | On-Demand Sync Trigger | P1 | 3 (MVP) |
| US2 | Incremental Sync with Content Hashing | P1 | 4 |
| US3 | Scheduled Automatic Sync | P2 | 6 |
| US4 | Participant Preparations Sync | P1 | 3 (merged with US1) |
| US5 | Homepage Display (SSR) | P1 | 5 |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add Zod schemas, TypeScript types, and project structure needed by all user stories.

- [ ] T001 Add ServiceParticipantSchema, ServiceCourseDetailSchema, and ServiceCourseDetailResponseSchema Zod schemas with z.infer type exports in src/lib/hemera/schemas.ts
- [ ] T002 [P] Add NextCourseSyncData and DataSyncJob interfaces in src/lib/sync/types.ts
- [ ] T003 [P] Create src/templates/ directory and add `course-detail.hbs` Handlebars template with Course Details (key-value rows) and Participants & Preparations (columnar table, dash placeholders for null, word-break for long text) in `src/templates/course-detail.hbs`
- [ ] T004 [P] Create output/courses/ directory and verify .gitignore covers output/**

**Checkpoint**: Schemas, types, and template ready. All downstream phases can reference these.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The `selectNextCourse()` pure function is used by both the sync pipeline (US1) and the homepage (US5). Must be complete before any user story.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T005 Write failing unit tests for selectNextCourse() covering: future courses sorted by startDate, no future courses returns null, mixed past/future courses, empty array input in tests/unit/course-selector.spec.ts
- [ ] T006 Implement selectNextCourse(courses: ServiceCourse[]): ServiceCourse | null pure function — filter startDate > now(), return first (earliest) or null in src/lib/sync/course-selector.ts
- [ ] T007 Run tests/unit/course-selector.spec.ts and verify all pass (GREEN)

**Checkpoint**: Foundation ready — selectNextCourse tested and working. User story implementation can now begin.

---

## Phase 3: US1+US4 — Sync Pipeline with Participant Preparations (P1) 🎯 MVP

**Goal**: `POST /api/sync` fetches the next upcoming course with all participants and their preparations from Hemera, generates HTML output to `output/`. `GET /api/sync` returns sync status. Handles noUpcomingCourse edge case. Emits structured Rollbar log.

**Independent Test**: Call `POST /api/sync` → verify `output/courses/<slug>.html` exists and contains participant names + preparation data. Call `GET /api/sync` → verify status with courseId and participantCount.

### Tests for US1+US4

> **Write tests FIRST, ensure they FAIL before implementation (Constitution I)**

- [ ] T008 [P] [US1] Write contract tests for POST /api/sync (202 started, 409 conflict) and GET /api/sync (200 status, 404 no job) matching contracts/sync-api.yaml response schemas in tests/contract/sync-api.contract.spec.ts
- [ ] T009 [P] [US1] Write contract tests for Hemera ServiceCourseDetail response shape validation (ServiceCourseDetailResponseSchema with participants array including preparationIntent, desiredResults, lineManagerProfile, preparationCompletedAt) in tests/contract/hemera-courses.contract.spec.ts
- [ ] T010 [P] [US1] Write unit tests for runDataSync() in SyncOrchestrator covering: successful sync with participants, noUpcomingCourse edge case, Hemera API error handling, and Rollbar log emission in tests/unit/sync-orchestrator.spec.ts

### Implementation for US1+US4

- [ ] T011 [US1] Implement runDataSync() method in SyncOrchestrator: fetchCourses → selectNextCourse → fetchCourseDetail (with participants) → populateTemplate → writeHtmlFile. Handle noUpcomingCourse (return success with 0 files, preserve existing output) in src/lib/sync/orchestrator.ts
- [ ] T012 [US1] Update POST handler to invoke runDataSync() instead of legacy pipeline, and update GET handler to return DataSyncJob status shape matching contracts/sync-api.yaml in src/app/api/sync/route.ts
- [ ] T013 [US1] Add structured Rollbar info-level log event (sync.completed) with durationMs, filesGenerated, filesSkipped, participantCount, courseId, noUpcomingCourse, errors after each sync completion in src/lib/sync/orchestrator.ts
- [ ] T014 [US1] Run tests (T008, T009, T010) and verify all pass (GREEN)

**Checkpoint**: `POST /api/sync` works end-to-end. Output HTML includes participant preparations. Rollbar logging active. MVP is functional.

---

## Phase 4: US2 — Incremental Sync with Content Hashing (P1)

**Goal**: Sync detects unchanged data via SHA-256 content hash comparison against the manifest. Only regenerates HTML when course or participant data has changed.

**Independent Test**: Run sync twice without data changes — second run reports `filesGenerated: 0`, `filesSkipped: 1`.

### Tests for US2

- [ ] T015 [P] [US2] Write unit tests for content hash integration in runDataSync(): hash match skips regeneration, hash mismatch triggers regeneration, missing/corrupted manifest triggers full regeneration, participant preparation change triggers regeneration in tests/unit/sync-orchestrator.spec.ts

### Implementation for US2

- [ ] T016 [US2] Integrate computeContentHash() into runDataSync(): hash serialized course + participants (sorted keys), compare against readManifest(), skip writeHtmlFile if match in src/lib/sync/orchestrator.ts
- [ ] T017 [US2] Call writeManifest() after successful HTML generation with courseId, hash, outputPath, and timestamp in src/lib/sync/orchestrator.ts
- [ ] T018 [US2] Handle corrupted/missing manifest: catch JSON parse errors, log warning via Rollbar, trigger full regeneration in src/lib/sync/orchestrator.ts
- [ ] T019 [US2] Run tests (T015) and verify all pass (GREEN)

**Checkpoint**: Incremental sync works. Second identical sync writes 0 files. Changed preparation data triggers regeneration.

---

## Phase 5: US5 — Display Synced Data on Homepage (P1)

**Goal**: The Aither homepage at `/` server-renders the next upcoming course and its participants in two HTML tables (Course Details + Participants & Preparations) via live SSR from `HemeraClient`, not from `output/` files.

**Independent Test**: Load `http://localhost:3500` → verify the Course Details table and Participants table with preparation columns are rendered, and null fields show `–`.

### Tests for US5

- [ ] T020 [P] [US5] Write E2E test for homepage: verify the Course Details table (Course, Level, Start Date, End Date, Participant Count) and Participants table (Name, Preparation Intent, Desired Results, Line Manager Profile, Preparation Completed) render with data, null fields show `–`, and the fallback message appears when the API is unreachable in `tests/e2e/sync-homepage.spec.ts`

### Implementation for US5

- [ ] T021 [US5] Refactor page.tsx to fetch courses via HemeraClient, call selectNextCourse(), then fetch course detail with participants in src/app/page.tsx
- [ ] T022 [US5] Implement the Course Details table (MUI Table) with key-value rows: Course, Level, Start Date, End Date, Participant Count in `src/app/page.tsx`
- [ ] T023 [US5] Implement the Participants & Preparations table (MUI Table) with columns: Name, Preparation Intent, Desired Results, Line Manager Profile, Preparation Completed (boolean derived from `preparationCompletedAt`). Null fields render as `–`. Long text uses `word-break: break-word` in `src/app/page.tsx`
- [ ] T024 [US5] Add error boundary / fallback UI: show `Course data could not be loaded` when `HemeraClient` fails, with `try/catch` wrapping the fetch logic in `src/app/page.tsx`
- [ ] T025 [US5] Run E2E test (T020) and verify pass (GREEN)

**Checkpoint**: Homepage displays course + participant tables live from Hemera. Fallback works when API is down.

---

## Phase 6: US3 — Scheduled Automatic Sync (P2)

**Goal**: System operators can schedule sync runs via external cron. The existing concurrent guard (409 Conflict) handles overlapping triggers.

**Independent Test**: Configure cron, wait for scheduled time, verify `output/` is updated.

### Implementation for US3

- [ ] T026 [US3] Document cron setup: sample crontab entry calling POST /api/sync with curl + auth header, expected response handling, and error notification via Rollbar alerts in docs/sync-scheduling.md
- [ ] T027 [US3] Add contract test case for concurrent sync rejection (409 Conflict with SYNC_IN_PROGRESS error code) to verify overlapping cron triggers are handled safely in tests/contract/sync-api.contract.spec.ts

**Checkpoint**: Scheduling is documented. Concurrent guard verified.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Finalize documentation, validate against quickstart, run full test suite.

- [ ] T028 [P] Update README.md or docs/ with sync feature overview and endpoint documentation
- [ ] T029 Run quickstart.md validation — execute all 7 verification steps (connectivity, trigger, status, output, incremental, homepage, concurrent guard)
- [ ] T030 Run full test suite (vitest run + playwright test) and fix any failures
- [ ] T031 Run biome lint and typecheck (npm run lint && npm run typecheck) and fix any issues

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (schemas/types must exist for course-selector)
- **US1+US4 (Phase 3)**: Depends on Phase 2 — needs selectNextCourse()
- **US2 (Phase 4)**: Depends on Phase 3 — needs runDataSync() to add hashing into
- **US5 (Phase 5)**: Depends on Phase 2 — needs selectNextCourse(). Independent of Phase 3/4 (uses live SSR, not sync output)
- **US3 (Phase 6)**: Depends on Phase 3 — needs sync pipeline working
- **Polish (Phase 7)**: Depends on all desired phases being complete

### Cross-Repository Dependency

⚠️ **Hemera change required before Phase 3 can fully work**: `GET /api/service/courses/[id]` must be extended with preparation fields + user.name (see research.md §2). Without this, contract tests in T009 will validate against the expected shape but live integration will return incomplete data. Implement Hemera extension first or mock the response for initial development.

### User Story Dependencies

- **US1+US4 (P1)**: Can start after Phase 2. No dependencies on other stories. **This is the MVP.**
- **US2 (P1)**: Depends on US1+US4 (adds hash layer on top of the sync pipeline)
- **US5 (P1)**: Can start after Phase 2. Independent of US1/US2 (different rendering path)
- **US3 (P2)**: Depends on US1+US4 (external cron calls the sync API)

### Within Each User Story

1. Tests MUST be written and FAIL before implementation (Constitution I)
2. Implementation follows test guidance
3. Verification step confirms GREEN before moving on

### Parallel Opportunities

- **Phase 1**: T002, T003, T004 can all run in parallel (different files)
- **Phase 3**: T008, T009, T010 can all run in parallel (different test files)
- **Phase 5**: T020 can start immediately (test file, independent of implementation)
- **After Phase 2**: Phase 3 and Phase 5 can run in parallel (independent rendering paths)

---

## Parallel Example: Phase 3 (US1+US4)

```
# Launch all tests in parallel (RED phase):
T008: Contract test for sync API in tests/contract/sync-api.contract.spec.ts
T009: Contract test for Hemera course detail in tests/contract/hemera-courses.contract.spec.ts
T010: Unit test for runDataSync() in tests/unit/sync-orchestrator.spec.ts

# Then implement sequentially:
T011: runDataSync() in orchestrator.ts (core pipeline)
T012: Update route.ts (API surface)
T013: Rollbar logging (observability)
T014: Verify all GREEN
```

---

## Implementation Strategy

### MVP First (Phase 1 → 2 → 3)

1. Complete Phase 1: Setup (schemas, types, template)
2. Complete Phase 2: Foundational (selectNextCourse)
3. Complete Phase 3: US1+US4 (sync pipeline with participants)
4. **STOP and VALIDATE**: Run `POST /api/sync`, verify output HTML exists with participant data
5. Deploy if ready — this is a functional sync pipeline

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1+US4 → Test independently → **MVP deployed!**
3. Add US2 → Incremental sync saves I/O → Deploy
4. Add US5 → Homepage shows live data → Deploy
5. Add US3 → Cron scheduling documented → Deploy
6. Each story adds value without breaking previous stories

### Parallel Development Path

With capacity for two parallel tracks:

1. Both tracks complete Phase 1 + 2 together
2. Once Phase 2 is done:
   - **Track A**: Phase 3 (US1+US4 sync pipeline) → Phase 4 (US2 incremental)
   - **Track B**: Phase 5 (US5 homepage SSR)
3. Both tracks reconverge at Phase 6 (US3) and Phase 7 (polish)

---

## Notes

- **Cross-repo**: Hemera endpoint extension is a prerequisite for full integration (see Dependencies)
- **Constitution I**: Every user story phase starts with failing tests (RED → GREEN)
- **Constitution VII**: No database, no local state beyond output/ files and in-memory sync job
- **Convention**: Contract tests use `*.contract.spec.ts`, unit tests use `*.spec.ts`, E2E uses `*.spec.ts`
- **Commit granularity**: Commit after each task or logical group within a phase
