/**
 * Shot annotations route family.
 *
 * User notes + star ratings for individual shots, keyed by `${date}/${filename}`
 * to match the machine's shot storage layout. This is a straight port of the
 * two existing implementations kept at parity:
 *   - server: apps/server/services/shot_annotations_service.py (+ routes in shots.py)
 *   - native: apps/web/src/services/interceptor/directModeStorage.ts
 *
 * All persistence goes through `platform.storage.annotations` (a Repo whose id
 * is the shot key). The stored entry carries its own `key` so `getAll` can build
 * per-shot summaries without the Repo exposing its ids.
 *
 * Routes:
 *   GET    /api/shots/annotations                     -> summaries for the shot list
 *   GET    /api/shots/{date}/{filename}/annotation    -> single annotation
 *   PATCH  /api/shots/{date}/{filename}/annotation    -> upsert text and/or rating
 *   DELETE /api/shots/{date}/{filename}/annotation    -> remove entirely
 */

import type { Platform, Repo } from "../platform";
import { jsonResponse } from "../http";

export interface StoredAnnotation {
  key: string;
  annotation: string | null;
  rating: number | null;
  updated_at: string;
}

interface AnnotationResult {
  annotation: string | null;
  rating: number | null;
  updated_at: string | null;
}

/** Thrown for an out-of-range or non-integer rating; mapped to HTTP 422. */
export class AnnotationValidationError extends Error {}

function annotationRepo(platform: Platform): Repo<StoredAnnotation> {
  return platform.storage.annotations as Repo<StoredAnnotation>;
}

function shotKey(date: string, filename: string): string {
  return `${date}/${filename}`;
}

function isoNow(platform: Platform): string {
  return new Date(platform.clock()).toISOString();
}

/**
 * Validate a rating. `null`/`undefined` mean "no rating"; a valid rating is an
 * integer 1-5. Mirrors the native runtime's strict numeric validation.
 */
export function validateRating(rating: unknown): number | null {
  if (rating === null || rating === undefined) return null;
  if (typeof rating !== "number" || !Number.isInteger(rating)) {
    throw new AnnotationValidationError("Rating must be an integer between 1 and 5");
  }
  if (rating < 1 || rating > 5) {
    throw new AnnotationValidationError("Rating must be between 1 and 5");
  }
  return rating;
}

function clearedResult(): AnnotationResult {
  return { annotation: null, rating: null, updated_at: null };
}

function toResult(entry: StoredAnnotation): AnnotationResult {
  return {
    annotation: entry.annotation,
    rating: entry.rating,
    updated_at: entry.updated_at,
  };
}

export async function getAnnotation(
  platform: Platform,
  date: string,
  filename: string,
): Promise<AnnotationResult> {
  const entry = await annotationRepo(platform).read(shotKey(date, filename));
  return entry ? toResult(entry) : clearedResult();
}

/**
 * Upsert text and/or rating. A `null`/omitted rating leaves the existing rating
 * untouched; clearing both text and rating deletes the entry entirely.
 */
export async function setAnnotation(
  platform: Platform,
  date: string,
  filename: string,
  annotation: string,
  rating: number | null,
): Promise<AnnotationResult> {
  const repo = annotationRepo(platform);
  const key = shotKey(date, filename);
  const validatedRating = validateRating(rating);
  const existing = await repo.read(key);

  const hasText = annotation.trim().length > 0;
  const newAnnotation = hasText ? annotation.trim() : null;
  // "rating is not None" -> use the provided value, else keep the existing one.
  const newRating = validatedRating !== null ? validatedRating : existing?.rating ?? null;

  if (!newAnnotation && !newRating) {
    if (existing) await repo.delete(key);
    return clearedResult();
  }

  const entry: StoredAnnotation = {
    key,
    annotation: newAnnotation,
    rating: newRating,
    updated_at: isoNow(platform),
  };
  await repo.write(key, entry);
  return toResult(entry);
}

/** Set only the rating, preserving any existing annotation text. */
export async function setRating(
  platform: Platform,
  date: string,
  filename: string,
  rating: number | null,
): Promise<AnnotationResult> {
  const repo = annotationRepo(platform);
  const key = shotKey(date, filename);
  const validatedRating = validateRating(rating);
  const existing = await repo.read(key);
  const existingText = existing?.annotation ?? null;

  if (!existingText && !validatedRating) {
    if (existing) await repo.delete(key);
    return clearedResult();
  }

  const entry: StoredAnnotation = {
    key,
    annotation: existingText,
    rating: validatedRating,
    updated_at: isoNow(platform),
  };
  await repo.write(key, entry);
  return toResult(entry);
}

export async function deleteAnnotation(
  platform: Platform,
  date: string,
  filename: string,
): Promise<boolean> {
  const repo = annotationRepo(platform);
  const key = shotKey(date, filename);
  const existing = await repo.read(key);
  if (!existing) return false;
  await repo.delete(key);
  return true;
}

export async function getAnnotationSummaries(
  platform: Platform,
): Promise<Record<string, { has_annotation: boolean; rating: number | null }>> {
  const entries = await annotationRepo(platform).list();
  const summaries: Record<string, { has_annotation: boolean; rating: number | null }> = {};
  for (const entry of entries) {
    if (!entry || typeof entry.key !== "string") continue;
    summaries[entry.key] = {
      has_annotation: !!(entry.annotation && entry.annotation.trim().length > 0),
      rating: entry.rating ?? null,
    };
  }
  return summaries;
}

const SHOT_ANNOTATION_RE = /^\/api\/shots\/([^/]+)\/([^/]+)\/annotation$/;

/**
 * Route dispatcher. Returns a Response for an annotation route, or `null` if the
 * request is not one (so the main handler can try other route families).
 */
export async function handleAnnotationRoutes(
  req: Request,
  platform: Platform,
): Promise<Response | null> {
  const { pathname } = new URL(req.url);

  if (pathname === "/api/shots/annotations" && req.method === "GET") {
    return jsonResponse({ status: "success", annotations: await getAnnotationSummaries(platform) });
  }

  const match = pathname.match(SHOT_ANNOTATION_RE);
  if (!match) return null;

  const date = decodeURIComponent(match[1]!);
  const filename = decodeURIComponent(match[2]!);

  if (req.method === "GET") {
    const result = await getAnnotation(platform, date, filename);
    return jsonResponse({ status: "success", ...result });
  }

  if (req.method === "PATCH") {
    let body: { annotation?: string; rating?: number | null };
    try {
      body = (await req.json()) as typeof body;
    } catch {
      return jsonResponse({ status: "error", error: "Invalid JSON body" }, 400);
    }

    try {
      const hasAnnotation = Object.prototype.hasOwnProperty.call(body, "annotation");
      const hasRating = Object.prototype.hasOwnProperty.call(body, "rating");

      let result: AnnotationResult;
      if (hasRating && !hasAnnotation) {
        result = await setRating(platform, date, filename, body.rating ?? null);
      } else {
        result = await setAnnotation(
          platform,
          date,
          filename,
          body.annotation ?? "",
          body.rating ?? null,
        );
      }
      return jsonResponse({ status: "success", ...result });
    } catch (err) {
      if (err instanceof AnnotationValidationError) {
        return jsonResponse({ status: "error", error: err.message }, 422);
      }
      throw err;
    }
  }

  if (req.method === "DELETE") {
    return jsonResponse({
      status: "success",
      deleted: await deleteAnnotation(platform, date, filename),
    });
  }

  return null;
}
