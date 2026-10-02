# Tasks: Video Transcription

**Input**: Design documents from `/Users/Andreas/GitHub/aither/specs/012-video-transcription/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/seminar-recording-api.openapi.yaml`, `quickstart.md`
**Tests**: TDD is mandatory per Aither Constitution Principle I. Tests are written first, confirmed to fail, and then implemented. New critical paths target at least 80% coverage.

**Organization**: Tasks are dependency-ordered and grouped by user story. Hemera file paths are absolute because those implementation tasks must run in the sibling repository `/Users/Andreas/GitHub/hemera`.

## Format: `[ID] [P?] [Story] Description`

- `[P]`: Work may proceed in parallel after listed dependencies, touching independent files.
- `[US1]`: Transcribe a completed recording and identify both speakers.
- `[US2]`: Publish and securely display the video and transcript.
- `[US3]`: Review, retry, cleanup, and deletion lifecycle.

## Phase 1: Contract Tests (Blocking)

**Purpose**: Define expected behavior through failing contracts before changing either service.

- [x] T001 [P] Add failing Aither contract tests for Hemera booking lookup, idempotent workflow create/update, queued-job listing, deletion-job listing/acknowledgment, and expected service authentication/status codes in `tests/contract/recording/seminar-recording-hemera-api.contract.spec.ts`.
- [x] T002 [P] Add failing Hemera contract tests for booking ownership resolution, workflow upsert uniqueness `(bookingId, recordingId)`, five-attempt per-stage cap, first-provider-call timestamp, `review_required`, ready-only listing, minimal sanitized trace events, immediate metadata purge after confirmed deletion, administrator-only operator abandonment, and deletion tombstones in `/Users/Andreas/GitHub/hemera/tests/contracts/seminar-recording-workflow-api.spec.ts`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Define and test the cross-repository contract and durable Hemera state before Aither relies on it.

### Setup

- [x] T003 [P] Add non-secret `ASSEMBLY_AI_BASE_URL`, AssemblyAI Keychain service-reference, webhook-secret, MUX signing-key, and Blob configuration names with descriptions to `.env.example`; document root-owned systemd `EnvironmentFile=` provisioning outside the repository for production; do not set an implicit region fallback or include credential values.
- [x] T004 Add the official `assemblyai` SDK and `tsx` runtime dependency, lockfile updates, and a `transcription:worker` npm script in `package.json`; immediately run Codacy Trivy analysis and resolve dependency findings before any other task.

### Tests First

### Hemera Foundation

- [x] T005 Add the Prisma `SeminarRecordingWorkflow` and minimal `WorkflowTraceEvent` models, unique `(bookingId, recordingId)` constraint, queued/first-provider-attempt timestamps, per-stage attempt counters, AssemblyAI cleanup status, review audit fields, asset references, and non-visible deletion tombstone fields in `/Users/Andreas/GitHub/hemera/prisma/schema.prisma`; create and validate the migration (depends on T002, T004).
- [x] T006 Implement authenticated booking lookup in `/Users/Andreas/GitHub/hemera/app/api/service/bookings/[bookingId]/route.ts`, workflow GET/PUT in `/Users/Andreas/GitHub/hemera/app/api/service/bookings/[bookingId]/seminar-recordings/[recordingId]/route.ts`, and oldest-first job listing in `/Users/Andreas/GitHub/hemera/app/api/service/seminar-recording-jobs/route.ts` (depends on T005).
- [x] T007 Add request/response validation to `/Users/Andreas/GitHub/hemera/app/api/service/bookings/[bookingId]/route.ts`, `/Users/Andreas/GitHub/hemera/app/api/service/bookings/[bookingId]/seminar-recordings/[recordingId]/route.ts`, and `/Users/Andreas/GitHub/hemera/app/api/service/seminar-recording-jobs/route.ts`; derive `participantUserId` from the booking, enforce state/ownership, and only return `ready` workflows to participants (depends on T006).

