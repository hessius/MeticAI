import { describe, test, expect, afterEach } from "bun:test";
import { createServer } from "../src/server.ts";
import type { Platform } from "@metic/core/platform";
import type { Server } from "bun";

function fakePlatform(): Platform {
  return {
    storage: {} as Platform["storage"],
    secrets: { getAIConfig: () => ({ provider: "gemini", apiKey: "" }) },
    machine: { getBaseUrl: () => "", fetch: async () => new Response(null) },
    ai: { isConfigured: () => false, generateText: async () => ({ text: "" }) },
    clock: () => 0,
    logger: { info() {}, error() {}, debug() {} },
  };
}

let server: Server<unknown> | undefined;

afterEach(() => {
  server?.stop(true);
  server = undefined;
});

describe("config.json override", () => {
  test("serves an empty serverUrl so the app talks to the Bun origin", async () => {
    server = createServer({
      port: 0,
      platform: fakePlatform(),
      staticDir: "/nonexistent-static-dir",
    }) as unknown as Server<unknown>;
    const res = await fetch(`http://localhost:${server.port}/config.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ serverUrl: "" });
  });
});
