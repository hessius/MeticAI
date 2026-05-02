/**
 * useClipboard — copy text to clipboard on native and web.
 *
 * Uses @capacitor/clipboard on native, navigator.clipboard on web.
 * Shows a toast on successful copy.
 */

import { useCallback } from 'react'
import { Clipboard } from '@capacitor/clipboard'
import { Capacitor } from '@capacitor/core'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'

export function useClipboard() {
  const isNative = Capacitor.isNativePlatform()
  const { t } = useTranslation()

  const copyToClipboard = useCallback(
    async (text: string): Promise<boolean> => {
      try {
        if (isNative) {
          await Clipboard.write({ string: text })
        } else {
          await navigator.clipboard.writeText(text)
        }
        toast.success(t('common.copied'))
        return true
      } catch {
        // Silently swallow — clipboard may not be available
        return false
      }
    },
    [isNative, t],
  )

  return { copyToClipboard }
}
