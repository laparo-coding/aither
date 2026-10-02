# Research: Video Transcription

**Feature**: `012-video-transcription`
**Date**: 2026-09-29

## R1: AssemblyAI Transcription and Speaker Roles

**Decision**: Use the official AssemblyAI JavaScript SDK (`assemblyai`) server-side. Upload the completed MP4 to private Vercel Blob staging, delete the local copy as soon as that upload is confirmed, and submit an asynchronous transcript job using a short-lived signed read URL to the staged object. Set `speaker_labels: true` and request Speaker Identification with the roles `Seminarleiter` and `Teilnehmerin` plus contextual descriptions. Configure an authenticated webhook and fetch the full transcript by transcript ID when the callback reports completion.

**Rationale**: Diarization segments utterances and assigns generic labels such as `A` and `B`; it does not detect gender. The separate Speaker Identification feature can infer supplied roles from conversational context. The seminar leader's opening greeting and the participant's reply are relevant context, but voice gender is not a supported classification signal. Webhooks avoid holding an API route open while the transcription runs. Their payload only carries transcript ID and status, so Aither must fetch the transcript result itself.

**Failure policy**: A completed transcript is eligible for publication only when its diarized utterances and role-identification result provide a valid mapping for both roles. A missing/failed mapping, one detected speaker, or an ambiguous short greeting/response puts the workflow in `review_required`; do not publish mislabeled text or upload the video to MUX. AssemblyAI recommends at least 30 seconds of uninterrupted speech per speaker for better diarization accuracy; this is a quality guideline, not a guarantee.

**Alternatives considered**:
- Infer roles solely from the first two diarization labels: rejected because label ordering is not role identity and brief initial turns can be unreliable.
- Infer gender from the voice: rejected because AssemblyAI documents no gender classification output for diarization.
- Synchronously call `transcribe()` from the upload route: rejected because it holds the request open and does not provide a durable, restart-safe workflow.

**Sources**:
- https://www.assemblyai.com/docs/speech-to-text/speaker-diarization
- https://www.assemblyai.com/docs/speech-understanding/speaker-identification
- https://www.assemblyai.com/docs/pre-recorded-audio/webhooks
- https://www.assemblyai.com/docs/getting-started/transcribe-an-audio-file

## R2: Asynchronous Workflow State and Recovery

**Decision**: Persist one idempotent seminar-recording workflow record in Hemera, keyed by `bookingId` and `recordingId`. Aither updates its status and provider identifiers through the authenticated Hemera Service API. AssemblyAI's authenticated webhook advances the workflow; duplicate callbacks and explicit retries re-read the canonical Hemera record and resume only missing steps.

**Rationale**: Aither is a Linux-hosted, stateless service and has no local database. Process memory or a Next.js request cannot safely represent long-running work across restarts. Hemera already owns bookings and participant access; making it the durable source of truth also lets its private participant page show only complete documents. The new Hemera provider API and Prisma model are a cross-repository dependency and must be implemented with this consumer contract.

**Alternatives considered**:
- Keep the job only in memory: rejected because service restarts lose it and webhooks cannot recover it.
- Add a local database or file-backed job queue to Aither: rejected by Constitution VII (no local database; Hemera is the source of truth).
- Poll AssemblyAI synchronously in the upload endpoint: rejected due to request lifetime and service restart behavior.

## R3: Ordered Publication, Idempotency, and Partial Failure

**Decision**: Enforce the sequence `recording complete -> private Blob source staging -> delete local MP4 -> AssemblyAI submit -> role validation -> signed-policy MUX ingest from source staging -> direct MUX playback-reference transmission to Hemera -> private Vercel Blob transcript -> Hemera ready -> delete AssemblyAI transcript and source staging`. Use a stable key derived from the validated Hemera `bookingId` and Aither `recordingId`; upsert the Hemera workflow with that key. Persist each successful provider reference in Hemera before attempting the next stage. Retry transient errors at most five total provider calls per workflow stage, including the initial call, with exponential backoff and jitter while respecting provider `Retry-After` headers. Permanent failures are not retried automatically and are surfaced to an authorized operator. A provider-specific process-local circuit breaker opens after five consecutive transient failures in 60 seconds, stays open for 30 seconds, then permits one half-open probe; a call skipped because the circuit is open does not consume a stage attempt. Never mark Hemera `ready` until both participant documents are stored.

**Rationale**: MUX, Vercel Blob, and Hemera do not share a transaction. A persisted per-stage record prevents an ordinary retry from uploading duplicate assets and allows the workflow to resume after a process restart. AssemblyAI has webhook redelivery, but callbacks are not a substitute for idempotent processing. MUX public playback IDs would bypass participant authorization, so new assets use signed playback policy.

