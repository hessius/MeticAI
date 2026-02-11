import { useState, useEffect, useCallback } from 'react'
import { useTheme } from 'next-themes'

export type ThemePreference = 'light' | 'dark' | 'system'

const STORAGE_KEY = 'meticai-theme-preference'

/**
 * Extended theme hook that wraps next-themes and adds a
 * "follow system" toggle alongside the quick light/dark toggle.
 */
export function useThemePreference() {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const preference: ThemePreference =
    theme === 'system' ? 'system' : theme === 'light' ? 'light' : 'dark'

  /** Quick toggle: light ↔ dark (exits "system" mode) */
  const toggleTheme = useCallback(() => {
    const next = resolvedTheme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* noop */ }
  }, [resolvedTheme, setTheme])

  /** Set follow-system on/off */
  const setFollowSystem = useCallback(
    (follow: boolean) => {
      const next = follow ? 'system' : (resolvedTheme ?? 'dark')
      setTheme(next)
      try { localStorage.setItem(STORAGE_KEY, next) } catch { /* noop */ }
    },
    [resolvedTheme, setTheme],
  )

  const isFollowSystem = preference === 'system'
  const isDark = resolvedTheme === 'dark'

  return {
    mounted,
    preference,
    isDark,
    isFollowSystem,
    toggleTheme,
    setFollowSystem,
    setTheme,
  } as const
}
