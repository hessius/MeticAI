import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  pushIslandNotification,
  subscribeIslandNotifications,
  getActiveIslandNotification,
  dismissActiveIslandNotification,
  clearIslandNotifications,
} from './islandNotifications'

describe('islandNotifications', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearIslandNotifications()
  })

  afterEach(() => {
    clearIslandNotifications()
    vi.useRealTimers()
  })

  it('shows a pushed notification immediately and reports it as active', () => {
    pushIslandNotification({ message: 'Machine ready', tone: 'success' })
    const active = getActiveIslandNotification()
    expect(active?.message).toBe('Machine ready')
    expect(active?.tone).toBe('success')
  })

  it('defaults tone to info and assigns an id', () => {
    const n = pushIslandNotification({ message: 'Hello' })
    expect(n.tone).toBe('info')
    expect(n.id).toBeTruthy()
  })

  it('auto-dismisses after the duration and clears the active notification', () => {
    pushIslandNotification({ message: 'Temporary', durationMs: 1000 })
    expect(getActiveIslandNotification()).not.toBeNull()
    vi.advanceTimersByTime(1000)
    expect(getActiveIslandNotification()).toBeNull()
  })

  it('queues notifications and shows them sequentially', () => {
    pushIslandNotification({ message: 'First', durationMs: 1000 })
    pushIslandNotification({ message: 'Second', durationMs: 1000 })
    expect(getActiveIslandNotification()?.message).toBe('First')
    vi.advanceTimersByTime(1000)
    expect(getActiveIslandNotification()?.message).toBe('Second')
    vi.advanceTimersByTime(1000)
    expect(getActiveIslandNotification()).toBeNull()
  })

  it('notifies subscribers on change and supports unsubscribe', () => {
    const seen: (string | null)[] = []
    const unsubscribe = subscribeIslandNotifications(active => seen.push(active?.message ?? null))
    expect(seen).toEqual([null]) // initial emit
    pushIslandNotification({ message: 'Ping', durationMs: 1000 })
    expect(seen).toEqual([null, 'Ping'])
    unsubscribe()
    pushIslandNotification({ message: 'After unsub', durationMs: 1000 })
    expect(seen).toEqual([null, 'Ping'])
  })

  it('dismisses the active notification immediately and advances the queue', () => {
    pushIslandNotification({ message: 'A', durationMs: 5000 })
    pushIslandNotification({ message: 'B', durationMs: 5000 })
    dismissActiveIslandNotification()
    expect(getActiveIslandNotification()?.message).toBe('B')
  })
})
