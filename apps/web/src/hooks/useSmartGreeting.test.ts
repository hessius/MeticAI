import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  pickGreeting,
  countShotsToday,
  getRecentProfiles,
  getConsecutiveSameProfile,
  getConsecutiveDays,
  findConsistentBrewTime,
  logGreeting,
  GREETING_RULES,
} from './useSmartGreeting'
import type { GreetingContext } from './useSmartGreeting'
import type { HistoryStats, HistoryEntry, HistoryListingEntry } from '@meticulous-home/espresso-api'
import type { CatalogueProfile } from '@/services/catalogue/CatalogueService'

// ---------------------------------------------------------------------------
// localStorage mock
// ---------------------------------------------------------------------------

const localStorageMock = (() => {
  let store: Record<string, string> = {}
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value }),
    removeItem: vi.fn((key: string) => { delete store[key] }),
    clear: vi.fn(() => { store = {} }),
    reset: () => { store = {} },
  }
})()

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
    time: Date.now() / 1000,
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

function makeRecentShot(overrides: Partial<HistoryListingEntry> = {}): HistoryListingEntry {
  return {
    id: String(Math.random()),
    db_key: null,
    time: Date.now() / 1000,
    file: null,
    name: 'Shot',
    profile: { id: 'p1', name: 'Default' } as HistoryListingEntry['profile'],
    data: null,
    ...overrides,
  }
}

/** Creates N shots spread across consecutive days at a given hour */
function makeDailyShots(days: number, hour = 8): HistoryListingEntry[] {
  const shots: HistoryListingEntry[] = []
  const now = new Date()
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    d.setHours(hour, 0, 0, 0)
    shots.push(makeRecentShot({ time: d.getTime() / 1000, name: `Day ${i}` }))
  }
  return shots
}

