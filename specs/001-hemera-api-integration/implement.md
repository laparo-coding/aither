# Implementation Guide: Hemera Academy API Integration

## Overview

This guide documents the step-by-step implementation of the Hemera Academy API integration. It covers: (1) a typed HTTP client with throttling, retry, and JWT auth, (2) a sync orchestrator with incremental hash-based regeneration, (3) Handlebars-based template population, (4) atomic HTML file writing, (5) MUX recording URL transmission, (6) error monitoring and email notifications, and (7) protected API routes with Clerk RBAC.

---

## Part 1: Foundation — Types, Schemas, and Configuration

### Step 1: Entity Types

Create `src/lib/hemera/types.ts` with TypeScript interfaces for all Hemera API entities:

```typescript
// All entities are transient API response shapes — no local persistence (Constitution VII)

export interface HtmlTemplate {
  sourceId: string;
  seminarId: string | null;
  lessonId: string | null;
  markup: string;
  version: string | null;
}

export interface Seminar {
  sourceId: string;
  title: string;
  description: string | null;
  dates: { start: string; end: string }[];
  instructorIds: string[];
  lessonIds: string[];
  recordingUrl: string | null;
}

export interface UserProfile {
  sourceId: string;
  name: string;
  email: string | null; // PII — exclude from logs
  role: "participant" | "instructor";
  seminarIds: string[];
}

export interface Lesson {
  sourceId: string;
  seminarId: string;
  title: string;
  sequence: number;
  textContentIds: string[];
  mediaAssetIds: string[];
}

export interface TextContent {
  sourceId: string;
  entityRef: { type: "seminar" | "lesson"; id: string };
  body: string;
  contentType: "text" | "html" | "markdown";
}

export interface MediaAsset {
  sourceId: string;
  entityRef: { type: "seminar" | "lesson"; id: string };
  mediaType: "image" | "video";
  sourceUrl: string;
  altText: string | null;
  fileSize: number | null;
}

export interface SeminarRecording {
  seminarSourceId: string;
  muxAssetId: string;
  muxPlaybackUrl: string;
  recordingDate: string;
}
```

### Step 2: Zod Validation Schemas

Create `src/lib/hemera/schemas.ts` with Zod schemas matching every entity type, plus array response schemas (`SeminarsResponseSchema`, `LessonsResponseSchema`, etc.). Also include service-API-derived schemas (`CourseWithParticipantsSchema`, `ParticipationSchema`, `CoursesResponseSchema`, `ResultOutcomeEnum`).

Key pattern: each entity schema mirrors the TypeScript interface with strict validation (required fields, URL format checks, enum enforcement).

### Step 3: Sync Types

Create `src/lib/sync/types.ts`:

```typescript
export interface SyncJob {
  jobId: string;
  startTime: string;
  endTime: string | null;
  status: "running" | "success" | "failed";
  recordsFetched: number;
  htmlFilesGenerated: number;
  htmlFilesSkipped: number;
  recordsTransmitted: number;
  errors: { entity: string; message: string; timestamp: string }[];
}

export interface SyncManifest {
  lastSyncTime: string;
  hashes: Record<string, string>;
}
```

### Step 4: Sync API Schemas

Create `src/lib/sync/schemas.ts` with Zod schemas for Aither Sync API request/response bodies: `SyncJobResponseSchema`, `RecordingTransmitRequestSchema`, `RecordingTransmitResponseSchema`, `ErrorResponseSchema`, `ValidationErrorResponseSchema` — derived from `contracts/aither-sync-api.yaml`.

### Step 5: Environment Configuration

Create `src/lib/config.ts`:

