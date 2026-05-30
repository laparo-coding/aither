---
# Aither Telemetry Whitelist

Note: For the verified local Rollbar configuration and the minimal receipt checks for Gaia, Hemera, and Aither, refer to the workspace-wide checklist at `hemera/docs/monitoring/rollbar-local-checklist.md`.

This file contains the Aither-specific whitelist for `additionalData` keys used in `reportError(...)` calls.
Aither follows the same data protection rules as Hemera; the allowed keys are listed here together with project-specific additions.

Principles
- No plain-text error messages or raw HTTP responses in `additionalData`.
- Emails must be masked only (for example `j***e@example.com`).
- Never include tokens or API keys in `additionalData`.
- When in doubt, redact (`"[redacted]"`).

Aither Whitelist (top-level keys)
- `context` (string)
- `requestId` (string)
- `sessionId` (string)
- `bookingId` (string)
- `courseId` (string)
- `userId` (string) — only when necessary
- `paymentIntentId` (string)
- `disputeId` (string)
- `amount` (number)
- `reason` (string)
- `recipientCount` (number)
- `errorType` (string)
- `issueCount` (number)
- `issues` (array of sanitized issue objects, no raw payloads)
- `receivedDataSummary` (object with `type` and `keyCount`)
- `recipientEmail` (masked string)
- `operation` (string)
- `duration` (number)
- `performanceIssue` (boolean)
- `slowApiCall` (boolean)
- `timestamp` (string)

Aither-specific additions
- `aitherRequestId` (string) — correlates with Aither requests
- `modelVersion` (string) — version metadata only, never model output
- `integrationPoint` (string) — descriptive value such as `aither.ingest` or `aither.predict`

Redaction rules
- Key names such as `/originalError/i`, `/errorMessage/i`, and `/message$/i` must be redacted.
- If a key does not appear in this whitelist, it must either:
  - be redacted before reporting, or
  - be documented as an exception and added here.

Enforcement
- Use `scripts/check-reporterror-keys.mjs` (already in the repo) to find deviations.
- In PRs for Aither integration, reference this file and request any new keys here when needed.

Next steps
- If needed, extend the validation script so it automatically allows Aither-specific exceptions (for example `specs/aither/**`), or review the discovered keys and adjust `reportError` call sites accordingly.

---
