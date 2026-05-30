# Data Model: Data Synchronization

**Feature**: 005-data-sync
**Status**: Complete

## Overview

Aither is stateless (Constitution VII — NON-NEGOTIABLE). All persistent data lives in flat files
under `output/`. There is no local database. Data flows from Hemera via REST API into typed
in-memory structures, then renders to static HTML files and the homepage.

## Entity Relationship Diagram

```
Hemera API                     Aither (in-memory)                  Output
───────────                    ──────────────────                  ──────
GET /courses ─────────────►  ServiceCourse[]                       
     │                              │                              
     │   selectNextCourse()         ▼                              
     │                        ServiceCourse (one)                  
     │                              │                              
GET /courses/[id] ────────►  ServiceCourseDetail                   
     │                         ├── course fields                   
     │                         └── participants[]                  
     │                              │                              
     │   computeContentHash()       ▼                              
     │                        hash comparison                      
     │                              │ (changed?)                   
     │                              ▼                              
     │   populateTemplate()   Handlebars ──────────►  output/courses/<slug>.html
     │                                                output/.sync-manifest.json
     │                              │                              
     │   page.tsx (SSR)       React JSX ───────────►  HTTP response (live)
```

## External Types (from Hemera API)

### ServiceCourse

Returned by `GET /api/service/courses`. Already defined in `src/lib/hemera/schemas.ts`.

```typescript
interface ServiceCourse {
  id: string;
  title: string;
  slug: string;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  startDate: string;       // ISO 8601
  endDate: string;         // ISO 8601
  participantCount: number;
}
```

### ServiceCourseDetail

Returned by `GET /api/service/courses/[id]` (extended). **NEW** — must be created.

```typescript
interface ServiceCourseDetail {
  id: string;
  title: string;
  slug: string;
  level: 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED';
  startDate: string;
  endDate: string;
  participants: ServiceParticipant[];
}
```

### ServiceParticipant

Nested within `ServiceCourseDetail.participants`. **NEW** — must be created.

```typescript
interface ServiceParticipant {
  participationId: string;             // CourseParticipation ID
  userId: string;                      // Clerk user ID
  name: string | null;                 // from booking.user.name join (nullable)
  status: string;                      // participation status
  preparationIntent: string | null;    // what the participant wants to learn
  desiredResults: string | null;       // expected outcomes
  lineManagerProfile: string | null;   // manager context
  preparationCompletedAt: string | null; // ISO 8601 or null
}
```

## Zod Schemas

All new schemas go in `src/lib/hemera/schemas.ts`:

```typescript
import { z } from 'zod';

export const ServiceParticipantSchema = z.object({
  participationId: z.string(),
  userId: z.string(),
  name: z.string().nullable(),
  status: z.string(),
  preparationIntent: z.string().nullable(),
  desiredResults: z.string().nullable(),
  lineManagerProfile: z.string().nullable(),
  preparationCompletedAt: z.string().nullable(),
});

export const ServiceCourseDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  slug: z.string(),
  level: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  startDate: z.string(),
  endDate: z.string(),
  participants: z.array(ServiceParticipantSchema),
});

export const ServiceCourseDetailResponseSchema = z.object({
  data: ServiceCourseDetailSchema,
  meta: z.object({
    requestId: z.string().optional(),
  }).optional(),
});
```

TypeScript types are derived via `z.infer`:

```typescript
export type ServiceParticipant = z.infer<typeof ServiceParticipantSchema>;
export type ServiceCourseDetail = z.infer<typeof ServiceCourseDetailSchema>;
```

## Internal Types

### NextCourseSyncData

The in-memory structure passed through the sync pipeline. **NEW** — in `src/lib/sync/types.ts`.

```typescript
interface NextCourseSyncData {
  course: ServiceCourseDetail;
  fetchedAt: string;          // ISO 8601
  contentHash: string;        // SHA-256 of serialized course + participants
}
```

### DataSyncJob (extends SyncJob)

Extension of the existing `SyncJob` type for the data-sync pipeline. **NEW** — in `src/lib/sync/types.ts`.
Field names and structure align with the OpenAPI contract in `contracts/sync-api.yaml`.

```typescript
interface DataSyncJob {
  jobId: string;              // UUID
  status: 'running' | 'success' | 'failed';
  startTime: string;          // ISO 8601
  endTime: string | null;
  durationMs: number | null;
  courseId: string | null;
  noUpcomingCourse: boolean;
  participantsFetched: number;
  filesGenerated: number;
  filesSkipped: number;       // unchanged (hash match)
  errors: SyncError[];
}
```

