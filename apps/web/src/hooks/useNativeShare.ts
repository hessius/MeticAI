/**
 * useNativeShare — share content via the native share sheet.
 *
 * Uses @capacitor/share on native, Web Share API on web,
 * clipboard copy as last resort.
 */

import { useCallback, useMemo } from 'react'
import { Share } from '@capacitor/share'
import { Capacitor } from '@capacitor/core'

interface ShareOptions {
  title?: string
  text?: string
  url?: string
}

export function useNativeShare() {
  const isNative = Capacitor.isNativePlatform()

  const canShare = useMemo(() => {
    if (isNative) return true
    return typeof navigator !== 'undefined' && 'share' in navigator
  }, [isNative])

  const share = useCallback(
    async (options: ShareOptions) => {
      try {
        if (isNative) {
          await Share.share(options)
          return
        }

        // Web Share API
        if (typeof navigator.share === 'function') {
          await navigator.share(options)
          return
        }

        // Clipboard fallback
        const text = [options.title, options.text, options.url].filter(Boolean).join(' — ')
        if (typeof navigator.clipboard?.writeText === 'function') {
          await navigator.clipboard.writeText(text)
        }
      } catch (err) {
        // User cancelled share sheet — ignore AbortError
        if (err instanceof Error && err.name === 'AbortError') return
        throw err
      }
    },
    [isNative],
  )

  return { share, canShare }
}