**Alternatives considered**:
- Upload to MUX before transcription: rejected by FR-001/FR-005 and would publish an incomplete workflow.
- Delete successful external artifacts whenever a later provider fails: rejected as the default because compensating deletes may also fail; retain and resume using the persisted references, while keeping Hemera documents non-visible until ready.
- Treat a successful HTTP response as exactly-once delivery: rejected because network timeouts can leave an unknown result; reconcile by stable operation identifiers before retrying creation.

**Post-publication cleanup**: Delete the AssemblyAI transcript and private source-staging object after Hemera has persisted the `ready` workflow. A failure in either cleanup stage is retried independently and does not take already-published documents offline. The source-staging object is distinct from the final participant transcript.

**Circuit-breaker behavior**: Circuit state is maintained independently for each provider and is process-local. Successful provider calls reset the consecutive-failure count; permanent client errors do not count as transient failures. When open, the worker pauses calls to that provider and leaves workflows resumable. Process restart resets only the breaker state, not Hemera's workflow references or stage attempt counts.

## R8: Temporary Source Staging and Direct MUX Reference Handoff

**Decision**: Use a private, deterministic Vercel Blob staging pathname as the shared source for AssemblyAI and MUX. Issue separate short-lived signed GET URLs scoped to that object for each provider; never reuse the participant's five-minute transcript URL. After MUX ingest, transmit the stable MUX playback URL/reference directly to Hemera along with the asset/playback IDs, without storing it locally in Aither. The stable reference contains no signed JWT or bearer credential; Hemera still verifies booking ownership and requests fresh signed playback access before participant delivery. Delete source staging after MUX readiness, abandonment, or booking deletion.

**Rationale**: AssemblyAI's `/v2/upload` media URL is documented as accessible only to AssemblyAI and therefore cannot be assumed to work as a MUX input. MUX asset creation accepts a remote `inputs[].url`, so a separately scoped private Blob read URL can serve as its source. Private Vercel Blob staging also allows retries and operator review without retaining the local MP4.

**Sources**:
- https://www.assemblyai.com/docs/api-reference/files/upload
- https://www.mux.com/docs/api-reference/video/assets/create-asset
- https://vercel.com/docs/vercel-blob/private-storage
- https://vercel.com/docs/vercel-blob/vercel-signed-urls

**Sources**:
- https://www.mux.com/docs/guides/secure-video-playback
- https://www.mux.com/docs/api-reference/video/assets/create-asset
- https://vercel.com/docs/vercel-blob/private-storage
- https://vercel.com/docs/vercel-blob/vercel-signed-urls

## R4: Private Media Access Across Aither and Hemera

**Decision**: Store transcripts in a private Vercel Blob store and create MUX assets with a signed playback policy. Hemera first validates that the authenticated user owns the requested booking, then calls an authenticated Aither service endpoint to issue short-lived access: a MUX playback JWT and a Vercel Blob signed `get` URL. Aither retains the MUX signing key and Blob credentials; Hemera never receives those signing credentials or stores the generated URLs.

**Rationale**: Hemera is the user-facing authorization boundary, while Aither already owns the MUX and Blob credentials. This keeps provider signing keys in one service and avoids sending public or long-lived URLs. MUX playback JWT expiry must exceed the full video duration to prevent playback interruption; Blob transcript URLs can use a short read window. Signed URLs are bearer capabilities until expiry and MUST NOT be logged or persisted.

**Alternatives considered**:
- Hemera signs the MUX and Blob URLs itself: rejected because it requires distributing Aither's provider signing credentials or Blob read/write credentials to Hemera.
- Serve all media bytes through Hemera: rejected for video because proxying HLS segments adds bandwidth and latency; Blob SDK streaming remains an option if signed Blob URL issuance is unavailable.
- Public MUX playback or public Blob URLs: rejected because possession of the URL would bypass booking ownership checks.

**Sources**:
- https://www.mux.com/docs/guides/secure-video-playback
- https://vercel.com/docs/vercel-blob/private-storage
- https://vercel.com/docs/vercel-blob/vercel-signed-urls

## R5: Transcript Storage Format and Lifecycle

**Decision**: Generate a deterministic UTF-8 plain-text document in Vercel Blob, with timestamped utterances in chronological order and role labels `Seminarleiter` / `Teilnehmerin`. Store the Blob pathname, not its access URL, in Hemera. The Hemera workflow record also owns the MUX asset ID and signed playback ID. A failed stage remains retryable and is not shown as a completed document. Published video/transcript remain available while the associated Hemera booking or participation exists. Deleting that booking/participation immediately revokes access and starts cleanup of any AssemblyAI transcript/source media, MUX asset, private Blob object, and local recording artifact; Hemera retains a non-visible tombstone until provider cleanup is confirmed.

