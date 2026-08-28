/**
 * Dial-In Guide session route family.
 *
 * Coffee dial-in sessions: a sequence of shot/taste/adjust iterations with
 * rule-based recommendations driven by the Espresso Compass (taste.x/taste.y).
 * This is a straight port of the two existing implementations kept at parity:
 *   - server: apps/server/services/dialin_service.py (+ routes in dialin.py)
 *   - native: apps/web/src/services/interceptor/directModeStorage.ts
 *             (+ dispatch in DirectModeInterceptor.ts)
 *
 * All persistence goes through `platform.storage.dialInSessions` (a Repo keyed
 * by the 12-char hex session id). Sessions are stored whole, matching the
 * native runtime which keeps every session (unlike the Python service which
 * only persists ACTIVE sessions to disk; that pre-existing divergence resolves
 * in favor of the native "keep all" semantics that this unification adopts).
 *
 * Errors use FastAPI's `{ detail }` shape with the matching HTTP status, so the
 * frontend sees identical responses whether served by Python or the core.
 *
 * Routes (also served under the bare `/dialin/...` alias):
 *   POST   /api/dialin/sessions                                        -> 201 session
 *   GET    /api/dialin/sessions[?status=]                              -> { sessions }
 *   GET    /api/dialin/sessions/{id}                                   -> session | 404
 *   DELETE /api/dialin/sessions/{id}                                   -> { deleted } | 404
 *   POST   /api/dialin/sessions/{id}/iterations                        -> 201 iteration
 *   PUT    /api/dialin/sessions/{id}/iterations/{n}/recommendations    -> iteration
 *   POST   /api/dialin/sessions/{id}/recommend                         -> { recommendations, source }
 *   POST   /api/dialin/sessions/{id}/complete                          -> session
 */

import type { Platform, Repo } from "../platform";
import { jsonResponse } from "../http";
import { safeRandomUUID } from "../logic/uuid";
import { buildDialInRecommendationPrompt } from "./dialinPrompt";

export type DialInStatus = "active" | "completed" | "abandoned";

export interface TasteFeedback {
  x: number;
  y: number;
  descriptors: string[];
  notes?: string;
}

export interface DialInIteration {
  iteration_number: number;
  shot_ref?: string | null;
  taste: TasteFeedback;
  recommendations: string[];
  timestamp: string;
}

export interface DialInSession {
  id: string;
  coffee: Record<string, unknown>;
  profile_name?: string;
  iterations: DialInIteration[];
  status: DialInStatus;
  created_at: string;
  updated_at: string;
}

/** Thrown for invalid input; `status` selects the HTTP code (400/404). */
export class DialInValidationError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "DialInValidationError";
  }
}

const VALID_ROASTS = new Set(["light", "medium-light", "medium", "medium-dark", "dark"]);
const VALID_PROCESSES = new Set(["washed", "natural", "honey", "anaerobic", "other"]);
const VALID_STATUSES = new Set<DialInStatus>(["active", "completed", "abandoned"]);

function sessionRepo(platform: Platform): Repo<DialInSession> {
  return platform.storage.dialInSessions as Repo<DialInSession>;
}

function isoNow(platform: Platform): string {
  return new Date(platform.clock()).toISOString();
}

function generateSessionId(): string {
  return safeRandomUUID().replace(/-/g, "").slice(0, 12);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) throw new DialInValidationError(`${label} must be an object`);
  return value;
}

function normalizeCoffeeDetails(value: unknown): Record<string, unknown> {
  const record = requireRecord(value, "coffee");
  const roastLevel = record.roast_level;
  if (typeof roastLevel !== "string" || !VALID_ROASTS.has(roastLevel)) {
    throw new DialInValidationError("coffee.roast_level must be a valid roast level");
  }

  const result: Record<string, unknown> = { roast_level: roastLevel };
  for (const key of ["origin", "roast_date"] as const) {
    const valueForKey = record[key];
    if (valueForKey !== undefined) {
      if (typeof valueForKey !== "string") {
        throw new DialInValidationError(`coffee.${key} must be a string`);
      }
      result[key] = valueForKey;
    }
  }

  const process = record.process;
  if (process !== undefined) {
    if (typeof process !== "string" || !VALID_PROCESSES.has(process)) {
      throw new DialInValidationError("coffee.process must be a valid process");
    }
    result.process = process;
  }
  return result;
}

