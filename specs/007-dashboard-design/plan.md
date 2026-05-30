# Implementation Plan: 007 — Dashboard Design

**Branch**: `007-dashboard-design` | **Date**: 2026-04-01 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/007-dashboard-design/spec.md`

## Summary

Redesign the Aither dashboard (`src/app/page.tsx`) from a flat table-based layout into a structured four-section card-based composition (A: Course + Material, B: Participants + Slides, C: Controls, D: Camera). Adopt the Hemera design system (MUI theme, design tokens, ThemeRegistry pattern, CSS variables, Google Fonts) to ensure visual coherence between both applications. Reuse the existing camera and endpoint probing logic where possible by extracting shared endpoint configuration and by keeping `CameraSnapshot` as the owner of refresh/reconnect behavior.

## Technical Context

**Language/Version**: TypeScript 5.9, Next.js 16, React 19  
**Primary Dependencies**: MUI 7 (`@mui/material`), Emotion 11, `@mui/material-nextjs` App Router integration  
**Storage**: N/A — stateless; data from Hemera API (course/participants) + local filesystem (slides)  
**Testing**: Vitest for unit tests, Playwright for E2E  
**Target Platform**: Self-hosted Linux service (development on macOS, port 3001)  
**Project Type**: Single Next.js web application  
**Performance Goals**: Initial dashboard load (SSR) < 1.8 s (FCP); sections A–B interactive ≤ 100 ms after hydration; CLS < 0.1  
**Constraints**: No local database (Constitution VII); all data fetched from Hemera API or local filesystem  
**Scale/Scope**: Single page redesign + 6 new dashboard components + shared endpoint config extraction + theme/error-boundary infrastructure

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Test-First Development | ✅ PASS | T014, T017, T017b, and T017c are implemented and validated; test backlog note cleared in this re-check. |
| II. Code Quality & Formatting | ✅ PASS | Biome formatting enforced. TypeScript strict mode active. |
| III. Feature Development Workflow | ✅ PASS | Spec, research, data model, contracts, quickstart, and task list exist for the feature. |
| IV. Authentication & Security | ✅ PASS | No new auth surface. Existing Hemera API auth and sanitized monitoring stay unchanged. |
| V. Component Architecture | ✅ PASS | Hemera design system adopted through tokens, theme, ThemeRegistry, CSS variables, and shared component structure. |
| VI. Holistic Error Handling | ✅ PASS | Feature scope includes route-level fallback UI plus App Router `error.tsx` and `global-error.tsx`. |
| VII. Stateless Architecture | ✅ PASS | Dashboard remains read-only against Hemera API and local slide files. No persistence added. |
| VIII. HTML Playback | ⬜ N/A | No playback contract changes introduced. |
| IX. Aither Control API | ⬜ N/A | No new Aither control endpoints added. |
| X. Language Policy | ✅ PASS | Code and comments remain English; UI labels remain German. |

**Gate result: PASS** — Principle I test coverage items (T014, T017, T017b, T017c) are complete and validated.

### Post-Design Re-Check (after Phase 1)

| Principle | Status | Post-Design Notes |
|-----------|--------|-------------------|
| I. Test-First | ✅ PASS | Contracts are covered by implemented tests; T014, T017, T017b, and T017c are present and validated in the current repository state. |
| II. Code Quality | ✅ PASS | TypeScript strict mode and Biome remain the quality baseline. |
| III. Feature Workflow | ✅ PASS | `research.md`, `data-model.md`, `contracts/components.md`, and `quickstart.md` are present and aligned to the refilled plan. |
| V. Component Architecture | ✅ PASS | Design tokens, theme wrapper, dashboard sections, and shared endpoint config are part of the planned structure. |
| VI. Error Handling | ✅ PASS | Error boundary files are included in the source structure and tracked in the task list. |
| VII. Stateless Architecture | ✅ PASS | The design continues to consume existing APIs and filesystem outputs only. |
| X. Language Policy | ✅ PASS | No deviation introduced by the design artifacts. |

**Post-design gate result: PASS** — Principle I checks are now aligned with implemented and validated test coverage.

## Project Structure

### Documentation (this feature)

```text
specs/007-dashboard-design/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── components.md    # Component interface contracts
└── tasks.md             # Phase 2 output (re-baselined checklist)
```

### Source Code (repository root)

```text
src/
├── app/
│   ├── error.tsx                           # App Router error boundary
│   ├── global-error.tsx                    # Global error boundary
│   ├── globals.css                         # Hemera CSS variables + font imports
│   ├── layout.tsx                          # ThemeRegistry wiring
│   ├── page.tsx                            # Refactored dashboard composition
│   └── components/
│       ├── dashboard/
│       │   ├── section-a-course-card.tsx
│       │   ├── section-a-material-card.tsx
│       │   ├── section-b-participants-list.tsx
│       │   ├── section-b-slides-list.tsx
│       │   ├── section-c-steuerung-cards.tsx
│       │   ├── section-d-camera-card.tsx
│       │   └── types.ts
│       ├── theme/
│       │   ├── design-tokens.ts
│       │   ├── theme.ts
│       │   └── ThemeRegistry.tsx
│       ├── camera-snapshot.tsx             # Existing; owns reconnect / refresh behavior
│       ├── endpoint-config.ts              # Shared monitored endpoint definitions
│       ├── endpoint-status.tsx             # Existing probe logic reused by cards
│       ├── slide-generate-button.tsx       # Existing
│       └── slide-thumbnails.tsx            # Existing
└── lib/
    └── (no new persistence or service layer required)

tests/
├── e2e/
│   └── dashboard-layout.spec.ts           # Planned viewport regression coverage
└── unit/
    ├── camera-snapshot.spec.ts            # Existing camera loading/reconnect coverage
    ├── dashboard-course-card.spec.ts
    ├── dashboard-material-card.spec.ts
    ├── dashboard-participants-list.spec.ts
    ├── dashboard-slides-list.spec.ts      # Planned
    ├── dashboard-steuerung-cards.spec.ts  # Planned
    ├── dashboard-camera-card.spec.ts      # Planned
    ├── endpoint-status-probe.spec.ts      # Existing endpoint probe coverage
    └── theme-tokens.spec.ts
```

**Structure Decision**: Single-project Next.js layout. New dashboard sections live under `src/app/components/dashboard/`, shared theme infrastructure under `src/app/components/theme/`, and reused probe/camera logic stays in the existing component layer for incremental adoption.

## Complexity Tracking

No constitution violations require justification. Remaining delivery risk is limited to finishing the unimplemented coverage and aligning `CameraSnapshot` refresh/backoff behavior with the Section D contract.
