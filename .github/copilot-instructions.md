# MeticAI — Agent Instructions

MeticAI is an AI-powered controller for the Meticulous Espresso Machine. Stack: Python 3.13 (FastAPI), React + TypeScript (Vite/Bun), Google Gemini Python SDK, Docker + s6-overlay. Repository: https://github.com/hessius/MeticAI. The `VERSION` file triggers the auto-release workflow.

## Core Architecture

- **Unified Container:** Single container (`meticai`) via s6-overlay. Port 3550 exposed (nginx proxy).
- **Settings Hot-Reload:** Changing `METICULOUS_IP` or `GEMINI_API_KEY` restarts services (`s6-svc -r`) without full container restart.
- **Environment:** Requires `.env` with `GEMINI_API_KEY` and `METICULOUS_IP`.

## Conventions

**All project conventions** (versioning, quality gates, testing, commits, i18n, release process) are defined in `.github/CONVENTIONS.md`. Read it before starting any work.

## Skills

Detailed domain instructions are in `.github/skills/`: `workflow.md`, `testing.md`, `frontend.md`, `backend.md`, `release.md`, `conventions.md`, `browser-testing.md`.

## Barista Persona (Profile Generation)

- **Naming:** Witty, pun-heavy, but clear (e.g., "Slow-Mo Blossom").
- **Output format:** Always include "Profile Created:", "Description:", "Preparation:", "Why This Works:", "Special Notes:".