function normalizeTasteFeedback(value: unknown): TasteFeedback {
  const record = requireRecord(value, "taste");
  const x = record.x;
  const y = record.y;
  if (typeof x !== "number" || !Number.isFinite(x)) {
    throw new DialInValidationError("taste.x must be a finite number");
  }
  if (typeof y !== "number" || !Number.isFinite(y)) {
    throw new DialInValidationError("taste.y must be a finite number");
  }
  if (x < -1 || x > 1) throw new DialInValidationError("taste.x must be between -1 and 1");
  if (y < -1 || y > 1) throw new DialInValidationError("taste.y must be between -1 and 1");

  const descriptorsValue = record.descriptors ?? [];
  if (!Array.isArray(descriptorsValue) || descriptorsValue.some((item) => typeof item !== "string")) {
    throw new DialInValidationError("taste.descriptors must be a list of strings");
  }

  const notes = record.notes;
  if (notes !== undefined && typeof notes !== "string") {
    throw new DialInValidationError("taste.notes must be a string");
  }

  return {
    x,
    y,
    descriptors: descriptorsValue as string[],
    ...(notes !== undefined ? { notes } : {}),
  };
}

function normalizeRecommendations(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new DialInValidationError("recommendations must be a list of strings");
  }
  return value as string[];
}

export async function createSession(platform: Platform, value: unknown): Promise<DialInSession> {
  const record = requireRecord(value, "dial-in session");
  const coffee = normalizeCoffeeDetails(isRecord(record.coffee) ? record.coffee : record);
  const profileName = record.profile_name;
  if (profileName !== undefined && typeof profileName !== "string") {
    throw new DialInValidationError("profile_name must be a string");
  }

  const timestamp = isoNow(platform);
  const session: DialInSession = {
    id: generateSessionId(),
    coffee,
    ...(profileName ? { profile_name: profileName } : {}),
    iterations: [],
    status: "active",
    created_at: timestamp,
    updated_at: timestamp,
  };
  await sessionRepo(platform).write(session.id, session);
  return session;
}

export async function getSession(platform: Platform, id: string): Promise<DialInSession | null> {
  return sessionRepo(platform).read(id);
}

export async function listSessions(platform: Platform, status?: string | null): Promise<DialInSession[]> {
  if (status !== undefined && status !== null && !VALID_STATUSES.has(status as DialInStatus)) {
    throw new DialInValidationError("status must be active, completed, or abandoned");
  }
  const sessions = await sessionRepo(platform).list();
  return status ? sessions.filter((session) => session.status === status) : sessions;
}

export async function addIteration(
  platform: Platform,
  sessionId: string,
  value: unknown,
): Promise<DialInIteration> {
  const repo = sessionRepo(platform);
  const session = await repo.read(sessionId);
  if (!session) throw new DialInValidationError(`Session ${sessionId} not found`, 404);
  if (session.status !== "active") throw new DialInValidationError(`Session ${sessionId} is not active`, 404);

  const record = requireRecord(value, "dial-in iteration");
  const shotRef = record.shot_ref;
  if (shotRef !== undefined && shotRef !== null && typeof shotRef !== "string") {
    throw new DialInValidationError("shot_ref must be a string or null");
  }
  const iteration: DialInIteration = {
    iteration_number: session.iterations.length + 1,
    ...(shotRef !== undefined ? { shot_ref: shotRef as string | null } : {}),
    taste: normalizeTasteFeedback(record.taste),
    recommendations: [],
    timestamp: isoNow(platform),
  };
  session.iterations.push(iteration);
  session.updated_at = isoNow(platform);
  await repo.write(session.id, session);
  return iteration;
}

export async function updateRecommendations(
  platform: Platform,
  sessionId: string,
  iterationNumber: number,
  value: unknown,
): Promise<DialInIteration> {
  const repo = sessionRepo(platform);
  const session = await repo.read(sessionId);
  if (!session) throw new DialInValidationError(`Session ${sessionId} not found`, 404);
  const recommendations = normalizeRecommendations(requireRecord(value, "recommendation update").recommendations);
  const iteration = session.iterations.find((item) => item.iteration_number === iterationNumber);
  if (!iteration) {
    throw new DialInValidationError(`Iteration ${iterationNumber} not found in session ${sessionId}`, 404);
  }
  iteration.recommendations = recommendations;
  session.updated_at = isoNow(platform);
  await repo.write(session.id, session);
  return iteration;
}

