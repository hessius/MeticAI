# Unified TS Core + Bun Server (v3.0.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse Metic's dual Python/TypeScript runtimes onto a single shared `packages/core` request handler consumed by both `apps/frontend` (native + browser) and a compiled single-binary Bun `apps/server`, deleting the Python backend while keeping the 3.0.0 upgrade seamless for existing server users.

**Architecture:** One Web-standard handler `(Request, Platform) => Promise<Response>` lives in `packages/core`. The browser installs it over `window.fetch` (direct mode); Bun serves it via `Bun.serve` (proxy mode). All platform I/O (storage, secrets, machine URL, scheduler) is injected through a `Platform` interface implemented twice (`platform/browser.ts`, `platform/node.ts`). Persistence stays flat-JSON on the existing `/data` layout (zero migration). MQTT/HA, the MCP server, nginx, s6, and mosquitto are removed; the container becomes a single distroless Bun binary.

**Tech Stack:** TypeScript, Bun (`bun build --compile`), React SPA (Vite), Capacitor, `socket.io-client`, Web Fetch API (`Request`/`Response`/`ReadableStream`), Vitest, Playwright, Docker (`distroless/cc`).

**Spec:** `docs/superpowers/specs/2026-07-02-unified-ts-core-bun-server-3.0.0-design.md`

---

## Scheduling & Prerequisites (read first)

- **Do NOT start before 2.6.0 beta and the 2.7.0 milestone ship.** Correct order: 2.6.0 → 2.7.0 → 3.0.0. This plan is a banked artifact; the `version/3.0.0` branch stays dormant until 2.7.0 is done.
- **Issue #528 overlap (decide before starting):** #528 (refactor `DirectModeInterceptor` into modules) *is* Phase 2's core extraction. Either (a) defer #528 into this epic, or (b) do #528 in 2.7.0 with module boundaries matching `packages/core` so it becomes a head start. Do not do a throwaway reshuffle.
- **#529 (visual regression) and #530 (E2E)** from 2.7.0 feed Phase 7's parity net — land them in 2.7.0.
- **Re-baseline before implementing.** Because 2.7.0 will change the codebase, at the start of each phase re-read the touched files and write that phase's detailed step-level task breakdown against the *then-current* code. This plan gives full step detail for Phase 1 (stable) and task-level detail (files, interfaces, tests, exit criteria) for Phases 2–7.

## Scope Decomposition (7 phases, each independently testable)

| Phase | Deliverable | Depends on |
|---|---|---|
| 1 | Monorepo + `packages/core` scaffold + `Platform` interface + app renames | — |
| 2 | Core extraction: handler + logic + AI + machine client (behind `Platform`) | 1 |
| 3 | `platform/browser.ts` + frontend host binding; native parity preserved | 2 |
| 4 | `platform/node.ts` + Bun server host (static, `/api/v1` proxy, `/api/ws/live` hub, SSE, scheduler) | 2 |
| 5 | Tailscale LocalAPI, health subcommand, startup/seed/migration | 4 |
| 6 | Container: distroless multi-stage build + image-size CI gate | 4, 5 |
| 7 | Cutover: delete Python/MCP/bridge/mosquitto/nginx/s6, compose changes, parity-test port, beta rollout | 3, 6 |

Each phase ends green (all tests pass, builds succeed) and is committable/mergeable on its own. The app keeps working after every phase: Phases 1–3 leave the Python server running; Phase 4 stands up Bun in parallel; Phase 7 flips the deployment and removes Python.

---

## File Structure (target end-state)

