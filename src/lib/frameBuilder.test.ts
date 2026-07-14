import { describe, expect, it } from 'vitest'
import { encodeFrame, newFrameField, type FrameField } from './frameBuilder'

function field(overrides: Partial<FrameField>): FrameField {
  return { ...newFrameField(), ...overrides }
}

describe('encodeFrame', () => {
  it('encodes literal hex and text', () => {
    const { bytes } = encodeFrame([
      field({ type: 'hex', value: 'AA BB' }),
      field({ type: 'text', value: 'Hi' }),
    ])
    expect(bytes).toEqual([0xaa, 0xbb, 0x48, 0x69])
  })

  it('encodes uint16 in both endiannesses', () => {
    expect(encodeFrame([field({ type: 'uint16', value: '258', endian: 'le' })]).bytes).toEqual([
      0x02, 0x01,
    ])
    expect(encodeFrame([field({ type: 'uint16', value: '258', endian: 'be' })]).bytes).toEqual([
      0x01, 0x02,
    ])
  })

  it('computes a length field over following non-crc fields', () => {
    // length (1 byte) + payload of 3 bytes → length value is 3
    const { bytes } = encodeFrame([
      field({ type: 'length', lengthWidth: 1 }),
      field({ type: 'hex', value: '01 02 03' }),
    ])
    expect(bytes).toEqual([0x03, 0x01, 0x02, 0x03])
  })

  it('excludes a trailing crc from the length count', () => {
    const { bytes } = encodeFrame([
      field({ type: 'length', lengthWidth: 1 }),
      field({ type: 'hex', value: '01 02' }),
      field({ type: 'crc', crcMode: 'crc16-modbus' }),
    ])
    // length counts only the 2 payload bytes, not the 2 crc bytes
    expect(bytes?.[0]).toBe(0x02)
    expect(bytes?.length).toBe(1 + 2 + 2)
  })

  it('computes crc over all preceding bytes', () => {
    const { bytes } = encodeFrame([
      field({ type: 'hex', value: '01 03 00 00 00 0A' }),
      field({ type: 'crc', crcMode: 'crc16-modbus' }),
    ])
    // Known Modbus CRC for 01 03 00 00 00 0A is C5 CD (LE)
    expect(bytes?.slice(-2)).toEqual([0xc5, 0xcd])
  })

  it('reports an error for invalid hex', () => {
    const { bytes, error } = encodeFrame([field({ type: 'hex', value: 'ZZ' })])
    expect(bytes).toBeNull()
    expect(error).toMatch(/invalid hex/)
  })

  it('reports an error for an out-of-range integer', () => {
    const { error } = encodeFrame([field({ type: 'uint8', value: '999' })])
    expect(error).toMatch(/out of range/)
  })
})
