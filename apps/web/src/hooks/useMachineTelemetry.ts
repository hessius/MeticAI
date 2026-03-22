/**
 * useMachineTelemetry — unified telemetry hook for both proxy and direct modes.
 *
 * In proxy mode: connects to the MeticAI backend WebSocket at /api/ws/live
 * In direct mode: subscribes to MachineService Socket.IO events
 *
 * Returns the same MachineState interface used throughout the app.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { isDirectMode } from '@/lib/machineMode'
import { useMachineService } from '@/hooks/useMachineService'
import type { MachineState } from '@/hooks/useWebSocket'
import { getServerUrl } from '@/lib/config'

// Re-export MachineState for convenience
export type { MachineState } from '@/hooks/useWebSocket'

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
      setState(prev => ({
        ...prev,
        connected: true,
        _wsConnected: true,
        availability: 'online',
        // Map espresso-api StatusData fields to our MachineState
        boiler_temperature: data.sensors?.t ?? prev.boiler_temperature,
        brew_head_temperature: data.sensors?.t ?? prev.brew_head_temperature,
        pressure: data.sensors?.p ?? prev.pressure,
        flow_rate: data.sensors?.f ?? prev.flow_rate,
        shot_weight: data.sensors?.w ?? prev.shot_weight,
        shot_timer: data.profile_time ?? prev.shot_timer,
        state: data.state ?? prev.state,
        brewing: data.extracting ?? prev.brewing,
        active_profile: data.name ?? data.profile ?? prev.active_profile,
        target_temperature: data.setpoints?.temperature ?? prev.target_temperature,
        target_weight: data.setpoints?.flow ?? prev.target_weight,
        _ts: Date.now(),
        _stale: false,
      }))
      resetStaleTimer()
    }))

    // Actuators events
    unsubs.push(machine.onActuators((data) => {
      setState(prev => ({
        ...prev,
        power: data.bh_pwr ?? prev.power,
      }))
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
            boiler_temperature: msg.boiler_temperature ?? prev.boiler_temperature,
            brew_head_temperature: msg.brew_head_temperature ?? prev.brew_head_temperature,
            target_temperature: msg.target_temperature ?? prev.target_temperature,
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
  if (isDirectMode()) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useDirectTelemetry(enabled)
  }
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useProxyTelemetry(enabled)
}
