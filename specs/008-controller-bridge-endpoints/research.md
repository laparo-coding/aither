# Research: 008 — Controller Bridge Endpoints

**Date**: 2026-05-31 | **Spec**: `specs/008-controller-bridge-endpoints/spec.md`

## R1: Endpoint Shape for Gaia Controller Integration

### Decision
Provide two dedicated endpoints:
- `GET /api/slides/controller?courseId={courseId}`
- `POST /api/slides/controller/navigation`

### Rationale
- Gaia requires a pull endpoint for initial render/sync and a mutation endpoint for button-based navigation.
- The split keeps read and write concerns explicit and simplifies contract testing.
- It aligns with existing App Router conventions already used in `src/app/api/slides/...`.

---

## R2: Deterministic Ordering Strategy

### Decision
Manifest ordering is computed from existing generated slide sequence and always returned in stable ascending order by index.

### Rationale
- Gaia controller depends on deterministic ordering for sync and retry.
- Stable ordering eliminates cross-request drift for the same presentation snapshot.
- Existing filename/sequence conventions in Aither can be reused instead of introducing a new ordering source.

---

## R3: Conflict Handling for Navigation

### Decision
Use optimistic guard with `fromIndex` in navigation requests.

### Behavior
- If `fromIndex` matches current active index, apply command.
- If it does not match, return conflict response and do not mutate state.

### Rationale
- Prevents stale-client overwrites when parallel requests race.
- Keeps behavior explicit and testable with deterministic outcomes.

---

## R4: Optional Notes Handling

### Decision
Notes metadata is optional in both manifest and navigation responses.

### Rationale
- Gaia accepts controller payloads without notes.
- This keeps endpoint contracts backward-compatible with current Aither material state.

---

## R5: Authentication and Error Response Policy

### Decision
Reuse existing service-level auth guard and return structured JSON errors without sensitive details.

### Rationale
- No new auth mechanism required.
- Contract can enforce consistency for `400`, `401`, `404`, and `409` style responses.
- Security baseline: never return bearer values, secret keys, or internal filesystem paths.

---

## R6: Testing Scope

### Decision
Test at three layers:
- Unit tests for manifest and navigation helper logic.
- Contract tests for endpoint I/O and status codes.
- Optional route integration tests for auth + wiring.

### Rationale
- Gives fast feedback for deterministic core logic.
- Guarantees Gaia-facing API behavior matches spec.
- Minimizes regression risk in future controller iterations.
