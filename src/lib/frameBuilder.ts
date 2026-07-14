import { parseHex } from './hex'
import { checksumBytes, type ChecksumMode } from './crc'

/** A binary-frame builder: define an ordered list of fields (literal bytes,
 * text, integers, an auto length, an auto CRC) and encode them into the
 * exact bytes to send — the "protocol templates" idea from the roadmap, for
 * devices that speak a framed binary protocol rather than line text. */

export type FrameFieldType = 'hex' | 'text' | 'uint8' | 'uint16' | 'uint32' | 'length' | 'crc'

export type FrameEndian = 'le' | 'be'

export interface FrameField {
  id: string
  type: FrameFieldType
  /** Literal value for hex/text/uintN; ignored for the computed length/crc. */
  value: string
  /** For uint16/uint32 and length. */
  endian: FrameEndian
  /** Byte width for a `length` field. */
  lengthWidth: 1 | 2 | 4
  /** Algorithm for a `crc` field. */
  crcMode: ChecksumMode
}

export function newFrameField(type: FrameFieldType = 'hex'): FrameField {
  return {
    id: `f-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type,
    value: '',
    endian: 'le',
    lengthWidth: 1,
    crcMode: 'crc16-modbus',
  }
}

function encodeUint(value: number, width: 1 | 2 | 4, endian: FrameEndian): number[] {
  const bytes: number[] = []
  for (let i = 0; i < width; i++) {
    bytes.push((value >>> (8 * i)) & 0xff)
  }
  return endian === 'le' ? bytes : bytes.reverse()
}

/** The fixed byte-length a field always contributes, independent of the
 * values around it — used so a `length` field can be computed without a
 * circular dependency (every field's width is knowable up front). */
function fieldByteLength(field: FrameField): number {
  switch (field.type) {
    case 'hex':
      return (parseHex(field.value) ?? []).length
    case 'text':
      return new TextEncoder().encode(field.value).length
    case 'uint8':
      return 1
    case 'uint16':
      return 2
    case 'uint32':
      return 4
    case 'length':
      return field.lengthWidth
    case 'crc':
      return checksumBytes([0], field.crcMode).length
  }
}

export interface FrameEncodeResult {
  bytes: number[] | null
  error: string | null
}

/** Encodes the fields in order. A `length` field carries the total byte
 * count of every field after it that isn't a CRC (the common "length covers
 * the payload" convention); a `crc` field is computed over all bytes emitted
 * before it. Returns an error string (not throwing) on the first malformed
 * field so the UI can point at what's wrong. */
export function encodeFrame(fields: FrameField[]): FrameEncodeResult {
  const out: number[] = []

  for (let i = 0; i < fields.length; i++) {
    const field = fields[i]
    switch (field.type) {
      case 'hex': {
        const bytes = parseHex(field.value)
        if (bytes === null) return { bytes: null, error: `Field ${i + 1}: invalid hex` }
        out.push(...bytes)
        break
      }
      case 'text':
        out.push(...Array.from(new TextEncoder().encode(field.value)))
        break
      case 'uint8':
      case 'uint16':
      case 'uint32': {
        const width = field.type === 'uint8' ? 1 : field.type === 'uint16' ? 2 : 4
        const n = Number(field.value.trim())
        const max = width === 1 ? 0xff : width === 2 ? 0xffff : 0xffffffff
        if (!Number.isInteger(n) || n < 0 || n > max) {
          return { bytes: null, error: `Field ${i + 1}: value out of range for ${field.type}` }
        }
        out.push(...encodeUint(n, width, field.endian))
        break
      }
      case 'length': {
        const following = fields
          .slice(i + 1)
          .filter((f) => f.type !== 'crc')
          .reduce((sum, f) => sum + fieldByteLength(f), 0)
        const max = field.lengthWidth === 1 ? 0xff : field.lengthWidth === 2 ? 0xffff : 0xffffffff
        if (following > max) {
          return { bytes: null, error: `Field ${i + 1}: length ${following} exceeds field width` }
        }
        out.push(...encodeUint(following, field.lengthWidth, field.endian))
        break
      }
      case 'crc':
        out.push(...checksumBytes(out, field.crcMode))
        break
    }
  }

  return { bytes: out, error: null }
}
