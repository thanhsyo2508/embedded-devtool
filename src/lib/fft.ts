/** FFT spectrum computation for the plotter (Tháng 7). Pure functions, no
 * React/Tauri deps.
 *
 * The plot store's samples arrive at real, non-uniform timestamps, so the
 * pipeline is: pick one power-of-2 grid size N from the sample count
 * (interpolating up, never decimating down — decimation without an
 * anti-alias filter would fold high frequencies back into the spectrum),
 * linearly resample every channel onto the same uniform grid (uPlot has a
 * single shared x array), remove the mean (embedded data usually rides on
 * a big DC offset that would otherwise leak across bins and swamp small
 * signals), apply the window, then a radix-2 FFT.
 *
 * Magnitudes are normalized by 2/Σw (1/Σw for DC) rather than 2/N so a
 * unit-amplitude sine reads ~1.0 regardless of window choice — plain 2/N
 * under-reads by the window's coherent gain (0.5 for Hann). */

export type FftWindow = 'none' | 'hann' | 'hamming'

export const FFT_MIN_SAMPLES = 64
const FFT_MAX_N = 4096
/** Below this many real (non-null) samples a channel's spectrum is
 * rendered flat-zero instead of garbage from interpolating almost nothing. */
const MIN_VALID_SAMPLES = 8

export function largestPow2AtMost(n: number): number {
  let p = 1
  while (p * 2 <= n) p *= 2
  return p
}

export function windowValue(kind: FftWindow, i: number, n: number): number {
  switch (kind) {
    case 'none':
      return 1
    case 'hann':
      return 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
    case 'hamming':
      return 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1))
  }
}

/** In-place iterative radix-2 FFT. `re`/`im` length must be a power of 2. */
function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length
  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k]
        const uIm = im[i + k]
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe
        re[i + k] = uRe + vRe
        im[i + k] = uIm + vIm
        re[i + k + len / 2] = uRe - vRe
        im[i + k + len / 2] = uIm - vIm
        const nextRe = curRe * wRe - curIm * wIm
        curIm = curRe * wIm + curIm * wRe
        curRe = nextRe
      }
    }
  }
}

/** Linearly resamples one channel onto the uniform grid `tk = t0 +
 * k·duration/(N-1)`. Values are interpolated within the channel's non-null
 * span and hold-extended outside it (null prefixes are normal — every
 * channel that first appears mid-capture has one). Returns null if the
 * channel has fewer than MIN_VALID_SAMPLES real values. */
function resampleUniform(
  values: (number | null)[],
  timestampsMs: number[],
  n: number,
): Float64Array | null {
  const validTimes: number[] = []
  const validValues: number[] = []
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v !== null && Number.isFinite(v)) {
      validTimes.push(timestampsMs[i])
      validValues.push(v)
    }
  }
  if (validValues.length < MIN_VALID_SAMPLES) return null

  const t0 = timestampsMs[0]
  const duration = timestampsMs[timestampsMs.length - 1] - t0
  if (duration <= 0) return null

  const out = new Float64Array(n)
  let seg = 0
  for (let k = 0; k < n; k++) {
    const t = t0 + (k * duration) / (n - 1)
    while (seg < validTimes.length - 2 && validTimes[seg + 1] < t) seg++
    const tA = validTimes[seg]
    const tB = validTimes[seg + 1]
    if (t <= validTimes[0]) {
      out[k] = validValues[0] // hold-extend before the first valid sample
    } else if (t >= validTimes[validTimes.length - 1]) {
      out[k] = validValues[validValues.length - 1]
    } else if (tB === tA) {
      out[k] = validValues[seg]
    } else {
      const frac = (t - tA) / (tB - tA)
      out[k] = validValues[seg] + frac * (validValues[seg + 1] - validValues[seg])
    }
  }
  return out
}

export interface Spectrum {
  /** Bin center frequencies in Hz, bins 0..N/2 inclusive. */
  frequencies: number[]
  /** Peak-amplitude-normalized magnitudes per bin (DC rendered as 0). */
  magnitudes: number[]
}

/** Computes the amplitude spectrum of one channel. Returns null when the
 * whole capture is too short (fewer than FFT_MIN_SAMPLES timestamps);
 * returns a flat-zero spectrum for a channel that exists but has too few
 * real samples, so callers keep every channel's series/data aligned. */
export function computeSpectrum(
  values: (number | null)[],
  timestampsMs: number[],
  window: FftWindow,
): Spectrum | null {
  if (timestampsMs.length < FFT_MIN_SAMPLES) return null
  const n = Math.min(largestPow2AtMost(timestampsMs.length), FFT_MAX_N)
  const durationSec = (timestampsMs[timestampsMs.length - 1] - timestampsMs[0]) / 1000
  if (durationSec <= 0) return null
  const fs = (n - 1) / durationSec

  const frequencies: number[] = []
  for (let k = 0; k <= n / 2; k++) frequencies.push((k * fs) / n)

  const resampled = resampleUniform(values, timestampsMs, n)
  if (resampled === null) {
    return { frequencies, magnitudes: frequencies.map(() => 0) }
  }

  let mean = 0
  for (let i = 0; i < n; i++) mean += resampled[i]
  mean /= n

  const re = new Float64Array(n)
  const im = new Float64Array(n)
  let windowSum = 0
  for (let i = 0; i < n; i++) {
    const w = windowValue(window, i, n)
    windowSum += w
    re[i] = (resampled[i] - mean) * w
  }

  fftInPlace(re, im)

  const magnitudes: number[] = []
  for (let k = 0; k <= n / 2; k++) {
    if (k === 0) {
      magnitudes.push(0) // mean was removed; DC bin is residual noise
    } else {
      const scale = k === n / 2 ? 1 / windowSum : 2 / windowSum
      magnitudes.push(scale * Math.hypot(re[k], im[k]))
    }
  }
  return { frequencies, magnitudes }
}
