import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Platform } from "@metic/core";

const mockGenerateImage = vi.fn();
const mockIsConfigured = vi.fn(() => true);
vi.mock("@/services/ai/BrowserAIService", () => ({
  createBrowserAIService: () => ({
    isConfigured: mockIsConfigured,
    generateImage: mockGenerateImage,
  }),
}));

const mockSaveDirectProfileImage = vi.fn<(...args: unknown[]) => Promise<void>>(
  () => Promise.resolve(),
);
vi.mock("./directModeStorage", async () => {
  const actual = await vi.importActual<typeof import("./directModeStorage")>("./directModeStorage");
  return {
    ...actual,
    saveDirectProfileImage: (...args: unknown[]) => mockSaveDirectProfileImage(...args),
  };
});

import { handleBrowserNativeRoutes } from "./browserNativeRoutes";

// 8-byte PNG signature as a data URI (passes isSupportedImageBytes for image/png).
const PNG_DATA_URI = "data:image/png;base64,iVBORw0KGgo=";

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  width = 100;
  height = 100;
  set src(_v: string) {
    setTimeout(() => this.onload?.(), 0);
  }
}

interface MockMachine {
  fetch: ReturnType<typeof vi.fn>;
}

function makePlatform(machineFetch: ReturnType<typeof vi.fn>): { platform: Platform; imagesWrite: ReturnType<typeof vi.fn> } {
  const imagesWrite = vi.fn(async () => {});
  const platform = {
    machine: { fetch: machineFetch } as MockMachine,
    storage: { images: { write: imagesWrite } },
  } as unknown as Platform;
  return { platform, imagesWrite };
}

describe("handleBrowserNativeRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsConfigured.mockReturnValue(true);
    // @ts-expect-error install a deterministic Image for compressImageForMachine
    globalThis.Image = FakeImage;
    sessionStorage.clear();
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it("returns null for a route it does not own", async () => {
    const { platform } = makePlatform(vi.fn());
    const res = await handleBrowserNativeRoutes(
      new Request("http://localhost/api/settings"),
      platform,
    );
    expect(res).toBeNull();
  });

  it("applies an image to an existing profile", async () => {
    const machineFetch = vi.fn(async (path: string) => {
      if (path === "/api/v1/profile/list") {
        return new Response(JSON.stringify([{ id: "p1", name: "Test" }]), { status: 200 });
      }
      if (path === "/api/v1/profile/get/p1") {
        return new Response(JSON.stringify({ id: "p1", name: "Test", display: {} }), { status: 200 });
      }
      if (path === "/api/v1/profile/save") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    });
    const { platform, imagesWrite } = makePlatform(machineFetch);

    const res = await handleBrowserNativeRoutes(
      new Request("http://localhost/api/profile/Test/apply-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_data: PNG_DATA_URI }),
      }),
      platform,
    );

    expect(res).not.toBeNull();
    expect(res!.status).toBe(200);
    const body = await res!.json();
    expect(body).toMatchObject({ status: "success", profile_id: "p1" });
    // Full-res bytes written to the image-proxy cache key core reads.
    expect(imagesWrite).toHaveBeenCalledWith("image-proxy:Test", expect.any(Uint8Array));
  });

  it("returns 404 when applying an image to a missing profile", async () => {
    const machineFetch = vi.fn(async (path: string) => {
      if (path === "/api/v1/profile/list") {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    });
    const { platform } = makePlatform(machineFetch);

    const res = await handleBrowserNativeRoutes(
      new Request("http://localhost/api/profile/Ghost/apply-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ image_data: PNG_DATA_URI }),
      }),
      platform,
    );

    expect(res!.status).toBe(404);
  });

  it("rejects apply-image with no image data", async () => {
    const { platform } = makePlatform(vi.fn());
    const res = await handleBrowserNativeRoutes(
      new Request("http://localhost/api/profile/Test/apply-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
      platform,
    );
    expect(res!.status).toBe(400);
  });

  it("returns 503 for generate-image when AI is not configured", async () => {
    mockIsConfigured.mockReturnValue(false);
    const { platform } = makePlatform(vi.fn());
    const res = await handleBrowserNativeRoutes(
      new Request("http://localhost/api/profile/Test/generate-image", { method: "POST" }),
      platform,
    );
    expect(res!.status).toBe(503);
  });

  it("restores the previous profile on pour-over cleanup then returns ok", async () => {
    sessionStorage.setItem("meticai-previous-profile", "Prev");
    const machineFetch = vi.fn(async (path: string) => {
      if (path === "/api/v1/profile/list") {
        return new Response(JSON.stringify([{ id: "prev1", name: "Prev" }]), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    const { platform } = makePlatform(machineFetch);

    const res = await handleBrowserNativeRoutes(
      new Request("http://localhost/api/pour-over/cleanup", { method: "POST" }),
      platform,
    );

    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ status: "ok" });
    expect(machineFetch).toHaveBeenCalledWith("/api/v1/profile/load/prev1");
    expect(sessionStorage.getItem("meticai-previous-profile")).toBeNull();
  });

  it("returns ok on pour-over cleanup with no previous profile", async () => {
    const machineFetch = vi.fn();
    const { platform } = makePlatform(machineFetch);
    const res = await handleBrowserNativeRoutes(
      new Request("http://localhost/api/pour-over/force-cleanup", { method: "POST" }),
      platform,
    );
    expect(res!.status).toBe(200);
    expect(machineFetch).not.toHaveBeenCalled();
  });
});
