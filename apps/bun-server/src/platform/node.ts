/**
 * Node/Bun implementation of the core `Platform` interface.
 *
 * Storage is filesystem-backed JSON: every collection is a directory under the
 * data root, with one `${id}.json` document per record. This mirrors the shapes
 * the Python backend persisted under `/data`, so a 3.0.0 container can adopt an
 * existing 2.x data volume without migration (SQLite lands in Phase 4b behind
 * this same Repo seam).
 */

import { mkdir, readFile, writeFile, readdir, unlink, rename } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { networkInterfaces } from "node:os";
import { GoogleGenAI } from "@google/genai";
import {
  listAvailableModels,
  STATIC_FALLBACK_MODELS,
  type ModelClient,
} from "@metic/core/ai/modelResolver";
import type {
  Platform,
  PlatformStorage,
  PlatformAI,
  Repo,
  Cache,
  BlobStore,
  Scheduler,
  Logger,
  AIConfig,
} from "@metic/core/platform";
import { openSqliteStorage } from "./sqliteStorage.ts";
import { migrateJsonToSqlite } from "./sqliteMigration.ts";

async function atomicWrite(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, data, "utf8");
  await rename(tmp, path);
}

function safeId(id: string): string {
  // Prevent path traversal; ids become flat filenames.
  return id.replace(/[^A-Za-z0-9._-]/g, "_");
}

/** A directory-backed JSON repository: one `${id}.json` file per document. */
function fsRepo<T>(dir: string): Repo<T> {
  return {
    async read(id) {
      const path = join(dir, `${safeId(id)}.json`);
      if (!existsSync(path)) return null;
      try {
        return JSON.parse(await readFile(path, "utf8")) as T;
      } catch {
        return null;
      }
    },
    async list() {
      if (!existsSync(dir)) return [];
      const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
      const out: T[] = [];
      for (const f of files) {
        try {
          out.push(JSON.parse(await readFile(join(dir, f), "utf8")) as T);
        } catch {
          // Skip corrupt/partial files rather than failing the whole list.
        }
      }
      return out;
    },
    async write(id, value) {
      await atomicWrite(join(dir, `${safeId(id)}.json`), JSON.stringify(value, null, 2));
    },
    async delete(id) {
      const path = join(dir, `${safeId(id)}.json`);
      if (existsSync(path)) await unlink(path);
    },
  };
}

/**
 * A single-document repository backed by one JSON file (e.g. settings.json).
 * `list()` returns the single document if present; ids are ignored for read.
 */
function fsSingletonRepo<T>(file: string): Repo<T> {
  const load = async (): Promise<T | null> => {
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(await readFile(file, "utf8")) as T;
    } catch {
      return null;
    }
  };
  return {
    read: load,
    async list() {
      const v = await load();
      return v == null ? [] : [v];
    },
    async write(_id, value) {
      await atomicWrite(file, JSON.stringify(value, null, 2));
    },
    async delete() {
      if (existsSync(file)) await unlink(file);
    },
  };
}

/**
 * A single-file repository backed by one JSON object that maps id -> document
 * (e.g. shot_annotations.json). Unlike the directory repo, ids may contain any
 * character (including `/`), so this suits keys like `${date}/${filename}`.
 */