```
packages/core/
  package.json                     # name "@metic/core", type module, exports ./handler ./platform
  src/
    handler.ts                     # route dispatch: (Request, Platform) => Promise<Response>
    router.ts                      # tiny method+path matcher used by handler.ts
    platform.ts                    # Platform interface + Repo/Cache/BlobStore/Scheduler/Logger types
    http.ts                        # jsonResponse/errorResponse helpers (ported from directModeHttp.ts)
    routes/
      profiles.ts shots.ts analysis.ts recommendations.ts dialin.ts
      pourover.ts recipes.ts machine.ts schedules.ts system.ts
    ai/                            # moved from apps/web/src/services/ai (providers, prompts, retry)
    machine/
      MachineClient.ts             # REST + Socket.IO client built from base URL (isomorphic)
    analysis/ shotFacts/ compass/ decent/ validation/ recommendations/
    generationProgress.ts          # shared progress tracker (port of generation_progress.py)
  test/
    contract/                      # ported behavioral assertions run against a mock Platform
    mockPlatform.ts

apps/frontend/                     # renamed from apps/web (SPA only; native project removed)
  src/...
  src/platform/browser.ts          # Platform impl: IndexedDB/Capacitor Preferences, WebCrypto
  src/host/fetchHost.ts            # installs core handler over window.fetch (direct mode)

apps/capacitor/                    # native wrapper (moved out of apps/web)
  capacitor.config.ts              # webDir: '../frontend/dist'
  package.json                     # @capacitor/cli + plugin deps
  ios/ android/

apps/server/                       # NEW: Bun backend (replaces Python apps/server)
  package.json
  src/
    main.ts                        # entry: parse argv (serve|healthcheck), Bun.serve
    server.ts                      # Bun.serve fetch handler: static + /api/v1 proxy + /api/* core + ws
    static.ts                      # serve frontend/dist
    machineProxy.ts                # transparent /api/v1/* reverse proxy
    telemetryHub.ts                # one upstream machine Socket.IO -> fan-out WebSocket at /api/ws/live
    platform/node.ts               # Platform impl: fs-JSON repos, env secrets, cron scheduler
    platform/repos/                # settingsRepo.ts historyRepo.ts ... imagesBlobStore.ts
    tailscale.ts                   # LocalAPI over unix socket via fetch({ unix })
    startup.ts                     # seed defaults, run migration, rehydrate scheduler
    healthcheck.ts                 # pings localhost:3550/health, exit 0/1
  test/

docker/
  Dockerfile.unified               # rewritten: multi-stage bun build --compile -> distroless/cc

# DELETED in Phase 7: apps/server (Python), apps/mcp-server, apps/bridge,
# docker/mosquitto*.conf, docker/nginx.conf, docker/s6-rc.d/, docker-compose.homeassistant.yml
```

---

## Phase 1 — Monorepo foundation, `packages/core` scaffold, `Platform` interface, app renames

**Goal:** Establish the workspace and the empty shared package + the `Platform` seam, and rename the apps, with everything still building and all existing tests green. No behavior change.

**Why first:** Everything downstream imports `@metic/core` and `Platform`. The renames (`web → frontend`, extract `capacitor`) must land before code moves so later diffs are clean.

### Task 1.1: Establish Bun workspaces

**Files:**
- Create: `package.json` (repo root — workspace manifest)
- Modify: none yet (apps keep their own `package.json`)

- [ ] **Step 1: Inspect current root for an existing workspace manifest**

Run: `cat package.json 2>/dev/null; ls apps`
Expected: no root workspace `package.json` (apps are standalone), directories `bridge mcp-server server web`.

- [ ] **Step 2: Create the root workspace manifest**

Create `package.json`:
```json
{
  "name": "metic-monorepo",
  "private": true,
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "test": "bun run --filter '*' test",
    "build": "bun run --filter '*' build"
  }
}
```

- [ ] **Step 3: Verify install resolves the workspace**

