/** Decodes a watched SWD variable's raw bytes per its DWARF-derived
 * `typeHint` (see swd::variables on the Rust side) — little-endian, which
 * covers every ARM Cortex-M target this feature is meant for. Anything not
 * a recognized primitive ("bytes", or too few bytes for the claimed type)
 * falls back to a hex dump rather than guessing. */
export function decodeSwdValue(typeHint: string, bytes: number[] | null): string {
  if (!bytes || bytes.length === 0) return '—'
  const buf = new Uint8Array(bytes)
  const view = new DataView(buf.buffer)
  switch (typeHint) {
    case 'bool':
      return buf[0] !== 0 ? 'true' : 'false'
    case 'u8':
      return String(view.getUint8(0))
    case 'i8':
      return String(view.getInt8(0))
    case 'u16':
      return buf.length >= 2 ? String(view.getUint16(0, true)) : hexDump(buf)
    case 'i16':
      return buf.length >= 2 ? String(view.getInt16(0, true)) : hexDump(buf)
    case 'u32':
      return buf.length >= 4 ? String(view.getUint32(0, true)) : hexDump(buf)
    case 'i32':
      return buf.length >= 4 ? String(view.getInt32(0, true)) : hexDump(buf)
    case 'u64':
      return buf.length >= 8 ? view.getBigUint64(0, true).toString() : hexDump(buf)
    case 'i64':
      return buf.length >= 8 ? view.getBigInt64(0, true).toString() : hexDump(buf)
    case 'f32':
      return buf.length >= 4 ? String(view.getFloat32(0, true)) : hexDump(buf)
    case 'f64':
      return buf.length >= 8 ? String(view.getFloat64(0, true)) : hexDump(buf)
    default:
      return hexDump(buf)
  }
}

function hexDump(buf: Uint8Array): string {
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join(' ')
}
