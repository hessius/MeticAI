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
  loadFavourites: vi.fn(async () => [
    { id: 'a', name: 'Alpha' },
    {
      id: 'b',
      name: 'Beta',
      imageUrl: 'http://machine.local:80/api/v1/profile/image/abc.jpeg',
    },
  ]),
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
    // Machine image URLs are re-hosted onto the current machine base (:80 -> :8080).
    expect(setFavourites).toHaveBeenCalledWith({
      favourites: [
        { id: 'a', name: 'Alpha', imageUrl: undefined },
        {
          id: 'b',
          name: 'Beta',
          imageUrl: 'http://machine.local:8080/api/v1/profile/image/abc.jpeg',
        },
      ],
    })
    expect(setMachineUrl).toHaveBeenCalledWith({ url: 'http://machine.local:8080' })
    expect(setOpenAppOnStart).toHaveBeenCalledWith({ enabled: false })
    expect(reloadWidgets).toHaveBeenCalled()
  })

  it('re-pushes favourites when the machine url changes', async () => {
    renderHook(() => useWidgetSync({ openAppOnStart: false }))
    await waitFor(() => expect(setFavourites).toHaveBeenCalled())
    setFavourites.mockClear()
    window.dispatchEvent(new Event('machine-url-changed'))
    await waitFor(() => expect(setFavourites).toHaveBeenCalled())
  })

  it('is a no-op off iOS', async () => {
    getPlatform.mockReturnValue('android')
    renderHook(() => useWidgetSync({ openAppOnStart: true }))
    await new Promise(r => setTimeout(r, 20))
    expect(setFavourites).not.toHaveBeenCalled()
    expect(reloadWidgets).not.toHaveBeenCalled()
  })
})