**Checkpoint**: Hemera owns durable workflow state and API contract tests pass.

### Shared Aither Infrastructure

**Purpose**: Add validated workflow primitives, secure configuration, and testable provider adapters.

### Tests First

- [x] T008 [P] Add failing unit tests for workflow schemas, state transitions, one-to-one speaker mapping, per-role utterances with at least two visible characters after Unicode-whitespace normalization, overlapping-speech utterance ordering and `review_required` fallback, authoritative operator approval, stale callback rejection, and `review_required` fallback in `tests/unit/lib/transcription/workflow.spec.ts`.
- [x] T009 [P] Add failing unit tests for a per-stage maximum of five actual provider calls, transient-only exponential backoff with jitter, honoring `Retry-After`, immediate escalation of permanent failures, and provider-specific circuit-breaker open/half-open/closed behavior, including reset after a successful probe and a 30-second reopen after a transient failed probe, in `tests/unit/lib/transcription/retry-policy.spec.ts`.
- [x] T010 [P] Add failing unit tests for deterministic private source-staging and transcript paths, scoped provider read URLs, UTF-8 role-labelled content, timestamp ordering, five-minute participant signed GET expiry, stable MUX reference handoff without bearer tokens, and MUX token expiry at least the video duration in `tests/unit/lib/recording/transcript-blob.spec.ts` and `tests/unit/lib/recording/mux-uploader-signed.spec.ts`.
- [x] T011 [P] Add failing tests for AssemblyAI key resolution from a macOS Keychain service reference versus production Linux `ASSEMBLY_AI_API_KEY`, validation of configured `ASSEMBLY_AI_BASE_URL`, explicit SDK `baseUrl` use, rejection of missing/unapproved endpoints without fallback, and no secret exposure. *(Module `config-assemblyai.ts` removed — key is now referenced directly via `ASSEMBLY_AI_API_KEY` in `.env.local`.)*

### Implementation

- [x] T012 Add Zod request/response schemas and types for booking context, workflow state, AssemblyAI callback, operator review, media-access response, and deletion jobs in `src/lib/transcription/schemas.ts` and `src/lib/transcription/types.ts`; extend `src/lib/config.ts` to validate `ASSEMBLY_AI_BASE_URL`, the AssemblyAI key (`ASSEMBLY_AI_API_KEY`), webhook secret, MUX signing key ID/private key, and existing Blob credentials with feature-use guards and no automatic region fallback (depends on T003, T004, T008-T011).
- [x] T013 Implement server-only AssemblyAI API-key resolution via `ASSEMBLY_AI_API_KEY` from `.env.local` / host EnvironmentFile; *(Keychain resolution module removed — key is stored directly in environment variable.)* (depends on T003, T011).
- [x] T014 Implement the pure role-mapping validator and transcript formatter in `src/lib/transcription/role-mapping.ts` and `src/lib/transcription/transcript-formatter.ts`; preserve utterance order/timestamps, keep overlapping utterances separate in start-time order, and reject missing, repeated, or unmapped speaker IDs (depends on T008, T012).
- [x] T014a [P] Implement private source-staging pathname generation, scoped signed provider-read URL issuance, and idempotent source cleanup in `src/lib/recording/source-staging.ts`; never expose staging objects to participant listings (depends on T010, T012).

**Checkpoint**: Contract and pure-domain tests pass; secrets and provider dependencies are configured without exposing credentials.

## Phase 3: User Story 1 — Transcribe Completed Recordings (Priority: P1)

**Goal**: Submit a completed seminar MP4 to AssemblyAI, diarize speakers, request contextual role identification, and route uncertain results to review before MUX upload.

**Independent Test**: Stop a recording with a valid Hemera booking and verify an AssemblyAI job is queued, persisted, callback-authenticated, and mapped or marked for review; verify MUX has not been called.

### Tests First

