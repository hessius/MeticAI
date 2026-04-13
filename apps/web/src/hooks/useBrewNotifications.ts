/**
 * useBrewNotifications — local notifications for brew lifecycle events.
 *
 * Uses @capacitor/local-notifications on native, browser Notification API on web.
 * Notifications only fire when the app is NOT in the foreground.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LocalNotifications } from '@capacitor/local-notifications'
import { Capacitor } from '@capacitor/core'

let nextId = 1000

export function useBrewNotifications() {
  const { t } = useTranslation()
  const isNative = Capacitor.isNativePlatform()
  const [hasPermission, setHasPermission] = useState(false)
  const checkedRef = useRef(false)

  // Check permission on mount
  useEffect(() => {
    if (checkedRef.current) return
    checkedRef.current = true

    ;(async () => {
      try {
        if (isNative) {
          const result = await LocalNotifications.checkPermissions()
          setHasPermission(result.display === 'granted')
        } else if ('Notification' in window) {
          setHasPermission(Notification.permission === 'granted')
        }
      } catch {
        // Permission check failed — leave as false
      }
    })()
  }, [isNative])

  const requestPermission = useCallback(async () => {
    try {
      if (isNative) {
        const result = await LocalNotifications.requestPermissions()
        const granted = result.display === 'granted'
        setHasPermission(granted)
        return granted
      }
      if ('Notification' in window) {
        const result = await Notification.requestPermission()
        const granted = result === 'granted'
        setHasPermission(granted)
        return granted
      }
      return false
    } catch {
      return false
    }
  }, [isNative])

  const scheduleNotification = useCallback(
    async (title: string, body: string) => {
      // Only notify when app is backgrounded
      if (document.visibilityState === 'visible') return

      const id = nextId++

      try {
        if (isNative) {
          await LocalNotifications.schedule({
            notifications: [
              {
                id,
                title,
                body,
                schedule: { at: new Date(Date.now() + 100) },
              },
            ],
          })
        } else if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(title, { body })
        }
      } catch {
        // Notification delivery failed — non-critical
      }
    },
    [isNative],
  )

  const notifyBrewComplete = useCallback(
    (profileName: string) =>
      scheduleNotification(
        t('notifications.brewComplete'),
        t('notifications.brewCompleteBody', { profile: profileName }),
      ),
    [scheduleNotification, t],
  )

  const notifyPreheatComplete = useCallback(
    () => scheduleNotification(
      t('notifications.machineReady'),
      t('notifications.machineReadyBody'),
    ),
    [scheduleNotification, t],
  )

  const notifyPourOverComplete = useCallback(
    () => scheduleNotification(
      t('notifications.pourOverComplete'),
      t('notifications.pourOverCompleteBody'),
    ),
    [scheduleNotification, t],
  )

  return {
    notifyBrewComplete,
    notifyPreheatComplete,
    notifyPourOverComplete,
    requestPermission,
    hasPermission,
  }
}
