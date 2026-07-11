import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockTryHandle = vi.fn();
vi.mock("@metic/core", () => ({
  tryHandle: (...args: unknown[]) => mockTryHandle(...args),
}));

const mockNative = vi.fn();
vi.mock("./browserNativeRoutes", () => ({
  handleBrowserNativeRoutes: (...args: unknown[]) => mockNative(...args),
}));

vi.mock("@/services/platform/browserPlatform", () => ({
  createBrowserPlatform: vi.fn(() => ({ mock: "platform" })),
}));

import { installCoreInterceptor } from "./coreInterceptor";
import { createBrowserPlatform } from "@/services/platform/browserPlatform";

describe("installCoreInterceptor", () => {
  let original: ReturnType<typeof vi.fn>;
  let realFetch: typeof window.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    realFetch = window.fetch;
    original = vi.fn(async () => new Response("machine", { status: 200 }));
    mockNative.mockResolvedValue(null);
    installCoreInterceptor({ originalFetch: original as unknown as typeof fetch });
  });

  afterEach(() => {
    window.fetch = realFetch;
  });

  it("builds the platform with the unpatched original fetch", () => {
    expect(createBrowserPlatform).toHaveBeenCalledWith({ fetchImpl: original });
  });

  it("returns the browser-native response when the shim owns the route", async () => {
    mockNative.mockResolvedValueOnce(new Response("native", { status: 200 }));
    const res = await window.fetch("/api/profile/x/generate-image", { method: "POST" });
    expect(await res.text()).toBe("native");
    expect(mockTryHandle).not.toHaveBeenCalled();
  });

  it("returns the core response when core owns the route", async () => {
    mockTryHandle.mockResolvedValueOnce(new Response("core", { status: 201 }));
    const res = await window.fetch("/api/settings");
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("core");
  });

  it("returns a 404 when neither the shim nor core owns the route", async () => {
    mockTryHandle.mockResolvedValueOnce(null);
    const res = await window.fetch("/api/unknown-route");
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ detail: expect.stringContaining("No route") });
  });

  it("returns a 500 when a handler throws", async () => {
    mockTryHandle.mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await window.fetch("/api/settings");
    expect(res.status).toBe(500);
    errSpy.mockRestore();
  });

  it("bypasses core for machine-native /api/v1 URLs (uses original fetch)", async () => {
    const res = await window.fetch("/api/v1/profile/list");
    expect(await res.text()).toBe("machine");
    expect(mockTryHandle).not.toHaveBeenCalled();
    expect(mockNative).not.toHaveBeenCalled();
    expect(original).toHaveBeenCalledTimes(1);
  });

  it("bypasses core for non-API URLs (uses original fetch)", async () => {
    const res = await window.fetch("https://example.com/thing");
    expect(await res.text()).toBe("machine");
    expect(mockTryHandle).not.toHaveBeenCalled();
  });

  it("preserves a POST body for the core handler", async () => {
    mockTryHandle.mockResolvedValueOnce(new Response("core", { status: 200 }));
    await window.fetch("/api/settings", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json" },
    });
    const passed = mockTryHandle.mock.calls[0][0] as Request;
    expect(passed).toBeInstanceOf(Request);
    expect(passed.method).toBe("POST");
    expect(await passed.json()).toEqual({ a: 1 });
  });
});
