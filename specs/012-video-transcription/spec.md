# Feature Specification: Video Transcription

**Feature Branch**: `012-video-transcription`
**Created**: 2026-09-29
**Status**: Draft
**Input**: User description: "After a seminar video is recorded, transcribe it with AssemblyAI, separate the participant and seminar leader transcript streams, then store the video in MUX and the transcript in Vercel Blob, associated with the participant's user ID for display in their private Hemera document space."

## Overview

After a seminar recording is complete, Aither MUST stage the recorded video in a private Vercel Blob object, then submit a scoped read of that object to AssemblyAI for transcription and speaker diarization before ingesting it into MUX. Once AssemblyAI has completed the transcript, Aither MUST create the MUX asset and save a role-separated transcript text document to a separate private Vercel Blob object. The participant's user ID MUST be associated with the recording, MUX asset, and transcript so Hemera can show the documents in that participant's private seminar document space.

To avoid holding the completed MP4 locally during asynchronous transcription or operator review, Aither stages it temporarily in a private, non-participant-visible Vercel Blob object. AssemblyAI and, only after role validation, MUX ingest it from separately scoped signed reads. This source staging object is distinct from the final transcript document and is removed after MUX readiness or workflow abandonment/deletion.

The seminar participant is always a woman and the seminar leader is always a man. The transcript MUST present their speech as distinct participant and seminar-leader streams rather than exposing only AssemblyAI's anonymous speaker labels. This specification covers speaker-attributed transcription; isolated audio stems are not requested.

## Clarifications

### Session 2026-09-29

- Q: Wie soll Aither AssemblyAIs Sprecher-IDs zuverlässig den Rollen „Teilnehmerin“ und „Seminarleiter“ zuordnen? → A: Der Seminarleiter beginnt mit der Begrüßung und die Teilnehmerin antwortet; ordne die Sprecher anhand dieser Gesprächsrollen und des Kontexts zu. Keine automatische Geschlechtserkennung aus der Stimme; unsichere Zuordnungen gehen in die Operator-Prüfung.
- Q: Wie sollen die Dokumentreferenzen sicher in Hemeras privatem Teilnehmerbereich gelangen? → A: Aither übermittelt Teilnehmer-ID und beide Dokumentreferenzen an die Hemera-API; Hemera verwaltet Anzeige und Zugriff.
- Q: Wie soll der Zugriff auf Video und Transkript selbst geschützt werden, wenn Hemera die Dokumente anzeigt? → A: Hemera zeigt Videoplayer und Texttranskript auf der bestehenden Seite `/my-courses/[bookingId]/nachbereitung` und stellt nach der Berechtigungsprüfung kurzlebige Zugriffslinks bereit.
- Q: Welche Hemera-ID soll Aither zusätzlich zur Teilnehmer-ID mitsenden, damit Aufnahme und Transkript auf der richtigen Nachbereitungsseite erscheinen? → A: Hemera-`bookingId`.
- Q: Wer soll eine als `review_required` markierte Sprecherzuordnung prüfen und freigeben? → A: Ein autorisierter Operator in Aither korrigiert die Rollenzuordnung vor der Veröffentlichung.
- Q: Wie lange soll Aither die bei AssemblyAI gespeicherten Aufnahme- und Transkriptionsdaten behalten, nachdem MUX und Vercel Blob erfolgreich befüllt wurden? → A: Den AssemblyAI-Transcript-Datensatz nach erfolgreicher Veröffentlichung löschen; die Quelldatei wird über einen kurzlebigen Lesezugriff aus privatem Blob-Staging bereitgestellt und anschließend separat aus dem Staging gelöscht.
- Q: Wie soll ein autorisierter Aither-Operator die Sprecherzuordnung im Status `review_required` prüfen und korrigieren? → A: Über eine geschützte Review-Seite im Aither-Adminbereich.
- Q: Welche Bedingung erlaubt die automatische Veröffentlichung der Sprecherzuordnung? → A: AssemblyAI meldet Speaker Identification als erfolgreich, beide Rollen sind eindeutig verschiedenen Sprecher-IDs zugeordnet und alle Äußerungen haben eine Sprecher-ID; andernfalls `review_required`.
- Q: Wie soll Aither nach einem Teilfehler fortfahren, zum Beispiel wenn MUX erfolgreich war, aber der Blob-Upload scheiterte? → A: Erfolgreiche Stufen behalten und nur fehlende Stufen idempotent wiederholen; bis `ready` nicht anzeigen.
- Q: Wie lange soll ein kurzlebiger Vercel-Blob-Link zum Transkript gültig sein? → A: 5 Minuten.
- Q: Wie lange sollen Video und Transkript nach erfolgreicher Veröffentlichung verfügbar bleiben? → A: Bis Buchung oder Teilnahme in Hemera gelöscht wird; dann beide Dokumente gemeinsam löschen.
- Q: Wie viele automatische Versuche soll Aither pro fehlgeschlagener Workflow-Stufe ausführen? → A: 5 Versuche insgesamt pro Stufe, mit exponentiellem Backoff, Jitter und Beachtung von `Retry-After`; permanente Fehler gehen direkt an den Operator.
- Q: Welche Verarbeitungsregion soll Aither für AssemblyAI verwenden? → A: Die Region und der API-Endpunkt, die der aktive AssemblyAI-Free-Plan für dieses Konto verfügbar macht; kein kostenpflichtiges Regionsupgrade und kein automatischer Regionswechsel.
- Q: Welche Aufbewahrungsfrist gilt nach dem Löschen einer Hemera-Buchung für MUX-Video, finalen Blob-Transkript und Hemera-Workflow-Metadaten? → A: Sofort löschen, sobald die Provider-Cleanup-Bestätigung vorliegt.
- Q: Welches Kriterium macht einen AssemblyAI-Transkriptionslauf vor der Rollenprüfung grundsätzlich gültig? → A: Mindestens je eine nicht-leere Äußerung für beide Rollen.
- Q: Wie sollen neue AssemblyAI-Ergebnisse behandelt werden, wenn ein Operator die Sprecherzuordnung bereits freigegeben hat? → A: Ignorieren; die freigegebene Zuordnung bleibt unverändert.
- Q: Welches maximale Zeitfenster ist für den Start eines neu eingereihten Transkriptionsjobs vorgesehen, sofern kein Provider-Circuit-Breaker offen ist? → A: Innerhalb von 5 Minuten.

