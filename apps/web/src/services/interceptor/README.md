# Direct-mode request interceptor

In native/Capacitor (and same-origin browser direct mode) there is no backend
server: the app talks to the espresso machine directly and serves its own
`/api/*` proxy routes client-side. This directory installs that behavior over
`window.fetch`.

As of v3.0.0 the entire per-route request implementation lives in the shared
`@metic/core` handler (`packages/core`), the same code the Bun server runs. The
former ~3,658-line `DirectModeInterceptor.ts` monolith has been **deleted**; this
directory is now a thin host binding around core plus a small browser-only shim.

## Module map

| File | Responsibility |
| --- | --- |
| `coreInterceptor.ts` | Install site. Patches `window.fetch`: MeticAI proxy `/api/*` requests go to the browser-native shim first, then core's `tryHandle`, then a terminal 404. Machine-native `/api/v1/*` and external URLs bypass core to the original fetch. Builds the browser `Platform` once. |
| `browserNativeRoutes.ts` | The handful of routes core cannot own because they need browser-only capabilities: profile image upload / generate-image / apply-image (`<canvas>` downscaling) and pour-over cleanup "restore previous profile" (`sessionStorage`). Runs before core. |
| `directModeHttp.ts` | Request classification helpers: `isMeticAIProxyApiPath`, `getDirectRequestContext`, `jsonResponse`. Decides which URLs the interceptor owns. |
| `directModeStorage.ts` | IndexedDB-backed helpers (settings, annotations, dial-in sessions, profile images) used by the browser `Platform` and the native shim. |

Everything else — profiles CRUD, history, shots, analysis, recommendations,
dial-in, pour-over, recipes, machine commands, system/settings — is served by
`@metic/core` route modules through the browser `Platform`
(`apps/web/src/services/platform/browserPlatform.ts`).

## Dual-runtime parity

Because both the browser interceptor and the Bun server call the same
`@metic/core` `handle()` / `tryHandle()`, route behavior is shared by
construction. Add or change a route in `packages/core/src/routes/*` (with a
contract test), not here. Only add to this directory when a route genuinely
depends on a browser-only API (canvas, `sessionStorage`, the Camera plugin).
