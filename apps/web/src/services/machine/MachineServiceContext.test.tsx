import { render, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { STORAGE_KEYS } from '@/lib/constants'
import type { MachineService } from './MachineService'

const adapterMocks = vi.hoisted(() => ({
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(),
  createDirectAdapter: vi.fn((url: string) => ({
    url,
    connect: adapterMocks.connect,
    disconnect: adapterMocks.disconnect,
  } as unknown as MachineService)),
  resolveMachineUrl: vi.fn(async () => 'http://native-preferences:8080'),
}))

vi.mock('@/lib/machineMode', () => ({
  getMachineMode: vi.fn(() => 'direct'),
  isNativePlatform: vi.fn(() => true),
  getDefaultMachineUrl: vi.fn(() => localStorage.getItem('meticai-machine-url') || 'http://meticulous.local:8080'),
}))

vi.mock('./machineUrl', () => ({
  MACHINE_URL_CHANGED: 'machine-url-changed',
  getMachineUrlFallback: vi.fn(() => 'http://meticulous.local:8080'),
  resolveMachineUrl: adapterMocks.resolveMachineUrl,
}))

vi.mock('./DirectAdapter', () => ({
  createDirectAdapter: adapterMocks.createDirectAdapter,
}))

vi.mock('./MeticAIAdapter', () => ({
  meticAIAdapter: {
    connect: vi.fn(async () => undefined),
    disconnect: vi.fn(),
  },
}))

import { MachineServiceProvider } from './MachineServiceContext'

describe('MachineServiceProvider native URL resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('starts with localStorage URL then updates to native Preferences URL', async () => {
    localStorage.setItem(STORAGE_KEYS.MACHINE_URL, 'http://stale-web-url:8080')

    render(
      <MachineServiceProvider>
        <div>consumer</div>
      </MachineServiceProvider>,
    )

    // Provider renders immediately with localStorage URL (sync, instant)
    expect(adapterMocks.createDirectAdapter).toHaveBeenCalledWith('http://stale-web-url:8080')

    // After async resolution, adapter is recreated with the native Preferences URL
    await waitFor(() => {
      expect(adapterMocks.createDirectAdapter).toHaveBeenCalledWith('http://native-preferences:8080')
    })
    await waitFor(() => {
      expect(adapterMocks.connect).toHaveBeenCalledWith('http://native-preferences:8080')
    })
  })

  it('recovers with a native-safe fallback when URL resolution fails', async () => {
    adapterMocks.resolveMachineUrl.mockRejectedValueOnce(new Error('Preferences unavailable'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    render(
      <MachineServiceProvider>
        <div>consumer</div>
      </MachineServiceProvider>,
    )

    await waitFor(() => {
      expect(adapterMocks.createDirectAdapter).toHaveBeenCalledWith('http://meticulous.local:8080')
    })
    await waitFor(() => {
      expect(adapterMocks.connect).toHaveBeenCalledWith('http://meticulous.local:8080')
    })
  })
})
