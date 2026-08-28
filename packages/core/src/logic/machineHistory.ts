/**
 * Machine shot-history helpers (pure, host-free).
 *
 * The unified `/api/history` family adopts the native/direct-mode semantics:
 * history is the espresso machine's shot log (`/api/v1/history`), overlaid with
 * a local store of tombstones (hidden shots) and per-shot notes. These helpers
 * mirror the frontend oracle
 * (apps/web/src/services/interceptor/DirectModeInterceptor.ts) so the shape the
 * frontend consumes is identical on both hosts.
 */

/** A raw shot entry as returned by the machine's history API. */
export interface MachineHistoryEntry {
  id: string;
  time: number;
  name?: string;
  file?: string;
  profile?: Record<string, unknown>;
  data?: Array<{ shot?: { weight?: number }; time?: number; profile_time?: number }>;
}

/** Per-shot notes overlay. */
export interface HistoryNotes {
  notes: string | null;
  notes_updated_at: string | null;
}

/** The normalized history entry the frontend consumes (MeticAI format). */
export interface NormalizedHistoryEntry {
  id: string;
  created_at: string;
  profile_name: string;
  coffee_analysis: null;
  user_preferences: null;
  reply: string;
  profile_json: Record<string, unknown> | null;
  notes: string | null;
  notes_updated_at: string | null;
}

const EMPTY_NOTES: HistoryNotes = { notes: null, notes_updated_at: null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function historyProfileName(entry: MachineHistoryEntry): string {
  return typeof entry.profile?.name === "string" ? entry.profile.name : entry.name ?? "Unknown";
}

export function historyProfileId(entry: MachineHistoryEntry): string {
  return typeof entry.profile?.id === "string" ? entry.profile.id : entry.id;
}

export function historyEntryDate(entry: MachineHistoryEntry): string {
  return new Date(entry.time * 1000).toISOString().split("T")[0]!;
}

export function historyEntryFilename(entry: MachineHistoryEntry): string {
  return entry.file ?? `${entry.id}.json`;
}

export function historyMetrics(entry: MachineHistoryEntry): {
  final_weight: number | null;
  total_time: number | null;
} {
  const lastPoint = entry.data?.[entry.data.length - 1];
  const totalTimeMs = lastPoint?.profile_time ?? lastPoint?.time;
  const profileWeight = entry.profile?.final_weight;
  return {
    final_weight:
      lastPoint?.shot?.weight ?? (typeof profileWeight === "number" ? profileWeight : null),
    total_time: totalTimeMs ? totalTimeMs / 1000 : null,
  };
}

export function normalizeHistoryEntry(
  entry: MachineHistoryEntry,
  notes: HistoryNotes = EMPTY_NOTES,
  description = "",
): NormalizedHistoryEntry {
  return {
    id: entry.id,
    created_at: new Date(entry.time * 1000).toISOString(),
    profile_name: historyProfileName(entry),
    coffee_analysis: null,
    user_preferences: null,
    reply: description,
    profile_json: entry.profile ?? null,
    notes: notes.notes,
    notes_updated_at: notes.notes_updated_at,
  };
}

export function normalizeLastShot(entry: MachineHistoryEntry): {
  profile_name: string;
  date: string;
  filename: string;
  timestamp: number;
  final_weight: number | null;
  total_time: number | null;
} {
  return {
    profile_name: historyProfileName(entry),
    date: historyEntryDate(entry),
    filename: historyEntryFilename(entry),
    timestamp: entry.time,
    ...historyMetrics(entry),
  };
}

/** Coerce a machine history response (array or `{ history: [...] }`) into entries. */
export function parseMachineHistory(raw: unknown): MachineHistoryEntry[] {
  if (Array.isArray(raw)) return raw as MachineHistoryEntry[];
  if (isRecord(raw) && Array.isArray(raw.history)) return raw.history as MachineHistoryEntry[];
  return [];
}

/** Whether an annotation summary marks the shot as annotated (text or rating). */
export function hasRecentShotAnnotation(
  annotation?: { has_annotation: boolean; rating: number | null },
): boolean {
  return annotation !== undefined && (annotation.has_annotation || annotation.rating !== null);
}
