# Quickstart: 007 — Dashboard Design

**Branch**: `007-dashboard-design`

## Prerequisites

- Node.js 20.19+ and npm
- Aither repo checked out on `007-dashboard-design` branch
- Hemera API running on port 3000 (for course data)
- Environment: `HEMERA_API_BASE_URL=http://localhost:3000`

## Quick Setup

```bash
cd /path/to/aither
git checkout 007-dashboard-design
npm install
```

## Development

```bash
npm run dev
# Dashboard loads at http://localhost:3001
```

## Testing

```bash
# Unit tests (new dashboard component tests)
npx vitest run 'tests/unit/dashboard-*.spec.ts'
npx vitest run tests/unit/theme-tokens.spec.ts

# All unit tests
npm test

# E2E test (dashboard layout)
npx playwright test tests/e2e/dashboard-layout.spec.ts
```

## Key Files

| File | Purpose |
|------|---------|
| `src/app/page.tsx` | Dashboard page (Server Component, refactored layout) |
| `src/app/layout.tsx` | Root layout (updated with ThemeRegistry) |
| `src/app/globals.css` | Hemera CSS variables + font imports |
| `src/app/components/theme/design-tokens.ts` | Hemera color/spacing/typography tokens |
| `src/app/components/theme/theme.ts` | MUI theme configuration |
| `src/app/components/theme/ThemeRegistry.tsx` | Emotion + ThemeProvider wrapper |
| `src/app/components/dashboard/section-a-course-card.tsx` | Course info card |
| `src/app/components/dashboard/section-a-material-card.tsx` | Material status card |
| `src/app/components/dashboard/section-b-participants-list.tsx` | Participants with avatars |
| `src/app/components/dashboard/section-b-slides-list.tsx` | Slide file list |
| `src/app/components/dashboard/section-c-steuerung-cards.tsx` | Endpoint health cards |

## Implementation Order

1. Theme infrastructure (design tokens → theme → ThemeRegistry → layout.tsx + globals.css)
2. Section A components (CourseCard, MaterialCard)
3. Section B components (ParticipantsList, SlidesList)
4. Section C component (SteuerungCards)
5. page.tsx refactor (compose sections with CSS Grid layout)
6. Unit tests for all components
7. E2E test for dashboard layout
