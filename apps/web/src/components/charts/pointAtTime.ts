// Returns the last data point at or before `time`, assuming `data` is sorted
// ascending by `time`. Used to drive the always-visible scrubber value readout
// so the values row never disappears at the start/end of a scrub (which
// previously caused the layout to jump).
export function pointAtTime<T extends { time: number }>(
  data: readonly T[],
  time: number
): T | undefined {
  if (data.length === 0) return undefined
  let result = data[0]
  for (const d of data) {
    if (d.time <= time) result = d
    else break
  }
  return result
}
