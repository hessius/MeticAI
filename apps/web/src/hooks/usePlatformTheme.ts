import { useState, useCallback } from 'react'
import { STORAGE_KEYS } from '@/lib/constants'

export type PlatformTheme = 'auto' | 'ios' | 'material' | 'none'
export type DetectedPlatform = 'ios' | 'android' | 'desktop'
export type KonstaTheme = 'ios' | 'material'

function detectPlatform(): DetectedPlatform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

/** Resolve which Konsta theme to use based on preference + detected platform.
 * Note: 'none' maps to 'material' because Konsta always needs a valid theme.
 * The 'none' option originally disabled custom CSS themes (now removed). */
function resolveKonstaTheme(pref: PlatformTheme, detected: DetectedPlatform): KonstaTheme {
  if (pref === 'ios') return 'ios'
  if (pref === 'material') return 'material'
  if (pref === 'none') return 'material' // default fallback
  // auto
  if (detected === 'ios') return 'ios'
  return 'material'
}

export function usePlatformTheme() {
  const [platform] = useState<DetectedPlatform>(detectPlatform)
  const [theme, setThemeState] = useState<PlatformTheme>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEYS.PLATFORM_THEME)
      if (stored === 'ios' || stored === 'material' || stored === 'none') return stored
    } catch { /* noop */ }
    return 'auto'
  })

  const setTheme = useCallback((next: PlatformTheme) => {
    setThemeState(next)
    try {
      localStorage.setItem(STORAGE_KEYS.PLATFORM_THEME, next)
      // Notify useKonstaOverride subscribers so they re-evaluate when switching to/from 'none'
      window.dispatchEvent(new Event('konsta-ui-changed'))
    } catch { /* noop */ }
  }, [])

  const konstaTheme = resolveKonstaTheme(theme, platform)

  return { platform, theme, setTheme, konstaTheme } as const
}
