# Unified TypeScript Core + Bun Server (v3.0.0) — Design

**Status:** Approved design (brainstorm complete) — pending implementation plan
**Date:** 2026-07-02
**Target release:** 3.0.0 (single atomic epic)
**Branch:** `version/3.0.0`

## 1. Problem & Goal

Metic ships two runtimes that implement the same behavior twice:

- **Server mode** — React SPA + **Python FastAPI** backend (`apps/server`) for AI, profile/curve math, recommendations, machine I/O, persistence.
- **Native mode** — Capacitor iOS/Android app with **no server**; the same logic is reimplemented client-side in `apps/web/src/services/interceptor/DirectModeInterceptor.ts` (~3,658 LOC), `services/ai/`, and `lib/`.

Maintaining two implementations of one behavior is the project's biggest maintenance and correctness risk (the "parity treadmill"). Separately, the server Docker image is a few hundred MB (Python + `google-genai`/grpc + `pillow`/`pillow-heif` + three Python dependency trees + nginx + mosquitto + git + s6), which is unreasonable next to the few-MB Capacitor app.

**Goal:** collapse onto a **single TypeScript implementation** shared by both runtimes, and replace the Python server with a **single compiled Bun binary** in a slim (~60–100 MB) single-process container — while making the 3.0.0 upgrade **seamless** for existing server users.

## 2. Decisions (locked during brainstorm)

| # | Decision | Choice |
|---|---|---|
| 1 | Sequencing | **A — one atomic 3.0.0 epic**: core extraction + Bun server land together |
| 2 | Home Assistant / MQTT | **B — drop MQTT broker + bridge + HA**; keep live telemetry via direct Socket.IO. HA deprecated with notice |
| 3 | MCP server | **A — drop it** from the image (removes the last Python); deprecation notice |
| 4 | Persistence | **A — flat JSON files behind a `Storage` interface** (zero migration). SQLite deferred to a follow-up issue |
| 5 | AI on server | **A — server runs AI + image endpoints in Bun via the shared core**, using server-side env keys. Multi-provider (Gemini + OpenAI-compatible + others), per 2.6.0 |
| 6 | Process model | **A — single Bun process**; drop s6-overlay and nginx |
| 7 | Packaging | **A — compiled single binary (`bun build --compile`) on `distroless/cc`**; alpine+musl fallback |
| 8 | App naming | **A — `apps/frontend` + `apps/server`** (+ `packages/core`) |
| 9 | Capacitor location | **`apps/capacitor`** sibling; `webDir: '../frontend/dist'` |
| 10 | Tailscale UI | **Retained** via Tailscale LocalAPI over the shared `tailscaled.sock` (Bun `fetch({ unix })`); drop `.env`/compose rewriting |
| 11 | Self-updater | **Deprecated** → Watchtower / `docker compose pull` |

## 3. Architecture

### 3.1 Monorepo layout

```
packages/core/            # portable logic, framework-free (no Node, no DOM, no framework)
  handler.ts              # THE router: (Request, Platform) => Promise<Response>
  platform.ts             # Platform interface (the single seam)
  ai/                     # multi-provider, isomorphic (fetch-based)
  machine/                # Meticulous REST + Socket.IO client
  analysis/ recommendations/ prompts/ shotFacts/ compass/ decent/ validation/
  generationProgress.ts

apps/frontend/            # React SPA — runs in the native webview AND LAN browsers
  src/...
  platform/browser.ts     # Platform impl: IndexedDB/Capacitor Preferences, WebCrypto
  host/fetchHost.ts       # binds core.handler over window.fetch (direct mode only)

apps/capacitor/           # native wrapper only
  capacitor.config.ts     # webDir: '../frontend/dist'
  package.json            # @capacitor/cli + plugin deps (the "native host")
  ios/  android/

apps/server/              # the Bun backend (compiled binary / container)
  server.ts               # Bun.serve(): static + /api/v1 proxy + /api/ws/live hub + core.handler
  platform/node.ts        # Platform impl: fs-JSON repos, env secrets, cron scheduler
  healthcheck.ts          # `healthcheck` subcommand for Docker HEALTHCHECK
```

