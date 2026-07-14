import { parseHex } from './hex'

export type MemoryContentKind = 'text' | 'hex' | 'dec' | 'json'

/** Converts the STM32 "write memory" panel's typed content into raw bytes
 * ready to stage into a temp file and flash at an address (see
 * stm32Store's `writeMemory`). Throws a user-facing message on malformed
 * input for any kind, rather than silently writing something unintended
 * to a real device's flash. */
export function encodeMemoryContent(kind: MemoryContentKind, content: string): number[] {
  switch (kind) {
    case 'text':
      return Array.from(new TextEncoder().encode(content))
    case 'hex': {
      const bytes = parseHex(content)
      if (bytes === null) {
        throw new Error('Invalid hex — use pairs of hex digits (e.g. "01 02 FF")')
      }
      if (bytes.length === 0) throw new Error('Enter at least one byte')
      return bytes
    }
    case 'dec': {
      const n = Number(content.trim())
      if (!Number.isInteger(n) || n < -2_147_483_648 || n > 4_294_967_295) {
        throw new Error('Enter a whole number that fits in 32 bits')
      }
      // 4 bytes, little-endian -- matches how Cortex-M (STM32) reads a
      // 32-bit word back, the most common width for a register/value poke.
      const buf = new ArrayBuffer(4)
      new DataView(buf).setUint32(0, n >>> 0, true)
      return Array.from(new Uint8Array(buf))
    }
    case 'json': {
      try {
        JSON.parse(content)
      } catch (err) {
        throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`, {
          cause: err,
        })
      }
      return Array.from(new TextEncoder().encode(content))
    }
  }
}