```typescript
import { z } from "zod";

const ConfigSchema = z.object({
  HEMERA_API_BASE_URL: z.string().url(),
  HEMERA_SERVICE_TOKEN: z.string().min(1),
  HTML_OUTPUT_DIR: z.string().default("output"),
  SLIDES_OUTPUT_DIR: z.string().default("output/slides"),
  // Clerk
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().min(1),
  CLERK_SECRET_KEY: z.string().min(1),
  // SMTP
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  NOTIFY_FROM: z.string().email().optional(),
  NOTIFY_TO: z.string().email().optional(),
  NOTIFY_FAILURE_THRESHOLD: z.coerce.number().default(3),
  // Rollbar
  ROLLBAR_ACCESS_TOKEN: z.string().optional(),
  NEXT_PUBLIC_ROLLBAR_ENABLED: z.string().optional(),
  // ... (additional fields with cross-field refinements)
});

let cachedConfig: z.infer<typeof ConfigSchema> | null = null;

export function loadConfig() {
  if (cachedConfig) return cachedConfig;
  cachedConfig = ConfigSchema.parse(process.env);
  return cachedConfig;
}

export function resetConfig() { cachedConfig = null; }
```

### Step 6: Vitest Configuration

Configure `vitest.config.ts` with path aliases matching `tsconfig.json` to enable `@/` imports in tests.

---

## Part 2: Hemera API Client

### Step 7: HTTP Client with Throttling and Retry

Create `src/lib/hemera/client.ts`:

```typescript
import pRetry, { AbortError } from "p-retry";
import pThrottle from "p-throttle";
import type { z } from "zod";

export interface HemeraClientOptions {
  baseUrl: string;
  getToken: () => Promise<string>;
  allowedPathPrefix?: string;
  rateLimit?: number;      // default: 2 req/s
  maxRetries?: number;     // default: 5
  fetchFn?: typeof fetch;  // for testing
}

export class HemeraClient {
  // Throttled fetch via p-throttle (2 req/s default)
  // Retry on 5xx/network errors via p-retry (5 attempts, jitter)
  // Retry-After header support for 429 responses
  // Zod validation of every response
  // Path normalization against directory traversal

  async get<T>(path: string, schema: z.ZodType<T>): Promise<T> { /* ... */ }
  async put<T>(path: string, body: unknown, schema?: z.ZodType<T>): Promise<T | void> { /* ... */ }

  // Service-specific convenience methods
  async getServiceCourses(): Promise<CoursesResponse> { /* ... */ }
  async getServiceCourse(id: string): Promise<CourseWithParticipants> { /* ... */ }
  async getServiceParticipation(id: string): Promise<Participation> { /* ... */ }
  async updateServiceParticipationResult(id: string, data: unknown): Promise<Participation> { /* ... */ }
}
```

Key implementation details:
- JWT token retrieved via `getToken()` callback, validated for audience and role claims
- Cached decoded JWT payload to avoid repeated base64 parsing
- `AbortError` used for non-retryable status codes (400, 401, 403, 404, 422)
- 429 responses respect `Retry-After` header

### Step 8: Token Manager

Create `src/lib/hemera/token-manager.ts`:

```typescript
export class HemeraTokenManager {
  constructor(private readonly serviceToken: string) {
    if (!serviceToken) throw new Error("Service token is required");
  }
  async getToken(): Promise<string> { return this.serviceToken; }
}

// Singleton, initialized from HEMERA_SERVICE_TOKEN env var
let tokenManagerInstance: HemeraTokenManager | null = null;

export function getTokenManager(): HemeraTokenManager {
  if (tokenManagerInstance) return tokenManagerInstance;
  const token = process.env.HEMERA_SERVICE_TOKEN;
  if (!token) throw new Error("HEMERA_SERVICE_TOKEN is not configured");
  tokenManagerInstance = new HemeraTokenManager(token);
  return tokenManagerInstance;
}

export function resetTokenManager(): void { tokenManagerInstance = null; }
```

### Step 9: Client Factory

Create `src/lib/hemera/factory.ts`:

