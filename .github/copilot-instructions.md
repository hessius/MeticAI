# MeticAI - Copilot Instructions

## Project Overview
MeticAI is an autonomous AI agent that controls a Meticulous Espresso Machine. It uses Google Gemini 2.0 Flash (via the Gemini CLI) to analyze coffee bags, understand roast profiles, and automatically create espresso recipes. A React-based web UI lets users interact with the system, change settings, browse shot history, and manage profiles.

**Current version**: 2.0.0

## Technology Stack

### Core Technologies
- **Python 3.12** (FastAPI backend)
- **React + TypeScript** (Web frontend, built with Vite/Bun)
- **Gemini CLI** (`@google/gemini-cli`, installed globally via npm)
- **Docker & Docker Compose** (Single unified container)
- **s6-overlay** (Process supervision inside the container)
- **nginx** (Reverse proxy — single entry point on port 3550)
- **FastMCP v1.26.0** (MCP server for Meticulous machine communication)
- **Google Gemini 2.0 Flash** (AI/Vision model)

### Key Python Dependencies
- `fastapi==0.109.1` (web framework)
- `uvicorn==0.40.0` (ASGI server)
- `google-generativeai==0.8.6` (Gemini SDK — used for image analysis)
- `pillow>=10.3.0` (image processing)
- `python-multipart==0.0.22` (multipart form handling)
- `pyMeticulous>=0.3.1` (Meticulous machine API client)
- `httpx==0.26.0` (HTTP client)

## Architecture

### Unified Container (v2.0)
Everything runs inside a **single Docker container** (`meticai`), managed by **s6-overlay**. Port **3550** is the only exposed port.

Internal services:
1. **nginx** (port 3550) — Serves the React SPA and proxies `/api/*` to the FastAPI server
2. **server** (port 8000, internal) — FastAPI application: coffee analysis, profile management, settings, shot history, scheduling
3. **mcp-server** (port 8080, internal) — FastMCP streamable-http server providing `create_profile` and `apply_profile` tools to the Gemini CLI
4. **Gemini CLI** — Invoked as a subprocess by the FastAPI server when profile creation is needed; connects to the MCP server at `http://localhost:8080/mcp`

### Request Flow
```
User/iOS Shortcut → :3550 (nginx) → /api/* → :8000 (FastAPI)
                                   → /*    → React SPA

FastAPI → subprocess: gemini CLI → MCP tools → :8080 (FastMCP) → Meticulous machine
```

### s6-overlay Services
Located in `docker/s6-rc.d/`:
- `server/` — FastAPI backend (uvicorn)
- `mcp-server/` — FastMCP HTTP server
- `nginx/` — Reverse proxy
- `user/` — s6 user bundle (depends on above three)

### Settings Hot-Reload
When `METICULOUS_IP` or `GEMINI_API_KEY` are changed via the settings UI:
- `os.environ` is updated in-process
- The cached Meticulous API client is reset (`reset_meticulous_api()`)
- The MCP server s6 service is restarted via `s6-svc -r /run/service/mcp-server`
- No full container restart is required

## Coding Standards

### Python Code Style
- Follow PEP 8 conventions
- Use type hints where appropriate
- Keep functions focused and single-purpose
- Write comprehensive docstrings for public APIs
- Maintain 100% test coverage for new code

### Testing Requirements
- **Python**: Use pytest with comprehensive test coverage (424+ tests)
- **Bash**: Use BATS (Bash Automated Testing System)
- All tests must pass before merging
- Aim for 100% code coverage on critical paths
- Test both success and failure scenarios
- Include edge cases in test coverage

### Test Commands
```bash
# Python tests (run from apps/server directory)
pip install -r requirements-test.txt
TEST_MODE=true python -m pytest test_main.py -v --cov=main

# Inside the running container
docker exec meticai bash -c "cd /app/server && TEST_MODE=true python -m pytest test_main.py -x -q"

# Bash tests (run from repository root)
bats tests/test_local_install.bats
```

> **Note:** Tests require `pytest-asyncio` to be installed. The `TEST_MODE=true` env var disables real service connections.

## Security Practices

### Critical Security Requirements
- **NEVER** commit API keys or secrets to the repository
- Use environment variables for sensitive configuration (`.env` file)
- Keep dependencies up to date for security patches
- Version pinning is required for reproducibility
- Only whitelist safe MCP tools (`create_profile`, `apply_profile`)
- No dangerous operations allowed (e.g., `delete_profile`)


## Project Structure

