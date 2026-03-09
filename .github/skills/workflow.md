# Agent Skill: Workflow & Execution

This skill defines the autonomous loop for executing items in `tasks.md`. Follow these phases strictly.

## 1. Safety Rules (Non-Negotiable)
- **No destructive operations** without a feature branch.
- **No secrets in commits.**
- **No bulk file deletion.**
- **Wait for explicit release instructions.** Do not merge release PRs or create tags without confirmation.
- **Milestone work** belongs on `version/X.Y.Z` branches. Major features branch from there as `feat/<name>`.

## 2. Execution Phases (The Loop)

### Phase 1 — Pick
Read `tasks.md` top to bottom. Find the first unchecked `[ ]` item. If items lack checkboxes, format them correctly.

### Phase 2 — Work
1. **Commit early** using Conventional Commits. Do not push during development.
2. **Verify locally:** Load the `testing.md` skill to find the right test commands.
3. **Verify live (UI/API):** Open `http://localhost:3550` and confirm 0 console errors. Run Playwright E2E tests against the running container.
4. **Machine Integration:** For anything touching MQTT or live telemetry, use MCP tools to test live machine communication. 
5. **Log assumptions** in the `tasks.md` Notes section.

### Phase 3 — Cleanup
Before pushing, ensure:
- No debug/stale files or `console.log`s remain.
- If `apps/web/package.json` changed, `bun.lock` is updated and committed.
- Version bumps in `VERSION` are done if required.

### Phase 4 — Push & CI
1. Push all commits at once.
2. Monitor GitHub CI. Fix locally if code fails; re-run if infrastructure fails.
3. Once green, rebuild the local container (check the `testing.md` skill for the `--no-cache` docker compose command).

### Phase 5 — Mark Done
1. Update `tasks.md`: change `[ ]` to `[x]` and append a 1-sentence completion note.
2. Move completed tasks to the Completed section immediately.
3. Loop back to Phase 1.

### Phase 6 — Retrospective (End of Session)
Review the session for friction. Propose workflow updates or update `tasks.md` directly. 
Finally, notify the user that the session is done by executing this terminal command on their Mac:
`osascript -e 'display notification "All tasks complete" with title "Copilot Agent"'`

## 3. Pull Requests
Open PRs with a Summary, How to test, and Assumptions/Open Questions. Post a PR comment summarizing changes for substantial multi-file updates.