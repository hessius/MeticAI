Agent Skill: Testing, Build & Debugging

This skill defines the commands and workflows required to verify code changes, run tests, and manage the local Docker environment.

# 1. Complete Local Test Workflow (The Gate)

Run this sequence before pushing any code to trigger CI:

1. Python unit tests

cd apps/server && TEST_MODE=true .venv/bin/pytest test_main.py -x -q

2. Python logging tests

TEST_MODE=true .venv/bin/pytest test_logging.py -x -q

3. Web unit tests + linter (0 errors required; warnings are OK)

cd ../web && bun run lint && bun run test:run

4. Build container from local source and start

cd ../.. && docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache 

&& docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

5. Health check

docker exec meticai curl -sf http://localhost:3550/health

6. E2E integration tests against the running container (CI Gate)

cd apps/web && BASE_URL=http://localhost:3550 npx playwright test e2e/verify-tasks.spec.ts

7. API integration tests

BASE_URL=http://localhost:3550 npx playwright test e2e/api-integration.spec.ts

# 2. Live Machine Integration (Optional)

If the physical machine is reachable, run the live integration tests.
  bash cd apps/server && METICULOUS_IP=192.168.50.168 TEST_INTEGRATION=true .venv/bin/pytest test_integration_machine.py -v   

3. Raspberry Pi Test Device Access

To test directly on the Pi 4B (hallon):
  bash sshpass -p ***REMOVED*** ssh pi@192.168.50.22   

4. Debugging Quick Reference

Task - Command

- Container logs
docker logs meticai -f

- s6 service status
docker exec meticai s6-rc -a list

- Restart single service
docker exec meticai s6-svc -r /run/service/server

- MCP server logs
docker exec meticai cat /var/log/mcp-server.log