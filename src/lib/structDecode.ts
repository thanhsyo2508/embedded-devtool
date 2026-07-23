/** Decodes a run of bytes against a small C-struct-like field template, for
 * the Data Inspector's "Struct" mode — instead of reading one primitive at a
 * time, you describe a binary frame's layout once and read every field back
 * with its own name. Deliberately a tiny hand-rolled format (one field per
 * line), not a real C parser: enough for the "what does this frame say?"
 * decode a firmware dev does constantly, without pulling in a grammar. */

import type { Endianness } from './dataInspect'

export interface StructField {
  name: string
  type: string
  value: string
}

export interface StructDecodeResult {
  fields: StructField[]
  /** Set when the template itself is malformed (bad line) — distinct from
   * simply running out of bytes, which stops decoding but isn't an error. */
  templateError: string | null
  /** True once the byte run was too short to fill the next field. */
  truncated: boolean
}

interface FieldSpec {
  type: string
  name: string
  size: number
  kind: 'num' | 'char' | 'bytes' | 'pad'
}

const FIXED_SIZES: Record<string, number> = {
  int8: 1,
  uint8: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  int64: 8,
  uint64: 8,
  float32: 4,
  float64: 8,
}

/** `char[N]`, `bytes[N]`, `pad[N]` (or `skip[N]`) carry their length in the
 * type; everything else is a fixed-width number. Returns a spec or an error
 * string for one non-empty template line. */
function parseLine(line: string): FieldSpec | string {
  const withoutComment = line.split('//')[0].trim()
  if (withoutComment.length === 0) return { type: '', name: '', size: 0, kind: 'pad' } // blank
  const parts = withoutComment.split(/\s+/)
  const type = parts[0].toLowerCase()
  const name = parts.slice(1).join(' ')

  const arrayMatch = /^(char|bytes|pad|skip)\[(\d+)\]$/.exec(type)
  if (arrayMatch) {
    const kind = arrayMatch[1] === 'char' ? 'char' : arrayMatch[1] === 'bytes' ? 'bytes' : 'pad'
    return { type, name, size: Number(arrayMatch[2]), kind }
  }

  const fixed = FIXED_SIZES[type]
  if (fixed === undefined) return `unknown type "${parts[0]}"`
  return { type, name, size: fixed, kind: 'num' }
}

function formatFloat(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  return Number(v.toPrecision(7)).toString()
}

function readNumber(dv: DataView, offset: number, type: string, le: boolean): string {
  switch (type) {
    case 'int8':
      return String(dv.getInt8(offset))
    case 'uint8':
      return String(dv.getUint8(offset))
    case 'int16':
      return String(dv.getInt16(offset, le))
    case 'uint16':
      return String(dv.getUint16(offset, le))
    case 'int32':
      return String(dv.getInt32(offset, le))
    case 'uint32':
      return String(dv.getUint32(offset, le))
    case 'int64':
      return dv.getBigInt64(offset, le).toString()
    case 'uint64':
      return dv.getBigUint64(offset, le).toString()
    case 'float32':
      return formatFloat(dv.getFloat32(offset, le))
    case 'float64':
      return formatFloat(dv.getFloat64(offset, le))
    default:
      return ''
  }
}

export function decodeStruct(
  bytes: number[],
  template: string,
  endian: Endianness,
): StructDecodeResult {
  const buf = new Uint8Array(bytes)
  const dv = new DataView(buf.buffer)
  const le = endian === 'le'
  const fields: StructField[] = []
  let offset = 0
  let truncated = false

  const lines = template.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const spec = parseLine(lines[i])
    if (typeof spec === 'string') {
      return { fields, templateError: `line ${i + 1}: ${spec}`, truncated }
    }
    if (spec.size === 0 && spec.kind === 'pad' && spec.type === '') continue // blank/comment line

    if (offset + spec.size > bytes.length) {
      truncated = true
      break
    }

    if (spec.kind === 'pad') {
      offset += spec.size
      continue
    }
    if (spec.kind === 'char') {
      const str = Array.from(buf.subarray(offset, offset + spec.size))
        .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'))
        .join('')
      fields.push({ name: spec.name || `char[${spec.size}]`, type: spec.type, value: str })
      offset += spec.size
      continue
    }
    if (spec.kind === 'bytes') {
      const hex = Array.from(buf.subarray(offset, offset + spec.size))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ')
      fields.push({ name: spec.name || spec.type, type: spec.type, value: hex })
      offset += spec.size
      continue
    }
    fields.push({
      name: spec.name || spec.type,
      type: spec.type,
      value: readNumber(dv, offset, spec.type, le),
    })
    offset += spec.size
  }

  return { fields, templateError: null, truncated }
}
