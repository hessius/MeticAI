/**
 * useSmartGreeting — data-driven contextual greeting for the home screen.
 *
 * Fetches shot stats, last shot, and profile list in parallel, then picks
 * the most relevant message from a prioritized list. Returns null when
 * nothing compelling is available (keeping the home screen clean).
 */

import { useEffect, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useShotDataService } from '@/services/shots'
import { useCatalogueService } from '@/services/catalogue'
import { STORAGE_KEYS } from '@/lib/constants'
import type { HistoryStats, HistoryEntry } from '@meticulous-home/espresso-api'
import type { CatalogueProfile } from '@/services/catalogue/CatalogueService'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SmartGreetingAction {
  label: string
  /** Navigation target — the consuming component maps this to actual navigation */
  target: 'shot-analysis' | 'dial-in' | 'profile-catalogue' | 'add-profile'
  /** Optional context for the navigation (e.g. shot date/filename) */
  context?: Record<string, string>
}

export interface SmartGreeting {
  message: string
  action?: SmartGreetingAction
}

// ---------------------------------------------------------------------------
// Greeting rules (highest priority first)
// ---------------------------------------------------------------------------

interface GreetingContext {
  t: (key: string, opts?: Record<string, unknown>) => string
  stats: HistoryStats | null
  lastShot: HistoryEntry | null
  profiles: CatalogueProfile[]
  minutesSinceLastShot: number | null
  authorName: string | null
  installDays: number | null
  sessionCount: number
}

/** Exported for testing */
export function pickGreeting(ctx: GreetingContext): SmartGreeting | null {
  const { t, stats, lastShot, profiles, minutesSinceLastShot, installDays } = ctx

  // Rule 1: Just brewed (< 15 min)
  if (minutesSinceLastShot !== null && minutesSinceLastShot < 15 && lastShot) {
    return {
      message: t('smartGreeting.justBrewed', { profile: lastShot.profile?.name ?? lastShot.name }),
      action: {
        label: t('smartGreeting.analyzeAction'),
        target: 'shot-analysis',
        context: { date: lastShot.file?.split('/')[0] ?? '', filename: lastShot.file ?? '' },
      },
    }
  }

  // Rule 2: Shot milestone approaching (within 5 of a round number)
  if (stats && stats.totalSavedShots > 0) {
    const total = stats.totalSavedShots
    const milestoneInterval = total < 100 ? 25 : total < 500 ? 50 : 100
    const nextMilestone = Math.ceil((total + 1) / milestoneInterval) * milestoneInterval
    const remaining = nextMilestone - total
    if (remaining <= 5 && remaining > 0) {
      return {
        message: t('smartGreeting.milestone', { count: total, remaining, milestone: nextMilestone }),
      }
    }
  }

  // Rule 3: Long gap since last shot (> 12 hours)
  if (minutesSinceLastShot !== null && minutesSinceLastShot > 12 * 60) {
    const hours = Math.round(minutesSinceLastShot / 60)
    return {
      message: t('smartGreeting.longGap', { hours }),
    }
  }

  // Rule 4: Unused profile suggestion
  if (profiles.length > 0) {
    // Cross-reference with shot stats for profiles not in history
    const usedProfileNames = new Set(
      stats?.byProfile?.map(p => p.name.toLowerCase()) ?? []
    )
    const unused = profiles.filter(
      p => !p.inHistory && !usedProfileNames.has(p.name.toLowerCase())
    )
    if (unused.length > 0) {
      const pick = unused[Math.floor(Math.random() * unused.length)]
      return {
        message: t('smartGreeting.unusedProfile', { name: pick.name }),
        action: { label: t('smartGreeting.browseAction'), target: 'profile-catalogue' },
      }
    }
  }

  // Rule 5: App anniversary (every 10 days)
  if (installDays !== null && installDays > 0 && installDays % 10 === 0) {
    return {
      message: t('smartGreeting.anniversary', { days: installDays }),
    }
  }

  // Rule 6: Dial-in suggestion (last shot 15 min – 4 hours ago)
  if (minutesSinceLastShot !== null && minutesSinceLastShot >= 15 && minutesSinceLastShot < 4 * 60) {
    return {
      message: t('smartGreeting.dialIn'),
      action: { label: t('smartGreeting.dialInAction'), target: 'dial-in' },
    }
  }

  // Rule 7: Few profiles — nudge creation
  if (profiles.length > 0 && profiles.length < 3) {
    return {
      message: t('smartGreeting.fewProfiles', { count: profiles.length }),
      action: { label: t('smartGreeting.createAction'), target: 'add-profile' },
    }
  }

  // Fallback: nothing compelling — keep it clean
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
      // Fetch all data in parallel — gracefully handle failures
      const [stats, lastShot, profiles] = await Promise.all([
        shotService.getHistoryStats().catch(() => null),
        shotService.getLastShot().catch(() => null),
        catalogueService.listProfiles().catch(() => [] as CatalogueProfile[]),
      ])

      // Calculate derived values
      const minutesSinceLastShot = lastShot?.time
        ? Math.max(0, Math.round((Date.now() / 1000 - lastShot.time) / 60))
        : null

      const authorName = localStorage.getItem(STORAGE_KEYS.AUTHOR_NAME) || null
      const installDateStr = localStorage.getItem(STORAGE_KEYS.INSTALL_DATE)
      const installDays = installDateStr
        ? Math.floor((Date.now() - new Date(installDateStr).getTime()) / (24 * 60 * 60 * 1000))
        : null
      const sessionCount = parseInt(localStorage.getItem(STORAGE_KEYS.SESSION_COUNT) ?? '0', 10)

      const result = pickGreeting({
        t, stats, lastShot, profiles, minutesSinceLastShot,
        authorName, installDays, sessionCount,
      })

      setGreeting(result)
    }

    build()
  }, [enabled, shotService, catalogueService, t])

  return greeting
}
