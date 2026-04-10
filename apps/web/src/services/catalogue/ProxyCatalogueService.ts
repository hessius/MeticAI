/**
 * ProxyCatalogueService — CatalogueService implementation that delegates
 * to the MeticAI FastAPI backend.
 *
 * Used in Docker/proxy mode where the Python server handles profile
 * storage, sync, and catalogue enrichment.
 */

import { getServerUrl } from '@/lib/config'
import { apiFetch } from '@/services/api'
import type {
  CatalogueService,
  CatalogueProfile,
  SyncStatus,
  SyncResults,
} from './CatalogueService'
import type { Profile } from '@meticulous-home/espresso-profile'
import type { ProfileIdent } from '@meticulous-home/espresso-api'

// ---------------------------------------------------------------------------
// Backend response shapes
// ---------------------------------------------------------------------------

interface BackendMachineProfile {
  id: string
  name: string
  author?: string
  temperature?: number
  final_weight?: number
  in_history: boolean
  has_description: boolean
  user_preferences?: string | null
  display?: {
    description?: string
    shortDescription?: string
    accentColor?: string
    image?: string
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createProxyCatalogueService(): CatalogueService {
  return {
    name: 'ProxyCatalogueService',

    listProfiles: async (): Promise<CatalogueProfile[]> => {
      const base = await getServerUrl()
      const resp = await apiFetch<{ profiles: BackendMachineProfile[] }>(
        `${base}/api/machine/profiles`,
      )
      return (resp.profiles ?? []).map(p => ({
        id: p.id,
        name: p.name,
        author: p.author,
        temperature: p.temperature,
        finalWeight: p.final_weight,
        inHistory: p.in_history,
        hasDescription: p.has_description,
        userPreferences: p.user_preferences,
        display: p.display,
      }))
    },

    getProfileJson: async (id: string): Promise<Profile> => {
      const base = await getServerUrl()
      const resp = await apiFetch<{ profile: Profile }>(
        `${base}/api/machine/profile/${encodeURIComponent(id)}/json`,
      )
      return resp.profile
    },

    deleteProfile: async (id: string): Promise<void> => {
      const base = await getServerUrl()
      await apiFetch(
        `${base}/api/machine/profile/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      )
    },

    renameProfile: async (id: string, newName: string): Promise<void> => {
      const base = await getServerUrl()
      await apiFetch(
        `${base}/api/profile/${encodeURIComponent(id)}/edit`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName }),
        },
      )
    },

    importProfile: async (profile: Profile): Promise<ProfileIdent> => {
      const base = await getServerUrl()
      return apiFetch<ProfileIdent>(
        `${base}/api/profile/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(profile),
        },
      )
    },

    exportProfile: async (id: string): Promise<Blob> => {
      const base = await getServerUrl()
      return apiFetch<Blob>(
        `${base}/api/profiles/${encodeURIComponent(id)}/export`,
        { responseType: 'blob' },
      )
    },

    getProfileImageUrl: (id: string): string | null => {
      // In proxy mode we can't compute the URL synchronously since
      // getServerUrl is async. Return a relative path — the component
      // can resolve it later.
      return `/api/profile/${encodeURIComponent(id)}/image-proxy`
    },

    // -- Sync ---------------------------------------------------------------

    getSyncStatus: async (): Promise<SyncStatus | null> => {
      const base = await getServerUrl()
      try {
        const resp = await apiFetch<{
          stale_count: number
          stale_profiles: string[]
          last_sync_at: number | null
        }>(`${base}/api/profiles/sync/status`)
        return {
          staleCount: resp.stale_count ?? 0,
          staleProfiles: resp.stale_profiles ?? [],
          lastSyncAt: resp.last_sync_at,
        }
      } catch {
        return null
      }
    },

    syncProfiles: async (force = false): Promise<SyncResults | null> => {
      const base = await getServerUrl()
      try {
        const resp = await apiFetch<{
          synced: number
          failed: number
          skipped: number
          details: { name: string; status: string; error?: string }[]
        }>(`${base}/api/profiles/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ force }),
        })
        return {
          synced: resp.synced ?? 0,
          failed: resp.failed ?? 0,
          skipped: resp.skipped ?? 0,
          details: (resp.details ?? []).map(d => ({
            name: d.name,
            status: d.status as 'synced' | 'failed' | 'skipped',
            error: d.error,
          })),
        }
      } catch {
        return null
      }
    },

    hasSyncSupport: () => true,
  }
}
