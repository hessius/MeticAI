import { describe, test, expect } from "bun:test";
import { TelemetryHub, extractFinalWeight, type TelemetryClient } from "../src/telemetryHub.ts";

const silentLogger = { info() {}, error() {}, debug() {} };

function collector(): TelemetryClient & { frames: unknown[] } {
  const frames: unknown[] = [];
  return { frames, send: (d: string) => frames.push(JSON.parse(d)) };
}

describe("TelemetryHub", () => {
  test("sends the current snapshot immediately on subscribe", () => {
    // Empty baseUrl -> no upstream socket is created (offline-safe).
    const hub = new TelemetryHub("", silentLogger);
    const client = collector();
    hub.addClient(client);

    expect(hub.clientCount).toBe(1);
    expect(client.frames).toHaveLength(1);
    const frame = client.frames[0] as Record<string, unknown>;
    expect(frame.connected).toBe(false);
    expect(frame.availability).toBeNull();
    expect(typeof frame._ts).toBe("number");

    hub.removeClient(client);
    expect(hub.clientCount).toBe(0);
    hub.close();
  });

  test("close() clears all clients", () => {
    const hub = new TelemetryHub("", silentLogger);
    hub.addClient(collector());
    hub.addClient(collector());
    expect(hub.clientCount).toBe(2);
    hub.close();
    expect(hub.clientCount).toBe(0);
  });

  describe("extractFinalWeight", () => {
    test("reads the effective loaded profile's final_weight", () => {
      // Shape of GET /api/v1/profile/last — reflects temporary on-machine edits.
      expect(extractFinalWeight({ load_time: 1, profile: { final_weight: 42 } })).toBe(42);
    });

    test("returns null when profile or weight is missing or non-numeric", () => {
      expect(extractFinalWeight(null)).toBeNull();
      expect(extractFinalWeight({})).toBeNull();
      expect(extractFinalWeight({ profile: {} })).toBeNull();
      expect(extractFinalWeight({ profile: { final_weight: "42" } })).toBeNull();
      expect(extractFinalWeight({ profile: { final_weight: Number.NaN } })).toBeNull();
    });
  });
});
