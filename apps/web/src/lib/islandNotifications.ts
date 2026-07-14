// In-app Dynamic Island notification bus (#439).
//
// When the user is on the home screen, transient notifications are routed into
// the in-app "Dynamic Island" pill (see App.tsx) instead of a standard toast.
// This module is the runtime-agnostic store: it holds a single active
// notification, queues any that arrive while one is showing, auto-dismisses on a
// timer, and restores the island's previous content (the smart greeting) once
// the queue drains. The routing decision (island vs. toast) lives in notify.ts.

export type IslandTone = 'info' | 'success' | 'warning' | 'error'

export interface IslandNotification {
  id: string
  message: string
  tone: IslandTone
  /** Auto-dismiss delay in ms. */
  durationMs: number
}

export interface IslandNotificationInput {
  message: string
  tone?: IslandTone
  durationMs?: number
  id?: string
}

const DEFAULT_DURATION_MS = 4000

type Listener = (active: IslandNotification | null) => void

const listeners = new Set<Listener>()
let queue: IslandNotification[] = []
let active: IslandNotification | null = null
let timer: ReturnType<typeof setTimeout> | null = null

// crypto.randomUUID() is unavailable on insecure-context (plain-http LAN)
// deployments, so guard it the same way the rest of the app does.
function generateId(): string {
  try {
    const id = globalThis.crypto?.randomUUID?.()
    if (id) return id
  } catch {
    /* fall through */
  }
  return `island-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function emit(): void {
  for (const listener of listeners) listener(active)
}

function clearTimer(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

function showNext(): void {
  clearTimer()
  active = queue.shift() ?? null
  emit()
  if (active) {
    const current = active
    timer = setTimeout(() => {
      // Only advance if this notification is still the active one.
      if (active && active.id === current.id) showNext()
    }, current.durationMs)
  }
}

/** Subscribe to active-notification changes. Returns an unsubscribe function. */
export function subscribeIslandNotifications(listener: Listener): () => void {
  listeners.add(listener)
  listener(active)
  return () => {
    listeners.delete(listener)
  }
}

/** The notification currently displayed in the island, if any. */
export function getActiveIslandNotification(): IslandNotification | null {
  return active
}

/** Enqueue a notification. Shows immediately if the island is idle. */
export function pushIslandNotification(input: IslandNotificationInput): IslandNotification {
  const notification: IslandNotification = {
    id: input.id ?? generateId(),
    message: input.message,
    tone: input.tone ?? 'info',
    durationMs: input.durationMs ?? DEFAULT_DURATION_MS,
  }
  queue.push(notification)
  if (!active) showNext()
  return notification
}

/** Dismiss the active notification immediately and advance to the next, if any. */
export function dismissActiveIslandNotification(): void {
  if (!active) return
  showNext()
}

/** Reset all state. Intended for tests. */
export function clearIslandNotifications(): void {
  clearTimer()
  queue = []
  active = null
  emit()
}
