# MeticAI — Agent Instructions

## Session Governance

- If `tasks.md` exists in the workspace root, treat it as the **session source of truth**. It takes precedence over this file in any conflict.
- If `tasks.md` is not present, follow the standards in this file.
- For release-related operations (merge release PRs, publish/delete releases, create/delete release tags, rollback), always stop and **wait for explicit user instruction in the current chat**. "Ready to release" is not permission to release.
- See `tasks.md` for the full session workflow, safety rules, test commands, and current task list.

---

## Project Overview

MeticAI is an AI-powered controller for the Meticulous Espresso Machine. It uses Google Gemini (via the Python SDK) to analyse coffee bag images, interpret roast profiles, and automatically generate espresso shot profiles. A React-based web UI lets users interact with the system, browse shot history, manage profiles, and run pour-over sessions.

**Repository:** https://github.com/hessius/MeticAI
**OPOS recipe format:** https://github.com/hessius/OPOS
**Version file:** `VERSION` (semver string — changing this triggers the auto-release workflow)

---

## Technology Stack

### Core
- **Python 3.13** — FastAPI backend
- **React + TypeScript** — Web frontend (Vite / Bun)
- **Google Gemini Python SDK** (`google-genai`) — AI / vision
- **Docker & Docker Compose** — Single unified container
- **s6-overlay** — Process supervision inside the container
- **nginx** — Reverse proxy, single entry point on port 3550
- **FastMCP** — MCP server for external integrations (optional)

### Key Python packages
See `apps/server/requirements.txt` for pinned versions. Key packages:
- `fastapi` — web framework
- `uvicorn` — ASGI server
- `google-genai` — Gemini SDK for image analysis
- `pyMeticulous` — Meticulous machine API client
- `httpx` — async HTTP client
- `pydantic` — data validation

### Key frontend packages
See `apps/web/package.json`. Key packages:
- `react` / `react-dom` — UI framework
- `vite` / `bun` — build toolchain
- `@tanstack/react-query` — data fetching
- `framer-motion` — animation
- `lucide-react` — icons
- `eslint` v10 + `eslint-plugin-react-hooks` v7 — linting

---

## Architecture

### Unified Container

Everything runs inside a single Docker container (`meticai`) managed by **s6-overlay**. Port **3550** is the only exposed port.

| Internal service | Port | Role |
|---|---|---|
| nginx | 3550 | Serves React SPA; proxies `/api/*` to FastAPI |
| server (FastAPI) | 8000 | Coffee analysis, profile management, scheduling, MQTT commands |
| mcp-server (FastMCP) | 8080 | External MCP integrations (Claude Desktop, Cursor) — optional |
| mosquitto | 1883 | MQTT broker for real-time machine telemetry |
| meticulous-bridge | — | Socket.IO → MQTT bridge (connects to Meticulous machine) |

### Request Flow

```
User / iOS Shortcut → :3550 (nginx) → /api/* → :8000 (FastAPI)
                                      → /*    → React SPA

FastAPI → Gemini Python SDK → profile JSON → Meticulous machine (HTTP)

Meticulous machine ← Socket.IO → meticulous-bridge → MQTT → mosquitto
FastAPI WebSocket /api/ws/live ← MQTT subscriber → browser
```

### Settings Hot-Reload

When `METICULOUS_IP` or `GEMINI_API_KEY` change via the settings UI:
- `os.environ` is updated in-process
- Meticulous API client is reset (`reset_meticulous_api()`)
- `mcp-server` and `meticulous-bridge` services are restarted via s6 (`s6-svc -r`)
- No full container restart required

---

## Project Structure

