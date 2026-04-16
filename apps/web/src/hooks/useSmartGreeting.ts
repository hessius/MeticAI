/**
 * useSmartGreeting — data-driven contextual greeting for the home screen.
 *
 * Fetches shot stats, last shot, profile list, and recent shots in parallel,
 * then picks the most relevant message from a prioritized rule registry.
 * Returns null when nothing compelling is available.
 *
 * Greeting history tracking ensures variety across consecutive app opens.
 */

import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useShotDataService } from '@/services/shots'
import { useCatalogueService } from '@/services/catalogue'
import { STORAGE_KEYS } from '@/lib/constants'
import type { HistoryStats, HistoryEntry, HistoryListingEntry } from '@meticulous-home/espresso-api'
import type { CatalogueProfile } from '@/services/catalogue/CatalogueService'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SmartGreetingAction {
  label: string
  /** Navigation target — the consuming component maps this to actual navigation */
  target: 'shot-analysis' | 'dial-in' | 'profile-catalogue' | 'add-profile' | 'shot-history'
  /** Optional context for the navigation (e.g. shot date/filename) */
  context?: Record<string, string>
}

export interface SmartGreeting {
  id: string
  message: string
  action?: SmartGreetingAction
}

export interface GreetingContext {
  t: (key: string, opts?: Record<string, unknown>) => string
  stats: HistoryStats | null
  lastShot: HistoryEntry | null
  profiles: CatalogueProfile[]
  minutesSinceLastShot: number | null
  authorName: string | null
  installDays: number | null
  sessionCount: number
  recentShots: HistoryListingEntry[]
  shotsToday: number
  recentProfiles: string[]
  consecutiveSameProfile: { name: string; count: number } | null
  consecutiveDays: number
  hour: number
  dayOfWeek: number
  lastGreetingId: string | null
  personalBestShotsDay: number
}

export interface GreetingRule {
  id: string
  priority: number
  match: (ctx: GreetingContext) => SmartGreeting | null
}

// ---------------------------------------------------------------------------
// Greeting history helpers
// ---------------------------------------------------------------------------

interface GreetingLogEntry {
  id: string
  ts: number
}

function getGreetingLog(): GreetingLogEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.GREETING_LOG)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function logGreeting(id: string): void {
  const log = getGreetingLog()
  log.push({ id, ts: Math.floor(Date.now() / 1000) })
  while (log.length > 100) log.shift()
  localStorage.setItem(STORAGE_KEYS.GREETING_LOG, JSON.stringify(log))
  localStorage.setItem(STORAGE_KEYS.LAST_GREETING_ID, id)
}

function getLastGreetingId(): string | null {
  return localStorage.getItem(STORAGE_KEYS.LAST_GREETING_ID)
}

// ---------------------------------------------------------------------------
// Derived data helpers
// ---------------------------------------------------------------------------

/** Count shots from today (local timezone) */
export function countShotsToday(recentShots: HistoryListingEntry[]): number {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayUnix = todayStart.getTime() / 1000
  return recentShots.filter(s => s.time >= todayUnix).length
}

/** Unique profile names from shots in the last 7 days */
export function getRecentProfiles(recentShots: HistoryListingEntry[]): string[] {
  const cutoff = Date.now() / 1000 - 7 * 24 * 60 * 60
  const names = new Set<string>()
  for (const s of recentShots) {
    if (s.time >= cutoff) names.add(s.profile?.name ?? s.name)
  }
  return [...names]
}

/** Longest streak of the same profile at the head of the list */
export function getConsecutiveSameProfile(
  recentShots: HistoryListingEntry[],
): { name: string; count: number } | null {
  if (recentShots.length < 2) return null
  const firstName = recentShots[0].profile?.name ?? recentShots[0].name
  let count = 0
  for (const s of recentShots) {
    if ((s.profile?.name ?? s.name) === firstName) count++
    else break
  }
  return count >= 2 ? { name: firstName, count } : null
}