### Session 2026-09-29 (Traceability)

- Q: Welche Nachvollziehbarkeit soll für einen Workflow in Hemera mindestens gespeichert werden? → A: IDs, Statuswechsel, Zeitstempel und verantwortlicher Operator.

### Session 2026-09-30

- Q: Wie werden Produktionsgeheimnisse für den Linux/systemd-Dienst bereitgestellt? → A: Durch eine root-geschützte `EnvironmentFile=` außerhalb des Repositorys; die Datei hat restriktive Berechtigungen und wird nicht versioniert.
- Q: Wer darf einen Workflow in `review_required` endgültig abbrechen? → A: Nur ein Hemera-Administrator. Hemera erteilt Aither einen idempotenten Bereinigungsauftrag und löscht Workflow und Trace unmittelbar nach dessen Bestätigung.
- Q: Wann ist eine Äußerung für eine Rolle nicht leer? → A: Nach Unicode-Whitespace-Normalisierung muss sie mindestens zwei sichtbare Zeichen enthalten.
- Q: Wann darf Aither Hemera eine abgeschlossene Bereinigung bestätigen? → A: Erst wenn jedes vorhandene Provider-Artefakt erfolgreich gelöscht ist oder der Provider idempotent bestätigt, dass es bereits gelöscht war.
- Q: Gilt zusätzlich zur Fünf-Minuten-Startvorgabe ein numerischer Durchsatz- oder Warteschlangengrenzwert? → A: Nein. Die Parallelität bleibt begrenzt und providerkonform; der konkrete Durchsatz wird gemessen und bei Bedarf später festgelegt.

## User Scenarios & Testing

### User Story 1 - Transcribe a Completed Seminar Recording (Priority: P1)

As a seminar operator, I want each completed seminar recording transcribed with its speakers distinguished, so that the participant's and seminar leader's words are available separately.

**Acceptance Scenarios**:

1. **Given** a seminar recording has completed and has a participant user ID, **When** transcription begins, **Then** Aither submits a scoped read of the private staged video to AssemblyAI with speaker diarization enabled and does not ingest the video into MUX first.
2. **Given** AssemblyAI completes transcription, **When** the result is processed, **Then** the transcript separates utterances into the participant and seminar-leader streams and preserves the utterance order and any timestamps returned by AssemblyAI.
3. **Given** transcription has not completed successfully, **When** the recording workflow runs, **Then** the video is not uploaded to MUX and no transcript is presented as complete.
4. **Given** a provider stage fails after one or more earlier stages succeeded, **When** the workflow is retried, **Then** Aither resumes at the first incomplete stage using the already-persisted references, does not create duplicate assets, and Hemera does not show the documents until the workflow reaches `ready`.

