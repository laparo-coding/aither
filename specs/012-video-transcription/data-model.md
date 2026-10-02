# Data Model: Video Transcription

## Ownership

Durable workflow and participant-document metadata are owned by Hemera, the source of truth for bookings and participant identity. Aither does not add a database. Aither uploads the completed MP4 to private Vercel Blob staging, then deletes its local copy as soon as staging is confirmed. AssemblyAI reads from a short-lived staging URL; after transcript and role validation, MUX ingests from a separately issued staging URL. The final role-separated text document is a distinct private Vercel Blob object.

## Entities

### SeminarRecordingWorkflow (Hemera-persisted)

One record for one Aither recording and Hemera booking. The unique idempotency key is `(bookingId, recordingId)`.

| Field | Type | Rules |
|---|---|---|
| `id` | Hemera ID | Primary key, Hemera-generated |
| `bookingId` | string | Required; references the owning Hemera booking |
| `participantUserId` | string | Required; derived by Hemera from the booking, never trusted solely from Aither input |
| `recordingId` | string | Required; validated Aither recording session ID |
| `status` | enum | `queued`, `transcribing`, `transcript_ready`, `review_required`, `publishing`, `ready`, `retryable_failure`, `failed`, `deletion_pending`, `deleted` |
| `assemblyAiTranscriptId` | string or null | Set after AssemblyAI accepts the transcription job |
| `assemblyAiStatus` | string or null | Provider status; used only for reconciliation |
| `sourceBlobPathname` | string or null | Private staging pathname used for retry/review and provider ingestion; never a signed URL |
| `muxAssetId` | string or null | Set after MUX asset creation |
| `muxPlaybackId` | string or null | Signed-policy playback ID; never store a generated JWT or signed URL |
| `muxPlaybackUrl` | string or null | Stable MUX playback URL/reference sent directly to Hemera after upload; must not contain a signed token or bearer credential |
| `transcriptBlobPathname` | string or null | Private Blob pathname; never store a signed GET URL |
| `reviewedSpeakerMapping` | object or null | Operator-confirmed diarized speaker ID to role mapping |
| `reviewedBy` | string or null | Authorized Aither operator identity |
| `reviewedAt` | datetime or null | Review approval timestamp |
| `stageAttemptCounts` | object | Attempt count per provider stage; max 5 total attempts (initial plus retries) per stage |
| `assemblyAiCleanupStatus` | enum | `pending`, `complete`, `retryable_failure`, `not_required`; separate from participant-visible publication status |
| `sourceBlobCleanupStatus` | enum | `pending`, `complete`, `retryable_failure`, `not_required`; separate from participant-visible publication status |
| `deletionRequestedAt` | datetime or null | Set when the owning booking/participation is deleted; access is revoked immediately |
| `deletionReason` | enum or null | `booking_deleted`, `participation_deleted`, or `operator_abandoned`; identifies the idempotent cleanup intent |
| `recordingDate` | datetime | Original recording completion time |
| `queuedAt` | datetime | Set when Hemera persists the queued workflow; used to measure the first-provider-call objective |
| `firstProviderAttemptAt` | datetime or null | First actual provider call timestamp; omitted until a circuit-eligible call begins |
| `lastErrorCode` | string or null | Sanitized stable code; no credentials, transcript content, or raw provider payload |
| `createdAt`, `updatedAt` | datetime | Hemera-managed timestamps |

### WorkflowTraceEvent (Hemera-persisted)

Minimal append-only trace event retained only while its workflow exists. It records `workflowId`, optional provider request or transcript ID, prior and next status, event type, timestamp, sanitized error code, and operator identity when present. It MUST NOT store transcript text, raw callbacks, raw provider payloads, signed URLs, bearer tokens, or secrets.

### TranscriptDocument (Vercel Blob object)

Private UTF-8 `text/plain` object at a deterministic pathname such as `seminar-transcripts/{bookingId}/{recordingId}.txt`. The document contains chronological utterances with AssemblyAI timestamps where present and normalized role labels `Seminarleiter` and `Teilnehmerin`. Overlapping utterances remain separate, ordered by start time. The Blob object's returned URL is not an authorization reference; Hemera stores only its pathname.

