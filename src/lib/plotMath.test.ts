import { describe, expect, it } from 'vitest'
import { computeMathChannel, type MathChannelDef } from './plotMath'

function def(patch: Partial<MathChannelDef>): MathChannelDef {
  return {
    id: 't',
    enabled: true,
    label: 'test',
    op: 'add',
    sourceA: 'a',
    ...patch,
  }
}

describe('binary ops', () => {
  const timestamps = [0, 100, 200, 300]
  const data = {
    a: [1, 2, null, 4] as (number | null)[],
    b: [10, 20, 30, 0] as (number | null)[],
  }

  it('adds element-wise, propagating nulls', () => {
    expect(computeMathChannel(def({ op: 'add', sourceB: 'b' }), data, timestamps)).toEqual([
      11,
      22,
      null,
      4,
    ])
  })

  it('division by zero yields null, not Infinity', () => {
    expect(computeMathChannel(def({ op: 'div', sourceB: 'b' }), data, timestamps)).toEqual([
      0.1,
      0.1,
      null,
      null,
    ])
  })

  it('missing source B yields all nulls', () => {
    expect(computeMathChannel(def({ op: 'add', sourceB: 'nope' }), data, timestamps)).toEqual([
      null,
      null,
      null,
      null,
    ])
  })
})

describe('movingAvg', () => {
  it('averages a trailing window, shrinking at the start', () => {
    const data = { a: [2, 4, 6, 8] as (number | null)[] }
    expect(computeMathChannel(def({ op: 'movingAvg', window: 2 }), data, [0, 1, 2, 3])).toEqual([
      2, 3, 5, 7,
    ])
  })
})

describe('rms', () => {
  it('computes root-mean-square over the trailing window', () => {
    const data = { a: [3, 4, 0] as (number | null)[] }
    const out = computeMathChannel(def({ op: 'rms', window: 2 }), data, [0, 1, 2])
    expect(out[0]).toBeCloseTo(3)
    expect(out[1]).toBeCloseTo(Math.sqrt((9 + 16) / 2))
    expect(out[2]).toBeCloseTo(Math.sqrt(16 / 2))
  })
})

describe('derivative', () => {
  it('a linear ramp has a constant derivative in units/second', () => {
    // 5 units per 100ms = 50 units/second.
    const data = { a: [0, 5, 10, 15] as (number | null)[] }
    const out = computeMathChannel(def({ op: 'derivative' }), data, [0, 100, 200, 300])
    expect(out[0]).toBeNull()
    expect(out[1]).toBeCloseTo(50)
    expect(out[2]).toBeCloseTo(50)
    expect(out[3]).toBeCloseTo(50)
  })

  it('dt of zero yields null instead of Infinity', () => {
    const data = { a: [0, 5] as (number | null)[] }
    // Same-millisecond timestamps are common when a batch of lines lands
    // in one ingest tick.
    expect(computeMathChannel(def({ op: 'derivative' }), data, [100, 100])).toEqual([null, null])
  })
})

describe('missing source A', () => {
  it('yields all nulls', () => {
    expect(computeMathChannel(def({ sourceA: 'nope', sourceB: 'b' }), { b: [1] }, [0])).toEqual([
      null,
    ])
  })
})
