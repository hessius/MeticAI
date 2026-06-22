import { useEffect, useRef, useState } from 'react'
import type { TempSample } from './estimateTimeToReady'

interface UseHeatingSamplesOptions {
  /** Current temperature reading (°C) the estimate is based on. */
  temp: number
  /** Optional brew-chamber (boiler) temperature in °C, for display only. */
  chamber?: number
  /** True while the machine is heating (not yet ready / not brewing). */
  active: boolean
  /** Rolling window length in seconds. Default 45. */
  maxWindow?: number
  /**
   * Monotonic per-telemetry-tick signal; when provided, drives sampling so
   * plateaus with unchanged `temp` still record samples and trim the window.
   * Falls back to `temp` when omitted.
   */
  tick?: number
  /** Injectable clock for tests (ms). Default Date.now. */
  nowFn?: () => number
}

/**
 * Accumulates (elapsed-seconds, head temperature, optional chamber temperature)
 * samples while `active`, retaining a trailing window of `maxWindow` seconds.
 * Resets to empty when inactive so each heating cycle starts fresh.
 */
export function useHeatingSamples({
  temp,
  chamber,
  active,
  maxWindow = 45,
  tick,
  nowFn = Date.now,
}: UseHeatingSamplesOptions): TempSample[] {
  const [samples, setSamples] = useState<TempSample[]>([])
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (!active) {
      startRef.current = null
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSamples((prev) => (prev.length ? [] : prev))
      return
    }
    const now = nowFn()
    if (startRef.current === null) startRef.current = now
    const t = (now - startRef.current) / 1000
    setSamples((prev) => {
      const next = [...prev, { t, temp, chamber }]
      const cutoff = t - maxWindow
      return next.filter((s) => s.t >= cutoff)
    })
    // Re-run on each new telemetry tick or temperature reading.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, tick ?? temp])

  return samples
}
