# aither Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-02-11

## Active Technologies
- TypeScript 5.9+ on Node.js (Next.js 16+ App Router) + Next.js 16, Clerk auth, Zod, Rollbar (all existing); FFmpeg (system binary) (004-video-recorder)
- Local filesystem (`output/recordings/`), gitignored. In-memory session state (no database). (004-video-recorder)
- TypeScript 5.9.3 + Next.js 16.1.6, React 19.2.4, Zod 3.24, Handlebars 4.7.8, p-throttle 6.2, p-retry 6.2, MUI 6.4 (005-data-sync)
- Flat files only (output/ directory + .sync-manifest.json). No database (Constitution VII). (005-data-sync)
- TypeScript 5.9.3, Next.js 16.1.6, React 19 + Zod (validation), Rollbar (monitoring), HemeraClient (API access), Vitest (testing) (006-participant-slides)
- N/A — stateless, output as HTML files to `output/slides/{courseId}/` (Principle VII) (006-participant-slides)
- TypeScript 5.9.3, Next.js 16.1.6, React 19.2.4 + MUI 7.3.8 (`@mui/material`), Emotion 11.14.0, `@mui/material-nextjs` 7.3.8 App Router integration (007-dashboard-design)
- N/A — stateless; data from Hemera API (course/participants) + local filesystem (slides) (007-dashboard-design)
- TypeScript 5.9, Next.js 16 App Router (server route handlers) + Next.js route handlers, `@vercel/blob` (NEW), Zod, existing recording `session-manager`, `timingSafeEqualString`, Vitest (009-timestamp-endpoint)
- Vercel Blob Storage (dedicated Aither store) for ffmetadata JSON sidecars; no local database (Constitution VII); in-memory recording session state (transient) (009-timestamp-endpoint)

- TypeScript 5.9.3, Node.js (Next.js 16.1.6 with App Router, React 19.2.4) + Zod (validation), Clerk (auth/RBAC), MUI (dashboard UI), Rollbar (error monitoring), Nodemailer (SMTP email notifications) (001-hemera-api-integration)

## Project Structure

```text
src/
tests/
```

## Commands

npm test && npm run lint

## Code Style

TypeScript 5.9.3, Node.js (Next.js 16.1.6 with App Router, React 19.2.4): Follow standard conventions

## Recent Changes
- 009-timestamp-endpoint: Added TypeScript 5.9, Next.js 16 App Router (server route handlers) + Next.js route handlers, `@vercel/blob` (NEW), Zod, existing recording `session-manager`, `timingSafeEqualString`, Vites
- 007-dashboard-design: Added TypeScript 5.9.3, Next.js 16.1.6, React 19.2.4 + MUI 7.3.8 (`@mui/material`), Emotion 11.14.0, `@mui/material-nextjs` 7.3.8 App Router integration
- 006-participant-slides: Added TypeScript 5.9.3, Next.js 16.1.6, React 19 + Zod (validation), Rollbar (monitoring), HemeraClient (API access), Vitest (testing)


<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
