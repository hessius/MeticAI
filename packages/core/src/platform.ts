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

/**
 * The AI text/image generation primitive, reached through the Platform so the
 * core's AI orchestration (prompt building, response parsing) stays host-free.
 * The request/response shape mirrors the frontend's AIProvider.generateText so
 * the browser Platform can delegate straight to the active provider, while the
 * Node Platform implements it against the Gemini SDK.
 */
export interface PlatformAI {
  /** Whether a usable AI provider is configured (e.g. an API key is present). */
  isConfigured(): boolean;
  /** Generate text from Gemini-style `contents` (a string prompt is accepted). */
  generateText(req: { contents: unknown; config?: unknown }): Promise<{ text: string }>;
  /** Optional image generation; absent on hosts/providers without the capability. */
  generateImage?(prompt: string): Promise<Uint8Array>;
  /**
   * List the served text models for the model-picker UI, best-first. Optional:
   * hosts without discovery omit it and the route falls back to a static list.
   */
  listModels?(): Promise<Array<{ id: string; display_name: string; description: string }>>;
  /** The currently-configured model id, surfaced by GET /api/available-models. */
  currentModel?(): string;
  /**
   * Approximate total context window (input + output) in tokens for the active
   * provider, when it has a hard limit small enough that full prompts overflow
   * it. On-device models (Apple Intelligence, Gemma) sit around 4096 tokens, so
   * the large analysis/profile prompts must be compacted for them. Hosted
   * providers omit this (effectively unbounded for our prompts).
   */
  contextWindowTokens?(): number | undefined;
}


export interface PlatformStorage {
  settings: Repo<Record<string, unknown>>;
  history: Repo<unknown>;
  annotations: Repo<unknown>;
  dialInSessions: Repo<unknown>;
  pourOverPrefs: Repo<unknown>;
  schedules: Repo<unknown>;
  /** AI-generated profile descriptions, keyed by profile name. */
  descriptions: Repo<string>;
  /** AI-generated profile tag lists, keyed by profile name. */
  aiTags: Repo<string[]>;
  aiCache: Cache;
  images: BlobStore;
}

export interface Platform {
  storage: PlatformStorage;
  secrets: { getAIConfig(): AIConfig };
  machine: {
    getBaseUrl(): string;
    /**
     * Fetch a path on the espresso machine's HTTP API. `path` is joined to the
     * resolved base URL (e.g. "/api/v1/history"). Lets core routes read machine
     * state (shot history, profiles) uniformly across hosts: the Node platform
     * fetches server-side, the browser platform fetches over the LAN.
     */
    fetch(path: string, init?: RequestInit): Promise<Response>;
  };
  /** AI text/image generation primitive. */
  ai: PlatformAI;
  /** Optional: hosts without a scheduler cause schedule routes to return 501. */
  scheduler?: Scheduler;
  clock: () => number;
  logger: Logger;
  /** Optional app/build version surfaced by GET /api/version (defaults to "unknown"). */
  appVersion?: string;
  /**
   * Optional progress reporter for long-running generation flows. The browser
   * platform drives the segmented profile-generation progress bar from these
   * events; hosts without a UI (Node/Bun server, mock) omit it. `message` is an
   * i18n key. Reporting must never throw into the caller.
   */
  reportProgress?: (event: GenerationProgressEvent) => void;
}

/** A profile-generation progress event (message is an i18n key). */
export interface GenerationProgressEvent {
  phase: "analyzing" | "generating" | "validating" | "retrying" | "complete" | "failed";
  message: string;
  attempt?: number;
  maxAttempts?: number;
}
