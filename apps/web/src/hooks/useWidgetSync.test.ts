import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setFavourites, setMachineUrl, setOpenAppOnStart, reloadWidgets } = vi.hoisted(() => ({
  setFavourites: vi.fn(async () => {}),
  setMachineUrl: vi.fn(async () => {}),
  setOpenAppOnStart: vi.fn(async () => {}),
  reloadWidgets: vi.fn(async () => {}),
}))
vi.mock('@/services/widgets/widgetBridge', () => ({
  WidgetBridge: { setFavourites, setMachineUrl, setOpenAppOnStart, reloadWidgets },
}))

const { getPlatform } = vi.hoisted(() => ({ getPlatform: vi.fn(() => 'ios') }))
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => getPlatform() } }))

vi.mock('@/services/favourites/favouritesStore', () => ({
  loadFavourites: vi.fn(async () => [{ id: 'a', name: 'Alpha' }]),
}))
vi.mock('@/services/machine/machineUrl', () => ({
  resolveMachineUrl: vi.fn(async () => 'http://machine.local:8080'),
  MACHINE_URL_CHANGED: 'machine-url-changed',
}))

import { useWidgetSync } from './useWidgetSync'

describe('useWidgetSync', () => {
  beforeEach(() => {
    setFavourites.mockClear(); setMachineUrl.mockClear()
    setOpenAppOnStart.mockClear(); reloadWidgets.mockClear()
    getPlatform.mockReturnValue('ios')
  })

  it('mirrors favourites + machine url on mount and reloads widgets (iOS)', async () => {
    renderHook(() => useWidgetSync({ openAppOnStart: false }))
    await waitFor(() => expect(setFavourites).toHaveBeenCalled())
    expect(setFavourites).toHaveBeenCalledWith({ favourites: [{ id: 'a', name: 'Alpha' }] })
    expect(setMachineUrl).toHaveBeenCalledWith({ url: 'http://machine.local:8080' })
    expect(setOpenAppOnStart).toHaveBeenCalledWith({ enabled: false })
    expect(reloadWidgets).toHaveBeenCalled()
  })

  it('is a no-op off iOS', async () => {
    getPlatform.mockReturnValue('android')
    renderHook(() => useWidgetSync({ openAppOnStart: true }))
    await new Promise(r => setTimeout(r, 20))
    expect(setFavourites).not.toHaveBeenCalled()
    expect(reloadWidgets).not.toHaveBeenCalled()
  })
})
