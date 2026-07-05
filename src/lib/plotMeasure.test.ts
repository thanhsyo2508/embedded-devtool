import { describe, expect, it } from 'vitest'
import { measure } from './plotMeasure'

describe('measure', () => {
  it('returns null for a channel with no real samples', () => {
    expect(measure([null, null], [0, 100])).toBeNull()
  })

  it('computes min/max/avg/peak-to-peak, skipping nulls', () => {
    const m = measure([1, null, 5, 3], [0, 100, 200, 300])
    expect(m).not.toBeNull()
    if (!m) return
    expect(m.min).toBe(1)
    expect(m.max).toBe(5)
    expect(m.avg).toBeCloseTo(3)
    expect(m.peakToPeak).toBe(4)
  })

  it('a flat line reports null frequency', () => {
    const values = Array(100).fill(7) as number[]
    const timestamps = values.map((_, i) => i * 10)
    const m = measure(values, timestamps)
    expect(m).not.toBeNull()
    if (!m) return
    expect(m.frequencyHz).toBeNull()
    expect(m.peakToPeak).toBe(0)
  })

  it('estimates the frequency of a synthetic sine', () => {
    // 5 Hz sine sampled at 200 Hz for 2 seconds.
    const fs = 200
    const f = 5
    const values: number[] = []
    const timestamps: number[] = []
    for (let i = 0; i < 2 * fs; i++) {
      const tSec = i / fs
      values.push(Math.sin(2 * Math.PI * f * tSec))
      timestamps.push(tSec * 1000)
    }
    const m = measure(values, timestamps)
    expect(m).not.toBeNull()
    if (!m) return
    expect(m.frequencyHz).not.toBeNull()
    expect(m.frequencyHz!).toBeGreaterThan(4.5)
    expect(m.frequencyHz!).toBeLessThan(5.5)
  })
})
