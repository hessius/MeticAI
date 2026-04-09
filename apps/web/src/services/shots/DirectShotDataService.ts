/**
 * DirectShotDataService — ShotDataService implementation that talks
 * directly to the Meticulous machine via @meticulous-home/espresso-api.
 *
 * Used in machine-hosted PWA and Capacitor app modes.
 *
 * Shot annotations (notes, tags, numeric ratings) are stored in
 * AppDatabase (IndexedDB). Machine-native ratings (like/dislike)
 * are synced to the machine via the espresso-api.
 */

import { getMachineApi } from '@/services/machine/machineApi'
import {
  getAnnotation as dbGetAnnotation,
  setAnnotation as dbSetAnnotation,
  getAllAnnotations as dbGetAllAnnotations,
} from '@/services/storage/AppDatabase'
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
  ShotRating,
} from '@meticulous-home/espresso-api'

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function unwrap<T>(response: { data: T }): T {
  return response.data
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createDirectShotDataService(baseUrl: string): ShotDataService {
  const api = getMachineApi(baseUrl)

  return {
    name: 'DirectShotDataService',

    getHistoryListing: async (): Promise<HistoryListingEntry[]> => {
      const resp = unwrap(await api.getHistoryShortListing())
      return resp.history ?? []
    },

    searchHistory: async (options: ShotSearchOptions): Promise<HistoryEntry[]> => {
      const resp = unwrap(await api.searchHistory({
        query: options.profileName ?? '',
        ids: [],
        start_date: options.startDate ?? '',
        end_date: options.endDate ?? '',
        order_by: ['date'],
        sort: options.sort ?? 'desc',
        max_results: options.limit ?? 50,
        dump_data: options.includeData ?? true,
      }))
      return resp.history ?? []
    },

    getShotData: async (shotId: string | number): Promise<HistoryEntry | null> => {
      try {
        const resp = unwrap(await api.searchHistory({
          query: '',
          ids: [shotId],
          start_date: '',
          end_date: '',
          order_by: ['date'],
          sort: 'desc',
          max_results: 1,
          dump_data: true,
        }))
        return resp.history?.[0] ?? null
      } catch {
        return null
      }
    },

    getRecentShots: async (limit = 20): Promise<HistoryListingEntry[]> => {
      const resp = unwrap(await api.getHistoryShortListing())
      const history = resp.history ?? []
      // Sort by time descending and limit
      return history
        .sort((a, b) => b.time - a.time)
        .slice(0, limit)
    },

    getShotsByProfile: async (
      profileName: string,
      options?: { limit?: number },
    ): Promise<ShotsByProfileResult> => {
      const resp = unwrap(await api.searchHistory({
        query: profileName,
        ids: [],
        start_date: '',
        end_date: '',
        order_by: ['date'],
        sort: 'desc',
        max_results: options?.limit ?? 50,
        dump_data: false,
      }))
      // Filter to exact profile name match
      const shots = (resp.history ?? []).filter(
        s => s.profile?.name === profileName || s.name === profileName,
      )
      return {
        profileName,
        shots: shots.map(s => ({ ...s, data: null }) as HistoryListingEntry),
        count: shots.length,
      }
    },

    getHistoryStats: async (): Promise<HistoryStats> => {
      return unwrap(await api.getHistoryStatistics())
    },

    getLastShot: async (): Promise<HistoryEntry | null> => {
      try {
        return unwrap(await api.getLastShot())
      } catch {
        return null
      }
    },

    // -- Annotations --------------------------------------------------------

    getAnnotation: async (shotKey: string): Promise<ShotAnnotation | null> => {
      const local = await dbGetAnnotation(shotKey)
      if (!local) return null
      return {
        shotKey: local.shotKey,
        rating: local.rating,
        notes: local.notes,
        tags: local.tags,
        updatedAt: local.updatedAt,
      }
    },

    setAnnotation: async (
      shotKey: string,
      data: Partial<Omit<ShotAnnotation, 'shotKey' | 'updatedAt'>>,
    ): Promise<void> => {
      await dbSetAnnotation(shotKey, {
        rating: data.rating,
        notes: data.notes,
        tags: data.tags,
      })
    },

    getAllAnnotations: async (): Promise<ShotAnnotation[]> => {
      const all = await dbGetAllAnnotations()
      return all.map(a => ({
        shotKey: a.shotKey,
        rating: a.rating,
        notes: a.notes,
        tags: a.tags,
        updatedAt: a.updatedAt,
      }))
    },

    rateShot: async (shotId: number, rating: ShotRating): Promise<void> => {
      await api.rateShot(shotId, rating)
    },
  }
}
