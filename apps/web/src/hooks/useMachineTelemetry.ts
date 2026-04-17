/**
 * useMachineTelemetry — unified telemetry hook for both proxy and direct modes.
 *
 * In proxy mode: connects to the MeticAI backend WebSocket at /api/ws/live
 * In direct mode: subscribes to MachineService Socket.IO events
 *
 * Returns the same MachineState interface used throughout the app.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { isDirectMode, isDemoMode } from '@/lib/machineMode'
import { useMachineService } from '@/hooks/useMachineService'
import type { MachineState } from '@/hooks/useWebSocket'
import { getServerUrl } from '@/lib/config'

// Espresso machines operate 0-120°C. Values outside this range are
// transient sensor glitches (e.g. 2000°C during state transitions).
const TEMP_MIN = 0
const TEMP_MAX = 150
function clampTemp(val: number | undefined | null, fallback: number | null): number | null {
  if (val == null) return fallback
  if (val < TEMP_MIN || val > TEMP_MAX) return fallback
  return val
}

// Re-export MachineState for convenience
export type { MachineState } from '@/hooks/useWebSocket'

/** Fields that DirectAdapter seeds via the status callback but aren't in StatusData. */
interface SeededStatusFields {
  total_shots?: number | null
  firmware_version?: string | null
  sounds_enabled?: boolean | null
}

const INITIAL_STATE: MachineState = {
  connected: false,
  availability: null,
  boiler_temperature: null,
  brew_head_temperature: null,
  target_temperature: null,
  brewing: false,
  state: null,
  pressure: null,
  flow_rate: null,
  power: null,
  shot_weight: null,
  shot_timer: null,
  target_weight: null,
  preheat_countdown: null,
  active_profile: null,
  total_shots: null,
  brightness: null,
  sounds_enabled: null,
  voltage: null,
  firmware_version: null,
  last_shot_time: null,
  last_shot_name: null,
  _ts: null,
  _stale: true,
  _wsConnected: false,
}

const STALE_TIMEOUT_MS = 5_000
const RECONNECT_BASE_MS = 1_000
const RECONNECT_MAX_MS = 15_000

// ---------------------------------------------------------------------------
// Direct mode: Socket.IO via MachineService
// ---------------------------------------------------------------------------

