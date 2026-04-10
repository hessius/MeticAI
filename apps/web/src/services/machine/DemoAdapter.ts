/**
 * DemoAdapter — MachineService implementation for demo mode.
 *
 * Provides a fully simulated Meticulous machine:
 * - Profile CRUD backed by demoStore
 * - Simulated brew cycle with realistic telemetry
 * - Timer-based status events (replaces Socket.IO)
 * - No real network connections
 */

import type { Profile } from '@meticulous-home/espresso-profile'
import type {
  Actuators,
  DeviceInfo,
  HistoryListingEntry,
  ProfileIdent,
  StatusData,
  Settings as MachineSettings,
} from '@meticulous-home/espresso-api'
import type {
  MachineService,
  CommandResult,
  StatusCallback,
  ActuatorsCallback,
  NotificationCallback,
  ProfileUpdateCallback,
  HeaterStatusCallback,
  ConnectionCallback,
  Unsubscribe,
} from './MachineService'
import { getDemoStore, generateSensorData } from '@/demo/demoStore'

// ---------------------------------------------------------------------------
// Brew simulation
// ---------------------------------------------------------------------------

interface BrewState {
  timer: ReturnType<typeof setInterval>
  profile: Profile
  shotId: string
  startTime: number
  dataPoints: ReturnType<typeof generateSensorData>
  tick: number
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function createDemoAdapter(): MachineService {
  let connected = false
  let brew: BrewState | null = null
  let loadedProfile: Profile | null = null

  // Callback sets (mirrors DirectAdapter pattern)
  const statusCbs = new Set<StatusCallback>()
  const actuatorCbs = new Set<ActuatorsCallback>()
  const heaterCbs = new Set<HeaterStatusCallback>()
  const notifCbs = new Set<NotificationCallback>()
  const profileCbs = new Set<ProfileUpdateCallback>()
  const connCbs = new Set<ConnectionCallback>()

  const store = getDemoStore()

  function setConnected(val: boolean) {
    connected = val
    connCbs.forEach((cb) => cb(val))
  }

  function emitStatus(data: StatusData) {
    statusCbs.forEach((cb) => cb(data))
  }

  function emitActuators(data: Actuators) {
    actuatorCbs.forEach((cb) => cb(data))
  }

  function ok(message?: string): CommandResult {
    return { success: true, message }
  }

  // Idle status tick — sent every 500ms when not brewing
  let idleTick: ReturnType<typeof setInterval> | null = null

  function startIdleTick() {
    stopIdleTick()
    idleTick = setInterval(() => {
      if (brew) return
      const profile = loadedProfile ?? store.getProfiles()[0]
      emitStatus({
        name: '',
        sensors: { p: 0, f: 0, w: 0, t: 93.2, g: 0 },
        time: 0,
        profile_time: 0,
        profile: profile?.name ?? '',
        loaded_profile: profile?.name ?? '',
        id: profile?.id ?? '',
        state: 'idle',
        extracting: false,
        setpoints: { temperature: 93 },
      })
      emitActuators({
        m_pos: 0,
        m_spd: 0,
        m_pwr: 0,
        m_cur: 0,
        bh_pwr: 30,
      })
    }, 500)
  }

  function stopIdleTick() {
    if (idleTick) {
      clearInterval(idleTick)
      idleTick = null
    }
  }

  // -- Brew simulation -------------------------------------------------------

  function startBrew(profile: Profile) {
    stopBrew()
    const shotId = `demo-shot-${Date.now()}`
    const dataPoints = generateSensorData(shotId, 30)
    const state: BrewState = {
      timer: setInterval(() => tickBrew(state), 100),
      profile,
      shotId,
      startTime: Date.now(),
      dataPoints,
      tick: 0,
    }
    brew = state
  }

  function tickBrew(state: BrewState) {
    if (state.tick >= state.dataPoints.length) {
      completeBrew(state)
      return
    }

    const dp = state.dataPoints[state.tick]
    const elapsed = Date.now() - state.startTime

    emitStatus({
      name: dp.status === 'preinfusion' ? 'Preinfusion' : 'Extraction',
      sensors: {
        p: dp.shot.pressure,
        f: dp.shot.flow,
        w: dp.shot.weight,
        t: dp.shot.temperature,
        g: dp.shot.gravimetric_flow,
      },
      time: elapsed,
      profile_time: dp.time,
      profile: state.profile.name,
      loaded_profile: state.profile.name,
      id: state.profile.id,
      state: 'brewing',
      extracting: true,
      setpoints: {
        temperature: state.profile.temperature,
        pressure: dp.shot.pressure,
        flow: dp.shot.flow,
      },
    })

    emitActuators({
      m_pos: dp.sensors.motor_position,
      m_spd: dp.sensors.motor_speed,
      m_pwr: dp.sensors.motor_power,
      m_cur: dp.sensors.motor_current,
      bh_pwr: dp.sensors.bandheater_power,
    })

    state.tick++
  }

  function completeBrew(state: BrewState) {
    clearInterval(state.timer)

    // Add to demo history — reuse the same shotId as telemetry
    store.addShot({
      id: state.shotId,
      dbKey: Date.now(),
      time: Math.floor(Date.now() / 1000),
      profileId: state.profile.id,
      profileName: state.profile.name,
      rating: null,
    })

    brew = null
    startIdleTick()
  }

  function stopBrew() {
    if (brew) {
      clearInterval(brew.timer)
      brew = null
    }
  }

  // -- MachineService implementation -----------------------------------------

  const adapter: MachineService = {
    name: 'DemoAdapter',

    async connect() {
      setConnected(true)
      startIdleTick()
    },

    disconnect() {
      stopBrew()
      stopIdleTick()
      setConnected(false)
    },

    isConnected: () => connected,

    // -- Brewing --
    async startShot() {
      const profile = loadedProfile ?? store.getProfiles()[0]
      if (!profile) return { success: false, message: 'No profile loaded' }
      startBrew(profile)
      return ok('Demo brew started')
    },

    async stopShot() {
      stopBrew()
      startIdleTick()
      return ok('Demo brew stopped')
    },

    async abortShot() {
      stopBrew()
      startIdleTick()
      return ok('Demo brew aborted')
    },

    async continueShot() {
      return ok('Continue (no-op in demo)')
    },

    // -- Machine commands --
    async preheat() {
      // Simulate preheat countdown
      let countdown = 5
      const timer = setInterval(() => {
        heaterCbs.forEach((cb) => cb(countdown))
        countdown--
        if (countdown < 0) clearInterval(timer)
      }, 1000)
      return ok('Preheat started')
    },

    async tareScale() {
      return ok('Scale tared')
    },

    async homePlunger() {
      return ok('Plunger homed')
    },

    async purge() {
      return ok('Purge complete')
    },

    // -- Profile loading --
    async loadProfile(name: string) {
      const profile = store.getProfiles().find((p) => p.name === name)
      if (profile) loadedProfile = profile
      return ok(`Loaded: ${name}`)
    },

    async loadProfileFromJSON(profile: Profile) {
      loadedProfile = profile
      return ok(`Loaded: ${profile.name}`)
    },

    async setBrightness() {
      return ok('Brightness set')
    },

    async enableSounds() {
      return ok('Sounds updated')
    },

    // -- Profile CRUD --
    async listProfiles(): Promise<ProfileIdent[]> {
      return store.getProfiles().map((p) => ({
        change_id: `demo-change-${p.id}`,
        profile: p,
      }))
    },

    async fetchAllProfiles(): Promise<Profile[]> {
      return store.getProfiles()
    },

    async getProfile(id: string): Promise<Profile> {
      const p = store.getProfile(id)
      if (!p) throw new Error(`Profile not found: ${id}`)
      return p
    },

    async saveProfile(profile: Profile): Promise<ProfileIdent> {
      store.saveProfile(profile)
      profileCbs.forEach((cb) => cb({ change: 'update', profile_id: profile.id }))
      return { change_id: `demo-change-${profile.id}`, profile }
    },

    async deleteProfile(id: string) {
      store.deleteProfile(id)
      profileCbs.forEach((cb) => cb({ change: 'delete', profile_id: id }))
    },

    // -- Telemetry subscriptions --
    onStatus(cb: StatusCallback): Unsubscribe {
      statusCbs.add(cb)
      return () => statusCbs.delete(cb)
    },

    onActuators(cb: ActuatorsCallback): Unsubscribe {
      actuatorCbs.add(cb)
      return () => actuatorCbs.delete(cb)
    },

    onHeaterStatus(cb: HeaterStatusCallback): Unsubscribe {
      heaterCbs.add(cb)
      return () => heaterCbs.delete(cb)
    },

    onNotification(cb: NotificationCallback): Unsubscribe {
      notifCbs.add(cb)
      return () => notifCbs.delete(cb)
    },

    onProfileUpdate(cb: ProfileUpdateCallback): Unsubscribe {
      profileCbs.add(cb)
      return () => profileCbs.delete(cb)
    },

    onConnectionChange(cb: ConnectionCallback): Unsubscribe {
      connCbs.add(cb)
      return () => connCbs.delete(cb)
    },

    // -- History --
    async getHistoryListing(): Promise<HistoryListingEntry[]> {
      return store.getHistoryListing()
    },

    async getLastShot(): Promise<HistoryListingEntry | null> {
      const listing = store.getHistoryListing()
      return listing[0] ?? null
    },

    // -- Settings/Device --
    async getSettings(): Promise<MachineSettings> {
      return {
        allow_debug_sending: false,
        auto_preheat: 0,
        auto_purge_after_shot: true,
        auto_start_shot: false,
        partial_retraction: 50,
        disallow_firmware_flashing: false,
        disable_ui_features: false,
        enable_sounds: true,
        debug_shot_data_retention_days: 30,
        idle_screen: 'clock',
        reverse_scrolling: { home: false, keyboard: false, menus: false },
        heating_timeout: 1800,
        timezone_sync: 'auto',
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        update_channel: 'stable',
        ssh_enabled: false,
        telemetry_service_enabled: false,
      }
    },

    async updateSetting(settings: Partial<MachineSettings>): Promise<MachineSettings> {
      const current = await adapter.getSettings()
      return { ...current, ...settings }
    },

    async getDeviceInfo(): Promise<DeviceInfo> {
      return {
        name: 'Demo Meticulous',
        hostname: 'demo.local',
        firmware: 'demo-1.0.0',
        mainVoltage: 230,
        color: 'black',
        model_version: 'Demo',
        serial: 'DEMO-000000',
        batch_number: 'DEMO',
        build_date: '2025-01-01',
        software_version: 'demo-1.0.0',
        image_build_channel: 'demo',
        image_version: 'demo',
        manufacturing: false,
        upgrade_first_boot: false,
        version_history: ['demo-1.0.0'],
      }
    },

    // -- Methods that may exist on extended interface --
    async rateShot() {
      return ok('Rating saved')
    },
  } satisfies MachineService & { rateShot: () => Promise<CommandResult> }

  return adapter
}
