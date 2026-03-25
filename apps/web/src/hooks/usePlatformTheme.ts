import { useState, useLayoutEffect, useCallback } from 'react'
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

function resolveThemeClass(pref: PlatformTheme, detected: DetectedPlatform): string | null {
  if (pref === 'none') return null
  if (pref === 'ios') return 'ios-theme'
  if (pref === 'material') return 'material-theme'
  if (detected === 'ios') return 'ios-theme'
  if (detected === 'android') return 'material-theme'
  return null
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
    try { localStorage.setItem(STORAGE_KEYS.PLATFORM_THEME, next) } catch { /* noop */ }
  }, [])

  useLayoutEffect(() => {
    const root = document.documentElement
    const cls = resolveThemeClass(theme, platform)
    root.classList.remove('ios-theme', 'material-theme')
    if (cls) root.classList.add(cls)
    return () => { root.classList.remove('ios-theme', 'material-theme') }
  }, [theme, platform])

  return { platform, theme, setTheme } as const
}
