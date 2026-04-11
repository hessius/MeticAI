import { useState, useCallback } from 'react'
import { STORAGE_KEYS } from '@/lib/constants'

export type PlatformTheme = 'auto' | 'ios' | 'material' | 'none'
export type DetectedPlatform = 'ios' | 'android' | 'desktop'

function detectPlatform(): DetectedPlatform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios'
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
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
    } catch { /* noop */ }
  }, [])

  return { platform, theme, setTheme } as const
}