### 3.2 The keystone

`core` exposes **one Web-standard handler**: `(Request, Platform) => Promise<Response>`.

- The browser interceptor already produces `Response` objects.
- `Bun.serve({ fetch })` consumes exactly this signature.

So the **same handler** answers `/api/*` in both runtimes. There is **no separate "interceptor layer" vs "server layer."** Today's `DirectModeInterceptor` is decomposed into (a) routing+logic → `core/handler.ts` (shared; this is also the #528 refactor done properly) and (b) a tiny transport binding per host.

### 3.3 Duplication budget

| Concern | Frontend | Server | Duplication |
|---|---|---|---|
| Routing + logic + AI + machine client | `packages/core/handler.ts` | *same file* | **none** |
| Host (transport binding) | `host/fetchHost.ts` (patch `window.fetch`) | `server.ts` (`Bun.serve`) | ~50–120 LOC each, no logic |
| Platform impl | `platform/browser.ts` | `platform/node.ts` | different backends, one interface |

The only "two implementations" are the `Platform` impls — necessary (IndexedDB ≠ filesystem), small, interface-bounded. The browser impl mostly exists already (`directModeStorage` + `AppDatabase`); the node impl is the main net-new code (~300–500 LOC).

### 3.4 Frontend transport model (unchanged)

The existing `proxy` vs `direct` split stays:

- **Server users' browsers** → `proxy` mode → call the Bun server → Bun runs the **core handler server-side** (env AI keys, shared `/data` persistence). Preserves shared cross-device state and the one-server-key UX.
- **Native** → `direct` mode → runs the **core handler in-process**.

Same core, two hosts.

## 4. The `Platform` interface + persistence

`Platform` is the single seam, implemented twice. `core` depends only on it.

```ts
interface Platform {
  storage: {
    settings:       Repo<Settings>
    history:        Repo<HistoryEntry>
    annotations:    Repo<Annotation>
    dialInSessions: Repo<DialInSession>
    pourOverPrefs:  Repo<PourOverPrefs>
    schedules:      Repo<ScheduledShot | RecurringSchedule>
    aiCache:        Cache          // TTL-aware
    images:         BlobStore      // profile images (bytes)
  }
  secrets: { getAIConfig(): { provider: string; apiKey: string; model?: string } }
  machine: { getBaseUrl(): string } // native → stored URL; server → METICULOUS_IP
  scheduler?: Scheduler            // OPTIONAL — asymmetric on purpose (see 4.2)
  clock: () => number
  logger: Logger
}
```

### 4.1 Seamless persistence (zero migration)

Each repo maps to the **existing on-disk artifact with its existing internal shape**, so the Bun server reads a current user's `/data` volume untouched on first boot:

| Repo | Node impl (`/data`) | Browser impl |
|---|---|---|
| settings | `settings.json` | IndexedDB `settings` |
| history | `profile_history.json` | `AppDatabase` history store |
| annotations | existing annotations file | IndexedDB |
| schedules | `scheduled_shots.json`, `recurring_schedules.json` | n/a (see 4.2) |
| aiCache | existing cache JSON | IndexedDB |
| images | existing PNG dir | IndexedDB blobs |

Node writes use the current **atomic temp-file + rename** pattern. Rollback-safe: 3.0.0 only reads/writes the same files.

### 4.2 Scheduler is optional and asymmetric

A closed app cannot fire a shot, so native already `501`s scheduling today. `scheduler?` is optional: `platform/node.ts` supplies a real scheduler (persist to `schedules` repo, rehydrate cron timers on boot); `platform/browser.ts` omits it, and the schedule routes in `core` return `501` when it is absent — identical to current native behavior, no route branching.

## 5. Machine client, live telemetry, `/api/v1` proxy