- [x] T015 [P] [US1] Add failing AssemblyAI adapter tests for private staging URL submission (without local MP4 or AssemblyAI-upload URL reuse), `speaker_labels: true`, expected two-speaker bounds, contextual `Seminarleiter`/`Teilnehmerin` descriptions, authenticated completion webhook configuration, transcript fetch, delete, provider errors, and status handling in `tests/unit/lib/transcription/assemblyai-client.spec.ts`.
- [x] T016 [P] [US1] Add failing route contract tests proving stop queues only after successful recording completion, requires validated booking context, retains local file when Hemera is unavailable, and never calls MUX before successful transcript/mapping in `tests/contract/recording/transcription-start-stop.contract.spec.ts`.
- [x] T017 [P] [US1] Add failing webhook contract tests for valid/invalid secret, duplicate and delayed callbacks before approval, stale callbacks after operator approval, callback with provider error, under-10-second acknowledgment, sanitized delivery trace, and worker recovery after missed webhook in `tests/contract/recording/assemblyai-webhook.contract.spec.ts`.
- [x] T018 [P] [US1] Add failing mapping tests for exact two-role one-to-one mapping, unmapped utterance, same speaker assigned to both roles, missing speaker, empty role content, one detected speaker, failed identification, and operator-required review in `tests/unit/lib/transcription/role-mapping.spec.ts`; add review-route tests for admin authorization, persisted correction audit, rejection of same-ID mappings, and explicit approval in `tests/contract/recording/transcription-review.contract.spec.ts`.

### Implementation

- [x] T019 [US1] Extend recording-start request/session context to require `bookingId`, resolve participant identity through Hemera, and avoid trusting a caller-supplied participant ID in `src/app/api/recording/start/route.ts` and `src/lib/recording/session-manager.ts` (depends on T006, T012, T016).
- [ ] T020 [US1] On successful recording stop, idempotently create the Hemera workflow, upload the MP4 to deterministic private Blob staging, delete the local MP4 after staging confirmation, and return a queued result; if Hemera cannot be reached, retain only the staged object for an explicit enqueue/retry path and schedule idempotent source cleanup in `src/app/api/recording/stop/route.ts` (depends on T006, T016). **[PARTIAL]** — Staging order needs fix: persist workflow BEFORE deleting local MP4; error handling for Hemera unreachable.
- [x] T021 [US1] Implement the official AssemblyAI JavaScript SDK adapter in `src/lib/transcription/assemblyai-client.ts` using configured `ASSEMBLY_AI_BASE_URL` and private staged-media URLs for asynchronous submission, authenticated webhook metadata, transcript fetch, and transcript deletion; do not silently fall back to a different endpoint or reuse an AssemblyAI-upload URL as MUX input (depends on T004, T012, T013, T015).
- [x] T022 [US1] Implement the Aither worker in `scripts/transcription-worker.ts`: poll Hemera for queued/retryable workflows, claim/reconcile by idempotency key, stage completed recordings before deleting local MP4s, record the first actual provider attempt within five minutes of queueing when the circuit is closed, enforce per-stage five-call policy and provider-specific circuit breakers, honor `Retry-After`, and resume only incomplete stages after restart (depends on T006, T009, T014a, T021).
- [ ] T023 [US1] Implement authenticated AssemblyAI webhook handling in `src/app/api/assemblyai/webhook/route.ts`; persist the callback signal, acknowledge quickly, and treat duplicate/missed callbacks idempotently (depends on T017, T021, T022). **[PARTIAL]** — Webhook auth verification may need strengthening.
- [x] T024 [US1] Implement transcript retrieval and automatic mapping acceptance criteria; set `review_required` on any failed status, missing role, same-ID mapping, unmapped utterance, one-speaker result, or empty role content; preserve an operator-approved mapping against later callbacks; and prevent MUX calls until mapping is approved in `src/lib/transcription/workflow.ts` (depends on T014, T018, T022).
- [ ] T025 [US1] Implement authenticated Aither admin review page and review route in `src/app/recording/transcription/[id]/review/page.tsx` and `src/app/api/recording/transcription/[id]/review/route.ts`; authorize admin, display transcript utterances and failed-stage details, validate distinct speaker IDs, persist mapping/reviewer/timestamp to Hemera, and resume publication or retry only after explicit approval (depends on T005, T012, T018, T024). **[PARTIAL]** — Review route needs workflow load, status check, validation, and persist via upsertWorkflow.

