/**
 * ProxyShotDataService — ShotDataService implementation that delegates
 * to the MeticAI FastAPI backend.
 *
 * Used in Docker/proxy mode where the Python server handles
 * shot data storage, analysis caching, and annotation persistence.
 */

import { getServerUrl } from '@/lib/config'
import { apiFetch } from '@/services/api'
import type {
  ShotDataService,
  ShotAnnotation,
  ShotSearchOptions,
  ShotsByProfileResult,
} from './ShotDataService'
import type {
  HistoryListingEntry,
  HistoryEntry,
  HistoryStats,
} from '@meticulous-home/espresso-api'

// ---------------------------------------------------------------------------
// Backend response shapes (may differ from espresso-api types)
// ---------------------------------------------------------------------------

interface BackendShotInfo {
  date: string
  filename: string
  timestamp: string | null
  profile_name: string
  final_weight: number | null
  total_time: number | null
}

interface BackendAnnotation {
  rating: number | null
  notes: string
  tags: string[]
}

// ---------------------------------------------------------------------------
// Helpers — map backend shapes to service types
// ---------------------------------------------------------------------------

function backendShotToListing(shot: BackendShotInfo, index: number): HistoryListingEntry {
  return {
    id: `${shot.date}/${shot.filename}`,
    db_key: index,
    time: shot.timestamp ? new Date(shot.timestamp).getTime() / 1000 : 0,
    file: shot.filename,
    name: shot.profile_name,
    profile: { name: shot.profile_name } as HistoryListingEntry['profile'],
    data: null,
  }
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createProxyShotDataService(): ShotDataService {
  return {
    name: 'ProxyShotDataService',

    getHistoryListing: async (): Promise<HistoryListingEntry[]> => {
      const base = await getServerUrl()
      const resp = await apiFetch<{ dates: string[] }>(`${base}/api/shots/dates`)
      return (resp.dates ?? []).map((d, i) => ({
        id: d,
        db_key: i,
        time: new Date(d).getTime() / 1000,
        file: null,
        name: d,
        profile: { name: '' } as HistoryListingEntry['profile'],
        data: null,
      }))
    },

    searchHistory: async (options: ShotSearchOptions): Promise<HistoryEntry[]> => {
      const base = await getServerUrl()
      const params = new URLSearchParams()
      if (options.limit) params.set('limit', String(options.limit))
      if (options.offset) params.set('offset', String(options.offset))

      if (options.profileName) {
        const resp = await apiFetch<{ shots: BackendShotInfo[] }>(
          `${base}/api/shots/by-profile/${encodeURIComponent(options.profileName)}?${params}`,
        )
        // Backend doesn't return full HistoryEntry data in listing — return as listing entries
        return (resp.shots ?? []).map((s, i) => ({
          ...backendShotToListing(s, i),
          data: [],
        }))
      }

      const resp = await apiFetch<{ shots: BackendShotInfo[] }>(
        `${base}/api/shots/recent?${params}`,
      )
      return (resp.shots ?? []).map((s, i) => ({
        ...backendShotToListing(s, i),
        data: [],
      }))
    },

    getShotData: async (shotId: string | number): Promise<HistoryEntry | null> => {
      const base = await getServerUrl()
      const idStr = String(shotId)
      // Backend expects date/filename format
      const parts = idStr.split('/')
      if (parts.length < 2) return null
      const [date, ...rest] = parts
      const filename = rest.join('/')
      try {
        const resp = await apiFetch<{ data: unknown }>(
          `${base}/api/shots/data/${date}/${encodeURIComponent(filename)}`,
        )
        return resp.data as HistoryEntry
      } catch {
        return null
      }
    },

    getRecentShots: async (limit = 20): Promise<HistoryListingEntry[]> => {
      const base = await getServerUrl()
      const resp = await apiFetch<{ shots: BackendShotInfo[] }>(
        `${base}/api/shots/recent?limit=${limit}&offset=0`,
      )
      return (resp.shots ?? []).map((s, i) => backendShotToListing(s, i))
    },

    getShotsByProfile: async (
      profileName: string,
      options?: { limit?: number },
    ): Promise<ShotsByProfileResult> => {
      const base = await getServerUrl()
      const limit = options?.limit ?? 50
      const resp = await apiFetch<{ profile_name: string; shots: BackendShotInfo[]; count: number }>(
        `${base}/api/shots/by-profile/${encodeURIComponent(profileName)}?limit=${limit}`,
      )
      return {
        profileName: resp.profile_name ?? profileName,
        shots: (resp.shots ?? []).map((s, i) => backendShotToListing(s, i)),
        count: resp.count ?? 0,
      }
    },

    getHistoryStats: async (): Promise<HistoryStats> => {
      // Backend doesn't have a dedicated stats endpoint; derive from recent shots
      const base = await getServerUrl()
      const resp = await apiFetch<{ shots: BackendShotInfo[] }>(
        `${base}/api/shots/recent?limit=500&offset=0`,
      )
      const shots = resp.shots ?? []
      const byProfile = new Map<string, number>()
      for (const s of shots) {
        byProfile.set(s.profile_name, (byProfile.get(s.profile_name) ?? 0) + 1)
      }
      return {
        totalSavedShots: shots.length,
        byProfile: Array.from(byProfile.entries()).map(([name, count]) => ({
          name,
          count,
          profileVersions: 1,
        })),
      }
    },

    getLastShot: async (): Promise<HistoryEntry | null> => {
      const base = await getServerUrl()
      try {
        const resp = await apiFetch<{ shots: BackendShotInfo[] }>(`${base}/api/shots/recent?limit=1`)
        const shot = resp.shots?.[0]
        if (!shot) return null
        return {
          ...backendShotToListing(shot, 0),
          data: [],
        }
      } catch {
        return null
      }
    },

    // -- Annotations --------------------------------------------------------

    getAnnotation: async (shotKey: string): Promise<ShotAnnotation | null> => {
      const base = await getServerUrl()
      const parts = shotKey.split('/')
      if (parts.length < 2) return null
      const [date, ...rest] = parts
      const filename = rest.join('/')
      try {
        const resp = await apiFetch<BackendAnnotation>(
          `${base}/api/shots/${encodeURIComponent(date)}/${encodeURIComponent(filename)}/annotation`,
        )
        return {
          shotKey,
          rating: resp.rating,
          notes: resp.notes ?? '',
          tags: resp.tags ?? [],
          updatedAt: Date.now(),
        }
      } catch {
        return null
      }
    },

    setAnnotation: async (
      shotKey: string,
      data: Partial<Omit<ShotAnnotation, 'shotKey' | 'updatedAt'>>,
    ): Promise<void> => {
      const base = await getServerUrl()
      const parts = shotKey.split('/')
      if (parts.length < 2) return
      const [date, ...rest] = parts
      const filename = rest.join('/')
      await apiFetch(
        `${base}/api/shots/${encodeURIComponent(date)}/${encodeURIComponent(filename)}/annotation`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
      )
    },

    getAllAnnotations: async (): Promise<ShotAnnotation[]> => {
      const base = await getServerUrl()
      try {
        const resp = await apiFetch<Record<string, BackendAnnotation>>(
          `${base}/api/shots/annotations`,
        )
        return Object.entries(resp).map(([key, a]) => ({
          shotKey: key,
          rating: a.rating,
          notes: a.notes ?? '',
          tags: a.tags ?? [],
          updatedAt: Date.now(),
        }))
      } catch {
        return []
      }
    },

    rateShot: async (/* shotId, rating */): Promise<void> => {
      // Backend doesn't expose machine-native rating — no-op in proxy mode.
      // Ratings are handled via the annotation system instead.
    },
  }
}
