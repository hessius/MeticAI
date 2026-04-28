export function shouldScheduleProfileAfterPreheat({
  scheduledShotsEnabled,
  hasSelectedProfile,
}: {
  scheduledShotsEnabled: boolean
  hasSelectedProfile: boolean
}): boolean {
  return scheduledShotsEnabled && hasSelectedProfile
}

export function canCancelScheduledShot({
  scheduledShotsEnabled,
}: {
  scheduledShotsEnabled: boolean
}): boolean {
  return scheduledShotsEnabled
}

export function canShowVariableAdjustments({
  scheduledShotsEnabled,
  hasSelectedProfile,
  variableCount,
}: {
  scheduledShotsEnabled: boolean
  hasSelectedProfile: boolean
  variableCount: number
}): boolean {
  return scheduledShotsEnabled && hasSelectedProfile && variableCount > 0
}

export function getSchedulePreheatInfo({
  preheat,
  minutes,
  t,
}: {
  preheat: boolean
  minutes: number
  t: (key: string, options?: Record<string, unknown>) => string
}): string {
  return preheat ? t('runShot.preheatStartsBefore', { minutes }) : ''
}