The **machine client lives in `core`** and is isomorphic (REST via `fetch`, telemetry via `socket.io-client`; both run in the webview and in Bun). Built from `Platform.machine.getBaseUrl()`. Exposes commands (start/stop/preheat/tare/profiles/shots…) and a telemetry stream (`status`/`sensors`/`actuators`).

**Native (`direct`):** the webview runs the core machine client and connects straight to the machine (Capacitor `http` scheme → no CORS/mixed-content). Telemetry consumed directly.

**Server (`proxy`) — three Bun surfaces:**

| Path | Behavior |
|---|---|
| `/api/*` (MeticAI contract) | → core handler (business logic); core uses the machine client in-process |
| `/api/v1/*` (machine-native) | → transparent reverse-proxy to `${METICULOUS_IP}/api/v1/*` — fixes browser CORS + http/https |
| `/api/ws/live` | → telemetry hub: **one** upstream Socket.IO connection to the machine, fanned out to browser clients over a native WebSocket |

The telemetry hub **replaces mosquitto + the `meticulous-addon` MQTT bridge** with a direct Socket.IO→WS rebroadcast (one machine connection for N browsers, no broker).

**Frozen contract:** the `/api/ws/live` message shape stays byte-identical, so the frontend's proxy-mode telemetry consumer is unchanged. The `mosquitto-data` volume and `MQTT_*` env vars are retired.

## 6. AI + image generation

**Multi-provider AI moves into `core/ai`** (Gemini + OpenAI-compatible + others). `fetch`-based and isomorphic; key/model via `Platform.secrets.getAIConfig()`:
- native → user settings (per-device key)
- server → env (`AI_PROVIDER`/`AI_API_KEY`, `GEMINI_API_KEY`/`GEMINI_MODEL`)

**Image handling — push all raster work to the frontend** (Canvas/`createImageBitmap`), in both modes:
- HEIF→JPEG + resize happen **client-side** before bytes reach the AI module → neither Bun nor the machine needs an image library.
- AI-generated images returned by the provider (PNG/base64) are stored via `Platform.storage.images` and displayed by the frontend.

Result: `pillow`, `pillow-heif`, and any server-side `sharp`/libvips are all avoided (no native image deps vs `bun --compile`/distroless).

**Progress / SSE.** Progress is a shared `core` tracker (port of `generation_progress.py`). Binding differs, logic does not:
- server → Bun exposes `/api/generate/progress` as **SSE** (`ReadableStream`), preserving the proxy-mode contract.
- native → consumes the tracker directly (current synchronous behavior).

## 7. Container: build, image, startup, config, updates

**Multi-stage build → one small artifact:**
1. Frontend: `bun run build` in `apps/frontend` → `dist/`.
2. Server: `bun build --compile` in `apps/server` → single binary.
3. Runtime: `distroless/cc` + binary + `frontend/dist` + default data templates. Fallback: alpine + Bun musl target.

No Python, nginx, s6, mosquitto, git, or `node_modules`. **Estimated ~60–100 MB**, single process, `ENTRYPOINT [binary]`.

**Startup (replaces s6 one-shots):**
1. Seed default templates into `/data` if missing (`PourOverBase.json`, recipes).
2. Non-destructive one-shot data migration if a format bump is needed.
3. Rehydrate the scheduler from the `schedules` repo.
4. `Bun.serve()` on **3550**.

**Config/env:**
- Kept: `GEMINI_API_KEY`, `GEMINI_MODEL`, `METICULOUS_IP`, `DATA_DIR`, `AI_PROVIDER`, `AI_API_KEY`.
- Retired: `MQTT_*`, `MCP_SERVER_PORT`, `SERVER_PORT`. Volume `mosquitto-data` dropped; `meticai-data` unchanged.

**Health check:** distroless has no `curl` → the binary gets a `healthcheck` subcommand pinging `localhost:3550/health`; `HEALTHCHECK` calls the binary.

**Updates:** the in-container self-updater (`update.sh` + `/api/trigger-update`, `/api/restart`, `/api/beta-channel`, `/api/update-method`) is **removed** (no bash/subprocess in distroless). Image updates rely on **Watchtower** (label kept) or `docker compose pull`. `/api/version`, `/api/health`, `/api/changelog` remain.

