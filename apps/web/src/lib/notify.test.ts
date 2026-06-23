import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const toastInfo = vi.fn()
const toastSuccess = vi.fn()
const toastWarning = vi.fn()
const toastError = vi.fn()

vi.mock('sonner', () => ({
  toast: {
    info: (m: string) => toastInfo(m),
    success: (m: string) => toastSuccess(m),
    warning: (m: string) => toastWarning(m),
    error: (m: string) => toastError(m),
  },
}))

import { notify, setHomeActive, isHomeActive } from './notify'
import {
  getActiveIslandNotification,
  clearIslandNotifications,
} from './islandNotifications'

describe('notify routing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearIslandNotifications()
    setHomeActive(false)
    toastInfo.mockClear()
    toastSuccess.mockClear()
    toastWarning.mockClear()
    toastError.mockClear()
  })

  afterEach(() => {
    clearIslandNotifications()
    setHomeActive(false)
    vi.useRealTimers()
  })

  it('routes to the standard toast when not on the home screen', () => {
    notify.success('Saved')
    expect(toastSuccess).toHaveBeenCalledWith('Saved')
    expect(getActiveIslandNotification()).toBeNull()
  })

  it('routes to the island when on the home screen', () => {
    setHomeActive(true)
    notify.success('Machine ready')
    expect(toastSuccess).not.toHaveBeenCalled()
    const active = getActiveIslandNotification()
    expect(active?.message).toBe('Machine ready')
    expect(active?.tone).toBe('success')
  })

  it('honours forceToast even on the home screen', () => {
    setHomeActive(true)
    notify.error('Critical', { forceToast: true })
    expect(toastError).toHaveBeenCalledWith('Critical')
    expect(getActiveIslandNotification()).toBeNull()
  })

  it('maps each tone helper to the matching toast method off-home', () => {
    notify.info('i')
    notify.warning('w')
    notify.error('e')
    expect(toastInfo).toHaveBeenCalledWith('i')
    expect(toastWarning).toHaveBeenCalledWith('w')
    expect(toastError).toHaveBeenCalledWith('e')
  })

  it('tracks the home-active flag', () => {
    expect(isHomeActive()).toBe(false)
    setHomeActive(true)
    expect(isHomeActive()).toBe(true)
  })
})
