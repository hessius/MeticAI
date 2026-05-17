# Fix: Machine Status watcher URL resolution

## Problem
The machine status endpoint uses `.replace(':8080', ':3000')` to derive the watcher URL from the machine base URL. But `METICULOUS_IP` is often just an IP like `192.168.50.168` — no port in the URL — so the replace is a no-op and it hits port 80 instead of 3000.

**Server (Docker):** `_resolve_meticulous_base_url()` → `http://192.168.50.168` → `.replace(':8080',':3000')` → `http://192.168.50.168` (port 80, wrong!)

**Capacitor:** `getDefaultMachineUrl()` may return `http://192.168.50.168:8080` (works) or just `http://192.168.50.168` (broken) depending on how the user configured the machine.

## Fix
Replace fragile string replacement with proper URL parsing in both locations:

### 1. Server — `apps/server/api/routes/machine_status.py`
- Use `urllib.parse.urlparse` to parse the machine URL, replace port with 3000, reconstruct
- Simple helper: `_watcher_url(machine_url) → str`

### 2. Capacitor — `apps/web/src/services/interceptor/DirectModeInterceptor.ts`
- Use `new URL()` to parse, set `.port = '3000'`, use `.origin`

### Files to change
- `apps/server/api/routes/machine_status.py` — fix watcher URL derivation
- `apps/web/src/services/interceptor/DirectModeInterceptor.ts` — fix watcher URL derivation

### Testing
- Verify `curl http://localhost:3550/api/machine/status/health` returns real data
- Run existing tests (864 server + 1025 web)
