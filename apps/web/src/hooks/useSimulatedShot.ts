/**
 * useSimulatedShot — replays a **real** shot recorded by the
 * Meticulous machine, fetched from the backend API.
 *
 * On mount it pre-fetches a recent shot. When `start()` is called
 * it plays back the data points at real-time speed, emitting
 * MachineState-compatible updates that LiveShotView can consume.
 *
 * Usage:
 *   const sim = useSimulatedShot(profileName)
 *   sim.start()   // begins playback
 *   sim.stop()    // stops playback
 *   sim.state     // partial MachineState to spread over real state
 *   sim.active    // true while simulating
 *   sim.ready     // true once shot data has been pre-fetched
 */
import { useState, useRef, useCallback, useEffect } from 'react'
import type { MachineState } from '@/hooks/useWebSocket'
import { getServerUrl } from '@/lib/config'

// ---------------------------------------------------------------------------
// Types for raw Meticulous shot data
// ---------------------------------------------------------------------------

interface RawShotPoint {
  time: number // milliseconds since shot start
  profile_time: number
  status: string // stage name
  shot: {
    pressure: number
    flow: number
    weight: number
    gravimetric_flow: number
    setpoints?: { active?: string; [k: string]: unknown }
  }
  sensors?: {
    brew_head_temperature?: number
    external_1?: number
    external_2?: number
    [k: string]: unknown
  }
}

interface NormalisedPoint {
  /** seconds since shot start */
  time: number
  pressure: number
  flow: number
  weight: number
  stage: string
  temperature: number
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function fetchRecentShot(base: string): Promise<{
  points: NormalisedPoint[]
  profileName: string
  targetWeight: number
} | null> {
  try {
    // Get available dates
    const datesRes = await fetch(`${base}/api/shots/dates`)
    if (!datesRes.ok) return null
    const { dates } = await datesRes.json() as { dates: string[] }
    if (!dates || dates.length === 0) return null

    // Try dates until we find one with shot files
    for (const date of dates.slice(0, 5)) {
      const filesRes = await fetch(`${base}/api/shots/files/${date}`)
      if (!filesRes.ok) continue
      const { files } = await filesRes.json() as { files: string[] }
      if (!files || files.length === 0) continue

      // Shuffle files and try each until one works
      const shuffled = [...files].sort(() => Math.random() - 0.5)
      for (const file of shuffled) {
        try {
          const dataRes = await fetch(`${base}/api/shots/data/${date}/${file}`)
          if (!dataRes.ok) continue
          const raw = await dataRes.json()

          const rawPoints: RawShotPoint[] = raw?.data?.data
          const pName: string = raw?.data?.profile_name ?? 'Unknown Profile'
          if (!rawPoints || rawPoints.length < 10) continue

          // Normalise: convert ms times to seconds relative to first point
          const t0 = rawPoints[0].time
          const points: NormalisedPoint[] = rawPoints.map(p => ({
            time: (p.time - t0) / 1000,
            pressure: p.shot.pressure,
            flow: p.shot.flow,
            weight: p.shot.weight,
            stage: p.status,
            temperature: (p.sensors?.external_1 ?? p.sensors?.brew_head_temperature ?? 93),
          }))

          // Derive target weight from final weight
          const finalWeight = points[points.length - 1].weight
          const targetWeight = Math.ceil(finalWeight / 2) * 2 // round up to nearest even number

          return { points, profileName: pName, targetWeight }
        } catch {
          // This specific file failed — try the next one
          continue
        }
      }
    }
  } catch {
    // non-critical — simulation just won't be available
  }
  return null
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const TICK_INTERVAL = 100 // ms between state updates (10 Hz)

export function useSimulatedShot(profileName?: string) {
  const [active, setActive] = useState(false)
  const [ready, setReady] = useState(false)
  const [simState, setSimState] = useState<Partial<MachineState>>({})
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const shotDataRef = useRef<{
    points: NormalisedPoint[]
    profileName: string
    targetWeight: number
  } | null>(null)
  const cursorRef = useRef(0) // index into points array

  // Pre-fetch shot data on mount
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const base = await getServerUrl()
      const data = await fetchRecentShot(base)
      if (!cancelled && data) {
        shotDataRef.current = data
        setReady(true)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const stop = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setActive(false)
    // Emit one final "shot complete" frame
    setSimState(prev => ({
      ...prev,
      brewing: false,
      state: 'Idle',
    }))
  }, [])

  const start = useCallback(() => {
    const data = shotDataRef.current
    if (!data || data.points.length === 0) return
    setActive(true)
    startTimeRef.current = Date.now()
    cursorRef.current = 0

    const effectiveName = profileName ?? data.profileName

    // Initial frame
    const p0 = data.points[0]
    setSimState({
      connected: true,
      availability: 'online',
      brewing: true,
      state: p0.stage,
      pressure: p0.pressure,
      flow_rate: p0.flow,
      shot_weight: p0.weight,
      shot_timer: 0,
      target_weight: data.targetWeight,
      brew_head_temperature: p0.temperature,
      target_temperature: Math.round(p0.temperature),
      active_profile: effectiveName,
      _wsConnected: true,
      _stale: false,
      _ts: Date.now(),
    })

    timerRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000 // seconds

      // Advance cursor to the latest point whose time <= elapsed
      while (
        cursorRef.current < data.points.length - 1 &&
        data.points[cursorRef.current + 1].time <= elapsed
      ) {
        cursorRef.current++
      }

      const pt = data.points[cursorRef.current]

      // If we're past the last point, end simulation
      if (elapsed >= data.points[data.points.length - 1].time + 0.5) {
        stop()
        return
      }

      setSimState({
        connected: true,
        availability: 'online',
        brewing: true,
        state: pt.stage,
        pressure: pt.pressure,
        flow_rate: pt.flow,
        shot_weight: pt.weight,
        shot_timer: Math.round(elapsed * 10) / 10,
        target_weight: data.targetWeight,
        brew_head_temperature: pt.temperature,
        target_temperature: Math.round(pt.temperature),
        active_profile: effectiveName,
        _wsConnected: true,
        _stale: false,
        _ts: Date.now(),
      })
    }, TICK_INTERVAL)
  }, [profileName, stop])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  return { active, ready, state: simState, start, stop }
}
