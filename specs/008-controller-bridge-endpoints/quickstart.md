# Quickstart: 008 — Controller Bridge Endpoints

## Prerequisites

- Aither running locally (`npm run dev`)
- Valid auth context for protected API routes
- At least one generated course presentation with slide files

## 1. Verify Manifest Endpoint

```bash
curl -s "http://localhost:3500/api/slides/controller?courseId=<course-id>" \
  -H "Authorization: Bearer <token>" | jq .
```

Expected:
- `success: true`
- `data.slides` sorted by `index`
- `data.activeSlideIndex` points to an existing entry

## 2. Verify Navigation Endpoint (next)

```bash
curl -s -X POST "http://localhost:3500/api/slides/controller/navigation" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "presentationId": "<presentation-id>",
    "command": "next",
    "fromIndex": 0,
    "requestId": "qs-next-001"
  }' | jq .
```

Expected:
- `success: true`
- `data.activeSlideIndex` increments within bounds

## 3. Verify Navigation Conflict

Reuse an outdated `fromIndex`:

```bash
curl -s -X POST "http://localhost:3500/api/slides/controller/navigation" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "presentationId": "<presentation-id>",
    "command": "next",
    "fromIndex": 0,
    "requestId": "qs-conflict-001"
  }' | jq .
```

Expected:
- `success: false`
- `error.code: INDEX_CONFLICT`
- no state mutation

## 4. Run Focused Tests

```bash
npx vitest run tests/contract/controller-endpoints.contract.spec.ts
npx vitest run tests/unit/controller-manifest.spec.ts
npx vitest run tests/unit/controller-navigation.spec.ts
```

## 5. Security Sanity Check

Call both endpoints without auth and verify `401 UNAUTHORIZED` responses that do not expose secret values.

## 6. Verify Not-Found Path

```bash
curl -s "http://localhost:3500/api/slides/controller?courseId=<unknown-course>" \
  -H "Authorization: Bearer <token>" | jq .
```

Expected:
- `success: false`
- `error.code: PRESENTATION_NOT_FOUND`
- HTTP status `404`

## 7. Run p95 Performance Validation (T034)

```bash
npx vitest run tests/unit/controller-endpoints-performance.spec.ts
```

Protocol:
- representative fixture with 50 slides and mixed notes states
- 31 calls per endpoint (1 warm-up + 30 measured samples)
- p95 computed from measured samples only

Acceptance thresholds from `plan.md`:
- manifest p95 < 300 ms
- navigation p95 < 250 ms

Latest local measurement (2026-05-31):
- manifest p95: 2.66 ms (PASS)
- navigation p95: 1.93 ms (PASS)

## 8. Run Dashboard E2E Performance Budget

Canonical FCP budget for the E2E test is `1800` ms.

For slower local dev runs, use an explicit override instead of changing the default budget:

```bash
E2E_FCP_BUDGET_MS=7000 npx playwright test tests/e2e/dashboard-performance.spec.ts --config=playwright.config.ts
```

Use the default budget unchanged for shared/CI-quality expectations.