**Checkpoint**: Completed recordings transcribe first; automatic publishing obeys the explicit mapping threshold and uncertain mappings remain private for admin review.

## Phase 4: User Story 2 — Publish and Privately Display Documents (Priority: P1)

**Goal**: Publish a signed MUX video and private transcript, associate both with the participant booking, and display them only in the participant's Hemera after ownership verification.

**Independent Test**: For an approved workflow, verify MUX signed policy and private Blob writes, Hemera `ready` state, participant booking isolation, five-minute transcript URL, and MUX URL valid through playback.

### Tests First

- [x] T026 [P] [US2] Add failing MUX tests asserting signed playback policy, remote staged-URL input, returned asset/playback IDs and stable playback reference handoff without a bearer token, full-video JWT expiry, idempotency/reconciliation after uncertain upload timeout, and asset deletion in `tests/unit/lib/recording/mux-uploader-signed.spec.ts`.
- [x] T027 [P] [US2] Add failing Blob tests asserting private access, deterministic `(bookingId, recordingId)` path, content type/text format, five-minute `presignUrl` expiry, no stored access URL, deletion, and idempotent overwrite in `tests/unit/lib/recording/transcript-blob.spec.ts`.
- [x] T028 [P] [US2] Add failing Hemera page/API and component tests verifying authenticated booking ownership, ready-only listing, player/transcript rendering states, fresh Aither access request, distinct URL expiries, accessibility, and no access to another user's booking in `/Users/Andreas/GitHub/hemera/tests/contracts/seminar-recording-documents.spec.ts`, `/Users/Andreas/GitHub/hemera/tests/unit/components/participation/SeminarRecordingDocuments.spec.tsx`, and `/Users/Andreas/GitHub/hemera/tests/e2e/seminar-recording-documents.spec.ts`.

### Implementation

- [x] T029 [US2] Update `uploadToMux` in `src/lib/recording/mux-uploader.ts` to ingest from a scoped private Blob staging URL, create signed-policy assets, and return `muxAssetId`, stable MUX playback URL/reference, and signed `muxPlaybackId`; transmit the stable reference directly to Hemera and never persist or transmit a bearer token as the stable reference (depends on T026).
- [x] T030 [US2] Implement private Vercel Blob transcript write, deterministic pathname, scoped five-minute signed GET creation, and delete helper in `src/lib/recording/transcript-blob.ts` (depends on T027).
- [ ] T031 [US2] Update `scripts/transcription-worker.ts` to persist each provider reference in Hemera before continuing, ingest MUX from a fresh staged-media URL and hand off the stable playback reference directly to Hemera, write the final transcript Blob, set Hemera `ready` only after both are confirmed, and delete the AssemblyAI transcript/source staging as independent cleanup stages (the local MP4 was deleted after staging) (depends on T014a, T021, T022, T029, T030). **[PARTIAL]** — Needs main entry point, SIGTERM handling, per-job error catching, and Stage 2 failure handling.
- [ ] T032 [US2] Implement Aither service-only media access endpoint in `src/app/api/service/seminar-document-access/route.ts`; require Hemera service auth, verify booking/recording match and `ready`, mint a MUX JWT valid through video duration and a five-minute Blob URL, and exclude URLs/tokens from logs (depends on T026, T027, T029, T030). **[PARTIAL]** — Currently returns placeholder success; must return 501 until fully implemented.
- [x] T033 [US2] Implement ready-only participant document fetching and authenticated server-side access issuance in `/Users/Andreas/GitHub/hemera/app/my-courses/[bookingId]/nachbereitung/page.tsx`; verify booking ownership before returning any access data (depends on T005, T028).
- [x] T034 [US2] Add the player and role-separated transcript UI in `/Users/Andreas/GitHub/hemera/components/participation/SeminarRecordingDocuments.tsx`, following MUI/Hemera design tokens, WCAG 2.1 AA, loading/empty/error states, and no caching of signed URLs beyond their expiry (depends on T033).
- [x] T035 [P] [US2] Add Playwright E2E coverage for authorized participant playback/transcript, other-participant denial, refresh obtaining fresh URLs, five-minute Blob expiry metadata, and MUX playback expiry at/after full media duration in `/Users/Andreas/GitHub/hemera/tests/e2e/seminar-recording-documents.spec.ts` (depends on T032-T034).

