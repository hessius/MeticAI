# Agent Skill: Backend Standards

This skill defines the rules for modifying the current TypeScript backend: shared `@metic/core` in `packages/core` plus the Bun server in `apps/bun-server`.

## 1. Backend Architecture
- **Business logic lives in `@metic/core`:** AI analysis, profile generation, target-curve math, recommendations, dial-in, route behavior, and machine I/O belong in `packages/core` so server and native/direct mode share one implementation.
- **Routes:** Add or update route modules in `packages/core/src/routes/` and wire them through `packages/core/src/handler.ts`.
- **Platform seam:** Keep runtime-specific I/O behind `packages/core/src/platform.ts` abstractions. Server-specific behavior belongs in `apps/bun-server`; browser/native-specific behavior belongs in the web platform adapter/interceptor.
- **Bun server:** `apps/bun-server` (`@metic/server`) serves the built React SPA, delegates `/api/*` to `@metic/core`, proxies `/api/v1/*` to the Meticulous machine, and hosts `/api/ws/live` telemetry.

## 2. TypeScript Standards
- Use strict TypeScript with explicit types at public seams.
- Keep functions focused and single-purpose.
- Prefer platform-agnostic helpers in `packages/core/src/logic/` over runtime-specific duplication.
- Do not add duplicate server/native implementations for shared business rules.

## 3. Testing Requirements
- Add or update `packages/core/test/**` tests for shared route/logic behavior.
- Add `apps/bun-server/test/**` coverage for server-only concerns such as static serving, machine proxying, storage wiring, config, and telemetry.
- Also test native/direct mode when behavior is visible in Capacitor/PWA direct mode.
- Explicitly cover success and failure/edge-case paths.

## 4. Workflow for Backend Changes
- **Adding dependencies:** Use `bun add` in the affected package (`packages/core`, `apps/bun-server`, or `apps/web`) and commit the corresponding `bun.lock` with `package.json`.
- **Adding API routes:**
  1. Create or update the module in `packages/core/src/routes/`.
  2. Register behavior in `packages/core/src/handler.ts`.
  3. Add shared tests in `packages/core/test/` and server adapter tests in `apps/bun-server/test/` if server behavior changes.

## 5. Gemini Configuration
- The Gemini provider is configured via the `GEMINI_API_KEY` and `GEMINI_MODEL`
  environment variables (there is no MCP server or `gemini-settings.json` file).
- Model selection and the AI provider seam live in `packages/core/src/ai/`
  (e.g. `modelResolver.ts`); the default model is defined in
  `packages/core/src/routes/system.ts`.
