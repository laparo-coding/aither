# aither

## Development

- **Open in VS Code**: if you installed the `code` CLI, run:

```bash
npm run open:code
```

- **Python tools** (optional, for `specify` CLI): the repository uses a local virtualenv at `.venv`. Activate it with:

```bash
source .venv/bin/activate   # macOS / Linux
specify --help
```

## Data Sync (005-data-sync)

Aither synchronizes course data from the Hemera API and generates static HTML pages for trainers.

### Architecture

```
Cron / curl POST /api/sync
        ↓
   Mutex (409 on overlap)
        ↓
   selectNextCourse() → next course by start date
        ↓
   Hemera API: GET /api/service/courses/:id
        ↓
   Hash-based comparison (.sync-manifest.json)
        ↓  (only when changed)
   Handlebars template → HTML into output/courses/
        ↓
   Update manifest
```

### API Endpoints

| Method | Path | Description | Status |
|---------|------|-------------|--------|
| POST | `/api/sync` | Start sync (fire-and-forget) | 202 / 409 |
| GET | `/api/sync` | Fetch the latest job status | 200 / 404 |

### Incremental Sync

- File hashes are stored in `output/courses/.sync-manifest.json`
- When the data has not changed, HTML generation is skipped (`filesSkipped`)
- Corrupted manifests are logged as Rollbar warnings and rebuilt

### Homepage (SSR)

The home page (`src/app/page.tsx`) renders the next course with a participant table via server-side rendering.

### Quickstart

See [`specs/005-data-sync/quickstart.md`](specs/005-data-sync/quickstart.md) for 7 verification steps.

### Cron-Scheduling

See [`docs/sync-scheduling.md`](docs/sync-scheduling.md) for crontab examples and monitoring guidance.

## Rollbar API Tokens

**Important:** Use a minimally scoped Rollbar token for AI tools, automation, and monitoring whenever possible.

**Client note:** If `NEXT_PUBLIC_ROLLBAR_ENABLED=1` is set, `NEXT_PUBLIC_ROLLBAR_CLIENT_TOKEN` must also be set. Otherwise browser initialization fails. The client token should be read-only and must not allow sensitive data changes.

- `ROLLBAR_ACCESS_TOKEN` (read+write): Use only when write access is genuinely required.
- `ROLLBAR_ACCESS_TOKEN_READONLY` (recommended): A read-only token is sufficient for most integrations. Create it in the Rollbar dashboard under "Project Access Tokens" and set it in `.env` as `ROLLBAR_ACCESS_TOKEN_READONLY`.

**Example `.env` entry:**

```env
# Rollbar for AI tools (recommended: read-only)
ROLLBAR_ACCESS_TOKEN_READONLY=your-rollbar-readonly-token
# Only if write access is required:
# ROLLBAR_ACCESS_TOKEN=your-rollbar-read-write-token
```

**Note:** The application and all automation should prefer the read-only token whenever possible. Write-capable actions should be limited to special admin or deployment workflows.

