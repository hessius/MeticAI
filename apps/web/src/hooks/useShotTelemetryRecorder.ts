/**
 * useShotTelemetryRecorder — drives the persistent shotTelemetryRecorder from
 * the always-mounted App-level `machineState`, so live-shot graph history is
 * captured continuously (regardless of which view is mounted).
 *
 * Mount this exactly once, high in the tree (App). `LiveShotView` reads the
 * recorded history via useSyncExternalStore.
 */

import { useEffect } from 'react'
import type { MachineState } from '@/hooks/useWebSocket'
import { recordTelemetry } from '@/lib/shotTelemetryRecorder'

export function useShotTelemetryRecorder(machineState: MachineState): void {
  useEffect(() => {
    recordTelemetry(machineState)
  }, [machineState])
}
