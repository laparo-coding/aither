# Performance Validation: 009 — Uranos Timestamp Endpoint

**Date**: 2026-07-13  
**Feature**: `009-timestamp-endpoint`  
**Endpoint**: `POST /api/recording/timestamp`  
**Requirement**: FR-020 / SC-007 → p95 < 500 ms

## Validation Status

**Status**: Pending runtime execution (cannot be finalized from mocked/unit test runs alone).

This file establishes the required protocol and recording format for the
production-like measurement run. The endpoint implementation is complete and
passes contract/unit tests; performance evidence must be collected against a
real runtime with a configured Vercel Blob store.

## Protocol (as defined in plan.md)

1. Ensure prerequisites:
   - Active recording session is present (`isRecording() === true`)
   - `BLOB_READ_WRITE_TOKEN` is configured
   - Blob document warmed with at least 50 existing chapters
2. Send 30 sequential `POST /api/recording/timestamp` requests with valid auth.
3. Discard sample #1 as warm-up.
4. Compute p95 over samples #2–#30.
5. Pass criterion: **p95 < 500 ms**.

## Fixture Identity

- Recording session id (asset id): `<to be recorded at execution time>`
- Runtime environment: `<local/prod-like>`
- Blob region/store: `<to be recorded>`
- Auth mode used: `service-token` (recommended)

## Raw Durations (ms)

> Fill during runtime validation.

| Sample | Duration (ms) |
|--------|---------------|
| 1 (warm-up) | |
| 2 | |
| 3 | |
| 4 | |
| 5 | |
| 6 | |
| 7 | |
| 8 | |
| 9 | |
| 10 | |
| 11 | |
| 12 | |
| 13 | |
| 14 | |
| 15 | |
| 16 | |
| 17 | |
| 18 | |
| 19 | |
| 20 | |
| 21 | |
| 22 | |
| 23 | |
| 24 | |
| 25 | |
| 26 | |
| 27 | |
| 28 | |
| 29 | |
| 30 | |

## p95 Calculation

- Dataset: samples 2–30 (29 samples)
- Sort ascending
- p95 index (nearest-rank): `ceil(0.95 * 29) = 28`
- p95 value: `<to be calculated>` ms

## Result

- p95 measured: `<pending>` ms
- Threshold: `< 500 ms`
- Verdict: `PENDING`

## Notes

- Unit/contract tests do not provide representative network latency and therefore
  do not satisfy FR-020/SC-007 evidence requirements by themselves.
- This placeholder exists to close the documentation gap; update it with measured
  numbers before feature sign-off.
