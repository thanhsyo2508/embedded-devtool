import { describe, expect, it } from 'vitest'
import { inspectBytes } from './dataInspect'

describe('inspectBytes', () => {
  it('decodes a little-endian uint32', () => {
    const r = inspectBytes([0x01, 0x00, 0x00, 0x00], 'le')
    expect(r.uint32).toBe('1')
    expect(r.uint16).toBe('1')
    expect(r.uint8).toBe('1')
  })

  it('decodes a big-endian uint32', () => {
    const r = inspectBytes([0x00, 0x00, 0x00, 0x01], 'be')
    expect(r.uint32).toBe('1')
  })

  it('decodes a signed negative int8', () => {
    expect(inspectBytes([0xff], 'le').int8).toBe('-1')
    expect(inspectBytes([0xff], 'le').uint8).toBe('255')
  })

  it('decodes float32 (1.0 little-endian)', () => {
    expect(inspectBytes([0x00, 0x00, 0x80, 0x3f], 'le').float32).toBe('1')
  })

  it('decodes a 64-bit value via BigInt', () => {
    const r = inspectBytes([0x01, 0, 0, 0, 0, 0, 0, 0], 'le')
    expect(r.uint64).toBe('1')
  })

  it('shows dashes for widths that do not fit', () => {
    const r = inspectBytes([0x41], 'le')
    expect(r.int16).toBe('—')
    expect(r.int32).toBe('—')
    expect(r.int64).toBe('—')
  })

  it('renders ASCII and binary', () => {
    const r = inspectBytes([0x41, 0x00], 'le')
    expect(r.ascii).toBe('A.')
    expect(r.binary).toBe('01000001 00000000')
  })
})
