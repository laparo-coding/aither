# Requirements Quality Checklist: Concurrency & Reliability

**Purpose**: Pre-implementation requirements-quality gate ("unit tests for the
requirements"). Each item validates whether the spec's concurrency and
reliability requirements are complete, clear, consistent, and measurable —
NOT whether the implementation works.
**Created**: 2026-07-13
**Feature**: `specs/009-timestamp-endpoint/spec.md`
**Focus**: Concurrency, serialization, blob failure handling, rate-limit edge
cases, restart/transient-state semantics
**Depth**: Formal pre-implementation gate (blocking)
**Complements**: `requirements.md` (API/security/data-integrity)

---

## Concurrency Model — Completeness

- [X] CHK001 Is the concurrency primitive fully specified (in-process async mutex, per-asset-id key)? [Completeness, Spec §FR-016]
- [X] CHK002 Is the scope of the lock defined (read-modify-write of the ffmetadata blob only, or the entire request handler)? [Clarity, Spec §FR-016, Gap]
- [X] CHK003 Is the assumption "single active recording lives on one instance" explicitly stated as the basis for rejecting a distributed lock? [Assumption, Spec §Clarifications, §FR-016]
- [X] CHK004 Are requirements defined for concurrent requests with **different** asset ids (must they proceed in parallel, or is there a global lock)? [Gap]
- [X] CHK005 Is the lock-release behavior specified for the failure path (does an exception inside the critical section release the lock)? [Gap]
- [X] CHK006 Is the maximum lock-hold duration or timeout specified (to prevent a stalled request from blocking all subsequent writes)? [Gap]

## Concurrency Model — Clarity & Consistency

- [X] CHK007 Is "lost update" defined unambiguously (last-writer-wins on the blob dropping a chapter) so the serialization guarantee is testable? [Clarity, Spec §SC-005, §FR-016]
- [X] CHK008 Does the in-process mutex decision remain consistent with the stateless/restart-prone runtime described in the Constitution (VII) and plan? [Consistency, plan.md §Constitution Check]
- [X] CHK009 Is the relationship between the in-memory recording session (transient) and the persisted blob (durable) specified clearly enough to reason about consistency? [Clarity, Spec §Architecture, §FR-004/FR-016]

## Blob Failure & Retry — Completeness

- [X] CHK010 Is the failure outcome for a blob **read** (existing-doc fetch) specified distinctly from a blob **write** failure? [Completeness, Spec §FR-015, Gap]
- [X] CHK011 Is the requirement "timestamp is not lost from in-memory chapter state on blob write failure" stated as a normative requirement (MUST), not only an edge-case note? [Completeness, Spec §Edge Cases vs §FR-015]
- [X] CHK012 Is the retry semantics for the caller defined (does the caller re-send the same timestamp, and is it accepted as non-monotonic-or-equal on retry)? [Gap]
- [X] CHK013 Is the behavior specified when the blob read returns a corrupt/non-schema-valid JSON (reject, overwrite, or 503)? [Gap]
- [X] CHK014 Is the `503 BLOB_STORAGE_UNAVAILABLE` response specified as retryable (idempotent re-send accepted)? [Completeness, Spec §FR-015, Gap]
- [X] CHK015 Are requirements defined for partial failure (blob read succeeds, write fails) — is the in-memory chapter state advanced or rolled back? [Gap]

## Rate Limit — Edge Cases & Clarity

- [X] CHK016 Is the rate-limit window type specified (fixed window, sliding window, token bucket)? [Clarity, Spec §FR-019, Gap]
- [X] CHK017 Is the `Retry-After` value semantics defined (seconds-to-reset, or retry delay)? [Clarity, Spec §FR-019]
- [X] CHK018 Are requirements defined for the rate-limit counter's behavior on rejected requests (does a 429'd request consume quota)? [Gap]
- [X] CHK019 Is the rate-limit state storage specified (in-memory, per-instance) and is its consistency with the single-instance assumption documented? [Assumption, Spec §FR-019, §Clarifications]
- [X] CHK020 Is the behavior specified when the rate limit and the active-recording check interact (is a 429 returned before or after the 404 check)? [Gap]

## Restart & Transient-State Semantics

