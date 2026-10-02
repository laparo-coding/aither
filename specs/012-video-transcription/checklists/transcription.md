# Requirements Checklist: Video Transcription

**Purpose**: Validate the completeness, clarity, consistency, and testability of the video-transcription requirements before task breakdown.
**Created**: 2026-09-29
**Feature**: [spec.md](../spec.md)

## Requirement Completeness

- [x] CHK001 Is the event that starts transcription specified precisely, including how a successfully completed recording is distinguished from a failed or interrupted recording? [Completeness, Spec §FR-001]
- [x] CHK002 Are the required workflow states and allowed transitions from recording completion through transcript review, publication, and provider cleanup defined in the specification? [Completeness, Spec §FR-001, §FR-013, Gap]
- [x] CHK003 Are the participant identity, Hemera `bookingId`, recording identity, and uniqueness relationship specified consistently for every stored document reference? [Completeness, Spec §FR-008]
- [x] CHK004 Is the transcript document's required structure specified, including role labels, ordering, timestamps, encoding, and behavior when timestamp data is absent? [Completeness, Spec §FR-007, §FR-029]

## Requirement Clarity

- [x] CHK005 Is “valid transcript result” defined with objective minimum conditions, such as non-empty text, required utterances, and successful speaker-identification status? [Clarity, Spec §FR-004, §FR-005, §FR-015]
- [x] CHK006 Are the criteria for accepting or rejecting AssemblyAI's contextual mapping from diarization labels to `Seminarleiter` and `Teilnehmerin` unambiguous? [Clarity, Spec §FR-003, §FR-004]
- [x] CHK007 Is the permitted lifetime of each “short-lived” MUX and Blob access link specified numerically, while also allowing MUX playback to finish? [Clarity, Spec §FR-012, Gap]
- [x] CHK008 Does the specification state what an authorized Aither operator may change during manual review and what action constitutes approval for publication? [Clarity, Spec §FR-014, Gap]

## Requirement Consistency

- [x] CHK009 Do the AssemblyAI-before-MUX ordering requirements remain consistent across the overview, user scenarios, and all functional requirements? [Consistency, Spec §FR-001, §FR-005, §FR-006]
- [x] CHK010 Are Hemera's responsibilities for booking authorization, participant display, and access links consistent with Aither's responsibilities for provider assets and signing? [Consistency, Spec §FR-008, §FR-009, §FR-012]
- [x] CHK011 Is the rule to delete AssemblyAI data after publication consistent with retaining retry/review data until publication is complete? [Consistency, Spec §FR-004, §FR-011, §FR-013]

## Acceptance Criteria Quality

- [x] CHK012 Can acceptance scenarios objectively establish that no MUX asset exists before AssemblyAI completion and successful role validation? [Measurability, Spec §FR-001, §FR-005]
- [x] CHK013 Can acceptance criteria distinguish `review_required`, `ready`, and post-publication cleanup failure without relying on subjective judgments? [Acceptance Criteria, Spec §FR-004, §FR-013, §FR-014, Gap]
- [x] CHK014 Are successful publication and participant visibility tied to a measurable condition that both the video and transcript references are available and associated with the correct booking? [Measurability, Spec §FR-008, §FR-009]

## Scenario Coverage

- [x] CHK015 Are requirements defined for no speech, only one detected speaker, overlapping speech, and a missing or failed role-identification result? [Coverage, Spec §FR-004, §FR-015, §FR-029]
- [x] CHK016 Are authenticated webhook success, failure, duplicate delivery, delayed delivery, and missed callback recovery addressed as requirements rather than only design details? [Coverage, Spec §FR-011, Gap]
- [x] CHK017 Are booking-not-found, participant/booking mismatch, and unauthorized access cases explicitly covered? [Coverage, Spec §FR-008, §FR-009, §FR-012, Gap]

## Edge Case Coverage

