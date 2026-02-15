/**
 * useWebSocket — connects to the MeticAI live telemetry WebSocket
 * and keeps a reactive MachineState snapshot.
 *
 * The hook manages reconnection with exponential back-off, staleness
 * detection, and clean teardown.
 */
import { useEffect, useRef, useState, useCallback } from 'react'
import { getServerUrl } from '@/lib/config'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface MachineState {
  // Connection
  connected: boolean
  availability: 'online' | 'offline' | null

  // Temperature
  boiler_temperature: number | null
  brew_head_temperature: number | null
  target_temperature: number | null

  // Brewing
  brewing: boolean
  state: string | null
  pressure: number | null
  flow_rate: number | null
  shot_weight: number | null
  shot_timer: number | null
  target_weight: number | null
  preheat_countdown: number | null

  // Profile
  active_profile: string | null

  // Device
  total_shots: number | null
  brightness: number | null
  sounds_enabled: boolean | null
  voltage: number | null
  firmware_version: string | null

  // Last shot
  last_shot_time: string | null
  last_shot_name: string | null

  // Meta
  _ts: number | null
  _stale: boolean
  _wsConnected: boolean
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

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
// Hook
// ---------------------------------------------------------------------------

export function useWebSocket(enabled: boolean): MachineState {
  const [state, setState] = useState<MachineState>(INITIAL_STATE)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retriesRef = useRef(0)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  const resetStaleTimer = useCallback(() => {
    if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
    staleTimerRef.current = setTimeout(() => {
      setState(prev => (prev._stale ? prev : { ...prev, _stale: true }))
    }, STALE_TIMEOUT_MS)
  }, [])

  const connect = useCallback(async () => {
    if (!enabledRef.current) return

    // Build WebSocket URL from the HTTP server URL
    const serverUrl = await getServerUrl()
    let wsUrl: string
    if (serverUrl) {
      // Replace http(s) with ws(s)
      wsUrl = serverUrl.replace(/^http/, 'ws') + '/api/ws/live'
    } else {
      // Same origin
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

          // Heartbeat — just reset the stale timer
          if (msg._heartbeat) {
            resetStaleTimer()
            return
          }

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
        } catch {
          // Ignore malformed messages
        }
      }

      ws.onclose = () => {
        wsRef.current = null
        setState(prev => ({ ...prev, _wsConnected: false }))
        scheduleReconnect()
      }

      ws.onerror = () => {
        // onclose will fire after onerror, so just let that handle reconnect
        ws.close()
      }
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
      reconnectRef.current = setTimeout(connect, delay)
    }
  }, [resetStaleTimer])

  useEffect(() => {
    if (enabled) {
      connect()
    } else {
      // Tear down
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      setState(INITIAL_STATE)
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current)
    }
  }, [enabled, connect])

  return state
}