**Tailscale UI — retained.** Bun's `fetch({ unix })` queries the sidecar's Tailscale **LocalAPI** over the shared `tailscaled.sock`:
- `/api/tailscale-status` → live status (connected/hostname/ip/login_url) via `/localapi/v0/status`.
- `/api/tailscale/configure` → stores `tailscaleEnabled`/`tailscaleAuthKey` in settings; activation via LocalAPI (better than editing `.env`).
- Requires the compose overlay to share the tailscaled socket into the app container (documented one-line volume mount). The `.env`/`COMPOSE_FILES` rewriting + compose restart is dropped.

**Compose:** same image name/tag `ghcr.io/hessius/meticai`, same port `3550`, same `meticai-data` volume, Watchtower label kept. Remove `docker-compose.homeassistant.yml` + MQTT env. Existing users' upgrade action is just `docker compose pull && up -d`.

## 8. Cutover, parity testing, rollout

**Big-bang cutover (Option A):** 3.0.0 deletes `apps/server` (Python), `apps/mcp-server`, `apps/bridge`, mosquitto, nginx, s6. The frontend `proxy` transport stays but points at the Bun server; native `direct` behavior is unchanged.

**Frozen contracts (the safety net):**
- `/api/*` request/response schemas.
- `/api/ws/live` message shape.
- `/data` on-disk formats.

**Parity testing:**
- Port the existing Python **`test_main.py` (750+)** behavioral assertions into a **`core` contract-test suite** run against a **mock `Platform`** (same request in → same response out). This proves the Bun server matches the Python one before deletion.
- Keep existing **frontend tests (277+)** and `*.direct.test` parity tests; parity becomes structural since both hosts call the same handler.
- New **Playwright E2E** against a live Bun binary + simulated machine (reuse `DemoAdapter` / `test_integration_machine` fixtures).
- **CI gates:** core contract suite + frontend + Bun E2E green; `bun build --compile` succeeds; **image-size check** (fail on regression past threshold).

**Migration + rollback:** first boot reads existing `/data` untouched (non-destructive). Rollback = re-pin the previous image tag (data compatible). One-shot migration runs only if a format bump is ever needed, writing alongside.

**Rollout (protect Watchtower users from a surprise major upgrade):** publish `3.0.0-beta.*` under a **beta tag only**; keep `latest` on 2.x until 3.0.0 is validated on a real machine + LAN browser + Capacitor. `latest`+Watchtower users auto-upgrade only when 3.0.0 is promoted to `latest`, with migration notes in the release.

**Deprecations (documented, with notices):**
- Home Assistant / MQTT integration.
- Bundled MCP server endpoint.
- In-UI self-updater (→ Watchtower / `compose pull`).

(Retained: Tailscale UI via LocalAPI-over-socket.)

**Top implementation risks:** contract fidelity of ported Python tests; SSE streaming under `Bun.serve`; scheduler rehydration correctness; `bun --compile` vs unix-socket `fetch` and `socket.io-client` (all pure-JS → low risk).

## 9. Migration notes to record for implementers

- Build/CI path change: `apps/web/android/gradlew` → **`apps/capacitor/android/gradlew`**; the never-stage `project.pbxproj` rule now applies under `apps/capacitor/ios/...`.
- Capacitor plugin detection: declare `@capacitor/*` plugin deps in `apps/capacitor/package.json`; keep workspace hoisting consistent (or pin Capacitor packages in `apps/capacitor`) so CocoaPods/Gradle paths resolve.
- The frontend keeps runtime Capacitor detection (`window.Capacitor`) — no build coupling to the native project location.

## 10. Follow-ups (out of scope for 3.0.0)

- **SQLite migration** for persistence (behind the same `Storage`/`Repo` interface, no user-facing migration) — tracked as a separate issue.
- Optional future TS reimplementation of the MCP server as a separate opt-in image.
