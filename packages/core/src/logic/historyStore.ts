/**
 * Shared machine-history store access (Platform-coupled, host-free).
 *
 * The `/api/history` and machine `/api/shots/*` read families both need the
 * espresso machine's shot log overlaid with the local tombstone/notes store.
 * This module centralises loading the machine history, the local overlay, and
 * the per-shot notes + AI descriptions so the history and shots route families
 * stay byte-identical (mirrors
 * apps/web/src/services/interceptor/DirectModeInterceptor.ts).
 */

import type { Platform, Repo } from "../platform";
import {
  type HistoryNotes,
  type MachineHistoryEntry,
  parseMachineHistory,
} from "./machineHistory";

export const OVERLAY_KEY = "history";

export interface HistoryOverlay {
  tombstones: string[];
  notes: Record<string, HistoryNotes>;
}

function overlayRepo(platform: Platform): Repo<HistoryOverlay> {
  return platform.storage.history as Repo<HistoryOverlay>;
}

export async function loadOverlay(platform: Platform): Promise<HistoryOverlay> {
  const stored = await overlayRepo(platform).read(OVERLAY_KEY);
  return {
    tombstones: Array.isArray(stored?.tombstones) ? stored!.tombstones : [],
    notes: stored?.notes && typeof stored.notes === "object" ? stored.notes : {},
  };
}

export async function saveOverlay(platform: Platform, overlay: HistoryOverlay): Promise<void> {
  await overlayRepo(platform).write(OVERLAY_KEY, overlay);
}

/** Fetch the full machine history (search endpoint, falling back to the short list). */
export async function loadMachineHistory(platform: Platform): Promise<MachineHistoryEntry[]> {
  try {
    const search = await platform.machine.fetch("/api/v1/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: "",
        ids: [],
        start_date: "",
        end_date: "",
        order_by: ["date"],
        sort: "desc",
        max_results: 1000,
        dump_data: false,
      }),
    });
    if (search.ok) {
      return parseMachineHistory(await search.json());
    }
  } catch {
    /* fall through to the short-listing */
  }
  try {
    const res = await platform.machine.fetch("/api/v1/history");
    if (!res.ok) return [];
    return parseMachineHistory(await res.json());
  } catch {
    return [];
  }
}

export async function loadVisibleHistory(platform: Platform): Promise<{
  entries: MachineHistoryEntry[];
  overlay: HistoryOverlay;
}> {
  const [entries, overlay] = await Promise.all([
    loadMachineHistory(platform),
    loadOverlay(platform),
  ]);
  const hidden = new Set(overlay.tombstones);
  return { entries: entries.filter((e) => !hidden.has(e.id)), overlay };
}

export async function descriptionFor(
  platform: Platform,
  entry: MachineHistoryEntry,
): Promise<string> {
  const name = typeof entry.profile?.name === "string" ? entry.profile.name : entry.name ?? "";
  const id = typeof entry.profile?.id === "string" ? entry.profile.id : "";
  const byName = name ? await platform.storage.descriptions.read(name) : null;
  if (byName) return byName;
  const byId = id ? await platform.storage.descriptions.read(id) : null;
  return byId ?? "";
}

export function notesFor(overlay: HistoryOverlay, id: string): HistoryNotes {
  const stored = overlay.notes[id];
  return { notes: stored?.notes ?? null, notes_updated_at: stored?.notes_updated_at ?? null };
}
