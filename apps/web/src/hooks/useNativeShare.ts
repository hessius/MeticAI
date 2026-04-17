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

/**
 * Share a PNG data URI as an image file via the native share sheet.
 * Converts the data URI to a File and uses Web Share API's files param.
 * Falls back to sharing as a URL if files aren't supported.
 */
async function shareImageDataUri(dataUri: string, filename: string, options?: { title?: string; text?: string }) {
  const isNative = Capacitor.isNativePlatform()

  if (isNative) {
    // On iOS, Share.share with url: dataUri works for images
    await Share.share({
      title: options?.title,
      text: options?.text,
      url: dataUri,
    })
    return
  }

  // Web: convert data URI to File and use Web Share API files
  const response = await fetch(dataUri)
  const blob = await response.blob()
  const file = new File([blob], filename, { type: blob.type })

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: options?.title,
        text: options?.text,
        files: [file],
      })
      return
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return
      // If files not supported, fall through
    }
  }

  // Last resort: download
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export { shareImageDataUri }

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