function fsKeyedMapRepo<T>(file: string): Repo<T> {
  const loadMap = async (): Promise<Record<string, T>> => {
    if (!existsSync(file)) return {};
    try {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      return parsed && typeof parsed === "object" ? (parsed as Record<string, T>) : {};
    } catch {
      return {};
    }
  };
  const saveMap = async (map: Record<string, T>): Promise<void> => {
    await atomicWrite(file, JSON.stringify(map, null, 2));
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

function fsBlobStore(dir: string): BlobStore {
  return {
    async read(key) {
      const path = join(dir, safeId(key));
      if (!existsSync(path)) return null;
      return new Uint8Array(await readFile(path));
    },
    async write(key, bytes) {
      const path = join(dir, safeId(key));
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
    },
    async delete(key) {
      const path = join(dir, safeId(key));
      if (existsSync(path)) await unlink(path);
    },
  };
}

function timerScheduler(logger: Logger): Scheduler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return {
    schedule(id, at, run) {
      this.cancel(id);
      const delay = Math.max(0, at - Date.now());
      const t = setTimeout(() => {
        timers.delete(id);
        run().catch((err) => logger.error(`scheduled task ${id} failed`, err));
      }, delay);
      // Do not keep the process alive solely for a pending timer.
      if (typeof (t as { unref?: () => void }).unref === "function") {
        (t as { unref: () => void }).unref();
      }
      timers.set(id, t);
    },
    cancel(id) {
      const t = timers.get(id);
      if (t) {
        clearTimeout(t);
        timers.delete(id);
      }
    },
  };
}

function consoleLogger(): Logger {
  const fmt = (level: string, message: string, extra?: unknown) =>
    extra === undefined
      ? `[${level}] ${message}`
      : `[${level}] ${message} ${typeof extra === "string" ? extra : JSON.stringify(extra)}`;
  return {
    info: (m, e) => console.log(fmt("info", m, e)),
    error: (m, e) => console.error(fmt("error", m, e)),
    debug: (m, e) => {
      if (process.env.DEBUG) console.debug(fmt("debug", m, e));
    },
  };
}

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";

/**
 * Gemini-backed PlatformAI. Mirrors the frontend GeminiProvider's generateText:
 * a `models.generateContent({ model, contents, config })` call returning `{ text }`.
 * A bare string prompt is accepted as `contents` (the SDK wraps it).
 */
function geminiAI(getConfig: () => AIConfig): PlatformAI {
  return {
    isConfigured() {
      return !!getConfig().apiKey;
    },
    async generateText(req) {
      const { apiKey, model } = getConfig();
      if (!apiKey) throw new Error("AI not configured");
      const client = new GoogleGenAI({ apiKey });
      const response = await client.models.generateContent({
        model: model || DEFAULT_GEMINI_MODEL,
        contents: req.contents as Parameters<typeof client.models.generateContent>[0]["contents"],
        ...(req.config ? { config: req.config as Record<string, unknown> } : {}),
      });
      return { text: (response as { text?: string }).text ?? "" };
    },
    currentModel() {
      return getConfig().model || DEFAULT_GEMINI_MODEL;
    },
    async listModels() {
      const { apiKey } = getConfig();
      if (!apiKey) return STATIC_FALLBACK_MODELS;
      try {
        const client = new GoogleGenAI({ apiKey });
        const models = await listAvailableModels(client as unknown as ModelClient);
        return models.length ? models : STATIC_FALLBACK_MODELS;
      } catch {
        return STATIC_FALLBACK_MODELS;
      }
    },
  };
}

export interface NodePlatformOptions {
  /** Root directory for persisted JSON/blobs. Defaults to $DATA_DIR or ./data. */
  dataDir?: string;
  /** Machine base URL override. Defaults to http://$METICULOUS_IP:8080. */
  machineBaseUrl?: string;
  /**
   * Persistence backend. Defaults to $STORAGE_BACKEND (`json` | `sqlite`), else
   * `json` for zero-migration continuity with 2.x volumes. `sqlite` runs a
   * one-time, idempotent, reversible boot migration of any existing JSON.
   */
  storageBackend?: "json" | "sqlite";
}

const MACHINE_PORT = 8080;

function resolveMachineBaseUrl(override?: string): string {
  if (override) return override.replace(/\/+$/, "");
  const ip = (process.env.METICULOUS_IP ?? "").trim();
  if (!ip) return "";
  if (/^https?:\/\//.test(ip)) return ip.replace(/\/+$/, "");
  // Bare host or host:port.
  return ip.includes(":") ? `http://${ip}` : `http://${ip}:${MACHINE_PORT}`;
}

/**
 * Ordered base URLs to try for the machine, most-likely first.
 *
 * Current firmware serves the API on port 8080 (and proxies it on port 80 via
 * nginx); older / downgraded firmware serves it ONLY on the default HTTP port
 * (80). When the configured base assumes an explicit non-default HTTP port, add
 * a port-80 (no explicit port) fallback so those machines stay reachable.
 */
export function machineCandidateBases(baseUrl: string): string[] {
  const out: string[] = [];
  const push = (u: string) => {
    const trimmed = u.replace(/\/+$/, "");
    if (trimmed && !out.includes(trimmed)) out.push(trimmed);
  };
  push(baseUrl);
  try {
    const url = new URL(baseUrl);
    if (url.protocol === "http:" && url.port && url.port !== "80") {
      url.port = "";
      push(url.toString());
    }
  } catch {
    /* not a URL — only the raw value is a candidate */
  }
  return out;
}

/** App version for GET /api/version: $APP_VERSION, else the repo VERSION file, else "unknown". */
function resolveAppVersion(): string {
  const env = process.env.APP_VERSION?.trim();
  if (env) return env;
  for (const candidate of ["VERSION", "../VERSION", "../../VERSION", "../../../VERSION"]) {
    try {
      const p = join(process.cwd(), candidate);
      if (existsSync(p)) {
        const v = readFileSync(p, "utf8").trim();
        if (v) return v;
      }
    } catch {
      /* ignore and try the next candidate */
    }
  }
  return "unknown";
}

/** Storage repos excluding the in-memory aiCache (which is backend-agnostic). */
type DocumentStorage = Omit<PlatformStorage, "aiCache">;

function buildJsonStorage(dataDir: string): DocumentStorage {
  return {
    settings: fsSingletonRepo<Record<string, unknown>>(join(dataDir, "settings.json")),
    history: fsSingletonRepo(join(dataDir, "profile_history.json")),
    annotations: fsKeyedMapRepo(join(dataDir, "shot_annotations.json")),
    dialInSessions: fsKeyedMapRepo(join(dataDir, "dialin_sessions.json")),
    pourOverPrefs: fsSingletonRepo(join(dataDir, "pour_over_preferences.json")),
    schedules: fsRepo(join(dataDir, "schedules")),
    descriptions: fsKeyedMapRepo(join(dataDir, "profile_descriptions.json")),
    aiTags: fsKeyedMapRepo(join(dataDir, "profile_ai_tags.json")),
    images: fsBlobStore(join(dataDir, "images")),
  };
}

function buildSqliteStorage(dataDir: string, logger: Logger): DocumentStorage {
  const handles = openSqliteStorage(dataDir);
  migrateJsonToSqlite(dataDir, handles, (m) => logger.info(m));
  return {
    settings: handles.singletonRepo<Record<string, unknown>>("settings"),
    history: handles.singletonRepo("history"),
    annotations: handles.documentRepo("annotations"),
    dialInSessions: handles.documentRepo("dialInSessions"),
    pourOverPrefs: handles.singletonRepo("pourOverPrefs"),
    schedules: handles.documentRepo("schedules"),
    descriptions: handles.documentRepo("descriptions"),
    aiTags: handles.documentRepo("aiTags"),
    images: handles.blobStore(),
  };
}

export function createNodePlatform(options: NodePlatformOptions = {}): Platform {
  const dataDir =
    options.dataDir ?? process.env.DATA_DIR ?? join(process.cwd(), "data");
  const clock = () => Date.now();
  const logger = consoleLogger();
  const machineBaseUrl = resolveMachineBaseUrl(options.machineBaseUrl);
  const machineCandidates = machineCandidateBases(machineBaseUrl);
  // The base URL that most recently answered. Starts at the configured default
  // (port 8080) and self-heals to a port-80 fallback for older firmware.
  let effectiveMachineBase = machineBaseUrl;

  /**
   * Probe candidate bases once and switch `effectiveMachineBase` to the first
   * that answers /api/v1/settings. Memoized; safe to call repeatedly. No-op when
   * unconfigured or when there is no alternative to try.
   */
  let machineResolution: Promise<void> | null = null;
  function resolveEffectiveMachineBase(): Promise<void> {
    if (!machineBaseUrl || machineCandidates.length <= 1) return Promise.resolve();
    if (machineResolution) return machineResolution;
    machineResolution = (async () => {
      for (const base of machineCandidates) {
        try {
          const resp = await fetch(`${base}/api/v1/settings`, {
            signal: AbortSignal.timeout(4000),
          });
          if (resp.ok || resp.status === 404) {
            if (base !== effectiveMachineBase) {
              logger.info(`[machine] using ${base} (configured ${machineBaseUrl} unreachable on that port)`);
            }
            effectiveMachineBase = base;
            return;
          }
        } catch {
          /* try the next candidate */
        }
      }
    })();
    return machineResolution;
  }

  const backend =
    options.storageBackend ??
    (process.env.STORAGE_BACKEND?.trim().toLowerCase() === "sqlite" ? "sqlite" : "json");
  const documentStorage =
    backend === "sqlite" ? buildSqliteStorage(dataDir, logger) : buildJsonStorage(dataDir);

  const getAIConfig = (): AIConfig => {
    // Env var takes precedence (container/12-factor); settings.json is the
    // fallback so the UI-configured key keeps working without a restart.
    const apiKey = (process.env.GEMINI_API_KEY ?? "").trim();
    return {
      provider: "gemini",
      apiKey,
      model: process.env.GEMINI_MODEL?.trim() || undefined,
    };
  };

  return {
    storage: {
      ...documentStorage,
      aiCache: memoryCache(clock),
    },
    secrets: {
      getAIConfig,
    },
    machine: {
      getBaseUrl: () => effectiveMachineBase,
      fetch: async (path: string, init?: RequestInit) => {
        if (!machineBaseUrl) {
          return Promise.reject(new Error("Machine base URL is not configured"));
        }
        if (path.startsWith("http")) return fetch(path, init);
        await resolveEffectiveMachineBase();
        const rel = path.startsWith("/") ? path : `/${path}`;
        try {
          return await fetch(`${effectiveMachineBase}${rel}`, init);
        } catch (err) {
          // Connection-level failure: try the remaining candidate ports (older
          // firmware serves the API on port 80 only) and switch on success.
          for (const base of machineCandidates) {
            if (base === effectiveMachineBase) continue;
            try {
              const resp = await fetch(`${base}${rel}`, init);
              effectiveMachineBase = base;
              logger.info(`[machine] switched base URL to ${base} after a connection failure`);
              return resp;
            } catch {
              /* try the next candidate */
            }
          }
          throw err;
        }
      },
    },
    ai: geminiAI(getAIConfig),
    scheduler: timerScheduler(logger),
    netScan: {
      // Own non-internal IPv4 addresses, used to derive the /24 to scan.
      localIPv4s: () => {
        const out: string[] = [];
        const ifaces = networkInterfaces();
        for (const name of Object.keys(ifaces)) {
          for (const ni of ifaces[name] ?? []) {
            // Node >=18 reports family as the string "IPv4"; guard both forms.
            const isV4 = ni.family === "IPv4" || (ni.family as unknown as number) === 4;
            if (isV4 && !ni.internal) out.push(ni.address);
          }
        }
        return out;
      },
      // Raw HTTP GET returning the status code, or null on network/timeout error.
      probe: async (url: string, timeoutMs: number) => {
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
          return resp.status;
        } catch {
          return null;
        }
      },
    },
    clock,
    logger,
    appVersion: resolveAppVersion(),
  };
}
