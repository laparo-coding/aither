# Data Model: 007 — Dashboard Design

**Date**: 2026-03-25 | **Branch**: `007-dashboard-design`

## Overview

This feature introduces no new data entities or persistence. All data is
fetched from existing sources (Hemera API + local filesystem). This document
describes the data shapes consumed by the dashboard components.

## Data Sources (read-only)

### ServiceCourseDetail (from Hemera API)

Existing type — no changes. Note: the Hemera API does not expose `createdAt` on this type. Course tie-breaking for the dashboard uses `startDate` → `id` only.

```typescript
interface ServiceCourseDetail {
  id: string
  title: string
  slug: string
  level: "BEGINNER" | "INTERMEDIATE" | "ADVANCED"
  startDate: string | null
  endDate: string | null
  participants: ServiceParticipant[]
}
```

### ServiceParticipant (from Hemera API)

Existing type — no changes.

```typescript
interface ServiceParticipant {
  participationId: string
  userId: string
  name: string | null
  status: string
  preparationIntent: string | null
  desiredResults: string | null
  lineManagerProfile: string | null
  preparationCompletedAt: string | null
}
```

### SlideStatus (local filesystem)

Existing type — no changes.

```typescript
interface SlideStatus {
  status: "generated" | "not-generated"
  slideCount: number
  lastUpdated: string | null
  files: string[]
  courseId: string | null
}
```

## New Types

### Design Tokens (UI configuration)

```typescript
/** Hemera color palette for Aither UI */
interface HemeraColors {
  marsala: string       // #884143
  marsalaLight: string  // #A05A5C
  marsalaDark: string   // #6B3234
  bronze: string        // #926A49
  rosyBrown: string     // #bc8f8f
  beige: string         // #EBE2D3
  lightBlack: string    // #2D2D2D
  white: string         // #FFFFFF
  infoMain: string      // #5B9A8B (sage green)
  lightGray: string     // #E5E5E5
}

/** Hemera spacing tokens */
interface HemeraSpacing {
  sectionPy: { xs: number; md: number }         // { xs: 6, md: 10 }
  sectionPyCompact: { xs: number; md: number }   // { xs: 4, md: 6 }
  containerMaxWidth: "lg"
}
```

### Component Props

```typescript
/** Section A — Course Information Card */
interface CourseCardProps {
  course: ServiceCourseDetail
}

/** Section A — Material Status Card */
interface MaterialCardProps {
  slideStatus: SlideStatus
}

/** Section B — Participant Preparations List */
interface ParticipantsListProps {
  participants: ServiceParticipant[]
}

/** Section B — Course Slides List */
interface SlidesListProps {
  slideStatus: SlideStatus
}

/** Section C — Controls Cards (no props — self-contained client component) */
// Shared endpoint config + probe result reused with visual restructuring

interface EndpointDef {
  label: string
  path: string
  method: "GET" | "POST"
  group: string
  probeMethod?: "HEAD" | "GET"
  fallbackToGetOnHeadUnsupported?: boolean
}

interface EndpointResult {
  status: "checking" | "reachable" | "error"
  code?: number
  probeMethod?: "HEAD" | "GET"
}
```

## State Transitions

Primary data (course detail, slide status) is fetched once at SSR time and rendered statically. Client components manage independent polling and interaction state:

- **ControlsCards**: Polls endpoints every 10 s; per-endpoint state cycles through `checking → reachable | error` with HEAD→GET fallback.
- **CameraSnapshot**: Polls `/api/recording/snapshot` with additive backoff on failure (10 s → 20 s → 30 s cap); resets on success; pauses when tab hidden.
- **SlideGenerateButton**: Self-contained generation trigger with internal loading/success/error state.
- **ParticipantsList**: Client-side expand/collapse toggling of participant detail panels.

## Validation Rules

No new validation — existing Zod schemas in `src/lib/hemera/schemas.ts`
validate all API responses before they reach dashboard components.
