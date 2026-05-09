/**
 * CatalogueService interface — abstraction for profile catalogue operations.
 *
 * Two implementations:
 * - **ProxyCatalogueService** — delegates to MeticAI backend
 * - **DirectCatalogueService** — uses MachineService + espresso-api
 */

import type { Profile } from '@meticulous-home/espresso-profile'
import type { ProfileIdent } from '@meticulous-home/espresso-api'

// Re-export for convenience
export type { Profile, ProfileIdent }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CatalogueProfile {
  id: string
  name: string
  author?: string
  temperature?: number
  finalWeight?: number
  /** Whether this profile has been used in a shot */
  inHistory: boolean
  /** Whether the profile has an AI-generated description */
  hasDescription: boolean
  userPreferences?: string | null
  display?: {
    description?: string
    shortDescription?: string
    accentColor?: string
    image?: string
  }
}

export interface SyncStatus {
  /** Profiles that need syncing */
  staleCount: number
  staleProfiles: string[]
  lastSyncAt: number | null
}

export interface SyncResults {
  synced: number
  failed: number
  skipped: number
  details: { name: string; status: 'synced' | 'failed' | 'skipped'; error?: string }[]
}

// ---------------------------------------------------------------------------
// Main Interface
// ---------------------------------------------------------------------------

export interface CatalogueService {
  readonly name: string

  /** List profiles with catalogue metadata */
  listProfiles(): Promise<CatalogueProfile[]>

  /** Get a profile's full JSON */
  getProfileJson(id: string): Promise<Profile>

  /** Delete a profile */
  deleteProfile(id: string): Promise<void>

  /** Rename a profile */
  renameProfile(id: string, newName: string): Promise<void>

  /** Import/save a profile */
  importProfile(profile: Profile): Promise<ProfileIdent>

  /** Export a profile as a JSON blob */
  exportProfile(id: string): Promise<Blob>

  /** Get a profile image URL (or null if not available) */
  getProfileImageUrl(id: string): string | null

  // -- Sync (proxy-only, no-ops in direct mode) ----------------------------

  /** Get sync status — returns null in direct mode */
  getSyncStatus(): Promise<SyncStatus | null>

  /** Trigger a sync — returns null in direct mode */
  syncProfiles(force?: boolean): Promise<SyncResults | null>

  /** Whether sync features are available */
  hasSyncSupport(): boolean
}