/**
 * Rule-based recommendations from the latest iteration's taste coordinates.
 * Mirrors the Python fallback and the native runtime exactly (the native
 * runtime is rules-only; the Python AI path is layered separately once the
 * provider abstraction lands).
 */
export function buildDialInRecommendations(taste: TasteFeedback): string[] {
  const recommendations: string[] = [];
  if (taste.x < -0.2) {
    recommendations.push("Grind finer (2-3 steps)");
    recommendations.push("Increase temperature by 1-2°C");
  }
  if (taste.x > 0.2) {
    recommendations.push("Grind coarser (2-3 steps)");
    recommendations.push("Decrease temperature by 1-2°C");
  }
  if (taste.y < -0.2) recommendations.push("Increase dose by 0.3-0.5g");
  if (taste.y > 0.2) recommendations.push("Decrease dose by 0.3-0.5g");
  if (recommendations.length === 0) {
    recommendations.push("Looking good! Small tweaks only — try ±0.5°C or ±0.2g dose");
  }
  return recommendations;
}

/**
 * Strip a single leading/trailing markdown code fence from an AI response,
 * matching the Python route's cleanup before JSON parsing.
 */
function stripCodeFence(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) cleaned = cleaned.split("\n").slice(1).join("\n");
  if (cleaned.endsWith("```")) cleaned = cleaned.split("\n").slice(0, -1).join("\n");
  return cleaned;
}

/**
 * Generate recommendations for the latest iteration. Tries the AI provider
 * first (when configured), parsing a `{ recommendations: [...] }` JSON object
 * and storing up to 6 strings; on any failure or when AI is unavailable, falls
 * back to the deterministic rule-based guidance. Mirrors the Python route.
 */
export async function generateRecommendations(
  platform: Platform,
  sessionId: string,
): Promise<{ recommendations: string[]; source: "ai" | "rules" }> {
  const repo = sessionRepo(platform);
  const session = await repo.read(sessionId);
  if (!session) throw new DialInValidationError("Session not found", 404);
  if (!session.iterations.length) throw new DialInValidationError("No iterations to recommend from", 400);
  const latest = session.iterations[session.iterations.length - 1]!;

  if (platform.ai.isConfigured()) {
    try {
      const coffee = session.coffee ?? {};
      const prompt = buildDialInRecommendationPrompt({
        roastLevel: String(coffee.roast_level ?? ""),
        origin: typeof coffee.origin === "string" ? coffee.origin : null,
        process: typeof coffee.process === "string" ? coffee.process : null,
        roastDate: typeof coffee.roast_date === "string" ? coffee.roast_date : null,
        profileName: session.profile_name ?? null,
        iterations: session.iterations,
      });
      const { text } = await platform.ai.generateText({ contents: prompt });
      const data = JSON.parse(stripCodeFence(text ?? "")) as { recommendations?: unknown };
      const recommendations = data.recommendations;
      if (Array.isArray(recommendations) && recommendations.length > 0) {
        const recs = recommendations.slice(0, 6).map((r) => String(r));
        latest.recommendations = recs;
        session.updated_at = isoNow(platform);
        await repo.write(session.id, session);
        return { recommendations: recs, source: "ai" };
      }
    } catch (err) {
      platform.logger.debug("Dial-in AI recommendation failed, falling back to rules", err);
    }
  }

  latest.recommendations = buildDialInRecommendations(latest.taste);
  session.updated_at = isoNow(platform);
  await repo.write(session.id, session);
  return { recommendations: latest.recommendations, source: "rules" };
}

export async function completeSession(platform: Platform, id: string): Promise<DialInSession> {
  const repo = sessionRepo(platform);
  const session = await repo.read(id);
  if (!session) throw new DialInValidationError(`Session ${id} not found`, 404);
  session.status = "completed";
  session.updated_at = isoNow(platform);
  await repo.write(session.id, session);
  return session;
}

export async function deleteSession(platform: Platform, id: string): Promise<boolean> {
  const repo = sessionRepo(platform);
  const existing = await repo.read(id);
  if (!existing) return false;
  await repo.delete(id);
  return true;
}

