/**
 * Browser-native route shim.
 *
 * A small set of MeticAI proxy routes cannot live in `@metic/core` because they
 * depend on browser-only capabilities (a `<canvas>` for image downscaling and
 * `sessionStorage` for the pour-over "restore previous profile" nicety). The
 * shared core handler owns every other route; this shim owns just these, and
 * `coreInterceptor` runs it *before* core so the browser answers them.
 *
 * Machine I/O goes through `platform.machine.fetch` (the injected original
 * fetch joined onto the machine base URL) and image bytes are written to
 * `platform.storage.images` under the same `image-proxy:{name}` key that core's
 * image-proxy route reads, so an uploaded/generated image is served back
 * immediately at full resolution while a downscaled copy is persisted to the
 * machine profile so it survives app reinstalls.
 *
 * Ported from the retired DirectModeInterceptor image + pour-over-cleanup
 * handlers, preserving their exact request/response contracts.
 */

import type { Platform } from "@metic/core";
import { createBrowserAIService } from "@/services/ai/BrowserAIService";
import {
  DirectStorageValidationError,
  saveDirectProfileImage,
} from "./directModeStorage";
import { jsonResponse } from "./directModeHttp";

const DIRECT_PROFILE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

class DirectImageValidationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "DirectImageValidationError";
  }
}