```
MeticAI/
├── .github/
│   ├── copilot-instructions.md     # This file — project reference for agents
│   └── workflows/                  # CI/CD (tests.yml, build-publish.yml, auto-release.yml)
├── apps/
│   ├── server/                     # FastAPI backend
│   │   ├── main.py                 # App entry point, lifespan, middleware
│   │   ├── config.py               # Central configuration
│   │   ├── logging_config.py       # Structured logging
│   │   ├── prompt_builder.py       # Gemini prompt construction
│   │   ├── api/routes/             # Route modules (coffee, profiles, shots, history,
│   │   │                           #   scheduling, bridge, websocket, commands,
│   │   │                           #   pour_over, recipes, system)
│   │   ├── services/               # Business logic
│   │   │   ├── gemini_service.py
│   │   │   ├── meticulous_service.py
│   │   │   ├── analysis_service.py
│   │   │   ├── cache_service.py
│   │   │   ├── history_service.py
│   │   │   ├── settings_service.py
│   │   │   ├── scheduling_state.py
│   │   │   └── temp_profile_service.py
│   │   ├── models/                 # Pydantic models
│   │   ├── requirements.txt        # Production dependencies (pinned)
│   │   ├── requirements-test.txt   # Test dependencies
│   │   ├── test_main.py            # Main pytest suite (700+ tests)
│   │   ├── test_logging.py         # Logging tests
│   │   └── .venv/                  # Local virtualenv (not committed)
│   ├── web/                        # React + TypeScript frontend (Vite / Bun)
│   │   ├── src/
│   │   │   ├── components/         # React components
│   │   │   ├── views/              # Top-level view components
│   │   │   ├── hooks/              # Custom React hooks
│   │   │   └── lib/                # Utilities, API clients, types
│   │   ├── e2e/                    # Playwright E2E tests
│   │   ├── package.json
│   │   └── bun.lock                # Must be committed and kept in sync with package.json
│   └── mcp-server/                 # FastMCP server for Meticulous communication
├── docker/
│   ├── Dockerfile.unified          # Multi-stage build (web → Python deps → runtime)
│   ├── nginx.conf
│   └── s6-rc.d/                    # s6-overlay service definitions
├── data/                           # Persistent data (profiles, caches, settings)
├── scripts/                        # Install scripts (bash, PowerShell)
├── tests/                          # BATS tests for install scripts
├── docker-compose.yml              # Production compose (pulls from GHCR)
├── docker-compose.dev.yml          # Dev overlay — adds build context for local builds
├── docker-compose.tailscale.yml
├── docker-compose.watchtower.yml
└── VERSION                         # Semver string — triggers auto-release on change
```

---

## Coding Standards

### Python
- Follow PEP 8; use type hints throughout
- Keep functions focused and single-purpose
- Write docstrings for public APIs
- All new code must have tests; aim for full coverage on critical paths
- Test both success and failure paths; include edge cases