## Sync Manifest

**File**: `output/.sync-manifest.json`

The existing manifest format from `src/lib/sync/hash-manifest.ts` is reused. For the data-sync
pipeline, the manifest tracks a single course entity:

```json
{
  "lastSyncAt": "2026-02-21T14:30:00.000Z",
  "durationMs": 2340,
  "entities": {
    "courses": {
      "cm5abc123def456ghi": {
        "hash": "sha256:a1b2c3d4...",
        "updatedAt": "2026-02-21T14:30:00.000Z",
        "outputPath": "output/courses/gehaltsgespraech.html"
      }
    }
  }
}
```

### No Upcoming Course

When `selectNextCourse()` returns null, the manifest is NOT modified and the sync response includes:

```json
{
  "status": "success",
  "courseId": null,
  "noUpcomingCourse": true,
  "participantsFetched": 0,
  "filesGenerated": 0,
  "filesSkipped": 0
}
```

Existing `output/` files from a previous sync remain untouched.

## State Transitions

### Sync Job Lifecycle

```
POST /api/sync
     │
     ▼
  [running] ──── selectNextCourse() returns null ────► [completed] (noUpcomingCourse: true)
     │
     ▼
  fetch course detail
     │
     ▼
  compute hash
     │
     ├── hash matches manifest ────► [completed] (filesSkipped: 1)
     │
     ▼
  populate template + write HTML
     │
     ▼
  update manifest
     │
     ▼
  [completed] (filesGenerated: 1)
     │
  (on any error)
     │
     ▼
  [failed] + SyncError[]
```

### Concurrent Sync Guard

The API route uses an in-memory mutex (existing pattern in `route.ts`):
- Second POST while sync is running → `409 Conflict`
- Mutex auto-releases after 30 min timeout (safety net)

## Validation Rules

| Field | Rule | Source |
|-------|------|--------|
| `ServiceCourse.id` | Non-empty string (CUID) | Hemera DB |
| `ServiceCourse.startDate` | Valid ISO 8601 | Zod `.string()` + runtime parse |
| `ServiceParticipant.name` | Non-empty string or null | Hemera `user.name` join |
| `ServiceParticipant.preparationIntent` | Nullable string | Hemera participation field |
| `ServiceParticipant.preparationCompletedAt` | Nullable ISO 8601 | Hemera participation field |
| `contentHash` | `sha256:` prefixed hex | `computeContentHash()` |
| `DataSyncJob.id` | UUID v4 | `crypto.randomUUID()` |
| Manifest file | Valid JSON, writable path | `writeManifest()` |

## Template Data Shape

The Handlebars template (`course-detail.hbs`) receives this context object:

```typescript
interface CourseDetailTemplateData {
  course: {
    title: string;
    slug: string;
    level: string;
    startDate: string;       // formatted for display
    endDate: string;         // formatted for display
  };
  participants: Array<{
    name: string;
    preparationIntent: string | null;
    desiredResults: string | null;
    lineManagerProfile: string | null;
    preparationCompleted: boolean;  // derived from preparationCompletedAt !== null
  }>;
  generatedAt: string;        // ISO 8601 of generation time
}
```

### Template Layout

The `course-detail.hbs` template renders two sections:

1. **Course Details** — Key-value table with rows: Course (title), Slug, Level, Start Date, End Date.
2. **Participants & Preparations** — Columnar table with columns: Name, Preparation Intent, Desired Results, Line Manager Profile, Preparation Completed (Yes/No). Null fields display "–".

### Example Template Data (JSON)

```json
{
  "course": {
    "title": "Conducting Salary Negotiations",
    "slug": "gehaltsgespraech",
    "level": "INTERMEDIATE",
    "startDate": "15.03.2026",
    "endDate": "16.03.2026"
  },
  "participants": [
    {
      "name": "Max Mustermann",
      "preparationIntent": "I want to learn how to negotiate my salary.",
      "desiredResults": "A 10% salary increase",
      "lineManagerProfile": "Teamleiterin, 5 Jahre Erfahrung",
      "preparationCompleted": true
    },
    {
      "name": "Erika Muster",
      "preparationIntent": null,
      "desiredResults": null,
      "lineManagerProfile": null,
      "preparationCompleted": false
    }
  ],
  "generatedAt": "2026-02-21T14:30:00.000Z"
}
```
