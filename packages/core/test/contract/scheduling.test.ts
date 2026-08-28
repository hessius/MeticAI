import { describe, test, expect } from "vitest";
import { makeMockPlatform } from "../mockPlatform";
import { handle } from "../../src/handler";

function req(path: string, method: string): Request {
  return new Request(`http://x${path}`, { method });
}

describe("scheduling: reads load cleanly, mutations 501", () => {
  test("GET recurring-schedules returns an empty success envelope", async () => {
    const res = await handle(req("/api/machine/recurring-schedules", "GET"), makeMockPlatform());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "success", recurring_schedules: [] });
  });

  test("GET scheduled-shots returns an empty success envelope", async () => {
    const res = await handle(req("/api/machine/scheduled-shots", "GET"), makeMockPlatform());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "success", scheduled_shots: [] });
  });

  test("POST recurring-schedules is 501 (not silently accepted)", async () => {
    const res = await handle(req("/api/machine/recurring-schedules", "POST"), makeMockPlatform());
    expect(res.status).toBe(501);
    expect((await res.json()).status).toBe("error");
  });

  test("PUT recurring-schedules/{id} is 501", async () => {
    const res = await handle(req("/api/machine/recurring-schedules/abc", "PUT"), makeMockPlatform());
    expect(res.status).toBe(501);
  });

  test("DELETE recurring-schedules/{id} is 501", async () => {
    const res = await handle(req("/api/machine/recurring-schedules/abc", "DELETE"), makeMockPlatform());
    expect(res.status).toBe(501);
  });

  test("POST schedule-shot is 501 (owned by machine-commands)", async () => {
    const res = await handle(req("/api/machine/schedule-shot", "POST"), makeMockPlatform());
    expect(res.status).toBe(501);
  });

  test("DELETE schedule-shot/{id} is 501", async () => {
    const res = await handle(req("/api/machine/schedule-shot/abc", "DELETE"), makeMockPlatform());
    expect(res.status).toBe(501);
  });

  test("no scheduling path leaks the core notFound message", async () => {
    for (const [path, method] of [
      ["/api/machine/recurring-schedules", "GET"],
      ["/api/machine/recurring-schedules", "POST"],
      ["/api/machine/recurring-schedules/x", "PUT"],
      ["/api/machine/recurring-schedules/x", "DELETE"],
      ["/api/machine/scheduled-shots", "GET"],
      ["/api/machine/schedule-shot", "POST"],
      ["/api/machine/schedule-shot/x", "DELETE"],
    ] as const) {
      const body = await (await handle(req(path, method), makeMockPlatform())).text();
      expect(body).not.toContain("No route for");
    }
  });
});
