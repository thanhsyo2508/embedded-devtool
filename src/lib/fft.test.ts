import { describe, expect, it } from 'vitest'
import { computeSpectrum, largestPow2AtMost, windowValue, FFT_MIN_SAMPLES } from './fft'

/** Builds a uniformly-sampled capture: `count` samples at `fs` Hz of
 * `f(tSec)`. Uniform input means the resampler is a near-no-op, so these
 * tests exercise the FFT/window math itself. */
function synth(count: number, fs: number, f: (tSec: number) => number) {
  const timestampsMs: number[] = []
  const values: number[] = []
  for (let i = 0; i < count; i++) {
    const tSec = i / fs
    timestampsMs.push(tSec * 1000)
    values.push(f(tSec))
  }
  return { timestampsMs, values }
}

describe('largestPow2AtMost', () => {
  it('returns the largest power of two not exceeding n', () => {
    expect(largestPow2AtMost(1)).toBe(1)
    expect(largestPow2AtMost(1024)).toBe(1024)
    expect(largestPow2AtMost(1500)).toBe(1024)
    expect(largestPow2AtMost(5000)).toBe(4096)
  })
})

describe('windowValue', () => {
  it('hann endpoints are ~0 and midpoint is 1', () => {
    const n = 512
    expect(windowValue('hann', 0, n)).toBeCloseTo(0, 10)
    expect(windowValue('hann', n - 1, n)).toBeCloseTo(0, 10)
    expect(windowValue('hann', (n - 1) / 2, n)).toBeCloseTo(1, 10)
  })

  it('none is identically 1', () => {
    expect(windowValue('none', 0, 100)).toBe(1)
    expect(windowValue('none', 99, 100)).toBe(1)
  })
})

describe('computeSpectrum', () => {
  it('returns null when the capture is too short', () => {
    const { timestampsMs, values } = synth(FFT_MIN_SAMPLES - 1, 100, () => 1)
    expect(computeSpectrum(values, timestampsMs, 'none')).toBeNull()
  })

  // 1024 samples at 1024 Hz: capture duration = 1023/1024 s, N = 1024, so
  // fs = (N-1)/duration = 1024 Hz exactly and bin k sits at k Hz — placing
  // the sine at 50 Hz puts it exactly on bin 50, avoiding scalloping loss
  // that would make amplitude assertions flaky.
  it.each(['none', 'hann', 'hamming'] as const)(
    'unit sine at a bin center peaks at the right bin with ~1.0 amplitude (%s window)',
    (window) => {
      const { timestampsMs, values } = synth(1024, 1024, (t) => Math.sin(2 * Math.PI * 50 * t))
      const spectrum = computeSpectrum(values, timestampsMs, window)
      expect(spectrum).not.toBeNull()
      if (!spectrum) return

      let peakBin = 0
      for (let k = 1; k < spectrum.magnitudes.length; k++) {
        if (spectrum.magnitudes[k] > spectrum.magnitudes[peakBin]) peakBin = k
      }
      expect(spectrum.frequencies[peakBin]).toBeCloseTo(50, 0)
      // Σw normalization: amplitude reads ~1.0 for every window, not
      // window-gain-scaled (Hann would read 0.5 under a plain 2/N).
      expect(spectrum.magnitudes[peakBin]).toBeGreaterThan(0.9)
      expect(spectrum.magnitudes[peakBin]).toBeLessThan(1.1)
    },
  )

  it('a pure DC signal produces a flat spectrum (mean removed, DC bin zeroed)', () => {
    const { timestampsMs, values } = synth(256, 100, () => 42)
    const spectrum = computeSpectrum(values, timestampsMs, 'none')
    expect(spectrum).not.toBeNull()
    if (!spectrum) return
    for (const m of spectrum.magnitudes) {
      expect(m).toBeCloseTo(0, 6)
    }
  })

  it('a channel with a long null prefix still yields a spectrum', () => {
    const { timestampsMs, values } = synth(512, 512, (t) => Math.sin(2 * Math.PI * 20 * t))
    const withNulls: (number | null)[] = values.map((v, i) => (i < 200 ? null : v))
    const spectrum = computeSpectrum(withNulls, timestampsMs, 'hann')
    expect(spectrum).not.toBeNull()
    if (!spectrum) return
    let peakBin = 0
    for (let k = 1; k < spectrum.magnitudes.length; k++) {
      if (spectrum.magnitudes[k] > spectrum.magnitudes[peakBin]) peakBin = k
    }
    // The held-flat prefix weakens and smears the peak, but it must still
    // land near 20 Hz.
    expect(Math.abs(spectrum.frequencies[peakBin] - 20)).toBeLessThan(3)
  })

  it('a channel with almost no real samples yields a flat-zero spectrum, not null', () => {
    const { timestampsMs } = synth(256, 100, () => 0)
    const mostlyNull: (number | null)[] = timestampsMs.map((_, i) => (i < 3 ? 1 : null))
    const spectrum = computeSpectrum(mostlyNull, timestampsMs, 'none')
    expect(spectrum).not.toBeNull()
    if (!spectrum) return
    expect(spectrum.magnitudes.every((m) => m === 0)).toBe(true)
  })
})
