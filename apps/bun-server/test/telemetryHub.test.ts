import { describe, test, expect } from "bun:test";
import { TelemetryHub, type TelemetryClient } from "../src/telemetryHub.ts";

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
});
