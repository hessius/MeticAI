// Notification routing for the in-app Dynamic Island (#439).
//
// `notify` is a thin wrapper over sonner's `toast`. When the user is on the home
// screen — where the in-app Dynamic Island is visible — string notifications are
// routed into the island. Everywhere else (sub-views, dialogs) they fall back to
// the standard toast system, which respects safe-area insets. Advanced sonner
// features (promise, custom JSX, loading, dismiss) remain available via the
// re-exported `toast`.

import { toast } from 'sonner'
import { pushIslandNotification, type IslandTone } from './islandNotifications'

let homeActive = false

/** App updates this whenever the active view changes. */
export function setHomeActive(active: boolean): void {
  homeActive = active
}

export function isHomeActive(): boolean {
  return homeActive
}

export interface NotifyOptions {
  /** Auto-dismiss delay in ms (island path). */
  durationMs?: number
  /** Force the standard toast path even on the home screen. */
  forceToast?: boolean
}

const toneToToast: Record<IslandTone, (message: string) => void> = {
  info: message => void toast.info(message),
  success: message => void toast.success(message),
  warning: message => void toast.warning(message),
  error: message => void toast.error(message),
}

function route(tone: IslandTone, message: string, options?: NotifyOptions): void {
  if (homeActive && !options?.forceToast) {
    pushIslandNotification({ message, tone, durationMs: options?.durationMs })
    return
  }
  toneToToast[tone](message)
}

export function notify(message: string, options?: NotifyOptions): void {
  route('info', message, options)
}

notify.info = (message: string, options?: NotifyOptions): void => route('info', message, options)
notify.success = (message: string, options?: NotifyOptions): void => route('success', message, options)
notify.warning = (message: string, options?: NotifyOptions): void => route('warning', message, options)
notify.error = (message: string, options?: NotifyOptions): void => route('error', message, options)

export { toast }
