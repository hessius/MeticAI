/**
 * ShotDataService interface — abstraction for shot history, data, and annotations.
 *
 * Two implementations:
 * - **ProxyShotDataService** — delegates to MeticAI backend `/api/shots/*` endpoints
 * - **DirectShotDataService** — uses @meticulous-home/espresso-api + AppDatabase
 */

import type {
  HistoryListingEntry,
  HistoryEntry,
  HistoryDataPoint,
  HistoryStats,
  ShotRating,
} from '@meticulous-home/espresso-api'

// Re-export for convenience
export type { HistoryListingEntry, HistoryEntry, HistoryDataPoint, HistoryStats, ShotRating }

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ShotAnnotation {
  shotKey: string
  rating: number | null
  notes: string
  tags: string[]
  updatedAt: number
}

export interface ShotSearchOptions {
  profileName?: string
  limit?: number
  offset?: number
  startDate?: string
  endDate?: string
  sort?: 'asc' | 'desc'
  includeData?: boolean
}

export interface ShotsByProfileResult {
  profileName: string
  shots: HistoryListingEntry[]
  count: number
}

// ---------------------------------------------------------------------------
// Main Interface
// ---------------------------------------------------------------------------

export interface ShotDataService {
  readonly name: string

  /** List all shots (without sensor data) */
  getHistoryListing(): Promise<HistoryListingEntry[]>

  /** Search history with filters */
  searchHistory(options: ShotSearchOptions): Promise<HistoryEntry[]>

  /** Get a single shot with full sensor data by ID */
  getShotData(shotId: string | number): Promise<HistoryEntry | null>

  /** Get recent shots, optionally grouped by profile */
  getRecentShots(limit?: number): Promise<HistoryListingEntry[]>

  /** Get shots for a specific profile */
  getShotsByProfile(profileName: string, options?: { limit?: number }): Promise<ShotsByProfileResult>

  /** Get history statistics (total shots, by profile counts) */
  getHistoryStats(): Promise<HistoryStats>

  /** Get the last completed shot */
  getLastShot(): Promise<HistoryEntry | null>

  // -- Annotations ----------------------------------------------------------
  // Machine-native: like/dislike rating
  // MeticAI-extended: numeric rating, notes, tags (stored in AppDatabase)

  /** Get annotation for a shot (merged: machine rating + local notes/tags) */
  getAnnotation(shotKey: string): Promise<ShotAnnotation | null>

  /** Set annotation (writes to both machine and local storage as needed) */
  setAnnotation(shotKey: string, data: Partial<Omit<ShotAnnotation, 'shotKey' | 'updatedAt'>>): Promise<void>

  /** Get all annotations (for bulk display in history views) */
  getAllAnnotations(): Promise<ShotAnnotation[]>

  /** Rate a shot on the machine (like/dislike) */
  rateShot(shotId: number, rating: ShotRating): Promise<void>
}
