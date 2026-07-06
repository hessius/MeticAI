/**
 * Machine profile-list helpers (pure, host-free).
 *
 * Normalises the machine's `/api/v1/profile/list` payload into the catalogue
 * shape the frontend consumes, and strips cache-only metadata before saving a
 * profile back to the machine. Ported from
 * apps/web/src/services/interceptor/DirectModeInterceptor.ts.
 */

import { deriveStructuralTags, type AnalyzableProfile } from "./profileAnalysis";

export interface MachineProfile {
  id: string;
  name: string;
  author?: string;
  temperature?: number;
  final_weight?: number;
  image?: string;
  display?: {
    image?: string;
    accentColor?: string;
    description?: string;
    shortDescription?: string;
    [key: string]: unknown;
  };
  stages?: unknown[];
  variables?: unknown[];
  change_id?: string;
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Coerce a raw list entry (possibly wrapped in `{ profile }`) into a MachineProfile. */
export function normalizeProfileIdent(value: unknown): MachineProfile | null {
  if (!isRecord(value)) return null;
  const nestedProfile = isRecord(value.profile) ? value.profile : value;
  const id = nestedProfile.id;
  const name = nestedProfile.name;
  if (typeof id !== "string" || typeof name !== "string") return null;
  const normalized: MachineProfile = { ...nestedProfile, id, name };
  if (typeof value.change_id === "string") normalized.change_id = value.change_id;
  return normalized;
}

/** Strip cache-only metadata that the machine's profile schema rejects on save. */
export function stripProfileMetadata(profile: Record<string, unknown>): Record<string, unknown> {
  const machineProfile: Record<string, unknown> = { ...profile };
  delete machineProfile.change_id;
  delete machineProfile.in_history;
  delete machineProfile.has_description;
  return machineProfile;
}

/** Resolve the profile image path, preferring the display image. */
export function profileImagePath(profile: MachineProfile): string | undefined {
  if (typeof profile.display?.image === "string" && profile.display.image.trim()) {
    return profile.display.image;
  }
  if (typeof profile.image === "string" && profile.image.trim()) {
    return profile.image;
  }
  return undefined;
}

/**
 * Normalise a raw machine profile list into the catalogue result. `aiTagsFor`
 * supplies the per-profile AI sensory tags (empty array when none).
 */
export function buildProfileListResult(
  raw: unknown[],
  aiTagsFor: (name: string) => string[],
): { profiles: MachineProfile[] } {
  const profiles = raw
    .map(normalizeProfileIdent)
    .filter((profile): profile is MachineProfile => profile !== null);
  return {
    profiles: profiles.map((p) => ({
      ...p,
      in_history: true,
      has_description: !!(p.display?.description || p.display?.shortDescription),
      derived_tags: deriveStructuralTags(p as unknown as AnalyzableProfile),
      ai_tags: aiTagsFor(p.name),
    })),
  };
}