function baseCtx(overrides: Partial<GreetingContext> = {}): GreetingContext {
  return {
    t,
    stats: null,
    lastShot: null,
    profiles: [],
    minutesSinceLastShot: null,
    authorName: null,
    installDays: null,
    sessionCount: 1,
    recentShots: [],
    shotsToday: 1,           // avoid triggering morning/firstShot rules
    recentProfiles: [],
    consecutiveSameProfile: null,
    consecutiveDays: 0,
    hour: 16,                // outside all time-of-day rule windows
    dayOfWeek: 3,            // Wednesday — not Mon/Fri/Weekend
    lastGreetingId: null,
    personalBestShotsDay: 100, // avoid triggering personalBestDay
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Derived data helper tests
// ---------------------------------------------------------------------------

describe('countShotsToday', () => {
  it('counts shots from today only', () => {
    const now = Date.now() / 1000
    const yesterday = now - 25 * 60 * 60
    const shots = [
      makeRecentShot({ time: now - 60 }),       // today
      makeRecentShot({ time: now - 3600 }),      // today
      makeRecentShot({ time: yesterday }),       // yesterday
    ]
    expect(countShotsToday(shots)).toBe(2)
  })

  it('returns 0 for empty array', () => {
    expect(countShotsToday([])).toBe(0)
  })
})

describe('getRecentProfiles', () => {
  it('returns unique profile names from last 7 days', () => {
    const now = Date.now() / 1000
    const shots = [
      makeRecentShot({ time: now, profile: { name: 'Alpha' } as HistoryListingEntry['profile'] }),
      makeRecentShot({ time: now, profile: { name: 'Beta' } as HistoryListingEntry['profile'] }),
      makeRecentShot({ time: now, profile: { name: 'Alpha' } as HistoryListingEntry['profile'] }),
      makeRecentShot({ time: now - 8 * 24 * 3600, profile: { name: 'Old' } as HistoryListingEntry['profile'] }),
    ]
    const result = getRecentProfiles(shots)
    expect(result).toContain('Alpha')
    expect(result).toContain('Beta')
    expect(result).not.toContain('Old')
    expect(result.length).toBe(2)
  })
})

describe('getConsecutiveSameProfile', () => {
  it('detects consecutive same-profile shots', () => {
    const shots = [
      makeRecentShot({ profile: { name: 'X' } as HistoryListingEntry['profile'] }),
      makeRecentShot({ profile: { name: 'X' } as HistoryListingEntry['profile'] }),
      makeRecentShot({ profile: { name: 'X' } as HistoryListingEntry['profile'] }),
      makeRecentShot({ profile: { name: 'Y' } as HistoryListingEntry['profile'] }),
    ]
    expect(getConsecutiveSameProfile(shots)).toEqual({ name: 'X', count: 3 })
  })

  it('returns null when fewer than 2 shots', () => {
    expect(getConsecutiveSameProfile([makeRecentShot()])).toBeNull()
  })

  it('returns null when no consecutive duplicates', () => {
    const shots = [
      makeRecentShot({ profile: { name: 'A' } as HistoryListingEntry['profile'] }),
      makeRecentShot({ profile: { name: 'B' } as HistoryListingEntry['profile'] }),
    ]
    // count is 1, which is < 2, so null
    expect(getConsecutiveSameProfile(shots)).toBeNull()
  })
})

describe('getConsecutiveDays', () => {
  it('counts consecutive days from today', () => {
    expect(getConsecutiveDays(makeDailyShots(5))).toBe(5)
  })

  it('returns 0 for empty array', () => {
    expect(getConsecutiveDays([])).toBe(0)
  })

  it('breaks on gap days', () => {
    const now = new Date()
    const shots = [
      makeRecentShot({ time: now.getTime() / 1000 }),  // today
      // skip yesterday
      makeRecentShot({ time: (now.getTime() / 1000) - 2 * 24 * 3600 }), // 2 days ago
    ]
    expect(getConsecutiveDays(shots)).toBe(1) // only today
  })
})

describe('findConsistentBrewTime', () => {
  it('finds consistent time when 5+ days at same hour', () => {
    const shots = makeDailyShots(7, 7) // all at 7 AM
    const result = findConsistentBrewTime(shots)
    expect(result).not.toBeNull()
    expect(result!.hour).toBe(7)
    expect(result!.days).toBeGreaterThanOrEqual(5)
  })

  it('returns null with fewer than 5 days', () => {
    expect(findConsistentBrewTime(makeDailyShots(3))).toBeNull()
  })

  it('returns null when times vary widely', () => {
    const shots: HistoryListingEntry[] = []
    const now = new Date()
    const hours = [6, 10, 14, 18, 22]
    hours.forEach((h, i) => {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      d.setHours(h, 0, 0, 0)
      shots.push(makeRecentShot({ time: d.getTime() / 1000 }))
    })
    expect(findConsistentBrewTime(shots)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Existing rule tests (migrated to new context shape)
// ---------------------------------------------------------------------------

describe('pickGreeting', () => {
  beforeEach(() => {
    t.mockClear()
  })

  it('returns null when no data is available', () => {
    expect(pickGreeting(baseCtx())).toBeNull()
  })

  // --- Original 7 rules ---

  it('rule: justBrewed — triggers when < 15 min since last shot', () => {
    const result = pickGreeting(baseCtx({
      lastShot: makeLastShot(),
      minutesSinceLastShot: 5,
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('justBrewed')
    expect(result!.action?.target).toBe('shot-analysis')
  })

  it('rule: justBrewed — does NOT trigger at exactly 15 min', () => {
    const result = pickGreeting(baseCtx({
      lastShot: makeLastShot(),
      minutesSinceLastShot: 15,
      stats: makeStats(50),
    }))
    if (result) {
      expect(result.id).not.toBe('justBrewed')
    }
  })

  it('rule: milestone — triggers when close to round number', () => {
    const result = pickGreeting(baseCtx({
      stats: makeStats(47),
      minutesSinceLastShot: 60,
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('milestone')
    expect(t).toHaveBeenCalledWith('smartGreeting.milestone', expect.objectContaining({
      count: 47, remaining: 3, milestone: 50,
    }))
  })

  it('rule: longGap — triggers when > 12h since last shot', () => {
    const result = pickGreeting(baseCtx({
      stats: makeStats(110),
      minutesSinceLastShot: 15 * 60,
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('longGap')
  })

  it('rule: unusedProfile — suggests a profile not in history', () => {
    const profiles = [
      makeProfile('Used Profile', true),
      makeProfile('Untried Blend', false),
    ]
    const result = pickGreeting(baseCtx({
      profiles,
      stats: makeStats(10, [
        { name: 'Used Profile', count: 3 },
        { name: 'Other', count: 4 },
      ]),
      recentProfiles: ['Used Profile', 'Other'],
      minutesSinceLastShot: 6 * 60,
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('unusedProfile')
    expect(result!.action?.target).toBe('profile-catalogue')
  })

  it('rule: anniversary — triggers every 10 days', () => {
    const result = pickGreeting(baseCtx({
      installDays: 20,
      stats: makeStats(10),
      minutesSinceLastShot: 6 * 60,
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('anniversary')
  })

  it('rule: dialIn — triggers 15min to 4h after shot', () => {
    const result = pickGreeting(baseCtx({
      stats: makeStats(110),
      minutesSinceLastShot: 90,
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('dialIn')
    expect(result!.action?.target).toBe('dial-in')
  })

  it('rule: fewProfiles — nudge when < 3 profiles', () => {
    const result = pickGreeting(baseCtx({
      profiles: [makeProfile('Only One', true)],
      stats: makeStats(110),
      minutesSinceLastShot: null,
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('fewProfiles')
    expect(result!.action?.target).toBe('add-profile')
  })

  // --- New time-of-day rules ---

  it('rule: lateNight — triggers after 10 PM', () => {
    const result = pickGreeting(baseCtx({ hour: 23 }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('lateNight')
  })

  it('rule: lateNight — does NOT trigger before 10 PM', () => {
    const result = pickGreeting(baseCtx({ hour: 21 }))
    if (result) expect(result.id).not.toBe('lateNight')
  })

  it('rule: earlyBird — triggers before 6 AM', () => {
    const result = pickGreeting(baseCtx({ hour: 4 }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('earlyBird')
  })

  it('rule: earlyBird — does NOT trigger at 6 AM', () => {
    const result = pickGreeting(baseCtx({ hour: 6 }))
    if (result) expect(result.id).not.toBe('earlyBird')
  })

  it('rule: morningRitual — triggers 6-9 AM with no shots today', () => {
    const result = pickGreeting(baseCtx({ hour: 7, shotsToday: 0 }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('morningRitual')
  })

  it('rule: morningRitual — does NOT trigger if shots today > 0', () => {
    const result = pickGreeting(baseCtx({ hour: 7, shotsToday: 1 }))
    if (result) expect(result.id).not.toBe('morningRitual')
  })

  it('rule: firstShotOfDay — triggers 9-12 AM with no shots today', () => {
    const result = pickGreeting(baseCtx({ hour: 10, shotsToday: 0 }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('firstShotOfDay')
  })

  it('rule: postLunch — triggers 1-3 PM', () => {
    const result = pickGreeting(baseCtx({ hour: 14 }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('postLunch')
  })

  it('rule: weekendMorning — triggers Sat/Sun before noon', () => {
    const result = pickGreeting(baseCtx({ dayOfWeek: 6, hour: 9, shotsToday: 1 }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('weekendMorning')
  })

  it('rule: weekendMorning — does NOT trigger on weekdays', () => {
    const result = pickGreeting(baseCtx({ dayOfWeek: 3, hour: 9 }))
    if (result) expect(result.id).not.toBe('weekendMorning')
  })

  // --- Shot pattern rules ---

  it('rule: doubleShot — triggers when 2 shots within 30 min', () => {
    const now = Date.now() / 1000
    const result = pickGreeting(baseCtx({
      minutesSinceLastShot: 20,
      recentShots: [
        makeRecentShot({ time: now - 20 * 60 }),
        makeRecentShot({ time: now - 30 * 60 }),
      ],
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('doubleShot')
  })

  it('rule: doubleShot — does NOT trigger when gap > 30 min', () => {
    const now = Date.now() / 1000
    const result = pickGreeting(baseCtx({
      minutesSinceLastShot: 20,
      recentShots: [
        makeRecentShot({ time: now - 20 * 60 }),
        makeRecentShot({ time: now - 60 * 60 }),
      ],
    }))
    if (result) expect(result.id).not.toBe('doubleShot')
  })

  it('rule: dailyStreak — triggers at 3+ consecutive days', () => {
    const result = pickGreeting(baseCtx({ consecutiveDays: 5 }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('dailyStreak')
    expect(t).toHaveBeenCalledWith('smartGreeting.dailyStreak', expect.objectContaining({ days: 5 }))
  })

  it('rule: dailyStreak — does NOT trigger at 2 days', () => {
    const result = pickGreeting(baseCtx({ consecutiveDays: 2 }))
    if (result) expect(result.id).not.toBe('dailyStreak')
  })

  it('rule: backToBack — triggers with 3+ same-profile shots', () => {
    const result = pickGreeting(baseCtx({
      profiles: [makeProfile('Turbo Shot'), makeProfile('Other')],
      consecutiveSameProfile: { name: 'Turbo Shot', count: 4 },
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('backToBack')
  })

  it('rule: varietyExplorer — triggers with 3+ recent profiles', () => {
    const result = pickGreeting(baseCtx({
      recentProfiles: ['A', 'B', 'C'],
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('varietyExplorer')
    expect(result!.action?.target).toBe('profile-catalogue')
  })

  it('rule: shotCountToday — triggers with 3+ shots today', () => {
    const result = pickGreeting(baseCtx({ shotsToday: 4 }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('shotCountToday')
    expect(result!.action?.target).toBe('shot-history')
  })

  it('rule: powerUser — triggers with 5+ shots today', () => {
    const result = pickGreeting(baseCtx({ shotsToday: 6, personalBestShotsDay: 100 }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('powerUser')
  })

  // --- Profile rules ---

  it('rule: neglectedFavorite — triggers when top profile not in recent week', () => {
    const result = pickGreeting(baseCtx({
      stats: makeStats(55, [
        { name: 'Old Favorite', count: 20 },
        { name: 'Other', count: 20 },
        { name: 'Third', count: 15 },
      ]),
      recentProfiles: ['Other', 'Third'],
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('neglectedFavorite')
  })

  it('rule: profileCollector — triggers with 10+ profiles', () => {
    const profiles = Array.from({ length: 12 }, (_, i) => makeProfile(`Profile ${i}`, true))
    const result = pickGreeting(baseCtx({ profiles }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('profileCollector')
  })

  it('rule: singleProfileUser — triggers with 1 profile + 4+ consecutive', () => {
    const result = pickGreeting(baseCtx({
      profiles: [makeProfile('Solo')],
      consecutiveSameProfile: { name: 'Solo', count: 5 },
      recentProfiles: ['Solo'],
      shotsToday: 1,
      hour: 16,
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('singleProfileUser')
  })

  // --- Milestone / achievement rules ---

  it('rule: milestoneHit — triggers at exact round numbers', () => {
    for (const count of [50, 100, 200, 500, 1000]) {
      const result = pickGreeting(baseCtx({ stats: makeStats(count) }))
      expect(result).not.toBeNull()
      expect(result!.id).toBe('milestoneHit')
    }
  })

  it('rule: milestoneHit — does NOT trigger at 51', () => {
    const result = pickGreeting(baseCtx({ stats: makeStats(51) }))
    if (result) expect(result.id).not.toBe('milestoneHit')
  })

  it('rule: personalBestDay — triggers when shotsToday beats record', () => {
    const result = pickGreeting(baseCtx({ shotsToday: 5, personalBestShotsDay: 3 }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('personalBestDay')
  })

  it('rule: personalBestDay — does NOT trigger when not beating record', () => {
    const result = pickGreeting(baseCtx({ shotsToday: 3, personalBestShotsDay: 5 }))
    if (result) expect(result.id).not.toBe('personalBestDay')
  })

  it('rule: firstWeek — triggers at exactly 7 install days', () => {
    const result = pickGreeting(baseCtx({ installDays: 7 }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('firstWeek')
  })

  it('rule: oneMonth — triggers at exactly 30 install days', () => {
    // anniversary triggers at 30 (30 % 10 === 0), but firstWeek (7) and oneMonth (30) have higher priority
    const result = pickGreeting(baseCtx({ installDays: 30, stats: makeStats(10) }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('oneMonth')
  })

  // --- Calendar rules ---

  it('rule: friday — triggers on Friday', () => {
    const result = pickGreeting(baseCtx({ dayOfWeek: 5, hour: 15 }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('friday')
  })

  it('rule: mondayMotivation — triggers on Monday', () => {
    const result = pickGreeting(baseCtx({ dayOfWeek: 1, hour: 15 }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('mondayMotivation')
  })

  // --- Rating nudge rules ---

  it('rule: ratingNudge — triggers when last shot unrated + 5+ historical ratings', () => {
    const now = Date.now() / 1000
    const rated = Array.from({ length: 6 }, (_, i) =>
      makeRecentShot({ time: now - (i + 1) * 3600, rating: 'like' as const })
    )
    const result = pickGreeting(baseCtx({
      lastShot: makeLastShot({ rating: undefined }),
      minutesSinceLastShot: 20,
      recentShots: [makeRecentShot({ time: now }), ...rated],
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('ratingNudge')
    expect(result!.action?.target).toBe('shot-analysis')
  })

  it('rule: ratingNudgeNew — triggers when last shot unrated + 0 historical ratings', () => {
    const result = pickGreeting(baseCtx({
      lastShot: makeLastShot({ rating: undefined }),
      minutesSinceLastShot: 20,
      recentShots: [makeRecentShot()],
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('ratingNudgeNew')
  })

  // --- Top profile rule ---

  it('rule: topProfile — triggers when one profile has 50%+ shots', () => {
    const result = pickGreeting(baseCtx({
      stats: makeStats(30, [
        { name: 'Dominant', count: 20 },
        { name: 'Other', count: 10 },
      ]),
      recentProfiles: ['Dominant', 'Other'],
      hour: 16,       // outside time-of-day windows
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('topProfile')
  })

  it('rule: topProfile — does NOT trigger below 50%', () => {
    const result = pickGreeting(baseCtx({
      stats: makeStats(30, [
        { name: 'A', count: 12 },
        { name: 'B', count: 10 },
        { name: 'C', count: 8 },
      ]),
      recentProfiles: ['A', 'B', 'C'],
      hour: 16,
    }))
    if (result) expect(result.id).not.toBe('topProfile')
  })

  // --- Priority ordering ---

  it('priority: justBrewed beats doubleShot', () => {
    const now = Date.now() / 1000
    const result = pickGreeting(baseCtx({
      lastShot: makeLastShot(),
      minutesSinceLastShot: 5,
      recentShots: [
        makeRecentShot({ time: now - 5 * 60 }),
        makeRecentShot({ time: now - 10 * 60 }),
      ],
    }))
    expect(result!.id).toBe('justBrewed')
  })

  it('priority: milestoneHit beats milestone approaching', () => {
    // 100 is both an exact milestone AND within 5 of the next (the approaching logic would make remaining=0 which is skipped)
    // Use 50 which is exact
    const result = pickGreeting(baseCtx({
      stats: makeStats(50),
      minutesSinceLastShot: 60,
    }))
    expect(result!.id).toBe('milestoneHit')
  })

  it('priority: dailyStreak beats time-of-day rules', () => {
    const result = pickGreeting(baseCtx({
      consecutiveDays: 5,
      hour: 7,
      shotsToday: 0,
    }))
    expect(result!.id).toBe('dailyStreak')
  })

  it('priority: powerUser beats shotCountToday', () => {
    const result = pickGreeting(baseCtx({ shotsToday: 6, personalBestShotsDay: 10 }))
    expect(result!.id).toBe('powerUser')
  })

  // --- Greeting history ---

  it('skips the last-shown greeting for variety', () => {
    // At hour 23, lateNight would match. With lastGreetingId='lateNight' and
    // profiles providing an alternative (fewProfiles), it should pick fewProfiles instead
    const result = pickGreeting(baseCtx({
      hour: 23,
      lastGreetingId: 'lateNight',
      profiles: [makeProfile('One', true)],
      stats: makeStats(100),
      minutesSinceLastShot: null,
    }))
    expect(result).not.toBeNull()
    expect(result!.id).not.toBe('lateNight')
  })

  it('falls back to last-shown if no other match', () => {
    // lateNight is the ONLY possible match at hour 23 with no other data
    const result = pickGreeting(baseCtx({
      hour: 23,
      lastGreetingId: 'lateNight',
      dayOfWeek: 3, // not a special day
    }))
    // Should still return lateNight since it's the only match (second pass)
    expect(result).not.toBeNull()
    expect(result!.id).toBe('lateNight')
  })

  // --- Edge cases ---

  it('handles empty recentShots gracefully', () => {
    const result = pickGreeting(baseCtx({
      recentShots: [],
      minutesSinceLastShot: 90,
      stats: makeStats(100),
    }))
    // Should still return dialIn or similar
    expect(result).not.toBeNull()
  })

  it('handles null stats gracefully', () => {
    const result = pickGreeting(baseCtx({
      stats: null,
      hour: 14,
    }))
    expect(result).not.toBeNull()
    expect(result!.id).toBe('postLunch')
  })

  it('all rules have unique IDs', () => {
    const ids = GREETING_RULES.map(r => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('all rules are sorted by priority', () => {
    for (let i = 1; i < GREETING_RULES.length; i++) {
      expect(GREETING_RULES[i].priority).toBeGreaterThanOrEqual(GREETING_RULES[i - 1].priority)
    }
  })
})

// ---------------------------------------------------------------------------
// logGreeting tests
// ---------------------------------------------------------------------------

describe('logGreeting', () => {
  beforeEach(() => {
    localStorageMock.reset()
    Object.defineProperty(window, 'localStorage', { value: localStorageMock })
  })

  it('stores greeting ID and updates last greeting', () => {
    logGreeting('testGreeting')
    expect(localStorageMock.setItem).toHaveBeenCalledWith('meticai-last-greeting', 'testGreeting')
    const logCall = localStorageMock.setItem.mock.calls.find(
      (c: string[]) => c[0] === 'meticai-greeting-log',
    )
    expect(logCall).toBeDefined()
    const log = JSON.parse(logCall![1])
    expect(log).toHaveLength(1)
    expect(log[0].id).toBe('testGreeting')
  })

  it('caps log at 100 entries', () => {
    for (let i = 0; i < 110; i++) {
      logGreeting(`greeting-${i}`)
    }
    const logCalls = localStorageMock.setItem.mock.calls.filter(
      (c: string[]) => c[0] === 'meticai-greeting-log',
    )
    const lastLog = JSON.parse(logCalls[logCalls.length - 1][1])
    expect(lastLog.length).toBeLessThanOrEqual(100)
  })
})
