/**
 * useActionSheet — shows a native action sheet on iOS/Android, no-op on web.
 *
 * Wraps @capacitor/action-sheet with silent error handling.
 * On web, returns -1 (cancelled) so the existing dropdown/dialog UI is used instead.
 */

import { useCallback } from 'react'
import { ActionSheet, ActionSheetButtonStyle } from '@capacitor/action-sheet'
import { Capacitor } from '@capacitor/core'

interface ShowActionSheetOptions {
  title: string
  options: string[]
}

export function useActionSheet() {
  const isNative = Capacitor.isNativePlatform()

  const showActionSheet = useCallback(
    async ({ title, options }: ShowActionSheetOptions): Promise<number> => {
      if (!isNative) return -1

      try {
        const result = await ActionSheet.showActions({
          title,
          options: options.map((label) => ({
            title: label,
            style: ActionSheetButtonStyle.Default,
          })),
        })
        return result.index
      } catch {
        // User dismissed or device doesn't support — treat as cancelled
        return -1
      }
    },
    [isNative],
  )

  return { showActionSheet }
}