### RecordingContext (Aither in-memory during capture)

| Field | Type | Rules |
|---|---|---|
| `bookingId` | string | Supplied when starting capture and validated through Hemera |
| `participantUserId` | string | Returned by Hemera booking lookup; not user-asserted |
| `recordingId` | string | Aither recording session ID |

The context is transient during capture. On successful stop, Aither creates the durable Hemera workflow and uploads the completed MP4 to private Blob staging before returning a queued result. If the Hemera API is unavailable, the local recording is retained only until the staging upload completes; the stop response reports that processing was not queued, and an enqueue retry can use the staged pathname later.

## Lifecycle

```text
queued -> transcribing -> transcript_ready -> publishing -> ready
                         \-> review_required -> publishing (operator-approved mapping)
transient provider failure (attempts < 5) -> retryable_failure -> prior incomplete stage
permanent provider failure or attempts exhausted -> failed (operator action required)
booking/participation deleted -> deletion_pending -> deleted
```

- Only `ready` records are listed to participants.
- `review_required` records retain the private staging pathname and transcript job reference but expose neither the MUX asset nor transcript to participants. An authorized operator must correct/confirm role mapping and retry publication using a fresh scoped staging URL.
- Automatic role publication requires a successful AssemblyAI Speaker Identification status, one-to-one mappings for both required roles, and a speaker ID for every utterance. Manual correction stores the exact mapping and operator identity before the workflow resumes.
- Each required role must have at least one utterance containing two or more visible characters after Unicode-whitespace normalization. Silence, a single detected speaker, shorter role content, or an ambiguous mapping enters `review_required` and cannot publish participant documents.
- An operator-approved mapping is authoritative. A duplicate or stale AssemblyAI callback after approval is traceable but cannot change the approved mapping, formatted transcript, or workflow status.
- Each transient workflow stage receives at most five total attempts, including the initial attempt. Retries use exponential backoff with jitter and honor provider `Retry-After`; permanent failures are not retried automatically.
- When the relevant provider circuit breaker is closed, the worker records its first actual provider call within five minutes of `queuedAt`; calls skipped while a breaker is open do not count as an attempt.
- A retry resumes from the first incomplete stage using stored provider references. It MUST NOT create a second MUX asset or transcript Blob when a successful earlier-stage reference already exists.
- After the workflow reaches `ready`, Aither deletes the AssemblyAI transcript and the private source-staging object. Cleanup retries are tracked separately and do not unpublish documents; the final transcript Blob object remains available.
- When Hemera deletes the booking/participation, it first revokes participant access and marks the workflow `deletion_pending`. Aither deletes any AssemblyAI transcript/source media, MUX asset, final and staging Blob objects, and any residual local recording artifact. Aither confirms cleanup only after every known existing artifact has a successful deletion or idempotent already-deleted confirmation. Hemera retains a non-visible tombstone only until that confirmation, then immediately purges the workflow, trace events, provider IDs, participant association, and tombstone. Repeated deletion requests are idempotent.
- Only an authorized Hemera administrator may abandon a `review_required` workflow. Hemera records `operator_abandoned` as the deletion reason, submits the same idempotent Aither cleanup flow, and purges the tombstone and trace immediately after confirmation.
- The local MP4 is temporary only for the duration of its private Blob staging upload. Retries and operator review use the staged object, which is deleted after MUX readiness, operator abandonment, or booking/participation deletion.
- Circuit-breaker state is transient and provider-specific within each worker process. A successful half-open probe resets the failure count and closes the circuit; a transient half-open failure reopens it for 30 seconds. A process restart resets the breaker; durable workflow references and stage counters remain in Hemera and allow recovery.

## Relationships and Authorization

- A `SeminarRecordingWorkflow` belongs to exactly one Hemera booking and one participant user derived from that booking.
- A booking may have multiple workflows over time, but `(bookingId, recordingId)` is unique.
- The Hemera participant page queries only `ready` workflows for the authenticated user's owned booking.
- Hemera verifies `booking.userId === authenticatedUser.id` before asking Aither to mint media access.
- MUX playback JWTs and Blob signed GET URLs are request-time bearer capabilities and MUST NOT be persisted or logged.