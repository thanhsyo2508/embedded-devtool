import { describe, expect, it } from 'vitest'
import { diffLines, diffStats } from './lineDiff'

describe('diffLines', () => {
  it('marks identical logs as all-same', () => {
    const rows = diffLines(['a', 'b', 'c'], ['a', 'b', 'c'])
    expect(rows.every((r) => r.kind === 'same')).toBe(true)
    expect(rows).toHaveLength(3)
  })

  it('detects an added line', () => {
    const rows = diffLines(['a', 'c'], ['a', 'b', 'c'])
    expect(rows.map((r) => r.kind)).toEqual(['same', 'added', 'same'])
    const added = rows.find((r) => r.kind === 'added')
    expect(added?.right).toBe('b')
    expect(added?.left).toBeNull()
  })

  it('detects a removed line', () => {
    const rows = diffLines(['a', 'b', 'c'], ['a', 'c'])
    const removed = rows.find((r) => r.kind === 'removed')
    expect(removed?.left).toBe('b')
    expect(removed?.right).toBeNull()
  })

  it('handles one empty side', () => {
    const rows = diffLines([], ['x', 'y'])
    expect(rows.map((r) => r.kind)).toEqual(['added', 'added'])
  })

  it('counts stats', () => {
    const rows = diffLines(['a', 'b'], ['a', 'c'])
    const stats = diffStats(rows)
    expect(stats.same).toBe(1)
    expect(stats.removed).toBe(1)
    expect(stats.added).toBe(1)
  })
})
