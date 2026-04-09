/**
 * DirectCatalogueService — CatalogueService implementation that talks
 * directly to the Meticulous machine via @meticulous-home/espresso-api.
 *
 * In direct mode, the machine IS the source of truth for profiles.
 * Sync features are not applicable (no backend to sync with).
 */

import { getMachineApi } from '@/services/machine/machineApi'
import type {
  CatalogueService,
  CatalogueProfile,
  SyncStatus,
  SyncResults,
} from './CatalogueService'
import type { Profile } from '@meticulous-home/espresso-profile'
import type { ProfileIdent } from '@meticulous-home/espresso-api'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function unwrap<T>(response: { data: T }): T {
  return response.data
}

function identToCatalogueProfile(pi: ProfileIdent): CatalogueProfile {
  const p = pi.profile
  return {
    id: p.id ?? pi.change_id,
    name: p.name ?? 'Unnamed',
    author: p.author,
    temperature: p.temperature,
    finalWeight: p.final_weight,
    inHistory: false, // Not available from listing; would need history cross-reference
    hasDescription: !!(p.display as { description?: string })?.description,
    display: p.display as CatalogueProfile['display'],
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createDirectCatalogueService(baseUrl: string): CatalogueService {
  const api = getMachineApi(baseUrl)

  return {
    name: 'DirectCatalogueService',

    listProfiles: async (): Promise<CatalogueProfile[]> => {
      const profiles = unwrap(await api.listProfiles()) as ProfileIdent[]
      return profiles.map(identToCatalogueProfile)
    },

    getProfileJson: async (id: string): Promise<Profile> => {
      return unwrap(await api.getProfile(id)) as Profile
    },

    deleteProfile: async (id: string): Promise<void> => {
      await api.deleteProfile(id)
    },

    renameProfile: async (id: string, newName: string): Promise<void> => {
      // espresso-api doesn't have a dedicated rename endpoint.
      // Load the profile, change the name, save it back.
      const profile = unwrap(await api.getProfile(id)) as Profile
      profile.name = newName
      await api.saveProfile(profile)
    },

    importProfile: async (profile: Profile): Promise<ProfileIdent> => {
      return unwrap(await api.saveProfile(profile)) as ProfileIdent
    },

    exportProfile: async (id: string): Promise<Blob> => {
      const profile = unwrap(await api.getProfile(id)) as Profile
      const json = JSON.stringify(profile, null, 2)
      return new Blob([json], { type: 'application/json' })
    },

    getProfileImageUrl: (id: string): string | null => {
      // Machine serves profile images at a known path
      return api.getProfileImageUrl(id)
    },

    // -- Sync (not applicable in direct mode) --------------------------------

    getSyncStatus: async (): Promise<SyncStatus | null> => null,
    syncProfiles: async (): Promise<SyncResults | null> => null,
    hasSyncSupport: () => false,
  }
}
