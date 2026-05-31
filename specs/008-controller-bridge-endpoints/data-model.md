# Data Model: 008 — Controller Bridge Endpoints

**Date**: 2026-05-31 | **Spec**: `specs/008-controller-bridge-endpoints/spec.md`

## Entities

### ControllerManifest
Represents the complete controller view state returned by `GET /api/slides/controller`.

```ts
interface ControllerManifest {
  courseId: string;
  presentationId: string;
  title: string;
  aspectRatio: string;
  activeSlideIndex: number;
  lastUpdated: string;
  slides: ControllerSlideRef[];
}
```

### ControllerSlideRef
Represents one addressable slide in the ordered manifest.

```ts
interface ControllerSlideRef {
  index: number;
  fileName: string;
  noteTitle?: string;
  noteBody?: string;
}
```

### ControllerNavigationRequest
Represents input for navigation mutation endpoint.

```ts
interface ControllerNavigationRequest {
  presentationId: string;
  command: "previous" | "next";
  fromIndex: number;
  requestId: string;
}
```

### ControllerNavigationResult
Represents successful mutation response.

```ts
interface ControllerNavigationResult {
  presentationId: string;
  activeSlideIndex: number;
  fileName: string;
  lastUpdated: string;
}
```

### ControllerError
Uniform error payload for client-safe failures.

```ts
interface ControllerError {
  code: string;
  message: string;
  requestId?: string;
  details?: Record<string, string | number | boolean>;
}
```

## Validation Rules

- `courseId` and `presentationId` must be non-empty strings.
- `activeSlideIndex` and `fromIndex` must be integers >= 0.
- `command` accepts only `previous` or `next`.
- `slides` must be sorted ascending by `index`, unique by `index` and `fileName`.
- Successful navigation response `activeSlideIndex` must reference an existing slide.

## State Transitions

### Manifest Read
1. Resolve active presentation for `courseId`.
2. Build deterministic ordered `slides` array.
3. Return immutable snapshot payload.

### Navigation Mutation
1. Validate request shape.
2. Verify `fromIndex` equals current active index.
3. Apply `previous` or `next` within bounds.
4. Persist updated active index.
5. Return updated `ControllerNavigationResult`.

## Error Taxonomy

- `INVALID_REQUEST` → request payload/query invalid.
- `UNAUTHORIZED` → auth guard failed.
- `PRESENTATION_NOT_FOUND` → no active presentation for target.
- `INDEX_CONFLICT` → `fromIndex` does not match server state.
- `SLIDE_STATE_UNAVAILABLE` → slide artifacts missing/corrupt.
