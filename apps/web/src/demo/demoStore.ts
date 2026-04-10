/**
 * Shared demo data store — single source of truth for all demo services.
 *
 * All demo adapters (DemoAdapter, DemoShotDataService, DemoCatalogueService)
 * read from and write to this store so that simulated brews appear in history,
 * profile edits are consistent, etc.
 *
 * Uses demo-prefixed localStorage keys to prevent leaking into real mode.
 */

import type { Profile } from '@meticulous-home/espresso-profile'
import type { HistoryListingEntry, HistoryEntry, HistoryDataPoint, ShotRating } from '@meticulous-home/espresso-api'
import type { ShotAnnotation } from '@/services/shots/ShotDataService'
import { STORAGE_KEYS } from '@/lib/constants'
import { DEMO_PROFILES } from './demoProfiles'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DemoShotMeta {
  id: string
  dbKey: number
  time: number
  profileId: string
  profileName: string
  rating: ShotRating
}

// ---------------------------------------------------------------------------
// Seed data — 10 shots spread across demo profiles and recent days
// ---------------------------------------------------------------------------

function generateSeedShots(): DemoShotMeta[] {
  const now = Date.now()
  const day = 86_400_000
  const profiles = DEMO_PROFILES.slice(0, 4)
  const shots: DemoShotMeta[] = []

  for (let i = 0; i < 10; i++) {
    const profile = profiles[i % profiles.length]
    const daysAgo = Math.floor(i / 3)
    const hourOffset = (i % 3) * 3 + 7 // 7am, 10am, 1pm
    shots.push({
      id: `demo-shot-${String(i + 1).padStart(3, '0')}`,
      dbKey: 1000 + i,
      time: Math.floor((now - daysAgo * day + hourOffset * 3_600_000 - now % day) / 1000),
      profileId: profile.id,
      profileName: profile.name,
      rating: i === 0 ? 'like' : i === 3 ? 'dislike' : null,
    })
  }

  return shots.sort((a, b) => b.time - a.time)
}

// ---------------------------------------------------------------------------
// Sensor data generation — deterministic from shot ID
// ---------------------------------------------------------------------------