```typescript
import { loadConfig } from "../config";
import { HemeraClient } from "./client";
import { getTokenManager } from "./token-manager";

export function createHemeraClient(): HemeraClient {
  const config = loadConfig();
  const tokenManager = getTokenManager();
  return new HemeraClient({
    baseUrl: config.HEMERA_API_BASE_URL,
    getToken: () => tokenManager.getToken(),
    rateLimit: 2,
    maxRetries: 5,
  });
}
```

### Step 10: Client Unit Tests

Create `tests/unit/hemera-client.spec.ts` with tests covering:
- Auth header sent with JWT token
- Throttling (2 req/s enforced)
- Retry on 5xx errors (up to 5 times with jitter)
- Retry-After header handling for 429
- Zod validation rejecting invalid responses
- Path traversal prevention

Also create `tests/unit/hemera-schemas.spec.ts` with valid/invalid payload tests for every entity schema.

---

## Part 3: Sync Engine (User Story 1)

### Step 11: Template Population (Handlebars)

Create `src/lib/html/populator.ts`:

```typescript
import Handlebars from "handlebars";

export function populateTemplate(templateHtml: string, data: Record<string, unknown>): string {
  const compiled = Handlebars.compile(templateHtml, { noEscape: false });
  return compiled(data);
}

// Register {{image sourceUrl altText}} and {{video sourceUrl}} helpers
export function registerMediaHelpers(): void {
  Handlebars.registerHelper("image", (sourceUrl: string, altText: string) => {
    const safeUrl = Handlebars.Utils.escapeExpression(sourceUrl);
    const safeAlt = Handlebars.Utils.escapeExpression(altText ?? "");
    return new Handlebars.SafeString(
      `<img src="${safeUrl}" alt="${safeAlt}" loading="lazy" onerror="this.outerHTML='<p class=\\'media-fallback\\'>Image unavailable</p>'" />`
    );
  });
  Handlebars.registerHelper("video", (sourceUrl: string) => {
    const safeUrl = Handlebars.Utils.escapeExpression(sourceUrl);
    return new Handlebars.SafeString(
      `<video controls preload="metadata" src="${safeUrl}"><p class="media-fallback">Video unavailable</p></video>`
    );
  });
}
```

### Step 12: Content Hash Manifest

Create `src/lib/sync/hash-manifest.ts`:

```typescript
import { createHash } from "node:crypto";

// SHA-256 of JSON.stringify({ template, data }, sortedKeys)
export function computeContentHash(templateContent: string, data: Record<string, unknown>): string;

// Compare old manifest with new hashes → { changed, deleted, unchanged }
export function diffManifest(oldManifest: SyncManifest, newHashes: Record<string, string>): ManifestDiff;

// Atomic read/write to output/.sync-manifest.json (tmp + rename)
export async function readManifest(manifestPath: string): Promise<SyncManifest>;
export async function writeManifest(manifestPath: string, manifest: SyncManifest): Promise<void>;
```

### Step 13: Atomic HTML File Writer

Create `src/lib/html/writer.ts`:

```typescript
// Write HTML atomically: write to .tmp, then rename
export async function writeHtmlFile(
  outputDir: string, entityType: string, entityId: string, content: string
): Promise<void>;

// Remove HTML files for entities no longer in the active set
export async function cleanOrphans(
  outputDir: string, entityType: string, activeIds: Set<string>
): Promise<string[]>;
```

### Step 14: Sync Orchestrator

Create `src/lib/sync/orchestrator.ts`:

```typescript
export class SyncOrchestrator {
  constructor(options: { client: HemeraClient; outputDir: string; manifestPath: string });

  async run(): Promise<SyncJob> {
    // 1. Fetch all 6 entity types (templates, seminars, lessons, users, texts, media)
    // 2. Read existing manifest
    // 3. Match templates to entities, build data context
    // 4. Compute SHA-256 hashes, diff with manifest
    // 5. Populate only changed templates → write HTML atomically
    // 6. Clean orphaned files
    // 7. Update manifest atomically
    // Returns SyncJob with status, counts, and errors
  }
}
```