**Checkpoint**: Participant sees both assets on the existing Hemera page only after authorized booking ownership and successful publication.

## Phase 5: User Story 3 — Recovery, Retention, and Deletion (Priority: P1)

**Goal**: Recover from partial provider failures without duplicates, clean up AssemblyAI data, and remove published assets when Hemera deletes the booking/participation.

**Independent Test**: Inject a failure after MUX success, retry the workflow and verify no duplicate MUX asset; then delete the booking and verify immediate access revocation and eventual removal of MUX/Blob assets.

### Tests First

- [x] T036 [P] [US3] Add failing integration tests for each partial failure point (AssemblyAI submit/fetch/delete, MUX success/timeout, Blob failure, Hemera ready failure), asserting stored references are reused and only incomplete stages are retried in `tests/contract/recording/transcription-recovery.contract.spec.ts`.
- [x] T037 [P] [US3] Add failing tests for exactly five total attempts per transient stage, `Retry-After`, jitter/backoff scheduling, no auto-retry for permanent errors, and operator escalation in `tests/unit/lib/transcription/retry-policy.spec.ts`.
- [x] T038 [P] [US3] Add failing deletion-lifecycle tests for booking rejection in `/Users/Andreas/GitHub/hemera/tests/contracts/admin-booking-review.spec.ts` and course cascade deletion in `/Users/Andreas/GitHub/hemera/tests/e2e/admin-course-delete.spec.ts`; assert immediate access revocation, idempotent tombstone creation, repeat delivery, per-artifact successful-or-already-deleted cleanup confirmation, and immediate tombstone/workflow/trace purge after confirmation.

### Implementation

- [ ] T039 [US3] Implement separate AssemblyAI transcript and source-staging cleanup statuses and deletion retries in `src/lib/transcription/cleanup.ts` and `scripts/transcription-worker.ts` so cleanup occurs only after Hemera `ready`, cleanup failure never reruns transcription or hides published documents, and booking deletion also removes both Blob objects (depends on T031, T036). **[PARTIAL]** — Cleanup stage separation needs verification.
- [x] T040 [US3] Implement Hemera tombstone creation and cleanup-job enqueue before booking deletion in `/Users/Andreas/GitHub/hemera/app/api/admin/bookings/[id]/review/route.ts` and before course cascade deletion in `/Users/Andreas/GitHub/hemera/app/api/admin/courses/[id]/route.ts` and `/Users/Andreas/GitHub/hemera/app/api/admin/courses/delete/route.ts`; add an administrator-only `review_required` abandonment flow; immediately revoke access, retain provider references only until Aither confirms cleanup, then immediately purge the tombstone, workflow, and trace records (depends on T005, T038).
- [ ] T041 [US3] Implement Aither service-authenticated deletion endpoint in `src/app/api/service/seminar-recordings/[recordingId]/route.ts`; idempotently delete any AssemblyAI transcript/source media, MUX asset, private Blob object, and local recording artifact, report partial outcomes, and acknowledge completion to Hemera only when provider deletion is confirmed (depends on T021, T029, T030, T040). **[PARTIAL]** — Needs ownership verification, workflow load, conditional 200/202 response.
- [x] T042 [US3] Add sanitized Rollbar stage/error reporting and Hemera minimal trace-event persistence in `src/lib/transcription/workflow.ts` and `src/app/api/assemblyai/webhook/route.ts`, including IDs, status transitions, timestamps, and operator identity while excluding transcript text, raw payloads, signed URLs, AssemblyAI/MUX/Blob tokens, and raw secrets (depends on T022-T041).

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Finalize documentation, security, observability, and cross-service operational readiness.

