import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Slider } from '@/components/ui/slider'

interface ReplayScrubberProps {
  /** Current playback position in seconds. */
  value: number
  /** Maximum playable time in seconds. */
  max: number
  /** Called with the new position (seconds, clamped to [0, max]). */
  onChange: (t: number) => void
  /** Called when the user begins interacting (pointer down / key down). */
  onScrubStart?: () => void
  /** Called when the user finishes interacting (pointer up / value commit). */
  onScrubEnd?: () => void
  disabled?: boolean
}

const STEP = 0.1

export function ReplayScrubber({
  value,
  max,
  onChange,
  onScrubStart,
  onScrubEnd,
  disabled,
}: ReplayScrubberProps) {
  const { t } = useTranslation()
  const interactingRef = useRef(false)
  const pointerInteractingRef = useRef(false)
  const scrubEndCalledRef = useRef(false)
  const clamped = Math.min(Math.max(value, 0), max || 0)
  const isDisabled = disabled || max <= 0

  const startInteraction = () => {
    if (isDisabled || interactingRef.current) {
      return
    }
    interactingRef.current = true
    scrubEndCalledRef.current = false
    onScrubStart?.()
  }

  const endInteraction = (resetInteraction: boolean) => {
    if (interactingRef.current && !scrubEndCalledRef.current) {
      onScrubEnd?.()
      scrubEndCalledRef.current = true
    }
    if (resetInteraction) {
      interactingRef.current = false
      pointerInteractingRef.current = false
      scrubEndCalledRef.current = false
    }
  }

  return (
    <div className="flex items-center gap-2 w-full">
      <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0">
        {clamped.toFixed(1)}s
      </span>
      <Slider
        aria-label={t('shotHistory.scrubber')}
        value={[clamped]}
        min={0}
        max={max || 0}
        step={STEP}
        disabled={isDisabled}
        className="flex-1"
        onPointerDown={() => {
          if (!isDisabled) {
            pointerInteractingRef.current = true
          }
          startInteraction()
        }}
        onPointerUp={() => endInteraction(true)}
        onKeyDown={(e) => {
          // Only treat value-changing keys as a scrub; plain Tab/Shift/etc.
          // must not pause playback (they never emit a matching commit).
          const scrubKeys = [
            'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
            'Home', 'End', 'PageUp', 'PageDown',
          ]
          if (scrubKeys.includes(e.key)) startInteraction()
        }}
        onValueChange={(values) => {
          onChange(Math.min(Math.max(values[0], 0), max))
        }}
        onValueCommit={() => endInteraction(!pointerInteractingRef.current)}
      />
      <span className="text-xs font-mono text-muted-foreground tabular-nums shrink-0">
        {(max || 0).toFixed(1)}s
      </span>
    </div>
  )
}
