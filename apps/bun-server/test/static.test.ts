import { describe, test, expect, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStaticServer } from "../src/static.ts";

const dirs: string[] = [];
async function fixture(): Promise<string> {
  const d = await mkdtemp(join(tmpdir(), "metic-static-"));
  dirs.push(d);
  await writeFile(join(d, "index.html"), "<!doctype html><title>app</title>");
  await mkdir(join(d, "assets"), { recursive: true });
  await writeFile(join(d, "assets", "app-abc123.js"), "console.log(1)");
  return d;
}

afterEach(async () => {
  while (dirs.length) {
    const d = dirs.pop();
    if (d) await rm(d, { recursive: true, force: true });
  }
});

describe("createStaticServer", () => {
  test("serves index.html at root with no-cache", async () => {
    const serve = createStaticServer(await fixture());
    const res = await serve("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(await res.text()).toContain("<title>app</title>");
  });

  test("serves fingerprinted assets immutably", async () => {
    const serve = createStaticServer(await fixture());
    const res = await serve("/assets/app-abc123.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  test("falls back to index.html for unknown extensionless routes (SPA)", async () => {
    const serve = createStaticServer(await fixture());
    const res = await serve("/settings/advanced");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  test("returns 404 for a missing asset with an extension", async () => {
    const serve = createStaticServer(await fixture());
    const res = await serve("/assets/missing.js");
    expect(res.status).toBe(404);
  });

  test("rejects path traversal", async () => {
    const serve = createStaticServer(await fixture());
    const res = await serve("/../../etc/passwd");
    // Either normalized away (SPA/404) or explicitly forbidden; never 200 with secrets.
    expect([403, 404, 200]).toContain(res.status);
    if (res.status === 200) {
      expect(res.headers.get("content-type")).toContain("text/html");
    }
  });
});
