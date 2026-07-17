# Requirements Quality Checklist: Uranos Timestamp Endpoint

**Purpose**: Pre-implementation requirements-quality gate ("unit tests for the
requirements"). Each item validates whether the spec is complete, clear,
consistent, and measurable — NOT whether the implementation works.
**Created**: 2026-07-13
**Feature**: `specs/009-timestamp-endpoint/spec.md`
**Focus**: API contract quality · Security & auth · Data integrity
**Depth**: Formal pre-implementation gate (blocking)
**Excluded**: Downstream mux/ffmpeg execution (Out of Scope in spec)

---

## API Contract — Requirement Completeness

- [X] CHK001 Are request-body requirements fully specified (field name, type, unit, integer/positive constraints)? [Completeness, Spec §FR-002]
- [X] CHK002 Is a required response shape defined for the `200` success path (all fields of `TimestampIngestionResult`)? [Completeness, Spec §Key Entities, contracts/]
- [X] CHK003 Are requirements present for every status code the contract exposes (200/400/401/403/404/429/503/500)? [Coverage, Spec §Error Code Matrix]
- [X] CHK004 Is the `Retry-After` header requirement specified for the `429` response? [Completeness, Spec §FR-019]
- [X] CHK005 Are content-type requirements defined for both request and stored blob? [Completeness, Spec §FR-014]
- [X] CHK006 Is the endpoint path and HTTP method unambiguously specified? [Clarity, Spec §FR-001]

## API Contract — Clarity & Consistency

- [X] CHK007 Does the spec's error-code matrix agree with the OpenAPI and markdown contracts (no status/code appears in one but not the other)? [Consistency, Spec §Error Code Matrix vs contracts/]
- [X] CHK008 Is the distinction between `400 INVALID_REQUEST` and `400 INVALID_TIMESTAMP` defined with unambiguous trigger conditions? [Clarity, Spec §Error Code Matrix, §FR-012/FR-012a]
- [X] CHK009 Is the error envelope shape (`{ success, error: { code, message, details? }, meta }`) specified consistently for all error responses? [Consistency, Spec §FR-017]
- [X] CHK010 Are the success and error response `meta` fields (requestId, timestamp, version) defined or explicitly optional? [Clarity, contracts/]
- [X] CHK011 Is the term "asset id" defined and consistently equated to the recording `sessionId` everywhere it appears? [Consistency, Spec §FR-005]

## Security & Auth — Completeness

- [X] CHK012 Are authentication requirements defined for every entry path (service token, admin session, anonymous)? [Coverage, Spec §FR-003]
- [X] CHK013 Is the outcome for each auth case specified (token→200, no-token→401, non-admin session→403, admin→200)? [Completeness, Spec §FR-003, §Error Code Matrix]
- [X] CHK014 Is a requirement present that tokens are compared in constant time (timing-safe)? [Completeness, Spec §Service User, research §R6]
- [X] CHK015 Are secret-leakage prohibitions specified for responses AND logs (bearer, `URANOS_SYNC_TOKEN`, `BLOB_READ_WRITE_TOKEN`, filesystem paths)? [Completeness, Spec §FR-017, §SC-006]
- [X] CHK016 Is the rate-limit policy fully specified (limit, window, response code, key for both token and admin-session callers)? [Completeness, Spec §FR-019]
- [X] CHK017 Are requirements defined for the missing-credential configuration case (e.g., `URANOS_SYNC_TOKEN` unset)? [Resolved, Spec §FR-018a]

## Security & Auth — Clarity & Consistency

- [X] CHK018 Is it unambiguous that no RBAC `Permission` (e.g. `write:ffmetadata`) is required, resolving the earlier contradiction? [Consistency, Spec §Clarifications, §Service User]
- [X] CHK019 Are the `401` vs `403` conditions mutually exclusive and clearly delineated? [Clarity, Spec §FR-003]
- [X] CHK020 Is "authenticated identity" defined precisely enough to key the rate limiter without ambiguity? [Clarity, Spec §FR-019]

## Data Integrity — ffmetadata Completeness

- [X] CHK021 Are all chapter fields and their types/units specified (`id`, `start`, `end`, `title`; microseconds)? [Completeness, Spec §Key Entities, data-model.md]
- [X] CHK022 Is the offset computation formula fully specified (seconds→microseconds, reference epoch = recording start)? [Completeness, Spec §FR-010/FR-011]
- [X] CHK023 Is the first-chapter creation rule specified (start = first offset, not 0)? [Clarity, Spec §FR-007]
- [X] CHK024 Is the append/link rule specified (previous chapter `end` ← new `start`)? [Completeness, Spec §FR-008]
- [X] CHK025 Is the last-chapter `end` semantics specified (zero-length placeholder; downstream clamps)? [Completeness, Spec §Clarifications]
- [X] CHK026 Is the monotonicity requirement (strictly increasing by `start`) explicit and its violation outcome defined? [Completeness, Spec §FR-012a]
- [X] CHK027 Are the ffmetadata top-level `metadata` fields (`title`, `encoder`) specified with fixed values? [Completeness, data-model.md]

## Data Integrity — Clarity, Consistency & Measurability

- [X] CHK028 Is the ffmpeg-format compliance requirement measurable/verifiable (a concrete success criterion, not "valid")? [Measurability, Spec §SC-004]
- [X] CHK029 Do the JSON example, FR-007/FR-008, and data-model chapter rules agree (no chapter starting at 0 contradiction)? [Consistency, Spec §Architecture vs §FR-007]
- [X] CHK030 Is the blob path/naming rule (`ffmetadata/<assetId>.json`) stated identically across spec, contract, and data-model? [Consistency, Spec §FR-006, contracts/, data-model.md]
- [X] CHK031 Is the upsert behavior (overwrite existing, no random suffix) unambiguously required? [Clarity, Spec §FR-013/FR-014a]
- [X] CHK032 Are boundary conditions defined: timestamp equal to recording start, and equal to last chapter start? [Edge Case, Spec §FR-012/FR-012a, §Edge Cases]

## Behavioral Guarantees & Negative Space

- [X] CHK033 Is the "no active recording → no blob write" guarantee stated as a hard requirement (not just a scenario)? [Completeness, Spec §FR-004, §SC-002]
- [X] CHK034 Are requirements defined for what MUST NOT change (adjacent endpoints, recording lifecycle untouched)? [Coverage, Spec §Adjacent API Boundaries]
- [X] CHK035 Is the concurrency guarantee (no lost chapters) specified as a measurable outcome? [Measurability, Spec §FR-016, §SC-005]
- [X] CHK036 Is the blob-write-failure outcome specified (503 + retryable, timestamp not lost from in-flight state)? [Completeness, Spec §FR-015, §Edge Cases]

## Traceability & Completion Signals

- [X] CHK037 Does every success criterion (SC-001…SC-008) trace to at least one functional requirement? [Traceability]
- [X] CHK038 Does every functional requirement in the focus areas trace to at least one acceptance scenario or success criterion? [Traceability]
- [X] CHK039 Are all acceptance scenarios for US1–US3 stated in testable Given/When/Then form with concrete status codes? [Measurability, Spec §User Scenarios]
- [X] CHK040 Is the performance acceptance gate (p95 target) quantified and tied to a validation protocol? [Measurability, Spec §FR-020/SC-007, plan.md]

## Assumptions, Dependencies & Constraints

- [X] CHK041 Is the dependency on a configured Vercel Blob store documented as a precondition, with the missing-token failure mode defined? [Dependency, Spec §FR-018, quickstart.md]
- [X] CHK042 Is the assumption "single active recording lives on one instance" stated as the basis for the in-process lock? [Assumption, Spec §FR-016, §Clarifications]
- [X] CHK043 Is the Constitution VII/VIII deviation (external blob store) recorded with an approval status? [Traceability, plan.md §Constitution Check]
- [X] CHK044 Are out-of-scope items (mux/ffmpeg execution, non-timestamp payloads, blob lifecycle) explicitly enumerated so the contract's boundaries are unambiguous? [Clarity, Spec §Out of Scope]

---

**Total items**: 44
**Note**: Each `/speckit.checklist` run creates a new file. This checklist tests
requirement quality; it does not verify runtime behavior.