Run: `bun install`
Expected: completes without error; root `node_modules` created with workspace symlinks.

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock
git commit -m "chore(monorepo): add Bun workspace manifest"
```

### Task 1.2: Scaffold `packages/core` with a trivial handler + one contract test

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/src/platform.ts`
- Create: `packages/core/src/http.ts`
- Create: `packages/core/src/handler.ts`
- Create: `packages/core/test/mockPlatform.ts`
- Create: `packages/core/test/handler.health.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/handler.health.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { handle } from '../src/handler'
import { makeMockPlatform } from './mockPlatform'

describe('core handler', () => {
  it('answers GET /api/health with ok', async () => {
    const res = await handle(new Request('http://x/api/health'), makeMockPlatform())
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd packages/core && bunx vitest run test/handler.health.test.ts`
Expected: FAIL — cannot resolve `../src/handler`.

- [ ] **Step 3: Create the package manifest**

Create `packages/core/package.json`:
```json
{
  "name": "@metic/core",
  "type": "module",
  "exports": { ".": "./src/handler.ts", "./platform": "./src/platform.ts" },
  "scripts": { "test": "vitest run", "build": "tsc --noEmit" },
  "devDependencies": { "vitest": "^3.0.0", "typescript": "^5.6.0" }
}
```

- [ ] **Step 4: Define the `Platform` interface**

Create `packages/core/src/platform.ts`:
```ts
export interface Repo<T> {
  read(id: string): Promise<T | null>
  list(): Promise<T[]>
  write(id: string, value: T): Promise<void>
  delete(id: string): Promise<void>
}
export interface Cache {
  get<T>(key: string): Promise<T | null>
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>
}
export interface BlobStore {
  read(key: string): Promise<Uint8Array | null>
  write(key: string, bytes: Uint8Array): Promise<void>
  delete(key: string): Promise<void>
}
export interface Scheduler {
  schedule(id: string, at: number, run: () => Promise<void>): void
  cancel(id: string): void
}
export interface Logger { info(m: string, x?: unknown): void; error(m: string, x?: unknown): void; debug(m: string, x?: unknown): void }
export interface AIConfig { provider: string; apiKey: string; model?: string }

export interface Platform {
  storage: {
    settings: Repo<Record<string, unknown>>
    history: Repo<unknown>
    annotations: Repo<unknown>
    dialInSessions: Repo<unknown>
    pourOverPrefs: Repo<unknown>
    schedules: Repo<unknown>
    aiCache: Cache
    images: BlobStore
  }
  secrets: { getAIConfig(): AIConfig }
  machine: { getBaseUrl(): string }
  scheduler?: Scheduler
  clock: () => number
  logger: Logger
}
```

- [ ] **Step 5: Add HTTP helpers**

Create `packages/core/src/http.ts`:
```ts
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
}
export function notImplemented(msg = 'Not supported'): Response {
  return jsonResponse({ error: msg }, 501)
}
```

- [ ] **Step 6: Implement the minimal handler**

Create `packages/core/src/handler.ts`:
```ts
import type { Platform } from './platform'
import { jsonResponse } from './http'

export async function handle(req: Request, _platform: Platform): Promise<Response> {
  const { pathname } = new URL(req.url)
  if (req.method === 'GET' && pathname === '/api/health') {
    return jsonResponse({ status: 'ok' })
  }
  return jsonResponse({ error: `No route for ${req.method} ${pathname}` }, 404)
}
```

- [ ] **Step 7: Create the mock Platform**

Create `packages/core/test/mockPlatform.ts`:
```ts
import type { Platform, Repo } from '../src/platform'

function memRepo<T>(): Repo<T> {
  const m = new Map<string, T>()
  return {
    read: async (id) => m.get(id) ?? null,
    list: async () => [...m.values()],
    write: async (id, v) => void m.set(id, v),
    delete: async (id) => void m.delete(id),
  }
}
export function makeMockPlatform(over: Partial<Platform> = {}): Platform {
  return {
    storage: {
      settings: memRepo(), history: memRepo(), annotations: memRepo(),
      dialInSessions: memRepo(), pourOverPrefs: memRepo(), schedules: memRepo(),
      aiCache: { get: async () => null, set: async () => {} },
      images: { read: async () => null, write: async () => {}, delete: async () => {} },
    },
    secrets: { getAIConfig: () => ({ provider: 'gemini', apiKey: 'test' }) },
    machine: { getBaseUrl: () => 'http://machine.test:8080' },
    clock: () => 0,
    logger: { info() {}, error() {}, debug() {} },
    ...over,
  }
}
```

