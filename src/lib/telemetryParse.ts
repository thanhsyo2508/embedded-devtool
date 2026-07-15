/** Extracts key→value pairs from a telemetry line for the live dashboard:
 * flat JSON objects, and `key=value` / `key: value` pairs embedded in text.
 * Deliberately conservative — keys must look like identifiers and values are
 * numbers or barewords — so ordinary prose lines don't spray junk widgets. */

const PAIR_RE = /([A-Za-z_][A-Za-z0-9_.]*)\s*[:=]\s*(-?\d+(?:\.\d+)?|"[^"]*"|[A-Za-z0-9_.+-]+)/g

function unquote(v: string): string {
  return v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v
}

export function parseTelemetry(line: string): Record<string, string> {
  const trimmed = line.trim()

  if (trimmed.startsWith('{')) {
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>
      const out: Record<string, string> = {}
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'number' || typeof v === 'boolean') out[k] = String(v)
        else if (typeof v === 'string') out[k] = v
      }
      if (Object.keys(out).length > 0) return out
    } catch {
      // not JSON — fall through to pair scanning
    }
  }

  const out: Record<string, string> = {}
  let m: RegExpExecArray | null
  const re = new RegExp(PAIR_RE)
  while ((m = re.exec(line)) !== null) {
    out[m[1]] = unquote(m[2])
  }
  return out
}

/** True when the value reads as a finite number — the dashboard right-aligns
 * these and can show them monospaced. */
export function isNumeric(value: string): boolean {
  return value.trim() !== '' && Number.isFinite(Number(value))
}