### User Story 2 - Store and Associate Seminar Documents (Priority: P1)

As a participant, I want my transcribed seminar video and transcript available in my private Hemera document space, so that I can review the recording and what was said.

**Acceptance Scenarios**:

1. **Given** AssemblyAI has completed a valid transcript, **When** post-transcription processing runs, **Then** Aither ingests the staged video into MUX for playback and stores a separate text document containing both role-separated transcript streams in Vercel Blob.
2. **Given** the video and transcript have been stored, **When** their references are persisted, **Then** both are associated with the participant user ID and Hemera booking ID for the seminar recording.
3. **Given** the video and transcript have been stored, **When** Aither notifies Hemera, **Then** Aither sends the participant user ID, Hemera booking ID, MUX video reference, and Vercel Blob transcript reference to the Hemera API through an authenticated server-to-server request.
4. **Given** a participant opens `/my-courses/[bookingId]/nachbereitung` in Hemera, **When** their seminar documents are loaded, **Then** Hemera displays the recording in a video player and the transcript as text, only for a booking owned by that participant.

### User Story 3 - Review, Recover, and Retire Seminar Documents (Priority: P1)

As an authorized seminar operator, I want uncertain speaker mappings and failed workflow stages to be safely reviewable and resumable, so that participants never receive mislabeled or incomplete documents and retained media is removed when its booking ends.

**Acceptance Scenarios**:

1. **Given** Speaker Identification fails or cannot meet the automatic mapping criteria, **When** the transcript is processed, **Then** the workflow enters `review_required`, no MUX upload or participant listing occurs, and an authorized Aither operator can correct the speaker IDs and explicitly approve the mapping through the protected review page.
2. **Given** a transient workflow stage fails after an earlier stage succeeded, **When** the worker retries, **Then** it makes at most five total attempts for that stage, honors `Retry-After`, resumes from the first incomplete stage, and creates no duplicate assets or workflow records.
3. **Given** Hemera marks the workflow `ready`, **When** post-publication cleanup runs, **Then** Aither deletes the AssemblyAI transcript and private source-staging object; cleanup failure is retried independently and does not hide published documents.
4. **Given** the associated Hemera booking or participation is deleted, **When** the deletion lifecycle starts, **Then** Hemera revokes participant access immediately, Aither deletes the MUX asset and Blob transcript idempotently, and Hemera retains the non-visible tombstone until cleanup is confirmed.

## Functional Requirements

