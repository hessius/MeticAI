/**
 * DirectAdapter — MachineService implementation that talks directly
 * to the Meticulous machine via @meticulous-home/espresso-api.
 *
 * Used in machine-hosted PWA mode and Capacitor app mode.
 * Communicates via HTTP (axios) + Socket.IO (socket.io-client).
 */

import ApiModule from '@meticulous-home/espresso-api'
import type { Profile } from '@meticulous-home/espresso-profile'

// CJS default export interop — Rolldown may wrap the default export
const Api = typeof ApiModule === 'function' ? ApiModule : (ApiModule as { default: typeof ApiModule }).default
import type {
  MachineService,
  CommandResult,
  StatusCallback,
  ActuatorsCallback,
  NotificationCallback,
  ProfileUpdateCallback,
  ConnectionCallback,
  Unsubscribe,
} from './MachineService'
import type {
  ProfileIdent,
  DeviceInfo,
  HistoryListingEntry,
  Settings as MachineSettings,
} from '@meticulous-home/espresso-api'

// ---------------------------------------------------------------------------
// Helper to unwrap axios responses
// ---------------------------------------------------------------------------

function unwrap<T>(response: { data: T }): T {
  return response.data
}

function wrapResult(success: boolean, message?: string): CommandResult {
  return { success, message }
}

// ---------------------------------------------------------------------------
// DirectAdapter
// ---------------------------------------------------------------------------