- [x] T043 [P] Validate OpenAPI YAML, Aither/Hemera request/response/state/auth compatibility against `contracts/seminar-recording-api.openapi.yaml`, and verify the deployment's `ASSEMBLY_AI_BASE_URL` is enabled for the active Free-plan account before enabling the worker.
- [x] T044 [P] Document local macOS Keychain setup and production Linux secret resolution in `specs/012-video-transcription/quickstart.md`; verify the variable names match `.env.example` from T003 and that no key value is included.
- [x] T045 [P] Add `deploy/systemd/aither-transcription-worker.service` with restart-on-failure behavior; ensure the worker can resume from Hemera state after process/host restart.
- [x] T046 Run `npm run typecheck`, focused Vitest unit/contract suites, Playwright E2E in both Aither and Hemera, `npm run lint`, `npm run build`, and coverage gates defined in `package.json`; verify new critical-path coverage is at least 80%, the five-minute first-provider-call objective, stale callback immunity after approval, and metadata purge after deletion confirmation (depends on all prior tasks).
- [x] T047 Run `scripts/coverage-gate.sh`, confirm the 80% critical-path gate, run Codacy Trivy after dependency changes, and verify no secret, transcript text, or signed access URL appears in logs or committed files (depends on T004, T046).

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: Existing project configuration and dependencies; no project scaffolding is needed.
- **Foundational (Phase 2)**: Depends on Setup; Hemera data/API and Aither shared contracts block all user stories. Dependency installation is followed immediately by Trivy.
- **Phase 3 (US1)**: Depends on Phase 2; no MUX/participant publication work may precede validated transcript and role mapping.
- **Phase 4 (US2)**: Depends on approved US1 output; Hemera page remains gated on `ready` and booking ownership.
- **Phase 5 (US3)**: Recovery uses the persisted states and references established by US1/US2.
- **Phase 6**: Final checks depend on all implementation and cross-repository work.

### Parallel Opportunities

- T001/T002 (contract tests), T008-T011, T015-T018, T026-T028, T036-T038, and T043-T045 are parallelizable where marked `[P]`.
- T003 environment documentation can proceed independently of T001/T002. T004 dependency installation is a security gate: run Trivy immediately afterward before any other task proceeds.
- Hemera model task T005 begins after the Hemera contract test T002; service/API tasks T006-T007 are sequential and gate worker implementation.
- Aither MUX and Blob adapters (T029-T030) can proceed in parallel after their tests.
- Hemera participant display (T033-T034) can proceed once workflow contracts exist; browser tests depend on both Hemera page and Aither media-access endpoint.

## Implementation Strategy

1. Complete Setup and the test-first Hemera durable workflow/API foundation.
2. Add dependencies only after tests/design; run the mandatory Trivy scan immediately after install.
3. Implement the recording-to-AssemblyAI path and role review before enabling MUX.
4. Implement signed MUX/private Blob publication and Hemera ready-only UI.
5. Add per-stage recovery and deletion lifecycle, then run cross-repository E2E and security checks.

## Notes

- All Aither-relative paths are relative to `/Users/Andreas/GitHub/aither`; Hemera paths are absolute and must be implemented in the sibling repository.
- `[P]` indicates independent work after dependencies; TDD test tasks must fail before implementation.
- No Aither database is permitted. Hemera stores durable states; local MP4 files remain temporary artifacts only.
