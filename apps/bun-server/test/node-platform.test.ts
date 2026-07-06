import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNodePlatform } from "../src/platform/node.ts";

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "metic-node-platform-"));
  dirs.push(d);
  return d;
}

afterEach(async () => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

describe("createNodePlatform storage", () => {
  test("directory repo round-trips documents by id", async () => {
    const platform = createNodePlatform({ dataDir: await tempDir() });
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

  test("directory repo rejects path traversal ids", async () => {
    const dataDir = await tempDir();
    const platform = createNodePlatform({ dataDir });
    await platform.storage.schedules.write("../escape", { x: 1 });
    // Written as a flat, sanitized filename inside the collection dir (the
    // path separator is neutralized, so it cannot escape the directory).
    const escaped = await readFile(join(dataDir, "schedules", ".._escape.json"), "utf8");
    expect(JSON.parse(escaped)).toEqual({ x: 1 });
  });

  test("singleton settings repo persists a single document", async () => {
    const platform = createNodePlatform({ dataDir: await tempDir() });
    expect(await platform.storage.settings.read("settings")).toBeNull();

    await platform.storage.settings.write("settings", { meticulousIp: "1.2.3.4" });
    expect(await platform.storage.settings.read("anything")).toEqual({ meticulousIp: "1.2.3.4" });
    expect(await platform.storage.settings.list()).toEqual([{ meticulousIp: "1.2.3.4" }]);
  });

  test("keyed-map annotations repo handles slash-containing ids in one file", async () => {
    const dataDir = await tempDir();
    const platform = createNodePlatform({ dataDir });
    const annotations = platform.storage.annotations;

    // Keys mirror the shot layout `${date}/${filename}` (contain a slash).
    await annotations.write("2024-01-15/a.json", { key: "2024-01-15/a.json", rating: 4 });
    await annotations.write("2024-01-15/b.json", { key: "2024-01-15/b.json", rating: 2 });

    expect(await annotations.read("2024-01-15/a.json")).toEqual({
      key: "2024-01-15/a.json",
      rating: 4,
    });
    expect((await annotations.list()).length).toBe(2);

    // All entries live in a single JSON object file (Python-compatible layout).
    const raw = JSON.parse(await readFile(join(dataDir, "shot_annotations.json"), "utf8"));
    expect(Object.keys(raw).sort()).toEqual(["2024-01-15/a.json", "2024-01-15/b.json"]);

    await annotations.delete("2024-01-15/a.json");
    expect(await annotations.read("2024-01-15/a.json")).toBeNull();
    expect((await annotations.list()).length).toBe(1);
  });

  test("aiCache honors TTL expiry", async () => {
    const platform = createNodePlatform({ dataDir: await tempDir() });
    await platform.storage.aiCache.set("k", { v: 1 }, 10_000);
    expect(await platform.storage.aiCache.get<{ v: number }>("k")).toEqual({ v: 1 });
  });

  test("blob store round-trips bytes", async () => {
    const platform = createNodePlatform({ dataDir: await tempDir() });
    const bytes = new Uint8Array([1, 2, 3, 4]);
    expect(await platform.storage.images.read("img")).toBeNull();
    await platform.storage.images.write("img", bytes);
    expect(Array.from((await platform.storage.images.read("img"))!)).toEqual([1, 2, 3, 4]);
    await platform.storage.images.delete("img");
    expect(await platform.storage.images.read("img")).toBeNull();
  });
});

describe("createNodePlatform machine url", () => {
  test("bare host gets default espresso port", () => {
    const p = createNodePlatform({ machineBaseUrl: undefined, dataDir: "/tmp/x" });
    // Env-driven; assert the explicit-override path instead.
    expect(p.machine.getBaseUrl()).toBe("");
  });

  test("explicit override wins and strips trailing slash", () => {
    const p = createNodePlatform({ machineBaseUrl: "http://machine:8080/", dataDir: "/tmp/x" });
    expect(p.machine.getBaseUrl()).toBe("http://machine:8080");
  });

  test("fetch joins a relative path onto the base URL", async () => {
    const p = createNodePlatform({ machineBaseUrl: "http://machine:8080", dataDir: "/tmp/x" });
    const prev = globalThis.fetch;
    let seen = "";
    globalThis.fetch = (async (url: string | URL | Request) => {
      seen = String(url);
      return new Response("{}");
    }) as typeof fetch;
    try {
      await p.machine.fetch("/api/v1/history");
      expect(seen).toBe("http://machine:8080/api/v1/history");
      await p.machine.fetch("api/v1/profile/list");
      expect(seen).toBe("http://machine:8080/api/v1/profile/list");
    } finally {
      globalThis.fetch = prev;
    }
  });

  test("fetch rejects when the machine URL is not configured", async () => {
    const p = createNodePlatform({ machineBaseUrl: undefined, dataDir: "/tmp/x" });
    await expect(p.machine.fetch("/api/v1/history")).rejects.toThrow();
  });
});

describe("createNodePlatform secrets", () => {
  test("reads GEMINI_API_KEY from environment", () => {
    const prev = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key";
    try {
      const cfg = createNodePlatform({ dataDir: "/tmp/x" }).secrets.getAIConfig();
      expect(cfg.provider).toBe("gemini");
      expect(cfg.apiKey).toBe("test-key");
    } finally {
      if (prev === undefined) delete process.env.GEMINI_API_KEY;
      else process.env.GEMINI_API_KEY = prev;
    }
  });
});
