/**
 * Shared time formatting utilities for the Control Center.
 */

type TFunction = (key: string, options?: Record<string, unknown>) => string

/**
 * Format an ISO timestamp into a human-readable relative string.
 * e.g. "2 min ago", "3 hours ago", "1 day ago"
 */
export function relativeTime(iso: string | null, t: TFunction): string | null {
  if (!iso) return null
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 0) return null
  const mins = Math.round(diff / 60_000)
  if (mins < 1) return t('controlCenter.lastShot.justNow')
  if (mins < 60) return t('controlCenter.lastShot.minutesAgo', { count: mins })
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return t('controlCenter.lastShot.hoursAgo', { count: hrs })
  const days = Math.round(hrs / 24)
  return t('controlCenter.lastShot.daysAgo', { count: days })
}
