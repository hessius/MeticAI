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
      // Backend returns flat profile dicts; wrap as ProfileIdent for interface
      const resp = await apiFetch<{ profiles: Profile[] }>(`${base}/api/machine/profiles`)
      return (resp.profiles ?? []).map(p => ({ change_id: p.id, profile: p }))
    },
    fetchAllProfiles: async () => {
      const base = await getServerUrl()
      const listing = await apiFetch<{ profiles: Array<{ id: string }> }>(`${base}/api/machine/profiles`)
      const ids = (listing.profiles ?? []).map(p => p.id)
      const profiles = await Promise.all(
        ids.map(async (id) => {
          try {
            const resp = await apiFetch<{ profile: Profile }>(`${base}/api/machine/profile/${encodeURIComponent(id)}/json`)
            return resp.profile
          } catch {
            return null
          }
        })
      )
      return profiles.filter((p): p is Profile => p !== null)
    },
    getProfile: async (id: string) => {
      const base = await getServerUrl()
      const resp = await apiFetch<{ profile: Profile }>(`${base}/api/machine/profile/${encodeURIComponent(id)}`)
      return resp.profile
    },
    saveProfile: async (profile: Profile) => {
      const base = await getServerUrl()
      return apiFetch<ProfileIdent>(`${base}/api/profile/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      })
    },
    deleteProfile: async (id: string) => {
      const base = await getServerUrl()
      await apiFetch(`${base}/api/machine/profile/${encodeURIComponent(id)}`, {
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
      const resp = await apiFetch<{ dates: string[] }>(
        `${base}/api/shots/dates`
      )
      // Backend returns date strings; map to minimal HistoryListingEntry shape
      return (resp.dates ?? []).map(d => ({ date: d }) as unknown as HistoryListingEntry)
    },
    getLastShot: async () => {
      const base = await getServerUrl()
      try {
        const resp = await apiFetch<{ shots: HistoryListingEntry[] }>(`${base}/api/shots/recent`)
        return resp.shots?.[0] ?? null
      } catch {
        return null
      }
    },

    // -- Settings / Device --------------------------------------------------
    // NOTE: /api/settings returns app-level settings, not machine settings.
    // Machine settings require direct machine access. In proxy mode we return
    // what the backend provides and let the UI handle the mismatch gracefully.
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
      // No dedicated device-info endpoint in proxy mode;
      // return minimal stub so callers degrade gracefully.
      return {} as DeviceInfo
    },
  }
}

export const meticAIAdapter = createMeticAIAdapter()
