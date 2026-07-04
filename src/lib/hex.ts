/** Parses a hex string like "01 02, FF" into bytes. Returns null if malformed. */
export function parseHex(input: string): number[] | null {
  const cleaned = input.replace(/[\s,]+/g, '')
  if (cleaned.length === 0) return []
  if (cleaned.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(cleaned)) return null
  const bytes: number[] = []
  for (let i = 0; i < cleaned.length; i += 2) {
    bytes.push(parseInt(cleaned.slice(i, i + 2), 16))
  }
  return bytes
}

/** Formats bytes as space-separated uppercase hex, e.g. [1,2,255] -> "01 02 FF". */
export function formatHex(bytes: number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}
