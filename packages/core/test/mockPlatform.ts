import type { Platform, Repo, Cache, BlobStore, PlatformAI } from "../src/platform";

/** In-memory Repo backing the mock Platform. */
function memRepo<T>(): Repo<T> {
  const store = new Map<string, T>();
  return {
    read: async (id) => store.get(id) ?? null,
    list: async () => [...store.values()],
    write: async (id, value) => void store.set(id, value),
    delete: async (id) => void store.delete(id),
  };
}

function memCache(): Cache {
  const store = new Map<string, { value: unknown; expires: number }>();
  return {
    get: async <T>(key: string) => {
      const hit = store.get(key);
      if (!hit) return null;
      if (hit.expires !== 0 && hit.expires < Date.now()) {
        store.delete(key);
        return null;
      }
      return hit.value as T;
    },
    set: async <T>(key: string, value: T, ttlMs?: number) => {
      store.set(key, {
        value,
        expires: ttlMs && ttlMs > 0 ? Date.now() + ttlMs : 0,
      });
    },
  };
}

function memBlobStore(): BlobStore {
  const store = new Map<string, Uint8Array>();
  return {
    read: async (key) => store.get(key) ?? null,
    write: async (key, bytes) => void store.set(key, bytes),
    delete: async (key) => void store.delete(key),
  };
}

/**
 * Default mock AI: not configured, so route families that consult AI fall back
 * to their non-AI path. Tests exercising an AI path pass a configured `ai`
 * override (see `scriptedAI`).
 */
function unconfiguredAI(): PlatformAI {
  return {
    isConfigured: () => false,
    generateText: async () => {
      throw new Error("AI not configured");
    },
  };
}

/** A configured mock AI that returns a scripted text response. */
export function scriptedAI(text: string): PlatformAI {
  return {
    isConfigured: () => true,
    generateText: async () => ({ text }),
  };
}

/** A configured mock AI whose generateText always throws (to test fallbacks). */
export function throwingAI(message = "boom"): PlatformAI {
  return {
    isConfigured: () => true,
    generateText: async () => {
      throw new Error(message);
    },
  };
}

/** The machine seam of the mock Platform. */
type MockMachine = Platform["machine"];

/** Default mock machine: getBaseUrl is fixed, fetch rejects (no machine wired). */
function unwiredMachine(): MockMachine {
  return {
    getBaseUrl: () => "http://machine.test:8080",
    fetch: async () => {
      throw new Error("Machine not available");
    },
  };
}

/**
 * A mock machine whose fetch resolves canned JSON per path. `routes` maps a
 * request path (matched by `pathname`, ignoring query + base URL) to the JSON
 * body to return; unmatched paths resolve to a 404.
 */
export function scriptedMachine(routes: Record<string, unknown>): MockMachine {
  return {
    getBaseUrl: () => "http://machine.test:8080",
    fetch: async (path: string) => {
      const pathname = path.startsWith("http") ? new URL(path).pathname : path.split("?")[0];
      if (pathname in routes) {
        return new Response(JSON.stringify(routes[pathname]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ detail: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    },
  };
}

/**
 * A fully in-memory Platform for contract tests. Every route family's
 * behaviour is verified against this double so the frozen `/api/*` contract is
 * host-independent.
 */
export function makeMockPlatform(overrides: Partial<Platform> = {}): Platform {
  return {
    storage: {
      settings: memRepo(),
      history: memRepo(),
      annotations: memRepo(),
      dialInSessions: memRepo(),
      pourOverPrefs: memRepo(),
      schedules: memRepo(),
      aiCache: memCache(),
      images: memBlobStore(),
    },
    secrets: { getAIConfig: () => ({ provider: "gemini", apiKey: "test" }) },
    machine: unwiredMachine(),
    ai: unconfiguredAI(),
    clock: () => 0,
    logger: { info() {}, error() {}, debug() {} },
    ...overrides,
  };
}