**Rationale**: Plain text is portable and directly displayable on the existing Hemera page. A deterministic path plus idempotent overwrite prevents duplicate transcript documents when retrying. Stable references can be safely re-authorized into fresh short-lived links on each page load.

**Alternatives considered**:
- Store a public Blob URL: rejected because it is not an authorization boundary.
- Store only AssemblyAI's transcript ID: rejected because Hemera needs a stable document reference and must not require AssemblyAI credentials to display it.
- Store the complete transcript body in Hemera: rejected as unnecessary duplication; Hemera stores metadata and Aither-owned Blob pathname.

## R6: API-Key Handling

**Decision**: Add an Aither AssemblyAI Keychain setup helper following the existing OpenRouter/Rollbar scripts. For macOS local development, `.env.local` contains `ASSEMBLY_AI_API_KEY_KEYCHAIN_SERVICE=assemblyai-aither-api-key`; server-only code resolves the item using the macOS `security` command. Production runs on Linux and therefore receives `ASSEMBLY_AI_API_KEY` from the host's protected `.env`/secret provisioning; a macOS Keychain reference is not used there. The secret is never exposed to browser code or logs.

**Rationale**: macOS Keychain is only available on the development host; the Constitution explicitly deploys this app to a Linux systemd service. Requiring Keychain resolution in production would make the service undeployable. This separates developer secret handling from the existing host-managed production environment variables while preserving the requested local `.env.local` reference.

**Alternatives considered**:
- Put the plaintext AssemblyAI key in `.env.local`: rejected by FR-010.
- Attempt to use the macOS Keychain from the Linux systemd service: rejected because the platform has no macOS Keychain.
- Add a general secret-manager dependency: rejected as outside the existing deployment model.

**Operational prerequisite**: Move the currently configured local key into Keychain and replace its plaintext `.env.local` value with the service reference before implementation testing. Do not print or commit the secret.

## R7: AssemblyAI Region and Free-Plan Endpoint

**Decision**: Configure the asynchronous AssemblyAI API base URL through server-only `ASSEMBLY_AI_BASE_URL`. Before deployment, confirm that the exact endpoint is enabled for the account's active Free plan. Do not silently fall back to the global endpoint or switch regions after an endpoint error.

**Rationale**: The feature uses the prerecorded asynchronous `/v2/upload`, `/v2/transcript`, and transcript deletion APIs. AssemblyAI's prerecorded examples use `https://api.assemblyai.com`; its deletion reference documents `https://api.eu.assemblyai.com` for EU-hosted transcripts. The public documentation reviewed does not state a universal region entitlement for all Free-plan accounts. A deploy-time account check is therefore required rather than inferring a region from the plan name. The TypeScript SDK client base URL is configurable.

**Alternatives considered**:
- Hardcode the EU endpoint: rejected because EU availability on the active Free plan is not documented as universal.
- Silently fall back to the global/default endpoint: rejected because this could change data residency without operator approval.
- Use the synchronous transcription API's regional endpoint: rejected because it has different duration/feature limits and is not the asynchronous prerecorded workflow selected for this feature.

**Sources**:
- https://www.assemblyai.com/docs/getting-started/transcribe-an-audio-file
- https://www.assemblyai.com/docs/api-reference/transcripts/delete
- https://www.assemblyai.com/docs/api-reference/overview

## R9: Clarified Retention, Validity, Callback, and Audit Rules

**Decision**: Aither may publish only a transcript containing at least one non-empty utterance for each required role. Silence, a single detected speaker, or empty role content enters `review_required`. An operator-approved mapping is authoritative; later or duplicate AssemblyAI callbacks are recorded only as sanitized delivery events and cannot change the mapping, transcript, or workflow state. The worker must make its first provider call within five minutes after Hemera persists a new workflow when the relevant circuit breaker is closed. Hemera retains a minimal trace while the workflow exists: workflow/provider IDs, status transitions, timestamps, sanitized error codes, and operator identity. It never retains signed URLs, credentials, raw provider payloads, or transcript content. After Aither confirms deletion of all provider artifacts, Hemera immediately purges the tombstone and all associated workflow metadata.

**Rationale**: These rules make participant-visible documents meaningful, prevent a delayed callback from undoing an informed review decision, expose operational accountability without duplicating personal content, and enforce the requested zero-retention outcome after cleanup.

**Alternatives considered**:
- Retain a deleted workflow as an audit record: rejected because the retention decision requires immediate metadata purge after confirmed cleanup.
- Accept a role mapping with empty content: rejected because a label without a substantive utterance is not a usable participant transcript.
- Apply every completed callback to the current workflow: rejected because callbacks can be duplicate or stale after an operator decision.