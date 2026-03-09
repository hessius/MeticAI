/**
 * Hook for consuming SSE progress events during profile generation.
 *
 * Opens an EventSource to /api/generate/progress when `active` is true,
 * parses incoming `progress` events, and exposes the latest phase / message.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { getServerUrl } from '@/lib/config'

/** Mirror of GenerationPhase from the Python backend. */
export type GenerationPhase =
  | 'queued'
  | 'analyzing'
  | 'generating'
  | 'validating'
  | 'retrying'
  | 'uploading'
  | 'complete'
  | 'failed'

export interface ProgressEvent {
  phase: GenerationPhase
  message: string
  attempt: number
  max_attempts: number
  elapsed: number
  result?: Record<string, unknown>
  error?: string
}

/** Ordered phases for the segmented progress bar. */
export const PHASE_ORDER: GenerationPhase[] = [
  'analyzing',
  'generating',
  'validating',
  'uploading',
  'complete',
]

/**
 * Returns a 0–1 progress fraction based on the current phase.
 * Retrying maps to the same position as validating.
 */
export function phaseProgress(phase: GenerationPhase): number {
  if (phase === 'failed') return 0
  if (phase === 'retrying') return PHASE_ORDER.indexOf('validating') / (PHASE_ORDER.length - 1)
  const idx = PHASE_ORDER.indexOf(phase)
  if (idx === -1) return 0
  return idx / (PHASE_ORDER.length - 1)
}

export interface UseGenerationProgressReturn {
  /** Latest progress event from the server, or null. */
  progress: ProgressEvent | null
  /** 0–1 fraction for the progress bar. */
  fraction: number
  /** Whether the SSE connection is open. */
  connected: boolean
  /** Manually close the SSE connection. */
  close: () => void
}

export function useGenerationProgress(active: boolean): UseGenerationProgressReturn {
  const [progress, setProgress] = useState<ProgressEvent | null>(null)
  const [connected, setConnected] = useState(false)
  const esRef = useRef<EventSource | null>(null)

  const close = useCallback(() => {
    if (esRef.current) {
      esRef.current.close()
      esRef.current = null
      setConnected(false)
    }
  }, [])

  useEffect(() => {
    if (!active) {
      return
    }

    let cancelled = false

    const connect = async () => {
      try {
        const serverUrl = await getServerUrl()
        if (cancelled) return

        const es = new EventSource(`${serverUrl}/api/generate/progress`)
        esRef.current = es

        es.addEventListener('progress', (e: MessageEvent) => {
          try {
            const raw = JSON.parse(e.data) as { phase: string }

            // Skip keepalive pings — retain the last meaningful progress
            if (raw.phase === 'keepalive') return

            const data = raw as unknown as ProgressEvent
            setProgress(data)

            // Auto-close on terminal events
            if (data.phase === 'complete' || data.phase === 'failed') {
              es.close()
              esRef.current = null
              setConnected(false)
            }
          } catch {
            // Malformed SSE data — ignore
          }
        })

        es.onopen = () => {
          if (!cancelled) setConnected(true)
        }

        es.onerror = () => {
          es.close()
          esRef.current = null
          setConnected(false)

          // Retry after a transient error while the hook is still active
          if (!cancelled && active) {
            setTimeout(() => {
              if (!cancelled && active) {
                connect()
              }
            }, 1000)
          }
        }
      } catch {
        // getServerUrl failed — ignore
      }
    }

    connect()

    return () => {
      cancelled = true
      close()
      setProgress(null)
    }
  }, [active, close])

  const fraction = progress ? phaseProgress(progress.phase) : 0

  return { progress, fraction, connected, close }
}
