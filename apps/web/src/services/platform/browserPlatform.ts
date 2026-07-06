/**
 * Browser/Capacitor implementation of the core `Platform` interface.
 *
 * This is the direct-mode counterpart to the Bun server's Node platform
 * (`apps/bun-server/src/platform/node.ts`): it lets the SAME `@metic/core`
 * `handle(request, platform)` run entirely client-side, replacing the bespoke
 * per-route logic in `DirectModeInterceptor`.
 *
 * Storage is IndexedDB-backed. To match the Node platform's verbatim JSON
 * semantics EXACTLY (its repos read/write documents unchanged), the keyed-map
 * and singleton repos here persist plain document objects under the generic
 * settings key-value store rather than routing through the shape-coercing typed
 * helpers in `AppDatabase`/`directModeStorage`. This keeps the browser platform
 * a faithful mirror of `fsKeyedMapRepo`/`fsSingletonRepo`, so the shared
 * contract tests hold on both hosts.
 */

import { getProviderForMethod, isAIConfigured } from "@/services/ai/providers";
import type { AIProvider } from "@/services/ai/providers/AIProvider";
import { getDefaultMachineUrl } from "@/lib/machineMode";
import {
  deleteProfileImage,
  deleteSetting,
  getProfileImage,
  getSetting,
  setProfileImage,
  setSetting,
} from "@/services/storage/AppDatabase";
import type {
  AIConfig,
  BlobStore,
  Cache,
  Logger,
  Platform,
  PlatformAI,
  Repo,
} from "@metic/core/platform";

/** Namespace prefix for core-owned documents in the IndexedDB settings store. */
const CORE_KEY_PREFIX = "core:";

/**
 * A single-document repository backed by one settings key. Mirrors the Node
 * `fsSingletonRepo`: `read`/`list` ignore the id and return the whole document.
 */
function idbSingletonRepo<T>(key: string): Repo<T> {
  const storeKey = `${CORE_KEY_PREFIX}${key}`;
  const load = async (): Promise<T | null> => {
    const v = await getSetting<T>(storeKey);
    return v === undefined ? null : v;
  };
  return {
    read: load,
    async list() {
      const v = await load();
      return v == null ? [] : [v];
    },
    async write(_id, value) {
      await setSetting(storeKey, value);
    },
    async delete() {
      await deleteSetting(storeKey);
    },
  };
}

/**
 * A repository backed by a single settings key holding an `id -> document` map.
 * Mirrors the Node `fsKeyedMapRepo`: ids may contain any character (including
 * `/`), which suits keys like `${date}/${filename}`.
 */
function idbMapRepo<T>(key: string): Repo<T> {
  const storeKey = `${CORE_KEY_PREFIX}${key}`;
  const loadMap = async (): Promise<Record<string, T>> => {
    const parsed = await getSetting<Record<string, T>>(storeKey);
    return parsed && typeof parsed === "object" ? parsed : {};
  };
  const saveMap = async (map: Record<string, T>): Promise<void> => {
    await setSetting(storeKey, map);
  };
  return {
    async read(id) {
      const map = await loadMap();
      return Object.prototype.hasOwnProperty.call(map, id) ? map[id]! : null;
    },
    async list() {
      return Object.values(await loadMap());
    },
    async write(id, value) {
      const map = await loadMap();
      map[id] = value;
      await saveMap(map);
    },
    async delete(id) {
      const map = await loadMap();
      if (Object.prototype.hasOwnProperty.call(map, id)) {
        delete map[id];
        await saveMap(map);
      }
    },
  };
}

interface CacheEntry {
  value: unknown;
  expiresAt: number | null;
}

/**
 * In-memory TTL cache, matching the Node platform's `memoryCache`. AI responses
 * are transient, so a per-session cache is sufficient in direct mode.
 */
function memoryCache(clock: () => number): Cache {
  const store = new Map<string, CacheEntry>();
  return {
    async get<T>(key: string) {
      const entry = store.get(key);
      if (!entry) return null;
      if (entry.expiresAt != null && entry.expiresAt <= clock()) {
        store.delete(key);
        return null;
      }
      return entry.value as T;
    },
    async set<T>(key: string, value: T, ttlMs?: number) {
      store.set(key, {
        value,
        expiresAt: ttlMs != null ? clock() + ttlMs : null,
      });
    },
  };
}