/** Count consecutive calendar days with at least one shot */
export function getConsecutiveDays(recentShots: HistoryListingEntry[]): number {
  if (recentShots.length === 0) return 0
  const shotDates = new Set(
    recentShots.map(s => {
      const d = new Date(s.time * 1000)
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    }),
  )
  const today = new Date()
  let streak = 0
  for (let i = 0; i < 50; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    if (shotDates.has(key)) streak++
    else break
  }
  return streak
}

/**
 * Find the most common brew time across days (for consistency detection).
 * Returns result if 5+ days have their first shot within a 60-min window.
 */
export function findConsistentBrewTime(
  recentShots: HistoryListingEntry[],
): { hour: number; minute: number; days: number } | null {
  const byDate = new Map<string, number>()
  for (const s of recentShots) {
    const d = new Date(s.time * 1000)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const minuteOfDay = d.getHours() * 60 + d.getMinutes()
    const existing = byDate.get(key)
    if (existing === undefined || minuteOfDay < existing) {
      byDate.set(key, minuteOfDay)
    }
  }

  const times = [...byDate.values()].sort((a, b) => a - b)
  if (times.length < 5) return null

  let bestCount = 0
  let bestStart = 0
  for (let i = 0; i < times.length; i++) {
    const windowEnd = times[i] + 60
    let count = 0
    for (let j = i; j < times.length && times[j] <= windowEnd; j++) {
      count++
    }
    if (count > bestCount) {
      bestCount = count
      bestStart = i
    }
  }

  if (bestCount >= 5) {
    const windowTimes = times.slice(bestStart, bestStart + bestCount)
    const avg = Math.round(windowTimes.reduce((a, b) => a + b, 0) / windowTimes.length)
    return { hour: Math.floor(avg / 60), minute: avg % 60, days: bestCount }
  }
  return null
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function shotProfileName(shot: { profile?: { name?: string }; name: string }): string {
  return shot.profile?.name ?? shot.name ?? 'Unknown'
}

// ---------------------------------------------------------------------------
// Greeting rules — sorted by priority (lower = higher priority)
// ---------------------------------------------------------------------------

export const GREETING_RULES: GreetingRule[] = [
  // --- Tier 10: Immediate / timely ---
  {
    id: 'justBrewed',
    priority: 10,
    match: (ctx) => {
      if (ctx.minutesSinceLastShot === null || ctx.minutesSinceLastShot >= 15 || !ctx.lastShot) return null
      return {
        id: 'justBrewed',
        message: ctx.t('smartGreeting.justBrewed', { profile: shotProfileName(ctx.lastShot) }),
        action: {
          label: ctx.t('smartGreeting.analyzeAction'),
          target: 'shot-analysis',
          context: { date: ctx.lastShot.file?.split('/')[0] ?? '', filename: ctx.lastShot.file ?? '' },
        },
      }
    },
  },
  {
    id: 'doubleShot',
    priority: 11,
    match: (ctx) => {
      if (ctx.minutesSinceLastShot === null || ctx.minutesSinceLastShot >= 60) return null
      if (ctx.recentShots.length < 2) return null
      const diffMin = Math.abs(ctx.recentShots[0].time - ctx.recentShots[1].time) / 60
      if (diffMin > 30) return null
      return { id: 'doubleShot', message: ctx.t('smartGreeting.doubleShot') }
    },
  },
  {
    id: 'ratingNudge',
    priority: 12,
    match: (ctx) => {
      if (!ctx.lastShot || ctx.minutesSinceLastShot === null || ctx.minutesSinceLastShot > 30) return null
      if (ctx.lastShot.rating != null) return null
      const ratedCount = ctx.recentShots.filter(s => s.rating != null).length
      if (ratedCount < 5) return null
      return {
        id: 'ratingNudge',
        message: ctx.t('smartGreeting.ratingNudge', { profile: shotProfileName(ctx.lastShot) }),
        action: {
          label: ctx.t('smartGreeting.rateAction'),
          target: 'shot-analysis',
          context: { date: ctx.lastShot.file?.split('/')[0] ?? '', filename: ctx.lastShot.file ?? '' },
        },
      }
    },
  },
  {
    id: 'ratingNudgeNew',
    priority: 13,
    match: (ctx) => {
      if (!ctx.lastShot || ctx.minutesSinceLastShot === null || ctx.minutesSinceLastShot > 30) return null
      if (ctx.lastShot.rating != null) return null
      const ratedCount = ctx.recentShots.filter(s => s.rating != null).length
      if (ratedCount > 0) return null
      return {
        id: 'ratingNudgeNew',
        message: ctx.t('smartGreeting.ratingNudgeNew'),
        action: {
          label: ctx.t('smartGreeting.rateAction'),
          target: 'shot-analysis',
          context: { date: ctx.lastShot.file?.split('/')[0] ?? '', filename: ctx.lastShot.file ?? '' },
        },
      }
    },
  },

  // --- Tier 20: Exact milestones ---
  {
    id: 'milestoneHit',
    priority: 20,
    match: (ctx) => {
      if (!ctx.stats) return null
      const total = ctx.stats.totalSavedShots
      if (![50, 100, 200, 500, 1000].includes(total)) return null
      return { id: 'milestoneHit', message: ctx.t('smartGreeting.milestoneHit', { count: total }) }
    },
  },
  {
    id: 'personalBestDay',
    priority: 21,
    match: (ctx) => {
      if (ctx.shotsToday < 3 || ctx.shotsToday <= ctx.personalBestShotsDay) return null
      return { id: 'personalBestDay', message: ctx.t('smartGreeting.personalBestDay', { count: ctx.shotsToday }) }
    },
  },

  // --- Tier 30: Achievements ---
  {
    id: 'dailyStreak',
    priority: 30,
    match: (ctx) => {
      if (ctx.consecutiveDays < 3) return null
      return { id: 'dailyStreak', message: ctx.t('smartGreeting.dailyStreak', { days: ctx.consecutiveDays }) }
    },
  },
  {
    id: 'powerUser',
    priority: 31,
    match: (ctx) => {
      if (ctx.shotsToday < 5) return null
      return { id: 'powerUser', message: ctx.t('smartGreeting.powerUser', { count: ctx.shotsToday }) }
    },
  },

  // --- Tier 40: Approaching milestones ---
  {
    id: 'milestone',
    priority: 40,
    match: (ctx) => {
      if (!ctx.stats || ctx.stats.totalSavedShots <= 0) return null
      const total = ctx.stats.totalSavedShots
      const interval = total < 100 ? 25 : total < 500 ? 50 : 100
      const next = Math.ceil((total + 1) / interval) * interval
      const remaining = next - total
      if (remaining > 5 || remaining <= 0) return null
      return { id: 'milestone', message: ctx.t('smartGreeting.milestone', { count: total, remaining, milestone: next }) }
    },
  },
  {
    id: 'firstWeek',
    priority: 41,
    match: (ctx) => {
      if (ctx.installDays !== 7) return null
      return { id: 'firstWeek', message: ctx.t('smartGreeting.firstWeek') }
    },
  },
  {
    id: 'oneMonth',
    priority: 42,
    match: (ctx) => {
      if (ctx.installDays !== 30) return null
      return { id: 'oneMonth', message: ctx.t('smartGreeting.oneMonth') }
    },
  },

  // --- Tier 50: Time-sensitive ---
  {
    id: 'morningRitual',
    priority: 50,
    match: (ctx) => {
      if (ctx.hour < 6 || ctx.hour >= 9 || ctx.shotsToday > 0) return null
      return { id: 'morningRitual', message: ctx.t('smartGreeting.morningRitual') }
    },
  },
  {
    id: 'firstShotOfDay',
    priority: 51,
    match: (ctx) => {
      if (ctx.hour < 6 || ctx.hour >= 12 || ctx.shotsToday > 0) return null
      return { id: 'firstShotOfDay', message: ctx.t('smartGreeting.firstShotOfDay') }
    },
  },
  {
    id: 'postLunch',
    priority: 52,
    match: (ctx) => {
      if (ctx.hour < 13 || ctx.hour >= 15) return null
      return { id: 'postLunch', message: ctx.t('smartGreeting.postLunch') }
    },
  },
  {
    id: 'lateNight',
    priority: 53,
    match: (ctx) => {
      if (ctx.hour < 22) return null
      return { id: 'lateNight', message: ctx.t('smartGreeting.lateNight') }
    },
  },
  {
    id: 'earlyBird',
    priority: 54,
    match: (ctx) => {
      if (ctx.hour >= 6) return null
      return { id: 'earlyBird', message: ctx.t('smartGreeting.earlyBird') }
    },
  },

  // --- Tier 60: Pattern insights ---
  {
    id: 'backToBack',
    priority: 60,
    match: (ctx) => {
      if (!ctx.consecutiveSameProfile || ctx.consecutiveSameProfile.count < 3) return null
      if (ctx.profiles.length <= 1) return null // single-profile user has its own rule
      return {
        id: 'backToBack',
        message: ctx.t('smartGreeting.backToBack', {
          name: ctx.consecutiveSameProfile.name,
          count: ctx.consecutiveSameProfile.count,
        }),
      }
    },
  },
  {
    id: 'varietyExplorer',
    priority: 61,
    match: (ctx) => {
      if (ctx.recentProfiles.length < 3) return null
      return {
        id: 'varietyExplorer',
        message: ctx.t('smartGreeting.varietyExplorer', { count: ctx.recentProfiles.length }),
        action: { label: ctx.t('smartGreeting.browseAction'), target: 'profile-catalogue' },
      }
    },
  },
  {
    id: 'topProfile',
    priority: 62,
    match: (ctx) => {
      if (!ctx.stats || ctx.stats.totalSavedShots < 10) return null
      const sorted = [...(ctx.stats.byProfile ?? [])].sort((a, b) => b.count - a.count)
      if (sorted.length === 0) return null
      const top = sorted[0]
      const pct = Math.round((top.count / ctx.stats.totalSavedShots) * 100)
      if (pct < 50) return null
      return { id: 'topProfile', message: ctx.t('smartGreeting.topProfile', { name: top.name, percent: pct }) }
    },
  },
  {
    id: 'consistencyKing',
    priority: 63,
    match: (ctx) => {
      const result = findConsistentBrewTime(ctx.recentShots)
      if (!result) return null
      const timeStr = `${result.hour}:${result.minute.toString().padStart(2, '0')}`
      return { id: 'consistencyKing', message: ctx.t('smartGreeting.consistencyKing', { time: timeStr }) }
    },
  },
  {
    id: 'neglectedFavorite',
    priority: 64,
    match: (ctx) => {
      if (!ctx.stats || ctx.stats.byProfile.length === 0) return null
      const sorted = [...ctx.stats.byProfile].sort((a, b) => b.count - a.count)
      const favorite = sorted[0]
      if (ctx.recentProfiles.includes(favorite.name)) return null
      return {
        id: 'neglectedFavorite',
        message: ctx.t('smartGreeting.neglectedFavorite', { name: favorite.name }),
        action: { label: ctx.t('smartGreeting.browseAction'), target: 'profile-catalogue' },
      }
    },
  },
  {
    id: 'shotCountToday',
    priority: 65,
    match: (ctx) => {
      if (ctx.shotsToday < 3) return null
      return {
        id: 'shotCountToday',
        message: ctx.t('smartGreeting.shotCountToday', { count: ctx.shotsToday }),
        action: { label: ctx.t('smartGreeting.viewHistoryAction'), target: 'shot-history' },
      }
    },
  },

  // --- Tier 70: Long gap ---
  {
    id: 'longGap',
    priority: 70,
    match: (ctx) => {
      if (ctx.minutesSinceLastShot === null || ctx.minutesSinceLastShot <= 12 * 60) return null
      const hours = Math.round(ctx.minutesSinceLastShot / 60)
      return { id: 'longGap', message: ctx.t('smartGreeting.longGap', { hours }) }
    },
  },

  // --- Tier 75: Calendar / fun ---
  {
    id: 'weekendMorning',
    priority: 75,
    match: (ctx) => {
      if (ctx.dayOfWeek !== 0 && ctx.dayOfWeek !== 6) return null
      if (ctx.hour >= 12) return null
      return { id: 'weekendMorning', message: ctx.t('smartGreeting.weekendMorning') }
    },
  },
  {
    id: 'friday',
    priority: 76,
    match: (ctx) => {
      if (ctx.dayOfWeek !== 5) return null
      return { id: 'friday', message: ctx.t('smartGreeting.friday') }
    },
  },
  {
    id: 'mondayMotivation',
    priority: 77,
    match: (ctx) => {
      if (ctx.dayOfWeek !== 1) return null
      return { id: 'mondayMotivation', message: ctx.t('smartGreeting.mondayMotivation') }
    },
  },
  {
    id: 'anniversary',
    priority: 78,
    match: (ctx) => {
      if (ctx.installDays === null || ctx.installDays <= 0 || ctx.installDays % 10 !== 0) return null
      return { id: 'anniversary', message: ctx.t('smartGreeting.anniversary', { days: ctx.installDays }) }
    },
  },

  // --- Tier 80: Quiet week ---
  {
    id: 'quietWeek',
    priority: 80,
    match: (ctx) => {
      if (ctx.recentShots.length < 10) return null
      const now = new Date()
      // Only trigger Wed–Sun so the week has enough data
      if (now.getDay() >= 1 && now.getDay() <= 2) return null
      const weekStart = new Date(now)
      weekStart.setDate(now.getDate() - now.getDay())
      weekStart.setHours(0, 0, 0, 0)
      const weekStartUnix = weekStart.getTime() / 1000
      const thisWeekCount = ctx.recentShots.filter(s => s.time >= weekStartUnix).length
      const olderShots = ctx.recentShots.filter(s => s.time < weekStartUnix)
      if (olderShots.length === 0) return null
      const weekCounts = new Map<number, number>()
      for (const s of olderShots) {
        const weekNum = Math.floor((weekStartUnix - s.time) / (7 * 24 * 60 * 60))
        weekCounts.set(weekNum, (weekCounts.get(weekNum) ?? 0) + 1)
      }
      if (weekCounts.size === 0) return null
      const avgWeekly = [...weekCounts.values()].reduce((a, b) => a + b, 0) / weekCounts.size
      if (thisWeekCount >= avgWeekly * 0.6) return null
      return { id: 'quietWeek', message: ctx.t('smartGreeting.quietWeek') }
    },
  },

  // --- Tier 85: Engagement nudges ---
  {
    id: 'dialIn',
    priority: 85,
    match: (ctx) => {
      if (ctx.minutesSinceLastShot === null) return null
      if (ctx.minutesSinceLastShot < 15 || ctx.minutesSinceLastShot >= 4 * 60) return null
      return {
        id: 'dialIn',
        message: ctx.t('smartGreeting.dialIn'),
        action: { label: ctx.t('smartGreeting.dialInAction'), target: 'dial-in' },
      }
    },
  },
  {
    id: 'unusedProfile',
    priority: 86,
    match: (ctx) => {
      if (ctx.profiles.length === 0) return null
      const usedNames = new Set(ctx.stats?.byProfile?.map(p => p.name.toLowerCase()) ?? [])
      const unused = ctx.profiles.filter(p => !p.inHistory && !usedNames.has(p.name.toLowerCase()))
      if (unused.length === 0) return null
      const pick = unused[Math.floor(Math.random() * unused.length)]
      return {
        id: 'unusedProfile',
        message: ctx.t('smartGreeting.unusedProfile', { name: pick.name }),
        action: { label: ctx.t('smartGreeting.browseAction'), target: 'profile-catalogue' },
      }
    },
  },
  {
    id: 'singleProfileUser',
    priority: 87,
    match: (ctx) => {
      if (ctx.profiles.length !== 1 || !ctx.consecutiveSameProfile) return null
      if (ctx.consecutiveSameProfile.count < 4) return null
      return {
        id: 'singleProfileUser',
        message: ctx.t('smartGreeting.singleProfileUser', {
          count: ctx.consecutiveSameProfile.count,
          name: ctx.consecutiveSameProfile.name,
        }),
      }
    },
  },
  {
    id: 'profileCollector',
    priority: 88,
    match: (ctx) => {
      if (ctx.profiles.length < 10) return null
      return { id: 'profileCollector', message: ctx.t('smartGreeting.profileCollector', { count: ctx.profiles.length }) }
    },
  },
  {
    id: 'fewProfiles',
    priority: 89,
    match: (ctx) => {
      if (ctx.profiles.length === 0 || ctx.profiles.length >= 3) return null
      return {
        id: 'fewProfiles',
        message: ctx.t('smartGreeting.fewProfiles', { count: ctx.profiles.length }),
        action: { label: ctx.t('smartGreeting.createAction'), target: 'add-profile' },
      }
    },
  },
]

// Pre-sort rules by priority
const SORTED_RULES = [...GREETING_RULES].sort((a, b) => a.priority - b.priority)

// ---------------------------------------------------------------------------
// Main greeting picker
// ---------------------------------------------------------------------------

/** Exported for testing */
export function pickGreeting(ctx: GreetingContext): SmartGreeting | null {
  // First pass: skip the last-shown greeting for variety
  for (const rule of SORTED_RULES) {
    const result = rule.match(ctx)
    if (result && result.id !== ctx.lastGreetingId) return result
  }
  // Second pass: allow repeating if it's the only match
  for (const rule of SORTED_RULES) {
    const result = rule.match(ctx)
    if (result) return result
  }
  return null
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSmartGreeting(enabled: boolean): SmartGreeting | null {
  const { t } = useTranslation()
  const shotService = useShotDataService()
  const catalogueService = useCatalogueService()
  const [greeting, setGreeting] = useState<SmartGreeting | null>(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
    if (!enabled || fetchedRef.current) return
    fetchedRef.current = true

    const build = async () => {
      const [stats, lastShot, profiles, recentShots] = await Promise.all([
        shotService.getHistoryStats().catch(() => null),
        shotService.getLastShot().catch(() => null),
        catalogueService.listProfiles().catch(() => [] as CatalogueProfile[]),
        shotService.getRecentShots(50).catch(() => [] as HistoryListingEntry[]),
      ])

      const minutesSinceLastShot = lastShot?.time
        ? Math.max(0, Math.round((Date.now() / 1000 - lastShot.time) / 60))
        : null

      const authorName = localStorage.getItem(STORAGE_KEYS.AUTHOR_NAME) || null
      const installDateStr = localStorage.getItem(STORAGE_KEYS.INSTALL_DATE)
      const installDays = installDateStr
        ? Math.floor((Date.now() - new Date(installDateStr).getTime()) / (24 * 60 * 60 * 1000))
        : null
      const sessionCount = parseInt(localStorage.getItem(STORAGE_KEYS.SESSION_COUNT) ?? '0', 10)
      const now = new Date()
      const shotsToday = countShotsToday(recentShots)
      const personalBestShotsDay = parseInt(
        localStorage.getItem(STORAGE_KEYS.PERSONAL_BEST_SHOTS_DAY) ?? '0', 10,
      )

      const result = pickGreeting({
        t, stats, lastShot, profiles, minutesSinceLastShot,
        authorName, installDays, sessionCount,
        recentShots,
        shotsToday,
        recentProfiles: getRecentProfiles(recentShots),
        consecutiveSameProfile: getConsecutiveSameProfile(recentShots),
        consecutiveDays: getConsecutiveDays(recentShots),
        hour: now.getHours(),
        dayOfWeek: now.getDay(),
        lastGreetingId: getLastGreetingId(),
        personalBestShotsDay,
      })

      if (result) {
        logGreeting(result.id)
        if (result.id === 'personalBestDay') {
          localStorage.setItem(STORAGE_KEYS.PERSONAL_BEST_SHOTS_DAY, String(shotsToday))
        }
      }

      setGreeting(result)
    }

    build()
  }, [enabled, shotService, catalogueService, t])

  return greeting
}
