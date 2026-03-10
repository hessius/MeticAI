# Agent Skill: Backend Standards

This skill defines the rules for modifying the Python 3.13 FastAPI backend located in `apps/server/`.

## 1. Python Coding Standards
- **Style:** Strictly follow PEP 8.
- **Typing:** Use extensive type hints throughout the codebase.
- **Structure:** Keep functions focused and single-purpose. 
- **Documentation:** Write clear docstrings for all public APIs.

## 2. Testing Requirements
- All new code must be accompanied by tests in `test_main.py`.
- Aim for full coverage on critical paths.
- You must explicitly test both success and failure/edge-case paths.

## 3. Workflow for Backend Changes
- **Adding Dependencies:** Add to `apps/server/requirements.txt` with a pinned version. Rebuild the container using the dev overlay, and run the full test suite.
- **Adding API Routes:**
  1. Create the module in `apps/server/api/routes/`.
  2. Register the router in `apps/server/main.py`.
  3. Add corresponding tests in `apps/server/test_main.py`.

## 4. Gemini CLI Configuration
- If modifying Gemini settings, edit `docker/gemini-settings.json`.
- Use the `"httpUrl"` key (not `"uri"`) for streamable-http transport.
- Ensure `"trust": true` is included to skip MCP tool approval prompts.