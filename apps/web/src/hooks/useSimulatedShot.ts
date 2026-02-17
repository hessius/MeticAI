/**
 * useSimulatedShot — dev-only hook that replays target curves
 * as if a real shot were happening.  Produces a stream of
 * MachineState-like updates that LiveShotView can consume.
 *
 * Usage:
 *   const sim = useSimulatedShot(targetCurves, profileName)
 *   sim.start()   // begins playback
 *   sim.stop()    // stops playback
 *   sim.state     // partial MachineState to spread over real state
 *   sim.active    // true while simulating
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import type { ProfileTargetPoint } from '@/components/charts/chartConstants'
import type { MachineState } from '@/hooks/useWebSocket'

// ---------------------------------------------------------------------------
// Linear-interpolation helpers
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t
}

function interpolateTargets(curves: ProfileTargetPoint[], time: number) {
  // Find the two points surrounding `time`
  let pressure: number | null = null
  let flow: number | null = null
  let stage = ''

  // Filter to pressure/flow points
  const pressurePts = curves.filter(p => p.target_pressure != null)
  const flowPts = curves.filter(p => p.target_flow != null)

  // Interpolate pressure
  if (pressurePts.length > 0) {
    if (time <= pressurePts[0].time) {
      pressure = pressurePts[0].target_pressure ?? 0
    } else if (time >= pressurePts[pressurePts.length - 1].time) {
      pressure = pressurePts[pressurePts.length - 1].target_pressure ?? 0
    } else {
      for (let i = 0; i < pressurePts.length - 1; i++) {
        if (time >= pressurePts[i].time && time <= pressurePts[i + 1].time) {
          const t = (time - pressurePts[i].time) / (pressurePts[i + 1].time - pressurePts[i].time)
          pressure = lerp(pressurePts[i].target_pressure!, pressurePts[i + 1].target_pressure!, t)
          break
        }
      }
    }
  }

  // Interpolate flow
  if (flowPts.length > 0) {
    if (time <= flowPts[0].time) {
      flow = flowPts[0].target_flow ?? 0
    } else if (time >= flowPts[flowPts.length - 1].time) {
      flow = flowPts[flowPts.length - 1].target_flow ?? 0
    } else {
      for (let i = 0; i < flowPts.length - 1; i++) {
        if (time >= flowPts[i].time && time <= flowPts[i + 1].time) {
          const t = (time - flowPts[i].time) / (flowPts[i + 1].time - flowPts[i].time)
          flow = lerp(flowPts[i].target_flow!, flowPts[i + 1].target_flow!, t)
          break
        }
      }
    }
  }

  // Find current stage name
  for (let i = curves.length - 1; i >= 0; i--) {
    if (time >= curves[i].time) {
      stage = curves[i].stage_name
      break
    }
  }

  return { pressure, flow, stage }
}

// ---------------------------------------------------------------------------
// Simulate realistic noise
// ---------------------------------------------------------------------------

function addNoise(value: number | null, amplitude: number): number | null {
  if (value == null) return null
  return Math.max(0, value + (Math.random() - 0.5) * amplitude)
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const TICK_INTERVAL = 100 // ms between updates (10 Hz)
const SPEED_MULTIPLIER = 1 // 1x real-time

export function useSimulatedShot(
  targetCurves: ProfileTargetPoint[] | undefined,
  profileName?: string,
) {
  const [active, setActive] = useState(false)
  const [simState, setSimState] = useState<Partial<MachineState>>({})
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const weightAccRef = useRef(0)

  const maxTime = targetCurves && targetCurves.length > 0
    ? Math.max(...targetCurves.map(p => p.time))
    : 30

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setActive(false)
    // Send one final "shot complete" frame
    setSimState(prev => ({
      ...prev,
      brewing: false,
      state: 'Idle',
    }))
  }, [])

  const start = useCallback(() => {
    if (!targetCurves || targetCurves.length === 0) return
    setActive(true)
    startTimeRef.current = Date.now()
    weightAccRef.current = 0

    // Initial state: brewing
    setSimState({
      connected: true,
      availability: 'online',
      brewing: true,
      state: targetCurves[0]?.stage_name ?? 'Simulating',
      pressure: 0,
      flow_rate: 0,
      shot_weight: 0,
      shot_timer: 0,
      target_weight: 44,
      brew_head_temperature: 93,
      target_temperature: 93,
      active_profile: profileName ?? 'Simulated Profile',
      _wsConnected: true,
      _stale: false,
      _ts: Date.now(),
    })

    timerRef.current = setInterval(() => {
      const elapsed = ((Date.now() - startTimeRef.current) / 1000) * SPEED_MULTIPLIER
      if (elapsed >= maxTime) {
        stop()
        return
      }

      const { pressure, flow, stage } = interpolateTargets(targetCurves, elapsed)

      // Simulate weight as integral of flow
      const flowVal = flow ?? 0
      weightAccRef.current += flowVal * (TICK_INTERVAL / 1000) * SPEED_MULTIPLIER

      setSimState({
        connected: true,
        availability: 'online',
        brewing: true,
        state: stage || 'Simulating',
        pressure: addNoise(pressure, 0.3),
        flow_rate: addNoise(flow, 0.15),
        shot_weight: Math.round(weightAccRef.current * 10) / 10,
        shot_timer: Math.round(elapsed * 10) / 10,
        target_weight: 44,
        brew_head_temperature: addNoise(93, 0.2),
        target_temperature: 93,
        active_profile: profileName ?? 'Simulated Profile',
        _wsConnected: true,
        _stale: false,
        _ts: Date.now(),
      })
    }, TICK_INTERVAL)
  }, [targetCurves, profileName, maxTime, stop])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return { active, state: simState, start, stop }
}
