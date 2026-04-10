/**
 * DemoShotDataService — ShotDataService implementation for demo mode.
 *
 * All data backed by the shared demoStore. Annotations persist in
 * demo-prefixed localStorage keys.
 */

import type { HistoryListingEntry, HistoryEntry, HistoryStats } from '@meticulous-home/espresso-api'
import type {
  ShotDataService,
  ShotAnnotation,
  ShotSearchOptions,
  ShotsByProfileResult,
} from './ShotDataService'
import { getDemoStore } from '@/demo/demoStore'

export function createDemoShotDataService(): ShotDataService {
  const store = getDemoStore()

  return {
    name: 'DemoShotDataService',

    async getHistoryListing(): Promise<HistoryListingEntry[]> {
      return store.getHistoryListing()
    },

    async searchHistory(options: ShotSearchOptions): Promise<HistoryEntry[]> {
      let listing = store.getHistoryListing()

      if (options.profileName) {
        listing = listing.filter((s) => s.name === options.profileName)
      }
      if (options.startDate) {
        const start = Math.floor(new Date(options.startDate).getTime() / 1000)
        listing = listing.filter((s) => s.time >= start)
      }
      if (options.endDate) {
        const end = Math.floor(new Date(options.endDate).getTime() / 1000)
        listing = listing.filter((s) => s.time <= end)
      }
      if (options.sort === 'asc') {
        listing = listing.sort((a, b) => a.time - b.time)
      }
      if (options.limit) {
        listing = listing.slice(options.offset ?? 0, (options.offset ?? 0) + options.limit)
      }

      // Attach sensor data if requested
      if (options.includeData) {
        return listing.map((entry) => {
          const full = store.getShotData(entry.id)
          return full ?? { ...entry, data: [] }
        })
      }

      return listing.map((entry) => ({ ...entry, data: [] }))
    },

    async getShotData(shotId: string | number): Promise<HistoryEntry | null> {
      return store.getShotData(shotId)
    },

    async getRecentShots(limit = 5): Promise<HistoryListingEntry[]> {
      return store.getHistoryListing().slice(0, limit)
    },

    async getShotsByProfile(profileName: string, options?: { limit?: number }): Promise<ShotsByProfileResult> {
      const all = store.getHistoryListing().filter((s) => s.name === profileName)
      const shots = options?.limit ? all.slice(0, options.limit) : all
      return { profileName, shots, count: all.length }
    },

    async getHistoryStats(): Promise<HistoryStats> {
      const listing = store.getHistoryListing()
      const byProfile = new Map<string, number>()
      for (const s of listing) {
        byProfile.set(s.name, (byProfile.get(s.name) ?? 0) + 1)
      }
      return {
        totalSavedShots: listing.length,
        byProfile: Array.from(byProfile).map(([name, count]) => ({
          name,
          count,
          profileVersions: 1,
        })),
      }
    },

    async getLastShot(): Promise<HistoryEntry | null> {
      const listing = store.getHistoryListing()
      if (listing.length === 0) return null
      return store.getShotData(listing[0].id)
    },

    async getAnnotation(shotKey: string): Promise<ShotAnnotation | null> {
      return store.getAnnotation(shotKey)
    },

    async setAnnotation(shotKey: string, data: Partial<Omit<ShotAnnotation, 'shotKey' | 'updatedAt'>>) {
      store.setAnnotation(shotKey, data)
    },

    async getAllAnnotations(): Promise<ShotAnnotation[]> {
      return store.getAllAnnotations()
    },

    async rateShot(/* shotId, rating */): Promise<void> {
      // No-op in demo — machine rating doesn't persist
    },
  }
}
