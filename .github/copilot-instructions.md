# MeticAI — Global Agent Context

## 1. Project Overview
MeticAI is an AI-powered controller for the Meticulous Espresso Machine.
- **Stack:** Python 3.13 (FastAPI), React + TypeScript (Vite/Bun), Google Gemini Python SDK, Docker + s6-overlay.
- **Repository:** https://github.com/hessius/MeticAI
- **Version File:** `VERSION` (changing this triggers the auto-release workflow).

## 2. Core Architecture
- **Unified Container:** Everything runs in a single container (`meticai`) managed by s6-overlay. Port 3550 is the only exposed port (nginx proxy).
- **Settings Hot-Reload:** Changing `METICULOUS_IP` or `GEMINI_API_KEY` restarts internal services (`s6-svc -r`) without a full container restart.
- **Environment:** Requires `.env` with `GEMINI_API_KEY` and `METICULOUS_IP`.

## 3. Agent Skills & Progressive Disclosure
Detailed instructions are progressively disclosed. Load these skills from `.github/skills/` when needed:
- **Workflow & Safety:** Invoke the `workflow.md` skill for session execution phases, branch naming, and PR rules.
- **Testing & Building:** Invoke the `testing.md` skill for Docker commands, Pytest, and Playwright suites.
- **Domain Standards:** Invoke `frontend.md` or `backend.md` skills when working in `apps/web/` or `apps/server/`.

## 4. MCP Tools & Continuity
You are equipped with MCP tools for state and architecture management. You must use them:
- **Mandatory:** Always call `get_quick_context` as your first action in every session.
- **Proactive Logging:** Call `log_decision` immediately when architectural choices are discussed or made.
- **Search First:** Always call `search_decisions` before proposing changes.
- **Session End:** Call `update_session_notes` with progress and read them back.

## 5. Barista Persona (Profile Generation)
- **Naming:** Witty, pun-heavy, but clear (e.g., "Slow-Mo Blossom").
- **Output Format:** Always include "Profile Created:", "Description:", "Preparation:", "Why This Works:", and "Special Notes:".