```
MeticAI/
├── .github/
│   └── workflows/              # CI/CD (tests.yml, build-publish.yml, auto-release.yml)
├── apps/
│   ├── server/                 # FastAPI backend
│   │   ├── main.py             # App entry point, lifespan, middleware
│   │   ├── config.py           # Central configuration
│   │   ├── logging_config.py   # Structured logging setup
│   │   ├── prompt_builder.py   # Gemini prompt construction
│   │   ├── api/routes/         # Route modules
│   │   │   ├── coffee.py       # /analyze_coffee, /analyze_and_profile
│   │   │   ├── profiles.py     # Profile CRUD
│   │   │   ├── shots.py        # Shot history
│   │   │   ├── history.py      # Analysis history
│   │   │   ├── scheduling.py   # Scheduled shots
│   │   │   └── system.py       # Settings, version, health, restart, logs
│   │   ├── services/           # Business logic
│   │   │   ├── gemini_service.py       # AI model config, output cleaning
│   │   │   ├── meticulous_service.py   # Machine API client (lazy singleton)
│   │   │   ├── analysis_service.py     # Coffee analysis orchestration
│   │   │   ├── cache_service.py        # LLM response caching
│   │   │   ├── history_service.py      # Analysis history persistence
│   │   │   ├── settings_service.py     # Settings read/write
│   │   │   └── scheduling_state.py     # Shot scheduling state
│   │   ├── models/             # Pydantic models
│   │   ├── requirements.txt    # Production dependencies
│   │   ├── requirements-test.txt
│   │   ├── test_main.py        # 424+ pytest tests
│   │   └── conftest.py         # Test fixtures
│   ├── web/                    # React + TypeScript frontend (Vite/Bun)
│   │   ├── src/
│   │   ├── package.json
│   │   ├── index.html
│   │   └── ...
│   └── mcp-server/             # MCP server for Meticulous communication
│       ├── meticulous-mcp/     # Fork of manonstreet/meticulous-mcp
│       ├── run_http.py         # FastMCP streamable-http entry point
│       ├── Dockerfile          # Standalone MCP server image (optional)
│       └── ...
├── docker/
│   ├── Dockerfile.unified      # Multi-stage build (web → python deps → runtime)
│   ├── nginx.conf              # nginx reverse proxy config
│   ├── gemini-settings.json    # Gemini CLI MCP config (httpUrl key)
│   └── s6-rc.d/                # s6-overlay service definitions
│       ├── server/
│       ├── mcp-server/
│       ├── nginx/
│       └── user/
├── data/                       # Persistent data (profiles, caches, settings)
├── scripts/                    # Install scripts (bash, PowerShell)
├── tests/                      # BATS tests for installers
├── docker-compose.yml          # Primary compose file (unified container)
├── docker-compose.tailscale.yml
├── docker-compose.watchtower.yml
├── VERSION                     # Semver version string (2.0.0)
└── README.md
```

## Build & Run Instructions

### Local Development
```bash
# 1. Clone repository
git clone https://github.com/hessius/MeticAI.git
cd MeticAI

# 2. Create .env file
cat > .env << 'EOF'
GEMINI_API_KEY=your_key_here
METICULOUS_IP=192.168.x.x
EOF

# 3. Build and run the unified container
docker compose up -d --build

# 4. Open the web UI
open http://localhost:3550
```

### Quick Install
```bash
# Remote installation
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/scripts/install.sh | bash

# macOS app wrapper
./macos-installer/build-macos-app.sh
```

### Rebuild After Code Changes
```bash
docker compose down && docker compose up -d --build
```

## API Endpoints

All endpoints are served through nginx at port 3550 under the `/api` prefix.

### Coffee Analysis
- `POST /api/analyze_coffee` — Analyze a coffee bag image
- `POST /api/analyze_and_profile` — Analyze + create a profile on the machine

### Profiles
- `GET /api/profiles` — List profiles on machine
- `POST /api/profiles/{id}/apply` — Apply a profile
- `DELETE /api/profiles/{id}` — Delete a profile

### Shots & History
- `GET /api/last-shot` — Last shot data
- `GET /api/history` — Analysis history
- `GET /api/scheduled-shots` — Scheduled shots

### System
- `GET /api/status` — Machine connection status
- `GET /api/version` — Server version
- `GET /api/settings` — Current settings
- `POST /api/settings` — Save settings (triggers hot-reload)
- `POST /api/restart` — Restart container services
- `GET /api/health` — Health check

See `API.md` for full endpoint documentation.

## Barista Persona Guidelines

### Profile Naming Conventions
- **Witty and pun-heavy** but never cryptic
- Clear indication of profile characteristics
- Memorable for quick selection
- Professional barista humor
- Examples: "Slow-Mo Blossom", "Pressure Point", "Bean There, Done That"

### Profile Creation Features
- Support complex multi-stage extractions
- Include pre-infusion and blooming phases
- Provide pressure ramping and flow profiling
- Tailor to specific bean characteristics
- Validated against the `espresso-profile-schema` JSON schema

