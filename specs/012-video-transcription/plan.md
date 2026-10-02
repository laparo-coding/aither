# Implementation Plan: Video Transcription

**Branch**: `012-video-transcription` | **Date**: 2026-09-30 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/Users/Andreas/GitHub/aither/specs/012-video-transcription/spec.md`

## Summary

Aither validates a Hemera `bookingId` when recording starts. On successful recording completion, it creates an idempotent Hemera workflow, uploads the MP4 to private Vercel Blob source staging, persists that pathname in Hemera, and deletes the local MP4 after staging succeeds. A restart-safe worker submits a fresh scoped staging URL to AssemblyAI before MUX ingestion, requests diarization plus contextual Speaker Identification for `Seminarleiter` and `Teilnehmerin`, and requires at least one utterance with two or more visible characters after Unicode-whitespace normalization for each role before automatic publication.

Ambiguous, one-speaker, or insufficient-content results enter `review_required`: each role needs an utterance with at least two visible characters after Unicode-whitespace normalization. An authorized Aither operator can approve a corrected mapping; the approval is authoritative, so later or duplicate AssemblyAI callbacks cannot alter the mapping, transcript, or workflow state. For a valid or reviewed mapping, Aither provides MUX a separate signed source URL, transmits the stable non-bearer MUX playback reference directly to Hemera, writes the separate final private transcript Blob, and marks the workflow `ready` only after both participant assets are available.

Hemera owns durable state, audit trace, booking authorization, and participant listing. It retains workflow/provider IDs, status transitions with timestamps, and operator identity, but never transcript contents or complete provider payloads. When the booking or participation is deleted, Hemera revokes access, retains a tombstone only through provider cleanup, then immediately deletes all workflow metadata after Aither confirms cleanup. The worker starts the first provider call within five minutes of Hemera persisting a new workflow whenever no provider circuit breaker is open.

## Technical Context

**Language/Version**: TypeScript 5.9, Node.js 20.19+, Next.js 16 App Router, React 19
**Primary Dependencies**: `assemblyai` official JavaScript SDK; existing `@mux/mux-node`, `@vercel/blob` 2.6+, Zod, Hemera API client, Rollbar; `tsx` (dev only), Vitest, Playwright
**Storage**: Hemera Prisma database for workflow/audit/deletion metadata; MUX signed video; private Vercel Blob for temporary source staging and final transcript; no Aither database
**Testing**: Vitest unit/contract/integration tests; Playwright E2E; OpenAPI contract validation; Biome; TypeScript typecheck; production build
**Target Platform**: Aither Next.js service and standalone worker on Linux/systemd; macOS local development; Hemera Next.js participant site and service API
**Project Type**: Coordinated Aither and Hemera web-service feature
**Performance Goals**: First provider call within 5 minutes after Hemera persists a queued workflow when no circuit is open; AssemblyAI webhook acknowledgment below 10 seconds; bounded, provider-conformant worker parallelism without a fixed throughput target
**Constraints**: AssemblyAI before MUX; no Aither database or durable local queue; local MP4 deleted after source staging; no public MUX/Blob access; signed participant transcript URL expires after 5 minutes; MUX JWT covers full playback; five provider calls maximum per stage; provider circuit breakers open after five transient failures in 60 seconds for 30 seconds with one half-open probe; AssemblyAI endpoint explicitly approved for the active Free plan; production secrets arrive only through a root-protected systemd `EnvironmentFile=` outside the repository; existing 15-minute recording cap
**Scale/Scope**: One workflow per `(bookingId, recordingId)`; bounded worker concurrency; two-speaker diarization; one role-separated transcript per completed recording

## Constitution Check

**GATE RESULT: PASS** — Aither remains stateless and holds no local database or durable queue. The local MP4 exists only during private source staging. Hemera owns all durable workflow, audit, and authorization metadata. Generated MUX playback references are sent directly to Hemera and never retained locally.

| Principle | Status | Plan response |
|---|---|---|
| I. Test-First Development | PASS | Contract and unit tests precede each API/provider implementation; critical paths target at least 80% coverage. |
| II. Code Quality & Formatting | PASS | TypeScript strict mode, Biome, typecheck, and Trivy after dependency changes. |
| III. Feature Development Workflow | PASS | Spec, research, data model, OpenAPI contract, quickstart, and task plan are maintained together. |
| IV. Authentication & Security | PASS | Hemera authorizes booking ownership; service APIs and webhook authenticate; URLs/tokens and transcript text are excluded from logs and audit metadata. |
| V. Component Architecture | PASS | Aither review and Hemera document UI follow MUI/Hemera design, component tests, and WCAG 2.1 AA. |
| VI. Holistic Error Handling & Observability | PASS | Rollbar with sanitized context, retries, per-provider circuit breakers, durable state, and cleanup tombstones. |
| VII. Stateless Architecture | PASS | Hemera is the sole durable store; Aither persists no generated reference or workflow state locally. |
| VIII. HTML Playback & Video Recording | PASS | Existing capture is preserved; source stages privately, transcription precedes MUX, and MUX playback reference is passed to Hemera. |
| IX. Aither Control API | PASS | Booking, workflow, review, access, deletion, and callback boundaries are defined in OpenAPI. |
| X. Deployment & Linux Service | PASS | Linux worker uses protected environment secrets; macOS Keychain is local-only; worker resumes from Hemera state after restart. |

## Execution Flow

1. Aither validates a booking server-to-server at recording start and binds participant identity only from Hemera.
2. Stop creates or updates the idempotent Hemera workflow, stages the MP4 privately, persists its pathname, then deletes the local MP4.
3. The worker polls queued or resumable workflows, starts the first provider call within five minutes when no circuit is open, and issues a new scoped source URL to AssemblyAI.
4. AssemblyAI callbacks are authenticated wake-ups. The worker reads canonical Hemera state, ignores stale callbacks after operator approval, and validates role mapping plus one non-empty utterance per role.
5. Failed mapping, no speech, or one detected speaker enters `review_required`; an authorized operator's approved mapping is audit-recorded and cannot be overwritten by later callbacks.
6. The worker issues MUX a separate source URL, persists provider IDs in Hemera, hands the stable non-bearer playback reference directly to Hemera, then writes the final private transcript Blob and marks `ready`.
7. Participant access remains ready-only and booking-owned. Hemera requests fresh signed Aither URLs; it never retains bearer URLs or provider signing credentials.
8. After `ready`, Aither independently cleans up the AssemblyAI transcript and source staging. Provider cleanup failures do not unpublish documents.
9. Booking/participation deletion or Hemera-administrator abandonment of a `review_required` workflow revokes access and enqueues idempotent cleanup. Aither confirms cleanup only after every known artifact is deleted or idempotently confirmed already deleted; Hemera then immediately deletes the tombstone, IDs, status trace, operator identity, and all participant association metadata.

## Project Structure

### Documentation

```text
specs/012-video-transcription/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/seminar-recording-api.openapi.yaml
├── checklists/transcription.md
├── checklists/release-gate.md
└── tasks.md
```

### Aither Repository

```text
src/app/api/recording/start/route.ts
src/app/api/recording/stop/route.ts
src/app/api/assemblyai/webhook/route.ts
src/app/api/recording/transcription/[id]/review/route.ts
src/app/api/service/seminar-document-access/route.ts
src/app/api/service/seminar-recordings/[recordingId]/route.ts
src/lib/transcription/
src/lib/recording/mux-uploader.ts
src/lib/recording/source-staging.ts
src/lib/recording/transcript-blob.ts
scripts/transcription-worker.ts
deploy/systemd/aither-transcription-worker.service
tests/unit/
tests/contract/
```

### Hemera Repository

```text
prisma/schema.prisma
app/api/service/bookings/[bookingId]/route.ts
app/api/service/bookings/[bookingId]/seminar-recordings/[recordingId]/route.ts
app/api/service/seminar-recording-jobs/route.ts
app/api/admin/bookings/[id]/review/route.ts
app/api/admin/courses/[id]/route.ts
app/api/admin/courses/delete/route.ts
app/my-courses/[bookingId]/nachbereitung/page.tsx
components/participation/SeminarRecordingDocuments.tsx
tests/contracts/
tests/e2e/
```

**Structure Decision**: Aither provides recording, provider adapters, webhook, review, signing, and a standalone worker. Hemera owns relational workflow/audit state, booking lifecycle, authorization, and participant UI. The OpenAPI contract is the integration boundary; no Aither-local database or queue is permitted.

## Progress Tracking

- [x] Clarifications recorded, including deletion, transcript validity, stale callback, worker SLO, and audit-trace decisions.
- [x] Phase 0 research covers AssemblyAI roles, idempotency, source staging, signed access, cleanup, endpoint configuration, and circuit breakers.
- [x] Phase 1 data model, OpenAPI contract, and quickstart exist and are aligned with the workflow.
- [x] Phase 2 task plan is dependency-ordered and test-first.
- [x] Data model, OpenAPI contract, quickstart, and tasks synchronized with FR-023 through FR-025.
- [x] Release gate passed: all 30 checklist criteria in `checklists/release-gate.md` are covered.
- [ ] Implement per `tasks.md`, starting with contract tests T001/T002.

## Complexity Tracking

| Complexity | Justification | Simpler alternative rejected because |
|---|---|---|
| Restart-safe worker | Transcription outlives requests and must resume after host/process restart. | Request-bound or in-memory processing loses work. |
| Hemera-owned workflow/audit state | Hemera owns booking authorization and is Aither's required durable store. | Aither persistence violates Constitution VII. |
| Private source staging | AssemblyAI must complete before MUX while local MP4 retention is prohibited. | AssemblyAI upload URL is not documented as MUX-accessible. |
| Coordinated Aither/Hemera changes | Lifecycle spans recording, providers, authorization, and deletion. | An Aither-only implementation cannot enforce booking ownership or participant visibility. |