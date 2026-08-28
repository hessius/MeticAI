/**
 * History route family (unified, native semantics).
 *
 * `/api/history` is the espresso machine's shot log overlaid with a local store
 * of tombstones (hidden shots) and per-shot notes. This adopts the direct-mode
 * behaviour (see apps/web/src/services/interceptor/DirectModeInterceptor.ts):
 * the machine's history is immutable, so "delete" hides an entry locally and
 * notes are kept host-side. The overlay is persisted through
 * `platform.storage.history` (a singleton document); AI-generated profile
 * descriptions are read from `platform.storage.descriptions`.
 *
 * Routes:
 *   GET    /api/history                 -> paginated normalized entries
 *   DELETE /api/history                 -> tombstone all currently visible shots
 *   GET    /api/history/{id}            -> single normalized entry
 *   DELETE /api/history/{id}            -> tombstone one shot
 *   GET    /api/history/{id}/json       -> the entry's raw profile JSON
 *   GET    /api/history/{id}/notes      -> per-shot notes
 *   PATCH  /api/history/{id}/notes      -> upsert notes (PUT accepted too)
 */

import type { Platform } from "../platform";
import { jsonResponse } from "../http";
import { normalizeHistoryEntry } from "../logic/machineHistory";
import {
  descriptionFor,
  loadOverlay,
  loadVisibleHistory,
  notesFor,
  saveOverlay,
} from "../logic/historyStore";

function safeInt(value: string | null, fallback: number): number {
  if (value === null || value.trim() === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

const NOTES_RE = /^\/api\/history\/([^/]+)\/notes$/;
const JSON_RE = /^\/api\/history\/([^/]+)\/json$/;
const DETAIL_RE = /^\/api\/history\/([^/]+)$/;

export async function handleHistoryRoutes(
  req: Request,
  platform: Platform,
): Promise<Response | null> {
  const url = new URL(req.url);
  const { pathname } = url;
  const method = req.method;

  // /api/history/{id}/notes
  const notesMatch = pathname.match(NOTES_RE);
  if (notesMatch) {
    const id = decodeURIComponent(notesMatch[1]!);
    if (method === "GET") {
      const overlay = await loadOverlay(platform);
      return jsonResponse({ status: "success", ...notesFor(overlay, id) });
    }
    if (method === "PATCH" || method === "PUT") {
      let body: { notes?: string };
      try {
        body = (await req.json()) as { notes?: string };
      } catch {
        return jsonResponse({ detail: "Invalid JSON body" }, 400);
      }
      const overlay = await loadOverlay(platform);
      const notes_updated_at = new Date(platform.clock()).toISOString();
      const notes = body.notes ?? "";
      overlay.notes[id] = { notes, notes_updated_at };
      await saveOverlay(platform, overlay);
      return jsonResponse({ status: "success", notes, notes_updated_at });
    }
    return null;
  }

  // /api/history/{id}/json
  const jsonMatch = pathname.match(JSON_RE);
  if (jsonMatch && method === "GET") {
    const id = decodeURIComponent(jsonMatch[1]!);
    const { entries } = await loadVisibleHistory(platform);
    const entry = entries.find((e) => e.id === id);
    if (!entry) return jsonResponse({ detail: "History entry not found" }, 404);
    return jsonResponse(entry.profile ?? null);
  }

  // /api/history/{id}
  const detailMatch = pathname.match(DETAIL_RE);
  if (detailMatch) {
    const id = decodeURIComponent(detailMatch[1]!);
    if (method === "GET") {
      const { entries, overlay } = await loadVisibleHistory(platform);
      const entry = entries.find((e) => e.id === id);
      if (!entry) return jsonResponse({ detail: "History entry not found" }, 404);
      return jsonResponse(
        normalizeHistoryEntry(entry, notesFor(overlay, id), await descriptionFor(platform, entry)),
      );
    }
    if (method === "DELETE") {
      const { entries, overlay } = await loadVisibleHistory(platform);
      if (!entries.some((e) => e.id === id)) {
        return jsonResponse({ detail: "History entry not found" }, 404);
      }
      if (!overlay.tombstones.includes(id)) overlay.tombstones.push(id);
      delete overlay.notes[id];
      await saveOverlay(platform, overlay);
      return jsonResponse({ status: "success", message: "History entry deleted" });
    }
    return null;
  }

  // /api/history (collection)
  if (pathname === "/api/history") {
    if (method === "GET") {
      const limit = safeInt(url.searchParams.get("limit"), 50);
      const offset = safeInt(url.searchParams.get("offset"), 0);
      const { entries, overlay } = await loadVisibleHistory(platform);
      const page = entries.slice(offset, offset + limit);
      const normalized = await Promise.all(
        page.map(async (entry) =>
          normalizeHistoryEntry(
            entry,
            notesFor(overlay, entry.id),
            await descriptionFor(platform, entry),
          ),
        ),
      );
      return jsonResponse({ entries: normalized, total: entries.length, limit, offset });
    }
    if (method === "DELETE") {
      const { entries, overlay } = await loadVisibleHistory(platform);
      for (const entry of entries) {
        if (!overlay.tombstones.includes(entry.id)) overlay.tombstones.push(entry.id);
        delete overlay.notes[entry.id];
      }
      await saveOverlay(platform, overlay);
      return jsonResponse({ status: "success", message: "All history cleared" });
    }
    return null;
  }

  return null;
}
