import { describe, it, expect, vi } from 'vitest'
import { pickGreeting } from './useSmartGreeting'
import type { HistoryStats, HistoryEntry } from '@meticulous-home/espresso-api'
import type { CatalogueProfile } from '@/services/catalogue/CatalogueService'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const t = vi.fn((key: string, opts?: Record<string, unknown>) =>
  `${key}${opts ? ':' + JSON.stringify(opts) : ''}`
)

function makeStats(total: number, byProfile: { name: string; count: number }[] = []): HistoryStats {
  return { totalSavedShots: total, byProfile: byProfile.map(p => ({ ...p, profileVersions: 1 })) }
}

function makeLastShot(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: '1',
    db_key: 1,
    time: Date.now() / 1000, // now
    file: '2026-04-14/shot_001.json',
    name: 'Test Shot',
    profile: { id: 'p1', name: 'Espresso Classic' } as HistoryEntry['profile'],
    data: [],
    ...overrides,
  }
}

function makeProfile(name: string, inHistory = true): CatalogueProfile {
  return { id: name.toLowerCase(), name, inHistory, hasDescription: false }
}

function baseCtx(overrides: Record<string, unknown> = {}) {
  return {
    t,
    stats: null as HistoryStats | null,
    lastShot: null as HistoryEntry | null,
    profiles: [] as CatalogueProfile[],
    minutesSinceLastShot: null as number | null,
    authorName: null as string | null,
    installDays: null as number | null,
    sessionCount: 1,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('pickGreeting', () => {
  it('returns null when no data is available', () => {
    expect(pickGreeting(baseCtx())).toBeNull()
  })

  it('rule 1: just brewed — triggers when < 15 min since last shot', () => {
    const result = pickGreeting(baseCtx({
      lastShot: makeLastShot(),
      minutesSinceLastShot: 5,
    }))
    expect(result).not.toBeNull()
    expect(t).toHaveBeenCalledWith('smartGreeting.justBrewed', expect.objectContaining({ profile: 'Espresso Classic' }))
    expect(result!.action?.target).toBe('shot-analysis')
  })

  it('rule 1: does NOT trigger at exactly 15 min', () => {
    const result = pickGreeting(baseCtx({
      lastShot: makeLastShot(),
      minutesSinceLastShot: 15,
      stats: makeStats(50), // ensure no milestone triggers
    }))
    // Should skip rule 1 — might match rule 6 (dial-in at 15-240 min) instead
    if (result) {
      expect(result.action?.target).not.toBe('shot-analysis')
    }
  })

  it('rule 2: milestone — triggers when close to round number', () => {
    const result = pickGreeting(baseCtx({
      stats: makeStats(47), // 3 away from 50
      minutesSinceLastShot: 60, // not recent enough for rule 1
    }))
    expect(result).not.toBeNull()
    expect(t).toHaveBeenCalledWith('smartGreeting.milestone', expect.objectContaining({
      count: 47,
      remaining: 3,
      milestone: 50,
    }))
  })

  it('rule 2: does NOT trigger when far from milestone', () => {
    const result = pickGreeting(baseCtx({
      stats: makeStats(30), // 20 away from 50 → not close enough (> 5)
      minutesSinceLastShot: null,
    }))
    // Should not return milestone greeting
    expect(result).toBeNull()
  })

  it('rule 3: long gap — triggers when > 12h since last shot', () => {
    const result = pickGreeting(baseCtx({
      stats: makeStats(100),
      minutesSinceLastShot: 15 * 60, // 15 hours
    }))
    expect(result).not.toBeNull()
    expect(t).toHaveBeenCalledWith('smartGreeting.longGap', expect.objectContaining({ hours: 15 }))
  })

  it('rule 4: unused profile — suggests a profile not in history', () => {
    const profiles = [
      makeProfile('Used Profile', true),
      makeProfile('Untried Blend', false),
    ]
    const result = pickGreeting(baseCtx({
      profiles,
      stats: makeStats(10, [{ name: 'Used Profile', count: 5 }]),
      minutesSinceLastShot: 6 * 60, // 6 hours — not long enough for rule 3
    }))
    expect(result).not.toBeNull()
    expect(t).toHaveBeenCalledWith('smartGreeting.unusedProfile', expect.objectContaining({ name: 'Untried Blend' }))
    expect(result!.action?.target).toBe('profile-catalogue')
  })

  it('rule 4: cross-references shot stats to find truly unused profiles', () => {
    // Profile says inHistory=false, but shot stats show it's been used
    const profiles = [makeProfile('Secret Blend', false)]
    const result = pickGreeting(baseCtx({
      profiles,
      stats: makeStats(10, [{ name: 'Secret Blend', count: 2 }]),
      minutesSinceLastShot: 6 * 60,
    }))
    // Secret Blend appears in stats → NOT unused → no unused profile greeting
    if (result) {
      // Should not be the unused profile message
      expect(result.message).not.toContain('unusedProfile')
    }
  })

  it('rule 5: anniversary — triggers every 10 days', () => {
    const result = pickGreeting(baseCtx({
      installDays: 30,
      stats: makeStats(10),
      minutesSinceLastShot: 6 * 60,
    }))
    expect(result).not.toBeNull()
    expect(t).toHaveBeenCalledWith('smartGreeting.anniversary', expect.objectContaining({ days: 30 }))
  })

  it('rule 5: does NOT trigger on non-10-day boundaries', () => {
    const result = pickGreeting(baseCtx({
      installDays: 13,
      stats: makeStats(10),
      minutesSinceLastShot: null,
    }))
    // installDays 13 → not divisible by 10, no profiles → null
    expect(result).toBeNull()
  })

  it('rule 6: dial-in — triggers 15min to 4h after shot', () => {
    const result = pickGreeting(baseCtx({
      stats: makeStats(100),
      minutesSinceLastShot: 90, // 1.5 hours
    }))
    expect(result).not.toBeNull()
    expect(t).toHaveBeenCalledWith('smartGreeting.dialIn')
    expect(result!.action?.target).toBe('dial-in')
  })

  it('rule 7: few profiles — nudge when < 3 profiles', () => {
    const result = pickGreeting(baseCtx({
      profiles: [makeProfile('Only One', true)],
      stats: makeStats(100),
      minutesSinceLastShot: null,
    }))
    expect(result).not.toBeNull()
    expect(t).toHaveBeenCalledWith('smartGreeting.fewProfiles', expect.objectContaining({ count: 1 }))
    expect(result!.action?.target).toBe('add-profile')
  })

  it('priority: rule 1 beats rule 2 (just brewed overrides milestone)', () => {
    const result = pickGreeting(baseCtx({
      lastShot: makeLastShot(),
      minutesSinceLastShot: 3,
      stats: makeStats(48), // 2 away from milestone
    }))
    expect(result).not.toBeNull()
    expect(t).toHaveBeenCalledWith('smartGreeting.justBrewed', expect.anything())
  })

  it('priority: rule 3 beats rule 4 (long gap overrides unused profile)', () => {
    const profiles = [makeProfile('Untried', false)]
    const result = pickGreeting(baseCtx({
      profiles,
      stats: makeStats(10),
      minutesSinceLastShot: 24 * 60, // 24 hours
    }))
    expect(result).not.toBeNull()
    expect(t).toHaveBeenCalledWith('smartGreeting.longGap', expect.anything())
  })
})