- **FR-001**: When a seminar recording completes, Aither MUST stage it in private Vercel Blob, submit a scoped read of that staged object to AssemblyAI for transcription, and only then ingest the staged object into MUX. Transcription MUST begin only after the recording stop is confirmed successful; a failed or interrupted recording MUST NOT create a Hemera workflow, stage a source object, or be submitted to any provider.
- **FR-002**: Aither MUST use AssemblyAI Speaker Diarization (`speaker_labels: true`) and produce a transcript with speaker-attributed utterances. The resulting generic speaker labels MUST be mapped to seminar roles separately; diarization itself MUST NOT be treated as gender detection.
- **FR-003**: The transcript document MUST expose separate role-specific text streams for the participant and the seminar leader. In addition to diarization, Aither MUST use AssemblyAI Speaker Identification with contextual role descriptions: the seminar leader opens with a greeting and the participant replies. The known gender invariant may inform review but MUST NOT be treated as automatic voice-gender detection. Raw AssemblyAI speaker IDs MUST NOT be assumed to identify roles by themselves.
- **FR-004**: Automatic publication is allowed only when AssemblyAI Speaker Identification reports success, the two required roles map one-to-one to distinct diarized speaker IDs, every utterance has a speaker ID, and each role has at least one utterance containing two or more visible characters after Unicode-whitespace normalization. If any condition fails, including no detected speech, only one detected speaker, or a mapping conflict with the known roles, the system MUST set the workflow to `review_required`. An authorized Aither operator MUST review and resolve the speaker-to-role mapping through a protected Aither admin review page before publication; the system MUST NOT publish incorrectly attributed or incomplete speech.
- **FR-005**: Aither MUST NOT upload the seminar video to MUX until AssemblyAI has reported transcription as complete and Aither has received a valid transcript result.
- **FR-006**: After successful transcription, Aither MUST transfer the recorded video to MUX for later playback.
- **FR-007**: After successful transcription, Aither MUST store a text document containing the role-separated transcript in Vercel Blob. The document MUST preserve utterance ordering and include timestamps when supplied by AssemblyAI.
- **FR-008**: The recording, MUX video reference, and Vercel Blob transcript reference MUST be associated with both the participant's user ID and the Hemera `bookingId` for the seminar. After both assets are stored, Aither MUST transmit the participant user ID, Hemera `bookingId`, and both document references to the Hemera API through an authenticated server-to-server request.
- **FR-009**: Hemera MUST own the listing and access control for these documents and integrate them into the existing participant page `/my-courses/[bookingId]/nachbereitung` (`app/my-courses/[bookingId]/nachbereitung/page.tsx`). The page MUST display the seminar video in a player and the transcript as text, and MUST prevent participants from accessing another participant's documents.
- **FR-010**: The AssemblyAI API key MUST be stored in the macOS Keychain for local development. `.env.local` MUST contain a Keychain reference, not the plaintext key; the application or its startup environment MUST resolve that reference before making server-side AssemblyAI requests. The key MUST NOT be exposed to the browser or written to logs.
- **FR-011**: If AssemblyAI transcription fails or is incomplete, the recording MUST remain available for retry and MUST NOT be uploaded to MUX by this workflow. Failed or incomplete transcript and storage operations MUST NOT be shown in Hemera as completed documents.
- **FR-012**: After verifying that the authenticated participant owns the requested booking, Hemera MUST provide a Vercel Blob transcript access link that expires after 5 minutes and a MUX signed playback token that remains valid for at least the full video duration. Hemera MUST NOT expose long-lived or public asset URLs as the document access-control mechanism; fresh links MUST be issued after a new booking-ownership check.
- **FR-013**: After MUX, the final private Vercel Blob transcript, and Hemera publication have all succeeded, Aither MUST delete the AssemblyAI transcript and temporary private Blob source object. If either cleanup fails, Aither MUST retry cleanup independently without rerunning transcription or hiding already-published Hemera documents.
- **FR-014**: The Aither admin review page MUST restrict review and role-mapping changes to authorized operators. A workflow in `review_required` MUST remain unavailable to the participant until an authorized operator confirms the corrected role mapping and releases it for publication. That approved mapping is authoritative; later or duplicate AssemblyAI callbacks for the same workflow MUST be ignored without changing the mapping, transcript, or workflow status.
- **FR-015**: A transcript MUST NOT be automatically published if the speaker-identification status is not successful, if both roles do not map to distinct speaker IDs, if either role has no utterance containing two or more visible characters after Unicode-whitespace normalization, or if any utterance lacks a speaker ID. These cases, including no speech or only one detected speaker, MUST enter `review_required`.
- **FR-016**: If a workflow stage fails after earlier provider stages succeeded, Aither MUST retain and reuse the successful stage references and idempotently retry only the first incomplete stage. A retry MUST NOT create duplicate MUX assets, Blob documents, or Hemera workflow records. Hemera MUST keep the documents unavailable to the participant until all required stages have completed and the workflow is `ready`.
- **FR-017**: The MUX video, private Blob transcript, and Hemera workflow references MUST remain available while the associated Hemera booking/participation exists. When Hemera deletes that booking/participation, it MUST revoke participant access immediately and mark the workflow `deletion_pending`. Aither MUST delete all existing associated AssemblyAI transcript/source-media, MUX, Blob, and local recording artifacts. Hemera MUST retain a non-visible tombstone until provider cleanup is confirmed, then remove the workflow references. Deletion retries MUST NOT restore participant access.
- **FR-018**: Aither MUST make at most five total attempts per workflow stage, including the initial attempt. Transient failures MUST be retried with exponential backoff and jitter, respecting provider `Retry-After` values. Permanent failures MUST NOT be retried automatically and MUST be surfaced for authorized operator action.
- **FR-019**: The local recording MUST exist only long enough to upload it to private Vercel Blob staging. After staging upload is confirmed, Aither MUST delete the local MP4. Automatic retries and operator review MUST use the private staging object, which MUST be deleted after MUX is ready, when a Hemera administrator abandons the workflow under FR-027, or when the Hemera booking/participation is deleted.
- **FR-020**: Aither MUST use a server-only, per-environment `ASSEMBLY_AI_BASE_URL` set to an AssemblyAI API endpoint available to the active account's Free plan. The endpoint MUST be confirmed during deployment/configuration; Aither MUST NOT silently fall back to a different region or require a paid region upgrade.
- **FR-021**: After recording completes, Aither MUST upload the MP4 to a private Vercel Blob staging path and use separately scoped, short-lived read URLs from that object for AssemblyAI and, only after role validation, MUX ingestion. The staging object MUST NOT be listed as participant material and MUST be deleted after MUX readiness, Hemera-administrator abandonment under FR-027, or booking/participation deletion.
- **FR-022**: Each external provider integration MUST have an independent circuit breaker. Within one process, five consecutive transient failures within 60 seconds MUST open that provider's circuit for 30 seconds; after that, allow one half-open probe. A successful half-open probe MUST reset the consecutive-failure count and close the circuit; a transient half-open failure MUST reopen it for 30 seconds. Permanent client errors MUST NOT count toward opening the circuit. An open circuit MUST pause calls to that provider and leave affected workflows resumable without marking them `ready` or discarding provider references.
- **FR-023**: After a booking or participation deletion, Hemera MUST permanently remove the non-visible workflow tombstone and all remaining workflow metadata immediately after Aither confirms deletion of the associated provider artifacts. Aither MUST provide that confirmation only after every provider artifact known to exist is deleted successfully or the corresponding provider idempotently confirms that it was already deleted. Hemera MUST NOT retain a post-cleanup record of the MUX video, final transcript Blob, source-staging Blob, AssemblyAI transcript, or participant association.
- **FR-024**: When no provider circuit breaker is open, the Aither worker MUST begin the first provider call for a newly queued transcription workflow within 5 minutes after Hemera has persisted the workflow. This start-time objective excludes time spent waiting for an open provider circuit, provider-request retries, and operator review. Worker parallelism MUST remain bounded and provider-conformant; this feature defines no fixed throughput or queue-length target.
- **FR-025**: Hemera MUST retain, while the workflow exists, its workflow and provider IDs, each status transition with timestamp, and the identity of an operator who approves or changes a role mapping. Hemera MUST NOT retain full provider payloads, transcript content, signed URLs, bearer tokens, or credentials in this trace. This trace MUST be deleted with the workflow under FR-023.
- **FR-026**: In production, the Linux systemd service MUST receive server-only secrets through a root-owned, permission-restricted `EnvironmentFile=` outside the repository. This file MUST NOT be versioned, exposed to browser code, or written to logs.
- **FR-027**: Only an authorized Hemera administrator MAY abandon a workflow in `review_required`. Hemera MUST revoke participant access, send Aither an idempotent cleanup request identified as operator abandonment, and immediately purge the workflow, tombstone, and trace after Aither confirms provider cleanup. An abandonment MUST NOT restore participant access.
- **FR-028**: Aither MUST authenticate AssemblyAI callbacks and process duplicate, delayed, or missed callback delivery idempotently against the canonical Hemera workflow. Before operator approval, a callback may advance only its matching incomplete workflow stage once; duplicate or stale delivery MUST otherwise leave the mapping, formatted transcript, and workflow status unchanged. After operator approval, callbacks MUST follow FR-014. Callback-delivery trace entries MUST contain only the fields permitted by FR-025.
- **FR-029**: The transcript document MUST be UTF-8 plain text with chronological utterances, normalized role labels `Seminarleiter` and `Teilnehmerin`, and AssemblyAI timestamps where supplied; utterances without timestamps MUST still appear in chronological order. Overlapping speech MUST be preserved as separate diarized utterances in start-time order without merging; if overlap prevents an unambiguous role mapping, the workflow MUST enter `review_required`.

## Constraints & Open Design Points

- AssemblyAI speaker labels identify diarized speakers, not the product roles, and the service does not provide automatic voice-gender detection. If contextual Speaker Identification cannot reliably map the opening greeting to the seminar leader and the reply to the participant, the workflow MUST be held for an authorized Aither operator to resolve rather than published with guessed role attribution.
- The Keychain reference format and the mechanism that resolves it for the Aither server process MUST be defined in the implementation plan. The reference MUST identify the Keychain item without containing the secret itself.
- Production secrets are supplied through a root-owned, permission-restricted systemd `EnvironmentFile=` outside the repository.
- AssemblyAI region availability depends on the account plan. The configured `ASSEMBLY_AI_BASE_URL` MUST be confirmed against the account before deployment; public vendor documentation does not define one universal Free-plan region. The pre-recorded API's documented default host is global, so it MUST NOT be assumed to satisfy a particular residency policy without account confirmation.
- The transcript output is speaker-attributed text; producing isolated participant and leader audio tracks is out of scope unless requested separately.