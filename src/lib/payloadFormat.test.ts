import { describe, expect, it } from 'vitest'
import { jsonParseError, looksBinary, toHexDump, tryPrettyJson } from './payloadFormat'

function bytesOf(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

describe('tryPrettyJson', () => {
  it('pretty-prints valid JSON', () => {
    expect(tryPrettyJson(bytesOf('{"a":1}'))).toBe('{\n  "a": 1\n}')
  })

  it('returns null for non-JSON text', () => {
    expect(tryPrettyJson(bytesOf('hello world'))).toBeNull()
  })

  it('returns null for empty payload', () => {
    expect(tryPrettyJson([])).toBeNull()
  })
})

describe('toHexDump', () => {
  it('formats bytes as lowercase space-separated hex pairs', () => {
    expect(toHexDump([0, 255, 16])).toBe('00 ff 10')
  })

  it('is empty for no bytes', () => {
    expect(toHexDump([])).toBe('')
  })
})

describe('looksBinary', () => {
  it('is false for plain text', () => {
    expect(looksBinary(bytesOf('hello world 123'))).toBe(false)
  })

  it('is false for empty payload', () => {
    expect(looksBinary([])).toBe(false)
  })

  it('is true for mostly-control-byte payloads', () => {
    expect(looksBinary([0x00, 0x01, 0x02, 0x03, 0xff, 0x00, 0x01, 0x02])).toBe(true)
  })

  it('tolerates the occasional newline/tab in mostly-text payloads', () => {
    expect(looksBinary(bytesOf('line one\nline two\ttabbed'))).toBe(false)
  })
})

describe('jsonParseError', () => {
  it('is null for valid JSON', () => {
    expect(jsonParseError('{"a":1}')).toBeNull()
  })

  it('is null for blank input (nothing to publish is not an error)', () => {
    expect(jsonParseError('')).toBeNull()
    expect(jsonParseError('   ')).toBeNull()
  })

  it('returns a message for malformed JSON', () => {
    expect(jsonParseError('{a:1}')).not.toBeNull()
  })
})
