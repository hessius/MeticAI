/** Ambient room temperature (°C) used as the 0% baseline for heating progress. */
export const AMBIENT_BASELINE = 20

/**
 * Maps a temperature reading onto a 0–100% progress scale spanning
 * `AMBIENT_BASELINE` → `setTemp`. Returns 100 for a non-positive span (avoids
 * divide-by-zero) and clamps sub-ambient / over-target readings to [0, 100].
 */
export function progressPercent(temp: number, setTemp: number): number {
  const span = setTemp - AMBIENT_BASELINE
  if (span <= 0) return 100
  return Math.max(0, Math.min(100, ((temp - AMBIENT_BASELINE) / span) * 100))
}
