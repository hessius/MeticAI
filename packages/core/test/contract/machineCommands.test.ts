import { describe, test, expect } from "vitest";
import { makeMockPlatform, scriptedMachine } from "../mockPlatform";
import { handle } from "../../src/handler";

function post(path: string, body?: unknown): Request {
  return new Request(`http://x${path}`, {
    method: "POST",
    ...(body !== undefined
      ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
      : {}),
  });
}

function get(path: string): Request {
  return new Request(`http://x${path}`, { method: "GET" });
}

describe("machine-commands: actuation", () => {
  test("start succeeds when the machine action is OK", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({ "/api/v1/action/start": {} }) });
    const res = await handle(post("/api/machine/command/start"), p);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  test("stop returns 502 when the machine is unreachable", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const res = await handle(post("/api/machine/command/stop"), p);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ success: false });
  });

  test("preheat returns a success envelope", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({ "/api/v1/action/preheat": {} }) });
    const res = await handle(post("/api/machine/preheat"), p);
    expect(await res.json()).toEqual({ status: "success", message: "Preheat started" });
  });
});

describe("machine-commands: load-profile", () => {
  test("resolves the profile name to an id and loads it", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({
        "/api/v1/profile/list": [{ id: "abc", name: "Turbo Bloom" }],
        "/api/v1/profile/load/abc": {},
      }),
    });
    const res = await handle(post("/api/machine/command/load-profile", { name: "Turbo Bloom" }), p);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });

  test("400 when no name is given", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const res = await handle(post("/api/machine/command/load-profile", {}), p);
    expect(res.status).toBe(400);
  });

  test("404 when the profile name is unknown", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({ "/api/v1/profile/list": [{ id: "abc", name: "Other" }] }),
    });
    const res = await handle(post("/api/machine/command/load-profile", { name: "Missing" }), p);
    expect(res.status).toBe(404);
  });
});

describe("machine-commands: status + info", () => {
  test("detect is not applicable (501)", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const res = await handle(get("/api/machine/detect"), p);
    expect(res.status).toBe(501);
  });

  test("schedule-shot is unsupported (501)", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const res = await handle(post("/api/machine/schedule-shot"), p);
    expect(res.status).toBe(501);
  });

  test("status returns a synthetic idle envelope", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const res = await handle(get("/api/machine/status"), p);
    expect(await res.json()).toEqual({ machine_status: { state: "idle" }, scheduled_shots: [] });
  });

  test("system-info aggregates the three machine endpoints", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({
        "/api/v1/system/firmware": { version: "1.2.3" },
        "/api/v1/wifi/status": { connected: true },
        // hostname endpoint intentionally omitted -> null
      }),
    });
    const body = await (await handle(get("/api/machine/system-info"), p)).json();
    expect(body.firmware).toEqual({ version: "1.2.3" });
    expect(body.network).toEqual({ connected: true });
    expect(body.hostname).toBeNull();
  });

  test("status/health transforms the watcher payload", async () => {
    const p = makeMockPlatform({
      machine: scriptedMachine({
        "/status": {
          services: { web: { status: "running", uptime: "0 hours 41 minutes" } },
          memoryUsage: { total: "2 GB", used: "1 GB" },
          discs: [{ mountpoint: "/", usage: { total: "20 GB", used: "5 GB" } }],
          uptime: "1 days 2 hours",
        },
      }),
    });
    const body = await (await handle(get("/api/machine/status/health"), p)).json();
    expect(body.services).toEqual([{ name: "web", status: "running", uptime: 41 * 60 }]);
    expect(body.system.memory_total).toBe(2048);
    expect(body.system.disk_total).toBe(20);
    expect(body.system.uptime).toBe(86400 + 2 * 3600);
  });

  test("status/health degrades gracefully when the watcher is down", async () => {
    const p = makeMockPlatform({ machine: scriptedMachine({}) });
    const body = await (await handle(get("/api/machine/status/health"), p)).json();
    expect(body).toEqual({ error: "Watcher service unavailable", services: [], system: null });
  });
});
