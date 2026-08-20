import { describe, test, expect } from "vitest";
import { detectMachine } from "../src/logic/machineDiscovery";
import { makeMockPlatform } from "./mockPlatform";
import type { MockMachine } from "./mockPlatform";
import type { PlatformNetScan } from "../src/platform";

/** A machine seam whose /api/v1/settings answers (reachable) or errors (down). */
function machineAt(base: string, reachable: boolean): MockMachine {
  return {
    getBaseUrl: () => base,
    fetch: async (path: string) => {
      if (path === "/api/v1/settings") {
        return new Response("{}", { status: reachable ? 200 : 599 });
      }
      return new Response("{}", { status: 404 });
    },
  };
}

/** A machine seam whose fetch always rejects (nothing configured / unreachable). */
function unreachableMachine(base = "http://192.168.1.5:8080"): MockMachine {
  return {
    getBaseUrl: () => base,
    fetch: async () => {
      throw new Error("ECONNREFUSED");
    },
  };
}

/** A netScan double: `hosts` maps a full probe URL -> status; others -> null. */
function scanWith(locals: string[], hosts: Record<string, number>): PlatformNetScan {
  return {
    localIPv4s: () => locals,
    probe: async (url: string) => (url in hosts ? hosts[url] : null),
  };
}

describe("detectMachine", () => {
  test("returns the configured machine when it verifies", async () => {
    const p = makeMockPlatform({ machine: machineAt("http://192.168.50.168:8080", true) });
    const result = await detectMachine(p);
    expect(result.found).toBe(true);
    expect(result.ip).toBe("192.168.50.168");
    expect(result.method).toBe("configured");
  });

  test("scans the local /24 when nothing is configured/reachable", async () => {
    const p = makeMockPlatform({
      machine: unreachableMachine(),
      netScan: scanWith(["192.168.50.10"], {
        "http://192.168.50.168:8080/api/v1/settings": 200,
      }),
    });
    const result = await detectMachine(p);
    expect(result.found).toBe(true);
    expect(result.ip).toBe("192.168.50.168");
    expect(result.method).toBe("scan");
  });

  test("accepts a legacy 404 from the settings endpoint during scan", async () => {
    const p = makeMockPlatform({
      machine: unreachableMachine(),
      netScan: scanWith(["192.168.50.10"], {
        "http://192.168.50.42:8080/api/v1/settings": 404,
      }),
    });
    const result = await detectMachine(p);
    expect(result.found).toBe(true);
    expect(result.ip).toBe("192.168.50.42");
  });

  test("does not scan its own address (self excluded)", async () => {
    // The only 'reachable' host is the scanner's own IP — must be skipped.
    const p = makeMockPlatform({
      machine: unreachableMachine(),
      netScan: scanWith(["192.168.50.10"], {
        "http://192.168.50.10:8080/api/v1/settings": 200,
      }),
    });
    const result = await detectMachine(p);
    expect(result.found).toBe(false);
    expect(result.guidance_key).toBe("notFound");
  });

  test("ignores non-private local addresses when scanning", async () => {
    const p = makeMockPlatform({
      machine: unreachableMachine(),
      netScan: scanWith(["8.8.8.8"], {
        "http://8.8.8.168:8080/api/v1/settings": 200,
      }),
    });
    const result = await detectMachine(p);
    expect(result.found).toBe(false);
  });

  test("returns not-found guidance when no scan capability exists", async () => {
    const p = makeMockPlatform({ machine: unreachableMachine() });
    const result = await detectMachine(p);
    expect(result.found).toBe(false);
    expect(result.guidance_key).toBe("notFound");
    expect(Array.isArray(result.guidance_hints)).toBe(true);
  });
});
