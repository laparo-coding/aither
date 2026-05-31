# Feature Specification: Gaia Controller Bridge Endpoints

**Feature Branch**: `008-controller-bridge-endpoints`  
**Created**: 2026-05-31  
**Status**: Draft  
**Input**: User description: "Provide Speckit-compatible specifications in Aither for the Gaia-related upstream tasks."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Fetch Controller Manifest (Priority: P1)

As Gaia bridge, I need a dedicated upstream endpoint that returns the active presentation manifest (ordered slides, active index, and metadata) so the controller can render and synchronize reliably.

**Why this priority**: Without a manifest endpoint, Gaia cannot initialize controller state and cannot start any slide-navigation flow.

**Independent Test**: Can be fully tested by calling `GET /api/slides/controller?courseId=...` with a course that has generated slides and validating contract-compliant JSON.

**Acceptance Scenarios**:

1. **Given** a valid `courseId` with an active generated presentation, **When** `GET /api/slides/controller` is requested, **Then** the API returns `200` with deterministic slide order, active index, and required metadata.
2. **Given** a valid `courseId` but no active presentation, **When** `GET /api/slides/controller` is requested, **Then** the API returns `404 PRESENTATION_NOT_FOUND`; and if slide state is unreadable, it returns `503 SLIDE_STATE_UNAVAILABLE`.
3. **Given** a valid `courseId` where slide notes are missing for one or more slides, **When** `GET /api/slides/controller` is requested, **Then** the API still returns a contract-valid payload without requiring notes fields.

---

### User Story 2 - Advance or Reverse Active Slide (Priority: P1)

As Gaia bridge, I need to send button-only navigation commands (`previous`/`next`) to Aither so the active slide state can be advanced deterministically.

**Why this priority**: Controller interaction is blocked without upstream navigation mutation.

**Independent Test**: Can be fully tested by sending valid and invalid requests to `POST /api/slides/controller/navigation` and verifying state transitions and error behavior.

**Acceptance Scenarios**:

1. **Given** a valid presentation state and `command=next`, **When** `POST /api/slides/controller/navigation` is called, **Then** the API returns `200` with updated `activeSlideIndex` and resolved slide file reference.
2. **Given** an out-of-sync `fromIndex`, **When** `POST /api/slides/controller/navigation` is called, **Then** the API returns a conflict-style response and does not mutate state.

---

### User Story 3 - Keep Gaia Integration Secure and Observable (Priority: P2)

As platform owner, I need these endpoints to keep server-to-server auth server-side and emit actionable, non-sensitive error signals for troubleshooting.

**Why this priority**: Security and operational visibility are required for production reliability but can be layered after core endpoint behavior.

**Independent Test**: Can be tested by verifying auth guards, inspecting returned error payloads, and confirming logs omit secrets.

**Acceptance Scenarios**:

1. **Given** an unauthorized call, **When** either controller endpoint is requested, **Then** the API rejects the request without leaking credentials or token data.
2. **Given** an upstream/state error, **When** endpoint processing fails, **Then** the API returns structured error responses and logs include request correlation context.

---

### Edge Cases

- What happens when slide files exist but one referenced file is missing from storage at request time?
- How does navigation behave at boundaries (first slide + `previous`, last slide + `next`)?
- What happens when two navigation requests for the same presentation arrive concurrently?
- How does the API behave when optional notes data is absent (must still return valid payload shape)?

### Adjacent API Boundaries

- `GET /api/slides/status` and `GET /api/slides/view` are considered adjacent endpoints and remain out of functional scope for this feature.
- The controller endpoints MUST NOT require changes to adjacent endpoint request/response shapes.
- If adjacent endpoint artifact state drifts from controller state, controller endpoints still enforce their own contract semantics and return explicit controller error codes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST expose `GET /api/slides/controller?courseId={courseId}` for controller-manifest retrieval.
- **FR-002**: `GET /api/slides/controller` MUST return these required fields: `courseId`, `presentationId`, `title`, `aspectRatio`, `activeSlideIndex`, `lastUpdated`, and `slides[]` with `index` and `fileName`.
- **FR-003**: System MUST expose `POST /api/slides/controller/navigation` for button-driven slide transitions.
- **FR-004**: `POST /api/slides/controller/navigation` request body MUST include `presentationId`, `command`, `fromIndex`, and `requestId`.
- **FR-005**: `command` MUST only accept `previous` or `next`.
- **FR-006**: Successful navigation responses MUST include at least `activeSlideIndex` and `fileName`.
- **FR-007**: Manifest and navigation endpoints MAY include supplemental notes fields when available, but MUST remain valid when notes are absent.
- **FR-008**: Slide ordering returned by `GET /api/slides/controller` MUST be deterministic for a given presentation snapshot.
- **FR-009**: Both endpoints MUST enforce existing service-level authentication and MUST reject unauthorized access.
- **FR-010**: Error responses MUST be explicit for invalid input, out-of-sync state, and data-unavailable conditions, and MUST follow the canonical status/code matrix defined below.
- **FR-011**: Endpoint handling MUST NOT expose bearer tokens, internal secret values, or sensitive path details in responses. This includes (non-exhaustive) `Authorization` header values, token fragments, and absolute internal filesystem paths.
- **FR-012**: On `POST /api/slides/controller/navigation`, `command=previous` at index `0` MUST return `200` with unchanged `activeSlideIndex=0`.
- **FR-013**: On `POST /api/slides/controller/navigation`, `command=next` at the last slide index MUST return `200` with unchanged `activeSlideIndex`.
- **FR-014**: If referenced slide artifacts are missing or unreadable, controller endpoints MUST return `503 SLIDE_STATE_UNAVAILABLE` with a structured retryable error payload. FR-014 is a mandatory specialization of FR-010 and takes precedence for this condition.
- **FR-015**: Adjacent slide endpoints (`/api/slides/status`, `/api/slides/view`) are integration dependencies only and MUST remain backward-compatible and out of scope for controller feature changes.

### Controller Error Code Matrix

| Condition | HTTP Status | Error Code |
|-----------|-------------|------------|
| Invalid input (query/body/schema) | `400` | `INVALID_REQUEST` |
| Unauthorized request | `401` | `UNAUTHORIZED` |
| Presentation not found | `404` | `PRESENTATION_NOT_FOUND` |
| Out-of-sync navigation state (`fromIndex` mismatch) | `409` | `INDEX_CONFLICT` |
| Slide artifacts missing or unreadable | `503` | `SLIDE_STATE_UNAVAILABLE` |

### Key Entities *(include if feature involves data)*

- **ControllerManifest**: Upstream projection of active presentation state with ordered slides, metadata, and active index.
- **ControllerSlideRef**: Lightweight slide reference in manifest/navigation responses containing `index` and `fileName` plus optional notes metadata.
- **ControllerNavigationRequest**: Mutation payload with `presentationId`, `command`, `fromIndex`, `requestId`.
- **ControllerNavigationResult**: Result payload containing the new active index and active slide file reference.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `GET /api/slides/controller` returns contract-compliant payloads in 100% of integration test runs for valid fixtures.
- **SC-002**: `POST /api/slides/controller/navigation` accepts only `previous`/`next` and rejects invalid commands in 100% of negative-path tests.
- **SC-003**: Deterministic ordering check passes in repeated fetches for the same presentation snapshot with zero ordering drift.
- **SC-004**: Unauthorized requests to both endpoints are consistently rejected and contain no secret-bearing output.
- **SC-005**: Notes-compatibility tests pass for both states: notes fields present and notes fields absent.
