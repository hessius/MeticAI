/**
 * The Platform interface is the single seam of the unified TS core.
 *
 * `handle(request, platform)` is a Web-standard request handler shared by both
 * runtimes: the browser installs it over `window.fetch` (direct mode) and the
 * Bun server consumes it via `Bun.serve({ fetch })` (proxy mode). Every host
 * dependency (storage, secrets, machine URL, scheduling, clock, logging) is
 * reached exclusively through this interface, so the core stays free of any
 * environment-specific API.
 */

/** A CRUD repository for a single collection of documents keyed by id. */
export interface Repo<T> {
  read(id: string): Promise<T | null>;
  list(): Promise<T[]>;
  write(id: string, value: T): Promise<void>;
  delete(id: string): Promise<void>;
}

/** A time-to-live cache used for AI responses and other derived data. */
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
}

/** Binary blob storage (e.g. profile images). */
export interface BlobStore {
  read(key: string): Promise<Uint8Array | null>;
  write(key: string, bytes: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

/** Deferred/recurring task scheduling. Absent on hosts that cannot schedule. */
export interface Scheduler {
  schedule(id: string, at: number, run: () => Promise<void>): void;
  cancel(id: string): void;
}

export interface Logger {
  info(message: string, extra?: unknown): void;
  error(message: string, extra?: unknown): void;
  debug(message: string, extra?: unknown): void;
}

/** Resolved AI provider configuration (provider-agnostic). */
export interface AIConfig {
  provider: string;
  apiKey: string;
  model?: string;
}

export interface PlatformStorage {
  settings: Repo<Record<string, unknown>>;
  history: Repo<unknown>;
  annotations: Repo<unknown>;
  dialInSessions: Repo<unknown>;
  pourOverPrefs: Repo<unknown>;
  schedules: Repo<unknown>;
  aiCache: Cache;
  images: BlobStore;
}

export interface Platform {
  storage: PlatformStorage;
  secrets: { getAIConfig(): AIConfig };
  machine: { getBaseUrl(): string };
  /** Optional: hosts without a scheduler cause schedule routes to return 501. */
  scheduler?: Scheduler;
  clock: () => number;
  logger: Logger;
}