function simpleHash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function generateSensorData(shotId: string, durationSec = 30): HistoryDataPoint[] {
  const seed = simpleHash(shotId)
  const points: HistoryDataPoint[] = []
  const steps = durationSec * 10 // 100ms intervals

  for (let i = 0; i <= steps; i++) {
    const t = i / 10 // seconds
    const progress = t / durationSec

    // Realistic espresso curves with seed-based variation
    const variation = 1 + ((seed % 20) - 10) / 100
    const preinfusionEnd = 8 * variation
    const inPreinfusion = t < preinfusionEnd

    const pressure = inPreinfusion
      ? 3 * Math.min(t / 2, 1) * variation
      : 9 * Math.min((t - preinfusionEnd) / 3, 1) * variation * (1 - 0.15 * Math.max(0, progress - 0.7))

    const flow = inPreinfusion
      ? 1.5 * Math.min(t / 3, 1) * variation
      : (2 + 1.5 * Math.min((t - preinfusionEnd) / 5, 1)) * variation

    const weight = inPreinfusion
      ? flow * t * 0.3
      : Math.min(36 * variation, flow * (t - preinfusionEnd) * 0.6 + 3)

    const temp = 93 + ((seed % 5) - 2) * 0.3 + Math.sin(t / 5) * 0.2

    points.push({
      shot: {
        pressure: Math.max(0, +pressure.toFixed(2)),
        flow: Math.max(0, +flow.toFixed(2)),
        weight: Math.max(0, +weight.toFixed(1)),
        temperature: +temp.toFixed(1),
        gravimetric_flow: +(flow * 0.95).toFixed(2),
      },
      time: +(t * 1000).toFixed(0),
      status: inPreinfusion ? 'preinfusion' : 'brewing',
      sensors: {
        external_1: temp - 2,
        external_2: temp - 1,
        bar_up: temp + 0.5,
        bar_mid_up: temp,
        bar_mid_down: temp - 0.3,
        bar_down: temp - 0.8,
        tube: temp - 3,
        valve: temp - 5,
        motor_position: progress * 100,
        motor_speed: inPreinfusion ? 20 : 40,
        motor_power: pressure * 10,
        motor_current: pressure * 5,
        bandheater_power: 30 + Math.sin(t) * 5,
        preassure_sensor: pressure,
        adc_0: 0,
        adc_1: 0,
        adc_2: 0,
        adc_3: 0,
        water_status: true,
      },
    })
  }

  return points
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

class DemoStore {
  private profiles: Profile[]
  private shots: DemoShotMeta[]
  private annotations: Map<string, ShotAnnotation>

  constructor() {
    this.profiles = this.loadProfiles()
    this.shots = this.loadShots()
    this.annotations = this.loadAnnotations()
  }

  // -- Profiles --------------------------------------------------------------

  getProfiles(): Profile[] {
    return [...this.profiles]
  }

  getProfile(id: string): Profile | undefined {
    return this.profiles.find((p) => p.id === id)
  }

  saveProfile(profile: Profile): void {
    const idx = this.profiles.findIndex((p) => p.id === profile.id)
    if (idx >= 0) {
      this.profiles[idx] = profile
    } else {
      this.profiles.push(profile)
    }
    this.persistProfiles()
  }

  deleteProfile(id: string): void {
    this.profiles = this.profiles.filter((p) => p.id !== id)
    this.persistProfiles()
  }

  renameProfile(id: string, name: string): void {
    const p = this.profiles.find((pr) => pr.id === id)
    if (p) {
      p.name = name
      this.persistProfiles()
    }
  }

  // -- Shots -----------------------------------------------------------------

  getShotMeta(): DemoShotMeta[] {
    return [...this.shots]
  }

  getHistoryListing(): HistoryListingEntry[] {
    return this.shots.map((s) => this.metaToListing(s))
  }

  getShotData(shotId: string | number): HistoryEntry | null {
    const id = String(shotId)
    const meta = this.shots.find((s) => s.id === id || s.dbKey === Number(shotId))
    if (!meta) return null
    return {
      ...this.metaToListing(meta),
      data: generateSensorData(meta.id),
    }
  }

  addShot(meta: DemoShotMeta): void {
    this.shots.unshift(meta)
    this.persistShots()
  }

  // -- Annotations -----------------------------------------------------------

  getAnnotation(shotKey: string): ShotAnnotation | null {
    return this.annotations.get(shotKey) ?? null
  }

  setAnnotation(shotKey: string, data: Partial<Omit<ShotAnnotation, 'shotKey' | 'updatedAt'>>): void {
    const existing = this.annotations.get(shotKey) ?? {
      shotKey,
      rating: null,
      notes: '',
      tags: [],
      updatedAt: Date.now(),
    }
    this.annotations.set(shotKey, {
      ...existing,
      ...data,
      shotKey,
      updatedAt: Date.now(),
    })
    this.persistAnnotations()
  }

  getAllAnnotations(): ShotAnnotation[] {
    return Array.from(this.annotations.values())
  }

  // -- Persistence -----------------------------------------------------------

  private loadProfiles(): Profile[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.DEMO_PROFILES)
      if (stored) return JSON.parse(stored)
    } catch { /* use defaults */ }
    return [...DEMO_PROFILES]
  }

  private loadShots(): DemoShotMeta[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.DEMO_SHOTS)
      if (stored) return JSON.parse(stored)
    } catch { /* use defaults */ }
    return generateSeedShots()
  }

  private loadAnnotations(): Map<string, ShotAnnotation> {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.DEMO_ANNOTATIONS)
      if (stored) return new Map(JSON.parse(stored))
    } catch { /* use defaults */ }
    return new Map()
  }

  private persistProfiles(): void {
    try {
      localStorage.setItem(STORAGE_KEYS.DEMO_PROFILES, JSON.stringify(this.profiles))
    } catch { /* noop */ }
  }

  private persistShots(): void {
    try {
      localStorage.setItem(STORAGE_KEYS.DEMO_SHOTS, JSON.stringify(this.shots))
    } catch { /* noop */ }
  }

  private persistAnnotations(): void {
    try {
      localStorage.setItem(STORAGE_KEYS.DEMO_ANNOTATIONS, JSON.stringify([...this.annotations]))
    } catch { /* noop */ }
  }

  private metaToListing(meta: DemoShotMeta): HistoryListingEntry {
    const profile = this.getProfile(meta.profileId) ?? DEMO_PROFILES[0]
    return {
      id: meta.id,
      db_key: meta.dbKey,
      time: meta.time,
      file: null,
      name: meta.profileName,
      profile: { ...profile, db_key: meta.dbKey },
      rating: meta.rating,
      data: null,
    }
  }
}

// Singleton — created on first access (lazy)
let _instance: DemoStore | null = null

export function getDemoStore(): DemoStore {
  if (!_instance) _instance = new DemoStore()
  return _instance
}

export function resetDemoStore(): void {
  _instance = null
}
