# Performance Validation: 008 — Controller Bridge Endpoints

Date: 2026-05-31
Branch: 008-controller-bridge-endpoints

## Scope

- Endpoint A: `GET /api/slides/controller?courseId=<id>`
- Endpoint B: `POST /api/slides/controller/navigation`

## Protocol

- Representative fixture load:
  - 1 course
  - 50 slide artifacts (`*.html`)
  - mixed notes state via sidecar `*.notes.json` files
- Sample strategy:
  - 31 calls per endpoint total
  - sample 1 is warm-up and excluded from stats
  - 30 measured calls per endpoint used for p95
- p95 computation:
  - sort ascending
  - index = `ceil(0.95 * n) - 1`, with `n = 30`

## Command

```bash
npx vitest run tests/unit/controller-endpoints-performance.spec.ts
```

## Measured Output

```text
controller-perf manifestP95=2.66ms navigationP95=1.93ms samples=30
```

## Evidence Structure

### Latency Evidence (T034)

- Fixture identity:
  - fixture name: `controller-perf-fixture`
  - timestamp/hash: `2026-05-31T00:00:00Z`
- Raw durations (ms):
  - manifest (n=30, warm-up excluded): document all 30 values
  - navigation (n=30, warm-up excluded): document all 30 values
- Calculation method:
  - sorted ascending values
  - index = `ceil(0.95 * n) - 1`
  - p95 value = sorted[index]

### Compatibility Evidence (T038)

- Adjacent endpoints validated:
  - `GET /api/slides/status`
  - `GET /api/slides/view`
- Regression suite command and result:
  - command: `npx vitest run tests/contract/slides-api.contract.spec.ts`
  - result: PASS (`8/8` tests passed, includes four adjacent-endpoint regression checks)
- Response-shape compatibility proof:
  - baseline source (branch/commit): `main` contract expectations encoded in `tests/contract/slides-api.contract.spec.ts`
  - current source (branch/commit): `008-controller-bridge-endpoints` (local working tree, 2026-05-31 validation run)
  - compared fields:
    - status endpoint payload keys: `status`, `slideCount`, `lastUpdated`
    - view endpoint success contract: HTTP `200`, `Content-Type: text/html`, `Cache-Control: no-store`
    - view endpoint error contract: HTTP `400` with `{ error: "Invalid file" }`
  - compatibility outcome (unchanged/changed): unchanged
  - if changed, explicit justification: n/a

## Thresholds (from plan.md)

- Manifest read p95 < 300 ms
- Navigation mutation p95 < 250 ms

## Result

- Manifest p95: 2.66 ms -> PASS
- Navigation p95: 1.93 ms -> PASS
- Overall: PASS
