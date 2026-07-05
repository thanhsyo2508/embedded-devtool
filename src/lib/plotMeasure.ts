/** Automatic per-channel measurements for the plotter's stats strip
 * (Tháng 7). Pure function, no React/Tauri deps. */

export interface ChannelMeasurement {
  min: number
  max: number
  avg: number
  peakToPeak: number
  /** Estimated via mean-crossing counting with hysteresis; null when the
   * signal is flat or has too few crossings for a meaningful estimate. */
  frequencyHz: number | null
}

/** Fraction of peak-to-peak used as the hysteresis band around the mean —
 * without it, a flat-ish noisy line "crosses" its mean constantly and
 * reports a garbage frequency. */
const HYSTERESIS_FRACTION = 0.05
const MIN_CROSSINGS = 3

export function measure(
  values: (number | null)[],
  timestampsMs: number[],
): ChannelMeasurement | null {
  let min = Infinity
  let max = -Infinity
  let sum = 0
  let count = 0
  for (const v of values) {
    if (v === null || !Number.isFinite(v)) continue
    if (v < min) min = v
    if (v > max) max = v
    sum += v
    count++
  }
  if (count === 0) return null

  const avg = sum / count
  const peakToPeak = max - min

  let frequencyHz: number | null = null
  if (peakToPeak > 0 && timestampsMs.length >= 2) {
    const upper = avg + peakToPeak * HYSTERESIS_FRACTION
    const lower = avg - peakToPeak * HYSTERESIS_FRACTION
    // Count upward crossings of the hysteresis band: the signal must dip
    // below `lower` before another pass above `upper` counts again.
    let armed = false
    let crossings = 0
    let firstCrossMs: number | null = null
    let lastCrossMs: number | null = null
    for (let i = 0; i < values.length; i++) {
      const v = values[i]
      if (v === null || !Number.isFinite(v)) continue
      if (v < lower) {
        armed = true
      } else if (armed && v > upper) {
        armed = false
        crossings++
        if (firstCrossMs === null) firstCrossMs = timestampsMs[i]
        lastCrossMs = timestampsMs[i]
      }
    }
    if (
      crossings >= MIN_CROSSINGS &&
      firstCrossMs !== null &&
      lastCrossMs !== null &&
      lastCrossMs > firstCrossMs
    ) {
      // crossings - 1 full periods elapsed between the first and last
      // upward crossing.
      frequencyHz = ((crossings - 1) * 1000) / (lastCrossMs - firstCrossMs)
    }
  }

  return { min, max, avg, peakToPeak, frequencyHz }
}