- [ ] **Step 8: Run the test and confirm it passes**

Run: `cd packages/core && bun install && bunx vitest run`
Expected: PASS (1 test).

- [ ] **Step 9: Commit**

```bash
git add packages/core bun.lock
git commit -m "feat(core): scaffold @metic/core handler + Platform interface"
```

### Task 1.3: Rename `apps/web` → `apps/frontend`

**Files:**
- Move: `apps/web` → `apps/frontend`
- Modify: any path references (`vite.config`, `tsconfig`, CI workflows, Dockerfile) pointing at `apps/web`

- [ ] **Step 1: Move with git to preserve history**

Run: `git mv apps/web apps/frontend`
Expected: directory moved, staged.

- [ ] **Step 2: Find remaining references**

Run: `grep -rn "apps/web" --include='*.yml' --include='*.yaml' --include='*.json' --include='*.ts' --include='*.sh' --include='Dockerfile*' . | grep -v node_modules`
Expected: a list of CI/build references (`.github/workflows/*`, `docker/Dockerfile.unified`, scripts).

- [ ] **Step 3: Update each reference to `apps/frontend`**

Edit every file from Step 2, replacing `apps/web` with `apps/frontend`. (Show the change per file as you go; do not use a blind sed across binary/lock files.)

- [ ] **Step 4: Verify the frontend still builds and tests pass**