Pipeline detail:
- Templates are matched to seminars (by `seminarId`) and lessons (by `lessonId`)
- Seminar data context includes instructors, lessons, texts, and media
- Lesson data context includes texts and media
- Only entities whose template+data hash changed since last sync are regenerated

### Step 15: Sync Tests

Create tests **before** implementation (Constitution I — TDD):

| Test File | Coverage |
|-----------|----------|
| `tests/unit/template-populator.spec.ts` | Template population, XSS escaping, missing placeholders |
| `tests/unit/hash-manifest.spec.ts` | Hash computation, diff detection, atomic read/write |
| `tests/unit/html-writer.spec.ts` | Atomic write (tmp+rename), directory creation, orphan cleanup |
| `tests/unit/sync-orchestrator.spec.ts` | Full pipeline, empty responses, malformed records |
| `tests/contract/sync-api.contract.spec.ts` | POST /api/sync → 202, GET → 200, concurrent → 409 |
| `tests/contract/hemera-api.contract.spec.ts` | API response validation against Zod schemas |

---

## Part 4: Sync API Route (User Story 1 cont.)

### Step 16: Sync Route Handler

Create `src/app/api/sync/route.ts`:

```typescript
// In-memory state (transient, Constitution VII)
let currentJob: SyncJob | null = null;
let isSyncRunning = false;
let syncStartedAt: number | null = null;

// POST /api/sync — Trigger a sync
export async function POST(req: NextRequest) {
  // 1. requireAdmin() auth check
  // 2. Auto-release timed-out lock (30 min default)
  // 3. Mutex: reject concurrent sync → 409
  // 4. Create SyncJob placeholder, set mutex
  // 5. Fire-and-forget: orchestrator.run() in background
  // 6. Return 202 Accepted with job info
}

// GET /api/sync — Get sync status
export async function GET(req: NextRequest) {
  // 1. requireAdmin() auth check
  // 2. Return current/last job or 404
}
```

---

## Part 5: Media Serving (User Story 1c)

### Step 17: Media Helpers

Extend `src/lib/html/populator.ts` — the `registerMediaHelpers()` function registers Handlebars helpers `{{image}}` and `{{video}}` that generate `<img>` and `<video>` tags with hemera.academy-hosted URLs and `onerror` fallback handlers.

### Step 18: Media Data in Orchestrator

Extend `src/lib/sync/orchestrator.ts` — `MediaAsset` references are resolved per entity and included in the template population context. Templates can use `{{image}}` and `{{video}}` helpers.

### Step 19: Media Tests

Create `tests/unit/media-embedding.spec.ts` — verify `<img>` and `<video>` tags use correct URLs, have fallback markup for broken URLs.

---

## Part 6: Recording URL Transmission (User Story 1b)

### Step 20: Recording Transmitter

Create `src/lib/sync/recording-transmitter.ts`:

```typescript
export async function transmitRecording(
  client: HemeraClient, recording: SeminarRecording
): Promise<TransmitResult> {
  // 1. Validate input with Zod (RecordingTransmitRequestSchema)
  // 2. PUT to /seminars/{id}/recording via HemeraClient
  // 3. Return { success, seminarSourceId, hemeraResponse? | error? }
}
```

### Step 21: Recordings API Route

Create `src/app/api/recordings/route.ts`:

```typescript
export async function POST(req: NextRequest) {
  // 1. requireAdmin() auth check
  // 2. Parse & validate request body with Zod
  // 3. Call transmitRecording() with HemeraClient
  // 4. Return 200/400/502
}
```

### Step 22: Recording Tests

| Test File | Coverage |
|-----------|----------|
| `tests/unit/recording-transmitter.spec.ts` | Zod validation, PUT success/failure, 404/422/429/5xx handling |
| `tests/contract/recordings-api.contract.spec.ts` | POST validates body, returns 200/400/502 |

---

