# Agent Skill: Testing, Build & Debugging

> **Full conventions:** See `.github/CONVENTIONS.md` for all project rules.

This skill defines the commands and workflows required to verify code changes, run tests, and manage the local Docker environment.

## 1. Complete Local Test Workflow (The Gate)

Run the smallest targeted command that covers the change first. Before pushing, run the full local gate:

1. Shared core tests and typecheck

```bash
cd packages/core && bun test && bun run typecheck
```

2. Bun server tests and typecheck

```bash
cd apps/bun-server && bun test && bun run typecheck
```

3. Web unit tests + linter (0 errors required; warnings are OK)

```bash
cd apps/web && bun run lint && bun run test:run
```

4. Web build

```bash
cd apps/web && bun run build
```

5. Build container from local source and start

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache   && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d
```

6. Health check

```bash
docker exec meticai /app/metic healthcheck
curl -sf http://localhost:3550/health
```

7. E2E integration tests against the running container

```bash
cd apps/web && BASE_URL=http://localhost:3550 npx playwright test e2e/verify-tasks.spec.ts e2e/api-integration.spec.ts
```

## 2. Live Machine Integration (Optional)

If the physical machine is reachable, verify affected machine API behavior against the running container. Live telemetry uses `/api/ws/live`; the Bun server connects upstream to the Meticulous machine over Socket.IO.

## 3. Raspberry Pi Test Device Access

To test directly on the Pi 4B (hallon):

```bash
ssh pi@hallon   # Requires SSH key auth configured (see ~/.ssh/config)
```

## 4. Debugging Quick Reference

| Task | Command |
|---|---|
| Container logs | `docker logs meticai -f` |
| Restart container | `docker compose restart meticai` or `docker restart meticai` |
| Health endpoint | `curl -sf http://localhost:3550/health` |
| Binary healthcheck | `docker exec meticai /app/metic healthcheck` |

## 5. Quick Full Gate (Extension Tool)

If the `meticai-guardrails` extension is loaded, you can run `meticai_run_tests` to execute the full gate in one command.
