# Quickstart: Video Transcription

## Prerequisites

- Node.js 20.19+ and npm, matching the existing Aither runtime.
- An AssemblyAI account/API key with prerecorded transcription and Speaker Identification available.
- MUX API credentials plus a MUX signing key ID and private key. New seminar assets must use signed playback policy.
- A private Vercel Blob store and `BLOB_READ_WRITE_TOKEN` (or the dedicated `BLOB_READ_WRITE_TIMESTAMP_TOKEN`) for the Linux-hosted Aither service.
- Hemera service API changes for booking lookup, durable workflow state, participant document listing, and authorization.
- A publicly reachable HTTPS AssemblyAI webhook URL and an independent webhook secret.
- A macOS local development environment with the `security` CLI for Keychain integration.

## Configure Local Secrets

1. Move the existing AssemblyAI API key from `.env.local` into the macOS Keychain using the feature setup script. Do not print the key.
2. The local `.env.local` stores the Keychain service reference only:

   ```dotenv
   ASSEMBLY_AI_API_KEY_KEYCHAIN_SERVICE=assemblyai-aither-api-key
   ```

3. Set server-only `ASSEMBLY_AI_BASE_URL` to the API endpoint/region enabled for the active AssemblyAI Free-plan account. Verify the endpoint against the account before use; Aither has no automatic regional fallback.
4. Configure the AssemblyAI webhook URL and webhook secret, MUX signing-key values, Aither-Hemera service authentication, and Blob token in the local environment. Use distinct values per environment.
5. Production Linux uses a root-owned, permission-restricted systemd `EnvironmentFile=` outside the repository for `ASSEMBLY_AI_API_KEY`, `ASSEMBLY_AI_BASE_URL`, and other server-only values; it must not attempt to invoke macOS Keychain.

## Run the Workflow

1. Select a Hemera `bookingId` when starting the recording. Aither resolves the booking and participant identity through the authenticated Hemera Service API; it does not accept an unverified participant ID.
2. Stop a completed recording. Aither creates the idempotent Hemera workflow record, uploads the MP4 to private Vercel Blob staging, persists the staging pathname in Hemera, and deletes the local MP4 as soon as staging is confirmed. The existing MUX upload must not run at this stage.
3. The transcription worker issues AssemblyAI a fresh, scoped signed read URL for the staged MP4 and submits `speaker_labels: true` with role identification context. The job ID is persisted in Hemera. Do not use the AssemblyAI `/v2/upload` URL as MUX input; it is not documented as accessible to MUX.
4. AssemblyAI calls the authenticated Aither webhook on completion. The worker retrieves the transcript and automatically accepts role mapping only when Speaker Identification succeeded, both roles map to distinct speaker IDs, and every utterance has a speaker ID. Otherwise, the workflow waits on the protected Aither admin review page; a reviewer correction and approval are audited before publication resumes.
5. For a valid transcript, the worker issues a separate fresh scoped signed read URL to MUX for ingest from source staging. It immediately sends the stable MUX playback URL/reference and asset/playback IDs directly to Hemera, then stores the role-separated text as a separate private Blob object and idempotently marks the workflow `ready` with `bookingId`, participant ID, MUX references, and transcript pathname. The stable MUX reference contains no signed token. If a stage fails transiently, it resumes from the first incomplete stage using the private staged source and does not duplicate assets.
6. Hemera's `/my-courses/[bookingId]/nachbereitung` page checks that the authenticated user owns the booking, lists only ready documents, and requests fresh signed media links from Aither for the player and transcript. The Blob transcript URL is valid for exactly five minutes; the MUX token lasts at least through the video's duration.
7. After `ready` is persisted, Aither deletes the AssemblyAI transcript and the private source-staging object. Cleanup is retried independently and does not hide published assets; the final transcript Blob remains.
8. If a Hemera booking/participation is deleted, Hemera revokes access immediately and submits an idempotent deletion job. Aither deletes any AssemblyAI transcript/source media, MUX asset, final and staging Blob objects, and any residual local recording artifact; Hemera purges the tombstone only after deletion is confirmed.
9. Only a Hemera administrator may abandon a workflow in `review_required`. Hemera revokes access and submits the same idempotent cleanup request with reason `operator_abandoned`; it purges the workflow, tombstone, and trace immediately after Aither confirms cleanup.

Automatic publication additionally requires at least one utterance with two or more visible characters after Unicode-whitespace normalization for both roles. Silence, a single speaker, shorter role content, or an ambiguous mapping remains in `review_required`. An operator-approved mapping is authoritative; later duplicate or stale provider callbacks cannot overwrite it.

Transient workflow failures receive at most five total attempts per stage (initial attempt plus retries), with exponential backoff, jitter, and provider `Retry-After` support. Permanent failures are not retried automatically and require an authorized operator.
Transient workflow stages receive at most five actual provider calls (initial call plus retries), with exponential backoff, jitter, and provider `Retry-After` support. Each provider has an independent process-local circuit breaker: five consecutive transient failures within 60 seconds opens it for 30 seconds, then permits one half-open probe. Calls skipped while open do not consume a stage attempt. Permanent failures do not count toward opening the circuit and are not retried automatically.

## Validation

```bash
npm run typecheck
npm run test:unit
npm run test:contract
npm run test:e2e
npm run lint
npm run build
```

Focused tests should cover speaker-role mapping and ambiguity, authenticated/idempotent webhooks, MUX-before/after ordering, resuming partial publication without duplicate assets, Hemera booking ownership, and expiry/scope of both access links. E2E validation spans the Aither worker/API and the Hemera participant page and requires provider test credentials or deterministic provider mocks.

## Operational Checks

- Confirm Aither's transcription worker is enabled by the Linux systemd service and restarts after host reboot.
- Check that `.env.local` contains no plaintext AssemblyAI key and that production's AssemblyAI key is available only server-side.
- Confirm `ASSEMBLY_AI_BASE_URL` is enabled for the active account's Free plan and matches the intended data region; a missing or unapproved endpoint must fail closed rather than fall back.
- Verify the AssemblyAI webhook can reach Aither over HTTPS and that a bad webhook secret is rejected.
- Verify a MUX signed playback URL remains valid for at least the video duration; issue a new URL on a later page request.
- Verify transcript Blob objects are private and Hemera persists only the pathname, not a signed URL.
- Verify failures do not make partial workflows visible in Hemera and can be resumed by the worker.
- Alert when a workflow has no first provider call within five minutes of its queued timestamp while the relevant circuit breaker is closed.
- Confirm the minimal workflow trace contains only IDs, status transitions, timestamps, sanitized errors, and operator identity; it must contain no transcript text, raw payloads, URLs, or credentials.
- Confirm a successful deletion acknowledgment immediately purges the Hemera tombstone, workflow metadata, and trace records.
- Confirm Aither reports cleanup only after each known existing provider artifact has a successful or idempotent already-deleted result.
- Keep worker parallelism bounded and provider-conformant; measure start latency, but do not treat an unstated throughput or queue-length value as a release target.