export function createDirectAdapter(baseUrl: string): MachineService {
  const api = new Api(undefined, baseUrl)
  let connected = false
  const connectionCallbacks = new Set<ConnectionCallback>()
  const statusCallbacks = new Set<StatusCallback>()
  const actuatorCallbacks = new Set<ActuatorsCallback>()
  const notificationCallbacks = new Set<NotificationCallback>()
  const heaterStatusCallbacks = new Set<(countdown: number) => void>()
  const profileUpdateCallbacks = new Set<ProfileUpdateCallback>()

  function setConnected(value: boolean) {
    if (connected !== value) {
      connected = value
      connectionCallbacks.forEach(cb => cb(value))
    }
  }

  function setupSocketListeners() {
    const socket = api.getSocket()
    if (!socket) return

    socket.on('connect', () => setConnected(true))
    socket.on('disconnect', () => setConnected(false))
    socket.on('status', (data) => statusCallbacks.forEach(cb => cb(data)))
    socket.on('actuators', (data) => actuatorCallbacks.forEach(cb => cb(data)))
    socket.on('heater_status', (data: number) => heaterStatusCallbacks.forEach(cb => cb(data)))
    socket.on('notification', (data) => notificationCallbacks.forEach(cb => cb(data)))
    socket.on('profile', (data) => profileUpdateCallbacks.forEach(cb => cb(data)))
  }

  return {
    name: 'DirectAdapter',

    // -- Connection ---------------------------------------------------------
    connect: async () => {
      // URL is set at adapter creation time via createDirectAdapter(baseUrl).
      // The connect(url?) parameter from MachineService is intentionally unused:
      // the underlying espresso-api client is bound to baseUrl at construction.
      api.connectToSocket()
      setupSocketListeners()
    },
    disconnect: () => {
      api.disconnectSocket()
      setConnected(false)
    },
    isConnected: () => connected,
    onConnectionChange: (cb: ConnectionCallback): Unsubscribe => {
      connectionCallbacks.add(cb)
      return () => { connectionCallbacks.delete(cb) }
    },

    // -- Brewing commands ---------------------------------------------------
    startShot: async () => {
      try {
        await api.executeAction('start')
        return wrapResult(true)
      } catch (e) {
        return wrapResult(false, (e as Error).message)
      }
    },
    stopShot: async () => {
      try {
        await api.executeAction('stop')
        return wrapResult(true)
      } catch (e) {
        return wrapResult(false, (e as Error).message)
      }
    },
    abortShot: async () => {
      try {
        await api.executeAction('reset')
        return wrapResult(true)
      } catch (e) {
        return wrapResult(false, (e as Error).message)
      }
    },
    continueShot: async () => {
      try {
        await api.executeAction('continue')
        return wrapResult(true)
      } catch (e) {
        return wrapResult(false, (e as Error).message)
      }
    },

    // -- Machine commands ---------------------------------------------------
    preheat: async () => {
      try {
        await api.executeAction('preheat')
        return wrapResult(true)
      } catch (e) {
        return wrapResult(false, (e as Error).message)
      }
    },
    tareScale: async () => {
      try {
        await api.executeAction('tare')
        return wrapResult(true)
      } catch (e) {
        return wrapResult(false, (e as Error).message)
      }
    },
    homePlunger: async () => {
      // espresso-api doesn't have a dedicated home action — use reset
      try {
        await api.executeAction('reset')
        return wrapResult(true)
      } catch (e) {
        return wrapResult(false, (e as Error).message)
      }
    },
    purge: async () => {
      // No direct purge action in espresso-api; use start which triggers
      // the purge cycle if the machine state permits
      return wrapResult(false, 'Purge not available in direct mode')
    },

    // -- Configuration commands ---------------------------------------------
    loadProfile: async (name: string) => {
      try {
        const profiles = unwrap(await api.listProfiles()) as ProfileIdent[]
        const match = profiles.find(p => p.profile.name === name)
        if (!match) return wrapResult(false, `Profile "${name}" not found`)
        await api.loadProfileByID(match.profile.id)
        return wrapResult(true)
      } catch (e) {
        return wrapResult(false, (e as Error).message)
      }
    },
    loadProfileFromJSON: async (profile: Profile) => {
      try {
        await api.loadProfileFromJSON(profile)
        return wrapResult(true)
      } catch (e) {
        return wrapResult(false, (e as Error).message)
      }
    },
    setBrightness: async (value: number) => {
      try {
        await api.setBrightness({ brightness: value })
        return wrapResult(true)
      } catch (e) {
        return wrapResult(false, (e as Error).message)
      }
    },
    enableSounds: async (_enabled: boolean) => {
      // Sounds toggling requires updating the full settings object
      try {
        await api.updateSetting({ enable_sounds: _enabled })
        return wrapResult(true)
      } catch (e) {
        return wrapResult(false, (e as Error).message)
      }
    },

    // -- Profiles -----------------------------------------------------------
    listProfiles: async () => {
      return unwrap(await api.listProfiles()) as ProfileIdent[]
    },
    fetchAllProfiles: async () => {
      return unwrap(await api.fetchAllProfiles()) as Profile[]
    },
    getProfile: async (id: string) => {
      return unwrap(await api.getProfile(id)) as Profile
    },
    saveProfile: async (profile: Profile) => {
      return unwrap(await api.saveProfile(profile)) as ProfileIdent
    },
    deleteProfile: async (id: string) => {
      await api.deleteProfile(id)
    },

    // -- Telemetry ----------------------------------------------------------
    onStatus: (cb: StatusCallback): Unsubscribe => {
      statusCallbacks.add(cb)
      return () => { statusCallbacks.delete(cb) }
    },
    onActuators: (cb: ActuatorsCallback): Unsubscribe => {
      actuatorCallbacks.add(cb)
      return () => { actuatorCallbacks.delete(cb) }
    },
    onHeaterStatus: (cb: (countdown: number) => void): Unsubscribe => {
      heaterStatusCallbacks.add(cb)
      return () => { heaterStatusCallbacks.delete(cb) }
    },
    onNotification: (cb: NotificationCallback): Unsubscribe => {
      notificationCallbacks.add(cb)
      return () => { notificationCallbacks.delete(cb) }
    },
    onProfileUpdate: (cb: ProfileUpdateCallback): Unsubscribe => {
      profileUpdateCallbacks.add(cb)
      return () => { profileUpdateCallbacks.delete(cb) }
    },

    // -- History ------------------------------------------------------------
    getHistoryListing: async () => {
      const resp = unwrap(await api.getHistoryShortListing())
      return (resp.history ?? []) as HistoryListingEntry[]
    },
    getLastShot: async () => {
      try {
        const resp = unwrap(await api.getLastShot())
        return resp as HistoryListingEntry | null
      } catch {
        return null
      }
    },

    // -- Settings / Device --------------------------------------------------
    getSettings: async () => {
      return unwrap(await api.getSettings()) as MachineSettings
    },
    updateSetting: async (settings: Partial<MachineSettings>) => {
      return unwrap(await api.updateSetting(settings)) as MachineSettings
    },
    getDeviceInfo: async () => {
      return unwrap(await api.getDeviceInfo()) as DeviceInfo
    },
  }
}
