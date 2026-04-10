/**
 * DemoCatalogueService — CatalogueService implementation for demo mode.
 *
 * Profile CRUD backed by the shared demoStore. No sync support (demo
 * has no real machine to sync with).
 */

import type { Profile } from '@meticulous-home/espresso-profile'
import type {
  CatalogueService,
  CatalogueProfile,
  SyncStatus,
  SyncResults,
} from './CatalogueService'
import type { ProfileIdent } from '@meticulous-home/espresso-api'
import { getDemoStore } from '@/demo/demoStore'

export function createDemoCatalogueService(): CatalogueService {
  const store = getDemoStore()

  function toCatalogueProfile(p: Profile): CatalogueProfile {
    return {
      id: p.id,
      name: p.name,
      author: p.author,
      temperature: p.temperature,
      finalWeight: p.final_weight,
      inHistory: store.getShotMeta().some((s) => s.profileId === p.id),
      hasDescription: !!p.display?.description,
      userPreferences: null,
      display: p.display ? {
        description: p.display.description,
        shortDescription: p.display.short_description,
        accentColor: p.display.accent_color,
        image: p.display.image,
      } : undefined,
    }
  }

  return {
    name: 'DemoCatalogueService',

    async listProfiles(): Promise<CatalogueProfile[]> {
      return store.getProfiles().map(toCatalogueProfile)
    },

    async getProfileJson(id: string): Promise<Profile> {
      const p = store.getProfile(id)
      if (!p) throw new Error(`Demo profile not found: ${id}`)
      return p
    },

    async deleteProfile(id: string) {
      store.deleteProfile(id)
    },

    async renameProfile(id: string, newName: string) {
      store.renameProfile(id, newName)
    },

    async importProfile(profile: Profile): Promise<ProfileIdent> {
      const newProfile = {
        ...profile,
        id: profile.id || `demo-import-${Date.now()}`,
      }
      store.saveProfile(newProfile)
      return { change_id: `demo-change-${newProfile.id}`, profile: newProfile }
    },

    async exportProfile(id: string): Promise<Blob> {
      const p = store.getProfile(id)
      if (!p) throw new Error(`Demo profile not found: ${id}`)
      return new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' })
    },

    getProfileImageUrl(/* id */): string | null {
      return null
    },

    async getSyncStatus(): Promise<SyncStatus | null> {
      return null
    },

    async syncProfiles(/* force */): Promise<SyncResults | null> {
      return null
    },

    hasSyncSupport(): boolean {
      return false
    },
  }
}