### Post-Creation Summary Format
Must include:
- **Profile Created**: [Name]
- **Description**: What makes it special
- **Preparation**: Dose, grind, temperature recommendations
- **Why This Works**: Scientific reasoning
- **Special Notes**: Equipment requirements or technique notes

## Docker Best Practices

### Unified Dockerfile (`docker/Dockerfile.unified`)
- Multi-stage build: web (Bun) → Python deps → final runtime
- s6-overlay for process supervision
- Espresso profile schema cloned at build time
- Gemini CLI installed globally via npm
- Health check against `/health` on port 3550

### Docker Compose
- `docker-compose.yml` — Default compose file (unified container)
- Optional overlays: `docker-compose.tailscale.yml`, `docker-compose.watchtower.yml`
- Single `meticai-data` named volume for persistent `/data`
- `restart: unless-stopped` policy

## Contribution Workflow

1. **Before making changes**: Run existing tests to ensure baseline
2. **Write tests first** (TDD approach) for new features
3. **Make minimal changes** to achieve the goal
4. **Run tests** after changes to verify functionality
5. **Maintain 100% coverage** on new critical code
6. **Update documentation** if APIs or behavior changes
7. **Check security** — run vulnerability scans on dependency changes

## CI/CD Pipeline

### GitHub Actions Workflows
- `tests.yml` — Python tests, BATS tests, integration check, lint
- `build-publish.yml` — Build and push Docker image to GHCR
- `auto-release.yml` — Automatic releases from VERSION file changes

## Common Tasks

### Adding New Python Dependencies
1. Add to `apps/server/requirements.txt` with exact version
2. Rebuild Docker image
3. Run full test suite
4. Check for security vulnerabilities

### Adding New API Routes
1. Create route module in `apps/server/api/routes/`
2. Register router in `apps/server/main.py`
3. Add tests in `apps/server/test_main.py`

### Updating Gemini CLI Configuration
- Edit `docker/gemini-settings.json`
- Key format: `"httpUrl"` (not `"uri"`) for streamable-http transport
- Include `"trust": true` to skip MCP tool approval prompts
- Rebuild container to apply

### Debugging
- View logs: `docker logs meticai -f`
- Check s6 service status: `docker exec meticai s6-rc -a list`
- Restart a single service: `docker exec meticai s6-svc -r /run/service/server`
- Access FastAPI docs: `http://localhost:3550/api/docs`
- MCP server logs: `docker exec meticai cat /var/log/mcp-server.log`

## Important Files

- `VERSION` — Semver version string, triggers auto-release on change
- `docker/Dockerfile.unified` — The single Dockerfile for the entire system
- `docker/gemini-settings.json` — Gemini CLI ↔ MCP server connection config
- `apps/server/main.py` — FastAPI app entry point
- `apps/server/services/gemini_service.py` — AI model configuration and output cleaning
- `apps/server/services/meticulous_service.py` — Machine API client (lazy singleton with reset)
- `apps/mcp-server/run_http.py` — MCP server entry point
- `API.md` — Full API endpoint documentation
- `PROFILING_AXIOMS.md` — Coffee profiling knowledge base

## External Dependencies

### Meticulous MCP
Based on the excellent work by manonstreet:
- Repository: https://github.com/hessius/meticulous-mcp (fork)
- Bundled at `apps/mcp-server/meticulous-mcp/`
- Provides `create_profile` and `apply_profile` MCP tools
- Uses `espresso-profile-schema` for JSON validation (cloned at Docker build time)

## Environment Variables

Required in `.env` (or passed via Docker Compose):
- `GEMINI_API_KEY` — Google Gemini API key (https://aistudio.google.com/app/apikey)
- `METICULOUS_IP` — IP or hostname of the Meticulous Espresso Machine (default: `meticulous.local`)

Set automatically inside the container:
- `DATA_DIR=/data` — Persistent data directory
- `SERVER_PORT=8000` — FastAPI server port
- `MCP_SERVER_PORT=8080` — MCP server port

## Deployment Considerations

- Designed to run on low-powered servers (e.g., Raspberry Pi)
- Single container, single port (3550) — easy firewall/reverse proxy setup
- Requires network access to the Meticulous machine
- Supports iOS Shortcuts integration
- Can be triggered via curl from any HTTP client
- Optional Tailscale overlay for secure remote access
- Optional Watchtower overlay for automatic image updates
- Published to `ghcr.io/hessius/meticai:latest`

## Additional Resources

- [Gemini API Documentation](https://ai.google.dev/gemini-api/docs)
- [Gemini CLI](https://github.com/google-gemini/gemini-cli)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [s6-overlay Documentation](https://github.com/just-containers/s6-overlay)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [MCP Protocol](https://modelcontextprotocol.io/)
