# MeticAI Project Conventions

> **This is the single source of truth for all project rules and conventions.**
> All agent configuration files (CLAUDE.md, AGENTS.md, GEMINI.md, copilot-instructions.md) reference this document.
> When in doubt, this file wins.

---

## Versioning

- The root `VERSION` file and `apps/web/package.json` version **must always be bumped together**.
- Changing `VERSION` triggers the auto-release workflow (`.github/workflows/auto-release.yml`).
- Version format: `MAJOR.MINOR.PATCH` with optional `-beta.N` or `-rc.N` suffixes.
- Release progression: `beta.1` → `beta.N` → `rc.1` → release (remove suffix).

## Branch Naming

| Purpose | Pattern | Example |
|---------|---------|---------|
| Milestone work | `version/X.Y.Z` | `version/2.2.0` |
| Feature branch | `feat/<name>` | `feat/temp-variables` |
| Website updates | `website/<name>` | `website/v2.2-redesign` |
| Bugfix | `fix/<name>` | `fix/cache-overflow` |
| Pages deployment | `pages` | `pages` (protected) |

- Feature branches are created from their parent milestone branch, not from `main`.
- The `pages` branch is completely separate — it contains only static website files, not based on `main`.

## Quality Gates

These are **non-negotiable**. Every PR, every push, every completion claim:

1. **CI must be completely green.** The Test Suite has 6 jobs (Web Tests, Server Tests, Code Quality, Pester, Web E2E, Docker Build Test) plus a separate Build and Publish workflow. All must pass.
2. **Zero tech debt.** Address all issues immediately. Never defer tasks to "later".
3. **No deferred tasks.** If a task is in scope, it gets done now — not added to a backlog.
4. **All code review comments addressed.** Including suppressed/collapsed threads. Don't dismiss without clear justification.
5. **Tests pass locally before pushing.** Don't rely on CI as your first test run.
6. **Wide review on bug discovery.** When discovering a bug or potential issue, always do a wide review to look for the same or similar issues across the codebase. Bugs are often part of a pattern — fix the pattern, not just the instance.

## Testing

### Backend (Python)
```bash
cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py -x -q
```
- Currently 750+ tests. New code must include tests in `test_main.py`.
- Test both success and failure/edge-case paths.

### Frontend (TypeScript/React)
```bash
cd apps/web && bun run test:run
```
- Currently 277+ tests.
- Lint must be clean: `bun run lint` (0 errors; warnings OK per eslint v7 migration issue #256).
- Build must succeed: `bun run build`.

### Full Local Gate (run before pushing)
```bash
cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py -x -q && \
cd ../web && bun run lint && bun run test:run && bun run build
```

## Commits

- **Format:** [Conventional Commits](https://www.conventionalcommits.org/) — `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, `ci:`.
- **Trailer:** Always include `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`.
- **Scope (optional):** Use parenthetical scope for clarity — `fix(build):`, `feat(profiles):`.
- **Message:** Focus on *why*, not *what*. The diff shows what changed.

## Pull Requests

- Every PR must include: **Summary**, **How to Test**, and **Assumptions/Open Questions**.
- Update the PR description after significant changes (new commits, scope changes).
- Post a PR comment summarizing changes for substantial multi-file updates.
- Reference related issues with `Closes #N` or `Part of #N`.

## Internationalization (i18n)

- **All user-facing strings** must use the `t()` function from `react-i18next`.
- **All 6 locales** must be updated: `en`, `sv`, `de`, `es`, `fr`, `it`.
- Translation files: `apps/web/public/locales/{locale}/translation.json`.
- English is the source locale; other locales should have equivalent keys.

## Dependencies

### Frontend
- Use `bun add <package>` (never `npm install`).
- Always commit `bun.lock` alongside `package.json` changes.
- Bun version is pinned at **1.3.10** in both `docker/Dockerfile.unified` and CI workflows.
- Import from `lucide-react` public paths only (never private `dist` paths).

### Backend
- Pin versions in `apps/server/requirements.txt`.
- Rebuild the container after dependency changes.

## Code Style

### Python (apps/server/)
- PEP 8 strict. Extensive type hints. Google-style docstrings.
- Functions: focused and single-purpose.
- Concurrency: `threading.Lock` for synchronous file I/O, `asyncio.Lock` for async operations.
- Lazy lock creation (`_get_lock()` pattern) to avoid "attached to different loop" errors in tests.

### TypeScript/React (apps/web/)
- Functional components with hooks only. No class components.
- ESLint compliance (react-hooks rules). 5 strict v7 rules downgraded to warn (issue #256).
- Extend shadcn/ui components in `apps/web/src/components/ui/`; don't replace them.
- Mobile-first responsive design.

## Architecture Patterns

- **Dual route registration:** Both `/endpoint` and `/api/endpoint` are registered for every route. This is intentional to support clients that include or omit the `/api` prefix. Not a defect.
- **Unified container:** Single Docker container managed by s6-overlay. Port 3550 is the only exposed port (nginx proxy).
- **Settings hot-reload:** Changing `METICULOUS_IP` or `GEMINI_API_KEY` triggers `s6-svc -r` (service restart, not container restart).
- **Cache bounding:** In-memory caches must be bounded (e.g., 50 entries max). On insert: purge expired, then clear all if still over limit.
- **Safe parsing:** Use helper functions (e.g., `_safe_float()`) for user-provided numeric values. Never trust raw input.

## Release Process

1. Work on `version/X.Y.Z` branch with beta suffixes.
2. Run full test suite locally. Push. Wait for CI green.
3. Bump `VERSION` and `apps/web/package.json` to final version (remove `-beta.N`).
4. Merge `version/X.Y.Z` into `main` via PR.
5. Auto-release workflow creates the GitHub release and Docker image.
6. Update `pages` branch with release notes (via separate PR).

## Domain: Espresso Profiling

- **Barista Persona:** Profile names should be witty, pun-heavy, but clear (e.g., "Slow-Mo Blossom").
- **Profile Generation Output:** Always include "Profile Created:", "Description:", "Preparation:", "Why This Works:", and "Special Notes:".
- **Reference:** See `PROFILING_AXIOMS.md` for extraction principles, stage-based profiling, and exit trigger rules.
- **Profile Variables:** Two types — INFO (`info_` prefix, display-only, emoji names) and ADJUSTABLE (no prefix, user-modifiable types: pressure/flow/weight/power/time).
- **Temporary Profiles:** Managed via `temp_profile_service.py` — create_and_load → cleanup/force_cleanup lifecycle.

## CI Structure

- **Test Suite workflow:** 6 jobs — Web Tests, Server Tests, Code Quality, Pester, Web E2E, Docker Build Test.
- **Build and Publish workflow:** Separate, runs on merge to main.
- **Bun setup in CI:** Uses 3-attempt retry pattern to handle transient download failures.
- **Triggers:** Test Suite runs on PRs to `main`. Build and Publish on push to `main`.

---

*Last updated: 2026-03-11 | Maintained by the MeticAI team and AI agents*
*To add a new convention, use the `learn_convention` extension tool or edit this file directly.*