/**
 * Blob storage over the dedicated IndexedDB profile-image store. Core works in
 * `Uint8Array`; `AppDatabase` works in `Blob`, so we convert at the seam.
 */
function idbBlobStore(): BlobStore {
  return {
    async read(key) {
      const blob = await getProfileImage(key);
      if (!blob) return null;
      return new Uint8Array(await blob.arrayBuffer());
    },
    async write(key, bytes) {
      await setProfileImage(key, new Blob([bytes as unknown as BlobPart]));
    },
    async delete(key) {
      await deleteProfileImage(key);
    },
  };
}

function consoleLogger(): Logger {
  const tag = (level: string, message: string) => `[direct-mode:${level}] ${message}`;
  return {
    info: (m, e) => console.info(tag("info", m), e ?? ""),
    error: (m, e) => console.error(tag("error", m), e ?? ""),
    debug: (m, e) => console.debug(tag("debug", m), e ?? ""),
  };
}

/**
 * PlatformAI delegating to the frontend's active AI provider. The provider's
 * `generateText({ contents, config })` signature is identical to `PlatformAI`,
 * so this is a straight passthrough; image output is converted Blob -> bytes.
 */
function providerAI(getProvider: () => AIProvider, configured: () => boolean): PlatformAI {
  return {
    isConfigured() {
      return configured();
    },
    async generateText(req) {
      return getProvider().generateText(req);
    },
    async generateImage(prompt: string) {
      const provider = getProvider();
      if (!provider.generateImage) {
        throw new Error("Active AI provider does not support image generation");
      }
      const blob = await provider.generateImage(prompt);
      return new Uint8Array(await blob.arrayBuffer());
    },
  };
}

export interface BrowserPlatformDeps {
  /**
   * Fetch implementation used to reach the machine. MUST be the original
   * (unpatched) `window.fetch`; the direct-mode interceptor patches `fetch`, so
   * capture the original before installing it to avoid re-entrancy.
   */
  fetchImpl?: typeof fetch;
  /** Machine base URL resolver. Defaults to `getDefaultMachineUrl`. */
  machineBaseUrl?: () => string;
  clock?: () => number;
  /** Active AI provider resolver. Defaults to the configured provider. */
  aiProvider?: () => AIProvider;
  /** Whether AI is configured. Defaults to `isAIConfigured`. */
  aiConfigured?: () => boolean;
}

/**
 * Build a browser `Platform`. No `scheduler` is provided: direct mode cannot
 * run deferred machine actuation, so schedule routes return 501 (matching the
 * legacy interceptor's "scheduling not supported" behavior).
 */
export function createBrowserPlatform(deps: BrowserPlatformDeps = {}): Platform {
  const clock = deps.clock ?? (() => Date.now());
  const machineBaseUrl = deps.machineBaseUrl ?? getDefaultMachineUrl;
  const fetchImpl =
    deps.fetchImpl ??
    (typeof window !== "undefined" ? window.fetch.bind(window) : fetch);
  const getProvider = deps.aiProvider ?? (() => getProviderForMethod(undefined));
  const configured = deps.aiConfigured ?? isAIConfigured;

  const getAIConfig = (): AIConfig => {
    const provider = getProvider();
    return { provider: provider.id, apiKey: "" };
  };

  return {
    storage: {
      settings: idbSingletonRepo<Record<string, unknown>>("settings"),
      history: idbSingletonRepo("profile_history"),
      annotations: idbMapRepo("annotations"),
      dialInSessions: idbMapRepo("dialin_sessions"),
      pourOverPrefs: idbSingletonRepo("pour_over_preferences"),
      schedules: idbMapRepo("schedules"),
      descriptions: idbMapRepo("profile_descriptions"),
      aiTags: idbMapRepo("profile_ai_tags"),
      aiCache: memoryCache(clock),
      images: idbBlobStore(),
    },
    secrets: {
      getAIConfig,
    },
    machine: {
      getBaseUrl: () => machineBaseUrl().replace(/\/+$/, ""),
      fetch: (path: string, init?: RequestInit) => {
        const base = machineBaseUrl().replace(/\/+$/, "");
        if (!base) {
          return Promise.reject(new Error("Machine base URL is not configured"));
        }
        const url = path.startsWith("http")
          ? path
          : `${base}${path.startsWith("/") ? path : `/${path}`}`;
        return fetchImpl(url, init);
      },
    },
    ai: providerAI(getProvider, configured),
    clock,
    logger: consoleLogger(),
  };
}
