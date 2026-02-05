# MeticAI - Copilot Instructions

## Project Overview
MeticAI is an autonomous AI agent that controls a Meticulous Espresso Machine. It uses Google Gemini 2.0 Flash to analyze coffee bags, understand roast profiles, and automatically create espresso recipes.

## Technology Stack

### Core Technologies
- **Python 3.x** (FastAPI backend - coffee-relay)
- **Node.js 22** (Gemini CLI client - gemini-client)
- **Docker & Docker Compose** (Containerization)
- **Google Gemini 2.0 Flash** (AI/Vision model)
- **FastAPI** (Web framework)
- **MCP (Model Context Protocol)** (Machine communication)

### Key Dependencies
- `fastapi==0.109.1` (web framework)
- `uvicorn==0.27.0` (ASGI server)
- `google-generativeai==0.3.2` (Gemini SDK)
- `pillow==10.3.0` (image processing)
- `python-multipart==0.0.18` (multipart form handling)

## Architecture

The system consists of three main containers:

1. **coffee-relay** (Port 8000) - FastAPI application that receives image/text requests
2. **gemini-client** - Node.js container running the Gemini CLI
3. **meticulous-mcp** (Port 8090) - MCP server for machine communication

## Coding Standards

### Python Code Style
- Follow PEP 8 conventions
- Use type hints where appropriate
- Keep functions focused and single-purpose
- Write comprehensive docstrings for public APIs
- Maintain 100% test coverage for new code

### Testing Requirements
- **Python**: Use pytest with comprehensive test coverage
- **Bash**: Use BATS (Bash Automated Testing System)
- All tests must pass before merging
- Aim for 100% code coverage on critical paths
- Test both success and failure scenarios
- Include edge cases in test coverage

### Test Commands
```bash
# Python tests (run from coffee-relay directory)
pip install -r requirements-test.txt
pytest test_main.py -v --cov=main

# Bash tests (run from repository root)
bats tests/test_local_install.bats
```

## Security Practices

### Critical Security Requirements
- **NEVER** commit API keys or secrets to the repository
- Use environment variables for sensitive configuration (`.env` file)
- Keep dependencies up to date for security patches
- Version pinning is required for reproducibility
- Only whitelist safe MCP tools (`create_profile`, `apply_profile`)
- No dangerous operations allowed (e.g., `delete_profile`)

### Known Vulnerabilities Fixed
- FastAPI Content-Type Header ReDoS (updated to 0.109.1)
- Pillow buffer overflow (updated to 10.3.0)
- python-multipart DoS vulnerabilities (updated to 0.0.18)

See `SECURITY_FIXES.md` for details.

## Project Structure

```
MeticAI/
├── .github/
│   └── workflows/          # CI/CD workflows
├── coffee-relay/           # FastAPI application
│   ├── main.py            # Main application code
│   ├── test_main.py       # Comprehensive tests
│   ├── requirements.txt   # Production dependencies
│   └── requirements-test.txt  # Test dependencies
├── gemini-client/         # Gemini CLI container
│   └── settings.json      # Gemini configuration
├── meticulous-source/     # MCP server (external clone)
├── tests/                 # Bash script tests
│   ├── test_local_install.bats
│   └── test_web_install.bats
├── docker-compose.yml     # Service orchestration
├── .env                   # Environment variables (not committed)
└── README.md             # Comprehensive documentation
```

## Build & Run Instructions

### Local Development
```bash
# 1. Clone repository
git clone https://github.com/hessius/MeticAI.git
cd MeticAI

# 2. Create .env file with required variables
# GEMINI_API_KEY=your_key_here
# METICULOUS_IP=192.168.x.x
# PI_IP=192.168.x.x

# 3. Clone MCP source
git clone https://github.com/hessius/meticulous-mcp.git meticulous-source

# 4. Build and run
docker compose up -d --build
```

### Quick Install
```bash
# Remote installation
curl -fsSL https://raw.githubusercontent.com/hessius/MeticAI/main/web_install.sh | bash

# Local installation
./local-install.sh
```

## API Endpoints

### POST /analyze_and_profile
Unified endpoint for coffee analysis and profile creation.
- Accepts: `file` (image) and/or `user_prefs` (text)
- Returns: Analysis and profile creation status

### POST /analyze_coffee
Standalone coffee bag analysis.
- Accepts: `file` (image)
- Returns: Coffee identification and characteristics

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

### Post-Creation Summary Format
Must include:
- **Profile Created**: [Name]
- **Description**: What makes it special
- **Preparation**: Dose, grind, temperature recommendations
- **Why This Works**: Scientific reasoning
- **Special Notes**: Equipment requirements or technique notes

## Docker Best Practices

### Dockerfile Conventions
- Use specific version tags (e.g., `node:22-slim`)
- Copy `requirements.txt` before installing for better caching
- Use `--no-cache-dir` flag with pip to reduce image size
- Keep containers minimal and single-purpose
- Use health checks for critical services

### Docker Compose
- Use `restart: unless-stopped` for production containers
- Mount `/var/run/docker.sock` only when needed for docker-in-docker
- Use environment variables from `.env` file
- Define health checks for dependent services

## Contribution Workflow

1. **Before making changes**: Run existing tests to ensure baseline
2. **Write tests first** (TDD approach) for new features
3. **Make minimal changes** to achieve the goal
4. **Run tests** after changes to verify functionality
5. **Maintain 100% coverage** on new critical code
6. **Update documentation** if APIs or behavior changes
7. **Check security** - run vulnerability scans on dependency changes

## CI/CD Pipeline

### GitHub Actions Workflow (`.github/workflows/tests.yml`)
- Runs on push to `main` or `develop`
- Runs on all pull requests
- Jobs: python-tests, bash-tests, integration-check, lint-check
- All tests must pass before merging

## Common Tasks

### Adding New Dependencies
1. Add to `requirements.txt` with exact version
2. Rebuild Docker image
3. Run full test suite
4. Check for security vulnerabilities
5. Document in commit message

### Updating Gemini Configuration
- Edit `gemini-client/settings.json`
- Restart gemini-client container
- Configuration is mounted at `/root/.gemini/settings.json`

### Debugging
- View logs: `docker logs coffee-relay -f`
- Check container status: `docker ps`
- Access API docs: `http://<PI_IP>:8000/docs`
- Test endpoints: Use curl or FastAPI interactive docs

## Important Files

- `README.md` - Comprehensive user and developer documentation
- `TEST_COVERAGE.md` - Test suite documentation and coverage metrics
- `SECURITY_FIXES.md` - Security vulnerability tracking
- `docker-compose.yml` - Service orchestration
- `.env` - Environment configuration (create locally, not in repo)

## External Dependencies

### Meticulous MCP
This project depends on the excellent work originally by @manonstreet:
- Repository: https://github.com/hessius/meticulous-mcp
- Cloned to `meticulous-source/` during installation
- Provides MCP server for machine communication

## Environment Variables

Required variables in `.env`:
- `GEMINI_API_KEY` - Google Gemini API key (get from https://aistudio.google.com/app/apikey)
- `METICULOUS_IP` - IP address of the Meticulous Espresso Machine
- `PI_IP` - IP address of the server running MeticAI

## Deployment Considerations

- Designed to run on low-powered servers (e.g., Raspberry Pi)
- Requires network access to Meticulous machine
- Supports iOS Shortcuts integration
- Can be triggered via curl from any HTTP client
- All services auto-restart unless manually stopped

## Additional Resources

- [Gemini API Documentation](https://ai.google.dev/gemini-api/docs)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [MCP Protocol](https://modelcontextprotocol.io/)