- [x] CHK018 Are stage-specific partial failures specified for MUX success followed by Blob failure, Blob success followed by Hemera failure, and uncertain provider outcomes after timeouts? [Coverage, Spec §FR-011, Gap]
- [x] CHK019 Are source-recording retention and retry/deletion behavior specified when Hemera is unavailable immediately after recording stops? [Edge Case, Spec §FR-011, Gap]
- [x] CHK020 Does the AssemblyAI deletion requirement specify retry behavior, terminal cleanup status, and whether cleanup failures are visible to operators without unpublishing completed documents? [Edge Case, Spec §FR-013, Gap]

## Non-Functional Requirements

- [x] CHK021 Are throughput, queue delay, and recovery-time expectations quantified for the transcription worker and provider rate limits? [Performance, Spec §FR-022, §FR-024]
- [x] CHK022 Are privacy, regulatory, and retention requirements defined for the final MUX recording, private Blob transcript, and Hemera metadata after AssemblyAI cleanup? [Security/Privacy, Spec §FR-017, §FR-023, §FR-025]
- [x] CHK023 Are secret-resolution requirements distinct and complete for local macOS Keychain use and the production Linux service environment? [Security, Spec §FR-010, Gap]

## Dependencies & Assumptions

- [x] CHK024 Are external-service assumptions documented for AssemblyAI upload limits, diarization quality, webhook availability, MUX signed playback configuration, and private Blob access? [Dependency, Spec §FR-002, §FR-012, §FR-021; Research §R1, §R4, §R7, §R8]
- [x] CHK025 Is the Hemera service contract for booking lookup, workflow persistence, operator review, document listing, and access-link issuance defined with compatible request/response requirements? [Dependency, Spec §FR-008, §FR-009, §FR-014, Gap]

## Ambiguities & Conflicts

- [x] CHK026 Does the specification define how operator corrections are associated with the transcript and prevent a stale AssemblyAI result from overwriting an approved mapping? [Clarity, Spec §FR-014, §FR-028]
- [x] CHK027 Is an identifier and traceability scheme defined so each workflow requirement can be linked to its acceptance criteria and Hemera contract? [Traceability, Spec §FR-008, §FR-009, §FR-025; Contract; Tasks]

## Recovery & Retention Quality

- [x] CHK028 Is local MP4 retention clearly bounded to retry/review, with explicit deletion conditions after `ready` and operator abandonment? [Clarity, Consistency, Spec §FR-011, §FR-019]
- [x] CHK029 Are retry semantics objectively clear about five total attempts per stage, retryable versus permanent errors, and the operator action required after exhaustion? [Measurability, Spec §FR-018]
- [x] CHK030 Are cleanup requirements complete for AssemblyAI source/transcript, MUX asset, private Blob object, local MP4, and Hemera tombstone when a booking or participation is deleted? [Completeness, Coverage, Spec §FR-017, Gap]
- [x] CHK031 Are post-publication AssemblyAI cleanup failures explicitly distinguished from publication failures, including retry ownership and participant visibility? [Consistency, Edge Case, Spec §FR-013]

## Recently Approved Decisions

- [x] CHK032 Is private Vercel Blob source staging explicitly separated from the final transcript object, excluded from participant listings, and bounded by deletion after MUX readiness, abandonment, or booking deletion? [Completeness, Clarity, Spec §FR-019, §FR-021]
- [x] CHK033 Are AssemblyAI and MUX required to receive separate, freshly scoped short-lived read URLs, with retries issuing new URLs and no reuse of an AssemblyAI-upload URL for MUX? [Consistency, Security, Spec §FR-021]
- [x] CHK034 Is the stable MUX playback reference handed directly to Hemera without a signed token or bearer credential being persisted as the durable reference? [Clarity, Security, Spec §FR-008, Plan §Workflow Boundaries]
- [x] CHK035 Are provider-specific circuit-breaker thresholds and recovery semantics quantified independently from per-stage attempt limits? [Measurability, Spec §FR-018, §FR-022]
- [x] CHK036 Are speaker roles defined from the greeting/reply conversation context, while automatic voice-gender detection is explicitly excluded and uncertain mappings are routed to operator review? [Clarity, Consistency, Spec §FR-002, §FR-003, §FR-004]