Run: `cd apps/frontend && bun install && bun run build && bun run test:run`
Expected: build succeeds; existing test suite passes (unchanged behavior).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(monorepo): rename apps/web to apps/frontend"
```

### Task 1.4: Extract the native project into `apps/capacitor`

**Files:**
- Create: `apps/capacitor/package.json`
- Move: `apps/frontend/ios` → `apps/capacitor/ios`, `apps/frontend/android` → `apps/capacitor/android`
- Move: `apps/frontend/capacitor.config.ts` → `apps/capacitor/capacitor.config.ts`
- Modify: `apps/capacitor/capacitor.config.ts` (`webDir`)

- [ ] **Step 1: Inspect current Capacitor deps in the frontend manifest**

Run: `grep -n "@capacitor" apps/frontend/package.json`
Expected: list of `@capacitor/*` core + plugin deps.

- [ ] **Step 2: Create the native host manifest**

Create `apps/capacitor/package.json` declaring `@capacitor/cli`, `@capacitor/core`, and each plugin from Step 1 (versions matched). Example shape:
```json
{
  "name": "@metic/capacitor",
  "private": true,
  "scripts": {
    "sync": "cap sync",
    "build:ios": "cap sync ios",
    "build:android": "cd android && ./gradlew assembleDebug"
  },
  "dependencies": {
    "@capacitor/core": "MATCH", "@capacitor/ios": "MATCH", "@capacitor/android": "MATCH",
    "@capacitor/preferences": "MATCH", "@capacitor/camera": "MATCH"
  },
  "devDependencies": { "@capacitor/cli": "MATCH" }
}
```
(Replace `MATCH` with the exact versions from Step 1. Keep plugin JS packages ALSO in `apps/frontend/package.json` since the SPA imports their APIs.)

- [ ] **Step 3: Move native projects and config**

Run:
```bash
git mv apps/frontend/ios apps/capacitor/ios
git mv apps/frontend/android apps/capacitor/android
git mv apps/frontend/capacitor.config.ts apps/capacitor/capacitor.config.ts
```

- [ ] **Step 4: Point `webDir` at the frontend build**

In `apps/capacitor/capacitor.config.ts`, set `webDir: '../frontend/dist'` (keep all other config identical: appId, scheme, backgroundColor, androidScheme 'http', etc.).

- [ ] **Step 5: Install and sync**

Run: `cd apps/capacitor && bun install && bunx cap sync`
Expected: `cap` detects plugins from `apps/capacitor/package.json` and copies `../frontend/dist` into the native projects. (If plugin detection misses any, ensure it's listed in this manifest.)

- [ ] **Step 6: Verify Android debug build**

Run (per stored env memory): `ANDROID_HOME=/opt/homebrew/share/android-commandlinetools JAVA_HOME=/opt/homebrew/opt/openjdk@21/... apps/capacitor/android/gradlew -p apps/capacitor/android assembleDebug`
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 7: Update CI + docs paths**

Modify `.github/workflows/*` (Android/iOS jobs), `apps/frontend/android/README.md` references, and any script pointing at `apps/web/android` → `apps/capacitor/android`. Update the never-stage rule target to `apps/capacitor/ios/App/App.xcodeproj/project.pbxproj`.

- [ ] **Step 8: Commit (do NOT stage project.pbxproj)**

```bash
git restore --staged apps/capacitor/ios/App/App.xcodeproj/project.pbxproj 2>/dev/null || true
git add -A
git commit -m "refactor(monorepo): extract native wrapper into apps/capacitor"
```

**Phase 1 exit criteria:** `bun install` at root resolves workspaces; `@metic/core` builds + its 1 contract test passes; `apps/frontend` builds + full existing test suite green; `apps/capacitor` syncs + Android debug builds; CI path references updated. Python server untouched and still runnable.

---

## Phase 2 — Core extraction (handler + logic + AI + machine client)

**Goal:** Move all portable logic and routing from `DirectModeInterceptor.ts` + `apps/web/src/lib/*` + `apps/web/src/services/ai/*` into `packages/core`, behind the `Platform` interface. This is the substance of former issue #528, done as extraction rather than reshuffle.

**Approach:** TDD, one route family at a time. For each, port the Python behavior AND the existing TS `*.direct.test` expectations into `packages/core/test/contract/` against `makeMockPlatform`, then move the implementation into `packages/core/src/routes/<family>.ts`. The old `DirectModeInterceptor` becomes a thin shim that calls `handle()` (removed entirely in Phase 3).

**Tasks (each = failing contract test → move impl → green → commit):**
- [ ] 2.1 `router.ts` + `handler.ts` dispatch table (method+path, params). Test: routing to a stub per family.
- [ ] 2.2 `machine/MachineClient.ts` — REST methods + `socket.io-client` telemetry stream, built from `platform.machine.getBaseUrl()`. Port from `DirectAdapter.ts` + `meticulous_service.py`. Tests: command URL/verb mapping, telemetry event normalization (mock socket).
- [ ] 2.3 `routes/machine.ts` — commands (start/stop/abort/continue/preheat/tare/home/purge/load-profile/brightness/sounds) + status/system-info. Contract tests mirror `commands.py` + `machine_status.py`.
- [ ] 2.4 `routes/profiles.ts` — CRUD/order/import/convert(decent)/target-curves/recommend/find-similar. Port `profiles.py` + `profile_recommendation_service.py` + `decent_converter.py` + `profileAnalysis.ts`. Reuse existing decent/recommendation tests as contract tests.
- [ ] 2.5 `routes/shots.ts` — last-shot/dates/files/data/by-profile/annotate/analyze/analyze-recommendations + `shotFacts`. Port `shots.py` + `shot_facts.py` + `shotFacts.ts`.
- [ ] 2.6 `routes/analysis.ts` + `ai/*` — move `services/ai/{providers,prompts,retryUtils,modelResolver,analysisKnowledge}` into `core/ai`; wire analyze-llm + compass + validation + `analysisLint`. Multi-provider via `platform.secrets.getAIConfig()`. Port `analysis_service.py`, `analysis_validator.py`, `compass_rules.py`, `validation_service.py`.
- [ ] 2.7 `routes/dialin.ts` — sessions CRUD/iterations/recommend/complete. Port `dialin_service.py`.
- [ ] 2.8 `routes/pourover.ts` + `routes/recipes.ts` — prepare/prepare-recipe/cleanup/active/preferences; recipes list/get. Port `pour_over_*`, `recipe_adapter.py`.
- [ ] 2.9 `routes/schedules.ts` — returns `501` when `platform.scheduler` is absent; otherwise CRUD via `platform.storage.schedules` + `platform.scheduler`. Port `scheduling.py` + `scheduling_state.py`.
- [ ] 2.10 `routes/system.ts` — health/version/available-models/settings(get,post)/changelog/network-ip/logs. Tailscale + update endpoints handled in the server host (Phases 4–5), not core.
- [ ] 2.11 `generationProgress.ts` — shared tracker (port `generation_progress.py`). Analysis/generation routes emit progress into it.

**Exit criteria:** every route family has contract tests against `makeMockPlatform` that encode the frozen `/api/*` schemas; `@metic/core` test suite (ported from Python `test_main.py` behaviors + existing TS tests) is green; no route logic remains outside `core`.

---

## Phase 3 — Browser Platform impl + frontend host binding

**Goal:** Make `apps/frontend` consume `@metic/core` in direct mode with **identical native behavior**, and delete the old `DirectModeInterceptor` body.

**Tasks:**
- [ ] 3.1 `src/platform/browser.ts` — implement `Platform` using existing `AppDatabase` (IndexedDB) + `CapacitorStorage`/`directModeStorage` for repos; `secrets.getAIConfig()` from user settings; `machine.getBaseUrl()` from stored URL; `scheduler` OMITTED (schedules route returns 501 as today); `images` BlobStore over IndexedDB blobs; `aiCache` over IndexedDB with TTL. Tests: reuse `directModeStorage.test.ts` / `AppDatabase.test.ts` adapted to the `Repo` API.
- [ ] 3.2 `src/host/fetchHost.ts` — port the `window.fetch` patch + `isMeticAIProxyApiPath`/`getDirectRequestContext` from `directModeHttp.ts`; on match, build a `Request` and return `await handle(req, browserPlatform)`. Tests: intercept matrix (which paths are intercepted vs passthrough), mirroring `directModeHttp.test.ts`.
- [ ] 3.3 `main.tsx` — replace `installDirectModeInterceptor()` with `installFetchHost()` (same `isDirectMode() && !isDemoMode()` gate).
- [ ] 3.4 Delete `DirectModeInterceptor.ts` + `directModeHttp.ts` + moved `lib/*`/`services/ai/*`; update imports to `@metic/core`. Run `apps/frontend` full suite + all `*.direct.test.*` green.
- [ ] 3.5 Client-side image normalization (spec §6): ensure HEIF→JPEG + resize happen in the frontend (Canvas/`createImageBitmap`) for BOTH modes before bytes reach the AI module, so neither Bun nor the machine needs an image library. Audit the current native image path (Camera plugin/Canvas); add a shared `normalizeImage()` util in the frontend if server mode previously relied on Python `pillow`. Tests: HEIF and oversized JPEG inputs produce a bounded JPEG.
- [ ] 3.6 Manual/E2E parity check on device (native): profile gen, shot analysis, compass, dial-in, pour-over, image upload/gen — behavior unchanged.

**Exit criteria:** `apps/frontend` runs entirely on `@metic/core` in direct mode; native behavior identical; image normalization is client-side; all frontend + direct tests green; `DirectModeInterceptor` deleted. Python server still running for browser/proxy users (unchanged).

---

## Phase 4 — Node Platform impl + Bun server host

**Goal:** Stand up `apps/server` (Bun) serving the same `@metic/core` handler for proxy-mode browsers, in parallel with the still-present Python server (different port during dev).

**Tasks:**
- [ ] 4.1 `platform/repos/*` — fs-JSON repos mapping to the EXISTING `/data` files/shapes (`settings.json`, `profile_history.json`, `scheduled_shots.json`, `recurring_schedules.json`, annotations, cache JSON, PNG image dir). Atomic temp-file + rename writes. Tests: read a fixture `/data` dir (copied from a real 2.x volume) and assert parity with Python reads; write-then-read round-trips.
- [ ] 4.2 `platform/node.ts` — assemble repos + `secrets.getAIConfig()` from env (`AI_PROVIDER`/`AI_API_KEY`, `GEMINI_API_KEY`/`GEMINI_MODEL`) + `machine.getBaseUrl()` from `METICULOUS_IP` + real `scheduler` (setTimeout/cron over the `schedules` repo) + fs BlobStore + TTL `aiCache`.
- [ ] 4.3 `machineProxy.ts` — transparent reverse proxy `/api/v1/*` → `${METICULOUS_IP}/api/v1/*` (stream body, copy headers/status). Tests: proxied GET/POST against a mock machine server.
- [ ] 4.4 `telemetryHub.ts` — one upstream `socket.io-client` to the machine; fan out to browser clients over a native `Bun.serve` WebSocket at `/api/ws/live`, emitting the FROZEN message shape (match today's `websocket.py`). Tests: connect a mock upstream, assert clients receive normalized frames; reconnect handling.
- [ ] 4.5 `server.ts` + `main.ts` — `Bun.serve` fetch: `/api/ws/live` → hub; `/api/v1/*` → proxy; `/api/*` → `handle(req, nodePlatform)`; else → static (`static.ts` serving `frontend/dist`). SSE for `/api/generate/progress` via `ReadableStream` reading `generationProgress`. `main.ts` argv: `serve` (default) | `healthcheck`. Do NOT add any server-side image library (`sharp`/libvips) — image bytes arrive pre-normalized from the frontend (see 3.5); the AI module forwards them as-is.
- [ ] 4.6 Point a proxy-mode frontend build at the Bun server; run existing browser/proxy E2E (`apps/frontend/e2e`) against it with a mock machine.

**Exit criteria:** Bun server answers the full `/api/*` contract identically to Python (same contract suite passes against `nodePlatform` + a live server E2E); reads an existing `/data` fixture without migration; telemetry + SSE + proxy work. Python server still present but now redundant.

---

## Phase 5 — Tailscale, health, startup/migration

**Goal:** Restore the remaining server-only surfaces on Bun without subprocess.

**Tasks:**
- [ ] 5.1 `tailscale.ts` — `getStatus()` via `fetch('http://local-tailscaled.sock/localapi/v0/status', { unix: '/var/run/tailscale/tailscaled.sock' })`; parse into the existing `/api/tailscale-status` shape. `configure()` stores `tailscaleEnabled`/`tailscaleAuthKey` in settings and (optionally) brings the node up via LocalAPI. Wire `/api/tailscale-status` + `/api/tailscale/configure` in `server.ts`. Tests: mock unix-socket server returning a status JSON.
- [ ] 5.2 `healthcheck.ts` — `main.ts healthcheck` pings `http://localhost:3550/health`, exit 0/1. Test: against a running server.
- [ ] 5.3 `startup.ts` — seed `PourOverBase.json` + recipes into `/data` if missing; run non-destructive one-shot migration (version stamp file); rehydrate scheduler from `schedules` repo. Tests: empty `/data` gets seeded; existing `/data` untouched; scheduled shots reloaded.

**Exit criteria:** Tailscale status/configure work via LocalAPI; health subcommand works; startup seeds/migrates non-destructively and rehydrates schedules.

---

## Phase 6 — Container (distroless single binary + size gate)

**Goal:** Produce the slim single-process image.

**Tasks:**
- [ ] 6.1 Rewrite `docker/Dockerfile.unified`: stage 1 `bun run build` (frontend → dist); stage 2 `bun build --compile --target=bun-linux-<arch> apps/server/src/main.ts --outfile metic`; stage 3 `FROM gcr.io/distroless/cc` + copy `metic` + `frontend/dist` + default data templates; `ENV` kept vars only; `HEALTHCHECK` → `["/metic","healthcheck"]`; `ENTRYPOINT ["/metic"]`; `EXPOSE 3550`. (Fallback: alpine + musl target if `--compile` fights a dep.)
- [ ] 6.2 Build multi-arch (amd64/arm64) locally; run the image against a mock machine; smoke-test `/health`, static, `/api/*`, `/api/ws/live`.
- [ ] 6.3 Add a CI **image-size gate**: fail if compressed image > threshold (set threshold ~120 MB with headroom after measuring the first successful build).

**Exit criteria:** image builds multi-arch, boots as one process, serves everything; size gate green and well under today's few-hundred-MB.

---

## Phase 7 — Cutover, parity-test port, rollout

**Goal:** Delete Python and flip the deployment, with the parity net and a safe beta rollout.

**Tasks:**
- [ ] 7.1 Port remaining `apps/server/test_main.py` behavioral assertions not yet covered into `packages/core/test/contract/` (aim for coverage parity of the frozen `/api/*` contract). Verify counts against the old suite.
- [ ] 7.2 Delete `apps/server` (Python), `apps/mcp-server`, `apps/bridge`; remove `docker/mosquitto*.conf`, `docker/nginx.conf`, `docker/s6-rc.d/`, `docker-compose.homeassistant.yml`; strip `MQTT_*`/`MCP_SERVER_PORT`/`SERVER_PORT` from compose + docs; drop `mosquitto-data` volume.
- [ ] 7.3 Update `docker-compose.yml` (same image/tag/port/`meticai-data` volume/Watchtower label), `docker-compose.tailscale.yml` (add shared `/var/run/tailscale` socket mount), README/HOME_ASSISTANT.md/TAILSCALE.md/UPDATING.md with deprecation notices (HA/MQTT, MCP endpoint, in-UI self-updater → Watchtower).
- [ ] 7.4 CI: replace Python test/lint/build jobs with `@metic/core` + `apps/server` Bun tests, the image build + size gate, and the Bun-server E2E. Keep frontend + Android/iOS jobs (repathed).
- [ ] 7.5 Bump `VERSION` + `apps/frontend/package.json` to `3.0.0-beta.1`. Publish under a **beta tag only**; keep `latest` on 2.x. Real-device validation: machine + LAN browser + Capacitor. Promote to `latest` only after validation, with migration notes.

**Exit criteria:** no Python in the repo/image; full CI green (core contract + Bun E2E + frontend + native builds + image-size gate); existing `/data` volume upgrades seamlessly; HA/MCP/self-updater deprecated with notices; Tailscale UI retained; 3.0.0-beta published on beta tag, `latest` still 2.x.

---

## Global testing & commit conventions

- **TDD everywhere:** failing test → minimal impl → green → commit. New `core`/server code needs tests in the respective `test/` dir; test both success and failure/edge paths.
- **Frozen contracts are the oracle:** `/api/*` schemas, `/api/ws/live` message shape, `/data` on-disk formats. Any diff from 2.x here is a release blocker.
- **Dual-runtime parity:** because both hosts call the same `handle()`, parity is structural; keep contract tests to lock it.
- **Commits:** Conventional Commits + `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`. Never stage `apps/capacitor/ios/App/App.xcodeproj/project.pbxproj`.
- **i18n:** any new user-facing strings use `t()` across all 6 locales (`en`, `sv`, `de`, `es`, `fr`, `it`).

## Follow-ups (out of scope)

- SQLite migration behind the same `Storage`/`Repo` interface (separate issue; no user-facing migration).
- Optional future TS reimplementation of the MCP server as an opt-in image.
