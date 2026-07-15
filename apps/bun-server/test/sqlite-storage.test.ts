import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodePlatform } from "../src/platform/node.ts";
import { openSqliteStorage } from "../src/platform/sqliteStorage.ts";
import {
  migrateJsonToSqlite,
  rollbackSqliteMigration,
  isMigrated,
} from "../src/platform/sqliteMigration.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "metic-sqlite-"));
  dirs.push(d);
  return d;
}

afterEach(async () => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

// The SQLite backend must satisfy the SAME Repo contract as the flat-JSON one
// (see node-platform.test.ts), so /api/* behavior is backend-independent.
describe("createNodePlatform storage (sqlite backend)", () => {
  test("directory repo round-trips documents by id", async () => {
    const platform = createNodePlatform({
      dataDir: await tempDir(),
      storageBackend: "sqlite",
    });
    const schedules = platform.storage.schedules;

    expect(await schedules.read("a")).toBeNull();
    expect(await schedules.list()).toEqual([]);

    await schedules.write("a", { hour: 7 });
    await schedules.write("b", { hour: 8 });

    expect(await schedules.read("a")).toEqual({ hour: 7 });
    const all = (await schedules.list()) as { hour: number }[];
    expect(all.map((s) => s.hour).sort()).toEqual([7, 8]);

    await schedules.delete("a");
    expect(await schedules.read("a")).toBeNull();
    expect((await schedules.list()).length).toBe(1);
  });

  test("write is an upsert (updates in place)", async () => {
    const platform = createNodePlatform({
      dataDir: await tempDir(),
      storageBackend: "sqlite",
    });
    await platform.storage.schedules.write("a", { hour: 7 });
    await platform.storage.schedules.write("a", { hour: 9 });
    expect(await platform.storage.schedules.read("a")).toEqual({ hour: 9 });
    expect((await platform.storage.schedules.list()).length).toBe(1);
  });

  test("singleton settings repo persists a single document, ignoring id", async () => {
    const platform = createNodePlatform({
      dataDir: await tempDir(),
      storageBackend: "sqlite",
    });
    expect(await platform.storage.settings.read("settings")).toBeNull();

    await platform.storage.settings.write("settings", { meticulousIp: "1.2.3.4" });
    expect(await platform.storage.settings.read("anything")).toEqual({ meticulousIp: "1.2.3.4" });
    expect(await platform.storage.settings.list()).toEqual([{ meticulousIp: "1.2.3.4" }]);
  });

  test("keyed-map annotations repo handles slash-containing ids", async () => {
    const platform = createNodePlatform({
      dataDir: await tempDir(),
      storageBackend: "sqlite",
    });
    const annotations = platform.storage.annotations;

    await annotations.write("2024-01-15/a.json", { key: "2024-01-15/a.json", rating: 4 });
    await annotations.write("2024-01-15/b.json", { key: "2024-01-15/b.json", rating: 2 });

    expect(await annotations.read("2024-01-15/a.json")).toEqual({
      key: "2024-01-15/a.json",
      rating: 4,
    });
    expect((await annotations.list()).length).toBe(2);

    await annotations.delete("2024-01-15/a.json");
    expect(await annotations.read("2024-01-15/a.json")).toBeNull();
    expect((await annotations.list()).length).toBe(1);
  });

  test("blob store round-trips bytes", async () => {
    const platform = createNodePlatform({
      dataDir: await tempDir(),
      storageBackend: "sqlite",
    });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(await platform.storage.images.read("img")).toBeNull();
    await platform.storage.images.write("img", bytes);
    expect(Array.from((await platform.storage.images.read("img"))!)).toEqual([1, 2, 3, 4]);
    await platform.storage.images.delete("img");
    expect(await platform.storage.images.read("img")).toBeNull();
  });

  test("data persists across platform re-open (same dataDir)", async () => {
    const dataDir = await tempDir();
    const first = createNodePlatform({ dataDir, storageBackend: "sqlite" });
    await first.storage.settings.write("settings", { theme: "dark" });
    await first.storage.annotations.write("2024/x.json", { rating: 5 });

    const second = createNodePlatform({ dataDir, storageBackend: "sqlite" });
    expect(await second.storage.settings.read("s")).toEqual({ theme: "dark" });
    expect(await second.storage.annotations.read("2024/x.json")).toEqual({ rating: 5 });
  });
});

async function seedJsonVolume(dataDir: string): Promise<void> {
  await writeFile(join(dataDir, "settings.json"), JSON.stringify({ meticulousIp: "10.0.0.9" }));
  await writeFile(join(dataDir, "profile_history.json"), JSON.stringify({ entries: [1, 2, 3] }));
  await writeFile(
    join(dataDir, "shot_annotations.json"),
    JSON.stringify({ "2024-01-15/a.json": { rating: 4 }, "2024-01-15/b.json": { rating: 2 } }),
  );
  await writeFile(
    join(dataDir, "profile_ai_tags.json"),
    JSON.stringify({ Espresso: ["fruity", "bright"] }),
  );
  await mkdir(join(dataDir, "schedules"), { recursive: true });
  await writeFile(join(dataDir, "schedules", "morning.json"), JSON.stringify({ hour: 7 }));
  await mkdir(join(dataDir, "images"), { recursive: true });
  await writeFile(join(dataDir, "images", "Espresso"), Buffer.from([9, 8, 7]));
}

describe("flat-JSON -> SQLite boot migration (#531)", () => {
  test("imports an existing /data volume and backs up originals", async () => {
    const dataDir = await tempDir();
    await seedJsonVolume(dataDir);

    const handles = openSqliteStorage(dataDir);
    const migrated = migrateJsonToSqlite(dataDir, handles);
    handles.close();

    expect(migrated).toBe(true);
    expect(isMigrated(dataDir)).toBe(true);

    // Originals renamed to *.bak (non-destructive).
    expect(existsSync(join(dataDir, "settings.json"))).toBe(false);
    expect(existsSync(join(dataDir, "settings.json.bak"))).toBe(true);
    expect(existsSync(join(dataDir, "schedules.bak"))).toBe(true);
    expect(existsSync(join(dataDir, "images.bak"))).toBe(true);

    // Data is readable through the SQLite-backed platform.
    const platform = createNodePlatform({ dataDir, storageBackend: "sqlite" });
    expect(await platform.storage.settings.read("s")).toEqual({ meticulousIp: "10.0.0.9" });
    expect(await platform.storage.history.read("h")).toEqual({ entries: [1, 2, 3] });
    expect(await platform.storage.annotations.read("2024-01-15/a.json")).toEqual({ rating: 4 });
    expect(await platform.storage.aiTags.read("Espresso")).toEqual(["fruity", "bright"]);
    expect(await platform.storage.schedules.read("morning")).toEqual({ hour: 7 });
    expect(Array.from((await platform.storage.images.read("Espresso"))!)).toEqual([9, 8, 7]);
  });

  test("is idempotent: a second run is a no-op", async () => {
    const dataDir = await tempDir();
    await seedJsonVolume(dataDir);

    const h1 = openSqliteStorage(dataDir);
    expect(migrateJsonToSqlite(dataDir, h1)).toBe(true);
    h1.close();

    const h2 = openSqliteStorage(dataDir);
    expect(migrateJsonToSqlite(dataDir, h2)).toBe(false);
    h2.close();
  });

  test("rollback restores originals and drops the database", async () => {
    const dataDir = await tempDir();
    await seedJsonVolume(dataDir);

    const handles = openSqliteStorage(dataDir);
    migrateJsonToSqlite(dataDir, handles);
    handles.close();

    expect(rollbackSqliteMigration(dataDir)).toBe(true);

    // JSON originals restored, backups and DB gone, stamp removed.
    expect(existsSync(join(dataDir, "settings.json"))).toBe(true);
    expect(existsSync(join(dataDir, "settings.json.bak"))).toBe(false);
    expect(existsSync(join(dataDir, "schedules", "morning.json"))).toBe(true);
    expect(existsSync(join(dataDir, "metic.db"))).toBe(false);
    expect(isMigrated(dataDir)).toBe(false);

    const restored = JSON.parse(await readFile(join(dataDir, "settings.json"), "utf8"));
    expect(restored).toEqual({ meticulousIp: "10.0.0.9" });
    const imgs = await readdir(join(dataDir, "images"));
    expect(imgs).toEqual(["Espresso"]);
  });

  test("rollback on an unmigrated dir is a no-op", async () => {
    const dataDir = await tempDir();
    expect(rollbackSqliteMigration(dataDir)).toBe(false);
  });

  test("migrating an empty volume still stamps and reports no artifacts", async () => {
    const dataDir = await tempDir();
    const handles = openSqliteStorage(dataDir);
    expect(migrateJsonToSqlite(dataDir, handles)).toBe(true);
    handles.close();
    expect(isMigrated(dataDir)).toBe(true);
  });
});
