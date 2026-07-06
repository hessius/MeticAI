import { describe, test, expect } from "bun:test";
import { isMachinePath, proxyToMachine } from "../src/machineProxy.ts";
import type { Platform } from "@metic/core/platform";

function fakePlatform(baseUrl: string): Platform {
  return {
    storage: {} as Platform["storage"],
    secrets: { getAIConfig: () => ({ provider: "gemini", apiKey: "" }) },
    machine: { getBaseUrl: () => baseUrl },
    clock: () => 0,
    logger: { info() {}, error() {}, debug() {} },
  };
}

describe("isMachinePath", () => {
  test("matches /api/v1 and subpaths only", () => {
    expect(isMachinePath("/api/v1")).toBe(true);
    expect(isMachinePath("/api/v1/machine")).toBe(true);
    expect(isMachinePath("/api/v1/action/start")).toBe(true);
    expect(isMachinePath("/api/health")).toBe(false);
    expect(isMachinePath("/api/v2/thing")).toBe(false);
    expect(isMachinePath("/")).toBe(false);
  });
});

describe("proxyToMachine", () => {
  test("returns 503 when machine address is unconfigured", async () => {
    const res = await proxyToMachine(
      new Request("http://localhost/api/v1/machine"),
      fakePlatform(""),
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Machine address not configured" });
  });

  test("forwards method, path, query and body upstream and mirrors the response", async () => {
    const captured: { url?: string; method?: string; body?: string } = {};
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: Request | string | URL, init?: RequestInit) => {
      captured.url = String(input);
      captured.method = init?.method;
      captured.body = init?.body ? String(init.body) : undefined;
      return new Response(JSON.stringify({ ok: true }), {
        status: 201,
        headers: { "content-type": "application/json", "x-custom": "1" },
      });
    }) as unknown as typeof fetch;

    try {
      const res = await proxyToMachine(
        new Request("http://localhost/api/v1/action/start?force=1", { method: "POST" }),
        fakePlatform("http://machine:8080"),
      );
      expect(captured.url).toBe("http://machine:8080/api/v1/action/start?force=1");
      expect(captured.method).toBe("POST");
      expect(res.status).toBe(201);
      expect(res.headers.get("x-custom")).toBe("1");
      expect(await res.json()).toEqual({ ok: true });
    } finally {
      globalThis.fetch = original;
    }
  });

  test("returns 502 when the machine is unreachable", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    try {
      const res = await proxyToMachine(
        new Request("http://localhost/api/v1/machine"),
        fakePlatform("http://machine:8080"),
      );
      expect(res.status).toBe(502);
    } finally {
      globalThis.fetch = original;
    }
  });
});
