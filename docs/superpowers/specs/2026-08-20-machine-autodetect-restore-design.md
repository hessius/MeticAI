# Machine auto-detection — restore server detect + harden native mDNS + subnet scan

Date: 2026-08-20 · Branch: `version/3.0.0` · Relates to: 3.0.0 migration regression

## Problem

Two reports after the 3.0.0 Python→Bun migration:

1. **Web / Docker / Vite proxy mode:** "Detect machine" always fails. Root cause: the
   old Python backend implemented `POST /api/machine/detect` (added in `73028fea`,
   deleted with the whole Python backend in `6a0cdca3`). The new `packages/core` only
   stubs **`GET /api/machine/detect` → 501**; there is **no `POST` handler**, so the
   web app's `handleDetectMachine()` (`SettingsView.tsx`) posts to a route that never
   answers → detection fails. This is a migration regression.

2. **Android native:** mDNS discovery sometimes fails. `discovery.ts` can finalize a
   machine whose only host is a randomized `<Meticulous…>.local` name (from an mDNS
   `added` event that arrived before resolution). Android's HTTP resolver cannot
   resolve `.local` mDNS names, so the follow-up reachability probe fails even though
   the service was found.

### Key domain fact
The machine's mDNS instance/host name is **randomized** but **always starts with
"Meticulous"** (e.g. `Meticulous-a3f7.local`). Therefore fixed-hostname probes
(`meticulous.local`, `meticulous-home.local`) are unreliable. Robust discovery must
rely on the mDNS **service type** `_meticulous._tcp` (matches any instance name) and,
as a network-level fallback, a **subnet scan**.

## Approach (approved: B — hardening + subnet scan on both runtimes)

### Server side (proxy / Docker / web) — `packages/core`
Restore `POST /api/machine/detect` as a platform-agnostic core service:

1. **Configured IP:** if `platform.machine.getBaseUrl()` verifies at
   `/api/v1/settings` → `{ found, ip, method: 'configured' }`.
2. **Subnet scan:** via a new **optional** `Platform.netScan` capability that returns
   the host's non-internal IPv4 addresses. For each, probe the `/24`
   (`http://<ip>:8080/api/v1/settings`, skip `.0`/`.255`, capped concurrency, short
   per-host timeout) → first reachable wins → `{ found, ip, method: 'scan' }`.
   Server-side `fetch` has no CORS constraints, so this is reliable in Docker.
3. Else `{ found: false, guidance_key: 'notFound', guidance_hints: [...] }`.

Fixed-hostname resolution is intentionally **dropped** (randomized names). `netScan`
is only implemented by the Node/Bun platform; native/mock omit it, so the core handler
degrades to configured-IP-only + notFound in non-server contexts (native uses its own
client-side path, below).

### Native (Android/iOS) — `apps/web/src/services/machine/discovery.ts`
- **mDNS hardening:** prefer a real IPv4; **never finalize a `.local`-only host**;
  prefer the `resolved` event over `added`; only early-return once an IPv4 is known.
- **Subnet-scan fallback:** when mDNS yields nothing (or only `.local`), derive the
  device's own IPv4 via a **WebRTC host-candidate probe** (`RTCPeerConnection` +
  data channel; parse the `candidate` lines for a private IPv4). Then scan that `/24`
  with `CapacitorHttp` (bypasses WebView CORS). If the candidate is obfuscated to
  `.local` (browser privacy), skip the scan and rely on hardened mDNS.

## Testing
- `packages/core`: unit tests for `detectMachine` (configured-hit, scan-hit, not-found)
  with a mock platform whose `netScan` + `fetch` are stubbed; contract test that
  `POST /api/machine/detect` returns the payload.
- `discovery.ts`: extend `discovery.test.ts` — mDNS prefers IPv4 / doesn't emit
  `.local`-only; WebRTC IP parse; subnet scan hit/miss (mock `CapacitorHttp` +
  `RTCPeerConnection`). Both success and failure paths per repo convention.

## Out of scope
- Node-side mDNS browsing (new dep; Docker mDNS unreliable) — subnet scan covers it.
- On-device verification (needs physical Android device).
