import { describe, expect, it } from 'vitest'
import { relativeTime } from './relativeTime'

describe('relativeTime', () => {
  it('is "now" for sub-second deltas', () => {
    expect(relativeTime(1000, 1400)).toBe('now')
  })

  it('shows seconds under a minute', () => {
    expect(relativeTime(0, 45_000)).toBe('45s ago')
  })

  it('shows minutes under an hour', () => {
    expect(relativeTime(0, 5 * 60_000)).toBe('5m ago')
  })

  it('shows hours at and beyond an hour', () => {
    expect(relativeTime(0, 2 * 3_600_000)).toBe('2h ago')
  })

  it('clamps to "now" rather than going negative for future timestamps', () => {
    expect(relativeTime(5000, 1000)).toBe('now')
  })
})