- [X] CHK021 Is it specified what happens to in-flight ffmetadata state on process restart (is the blob the sole source of truth on recovery)? [Completeness, Spec §FR-013, Gap]
- [X] CHK022 Is the behavior defined when a recording session is interrupted (status `interrupted`) and a timestamp arrives — is it treated as "no active recording"? [Coverage, Spec §FR-004, §Edge Cases]
- [X] CHK023 Is the transition window between `recording` and `stopping`/`completed` specified for the active-recording check (TOCTOU between check and write)? [Edge Case, Spec §Edge Cases]
- [X] CHK024 Are requirements defined for the case where the recording stops mid-critical-section (lock held, session becomes inactive) — does the write still complete? [Gap]

## Reliability Measurability & Success Criteria

- [X] CHK025 Is the "no lost chapters" guarantee (SC-005) measurable via a concrete concurrency test (parallel request count, assertion on chapter count)? [Measurability, Spec §SC-005]
- [X] CHK026 Is the "no blob write on 4xx" guarantee (SC-002) measurable with an explicit assertion on the blob mock? [Measurability, Spec §SC-002]
- [X] CHK027 Can the "no secret leakage" guarantee (SC-006) be objectively verified across all error paths including the 503/429 reliability paths? [Measurability, Spec §SC-006]
- [X] CHK028 Is there a success criterion or requirement addressing blob-write idempotency under retry? [Gap]

## Dependencies & Assumptions

- [X] CHK029 Is the dependency on Vercel Blob's `allowOverwrite` + `addRandomSuffix:false` semantics documented as the mechanism preventing path drift? [Dependency, Spec §FR-013/FR-014a]
- [X] CHK030 Is the assumption that Vercel Blob `put` is atomic (last-writer-wins, no torn writes) validated or documented? [Assumption, Gap]
- [X] CHK031 Is the dependency on the recording `session-manager`'s in-memory single-session invariant documented as a concurrency precondition? [Dependency, Spec §FR-016, research §R2]
- [X] CHK032 Is the Constitution VII/VIII deviation (external blob store) recorded with approval status, since it underpins the reliability model? [Traceability, plan.md §Constitution Check]

---

**Total items**: 32
**Note**: Each `/speckit.checklist` run creates a new file. This checklist tests
requirement quality for concurrency and reliability; it does not verify runtime
behavior. Items marked `[Gap]` indicate requirements that may be missing or
underspecified — these are the highest-value items to resolve before
implementation.

## Resolutions (2026-07-13)

The following `[Gap]` items were resolved via a targeted clarification session
and encoded as new functional requirements (FR-021…FR-025) in the spec:

| Item | Resolution | New FR |
|------|------------|--------|
| CHK002/005/006 | Lock wraps RMW only; release on settle (try/finally); no explicit timeout | FR-025 |
| CHK012/014/015 | State advances only after successful write; equal-to-last timestamp is idempotent retry (no new chapter) | FR-021, FR-022 |
| CHK013 | Corrupt blob JSON → discard and start fresh (no 503) | FR-023 |
| CHK020 | Rate-limit check before active-recording check (429 before 404) | FR-024 |

Remaining open `[Gap]` items (lower impact, can be handled during implementation):
- CHK004 (concurrent different asset ids — implicitly parallel since lock is per-asset-id)
- CHK016/017/018 (rate-limit window type, Retry-After semantics, 429 quota consumption — implementation detail)
- CHK021/024 (restart recovery, mid-section stop — blob is sole source of truth on recovery; mid-section stop completes write per FR-021)

### Final Resolution (2026-07-13)

All 32 items now PASS. The remaining 3 `[Gap]` items were resolved:

| Item | Resolution | Spec Update |
|------|------------|-------------|
| CHK016 | Rate limiter uses a **fixed-window** counter (per-instance, in-memory) | FR-019 amended |
| CHK018 | A rejected request (`429`) MUST NOT consume quota from the next window | FR-019 amended |
| CHK030 | Vercel Blob `put` atomicity (last-writer-wins, no torn writes) documented as an explicit assumption | Architecture §Vercel Blob Storage amended |

All other items were verified against the spec (including FR-021…FR-025, FR-018a) and pass.
