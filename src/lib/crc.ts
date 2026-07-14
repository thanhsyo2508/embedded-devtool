/** General-purpose checksum/CRC helpers for the Send panel — independent of
 * the Modbus codec (`./modbus.ts`), which happens to use `crc16Modbus` too.
 * Each function returns the checksum byte(s) to append, not a combined frame. */

/** CRC-16/MODBUS: poly 0xA001 (reflected 0x8005), init 0xFFFF, no output
 * XOR. Returned low-byte first, matching how it's transmitted on the wire. */
export function crc16Modbus(bytes: number[]): number[] {
  let crc = 0xffff
  for (const b of bytes) {
    crc ^= b
    for (let i = 0; i < 8; i++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1
    }
  }
  return [crc & 0xff, (crc >> 8) & 0xff]
}

/** CRC-16/XMODEM: poly 0x1021, init 0x0000, no reflection. Returned
 * high-byte first (the common convention for this variant). */
export function crc16Ccitt(bytes: number[]): number[] {
  let crc = 0x0000
  for (const b of bytes) {
    crc ^= b << 8
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return [(crc >> 8) & 0xff, crc & 0xff]
}

/** CRC-8/SMBUS: poly 0x07, init 0x00, no reflection. */
export function crc8(bytes: number[]): number[] {
  let crc = 0x00
  for (const b of bytes) {
    crc ^= b
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x80 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff
    }
  }
  return [crc]
}

/** XOR of every byte — the simplest checksum convention, used by several
 * ASCII/text serial protocols. */
export function xorChecksum8(bytes: number[]): number[] {
  return [bytes.reduce((acc, b) => acc ^ b, 0)]
}

/** Two's-complement of the 8-bit sum, so a receiver can self-verify by
 * summing every received byte including the checksum and expecting 0. */
export function sumChecksum8(bytes: number[]): number[] {
  const sum = bytes.reduce((acc, b) => (acc + b) & 0xff, 0)
  return [(0x100 - sum) & 0xff]
}

export type ChecksumMode = 'none' | 'crc16-modbus' | 'crc16-ccitt' | 'crc8' | 'xor8' | 'sum8'

export const CHECKSUM_MODES: { value: ChecksumMode; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'crc16-modbus', label: 'CRC16 (Modbus)' },
  { value: 'crc16-ccitt', label: 'CRC16 (CCITT)' },
  { value: 'crc8', label: 'CRC8' },
  { value: 'xor8', label: 'XOR checksum' },
  { value: 'sum8', label: 'Sum checksum' },
]

/** Just the checksum bytes for `mode` over `bytes` (empty for `'none'`) —
 * unlike applyChecksum, which appends them to the input. */
export function checksumBytes(bytes: number[], mode: ChecksumMode): number[] {
  switch (mode) {
    case 'none':
      return []
    case 'crc16-modbus':
      return crc16Modbus(bytes)
    case 'crc16-ccitt':
      return crc16Ccitt(bytes)
    case 'crc8':
      return crc8(bytes)
    case 'xor8':
      return xorChecksum8(bytes)
    case 'sum8':
      return sumChecksum8(bytes)
  }
}

/** Appends the checksum for `mode` to `bytes`; returns `bytes` unchanged for `'none'`. */
export function applyChecksum(bytes: number[], mode: ChecksumMode): number[] {
  return [...bytes, ...checksumBytes(bytes, mode)]
}
