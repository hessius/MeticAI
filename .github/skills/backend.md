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

## 4. Native (Capacitor) Parity — MANDATORY
The iOS/Capacitor build has **no Python server**: analysis, profile generation, target-curve math, recommendations, dial-in, and machine routes are reimplemented client-side in `apps/web/src/services/interceptor/DirectModeInterceptor.ts` (plus `apps/web/src/services/ai/`, `apps/web/src/lib/directModeAI.ts`, `apps/web/src/lib/profileAnalysis.ts`).

- Any change to `apps/server/services/` (or any backend behavior a client observes) **must** be mirrored in the DirectMode layer **in the same PR**, with tests on both sides — even when the request only mentions the server.
- Before marking a backend change complete, grep the DirectMode files for the parallel implementation (e.g. target-curve generation lives in both `analysis_service.py` and `DirectModeInterceptor.ts`) and update it. This is Quality Gate #7 in `.github/CONVENTIONS.md`.

## 5. Gemini CLI Configuration
- If modifying Gemini settings, edit `docker/gemini-settings.json`.
- Use the `"httpUrl"` key (not `"uri"`) for streamable-http transport.
- Ensure `"trust": true` is included to skip MCP tool approval prompts.