function useDirectTelemetry(enabled: boolean): MachineState {
  const [state, setState] = useState<MachineState>(INITIAL_STATE)
  const machine = useMachineService()
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastProfileIdRef = useRef<string | null>(null)

  const resetStaleTimer = useCallback(() => {
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
    staleTimerRef.current = setTimeout(() => {
      setState(prev => (prev._stale ? prev : { ...prev, _stale: true }))
    }, STALE_TIMEOUT_MS)
  }, [])

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset state on teardown
      setState(INITIAL_STATE)
      return
    }

    const unsubs: (() => void)[] = []

    // Connection status
    unsubs.push(machine.onConnectionChange((connected) => {
      setState(prev => ({
        ...prev,
        connected,
        _wsConnected: connected,
        availability: connected ? 'online' : 'offline',
        _stale: !connected,
      }))
      if (connected) resetStaleTimer()
    }))

    // Status events (main telemetry stream)
    unsubs.push(machine.onStatus((data) => {
      setState(prev => {
        // Machine sends profile_time in milliseconds — convert to seconds
        const shotTimer = data.profile_time != null
          ? data.profile_time / 1000
          : prev.shot_timer

        // data.name = current stage/phase (e.g. "heating", "Preinfusion")
        // data.profile / data.loaded_profile = actual profile name
        // data.state = machine state ('idle', 'brewing', 'home', 'purge')
        const ext = data as {loaded_profile?: string; id?: string}
        const profileName = ext.loaded_profile || data.profile || prev.active_profile

        // Fetch target weight from loaded profile when profile changes
        const profileId = ext.id
        if (profileId && profileId !== lastProfileIdRef.current) {
          lastProfileIdRef.current = profileId
          machine.getProfile(profileId)
            .then((profile) => {
              const weight = (profile as unknown as {final_weight?: number})?.final_weight
              if (weight) {
                setState(s => ({ ...s, target_weight: weight }))
              }
            })
            .catch(() => {/* ignore — profile may not exist */})
        }

        // DirectAdapter seeds total_shots, firmware_version, sounds_enabled via
        // the status callback (they aren't in the machine's raw status events).
        const seeded = data as typeof data & SeededStatusFields

        return {
          ...prev,
          connected: true,
          _wsConnected: true,
          availability: 'online',
          boiler_temperature: clampTemp(data.sensors?.t, prev.boiler_temperature),
          // brew_head comes from the separate 'sensors' event (t_bar_down), not status.
          // Keep previous value here — onTemperatures updates it.
          brew_head_temperature: prev.brew_head_temperature,
          pressure: data.sensors?.p ?? prev.pressure,
          flow_rate: data.sensors?.f ?? prev.flow_rate,
          shot_weight: data.sensors?.w ?? prev.shot_weight,
          shot_timer: shotTimer,
          // Show stage name (data.name) as the state — matches proxy mode behavior
          // Preserve 'preheating' override when preheat countdown is active
          state: (prev.preheat_countdown != null && prev.preheat_countdown > 0
            && ((data.name || data.state || '') === 'idle' || (data.name || data.state || '') === 'Idle' || !(data.name || data.state)))
            ? 'preheating'
            : (data.name || data.state || prev.state),
          brewing: data.extracting ?? prev.brewing,
          active_profile: profileName,
          target_temperature: clampTemp(data.setpoints?.temperature, prev.target_temperature),
          target_weight: prev.target_weight,
          // Seeded fields from DirectAdapter (total_shots, firmware, sounds)
          total_shots: seeded.total_shots ?? prev.total_shots,
          firmware_version: seeded.firmware_version ?? prev.firmware_version,
          sounds_enabled: seeded.sounds_enabled ?? prev.sounds_enabled,
          _ts: Date.now(),
          _stale: false,
        }
      })
      resetStaleTimer()
    }))

    // Actuators events
    unsubs.push(machine.onActuators((data) => {
      setState(prev => ({
        ...prev,
        power: data.bh_pwr ?? prev.power,
      }))
    }))

    // Temperatures event — separate Socket.IO 'sensors' event with detailed temps.
    // The meticulous-addon MQTT bridge maps:
    //   brew_head_temperature ← t_bar_down (lower bar thermocouple)
    //   boiler_temperature    ← t_bar_up   (upper bar thermocouple)
    // t_ext_1/t_ext_2 are external sensors, NOT brew head.
    unsubs.push(machine.onTemperatures((data) => {
      setState(prev => ({
        ...prev,
        brew_head_temperature: clampTemp(data.t_bar_down, prev.brew_head_temperature),
        boiler_temperature: clampTemp(data.t_bar_up, prev.boiler_temperature),
      }))
    }))

    // Heater status events — detect preheat from countdown value
    // Machine sends heater_status with countdown (float seconds).
    // When countdown > 0 and machine state is idle, override to "preheating".
    unsubs.push(machine.onHeaterStatus((countdown: number) => {
      setState(prev => {
        const preheatActive = countdown > 0
        const stateLC = (prev.state ?? '').toLowerCase()
        const isIdleState = stateLC === 'idle' || stateLC === ''
        return {
          ...prev,
          preheat_countdown: preheatActive ? countdown : 0,
          state: preheatActive && isIdleState ? 'preheating' : prev.state,
        }
      })
    }))

    return () => {
      unsubs.forEach(fn => fn())
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
    }
  }, [enabled, machine, resetStaleTimer])

  return state
}

// ---------------------------------------------------------------------------
// Proxy mode: WebSocket to MeticAI backend
// ---------------------------------------------------------------------------

