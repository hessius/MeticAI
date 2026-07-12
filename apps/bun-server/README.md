# @metic/server (Bun server)

Single-binary Bun host for MeticAI 3.0.0. Serves the built frontend, proxies
`/api/v1/*` to the espresso machine, runs the shared `@metic/core` handler for
`/api/*`, and hosts the `/api/ws/live` telemetry hub.

## Commands

```sh
bun run src/main.ts serve             # start the server (default)
bun run src/main.ts healthcheck       # probe /health, exit 0/1 (container HEALTHCHECK)
bun run src/main.ts storage-rollback  # reverse a SQLite migration (see below)
```

## Environment

| Var | Purpose |
| --- | --- |
| `PORT` | HTTP port (default `3550`). |
| `METICULOUS_IP` | Machine host or `host:port`; base for the `/api/v1/*` proxy. |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | AI provider config. |
| `DATA_DIR` | Persistence root (default `./data`). |
| `STORAGE_BACKEND` | `json` (default) or `sqlite` (see Persistence). |

## Persistence backends (#531)

Storage is reached only through the core `Storage`/`Repo` interface, so the
backend is swappable without touching any route.

- **`json` (default)** — flat JSON files under `DATA_DIR`, 1:1 with the shapes
  the 2.x Python server wrote. Zero migration for existing volumes.
- **`sqlite`** — a single `bun:sqlite` database at `DATA_DIR/metic.db`. On first
  boot with `STORAGE_BACKEND=sqlite`, a one-time, idempotent migration imports
  any existing JSON artifacts into SQLite and renames the originals to `*.bak`
  (nothing is deleted). A stamp file `.storage-migrated.json` records the run and
  guards against re-migration.

### Rollback

The SQLite migration is reversible. With the server stopped:

```sh
DATA_DIR=/path/to/data bun run src/main.ts storage-rollback
```

This drops `metic.db` (and its `-wal`/`-shm` sidecars), restores every `*.bak`
original to its place, and removes the stamp — returning the volume to flat
JSON. Then start the server without `STORAGE_BACKEND=sqlite` (or with
`STORAGE_BACKEND=json`).
