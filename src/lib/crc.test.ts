import { describe, expect, it } from 'vitest'
import { applyChecksum, crc16Modbus, crc8, sumChecksum8, xorChecksum8 } from './crc'

describe('crc16Modbus', () => {
  it('matches the standard Modbus read-holding-registers test vector', () => {
    expect(crc16Modbus([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a])).toEqual([0xc5, 0xcd])
  })

  it('is 0xFFFF for an empty input (unmodified initial register value)', () => {
    expect(crc16Modbus([])).toEqual([0xff, 0xff])
  })
})

describe('xorChecksum8', () => {
  it('xors every byte together', () => {
    expect(xorChecksum8([0x01, 0x02, 0x03])).toEqual([0x00])
    expect(xorChecksum8([0xff, 0x0f])).toEqual([0xf0])
  })
})

describe('sumChecksum8', () => {
  it('is the two’s complement of the 8-bit sum', () => {
    // 0x01 + 0x02 + 0x03 = 0x06 -> checksum 0xFA, and summing all bytes
    // including the checksum wraps to 0 mod 256.
    const bytes = [0x01, 0x02, 0x03]
    const checksum = sumChecksum8(bytes)
    expect(checksum).toEqual([0xfa])
    const total = [...bytes, ...checksum].reduce((acc, b) => (acc + b) & 0xff, 0)
    expect(total).toBe(0)
  })
})

describe('crc8', () => {
  it('is deterministic and non-trivial for non-empty input', () => {
    const a = crc8([0x01, 0x02, 0x03])
    const b = crc8([0x01, 0x02, 0x04])
    expect(a).not.toEqual(b)
    expect(crc8([])).toEqual([0x00])
  })
})

describe('applyChecksum', () => {
  it('returns bytes unchanged for "none"', () => {
    expect(applyChecksum([1, 2, 3], 'none')).toEqual([1, 2, 3])
  })

  it('appends the crc16-modbus bytes for the known vector', () => {
    expect(applyChecksum([0x01, 0x03, 0x00, 0x00, 0x00, 0x0a], 'crc16-modbus')).toEqual([
      0x01, 0x03, 0x00, 0x00, 0x00, 0x0a, 0xc5, 0xcd,
    ])
  })
})
