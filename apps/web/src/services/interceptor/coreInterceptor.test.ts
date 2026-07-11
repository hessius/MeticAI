import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockTryHandle = vi.fn();
vi.mock("@metic/core", () => ({
  tryHandle: (...args: unknown[]) => mockTryHandle(...args),
}));

vi.mock("@/services/platform/browserPlatform", () => ({
  createBrowserPlatform: vi.fn(() => ({ mock: "platform" })),
}));

import { installCoreInterceptor } from "./coreInterceptor";
import { createBrowserPlatform } from "@/services/platform/browserPlatform";

describe("installCoreInterceptor", () => {
  let fallback: ReturnType<typeof vi.fn>;
  let original: ReturnType<typeof vi.fn>;
  let realFetch: typeof window.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    realFetch = window.fetch;
    fallback = vi.fn(async () => new Response("fallback", { status: 200 }));
    original = vi.fn(async () => new Response("machine", { status: 200 }));
    installCoreInterceptor({
      originalFetch: original as unknown as typeof fetch,
      fallbackFetch: fallback as unknown as typeof fetch,
    });
  });

  afterEach(() => {
    window.fetch = realFetch;
  });

  it("builds the platform with the unpatched original fetch", () => {
    expect(createBrowserPlatform).toHaveBeenCalledWith({ fetchImpl: original });
  });

  it("returns the core response when core owns the route", async () => {
    mockTryHandle.mockResolvedValueOnce(new Response("core", { status: 201 }));
    const res = await window.fetch("/api/settings");
    expect(res.status).toBe(201);
    expect(await res.text()).toBe("core");
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back to the legacy interceptor when core does not own the route", async () => {
    mockTryHandle.mockResolvedValueOnce(null);
    const res = await window.fetch("/api/unknown-legacy-route");
    expect(await res.text()).toBe("fallback");
    expect(mockTryHandle).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("falls back when the core handler throws", async () => {
    mockTryHandle.mockRejectedValueOnce(new Error("boom"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await window.fetch("/api/settings");
    expect(await res.text()).toBe("fallback");
    expect(fallback).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it("bypasses core for machine-native /api/v1 URLs", async () => {
    const res = await window.fetch("/api/v1/profile/list");
    expect(await res.text()).toBe("fallback");
    expect(mockTryHandle).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("bypasses core for non-API URLs", async () => {
    const res = await window.fetch("https://example.com/thing");
    expect(await res.text()).toBe("fallback");
    expect(mockTryHandle).not.toHaveBeenCalled();
  });

  it("preserves a POST body for the fallback after core declines", async () => {
    mockTryHandle.mockResolvedValueOnce(null);
    await window.fetch("/api/settings", {
      method: "POST",
      body: JSON.stringify({ a: 1 }),
      headers: { "content-type": "application/json" },
    });
    const passed = fallback.mock.calls[0][0] as Request;
    expect(passed).toBeInstanceOf(Request);
    expect(passed.method).toBe("POST");
    expect(await passed.json()).toEqual({ a: 1 });
  });
});
