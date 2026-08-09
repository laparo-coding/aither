---
name: push
description: Lint, test, commit, push, open PR, resolve reviews, merge to main
---
## Pre-flight
- Run lint, format check, typecheck, spellcheck, build, and tests; stop on failure.
- Run Codacy analysis (`codacy_cli_analyze`) on all changed files; fix new issues or document false positives.
- Update `specs/<id-slug>/tasks.md` if feature work is complete or task status changed.

## Commit & Push
- Review the diff, current branch, remote, and changed files before committing.
- Use conventional commit messages: `type(scope): summary` (e.g. `feat(playback): add SSE monitor`, `fix(auth): correct token refresh`).
- Use feature branch names like `<NNN>-<short-slug>` (e.g. `011-playback-sync`).
- Commit and push only after explicit user confirmation.

## Pull Request
- Open or update the pull request with a clear description linking to the spec.
- Start as draft if CI is not yet green; mark ready when checks pass.
- Wait for required CI checks (Codacy, tests, coverage) and approvals.
- If CodeRabbit reviews are enabled, read the walkthrough, address critical security and error-handling suggestions before merge.

## Deployment
- If a deployment is required, first ask for explicit user confirmation of target environment and release version, then use the manual release workflow.

## Merge
- Resolve review comments without bypassing branch protection.
- Use squash-merge to keep main history clean.
- Merge only after explicit user confirmation and verified required checks.
