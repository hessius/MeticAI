# Agent Skill: Release Workflow

This skill defines the release process for MeticAI versions.

## 1. Pre-Release Checklist

Before bumping to a release version:
- All tests pass (backend: `cd apps/server && TEST_MODE=true .venv/bin/python -m pytest test_main.py -q`, frontend: `cd apps/web && bun run test:run`)
- Lint clean: `cd apps/web && bun run lint`
- Build succeeds: `cd apps/web && bun run build`
- CI is green on the version branch
- All PR review comments addressed (including suppressed threads)
- No deferred tasks remain

## 2. Version Bump

**Both files must be updated together:**
1. `VERSION` — root file, e.g., `2.2.0`
2. `apps/web/package.json` — `"version": "2.2.0"`

Version progression:
- `2.2.0-beta.1` → `2.2.0-beta.N` (development)
- `2.2.0-rc.1` (release candidate, optional)
- `2.2.0` (final release)

## 3. Release Steps

1. Ensure `version/X.Y.Z` branch is up to date and CI is green.
2. Bump both `VERSION` and `apps/web/package.json` to final version.
3. Commit: `chore(release): bump version to X.Y.Z`
4. Push and wait for CI green.
5. Create PR from `version/X.Y.Z` → `main`.
6. PR description should include full changelog since last release.
7. Merge PR (squash or merge commit, per team preference).
8. Auto-release workflow creates GitHub Release and Docker image from the `VERSION` file.

## 4. Post-Release

1. Update `pages` branch with release notes (new feature cards, "What's New" section).
2. Create next milestone branch if needed: `version/X.Y+1.0`.
3. Close the milestone on GitHub.

## 5. Hotfix Process

For critical fixes after release:
1. Branch from `main`: `fix/<issue-name>`
2. Fix, test, push, CI green.
3. PR into `main`.
4. Bump patch version in both VERSION and `apps/web/package.json`.

## References

- Auto-release workflow: `.github/workflows/auto-release.yml`
- Build workflow: `.github/workflows/build-publish.yml`
- Full conventions: `.github/CONVENTIONS.md`