interface ResolvedProfile {
  id: string;
  name: string;
  display?: { image?: string; [key: string]: unknown };
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blobBytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isSupportedImageBytes(bytes: Uint8Array, mimeType: string): boolean {
  const normalizedType = mimeType.toLowerCase();
  if (normalizedType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (normalizedType === "image/jpeg" || normalizedType === "image/jpg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (normalizedType === "image/gif") {
    const header = String.fromCharCode(...bytes.slice(0, 6));
    return header === "GIF87a" || header === "GIF89a";
  }
  if (normalizedType === "image/webp") {
    return (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  }
  return false;
}

function validateImageBytes(bytes: Uint8Array, mimeType: string): void {
  if (bytes.byteLength > DIRECT_PROFILE_IMAGE_MAX_BYTES) {
    throw new DirectImageValidationError("Image too large. Maximum size is 10MB", 413);
  }
  if (!mimeType.startsWith("image/")) {
    throw new DirectImageValidationError("File must be an image");
  }
  if (!isSupportedImageBytes(bytes, mimeType)) {
    throw new DirectImageValidationError("Invalid image data");
  }
}

async function blobToDataUri(blob: Blob): Promise<string> {
  if (blob.size > DIRECT_PROFILE_IMAGE_MAX_BYTES) {
    throw new DirectImageValidationError("Image too large. Maximum size is 10MB", 413);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  validateImageBytes(bytes, blob.type || "application/octet-stream");
  return `data:${blob.type || "application/octet-stream"};base64,${blobBytesToBase64(bytes)}`;
}

function estimateBase64DecodedBytes(payload: string): number {
  const normalizedPayload = payload.replace(/\s/g, "");
  const padding = normalizedPayload.endsWith("==") ? 2 : normalizedPayload.endsWith("=") ? 1 : 0;
  return Math.floor(normalizedPayload.length / 4) * 3 - padding;
}

function dataUriToBytes(dataUri: string): { mimeType: string; bytes: Uint8Array } {
  const match = dataUri.match(/^data:([^;,]+)(;base64)?,(.*)$/);
  if (!match) throw new DirectImageValidationError("Invalid image data - must be a data URI");
  const mimeType = match[1] || "application/octet-stream";
  const payload = match[3]!;
  if (!mimeType.startsWith("image/")) {
    throw new DirectImageValidationError("Invalid image data - must be a data URI");
  }
  if (match[2] && estimateBase64DecodedBytes(payload) > DIRECT_PROFILE_IMAGE_MAX_BYTES) {
    throw new DirectImageValidationError("Image too large. Maximum size is 10MB", 413);
  }
  let binary: string;
  try {
    binary = match[2] ? atob(payload) : decodeURIComponent(payload);
  } catch (err) {
    throw new DirectImageValidationError(
      `Failed to decode image data: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  validateImageBytes(bytes, mimeType);
  return { mimeType, bytes };
}

function imageErrorStatus(err: unknown, defaultStatus = 500): number {
  if (err instanceof DirectImageValidationError) return err.status;
  if (err instanceof DirectStorageValidationError) return err.message.includes("not found") ? 404 : 400;
  return defaultStatus;
}

/** Compress an image data URI to a JPEG thumbnail no larger than maxSize px. */
async function compressImageForMachine(dataUri: string, maxSize: number): Promise<string> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Image load timeout")), 3000);
    img.onload = () => {
      clearTimeout(timeout);
      resolve();
    };
    img.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Image load error"));
    };
    img.src = dataUri;
  });
  const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/jpeg", 0.7);
}

function normalizeProfileIdent(value: unknown): ResolvedProfile | null {
  if (!isRecord(value)) return null;
  const nested = isRecord(value.profile) ? value.profile : value;
  const id = nested.id;
  const name = nested.name;
  if (typeof id !== "string" || typeof name !== "string") return null;
  return { ...nested, id, name } as ResolvedProfile;
}

async function findProfileByName(platform: Platform, name: string): Promise<ResolvedProfile | null> {
  const res = await platform.machine.fetch("/api/v1/profile/list");
  if (!res.ok) return null;
  const raw: unknown = await res.json();
  const list = Array.isArray(raw) ? raw : isRecord(raw) && Array.isArray(raw.profiles) ? raw.profiles : [];
  for (const entry of list) {
    const normalized = normalizeProfileIdent(entry);
    if (normalized?.name === name) return normalized;
  }
  return null;
}

function stripMachineMetadata(profile: ResolvedProfile): Record<string, unknown> {
  const machineProfile: Record<string, unknown> = { ...profile };
  delete machineProfile.change_id;
  delete machineProfile.in_history;
  delete machineProfile.has_description;
  return machineProfile;
}

/**
 * Persist an image data URI for a profile: write full-resolution bytes to the
 * image-proxy cache (read by core's image-proxy route) plus a legacy full-res
 * IndexedDB copy, and save a downscaled thumbnail to the machine profile so it
 * survives reinstalls. Returns the resolved profile id.
 */
async function saveProfileImageData(
  platform: Platform,
  profileName: string,
  imageDataUri: string,
): Promise<{ id: string; imageSize: number }> {
  if (!imageDataUri.startsWith("data:image/")) {
    throw new DirectStorageValidationError("Invalid image data - must be a data URI");
  }
  const profile = await findProfileByName(platform, profileName);
  if (!profile) {
    throw new DirectStorageValidationError(`Profile '${profileName}' not found on machine`);
  }

  // Fetch the full profile (with stages/display) so the save keeps everything.
  let fullProfile = profile;
  try {
    const fullResp = await platform.machine.fetch(`/api/v1/profile/get/${profile.id}`);
    if (fullResp.ok) {
      const parsed = normalizeProfileIdent(await fullResp.json());
      if (parsed) fullProfile = parsed;
    }
  } catch {
    /* use the list entry */
  }

  const { bytes } = dataUriToBytes(imageDataUri);

  // Full-resolution copies: the image-proxy cache key core reads, plus the
  // legacy profile-id keyed store.
  await platform.storage.images.write(`image-proxy:${profileName}`, bytes);
  try {
    await saveDirectProfileImage(profile.id, new Blob([bytes as unknown as BlobPart]));
  } catch {
    /* legacy store is best-effort */
  }

  // Downscaled thumbnail persisted to the machine profile.
  const updated = stripMachineMetadata(fullProfile);
  try {
    const thumbnailUri = await compressImageForMachine(imageDataUri, 300);
    updated.display = {
      ...(isRecord(updated.display) ? updated.display : {}),
      image: thumbnailUri,
    };
  } catch {
    updated.display = isRecord(fullProfile.display) ? { ...fullProfile.display } : {};
  }
  try {
    const saveResponse = await platform.machine.fetch("/api/v1/profile/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
    if (!saveResponse.ok) {
      console.warn("[browser-native] Machine profile save returned", saveResponse.status);
    }
  } catch (e) {
    console.warn("[browser-native] Failed to save profile image to machine:", e);
  }

  return { id: profile.id, imageSize: imageDataUri.length };
}

const IMAGE_UPLOAD_RE = /^\/api\/profile\/([^/]+)\/image$/;
const IMAGE_GENERATE_RE = /^\/api\/profile\/([^/]+)\/generate-image$/;
const IMAGE_APPLY_RE = /^\/api\/profile\/([^/]+)\/apply-image$/;

/**
 * Dispatch the browser-only routes. Returns a Response when this shim owns the
 * request, or `null` so `coreInterceptor` can hand it to the shared core
 * handler.
 */
export async function handleBrowserNativeRoutes(
  req: Request,
  platform: Platform,
): Promise<Response | null> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  // POST /api/profile/{name}/image -> upload a direct image and persist it.
  const uploadMatch = pathname.match(IMAGE_UPLOAD_RE);
  if (uploadMatch && method === "POST") {
    try {
      const name = decodeURIComponent(uploadMatch[1]!);
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof Blob) || !file.type.startsWith("image/")) {
        return jsonResponse({ detail: "File must be an image" }, 400);
      }
      const imageDataUri = await blobToDataUri(file);
      const { id, imageSize } = await saveProfileImageData(platform, name, imageDataUri);
      return jsonResponse({
        status: "success",
        message: `Image uploaded for profile '${name}'`,
        profile_id: id,
        image_size: imageSize,
      });
    } catch (err) {
      return jsonResponse(
        { detail: err instanceof Error ? err.message : "Failed to upload profile image" },
        imageErrorStatus(err),
      );
    }
  }

  // POST /api/profile/{name}/generate-image -> AI image generation.
  const generateMatch = pathname.match(IMAGE_GENERATE_RE);
  if (generateMatch && method === "POST") {
    try {
      const name = decodeURIComponent(generateMatch[1]!);
      const style = url.searchParams.get("style") || "abstract";
      const tags = (url.searchParams.get("tags") || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean);
      const preview = url.searchParams.get("preview") === "true";
      const count = Math.min(4, Math.max(1, parseInt(url.searchParams.get("count") || "1", 10) || 1));
      const aiService = createBrowserAIService();
      if (!aiService.isConfigured()) {
        return jsonResponse(
          { detail: "AI features are unavailable. Please configure a Gemini API key in Settings." },
          503,
        );
      }

      if (count > 1) {
        const promises = Array.from({ length: count }, (_, i) =>
          aiService
            .generateImage({ profileName: name, style, tags, preview: true })
            .then(async (blob) => {
              const dataUri = await blobToDataUri(blob);
              return { index: i, image: dataUri } as { index: number; image: string | null; error?: string };
            })
            .catch((err) => ({
              index: i,
              image: null as string | null,
              error: err instanceof Error ? err.message : "Generation failed",
            })),
        );
        const results = await Promise.all(promises);
        return jsonResponse({
          status: "preview",
          message: `Generated images for profile '${name}'`,
          style,
          images: results,
          count,
        });
      }

      const imageBlob = await aiService.generateImage({ profileName: name, style, tags, preview });
      const imageDataUri = await blobToDataUri(imageBlob);
      if (preview) {
        return jsonResponse({
          status: "preview",
          message: `Preview image generated for profile '${name}'`,
          style,
          image_data: imageDataUri,
        });
      }
      const { id } = await saveProfileImageData(platform, name, imageDataUri);
      return jsonResponse({
        status: "success",
        message: `Image generated for profile '${name}'`,
        profile_id: id,
        style,
      });
    } catch (err) {
      return jsonResponse(
        { detail: err instanceof Error ? err.message : "Failed to generate profile image" },
        imageErrorStatus(err),
      );
    }
  }

  // POST /api/profile/{name}/apply-image -> persist a generated preview image.
  const applyMatch = pathname.match(IMAGE_APPLY_RE);
  if (applyMatch && method === "POST") {
    try {
      const name = decodeURIComponent(applyMatch[1]!);
      const body = (await req.json()) as { image_data?: string };
      if (!body.image_data) {
        return jsonResponse({ detail: "Invalid image data - must be a data URI" }, 400);
      }
      const { id } = await saveProfileImageData(platform, name, body.image_data);
      return jsonResponse({
        status: "success",
        message: `Image applied to profile '${name}'`,
        profile_id: id,
      });
    } catch (err) {
      return jsonResponse(
        { detail: err instanceof Error ? err.message : "Failed to apply profile image" },
        imageErrorStatus(err),
      );
    }
  }

  // POST /api/pour-over/cleanup, force-cleanup -> restore the previously-active
  // profile (tracked in sessionStorage by PourOverView), then return ok. Core
  // also owns these as a no-op; this shim runs first to add the browser restore.
  if (
    (pathname === "/api/pour-over/cleanup" || pathname === "/api/pour-over/force-cleanup") &&
    method === "POST"
  ) {
    try {
      const previousProfileName = sessionStorage.getItem("meticai-previous-profile");
      sessionStorage.removeItem("meticai-previous-profile");
      if (previousProfileName) {
        const match = await findProfileByName(platform, previousProfileName);
        if (match) await platform.machine.fetch(`/api/v1/profile/load/${match.id}`);
      }
    } catch (e) {
      console.warn("[browser-native] Failed to restore previous profile after pour-over cleanup:", e);
    }
    return jsonResponse({ status: "ok" });
  }

  return null;
}
