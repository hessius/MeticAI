# Agent Skill: Project Conventions

Quick reference for MeticAI project conventions and the self-improvement system.

## 1. Where Are Conventions?

All project conventions live in a single file: `.github/CONVENTIONS.md`

This is the **single source of truth**. When in doubt, read it.

## 2. Key Conventions (Quick Reference)

- **CI green** before any completion claim or merge
- **No tech debt** — fix everything now, defer nothing
- **VERSION + apps/web/package.json** always bumped together
- **Conventional Commits** with `Co-authored-by: Copilot` trailer
- **i18n** all user-facing strings via `t()`, all 6 locales
- **Tests** before pushing: backend pytest + frontend bun + lint + build

## 3. Adding New Conventions

When you discover a new rule or the user corrects a behavior:

**Option A — Extension tool:**
Use the `learn_convention` tool (provided by the `self-improve` extension):
- Specify the section and rule
- It's automatically appended to `.github/CONVENTIONS.md`
- Remember to commit `.github/CONVENTIONS.md` after learning a rule

**Option B — Manual edit:**
Edit `.github/CONVENTIONS.md` directly, adding the rule under the appropriate section.

## 4. When to Add Conventions

- User says "don't do X" or "always do Y" → add it
- A mistake is repeated → add prevention rule
- CI fails for a pattern → add the fix as a rule
- A code review catches something systematic → add it

## 5. Convention Sections

| Section | What Goes Here |
|---------|---------------|
| Versioning | Version file sync, format rules |
| Branch Naming | Branch patterns and when to use them |
| Quality Gates | Non-negotiable quality requirements |
| Testing | Test commands, coverage expectations |
| Commits | Message format, trailers |
| Pull Requests | PR structure requirements |
| Internationalization (i18n) | Translation rules |
| Dependencies | Package management rules |
| Code Style | Language-specific style rules |
| Architecture Patterns | Design patterns and conventions |
| Release Process | Release workflow steps |
| Domain: Espresso Profiling | Domain-specific rules |
| CI Structure | CI/CD pipeline details |
