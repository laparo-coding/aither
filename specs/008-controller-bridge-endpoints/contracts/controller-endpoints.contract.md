# Contract: Controller Endpoints

**Feature**: 008-controller-bridge-endpoints

## 1) GET /api/slides/controller

### Request
- Method: `GET`
- Query:
  - `courseId` (required, string)

### Success Response (200)

```json
{
  "success": true,
  "data": {
    "courseId": "course_123",
    "presentationId": "pres_456",
    "title": "Advanced Coaching",
    "aspectRatio": "16:9",
    "activeSlideIndex": 3,
    "lastUpdated": "2026-05-31T10:12:31.000Z",
    "slides": [
      { "index": 0, "fileName": "000_intro.html" },
      { "index": 1, "fileName": "001_context.html" },
      { "index": 2, "fileName": "002_focus.html" },
      { "index": 3, "fileName": "003_action.html", "noteTitle": "Coach prompt" }
    ]
  }
}
```

### Error Responses
- `400 INVALID_REQUEST` for missing/invalid `courseId`.
- `401 UNAUTHORIZED` for missing/invalid auth.
- `404 PRESENTATION_NOT_FOUND` if no active presentation exists.
- `503 SLIDE_STATE_UNAVAILABLE` if slide metadata is incomplete/corrupt.

---

## 2) POST /api/slides/controller/navigation

### Request
- Method: `POST`
- Body:

```json
{
  "presentationId": "pres_456",
  "command": "next",
  "fromIndex": 3,
  "requestId": "req_abc_123"
}
```

### Success Response (200)

```json
{
  "success": true,
  "data": {
    "presentationId": "pres_456",
    "activeSlideIndex": 4,
    "fileName": "004_reflection.html",
    "lastUpdated": "2026-05-31T10:13:11.000Z"
  }
}
```

### Conflict Response (409)

```json
{
  "success": false,
  "error": {
    "code": "INDEX_CONFLICT",
    "message": "Client index does not match current presentation state.",
    "requestId": "req_abc_123",
    "details": {
      "expectedIndex": 4,
      "providedIndex": 3
    }
  }
}
```

### Error Responses
- `400 INVALID_REQUEST` for invalid body (unknown command, negative index, missing fields).
- `401 UNAUTHORIZED` for missing/invalid auth.
- `404 PRESENTATION_NOT_FOUND` if presentation cannot be resolved.
- `409 INDEX_CONFLICT` for stale `fromIndex`.
- `503 SLIDE_STATE_UNAVAILABLE` if target slide state cannot be read.

---

## 3) Non-Functional Contract Rules

- Responses must not include secrets, bearer tokens, or private filesystem paths.
- Manifest slide ordering must be deterministic for an unchanged snapshot.
- Navigation commands must be idempotent relative to request state checks:
  - Same stale request always returns conflict without mutation.
  - Same valid request transitions state once.

---

## 4) FR-007 Notes Compatibility Cases

### Manifest: notes present

- At least one slide in `data.slides[]` may include `noteTitle` and/or `noteBody`.
- Presence of notes fields must not alter required fields or ordering semantics.

### Manifest: notes absent

- `data.slides[]` entries may omit `noteTitle` and `noteBody` entirely.
- Response remains valid with all mandatory fields present.

### Navigation: notes optional

- Successful navigation payload remains valid whether notes metadata for the target slide is present or absent.
- No endpoint may fail solely because notes metadata is missing.