## Part 7: Scheduled Sync (User Story 2)

### Step 23: Sync Mutex Hardening

Harden the sync mutex in `src/app/api/sync/route.ts`:
- Lock released in `finally` block (on success AND failure)
- Auto-release timeout (default 30 min, configurable via `SYNC_TIMEOUT_MS`)
- `isSyncTimedOut()` check before rejecting with 409

### Step 24: Cron Job Documentation

Create `src/lib/sync/cron-setup.md` with example crontab entry:

```bash
# Daily sync at 02:00
0 2 * * * curl -s -X POST http://localhost:3000/api/sync -H "Authorization: Bearer $AITHER_SYNC_TOKEN"
```

### Step 25: Mutex Test

Create `tests/unit/sync-mutex.spec.ts` — concurrent trigger returns 409, sequential triggers succeed, lock released on failure.

---

## Part 8: Error Handling & Monitoring (User Story 3)

### Step 26: Rollbar Integration

Create `src/lib/monitoring/rollbar-official.ts`:
- Singleton Rollbar instance with environment detection
- PII scrubbing depending on telemetry consent (`src/lib/monitoring/privacy.ts`)
- Configurable sampling per severity level
- Test/E2E mode: no-op (no network calls)

Exports: `reportError()`, `recordUserAction()`, `flushRollbar()`, `ErrorSeverity`, `ErrorContext`, `createErrorContext()`

### Step 27: Sync Error Logger

Create `src/lib/monitoring/sync-logger.ts`:
- `logSyncError()`, `logSyncWarning()`, `logSyncCritical()` — structured logging via Rollbar
- Redacts `sourceId` when PII consent is not granted

### Step 28: Email Notifications

Create `src/lib/notifications/email.ts`:

```typescript
// Nodemailer pool transport
// Threshold-based sending (NOTIFY_FAILURE_THRESHOLD, default 3)
// Consecutive failure counter (in-memory, reset on success)
export async function sendFailureNotification(jobErrors: SyncError[]): Promise<void>;
export function resetFailureCounter(): void;
export function getFailureCount(): number;
```

### Step 29: Integrate into Orchestrator

- Call `logSyncError()` / `logSyncCritical()` from orchestrator on failures
- Call `sendFailureNotification()` on sync failure, track consecutive count
- Reset counter on success

### Step 30: Error Handling Tests

| Test File | Coverage |
|-----------|----------|
| `tests/unit/email-notifications.spec.ts` | Threshold-based sending, counter reset on success |
| `tests/unit/sync-error-logging.spec.ts` | Rollbar called with structured context |

---

## Part 9: Access Control (User Story 4)

### Step 31: Auth Helper

Create `src/lib/auth/role-check.ts`:

```typescript
export function requireAdmin(auth: unknown): { status: number; body: Record<string, string> } {
  // Check sessionClaims.metadata.role === "admin"
  // Return { status: 200 } or { status: 401/403, body: { error, message } }
}
```

### Step 32: Permissions & Service Guard

Create `src/lib/auth/permissions.ts` with centralized RBAC:
- 4 roles: `admin`, `api-client`, `instructor`, `participant`
- 7 permissions: `read:courses`, `read:bookings`, `read:participations`, `write:participation-results`, `read:users`, `manage:courses`, `manage:users`
- `hasPermission(role, permission)` lookup

Create `src/lib/auth/service-guard.ts`:
- `requireServiceAuth(permission)` — reads role from Clerk `publicMetadata`, checks permission via `hasPermission()`, returns `null` (authorized) or `NextResponse` (error)

### Step 33: Clerk Middleware

Create `src/proxy.ts` (used as Next.js middleware):

```typescript
import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Protect: /api/sync, /api/recordings, /api/service/*, /(dashboard)/*
const isProtectedRoute = createRouteMatcher([
  "/api/sync(.*)",
  "/api/recordings(.*)",
  "/api/service/(.*)",
  "/(dashboard)/(.*)",
]);

export default clerkMiddleware(async (auth, req) => {
  if (isProtectedRoute(req)) {
    await auth.protect();
  }
});
```

