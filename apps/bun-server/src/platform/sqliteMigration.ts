/**
 * One-time flat-JSON -> SQLite boot migration (issue #531).
 *
 * Idempotent (a stamp file guards re-runs) and reversible (`rollback...` restores
 * the JSON and drops the DB). Imports an existing 2.x/3.0 `/data` volume into the
 * SQLite database, then renames each imported original to `*.bak` so nothing is
 * destroyed. Record shapes are preserved 1:1, so the `/api/*` contract is
 * unchanged regardless of backend.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import type { SqliteStorageHandles } from "./sqliteStorage.ts";

const STAMP_FILE = ".storage-migrated.json";

interface MigrationStamp {
  backend: "sqlite";
  migratedAt: string;
  backedUp: string[];
}

/** Singleton JSON files: the whole file is one document. */
const SINGLETON_FILES: Array<{ file: string; collection: string }> = [
  { file: "settings.json", collection: "settings" },
  { file: "profile_history.json", collection: "history" },
  { file: "pour_over_preferences.json", collection: "pourOverPrefs" },
];

/** Keyed-map JSON files: each top-level key is a document. */
const KEYED_MAP_FILES: Array<{ file: string; collection: string }> = [
  { file: "shot_annotations.json", collection: "annotations" },
  { file: "dialin_sessions.json", collection: "dialInSessions" },
  { file: "profile_descriptions.json", collection: "descriptions" },
  { file: "profile_ai_tags.json", collection: "aiTags" },
];

/** Directory-of-`${id}.json` collections. */
const DIRECTORY_COLLECTIONS: Array<{ dir: string; collection: string }> = [
  { dir: "schedules", collection: "schedules" },
];

const IMAGE_DIR = "images";

function stampPath(dataDir: string): string {
  return join(dataDir, STAMP_FILE);
}

/** Whether the SQLite backend has already adopted this data directory. */
export function isMigrated(dataDir: string): boolean {
  return existsSync(stampPath(dataDir));
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * Import every known flat-JSON artifact under `dataDir` into `handles`, then
 * back up each imported original to `*.bak`. No-op (returns false) if a stamp
 * already exists. Returns true when a migration was performed.
 */
export function migrateJsonToSqlite(
  dataDir: string,
  handles: SqliteStorageHandles,
  log: (message: string) => void = () => {},
): boolean {
  if (isMigrated(dataDir)) return false;

  const backedUp: string[] = [];
  const backup = (relPath: string): void => {
    const abs = join(dataDir, relPath);
    if (existsSync(abs)) {
      renameSync(abs, `${abs}.bak`);
      backedUp.push(relPath);
    }
  };

  const importAll = handles.db.transaction(() => {
    for (const { file, collection } of SINGLETON_FILES) {
      const abs = join(dataDir, file);
      if (!existsSync(abs)) continue;
      const value = safeParse(readFileSync(abs, "utf8"));
      if (value !== undefined) {
        void handles.singletonRepo(collection).write("", value);
      }
    }

    for (const { file, collection } of KEYED_MAP_FILES) {
      const abs = join(dataDir, file);
      if (!existsSync(abs)) continue;
      const map = safeParse(readFileSync(abs, "utf8"));
      if (map && typeof map === "object" && !Array.isArray(map)) {
        const repo = handles.documentRepo(collection);
        for (const [key, value] of Object.entries(map as Record<string, unknown>)) {
          void repo.write(key, value);
        }
      }
    }

    for (const { dir, collection } of DIRECTORY_COLLECTIONS) {
      const absDir = join(dataDir, dir);
      if (!existsSync(absDir)) continue;
      const repo = handles.documentRepo(collection);
      for (const entry of readdirSync(absDir)) {
        if (!entry.endsWith(".json")) continue;
        const value = safeParse(readFileSync(join(absDir, entry), "utf8"));
        if (value !== undefined) void repo.write(entry.slice(0, -".json".length), value);
      }
    }

    const absImageDir = join(dataDir, IMAGE_DIR);
    if (existsSync(absImageDir)) {
      const blobs = handles.blobStore();
      for (const entry of readdirSync(absImageDir)) {
        const bytes = new Uint8Array(readFileSync(join(absImageDir, entry)));
        void blobs.write(entry, bytes);
      }
    }
  });

  importAll();

  // Import succeeded: back up originals so the volume is non-destructive.
  for (const { file } of SINGLETON_FILES) backup(file);
  for (const { file } of KEYED_MAP_FILES) backup(file);
  for (const { dir } of DIRECTORY_COLLECTIONS) backup(dir);
  backup(IMAGE_DIR);

  const stamp: MigrationStamp = {
    backend: "sqlite",
    migratedAt: new Date().toISOString(),
    backedUp,
  };
  writeFileSync(stampPath(dataDir), JSON.stringify(stamp, null, 2));
  log(`[storage] migrated ${backedUp.length} JSON artifact(s) to SQLite`);
  return true;
}

/**
 * Reverse a SQLite migration: drop the database, restore every `*.bak` original,
 * and remove the stamp. Safe to call whether or not a migration ran.
 */
export function rollbackSqliteMigration(
  dataDir: string,
  log: (message: string) => void = () => {},
): boolean {
  const stamp = stampPath(dataDir);
  if (!existsSync(stamp)) return false;

  const parsed = safeParse(readFileSync(stamp, "utf8")) as MigrationStamp | undefined;
  const backedUp = parsed?.backedUp ?? [];

  for (const dbFile of ["metic.db", "metic.db-wal", "metic.db-shm"]) {
    const abs = join(dataDir, dbFile);
    if (existsSync(abs)) rmSync(abs, { force: true });
  }

  for (const relPath of backedUp) {
    const bak = join(dataDir, `${relPath}.bak`);
    const orig = join(dataDir, relPath);
    if (existsSync(bak)) renameSync(bak, orig);
  }

  rmSync(stamp, { force: true });
  log(`[storage] rolled back SQLite migration; restored ${backedUp.length} artifact(s)`);
  return true;
}
