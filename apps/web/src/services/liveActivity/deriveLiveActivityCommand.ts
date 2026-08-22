export interface LiveActivityLifecycle {
  active: boolean
}

export interface MachineLifecycleSnapshot {
  stateLC: string
  brewing: boolean
  hasChartData: boolean
}

export type LiveActivityCommand = 'start' | 'stop' | 'none'

const HEATING_STATES = new Set(['heating', 'preheating', 'warming', 'click to start'])

/**
 * Pure lifecycle transition for the shot Live Activity. Starts when the machine
 * enters a heating/ready phase and none is active; stops when it returns to a
 * terminal (idle/unknown) phase after having been active.
 */
export function deriveLiveActivityCommand(
  prev: LiveActivityLifecycle,
  ms: MachineLifecycleSnapshot,
): { command: LiveActivityCommand; next: LiveActivityLifecycle } {
  const inShotFlow = ms.brewing || ms.hasChartData || HEATING_STATES.has(ms.stateLC)

  if (!prev.active && inShotFlow) {
    return { command: 'start', next: { active: true } }
  }
  if (prev.active && !inShotFlow) {
    return { command: 'stop', next: { active: false } }
  }
  return { command: 'none', next: prev }
}