### Step 34: Apply Auth to Routes

Apply `requireAdmin()` to POST and GET handlers in `src/app/api/sync/route.ts` and POST handler in `src/app/api/recordings/route.ts`.

### Step 35: Auth Tests

| Test File | Coverage |
|-----------|----------|
| `tests/unit/auth-middleware.spec.ts` | 401 unauthenticated, 403 non-admin, pass-through for admin |
| `tests/contract/auth-protection.contract.spec.ts` | All protected endpoints reject unauthorized access |

---

## Part 10: Utility Modules

### Step 36: API Error Response

Create `src/lib/utils/api-error.ts`:

```typescript
export function createErrorResponse(status: number, errorCode: string, message?: string): NextResponse;
```

### Step 37: Standardized API Responses

Create `src/lib/utils/api-response.ts` with `createErrorResponse()`, `createSuccessResponse()`, `ErrorCodes`, and `ApiResponse<T>` type — includes meta-data (requestId, timestamp, version).

### Step 38: Request ID

Create `src/lib/utils/request-id.ts` with RFC4122 v4 UUID generation and external correlation ID support via `x-request-id` header.

### Step 39: API Logger

Create `src/lib/utils/api-logger.ts` — structured request logging via Rollbar with PII-safe scrubbing.

---

## Part 11: E2E & Polish

### Step 40: E2E Test

Create `tests/e2e/sync-flow.spec.ts` — full sync flow from API trigger to HTML file generation (Playwright).

### Step 41: Performance Validation

Run sync with mock data (~500 records) and verify completion within target (<5 minutes).

### Step 42: Security Hardening

- Audit PII filtering (UserProfile.email excluded from Rollbar/logs)
- Verify API key not exposed in client-side code or error responses
- Validate all SMTP credentials are secrets-only

### Step 43: Documentation

Add JSDoc documentation to all public functions in `client.ts`, `orchestrator.ts`, `populator.ts`.

---

## Troubleshooting

### Sync Fails with "HEMERA_SERVICE_TOKEN is not configured"

**Solution**: Set `HEMERA_SERVICE_TOKEN` in `.env.local` with a valid service credential for the `aither-service@hemera-academy.com` user.

### Sync Returns 409 "Already Running"

**Solution**: A previous sync is still executing or the mutex was not released. The auto-release timeout defaults to 30 minutes. Check `GET /api/sync` for the current job status.

### Template Population Returns Empty HTML

**Solution**: Verify that the Handlebars placeholders in the hemera.academy template match the data keys. Check `registerMediaHelpers()` is called at startup.

### Email Notifications Not Sent

**Solution**: Verify SMTP configuration in `.env.local` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `NOTIFY_FROM`, `NOTIFY_TO`). Check `NOTIFY_FAILURE_THRESHOLD` — emails are sent only after N consecutive failures (default: 3).

### Hash Manifest Shows All Files as Changed

**Solution**: The manifest file (`output/.sync-manifest.json`) may be missing or corrupted. Delete it and re-run sync — all files will be regenerated on the first run after deletion.

---

## Implementation Status

| Phase | User Story | Status |
|-------|-----------|--------|
| 1 — Setup | Shared infrastructure | ✅ Complete |
| 2 — Foundational | Types, schemas, client, config | ✅ Complete |
| 3 — US1 | Retrieve & populate academy data | ✅ Complete |
| 4 — US1c | Serve media content | ✅ Complete |
| 5 — US1b | Transmit recording URLs | ✅ Complete |
| 6 — US2 | Scheduled automatic sync | ✅ Complete |
| 7 — US3 | Error handling & sync status | ✅ Complete |
| 8 — US4 | Access control | ✅ Complete |
| 9 — Polish | JSDoc, E2E, security | Partial (T051–T056 open) |
