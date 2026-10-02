# Release-Gate Checklist: Video Transcription

**Purpose**: Validate that cross-service release requirements for the Aither/Hemera video-transcription workflow are complete, measurable, internally consistent, and ready for implementation review.
**Created**: 2026-09-30
**Feature**: [spec.md](../spec.md)

## Requirement Completeness

- [x] CHK001 Are the required ownership and handoff responsibilities between Aither and Hemera specified for every workflow phase, including review, participant access, cleanup, and metadata purge? [Completeness, Spec §FR-008, §FR-009, §FR-017, §FR-023]
- [x] CHK002 Are the requirements for all durable Hemera workflow records identified, including the booking, recording, provider references, status transitions, timestamps, and operator identity? [Completeness, Spec §FR-008, §FR-025]
- [x] CHK003 Are requirements defined for what remains available to an authorized operator during `review_required` without making any document participant-visible? [Completeness, Spec §FR-004, §FR-014]
- [x] CHK004 Are cleanup requirements complete for the AssemblyAI transcript, AssemblyAI source media, MUX asset, source-staging Blob, final transcript Blob, local MP4, workflow tombstone, and trace metadata? [Completeness, Spec §FR-013, §FR-017, §FR-019, §FR-021, §FR-023]

## Requirement Clarity

- [x] CHK005 Is the boundary between a valid transcript, a `review_required` result, and an operator-approved result defined with mutually exclusive conditions? [Clarity, Spec §FR-004, §FR-014, §FR-015]
- [x] CHK006 Is “non-empty utterance” defined precisely enough to avoid disagreement about whitespace, timestamps without speech, or provider-specific empty content? [Clarity, Spec §FR-004, §FR-015]
- [x] CHK007 Is the point at which the five-minute first-provider-call objective begins defined unambiguously for a newly persisted workflow? [Clarity, Spec §FR-024]
- [x] CHK008 Are the events excluded from the five-minute objective defined consistently, including open circuits, retries, and operator review? [Clarity, Spec §FR-024]
- [x] CHK009 Is the condition “provider cleanup is confirmed” defined with sufficient evidence and scope to permit immediate Hemera metadata purge? [Clarity, Spec §FR-017, §FR-023]
- [x] CHK010 Is “ignore” for late or duplicate AssemblyAI callbacks defined to preserve the approved role mapping, formatted transcript, and workflow state while retaining only permitted trace information? [Clarity, Spec §FR-014, §FR-025, §FR-028]

## Requirement Consistency

- [x] CHK011 Are the requirements for immediate access revocation, temporary tombstone retention, and immediate post-confirmation metadata purge consistent across the deletion lifecycle? [Consistency, Spec §FR-017, §FR-023]
- [x] CHK012 Are the conditions for independent cleanup retries consistent with the requirement that published participant documents remain available until booking or participation deletion? [Consistency, Spec §FR-013, §FR-017]
- [x] CHK013 Are the stable MUX reference, request-time signed MUX access, and five-minute transcript access requirements clearly distinguished without conflicting retention rules? [Consistency, Spec §FR-008, §FR-012]
- [x] CHK014 Do the circuit-breaker rules remain consistent with the maximum stage-attempt limit and the worker start-time objective? [Consistency, Spec §FR-018, §FR-022, §FR-024]

## Acceptance Criteria Quality

- [x] CHK015 Can the release criteria objectively distinguish an automatic publication from a reviewed publication and from an incomplete workflow? [Measurability, Spec §FR-004, §FR-014, §FR-015, §FR-016]
- [x] CHK016 Can the deletion acceptance criteria objectively establish that no participant association, provider reference, tombstone, or trace record remains after cleanup confirmation? [Measurability, Spec §FR-023, §FR-025]
- [x] CHK017 Are the five-minute start-time and circuit-open exception expressed using timestamps and states that can be objectively evaluated? [Measurability, Spec §FR-022, §FR-024]
- [x] CHK018 Can the requirements objectively establish that the retained trace excludes transcript content, full provider payloads, signed URLs, credentials, and bearer tokens? [Measurability, Spec §FR-012, §FR-025]

## Scenario Coverage

- [x] CHK019 Are requirements specified for silence, a single detected speaker, empty role content, missing speaker IDs, conflicting mappings, and failed speaker identification? [Coverage, Spec §FR-004, §FR-015]
- [x] CHK020 Are alternate and exception-flow requirements defined for duplicate, delayed, and stale callbacks before and after an operator approval? [Coverage, Spec §FR-014, §FR-025, §FR-028]
- [x] CHK021 Are recovery requirements specified for a provider circuit that remains open beyond the usual workflow start window? [Coverage, Spec §FR-022, §FR-024]
- [x] CHK022 Are deletion requirements defined for partial provider cleanup, repeated deletion requests, and a delayed cleanup confirmation? [Coverage, Spec §FR-017, §FR-023]

## Security and Privacy Requirements

- [x] CHK023 Are requirements clear that Hemera authorization occurs before any fresh participant access capability is issued, including after a prior URL has expired? [Security, Spec §FR-009, §FR-012]
- [x] CHK024 Are non-retention requirements complete and consistent for provider payloads, transcript content, credentials, signed URLs, participant association, workflow metadata, and trace records? [Security/Privacy, Spec §FR-010, §FR-012, §FR-023, §FR-025]
- [x] CHK025 Is the production secret-storage and runtime-resolution requirement sufficiently specified in addition to the local macOS Keychain rule? [Security, Spec §FR-010, §FR-026]

## Dependencies and Assumptions

- [x] CHK026 Are the required guarantees from AssemblyAI, MUX, Vercel Blob, and Hemera explicitly documented where they affect ordering, retries, deletion confirmation, or secure access? [Dependency, Spec §FR-001, §FR-012, §FR-017, §FR-021; Research §R1-R8]
- [x] CHK027 Is the acceptance boundary for the active AssemblyAI Free-plan endpoint documented so a region or entitlement change cannot silently alter the feature's requirements? [Assumption, Spec §FR-020]
- [x] CHK028 Are the Aither-Hemera contract requirements traceable from each cross-service functional requirement to a corresponding contract definition and acceptance criterion? [Traceability, Spec §FR-008, §FR-009, §FR-012, §FR-017, §FR-023, §FR-025; Contract]

## Ambiguities and Conflicts

- [x] CHK029 Does the specification resolve whether the known gender invariant has any permissible effect beyond human review, without reintroducing prohibited voice-gender inference? [Clarity, Spec §FR-002, §FR-003]
- [x] CHK030 Are requirements explicit about whether an operator may abandon a `review_required` workflow and which cleanup and trace-retention rules then apply? [Completeness, Spec §FR-027]

## Notes

- Complete an item only after the referenced requirements are clear, complete, consistent, and objectively reviewable.
- This is a requirements-quality release gate, not an implementation test plan.