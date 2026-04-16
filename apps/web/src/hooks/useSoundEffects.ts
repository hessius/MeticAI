/**
 * useSoundEffects — app-level sound effect hook wrapping @rexa-developer/tiks.
 *
 * Acts as a **policy layer**: all playback decisions (enabled, visibility,
 * reduced-motion) are handled centrally so call-sites can fire-and-forget.
 *
 * The tiks AudioEngine is a module-level singleton, so multiple hook
 * instances safely share one AudioContext. Config (theme, volume) is
 * fixed at init — leaf components should not mutate it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useTiks } from '@rexa-developer/tiks/react'
import { getSoundsEnabled, SOUND_PREFS_CHANGED_EVENT } from '@/lib/soundPreferences'
import { useReducedMotion } from '@/hooks/a11y/useScreenReader'

export function useSoundEffects() {
  const tiks = useTiks({ theme: 'soft', volume: 0.5 })
  const [enabled, setEnabled] = useState(getSoundsEnabled)
  const reducedMotion = useReducedMotion()

  // Keep enabled state in sync across components via CustomEvent
  useEffect(() => {
    const handler = () => setEnabled(getSoundsEnabled())
    window.addEventListener(SOUND_PREFS_CHANGED_EVENT, handler)
    return () => window.removeEventListener(SOUND_PREFS_CHANGED_EVENT, handler)
  }, [])

  // Stable ref so callbacks don't re-create on every toggle
  const canPlayRef = useRef(false)
  canPlayRef.current = enabled && !reducedMotion

  const play = useCallback(
    (sound: () => void) => {
      if (!canPlayRef.current) return
      if (document.visibilityState !== 'visible') return
      sound()
    },
    [], // stable — canPlayRef is read at call-time
  )

  // ── Non-interaction events ──
  const shotComplete = useCallback(() => play(tiks.success), [play, tiks.success])
  const machineReady = useCallback(() => play(tiks.notify), [play, tiks.notify])
  const pourOverTarget = useCallback(() => play(tiks.success), [play, tiks.success])
  const pourOverDone = useCallback(() => play(tiks.pop), [play, tiks.pop])
  const machineError = useCallback(() => play(tiks.error), [play, tiks.error])
  const brewingStarted = useCallback(() => play(tiks.click), [play, tiks.click])
  const generationComplete = useCallback(() => play(tiks.success), [play, tiks.success])

  // ── Interaction sounds ──
  const buttonClick = useCallback(() => play(tiks.click), [play, tiks.click])
  const toggleOn = useCallback(() => play(() => tiks.toggle(true)), [play, tiks])
  const toggleOff = useCallback(() => play(() => tiks.toggle(false)), [play, tiks])
  const islandExpand = useCallback(() => play(tiks.swoosh), [play, tiks.swoosh])
  const islandContract = useCallback(() => play(tiks.pop), [play, tiks.pop])
  const warningSound = useCallback(() => play(tiks.warning), [play, tiks.warning])

  return {
    shotComplete,
    machineReady,
    pourOverTarget,
    pourOverDone,
    machineError,
    brewingStarted,
    generationComplete,
    buttonClick,
    toggleOn,
    toggleOff,
    islandExpand,
    islandContract,
    warningSound,
    enabled,
  }
}
