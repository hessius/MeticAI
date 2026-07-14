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
  hasSelectedProfile,
  variableCount,
}: {
  hasSelectedProfile: boolean
  variableCount: number
}): boolean {
  return hasSelectedProfile && variableCount > 0
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

/** Maximum safe brew temperature (machine hard cap). */
export const TEMP_BOOST_AMOUNT = 3
export const TEMP_BOOST_MAX = 99

/**
 * Calculate the boosted temperature for a cold-start shot.
 * Clamps the result so it never exceeds TEMP_BOOST_MAX (99 °C).
 */
export function getBoostedTemperature(baseTemp: number): number {
  return Math.min(baseTemp + TEMP_BOOST_AMOUNT, TEMP_BOOST_MAX)
}

/**
 * Returns whether the temperature boost option should be shown.
 * Requires a selected profile with a defined temperature.
 */
export function canShowTemperatureBoost({
  hasSelectedProfile,
  profileTemperature,
}: {
  hasSelectedProfile: boolean
  profileTemperature: number | null | undefined
}): boolean {
  return hasSelectedProfile && profileTemperature != null
}
