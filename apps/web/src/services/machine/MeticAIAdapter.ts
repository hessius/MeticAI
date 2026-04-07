/**
 * MeticAIAdapter — MachineService proxy implementation.
 *
 * Delegates machine commands to the MeticAI backend REST API endpoints,
 * which in turn publish MQTT messages to the Mosquitto broker.
 *
 * Telemetry and connection lifecycle are no-ops here — those are handled
 * by useWebSocket in proxy mode (the backend already bridges them).
 */

import type {
  MachineService,
  CommandResult,
  Unsubscribe,
} from './MachineService'
import type { Profile } from '@meticulous-home/espresso-profile'
import type {
  ProfileIdent,
  DeviceInfo,
  HistoryListingEntry,
  Settings as MachineSettings,
} from '@meticulous-home/espresso-api'
import { getServerUrl } from '@/lib/config'
import { apiFetch } from '@/services/api'

// ---------------------------------------------------------------------------
// Internal Helper
// ---------------------------------------------------------------------------

async function postCommand(
  path: string,
  body?: Record<string, unknown>,
): Promise<CommandResult> {
  const base = await getServerUrl()
  try {
    const data = await apiFetch<{ success?: boolean; status?: string; message?: string }>(
      `${base}/api/machine/command${path}`,
      {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      },
    )
    return { success: data.success ?? data.status === 'ok', message: data.message }
  } catch (err) {
    return { success: false, message: err instanceof Error ? err.message : 'Command failed' }
  }
}

// ---------------------------------------------------------------------------
// Adapter Implementation
// ---------------------------------------------------------------------------

export function createMeticAIAdapter(): MachineService {
  const noop: Unsubscribe = () => {}

  return {
    name: 'MeticAIAdapter',

    // -- Connection (no-ops — handled by useWebSocket in proxy mode) --------
    connect: async () => {},
    disconnect: () => {},
    isConnected: () => true,
    onConnectionChange: () => noop,

    // -- Brewing commands ---------------------------------------------------
    startShot: () => postCommand('/start'),
    stopShot: () => postCommand('/stop'),
    abortShot: () => postCommand('/abort'),
    continueShot: () => postCommand('/continue'),

    // -- Machine commands ---------------------------------------------------
    preheat: () => postCommand('/preheat'),
    tareScale: () => postCommand('/tare'),
    homePlunger: () => postCommand('/home-plunger'),
    purge: () => postCommand('/purge'),

    // -- Configuration commands ---------------------------------------------
    loadProfile: (name: string) => postCommand('/load-profile', { name }),
    loadProfileFromJSON: async (profile: Profile) => {
      const base = await getServerUrl()
      try {
        await apiFetch(`${base}/api/machine/run-profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(profile),
        })
        return { success: true }
      } catch (err) {
        return { success: false, message: err instanceof Error ? err.message : 'Load failed' }
      }
    },
    setBrightness: (value: number) => postCommand('/brightness', { value }),
    enableSounds: (enabled: boolean) => postCommand('/sounds', { enabled }),

    // -- Profiles (via backend proxy) ---------------------------------------
    listProfiles: async () => {
      const base = await getServerUrl()
      return apiFetch<ProfileIdent[]>(`${base}/api/machine/profiles`)
    },
    fetchAllProfiles: async () => {
      const base = await getServerUrl()
      const idents = await apiFetch<ProfileIdent[]>(`${base}/api/machine/profiles`)
      return idents.map(pi => pi.profile)
    },
    getProfile: async (id: string) => {
      const base = await getServerUrl()
      return apiFetch<Profile>(`${base}/api/machine/profile/${encodeURIComponent(id)}`)
    },
    saveProfile: async (profile: Profile) => {
      const base = await getServerUrl()
      return apiFetch<ProfileIdent>(`${base}/api/machine/profiles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      })
    },
    deleteProfile: async (id: string) => {
      const base = await getServerUrl()
      await apiFetch(`${base}/api/machine/profiles/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
    },

    // -- Telemetry (no-ops in proxy mode) -----------------------------------
    onStatus: () => noop,
    onActuators: () => noop,
    onHeaterStatus: () => noop,
    onNotification: () => noop,
    onProfileUpdate: () => noop,

    // -- History (via backend proxy) ----------------------------------------
    getHistoryListing: async () => {
      const base = await getServerUrl()
      const resp = await apiFetch<{ history: HistoryListingEntry[] }>(
        `${base}/api/shots/dates`
      )
      return resp.history ?? []
    },
    getLastShot: async () => {
      const base = await getServerUrl()
      try {
        return await apiFetch<HistoryListingEntry>(`${base}/api/shots/recent`)
      } catch {
        return null
      }
    },

    // -- Settings / Device --------------------------------------------------
    getSettings: async () => {
      const base = await getServerUrl()
      return apiFetch<MachineSettings>(`${base}/api/settings`)
    },
    updateSetting: async (settings: Partial<MachineSettings>) => {
      const base = await getServerUrl()
      return apiFetch<MachineSettings>(`${base}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
    },
    getDeviceInfo: async () => {
      const base = await getServerUrl()
      return apiFetch<DeviceInfo>(`${base}/api/machine/device-info`)
    },
  }
}

export const meticAIAdapter = createMeticAIAdapter()
