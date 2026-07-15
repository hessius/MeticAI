/**
 * SQLite-backed storage for the Node/Bun platform (issue #531).
 *
 * A single `bun:sqlite` database at `${dataDir}/metic.db` backs the same
 * `Storage`/`Repo` interface the flat-JSON platform uses, so `@metic/core` and
 * every `/api/*` route are unaffected by the choice of backend. Selected via
 * `STORAGE_BACKEND=sqlite`; the default stays flat JSON for zero-migration
 * continuity with 2.x volumes.
 *
 * All document collections (directory, singleton and keyed-map repos in the
 * flat-JSON platform) share one `documents(collection, key, value)` table;
 * images live in `blobs(key, data)`. A one-time, idempotent and reversible boot
 * migration (see `migrateJsonToSqlite`) imports an existing `/data/*.json`
 * volume, renaming the originals to `*.bak`.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Repo, BlobStore } from "@metic/core/platform";

/** Sentinel key for singleton repos (settings.json etc.): one row per collection. */
const SINGLETON_KEY = "";

export interface SqliteStorageHandles {
  db: Database;
  documentRepo<T>(collection: string): Repo<T>;
  singletonRepo<T>(collection: string): Repo<T>;
  blobStore(): BlobStore;
  close(): void;
}

function initSchema(db: Database): void {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(
    `CREATE TABLE IF NOT EXISTS documents (
       collection TEXT NOT NULL,
       key        TEXT NOT NULL,
       value      TEXT NOT NULL,
       PRIMARY KEY (collection, key)
     )`,
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS blobs (
       key  TEXT PRIMARY KEY,
       data BLOB NOT NULL
     )`,
  );
}

/**
 * Open (creating if needed) the SQLite database under `dataDir` and return
 * repo/blob factories bound to it. The caller owns `close()`.
 */
export function openSqliteStorage(dataDir: string): SqliteStorageHandles {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "metic.db"), { create: true });
  initSchema(db);

  const readStmt = db.query<{ value: string }, [string, string]>(
    "SELECT value FROM documents WHERE collection = ? AND key = ?",
  );
  const listStmt = db.query<{ value: string }, [string]>(
    "SELECT value FROM documents WHERE collection = ?",
  );
  const upsertStmt = db.query<unknown, [string, string, string]>(
    `INSERT INTO documents (collection, key, value) VALUES (?, ?, ?)
     ON CONFLICT(collection, key) DO UPDATE SET value = excluded.value`,
  );
  const deleteStmt = db.query<unknown, [string, string]>(
    "DELETE FROM documents WHERE collection = ? AND key = ?",
  );

  function parse<T>(value: string | undefined): T | null {
    if (value == null) return null;
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  function documentRepo<T>(collection: string): Repo<T> {
    return {
      async read(id) {
        return parse<T>(readStmt.get(collection, id)?.value);
      },
      async list() {
        const out: T[] = [];
        for (const row of listStmt.all(collection)) {
          const v = parse<T>(row.value);
          if (v != null) out.push(v);
        }
        return out;
      },
      async write(id, value) {
        upsertStmt.run(collection, id, JSON.stringify(value));
      },
      async delete(id) {
        deleteStmt.run(collection, id);
      },
    };
  }

  function singletonRepo<T>(collection: string): Repo<T> {
    return {
      async read() {
        return parse<T>(readStmt.get(collection, SINGLETON_KEY)?.value);
      },
      async list() {
        const v = parse<T>(readStmt.get(collection, SINGLETON_KEY)?.value);
        return v == null ? [] : [v];
      },
      async write(_id, value) {
        upsertStmt.run(collection, SINGLETON_KEY, JSON.stringify(value));
      },
      async delete() {
        deleteStmt.run(collection, SINGLETON_KEY);
      },
    };
  }

  const blobReadStmt = db.query<{ data: Uint8Array }, [string]>(
    "SELECT data FROM blobs WHERE key = ?",
  );
  const blobUpsertStmt = db.query<unknown, [string, Uint8Array]>(
    `INSERT INTO blobs (key, data) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET data = excluded.data`,
  );
  const blobDeleteStmt = db.query<unknown, [string]>("DELETE FROM blobs WHERE key = ?");

  function blobStore(): BlobStore {
    return {
      async read(key) {
        const row = blobReadStmt.get(key);
        if (!row) return null;
        // bun:sqlite returns BLOB columns as Uint8Array.
        return row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data);
      },
      async write(key, bytes) {
        blobUpsertStmt.run(key, bytes);
      },
      async delete(key) {
        blobDeleteStmt.run(key);
      },
    };
  }

  return {
    db,
    documentRepo,
    singletonRepo,
    blobStore,
    close: () => db.close(),
  };
}
