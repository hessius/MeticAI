/**
 * useHaptics — provides haptic feedback on native platforms, no-op on web.
 *
 * Wraps @capacitor/haptics with silent error handling.
 */

import { useCallback } from 'react'
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics'
import { Capacitor } from '@capacitor/core'

type ImpactLevel = 'light' | 'medium' | 'heavy'
type NotificationLevel = 'success' | 'warning' | 'error'

const impactStyleMap: Record<ImpactLevel, ImpactStyle> = {
  light: ImpactStyle.Light,
  medium: ImpactStyle.Medium,
  heavy: ImpactStyle.Heavy,
}

const notificationTypeMap: Record<NotificationLevel, NotificationType> = {
  success: NotificationType.Success,
  warning: NotificationType.Warning,
  error: NotificationType.Error,
}

export function useHaptics() {
  const isNative = Capacitor.isNativePlatform()

  const impact = useCallback(
    async (style: ImpactLevel = 'medium') => {
      if (!isNative) return
      try {
        await Haptics.impact({ style: impactStyleMap[style] })
      } catch {
        // Silently swallow — device may not support haptics
      }
    },
    [isNative],
  )

  const notification = useCallback(
    async (type: NotificationLevel = 'success') => {
      if (!isNative) return
      try {
        await Haptics.notification({ type: notificationTypeMap[type] })
      } catch {
        // Silently swallow
      }
    },
    [isNative],
  )

  const vibrate = useCallback(
    async (duration = 300) => {
      if (!isNative) return
      try {
        await Haptics.vibrate({ duration })
      } catch {
        // Silently swallow
      }
    },
    [isNative],
  )

  return { impact, notification, vibrate }
}