### TypeScript / React
- Functional components with hooks; no class components
- Use `eslint-plugin-react-hooks` rules — currently 5 v7 strict rules are downgraded to `warn` (see issue #256); do not introduce new violations
- Imports from `lucide-react` must use the public package path, not private dist paths
- All `bun.lock` changes must be committed alongside `package.json` changes

### Commits
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`
- Commit message body should explain *why*, not just *what*

### UI Design
- All new UI must be responsive — mobile-first, then tablet, then desktop
- Pour-over view has distinct mobile (single-column) and desktop (multi-column) layouts; ensure no overflow at intermediate viewport widths
- Components from `apps/web/src/components/ui/` are from shadcn/ui — extend, do not replace

---

## Build & Run

### Local Development (from source)

```bash
# 1. Clone
git clone https://github.com/hessius/MeticAI.git && cd MeticAI

# 2. Create .env
echo "GEMINI_API_KEY=your_key\nMETICULOUS_IP=meticulous.local" > .env

# 3. Build from local source and run
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

# 4. Open UI
open http://localhost:3550
```

> **Always use `docker-compose.dev.yml` as an overlay for local builds.** The base `docker-compose.yml` uses `image: ghcr.io/...` — without the overlay, `--build` does nothing and you get the remote image.

### Rebuild After Code Changes

```bash
# Full rebuild (no cache) — use after dependency changes
docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache \
  && docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# Quick rebuild — use after code-only changes
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build
```

### Quick Install (end-user)

```bash
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.sh | bash
```

---

## Debugging

```bash
# Container logs (live)
docker logs meticai -f

# s6 service status
docker exec meticai s6-rc -a list

# Restart a single service (e.g. after hot-reload issues)
docker exec meticai s6-svc -r /run/service/server

# FastAPI interactive docs
open http://localhost:3550/docs

# MCP server logs
docker exec meticai cat /var/log/mcp-server.log

# Health endpoint
curl -sf http://localhost:3550/health
```

---

## API Endpoints

All endpoints are served through nginx at `:3550` under the `/api` prefix.

### Coffee Analysis
- `POST /api/analyze_coffee` — Analyse a coffee bag image
- `POST /api/analyze_and_profile` — Analyse + create profile on the machine

### Profiles
- `GET /api/profiles` — List profiles on machine
- `POST /api/profiles/{id}/apply` — Apply a profile
- `DELETE /api/profiles/{id}` — Delete a profile

### Pour-Over / Recipes
- `GET /api/pour-over/recipes` — List built-in pour-over recipes
- `POST /api/pour-over/start` — Start machine-integrated pour-over session

### Shots & History
- `GET /api/last-shot` — Last shot data
- `GET /api/history` — Analysis history
- `GET /api/scheduled-shots` — Scheduled shots

### MQTT Bridge & Control Center
- `GET /api/bridge/status` — Bridge and MQTT broker health
- `POST /api/bridge/restart` — Restart bridge service
- `WS /api/ws/live` — WebSocket for real-time machine telemetry
- `POST /api/machine/command/{cmd}` — MQTT commands (start, stop, abort, continue, preheat, tare, home-plunger, purge, load-profile, brightness, sounds, select_profile)

### System
- `GET /api/status` — Machine connection status
- `GET /api/version` — Server version
- `GET /api/settings` / `POST /api/settings` — Read / write settings (triggers hot-reload)
- `POST /api/restart` — Restart container services
- `GET /api/health` — Health check (`{"status":"ok"}`)

See `API.md` for full documentation.

---

## Common Tasks

### Adding Python dependencies
1. Add to `apps/server/requirements.txt` with pinned version
2. Rebuild container (`docker-compose.dev.yml` overlay)
3. Run full test suite

### Adding API routes
1. Create module in `apps/server/api/routes/`
2. Register router in `apps/server/main.py`
3. Add tests in `apps/server/test_main.py`

### Adding frontend dependencies
1. `cd apps/web && bun add <package>`
2. Commit both `package.json` and `bun.lock`

### Updating Gemini CLI config
- Edit `docker/gemini-settings.json`
- Use `"httpUrl"` key (not `"uri"`) for streamable-http transport
- Include `"trust": true` to skip MCP tool approval prompts
- Rebuild container to apply

---

## CI/CD Pipeline

### Workflows (`.github/workflows/`)

| Workflow | Trigger | What it does |
|---|---|---|
| `tests.yml` | push to `main`/`develop`/`version/2.0.0`; PR targeting those branches | Python tests, web tests + lint, E2E, Docker build test, Windows installer tests |
| `build-publish.yml` | Version tags (`v*`); manual dispatch | Builds unified Docker image, pushes to `ghcr.io/hessius/meticai` |
| `auto-release.yml` | Push to `main` changing `VERSION` | Creates GitHub release and version tag |

### CI notes
- `bun install --frozen-lockfile` is used in CI — always commit `bun.lock` when `package.json` changes
- Python tests use `requirements-test.txt`; run with `TEST_MODE=true` to disable live service connections
- Docker build test runs Playwright `verify-tasks.spec.ts` against the built container

---

## External Dependencies & Related Repos

| Repo | Role |
|---|---|
| https://github.com/hessius/meticulous-mcp | Fork of twchad/meticulous-mcp — bundled at `apps/mcp-server/meticulous-mcp/` |
| https://github.com/hessius/OPOS | Open Pour-Over Specification — defines the recipe format used in MeticAI |
| `espresso-profile-schema` (git submodule) | JSON schema for Meticulous espresso profiles, cloned at Docker build time |

---

## Environment Variables

Required (in `.env` or via Docker Compose env):
- `GEMINI_API_KEY` — Google Gemini API key (https://aistudio.google.com/app/apikey)
- `METICULOUS_IP` — IP or hostname of the machine (default: `meticulous.local`)

Set automatically inside the container:
- `DATA_DIR=/data`
- `SERVER_PORT=8000`
- `MCP_SERVER_PORT=8080`
- `TEST_MODE=true` — disables real service connections when running tests

---

## AI / Barista Persona

### Profile Naming
- Witty and pun-heavy but never cryptic
- Clear indication of profile characteristics
- Examples: "Slow-Mo Blossom", "Pressure Point", "Bean There, Done That"

### Post-Creation Summary Format
- **Profile Created:** [Name]
- **Description:** What makes it special
- **Preparation:** Dose, grind, temperature recommendations
- **Why This Works:** Expert reasoning
- **Special Notes:** Equipment requirements or technique notes

---

## Deployment Notes

- Designed for low-powered servers (Raspberry Pi, Mac Mini, NAS)
- Single container, single port (3550) — simple firewall / reverse proxy setup
- Requires LAN access to the Meticulous machine
- Supports iOS Shortcuts and curl-based integrations
- Optional overlays: `docker-compose.tailscale.yml` (remote access), `docker-compose.watchtower.yml` (auto-updates)
- Published image: `ghcr.io/hessius/meticai:latest`

---

## Additional Resources

- [Gemini API Docs](https://ai.google.dev/gemini-api/docs)
- [FastAPI Docs](https://fastapi.tiangolo.com/)
- [s6-overlay Docs](https://github.com/just-containers/s6-overlay)
- [MCP Protocol](https://modelcontextprotocol.io/)
- [OPOS Specification](https://github.com/hessius/OPOS)
