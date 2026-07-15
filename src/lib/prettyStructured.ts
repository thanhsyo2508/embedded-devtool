/** Best-effort "make this readable" for a monitor selection: pretty-prints
 * JSON, or column-aligns CSV/TSV, else hands the text back untouched. Used
 * by the monitor's right-click "Format JSON/CSV". */

export type StructuredKind = 'json' | 'csv' | 'raw'

export interface Structured {
  kind: StructuredKind
  formatted: string
}

const DELIMITERS = [',', ';', '\t']

function detectDelimiter(lines: string[]): string | null {
  for (const delim of DELIMITERS) {
    const counts = lines.map((l) => l.split(delim).length)
    // Consistent column count across every line, and more than one column —
    // otherwise it's just text that happens to contain a comma.
    if (counts[0] >= 2 && counts.every((c) => c === counts[0])) return delim
  }
  return null
}

export function prettyStructured(text: string): Structured {
  const trimmed = text.trim()

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return { kind: 'json', formatted: JSON.stringify(JSON.parse(trimmed), null, 2) }
    } catch {
      // fall through to CSV / raw
    }
  }

  const lines = trimmed.split(/\r?\n/)
  if (lines.length >= 2) {
    const delim = detectDelimiter(lines)
    if (delim) {
      const rows = lines.map((l) => l.split(delim).map((c) => c.trim()))
      const cols = Math.max(...rows.map((r) => r.length))
      const widths: number[] = []
      for (let c = 0; c < cols; c++) {
        widths[c] = Math.max(...rows.map((r) => (r[c] ?? '').length))
      }
      const formatted = rows
        .map((r) =>
          r
            .map((cell, c) => cell.padEnd(widths[c]))
            .join('  ')
            .trimEnd(),
        )
        .join('\n')
      return { kind: 'csv', formatted }
    }
  }

  return { kind: 'raw', formatted: text }
}
