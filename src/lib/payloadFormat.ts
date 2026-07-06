export function decodeText(bytes: number[]): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes))
}

/** Pretty-printed JSON if the payload parses as JSON, else null — lets the
 * caller fall back to plain text without re-parsing to check first. */
export function tryPrettyJson(bytes: number[]): string | null {
  const text = decodeText(bytes)
  if (text.trim().length === 0) return null
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return null
  }
}

/** Validates a JSON-mode publish payload before it's ever sent — returns
 * the parser's error message, or null when `text` is valid JSON (an empty
 * payload is treated as valid, since publishing nothing is legitimate). */
export function jsonParseError(text: string): string | null {
  if (text.trim().length === 0) return null
  try {
    JSON.parse(text)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid JSON'
  }
}

export function toHexDump(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')
}

/** Heuristic for whether a payload is more useful shown as a hex dump than
 * decoded text — more than 10% control bytes (excluding tab/LF/CR) reads as
 * binary rather than text that merely failed to parse as JSON. */
export function looksBinary(bytes: number[]): boolean {
  if (bytes.length === 0) return false
  let control = 0
  for (const b of bytes) {
    if (b === 9 || b === 10 || b === 13) continue
    if (b < 0x20 || b === 0x7f) control++
  }
  return control / bytes.length > 0.1
}
