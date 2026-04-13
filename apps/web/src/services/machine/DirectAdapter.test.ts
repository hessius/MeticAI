/**
 * DirectAdapter unit tests — verify functional behavior of the direct
 * machine adapter (HTTP + Socket.IO communication).
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSocket = {
  on: vi.fn(),
  removeAllListeners: vi.fn(),
}

const mockApi = {
  connectToSocket: vi.fn(),
  disconnectSocket: vi.fn(),
  getSocket: vi.fn(() => mockSocket),
  executeAction: vi.fn(),
  listProfiles: vi.fn(() => ({ data: [] as unknown[] })),
  fetchAllProfiles: vi.fn(() => ({ data: [] as unknown[] })),
  getProfile: vi.fn(() => ({ data: {} })),
  saveProfile: vi.fn(() => ({ data: {} })),
  deleteProfile: vi.fn(),
  loadProfileByID: vi.fn(),
  loadProfileFromJSON: vi.fn(),
  setBrightness: vi.fn(),
  updateSetting: vi.fn(() => ({ data: {} })),
  getHistoryShortListing: vi.fn(() => ({ data: { history: [] as unknown[] } })),
  getLastShot: vi.fn(() => ({ data: null as unknown })),
  getSettings: vi.fn(() => ({ data: {} })),
  getDeviceInfo: vi.fn(() => ({ data: {} })),
}

vi.mock('@meticulous-home/espresso-api', () => {
  function MockApi() { return mockApi }
  return { default: MockApi }
})

vi.mock('./machineApi', () => ({
  getMachineApi: vi.fn(() => mockApi),
}))

// Import after mocks are set up
import { createDirectAdapter } from './DirectAdapter'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a specific socket listener registered via mockSocket.on */
function getSocketListener(event: string): (...args: unknown[]) => void {
  const call = (mockSocket.on as Mock).mock.calls.find(
    (c: unknown[]) => c[0] === event,
  )
  if (!call) throw new Error(`No socket listener registered for '${event}'`)
  return call[1] as (...args: unknown[]) => void
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DirectAdapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset fetch mock
    globalThis.fetch = vi.fn()
  })

  describe('createDirectAdapter', () => {
    it('returns a service with name "DirectAdapter"', () => {
      const svc = createDirectAdapter('http://machine:8080')
      expect(svc.name).toBe('DirectAdapter')
    })

    it('starts disconnected', () => {
      const svc = createDirectAdapter('http://machine:8080')
      expect(svc.isConnected()).toBe(false)
    })
  })

  describe('connect()', () => {
    it('calls api.connectToSocket and sets up socket listeners', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      await svc.connect('')
      expect(mockApi.connectToSocket).toHaveBeenCalled()
      expect(mockSocket.removeAllListeners).toHaveBeenCalled()
      expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function))
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function))
      expect(mockSocket.on).toHaveBeenCalledWith('status', expect.any(Function))
      expect(mockSocket.on).toHaveBeenCalledWith('actuators', expect.any(Function))
      expect(mockSocket.on).toHaveBeenCalledWith('notification', expect.any(Function))
      expect(mockSocket.on).toHaveBeenCalledWith('profile', expect.any(Function))
    })

    it('seeds initial status from settings and history', async () => {
      mockApi.getSettings.mockResolvedValueOnce({
        data: { enable_sounds: true },
      })
      mockApi.getHistoryShortListing.mockResolvedValueOnce({
        data: { history: [{ id: '1' }, { id: '2' }] },
      })

      const svc = createDirectAdapter('http://machine:8080')
      const statusCb = vi.fn()
      svc.onStatus(statusCb)
      await svc.connect('')

      expect(statusCb).toHaveBeenCalledWith(
        expect.objectContaining({ sounds_enabled: true, total_shots: 2 }),
      )
    })

    it('does not throw if initial seeding fails', async () => {
      mockApi.getSettings.mockRejectedValueOnce(new Error('timeout'))
      mockApi.getHistoryShortListing.mockRejectedValueOnce(new Error('timeout'))

      const svc = createDirectAdapter('http://machine:8080')
      await expect(svc.connect('')).resolves.toBeUndefined()
    })
  })

  describe('socket events → callbacks', () => {
    let svc: ReturnType<typeof createDirectAdapter>

    beforeEach(async () => {
      svc = createDirectAdapter('http://machine:8080')
      await svc.connect('')
    })

    it('socket "connect" sets connected=true and fires connection callbacks', () => {
      const cb = vi.fn()
      svc.onConnectionChange(cb)

      const connectListener = getSocketListener('connect')
      connectListener()

      expect(svc.isConnected()).toBe(true)
      expect(cb).toHaveBeenCalledWith(true)
    })

    it('socket "disconnect" sets connected=false and fires connection callbacks', () => {
      // First connect so state changes
      getSocketListener('connect')()
      const cb = vi.fn()
      svc.onConnectionChange(cb)

      getSocketListener('disconnect')()
      expect(svc.isConnected()).toBe(false)
      expect(cb).toHaveBeenCalledWith(false)
    })

    it('socket "status" fires status callbacks', () => {
      const cb = vi.fn()
      svc.onStatus(cb)
      const data = { state: 'idle', temperature: 93 }
      getSocketListener('status')(data)
      expect(cb).toHaveBeenCalledWith(data)
    })

    it('socket "actuators" fires actuator callbacks', () => {
      const cb = vi.fn()
      svc.onActuators(cb)
      const data = { pump: 0, heater: 1 }
      getSocketListener('actuators')(data)
      expect(cb).toHaveBeenCalledWith(data)
    })

    it('socket "heater_status" fires heater status callbacks', () => {
      const cb = vi.fn()
      svc.onHeaterStatus(cb)
      getSocketListener('heater_status')(42)
      expect(cb).toHaveBeenCalledWith(42)
    })

    it('socket "notification" fires notification callbacks', () => {
      const cb = vi.fn()
      svc.onNotification(cb)
      const data = { type: 'info', message: 'Ready' }
      getSocketListener('notification')(data)
      expect(cb).toHaveBeenCalledWith(data)
    })

    it('socket "profile" fires profile update callbacks', () => {
      const cb = vi.fn()
      svc.onProfileUpdate(cb)
      const data = { change: 'loaded', profile_id: '123' }
      getSocketListener('profile')(data)
      expect(cb).toHaveBeenCalledWith(data)
    })
  })

  describe('disconnect()', () => {
    it('disconnects socket and sets connected=false', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      await svc.connect('')
      getSocketListener('connect')()
      expect(svc.isConnected()).toBe(true)

      svc.disconnect()
      expect(mockApi.disconnectSocket).toHaveBeenCalled()
      expect(svc.isConnected()).toBe(false)
    })

    it('fires connection callbacks on disconnect', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      await svc.connect('')
      getSocketListener('connect')()

      const cb = vi.fn()
      svc.onConnectionChange(cb)
      svc.disconnect()
      expect(cb).toHaveBeenCalledWith(false)
    })
  })

  describe('callback subscribe/unsubscribe', () => {
    it('unsubscribe removes callback from future events', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      await svc.connect('')

      const cb = vi.fn()
      const unsub = svc.onStatus(cb)

      getSocketListener('status')({ state: 'idle' })
      expect(cb).toHaveBeenCalledTimes(1)

      unsub()

      getSocketListener('status')({ state: 'brewing' })
      expect(cb).toHaveBeenCalledTimes(1) // Not called again
    })

    it('connection callback unsubscribe works', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      await svc.connect('')

      const cb = vi.fn()
      const unsub = svc.onConnectionChange(cb)

      getSocketListener('connect')()
      expect(cb).toHaveBeenCalledTimes(1)

      unsub()
      getSocketListener('disconnect')()
      // Should not be called again after unsubscribe
      expect(cb).toHaveBeenCalledTimes(1)
    })
  })

  describe('brewing commands', () => {
    let svc: ReturnType<typeof createDirectAdapter>

    beforeEach(() => {
      svc = createDirectAdapter('http://machine:8080')
    })

    it('startShot() calls executeAction("start")', async () => {
      mockApi.executeAction.mockResolvedValueOnce(undefined)
      const result = await svc.startShot()
      expect(mockApi.executeAction).toHaveBeenCalledWith('start')
      expect(result).toEqual({ success: true })
    })

    it('startShot() returns failure on error', async () => {
      mockApi.executeAction.mockRejectedValueOnce(new Error('Connection lost'))
      const result = await svc.startShot()
      expect(result).toEqual({ success: false, message: 'Connection lost' })
    })

    it('stopShot() calls executeAction("stop")', async () => {
      mockApi.executeAction.mockResolvedValueOnce(undefined)
      const result = await svc.stopShot()
      expect(mockApi.executeAction).toHaveBeenCalledWith('stop')
      expect(result).toEqual({ success: true })
    })

    it('continueShot() calls executeAction("continue")', async () => {
      mockApi.executeAction.mockResolvedValueOnce(undefined)
      const result = await svc.continueShot()
      expect(mockApi.executeAction).toHaveBeenCalledWith('continue')
      expect(result).toEqual({ success: true })
    })
  })

  describe('abortShot()', () => {
    it('sends raw "reset" action via fetch and clears preheat_countdown', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({ ok: true })

      const statusCb = vi.fn()
      svc.onStatus(statusCb)

      const result = await svc.abortShot()

      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://machine:8080/api/v1/action/reset',
        { method: 'POST' },
      )
      expect(result).toEqual({ success: true })
      expect(statusCb).toHaveBeenCalledWith({ preheat_countdown: 0 })
    })

    it('does not clear preheat_countdown on failure', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        statusText: 'Internal Server Error',
      })

      const statusCb = vi.fn()
      svc.onStatus(statusCb)

      const result = await svc.abortShot()

      expect(result.success).toBe(false)
      expect(result.message).toContain('reset failed')
      expect(statusCb).not.toHaveBeenCalled()
    })

    it('handles fetch errors gracefully', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      ;(globalThis.fetch as Mock).mockRejectedValueOnce(new Error('Network error'))

      const result = await svc.abortShot()
      expect(result).toEqual({ success: false, message: 'Network error' })
    })
  })

  describe('machine commands', () => {
    let svc: ReturnType<typeof createDirectAdapter>

    beforeEach(() => {
      svc = createDirectAdapter('http://machine:8080')
    })

    it('preheat() calls executeAction("preheat")', async () => {
      mockApi.executeAction.mockResolvedValueOnce(undefined)
      const result = await svc.preheat()
      expect(mockApi.executeAction).toHaveBeenCalledWith('preheat')
      expect(result).toEqual({ success: true })
    })

    it('tareScale() calls executeAction("tare")', async () => {
      mockApi.executeAction.mockResolvedValueOnce(undefined)
      const result = await svc.tareScale()
      expect(mockApi.executeAction).toHaveBeenCalledWith('tare')
      expect(result).toEqual({ success: true })
    })

    it('purge() sends raw "home" action (NOT "purge")', async () => {
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({ ok: true })
      const result = await svc.purge()
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://machine:8080/api/v1/action/home',
        { method: 'POST' },
      )
      expect(result).toEqual({ success: true })
    })

    it('homePlunger() sends raw "home" action', async () => {
      ;(globalThis.fetch as Mock).mockResolvedValueOnce({ ok: true })
      const result = await svc.homePlunger()
      expect(globalThis.fetch).toHaveBeenCalledWith(
        'http://machine:8080/api/v1/action/home',
        { method: 'POST' },
      )
      expect(result).toEqual({ success: true })
    })
  })

  describe('enableSounds()', () => {
    it('calls updateSetting and fires optimistic status update', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      mockApi.updateSetting.mockResolvedValueOnce({ data: {} })

      const statusCb = vi.fn()
      svc.onStatus(statusCb)

      const result = await svc.enableSounds(true)

      expect(mockApi.updateSetting).toHaveBeenCalledWith({ enable_sounds: true })
      expect(statusCb).toHaveBeenCalledWith({ sounds_enabled: true })
      expect(result).toEqual({ success: true })
    })

    it('fires optimistic update with false when disabling', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      mockApi.updateSetting.mockResolvedValueOnce({ data: {} })

      const statusCb = vi.fn()
      svc.onStatus(statusCb)

      await svc.enableSounds(false)
      expect(statusCb).toHaveBeenCalledWith({ sounds_enabled: false })
    })

    it('does not fire optimistic update on error', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      mockApi.updateSetting.mockRejectedValueOnce(new Error('fail'))

      const statusCb = vi.fn()
      svc.onStatus(statusCb)

      const result = await svc.enableSounds(true)
      expect(result.success).toBe(false)
      expect(statusCb).not.toHaveBeenCalled()
    })
  })

  describe('loadProfile()', () => {
    it('finds profile by name and loads by ID', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      mockApi.listProfiles.mockResolvedValueOnce({
        data: [
          { profile: { id: 'abc', name: 'Espresso' } },
          { profile: { id: 'def', name: 'Lungo' } },
        ],
      })

      const result = await svc.loadProfile('Lungo')

      expect(mockApi.loadProfileByID).toHaveBeenCalledWith('def')
      expect(result).toEqual({ success: true })
    })

    it('returns failure if profile name not found', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      mockApi.listProfiles.mockResolvedValueOnce({ data: [] })

      const result = await svc.loadProfile('Nonexistent')
      expect(result.success).toBe(false)
      expect(result.message).toContain('not found')
    })
  })

  describe('settings and device info', () => {
    let svc: ReturnType<typeof createDirectAdapter>

    beforeEach(() => {
      svc = createDirectAdapter('http://machine:8080')
    })

    it('getSettings() unwraps response', async () => {
      mockApi.getSettings.mockResolvedValueOnce({
        data: { enable_sounds: true, brightness: 80 },
      })
      const settings = await svc.getSettings()
      expect(settings).toEqual({ enable_sounds: true, brightness: 80 })
    })

    it('updateSetting() passes settings and unwraps response', async () => {
      mockApi.updateSetting.mockResolvedValueOnce({
        data: { enable_sounds: false },
      })
      const result = await svc.updateSetting({ enable_sounds: false })
      expect(mockApi.updateSetting).toHaveBeenCalledWith({ enable_sounds: false })
      expect(result).toEqual({ enable_sounds: false })
    })

    it('getDeviceInfo() unwraps response', async () => {
      mockApi.getDeviceInfo.mockResolvedValueOnce({
        data: { serial: 'ABC123', firmware: '1.2.0' },
      })
      const info = await svc.getDeviceInfo()
      expect(info).toEqual({ serial: 'ABC123', firmware: '1.2.0' })
    })
  })

  describe('history', () => {
    let svc: ReturnType<typeof createDirectAdapter>

    beforeEach(() => {
      svc = createDirectAdapter('http://machine:8080')
    })

    it('getHistoryListing() returns history array', async () => {
      const entries = [{ id: '1' }, { id: '2' }]
      mockApi.getHistoryShortListing.mockResolvedValueOnce({
        data: { history: entries },
      })
      const result = await svc.getHistoryListing()
      expect(result).toEqual(entries)
    })

    it('getHistoryListing() returns empty array when history is missing', async () => {
      mockApi.getHistoryShortListing.mockResolvedValueOnce({ data: { history: [] } })
      const result = await svc.getHistoryListing()
      expect(result).toEqual([])
    })

    it('getLastShot() returns the shot data', async () => {
      const shot = { id: '42', profile_name: 'Espresso' }
      mockApi.getLastShot.mockResolvedValueOnce({ data: shot })
      const result = await svc.getLastShot()
      expect(result).toEqual(shot)
    })

    it('getLastShot() returns null on error', async () => {
      mockApi.getLastShot.mockRejectedValueOnce(new Error('no shots'))
      const result = await svc.getLastShot()
      expect(result).toBeNull()
    })
  })

  describe('profiles', () => {
    let svc: ReturnType<typeof createDirectAdapter>

    beforeEach(() => {
      svc = createDirectAdapter('http://machine:8080')
    })

    it('listProfiles() unwraps response', async () => {
      const profiles = [{ profile: { id: '1', name: 'Espresso' } }]
      mockApi.listProfiles.mockResolvedValueOnce({ data: profiles })
      const result = await svc.listProfiles()
      expect(result).toEqual(profiles)
    })

    it('deleteProfile() delegates to api', async () => {
      await svc.deleteProfile('abc')
      expect(mockApi.deleteProfile).toHaveBeenCalledWith('abc')
    })
  })

  describe('setBrightness()', () => {
    it('calls api.setBrightness with correct payload', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      mockApi.setBrightness.mockResolvedValueOnce(undefined)
      const result = await svc.setBrightness(75)
      expect(mockApi.setBrightness).toHaveBeenCalledWith({ brightness: 75 })
      expect(result).toEqual({ success: true })
    })

    it('returns failure on error', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      mockApi.setBrightness.mockRejectedValueOnce(new Error('invalid'))
      const result = await svc.setBrightness(-1)
      expect(result).toEqual({ success: false, message: 'invalid' })
    })
  })

  describe('connection state deduplication', () => {
    it('does not fire callbacks when connected state is unchanged', async () => {
      const svc = createDirectAdapter('http://machine:8080')
      await svc.connect('')

      const cb = vi.fn()
      svc.onConnectionChange(cb)

      // Already disconnected (default) — calling disconnect again should not fire
      svc.disconnect()
      // The initial disconnect fires because connect sets up listeners but
      // connected starts as false. After first setConnected(false) it's a no-op.
      cb.mockClear()

      svc.disconnect()
      expect(cb).not.toHaveBeenCalled()
    })
  })
})