const SESSIONS_PATH = "/api/dialin/sessions";
const ITERATIONS_RE = /^\/api\/dialin\/sessions\/([^/]+)\/iterations$/;
const RECOMMENDATIONS_RE = /^\/api\/dialin\/sessions\/([^/]+)\/iterations\/(\d+)\/recommendations$/;
const RECOMMEND_RE = /^\/api\/dialin\/sessions\/([^/]+)\/recommend$/;
const COMPLETE_RE = /^\/api\/dialin\/sessions\/([^/]+)\/complete$/;
const SESSION_RE = /^\/api\/dialin\/sessions\/([^/]+)$/;

function detailError(err: unknown, fallbackStatus: number, fallbackMessage: string): Response {
  const status = err instanceof DialInValidationError ? err.status : fallbackStatus;
  const detail = err instanceof Error ? err.message : fallbackMessage;
  return jsonResponse({ detail }, status);
}

/**
 * Route dispatcher. Returns a Response for a dial-in route, or `null` if the
 * request is not one (so the main handler can try other route families). Both
 * the canonical `/api/dialin/...` paths and the bare `/dialin/...` alias are
 * served, matching the existing FastAPI dual-decorator and native behavior.
 */
export async function handleDialInRoutes(req: Request, platform: Platform): Promise<Response | null> {
  const url = new URL(req.url);
  const raw = url.pathname;
  const pathname = raw === "/dialin/sessions" || raw.startsWith("/dialin/sessions/") ? `/api${raw}` : raw;
  if (pathname !== SESSIONS_PATH && !pathname.startsWith(`${SESSIONS_PATH}/`)) return null;
  const method = req.method;

  if (pathname === SESSIONS_PATH && method === "POST") {
    try {
      return jsonResponse(await createSession(platform, await req.json()), 201);
    } catch (err) {
      return detailError(err, 400, "Invalid dial-in session");
    }
  }

  if (pathname === SESSIONS_PATH && method === "GET") {
    try {
      return jsonResponse({ sessions: await listSessions(platform, url.searchParams.get("status")) });
    } catch (err) {
      return detailError(err, 400, "Failed to list dial-in sessions");
    }
  }

  const recommendMatch = pathname.match(RECOMMEND_RE);
  if (recommendMatch && method === "POST") {
    try {
      return jsonResponse(await generateRecommendations(platform, decodeURIComponent(recommendMatch[1]!)));
    } catch (err) {
      return detailError(err, 500, "Failed to generate recommendations");
    }
  }

  const completeMatch = pathname.match(COMPLETE_RE);
  if (completeMatch && method === "POST") {
    try {
      return jsonResponse(await completeSession(platform, decodeURIComponent(completeMatch[1]!)));
    } catch (err) {
      return detailError(err, 500, "Failed to complete session");
    }
  }

  const recommendationsMatch = pathname.match(RECOMMENDATIONS_RE);
  if (recommendationsMatch && method === "PUT") {
    try {
      const iteration = await updateRecommendations(
        platform,
        decodeURIComponent(recommendationsMatch[1]!),
        Number(recommendationsMatch[2]),
        await req.json(),
      );
      return jsonResponse(iteration);
    } catch (err) {
      return detailError(err, 500, "Failed to update recommendations");
    }
  }

  const iterationsMatch = pathname.match(ITERATIONS_RE);
  if (iterationsMatch && method === "POST") {
    try {
      const iteration = await addIteration(platform, decodeURIComponent(iterationsMatch[1]!), await req.json());
      return jsonResponse(iteration, 201);
    } catch (err) {
      return detailError(err, 500, "Failed to add iteration");
    }
  }

  const sessionMatch = pathname.match(SESSION_RE);
  if (sessionMatch && method === "GET") {
    const session = await getSession(platform, decodeURIComponent(sessionMatch[1]!));
    return session ? jsonResponse(session) : jsonResponse({ detail: "Session not found" }, 404);
  }
  if (sessionMatch && method === "DELETE") {
    const deleted = await deleteSession(platform, decodeURIComponent(sessionMatch[1]!));
    return deleted ? jsonResponse({ deleted: true }) : jsonResponse({ detail: "Session not found" }, 404);
  }

  return null;
}
