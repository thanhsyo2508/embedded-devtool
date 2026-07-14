/** Numeric/text interpretations of a byte sequence for the Data Inspector —
 * select a run of bytes in the monitor and read it back as int/uint/float in
 * either endianness, the kind of quick "what does this frame actually say?"
 * decode you'd otherwise do by hand or in a scratch script. */

export type Endianness = 'le' | 'be'

export interface InspectResult {
  int8: string
  uint8: string
  int16: string
  uint16: string
  int32: string
  uint32: string
  int64: string
  uint64: string
  float32: string
  float64: string
  ascii: string
  binary: string
}

const NA = '—'

function view(bytes: number[]): DataView {
  const buf = new ArrayBuffer(bytes.length)
  const arr = new Uint8Array(buf)
  arr.set(bytes)
  return new DataView(buf)
}

/** Decodes the leading bytes of `bytes` at every width that fits. Widths
 * that don't fit (e.g. int32 with only 3 bytes) read as "—" rather than
 * throwing, so a partial selection still shows what it can. */
export function inspectBytes(bytes: number[], endian: Endianness): InspectResult {
  const dv = view(bytes)
  const le = endian === 'le'
  const n = bytes.length

  const ascii = bytes.map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.')).join('')
  const binary = bytes.map((b) => b.toString(2).padStart(8, '0')).join(' ')

  return {
    int8: n >= 1 ? String(dv.getInt8(0)) : NA,
    uint8: n >= 1 ? String(dv.getUint8(0)) : NA,
    int16: n >= 2 ? String(dv.getInt16(0, le)) : NA,
    uint16: n >= 2 ? String(dv.getUint16(0, le)) : NA,
    int32: n >= 4 ? String(dv.getInt32(0, le)) : NA,
    uint32: n >= 4 ? String(dv.getUint32(0, le)) : NA,
    int64: n >= 8 ? dv.getBigInt64(0, le).toString() : NA,
    uint64: n >= 8 ? dv.getBigUint64(0, le).toString() : NA,
    float32: n >= 4 ? formatFloat(dv.getFloat32(0, le)) : NA,
    float64: n >= 8 ? formatFloat(dv.getFloat64(0, le)) : NA,
    ascii: ascii || NA,
    binary: binary || NA,
  }
}

function formatFloat(v: number): string {
  if (!Number.isFinite(v)) return String(v)
  // Trim to a readable precision without dragging along float noise.
  return Number(v.toPrecision(7)).toString()
}
