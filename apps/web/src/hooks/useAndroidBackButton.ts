import { useEffect, useRef } from 'react'
import { Capacitor } from '@capacitor/core'

/**
 * Registers an Android hardware "back" button handler via the Capacitor App
 * plugin.
 *
 * Registering a `backButton` listener overrides Capacitor's default behaviour
 * (which would exit the app on the root history entry), so the supplied handler
 * has full control: it decides whether to close a modal, navigate to a previous
 * view, or do nothing. The listener is only attached on native Android; on iOS
 * and the web it is a no-op.
 *
 * The handler is stored in a ref so the listener does not need to be torn down
 * and re-registered on every render when an inline callback is passed.
 */
export function useAndroidBackButton(handler: () => void, enabled = true): void {
  const handlerRef = useRef(handler)
  useEffect(() => {
    handlerRef.current = handler
  }, [handler])

  useEffect(() => {
    if (!enabled) return
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return

    let cancelled = false
    let remove: (() => void) | undefined

    // Return the module namespace (not the plugin proxy) from the async import,
    // then access App on it: awaiting a plugin proxy directly triggers
    // "App.then() is not implemented" on Android.
    void (async () => {
      const mod = await import('@capacitor/app')
      if (cancelled) return
      const listener = await mod.App.addListener('backButton', () => {
        handlerRef.current()
      })
      if (cancelled) {
        listener.remove()
        return
      }
      remove = () => listener.remove()
    })()

    return () => {
      cancelled = true
      remove?.()
    }
  }, [enabled])
}
