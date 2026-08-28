import { useEffect, useRef, useState } from 'react'

/**
 * Auto-start on stable temperature (#588).
 *
 * Watches machine telemetry and fires a callback (the same action as the manual
 * "Start" button) once the machine is parked at the ready state AND both the
 * brew-head and boiler temperatures have stayed within a stability band around
 * the target for a sustained dwell period.
 *
 * This is a purely client-side trigger: it only presses "Start" for the user,
 * and only when the machine is already armed and waiting at "click to start".
 * It never initiates a shot from idle. Because it observes the same telemetry
 * and calls the same command path in both server and native/DirectMode runtimes,
 * the behaviour is identical across both.
 */

export interface AutoStartInputs {
  /** Whether auto-start is enabled. */
  enabled: boolean
  /** Machine is parked at the "click to start" ready gate. */
  isReady: boolean
  /** Brew-head temperature (deg C). */
  headTemp: number | null | undefined
  /** Boiler/chamber temperature (deg C). */
  chamberTemp: number | null | undefined
  /** Target temperature (deg C). */
  targetTemp: number | null | undefined
  /** Stability band: both temps must be within +/- this of target. */
  band: number
  /** How long (ms) both temps must stay in-band before firing. */
  dwellMs: number
}

export interface AutoStartState {
  /** Timestamp (ms) when both temps first entered the band at the ready gate. */
  inBandSince: number | null
  /** True once the trigger has fired (prevents re-firing). */
  fired: boolean
}

export interface AutoStartStatus {
  /** Enabled, at ready, and both temps currently in-band (dwell counting). */
  armed: boolean
  /** Milliseconds remaining before firing, or null when not armed. */
  remainingMs: number | null
}

export const initialAutoStartState: AutoStartState = {
  inBandSince: null,
  fired: false,
}

/** Both the brew-head and boiler temps are within the band around target. */
export function bothWithinBand(i: AutoStartInputs): boolean {
  const { headTemp, chamberTemp, targetTemp, band } = i
  if (targetTemp == null || headTemp == null || chamberTemp == null) return false
  return (
    Math.abs(headTemp - targetTemp) <= band &&
    Math.abs(chamberTemp - targetTemp) <= band
  )
}

/**
 * Pure state-machine step. Given the previous state, current inputs and the
 * current time, returns the next state plus whether the trigger should fire.
 */
export function stepAutoStart(
  prev: AutoStartState,
  i: AutoStartInputs,
  now: number,
): { state: AutoStartState; fire: boolean } {
  if (!i.enabled) return { state: initialAutoStartState, fire: false }
  if (prev.fired) return { state: prev, fire: false }

  const inBand = i.isReady && bothWithinBand(i)
  if (!inBand) {
    // Drifted out of band (or left the ready gate) — restart the dwell clock.
    return { state: { inBandSince: null, fired: false }, fire: false }
  }

  const since = prev.inBandSince ?? now
  if (now - since >= i.dwellMs) {
    return { state: { inBandSince: since, fired: true }, fire: true }
  }
  return { state: { inBandSince: since, fired: false }, fire: false }
}

/** Compute the display status (armed + remaining dwell) for a given state. */
export function autoStartStatus(
  state: AutoStartState,
  i: AutoStartInputs,
  now: number,
): AutoStartStatus {
  if (!i.enabled || state.fired || state.inBandSince == null) {
    return { armed: false, remainingMs: null }
  }
  return {
    armed: true,
    remainingMs: Math.max(0, i.dwellMs - (now - state.inBandSince)),
  }
}

/**
 * React hook wrapping {@link stepAutoStart}. Evaluates on a short interval so
 * the dwell timer elapses even without fresh telemetry, reading the latest
 * inputs via a ref to avoid tearing down the interval on every telemetry tick.
 */
export function useAutoStart(
  inputs: AutoStartInputs,
  onFire: () => void,
): AutoStartStatus {
  const stateRef = useRef<AutoStartState>(initialAutoStartState)
  const inputsRef = useRef(inputs)
  const onFireRef = useRef(onFire)

  const [status, setStatus] = useState<AutoStartStatus>({
    armed: false,
    remainingMs: null,
  })

  // Keep the latest inputs/callback in refs so the interval reads fresh values
  // without tearing down on every telemetry tick.
  useEffect(() => {
    inputsRef.current = inputs
    onFireRef.current = onFire
  })

  useEffect(() => {
    const evaluate = () => {
      const now = Date.now()
      const current = inputsRef.current
      const { state, fire } = stepAutoStart(stateRef.current, current, now)
      stateRef.current = state
      setStatus(autoStartStatus(state, current, now))
      if (fire) onFireRef.current()
    }

    if (!inputs.enabled) {
      stateRef.current = initialAutoStartState
      evaluate()
      return
    }
    // Fresh dwell each time auto-start is (re)enabled.
    stateRef.current = initialAutoStartState

    evaluate()
    const id = window.setInterval(evaluate, 500)
    return () => window.clearInterval(id)
  }, [inputs.enabled])

  return status
}