function useProxyTelemetry(enabled: boolean): MachineState {
  const [state, setState] = useState<MachineState>(INITIAL_STATE)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retriesRef = useRef(0)
  const enabledRef = useRef(enabled)
  const connectRef = useRef<(() => Promise<void>) | null>(null)

  useEffect(() => { enabledRef.current = enabled })

  const resetStaleTimer = useCallback(() => {
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
    staleTimerRef.current = setTimeout(() => {
      setState(prev => (prev._stale ? prev : { ...prev, _stale: true }))
    }, STALE_TIMEOUT_MS)
  }, [])

  const connect = useCallback(async () => {
    if (!enabledRef.current) return
    const serverUrl = await getServerUrl()
    let wsUrl: string
    if (serverUrl) {
      wsUrl = serverUrl.replace(/^http/, 'ws') + '/api/ws/live'
    } else {
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      wsUrl = `${proto}//${window.location.host}/api/ws/live`
    }

    try {
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        retriesRef.current = 0
        setState(prev => ({ ...prev, _wsConnected: true, _stale: false }))
        resetStaleTimer()
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data)
          if (msg._heartbeat) { resetStaleTimer(); return }
          setState(prev => ({
            ...prev,
            connected: msg.connected ?? prev.connected,
            availability: msg.availability ?? prev.availability,
            boiler_temperature: clampTemp(msg.boiler_temperature, prev.boiler_temperature),
            brew_head_temperature: clampTemp(msg.brew_head_temperature, prev.brew_head_temperature),
            target_temperature: clampTemp(msg.target_temperature, prev.target_temperature),
            brewing: msg.brewing ?? prev.brewing,
            state: msg.state ?? prev.state,
            pressure: msg.pressure ?? prev.pressure,
            flow_rate: msg.flow_rate ?? prev.flow_rate,
            power: msg.power ?? prev.power,
            shot_weight: msg.shot_weight ?? prev.shot_weight,
            shot_timer: msg.shot_timer ?? prev.shot_timer,
            target_weight: msg.target_weight ?? prev.target_weight,
            preheat_countdown: msg.preheat_countdown ?? prev.preheat_countdown,
            active_profile: msg.active_profile ?? prev.active_profile,
            total_shots: msg.total_shots ?? prev.total_shots,
            brightness: msg.brightness ?? prev.brightness,
            sounds_enabled: msg.sounds_enabled ?? prev.sounds_enabled,
            voltage: msg.voltage ?? prev.voltage,
            firmware_version: msg.firmware_version ?? prev.firmware_version,
            last_shot_time: msg.last_shot_time ?? prev.last_shot_time,
            last_shot_name: msg.last_shot_name ?? prev.last_shot_name,
            _ts: msg._ts ?? prev._ts,
            _stale: false,
            _wsConnected: true,
          }))
          resetStaleTimer()
        } catch { /* Ignore malformed messages */ }
      }

      ws.onclose = () => {
        wsRef.current = null
        setState(prev => ({ ...prev, _wsConnected: false }))
        scheduleReconnect()
      }

      ws.onerror = () => { ws.close() }
    } catch {
      scheduleReconnect()
    }

    function scheduleReconnect() {
      if (!enabledRef.current) return
      const delay = Math.min(
        RECONNECT_BASE_MS * Math.pow(2, retriesRef.current),
        RECONNECT_MAX_MS,
      )
      retriesRef.current++
      reconnectRef.current = setTimeout(() => {
        void connectRef.current?.()
      }, delay)
    }
  }, [resetStaleTimer])

  useEffect(() => { connectRef.current = connect })

  useEffect(() => {
    if (enabled) {
      connect()
    } else {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reset state on WebSocket teardown
      setState(INITIAL_STATE)
    }
    return () => {
      if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
    }
  }, [enabled, connect])

  return state
}

// ---------------------------------------------------------------------------
// Unified hook
// ---------------------------------------------------------------------------

export function useMachineTelemetry(enabled: boolean): MachineState {
  const useService = isDemoMode() || isDirectMode()
  // Both hooks always run (satisfying rules-of-hooks) but the inactive
  // one receives enabled=false and immediately returns INITIAL_STATE.
  const directState = useDirectTelemetry(enabled && useService)
  const proxyState = useProxyTelemetry(enabled && !useService)
  return useService ? directState : proxyState
}
