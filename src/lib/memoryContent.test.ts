import { describe, expect, it } from 'vitest'
import { encodeMemoryContent } from './memoryContent'

describe('encodeMemoryContent', () => {
  it('encodes text as UTF-8 bytes', () => {
    expect(encodeMemoryContent('text', 'AB')).toEqual([0x41, 0x42])
  })

  it('encodes hex pairs into bytes', () => {
    expect(encodeMemoryContent('hex', '01 02 FF')).toEqual([1, 2, 255])
  })

  it('rejects malformed hex', () => {
    expect(() => encodeMemoryContent('hex', '01 2')).toThrow()
    expect(() => encodeMemoryContent('hex', '')).toThrow()
  })

  it('encodes a decimal integer as 4 little-endian bytes', () => {
    expect(encodeMemoryContent('dec', '1')).toEqual([1, 0, 0, 0])
    expect(encodeMemoryContent('dec', '256')).toEqual([0, 1, 0, 0])
    expect(encodeMemoryContent('dec', '-1')).toEqual([0xff, 0xff, 0xff, 0xff])
  })

  it('rejects decimal input outside 32-bit range or non-integers', () => {
    expect(() => encodeMemoryContent('dec', '4294967296')).toThrow()
    expect(() => encodeMemoryContent('dec', '1.5')).toThrow()
    expect(() => encodeMemoryContent('dec', 'nope')).toThrow()
  })

  it('encodes valid JSON as its own UTF-8 text', () => {
    expect(encodeMemoryContent('json', '{"a":1}')).toEqual(
      Array.from(new TextEncoder().encode('{"a":1}')),
    )
  })

  it('rejects malformed JSON', () => {
    expect(() => encodeMemoryContent('json', '{a:1}')).toThrow()
  })
})
